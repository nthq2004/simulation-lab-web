/**
 * 船舶分油机（S 型 / EPC-60）自动控制仿真项目配置
 *
 * 页 1：分油机运行状态仪
 * 页 2：S 型分油机系统流程 + 机旁控制箱
 * 页 3：EPC-60 控制面板 + 系统模拟图
 */
import { EPC60Panel } from '../components/EPC60Panel.js';
import { EPC60SystemMimic } from '../components/EPC60SystemMimic.js';
import { PurifierStatusPanel } from '../components/PurifierStatusPanel.js';
import { PurifierSystem } from '../components/PurifierSystem.js';
import { PurifierLocalPanel } from '../components/PurifierLocalPanel.js';

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
// 页面定义
// ═══════════════════════════════════════════════════════════════

const INSTRUMENTS = ['multimeter', 'mf47-panel', 'osc', 'sg', 'cali', 'elecmeter', 'megohm'];

export const PROJECT_PAGES = [
    { id: 0, name: '索引', type: 'index' },
    {
        id: 1, name: '分油机运行状态',
        comps: ['status', ...INSTRUMENTS],
        desc: '分油机运行状态仪：转速表、TT1、PT1、PT4、PT5、MT、流量、运行时间、排渣次数、分离筒示意、油柜液位、报警列表与下次排渣倒计时。',
    },
    {
        id: 2, name: 'S 型分油机系统与机旁控制',
        comps: ['process', 'local', ...INSTRUMENTS],
        desc: '左侧：S 型分油机系统流程（沉淀柜、供油泵、滤器、加热器、转换阀、分油机半剖、净油柜、排渣柜、工作水模块 SV10/SV15/SV16、控制空气）。右侧：机旁控制箱（主电源转换开关 OFF/ON、控制方式转换开关 HAND/EPC、起动/停止、应急停止、供油泵、加热器、压力表、振动、报警）。',
    },
    {
        id: 3, name: 'EPC-60 面板与系统模拟图',
        comps: ['epc', 'mimic', ...INSTRUMENTS],
        desc: '左侧：EPC-60 控制面板（LCD、数字键盘、功能键、电源开关、应急停止、电流表）。右侧：EPC-60 系统模拟图（管线、SV4/SV1/SV10/SV15/SV16/SV5、传感器、分油机、加热器、温度控制器、冷却水）。',
    },
];

// ═══════════════════════════════════════════════════════════════
// 组件配置（1920 × 1080 基准坐标）
// ═══════════════════════════════════════════════════════════════

