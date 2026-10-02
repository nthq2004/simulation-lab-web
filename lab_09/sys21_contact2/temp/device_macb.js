// 船舶发电机主开关仿真工程（同步发电机 + 汇流排 + 船用框架式空气断路器）

import { SyncGenerator3P } from '../components/SyncGenerator3P.js';
import { Busbar3P } from '../components/Busbar3P.js';
import { MarineMainsSwitch } from '../components/MarineMainsSwitch.js';
import { MarineElectronicTrip } from '../components/MarineElectronicTrip.js';
import { GeneratorRemotePanel } from '../components/GeneratorRemotePanel.js';
import { DCPower } from '../components/DCPower.js';
import { Ground } from '../components/Gnd.js';
import { DiagramThreePhaseACB } from '../components/DiagramThreePhaseACB.js';
import { DiagramStartButton } from '../components/DiagramStartButton.js';
import { DiagramStopButton } from '../components/DiagramStopButton.js';
import { InductionMotor2 } from '../components/InductionMotor2.js';
import { IncandescentLamp } from '../components/IncandescentLamp.js';
import { Multimeter } from '../components/Multimeter.js';
import { MF47Multimeter } from '../components/MF47Multimeter.js';
import { Oscilloscope_tri } from '../components/Osc_tri.js';
import { SignalGenerator } from '../components/SignalGenerator.js';
import { ProcessCalibrator } from '../components/ProcessCalibrator.js';
import { ElecMeter } from '../components/ElecMeter.js';

export const FAULT_CONFIGS = {

};

export const PROJECT_WORKFLOWS = {

};

export const componentConfigs = [
    // ── 主回路：同步发电机 → 主开关 → 汇流排 ──
    { Class: SyncGenerator3P, id: 'gen1', x: 90, y: 700, vRms: 230, freq: 50, isOn: false, label: '同步发电机', ratedPower: 400, ratedVoltage: 400, ratedCosPhi: 0.8, visible: true },
    { Class: MarineMainsSwitch, id: 'qf1', x: 10, y: 250, ratedCtrlVoltage: 24, label: '主开关',  visible: true },
    { Class: MarineElectronicTrip, id: 'et1', x: 700, y: 650, In: 100, Un: 380, phase: '3', cosPhi: 0.8, label: 'ET', visible: true },
    { Class: GeneratorRemotePanel, id: 'genpanel', x: 1780, y: 50, genId: 'gen1', qfId: 'qf1', label: '发电机组遥控面板', visible: true },
    // 遥控面板下方：起动按钮（绿、NO）与停止按钮（红、NC），仅放置展示
    { Class: DiagramStopButton, id: 'sb', x: 1755, y: 400, label: 'SB1', visible: true },
    { Class: DiagramStartButton, id: 'ss', x: 1915, y: 400, label: 'SB2', visible: true },
    { Class: Busbar3P, id: 'bus1', x: 220, y: 30, tapsPerPhase: 6, label: '汇流排', visible: true },
    // 发电机中性点接地
    { Class: Ground, id: 'gnd1', x: 50, y: 950, visible: true },

    // ── 控制电源（DC 24V）：失压脱扣线圈 ──
    { Class: DCPower, id: 'dc_uv', x: 900, y: 280, voltage: 24, isOn: true, label: '失压脱扣电源', visible: true },

    // ── 汇流排馈出支路 ──
    // 支路1（第7列）：三相空气开关 QF2 → 三相感应电机（Y 接法）
    { Class: DiagramThreePhaseACB, id: 'acb_m', x: 1295, y: 480, initState: 'off', label: 'QF2', ratedVoltage: 380, ratedCurrent: 100, tripCurrent: 10, visible: true },
    { Class: InductionMotor2, id: 'im01', x: 1290, y: 620, visible: true,
        R1: 0.50, Lsigma1: 0.00334, Rc: 300, Lm: 0.0796,
        R2: 0.46, Lsigma2: 0.00334,
        J: 0.12, B: 0.01, polePairs: 2,
        ratedPower: 10, ratedSpeed: 1440,
        simpleModel: true, loadTorque: 20 },
    // 支路2（第8列）：三相空气开关 QF3 → 三盏白炽灯（分别接 L1/L2/L3）
    { Class: DiagramThreePhaseACB, id: 'acb_l', x: 1526, y: 480, initState: 'off', label: 'QF3', ratedVoltage: 380, ratedCurrent: 100, tripCurrent: 10, visible: true },
    { Class: IncandescentLamp, id: 'lamp1', x: 1550, y: 670, coldResistance: 484, rotation: 90 },
    { Class: IncandescentLamp, id: 'lamp2', x: 1620, y: 670, coldResistance: 484, rotation: 90 },
    { Class: IncandescentLamp, id: 'lamp3', x: 1690, y: 670, coldResistance: 484, rotation: 90 },
    { Class: Ground, id: 'gnd_l', x: 1650, y: 870, visible: true },

    { Class: Multimeter, id: 'multimeter', x: 920, y: 100, visible: false },
    { Class: MF47Multimeter, id: 'mf47-panel', x: 1050, y: 150, visible: false },
    { Class: Oscilloscope_tri, id: 'osc', x: 50, y: 50, visible: false },
    { Class: SignalGenerator, id: 'sg', x: 50, y: 50, visible: false },
    { Class: ProcessCalibrator, id: 'cali', x: 50, y: 50, visible: false },
    { Class: ElecMeter, id: 'elecmeter', x: 50, y: 50, visible: false },
];

