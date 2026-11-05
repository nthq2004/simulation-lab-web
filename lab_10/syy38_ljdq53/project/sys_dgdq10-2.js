
// ══════════════════════════════════════════════════════════════════════════
//  压力水柜液位控制 —— PLC 控制实验
//
//  电路组成：
//    1) 主电路（AC 380V，原理图符号）：
//       三相电源 ac-3p → 总开关 QF → KM1 主触头 → 热继电器 FR 发热元件 → 电机 M(U1/V1/W1)
//       电机尾端 U2/V2/W2 短接成星点（简单直接起动，不换接）
//    2) 控制回路（DC 24V）：
//       24V 电位端子(pterm-24) 自上而下分路：
//         · FR 常闭 → I0.2
//         · 停止按钮(常闭) → I0.1
//         · 起动按钮(常开) → I0.0
//         · 压力水柜(ptank-1)：高压常闭触头 → I0.3，低压常开触头 → I0.4
//         · 自动/手动开关(sa-1)：→ I0.5
//    3) 输出回路：PLC Q0.0 → KM1 线圈（DC24V）→ 主电路 KM1 主触头
//    4) 压力水柜：水泵由电机联动（电机运行→水泵转→液位升）；
//       低压触头低于低压设定值闭合、高压触头高于高压设定值断开，均无回差。
//    5) PLC 本体：S7-200 SMART CPU ST20（12DI/8DO 晶体管源型），默认 STOP
//    6) 上位机：装有 STEP7 的 PC，网口 → PLC 以太网口（连接/上传/下载程序）
//
//  PLC 程序：
//    M0.1 = I0.5 AND I0.4   （自动：低压触头起动）
//    M0.2 = I0.5 AND NOT I0.3（自动：高压触头停止）
//    M0.0 = (I0.0 OR M0.0 OR M0.1) AND I0.1 AND I0.2 AND NOT M0.2（起保停运行位）
//    Q0.0 = M0.0            （驱动 KM1）
//    自动（I0.5=1）：相当于手动起动按钮与低压触头并联、手动停止按钮与高压触头串联；
//    手动（I0.5=0）：高/低压触头不参与，手动起动/停止按钮有效。
// ══════════════════════════════════════════════════════════════════════════

import { Multimeter } from '../components/Multimeter.js';
import { MF47Multimeter } from '../components/MF47Multimeter.js';
import { Oscilloscope_tri } from '../components/Osc_tri.js';
import { SignalGenerator } from '../components/SignalGenerator.js';
import { ProcessCalibrator } from '../components/ProcessCalibrator.js';
import { ElecMeter } from '../components/ElecMeter.js';
import { RealMegohmMeter } from '../components/RealMegohmMeter.js';

// ── 本实验元件 ─────────────────────────────────────────────────────────
import { S7_200_SMART_ST20 } from '../components/S7_200_SMART_ST20.js'; // 西门子 S7-200 SMART CPU ST20
import { S7_200_EM_AI04 } from '../components/S7200_EM_AI04.js';       // 模拟量输入扩展模块 EM AI04（保留，不接模拟量回路）
import { S7_200_EM_AQ04 } from '../components/S7200_EM_AQ04.js';       // 模拟量输出扩展模块 EM AQ04（保留，不接模拟量回路）
import { STEP7PC } from '../components/STEP7PC.js';                    // 装有 STEP7 的上位机
import { PotentialTerminal } from '../components/PotentialTerminal.js'; // 24V 电位端子
import { DCPower } from '../components/DCPower.js';                     // 直流 24V 电源

