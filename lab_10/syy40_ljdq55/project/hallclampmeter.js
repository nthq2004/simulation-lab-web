import { ACPower } from '../components/ACPower.js';
import { DCPower } from '../components/DCPower.js';
import { Resistor } from '../components/Resistor.js';
import { Capacitor } from '../components/Capacitor.js';
import { HallClampMeter } from '../components/HallClampMeter.js';
import { Ground } from '../components/Gnd.js';

import { AmpMeter } from '../components/AmpMeter.js';
import { MF47Multimeter } from '../components/MF47Multimeter.js';
import { Multimeter } from '../components/Multimeter.js';
import { SignalGenerator } from '../components/SignalGenerator.js';
import { ProcessCalibrator } from '../components/ProcessCalibrator.js';
import { Oscilloscope_tri } from '../components/Osc_tri.js';

let _circuitMode = 'ac';

export const FAULT_CONFIGS = {
    zero_offset: {
        id: 'zero_offset',
        name: '零点偏移',
        system: '霍尔数字钳形电流表',
        check() {
            const c = window.sys && window.sys.comps && window.sys.comps['hallclamp'];
            return c && c._holdMode !== false && c._holdValue > 0.01;
        },
        trigger() {
            const c = window.sys && window.sys.comps && window.sys.comps['hallclamp'];
            if (c) { c._holdMode = true; c._holdValue = 0.03; }
        },
        repair() {
            const c = window.sys && window.sys.comps && window.sys.comps['hallclamp'];
            if (c) { c._holdMode = false; c._holdValue = undefined; }
        },
    },
    oil_contamination: {
        id: 'oil_contamination',
        name: '钳口油污',
        system: '霍尔数字钳形电流表',
        check() {
            const c = window.sys && window.sys.comps && window.sys.comps['hallclamp'];
            return c && c._oilFault;
        },
        trigger() {
            const c = window.sys && window.sys.comps && window.sys.comps['hallclamp'];
            if (c) c._oilFault = true;
        },
        repair() {
            const c = window.sys && window.sys.comps && window.sys.comps['hallclamp'];
            if (c) c._oilFault = false;
        },
    },
};