// ─── 接线辅助 ───

function _autoWire(sys) {
    sys.conns.length = 0;
    const cons = [
        // ── 主回路：同步发电机 → 主开关 → 汇流排 ──
        { from: 'gen1_wire_u', to: 'qf1_wire_t1', type: 'wire' },
        { from: 'gen1_wire_v', to: 'qf1_wire_t2', type: 'wire' },
        // 第3相（W）串联电子脱扣器电流采样端（I+ → 发电机，I- → 主开关）
        { from: 'gen1_wire_w', to: 'et1_wire_i+', type: 'wire' },
        { from: 'et1_wire_i-', to: 'qf1_wire_t3', type: 'wire' },
        { from: 'qf1_wire_l1', to: 'bus1_wire_l1_1', type: 'wire' },
        { from: 'qf1_wire_l2', to: 'bus1_wire_l2_1', type: 'wire' },
        { from: 'qf1_wire_l3', to: 'bus1_wire_l3_1', type: 'wire' },
        // ── 电子脱扣器：测量第3相相电压（W-N）、24V 供电、脱扣输出接主开关 ET ──
        { from: 'gen1_wire_w', to: 'et1_wire_u+', type: 'wire' },
        { from: 'gen1_wire_n', to: 'et1_wire_u-', type: 'wire' },
        { from: 'dc_uv_wire_p', to: 'et1_wire_vp', type: 'wire' },
        { from: 'dc_uv_wire_n', to: 'et1_wire_vn', type: 'wire' },
        { from: 'et1_wire_t1', to: 'qf1_wire_et1', type: 'wire' },
        { from: 'et1_wire_t2', to: 'qf1_wire_et2', type: 'wire' },
        // ── 支路1：汇流排第7列三相 → QF2 → 感应电机（Y 接法）──
        { from: 'bus1_wire_l1_7', to: 'acb_m_wire_l1', type: 'wire' },
        { from: 'bus1_wire_l2_7', to: 'acb_m_wire_l2', type: 'wire' },
        { from: 'bus1_wire_l3_7', to: 'acb_m_wire_l3', type: 'wire' },
        { from: 'acb_m_wire_t1', to: 'im01_wire_u1', type: 'wire' },
        { from: 'acb_m_wire_t2', to: 'im01_wire_v1', type: 'wire' },
        { from: 'acb_m_wire_t3', to: 'im01_wire_w1', type: 'wire' },
        { from: 'im01_wire_u2', to: 'im01_wire_v2', type: 'wire' },
        { from: 'im01_wire_v2', to: 'im01_wire_w2', type: 'wire' },
        // ── 支路2：汇流排第8列三相 → QF3 → 三盏白炽灯（L1/L2/L3 各一）→ 接地 ──
        { from: 'bus1_wire_l1_8', to: 'acb_l_wire_l1', type: 'wire' },
        { from: 'bus1_wire_l2_8', to: 'acb_l_wire_l2', type: 'wire' },
        { from: 'bus1_wire_l3_8', to: 'acb_l_wire_l3', type: 'wire' },
        { from: 'acb_l_wire_t1', to: 'lamp1_wire_l', type: 'wire' },
        { from: 'acb_l_wire_t2', to: 'lamp2_wire_l', type: 'wire' },
        { from: 'acb_l_wire_t3', to: 'lamp3_wire_l', type: 'wire' },
        { from: 'lamp1_wire_r', to: 'gnd_l_wire_gnd', type: 'wire' },
        { from: 'lamp2_wire_r', to: 'gnd_l_wire_gnd', type: 'wire' },
        { from: 'lamp3_wire_r', to: 'gnd_l_wire_gnd', type: 'wire' },
        // ── 控制电源：DC 24V → 失压脱扣线圈（uv1/uv2）──
        { from: 'dc_uv_wire_p', to: 'qf1_wire_uv1', type: 'wire' },
        { from: 'dc_uv_wire_n', to: 'qf1_wire_uv2', type: 'wire' },
        // ── 储能电机电源：DC 24V → 主开关储能电机（m1/m2）──
        { from: 'dc_uv_wire_p', to: 'qf1_wire_m1', type: 'wire' },
        { from: 'dc_uv_wire_n', to: 'qf1_wire_m2', type: 'wire' },
        // ── 发电机组遥控面板：左面板 → gen1 遥控端口 ──
        { from: 'genpanel_wire_start_a', to: 'gen1_wire_rm_start_a', type: 'wire' },
        { from: 'genpanel_wire_start_b', to: 'gen1_wire_rm_start_b', type: 'wire' },
        { from: 'genpanel_wire_stop_a', to: 'gen1_wire_rm_stop_a', type: 'wire' },
        { from: 'genpanel_wire_stop_b', to: 'gen1_wire_rm_stop_b', type: 'wire' },
        { from: 'genpanel_wire_spd_p', to: 'gen1_wire_freq_in_p', type: 'wire' },
        { from: 'genpanel_wire_spd_n', to: 'gen1_wire_freq_in_n', type: 'wire' },
        // ── 左面板 → qf1 合闸/分励线圈 ──
        { from: 'genpanel_wire_close_a', to: 'qf1_wire_c1', type: 'wire' },
        { from: 'genpanel_wire_close_b', to: 'qf1_wire_c2', type: 'wire' },
        { from: 'genpanel_wire_open_a', to: 'qf1_wire_fla', type: 'wire' },
        { from: 'genpanel_wire_open_b', to: 'qf1_wire_flb', type: 'wire' },
        // ── 左面板 24V 电源 ← dc_uv ──
        { from: 'dc_uv_wire_p', to: 'genpanel_wire_p24_p', type: 'wire' },
        { from: 'dc_uv_wire_n', to: 'genpanel_wire_p24_n', type: 'wire' },
    ];
    cons.forEach(c => sys.connMgr.addConn(c));
    sys.redrawAll();
}

export function initSlider(_sys) {
}

export function applyAllPresets() {
    const sys = this && this.sys ? this.sys : window.sys;
    if (!sys) return;
    _autoWire(sys);
}

export async function applyStartSystem() {
    const sys = this && this.sys ? this.sys : window.sys;
    if (!sys) return;
    _autoWire(sys);
    // 起动发电机
    const gen = sys.comps.gen1;
    if (gen) gen.isOn = true;
}

export function fiveStep() {
}
