import { SteeringStatusPanel } from '../components/SteeringStatusPanel.js';
import { RemoteSteeringPanel } from '../components/RemoteSteeringPanel.js';
import { HydraulicSteeringSystem } from '../components/HydraulicSteeringSystem.js';
import { LocalSteeringPanel } from '../components/LocalSteeringPanel.js';
import { GearRemotePanel } from '../components/GearRemotePanel.js';

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
const _solver = (sys) => (sys && sys.steerSolver) ? sys.steerSolver : null;
const _model = (sys) => { const s = _solver(sys); return s ? s.m : null; };
const _norm180 = (a) => ((a + 540) % 360) - 180;

function _firePartClick(comp, partId) {
    if (!comp) return false;
    try {
        const node = comp.getClickablePartNode && comp.getClickablePartNode(partId);
        if (node && typeof node.fire === 'function') { node.fire('click'); return true; }
    } catch (e) { /* ignore */ }
    return false;
}

async function _clickUntil(comp, partId, pred, maxTimes = 8, gap = 260) {
    for (let i = 0; i < maxTimes; i++) {
        if (pred()) return true;
        _firePartClick(comp, partId);
        await _sleep(gap);
    }
    return pred();
}

async function _waitFor(sys, cond, timeoutMs = 25000, intervalMs = 250) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
        try { if (cond(sys)) return true; } catch (e) { /* ignore */ }
        await _sleep(intervalMs);
    }
    try { return !!cond(sys); } catch (e) { return false; }
}

async function _ensureMainPower(sys, on = true, n = 1) {
    const s = _solver(sys), m = _model(sys);
    const local = _comp(sys, 'local');
    if (!s || !m) return false;
    if (!!m.pump[n].power !== on) { _firePartClick(local, n === 1 ? 'main-power' : 'main-power2'); await _sleep(450); }
    return !!m.pump[n].power === on;
}

// 把指定机组的机旁遥控开关拨到“遥控”
async function _ensureRemote(sys, n = 1) {
    const m = _model(sys);
    const local = _comp(sys, 'local');
    if (!m) return false;
    if (m.pump[n] && m.pump[n].local) { _firePartClick(local, `local-mode${n}`); await _sleep(400); }
    return !(m.pump[n] && m.pump[n].local);
}

// 备用开关打到“开”
async function _ensureStandby(sys, n = 1) {
    const m = _model(sys);
    const local = _comp(sys, 'local');
    if (!m) return false;
    if (m.pump[n] && !m.pump[n].standby) { _firePartClick(local, n === 1 ? 'standby' : 'standby2'); await _sleep(350); }
    return !!(m.pump[n] && m.pump[n].standby);
}

async function _selectSystem(sys, n) {
    const m = _model(sys);
    const remote = _comp(sys, 'remote');
    const local = _comp(sys, 'local');
    if (!m) return false;
    if (m.sys === n) return true;
    _firePartClick(remote, n === 1 ? 'sys-1' : 'sys-2');
    if (m.sys !== n) _firePartClick(local, n === 1 ? 'sys-1' : 'sys-2');
    await _sleep(350);
    return m.sys === n;
}

async function _ensurePump(sys, n) {
    const m = _model(sys);
    const local = _comp(sys, 'local');
    if (!m) return false;
    await _ensureMainPower(sys, true, n);
    await _selectSystem(sys, n);
    if (m.pump[n].trip) return false;
    if (!m.pump[n].running) { _firePartClick(local, n === 1 ? 'start' : 'start2'); await _sleep(900); }
    return m.pump[n].running;
}

async function _stopPump(sys, n) {
    const m = _model(sys);
    const local = _comp(sys, 'local');
    if (!m) return false;
    await _selectSystem(sys, n);
    if (m.pump[n].running) { _firePartClick(local, n === 1 ? 'stop' : 'stop2'); await _sleep(700); }
    return !m.pump[n].running;
}

