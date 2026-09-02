import { ACPower } from '../components/ACPower.js';
import { Resistor } from '../components/Resistor.js';
import { Capacitor } from '../components/Capacitor.js';
import { DigitClampMeter } from '../components/DigitClampMeter.js';
import { Ground } from '../components/Gnd.js';

import { AmpMeter } from '../components/AmpMeter.js';
import { MF47Multimeter } from '../components/MF47Multimeter.js';
import { Multimeter } from '../components/Multimeter.js';
import { SignalGenerator } from '../components/SignalGenerator.js';
import { ProcessCalibrator } from '../components/ProcessCalibrator.js';
import { Oscilloscope_tri } from '../components/Osc_tri.js';

export const FAULT_CONFIGS = {
    zero_offset: {
        id: 'zero_offset',
        name: '零点偏移',
        system: '数字钳形电流表',
        check() {
            const c = window.sys && window.sys.comps && window.sys.comps['digitclamp'];
            return c && c._holdMode !== false && c._holdValue > 0.01;
        },
        trigger() {
            const c = window.sys && window.sys.comps && window.sys.comps['digitclamp'];
            if (c) { c._holdMode = true; c._holdValue = 0.03; }
        },
        repair() {
            const c = window.sys && window.sys.comps && window.sys.comps['digitclamp'];
            if (c) { c._holdMode = false; c._holdValue = undefined; }
        },
    },
    oil_contamination: {
        id: 'oil_contamination',
        name: '钳口油污',
        system: '数字钳形电流表',
        check() {
            const c = window.sys && window.sys.comps && window.sys.comps['digitclamp'];
            return c && c._oilFault;
        },
        trigger() {
            const c = window.sys && window.sys.comps && window.sys.comps['digitclamp'];
            if (c) c._oilFault = true;
        },
        repair() {
            const c = window.sys && window.sys.comps && window.sys.comps['digitclamp'];
            if (c) c._oilFault = false;
        },
    },
};

