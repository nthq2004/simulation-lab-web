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
    { Class: CoolingWaterMimic, id: 'mimic', x: -150, y: 50, width: 1360, height: 750, visible: true },
    { Class: CoolingWaterPID, id: 'ldcl', x: 1300, y: 550, width: 330, height: 290, visible: true },

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
    s.startPump('cw1');            // 只起动 1 台水泵
    s.setPumpMode('cw2', 'AUTO');  // 2 号泵方式旋钮置「自动」作备用（PS 低压力延时 3 s 自动投入）
    s.m.autoTimer = 0;
    s.m.autoLead = null;
    s.m.engineSw = true;   // 柴油机起停开关置于运行位（PS 建立后由联锁逻辑自动起动）
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
        wbV25S: false, wbV27S: false, wbV6S: true, wbV7S: false,   // 预热器出口截止阀保持截止
        wbV4: true, wbV26S: false, wbV28S: true, wbV5: true,       // 预热器并联阀保持导通
        wbV8: true, wbV9: true, wbV502: true, wbV12S: true, wbV13S: true, wbV15S: true,
    });
    s.m.mode = 'AUTO';
    s.m.tempCtrl = 'AUTO';
    s.m.manualOut = 70;
    s.m.integral = 0;
    s.m.loadNom = null;
    s.m.heatherOn = false;
    s.m.tank = Math.max(45, s.m.tank || 0);
    s.m.alarms.forEach(a => { a.active = false; a.ack = true; a.timer = 0; });
    Object.assign(s.m.faults, keepFaults);
    // 两台泵方式旋钮都打到「自动」，不直接给起动信号；
    // 由自动控制逻辑（PS 压力低 → 延时 3 s → 自动起动信号）自行起动一台，另一台备用
    s.setPumpMode('cw1', 'AUTO');
    s.setPumpMode('cw2', 'AUTO');
    s.m.autoTimer = 0;
    s.m.autoLead = null;
    s.m.engineSw = true;   // 柴油机起停开关置于运行位（PS 建立后由联锁逻辑自动起动）
    await _sleep(600);
    if (sys.redrawAll) sys.redrawAll();
    s._tip('起动系统：两台泵均置「自动」，Automatic 温度定值控制投入；PS 压力低将延时 3 s 自动起动一台（另一台备用）');
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
    'tt-fault': _mkFault('tt-fault', 'TT 温度变送器故障（读数为 ***）', '温度检测', 'tt', ''),
    'pump1-fault': _mkFault('pump1-fault', '1 号冷却泵电机故障', '冷却水泵', 'pump1', 'A 21'),
    'pump2-fault': _mkFault('pump2-fault', '2 号冷却泵电机故障', '冷却水泵', 'pump2', 'A 21'),
    'valve-stuck': _mkFault('valve-stuck', '冷却水调节阀卡涩', '温度调节', 'valve', 'A 11'),
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

