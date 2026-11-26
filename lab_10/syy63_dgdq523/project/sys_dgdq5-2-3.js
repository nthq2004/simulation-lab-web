/**
 * 船舶柴油发电机组（副机）— 功能测试仿真项目配置（两页工程）
 * ═══════════════════════════════════════════════════════════════════════════
 *  页 0 索引（PageManager 浮层卡片）
 *
 *  页 1 副机起动和调速系统的功能测试（GensetStartMimic，1590 × 840）：
 *      ├ 左上 柴油发电机组机旁控制面板（ENGINE CONTROL UNIT，与页 2 完全一致）
 *      ├ 右上 发电机遥控操作模块（起动 / 停止 / 调速 / 合闸 / 分闸 / 负荷测试 MCCB）
 *      ├ 左中 柴油发电机组模型（柴油机 + 发电机 + 盘车机构 + 起动空气，与页 2 完全一致）
 *      ├ 右中 起动时序与监控模块（9 个互斥时序灯 + 燃油量趋势 + 转速趋势，各 3 min）
 *      ├ 左下 起动联锁和执行模块（8 输入与门 + 电磁阀 → 主起动阀 → 空气分配器 → 各缸）
 *      └ 右下 燃油和调速系统（日用柜 / 燃油泵 / 速闭阀 / 高压油泵 / 刺破阀 / 调速器）
 *
 *  页 2 副机安全保护系统的功能测试（GensetSafetyMimic，1590 × 840）：
 *      ├ 左上 机旁控制面板        ├ 右上 安保测试工具箱（泵压 / 频率 / 电阻 / 校验炉）
 *      ├ 左中 柴油发电机组模型    ├ 右中 安全保护模块（超速 / 滑油低压 / 水温高）
 *      ├ 左下 滑油系统            └ 右下 高温淡水冷却系统
 *
 *  两页各由独立求解器驱动：sys.gensetStartSolver（起动与调速）/ sys.gensetSolver（安全保护）
 * ═══════════════════════════════════════════════════════════════════════════
 */
import { GensetSafetyMimic } from '../components/GensetSafetyMimic.js';
import { GensetStartMimic } from '../components/GensetStartMimic.js';

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
const _solver = (sys) => (sys && sys.gensetSolver) ? sys.gensetSolver : null;
const _m = (sys) => { const s = _solver(sys); return s ? s.m : null; };

/** 页 1（起动和调速）的求解器 */
const _startSolver = (sys) => (sys && sys.gensetStartSolver) ? sys.gensetStartSolver : null;

/** 工具栏操作作用于"当前页"对应的求解器（页 1 起动调速 / 页 2 安全保护） */
const _curSolver = (sys) => {
    const pg = (sys && sys.pageMgr) ? sys.pageMgr.currentPage : 1;
    if (pg === 2) return _solver(sys) || _startSolver(sys);
    return _startSolver(sys) || _solver(sys);
};

// ═══════════════════════════════════════════════════════════════
// 组件配置（1920 × 1080 基准坐标，单页同屏）
// ═══════════════════════════════════════════════════════════════