// ── 主电路（原理图符号 + 组合设备）─────────────────────────────────────
import { DiagramACPower3P } from '../components/DiagramACPower3P.js';          // 三相电源（单线图符号）
import { DiagramThreePhaseACB } from '../components/DiagramThreePhaseACB.js';  // 三相空气开关 QF
import { MainContact } from '../device/MainContact.js';                        // 接触器主触头 KM1
import { ContactorCoil } from '../device/ContactorCoil.js';                    // 接触器线圈 KM1
import { ThermalHeatElement } from '../device/ThermalHeatElement.js';          // 热继电器 FR 发热元件
import { ThermalNCContact } from '../device/ThermalNCContact.js';              // 热继电器 FR 常闭触点
import { InductionMotor2 } from '../components/InductionMotor2.js';            // 三相异步电动机（六端子）

// ── 按钮与开关 ─────────────────────────────────────────────────────────
import { DiagramStopButton } from '../components/DiagramStopButton.js';        // 停止按钮（常闭）
import { DiagramStartButton } from '../components/DiagramStartButton.js';      // 起动按钮（常开）
import { Switch } from '../components/Switch.js';                              // 自动/手动开关

// ── 压力水柜液位控制器 ─────────────────────────────────────────────────
import { PressureWaterTankControl } from '../components/PressureWaterTankControl.js';

// ══════════════════════════════════════════════════════════════════════════
//  故障设置（本实验暂未配置故障）
// ══════════════════════════════════════════════════════════════════════════
export const FAULT_CONFIGS = {};

