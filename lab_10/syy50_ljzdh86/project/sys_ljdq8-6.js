/**
 * 船舶燃油供油单元（FCM / EPC-50B）自动控制仿真项目配置（单页工程）
 *
 * 画布同屏只有两台设备：
 *   epc    EPC-50B 控制器（上：OP 操作面板；下：油泵与加热控制箱）
 *   mimic  燃油供油单元系统模拟图（图 6-2-1：HFO/DO 柜、转换阀、供油泵、
 *          滤器与 PDS、FT/PT、带脱气的混合筒、循环泵、加热器、TT/VT、主机）
 *
 * 依据：第六章第二节 燃油供油单元自动控制系统
 *   三、燃油黏度控制系统（Pr19/Pr20/Pr30/Pr35、Fa30/Fa31、Fa25~Fa28）
 *   四、综合控制（DO/HFO 转换、泵运行备用 Pr1/Pr2、滤器自动冲洗、脱气）
 *   五、操作与管理（重要参数 Pr23/Pr30/Pr32，故障表 6-2-3）
 */
import { EPC50BController } from '../components/EPC50BController.js';
import { FuelSupplyMimic } from '../components/FuelSupplyMimic.js';

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
const _solver = (sys) => (sys && sys.fuelSolver) ? sys.fuelSolver : null;
const _m = (sys) => { const s = _solver(sys); return s ? s.m : null; };

/** 参数表（顺序必须与 EPC50BController._paramItems() 一致） */
const PARAM_KEYS = [
    'Pr1', 'Pr2', 'Pr10', 'Pr11', 'Pr19', 'Pr20', 'Pr23', 'Pr24', 'Pr30', 'Pr32', 'Pr35',
    'Fa8', 'Fa9', 'Fa14', 'Fa16', 'Fa21', 'Fa22', 'Fa25', 'Fa26', 'Fa30', 'Fa31',
];

// ═══════════════════════════════════════════════════════════════
// 组件配置（1920 × 1080 基准坐标，单页同屏）
// ═══════════════════════════════════════════════════════════════

