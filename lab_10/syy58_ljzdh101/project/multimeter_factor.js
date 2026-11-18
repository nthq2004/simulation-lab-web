// 功率因数表仿真工程 — 交流电源经电阻+电感串联负载，功率因数表测量负载功率因数
// 电路：AC L → 功率表 I+ → 电阻 40Ω → 电感 0.0955H(30Ω) → 功率表 I- → AC N → GND
//        功率表 U+ 并联于电阻左端，U- 并联于电阻右端
// 负载：R=40Ω, XL=30Ω (50Hz), Z=50Ω, PF=40/50=0.8 (感性滞后)

import { ACPower } from '../components/ACPower.js';
import { Ground } from '../components/Gnd.js';
import { Resistor } from '../components/Resistor.js';
import { Inductor } from '../components/Inductor.js';
import { Capacitor } from '../components/Capacitor.js';
import { PowerFactor } from '../components/PowerFactor.js';
import { Multimeter } from '../components/Multimeter.js';
import { MF47Multimeter } from '../components/MF47Multimeter.js';
import { Oscilloscope_tri } from '../components/Osc_tri.js';
import { SignalGenerator } from '../components/SignalGenerator.js';
import { ProcessCalibrator } from '../components/ProcessCalibrator.js';
import { ElecMeter } from '../components/ElecMeter.js';


export const FAULT_CONFIGS = {};

export const PROJECT_WORKFLOWS = {
    'factor-basic': {
        id: 'factor-basic',
        name: '1. 感性负载功率因数测量（R-L 串联）',
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
                msg: '2. 功率因数表接入：电源正极接到 I+，I- 接到负载进线，U+ 接到 I+，U- 接到负载出线',
                mode: 'check',
                act() {
                    _presetStep2(this.sys);
                },
                check() {
                    const _c = (a, b) => this.sys.isPortConnected(a, b);
                    return _c('ac_wire_p', 'pf1_wire_ip')
                        && _c('pf1_wire_in', 'r1_wire_l')
                        && _c('pf1_wire_up', 'pf1_wire_ip')
                        && _c('pf1_wire_un', 'l1_wire_r')
                        && _c('r1_wire_r', 'l1_wire_l')
                        && _c('l1_wire_r', 'gnd1_wire_gnd')
                        && _c('ac_wire_n', 'gnd1_wire_gnd');
                },
            },
            {
                msg: '3. 接通电源（交流 220V/50Hz），观察功率因数表指针偏转',
                mode: 'check',
                act() {
                    const ac = this.sys.comps['ac'];
                    if (ac) { ac.isOn = true; ac.vRms = 220; ac.freq = 50; ac.update(); }
                },
                check() {
                    const ac = this.sys.comps['ac'];
                    return ac && ac.isOn;
                },
            },
            {
                msg: '4. 将电阻调节到 4Ω，观察功率因数表指示（PF 应接近 0）',
                mode: 'check',
                act() {
                    _setResistor(this.sys, 4);
                },
                check() {
                    const r1 = this.sys.comps['r1'];
                    return r1 && Math.abs(r1.currentResistance - 4) < 0.1;
                },
            },
            {
                msg: '5. 将电阻调节到 400Ω，观察功率因数表指示（PF 应接近 1）',
                mode: 'check',
                act() {
                    _setResistor(this.sys, 400);
                },
                check() {
                    const r1 = this.sys.comps['r1'];
                    return r1 && Math.abs(r1.currentResistance - 400) < 1;
                },
            },
            {
                msg: '6. 测试题：功率因数的计算',
                mode: 'quiz',
                quizConfig: {
                    question: '在 R-L 串联电路中，R=40Ω，XL=30Ω，此时电路的功率因数 cosφ 为多少？',
                    options: [
                        '1.0',
                        '0.6',
                        '0.8',
                        '0.5',
                    ],
                    answer: 2,
                    analysis: '总阻抗 Z = √(R²+XL²) = √(1600+900) = 50Ω，' +
                        '功率因数 cosφ = R / Z = 40 / 50 = 0.8（感性滞后）。',
                },
            },
        ],
    },
    'factor-capacitive': {
        id: 'factor-capacitive',
        name: '2. 容性负载功率因数测量（R-C 串联）',
        steps: [
            {
                msg: '1. 电路接线：连接交流电源 → 电阻 → 电容 → 接地，交流电源负极也接地',
                mode: 'check',
                act() {
                    _presetStepCap(this.sys);
                },
                check() {
                    const _c = (a, b) => this.sys.isPortConnected(a, b);
                    return _c('ac_wire_p', 'r1_wire_l')
                        && _c('r1_wire_r', 'c1_wire_l')
                        && _c('c1_wire_r', 'gnd1_wire_gnd')
                        && _c('ac_wire_n', 'gnd1_wire_gnd');
                },
            },
            {
                msg: '2. 功率因数表接入：电源正极接到 I+，I- 接到电阻进线，U+ 接到 I+，U- 接到电容出线',
                mode: 'check',
                act() {
                    _presetStep2Cap(this.sys);
                },
                check() {
                    const _c = (a, b) => this.sys.isPortConnected(a, b);
                    return _c('ac_wire_p', 'pf1_wire_ip')
                        && _c('pf1_wire_in', 'r1_wire_l')
                        && _c('pf1_wire_up', 'pf1_wire_ip')
                        && _c('pf1_wire_un', 'c1_wire_r')
                        && _c('r1_wire_r', 'c1_wire_l')
                        && _c('c1_wire_r', 'gnd1_wire_gnd')
                        && _c('ac_wire_n', 'gnd1_wire_gnd');
                },
            },
            {
                msg: '3. 接通电源（交流 220V/50Hz），观察容性负载下功率因数表指针偏转至容性侧',
                mode: 'check',
                act() {
                    const ac = this.sys.comps['ac'];
                    if (ac) { ac.isOn = true; ac.vRms = 220; ac.freq = 50; ac.update(); }
                },
                check() {
                    const ac = this.sys.comps['ac'];
                    return ac && ac.isOn && Math.abs(ac.vRms - 220) < 10;
                },
            },
            {
                msg: '4. 测试题：容性负载功率因数',
                mode: 'quiz',
                quizConfig: {
                    question: '纯电容负载的功率因数 cosφ 为多少？',
                    options: [
                        '1.0',
                        '0.5',
                        '0',
                        '-1.0',
                    ],
                    answer: 2,
                    analysis: '纯电容负载中，电流超前电压 90°，功率因数 cosφ = 0，' +
                        '表现为容性（超前）特性。',
                },
            },
        ],
    },
};

