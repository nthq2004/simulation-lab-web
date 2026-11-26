// ═══════════════════════════════════════════════════════════════
// 火灾报警系统的功能实验（单页工程）
//
//   火灾报警控制器 facp：两路 CAN 接口（can1/can2）挂 8 个可寻址探测器件；
//   回路 1（LOOP1）：感烟 smk1、感光 flm1 → ZONE1（发电机）；感烟 smk2、手报 mcp1 → ZONE2（主机）；
//   回路 2（LOOP2）：感烟 smk3、感温 htd1 → ZONE3（锅炉）；感烟 smk4、手报 mcp2 → ZONE4（分油机）；
//   每路经 4 个总线连接器 BusConnector 链式互联，末端接 CAN 总线分析仪；
//   声光报警器 sounder 由控制器驱动；另有主/备两路 220V 电源、地址写入器与备用感烟探测器、
//   测试工具（打火机 / 电吹风 / 烟雾发生器）。
// ═══════════════════════════════════════════════════════════════

import { FireAlarmController } from '../components/FireAlarmController.js';
import { SmokeDetector } from '../components/SmokeDetector.js';
import { FlameDetector } from '../components/FlameDetector.js';
import { HeatDetector } from '../components/HeatDetector.js';
import { ManualCallPoint } from '../components/ManualCallPoint.js';
import { Lighter } from '../components/Lighter.js';
import { HairDryer } from '../components/HairDryer.js';
import { SmokeGenerator } from '../components/SmokeGenerator.js';
import { AddressWriter } from '../components/AddressWriter.js';
import { CanAnalyzer } from '../components/CanAnalyzer.js';
import { AudioVisualAlarm } from '../components/AudioVisualAlarm.js';
import { BusConnector } from '../components/BusConnector.js';
import { ACPower } from '../components/ACPower.js';

import { Multimeter } from '../components/Multimeter.js';
import { MF47Multimeter } from '../components/MF47Multimeter.js';
import { Oscilloscope_tri } from '../components/Osc_tri.js';
import { SignalGenerator } from '../components/SignalGenerator.js';
import { ProcessCalibrator } from '../components/ProcessCalibrator.js';
import { ElecMeter } from '../components/ElecMeter.js';
import { RealMegohmMeter } from '../components/RealMegohmMeter.js';

// ═══════════════════════════════════════════════════════════════
// 通用辅助
// ═══════════════════════════════════════════════════════════════

const _sysOf = (ctx) => (ctx && ctx.sys) ? ctx.sys : window.sys;
const _sleep = (ms) => new Promise(r => setTimeout(r, ms));
const _comp = (sys, id) => (sys && sys.comps) ? sys.comps[id] : null;

function _hasConn(sys, a, b) {
    return !!(sys && sys.conns) && sys.conns.some(c =>
        (c.from === a && c.to === b) || (c.from === b && c.to === a));
}

function _firePartClick(comp, partId) {
    if (!comp) return false;
    try {
        const node = comp.getClickablePartNode && comp.getClickablePartNode(partId);
        if (node && typeof node.fire === 'function') { node.fire('click'); return true; }
    } catch (e) { /* ignore */ }
    return false;
}

async function _pressKey(sys, compId, partId, times = 1) {
    const c = _comp(sys, compId);
    for (let i = 0; i < times; i++) { _firePartClick(c, partId); await _sleep(200); }
}

/** 设置探测器火警条件（点击测试部件触发/清除；仅在状态不符时点击） */
async function _setDetectorFire(sys, id, on) {
    const d = _comp(sys, id);
    if (!d) return;
    if (!!d.alarming !== !!on) { _firePartClick(d, 'test'); }
    await _sleep(400);
}

async function _wireOne(sys, conn) {
    if (!sys || !sys.connMgr || !conn) return;
    if (_hasConn(sys, conn.from, conn.to)) return;
    await sys.connMgr.addConnectionAnimated({ from: conn.from, to: conn.to, type: conn.type || 'wire' });
}

async function _waitFor(sys, cond, timeoutMs = 20000, intervalMs = 250) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
        try { if (cond(sys)) return true; } catch (e) { /* ignore */ }
        await _sleep(intervalMs);
    }
    try { return !!cond(sys); } catch (e) { return false; }
}

/**
 * 模拟点击交流电源（ACPower）的电源按钮：该按钮监听 mousedown，
 * 因此以真实按下事件切换，而不是直接改 isOn（保留组件自身的显示刷新逻辑）。
 * @param {string} id  电源组件 id（ac-main / ac-bk）
 * @param {boolean} [on] 目标状态；给出时仅在状态不符时点击
 */
function _toggleAc(sys, id, on) {
    const ac = _comp(sys, id);
    if (!ac || !ac.powerBtnGroup) return;
    if (on !== undefined && !!ac.isOn === !!on) return;
    try { ac.powerBtnGroup.fire('mousedown'); } catch (e) { /* ignore */ }
    sys && sys.redrawAll && sys.redrawAll();
}

/** 断开一根连线（模拟接线脱落 / 探测器被拔掉） */
function _cutWire(sys, from, to, type = 'wire') {
    if (!sys || !sys.connMgr) return;
    sys.removeConn({ from, to, type });
    sys.redrawAll && sys.redrawAll();
}

/** 某探测器当前是否已报火警（便于 check 复用） */
function _detAlarming(sys, id) {
    const d = _comp(sys, id);
    return !!(d && d.alarming);
}

/** 控制器当前是否已上报指定文本的故障 */
function _hasFault(sys, text) {
    const c = _comp(sys, 'facp');
    return !!(c && c.faultAlarms && c.faultAlarms.some(f => f.text === text));
}