async function _ensureAutoPower(sys, on = true) {
    const m = _model(sys);
    const local = _comp(sys, 'local');
    if (!m) return false;
    if (m.autoPower !== on) { _firePartClick(local, 'auto-power'); await _sleep(400); }
    return m.autoPower === on;
}

async function _ensureAutoEngaged(sys, on = true) {
    const m = _model(sys);
    const local = _comp(sys, 'local');
    if (!m) return false;
    await _ensureAutoPower(sys, true);
    if (m.autoEngaged !== on) { _firePartClick(local, 'auto-engage'); await _sleep(400); }
    return m.autoEngaged === on;
}

async function _setMode(sys, mode) {
    const m = _model(sys);
    const remote = _comp(sys, 'remote');
    if (!m || !remote) return false;
    if (mode !== 'auto') await _ensureAutoEngaged(sys, false);
    const order = ['auto', 'manual', 'nfu'];
    for (let i = 0; i < 4; i++) {
        if (m.mode === mode) break;
        const cur = order.indexOf(m.mode);
        const target = order.indexOf(mode);
        const dir = target > cur ? 'mode-right' : 'mode-left';
        _firePartClick(remote, dir);
        await _sleep(300);
    }
    return m.mode === mode;
}

async function _helmTo(sys, target) {
    const m = _model(sys);
    const remote = _comp(sys, 'remote');
    if (!m || !remote || typeof remote.rotateWheelTo !== 'function') return false;
    await remote.rotateWheelTo(target, 500);
    await _sleep(200);
    return Math.abs(m.helm - target) < 0.1;
}

async function _setHeadingTo(sys, target) {
    const m = _model(sys);
    const remote = _comp(sys, 'remote');
    if (!m) return false;
    for (let i = 0; i < 400; i++) {
        const err = target - m.headingSet;
        if (Math.abs(err) < 0.2) break;
        _firePartClick(remote, err > 0 ? 'set-inc' : 'set-dec');
        await _sleep(25);
    }
    return Math.abs(target - m.headingSet) < 0.6;
}

async function _nfuPulse(sys, dir, stopCond, maxClicks = 8) {
    const m = _model(sys);
    const remote = _comp(sys, 'remote');
    if (!m || !remote || typeof remote.pressNfu !== 'function') return false;
    remote.pressNfu(dir);
    const timeout = Math.max(2500, maxClicks * 900);
    const t0 = Date.now();
    let ok = false;
    while (Date.now() - t0 < timeout) {
        if (stopCond(m)) { ok = true; break; }
        await _sleep(100);
    }
    remote.releaseNfu();
    await _sleep(300);
    return ok;
}

// ═══════════════════════════════════════════════════════════════
// 页面定义
// ═══════════════════════════════════════════════════════════════

const INSTRUMENTS = ['multimeter', 'mf47-panel', 'osc', 'sg', 'cali', 'elecmeter', 'megohm'];

export const PROJECT_PAGES = [
    { id: 0, name: '索引', type: 'index' },
    {
        id: 1, name: '舵机远程遥控操作',
        comps: ['status', 'remote', 'gearpanel', ...INSTRUMENTS],
        desc: '左侧：状态显示仪（航向/舵角、船舶工况、主机工况、螺旋桨工况、电源开关）。右侧：遥控操作面板（DMU 舵角指示、航向显示与设定、模式选择、舵机选择、随动操舵手轮、非随动操舵开关）。左下：舵机控制遥控面板（1#/2# 舵机泵起停按钮与故障/低油位指示灯、1#/2# 隔离阀动作指示灯、试灯与复位按钮）。',
    },
    {
        id: 2, name: '船舶液压舵机系统与机旁控制',
        comps: ['hyd', 'local', ...INSTRUMENTS],
        desc: '左侧：船舶液压舵机系统（双油缸与舵叶、DMU、1#/2# 液压动力单元、油柜、液压泵、压力表、方向阀与液压管路）。右侧：机旁控制面板（电流表、主电源、电源/运行/故障跳闸指示灯、备用与空间加热器开关、起动/停止按钮、自动舵机面板）。',
    },
];

