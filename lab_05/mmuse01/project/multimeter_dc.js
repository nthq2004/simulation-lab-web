// 直流电路仿真项目 — 万用表测量直流电压、电阻、支路电流
// 电路：24V → 500Ω → (1000Ω ‖ 0~2000Ω可调) → GND

import { DCPower } from '../components/DCPower.js';
import { RealResistor } from '../components/RealResistor.js';
import { RealVariResistor } from '../components/RealVariResistor.js';
import { Ground } from '../components/Gnd.js';

import { Multimeter } from '../components/Multimeter.js';
import { AmpMeter } from '../components/AmpMeter.js';
import { MF47Multimeter } from '../components/MF47Multimeter.js';
import { SignalGenerator } from '../components/SignalGenerator.js';
import { ProcessCalibrator } from '../components/ProcessCalibrator.js';
import { Oscilloscope_tri } from '../components/Osc_tri.js';

export const FAULT_CONFIGS = {};

export const PROJECT_WORKFLOWS = {
    'dc-measure-voltage': {
        id: 'dc-measure-voltage',
        name: '1. 万用表测量直流电路电压',
        steps: [
            {
                msg: '1. 打开直流电源，将电压调为 24V',
                mode: 'check',
                act() {
                    const psu = this.sys.comps['psu'];
                    if (psu) { psu.isOn = true; psu.voltage = 24; psu.update(); }
                },
                check() {
                    const psu = this.sys.comps['psu'];
                    return psu && psu.isOn && Math.abs(psu.voltage - 24) < 0.1;
                },
            },
            {
                msg: '2. 关闭电源，接好电路，再接通电源',
                mode: 'check',
                act() {
                    const psu = this.sys.comps['psu'];
                    if (psu) { psu.isOn = false; psu.update(); }
                    _doPresetWiring(this.sys);
                    if (psu) { psu.isOn = true; psu.voltage = 24; psu.update(); }
                },
                check() {
                    const conns = this.sys.conns || [];
                    const has = (a, b) => conns.some(c => (c.from === a && c.to === b) || (c.from === b && c.to === a));
                    const psu = this.sys.comps['psu'];
                    return psu && psu.isOn
                        && has('psu_wire_p', 'r1_wire_l')
                        && has('r1_wire_r', 'r2_wire_l')
                        && has('r2_wire_l', 'vr1_wire_l')
                        && has('r2_wire_r', 'gnd_wire_gnd')
                        && has('vr1_wire_r', 'gnd_wire_gnd');
                },
            },
            {
                msg: '3. 将万用表打到直流 200V 档',
                mode: 'check',
                act() {
                    const mm = this.sys.comps['multimeter'];
                    if (mm) { mm.mode = 'DCV200'; mm._updateAngleByMode(); mm.update(0); }
                },
                check() {
                    const mm = this.sys.comps['multimeter'];
                    return mm && mm.mode === 'DCV200';
                },
            },
            {
                msg: '4. 将万用表红黑表笔分别接电源正负极，测量电源电压',
                mode: 'check',
                act() {
                    _connectMultimeterPower(this.sys);
                },
                check() {
                    return _sameCluster(this.sys, 'multimeter_wire_v', 'psu_wire_p')
                        && _sameCluster(this.sys, 'multimeter_wire_com', 'psu_wire_n');
                },
            },
            {
                msg: '5. 将万用表红黑表笔分别接 R1 两端，测量 R1 两端电压',
                mode: 'check',
                act() {
                    _disconnectMultimeter(this.sys);
                    _connectToR1(this.sys, 'voltage');
                },
                check() {
                    return _sameCluster(this.sys, 'multimeter_wire_v', 'r1_wire_l')
                        && _sameCluster(this.sys, 'multimeter_wire_com', 'r1_wire_r');
                },
            },
            {
                msg: '6. 将万用表红黑表笔分别接可调电阻 VR1 两端，测量 VR1 两端电压',
                mode: 'check',
                act() {
                    _disconnectMultimeter(this.sys);
                    _connectToVR1(this.sys, 'voltage');
                },
                check() {
                    return _sameCluster(this.sys, 'multimeter_wire_v', 'vr1_wire_l')
                        && _sameCluster(this.sys, 'multimeter_wire_com', 'vr1_wire_r');
                },
            },
            {
                msg: '7. 调节 VR1 电阻到最大值 2kΩ，观察电压的变化',
                mode: 'check',
                act() {
                    const vr1 = this.sys.comps['vr1'];
                    if (vr1) {
                        vr1.currentDeg = 135;
                        vr1.knobGroup.rotation(135);
                        vr1.fTrack.angle(270);
                        vr1.updateResistors();
                    }
                },
                check() {
                    const vr1 = this.sys.comps['vr1'];
                    return vr1 && vr1.currentResistance >= 1980;
                },
            },
            {
                msg: '8. 测试题：串联电路中电阻两端电压分配',
                mode: 'quiz',
                quizConfig: {
                    question: '在串联电路中，电阻值越大，其两端分配的电压？',
                    options: [
                        '越小',
                        '越大',
                        '不变',
                        '与电阻值无关'
                    ],
                    answer: 1,
                    analysis: '串联电路中电流处处相等，根据欧姆定律 U=IR，电阻越大，两端电压越高。',
                },
            },
        ],
    },
    'dc-measure-current': {
        id: 'dc-measure-current',
        name: '2. 万用表测量直流支路电流',
        steps: [
            {
                msg: '1. 打开直流电源，将电源调到 24V',
                mode: 'check',
                act() {
                    const psu = this.sys.comps['psu'];
                    if (psu) { psu.isOn = true; psu.voltage = 24; psu.update(); }
                },
                check() {
                    const psu = this.sys.comps['psu'];
                    return psu && psu.isOn && Math.abs(psu.voltage - 24) < 0.1;
                },
            },
            {
                msg: '2. 将万用表打到 mA 档',
                mode: 'check',
                act() {
                    const mm = this.sys.comps['multimeter'];
                    if (mm) { mm.mode = 'MA'; mm._updateAngleByMode(); mm.update(0); }
                },
                check() {
                    const mm = this.sys.comps['multimeter'];
                    return mm && mm.mode === 'MA';
                },
            },
            {
                msg: '3. 关闭电源，接好线路',
                mode: 'check',
                act() {
                    const psu = this.sys.comps['psu'];
                    if (psu) { psu.isOn = false; psu.update(); }
                    _doPresetWiring(this.sys);
                },
                check() {
                    const conns = this.sys.conns || [];
                    const has = (a, b) => conns.some(c => (c.from === a && c.to === b) || (c.from === b && c.to === a));
                    const psu = this.sys.comps['psu'];
                    return psu && !psu.isOn
                        && has('psu_wire_p', 'r1_wire_l')
                        && has('r1_wire_r', 'r2_wire_l');
                },
            },
            {
                msg: '4. 将万用表电流档串入电路干路（R1 与并联节点之间）',
                mode: 'check',
                act() {
                    _disconnectMultimeter(this.sys);
                    _connectAmmeterToBranch(this.sys, 'total');
                },
                check() {
                    return _hasConn(this.sys, 'multimeter_wire_ma', 'r1_wire_r')
                        && _hasConn(this.sys, 'multimeter_wire_com', 'r2_wire_l')
                        && !_hasConn(this.sys, 'r1_wire_r', 'r2_wire_l');
                },
            },
            {
                msg: '5. 接通电源，测量总电流',
                mode: 'check',
                act() {
                    const psu = this.sys.comps['psu'];
                    if (psu) { psu.isOn = true; psu.voltage = 24; psu.update(); }
                },
                check() {
                    const psu = this.sys.comps['psu'];
                    return psu && psu.isOn;
                },
            },
            {
                msg: '6. 将万用表电流档串入 R2 支路，测量 R2 支路电流',
                mode: 'check',
                act() {
                    _disconnectMultimeter(this.sys);
                    _connectAmmeterToBranch(this.sys, 'r2');
                },
                check() {
                    return _hasConn(this.sys, 'multimeter_wire_ma', 'r2_wire_r')
                        && _hasConn(this.sys, 'multimeter_wire_com', 'gnd_wire_gnd')
                        && !_hasConn(this.sys, 'r2_wire_r', 'gnd_wire_gnd');
                },
            },
            {
                msg: '7. 将万用表电流档串入 VR1 支路，测量 VR1 支路电流',
                mode: 'check',
                act() {
                    _disconnectMultimeter(this.sys);
                    _connectAmmeterToBranch(this.sys, 'vr1');
                },
                check() {
                    return _hasConn(this.sys, 'multimeter_wire_ma', 'vr1_wire_r')
                        && _hasConn(this.sys, 'multimeter_wire_com', 'gnd_wire_gnd')
                        && !_hasConn(this.sys, 'vr1_wire_r', 'gnd_wire_gnd');
                },
            },
            {
                msg: '8. 测试题：并联电路中支路电流分配',
                mode: 'quiz',
                quizConfig: {
                    question: '在并联电路中，电阻值越大，通过该支路的电流？',
                    options: [
                        '越小',
                        '越大',
                        '不变',
                        '与电阻值无关'
                    ],
                    answer: 0,
                    analysis: '并联电路各支路两端电压相等，根据欧姆定律 I=U/R，电阻越大，电流越小。',
                },
            },
        ],
    },
    'dc-measure-resistance': {
        id: 'dc-measure-resistance',
        name: '3. 万用表测量电阻',
        steps: [
            {
                msg: '1. 将万用表打到 2kΩ 档',
                mode: 'check',
                act() {
                    const mm = this.sys.comps['multimeter'];
                    if (mm) { mm.mode = 'RES2k'; mm._updateAngleByMode(); mm.update(0); }
                },
                check() {
                    const mm = this.sys.comps['multimeter'];
                    return mm && mm.mode === 'RES2k';
                },
            },
            {
                msg: '2. 将万用表红黑表笔接 R1 两端，测量 R1 电阻值',
                mode: 'check',
                act() {
                    const psu = this.sys.comps['psu'];
                    if (psu) { psu.isOn = false; psu.update(); }
                    _disconnectMultimeter(this.sys);
                    _connectToR1(this.sys, 'resistance');
                },
                check() {
                    return (_hasConn(this.sys, 'multimeter_wire_v', 'r1_wire_l') && _hasConn(this.sys, 'multimeter_wire_com', 'r1_wire_r'))
                        || (_hasConn(this.sys, 'multimeter_wire_v', 'r1_wire_r') && _hasConn(this.sys, 'multimeter_wire_com', 'r1_wire_l'));
                },
            },
            {
                msg: '3. 将万用表红黑表笔接 R2 两端，测量 R2 电阻值',
                mode: 'check',
                act() {
                    _disconnectMultimeter(this.sys);
                    _connectToR2(this.sys, 'resistance');
                },
                check() {
                    return (_hasConn(this.sys, 'multimeter_wire_v', 'r2_wire_l') && _hasConn(this.sys, 'multimeter_wire_com', 'r2_wire_r'))
                        || (_hasConn(this.sys, 'multimeter_wire_v', 'r2_wire_r') && _hasConn(this.sys, 'multimeter_wire_com', 'r2_wire_l'));
                },
            },
            {
                msg: '4. 将万用表红黑表笔接 VR1 两端，测量 VR1 当前电阻值',
                mode: 'check',
                act() {
                    _disconnectMultimeter(this.sys);
                    _connectToVR1(this.sys, 'resistance');
                },
                check() {
                    return (_hasConn(this.sys, 'multimeter_wire_v', 'vr1_wire_l') && _hasConn(this.sys, 'multimeter_wire_com', 'vr1_wire_r'))
                        || (_hasConn(this.sys, 'multimeter_wire_v', 'vr1_wire_r') && _hasConn(this.sys, 'multimeter_wire_com', 'vr1_wire_l'));
                },
            },
            {
                msg: '5. 改变 VR1 值，增大到 2kΩ，观察测量值变化',
                mode: 'check',
                act() {
                    const vr1 = this.sys.comps['vr1'];
                    if (vr1) {
                        vr1.currentDeg = 135;
                        vr1.knobGroup.rotation(135);
                        vr1.fTrack.angle(270);
                        vr1.updateResistors();
                    }
                },
                check() {
                    const vr1 = this.sys.comps['vr1'];
                    return vr1 && vr1.currentResistance >= 1980;
                },
            },
            {
                msg: '6. 测试题：电阻测量注意事项',
                mode: 'quiz',
                quizConfig: {
                    question: '使用万用表电阻档测量电阻时，以下哪项操作是正确的？',
                    options: [
                        '可以在被测电路带电时测量',
                        '测量前应先断开被测电路电源',
                        '表笔可以任意接',
                        '测量时无需选择量程'
                    ],
                    answer: 1,
                    analysis: '测量电阻前必须切断被测电路电源，否则可能损坏万用表。同时应根据被测电阻值选择合适的量程。',
                },
            },
        ],
    },
};