export const PROJECT_WORKFLOWS = {
    'hallclampmeter-ac': {
        id: 'hallclampmeter-ac',
        name: '霍尔钳形电流表测量交流电流',
        steps: [
            {
                msg: '1. 切换到交流模式，连接交流电路',
                mode: 'check',
                act() {
                    switchMode('ac');
                    _doPresetWiringAC(this.sys);
                },
                check() {
                    const conns = this.sys.conns || [];
                    const has = (a, b) => conns.some(c => (c.from === a && c.to === b) || (c.from === b && c.to === a));
                    return has('ac_power_wire_p', 'r_load_ac_wire_l')
                        && has('r_load_ac_wire_r', 'c_load_wire_l')
                        && has('c_load_wire_r', 'gnd_wire_gnd')
                        && has('ac_power_wire_n', 'gnd_wire_gnd');
                },
            },
            {
                msg: '2. 开启交流电源，并调节电压到100V',
                mode: 'check',
                act() {
                    const power = this.sys.comps['ac_power'];
                    if (power) {
                        power.vRms = 100;
                        power.isOn = true;
                        power.update();
                    }
                    const hcm = this.sys.comps['hallclamp'];
                    if (hcm) hcm.setMode(false);
                    const sl = document.getElementById('acVoltageSlider');
                    const vd = document.getElementById('voltageDisplay');
                    if (sl) sl.value = 100;
                    if (vd) vd.textContent = '100 V';
                },
                check() {
                    const power = this.sys.comps['ac_power'];
                    if (!power || !power.isOn) return false;
                    const v = power.vRms || 0;
                    return v >= 95 && v <= 105;
                },
            },
            {
                msg: '3. 将霍尔钳形电流表打到250A档',
                mode: 'check',
                act() {
                    const hcm = this.sys.comps['hallclamp'];
                    if (hcm) hcm.setRange('250');
                },
                check() {
                    const hcm = this.sys.comps['hallclamp'];
                    return hcm && hcm._range === 250;
                },
            },
            {
                msg: '4. 打开钳口，钳入导线，合上钳口',
                mode: 'check',
                async act() {
                    const hcm = this.sys.comps['hallclamp'];
                    if (!hcm) return;
                    hcm._jawOpen = true;
                    await new Promise(r => setTimeout(r, 1000));
                    hcm._jawOpen = false;
                    hcm._measuring = true;
                    await new Promise(r => setTimeout(r, 500));
                },
                check() {
                    const hcm = this.sys.comps['hallclamp'];
                    return hcm && hcm._measuring === true;
                },
            },
            {
                msg: '5. 打开钳口，移出，合上钳口',
                mode: 'check',
                async act() {
                    const hcm = this.sys.comps['hallclamp'];
                    if (!hcm) return;
                    hcm._jawOpen = true;
                    await new Promise(r => setTimeout(r, 800));
                    hcm._jawOpen = false;
                    hcm._measuring = false;
                    await new Promise(r => setTimeout(r, 400));
                },
                check() {
                    const hcm = this.sys.comps['hallclamp'];
                    return hcm && hcm._measuring === false;
                },
            },
            {
                msg: '6. 改变量程到5A档',
                mode: 'check',
                act() {
                    const hcm = this.sys.comps['hallclamp'];
                    if (hcm) hcm.setRange('5');
                },
                check() {
                    const hcm = this.sys.comps['hallclamp'];
                    return hcm && hcm._range === 5;
                },
            },
            {
                msg: '7. 打开钳口，重新钳入导线，合上钳口',
                mode: 'check',
                async act() {
                    const hcm = this.sys.comps['hallclamp'];
                    if (!hcm) return;
                    hcm._jawOpen = true;
                    await new Promise(r => setTimeout(r, 800));
                    hcm._jawOpen = false;
                    hcm._measuring = true;
                    await new Promise(r => setTimeout(r, 400));
                },
                check() {
                    const hcm = this.sys.comps['hallclamp'];
                    return hcm && hcm._measuring === true;
                },
            },
            {
                msg: '8. 读取电流值，选择正确答案',
                mode: 'quiz',
                quizConfig: {
                    question: '此时霍尔钳形电流表的读数为？',
                    options: ['0.95A', '1.50A', '0.65A', '1.85A'],
                    answer: 0,
                    analysis: '电路总阻抗 Z = √(R² + Xc²) = √(100² + 31.83²) ≈ 104.9Ω。I = V / Z = 100V / 104.9Ω ≈ 0.95A。',
                },
            },
            {
                msg: '9. 测试题：霍尔钳形电流表的特征',
                mode: 'quiz',
                quizConfig: {
                    question: '关于霍尔效应钳形电流表，以下哪项描述是正确的？',
                    options: [
                        '只能测量交流电流',
                        '利用电磁感应原理，需二次绕组',
                        '可同时测量直流和交流电流',
                        '测量时必须断开电路'
                    ],
                    answer: 2,
                    analysis: '霍尔效应钳形电流表利用霍尔元件检测电流产生的磁场，可同时测量直流和交流电流，无需断开电路，也不需要二次绕组。',
                },
            },
        ],
    },
    'hallclampmeter-dc': {
        id: 'hallclampmeter-dc',
        name: '霍尔钳形电流表测量直流电流',
        steps: [
            {
                msg: '1. 切换到直流模式，连接直流电路',
                mode: 'check',
                act() {
                    switchMode('dc');
                    _doPresetWiringDC(this.sys);
                },
                check() {
                    const conns = this.sys.conns || [];
                    const has = (a, b) => conns.some(c => (c.from === a && c.to === b) || (c.from === b && c.to === a));
                    return has('dc_power_wire_p', 'r_load_dc_wire_l')
                        && has('r_load_dc_wire_r', 'gnd_wire_gnd')
                        && has('dc_power_wire_n', 'gnd_wire_gnd');
                },
            },
            {
                msg: '2. 开启直流电源，并调节电压到12V',
                mode: 'check',
                act() {
                    const power = this.sys.comps['dc_power'];
                    if (power) {
                        power.voltage = 12;
                        power.isOn = true;
                        power.update();
                    }
                    const hcm = this.sys.comps['hallclamp'];
                    if (hcm) hcm.setMode(true);
                    const sl = document.getElementById('dcVoltageSlider');
                    const vd = document.getElementById('voltageDisplay');
                    if (sl) sl.value = 12;
                    if (vd) vd.textContent = '12 V';
                },
                check() {
                    const power = this.sys.comps['dc_power'];
                    if (!power || !power.isOn) return false;
                    const v = power.voltage || 0;
                    return v >= 10 && v <= 14;
                },
            },
            {
                msg: '3. 将霍尔钳形电流表打到5A档',
                mode: 'check',
                act() {
                    const hcm = this.sys.comps['hallclamp'];
                    if (hcm) hcm.setRange('5');
                },
                check() {
                    const hcm = this.sys.comps['hallclamp'];
                    return hcm && hcm._range === 5;
                },
            },
            {
                msg: '4. 打开钳口，钳入导线，合上钳口',
                mode: 'check',
                async act() {
                    const hcm = this.sys.comps['hallclamp'];
                    if (!hcm) return;
                    hcm._jawOpen = true;
                    await new Promise(r => setTimeout(r, 1000));
                    hcm._jawOpen = false;
                    hcm._measuring = true;
                    await new Promise(r => setTimeout(r, 500));
                },
                check() {
                    const hcm = this.sys.comps['hallclamp'];
                    return hcm && hcm._measuring === true;
                },
            },
            {
                msg: '5. 读取电流值，选择正确答案',
                mode: 'quiz',
                quizConfig: {
                    question: '此时霍尔钳形电流表的读数为？',
                    options: ['0.08A', '0.12A', '0.15A', '0.24A'],
                    answer: 1,
                    analysis: 'I = V / R = 12V / 100Ω = 0.12A。',
                },
            },
            {
                msg: '6. 打开钳口，移出，合上钳口',
                mode: 'check',
                async act() {
                    const hcm = this.sys.comps['hallclamp'];
                    if (!hcm) return;
                    hcm._jawOpen = true;
                    await new Promise(r => setTimeout(r, 800));
                    hcm._jawOpen = false;
                    hcm._measuring = false;
                    await new Promise(r => setTimeout(r, 400));
                },
                check() {
                    const hcm = this.sys.comps['hallclamp'];
                    return hcm && hcm._measuring === false;
                },
            },
            {
                msg: '7. 测试题：霍尔效应测量原理',
                mode: 'quiz',
                quizConfig: {
                    question: '霍尔元件在钳形电流表中的作用是？',
                    options: [
                        '将电流转换为电压',
                        '检测电流产生的磁场',
                        '放大被测信号',
                        '整流交流信号'
                    ],
                    answer: 1,
                    analysis: '霍尔元件利用霍尔效应检测通电导线产生的磁场，磁场强度与电流成正比，从而间接测量电流。霍尔效应可响应静态磁场，因此可测量直流电流。',
                },
            },
        ],
    },
};

