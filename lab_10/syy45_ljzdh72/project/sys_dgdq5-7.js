// ═══════════════════════════════════════════════════════════════
// 滑油泵自动切换控制系统（真 PLC + 接触器控制电路）
//
// 页 1「机旁滑油控制」：
//   tank   滑油循环柜（顶部进口 ← 柴油机出口；右侧出口 → 第1三通）
//   p1/p2  1#/2# 滑油泵（遥控接口 l/r 接通即运转，叶轮旋转）
//   cv1/cv2 单向截止阀
//   tee1/tee2 汇流三通（两台泵并联吸入/排出）
//   teem   测压三通 → yt 双位压力继电器（滑油压力低信号）
//   tee3 → 冷却器 cooler ／ 旁通 → 电动调节阀 valve（三通）
//   tee4 → 手动滤器 f1 ／ 自清洗滤器 f2 → tee5 → 柴油机 engine → 循环柜
//   lp1/lp2  1#/2# 滑油泵机旁控制面板（电源/运行/故障灯 + 起动/停止 + 本地/遥控）
//   coil1/coil2 接触器线圈（KM1/KM2）；aux1no/aux2no 辅助常开触点 → 桥接泵遥控端 l/r
//
// 页 2「遥控与 PLC 控制」：
//   rp1/rp2  1#/2# 滑油泵遥控面板（电源/备用/运行/故障灯 + 加热器 + 手/自 + 启动/停复位）
//   plc  西门子 S7-200 SMART ST20（作 SR20）；em1 EM DI08 扩展模块
//   dc24 24V 直流电源；xpl2 跨页连接器（页 2 侧）
//
// 控制原理：
//   机旁「本地」→ 起动/停止 直接控制接触器线圈（就地）；「遥控」→ 交由 PLC / 遥控面板；
//   泵压力模型：运转时入口 -0.1 MPa、加压 0.6 MPa → 出口 0.5 MPa；停止时出口 0 MPa；
//   压力开关下限 0.2 / 上限 0.3 MPa（>0.3 常闭触点断开，备用泵不投入）；
//   「自动」时 1# 优先作主用泵连续运行；压力 <0.2 且常闭触点闭合持续 3s → 投入备用泵；
//   运行泵故障跳闸 → 备用泵延时 5s 自动投入；
//   备用泵投入且压力恢复（>0.3）后，切除原运行泵（主/备互换）；
//   接触器吸合 → 辅助常开桥接滑油泵遥控端 l/r → 泵运转。
// ═══════════════════════════════════════════════════════════════

import { TeeConnector } from '../components/TeeConnector.js';
import { Cooler } from '../components/Cooler.js';
import { ElecValve } from '../components/ElecValve.js';
import { Engine } from '../components/Engine.js';
import { CheckValve } from '../components/CheckValve.js';
import { PressRelay } from '../components/PressRelay.js';
import { PageLink } from '../components/PageLink.js';
import { PotentialTerminal } from '../components/PotentialTerminal.js';
import { Ground } from '../components/Gnd.js';
import { DCPower } from '../components/DCPower.js';
import { S7_200_SMART_ST20 } from '../components/S7_200_SMART_ST20.js';
import { STEP7PC } from '../components/STEP7PC.js';
import { S7_200_EM_DI08 } from '../components/S7200_EM_DI08.js';
import { ContactorCoil } from '../device/ContactorCoil.js';
import { AuxNOContact } from '../device/AuxNOContact.js';

import { LubeOilPump } from '../components/LubeOilPump.js';
import { LubeOilPumpLocalPanel } from '../components/LubeOilPumpLocalPanel.js';
import { LubeOilPumpRemotePanel } from '../components/LubeOilPumpRemotePanel.js';
import { OilFilter } from '../components/OilFilter.js';
import { LubeOilTank } from '../components/LubeOilTank.js';

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