export const componentConfigs = [
    { Class: FuelSupplyMimic, id: 'mimic', x: -100, y: 10, width: 1510, height: 390, visible: true },
    { Class: EPC50BController, id: 'epc', x: -100, y: 450, width: 1510, height: 470, visible: true },

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

/** 工具栏「自动投用」：上电、各泵选择 EPC、滤器 AUTO，不投入工艺 */
export function applyAllPresets(opts) {
    if (opts && opts.init) return;
    const sys = _sysOf(this);
    const s = _solver(sys);
    if (!s) return;
    const m = s.m;
    Object.values(m.pumps).forEach(p => {
        s.setPumpMainSwitch(p.id, true);
        s.setPumpMode(p.id, 'EPC');
    });
    s.setFilterMainSwitch(true);
    m.filter.mode = 'AUTO';
    s.setPumpCtlMode('EPC');
    s.setRegValveMode('EPC');
    m.filter.nextIn = 30;
    if (sys.redrawAll) sys.redrawAll();
}

/** 工具栏「起动系统」：快速投入自动运行 */
export async function applyStartSystem() {
    const sys = _sysOf(this);
    const s = _solver(sys);
    if (!s) return;
    if (s.m.mainPower) {
        // 复位到干净状态，但**保留「故障设置」里已设置的故障**（故障只能在故障界面修复）
        const keepFaults = { ...s.m.faults };
        const keepPump = Object.fromEntries(Object.entries(s.m.pumps).map(([k, p]) => [k, { f: p.fault, o: p.overload }]));
        s.resetAll();
        Object.assign(s.m.faults, keepFaults);
        Object.entries(keepPump).forEach(([k, v]) => {
            const p = s.m.pumps[k];
            if (p) { p.fault = v.f; p.overload = v.o; }
        });
    }
    s.quickStart();
    await _sleep(600);
    if (sys.redrawAll) sys.redrawAll();
}

/** 工具栏「5 点步进」：停止 → 手动起泵 → 手动加热 → 转 HFO → 自动 */
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
// 故障配置（表 6-2-3 的故障编码）
// ═══════════════════════════════════════════════════════════════

function _faults(sys) {
    const s = _solver(sys || window.sys);
    return s ? s.m.faults : null;
}

function _mkFault(id, name, system, key, alarm) {
    return {
        id, name, system, alarm,
        check() { const f = _faults(); return !!(f && f[key]); },
        trigger() { const s = _solver(window.sys); if (s) s.setFault(key, true); },
        repair() { const s = _solver(window.sys); if (s) s.repairFault(key); },
    };
}

export const FAULT_CONFIGS = {
    'vt-fault': _mkFault('vt-fault', '黏度传感器 VT 故障（A 42）', '燃油黏度控制', 'vt', 'A 42'),
    'tt-fault': _mkFault('tt-fault', '温度传感器 TT 故障（A 53）', '燃油温度控制', 'tt', 'A 53'),
    'srv-stuck': _mkFault('srv-stuck', '蒸汽调节阀 SRV 卡死（A 82）', '加热系统', 'srv', 'A 82'),
    'cv-fault': _mkFault('cv-fault', '三通转换阀 CV 故障（A 70）', 'DO/HFO 转换', 'cv', 'A 70'),
    'power-fault': _mkFault('power-fault', '控制电源故障（A 87）', '电源', 'power', 'A 87'),
    'pump1-fault': _mkFault('pump1-fault', '1 号供油泵故障', '燃油供油泵', 'pump1', 'A 56'),
    'cp1-fault': _mkFault('cp1-fault', '1 号循环泵故障', '燃油循环泵', 'cp1', 'A 57'),
    'filter-clog': _mkFault('filter-clog', '自动滤器脏堵', '滤器', 'filter', 'A 55'),
};

// ═══════════════════════════════════════════════════════════════
// 工作流辅助
// ═══════════════════════════════════════════════════════════════

function _epc(sys) { return _comp(sys, 'epc'); }
function _mimic(sys) { return _comp(sys, 'mimic'); }

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

/** 泵选择开关换到指定档（顺时针/逆时针点击） */
async function _setPumpMode(sys, id, mode) {
    const epc = _epc(sys);
    const order = ['MAN', 'STOP', 'EPC', 'REM'];
    for (let i = 0; i < 5; i++) {
        const cur = _m(sys).pumps[id].mode;
        if (cur === mode) return true;
        _firePartClick(epc, order.indexOf(mode) > order.indexOf(cur) ? id + '-sel' : id + '-sel-ccw');
        await _sleep(340);
    }
    return _m(sys).pumps[id].mode === mode;
}

/** 自动滤器选择开关换到指定档 */
async function _setFilterMode(sys, mode) {
    const epc = _epc(sys);
    const order = ['DRAIN', 'MAN', 'STOP', 'AUTO'];
    for (let i = 0; i < 5; i++) {
        const cur = _m(sys).filter.mode;
        if (cur === mode) return true;
        const ci = Math.max(0, order.indexOf(cur));
        const ti = Math.max(0, order.indexOf(mode));
        _firePartClick(epc, ti > ci ? 'af-sel' : 'af-sel-ccw');
        await _sleep(340);
    }
    return _m(sys).filter.mode === mode;
}

/** 合上 / 断开某台泵（或滤器）的 MAIN SWITCH */
async function _setMainSwitch(sys, id, on) {
    const epc = _epc(sys);
    const isFilter = id === 'af';
    const cur = isFilter ? _m(sys).filter.mainSwitch : _m(sys).pumps[id].mainSwitch;
    if (cur === !!on) return true;
    _firePartClick(epc, isFilter ? 'af-main' : id + '-main');
    await _sleep(340);
    const now = isFilter ? _m(sys).filter.mainSwitch : _m(sys).pumps[id].mainSwitch;
    return now === !!on;
}

/** 按 START/STOP 把工艺投入 / 停止 */
async function _setProc(sys, on) {
    const epc = _epc(sys);
    for (let i = 0; i < 4 && _m(sys).procOn !== !!on; i++) {
        _firePartClick(epc, 'fn-start');   // 弹出 START? / STOP? 确认
        await _sleep(400);
        _firePartClick(epc, 'key-plus');   // “+” = yes
        await _sleep(500);
    }
    return _m(sys).procOn === !!on;
}

/** 主画面 → 菜单 → 参数设置（两次 ENTER），返回是否已在参数页 */
async function _epcOpenParams(sys) {
    const epc = _epc(sys);
    if (!epc) return false;
    const u = epc._ui;
    if (u.page === 'params') return true;
    if (u.page !== 'menu') { _firePartClick(epc, 'key-enter'); await _sleep(300); }   // 主画面 → 菜单
    for (let i = 0; i < 6 && u.menu !== 0; i++) { _firePartClick(epc, 'key-minus'); await _sleep(180); }
    if (u.page === 'menu') { _firePartClick(epc, 'key-enter'); await _sleep(300); }   // 菜单 → 参数设置
    return u.page === 'params';
}

/** 参数页内用 +/− 选到指定参数项 */
async function _epcPickParam(sys, key) {
    const epc = _epc(sys);
    if (!epc) return false;
    const u = epc._ui;
    const idx = PARAM_KEYS.indexOf(key);
    if (idx < 0) return false;
    await _epcOpenParams(sys);
    for (let i = 0; i < 40 && u.param !== idx && !u.editing; i++) {
        _firePartClick(epc, u.param < idx ? 'key-plus' : 'key-minus');
        await _sleep(150);
    }
    return u.param === idx;
}

/** 按 ENTER：在「选择参数」与「修改数值」之间切换 */
async function _epcEditToggle(sys) {
    const epc = _epc(sys);
    if (!epc) return false;
    _firePartClick(epc, 'key-enter');
    await _sleep(300);
    return !!epc._ui.editing;
}

/** 修改模式内用 +/− 把值调到目标；返回是否达到 */
async function _epcAdjustTo(sys, key, value) {
    const epc = _epc(sys);
    if (!epc) return false;
    const u = epc._ui;
    if (!u.editing) return false;
    const target = (key === 'Pr19') ? String(value).toUpperCase() : Number(value);
    const ok = () => (key === 'Pr19')
        ? String(u.editVal).toUpperCase() === target
        : Math.abs(Number(u.editVal) - target) < 1e-6;
    for (let i = 0; i < 400 && !ok(); i++) {
        let dir = 1;
        if (key === 'Pr1' || key === 'Pr2') {
            const order = [1, 2, 12, 21];
            dir = (order.indexOf(Number(target)) > order.indexOf(Number(u.editVal))) ? 1 : -1;
        } else if (key !== 'Pr19') {
            dir = (Number(u.editVal) < target) ? 1 : -1;
        }
        _firePartClick(epc, dir > 0 ? 'key-plus' : 'key-minus');
        await _sleep(70);
    }
    return ok();
}

/** 按 ENTER 保存（回到菜单）→ 选到「返回主画面」→ ENTER */
async function _epcSaveExit(sys) {
    const epc = _epc(sys);
    if (!epc) return false;
    const u = epc._ui;
    if (u.editing) { _firePartClick(epc, 'key-enter'); await _sleep(280); }
    for (let i = 0; i < 6 && u.menu !== 3; i++) { _firePartClick(epc, 'key-plus'); await _sleep(160); }
    if (u.page === 'menu') { _firePartClick(epc, 'key-enter'); await _sleep(220); }
    return u.page === 'main';
}

/** 控制器菜单改参数（−/+/ENTER 真实按键，一次性完成整个流程） */
async function _epcSetParam(sys, key, value) {
    const s = _solver(sys);
    if (!s) return false;
    if (!(await _epcPickParam(sys, key))) return false;
    await _epcEditToggle(sys);
    await _epcAdjustTo(sys, key, value);
    await _epcSaveExit(sys);
    const got = s.getParam(key);
    return (key === 'Pr19') ? String(got).toUpperCase() === String(value).toUpperCase()
        : Math.abs(Number(got) - Number(value)) < 1e-6;
}

/** 系统上电（合上各泵主开关）+ 泵选择 EPC，等待泵按 Pr 起动 */
async function _powerUp(sys) {
    for (const id of ['sp1', 'sp2', 'cp1', 'cp2']) await _setMainSwitch(sys, id, true);
    await _setMainSwitch(sys, 'af', true);
    for (const id of ['sp1', 'sp2', 'cp1', 'cp2']) await _setPumpMode(sys, id, 'EPC');
    return _m(sys).mainPower === true;
}

/** 送入 HFO 自动运行并加热到黏度控制（幂等） */
async function _runToViscHold(sys) {
    const s = _solver(sys);
    if (!s) return false;
    await _powerUp(sys);
    // 调节阀默认在 MAN，自动控制前先打到 EPC
    if (_m(sys).heater.regMode !== 'EPC') { _firePartClick(_epc(sys), 'rv-epc'); await _sleep(400); }
    if (_m(sys).oilMode !== 'HFO') { s.setOilMode('HFO'); await _sleep(500); }
    if (s.getParam('Pr19') !== 'VISC') await _epcSetParam(sys, 'Pr19', 'VISC');
    if (!_m(sys).procOn) await _setProc(sys, true);
    return _waitFor(sys, x => {
        const mm = _m(x);
        return !!(mm && mm.ctrl.stage === 'HOLD' && mm.ctrl.kind === 'VISC' && mm.oil.temp >= mm.params.Pr30 - 0.5);
    }, 240000, 400);
}

/** 在模拟图上直接点转换阀（等效操作人员在现场手动换油，演示仅用于故障场景） */
async function _mimicClick(sys, part) {
    _firePartClick(_mimic(sys), part);
    await _sleep(400);
}

// ═══════════════════════════════════════════════════════════════
// 工作流
// ═══════════════════════════════════════════════════════════════

export const PROJECT_WORKFLOWS = {
    'fuel-identify': {
        id: 'fuel-identify', name: '1. 供油单元的组成与 EPC-50B 的认识',
        steps: [
            {
                msg: '第 1 步：识别供油单元系统模拟图（MIMIC）。',
                mode: 'find', target: 'mimic',
            },
            {
                msg: '第 2 步：识别 HFO（重油）日用柜。',
                mode: 'find', target: 'mimic', subTarget: 'hfo-tank',
            },
            {
                msg: '第 3 步：识别 DO（柴油）日用柜。',
                mode: 'find', target: 'mimic', subTarget: 'do-tank',
            },
            {
                msg: '第 4 步：识别转换阀 CV（DO/HFO）。',
                mode: 'find', target: 'mimic', subTarget: 'cv',
            },
            {
                msg: '第 5 步：识别 1 号供油泵 SP1。',
                mode: 'find', target: 'mimic', subTarget: 'sp1',
            },
            {
                msg: '第 6 步：识别自动滤器 AFB。',
                mode: 'find', target: 'mimic', subTarget: 'afb',
            },
            {
                msg: '第 7 步：识别滤器压差开关 PDS。',
                mode: 'find', target: 'mimic', subTarget: 'pds',
            },
            {
                msg: '第 8 步：识别流量变送器 FT。',
                mode: 'find', target: 'mimic', subTarget: 'ft',
            },
            {
                msg: '第 9 步：识别带脱气的混合筒。',
                mode: 'find', target: 'mimic', subTarget: 'tank',
            },
            {
                msg: '第 10 步：识别混合筒浮子开关 LS。',
                mode: 'find', target: 'mimic', subTarget: 'ls',
            },
            {
                msg: '第 11 步：识别脱气阀。',
                mode: 'find', target: 'mimic', subTarget: 'dea-valve',
            },
            {
                msg: '第 12 步：识别循环泵 CP1。',
                mode: 'find', target: 'mimic', subTarget: 'cp1',
            },
            {
                msg: '第 13 步：识别蒸汽加热器 SHS。',
                mode: 'find', target: 'mimic', subTarget: 'heater',
            },
            {
                msg: '第 14 步：识别黏度传感器 VT（EVT20）。',
                mode: 'find', target: 'mimic', subTarget: 'vt',
            },
            {
                msg: '第 15 步：识别柴油机',
                mode: 'find', target: 'mimic', subTarget: 'engine',
            },
            {
                msg: '第 16 步：识别 EPC-50B 控制器。',
                mode: 'find', target: 'epc',
            },
            {
                msg: '第 17 步：识别液晶显示器。',
                mode: 'find', target: 'epc', subTarget: 'lcd',
            },
            {
                msg: '第 18 步：识别 INFO 信息显示区。',
                mode: 'find', target: 'epc', subTarget: 'info',
            },
            {
                msg: '第 19 步：识别「−」「+」「ENTER」按键。',
                mode: 'find', target: 'epc', subTarget: 'key-enter',
            },
            {
                msg: '第 20 步：识别 START/STOP 按钮。',
                mode: 'find', target: 'epc', subTarget: 'fn-start',
            },
            {
                msg: '第 21 步：识别 HFO / DO 转换按钮（两侧为 HFO、DO 指示灯）。',
                mode: 'find', target: 'epc', subTarget: 'btn-oil',
            },
            {
                msg: '第 22 步：识别 TT 温度控制指示灯。',
                mode: 'find', target: 'epc', subTarget: 'led-tt',
            },
            {
                msg: '第 23 步：识别供油泵选择开关（MAN/STOP/EPC/REM）。',
                mode: 'find', target: 'epc', subTarget: 'sp1-sel',
            },
            {
                msg: '第 24 步：识别供油泵 MAIN SWITCH 与辅助电压灯。',
                mode: 'find', target: 'epc', subTarget: 'aux-sp1',
            },
            {
                msg: '第 25 步：识别调节阀 MAN 与 DECR 旋钮。',
                mode: 'find', target: 'epc', subTarget: 'heat-decr',
            },
            {
                msg: '第 26 步：识别 HEATING TRACING 0/1 旋钮。',
                mode: 'find', target: 'epc', subTarget: 'ht',
            },
            {
                msg: '第 27 步：测试题——黏度控制与温度设定的关系。',
                mode: 'quiz',
                quizConfig: {
                    question: 'HFO 模式下选黏度控制（Pr19 = Visc）时，Pr20 与 Pr30 的关系是？',
                    options: [
                        'Pr20 是黏度设定值，Pr30 是该黏度对应温度再减 2~4 ℃（一般减 3 ℃），先按 Fa30 加热到 Pr30 再转为黏度调节',
                        'Pr30 是黏度设定值，Pr20 是温度设定值',
                        '两者无关，Pr30 只用于低温报警',
                        'Pr20 只在 DO 模式下有效',
                    ],
                    answer: 0,
                    analysis: 'Pr20 为所需黏度，Pr30 为对应温度减去 3 ℃ 左右。系统先按温升参数 Fa30 加热到 Pr30，随后自动转入黏度定值调节（TT 熄灭、VT 稳定发光），由 PI 参数 Fa25/Fa26 或 Fa27/Fa28 调节加热量。',
                },
            },
        ],
    },

    'fuel-manual': {
        id: 'fuel-manual', name: '2. 供油单元手动操作',
        steps: [
            {
                msg: '第 1 步：打开各泵入口截止阀与 SH1 燃油入口截止阀（蒸汽阀先不开）。',
                mode: 'check',
                op: [
                    { type: 'switch', target: 'mimic', part: 'valve-sp1', msg: '打开 SP1 入口截止阀', async act() { await _mimicClick(_sysOf(this), 'valve-sp1'); } },
                    { type: 'switch', target: 'mimic', part: 'valve-sp2', msg: '打开 SP2 入口截止阀', async act() { await _mimicClick(_sysOf(this), 'valve-sp2'); } },
                    { type: 'switch', target: 'mimic', part: 'valve-cp1', msg: '打开 CP1 入口截止阀', async act() { await _mimicClick(_sysOf(this), 'valve-cp1'); } },
                    { type: 'switch', target: 'mimic', part: 'valve-cp2', msg: '打开 CP2 入口截止阀', async act() { await _mimicClick(_sysOf(this), 'valve-cp2'); } },
                    { type: 'switch', target: 'mimic', part: 'valve-sh1', msg: '打开 SH1 燃油入口截止阀', async act() { await _mimicClick(_sysOf(this), 'valve-sh1'); } },
                ],
                check() {
                    const m = _m(_sysOf(this));
                    if (!m) return false;
                    const mv = m.manualValves || {};
                    return ['sp1', 'sp2', 'cp1', 'cp2', 'sh1'].every(k => mv[k] === true)
                        && (m.steamSV || {}).sh1 === false;
                },
            },
            {
                msg: '第 2 步：合上 5 个电源开关（4 台泵 + 自动滤器）。',
                mode: 'check',
                op: [
                    { type: 'switch', target: 'epc', part: 'sp1-main', msg: '合上供油泵 1 主开关', async act() { const s = _sysOf(this); await _setMainSwitch(s, 'sp1', true); } },
                    { type: 'switch', target: 'epc', part: 'sp2-main', msg: '合上供油泵 2 主开关', async act() { const s = _sysOf(this); await _setMainSwitch(s, 'sp2', true); } },
                    { type: 'switch', target: 'epc', part: 'cp1-main', msg: '合上循环泵 1 主开关', async act() { const s = _sysOf(this); await _setMainSwitch(s, 'cp1', true); } },
                    { type: 'switch', target: 'epc', part: 'cp2-main', msg: '合上循环泵 2 主开关', async act() { const s = _sysOf(this); await _setMainSwitch(s, 'cp2', true); } },
                    { type: 'switch', target: 'epc', part: 'af-main', msg: '合上自动滤器主开关', async act() { const s = _sysOf(this); await _setMainSwitch(s, 'af', true); } },
                ],
                check() {
                    const m = _m(_sysOf(this));
                    return !!(m && ['sp1', 'sp2', 'cp1', 'cp2'].every(k => m.pumps[k].mainSwitch) && m.filter.mainSwitch);
                },
            },
            {
                msg: '第 3 步：按 START/STOP，再按「+」确认，起动控制程序。',
                mode: 'check',
                op: [
                    { type: 'btn', target: 'epc', part: 'fn-start', msg: '按 START/STOP', async act() { const s = _sysOf(this); _firePartClick(_epc(s), 'fn-start'); await _sleep(500); } },
                    { type: 'btn', target: 'epc', part: 'key-plus', msg: '按「+」确认（START? +=yes）', async act() { const s = _sysOf(this); _firePartClick(_epc(s), 'key-plus'); await _sleep(600); } },
                ],
                check() {
                    const m = _m(_sysOf(this));
                    return !!(m && m.procOn);
                },
            },
            {
                msg: '第 4 步：起动 1 号供油泵与 1 号循环泵，待压力正常后复位报警。',
                mode: 'check',
                op: [
                    { type: 'knob', target: 'epc', part: 'sp1-sel', msg: '供油泵 1 → MAN（起动）', async act() { const s = _sysOf(this); await _setPumpMode(s, 'sp1', 'MAN'); } },
                    { type: 'knob', target: 'epc', part: 'cp1-sel', msg: '循环泵 1 → MAN（起动）', async act() { const s = _sysOf(this); await _setPumpMode(s, 'cp1', 'MAN'); } },
                    { type: 'observe', target: 'mimic', part: 'sp1', msg: '观察 SP1 运行、PT1 建压', async act() { const s = _sysOf(this); await _waitFor(s, x => _m(x).oil.supplyPress > 0.5, 20000, 250); } },
                    { type: 'observe', target: 'mimic', part: 'cp1', msg: '观察 CP1 运行、PT2 建压', async act() { const s = _sysOf(this); await _waitFor(s, x => _m(x).oil.circPress > 0.5, 20000, 250); } },
                    { type: 'btn', target: 'epc', part: 'fn-alarm', msg: '按 ALARM 复位报警', async act() { const s = _sysOf(this); for (let i = 0; i < 2; i++) { _firePartClick(_epc(s), 'fn-alarm'); await _sleep(500); } } },
                ],
                check() {
                    const m = _m(_sysOf(this));
                    if (!m) return false;
                    const okPump = m.pumps.sp1.on && m.pumps.cp1.on;
                    const okP = m.oil.supplyPress > 0.5 && m.oil.circPress > 0.5;
                    const noAlarm = !(m.alarms || []).some(a => a.active && !a.ack);
                    return !!(okPump && okP && noAlarm);
                },
            },
            {
                msg: '第 5 步：调节阀 MAN，手动把开度加到约 30 %，开启 SH1 进口蒸汽阀。',
                mode: 'check',
                op: [
                    { type: 'knob', target: 'epc', part: 'rv-man', msg: '调节阀 → MAN', async act() { const s = _sysOf(this); _firePartClick(_epc(s), 'rv-man'); await _sleep(500); } },
                    { type: 'knob', target: 'epc', part: 'heat-decr', msg: '按住 DECR 把开度从 100 % 降到约 30 %', async act() {
                        const s = _sysOf(this), sol = _solver(s);
                        sol.beginHeat(-1);                                  // 按住 DECR
                        await _waitFor(s, x => _m(x).heater.manualPower <= 26, 40000, 150);    // 26 % + 伴行 4 % ≈ 30 %
                        sol.endHeat();                                      // 松手，开度保持
                        await _waitFor(s, x => _m(x).heater.shs <= 32, 20000, 150);            // 等阀走到位
                        await _sleep(400);
                    } },
                    { type: 'switch', target: 'mimic', part: 'stv-sh1', msg: '开启 SH1 进口蒸汽阀', async act() { await _mimicClick(_sysOf(this), 'stv-sh1'); } },
                ],
                check() {
                    const m = _m(_sysOf(this));
                    return !!(m && m.heater.regMode === 'MAN' && m.heater.shs >= 25 && m.heater.shs <= 35
                        && (m.steamSV || {}).sh1 === true);
                },
            },
            {
                msg: '第 6 步：打开 FT 进口截止阀、关闭旁通截止阀，开启流量监测。',
                mode: 'check',
                op: [
                    { type: 'switch', target: 'mimic', part: 'ft-in', msg: '打开 FT 进口截止阀', async act() { await _mimicClick(_sysOf(this), 'ft-in'); } },
                    { type: 'switch', target: 'mimic', part: 'ft-by', msg: '关闭 FT 旁通截止阀', async act() { await _mimicClick(_sysOf(this), 'ft-by'); } },
                    { type: 'observe', target: 'mimic', part: 'ft', msg: '观察 FT 流量读数', async act() { const s = _sysOf(this); await _waitFor(s, x => (_m(x).oil.ftFlow || 0) > 0.5, 15000, 250); } },
                ],
                check() {
                    const m = _m(_sysOf(this));
                    if (!m) return false;
                    const fv = m.ftValves || {};
                    return !!(fv.in === true && fv.by === false && (m.oil.ftFlow || 0) > 0.5);
                },
            },
        ],
    },

    'fuel-auto': {
        id: 'fuel-auto', name: '3. 供油单元自动控制和换油操作',
        steps: [
            {
                msg: '第 1 步：开启各泵入口、SH1 燃油与蒸汽入口截止阀。',
                mode: 'check',
                op: [
                    { type: 'switch', target: 'mimic', part: 'valve-sp1', msg: '打开 SP1 入口截止阀', async act() { await _mimicClick(_sysOf(this), 'valve-sp1'); } },
                    { type: 'switch', target: 'mimic', part: 'valve-sp2', msg: '打开 SP2 入口截止阀', async act() { await _mimicClick(_sysOf(this), 'valve-sp2'); } },
                    { type: 'switch', target: 'mimic', part: 'valve-cp1', msg: '打开 CP1 入口截止阀', async act() { await _mimicClick(_sysOf(this), 'valve-cp1'); } },
                    { type: 'switch', target: 'mimic', part: 'valve-cp2', msg: '打开 CP2 入口截止阀', async act() { await _mimicClick(_sysOf(this), 'valve-cp2'); } },
                    { type: 'switch', target: 'mimic', part: 'valve-sh1', msg: '打开 SH1 燃油入口截止阀', async act() { await _mimicClick(_sysOf(this), 'valve-sh1'); } },
                    { type: 'switch', target: 'mimic', part: 'stv-sh1', msg: '打开 SH1 蒸汽入口截止阀', async act() { await _mimicClick(_sysOf(this), 'stv-sh1'); } },
                ],
                check() {
                    const m = _m(_sysOf(this));
                    if (!m) return false;
                    const mv = m.manualValves || {};
                    return ['sp1', 'sp2', 'cp1', 'cp2', 'sh1'].every(k => mv[k] === true)
                        && (m.steamSV || {}).sh1 === true;
                },
            },
            {
                msg: '第 2 步：合上 5 个电源开关（4 台泵 + 自动滤器）。',
                mode: 'check',
                op: [
                    { type: 'switch', target: 'epc', part: 'sp1-main', msg: '合上供油泵 1 主开关', async act() { const s = _sysOf(this); await _setMainSwitch(s, 'sp1', true); } },
                    { type: 'switch', target: 'epc', part: 'sp2-main', msg: '合上供油泵 2 主开关', async act() { const s = _sysOf(this); await _setMainSwitch(s, 'sp2', true); } },
                    { type: 'switch', target: 'epc', part: 'cp1-main', msg: '合上循环泵 1 主开关', async act() { const s = _sysOf(this); await _setMainSwitch(s, 'cp1', true); } },
                    { type: 'switch', target: 'epc', part: 'cp2-main', msg: '合上循环泵 2 主开关', async act() { const s = _sysOf(this); await _setMainSwitch(s, 'cp2', true); } },
                    { type: 'switch', target: 'epc', part: 'af-main', msg: '合上自动滤器主开关', async act() { const s = _sysOf(this); await _setMainSwitch(s, 'af', true); } },
                ],
                check() {
                    const m = _m(_sysOf(this));
                    return !!(m && ['sp1', 'sp2', 'cp1', 'cp2'].every(k => m.pumps[k].mainSwitch) && m.filter.mainSwitch);
                },
            },
            {
                msg: '第 3 步：各泵选择 EPC，自动滤器选 AUT(O)，蒸汽调节阀选 EPC。',
                mode: 'check',
                op: [
                    { type: 'knob', target: 'epc', part: 'sp1-sel', msg: '供油泵 1 → EPC', async act() { const s = _sysOf(this); await _setPumpMode(s, 'sp1', 'EPC'); } },
                    { type: 'knob', target: 'epc', part: 'sp2-sel', msg: '供油泵 2 → EPC', async act() { const s = _sysOf(this); await _setPumpMode(s, 'sp2', 'EPC'); } },
                    { type: 'knob', target: 'epc', part: 'cp1-sel', msg: '循环泵 1 → EPC', async act() { const s = _sysOf(this); await _setPumpMode(s, 'cp1', 'EPC'); } },
                    { type: 'knob', target: 'epc', part: 'cp2-sel', msg: '循环泵 2 → EPC', async act() { const s = _sysOf(this); await _setPumpMode(s, 'cp2', 'EPC'); } },
                    { type: 'knob', target: 'epc', part: 'af-sel', msg: '自动滤器选择开关 → AUTO', async act() { const s = _sysOf(this); await _setFilterMode(s, 'AUTO'); } },
                    { type: 'knob', target: 'epc', part: 'rv-epc', msg: '蒸汽调节阀 → EPC', async act() { const s = _sysOf(this); _firePartClick(_epc(s), 'rv-epc'); await _sleep(500); } },
                ],
                check() {
                    const m = _m(_sysOf(this));
                    if (!m) return false;
                    return ['sp1', 'sp2', 'cp1', 'cp2'].every(k => m.pumps[k].mode === 'EPC')
                        && m.filter.mode === 'AUTO' && m.heater.regMode === 'EPC';
                },
            },
            {
                msg: '第 4 步：按 START/STOP，再按「+」确认，起动控制程序。',
                mode: 'check',
                op: [
                    { type: 'btn', target: 'epc', part: 'fn-start', msg: '按 START/STOP', async act() { const s = _sysOf(this); _firePartClick(_epc(s), 'fn-start'); await _sleep(500); } },
                    { type: 'btn', target: 'epc', part: 'key-plus', msg: '按「+」确认（START? +=yes）', async act() { const s = _sysOf(this); _firePartClick(_epc(s), 'key-plus'); await _sleep(600); } },
                ],
                check() {
                    const m = _m(_sysOf(this));
                    return !!(m && m.procOn);
                },
            },
            {
                msg: '第 5 步：观察泵自动起动（DO 温度定值 70 ℃），压力正常后复位报警。',
                mode: 'check',
                op: [
                    { type: 'observe', target: 'mimic', part: 'sp1', msg: '供油泵（日用泵）自动起动', async act() { const s = _sysOf(this); await _waitFor(s, x => _m(x).pumps.sp1.on || _m(x).pumps.sp2.on, 25000, 250); } },
                    { type: 'observe', target: 'mimic', part: 'cp1', msg: '循环泵（增压泵）自动起动', async act() { const s = _sysOf(this); await _waitFor(s, x => _m(x).pumps.cp1.on || _m(x).pumps.cp2.on, 25000, 250); } },
                    { type: 'observe', target: 'mimic', part: 'tt', msg: '观察 DO 温度定值控制升温至 70 ℃', async act() {
                        const s = _sysOf(this);
                        await _waitFor(s, x => Math.abs(_m(x).oil.temp - 70) < 3, 180000, 400);
                    } },
                    { type: 'btn', target: 'epc', part: 'fn-alarm', msg: '按 ALARM 复位报警', async act() { const s = _sysOf(this); for (let i = 0; i < 2; i++) { _firePartClick(_epc(s), 'fn-alarm'); await _sleep(500); } } },
                ],
                check() {
                    const m = _m(_sysOf(this));
                    if (!m) return false;
                    const pumpOn = (m.pumps.sp1.on || m.pumps.sp2.on) && (m.pumps.cp1.on || m.pumps.cp2.on);
                    const doTemp = m.oilMode === 'DO' && Math.abs(m.oil.temp - (m.params.Pr35 || 70)) < 4;
                    const noAlarm = !(m.alarms || []).some(a => a.active && !a.ack);
                    return !!(pumpOn && doTemp && noAlarm);
                },
            },
            {
                msg: '第 6 步：按换油按钮并「+」确认，DO→HFO，观察程序升温直到转入黏度定值控制。',
                mode: 'check',
                op: [
                    { type: 'btn', target: 'epc', part: 'btn-oil', msg: '按换油按钮（DO→HFO）', async act() { const s = _sysOf(this); _firePartClick(_epc(s), 'btn-oil'); await _sleep(500); } },
                    { type: 'btn', target: 'epc', part: 'key-plus', msg: '按「+」确认（Change oil mode? +=yes）', async act() { const s = _sysOf(this); _firePartClick(_epc(s), 'key-plus'); await _sleep(600); } },
                    { type: 'observe', target: 'mimic', part: 'cv', msg: '观察转换阀动作（10 s，显示开度）', async act() {
                        const s = _sysOf(this);
                        await _waitFor(s, x => _m(x).cvSwitching, 20000, 200);
                        await _waitFor(s, x => !_m(x).cvSwitching, 30000, 200);
                    } },
                    { type: 'observe', target: 'mimic', part: 'tt', msg: '观察程序升温（Fa30 = 60 ℃/min）到 Pr30−3', async act() {
                        const s = _sysOf(this);
                        await _waitFor(s, x => !(_m(x).prog && _m(x).prog.active), 240000, 400);
                    } },
                    { type: 'observe', target: 'epc', part: 'led-vt', msg: '转入黏度定值控制，VT 灯常亮', async act() {
                        const s = _sysOf(this);
                        await _waitFor(s, x => (_m(x).lamp || {}).vt === 'on' && _m(x).ctrl.kind === 'VISC', 240000, 400);
                    } },
                ],
                check() {
                    const m = _m(_sysOf(this));
                    if (!m) return false;
                    const hfo = m.oilMode === 'HFO' && m.cv === 'HFO';
                    const visc = m.ctrl.kind === 'VISC' && !(m.prog && m.prog.active);
                    const lampOn = (m.lamp || {}).vt === 'on';
                    return !!(hfo && visc && lampOn);
                },
            },
        ],
    },

    'fuel-fault': {
        id: 'fuel-fault', name: '4. 供油单元的故障处理',
        steps: [
            {
                msg: '第 1 步：点击「起动系统」，直到 DO 模式下进入温度定值控制，并复位警报。',
                mode: 'check',
                op: [
                    { type: 'wire', button: 'btnStartSys', msg: '点击工具栏「起动系统」', flashMs: 1600, holdMs: 800,
                      async act() { const s = _sysOf(this); await s.applyStartSystem(); await _sleep(800); } },
                    { type: 'observe', target: 'epc', part: 'lcd', msg: '等待进入温度定值控制（Temp ctl / HOLD）', async act() {
                        const s = _sysOf(this);
                        await _waitFor(s, x => {
                            const mm = _m(x);
                            return !!(mm && mm.procOn && mm.ctrl.kind === 'TEMP'
                                && String(mm.ctrl.stage || '').startsWith('HOLD'));
                        }, 240000, 400);
                    } },
                    { type: 'observe', target: 'epc', part: 'led-tt', msg: 'TT 灯亮（温度定值控制）', async act() { await _sleep(1500); } },
                    { type: 'btn', target: 'epc', part: 'fn-alarm', msg: '按 ALARM 复位报警', async act() {
                        const s = _sysOf(this);
                        for (let i = 0; i < 2; i++) { _firePartClick(_epc(s), 'fn-alarm'); await _sleep(500); }
                    } },
                ],
                check() {
                    const m = _m(_sysOf(this));
                    if (!m) return false;
                    const pumpOn = m.pumps.sp1.on || m.pumps.sp2.on;
                    const tempCtl = m.oilMode === 'DO' && m.ctrl.kind === 'TEMP'
                        && String(m.ctrl.stage || '').startsWith('HOLD')
                        && Math.abs(m.oil.temp - (m.params.Pr35 || 70)) < 4;
                    const noAlarm = !(m.alarms || []).some(a => a.active);
                    return !!(pumpOn && tempCtl && noAlarm);
                },
            },
            {
                msg: '第 2 步：按换油按钮并确认，直到进入 HFO 黏度定值控制、VT 灯常亮。',
                mode: 'check',
                op: [
                    { type: 'btn', target: 'epc', part: 'btn-oil', msg: '按换油按钮（DO→HFO）', async act() { const s = _sysOf(this); _firePartClick(_epc(s), 'btn-oil'); await _sleep(500); } },
                    { type: 'btn', target: 'epc', part: 'key-plus', msg: '按「+」确认（Change oil mode? +=yes）', async act() { const s = _sysOf(this); _firePartClick(_epc(s), 'key-plus'); await _sleep(600); } },
                    { type: 'observe', target: 'mimic', part: 'cv', msg: '转换阀动作（约 10 s）', async act() {
                        const s = _sysOf(this);
                        await _waitFor(s, x => _m(x).cvSwitching, 20000, 200);
                        await _waitFor(s, x => !_m(x).cvSwitching, 30000, 200);
                    } },
                    { type: 'observe', target: 'mimic', part: 'tt', msg: '等待程序升温结束', async act() {
                        const s = _sysOf(this);
                        await _waitFor(s, x => !(_m(x).prog && _m(x).prog.active), 240000, 400);
                    } },
                    { type: 'observe', target: 'epc', part: 'led-vt', msg: 'VT 灯常亮（黏度定值控制）', async act() {
                        const s = _sysOf(this);
                        await _waitFor(s, x => (_m(x).lamp || {}).vt === 'on' && _m(x).ctrl.kind === 'VISC', 240000, 400);
                    } },
                ],
                check() {
                    const m = _m(_sysOf(this));
                    if (!m) return false;
                    const hfo = m.oilMode === 'HFO' && m.cv === 'HFO';
                    const visc = m.ctrl.kind === 'VISC' && !(m.prog && m.prog.active);
                    return !!(hfo && visc && (_m(_sysOf(this)).lamp || {}).vt === 'on');
                },
            },
            {
                msg: '第 3 步：设置「1 号供油泵故障」，观察备用泵自动投入。',
                mode: 'check',
                op: [
                    { type: 'fault', fault: 'pump1-fault', msg: '勾选「1 号供油泵故障」并应用设置', async act() { await _sleep(600); } },
                    { type: 'observe', target: 'mimic', part: 'sp1', msg: '1 号供油泵停转', async act() {
                        const s = _sysOf(this);
                        await _waitFor(s, x => !_m(x).pumps.sp1.on, 20000, 250);
                    } },
                    { type: 'observe', target: 'mimic', part: 'sp2', msg: '2 号供油泵（备用）自动起动', async act() {
                        const s = _sysOf(this);
                        await _waitFor(s, x => _m(x).pumps.sp2.on, 20000, 250);
                    } },
                    { type: 'observe', target: 'epc', part: 'lcd', msg: '报警 A 56（备用泵自动投入）', async act() {
                        const s = _sysOf(this);
                        await _waitFor(s, x => _m(x).alarms.some(a => a.active && a.code === 'A 56'), 20000, 250);
                    } },
                ],
                check() {
                    const m = _m(_sysOf(this));
                    const s = _solver(_sysOf(this));
                    if (!m || !s) return false;
                    return !!(m.faults.pump1 && m.switchover.supply && m.pumps.sp2.on && !m.pumps.sp1.on);
                },
            },
            {
                msg: '第 4 步：设置「黏度传感器 VT 故障」，观察自动切换为温度定值控制。',
                mode: 'check',
                op: [
                    { type: 'fault', fault: 'vt-fault', msg: '勾选「黏度传感器 VT 故障」并应用设置', async act() { await _sleep(600); } },
                    { type: 'observe', target: 'epc', part: 'lcd', msg: 'Pr19 自动改为 TEMP、VT 读数失效', async act() {
                        const s = _sysOf(this);
                        await _waitFor(s, x => String(_m(x).params.Pr19).toUpperCase() === 'TEMP', 15000, 200);
                    } },
                    { type: 'observe', target: 'epc', part: 'led-tt', msg: 'VT 灯熄灭、TT 灯亮（温度定值控制）', async act() {
                        const s = _sysOf(this);
                        await _waitFor(s, x => {
                            const L = _m(x).lamp || {};
                            return L.vt === 'off' && L.tt !== 'off' && _m(x).ctrl.kind === 'TEMP';
                        }, 20000, 250);
                    } },
                    { type: 'observe', target: 'mimic', part: 'tt', msg: '温度按 Pr30 定值保持', async act() {
                        const s = _sysOf(this);
                        await _waitFor(s, x => {
                            const mm = _m(x);
                            return mm.ctrl.kind === 'TEMP'
                                && Math.abs(mm.oil.temp - mm.params.Pr30) < 4;
                        }, 60000, 400);
                    } },
                ],
                check() {
                    const m = _m(_sysOf(this));
                    if (!m) return false;
                    const L = m.lamp || {};
                    return !!(m.faults.vt && String(m.params.Pr19).toUpperCase() === 'TEMP'
                        && m.ctrl.kind === 'TEMP' && L.tt !== 'off');
                },
            },
            {
                msg: '第 5 步：修复全部故障，并按 ALARM 复位报警。',
                mode: 'check',
                op: [
                    { type: 'fault', fault: 'pump1-fault', repair: true, msg: '取消「1 号供油泵故障」', async act() { await _sleep(600); } },
                    { type: 'fault', fault: 'vt-fault', repair: true, msg: '取消「黏度传感器 VT 故障」', async act() { await _sleep(600); } },
                    { type: 'btn', target: 'epc', part: 'fn-alarm', msg: '按 ALARM 确认报警', async act() { const s = _sysOf(this); _firePartClick(_epc(s), 'fn-alarm'); await _sleep(600); } },
                    { type: 'btn', target: 'epc', part: 'fn-alarm', msg: '再按 ALARM 清除报警记录', async act() { const s = _sysOf(this); _firePartClick(_epc(s), 'fn-alarm'); await _sleep(600); } },
                ],
                check() {
                    const m = _m(_sysOf(this));
                    if (!m) return false;
                    const noFault = !m.faults.pump1 && !m.faults.vt;
                    const noAlarm = !(m.alarms || []).some(a => a.active);
                    return !!(noFault && noAlarm);
                },
            },
        ],
    },

    'fuel-param': {
        id: 'fuel-param', name: '5. 重要参数的设置',
        steps: [
            {
                msg: '第 1 步：点击「起动系统」，直到进入 DO 温度定值控制，复位报警。',
                mode: 'check',
                op: [
                    { type: 'wire', button: 'btnStartSys', msg: '点击工具栏「起动系统」', flashMs: 1600, holdMs: 800,
                      async act() { const s = _sysOf(this); await s.applyStartSystem(); await _sleep(800); } },
                    { type: 'observe', target: 'epc', part: 'lcd', msg: '等待进入温度定值控制（Temp ctl / HOLD）', async act() {
                        const s = _sysOf(this);
                        await _waitFor(s, x => {
                            const mm = _m(x);
                            return !!(mm && mm.procOn && mm.ctrl.kind === 'TEMP'
                                && String(mm.ctrl.stage || '').startsWith('HOLD'));
                        }, 240000, 400);
                    } },
                    { type: 'btn', target: 'epc', part: 'fn-alarm', msg: '按 ALARM 复位报警', async act() {
                        const s = _sysOf(this);
                        for (let i = 0; i < 2; i++) { _firePartClick(_epc(s), 'fn-alarm'); await _sleep(500); }
                    } },
                ],
                check() {
                    const m = _m(_sysOf(this));
                    if (!m) return false;
                    const pumpOn = m.pumps.sp1.on || m.pumps.sp2.on;
                    const tempCtl = m.oilMode === 'DO' && m.ctrl.kind === 'TEMP'
                        && String(m.ctrl.stage || '').startsWith('HOLD')
                        && Math.abs(m.oil.temp - (m.params.Pr35 || 70)) < 4;
                    const noAlarm = !(m.alarms || []).some(a => a.active);
                    return !!(pumpOn && tempCtl && noAlarm);
                },
            },
            {
                msg: '第 2 步：两次 ENTER 进参数页，选 Pr2 改为 2(1) 并保存。',
                mode: 'check',
                op: [
                    { type: 'btn', target: 'epc', part: 'key-enter', msg: '连按两次 ENTER 进入参数设置', async act() { await _epcOpenParams(_sysOf(this)); } },
                    { type: 'btn', target: 'epc', part: 'key-plus', msg: '按「+」选到 Pr2（循环泵方式）', async act() { await _epcPickParam(_sysOf(this), 'Pr2'); } },
                    { type: 'btn', target: 'epc', part: 'key-enter', msg: '按 ENTER 进入修改模式', async act() { await _epcEditToggle(_sysOf(this)); } },
                    { type: 'btn', target: 'epc', part: 'key-plus', msg: '按「+」把设定值改为 2(1)', async act() { await _epcAdjustTo(_sysOf(this), 'Pr2', 21); } },
                    { type: 'btn', target: 'epc', part: 'key-enter', msg: '按 ENTER 保存参数', async act() { await _epcSaveExit(_sysOf(this)); } },
                ],
                check() {
                    const s = _solver(_sysOf(this));
                    return !!(s && Number(s.getParam('Pr2')) === 21);
                },
            },
            {
                msg: '第 3 步：把 Pr19 由 VISC 改为 TEMP 并保存。',
                mode: 'check',
                op: [
                    { type: 'btn', target: 'epc', part: 'key-enter', msg: '连按两次 ENTER 进入参数设置', async act() { await _epcOpenParams(_sysOf(this)); } },
                    { type: 'btn', target: 'epc', part: 'key-plus', msg: '按「+」选到 Pr19（控制方式）', async act() { await _epcPickParam(_sysOf(this), 'Pr19'); } },
                    { type: 'btn', target: 'epc', part: 'key-enter', msg: '按 ENTER 进入修改模式', async act() { await _epcEditToggle(_sysOf(this)); } },
                    { type: 'btn', target: 'epc', part: 'key-plus', msg: '按「+」把 VISC 改为 TEMP', async act() { await _epcAdjustTo(_sysOf(this), 'Pr19', 'TEMP'); } },
                    { type: 'btn', target: 'epc', part: 'key-enter', msg: '按 ENTER 保存参数', async act() { await _epcSaveExit(_sysOf(this)); } },
                ],
                check() {
                    const s = _solver(_sysOf(this));
                    return !!(s && String(s.getParam('Pr19')).toUpperCase() === 'TEMP');
                },
            },
            {
                msg: '第 4 步：把蒸汽比例带 Fa25 改为 20 ℃ 并保存。',
                mode: 'check',
                op: [
                    { type: 'btn', target: 'epc', part: 'key-enter', msg: '连按两次 ENTER 进入参数设置', async act() { await _epcOpenParams(_sysOf(this)); } },
                    { type: 'btn', target: 'epc', part: 'key-plus', msg: '按「+」选到 Fa25（蒸汽比例带）', async act() { await _epcPickParam(_sysOf(this), 'Fa25'); } },
                    { type: 'btn', target: 'epc', part: 'key-enter', msg: '按 ENTER 进入修改模式', async act() { await _epcEditToggle(_sysOf(this)); } },
                    { type: 'btn', target: 'epc', part: 'key-plus', msg: '按「+」按 2 ℃ 步进改到 20', async act() { await _epcAdjustTo(_sysOf(this), 'Fa25', 20); } },
                    { type: 'btn', target: 'epc', part: 'key-enter', msg: '按 ENTER 保存参数', async act() { await _epcSaveExit(_sysOf(this)); } },
                ],
                check() {
                    const s = _solver(_sysOf(this));
                    return !!(s && Number(s.getParam('Fa25')) === 20);
                },
            },
            {
                msg: '第 5 步：测试题——Fa25 = 20 ℃ 的含义。',
                mode: 'quiz',
                quizConfig: {
                    question: '蒸汽加热的比例带 Fa25 设为 20 ℃，表示什么？',
                    options: [
                        '温度偏差在 ±20 ℃ 内时阀位按偏差成比例变化：偏差 20 ℃ 时阀全开、反向 20 ℃ 时全关，比例带越小增益越大',
                        '蒸汽温度必须比燃油设定温度高 20 ℃',
                        '燃油温度的报警偏差范围是 ±20 ℃',
                        '蒸汽调节阀的最大开度只能到 20 %',
                    ],
                    answer: 0,
                    analysis: '比例带是「偏差 → 0~100 % 阀位」的对应范围：Fa25 = 20 ℃ 即偏差 20 ℃ 恰使阀从全关走到全开（增益 5 %/℃）。比例带越大，同样偏差的调节作用越弱、过程平稳但余差大；比例带越小反应越快，过大则容易振荡。',
                },
            },
        ],
    },

};

export const PROJECT_PAGES = [];