export const componentConfigs = [
    { Class: PurifierStatusPanel, id: 'status', x: 40, y: 20, page: 1, width: 1060, height: 840, visible: true },

    { Class: PurifierSystem, id: 'process', x:-160, y: 25, page: 2, width: 1190, height: 830, visible: true },
    { Class: PurifierLocalPanel, id: 'local', x: 1250, y: 40, page: 2, width: 420, height: 812, visible: true },

    { Class: EPC60Panel, id: 'epc', x: -200, y: 40, page: 3, width: 680, height: 730, visible: true },
    { Class: EPC60SystemMimic, id: 'mimic', x: 510, y: 40, page: 3, width: 1060, height: 760, visible: true },

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
    sys.pageIndexTitle = '船舶分油机自动控制 · 页面索引';
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
function _process(sys) { return _comp(sys, 'process'); }
function _local(sys) { return _comp(sys, 'local'); }

async function _epcClick(sys, part, times = 1, gap = 220) {
    for (let i = 0; i < times; i++) {
        _firePartClick(_epc(sys), part);
        await _sleep(gap);
    }
}

async function _setEpcPower(sys, on) {
    const s = _solver(sys);
    if (!s) return false;
    for (let i = 0; i < 6 && s.m.epcPower !== !!on; i++) {
        _firePartClick(_epc(sys), 'power');
        await _sleep(350);
    }
    return s.m.epcPower === !!on;
}

async function _ensureMainPower(sys, on = true) {
    const s = _solver(sys);
    if (!s) return false;
    for (let i = 0; i < 5 && s.m.mainPower !== !!on; i++) {
        _firePartClick(_local(sys), 'main-power');
        await _sleep(300);
    }
    return s.m.mainPower === !!on;
}

async function _ensureRemote(sys) {
    const s = _solver(sys);
    if (!s) return false;
    for (let i = 0; i < 5 && s.m.local; i++) {
        _firePartClick(_local(sys), 'local-remote');
        await _sleep(300);
    }
    // 档位到端点不循环，兜底直接置位
    if (s.m.local && s.setCtrlMode) s.setCtrlMode('EPC');
    return !s.m.local;
}

async function _ensureLocal(sys) {
    const s = _solver(sys);
    if (!s) return false;
    for (let i = 0; i < 5 && !s.m.local; i++) {
        _firePartClick(_local(sys), 'local-remote');
        await _sleep(300);
    }
    // 档位到端点不循环（AUTO 档连续右点不动），兜底直接置位
    if (!s.m.local && s.setCtrlMode) s.setCtrlMode('HAND');
    return !!s.m.local;
}

async function _ensureSupply(sys) {
    const s = _solver(sys);
    const p = _process(sys);
    if (!s) return false;
    for (let i = 0; i < 4 && !s.m.water.mainOpen; i++) { _firePartClick(p, 'water-inlet'); await _sleep(260); }
    for (let i = 0; i < 4 && !s.m.water.airMainOpen; i++) { _firePartClick(p, 'air-inlet'); await _sleep(260); }
    for (let i = 0; i < 4 && !s.m.feed.steamValveOpen; i++) { _firePartClick(p, 'steam-inlet'); await _sleep(260); }
    for (let i = 0; i < 4 && !s.m.feed.dirtyValveOpen; i++) { _firePartClick(p, 'dirty-outlet-valve'); await _sleep(260); }
    for (let i = 0; i < 4 && !s.m.feed.returnValveOpen; i++) { _firePartClick(p, 'return-valve'); await _sleep(260); }
    await _waitFor(sys, x => _model(x).water.supply > 2 && _model(x).water.air > 5, 6000, 200);
    return s.m.water.mainOpen && s.m.water.airMainOpen;
}

async function _ensurePump(sys, on) {
    const s = _solver(sys);
    if (!s) return false;
    for (let i = 0; i < 5 && s.m.feed.pumpOn !== !!on; i++) {
        _firePartClick(_local(sys), 'feed-pump');
        await _sleep(280);
    }
    return s.m.feed.pumpOn === !!on;
}

async function _ensureHeater(sys, on) {
    const s = _solver(sys);
    if (!s) return false;
    for (let i = 0; i < 5 && s.m.feed.heaterOn !== !!on; i++) {
        _firePartClick(_local(sys), 'heater');
        await _sleep(280);
    }
    return s.m.feed.heaterOn === !!on;
}

async function _ensureValve(sys, id, on) {
    const s = _solver(sys);
    if (!s) return false;
    const get = () => id === 'v1' ? s.m.feed.valveOpen
        : id === 'v5' ? s.m.water.drain : s.m.water[id];
    for (let i = 0; i < 5 && get() !== !!on; i++) {
        _firePartClick(_process(sys), id);
        await _sleep(280);
    }
    return get() === !!on;
}

async function _ensureStarted(sys) {
    await _setEpcPower(sys, true);
    await _ensureMainPower(sys, true);
    await _ensureRemote(sys);
    await _ensureSupply(sys);
    const s = _solver(sys);
    if (!s) return false;
    // 若上一次停机程序尚未结束，先等它回到 STANDSTILL
    if (!['STANDSTILL', 'STARTING', 'START_SEQ', 'STANDBY', 'SEPARATION'].includes(s.m.state)) {
        await _waitFor(sys, x => _model(x).state === 'STANDSTILL', 900000, 300);
    }
    if (s.m.state === 'STANDSTILL') {
        _firePartClick(_epc(sys), 'separation');
        await _sleep(500);
    }
    return _waitFor(sys, x => {
        const m = _model(x);
        return m && ['STARTING', 'START_SEQ', 'STANDBY', 'SEPARATION'].includes(m.state);
    }, 20000, 250);
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
    // 回到主界面
    for (let i = 0; i < 4 && u.page !== 'main'; i++) { _firePartClick(epc, 'info'); await _sleep(220); }
    // 进入菜单
    _firePartClick(epc, 'enter'); await _sleep(260);
    // 菜单光标移到“参数设置”
    for (let i = 0; i < 6 && u.menu !== 0; i++) { _firePartClick(epc, 'minus'); await _sleep(180); }
    _firePartClick(epc, 'enter'); await _sleep(260);
    // 参数条目
    const items = epc._paramItems();
    const idx = items.findIndex(it => it[0] === key);
    if (idx < 0) return false;
    for (let i = 0; i < 20 && u.param !== idx; i++) {
        _firePartClick(epc, u.param < idx ? 'plus' : 'minus');
        await _sleep(160);
    }
    // 进入编辑
    _firePartClick(epc, 'enter'); await _sleep(220);
    const item = items[idx];
    const step = item[3] || 1;
    for (let i = 0; i < 300 && Math.abs(u.editVal - value) > step / 2; i++) {
        _firePartClick(epc, u.editVal < value ? 'plus' : 'minus');
        await _sleep(90);
    }
    // 保存
    _firePartClick(epc, 'enter'); await _sleep(280);
    // 返回主界面
    for (let i = 0; i < 4 && u.page !== 'main'; i++) { _firePartClick(epc, 'info'); await _sleep(200); }
    return Math.abs(s.getParam(key) - value) < step / 2;
}

async function _resetAlarms(sys) {
    const s = _solver(sys);
    if (!s) return false;
    for (let i = 0; i < 5; i++) {
        const active = s.m.alarms.some(a => a.active);
        if (!active) break;
        _firePartClick(_epc(sys), 'alarm-reset');
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
 * 按 EPC-60 五步起动把分油机送到 Ti68 正常分油（幂等：已完成的部分自动跳过）。
 * 顺序：主电源/EPC → 水气阀 → 问答确认 → 供油泵 → 加热器(≥96℃) → 电机(≥10000 r/min) → 分离程序
 */
async function _startToTi68(sys) {
    const s = _solver(sys);
    if (!s) return false;
    const m = s.m;
    const epc = _epc(sys);
    if (!epc) return false;
    await _setEpcPower(sys, true);
    await _ensureMainPower(sys, true);
    await _ensureRemote(sys);
    await _ensureSupply(sys);
    // 起动问询（未回答过）→ 回车确认
    if (epc._ui && !epc._ui.asked) {
        _firePartClick(epc, 'separation'); await _sleep(650);
        _firePartClick(epc, 'enter'); await _sleep(550);
    }
    if (!m.feed.pumpOn) { _firePartClick(epc, 'separation'); await _sleep(550); }
    await _waitFor(sys, x => _model(x).feed.pumpOn, 20000, 250);
    if (!m.feed.heaterOn) { _firePartClick(epc, 'separation'); await _sleep(550); }
    await _waitFor(sys, x => _model(x).feed.temp >= 96, 240000, 500);
    if (!m.motor.on) { _firePartClick(epc, 'separation'); await _sleep(550); }
    await _waitFor(sys, x => _model(x).bowl.speed >= 10000, 240000, 500);
    if (!m.prog) { _firePartClick(epc, 'separation'); await _sleep(800); }
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
                msg: '第 1 步：切换到页 3，识别 MIMIC 图组件（EPC-60 系统模拟图）。它用 P&ID 风格把沉淀柜、供油泵、滤器、加热器、三通阀 V1、分油机、净油柜、排渣柜、工作水电磁阀组 SV10/SV15/SV16 与控制空气回路画在一张图上，并带流动动画和传感器读数。',
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
        id: 'purifier-epc-panel', name: '2. EPC-60 控制器面板的认识',
        steps: [
            {
                msg: '第 1 步：切换到页 3，识别 EPC-60 控制器操作面板。面板上部是液晶显示屏与数字键盘，中部是起动 I / 停止 O 与 L 形排列的功能键区（每只功能键左上角带一只状态指示灯），右侧是返回 / ▲ / ▼ / i 导航键与回车键，下部是电源开关、应急停止按钮和电机电流表。',
                mode: 'find', target: 'epc',
            },
            {
                msg: '第 2 步：识别起动按钮「I」（绿色）。控制模式在 EPC 位、主电源合上后按此键，EPC-60 依次执行 5 步起动程序（第 1~8 屏），指示灯在起动过程闪烁、分离程序常亮、停机程序熄灭。',
                mode: 'find', target: 'epc', subTarget: 'separation',
            },
            {
                msg: '第 3 步：识别停止按钮「O」（红色）。正常分油（Ti68）期间按下会先走完排渣阶段，再依次执行停机置换与自动停机程序，最后回到 STANDSTILL。',
                mode: 'find', target: 'epc', subTarget: 'stop',
            },
            {
                msg: '第 4 步：识别供油泵状态指示。主电源合上且供油泵运行时亮绿灯。',
                mode: 'find', target: 'epc', subTarget: 'led-pump',
            },
            {
                msg: '第 5 步：识别加热器状态指示。主电源合上且加热器投入时亮绿灯。',
                mode: 'find', target: 'epc', subTarget: 'led-heater',
            },
            {
                msg: '第 6 步：识别分油机电机状态指示。电机运行时亮绿灯，停止时熄灭。',
                mode: 'find', target: 'epc', subTarget: 'led-motor',
            },
            {
                msg: '第 7 步：识别手动排渣按钮。分油处于待命或分油状态、转速正常时按下可立即执行一次排渣，排渣阶段该键指示灯闪烁。',
                mode: 'find', target: 'epc', subTarget: 'discharge',
            },
            {
                msg: '第 8 步：识别排渣泵按钮（CIP 左侧的泵图标功能键）。按下后该键指示灯亮，排渣泵把排渣柜的污渣泵出，排渣柜液位逐渐下降，降到 5% 以下自动停泵。',
                mode: 'find', target: 'epc', subTarget: 'bowl-icon',
            },
            {
                msg: '第 9 步：识别返回按钮（带箭头的导航键）。在固定显示画面按一次进入参数菜单，再按一次返回运行状态显示。',
                mode: 'find', target: 'epc', subTarget: 'back',
            },
            {
                msg: '第 10 步：识别向上按钮「▲」。菜单中用于上移光标；参数编辑时用于增大设定值；起动确认画面中用于在 YES / NO 之间切换。',
                mode: 'find', target: 'epc', subTarget: 'plus',
            },
            {
                msg: '第 11 步：识别向下按钮「▼」。菜单中用于下移光标；参数编辑时用于减小设定值；起动确认画面中用于在 YES / NO 之间切换。',
                mode: 'find', target: 'epc', subTarget: 'minus',
            },
            {
                msg: '第 12 步：识别回车按钮「↵」。用于确认起动问询、进入所选菜单项、确认参数修改值。',
                mode: 'find', target: 'epc', subTarget: 'enter',
            },
            {
                msg: '第 13 步：识别液晶显示屏。它分四行显示：当前程序步骤（Ti 定时器名称与剩余时间）、运行参数、报警文字及菜单 / 参数编辑界面。',
                mode: 'find', target: 'epc', subTarget: 'lcd',
            },
        ],
    },
    'purifier-start-stop': {
        id: 'purifier-start-stop', name: '3. 分油机的起动和停机',
        steps: [
            {
                msg: '第 1 步：切换到页 2，依次打开沉淀柜出口阀、回油阀和蒸汽进口截止阀——出口阀给供油泵供油，回油阀在起动阶段把油送回沉淀柜，蒸汽截止阀给加热器送汽。',
                mode: 'check',
                op: [
                    { type: 'page', page: 2, msg: '切换到页 2（S 型分油机系统与机旁控制）' },
                    { type: 'switch', target: 'process', part: 'dirty-outlet-valve', msg: '打开沉淀柜出口阀（沉淀柜 → 供油泵）',
                        async act() { const s = _sysOf(this); if (!_model(s).feed.dirtyValveOpen) { _firePartClick(_process(s), 'dirty-outlet-valve'); await _sleep(450); } } },
                    { type: 'switch', target: 'process', part: 'return-valve', msg: '打开回油阀（V1 回油口 → 沉淀柜）',
                        async act() { const s = _sysOf(this); if (!_model(s).feed.returnValveOpen) { _firePartClick(_process(s), 'return-valve'); await _sleep(450); } } },
                    { type: 'switch', target: 'process', part: 'steam-inlet', msg: '打开蒸汽进口截止阀（供加热器用汽）',
                        async act() { const s = _sysOf(this); if (!_model(s).feed.steamValveOpen) { _firePartClick(_process(s), 'steam-inlet'); await _sleep(450); } } },
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
                    { type: 'switch', target: 'process', part: 'air-inlet', msg: '打开控制空气进口阀，观察空气压力升到 5 bar 以上',
                        async act() { const s = _sysOf(this); if (!_model(s).water.airMainOpen) { _firePartClick(_process(s), 'air-inlet'); await _sleep(450); } await _waitFor(s, x => _model(x).water.air > 5, 15000, 250); } },
                    { type: 'switch', target: 'process', part: 'water-inlet', msg: '打开工作水进口阀，观察水压升到 2 bar 以上',
                        async act() { const s = _sysOf(this); if (!_model(s).water.mainOpen) { _firePartClick(_process(s), 'water-inlet'); await _sleep(450); } await _waitFor(s, x => _model(x).water.supply > 2, 15000, 250); } },
                ],
                check() {
                    const m = _model(_sysOf(this));
                    return !!(m && m.water.mainOpen && m.water.airMainOpen && m.water.supply > 2 && m.water.air > 5);
                },
            },
            {
                msg: '第 3 步：合上机旁主电源开关，把控制方式转换开关打到「EPC」——主电源合上后 EPC-60 面板同步得电，此后由 EPC-60 远程控制。',
                mode: 'check',
                op: [
                    { type: 'switch', target: 'local', part: 'main-power', msg: '合上机旁主电源开关（EPC-60 同步上电）',
                        async act() { const s = _sysOf(this); await _ensureMainPower(s, true); await _sleep(400); } },
                    { type: 'switch', target: 'local', part: 'local-remote', msg: '控制方式转换开关打到「EPC」',
                        async act() { const s = _sysOf(this); await _ensureRemote(s); await _sleep(400); } },
                ],
                check() {
                    const m = _model(_sysOf(this));
                    return !!(m && m.mainPower && m.epcPower && m.ctrlMode === 'EPC');
                },
            },
            {
                msg: '第 4 步：切换到页 3，按绿色「I」键，液晶屏显示起动问询（START PROGRAM? YES/NO）；用「▲」键把选项改成 NO，再按「↵」回车键确认回答。',
                mode: 'check',
                op: [
                    { type: 'page', page: 3, msg: '切换到页 3（EPC-60 面板与系统模拟图）' },
                    { type: 'btn', target: 'epc', part: 'separation', msg: '按「I」键，观察液晶屏出现起动问询',
                        async act() { const s = _sysOf(this); _firePartClick(_epc(s), 'separation'); await _sleep(700); } },
                    { type: 'btn', target: 'epc', part: 'plus', msg: '按「▲」向上键，把闪烁选项由 YES 改为 NO',
                        async act() { const s = _sysOf(this); _firePartClick(_epc(s), 'plus'); await _sleep(700); } },
                    { type: 'btn', target: 'epc', part: 'enter', msg: '按「↵」回车键确认回答',
                        async act() { const s = _sysOf(this); _firePartClick(_epc(s), 'enter'); await _sleep(700); } },
                ],
                check() {
                    const c = _epc(_sysOf(this));
                    return !!(c && c._ui && c._ui.asked && !c._ui.question);
                },
            },
            {
                msg: '第 5 步：再按一次「I」键，起动供油泵——泵把沉淀柜的燃油升压后经滤器、加热器送往 V1，此时 V1 在回油位，油经回流阀回到沉淀柜。',
                mode: 'check',
                op: [
                    { type: 'btn', target: 'epc', part: 'separation', msg: '按「I」键起动供油泵',
                        async act() { const s = _sysOf(this); _firePartClick(_epc(s), 'separation'); await _sleep(600); await _waitFor(s, x => _model(x).feed.pumpOn, 20000, 250); } },
                    { type: 'observe', target: 'mimic', part: 'pump', msg: '观察供油泵叶轮转动、进油管路与回油管路出现流动',
                        async act() { await _sleep(1500); } },
                ],
                check() {
                    const m = _model(_sysOf(this));
                    return !!(m && m.feed.pumpOn);
                },
            },
            {
                msg: '第 6 步：再按一次「I」键，起动加热器，等待进油温度升到 96 ℃ 以上（额定 98 ℃）。',
                mode: 'check',
                op: [
                    { type: 'btn', target: 'epc', part: 'separation', msg: '按「I」键起动加热器',
                        async act() { const s = _sysOf(this); _firePartClick(_epc(s), 'separation'); await _sleep(600); } },
                    { type: 'observe', target: 'mimic', part: 'tt1', msg: '观察 TT1 进油温度上升，蒸汽调节阀开度增大、蒸汽管路出现流动',
                        async act() { const s = _sysOf(this); await _waitFor(s, x => _model(x).feed.temp >= 96, 180000, 500); await _sleep(800); } },
                ],
                check() {
                    const m = _model(_sysOf(this));
                    return !!(m && m.feed.heaterOn && m.feed.temp >= 96);
                },
            },
            {
                msg: '第 7 步：再按一次「I」键，起动分油机电机，等待分离筒转速升到 10000 r/min 以上（额定 10680 r/min）。',
                mode: 'check',
                op: [
                    { type: 'btn', target: 'epc', part: 'separation', msg: '按「I」键起动分油机电机',
                        async act() { const s = _sysOf(this); _firePartClick(_epc(s), 'separation'); await _sleep(600); } },
                    { type: 'observe', target: 'mimic', part: 'st', msg: '观察 ST 转速上升、电机运行指示灯亮、电流表指示上升',
                        async act() { const s = _sysOf(this); await _waitFor(s, x => _model(x).bowl.speed >= 10000, 180000, 500); await _sleep(800); } },
                ],
                check() {
                    const m = _model(_sysOf(this));
                    return !!(m && m.motor.on && m.bowl.speed >= 10000);
                },
            },
            {
                msg: '第 8 步：再按一次「I」键，开始分离程序。观察液晶屏上的程序流程：排渣（Ti56）→ 放残（Ti57）→ 密封（Ti58）→ 流量校验（Ti59）→ 排渣（Ti60）→ 放残（Ti61）→ 密封（Ti62）→ 水封（Ti63）→ 进油（Ti64）→ 含水量检查（Ti65）→ 检漏（Ti66）→ 水分稳定基准（Ti67）→ 分油（Ti68）。稳定分油超过 240 s，期间注意密封水补偿（SV16 脉冲）与 V5 排水现象。',
                mode: 'check',
                op: [
                    { type: 'btn', target: 'epc', part: 'separation', msg: '按「I」键开始分离程序',
                        async act() { const s = _sysOf(this); _firePartClick(_epc(s), 'separation'); await _sleep(800); } },
                    { type: 'observe', target: 'epc', part: 'lcd', msg: '观察液晶屏逐步显示 Ti56~Ti68 各程序步骤',
                        async act() { const s = _sysOf(this); await _waitFor(s, x => { const m = _model(x); return !!(m && m.prog && m.phase === 3 && m.step >= 4); }, 600000, 500); await _sleep(1000); } },
                    { type: 'observe', target: 'mimic', part: 'sv16', msg: '观察分油期间密封水补偿脉冲（SV16）与 V5 排水阀动作',
                        async act() {
                            const s = _sysOf(this);
                            const flags = this._projFlag || (this._projFlag = {});
                            await _waitFor(s, x => { const m = _model(x); return !!(m && m.prog && m.phase === 3 && m.step >= 4 && m.timerT > 240); }, 600000, 500);
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
                msg: '第 9 步：手动按下「排渣」按钮（水流图标键），观察手动排渣过程：断油（Ti70）→ 进置换水（Ti71）→ 置换（Ti72）→ 冲洗向心管（Ti73）→ 排渣（Ti74）→ 放残（Ti75），随后自动重新进入分离程序，稳定分油超过 30 s。',
                mode: 'check',
                op: [
                    { type: 'btn', target: 'epc', part: 'discharge', msg: '按「排渣」键执行一次手动排渣',
                        async act() { const s = _sysOf(this); _firePartClick(_epc(s), 'discharge'); await _sleep(800); } },
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
                msg: '第 10 步：按下红色「O」键，开始分离停止程序——先执行阶段四排渣（Ti70~Ti75），再执行阶段五置换与密封（Ti81~Ti83），最后进入阶段六自动停机（Ti85 停电机 → Ti86 降速 → Ti87 停泵 → Ti89 静止），液晶屏最终显示 STANDSTILL。',
                mode: 'check',
                op: [
                    { type: 'btn', target: 'epc', part: 'stop', msg: '按「O」键开始分离停止程序',
                        async act() { const s = _sysOf(this); _firePartClick(_epc(s), 'stop'); await _sleep(800); } },
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
    'purifier-fault': {
        id: 'purifier-fault', name: '4. 分油机故障的处理',
        steps: [
            {
                msg: '第 1 步：按流程 3 的方法起动分油机——打开沉淀柜出口阀、回油阀、蒸汽截止阀与控制空气、工作水截止阀，合上主电源并把控制方式打到 EPC，然后在页 3 用「I」键依次完成问答确认、供油泵、加热器（≥96 ℃）、电机（≥10000 r/min）与分离程序，一直等到进入 Ti68 正常分油。',
                mode: 'check',
                op: [
                    { type: 'page', page: 2, msg: '切换到页 2（S 型分油机系统与机旁控制）' },
                    { type: 'switch', target: 'process', part: 'dirty-outlet-valve', msg: '打开沉淀柜出口阀、回油阀与蒸汽进口截止阀',
                        async act() {
                            const s = _sysOf(this);
                            const m = _model(s);
                            const pairs = [['dirty-outlet-valve', 'dirtyValveOpen'], ['return-valve', 'returnValveOpen'], ['steam-inlet', 'steamValveOpen']];
                            for (const [part, key] of pairs) {
                                if (!m.feed[key]) { _firePartClick(_process(s), part); await _sleep(400); }
                            }
                            await _ensureSupply(s);
                        } },
                    { type: 'switch', target: 'process', part: 'air-inlet', msg: '确认控制空气（>5 bar）与工作水（>2 bar）截止阀已打开',
                        async act() { const s = _sysOf(this); await _ensureSupply(s); await _sleep(500); } },
                    { type: 'switch', target: 'local', part: 'main-power', msg: '合上机旁主电源，控制方式转换开关打到「EPC」',
                        async act() { const s = _sysOf(this); await _ensureMainPower(s, true); await _ensureRemote(s); await _sleep(500); } },
                    { type: 'page', page: 3, msg: '切换到页 3（EPC-60 面板）' },
                    { type: 'btn', target: 'epc', part: 'separation', msg: '按「I」键完成五步起动，直到进入 Ti68 正常分油',
                        async act() { const s = _sysOf(this); await _startToTi68(s); await _sleep(1000); } },
                ],
                check() {
                    const m = _model(_sysOf(this));
                    return !!(m && m.prog && m.phase === 3 && m.step >= 4);
                },
            },
            {
                msg: '第 2 步：设置「分离筒密封失效 / 跑油」故障。现象：A03 OIL LEAKING FROM BOWL 报警，净油出口压力 PT4 迅速下降，控制器立即切断进油（V1 切回油位、V4 关闭）并按停机程序停机。处理措施：停车检查活动排渣底盘密封面与密封水系统，检查开启水／密封水电磁阀 SV15、SV16 是否动作到位，密封水压力是否正常，缺陷消除后复位报警再重新起动。',
                mode: 'check',
                op: [
                    { type: 'fault', fault: 'bowl-leak', msg: '勾选「分离筒密封失效 / 跑油」并应用设置',
                        async act() { await _sleep(600); } },
                    { type: 'observe', target: 'epc', part: 'lcd', msg: '观察液晶屏上的 A03 报警与随之进入的停机程序',
                        async act() { const s = _sysOf(this); await _waitFor(s, x => { const m = _model(x); return !!(m && m.alarms.some(a => a.code === 'A03' && a.active)); }, 20000, 300); await _sleep(2000); } },
                    { type: 'observe', target: 'mimic', part: 'pt4', msg: '观察 PT4 净油出口压力迅速下降、V1 切到回流位、V4 关闭，转速电流随排渣/停机过程变化',
                        async act() { await _sleep(3000); } },
                ],
                check() {
                    const m = _model(_sysOf(this));
                    return !!(m && m.faults.leak && m.alarms.some(a => a.code === 'A03' && a.active));
                },
            },
            {
                msg: '第 3 步：复位「分离筒密封失效」故障并重新起动。先取消该故障、按「ALARM RESET」复位报警，等停机程序走完分油机完全静止后，再按「I」键依次起动到 Ti68 正常分油，确认故障已消除。',
                mode: 'check',
                op: [
                    { type: 'fault', fault: 'bowl-leak', repair: true, msg: '取消勾选「分离筒密封失效 / 跑油」并应用设置',
                        async act() { await _sleep(600); } },
                    { type: 'btn', target: 'epc', part: 'alarm-reset', msg: '按「ALARM RESET」键复位报警',
                        async act() { const s = _sysOf(this); await _resetAlarms(s); await _sleep(400); } },
                    { type: 'observe', target: 'epc', part: 'lcd', msg: '等待停机程序结束、分离筒完全静止（STANDSTILL）',
                        async act() { const s = _sysOf(this); await _waitStandstill(s); await _sleep(600); } },
                    { type: 'btn', target: 'epc', part: 'separation', msg: '重新起动分油机，直到进入 Ti68 正常分油',
                        async act() { const s = _sysOf(this); await _startToTi68(s); await _sleep(1000); } },
                ],
                check() {
                    const m = _model(_sysOf(this));
                    return !!(m && !m.faults.leak && m.prog && m.phase === 3 && m.step >= 4);
                },
            },
            {
                msg: '第 4 步：设置「水分传感器故障」。现象：A11 TRANSDUCER - NO RESPONSE 报警，MT 液晶显示 NC（无读数），控制器无法自动判断净油含水量，V5 自动排水失去依据。处理措施：加强人工取样化验与手动排水，检查 ALCAP 水分传感器（MT）的接线与测量腔是否污染、堵塞，检修或更换后复位报警。',
                mode: 'check',
                op: [
                    { type: 'fault', fault: 'transducer', msg: '勾选「水分传感器故障」并应用设置',
                        async act() { await _sleep(600); } },
                    { type: 'observe', target: 'mimic', part: 'mt', msg: '观察 MT 显示 NC、A11 报警灯亮起，分油仍继续但水分无法监视',
                        async act() { const s = _sysOf(this); await _waitFor(s, x => { const m = _model(x); return !!(m && m.alarms.some(a => a.code === 'A11' && a.active)); }, 20000, 300); await _sleep(2500); } },
                ],
                check() {
                    const m = _model(_sysOf(this));
                    return !!(m && m.faults.transducer && m.alarms.some(a => a.code === 'A11' && a.active));
                },
            },
            {
                msg: '第 5 步：复位「水分传感器故障」，冲洗后重新起动。取消故障、复位报警，等分油机静止后按「I」键重新起动到 Ti68，观察 MT 恢复正常读数（Ti65 水分检查后显示 pF 值）。',
                mode: 'check',
                op: [
                    { type: 'fault', fault: 'transducer', repair: true, msg: '取消勾选「水分传感器故障」并应用设置',
                        async act() { await _sleep(600); } },
                    { type: 'btn', target: 'epc', part: 'alarm-reset', msg: '按「ALARM RESET」键复位报警',
                        async act() { const s = _sysOf(this); await _resetAlarms(s); await _sleep(400); } },
                    { type: 'btn', target: 'epc', part: 'stop', msg: '按「O」键停止当前分离程序（冲洗后重新起动）',
                        async act() { const s = _sysOf(this); const m = _model(s); if (m && m.prog) _firePartClick(_epc(s), 'stop'); await _sleep(700); } },
                    { type: 'observe', target: 'epc', part: 'lcd', msg: '等待分油机静止（STANDSTILL）',
                        async act() { const s = _sysOf(this); await _waitStandstill(s); await _sleep(600); } },
                    { type: 'btn', target: 'epc', part: 'separation', msg: '重新起动分油机，直到进入 Ti68 正常分油',
                        async act() { const s = _sysOf(this); await _startToTi68(s); await _sleep(1000); } },
                ],
                check() {
                    const m = _model(_sysOf(this));
                    return !!(m && !m.faults.transducer && m.prog && m.phase === 3 && m.step >= 4);
                },
            },
            {
                msg: '第 6 步：设置「分油温度低（加热器故障）」。现象：加热器停止投入，A05 OIL FEED TEMPERATURE - LOW 报警，TT1 油温下降；油温低于分离温度后控制器切断进油并停机（低温保护，防止分离效果恶化、跑油）。处理措施：检查蒸汽截止阀开度、蒸汽压力与电动调节阀、温度控制器及加热器疏水，恢复加热后复位报警再重新起动。',
                mode: 'check',
                op: [
                    { type: 'fault', fault: 'temp-low', msg: '勾选「分油温度低（加热器故障）」并应用设置',
                        async act() { await _sleep(600); } },
                    { type: 'observe', target: 'mimic', part: 'tt1', msg: '观察 TT1 油温下降、A05 报警，进油被切断后分油程序转入停机',
                        async act() { const s = _sysOf(this); await _waitFor(s, x => { const m = _model(x); return !!(m && m.alarms.some(a => a.code === 'A05' && a.active)); }, 20000, 300); await _sleep(3000); } },
                ],
                check() {
                    const m = _model(_sysOf(this));
                    return !!(m && m.faults.tempLow && m.alarms.some(a => a.code === 'A05' && a.active));
                },
            },
        ],
    },
};
