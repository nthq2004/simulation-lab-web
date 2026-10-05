
// ══════════════════════════════════════════════════════════════════════════
//  PLC 模拟量/开关量控制实验 —— sys_dgdq3-1.js
//
//  电路组成：
//    1) PLC 本体：S7-200 SMART CPU ST20（12DI/8DO 晶体管源型），默认 STOP
//       外部 24V 电源（dc24）→ PLC 24V/0V；1M → 0V；1L+ → 24V
//    2) 数字量输入：I0.0 增开度按钮、I0.1 减开度按钮（常开按钮，+24V → 按钮 → DI）
//    3) 模拟量输出：AQ04 ch0（4~20mA）驱动电动三通调节阀（ElecValve）
//    4) 模拟量输入：AI04 ch0（4~20mA）接阀位变送器（仅测量阀位，程序不处理）
//    5) 电磁阀驱动电路（独立手动演示，远离 PLC）：24V → 电磁阀线圈 → NPN 三极管 C-E → 地；
//       线圈两端反并联「二极管 + 电阻」续流回路；3V → 开关 → 限流电阻 → 基极
//    6) 实物陈列：晶闸管（RealScr）、IGBT（RealIGBT）—— 仅识别，不接线
//
//  PLC 程序（I0.0/I0.1 控制阀位增/减，每 1% 步进）：
//    - I0.0 上升沿 → 开度 +1%；I0.1 上升沿 → 开度 −1%
//    - 按住 I0.0 超过 2s 后，每 0.2s 继续 +1%（长按连加）；I0.1 同理连减
//    - 开度限幅 0~100%；AQW0 = 开度 × 276（4~20mA）
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
import { S7_200_EM_AI04 } from '../components/S7200_EM_AI04.js';       // 模拟量输入扩展模块 EM AI04
import { S7_200_EM_AQ04 } from '../components/S7200_EM_AQ04.js';       // 模拟量输出扩展模块 EM AQ04
import { STEP7PC } from '../components/STEP7PC.js';                    // 装有 STEP7 的上位机
import { ElecValve } from '../components/ElecValve.js';                // 电动三通调节阀
import { ValvePositionTransmitter } from '../components/ValvePositionTransmitter.js'; // 阀位变送器
import { DiagramStartButton } from '../components/DiagramStartButton.js'; // 常开按钮（NO 干接点）
import { PotentialTerminal } from '../components/PotentialTerminal.js';   // 电位端子
import { DCPower } from '../components/DCPower.js';                      // 直流 24V 电源
import { Ground } from '../components/Gnd.js';                           // 接地参考

// ── 电磁阀驱动电路元件（参照 lab_08/sys20-ecircuit）─────────────────────
import { SolenoidValve } from '../components/SolenoidValve.js';         // 电磁阀（线圈 + 截止阀）
import { Transistor } from '../components/Transistor.js';               // NPN 三极管
import { Resistor } from '../components/Resistor.js';                   // 电阻
import { Switch } from '../components/Switch.js';                       // 基极开关
import { Diode } from '../components/Diode.js';                         // 续流二极管

// ── 实物陈列元件 ───────────────────────────────────────────────────────
import { RealScr } from '../components/RealScr.js';                     // 晶闸管实物
import { RealIGBT } from '../components/RealIGBT.js';                   // IGBT 实物

export const FAULT_CONFIGS = {};

