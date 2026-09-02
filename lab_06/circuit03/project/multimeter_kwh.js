// 电能表仿真工程 — 交流电源经电能表测量白炽灯负载消耗的电能
// 电路：AC L → 电能表 I+ → I- → 白炽灯(4.84Ω) → AC N → GND
//        电能表 U+ 并联于 I+ 侧，U- 并联于负载输出端
// 白炽灯：R=4.84Ω, 220V 下 10kW, 6min 一度电, 1min 约 0.17kWh

import { ACPower } from '../components/ACPower.js';
import { Ground } from '../components/Gnd.js';
import { IncandescentLamp } from '../components/IncandescentLamp.js';
import { KwhMeter } from '../components/KwhMeter.js';
import { Multimeter } from '../components/Multimeter.js';
import { MF47Multimeter } from '../components/MF47Multimeter.js';
import { Oscilloscope_tri } from '../components/Osc_tri.js';
import { SignalGenerator } from '../components/SignalGenerator.js';
import { ProcessCalibrator } from '../components/ProcessCalibrator.js';
import { ElecMeter } from '../components/ElecMeter.js';

export const FAULT_CONFIGS = {};

export const PROJECT_WORKFLOWS = {
    'kwh-basic': {
        id: 'kwh-basic',
        name: '1. 电能表测量白炽灯能耗',
        steps: [
            {
                msg: '1. 电路接线：连接交流电源 → 电能表 I+ → I- → 白炽灯 → 接地，交流电源负极也接地',
                mode: 'check',
                act() {
                    _presetStep1(this.sys);
                },
                check() {
                    const _c = (a, b) => this.sys.isPortConnected(a, b);
                    return _c('ac_wire_p', 'kwh_wire_ip')
                        && _c('kwh_wire_in', 'lamp1_wire_l')
                        && _c('lamp1_wire_r', 'gnd1_wire_gnd')
                        && _c('ac_wire_n', 'gnd1_wire_gnd');
                },
            },
            {
                msg: '2. 电能表电压线圈接入：U+ 接 I+ 侧，U- 接白炽灯出线端',
                mode: 'check',
                act() {
                    _presetStep2(this.sys);
                },
                check() {
                    const _c = (a, b) => this.sys.isPortConnected(a, b);
                    return _c('ac_wire_p', 'kwh_wire_ip')
                        && _c('kwh_wire_in', 'lamp1_wire_l')
                        && _c('kwh_wire_up', 'kwh_wire_ip')
                        && _c('kwh_wire_un', 'lamp1_wire_r')
                        && _c('lamp1_wire_r', 'gnd1_wire_gnd')
                        && _c('ac_wire_n', 'gnd1_wire_gnd');
                },
            },
            {
                msg: '3. 接通电源（交流 220V/50Hz），观察电能表铝盘转动和电量累计',
                mode: 'check',
                act() {
                    const ac = this.sys.comps['ac'];
                    if (ac) { ac.isOn = true; ac.voltageRMS = 220; ac.frequency = 50; ac.update(); }
                },
                check() {
                    const ac = this.sys.comps['ac'];
                    return ac && ac.isOn;
                },
            },
            {
                msg: '4. 通电后电能表开始累计电能。白炽灯功率 P=10kW，每分钟约 0.17kWh。观察滚轮计数器变化',
                mode: 'check',
                act() {},
                check() {
                    const kwh = this.sys.comps['kwh'];
                    return kwh && (kwh._energy > 0.2 || kwh._clicked);
                },
            },
            {
                msg: '5. 测试题：电能计量计算',
                mode: 'quiz',
                quizConfig: {
                    question: '220V/10kW 的白炽灯连续工作 3 小时，电能表应记录多少 kWh？',
                    options: [
                        '10 kWh',
                        '20 kWh',
                        '30 kWh',
                        '40 kWh',
                    ],
                    answer: 2,
                    analysis: '电能 = 功率 × 时间 = 10kW × 3h = 30kWh。' +
                        '电能表通过累计瞬时功率对时间的积分来计量电能消耗。',
                },
            },
        ],
    },
};

export const componentConfigs = [
    { Class: ACPower, id: 'ac', x: 10, y: 450, voltageRMS: 220, frequency: 50, isOn: false },
    { Class: KwhMeter, id: 'kwh', x: 20, y: 80 },
    { Class: IncandescentLamp, id: 'lamp1', x: 620, y: 580, coldResistance: 4.84 },
    { Class: Ground, id: 'gnd1', x: 90, y: 750 },

    { Class: Multimeter, id: 'multimeter', x: 650, y: 30, scale: 1.1, visible: false },
    { Class: MF47Multimeter, id: 'mf47-panel', x: 650, y: 30, visible: false },
    { Class: Oscilloscope_tri, id: 'osc', x: 650, y: 260, visible: false },
    { Class: SignalGenerator, id: 'sg', x: 80, y: 400, visible: false },
    { Class: ProcessCalibrator, id: 'cali', x: 550, y: 400, visible: false },
    { Class: ElecMeter, id: 'elecmeter', x: 350, y: 30, visible: false },
];

function _presetStep1(sys) {
    const cons = [
        { from: 'ac_wire_p', to: 'kwh_wire_ip', type: 'wire' },
        { from: 'kwh_wire_in', to: 'lamp1_wire_l', type: 'wire' },
        { from: 'lamp1_wire_r', to: 'gnd1_wire_gnd', type: 'wire' },
        { from: 'ac_wire_n', to: 'gnd1_wire_gnd', type: 'wire' },
    ];
    cons.forEach(c => sys.connMgr.addConn(c));
}

function _presetStep2(sys) {
    const toRemove = sys.conns.findIndex(c =>
        (c.from === 'ac_wire_p' && c.to === 'kwh_wire_ip') ||
        (c.from === 'kwh_wire_ip' && c.to === 'ac_wire_p'));
    if (toRemove >= 0) sys.conns.splice(toRemove, 1);
    const cons = [
        { from: 'ac_wire_p', to: 'kwh_wire_ip', type: 'wire' },
        { from: 'kwh_wire_in', to: 'lamp1_wire_l', type: 'wire' },
        { from: 'kwh_wire_up', to: 'kwh_wire_ip', type: 'wire' },
        { from: 'kwh_wire_un', to: 'lamp1_wire_r', type: 'wire' },
        { from: 'lamp1_wire_r', to: 'gnd1_wire_gnd', type: 'wire' },
        { from: 'ac_wire_n', to: 'gnd1_wire_gnd', type: 'wire' },
    ];
    cons.forEach(c => sys.connMgr.addConn(c));
}

export function initSlider(_sys) {}

export function applyAllPresets() {
    _presetStep1(this.sys);
}

export async function applyStartSystem() {
    _presetStep2(this.sys);
    const ac = this.sys.comps['ac'];
    if (ac) { ac.isOn = true; ac.voltageRMS = 220; ac.frequency = 50; ac.update(); }
}

export function fiveStep() {
    const sys = this && this.sys ? this.sys : window.sys;
    if (!sys) return;
}