/** 线色约定：接 PLC/EM 输入 → 亮蓝；PLC 输出 → 红色；其它 → 默认 */
function _wireColor(from, to) {
    const s = `${from}|${to}`;
    if (/plc_wire_dq/.test(s)) return '#d0021b';
    if (/plc_wire_di/.test(s) || /em1_wire_din/.test(s)
        || /xpl[12]_wire_a(4|5|6|7|8)\b/.test(s)
        || /_wire_(rem_o|flt_o|auto_o|sa_o|sb_o|NC)\b/.test(s)) return '#00b0ff';
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
// PLC 程序（指令表）：滑油泵自动切换
//   1# 优先为主用泵；压力开关下限 0.2 / 上限 0.3 MPa。
//   · 压力 > 0.3 MPa：常闭触点断开，备用泵不投入；
//   · 压力 < 0.2 MPa（常闭触点闭合）持续 3s → 投入备用泵；
//   · 运行泵故障跳闸 → 备用泵延时 5s 自动投入；
//   · 机旁过载故障信号 → PLC 对故障锁存；信号消失后仍须在对应遥控面板
//     按「停/复位」才解除；锁存期间禁止该泵的遥控手动起动与自动起动；
//   · 备用泵投入且压力恢复（> 0.3 MPa）后，切除原运行泵（主/备互换）。
//   I0.0/I0.1/I0.2 = 1# 遥控面板 自动/启动/停复位
//   I0.3/I0.4/I0.5 = 2# 遥控面板 自动/启动/停复位
//   I0.6/I0.7 = 1#/2# 机旁「遥控」位
//   I1.0 = 滑油压力低（压力继电器 NC）
//   EM DI08: I2.0/I2.1 = 1#/2# 机旁过载故障信号
//   Q0.0/Q0.1 = KM1/KM2；Q0.2/Q0.3 = 1#/2# 故障灯（锁存）
// ═══════════════════════════════════════════════════════════════

const PLC_PROGRAM = [
    '// 滑油泵自动切换控制（SR20 / ST20 + EM DI08）',
    '// —— 机旁过载故障信号 → 对故障锁存 ——',
    'LD     I2.0',
    'S      M10.0, 1',
    'LD     I2.1',
    'S      M10.1, 1',
    '// 复位：对应遥控面板按「停/复位」且机旁故障信号已消失',
    'LD     I0.2',
    'AN     I2.0',
    'R      M10.0, 1',
    'LD     I0.5',
    'AN     I2.1',
    'R      M10.1, 1',
    '// —— 参与自动（忽略故障）——',
    'LD     I0.6',
    'A      I0.0',
    '=      M1.4',
    'LD     I0.7',
    'A      I0.3',
    '=      M1.5',
    '// —— 可用（参与自动 且 无故障锁存）——',
    'LD     M1.4',
    'AN     M10.0',
    '=      M1.0',
    'LD     M1.5',
    'AN     M10.1',
    '=      M1.1',
    '// —— 主/备状态位：初始置 1# 为主用 ——',
    'LDN    M20.0',
    'AN     M20.1',
    'S      M20.0, 1',
    '// —— 参与自动变化时的即时接管（不含故障）——',
    'LDN    M1.4',
    'A      M1.5',
    'A      M20.0',
    'R      M20.0, 1',
    'S      M20.1, 1',
    'LDN    M1.5',
    'A      M1.4',
    'A      M20.1',
    'R      M20.1, 1',
    'S      M20.0, 1',
    '// —— 运行泵故障标志（锁存）——',
    'LD     M20.0',
    'A      M10.0',
    'LD     M20.1',
    'A      M10.1',
    'OLD',
    '=      M1.3',
    '// —— 压力低（非故障）延时 3s ——',
    'LD     I1.0',
    'AN     M1.3',
    'TON    T37, 3000',
    '// —— 运行泵故障延时 5s ——',
    'LD     M20.0',
    'A      M10.0',
    'TON    T38, 5000',
    'LD     M20.1',
    'A      M10.1',
    'TON    T39, 5000',
    '// —— 备用投入请求 ——',
    'LD     T37',
    'O      T38',
    'O      T39',
    '=      M1.2',
    '// —— 主用运行命令 ——',
    'LD     M20.0',
    'A      M1.0',
    '=      M2.0',
    'LD     M20.1',
    'A      M1.1',
    '=      M2.1',
    '// —— 备用投入（锁存）——',
    'LD     M1.2',
    'A      M20.0',
    'A      M1.1',
    'S      M3.1, 1',
    'LD     M1.2',
    'A      M20.1',
    'A      M1.0',
    'S      M3.0, 1',
    'LDN    M1.1',
    'R      M3.1, 1',
    'LDN    M1.0',
    'R      M3.0, 1',
    '// —— 备用运行且压力恢复 → 主/备互换、切除原运行泵 ——',
    'LDN    I1.0',
    'A      M3.1',
    'S      M20.1, 1',
    'R      M20.0, 1',
    'R      M3.1, 1',
    'LDN    I1.0',
    'A      M3.0',
    'S      M20.0, 1',
    'R      M20.1, 1',
    'R      M3.0, 1',
    '// —— 遥控手动起保停（故障锁存时禁止）——',
    'LD     I0.1',
    'O      M0.1',
    'AN     I0.2',
    'A      I0.6',
    'AN     I0.0',
    'AN     M10.0',
    '=      M0.1',
    'LD     I0.4',
    'O      M0.3',
    'AN     I0.5',
    'A      I0.7',
    'AN     I0.3',
    'AN     M10.1',
    '=      M0.3',
    '// —— 输出（故障锁存时禁止起动）——',
    'LD     M2.0',
    'O      M3.0',
    'O      M0.1',
    'AN     M10.0',
    '=      Q0.0',
    'LD     M2.1',
    'O      M3.1',
    'O      M0.3',
    'AN     M10.1',
    '=      Q0.1',
    'LD     M10.0',
    '=      Q0.2',
    'LD     M10.1',
    '=      Q0.3',
    'END',
].join('\n');

// ═══════════════════════════════════════════════════════════════
// 管路连线定义
// ═══════════════════════════════════════════════════════════════

const PIPE_META = [
    { conn: { from: 'tank_pipe_o', to: 'tee1_pipe_u', type: 'pipe' }, target: 'tank', ports: ['tank_pipe_o', 'tee1_pipe_u'], msg: '油路①：滑油循环柜出口 → 第1三通接头左口' },
    { conn: { from: 'tee1_pipe_r', to: 'p1_pipe_i', type: 'pipe' }, target: 'tee1', ports: ['tee1_pipe_r', 'p1_pipe_i'], msg: '油路②：第1三通上口 → 1# 滑油泵吸入口' },
    { conn: { from: 'p1_pipe_o', to: 'cv1_pipe_i', type: 'pipe' }, target: 'p1', ports: ['p1_pipe_o', 'cv1_pipe_i'], msg: '油路③：1# 滑油泵排出口 → 1# 单向截止阀' },
    { conn: { from: 'cv1_pipe_o', to: 'tee2_pipe_l', type: 'pipe' }, target: 'cv1', ports: ['cv1_pipe_o', 'tee2_pipe_l'], msg: '油路④：1# 单向截止阀 → 第2三通上口' },
    { conn: { from: 'tee1_pipe_l', to: 'p2_pipe_i', type: 'pipe' }, target: 'tee1', ports: ['tee1_pipe_l', 'p2_pipe_i'], msg: '油路⑤：第1三通下口 → 2# 滑油泵吸入口' },
    { conn: { from: 'p2_pipe_o', to: 'cv2_pipe_i', type: 'pipe' }, target: 'p2', ports: ['p2_pipe_o', 'cv2_pipe_i'], msg: '油路⑥：2# 滑油泵排出口 → 2# 单向截止阀' },
    { conn: { from: 'cv2_pipe_o', to: 'tee2_pipe_r', type: 'pipe' }, target: 'cv2', ports: ['cv2_pipe_o', 'tee2_pipe_r'], msg: '油路⑦：2# 单向截止阀 → 第2三通下口' },
    { conn: { from: 'tee2_pipe_u', to: 'teem_pipe_l', type: 'pipe' }, target: 'tee2', ports: ['tee2_pipe_u', 'teem_pipe_l'], msg: '油路⑧：第2三通右口 → 测压三通左口' },
    { conn: { from: 'teem_pipe_u', to: 'yt_pipe_i', type: 'pipe' }, target: 'teem', ports: ['teem_pipe_u', 'yt_pipe_i'], msg: '测压：测压三通上口 → 双位压力继电器' },
    { conn: { from: 'teem_pipe_r', to: 'tee3_pipe_u', type: 'pipe' }, target: 'teem', ports: ['teem_pipe_r', 'tee3_pipe_u'], msg: '油路⑨：测压三通右口 → 第3三通左口' },
    { conn: { from: 'tee3_pipe_r', to: 'valve_pipe_u', type: 'pipe' }, target: 'tee3', ports: ['tee3_pipe_r', 'valve_pipe_u'], msg: '油路⑩：第3三通上口 → 电动调节阀左口（旁通通道）' },
    { conn: { from: 'tee3_pipe_l', to: 'cooler_pipe_i', type: 'pipe' }, target: 'tee3', ports: ['tee3_pipe_l', 'cooler_pipe_i'], msg: '油路⑪：第3三通下口 → 冷却器入口' },
    { conn: { from: 'cooler_pipe_o', to: 'valve_pipe_l', type: 'pipe' }, target: 'cooler', ports: ['cooler_pipe_o', 'valve_pipe_l'], msg: '油路⑫：冷却器出口 → 电动调节阀下口' },
    { conn: { from: 'valve_pipe_r', to: 'tee4_pipe_u', type: 'pipe' }, target: 'valve', ports: ['valve_pipe_r', 'tee4_pipe_u'], msg: '油路⑬：电动调节阀出口 → 第4三通右口' },
    { conn: { from: 'tee4_pipe_l', to: 'f1_pipe_i', type: 'pipe' }, target: 'tee4', ports: ['tee4_pipe_l', 'f1_pipe_i'], msg: '油路⑭：第4三通上口 → 手动滤器入口' },
    { conn: { from: 'f1_pipe_o', to: 'tee5_pipe_r', type: 'pipe' }, target: 'f1', ports: ['f1_pipe_o', 'tee5_pipe_r'], msg: '油路⑮：手动滤器出口 → 第5三通上口' },
    { conn: { from: 'tee4_pipe_r', to: 'f2_pipe_i', type: 'pipe' }, target: 'tee4', ports: ['tee4_pipe_r', 'f2_pipe_i'], msg: '油路⑯：第4三通下口 → 自清洗滤器入口' },
    { conn: { from: 'f2_pipe_o', to: 'tee5_pipe_l', type: 'pipe' }, target: 'f2', ports: ['f2_pipe_o', 'tee5_pipe_l'], msg: '油路⑰：自清洗滤器出口 → 第5三通下口' },
    { conn: { from: 'tee5_pipe_u', to: 'engine_pipe_i', type: 'pipe' }, target: 'tee5', ports: ['tee5_pipe_u', 'engine_pipe_i'], msg: '油路⑱：第5三通左口 → 柴油机右入口' },
    { conn: { from: 'engine_pipe_o', to: 'tank_pipe_i', type: 'pipe' }, target: 'engine', ports: ['engine_pipe_o', 'tank_pipe_i'], msg: '油路⑲：柴油机左出口 → 滑油循环柜顶部入口' },
];

// ═══════════════════════════════════════════════════════════════
// 电路连线定义
// ═══════════════════════════════════════════════════════════════

const WIRE_META = [
    // ── PLC 本体供电 ──
    { conn: { from: 'dc24_wire_p', to: 'plc_wire_24v', type: 'wire' }, target: 'dc24', ports: ['dc24_wire_p', 'plc_wire_24v'], msg: '供电①：24V → PLC 传感器电源 24V' },
    { conn: { from: 'dc24_wire_n', to: 'plc_wire_v0', type: 'wire' }, target: 'dc24', ports: ['dc24_wire_n', 'plc_wire_v0'], msg: '供电②：0V → PLC 传感器电源 0V' },
    { conn: { from: 'plc_wire_1m', to: 'plc_wire_v0', type: 'wire' }, target: 'plc', ports: ['plc_wire_1m', 'plc_wire_v0'], msg: '供电③：PLC 输入公共端 1M → 0V' },
    { conn: { from: 'plc_wire_1l', to: 'dc24_wire_p', type: 'wire' }, target: 'plc', ports: ['plc_wire_1l', 'dc24_wire_p'], msg: '供电④：PLC 输出负载电源 1L+ → 24V' },
    { conn: { from: 'step7pc_wire_lan', to: 'plc_wire_lan', type: 'wire' }, target: 'step7pc', ports: ['step7pc_wire_lan', 'plc_wire_lan'], msg: '通信：上位机（STEP7）网口 → PLC 以太网口' },

    // ── 各面板开关公共端接 24V 电位端子 ──
    { conn: { from: 'p24-lp1_wire_p', to: 'lp1_wire_sw_com', type: 'wire' }, target: 'lp1', ports: ['p24-lp1_wire_p', 'lp1_wire_sw_com'], msg: '24V①：1# 机旁面板 24V 电位端子 → 开关公共端' },
    { conn: { from: 'p24-lp2_wire_p', to: 'lp2_wire_sw_com', type: 'wire' }, target: 'lp2', ports: ['p24-lp2_wire_p', 'lp2_wire_sw_com'], msg: '24V②：2# 机旁面板 24V 电位端子 → 开关公共端' },
    { conn: { from: 'p24-rp1_wire_p', to: 'rp1_wire_sw_com', type: 'wire' }, target: 'rp1', ports: ['p24-rp1_wire_p', 'rp1_wire_sw_com'], msg: '24V③：1# 遥控面板 24V 电位端子 → 开关公共端' },
    { conn: { from: 'p24-rp2_wire_p', to: 'rp2_wire_sw_com', type: 'wire' }, target: 'rp2', ports: ['p24-rp2_wire_p', 'rp2_wire_sw_com'], msg: '24V④：2# 遥控面板 24V 电位端子 → 开关公共端' },
    { conn: { from: 'p24-yt_wire_p', to: 'yt_wire_COM', type: 'wire' }, target: 'yt', ports: ['p24-yt_wire_p', 'yt_wire_COM'], msg: '24V⑤：压力继电器 24V 电位端子 → COM 端（另一端 NC 去 PLC）' },

    // ── 接地：接触器线圈返回端接 0V ──
    { conn: { from: 'coil1_wire_a2', to: 'gnd1_wire_gnd', type: 'wire' }, target: 'coil1', ports: ['coil1_wire_a2', 'gnd1_wire_gnd'], msg: '接地①：KM1 线圈 A2 → 地' },
    { conn: { from: 'coil2_wire_a2', to: 'gnd2_wire_gnd', type: 'wire' }, target: 'coil2', ports: ['coil2_wire_a2', 'gnd2_wire_gnd'], msg: '接地②：KM2 线圈 A2 → 地' },
    { conn: { from: 'dc24_wire_n', to: 'gnd0_wire_gnd', type: 'wire' }, target: 'dc24', ports: ['dc24_wire_n', 'gnd0_wire_gnd'], msg: '接地③：0V → 地（参考零电位）' },

    // ── 1# 接触器线圈回路（KM1）：就地直驱 ∥ PLC 输出 ──
    { conn: { from: 'lp1_wire_loc_o', to: 'coil1_wire_a1', type: 'wire' }, target: 'lp1', ports: ['lp1_wire_loc_o', 'coil1_wire_a1'], msg: 'KM1①：机旁「本地」输出 → KM1 线圈 A1（就地直驱）' },
    { conn: { from: 'xpl1_wire_a2', to: 'coil1_wire_a1', type: 'wire' }, target: 'coil1', ports: ['xpl1_wire_a2', 'coil1_wire_a1'], msg: 'KM1②：跨页连接器 A2（PLC Q0.0）→ KM1 线圈 A1（远方驱动）' },
    { conn: { from: 'xpl2_wire_a2', to: 'plc_wire_dq00', type: 'wire' }, target: 'plc', ports: ['xpl2_wire_a2', 'plc_wire_dq00'], msg: 'KM1③：PLC Q0.0 → 跨页连接器 A2' },

    // ── 2# 接触器线圈回路（KM2）──
    { conn: { from: 'lp2_wire_loc_o', to: 'coil2_wire_a1', type: 'wire' }, target: 'lp2', ports: ['lp2_wire_loc_o', 'coil2_wire_a1'], msg: 'KM2①：机旁「本地」输出 → KM2 线圈 A1' },
    { conn: { from: 'xpl1_wire_a3', to: 'coil2_wire_a1', type: 'wire' }, target: 'coil2', ports: ['xpl1_wire_a3', 'coil2_wire_a1'], msg: 'KM2②：跨页连接器 A3（PLC Q0.1）→ KM2 线圈 A1' },
    { conn: { from: 'xpl2_wire_a3', to: 'plc_wire_dq01', type: 'wire' }, target: 'plc', ports: ['xpl2_wire_a3', 'plc_wire_dq01'], msg: 'KM2③：PLC Q0.1 → 跨页连接器 A3' },

    // ── 接触器辅助触点 → 滑油泵遥控端 l/r ──
    { conn: { from: 'aux1no_wire_com', to: 'p1_wire_l', type: 'wire' }, target: 'aux1no', ports: ['aux1no_wire_com', 'p1_wire_l'], msg: 'KM1⑤：辅助常开 COM → 1# 滑油泵遥控端 L' },
    { conn: { from: 'aux1no_wire_no', to: 'p1_wire_r', type: 'wire' }, target: 'aux1no', ports: ['aux1no_wire_no', 'p1_wire_r'], msg: 'KM1⑥：辅助常开 NO → 1# 滑油泵遥控端 R（吸合即运转）' },
    { conn: { from: 'aux2no_wire_com', to: 'p2_wire_l', type: 'wire' }, target: 'aux2no', ports: ['aux2no_wire_com', 'p2_wire_l'], msg: 'KM2⑤：辅助常开 COM → 2# 滑油泵遥控端 L' },
    { conn: { from: 'aux2no_wire_no', to: 'p2_wire_r', type: 'wire' }, target: 'aux2no', ports: ['aux2no_wire_no', 'p2_wire_r'], msg: 'KM2⑥：辅助常开 NO → 2# 滑油泵遥控端 R' },

    // ── 压力继电器 → PLC 输入 ──
    { conn: { from: 'yt_wire_NC', to: 'xpl1_wire_a6', type: 'wire' }, target: 'yt', ports: ['yt_wire_NC', 'xpl1_wire_a6'], msg: '信号①：压力继电器 NC → 跨页连接器 A6' },
    { conn: { from: 'xpl2_wire_a6', to: 'plc_wire_di10', type: 'wire' }, target: 'plc', ports: ['xpl2_wire_a6', 'plc_wire_di10'], msg: '信号②：跨页连接器 A6 → PLC DI1.0（滑油压力低）' },

    // ── 机旁「遥控」信号 → PLC 输入 ──
    { conn: { from: 'lp1_wire_rem_o', to: 'xpl1_wire_a4', type: 'wire' }, target: 'lp1', ports: ['lp1_wire_rem_o', 'xpl1_wire_a4'], msg: '信号③：1# 机旁遥控 → 跨页连接器 A4' },
    { conn: { from: 'xpl2_wire_a4', to: 'plc_wire_di06', type: 'wire' }, target: 'plc', ports: ['xpl2_wire_a4', 'plc_wire_di06'], msg: '信号④：跨页连接器 A4 → PLC DI0.6' },
    { conn: { from: 'lp2_wire_rem_o', to: 'xpl1_wire_a5', type: 'wire' }, target: 'lp2', ports: ['lp2_wire_rem_o', 'xpl1_wire_a5'], msg: '信号⑤：2# 机旁遥控 → 跨页连接器 A5' },
    { conn: { from: 'xpl2_wire_a5', to: 'plc_wire_di07', type: 'wire' }, target: 'plc', ports: ['xpl2_wire_a5', 'plc_wire_di07'], msg: '信号⑥：跨页连接器 A5 → PLC DI0.7' },

    // ── 泵故障触头 → EM DI08（跨页）──
    { conn: { from: 'lp1_wire_flt_o', to: 'xpl1_wire_a7', type: 'wire' }, target: 'lp1', ports: ['lp1_wire_flt_o', 'xpl1_wire_a7'], msg: '故障①：1# 泵故障 → 跨页连接器 A7' },
    { conn: { from: 'xpl2_wire_a7', to: 'em1_wire_din0', type: 'wire' }, target: 'em1', ports: ['xpl2_wire_a7', 'em1_wire_din0'], msg: '故障②：跨页连接器 A7 → EM DI08 通道0（I2.0）' },
    { conn: { from: 'lp2_wire_flt_o', to: 'xpl1_wire_a8', type: 'wire' }, target: 'lp2', ports: ['lp2_wire_flt_o', 'xpl1_wire_a8'], msg: '故障③：2# 泵故障 → 跨页连接器 A8' },
    { conn: { from: 'xpl2_wire_a8', to: 'em1_wire_din1', type: 'wire' }, target: 'em1', ports: ['xpl2_wire_a8', 'em1_wire_din1'], msg: '故障④：跨页连接器 A8 → EM DI08 通道1（I2.1）' },

    // ── 遥控面板开关 → PLC 输入 ──
    { conn: { from: 'rp1_wire_auto_o', to: 'plc_wire_di00', type: 'wire' }, target: 'rp1', ports: ['rp1_wire_auto_o', 'plc_wire_di00'], msg: '遥控②：1# 遥控面板「自动」→ PLC DI0.0' },
    { conn: { from: 'rp1_wire_sa_o', to: 'plc_wire_di01', type: 'wire' }, target: 'rp1', ports: ['rp1_wire_sa_o', 'plc_wire_di01'], msg: '遥控③：1# 遥控面板「启动」→ PLC DI0.1' },
    { conn: { from: 'rp1_wire_sb_o', to: 'plc_wire_di02', type: 'wire' }, target: 'rp1', ports: ['rp1_wire_sb_o', 'plc_wire_di02'], msg: '遥控④：1# 遥控面板「停止」→ PLC DI0.2' },
    { conn: { from: 'rp2_wire_auto_o', to: 'plc_wire_di03', type: 'wire' }, target: 'rp2', ports: ['rp2_wire_auto_o', 'plc_wire_di03'], msg: '遥控⑥：2# 遥控面板「自动」→ PLC DI0.3' },
    { conn: { from: 'rp2_wire_sa_o', to: 'plc_wire_di04', type: 'wire' }, target: 'rp2', ports: ['rp2_wire_sa_o', 'plc_wire_di04'], msg: '遥控⑦：2# 遥控面板「启动」→ PLC DI0.4' },
    { conn: { from: 'rp2_wire_sb_o', to: 'plc_wire_di05', type: 'wire' }, target: 'rp2', ports: ['rp2_wire_sb_o', 'plc_wire_di05'], msg: '遥控⑧：2# 遥控面板「停止」→ PLC DI0.5' },

    // ── PLC 故障输出 → 遥控面板故障灯 ──
    { conn: { from: 'plc_wire_dq02', to: 'rp1_wire_flt_i', type: 'wire' }, target: 'plc', ports: ['plc_wire_dq02', 'rp1_wire_flt_i'], msg: '报警①：PLC Q0.2（1# 故障）→ 1# 遥控面板故障灯' },
    { conn: { from: 'plc_wire_dq03', to: 'rp2_wire_flt_i', type: 'wire' }, target: 'plc', ports: ['plc_wire_dq03', 'rp2_wire_flt_i'], msg: '报警②：PLC Q0.3（2# 故障）→ 2# 遥控面板故障灯' },
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

    ['p1', 'p2'].forEach(id => {
        const p = _comp(sys, id);
        if (p) { p.setRemoteCmd(null); p.running = false; p.power = 0; p.pumpOn = false; p._lowOut = false; }
    });
    ['cv1', 'cv2'].forEach(id => {
        const cv = _comp(sys, id);
        if (cv) { cv.isOpen = true; cv._locked = false; if (cv.update) cv.update(); }
    });
    ['lp1', 'lp2'].forEach(id => {
        const lp = _comp(sys, id);
        if (lp) { lp.setMode('local'); lp._latched = false; lp.clearAlarms && lp.clearAlarms(); lp._syncVisuals && lp._syncVisuals(); }
    });
    ['rp1', 'rp2'].forEach(id => {
        const rp = _comp(sys, id);
        if (rp) { rp.auto = false; rp._startPressed = false; rp._stopPressed = false; rp._faultNow = false; rp._syncVisuals && rp._syncVisuals(); }
    });
    ['f1', 'f2'].forEach(id => { const f = _comp(sys, id); if (f) { f.reset && f.reset(); f._cleanDisabled = false; } });
    const valve = _comp(sys, 'valve');
    if (valve) { valve.isStuck = false; valve.setControlMode && valve.setControlMode('MANUAL'); valve.setTarget && valve.setTarget(0.5); }
    const yt = _comp(sys, 'yt');
    if (yt) { yt._forceLow = false; if (yt.update) yt.update(0); }
    const plc = _comp(sys, 'plc');
    if (plc) {
        // 复位 PLC 运行上下文（清除 M 位记忆，尤其主/备状态位），再装入程序并置 RUN
        if (sys.s7200Solver && typeof sys.s7200Solver.resetPLC === 'function') {
            try { sys.s7200Solver.resetPLC('plc'); } catch (e) { /* ignore */ }
        }
        if (typeof plc.setProgram === 'function') plc.setProgram(PLC_PROGRAM);
        if (plc.mode !== 'RUN' && typeof plc.toggleMode === 'function') plc.toggleMode();
    }
    const dc = _comp(sys, 'dc24');
    if (dc) { dc.isOn = true; dc.voltage = 24; }

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
    // 重建连线后重新应用页面显隐，避免跨页残留
    sys.pageMgr && sys.pageMgr.refresh && sys.pageMgr.refresh();
}

/** 系统起动：接线 → 开阀 → 机旁遥控 → 遥控自动 → PLC RUN */
async function _startSystem(sys) {
    if (!sys) return;
    _autoWire(sys);

    ['cv1', 'cv2'].forEach(id => { const cv = _comp(sys, id); if (cv && !cv._locked) { cv.isOpen = true; cv.update && cv.update(); } });
    ['lp1', 'lp2'].forEach(id => { const lp = _comp(sys, id); if (lp) lp.setMode('remote'); });
    ['rp1', 'rp2'].forEach(id => { const rp = _comp(sys, id); if (rp) { rp.auto = true; rp._syncVisuals && rp._syncVisuals(); } });
    const valve = _comp(sys, 'valve');
    if (valve) { valve.setControlMode && valve.setControlMode('MANUAL'); valve.setTarget && valve.setTarget(0.5); }

    const plc = _comp(sys, 'plc');
    if (plc) {
        if (typeof plc.setProgram === 'function') plc.setProgram(PLC_PROGRAM);
        if (plc.mode !== 'RUN' && typeof plc.toggleMode === 'function') plc.toggleMode();
    }
    const dc = _comp(sys, 'dc24');
    if (dc) { dc.isOn = true; dc.voltage = 24; }

    sys.redrawAll && sys.redrawAll();
    await _sleep(900);
}

// ═══════════════════════════════════════════════════════════════
// 故障配置（走故障界面）
// ═══════════════════════════════════════════════════════════════

export const FAULT_CONFIGS = {
    'pump1-overload': {
        id: 'pump1-overload', name: '1. 1# 滑油泵过载', system: '滑油泵',
        check() { const s = window.sys; const l = s && s.comps && s.comps['lp1']; return !!(l && l.protection.fault === true); },
        trigger() { const s = window.sys; const l = s && s.comps && s.comps['lp1']; if (l) { l.setProtection('fault', true); s.redrawAll && s.redrawAll(); } },
        repair() { const s = window.sys; const l = s && s.comps && s.comps['lp1']; if (l && l.protection.fault) { l.setProtection('fault', false); s.redrawAll && s.redrawAll(); } },
    },
    'pump2-overload': {
        id: 'pump2-overload', name: '2. 2# 滑油泵过载', system: '滑油泵',
        check() { const s = window.sys; const l = s && s.comps && s.comps['lp2']; return !!(l && l.protection.fault === true); },
        trigger() { const s = window.sys; const l = s && s.comps && s.comps['lp2']; if (l) { l.setProtection('fault', true); s.redrawAll && s.redrawAll(); } },
        repair() { const s = window.sys; const l = s && s.comps && s.comps['lp2']; if (l && l.protection.fault) { l.setProtection('fault', false); s.redrawAll && s.redrawAll(); } },
    },
    'pump1-lowout': {
        id: 'pump1-lowout', name: '3. 1# 滑油泵泵压不足', system: '滑油泵',
        // 故障 = 1# 泵出口压力低（泵压不足）→ 压力开关动作 → 起动备用机组；备用投入后自动消除
        check() { const s = window.sys; return !!(s && s.comps['p1'] && s.comps['p1']._lowOut === true); },
        trigger() { const s = window.sys; const p = s && s.comps['p1']; if (p) { p._lowOut = true; s.redrawAll && s.redrawAll(); } },
        repair() { const s = window.sys; const p = s && s.comps['p1']; if (p) { p._lowOut = false; s.redrawAll && s.redrawAll(); } },
    },
    'pump2-lowout': {
        id: 'pump2-lowout', name: '4. 2# 滑油泵泵压不足', system: '滑油泵',
        check() { const s = window.sys; return !!(s && s.comps['p2'] && s.comps['p2']._lowOut === true); },
        trigger() { const s = window.sys; const p = s && s.comps['p2']; if (p) { p._lowOut = true; s.redrawAll && s.redrawAll(); } },
        repair() { const s = window.sys; const p = s && s.comps['p2']; if (p) { p._lowOut = false; s.redrawAll && s.redrawAll(); } },
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
            { type: 'observe', target: ownerComp || 'lp1', msg: '观察故障指示与自动切换', async act() { await _sleep(3500); } },
        ],
        check() { const s = _sysOf(this); const f = s.FAULT_CONFIG[faultId]; return !!(f && f.check()); },
    };
}