function switchMode(mode) {
    _circuitMode = mode;
    const sys = window.sys;
    if (!sys || !sys.comps) return;

    const acComps = ['ac_power', 'r_load_ac', 'c_load'];
    const dcComps = ['dc_power', 'r_load_dc'];
    const modeBtn = document.getElementById('modeToggle');
    if (modeBtn) {
        modeBtn.textContent = mode === 'ac' ? '直流' : '交流';
        modeBtn.style.background = mode === 'ac' ? '#2d8cf0' : '#f0a030';
    }

    acComps.forEach(id => {
        const c = sys.comps[id];
        if (c && c.group) c.group.visible(mode === 'ac');
    });
    dcComps.forEach(id => {
        const c = sys.comps[id];
        if (c && c.group) c.group.visible(mode === 'dc');
    });

    const hcm = sys.comps['hallclamp'];
    if (hcm) hcm.setMode(mode === 'dc');

    const sliderArea = document.getElementById('sliderArea');
    if (sliderArea) {
        sliderArea.innerHTML = '';
        if (mode === 'ac') {
            const sl = document.createElement('input');
            sl.type = 'range'; sl.id = 'acVoltageSlider'; sl.min = 0; sl.max = 220; sl.step = 1; sl.value = 50;
            sl.style.cssText = 'width:120px;vertical-align:middle;';
            sliderArea.appendChild(sl);
            sliderArea.appendChild(document.createTextNode(' '));
            const span = document.createElement('span');
            span.id = 'voltageDisplay'; span.style.cssText = 'font-size:12px;min-width:55px;color:#0f0;';
            span.textContent = '50 V';
            sliderArea.appendChild(span);
            bindSlider('ac');
        } else {
            const sl = document.createElement('input');
            sl.type = 'range'; sl.id = 'dcVoltageSlider'; sl.min = 0; sl.max = 24; sl.step = 0.5; sl.value = 12;
            sl.style.cssText = 'width:120px;vertical-align:middle;';
            sliderArea.appendChild(sl);
            sliderArea.appendChild(document.createTextNode(' '));
            const span = document.createElement('span');
            span.id = 'voltageDisplay'; span.style.cssText = 'font-size:12px;min-width:55px;color:#0f0;';
            span.textContent = '12 V';
            sliderArea.appendChild(span);
            bindSlider('dc');
        }
    }

    if (!modeBtn || !sliderArea) return;
    sys.redrawAll();
}

