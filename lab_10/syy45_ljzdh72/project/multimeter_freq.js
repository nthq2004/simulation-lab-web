// 频率表仿真项目 — 交流电源直接连接频率表，测量电源频率
// 电路：AC L → 频率表 L
//       AC N → 频率表 N → GND

import { ACPower } from '../components/ACPower.js';
import { Ground } from '../components/Gnd.js';
import { GeneratorFrequencyMeter } from '../components/FrequencyMeter.js';
import { DigitalFrequencyMeter } from '../components/DigitalFrequencyMeter.js';
import { Multimeter } from '../components/Multimeter.js';
import { MF47Multimeter } from '../components/MF47Multimeter.js';
import { Oscilloscope_tri } from '../components/Osc_tri.js';
import { SignalGenerator } from '../components/SignalGenerator.js';
import { ProcessCalibrator } from '../components/ProcessCalibrator.js';
import { AmpMeter } from '../components/AmpMeter.js';

export const FAULT_CONFIGS = {};

export const PROJECT_WORKFLOWS = {
    'freq-basic': {
        id: 'freq-basic',
        name: '1. 交流电源频率测量',
        steps: [
            {
                msg: '1. 连接电路：交流电源 L → 指针频率表 L → 数字频率表 L，交流电源 N → 两频率表 N → 大地',
                mode: 'check',
                act() {
                    _presetWiring(this.sys);
                },
                check() {
                    const conns = this.sys.conns || [];
                    const has = (a,b) => conns.some(c => (c.from===a && c.to===b) || (c.from===b && c.to===a));
                    return has('ac_wire_p', 'freq1_wire_L')
                        && has('ac_wire_n', 'freq1_wire_N')
                        && has('ac_wire_p', 'dfreq1_wire_L')
                        && has('ac_wire_n', 'dfreq1_wire_N')
                        && has('ac_wire_n', 'gnd1_wire_gnd');
                },
            },
            {
                msg: '2. 接通电源（AC 100V/50Hz），观察频率表显示',
                mode: 'check',
                act() {
                    const ac = this.sys.comps['ac'];
                    if (ac) { ac.isOn = true; ac.vRms = 100; ac.freq = 50; ac.update(); }
                },
                check() {
                    const ac = this.sys.comps['ac'];
                    return ac && ac.isOn;
                },
            },
            {
                msg: '3. 将交流电源频率调整为 45Hz，观察频率表指针左偏',
                mode: 'check',
                act() {
                    const ac = this.sys.comps['ac'];
                    if (ac) { ac.freq = 45; ac.update(); }
                },
                check() {
                    const ac = this.sys.comps['ac'];
                    return ac && Math.abs(ac.freq - 45) < 0.1;
                },
            },
            {
                msg: '4. 将交流电源频率调整为 55Hz，观察频率表指针右偏',
                mode: 'check',
                act() {
                    const ac = this.sys.comps['ac'];
                    if (ac) { ac.freq = 55; ac.update(); }
                },
                check() {
                    const ac = this.sys.comps['ac'];
                    return ac && Math.abs(ac.freq - 55) < 0.1;
                },
            },
            {
                msg: '5. 测试题：频率表的工作原理',
                mode: 'quiz',
                quizConfig: {
                    question: '发电机频率表采用什么原理测量频率？',
                    options: [
                        '电磁感应原理',
                        '谐振电路差动式原理',
                        '热电效应原理',
                        '霍尔效应原理',
                    ],
                    answer: 1,
                    analysis: '发电机频率表采用谐振电路差动式原理：' +
                        '两个并联 LC 谐振支路分别谐振于量程两端频率（45Hz 和 55Hz），' +
                        '两路电流之差通过交叉线圈磁电系统驱动指针偏转。' +
                        '当 f=50Hz 时两路电流相等，指针居中。',
                },
            },
        ],
    },
};

export const componentConfigs = [
    { Class: ACPower, id: 'ac', x: 10, y: 450, vRms: 100, freq: 50, isOn: false },
    { Class: GeneratorFrequencyMeter, id: 'freq1', x: 360, y: 350, frequency: 50, rangeMin: 45, rangeMax: 55, ratedVoltage: 100 },
    { Class: DigitalFrequencyMeter, id: 'dfreq1', x: 360, y: 250, frequency: 50, rangeMin: 10, rangeMax: 10000 },
    { Class: Ground, id: 'gnd1', x: 360, y: 650 },

    { Class: Multimeter, id: 'multimeter', x: 650, y: 30, scale: 1.1, visible: false },
    { Class: MF47Multimeter, id: 'mf47-panel', x: 650, y: 30, visible: false },
    { Class: Oscilloscope_tri, id: 'osc', x: 650, y: 260, visible: false },
    { Class: SignalGenerator, id: 'sg', x: 80, y: 400, visible: false },
    { Class: ProcessCalibrator, id: 'cali', x: 550, y: 400, visible: false },
    { Class: AmpMeter, id: 'ammeter', x: 350, y: 30, visible: false },
];

function _presetWiring(sys) {
    const cons = [
        { from: 'ac_wire_p', to: 'freq1_wire_L', type: 'wire' },
        { from: 'ac_wire_n', to: 'freq1_wire_N', type: 'wire' },
        { from: 'ac_wire_p', to: 'dfreq1_wire_L', type: 'wire' },
        { from: 'ac_wire_n', to: 'dfreq1_wire_N', type: 'wire' },
        { from: 'ac_wire_n', to: 'gnd1_wire_gnd', type: 'wire' },
    ];
    cons.forEach(c => sys.connMgr.addConn(c));
}

export function initSlider(_sys) {}

export function applyAllPresets() {
    _presetWiring(this.sys);
}

export async function applyStartSystem() {
    const sys = this.sys;
    _presetWiring(sys);
    const ac = sys.comps['ac'];
    if (ac) { ac.isOn = true; ac.vRms = 220; ac.freq = 50; ac.update(); }
}

export function fiveStep() {
    const sys = this && this.sys ? this.sys : window.sys;
    if (!sys) return;
    const ac = sys.comps['ac'];
    if (!ac) return;
    const freqs = [45, 47, 49, 50, 51, 53, 55];
    const idx = (fiveStep._idx || 0) % freqs.length;
    ac.freq = freqs[idx];
    ac.update();
    fiveStep._idx = idx + 1;
}