// ══════════════════════════════════════════════════════════════════════════
//  操作流程：PLC程序的上传、监控、修改和下载
// ══════════════════════════════════════════════════════════════════════════
export const PROJECT_WORKFLOWS = {

    'plc-upload-monitor': {
        id: 'plc-upload-monitor',
        name: '1. PLC程序的上传、监控、修改和下载',
        steps: [
            // ── 1. 自动接线 + 起动系统 ──────────────────────────────
            {
                mode: 'check',
                msg: '1. 点击「自动接线」完成全部接线，再点击「起动系统」上电并让 PLC 进入 RUN。',
                check() {
                    const s = this.sys;
                    return s.conns.length > 0 && s.comps['dc24'].isOn
                        && s.comps['qf'].isClosed() && s.comps['plc-1'].mode === 'RUN';
                },
                op: [
                    { type: 'wire', msg: '点击工具栏「自动接线」，完成主电路 / 控制回路全部接线',
                      async act() { this.sys.applyAllPresets(); await _wait(700); } },
                    { type: 'wire', button: 'btnStartSys', msg: '点击「起动系统」：上电 + PLC 转 RUN',
                      async act() { await this.sys.applyStartSystem(); await _wait(900); } },
                ],
            },

            // ── 2. 转为自动，观察双位自动控制 ───────────────────────
            {
                mode: 'check',
                msg: '2. 合上「自动/手动」开关（转为自动），观察压力水柜两位式自动控制：液位低于下限水泵自动起动，升至上限自动停止。',
                check() {
                    const s = this.sys;
                    const flags = this._projFlag || (this._projFlag = {});
                    const sw = s.comps['sa-1'];
                    if (!sw || !sw.isOn) { flags.s2T = null; return false; }
                    const now = performance.now();
                    if (!flags.s2T) flags.s2T = now;
                    return (now - flags.s2T) >= 30000;   // 演练：开关转自动后再延时 30s 才跳过
                },
                op: [
                    { type: 'switch', target: 'sa-1', msg: '合上「自动/手动」开关，转为自动控制',
                      async act() { const sw = this.sys.comps['sa-1']; if (!sw.isOn) sw.toggle(); await _wait(1200); } },
                    { type: 'observe', target: 'ptank-1', msg: '等待水泵自动起动一次，并在液位升至上限后自动停止',
                      async act() { await _awaitPumpCycle(this.sys); } },
                ],
            },

            // ── 3. 打开 STEP7 → 连接 → 上传 ─────────────────────────
            {
                mode: 'check',
                msg: '3. 打开 STEP7 软件界面，点击「连接」与 PLC 建立连接，再点击「上传」查看 PLC 中的程序。',
                check() {
                    const ui = _s7(this.sys);
                    return !!(ui && ui.connectedId && ui._programLoaded);
                },
                op: [
                    { type: 'observe', target: 'step7pc-1', part: 'screen', circleR: 24,
                      msg: '双击上位机屏幕，打开 STEP7 编程界面',
                      async act() { this.sys.comps['step7pc-1'].openStep7(); await _wait(700); } },
                    { type: 'observe', target: 'step7pc-1', part: 'screen', circleR: 24,
                      msg: '点击「连接」，与 PLC 建立在线连接',
                      async act() { await _s7Click(this, '#s7-connect', '点击「连接」', 800); } },
                    { type: 'observe', target: 'step7pc-1', part: 'screen', circleR: 24,
                      msg: '点击「上传」，从 PLC 读取当前运行程序（显示为梯形图）',
                      async act() { await _s7Click(this, '#s7-upload', '点击「上传」查看程序', 900); } },
                ],
            },

            // ── 4. 进入在线监控 ─────────────────────────────────────
            {
                mode: 'check',
                msg: '4. 点击「监控」，进入在线监控状态，观察压力水柜双位自动控制（水泵自动起动一次、到上限自动停止一次）。',
                check() {
                    const s = this.sys;
                    const flags = this._projFlag || (this._projFlag = {});
                    const ui = _s7(s);
                    if (!ui || !ui._monitoring) { flags.s4T = null; return false; }
                    const now = performance.now();
                    if (!flags.s4T) flags.s4T = now;
                    return (now - flags.s4T) >= 30000;   // 演练：进入监控后再延时 30s 才跳过
                },
                op: [
                    { type: 'observe', target: 'step7pc-1', part: 'screen', circleR: 24,
                      msg: '点击「监控」，进入在线监控状态（梯形图按实时状态着色）',
                      async act() { await _s7Click(this, '#s7-monitor', '点击「监控」进入监控', 1000); } },
                    { type: 'observe', target: 'ptank-1', msg: '在监控状态下等待水泵自动起动一次、到上限自动停止一次',
                      async act() { await _awaitPumpCycle(this.sys); } },
                ],
            },

            // ── 5. 退出监控 + 删除自锁触点 M0.0 ─────────────────────
            {
                mode: 'check',
                msg: '5. 点击「停止监控」退出监控状态，在梯形图中删除自锁触点 M0.0，完成程序修改。',
                check() {
                    const ui = _s7(this.sys);
                    return !!(ui && !ui._monitoring && !_ladderHasM0(ui));
                },
                op: [
                    { type: 'observe', target: 'step7pc-1', part: 'screen', circleR: 24,
                      msg: '点击「停止监控」，退出在线监控（程序恢复可编辑）',
                      async act() { await _s7Click(this, '#s7-monitor', '点击「停止监控」退出监控', 900); } },
                    { type: 'observe', target: 'step7pc-1', part: 'screen', circleR: 24,
                      msg: '在梯形图中删除自锁触点 M0.0（运行位不再自锁）',
                      async act() {
                          const ui = _s7(this.sys);
                          if (!ui) return;
                          const chip = ui._root.querySelector('.s7-chip[data-kind="contact"][data-op="M0.0"]');
                          if (chip) await this._flashDomElement(chip, '删除自锁触点 M0.0', 1600);
                          _removeM0SelfLock(ui);
                          ui._renderMain();
                          await _wait(700);
                      } },
                ],
            },

            // ── 6. 下载 + 观察无自锁运行效果 ────────────────────────
            {
                mode: 'check',
                msg: '6. 点击「下载」将修改后的程序写入 PLC，观察删除自锁后的运行效果：水位在下限（低压设定值）附近来回振荡。',
                check() {
                    const s = this.sys;
                    const flags = this._projFlag || (this._projFlag = {});
                    const p = s.comps['plc-1'];
                    // 必须已「下载」新程序（plc._ladderModel 被写入）且其中不再含 M0.0 自锁触点
                    const model = p && p._ladderModel;
                    if (!model || _ladderHasM0({ _ladder: model })) { flags.s6T = null; return false; }
                    const now = performance.now();
                    if (!flags.s6T) flags.s6T = now;
                    return (now - flags.s6T) >= 20000;   // 演练：下载后再延时 20s 才跳过
                },
                op: [
                    { type: 'observe', target: 'step7pc-1', part: 'screen', circleR: 24,
                      msg: '点击「下载」，将无自锁的新程序写入 PLC',
                      async act() { await _s7Click(this, '#s7-download', '点击「下载」写入 PLC', 1000); } },
                    { type: 'observe', target: 'ptank-1', msg: '观察删除自锁后的运行效果：水位在下限附近来回振荡 2 个来回',
                      async act() { await _awaitPumpOscillations(this.sys, 2); } },
                ],
            },
        ],
    },
};