export const componentConfigs = [
    { Class: ACPower, id: 'ac', x: 10, y: 450, vRms: 220, freq: 50, isOn: false },
    { Class: PowerFactor, id: 'pf1', x: 20, y: 100 },
    { Class: Resistor, id: 'r1', x: 520, y: 520, value: 40 },
    { Class: Inductor, id: 'l1', x: 700, y: 720, inductance: 0.0955, rotation: 90 },
    { Class: Capacitor, id: 'c1', x: 600, y: 720, capacitance: 106 },
    { Class: Ground, id: 'gnd1', x: 90, y: 750 },

    { Class: Multimeter, id: 'multimeter', x: 650, y: 30, scale: 1.1, visible: false },
    { Class: MF47Multimeter, id: 'mf47-panel', x: 650, y: 30, visible: false },
    { Class: Oscilloscope_tri, id: 'osc', x: 650, y: 260, visible: false },
    { Class: SignalGenerator, id: 'sg', x: 80, y: 400, visible: false },
    { Class: ProcessCalibrator, id: 'cali', x: 550, y: 400, visible: false },
    { Class: ElecMeter, id: 'elecmeter', x: 350, y: 30, visible: false },
];

function _presetWiring(sys) {
    const l1 = sys.comps['l1'];
    if (l1) l1.group.visible(true);
    const c1 = sys.comps['c1'];
    if (c1) c1.group.visible(false);
    const cons = [
        { from: 'ac_wire_p', to: 'r1_wire_l', type: 'wire' },
        { from: 'r1_wire_r', to: 'l1_wire_l', type: 'wire' },
        { from: 'l1_wire_r', to: 'gnd1_wire_gnd', type: 'wire' },
        { from: 'ac_wire_n', to: 'gnd1_wire_gnd', type: 'wire' },
    ];
    cons.forEach(c => sys.connMgr.addConn(c));
}