function _repairStep(msg, faultId, tip, ownerComp) {
    return {
        msg, mode: 'check',
        op: [
            { type: 'fault', fault: faultId, repair: true, msg: tip || msg, async act() { await _sleep(400); } },
            { type: 'observe', target: ownerComp || 'lp1', msg: '观察报警消失，系统恢复', async act() { await _sleep(2500); } },
        ],
        check() { const s = _sysOf(this); const f = s.FAULT_CONFIG[faultId]; return !!(f && !f.check()); },
    };
}

export const PROJECT_WORKFLOWS = {
    // ══════════════════════════════════════════════════════
    // 流程一：滑油泵的机旁起停
    // ══════════════════════════════════════════════════════
    'pump-local': {
        id: 'pump-local',
        name: '1. 滑油泵的机旁起停',
        steps: [
            {
                msg: '第 1 步：认识 1# 滑油泵的机旁控制面板（电源/运行/故障指示灯、起动/停止按钮、本地/遥控转换开关）。',
                mode: 'find', target: ['lp1'], demoTarget: ['lp1'],
            },
            {
                msg: '第 2 步：认识 1# 滑油泵（顶部遥控接口 l/r，接通即运转；中部为旋转叶轮）。',
                mode: 'find', target: ['p1'], demoTarget: ['p1'],
            },
            {
                msg: '第 3 步：点击工具栏「自动接线」，接好全部油路与电路。',
                mode: 'check',
                op: [
                    { type: 'wire', button: 'btnAutoWire', target: 'plc', flashMs: 900, holdMs: 300,
                      msg: '点击工具栏「自动接线」按钮，接好全部油路与电路',
                      async act() { const s = _sysOf(this); try { await _resetRig(s); } finally { _autoWire(s); } await _sleep(800); } },
                ],
                check() { const s = _sysOf(this); return ALL_META.every(m => _hasConn(s, m.conn.from, m.conn.to)); },
            },
            {
                msg: '第 4 步：把 1# 机旁面板切到「本地」，按压「起动」按钮，1# 滑油泵运行。',
                mode: 'check',
                op: [
                    { type: 'switch', target: 'lp1', part: 'sel-lr', msg: '点击 1# 机旁面板转换开关，切到「本地」',
                      async act() { const s = _sysOf(this); await _clickPartUntil(_comp(s, 'lp1'), 'sel-lr', () => _comp(s, 'lp1').mode === 'local', 3); } },
                    { type: 'switch', target: 'lp1', part: 'btn-start', msg: '按压 1# 机旁「起动」按钮',
                      async act() { const s = _sysOf(this); const lp = _comp(s, 'lp1'); lp.pressStart(); await _sleep(800); } },
                    { type: 'observe', target: 'p1', msg: '观察 KM1 接触器吸合、1# 滑油泵叶轮旋转',
                      async act() { const s = _sysOf(this); await _waitFor(s, x => { const p = _comp(x, 'p1'); return p && p.running; }, 8000, 200); await _sleep(1800); } },
                ],
                check() { const s = _sysOf(this); const p = _comp(s, 'p1'); return !!(p && p.running === true); },
            },
            {
                msg: '第 5 步：按压 1# 机旁面板「停止」按钮，1# 滑油泵停止运行。',
                mode: 'check',
                op: [
                    { type: 'switch', target: 'lp1', part: 'btn-stop', msg: '按压 1# 机旁「停止」按钮',
                      async act() { const s = _sysOf(this); const lp = _comp(s, 'lp1'); lp.pressStop(); await _sleep(1200); } },
                    { type: 'observe', target: 'p1', msg: '观察 KM1 释放、1# 滑油泵停止',
                      async act() { const s = _sysOf(this); await _waitFor(s, x => { const p = _comp(x, 'p1'); return p && !p.running; }, 8000, 200); await _sleep(1000); } },
                ],
                check() { const s = _sysOf(this); const p = _comp(s, 'p1'); return !!(p && p.running === false); },
            },
        ],
    },

    // ══════════════════════════════════════════════════════
    // 流程二：滑油泵的遥控手动起停
    // ══════════════════════════════════════════════════════
    'pump-remote': {
        id: 'pump-remote',
        name: '2. 滑油泵的遥控手动起停',
        steps: [
            {
                msg: '第 1 步：认识 1# 滑油泵遥控面板（电源/备用/运行/故障指示灯、加热器、手动-自动选择、启动/停复位按钮）。',
                mode: 'find', target: ['rp1'], demoTarget: ['rp1'],
            },
            {
                msg: '第 2 步：点击工具栏「自动接线」，并把 1# 机旁面板切到「遥控」。',
                mode: 'check',
                op: [
                    { type: 'wire', button: 'btnAutoWire', target: 'plc', flashMs: 900, holdMs: 300,
                      msg: '点击工具栏「自动接线」按钮，接好全部油路与电路',
                      async act() { const s = _sysOf(this); try { await _resetRig(s); } finally { _autoWire(s); } await _sleep(700); } },
                    { type: 'switch', target: 'lp1', part: 'sel-lr', msg: '1# 机旁面板转换开关切到「遥控」',
                      async act() { const s = _sysOf(this); await _clickPartUntil(_comp(s, 'lp1'), 'sel-lr', () => _comp(s, 'lp1').mode === 'remote', 3); } },
                ],
                check() { const s = _sysOf(this); const l = _comp(s, 'lp1'); return !!(l && l.mode === 'remote'); },
            },
            {
                msg: '第 3 步：在 1# 遥控面板选择「手动」，按压「启动」按钮，遥控开启 1# 滑油泵。',
                mode: 'check',
                op: [
                    { type: 'switch', target: 'rp1', part: 'sel-auto', msg: '1# 遥控面板模式选择「手动」',
                      async act() { const s = _sysOf(this); await _clickPartUntil(_comp(s, 'rp1'), 'sel-auto', () => _comp(s, 'rp1').auto === false, 3); } },
                    { type: 'switch', target: 'rp1', part: 'btn-run', msg: '点动按压 1# 遥控面板「启动」按钮',
                      async act() { const s = _sysOf(this); const rp = _comp(s, 'rp1'); rp.pressStart(); await _sleep(600); rp.releaseStart(); await _sleep(1500); } },
                    { type: 'observe', target: 'p1', msg: '观察 PLC 起保停自锁、KM1 吸合、1# 滑油泵运行',
                      async act() { const s = _sysOf(this); await _waitFor(s, x => { const p = _comp(x, 'p1'); return p && p.running; }, 8000, 200); await _sleep(1800); } },
                ],
                check() { const s = _sysOf(this); const p = _comp(s, 'p1'); return !!(p && p.running === true); },
            },
            {
                msg: '第 4 步：按压 1# 遥控面板「停止」按钮，遥控停止 1# 滑油泵。',
                mode: 'check',
                op: [
                    { type: 'switch', target: 'rp1', part: 'btn-stop', msg: '点动按压 1# 遥控面板「停止」按钮',
                      async act() { const s = _sysOf(this); const rp = _comp(s, 'rp1'); rp.pressStop(); await _sleep(600); rp.releaseStop(); await _sleep(1500); } },
                    { type: 'observe', target: 'p1', msg: '观察 KM1 释放、1# 滑油泵停止',
                      async act() { const s = _sysOf(this); await _waitFor(s, x => { const p = _comp(x, 'p1'); return p && !p.running; }, 8000, 200); await _sleep(1000); } },
                ],
                check() { const s = _sysOf(this); const p = _comp(s, 'p1'); return !!(p && p.running === false); },
            },
        ],
    },

    // ══════════════════════════════════════════════════════
    // 流程三：滑油泵的自动切换控制（运行泵泵压不足）
    // ══════════════════════════════════════════════════════
    'pump-auto-low': {
        id: 'pump-auto-low',
        name: '3. 滑油泵的自动切换（运行泵泵压不足）',
        steps: [
            {
                msg: '第 1 步：点击工具栏「自动接线」，把 1#、2# 机旁面板切到「遥控」，两遥控面板切到「自动」。',
                mode: 'check',
                op: [
                    { type: 'wire', button: 'btnAutoWire', target: 'plc', flashMs: 900, holdMs: 300,
                      msg: '点击工具栏「自动接线」按钮',
                      async act() { const s = _sysOf(this); try { await _resetRig(s); } finally { _autoWire(s); } await _sleep(600); } },
                    { type: 'switch', target: 'lp1', part: 'sel-lr', msg: '1# 机旁面板切「遥控」',
                      async act() { const s = _sysOf(this); await _clickPartUntil(_comp(s, 'lp1'), 'sel-lr', () => _comp(s, 'lp1').mode === 'remote', 3); } },
                    { type: 'switch', target: 'lp2', part: 'sel-lr', msg: '2# 机旁面板切「遥控」',
                      async act() { const s = _sysOf(this); await _clickPartUntil(_comp(s, 'lp2'), 'sel-lr', () => _comp(s, 'lp2').mode === 'remote', 3); } },
                    { type: 'switch', target: 'rp1', part: 'sel-auto', msg: '1# 遥控面板切「自动」',
                      async act() { const s = _sysOf(this); await _clickPartUntil(_comp(s, 'rp1'), 'sel-auto', () => _comp(s, 'rp1').auto === true, 3); } },
                    { type: 'switch', target: 'rp2', part: 'sel-auto', msg: '2# 遥控面板切「自动」',
                      async act() { const s = _sysOf(this); await _clickPartUntil(_comp(s, 'rp2'), 'sel-auto', () => _comp(s, 'rp2').auto === true, 3); } },
                ],
                check() {
                    const s = _sysOf(this);
                    const l1 = _comp(s, 'lp1'), l2 = _comp(s, 'lp2'), r1 = _comp(s, 'rp1'), r2 = _comp(s, 'rp2');
                    return !!(ALL_META.every(m => _hasConn(s, m.conn.from, m.conn.to))
                        && l1 && l1.mode === 'remote' && l2 && l2.mode === 'remote'
                        && r1 && r1.auto === true && r2 && r2.auto === true);
                },
            },
            {
                msg: '第 2 步：观察 1# 滑油泵作为主用泵连续运行（出口压力约 0.5 MPa），2# 处于备用（备用灯亮）。',
                mode: 'check',
                op: [
                    { type: 'observe', target: 'p1', msg: '观察 1# 主用泵运行、系统压力约 0.5 MPa',
                      async act() { const s = _sysOf(this); await _waitFor(s, x => { const p = _comp(x, 'p1'); return p && p.running; }, 10000, 250); await _sleep(1500); } },
                ],
                check() { const s = _sysOf(this); const p1 = _comp(s, 'p1'), p2 = _comp(s, 'p2'); return !!(p1 && p1.running && p2 && !p2.running); },
            },
            {
                msg: '第 3 步：设置「1# 滑油泵泵压不足」故障——1# 出口压力下降，压力开关低于 0.2 MPa 常闭触点闭合，经 3s 延时自动投入 2# 备用泵。',
                mode: 'check',
                op: [
                    { type: 'fault', fault: 'pump1-lowout', msg: '打开故障设置界面，勾选「1# 滑油泵泵压不足」并应用', async act() { await _sleep(400); } },
                    { type: 'observe', target: 'p2', msg: '观察运行泵出口压力下降、常闭触点闭合，3s 延时后 2# 备用泵自动投入',
                      async act() { const s = _sysOf(this); await _waitFor(s, x => { const p = _comp(x, 'p2'); return p && p.running; }, 15000, 250); await _sleep(1500); } },
                ],
                check() { const s = _sysOf(this); const p2 = _comp(s, 'p2'); return !!(p2 && p2.running); },
            },
            {
                msg: '第 4 步：手动取消「1# 滑油泵泵压不足」故障——压力恢复（> 0.3 MPa）后切除原 1# 运行泵，2# 成为新的运行泵。',
                mode: 'check',
                op: [
                    { type: 'fault', fault: 'pump1-lowout', repair: true, msg: '打开故障设置界面，取消勾选「1# 滑油泵泵压不足」并应用', async act() { await _sleep(400); } },
                    { type: 'observe', target: 'p1', msg: '观察故障消除、压力恢复后原 1# 运行泵被切除，2# 继续运行',
                      async act() { const s = _sysOf(this); await _waitFor(s, x => { const p = _comp(x, 'p1'); return p && !p.running; }, 15000, 250); await _sleep(1500); } },
                ],
                check() {
                    const s = _sysOf(this);
                    const f = s.FAULT_CONFIG['pump1-lowout'];
                    const p1 = _comp(s, 'p1'), p2 = _comp(s, 'p2');
                    return !!(f && !f.check() && p1 && !p1.running && p2 && p2.running);
                },
            },
        ],
    },

    // ══════════════════════════════════════════════════════
    // 流程四：滑油泵的故障自动切换（运行泵故障跳闸）
    // ══════════════════════════════════════════════════════
    'pump-auto-fault': {
        id: 'pump-auto-fault',
        name: '4. 滑油泵的故障自动切换（故障跳闸）',
        steps: [
            {
                msg: '第 1 步：点击工具栏「自动接线」，把 1#、2# 机旁面板切到「遥控」，两遥控面板切到「自动」。',
                mode: 'check',
                op: [
                    { type: 'wire', button: 'btnAutoWire', target: 'plc', flashMs: 900, holdMs: 300,
                      msg: '点击工具栏「自动接线」按钮',
                      async act() { const s = _sysOf(this); try { await _resetRig(s); } finally { _autoWire(s); } await _sleep(600); } },
                    { type: 'switch', target: 'lp1', part: 'sel-lr', msg: '1# 机旁面板切「遥控」',
                      async act() { const s = _sysOf(this); await _clickPartUntil(_comp(s, 'lp1'), 'sel-lr', () => _comp(s, 'lp1').mode === 'remote', 3); } },
                    { type: 'switch', target: 'lp2', part: 'sel-lr', msg: '2# 机旁面板切「遥控」',
                      async act() { const s = _sysOf(this); await _clickPartUntil(_comp(s, 'lp2'), 'sel-lr', () => _comp(s, 'lp2').mode === 'remote', 3); } },
                    { type: 'switch', target: 'rp1', part: 'sel-auto', msg: '1# 遥控面板切「自动」',
                      async act() { const s = _sysOf(this); await _clickPartUntil(_comp(s, 'rp1'), 'sel-auto', () => _comp(s, 'rp1').auto === true, 3); } },
                    { type: 'switch', target: 'rp2', part: 'sel-auto', msg: '2# 遥控面板切「自动」',
                      async act() { const s = _sysOf(this); await _clickPartUntil(_comp(s, 'rp2'), 'sel-auto', () => _comp(s, 'rp2').auto === true, 3); } },
                ],
                check() {
                    const s = _sysOf(this);
                    const l1 = _comp(s, 'lp1'), l2 = _comp(s, 'lp2'), r1 = _comp(s, 'rp1'), r2 = _comp(s, 'rp2');
                    return !!(ALL_META.every(m => _hasConn(s, m.conn.from, m.conn.to))
                        && l1 && l1.mode === 'remote' && l2 && l2.mode === 'remote'
                        && r1 && r1.auto === true && r2 && r2.auto === true);
                },
            },
            {
                msg: '第 2 步：观察 1# 滑油泵作为主用泵运行、2# 处于备用。',
                mode: 'check',
                op: [
                    { type: 'observe', target: 'p1', msg: '观察 1# 主用泵运行',
                      async act() { const s = _sysOf(this); await _waitFor(s, x => { const p = _comp(x, 'p1'); return p && p.running; }, 10000, 250); await _sleep(1200); } },
                ],
                check() { const s = _sysOf(this); const p1 = _comp(s, 'p1'), p2 = _comp(s, 'p2'); return !!(p1 && p1.running && p2 && !p2.running); },
            },
            {
                msg: '第 3 步：设置「1# 滑油泵过载」——1# 跳闸停机，备用泵延时 5s 后自动投入。',
                mode: 'check',
                op: [
                    { type: 'fault', fault: 'pump1-overload', msg: '打开故障设置界面，勾选「1# 滑油泵过载」并应用', async act() { await _sleep(400); } },
                    { type: 'observe', target: 'p2', msg: '观察 1# 跳闸停机、延时 5s 后 2# 备用泵自动投入',
                      async act() { const s = _sysOf(this); await _waitFor(s, x => { const p = _comp(x, 'p2'); return p && p.running; }, 15000, 250); await _sleep(1500); } },
                ],
                check() {
                    const s = _sysOf(this);
                    const f = s.FAULT_CONFIG['pump1-overload'];
                    const p1 = _comp(s, 'p1'), p2 = _comp(s, 'p2');
                    return !!(f && f.check() && p1 && !p1.running && p2 && p2.running);
                },
            },
            {
                msg: '第 4 步：修复「1# 滑油泵过载」故障后，在 1# 遥控面板按「停/复位」解除故障锁存，2# 作为运行泵继续运行（1# 转为备用）。',
                mode: 'check',
                op: [
                    { type: 'fault', fault: 'pump1-overload', repair: true, msg: '打开故障设置界面，取消勾选「1# 滑油泵过载」并应用', async act() { await _sleep(400); } },
                    { type: 'switch', target: 'rp1', part: 'btn-stop', msg: '机旁故障信号消失后，在 1# 遥控面板按「停/复位」解除故障锁存',
                      async act() { const s = _sysOf(this); const rp = _comp(s, 'rp1'); rp.pressStop(); await _sleep(700); rp.releaseStop(); await _sleep(1500); } },
                    { type: 'observe', target: 'rp1', msg: '观察 1# 遥控面板故障灯熄灭、故障锁存解除', async act() { await _sleep(2000); } },
                ],
                check() {
                    const s = _sysOf(this);
                    const f = s.FAULT_CONFIG['pump1-overload'];
                    const rp1 = _comp(s, 'rp1'), p2 = _comp(s, 'p2');
                    return !!(f && !f.check() && rp1 && !rp1._faultNow && p2 && p2.running);
                },
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
        id: 1, name: '机旁滑油控制',
        comps: ['tank', 'tee1', 'p1', 'p2', 'cv1', 'cv2', 'tee2', 'teem', 'yt', 'p24-yt',
            'tee3', 'cooler', 'valve', 'tee4', 'f1', 'f2', 'tee5', 'engine',
            'lp1', 'p24-lp1', 'lp2', 'p24-lp2', 'coil1', 'coil2', 'aux1no', 'aux2no', 'gnd1', 'gnd2', 'xpl1',
            'multimeter', 'mf47-panel', 'osc', 'sg', 'cali', 'elecmeter', 'megohm'],
        desc: '滑油循环柜 → 两台并联滑油泵（1# 上、2# 下，各经单向截止阀）→ 汇流三通 → 冷却器／旁通（电动调节阀）→ 手动滤器／自清洗滤器 → 柴油机 → 循环柜；出口双位压力继电器；两台泵各配机旁控制面板（电源/运行/过载灯 + 起动/停止 + 本地/遥控）。',
    },
    {
        id: 2, name: '遥控与 PLC 控制',
        comps: ['rp1', 'p24-rp1', 'rp2', 'p24-rp2', 'plc', 'em1', 'step7pc', 'dc24', 'xpl2', 'gnd0'],
        desc: '1#/2# 滑油泵遥控面板（电源/备用/运行/故障、加热器、手动-自动、启动/停复位）与 SR20 PLC（含 EM DI08 扩展模块、24V 电源），实现两台滑油泵的远方手动/自动控制与故障自动切换。',
    },
];

// ═══════════════════════════════════════════════════════════════
// 组件配置（1920 × 1080 基准坐标）
// ═══════════════════════════════════════════════════════════════

export const componentConfigs = [
    // ══ 页 1：滑油循环柜 / 泵组 / 阀组（整体 x +300）══
    { Class: Engine, id: 'engine', x: 420, y: 30, page: 1, visible: true },
    { Class: LubeOilTank, id: 'tank', x: 280, y: 280, page: 1, label: '滑油循环柜', initLevel: 60, visible: true },
    { Class: TeeConnector, id: 'tee1', x: 550, y: 540, page: 1, direction: 'left', visible: true },
    { Class: LubeOilPump, id: 'p1', x: 700, y: 420, page: 1, label: '1# 滑油泵', visible: true },
    { Class: LubeOilPump, id: 'p2', x: 700, y: 680, page: 1, label: '2# 滑油泵', visible: true },
    { Class: CheckValve, id: 'cv1', x: 920, y: 480, page: 1, isOpen: true, label: '1# 单向阀', visible: true },
    { Class: CheckValve, id: 'cv2', x: 920, y: 730, page: 1, isOpen: true, label: '2# 单向阀', visible: true },
    { Class: TeeConnector, id: 'tee2', x: 1060, y: 570, page: 1, direction: 'right', visible: true },
    { Class: TeeConnector, id: 'teem', x: 1230, y: 570, page: 1, direction: 'up', visible: true },
    { Class: PressRelay, id: 'yt', x: 1150, y: 320, page: 1, scale: 0.6, model: 'YT1226',
      lowStart: 0.2, lowEnd: 0.2, diffStart: 0.1, diffEnd: 0.1, visible: true },
    { Class: PotentialTerminal, id: 'p24-yt', x: 1360, y: 360, page: 1, potential: 24, visible: true },

    { Class: TeeConnector, id: 'tee3', x: 1420, y: 560, page: 1, direction: 'left', visible: true },
    { Class: Cooler, id: 'cooler', x: 1450, y: 760, page: 1, width: 240, height: 120, label: '滑油冷却器', visible: true },
    { Class: ElecValve, id: 'valve', x: 1620, y: 500, page: 1, label: '滑油温度调节阀', controlMode: 'MANUAL', visible: true },
    { Class: TeeConnector, id: 'tee4', x: 1350, y: 80, page: 1, direction: 'right', visible: true },
    { Class: OilFilter, id: 'f1', x: 1060, y: 30, page: 1, label: '手动滤器', mode: 'manual', visible: true },
    { Class: OilFilter, id: 'f2', x: 1060, y: 190, page: 1, label: '自清洗滤器', mode: 'selfclean', visible: true },
    { Class: TeeConnector, id: 'tee5', x: 820, y: 80, page: 1, direction: 'left', visible: true },

    // ══ 页 1：机旁控制面板与接触器回路（整体 x +300）══
    { Class: LubeOilPumpLocalPanel, id: 'lp1', x: -50, y: 560, page: 1, ownerId: 'p1', contactorId: 'KM1', mode: 'local', label: '1# 机旁滑油控制', visible: true },
    { Class: PotentialTerminal, id: 'p24-lp1', x: -120, y: 660, page: 1, potential: 24, visible: true },
    { Class: LubeOilPumpLocalPanel, id: 'lp2', x: 250, y: 560, page: 1, ownerId: 'p2', contactorId: 'KM2', mode: 'local', label: '2# 机旁滑油控制', visible: true },
    { Class: PotentialTerminal, id: 'p24-lp2', x: 220, y: 660, page: 1, potential: 24, visible: true },
    { Class: ContactorCoil, id: 'coil1', x: -60, y: 760, page: 1, deviceid: 'KM1', ratedCoilVoltage: 24, visible: true },
    { Class: ContactorCoil, id: 'coil2', x: 220, y: 760, page: 1, deviceid: 'KM2', ratedCoilVoltage: 24, visible: true },
    { Class: AuxNOContact, id: 'aux1no', x: 680, y: 330, page: 1, deviceid: 'KM1', visible: true },
    { Class: AuxNOContact, id: 'aux2no', x: 680, y: 600, page: 1, deviceid: 'KM2', visible: true },
    { Class: Ground, id: 'gnd1', x: 100, y: 850, page: 1, visible: true },
    { Class: Ground, id: 'gnd2', x: 320, y: 850, page: 1, visible: true },
    { Class: PageLink, id: 'xpl1', x: 90, y: 910, page: 1, deviceid: 'XPL', pairs: 12, label: '跨页连接器 · 页1', visible: true },

    // ══ 页 2：遥控面板 + PLC + EM DI08 + 电源 + 跨页连接器 ══
    { Class: LubeOilPumpRemotePanel, id: 'rp1', x: 320, y: 30, page: 2, ownerId: 'p1', localPanelId: 'lp1', contactorId: 'KM1', title: '1号滑油泵', auto: false, visible: true },
    { Class: PotentialTerminal, id: 'p24-rp1', x: 240, y: 260, page: 2, potential: 24, visible: true },
    { Class: LubeOilPumpRemotePanel, id: 'rp2', x: 320, y: 410, page: 2, ownerId: 'p2', localPanelId: 'lp2', contactorId: 'KM2', title: '2号滑油泵', auto: false, visible: true },
    { Class: PotentialTerminal, id: 'p24-rp2', x: 240, y: 600, page: 2, potential: 24, visible: true },
    { Class: S7_200_SMART_ST20, id: 'plc', x: 700, y: 180, page: 2, label: 'SR20', mode: 'RUN', program: PLC_PROGRAM, visible: true },
    { Class: S7_200_EM_DI08, id: 'em1', x: 1080, y: 180, page: 2, attachTo: 'plc', visible: true },
    { Class: STEP7PC, id: 'step7pc', x: 1380, y: 220, page: 2, label: '上位机 (监控/编程)', visible: true },
    { Class: DCPower, id: 'dc24', x: 320, y: 730, page: 2, voltage: 24, isOn: true, visible: true },
    { Class: Ground, id: 'gnd0', x: 400, y: 980, page: 2, visible: true },
    { Class: PageLink, id: 'xpl2', x: 680, y: 830, page: 2, deviceid: 'XPL', pairs: 12, label: '跨页连接器 · 页2', visible: true },

    // ══ 7 种标准仪表（默认隐藏，页 1，整体 x +300）══
    { Class: Multimeter, id: 'multimeter', x: 1260, y: 180, page: 1, visible: false },
    { Class: MF47Multimeter, id: 'mf47-panel', x: 340, y: 300, page: 1, visible: false },
    { Class: Oscilloscope_tri, id: 'osc', x: 340, y: 300, page: 1, visible: false },
    { Class: SignalGenerator, id: 'sg', x: 340, y: 300, page: 1, visible: false },
    { Class: ProcessCalibrator, id: 'cali', x: 340, y: 300, page: 1, visible: false },
    { Class: ElecMeter, id: 'elecmeter', x: 340, y: 300, page: 1, visible: false },
    { Class: RealMegohmMeter, id: 'megohm', x: 340, y: 300, page: 1, visible: false },
];

// ═══════════════════════════════════════════════════════════════
// 工具栏快捷操作
// ═══════════════════════════════════════════════════════════════

export function initSlider(sys) {
    if (!sys) return;
    sys._noBlinkHighlight = true;
    sys.pageIndexTitle = '滑油泵自动切换控制系统 · 页面索引';
}

export function applyAllPresets() {
    const sys = _sysOf(this);
    if (!sys) return;
    const valve = _comp(sys, 'valve');
    if (valve) { valve.setControlMode && valve.setControlMode('MANUAL'); valve.setTarget && valve.setTarget(0.5); }
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
    const valve = _comp(sys, 'valve');
    if (!valve) return;
    const steps = [0, 25, 50, 75, 100];
    if (sys._fiveStepIdx === undefined || sys._fiveStepIdx >= steps.length) sys._fiveStepIdx = 0;
    if (valve.setControlMode) valve.setControlMode('MANUAL');
    if (valve.setTarget) valve.setTarget(steps[sys._fiveStepIdx] / 100);
    sys._fiveStepIdx = (sys._fiveStepIdx + 1) % steps.length;
    sys.redrawAll && sys.redrawAll();
}
