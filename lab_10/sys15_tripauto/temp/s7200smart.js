
import { Multimeter } from '../components/Multimeter.js';
import { MF47Multimeter } from '../components/MF47Multimeter.js';
import { Oscilloscope_tri } from '../components/Osc_tri.js';
import { SignalGenerator } from '../components/SignalGenerator.js';
import { ProcessCalibrator } from '../components/ProcessCalibrator.js';
import { ElecMeter } from '../components/ElecMeter.js';
import { RealMegohmMeter } from '../components/RealMegohmMeter.js';

// ── 本实验元件（device 组合设备 + PLC + 电机）──────────────────
import { S7_200_SMART_SR40 } from '../components/S7_200_SMART_SR40.js'; // 西门子 S7-200 SMART CPU SR40
import { DiagramACPower3P } from '../components/DiagramACPower3P.js'; // 三相电源（单线图符号）
import { MainContact } from '../device/MainContact.js';         // 接触器 KM 主触头
import { ContactorCoil } from '../device/ContactorCoil.js';     // 接触器 KM 线圈
import { AuxNOContact } from '../device/AuxNOContact.js';       // 接触器 KM 辅助常开
import { ThermalHeatElement } from '../device/ThermalHeatElement.js'; // 热继电器 FR 发热元件
import { ThermalNCContact } from '../device/ThermalNCContact.js';     // 热继电器 FR 常闭触点
import { ThreePhaseMotor3D } from '../components/ThreePhaseMotor3D.js'; // 三相异步电动机
import { Switch } from '../components/Switch.js';               // 启停按钮（干接点）
import { Ground } from '../components/Gnd.js';                  // 接地参考

export const FAULT_CONFIGS = {};

/**
 * PLC 典型测试电路 —— 起保停控制电机运行
 * ══════════════════════════════════════════════════════════════
 *
 *  主电路（AC 380V，走 L/T 强电端子）：
 *    三相电源 → 接触器 KM1 主触头(km1-mc) → 热继电器 FR 发热元件(fr) → 三相异步电机 M
 *
 *  控制回路（DC 24V，走 a1/a2、com/no|nc 弱电端子，与主电路分开）：
 *    SB1 启动按钮 → I0.0      SB2 停止按钮 → I0.1
 *    热继电器 FR 常闭(95-96) → I0.2（过载反馈）
 *    PLC Q0.0 → 接触器 KM1 线圈(km1-coil) A1，线圈 A2 → PLC 0V
 *    KM1 辅助常开(km1-no1) 作为状态反馈可接 I0.3（此处作为演示备用）
 *
 *  起保停（自锁）逻辑由 PLC 用户程序实现（软件自锁）：
 *      LD I0.0
 *      O  Q0.0        ← 自锁
 *      AN I0.1
 *      A  I0.2        ← 热继电器未动作
 *      =  Q0.0
 *
 *  组合设备说明：km1-mc / km1-coil / km1-no1 共用 deviceid='KM1'，
 *  fr / fr-nc 共用 deviceid='FR1'，由 DeviceManager 关联同一状态机；
 *  线圈额定电压设为 DC24V，可由 PLC 的 Q0.0 直接驱动。
 */
export const PROJECT_WORKFLOWS = {};

