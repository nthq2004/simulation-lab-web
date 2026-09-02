// 功率表仿真工程 — 交流电源经电阻+电感串联负载，功率表测量电阻有功功率
// 电路：AC L → 功率表 I+ → 电阻 40Ω → 电感 0.0955H(30Ω) → 功率表 I- → AC N → GND
//       功率表 U+ 并联于电阻左端，U- 并联于电阻右端

import { ACPower } from '../components/ACPower.js';
import { Ground } from '../components/Gnd.js';
import { Resistor } from '../components/Resistor.js';
import { Inductor } from '../components/Inductor.js';
import { Wattmeter } from '../components/Wattmeter.js';
import { Multimeter } from '../components/Multimeter.js';
import { MF47Multimeter } from '../components/MF47Multimeter.js';
import { Oscilloscope_tri } from '../components/Osc_tri.js';
import { SignalGenerator } from '../components/SignalGenerator.js';
import { ProcessCalibrator } from '../components/ProcessCalibrator.js';
import { ElecMeter } from '../components/ElecMeter.js';
import { GeneratorFrequencyMeter } from '../components/FrequencyMeter.js';

export const FAULT_CONFIGS = {};

export const PROJECT_WORKFLOWS = {
    'power-basic': {
        id: 'power-basic',
        name: '1. 单相交流电路有功功率测量',
        steps: [
            {
                msg: '1. 电路接线：连接交流电源 → 电阻 → 电感 → 接地，交流电源负极也接地',
                mode: 'check',
                act() {
                    _presetStep1(this.sys);
                },
                check() {
                    const _c = (a, b) => this.sys.isPortConnected(a, b);
                    return _c('ac_wire_p', 'r1_wire_l')
                        && _c('r1_wire_r', 'l1_wire_l')
                        && _c('l1_wire_r', 'gnd1_wire_gnd')
                        && _c('ac_wire_n', 'gnd1_wire_gnd');
                },
            },
            {
                msg: '2. 功率表接入：电源正极接到 I+，I- 接到负载进线，U+ 接到 I+，U- 接到负载出线',
                mode: 'check',
                act() {
                    _presetStep2(this.sys);
                },
                check() {
                    const _c = (a, b) => this.sys.isPortConnected(a, b);
                    return _c('ac_wire_p', 'watt1_wire_ip')
                        && _c('watt1_wire_in', 'r1_wire_l')
                        && _c('watt1_wire_up', 'watt1_wire_ip')
                        && _c('watt1_wire_un', 'l1_wire_r')
                        && _c('r1_wire_r', 'l1_wire_l')
                        && _c('l1_wire_r', 'gnd1_wire_gnd')
                        && _c('ac_wire_n', 'gnd1_wire_gnd');
                },
            },
            {
                msg: '3. 接通电源（交流 220V/50Hz），观察功率表指针偏转及功率显示',
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
                msg: '4. 将电源电压调到 100V，观察功率指示',
                mode: 'check',
                act() {
                    const ac = this.sys.comps['ac'];
                    if (ac) { ac.isOn = true; ac.voltageRMS = 100; ac.frequency = 50; ac.update(); }
                },
                check() {
                    const ac = this.sys.comps['ac'];
                    return ac && ac.isOn && Math.abs(ac.voltageRMS - 100) < 1;
                },
            },
            {
                msg: '5. 测试题：有功功率的计算',
                mode: 'quiz',
                quizConfig: {
                    question: '在 R-L 串联电路中，R=40Ω，XL=30Ω，U=100V，此时电阻消耗的有功功率 P 为多少？',
                    options: [
                        '200 W',
                        '160 W',
                        '125 W',
                        '250 W',
                    ],
                    answer: 1,
                    analysis: '总阻抗 Z = √(R²+XL²) = √(1600+900) = 50Ω，' +
                        '电流 I = U / Z = 100 / 50 = 2A，' +
                        '有功功率 P = I²R = 2² × 40 = 160 W。',
                },
            },
        ],
    },
    'power-digital': {
        id: 'power-digital',
        name: '2. 数字功率计测量有功功率',
        steps: [
            {
                msg: '1. 电路接线：连接交流电源 → 电阻 → 电感 → 接地，交流电源负极也接地',
                mode: 'check',
                act() {
                    _presetStep1(this.sys);
                },
                check() {
                    const _c = (a, b) => this.sys.isPortConnected(a, b);
                    return _c('ac_wire_p', 'r1_wire_l')
                        && _c('r1_wire_r', 'l1_wire_l')
                        && _c('l1_wire_r', 'gnd1_wire_gnd')
                        && _c('ac_wire_n', 'gnd1_wire_gnd');
                },
            },
            {
                msg: '2. 数字功率计接入：电源正极接到 I+，I- 接到电阻进线，U+ 接到 I+，U- 接到电阻出线',
                mode: 'check',
                act() {
                    _presetStep2Digital(this.sys);
                },
                check() {
                    const _c = (a, b) => this.sys.isPortConnected(a, b);
                    return _c('ac_wire_p', 'elecmeter_wire_ip')
                        && _c('elecmeter_wire_in', 'r1_wire_l')
                        && _c('elecmeter_wire_up', 'elecmeter_wire_ip')
                        && _c('elecmeter_wire_un', 'l1_wire_r')
                        && _c('r1_wire_r', 'l1_wire_l')
                        && _c('l1_wire_r', 'gnd1_wire_gnd')
                        && _c('ac_wire_n', 'gnd1_wire_gnd');
                },
            },
            {
                msg: '3. 接通电源（交流 220V/50Hz），观察数字功率计显示',
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
                msg: '4. 将电源电压调到 100V，观察数字功率计指示',
                mode: 'check',
                act() {
                    const ac = this.sys.comps['ac'];
                    if (ac) { ac.isOn = true; ac.voltageRMS = 100; ac.frequency = 50; ac.update(); }
                },
                check() {
                    const ac = this.sys.comps['ac'];
                    return ac && ac.isOn && Math.abs(ac.voltageRMS - 100) < 1;
                },
            },
            {
                msg: '5. 测试题：有功功率的计算',
                mode: 'quiz',
                quizConfig: {
                    question: '在 R-L 串联电路中，R=40Ω，XL=30Ω，U=100V，此时电阻消耗的有功功率 P 为多少？',
                    options: [
                        '200 W',
                        '160 W',
                        '125 W',
                        '250 W',
                    ],
                    answer: 1,
                    analysis: '总阻抗 Z = √(R²+XL²) = √(1600+900) = 50Ω，' +
                        '电流 I = U / Z = 100 / 50 = 2A，' +
                        '有功功率 P = I²R = 2² × 40 = 160 W。',
                },
            },
        ],
    },
};