export const PROJECT_WORKFLOWS = {
    'digitclampmeter-measure': {
        id: 'digitclampmeter-measure',
        name: '数字钳形电流表测量交流电流',
        steps: [
            {
                msg: '1. 连接电路',
                mode: 'check',
                act() {
                    _doPresetWiring(this.sys);
                },
                check() {
                    const conns = this.sys.conns || [];
                    const has = (a, b) => conns.some(c => (c.from === a && c.to === b) || (c.from === b && c.to === a));
                    return has('ac_power_wire_p', 'r_load_wire_l')
                        && has('r_load_wire_r', 'c_load_wire_l')
                        && has('c_load_wire_r', 'gnd_wire_gnd')
                        && has('ac_power_wire_n', 'gnd_wire_gnd');
                },
            },
            {
                msg: '2. 开启电源，并调节电压到100V',
                mode: 'check',
                act() {
                    const power = this.sys.comps['ac_power'];
                    if (power) {
                        power.voltageRMS = 100;
                        power.isOn = true;
                        power.update();
                    }
                    const sl = document.getElementById('acVoltageSlider');
                    const vd = document.getElementById('voltageDisplay');
                    if (sl) sl.value = 100;
                    if (vd) vd.textContent = '100 V';
                },
                check() {
                    const power = this.sys.comps['ac_power'];
                    if (!power || !power.isOn) return false;
                    const v = power.voltageRMS || 0;
                    return v >= 95 && v <= 105;
                },
            },
            {
                msg: '3. 将数字钳形电流表打到250A档',
                mode: 'check',
                act() {
                    const dcm = this.sys.comps['digitclamp'];
                    if (dcm) dcm.setRange('250');
                },
                check() {
                    const dcm = this.sys.comps['digitclamp'];
                    return dcm && dcm._range === 250;
                },
            },
            {
                msg: '4. 打开钳口，钳入导线，合上钳口',
                mode: 'check',
                async act() {
                    const dcm = this.sys.comps['digitclamp'];
                    if (!dcm) return;
                    dcm._jawOpen = true;
                    await new Promise(r => setTimeout(r, 1000));
                    dcm._jawOpen = false;
                    dcm._measuring = true;
                    await new Promise(r => setTimeout(r, 500));
                },
                check() {
                    const dcm = this.sys.comps['digitclamp'];
                    return dcm && dcm._measuring === true;
                },
            },
            {
                msg: '5. 打开钳口，移出，合上钳口',
                mode: 'check',
                async act() {
                    const dcm = this.sys.comps['digitclamp'];
                    if (!dcm) return;
                    dcm._jawOpen = true;
                    await new Promise(r => setTimeout(r, 800));
                    dcm._jawOpen = false;
                    dcm._measuring = false;
                    await new Promise(r => setTimeout(r, 400));
                },
                check() {
                    const dcm = this.sys.comps['digitclamp'];
                    return dcm && dcm._measuring === false;
                },
            },
            {
                msg: '6. 改变量程到5A档',
                mode: 'check',
                act() {
                    const dcm = this.sys.comps['digitclamp'];
                    if (dcm) dcm.setRange('5');
                },
                check() {
                    const dcm = this.sys.comps['digitclamp'];
                    return dcm && dcm._range === 5;
                },
            },
            {
                msg: '7. 打开钳口，重新钳入导线，合上钳口',
                mode: 'check',
                async act() {
                    const dcm = this.sys.comps['digitclamp'];
                    if (!dcm) return;
                    dcm._jawOpen = true;
                    await new Promise(r => setTimeout(r, 800));
                    dcm._jawOpen = false;
                    dcm._measuring = true;
                    await new Promise(r => setTimeout(r, 400));
                },
                check() {
                    const dcm = this.sys.comps['digitclamp'];
                    return dcm && dcm._measuring === true;
                },
            },
            {
                msg: '8. 读取电流值，选择正确答案',
                mode: 'quiz',
                quizConfig: {
                    question: '此时数字钳形电流表的读数为？',
                    options: ['0.95A', '1.50A', '0.65A', '1.85A'],
                    answer: 0,
                    analysis: '电路总阻抗 Z = √(R² + Xc²) = √(100² + 31.83²) ≈ 104.9Ω。I = V / Z = 100V / 104.9Ω ≈ 0.95A。',
                },
            },
            {
                msg: '9. 测试题：CT型钳形电流表的特征',
                mode: 'quiz',
                quizConfig: {
                    question: '关于CT型（电流互感器型）钳形电流表，以下哪项描述是正确的？',
                    options: [
                        '可直接测量直流电流',
                        '二次绕组匝数N₂远大于一次绕组匝数N₁',
                        '测量时需断开被测电路',
                        '表头为数字式LCD显示屏'
                    ],
                    answer: 1,
                    analysis: 'CT型钳形电流表利用电流互感器原理，一次绕组为被测导线（N₁=1），二次绕组匝数N₂远大于N₁，通过I₁N₁=I₂N₂实现大电流到小电流的变换。CT型不能测量直流电流；测量时不需断开电路；表头可为指针式或数字式，但本题问的是CT型本身的特征。',
                },
            },
        ],
    },
};

export const componentConfigs = [
    { Class: ACPower, id: 'ac_power', x: 150, y: 40, voltageRMS: 50, frequency: 50, isOn: false },
    { Class: Resistor, id: 'r_load', x: 500, y: 220, value: 100, label: '100Ω' },
    { Class: Capacitor, id: 'c_load', x: 600, y: 400, capacitance: 100e-6, label: '100μF' },
    { Class: Ground, id: 'gnd', x: 200, y: 500 },
    { Class: DigitClampMeter, id: 'digitclamp', x: 680, y: 80, current: 0, scale:1.2, range: 5 },

    { Class: Oscilloscope_tri, id: 'osc3', x: 1050, y: 60, visible: false },
    { Class: SignalGenerator, id: 'sg', x: 100, y: 60, visible: false },
    { Class: Multimeter, id: 'multimeter', x: 800, y: 300,scale:1.2, visible: false },
    { Class: AmpMeter, id: 'ampmeter', x: 350, y: 60, visible: false },
    { Class: ProcessCalibrator, id: 'cali', x: 550, y: 60, visible: false },
    { Class: MF47Multimeter, id: 'mf47-panel', x: 680, y: 60, rangeMode: 'ACV_500', visible: false },
];

function _doPresetWiring(sys) {
    sys.conns = [];
    const presetConns = [
        { from: 'ac_power_wire_p', to: 'r_load_wire_l', type: 'wire' },
        { from: 'r_load_wire_r', to: 'c_load_wire_l', type: 'wire' },
        { from: 'c_load_wire_r', to: 'gnd_wire_gnd', type: 'wire' },
        { from: 'ac_power_wire_n', to: 'gnd_wire_gnd', type: 'wire' },
    ];
    presetConns.forEach(c => sys.connMgr.addConn(c));
    sys.redrawAll();
}

