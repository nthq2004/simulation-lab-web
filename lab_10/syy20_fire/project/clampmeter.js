import { ACPower } from '../components/ACPower.js';
import { Resistor } from '../components/Resistor.js';
import { Capacitor } from '../components/Capacitor.js';
import { ClampMeter } from '../components/ClampMeter.js';
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
        system: '钳形电流表',
        check() {
            const c = window.sys && window.sys.comps && window.sys.comps['clamp'];
            return c && c._mechanicalOffset !== 0;
        },
        trigger() {
            const c = window.sys && window.sys.comps && window.sys.comps['clamp'];
            if (c) c._mechanicalOffset = 0.03;
        },
        repair() {
            const c = window.sys && window.sys.comps && window.sys.comps['clamp'];
            if (c) c._mechanicalOffset = 0;
        },
    },
    oil_contamination: {
        id: 'oil_contamination',
        name: '钳口油污',
        system: '钳形电流表',
        check() {
            const c = window.sys && window.sys.comps && window.sys.comps['clamp'];
            return c && c._oilFault;
        },
        trigger() {
            const c = window.sys && window.sys.comps && window.sys.comps['clamp'];
            if (c) c._oilFault = true;
        },
        repair() {
            const c = window.sys && window.sys.comps && window.sys.comps['clamp'];
            if (c) c._oilFault = false;
        },
    },
};