// ═══════════════════════════════════════════════════════════════
// 组件配置（1920 × 1080 基准坐标）
// ═══════════════════════════════════════════════════════════════

export const componentConfigs = [
    { Class: SteeringStatusPanel, id: 'status', x: -120, y: 10, page: 1, width: 747, height: 573, visible: true },
    { Class: RemoteSteeringPanel, id: 'remote', x: 820, y: 30, page: 1, width: 680, height: 800, visible: true },
    { Class: GearRemotePanel, id: 'gearpanel', x: 0, y: 630, page: 1, width: 560, height: 310, visible: true },

    { Class: HydraulicSteeringSystem, id: 'hyd', x: -180, y: 10, page: 2, width: 1250, height: 850, visible: true },
    { Class: LocalSteeringPanel, id: 'local', x: 1300, y: 90, page: 2, width: 360, height: 740, visible: true },

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
    sys.pageIndexTitle = '舵机控制的操作程序及故障处理 · 页面索引';
}

export function applyAllPresets(opts) {
    if (opts && opts.init) return;
    const sys = _sysOf(this);
    if (sys && sys.redrawAll) sys.redrawAll();
}

export async function applyStartSystem() {
    const sys = _sysOf(this);
    const s = _solver(sys), m = _model(sys);
    if (!s || !m) return;

    m.faults.pump1Trip = false;
    m.faults.pump2Trip = false;
    s.resetPump(1);
    s.resetPump(2);

    s.setDisplayPower(true);
    s.setMainPower(true);
    s.setUnitLocal(1, false);          // 1# 机旁遥控开关拨到“遥控”
    s.setUnitLocal(2, false);          // 2# 机旁遥控开关拨到“遥控”
    s.setUnitStandby(1, true);         // 1# 备用开关打到“开”
    s.setUnitStandby(2, true);         // 2# 备用开关打到“开”
    s.selectSystem(1);
    s.startPump(1);
    s.setMode('manual');
    s.setHeading(0);
    s.centerHelm();

    await _sleep(500);
    if (sys.redrawAll) sys.redrawAll();
}

export function fiveStep() {
    const sys = _sysOf(this);
    const s = _solver(sys), m = _model(sys);
    if (!s || !m) return;
    if (sys._fiveStepIdx === undefined) sys._fiveStepIdx = 0;
    const idx = sys._fiveStepIdx % 5;
    sys._fiveStepIdx = idx + 1;
    if (idx === 0) { s.setMode('manual'); s.setHelm(0.5); }
    else if (idx === 1) { s.setMode('manual'); s.setHelm(-0.5); }
    else if (idx === 2) { s.setMode('nfu'); s.setNfu('starboard'); }
    else if (idx === 3) { s.setMode('nfu'); s.setNfu('port'); }
    else { s.setMode('auto'); s.setAutoEngaged(true); }
    if (sys.redrawAll) sys.redrawAll();
}

// ═══════════════════════════════════════════════════════════════
// 故障 / 流程
// ═══════════════════════════════════════════════════════════════

function _faults() {
    const m = _model(window.sys);
    return m ? m.faults : null;
}

export const FAULT_CONFIGS = {
    'pump1-trip': {
        id: 'pump1-trip', name: '1# 液压泵过载跳闸', system: '液压舵机系统',
        check() { const f = _faults(); return !!(f && f.pump1Trip); },
        trigger() { const s = _solver(window.sys); if (s) { s.m.faults.pump1Trip = true; s.tripPump(1); } },
        repair() {
            const s = _solver(window.sys);
            if (s && (s.m.faults.pump1Trip || s.m.pump[1].trip)) {
                s.m.faults.pump1Trip = false;
                s.resetPump(1);
            }
        },
    },
    'pump2-trip': {
        id: 'pump2-trip', name: '2# 液压泵过载跳闸', system: '液压舵机系统',
        check() { const f = _faults(); return !!(f && f.pump2Trip); },
        trigger() { const s = _solver(window.sys); if (s) { s.m.faults.pump2Trip = true; s.tripPump(2); } },
        repair() {
            const s = _solver(window.sys);
            if (s && (s.m.faults.pump2Trip || s.m.pump[2].trip)) {
                s.m.faults.pump2Trip = false;
                s.resetPump(2);
            }
        },
    },

    'feedback-fault': {
        id: 'feedback-fault', name: '舵角反馈装置故障', system: '操舵控制系统',
        check() { const f = _faults(); return !!(f && f.feedback); },
        trigger() { const f = _faults(); if (f) f.feedback = true; },
        repair() { const f = _faults(); if (f) f.feedback = false; },
    },
};

