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

// ── 盘车机（Turning Gear）参数 ──────────────────────────────
const TG_FREE_CURRENT = 6;      // 盘车机脱开、空转时的电机电流（A）
const TG_LOAD_CURRENT = 92;     // 盘车机合上、带动主机时的电机电流（A）
const TG_JOG_RPM = 4;           // 盘车机带主机时的主机转速（很低）
const TG_CURRENT_TAU = 0.25;    // 电流变化时间常数（s）

// ── 机旁起动旋钮（冲车 / 自动 / 慢转） ──────────────────────
const BLOW_RPM = 20;            // 冲车：用起动空气把主机转到 20 rpm 并保持
const BLOW_RATE = 2;            // 冲车加速率（rpm/s）
const SLOWTURN_RPM = 5;         // 慢转起动：很低的转速
const SLOWTURN_RATE = 2;        // 慢转升速率（rpm/s）

/** 应急倒车判定：车钟从 NAV FULL 直接拉到该值及以下（倒车全速 −51 / EM'CY ASTERN −55）即触发 */
const CRASH_ASTERN_TO = -50.5;

/** 安保 / 减速动作的报警文案（按测点 id；照真机写法 L.O. 后不空格） */
const SAFETY_TEXT = {
    'ME-LO-PR-SW': 'MAIN L.O. LOW-LOW PRESS',
    'CW-PS': 'JACKET C.F.W. INLET PRESS LOW',
    'CW-T': 'JACKET C.F.W. OUTLET TEMP HIGH',
    'ME-LO-T': 'MAIN L.O.INLET TEMP HIGH',
    'ME-MIST': 'OIL MIST HIGH IN CRANKCASE',
    'ME-GEN-SAIR': 'START AIR PRESS LOW',
    'ME-CW-T': 'J.C.F.W. OUTLET TEMP HIGH',
    'ME-FO-P': 'MAIN FUEL OIL PRESS LOW',
    'MANUAL-SLD': 'MANUAL SLOW DOWN',
};
function safetyText(tagId) {
    return SAFETY_TEXT[tagId] || String(tagId || '').replace(/-/g, ' ').toUpperCase();
}

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
const VALVE_STROKE = 1;     // 主起动阀 / 慢转起动阀 开、关行程时间（s）：阀开到位后主机才开始升速
const FIRE_RPM = 25;        // 发火转速（rpm）：转速升到该值以上，起动电磁阀 A 才失电

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
        this.sldPre = null;
        this.sldCancelled = false;
        this.transferReq = null;
        this._osTestArmed = true;
        this._osLevelTrip = null;          // 实际转速超过 Overspeed Level 锁存的动作值
        this.cancelAlarmOn = { shd: false, sld: false, lim: false };
        this._restTime = 0;
        this._cmdHold = 0;
        this._lastCmdVal = this.rpmCmd;
        this._startDir = 1;
        this.crashAsternOn = false;
        this._navFullAt = 0;
        this.overspeedTripped = false;
        this.emStopped = false;
        this.emStopLatched = false;
        this.emStopBy = null;
        this.localSpeed = 0;               // 机旁调速手柄回 STOP
        this.modeReq = null;
        this.mistHigh = false;             // 曲轴箱油雾浓度高（故障设置注入）→ 延时后自动减速
        this._mistSldT = 0;                // 油雾浓度高累计时长（s）
        this._mistPre = false;             // 油雾高预报警已发出
        this._mistSld = false;             // 油雾高已触发自动减速
        this.turningGearPower = true;
        this.turningGearJog = 0;
        this.turningGearMode = 'REMOTE';
        this.delays = {
            'shd-thrust': 6, 'shd-tclo': 6, 'shd-jcw': 6,
            'sld-lo-t': 6, 'sld-cw-t': 6, 'sld-mist': 6,
        };
        this.shdResetArmed = false;
        this._shdStopAck = false;
        this.startKnob = 'AUTO';
        this._airTurn = false;
        this._startAOn = false;
        this.tgCurrent = 0;
        this._tgDriven = false;
        this.turningGearOut = true;        // 盘车机默认脱开（合上需在气动操纵系统操作）
        if (this.overspeedTest) {
            this.overspeedTest.simOn = false;
            this.overspeedTest.osTestOn = false;
            this.overspeedTest.msg = '';
            this.overspeedTest.msgUntil = 0;
        }
        // ── 默认初始状态：停车待命（机旁控制、三处车钟 STOP、气动系统未备车）──
        //    主起动阀阻塞 / 空气分配器锁闭 / 控制空气不导通由气动操纵系统组件同步（_syncStartBlock）
        this.controlPos = CONTROL_POS.LOCAL;   // 默认控制权在机旁
        this.engineMode = 'FWE';           // 副车钟默认 FWE（主机已经完车，主起动阀与空气分配器均不在工作位）
        this.runMode = 'ECONOMY';          // Engine Running Mode：ECONOMY 经济模式 / EMISSION 排放模式
        // 各控制位置的车钟（互相独立）：BRIDGE / ECR / LOCAL —— 默认全部在 STOP
        const STOP_RPM = TELEGRAPH[5].rpm;        // STOP 档（索引 5）
        this.leverRpm = { BRIDGE: STOP_RPM, ECR: STOP_RPM, LOCAL: STOP_RPM };
        this.leverIdx = 5;                  // 当前控制位置（机旁）车钟档位：STOP
        this.leverPos = 5;                  // 当前控制位置车钟的连续位置（0 = NAV FULL，10 = EM'CY ASTERN）
        this.rpmCmd = 0;                    // 车令 = STOP
        this.setp = 0;
        this.rpm = 0;                       // 主机停车
        this.load = 0;                      // 无负荷

        this.startAir = 28.3;
        this.controlAir = 7.0;
        this.hydOil = 280;

        this.running = false;               // 默认主机停车（点「启动系统」后进入全速运行）
        this.starting = false;
        this.startTimer = 0;
        this.startFail = false;
        this.startBlocked = true;           // 未备车：主起动阀阻塞 / 空气分配器锁闭 / 控制空气不导通

        this.slowDown = false;
        this.slowDownReq = false;
        this.shutDown = false;

        this.cancelSHD = false;
        this.cancelSLD = false;
        this.cancelLimits = false;

        this.loadLimit = false;
        this.loadLimitUp = false;

        this.auxBlower = false;
        this.auxBlowerAlarm = false;

        // 辅助鼓风机 / 液压动力泵（ME 主机页电机控制盒）—— 默认电源 ON、遥控方式
        this.blowerPower = true;
        this.blowerMode = 'REMOTE';
        this.blowerCmdRun = false;
        this.blowerRun = false;          // 由 _stepAuxMachines() 按扫气压力决定
        this.blowerOverload = false;
        this.hpsPower = true;
        this.hpsMode = 'REMOTE';
        this.hpsCmdRun = false;
        this.hpsRun = true;              // 主机停止 → 电动泵提供液压动力
        this.hpsOverload = false;
        this.engPumpOk = false;
        this.scavOkPress = false;
        this.scavPressMPa = 0.001;    // 扫气箱空气压力（MPa）

        this.turningGearOut = true;         // 盘车机已脱开
        this.airDistributorOk = false;      // 空气分配器锁闭（不在工作位）
        this.mainStartValveOk = false;      // 主起动阀阻塞（不在工作位）
        this.controlAirVented = true;       // 控制空气不导通（控制气源阀在卸放位）
        this.engineReady = false;           // 未备车（状态条 Eng. Not Ready）

        this.wrongWay = false;
        this.mainStartValveOpen = false;    // 主起动阀开启（起动过程中）
        this.slowTurning = false;

        // 应急停车按钮（自锁型）与玻璃盖
        this.emStopLatched = false;    // 按钮按下并保持
        this.emStopped = false;        // 机旁紧急停车动作中（切断燃油；不等于安保"停车激活" shutDown）
        this.emStopBy = null;          // 触发紧急停车的开关位置：BRIDGE / ECR / LOCAL
        this.localSpeed = 0;           // 机旁调速手柄（大表盘）位置：只给转速，不动车钟 leverRpm.LOCAL
        this.modeReq = null;           // 副车钟（工况）切换请求 { to, by }：驾驶台/集控室互发，机旁只显示
        this.turningGearPower = true;  // 盘车机控制箱电源（与盘车机脱开/合上无关）
        this.turningGearJog = 0;       // 盘车机点动方向：1 正转 / -1 倒转 / 0 停机（松开即停）
        this.turningGearMode = 'REMOTE';   // 控制方式：REMOTE = 遥控盒操作 / LOCAL = 机旁控制箱操作
        // Param. Change → Safety：自动停车 / 自动减速各 3 项的延时（s），默认 6 s
        this.delays = {
            'shd-thrust': 6, 'shd-tclo': 6, 'shd-jcw': 6,
            'sld-lo-t': 6, 'sld-cw-t': 6, 'sld-mist': 6,
        };
        this.shdResetArmed = false;        // 安保停车待复位（原因消失后把车钟拉回 STOP 即复位）
        this._shdStopAck = false;          // 停车后车钟被人工拉回 STOP（自动停车产生的 rpmCmd=0 不算）
        this.startKnob = 'AUTO';           // 机旁起动旋钮：BLOW 冲车 / AUTO 自动 / SLOW 慢转起动
        this._startAOn = false;            // 起动电磁阀 A 保持得电（起动全过程 → 到发火转速才失电）
        this._airTurn = false;             // 是否正由起动空气带转（冲车 / 慢转）
        this.tgCurrent = 0;            // 盘车机电机电流（A）：不转 0 / 脱开空转很小 / 合上带主机很大
        this._tgDriven = false;        // 本轮是否由盘车机带动主机转动
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
        this.setp = this.rpmCmd;     // 实际送到调速器的转速给定（受各类限制约束）
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
        this.sldPre = null;              // 慢降预报警（延时未到 → 主面板弹出可取消提示框）
        this.sldCancelled = false;       // Cancel SLD 在本轮"未触发的减速"上生效（暂停；释放后重新预报警）
        this.autoCancelLimits = false;   // 系统自动越控（应急倒车）→ 控制权面板指示灯自动点亮
        this.transferReq = null;         // 控制权转移请求 { from, to }（转移期间目标位置灯闪烁、蜂鸣器报警）
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

    /**
     * 「启动系统」的重工况：**直接进入海上全速运行状态**（不经过起动过程）。
     *   · 气动侧（主起动阀工作 / 空气分配器工作 / 控制空气导通）由 `Ac600PneumaticSystem` 的
     *     `setBlock(false)` / `setTwoWay('mv2a', false)` / `setThreeWay('b', false)` 恢复；
     *   · 本方法负责遥控侧：控制权在驾驶台、三处车钟 NAV FULL、机旁调速手柄全速、主机稳定全速运行。
     */
    startSystem() {
        const NAV_FULL = TELEGRAPH[0].rpm;         // NAVIGATION FULL（68 rpm）
        // ① 备车条件：主起动阀 / 空气分配器在工作位、控制空气导通、盘车机脱开
        this.mainStartValveOk = true;
        this.airDistributorOk = true;
        this.controlAirVented = false;
        this.turningGearOut = true;
        this.startFail = false;
        this.startBlocked = false;
        this.engineReady = true;

        // ② 控制权与车钟：驾驶台控制，三处车钟 / 机旁调速手柄都在全速
        this.controlPos = CONTROL_POS.BRIDGE;
        this.transferReq = null;
        this.engineMode = 'SEA';
        this.leverRpm = { BRIDGE: NAV_FULL, ECR: NAV_FULL, LOCAL: NAV_FULL };
        this.localSpeed = NAV_FULL;
        this.leverIdx = 0;
        this.leverPos = 0;
        this.rpmCmd = NAV_FULL;
        this.setp = NAV_FULL;
        this.rpm = NAV_FULL;
        this.load = 22 + NAV_FULL * 0.9;

        // ③ 运行状态与各种锁存／报警全部清零
        this.running = true;
        this.starting = false;
        this.startTimer = 0;
        this.startAir = 28.3;
        this.mainStartValveOpen = false;
        this.slowTurning = false;
        this._airTurn = false;
        this._startAOn = false;
        this.startKnob = 'AUTO';
        this.stoppedTime = 0;
        this._restTime = 1;
        this._cmdHold = 1;
        this._lastCmdVal = this.rpmCmd;

        this.shutDown = false;
        this.slowDown = false;
        this.slowDownReq = false;
        this.sldCauses = {};
        this.sldAwaitReset = false;
        this.sldPre = null;
        this.sldCancelled = false;
        this.loLowLowShd = false;
        this.jcwLowShd = false;
        this.overspeedTripped = false;
        this._osTestArmed = true;
        this._osLevelTrip = null;
        this.emStopped = false;
        this.emStopLatched = false;
        this.emStopBy = null;
        this.emStopCoverOpen = false;

        this.cancelSHD = false;
        this.cancelSLD = false;
        this.cancelLimits = false;
        this.autoCancelLimits = false;
        this.cancelSHDBy = { BRIDGE: false, ECR: false, LOCAL: false };
        this.cancelSLDBy = { BRIDGE: false, ECR: false, LOCAL: false };
        this.cancelLimBy = { BRIDGE: false, ECR: false, LOCAL: false };
        this.cancelAlarmOn = { shd: false, sld: false, lim: false };
        this.shdResetArmed = false;
        this._shdStopAck = false;
        this._blkAlarm = true;

        this.loadLimit = false;
        this.loadLimitUp = false;
        this.activeLimiter = '';
        this.crashAsternOn = false;

        this.mistHigh = false;                     // 曲轴箱油雾浓度高（故障）清除
        this._mistSldT = 0;
        this._mistPre = false;
        this._mistSld = false;

        // 辅助鼓风机 / 液压动力泵：回到遥控自动（主机全速 → 鼓风机停、电动泵停、机带泵供压）
        this.blowerPower = true;
        this.blowerMode = 'REMOTE';
        this.blowerCmdRun = false;
        this.blowerOverload = false;
        this.hpsPower = true;
        this.hpsMode = 'REMOTE';
        this.hpsCmdRun = false;
        this.hpsOverload = false;
        this.hydOil = 280;

        this.alarm = false;
        this.alarmText = '';
        this.messages = [];
        this.silenced = false;
        this.acked = true;

        if (this.overspeedTest) {
            this.overspeedTest.simOn = false;
            this.overspeedTest.osTestOn = false;
            this.overspeedTest.msg = '';
            this.overspeedTest.msgUntil = 0;
        }
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
        if (this._airTurn) return (this.startKnob === 'BLOW') ? 'Blowing' : 'Slow Turning';
        if (this.emStopped) return 'Emergency Stop';
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
    /**
     * 请求把控制权转移到 to（由**当前控制位置**的面板按下目标位置按钮触发）。
     * 再次按同一目标 → 取消请求（控制权留在原位置）。
     */
    requestTransfer(to) {
        if (!to) return false;
        if (to === this.controlPos) { this.transferReq = null; return false; }
        if (this.transferReq && this.transferReq.to === to) { this.transferReq = null; return false; }
        this.transferReq = { from: this.controlPos, to, by: 'give' };
        return true;
    }

    /**
     * 控制位置转移：某面板按下某个位置键。
     * @param me  本面板所在位置（BRIDGE / ECR / LOCAL）
     * @param pos 被按下的位置键
     * @returns 'give'|'take'|'ok'|'mismatch'|'cancel'|'blocked'|'none'
     *
     * 规则：
     *  · 驾驶台 ↔ 集控室：双向自由 —— 控制位置面板按对方位置 = GIVE 请求；对方面板按自己位置 = TAKE 请求；
     *    另一方按自己位置键确认（GIVE 请求 → 目标 TAKE；TAKE 请求 → 原控制位置 GIVE）。
     *  · 集控室 ↔ 机旁：控制权在集控室时，集控室按 Local = GIVE、机旁按 Local = TAKE 都有效；
     *    控制权在机旁时，**其它位置按自己的键 TAKE 无效**，只能由机旁按键 GIVE。
     */
    pressPosButton(me, pos) {
        const from = this.controlPos;
        const req = this.transferReq;
        if (!pos) return 'none';

        // ① 已有请求：判断是否是"确认 / 取消"
        if (req && req.to === pos) {
            if (req.by === 'give' && me === req.to) return this._finishTransfer(req) ? 'ok' : 'mismatch';
            if (req.by === 'take' && me === req.from) return this._finishTransfer(req) ? 'ok' : 'mismatch';
            // 发起方再按一次同一目标 → 取消
            if ((req.by === 'give' && me === req.from) || (req.by === 'take' && me === req.to)) {
                this.transferReq = null;
                return 'cancel';
            }
            return 'none';
        }

        // ② 按自己当前控制位置：取消请求或无事
        if (pos === from) {
            if (req) { this.transferReq = null; return 'cancel'; }
            return 'none';
        }

        // ③ 发起请求
        if (me === from) {                       // 控制位置面板 → 交出（GIVE）
            this.transferReq = { from, to: pos, by: 'give', me };
            return 'give';
        }
        if (me === pos) {                        // 目标位置面板 → 要权（TAKE）
            if (from === CONTROL_POS.LOCAL) return 'blocked';   // 机旁控制时只能由机旁交出
            this.transferReq = { from, to: pos, by: 'take', me };
            return 'take';
        }
        return 'none';
    }

    /** 完成转移（校验车钟一致） */
    _finishTransfer(req) {
        const to = req.to;
        const ref = this.leverRpm[req.from];
        const ok = (to === CONTROL_POS.LOCAL)
            ? this.localCompatible            // 机旁为按键式车钟：按档位相容规则，不要求连续一致
            : Math.abs((this.leverRpm[to] ?? ref) - ref) <= 1;
        if (!ok) return false;
        this.transferReq = null;
        this.setControlPos(to);
        return true;
    }

    /**
     * 目标位置面板按自己的位置按钮 → 确认接管。
     * 要求两边车钟一致（≤1 rpm），否则不接管（继续闪烁、蜂鸣器继续响）。
     */
    confirmTransfer(to) {
        const req = this.transferReq;
        if (!req || req.to !== to) return false;
        if (req.by === 'take') return this._finishTransfer(req);   // 原控制位置 GIVE 确认
        const ref = this.leverRpm[req.from];
        const ok = (to === 'LOCAL')
            ? this.localCompatible            // 机旁为按键式车钟：按档位相容规则，不要求连续一致
            : Math.abs((this.leverRpm[to] ?? ref) - ref) <= 1;
        if (!ok) return false;
        this.transferReq = null;
        this.setControlPos(to);          // 内部会把当前给定写入新位置手柄（LEVER 不跳变）
        return true;
    }

    cancelTransfer() { this.transferReq = null; }

    /** 车令 → 最近档位索引（0 = NAV FULL … 5 = STOP … 10 = EM'CY ASTERN） */
    _idxOf(rpm) {
        let best = 0, bd = Infinity;
        TELEGRAPH.forEach((t, i) => {
            const d = Math.abs(t.rpm - (rpm == null ? 0 : rpm));
            if (d < bd) { bd = d; best = i; }
        });
        return best;
    }

    /**
     * 机旁（按键式车钟）与 ECR 的档位相容：
     *   · ECR 在 STOP → 机旁必须也在 STOP；
     *   · ECR 不在 STOP → 机旁当前档位与 ECR 档位相差不超过 2 档。
     */
    get localCompatible() {
        const STOP_IDX = TELEGRAPH.findIndex((t) => t.rpm === 0);
        const iEcr = this._idxOf(this.leverRpm.ECR);
        const iLoc = this._idxOf(this.leverRpm.LOCAL);
        if (iEcr === (STOP_IDX < 0 ? 5 : STOP_IDX)) return iLoc === iEcr;
        return Math.abs(iEcr - iLoc) <= 2;
    }

    /** 各位置车钟是否一致（与"主车钟"=控制位置比较，>1 rpm 视为不一致） */
    get leverMismatch() {
        const ref = this.leverRpm[this.controlPos];
        return ['BRIDGE', 'ECR', 'LOCAL'].some((k) => k !== this.controlPos
            && Math.abs((this.leverRpm[k] ?? ref) - ref) > 1);
    }

    /**
     * 车钟报警蜂鸣器：
     *   · 正在转移控制位置 → 响；
     *   · 控制权在 ECR：**ECR 与驾驶台车令相差 > 1 rpm** 才响（与机旁无关）；
     *   · 控制权在 LOCAL：按"机旁按键式"相容规则（ECR 在 STOP 时机旁必须 STOP；
     *     不在 STOP 时档位差 ≤ 2 档），不相容才响；
     *   · 控制权在驾驶台：不响。
     */
    /**
     * 蜂鸣器：**只有车钟操作 / 控制权转换 / 副车钟操作**（条件满足时）才鸣响，其它报警一律不触发。
     *  · 控制权转换进行中 → 响；
     *  · 控制权在 ECR：ECR 与驾驶台车钟差 > 1 rpm → 响（车钟不一致）；
     *  · 控制权在 LOCAL：按机旁按键式车钟相容规则（`localCompatible`）→ 不相容则响；
     *  · 控制权在驾驶台：不响。
     */
    get buzzerOn() {
        if (this.transferReq) return true;
        if (this.modeReq) return true;                     // 副车钟（工况）请求待回令
        if (this.controlPos === 'ECR') {
            return Math.abs(this.leverRpm.ECR - this.leverRpm.BRIDGE) > 1;
        }
        if (this.controlPos === 'LOCAL') return !this.localCompatible;   // 副车钟（机旁按键式车钟）不相容
        return false;                     // 驾驶台控制：不响
    }

    setControlPos(pos) {
        if (!pos || this.controlPos === pos) return false;
        this.controlPos = pos;
        this.forceTake = false;
        this.lastOpPos = pos;
        // 无扰转移：新位置手柄对齐当前给定（LEVER 不跳变），此后只有该位置的车钟能改变 LEVER
        if (this.leverRpm) this.leverRpm[pos] = this.rpmCmd;
        // 机旁调速手柄**不跟随控制权转移自动变化**，必须人工拖动（保持原位置）
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
     * `noCmd = true` 时只移动手柄、不改写主机给定（机旁 11 档车钟"只对车令"用）。
     */
    setLeverAt(rpm, where, noCmd) {
        const w = where || this.controlPos;
        const top = TELEGRAPH[0].rpm;
        const bottom = TELEGRAPH[TELEGRAPH.length - 1].rpm;
        const val = Math.round(clamp(rpm, bottom, top) * 10) / 10;
        this.leverRpm[w] = val;
        this.lastOpPos = w;
        if (w === this.controlPos && !noCmd) {
            this._syncCmdFromLever();
            this._checkCrashAstern(val);
            if (Math.abs(this.rpmCmd) < 0.5) this._shdStopAck = true;   // 人工把车钟拉回 STOP
        }
        return val;
    }

    /**
     * 副车钟（航行工况）能否切到 mode：
     *  · SEA     —— 驾驶台车钟已在 **NAV FULL**；
     *  · STANDBY —— 主机**已停车**（|rpm| < 1 且未运行）；
     *  · FWE     —— **主起动阀与空气分配器都关闭**。
     */
    canSelectMode(mode) {
        if (mode === 'SEA') return Math.round(this.leverRpm.BRIDGE) === TELEGRAPH[0].rpm;
        if (mode === 'STANDBY') return true;   // 机动备车：本仿真不要求主机停车（演示中满速也可转备车）
        if (mode === 'FWE') return !this.mainStartValveOk && !this.airDistributorOk;
        return false;
    }

    /**
     * 副车钟（工况）切换：**只在驾驶台与集控室之间**进行，机旁只显示不参与。
     *  · 任一方按下工况按钮 → 发出请求（`modeReq`），另一方按同一工况 → 回令后生效（常亮）；
     *  · 按当前已生效的工况 → 取消请求；
     *  · 条件不满足（见 canSelectMode）→ 不受理，返回 'blocked'。
     * @returns 'req' | 'ok' | 'cancel' | 'blocked' | 'none'
     */
    requestEngineMode(mode, by) {
        if (!mode) return 'none';
        const who = (by === CONTROL_POS.ECR) ? CONTROL_POS.ECR : CONTROL_POS.BRIDGE;
        const req = this.modeReq;
        // 回令：对方按下同一工况
        if (req && req.to === mode && req.by !== who) {
            if (!this.canSelectMode(mode)) return 'blocked';
            this.engineMode = mode;
            this.modeReq = null;
            return 'ok';
        }
        // 再按一次同一请求 → 取消
        if (req && req.to === mode && req.by === who) { this.modeReq = null; return 'cancel'; }
        // 按当前工况 → 取消请求
        if (mode === this.engineMode) { if (req) { this.modeReq = null; return 'cancel'; } return 'none'; }
        if (!this.canSelectMode(mode)) return 'blocked';
        this.modeReq = { to: mode, by: who };
        return 'req';
    }

    /**
     * 手动降速请求（机旁矩阵「手动降速请求」）：**与自动减速完全同一套动作** ——
     * 置 `slowDown`、减速到 40 rpm、报警栏 `MANUAL SLOW DOWN, SLOWDN` + `SLOWDOWN ACTIVE, ACTIVE`；
     * 撤销时按 `safetyClear` 恢复（锁存，车钟拉到 40 rpm 以下才复位）。
     */
    setManualSlowDown(on) {
        this.slowDownReq = !!on;
        if (on) {
            this.safetyAction('SLD', 'MANUAL-SLD');
        } else {
            this.sldCauses = this.sldCauses || {};
            if (this.sldCauses['MANUAL-SLD']) this.safetyClear('SLD', 'MANUAL-SLD');
        }
        return this.slowDownReq;
    }

    /**
     * 机旁调速手柄（大表盘）：**只给转速、不动车钟**（`leverRpm.LOCAL` 保持不动）。
     * 只有控制权在机旁时才改写主机给定 `rpmCmd`；否则仅记录手柄位置。
     */
    setLocalSpeed(rpm) {
        const top = TELEGRAPH[0].rpm;
        const bottom = TELEGRAPH[TELEGRAPH.length - 1].rpm;
        const val = Math.round(clamp(rpm, bottom, top) * 10) / 10;
        this.localSpeed = val;
        this.lastOpPos = CONTROL_POS.LOCAL;
        if (this.controlPos === CONTROL_POS.LOCAL) {
            this.rpmCmd = val;
            let best = 0, bd = Infinity;
            TELEGRAPH.forEach((t, i) => {
                const d = Math.abs(t.rpm - val);
                if (d < bd) { bd = d; best = i; }
            });
            this.leverIdx = best;
            this.leverPos = rpmToPos(val);
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
        const rpm = (w === CONTROL_POS.LOCAL)
            ? this.rpmCmd            // 机旁：给定保持不变，手柄由人工操作后再改写给定
            : ((this.leverRpm && this.leverRpm[w] !== undefined) ? this.leverRpm[w] : this.rpmCmd);
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

    /**
     * 直接设定档位（按档位名）。
     * `noCmd = true` 时只动本位置手柄，**不改写主机给定**（机旁车钟纯对车令）。
     */
    setLeverById(id, where, noCmd) {
        const i = TELEGRAPH.findIndex(t => t.id === id);
        if (i < 0) return false;
        const w = where || this.controlPos;
        this.leverRpm[w] = TELEGRAPH[i].rpm;
        this.lastOpPos = w;
        if (w === this.controlPos && !noCmd) {
            this._checkCrashAstern(TELEGRAPH[i].rpm);
            this.rpmCmd = TELEGRAPH[i].rpm;
            this.leverIdx = i;
            this.leverPos = i;
            if (Math.abs(this.rpmCmd) < 0.5) this._shdStopAck = true;   // 人工把车钟拉回 STOP
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
        this.cancelLimBy = { BRIDGE: false, ECR: false, LOCAL: false };
        this.autoCancelLimits = true;      // 系统自动越控：仅点亮控制权面板的 Cancel Limits 指示灯
        this.activeLimiter = '';
        this._navFullAt = 0;
        return true;
    }

    /**
     * 车钟在 NAV FULL ↔ EM'CY ASTERN 之间的"直接放车"检测：
     * 记下最近一次停在 NAV FULL 的时刻，若 3 s 内直接落到 EM'CY ASTERN → 触发 crashAstern()。
     */
    _checkCrashAstern(val) {
        const topR = TELEGRAPH[0].rpm;                       // NAV FULL = 68
        // 倒车全速（FULL ASTERN = −51）及更下（EM'CY ASTERN = −55）都算
        if (val >= topR - 0.5) { this._navFullAt = Date.now(); return; }
        if (val <= CRASH_ASTERN_TO && this._navFullAt && Date.now() - this._navFullAt < 3000) {
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
        if (this.emStopped) { this.raiseAlarm('机旁紧急停车未复位，禁止起动'); this.startBlocked = true; return false; }
        if (!this.turningGearOut) { this.raiseAlarm('盘车机未脱开，禁止起动'); this.startBlocked = true; return false; }
        if (!this.airDistributorOk) { this.raiseAlarm('空气分配器不在工作位，禁止起动'); this.startBlocked = true; return false; }
        if (!this.mainStartValveOk) { this.raiseAlarm('主起动阀不在工作位，禁止起动'); this.startBlocked = true; return false; }
        if (this.controlAirVented) { this.raiseAlarm('控制空气未导通，禁止起动'); this.startBlocked = true; return false; }
        if (this.startAir < 15) { this.raiseAlarm('起动空气压力过低，不能起动'); this.startBlocked = true; return false; }
        this.startBlocked = false;
        this.starting = true;
        this._startDir = this.rpmCmd >= 0 ? 1 : -1;                // 倒车车令 → 反向起动
        // 试验只在停机状态进行：一旦起动，自动结束超速保护试验
        if (this.overspeedTest) { this.overspeedTest.simOn = false; this.overspeedTest.osTestOn = false; }
        this.slowTurning = !!slow;
        this.startTimer = 0;
        this.mainStartValveOpen = true;
        this._startAOn = true;                                     // 起动电磁阀 A 得电（到发火转速才失电）
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

        // 最低稳定运行转速（MSRS）：车令不是 0、但低于该值时，**调速器输出给定保持在最低稳定转速**
        //   · 车令 = 0（STOP）仍给 0 → 主机停车，不受此限
        //   · 正/倒车对称（−5 rpm 的车令同样给到 −21 rpm）
        //   · **只在主机已起动成功、开始点火后才生效**：冲车 / 慢转（起动空气带转）与盘车机带转不遵循
        const msrsActive = !this._airTurn && !this._tgDriven && (this.running || this.starting);
        const steadyMin = Math.abs(L.steadyMin ?? 21);
        if (msrsActive && Math.abs(target) > 0.5 && Math.abs(target) < steadyMin) {
            target = Math.sign(target) * steadyMin;
            if (!why) why = 'Min. Speed';
        }

        // 慢降（自动减速）：给定压到 40 rpm，并按减速度限制快速下降（不走 Load Down 程序）
        if (this.slowDown) {
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
        const txt = safetyText(tagId);
        if (kind === 'SLD') {
            this.sldCauses = this.sldCauses || {};
            this.sldCauses[tagId] = txt;
            this.slowDown = true;
            this.cancelSLD = false;
            this.sldPre = null;                       // 预报警转为实际动作，撤掉弹窗
            this.alarm = true;
            this.acked = false;
            this.silenced = false;
            this.alarmText = `${txt}, SLOWDN`;
            // 报警栏两行：动作原因在上、SLOWDOWN ACTIVE 在下
            this.messages = [`${txt}, SLOWDN`, 'SLOWDOWN ACTIVE, ACTIVE'];
            return;
        }
        // SHD：燃油切断、主机停车（与超速停车同样的表现）
        this.shutDown = true;
        this.shdResetArmed = true;                 // 待复位：车钟拉回 STOP 即解除
        this._shdStopAck = false;
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
     * 慢降预报警：温度越限、但 6 s 安保延时尚未到 —— 主面板弹出可取消提示框。
     * 延时内温度回落或按 Cancel SLD 越控即取消，不会真的减速。
     */
    sldPreAlarm(tagId) {
        const txt = safetyText(tagId);
        this.sldPre = { tagId, text: txt };
        this.alarm = true;
        this.acked = false;
        this.silenced = false;
        this.alarmText = `${txt}, SLOWDN`;
        this.pushMessage(`${txt}, SLOWDN`);
    }

    /** 预报警取消（温度回落）：已应答则清除，未应答转 NORMAL */
    sldPreAlarmClear(tagId) {
        if (!this.sldPre || (tagId && this.sldPre.tagId !== tagId)) return;
        const txt = this.sldPre.text;
        this.sldPre = null;
        if (!this.alarm) return;
        if (this.acked) {
            this.messages = (this.messages || []).filter((m) => !m.startsWith(txt));
            if (!this.messages.length) this.alarm = false;
        } else {
            this.messages = (this.messages || []).map((m) => (m.startsWith(txt) ? `${txt}, NORMAL` : m));
        }
        this.alarmText = this.messages[0] || '';
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
        // 报警信息随故障恢复处理：**该条报警直接复位**（不论是否已应答）
        //   温度/压力回到正常 → 报警栏里这条信息立刻消失（不再保留 ", NORMAL" 的红字记忆）；
        //   历史记录在 Alarm History 里仍保留（面板 _histRows 会把它标成绿色 NORMAL）。
        if (this.alarm || (this.messages || []).length) {
            this.messages = (this.messages || []).filter((m) => !m.startsWith(txt));
            if (!this.messages.length) this.alarm = false;
            this.alarmText = (this.messages[0] || '');
        }
        this.sldCancelled = false;
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
            const L = this._osLevelTrip;
            const byLevel = !!L && !(T.simOn && T.osTestOn && T.simRpm > T.osTestRpm);
            T.msg = byLevel
                ? `超速保护动作：实际转速 ${L.rpm.toFixed(1)} rpm 超过 Overspeed Level ${L.level.toFixed(1)} rpm`
                : `超速保护动作：模拟转速 ${T.simRpm.toFixed(1)} rpm 超过试验值 ${T.osTestRpm.toFixed(1)} rpm`;
            T.msgUntil = Date.now() + 10000;
        }
    }

    /** 手柄自动起动（推手柄离开 STOP 即自动起动，含联锁检查） */
    _autoStart() {
        if (this.emStopped) return;                                // 机旁紧急停车中：禁止自动起动
        const wants = Math.abs(this.rpmCmd) > 0.5;
        if (!wants) {
            // 手柄回 STOP：中止尚未完成的起动
            if (this.starting) {
                this.starting = false;
                this.mainStartValveOpen = false;
                this.startTimer = 0;
                this._startAOn = false;
            }
            return;
        }
        if (this.running || this.starting) return;
        if (this._restTime < 0.3) return;                          // 刚过零/正在换向：不重复起动
        if (this._cmdHold < 0.4) return;                           // 车钟还在拖动（车令连续变化）：等把手柄放稳再起动
        if (this.shutDown && !this.cancelSHD) return;              // 停车动作中
        if (!this.turningGearOut || !this.airDistributorOk || !this.mainStartValveOk
            || this.controlAirVented || this.startAir < 15) {
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
        this._startAOn = true;                                     // 起动电磁阀 A 得电（到发火转速才失电）
    }

    /** 玻璃盖：按一次上翻打开，再按一次翻下遮住 */
    toggleEmStopCover() {
        this.emStopCoverOpen = !this.emStopCoverOpen;
        return this.emStopCoverOpen;
    }

    /**
     * 机旁应急停车按钮（自锁）：
     *  · 盖打开时**按下 → 机旁紧急停车**（切断燃油立即停车，`emStopped = true`）；
     *  · **再按一次（弹出）→ 解除紧急停车**（报警清除，可重新起动）。
     * ⚠ 与安保系统的「停车激活」(`shutDown`，故障自动停车) **完全无关**：本动作不置 `shutDown`。
     */
    pressEmStop(by) {
        if (!this.emStopCoverOpen) return false;   // 玻璃盖遮住时不可操作
        if (this.emStopLatched) {
            // 弹出：**只复位按钮本身**。报警与停车保持 —— 必须由控制权面板把车钟拉回 STOP 才能复位（见 solve()）
            this.emStopLatched = false;
            return false;
        }
        this.emStopLatched = true;
        this.emStopBy = by || this.controlPos;     // 记录是哪个面板的急停开关动作
        this.localEmergencyStop();                 // 按下：紧急停车
        return true;
    }

    /**
     * 机旁紧急停车：燃油切断、立即停车。不置 shutDown（不点亮"停车激活"）。
     * ⚠ **不动车钟 / 给定**（`rpmCmd`、`leverRpm` 保持不变），因此对手动调速手柄没有任何影响。
     */
    localEmergencyStop() {
        this.emStopped = true;
        this._emResetHold = 0;                     // 复位计时清零
        this.starting = false;
        this.mainStartValveOpen = false;
        this.engineReady = false;                  // 状态条 Eng. Not Ready
        this.startBlocked = true;                  // Engine State：Start Blocked / START FAIL/BLOCK
        this.alarm = true;
        this.acked = false;
        this.silenced = false;
        const where = this.emStopBy || this.controlPos;
        this.alarmText = `EMERGENCY STOP SWITCH ${where}, ACTIVE`;
        this.messages = [`EMERGENCY STOP SWITCH ${where}, ACTIVE`, 'START FAIL/BLOCK, ACTIVE'];
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
        if (this.emStopped || this.emStopLatched) return true;     // 应急停车：按确认只转黄，不清除
        if (this.overspeedTripped) return true;                    // 超速停车
        if (this.shutDown && !this.cancelSHD) return true;         // 停车动作未越控
        if (this.sldPre) return true;                              // 慢降预报警（延时未到）
        if (this.slowDown) return true;                            // 自动减速动作中（越控无效）
        if (this.startBlocked) return true;                        // 起动阻塞：确认只转黄，恢复工作才清除
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
        } else if (kind === 'SLD') {
            this.cancelSLD = any;
            // ⚠ 只有"尚未真正减速"时 Cancel SLD 才生效（暂停本次减速）；
            //    已经触发减速后按 Cancel SLD 对本次无效（仍需把车钟拉到 40 以下复位）
            this.sldCancelled = any && !this.slowDown;
            if (this.sldCancelled) {
                // 预报警期间越控：弹窗消失，**该条预报警信息同时从报警栏移除**
                // （否则温度回落后 sldPreAlarmClear 已无 sldPre 可清，信息会一直留在栏里）
                const pre = this.sldPre;
                this.sldPre = null;
                if (pre && pre.text) {
                    this.messages = (this.messages || []).filter((m) => !m.startsWith(pre.text));
                    if (!this.messages.length) this.alarm = false;
                    this.alarmText = this.messages[0] || '';
                }
            }
        } else this.cancelLimits = any;
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

    /** 盘车机控制箱电源：只控制电源，**不改变盘车机脱开/合上** */
    toggleTurningGearPower() {
        this.turningGearPower = !this.turningGearPower;
        if (!this.turningGearPower) this.turningGearJog = 0;   // 断电即停机
        return this.turningGearPower;
    }

    /** 盘车机应急停止（遥控盒红色按钮）：只停盘车机，**不影响主机** */
    /**
     * 机旁起动旋钮：'BLOW' 冲车 / 'AUTO' 自动 / 'SLOW' 慢转起动
     * **只有控制权在机旁（controlPos === LOCAL）时才起作用**，其它位置调用返回 'blocked'、不改变状态。
     */
    setStartKnob(pos, by) {
        const p = (pos === 'BLOW' || pos === 'SLOW') ? pos : 'AUTO';
        this.startKnob = p;          // 旋钮本身任何控制位置都能转（无控制权时只是**不输出信号**）
        return p;
    }

    /** 取某项安保延时（s）；未设置时用默认值 */
    getSafetyDelay(key, dflt = 6) {
        const v = this.delays ? this.delays[key] : undefined;
        return Number.isFinite(v) ? v : dflt;
    }

    /** 设置某项安保延时（0~120 s，保留 1 位小数） */
    setSafetyDelay(key, sec) {
        if (!this.delays || !(key in this.delays)) return null;
        const v = Math.max(0, Math.min(120, Number(sec)));
        if (!Number.isFinite(v)) return this.delays[key];
        this.delays[key] = Math.round(v * 10) / 10;
        return this.delays[key];
    }

    /** 起动电磁阀 A 是否得电：冲车（BLOW）时得电；任何起动过程从开始保持到转速超过发火转速 */
    get startValveA() {
        if (this.shutDown || this.emStopped) return false;
        const blow = this.controlPos === CONTROL_POS.LOCAL && (this.startKnob || 'AUTO') === 'BLOW';
        if (Math.abs(this.rpm) > FIRE_RPM) return false;
        return !!this._startAOn || blow;
    }

    /** 起动空气阀（主起动阀 / 慢转起动阀）是否处于开启（进气）状态 */
    get airValveOpen() { return !!this.starting || !!this._airTurn; }

    /** 冲车 / 慢转是否正在由起动空气带转 */
    get airTurning() { return !!this._airTurn; }

    /** 切换盘车机控制方式：'LOCAL' 机旁控制箱 / 'REMOTE' 遥控盒 */
    setTurningGearMode(mode) {
        this.turningGearMode = (mode === 'LOCAL') ? 'LOCAL' : 'REMOTE';
        return this.turningGearMode;
    }

    /** 本地 ⇄ 遥控 切换 */
    toggleTurningGearMode() {
        return this.setTurningGearMode(this.turningGearMode === 'LOCAL' ? 'REMOTE' : 'LOCAL');
    }

    /** 盘车机是否正在转动（电源通 + 点动中） */
    get turningGearRunning() { return !!this.turningGearJog && !!this.turningGearPower; }

    /** 盘车机电机电流（A）：不转 0；脱开空转很小；合上带主机很大 */
    get turningGearCurrent() { return Math.round(this.tgCurrent * 10) / 10; }

    turningGearEmergencyStop() {
        this.turningGearJog = 0;
        return true;
    }

    /** 盘车机点动：dir = 1 正转 / -1 倒转 / 0 停机（仅在电源接通且选择开关在"本地"时有效） */
    setTurningGearJog(dir, by) {
        if (!this.turningGearPower) { this.turningGearJog = 0; return 0; }
        // 停止命令（dir = 0）任何来源都有效；起动命令只能由当前控制方式（本地/遥控）发出
        if (dir && by && by !== this.turningGearMode) return this.turningGearJog;
        this.turningGearJog = dir ? (dir > 0 ? 1 : -1) : 0;
        return this.turningGearJog;
    }

    toggleTurningGear() {
        this.turningGearOut = !this.turningGearOut;
        if (!this.turningGearOut && this.rpm > 5) this.raiseAlarm('主机运行中，禁止合上盘车机');
    }

    toggleLoadLimit() { this.loadLimit = !this.loadLimit; }

    // ── 辅助鼓风机 / 液压动力泵（ME 主机页的电机控制盒）────────────
    /** 控制盒电源开关（OFF / ON） */
    setBlowerPower(on) { this.blowerPower = !!on; return this.blowerPower; }
    toggleBlowerPower() { return this.setBlowerPower(!this.blowerPower); }
    /** 控制方式（LOCAL 本地 / REMOTE 遥控） */
    setBlowerMode(m) { this.blowerMode = (m === 'LOCAL') ? 'LOCAL' : 'REMOTE'; this.blowerOverload = false; return this.blowerMode; }
    toggleBlowerMode() { return this.setBlowerMode(this.blowerMode === 'LOCAL' ? 'REMOTE' : 'LOCAL'); }
    /** 本地方式下的起动 / 停止按钮 */
    blowerStart() {
        if (!this.blowerPower) return false;
        this.blowerCmdRun = true;
        if (this.blowerMode === 'LOCAL') this.blowerOverload = false;
        return this.blowerRun;
    }
    blowerStop() {
        this.blowerCmdRun = false;
        this.blowerOverload = false;
        return this.blowerRun;
    }

    setHpsPower(on) { this.hpsPower = !!on; return this.hpsPower; }
    toggleHpsPower() { return this.setHpsPower(!this.hpsPower); }
    setHpsMode(m) { this.hpsMode = (m === 'LOCAL') ? 'LOCAL' : 'REMOTE'; this.hpsOverload = false; return this.hpsMode; }
    toggleHpsMode() { return this.setHpsMode(this.hpsMode === 'LOCAL' ? 'REMOTE' : 'LOCAL'); }
    hpsStart() {
        if (!this.hpsPower) return false;
        this.hpsCmdRun = true;
        if (this.hpsMode === 'LOCAL') this.hpsOverload = false;
        return this.hpsRun;
    }
    hpsStop() {
        this.hpsCmdRun = false;
        this.hpsOverload = false;
        return this.hpsRun;
    }

    /**
     * 辅助机械求解（20 fps）：
     *   ① **辅助鼓风机**：电源 OFF/ON、本地/遥控、起动/停止；
     *      遥控方式按**扫气箱空气压力**自动起停 —— 转速超过 20 rpm 时压力超过 0.07 MPa，鼓风机自动停止；
     *      本地方式强行运行且扫气压力已建立 → 过载保护动作（停机 + 过载灯）。
     *   ② **液压动力泵**：右上角 Master（电动机带动）/ 左侧 Ctrl（机带泵）。
     *      主机停止时机带泵不转，由电动泵提供液压动力；主机 20 rpm 以上机带泵压力足够，
     *      电动泵若在遥控方式则自动停止。两台泵都停 → 液压油压力衰减。
     */
    _stepAuxMachines(dt) {
        const absRpm = Math.abs(this.rpm);
        // 扫气箱压力组成（MPa）：
        //   · 增压器：**每增加 10 转 +0.02 MPa**（0.002 × rpm）
        //   · 辅助鼓风机：运行 0.04 MPa / 停止 0.001 MPa
        const turboMPa = 0.002 * absRpm;

        // ── ① 辅助鼓风机 ──
        if (!this.blowerPower) {
            this.blowerRun = false;
            this.blowerOverload = false;
        } else if (this.blowerMode === 'LOCAL') {
            if (this.blowerCmdRun) {
                if (turboMPa + 0.04 > 0.08 && this.blowerRun) {   // 压力已足够仍强行运行 → 过载
                    this.blowerRun = false;
                    this.blowerOverload = true;
                } else if (!this.blowerOverload) {
                    this.blowerRun = true;
                }
            } else {
                this.blowerRun = false;
                this.blowerOverload = false;
            }
        } else {
            // 遥控：扫气箱压力 **低于 0.03 MPa 自动起动**、**大于 0.08 MPa 自动停止**（0.03/0.08 回差防抖）
            this.blowerOverload = false;
            if (this.blowerRun) {
                if (turboMPa + 0.04 > 0.08) this.blowerRun = false;
            } else if (turboMPa + 0.001 < 0.03) {
                this.blowerRun = true;
            }
        }
        // 扫气箱实际压力（鼓风机状态确定后再算）
        this.scavPressMPa = turboMPa + (this.blowerRun ? 0.04 : 0.001);
        this.scavOkPress = this.scavPressMPa > 0.03;      // 「压力正常」灯：>0.03 MPa 即点亮
        this.auxBlower = this.blowerRun;                  // 机旁面板矩阵「辅助鼓风机运行」
        this.auxBlowerAlarm = this.blowerOverload;        // 「辅助鼓风机报警」= 过载

        // ── ② 液压动力泵（Ctrl 机带 / Master 电动）──
        const engPumpOk = absRpm > 20;   // 20 rpm 以上机带泵能产生足够压力
        this.engPumpOk = engPumpOk;
        if (!this.hpsPower) {
            this.hpsRun = false;
            this.hpsOverload = false;
        } else if (this.hpsMode === 'LOCAL') {
            if (this.hpsCmdRun) {
                if (engPumpOk && this.hpsRun) {      // 机带泵已建压仍强行运行电动泵 → 过载
                    this.hpsRun = false;
                    this.hpsOverload = true;
                } else if (!this.hpsOverload) {
                    this.hpsRun = true;
                }
            } else {
                this.hpsRun = false;
                this.hpsOverload = false;
            }
        } else {                                     // 遥控：主机停止时提供动力，20 rpm 以上自动停止
            this.hpsOverload = false;
            this.hpsRun = !engPumpOk;
        }

        // 液压油压力：机带泵或电动泵运行 → 280 bar；都停止 → 衰减
        const target = (engPumpOk || this.hpsRun) ? 280 : 0;
        this.hydOil += (target - this.hydOil) * Math.min(1, dt / 2.5);
        if (this.hydOil < 0.5) this.hydOil = 0;
    }


    /**
     * 曲轴箱油雾浓度高（故障设置注入 / 清除）。
     * 置 true 后由 solve() 计时：延时（`delays['sld-mist']`，默认 6 s）到 → `safetyAction('SLD','ME-MIST')`
     * 自动减速；置 false 后自动还原（减速动作锁存到车钟拉到 40 rpm 以下）。
     */
    setCrankcaseMist(on) {
        this.mistHigh = !!on;
        if (!this.mistHigh) {
            this._mistSldT = 0;
            this._mistPre = false;
        }
        return this.mistHigh;
    }

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

        // 机旁/面板应急停车复位：按钮弹出后，**拥有控制权的面板**把车钟拉回 STOP（|车令| < 0.5 rpm）才复位；
        // 弹出按钮本身不清报警 —— 警报不会自动消除
        if (this.emStopped && !this.emStopLatched) {
            // 必须把「控制权所在位置」的手柄拉回 STOP：驾驶台 / 集控室 = 车钟手柄，机旁 = 调速手柄
            const wCmd = (this.controlPos === CONTROL_POS.LOCAL)
                ? this.localSpeed
                : this.leverRpm[this.controlPos];
            if (Math.abs(wCmd) < 0.5) {
                this._emResetHold = (this._emResetHold || 0) + dt;
            } else {
                this._emResetHold = 0;
            }
            if (this._emResetHold >= 0.5) {            // 保持在 STOP 0.5 s 才复位（避免误判）
                this._emResetHold = 0;
                this.emStopped = false;
                this.emStopBy = null;
                if (!this.shutDown && !this.overspeedTripped) {
                    this.engineReady = true;           // 复位后备车完成 → Engine State: Ready for Start
                    this.startBlocked = false;
                }
                this.alarm = false;
                this.acked = true;
                this.clearMessages();
            }
        }

        // 超速保护：① 试验（两个开关都在 ON 且模拟转速超过试验值）
        //          ② 实际转速超过「Overspeed Level」动作值 —— 在转速检测页把动作值改到当前实际转速以下即立即动作
        // 每次只动作一次（越限后需先退出越限 / 关掉开关 / 把动作值调回其上方「重新武装」）
        const OT = this.overspeedTest;
        if (OT) {
            // 实际转速超过动作值：**动作后主机停车、实际转速归零**，无法再用"当前转速 > 动作值"判断，
            // 因此锁存动作那一瞬的实际转速，直到把 Overspeed Level 调回该值以上（或越控 / 复位）才解除
            const lv = Number(OT.osLevel);
            const lvOk = Number.isFinite(lv) && lv > 0.5;
            if (!this._osLevelTrip) {
                if (lvOk && !this.shutDown && !this.emStopped && Math.abs(this.rpm) > lv + 0.05) {
                    this._osLevelTrip = { rpm: Math.abs(this.rpm), level: lv };
                }
            } else if (!lvOk || this._osLevelTrip.rpm <= lv + 0.05) {
                this._osLevelTrip = null;          // 动作值已调回动作转速以上 → 超速条件消失
            }
            const testOver = OT.simOn && OT.osTestOn && OT.simRpm > OT.osTestRpm;
            const levelOver = !!this._osLevelTrip;
            const over = testOver || levelOver;
            if (over) {
                if (this._osTestArmed !== false) {
                    this._osTestArmed = false;
                    this._overspeedTrip();
                }
            } else {
                this._osTestArmed = true;
                // 试验条件消失（模拟转速降到试验值以下 / 关掉开关 / 动作值调回上方）→ 超速故障消失，报警自动恢复
                if (this.overspeedTripped) {
                    this.overspeedTripped = false;
                    if (!this.emStopLatched) this.shutDown = false;   // 试验引起的停车随之解除
                    this._shutAlarmReturn();                          // 已应答→清除；未应答→转 RTN
                }
            }
        }

        // 曲轴箱油雾浓度高 → 延时（Param. Change → Safety 的「曲轴箱油雾浓度高」，默认 6 s）自动减速
        //   故障消除后按既有规则还原（减速动作锁存到车钟拉到 40 rpm 以下）
        if (this.mistHigh) {
            if (this.sldCancelled && !this.slowDown) {
                // Cancel SLD 已取消本次减速（暂停）：不计时、不弹窗；松开后重新计时
                this._mistSldT = 0;
                this._mistPre = false;
            } else {
                // 越限立即预报警（主面板弹出可取消提示框），延时到才真正减速
                if (!this._mistPre) {
                    this._mistPre = true;
                    this.sldPreAlarm('ME-MIST');
                }
                this._mistSldT = (this._mistSldT || 0) + dt;
                const mistDelay = this.getSafetyDelay('sld-mist', 6);
                if (this._mistSldT >= mistDelay && !this._mistSld) {
                    this._mistSld = true;
                    this.safetyAction('SLD', 'ME-MIST');
                }
            }
        } else {
            this._mistSldT = 0;
            if (this._mistPre) {
                this._mistPre = false;
                this.sldPreAlarmClear('ME-MIST');
            }
            if (this._mistSld) {
                this._mistSld = false;
                this.safetyClear('SLD', 'ME-MIST');
            }
        }

        // 慢降锁存复位：减速原因已消失，且本船车令（控制位置车钟）拉到 40 rpm 以下 → 解除自动减速
        if (this.slowDown && this.sldAwaitReset
            && !Object.keys(this.sldCauses || {}).length
            && Math.abs(this.rpmCmd) < 40) {
            this.slowDown = false;
            this.sldAwaitReset = false;
            // 报警信息随复位处理：已应答 → 移除 SLOWDOWN ACTIVE 行；未应答 → 转 NORMAL
            if (this.alarm) {
                if (this.acked) {
                    this.messages = (this.messages || []).filter((m) => !m.startsWith('SLOWDOWN ACTIVE'));
                    if (!this.messages.length) this.alarm = false;
                } else {
                    this.messages = (this.messages || []).map((m) => (m.startsWith('SLOWDOWN ACTIVE')
                        ? 'SLOWDOWN ACTIVE, NORMAL' : m));
                }
                this.alarmText = this.messages[0] || '';
            }
        }

        // 慢降锁存期间（原因已消失、等车钟拉到 40 以下）：报警栏必须保留 SLOWDOWN ACTIVE 行
        if (this.slowDown && this.sldAwaitReset) {
            if (!(this.messages || []).some((m) => m.startsWith('SLOWDOWN ACTIVE'))) {
                this.messages = ['SLOWDOWN ACTIVE, ACTIVE', ...(this.messages || [])].slice(0, 2);
            }
            if (!this.alarm) this.alarm = true;
        }

        // 自动停车复位：安保停车后，把（控制位置的）车钟拉回 STOP → 解除停车、恢复备车
        if (this.shutDown && this.shdResetArmed && this._shdStopAck) {
            this.shdResetArmed = false;
            this._shdStopAck = false;
            this.shutDown = false;
            this.loLowLowShd = false;
            this.jcwLowShd = false;
            this.overspeedTripped = false;
            this.cancelSHDBy = { BRIDGE: false, ECR: false, LOCAL: false };
            this.cancelSHD = false;
            if (!this.emStopped) {
                this.engineReady = true;               // 复位后备车完成
                this.startBlocked = false;
            }
            this._shutAlarmReturn();                   // 已应答 → 清除；未应答 → 转 NORMAL
        }

        // 起动电磁阀 A 的保持逻辑：起动中一直得电，转速升到发火转速以上（或停机/安保停车）后失电
        if (this.shutDown || this.emStopped) this._startAOn = false;
        else if (!this.starting && (Math.abs(this.rpm) > FIRE_RPM || Math.abs(this.rpm) <= 1)) this._startAOn = false;

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

        // 机旁起动旋钮（冲车 / 慢转）：只有控制权在机旁、且未安保停车时才由起动空气带转
        const knobPos = this.startKnob || 'AUTO';
        const knobOk = this.controlPos === CONTROL_POS.LOCAL && knobPos !== 'AUTO'
            && !this.starting && !this.shutDown && !this.emStopped;
        this._airTurn = knobOk;
        const airTarget = knobPos === 'BLOW' ? BLOW_RPM : SLOWTURN_RPM;
        const airRate = knobPos === 'BLOW' ? BLOW_RATE : SLOWTURN_RATE;

        // 盘车机：点动时电机电流（转不转 × 脱开/合上），合上时带动主机很低速正/反转
        const tgJog = this.turningGearJog || 0;
        const tgRun = tgJog !== 0 && !!this.turningGearPower;
        const tgEngaged = !this.turningGearOut;
        const tgTargetA = tgRun ? (tgEngaged ? TG_LOAD_CURRENT : TG_FREE_CURRENT) : 0;
        this.tgCurrent += (tgTargetA - this.tgCurrent) * Math.min(1, dt / TG_CURRENT_TAU);
        this._tgDriven = tgRun && tgEngaged;

        if (this.starting) {
            // 起动空气转车阶段：**主起动阀开到位（1 s）之后**才按起动方向平顺转到约 ±12 rpm
            if (this.startTimer >= VALVE_STROKE) {
                const turn = (this._startDir || 1) * 12;
                this.rpm += (turn - this.rpm) * Math.min(1, dt * 1.2);
            }
        } else if (this._tgDriven) {
            // 盘车机合上 → 带主机低速正/反转（不是燃油运行）
            const turn = tgJog * TG_JOG_RPM;
            this.rpm += (turn - this.rpm) * Math.min(1, dt * 2.5);
        } else if (this._airTurn) {
            // 冲车 / 慢转：起动空气带主机正转（冲车逐渐升到 20 rpm 后保持，慢转稳定在很低转速）
            this.rpm = Math.max(0, Math.min(airTarget, this.rpm + airRate * dt));
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
            if (this.emStopped) target = 0;                    // 机旁紧急停车：燃油切断
            // 速率（rpm/s）：停车动作 55；其余按主机惯性最快变化率（≈4.53 → 68→0 约 15 s）
            const rate = (this.shutDown || this.emStopped) ? 55 : (this.inertiaRate || 68 / 15);
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
        const tLoad = (absRpm > 0.5 && !this._tgDriven && !this._airTurn) ? Math.min(cap, 22 + absRpm * 0.9) : 0;
        this.load += (tLoad - this.load) * Math.min(1, dt * 1.6);
        this.load = Math.round(this.load * 10) / 10;

        // 盘车机带转不算「主机运行」（不燃油、不算运行小时）
        this.running = !this.starting && Math.abs(this.rpm) > 1 && !this._tgDriven && !this._airTurn;

        // 转向不符（车钟与转向相反）：本仿真不触发该报警（换向制动过程中会误判）
        this.wrongWay = false;

        // 辅助鼓风机 / 液压动力泵（ME 主机页电机控制盒）
        this._stepAuxMachines(dt);

        if (this.lampTestTimer > 0) {
            this.lampTestTimer -= dt;
            if (this.lampTestTimer <= 0) this.lampTest = false;
        }
        if (this.refuseFlash > 0) this.refuseFlash -= dt;

        // 运行小时与转数计数：**主机停转（|rpm| < 1）时不累加**
        if (Math.abs(this.rpm) > 1 && !this._tgDriven && !this._airTurn) {
            this.runHours += dt / 3600;
            this.rev += dt * 1.7 * (Math.abs(this.rpm) / 68);   // 转数与转速成正比，停转即停止计数
        }
    }
}

/** 取系统里的模型实例（组件统一走这里，缺省时就地创建） */
export function ac600Of(sys) {
    if (!sys) return null;
    if (!sys.ac600) sys.ac600 = new AC600Solver(sys);
    return sys.ac600;
}
