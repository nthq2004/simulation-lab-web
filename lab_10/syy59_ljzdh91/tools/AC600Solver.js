/**
 * AC600Solver — 主机遥控系统 AC 600（MAN B&W AutoChief 600）共享状态模型
 * ═══════════════════════════════════════════════════════════════
 *  由 consys.js 每帧 solve(dt) 驱动，5 个新页面的组件共享同一实例（sys.ac600）：
 *    页 1 驾控台面板 / 页 2 集控台面板 / 页 3 机旁面板 / 页 4 气动操纵系统 / 页 5 MIMIC
 *
 *  主要状态：
 *    controlPos    控制位置：'BRIDGE' | 'ECR' | 'LOCAL'（三处互斥，只有当前位置能操车钟）
 *    engineMode    航行工况：'SEA'（At Sea）| 'STANDBY'（Standby）| 'FWE'（Finished With Engine）
 *    leverIdx      车钟手柄档位索引（TELEGRAPH 数组，0 = NAV FULL … 10 = EM'CY ASTERN）
 *    rpmCmd        转速给定（rpm，含负值 = 倒车）
 *    rpm           主机实际转速（rpm）
 *    load          主机负荷（%）
 *    startAir      起动空气压力（bar，默认 28.3，起动时下降）
 *    controlAir    控制空气压力（bar，7.0）
 *    hydOil        动力液压油压力（bar，280）
 *    running       主机运行
 *    slowDown / shutDown  慢降 / 停车自动动作（安保系统）
 *    cancelSHD / cancelSLD / cancelLimits  越控（Cancel）动作
 *    turningGearOut / airDistributorOk / mainStartValveOk / engineReady  盘车机脱开、空气分配器、主起动阀、备车完成
 *    alarm / silenced / acked  报警（闪烁）、消音、确认
 *
 *  车钟档位（telegraph）与转速给定一一对应；提/降档受控制位置限制：
 *    只有 `canOperate(where)` 为真的位置才能改变车钟，其它位置操作被拒绝（转车钟请求闪烁）。
 * ═══════════════════════════════════════════════════════════════
 */

/** 车钟档位：id / 面板文字 / 对应转速给定 */
export const TELEGRAPH = [
    { id: 'nav-full',   label: 'Nav. Full',     label2: 'NAVIGATION FULL', rpm: 68 },
    { id: 'full',       label: 'Full',          label2: 'FULL',            rpm: 57 },
    { id: 'half',       label: 'Half',          label2: 'HALF',            rpm: 41 },
    { id: 'slow',       label: 'Slow',          label2: 'SLOW',            rpm: 27 },
    { id: 'dead-slow',  label: 'Dead. Slow',    label2: 'DEAD SLOW',       rpm: 21 },
    { id: 'stop',       label: 'Stop',          label2: 'STOP',            rpm: 0 },
    { id: 'dead-slow-a',label: 'Dead. Slow',    label2: 'DEAD SLOW',       rpm: -21 },
    { id: 'slow-a',     label: 'Slow',          label2: 'SLOW',            rpm: -27 },
    { id: 'half-a',     label: 'Half',          label2: 'HALF',            rpm: -41 },
    { id: 'full-a',     label: 'Full',          label2: 'FULL',            rpm: -51 },
    { id: 'em-astern',  label: 'Emp. Astern',   label2: "EM'CY ASTERN",    rpm: -55 },
];

export const CONTROL_POS = {
    BRIDGE: 'BRIDGE',
    ECR: 'ECR',
    LOCAL: 'LOCAL',
};

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/** 车钟位置（0…10，0 = NAV FULL）→ 转速（相邻档位之间线性插值） */
export function posToRpm(pos) {
    const p = clamp(pos, 0, TELEGRAPH.length - 1);
    const i = Math.min(TELEGRAPH.length - 2, Math.floor(p));
    const f = p - i;
    return TELEGRAPH[i].rpm + (TELEGRAPH[i + 1].rpm - TELEGRAPH[i].rpm) * f;
}

