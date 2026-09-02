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
    '7805-rectifier': {
        id: '7805-rectifier',
        name: '7805 整流稳压电路',
        steps: [
            {
                msg: '1. 检查主电路接线：AC 220V → 保险丝 → 变压器原边；变压器副边 → 桥式整流 → 47µF滤波 → 7805 → 22µF滤波 → 200Ω负载',
                mode: 'check',
                act() {
                    _autoWire(this.sys);
                },
                check() {
                    return true;
                },
            },
            {
                msg: '2. 观察 7805 输出电压：用万用表测量 7805 输出端（OUT）与地（GND）之间的电压，应为 +5V 左右。',
                mode: 'check',
                act() {
                    const mm = this.sys.comps['multimeter'];
                    if (mm) {
                        mm.group.visible(true);
                        mm.mode = 'DCV20';
                    }
                },
                check() {
                    const mm = this.sys.comps['multimeter'];
                    if (!mm || !mm.group || !mm.group.visible()) return false;
                    const c = (a, b) => this.sys.isPortConnected(a, b);
                    return c('multimeter_wire_v', 'reg_wire_out')
                        && c('multimeter_wire_com', 'gnd1_wire_gnd');
                },
            },
            {
                msg: '3. 测试题：关于 7805 三端稳压器',
                mode: 'quiz',
                quizConfig: {
                    question: '7805 三端稳压器正常工作时，输出端对地电压约为：',
                    options: [
                        '3.3V',
                        '5V',
                        '12V',
                        '24V',
                    ],
                    answer: 1,
                    analysis: '7805 是一款固定输出 +5V 的三端稳压器，其输出电压稳定在 5V，最大输出电流 1.5A。',
                },
            },
        ],
    },
};

export const componentConfigs = [
    { Class: ACPower, id: 'ac', x: 10, y: 210, voltageRMS: 220, frequency: 50, isOn: true },
    { Class: SinglePhaseFuse, id: 'fu', x: 200, y: 280, rotation: -90 },
    { Class: RealControlTransformer, id: 'tr', x: 390, y: 230, primaryVoltage: 220, secondaryVoltage: 12 },
    { Class: Ground, id: 'gnd1', x: 300, y: 530 },

    { Class: Diode, id: 'd1', x: 780, y: 260, rotation: -90 },
    { Class: Diode, id: 'd2', x: 860, y: 260, rotation: -90 },
    { Class: Diode, id: 'd3', x: 780, y: 420, rotation: -90 },
    { Class: Diode, id: 'd4', x: 860, y: 420, rotation: -90 },

    { Class: Capacitor, id: 'c1', x: 970, y: 280, subtype: 'el', capacitance: 47, leak: 10000 },
    { Class: IC7805, id: 'reg', x: 1090, y: 230 },
    { Class: Capacitor, id: 'c2', x: 1210, y: 280, subtype: 'el', capacitance: 22, },

    { Class: Resistor, id: 'rl', x: 1320, y: 280, value: 200, rotation: 90 },

    { Class: Ground, id: 'gnd2', x: 1100, y: 390 },

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