/**
 * 把测试工具（烟雾发生器/电吹风/打火机）移动到目标探测器旁并对准：
 * 沿工具发射方向的反方向留出约 58px，使工具"作用点"正对探测器。
 * 逐帧移动以模拟拖动过程（组件移动无点击语义，用动画位移代替拖拽）。
 */
async function _placeTool(sys, toolId, targetId) {
    const tool = _comp(sys, toolId), tgt = _comp(sys, targetId);
    if (!tool || !tgt) return;
    const tp = (tgt.getClickablePartCenter && tgt.getClickablePartCenter('body')) || null;
    if (!tp) return;
    // 记录原位（首次移动前），供测试结束后归位
    if (!tool._homePos) tool._homePos = { x: tool.group.x(), y: tool.group.y() };
    const emit = tool._emitSpec ? tool._emitSpec() : { dx: 0, dy: -1 };
    const gap = 58;
    const dx = emit.dx === 0 ? 0 : -emit.dx * gap;
    const dy = emit.dy === 0 ? 0 : -emit.dy * gap;
    const want = { x: tp.x + dx, y: tp.y + dy };                 // 作用点期望的绝对位置
    const cur = tool._probeWorld ? tool._probeWorld() : { x: tool.group.x(), y: tool.group.y() };
    const tx = tool.group.x() + (want.x - cur.x);
    const ty = tool.group.y() + (want.y - cur.y);
    const x0 = tool.group.x(), y0 = tool.group.y();
    const steps = 22;
    for (let i = 1; i <= steps; i++) {
        const k = i / steps;
        tool.group.position({ x: x0 + (tx - x0) * k, y: y0 + (ty - y0) * k });
        sys.redrawAll && sys.redrawAll();
        await _sleep(30);
    }
}

/** 开启测试工具（模拟点击整机开关；已在工作中则不重复点击） */
function _toolOn(sys, toolId) {
    const t = _comp(sys, toolId);
    if (t && !t.active) _firePartClick(t, 'power');
}

/** 关闭测试工具（模拟点击整机开关；未工作则不动） */
function _toolOff(sys, toolId) {
    const t = _comp(sys, toolId);
    if (t && t.active) _firePartClick(t, 'power');
}

/** 把测试工具移回原位（逐帧动画，模拟拖回；原位在 _resetRig/_placeTool 中记录） */
async function _toolHome(sys, toolId) {
    const t = _comp(sys, toolId);
    if (!t || !t._homePos) return;
    const x0 = t.group.x(), y0 = t.group.y();
    const tx = t._homePos.x, ty = t._homePos.y;
    if (Math.abs(tx - x0) < 1 && Math.abs(ty - y0) < 1) return;
    const steps = 22;
    for (let i = 1; i <= steps; i++) {
        const k = i / steps;
        t.group.position({ x: x0 + (tx - x0) * k, y: y0 + (ty - y0) * k });
        sys.redrawAll && sys.redrawAll();
        await _sleep(30);
    }
}

/** 测试工具是否已回到原位（未记录原位时视为已归位） */
function _toolAtHome(sys, toolId) {
    const t = _comp(sys, toolId);
    if (!t || !t._homePos) return true;
    return Math.abs(t.group.x() - t._homePos.x) < 12 && Math.abs(t.group.y() - t._homePos.y) < 12;
}

/** 等探测器报警并在控制器上形成火警（供 check/演示共用） */
async function _waitDetFire(sys, detId, timeoutMs = 15000) {
    return await _waitFor(sys, x => {
        const d = _comp(x, detId);
        const c = _comp(x, 'facp');
        return !!(d && d.alarming && c && c.activeAlarms.length > 0);
    }, timeoutMs, 200);
}

/** 等探测器恢复正常（取消激励后约需 1 个上报周期） */
async function _waitDetNormal(sys, detId, timeoutMs = 10000) {
    return await _waitFor(sys, x => !_detAlarming(x, detId), timeoutMs, 200);
}

// ═══════════════════════════════════════════════════════════════
// 连线定义
// ═══════════════════════════════════════════════════════════════

// 探测器回路拓扑
const DETECTORS = [
    { id: 'smk1', conn: 'b-l1-1' }, { id: 'flm1', conn: 'b-l1-2' },
    { id: 'smk2', conn: 'b-l1-3' }, { id: 'mcp1', conn: 'b-l1-4' },
    { id: 'smk3', conn: 'b-l2-1' }, { id: 'htd1', conn: 'b-l2-2' },
    { id: 'smk4', conn: 'b-l2-3' }, { id: 'mcp2', conn: 'b-l2-4' },
];
const L1_CONNS = ['b-l1-1', 'b-l1-2', 'b-l1-3', 'b-l1-4'];
const L2_CONNS = ['b-l2-1', 'b-l2-2', 'b-l2-3', 'b-l2-4'];

// 探测器清单（供控制器隔离菜单在未上报前也显示；type: 1烟 2光 3温 4手报）
const DETECTOR_INFO = [
    { addr: 1, loop: 1, zone: 1, type: 1, label: '感烟探测器' },
    { addr: 2, loop: 1, zone: 1, type: 2, label: '感光探测器' },
    { addr: 3, loop: 1, zone: 2, type: 1, label: '感烟探测器' },
    { addr: 4, loop: 1, zone: 2, type: 4, label: '手动报警按钮' },
    { addr: 5, loop: 2, zone: 3, type: 1, label: '感烟探测器' },
    { addr: 6, loop: 2, zone: 3, type: 3, label: '感温探测器' },
    { addr: 7, loop: 2, zone: 4, type: 1, label: '感烟探测器' },
    { addr: 8, loop: 2, zone: 4, type: 4, label: '手动报警按钮' },
];

