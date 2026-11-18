/**
 * 船舶分油机（S 型 / EPC-50）自动控制仿真项目配置（单页工程）
 *
 * 画布同屏只有两台设备：
 *   epc    EPC-50 控制器（上部 OP 操作面板 + 下部电机起动控制箱）
 *   mimic  分油机系统模拟图（P&ID：柜、泵、滤器、加热器、V1/V4/V5、
 *          SV1/SV4/SV5、SV10/SV15/SV16、传感器、分离筒与排渣/接水盘）
 * 第 1 页运行状态仪、第 2 页系统流程与机旁控制箱的组件本工程不再使用
 * （组件文件与 export.js 导出均保留，需要时可另行启用）。
 */
import { EPC50Controller } from '../components/EPC50Controller.js';
import { EPC60SystemMimic } from '../components/EPC60SystemMimic.js';

import { Multimeter } from '../components/Multimeter.js';
import { MF47Multimeter } from '../components/MF47Multimeter.js';
import { Oscilloscope_tri } from '../components/Osc_tri.js';
import { SignalGenerator } from '../components/SignalGenerator.js';
import { ProcessCalibrator } from '../components/ProcessCalibrator.js';
import { ElecMeter } from '../components/ElecMeter.js';
import { RealMegohmMeter } from '../components/RealMegohmMeter.js';

const _sysOf = (ctx) => (ctx && ctx.sys) ? ctx.sys : window.sys;
const _sleep = (ms) => new Promise(r => setTimeout(r, ms));
const _comp = (sys, id) => (sys && sys.comps) ? sys.comps[id] : null;
const _solver = (sys) => (sys && sys.purifierSolver) ? sys.purifierSolver : null;
const _model = (sys) => { const s = _solver(sys); return s ? s.m : null; };

function _firePartClick(comp, partId) {
    if (!comp) return false;
    try {
        const node = comp.getClickablePartNode && comp.getClickablePartNode(partId);
        if (node && typeof node.fire === 'function') { node.fire('click'); return true; }
    } catch (e) { /* ignore */ }
    return false;
}

async function _clickUntil(comp, partId, pred, maxTimes = 8, gap = 240) {
    for (let i = 0; i < maxTimes; i++) {
        if (pred()) return true;
        _firePartClick(comp, partId);
        await _sleep(gap);
    }
    return pred();
}

async function _waitFor(sys, cond, timeoutMs = 30000, intervalMs = 250) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
        try { if (cond(sys)) return true; } catch (e) { /* ignore */ }
        await _sleep(intervalMs);
    }
    try { return !!cond(sys); } catch (e) { return false; }
}

// ═══════════════════════════════════════════════════════════════
// 组件配置（1920 × 1080 基准坐标，单页同屏）
// ═══════════════════════════════════════════════════════════════

export const componentConfigs = [
    // 同屏两台设备（等高 760，y 对齐）
    { Class: EPC50Controller, id: 'epc', x: -180, y: 50, width: 650, height: 760, visible: true },
    { Class: EPC60SystemMimic, id: 'mimic', x: 550, y: 50, width: 1060, height: 760, visible: true },

    { Class: Multimeter, id: 'multimeter', x: 1120, y: 200, visible: false },
    { Class: MF47Multimeter, id: 'mf47-panel', x: 1050, y: 150, visible: false },
    { Class: Oscilloscope_tri, id: 'osc', x: 50, y: 50, visible: false },
    { Class: SignalGenerator, id: 'sg', x: 50, y: 50, visible: false },
    { Class: ProcessCalibrator, id: 'cali', x: 50, y: 50, visible: false },
    { Class: ElecMeter, id: 'elecmeter', x: 50, y: 50, visible: false },
    { Class: RealMegohmMeter, id: 'megohm', x: 50, y: 50, visible: false },
];

// ═══════════════════════════════════════════════════════════════
// 工具栏快捷操作
// ═══════════════════════════════════════════════════════════════

export function initSlider(sys) {
    if (!sys) return;
    sys._noBlinkHighlight = true;
}

/** 工具栏「自动投用」：阀门排列到正常运行位，不启动分油机 */
export function applyAllPresets(opts) {
    if (opts && opts.init) return;
    const sys = _sysOf(this);
    const s = _solver(sys);
    if (!s) return;
    s.setMainPower(true);
    s.setWaterMain(true);
    s.setAirMain(true);
    s.setLocal(false);
    s.setMode('AUTO');
    if (sys.redrawAll) sys.redrawAll();
}

/** 工具栏「起动系统」：快速进入分油运行（教学快捷） */
export async function applyStartSystem() {
    const sys = _sysOf(this);
    const s = _solver(sys);
    if (!s) return;
    if (s.m.state !== 'STANDSTILL') {
        s.resetAll();
    }
    s.quickStart();
    await _sleep(800);
    if (sys.redrawAll) sys.redrawAll();
}

