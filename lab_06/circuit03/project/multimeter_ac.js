// 交流桥式整流电路仿真项目 — 数字万用表测量交流电压、电容、二极管
// 电路：AC源 → 桥式整流(4二极管) → 电容滤波 → 负载电阻 → GND

import { ACPower } from '../components/ACPower.js';
import { RealDiode } from '../components/RealDiode.js';
import { RealCapacitor } from '../components/RealCapacitor.js';
import { RealResistor } from '../components/RealResistor.js';
import { Ground } from '../components/Gnd.js';
import { Multimeter } from '../components/Multimeter.js';
import { MF47Multimeter } from '../components/MF47Multimeter.js';
import { AmpMeter } from '../components/AmpMeter.js';
import { SignalGenerator } from '../components/SignalGenerator.js';
import { ProcessCalibrator } from '../components/ProcessCalibrator.js';
import { Oscilloscope_tri } from '../components/Osc_tri.js';

export const FAULT_CONFIGS = {};

export const PROJECT_WORKFLOWS = {
    'ac-measure-voltage': {
        id: 'ac-measure-voltage',
        name: '1. 万用表测量桥式整流输出电压',
        steps: [
            {
                msg: '1. 打开交流电源，将电压调为 12V，频率 50Hz',
                mode: 'check',
                act() {
                    const src = this.sys.comps['ac_src'];
                    if (src) { src.isOn = true; src.voltageRMS = 12; src.frequency = 50; src.update(); }
                },
                check() {
                    const src = this.sys.comps['ac_src'];
                    return src && src.isOn && Math.abs(src.voltageRMS - 12) < 0.1;
                },
            },
            {
                msg: '2. 将数字万用表档位旋至交流 200V 档',
                mode: 'check',
                act() {
                    const mm = this.sys.comps['multimeter'];
                    if (mm) { mm.mode = 'ACV200'; mm._updateAngleByMode(); mm.update(0); }
                },
                check() {
                    const mm = this.sys.comps['multimeter'];
                    return mm && mm.mode === 'ACV200';
                },
            },
            {
                msg: '3. 将万用表红黑表笔接交流电源两端，测量交流电源电压',
                mode: 'check',
                act() {
                    _disconnectMM(this.sys);
                    this.sys.connMgr.addConn({ from: 'multimeter_wire_v', to: 'ac_src_wire_p', type: 'wire' });
                    this.sys.connMgr.addConn({ from: 'multimeter_wire_com', to: 'ac_src_wire_n', type: 'wire' });
                    this.sys.redrawAll();
                    _updateMMReading(this.sys);
                },
                check() {
                    return _sameCluster(this.sys, 'multimeter_wire_v', 'ac_src_wire_p')
                        && _sameCluster(this.sys, 'multimeter_wire_com', 'ac_src_wire_n');
                },
            },
            {
                msg: '4. 调节交流电压至 24V，观察万用表读数变化',
                mode: 'check',
                act() {
                    const src = this.sys.comps['ac_src'];
                    if (src) { src.voltageRMS = 24; src.update(); }
                    _updateMMReading(this.sys);
                },
                check() {
                    const src = this.sys.comps['ac_src'];
                    return src && Math.abs(src.voltageRMS - 24) < 0.1;
                },
            },
            {
                msg: '5. 关闭电源，接好桥式整流电路，再接通电源',
                mode: 'check',
                act() {
                    const src = this.sys.comps['ac_src'];
                    if (src) { src.isOn = false; src.update(); }
                    _doPresetWiring(this.sys);
                    if (src) { src.isOn = true; src.voltageRMS = 12; src.update(); }
                },
                check() {
                    const conns = this.sys.conns || [];
                    const has = (a, b) => conns.some(c => (c.from === a && c.to === b) || (c.from === b && c.to === a));
                    const src = this.sys.comps['ac_src'];
                    return src && src.isOn
                        && has('ac_src_wire_n', 'd1_wire_l')
                        && has('d1_wire_l', 'd3_wire_r')
                        && has('ac_src_wire_p', 'd4_wire_r')
                        && has('d2_wire_l', 'd4_wire_r')
                        && has('d1_wire_r', 'd2_wire_r')
                        && has('d2_wire_r', 'cap_wire_l')
                        && has('d3_wire_l', 'd4_wire_l')
                        && has('d4_wire_l', 'cap_wire_r')
                        && has('d2_wire_r', 'r_load_wire_l')
                        && has('d4_wire_l', 'r_load_wire_r')
                        && has('r_load_wire_r', 'gnd_wire_gnd');
                },
            },
            {
                msg: '6. 将万用表切换到直流 200V 档，测量整流输出直流电压',
                mode: 'check',
                act() {
                    const mm = this.sys.comps['multimeter'];
                    if (mm) { mm.mode = 'DCV200'; mm._updateAngleByMode(); }
                    _disconnectMM(this.sys);
                    this.sys.connMgr.addConn({ from: 'multimeter_wire_v', to: 'cap_wire_l', type: 'wire' });
                    this.sys.connMgr.addConn({ from: 'multimeter_wire_com', to: 'gnd_wire_gnd', type: 'wire' });
                    this.sys.redrawAll();
                    _updateMMReading(this.sys);
                },
                check() {
                    return _sameCluster(this.sys, 'multimeter_wire_v', 'cap_wire_l')
                        && _sameCluster(this.sys, 'multimeter_wire_com', 'gnd_wire_gnd');
                },
            },
            {
                msg: '7. 测试题：桥式整流电路',
                mode: 'quiz',
                quizConfig: {
                    question: '单相桥式整流电路中，交流输入有效值为 12V，空载直流输出电压峰值约为？',
                    options: [
                        '12V',
                        '约 17V',
                        '约 10.8V',
                        '约 24V'
                    ],
                    answer: 1,
                    analysis: '桥式整流后脉动直流电压峰值约为输入有效值的√2倍，即12×1.414≈17V。考虑二极管压降后约为15.6V。',
                },
            },
        ],
    },
    'ac-measure-diode': {
        id: 'ac-measure-diode',
        name: '2. 万用表二极管档检测整流二极管',
        steps: [
            {
                msg: '1. 将万用表旋至二极管/蜂鸣档',
                mode: 'check',
                act() {
                    const mm = this.sys.comps['multimeter'];
                    if (mm) { mm.mode = 'DIODE'; mm._updateAngleByMode(); mm.update(0); }
                },
                check() {
                    const mm = this.sys.comps['multimeter'];
                    return mm && mm.mode === 'DIODE';
                },
            },
            {
                msg: '2. 点击选中要测试的二极管 D1',
                mode: 'find',
                target: 'd1',
            },
            {
                msg: '3. 正向测试：红表笔接 D1 正极（下方），黑表笔接 D1 负极（上方），显示正向压降',
                mode: 'check',
                act() {
                    _disconnectMM(this.sys);
                    this.sys.connMgr.addConn({ from: 'multimeter_wire_v', to: 'd1_wire_l', type: 'wire' });
                    this.sys.connMgr.addConn({ from: 'multimeter_wire_com', to: 'd1_wire_r', type: 'wire' });
                    this.sys.redrawAll();
                    _updateMMReading(this.sys);
                },
                check() {
                    return _sameCluster(this.sys, 'multimeter_wire_v', 'd1_wire_l')
                        && _sameCluster(this.sys, 'multimeter_wire_com', 'd1_wire_r');
                },
            },
            {
                msg: '4. 反向测试：红表笔接 D1 负极（上方），黑表笔接 D1 正极（下方），显示 O.L',
                mode: 'check',
                act() {
                    _disconnectMM(this.sys);
                    this.sys.connMgr.addConn({ from: 'multimeter_wire_v', to: 'd1_wire_r', type: 'wire' });
                    this.sys.connMgr.addConn({ from: 'multimeter_wire_com', to: 'd1_wire_l', type: 'wire' });
                    this.sys.redrawAll();
                    _updateMMReading(this.sys);
                },
                check() {
                    return _sameCluster(this.sys, 'multimeter_wire_v', 'd1_wire_r')
                        && _sameCluster(this.sys, 'multimeter_wire_com', 'd1_wire_l');
                },
            },
            {
                msg: '5. 测试题：二极管特性',
                mode: 'quiz',
                quizConfig: {
                    question: '硅二极管的正向导通压降通常约为？',
                    options: [
                        '0.2V',
                        '0.7V',
                        '1.4V',
                        '5V'
                    ],
                    answer: 1,
                    analysis: '硅二极管的正向导通压降约为0.6~0.8V。',
                },
            },
        ],
    },
    'ac-measure-cap': {
        id: 'ac-measure-cap',
        name: '3. 万用表测量滤波电容',
        steps: [
            {
                msg: '1. 检查电容两端电压，确保已放电',
                mode: 'check',
                act() {
                    const src = this.sys.comps['ac_src'];
                    if (src) { src.isOn = false; src.update(); }
                },
                check() {
                    const sys = this.sys;
                    const capV = Math.abs(sys.getVoltageBetween('cap_wire_r', 'cap_wire_l') || 0);
                    return capV < 0.5;
                },
            },
            {
                msg: '2. 将万用表旋至电容器档',
                mode: 'check',
                act() {
                    const mm = this.sys.comps['multimeter'];
                    if (mm) { mm.mode = 'C'; mm._updateAngleByMode(); mm.update(0); }
                },
                check() {
                    const mm = this.sys.comps['multimeter'];
                    return mm && mm.mode === 'C';
                },
            },
            {
                msg: '3. 红黑表笔接电容两端，读取电容值',
                mode: 'check',
                act() {
                    _disconnectMM(this.sys);
                    this.sys.connMgr.addConn({ from: 'multimeter_wire_v', to: 'cap_wire_l', type: 'wire' });
                    this.sys.connMgr.addConn({ from: 'multimeter_wire_com', to: 'cap_wire_r', type: 'wire' });
                    this.sys.redrawAll();
                },
                check() {
                    return _sameCluster(this.sys, 'multimeter_wire_v', 'cap_wire_l')
                        && _sameCluster(this.sys, 'multimeter_wire_com', 'cap_wire_r');
                },
            },
            {
                msg: '4. 测试题：电容测量',
                mode: 'quiz',
                quizConfig: {
                    question: '用数字万用表电容档测量电解电容时，以下哪项操作正确？',
                    options: [
                        '直接在线测量，无需放电',
                        '红表笔接负极、黑表笔接正极',
                        '将电容短路放电后再测量',
                        '电容档可测量带电电容'
                    ],
                    answer: 2,
                    analysis: '测量前应将电容放电（短路），红表笔接正极、黑表笔接负极。',
                },
            },
        ],
    },
};

