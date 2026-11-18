// ═══════════════════════════════════════════════════════════════
// 空压机起停控制系统（真 PLC + 接触器控制电路）
//
// 页 1「空压机气路与机旁/接触器」：
//   lp1/lp2  机旁控制面板（手动/关/遥控旋钮 + 电机加热 + 报警灯；带真电气信号触点）
//   ac1/ac2  空气压缩机（mode=remote，遥控端 L/R）
//   cv1/cv2  单向截止阀
//   tee      三通接头（1#/2# 汇流至唯一空气瓶）
//   cab      空气瓶；teem/pm 出口测压支路；yt 双位压力继电器
//   coil1/coil2  接触器线圈（deviceid KM1/KM2）
//   aux1no/aux2no  接触器常开辅助触点 → 桥接 ac.L/ac.R
//   aux1nc/aux2nc  接触器常闭辅助触点
//   xpl1     跨页连接器（deviceid XPL，页 1 侧）
//
// 页 2「遥控与 PLC 控制」：
//   rp1/rp2  1#/2# 遥控面板（手动/自动旋钮 + 点动起动/停止；带真电气信号触点）
//   plc      西门子 S7-200 SMART ST20（作 SR20）
//   em1      EM DI08 扩展模块（保护信号按台区分）
//   dc24     24V 直流电源
//   xpl2     跨页连接器（deviceid XPL，页 2 侧）
//
// 控制原理：
//   机旁「遥控」+ 遥控面板「自动」→ PLC 按双位压力继电器自动起停接触器；
//   遥控面板「手动」→ 点动起动/停止经 PLC 起保停；
//   机旁「手动」→ 硬线直接接通接触器线圈（不经 PLC）；机旁「关」→ 硬线断开线圈；
//   接触器吸合 → 辅助常开触点桥接 ac.L/ac.R → 空压机运转；运行/停止灯由接触器触点驱动；
//   过电流/温度/油压 保护触头 → EM DI08 → PLC 输出报警灯 + 跳闸。
// ═══════════════════════════════════════════════════════════════

import { AirCompressor } from '../components/AirCompressor.js';
import { AirBottle } from '../components/AirBottle.js';
import { TeeConnector } from '../components/TeeConnector.js';
import { PressMeter } from '../components/PressMeter.js';
import { PressRelay } from '../components/PressRelay.js';
import { CheckValve } from '../components/CheckValve.js';
import { CompressorLocalPanel } from '../components/CompressorLocalPanel.js';
import { CompressorRemotePanel } from '../components/CompressorRemotePanel.js';
import { PageLink } from '../components/PageLink.js';
import { StandbyOrderSwitch } from '../components/StandbyOrderSwitch.js';
import { S7_200_SMART_ST20 } from '../components/S7_200_SMART_ST20.js';
import { STEP7PC } from '../components/STEP7PC.js';
import { S7_200_EM_DI08 } from '../components/S7200_EM_DI08.js';
import { DCPower } from '../components/DCPower.js';
import { Ground } from '../components/Gnd.js';
import { PotentialTerminal } from '../components/PotentialTerminal.js';
import { ContactorCoil } from '../device/ContactorCoil.js';
import { AuxNOContact } from '../device/AuxNOContact.js';
import { AuxNCContact } from '../device/AuxNCContact.js';

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

async function _clickPartUntil(comp, partId, pred, maxTimes = 6) {
    for (let i = 0; i < maxTimes; i++) {
        if (pred()) return true;
        _firePartClick(comp, partId);
        await _sleep(320);
    }
    return pred();
}

async function _wireOne(sys, conn) {
    if (!sys || !sys.connMgr || !conn) return;
    if (_hasConn(sys, conn.from, conn.to)) return;
    await sys.connMgr.addConnectionAnimated({ from: conn.from, to: conn.to, type: conn.type || 'wire', color: _wireColor(conn.from, conn.to) });
}

/**
 * 线色约定：
 *   · 接 PLC / EM 输入的信号 → 亮蓝色 (#00b0ff)
 *   · 由 PLC 输出驱动的信号 → 红色 (#d0021b)
 *   · 其它（电源、公共线、就地回路）→ 默认色
 */