/** 转速 → 车钟位置（0…10） */
export function rpmToPos(rpm) {
    const v = clamp(rpm, TELEGRAPH[TELEGRAPH.length - 1].rpm, TELEGRAPH[0].rpm);
    for (let i = 0; i < TELEGRAPH.length - 1; i++) {
        const a = TELEGRAPH[i].rpm, b = TELEGRAPH[i + 1].rpm;
        if (v <= a && v >= b) {
            const span = a - b;
            return i + (span === 0 ? 0 : (a - v) / span);
        }
    }
    return 0;
}

/** 起动过程时长（s）：推手柄后先起动空气转车，之后转为燃油运转（真机约 10 s） */
const START_DURATION = 10;

export class AC600Solver {
    constructor(sys) {
        this.sys = sys;
        this.reset();
    }

    /** 复位到"海上全速航行、集控室控制、68 rpm"的初始状态 */
    reset() {
        this.controlPos = CONTROL_POS.ECR;
        this.engineMode = 'SEA';
        this.runMode = 'ECONOMY';          // Engine Running Mode：ECONOMY 经济模式 / EMISSION 排放模式
        // 各控制位置的车钟（互相独立）：BRIDGE / ECR / LOCAL
        this.leverRpm = { BRIDGE: TELEGRAPH[0].rpm, ECR: TELEGRAPH[0].rpm, LOCAL: TELEGRAPH[0].rpm };
        this.leverIdx = 0;                  // 当前控制位置车钟的最近档（NAVIGATION FULL）
        this.leverPos = 0;                  // 当前控制位置车钟的连续位置（0 = NAV FULL，10 = EM'CY ASTERN）
        this.rpmCmd = 68;
        this.rpm = 68;
        this.load = 83.5;

        this.startAir = 28.3;
        this.controlAir = 7.0;
        this.hydOil = 280;

        this.running = true;
        this.starting = false;
        this.startTimer = 0;
        this.startFail = false;
        this.startBlocked = false;

        this.slowDown = false;
        this.slowDownReq = false;
        this.shutDown = false;

        this.cancelSHD = false;
        this.cancelSLD = false;
        this.cancelLimits = false;

        this.loadLimit = false;
        this.loadLimitUp = false;

        this.auxBlower = true;
        this.auxBlowerAlarm = false;

        this.turningGearOut = true;         // 盘车机已脱开
        this.airDistributorOk = true;       // 空气分配器在工作位
        this.mainStartValveOk = true;       // 主起动阀在工作位
        this.engineReady = true;            // 备车完成

        this.wrongWay = false;
        this.mainStartValveOpen = false;    // 主起动阀开启（起动过程中）
        this.slowTurning = false;

        // 应急停车按钮（自锁型）与玻璃盖
        this.emStopLatched = false;    // 按钮按下并保持
        this.emStopCoverOpen = false;  // 玻璃盖是否上翻打开

        this.alarm = false;
        this.alarmText = '';
        this.messages = [];            // 报警信息队列（报警栏最多显示最新 2 条）
        this.alarmHistory = [];        // 报警历史（ACK 后归档，最多 8 条）
        this.silenced = false;
        this.acked = true;

        this.runHours = 1.4;
        this.rev = 5306;

        this.lampTest = false;
        this.lampTestTimer = 0;

        this.lastOpPos = null;              // 最近一次操作来自哪个位置（供面板提示）
        this.refuseFlash = 0;               // 越权操作被拒绝的闪烁计时

        // 「控制权强制获取」：从非本位置抢控制权（机旁面板有该按钮）
        this.forceTake = false;
    }

    // ═══════════════════════════════════════════════════════
    //  查询
    // ═══════════════════════════════════════════════════════

    get lever() { return TELEGRAPH[clamp(this.leverIdx, 0, TELEGRAPH.length - 1)]; }

    get stateText() {
        if (this.starting) return 'Starting';
        if (this.shutDown) return 'Shut down';
        return this.rpm > 5 ? 'Running' : (this.rpm < -5 ? 'Running (Astern)' : 'Stopped');
    }

    /** 该位置是否有操纵权 */
    canOperate(where) { return this.controlPos === where; }

    get anyAlarm() { return !!this.alarm; }
    /** 报警闪烁相位（未确认时闪） */
    get blink() { return Math.floor(Date.now() / 500) % 2 === 0; }