function bindSlider(mode) {
    const sys = window.sys;
    if (mode === 'ac') {
        const sl = document.getElementById('acVoltageSlider');
        const vd = document.getElementById('voltageDisplay');
        if (!sl) return;
        sl.oninput = () => {
            const v = parseFloat(sl.value) || 0;
            const power = sys.comps['ac_power'];
            const hcm = sys.comps['hallclamp'];
            if (power) {
                power.vRms = v;
                power.isOn = v > 0;
                power.update();
            }
            if (vd) vd.textContent = v.toFixed(0) + ' V';
            const rms = _calcCurrentAC();
            if (hcm) hcm.setCurrent(rms);
            const cd = document.getElementById('currentDisplay');
            if (cd) cd.textContent = rms.toFixed(3) + ' A';
        };
    } else {
        const sl = document.getElementById('dcVoltageSlider');
        const vd = document.getElementById('voltageDisplay');
        if (!sl) return;
        sl.oninput = () => {
            const v = parseFloat(sl.value) || 0;
            const power = sys.comps['dc_power'];
            const hcm = sys.comps['hallclamp'];
            if (power) {
                power.voltage = v;
                power.isOn = v > 0;
                power.update();
            }
            if (vd) vd.textContent = v.toFixed(1) + ' V';
            const dc = _calcCurrentDC();
            if (hcm) hcm.setCurrent(dc);
            const cd = document.getElementById('currentDisplay');
            if (cd) cd.textContent = dc.toFixed(3) + ' A';
        };
    }
}

function _calcCurrentAC() {
    const sys = window.sys;
    if (!sys) return 0;
    const conns = sys.conns || [];
    const has = (a, b) => conns.some(c => (c.from === a && c.to === b) || (c.from === b && c.to === a));
    if (!has('ac_power_wire_p', 'r_load_ac_wire_l')
        || !has('r_load_ac_wire_r', 'c_load_wire_l')
        || !has('c_load_wire_r', 'gnd_wire_gnd')
        || !has('ac_power_wire_n', 'gnd_wire_gnd')) return 0;
    const power = sys.comps['ac_power'];
    if (!power || !power.isOn) return 0;
    const r = sys.comps['r_load_ac'];
    const c = sys.comps['c_load'];
    if (!r || !c) return 0;
    const Vrms = power.vRms || 0;
    const R = r.getValue ? r.getValue() : (r.value || 100);
    const C = c.getValue ? c.getValue() : (c.value || 100e-6);
    const f = power.freq || 50;
    const Xc = 1 / (2 * Math.PI * f * C);
    const Z = Math.sqrt(R * R + Xc * Xc);
    return Z > 0 ? Vrms / Z : 0;
}