function _buildWires() {
    const w = [];
    const add = (from, to, msg) => w.push({ from, to, msg });

    // ── 220V 主电 / 备电 → 控制器 ──
    add('ac-main_wire_p', 'facp_wire_mainL', '电源①：主电 220V L → 控制器主电输入 L');
    add('ac-main_wire_n', 'facp_wire_mainN', '电源②：主电 220V N → 控制器主电输入 N');
    add('ac-bk_wire_p', 'facp_wire_bkL', '电源③：备电 220V L → 控制器备电输入 L');
    add('ac-bk_wire_n', 'facp_wire_bkN', '电源④：备电 220V N → 控制器备电输入 N');

    // ── CAN 回路1（右中）→ 回路首连接器 ──
    add('facp_wire_can1p', 'b-l1-1_wire_canhL', 'CAN①：控制器 CAN1(H) → 回路1 首连接器');
    add('facp_wire_can1n', 'b-l1-1_wire_canlL', 'CAN②：控制器 CAN1(L) → 回路1 首连接器');
    // ── CAN 回路2（下中）→ 回路首连接器 ──
    add('facp_wire_can2p', 'b-l2-1_wire_canhL', 'CAN③：控制器 CAN2(H) → 回路2 首连接器');
    add('facp_wire_can2n', 'b-l2-1_wire_canlL', 'CAN④：控制器 CAN2(L) → 回路2 首连接器');
    // 回路连接器链式互联
    [L1_CONNS, L2_CONNS].forEach((arr, li) => {
        for (let i = 0; i < arr.length - 1; i++) {
            add(`${arr[i]}_wire_canhR`, `${arr[i + 1]}_wire_canhL`, `回路${li + 1}：连接器 H 互联`);
            add(`${arr[i]}_wire_canlR`, `${arr[i + 1]}_wire_canlL`, `回路${li + 1}：连接器 L 互联`);
        }
    });
    // 探测器 → 总线连接器
    DETECTORS.forEach(d => {
        add(`${d.id}_wire_can1p`, `${d.conn}_wire_canh`, `总线：${d.id} CANH → 连接器`);
        add(`${d.id}_wire_can1n`, `${d.conn}_wire_canl`, `总线：${d.id} CANL → 连接器`);
    });
    // 探测器由总线供电，无需单独电源接线
    // ── 报警输出（下右）→ 声光报警器（直接驱动） ──
    add('facp_wire_alarm_o', 'sounder_wire_l', '报警输出 OP：控制器报警输出 → 声光报警器 L');
    add('facp_wire_alarm_r', 'sounder_wire_r', '报警输出 OP：控制器报警输出 → 声光报警器 R');
    // ── 回路1 末端 → CAN 总线分析仪（旁路抓包） ──
    add('b-l1-4_wire_canhR', 'canalyzer_wire_can1p', '分析仪：回路1末端连接器 H → CAN 分析仪');
    add('b-l1-4_wire_canlR', 'canalyzer_wire_can1n', '分析仪：回路1末端连接器 L → CAN 分析仪');

    return w;
}

const WIRE_META = _buildWires();
const ALL_META = WIRE_META.map(m => ({
    conn: { from: m.from, to: m.to, type: 'wire' },
    target: m.from.split('_')[0], ports: [m.from, m.to], msg: m.msg,
}));

function _wireOps(meta) {
    return meta.map(m => ({
        type: 'observe', target: m.target, msg: m.msg, ports: m.ports,
        async act() { await _wireOne(this.sys, m.conn); },
    }));
}

// ═══════════════════════════════════════════════════════════════
// 系统初始化 / 起动
// ═══════════════════════════════════════════════════════════════

async function _resetRig(sys) {
    if (!sys) return;
    if (Array.isArray(sys.conns)) { sys.conns.length = 0; sys.redrawAll && sys.redrawAll(); }
    Object.values(sys.FAULT_CONFIG || {}).forEach(f => { try { f.repair && f.repair(); } catch (e) { /* ignore */ } });

    const facp = _comp(sys, 'facp');
    if (facp) { facp.activeAlarms = []; facp.faultAlarms = []; facp._mainPowerFail = false; facp.muted = false; facp.zoneAlarm = { 1: false, 2: false, 3: false, 4: false }; facp.isolated = { nodes: new Set(), zones: new Set(), extDevice: false }; facp.nodes = {}; facp.mode = 'normal';
        facp.powerSwitch = false; facp._powered = false; facp._running = false; facp._selfTest = false; facp._selfTestT = 0; facp._alarmOut = false; facp.displayTest = false;
        facp._nodesSeeded = false; facp._runStart = 0; facp._lcdPage = 0; }
    DETECTORS.forEach(d => { const c = _comp(sys, d.id); if (c) { c.alarming = false; c.isolated = false; c.fault = false; c.commFault = false; } });
    const sounder = _comp(sys, 'sounder'); if (sounder) { try { sounder.setExternalAlarm && sounder.setExternalAlarm(false); sounder._extCmd = undefined; } catch (e) { /* ignore */ } }

    // 复位测试工具（避免上一次演示残留"工具工作中"）
    ['lighter', 'hairdryer', 'smokegen'].forEach(id => {
        const t = _comp(sys, id);
        if (!t) return;
        if (typeof t.setActive === 'function') t.setActive(false);
        // 记录原位（起动系统时），供功能测试结束后把工具移回原处
        if (!t._homePos) t._homePos = { x: t.group.x(), y: t.group.y() };
    });

    sys.redrawAll && sys.redrawAll();
    await _sleep(200);
}

