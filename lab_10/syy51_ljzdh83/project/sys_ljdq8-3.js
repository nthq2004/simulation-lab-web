/**
 * 船舶主机高温冷却水（缸套淡水）温度控制系统 —— 仿真项目配置（单页工程）
 *
 * 依据：第八章第二节「冷却水温度控制系统的功能测试」（冷却水系统图.png / 船舶冷却水系统MIMIC图.svg）
 *
 * 同屏两台设备（1920×1080 基准）：
 *   ldcl    LDCL 冷却水温度控制器（TEMP / Ctrl 显示、Automatic / Manual、操作键、报警灯排）
 *   mimic   主机高温冷却水系统 MIMIC（主机、加热器、造水机、冷却泵、冷却器、除气柜、膨胀水柜及各阀门）
 *
 * 约定（与全局 AGENTS.md「最新范式」一致）：
 *   · 单页工程：导出 PROJECT_PAGES = []，consys.js 不创建 PageManager，工作流不写 page op
 *   · 默认不接线；「自动投用 / 起动系统」只做工艺与控制器预设
 *   · 按钮 / 旋钮 / 开关一律模拟真实点击（getClickablePartNode(...).fire('click')），不直接改内部字段
 *   · 故障一律走「故障设置」界面（op.type='fault'）
 *   · 等待一律条件轮询 _waitFor，不写死 sleep
 */
import { CoolingWaterMimic } from '../components/CoolingWaterMimic.js';
import { CoolingWaterPID } from '../components/CoolingWaterPID.js';

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
const _solver = (sys) => (sys && sys.coolingSolver) ? sys.coolingSolver : null;
const _m = (sys) => { const s = _solver(sys); return s ? s.m : null; };
const _mimic = (sys) => _comp(sys, 'mimic');
const _ldcl = (sys) => _comp(sys, 'ldcl');

// ═══════════════════════════════════════════════════════════════
// 组件配置
// ═══════════════════════════════════════════════════════════════