export const componentConfigs = [
    { Class: ACPower, id: 'ac', x: 10, y: 450, voltageRMS: 220, frequency: 50, isOn: false },
    { Class: Wattmeter, id: 'watt1', x: 20, y: 100, maxPower: 1000, voltRange: 250, currRange: 5 },
    { Class: Resistor, id: 'r1', x: 520, y: 520, value: 40 },
    { Class: Inductor, id: 'l1', x: 700, y: 720, inductance: 0.0955,rotation:90 },
    { Class: Ground, id: 'gnd1', x: 90, y: 750 },

    { Class: Multimeter, id: 'multimeter', x: 650, y: 30, scale: 1.1, visible: false },
    { Class: MF47Multimeter, id: 'mf47-panel', x: 650, y: 30, visible: false },
    { Class: Oscilloscope_tri, id: 'osc', x: 650, y: 260, visible: false },
    { Class: SignalGenerator, id: 'sg', x: 80, y: 400, visible: false },
    { Class: ProcessCalibrator, id: 'cali', x: 550, y: 400, visible: false },
    { Class: ElecMeter, id: 'elecmeter', x: 350, y: 30, visible: false },
];

function _presetWiring(sys) {
    const cons = [
        { from: 'ac_wire_p', to: 'r1_wire_l', type: 'wire' },
        { from: 'r1_wire_r', to: 'l1_wire_l', type: 'wire' },
        { from: 'l1_wire_r', to: 'gnd1_wire_gnd', type: 'wire' },
        { from: 'ac_wire_n', to: 'gnd1_wire_gnd', type: 'wire' },
    ];
    cons.forEach(c => sys.connMgr.addConn(c));
}

