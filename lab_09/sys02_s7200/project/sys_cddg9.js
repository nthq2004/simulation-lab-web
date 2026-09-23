
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
import { Resistor } from '../components/Resistor.js';           // 转速给定电位器（上臂）
import { VariResistor } from '../components/VariResistor.js';   // 转速给定电位器（可调下臂）

export const FAULT_CONFIGS = {};

/**
 * 典型变频调速控制实验
 *   1. 面板控制（HAND）：V20 的 I/O 键启停，▲▼ 调 MOP 频率
 *   2. 远程控制（AUTO）：SA1 启停、SA2 换向、RP 电位器调速（AI1 0~10V）
 *   在变频器右键菜单（或参数菜单 P0700/P1000）中切换 HAND/AUTO。
 */
export const PROJECT_WORKFLOWS = {};

export const componentConfigs = [
    // 三相电源 380V（L1/L2/L3 进线）
    { Class: ACPower3P, id: 'ac-3p', x: 60, y: 190, scale: 1.3, isOn: true, vRms: 220, freq: 50 },

    // 变频器（默认 AUTO：端子远程控制 + 模拟量调速）
    { Class: SinamicsV20, id: 'v20-1', x: 520, y: 150, label: 'V20', p0700: 2, p1000: 2,
      motorVoltage: 380, motorPower: 5.0, motorCurrent: 7.6, motorSpeed: 1440 },

    // 三相异步电动机（额定 5kW / 380V → 100% 负荷每相注入电阻 R=U²/P≈28.88Ω，额定电流≈7.60A）
    { Class: ThreePhaseMotor3D, id: 'm-3d', x: 1080, y: 700, scale: 2 / 3, label: 'M1',
      ratedPower: 5.0, ratedVoltage: 380, ratedSpeed: 1440 },

    // 远程控制：SA1 启停（DI1 = ON/OFF1）、SA2 换向（DI2 = 反转）
    { Class: Switch, id: 'sa-run', x: 900, y: 70 },
    { Class: Switch, id: 'sa-dir', x: 900, y: 180 },

    // 远程调速：10V — R(10k) — AI1 — RP(0~100k 可调) — 0V
    { Class: Resistor, id: 'r-pot', x: 880, y: 430, value: 10000 },
    { Class: VariResistor, id: 'rp-speed', x: 880, y: 540, value: 100000, cvalue: 30000 },

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
        // 数字量输入公共端 DIC → 0V
        { from: 'v20-1_wire_dicom', to: 'v20-1_wire_v0', type: 'wire' },
        // 远程启停：+24V → SA1 → DI1（ON/OFF1）
        { from: 'v20-1_wire_v24', to: 'sa-run_wire_l', type: 'wire' },
        { from: 'sa-run_wire_r', to: 'v20-1_wire_di1', type: 'wire' },
        // 远程换向：+24V → SA2 → DI2（反转）
        { from: 'v20-1_wire_v24', to: 'sa-dir_wire_l', type: 'wire' },
        { from: 'sa-dir_wire_r', to: 'v20-1_wire_di2', type: 'wire' },
        // 远程调速给定：+10V — R — AI1 — RP — 0V
        { from: 'v20-1_wire_v10', to: 'r-pot_wire_l', type: 'wire' },
        { from: 'r-pot_wire_r', to: 'v20-1_wire_ai1', type: 'wire' },
        { from: 'v20-1_wire_ai1', to: 'rp-speed_wire_l', type: 'wire' },
        { from: 'rp-speed_wire_r', to: 'v20-1_wire_v0', type: 'wire' },
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