export const componentConfigs = [
    { Class: CoolingWaterMimic, id: 'mimic', x: 26, y: 16, width: 1360, height: 750, visible: true },
    { Class: CoolingWaterPID, id: 'ldcl', x: 1420, y: 120, width: 330, height: 330, visible: true },

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

/** 工具栏「自动投用」：两台冷却泵 MAN 起动、控制方式 AUTO，不改变阀门与设定值 */
export function applyAllPresets(opts) {
    if (opts && opts.init) return;
    const sys = _sysOf(this);
    const s = _solver(sys);
    if (!s) return;
    const m = s.m;
    // 工艺阀位：加热器出口 / 造水机进出口按运行工况关闭（本工程默认只走旁通与冷却器）
    m.sw.wbV25S = true; m.sw.wbV27S = false;
    m.sw.wbV6S = true; m.sw.wbV7S = false;
    m.sw.wbV4 = false; m.sw.wbV26S = false;
    m.sw.wbV28S = true; m.sw.wbV5 = true;
    m.sw.wbV8 = true; m.sw.wbV9 = true;
    m.sw.wbV502 = true; m.sw.wbV12S = true; m.sw.wbV13S = true; m.sw.wbV15S = true;
    m.mode = 'AUTO';
    m.tempCtrl = 'AUTO';
    m.panelMain = true;
    s.startPump('cw1');
    s.startPump('cw2');
    if (sys.redrawAll) sys.redrawAll();
    s._tip('自动投用：2 台高温冷却淡水泵手动起动，控制方式 Automatic，温度定值控制投入');
}

/** 工具栏「起动系统」：快速进入自动温度控制（泵起动 + 自动方式 + 等待温度接近设定值） */
export async function applyStartSystem() {
    const sys = _sysOf(this);
    const s = _solver(sys);
    if (!s) return;
    // 复位工艺状态，但保留「故障设置」里已设置的故障
    const keepFaults = { ...s.m.faults };
    Object.assign(s.m.sw, {
        wbV25S: true, wbV27S: false, wbV6S: true, wbV7S: false,
        wbV4: false, wbV26S: false, wbV28S: true, wbV5: true,
        wbV8: true, wbV9: true, wbV502: true, wbV12S: true, wbV13S: true, wbV15S: true,
    });
    s.m.mode = 'AUTO';
    s.m.tempCtrl = 'AUTO';
    s.m.manualOut = 30;
    s.m.integral = 0;
    s.m.loadNom = null;
    s.m.heatherOn = false;
    s.m.tank = Math.max(45, s.m.tank || 0);
    s.m.alarms.forEach(a => { a.active = false; a.ack = true; a.timer = 0; });
    Object.assign(s.m.faults, keepFaults);
    s.startPump('cw1');
    s.startPump('cw2');
    await _sleep(600);
    if (sys.redrawAll) sys.redrawAll();
    s._tip('起动系统：冷却水泵运行、Automatic 温度定值控制投入，等待水温回到设定值');
}

/** 工具栏「5 点步进」：起泵 → 手动加大操作量 → 自动回收 → 投蒸汽加热 → 报警复位 */
export function fiveStep() {
    const sys = _sysOf(this);
    const s = _solver(sys);
    if (!s) return;
    if (sys._fiveStepIdx === undefined) sys._fiveStepIdx = 0;
    const idx = sys._fiveStepIdx % 5;
    sys._fiveStepIdx = idx + 1;
    const m = s.m;
    switch (idx) {
        case 0: s.startPump('cw1'); s.startPump('cw2'); s._tip('① 起动 1#、2# 高温冷却淡水泵'); break;
        case 1: s.manualTakeover(); s.m.manualOut = 70; s._tip('② 调节阀转 MANU，操作量加到 70 %'); break;
        case 2: s.manualTakeover(); s.m.manualOut = 30; s._tip('③ 操作量减到 30 %（冷却器全开）'); break;
        case 3: s.autoTakeover(); s.m.mode = 'AUTO'; s._tip('④ 控制方式 Automatic：温度按设定值自动调节'); break;
        case 4: s.m.heatherOn = true; m.sw.wbV25S = true; s._tip('⑤ 投入缸套水加热器蒸汽（注意温度上升）'); break;
        default: break;
    }
    if (sys.redrawAll) sys.redrawAll();
}

// ═══════════════════════════════════════════════════════════════
// 故障配置
// ═══════════════════════════════════════════════════════════════

function _faults() {
    const s = _solver(window.sys);
    return s ? s.m.faults : null;
}

function _mkFault(id, name, system, key, alarm) {
    return {
        id, name, system, alarm,
        check() { const f = _faults(); return !!(f && f[key]); },
        trigger() { const s = _solver(window.sys); if (s) s.setFault(key, true); },
        repair() { const s = _solver(window.sys); if (s) s.setFault(key, false); },
    };
}

export const FAULT_CONFIGS = {
    'tt-fault': _mkFault('tt-fault', 'TC 温度变送器故障（读数为 ***）', '温度检测', 'tt', ''),
    'pump1-fault': _mkFault('pump1-fault', '1 号冷却泵电机故障', '冷却水泵', 'pump1', 'A 21'),
    'pump2-fault': _mkFault('pump2-fault', '2 号冷却泵电机故障', '冷却水泵', 'pump2', 'A 21'),
    'valve-stuck': _mkFault('valve-stuck', '冷却水调节阀卡涩', '温度调节', 'valve', 'A 11'),
    'controller-fault': _mkFault('controller-fault', 'LDCL 控制器故障（输出固定）', '控制器', 'controller', ''),
    'tank-leak': _mkFault('tank-leak', '膨胀水柜泄漏', '淡水系统', 'leak', 'A 31'),
};

// ═══════════════════════════════════════════════════════════════
// 工作流辅助
// ═══════════════════════════════════════════════════════════════

function _firePartClick(comp, partId) {
    if (!comp) return false;
    try {
        const node = comp.getClickablePartNode && comp.getClickablePartNode(partId);
        if (node && typeof node.fire === 'function') { node.fire('click'); return true; }
    } catch (e) { /* ignore */ }
    return false;
}

async function _waitFor(sys, cond, timeoutMs = 60000, intervalMs = 250) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
        try { if (cond(sys)) return true; } catch (e) { /* ignore */ }
        await _sleep(intervalMs);
    }
    try { return !!cond(sys); } catch (e) { return false; }
}

/** 在 MIMIC / 控制器上真实点击部件 */
async function _click(sys, compId, partId) {
    _firePartClick(_comp(sys, compId), partId);
    await _sleep(350);
}