/** 控制方式：A/M 单键切换（点按 'am'，直到方式与目标一致） */
async function _setMode(sys, auto) {
    const want = auto ? 'AUTO' : 'MANU';
    for (let i = 0; i < 4; i++) {
        if (_m(sys).mode === want) return true;
        _firePartClick(_ldcl(sys), 'am');
        await _sleep(250);
    }
    return _m(sys).mode === want;
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

/** 泵方式旋钮：点按直到方式为目标值（MAN / AUTO） */
async function _pumpMode(sys, id, mode) {
    const comp = sys.comps.mimic;
    for (let i = 0; i < 3; i++) {
        const p = _m(sys).pumps[id];
        if (!p || p.mode === mode) return true;
        _firePartClick(comp, id + '-mode');
        await _sleep(260);
    }
    return !!(_m(sys) && _m(sys).pumps[id].mode === mode);
}

/** LDCL 的 SET 长按（mousedown → 800 ms → mouseup） */
async function _setLong(ldcl) {
    const hit = ldcl && ldcl.getClickablePartNode && ldcl.getClickablePartNode('set');
    if (!hit) return false;
    hit.fire('mousedown');
    await _sleep(980);
    hit.fire('mouseup');
    if (ldcl) ldcl._longFired = false;   // 复位，避免影响后续短按
    return true;
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
            { msg: '第 3 步：识别 TT 温度变送器（缸套水出口温度）。', mode: 'find', target: 'mimic', subTarget: 'tt' },
            { msg: '第 4 步：识别 1# 高温冷却淡水泵。', mode: 'find', target: 'mimic', subTarget: 'cw1' },
            { msg: '第 5 步：识别 2# 高温冷却淡水泵（备用）。', mode: 'find', target: 'mimic', subTarget: 'cw2' },
            { msg: '第 6 步：识别高温淡水冷却器。', mode: 'find', target: 'mimic', subTarget: 'cooler' },
            { msg: '第 7 步：识别三通调节阀（冷却口 / 旁通口）。', mode: 'find', target: 'mimic', subTarget: 'rv-3way' },
            { msg: '第 8 步：识别除气柜。', mode: 'find', target: 'mimic', subTarget: 'deaerator' },
            { msg: '第 9 步：识别高温冷却水膨胀水柜。', mode: 'find', target: 'mimic', subTarget: 'tank' },
            { msg: '第 10 步：识别主机缸套水加热器。', mode: 'find', target: 'mimic', subTarget: 'heater' },
            { msg: '第 11 步：识别造水机（用缸套水做热源）。', mode: 'find', target: 'mimic', subTarget: 'distiller' },
            { msg: '第 12 步：识别 PS 压力开关。', mode: 'find', target: 'mimic', subTarget: 'ps' },
            { msg: '第 13 步：识别高温冷却淡水泵面板（起动 / 停止）。', mode: 'find', target: 'mimic', subTarget: 'panel1' },
            { msg: '第 14 步：识别冷却水温度PID调节器。', mode: 'find', target: 'ldcl' },
            { msg: '第 15 步：识别温度测量值显示（TT 实测值）。', mode: 'find', target: 'ldcl', subTarget: 'temp-auto' },
            { msg: '第 16 步：识别操作量显示（调节器输出 %）。', mode: 'find', target: 'ldcl', subTarget: 'ctrl-auto' },
            { msg: '第 17 步：识别PID调节器控制方式按键 A/M（Automatic / Manual）。', mode: 'find', target: 'ldcl', subTarget: 'am' },
            { msg: '第 18 步：识别报警复位按钮与报警灯排。', mode: 'find', target: 'ldcl', subTarget: 'alarm-reset' },
            {
                msg: '第 19 步：测试题——冷却水温度的控制手段。',
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
                msg: '第 1 步：手动起动 1 号高温淡水泵。',
                mode: 'check',
                op: [
                    { type: 'knob', target: 'mimic', part: 'cw1-mode', msg: '1 号泵方式 → 手动', async act() {
                        const s = _sysOf(this);
                        for (let i = 0; i < 3; i++) {
                            if (_m(s).pumps.cw1.mode === 'MAN') break;
                            _firePartClick(s.comps.mimic, 'cw1-mode');
                            await _sleep(260);
                        }
                    } },
                    { type: 'btn', target: 'mimic', part: 'cw1-start', msg: '按 1 号泵 [起动]', async act() { const s = _sysOf(this); await _pumpStart(s, 'cw1'); } },
                    { type: 'observe', target: 'mimic', part: 'ps', msg: 'PS 闭合、排出压力建立', async act() { const s = _sysOf(this); await _waitFor(s, x => _m(x).psUp, 20000, 200); } },
                ],
                check() {
                    const m = _m(_sysOf(this));
                    return !!(m && m.pumps.cw1.run && m.pumps.cw1.mode === 'MAN' && m.psUp);
                },
            },
            {
                msg: '第 2 步：起动柴油机，观察温度上升。',
                mode: 'check',
                op: [
                    { type: 'switch', target: 'mimic', part: 'engine-start', msg: '柴油机起停开关 → 运转', async act() {
                        const s = _sysOf(this);
                        if (!_m(s).engineSw) _firePartClick(s.comps.mimic, 'engine-start');
                        await _waitFor(s, x => _m(x).engineOn, 12000, 200);
                    } },
                    { type: 'observe', target: 'mimic', part: 'gauge', msg: '观察缸套水温度上升', async act() {
                        const s = _sysOf(this);
                        const t0 = _m(s).temp;
                        await _waitFor(s, x => _m(x).temp > t0 + 3, 180000, 250);
                    } },
                ],
                check() {
                    const m = _m(_sysOf(this));
                    return !!(m && m.engineOn && m.temp > 62);
                },
            },
            {
                msg: '第 3 步：手动调节阀门冷却口开度到 70 %，观察温度下降。',
                mode: 'check',
                op: [
                    { type: 'knob', target: 'ldcl', part: 'am', msg: 'A/M → 手动（MANU）', async act() { const s = _sysOf(this); await _setMode(s, false); } },
                    { type: 'btn', target: 'ldcl', part: 'key-plus', msg: '▲ 把冷却口开度加到 70 %', async act() { const s = _sysOf(this); await _manipTo(s, 70); } },
                    { type: 'observe', target: 'mimic', part: 'gauge', msg: '观察温度随冷却口开大而下降', async act() {
                        const s = _sysOf(this);
                        const t0 = _m(s).temp;
                        await _waitFor(s, x => _m(x).temp < t0 - 1.5, 300000, 300);
                    } },
                ],
                check() {
                    const m = _m(_sysOf(this));
                    return !!(m && m.mode === 'MANU' && m.manip >= 65 && m.manip <= 75);
                },
            },
            {
                msg: '第 4 步：手动调节阀门冷却口开度到 50 %，观察温度上升。',
                mode: 'check',
                op: [
                    { type: 'btn', target: 'ldcl', part: 'key-minus', msg: '▼ 把冷却口开度减到 50 %', async act() { const s = _sysOf(this); await _manipTo(s, 50); } },
                    { type: 'observe', target: 'mimic', part: 'gauge', msg: '观察温度随冷却口关小而上升', async act() {
                        const s = _sysOf(this);
                        const t0 = _m(s).temp;
                        await _waitFor(s, x => _m(x).temp > t0 + 1, 300000, 300);
                    } },
                ],
                check() {
                    const m = _m(_sysOf(this));
                    return !!(m && m.manip >= 46 && m.manip <= 54);
                },
            },
        ],
    },

    'cw-auto': {
        id: 'cw-auto', name: '3. 冷却水温度的自动控制',
        steps: [
            {
                msg: '第 1 步：将两台泵的操作方式改为自动，观察 1 号泵自动起动。',
                mode: 'check',
                op: [
                    { type: 'knob', target: 'mimic', part: 'cw1-mode', msg: '1 号泵方式 → 自动', async act() { const s = _sysOf(this); await _pumpMode(s, 'cw1', 'AUTO'); } },
                    { type: 'knob', target: 'mimic', part: 'cw2-mode', msg: '2 号泵方式 → 自动（备用）', async act() { const s = _sysOf(this); await _pumpMode(s, 'cw2', 'AUTO'); } },
                    { type: 'observe', target: 'mimic', part: 'cw1', msg: 'PS 低压力延时 3 s，1 号泵自动起动', async act() { const s = _sysOf(this); await _waitFor(s, x => _m(x).pumps.cw1.run && _m(x).psUp, 30000, 200); } },
                ],
                check() {
                    const m = _m(_sysOf(this));
                    return !!(m && m.pumps.cw1.mode === 'AUTO' && m.pumps.cw2.mode === 'AUTO'
                        && m.pumps.cw1.run && !m.pumps.cw2.run && m.psUp);
                },
            },
            {
                msg: '第 2 步：起动柴油机，观察温度逐渐上升。',
                mode: 'check',
                op: [
                    { type: 'switch', target: 'mimic', part: 'engine-start', msg: '柴油机起停开关 → 运转', async act() {
                        const s = _sysOf(this);
                        if (!_m(s).engineSw) _firePartClick(s.comps.mimic, 'engine-start');
                        await _waitFor(s, x => _m(x).engineOn, 12000, 200);
                    } },
                    { type: 'observe', target: 'mimic', part: 'gauge', msg: '观察缸套水温度上升', async act() {
                        const s = _sysOf(this);
                        const t0 = _m(s).temp;
                        await _waitFor(s, x => _m(x).temp > t0 + 3, 180000, 250);
                    } },
                ],
                check() {
                    const m = _m(_sysOf(this));
                    return !!(m && m.engineOn && m.temp > 63);
                },
            },
            {
                msg: '第 3 步：将 PID 调节器打到自动，观察温度调节过程。',
                mode: 'check',
                op: [
                    { type: 'knob', target: 'ldcl', part: 'am', msg: '按 A/M 键 → Automatic', async act() { const s = _sysOf(this); await _setMode(s, true); } },
                    { type: 'observe', target: 'ldcl', part: 'display', msg: '观察调节器输出动作、温度向设定值靠近', async act() {
                        const s = _sysOf(this);
                        await _waitFor(s, x => Math.abs(_m(x).temp - _m(x).setTemp) < 3, 300000, 400);
                    } },
                ],
                check() {
                    const m = _m(_sysOf(this));
                    return !!(m && m.mode === 'AUTO' && Math.abs(m.temp - m.setTemp) < 4);
                },
            },
            {
                msg: '第 4 步：增大柴油机负荷到 80 %，观察温度上升、PID 调节、温度稳定。',
                mode: 'check',
                op: [
                    { type: 'btn', target: 'mimic', part: 'engine-load-inc', msg: '负荷旋钮右半区，逐级加到 80 %', async act() {
                        const s = _sysOf(this), c = s.comps.mimic;
                        for (let i = 0; i < 8 && _m(s).load < 80; i++) { _firePartClick(c, 'engine-load-inc'); await _sleep(320); }
                    } },
                    { type: 'observe', target: 'ldcl', part: 'display', msg: '负荷增加后温度上升，PID 自动加大冷却口开度', async act() {
                        const s = _sysOf(this);
                        await _waitFor(s, x => _m(x).temp > _m(x).setTemp + 1, 120000, 300);
                    } },
                    { type: 'observe', target: 'ldcl', part: 'display', msg: 'PID 调节后温度重新稳定', async act() {
                        const s = _sysOf(this);
                        await _waitFor(s, x => Math.abs(_m(x).temp - _m(x).setTemp) < 1.5, 300000, 400);
                    } },
                ],
                check() {
                    const m = _m(_sysOf(this));
                    return !!(m && m.load >= 80 && Math.abs(m.temp - m.setTemp) < 2);
                },
            },
            {
                msg: '第 5 步：在 PID 面板把温度设定值调整为 80 ℃，观察调节过程。',
                mode: 'check',
                op: [
                    { type: 'btn', target: 'ldcl', part: 'set-minus', msg: '▼ 把设定值降到 80.0 ℃', async act() { const s = _sysOf(this); await _setpointTo(s, 80); } },
                    { type: 'observe', target: 'ldcl', part: 'display', msg: '观察 PID 调节、温度跟随到 80 ℃', async act() {
                        const s = _sysOf(this);
                        await _waitFor(s, x => Math.abs(_m(x).temp - 80) < 1.5, 300000, 400);
                    } },
                ],
                check() {
                    const m = _m(_sysOf(this));
                    return !!(m && Math.abs(m.setTemp - 80) < 0.05 && Math.abs(m.temp - 80) < 2);
                },
            },
            {
                msg: '第 6 步：长按 SET 进入参数界面，短按 SET 进入 P，按 ▲ 把 P 设为 7，短按 SET 保存，长按 SET 返回。',
                mode: 'check',
                op: [
                    { type: 'btn', target: 'ldcl', part: 'set', msg: '长按 SET 进入参数组', async act() { const s = _sysOf(this); await _setLong(s.comps.ldcl); } },
                    { type: 'btn', target: 'ldcl', part: 'set', msg: '短按 SET 进入 P 参数', async act() { const s = _sysOf(this); _firePartClick(s.comps.ldcl, 'set'); await _sleep(300); } },
                    { type: 'btn', target: 'ldcl', part: 'up', msg: '按 ▲ 两次，把 P 调到 7.0', async act() {
                        const s = _sysOf(this), c = s.comps.ldcl;
                        for (let i = 0; i < 2; i++) { _firePartClick(c, 'up'); await _sleep(220); }
                    } },
                    { type: 'btn', target: 'ldcl', part: 'set', msg: '短按 SET 保存 P', async act() { const s = _sysOf(this); _firePartClick(s.comps.ldcl, 'set'); await _sleep(300); } },
                    { type: 'btn', target: 'ldcl', part: 'set', msg: '长按 SET 返回主界面', async act() { const s = _sysOf(this); await _setLong(s.comps.ldcl); } },
                ],
                check() {
                    const s = _sysOf(this);
                    const m = _m(s);
                    const c = s.comps.ldcl;
                    return !!(m && m.bandP === 7 && c && c._mnu && c._mnu.level === 0);
                },
            },
            {
                msg: '第 7 步：长按 SET 进入参数组，按 ▲ 切到 ALARM 组，短按 SET 依次查看 L、H、HH 三个报警值，最后长按 SET 返回主界面。',
                mode: 'check',
                op: [
                    { type: 'btn', target: 'ldcl', part: 'set', msg: '长按 SET 进入参数组', async act() { const s = _sysOf(this); await _setLong(s.comps.ldcl); } },
                    { type: 'btn', target: 'ldcl', part: 'up', msg: '▲ 切到 ALARM 参数组', async act() {
                        const s = _sysOf(this), c = s.comps.ldcl;
                        for (let i = 0; i < 4 && c._menuValue.text() !== 'ALARM'; i++) { _firePartClick(c, 'up'); await _sleep(250); }
                    } },
                    { type: 'btn', target: 'ldcl', part: 'set', msg: '短按 SET 进入报警限参数', async act() { const s = _sysOf(this); _firePartClick(s.comps.ldcl, 'set'); await _sleep(300); } },
                    { type: 'observe', target: 'ldcl', part: 'display', msg: '查看温度低报警限 L（默认 55 ℃）', async act() { await _sleep(1400); } },
                    { type: 'btn', target: 'ldcl', part: 'set', msg: '短按 SET 查看温度高报警限 H（默认 95 ℃）', async act() { const s = _sysOf(this); _firePartClick(s.comps.ldcl, 'set'); await _sleep(1200); } },
                    { type: 'btn', target: 'ldcl', part: 'set', msg: '短按 SET 查看温度高高报警限 HH（默认 98 ℃）', async act() {
                        const s = _sysOf(this);
                        _firePartClick(s.comps.ldcl, 'set');
                        await _sleep(1400);
                    } },
                    { type: 'btn', target: 'ldcl', part: 'set', msg: '长按 SET 返回主界面', async act() { const s = _sysOf(this); await _setLong(s.comps.ldcl); } },
                ],
                check() {
                    const s = _sysOf(this);
                    const c = s.comps.ldcl;
                    const seen = (c && c._seenParams) || {};
                    // 三个报警限都进入查看过，且已长按 SET 返回主界面（L0）
                    return !!(c && c._mnu && c._mnu.level === 0 && seen.L && seen.H && seen.HH);
                },
            },
        ],
    },
};

export const PROJECT_PAGES = [];