export const componentConfigs = [
    // 1. 桥式整流主电路
    { Class: ACPower, id: 'ac_src', x: 120, y: 90, voltageRMS: 12, frequency: 50, isOn: false },

    // 4个二极管：垂直放置，负极（阴极）朝上
    { Class: RealDiode, id: 'd1', x: 400, y: 180, vForward: 0.7, rotation: -90 },
    { Class: RealDiode, id: 'd2', x: 480, y: 180, vForward: 0.7, rotation: -90 },
    { Class: RealDiode, id: 'd3', x: 400, y: 350, vForward: 0.7, rotation: -90 },
    { Class: RealDiode, id: 'd4', x: 480, y: 350, vForward: 0.7, rotation: -90 },

    // 滤波电容：实物电容（引脚向下，垂直放置）
    { Class: RealCapacitor, id: 'cap', x: 640, y: 260, capacitance: 100e-6, rotation: 90},

    // 负载电阻：垂直放置
    { Class: RealResistor, id: 'r_load', x: 760, y: 260, value: 1000 },

    // 接地
    { Class: Ground, id: 'gnd', x: 760, y: 380 },

    // 2. 数字万用表（初始隐藏，通过仪表菜单显示）
    { Class: Multimeter, id: 'multimeter', x: 950, y: 30, scale: 1.1 },

    // 指针式万用表（默认隐藏，通过仪表菜单显示）
    { Class: MF47Multimeter, id: 'mf47-panel', x: 750, y: 360, visible: false },

    // 3. 辅助仪表（初始隐藏）
    { Class: AmpMeter, id: 'ampmeter', x: 300, y: 500, visible: false },
    { Class: SignalGenerator, id: 'sg', x: 80, y: 550, visible: false },
    { Class: ProcessCalibrator, id: 'cali', x: 550, y: 500, visible: false },
    { Class: Oscilloscope_tri, id: 'osc3', x: 950, y: 500, visible: false },
];

