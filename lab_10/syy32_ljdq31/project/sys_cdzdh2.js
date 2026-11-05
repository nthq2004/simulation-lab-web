
import { Multimeter } from '../components/Multimeter.js';
import { MF47Multimeter } from '../components/MF47Multimeter.js';
import { Oscilloscope_tri } from '../components/Osc_tri.js';
import { SignalGenerator } from '../components/SignalGenerator.js';
import { ProcessCalibrator } from '../components/ProcessCalibrator.js';
import { ElecMeter } from '../components/ElecMeter.js';
import { RealMegohmMeter } from '../components/RealMegohmMeter.js';

// ── 本实验元件（device 组合设备 + PLC + 电机）──────────────────
import { S7_200_SMART_SR40 } from '../components/S7_200_SMART_SR40.js'; // 西门子 S7-200 SMART CPU SR40
import { S7_200_EM_AI04 } from '../components/S7200_EM_AI04.js'; // 模拟量输入扩展模块 EM AI04
import { S7_200_EM_AQ04 } from '../components/S7200_EM_AQ04.js'; // 模拟量输出扩展模块 EM AQ04
import { S7_200_EM_DI08 } from '../components/S7200_EM_DI08.js'; // 开关量 8 路输入扩展模块 EM DI08
import { S7_200_EM_DQ08 } from '../components/S7200_EM_DQ08.js'; // 开关量 8 路输出扩展模块 EM DQ08
import { STEP7PC } from '../components/STEP7PC.js';             // 装有 STEP7 的上位机（编程计算机）
import { SpeedTransmitter } from '../components/SpeedTransmitter.js';   // 转速变送器（4~20mA 两线制）
import { DigitalTachometer } from '../components/DigitalTachometer.js'; // 数字转速表（4~20mA 输入）
import { DiagramACPower3P } from '../components/DiagramACPower3P.js'; // 三相电源（单线图符号）
import { MainContact } from '../device/MainContact.js';         // 接触器 KM 主触头
import { ContactorCoil } from '../device/ContactorCoil.js';     // 接触器 KM 线圈
import { ThermalHeatElement } from '../device/ThermalHeatElement.js'; // 热继电器 FR 发热元件
import { ThermalNCContact } from '../device/ThermalNCContact.js';     // 热继电器 FR 常闭触点
import { ThreePhaseMotor3D } from '../components/ThreePhaseMotor3D.js'; // 三相异步电动机
import { DiagramStartButton } from '../components/DiagramStartButton.js'; // 常开按钮（NO 干接点）
import { Ground } from '../components/Gnd.js';                  // 接地参考
import { PotentialTerminal } from '../components/PotentialTerminal.js'; // 24V 电位端子（控制回路公共 +24V）
import { DCPower } from '../components/DCPower.js';             // 直流 24V 电源（给 PLC 供电）

export const FAULT_CONFIGS = {};

/**
 * PLC 典型测试电路 —— 起保停控制电机运行
 * ══════════════════════════════════════════════════════════════
 *
 *  主电路（AC 380V，走 L/T 强电端子）：
 *    三相电源 → 接触器 KM1 主触头(km1-mc) → 热继电器 FR 发热元件(fr) → 三相异步电机 M
 *
 *  控制回路（DC 24V，走 a1/a2、com/no|nc 弱电端子，与主电路分开）：
 *    外部直流 24V 电源(dc24)：正极 → PLC 24V 端子，负极 → PLC 0V 端子，
 *    取代 CPU 内部 24V 传感器电源（不再从 PLC 内部 24V 端子取电给按钮）。
 *    24V 电位端子(pterm-24)：控制回路公共 +24V 母线，一路往下接 FR 常闭
 *    (fr-nc) 左边(com)、SB1/SB2 左边(l)：
 *    SB1 启动按钮(常开) → I0.0   SB2 停止按钮(常开) → I0.1
 *    热继电器 FR 常闭(95-96) → I0.2（过载反馈）
 *    PLC Q0.0 → 接触器 KM1 线圈(km1-coil) A1，线圈 A2 → PLC 0V
 *
 *  起保停（自锁）逻辑由 PLC 用户程序实现（软件自锁）：
 *      LD I0.0
 *      O  Q0.0        ← 自锁
 *      AN I0.1
 *      A  I0.2        ← 热继电器未动作
 *      =  Q0.0
 *
 *  组合设备说明：km1-mc / km1-coil 共用 deviceid='KM1'，
 *  fr / fr-nc 共用 deviceid='FR1'，由 DeviceManager 关联同一状态机；
 *  线圈额定电压设为 DC24V，可由 PLC 的 Q0.0 直接驱动。
 *
 *  模拟量 4~20mA 回路（自动接线一并接好）：
 *    采集：24V → 转速变送器(speed-tx) P；变送器 N → AI04 ch0+；AI04 ch0- → 0V
 *    输出：AQ04 ch0V → 数字转速表(digi-tach) sig；表 com → AQ04 ch0M
 *    PLC 程序：AIW0(AI04 ch0) → AQW8(AQ04 ch0)，使数字转速表显示 AI 采集值。
 *    默认：PLC 处于 STOP；电机默认停止（需手动切 RUN 并按 SB1 起动）。
 */
