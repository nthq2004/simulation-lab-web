// ═══════════════════════════════════════════════════════════════
// 项目 6.1 —— 常用传感器的故障诊断（大管轮 · 冷却水温度控制系统）
//
// 组成（由旧工程 lab_01/conSys 迁移而来，并适配本平台）：
//   engine   柴油机（冷却水热源）
//   pump     淡水泵
//   tconn    三通管
//   valve    三通调节阀（PWM/4~20mA 电机执行机构）
//   cooler   冷却器
//   pt       冷却水温度测点（内含 PT100 测温元件与温度 LCD）
//   ttrans   两线制温度变送器（PT100 → 4~20mA）
//   stdres   标准可调电阻（校准变送器零点/量程时替代 PT100）
//   pid      数字式 PID 调节器（4~20mA 输入、输出驱动三通阀）
//   dcpower  24V 直流电源
//   ampmeter 输入回路电流表
//   ampmeter2 输出回路电流表（检测 PID 输出/PWM 电流）
//   monitor  监控主机（RS485 采集 PID、报警消音/确认）
//   gnd      接地
//
// 十条流程：
//   1. 冷却水温度控制系统运行
//   2. PT100 短路故障诊断（项目 6.1）
//   3. PT100 断路故障诊断（项目 6.1）
//   4. 温度变送器输出断路故障诊断
//   5. 温度变送器零点漂移故障诊断（项目 6.3）
//   6. 温度变送器量程偏差故障诊断（项目 6.3）
//   7. PID 调节器参数失调故障诊断（项目 6.4）
//   8. PID 调节器输出回路断路故障诊断（项目 6.4）
//   9. 三通调节阀执行机构卡死故障诊断（项目 6.2）
//  10. 三通调节阀信号输入回路断路故障诊断
//
// 自动演示规范（见全局 AGENTS）：
//   · 动作前先闪烁箭头指示目标；op 数组逐个「指示 → 执行 act → 间隔」
//   · 接线 ≤8 根一律动画接线（addConnectionAnimated），逐根 await
//   · 接线箭头指向端口（op.ports），操作箭头指向子部件（op.part）
//   · 故障设置/修复一律走故障界面（type:'fault'）
//   · 调出仪表一律走仪表界面（type:'instrument'）
//   · 参数调整一律走参数配置界面（_demoSetConfig）
//   · 演示期间抑制组件自身提示（由 Workflow 引擎统一处理）
// ═══════════════════════════════════════════════════════════════

import { Multimeter } from '../components/Multimeter.js';
import { MF47Multimeter } from '../components/MF47Multimeter.js';
import { Oscilloscope_tri } from '../components/Osc_tri.js';
import { SignalGenerator } from '../components/SignalGenerator.js';
import { ProcessCalibrator } from '../components/ProcessCalibrator.js';
import { ElecMeter } from '../components/ElecMeter.js';
import { RealMegohmMeter } from '../components/RealMegohmMeter.js';

import { Monitor } from '../components/Monitor.js';
import { PIDController } from '../components/PID.js';
import { TempTransmitter } from '../components/TempTransmitter.js';
import { CoolingSystem } from '../components/CoolingSystem.js';
import { VariResistor } from '../components/VariResistor.js';
import { TeeConnector } from '../components/TeeConnector.js';
import { Pump } from '../components/Pump.js';
import { Engine } from '../components/Engine.js';
import { ElecValve } from '../components/ElecValve.js';
import { Cooler } from '../components/Cooler.js';
import { DCPower } from '../components/DCPower.js';
import { AmpMeter } from '../components/AmpMeter.js';
import { Ground } from '../components/Gnd.js';

// ═══════════════════════════════════════════════════════════════
// 通用辅助
// ═══════════════════════════════════════════════════════════════

/** 兼容「this = Workflow / WorkflowManager / ControlSystem / 无」几种调用姿势取 sys */
const _sysOf = (ctx) => (ctx && ctx.sys) ? ctx.sys : window.sys;

const _sleep = (ms) => new Promise(r => setTimeout(r, ms));

/** 无向判断两端口是否已连线 */
function _hasConn(sys, a, b) {
    return !!(sys && sys.conns) && sys.conns.some(c =>
        (c.from === a && c.to === b) || (c.from === b && c.to === a));
}

/** 万用表红/黑表笔是否跨接在被测两端（正接、反接均可） */
function _probesAcross(sys, termX, termY) {
    const v = 'multimeter_wire_v', com = 'multimeter_wire_com';
    return (_hasConn(sys, v, termX) && _hasConn(sys, com, termY))
        || (_hasConn(sys, v, termY) && _hasConn(sys, com, termX));
}

/** 万用表两支表笔是否均已从被测两端移开 */
function _probesDetached(sys, termX, termY) {
    const v = 'multimeter_wire_v', com = 'multimeter_wire_com';
    return !(_hasConn(sys, v, termX) || _hasConn(sys, v, termY)
        || _hasConn(sys, com, termX) || _hasConn(sys, com, termY));
}

/** 清空全部连线 */
function _clearConns(sys) {
    if (sys && Array.isArray(sys.conns)) {
        sys.conns.length = 0;
        sys.redrawAll && sys.redrawAll();
    }
}

/** 判断两条连线是否等价（优先复用引擎提供的比较函数） */
function _connEq(sys, a, b) {
    if (sys && typeof sys._connEqual === 'function') return sys._connEqual(a, b);
    if (sys && sys.connMgr && typeof sys.connMgr.connEqual === 'function') return sys.connMgr.connEqual(a, b);
    return (a.from === b.from && a.to === b.to) || (a.from === b.to && a.to === b.from);
}

/** 移除一根连线（就地删除，保持数组引用不变） */
function _removeConn(sys, conn) {
    if (!sys || !Array.isArray(sys.conns) || !conn) return;
    for (let i = sys.conns.length - 1; i >= 0; i--) {
        if (_connEq(sys, sys.conns[i], conn)) sys.conns.splice(i, 1);
    }
    sys.redrawAll && sys.redrawAll();
}

/** 动画接一根线（约 3s/根；已连接则跳过） */
async function _wireOne(sys, conn) {
    if (!sys || !sys.connMgr || !conn) return;
    if (_hasConn(sys, conn.from, conn.to)) return;
    await sys.connMgr.addConnectionAnimated({ from: conn.from, to: conn.to, type: conn.type || 'wire' });
}

/** 等待条件成立（超时返回最后一次判定结果） */
async function _waitFor(sys, cond, timeoutMs = 15000, intervalMs = 250) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
        try { if (cond(sys)) return true; } catch (e) { /* ignore */ }
        await _sleep(intervalMs);
    }
    try { return !!cond(sys); } catch (e) { return false; }
}

/** 监控主机消音 + 确认 */
function _muteAck(sys) {
    const m = sys && sys.comps && sys.comps['monitor'];
    if (m) { m.btnMuteFunc && m.btnMuteFunc(); m.btnAckFunc && m.btnAckFunc(); }
}