function _doPresetWiring(sys) {
    sys.conns = [];

    const presetConns = [
        { from: 'ac_src_wire_n', to: 'd1_wire_l', type: 'wire' },
        { from: 'd1_wire_l', to: 'd3_wire_r', type: 'wire' },
        { from: 'ac_src_wire_p', to: 'd4_wire_r', type: 'wire' },
        { from: 'd2_wire_l', to: 'd4_wire_r', type: 'wire' },

        { from: 'd1_wire_r', to: 'd2_wire_r', type: 'wire' },
        { from: 'd2_wire_r', to: 'cap_wire_l', type: 'wire' },
        { from: 'd3_wire_l', to: 'd4_wire_l', type: 'wire' },
        { from: 'd4_wire_l', to: 'cap_wire_r', type: 'wire' },

        { from: 'd2_wire_r', to: 'r_load_wire_l', type: 'wire' },
        { from: 'd4_wire_l', to: 'r_load_wire_r', type: 'wire' },
        { from: 'r_load_wire_r', to: 'gnd_wire_gnd', type: 'wire' },
    ];

    presetConns.forEach(c => sys.connMgr.addConn(c));
    sys.redrawAll();
}

function _disconnectMM(sys) {
    const ports = ['multimeter_wire_v', 'multimeter_wire_com', 'multimeter_wire_ma'];
    const existing = sys.conns.filter(c =>
        ports.includes(c.from) || ports.includes(c.to));
    existing.forEach(c => sys.connMgr.removeConn(c));
    sys.redrawAll();
}