export const PROJECT_WORKFLOWS = {
    'steer-ready': {
        id: 'steer-ready', name: '1. 开航前检查与机旁起动',
        steps: [
            {
                msg: '第 1 步：认识页 1 的三个面板——左侧状态显示仪（航向、舵角与船舶工况）、右侧遥控操作面板（模式选择、舵机选择、随动操舵手轮、非随动操舵开关）、左下舵机控制遥控面板（1#/2# 舵机泵起停按钮与故障、低油位、隔离阀指示灯及试灯/复位按钮）。',
                mode: 'find', target: ['status', 'remote', 'gearpanel'], demoTarget: ['status', 'remote', 'gearpanel'],
            },
            {
                msg: '第 2 步：切换到页 2，认识船舶液压舵机系统与机旁控制面板。',
                mode: 'find', target: ['hyd', 'local'], demoTarget: ['hyd', 'local'],
            },
            {
                msg: '第 3 步：在机旁控制面板上打开两台机组的电源开关，备用开关都打到「开」、机旁遥控开关都打到「遥控」，然后选择 1# 并按下「起动」，1# 液压泵运行、系统压力建立。',
                mode: 'check',
                op: [
                    { type: 'switch', target: 'local', part: 'main-power', msg: '合上 1# 起动控制箱电源开关',
                      async act() { const s = _sysOf(this); await _ensureMainPower(s, true, 1); } },
                    { type: 'switch', target: 'local', part: 'main-power2', msg: '合上 2# 起动控制箱电源开关',
                      async act() { const s = _sysOf(this); await _ensureMainPower(s, true, 2); } },
                    { type: 'switch', target: 'local', part: 'standby', msg: '1# 备用开关打到「开」',
                      async act() { const s = _sysOf(this); await _ensureStandby(s, 1); } },
                    { type: 'switch', target: 'local', part: 'standby2', msg: '2# 备用开关打到「开」',
                      async act() { const s = _sysOf(this); await _ensureStandby(s, 2); } },
                    { type: 'switch', target: 'local', part: 'local-mode1', msg: '1# 机旁遥控开关拨到「遥控」',
                      async act() { const s = _sysOf(this); await _ensureRemote(s, 1); } },
                    { type: 'switch', target: 'local', part: 'local-mode2', msg: '2# 机旁遥控开关拨到「遥控」',
                      async act() { const s = _sysOf(this); await _ensureRemote(s, 2); } },
                    { type: 'switch', target: 'local', part: 'start', msg: '选择 1# 后按「起动」按钮起动 1# 液压泵',
                      async act() { const s = _sysOf(this); await _selectSystem(s, 1); await _ensurePump(s, 1); } },
                    { type: 'observe', target: 'hyd', part: 'pump1', msg: '观察 1# 液压泵运行、压力表建立压力',
                      async act() { const s = _sysOf(this); await _waitFor(s, x => _model(x).pump[1].pressure > 5, 12000, 250); await _sleep(1200); } },
                ],
                check() {
                    const s = _sysOf(this), m = _model(s);
                    return !!(m && m.pump[1].power && m.pump[2].power
                        && m.pump[1].standby && m.pump[2].standby
                        && !m.pump[1].local && !m.pump[2].local
                        && m.sys === 1 && m.pump[1].running && m.pump[1].pressure > 5);
                },
            },
            {
                msg: '第 4 步：回到页 1，合上状态显示仪电源，选择 1# 系统并将模式置于「手动」，遥控系统准备就绪。',
                mode: 'check',
                op: [
                    { type: 'page', page: 1, msg: '切换到页 1 远程遥控操作' },
                    { type: 'switch', target: 'status', part: 'power', msg: '合上状态显示仪电源',
                      async act() { const s = _sysOf(this); const st = _comp(s, 'status'); if (!_model(s).displayPower) { _firePartClick(st, 'power'); await _sleep(400); } } },
                    { type: 'switch', target: 'remote', part: 'sys-1', msg: '遥控面板舵机选择置于 1#',
                      async act() { const s = _sysOf(this); await _selectSystem(s, 1); } },
                    { type: 'switch', target: 'remote', part: 'mode', msg: '模式选择旋钮置于「手动」',
                      async act() { const s = _sysOf(this); await _setMode(s, 'manual'); } },
                ],
                check() {
                    const s = _sysOf(this), m = _model(s);
                    return !!(m && m.displayPower && m.sys === 1 && m.mode === 'manual' && m.pump[1].running);
                },
            },
        ],
    },

    'steer-manual': {
        id: 'steer-manual', name: '2. 随动操舵',
        steps: [
            {
                msg: '第 1 步：点击工具栏「起动系统」，一键完成两机供电、备用投入、遥控位与 1# 泵起动，随后把遥控面板模式置于「手动」，进入随动操舵状态。',
                mode: 'check',
                op: [
                    { type: 'page', page: 1, msg: '先切换到页 1（远程遥控操作）' },
                    { type: 'wire', button: 'btnStartSys', msg: '箭头指向工具栏「起动系统」按钮', flashMs: 2200, holdMs: 900,
                      async act() {
                          const s = _sysOf(this);
                          const btn = document.getElementById('btnStartSys');
                          if (btn) btn.click();
                          await _sleep(1200);
                          await _ensureRemote(s, 1);
                      } },
                    { type: 'switch', target: 'remote', part: 'mode', msg: '箭头指向模式选择开关，把模式转到「手动」',
                      async act() { const s = _sysOf(this); await _setMode(s, 'manual'); await _sleep(500); } },
                ],
                check() {
                    const s = _sysOf(this), m = _model(s);
                    return !!(m && m.pump[1].running && m.mode === 'manual' && !m.pump[1].local);
                },
            },
            {
                msg: '第 2 步：向右转动随动操舵手轮，使舵机设定值大于右舵 10°，舵角向 S（右）方向偏转，船舶开始向右转向。',
                mode: 'check',
                op: [
                    { type: 'knob', target: 'remote', part: 'helm', msg: '向右转动手轮，产生右舵指令',
                      async act() { const s = _sysOf(this); await _ensurePump(s, 1); await _helmTo(s, 0.5); await _sleep(500); } },
                    { type: 'observe', target: 'remote', part: 'dmu', msg: '观察 DMU 舵角指示与实际舵角变化',
                      async act() { const s = _sysOf(this); await _waitFor(s, x => _model(x).rudder > 8, 25000, 250); await _sleep(1500); } },
                ],
                check() { const s = _sysOf(this), m = _model(s); return !!(m && m.rudderCmd > 10 && m.rudder > 8); },
            },
            {
                msg: '第 3 步：向左转动随动操舵手轮，使舵机设定值大于左舵 10°，舵角向 P（左）方向偏转，船舶开始向左转向。',
                mode: 'check',
                op: [
                    { type: 'knob', target: 'remote', part: 'helm', msg: '向左转动手轮，产生左舵指令',
                      async act() { const s = _sysOf(this); await _helmTo(s, -0.5); await _sleep(500); } },
                    { type: 'observe', target: 'remote', part: 'dmu', msg: '观察舵角向 P（左）方向偏转',
                      async act() { const s = _sysOf(this); await _waitFor(s, x => _model(x).rudder < -8, 45000, 250); await _sleep(1500); } },
                ],
                check() { const s = _sysOf(this), m = _model(s); return !!(m && m.rudderCmd < -10 && m.rudder < -8); },
            },
            {
                msg: '第 4 步：手轮回中（正舵），舵叶回到零位，船舶停止转向。',
                mode: 'check',
                op: [
                    { type: 'knob', target: 'remote', part: 'helm', msg: '手轮回中至正舵',
                      async act() { const s = _sysOf(this); await _helmTo(s, 0); await _sleep(500); } },
                    { type: 'observe', target: 'remote', part: 'dmu', msg: '观察舵角回到零位附近',
                      async act() { const s = _sysOf(this); await _waitFor(s, x => Math.abs(_model(x).rudder) < 2, 35000, 250); await _sleep(1000); } },
                ],
                check() { const s = _sysOf(this), m = _model(s); return !!(m && Math.abs(m.helm) < 0.1 && Math.abs(m.rudder) < 2.5); },
            },
        ],
    },

    'steer-nfu': {
        id: 'steer-nfu', name: '3. 非随动操舵',
        steps: [
            {
                msg: '第 1 步：点击起动系统，然后将模式选择旋钮置于「非随动」，使用非随动操舵开关点动操舵。',
                mode: 'check',
                op: [
                    { type: 'page', page: 1, msg: '先切换到页 1（远程遥控操作）' },
                    { type: 'wire', button: 'btnStartSys', msg: '箭头指向工具栏「起动系统」按钮', flashMs: 2200, holdMs: 900,
                      async act() {
                          const s = _sysOf(this);
                          const btn = document.getElementById('btnStartSys');
                          if (btn) btn.click();
                          await _sleep(1200);
                          await _ensureRemote(s, 1);
                      } },
                    { type: 'switch', target: 'remote', part: 'mode', msg: '箭头指向模式选择开关，把模式转到「非随动 NFU」',
                      async act() { const s = _sysOf(this); await _setMode(s, 'nfu'); await _sleep(500); } },
                ],
                check() {
                    const s = _sysOf(this), m = _model(s);
                    return !!(m && m.mode === 'nfu' && m.pump[1].running && !m.pump[1].local);
                },
            },
            {
                msg: '第 2 步：向右扳动非随动操舵开关，把舵角转到超过右舵 5°；松开后开关自动回中，舵角保持。',
                mode: 'check',
                op: [
                    { type: 'switch', target: 'remote', part: 'nfu-starboard', msg: '向右扳动非随动操舵开关',
                      async act() { const s = _sysOf(this); await _nfuPulse(s, 'starboard', m => m.rudder > 5, 14); await _sleep(600); } },
                    { type: 'observe', target: 'remote', part: 'dmu', msg: '观察右舵舵角增大到 5° 以上，开关回中后停止',
                      async act() { await _sleep(1500); } },
                ],
                check() { const s = _sysOf(this), m = _model(s); return !!(m && m.rudder > 4.8); },
            },
            {
                msg: '第 3 步：向左扳动非随动操舵开关，把舵角转到超过左舵 5°。',
                mode: 'check',
                op: [
                    { type: 'switch', target: 'remote', part: 'nfu-port', msg: '向左扳动非随动操舵开关',
                      async act() { const s = _sysOf(this); await _nfuPulse(s, 'port', m => m.rudder < -5, 22); await _sleep(600); } },
                    { type: 'observe', target: 'remote', part: 'dmu', msg: '观察舵角向 P（左）方向偏转超过 5°',
                      async act() { await _sleep(1500); } },
                ],
                check() { const s = _sysOf(this), m = _model(s); return !!(m && m.rudder < -4.8); },
            },
            {
                msg: '第 4 步：向右扳动非随动操舵开关把舵角回中，舵角回到零位附近，船舶停止转向。',
                mode: 'check',
                op: [
                    { type: 'switch', target: 'remote', part: 'nfu-starboard', msg: '向右扳动开关使舵角回中',
                      async act() { const s = _sysOf(this); await _nfuPulse(s, 'starboard', m => m.rudder > -1.5, 16); await _sleep(600); } },
                    { type: 'observe', target: 'remote', part: 'dmu', msg: '观察舵角回到零位附近',
                      async act() { const s = _sysOf(this); await _waitFor(s, x => Math.abs(_model(x).rudder) < 2.5, 10000, 250); await _sleep(1000); } },
                ],
                check() { const s = _sysOf(this), m = _model(s); return !!(m && Math.abs(m.rudder) < 2.5); },
            },
        ],
    },

    'steer-auto': {
        id: 'steer-auto', name: '4. 自动舵航向保持',
        steps: [
            {
                msg: '第 1 步：点击工具栏起动系统按钮，起动舵机系统；然后将遥控面板模式选择置于「自动」。',
                mode: 'check',
                op: [
                    { type: 'page', page: 1, msg: '先切换到页 1（远程遥控操作）' },
                    { type: 'wire', button: 'btnStartSys', msg: '箭头指向工具栏「起动系统」按钮', flashMs: 2200, holdMs: 900,
                      async act() {
                          const s = _sysOf(this);
                          const btn = document.getElementById('btnStartSys');
                          if (btn) btn.click();
                          await _sleep(1200);
                          await _ensureRemote(s, 1);
                      } },
                    { type: 'switch', target: 'remote', part: 'mode', msg: '箭头指向模式选择开关，把模式转到「自动」',
                      async act() { const s = _sysOf(this); await _setMode(s, 'auto'); await _sleep(500); } },
                ],
                check() {
                    const s = _sysOf(this), m = _model(s);
                    return !!(m && m.autoEngaged && m.mode === 'auto' && m.pump[1].running && !m.pump[1].local);
                },
            },
            {
                msg: '第 2 步：通过航向设定旋钮设定航向为+10°，自动舵自动操舵使船舶转向并稳定在新航向。',
                mode: 'check',
                op: [
                    { type: 'knob', target: 'remote', part: 'set-inc', msg: '按「+」把设定航向增大',
                      async act() { const s = _sysOf(this); await _setHeadingTo(s, 10.0); await _sleep(500); } },
                    { type: 'observe', target: 'remote', part: 'dmu', msg: '观察自动舵输出舵角、船舶航向出现超调后由微分舵反向修正，积分舵逐步消除航向偏差',
                      async act() {
                          const s = _sysOf(this);
                          await _waitFor(s, x => {
                              const m = _model(x);
                              return m.headingSet > 9.5 && Math.abs(_norm180(m.headingSet - m.heading)) < 0.5;
                          }, 180000, 300);
                          await _sleep(1500);
                      } },
                ],
                check() {
                    const s = _sysOf(this), m = _model(s);
                    return !!(m && m.mode === 'auto' && m.autoEngaged
                        && m.headingSet > 9.5
                        && Math.abs(_norm180(m.headingSet - m.heading)) < 0.5);
                },
            },
            {
                msg: '第 3 步：把设定航向改回 0°（原航向），自动舵反向操舵使船舶回到原航向并稳定。',
                mode: 'check',
                op: [
                    { type: 'knob', target: 'remote', part: 'set-dec', msg: '按「−」把设定航向减回 0°',
                      async act() { const s = _sysOf(this); await _setHeadingTo(s, 0); await _sleep(600); } },
                    { type: 'observe', target: 'remote', part: 'dmu', msg: '观察自动舵反向操舵，航向回到 0° 并稳定',
                      async act() {
                          const s = _sysOf(this);
                          await _waitFor(s, x => {
                              const m = _model(x);
                              return Math.abs(_norm180(m.headingSet)) < 0.5
                                  && Math.abs(_norm180(m.headingSet - m.heading)) < 0.5;
                          }, 180000, 300);
                          await _sleep(1500);
                      } },
                ],
                check() {
                    const s = _sysOf(this), m = _model(s);
                    return !!(m && Math.abs(_norm180(m.headingSet)) < 0.5
                        && Math.abs(_norm180(m.headingSet - m.heading)) < 0.5);
                },
            },
        ],
    },

    'steer-fault': {
        id: 'steer-fault', name: '5. 液压泵跳闸故障处理与备用系统切换',
        steps: [
            {
                msg: '第 1 步：点击工具栏「起动系统」起动舵机系统，模式转「手动」，用手轮设定右舵 5°，验证 1# 舵机操舵正常。',
                mode: 'check',
                op: [
                    { type: 'page', page: 1, msg: '先切换到页 1（远程遥控操作）' },
                    { type: 'wire', button: 'btnStartSys', msg: '箭头指向工具栏「起动系统」按钮', flashMs: 2200, holdMs: 900,
                      async act() {
                          const s = _sysOf(this);
                          const btn = document.getElementById('btnStartSys');
                          if (btn) btn.click();
                          await _sleep(1200);
                          await _ensureRemote(s, 1);
                      } },
                    { type: 'switch', target: 'remote', part: 'mode', msg: '箭头指向模式选择开关，把模式转到「手动」',
                      async act() { const s = _sysOf(this); await _setMode(s, 'manual'); await _sleep(400); } },
                    { type: 'knob', target: 'remote', part: 'helm', msg: '转动随动操舵手轮，设定右舵 5°',
                      async act() { const s = _sysOf(this); await _helmTo(s, 0.143); await _sleep(500); } },
                    { type: 'observe', target: 'remote', part: 'dmu', msg: '观察 1# 舵机舵角增大到 5° 左右，操舵正常',
                      async act() { const s = _sysOf(this); await _waitFor(s, x => _model(x).rudder > 4.5, 25000, 250); await _sleep(1200); } },
                ],
                check() {
                    const s = _sysOf(this), m = _model(s);
                    return !!(m && m.pump[1].running && m.mode === 'manual' && !m.pump[1].local
                        && m.rudderCmd > 4.5 && m.rudder > 4);
                },
            },
            {
                msg: '第 2 步：切换到页 2，设置「1# 液压泵过载跳闸」故障；1# 泵跳闸停机后，延时 3 s 备用机组（2#）自动起动。',
                mode: 'check',
                op: [
                    { type: 'page', page: 2, msg: '切换到页 2（液压舵机系统与机旁控制）' },
                    { type: 'fault', fault: 'pump1-trip', msg: '打开故障设置界面，勾选「1# 液压泵过载跳闸」并应用', async act() { await _sleep(400); } },
                    { type: 'observe', target: 'hyd', part: 'pump1', msg: '观察 1# 泵停转、压力下降',
                      async act() { const s = _sysOf(this); await _waitFor(s, x => !_model(x).pump[1].running, 10000, 250); await _sleep(800); } },
                    { type: 'observe', target: 'hyd', part: 'pump2', msg: '延时约 3 s 后观察 2# 液压泵自动起动（备用自起动）',
                      async act() { const s = _sysOf(this); await _waitFor(s, x => _model(x).pump[2].running, 15000, 250); await _sleep(1500); } },
                ],
                check() {
                    const s = _sysOf(this), m = _model(s), f = _faults();
                    return !!(m && f && f.pump1Trip && !m.pump[1].running && m.pump[2].running);
                },
            },
            {
                msg: '第 3 步：在故障设置界面取消「1# 液压泵过载跳闸」故障并应用，故障跳闸灯熄灭，1# 恢复可用。',
                mode: 'check',
                op: [
                    { type: 'fault', fault: 'pump1-trip', repair: true, msg: '打开故障设置界面，取消勾选「1# 液压泵过载跳闸」并应用', async act() { await _sleep(400); } },
                    { type: 'observe', target: 'local', part: 'stop', msg: '观察故障标志清除、故障跳闸灯熄灭',
                      async act() { const s = _sysOf(this); await _waitFor(s, x => !_faults().pump1Trip, 10000, 250); await _sleep(1000); } },
                ],
                check() {
                    const s = _sysOf(this), m = _model(s), f = _faults();
                    return !!(m && f && !f.pump1Trip && m.pump[2].running);
                },
            },
        ],
    },
};