export const PROJECT_WORKFLOWS = {
    'clampmeter-measure': {
        id: 'clampmeter-measure',
        name: '钳形电流表测量交流电流',
        steps: [
            {
                msg: '连接电路',
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
                msg: '开启电源，并调节电压到100V',
                mode: 'check',
                act() {
                    const power = this.sys.comps['ac_power'];
                    if (power) {
                        power.vRms = 100;
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
                    const v = power.vRms || 0;
                    return v >= 95 && v <= 105;
                },
            },
            {
                msg: '检查并调整机械表零点',
                mode: 'check',
                async act() {
                    const clamp = this.sys.comps['clamp'];
                    if (!clamp) return;
                    clamp._mechanicalOffset = -0.05;
                    await new Promise(r => setTimeout(r, 1200));
                    clamp._mechanicalOffset = 0;
                },
                check() {
                    const clamp = this.sys.comps['clamp'];
                    if (!clamp) return false;
                    if (!this._wfZeroFaultSet) {
                        this._wfZeroFaultSet = true;
                        clamp._mechanicalOffset = -0.05;
                        return false;
                    }
                    return clamp._mechanicalOffset === 0;
                },
            },
            {
                msg: '将钳形电流表打到250档',
                mode: 'check',
                act() {
                    const clamp = this.sys.comps['clamp'];
                    if (clamp) clamp.setRange('250');
                },
                check() {
                    const clamp = this.sys.comps['clamp'];
                    return clamp && clamp._range === 250;
                },
            },
            {
                msg: '打开钳口，钳入导线，合上钳口',
                mode: 'check',
                async act() {
                    const clamp = this.sys.comps['clamp'];
                    if (!clamp) return;
                    clamp._jawOpen = true;
                    await new Promise(r => setTimeout(r, 1000));
                    clamp._jawOpen = false;
                    clamp._measuring = true;
                    await new Promise(r => setTimeout(r, 500));
                },
                check() {
                    const clamp = this.sys.comps['clamp'];
                    return clamp && clamp._measuring === true;
                },
            },
            {
                msg: '打开钳口，移出，合上钳口',
                mode: 'check',
                async act() {
                    const clamp = this.sys.comps['clamp'];
                    if (!clamp) return;
                    clamp._jawOpen = true;
                    await new Promise(r => setTimeout(r, 800));
                    clamp._jawOpen = false;
                    clamp._measuring = false;
                    await new Promise(r => setTimeout(r, 400));
                },
                check() {
                    const clamp = this.sys.comps['clamp'];
                    return clamp && clamp._measuring === false;
                },
            },
            {
                msg: '改变量程到5A档',
                mode: 'check',
                act() {
                    const clamp = this.sys.comps['clamp'];
                    if (clamp) clamp.setRange('5');
                },
                check() {
                    const clamp = this.sys.comps['clamp'];
                    return clamp && clamp._range === 5;
                },
            },
            {
                msg: '打开钳口，重新钳入导线，合上钳口',
                mode: 'check',
                async act() {
                    const clamp = this.sys.comps['clamp'];
                    if (!clamp) return;
                    clamp._jawOpen = true;
                    await new Promise(r => setTimeout(r, 800));
                    clamp._jawOpen = false;
                    clamp._measuring = true;
                    await new Promise(r => setTimeout(r, 400));
                },
                check() {
                    const clamp = this.sys.comps['clamp'];
                    return clamp && clamp._measuring === true;
                },
            },
            {
                msg: '读取电流值，选择正确答案',
                mode: 'quiz',
                quizConfig: {
                    question: '此时钳形电流表的读数为？',
                    options: ['0.95A', '1.50A', '0.65A', '1.85A'],
                    answer: 0,
                    analysis: '电路总阻抗 Z = √(R² + Xc²) = √(100² + 31.83²) ≈ 104.9Ω。I = V / Z = 100V / 104.9Ω ≈ 0.95A。',
                },
            },
        ],
    },
};

export const componentConfigs = [
    { Class: ACPower, id: 'ac_power', x: 150, y: 40, vRms: 50, freq: 50, isOn: false },
    { Class: Resistor, id: 'r_load', x: 500, y: 220, value: 100, label: '100Ω' },
    { Class: Capacitor, id: 'c_load', x: 600, y: 400, capacitance: 100e-6, label: '100μF' },
    { Class: Ground, id: 'gnd', x: 200, y: 500 },
    { Class: ClampMeter, id: 'clamp', x: 680, y: 80, current: 0, scale:1.2,range: 5 },

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

    const existing = document.getElementById('clampmeterCtrl');
    if (existing) existing.remove();

    const container = document.createElement('div');
    container.id = 'clampmeterCtrl';
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
        const Vrms = power.vRms || 0;
        const R = r.getValue ? r.getValue() : (r.value || 100);
        const C = c.getValue ? c.getValue() : (c.value || 100e-6);
        const f = power.freq || 50;
        const Xc = 1 / (2 * Math.PI * f * C);
        const Z = Math.sqrt(R * R + Xc * Xc);
        return Z > 0 ? Vrms / Z : 0;
    }

    slider.addEventListener('input', () => {
        const v = parseFloat(slider.value) || 0;
        const power = sys.comps['ac_power'];
        const clamp = sys.comps['clamp'];
        if (power) {
            power.vRms = v;
            power.isOn = v > 0;
            power.update();
        }
        voltageDisplay.textContent = v.toFixed(0) + ' V';
        const rms = _calcTheoreticalRMS();
        clamp.setCurrent(rms);
        currentDisplay.textContent = rms.toFixed(2) + ' A';
    });

    if (!sys._clampmeterPollTimer) {
        sys._clampmeterPollTimer = setInterval(() => {
            const power = sys.comps['ac_power'];
            const clamp = sys.comps['clamp'];
            if (!power || !clamp) return;

            const rms = _calcTheoreticalRMS();
            clamp.setCurrent(rms);
            currentDisplay.textContent = rms.toFixed(2) + ' A';

            const v = power.isOn ? (power.vRms || 0) : 0;
            voltageDisplay.textContent = v.toFixed(0) + ' V';
            slider.value = Math.min(220, Math.max(0, power.vRms || 0));
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
        power.vRms = 50;
        power.isOn = true;
        power.update();
    }
    const slider = document.getElementById('acVoltageSlider');
    const voltageDisplay = document.getElementById('voltageDisplay');
    if (slider) slider.value = 50;
    if (voltageDisplay) voltageDisplay.textContent = '50 V';
}

export function fiveStep() {}
