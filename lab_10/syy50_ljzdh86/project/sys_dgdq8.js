// ═══════════════════════════════════════════════════════════════
// 大管轮项目 8 —— 监测系统的故障诊断（船舶机舱 CAN 总线监测报警系统）
//
// 组成（由旧工程 lab_01/canSys_03 迁移而来，并适配本平台）：
//   pterm-*/gnd-*  每个 CAN 模块右上角就近配置的 24V 电位端子与接地端子
//                  （替代集中式直流电源，缩短供电连线、减少布线杂乱）
//   gnd      接地
//   ai       模拟量输入模块（DPU 节点1，4-20mA / RTD / TC）
//   ao       模拟量输出模块（DPU 节点2）
//   di       数字量输入模块（DPU 节点3）
//   do       数字量输出模块（DPU 节点4）
//   btnstop  报警测试常闭按钮
//   prelay   压力继电器（把按钮信号送到 DI 通道）
//   vrelay   电压继电器（继电器板输出触头，驱动报警器）
//   busc-*   CAN 总线连接器（复合设备子组件，每个 CAN 设备下方一个；
//            H/L 端口全局同簇，设备接到上方两端口即挂到总线）
//   tank     液位双位控制系统（模拟量输入源 / DO 执行机构）
//   fuel     燃油加热器（温度测点 / AO 执行机构）
//   cc       中央监控计算机（监测报警主机）
//   alarm    声光报警器
//
// 两条流程（对应任务 8.1 ~ 8.2）：
//   8.1 监测系统通信总线状态检测和故障判定        —— DPU 通信线路故障
//   8.2 监测系统模块、通道故障判定和处理          —— DPU 输入通道故障（启用备用通道）

// 自动演示规范（见全局 AGENTS）：
//   · 动作前先闪烁箭头指示目标；op 数组逐个「指示 → 执行 act → 间隔」
//   · 接线箭头指向端口（op.ports），操作箭头指向子部件（op.part）
//   · 故障设置/修复一律走故障界面（type:'fault'）
//   · 调出仪表一律走仪表界面（type:'instrument'）
//   · 接线 ≤8 根一律动画接线（addConnectionAnimated），逐根 await
//   · 演示期间抑制组件自身提示（由 Workflow 引擎统一处理）
// ═══════════════════════════════════════════════════════════════

import { Multimeter } from '../components/Multimeter.js';
import { MF47Multimeter } from '../components/MF47Multimeter.js';
import { Oscilloscope_tri } from '../components/Osc_tri.js';
import { SignalGenerator } from '../components/SignalGenerator.js';
import { ProcessCalibrator } from '../components/ProcessCalibrator.js';
import { ElecMeter } from '../components/ElecMeter.js';
import { RealMegohmMeter } from '../components/RealMegohmMeter.js';

import { AIModule } from '../can/AI.js';
import { AOModule } from '../can/AO.js';
import { DIModule } from '../can/DI.js';
import { DOModule } from '../can/DO.js';
import { CentralComputer } from '../can/CentralComputer.js';
import { CANId, CAN_FUNC } from '../can/CANBUS.js';
import { BusConnector } from '../components/BusConnector.js';
import { BusTermResistor } from '../components/BusTermResistor.js';

import { PotentialTerminal } from '../components/PotentialTerminal.js';
import { Ground } from '../components/Gnd.js';
import { AmpMeter } from '../components/AmpMeter.js';
import { WaterTankSystem } from '../components/WatertankSystem.js';
import { FuelOilHeater } from '../components/FuelHeaterSystem.js';
import { PressRelay } from '../components/PressRelay.js';
import { VoltageRelay } from '../components/VoltageRelay.js';
import { AudioVisualAlarm } from '../components/AudioVisualAlarm.js';
import { NormallyClosedPushButton } from '../components/ButtonStop.js';

// ═══════════════════════════════════════════════════════════════
// 通用辅助
// ═══════════════════════════════════════════════════════════════

/** 兼容「this = Workflow / WorkflowManager / ControlSystem / 无」几种调用姿势取 sys */
const _sysOf = (ctx) => (ctx && ctx.sys) ? ctx.sys : window.sys;

const _sleep = (ms) => new Promise(r => setTimeout(r, ms));

const _comp = (sys, id) => (sys && sys.comps) ? sys.comps[id] : null;

/** 无向判断两端口是否已连线 */
function _hasConn(sys, a, b) {
    return !!(sys && sys.conns) && sys.conns.some(c =>
        (c.from === a && c.to === b) || (c.from === b && c.to === a));
}

/** 判断两条连线是否等价（优先复用引擎提供的比较函数） */
function _connEq(sys, a, b) {
    if (sys && typeof sys._connEqual === 'function') return sys._connEqual(a, b);
    return (a.from === b.from && a.to === b.to) || (a.from === b.to && a.to === b.from);
}