export function initSlider(sys) {
    const toolbar = document.getElementById('toolbar');

    const existing = document.getElementById('digitclampmeterCtrl');
    if (existing) existing.remove();

    const container = document.createElement('div');
    container.id = 'digitclampmeterCtrl';
    container.style.cssText = 'display:inline-flex;align-items:center;gap:8px;margin-left:12px;';
    container.innerHTML = '\
        <span style="font-size:12px;font-weight:bold;color:white;">交流电压:</span>\
        <input type="range" id="acVoltageSlider" min="0" max="220" step="1" value="50" style="width:120px;">\
        <span id="voltageDisplay" style="font-size:12px;min-width:55px;color:#0f0;">50 V</span>\
        <span style="font-size:12px;color:#888;">|</span>\
        <span style="font-size:12px;font-weight:bold;color:white;">电流:</span>\
        <span id="currentDisplay" style="font-size:12px;min-width:50px;color:#f80;">0.0 A</span>\
    ';
    toolbar.appendChild(container);

    const slider = document.getElementById('acVoltageSlider');
    const voltageDisplay = document.getElementById('voltageDisplay');
    const currentDisplay = document.getElementById('currentDisplay');

    function _isCircuitWired() {
        const conns = sys.conns || [];
        const has = (a, b) => conns.some(c => (c.from === a && c.to === b) || (c.from === b && c.to === a));
        return has('ac_power_wire_p', 'r_load_wire_l')
            && has('r_load_wire_r', 'c_load_wire_l')
            && has('c_load_wire_r', 'gnd_wire_gnd')
            && has('ac_power_wire_n', 'gnd_wire_gnd');
    }

    function _calcTheoreticalRMS() {
        if (!_isCircuitWired()) return 0;
        const power = sys.comps['ac_power'];
        if (!power || !power.isOn) return 0;
        const r = sys.comps['r_load'];
        const c = sys.comps['c_load'];
        if (!r || !c) return 0;
        const Vrms = power.voltageRMS || 0;
        const R = r.getValue ? r.getValue() : (r.value || 100);
        const C = c.getValue ? c.getValue() : (c.value || 100e-6);
        const f = power.frequency || 50;
        const Xc = 1 / (2 * Math.PI * f * C);
        const Z = Math.sqrt(R * R + Xc * Xc);
        return Z > 0 ? Vrms / Z : 0;
    }

    slider.addEventListener('input', () => {
        const v = parseFloat(slider.value) || 0;
        const power = sys.comps['ac_power'];
        const dcm = sys.comps['digitclamp'];
        if (power) {
            power.voltageRMS = v;
            power.isOn = v > 0;
            power.update();
        }
        voltageDisplay.textContent = v.toFixed(0) + ' V';
        const rms = _calcTheoreticalRMS();
        dcm.setCurrent(rms);
        currentDisplay.textContent = rms.toFixed(2) + ' A';
    });

    if (!sys._digitclampPollTimer) {
        sys._digitclampPollTimer = setInterval(() => {
            const power = sys.comps['ac_power'];
            const dcm = sys.comps['digitclamp'];
            if (!power || !dcm) return;

            const rms = _calcTheoreticalRMS();
            dcm.setCurrent(rms);
            currentDisplay.textContent = rms.toFixed(2) + ' A';

            const v = power.isOn ? (power.voltageRMS || 0) : 0;
            voltageDisplay.textContent = v.toFixed(0) + ' V';
            slider.value = Math.min(220, Math.max(0, power.voltageRMS || 0));
        }, 200);
    }
}

export function applyAllPresets() {
    _doPresetWiring(this.sys);
}

export async function applyStartSystem() {
    _doPresetWiring(this.sys);
    const power = this.sys.comps['ac_power'];
    if (power) {
        power.voltageRMS = 50;
        power.isOn = true;
        power.update();
    }
    const slider = document.getElementById('acVoltageSlider');
    const voltageDisplay = document.getElementById('voltageDisplay');
    if (slider) slider.value = 50;
    if (voltageDisplay) voltageDisplay.textContent = '50 V';
}

export function fiveStep() {}