function _calcCurrentDC() {
    const sys = window.sys;
    if (!sys) return 0;
    const conns = sys.conns || [];
    const has = (a, b) => conns.some(c => (c.from === a && c.to === b) || (c.from === b && c.to === a));
    if (!has('dc_power_wire_p', 'r_load_dc_wire_l')
        || !has('r_load_dc_wire_r', 'gnd_wire_gnd')
        || !has('dc_power_wire_n', 'gnd_wire_gnd')) return 0;
    const power = sys.comps['dc_power'];
    if (!power || !power.isOn) return 0;
    const r = sys.comps['r_load_dc'];
    if (!r) return 0;
    const V = power.voltage || 0;
    const R = r.getValue ? r.getValue() : (r.value || 100);
    return R > 0 ? V / R : 0;
}

function _doPresetWiringAC(sys) {
    sys.conns = [];
    const presetConns = [
        { from: 'ac_power_wire_p', to: 'r_load_ac_wire_l', type: 'wire' },
        { from: 'r_load_ac_wire_r', to: 'c_load_wire_l', type: 'wire' },
        { from: 'c_load_wire_r', to: 'gnd_wire_gnd', type: 'wire' },
        { from: 'ac_power_wire_n', to: 'gnd_wire_gnd', type: 'wire' },
    ];
    presetConns.forEach(c => sys.connMgr.addConn(c));
    sys.redrawAll();
}

function _doPresetWiringDC(sys) {
    sys.conns = [];
    const presetConns = [
        { from: 'dc_power_wire_p', to: 'r_load_dc_wire_l', type: 'wire' },
        { from: 'r_load_dc_wire_r', to: 'gnd_wire_gnd', type: 'wire' },
        { from: 'dc_power_wire_n', to: 'gnd_wire_gnd', type: 'wire' },
    ];
    presetConns.forEach(c => sys.connMgr.addConn(c));
    sys.redrawAll();
}

export const componentConfigs = [
    { Class: ACPower, id: 'ac_power', x: 30, y: 60, vRms: 50, freq: 50, isOn: false },
    { Class: Resistor, id: 'r_load_ac', x: 550, y: 260, value: 100, label: '100Ω' },
    { Class: Capacitor, id: 'c_load', x: 580, y: 430, capacitance: 100e-6, label: '100μF' },
    { Class: DCPower, id: 'dc_power', x: 50, y: 80, voltage: 12, isOn: false, visible: false },
    { Class: Resistor, id: 'r_load_dc', x: 650, y:310, value: 100, label: '100Ω', visible: false },
    { Class: Ground, id: 'gnd', x: 280, y: 650 },
    { Class: HallClampMeter, id: 'hallclamp', x: 780, y: 80, current: 0, scale: 1.2, range: 5, isDC: false },

    { Class: Oscilloscope_tri, id: 'osc3', x: 1050, y: 60, visible: false },
    { Class: SignalGenerator, id: 'sg', x: 100, y: 60, visible: false },
    { Class: Multimeter, id: 'multimeter', x: 800, y: 300, scale: 1.2, visible: false },
    { Class: AmpMeter, id: 'ampmeter', x: 350, y: 60, visible: false },
    { Class: ProcessCalibrator, id: 'cali', x: 550, y: 60, visible: false },
    { Class: MF47Multimeter, id: 'mf47-panel', x: 680, y: 60, rangeMode: 'ACV_500', visible: false },
];