/** 工具栏「5 点步进」：停止 → 升速 → 水封 → 分油 → 排渣 */
export function fiveStep() {
    const sys = _sysOf(this);
    const s = _solver(sys);
    if (!s) return;
    if (sys._fiveStepIdx === undefined) sys._fiveStepIdx = 0;
    const idx = sys._fiveStepIdx % 5;
    sys._fiveStepIdx = idx + 1;
    s.fiveStep(idx);
    if (sys.redrawAll) sys.redrawAll();
}

// ═══════════════════════════════════════════════════════════════
// 故障配置
// ═══════════════════════════════════════════════════════════════

function _faults() {
    const m = _model(window.sys);
    return m ? m.faults : null;
}

function _mkFault(id, name, system, key) {
    return {
        id, name, system,
        check() { const f = _faults(); return !!(f && f[key]); },
        trigger() { const s = _solver(window.sys); if (s) s.setFault(key, true); },
        repair() { const s = _solver(window.sys); if (s) s.repairFault(key); },
    };
}

export const FAULT_CONFIGS = {
    'bowl-leak': _mkFault('bowl-leak', '分离筒密封失效 / 跑油', '分油机本体', 'leak'),
    'transducer': _mkFault('transducer', '水分传感器故障', 'ALCAP 系统', 'transducer'),
    'temp-low': _mkFault('temp-low', '分油温度低（加热器故障）', '加热系统', 'tempLow'),
    'vibration-high': _mkFault('vibration-high', '分油机振动高', '分油机本体', 'vibration'),
    'discharge-fail': _mkFault('discharge-fail', '排渣失败（无排渣反馈）', '排渣系统', 'dischargeFail'),
    'op-water-low': _mkFault('op-water-low', '工作水压力低', '工作水系统', 'opWaterLow'),
    'motor-overload': _mkFault('motor-overload', '分油机电机过载', '电机/起动器', 'motorOverload'),
};

// ═══════════════════════════════════════════════════════════════
// 工作流辅助
// ═══════════════════════════════════════════════════════════════

function _epc(sys) { return _comp(sys, 'epc'); }
function _mimic(sys) { return _comp(sys, 'mimic'); }

async function _epcClick(sys, part, times = 1, gap = 220) {
    for (let i = 0; i < times; i++) {
        _firePartClick(_epc(sys), part);
        await _sleep(gap);
    }
}

/** EPC-50 POWER SWITCH 旋转开关：顺时针合闸（ON），逆时针分闸（OFF） */
async function _setEpcPower(sys, on) {
    const s = _solver(sys);
    if (!s) return false;
    const part = on ? 'power-switch' : 'power-switch-ccw';
    for (let i = 0; i < 6 && s.m.mainPower !== !!on; i++) {
        _firePartClick(_epc(sys), part);
        await _sleep(350);
    }
    return s.m.mainPower === !!on;
}

/** SEPARATOR MODE 旋钮顺时针 CIP → MAN → AUT（AUT = 自动方式，Standst 下自动从 Ti50 执行） */
async function _ensureRemote(sys) {
    const s = _solver(sys);
    if (!s) return false;
    for (let i = 0; i < 6 && s.m.ctrlMode !== 'AUTO'; i++) {
        _firePartClick(_epc(sys), 'mode-switch');
        await _sleep(300);
    }
    // 档位到端点不循环，兜底直接置位
    if (s.m.ctrlMode !== 'AUTO' && s.setCtrlMode) s.setCtrlMode('AUTO');
    return s.m.ctrlMode === 'AUTO';
}

/** SEPARATOR MODE 旋钮逆时针回到 MAN（机旁手动） */
async function _ensureLocal(sys) {
    const s = _solver(sys);
    if (!s) return false;
    for (let i = 0; i < 6 && s.m.ctrlMode !== 'HAND'; i++) {
        _firePartClick(_epc(sys), 'mode-switch-ccw');
        await _sleep(300);
    }
    // 档位到端点不循环，兜底直接置位
    if (s.m.ctrlMode !== 'HAND' && s.setCtrlMode) s.setCtrlMode('HAND');
    return s.m.ctrlMode === 'HAND';
}

/**
 * 在系统模拟图上把五只手动阀按需要打开：
 *   water-inlet 工作水进口阀 / air-inlet 控制空气进口阀 /
 *   steam 蒸汽截止阀 / outlet 沉淀柜出口阀 / return 回流阀
 */
async function _ensureSupply(sys) {
    const s = _solver(sys);
    const mm = _mimic(sys);
    if (!s || !mm) return false;
    for (let i = 0; i < 4 && !s.m.water.mainOpen; i++) { _firePartClick(mm, 'water-inlet'); await _sleep(260); }
    for (let i = 0; i < 4 && !s.m.water.airMainOpen; i++) { _firePartClick(mm, 'air-inlet'); await _sleep(260); }
    for (let i = 0; i < 4 && !s.m.feed.steamValveOpen; i++) { _firePartClick(mm, 'steam'); await _sleep(260); }
    for (let i = 0; i < 4 && !s.m.feed.dirtyValveOpen; i++) { _firePartClick(mm, 'outlet'); await _sleep(260); }
    for (let i = 0; i < 4 && !s.m.feed.returnValveOpen; i++) { _firePartClick(mm, 'return'); await _sleep(260); }
    await _waitFor(sys, x => _model(x).water.supply > 2 && _model(x).water.air > 5, 6000, 200);
    return s.m.water.mainOpen && s.m.water.airMainOpen;
}





