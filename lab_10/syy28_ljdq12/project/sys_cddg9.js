
import { Multimeter } from '../components/Multimeter.js';
import { MF47Multimeter } from '../components/MF47Multimeter.js';
import { Oscilloscope_tri } from '../components/Osc_tri.js';
import { SignalGenerator } from '../components/SignalGenerator.js';
import { ProcessCalibrator } from '../components/ProcessCalibrator.js';
import { ElecMeter } from '../components/ElecMeter.js';
import { RealMegohmMeter } from '../components/RealMegohmMeter.js';

// ── 本实验元件 ──────────────────────────────────────────────
import { SinamicsV20 } from '../components/SinamicsV20.js';      // 西门子 V20 变频器
import { ThreePhaseMotor3D } from '../components/ThreePhaseMotor3D.js'; // 三相异步电动机
import { ACPower3P } from '../components/ACPower3P.js';         // 三相电源（380V）
import { Switch } from '../components/Switch.js';               // 远程启停/换向开关
import { PotentialTerminal } from '../components/PotentialTerminal.js'; // 外部 24V 控制电源电位端子
import { Potentiometer } from '../components/Potentiometer.js'; // 转速给定电位器（三端分压）

export const FAULT_CONFIGS = {};

/**
 * 典型变频调速控制实验
 *   1. 面板控制（HAND）：V20 的 I/O 键启停，▲▼ 调 MOP 频率
 *   2. 远程控制（AUTO）：SA1 启停、SA2 换向、电位器调速（AI1 0~10V）
 *   在变频器右键菜单（或参数菜单 P0700/P1000）中切换 HAND/AUTO。
 */