export const componentConfigs = [
    { Class: DCPower, id: 'psu', x: 10, y: 50, voltage: 12, isOn: false },
    { Class: Ground, id: 'gnd2', x: 160, y: 320 },
    { Class: RealResistor, id: 'r1', x: 380, y: 200, value: 500, rotation: -90 },
    { Class: RealResistor, id: 'r2', x: 660, y: 180, value: 1000, rotation: -90 },
    { Class: RealVariResistor, id: 'vr1', x: 660, y: 340, totalResistance: 2000, angle: 0 },
    { Class: Ground, id: 'gnd', x: 860, y: 280 },

    { Class: Multimeter, id: 'multimeter', x: 950, y: 30, scale: 1.1 },
    { Class: AmpMeter, id: 'ampmeter', x: 300, y: 400, visible: false },
    { Class: SignalGenerator, id: 'sg', x: 80, y: 360, visible: false },
    { Class: ProcessCalibrator, id: 'cali', x: 550, y: 400, visible: false },
    { Class: Oscilloscope_tri, id: 'osc3', x: 1050, y: 60, visible: false },
    { Class: MF47Multimeter, id: 'mf47-panel', x: 750, y: 360, rangeMode: 'DCV_10', visible: false },
];

function _doPresetWiring(sys) {
    sys.conns = [];
    const presetConns = [
        { from: 'psu_wire_p', to: 'r1_wire_l', type: 'wire' },
        { from: 'r1_wire_r', to: 'r2_wire_l', type: 'wire' },
        { from: 'r2_wire_l', to: 'vr1_wire_l', type: 'wire' },
        { from: 'r2_wire_r', to: 'gnd_wire_gnd', type: 'wire' },
        { from: 'vr1_wire_r', to: 'gnd_wire_gnd', type: 'wire' },
        { from: 'psu_wire_n', to: 'gnd2_wire_gnd', type: 'wire' },
    ];
    presetConns.forEach(c => sys.connMgr.addConn(c));
    sys.redrawAll();
}