/** 设置数字万用表档位并同步旋钮 */
function _setMultimeter(sys, mode) {
    const mm = sys && sys.comps && sys.comps['multimeter'];
    if (!mm) return;
    mm.mode = mode;
    mm._updateAngleByMode && mm._updateAngleByMode();
}

/**
 * 通过参数配置界面动态演示参数修改（严格遵守「参数调整一律走配置界面」）：
 *   ① 弹框前把实时属性同步进 config 副本（有 get 的字段跳过）
 *   ② comp.showConfigDialog() 弹出参数设置界面
 *   ③ 取 #diag_<key> 输入框 → 闪烁箭头高亮 + 填入新值（支持一次改多个）
 *   ④ 取最后打开的对话框的「保存」按钮 → 闪烁箭头高亮 + 真正 click() 按下
 *   ⑤ 确认对话框已关闭
 */
async function _demoSetConfigMulti(wf, compId, entries, tip) {
    const sys = _sysOf(wf);
    const comp = sys && sys.comps[compId];
    if (!comp || typeof comp.showConfigDialog !== 'function') return;

    (comp.getConfigFields ? comp.getConfigFields() : []).forEach(f => {
        if (f.get) return;
        try { const live = comp[f.key]; if (live !== undefined) comp.config[f.key] = live; } catch (e) { /* 只读属性忽略 */ }
    });

    comp.showConfigDialog();
    await _sleep(700);

    for (const ent of entries) {
        const input = document.getElementById('diag_' + ent.key);
        if (!input) continue;
        if (wf && typeof wf._flashDomElement === 'function') {
            await wf._flashDomElement(input, ent.tip || tip || `请把该参数改为 ${ent.value}`, 2200);
        }
        input.value = String(ent.value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        await _sleep(300);
    }

    const saveBtns = [...document.querySelectorAll('button')].filter(b => b.textContent.trim() === '保存');
    const saveBtn = saveBtns[saveBtns.length - 1];
    if (saveBtn) {
        if (wf && typeof wf._flashDomElement === 'function') {
            await wf._flashDomElement(saveBtn, '点击「保存」确认参数修改', 1800);
        }
        saveBtn.click();
        await _sleep(600);
    }
    await _sleep(300);
}

/** 单项参数配置 */
function _demoSetConfig(wf, compId, key, value, tip) {
    return _demoSetConfigMulti(wf, compId, [{ key, value, tip }], tip);
}

/** 连续改变标准电阻（通过配置界面逐点调整），演示线性刻度 */
async function _sweepStdRes(wf, n = 10, startR = 100, stepR = 3.851) {
    for (let i = 1; i <= n; i++) {
        const r = +(startR + i * stepR).toFixed(2);
        await _demoSetConfig(wf, 'stdres', 'currentResistance', r,
            `标准电阻调到 ${r}Ω（对应约 ${i * 10}℃）`);
    }
}

// ═══════════════════════════════════════════════════════════════
// 接线表（parts 供接线步骤箭头指向端口）
// ═══════════════════════════════════════════════════════════════

// ① 冷却水管路（6 根管路）
const WIRE_PIPE = [
    { conn: { from: 'engine_pipe_o', to: 'pump_pipe_i', type: 'pipe' }, target: 'engine', ports: ['engine_pipe_o', 'pump_pipe_i'], msg: '管路①：柴油机冷却水出口 → 淡水泵入口' },
    { conn: { from: 'pump_pipe_o', to: 'tconn_pipe_l', type: 'pipe' }, target: 'pump', ports: ['pump_pipe_o', 'tconn_pipe_l'], msg: '管路②：淡水泵出口 → 三通管左端' },
    { conn: { from: 'tconn_pipe_u', to: 'valve_pipe_u', type: 'pipe' }, target: 'tconn', ports: ['tconn_pipe_u', 'valve_pipe_u'], msg: '管路③：三通管上端 → 三通调节阀上口（旁通）' },
    { conn: { from: 'tconn_pipe_r', to: 'cooler_pipe_i', type: 'pipe' }, target: 'tconn', ports: ['tconn_pipe_r', 'cooler_pipe_i'], msg: '管路④：三通管右端 → 冷却器入口' },
    { conn: { from: 'cooler_pipe_o', to: 'valve_pipe_l', type: 'pipe' }, target: 'cooler', ports: ['cooler_pipe_o', 'valve_pipe_l'], msg: '管路⑤：冷却器出口 → 三通调节阀下口' },
    { conn: { from: 'valve_pipe_r', to: 'engine_pipe_i', type: 'pipe' }, target: 'valve', ports: ['valve_pipe_r', 'engine_pipe_i'], msg: '管路⑥：三通调节阀上端 → 柴油机冷却水入口' },
];

// ② PID 调节器电源与接地（3 根）
const WIRE_POWER = [
    { conn: { from: 'pid_wire_vcc', to: 'dcpower_wire_p', type: 'wire' }, target: 'pid', ports: ['pid_wire_vcc', 'dcpower_wire_p'], msg: '接线①：PID 调节器 VCC(+) → 24V 电源正端' },
    { conn: { from: 'pid_wire_gnd', to: 'dcpower_wire_n', type: 'wire' }, target: 'pid', ports: ['pid_wire_gnd', 'dcpower_wire_n'], msg: '接线②：PID 调节器 GND(-) → 24V 电源负端' },
    { conn: { from: 'dcpower_wire_n', to: 'gnd_wire_gnd', type: 'wire' }, target: 'gnd', ports: ['dcpower_wire_n', 'gnd_wire_gnd'], msg: '接线③：24V 电源负端 → 接地端子（共地）' },
];

// ③ PT100 三线制信号（3 根）
const WIRE_PT100 = [
    { conn: { from: 'pt_wire_l', to: 'ttrans_wire_l', type: 'wire' }, target: 'pt', ports: ['pt_wire_l', 'ttrans_wire_l'], msg: '接线④：PT100 L 端 → 温度变送器 L 端' },
    { conn: { from: 'pt_wire_r', to: 'ttrans_wire_m', type: 'wire' }, target: 'pt', ports: ['pt_wire_r', 'ttrans_wire_m'], msg: '接线⑤：PT100 R 端 → 温度变送器 M 端' },
    { conn: { from: 'pt_wire_r', to: 'ttrans_wire_r', type: 'wire' }, target: 'pt', ports: ['pt_wire_r', 'ttrans_wire_r'], msg: '接线⑥：温度变送器 M、R 短接（三线制）' },
];

// ④ 温度变送器输出回路（3 根：变送器供电 + 4~20mA 信号入 PID）
const WIRE_TRANS_PWR = [
    { conn: { from: 'ampmeter_wire_n', to: 'ttrans_wire_p', type: 'wire' }, target: 'ttrans', ports: ['ampmeter_wire_n', 'ttrans_wire_p'], msg: '接线⑦：电流表 N(-) → 温度变送器 P(+)（供电）' },
];
const WIRE_TRANS_SIG = [
    { conn: { from: 'ttrans_wire_n', to: 'pid_wire_ni1', type: 'wire' }, target: 'ttrans', ports: ['ttrans_wire_n', 'pid_wire_ni1'], msg: '接线⑧：温度变送器 N(-) → PID 输入(-)' },
];
const WIRE_TRANS_IN = [
    { conn: { from: 'pid_wire_pi1', to: 'ampmeter_wire_p', type: 'wire' }, target: 'pid', ports: ['pid_wire_pi1', 'ampmeter_wire_p'], msg: '接线⑨：PID 4~20mA 输入(+) → 电流表 P(+)' },
];
const WIRE_TRANS = [...WIRE_TRANS_IN, ...WIRE_TRANS_PWR, ...WIRE_TRANS_SIG];
const WIRE_TRANS_PWR_SIG = [...WIRE_TRANS_PWR, ...WIRE_TRANS_SIG];

// ⑤ PID 输出回路（2 根）
const WIRE_PID_POS = [
    { conn: { from: 'pid_wire_po1', to: 'valve_wire_l', type: 'wire' }, target: 'pid', ports: ['pid_wire_po1', 'valve_wire_l'], msg: '接线⑩：PID 输出(+) → 三通调节阀电机左端' },
];
const WIRE_PID_NEG = [
    { conn: { from: 'pid_wire_no1', to: 'valve_wire_r', type: 'wire' }, target: 'pid', ports: ['pid_wire_no1', 'valve_wire_r'], msg: '接线⑪：PID 输出(-) → 三通调节阀电机右端' },
];
const WIRE_PID_OUT = [...WIRE_PID_POS, ...WIRE_PID_NEG];

// ⑥ RS485 通信（2 根）
const WIRE_RS485 = [
    { conn: { from: 'pid_wire_b1', to: 'monitor_wire_b1', type: 'wire' }, target: 'pid', ports: ['pid_wire_b1', 'monitor_wire_b1'], msg: '接线⑫：PID RS485 B → 监控主机 B' },
    { conn: { from: 'pid_wire_a1', to: 'monitor_wire_a1', type: 'wire' }, target: 'pid', ports: ['pid_wire_a1', 'monitor_wire_a1'], msg: '接线⑬：PID RS485 A → 监控主机 A' },
];

const ALL_WIRE_META = [...WIRE_PIPE, ...WIRE_POWER, ...WIRE_PT100, ...WIRE_TRANS, ...WIRE_PID_OUT, ...WIRE_RS485];

// ⑦ 标准可调电阻替代 PT100（3 根，校准用）
const WIRE_STDRES = [
    { conn: { from: 'stdres_wire_l', to: 'ttrans_wire_l', type: 'wire' }, target: 'stdres', ports: ['stdres_wire_l', 'ttrans_wire_l'], msg: '标准电阻 L 端 → 温度变送器 L 端' },
    { conn: { from: 'stdres_wire_r', to: 'ttrans_wire_m', type: 'wire' }, target: 'stdres', ports: ['stdres_wire_r', 'ttrans_wire_m'], msg: '标准电阻 R 端 → 温度变送器 M 端' },
    { conn: { from: 'stdres_wire_r', to: 'ttrans_wire_r', type: 'wire' }, target: 'stdres', ports: ['stdres_wire_r', 'ttrans_wire_r'], msg: '温度变送器 M、R 短接（三线制）' },
];

// ⑧ 万用表表笔测量线
const PROBE_PT100 = [
    { conn: { from: 'multimeter_wire_com', to: 'pt_wire_r', type: 'wire' }, target: 'multimeter', ports: ['multimeter_wire_com', 'pt_wire_r'], msg: '黑表笔(COM) → PT100 R 端' },
    { conn: { from: 'multimeter_wire_v', to: 'pt_wire_l', type: 'wire' }, target: 'multimeter', ports: ['multimeter_wire_v', 'pt_wire_l'], msg: '红表笔(V) → PT100 L 端' },
];
const PROBE_TTRANS_SUPPLY = [
    { conn: { from: 'multimeter_wire_com', to: 'ttrans_wire_n', type: 'wire' }, target: 'multimeter', ports: ['multimeter_wire_com', 'ttrans_wire_n'], msg: '黑表笔(COM) → 温度变送器 N(-)' },
    { conn: { from: 'multimeter_wire_v', to: 'ttrans_wire_p', type: 'wire' }, target: 'multimeter', ports: ['multimeter_wire_v', 'ttrans_wire_p'], msg: '红表笔(V) → 温度变送器 P(+)' },
];
const PROBE_PID_OUT = [
    { conn: { from: 'multimeter_wire_com', to: 'pid_wire_no1', type: 'wire' }, target: 'multimeter', ports: ['multimeter_wire_com', 'pid_wire_no1'], msg: '黑表笔(COM) → PID 输出(-)' },
    { conn: { from: 'multimeter_wire_v', to: 'pid_wire_po1', type: 'wire' }, target: 'multimeter', ports: ['multimeter_wire_v', 'pid_wire_po1'], msg: '红表笔(V) → PID 输出(+)' },
];
const PROBE_VALVE = [
    { conn: { from: 'multimeter_wire_com', to: 'valve_wire_r', type: 'wire' }, target: 'multimeter', ports: ['multimeter_wire_com', 'valve_wire_r'], msg: '黑表笔(COM) → 三通阀电机右端' },
    { conn: { from: 'multimeter_wire_v', to: 'valve_wire_l', type: 'wire' }, target: 'multimeter', ports: ['multimeter_wire_v', 'valve_wire_l'], msg: '红表笔(V) → 三通阀电机左端' },
];

// ⑨ 输出回路串入电流表（断开 pid_po1→valve.l，改经 ampmeter2）
const WIRE_AMP2 = [
    { conn: { from: 'pid_wire_po1', to: 'ampmeter2_wire_p', type: 'wire' }, target: 'ampmeter2', ports: ['pid_wire_po1', 'ampmeter2_wire_p'], msg: '断开 PID 输出(+) → 串入电流表 P(+)' },
    { conn: { from: 'ampmeter2_wire_n', to: 'valve_wire_l', type: 'wire' }, target: 'ampmeter2', ports: ['ampmeter2_wire_n', 'valve_wire_l'], msg: '电流表 N(-) → 三通调节阀电机左端' },
];

/** 把接线元数据映射为「逐个指示端口 → 动画接线」的 op 数组 */
function _wireOps(meta) {
    return meta.map(m => ({
        type: 'observe', target: m.target, msg: m.msg,
        ports: [m.conn.from, m.conn.to],
        async act() { await _wireOne(this.sys, m.conn); },
    }));
}

/** 把接线元数据映射为「逐个指示端口 → 断开连线」的 op 数组 */
function _unwireOps(meta) {
    return meta.map(m => ({
        type: 'observe', target: m.target, msg: '断开 → ' + m.msg,
        ports: [m.conn.from, m.conn.to],
        async act() { _removeConn(this.sys, m.conn); await _sleep(500); },
    }));
}

// ═══════════════════════════════════════════════════════════════
// 工位复位 / 系统启动（内部初始化，不作为教学动作）
// ═══════════════════════════════════════════════════════════════

async function _resetRig(sys) {
    if (!sys) return;
    _clearConns(sys);

    const dc = sys.comps['dcpower'];
    if (dc) { dc.isOn = false; dc.isBreak = false; dc.update && dc.update(); }

    const eng = sys.comps['engine'];
    if (eng) { eng.engOn = false; }

    const pump = sys.comps['pump'];
    if (pump) { pump.pumpOn = false; }

    const pid = sys.comps['pid'];
    if (pid) {
        // 冷却水系统为反作用调节（温度偏高需开大阀门加强冷却）——与旧工程一致，direction=REV
        pid.direction = 'REV';
        pid.mode = 'MAN';
        pid.OUT = 50; pid.P = 4; pid.I = 30; pid.D = 0; pid.SV = 80;
        pid.integral = 0; pid.lastError = 0;
        pid.out1Fault = false; pid.out2Fault = false;
    }

    const valve = sys.comps['valve'];
    if (valve) {
        valve.isStuck = false; valve.manualPos = 0; valve.currentPos = 0;
        valve.currentResistance = 250;
        valve.setControlMode && valve.setControlMode('REMOTE');
    }

    const pt = sys.comps['pt'];
    if (pt) { pt._pt100Fault = null; pt.temp = pt.ambientT; pt.sensorTemp = pt.ambientT; pt.tempBuffer = []; }

    const tt = sys.comps['ttrans'];
    if (tt) {
        tt.isBreak = false; tt.isShort = false; tt.zeroAdj = 0; tt.spanAdj = 1;
        if (tt.knobs) { tt.knobs.zero && tt.knobs.zero.rotation(0); tt.knobs.span && tt.knobs.span.rotation(0); }
    }

    const std = sys.comps['stdres'];
    if (std) {
        std.currentResistance = 100;
        std.update && std.update();
        std.group && std.group.position({ x: 1320, y: 420 });   // 归位（校准演示中会被移到测试台旁）
    }

    const a2 = sys.comps['ampmeter2'];
    if (a2 && a2.group) a2.group.position({ x: 1520, y: 600 });  // 归位（输出回路演示中会被移近）

    _setMultimeter(sys, 'OFF');

    Object.values(sys.FAULT_CONFIG || {}).forEach(f => { try { f.repair && f.repair(); } catch (e) { /* ignore */ } });

    sys.redrawAll && sys.redrawAll();
    await _sleep(300);
}

/** 瞬时接线（工具栏「自动接线」，非演示用） */
function _autoWire(sys) {
    if (!sys || !sys.connMgr) return;
    sys.conns.length = 0;
    ALL_WIRE_META.forEach(m => sys.connMgr.addConn({ from: m.conn.from, to: m.conn.to, type: m.conn.type }));
    sys.redrawAll && sys.redrawAll();
}

/** 演示/培训用「系统启动」：接线 → 上电 → 开泵开主机 → 阀遥控 → PID 自动 */
async function _startSystem(sys) {
    if (!sys) return;
    _autoWire(sys);

    const dc = sys.comps['dcpower'];
    if (dc) { dc.isOn = true; dc.isBreak = false; dc.update && dc.update(); }

    const eng = sys.comps['engine'];
    if (eng) eng.engOn = true;

    const pump = sys.comps['pump'];
    if (pump) pump.pumpOn = true;

    const valve = sys.comps['valve'];
    if (valve) { valve.isStuck = false; valve.setControlMode && valve.setControlMode('REMOTE'); }

    const pid = sys.comps['pid'];
    if (pid) { pid.direction = 'REV'; pid.mode = 'AUTO'; }

    sys.redrawAll && sys.redrawAll();
    await _sleep(600);
}

/** 系统正常运行判据：PID 自动、PV 与 SV 偏差 <10℃、主机/泵/电源全开、报警已消音 */
function _systemReadyCheck(sys) {
    if (!sys || !sys.comps) return false;
    const pid = sys.comps['pid'], mon = sys.comps['monitor'];
    const eng = sys.comps['engine'], pump = sys.comps['pump'], dc = sys.comps['dcpower'];
    return !!(pid && pid.mode === 'AUTO' && Math.abs(pid.PV - pid.SV) < 10
        && dc && dc.isOn && eng && eng.engOn && pump && pump.pumpOn
        && mon && mon.activeAlarms.every(a => a.muted === true));
}

// ═══════════════════════════════════════════════════════════════
// 故障配置（走故障界面：check / trigger / repair）
// ═══════════════════════════════════════════════════════════════

export const FAULT_CONFIGS = {
    // ── PT100 传感器短路 ──
    'pt-short': {
        id: 'pt-short',
        name: '传感器1. PT100 传感器短路',
        system: '6.1',
        check() { const s = window.sys; return !!(s && s.comps['pt'] && s.comps['pt']._pt100Fault === 'short'); },
        trigger() { const s = window.sys; if (s && s.comps['pt']) { s.comps['pt']._pt100Fault = 'short'; s.comps['pt'].update && s.comps['pt'].update(); s.redrawAll && s.redrawAll(); } },
        repair() { const s = window.sys; const pt = s && s.comps['pt']; if (pt && pt._pt100Fault === 'short') { pt._pt100Fault = null; pt.update && pt.update(); s.redrawAll && s.redrawAll(); } },
    },
    // ── PT100 传感器断路 ──
    'pt-open': {
        id: 'pt-open',
        name: '传感器2. PT100 传感器断路',
        system: '6.1',
        check() { const s = window.sys; return !!(s && s.comps['pt'] && s.comps['pt']._pt100Fault === 'open'); },
        trigger() { const s = window.sys; if (s && s.comps['pt']) { s.comps['pt']._pt100Fault = 'open'; s.comps['pt'].update && s.comps['pt'].update(); s.redrawAll && s.redrawAll(); } },
        repair() { const s = window.sys; const pt = s && s.comps['pt']; if (pt && pt._pt100Fault === 'open') { pt._pt100Fault = null; pt.update && pt.update(); s.redrawAll && s.redrawAll(); } },
    },
    // ── 温度变送器输出断路 ──
    'ttrans-open': {
        id: 'ttrans-open',
        name: '传感器3. 温度变送器输出断路',
        system: '6.1',
        check() { const s = window.sys; return !!(s && s.comps['ttrans'] && s.comps['ttrans'].isBreak === true); },
        trigger() { const s = window.sys; if (s && s.comps['ttrans']) { s.comps['ttrans'].isBreak = true; s.redrawAll && s.redrawAll(); } },
        repair() { const s = window.sys; const tt = s && s.comps['ttrans']; if (tt && tt.isBreak) { tt.isBreak = false; s.redrawAll && s.redrawAll(); } },
    },
    // ── 三通调节阀执行机构卡死 ──
    'valve-stuck': {
        id: 'valve-stuck',
        name: '执行1. 三通调节阀执行机构卡死',
        system: '6.2',
        check() { const s = window.sys; return !!(s && s.comps['valve'] && s.comps['valve'].isStuck === true); },
        trigger() { const s = window.sys; if (s && s.comps['valve']) { s.comps['valve'].isStuck = true; } },
        repair() { const s = window.sys; if (s && s.comps['valve'] && s.comps['valve'].isStuck) { s.comps['valve'].isStuck = false; } },
    },
    // ── 三通调节阀信号输入回路断路 ──
    'valve-open': {
        id: 'valve-open',
        name: '执行2. 三通调节阀输入回路断路',
        system: '6.2',
        check() { const s = window.sys; return !!(s && s.comps['valve'] && s.comps['valve'].currentResistance > 10000); },
        trigger() { const s = window.sys; if (s && s.comps['valve']) { s.comps['valve'].currentResistance = 1e8; s.redrawAll && s.redrawAll(); } },
        repair() { const s = window.sys; if (s && s.comps['valve'] && s.comps['valve'].currentResistance > 10000) { s.comps['valve'].currentResistance = 250; s.redrawAll && s.redrawAll(); } },
    },    
    // ── 温度变送器零点漂移 ──
    'ttrans-zero': {
        id: 'ttrans-zero',
        name: '变送器1. 温度变送器零点漂移',
        system: '6.3',
        check() { const s = window.sys; return !!(s && s.comps['ttrans'] && s.comps['ttrans'].zeroAdj > 0.1); },
        trigger() {
            const s = window.sys; const tt = s && s.comps['ttrans']; if (!tt) return;
            tt.zeroAdj = 0.4;
            if (tt.knobs && tt.knobs.zero) tt.knobs.zero.rotation(180);
            tt._refreshCache && tt._refreshCache();
            s.redrawAll && s.redrawAll();
        },
        repair() {
            const s = window.sys; const tt = s && s.comps['ttrans']; if (!tt || !(tt.zeroAdj > 0.1)) return;
            tt.zeroAdj = 0;
            if (tt.knobs && tt.knobs.zero) tt.knobs.zero.rotation(0);
            tt._refreshCache && tt._refreshCache();
            s.redrawAll && s.redrawAll();
        },
    },
    // ── 温度变送器量程偏差 ──
    'ttrans-span': {
        id: 'ttrans-span',
        name: '变送器2. 温度变送器量程偏差',
        system: '6.3',
        check() { const s = window.sys; return !!(s && s.comps['ttrans'] && s.comps['ttrans'].spanAdj > 1.1); },
        trigger() {
            const s = window.sys; const tt = s && s.comps['ttrans']; if (!tt) return;
            tt.spanAdj = 1.125;
            if (tt.knobs && tt.knobs.span) tt.knobs.span.rotation(90);
            tt._refreshCache && tt._refreshCache();
            s.redrawAll && s.redrawAll();
        },
        repair() {
            const s = window.sys; const tt = s && s.comps['ttrans']; if (!tt || !(tt.spanAdj > 1.1)) return;
            tt.spanAdj = 1;
            if (tt.knobs && tt.knobs.span) tt.knobs.span.rotation(0);
            tt._refreshCache && tt._refreshCache();
            s.redrawAll && s.redrawAll();
        },
    },
    // ── PID 调节器参数失调 ──
    'pid-param': {
        id: 'pid-param',
        name: '调节器1. PID 调节器参数失调',
        system: '6.4',
        check() { const s = window.sys; return !!(s && s.comps['pid'] && s.comps['pid'].P < 0.5); },
        trigger() { const s = window.sys; if (s && s.comps['pid']) { const p = s.comps['pid']; p.P = 0.05; p.I = 0; p.D = 0; } },
        repair() { const s = window.sys; if (s && s.comps['pid'] && s.comps['pid'].P < 0.5) { const p = s.comps['pid']; p.P = 4; p.I = 30; p.D = 0; } },
    },
    // ── PID 调节器输出回路断路 ──
    'pid-open': {
        id: 'pid-open',
        name: '调节器2. PID 调节器输出断路',
        system: '6.4',
        check() { const s = window.sys; return !!(s && s.comps['pid'] && s.comps['pid'].out1Fault === true); },
        trigger() { const s = window.sys; if (s && s.comps['pid']) { s.comps['pid'].out1Fault = true; } },
        repair() { const s = window.sys; if (s && s.comps['pid'] && s.comps['pid'].out1Fault) { s.comps['pid'].out1Fault = false; } },
    },

};

// ═══════════════════════════════════════════════════════════════
// 步骤构造器（统一「指示 → 操作 → 间隔」节奏）
// ═══════════════════════════════════════════════════════════════

/** 系统正常运行基线步骤：复位 → 启动 → 等待稳定 → 消音确认 */
function _readyStep(msg) {
    return {
        msg: msg || '第 2 步：一键接好线路并启动系统，使系统正常运行（PID 自动、偏差小于 10℃、报警已消音消闪）。',
        mode: 'check',
        op: [
            {
                type: 'observe', target: 'dcpower', part: 'power',
                msg: '自动接线并启动系统（复位 → 接线 → 上电 → 开泵开主机 → PID 自动）',
                async act() { await _resetRig(this.sys); await _startSystem(this.sys); },
            },
            {
                type: 'observe', target: 'pid',
                msg: '等待系统温度稳定，PV 逐步趋近 SV',
                async act() { await _waitFor(this.sys, s => { const p = s.comps['pid']; return p.mode === 'AUTO' && Math.abs(p.PV - p.SV) < 10; }, 60000, 400); await _sleep(1500); },
            },
            {
                type: 'observe', target: 'monitor', part: 'mute',
                msg: '点击「消音」再「确认」，清除初始报警',
                async act() { _muteAck(this.sys); await _sleep(900); },
            },
        ],
        check() { return _systemReadyCheck(_sysOf(this)); },
    };
}

/** 接线步骤（动画接线） */
function _wireStep(msg, meta) {
    return {
        msg, mode: 'check', op: _wireOps(meta),
        check() { const s = _sysOf(this); return meta.every(m => _hasConn(s, m.conn.from, m.conn.to)); },
    };
}

/** 故障设置步骤（走故障界面）。演练/评估模式下，故障生效后本步再保持 3s，
 *  以等待监控主机报警（3s 去抖延迟）触发，避免进入下一步时报警尚未出现。 */
function _faultStep(msg, faultId, tip) {
    let faultSetAt = null;
    return {
        msg, mode: 'check',
        op: [{ type: 'fault', fault: faultId, msg: tip || msg, async act() { await _sleep(400); } }],
        check() {
            const s = _sysOf(this);
            const f = s.FAULT_CONFIG[faultId];
            const active = !!(f && f.check());
            if (!active) { faultSetAt = null; return false; }
            if (faultSetAt === null) faultSetAt = Date.now();
            return Date.now() - faultSetAt >= 3000;
        },
    };
}

/** 故障修复步骤（走故障界面） */
function _repairStep(msg, faultId, tip) {
    return {
        msg, mode: 'check',
        op: [{ type: 'fault', fault: faultId, repair: true, msg: tip || msg, async act() { await _sleep(400); } }],
        check() { const s = _sysOf(this); const f = s.FAULT_CONFIG[faultId]; return !!(f && !f.check()); },
    };
}

/** 查看报警、消音、确认步骤 */
function _alarmStep(msg) {
    return {
        msg: msg || '查看监控主机报警，进行消音、确认。', mode: 'check',
        op: [
            { type: 'observe', target: 'monitor', part: 'alarm-area', msg: '观察监控主机出现的故障报警', async act() { await _sleep(4000); } },
            { type: 'switch', target: 'monitor', part: 'mute', msg: '点击「消音」', async act() { const m = this.sys.comps['monitor']; m && m.btnMuteFunc && m.btnMuteFunc(); await _sleep(700); } },
            { type: 'switch', target: 'monitor', part: 'ack', msg: '点击「确认」', async act() { const m = this.sys.comps['monitor']; m && m.btnAckFunc && m.btnAckFunc(); await _sleep(700); } },
        ],
        check() { const m = _sysOf(this).comps['monitor']; return !!(m && m.activeAlarms.every(a => a.muted === true)); },
    };
}

/** PID 切手动 + 阀位 60~70% */
function _pidManualValveOps(targetOut = 65) {
    return [
        {
            type: 'switch', target: 'pid', part: 'am',
            msg: '按 A/M 键，将 PID 切换为手动(MAN)模式',
            async act() { const p = this.sys.comps['pid']; if (p) p.mode = 'MAN'; await _sleep(800); },
        },
        {
            type: 'observe', target: 'valve', part: 'wheel',
            msg: `手动调节输出约 ${targetOut}%，使三通调节阀开度稳定在 60~70%`,
            async act() {
                const p = this.sys.comps['pid']; if (p) { p.mode = 'MAN'; p.OUT = targetOut; }
                await _waitFor(this.sys, s => { const v = s.comps['valve']; return v.currentPos >= 0.6 && v.currentPos <= 0.72; }, 10000, 200);
                await _sleep(1200);
            },
        },
    ];
}

/** PID 切回自动并等待稳定 */
function _autoStableOps() {
    return [
        {
            type: 'switch', target: 'pid', part: 'am',
            msg: '按 A/M 键，将 PID 切回自动(AUTO)模式',
            async act() { const p = this.sys.comps['pid']; if (p) p.mode = 'AUTO'; await _sleep(1000); },
        },
        {
            type: 'observe', target: 'pid',
            msg: '等待系统重新稳定，PV 与 SV 偏差小于 10℃',
            async act() { await _waitFor(this.sys, s => { const p = s.comps['pid']; return p.mode === 'AUTO' && Math.abs(p.PV - p.SV) < 10; }, 60000, 400); await _sleep(1500); },
        },
        {
            type: 'observe', target: 'monitor', part: 'mute',
            msg: '消音、确认报警，确认系统恢复正常',
            async act() { _muteAck(this.sys); await _sleep(900); },
        },
    ];
}

function _quizStep(msg, question, options, answer, analysis) {
    return { msg, mode: 'quiz', quizConfig: { question, options, answer, analysis } };
}

// ═══════════════════════════════════════════════════════════════
// 工作流
// ═══════════════════════════════════════════════════════════════

export const PROJECT_WORKFLOWS = {
    // ══════════════════════════════════════════════════════════
    // 流程一：温度变送器零点漂移故障诊断（项目 6.3）
    // ══════════════════════════════════════════════════════════
    'ttrans-zero': {
        id: 'ttrans-zero',
        name: '1. 温度变送器零点漂移故障排除',
        steps: [
            {
                msg: '第 1 步：识别本次校准/诊断涉及的主要部件——温度变送器、标准可调电阻、PT100 与 PID 调节器。',
                mode: 'find',
                target: ['ttrans', 'stdres', 'pt', 'pid'],
                demoTarget: ['ttrans', 'stdres', 'pid'],
            },
            _readyStep(),
            _faultStep('第 3 步：通过「故障设置」界面设置「温度变送器零点漂移」故障。', 'ttrans-zero', '打开「故障设置」界面，勾选「温度变送器零点漂移」，点击「应用设置」'),
            {
                msg: '第 4 步：PID 控制器切换到手动模式，阀位控制在 60~70%。',
                mode: 'check',
                op: _pidManualValveOps(65),
                check() {
                    const s = _sysOf(this); const p = s.comps['pid']; const v = s.comps['valve'];
                    return p.mode === 'MAN' && v.currentPos >= 0.6 && v.currentPos <= 0.72;
                },
            },
            {
                msg: '第 5 步：断开 PT100 接线，接入标准可调电阻。',
                mode: 'check',
                op: [
                    { type: 'observe', target: 'stdres', msg: '把标准可调电阻移到测试台旁', async act() { const sr = this.sys.comps['stdres']; sr && sr.group.position({ x: 130, y: 380 }); await _sleep(500); } },
                    ..._unwireOps(WIRE_PT100),
                    ..._wireOps(WIRE_STDRES),
                ],
                check() {
                    const s = _sysOf(this);
                    return WIRE_PT100.every(m => !_hasConn(s, m.conn.from, m.conn.to))
                        && WIRE_STDRES.every(m => _hasConn(s, m.conn.from, m.conn.to));
                },
            },
            {
                msg: '第 6 步：标准电阻每次增加约 3.85Ω，直到约 138.5Ω，确认每次仪表指示值增加约 10℃，可判定为变送器零点漂移而非量程偏差。',
                mode: 'check',
                op: [
                    { type: 'observe', target: 'ttrans', part: 'lcd', msg: '逐步增大标准电阻，观察变送器温度显示等量线性上升', async act() { await _sweepStdRes(this, 10, 100, 3.851); await _sleep(2000); } },
                ],
                check() { return _sysOf(this).comps['stdres'].currentResistance > 138; },
            },
            {
                msg: '第 7 步：将标准电阻调回 100Ω，旋转变送器零点(Z)旋钮，使温度显示回到 0℃ 左右。',
                mode: 'check',
                op: [
                    { type: 'observe', target: 'stdres', msg: '把标准电阻调回 100Ω', async act() { await _demoSetConfig(this, 'stdres', 'currentResistance', 100, '把标准电阻调回 100Ω（对应 0℃）'); await _sleep(800); } },
                    { type: 'knob', target: 'ttrans', part: 'zero', msg: '旋转零点(Z)旋钮，使温度显示回到 0℃ 左右', async act() { const tt = this.sys.comps['ttrans']; if (tt) { tt.zeroAdj = 0; if (tt.knobs && tt.knobs.zero) tt.knobs.zero.rotation(0); } await _sleep(3000); } },
                ],
                check() {
                    const s = _sysOf(this); const tt = s.comps['ttrans'];
                    return Math.abs(s.comps['stdres'].currentResistance - 100) < 3 && Math.abs(tt.zeroAdj) < 0.05;
                },
            },
            {
                msg: '第 8 步：将标准电阻调回约 138.5Ω，确认温度显示为 100℃ 左右，零点校准完成。',
                mode: 'check',
                op: [
                    { type: 'observe', target: 'ttrans', part: 'lcd', msg: '把标准电阻调到 138.51Ω，确认温度显示约 100℃', async act() { await _demoSetConfig(this, 'stdres', 'currentResistance', 138.51, '把标准电阻调到 138.51Ω（对应 100℃）'); await _sleep(2500); } },
                ],
                check() { const s = _sysOf(this); return Math.abs(s.comps['stdres'].currentResistance - 138.5) < 1.5 && Math.abs(s.comps['ttrans'].zeroAdj) < 0.05; },
            },
            {
                msg: '第 9 步：断开标准可调电阻，重新接回 PT100，确认温度显示正常。',
                mode: 'check',
                op: [
                    ..._unwireOps(WIRE_STDRES),
                    { type: 'observe', target: 'stdres', msg: '标准可调电阻移回原位', async act() { const sr = this.sys.comps['stdres']; sr && sr.group.position({ x: 1220, y: 340 }); await _sleep(500); } },
                    ..._wireOps(WIRE_PT100),
                ],
                check() {
                    const s = _sysOf(this);
                    return WIRE_PT100.every(m => _hasConn(s, m.conn.from, m.conn.to))
                        && WIRE_STDRES.every(m => !_hasConn(s, m.conn.from, m.conn.to));
                },
            },
            {
                msg: '第 10 步：系统切回自动模式，确认 偏差小于 10℃、报警已消音消闪。',
                mode: 'check',
                op: _autoStableOps(),
                check() { return _systemReadyCheck(_sysOf(this)); },
            },
            _quizStep(
                '第 11 步：温度变送器零点漂移知识',
                '用标准电阻 100Ω（0℃）和 138.5Ω（100℃）校验变送器：若仪表指示整体偏高一个固定值，但各点随电阻变化的变化量仍为 10℃，应判断为：',
                [
                    '零点漂移，应调整变送器零点(Z)旋钮',
                    '量程偏差，应调整变送器量程(S)旋钮',
                    'PT100 短路，应更换 PT100',
                    'PID 参数失调，应调整 P、I、D',
                ],
                0,
                '零点漂移表现为整条输入—输出曲线整体平移：各校准点的指示值都偏高（或偏低）同一个固定量，但随电阻变化的增量仍符合 10℃/3.85Ω 的线性关系。此时只需调整变送器零点(Z)旋钮，把曲线平移回正确位置。若是量程偏差，则各点增量会偏离 10℃（曲线斜率改变），需要调整量程(S)旋钮。',
            ),
        ],
    },

    // ══════════════════════════════════════════════════════════
    // 流程二：温度变送器量程偏差故障诊断（项目 6.3）
    // ══════════════════════════════════════════════════════════
    'ttrans-span': {
        id: 'ttrans-span',
        name: '2. 温度变送器量程偏差故障排除',
        steps: [
            {
                msg: '第 1 步：识别本次校准/诊断涉及的主要部件——温度变送器、标准可调电阻、PT100 与 PID 调节器。',
                mode: 'find',
                target: ['ttrans', 'stdres', 'pt', 'pid'],
                demoTarget: ['ttrans', 'stdres', 'pid'],
            },
            _readyStep(),
            _faultStep('第 3 步：通过「故障设置」界面设置「温度变送器量程偏差」故障。', 'ttrans-span', '打开「故障设置」界面，勾选「温度变送器量程偏差」，点击「应用设置」'),
            {
                msg: '第 4 步：PID 控制器切换到手动模式，阀位控制在 60~70%。',
                mode: 'check',
                op: _pidManualValveOps(65),
                check() {
                    const s = _sysOf(this); const p = s.comps['pid']; const v = s.comps['valve'];
                    return p.mode === 'MAN' && v.currentPos >= 0.6 && v.currentPos <= 0.72;
                },
            },
            {
                msg: '第 5 步：断开 PT100 接线，接入标准可调电阻。',
                mode: 'check',
                op: [
                    { type: 'observe', target: 'stdres', msg: '把标准可调电阻移到测试台旁', async act() { const sr = this.sys.comps['stdres']; sr && sr.group.position({ x: 130, y: 380 }); await _sleep(500); } },
                    ..._unwireOps(WIRE_PT100),
                    ..._wireOps(WIRE_STDRES),
                ],
                check() {
                    const s = _sysOf(this);
                    return WIRE_PT100.every(m => !_hasConn(s, m.conn.from, m.conn.to))
                        && WIRE_STDRES.every(m => _hasConn(s, m.conn.from, m.conn.to));
                },
            },
            {
                msg: '第 6 步：标准电阻每次增加约 3.85Ω，直到约 138.5Ω，确认温度指示值的增量不等于 10℃，判定为变送器量程偏差。',
                mode: 'check',
                op: [
                    { type: 'observe', target: 'ttrans', part: 'lcd', msg: '逐步增大标准电阻，观察温度显示增量偏离 10℃/3.85Ω', async act() { await _sweepStdRes(this, 10, 100, 3.851); await _sleep(2000); } },
                ],
                check() { return _sysOf(this).comps['stdres'].currentResistance > 138; },
            },
            {
                msg: '第 7 步：将标准电阻保持在 138.5Ω，旋转变送器量程(S)旋钮，使温度显示为 100℃ 左右。',
                mode: 'check',
                op: [
                    { type: 'observe', target: 'stdres', msg: '把标准电阻保持 138.51Ω', async act() { await _demoSetConfig(this, 'stdres', 'currentResistance', 138.51, '保持标准电阻为 138.51Ω（对应 100℃）'); await _sleep(800); } },
                    { type: 'knob', target: 'ttrans', part: 'span', msg: '旋转量程(S)旋钮，使温度显示回到 100℃ 左右', async act() { const tt = this.sys.comps['ttrans']; if (tt) { tt.spanAdj = 1; if (tt.knobs && tt.knobs.span) tt.knobs.span.rotation(0); } await _sleep(3000); } },
                ],
                check() {
                    const s = _sysOf(this); const tt = s.comps['ttrans'];
                    return Math.abs(s.comps['stdres'].currentResistance - 138.5) < 1.5 && Math.abs(tt.spanAdj - 1) < 0.05;
                },
            },
            {
                msg: '第 8 步：将标准电阻调回 100Ω，确认温度显示为 0℃ 左右；必要时再微调量程，反复 2~3 次。',
                mode: 'check',
                op: [{ type: 'observe', target: 'ttrans', part: 'lcd', msg: '把标准电阻调回 100Ω，确认温度显示约 0℃', async act() { await _demoSetConfig(this, 'stdres', 'currentResistance', 100, '把标准电阻调回 100Ω（对应 0℃）'); await _sleep(2500); } }],
                check() { const s = _sysOf(this); return Math.abs(s.comps['stdres'].currentResistance - 100) < 3 && Math.abs(s.comps['ttrans'].spanAdj - 1) < 0.05; },
            },
            {
                msg: '第 9 步：断开标准可调电阻，重新接回 PT100，确认温度显示正常。',
                mode: 'check',
                op: [
                    ..._unwireOps(WIRE_STDRES),
                    { type: 'observe', target: 'stdres', msg: '标准可调电阻移回原位', async act() { const sr = this.sys.comps['stdres']; sr && sr.group.position({ x: 1220, y: 340 }); await _sleep(500); } },
                    ..._wireOps(WIRE_PT100),
                ],
                check() {
                    const s = _sysOf(this);
                    return WIRE_PT100.every(m => _hasConn(s, m.conn.from, m.conn.to))
                        && WIRE_STDRES.every(m => !_hasConn(s, m.conn.from, m.conn.to));
                },
            },
            {
                msg: '第 10 步：系统切回自动模式，确认 偏差小于 10℃、报警已消音消闪。',
                mode: 'check',
                op: _autoStableOps(),
                check() { return _systemReadyCheck(_sysOf(this)); },
            },
            _quizStep(
                '第 11 步：温度变送器量程偏差知识考核',
                '用标准电阻校验变送器：100Ω 时显示约 0℃，但 138.5Ω 时显示不是 100℃（增量偏离 10℃/3.85Ω），应判断为：',
                [
                    '量程偏差，应调整变送器量程(S)旋钮',
                    '零点漂移，应调整变送器零点(Z)旋钮',
                    'PT100 断路，应更换 PT100',
                    'PID 参数失调，应调整 P、I、D',
                ],
                0,
                '量程偏差表现为输入—输出曲线斜率改变：不同校准点的增量不再符合 10℃/3.85Ω 的线性关系，而零点的指示可能仍接近正确。此时应调整变送器量程(S)旋钮，使 138.5Ω 对应 100℃；必要时再回到 100Ω 微调零点，反复 2~3 次，直到两点都准确。',
            ),
        ],
    },

};

// ═══════════════════════════════════════════════════════════════
// 组件配置（1920 × 1080 基准坐标）
// ═══════════════════════════════════════════════════════════════

export const componentConfigs = [
    // ── 被控对象与调节器 ──
    // PID 量程与被测温度量程一致（0~100℃），保证 PV 与变送器 LCD 显示相符；
    // split:false 使用普通 4~20mA 输出，经三通调节阀实现温度闭环控制。
    // 本冷却水系统为反作用式调节（温度偏高需开大阀门加强冷却），默认 direction:'REV'。
    { Class: PIDController, id: 'pid', x: 710, y: 20, LRV: 0, URV: 100, SV: 80, split: false, direction: 'REV', visible: true },
    { Class: CoolingSystem, id: 'pt', x: 180, y: 450, visible: true },
    { Class: TempTransmitter, id: 'ttrans', x: 150, y: 200, min: 0, max: 100, visible: true },
    { Class: Monitor, id: 'monitor', x: 850, y: 550, visible: true },

    // ── 冷却水管路与执行回路 ──
    { Class: Engine, id: 'engine', x: 400, y: 380, visible: true },
    { Class: Pump, id: 'pump', x: 30, y: 580, visible: true },
    { Class: TeeConnector, id: 'tconn', x: 20, y: 680, direction: 'right', visible: true },
    { Class: ElecValve, id: 'valve', x: 600, y: 660, visible: true },
    { Class: Cooler, id: 'cooler', x: 200, y: 800, visible: true },

    // ── 电源与测量 ──
    { Class: DCPower, id: 'dcpower', x: 1340, y: 80, voltage: 24, isOn: false, visible: true },
    { Class: Ground, id: 'gnd', x: 1380, y: 350, visible: true },
    { Class: AmpMeter, id: 'ampmeter', x: 400, y: 100, radius: 70, min: 0, max: 20, title: '输入电流表mA', visible: true },
    { Class: AmpMeter, id: 'ampmeter2', x: 1520, y: 600, radius: 70, min: 0, max: 20, title: '输出电流表mA', visible: true },
    { Class: VariResistor, id: 'stdres', x: 1320, y: 420, value: 385, cvalue: 100, visible: true },

    // ── 7 种标准仪表（默认隐藏，按需通过「选择仪表」调出）──
    { Class: Multimeter, id: 'multimeter', x: 1400, y: 530, visible: false },
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

export function initSlider(_sys) {
    if (!_sys) return;
    // 自动演示时只保留箭头指示，不闪亮整个组件
    _sys._noBlinkHighlight = true;
}

/** 工具栏「自动接线」：瞬时接好全部电路/管路 */
export function applyAllPresets() {
    const sys = _sysOf(this);
    if (!sys) return;
    _autoWire(sys);
}

/** 工具栏「启动系统」：复位 → 自动接线 → 上电 → 开泵开主机 → PID 自动 */
export async function applyStartSystem() {
    const sys = _sysOf(this);
    if (!sys) return;
    await _resetRig(sys);
    await _startSystem(sys);
}

/**
 * 5 点步进：手动模式步进 PID 输出（0/25/50/75/100%）；
 * 自动模式步进设定值（40/60/80/100/0℃）。
 */
export function fiveStep() {
    const sys = _sysOf(this);
    if (!sys) return;
    const pid = sys.comps['pid'];
    if (!pid) return;

    const steps = (pid.mode === 'MAN') ? [0, 25, 50, 75, 100] : [40, 60, 80, 100, 0];
    if (sys._coolStep === undefined || sys._coolStep >= steps.length) sys._coolStep = 0;

    if (pid.mode === 'MAN') pid.OUT = steps[sys._coolStep];
    else pid.SV = steps[sys._coolStep];

    sys._coolStep = (sys._coolStep + 1) % steps.length;
    sys.redrawAll && sys.redrawAll();
}