export const componentConfigs = [
    // 三相电源（简化单线图符号）
    { Class: DiagramACPower3P, id: 'ac-3p', x: 120, y: 60, vRms: 220, freq: 50, isOn: true, phaseSeq: 'pos' },

    // ── 主电路（AC 380V）──
    // 接触器 KM1 主触头
    { Class: MainContact, id: 'km1-mc', x: 80, y: 320, width: 300, height: 150, deviceid: 'KM1' },
    // 热继电器 FR 发热元件
    { Class: ThermalHeatElement, id: 'fr', x: 80, y: 560, width: 300, height: 150,
      deviceid: 'FR1', ratedCurrent: 10, tripClass: 10 },
    // 三相异步电动机（额定 5kW / 380V / 1440r/min）
    { Class: ThreePhaseMotor3D, id: 'm-3d', x: 900, y: 300, scale: 2 / 3, label: 'M1',
      ratedPower: 5.0, ratedVoltage: 380, ratedFreq: 50, ratedSpeed: 1440, loadRate: 1.0 },

    // ── 控制回路（DC 24V）──
    // 接触器 KM1 线圈（额定 DC24V，PLC 直接驱动）
    { Class: ContactorCoil, id: 'km1-coil', x: 780, y: 60, width: 70, height: 50,
      deviceid: 'KM1', ratedCoilVoltage: 24, coilResistance: 240 },
    // KM1 辅助常开（状态反馈，备用）
    { Class: AuxNOContact, id: 'km1-no1', x: 780, y: 170, width: 70, height: 50, deviceid: 'KM1' },
    // 热继电器 FR 常闭触点（95-96，过载反馈）
    { Class: ThermalNCContact, id: 'fr-nc', x: 950, y: 60, width: 70, height: 50, deviceid: 'FR1' },

    // PLC：西门子 S7-200 SMART CPU SR40（24DI/16DO/2AI/1AO）
    { Class: S7_200_SMART_SR40, id: 'plc-1', x: 160, y: 900, scale: 1.0, label: 'SR40',
      mode: 'RUN',
      program: [
        '// S7-200 SMART SR40 —— 起保停（软件自锁）控制电机运行',
        '// I0.0 启动(SB1)  I0.1 停止(SB2)  I0.2 热继电器FR反馈',
        '// Q0.0 → 接触器 KM1 线圈',
        'LD     I0.0',
        'O      Q0.0',
        'AN     I0.1',
        'A      I0.2',        // 热继电器未动作（常闭）才允许运行
        '=      Q0.0',
        'END',
      ].join('\n') },

    // 启停按钮（干接点：一端接 PLC 24V，另一端接 DI）
    { Class: Switch, id: 'sb1-start', x: 1100, y: 60 },
    { Class: Switch, id: 'sb2-stop',  x: 1100, y: 180 },

    // 接地参考（PE / 0V 公共）
    { Class: Ground, id: 'gnd-1', x: 1250, y: 320 },

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
        // 公共端：PLC 1M/2M → PLC 0V（DI 源型接法）
        { from: 'plc-1_wire_1m', to: 'plc-1_wire_v0', type: 'wire' },
        { from: 'plc-1_wire_2m', to: 'plc-1_wire_v0', type: 'wire' },
        // 启动按钮 SB1：PLC 24V → SB1 → I0.0
        { from: 'plc-1_wire_24v', to: 'sb1-start_wire_l', type: 'wire' },
        { from: 'sb1-start_wire_r', to: 'plc-1_wire_di00', type: 'wire' },
        // 停止按钮 SB2：PLC 24V → SB2 → I0.1
        { from: 'plc-1_wire_24v', to: 'sb2-stop_wire_l', type: 'wire' },
        { from: 'sb2-stop_wire_r', to: 'plc-1_wire_di01', type: 'wire' },
        // 热继电器 FR 常闭触点（过载反馈）：PLC 24V → FR(95-96) → I0.2
        { from: 'plc-1_wire_24v', to: 'fr-nc_wire_com', type: 'wire' },
        { from: 'fr-nc_wire_nc', to: 'plc-1_wire_di02', type: 'wire' },
        // 输出回路：Q0.0 → 接触器 KM1 线圈 A1，线圈 A2 → PLC 0V
        { from: 'plc-1_wire_1l', to: 'plc-1_wire_24v', type: 'wire' },   // 输出组电源 1L+
        { from: 'plc-1_wire_dq00', to: 'km1-coil_wire_a1', type: 'wire' },
        { from: 'km1-coil_wire_a2', to: 'plc-1_wire_v0', type: 'wire' },
        // 辅助常开触点状态反馈（备用）：PLC 24V → KM1 NO → I0.3
        { from: 'plc-1_wire_24v', to: 'km1-no1_wire_com', type: 'wire' },
        { from: 'km1-no1_wire_no', to: 'plc-1_wire_di03', type: 'wire' },
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
