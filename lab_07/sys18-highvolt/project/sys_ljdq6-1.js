// 船舶发电机主开关仿真工程（同步发电机 + 汇流排 + 船用框架式空气断路器）

import { SyncGenerator3P } from '../components/SyncGenerator3P.js';
import { Busbar3P } from '../components/Busbar3P.js';
import { VacuumCircuitBreaker } from '../components/VacuumCircuitBreaker.js';
import { EmergencyGenerator3P } from '../components/EmergencyGenerator3P.js';
import { EmergencyMainsSwitch } from '../components/EmergencyMainsSwitch.js';
import { TieSwitch } from '../components/TieSwitch.js';
import { EmergencyPanel } from '../components/EmergencyPanel.js';
import { GeneratorRemotePanel } from '../components/GeneratorRemotePanel.js';
import { DCPower } from '../components/DCPower.js';
import { Ground } from '../components/Gnd.js';
import { DistributionBox } from '../components/DistributionBox.js';
import { IncandescentLamp } from '../components/IncandescentLamp.js';
import { Multimeter } from '../components/Multimeter.js';
import { MF47Multimeter } from '../components/MF47Multimeter.js';
import { Oscilloscope_tri } from '../components/Osc_tri.js';
import { SignalGenerator } from '../components/SignalGenerator.js';
import { ProcessCalibrator } from '../components/ProcessCalibrator.js';
import { ElecMeter } from '../components/ElecMeter.js';

function _fcomp(id) {
    const s = window.sys;
    return s && s.comps && s.comps[id] ? s.comps[id] : null;
}

export const FAULT_CONFIGS = {

};

export const PROJECT_WORKFLOWS = {

};