// ══════════════════════════════════════════════════════════════════════════
//  操作流程
//    1. 测试电磁阀驱动电路（含万用表测量 Vce 截止/饱和）
//    2. 测试晶闸管和 IGBT（万用表简单检测，不新增元件）
//    3. 测试 PLC 输入输出电路（DI 按钮 → 程序 → AQ04 → 阀 + 阀位变送器 → AI04）
// ══════════════════════════════════════════════════════════════════════════
export const PROJECT_WORKFLOWS = {

    // ══════════════════════════════════════════════════════════════════
    // 流程 1：测试电磁阀驱动电路
    // ══════════════════════════════════════════════════════════════════
    'sv-drive': {
        id: 'sv-drive',
        name: '1. 测试电磁阀驱动电路',
        steps: [
            // ── 1. 主回路接线 + 反向续流回路 ──
            {
                mode: 'check',
                msg: '1. 主回路接线：24V 电位端子 → 电磁阀线圈 a；线圈 b → 三极管集电极 C；发射极 E → 地。同时在线圈两端反并联续流回路（二极管 + 电阻）。',
                check() {
                    const s = this.sys;
                    return _hasConn(s, 'pt1_wire_p', 'sv_wire_a')
                        && _hasConn(s, 'sv_wire_b', 'q1_wire_c')
                        && _hasConn(s, 'q1_wire_e', 'gnd-sv_wire_gnd')
                        && _hasConn(s, 'sv_wire_b', 'dfw_wire_l')
                        && _hasConn(s, 'dfw_wire_r', 'rfw_wire_l')
                        && _hasConn(s, 'rfw_wire_r', 'sv_wire_a');
                },
                op: [
                    { type: 'observe', target: 'pt1', msg: '+24V → 电磁阀线圈 a（主回路正端）',
                      async act() { const s = this.sys; await _wireAnim(s, 'pt1_wire_p', 'sv_wire_a'); s.redrawAll(); } },
                    { type: 'observe', target: 'sv', msg: '线圈 b → 三极管集电极 C',
                      async act() { const s = this.sys; await _wireAnim(s, 'sv_wire_b', 'q1_wire_c'); s.redrawAll(); } },
                    { type: 'observe', target: 'q1', msg: '发射极 E → 地（发射极参考地）',
                      async act() { const s = this.sys; await _wireAnim(s, 'q1_wire_e', 'gnd-sv_wire_gnd'); s.redrawAll(); } },
                    // ── 反向续流回路：线圈两端反并联「二极管 + 电阻」──
                    { type: 'observe', target: 'dfw', msg: '续流二极管阳极接线圈 b 端（阴极朝 a 端，反并联于线圈）',
                      async act() { const s = this.sys; await _wireAnim(s, 'sv_wire_b', 'dfw_wire_l'); s.redrawAll(); } },
                    { type: 'observe', target: 'rfw', msg: '续流二极管阴极 → 续流电阻 → 线圈 a 端，构成续流回路',
                      async act() {
                          const s = this.sys;
                          await _wireAnim(s, 'dfw_wire_r', 'rfw_wire_l');
                          await _wireAnim(s, 'rfw_wire_r', 'sv_wire_a');
                          s.redrawAll();
                      } },
                ],
            },
            // ── 2. 基极支路接线 ──
            {
                mode: 'check',
                msg: '2. 基极支路接线：3V 电位端子 → 开关 SB → 限流电阻 RL（1kΩ）→ 三极管基极。',
                check() {
                    const s = this.sys;
                    return _hasConn(s, 'pt2_wire_p', 'sb_wire_l')
                        && _hasConn(s, 'sb_wire_r', 'rl_wire_l')
                        && _hasConn(s, 'rl_wire_r', 'q1_wire_b');
                },
                op: [
                    { type: 'observe', target: 'pt2', msg: '+3V → 基极开关 SB 左端',
                      async act() { const s = this.sys; await _wireAnim(s, 'pt2_wire_p', 'sb_wire_l'); s.redrawAll(); } },
                    { type: 'observe', target: 'sb', msg: '开关 SB 右端 → 限流电阻 RL 左端',
                      async act() { const s = this.sys; await _wireAnim(s, 'sb_wire_r', 'rl_wire_l'); s.redrawAll(); } },
                    { type: 'observe', target: 'rl', msg: '限流电阻 RL 右端 → 三极管基极',
                      async act() { const s = this.sys; await _wireAnim(s, 'rl_wire_r', 'q1_wire_b'); s.redrawAll(); } },
                ],
            },
            // ── 3. 调出万用表 → 拨 DCV200 → 测 Vce（截止）──
            {
                mode: 'check',
                msg: '3. 调出数字万用表，逐档转动档位开关至直流 200V 档，红表笔接集电极 C、黑表笔接发射极 E，测量 Vce（开关未合，管子截止）。',
                check() {
                    const mm = this.sys.comps['multimeter'];
                    // 本步结果为：万用表已调出并置于直流 200V 档（表笔在测量后已断开，
                    // 故不再要求表笔保持连接）。
                    return !!(mm && mm.group && mm.group.visible() && mm.mode === 'DCV200');
                },
                op: [
                    { type: 'instrument', instrument: 'multimeter', msg: '通过【选择仪表】面板调出数字万用表',
                      // 面板操作（指向按钮 → 打开 → 勾选 → 关闭）由演示引擎 _introInstrument 完成，
                      // act 仅占位延时，避免重复执行面板流程（否则会勾选两次）。
                      async act() { await _wait(600); } },
                    { type: 'observe', target: 'multimeter', part: 'knob', msg: '逐档转动档位开关至直流 200V 档',
                      async act() { await _turnToDCV200(this); } },
                    { type: 'observe', target: 'q1', msg: '红表笔接集电极 C、黑表笔接发射极 E，观察读数后断开',
                      async act() {
                          const s = this.sys;
                          await _wireAnim(s, 'multimeter_wire_v', 'q1_wire_c');
                          await _wireAnim(s, 'multimeter_wire_com', 'q1_wire_e');
                          await _wait(4000);
                          _disconnectMM(s);
                          s.redrawAll();
                      } },
                ],
            },
            // ── 4. 填空：截止时 Vce 与状态 ──
            {
                mode: 'fill',
                msg: '4. 填空题：开关 SB 断开时，三极管 Vce = (  ) V，此时处于（  ）状态。',
                fields: [
                    { label: '三极管 Vce', unit: 'V', answer: 24 },
                    { label: '工作状态', answer: '截止' },
                ],
            },
            // ── 5. 合上 SB → 饱和导通 → 电磁阀吸合 ──
            {
                mode: 'check',
                msg: '5. 合上基极开关 SB，三极管饱和导通，线圈电流约 48mA ＞ 30mA，电磁阀吸合。',
                check() {
                    const sv = this.sys.comps['sv'];
                    return !!(sv && sv.isOpen);
                },
                op: [
                    { type: 'switch', target: 'sb', msg: '点击开关 SB 使其闭合（合）',
                      async act() {
                          const sb = this.sys.comps['sb'];
                          if (sb && !sb.isOn) sb.toggle();
                          await _wait(3000);
                      } },
                ],
            },
            // ── 6. 再次测 Vce（饱和）──
            {
                mode: 'check',
                msg: '6. 再次用万用表直流 200V 档测量三极管 C、E 之间的电压（饱和导通，Vce ≈ 0.1V），观察读数后断开接线。',
                check() {
                    const s = this.sys;
                    const mm = s.comps['multimeter'];
                    const sv = s.comps['sv'];
                    // 本步结果为：开关 SB 已合（电磁阀吸合），且在直流 200V 档完成了再次测量。
                    return !!(mm && mm.mode === 'DCV200' && sv && sv.isOpen);
                },
                op: [
                    { type: 'observe', target: 'q1', msg: '红表笔接集电极 C、黑表笔接发射极 E，观察读数后断开',
                      async act() {
                          const s = this.sys;
                          await _wireAnim(s, 'multimeter_wire_v', 'q1_wire_c');
                          await _wireAnim(s, 'multimeter_wire_com', 'q1_wire_e');
                          await _wait(4000);
                          _disconnectMM(s);
                          s.redrawAll();
                      } },
                ],
            },
            // ── 7. 填空：饱和时 Vce 与状态 ──
            {
                mode: 'fill',
                msg: '7. 填空题：开关 SB 合上后，三极管 Vce = (  ) V，此时处于（  ）状态。',
                fields: [
                    { label: '三极管 Vce', unit: 'V', answer: 0.1 },
                    { label: '工作状态', answer: '饱和' },
                ],
            },
            // ── 8. 测试题：NPN 饱和条件 ──
            {
                mode: 'quiz',
                msg: '8. 测试题：三极管处于饱和状态的条件是？',
                quizConfig: {
                    question: 'NPN 三极管处于饱和导通状态的条件是？',
                    options: [
                        '发射结反偏、集电结反偏',
                        '发射结正偏、集电结反偏',
                        '发射结正偏、集电结正偏',
                        '发射结反偏、集电结正偏',
                    ],
                    answer: 2,
                    analysis: '三极管饱和时，发射结正偏（Vbe≈0.7V）、集电结也正偏，此时 Vce 很小（≈0.1~0.2V），管子相当于闭合开关。',
                },
            },
        ],
    },

    // ══════════════════════════════════════════════════════════════════
    // 流程 2：测试晶闸管和 IGBT（万用表简单检测，不新增元件）
    // ══════════════════════════════════════════════════════════════════
    'semi-scr-igbt': {
        id: 'semi-scr-igbt',
        name: '2. 测试晶闸管和 IGBT',
        steps: [
            // ── 1. 调出万用表 → 二极管档 ──
            {
                mode: 'check',
                msg: '1. 调出数字万用表，拨到二极管档。',
                check() {
                    const mm = this.sys.comps['multimeter'];
                    return !!(mm && mm.group && mm.group.visible() && mm.mode === 'DIODE');
                },
                op: [
                    { type: 'instrument', instrument: 'multimeter', msg: '通过【选择仪表】面板调出数字万用表',
                      // 面板操作由演示引擎 _introInstrument 完成，act 仅占位延时（避免重复勾选）。
                      async act() { await _wait(600); } },
                    { type: 'observe', target: 'multimeter', part: 'knob', msg: '转动档位开关至二极管档（▶|）',
                      async act() { await _turnMeterTo(this, 'DIODE'); } },
                ],
            },
            // ── 2. 测晶闸管 GK 正向压降 ──
            {
                mode: 'check',
                msg: '2. 红表笔接晶闸管门极 G、黑表笔接阴极 K，测量 GK 正向导通压降（应显示约 0.7V）。',
                check() {
                    const mm = this.sys.comps['multimeter'];
                    return !!(mm && mm.mode === 'DIODE'
                        && _sameCluster(this.sys, 'multimeter_wire_v', 'scr-real_wire_g')
                        && _sameCluster(this.sys, 'multimeter_wire_com', 'scr-real_wire_k'));
                },
                op: [
                    { type: 'observe', target: 'scr-real', msg: '红表笔（V）接门极 G、黑表笔（COM）接阴极 K',
                      async act() {
                          const s = this.sys;
                          _disconnectMM(s);
                          await _wireAnim(s, 'multimeter_wire_v', 'scr-real_wire_g');
                          await _wireAnim(s, 'multimeter_wire_com', 'scr-real_wire_k');
                          await _wait(3000);
                          s.redrawAll();
                      } },
                ],
            },
            // ── 3. 反接测 GK（应 OL）──
            {
                mode: 'check',
                msg: '3. 反向测量晶闸管 GK：红表笔接 K、黑表笔接 G，应显示 OL（溢出，反向截止）。',
                check() {
                    const mm = this.sys.comps['multimeter'];
                    return !!(mm && mm.mode === 'DIODE'
                        && _sameCluster(this.sys, 'multimeter_wire_v', 'scr-real_wire_k')
                        && _sameCluster(this.sys, 'multimeter_wire_com', 'scr-real_wire_g'));
                },
                op: [
                    { type: 'observe', target: 'scr-real', msg: '反接：红表笔接 K、黑表笔接 G',
                      async act() {
                          const s = this.sys;
                          _disconnectMM(s);
                          await _wireAnim(s, 'multimeter_wire_v', 'scr-real_wire_k');
                          await _wireAnim(s, 'multimeter_wire_com', 'scr-real_wire_g');
                          await _wait(3000);
                          s.redrawAll();
                      } },
                ],
            },
            // ── 4. 测 IGBT 体二极管（E→C）──
            {
                mode: 'check',
                msg: '4. 测量 IGBT 体二极管：红表笔接发射极 E、黑表笔接集电极 C，应显示约 0.6V（体二极管正向导通）。',
                check() {
                    const mm = this.sys.comps['multimeter'];
                    return !!(mm && mm.mode === 'DIODE'
                        && _sameCluster(this.sys, 'multimeter_wire_v', 'igbt-real_wire_e')
                        && _sameCluster(this.sys, 'multimeter_wire_com', 'igbt-real_wire_c'));
                },
                op: [
                    { type: 'observe', target: 'igbt-real', msg: '红表笔（V）接 E、黑表笔（COM）接 C',
                      async act() {
                          const s = this.sys;
                          _disconnectMM(s);
                          await _wireAnim(s, 'multimeter_wire_v', 'igbt-real_wire_e');
                          await _wireAnim(s, 'multimeter_wire_com', 'igbt-real_wire_c');
                          await _wait(3000);
                          s.redrawAll();
                      } },
                ],
            },
            // ── 5. 反接测 IGBT 体二极管（应 OL）──
            {
                mode: 'check',
                msg: '5. 反向测量 IGBT 体二极管：红表笔接 C、黑表笔接 E，应显示 OL（体二极管反向截止）。',
                check() {
                    const mm = this.sys.comps['multimeter'];
                    return !!(mm && mm.mode === 'DIODE'
                        && _sameCluster(this.sys, 'multimeter_wire_v', 'igbt-real_wire_c')
                        && _sameCluster(this.sys, 'multimeter_wire_com', 'igbt-real_wire_e'));
                },
                op: [
                    { type: 'observe', target: 'igbt-real', msg: '反接：红表笔接 C、黑表笔接 E',
                      async act() {
                          const s = this.sys;
                          _disconnectMM(s);
                          await _wireAnim(s, 'multimeter_wire_v', 'igbt-real_wire_c');
                          await _wireAnim(s, 'multimeter_wire_com', 'igbt-real_wire_e');
                          await _wait(3000);
                          s.redrawAll();
                      } },
                ],
            },
            // ── 6. 测试题：晶闸管自锁 ──
            {
                mode: 'quiz',
                msg: '6. 测试题：晶闸管的导通特性。',
                quizConfig: {
                    question: '晶闸管（SCR）被触发导通后，门极信号消失，以下描述正确的是？',
                    options: [
                        'SCR 立即关断',
                        'SCR 保持导通（自锁）',
                        'SCR 变为高阻态',
                        'SCR 反向导通',
                    ],
                    answer: 1,
                    analysis: '晶闸管一旦被触发导通，即使门极信号消失仍能维持导通（自锁特性）；只有当阳极电流降至维持电流以下时才会关断。',
                },
            },
            // ── 7. 测试题：IGBT 检测 ──
            {
                mode: 'quiz',
                msg: '7. 测试题：IGBT 的检测要点。',
                quizConfig: {
                    question: '关于 IGBT 的检测，以下说法正确的是？',
                    options: [
                        'IGBT 的门极 G-E 之间可以测得 PN 结正向压降',
                        'IGBT 的 C-E 之间有体二极管，正向可测到约 0.6V 压降',
                        'IGBT 与 MOSFET 检测方法完全不同',
                        'IGBT 的门极加上电压后 C-E 会自锁导通',
                    ],
                    answer: 1,
                    analysis: 'IGBT 的 C-E 间集成有体二极管（类似 MOSFET），正向可测到约 0.6V 压降；门极为高阻输入（MOS 结构），正反向测量均显示高阻；IGBT 是电压控制器件，无自锁特性，门极电压撤除后关断。',
                },
            },
        ],
    },

    // ══════════════════════════════════════════════════════════════════
    // 流程 3：测试 PLC 输入输出电路
    // ══════════════════════════════════════════════════════════════════
    'plc-io': {
        id: 'plc-io',
        name: '3. 测试 PLC 输入输出电路',
        steps: [
            // ── 1. 识别模块 ──
            { mode: 'find', target: 'plc-1',
              msg: '1. 识别 PLC 的 CPU 模块（西门子 S7-200 SMART CPU ST20，12DI/8DO 晶体管输出）。' },
            { mode: 'find', target: 'ai04-1',
              msg: '2. 识别模拟量输入模块 EM AI04（4 路模拟量输入，0 号通道默认 4~20mA）。' },
            { mode: 'find', target: 'aq04-1',
              msg: '3. 识别模拟量输出模块 EM AQ04（4 路模拟量输出，0 号通道默认 4~20mA）。' },

            // ── 4. 动画接线（逐根接线 + 挂接扩展模块）──
            {
                mode: 'check',
                msg: '4. 使用动画接线逐根完成 PLC 接线：CPU 供电/公共端、按钮→I0.0/I0.1、AQ04→三通调节阀、阀位变送器→AI04，并挂接扩展模块。',
                check() {
                    const s = this.sys;
                    return _hasConn(s, 'dc24_wire_p', 'plc-1_wire_24v')
                        && _hasConn(s, 'plc-1_wire_1m', 'plc-1_wire_v0')
                        && _hasConn(s, 'pterm-24_wire_p', 'btn-inc_wire_no1')
                        && _hasConn(s, 'btn-inc_wire_no2', 'plc-1_wire_di00')
                        && _hasConn(s, 'btn-dec_wire_no2', 'plc-1_wire_di01')
                        && _hasConn(s, 'aq04-1_wire_aq0v', 'valve_wire_l')
                        && _hasConn(s, 'valve_wire_r', 'aq04-1_wire_aq0m')
                        && _hasConn(s, 'vtx_wire_n', 'ai04-1_wire_ai0p')
                        && ['ai04-1', 'aq04-1'].every(id => s.comps[id] && s.comps[id]._mounted);
                },
                op: [
                    // 挂接扩展模块（AI04 → AQ04）
                    { type: 'observe', target: 'ai04-1', msg: '扩展模块 AI04 插入 CPU 右侧扩展总线',
                      async act() { _mountModules(this.sys); await _wait(700); } },
                    // CPU 供电与公共端
                    { type: 'observe', target: 'plc-1', part: 'term-24v', msg: '接线①：外部 24V 电源正极 → CPU 的 24V 端子',
                      async act() { const s = this.sys; await _wireAnim(s, 'dc24_wire_p', 'plc-1_wire_24v'); s.redrawAll(); } },
                    { type: 'observe', target: 'plc-1', part: 'term-v0', msg: '接线②：外部 24V 电源负极 → CPU 的 0V 端子',
                      async act() { const s = this.sys; await _wireAnim(s, 'dc24_wire_n', 'plc-1_wire_v0'); s.redrawAll(); } },
                    { type: 'observe', target: 'plc-1', part: 'term-1m', msg: '接线③：输入公共端 1M → 0V',
                      async act() { const s = this.sys; await _wireAnim(s, 'plc-1_wire_1m', 'plc-1_wire_v0'); s.redrawAll(); } },
                    { type: 'observe', target: 'plc-1', part: 'term-1l', msg: '接线④：输出负载电源 1L+ → 24V',
                      async act() { const s = this.sys; await _wireAnim(s, 'plc-1_wire_1l', 'plc-1_wire_24v'); s.redrawAll(); } },
                    // 数字量输入按钮 → I0.0 / I0.1
                    { type: 'observe', target: 'btn-inc', part: 'btn', msg: '接线⑤：+24V → 增按钮 I0.0 左端',
                      async act() { const s = this.sys; await _wireAnim(s, 'pterm-24_wire_p', 'btn-inc_wire_no1'); s.redrawAll(); } },
                    { type: 'observe', target: 'btn-inc', part: 'btn', msg: '接线⑥：增按钮 I0.0 右端 → DI 端子 di00',
                      async act() { const s = this.sys; await _wireAnim(s, 'btn-inc_wire_no2', 'plc-1_wire_di00'); s.redrawAll(); } },
                    { type: 'observe', target: 'btn-dec', part: 'btn', msg: '接线⑦：+24V → 减按钮 I0.1 左端',
                      async act() { const s = this.sys; await _wireAnim(s, 'pterm-24_wire_p', 'btn-dec_wire_no1'); s.redrawAll(); } },
                    { type: 'observe', target: 'btn-dec', part: 'btn', msg: '接线⑧：减按钮 I0.1 右端 → DI 端子 di01',
                      async act() { const s = this.sys; await _wireAnim(s, 'btn-dec_wire_no2', 'plc-1_wire_di01'); s.redrawAll(); } },
                    // AQ04 ch0 → 三通调节阀
                    { type: 'observe', target: 'aq04-1', msg: '接线⑨：AQ04 ch0V → 三通调节阀 l 端',
                      async act() { const s = this.sys; await _wireAnim(s, 'aq04-1_wire_aq0v', 'valve_wire_l'); s.redrawAll(); } },
                    { type: 'observe', target: 'valve', msg: '接线⑩：三通调节阀 r 端 → AQ04 ch0M',
                      async act() { const s = this.sys; await _wireAnim(s, 'valve_wire_r', 'aq04-1_wire_aq0m'); s.redrawAll(); } },
                    // 阀位变送器 → AI04 ch0
                    { type: 'observe', target: 'vtx', part: 'term-p', msg: '接线⑪：24V → 阀位变送器 P 端',
                      async act() { const s = this.sys; await _wireAnim(s, 'plc-1_wire_24v', 'vtx_wire_p'); s.redrawAll(); } },
                    { type: 'observe', target: 'vtx', part: 'term-n', msg: '接线⑫：阀位变送器 N 端 → AI04 ch0+',
                      async act() { const s = this.sys; await _wireAnim(s, 'vtx_wire_n', 'ai04-1_wire_ai0p'); s.redrawAll(); } },
                    { type: 'observe', target: 'ai04-1', msg: '接线⑬：AI04 ch0− → 0V（回路返回）',
                      async act() { const s = this.sys; await _wireAnim(s, 'ai04-1_wire_ai0n', 'plc-1_wire_v0'); s.redrawAll(); } },
                    // 上位机网络
                    { type: 'observe', target: 'step7pc-1', msg: '接线⑭：STEP7 上位机网口 → PLC 以太网口',
                      async act() { const s = this.sys; await _wireAnim(s, 'step7pc-1_wire_lan', 'plc-1_wire_lan'); s.redrawAll(); } },
                ],
            },

            // ── 5. PLC 转 RUN ──
            {
                mode: 'check',
                msg: '5. 将 PLC 转入运行状态（RUN）。',
                check() {
                    const p = this.sys.comps['plc-1'];
                    return !!(p && p.mode === 'RUN');
                },
                op: [
                    { type: 'switch', target: 'plc-1', part: 'mode-sw',
                      msg: '将 PLC 的 RUN/STOP 开关拨到 RUN（转入运行状态）',
                      async act() { const p = this.sys.comps['plc-1']; if (p.mode !== 'RUN') p.toggleMode(); await _wait(600); } },
                ],
            },

            // ── 6. 按 I0.0 增按钮 10 次 → 开度增大到 10% ──
            {
                mode: 'check',
                msg: '6. 连续按增开度按钮（I0.0）10 次，每次 1%，开度增大到 10%；观察 AQ04 输出电流增大、AI04 采集的阀位同步上升。',
                check() {
                    const v = this.sys.comps['valve'];
                    return !!(v && v.getOpeningPercent() >= 10);
                },
                op: [
                    { type: 'btn', target: 'btn-inc', part: 'btn',
                      msg: '连续按按钮 I0.0 共 10 次（每次上升沿 +1%），开度增大到 10%',
                      async act() {
                          const b = this.sys.comps['btn-inc'];
                          for (let i = 0; i < 10; i++) {
                              b.setManualOverride(true);
                              await _wait(220);          // 按下（产生上升沿，+1%）
                              b.setManualOverride(false);
                              await _wait(220);          // 松开
                          }
                          await _wait(1500);
                      } },
                ],
            },

            // ── 7. 按 I0.1 减按钮 5 次 → 开度减小到 5% ──
            {
                mode: 'check',
                msg: '7. 连续按减开度按钮（I0.1）5 次，每次 1%，开度减小到 5%。',
                check() {
                    const v = this.sys.comps['valve'];
                    return !!(v && v.getOpeningPercent() <= 5 && v.getOpeningPercent() > 0);
                },
                op: [
                    { type: 'btn', target: 'btn-dec', part: 'btn',
                      msg: '连续按按钮 I0.1 共 5 次（每次上升沿 −1%），开度减小到 5%',
                      async act() {
                          const b = this.sys.comps['btn-dec'];
                          for (let i = 0; i < 5; i++) {
                              b.setManualOverride(true);
                              await _wait(220);          // 按下（产生上升沿，−1%）
                              b.setManualOverride(false);
                              await _wait(220);          // 松开
                          }
                          await _wait(1500);
                      } },
                ],
            },

            // ── 8. 填空：地址与换算 ──
            {
                mode: 'fill',
                msg: '8. 填空题：AQ04 通道 0 的地址为（  ）；AI04 通道 0 的地址为（  ）；开度 0~100% 对应 AQW0 的输出字为 开度 ×（  ）。',
                fields: [
                    { label: 'AQ04 通道 0 地址', answer: ['AQW0'], unit: '' },
                    { label: 'AI04 通道 0 地址', answer: ['AIW0'], unit: '' },
                    { label: '开度→AQW0 系数', answer: ['276'], unit: '' },
                ],
            },

            // ── 9. 测试题：PLC 输入输出电路 ──
            {
                mode: 'quiz',
                msg: '9. 测试题：PLC 输入输出电路。',
                quizConfig: {
                    question: '关于本 PLC 的输入/输出电路，以下说法正确的是？',
                    options: [
                        '数字量输入公共端 1M 应接 +24V',
                        '数字量输入按钮一端接 +24V、另一端接 DI 端子，1M 接 0V（源型接法）',
                        'AQ04 的 4~20mA 输出无需外部电源即可产生电流',
                        'ST20 的数字量输出为继电器干接点',
                    ],
                    answer: 1,
                    analysis: '本电路 DI 采用源型接法：按钮一端接 +24V、另一端接 DI 端子，公共端 1M 接 0V，按下时 DI 被拉高为 1；AQ04 电流档由模块内部电路在 chV/chM 间输出 4~20mA；ST20 输出为晶体管（MOSFET 源型），非继电器。',
                },
            },
        ],
    },
};

