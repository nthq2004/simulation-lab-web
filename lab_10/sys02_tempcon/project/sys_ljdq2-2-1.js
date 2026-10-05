// 7805 三端稳压器整流仿真工程
// 电路：AC 220V → 保险丝 → 控制变压器(220V/12V) → 桥式整流 → 47µF滤波 → 7805 → 22µF滤波 → 200Ω负载

import { ACPower } from '../components/ACPower.js';
import { SinglePhaseFuse } from '../components/SinglePhaseFuse.js';
import { RealControlTransformer } from '../components/RealControlTransformer.js';
import { Diode } from '../components/Diode.js';
import { Capacitor } from '../components/Capacitor.js';
import { IC7805 } from '../components/IC7805.js';
import { Resistor } from '../components/Resistor.js';
import { Ground } from '../components/Gnd.js';
import { Multimeter } from '../components/Multimeter.js';
import { MF47Multimeter } from '../components/MF47Multimeter.js';
import { Oscilloscope_tri } from '../components/Osc_tri.js';
import { SignalGenerator } from '../components/SignalGenerator.js';
import { ProcessCalibrator } from '../components/ProcessCalibrator.js';
import { ElecMeter } from '../components/ElecMeter.js';

export const FAULT_CONFIGS = {};

export const PROJECT_WORKFLOWS = {

    '7805-recognize': {
        id: '7805-recognize',
        name: '1. 识别元器件及其功能',
        steps: [
            {
                msg: '1. 识别变压器：请点击电路中的控制变压器',
                mode: 'find',
                target: 'tr',
            },
            {
                msg: '2. 识别二极管：请点击任意一个整流二极管',
                mode: 'find',
                target: ['d1', 'd2', 'd3', 'd4'],
            },
            {
                msg: '3. 测试题：二极管的作用',
                mode: 'quiz',
                quizConfig: {
                    question: '在本整流电路中，二极管的主要作用是什么？',
                    options: [
                        '放大电流',
                        '整流，将交流电转换为脉动直流电',
                        '储存电能',
                        '升高电压',
                    ],
                    answer: 1,
                    analysis: '二极管利用单向导电性进行整流，四个二极管构成桥式整流电路，将交流电转换为脉动直流电。',
                },
            },
            {
                msg: '4. 识别电容：请点击滤波电容',
                mode: 'find',
                target: ['c1', 'c2'],
            },
            {
                msg: '5. 测试题：电容的作用',
                mode: 'quiz',
                quizConfig: {
                    question: '滤波电容在整流电路中的作用是：',
                    options: [
                        '放大整流输出电压',
                        '储能并平滑电压波形，使脉动直流变得平稳',
                        '将直流电转换为交流电',
                        '限制电路中的电流',
                    ],
                    answer: 1,
                    analysis: '电容利用充放电特性进行储能，能平滑整流后的脉动电压，使输出电压波形变得平稳，起到滤波作用。',
                },
            },
            {
                msg: '6. 识别集成稳压器件：请点击三端稳压器.',
                mode: 'find',
                target: 'reg',
            },
            {
                msg: '7. 测试题：电源电路的四个基本环节',
                mode: 'quiz',
                quizConfig: {
                    question: '直流稳压电源电路通常包含哪四个基本环节？',
                    options: [
                        '变压、整流、滤波、稳压',
                        '电源、导线、负载、开关',
                        '放大、整流、滤波、稳压',
                        '变压、整流、放大、滤波',
                    ],
                    answer: 0,
                    analysis: '直流稳压电源电路由四个基本环节组成：变压器将电压变换到合适的幅度，整流电路把交流变为脉动直流，滤波电路平滑波形，稳压电路保证输出电压稳定。',
                },
            },
        ],
    },
    '7805-analyze': {
        id: '7805-analyze',
        name: '2. 电子电路工作流程分析',
        steps: [
            {
                msg: '1. 接线，并接通电源',
                mode: 'check',
                act() {
                    _autoWire(this.sys);
                    const ac = this.sys.comps['ac'];
                    if (ac) { ac.isOn = true; ac.vRms = 220; ac.freq = 50; ac.update(); }
                },
                check() {
                    const ac = this.sys.comps['ac'];
                    return ac && ac.isOn && _hasConn(this.sys, 'ac_wire_p', 'fu_wire_l');
                },
            },
            {
                msg: '2. 调出三路示波器，测量变压器输入、输出波形',
                mode: 'check',
                act() {
                    const osc = this.sys.comps['osc'];
                    if (osc && osc.group) { osc.group.visible(true); osc.group.position({ x: 500, y: 500 }); }
                    _disconnectOsc(this.sys);
                    this.sys.connMgr.addConn({ from: 'osc_wire_ch1p', to: 'tr_wire_p1', type: 'wire' });
                    this.sys.connMgr.addConn({ from: 'osc_wire_ch1n', to: 'tr_wire_p2', type: 'wire' });
                    this.sys.connMgr.addConn({ from: 'osc_wire_ch2p', to: 'tr_wire_s1', type: 'wire' });
                    this.sys.connMgr.addConn({ from: 'osc_wire_ch2n', to: 'tr_wire_s2', type: 'wire' });
                    this.sys.redrawAll();
                },
                check() {
                    const osc = this.sys.comps['osc'];
                    return osc && osc.group && osc.group.visible()
                        && _hasConn(this.sys, 'osc_wire_ch1p', 'tr_wire_p1')
                        && _hasConn(this.sys, 'osc_wire_ch1n', 'tr_wire_p2')
                        && _hasConn(this.sys, 'osc_wire_ch2p', 'tr_wire_s1')
                        && _hasConn(this.sys, 'osc_wire_ch2n', 'tr_wire_s2');
                },
            },
            {
                msg: '3. 示波器第 3 路测量第一个滤波电容上的电压波形',
                mode: 'check',
                act() {
                    this.sys.connMgr.addConn({ from: 'osc_wire_ch3p', to: 'c1_wire_l', type: 'wire' });
                    this.sys.connMgr.addConn({ from: 'osc_wire_ch3n', to: 'c1_wire_r', type: 'wire' });
                    this.sys.redrawAll();
                },
                check() {
                    return _hasConn(this.sys, 'osc_wire_ch3p', 'c1_wire_l')
                        && _hasConn(this.sys, 'osc_wire_ch3n', 'c1_wire_r');
                },
            },
            {
                msg: '4. 调出数字万用表，测量负载两端电压',
                mode: 'check',
                act() {
                    const mm = this.sys.comps['multimeter'];
                    if (mm) { mm.group.visible(true); mm.group.position({ x: 1000, y: 520 }); mm.mode = 'DCV20'; mm._updateAngleByMode?.(); }
                    this.sys.connMgr.addConn({ from: 'multimeter_wire_v', to: 'rl_wire_l', type: 'wire' });
                    this.sys.connMgr.addConn({ from: 'multimeter_wire_com', to: 'rl_wire_r', type: 'wire' });
                    this.sys.redrawAll();
                },
                check() {
                    const mm = this.sys.comps['multimeter'];
                    return mm && mm.group && mm.group.visible()
                        && _hasConn(this.sys, 'multimeter_wire_v', 'rl_wire_l')
                        && _hasConn(this.sys, 'multimeter_wire_com', 'rl_wire_r');
                },
            },
            {
                msg: '5. 改变电源电压有效值(240V)，观察输出电压变化',
                mode: 'check',
                act() {
                    const ac = this.sys.comps['ac'];
                    if (ac) { ac.vRms = 240; ac.update(); }
                },
                check() {
                    const ac = this.sys.comps['ac'];
                    return ac && Math.abs(ac.vRms - 240) < 0.1;
                },
            },
            {
                msg: '6. 改变负载电阻(300Ω)，观察输出电压变化',
                mode: 'check',
                act() {
                    const rl = this.sys.comps['rl'];
                    if (rl) rl.onConfigUpdate({ id: rl.id, currentResistance: 300 });
                },
                check() {
                    const rl = this.sys.comps['rl'];
                    return rl && Math.abs(rl.currentResistance - 300) < 0.1;
                },
            },
            {
                msg: '7. 测试题：三端稳压器的作用',
                mode: 'quiz',
                quizConfig: {
                    question: '三端稳压器（如 7805）在本电路中的作用是什么？',
                    options: [
                        '将交流电整流为直流电',
                        '将不稳定的直流电压稳压为稳定的 +5V 输出',
                        '放大电路中的电压信号',
                        '将直流电逆变为交流电',
                    ],
                    answer: 1,
                    analysis: '7805 是固定输出 +5V 的三端稳压器。无论输入电压或负载怎样变化，它都能将输出电压稳定在 +5V，保证负载端电压基本不变。',
                },
            },
        ],
    },    
};