/** 清空全部连线 */
function _clearConns(sys) {
    if (sys && Array.isArray(sys.conns)) {
        sys.conns.length = 0;
        sys.redrawAll && sys.redrawAll();
    }
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

// ── 中央计算机（cc）访问辅助 ──────────────────────────────────────
const _cc = (sys) => _comp(sys, 'cc');

/** 切换监控主机显示页面（并确保页签真的显示出来） */
function _ccShowPage(sys, idx) {
    const cc = _cc(sys);
    if (!cc) return;
    if (typeof cc.showPage === 'function') cc.showPage(idx);
    // 兜底 1：showPage 未生效时再走一次内部切换
    if (cc.activePage !== idx && typeof cc._switchPage === 'function') {
        try { cc._switchPage(idx); } catch (e) { /* ignore */ }
    }
    // 兜底 2：显式同步各页容器可见性（页签内容在隐藏容器里时学员看不到画面）
    if (Array.isArray(cc._pages)) {
        cc._pages.forEach((p, i) => { if (p && typeof p.visible === 'function' && p.visible() !== (i === idx)) p.visible(i === idx); });
    }
    // 兜底 3：visible() 变更需触发重绘才会真正显示到画布
    if (typeof cc._refreshCache === 'function') { try { cc._refreshCache(); } catch (e) { /* ignore */ } }
    if (sys && typeof sys.requestRedraw === 'function') sys.requestRedraw();
    else if (sys && typeof sys.redrawAll === 'function') sys.redrawAll();
}

/** 立即让监控主机重算一次总线状态（不等下一帧），使状态栏与接线动作同步刷新 */
function _ccRefresh(sys) {
    const cc = _cc(sys);
    if (cc && typeof cc.tick === 'function') {
        try { cc.tick(0.05); } catch (e) { /* ignore */ }
    }
    if (sys && typeof sys.redrawAll === 'function') sys.redrawAll();
}

/**
 * 像真的一样点击某个部件的 Konva 节点，触发组件自身的 click 处理逻辑
 * （模式旋钮循环切换、通道选择按钮等），而不是直接给属性赋值。
 * @param {object} comp 组件（如 cc）
 * @param {string} partId 部件 id（已由 _registerCCParts / addClickablePart 注册）
 * @returns {boolean} 是否成功触发
 */
function _firePartClick(comp, partId) {
    if (!comp) return false;
    let node = null;
    try { if (typeof comp.getClickablePartNode === 'function') node = comp.getClickablePartNode(partId); } catch (e) { /* ignore */ }
    if (!node && comp._parts && comp._parts[partId]) node = comp._parts[partId].node;
    if (!node || typeof node.fire !== 'function') {
        console.warn('[sys_dgdq8] 未找到可点击部件节点：', partId);
        return false;
    }
    try {
        node.fire('click', { evt: { cancelBubble: false } });
        return true;
    } catch (e) {
        console.warn('[sys_dgdq8] 点击部件失败：', partId, e);
        return false;
    }
}

/**
 * 反复点击模式旋钮直到通道模式变为 targetMode。
 * AI 设置页的 Mode 旋钮是循环切换（normal → disable → test → normal），
 * 最多点 4 次必回到目标状态。
 */
async function _clickModeUntil(cc, chId, targetMode) {
    if (!cc || !cc._aiRows) return false;
    const row = cc._aiRows[chId];
    if (!row) return false;
    const sys = cc.sys || window.sys;
    const aiComp = sys && sys.comps ? sys.comps['ai'] : null;
    for (let i = 0; i < 4; i++) {
        const cur = aiComp && aiComp.channels && aiComp.channels[chId]
            ? aiComp.channels[chId].mode : null;
        if (cur === targetMode) return true;
        if (!_firePartClick(cc, 'ai-' + chId + '-mode')) return false;
        await _sleep(220);
    }
    const fin = aiComp && aiComp.channels && aiComp.channels[chId] ? aiComp.channels[chId].mode : null;
    return fin === targetMode;
}

/** 点击「消音」（优先触发真实按钮，失败则直接改状态） */
function _ccMute(sys) {
    const cc = _cc(sys); if (!cc) return;
    if (cc._btnMute && typeof cc._btnMute.fire === 'function') {
        try { cc._btnMute.fire('click'); return; } catch (e) { /* fallthrough */ }
    }
    cc.activeAlarms.forEach(a => { if (!a.confirmed) a.muted = true; });
}

/** 点击「确认」 */
function _ccAck(sys) {
    const cc = _cc(sys); if (!cc) return;
    if (cc._btnAck && typeof cc._btnAck.fire === 'function') {
        try { cc._btnAck.fire('click'); return; } catch (e) { /* fallthrough */ }
    }
    cc.activeAlarms.forEach(a => { if (!a.isPhysicalActive && !a.confirmed) a.confirmed = true; });
}

/** 清除已确认的报警记录（消音 + 确认 + 清除历史） */
function _ccClearAlarms(sys) {
    const cc = _cc(sys); if (!cc) return;
    cc.activeAlarms.forEach(a => { if (!a.confirmed) a.muted = true; });
    cc.activeAlarms.forEach(a => { if (!a.isPhysicalActive && !a.confirmed) a.confirmed = true; });
    cc.activeAlarms = cc.activeAlarms.filter(a => !a.confirmed);
}

/** 判断 CAN 总线上 AI/AO/DI/DO 四节点是否都在线 */
function _canOnline(sys) {
    const bus = sys && sys.canBus;
    if (!bus || typeof bus.isNodeOnline !== 'function') return false;
    return ['ai', 'ao', 'di', 'do'].every(id => bus.isNodeOnline(id));
}

/** 系统正常运行判据：AI/AO/DI/DO 四节点全部在线（模块已就近取 24V 且接入总线） */
function _systemNormal(sys) {
    return _canOnline(sys);
}

/** 设置数字万用表档位并同步旋钮 */
function _setMultimeter(sys, mode) {
    const mm = _comp(sys, 'multimeter');
    if (!mm) return;
    mm.mode = mode;
    mm._updateAngleByMode && mm._updateAngleByMode();
}

/**
 * 按下 / 松开报警测试按钮，并复位声光报警器显示。
 * 松开时须等待继电器释放、报警回路断开后再复位 alarming，
 * 否则报警器的自锁逻辑会被下一帧 tick 重新置位。
 */
async function _pressTest(sys, on) {
    const btn = _comp(sys, 'btnstop');
    if (btn && typeof btn._setPressed === 'function') btn._setPressed(on);
    const alarm = _comp(sys, 'alarm');
    if (on) {
        if (alarm) { alarm.alarming = false; alarm.silenced = false; }
    } else {
        await _waitFor(sys, x => { const a = _comp(x, 'alarm'); return a && !a.connected; }, 4000, 100);
        if (alarm) { alarm.alarming = false; alarm.silenced = false; }
    }
    sys.redrawAll && sys.redrawAll();
}

/** 同步松开测试按钮并复位声光报警器（用于不等待的短操作） */
function _pressTestOff(sys) {
    const btn = _comp(sys, 'btnstop');
    if (btn && typeof btn._setPressed === 'function') btn._setPressed(false);
    const alarm = _comp(sys, 'alarm');
    if (alarm) { alarm.alarming = false; alarm.silenced = false; }
    sys.redrawAll && sys.redrawAll();
}

/** 通过 CAN 指令修改 AI 通道模式（normal / test / disable） */
function _setAIChannelMode(sys, chId, mode) {
    const cc = _cc(sys);
    const ai = _comp(sys, 'ai');
    if (!cc || !ai) return;
    const i = ['ch1', 'ch2', 'ch3', 'ch4'].indexOf(chId);
    const modeMap = { normal: 0, test: 1, disable: 2 };
    const data = [0x05, i & 0xFF, (modeMap[mode] || 0) & 0xFF, 0, 0, 0, 0, 0];
    // 1) 本地乐观更新，保证演示即时可见
    try {
        if (!cc.data.ai[chId]) cc.data.ai[chId] = {};
        cc.data.ai[chId].mode = mode;
        if (ai.channels && ai.channels[chId]) ai.channels[chId].mode = mode;
        cc._updateAIRowFromModule && cc._updateAIRowFromModule(chId);
    } catch (e) { /* ignore */ }
    // 2) 通过 CAN 总线下发配置帧
    try {
        const bus = sys.canBus;
        if (bus) {
            bus.send({
                id: CANId.encode(CAN_FUNC.AI_CONFIG, 1),
                extended: false, rtr: false, dlc: 8, data,
                sender: cc.id, timestamp: Date.now(),
            });
            setTimeout(() => cc._requestNodeConfig && cc._requestNodeConfig('ai', 0x0A, 0), 60);
        }
    } catch (e) { /* ignore */ }
    sys.redrawAll && sys.redrawAll();
}

/** 通过 CAN 指令切换 DO / AO 通道的自动/手动模式 */
function _sendChannelMode(sys, nodeType, chIdx, auto) {
    const cc = _cc(sys);
    if (!cc || !sys.canBus) return;
    const funcCode = nodeType === 'do' ? CAN_FUNC.DO_CMD : CAN_FUNC.AO_CMD;
    const nodeAddr = nodeType === 'do' ? 4 : 2;
    try {
        if (cc.busConnected && !cc.commFault) {
            sys.canBus.send({
                id: CANId.encode(funcCode, nodeAddr),
                extended: false, rtr: false, dlc: 8,
                data: [0x10, chIdx, auto ? 1 : 0, 0, 0, 0, 0, 0],
                sender: cc.id, timestamp: Date.now(),
            });
        }
    } catch (e) { /* ignore */ }
}

/** 把液位系统水泵阀门切到遥控模式 */
function _tankRemote(sys) {
    const tank = _comp(sys, 'tank');
    if (!tank) return;
    if (tank.pump) tank.pump.mode = 'remote';
    if (tank._modeKnob) tank._modeKnob.rotation(45);
    tank._updateRemoteCommand && tank._updateRemoteCommand();
}

/** 把燃油加热器阀门切到遥控模式 */
function _fuelRemote(sys) {
    const fuel = _comp(sys, 'fuel');
    if (!fuel) return;
    fuel.valveMode = 'remote';
    if (fuel._modeKnob) fuel._modeKnob.rotation(45);
    fuel._updateRemoteCommand && fuel._updateRemoteCommand();
}

/** 中央计算机：液位/温度控制切换到自动模式，并同步 DO/AO 模块 */
function _controlAuto(sys) {
    const cc = _cc(sys);
    if (!cc) return;
    if (cc.levelCtrl) { cc.levelCtrl.simMode = 'AUTO'; cc.levelCtrl.isManualMode = false; }
    if (cc.tempCtrl) { cc.tempCtrl.simMode = 'AUTO'; cc.tempCtrl.isManualMode = false; }

    const outCh = (cc.levelCtrl && cc.levelCtrl.outputChannel) || 'ch1';
    const tOutCh = (cc.tempCtrl && cc.tempCtrl.outputChannel) || 'ch1';
    const outIdx = outCh === 'ch2' ? 1 : 0;
    const tOutIdx = tOutCh === 'ch2' ? 1 : 0;

    const doMod = _comp(sys, 'do'), aoMod = _comp(sys, 'ao');
    if (doMod && doMod.channels && doMod.channels[outCh]) doMod.channels[outCh].mode = 'auto';
    if (aoMod && aoMod.channels && aoMod.channels[tOutCh]) aoMod.channels[tOutCh].mode = 'auto';
    if (cc.data.do && cc.data.do[outCh]) cc.data.do[outCh].mode = 'auto';
    if (cc.data.ao && cc.data.ao[tOutCh]) cc.data.ao[tOutCh].mode = 'auto';

    _sendChannelMode(sys, 'do', outIdx, true);
    _sendChannelMode(sys, 'ao', tOutIdx, true);
}

// ═══════════════════════════════════════════════════════════════
// 接线表（target / ports 供接线步骤箭头指向端口）
// ═══════════════════════════════════════════════════════════════

// ① 模块 24V 供电（8 根短线）：每个 CAN 模块右上角就近取 24V 电位端子与地，
//    不再使用集中式直流电源，避免多模块共用电源造成的大量长距离连线。
const WIRE_POWER = [
    { conn: { from: 'ai_wire_vcc', to: 'pterm-ai_wire_p', type: 'wire' }, target: 'ai', ports: ['ai_wire_vcc', 'pterm-ai_wire_p'], msg: '供电①：AI 模块 VCC(+) → 其右上角 24V 电位端子' },
    { conn: { from: 'ai_wire_gnd', to: 'gnd-ai_wire_gnd', type: 'wire' }, target: 'ai', ports: ['ai_wire_gnd', 'gnd-ai_wire_gnd'], msg: '供电②：AI 模块 GND(-) → 其右上角接地端子' },
    { conn: { from: 'ao_wire_vcc', to: 'pterm-ao_wire_p', type: 'wire' }, target: 'ao', ports: ['ao_wire_vcc', 'pterm-ao_wire_p'], msg: '供电③：AO 模块 VCC(+) → 其右上角 24V 电位端子' },
    { conn: { from: 'ao_wire_gnd', to: 'gnd-ao_wire_gnd', type: 'wire' }, target: 'ao', ports: ['ao_wire_gnd', 'gnd-ao_wire_gnd'], msg: '供电④：AO 模块 GND(-) → 其右上角接地端子' },
    { conn: { from: 'di_wire_vcc', to: 'pterm-di_wire_p', type: 'wire' }, target: 'di', ports: ['di_wire_vcc', 'pterm-di_wire_p'], msg: '供电⑤：DI 模块 VCC(+) → 其右上角 24V 电位端子' },
    { conn: { from: 'di_wire_gnd', to: 'gnd-di_wire_gnd', type: 'wire' }, target: 'di', ports: ['di_wire_gnd', 'gnd-di_wire_gnd'], msg: '供电⑥：DI 模块 GND(-) → 其右上角接地端子' },
    { conn: { from: 'do_wire_vcc', to: 'pterm-do_wire_p', type: 'wire' }, target: 'do', ports: ['do_wire_vcc', 'pterm-do_wire_p'], msg: '供电⑦：DO 模块 VCC(+) → 其右上角 24V 电位端子' },
    { conn: { from: 'do_wire_gnd', to: 'gnd-do_wire_gnd', type: 'wire' }, target: 'do', ports: ['do_wire_gnd', 'gnd-do_wire_gnd'], msg: '供电⑧：DO 模块 GND(-) → 其右上角接地端子' },
];

// ② CAN 总线通信（10 根）：每台 CAN 设备接到其下方总线连接器的 CANH/CANL。
//    各连接器的 H/L 端口由 CircuitTopology 全局同簇，因此无需在连接器之间拉线，
//    接上连接器上方两个端口即等同挂到整条总线上。
const WIRE_CAN = [
    { conn: { from: 'ai_wire_can1p', to: 'busc-ai_wire_canh', type: 'wire' }, target: 'ai', ports: ['ai_wire_can1p', 'busc-ai_wire_canh'], msg: '通信①：AI 模块 CANH → 其下方总线连接器 CANH' },
    { conn: { from: 'ai_wire_can1n', to: 'busc-ai_wire_canl', type: 'wire' }, target: 'ai', ports: ['ai_wire_can1n', 'busc-ai_wire_canl'], msg: '通信②：AI 模块 CANL → 其下方总线连接器 CANL' },
    { conn: { from: 'ao_wire_can1p', to: 'busc-ao_wire_canh', type: 'wire' }, target: 'ao', ports: ['ao_wire_can1p', 'busc-ao_wire_canh'], msg: '通信③：AO 模块 CANH → 其下方总线连接器 CANH' },
    { conn: { from: 'ao_wire_can1n', to: 'busc-ao_wire_canl', type: 'wire' }, target: 'ao', ports: ['ao_wire_can1n', 'busc-ao_wire_canl'], msg: '通信④：AO 模块 CANL → 其下方总线连接器 CANL' },
    { conn: { from: 'di_wire_can1p', to: 'busc-di_wire_canh', type: 'wire' }, target: 'di', ports: ['di_wire_can1p', 'busc-di_wire_canh'], msg: '通信⑤：DI 模块 CANH → 其下方总线连接器 CANH' },
    { conn: { from: 'di_wire_can1n', to: 'busc-di_wire_canl', type: 'wire' }, target: 'di', ports: ['di_wire_can1n', 'busc-di_wire_canl'], msg: '通信⑥：DI 模块 CANL → 其下方总线连接器 CANL' },
    { conn: { from: 'do_wire_can1p', to: 'busc-do_wire_canh', type: 'wire' }, target: 'do', ports: ['do_wire_can1p', 'busc-do_wire_canh'], msg: '通信⑦：DO 模块 CANH → 其下方总线连接器 CANH' },
    { conn: { from: 'do_wire_can1n', to: 'busc-do_wire_canl', type: 'wire' }, target: 'do', ports: ['do_wire_can1n', 'busc-do_wire_canl'], msg: '通信⑧：DO 模块 CANL → 其下方总线连接器 CANL' },
    { conn: { from: 'cc_wire_can1p', to: 'busc-cc_wire_canh', type: 'wire' }, target: 'cc', ports: ['cc_wire_can1p', 'busc-cc_wire_canh'], msg: '通信⑨：监控主机 CANH → 其下方总线连接器 CANH' },
    { conn: { from: 'cc_wire_can1n', to: 'busc-cc_wire_canl', type: 'wire' }, target: 'cc', ports: ['cc_wire_can1n', 'busc-cc_wire_canl'], msg: '通信⑩：监控主机 CANL → 其下方总线连接器 CANL' },
    // CC 侧 120Ω 终端电阻（自动接线）
    { conn: { from: 'term-cc_wire_l', to: 'busc-cc_wire_canhL', type: 'wire' }, target: 'term-cc', ports: ['term-cc_wire_l', 'busc-cc_wire_canhL'], msg: '终端①：CC 侧 120Ω 电阻 CANH → 总线连接器 CANH（左）' },
    { conn: { from: 'term-cc_wire_r', to: 'busc-cc_wire_canlL', type: 'wire' }, target: 'term-cc', ports: ['term-cc_wire_r', 'busc-cc_wire_canlL'], msg: '终端②：CC 侧 120Ω 电阻 CANL → 总线连接器 CANL（左）' },
];

// ③ 液位系统信号（4 根，默认接 AI CH1 与 DO CH1）
const WIRE_TANK = [
    { conn: { from: 'tank_wire_p', to: 'ai_wire_ch1p', type: 'wire' }, target: 'tank', ports: ['tank_wire_p', 'ai_wire_ch1p'], msg: '接线⑪：液位变送器 P(+) → AI CH1(+)' },
    { conn: { from: 'tank_wire_n', to: 'ai_wire_ch1n', type: 'wire' }, target: 'tank', ports: ['tank_wire_n', 'ai_wire_ch1n'], msg: '接线⑫：液位变送器 N(-) → AI CH1(-)' },
    { conn: { from: 'tank_wire_l', to: 'do_wire_ch1p', type: 'wire' }, target: 'tank', ports: ['tank_wire_l', 'do_wire_ch1p'], msg: '接线⑬：水泵控制 L → DO CH1(+)' },
    { conn: { from: 'tank_wire_r', to: 'do_wire_ch1n', type: 'wire' }, target: 'tank', ports: ['tank_wire_r', 'do_wire_ch1n'], msg: '接线⑭：水泵控制 R → DO CH1(-)' },
];

// ④ 燃油加热器温度信号（4 根，接 AI CH3 与 AO CH1）
const WIRE_FUEL = [
    { conn: { from: 'fuel_wire_l', to: 'ai_wire_ch3p', type: 'wire' }, target: 'fuel', ports: ['fuel_wire_l', 'ai_wire_ch3p'], msg: '接线⑮：加热器测温 L → AI CH3(+)' },
    { conn: { from: 'fuel_wire_r', to: 'ai_wire_ch3n', type: 'wire' }, target: 'fuel', ports: ['fuel_wire_r', 'ai_wire_ch3n'], msg: '接线⑯：加热器测温 R → AI CH3(-)' },
    { conn: { from: 'fuel_wire_p', to: 'ao_wire_ch1p', type: 'wire' }, target: 'fuel', ports: ['fuel_wire_p', 'ao_wire_ch1p'], msg: '接线⑰：加热器阀门 P → AO CH1(+)' },
    { conn: { from: 'fuel_wire_n', to: 'ao_wire_ch1n', type: 'wire' }, target: 'fuel', ports: ['fuel_wire_n', 'ao_wire_ch1n'], msg: '接线⑱：加热器阀门 N → AO CH1(-)' },
];

// ⑤ 报警测试回路 + 继电器板 + 声光报警器（7 根）
const WIRE_ALARM = [
    { conn: { from: 'prelay_wire_NC', to: 'btnstop_wire_l', type: 'wire' }, target: 'prelay', ports: ['prelay_wire_NC', 'btnstop_wire_l'], msg: '接线⑲：压力继电器 NC → 报警测试按钮 NC 端' },
    { conn: { from: 'btnstop_wire_r', to: 'di_wire_ch1p', type: 'wire' }, target: 'btnstop', ports: ['btnstop_wire_r', 'di_wire_ch1p'], msg: '接线⑳：报警测试按钮 COM → DI CH1(+)' },
    { conn: { from: 'prelay_wire_COM', to: 'di_wire_ch1n', type: 'wire' }, target: 'prelay', ports: ['prelay_wire_COM', 'di_wire_ch1n'], msg: '接线㉑：压力继电器 COM → DI CH1(-)' },
    { conn: { from: 'vrelay_wire_l', to: 'do_wire_ch3p', type: 'wire' }, target: 'vrelay', ports: ['vrelay_wire_l', 'do_wire_ch3p'], msg: '接线㉒：电压继电器线圈 L → DO CH3(+)' },
    { conn: { from: 'vrelay_wire_r', to: 'do_wire_ch3n', type: 'wire' }, target: 'vrelay', ports: ['vrelay_wire_r', 'do_wire_ch3n'], msg: '接线㉓：电压继电器线圈 R → DO CH3(-)' },
    { conn: { from: 'vrelay_wire_NO', to: 'alarm_wire_l', type: 'wire' }, target: 'vrelay', ports: ['vrelay_wire_NO', 'alarm_wire_l'], msg: '接线㉔：电压继电器触头 NO → 声光报警器 A 端' },
    { conn: { from: 'vrelay_wire_COM', to: 'alarm_wire_r', type: 'wire' }, target: 'vrelay', ports: ['vrelay_wire_COM', 'alarm_wire_r'], msg: '接线㉕：电压继电器触头 COM → 声光报警器 B 端' },
];

// ⑥ 页面 2 的 4 个总线连接器左右依次互连（更直观的总线"菊花链"走线）：
//    按页面从左到右 AO → AI → DO → DI，前一个连接器的右端口 → 后一个的左端口。
//    实际电气上 H/L 端口本就全局同簇，这些连线仅为直观展示，不改变电气行为。
const WIRE_BUS_CHAIN = [
    { conn: { from: 'busc-ao_wire_canhR', to: 'busc-ai_wire_canhL', type: 'wire' }, target: 'busc-ao', ports: ['busc-ao_wire_canhR', 'busc-ai_wire_canhL'], msg: '总线互联①：AO 连接器 CANH右 → AI 连接器 CANH左' },
    { conn: { from: 'busc-ao_wire_canlR', to: 'busc-ai_wire_canlL', type: 'wire' }, target: 'busc-ao', ports: ['busc-ao_wire_canlR', 'busc-ai_wire_canlL'], msg: '总线互联②：AO 连接器 CANL右 → AI 连接器 CANL左' },
    { conn: { from: 'busc-ai_wire_canhR', to: 'busc-do_wire_canhL', type: 'wire' }, target: 'busc-ai', ports: ['busc-ai_wire_canhR', 'busc-do_wire_canhL'], msg: '总线互联③：AI 连接器 CANH右 → DO 连接器 CANH左' },
    { conn: { from: 'busc-ai_wire_canlR', to: 'busc-do_wire_canlL', type: 'wire' }, target: 'busc-ai', ports: ['busc-ai_wire_canlR', 'busc-do_wire_canlL'], msg: '总线互联④：AI 连接器 CANL右 → DO 连接器 CANL左' },
    { conn: { from: 'busc-do_wire_canhR', to: 'busc-di_wire_canhL', type: 'wire' }, target: 'busc-do', ports: ['busc-do_wire_canhR', 'busc-di_wire_canhL'], msg: '总线互联⑤：DO 连接器 CANH右 → DI 连接器 CANH左' },
    { conn: { from: 'busc-do_wire_canlR', to: 'busc-di_wire_canlL', type: 'wire' }, target: 'busc-do', ports: ['busc-do_wire_canlR', 'busc-di_wire_canlL'], msg: '总线互联⑥：DO 连接器 CANL右 → DI 连接器 CANL左' },
];

const ALL_WIRE_META = [...WIRE_POWER, ...WIRE_CAN, ...WIRE_TANK, ...WIRE_FUEL, ...WIRE_ALARM, ...WIRE_BUS_CHAIN];

// 万用表测量继电器触头（NO-COM）
const PROBE_RELAY_CONTACT = [
    { conn: { from: 'multimeter_wire_com', to: 'vrelay_wire_COM', type: 'wire' }, target: 'multimeter', ports: ['multimeter_wire_com', 'vrelay_wire_COM'], msg: '黑表笔(COM) → 电压继电器触头 COM 端' },
    { conn: { from: 'multimeter_wire_v', to: 'vrelay_wire_NO', type: 'wire' }, target: 'multimeter', ports: ['multimeter_wire_v', 'vrelay_wire_NO'], msg: '红表笔(V) → 电压继电器触头 NO 端' },
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

    const tank = _comp(sys, 'tank');
    if (tank) {
        tank.level = 50;
        if (tank.pump) { tank.pump.mode = 'local'; tank.pump.targetRunning = false; }
        if (tank._modeKnob) tank._modeKnob.rotation(-45);
    }

    const fuel = _comp(sys, 'fuel');
    if (fuel) {
        fuel.valveMode = 'local';
        if (fuel._modeKnob) fuel._modeKnob.rotation(-45);
    }

    const ai = _comp(sys, 'ai');
    if (ai) {
        ai.isBreak = false; ai.commFault = false; ai.moduleFault = false;
        ai.channelFault = false; ai.sysFault = false;
        // 未接信号的备用通道（CH2/CH4）默认为 disable，避免产生"开路故障"基线报警；
        // 8.2 流程会把 CH2 作为备用通道重新启用。
        ['ch1', 'ch2', 'ch3', 'ch4'].forEach(id => {
            const ch = ai.channels && ai.channels[id];
            if (!ch) return;
            ch.mode = (id === 'ch2' || id === 'ch4') ? 'disable' : 'normal';
            ch.fault = false;
            ch.faultText = 'normal';
        });
    }

    const vrelay = _comp(sys, 'vrelay');
    if (vrelay) { vrelay.contactFault = false; vrelay.coilFault = false; }

    const alarm = _comp(sys, 'alarm');
    if (alarm) { alarm.alarming = false; alarm.silenced = false; alarm.isBreak = false; }

    const btn = _comp(sys, 'btnstop');
    if (btn && typeof btn._setPressed === 'function') btn._setPressed(false);

    const cc = _cc(sys);
    if (cc) {
        cc.activeAlarms = [];
        cc.faultTimers = {};
        cc.commFault = false;
        if (cc.levelCtrl) {
            cc.levelCtrl.simMode = 'HAND'; cc.levelCtrl.isManualMode = false;
            cc.levelCtrl.inletOn = false; cc.levelCtrl.inputChannel = 'ch1'; cc.levelCtrl.outputChannel = 'ch1';
            cc.levelCtrl.level = 50;
        }
        if (cc.tempCtrl) {
            cc.tempCtrl.simMode = 'HAND'; cc.tempCtrl.isManualMode = false;
            cc.tempCtrl.inputChannel = 'ch3'; cc.tempCtrl.outputChannel = 'ch1'; cc.tempCtrl.valveOpen = 0;
        }
        if (cc.doManual) ['ch1', 'ch2', 'ch3', 'ch4'].forEach(id => { cc.doManual[id] = false; });
        // ── DO 通道模式基线 ──
        // ch1 = 液位系统水泵控制，ch3 = 继电器板线圈（报警测试回路），
        // 两者都必须由控制逻辑驱动，起动系统时统一置为自动模式。
        // 否则 DO 常量与 CC 内置 data.do 的初值（全 'hand'）不一致，收帧同步后
        // 会把模块从 auto 覆盖成 hand，表现为"通道1/3显示为手动、实际是自动"；
        // 更严重的是 hand 模式下输出跟随 doManual=false，线圈不得电、报警不响应。
        const doMod = _comp(sys, 'do');
        ['ch1', 'ch3'].forEach(id => {
            if (doMod && doMod.channels && doMod.channels[id]) doMod.channels[id].mode = 'auto';
            if (cc.data && cc.data.do && cc.data.do[id]) cc.data.do[id].mode = 'auto';
        });
    }

    // ── CAN 总线终端电阻：起动系统时恢复出厂默认 ──
    const term = _comp(sys, 'term-cc');
    if (term && typeof term.onConfigUpdate === 'function') term.onConfigUpdate({ enabled: true });
    else if (term) { term.enabled = true; term.currentResistance = 120; }
    ['ai', 'ao', 'di', 'do'].forEach(id => {
        const m = _comp(sys, id);
        if (!m) return;
        m.termEnabled = (id === 'di');   // 仅 DI 默认接通
        m.currentResistance = m.termEnabled ? 120 : 1000000;
        if (m._termKnob && typeof m._termKnob.fill === 'function') {
            m._termKnob.fill(m.termEnabled ? '#00aaff' : '#333');
        }
        if (m._termKnob && typeof m._termKnob.y === 'function') {
            m._termKnob.y(m.termEnabled ? 298 : 310);
        }
        // 清除总线终端电阻故障导致的通信错误锁存（起动系统 = 复位）
        m.commFault = false;
    });

    // 起动系统 = 复位基线：清除总线终端错误计数与已触发标志
    const ccMod = _comp(sys, 'cc');
    if (ccMod) {
        // busTermErrStart 必须一起清：它是"首次断开"的时间戳，若留着旧值，
        // 接线过程中出现 ok=false 的那一帧会算出巨大时长 → 立即触发并锁存，
        // 表现为"起动系统后四个模块立刻进入通信错误"。
        ccMod.busTermErrStart = 0;
        ccMod.busTermErrCount = 0;
        ccMod.busTermErrMs = 0;
        ccMod.busTermErrRemain = 0;
        ccMod.busTermTripped = false;
    }

    _setMultimeter(sys, 'OFF');

    Object.values(sys.FAULT_CONFIG || {}).forEach(f => { try { f.repair && f.repair(); } catch (e) { /* ignore */ } });

    sys.redrawAll && sys.redrawAll();
    await _sleep(300);
}

/** 瞬时接线（工具栏「自动接线」，非演示用） */
function _autoWire(sys) {
    if (!sys || !sys.connMgr) return;
    sys.conns.length = 0;
    // 逐根容错：任一连线失败都不能中止后续接线，否则后半段（含 CAN 总线、
    // 24V 供电）全部缺失，CC 将一直显示 CAN BUS OFF 且四节点无法上线。
    let failed = 0;
    ALL_WIRE_META.forEach(m => {
        try { sys.connMgr.addConn({ from: m.conn.from, to: m.conn.to, type: m.conn.type }); }
        catch (e) { failed++; console.error('[sys_dgdq8] 接线失败：', m.conn.from, '→', m.conn.to, e); }
    });
    if (failed) console.warn(`[sys_dgdq8] 共有 ${failed} 根连线接线失败，已跳过`);
    sys.redrawAll && sys.redrawAll();
}

/** 演示/培训用「系统起动」：接线 → 上电 → 泵/阀遥控 → 控制器自动 */
async function _startSystem(sys) {
    if (!sys) return;
    _autoWire(sys);
    _ccRefresh(sys);   // 接线后立即重算一次，使 CAN BUS ONLINE 与接线动作同时出现
    // 兜底：确认总线真的上线。若首帧拓扑尚未稳定导致 CC 仍显示 CAN BUS OFF，
    // 重新接线一次并再次确认，避免画面停在 OFF 状态。
    if (!await _waitFor(sys, x => _canOnline(x), 3000, 100)) {
        _autoWire(sys);
        _ccRefresh(sys);
        if (!await _waitFor(sys, x => _canOnline(x), 3000, 100)) {
            console.warn('[sys_dgdq8] 起动后 CAN 总线仍未上线，请检查总线连接器与 AI/AO/DI/DO 的 24V 供电接线');
        }
    }

    _tankRemote(sys);
    _fuelRemote(sys);
    _controlAuto(sys);

    // 上电瞬时可能使报警器误动作、且其 alarming 状态会自锁；等待系统稳定后再复位
    // 报警器与测试按钮，保证干净基线（多次复位以跨越继电器触点抖动窗口）。
    await _sleep(2200);
    await _pressTest(sys, false);
    await _sleep(900);
    await _pressTest(sys, false);

    sys.redrawAll && sys.redrawAll();
    await _sleep(600);
}

// ═══════════════════════════════════════════════════════════════
// 故障配置（走故障界面：check / trigger / repair）
// ═══════════════════════════════════════════════════════════════

export const FAULT_CONFIGS = {
    // ── 8.1 DPU 通信线路故障 ──
    'dpu-comm': {
        id: 'dpu-comm',
        name: '1. DPU 通信线路故障',
        system: '8.1',
        check() { const s = window.sys; const ai = s && s.comps && s.comps['ai']; return !!(ai && ai.commFault === true); },
        trigger() { const s = window.sys; const ai = s && s.comps && s.comps['ai']; if (ai) { ai.commFault = true; s.redrawAll && s.redrawAll(); } },
        repair() { const s = window.sys; const ai = s && s.comps && s.comps['ai']; if (ai && ai.commFault) { ai.commFault = false; s.redrawAll && s.redrawAll(); } },
    },
    // ── 8.2 DPU 输入通道故障 ──
    'dpu-channel': {
        id: 'dpu-channel',
        name: '2. DPU 输入通道故障',
        system: '8.2',
        check() { const s = window.sys; const ai = s && s.comps && s.comps['ai']; return !!(ai && ai.channelFault === true); },
        trigger() { const s = window.sys; const ai = s && s.comps && s.comps['ai']; if (ai) { ai.channelFault = true; s.redrawAll && s.redrawAll(); } },
        repair() { const s = window.sys; const ai = s && s.comps && s.comps['ai']; if (ai && ai.channelFault) { ai.channelFault = false; s.redrawAll && s.redrawAll(); } },
    },
    // ── 8.2 DPU 模块故障 ──
    'dpu-module': {
        id: 'dpu-module',
        name: '3. DPU 模块故障',
        system: '8.2',
        check() { const s = window.sys; const ai = s && s.comps && s.comps['ai']; return !!(ai && ai.moduleFault === true); },
        trigger() { const s = window.sys; const ai = s && s.comps && s.comps['ai']; if (ai) { ai.moduleFault = true; s.redrawAll && s.redrawAll(); } },
        repair() { const s = window.sys; const ai = s && s.comps && s.comps['ai']; if (ai && ai.moduleFault) { ai.moduleFault = false; s.redrawAll && s.redrawAll(); } },
    },

    // ── 9.1 继电器板触头故障 ──
    'relay-contact': {
        id: 'relay-contact',
        name: '4. 继电器板 触头故障',
        system: '9.1',
        check() { const s = window.sys; const v = s && s.comps && s.comps['vrelay']; return !!(v && v.contactFault === true); },
        trigger() { const s = window.sys; const v = s && s.comps && s.comps['vrelay']; if (v) { v.contactFault = true; s.redrawAll && s.redrawAll(); } },
        repair() { const s = window.sys; const v = s && s.comps && s.comps['vrelay']; if (v && v.contactFault) { v.contactFault = false; s.redrawAll && s.redrawAll(); } },
    },

    // ── 9.1 继电器板线圈故障 ──
    'relay-coil': {
        id: 'relay-coil',
        name: '5. 继电器板 线圈故障',
        system: '9.1',
        check() { const s = window.sys; const v = s && s.comps && s.comps['vrelay']; return !!(v && v.coilFault === true); },
        trigger() { const s = window.sys; const v = s && s.comps && s.comps['vrelay']; if (v) { v.coilFault = true; s.redrawAll && s.redrawAll(); } },
        repair() { const s = window.sys; const v = s && s.comps && s.comps['vrelay']; if (v && v.coilFault) { v.coilFault = false; s.redrawAll && s.redrawAll(); } },
    },    
    // ── 9.2 DPU 系统故障（死机）──
    'dpu-sys': {
        id: 'dpu-sys',
        name: '6. 总线节点 系统死机',
        system: '9.2',
        check() { const s = window.sys; const ai = s && s.comps && s.comps['ai']; return !!(ai && ai.sysFault === true); },
        trigger() { const s = window.sys; const ai = s && s.comps && s.comps['ai']; if (ai) { ai.sysFault = true; s.redrawAll && s.redrawAll(); } },
        repair() { const s = window.sys; const ai = s && s.comps && s.comps['ai']; if (ai && ai.sysFault) { ai.sysFault = false; s.redrawAll && s.redrawAll(); } },
    },


};

// ═══════════════════════════════════════════════════════════════
// 步骤构造器（统一「指示 → 操作 → 间隔」节奏）
// ═══════════════════════════════════════════════════════════════

/** 系统正常运行基线步骤：复位 → 接线 → 上电 → 遥控 → 自动 → 消音确认 */
function _readyStep(msg) {
    return {
        msg: msg || '第 2 步：一键接好线路并起动系统，使 CAN 总线通信正常、监控主机无报警（系统正常运行）。',
        mode: 'check',
        op: [
            {
                type: 'wire', button: 'btnStartSys', target: 'cc',
                // 短指示后立即执行：避免按钮闪烁期间画面仍停在 CAN BUS OFF
                flashMs: 1000, holdMs: 400,
                msg: '点击工具栏「起动系统」按钮（复位 → 接线 → 泵/阀遥控 → 控制器自动）',
                async act() {
                    const s = _sysOf(this);
                    try {
                        await _resetRig(s);
                    } finally {
                        // 复位会清空全部接线；无论复位是否成功都必须重建接线，
                        // 否则接线空了却没重新接上 → CC 永远显示 CAN BUS OFF，
                        // 且后面的「网络诊断」页 op 也会被异常跳过。
                        await _startSystem(s);
                    }
                    await _waitFor(s, x => { const c = _cc(x); return !!(c && c.busConnected); }, 10000, 120);
                    await _sleep(600);
                },
            },
            {
                type: 'observe', target: 'cc', part: 'tab-2',
                msg: '点击监控主机「网络诊断」页，观察 AI / AO / DI / DO 四个节点是否全部在线',
                async act() {
                    const s = _sysOf(this);
                    _ccShowPage(s, 2);
                    await _waitFor(s, x => _canOnline(x), 20000, 500);
                    _ccShowPage(s, 2);   // 再次确保「网络诊断」页已显示
                    await _sleep(3500);   // 在网络诊断页停留，便于学员看清节点状态
                },
            },
            {
                type: 'observe', target: 'cc', part: 'tab-0',
                msg: '点击「监测报警」页，对初始报警消音、确认，系统进入正常运行状态',
                async act() {
                    const s = _sysOf(this);
                    _ccShowPage(s, 0);
                    await _sleep(1500);
                    _pressTestOff(s);
                    _ccMute(s); _ccAck(s);
                    await _sleep(1200);
                },
            },
        ],
        check() { return _systemNormal(_sysOf(this)); },
    };
}

/**
 * 故障设置步骤（走故障界面）。
 * @param {string} msg       步骤说明
 * @param {string} faultId   故障 id
 * @param {string} tip       故障界面操作提示
 * @param {boolean} waitAlarm 是否等待并展示监控主机报警
 * @param {string} [waitText] 等待的报警文字关键字（缺省则等待出现任意新报警）
 */
function _faultStep(msg, faultId, tip, waitAlarm = true, waitText = '') {
    const ops = [
        { type: 'fault', fault: faultId, msg: tip || msg, async act() { await _sleep(400); } },
    ];
    if (waitAlarm) {
        ops.push({
            type: 'observe', target: 'cc', part: 'tab-0',
            msg: '等待监控主机出现报警，观察报警内容和报警声光信号',
            async act() {
                const s = _sysOf(this);
                _ccShowPage(s, 0);
                await _waitFor(s, x => {
                    const c = _cc(x);
                    if (!c) return false;
                    if (waitText) return c.activeAlarms.some(a => a.text && a.text.includes(waitText));
                    return c.activeAlarms.length > 0;
                }, 18000, 400);
                await _sleep(1800);
            },
        });
    }
    return {
        msg, mode: 'check', op: ops,
        check() {
            const s = _sysOf(this);
            const f = s.FAULT_CONFIG[faultId];
            if (!f || !f.check()) return false;          // 故障未设置成功
            // 该故障会触发报警时：必须监控主机确实产生了报警，这一步才算完成
            if (waitAlarm) {
                const c = _cc(s);
                if (!c || !Array.isArray(c.activeAlarms) || c.activeAlarms.length === 0) return false;
                if (waitText && !c.activeAlarms.some(a => a.text && a.text.includes(waitText))) return false;
            }
            return true;
        },
    };
}

/** 查看报警、消音、确认步骤 */
function _alarmStep(msg) {
    return {
        msg: msg || '查看监控主机报警，进行消音、确认。', mode: 'check',
        op: [
            {
                type: 'observe', target: 'cc', part: 'tab-0',
                msg: '观察监控主机「监测报警」页出现的故障报警记录',
                async act() { const s = _sysOf(this); _ccShowPage(s, 0); await _sleep(2200); },
            },
            {
                type: 'switch', target: 'cc', part: 'mute',
                msg: '点击「消音」，停止报警声响（报警灯转平光）',
                beforeIntro() { _ccShowPage(_sysOf(this), 0); },
                async act() { const s = _sysOf(this); _ccMute(s); await _sleep(800); },
            },
            {
                type: 'switch', target: 'cc', part: 'ack',
                msg: '点击「确认」，确认该报警',
                beforeIntro() { _ccShowPage(_sysOf(this), 0); },
                async act() { const s = _sysOf(this); _ccAck(s); await _sleep(800); },
            },
        ],
        check() { const c = _cc(_sysOf(this)); return !!(c && c.activeAlarms.every(a => a.muted)); },
    };
}

/** 故障修复步骤（走故障界面）+ 清除报警 + 恢复运行 */
function _repairStep(msg, faultId, tip, waitMs = 4500) {
    return {
        msg, mode: 'check',
        op: [
            { type: 'fault', fault: faultId, repair: true, msg: tip || msg, async act() { await _sleep(400); } },
            {
                type: 'observe', target: 'cc', part: 'tab-0',
                msg: '等待报警自动消除，消音、确认并清除报警记录，系统恢复正常运行',
                async act() {
                    const s = _sysOf(this);
                    await _sleep(waitMs);
                    _ccShowPage(s, 0);
                    // 故障期间液位控制可能受扰，待液位回到正常区间后再清除报警
                    await _waitFor(s, x => { const c = _cc(x); return c && c.levelCtrl.level > c.levelCtrl.setL; }, 25000, 500);
                    _ccClearAlarms(s);
                    await _sleep(1200);
                },
            },
        ],
        check() { const s = _sysOf(this); const f = s.FAULT_CONFIG[faultId]; return !!(f && !f.check()); },
    };
}

function _quizStep(msg, question, options, answer, analysis) {
    return { msg, mode: 'quiz', quizConfig: { question, options, answer, analysis } };
}

// ═══════════════════════════════════════════════════════════════
// 工作流
// ═══════════════════════════════════════════════════════════════

export const PROJECT_WORKFLOWS = {
    // ══════════════════════════════════════════════════════════
    // 流程一：监测系统通信总线状态检测和故障判定（8.1）
    // ══════════════════════════════════════════════════════════
    'wf-8-1': {
        id: 'wf-8-1',
        name: '8.1 监测系统通信总线状态检测和故障判定',
        steps: [
            {
                msg: '第 1 步：识别监测系统通信总线相关的部件——CAN 总线、AI 模块、中央监控计算机。',
                mode: 'find',
                target: ['ai', 'ao', 'di', 'do', 'cc', 'busc-ai', 'busc-cc'],
                demoTarget: ['busc-ai', 'ai', 'cc'],
            },
            _readyStep(),
            _faultStep(
                '第 3 步：通过「故障设置」界面设置「DPU 通信线路故障」，观察监控主机报警。',
                'dpu-comm',
                '打开「故障设置」界面，勾选「DPU 通信线路故障」，点击「应用设置」',
                true, '节点1 通信',
            ),
            _alarmStep('第 4 步：查看监控主机报警，进行消音、确认。'),
            {
                msg: '第 5 步：定位通信故障模块——观察 AI 模块的运行/故障/通信指示灯，确认通信故障。',
                mode: 'check',
                op: [
                    {
                        type: 'observe', target: 'ai',
                        msg: '观察 AI 模块指示灯：电源 PWR 常亮、运行 RUN 熄灭、故障 FLT 点亮、通信 COM 熄灭',
                        async act() { await _sleep(3200); },
                    },
                    {
                        type: 'observe', target: 'cc', part: 'tab-2',
                        msg: '在监控主机「网络诊断」页查看，AI 节点显示离线、通信超时',
                        async act() { const s = _sysOf(this); _ccShowPage(s, 2); await _sleep(3000); },
                    },
                ],
                check() {
                    const s = _sysOf(this); const f = s.FAULT_CONFIG['dpu-comm'];
                    if (!f || !f.check()) return false;
                    // 步骤要求"定位通信故障模块"：必须点击过 AI 模块，定位才算完成
                    return s.lastClickedId === 'ai';
                },
            },
            _repairStep(
                '第 6 步：修复 DPU 通信线路故障，清除报警，恢复正常运行。',
                'dpu-comm',
                '打开「故障设置」界面，取消勾选「DPU 通信线路故障」，点击「应用设置」',
            ),
            _quizStep(
                '第 7 步：通信总线故障诊断知识',
                '某 DPU 节点在监控主机上显示「通信超时/离线」，现场检查该模块电源指示灯不亮，最应该先做的是：',
                [
                    '检查该模块的 24V 供电与 CAN 总线接线是否松动、断路，恢复供电与通信',
                    '直接更换中央监控计算机',
                    '把该通道设为备用通道继续观察',
                    '忽略该报警，因为其它节点仍正常',
                ],
                0,
                '节点在总线上“失联”（通信超时）通常有三类原因：供电丢失、CAN 总线接线断路/短路、节点本身死机。现场排查应先从最简单的供电与接线查起——电源指示灯不亮即说明供电异常，检查 24V 电源与 CANH/CANL 接线并恢复后，节点重新上线报警即可消除。',
            ),
        ],
    },

    // ══════════════════════════════════════════════════════════
    // 流程二：监测系统模块、通道故障判定和处理（8.2）
    // ══════════════════════════════════════════════════════════
    'wf-8-2': {
        id: 'wf-8-2',
        name: '8.2 监测系统模块、通道故障判定和处理',
        steps: [
            {
                msg: '第 1 步：识别本流程涉及的主要部件——AI 输入模块、液位系统、中央监控计算机。',
                mode: 'find',
                target: ['ai', 'tank', 'cc', 'busc-ai'],
                demoTarget: ['ai', 'tank', 'cc'],
            },
            _readyStep(),
            _faultStep(
                '第 3 步：通过「故障设置」界面设置「DPU 输入通道故障」，观察监控主机报警。',
                'dpu-channel',
                '打开「故障设置」界面，勾选「DPU 输入通道故障」，点击「应用设置」',
                true, 'CH1',
            ),
            _alarmStep('第 4 步：查看监控主机报警，进行消音、确认。'),
            {
                msg: '第 5 步：进入 AI 设置页面，确认故障通道为 CH1，观察其状态显示为 OPEN 故障。',
                mode: 'check',
                op: [
                    {
                        type: 'observe', target: 'cc', part: 'tab-3',
                        msg: '在监控主机「AI 设置」页查看各通道状态，CH1 显示 OPEN 故障、工程量显示 ---',
                        async act() { const s = _sysOf(this); _ccShowPage(s, 3); await _sleep(3200); },
                    },
                ],
                check() {
                    const s = _sysOf(this); const f = s.FAULT_CONFIG['dpu-channel'];
                    if (!f || !f.check()) return false;
                    // 步骤要求"进入 AI 设置页面"：必须已切换到该页签才算完成
                    const c = _cc(s);
                    return !!(c && c.activePage === 3);
                },
            },
            {
                msg: '第 6 步：将故障通道 CH1 禁用，启用备用通道 CH2，并把液位信号改接到 CH2。',
                mode: 'check',
                op: [
                    {
                        type: 'knob', target: 'cc', part: 'ai-ch1-mode',
                        msg: '在「AI 设置」页点击 CH1 的 Mode 旋钮，把模式切到 disable（禁用故障通道）',
                        beforeIntro() { _ccShowPage(_sysOf(this), 3); },
                        async act() {
                            const s = _sysOf(this); _ccShowPage(s, 3);
                            // 真实点击旋钮（走组件循环切换逻辑），不直接赋值
                            await _clickModeUntil(_cc(s), 'ch1', 'disable');
                            await _sleep(1600);
                        },
                    },
                    ..._unwireOps(WIRE_TANK.slice(0, 2)),
                    ..._wireOps([
                        { conn: { from: 'tank_wire_p', to: 'ai_wire_ch2p', type: 'wire' }, target: 'tank', ports: ['tank_wire_p', 'ai_wire_ch2p'], msg: '接线：液位变送器 P(+) → AI CH2(+)（改接备用通道）' },
                        { conn: { from: 'tank_wire_n', to: 'ai_wire_ch2n', type: 'wire' }, target: 'tank', ports: ['tank_wire_n', 'ai_wire_ch2n'], msg: '接线：液位变送器 N(-) → AI CH2(-)（改接备用通道）' },
                    ]),
                    {
                        type: 'knob', target: 'cc', part: 'ai-ch2-mode',
                        msg: '点击备用通道 CH2 的 Mode 旋钮，把模式切到 normal（启用备用通道）',
                        beforeIntro() { _ccShowPage(_sysOf(this), 3); },
                        async act() {
                            const s = _sysOf(this); _ccShowPage(s, 3);
                            await _clickModeUntil(_cc(s), 'ch2', 'normal');
                            await _sleep(1400);
                        },
                    },
                ],
                check() {
                    const s = _sysOf(this);
                    const ai = _comp(s, 'ai');
                    return !!(ai && ai.channels.ch1.mode === 'disable' && ai.channels.ch2.mode === 'normal'
                        && _hasConn(s, 'tank_wire_p', 'ai_wire_ch2p') && _hasConn(s, 'tank_wire_n', 'ai_wire_ch2n'));
                },
            },
            {
                msg: '第 7 步：进入液位控制页面，将输入通道切换为备用通道 CH2。',
                mode: 'check',
                op: [
                    {
                        type: 'btn', target: 'cc', part: 'lv-in-ch2',
                        msg: '在「液位控制」页点击低电平（LT）输入通道的 CH2 按钮，由 CH1 切换到 CH2',
                        beforeIntro() { _ccShowPage(_sysOf(this), 7); },
                        async act() {
                            const s = _sysOf(this); _ccShowPage(s, 7);
                            // 真实点击 CH2 按钮（走组件自身的 click 处理）
                            const fired = _firePartClick(_cc(s), 'lv-in-ch2');
                            if (!fired) {   // 兜底：部件未注册时才直接设置
                                const c = _cc(s);
                                if (c && c.levelCtrl) c.levelCtrl.inputChannel = 'ch2';
                            }
                            await _sleep(1600);
                        },
                    },
                ],
                check() {
                    const c = _cc(_sysOf(this));
                    // 步骤要求"进入液位控制页面"：页签必须已切到 7，且输入通道已换到 CH2
                    return !!(c && c.levelCtrl && c.levelCtrl.inputChannel === 'ch2' && c.activePage === 7);
                },
            },
            {
                msg: '第 8 步：回到监测报警页面，清除报警，系统由备用通道维持正常运行。',
                mode: 'check',
                op: [
                    {
                        type: 'observe', target: 'cc', part: 'tab-0',
                        msg: '回到「监测报警」页，待液位经备用通道恢复后消音、确认并清除报警记录',
                        async act() {
                            const s = _sysOf(this);
                            _ccShowPage(s, 0);
                            // 等待液位经备用通道恢复，避免低位报警残留
                            await _waitFor(s, x => { const c = _cc(x); return c && c.levelCtrl.level > c.levelCtrl.setL; }, 25000, 500);
                            _ccMute(s); _ccAck(s);
                            await _sleep(900);
                            _ccClearAlarms(s);
                            await _sleep(1200);
                        },
                    },
                ],
                check() { const c = _cc(_sysOf(this)); return !!(c && c.activeAlarms.every(a => a.confirmed)); },
            },
            _quizStep(
                '第 9 步：通道故障处理知识',
                'AI 模块 CH1 通道故障（输入开路），但现场不允许立即停机检修。正确的应急处理方式是：',
                [
                    '把故障通道 CH1 设为 disable 禁用，启用备用通道并把信号改接到备用通道，再择机检修',
                    '直接把整块 AI 模块停用，放弃全部监测',
                    '反复点击报警确认，让报警不再出现',
                    '把报警阈值调低，使通道不再报警',
                ],
                0,
                '监测系统的通道通常预留备用：将故障通道置 disable 后，其报警不再参与判断；再把传感器信号改接到备用通道并启用，即可在不中断监测的前提下继续工作。检修完成后再恢复原通道。屏蔽报警或放宽阈值只会掩盖故障，是错误做法。',
            ),
        ],
    },

};

// ═══════════════════════════════════════════════════════════════
// 页面定义（多页面画布）
//   页 0：索引页（DOM 浮层，点击卡片跳转）
//   页 1：中央监控计算机（仅 cc + 其总线连接器 busc-cc）
//   页 2：监测系统主电路（其余全部组件；4 个 CAN 模块并列于页面下方）
// 所有组件仍同时创建并参与物理求解，页面仅控制显隐。
// ═══════════════════════════════════════════════════════════════

export const PROJECT_PAGES = [
    { id: 0, name: '索引', type: 'index' },
    {
        id: 1, name: '中央监控计算机', comps: ['cc', 'busc-cc', 'term-cc'],
        desc: '中央监控计算机（报警列表、参数一览、网络诊断、通道配置）及其总线连接器。',
    },
    {
        id: 2, name: '监测系统主电路',
        comps: [
            'tank', 'fuel',
            'btnstop', 'prelay', 'vrelay', 'alarm',
            'ai', 'ao', 'di', 'do',
            'pterm-ai', 'gnd-ai', 'pterm-ao', 'gnd-ao',
            'pterm-di', 'gnd-di', 'pterm-do', 'gnd-do',
            'busc-ai', 'busc-ao', 'busc-di', 'busc-do',
            // 仪表归属于本页：默认隐藏，调出后跨页常显；其连线随本页显示，
            // 故演示中"调表测量"会切到本页并使表笔线可见。
            'multimeter', 'mf47-panel', 'osc', 'sg', 'cali', 'elecmeter', 'megohm', 'ampmeter',
        ],
        desc: '4 个 CAN 模块（AI/AO/DI/DO）并列于下方，液位 / 燃油被控对象、报警测试回路与继电器板、总线连接器。',
    },
];

// ═══════════════════════════════════════════════════════════════
// 组件配置（1920 × 1080 基准坐标）
//   page=1 中央监控计算机页；page=2 主电路页；page=0/未标注 仅索引页
// ═══════════════════════════════════════════════════════════════

export const componentConfigs = [
    // ══ 4 个 CAN 模块自左向右按 AO、AI、DO、DI 顺序等间距并列于页面下方 ══
    //   等间距范围：左边缘 60 → 右边缘-260（1660）；模块绘图宽约 290，
    //   4 个模块中心均匀分布（间距 390）：AO 205 / AI 595 / DO 985 / DI 1375
    // ── DPU 模块（CAN 节点）──
    { Class: AOModule, id: 'ao', x: -10, y: 430, page: 2, nodeAddress: 2, scale:1.1,visible: true },
    { Class: AIModule, id: 'ai', x: 480, y: 430, page: 2, nodeAddress: 1, scale:1.1,visible: true },
    { Class: DOModule, id: 'do', x: 920, y: 430, page: 2, nodeAddress: 4, scale:1.1,visible: true },
    { Class: DIModule, id: 'di', x: 1350, y: 430, page: 2, nodeAddress: 3, scale:1.1,visible: true },
    // 各模块右上角就近的 24V 电位端子与接地端子（放在模块右上侧）
    { Class: PotentialTerminal, id: 'pterm-ao', x: 332, y: 455, page: 2, potential: 24, scale: 1.1, visible: true },
    { Class: Ground, id: 'gnd-ao', x: 322, y: 556, page: 2, visible: true },
    { Class: PotentialTerminal, id: 'pterm-ai', x: 812, y: 455, page: 2, potential: 24, scale: 1.1, visible: true },
    { Class: Ground, id: 'gnd-ai', x: 812, y: 556, page: 2, visible: true },
    { Class: PotentialTerminal, id: 'pterm-do', x: 1262, y: 455, page: 2, potential: 24, scale: 1.1, visible: true },
    { Class: Ground, id: 'gnd-do', x: 1262, y: 556, page: 2, visible: true },
    { Class: PotentialTerminal, id: 'pterm-di', x: 1712, y: 455, page: 2, potential: 24, scale: 1.1, visible: true },
    { Class: Ground, id: 'gnd-di', x: 1712, y: 556, page: 2, visible: true },
    // 各模块正下方的总线连接器（顶部端口对准模块底部 CANH/CANL）
    { Class: BusConnector, id: 'busc-ao', x: 31, y: 972, page: 2, deviceid: 'CANBUS', topGap: 50, visible: true },
    { Class: BusConnector, id: 'busc-ai', x: 511, y: 972, page: 2, deviceid: 'CANBUS', topGap: 50, visible: true },
    { Class: BusConnector, id: 'busc-do', x: 961, y: 972, page: 2, deviceid: 'CANBUS', topGap: 50, visible: true },
    { Class: BusConnector, id: 'busc-di', x: 1402, y: 972, page: 2, deviceid: 'CANBUS', topGap: 50, visible: true },

    // ── 各模块上方就近的被控对象 / 报警器件 ──
    // AO 上方：燃油加热器
    { Class: FuelOilHeater, id: 'fuel', x: -170, y: 20, page: 2, scale: 0.9, visible: true },
    // AI 上方：液位控制器（液位双位控制系统）
    { Class: WaterTankSystem, id: 'tank', x: 470, y: 90, page: 2, scale: 0.9, visible: true },
    // DO 上方：压力继电器（YT1226）
    { Class: PressRelay, id: 'prelay', x: 1310, y: 92, page: 2, scale: 0.6, visible: true },
    // DI 上方：压力开关（电压继电器）与按钮（常闭报警测试按钮）
    { Class: VoltageRelay, id: 'vrelay', x: 1000, y: 350, page: 2, scale: 0.7, rotation: -90, visible: true },
    { Class: NormallyClosedPushButton, id: 'btnstop', x: 1560, y: 120, page: 2, label: 'ALARM TEST', scale: 0.7, visible: true },
    // 声光报警器（DI/DO 上方最右侧）
    { Class: AudioVisualAlarm, id: 'alarm', x: 1100, y: 80, page: 2, scale: 0.7, visible: true },

    // ── 中央监控计算机（页 1）──
    { Class: CentralComputer, id: 'cc', x: 40, y: 20, page: 1, visible: true },
    { Class: BusConnector, id: 'busc-cc', x: 50, y: 880, page: 1, deviceid: 'CANBUS', width: 140, topGap: 76, visible: true },
    // CC 侧 120Ω 总线终端电阻（竖直，置于总线连接器左侧）；默认接通，
    // 与 DI 模块自带终端电阻并联 → 总线等效电阻 60Ω
    { Class: BusTermResistor, id: 'term-cc', x: -40, y: 800, page: 1, visible: true },

    // ── 7 种标准仪表（默认隐藏，按需通过「选择仪表」调出；调出后跨页常显）──
    { Class: Multimeter, id: 'multimeter', x: 1040, y: 520, page: 2, visible: false },
    { Class: MF47Multimeter, id: 'mf47-panel', x: 40, y: 300, page: 2, visible: false },
    { Class: Oscilloscope_tri, id: 'osc', x: 40, y: 300, page: 2, visible: false },
    { Class: SignalGenerator, id: 'sg', x: 40, y: 300, page: 2, visible: false },
    { Class: ProcessCalibrator, id: 'cali', x: 40, y: 300, page: 2, visible: false },
    { Class: ElecMeter, id: 'elecmeter', x: 40, y: 300, page: 2, visible: false },
    { Class: RealMegohmMeter, id: 'megohm', x: 40, y: 300, page: 2, visible: false },

];

// ═══════════════════════════════════════════════════════════════
// 工具栏快捷操作
// ═══════════════════════════════════════════════════════════════

/**
 * 在中央监控计算机上登记若干"可定位部件"的几何中心（供自动演示箭头精确指向
 * 报警页的「消音 / 确认 / 清除」按钮、AI 设置页的通道模式旋钮、液位页的
 * 低电平输入通道按钮与页面标签），无需向 _interactGroup 注册热区，
 * 因此不会干扰监控主机自身的点击交互。
 */
function _registerCCParts(sys) {
    const cc = _comp(sys, 'cc');
    if (!cc || !cc.group) return;
    cc._parts = cc._parts || {};
    const put = (partId, node) => {
        if (!node || typeof node.getClientRect !== 'function') return;
        try {
            const box = node.getClientRect({ relativeTo: cc.group });
            if (!box || !(box.width > 0) || !(box.height > 0)) return;
            // 同时保存节点本身：供 getClickablePartNode() 取出并 fire('click')
            // 实现"像真的一样点击"（走组件自身的点击处理逻辑，而非直接赋值设置）
            cc._parts[partId] = { x: box.x, y: box.y, w: box.width, h: box.height, node: node };
        } catch (e) { /* ignore */ }
    };
    put('mute', cc._btnMute);
    put('ack', cc._btnAck);
    put('clear', cc._btnClrHist);
    (cc._tabs || []).forEach((t, i) => put('tab-' + i, t && t.bg));
    // AI 设置页：CH1 / CH2 通道模式旋钮（normal / disable 切换）
    const aiRows = cc._aiRows || {};
    put('ai-ch1-mode', aiRows.ch1 && aiRows.ch1.modeGrp);
    put('ai-ch2-mode', aiRows.ch2 && aiRows.ch2.modeGrp);
    // 液位页：低电平（LT）输入通道选择按钮
    put('lv-in-ch1', cc._inputChBtn1);
    put('lv-in-ch2', cc._inputChBtn2);
}

/** 供自动演示在页签尚未构建时补登记部件（如首帧后 AI/液位页才创建） */
function _ensureCCParts(sys) {
    const cc = _comp(sys, 'cc');
    if (!cc || !cc.group) return;
    const want = ['ai-ch1-mode', 'ai-ch2-mode', 'lv-in-ch1', 'lv-in-ch2'];
    if (want.some(id => !cc._parts || !cc._parts[id])) _registerCCParts(sys);
}

export function initSlider(_sys) {
    if (!_sys) return;
    // 自动演示时只保留箭头指示，不闪亮整个组件
    _sys._noBlinkHighlight = true;
    // 登记监控主机可定位部件（页面标签、报警页按钮），供箭头精确指向
    _registerCCParts(_sys);
}

/** 工具栏「自动接线」：瞬时接好全部电路/管路 */
export function applyAllPresets() {
    const sys = _sysOf(this);
    if (!sys) return;
    _autoWire(sys);
}

/** 工具栏「起动系统」：复位 → 自动接线 → 上电 → 泵/阀遥控 → 控制器自动 */
export async function applyStartSystem() {
    const sys = _sysOf(this);
    if (!sys) return;
    await _resetRig(sys);
    await _startSystem(sys);
}

/** 5 点步进：以 5 个设定值步进温度控制回路的目标温度 */
export function fiveStep() {
    const sys = _sysOf(this);
    const cc = _cc(sys);
    if (!cc || !cc.tempCtrl) return;
    const steps = [80, 100, 120, 140, 160];
    if (sys._fiveStepIdx === undefined || sys._fiveStepIdx >= steps.length) sys._fiveStepIdx = 0;
    cc.tempCtrl.sv = steps[sys._fiveStepIdx];
    sys._fiveStepIdx = (sys._fiveStepIdx + 1) % steps.length;
    sys.redrawAll && sys.redrawAll();
}