// ── 工作流辅助函数 ──────────────────────────────────────────────────────
function _wait(ms) { return new Promise(r => setTimeout(r, ms)); }

/** 取 STEP7 上位机界面实例 */
function _s7(sys) {
    const pc = sys.comps['step7pc-1'];
    return (pc && pc._step7UI) ? pc._step7UI : null;
}

/** 点击 STEP7 界面上的某个按钮：先闪烁 DOM 箭头指向它，再点击 */
async function _s7Click(wf, sel, tip, wait = 500) {
    const ui = _s7(wf.sys);
    const el = (ui && ui._root) ? ui._root.querySelector(sel) : null;
    if (el) {
        await wf._flashDomElement(el, tip, 1500);
        el.click();
    }
    await _wait(wait);
}

/** 等待压力水柜水泵完成一次"起动 → 到达上限停止" */
async function _awaitPumpCycle(sys, maxMs = 150000) {
    const t = sys.comps['ptank-1'];
    if (!t) return;
    const t0 = performance.now();
    while (!t.isPumpRunning()) { if (performance.now() - t0 > maxMs) return; await _wait(300); }
    while (t.isPumpRunning()) { if (performance.now() - t0 > maxMs) return; await _wait(300); }
}

/** 等待水泵在下限附近完成 count 次"运行 → 停止"振荡（无自锁时） */
async function _awaitPumpOscillations(sys, count, maxMs = 240000) {
    const t = sys.comps['ptank-1'];
    if (!t) return;
    const t0 = performance.now();
    let cycles = 0, prev = t.isPumpRunning();
    while (cycles < count) {
        if (performance.now() - t0 > maxMs) return;
        await _wait(250);
        const cur = t.isPumpRunning();
        if (!cur && prev) cycles++;    // 一次"运行→停止"记一次
        prev = cur;
    }
}

/** 递归判断一串梯形图元素中是否含指定操作数的触点 */
function _contactPresent(nodes, op) {
    for (const e of (nodes || [])) {
        if (!e) continue;
        if (e.type === 'contact' && e.op === op) return true;
        if (e.type === 'parallel' && Array.isArray(e.branches)) {
            for (const br of e.branches) if (_contactPresent(br, op)) return true;
        }
    }
    return false;
}

/** 找到输出线圈为指定操作数的网络（即运行位 M0.0 所在的自锁网络） */
function _netWithCoil(networks, coilOp) {
    return (networks || []).find(n => (n.elements || []).some(e => e && e.type === 'coil' && e.op === coilOp)) || null;
}

/**
 * 梯形图中运行位网络是否仍含 M0.0 自锁触点。
 * 注意：仅检查"输出线圈为 M0.0"的那个网络，避免把 Q0.0 输出网络里
 * 正常读取运行位的 M0.0 触点误判为自锁触点。
 */