function _autoWire(sys) {
    if (!sys || !sys.connMgr) return;
    sys.conns.length = 0;
    ALL_META.forEach(m => {
        try { sys.connMgr.addConn({ from: m.conn.from, to: m.conn.to, type: m.conn.type }); } catch (e) { /* ignore */ }
    });
    sys.redrawAll && sys.redrawAll();
    sys.pageMgr && sys.pageMgr.refresh && sys.pageMgr.refresh();
}

async function _startSystem(sys) {
    if (!sys) return;
    _autoWire(sys);
    const facp = _comp(sys, 'facp');
    if (facp) {
        facp._mainPowerFail = false;
        // 接通内部电源开关（模拟点击）→ 触发自检
        if (!facp.powerSwitch) _firePartClick(facp, 'power-switch');
        // 等待自检完成（约 3s）
        await _waitFor(sys, x => { const c = _comp(x, 'facp'); return c && c._running; }, 9000, 200);
        facp.startNodes(); await _sleep(500); facp.startNodes();
    }
    sys.redrawAll && sys.redrawAll();
    await _sleep(600);
}

// ═══════════════════════════════════════════════════════════════
// 故障配置（走故障界面）
// ═══════════════════════════════════════════════════════════════

export const FAULT_CONFIGS = {
    'fire-loop-comm': {
        id: 'fire-loop-comm', name: '1. 探测器通信故障', system: '通信',
        check() { const s = window.sys; const d = s && s.comps && s.comps['smk1']; return !!(d && d.commFault === true); },
        trigger() { const s = window.sys; const d = s && s.comps && s.comps['smk1']; if (d) { d.commFault = true; s.redrawAll && s.redrawAll(); } },
        repair() { const s = window.sys; const d = s && s.comps && s.comps['smk1']; if (d) { d.commFault = false; s.redrawAll && s.redrawAll(); } },
    },
    'fire-main-power': {
        id: 'fire-main-power', name: '2. FAS 主电源故障', system: '电源',
        check() { const s = window.sys; const c = s && s.comps && s.comps['facp']; return !!(c && c._mainPowerFail === true); },
        trigger() { const s = window.sys; const c = s && s.comps && s.comps['facp']; if (c) { c._mainPowerFail = true; c._addFault && c._addFault('FAS Main Power Failure', { kind: 'power' }); s.redrawAll && s.redrawAll(); } },
        repair() { const s = window.sys; const c = s && s.comps && s.comps['facp']; if (c) { c._mainPowerFail = false; c._clearFault && c._clearFault('FAS Main Power Failure'); s.redrawAll && s.redrawAll(); } },
    },
};

// ═══════════════════════════════════════════════════════════════
// 工作流
// ═══════════════════════════════════════════════════════════════

function _quizStep(msg, question, options, answer, analysis) {
    return { msg, mode: 'quiz', quizConfig: { question, options, answer, analysis } };
}

