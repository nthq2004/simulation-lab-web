// 船舶发电机主开关仿真工程（同步发电机 + 汇流排 + 船用框架式空气断路器）

import { SyncGenerator3P } from '../components/SyncGenerator3P.js';
import { Busbar3P } from '../components/Busbar3P.js';
import { MarineMainsSwitch } from '../components/MarineMainsSwitch.js';
import { GeneratorRemotePanel } from '../components/GeneratorRemotePanel.js';
import { ShipAutoControl } from '../components/ShipAutoControl.js';
import { ThreePhaseLoad } from '../components/ThreePhaseLoad.js';
import { DCPower } from '../components/DCPower.js';
import { Ground } from '../components/Gnd.js';
import { DiagramThreePhaseACB } from '../components/DiagramThreePhaseACB.js';
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
    { Class: SyncGenerator3P, id: 'gen1', x: -100, y: 700, vRms: 230, freq: 50, isOn: false, mode: 'remote', label: '同步发电机', ratedPower: 400, ratedVoltage: 400, ratedCosPhi: 0.8, rOn: 0.005, visible: true },
    { Class: MarineMainsSwitch, id: 'qf1', x: -160, y: 250, ratedCtrlVoltage: 24, label: '主开关',  visible: true },
    { Class: GeneratorRemotePanel, id: 'genpanel', x: 480, y: 700, genId: 'gen1', qfId: 'qf1', label: '发电机组遥控面板', visible: true },

    // ── 2号机组：2号同步发电机 → 2号主开关 → 汇流排 ──
    { Class: SyncGenerator3P, id: 'gen2', x: 850, y: 700, vRms: 230, freq: 50, isOn: false, mode: 'remote', label: '同步发电机2', ratedPower: 400, ratedVoltage: 400, ratedCosPhi: 0.8, rOn: 0.005, visible: true },
    { Class: MarineMainsSwitch, id: 'qf2', x: 1100, y: 150, ratedCtrlVoltage: 24, label: '主开关2',  visible: true },
    { Class: GeneratorRemotePanel, id: 'genpanel2', x: 1430, y: 700, genId: 'gen2', qfId: 'qf2', label: '2号发电机组遥控面板', visible: true },
    { Class: DCPower, id: 'dc_uv2', x: 1860, y: 180, voltage: 24, isOn: true, label: '失压脱扣电源2', visible: true },
    { Class: Busbar3P, id: 'bus1', x: 220, y: 30, tapsPerPhase: 6, label: '汇流排', visible: true },
    // 发电机中性点接地
    { Class: Ground, id: 'gnd1', x: 0, y: 1000, visible: true },



    // ── 控制电源（DC 24V）：失压脱扣线圈 ──
    { Class: DCPower, id: 'dc_uv', x: 600, y: 480, voltage: 24, isOn: true, label: '失压脱扣电源', visible: true },

    // ── 船舶电站自动控制系统（自动起动/并车/解列/调频）──
    { Class: ShipAutoControl, id: 'auto_ctl', x: 700, y: 160, genIds: 'gen1,gen2', qfIds: 'qf1,qf2', panelIds: 'genpanel,genpanel2', auto: 'manual', seq: '123', parallelKw: 80, decoupleKw: 30, label: '船舶电站自动控制模块', visible: true },

    // ── 汇流排馈出支路 ──
    // 支路1（第8列）：三相空气开关 QF3 → 三盏白炽灯（分别接 L1/L2/L3）
    { Class: DiagramThreePhaseACB, id: 'acb_l', x: 1826, y: 480, initState: 'off', label: 'QF3', ratedVoltage: 380, ratedCurrent: 100, tripCurrent: 10, visible: true },
    { Class: IncandescentLamp, id: 'lamp1', x: 1850, y: 670, coldResistance: 484, rotation: 90 },
    { Class: IncandescentLamp, id: 'lamp2', x: 1920, y: 670, coldResistance: 484, rotation: 90 },
    { Class: IncandescentLamp, id: 'lamp3', x: 1990, y: 670, coldResistance: 484, rotation: 90 },
    { Class: Ground, id: 'gnd_l', x: 1950, y: 890, visible: true },

    // ── 支路2（第7列）：三相可调负载模块（电路右上角，直接接汇流排）──
    { Class: ThreePhaseLoad, id: 'load3', x: 990, y: 420, powerKw: 350, cosPhi: 0.9, reactive: 'ind', loaded: false, label: '三相可调负载', visible: true },

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
        { from: 'gen1_wire_w', to: 'qf1_wire_t3', type: 'wire' },
        { from: 'qf1_wire_l1', to: 'bus1_wire_l1_1', type: 'wire' },
        { from: 'qf1_wire_l2', to: 'bus1_wire_l2_1', type: 'wire' },
        { from: 'qf1_wire_l3', to: 'bus1_wire_l3_1', type: 'wire' },
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
        // ── 2号机组：gen2 → qf2 → 汇流排（第2列）──
        { from: 'gen2_wire_u', to: 'qf2_wire_t1', type: 'wire' },
        { from: 'gen2_wire_v', to: 'qf2_wire_t2', type: 'wire' },
        { from: 'gen2_wire_w', to: 'qf2_wire_t3', type: 'wire' },
        { from: 'qf2_wire_l1', to: 'bus1_wire_l1_2', type: 'wire' },
        { from: 'qf2_wire_l2', to: 'bus1_wire_l2_2', type: 'wire' },
        { from: 'qf2_wire_l3', to: 'bus1_wire_l3_2', type: 'wire' },

        // ── 2号机组控制电源（dc_uv2）：失压线圈 / 储能电机 / 遥控面板 ──
        { from: 'dc_uv2_wire_p', to: 'qf2_wire_uv1', type: 'wire' },
        { from: 'dc_uv2_wire_n', to: 'qf2_wire_uv2', type: 'wire' },
        { from: 'dc_uv2_wire_p', to: 'qf2_wire_m1', type: 'wire' },
        { from: 'dc_uv2_wire_n', to: 'qf2_wire_m2', type: 'wire' },
        // ── 2号机组遥控面板 → gen2 / qf2 ──
        { from: 'genpanel2_wire_start_a', to: 'gen2_wire_rm_start_a', type: 'wire' },
        { from: 'genpanel2_wire_start_b', to: 'gen2_wire_rm_start_b', type: 'wire' },
        { from: 'genpanel2_wire_stop_a', to: 'gen2_wire_rm_stop_a', type: 'wire' },
        { from: 'genpanel2_wire_stop_b', to: 'gen2_wire_rm_stop_b', type: 'wire' },
        { from: 'genpanel2_wire_spd_p', to: 'gen2_wire_freq_in_p', type: 'wire' },
        { from: 'genpanel2_wire_spd_n', to: 'gen2_wire_freq_in_n', type: 'wire' },
        { from: 'genpanel2_wire_close_a', to: 'qf2_wire_c1', type: 'wire' },
        { from: 'genpanel2_wire_close_b', to: 'qf2_wire_c2', type: 'wire' },
        { from: 'genpanel2_wire_open_a', to: 'qf2_wire_fla', type: 'wire' },
        { from: 'genpanel2_wire_open_b', to: 'qf2_wire_flb', type: 'wire' },
        { from: 'dc_uv2_wire_p', to: 'genpanel2_wire_p24_p', type: 'wire' },
        { from: 'dc_uv2_wire_n', to: 'genpanel2_wire_p24_n', type: 'wire' },
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
        // ── 船舶电站自动控制系统：母线采集（第5列）──
        { from: 'auto_ctl_wire_bus_a', to: 'bus1_wire_l1_5', type: 'wire' },
        { from: 'auto_ctl_wire_bus_b', to: 'bus1_wire_l2_5', type: 'wire' },
        // ── 自动控制系统 24V 电源 ← dc_uv ──
        { from: 'auto_ctl_wire_p24_p', to: 'dc_uv_wire_p', type: 'wire' },
        { from: 'auto_ctl_wire_p24_n', to: 'dc_uv_wire_n', type: 'wire' },
        // ── 自动控制系统 → 1号机组遥控面板（通信接口）──
        { from: 'auto_ctl_wire_comm1_a', to: 'genpanel_wire_com_a', type: 'wire' },
        { from: 'auto_ctl_wire_comm1_b', to: 'genpanel_wire_com_b', type: 'wire' },
        // ── 自动控制系统 → 2号机组遥控面板（通信接口）──
        { from: 'auto_ctl_wire_comm2_a', to: 'genpanel2_wire_com_a', type: 'wire' },
        { from: 'auto_ctl_wire_comm2_b', to: 'genpanel2_wire_com_b', type: 'wire' },
        // ── 三相可调负载：汇流排第7端口 → load3（右上角），中性点接地 ──
        { from: 'bus1_wire_l1_7', to: 'load3_wire_l1', type: 'wire' },
        { from: 'bus1_wire_l2_7', to: 'load3_wire_l2', type: 'wire' },
        { from: 'bus1_wire_l3_7', to: 'load3_wire_l3', type: 'wire' },
        { from: 'load3_wire_n', to: 'gnd_l_wire_gnd', type: 'wire' },
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