function _presetStep1(sys) {
    // 电路主回路（不含功率表）
    const cons = [
        { from: 'ac_wire_p', to: 'r1_wire_l', type: 'wire' },
        { from: 'r1_wire_r', to: 'l1_wire_l', type: 'wire' },
        { from: 'l1_wire_r', to: 'gnd1_wire_gnd', type: 'wire' },
        { from: 'ac_wire_n', to: 'gnd1_wire_gnd', type: 'wire' },
    ];
    cons.forEach(c => sys.connMgr.addConn(c));
}

function _presetStep2(sys) {
    // 插入功率表：断开 ac_wire_p-r1_wire_l，改为 ac_wire_p→I+→I-→r1_wire_l，并接电压线圈
    const mgr = sys.connMgr;
    // 移除直连
    const toRemove = mgr.conns.findIndex(c =>
        (c.from === 'ac_wire_p' && c.to === 'r1_wire_l') ||
        (c.from === 'r1_wire_l' && c.to === 'ac_wire_p'));
    if (toRemove >= 0) mgr.conns.splice(toRemove, 1);
    // 添加功率表连接
    const cons = [
        { from: 'ac_wire_p', to: 'watt1_wire_ip', type: 'wire' },
        { from: 'watt1_wire_in', to: 'r1_wire_l', type: 'wire' },
        { from: 'watt1_wire_up', to: 'watt1_wire_ip', type: 'wire' },
        { from: 'watt1_wire_un', to: 'l1_wire_r', type: 'wire' },
    ];
    cons.forEach(c => mgr.addConn(c));
}

function _presetStep2Digital(sys) {
    const mgr = sys.connMgr;
    const toRemove = mgr.conns.findIndex(c =>
        (c.from === 'ac_wire_p' && c.to === 'r1_wire_l') ||
        (c.from === 'r1_wire_l' && c.to === 'ac_wire_p'));
    if (toRemove >= 0) mgr.conns.splice(toRemove, 1);
    const elec = sys.comps['elecmeter'];
    if (elec) elec.group.visible(true);
    const cons = [
        { from: 'ac_wire_p', to: 'elecmeter_wire_ip', type: 'wire' },
        { from: 'elecmeter_wire_in', to: 'r1_wire_l', type: 'wire' },
        { from: 'elecmeter_wire_up', to: 'elecmeter_wire_ip', type: 'wire' },
        { from: 'elecmeter_wire_un', to: 'l1_wire_r', type: 'wire' },
    ];
    cons.forEach(c => mgr.addConn(c));
}

export function initSlider(_sys) {}

export function applyAllPresets() {
    _presetWiring(this.sys);
}

export async function applyStartSystem() {
    const sys = this.sys;
    _presetWiring(sys);
    const ac = sys.comps['ac'];
    if (ac) { ac.isOn = true; ac.voltageRMS = 220; ac.frequency = 50; ac.update(); }
}

export function fiveStep() {
    const sys = this && this.sys ? this.sys : window.sys;
    if (!sys) return;
    const ac = sys.comps['ac'];
    if (!ac) return;
    const voltages = [100, 140, 180, 220, 260, 300, 340];
    const idx = (fiveStep._idx || 0) % voltages.length;
    ac.voltageRMS = voltages[idx];
    ac.update();
    fiveStep._idx = idx + 1;
}