    // ═══════════════════════════════════════════════════════
    //  操作
    // ═══════════════════════════════════════════════════════

    /** 切换控制位置（三处互斥） */
    setControlPos(pos) {
        if (!pos || this.controlPos === pos) return false;
        this.controlPos = pos;
        this.forceTake = false;
        this.lastOpPos = pos;
        this._syncCmdFromLever();      // 新位置车钟成为主机给定
        return true;
    }

    /** 控制权强制获取（机旁面板） */
    forceTakeControl() {
        this.forceTake = true;
        this.controlPos = CONTROL_POS.LOCAL;
        this.lastOpPos = CONTROL_POS.LOCAL;
    }

    /** 本位置车钟的连续位置（0…10） */
    leverPosAt(where) { return rpmToPos(this.leverRpm[where || this.controlPos] ?? this.rpmCmd); }

    /** 设定某位置的车钟（连续值）；只有该位置拥有控制权时才同步到主机给定 */
    setLeverAt(rpm, where) {
        const w = where || this.controlPos;
        const top = TELEGRAPH[0].rpm;
        const bottom = TELEGRAPH[TELEGRAPH.length - 1].rpm;
        const val = Math.round(clamp(rpm, bottom, top) * 10) / 10;
        this.leverRpm[w] = val;
        this.lastOpPos = w;
        if (w === this.controlPos) this._syncCmdFromLever();
        return val;
    }

    /** 连续给定（车钟手柄拖动）：任意位置都可自由拖动；仅控制位置影响主机给定 */
    setLeverContinuous(rpm, where) {
        return this.setLeverAt(rpm, where) !== undefined;
    }

    /** 某位置车钟吸附到最近档（仅当相差 ≤1 rpm 时） */
    snapLeverAt(where) {
        const w = where || this.controlPos;
        const cur = this.leverRpm[w] ?? this.rpmCmd;
        let best = 0, bd = Infinity;
        TELEGRAPH.forEach((t, i) => {
            const d = Math.abs(t.rpm - cur);
            if (d < bd) { bd = d; best = i; }
        });
        if (bd <= 1) return this.setLeverById(TELEGRAPH[best].id, w);
        return false;
    }

    /** 把控制位置车钟同步为主机给定（rpmCmd / leverIdx / leverPos） */
    _syncCmdFromLever() {
        const w = this.controlPos;
        const rpm = (this.leverRpm && this.leverRpm[w] !== undefined) ? this.leverRpm[w] : this.rpmCmd;
        this.rpmCmd = Math.round(rpm * 10) / 10;
        let best = 0, bd = Infinity;
        TELEGRAPH.forEach((t, i) => {
            const d = Math.abs(t.rpm - this.rpmCmd);
            if (d < bd) { bd = d; best = i; }
        });
        this.leverIdx = best;
        this.leverPos = rpmToPos(this.rpmCmd);
    }

    /** 车钟提档 / 降档（dir=+1 提档、-1 降档）：作用在 where（默认控制位置）的车钟上 */
    stepLever(dir, where) {
        const w = where || this.controlPos;
        const cur = rpmToPos(this.leverRpm[w] ?? this.rpmCmd);
        const next = clamp(Math.round(cur) - dir, 0, TELEGRAPH.length - 1);
        this.setLeverById(TELEGRAPH[next].id, w);
        return true;
    }

    /** 直接设定档位（按档位名） */
    setLeverById(id, where) {
        const i = TELEGRAPH.findIndex(t => t.id === id);
        if (i < 0) return false;
        const w = where || this.controlPos;
        this.leverRpm[w] = TELEGRAPH[i].rpm;
        this.lastOpPos = w;
        if (w === this.controlPos) {
            this.rpmCmd = TELEGRAPH[i].rpm;
            this.leverIdx = i;
            this.leverPos = i;
        }
        return true;
    }

    /** 改变转速给定 ±2 rpm（RPM CMD 上下箭头） */
    stepRpmCmd(delta) {
        this.setLeverAt(this.rpmCmd + delta, this.controlPos);
        return this.rpmCmd;
    }