function _disconnectMultimeter(sys) {
    const vPort = 'multimeter_wire_v';
    const maPort = 'multimeter_wire_ma';
    const comPort = 'multimeter_wire_com';
    const existing = sys.conns.filter(c =>
        c.from === vPort || c.to === vPort || c.from === maPort || c.to === maPort || c.from === comPort || c.to === comPort);
    existing.forEach(c => sys.connMgr.removeConn(c));
    sys.redrawAll();
}

function _connectMultimeterPower(sys) {
    _disconnectMultimeter(sys);
    sys.connMgr.addConn({ from: 'multimeter_wire_v', to: 'psu_wire_p', type: 'wire' });
    sys.connMgr.addConn({ from: 'multimeter_wire_com', to: 'psu_wire_n', type: 'wire' });
    sys.redrawAll();
}

function _connectToR1(sys, mode) {
    _disconnectMultimeter(sys);
    sys.connMgr.addConn({ from: 'multimeter_wire_v', to: 'r1_wire_l', type: 'wire' });
    sys.connMgr.addConn({ from: 'multimeter_wire_com', to: 'r1_wire_r', type: 'wire' });
    sys.redrawAll();
}

function _connectToR2(sys, mode) {
    _disconnectMultimeter(sys);
    sys.connMgr.addConn({ from: 'multimeter_wire_v', to: 'r2_wire_l', type: 'wire' });
    sys.connMgr.addConn({ from: 'multimeter_wire_com', to: 'r2_wire_r', type: 'wire' });
    sys.redrawAll();
}

