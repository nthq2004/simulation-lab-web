// 交流电流表仿真项目 — 简单交流电路，ACAmmeter 串联测电流
// 电路：AC 220V → ACAmmeter(A+→A-) → 白炽灯 → GND

import { ACPower } from '../components/ACPower.js';
import { Ground } from '../components/Gnd.js';
import { IncandescentLamp } from '../components/IncandescentLamp.js';
import { ACAmmeter } from '../components/ACAmmeter.js';
import { Multimeter } from '../components/Multimeter.js';
import { Oscilloscope } from '../components/Oscilloscope.js';
import { SignalGenerator } from '../components/SignalGenerator.js';
import { ProcessCalibrator } from '../components/ProcessCalibrator.js';

export const FAULT_CONFIGS = {
    lamp_burn: {
        id: 'lamp_burn',
        name: '白炽灯灯丝烧断',
        system: '负载',
        check() {
            const c = window.sys && window.sys.comps && window.sys.comps['lamp1'];
            return c && c._burnedOut;
        },
        trigger() {
            const c = window.sys && window.sys.comps && window.sys.comps['lamp1'];
            if (c) c._burnedOut = true;
        },
        repair() {
            const c = window.sys && window.sys.comps && window.sys.comps['lamp1'];
            if (c) c._burnedOut = false;
        },
    },
    amp_fault: {
        id: 'amp_fault',
        name: '电流表线圈开路',
        system: '电流表',
        check() {
            const c = window.sys && window.sys.comps && window.sys.comps['ac_amp1'];
            return c && c._faultOpen;
        },
        trigger() {
            const c = window.sys && window.sys.comps && window.sys.comps['ac_amp1'];
            if (c) c._faultOpen = true;
        },
        repair() {
            const c = window.sys && window.sys.comps && window.sys.comps['ac_amp1'];
            if (c) c._faultOpen = false;
        },
    },
};

export const PROJECT_WORKFLOWS = {
    'acam-basic': {
        id: 'acam-basic',
        name: '1. 交流电流表基本测量',
        steps: [
            {
                msg: '1. 接通主回路：AC 电源 → 交流电流表 → 白炽灯 → 接地，闭合回路',
                mode: 'check',
                act() {
                    _doPresetWiring(this.sys);
                },
                check() {
                    const conns = this.sys.conns || [];
                    const has = (a, b) => conns.some(c => (c.from === a && c.to === b) || (c.from === b && c.to === a));
                    return has('ac_wire_p', 'ac_amp1_wire_ap')
                        && has('ac_amp1_wire_an', 'lamp1_wire_l')
                        && has('lamp1_wire_r', 'gnd1_wire_gnd')
                        && has('ac_wire_n', 'gnd2_wire_gnd');
                },
            },
            {
                msg: '2. 合上电源（AC 220V/50Hz），观察电流表读数',
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
                msg: '3. 降低电源电压至 100V，观察电流表读数变化',
                mode: 'check',
                act() {
                    const ac = this.sys.comps['ac'];
                    if (ac) { ac.vRms = 100; ac.update(); }
                },
                check() {
                    const ac = this.sys.comps['ac'];
                    return ac && Math.abs(ac.vRms - 100) < 10;
                },
            },
            {
                msg: '4. 测试题：电磁系仪表工作原理',
                mode: 'quiz',
                quizConfig: {
                    question: '电磁系仪表（如 ACAmmeter）的工作原理是什么？',
                    options: [
                        '线圈在磁场中受力带动指针偏转',
                        '铁片在通电线圈磁场中被磁化产生排斥力，带动指针偏转',
                        '热敏电阻受热变形驱动指针',
                        '霍尔效应检测磁场强度',
                    ],
                    answer: 1,
                    analysis: '电磁系仪表利用通电线圈产生磁场，' +
                        '内部固定铁片和活动铁片同时被磁化，产生排斥力驱动指针偏转。' +
                        '偏转角度与电流有效值的平方成正比，因此刻度不均匀。',
                },
            },
            {
                msg: '5. 将电压升高至 300V，白炽灯过压烧毁（灯丝熔断），观察电流表归零',
                mode: 'check',
                act() {
                    const ac = this.sys.comps['ac'];
                    if (ac) { ac.vRms = 300; ac.update(); }
                },
                check() {
                    const lamp = this.sys.comps['lamp1'];
                    return lamp && lamp._burnedOut;
                },
            },
            {
                msg: '6. 测试题：电磁系仪表的特征（刻度不均匀）',
                mode: 'quiz',
                quizConfig: {
                    question: '电磁系仪表（如 ACAmmeter）刻度不均匀的主要原因是？',
                    options: [
                        '指针随电流做线性偏转',
                        '偏转角与电流平方成正比（平方律特性）',
                        '弹簧游丝的非线性导致',
                        '电源电压波动引起',
                    ],
                    answer: 1,
                    analysis: '电磁系仪表中，固定铁片与活动铁片同时被同一电流磁化，' +
                        '排斥力 F ∝ I²，因此偏转角度与电流有效值的平方成正比。' +
                        '这意味着小电流时偏转较小（刻度较密），大电流时偏转较大（刻度较疏），呈平方律刻度特性。',
                },
            },
        ],
    },
    'acam-voltage-variation': {
        id: 'acam-voltage-variation',
        name: '2. 不同电压下的电流测量',
        steps: [
            {
                msg: '1. 更换烧毁的白炽灯，接通 220V 电源',
                mode: 'check',
                act() {
                    const lamp = this.sys.comps['lamp1'];
                    if (lamp) lamp._burnedOut = false;
                    const ac = this.sys.comps['ac'];
                    if (ac) { ac.isOn = true; ac.vRms = 220; ac.freq = 50; ac.update(); }
                    _doPresetWiring(this.sys);
                },
                check() {
                    const lamp = this.sys.comps['lamp1'];
                    const ac = this.sys.comps['ac'];
                    return lamp && !lamp._burnedOut && ac && ac.isOn;
                },
            },
            {
                msg: '2. 将电压调至 100V，记录电流表读数',
                mode: 'check',
                act() {
                    const ac = this.sys.comps['ac'];
                    if (ac) { ac.vRms = 100; ac.update(); }
                },
                check() {
                    const ac = this.sys.comps['ac'];
                    return ac && Math.abs(ac.vRms - 100) < 10;
                },
            },
            {
                msg: '3. 将电压调至 150V，观察电流增大',
                mode: 'check',
                act() {
                    const ac = this.sys.comps['ac'];
                    if (ac) { ac.vRms = 150; ac.update(); }
                },
                check() {
                    const ac = this.sys.comps['ac'];
                    return ac && Math.abs(ac.vRms - 150) < 10;
                },
            },
            {
                msg: '4. 将电压调至 200V，观察电流表指针偏转位置',
                mode: 'check',
                act() {
                    const ac = this.sys.comps['ac'];
                    if (ac) { ac.vRms = 200; ac.update(); }
                },
                check() {
                    const ac = this.sys.comps['ac'];
                    return ac && Math.abs(ac.vRms - 200) < 10;
                },
            },
            {
                msg: '5. 测试题：电流与电压关系',
                mode: 'quiz',
                quizConfig: {
                    question: '白炽灯近似为纯电阻负载，当电压从 100V 升至 200V 时，电流如何变化？',
                    options: [
                        '不变',
                        '近似线性增大（I = V/R）',
                        '指数增大',
                        '先增大后减小',
                    ],
                    answer: 1,
                    analysis: '白炽灯在正常工作时可近似视为纯电阻，' +
                        '根据欧姆定律 I = V/R，当电压升高时电流近似线性增大。' +
                        '但灯丝电阻随温度升高而增大（正温度系数），因此实际电流略小于线性值。',
                },
            },
        ],
    },
};