    /** 主机起动（按「起动」或机旁「慢转起动」） */
    startEngine(slow = false) {
        if (this.starting) return false;
        if (!this.turningGearOut) { this.raiseAlarm('盘车机未脱开，禁止起动'); this.startBlocked = true; return false; }
        if (!this.airDistributorOk) { this.raiseAlarm('空气分配器不在工作位，禁止起动'); this.startBlocked = true; return false; }
        if (!this.mainStartValveOk) { this.raiseAlarm('主起动阀不在工作位，禁止起动'); this.startBlocked = true; return false; }
        if (this.startAir < 15) { this.raiseAlarm('起动空气压力过低，不能起动'); this.startBlocked = true; return false; }
        this.startBlocked = false;
        this.starting = true;
        this.slowTurning = !!slow;
        this.startTimer = 0;
        this.mainStartValveOpen = true;
        return true;
    }

    /** 手柄自动起动（推手柄离开 STOP 即自动起动，含联锁检查） */
    _autoStart() {
        const wants = Math.abs(this.rpmCmd) > 0.5;
        if (!wants) {
            // 手柄回 STOP：中止尚未完成的起动
            if (this.starting) {
                this.starting = false;
                this.mainStartValveOpen = false;
                this.startTimer = 0;
            }
            return;
        }
        if (this.running || this.starting) return;
        if (this.shutDown && !this.cancelSHD) return;              // 停车动作中
        if (!this.turningGearOut || !this.airDistributorOk || !this.mainStartValveOk || this.startAir < 15) {
            this.startBlocked = true;
            return;
        }
        this.startBlocked = false;
        this.starting = true;
        this.slowTurning = false;
        this.startTimer = 0;
        this.mainStartValveOpen = true;
    }

    /** 玻璃盖：按一次上翻打开，再按一次翻下遮住 */
    toggleEmStopCover() {
        this.emStopCoverOpen = !this.emStopCoverOpen;
        return this.emStopCoverOpen;
    }

    /** 应急停车按钮（自锁）：盖打开时按下 → 触发并保持；再按一次 → 弹出并取消指令 */
    pressEmStop() {
        if (!this.emStopCoverOpen) return false;   // 玻璃盖遮住时不可操作
        if (this.emStopLatched) {
            this.emStopLatched = false;
            this.shutDown = false;
            this.alarm = false;
            this.acked = true;
            this.clearMessages();
            return false;
        }
        this.emStopLatched = true;
        this.emergencyStop();
        return true;
    }

    /** 机旁应急停车 */
    emergencyStop() {
        this.shutDown = true;
        this.starting = false;
        this.mainStartValveOpen = false;
        this.rpmCmd = 0;
        this.leverIdx = 5;
        this.alarm = true;
        this.acked = false;
        this.silenced = false;
        this.alarmText = 'ENGINE TRIPPED, ACTIVE';
        this.messages = ['ENGINE TRIPPED, ACTIVE', 'START FAIL/BLOCK, ACTIVE'];
    }

    cancelSafety(kind) {
        if (kind === 'SHD') this.cancelSHD = true;
        if (kind === 'SLD') this.cancelSLD = true;
        if (kind === 'LIM') this.cancelLimits = true;
    }

    /** 切换型越控按钮：按一次置位（越控），再按一次复位 */
    toggleSafety(kind) {
        if (kind === 'SHD') this.cancelSHD = !this.cancelSHD;
        if (kind === 'SLD') this.cancelSLD = !this.cancelSLD;
        if (kind === 'LIM') this.cancelLimits = !this.cancelLimits;
        return kind === 'SHD' ? this.cancelSHD : (kind === 'SLD' ? this.cancelSLD : this.cancelLimits);
    }

    raiseAlarm(text) {
        this.alarm = true;
        this.alarmText = text || '主机报警';
        this.acked = false;
        this.silenced = false;
        this.pushMessage(this.alarmText);
    }

    /** 追加一条报警信息（去重，最多保留 2 条） */
    pushMessage(text) {
        if (!text) return;
        if (!this.messages) this.messages = [];
        if (this.messages.includes(text)) return;
        this.messages.unshift(text);
        if (this.messages.length > 2) this.messages.length = 2;
    }

    /** 清空报警信息队列 */
    clearMessages() {
        this.messages = [];
        this.alarmText = '';
    }