function _ladderHasM0(ui) {
    if (!ui || !ui._ladder || !Array.isArray(ui._ladder.networks)) return false;
    const runNet = _netWithCoil(ui._ladder.networks, 'M0.0');
    return runNet ? _contactPresent(runNet.elements || [], 'M0.0') : false;
}

/** 递归删除指定触点的元素列表（空支路丢弃、单支路并联压平）；返回 {nodes, removed} */
function _stripContact(nodes, op) {
    const out = [];
    let removed = false;
    for (const e of (nodes || [])) {
        if (!e) continue;
        if (e.type === 'contact' && e.op === op) { removed = true; continue; }
        if (e.type === 'parallel' && Array.isArray(e.branches)) {
            const newBranches = [];
            for (const br of e.branches) {
                const res = _stripContact(br, op);
                if (res.removed) removed = true;
                if (res.nodes.length === 0) continue;      // 被删空的支路 → 去掉
                newBranches.push(res.nodes);
            }
            if (newBranches.length === 0) continue;         // 整个并联节点被删空
            if (newBranches.length === 1) { out.push(...newBranches[0]); continue; } // 只剩一条支路 → 压平
            e.branches = newBranches;
            out.push(e);
        } else {
            out.push(e);
        }
    }
    return { nodes: out, removed };
}

/** 从运行位网络中删除 M0.0 自锁触点；成功返回 true（不影响 Q0.0 输出网络里的 M0.0 触点） */
function _removeM0SelfLock(ui) {
    if (!ui || !ui._ladder || !Array.isArray(ui._ladder.networks)) return false;
    const runNet = _netWithCoil(ui._ladder.networks, 'M0.0');
    if (!runNet) return false;
    if (!_contactPresent(runNet.elements || [], 'M0.0')) return false;
    const res = _stripContact(runNet.elements || [], 'M0.0');
    runNet.elements = res.nodes;
    return res.removed;
}

// ── ST20 用户程序：压力水柜液位控制 ────────────────────────────────────
const PLC_PROGRAM = [
    '// ══ 压力水柜液位控制（PLC 控制）══',
    '// I0.0 起动按钮(常开)  I0.1 停止按钮(常闭)  I0.2 热继电器 FR(常闭)',
    '// I0.3 高压触头(常闭，液位高于高压设定值断开)',
    '// I0.4 低压触头(常开，液位低于低压设定值闭合)',
    '// I0.5 自动/手动开关（闭合=自动，断开=手动）',
    '// Q0.0 → KM1 主接触器（水泵电机）',
    '',
    '// ── 1) 自动模式：低压触头起动位 M0.1 = I0.5 AND I0.4 ──',
    'LD     I0.5',
    'A      I0.4',
    '=      M0.1',
    '',
    '// ── 2) 自动模式：高压触头停止位 M0.2 = I0.5 AND NOT I0.3 ──',
    'LD     I0.5',
    'AN     I0.3',
    '=      M0.2',
    '',
    '// ── 3) 起保停运行位 M0.0 ──',
    '//   手动起动 I0.0 / 自锁 M0.0 / 自动低压 M0.1；',
    '//   停止按钮 I0.1(常闭) 与 FR I0.2(常闭) 串联，高压停止位 M0.2 取反串联。',
    'LD     I0.0',
    'O      M0.0',
    'O      M0.1',
    'A      I0.1',
    'A      I0.2',
    'AN     M0.2',
    '=      M0.0',
    '',
    '// ── 4) KM1 主接触器输出 ──',
    'LD     M0.0',
    '=      Q0.0',
    'END',
].join('\n');