function _sameCluster(sys, portA, portB) {
    const map = sys.voltageSolver?.portToCluster;
    if (!map) return false;
    const cA = map.get(portA);
    const cB = map.get(portB);
    return cA !== undefined && cA === cB;
}

function _updateMMReading(sys) {
    const mm = sys.comps['multimeter'];
    if (!mm) return;
    const vPort = mm.id + '_wire_v';
    const comPort = mm.id + '_wire_com';
    try {
        const voltage = Math.abs(sys.getVoltageBetween(vPort, comPort) || 0);
        if (mm.mode === 'RES2k' || mm.mode === 'RES200' || mm.mode === 'RES200k') {
            const R = sys.voltageSolver?.getResistanceBetweenPorts(vPort, comPort);
            if (R === undefined || R === Infinity || R > 1e8) {
                mm.update(1e9);
            } else {
                mm.update(R);
            }
        } else if (mm.mode === 'DIODE') {
            const wired = sys.conns.some(c =>
                c.from === vPort || c.to === vPort || c.from === comPort || c.to === comPort);
            if (!wired || voltage < 0.05 || voltage > 1.5) {
                mm.update(1e9);
            } else {
                mm.update(0.6868);
            }
        } else if (mm.mode === 'C') {
            const cap = sys.comps['cap'];
            const onCap = cap && sys.conns.some(c =>
                (c.from === vPort && c.to === cap.id + '_wire_r') ||
                (c.to === vPort && c.from === cap.id + '_wire_r') ||
                (c.from === comPort && c.to === cap.id + '_wire_l') ||
                (c.to === comPort && c.from === cap.id + '_wire_l'));
            if (onCap) {
                mm.update(cap.capacitance * 1e6);
            } else {
                mm.update(0);
            }
        } else {
            mm.update(voltage);
        }
    } catch (e) { }
}

export function initSlider(sys) {
    const toolbar = document.getElementById('toolbar');

    const existing = document.getElementById('acSliderContainer');
    if (existing) existing.remove();

    const container = document.createElement('div');
    container.id = 'acSliderContainer';
    container.style.cssText = 'display:inline-flex;align-items:center;gap:6px;margin-left:12px;';
    container.innerHTML = '\
        <span style="font-size:12px;font-weight:bold;color:white;">交流电压:</span>\
        <input type="range" id="acVoltageSlider" min="1" max="30" value="12" step="0.5" style="width:160px;">\
        <span id="acVoltageDisplay" style="font-size:12px;min-width:70px;color:white;">12.0 V</span>\
    ';
    toolbar.appendChild(container);

    const slider = document.getElementById('acVoltageSlider');
    const display = document.getElementById('acVoltageDisplay');

    slider.addEventListener('input', () => {
        const val = parseFloat(slider.value) || 12;
        const src = sys.comps['ac_src'];
        if (src) {
            src.voltageRMS = val;
            src.update();
        }
        display.textContent = val.toFixed(1) + ' V';
    });
}

export function applyAllPresets() {
    _doPresetWiring(this.sys);
}

export async function applyStartSystem() {
    const sys = this.sys;
    _doPresetWiring(sys);
    const src = sys.comps['ac_src'];
    if (src) {
        src.isOn = true;
        src.voltageRMS = 12;
        src.frequency = 50;
        src.update();
    }
    const mm = sys.comps['multimeter'];
    if (mm) {
        mm.mode = 'DCV200';
        mm._updateAngleByMode();
        mm.update(0);
    }
    const slider = document.getElementById('acVoltageSlider');
    const display = document.getElementById('acVoltageDisplay');
    if (slider) slider.value = 12;
    if (display) display.textContent = '12.0 V';
}

export function fiveStep() {
    const src = this.sys.comps['ac_src'];
    if (!src || !src.isOn) return;

    const slider = document.getElementById('acVoltageSlider');
    const display = document.getElementById('acVoltageDisplay');
    if (!slider) return;

    const steps = [1, 3, 5, 9, 12, 18, 24, 30];
    const current = parseFloat(slider.value) || 12;

    let nextVal = steps[0];
    for (const s of steps) {
        if (Math.abs(s - current) < 0.25) {
            const idx = steps.indexOf(s);
            nextVal = steps[(idx + 1) % steps.length];
            break;
        }
    }

    slider.value = nextVal;
    src.voltageRMS = nextVal;
    src.update();
    display.textContent = nextVal.toFixed(1) + ' V';
}