    ack() {
        // 归档到报警历史后再清除当前报警
        const t = new Date();
        const hhmm = String(t.getHours()).padStart(2, '0') + ':' + String(t.getMinutes()).padStart(2, '0');
        (this.messages || []).slice().reverse().forEach((text, i) => {
            this.alarmHistory.unshift({ time: hhmm, id: `ALM-${101 + i}`, text });
        });
        if (this.alarmHistory.length > 8) this.alarmHistory.length = 8;
        this.acked = true;
        this.alarm = false;
        this.clearMessages();
    }
    silence() { this.silenced = true; }

    lampTest() { this.lampTest = true; this.lampTestTimer = 2.0; }

    toggleTurningGear() {
        this.turningGearOut = !this.turningGearOut;
        if (!this.turningGearOut && this.rpm > 5) this.raiseAlarm('主机运行中，禁止合上盘车机');
    }

    toggleLoadLimit() { this.loadLimit = !this.loadLimit; }

    // ═══════════════════════════════════════════════════════
    //  求解
    // ═══════════════════════════════════════════════════════

    solve(dt) {
        dt = Math.min(dt || 0, 0.2);

        // 手柄自动起动：手柄离开 STOP（有转速给定）且主机未运行 → 自动进入起动过程
        this._autoStart();

        // 起动过程：约 3 s 内转速建立
        if (this.starting) {
            this.startTimer += dt;
            this.startAir = Math.max(18, this.startAir - dt * 2.2);
            if (this.startTimer > (this.slowTurning ? START_DURATION + 3 : START_DURATION)) {
                this.starting = false;
                this.mainStartValveOpen = false;
                this.running = true;
                this.rpm = Math.max(this.rpm, 12);
            }
        } else {
            // 起动空气由空压机补气
            if (this.startAir < 28.3) this.startAir = Math.min(28.3, this.startAir + dt * 0.55);
        }

        if (this.starting) {
            // 起动空气转车阶段：转速稳定在很低值（约 10 rpm），不跟随燃油给定
            this.rpm += (10 - this.rpm) * Math.min(1, dt * 4);
        } else {
            // 主机转速追随给定（慢降时目标受限）
            let target = this.rpmCmd;
            if (this.slowDown && !this.cancelSLD) target = Math.min(target, target > 0 ? 40 : target);
            if (this.shutDown && !this.cancelSHD) target = 0;
            const rate = this.shutDown ? 55 : 26;              // rpm/s
            const diff = target - this.rpm;
            if (Math.abs(diff) > 0.2) {
                this.rpm += clamp(diff, -rate * dt, rate * dt);
            } else {
                this.rpm = target;
            }
        }
        this.rpm = Math.round(this.rpm * 10) / 10;

        // 负荷随转速（22 % + 0.9 rpm，上限 105 %；负荷限制时封顶 80 %）
        const cap = (this.loadLimit && !this.cancelLimits) ? 80 : 105;
        const tLoad = this.rpm > 0 ? Math.min(cap, 22 + this.rpm * 0.9) : 0;
        this.load += (tLoad - this.load) * Math.min(1, dt * 1.6);
        this.load = Math.round(this.load * 10) / 10;

        this.running = !this.starting && Math.abs(this.rpm) > 1;

        // 转向不符（车钟与转向相反时的提示）
        this.wrongWay = this.rpmCmd < 0 && this.rpm > 8;

        // 辅助鼓风机：负荷高时运行
        this.auxBlower = this.load > 25;
        this.auxBlowerAlarm = !this.auxBlower && this.rpm > 30;

        if (this.lampTestTimer > 0) {
            this.lampTestTimer -= dt;
            if (this.lampTestTimer <= 0) this.lampTest = false;
        }
        if (this.refuseFlash > 0) this.refuseFlash -= dt;

        // 运行小时
        this.runHours += dt / 3600;
        this.rev += dt * 1.7;
    }
}

/** 取系统里的模型实例（组件统一走这里，缺省时就地创建） */
export function ac600Of(sys) {
    if (!sys) return null;
    if (!sys.ac600) sys.ac600 = new AC600Solver(sys);
    return sys.ac600;
}