export const PROJECT_WORKFLOWS = {

    'v20-wiring': {
        id: 'v20-wiring',
        name: '1. 变频器端子识别与接线（面板启停 + MOP 调速）',
        steps: [
            // ── 1. 电源输入端子 L1/L2/L3 ────────────────────────────
            {
                msg: '1. 识别变频器的电源输入端子 L1/L2/L3，完成与电源的连线。',
                mode: 'check',
                check() {
                    const s = this.sys;
                    return _hasConn(s, 'ac-3p_wire_u', 'v20-1_wire_l1')
                        && _hasConn(s, 'ac-3p_wire_v', 'v20-1_wire_l2')
                        && _hasConn(s, 'ac-3p_wire_w', 'v20-1_wire_l3');
                },
                op: [
                    {
                        type: 'observe', target: 'v20-1', part: 'term-l1', circleR: 15,
                        msg: '识别电源输入端子 L1，接到三相电源 U 相',
                        async act() {
                            const s = this.sys;
                            await _wireAnim(s, 'ac-3p_wire_u', 'v20-1_wire_l1');
                            s.redrawAll();
                        },
                    },
                    {
                        type: 'observe', target: 'v20-1', part: 'term-l2', circleR: 15,
                        msg: '识别电源输入端子 L2，接到三相电源 V 相',
                        async act() {
                            const s = this.sys;
                            await _wireAnim(s, 'ac-3p_wire_v', 'v20-1_wire_l2');
                            s.redrawAll();
                        },
                    },
                    {
                        type: 'observe', target: 'v20-1', part: 'term-l3', circleR: 15,
                        msg: '识别电源输入端子 L3，接到三相电源 W 相',
                        async act() {
                            const s = this.sys;
                            await _wireAnim(s, 'ac-3p_wire_w', 'v20-1_wire_l3');
                            s.redrawAll();
                        },
                    },
                ],
            },
            // ── 2. 电源输出端子 U/V/W 与 PE ─────────────────────────
            {
                msg: '2. 识别变频器的电源输出端子 U/V/W 和 PE 端，完成与电机的接线。',
                mode: 'check',
                check() {
                    const s = this.sys;
                    return _hasConn(s, 'v20-1_wire_u', 'm-3d_wire_u')
                        && _hasConn(s, 'v20-1_wire_v', 'm-3d_wire_v')
                        && _hasConn(s, 'v20-1_wire_w', 'm-3d_wire_w')
                        && _hasConn(s, 'v20-1_wire_pe', 'm-3d_wire_pe');
                },
                op: [
                    {
                        type: 'observe', target: 'v20-1', part: 'term-u', circleR: 15,
                        msg: '识别电源输出端子 U，接到电动机 U 相',
                        async act() {
                            const s = this.sys;
                            await _wireAnim(s, 'v20-1_wire_u', 'm-3d_wire_u');
                            s.redrawAll();
                        },
                    },
                    {
                        type: 'observe', target: 'v20-1', part: 'term-v', circleR: 15,
                        msg: '识别电源输出端子 V，接到电动机 V 相',
                        async act() {
                            const s = this.sys;
                            await _wireAnim(s, 'v20-1_wire_v', 'm-3d_wire_v');
                            s.redrawAll();
                        },
                    },
                    {
                        type: 'observe', target: 'v20-1', part: 'term-w', circleR: 15,
                        msg: '识别电源输出端子 W，接到电动机 W 相',
                        async act() {
                            const s = this.sys;
                            await _wireAnim(s, 'v20-1_wire_w', 'm-3d_wire_w');
                            s.redrawAll();
                        },
                    },
                    {
                        type: 'observe', target: 'm-3d', part: 'pe-terminal', circleR: 18,
                        msg: '识别 PE 保护接地端子，将变频器 PE 与电动机 PE 相连',
                        async act() {
                            const s = this.sys;
                            await _wireAnim(s, 'v20-1_wire_pe', 'm-3d_wire_pe');
                            s.redrawAll();
                        },
                    },
                ],
            },
            // ── 3. 数字量输入 DI1 / DI2 ─────────────────────────────
            {
                msg: '3. 识别数字量输入端 DI1 和 DI2，完成数字量输入接线（24V 经启停开关到 DI1、DIC 到 0V；24V 经正反转开关到 DI2）。',
                mode: 'check',
                check() {
                    const s = this.sys;
                    return _hasConn(s, 'v20-1_wire_dicom', 'v20-1_wire_v0')
                        && _hasConn(s, 'pterm-24_wire_p', 'sa-run_wire_l')
                        && _hasConn(s, 'sa-run_wire_r', 'v20-1_wire_di1')
                        && _hasConn(s, 'pterm-24_wire_p', 'sa-dir_wire_l')
                        && _hasConn(s, 'sa-dir_wire_r', 'v20-1_wire_di2');
                },
                op: [
                    {
                        type: 'observe', target: 'v20-1', part: 'term-dic', circleR: 15,
                        msg: '识别数字量输入公共端 DIC，接到 0V',
                        async act() {
                            const s = this.sys;
                            await _wireAnim(s, 'v20-1_wire_dicom', 'v20-1_wire_v0');
                            s.redrawAll();
                        },
                    },
                    {
                        type: 'observe', target: 'v20-1', part: 'term-di1', circleR: 15,
                        msg: '识别数字量输入 DI1：外部 +24V 经「远程启停」开关接到 DI1（合=运行，断=停止）',
                        async act() {
                            const s = this.sys;
                            await _wireAnim(s, 'pterm-24_wire_p', 'sa-run_wire_l');
                            await _wireAnim(s, 'sa-run_wire_r', 'v20-1_wire_di1');
                            s.redrawAll();
                        },
                    },
                    {
                        type: 'observe', target: 'v20-1', part: 'term-di2', circleR: 15,
                        msg: '识别数字量输入 DI2：外部 +24V 经「正/反转」开关接到 DI2（合=反转，断=正转）',
                        async act() {
                            const s = this.sys;
                            await _wireAnim(s, 'pterm-24_wire_p', 'sa-dir_wire_l');
                            await _wireAnim(s, 'sa-dir_wire_r', 'v20-1_wire_di2');
                            s.redrawAll();
                        },
                    },
                ],
            },
            // ── 4. 模拟量输入 AI1 + 电位器 ──────────────────────────
            {
                msg: '4. 识别模拟量输入端子 AI1，将电位器输入信号连到 AI1（10V 连电位器左端，0V 连右端，中间接到 AI1）。',
                mode: 'check',
                check() {
                    const s = this.sys;
                    return _hasConn(s, 'v20-1_wire_v10', 'pot-1_wire_l')
                        && _hasConn(s, 'v20-1_wire_v0', 'pot-1_wire_r')
                        && _hasConn(s, 'pot-1_wire_w', 'v20-1_wire_ai1');
                },
                op: [
                    {
                        type: 'observe', target: 'v20-1', part: 'term-v10', circleR: 15,
                        msg: '识别 +10V 端子，接到电位器左端',
                        async act() {
                            const s = this.sys;
                            await _wireAnim(s, 'v20-1_wire_v10', 'pot-1_wire_l');
                            s.redrawAll();
                        },
                    },
                    {
                        type: 'observe', target: 'v20-1', part: 'term-v0', circleR: 15,
                        msg: '识别 0V 端子，接到电位器右端',
                        async act() {
                            const s = this.sys;
                            await _wireAnim(s, 'v20-1_wire_v0', 'pot-1_wire_r');
                            s.redrawAll();
                        },
                    },
                    {
                        type: 'observe', target: 'v20-1', part: 'term-ai1', circleR: 15,
                        msg: '识别模拟量输入端子 AI1，将电位器中间滑臂接到 AI1',
                        async act() {
                            const s = this.sys;
                            await _wireAnim(s, 'pot-1_wire_w', 'v20-1_wire_ai1');
                            s.redrawAll();
                        },
                    },
                ],
            },
            // ── 5. 开启电源 + 面板启动 ──────────────────────────────
            {
                msg: '5. 开启电源，按下 I 按钮，起动电机。',
                mode: 'check',
                check() {
                    const ac = this.sys.comps['ac-3p'];
                    const v = this.sys.comps['v20-1'];
                    return ac && ac.isOn && v && v._outputActive;
                },
                op: [
                    {
                        type: 'switch', target: 'ac-3p', part: 'power', circleR: 22,
                        msg: '按下三相电源面板上的「电源」按钮，接通主电源，变频器面板点亮',
                        async act() {
                            const s = this.sys;
                            const ac = s.comps['ac-3p'];
                            if (ac) { ac.isOn = true; ac.update(); }
                            s.redrawAll();
                            await _wait(2600);
                        },
                    },
                    {
                        type: 'btn', target: 'v20-1', part: 'btn-i',
                        msg: '按下面板绿色启动键 I，电机以 P1040 = 40.00Hz 起动',
                        async act() { await _pressBop(this, 'i', 1, 3000); },
                    },
                ],
            },
            // ── 6. 增加键：调到 45Hz ────────────────────────────────
            {
                msg: '6. 按增加键（▲），将频率调到 45Hz，观察电机转速上升。',
                mode: 'check',
                check() {
                    const v = this.sys.comps['v20-1'];
                    return v && Math.abs(v.getParam('P1040') - 45) < 0.01;
                },
                op: [
                    {
                        type: 'btn', target: 'v20-1', part: 'btn-up',
                        msg: '每按一次 ▲，频率增加 0.5Hz，连续按 10 次到 45.00Hz',
                        async act() { await _pressBop(this, 'up', 10, 650); },
                    },
                ],
            },
            // ── 7. 减少键：调到 40Hz ────────────────────────────────
            {
                msg: '7. 按减少键（▼），将频率调到 40Hz，观察电机转速下降。',
                mode: 'check',
                check() {
                    const v = this.sys.comps['v20-1'];
                    return v && Math.abs(v.getParam('P1040') - 40) < 0.01;
                },
                op: [
                    {
                        type: 'btn', target: 'v20-1', part: 'btn-dn',
                        msg: '每按一次 ▼，频率减少 0.5Hz，连续按 10 次到 40.00Hz',
                        async act() { await _pressBop(this, 'dn', 10, 650); },
                    },
                ],
            },
            // ── 8. 停止 ─────────────────────────────────────────────
            {
                msg: '8. 按下 O 键，停止电机。',
                mode: 'check',
                check() {
                    const v = this.sys.comps['v20-1'];
                    return v && !v._outputActive;
                },
                op: [
                    {
                        type: 'btn', target: 'v20-1', part: 'btn-o',
                        msg: '按下面板红色停止键 O，电机按斜坡停车',
                        async act() { await _pressBop(this, 'o', 1, 3000); },
                    },
                ],
            },
        ],
    },

    'v20-params': {
        id: 'v20-params',
        name: '2. 变频器参数的设置（端子启停 + 模拟量调速）',
        steps: [
            // ── 1. 自动接线 + 开启交流电源 ──────────────────────────
            {
                msg: '1. 点击「自动接线」完成全部接线，并开启交流电源。',
                mode: 'check',
                check() {
                    const ac = this.sys.comps['ac-3p'];
                    return ac && ac.isOn && _hasConn(this.sys, 'ac-3p_wire_u', 'v20-1_wire_l1');
                },
                op: [
                    {
                        type: 'wire',
                        msg: '点击工具栏【自动接线】按钮，按预设一次性完成全部电路连线',
                        async act() { _wire(this.sys); this.sys.redrawAll(); await _wait(1500); },
                    },
                    {
                        type: 'switch', target: 'ac-3p', part: 'power', circleR: 22,
                        msg: '按下三相电源面板上的「电源」按钮，接通主电源，变频器面板点亮',
                        async act() {
                            const s = this.sys;
                            const ac = s.comps['ac-3p'];
                            if (ac) { ac.isOn = true; ac.update(); }
                            s.redrawAll();
                            await _wait(2600);
                        },
                    },
                ],
            },
            // ── 2. 设置 P0700 = 2（命令源：端子）────────────────────
            {
                msg: '2. 设置参数 P0700（命令源）：=1 操作面板 BOP，=2 端子控制。当前为 1，改为 2，由外部端子决定启停。',
                mode: 'check',
                check() {
                    const v = this.sys.comps['v20-1'];
                    return v && Math.abs(v.getParam('P0700') - 2) < 1e-6;
                },
                op: [
                    {
                        type: 'btn', target: 'v20-1', part: 'btn-m',
                        msg: '按 M 进入参数菜单 → 连按 ▲ 选到 P0700 → OK 显示 → OK 进入编辑 → ▲ 改为 2 → OK 保存 → M 退出',
                        async act() { await _demoSetParam(this, 'P0700', 2); },
                    },
                ],
            },
            // ── 3. 合上远程启停开关，开启电机 ───────────────────────
            {
                msg: '3. 合上远程启停开关（SA1），开启电机。',
                mode: 'check',
                check() {
                    const v = this.sys.comps['v20-1'];
                    return v && v._outputActive;
                },
                op: [
                    {
                        type: 'switch', target: 'sa-run', part: null,
                        msg: '合上「SA1 远程启停」开关（DI1 得电），电机起动（MOP 频率 40.00Hz）',
                        async act() {
                            const s = this.sys;
                            const sw = s.comps['sa-run'];
                            if (sw) sw.isOn = true;
                            s.redrawAll();
                            await _wait(2800);
                        },
                    },
                ],
            },
            // ── 4. 断开远程启停开关，停止电机 ───────────────────────
            {
                msg: '4. 断开远程启停开关（SA1），停止电机。',
                mode: 'check',
                check() {
                    const v = this.sys.comps['v20-1'];
                    return v && !v._outputActive;
                },
                op: [
                    {
                        type: 'switch', target: 'sa-run', part: null,
                        msg: '断开「SA1 远程启停」开关（DI1 失电），电机按斜坡停车',
                        async act() {
                            const s = this.sys;
                            const sw = s.comps['sa-run'];
                            if (sw) sw.isOn = false;
                            s.redrawAll();
                            await _wait(2800);
                        },
                    },
                ],
            },
            // ── 5. 设置 P1000 = 2（频率源：模拟量 AI1）──────────────
            {
                msg: '5. 设置参数 P1000（频率设定值）：=1 BOP、=2 模拟量输入、=3 固定频率、=5 RS485。当前为 1，改为 2，由外部 AI1 模拟量决定速度。',
                mode: 'check',
                check() {
                    const v = this.sys.comps['v20-1'];
                    return v && Math.abs(v.getParam('P1000') - 2) < 1e-6;
                },
                op: [
                    {
                        type: 'btn', target: 'v20-1', part: 'btn-m',
                        msg: '按 M 进入参数菜单 → 连按 ▲ 选到 P1000 → OK 显示 → OK 进入编辑 → ▲ 改为 2 → OK 保存 → M 退出',
                        async act() { await _demoSetParam(this, 'P1000', 2); },
                    },
                ],
            },
            // ── 6. 合上开关 + 电位器调速 ────────────────────────────
            {
                msg: '6. 合上远程启停开关，开启电机；滑动电位器指针到 75%，观察电机转速变化。',
                mode: 'check',
                check() {
                    const v = this.sys.comps['v20-1'];
                    const pot = this.sys.comps['pot-1'];
                    return v && v._outputActive && pot && Math.abs(pot.position - 0.75) < 0.02;
                },
                op: [
                    {
                        type: 'switch', target: 'sa-run',
                        msg: '合上「SA1 远程启停」开关（DI1 得电），电机起动',
                        async act() {
                            const s = this.sys;
                            const sw = s.comps['sa-run'];
                            if (sw) sw.isOn = true;
                            s.redrawAll();
                            await _wait(2000);
                        },
                    },
                    {
                        type: 'knob', target: 'pot-1',
                        msg: '拖动电位器滑臂到 75%（AI1 电压变化 → 电机转速随之变化）',
                        async act() { await _slidePot(this, 0.75); await _wait(2600); },
                    },
                ],
            },
        ],
    },

    'v20-motor-params': {
        id: 'v20-motor-params',
        name: '3. 变频器参数的设置（电机参数设置）',
        steps: [
            // ── 1. 自动接线 + 开启交流电源 ──────────────────────────
            {
                msg: '1. 点击「自动接线」完成全部接线，并开启交流电源。',
                mode: 'check',
                check() {
                    const ac = this.sys.comps['ac-3p'];
                    return ac && ac.isOn && _hasConn(this.sys, 'ac-3p_wire_u', 'v20-1_wire_l1');
                },
                op: [
                    {
                        type: 'wire',
                        msg: '点击工具栏【自动接线】按钮，按预设一次性完成全部电路连线',
                        async act() { _wire(this.sys); this.sys.redrawAll(); await _wait(1500); },
                    },
                    {
                        type: 'switch', target: 'ac-3p', part: 'power', circleR: 22,
                        msg: '按下三相电源面板上的「电源」按钮，接通主电源，变频器面板点亮',
                        async act() {
                            const s = this.sys;
                            const ac = s.comps['ac-3p'];
                            if (ac) { ac.isOn = true; ac.update(); }
                            s.redrawAll();
                            await _wait(2600);
                        },
                    },
                ],
            },
            // ── 2. P0010 = 1 进入快速调试 ───────────────────────────
            {
                msg: '2. 设置 P0010 = 1（快速调试），进入快速调试后才能设置电机参数。',
                mode: 'check',
                check() {
                    const v = this.sys.comps['v20-1'];
                    return v && Math.abs(v.getParam('P0010') - 1) < 1e-6;
                },
                op: [
                    {
                        type: 'btn', target: 'v20-1', part: 'btn-m',
                        msg: '按 M 进菜单 → ▲ 选到 P0010 → OK → OK 进入编辑 → ▲ 改为 1 → OK 保存 → M 退出',
                        async act() { await _demoSetNumeric(this, 'P0010', 1); },
                    },
                ],
            },
            // ── 3. P0304 额定电压 ───────────────────────────────────
            {
                msg: '3. 设置 P0304（额定电压）= 380 V（电机铭牌电压值）。',
                mode: 'check',
                check() {
                    const v = this.sys.comps['v20-1'];
                    return v && Math.abs(v.getParam('P0304') - 380) < 1e-6;
                },
                op: [
                    {
                        type: 'btn', target: 'v20-1', part: 'btn-m',
                        msg: '按 M 进菜单 → ▲ 选到 P0304 → OK → OK 编辑 → 逐位改为 380 → OK 保存 → M 退出',
                        async act() { await _demoSetNumeric(this, 'P0304', 380); },
                    },
                ],
            },
            // ── 4. P0305 额定电流 ───────────────────────────────────
            {
                msg: '4. 设置 P0305（额定电流）= 7.60 A（电机铭牌电流值）。',
                mode: 'check',
                check() {
                    const v = this.sys.comps['v20-1'];
                    return v && Math.abs(v.getParam('P0305') - 7.6) < 1e-6;
                },
                op: [
                    {
                        type: 'btn', target: 'v20-1', part: 'btn-m',
                        msg: '按 M 进菜单 → ▲ 选到 P0305 → OK → OK 编辑 → 逐位改为 7.60 → OK 保存 → M 退出',
                        async act() { await _demoSetNumeric(this, 'P0305', 7.6); },
                    },
                ],
            },
            // ── 5. P0307 额定功率 ───────────────────────────────────
            {
                msg: '5. 设置 P0307（额定功率）= 5.00 kW（电机铭牌功率值）。',
                mode: 'check',
                check() {
                    const v = this.sys.comps['v20-1'];
                    return v && Math.abs(v.getParam('P0307') - 5.0) < 1e-6;
                },
                op: [
                    {
                        type: 'btn', target: 'v20-1', part: 'btn-m',
                        msg: '按 M 进菜单 → ▲ 选到 P0307 → OK → OK 编辑 → 逐位改为 5.00 → OK 保存 → M 退出',
                        async act() { await _demoSetNumeric(this, 'P0307', 5.0); },
                    },
                ],
            },
            // ── 6. P0310 额定频率 ───────────────────────────────────
            {
                msg: '6. 设置 P0310（额定频率）= 50.00 Hz（电机铭牌频率值）。',
                mode: 'check',
                check() {
                    const v = this.sys.comps['v20-1'];
                    return v && Math.abs(v.getParam('P0310') - 50) < 1e-6;
                },
                op: [
                    {
                        type: 'btn', target: 'v20-1', part: 'btn-m',
                        msg: '按 M 进菜单 → ▲ 选到 P0310 → OK → OK 编辑 → 逐位改为 50.00 → OK 保存 → M 退出',
                        async act() { await _demoSetNumeric(this, 'P0310', 50); },
                    },
                ],
            },
            // ── 7. P0311 额定转速 ───────────────────────────────────
            {
                msg: '7. 设置 P0311（额定转速）= 1440 RPM（电机铭牌转速值）。',
                mode: 'check',
                check() {
                    const v = this.sys.comps['v20-1'];
                    return v && Math.abs(v.getParam('P0311') - 1440) < 1e-6;
                },
                op: [
                    {
                        type: 'btn', target: 'v20-1', part: 'btn-m',
                        msg: '按 M 进菜单 → ▲ 选到 P0311 → OK → OK 编辑 → 逐位改为 1440 → OK 保存 → M 退出',
                        async act() { await _demoSetNumeric(this, 'P0311', 1440); },
                    },
                ],
            },
            // ── 8. P3900 = 3 结束快速调试 ───────────────────────────
            {
                msg: '8. 设置 P3900 = 3（结束快速调试并触发电机数据计算）。',
                mode: 'check',
                check() {
                    const v = this.sys.comps['v20-1'];
                    return v && Math.abs(v.getParam('P3900') - 3) < 1e-6;
                },
                op: [
                    {
                        type: 'btn', target: 'v20-1', part: 'btn-m',
                        msg: '按 M 进菜单 → ▲ 选到 P3900 → OK → OK 编辑 → ▲ 改为 3 → OK 保存（结束快速调试、触发电机数据计算）→ M 退出',
                        async act() { await _demoSetNumeric(this, 'P3900', 3); },
                    },
                ],
            },
        ],
    },
};