/** 点击到条件满足为止（模拟"像真的一样点击"，直到目标状态达成） */
async function _clickUntil(sys, compId, partId, cond, tries = 6) {
    for (let i = 0; i < tries; i++) {
        if (cond(sys)) return true;
        await _click(sys, compId, partId);
    }
    return !!cond(sys);
}

/** 阀门开到指定状态（点击到状态一致） */
async function _setValve(sys, compId, partId, swKey, open) {
    for (let i = 0; i < 3; i++) {
        const m = _m(sys);
        if (!m || m.sw[swKey] === open) return true;
        await _click(sys, compId, partId);
    }
    return !!(_m(sys) && _m(sys).sw[swKey] === open);
}

/** 起动泵（面板按钮，真实点击） */
async function _pumpStart(sys, id) {
    return _clickUntil(sys, 'mimic', id + '-start', s => _m(s).pumps[id].run && _m(s).pumps[id].mode === 'MAN', 4);
}

/** 停止泵 */
async function _pumpStop(sys, id) {
    return _clickUntil(sys, 'mimic', id + '-stop', s => !_m(s).pumps[id].run, 4);
}

/** 控制方式：旋钮点右半区 = Automatic，左半区 = Manual */
async function _setMode(sys, auto) {
    _firePartClick(_ldcl(sys), auto ? 'mode-knob' : 'mode-knob-ccw');
    await _sleep(350);
    return _m(sys).mode === (auto ? 'AUTO' : 'MANU');
}

/** 调节阀：LDCL 面板 Ctrl 行 → 手动 / 自动 */
async function _setRegManu(sys) {
    if (!_solver(sys).autoActive()) return true;
    await _click(sys, 'ldcl', 'ctrl-manu');
    return _waitFor(sys, s => !_solver(s).autoActive(), 5000, 150);
}

async function _setRegAuto(sys) {
    if (_solver(sys).autoActive()) return true;
    await _click(sys, 'ldcl', 'ctrl-auto');
    await _sleep(200);
    return _solver(sys).autoActive();
}

/** 起泵 + 全自动（幂等批量起动，用于各流程开头） */
async function _startAll(sys) {
    await _setValve(sys, 'mimic', 'wb-v502', 'wbV502', true);
    await _setValve(sys, 'mimic', 'wb-v12s', 'wbV12S', true);
    await _setValve(sys, 'mimic', 'wb-v13s', 'wbV13S', true);
    await _setValve(sys, 'mimic', 'wb-v15s', 'wbV15S', true);
    await _setValve(sys, 'mimic', 'wb-v5', 'wbV5', true);
    await _setValve(sys, 'mimic', 'wb-v8', 'wbV8', true);
    await _setValve(sys, 'mimic', 'wb-v9', 'wbV9', true);
    await _setMode(sys, true);
    await _pumpStart(sys, 'cw1');
    await _pumpStart(sys, 'cw2');
    await _setRegAuto(sys);
    return _waitFor(sys, s => _m(s).psUp, 20000, 200);
}

/** 手动把操作量调到目标附近（点 LDCL 的 M / P 键） */
async function _manipTo(sys, target, tol = 4) {
    const ldcl = _ldcl(sys);
    for (let i = 0; i < 80; i++) {
        const u = _m(sys).manip;
        if (Math.abs(u - target) <= tol) return true;
        _firePartClick(ldcl, u < target ? 'key-plus' : 'key-minus');
        await _sleep(120);
    }
    return Math.abs(_m(sys).manip - target) <= tol;
}

/** 设定值调整（SP − / +，0.5 ℃/次） */
async function _setpointTo(sys, target) {
    const ldcl = _ldcl(sys);
    for (let i = 0; i < 80; i++) {
        const sp = _m(sys).setTemp;
        if (Math.abs(sp - target) < 0.01) return true;
        _firePartClick(ldcl, sp < target ? 'set-plus' : 'set-minus');
        await _sleep(90);
    }
    return Math.abs(_m(sys).setTemp - target) < 0.01;
}

/** 报警复位（确认 → 复位） */
async function _resetAlarms(sys) {
    const ldcl = _ldcl(sys);
    _firePartClick(ldcl, 'alarm-ack');
    await _sleep(400);
    _firePartClick(ldcl, 'alarm-reset');
    await _sleep(400);
    return !(_m(sys).alarms || []).some(a => a.active && !a.ack);
}

// ═══════════════════════════════════════════════════════════════
// 工作流
// ═══════════════════════════════════════════════════════════════