export const PROJECT_WORKFLOWS = {

    // ══════════════════════════════════════════════════════════════════
    // 1. PLC 模块识别及接线
    // ══════════════════════════════════════════════════════════════════
    'plc-wiring': {
        id: 'plc-wiring',
        name: '1. PLC 模块识别及接线',
        steps: [
            // ── 模块识别 ─────────────────────────────────────────────
            { mode: 'find', target: 'plc-1',
              msg: '1. 识别 PLC 的 CPU 模块（西门子 S7-200 SMART CPU SR40）。' },
            { mode: 'find', target: 'ai04-1',
              msg: '2. 识别模拟量输入模块 EM AI04（4 路模拟量输入，0 号通道默认 4~20mA）。' },
            { mode: 'find', target: 'aq04-1',
              msg: '3. 识别模拟量输出模块 EM AQ04（4 路模拟量输出）。' },
            { mode: 'find', target: 'di08-1',
              msg: '4. 识别开关量输入模块 EM DI08（8 路数字量输入）。' },
            { mode: 'find', target: 'dq08-1',
              msg: '5. 识别开关量输出模块 EM DQ08（8 路数字量输出）。' },

            // ── 6. CPU 模块接线 ──────────────────────────────────────
            {
                mode: 'check',
                msg: '6. CPU 模块接线：接 24V 电源、1M（输入公共端）接 0V、1L+（输出负载电源）接 24V。',
                check() {
                    const s = this.sys;
                    return _hasConn(s, 'dc24_wire_p', 'plc-1_wire_24v')
                        && _hasConn(s, 'dc24_wire_n', 'plc-1_wire_v0')
                        && _hasConn(s, 'plc-1_wire_1m', 'plc-1_wire_v0')
                        && _hasConn(s, 'plc-1_wire_1l', 'plc-1_wire_24v');
                },
                op: [
                    { type: 'observe', target: 'plc-1', part: 'term-24v', circleR: 14,
                      msg: 'PLC 电源：外部直流 24V 电源正极 → CPU 的 24V 端子，负极 → 0V 端子',
                      async act() { const s = this.sys; await _wireAnim(s, 'dc24_wire_p', 'plc-1_wire_24v'); await _wireAnim(s, 'dc24_wire_n', 'plc-1_wire_v0'); s.redrawAll(); } },
                    { type: 'observe', target: 'plc-1', part: 'term-1m', circleR: 14,
                      msg: '输入公共端 1M / 2M → 0V',
                      async act() { const s = this.sys; await _wireAnim(s, 'plc-1_wire_1m', 'plc-1_wire_v0');  s.redrawAll(); } },
                    { type: 'observe', target: 'plc-1', part: 'term-1l', circleR: 14,
                      msg: '输出负载电源 1L+ → 24V',
                      async act() { const s = this.sys; await _wireAnim(s, 'plc-1_wire_1l', 'plc-1_wire_24v'); s.redrawAll(); } },
                ],
            },

            // ── 7. 开关量输入接线 ────────────────────────────────────
            {
                mode: 'check',
                msg: '7. 开关量输入接线：24V 接开关左端、右端接 PLC 数字量输入，分别接 FR 常闭(I0.2)、停止按钮(I0.1)、起动按钮(I0.0)。',
                check() {
                    const s = this.sys;
                    return _hasConn(s, 'pterm-24_wire_p', 'fr-nc_wire_com') && _hasConn(s, 'fr-nc_wire_nc', 'plc-1_wire_di02')
                        && _hasConn(s, 'pterm-24_wire_p', 'sb2-stop_wire_no1') && _hasConn(s, 'sb2-stop_wire_no2', 'plc-1_wire_di01')
                        && _hasConn(s, 'pterm-24_wire_p', 'sb1-start_wire_no1') && _hasConn(s, 'sb1-start_wire_no2', 'plc-1_wire_di00');
                },
                op: [
                    { type: 'observe', target: 'fr-nc', part: 'term-com', circleR: 14,
                      msg: '热继电器 FR 常闭（95-96）：+24V → FR 左端，FR 右端 → I0.2',
                      async act() { const s = this.sys; await _wireAnim(s, 'pterm-24_wire_p', 'fr-nc_wire_com'); await _wireAnim(s, 'fr-nc_wire_nc', 'plc-1_wire_di02'); s.redrawAll(); } },
                    { type: 'observe', target: 'sb2-stop', part: 'btn', circleR: 22,
                      msg: '停止按钮 SB2：+24V → 左端，右端 → I0.1',
                      async act() { const s = this.sys; await _wireAnim(s, 'pterm-24_wire_p', 'sb2-stop_wire_no1'); await _wireAnim(s, 'sb2-stop_wire_no2', 'plc-1_wire_di01'); s.redrawAll(); } },
                    { type: 'observe', target: 'sb1-start', part: 'btn', circleR: 22,
                      msg: '起动按钮 SB1：+24V → 左端，右端 → I0.0',
                      async act() { const s = this.sys; await _wireAnim(s, 'pterm-24_wire_p', 'sb1-start_wire_no1'); await _wireAnim(s, 'sb1-start_wire_no2', 'plc-1_wire_di00'); s.redrawAll(); } },
                ],
            },

            // ── 8. 开关量输出接线 ────────────────────────────────────
            {
                mode: 'check',
                msg: '8. 开关量输出接线：本体 Q0.0 接 KM1 线圈左端 A1、0V 接 KM1 线圈右端 A2。',
                check() {
                    const s = this.sys;
                    return _hasConn(s, 'plc-1_wire_dq00', 'km1-coil_wire_a1')
                        && _hasConn(s, 'km1-coil_wire_a2', 'plc-1_wire_v0');
                },
                op: [
                    { type: 'observe', target: 'plc-1', part: 'term-dq00', circleR: 14,
                      msg: '本体输出 Q0.0 → 接触器 KM1 线圈左端 A1',
                      async act() { const s = this.sys; await _wireAnim(s, 'plc-1_wire_dq00', 'km1-coil_wire_a1'); s.redrawAll(); } },
                    { type: 'observe', target: 'km1-coil', circleR: 30,
                      msg: '0V → KM1 线圈右端 A2',
                      async act() { const s = this.sys; await _wireAnim(s, 'km1-coil_wire_a2', 'plc-1_wire_v0'); s.redrawAll(); } },
                ],
            },

            // ── 9. 模拟量输入接线 ────────────────────────────────────
            {
                mode: 'check',
                msg: '9. 模拟量输入接线：24V 电源、转速变送器与 AI04 的输入通道 0 连接。',
                check() {
                    const s = this.sys;
                    return _hasConn(s, 'plc-1_wire_24v', 'speed-tx_wire_p')
                        && _hasConn(s, 'speed-tx_wire_n', 'ai04-1_wire_ai0p')
                        && _hasConn(s, 'ai04-1_wire_ai0n', 'plc-1_wire_v0');
                },
                op: [
                    { type: 'observe', target: 'speed-tx', part: 'term-p', circleR: 14,
                      msg: '24V 电源 → 转速变送器 P（两线制回路正端）',
                      async act() { const s = this.sys; await _wireAnim(s, 'plc-1_wire_24v', 'speed-tx_wire_p'); s.redrawAll(); } },
                    { type: 'observe', target: 'ai04-1', part: 'term-ai0p', circleR: 14,
                      msg: '转速变送器 N → AI04 通道 0 的 +（4~20mA 流入）',
                      async act() { const s = this.sys; await _wireAnim(s, 'speed-tx_wire_n', 'ai04-1_wire_ai0p'); s.redrawAll(); } },
                    { type: 'observe', target: 'plc-1', part: 'term-v0', circleR: 14,
                      msg: 'AI04 通道 0 的 − → 0V（回路返回）',
                      async act() { const s = this.sys; await _wireAnim(s, 'ai04-1_wire_ai0n', 'plc-1_wire_v0'); s.redrawAll(); } },
                ],
            },

            // ── 10. 模拟量输出接线 ───────────────────────────────────
            {
                mode: 'check',
                msg: '10. 模拟量输出接线：AQ04 的 0 号通道连接到数字转速表。',
                check() {
                    const s = this.sys;
                    return _hasConn(s, 'aq04-1_wire_aq0v', 'digi-tach_wire_sig')
                        && _hasConn(s, 'digi-tach_wire_com', 'aq04-1_wire_aq0m');
                },
                op: [
                    { type: 'observe', target: 'aq04-1', part: 'term-aq0v', circleR: 14,
                      msg: 'AQ04 通道 0 的 V → 数字转速表 sig',
                      async act() { const s = this.sys; await _wireAnim(s, 'aq04-1_wire_aq0v', 'digi-tach_wire_sig'); s.redrawAll(); } },
                    { type: 'observe', target: 'digi-tach', part: 'term-com', circleR: 14,
                      msg: '数字转速表 com → AQ04 通道 0 的 M',
                      async act() { const s = this.sys; await _wireAnim(s, 'digi-tach_wire_com', 'aq04-1_wire_aq0m'); s.redrawAll(); } },
                ],
            },

            // ── 11. 将 4 个模块接入扩展总线 ──────────────────────────
            {
                mode: 'check',
                msg: '11. 将 4 个扩展模块（AI04 → AQ04 → DI08 → DQ08）依次接入 SR40 右侧扩展总线。',
                check() {
                    const s = this.sys;
                    return ['ai04-1', 'aq04-1', 'di08-1', 'dq08-1']
                        .every(id => s.comps[id] && s.comps[id]._mounted);
                },
                op: [
                    { type: 'observe', target: 'ai04-1', circleR: 20,
                      msg: '将模拟量输入模块 AI04 插入 CPU 右侧扩展接口',
                      async act() { await _attachModule(this.sys, 'ai04-1'); } },
                    { type: 'observe', target: 'aq04-1', circleR: 20,
                      msg: '将模拟量输出模块 AQ04 级联到 AI04 右侧',
                      async act() { await _attachModule(this.sys, 'aq04-1'); } },
                    { type: 'observe', target: 'di08-1', circleR: 20,
                      msg: '将开关量输入模块 DI08 级联到 AQ04 右侧',
                      async act() { await _attachModule(this.sys, 'di08-1'); } },
                    { type: 'observe', target: 'dq08-1', circleR: 20,
                      msg: '将开关量输出模块 DQ08 级联到 DI08 右侧',
                      async act() { await _attachModule(this.sys, 'dq08-1'); } },
                ],
            },

            // ── 12. 填空：各扩展模块起始地址 ─────────────────────────
            {
                mode: 'fill',
                target: 'plc-1',
                msg: '12. 4 个扩展模块已接入扩展总线，请填写各模块的起始地址。',
                ready() {
                    const s = this.sys;
                    return ['ai04-1', 'aq04-1', 'di08-1', 'dq08-1']
                        .every(id => s.comps[id] && s.comps[id]._mounted);
                },
                fields: [
                    { label: 'DI08 起始地址', answer: ['I3.0', 'IB3'], unit: '', placeholder: '如 I3.0' },
                    { label: 'DQ08 起始地址', answer: ['Q2.0', 'QB2'], unit: '', placeholder: '如 Q2.0' },
                    { label: 'AI04 起始地址', answer: ['AIW0'], unit: '', placeholder: '如 AIW0' },
                    { label: 'AQ04 起始地址', answer: ['AQW0'], unit: '', placeholder: '如 AQW0' },
                ],
            },
        ],
    },

    // ══════════════════════════════════════════════════════════════════
    // 2. PLC 程序的上传和下载（STEP7 上位机）
    // ══════════════════════════════════════════════════════════════════
    'plc-prog': {
        id: 'plc-prog',
        name: '2. PLC 程序的上传和下载',
        steps: [
            // ── 1. 自动接线 + 插入 4 个扩展模块 ──────────────────────
            {
                mode: 'check',
                msg: '1. 点击「自动接线」完成全部接线，并将 4 个扩展模块插入 SR40 右侧扩展总线。',
                check() {
                    const s = this.sys;
                    const wired = _hasConn(s, 'ac-3p_wire_u', 'km1-mc_wire_l1')
                        && _hasConn(s, 'dc24_wire_p', 'plc-1_wire_24v')
                        && _hasConn(s, 'plc-1_wire_24v', 'speed-tx_wire_p')
                        && _hasConn(s, 'aq04-1_wire_aq0v', 'digi-tach_wire_sig');
                    const mounted = ['ai04-1', 'aq04-1', 'di08-1', 'dq08-1']
                        .every(id => s.comps[id] && s.comps[id]._mounted);
                    return wired && mounted;
                },
                op: [
                    { type: 'wire', msg: '点击工具栏「自动接线」，完成主电路 / 控制回路 / 模拟量回路接线',
                      async act() { this.sys.applyAllPresets(); await _wait(600); } },
                    { type: 'observe', target: 'ai04-1', circleR: 20, msg: '将模拟量输入模块 AI04 插入扩展总线',
                      async act() { await _attachModule(this.sys, 'ai04-1'); } },
                    { type: 'observe', target: 'aq04-1', circleR: 20, msg: '将模拟量输出模块 AQ04 插入扩展总线',
                      async act() { await _attachModule(this.sys, 'aq04-1'); } },
                    { type: 'observe', target: 'di08-1', circleR: 20, msg: '将开关量输入模块 DI08 插入扩展总线',
                      async act() { await _attachModule(this.sys, 'di08-1'); } },
                    { type: 'observe', target: 'dq08-1', circleR: 20, msg: '将开关量输出模块 DQ08 插入扩展总线',
                      async act() { await _attachModule(this.sys, 'dq08-1'); } },
                ],
            },

            // ── 2. PLC 转入运行 + 起动电机 ───────────────────────────
            {
                mode: 'check',
                msg: '2. 将 PLC 转入运行状态，按下起动按钮 SB1 起动电机。',
                check() {
                    const s = this.sys;
                    const p = s.comps['plc-1'], m = s.comps['m-3d'];
                    return p.mode === 'RUN' && m && m.getSpeed() > 0;
                },
                op: [
                    { type: 'switch', target: 'plc-1', part: 'mode-sw',
                      msg: '将 PLC 的 RUN/STOP 开关拨到 RUN（转入运行状态）',
                      async act() { const p = this.sys.comps['plc-1']; if (p.mode !== 'RUN') p.toggleMode(); await _wait(500); } },
                    { type: 'btn', target: 'sb1-start', part: 'btn',
                      msg: '按下起动按钮 SB1，起动电机（起保停程序自锁保持运行）',
                      async act() { const b = this.sys.comps['sb1-start']; b.setManualOverride(true); await _wait(1600); b.setManualOverride(false); await _wait(600); } },
                ],
            },

            // ── 3. 打开 STEP7 → 连接 → 上传 ─────────────────────────
            {
                mode: 'check',
                msg: '3. 打开 STEP7 软件界面，点击「连接」与 PLC 建立连接，再点击「上传」从 PLC 读取当前运行程序。',
                check() {
                    const ui = _s7(this.sys);
                    return !!(ui && ui.connectedId && ui._programLoaded);
                },
                op: [
                    { type: 'observe', target: 'step7pc-1', part: 'screen', circleR: 24,
                      msg: '双击上位机屏幕，打开 STEP7 编程界面',
                      async act() { this.sys.comps['step7pc-1'].openStep7(); await _wait(600); } },
                    { type: 'observe', target: 'step7pc-1', part: 'screen', circleR: 24,
                      msg: '点击「连接」，与 PLC 建立在线连接',
                      async act() { await _s7Click(this, '#s7-connect', '点击「连接」', 700); } },
                    { type: 'observe', target: 'step7pc-1', part: 'screen', circleR: 24,
                      msg: '点击「上传」，从 PLC 读取当前运行程序（显示为梯形图）',
                      async act() { await _s7Click(this, '#s7-upload', '点击「上传」读取程序', 800); } },
                ],
            },

            // ── 4. 删除 Q0.0 自锁触点 → 下载 ────────────────────────
            {
                mode: 'check',
                msg: '4. 在梯形图中删除 Q0.0 自锁触点，点击「下载」将新程序写入 PLC。',
                check() {
                    const p = this.sys.comps['plc-1'];
                    return !/O\s+Q0\.0/.test(p.getProgram());
                },
                op: [
                    { type: 'observe', target: 'step7pc-1', part: 'screen', circleR: 24,
                      msg: '在梯形图中删除 Q0.0 自锁触点（并联支路）',
                      async act() {
                          const ui = _s7(this.sys);
                          if (!ui || !ui._ladder.networks.length) return;
                          const net = ui._ladder.networks[0];
                          const par = (net.elements || []).find(e => e.type === 'parallel');
                          if (par) {
                              const bi = par.branches.findIndex(br => br.some(c => c.op === 'Q0.0'));
                              if (bi >= 0) {
                                  const chip = ui._root.querySelector(`[data-path="0.b${bi}.c0"]`);
                                  if (chip) await this._flashDomElement(chip, '删除 Q0.0 自锁触点', 1500);
                                  par.branches.splice(bi, 1);
                                  const i = net.elements.indexOf(par);
                                  if (par.branches.length === 0) net.elements.splice(i, 1);
                                  else if (par.branches.length === 1) net.elements.splice(i, 1, ...par.branches[0]);
                                  ui._renderMain();
                              }
                          }
                          await _wait(500);
                      } },
                    { type: 'observe', target: 'step7pc-1', part: 'screen', circleR: 24,
                      msg: '点击「下载」，将修改后的程序写入 PLC',
                      async act() { await _s7Click(this, '#s7-download', '点击「下载」写入 PLC', 900); } },
                ],
            },

            // ── 5. 验证新程序（无自锁：松开起动即停）────────────────
            {
                mode: 'check',
                msg: '5. 按住起动按钮电机运转，松开起动按钮电机即停（自锁已删除）—— 验证新程序生效。',
                check() {
                    // 检测到起动按钮 SB1 被按下（按住）即判通过
                    const b = this.sys.comps['sb1-start'];
                    return !!(b && (b._isPressed || b._manualPressed));
                },
                op: [
                    { type: 'btn', target: 'sb1-start', part: 'btn',
                      msg: '按住起动按钮 SB1 —— 电机运转',
                      async act() { this.sys.comps['sb1-start'].setManualOverride(true); await _wait(1600); } },
                    { type: 'btn', target: 'sb1-start', part: 'btn',
                      msg: '松开起动按钮 SB1 —— 因已删除自锁触点，电机立即停转（证明新程序已生效）',
                      async act() { this.sys.comps['sb1-start'].setManualOverride(false); await _wait(900); } },
                ],
            },

            // ── 6. 进入在线监控 ─────────────────────────────────────
            {
                mode: 'check',
                msg: '6. 在 STEP7 界面上点击「监控」，进入在线监控状态（梯形图按实时状态着色）。',
                check() {
                    const ui = _s7(this.sys);
                    return !!(ui && ui._monitoring);
                },
                op: [
                    { type: 'observe', target: 'step7pc-1', part: 'screen', circleR: 24,
                      msg: '点击「监控」，进入在线监控状态',
                      async act() { await _s7Click(this, '#s7-monitor', '点击「监控」进入监控状态', 900); } },
                ],
            },
        ],
    },
};