// ── ST20 用户程序：I0.0/I0.1 上升沿与长按控制阀位（VW0），AQW0 输出 4~20mA ──
const PLC_PROGRAM = [
    '// ══ 阀位控制（单位：%，存于 VW0）══',
    '// I0.0 增开度：上升沿 +1%；按>2s 后每 0.2s 再 +1%（长按连加）',
    '// I0.1 减开度：上升沿 -1%；按>2s 后每 0.2s 再 -1%（长按连减）',
    '// 限幅 0~100%；AQW0 = VW0 × 276（4~20mA 对应 0~100%）',
    '',
    '// 说明：本解释器 EU 为全局共享状态，故全部改用 M 位"上一扫描状态"做边沿检测，',
    '//       每路信号各用一位记忆（M2.0~M2.3），互不干扰。',
    '',
    '// ── 1) SM0.1 首次扫描：开度初值 0 ──',
    'LD     SM0.1',
    'MOV_W  0, VW0',
    '',
    '// ── 2) I0.0 上升沿检测（M2.0 记忆上一扫描状态）──',
    'LD     I0.0',
    'AN     M2.0',
    '=      M0.1          // M0.1 = I0.0 上升沿脉冲（1 个扫描周期）',
    'LD     I0.0',
    '=      M2.0          // 记忆本扫描 I0.0 状态',
    '',
    '// ── 3) I0.1 上升沿检测（M2.1 记忆）──',
    'LD     I0.1',
    'AN     M2.1',
    '=      M0.3          // M0.3 = I0.1 上升沿脉冲',
    'LD     I0.1',
    '=      M2.1',
    '',
    '// ── 4) I0.0 长按 >2s 后每 0.2s 连加（T32=2s 定时，1ms 时基）──',
    'LD     I0.0',
    'TON    T32, 2000     // 按住 2s 后 T32 动作',
    '// 自复位 0.2s 脉冲发生器：T33 到时 → 复位 T33（下一扫描重新计时）',
    'LD     I0.0',
    'A      T32',
    'TON    T33, 200',
    'LD     T33',
    '=      M0.4          // M0.4 = I0.0 连加脉冲（每个计时周期 1 次）',
    'LD     T33',
    'R      T33, 1        // 复位 T33，形成 0.2s 循环',
    '',
    '// ── 5) I0.1 长按 >2s 后每 0.2s 连减（T34/T35）──',
    'LD     I0.1',
    'TON    T34, 2000',
    'LD     I0.1',
    'A      T34',
    'TON    T35, 200',
    'LD     T35',
    '=      M0.5          // M0.5 = I0.1 连减脉冲',
    'LD     T35',
    'R      T35, 1        // 复位 T35，形成 0.2s 循环',
    '',
    '// ── 6) 增量合并（上升沿脉冲 + 长按脉冲）→ M0.6 ──',
    'LD     M0.1',
    'O      M0.4',
    '=      M0.6',
    '',
    '// ── 7) 减量合并（上升沿脉冲 + 长按脉冲）→ M0.7 ──',
    'LD     M0.3',
    'O      M0.5',
    '=      M0.7',
    '',
    '// ── 8) 增/减互斥（同时按下以增优先）──',
    'LD     M0.6',
    'AN     M0.7',
    '=      M1.0          // 有效增量',
    'LD     M0.7',
    'AN     M0.6',
    '=      M1.1          // 有效减量',
    '',
    '// ── 9) 限幅加：若 VW0 < 100 则 +1 ──',
    'LD     M1.0',
    '<I     VW0, 100',
    '+I     1, VW0',
    '',
    '// ── 10) 限幅减：若 VW0 > 0 则 -1 ──',
    'LD     M1.1',
    '>I     VW0, 0',
    '+I     -1, VW0',
    '',
    '// ── 11) 输出：AQW0 = VW0 × 276（0~100% → 0~27648 → 4~20mA）──',
    'LD     SM0.0',
    'MOV_W  VW0, MW10',
    '*I     276, MW10',
    'MOV_W  MW10, AQW0',
    'END',
].join('\n');