export const componentConfigs = [
    // ── 主回路：同步发电机 → 主开关 → 汇流排 ──
    { Class: SyncGenerator3P, id: 'gen1', x: -120, y: 700, vRms: 230, freq: 50, isOn: false, mode: 'remote', label: '1#同步发电机', ratedPower: 80, ratedVoltage: 400, ratedCosPhi: 0.8, maxDropV: 200, avrMaxComp: 1, avrDelay: 2, avrTime: 5, autoDecoupleTrim: true, visible: true },
    { Class: VacuumCircuitBreaker, id: 'qf1', x: -120, y: 180, ratedCtrlVoltage: 24, label: '主开关', genId: 'gen1', revPowerKw: 8, revTime: 5, faultSimpleProtect: true, visible: true },
    { Class: GeneratorRemotePanel, id: 'genpanel', x: 360, y: 700, genId: 'gen1', qfId: 'qf1', label: '1#发电机组遥控面板', busId: 'bus1', visible: true },

    { Class: Busbar3P, id: 'bus1', x: -120, y: 30, portsPerBar: 6, label: '汇流排', visible: true },
    // ── 应急汇流排：紧邻主汇流排右侧，3 个端口 ──
    { Class: Busbar3P, id: 'bus2', x: 1280, y: 30, portsPerBar: 3, label: '应急汇流排', visible: true },

    // ── 应急负载：主汇流排与应急汇流排中间，三个星型连接的白炽灯（接应急汇流排第1接口）──
    { Class: IncandescentLamp, id: 'el1', x: 1060, y: 70, label: '应急灯1', coldResistance: 48.4, visible: true ,rotation:90},
    { Class: IncandescentLamp, id: 'el2', x: 1130, y: 110, label: '应急灯2', coldResistance: 48.4, visible: true ,rotation:90},
    { Class: IncandescentLamp, id: 'el3', x: 1200, y: 150, label: '应急灯3', coldResistance: 48.4, visible: true ,rotation:90},
    // ── 应急发电机主开关：应急汇流排与应急发电机之间 ──
    { Class: EmergencyMainsSwitch, id: 'eqf1', x: 1550, y: 180, ratedCtrlVoltage: 24, genId: 'egen1', faultSimpleProtect: true, label: '应急发电机主开关', visible: true },
    // ── 应急发电机组件：位于主开关下方，经 eqf1 接入 bus2 ──
    { Class: EmergencyGenerator3P, id: 'egen1', x: 1650, y: 650, isOn: false, mode: 'remote', label: '应急发电机组', ratedPower: 50, ratedVoltage: 400, ratedCosPhi: 0.8, freq: 50, visible: true },

    // ── 1号机组控制电源共地（遥控面板与控制电源的中间下方）──
    // dc_uv 负极、genpanel p24_n 共同接此接地，不再向线圈引出负极线
    { Class: Ground, id: 'gnd1_uv', x: 590, y: 1000, label: '控制电源接地', visible: true },
    // ── 1号主开关线圈接地（主开关右下角）──
    // 储能电机 m2 / 失压 uv2 / 合闸 c2 / 分励 flb 负端均接此接地
    { Class: Ground, id: 'gnd1_qf', x: 660, y: 400, label: '线圈接地', visible: true },
    // ── 1号遥控面板信号接地（面板上方）──
    // 合闸输出 close_b、分闸输出 open_b 负端接地
    { Class: Ground, id: 'gnd1_panel', x: 530, y: 670, label: '信号接地', visible: true },

    // ── 控制电源（DC 24V）：失压脱扣线圈 ──
    { Class: DCPower, id: 'dc_uv', x: 660, y: 750, voltage: 24, isOn: true, label: '失压脱扣电源', visible: true },

    // ── 应急主开关控制电源（DC 24V）与接地：独立配置，不与 1号机共用 ──
    { Class: DCPower, id: 'dc_eqf', x: 1850, y: 350, voltage: 24, isOn: true, label: '应急控制电源', visible: true },
    // ── 应急24V电源接地（应急控制电源下方）──
    // 失压 uv2 / 储能电机 m2 负端、电源负端均接此接地
    { Class: Ground, id: 'gnd_eqf', x: 1900, y: 600, label: '应急电源接地', visible: true },
    // ── 联络开关线圈接地（独立接地，不与应急电源共用）──
    // 联络开关合闸 c2 / 分励 flb 负端、应急配电板联络输出负端均接此接地
    { Class: Ground, id: 'gnd_tie', x: 1350, y: 530, label: '联络线圈接地', visible: true },
    // ── 应急配电板线圈接地（独立接地，驱动应急主开关合/分励线圈回路）──
    // 应急主开关合闸 c2 / 分励 flb 负端、应急配电板应急输出负端均接此接地
    { Class: Ground, id: 'gnd_ep', x: 1600, y: 620, label: '配电板线圈接地', visible: true },

    // ── 低压三相配电箱（进线接汇流排第6口，出线由学员自行连接）──
    { Class: DistributionBox, id: 'pdb1', x: 700, y: 220, label: '低压配电箱', ratedCurrent: 100, shortDelay: 0.2, overloadK: 4, tripCoilR: 200, initStates: ['off', 'off', 'on'], visible: true },

    // ── 联络开关：上端接应急汇流排（bus2 第2口），下端接配电箱第3路输出 ──
    { Class: TieSwitch, id: 'tie1', x: 1490, y: 220, label: '联络开关', ratedVoltage: 400, ratedCurrent: 100, tripCurrent: 10, visible: true, rotation: 90 },

    // ── 应急配电板：自动控制应急发电机、应急主开关和联络开关 ──
    { Class: EmergencyPanel, id: 'ep1', x: 1200, y: 600, label: '应急配电板', genId: 'egen1', eqfId: 'eqf1', tieId: 'tie1', visible: true },

    { Class: Multimeter, id: 'multimeter', x: 920, y: 100, visible: false },
    { Class: MF47Multimeter, id: 'mf47-panel', x: 1050, y: 150, visible: false },
    { Class: Oscilloscope_tri, id: 'osc', x: 50, y: 50, visible: false },
    { Class: SignalGenerator, id: 'sg', x: 50, y: 50, visible: false },
    { Class: ProcessCalibrator, id: 'cali', x: 50, y: 50, visible: false },
    { Class: ElecMeter, id: 'elecmeter', x: 50, y: 50, visible: false },
];