export const componentConfigs = [
    // 三相电源（简化单线图符号）
    { Class: DiagramACPower3P, id: 'ac-3p', x: -30, y: 60, vRms: 220, freq: 50, isOn: true, phaseSeq: 'pos' },

    // ── 主电路（AC 380V）──
    // 接触器 KM1 主触头
    { Class: MainContact, id: 'km1-mc', x: -30, y: 160, width: 200, height: 100, deviceid: 'KM1' },
    // 热继电器 FR 发热元件
    { Class: ThermalHeatElement, id: 'fr', x: -30, y: 320, width: 200, height: 100,
      deviceid: 'FR1', ratedCurrent: 7.5, tripClass: 10 },
    // 三相异步电动机（额定 5kW / 380V / 1440r/min）
    { Class: ThreePhaseMotor3D, id: 'm-3d', x: -30, y: 500, scale: 2 / 3, label: 'M1',
      ratedPower: 5.0, ratedVoltage: 380, ratedFreq: 50, ratedSpeed: 1440, loadRate: 1.0 },

    // ── 控制回路（DC 24V）──
    // 接触器 KM1 线圈（额定 DC24V，PLC 直接驱动）
    { Class: ContactorCoil, id: 'km1-coil', x: 630, y: 890, width: 70, height: 50,
      deviceid: 'KM1', ratedCoilVoltage: 24, coilResistance: 240 },
    // 直流 24V 电源（位于 KM1 线圈右侧）：正极 → PLC 24V，负极 → PLC 0V
    { Class: DCPower, id: 'dc24', x: 310, y: 550, voltage: 24, isOn: true },
    // 24V 电位端子：控制回路公共 +24V 母线
    { Class: PotentialTerminal, id: 'pterm-24', x: 320, y: 175, potential: 24, scale: 1.2 },
    // 热继电器 FR 常闭触点（95-96，过载反馈）
    { Class: ThermalNCContact, id: 'fr-nc', x: 420, y: 230, width: 70, height: 50, deviceid: 'FR1' },

    // PLC：西门子 S7-200 SMART CPU SR40（24DI/16DO/2AI/1AO）
    // 默认处于 STOP 状态（需手动切到 RUN 才执行程序）
    { Class: S7_200_SMART_SR40, id: 'plc-1', x: 630, y: 240, scale: 1.0, label: 'SR40',
      mode: 'STOP',
      hostname: 'PLC-SR40', ip: '192.168.0.1', mask: '255.255.255.0',
      program: [
        '// S7-200 SMART SR40 —— 起保停控制电机 + 模拟量直通',
        '// I0.0 启动(SB1)  I0.1 停止(SB2)  I0.2 热继电器FR反馈',
        '// Q0.0 → 接触器 KM1 线圈',
        '// AIW0(AI04 ch0，转速变送器 4~20mA) → AQW0(AQ04 ch0) → 数字转速表',
        'LD     I0.0',
        'O      Q0.0',
        'AN     I0.1',
        'A      I0.2',        // 热继电器未动作（常闭）才允许运行
        '=      Q0.0',
        'LD     SM0.0',
        'MOV_W  AIW0, AQW0',  // 模拟量直通：AI04 ch0 → AQ04 ch0
        'END',
      ].join('\n') },

    // ── PLC 扩展模块（4 个，默认在 SR40 右侧等间距排列、默认不吸附）──
    // 顺序：AI04 → AQ04 → DI08 → DQ08；间距 30px（SR40 右缘 1320 起）
    // 0 号通道默认 4~20mA（转速变送器采集 / 数字转速表输出）
    { Class: S7_200_EM_AI04, id: 'ai04-1', x: 1210, y: 200, width: 115, height: 470, label: 'EM AI04', ch0mode: 'I4-20' },
    { Class: S7_200_EM_AQ04, id: 'aq04-1', x: 1355, y: 200, width: 115, height: 470, label: 'EM AQ04', ch0mode: 'I4-20' },
    { Class: S7_200_EM_DI08, id: 'di08-1', x: 1500, y: 200, width: 115, height: 470, label: 'EM DI08' },
    { Class: S7_200_EM_DQ08, id: 'dq08-1', x: 1645, y: 200, width: 115, height: 470, label: 'EM DQ08' },

    // 启停按钮（常开按钮 NO：一端接 24V 电位端子，另一端接 DI）
    // SB1 启动（绿色）、SB2 停止（红色），均为常开触点，按下接通、松开断开
    { Class: DiagramStartButton, id: 'sb1-start', x: 420, y: 380, label: 'SB1 启动' },
    { Class: DiagramStartButton, id: 'sb2-stop',  x: 420, y: 300, label: 'SB2 停止', color: '#e03030' },

    // 接地参考（PE / 0V 公共）
    { Class: Ground, id: 'gnd-1', x: 270, y: 520 },

    // ── 上位机（装有 STEP7 编程软件）──
    { Class: STEP7PC, id: 'step7pc-1', x: 720, y: 160,
      hostname: 'STEP7-PC', ip: '192.168.0.2', mask: '255.255.255.0' },

    // ── 模拟量 4~20mA 回路演示件（默认不接线）──
    // 转速变送器：取自电机 m-3d 实际转速，两线制输出 4~20mA（0~2000 r/min）
    { Class: SpeedTransmitter, id: 'speed-tx', x: 60, y: 750,
      label: '转速变送器', sourceMotor: 'm-3d', rpmMin: 0, rpmMax: 2000 },
    // 数字转速表：接收 4~20mA 显示转速（0~2000 r/min）
    { Class: DigitalTachometer, id: 'digi-tach', x: 1450, y: 800,
      label: '数字转速表', rpmMin: 0, rpmMax: 2000, inputMode: 'I4-20' },

    // ── 7 种必备仪表（默认隐藏）──
    { Class: Multimeter, id: 'multimeter', x: 720, y: -20, visible: false },
    { Class: MF47Multimeter, id: 'mf47-panel', x: 1150, y: 250, visible: false },
    { Class: Oscilloscope_tri, id: 'osc', x: 50, y: 50, visible: false },
    { Class: SignalGenerator, id: 'sg', x: 50, y: 50, visible: false },
    { Class: ProcessCalibrator, id: 'cali', x: 50, y: 50, visible: false },
    { Class: ElecMeter, id: 'elecmeter', x: 50, y: 50, visible: false },
    { Class: RealMegohmMeter, id: 'megohm', x: 50, y: 50, visible: false },
];