export const componentConfigs = [
    // ══════════════ PLC 本体与扩展模块（左上区域）══════════════
    // CPU：西门子 S7-200 SMART CPU ST20（12DI/8DO/2AI/1AO，晶体管源型输出）
    { Class: S7_200_SMART_ST20, id: 'plc-1', x: 820, y: 200, scale: 1.0, label: 'ST20',
      mode: 'STOP',
      hostname: 'PLC-ST20', ip: '192.168.0.1', mask: '255.255.255.0',
      program: PLC_PROGRAM },

    // 扩展模块（串联 AI04 → AQ04，由「自动接线」自动挂接并对齐）
    { Class: S7_200_EM_AI04, id: 'ai04-1', x: 1280, y: 200, width: 115, height: 470, label: 'EM AI04', ch0mode: 'I4-20' },
    { Class: S7_200_EM_AQ04, id: 'aq04-1', x: 1425, y: 200, width: 115, height: 470, label: 'EM AQ04', ch0mode: 'I4-20' },

    // ══════════════ 控制回路电源与公共端（画布左缘）══════════════
    { Class: DCPower, id: 'dc24', x: 460, y: 460, voltage: 24, isOn: true },
    { Class: PotentialTerminal, id: 'pterm-24', x: 460, y: 200, potential: 24, scale: 1.2 },

    // ══════════════ 数字量输入按钮（I0.0 增 / I0.1 减，PLC 下方）══════════════
    { Class: DiagramStartButton, id: 'btn-inc', x: 620, y: 320, label: 'I0.0 增', color: '#20a030' },
    { Class: DiagramStartButton, id: 'btn-dec', x: 620, y: 220, label: 'I0.1 减', color: '#e03030' },

    // ══════════════ 电动三通调节阀（AQ04 右侧，独立显示区）══════════════
    { Class: ElecValve, id: 'valve', x: 1200, y: 820, label: 'FV 三通调节阀' },

    // ══════════════ 阀位变送器（→ AI04 ch0，仅测量）══════════════
    { Class: ValvePositionTransmitter, id: 'vtx', x: 920, y: 760,
      label: '阀位变送器', sourceValve: 'valve', minPct: 0, maxPct: 100 },

    // ══════════════ 上位机（装有 STEP7 编程软件，画布顶部）══════════════
    { Class: STEP7PC, id: 'step7pc-1', x: 900, y: 120,
      hostname: 'STEP7-PC', ip: '192.168.0.2', mask: '255.255.255.0' },

    // ══════════════════════════════════════════════════════════════
    //  电磁阀驱动电路（独立手动演示，画布下方、远离 PLC 控制区）
    //  ── 24V 主回路：pt1 → 电磁阀线圈 → 三极管 C-E → 地
    //  ── 续流回路：线圈两端反并联 二极管(阳极接 b) + 电阻
    //  ── 3V 控制支路：pt2 → 开关 SB → 限流电阻 RL → 基极
    // ══════════════════════════════════════════════════════════════
    { Class: PotentialTerminal, id: 'pt1', x: 300, y: 120, potential: 24, scale: 1.2 },
    { Class: SolenoidValve, id: 'sv', x: 350, y: 300, scale: 1 },
    { Class: Transistor, id: 'q1', x: 280, y: 500 },
    { Class: Ground, id: 'gnd-sv', x: 300, y: 700 },
    // 续流回路：二极管 + 电阻（反并联在线圈两端）
    { Class: Diode, id: 'dfw', x: 220, y: 320, rotation: -90, vForward: 0.7 },
    { Class: Resistor, id: 'rfw', x: 220, y: 200, value: 100,rotation:-90 },
    // 基极支路：3V → 开关 SB → 限流电阻 RL → 基极
    { Class: PotentialTerminal, id: 'pt2', x: -30, y: 400, potential: 3, scale: 1.2 },
    { Class: Switch, id: 'sb', x: 10, y: 500, label: '基极开关 SB' },
    { Class: Resistor, id: 'rl', x: 150, y: 500, value: 1000 },

    // ══════════════ 实物陈列（仅识别，不接线，右下角）══════════════
    { Class: RealScr, id: 'scr-real', x: 1300, y: 100 },
    { Class: RealIGBT, id: 'igbt-real', x: 1460, y: 100 },

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
        // ══════════ PLC 供电与公共端 ══════════
        { from: 'dc24_wire_p', to: 'plc-1_wire_24v', type: 'wire' },
        { from: 'dc24_wire_n', to: 'plc-1_wire_v0', type: 'wire' },
        { from: 'plc-1_wire_1m', to: 'plc-1_wire_v0', type: 'wire' },   // DI 公共端 1M → 0V
        { from: 'plc-1_wire_1l', to: 'plc-1_wire_24v', type: 'wire' },  // 输出负载电源 1L+ → 24V

        // ══════════ 数字量输入：+24V → 按钮 → I0.0 / I0.1 ══════════
        { from: 'pterm-24_wire_p', to: 'btn-inc_wire_no1', type: 'wire' },
        { from: 'btn-inc_wire_no2', to: 'plc-1_wire_di00', type: 'wire' },
        { from: 'pterm-24_wire_p', to: 'btn-dec_wire_no1', type: 'wire' },
        { from: 'btn-dec_wire_no2', to: 'plc-1_wire_di01', type: 'wire' },

        // ══════════ 模拟量输出：AQ04 ch0(4~20mA) → 电动三通调节阀 ══════════
        { from: 'aq04-1_wire_aq0v', to: 'valve_wire_l', type: 'wire' },
        { from: 'valve_wire_r', to: 'aq04-1_wire_aq0m', type: 'wire' },

        // ══════════ 模拟量输入：24V → 阀位变送器 → AI04 ch0 → 0V ══════════
        { from: 'plc-1_wire_24v', to: 'vtx_wire_p', type: 'wire' },
        { from: 'vtx_wire_n', to: 'ai04-1_wire_ai0p', type: 'wire' },
        { from: 'ai04-1_wire_ai0n', to: 'plc-1_wire_v0', type: 'wire' },

        // ══════════ 上位机网络 ══════════
        { from: 'step7pc-1_wire_lan', to: 'plc-1_wire_lan', type: 'wire' },

        // ══════════ 电磁阀驱动电路（手动，独立于 PLC）══════════
        // 主回路：24V → 线圈 a；线圈 b → 集电极；发射极 → 地
        { from: 'pt1_wire_p', to: 'sv_wire_a', type: 'wire' },
        { from: 'sv_wire_b', to: 'q1_wire_c', type: 'wire' },
        { from: 'q1_wire_e', to: 'gnd-sv_wire_gnd', type: 'wire' },
        // 基极支路：3V → 开关 SB → 限流电阻 RL → 基极
        { from: 'pt2_wire_p', to: 'sb_wire_l', type: 'wire' },
        { from: 'sb_wire_r', to: 'rl_wire_l', type: 'wire' },
        { from: 'rl_wire_r', to: 'q1_wire_b', type: 'wire' },
        // 续流回路：二极管（阳极接 b）+ 电阻，反并联在线圈两端
        { from: 'sv_wire_b', to: 'dfw_wire_l', type: 'wire' },
        { from: 'dfw_wire_r', to: 'rfw_wire_l', type: 'wire' },
        { from: 'rfw_wire_r', to: 'sv_wire_a', type: 'wire' },
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
    // 串联父子关系：plc-1 → ai04-1 → aq04-1（扩展链按单子节点顺次排列）
    const rels = [['ai04-1', 'plc-1'], ['aq04-1', 'ai04-1']];
    rels.forEach(([modId, parentId]) => {
        const mod = sys.comps[modId];
        if (mod && mod._parentExp !== parentId) mod._parentExp = parentId;
    });
    if (typeof sys._recomputeAllChains === 'function') sys._recomputeAllChains();
    if (typeof sys._layoutAttachedModules === 'function') sys._layoutAttachedModules();
}