export const PROJECT_WORKFLOWS = {

    // ══════════════════════════════════════════════════════
    // 流程一：火警系统的认识
    // ══════════════════════════════════════════════════════
    'wf-fire-1': {
        id: 'wf-fire-1',
        name: '1. 火警系统的认识',
        steps: [
            {
                msg: '第 1 步：识别火灾报警控制器（FAS）。',
                mode: 'find', target: ['facp'], demoTarget: ['facp'],
            },
            {
                msg: '第 2 步：识别控制器「MUTE」消音键。',
                mode: 'find', target: ['facp'], subTarget: 'btn-mute', demoTarget: ['facp'],
            },
            {
                msg: '第 3 步：识别控制器「RESET」复位键。',
                mode: 'find', target: ['facp'], subTarget: 'btn-reset', demoTarget: ['facp'],
            },
            {
                msg: '第 4 步：识别控制器「DISABLEMENT」隔离键。',
                mode: 'find', target: ['facp'], subTarget: 'btn-disable', demoTarget: ['facp'],
            },
            {
                msg: '第 5 步：识别 1# 感烟探测器（LOOP1 #1）。',
                mode: 'find', target: ['smk1'], demoTarget: ['smk1'],
            },
            {
                msg: '第 6 步：识别 6# 感温探测器（LOOP2 #6）。',
                mode: 'find', target: ['htd1'], demoTarget: ['htd1'],
            },
            {
                msg: '第 7 步：识别 2# 感光探测器（LOOP1 #2）。',
                mode: 'find', target: ['flm1'], demoTarget: ['flm1'],
            },
            {
                msg: '第 8 步：识别 4# 手动报警按钮（LOOP1 #4）。',
                mode: 'find', target: ['mcp1'], demoTarget: ['mcp1'],
            },
        ],
    },

    // ══════════════════════════════════════════════════════
    // 流程二：火灾报警系统的自检和故障测试
    // ══════════════════════════════════════════════════════
    'wf-fire-2': {
        id: 'wf-fire-2',
        name: '2. 火灾报警系统的自检和故障测试',
        steps: [
            {
                msg: '第 1 步：按工具栏「起动系统」，自检结束后转入正常运行。',
                mode: 'check',
                op: [{
                    type: 'wire', button: 'btnStartSys', target: 'facp',
                    msg: '点击「起动系统」，观察状态灯与功能键自检',
                    async act() { const s = _sysOf(this); await _resetRig(s); await _startSystem(s); },
                }],
                check() {
                    const s = window.sys; const c = s && s.comps && s.comps['facp'];
                    return !!(c && c._running && !c._selfTest);
                },
            },
            {
                msg: '第 2 步：关断主电，报主电故障后按「MUTE」消音。',
                mode: 'check',
                op: [
                    {
                        type: 'switch', target: 'ac-main', part: 'power',
                        msg: '断开「主电」电源开关',
                        async act() { const s = _sysOf(this); _toggleAc(s, 'ac-main', false); await _sleep(600); },
                    },
                    {
                        type: 'observe', target: 'facp', part: 'btn-fault',
                        msg: '观察 LCD 显示主电故障、System fault 灯亮',
                        async act() { const s = _sysOf(this); await _waitFor(s, x => _hasFault(x, 'FAS Main Power Failure'), 10000, 200); await _sleep(1500); },
                    },
                    {
                        type: 'btn', target: 'facp', part: 'btn-mute',
                        msg: '按「MUTE」消音',
                        async act() { const s = _sysOf(this); await _pressKey(s, 'facp', 'btn-mute'); },
                    },
                ],
                check() {
                    const s = window.sys;
                    const ac = s && s.comps && s.comps['ac-main'], c = s && s.comps && s.comps['facp'];
                    return !!(ac && ac.isOn === false && c && c.muted === true && _hasFault(s, 'FAS Main Power Failure'));
                },
            },
            {
                msg: '第 3 步：合上主电，按「RESET」清除故障指示。',
                mode: 'check',
                op: [
                    {
                        type: 'switch', target: 'ac-main', part: 'power',
                        msg: '合上「主电」电源开关',
                        async act() { const s = _sysOf(this); _toggleAc(s, 'ac-main', true); await _sleep(1200); },
                    },
                    {
                        type: 'btn', target: 'facp', part: 'btn-reset',
                        msg: '按「RESET」清除主电故障',
                        async act() { const s = _sysOf(this); await _pressKey(s, 'facp', 'btn-reset'); },
                    },
                ],
                check() {
                    const s = window.sys;
                    const ac = s && s.comps && s.comps['ac-main'], c = s && s.comps && s.comps['facp'];
                    return !!(ac && ac.isOn === true && c && c.faultAlarms.length === 0);
                },
            },
            {
                msg: '第 4 步：拔掉 1# 探测器总线，报通信故障后按「MUTE」消音。',
                mode: 'check',
                op: [
                    {
                        type: 'observe', target: 'smk1', ports: ['smk1_wire_can1p', 'b-l1-1_wire_canh'],
                        msg: '断开 1# 探测器 CANH 总线连线',
                        async act() { const s = _sysOf(this); _cutWire(s, 'smk1_wire_can1p', 'b-l1-1_wire_canh'); },
                    },
                    {
                        type: 'observe', target: 'facp', part: 'btn-fault',
                        msg: '观察 LCD 显示「LOOP1 #1 Comm Fault」',
                        async act() { const s = _sysOf(this); await _waitFor(s, x => _hasFault(x, 'LOOP1 #1 Comm Fault'), 12000, 250); await _sleep(1500); },
                    },
                    {
                        type: 'btn', target: 'facp', part: 'btn-mute',
                        msg: '按「MUTE」消音',
                        async act() { const s = _sysOf(this); await _pressKey(s, 'facp', 'btn-mute'); },
                    },
                ],
                check() {
                    const s = window.sys;
                    const c = s && s.comps && s.comps['facp'];
                    const cut = s && !_hasConn(s, 'smk1_wire_can1p', 'b-l1-1_wire_canh');
                    return !!(cut && c && c.muted === true && _hasFault(s, 'LOOP1 #1 Comm Fault'));
                },
            },
            {
                msg: '第 5 步：接回 1# 探测器总线，按「RESET」复位。',
                mode: 'check',
                op: [
                    {
                        type: 'observe', target: 'smk1', ports: ['smk1_wire_can1p', 'b-l1-1_wire_canh'],
                        msg: '接回 1# 探测器 CANH 总线连线',
                        async act() { const s = _sysOf(this); await _wireOne(s, { from: 'smk1_wire_can1p', to: 'b-l1-1_wire_canh', type: 'wire' }); },
                    },
                    {
                        type: 'btn', target: 'facp', part: 'btn-reset',
                        msg: '待 1# 探测器重新上线后按「RESET」',
                        async act() {
                            const s = _sysOf(this);
                            await _waitFor(s, x => !_hasFault(x, 'LOOP1 #1 Comm Fault'), 12000, 250);
                            await _sleep(600);
                            await _pressKey(s, 'facp', 'btn-reset');
                        },
                    },
                ],
                check() {
                    const s = window.sys;
                    const c = s && s.comps && s.comps['facp'];
                    const ok = s && _hasConn(s, 'smk1_wire_can1p', 'b-l1-1_wire_canh');
                    return !!(ok && c && c.faultAlarms.length === 0);
                },
            },
        ],
    },

    // ══════════════════════════════════════════════════════
    // 流程三：火灾探测器的功能测试
    // ══════════════════════════════════════════════════════
    'wf-fire-3': {
        id: 'wf-fire-3',
        name: '3. 火灾探测器的功能测试',
        steps: [
            {
                msg: '第 1 步：按「起动系统」，8 个探测器上线。',
                mode: 'check',
                op: [{
                    type: 'wire', button: 'btnStartSys', target: 'facp',
                    msg: '点击「起动系统」，等待探测器上线',
                    async act() { const s = _sysOf(this); await _resetRig(s); await _startSystem(s); },
                }],
                check() {
                    const s = window.sys; const c = s && s.comps && s.comps['facp'];
                    return !!(c && c._running && !c._selfTest);
                },
            },
            {
                msg: '第 2 步：烟雾发生器对准 1# 感烟并开启，观察报火警。',
                mode: 'check',
                op: [
                    {
                        type: 'switch', target: 'smokegen', part: 'power',
                        msg: '烟雾发生器移到 1# 感烟旁',
                        async act() {
                            const s = _sysOf(this);
                            await _placeTool(s, 'smokegen', 'smk1');
                            await _sleep(300);
                            _toolOn(s, 'smokegen');
                        },
                    },
                    {
                        type: 'observe', target: 'smk1', part: 'test',
                        msg: '观察 1# 感烟报警灯亮、LCD 显示火警、声光报警器响',
                        async act() { const s = _sysOf(this); await _waitDetFire(s, 'smk1', 15000); await _sleep(1500); },
                    },
                    {
                        type: 'btn', target: 'facp', part: 'btn-mute',
                        msg: '按「MUTE」消音',
                        async act() { const s = _sysOf(this); await _pressKey(s, 'facp', 'btn-mute'); },
                    },
                ],
                check() {
                    const s = window.sys;
                    const t = s && s.comps && s.comps['smokegen'], c = s && s.comps && s.comps['facp'];
                    return !!(t && t.active && _detAlarming(s, 'smk1') && c && c.activeAlarms.length > 0);
                },
            },
            {
                msg: '第 3 步：关烟雾发生器，按「RESET」复位。',
                mode: 'check',
                op: [
                    {
                        type: 'switch', target: 'smokegen', part: 'power',
                        msg: '关闭烟雾发生器开关',
                        async act() { const s = _sysOf(this); _toolOff(s, 'smokegen'); await _waitDetNormal(s, 'smk1', 8000); },
                    },
                    {
                        type: 'switch', target: 'smokegen', part: 'body',
                        msg: '烟雾发生器移回原位',
                        async act() { const s = _sysOf(this); await _toolHome(s, 'smokegen'); },
                    },
                    {
                        type: 'btn', target: 'facp', part: 'btn-reset',
                        msg: '按「RESET」复位火警指示',
                        async act() { const s = _sysOf(this); await _sleep(1200); await _pressKey(s, 'facp', 'btn-reset'); },
                    },
                ],
                check() {
                    const s = window.sys;
                    const t = s && s.comps && s.comps['smokegen'], c = s && s.comps && s.comps['facp'];
                    return !!(t && !t.active && !_detAlarming(s, 'smk1') && c && c.activeAlarms.length === 0);
                },
            },
            {
                msg: '第 4 步：电吹风对准 6# 感温并开启，观察报火警。',
                mode: 'check',
                op: [
                    {
                        type: 'switch', target: 'hairdryer', part: 'power',
                        msg: '电吹风移到 6# 感温旁',
                        async act() {
                            const s = _sysOf(this);
                            await _placeTool(s, 'hairdryer', 'htd1');
                            await _sleep(300);
                            _toolOn(s, 'hairdryer');
                        },
                    },
                    {
                        type: 'observe', target: 'htd1', part: 'test',
                        msg: '观察 6# 感温报警灯亮、LCD 显示火警',
                        async act() { const s = _sysOf(this); await _waitDetFire(s, 'htd1', 18000); await _sleep(1500); },
                    },
                    {
                        type: 'btn', target: 'facp', part: 'btn-mute',
                        msg: '按「MUTE」消音',
                        async act() { const s = _sysOf(this); await _pressKey(s, 'facp', 'btn-mute'); },
                    },
                ],
                check() {
                    const s = window.sys;
                    const t = s && s.comps && s.comps['hairdryer'], c = s && s.comps && s.comps['facp'];
                    return !!(t && t.active && _detAlarming(s, 'htd1') && c && c.activeAlarms.length > 0);
                },
            },
            {
                msg: '第 5 步：关电吹风，按「RESET」复位。',
                mode: 'check',
                op: [
                    {
                        type: 'switch', target: 'hairdryer', part: 'power',
                        msg: '关闭电吹风开关',
                        async act() { const s = _sysOf(this); _toolOff(s, 'hairdryer'); await _waitDetNormal(s, 'htd1', 8000); },
                    },
                    {
                        type: 'switch', target: 'hairdryer', part: 'body',
                        msg: '电吹风移回原位',
                        async act() { const s = _sysOf(this); await _toolHome(s, 'hairdryer'); },
                    },
                    {
                        type: 'btn', target: 'facp', part: 'btn-reset',
                        msg: '按「RESET」复位火警指示',
                        async act() { const s = _sysOf(this); await _sleep(1200); await _pressKey(s, 'facp', 'btn-reset'); },
                    },
                ],
                check() {
                    const s = window.sys;
                    const t = s && s.comps && s.comps['hairdryer'], c = s && s.comps && s.comps['facp'];
                    return !!(t && !t.active && !_detAlarming(s, 'htd1') && c && c.activeAlarms.length === 0);
                },
            },
            {
                msg: '第 6 步：打火机对准 2# 感光并点燃，观察报火警。',
                mode: 'check',
                op: [
                    {
                        type: 'switch', target: 'lighter', part: 'power',
                        msg: '打火机移到 2# 感光旁',
                        async act() {
                            const s = _sysOf(this);
                            await _placeTool(s, 'lighter', 'flm1');
                            await _sleep(300);
                            _toolOn(s, 'lighter');
                        },
                    },
                    {
                        type: 'observe', target: 'flm1', part: 'test',
                        msg: '观察 2# 感光报警灯亮、LCD 显示火警',
                        async act() { const s = _sysOf(this); await _waitDetFire(s, 'flm1', 12000); await _sleep(1500); },
                    },
                    {
                        type: 'btn', target: 'facp', part: 'btn-mute',
                        msg: '按「MUTE」消音',
                        async act() { const s = _sysOf(this); await _pressKey(s, 'facp', 'btn-mute'); },
                    },
                ],
                check() {
                    const s = window.sys;
                    const t = s && s.comps && s.comps['lighter'], c = s && s.comps && s.comps['facp'];
                    return !!(t && t.active && _detAlarming(s, 'flm1') && c && c.activeAlarms.length > 0);
                },
            },
            {
                msg: '第 7 步：关打火机，按「RESET」复位。',
                mode: 'check',
                op: [
                    {
                        type: 'switch', target: 'lighter', part: 'power',
                        msg: '熄灭打火机',
                        async act() { const s = _sysOf(this); _toolOff(s, 'lighter'); await _waitDetNormal(s, 'flm1', 8000); },
                    },
                    {
                        type: 'switch', target: 'lighter', part: 'body',
                        msg: '打火机移回原位',
                        async act() { const s = _sysOf(this); await _toolHome(s, 'lighter'); },
                    },
                    {
                        type: 'btn', target: 'facp', part: 'btn-reset',
                        msg: '按「RESET」复位火警指示',
                        async act() { const s = _sysOf(this); await _sleep(1200); await _pressKey(s, 'facp', 'btn-reset'); },
                    },
                ],
                check() {
                    const s = window.sys;
                    const t = s && s.comps && s.comps['lighter'], c = s && s.comps && s.comps['facp'];
                    return !!(t && !t.active && !_detAlarming(s, 'flm1') && c && c.activeAlarms.length === 0);
                },
            },
            {
                msg: '第 8 步：按下 4# 手报，观察报火警。',
                mode: 'check',
                op: [
                    {
                        type: 'switch', target: 'mcp1', part: 'test',
                        msg: '按下 4# 手动报警按钮',
                        async act() { const s = _sysOf(this); const d = _comp(s, 'mcp1'); if (d && !d.alarming) _firePartClick(d, 'test'); },
                    },
                    {
                        type: 'observe', target: 'facp', part: 'btn-fire',
                        msg: '观察 4# 手报报警灯亮、LCD 显示火警',
                        async act() { const s = _sysOf(this); await _waitDetFire(s, 'mcp1', 12000); await _sleep(1500); },
                    },
                    {
                        type: 'btn', target: 'facp', part: 'btn-mute',
                        msg: '按「MUTE」消音',
                        async act() { const s = _sysOf(this); await _pressKey(s, 'facp', 'btn-mute'); },
                    },
                ],
                check() {
                    const s = window.sys;
                    const c = s && s.comps && s.comps['facp'];
                    return !!(_detAlarming(s, 'mcp1') && c && c.activeAlarms.length > 0);
                },
            },
            {
                msg: '第 9 步：复位 4# 手报，按「RESET」恢复正常监视。',
                mode: 'check',
                op: [
                    {
                        type: 'switch', target: 'mcp1', part: 'test',
                        msg: '复位 4# 手动报警按钮',
                        async act() { const s = _sysOf(this); const d = _comp(s, 'mcp1'); if (d && d.alarming) _firePartClick(d, 'test'); await _waitDetNormal(s, 'mcp1', 8000); },
                    },
                    {
                        type: 'btn', target: 'facp', part: 'btn-reset',
                        msg: '按「RESET」恢复正常监视',
                        async act() { const s = _sysOf(this); await _sleep(1200); await _pressKey(s, 'facp', 'btn-reset'); },
                    },
                ],
                check() {
                    const s = window.sys;
                    const c = s && s.comps && s.comps['facp'];
                    return !!(!_detAlarming(s, 'mcp1') && c && c.activeAlarms.length === 0);
                },
            },
        ],
    },

};