function _presetStep1(sys) {
    const l1 = sys.comps['l1'];
    if (l1) l1.group.visible(true);
    const c1 = sys.comps['c1'];
    if (c1) c1.group.visible(false);
    const cons = [
        { from: 'ac_wire_p', to: 'r1_wire_l', type: 'wire' },
        { from: 'r1_wire_r', to: 'l1_wire_l', type: 'wire' },
        { from: 'l1_wire_r', to: 'gnd1_wire_gnd', type: 'wire' },
        { from: 'ac_wire_n', to: 'gnd1_wire_gnd', type: 'wire' },
    ];
    cons.forEach(c => sys.connMgr.addConn(c));
}

function _presetStep2(sys) {
    const mgr = sys.connMgr;
    const toRemove = mgr.conns.findIndex(c =>
        (c.from === 'ac_wire_p' && c.to === 'r1_wire_l') ||
        (c.from === 'r1_wire_l' && c.to === 'ac_wire_p'));
    if (toRemove >= 0) mgr.conns.splice(toRemove, 1);
    const cons = [
        { from: 'ac_wire_p', to: 'pf1_wire_ip', type: 'wire' },
        { from: 'pf1_wire_in', to: 'r1_wire_l', type: 'wire' },
        { from: 'pf1_wire_up', to: 'pf1_wire_ip', type: 'wire' },
        { from: 'pf1_wire_un', to: 'l1_wire_r', type: 'wire' },
    ];
    cons.forEach(c => mgr.addConn(c));
}

function _presetStepCap(sys) {
    const c1 = sys.comps['c1'];
    if (c1) c1.group.visible(true);
    const l1 = sys.comps['l1'];
    if (l1) l1.group.visible(false);
    const cons = [
        { from: 'ac_wire_p', to: 'r1_wire_l', type: 'wire' },
        { from: 'r1_wire_r', to: 'c1_wire_l', type: 'wire' },
        { from: 'c1_wire_r', to: 'gnd1_wire_gnd', type: 'wire' },
        { from: 'ac_wire_n', to: 'gnd1_wire_gnd', type: 'wire' },
    ];
    cons.forEach(c => sys.connMgr.addConn(c));
}

function _presetStep2Cap(sys) {
    const mgr = sys.connMgr;
    const toRemove = mgr.conns.findIndex(c =>
        (c.from === 'ac_wire_p' && c.to === 'r1_wire_l') ||
        (c.from === 'r1_wire_l' && c.to === 'ac_wire_p'));
    if (toRemove >= 0) mgr.conns.splice(toRemove, 1);
    const cons = [
        { from: 'ac_wire_p', to: 'pf1_wire_ip', type: 'wire' },
        { from: 'pf1_wire_in', to: 'r1_wire_l', type: 'wire' },
        { from: 'pf1_wire_up', to: 'pf1_wire_ip', type: 'wire' },
        { from: 'pf1_wire_un', to: 'c1_wire_r', type: 'wire' },
    ];
    cons.forEach(c => mgr.addConn(c));
}

export function initSlider(_sys) {}

export function applyAllPresets() {
    const sys = this.sys;
    const wfId = sys.currentWorkflowId || '';
    if (wfId === 'factor-capacitive') {
        _presetStepCap(sys);
    } else {
        _presetWiring(sys);
    }
}

export async function applyStartSystem() {
    const sys = this.sys;
    const wfId = sys.currentWorkflowId || '';
    if (wfId === 'factor-capacitive') {
        _presetStepCap(sys);
    } else {
        _presetWiring(sys);
    }
    const ac = sys.comps['ac'];
    if (ac) { ac.isOn = true; ac.vRms = 220; ac.freq = 50; ac.update(); }
}

function _setResistor(sys, val) {
    const r1 = sys.comps['r1'];
    if (!r1) return;
    r1.currentResistance = val;
    let resText = val > 1000 ? (val / 1000).toFixed(1) + ' kΩ' : val + ' Ω';
    if (r1.label) r1.label.text(resText + ' ');
    r1.config = r1.config || {};
    r1.config.currentResistance = val;
    r1._refreshCache?.();
}

export function fiveStep() {
    const sys = this && this.sys ? this.sys : window.sys;
    if (!sys) return;
    const resistances = [1, 4, 40, 400, 1000];
    const idx = (fiveStep._idx || 0) % resistances.length;
    _setResistor(sys, resistances[idx]);
    fiveStep._idx = idx + 1;
}