// ── 电路连线（主电路与控制回路分开走线）────────────────────────
function _wire(sys) {
    const conns = [
        // ══════════ 主电路（AC 380V）══════════
        // 电源 → 接触器 KM1 主触头
        { from: 'ac-3p_wire_u', to: 'km1-mc_wire_l1', type: 'wire' },
        { from: 'ac-3p_wire_v', to: 'km1-mc_wire_l2', type: 'wire' },
        { from: 'ac-3p_wire_w', to: 'km1-mc_wire_l3', type: 'wire' },
        // 主触头 → 热继电器 FR 发热元件
        { from: 'km1-mc_wire_t1', to: 'fr_wire_l1', type: 'wire' },
        { from: 'km1-mc_wire_t2', to: 'fr_wire_l2', type: 'wire' },
        { from: 'km1-mc_wire_t3', to: 'fr_wire_l3', type: 'wire' },
        // 发热元件 → 电动机
        { from: 'fr_wire_t1', to: 'm-3d_wire_u', type: 'wire' },
        { from: 'fr_wire_t2', to: 'm-3d_wire_v', type: 'wire' },
        { from: 'fr_wire_t3', to: 'm-3d_wire_w', type: 'wire' },
        // 电机 PE 接地
        { from: 'm-3d_wire_pe', to: 'gnd-1_wire_gnd', type: 'wire' },

        // ══════════ 控制回路（DC 24V）══════════
        // 外部直流 24V 电源：正极 → PLC 24V 端子，负极 → PLC 0V 端子
        // （取代 CPU 内部 24V 传感器电源，PLC 24V/0V 由外部电源供电）
        { from: 'dc24_wire_p', to: 'plc-1_wire_24v', type: 'wire' },
        { from: 'dc24_wire_n', to: 'plc-1_wire_v0', type: 'wire' },

        // 公共端：PLC 1M/2M → PLC 0V（DI 源型接法）
        { from: 'plc-1_wire_1m', to: 'plc-1_wire_v0', type: 'wire' },

        // 24V 电位端子作为控制回路公共 +24V 母线：
        // 电位端子 → FR 常闭左边(com)，再一路往下接 SB1/SB2 左边(l)
        //（原从 PLC 内部 24V 端子给按钮/FR 取电的接线已取消）
        { from: 'pterm-24_wire_p', to: 'fr-nc_wire_com', type: 'wire' },
        { from: 'pterm-24_wire_p', to: 'sb1-start_wire_no1', type: 'wire' },
        { from: 'pterm-24_wire_p', to: 'sb2-stop_wire_no1', type: 'wire' },

        // 启动按钮 SB1（常开）：+24V → SB1 → I0.0
        { from: 'sb1-start_wire_no2', to: 'plc-1_wire_di00', type: 'wire' },
        // 停止按钮 SB2（常开）：+24V → SB2 → I0.1
        { from: 'sb2-stop_wire_no2', to: 'plc-1_wire_di01', type: 'wire' },
        // 热继电器 FR 常闭触点（过载反馈）：+24V → FR(95-96) → I0.2
        { from: 'fr-nc_wire_nc', to: 'plc-1_wire_di02', type: 'wire' },
        // 输出回路：Q0.0 → 接触器 KM1 线圈 A1，线圈 A2 → PLC 0V
        { from: 'plc-1_wire_1l', to: 'plc-1_wire_24v', type: 'wire' },   // 输出组电源 1L+
        { from: 'plc-1_wire_dq00', to: 'km1-coil_wire_a1', type: 'wire' },
        { from: 'km1-coil_wire_a2', to: 'plc-1_wire_v0', type: 'wire' },

        // ══════════ 上位机网络（STEP7 PC ↔ PLC 以太网口）══════════
        { from: 'step7pc-1_wire_lan', to: 'plc-1_wire_lan', type: 'wire' },

        // ══════════ 模拟量 4~20mA 回路 ══════════
        // 采集回路：24V → 转速变送器 P；变送器 N → AI04 ch0+；AI04 ch0- → 0V
        { from: 'plc-1_wire_24v', to: 'speed-tx_wire_p', type: 'wire' },
        { from: 'speed-tx_wire_n', to: 'ai04-1_wire_ai0p', type: 'wire' },
        { from: 'ai04-1_wire_ai0n', to: 'plc-1_wire_v0', type: 'wire' },
        // 输出回路：AQ04 ch0V → 数字转速表 sig；表 com → AQ04 ch0M
        { from: 'aq04-1_wire_aq0v', to: 'digi-tach_wire_sig', type: 'wire' },
        { from: 'digi-tach_wire_com', to: 'aq04-1_wire_aq0m', type: 'wire' },
    ];
    conns.forEach(c => {
        const dup = sys.conns.some(e => sys.connMgr.connEqual(e, c));
        if (!dup) sys.connMgr.addConn(c);
    });
    sys.redrawAll();
}