export const componentConfigs = [
    // ══════════════ PLC 本体与扩展模块（中央区域）══════════════
    { Class: S7_200_SMART_ST20, id: 'plc-1', x: 820, y: 200, scale: 1.0, label: 'ST20',
      mode: 'STOP',
      hostname: 'PLC-ST20', ip: '192.168.0.1', mask: '255.255.255.0',
      program: PLC_PROGRAM },

    // 扩展模块（串联 AI04 → AQ04；attachTo 使初始化即吸附挂接到 CPU 右侧）
    { Class: S7_200_EM_AI04, id: 'ai04-1', x: 1280, y: 200, width: 115, height: 470, label: 'EM AI04', ch0mode: 'I4-20', attachTo: 'plc-1' },
    { Class: S7_200_EM_AQ04, id: 'aq04-1', x: 1425, y: 200, width: 115, height: 470, label: 'EM AQ04', ch0mode: 'I4-20', attachTo: 'ai04-1' },

    // ══════════════ 主电路（原理图符号，画布左侧）══════════════
    // 三相电源 → QF → KM1 主触头 → FR 发热元件 → 电动机 U1/V1/W1
    { Class: DiagramACPower3P, id: 'ac-3p', x: 40, y: 20, vRms: 220, freq: 50, isOn: true, phaseSeq: 'pos' },
    { Class: DiagramThreePhaseACB, id: 'qf', x: 40, y: 100, width: 150, height: 115,
      initState: 'off', label: 'QF', ratedVoltage: 380, ratedCurrent: 100, tripCurrent: 60 },
    { Class: MainContact, id: 'km1-mc', x: 20, y: 270, width: 220, height: 110, deviceid: 'KM1' },
    { Class: ThermalHeatElement, id: 'fr', x: 20, y: 430, width: 220, height: 110,
      deviceid: 'FR1', ratedCurrent: 25, noTripRatio: 8, tripClass: 10, minTripTime: 1 },
    { Class: InductionMotor2, id: 'm2', x: 20, y: 590, width: 200, height: 240, label: 'M1',
      R1: 0.50, Lsigma1: 0.00334, Rc: 300, Lm: 0.0796,
      R2: 0.46, Lsigma2: 0.00334,
      // 小惯量 + 粘滞阻尼 + 小恒定负载：断电后约 1~2s 内转速降到 0
      J: 0.06, B: 0.3, polePairs: 2,
      ratedPower: 11, ratedSpeed: 1440, loadTorque: 6 },

    // ══════════════ 控制回路电源与 24V 电位端子 ══════════════
    { Class: DCPower, id: 'dc24', x: 580, y: 760, voltage: 24, isOn: false },
    { Class: PotentialTerminal, id: 'pterm-24', x: 460, y: 160, potential: 24, scale: 1.2 },

    // ══════════════ 控制元件（pterm-24 后自上而下：FR 常闭 → 停止 → 起动）══════════════
    { Class: ThermalNCContact, id: 'fr-nc', x: 560, y: 220, width: 100, height: 80, deviceid: 'FR1', label: 'FR' },
    { Class: DiagramStopButton, id: 'sb-stop', x: 560, y: 300, label: 'SB1 停止' },
    { Class: DiagramStartButton, id: 'sb-start', x: 560, y: 380, label: 'SB2 起动', color: '#20a030' },

    // ══════════════ 接触器线圈（KM1，DC24V，由 Q0.0 驱动）══════════════
    { Class: ContactorCoil, id: 'km1-coil', x: 850, y: 800, width: 70, height: 50,
      deviceid: 'KM1', ratedCoilVoltage: 24, coilResistance: 240 },

    // ══════════════ 自动/手动开关（闭合=自动，断开=手动 → I0.5）══════════════
    { Class: Switch, id: 'sa-1', x: 610, y: 190, label: 'SA1 自动/手动', onLabel: '自动', offLabel: '手动', isOn: false },

    // ══════════════ 压力水柜液位控制器（水泵由电机 m2 联动；输出高/低压两个触头）══════════════
    { Class: PressureWaterTankControl, id: 'ptank-1', x: 210, y: 460,
      label: '压力水柜', sourceMotor: 'm2', speedThreshold: 20,
      lowLimit: 30, highLimit: 70, capacity: 40, pumpMaxFlow: 2.5, outletFlow: 0.8, initialLevel: 50 },

    // ══════════════ 上位机（装有 STEP7 编程软件，用于连接/上传/下载）══════════════
    { Class: STEP7PC, id: 'step7pc-1', x: 900, y: 120,
      hostname: 'STEP7-PC', ip: '192.168.0.2', mask: '255.255.255.0' },

    // ══════════════ 7 种必备仪表（默认隐藏）══════════════
    { Class: Multimeter, id: 'multimeter', x: 620, y: 500, visible: false },
    { Class: MF47Multimeter, id: 'mf47-panel', x: 1150, y: 250, visible: false },
    { Class: Oscilloscope_tri, id: 'osc', x: 50, y: 50, visible: false },
    { Class: SignalGenerator, id: 'sg', x: 50, y: 50, visible: false },
    { Class: ProcessCalibrator, id: 'cali', x: 50, y: 50, visible: false },
    { Class: ElecMeter, id: 'elecmeter', x: 50, y: 50, visible: false },
    { Class: RealMegohmMeter, id: 'megohm', x: 50, y: 50, visible: false },
];