// ─── 接线辅助 ───

const _sleep = ms => new Promise(r => setTimeout(r, ms));

// 模拟按住遥控面板按钮（btnKey: _userStartPressed / _userStopPressed / _userClosePressed / _userOpenPressed）
async function _pressPanelBtn(sys, pid, btnKey, ms = 900) {
    const gp = sys.comps[pid];
    if (!gp || !(btnKey in gp)) return;
    gp[btnKey] = true;
    await _sleep(ms);
    gp[btnKey] = false;
}

function _autoWire(sys) {
    sys.conns.length = 0;
    const cons = [
        // ── 主回路：同步发电机 → 主开关 → 汇流排（第2口）──
        { from: 'gen1_wire_u', to: 'qf1_wire_t1', type: 'wire' },
        { from: 'gen1_wire_v', to: 'qf1_wire_t2', type: 'wire' },
        { from: 'gen1_wire_w', to: 'qf1_wire_t3', type: 'wire' },
        { from: 'qf1_wire_l1', to: 'bus1_wire_l1_2', type: 'wire' },
        { from: 'qf1_wire_l2', to: 'bus1_wire_l2_2', type: 'wire' },
        { from: 'qf1_wire_l3', to: 'bus1_wire_l3_2', type: 'wire' },
        // ── 低压配电箱：汇流排第6口三相进线 ──
        { from: 'bus1_wire_l1_6', to: 'pdb1_wire_in1', type: 'wire' },
        { from: 'bus1_wire_l2_6', to: 'pdb1_wire_in2', type: 'wire' },
        { from: 'bus1_wire_l3_6', to: 'pdb1_wire_in3', type: 'wire' },
        // ── 应急负载：三个星型连接白炽灯 ← 应急汇流排第1接口（L1/L2/L3）──
        { from: 'bus2_wire_l1_1', to: 'el1_wire_l', type: 'wire' },
        { from: 'bus2_wire_l2_1', to: 'el2_wire_l', type: 'wire' },
        { from: 'bus2_wire_l3_1', to: 'el3_wire_l', type: 'wire' },
        // 星点互连（中性点，三灯 R 端相连）
        { from: 'el1_wire_r', to: 'el2_wire_r', type: 'wire' },
        { from: 'el2_wire_r', to: 'el3_wire_r', type: 'wire' },
        // ── 应急发电机主回路：egen1 → eqf1(T端) → bus2 应急汇流排（第3口）──
        { from: 'egen1_wire_u', to: 'eqf1_wire_t1', type: 'wire' },
        { from: 'egen1_wire_v', to: 'eqf1_wire_t2', type: 'wire' },
        { from: 'egen1_wire_w', to: 'eqf1_wire_t3', type: 'wire' },
        { from: 'eqf1_wire_l1', to: 'bus2_wire_l1_3', type: 'wire' },
        { from: 'eqf1_wire_l2', to: 'bus2_wire_l2_3', type: 'wire' },
        { from: 'eqf1_wire_l3', to: 'bus2_wire_l3_3', type: 'wire' },
        // ── 联络开关：上端接应急汇流排（bus2 第2口），下端接配电箱第3路输出 ──
        // 分励/合闸线圈暂不接线，当前为断开状态
        { from: 'tie1_wire_l1', to: 'bus2_wire_l1_2', type: 'wire' },
        { from: 'tie1_wire_l2', to: 'bus2_wire_l2_2', type: 'wire' },
        { from: 'tie1_wire_l3', to: 'bus2_wire_l3_2', type: 'wire' },
        { from: 'tie1_wire_t1', to: 'pdb1_wire_sw3_t1', type: 'wire' },
        { from: 'tie1_wire_t2', to: 'pdb1_wire_sw3_t2', type: 'wire' },
        { from: 'tie1_wire_t3', to: 'pdb1_wire_sw3_t3', type: 'wire' },
        // ── 应急配电板接线 ──
        // 检测端口：接配电箱第3路出口（sw3_t1/t2），检测主配电板是否失电
        { from: 'ep1_wire_det_a', to: 'pdb1_wire_sw3_t2', type: 'wire' },
        { from: 'ep1_wire_det_b', to: 'pdb1_wire_sw3_t1', type: 'wire' },
        // 联络开关控制：合闸线圈 c1/c2、分励线圈 fla/flb（线圈负端接独立接地 gnd_tie）
        { from: 'ep1_wire_tie_close_a', to: 'tie1_wire_c1', type: 'wire' },
        { from: 'ep1_wire_tie_close_b', to: 'gnd_tie_wire_gnd', type: 'wire' },
        { from: 'ep1_wire_tie_open_a',  to: 'tie1_wire_fla', type: 'wire' },
        { from: 'ep1_wire_tie_open_b',  to: 'gnd_tie_wire_gnd', type: 'wire' },
        { from: 'tie1_wire_c2',  to: 'gnd_tie_wire_gnd', type: 'wire' },
        { from: 'tie1_wire_flb', to: 'gnd_tie_wire_gnd', type: 'wire' },
        // 失压线圈：由应急控制电源 dc_eqf（24V）供电，负端接联络线圈接地 gnd_tie
        { from: 'dc_eqf_wire_p',  to: 'tie1_wire_uv1', type: 'wire' },
        { from: 'tie1_wire_uv2',  to: 'gnd_tie_wire_gnd', type: 'wire' },
        // 应急主开关控制：合闸线圈 c1/c2、分励线圈 fla/flb（线圈负端接独立接地 gnd_ep）
        { from: 'ep1_wire_eqf_close_a', to: 'eqf1_wire_c1', type: 'wire' },
        { from: 'ep1_wire_eqf_close_b', to: 'gnd_ep_wire_gnd', type: 'wire' },
        { from: 'ep1_wire_eqf_open_a',  to: 'eqf1_wire_fla', type: 'wire' },
        { from: 'ep1_wire_eqf_open_b',  to: 'gnd_ep_wire_gnd', type: 'wire' },
        { from: 'eqf1_wire_c2',  to: 'gnd_ep_wire_gnd', type: 'wire' },
        { from: 'eqf1_wire_flb', to: 'gnd_ep_wire_gnd', type: 'wire' },
        // 应急发电机遥控：起动/停止/调频
        { from: 'ep1_wire_egen_start_a', to: 'egen1_wire_rm_start_a', type: 'wire' },
        { from: 'ep1_wire_egen_start_b', to: 'egen1_wire_rm_start_b', type: 'wire' },
        { from: 'ep1_wire_egen_stop_a',  to: 'egen1_wire_rm_stop_a', type: 'wire' },
        { from: 'ep1_wire_egen_stop_b',  to: 'egen1_wire_rm_stop_b', type: 'wire' },
        { from: 'ep1_wire_egen_freq_p',  to: 'egen1_wire_freq_in_p', type: 'wire' },
        { from: 'ep1_wire_egen_freq_n',  to: 'egen1_wire_freq_in_n', type: 'wire' },
        // ── 应急发电机主开关控制回路：独立控制电源 dc_eqf 供电，负端接 gnd_eqf ──
        { from: 'dc_eqf_wire_p', to: 'eqf1_wire_uv1', type: 'wire' },
        { from: 'dc_eqf_wire_p', to: 'eqf1_wire_m1', type: 'wire' },
        { from: 'eqf1_wire_uv2', to: 'gnd_eqf_wire_gnd', type: 'wire' },
        { from: 'eqf1_wire_m2', to: 'gnd_eqf_wire_gnd', type: 'wire' },
        // ── 控制电源：DC 24V → 失压脱扣线圈 / 储能电机 正端；负端均接地 ──
        { from: 'dc_uv_wire_p', to: 'qf1_wire_uv1', type: 'wire' },
        { from: 'dc_uv_wire_p', to: 'qf1_wire_m1', type: 'wire' },
        { from: 'dc_eqf_wire_n', to: 'gnd_eqf_wire_gnd', type: 'wire' },        
        // 线圈负端接地（gnd1_qf，主开关右下角）
        { from: 'qf1_wire_uv2', to: 'gnd1_qf_wire_gnd', type: 'wire' },
        { from: 'qf1_wire_m2', to: 'gnd1_qf_wire_gnd', type: 'wire' },
        // ── 发电机组遥控面板：左面板 → gen1 遥控端口 ──
        { from: 'genpanel_wire_start_a', to: 'gen1_wire_rm_start_a', type: 'wire' },
        { from: 'genpanel_wire_start_b', to: 'gen1_wire_rm_start_b', type: 'wire' },
        { from: 'genpanel_wire_stop_a', to: 'gen1_wire_rm_stop_a', type: 'wire' },
        { from: 'genpanel_wire_stop_b', to: 'gen1_wire_rm_stop_b', type: 'wire' },
        { from: 'genpanel_wire_spd_p', to: 'gen1_wire_freq_in_p', type: 'wire' },
        { from: 'genpanel_wire_spd_n', to: 'gen1_wire_freq_in_n', type: 'wire' },
        // 合闸/分闸正端 → 线圈正端；输出负端接地（gnd1_panel，面板上方）、线圈负端接地（gnd1_qf）
        { from: 'genpanel_wire_close_a', to: 'qf1_wire_c1', type: 'wire' },
        { from: 'genpanel_wire_open_a', to: 'qf1_wire_fla', type: 'wire' },
        { from: 'genpanel_wire_close_b', to: 'gnd1_panel_wire_gnd', type: 'wire' },
        { from: 'genpanel_wire_open_b', to: 'gnd1_panel_wire_gnd', type: 'wire' },
        { from: 'qf1_wire_c2', to: 'gnd1_qf_wire_gnd', type: 'wire' },
        { from: 'qf1_wire_flb', to: 'gnd1_qf_wire_gnd', type: 'wire' },
        // ── 左面板 24V 电源 ← dc_uv（正端）；负端接地（gnd1_uv，面板与控制电源中间下方）──
        { from: 'dc_uv_wire_p', to: 'genpanel_wire_p24_p', type: 'wire' },
        { from: 'dc_uv_wire_n', to: 'gnd1_uv_wire_gnd', type: 'wire' },
        { from: 'genpanel_wire_p24_n', to: 'gnd1_uv_wire_gnd', type: 'wire' },
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
    // 起动发电机前先完整复位（防止上次流程残留的极端设定/开关状态
    // 导致加载系统时发电机运行状态异常）：
    // 设定频率归位 50Hz；1 号机投入运行；主开关分闸。
    const g1 = sys.comps.gen1;
    if (g1) { g1.freq = 50; g1.isOn = true; }
    const q1 = sys.comps.qf1;
    if (q1 && q1.getState() === 'on' && q1.tryTrip) q1.tryTrip();
    // 应急发电机：停机状态，频率 50Hz，控制方式远程（由应急配电板控制）
    const eg1 = sys.comps.egen1;
    if (eg1) { eg1.freq = 50; eg1.isOn = false; eg1.mode = 'remote'; }
    // 应急发电机主开关：分闸复位，恢复储能
    const eq1 = sys.comps.eqf1;
    if (eq1) {
        if (eq1.getState() === 'on' && eq1.tryTrip) eq1.tryTrip();
        if (eq1._chargeProg !== undefined) { eq1._chargeProg = 5; eq1._charged = true; }
    }
    // 联络开关：分闸复位
    const t1 = sys.comps.tie1;
    if (t1 && t1.getState() === 'on' && t1.tryTrip) t1.tryTrip();
    // 应急配电板：复位状态机为 idle，模式切回自动
    const ep = sys.comps.ep1;
    if (ep) { ep._phase = 'idle'; ep._timer = 0; ep._manualTieTimer = 0; ep._mode = 'auto'; ep._tiePosition = 'normal'; }
}

export function fiveStep() {
}