function _powerOn(sys) {
    const ac = sys.comps['ac-3p'];
    if (ac) ac.onConfigUpdate({ vRms: 220, freq: 50, isOn: true, phaseSeq: 'pos' });
}

// ── 工作流辅助 ──────────────────────────────────────────────
/** 判断两端口之间是否已连线 */
function _hasConn(sys, a, b) {
    return sys.conns.some(c => (c.from === a && c.to === b) || (c.from === b && c.to === a));
}

/** 动画接线（约 3s/根）；已连接的跳过，保证演示可重复运行 */
async function _wireAnim(sys, from, to) {
    if (_hasConn(sys, from, to)) return;
    await sys.connMgr.addConnectionAnimated({ from, to, type: 'wire' });
}

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

/** 将扩展模块接入（动画移动到父级右侧接口并吸附挂接） */
function _attachModule(sys, modId) {
    return new Promise(resolve => {
        const cpu = sys.comps['plc-1'];
        const mod = sys.comps[modId];
        if (!cpu || !mod) { resolve(); return; }
        if (mod._mounted) { resolve(); return; }
        const chain = cpu._expansionModules || [];
        const parent = chain.length ? chain[chain.length - 1] : cpu;
        if (typeof parent.expansionSocket !== 'function' || typeof mod.extensionPlugAnchor !== 'function') { resolve(); return; }
        const sock = parent.expansionSocket();
        const plug = mod.extensionPlugAnchor();
        const tx = parent.group.x() + sock.x - plug.x;
        const ty = parent.group.y() + sock.y - plug.y;
        // 动画移向接口，随后吸附挂接
        mod.group.to({ x: tx, y: ty, duration: 0.6 });
        setTimeout(() => {
            mod._parentExp = parent.id;
            sys._recomputeAllChains();
            sys._layoutAttachedModules();
            if (sys.requestRedraw) sys.requestRedraw();
            resolve();
        }, 700);
    });
}

export function initSlider(_sys) {
    // 自动演示时只保留箭头指示，不闪亮整个组件
    _sys._noBlinkHighlight = true;
}

export function applyAllPresets() {
    // 初始化（ControlSystem.init 调用，this 无 sys 引用）时不接线；
    // 仅当点击工具栏「自动接线」（WorkflowManager 调用，this.sys 存在）时才接好全部线。
    if (!(this && this.sys && this.sys.connMgr)) return;
    _wire(this.sys);
    _powerOn(this.sys);
}

export async function applyStartSystem() {
    if (!(this && this.sys && this.sys.connMgr)) return;
    _wire(this.sys);
    _powerOn(this.sys);
}

export function fiveStep() { }