// ── 电路连线 ────────────────────────────────────────────────────────────
function _wire(sys) {
    const conns = [
        // ══════════ 主电路：电源 → QF → KM1 → FR → 电机 U1/V1/W1 ══════════
        { from: 'ac-3p_wire_u', to: 'qf_wire_l1', type: 'wire' },
        { from: 'ac-3p_wire_v', to: 'qf_wire_l2', type: 'wire' },
        { from: 'ac-3p_wire_w', to: 'qf_wire_l3', type: 'wire' },
        { from: 'qf_wire_t1', to: 'km1-mc_wire_l1', type: 'wire' },
        { from: 'qf_wire_t2', to: 'km1-mc_wire_l2', type: 'wire' },
        { from: 'qf_wire_t3', to: 'km1-mc_wire_l3', type: 'wire' },
        { from: 'km1-mc_wire_t1', to: 'fr_wire_l1', type: 'wire' },
        { from: 'km1-mc_wire_t2', to: 'fr_wire_l2', type: 'wire' },
        { from: 'km1-mc_wire_t3', to: 'fr_wire_l3', type: 'wire' },
        { from: 'fr_wire_t1', to: 'm2_wire_u1', type: 'wire' },
        { from: 'fr_wire_t2', to: 'm2_wire_v1', type: 'wire' },
        { from: 'fr_wire_t3', to: 'm2_wire_w1', type: 'wire' },

        // 电机尾端 U2/V2/W2 短接成星点（简单直接起动）
        { from: 'm2_wire_u2', to: 'm2_wire_v2', type: 'wire' },
        { from: 'm2_wire_v2', to: 'm2_wire_w2', type: 'wire' },

        // ══════════ 控制回路输入：24V → FR 常闭 / 停止(NC) / 起动(NO) → DI ══════════
        { from: 'pterm-24_wire_p', to: 'fr-nc_wire_com', type: 'wire' },
        { from: 'fr-nc_wire_nc', to: 'plc-1_wire_di02', type: 'wire' },       // FR → I0.2
        { from: 'pterm-24_wire_p', to: 'sb-stop_wire_nc3', type: 'wire' },
        { from: 'sb-stop_wire_nc4', to: 'plc-1_wire_di01', type: 'wire' },    // 停止 → I0.1
        { from: 'pterm-24_wire_p', to: 'sb-start_wire_no1', type: 'wire' },
        { from: 'sb-start_wire_no2', to: 'plc-1_wire_di00', type: 'wire' },   // 起动 → I0.0

        // ══════════ 压力水柜两个触头 → PLC 输入（上高压 I0.3、下低压 I0.4）══════════
        { from: 'pterm-24_wire_p', to: 'ptank-1_wire_hi_com', type: 'wire' },
        { from: 'ptank-1_wire_hi_nc', to: 'plc-1_wire_di03', type: 'wire' },  // 高压常闭 → I0.3
        { from: 'pterm-24_wire_p', to: 'ptank-1_wire_lo_com', type: 'wire' },
        { from: 'ptank-1_wire_lo_no', to: 'plc-1_wire_di04', type: 'wire' },  // 低压常开 → I0.4

        // ══════════ 自动/手动开关 → PLC 输入 ══════════
        { from: 'pterm-24_wire_p', to: 'sa-1_wire_l', type: 'wire' },
        { from: 'sa-1_wire_r', to: 'plc-1_wire_di05', type: 'wire' },         // 自动开关 → I0.5

        // ══════════ PLC 供电与输出回路 ══════════
        { from: 'dc24_wire_p', to: 'plc-1_wire_24v', type: 'wire' },
        { from: 'dc24_wire_n', to: 'plc-1_wire_v0', type: 'wire' },
        { from: 'plc-1_wire_1m', to: 'plc-1_wire_v0', type: 'wire' },         // 输入公共端 1M → 0V
        { from: 'plc-1_wire_1l', to: 'plc-1_wire_24v', type: 'wire' },        // 输出负载电源 1L+ → 24V
        { from: 'plc-1_wire_dq00', to: 'km1-coil_wire_a1', type: 'wire' },
        { from: 'km1-coil_wire_a2', to: 'plc-1_wire_v0', type: 'wire' },

        // ══════════ 上位机网络（连接 / 上传 / 下载程序）══════════
        { from: 'step7pc-1_wire_lan', to: 'plc-1_wire_lan', type: 'wire' },
    ];
    conns.forEach(c => {
        const dup = sys.conns.some(e => sys.connMgr.connEqual(e, c));
        if (!dup) sys.connMgr.addConn(c);
    });
    sys.redrawAll();
}