export const componentConfigs = [
    // 三相电源 380V（L1/L2/L3 进线）
    { Class: ACPower3P, id: 'ac-3p', x: 60, y: 110, scale: 1.0, isOn: false, vRms: 220, freq: 50 },

    // 变频器（面板启动 + 恒定频率：P0700=1 命令源BOP，P1000=1 频率源MOP，P1040=40Hz 运行时频率）
    // 电机参数保持出厂默认，由「操作流程3」通过面板按铭牌设置
    { Class: SinamicsV20, id: 'v20-1', x: 520, y: 30, label: 'V20', p0700: 1, p1000: 1, mopSetpoint: 40 },

    // 三相异步电动机（额定 5kW / 380V → 100% 负荷每相注入电阻 R=U²/P≈28.88Ω，额定电流≈7.60A）
    { Class: ThreePhaseMotor3D, id: 'm-3d', x: 600, y: 780, scale: 2 / 3, label: 'M1',
      ratedPower: 5.0, ratedVoltage: 380, ratedSpeed: 1440 },

    // 外部 24V 控制电源（电位端子 +24V），开关从此取电，不再从面板取电
    { Class: PotentialTerminal, id: 'pterm-24', x: 100, y: 500, potential: 24, scale: 1.2 },

    // 远程控制：SA1 启停（DI1 = ON/OFF1）、SA2 换向（DI2 = 反转）
    { Class: Switch, id: 'sa-run', x: 280, y: 450, label: 'SA1 远程启停', onLabel: '运行', offLabel: '停止' },
    { Class: Switch, id: 'sa-dir', x: 280, y: 550, label: 'SA2 正/反转', onLabel: '反转', offLabel: '正转' },

    // 远程调速：三端电位器（左=+10V，右=0V，滑臂=AI1）
    { Class: Potentiometer, id: 'pot-1', x: 300, y: 900, value: 10000, position: 0.25 },

    // ── 7 种必备仪表（默认隐藏）──
    { Class: Multimeter, id: 'multimeter', x: 720, y: -20, visible: false },
    { Class: MF47Multimeter, id: 'mf47-panel', x: 1150, y: 250, visible: false },
    { Class: Oscilloscope_tri, id: 'osc', x: 50, y: 50, visible: false },
    { Class: SignalGenerator, id: 'sg', x: 50, y: 50, visible: false },
    { Class: ProcessCalibrator, id: 'cali', x: 50, y: 50, visible: false },
    { Class: ElecMeter, id: 'elecmeter', x: 50, y: 50, visible: false },
    { Class: RealMegohmMeter, id: 'megohm', x: 50, y: 50, visible: false },
];