export const componentConfigs = [
    { Class: ACPower, id: 'ac', x: 10, y: 110, vRms: 220, freq: 50, isOn: false },
    { Class: SinglePhaseFuse, id: 'fu', x: 200, y: 280, rotation: -90 },
    { Class: RealControlTransformer, id: 'tr', x: 390, y: 230, primaryVoltage: 220, secondaryVoltage: 12 },
    { Class: Ground, id: 'gnd1', x: 100, y: 430 },

    { Class: Diode, id: 'd1', x: 780, y: 260, rotation: -90 },
    { Class: Diode, id: 'd2', x: 860, y: 260, rotation: -90 },
    { Class: Diode, id: 'd3', x: 780, y: 420, rotation: -90 },
    { Class: Diode, id: 'd4', x: 860, y: 420, rotation: -90 },

    { Class: Capacitor, id: 'c1', x: 970, y: 280, subtype: 'el', capacitance: 47, leak: 10000 },
    { Class: IC7805, id: 'reg', x: 1090, y: 230 },
    { Class: Capacitor, id: 'c2', x: 1210, y: 280, subtype: 'el', capacitance: 22, },

    { Class: Resistor, id: 'rl', x: 1320, y: 280, value: 200, rotation: 90 },

    { Class: Ground, id: 'gnd2', x: 1100, y: 420 },

    { Class: Multimeter, id: 'multimeter', x: 50, y: 50, visible: false },
    { Class: MF47Multimeter, id: 'mf47-panel', x: 50, y: 50, visible: false },
    { Class: Oscilloscope_tri, id: 'osc', x: 50, y: 50, visible: false },
    { Class: SignalGenerator, id: 'sg', x: 50, y: 50, visible: false },
    { Class: ProcessCalibrator, id: 'cali', x: 50, y: 50, visible: false },
    { Class: ElecMeter, id: 'elecmeter', x: 50, y: 50, visible: false },
];