export function initSlider(_sys) {
    // 自动演示时只保留箭头指示，不闪亮整个组件
    _sys._noBlinkHighlight = true;
}

/** 将两个扩展模块（AI04 → AQ04）顺次串联挂接到 CPU 扩展总线（无动画） */
function _mountModules(sys) {
    const rels = [['ai04-1', 'plc-1'], ['aq04-1', 'ai04-1']];
    rels.forEach(([modId, parentId]) => {
        const mod = sys.comps[modId];
        if (mod && mod._parentExp !== parentId) mod._parentExp = parentId;
    });
    if (typeof sys._recomputeAllChains === 'function') sys._recomputeAllChains();
    if (typeof sys._layoutAttachedModules === 'function') sys._layoutAttachedModules();
}

export function applyAllPresets() {
    // 初始化（ControlSystem.init 调用，this 无 sys 引用）时不接线；
    // 仅当点击工具栏「自动接线」（WorkflowManager 调用，this.sys 存在）时才接好全部线。
    if (!(this && this.sys && this.sys.connMgr)) return;
    _mountModules(this.sys);
    _wire(this.sys);
}

export async function applyStartSystem() {
    if (!(this && this.sys && this.sys.connMgr)) return;
    _mountModules(this.sys);
    _wire(this.sys);
    // 打开 24V 直流电源（控制回路供电；初始为关闭，由「启动系统」上电）
    const dc = this.sys.comps['dc24'];
    if (dc && !dc.isOn && typeof dc.onConfigUpdate === 'function') dc.onConfigUpdate({ isOn: true });
    // 合上总开关 QF，主电路得电
    const qf = this.sys.comps['qf'];
    if (qf && typeof qf.close === 'function' && !qf.isClosed()) qf.close();
    // 「启动系统」同时将 PLC 转入 RUN，程序随即执行
    const plc = this.sys.comps['plc-1'];
    if (plc && plc.mode !== 'RUN' && typeof plc.toggleMode === 'function') plc.toggleMode();
}

export function fiveStep() { }