// ── 电路连线 ────────────────────────────────────────────────
function _wire(sys) {
    const conns = [
        // 主电路：三相电源 → V20 进线
        { from: 'ac-3p_wire_u', to: 'v20-1_wire_l1', type: 'wire' },
        { from: 'ac-3p_wire_v', to: 'v20-1_wire_l2', type: 'wire' },
        { from: 'ac-3p_wire_w', to: 'v20-1_wire_l3', type: 'wire' },
        // 电机电路：V20 输出 → 电动机
        { from: 'v20-1_wire_u', to: 'm-3d_wire_u', type: 'wire' },
        { from: 'v20-1_wire_v', to: 'm-3d_wire_v', type: 'wire' },
        { from: 'v20-1_wire_w', to: 'm-3d_wire_w', type: 'wire' },
        { from: 'v20-1_wire_pe', to: 'm-3d_wire_pe', type: 'wire' },
        // 数字量输入公共端 DIC → 变频器 0V
        { from: 'v20-1_wire_dicom', to: 'v20-1_wire_v0', type: 'wire' },
        // 远程启停：外部 +24V → SA1 → DI1（ON/OFF1）
        { from: 'pterm-24_wire_p', to: 'sa-run_wire_l', type: 'wire' },
        { from: 'sa-run_wire_r', to: 'v20-1_wire_di1', type: 'wire' },
        // 远程换向：外部 +24V → SA2 → DI2（反转）
        { from: 'pterm-24_wire_p', to: 'sa-dir_wire_l', type: 'wire' },
        { from: 'sa-dir_wire_r', to: 'v20-1_wire_di2', type: 'wire' },
        // 远程调速给定：电位器左端接 +10V、右端接 0V、滑臂接 AI1
        { from: 'v20-1_wire_v10', to: 'pot-1_wire_l', type: 'wire' },
        { from: 'v20-1_wire_v0',  to: 'pot-1_wire_r', type: 'wire' },
        { from: 'pot-1_wire_w',   to: 'v20-1_wire_ai1', type: 'wire' },
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
function _hasConn(sys, a, b) {
    return sys.conns.some(c => (c.from === a && c.to === b) || (c.from === b && c.to === a));
}

/** 动画接线（约 3s/根）；已连接的跳过，保证演示可重复运行 */
async function _wireAnim(sys, from, to) {
    if (_hasConn(sys, from, to)) return;
    await sys.connMgr.addConnectionAnimated({ from, to, type: 'wire' });
}

function _wait(ms) { return new Promise(r => setTimeout(r, ms)); }

/** 单次按下面板键：先闪烁箭头指向该键，再执行一次按键，然后短暂停留 */
async function _pressKey(wf, key, hold = 500, arrow = { on: 220, off: 150, times: 2 }) {
    const v = wf.sys.comps['v20-1'];
    if (!v) return;
    const partId = { i: 'btn-i', o: 'btn-o', m: 'btn-m', ok: 'btn-ok', up: 'btn-up', dn: 'btn-dn' }[key] || 'btn-ok';
    const c = v.getClickablePartCenter(partId);
    if (wf._flashArrow && c) await wf._flashArrow(c, Object.assign({ radius: 30 }, arrow));
    v._bopPress(key);
    if (wf.sys.requestRedraw) wf.sys.requestRedraw();
    await _wait(hold);
}

/**
 * 模拟人手逐次按下变频器面板按键（连按 times 次）。
 */
async function _pressBop(wf, key, times, hold = 700) {
    for (let k = 0; k < times; k++) await _pressKey(wf, key, hold);
}

/**
 * 用面板按键完整演示一次参数设置：M 进菜单 → ▲ 翻到目标参数 → OK 显示 → OK 编辑
 * → ▲ 改到目标值 → OK 保存 → M 退出。每个按键前都有箭头指示。
 * @param {object} wf Workflow 实例
 * @param {string} num 参数号，如 'P0700'
 * @param {number} target 目标值
 */
async function _demoSetParam(wf, num, target) {
    const v = wf.sys.comps['v20-1'];
    if (!v) return;
    // 进入参数菜单
    if (v._ui.mode === 'status') await _pressKey(wf, 'm', 700);
    // ▲ 翻到目标参数
    let guard = 0;
    while (v._ui.mode === 'list' && v._ui.sel !== num && guard++ < 60) await _pressKey(wf, 'up', 320);
    // OK：进入数值显示
    await _pressKey(wf, 'ok', 700);
    // OK：进入编辑
    await _pressKey(wf, 'ok', 700);
    // ▲ 改到目标值
    guard = 0;
    while (v._ui.mode === 'edit' && Math.abs(v._ui.editVal - target) > 1e-6 && guard++ < 200) await _pressKey(wf, 'up', 320);
    // OK：保存
    await _pressKey(wf, 'ok', 800);
    // M：退出到状态屏
    guard = 0;
    while (v._ui.mode !== 'status' && guard++ < 5) await _pressKey(wf, 'm', 600);
}

/**
 * 用面板按键演示一次数值参数设置（逐位编辑，仿真实 V20）：
 * M 进菜单 → ▲ 翻到目标参数 → OK 显示 → OK 编辑 → 逐位用 ▲/▼ 改到目标值
 * （每位改完按 OK 移到下一位，末位 OK 保存）→ M 退出。每个按键前都有箭头指示。
 */
async function _demoSetNumeric(wf, num, target) {
    const v = wf.sys.comps['v20-1'];
    if (!v) return;
    if (v._ui.mode === 'status') await _pressKey(wf, 'm', 700);
    let guard = 0;
    while (v._ui.mode === 'list' && v._ui.sel !== num && guard++ < 80) await _pressKey(wf, 'up', 300);
    await _pressKey(wf, 'ok', 600);   // 显示数值
    await _pressKey(wf, 'ok', 600);   // 进入逐位编辑
    const def = v._pdef(num);
    const maxDigit = v._maxDigit(def, v._ui.editVal);
    for (let pos = 0; pos <= maxDigit; pos++) {
        const tDigit = v._digitAt(target, def, pos);
        const cur = v._digitAt(v._ui.editVal, def, pos);
        if (cur !== tDigit) {
            const up = (tDigit - cur + 10) % 10;
            const dir = up <= 5 ? 1 : -1;
            const count = up <= 5 ? up : (10 - up);
            for (let k = 0; k < count; k++) await _pressKey(wf, dir > 0 ? 'up' : 'dn', 300);
        }
        await _pressKey(wf, 'ok', 600);   // 下一位 / 保存
    }
    guard = 0;
    while (v._ui.mode !== 'status' && guard++ < 5) await _pressKey(wf, 'm', 600);
}

/** 模拟人手把电位器滑臂平滑拖到目标位置（0~1） */
async function _slidePot(wf, targetPos) {
    const pot = wf.sys.comps['pot-1'];
    if (!pot) return;
    const start = pot.position;
    const steps = 12;
    for (let k = 1; k <= steps; k++) {
        pot.position = start + (targetPos - start) * (k / steps);
        pot.update();
        if (wf.sys.requestRedraw) wf.sys.requestRedraw();
        await _wait(90);
    }
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
}

export async function applyStartSystem() {
    if (!(this && this.sys && this.sys.connMgr)) return;
    _wire(this.sys);
    _powerOn(this.sys);
}

export function fiveStep() { }