function _autoWire(sys) {
    sys.conns.length = 0;
    const cons = [
        { from: 'ac_wire_p', to: 'fu_wire_l', type: 'wire' },
        { from: 'fu_wire_t', to: 'tr_wire_p1', type: 'wire' },
        { from: 'ac_wire_n', to: 'gnd1_wire_gnd', type: 'wire' },
        { from: 'tr_wire_p2', to: 'gnd1_wire_gnd', type: 'wire' },

        { from: 'tr_wire_s1', to: 'd1_wire_l', type: 'wire' },
        { from: 'd1_wire_l', to: 'd3_wire_r', type: 'wire' },
        { from: 'tr_wire_s2', to: 'd2_wire_l', type: 'wire' },
        { from: 'd2_wire_l', to: 'd4_wire_r', type: 'wire' },

        { from: 'd1_wire_r', to: 'd2_wire_r', type: 'wire' },
        { from: 'd2_wire_r', to: 'c1_wire_l', type: 'wire' },
        { from: 'd3_wire_l', to: 'd4_wire_l', type: 'wire' },
        { from: 'd4_wire_l', to: 'c1_wire_r', type: 'wire' },

        { from: 'c1_wire_r', to: 'gnd2_wire_gnd', type: 'wire' },
        { from: 'c1_wire_l', to: 'reg_wire_in', type: 'wire' },

        { from: 'reg_wire_out', to: 'c2_wire_l', type: 'wire' },
        { from: 'c2_wire_r', to: 'gnd2_wire_gnd', type: 'wire' },
        { from: 'reg_wire_gnd', to: 'gnd2_wire_gnd', type: 'wire' },

        { from: 'c2_wire_l', to: 'rl_wire_l', type: 'wire' },
        { from: 'rl_wire_r', to: 'c2_wire_r', type: 'wire' },
    ];
    cons.forEach(c => sys.connMgr.addConn(c));
    sys.redrawAll();
}

function _hasConn(sys, a, b) {
    return sys.conns.some(c => (c.from === a && c.to === b) || (c.from === b && c.to === a));
}

function _disconnectOsc(sys) {
    const ports = ['osc_wire_ch1p', 'osc_wire_ch1n', 'osc_wire_ch2p', 'osc_wire_ch2n', 'osc_wire_ch3p', 'osc_wire_ch3n'];
    const existing = sys.conns.filter(c => ports.includes(c.from) || ports.includes(c.to));
    existing.forEach(c => sys.connMgr.removeConn(c));
}

export function initSlider(_sys) { }

export function applyAllPresets() {
    const sys = this && this.sys ? this.sys : window.sys;
    if (!sys) return;
    _autoWire(sys);
}

export async function applyStartSystem() {
    const sys = this && this.sys ? this.sys : window.sys;
    if (!sys) return;
    _autoWire(sys);
}

export function fiveStep() { }