// ══════════════════════════════════════════════════════════════════════
//  工作流辅助函数
// ══════════════════════════════════════════════════════════════════════

/** 判断两端口之间是否已连线 */
function _hasConn(sys, a, b) {
    return sys.conns.some(c => (c.from === a && c.to === b) || (c.from === b && c.to === a));
}

function _wait(ms) { return new Promise(r => setTimeout(r, ms)); }

/** 动画接线（约 3s/根）；已连接的跳过，保证演示可重复运行 */
async function _wireAnim(sys, from, to) {
    if (_hasConn(sys, from, to)) return;
    await sys.connMgr.addConnectionAnimated({ from, to, type: 'wire' });
}

/** 判断两个端口是否处于同一电气簇（导线直连） */
function _sameCluster(sys, portA, portB) {
    const map = sys.voltageSolver && sys.voltageSolver.portToCluster;
    if (!map) return false;
    const cA = map.get(portA);
    const cB = map.get(portB);
    return cA !== undefined && cA === cB;
}

/** 断开万用表所有表笔接线 */
function _disconnectMM(sys) {
    const ports = ['multimeter_wire_v', 'multimeter_wire_ma', 'multimeter_wire_com'];
    const existing = sys.conns.filter(c => ports.includes(c.from) || ports.includes(c.to));
    existing.forEach(c => sys.connMgr.removeConn(c));
    sys.redrawAll();
}

