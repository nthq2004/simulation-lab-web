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
const START_DURATION = 3;   // 起动空气转车时长（s）：过长会让转速长时间卡在 ~10 rpm

export class AC600Solver {
    constructor(sys) {
        this.sys = sys;
        this.reset();
    }

    /** 复位到"海上全速航行、集控室控制、68 rpm"的初始状态 */
    reset() {
        this.loLowLowShd = false;
        this.jcwLowShd = false;
        this.sldCauses = {};
        this.sldAwaitReset = false;
        this._osTestArmed = true;
        this.cancelAlarmOn = { shd: false, sld: false, lim: false };
        this._restTime = 0;
        this._cmdHold = 0;
        this._lastCmdVal = this.rpmCmd;
        this._startDir = 1;
        this.crashAsternOn = false;
        this._navFullAt = 0;
        this.overspeedTripped = false;
        if (this.overspeedTest) {
            this.overspeedTest.simOn = false;
            this.overspeedTest.osTestOn = false;
            this.overspeedTest.msg = '';
            this.overspeedTest.msgUntil = 0;
        }
        this.controlPos = CONTROL_POS.ECR;
        this.engineMode = 'SEA';
        this.runMode = 'ECONOMY';          // Engine Running Mode：ECONOMY 经济模式 / EMISSION 排放模式
        // 各控制位置的车钟（互相独立）：BRIDGE / ECR / LOCAL
        this.leverRpm = { BRIDGE: TELEGRAPH[0].rpm, ECR: TELEGRAPH[0].rpm, LOCAL: TELEGRAPH[0].rpm };
        this.leverIdx = 0;                  // 当前控制位置车钟的最近档（NAVIGATION FULL）
        this.leverPos = 0;                  // 当前控制位置车钟的连续位置（0 = NAV FULL，10 = EM'CY ASTERN）
        this.rpmCmd = 68;
        this.setp = 68;
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

        // 限制规律参数（Limiters 面板保存时同步）
        this.limits = {
            accelRate: 2,            // Accel. Lim.（rpm/s）
            decelRate: 3,            // Decel. Lim.（rpm/s）
            loadUpFrom: 57, loadUpTo: 68, loadUpTime: 3,        // Load Up program（min）
            loadDownFrom: 57, loadDownTo: 68, loadDownTime: 2,  // Load Down program（min）
            critLo: 30, critHi: 37,  // 临界转速禁区
            critRiseSp: 37,          // 升速避下限时的 SETP
            critFallSp: 50,          // 降速避上限时的 SETP
            maxAhead: 68, maxAstern: 55,
            steadyMin: 21,
        };
        this.setp = 68;              // 实际送到调速器的转速给定（受各类限制约束）
        // 主机惯性决定的最大转速变化率：68 → 0 最快约 15 s（≈4.53 rpm/s），
        // 所有限制取消（Cancel Limits）时也按这个最快速率升降，不会瞬间跳变
        this.inertiaRate = 68 / 15;
        this._restTime = 0;          // 主机静止（|rpm| < 1）累计时长：过零反转过程中不重复起动
        this._cmdHold = 0;           // 车令保持不变的时长：拖车钟途中不自动起动（避免"拖过倒车区就反向起动"）
        this._lastCmdVal = 0;
        this._startDir = 1;          // 本次起动的转向（+1 正车 / −1 倒车，按车令符号）
        this.activeLimiter = '';     // 当前正在执行的限制（主页右下角显示）
        this.stoppedTime = 0;              // 停机累计时长（s）—— 超过 slow turning 门槛则下次起动先慢转
        this.slowTurnStopMin = 20;         // 激活慢转的停机时间（min）
        this.slowTurnDurS = 10;            // 慢转持续时间（s）
        this.runHours = 1.4;
        this.rev = 5306;

        // 转速检测页（RPM Detector）—— 超速保护试验状态（两块面板共享同一台设备）
        this.overspeedTripped = false;   // 超速停车已动作（锁存）
        this.loLowLowShd = false;        // 监视报警系统执行的「滑油低低压」安保停车
        this.jcwLowShd = false;          // 冷却水 PS 断开 → 缸套水进口低压安保停车
        this.sldCauses = {};             // 监视系统"自动减速"的原因集合（温度回落后按 tagId 撤销）
        this.sldAwaitReset = false;      // 减速原因已消失、但减速动作锁存中（需车钟拉到 40 rpm 以下复位）
        this.cancelAlarmOn = { shd: false, sld: false, lim: false };   // 三个 Cancel 报警是否处于激活
        this.cancelSHDBy = { BRIDGE: false, ECR: false, LOCAL: false };
        this.cancelSLDBy = { BRIDGE: false, ECR: false, LOCAL: false };
        this.cancelLimBy = { BRIDGE: false, ECR: false, LOCAL: false };
        this.overspeedTest = {
            simOn: false,        // Rpm Simulate 开关
            simRpm: 65.0,        // 模拟转速值
            osTestOn: false,     // Overspeed Test 开关
            osTestRpm: 78.0,     // 超速试验值
            osLevel: 78.0,       // 超速动作值
            msg: '',             // 页面提示（拒绝操作/试验结果）
            msgUntil: 0,
        };

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

    /** 调速器输出（燃油指数 %）—— 用主机负荷近似 */
    get fuelIndex() { return Math.max(0, Math.min(110, this.load)); }

    /** 扫气压力（bar）—— 由转速推算（0 rpm→0.02，68 rpm→2.4） */
    get scavAir() { return 0.02 + Math.max(0, Math.min(68, this.rpm)) / 68 * 2.38; }

    get stateText() {
        if (this.starting) return 'Starting';
        if (this.shutDown && !this.cancelSHD) return 'Engine Tripped';
        if (this.rpm > 5) return 'Running';
        if (this.rpm < -5) return 'Running (Astern)';
        return this.engineReady ? 'Ready for Start' : 'Stopped';
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
        // 无扰转移：新位置手柄对齐当前给定（LEVER 不跳变），此后只有该位置的车钟能改变 LEVER
        if (this.leverRpm) this.leverRpm[pos] = this.rpmCmd;
        this._syncCmdFromLever();
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

    /**
     * 设定某位置的车钟（连续值）。
     * 各位置车钟都能自由拖动；**只有控制位置的车钟会改写主机给定（LEVER）**。
     */
    setLeverAt(rpm, where) {
        const w = where || this.controlPos;
        const top = TELEGRAPH[0].rpm;
        const bottom = TELEGRAPH[TELEGRAPH.length - 1].rpm;
        const val = Math.round(clamp(rpm, bottom, top) * 10) / 10;
        this.leverRpm[w] = val;
        this.lastOpPos = w;
        if (w === this.controlPos) {
            this._syncCmdFromLever();
            this._checkCrashAstern(val);
        }
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
            this._checkCrashAstern(TELEGRAPH[i].rpm);
            this.rpmCmd = TELEGRAPH[i].rpm;
            this.leverIdx = i;
            this.leverPos = i;
        }
        return true;
    }

    /**
     * 应急操作（Crash astern）：车钟从 NAV FULL 直接拉到 EM'CY ASTERN → 触发应急操作，
     * **Cancel Limits 自动生效**（面板 Cancel Limits 指示灯随之点亮），限制全部取消以便最快响应。
     */
    crashAstern() {
        this.crashAsternOn = true;
        this.cancelLimits = true;
        this.activeLimiter = '';
        this._navFullAt = 0;
        return true;
    }

    /**
     * 车钟在 NAV FULL ↔ EM'CY ASTERN 之间的"直接放车"检测：
     * 记下最近一次停在 NAV FULL 的时刻，若 3 s 内直接落到 EM'CY ASTERN → 触发 crashAstern()。
     */
    _checkCrashAstern(val) {
        const topR = TELEGRAPH[0].rpm;
        const botR = TELEGRAPH[TELEGRAPH.length - 1].rpm;
        if (val >= topR - 0.5) { this._navFullAt = Date.now(); return; }
        if (val <= botR + 0.5 && this._navFullAt && Date.now() - this._navFullAt < 3000) {
            this.crashAstern();
        }
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
        this._startDir = this.rpmCmd >= 0 ? 1 : -1;                // 倒车车令 → 反向起动
        // 试验只在停机状态进行：一旦起动，自动结束超速保护试验
        if (this.overspeedTest) { this.overspeedTest.simOn = false; this.overspeedTest.osTestOn = false; }
        this.slowTurning = !!slow;
        this.startTimer = 0;
        this.mainStartValveOpen = true;
        return true;
    }

    /**
     * 计算 SETP（限制后的转速给定）并按限制逐步逼近车令：
     *  · 车令落在临界转速禁区：升速避下限（SETP=37）、降速避上限（SETP=50）
     *  · 升速：SETP < 57 → 加速度限制（accelRate）；≥57 → Load Up program 速率
     *  · 降速：SETP > 57 → Load Down program 速率；≤57 → 减速度限制（decelRate）
     */
    _stepSetp(dt) {
        const L = this.limits || {};
        const cmd = this.rpmCmd;
        const cur = (typeof this.setp === 'number') ? this.setp : cmd;
        const inCrit = (v) => v >= (L.critLo ?? 30) && v <= (L.critHi ?? 37);

        // 方向判定：按实际转速趋势（升速 / 降速）
        const prev = (typeof this._prevRpm === 'number') ? this._prevRpm : this.rpm;
        const trend = this.rpm - prev;
        this._prevRpm = this.rpm;

        // 目标：默认就是车令；车令落禁区时按方向避让
        let target = cmd;
        let why = '';
        if (inCrit(cmd) && Math.abs(this.rpm) > 1) {
            const rising = Math.abs(trend) > 0.01 ? (trend > 0) : (cmd >= cur);
            target = rising ? (L.critRiseSp ?? 37) : (L.critFallSp ?? 50);
            why = 'Crit. Speed';
        }

        // 慢降（自动减速）：给定压到 40 rpm，并按减速度限制快速下降（不走 Load Down 程序）
        if (this.slowDown && !this.cancelSLD) {
            if (target > 40) target = 40;
            const stepSld = Math.abs(L.decelRate ?? 3) * dt;
            this.setp = cur + clamp(target - cur, -stepSld, stepSld);
            this.activeLimiter = 'Slow Down';
            return;
        }

        // Cancel Limits 越控：加速/减速/Load Up/Down 等速率限制一律取消（临界转速避让与最低稳定转速仍有效）
        if (this.cancelLimits) {
            this.setp = target;
            this.activeLimiter = why;
            return;
        }

        const diff = target - cur;
        if (Math.abs(diff) < 0.05) {
            this.setp = target;
            this.activeLimiter = why;                              // 到点后不再显示限制
            return;
        }

        const up = diff > 0;
        let rate;                                                   // rpm/s
        if (up) {
            if (cur >= (L.loadUpFrom ?? 57)) {
                rate = ((L.loadUpTo ?? 68) - (L.loadUpFrom ?? 57)) / Math.max(0.01, (L.loadUpTime ?? 3) * 60);
                why = why || 'Load Up';
            } else {
                rate = (L.accelRate ?? 2);
                why = why || 'Accel. Lim.';
            }
        } else {
            if (cur > (L.loadDownFrom ?? 57)) {
                rate = ((L.loadDownFrom ?? 57) - (L.loadDownTo ?? 68)) / Math.max(0.01, (L.loadDownTime ?? 2) * 60);
                if (rate < 0) rate = -rate;
                why = why || 'Load Down';
            } else {
                rate = Math.abs(L.decelRate ?? 3);
                why = why || 'Decel. Lim.';
            }
        }
        const step = rate * dt;
        this.setp = cur + clamp(diff, -step, step);   // 不取整：Load Up/Down 速率很慢（~0.09 rpm/s）
        this.activeLimiter = why;
    }

    /** 主机是否处于停机状态（超速保护试验只能在此状态下进行） */
    get isStopped() { return !this.starting && Math.abs(this.rpm) < 1; }

    /**
     * RPM Detector 页的两个试验开关（sim = Rpm Simulate，os = Overspeed Test）。
     * 只有停机状态才允许从 OFF 切到 ON；运行中点击只给出提示，开关不动。
     * @returns {boolean} 是否切换成功
     */
    toggleOverspeedTest(which) {
        const T = this.overspeedTest;
        if (!T) return false;
        const cur = which === 'sim' ? !!T.simOn : !!T.osTestOn;
        if (!cur && !this.isStopped) {
            T.msg = '主机未停机，不能进行超速保护试验';
            T.msgUntil = Date.now() + 2600;
            return false;
        }
        if (which === 'sim') T.simOn = !T.simOn;
        else T.osTestOn = !T.osTestOn;
        T.msg = '';
        T.msgUntil = 0;
        return true;
    }

    /**
     * 监视报警系统（K-Chief）执行安保动作时调用：
     *   SHD —— 燃油切断、主机自动停车（滑油低低压等）；
     *   SLD —— 主机自动减速。
     * @param {'SHD'|'SLD'} kind
     * @param {string} tagId 触发测点（如 'ME-LO-PR-SW'）
     */
    safetyAction(kind, tagId) {
        const TEXT = {
            'ME-LO-PR-SW': 'MAIN L.O. LOW-LOW PRESS',
            'CW-PS': 'JACKET C.F.W. INLET PRESS LOW',
            'CW-T': 'JACKET C.F.W. OUTLET TEMP HIGH',
            'ME-LO-T': 'MAIN L.O. INLET TEMP HIGH',
            'ME-GEN-SAIR': 'START AIR PRESS LOW',
            'ME-CW-T': 'J.C.F.W. OUTLET TEMP HIGH',
            'ME-FO-P': 'MAIN FUEL OIL PRESS LOW',
        };
        const txt = TEXT[tagId] || String(tagId || '').replace(/-/g, ' ').toUpperCase();
        if (kind === 'SLD') {
            this.sldCauses = this.sldCauses || {};
            this.sldCauses[tagId] = txt;
            this.slowDown = true;
            this.cancelSLD = false;
            this.alarm = true;
            this.acked = false;
            this.silenced = false;
            this.alarmText = `${txt}, SLDN`;
            this.pushMessage(`${txt}, SLDN`);
            return;
        }
        // SHD：燃油切断、主机停车（与超速停车同样的表现）
        this.shutDown = true;
        this.cancelSHD = false;
        this.starting = false;
        this.mainStartValveOpen = false;
        this.running = false;
        this.rpmCmd = 0;
        this.leverIdx = 5;
        this.setp = 0;
        this.rpm = 0;
        this.load = 0;
        this.engineReady = false;
        this.startBlocked = true;
        if (tagId === 'ME-LO-PR-SW') this.loLowLowShd = true;
        if (tagId === 'CW-PS') this.jcwLowShd = true;
        this.alarm = true;
        this.acked = false;
        this.silenced = false;
        this.alarmText = `${txt}, SHUTDN`;
        this.messages = [];
        this.pushMessage(`${txt}, SHUTDN`);
    }

    /**
     * 自动减速的原因消失（温度回落到回差值以下）→ 解除 SLD；
     * 没有其它减速原因时结束慢降显示，并按"已应答自动清除 / 未应答转 NORMAL"处理报警信息。
     */
    safetyClear(kind, tagId) {
        if (kind !== 'SLD') return;
        this.sldCauses = this.sldCauses || {};
        const txt = this.sldCauses[tagId];
        if (!txt) return;
        delete this.sldCauses[tagId];
        // 报警信息随故障恢复处理（已应答 → 清除；未应答 → 改写成 NORMAL）
        if (this.alarm) {
            if (this.acked) {
                this.messages = (this.messages || []).filter((m) => !m.startsWith(txt));
                if (!this.messages.length) this.alarm = false;
            } else {
                this.messages = (this.messages || []).map((m) => (m.startsWith(txt) ? `${txt}, NORMAL` : m));
            }
            this.alarmText = (this.messages[0] || '');
        }
        // ⚠ 减速动作不自动复位：锁存，直到把（控制位置的）车钟拉到 40 rpm 以下
        if (!Object.keys(this.sldCauses).length) this.sldAwaitReset = true;
    }

    /** 超速保护动作：燃油切断 → 主机停车（由转速检测页试验触发，锁存） */
    _overspeedTrip() {
        if (this.overspeedTripped) return;
        this.overspeedTripped = true;
        this.shutDown = true;
        this.cancelSHD = false;
        this.starting = false;
        this.mainStartValveOpen = false;
        this.running = false;
        this.rpmCmd = 0;
        this.setp = 0;
        this.rpm = 0;
        this.load = 0;
        this.leverIdx = 5;
        this.alarm = true;
        this.acked = false;
        this.silenced = false;
        this.engineReady = false;        // 停车后主机未备车（状态条 Eng. Not Ready）
        this.startBlocked = true;        // 超速停车 → 起动阻塞
        this.alarmText = 'OVERSPEED SYS.1 - SW BACKUP, SHUTDN';
        this.messages = [];
        this.pushMessage('OVERSPEED SYS.2 - SW BACKUP, SHUTDN');
        this.pushMessage('OVERSPEED SYS.1 - SW BACKUP, SHUTDN');
        const T = this.overspeedTest;
        if (T) {
            T.msg = `超速保护动作：模拟转速 ${T.simRpm.toFixed(1)} rpm 超过试验值 ${T.osTestRpm.toFixed(1)} rpm`;
            T.msgUntil = Date.now() + 10000;
        }
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
        if (this._restTime < 0.3) return;                          // 刚过零/正在换向：不重复起动
        if (this._cmdHold < 0.4) return;                           // 车钟还在拖动（车令连续变化）：等把手柄放稳再起动
        if (this.shutDown && !this.cancelSHD) return;              // 停车动作中
        if (!this.turningGearOut || !this.airDistributorOk || !this.mainStartValveOk || this.startAir < 15) {
            this.startBlocked = true;
            return;
        }
        this.startBlocked = false;
        this.starting = true;
        this._startDir = this.rpmCmd >= 0 ? 1 : -1;                // 倒车车令 → 反向起动
        // 试验只在停机状态进行：一旦起动，自动结束超速保护试验
        if (this.overspeedTest) { this.overspeedTest.simOn = false; this.overspeedTest.osTestOn = false; }
        // 停机时间超过门槛（默认 20 min）→ 本次起动先慢转
        this.slowTurning = this.stoppedTime >= (this.slowTurnStopMin || 20) * 60;
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
            this.overspeedTripped = false;
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
        if (kind === 'SHD') {
            this.cancelSHD = true;
            this.overspeedTripped = false;
            this.loLowLowShd = false;
            this.jcwLowShd = false;
            this._shutAlarmReturn();
        }
        if (kind === 'SLD') this.cancelSLD = true;
        if (kind === 'LIM') this.cancelLimits = true;
    }

    /** 切换型越控按钮：按一次置位（越控），再按一次复位 */
    toggleSafety(kind) {
        if (kind === 'SHD') {
            this.cancelSHD = !this.cancelSHD;
            if (this.cancelSHD) {
                this.overspeedTripped = false;   // 越控后解除超速锁存
                this.loLowLowShd = false;
                this.jcwLowShd = false;
                this._shutAlarmReturn();         // 故障消失 → 已应答则清除，未应答则转 RTN
            }
        }
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

    /** 当前是否还有未恢复的故障（含越控产生的报警）——应答时据此决定"保持黄色"还是"直接清除" */
    _anyFaultActive() {
        if (this.overspeedTripped) return true;                    // 超速停车
        if (this.shutDown && !this.cancelSHD) return true;         // 停车动作未越控
        const C = this.cancelAlarmOn || {};
        return !!(C.shd || C.sld || C.lim);                        // 三个 Cancel 产生的报警
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
        // 故障仍在（未恢复）→ 报警保留（已确认，页面显示黄色），只停止声光；
        // 故障已恢复 → 确认后直接清除报警与信息栏（超速与三个 Cancel 报警规则一致）
        if (!this._anyFaultActive()) {
            this.alarm = false;
            this.clearMessages();
            return;
        }
        // 仍有动作中的故障：已恢复（…, NORMAL）的信息在确认后移除，只保留仍在动作的条目
        const keep = (this.messages || []).filter((m) => !/, NORMAL$/.test(m));
        this.messages = keep;
        if (!keep.length) this.alarm = false;
        else this.alarmText = keep[0];
    }

    /**
     * 设置越控状态（面板三个 Cancel 按钮各自的开关 → 系统副作用）。
     * @param {'SHD'|'SLD'|'LIM'} kind
     * @param {boolean} on
     */
    setCancel(kind, on, where) {
        const w = where || this.controlPos;
        const key = { SHD: 'cancelSHDBy', SLD: 'cancelSLDBy', LIM: 'cancelLimBy' }[kind];
        if (!key) return false;
        this[key] = this[key] || { BRIDGE: false, ECR: false, LOCAL: false };
        this[key][w] = !!on;
        const any = Object.values(this[key]).some(Boolean);   // 任一位置按下即生效
        if (kind === 'SHD') {
            const before = this.cancelSHD;
            this.cancelSHD = any;
            if (any && !before) {
                this.overspeedTripped = false;
                this.loLowLowShd = false;
                this.jcwLowShd = false;
                this._shutAlarmReturn();
            }
        } else if (kind === 'SLD') this.cancelSLD = any;
        else this.cancelLimits = any;
        return !!on;
    }

    /**
     * 面板左侧越控按钮（Cancel SHD / SLD / Limits）产生的报警：
     * 按下 → 报警 `xxx, ACTIVE`（进入报警栏与 Sys. Non-Crit）；再按取消 → 已应答则清除，未应答转 `, NORMAL`。
     */
    setCancelAlarm(kind, on) {
        const txt = { shd: 'SHUTDOWN CANCELLED', sld: 'SLOWDOWN CANCELLED', lim: 'LIMITS CANCEL FROM ACP' }[kind];
        if (!txt) return;
        this.cancelAlarmOn = this.cancelAlarmOn || { shd: false, sld: false, lim: false };
        const act = `${txt}, ACTIVE`;
        const has = (this.messages || []).some((m) => m.startsWith(txt));
        if (on) {
            this.cancelAlarmOn[kind] = true;
            if (!has) this.raiseAlarm(act);        // 已存在则不重复报警（也不会把已确认状态打回未确认）
            return;
        }
        this.cancelAlarmOn[kind] = false;
        if (!has) return;
        if (this.acked) {
            // 已应答 → 该报警直接消失（不需要第二次应答）
            this.messages = (this.messages || []).filter((m) => !m.startsWith(txt));
            if (!this.messages.length) this.alarm = false;
            this.alarmText = (this.messages[0] || '');
            return;
        }
        // 未应答 → RTN：文字转 NORMAL，保持红色等待 ACK
        this.messages = (this.messages || []).map((m) => (m.startsWith(txt) ? `${txt}, NORMAL` : m));
        this.alarmText = this.messages[0] || '';
    }

    /**
     * 停车/超速故障消失（如越控 Cancel SHD）：
     * · 已应答（acked）→ 报警自动清除（不需要第二次应答）；
     * · 未应答 → 转 RTN：报警信息文字由 SHUTDN 改为 NORMAL，仍保持未复位状态等待 ACK。
     */
    _shutAlarmReturn() {
        this.engineReady = true;
        this.startBlocked = false;
        if (!this.alarm) return;
        if (this.acked) { this.alarm = false; this.clearMessages(); return; }
        this.messages = (this.messages || []).map((t) => t.replace(/SHUTDN$/, 'NORMAL'));
        this.alarmText = this.messages[0] || '';
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

        // 停机时长累计（用于 slow turning 程序）
        if (this.running) this.stoppedTime = 0;
        else this.stoppedTime += dt;

        // 静止计时（过零换向过程中不触发重复起动）
        if (Math.abs(this.rpm) < 1) this._restTime += dt;
        else this._restTime = 0;

        // 车令稳定计时（拖车钟途中车令一直在变 → 不计时，松手稳定后才允许自动起动）
        if (this.rpmCmd !== this._lastCmdVal) { this._lastCmdVal = this.rpmCmd; this._cmdHold = 0; }
        else this._cmdHold += dt;

        // 超速保护试验：两个开关都在 ON，且模拟转速超过超速试验值 → 超速停车
        // 每次试验只动作一次（越限后需先退出越限/关掉开关"重新武装"，避免越控后被立刻重新触发）
        const OT = this.overspeedTest;
        if (OT) {
            const over = OT.simOn && OT.osTestOn && OT.simRpm > OT.osTestRpm;
            if (over) {
                if (this._osTestArmed !== false) {
                    this._osTestArmed = false;
                    this._overspeedTrip();
                }
            } else {
                this._osTestArmed = true;
                // 试验条件消失（模拟转速降到试验值以下 / 关掉开关）→ 超速故障消失，报警自动恢复
                if (this.overspeedTripped) {
                    this.overspeedTripped = false;
                    if (!this.emStopLatched) this.shutDown = false;   // 试验引起的停车随之解除
                    this._shutAlarmReturn();                          // 已应答→清除；未应答→转 RTN
                }
            }
        }

        // 慢降锁存复位：减速原因已消失，且本船车令（控制位置车钟）拉到 40 rpm 以下 → 解除自动减速
        if (this.slowDown && this.sldAwaitReset
            && !Object.keys(this.sldCauses || {}).length
            && Math.abs(this.rpmCmd) < 40) {
            this.slowDown = false;
            this.sldAwaitReset = false;
        }

        // 手柄自动起动：手柄离开 STOP（有转速给定）且主机未运行 → 自动进入起动过程
        this._autoStart();

        // 起动过程：起动空气转车（约 3 s，转速由 0 平顺升到 ~12 rpm，不出现 10 rpm 平台）
        if (this.starting) {
            this.startTimer += dt;
            this.startAir = Math.max(18, this.startAir - dt * 2.2);
            if (this.startTimer > (this.slowTurning ? START_DURATION + (this.slowTurnDurS || 10) : START_DURATION)) {
                this.starting = false;
                this.mainStartValveOpen = false;
                this.running = true;
                this.rpm = this._startDir >= 0 ? Math.max(this.rpm, 12) : Math.min(this.rpm, -12);
            }
        } else {
            // 起动空气由空压机补气
            if (this.startAir < 28.3) this.startAir = Math.min(28.3, this.startAir + dt * 0.55);
        }

        // ① 限制链路：由车令 rpmCmd 计算受限的 SETP（加速率 / 负荷程序 / 临界区避让 …）
        this._stepSetp(dt);

        if (this.starting) {
            // 起动空气转车阶段：按起动方向平顺转到约 ±12 rpm（不跟随燃油给定，也不长时间停滞）
            const turn = (this._startDir || 1) * 12;
            this.rpm += (turn - this.rpm) * Math.min(1, dt * 1.2);
        } else {
            // ①5 静止且未起动：不自行升速（必须由起动程序用起动空气转起来）
            const atRest = !this.running && Math.abs(this.rpm) < 1;
            if (atRest) {
                this.rpm = 0;
            } else {
            // ② 主机转速追随 SETP（慢降时目标受限）
            let target = this.setp;
            if (this.slowDown && !this.cancelSLD) target = Math.min(target, target > 0 ? 40 : target);
            if (this.shutDown && !this.cancelSHD) target = 0;
            // 速率（rpm/s）：停车动作 55；其余按主机惯性最快变化率（≈4.53 → 68→0 约 15 s）
            const rate = this.shutDown ? 55 : (this.inertiaRate || 68 / 15);
            const diff = target - this.rpm;
            if (Math.abs(diff) > 0.2) {
                this.rpm += clamp(diff, -rate * dt, rate * dt);
            } else {
                this.rpm = target;
            }
            }
        }
        // 不再把 rpm 取整到 0.1：惯性速率很慢（约 4.53 rpm/s），每帧取整会累积掉速
        if (Math.abs(this.rpm) < 0.05) this.rpm = 0;

        // 负荷随转速（22 % + 0.9 × |rpm|，上限 105 %；负荷限制时封顶 80 %）
        // 倒车同样按转速绝对值计负荷：反向转速越大，负荷越大
        const cap = (this.loadLimit && !this.cancelLimits) ? 80 : 105;
        const absRpm = Math.abs(this.rpm);
        const tLoad = absRpm > 0.5 ? Math.min(cap, 22 + absRpm * 0.9) : 0;
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