function _wireColor(from, to) {
    const s = `${from}|${to}`;
    // PLC 输出（红色）：DQ 端子，或跨页通道 a2/a3（接 KM1/KM2 线圈）
    if (/plc_wire_dq/.test(s) || /xpl[12]_wire_a[23]\b/.test(s)) return '#d0021b';
    // PLC / EM 输入（亮蓝色）：DI、EM din、跨页通道 a4~a12、各面板开关输出
    if (/plc_wire_di/.test(s) || /em1_wire_din/.test(s)
        || /xpl[12]_wire_a(4|5|6|7|8|9|10|11|12)\b/.test(s)
        || /_wire_(rem_o|poc_o|ptp_o|pop_o|auto_o|sa_o|sb_o)\b/.test(s)
        || /yt_wire_(NC|COM)\b/.test(s)) return '#00b0ff';
    return null;
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
// PLC 程序（指令表）：起保停 + 双位自动 + 备用顺序选择 + 故障跳闸/报警
//   I0.0/I0.1/I0.2 = 1# 遥控面板 自动/起动/停止
//   I0.3 = 备用顺序开关（0=1-2 顺序，1# 主用；1=2-1 顺序，2# 主用）
//   I0.4/I0.5/I0.6 = 压力继电器NC / 1#机旁遥控 / 2#机旁遥控
//   I1.0/I1.1/I1.2 = 2# 遥控面板 自动/起动/停止
//   EM DI08: I2.0/2.1/2.2 = 1#过电流/温度/油压；I2.4/2.5/2.6 = 2#…
//   Q0.0 KM1  Q0.1 KM2  Q0.2~Q0.7 报警灯
//   自动时按备用顺序只起动一台；当前主用机组故障则自动切到另一台。
// ═══════════════════════════════════════════════════════════════

const PLC_PROGRAM = [
    '// 空压机起停控制（SR20 / ST20 + EM DI08）',
    '// 综合故障',
    'LD     I2.0',
    'O      I2.1',
    'O      I2.2',
    '=      M1.0',
    'LD     I2.4',
    'O      I2.5',
    'O      I2.6',
    '=      M1.1',
    '// 备用顺序：Duty1 = (NOT SEL OR Fault2) AND NOT Fault1',
    'LDN    I0.3',
    'LD     M1.1',
    'OLD',
    'AN     M1.0',
    '=      M2.0',
    '// Duty2 = (SEL OR Fault1) AND NOT Fault2',
    'LD     I0.3',
    'LD     M1.0',
    'OLD',
    'AN     M1.1',
    '=      M2.1',
    '// 1# 自动：压力低 且 1#遥控 且 1#面板自动 且 Duty1',
    'LD     I0.4',
    'A      I0.5',
    'A      I0.0',
    'A      M2.0',
    '=      M0.0',
    '// 1# 手动起保停（点动）',
    'LD     I0.1',
    'O      M0.1',
    'AN     I0.2',
    'A      I0.5',
    'AN     I0.0',
    '=      M0.1',
    '// 1# 输出',
    'LD     M0.0',
    'O      M0.1',
    'AN     M1.0',
    '=      Q0.0',
    '// 2# 自动：压力低 且 2#遥控 且 2#面板自动 且 Duty2',
    'LD     I0.4',
    'A      I0.6',
    'A      I1.0',
    'A      M2.1',
    '=      M0.2',
    '// 2# 手动起保停',
    'LD     I1.1',
    'O      M0.3',
    'AN     I1.2',
    'A      I0.6',
    'AN     I1.0',
    '=      M0.3',
    '// 2# 输出',
    'LD     M0.2',
    'O      M0.3',
    'AN     M1.1',
    '=      Q0.1',
    '// 报警灯输出',
    'LD     I2.0',
    '=      Q0.2',
    'LD     I2.1',
    '=      Q0.3',
    'LD     I2.2',
    '=      Q0.4',
    'LD     I2.4',
    '=      Q0.5',
    'LD     I2.5',
    '=      Q0.6',
    'LD     I2.6',
    '=      Q0.7',
    'END',
].join('\n');

// ═══════════════════════════════════════════════════════════════
// 管路 / 电路连线定义
// ═══════════════════════════════════════════════════════════════

const PIPE_META = [
    { conn: { from: 'ac1_pipe_o', to: 'cv1_pipe_i', type: 'pipe' }, target: 'ac1', ports: ['ac1_pipe_o', 'cv1_pipe_i'], msg: '气路①：1# 空压机排气口 → 1# 单向截止阀' },
    { conn: { from: 'cv1_pipe_o', to: 'tee_pipe_l', type: 'pipe' }, target: 'cv1', ports: ['cv1_pipe_o', 'tee_pipe_l'], msg: '气路②：1# 单向截止阀 → 三通接头上端' },
    { conn: { from: 'ac2_pipe_o', to: 'cv2_pipe_i', type: 'pipe' }, target: 'ac2', ports: ['ac2_pipe_o', 'cv2_pipe_i'], msg: '气路③：2# 空压机排气口 → 2# 单向截止阀' },
    { conn: { from: 'cv2_pipe_o', to: 'tee_pipe_r', type: 'pipe' }, target: 'cv2', ports: ['cv2_pipe_o', 'tee_pipe_r'], msg: '气路④：2# 单向截止阀 → 三通接头下端' },
    { conn: { from: 'tee_pipe_u', to: 'cab_pipe_i', type: 'pipe' }, target: 'tee', ports: ['tee_pipe_u', 'cab_pipe_i'], msg: '气路⑤：三通接头右端 → 空气瓶入口（左下，两机汇流）' },
    { conn: { from: 'cab_pipe_o', to: 'teem_pipe_l', type: 'pipe' }, target: 'cab', ports: ['cab_pipe_o', 'teem_pipe_l'], msg: '气路⑥：空气瓶出口（右上）→ 出口三通左端' },
    { conn: { from: 'teem_pipe_u', to: 'yt_pipe_i', type: 'pipe' }, target: 'teem', ports: ['teem_pipe_u', 'yt_pipe_i'], msg: '测压①：出口三通上端 → 双位压力继电器' },
    { conn: { from: 'teem_pipe_r', to: 'pm_pipe_i', type: 'pipe' }, target: 'teem', ports: ['teem_pipe_r', 'pm_pipe_i'], msg: '测压②：出口三通右端 → 压力表' },
];

const WIRE_META = [
    // ── PLC 本体供电 ──
    { conn: { from: 'dc24_wire_p', to: 'plc_wire_24v', type: 'wire' }, target: 'dc24', ports: ['dc24_wire_p', 'plc_wire_24v'], msg: '供电①：24V → PLC 传感器电源 24V' },
    { conn: { from: 'dc24_wire_n', to: 'plc_wire_v0', type: 'wire' }, target: 'dc24', ports: ['dc24_wire_n', 'plc_wire_v0'], msg: '供电②：0V → PLC 传感器电源 0V' },
    { conn: { from: 'plc_wire_1m', to: 'plc_wire_v0', type: 'wire' }, target: 'plc', ports: ['plc_wire_1m', 'plc_wire_v0'], msg: '供电③：PLC 输入公共端 1M → 0V' },
    { conn: { from: 'plc_wire_1l', to: 'dc24_wire_p', type: 'wire' }, target: 'plc', ports: ['plc_wire_1l', 'dc24_wire_p'], msg: '供电④：PLC 输出负载电源 1L+ → 24V' },
    { conn: { from: 'step7pc_wire_lan', to: 'plc_wire_lan', type: 'wire' }, target: 'step7pc', ports: ['step7pc_wire_lan', 'plc_wire_lan'], msg: '通信：上位机（STEP7）网口 → PLC 以太网口（监控/编程）' },

    // ── 跨页电源母线（页 2 → 页 1）──
    { conn: { from: 'dc24_wire_p', to: 'xpl2_wire_a1', type: 'wire' }, target: 'dc24', ports: ['dc24_wire_p', 'xpl2_wire_a1'], msg: '跨页①：24V → 跨页连接器 A1（页 2）' },

    // ── 各面板开关公共端接 24V 电位端子 ──
    { conn: { from: 'p24-lp1_wire_p', to: 'lp1_wire_sw_com', type: 'wire' }, target: 'lp1', ports: ['p24-lp1_wire_p', 'lp1_wire_sw_com'], msg: '24V①：1# 机旁面板 24V 电位端子 → 开关公共端' },
    { conn: { from: 'p24-lp2_wire_p', to: 'lp2_wire_sw_com', type: 'wire' }, target: 'lp2', ports: ['p24-lp2_wire_p', 'lp2_wire_sw_com'], msg: '24V②：2# 机旁面板 24V 电位端子 → 开关公共端' },
    { conn: { from: 'p24-rp1_wire_p', to: 'rp1_wire_sw_com', type: 'wire' }, target: 'rp1', ports: ['p24-rp1_wire_p', 'rp1_wire_sw_com'], msg: '24V③：1# 遥控面板 24V 电位端子 → 开关公共端' },
    { conn: { from: 'p24-rp2_wire_p', to: 'rp2_wire_sw_com', type: 'wire' }, target: 'rp2', ports: ['p24-rp2_wire_p', 'rp2_wire_sw_com'], msg: '24V④：2# 遥控面板 24V 电位端子 → 开关公共端' },
    { conn: { from: 'p24-yt_wire_p', to: 'yt_wire_COM', type: 'wire' }, target: 'yt', ports: ['p24-yt_wire_p', 'yt_wire_COM'], msg: '24V⑤：压力开关 24V 电位端子 → 压力开关 COM 端（另一端 NC 去 PLC）' },

    // ── 接地：接触器线圈返回端接 0V（参考零电位）──
    { conn: { from: 'coil1_wire_a2', to: 'gnd1_wire_gnd', type: 'wire' }, target: 'coil1', ports: ['coil1_wire_a2', 'gnd1_wire_gnd'], msg: '接地①：KM1 线圈 A2 → 地' },
    { conn: { from: 'coil2_wire_a2', to: 'gnd2_wire_gnd', type: 'wire' }, target: 'coil2', ports: ['coil2_wire_a2', 'gnd2_wire_gnd'], msg: '接地②：KM2 线圈 A2 → 地' },
    { conn: { from: 'dc24_wire_n', to: 'gnd0_wire_gnd', type: 'wire' }, target: 'dc24', ports: ['dc24_wire_n', 'gnd0_wire_gnd'], msg: '接地③：0V → 地（参考零电位）' },

    // ── 1# 接触器线圈回路（KM1）：手动直驱 ∥ PLC 输出；线圈另一端接地 ──
    { conn: { from: 'lp1_wire_man_o', to: 'coil1_wire_a1', type: 'wire' }, target: 'lp1', ports: ['lp1_wire_man_o', 'coil1_wire_a1'], msg: 'KM1①：机旁「手动」输出 → KM1 线圈 A1（就地直驱，仅此一个线圈触点）' },
    { conn: { from: 'xpl1_wire_a2', to: 'coil1_wire_a1', type: 'wire' }, target: 'coil1', ports: ['xpl1_wire_a2', 'coil1_wire_a1'], msg: 'KM1②：跨页连接器 A2（PLC Q0.0）→ KM1 线圈 A1（远方驱动）' },
    { conn: { from: 'xpl2_wire_a2', to: 'plc_wire_dq00', type: 'wire' }, target: 'plc', ports: ['xpl2_wire_a2', 'plc_wire_dq00'], msg: 'KM1③：PLC Q0.0 → 跨页连接器 A2' },

    // ── 2# 接触器线圈回路（KM2）──
    { conn: { from: 'lp2_wire_man_o', to: 'coil2_wire_a1', type: 'wire' }, target: 'lp2', ports: ['lp2_wire_man_o', 'coil2_wire_a1'], msg: 'KM2①：机旁「手动」输出 → KM2 线圈 A1' },
    { conn: { from: 'xpl1_wire_a3', to: 'coil2_wire_a1', type: 'wire' }, target: 'coil2', ports: ['xpl1_wire_a3', 'coil2_wire_a1'], msg: 'KM2②：跨页连接器 A3（PLC Q0.1）→ KM2 线圈 A1' },
    { conn: { from: 'xpl2_wire_a3', to: 'plc_wire_dq01', type: 'wire' }, target: 'plc', ports: ['xpl2_wire_a3', 'plc_wire_dq01'], msg: 'KM2③：PLC Q0.1 → 跨页连接器 A3' },

    // ── 接触器辅助触点 → 空压机遥控端 L/R ──
    { conn: { from: 'aux1no_wire_com', to: 'ac1_wire_l', type: 'wire' }, target: 'aux1no', ports: ['aux1no_wire_com', 'ac1_wire_l'], msg: 'KM1⑤：辅助常开 COM → 1# 空压机控制端 L' },
    { conn: { from: 'aux1no_wire_no', to: 'ac1_wire_r', type: 'wire' }, target: 'aux1no', ports: ['aux1no_wire_no', 'ac1_wire_r'], msg: 'KM1⑥：辅助常开 NO → 1# 空压机控制端 R（吸合即运转）' },
    { conn: { from: 'aux2no_wire_com', to: 'ac2_wire_l', type: 'wire' }, target: 'aux2no', ports: ['aux2no_wire_com', 'ac2_wire_l'], msg: 'KM2⑤：辅助常开 COM → 2# 空压机控制端 L' },
    { conn: { from: 'aux2no_wire_no', to: 'ac2_wire_r', type: 'wire' }, target: 'aux2no', ports: ['aux2no_wire_no', 'ac2_wire_r'], msg: 'KM2⑥：辅助常开 NO → 2# 空压机控制端 R' },

    // ── 压力继电器 → PLC 输入 ──
    { conn: { from: 'yt_wire_NC', to: 'xpl1_wire_a4', type: 'wire' }, target: 'yt', ports: ['yt_wire_NC', 'xpl1_wire_a4'], msg: '信号①：压力继电器 NC → 跨页连接器 A4' },
    { conn: { from: 'xpl2_wire_a4', to: 'plc_wire_di04', type: 'wire' }, target: 'plc', ports: ['xpl2_wire_a4', 'plc_wire_di04'], msg: '信号③：跨页连接器 A4 → PLC DI0.4' },

    // ── 机旁「遥控」信号 → PLC 输入 ──
    { conn: { from: 'lp1_wire_rem_o', to: 'xpl1_wire_a5', type: 'wire' }, target: 'lp1', ports: ['lp1_wire_rem_o', 'xpl1_wire_a5'], msg: '信号④：1# 机旁遥控 → 跨页连接器 A5' },
    { conn: { from: 'xpl2_wire_a5', to: 'plc_wire_di05', type: 'wire' }, target: 'plc', ports: ['xpl2_wire_a5', 'plc_wire_di05'], msg: '信号⑤：跨页连接器 A5 → PLC DI0.5' },
    { conn: { from: 'lp2_wire_rem_o', to: 'xpl1_wire_a6', type: 'wire' }, target: 'lp2', ports: ['lp2_wire_rem_o', 'xpl1_wire_a6'], msg: '信号⑥：2# 机旁遥控 → 跨页连接器 A6' },
    { conn: { from: 'xpl2_wire_a6', to: 'plc_wire_di06', type: 'wire' }, target: 'plc', ports: ['xpl2_wire_a6', 'plc_wire_di06'], msg: '信号⑦：跨页连接器 A6 → PLC DI0.6' },

    // ── 保护触头 → EM DI08（跨页，按台区分）──
    { conn: { from: 'lp1_wire_poc_o', to: 'xpl1_wire_a7', type: 'wire' }, target: 'lp1', ports: ['lp1_wire_poc_o', 'xpl1_wire_a7'], msg: '保护①：1# 过电流 → 跨页连接器 A7' },
    { conn: { from: 'xpl2_wire_a7', to: 'em1_wire_din0', type: 'wire' }, target: 'em1', ports: ['xpl2_wire_a7', 'em1_wire_din0'], msg: '保护②：跨页连接器 A7 → EM DI08 通道0（I2.0）' },
    { conn: { from: 'lp1_wire_ptp_o', to: 'xpl1_wire_a8', type: 'wire' }, target: 'lp1', ports: ['lp1_wire_ptp_o', 'xpl1_wire_a8'], msg: '保护③：1# 温度 → 跨页连接器 A8' },
    { conn: { from: 'xpl2_wire_a8', to: 'em1_wire_din1', type: 'wire' }, target: 'em1', ports: ['xpl2_wire_a8', 'em1_wire_din1'], msg: '保护④：跨页连接器 A8 → EM DI08 通道1（I2.1）' },
    { conn: { from: 'lp1_wire_pop_o', to: 'xpl1_wire_a9', type: 'wire' }, target: 'lp1', ports: ['lp1_wire_pop_o', 'xpl1_wire_a9'], msg: '保护⑤：1# 油压 → 跨页连接器 A9' },
    { conn: { from: 'xpl2_wire_a9', to: 'em1_wire_din2', type: 'wire' }, target: 'em1', ports: ['xpl2_wire_a9', 'em1_wire_din2'], msg: '保护⑥：跨页连接器 A9 → EM DI08 通道2（I2.2）' },
    { conn: { from: 'lp2_wire_poc_o', to: 'xpl1_wire_a10', type: 'wire' }, target: 'lp2', ports: ['lp2_wire_poc_o', 'xpl1_wire_a10'], msg: '保护⑦：2# 过电流 → 跨页连接器 A10' },
    { conn: { from: 'xpl2_wire_a10', to: 'em1_wire_din4', type: 'wire' }, target: 'em1', ports: ['xpl2_wire_a10', 'em1_wire_din4'], msg: '保护⑧：跨页连接器 A10 → EM DI08 通道4（I2.4）' },
    { conn: { from: 'lp2_wire_ptp_o', to: 'xpl1_wire_a11', type: 'wire' }, target: 'lp2', ports: ['lp2_wire_ptp_o', 'xpl1_wire_a11'], msg: '保护⑨：2# 温度 → 跨页连接器 A11' },
    { conn: { from: 'xpl2_wire_a11', to: 'em1_wire_din5', type: 'wire' }, target: 'em1', ports: ['xpl2_wire_a11', 'em1_wire_din5'], msg: '保护⑩：跨页连接器 A11 → EM DI08 通道5（I2.5）' },
    { conn: { from: 'lp2_wire_pop_o', to: 'xpl1_wire_a12', type: 'wire' }, target: 'lp2', ports: ['lp2_wire_pop_o', 'xpl1_wire_a12'], msg: '保护⑪：2# 油压 → 跨页连接器 A12' },
    { conn: { from: 'xpl2_wire_a12', to: 'em1_wire_din6', type: 'wire' }, target: 'em1', ports: ['xpl2_wire_a12', 'em1_wire_din6'], msg: '保护⑫：跨页连接器 A12 → EM DI08 通道6（I2.6）' },

    // ── PLC 输出 → 机旁报警灯已改为面板内部逻辑，不再对外引线 ──

    // ── 遥控面板开关（公共端由拓扑直接接 24V，无需引线）──
    { conn: { from: 'rp1_wire_auto_o', to: 'plc_wire_di00', type: 'wire' }, target: 'rp1', ports: ['rp1_wire_auto_o', 'plc_wire_di00'], msg: '遥控②：1# 遥控面板「自动」→ PLC DI0.0' },
    { conn: { from: 'rp1_wire_sa_o', to: 'plc_wire_di01', type: 'wire' }, target: 'rp1', ports: ['rp1_wire_sa_o', 'plc_wire_di01'], msg: '遥控③：1# 遥控面板「起动」→ PLC DI0.1' },
    { conn: { from: 'rp1_wire_sb_o', to: 'plc_wire_di02', type: 'wire' }, target: 'rp1', ports: ['rp1_wire_sb_o', 'plc_wire_di02'], msg: '遥控④：1# 遥控面板「停止」→ PLC DI0.2' },
    { conn: { from: 'rp2_wire_auto_o', to: 'plc_wire_di10', type: 'wire' }, target: 'rp2', ports: ['rp2_wire_auto_o', 'plc_wire_di10'], msg: '遥控⑥：2# 遥控面板「自动」→ PLC DI1.0' },
    { conn: { from: 'rp2_wire_sa_o', to: 'plc_wire_di11', type: 'wire' }, target: 'rp2', ports: ['rp2_wire_sa_o', 'plc_wire_di11'], msg: '遥控⑦：2# 遥控面板「起动」→ PLC DI1.1' },
    { conn: { from: 'rp2_wire_sb_o', to: 'plc_wire_di12', type: 'wire' }, target: 'rp2', ports: ['rp2_wire_sb_o', 'plc_wire_di12'], msg: '遥控⑧：2# 遥控面板「停止」→ PLC DI1.2' },

    // ── 备用顺序选择开关：左端接 24V 电位端子，右端接 PLC DI0.3 ──
    { conn: { from: 'p24-order_wire_p', to: 'ordsw_wire_l', type: 'wire' }, target: 'p24-order', ports: ['p24-order_wire_p', 'ordsw_wire_l'], msg: '顺序①：24V 电位端子 → 备用顺序开关 左端' },
    { conn: { from: 'ordsw_wire_r', to: 'plc_wire_di03', type: 'wire' }, target: 'ordsw', ports: ['ordsw_wire_r', 'plc_wire_di03'], msg: '顺序②：备用顺序开关 右端 → PLC DI0.3（1-2 断开 / 2-1 接通）' },
];

const ALL_META = [...PIPE_META, ...WIRE_META];

function _wireOps(meta) {
    return meta.map(m => ({
        type: 'observe', target: m.target, msg: m.msg,
        ports: [m.conn.from, m.conn.to],
        async act() { await _wireOne(this.sys, m.conn); },
    }));
}

// ═══════════════════════════════════════════════════════════════
// 内部初始化
// ═══════════════════════════════════════════════════════════════

async function _resetRig(sys) {
    if (!sys) return;
    if (Array.isArray(sys.conns)) { sys.conns.length = 0; sys.redrawAll && sys.redrawAll(); }

    Object.values(sys.FAULT_CONFIG || {}).forEach(f => { try { f.repair && f.repair(); } catch (e) { /* ignore */ } });

    ['ac1', 'ac2'].forEach(id => {
        const ac = _comp(sys, id);
        if (!ac) return;
        ac.mode = 'remote';
        ac._knobTarget = 45;
        ac.running = false; ac.power = 0; ac.targetPower = 0;
        ac._remoteCmd = null;
    });
    ['cv1', 'cv2'].forEach(id => {
        const cv = _comp(sys, id);
        if (cv) { cv.isOpen = false; cv._locked = false; if (cv.update) cv.update(); }
    });
    const cab = _comp(sys, 'cab');
    if (cab) { cab.isConsuming = true; if (cab.setPressure) cab.setPressure(3.2); }
    const yt = _comp(sys, 'yt');
    if (yt) yt._contactFaultOpen = false;
    ['lp1', 'lp2'].forEach(id => {
        const lp = _comp(sys, id);
        if (lp) { lp.setCtrlMode && lp.setCtrlMode('off'); lp.setHeater && lp.setHeater(false); lp.clearAlarms && lp.clearAlarms(); }
    });
    ['rp1', 'rp2'].forEach(id => {
        const rp = _comp(sys, id);
        if (rp) { rp.auto = false; rp.releaseStart && rp.releaseStart(); rp.releaseStop && rp.releaseStop(); rp._syncVisuals && rp._syncVisuals(); }
    });

    sys.redrawAll && sys.redrawAll();
    await _sleep(300);
}

function _autoWire(sys) {
    if (!sys || !sys.connMgr) return;
    sys.conns.length = 0;
    ALL_META.forEach(m => {
        try { sys.connMgr.addConn({ from: m.conn.from, to: m.conn.to, type: m.conn.type, color: _wireColor(m.conn.from, m.conn.to) }); }
        catch (e) { /* ignore */ }
    });
    sys.redrawAll && sys.redrawAll();
}

/** 系统起动：接线 → 开阀 → 机旁遥控 → 遥控自动 → PLC RUN → 气瓶耗气 */
async function _startSystem(sys) {
    if (!sys) return;
    _autoWire(sys);

    ['cv1', 'cv2'].forEach(id => { const cv = _comp(sys, id); if (cv && !cv._locked) { cv.isOpen = true; cv.update && cv.update(); } });
    ['ac1', 'ac2'].forEach(id => { const ac = _comp(sys, id); if (ac) { ac.mode = 'remote'; ac._knobTarget = 45; } });
    ['lp1', 'lp2'].forEach(id => { const lp = _comp(sys, id); lp && lp.setCtrlMode && lp.setCtrlMode('remote'); });
    ['rp1', 'rp2'].forEach(id => { const rp = _comp(sys, id); if (rp) { rp.auto = true; rp._syncVisuals && rp._syncVisuals(); } });

    const plc = _comp(sys, 'plc');
    if (plc) {
        if (typeof plc.setProgram === 'function') plc.setProgram(PLC_PROGRAM);
        if (plc.mode !== 'RUN' && typeof plc.toggleMode === 'function') plc.toggleMode();
    }
    const dc = _comp(sys, 'dc24');
    if (dc) { dc.isOn = true; dc.voltage = 24; }

    const cab = _comp(sys, 'cab');
    if (cab) { cab.isConsuming = true; cab.consumptionRate = 5.0; }

    sys.redrawAll && sys.redrawAll();
    await _sleep(900);
}

// ═══════════════════════════════════════════════════════════════
// 故障配置（走故障界面）
// ═══════════════════════════════════════════════════════════════

export const FAULT_CONFIGS = {
    'comp1-oc': {
        id: 'comp1-oc', name: '1. 1# 空压机过电流', system: '起停控制',
        check() { const s = window.sys; const l = s && s.comps && s.comps['lp1']; return !!(l && l.protection.oc === true); },
        trigger() { const s = window.sys; const l = s && s.comps && s.comps['lp1']; if (l) { l.setProtection('oc', true); s.redrawAll && s.redrawAll(); } },
        repair() { const s = window.sys; const l = s && s.comps && s.comps['lp1']; if (l && l.protection.oc) { l.setProtection('oc', false); s.redrawAll && s.redrawAll(); } },
    },
    'comp2-temp': {
        id: 'comp2-temp', name: '2. 2# 空压机排气温度高', system: '起停控制',
        check() { const s = window.sys; const l = s && s.comps && s.comps['lp2']; return !!(l && l.protection.temp === true); },
        trigger() { const s = window.sys; const l = s && s.comps && s.comps['lp2']; if (l) { l.setProtection('temp', true); s.redrawAll && s.redrawAll(); } },
        repair() { const s = window.sys; const l = s && s.comps && s.comps['lp2']; if (l && l.protection.temp) { l.setProtection('temp', false); s.redrawAll && s.redrawAll(); } },
    },
    'comp-oil': {
        id: 'comp-oil', name: '3. 空压机润滑油压低', system: '起停控制',
        check() { const s = window.sys; const l = s && s.comps && s.comps['lp1']; return !!(l && l.protection.op === true); },
        trigger() { const s = window.sys; const l = s && s.comps && s.comps['lp1']; if (l) { l.setProtection('op', true); s.redrawAll && s.redrawAll(); } },
        repair() { const s = window.sys; const l = s && s.comps && s.comps['lp1']; if (l && l.protection.op) { l.setProtection('op', false); s.redrawAll && s.redrawAll(); } },
    },
    'valve1-stuck': {
        id: 'valve1-stuck', name: '4. 1# 单向截止阀卡滞（截止）', system: '气路',
        check() { const s = window.sys; const c = s && s.comps && s.comps['cv1']; return !!(c && c._locked === true); },
        trigger() { const s = window.sys; const c = s && s.comps && s.comps['cv1']; if (c) { c._locked = true; c.isOpen = false; c.update && c.update(); s.redrawAll && s.redrawAll(); } },
        repair() { const s = window.sys; const c = s && s.comps && s.comps['cv1']; if (c && c._locked) { c._locked = false; s.redrawAll && s.redrawAll(); } },
    },
    'relay-fail': {
        id: 'relay-fail', name: '5. 双位压力继电器触头失效', system: '控制回路',
        check() { const s = window.sys; const c = s && s.comps && s.comps['yt']; return !!(c && c._contactFaultOpen === true); },
        trigger() { const s = window.sys; const c = s && s.comps && s.comps['yt']; if (c) { c._contactFaultOpen = true; if (c.update) c.update(c.pressure); s.redrawAll && s.redrawAll(); } },
        repair() { const s = window.sys; const c = s && s.comps && s.comps['yt']; if (c && c._contactFaultOpen) { c._contactFaultOpen = false; if (c.update) c.update(c.pressure); s.redrawAll && s.redrawAll(); } },
    },
};

// ═══════════════════════════════════════════════════════════════
// 工作流
// ═══════════════════════════════════════════════════════════════

function _quizStep(msg, question, options, answer, analysis) {
    return { msg, mode: 'quiz', quizConfig: { question, options, answer, analysis } };
}

function _faultStep(msg, faultId, tip, ownerComp) {
    return {
        msg, mode: 'check',
        op: [
            { type: 'fault', fault: faultId, msg: tip || msg, async act() { await _sleep(400); } },
            { type: 'observe', target: ownerComp || 'lp1', msg: '观察对应机组接触器释放停机，机旁面板报警指示灯点亮', async act() { await _sleep(3500); } },
        ],
        check() { const s = _sysOf(this); const f = s.FAULT_CONFIG[faultId]; return !!(f && f.check()); },
    };
}

function _repairStep(msg, faultId, tip, ownerComp) {
    return {
        msg, mode: 'check',
        op: [
            { type: 'fault', fault: faultId, repair: true, msg: tip || msg, async act() { await _sleep(400); } },
            { type: 'observe', target: ownerComp || 'lp1', msg: '观察报警消失，机组恢复自动运行', async act() { await _sleep(2500); } },
        ],
        check() { const s = _sysOf(this); const f = s.FAULT_CONFIG[faultId]; return !!(f && !f.check()); },
    };
}

export const PROJECT_WORKFLOWS = {
    // ══════════════════════════════════════════════════════
    // 流程：空压机的机旁起停和遥控手动起停
    // ══════════════════════════════════════════════════════
    'comp-startstop': {
        id: 'comp-startstop',
        name: '1. 空压机的机旁起停和遥控手动起停',
        steps: [
            {
                msg: '第 1 步：认识 1# 空压机的机旁控制面板（手动/关/遥控旋钮、运行与电机加热指示灯、报警灯、开关与接线端子）。',
                mode: 'find',
                target: ['lp1'],
                demoTarget: ['lp1'],
            },
            {
                msg: '第 2 步：认识 1# 空压机的遥控面板（遥控指示灯、运行/停止、手动-自动选择旋钮）。',
                mode: 'find',
                target: ['rp1'],
                demoTarget: ['rp1'],
            },
            {
                msg: '第 3 步：点击工具栏「自动接线」，接好所有线路和管路。',
                mode: 'check',
                op: [
                    { type: 'wire', button: 'btnAutoWire', target: 'plc', flashMs: 900, holdMs: 300,
                      msg: '点击工具栏「自动接线」按钮，接好全部气路与电路',
                      async act() { const s = _sysOf(this); try { await _resetRig(s); } finally { _autoWire(s); } await _sleep(800); } },
                ],
                check() {
                    const s = _sysOf(this);
                    return ALL_META.every(m => _hasConn(s, m.conn.from, m.conn.to));
                },
            },
            {
                msg: '第 4 步：开启 1# 空压机出口的截止阀（点击阀体由「截止」切到「导通」）。',
                mode: 'check',
                op: [
                    { type: 'switch', target: 'cv1', part: 'body', msg: '点击 1# 单向截止阀阀体，由「截止」切到「导通」',
                      async act() { const c = _comp(_sysOf(this), 'cv1'); if (c && !c.isOpen) { _firePartClick(c, 'body'); await _sleep(600); } } },
                ],
                check() { const s = _sysOf(this); const c = _comp(s, 'cv1'); return !!(c && c.isOpen); },
            },
            {
                msg: '第 5 步：在机旁控制面板上把「空压机控制」旋钮切到「手动」，开启 1# 空压机。',
                mode: 'check',
                op: [
                    { type: 'switch', target: 'lp1', part: 'knob-ctrl', msg: '点击 1# 机旁「空压机控制」旋钮，切到「手动」',
                      async act() { const s = _sysOf(this); await _clickPartUntil(_comp(s, 'lp1'), 'knob-ctrl', () => _comp(s, 'lp1').ctrlMode === 'manual'); } },
                    { type: 'observe', target: 'ac1', msg: '观察 KM1 接触器吸合、1# 空压机运行',
                      async act() { const s = _sysOf(this); await _waitFor(s, x => { const a = _comp(x, 'ac1'); return a && a.running; }, 8000, 200); await _sleep(2000); } },
                ],
                check() { const s = _sysOf(this); const a = _comp(s, 'ac1'); return !!(a && a.running === true); },
            },
            {
                msg: '第 6 步：待空气瓶压力大于 3.5 MPa，把机旁旋钮切到「关」，停止空压机。',
                mode: 'check',
                op: [
                    { type: 'observe', target: 'cab', part: 'lcd', msg: '观察空气瓶压力上升至 3.5 MPa 以上',
                      async act() { const s = _sysOf(this); await _waitFor(s, x => { const c = _comp(x, 'cab'); return c && c.getPressure() > 3.5; }, 40000, 300); await _sleep(1200); } },
                    { type: 'switch', target: 'lp1', part: 'knob-ctrl', msg: '点击 1# 机旁旋钮切到「关」，停止空压机',
                      async act() { const s = _sysOf(this); await _clickPartUntil(_comp(s, 'lp1'), 'knob-ctrl', () => _comp(s, 'lp1').ctrlMode === 'off'); await _sleep(1500); } },
                ],
                check() {
                    const s = _sysOf(this);
                    const c = _comp(s, 'cab'), a = _comp(s, 'ac1');
                    return !!(c && c.getPressure() > 3.5 && a && a.running === false);
                },
            },
            {
                msg: '第 7 步：将 1# 空压机转到「遥控」位（交由遥控面板 / PLC 控制）。',
                mode: 'check',
                op: [
                    { type: 'switch', target: 'lp1', part: 'knob-ctrl', msg: '点击 1# 机旁旋钮，切到「遥控」',
                      async act() { const s = _sysOf(this); await _clickPartUntil(_comp(s, 'lp1'), 'knob-ctrl', () => _comp(s, 'lp1').ctrlMode === 'remote'); await _sleep(600); } },
                ],
                check() { const s = _sysOf(this); const l = _comp(s, 'lp1'); return !!(l && l.ctrlMode === 'remote'); },
            },
            {
                msg: '第 8 步：在 1# 遥控面板上选择「手动」，点击「运行」按钮开启空压机。',
                mode: 'check',
                op: [
                    { type: 'switch', target: 'rp1', part: 'knob-ma', msg: '1# 遥控面板选择「手动」档',
                      async act() { const s = _sysOf(this); await _clickPartUntil(_comp(s, 'rp1'), 'knob-ma', () => _comp(s, 'rp1').auto === false, 3); } },
                    { type: 'switch', target: 'rp1', part: 'btn-run', msg: '点动点击 1# 遥控面板「运行」按钮（接通 PLC 起动输入）',
                      async act() { const s = _sysOf(this); const rp = _comp(s, 'rp1'); rp.pressStart(); await _sleep(600); rp.releaseStart(); await _sleep(1500); } },
                    { type: 'observe', target: 'ac1', msg: '观察 PLC 起保停自锁、KM1 吸合、1# 空压机运行',
                      async act() { const s = _sysOf(this); await _waitFor(s, x => { const a = _comp(x, 'ac1'); return a && a.running; }, 8000, 200); await _sleep(1800); } },
                ],
                check() { const s = _sysOf(this); const a = _comp(s, 'ac1'); return !!(a && a.running === true); },
            },
            {
                msg: '第 9 步：在 1# 遥控面板上点击「停止」按钮，遥控停止空压机。',
                mode: 'check',
                op: [
                    { type: 'switch', target: 'rp1', part: 'btn-stop', msg: '点动点击 1# 遥控面板「停止」按钮',
                      async act() { const s = _sysOf(this); const rp = _comp(s, 'rp1'); rp.pressStop(); await _sleep(600); rp.releaseStop(); await _sleep(1500); } },
                    { type: 'observe', target: 'ac1', msg: '观察 KM1 释放、1# 空压机停止',
                      async act() { const s = _sysOf(this); await _waitFor(s, x => { const a = _comp(x, 'ac1'); return a && !a.running; }, 8000, 200); await _sleep(1200); } },
                ],
                check() { const s = _sysOf(this); const a = _comp(s, 'ac1'); return !!(a && a.running === false); },
            },
        ],
    },

    // ══════════════════════════════════════════════════════
    // 流程二：空压机的自动起停控制
    // ══════════════════════════════════════════════════════
    'comp-autostart': {
        id: 'comp-autostart',
        name: '2. 空压机的自动起停控制',
        steps: [
            {
                msg: '第 1 步：点击工具栏「自动接线」接好所有线路，并打开 1#、2# 空压机出口的截止阀。',
                mode: 'check',
                op: [
                    { type: 'wire', button: 'btnAutoWire', target: 'plc', flashMs: 900, holdMs: 300,
                      msg: '点击工具栏「自动接线」按钮，接好全部气路与电路',
                      async act() {
                          const s = _sysOf(this);
                          try { await _resetRig(s); } finally { _autoWire(s); }
                          s._wf2obs = null;
                          await _sleep(700);
                      } },
                    { type: 'switch', target: 'cv1', part: 'body', msg: '打开 1# 空压机出口截止阀（点击阀体由「截止」切到「导通」）',
                      async act() { const c = _comp(_sysOf(this), 'cv1'); if (c && !c.isOpen) { _firePartClick(c, 'body'); await _sleep(600); } } },
                    { type: 'switch', target: 'cv2', part: 'body', msg: '打开 2# 空压机出口截止阀（点击阀体由「截止」切到「导通」）',
                      async act() { const c = _comp(_sysOf(this), 'cv2'); if (c && !c.isOpen) { _firePartClick(c, 'body'); await _sleep(600); } } },
                ],
                check() {
                    const s = _sysOf(this);
                    const cv1 = _comp(s, 'cv1'), cv2 = _comp(s, 'cv2');
                    return ALL_META.every(m => _hasConn(s, m.conn.from, m.conn.to))
                        && !!(cv1 && cv1.isOpen && cv2 && cv2.isOpen);
                },
            },
            {
                msg: '第 2 步：将 1#、2# 空压机的模式都转为「遥控」（机旁「空压机控制」旋钮切到遥控）。',
                mode: 'check',
                op: [
                    { type: 'switch', target: 'lp1', part: 'knob-ctrl', msg: '1# 机旁旋钮切到「遥控」',
                      async act() { const s = _sysOf(this); await _clickPartUntil(_comp(s, 'lp1'), 'knob-ctrl', () => _comp(s, 'lp1').ctrlMode === 'remote'); } },
                    { type: 'switch', target: 'lp2', part: 'knob-ctrl', msg: '2# 机旁旋钮切到「遥控」',
                      async act() { const s = _sysOf(this); await _clickPartUntil(_comp(s, 'lp2'), 'knob-ctrl', () => _comp(s, 'lp2').ctrlMode === 'remote'); } },
                ],
                check() {
                    const s = _sysOf(this);
                    const a = _comp(s, 'lp1'), b = _comp(s, 'lp2');
                    return !!(a && a.ctrlMode === 'remote' && b && b.ctrlMode === 'remote');
                },
            },
            {
                msg: '第 3 步：将备用顺序选择开关改为「2-1」（2# 主用、1# 备用）。',
                mode: 'check',
                op: [
                    { type: 'switch', target: 'ordsw', part: 'knob', msg: '点击备用顺序选择开关，切到「2-1」',
                      async act() { const s = _sysOf(this); await _clickPartUntil(_comp(s, 'ordsw'), 'knob', () => _comp(s, 'ordsw').order === '2-1', 4); } },
                ],
                check() { const s = _sysOf(this); const o = _comp(s, 'ordsw'); return !!(o && o.order === '2-1'); },
            },
            {
                msg: '第 4 步：将 1#、2# 遥控面板的控制模式都改为「自动」。',
                mode: 'check',
                op: [
                    { type: 'switch', target: 'rp1', part: 'knob-ma', msg: '1# 遥控面板切到「自动」',
                      async act() { const s = _sysOf(this); await _clickPartUntil(_comp(s, 'rp1'), 'knob-ma', () => _comp(s, 'rp1').auto === true, 3); } },
                    { type: 'switch', target: 'rp2', part: 'knob-ma', msg: '2# 遥控面板切到「自动」',
                      async act() { const s = _sysOf(this); await _clickPartUntil(_comp(s, 'rp2'), 'knob-ma', () => _comp(s, 'rp2').auto === true, 3); } },
                ],
                check() {
                    const s = _sysOf(this);
                    const a = _comp(s, 'rp1'), b = _comp(s, 'rp2');
                    return !!(a && a.auto === true && b && b.auto === true);
                },
            },
            {
                msg: '第 5 步：在机旁界面观察 2# 空压机的自动起停（瓶压低自动起动、瓶压高自动停机，需观察到一次起动和一次停机）。',
                mode: 'check',
                op: [
                    { type: 'observe', target: 'ac2', msg: '观察空气瓶压力降至动作下限时，2# 空压机自动起动',
                      async act() { const s = _sysOf(this); await _waitFor(s, x => { const a = _comp(x, 'ac2'); return a && a.running; }, 60000, 300); await _sleep(1500); } },
                    { type: 'observe', target: 'ac2', msg: '观察瓶压升至动作上限时，2# 空压机自动停机',
                      async act() { const s = _sysOf(this); await _waitFor(s, x => { const a = _comp(x, 'ac2'); return a && !a.running; }, 60000, 300); await _sleep(1500); } },
                ],
                check() {
                    const s = _sysOf(this);
                    const ac2 = _comp(s, 'ac2');
                    const st = s._wf2obs || (s._wf2obs = { started: false, stopped: false, was: ac2 ? !!ac2.running : false });
                    if (ac2) {
                        if (ac2.running && !st.was) st.started = true;
                        if (!ac2.running && st.was) st.stopped = true;
                        st.was = !!ac2.running;
                    }
                    return !!(st.started && st.stopped);
                },
            },
            {
                msg: '第 6 步：打开压力开关的配置界面，验证自动起动和自动停机的压力设定值。',
                mode: 'check',
                op: [
                    { type: 'observe', target: 'yt', part: 'scale', msg: '右键压力开关 → 参数设置，打开配置界面，查看给定值与切换差范围',
                      async act() {
                          const s = _sysOf(this);
                          const yt = _comp(s, 'yt');
                          if (!yt) return;
                          const lowSet = (yt.lowSet || 0).toFixed(2), highSet = (yt.highSet || 0).toFixed(2);
                          yt.showConfigDialog(); await _sleep(700);
                          const wf = this;
                          for (const it of [
                              { key: 'lowStart', tip: `动作下限（自动起动压力）≈ ${lowSet} MPa` },
                              { key: 'lowEnd',   tip: `给定值上限 ${(yt.lowEnd || 0).toFixed(2)} MPa` },
                              { key: 'diffStart', tip: `切换差下限 ${(yt.diffStart || 0).toFixed(2)} MPa` },
                              { key: 'diffEnd',  tip: `切换差上限 ${(yt.diffEnd || 0).toFixed(2)} MPa（自动停机压力=动作上限 ≈ ${highSet} MPa）` },
                          ]) {
                              const el = document.getElementById('diag_' + it.key);
                              if (el && typeof wf._flashDomElement === 'function') await wf._flashDomElement(el, it.tip, 2000);
                          }
                          await _sleep(1500);
                          const el = document.getElementById('diag_lowStart');
                          const dlg = el && el.closest('div[style*="position: fixed"]');
                          if (dlg) { const b = [...dlg.querySelectorAll('button')].find(x => x.textContent.includes('取消')); if (b) b.click(); }
                      } },
                ],
                check() { return !!document.getElementById('diag_lowStart'); },
            },
        ],
    },
};

// ═══════════════════════════════════════════════════════════════
// 页面定义
// ═══════════════════════════════════════════════════════════════

export const PROJECT_PAGES = [
    { id: 0, name: '索引', type: 'index' },
    {
        id: 1, name: '空压机气路与控制接触器',
        comps: ['lp1', 'p24-lp1', 'ac1', 'cv1', 'coil1', 'aux1no', 'aux1nc', 'gnd1',
            'lp2', 'p24-lp2', 'ac2', 'cv2', 'coil2', 'aux2no', 'aux2nc', 'gnd2',
            'tee', 'cab', 'teem', 'pm', 'yt', 'p24-yt', 'xpl1',
            'multimeter', 'mf47-panel', 'osc', 'sg', 'cali', 'elecmeter', 'megohm'],
        desc: '两台主空压机（1# 上、2# 下）各经机旁控制面板、接触器（KM1/KM2）与单向截止阀，汇流接入唯一空气瓶；出口双位压力继电器；跨页连接器 XPL 与页 2 互通。',
    },
    {
        id: 2, name: '遥控与 PLC 控制',
        comps: ['rp1', 'p24-rp1', 'rp2', 'p24-rp2', 'ordsw', 'p24-order', 'plc', 'em1', 'step7pc', 'dc24', 'xpl2', 'gnd0'],
        desc: '1#/2# 遥控面板（手动-自动、点动起动/停止）与 SR20 PLC（含 EM DI08 扩展模块、24V 电源），实现两台空压机的远方手动/自动控制与保护跳闸。',
    },
];

// ═══════════════════════════════════════════════════════════════
// 组件配置（1920 × 1080 基准坐标）
// ═══════════════════════════════════════════════════════════════

export const componentConfigs = [
    // ══ 页 1：上半 1# 机组 ══
    { Class: CompressorLocalPanel, id: 'lp1', x: -115, y: 215, page: 1, scale: 1, ownerId: 'ac1', contactorId: 'KM1', ctrlMode: 'off', label: '1# 机旁控制', visible: true },
    { Class: PotentialTerminal, id: 'p24-lp1', x: -125, y: 410, page: 1, potential: 24, visible: true },
    { Class: AirCompressor, id: 'ac1', x: 620, y: 145, page: 1, mode: 'remote', refillRate: 0.006, visible: true },
    { Class: CheckValve, id: 'cv1', x: 880, y: 230, page: 1, scale: 1, isOpen: false, label: '1# 截止阀', visible: true },
    { Class: ContactorCoil, id: 'coil1', x: -100, y: 580, page: 1, deviceid: 'KM1', ratedCoilVoltage: 24, visible: true },
    { Class: Ground, id: 'gnd1', x: -20, y: 650, page: 1, visible: true },
    { Class: AuxNOContact, id: 'aux1no', x: 640, y: 50, page: 1, deviceid: 'KM1', visible: true },

    // ══ 页 1：下半 2# 机组 ══
    { Class: CompressorLocalPanel, id: 'lp2', x: 285, y: 215, page: 1, scale: 1, ownerId: 'ac2', contactorId: 'KM2', ctrlMode: 'off', label: '2# 机旁控制', visible: true },
    { Class: PotentialTerminal, id: 'p24-lp2', x: 236, y: 450, page: 1, potential: 24, visible: true },
    { Class: AirCompressor, id: 'ac2', x: 620, y: 575, page: 1, mode: 'remote', refillRate: 0.006, visible: true },
    { Class: CheckValve, id: 'cv2', x: 880, y: 655, page: 1, scale: 1, isOpen: false, label: '2# 截止阀', visible: true },
    { Class: ContactorCoil, id: 'coil2', x: 260, y: 580, page: 1, deviceid: 'KM2', ratedCoilVoltage: 24, visible: true },
    { Class: Ground, id: 'gnd2', x: 350, y: 650, page: 1, visible: true },
    { Class: AuxNOContact, id: 'aux2no', x: 640, y: 480, page: 1, deviceid: 'KM2', visible: true },

    // ══ 页 1：汇流三通 + 空气瓶 + 测压 ══
    { Class: TeeConnector, id: 'tee', x: 960, y: 380, page: 1, direction: 'right', visible: true },
    { Class: AirBottle, id: 'cab', x: 1160, y: 420, page: 1, initialPressure: 3.2, unit: 'MPa', volume: 50, isConsuming: true, consumptionRate: 2, visible: true },
    { Class: TeeConnector, id: 'teem', x: 1360, y: 450, page: 1, direction: 'up', visible: true },
    { Class: PressMeter, id: 'pm', x: 1620, y: 370, page: 1, min: 0, max: 4, title: '空气瓶压力 MPa', visible: true },
    { Class: PressRelay, id: 'yt', x: 1250, y: 100, page: 1, scale: 0.5, model: 'YT1226',
      lowStart: 0, lowEnd: 2, diffStart: 0.7, diffEnd: 2.5, setPoint: 75, differential: 44.4, visible: true },
    { Class: PotentialTerminal, id: 'p24-yt', x: 1450, y: 150, page: 1, potential: 24, visible: true },

    // ══ 页 1：跨页连接器（页 1 侧，置于右下角）══
    { Class: PageLink, id: 'xpl1', x: 80, y: 800, page: 1, deviceid: 'XPL', pairs: 12, label: '跨页连接器 · 页1', visible: true },

    // ══ 页 2：遥控面板 + PLC + EM DI08 + 电源 + 跨页连接器 ══
    { Class: CompressorRemotePanel, id: 'rp1', x: 320, y: 20, page: 2, scale: 1, ownerId: 'ac1', localPanelId: 'lp1', contactorId: 'KM1', title: '1号主空压机', auto: false, visible: true },
    { Class: PotentialTerminal, id: 'p24-rp1', x: 220, y: 310, page: 2, potential: 24, visible: true },
    { Class: CompressorRemotePanel, id: 'rp2', x: 320, y: 380, page: 2, scale: 1, ownerId: 'ac2', localPanelId: 'lp2', contactorId: 'KM2', title: '2号主空压机', auto: false, visible: true },
    { Class: PotentialTerminal, id: 'p24-rp2', x: 220, y: 650, page: 2, potential: 24, visible: true },
    { Class: StandbyOrderSwitch, id: 'ordsw', x: 60, y: 430, page: 2, order: '1-2', label: '备用顺序选择', visible: true },
    { Class: PotentialTerminal, id: 'p24-order', x: 63, y: 370, page: 2, potential: 24, visible: true },
    { Class: S7_200_SMART_ST20, id: 'plc', x: 620, y: 180, page: 2, label: 'SR20', mode: 'RUN', program: PLC_PROGRAM, visible: true },
    { Class: S7_200_EM_DI08, id: 'em1', x: 980, y: 180, page: 2, attachTo: 'plc', visible: true },
    { Class: STEP7PC, id: 'step7pc', x: 1280, y: 220, page: 2, label: '上位机 (监控/编程)', visible: true },
    { Class: DCPower, id: 'dc24', x: 320, y: 750, page: 2, voltage: 24, isOn: true, visible: true },
    { Class: Ground, id: 'gnd0', x: 400, y: 990, page: 2, visible: true },
    { Class: PageLink, id: 'xpl2', x: 600, y: 800, page: 2, deviceid: 'XPL', pairs: 12, label: '跨页连接器 · 页2', visible: true },

    // ══ 7 种标准仪表（默认隐藏）══
    { Class: Multimeter, id: 'multimeter', x: 960, y: 180, page: 1, visible: false },
    { Class: MF47Multimeter, id: 'mf47-panel', x: 40, y: 300, page: 1, visible: false },
    { Class: Oscilloscope_tri, id: 'osc', x: 40, y: 300, page: 1, visible: false },
    { Class: SignalGenerator, id: 'sg', x: 40, y: 300, page: 1, visible: false },
    { Class: ProcessCalibrator, id: 'cali', x: 40, y: 300, page: 1, visible: false },
    { Class: ElecMeter, id: 'elecmeter', x: 40, y: 300, page: 1, visible: false },
    { Class: RealMegohmMeter, id: 'megohm', x: 40, y: 300, page: 1, visible: false },
];

// ═══════════════════════════════════════════════════════════════
// 工具栏快捷操作
// ═══════════════════════════════════════════════════════════════

export function initSlider(sys) {
    if (!sys) return;
    sys._noBlinkHighlight = true;
    sys.pageIndexTitle = '空压机起停控制系统 · 页面索引';
}

export function applyAllPresets() {
    const sys = _sysOf(this);
    if (!sys) return;
    _autoWire(sys);
}

export async function applyStartSystem() {
    const sys = _sysOf(this);
    if (!sys) return;
    await _resetRig(sys);
    await _startSystem(sys);
}

export function fiveStep() {
    const sys = _sysOf(this);
    const yt = _comp(sys, 'yt');
    if (!yt) return;
    const steps = [50, 60, 70, 80, 90];
    if (sys._fiveStepIdx === undefined || sys._fiveStepIdx >= steps.length) sys._fiveStepIdx = 0;
    yt.setPoint = steps[sys._fiveStepIdx];
    yt.lowSet = yt.lowStart + (yt.lowEnd - yt.lowStart) * yt.setPoint / 100;
    yt.highSet = yt.lowSet + yt.diffStart + (yt.diffEnd - yt.diffStart) * yt.differential / 100;
    sys._fiveStepIdx = (sys._fiveStepIdx + 1) % steps.length;
    sys.redrawAll && sys.redrawAll();
}
