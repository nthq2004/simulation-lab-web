// 交流桥式整流电路仿真项目 — MF47 指针式万用表测量交流电压、电容、二极管
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
    'mf47-ac-measure-voltage': {
        id: 'mf47-ac-measure-voltage',
        name: '1. MF47 指针万用表测量桥式整流输出电压',
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
                msg: '2. 点击表盘上的机械调零螺丝，将指针调整到零位',
                mode: 'check',
                act() {
                    const mm = this.sys.comps['mf47-panel'];
                    if (mm) { mm._mechanicalOffset = 0; mm.config.mechanicalOffset = 0; mm._updateDynamic(); mm.markDirty(); }
                },
                check() {
                    const mm = this.sys.comps['mf47-panel'];
                    return mm && Math.abs(mm._mechanicalOffset) < 0.001;
                },
            },
            {
                msg: '3. 将 MF47 档位旋至交流 50V 档（ACV 区域）',
                mode: 'check',
                act() {
                    const mm = this.sys.comps['mf47-panel'];
                    if (mm) { mm.setRange('ACV50'); }
                },
                check() {
                    const mm = this.sys.comps['mf47-panel'];
                    return mm && mm._rangeId === 'ACV50';
                },
            },
            {
                msg: '4. 将 MF47 红黑表笔接交流电源两端，测量交流电源电压',
                mode: 'check',
                act() {
                    _disconnectMF47(this.sys);
                    this.sys.connMgr.addConn({ from: 'mf47-panel_wire_v', to: 'ac_src_wire_p', type: 'wire' });
                    this.sys.connMgr.addConn({ from: 'mf47-panel_wire_COM', to: 'ac_src_wire_n', type: 'wire' });
                    this.sys.redrawAll();
                },
                check() {
                    return _sameCluster(this.sys, 'mf47-panel_wire_v', 'ac_src_wire_p')
                        && _sameCluster(this.sys, 'mf47-panel_wire_COM', 'ac_src_wire_n');
                },
            },
            {
                msg: '5. 调节交流电压至 24V，观察指针偏转变化',
                mode: 'check',
                act() {
                    const src = this.sys.comps['ac_src'];
                    if (src) { src.voltageRMS = 24; src.update(); }
                },
                check() {
                    const src = this.sys.comps['ac_src'];
                    return src && Math.abs(src.voltageRMS - 24) < 0.1;
                },
            },
            {
                msg: '6. 关闭电源，接好桥式整流电路，再接通电源',
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
                msg: '7. 将 MF47 切换到直流 50V 档，测量整流输出直流电压',
                mode: 'check',
                act() {
                    const mm = this.sys.comps['mf47-panel'];
                    if (mm) { mm.setRange('DCV50'); }
                    _disconnectMF47(this.sys);
                    this.sys.connMgr.addConn({ from: 'mf47-panel_wire_v', to: 'cap_wire_l', type: 'wire' });
                    this.sys.connMgr.addConn({ from: 'mf47-panel_wire_COM', to: 'gnd_wire_gnd', type: 'wire' });
                    this.sys.redrawAll();
                },
                check() {
                    return _sameCluster(this.sys, 'mf47-panel_wire_v', 'cap_wire_l')
                        && _sameCluster(this.sys, 'mf47-panel_wire_COM', 'gnd_wire_gnd');
                },
            },
            {
                msg: '8. 测试题：桥式整流电路',
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
    'mf47-ac-measure-diode': {
        id: 'mf47-ac-measure-diode',
        name: '2. MF47 指针万用表检测整流二极管',
        steps: [
            {
                msg: '1. 点击表盘上的机械调零螺丝，将指针调整到零位',
                mode: 'check',
                act() {
                    const mm = this.sys.comps['mf47-panel'];
                    if (mm) { mm._mechanicalOffset = 0; mm.config.mechanicalOffset = 0; mm._updateDynamic(); mm.markDirty(); }
                },
                check() {
                    const mm = this.sys.comps['mf47-panel'];
                    return mm && Math.abs(mm._mechanicalOffset) < 0.001;
                },
            },
            {
                msg: '2. 将 MF47 旋至 Ω×10 档',
                mode: 'check',
                act() {
                    const mm = this.sys.comps['mf47-panel'];
                    if (mm) { mm.setRange('OHM10'); }
                },
                check() {
                    const mm = this.sys.comps['mf47-panel'];
                    return mm && mm._rangeId === 'OHM10';
                },
            },
            {
                msg: '3. 短接红黑表笔，进行欧姆调零（旋转欧姆调零旋钮使指针指到 Ω 刻度 0 位）',
                mode: 'check',
                act() {
                    const mm = this.sys.comps['mf47-panel'];
                    if (mm) { mm._ohmZeroAdjust = 1; mm.config.ohmZeroAdjust = 1; mm.markDirty(); }
                },
                check() {
                    const mm = this.sys.comps['mf47-panel'];
                    return mm && mm._ohmZeroAdjust >= 0.99;
                },
            },
            {
                msg: '4. 点击选中要测试的二极管 D1',
                mode: 'find',
                target: 'd1',
            },
            {
                msg: '5. 正向测试：黑表笔接 D1 阳极（下方），红表笔接 D1 阴极（上方），指针应偏转（约 2000Ω 左右）',
                mode: 'check',
                act() {
                    _disconnectMF47(this.sys);
                    this.sys.connMgr.addConn({ from: 'mf47-panel_wire_v', to: 'd1_wire_r', type: 'wire' });
                    this.sys.connMgr.addConn({ from: 'mf47-panel_wire_COM', to: 'd1_wire_l', type: 'wire' });
                    this.sys.redrawAll();
                },
                check() {
                    return _sameCluster(this.sys, 'mf47-panel_wire_v', 'd1_wire_r')
                        && _sameCluster(this.sys, 'mf47-panel_wire_COM', 'd1_wire_l');
                },
            },
            {
                msg: '6. 反向测试：红表笔接 D1 负极（上方），黑表笔接 D1 正极（下方），指针应不动（∞）',
                mode: 'check',
                act() {
                    _disconnectMF47(this.sys);
                    this.sys.connMgr.addConn({ from: 'mf47-panel_wire_v', to: 'd1_wire_l', type: 'wire' });
                    this.sys.connMgr.addConn({ from: 'mf47-panel_wire_COM', to: 'd1_wire_r', type: 'wire' });
                    this.sys.redrawAll();
                },
                check() {
                    return _sameCluster(this.sys, 'mf47-panel_wire_v', 'd1_wire_l')
                        && _sameCluster(this.sys, 'mf47-panel_wire_COM', 'd1_wire_r');
                },
            },
            {
                msg: '7. 测试题：二极管特性',
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
                    analysis: '硅二极管的正向导通压降约为0.6~0.8V。用 MF47 电阻档测量时，正向电阻约几百欧姆。',
                },
            },
        ],
    },
    'mf47-ac-measure-cap': {
        id: 'mf47-ac-measure-cap',
        name: '3. MF47 指针万用表检测滤波电容',
        steps: [
            {
                msg: '1. 点击表盘上的机械调零螺丝，将指针调整到零位',
                mode: 'check',
                act() {
                    const mm = this.sys.comps['mf47-panel'];
                    if (mm) { mm._mechanicalOffset = 0; mm.config.mechanicalOffset = 0; mm._updateDynamic(); mm.markDirty(); }
                },
                check() {
                    const mm = this.sys.comps['mf47-panel'];
                    return mm && Math.abs(mm._mechanicalOffset) < 0.001;
                },
            },
            {
                msg: '2. 将 MF47 旋至 Ω×100 档',
                mode: 'check',
                act() {
                    const mm = this.sys.comps['mf47-panel'];
                    if (mm) { mm.setRange('OHM100'); }
                },
                check() {
                    const mm = this.sys.comps['mf47-panel'];
                    return mm && mm._rangeId === 'OHM100';
                },
            },
            {
                msg: '3. 再次进行欧姆调零',
                mode: 'check',
                act() {
                    const mm = this.sys.comps['mf47-panel'];
                    if (mm) { mm._ohmZeroAdjust = 1; mm.config.ohmZeroAdjust = 1; mm.markDirty(); }
                },
                check() {
                    const mm = this.sys.comps['mf47-panel'];
                    return mm && mm._ohmZeroAdjust >= 0.99;
                },
            },
            {
                msg: '4. 红黑表笔接电容两端，观察指针先偏转后逐渐归零（电容充电过程）',
                mode: 'check',
                act() {
                    _disconnectMF47(this.sys);
                    this.sys.connMgr.addConn({ from: 'mf47-panel_wire_v', to: 'cap_wire_l', type: 'wire' });
                    this.sys.connMgr.addConn({ from: 'mf47-panel_wire_COM', to: 'cap_wire_r', type: 'wire' });
                    this.sys.redrawAll();
                },
                check() {
                    return _sameCluster(this.sys, 'mf47-panel_wire_v', 'cap_wire_l')
                        && _sameCluster(this.sys, 'mf47-panel_wire_COM', 'cap_wire_r');
                },
            },
            {
                msg: '5. 交换表笔再次测量，指针偏转幅度很大（反向充电），说明电容正常',
                mode: 'check',
                act() {
                    _disconnectMF47(this.sys);
                    this.sys.connMgr.addConn({ from: 'mf47-panel_wire_v', to: 'cap_wire_r', type: 'wire' });
                    this.sys.connMgr.addConn({ from: 'mf47-panel_wire_COM', to: 'cap_wire_l', type: 'wire' });
                    this.sys.redrawAll();
                },
                check() {
                    return _sameCluster(this.sys, 'mf47-panel_wire_v', 'cap_wire_r')
                        && _sameCluster(this.sys, 'mf47-panel_wire_COM', 'cap_wire_l');
                },
            },
            {
                msg: '6. 测试题：电容测量',
                mode: 'quiz',
                quizConfig: {
                    question: '用指针式万用表电阻档检测电容好坏时，以下哪项现象说明电容正常？',
                    options: [
                        '指针始终在∞处不动',
                        '指针快速偏转后逐渐回到∞处',
                        '指针指到 0Ω 不动',
                        '指针在中间位置摆动'
                    ],
                    answer: 1,
                    analysis: '用电阻档测电容时，指针应快速偏转（充电电流大），然后缓慢回∞（充电完成），说明电容正常。',
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
    { Class: RealCapacitor, id: 'cap', x: 640, y: 260, capacitance: 10e-6, rotation: 90},

    // 负载电阻：垂直放置
    { Class: RealResistor, id: 'r_load', x: 760, y: 260, value: 1000 },

    // 接地
    { Class: Ground, id: 'gnd', x: 760, y: 380 },

    // 指针式万用表（主仪表，默认显示）
    { Class: MF47Multimeter, id: 'mf47-panel', x: 950, y: 30, scale: 1.1, rangeId: 'ACV500', mechanicalOffset: 0.05, visible: true },

    // 数字万用表（默认隐藏）
    { Class: Multimeter, id: 'multimeter', x: 1100, y: 360, scale: 1.1, visible: false },

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

function _disconnectMF47(sys) {
    const ports = ['mf47-panel_wire_v', 'mf47-panel_wire_COM', 'mf47-panel_wire_mA'];
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
    const mm = sys.comps['mf47-panel'];
    if (mm) {
        mm.setRange('DCV50');
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