function _connectToVR1(sys, mode) {
    _disconnectMultimeter(sys);
    sys.connMgr.addConn({ from: 'multimeter_wire_v', to: 'vr1_wire_l', type: 'wire' });
    sys.connMgr.addConn({ from: 'multimeter_wire_com', to: 'vr1_wire_r', type: 'wire' });
    sys.redrawAll();
}

function _hasConn(sys, a, b) {
    return sys.conns.some(c => (c.from === a && c.to === b) || (c.from === b && c.to === a));
}

function _removeConn(sys, from, to) {
    const idx = sys.conns.findIndex(c =>
        (c.from === from && c.to === to) || (c.from === to && c.to === from));
    if (idx >= 0) sys.connMgr.removeConn(sys.conns[idx]);
}

function _connectAmmeterToBranch(sys, branch) {
    _disconnectMultimeter(sys);
    _doPresetWiring(sys);

    if (branch === 'total') {
        _removeConn(sys, 'r1_wire_r', 'r2_wire_l');
        sys.connMgr.addConn({ from: 'r1_wire_r', to: 'multimeter_wire_ma', type: 'wire' });
        sys.connMgr.addConn({ from: 'multimeter_wire_com', to: 'r2_wire_l', type: 'wire' });
    } else if (branch === 'r2') {
        _removeConn(sys, 'r2_wire_r', 'gnd_wire_gnd');
        sys.connMgr.addConn({ from: 'r2_wire_r', to: 'multimeter_wire_ma', type: 'wire' });
        sys.connMgr.addConn({ from: 'multimeter_wire_com', to: 'gnd_wire_gnd', type: 'wire' });
    } else if (branch === 'vr1') {
        _removeConn(sys, 'vr1_wire_r', 'gnd_wire_gnd');
        sys.connMgr.addConn({ from: 'vr1_wire_r', to: 'multimeter_wire_ma', type: 'wire' });
        sys.connMgr.addConn({ from: 'multimeter_wire_com', to: 'gnd_wire_gnd', type: 'wire' });
    }
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
    const psu = sys.comps['psu'];
    if (psu) {
        psu.isOn = true;
        psu.voltage = 24;
        psu.update();
    }
}

export function fiveStep() {}