export const componentConfigs = [
    // 页 1：起动和调速系统（本页在最前）
    { Class: GensetStartMimic, id: 'startmimic', x: -160, y: 20, width: 1590, height: 840, visible: true, page: 1 },

    // 页 2：安全保护系统
    { Class: GensetSafetyMimic, id: 'mimic', x: -160, y: 20, width: 1590, height: 840, visible: true, page: 2 },

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

/** 工具栏「自动投用」：机组备用，辅助泵与预润滑泵投入 */
export function applyAllPresets(opts) {
    if (opts && opts.init) return;
    const sys = _sysOf(this);
    const s = _curSolver(sys);
    if (!s) return;
    if (s.m && s.m.faults && 'filterClog' in s.m.faults) {
        // 页 2：安全保护系统
        const m = s.m;
        m.mode = 'LOCAL';
        m.turningGear = false;
        m.blockHandle = false;
        m.ht.pump1 = true;
        m.lo.pumpAtt = true;
        m.lo.pumpPrim = false;   // 预润滑泵默认停止（手动方式）
        s.clearTestTools();
    } else {
        // 页 1：起动和调速系统 → 冷态备用（8 个起动条件全部满足）
        s.resetAll();
        s.m.mode = 'LOCAL';
        s.m.turningGear = false;
        s.m.blockHandle = false;
        s.m.safetyReset = true;
    }
    if (sys.redrawAll) sys.redrawAll();
}

/** 工具栏「起动系统」：一键起动至稳定运行（页 1）/ 60 % 负荷（页 2） */
export async function applyStartSystem() {
    const sys = _sysOf(this);
    const s = _curSolver(sys);
    if (!s) return;
    if (s.m && s.m.faults && 'filterClog' in s.m.faults) {
        const keepFaults = { ...s.m.faults };
        s.resetAll();
        Object.assign(s.m.faults, keepFaults);
        s.quickStart();
    } else {
        // 页 1：复位联锁 → 起动 → 稳定运行 → 合闸
        s.quickStart();
        s.closeBreaker();
    }
    await _sleep(500);
    if (sys.redrawAll) sys.redrawAll();
}

/** 工具栏「5 点步进」：复位 → 辅助泵 → 预润滑 → 起动 → 带负荷（页 2）
 *  页 1：复位 → 起动 → 稳定运行 → 合闸 → 带负荷 */
export function fiveStep() {
    const sys = _sysOf(this);
    const s = _curSolver(sys);
    if (!s) return;
    if (sys._fiveStepIdx === undefined) sys._fiveStepIdx = 0;
    const idx = sys._fiveStepIdx % 5;
    sys._fiveStepIdx = idx + 1;
    s.fiveStep(idx);
    if (sys.redrawAll) sys.redrawAll();
}

// ═══════════════════════════════════════════════════════════════
// 故障配置（走「故障设置」界面）
// ═══════════════════════════════════════════════════════════════

function _faults(sys) {
    const s = _solver(sys || window.sys);
    return s ? s.m.faults : null;
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
    'filter-clog': _mkFault('filter-clog', '滑油滤器堵塞（30 s 后油压低于 1.5 bar）', '滑油系统', 'filterClog'),
    'lo-leak': _mkFault('lo-leak', '滑油管路泄漏（60 s 后油压低于 1.5 bar）', '滑油系统', 'loLeak'),
    'ht-valve-stuck': _mkFault('ht-valve-stuck', '高温淡水调温三通阀卡涩（约 30 s 后出口水温高）', '高温淡水系统', 'htValveStuck'),
    'cooler-foul': _mkFault('cooler-foul', '中央冷却器结垢严重（约 60 s 后出口水温高）', '冷却系统', 'coolerFoul'),
    'gov-stuck': _mkFault('gov-stuck', '调速器执行机构卡涩（约 10 s 后超速）', '调速系统', 'govStuck'),
};

// ═══════════════════════════════════════════════════════════════
// 工作流辅助
// ═══════════════════════════════════════════════════════════════

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

/** 点击部件直到条件满足（最多 max 次） */
async function _ensurePart(sys, part, cond, max = 3, gap = 420) {
    const comp = _mimic(sys);
    for (let i = 0; i < max && !cond(_m(sys)); i++) {
        _firePartClick(comp, part);
        await _sleep(gap);
    }
    return cond(_m(sys));
}

/** 连点某部件直到条件满足（用于 +/− 调节） */
async function _clickUntil(sys, part, cond, max = 40, gap = 110) {
    const comp = _mimic(sys);
    for (let i = 0; i < max && !cond(_m(sys)); i++) {
        _firePartClick(comp, part);
        await _sleep(gap);
    }
    return cond(_m(sys));
}

/** 控制方式旋钮打到指定档（BLOCK → LOCAL → REMOTE） */
async function _setMode(sys, mode) {
    const comp = _mimic(sys);
    const order = ['BLOCK', 'LOCAL', 'REMOTE'];
    for (let i = 0; i < 5; i++) {
        const cur = _m(sys).mode;
        if (cur === mode) return true;
        const right = order.indexOf(mode) > order.indexOf(cur);
        _firePartClick(comp, right ? 'mode-knob' : 'mode-knob-ccw');
        await _sleep(360);
    }
    return _m(sys).mode === mode;
}

/** 起动主机（点 ENG. START） */
async function _startEngine(sys) {
    const comp = _mimic(sys);
    if (_m(sys).engine.running) return true;
    _firePartClick(comp, 'eng-start');
    await _sleep(400);
    return _waitFor(sys, x => _m(x).engine.running, 15000, 250);
}

/** 保护复位（点面板 RESET） */
async function _resetProtection(sys) {
    const comp = _mimic(sys);
    for (let i = 0; i < 3 && _anyTrip(_m(sys)); i++) {
        _firePartClick(comp, 'reset');
        await _sleep(500);
    }
    return !_anyTrip(_m(sys));
}

function _anyTrip(m) {
    if (!m) return false;
    const t = m.trips;
    return !!(t.overspeed || t.loPress || t.htTemp || t.estop);
}

/** 试验工具接入 / 切除 */
async function _setTool(sys, key, on) {
    const t = _m(sys).test;
    const cur = key === 'pump' ? t.pumpOn : key === 'freq' ? t.freqOn : key === 'res' ? t.resOn : t.ovenOn;
    if (cur === !!on) return true;
    _firePartClick(_mimic(sys), 'tb-' + key + '-on');
    await _sleep(420);
    const now = _m(sys).test;
    return (key === 'pump' ? now.pumpOn : key === 'freq' ? now.freqOn : key === 'res' ? now.resOn : now.ovenOn) === !!on;
}

/** 手动泵压模块输出调到指定 bar（点 +/− 按钮，0.5 bar 一档） */
async function _setPumpPress(sys, bar) {
    const comp = _mimic(sys);
    for (let i = 0; i < 40 && Math.abs(_m(sys).test.pumpPress - bar) > 0.01; i++) {
        _firePartClick(comp, _m(sys).test.pumpPress < bar ? 'tb-pump-inc' : 'tb-pump-dec');
        await _sleep(130);
    }
    return Math.abs(_m(sys).test.pumpPress - bar) <= 0.01;
}

/** 干式温度校验炉炉温调到指定 ℃（点 +/− 按钮，5 ℃ 一档） */
async function _setOven(sys, temp) {
    const comp = _mimic(sys);
    for (let i = 0; i < 50 && Math.abs(_m(sys).test.oven - temp) > 0.01; i++) {
        _firePartClick(comp, _m(sys).test.oven < temp ? 'tb-oven-inc' : 'tb-oven-dec');
        await _sleep(120);
    }
    return Math.abs(_m(sys).test.oven - temp) <= 0.01;
}

/** 频率发生器输出调到指定 Hz（点 +/− 按钮，50 Hz 一档） */
async function _setFreq(sys, hz) {
    const comp = _mimic(sys);
    for (let i = 0; i < 24 && _m(sys).test.freq !== hz; i++) {
        _firePartClick(comp, _m(sys).test.freq < hz ? 'tb-freq-inc' : 'tb-freq-dec');
        await _sleep(170);
    }
    return _m(sys).test.freq === hz;
}

/** 恢复到"运行 + 保护已复位 + 工具已切除"的试验前状态 */
async function _readyToRun(sys) {
    const s = _solver(sys);
    if (!s) return false;
    s.clearTestTools();
    await _resetProtection(sys);
    const comp = _mimic(sys);
    if (!_m(sys).lo.pumpPrim) { _firePartClick(comp, 'lo-priming-pump'); await _sleep(350); }
    if (!_m(sys).lo.pumpAtt) { _firePartClick(comp, 'lo-att-pump'); await _sleep(350); }
    if (_m(sys).turningGear) { _firePartClick(comp, 'turning-gear'); await _sleep(350); }
    if (_m(sys).blockHandle) { _firePartClick(comp, 'block-handle'); await _sleep(350); }
    await _waitFor(sys, x => _m(x).lo.press > 1.2, 8000, 200);
    return _startEngine(sys);
}

/** 跳闸后收尾：切除工具 → 复位 → 重新起动 */
async function _restoreAfterTrip(sys, toolKey) {
    await _setTool(sys, toolKey, false);
    await _resetProtection(sys);
    return _startEngine(sys);
}

// ═══════════════════════════════════════════════════════════════
// 工作流
// ═══════════════════════════════════════════════════════════════

export const PROJECT_WORKFLOWS = {
    'gs-identify': {
        id: 'gs-identify', name: '1. 机组与安全保护系统的认识',
        steps: [
            { msg: '第 1 步：识别机组安全保护 MIMIC 图。', mode: 'find', target: 'mimic' },
            { msg: '第 2 步：识别机旁控制面板的「ENG. START」按钮。', mode: 'find', target: 'mimic', subTarget: 'eng-start' },
            { msg: '第 3 步：识别「OVER SPEED TRIP」超速跳闸灯。', mode: 'find', target: 'mimic', subTarget: 'led-overspeed' },
            { msg: '第 4 步：识别「READY TO START」准备起动灯。', mode: 'find', target: 'mimic', subTarget: 'led-ready' },
            { msg: '第 5 步：识别控制方式旋钮（BLOCK / LOCAL / REM）。', mode: 'find', target: 'mimic', subTarget: 'mode-knob' },
            { msg: '第 6 步：识别频率发生器（模拟转速信号）。', mode: 'find', target: 'mimic', subTarget: 'tool-freq' },
            { msg: '第 7 步：识别手动泵压模块（模拟滑油压力）。', mode: 'find', target: 'mimic', subTarget: 'tool-pump' },
            { msg: '第 8 步：识别电阻箱（代替 PT100）。', mode: 'find', target: 'mimic', subTarget: 'tool-res' },
            { msg: '第 9 步：识别干式温度校验炉。', mode: 'find', target: 'mimic', subTarget: 'tool-oven' },
            { msg: '第 10 步：识别超速保护环节。', mode: 'find', target: 'mimic', subTarget: 'prot-overspeed' },
            { msg: '第 11 步：识别滑油低压保护环节。', mode: 'find', target: 'mimic', subTarget: 'prot-lo-press' },
            { msg: '第 12 步：识别冷却水高温保护环节。', mode: 'find', target: 'mimic', subTarget: 'prot-ht-temp' },
            { msg: '第 13 步：识别停机继电器。', mode: 'find', target: 'mimic', subTarget: 'shutdown-relay' },
            { msg: '第 14 步：识别停机电磁阀。', mode: 'find', target: 'mimic', subTarget: 'stop-solenoid' },
            { msg: '第 15 步：识别燃油切断机构。', mode: 'find', target: 'mimic', subTarget: 'fuel-rack' },
            { msg: '第 16 步：识别柴油机与同步发电机。', mode: 'find', target: 'mimic', subTarget: 'engine' },
            { msg: '第 17 步：识别磁电式转速传感器。', mode: 'find', target: 'mimic', subTarget: 'speed-sensor' },
            { msg: '第 18 步：识别滑油压力传感器。', mode: 'find', target: 'mimic', subTarget: 'pt-lo' },
            { msg: '第 19 步：识别温度传感器。', mode: 'find', target: 'mimic', subTarget: 'tt-ht' },
            {
                msg: '第 20 步：测试题——三路保护信号与停机链。',
                mode: 'quiz',
                quizConfig: {
                    question: '副机安全保护模块的输入信号与停机执行顺序，正确的是？',
                    options: [
                        '转速传感器（超速 1725 r/min）、滑油压力传感器（低压 1.5 bar）、PT100（高温 95 ℃）→ 停机继电器 → 停机电磁阀 → 燃油切断 → 柴油机停车',
                        '滑油温度、排气温度、冷却水压力 → 停机电磁阀 → 停机继电器 → 断油',
                        '三路信号直接控制燃油齿条，不经过继电器与电磁阀',
                        '只有超速信号经保护模块，其余两路只报警不停机',
                    ],
                    answer: 0,
                    analysis: '三路信号（转速、滑油压力、冷却水温度）在保护模块内与定值比较，任一越限并经确认延时（超速无延时、滑油低压 4 s、冷却水高温 6 s）后，停机继电器得电 → 停机电磁阀动作 → 燃油切断机构把齿条拉到 0 位，柴油机停车。',
                },
            },
        ],
    },

    'gs-start': {
        id: 'gs-start', name: '2. 机旁手动起动与运行监视',
        steps: [
            {
                msg: '第 1 步：确认盘车机构脱开、闭锁手柄复位。',
                mode: 'check',
                op: [
                    {
                        type: 'switch', target: 'mimic', part: 'turning-gear', msg: '盘车机构置于 DISENG.（脱开）',
                        async act() { const s = _sysOf(this); await _ensurePart(s, 'turning-gear', m => !m.turningGear); },
                    },
                    {
                        type: 'switch', target: 'mimic', part: 'block-handle', msg: '闭锁手柄置于 WORK（复位）',
                        async act() { const s = _sysOf(this); await _ensurePart(s, 'block-handle', m => !m.blockHandle); },
                    },
                ],
                check() {
                    const m = _m(_sysOf(this));
                    return !!(m && !m.turningGear && !m.blockHandle);
                },
            },
            {
                msg: '第 2 步：控制方式旋钮打到 LOCAL（机旁）。',
                mode: 'check',
                op: [
                    {
                        type: 'knob', target: 'mimic', part: 'mode-knob', msg: '控制方式 → LOCAL 机旁',
                        async act() { const s = _sysOf(this); await _setMode(s, 'LOCAL'); },
                    },
                ],
                check() {
                    const m = _m(_sysOf(this));
                    return !!(m && m.mode === 'LOCAL');
                },
            },
            {
                msg: '第 3 步：起动滑油机带泵与预润滑泵，建立预润滑油压。',
                mode: 'check',
                op: [
                    {
                        type: 'switch', target: 'mimic', part: 'lo-att-pump', msg: '起动滑油机带泵',
                        async act() { const s = _sysOf(this); await _ensurePart(s, 'lo-att-pump', m => m.lo.pumpAtt); },
                    },
                    {
                        type: 'switch', target: 'mimic', part: 'lo-priming-pump', msg: '起动滑油预润滑泵',
                        async act() { const s = _sysOf(this); await _ensurePart(s, 'lo-priming-pump', m => m.lo.pumpPrim); },
                    },
                    {
                        type: 'observe', target: 'mimic', part: 'lo-priming-pump', msg: '观察滑油压力建立（> 1.0 bar）',
                        async act() { const s = _sysOf(this); await _waitFor(s, x => _m(x).lo.press > 1.2, 12000, 200); },
                    },
                ],
                check() {
                    const m = _m(_sysOf(this));
                    return !!(m && m.lo.pumpPrim && m.lo.press > 1.0);
                },
            },
            {
                msg: '第 4 步：按 ENG. START 起动，转速升至 1500 r/min。',
                mode: 'check',
                op: [
                    {
                        type: 'btn', target: 'mimic', part: 'eng-start', msg: '按「ENG. START」',
                        async act() { const s = _sysOf(this); await _startEngine(s); },
                    },
                    {
                        type: 'observe', target: 'mimic', part: 'engine', msg: '观察转速上升至额定值',
                        async act() { const s = _sysOf(this); await _waitFor(s, x => _m(x).engine.speed > 1450, 20000, 250); },
                    },
                ],
                check() {
                    const m = _m(_sysOf(this));
                    return !!(m && m.engine.running && m.engine.speed > 1450);
                },
            },
            {
                msg: '第 5 步：监视滑油压力、高温淡水温度与发电机电压。',
                mode: 'check',
                op: [
                    {
                        type: 'observe', target: 'mimic', part: 'lo-att-pump', msg: '滑油压力随机组建立',
                        async act() { const s = _sysOf(this); await _waitFor(s, x => _m(x).lo.press > 2.5, 15000, 250); },
                    },
                    {
                        type: 'observe', target: 'mimic', part: 'ht-cooler', msg: '高温淡水温度逐渐上升',
                        async act() { const s = _sysOf(this); await _waitFor(s, x => _m(x).ht.tempOut > 55, 40000, 300); },
                    },
                    {
                        type: 'observe', target: 'mimic', part: 'generator', msg: '发电机建压 400 V / 50 Hz',
                        async act() { const s = _sysOf(this); await _waitFor(s, x => _m(x).gen.volt > 380, 12000, 250); },
                    },
                    {
                        type: 'observe', target: 'mimic', part: 'led-running', msg: '「ENG. RUNNING」灯亮',
                        async act() { const s = _sysOf(this); await _waitFor(s, x => _m(x).engine.running, 5000, 200); },
                    },
                ],
                check() {
                    const m = _m(_sysOf(this));
                    return !!(m && m.engine.running && m.lo.press > 2.5 && m.ht.tempOut > 55 && m.gen.volt > 380);
                },
            },
            {
                msg: '第 6 步：按 ENG. STOP 正常停车。',
                mode: 'check',
                op: [
                    {
                        type: 'btn', target: 'mimic', part: 'eng-stop', msg: '按「ENG. STOP」',
                        async act() { const s = _sysOf(this); _firePartClick(_mimic(s), 'eng-stop'); await _sleep(500); },
                    },
                    {
                        type: 'observe', target: 'mimic', part: 'engine', msg: '观察转速下降到 0',
                        async act() { const s = _sysOf(this); await _waitFor(s, x => _m(x).engine.speed < 50, 20000, 250); },
                    },
                ],
                check() {
                    const m = _m(_sysOf(this));
                    return !!(m && !m.engine.running && m.engine.speed < 50);
                },
            },
         ],
    },

    'gs-overspeed': {
        id: 'gs-overspeed', name: '3. 超速保护的功能测试',
        steps: [
            {
                msg: '第 1 步：断开转速传感器接线，用频率发生器代替接入。',
                mode: 'check',
                op: [
                    {
                        type: 'observe', target: 'mimic', part: 'speed-sensor', msg: '断开磁电式转速传感器接线',
                        async act() { await _sleep(900); },
                    },
                    {
                        type: 'switch', target: 'mimic', part: 'tb-freq-on', msg: '频率发生器接入安全保护单元',
                        async act() { const s = _sysOf(this); await _setTool(s, 'freq', true); },
                    },
                    {
                        type: 'observe', target: 'mimic', part: 'tool-freq', msg: '观察「接入」灯亮，输出 1500 Hz',
                        async act() { await _sleep(900); },
                    },
                ],
                check() {
                    const m = _m(_sysOf(this));
                    return !!(m && m.test.freqOn);
                },
            },
            {
                msg: '第 2 步：起动预润滑泵，起动柴油发电机组。',
                mode: 'check',
                op: [
                    {
                        type: 'switch', target: 'mimic', part: 'lo-priming-pump', msg: '起动滑油预润滑泵',
                        async act() {
                            const s = _sysOf(this);
                            await _ensurePart(s, 'lo-priming-pump', m => m.lo.pumpPrim);
                            this._gs3 = this._gs3 || {}; this._gs3.prim = true;
                        },
                    },
                    {
                        type: 'observe', target: 'mimic', part: 'pt-lo', msg: '观察滑油压力建立（> 1.0 bar）',
                        async act() { const s = _sysOf(this); await _waitFor(s, x => _m(x).lo.press > 1.2, 12000, 200); },
                    },
                    {
                        type: 'btn', target: 'mimic', part: 'eng-start', msg: '按「ENG. START」起动机组',
                        async act() { const s = _sysOf(this); await _startEngine(s); },
                    },
                    {
                        type: 'observe', target: 'mimic', part: 'engine', msg: '观察转速升至 1500 r/min',
                        async act() { const s = _sysOf(this); await _waitFor(s, x => _m(x).engine.speed > 1450, 20000, 250); },
                    },
                ],
                check() {
                    const m = _m(_sysOf(this));
                    return !!(m && m.engine.running && m.engine.speed > 1450);
                },
            },
            {
                msg: '第 3 步：频率升至 1800 Hz，观察超速保护动作停机。',
                mode: 'check',
                op: [
                    {
                        type: 'switch', target: 'mimic', part: 'tb-freq-inc', msg: '频率发生器升至 1800 Hz（≈1800 r/min）',
                        async act() {
                            const s = _sysOf(this);
                            await _setFreq(s, 1800);
                            this._gs3 = this._gs3 || {}; this._gs3.freq1800 = _m(s).test.freq === 1800;
                        },
                    },
                    {
                        type: 'observe', target: 'mimic', part: 'prot-overspeed', msg: '观察转速信号 1800 r/min 超过定值 1725',
                        async act() { const s = _sysOf(this); await _waitFor(s, x => _m(x).speedSig > 1725, 6000, 200); },
                    },
                    {
                        type: 'observe', target: 'mimic', part: 'led-overspeed', msg: '「OVER SPEED TRIP」灯立即点亮',
                        async act() { const s = _sysOf(this); await _waitFor(s, x => _m(x).trips.overspeed, 12000, 200); },
                    },
                    {
                        type: 'observe', target: 'mimic', part: 'fuel-rack', msg: '停机链动作：燃油切断，机组停车',
                        async act() { const s = _sysOf(this); await _waitFor(s, x => _m(x).shutdown.fuelCut && !_m(x).engine.running, 15000, 250); },
                    },
                ],
                check() {
                    const m = _m(_sysOf(this));
                    return !!(m && m.trips.overspeed && m.shutdown.fuelCut && !m.engine.running && m.test.freq === 1800);
                },
            },
            {
                msg: '第 4 步：频率复位到 1500 Hz，改回转速传感器接入并复位。',
                mode: 'check',
                op: [
                    {
                        type: 'switch', target: 'mimic', part: 'tb-freq-dec', msg: '频率发生器降回 1500 Hz',
                        async act() { const s = _sysOf(this); await _setFreq(s, 1500); },
                    },
                    {
                        type: 'switch', target: 'mimic', part: 'tb-freq-on', msg: '切除频率发生器，恢复转速传感器接入',
                        async act() { const s = _sysOf(this); await _setTool(s, 'freq', false); },
                    },
                    {
                        type: 'btn', target: 'mimic', part: 'reset', msg: '按「RESET」复位跳闸锁存',
                        async act() { const s = _sysOf(this); await _resetProtection(s); },
                    },
                    {
                        type: 'observe', target: 'mimic', part: 'led-overspeed', msg: '观察超速跳闸灯熄灭',
                        async act() { const s = _sysOf(this); await _waitFor(s, x => !_m(x).trips.overspeed, 8000, 200); },
                    },
                ],
                check() {
                    const m = _m(_sysOf(this));
                    return !!(m && m.test.freq === 1500 && !m.test.freqOn && !_anyTrip(m));
                },
            },
            {
                msg: '第 5 步：测试题——超速保护功能测试的工作原理。',
                mode: 'quiz',
                quizConfig: {
                    question: '用频率发生器代替转速传感器做超速保护试验，其工作原理与操作要点是？',
                    options: [
                        '断开转速传感器接线，由频率发生器向保护单元送入模拟转速信号；把信号升到 1800 r/min（超过定值 1725 r/min），保护单元立即输出停机命令（超速无确认延时）；试验后信号降回 1500 r/min 并恢复传感器接线，再按 RESET 复位',
                        '频率发生器直接给柴油机调速器加油门，使真实转速升到 1800 r/min，靠机械超速装置停车',
                        '把频率发生器接到发电机电压回路，用电压升高模拟超速，动作后自动复位',
                        '只要把频率升到 1800 Hz，保护立即动作，动作后锁存自动消失',
                    ],
                    answer: 0,
                    analysis: '保护单元只认转速信号，不认真实转速。断开传感器、用频率发生器送入 1800 Hz（≈1800 r/min）的模拟信号，即可在机组不升速的情况下验证超速保护；信号超过定值 1725 r/min 后立即跳闸（超速保护无确认延时），停机继电器 → 停机电磁阀 → 燃油切断停车。试验结束必须把信号降回 1500 r/min、恢复传感器接线并 RESET 复位锁存，机组才能重新起动。',
                },
            },
        ],
    },

    'gs-lo-press': {
        id: 'gs-lo-press', name: '4. 滑油压力低保护的功能测试',
        steps: [
            {
                msg: '第 1 步：把手动泵的管路接入滑油压力传感器。',
                mode: 'check',
                op: [
                    {
                        type: 'observe', target: 'mimic', part: 'pt-lo', msg: '手动泵出口管路接到滑油压力传感器',
                        async act() { await _sleep(900); },
                    },
                    {
                        type: 'switch', target: 'mimic', part: 'tb-pump-on', msg: '泵压模块接入，向滑油压力传感器送压力',
                        async act() { const s = _sysOf(this); await _setTool(s, 'pump', true); },
                    },
                    {
                        type: 'observe', target: 'mimic', part: 'tool-pump', msg: '观察「接入」灯亮，输出 5.00 bar',
                        async act() { await _sleep(900); },
                    },
                ],
                check() {
                    const m = _m(_sysOf(this));
                    return !!(m && m.test.pumpOn && m.test.pumpPress > 4);
                },
            },
            {
                msg: '第 2 步：起动预润滑泵，起动柴油发电机组。',
                mode: 'check',
                op: [
                    {
                        type: 'switch', target: 'mimic', part: 'lo-priming-pump', msg: '起动滑油预润滑泵',
                        async act() {
                            const s = _sysOf(this);
                            await _ensurePart(s, 'lo-priming-pump', m => m.lo.pumpPrim);
                        },
                    },
                    {
                        type: 'observe', target: 'mimic', part: 'pt-lo', msg: '观察滑油压力建立（> 1.0 bar）',
                        async act() { const s = _sysOf(this); await _waitFor(s, x => _m(x).lo.press > 1.2, 12000, 200); },
                    },
                    {
                        type: 'btn', target: 'mimic', part: 'eng-start', msg: '按「ENG. START」起动机组',
                        async act() { const s = _sysOf(this); await _startEngine(s); },
                    },
                    {
                        type: 'observe', target: 'mimic', part: 'engine', msg: '观察转速升至 1500 r/min',
                        async act() { const s = _sysOf(this); await _waitFor(s, x => _m(x).engine.speed > 1450, 20000, 250); },
                    },
                ],
                check() {
                    const m = _m(_sysOf(this));
                    return !!(m && m.engine.running && m.engine.speed > 1450);
                },
            },
            {
                msg: '第 3 步：缓慢泄压到 1.5 bar 以下，观察 4 s 后低压保护停机。',
                mode: 'check',
                op: [
                    {
                        type: 'switch', target: 'mimic', part: 'tb-pump-dec', msg: '泵压模块泄压至 1.00 bar',
                        async act() { const s = _sysOf(this); await _setPumpPress(s, 1.0); },
                    },
                    {
                        type: 'observe', target: 'mimic', part: 'prot-lo-press', msg: '观察压力信号 1.00 bar 低于定值 1.5 bar',
                        async act() { const s = _sysOf(this); await _waitFor(s, x => _m(x).pressSig < 1.5, 6000, 200); },
                    },
                    {
                        type: 'observe', target: 'mimic', part: 'led-lo-lp-trip', msg: '约 4 s 后「LO. LP TRIP」灯亮',
                        async act() { const s = _sysOf(this); await _waitFor(s, x => _m(x).trips.loPress, 14000, 200); },
                    },
                    {
                        type: 'observe', target: 'mimic', part: 'fuel-rack', msg: '停机链动作：燃油切断，机组停车',
                        async act() { const s = _sysOf(this); await _waitFor(s, x => _m(x).shutdown.fuelCut && !_m(x).engine.running, 15000, 250); },
                    },
                ],
                check() {
                    const m = _m(_sysOf(this));
                    return !!(m && m.trips.loPress && m.shutdown.fuelCut && !m.engine.running && m.test.pumpPress < 1.5);
                },
            },
            {
                msg: '第 4 步：泵压恢复 5 bar，拆下手动泵管路并复位。',
                mode: 'check',
                op: [
                    {
                        type: 'switch', target: 'mimic', part: 'tb-pump-inc', msg: '泵压模块升回 5.00 bar',
                        async act() { const s = _sysOf(this); await _setPumpPress(s, 5.0); },
                    },
                    {
                        type: 'switch', target: 'mimic', part: 'tb-pump-on', msg: '拆下手动泵管路，恢复传感器原取压',
                        async act() { const s = _sysOf(this); await _setTool(s, 'pump', false); },
                    },
                    {
                        type: 'btn', target: 'mimic', part: 'reset', msg: '按「RESET」复位跳闸锁存',
                        async act() { const s = _sysOf(this); await _resetProtection(s); },
                    },
                    {
                        type: 'observe', target: 'mimic', part: 'led-lo-lp-trip', msg: '观察低压跳闸灯熄灭',
                        async act() { const s = _sysOf(this); await _waitFor(s, x => !_m(x).trips.loPress, 8000, 200); },
                    },
                ],
                check() {
                    const m = _m(_sysOf(this));
                    return !!(m && !m.test.pumpOn && !_anyTrip(m));
                },
            },
            {
                msg: '第 5 步：测试题——滑油低压保护功能测试的工作原理。',
                mode: 'quiz',
                quizConfig: {
                    question: '用手动泵压模块代替滑油压力传感器做低压保护试验，其原理与操作要点是？',
                    options: [
                        '把手动泵的管路接到滑油压力传感器，由泵压模块向保护单元送入模拟压力信号；机组运行中把信号由 5 bar 缓慢泄到 1.5 bar 以下并保持，保护单元经 4 s 确认后输出停机命令；试验后拆下手动泵管路、恢复传感器原取压并 RESET 复位',
                        '泵压模块直接给滑油泵加压，使真实油压降到 1.5 bar 以下，靠机械低压开关停车',
                        '只要泵压低于 1.5 bar 就立即跳闸，不需要确认延时，也不需要复位',
                        '把泵压模块接到发电机电压回路，用电压下降模拟油压降低，动作后自动复位',
                    ],
                    answer: 0,
                    analysis: '保护单元只认压力信号，不认真实油压。把手动泵管路接到滑油压力传感器、送入模拟压力，即可在机组不停机的情况下验证低压保护；信号低于定值 1.5 bar 并经 4 s 确认延时后，停机继电器 → 停机电磁阀 → 燃油切断停车。试验结束必须拆下手动泵管路、恢复传感器原取压并 RESET 复位锁存。',
                },
            },
        ],
    },

    'gs-ht-temp': {
        id: 'gs-ht-temp', name: '5. 冷却水温高保护的功能测试',
        steps: [
            {
                msg: '第 1 步：把 PT100 从冷却水管路中取出，放入干式温度校验炉。',
                mode: 'check',
                op: [
                    {
                        type: 'observe', target: 'mimic', part: 'tt-ht', msg: '从冷却水管路中取出 PT100',
                        async act() { await _sleep(900); },
                    },
                    {
                        type: 'switch', target: 'mimic', part: 'tb-oven-on', msg: 'PT100 放入校验炉炉膛，代替温度信号',
                        async act() { const s = _sysOf(this); await _setTool(s, 'oven', true); },
                    },
                    {
                        type: 'observe', target: 'mimic', part: 'tool-oven', msg: '观察「接入」灯亮，炉温 25 ℃',
                        async act() { await _sleep(900); },
                    },
                ],
                check() {
                    const m = _m(_sysOf(this));
                    return !!(m && m.test.ovenOn);
                },
            },
            {
                msg: '第 2 步：起动预润滑泵，起动柴油发电机组。',
                mode: 'check',
                op: [
                    {
                        type: 'switch', target: 'mimic', part: 'lo-priming-pump', msg: '起动滑油预润滑泵',
                        async act() {
                            const s = _sysOf(this);
                            await _ensurePart(s, 'lo-priming-pump', m => m.lo.pumpPrim);
                        },
                    },
                    {
                        type: 'observe', target: 'mimic', part: 'pt-lo', msg: '观察滑油压力建立（> 1.0 bar）',
                        async act() { const s = _sysOf(this); await _waitFor(s, x => _m(x).lo.press > 1.2, 12000, 200); },
                    },
                    {
                        type: 'btn', target: 'mimic', part: 'eng-start', msg: '按「ENG. START」起动机组',
                        async act() { const s = _sysOf(this); await _startEngine(s); },
                    },
                    {
                        type: 'observe', target: 'mimic', part: 'engine', msg: '观察转速升至 1500 r/min',
                        async act() { const s = _sysOf(this); await _waitFor(s, x => _m(x).engine.speed > 1450, 20000, 250); },
                    },
                ],
                check() {
                    const m = _m(_sysOf(this));
                    return !!(m && m.engine.running && m.engine.speed > 1450);
                },
            },
            {
                msg: '第 3 步：炉温升到 100 ℃，观察 6 s 后高温保护停机。',
                mode: 'check',
                op: [
                    {
                        type: 'switch', target: 'mimic', part: 'tb-oven-inc', msg: '校验炉升温至 100 ℃',
                        async act() { const s = _sysOf(this); await _setOven(s, 100); },
                    },
                    {
                        type: 'observe', target: 'mimic', part: 'prot-ht-temp', msg: '观察温度信号 100 ℃ 高于定值 95 ℃',
                        async act() { const s = _sysOf(this); await _waitFor(s, x => _m(x).htSig > 95, 6000, 200); },
                    },
                    {
                        type: 'observe', target: 'mimic', part: 'led-htfw-trip', msg: '约 6 s 后「HTFW WT TRIP」灯亮',
                        async act() { const s = _sysOf(this); await _waitFor(s, x => _m(x).trips.htTemp, 16000, 200); },
                    },
                    {
                        type: 'observe', target: 'mimic', part: 'fuel-rack', msg: '停机链动作：燃油切断，机组停车',
                        async act() { const s = _sysOf(this); await _waitFor(s, x => _m(x).shutdown.fuelCut && !_m(x).engine.running, 15000, 250); },
                    },
                ],
                check() {
                    const m = _m(_sysOf(this));
                    return !!(m && m.trips.htTemp && m.shutdown.fuelCut && !m.engine.running && m.test.oven >= 100);
                },
            },
            {
                msg: '第 4 步：炉温降回 45 ℃，把 PT100 装回管路并复位。',
                mode: 'check',
                op: [
                    {
                        type: 'switch', target: 'mimic', part: 'tb-oven-dec', msg: '校验炉降温至 45 ℃',
                        async act() { const s = _sysOf(this); await _setOven(s, 45); },
                    },
                    {
                        type: 'switch', target: 'mimic', part: 'tb-oven-on', msg: '把 PT100 装回冷却水管路',
                        async act() { const s = _sysOf(this); await _setTool(s, 'oven', false); },
                    },
                    {
                        type: 'btn', target: 'mimic', part: 'reset', msg: '按「RESET」复位跳闸锁存',
                        async act() { const s = _sysOf(this); await _resetProtection(s); },
                    },
                    {
                        type: 'observe', target: 'mimic', part: 'led-htfw-trip', msg: '观察高温跳闸灯熄灭',
                        async act() { const s = _sysOf(this); await _waitFor(s, x => !_m(x).trips.htTemp, 8000, 200); },
                    },
                ],
                check() {
                    const m = _m(_sysOf(this));
                    return !!(m && !m.test.ovenOn && !_anyTrip(m));
                },
            },
            {
                msg: '第 5 步：测试题——冷却水高温保护功能测试的工作原理。',
                mode: 'quiz',
                quizConfig: {
                    question: '把 PT100 放入干式温度校验炉（或改接电阻箱）做冷却水高温保护试验，正确的是？',
                    options: [
                        '把 PT100 从冷却水管路中取出、放入干式温度校验炉（或改接电阻箱），使保护单元收到模拟温度信号；机组运行中把信号升到 95 ℃ 以上并保持，保护单元经 6 s 确认后输出停机命令；试验后降温、把 PT100 装回管路并 RESET 复位',
                        '校验炉直接加热冷却水，使真实水温升到 95 ℃ 以上，靠温度开关停车',
                        '只要温度超过 95 ℃ 就立即跳闸，无确认延时，且动作后自动复位',
                        '把校验炉接到高温淡水泵电源上，用泵过载模拟水温高，动作后无需复位',
                    ],
                    answer: 0,
                    analysis: '保护单元只认 PT100 的电阻（温度）信号，不认真实水温。把 PT100 从管路中取出、放入校验炉送入模拟温度，即可在机组不升温的情况下验证高温保护；信号高于定值 95 ℃ 并经 6 s 确认延时后，停机继电器 → 停机电磁阀 → 燃油切断停车。试验结束必须降温、把 PT100 装回冷却水管路并 RESET 复位锁存。',
                },
            },
        ],
    },
};

export const PROJECT_PAGES = [
    { id: 0, name: '索引', type: 'index' },
    {
        id: 1, name: '副机起动和调速系统的功能测试', comps: ['startmimic'],
        desc: '机旁控制面板 + 发电机遥控操作 + 机组模型 / 起动联锁（8 输入与门）/ 起动时序与趋势 / 燃油与调速系统。'
            + '验证 8 个起动条件、起动执行链（电磁阀→主起动阀→空气分配器→各缸）、起动时序 9 个阶段与电子调速器。',
    },
    {
        id: 2, name: '副机安全保护系统的功能测试', comps: ['mimic'],
        desc: '机旁控制面板 + 安保测试工具箱 + 机组模型 / 安全保护模块（超速、滑油低压、冷却水高温）/ 滑油系统 / 高温淡水系统。'
            + '用频率发生器、手动泵压模块、电阻箱、校验炉验证三路保护定值与停机链。',
    },
];