export const PROJECT_WORKFLOWS = {
    'cw-identify': {
        id: 'cw-identify', name: '1. 冷却水温度控制系统的组成与认识',
        steps: [
            { msg: '第 1 步：识别主机高温冷却水系统模拟图。', mode: 'find', target: 'mimic' },
            { msg: '第 2 步：识别主机（柴油机）与缸套水出口。', mode: 'find', target: 'mimic', subTarget: 'engine' },
            { msg: '第 3 步：识别 TC 温度变送器（缸套水出口温度）。', mode: 'find', target: 'mimic', subTarget: 'tc' },
            { msg: '第 4 步：识别 1# 高温冷却淡水泵。', mode: 'find', target: 'mimic', subTarget: 'cw1' },
            { msg: '第 5 步：识别 2# 高温冷却淡水泵（备用）。', mode: 'find', target: 'mimic', subTarget: 'cw2' },
            { msg: '第 6 步：识别高温淡水冷却器。', mode: 'find', target: 'mimic', subTarget: 'cooler' },
            { msg: '第 7 步：识别冷却器支路调节阀（WB-V502）。', mode: 'find', target: 'mimic', subTarget: 'rv-cooler' },
            { msg: '第 8 步：识别旁通支路调节阀（WB-V12S）。', mode: 'find', target: 'mimic', subTarget: 'rv-bypass' },
            { msg: '第 9 步：识别除气柜。', mode: 'find', target: 'mimic', subTarget: 'deaerator' },
            { msg: '第 10 步：识别高温冷却水膨胀水柜。', mode: 'find', target: 'mimic', subTarget: 'tank' },
            { msg: '第 11 步：识别主机缸套水加热器。', mode: 'find', target: 'mimic', subTarget: 'heater' },
            { msg: '第 12 步：识别造水机（用缸套水做热源）。', mode: 'find', target: 'mimic', subTarget: 'distiller' },
            { msg: '第 13 步：识别 PT 压力变送器（泵吸入侧）。', mode: 'find', target: 'mimic', subTarget: 'pt' },
            { msg: '第 14 步：识别 PS 水流开关。', mode: 'find', target: 'mimic', subTarget: 'ps' },
            { msg: '第 15 步：识别高温冷却淡水泵面板（起动 / 停止）。', mode: 'find', target: 'mimic', subTarget: 'panel1' },
            { msg: '第 16 步：识别 LDCL 冷却水温度控制器。', mode: 'find', target: 'ldcl' },
            { msg: '第 17 步：识别 TEMP 温度显示（TC 实测值）。', mode: 'find', target: 'ldcl', subTarget: 'temp-auto' },
            { msg: '第 18 步：识别 Ctrl 操作量显示（旁通阀开度 %）。', mode: 'find', target: 'ldcl', subTarget: 'ctrl-auto' },
            { msg: '第 19 步：识别 LDCL 控制方式旋钮（Automatic / Manual）。', mode: 'find', target: 'ldcl', subTarget: 'mode-knob' },
            { msg: '第 20 步：识别报警复位按钮与报警灯排。', mode: 'find', target: 'ldcl', subTarget: 'alarm-reset' },
            {
                msg: '第 21 步：测试题——冷却水温度的控制手段。',
                mode: 'quiz',
                quizConfig: {
                    question: '主机缸套水温度偏高时，冷却水温度控制系统应如何动作？',
                    options: [
                        '开大旁通调节阀（Ctrl 增大），让更多缸套水绕过高温淡水冷却器，减少冷却量使温度上升受限；温度偏低时则关小旁通、加大经冷却器的流量',
                        '直接增加冷却水泵转速使温度下降',
                        '关闭膨胀水柜补水阀，减少水量带走热量',
                        '把造水机退出运行使缸套水温度下降',
                    ],
                    answer: 0,
                    analysis: '缸套水温度由"经高温淡水冷却器的冷却水量"决定。旁通阀与冷却器并联：旁通开度越大，经冷却器的份额越小、冷却越少、温度越高；反之温度下降。控制器的 Ctrl 输出就是旁通阀开度，形成温度—阀开度闭环。',
                },
            },
        ],
    },

    'cw-manual': {
        id: 'cw-manual', name: '2. 冷却水系统的手动操作',
        steps: [
            {
                msg: '第 1 步：把控制方式放在 Manual，确认调节阀由人工给定。',
                mode: 'check',
                op: [
                    { type: 'knob', target: 'ldcl', part: 'mode-knob-ccw', msg: '控制方式旋钮 → Manual', async act() { const s = _sysOf(this); await _setMode(s, false); } },
                    { type: 'observe', target: 'ldcl', part: 'ldcl-state', msg: '确认状态显示 Manual', async act() { const s = _sysOf(this); await _waitFor(s, x => _m(x).mode === 'MANU', 5000, 150); } },
                ],
                check() { return !!(_m(_sysOf(this)) && _m(_sysOf(this)).mode === 'MANU'); },
            },
            {
                msg: '第 2 步：打开冷却水泵吸入阀 WB-V8、WB-V9 与主管阀 WB-V5。',
                mode: 'check',
                op: [
                    { type: 'switch', target: 'mimic', part: 'wb-v8', msg: '打开 1# 泵吸入阀 WB-V8', async act() { await _setValve(_sysOf(this), 'mimic', 'wb-v8', 'wbV8', true); } },
                    { type: 'switch', target: 'mimic', part: 'wb-v9', msg: '打开 2# 泵吸入阀 WB-V9', async act() { await _setValve(_sysOf(this), 'mimic', 'wb-v9', 'wbV9', true); } },
                    { type: 'switch', target: 'mimic', part: 'wb-v5', msg: '打开主管截止阀 WB-V5', async act() { await _setValve(_sysOf(this), 'mimic', 'wb-v5', 'wbV5', true); } },
                ],
                check() {
                    const m = _m(_sysOf(this));
                    return !!(m && m.sw.wbV8 && m.sw.wbV9 && m.sw.wbV5);
                },
            },
            {
                msg: '第 3 步：按起动按钮起动 1#、2# 高温冷却淡水泵，观察排出压力升高。',
                mode: 'check',
                op: [
                    { type: 'btn', target: 'mimic', part: 'cw1-start', msg: '按 1 号泵 [起动]', async act() { const s = _sysOf(this); await _pumpStart(s, 'cw1'); } },
                    { type: 'btn', target: 'mimic', part: 'cw2-start', msg: '按 2 号泵 [起动]', async act() { const s = _sysOf(this); await _pumpStart(s, 'cw2'); } },
                    { type: 'observe', target: 'mimic', part: 'ps', msg: '观察 PS 水流开关接通、压力建立', async act() { const s = _sysOf(this); await _waitFor(s, x => _m(x).psUp, 20000, 200); } },
                ],
                check() {
                    const m = _m(_sysOf(this));
                    return !!(m && m.pumps.cw1.run && m.pumps.cw2.run && m.psUp && m.pressOut > 0.8);
                },
            },
            {
                msg: '第 4 步：打开冷却器支路 WB-V502 与旁通支路 WB-V12S、WB-V13S，建立水循环。',
                mode: 'check',
                op: [
                    { type: 'switch', target: 'mimic', part: 'wb-v502', msg: '打开 WB-V502', async act() { await _setValve(_sysOf(this), 'mimic', 'wb-v502', 'wbV502', true); } },
                    { type: 'switch', target: 'mimic', part: 'wb-v12s', msg: '打开旁通阀 WB-V12S', async act() { await _setValve(_sysOf(this), 'mimic', 'wb-v12s', 'wbV12S', true); } },
                    { type: 'switch', target: 'mimic', part: 'wb-v13s', msg: '打开除气柜入口阀 WB-V13S', async act() { await _setValve(_sysOf(this), 'mimic', 'wb-v13s', 'wbV13S', true); } },
                    { type: 'switch', target: 'mimic', part: 'wb-v15s', msg: '打开膨胀水柜出口阀 WB-V15S', async act() { await _setValve(_sysOf(this), 'mimic', 'wb-v15s', 'wbV15S', true); } },
                ],
                check() {
                    const m = _m(_sysOf(this));
                    return !!(m && m.sw.wbV502 && m.sw.wbV12S && m.sw.wbV13S && m.sw.wbV15S);
                },
            },
            {
                msg: '第 5 步：手动用 Ctrl 键把操作量加到约 40 %（开大旁通），观察温度上升。',
                mode: 'check',
                op: [
                    { type: 'btn', target: 'ldcl', part: 'key-minus', msg: '点 [−] 把关小旁通', async act() { const s = _sysOf(this); await _manipTo(s, 20); } },
                    { type: 'btn', target: 'ldcl', part: 'key-plus', msg: '点 [+] 把操作量加到约 40 %', async act() { const s = _sysOf(this); await _manipTo(s, 40); } },
                    { type: 'observe', target: 'mimic', part: 'gauge', msg: '观察缸套水温度随旁通开大而上升', async act() {
                        const s = _sysOf(this);
                        const t0 = _m(s).temp;
                        await _waitFor(s, x => _m(x).temp > t0 + 1, 60000, 250);
                    } },
                ],
                check() {
                    const m = _m(_sysOf(this));
                    return !!(m && m.manip >= 35 && m.manip <= 45);
                },
            },
            {
                msg: '第 6 步：手动把操作量减到约 20 %（关小旁通），观察温度下降。',
                mode: 'check',
                op: [
                    { type: 'btn', target: 'ldcl', part: 'key-minus', msg: '点 [−] 把关小旁通', async act() { const s = _sysOf(this); await _manipTo(s, 20); } },
                    { type: 'observe', target: 'mimic', part: 'gauge', msg: '观察缸套水温度随冷却器支路开大而下降', async act() {
                        const s = _sysOf(this);
                        const t0 = _m(s).temp;
                        await _waitFor(s, x => _m(x).temp < t0 - 0.5, 120000, 250);
                    } },
                ],
                check() {
                    const m = _m(_sysOf(this));
                    return !!(m && m.manip >= 15 && m.manip <= 25);
                },
            },
        ],
    },

    'cw-auto': {
        id: 'cw-auto', name: '3. 冷却水温度的自动控制',
        steps: [
            {
                msg: '第 1 步：起动两台冷却泵，控制方式旋钮放到 Automatic。',
                mode: 'check',
                op: [
                    { type: 'btn', target: 'mimic', part: 'cw1-start', msg: '按 1 号泵 [起动]', async act() { const s = _sysOf(this); await _pumpStart(s, 'cw1'); } },
                    { type: 'btn', target: 'mimic', part: 'cw2-start', msg: '按 2 号泵 [起动]', async act() { const s = _sysOf(this); await _pumpStart(s, 'cw2'); } },
                    { type: 'knob', target: 'ldcl', part: 'mode-knob', msg: '控制方式旋钮 → Automatic', async act() { const s = _sysOf(this); await _setMode(s, true); } },
                    { type: 'observe', target: 'ldcl', part: 'temp-tag', msg: '确认调节阀 TEMP 行切到 AUTO', async act() { const s = _sysOf(this); await _setRegAuto(s); } },
                ],
                check() {
                    const m = _m(_sysOf(this));
                    const s = _solver(_sysOf(this));
                    return !!(m && m.pumps.cw1.run && m.pumps.cw2.run && m.mode === 'AUTO' && s.autoActive());
                },
            },
            {
                msg: '第 2 步：把设定值改为 84.0 ℃，观察操作量 Ctrl 调节、温度跟随设定值。',
                mode: 'check',
                op: [
                    { type: 'btn', target: 'ldcl', part: 'set-minus', msg: '点 SP [−] 把设定值改为 84.0 ℃', async act() { const s = _sysOf(this); await _setpointTo(s, 84.0); } },
                    { type: 'observe', target: 'ldcl', part: 'ctrl-manu', msg: '观察 Ctrl 输出随偏差变化', async act() { const s = _sysOf(this); await _waitFor(s, x => Math.abs(_m(x).tcMeas - 84) < 1.2, 180000, 300); } },
                ],
                check() {
                    const m = _m(_sysOf(this));
                    return !!(m && Math.abs(m.setTemp - 84.0) < 0.01 && Math.abs(m.tcMeas - 84) < 1.5);
                },
            },
            {
                msg: '第 3 步：主机负荷变化后，观察控制器自动把温度调回设定值。',
                mode: 'check',
                op: [
                    { type: 'observe', target: 'mimic', part: 'engine', msg: '主机负荷由 64 % 增至 85 %（热负荷增大）', async act() { const s = _sysOf(this); _m(s).load = 85; await _sleep(1500); } },
                    { type: 'observe', target: 'ldcl', part: 'ctrl-auto', msg: '观察 Ctrl 自动增大后再稳定，温度回到设定值', async act() {
                        const s = _sysOf(this);
                        await _waitFor(s, x => Math.abs(_m(x).tcMeas - _m(x).setTemp) < 1.2, 180000, 300);
                    } },
                ],
                check() {
                    const m = _m(_sysOf(this));
                    return !!(m && m.load === 85 && Math.abs(m.tcMeas - m.setTemp) < 1.5);
                },
            },
            {
                msg: '第 4 步：把设定值改回 85.0 ℃，温度重新稳定。',
                mode: 'check',
                op: [
                    { type: 'btn', target: 'ldcl', part: 'set-plus', msg: '点 SP [+] 把设定值改回 85.0 ℃', async act() { const s = _sysOf(this); await _setpointTo(s, 85.0); } },
                    { type: 'observe', target: 'mimic', part: 'gauge', msg: '观察温度回到 85 ℃ 附近', async act() {
                        const s = _sysOf(this);
                        await _waitFor(s, x => Math.abs(_m(x).tcMeas - 85) < 1.2, 180000, 300);
                    } },
                ],
                check() {
                    const m = _m(_sysOf(this));
                    return !!(m && Math.abs(m.setTemp - 85) < 0.01 && Math.abs(m.tcMeas - 85) < 1.5);
                },
            },
            {
                msg: '第 5 步：测试题——为何调节阀要投"自动"。',
                mode: 'quiz',
                quizConfig: {
                    question: '冷却水泵全开、负荷变化时，温度控制为什么必须投 Automatic？',
                    options: [
                        '负荷与海水温度变化使热平衡不断改变，人工难以及时跟随；Automatic 下控制器按 TEMP 偏差自动调节 Ctrl，使温度稳定在设定值',
                        'Automatic 可以提高冷却水泵的扬程',
                        'Automatic 会关闭旁通阀，让水全部进入冷却器',
                        '自动控制只用于起动阶段，运行中不需要',
                    ],
                    answer: 0,
                    analysis: '负荷增加时主机放热量增加、温度上升，控制器按偏差增大旁通开度（Ctrl 增大）以减小冷却量；负荷减小则相反。人工调节滞后、误差大，自动控制才能保证缸套水温度稳定在设定值。',
                },
            },
        ],
    },

    'cw-fault': {
        id: 'cw-fault', name: '4. 冷却水温度控制系统的故障处理',
        steps: [
            {
                msg: '第 1 步：起动系统，进入 Automatic 温度定值控制，复位报警。',
                mode: 'check',
                op: [
                    { type: 'wire', button: 'btnStartSys', msg: '点击工具栏「起动系统」', flashMs: 1600, holdMs: 800,
                      async act() { const s = _sysOf(this); await s.applyStartSystem(); await _sleep(800); } },
                    { type: 'observe', target: 'ldcl', part: 'ldcl-state', msg: '等待温度稳定到设定值', async act() {
                        const s = _sysOf(this);
                        await _waitFor(s, x => _m(x).psUp && Math.abs(_m(x).tcMeas - _m(x).setTemp) < 1.5, 180000, 300);
                    } },
                    { type: 'btn', target: 'ldcl', part: 'alarm-reset', msg: '按「报警复位」', async act() { const s = _sysOf(this); await _resetAlarms(s); } },
                ],
                check() {
                    const m = _m(_sysOf(this));
                    return !!(m && m.mode === 'AUTO' && m.psUp && Math.abs(m.tcMeas - m.setTemp) < 2);
                },
            },
            {
                msg: '第 2 步：设置「1 号冷却泵电机故障」，观察备用泵与报警。',
                mode: 'check',
                op: [
                    { type: 'fault', fault: 'pump1-fault', msg: '勾选「1 号冷却泵电机故障」并应用设置', async act() { await _sleep(600); } },
                    { type: 'observe', target: 'mimic', part: 'cw1', msg: '1 号泵停转', async act() { const s = _sysOf(this); await _waitFor(s, x => !_m(x).pumps.cw1.run, 15000, 200); } },
                    { type: 'observe', target: 'mimic', part: 'cw2', msg: '2 号泵维持冷却水供应（压力不中断）', async act() { const s = _sysOf(this); await _waitFor(s, x => _m(x).pumps.cw2.run && _m(x).psUp, 15000, 200); } },
                    { type: 'observe', target: 'ldcl', part: 'alarm-reset', msg: '观察 LDCL 报警灯排', async act() { await _sleep(1200); } },
                ],
                check() {
                    const m = _m(_sysOf(this));
                    return !!(m && m.faults.pump1 && !m.pumps.cw1.run && m.pumps.cw2.run && m.psUp);
                },
            },
            {
                msg: '第 3 步：修复泵故障，起动 1 号泵，复位报警。',
                mode: 'check',
                op: [
                    { type: 'fault', fault: 'pump1-fault', repair: true, msg: '取消「1 号冷却泵电机故障」', async act() { await _sleep(600); } },
                    { type: 'btn', target: 'mimic', part: 'cw1-start', msg: '按 1 号泵 [起动]', async act() { const s = _sysOf(this); await _pumpStart(s, 'cw1'); } },
                    { type: 'btn', target: 'ldcl', part: 'alarm-reset', msg: '按「报警复位」', async act() { const s = _sysOf(this); await _resetAlarms(s); } },
                ],
                check() {
                    const m = _m(_sysOf(this));
                    return !!(m && !m.faults.pump1 && m.pumps.cw1.run && !m.alarms.some(a => a.active));
                },
            },
            {
                msg: '第 4 步：设置「TC 温度变送器故障」，观察 TEMP 显示 ***、自动调节切除。',
                mode: 'check',
                op: [
                    { type: 'fault', fault: 'tt-fault', msg: '勾选「TC 温度变送器故障」并应用设置', async act() { await _sleep(600); } },
                    { type: 'observe', target: 'ldcl', part: 'temp-tag', msg: 'TEMP 显示 ***，调节阀转 MANU 保持开度', async act() {
                        const s = _sysOf(this);
                        await _waitFor(s, x => !Number.isFinite(_solver(x).showValue()) && !_solver(x).autoActive(), 10000, 150);
                    } },
                    { type: 'observe', target: 'ldcl', part: 'ctrl-manu', msg: 'Ctrl 保持故障前开度', async act() { await _sleep(1500); } },
                ],
                check() {
                    const s = _solver(_sysOf(this));
                    const m = _m(_sysOf(this));
                    return !!(s && m && m.faults.tt && !Number.isFinite(s.showValue()) && !s.autoActive());
                },
            },
            {
                msg: '第 5 步：修复 TC 故障，恢复自动控制并复位报警。',
                mode: 'check',
                op: [
                    { type: 'fault', fault: 'tt-fault', repair: true, msg: '取消「TC 温度变送器故障」', async act() { await _sleep(600); } },
                    { type: 'btn', target: 'ldcl', part: 'ctrl-auto', msg: '调节阀 Ctrl → AUTO', async act() { const s = _sysOf(this); await _setRegAuto(s); } },
                    { type: 'btn', target: 'ldcl', part: 'alarm-reset', msg: '按「报警复位」', async act() { const s = _sysOf(this); await _resetAlarms(s); } },
                ],
                check() {
                    const s = _solver(_sysOf(this));
                    const m = _m(_sysOf(this));
                    return !!(s && m && !m.faults.tt && s.autoActive() && !m.alarms.some(a => a.active));
                },
            },
            {
                msg: '第 6 步：两台泵全停，观察冷却水中断导致主机保护停车。',
                mode: 'check',
                op: [
                    { type: 'btn', target: 'mimic', part: 'cw1-stop', msg: '按 1 号泵 [停止]', async act() { const s = _sysOf(this); await _pumpStop(s, 'cw1'); } },
                    { type: 'btn', target: 'mimic', part: 'cw2-stop', msg: '按 2 号泵 [停止]', async act() { const s = _sysOf(this); await _pumpStop(s, 'cw2'); } },
                    { type: 'observe', target: 'mimic', part: 'ps', msg: 'PS 水流开关断开', async act() { const s = _sysOf(this); await _waitFor(s, x => !_m(x).psUp, 20000, 200); } },
                    { type: 'observe', target: 'mimic', part: 'engine', msg: '主机保护停车（缸套水温度持续上升）', async act() {
                        const s = _sysOf(this);
                        await _waitFor(s, x => _m(x).tripped, 30000, 200);
                        await _waitFor(s, x => _m(x).tcMeas > _m(x).setTemp + 10 && _m(x).alarms.some(a => a.active && a.code === 'A11'), 600000, 500);
                    } },
                ],
                check() {
                    const m = _m(_sysOf(this));
                    return !!(m && m.tripped && !m.psUp && m.alarms.some(a => a.active && a.code === 'A11'));
                },
            },
        ],
    },
};

export const PROJECT_PAGES = [];