// ═══════════════════════════════════════════════════════════════
// 页面定义（单页工程：不导出页面定义，长度为 0 时 consys.js 不会创建 pageMgr）
// ═══════════════════════════════════════════════════════════════

export const PROJECT_PAGES = [];

// ═══════════════════════════════════════════════════════════════
// 组件配置（1920 × 1080 基准坐标，全部同屏）
// ═══════════════════════════════════════════════════════════════

export const componentConfigs = [
    // ══ 火灾报警控制器（FAS）与探测回路 ══
    { Class: FireAlarmController, id: 'facp', x: -100, y: 10, scale: 0.9, sounderId: 'sounder', detectors: DETECTOR_INFO, visible: true },
    // 左下角：两路 220V 交流电源（主电 / 备电）
    { Class: ACPower, id: 'ac-main', x: -160, y: 550, vRms: 220, isOn: true, label: '主电', visible: true },
    { Class: ACPower, id: 'ac-bk', x: 35, y: 550, vRms: 220, isOn: true, label: '备电', visible: true },
    // 两电源下方：备用感烟探测器（未设地址，不能通信）与地址写入器
    { Class: SmokeDetector, id: 'spare-smk', x: 130, y: 780, label: '备用感烟探测器', nodeAddress: null, visible: true },
    { Class: AddressWriter, id: 'addrw', x: 210, y: 560, label: '地址写入器', visible: true },
    // 声光报警器（报警输出直接驱动）
    { Class: AudioVisualAlarm, id: 'sounder', x: 1360, y: 400, scale: 0.9, visible: true },

    // 回路1：总线连接器在上、探测器在下（探测器 CAN 接口向上接入连接器下方端口）
    { Class: BusConnector, id: 'b-l1-1', x: 940, y: 40, deviceid: 'CANBUS', topGap: 32, visible: true },
    { Class: BusConnector, id: 'b-l1-2', x: 1140, y: 40, deviceid: 'CANBUS', topGap: 32, visible: true },
    { Class: BusConnector, id: 'b-l1-3', x: 1340, y: 40, deviceid: 'CANBUS', topGap: 32, visible: true },
    { Class: BusConnector, id: 'b-l1-4', x: 1540, y: 40, deviceid: 'CANBUS', topGap: 32, visible: true },
    // 回路1 末端：CAN 总线分析仪（双击打开抓包界面）
    { Class: CanAnalyzer, id: 'canalyzer', x: 1680, y: 0, label: 'CAN 总线分析仪', visible: true },
    { Class: SmokeDetector, id: 'smk1', x: 898, y: 150, label: '感烟探测器', nodeAddress: 1, loop: 1, zone: 1, visible: true },
    { Class: FlameDetector, id: 'flm1', x: 1098, y: 150, label: '感光探测器', nodeAddress: 2, loop: 1, zone: 1, visible: true },
    { Class: SmokeDetector, id: 'smk2', x: 1298, y: 150, label: '感烟探测器', nodeAddress: 3, loop: 1, zone: 2, visible: true },
    { Class: ManualCallPoint, id: 'mcp1', x: 1518, y: 180, label: '手动报警按钮', nodeAddress: 4, loop: 1, zone: 2, visible: true },

    // 回路2：总线连接器在上、探测器在下
    { Class: BusConnector, id: 'b-l2-1', x: 480, y: 600, deviceid: 'CANBUS', topGap: 32, visible: true },
    { Class: BusConnector, id: 'b-l2-2', x: 680, y: 600, deviceid: 'CANBUS', topGap: 32, visible: true },
    { Class: BusConnector, id: 'b-l2-3', x: 880, y: 600, deviceid: 'CANBUS', topGap: 32, visible: true },
    { Class: BusConnector, id: 'b-l2-4', x: 1080, y: 600, deviceid: 'CANBUS', topGap: 32, visible: true },
    { Class: SmokeDetector, id: 'smk3', x: 438, y: 710, label: '感烟探测器', nodeAddress: 5, loop: 2, zone: 3, visible: true },
    { Class: HeatDetector, id: 'htd1', x: 638, y: 710, label: '感温探测器', nodeAddress: 6, loop: 2, zone: 3, visible: true },
    { Class: SmokeDetector, id: 'smk4', x: 838, y: 710, label: '感烟探测器', nodeAddress: 7, loop: 2, zone: 4, visible: true },
    { Class: ManualCallPoint, id: 'mcp2', x: 1058, y: 730, label: '手动报警按钮', nodeAddress: 8, loop: 2, zone: 4, visible: true },

    // 测试专用工具（独立工作，可拖拽靠近探头）
    { Class: Lighter, id: 'lighter', x: 1280, y: 760, label: '专用打火机', dwellMs: 3000, visible: true },
    { Class: HairDryer, id: 'hairdryer', x: 1420, y: 760, label: '电吹风', dwellMs: 8000, visible: true },
    { Class: SmokeGenerator, id: 'smokegen', x: 1580, y: 760, label: '烟雾发生器', dwellMs: 5000, visible: true },

    // ══ 7 种标准仪表（默认隐藏，通过「选择仪表」调出）══
    { Class: Multimeter, id: 'multimeter', x: 1260, y: 180, visible: false },
    { Class: MF47Multimeter, id: 'mf47-panel', x: 340, y: 300, visible: false },
    { Class: Oscilloscope_tri, id: 'osc', x: 340, y: 300, visible: false },
    { Class: SignalGenerator, id: 'sg', x: 340, y: 300, visible: false },
    { Class: ProcessCalibrator, id: 'cali', x: 340, y: 300, visible: false },
    { Class: ElecMeter, id: 'elecmeter', x: 340, y: 300, visible: false },
    { Class: RealMegohmMeter, id: 'megohm', x: 340, y: 300, visible: false },
];