async function _waitSeparation(sys, timeout = 600000) {
    timeout = Math.max(timeout, 600000);
    return _waitFor(sys, x => {
        const m = _model(x);
        return !!(m && m.state === 'SEPARATION' && m.feed.flow > 0.3 && m.bowl.speed > 9000);
    }, timeout, 300);
}

async function _epcSetParam(sys, key, value) {
    const s = _solver(sys);
    const epc = _epc(sys);
    if (!s || !epc) return false;
    const u = epc._ui;
    // 进入菜单
    if (u.page !== 'menu') { _firePartClick(epc, 'key-enter'); await _sleep(260); }
    // 菜单光标移到「参数设置」（第 1 项）
    for (let i = 0; i < 8 && u.menu !== 0; i++) { _firePartClick(epc, 'key-minus'); await _sleep(180); }
    _firePartClick(epc, 'key-enter'); await _sleep(260);
    // 参数条目
    const items = epc._paramItems();
    const idx = items.findIndex(it => it[0] === key);
    if (idx < 0) return false;
    for (let i = 0; i < 20 && u.param !== idx; i++) {
        _firePartClick(epc, u.param < idx ? 'key-plus' : 'key-minus');
        await _sleep(160);
    }
    // 进入编辑
    _firePartClick(epc, 'key-enter'); await _sleep(220);
    const item = items[idx];
    const step = item[3] || 1;
    for (let i = 0; i < 300 && Math.abs(u.editVal - value) > step / 2; i++) {
        _firePartClick(epc, u.editVal < value ? 'key-plus' : 'key-minus');
        await _sleep(90);
    }
    // 保存并回到主菜单
    _firePartClick(epc, 'key-enter'); await _sleep(280);
    // 光标移到「返回主画面」并退出
    for (let i = 0; i < 8 && u.menu !== 4; i++) { _firePartClick(epc, 'key-plus'); await _sleep(160); }
    _firePartClick(epc, 'key-enter'); await _sleep(220);
    return Math.abs(s.getParam(key) - value) < step / 2;
}

async function _resetAlarms(sys) {
    const s = _solver(sys);
    if (!s) return false;
    for (let i = 0; i < 5; i++) {
        const active = s.m.alarms.some(a => a.active);
        if (!active) break;
        _firePartClick(_epc(sys), 'fn-alarm');
        await _sleep(300);
    }
    return !s.m.alarms.some(a => a.active);
}

/** 等待分油机完全静止（停机程序结束） */
async function _waitStandstill(sys, timeout = 900000) {
    return _waitFor(sys, x => {
        const m = _model(x);
        return !!(m && m.state === 'STANDSTILL' && !m.motor.on);
    }, timeout, 500);
}

/**
 * 把分油机送到 Ti68 正常分油（幂等）：先把 SEPARATOR MODE 打到 AUT——
 * 自动方式下 Standst 状态会自动从 Ti50 开始执行，之后只需等待程序走到 Ti68。
 * 顺序：POWER SWITCH → SEPARATOR MODE(AUT) → 水气阀 → 问答确认 → 供油泵 → 加热器(≥96℃)
 *       → 电机(≥10000 r/min) → OP ACTIVE 键投入分离程序
 */
async function _startToTi68(sys) {
    const s = _solver(sys);
    if (!s) return false;
    const m = s.m;
    const epc = _epc(sys);
    if (!epc) return false;
    await _ensureSupply(sys);
    await _setEpcPower(sys, true);
    await _ensureRemote(sys);          // 打到 AUT：液晶显示 Standst，尚未起动
    await _sleep(500);
    if (!m.prog) {
        // 按「SEPARATION」→ 回答第 1 问 NO → 自动从 Ti50 开始执行
        _firePartClick(epc, 'fn-separator'); await _sleep(700);
        _firePartClick(epc, 'key-minus'); await _sleep(700);
    }
    return _waitFor(sys, x => {
        const mm = _model(x);
        return !!(mm && mm.prog && mm.phase === 3 && mm.step >= 4);
    }, 600000, 500);
}

// ═══════════════════════════════════════════════════════════════
// 工作流
// ═══════════════════════════════════════════════════════════════