export const componentConfigs = [
    { Class: ACPower, id: 'ac', x: 10, y: 220, vRms: 220, freq: 50, isOn: false },
    { Class: Ground, id: 'gnd1', x: 480, y: 720 },
    { Class: Ground, id: 'gnd2', x: 55, y: 460 },
    { Class: IncandescentLamp, id: 'lamp1', x: 460, y: 600, coldResistance: 48.4, rotation: 90 },
    { Class: ACAmmeter, id: 'ac_amp1', x: 260, y: 50, maxCurrent: 5 },

    { Class: Multimeter, id: 'multimeter', x: 650, y: 30, scale: 1.1, visible: false },
    { Class: Oscilloscope, id: 'osc', x: 650, y: 260, visible: false },
    { Class: SignalGenerator, id: 'sg', x: 80, y: 400, visible: false },
    { Class: ProcessCalibrator, id: 'cali', x: 550, y: 400, visible: false },
];

function _doPresetWiring(sys) {
    sys.conns = [];
    const presetConns = [
        { from: 'ac_wire_p', to: 'ac_amp1_wire_ap', type: 'wire' },
        { from: 'ac_amp1_wire_an', to: 'lamp1_wire_l', type: 'wire' },
        { from: 'lamp1_wire_r', to: 'gnd1_wire_gnd', type: 'wire' },
        { from: 'ac_wire_n', to: 'gnd2_wire_gnd', type: 'wire' },
    ];
    presetConns.forEach(c => sys.connMgr.addConn(c));
    sys.redrawAll();
}

function _sameCluster(sys, portA, portB) {
    const map = sys.voltageSolver?.portToCluster;
    if (!map) return false;
    const cA = map.get(portA);
    const cB = map.get(portB);
    return cA !== undefined && cA === cB;
}

export function initSlider(_sys) {}

export function applyAllPresets() {
    _doPresetWiring(this.sys);
}

export async function applyStartSystem() {
    const sys = this.sys;
    _doPresetWiring(sys);
    const ac = sys.comps['ac'];
    if (ac) { ac.isOn = true; ac.vRms = 220; ac.freq = 50; ac.update(); }
}

export function fiveStep() {
    const sys = this && this.sys ? this.sys : window.sys;
    if (!sys) return;
    const ac = sys.comps['ac'];
    if (!ac) return;
    const voltages = [100, 150, 200, 250, 300];
    const idx = (fiveStep._idx || 0) % voltages.length;
    ac.vRms = voltages[idx];
    ac.update();
    fiveStep._idx = idx + 1;
}