// ═══════════════════════════════════════════════════════════════
// 工具栏快捷操作
// ═══════════════════════════════════════════════════════════════

export function initSlider(sys) {
    if (!sys) return;
    sys._noBlinkHighlight = true;
}

export function applyAllPresets(opts) {
    // 初始化时不接线（默认无预接线）；工具栏「自动接线」调用时接好全部线路
    if (opts && opts.init) return;
    const sys = _sysOf(this);
    if (!sys) return;
    _autoWire(sys);
    // 接线完成后启动 CAN 总线通信：控制器广播 NMT START，使两路回路的探测器节点进入运行并开始上报
    const facp = _comp(sys, 'facp');
    if (facp && typeof facp.startNodes === 'function') {
        facp.startNodes();
        setTimeout(() => { try { facp.startNodes(); } catch (e) { /* ignore */ } }, 500);
    }
}

export async function applyStartSystem() {
    const sys = _sysOf(this);
    if (!sys) return;
    await _resetRig(sys);
    await _startSystem(sys);
}

export function fiveStep() {
    const sys = _sysOf(this);
    const facp = _comp(sys, 'facp');
    if (!facp) return;
    // 5 点步进：依次浏览 4 个探测回路的报警与正常状态
    facp.mode = 'status';
    sys.redrawAll && sys.redrawAll();
}