export const PROJECT_WORKFLOWS = {
    'purifier-identify': {
        id: 'purifier-identify', name: '1. 分油机系统的认识',
        steps: [
            // ── 1. MIMIC 图组件 ──
            {
                msg: '第 1 步：识别系统模拟图（MIMIC）。它用 P&ID 风格把沉淀柜、供油泵、滤器、加热器、三通阀 V1、分油机、净油柜、排渣柜、工作水电磁阀组 SV10/SV15/SV16 与控制空气回路画在一张图上，并带流动动画和传感器读数。',
                mode: 'find', target: 'mimic',
            },
            // ── 2. 分油机组件 ──
            {
                msg: '第 2 步：识别分油机组件（S 936 分离筒）。上部为分离筒及碟片组，下部为活动排渣底盘与底座，右侧为驱动电机，电机中心的绿色指示灯表示分离筒正在运行。',
                mode: 'find', target: 'mimic', subTarget: 'separator',
            },
            // ── 3. 供油泵 ──
            {
                msg: '第 3 步：识别供油泵。它把沉淀柜的燃油升压后送经滤器与加热器；泵出口并联一只带复位弹簧的单向阀，出口阀关闭时油经单向阀内部循环，避免泵后憋压。',
                mode: 'find', target: 'mimic', subTarget: 'pump',
            },
            // ── 4. 加热器 ──
            {
                msg: '第 4 步：识别加热器。用蒸汽把燃油加热到约 98 ℃，降低黏度、增大油水密度差以提高分离效果；蒸汽由下边缘进入，凝水由下边缘排出。',
                mode: 'find', target: 'mimic', subTarget: 'heater',
            },
            // ── 5. 蒸汽电动调节阀 ──
            {
                msg: '第 5 步：识别蒸汽管路上的电动调节阀。M 方框表示电动执行机构，由温度控制器输出信号调节蒸汽流量，从而把燃油出口温度稳定在设定值；其右侧串联一只蒸汽截止阀，检修时可切断汽源。',
                mode: 'find', target: 'mimic', subTarget: 'motor-valve',
            },
            // ── 6~7. SV1 / V1 ──
            {
                msg: '第 6 步：识别电磁阀 SV1。SV1 是三通阀 V1 的先导电磁阀，通电后把控制空气送入 V1 的气动膜头；只有分离程序投入、控制空气建立后它才可能得电。',
                mode: 'find', target: 'mimic', subTarget: 'sv1',
            },
            {
                msg: '第 7 步：识别三通阀 V1（供油转换阀）。得气时向分油机供油，失气时切换到回流口把油送回沉淀柜——起动与停机阶段油走回流，进入分油程序后才向分离筒进油。',
                mode: 'find', target: 'mimic', subTarget: 'v1',
            },
            // ── 8~9. SV4 / V4 ──
            {
                msg: '第 8 步：识别电磁阀 SV4。SV4 控制净油出口阀 V4 的控制空气，分油机进入分离程序（起动/分油/排渣/停机）后 SV4 才可能通电。',
                mode: 'find', target: 'mimic', subTarget: 'sv4',
            },
            {
                msg: '第 9 步：识别净油出口阀 V4。它装在净油出口管路上，是带气动膜头的气动阀，膜头与阀体的颜色反映它当前是否得气、是否开启。',
                mode: 'find', target: 'mimic', subTarget: 'v4',
            },
            // ── 10. 测试题：V4 的特征 ──
            {
                msg: '第 10 步：测试题——V4 的特征。',
                mode: 'quiz',
                quizConfig: {
                    question: 'V4（净油出口阀）的特征是？',
                    options: [
                        '气开式气动阀：有控制空气时开启，失气时关闭',
                        '气关式气动阀：有控制空气时关闭，失气时在弹簧作用下开启',
                        '手动截止阀：必须人工转动手轮才能开关',
                        '电动调节阀：由温度控制器输出信号调节开度',
                    ],
                    answer: 1,
                    analysis: 'V4 由先导电磁阀 SV4 控制，属气关阀：SV4 通电 → 控制空气进入膜头 → V4 关闭；SV4 断电 → 失气 → 阀在弹簧力作用下开启。分油机未进入分离程序（无控制空气）时 V4 保持开启，净油出口通路畅通，避免筒内憋压。',
                },
            },
            // ── 11~12. SV5 / V5 ──
            {
                msg: '第 11 步：识别电磁阀 SV5。SV5 通电把控制空气送入出水阀 V5 的执行机构，使 V5 打开排水。',
                mode: 'find', target: 'mimic', subTarget: 'sv5',
            },
            {
                msg: '第 12 步：识别出水阀 V5。它是气开式气动阀，装在分油机下部的出水管上：V5 打开时把分离出的水排到接水盘，排水压力由 PT5 监视。',
                mode: 'find', target: 'mimic', subTarget: 'v5',
            },
            // ── 13~15. SV10 / SV15 / SV16 ──
            {
                msg: '第 13 步：识别水封及置换水阀 SV10。SV10 通电向分离筒送入工作水：起动时建立水封（Ti63），排渣与停机时作为置换水把筒内的油顶出（Ti71~Ti72、Ti82）。',
                mode: 'find', target: 'mimic', subTarget: 'sv10',
            },
            {
                msg: '第 14 步：识别开启水阀 SV15。SV15 通电把开启水送到活动排渣底盘的上部中央，约 3 s 泄掉底盘外缘的密封水，底盘复位、排渣口打开，污渣被离心力甩入排渣柜（每次 SV15 通电排渣柜液位上升）。',
                mode: 'find', target: 'mimic', subTarget: 'sv15',
            },
            {
                msg: '第 15 步：识别密封及补偿水阀 SV16。SV16 通电把密封水送到活动排渣底盘下部，约 5 s 形成密封水层使底盘变形压紧、封闭排渣口；正常分油期间它按设定间隔脉冲送入补偿水，维持密封。',
                mode: 'find', target: 'mimic', subTarget: 'sv16',
            },
            // ── 16~21. 传感器 ──
            {
                msg: '第 16 步：识别燃油入口管路压力传感器 PT1。它装在供油泵出口的主进油管上，测量进油压力（约 0.28 MPa）；压力过低会触发 A17「供油泵无压力」报警。',
                mode: 'find', target: 'mimic', subTarget: 'pt1',
            },
            {
                msg: '第 17 步：识别燃油入口温度传感器 TT1。它装在加热器出口，测量进入分离筒的油温（约 98 ℃）；温度过低会触发 A05 报警并切断进油。',
                mode: 'find', target: 'mimic', subTarget: 'tt1',
            },
            {
                msg: '第 18 步：识别净油出口压力传感器 PT4。它测量净油出口压力，正常约 0.2~0.3 MPa；压力异常下降说明分离筒密封失效或跑油（A03）。',
                mode: 'find', target: 'mimic', subTarget: 'pt4',
            },
            {
                msg: '第 19 步：识别净油出口水分传感器 MT。进入程序 Ti65「水分检查」后才开始检测，读数以 pF 表示；水分超过 12 pF 时自动开启 V5 排水，降到 6 pF 时关闭。',
                mode: 'find', target: 'mimic', subTarget: 'mt',
            },
            {
                msg: '第 20 步：识别排水压力传感器 PT5。它装在水封及出水阀 V5 与接水盘之间的排水管上，用于监视排水压力。',
                mode: 'find', target: 'mimic', subTarget: 'pt5',
            },
            {
                msg: '第 21 步：识别速度传感器 ST。它装在电机端盖处，测量分离筒转速，额定 10680 r/min；转速低于额定值 90% 时不允许起动分离程序。',
                mode: 'find', target: 'mimic', subTarget: 'st',
            },
            // ── 22. 测试题：密封原理 ──
            {
                msg: '第 22 步：测试题——分油机密封的原理。',
                mode: 'quiz',
                quizConfig: {
                    question: 'S 型分油机分离筒"密封"（关闭排渣口）的原理是？',
                    options: [
                        '靠筒盖螺栓机械压紧实现密封',
                        '密封水进入活动排渣底盘下部的密封水腔，使可变形底盘上移压紧，封闭排渣口',
                        '靠重力使活动底盘自然落下密封',
                        '靠离心力把活动底盘甩向筒壁密封',
                    ],
                    answer: 1,
                    analysis: 'SV16（密封及补偿水阀）通电后，密封水约 5 s 内在活动排渣底盘的左下、右下聚集，底盘（未变形时是直线，排渣口开）变形上移压紧密封面，排渣口关闭；SV15（开启水阀）通电时开启水进入底盘上部中央，约 3 s 泄掉外缘密封水，底盘复位、排渣口重新打开。',
                },
            },
            // ── 23. 测试题：分油原理 ──
            {
                msg: '第 23 步：测试题——分油机分油的原理。',
                mode: 'quiz',
                quizConfig: {
                    question: '碟片式分油机把油中的水分与机械杂质分离出来的主要原理是？',
                    options: [
                        '用滤网逐级拦截机械杂质',
                        '加热降低黏度后，利用油、水、杂质的密度差，在高速旋转产生的离心力场中分层：重相（水、杂质）向外、轻相（净油）向内，分别从出水口和净油口排出',
                        '用真空把油中的水分蒸发掉',
                        '加化学药剂破乳后自然沉淀分离',
                    ],
                    answer: 1,
                    analysis: '燃油先经加热器加热到约 98 ℃ 降低黏度，再进入以约 10680 r/min 高速旋转的分离筒。筒内碟片把油分成许多薄层，离心力使密度大的水与杂质沿碟片向外、向下运动，在筒壁形成水封层后由出水口（V5）排出；密度小的净油向内、向上经向心泵从净油出口（V4）排出。',
                },
            },
        ],
    },

    'purifier-epc-panel': {
        id: 'purifier-epc-panel', name: '2. EPC-50 控制器的认识',
        steps: [
            {
                msg: '第 1 步：识别 EPC-50 控制器。组件上部是 OP 操作面板（流程图、INFO 信息区、液晶显示器、−/+/ENTER 按键、右侧六只功能键），下部是电机起动控制箱（起停按钮、电机电流表、两个旋转开关、蜂鸣器、应急停止）。',
                mode: 'find', target: 'epc',
            },
            {
                msg: '第 2 步：识别供油泵及其上方圆形运行指示灯——供油泵运行时该灯亮绿。',
                mode: 'find', target: 'epc', subTarget: 'led-feed',
            },
            {
                msg: '第 3 步：识别三通阀 V1（上方为气动膜头）。通气时膜头变蓝、左位与右位绿色（进油）；失气时膜头白色、左位与下位绿色（回油）。',
                mode: 'find', target: 'epc', subTarget: 'valve-v1',
            },
            {
                msg: '第 4 步：识别工作水阀组（流程图左下角的 16、15、10）。16 是密封水阀 SV16，15 是开启水阀 SV15，10 是水封/置换水阀 SV10；通电时线圈变红、阀体变绿。',
                mode: 'find', target: 'epc', subTarget: 'valve-w1',
            },
            {
                msg: '第 5 步：识别 INFO 信息区。四行分别显示当前状态、分离筒转速、TT1 进油温度和到下次排渣的剩余时间。',
                mode: 'find', target: 'epc', subTarget: 'info',
            },
            {
                msg: '第 6 步：识别液晶显示器。停机时显示 Standst，起动过程显示 Start，分油时显示 Separat，排渣时显示 Discharg，右侧小字显示当前 Ti 定时器与剩余时间。',
                mode: 'find', target: 'epc', subTarget: 'lcd',
            },
            {
                msg: '第 7 步：识别「−」「+」两个按键。菜单中用于移动光标与增减参数值；手动操作时序的起动问询画面中用「+」答 YES、「−」答 NO。',
                mode: 'find', target: 'epc', subTarget: 'key-minus',
            },
            {
                msg: '第 8 步：识别「ENTER」按键。用于进入所选菜单项、确认参数修改值并逐级返回主画面。',
                mode: 'find', target: 'epc', subTarget: 'key-enter',
            },
            {
                msg: '第 9 步：识别「SEPARATION」功能键（按钮区第二个白框上半，与停止共用同一只键）。自动方式下分油中按此键 → 排渣 → 停机 → 自动停机；手动方式下按此键开始三问，屏幕出现 Start Separator 后再按一次才投入分离程序。',
                mode: 'find', target: 'epc', subTarget: 'fn-separator',
            },
            {
                msg: '第 10 步：识别「OP ACTIVE」指示灯。面板激活指示：主电源合上且无报警时亮绿，表示 EPC-50 控制器工作正常。',
                mode: 'find', target: 'epc', subTarget: 'fn-operative',
            },
            {
                msg: '第 11 步：识别「STOP」指示灯（与上方 SEPARATION 共用同一只黑色按键，上下两只灯对称）。分离程序运行中再按该键即停止分油，停机程序运行时此灯闪烁。',
                mode: 'find', target: 'epc', subTarget: 'ind-stop',
            },
            {
                msg: '第 12 步：识别「DISCHARGE」功能键。分油处于待命或分油状态、转速正常时按下可立即执行一次排渣，排渣阶段该键指示灯闪烁。',
                mode: 'find', target: 'epc', subTarget: 'fn-discharge',
            },
            {
                msg: '第 13 步：识别「HEATER」功能键。用于投切加热器，加热器投入时该键指示灯常亮。',
                mode: 'find', target: 'epc', subTarget: 'fn-heater',
            },
            {
                msg: '第 14 步：识别「ALARM」功能键。报警时该键指示灯红色闪烁，按此键确认报警，再按一次清除已消失的报警。',
                mode: 'find', target: 'epc', subTarget: 'fn-alarm',
            },
            {
                msg: '第 15 步：识别 POWER SWITCH 旋转开关。顺时针合闸 ON 给分油机主回路与 EPC-50 面板上电，逆时针分闸 OFF 断电。',
                mode: 'find', target: 'epc', subTarget: 'power-switch',
            },
            {
                msg: '第 16 步：识别 SEPARATOR MODE 旋转开关（三档：左 60° CIP / 垂直向上 MAN / 右 60° AUT）。CIP 为清洗位（本仿真不实现）；MAN 位由电机起动控制箱按钮机旁手动操作；AUT 位为自动方式，Standst 状态下打到 AUT 即自动从 Ti50 开始执行。',
                mode: 'find', target: 'epc', subTarget: 'mode-switch',
            },
            {
                msg: '第 17 步：识别供油泵与电机的起停按钮。START FEED PUMP 起动供油泵，STOP FEED PUMP 停止供油泵；START MOTOR 起动分油机电机，STOP MOTOR 按停机程序停机。',
                mode: 'find', target: 'epc', subTarget: 'start-feed-pump',
            },
            {
                msg: '第 18 步：识别电机电流表。指示分油机电机的运行电流（正常约 14 A），超过 18 A 报电机过载。',
                mode: 'find', target: 'epc', subTarget: 'ammeter',
            },
            {
                msg: '第 19 步：识别蜂鸣器与应急停止按钮。报警时蜂鸣器鸣响，按一下可确认报警；EMCY STOP 为蘑菇头急停按钮，按下后电机、供油泵、加热器与各电磁阀全部断电。',
                mode: 'find', target: 'epc', subTarget: 'emergency-stop',
            },
        ],
    },
    'purifier-start-stop': {
        id: 'purifier-start-stop', name: '3. 分油机的起动和停机',
        steps: [
            {
                msg: '第 1 步：在系统模拟图上依次打开沉淀柜出口阀、回流阀和蒸汽截止阀——出口阀给供油泵供油，回流阀在起动阶段把油送回沉淀柜，蒸汽截止阀给加热器送汽。',
                mode: 'check',
                op: [
                    { type: 'switch', target: 'mimic', part: 'outlet', msg: '打开沉淀柜出口阀（沉淀柜 → 供油泵）',
                        async act() { const s = _sysOf(this); if (!_model(s).feed.dirtyValveOpen) { _firePartClick(_mimic(s), 'outlet'); await _sleep(450); } } },
                    { type: 'switch', target: 'mimic', part: 'return', msg: '打开回流阀（V1 回油口 → 沉淀柜）',
                        async act() { const s = _sysOf(this); if (!_model(s).feed.returnValveOpen) { _firePartClick(_mimic(s), 'return'); await _sleep(450); } } },
                    { type: 'switch', target: 'mimic', part: 'steam', msg: '打开蒸汽进口截止阀（供加热器用汽）',
                        async act() { const s = _sysOf(this); if (!_model(s).feed.steamValveOpen) { _firePartClick(_mimic(s), 'steam'); await _sleep(450); } } },
                ],
                check() {
                    const m = _model(_sysOf(this));
                    return !!(m && m.feed.dirtyValveOpen && m.feed.returnValveOpen && m.feed.steamValveOpen);
                },
            },
            {
                msg: '第 2 步：打开控制空气进口阀（5~7 bar）和工作水进口阀（2~8 bar）——控制空气驱动 V1/V4/V5 的气动执行机构，工作水用于水封、开启水与补偿水。',
                mode: 'check',
                op: [
                    { type: 'switch', target: 'mimic', part: 'air-inlet', msg: '打开控制空气进口阀，观察空气压力升到 5 bar 以上',
                        async act() { const s = _sysOf(this); if (!_model(s).water.airMainOpen) { _firePartClick(_mimic(s), 'air-inlet'); await _sleep(450); } await _waitFor(s, x => _model(x).water.air > 5, 15000, 250); } },
                    { type: 'switch', target: 'mimic', part: 'water-inlet', msg: '打开工作水进口阀，观察水压升到 2 bar 以上',
                        async act() { const s = _sysOf(this); if (!_model(s).water.mainOpen) { _firePartClick(_mimic(s), 'water-inlet'); await _sleep(450); } await _waitFor(s, x => _model(x).water.supply > 2, 15000, 250); } },
                ],
                check() {
                    const m = _model(_sysOf(this));
                    return !!(m && m.water.mainOpen && m.water.airMainOpen && m.water.supply > 2 && m.water.air > 5);
                },
            },
            {
                msg: '第 3 步：把 EPC-50 的 POWER SWITCH 合到 ON、SEPARATOR MODE 打到 AUT——分油机主回路与面板同时得电；打到 AUT 后液晶屏仍显示 Standst，等待按「SEPARATION」键起动。',
                mode: 'check',
                op: [
                    { type: 'switch', target: 'epc', part: 'power-switch', msg: 'POWER SWITCH 顺时针合闸 ON',
                        async act() { const s = _sysOf(this); await _setEpcPower(s, true); await _sleep(400); } },
                    { type: 'switch', target: 'epc', part: 'mode-switch', msg: 'SEPARATOR MODE 顺时针打到 AUT（液晶显示 Standst）',
                        async act() { const s = _sysOf(this); await _ensureRemote(s); await _sleep(800); } },
                ],
                check() {
                    const m = _model(_sysOf(this));
                    return !!(m && m.mainPower && m.epcPower && m.ctrlMode === 'AUTO' && !m.prog && m.state === 'STANDSTILL');
                },
            },
            {
                msg: '第 4 步：按「SEPARATION」键，液晶屏提出三个起动问询（Bowl dismantled? / Assembled per manual? / Bowl cleaned?）；用「−」回答了第 1 问 NO（或第 1 问答 YES 且后两问都答 YES），控制器随即自动从 Ti50 开始执行自动起动程序。',
                mode: 'check',
                op: [
                    { type: 'btn', target: 'epc', part: 'fn-separator', msg: '按「SEPARATION」键，液晶屏出现起动问询',
                        async act() { const s = _sysOf(this); _firePartClick(_epc(s), 'fn-separator'); await _sleep(800); } },
                    { type: 'btn', target: 'epc', part: 'key-minus', msg: '按「−」键，第 1 问答 NO（分离筒未拆检）',
                        async act() { const s = _sysOf(this); _firePartClick(_epc(s), 'key-minus'); await _sleep(900); } },
                    { type: 'observe', target: 'epc', part: 'lcd', msg: '液晶屏自 Ti50 起逐级推进，分离指示灯闪烁',
                        async act() { const s = _sysOf(this); await _waitFor(s, x => { const m = _model(x); return !!(m && m.prog && m.feed.pumpOn); }, 60000, 300); await _sleep(800); } },
                ],
                check() {
                    const m = _model(_sysOf(this));
                    return !!(m && m.prog && m.phase >= 1);
                },
            },
            {
                msg: '第 5 步：观察自动程序的执行：Ti50 起动供油泵 → Ti51 检查进油压力 → Ti52 起动分油机电机（≥10000 r/min）→ Ti53 投入加热器（≥96 ℃）→ Ti55 回流待命 → Ti56~Ti63 排渣、放残、密封、水封 → Ti64~Ti68 进油、含水量检查、检漏、水分基准。进入 Ti68 后稳定分油 240 s 以上，注意密封水补偿（SV16 脉冲）与 V5 排水。',
                mode: 'check',
                op: [
                    { type: 'observe', target: 'epc', part: 'lcd', msg: '观察液晶屏自 Ti50 起逐级推进',
                        async act() {
                            const s = _sysOf(this);
                            await _waitFor(s, x => { const m = _model(x); return !!(m && m.feed.pumpOn); }, 120000, 300);
                            await _sleep(800);
                        } },
                    { type: 'observe', target: 'mimic', part: 'st', msg: '观察电机升速、TT1 升温、V1 由回油位切到供油位',
                        async act() {
                            const s = _sysOf(this);
                            await _waitFor(s, x => { const m = _model(x); return !!(m && m.motor.on && m.bowl.speed >= 10000); }, 300000, 500);
                            await _sleep(800);
                        } },
                    { type: 'observe', target: 'mimic', part: 'sv16', msg: '进入 Ti68 稳定分油，观察密封水补偿脉冲与 V5 排水',
                        async act() {
                            const s = _sysOf(this);
                            const flags = this._projFlag || (this._projFlag = {});
                            await _waitFor(s, x => { const m = _model(x); return !!(m && m.prog && m.phase === 3 && m.step >= 4 && m.timerT > 240); }, 900000, 500);
                            flags.stable240 = true;
                            await _sleep(800);
                        } },
                ],
                check() {
                    const m = _model(_sysOf(this));
                    if (this._projFlag && this._projFlag.stable240) return true;
                    return !!(m && m.prog && m.phase === 3 && m.step >= 4 && m.timerT > 240);
                },
            },
            {
                msg: '第 6 步：手动按下「DISCHARGE」键，观察手动排渣过程：断油（Ti70）→ 进置换水（Ti71）→ 置换（Ti72）→ 冲洗向心管（Ti73）→ 排渣（Ti74）→ 放残（Ti75），随后自动重新进入分离程序，稳定分油超过 30 s。',
                mode: 'check',
                op: [
                    { type: 'btn', target: 'epc', part: 'fn-discharge', msg: '按「DISCHARGE」键执行一次手动排渣',
                        async act() { const s = _sysOf(this); _firePartClick(_epc(s), 'fn-discharge'); await _sleep(800); } },
                    { type: 'observe', target: 'mimic', part: 'sv15', msg: '观察 SV15 通电打开排渣口、排渣管流动、排渣柜液位上升',
                        async act() { await _sleep(2500); } },
                    { type: 'observe', target: 'epc', part: 'lcd', msg: '观察排渣结束后程序重新进入分油（Ti68）并稳定运行',
                        async act() {
                            const s = _sysOf(this);
                            const flags = this._projFlag || (this._projFlag = {});
                            await _waitFor(s, x => { const m = _model(x); return !!(m && m.prog && m.phase === 3 && m.step >= 4 && m.timerT > 30); }, 600000, 500);
                            flags.dischargeDone = true;
                            await _sleep(800);
                        } },
                ],
                check() {
                    const m = _model(_sysOf(this));
                    if (this._projFlag && this._projFlag.dischargeDone) return true;
                    return !!(m && m.prog && m.phase === 3 && m.step >= 4 && m.timerT > 30 && m.counters.dischargeCount > 0);
                },
            },
            {
                msg: '第 7 步：自动方式分油中再按一次「SEPARATION」键（分离与停止是同一只按钮），开始分离停止程序——先执行阶段四排渣（Ti70~Ti75），再执行阶段五置换与密封（Ti81~Ti83），最后进入阶段六自动停机（Ti85 停电机 → Ti86 降速 → Ti87 停泵 → Ti89 静止），液晶屏最终显示 Standst。',
                mode: 'check',
                op: [
                    { type: 'btn', target: 'epc', part: 'fn-separator', msg: '再按一次「SEPARATION」键（同一只按钮）开始分离停止程序',
                        async act() { const s = _sysOf(this); _firePartClick(_epc(s), 'fn-separator'); await _sleep(800); } },
                    { type: 'observe', target: 'epc', part: 'lcd', msg: '观察排渣、置换与自动停机各阶段，转速逐渐下降',
                        async act() { const s = _sysOf(this); await _waitFor(s, x => { const m = _model(x); return !!(m && m.state === 'STANDSTILL' && !m.motor.on); }, 900000, 500); await _sleep(1000); } },
                ],
                check() {
                    const m = _model(_sysOf(this));
                    return !!(m && m.state === 'STANDSTILL' && !m.motor.on && m.bowl.speed < 100);
                },
            },
        ],
    },
};