/**
 * 数字万用表某档位刻度的画布坐标（箭头定位用）
 */
function _dcvTickPos(wf, angle) {
    const mm = wf.sys.comps['multimeter'];
    if (!mm || typeof mm.getClickablePartCenter !== 'function') return null;
    const c = mm.getClickablePartCenter('knob');
    if (!c) return null;
    const scale = mm.scale || 1;
    const radius = Math.min(110 * scale, Math.max(40 * scale, Math.floor(mm.width / 3)));
    const rad = (angle - 90) * Math.PI / 180;
    return { x: c.x + radius * Math.cos(rad), y: c.y + radius * Math.sin(rad), mm };
}

/**
 * 逐档转动万用表旋钮到指定档位：先指向档位刻度，再分步旋转到目标角度。
 * @param {object} wf 工作流实例
 * @param {string} targetMode 目标档位 mode（如 'DCV200' / 'DIODE'）
 */
async function _turnMeterTo(wf, targetMode) {
    const mm = wf.sys.comps['multimeter'];
    if (!mm) return;
    // 角度映射（与 Multimeter._updateModeByAngle 一致）
    const modeAngle = {
        OFF: 0, DCVmv: -30, DCV20: -60, DCV200: -90, ACV200: -120, ACV500: -150,
        DIODE: 30, RES200: 60, RES2k: 90, RES200k: 120, MA: 150, C: 180,
    };
    const targetAngle = modeAngle[targetMode] !== undefined ? modeAngle[targetMode] : 0;
    const tick = _dcvTickPos(wf, targetAngle);
    if (tick && wf._flashArrow) {
        await wf._flashArrow(tick, { on: 500, off: 350, times: 3 });
    }
    // 从当前角度分步（每步 30°、间隔 0.4s）转到目标角度
    const start = mm.pointer ? mm.pointer.rotation() : 0;
    const steps = [];
    if (targetAngle >= start) {
        for (let a = start; a < targetAngle; a += 30) steps.push(a + 30);
        if (steps.length === 0 || steps[steps.length - 1] !== targetAngle) steps.push(targetAngle);
    } else {
        for (let a = start; a > targetAngle; a -= 30) steps.push(a - 30);
        if (steps.length === 0 || steps[steps.length - 1] !== targetAngle) steps.push(targetAngle);
    }
    for (const a of steps) {
        mm.pointer.rotation(a);
        if (typeof mm._updateModeByAngle === 'function') mm._updateModeByAngle(a);
        mm.markDirty && mm.markDirty();
        mm._refreshIfDirty && mm._refreshIfDirty();
        if (wf.sys && typeof wf.sys.requestRedraw === 'function') wf.sys.requestRedraw();
        await _wait(400);
    }
    // 兜底：确保档位标识正确
    mm.mode = targetMode;
    if (typeof mm._measureNow === 'function') mm._measureNow();
    wf.sys.redrawAll();
}

/** 逐档转动万用表旋钮至直流 200V 档 */
async function _turnToDCV200(wf) {
    return _turnMeterTo(wf, 'DCV200');
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
}

export function fiveStep() { }