export function initSlider(sys) {
    const toolbar = document.getElementById('toolbar');

    const existing = document.getElementById('hallclampmeterCtrl');
    if (existing) existing.remove();

    const container = document.createElement('div');
    container.id = 'hallclampmeterCtrl';
    container.style.cssText = 'display:inline-flex;align-items:center;gap:8px;margin-left:12px;';
    container.innerHTML = '\
        <span style="font-size:12px;font-weight:bold;color:white;">电路模式:</span>\
        <button id="modeToggle" style="padding:4px 12px;font-size:12px;background:#2d8cf0;color:white;border:none;border-radius:4px;cursor:pointer;font-weight:bold;" title="切换直流/交流模式">直流</button>\
        <span style="font-size:12px;color:#888;">|</span>\
        <span style="font-size:12px;font-weight:bold;color:white;">电压:</span>\
        <span id="sliderArea" style="display:inline-flex;align-items:center;gap:4px;">\
            <input type="range" id="acVoltageSlider" min="0" max="220" step="1" value="50" style="width:120px;vertical-align:middle;">\
            <span id="voltageDisplay" style="font-size:12px;min-width:55px;color:#0f0;">50 V</span>\
        </span>\
        <span style="font-size:12px;color:#888;">|</span>\
        <span style="font-size:12px;font-weight:bold;color:white;">电流:</span>\
        <span id="currentDisplay" style="font-size:12px;min-width:50px;color:#f80;">0.0 A</span>\
    ';
    toolbar.appendChild(container);

    const modeBtn = document.getElementById('modeToggle');
    modeBtn.onclick = () => {
        const newMode = _circuitMode === 'ac' ? 'dc' : 'ac';
        sys.conns = [];
        sys.redrawAll();
        switchMode(newMode);
    };

    bindSlider('ac');

    if (!sys._hallclampPollTimer) {
        sys._hallclampPollTimer = setInterval(() => {
            const hcm = sys.comps['hallclamp'];
            const cd = document.getElementById('currentDisplay');
            let currentVal = 0;
            if (_circuitMode === 'ac') {
                currentVal = _calcCurrentAC();
            } else {
                currentVal = _calcCurrentDC();
            }
            if (hcm) hcm.setCurrent(currentVal);
            if (cd) cd.textContent = currentVal.toFixed(3) + ' A';

            const vd = document.getElementById('voltageDisplay');
            if (_circuitMode === 'ac') {
                const power = sys.comps['ac_power'];
                const sl = document.getElementById('acVoltageSlider');
                if (power && vd) {
                    const v = power.isOn ? (power.vRms || 0) : 0;
                    vd.textContent = v.toFixed(0) + ' V';
                }
                if (sl) sl.value = Math.min(220, Math.max(0, (sys.comps['ac_power'] && sys.comps['ac_power'].vRms) || 0));
            } else {
                const power = sys.comps['dc_power'];
                const sl = document.getElementById('dcVoltageSlider');
                if (power && vd) {
                    const v = power.isOn ? (power.voltage || 0) : 0;
                    vd.textContent = v.toFixed(1) + ' V';
                }
                if (sl) sl.value = Math.min(24, Math.max(0, (sys.comps['dc_power'] && sys.comps['dc_power'].voltage) || 0));
            }
        }, 200);
    }
}

export function applyAllPresets() {
    const sys = this.sys;
    if (_circuitMode === 'ac') {
        _doPresetWiringAC(sys);
    } else {
        _doPresetWiringDC(sys);
    }
}

export async function applyStartSystem() {
    const sys = this.sys;
    if (_circuitMode === 'ac') {
        _doPresetWiringAC(sys);
        const power = sys.comps['ac_power'];
        if (power) {
            power.vRms = 50;
            power.isOn = true;
            power.update();
        }
        const hcm = sys.comps['hallclamp'];
        if (hcm) hcm.setMode(false);
        const sl = document.getElementById('acVoltageSlider');
        const vd = document.getElementById('voltageDisplay');
        if (sl) sl.value = 50;
        if (vd) vd.textContent = '50 V';
    } else {
        _doPresetWiringDC(sys);
        const power = sys.comps['dc_power'];
        if (power) {
            power.voltage = 12;
            power.isOn = true;
            power.update();
        }
        const hcm = sys.comps['hallclamp'];
        if (hcm) hcm.setMode(true);
        const sl = document.getElementById('dcVoltageSlider');
        const vd = document.getElementById('voltageDisplay');
        if (sl) sl.value = 12;
        if (vd) vd.textContent = '12.0 V';
    }
}

export function fiveStep() {}
