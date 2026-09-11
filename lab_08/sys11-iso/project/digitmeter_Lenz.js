import { SmartAnalogSwitch } from '../components/SmartAnalogSwitch.js';
import { DMMController } from '../components/DMMController.js';
import { DCPower } from '../components/DCPower.js';
import { Resistor } from '../components/Resistor.js';
import { RealInductor } from '../components/RealInductor.js';
import { Ground } from '../components/Gnd.js';

import { Multimeter } from '../components/Multimeter.js';
import { AmpMeter } from '../components/AmpMeter.js';
import { SignalGenerator } from '../components/SignalGenerator.js';
import { ProcessCalibrator } from '../components/ProcessCalibrator.js';
import { Oscilloscope_tri } from '../components/Osc_tri.js';

export const FAULT_CONFIGS = {};

export const PROJECT_WORKFLOWS = {};

export const componentConfigs = [
    {
        Class: SmartAnalogSwitch, id: 'smart_switch', x: 300, y: 380,
        width: 320, height: 150, function: 'L', position: 3
    },

    {
        Class: DMMController, id: 'dmm_ctrl', x: 800, y: 300,
        width: 360, height: 210, switchId: 'smart_switch'
    },

    { Class: DCPower, id: 'dc_power', x: 100, y: 20, voltage: 5, isOn: true },

    { Class: Resistor, id: 'r_series', x: 400, y: 220,
        value: 1000, label: '1000\u03A9' },

    { Class: Ground, id: 'gnd_2', x: 150, y: 280 },

    { Class: RealInductor, id: 'test_ind', x: 460, y: 650, inductance: 0.1 },

    { Class: Resistor, id: 'r_sense', x: 200, y: 550,
        value: 1, label: '1\u03A9',rotation:-90 },

    { Class: Resistor, id: 'r_discharge', x: 700, y: 200,
        value: 10000, label: '10k\u03A9' },

    { Class: Ground, id: 'gnd_ref', x: 980, y: 270 },

    { Class: Multimeter, id: 'multimeter', x: 1150, y: 80, visible: false, scale: 1.2 },
    { Class: AmpMeter, id: 'ampmeter', x: 1150, y: 460, visible: false },
    { Class: SignalGenerator, id: 'sg', x: 80, y: 550, visible: false },
    { Class: ProcessCalibrator, id: 'cali', x: 1050, y: 650, visible: false },
    { Class: Oscilloscope_tri, id: 'osc3', x: 800, y: 480, visible: false },
];

function _doPresetWiring(sys) {
    sys.conns = [];

    const presetConns = [
        { from: 'dc_power_wire_p', to: 'r_series_wire_l', type: 'wire' },
        { from: 'r_series_wire_r', to: 'smart_switch_wire_t1', type: 'wire' },
        { from: 'smart_switch_wire_com', to: 'test_ind_wire_r', type: 'wire' },
        { from: 'test_ind_wire_l', to: 'r_sense_wire_l', type: 'wire' },
        { from: 'r_sense_wire_r', to: 'dc_power_wire_n', type: 'wire' },
        { from: 'dc_power_wire_n', to: 'gnd_2_wire_gnd', type: 'wire' },
        { from: 'gnd_ref_wire_gnd', to: 'dmm_ctrl_wire_vin_n', type: 'wire' },
        { from: 'r_sense_wire_l', to: 'dmm_ctrl_wire_vin_p', type: 'wire' },
        { from: 'smart_switch_wire_t2', to: 'r_discharge_wire_l', type: 'wire' },
        { from: 'r_discharge_wire_r', to: 'gnd_ref_wire_gnd', type: 'wire' },
        { from: 'smart_switch_wire_a', to: 'dmm_ctrl_wire_a', type: 'wire' },
        { from: 'smart_switch_wire_b', to: 'dmm_ctrl_wire_b', type: 'wire' },
    ];

    presetConns.forEach(c => sys.connMgr.addConn(c));
    sys.redrawAll();
}

function _formatIndDisplay(val) {
    if (val >= 1000) return (val / 1000).toFixed(2) + ' H';
    return val.toFixed(1) + ' mH';
}

export function initSlider(sys) {
    const toolbar = document.getElementById('toolbar');

    const existing = document.getElementById('indSliderContainer');
    if (existing) existing.remove();

    const container = document.createElement('div');
    container.id = 'indSliderContainer';
    container.style.cssText = 'display:inline-flex;align-items:center;gap:6px;margin-left:12px;';
    container.innerHTML = '\
        <span style="font-size:12px;font-weight:bold;color:white;">电感值:</span>\
        <input type="range" id="indSlider" min="1" max="10000" value="100" style="width:160px;">\
        <span id="indValueDisplay" style="font-size:12px;min-width:70px;color:white;">100.0 mH</span>\
        <select id="indMethodSelect" style="font-size:11px;padding:1px 4px;cursor:pointer;">\
            <option value="voltage">电压反推法</option>\
            <option value="tau1">单时间常数法</option>\
            <option value="tau5">5倍时间常数法</option>\
        </select>\
        <button id="indMeasureBtn" style="padding:2px 10px;font-size:12px;cursor:pointer;">测量</button>\
        <span id="indResultDisplay" style="font-size:12px;min-width:160px;color:#ff0;"></span>\
    ';
    toolbar.appendChild(container);

    const slider = document.getElementById('indSlider');
    const valueDisplay = document.getElementById('indValueDisplay');

    function updateIndFromSlider() {
        const val = parseFloat(slider.value) || 100;
        const ind = sys.comps['test_ind'];
        if (ind) {
            const h = val * 1e-3;
            ind.inductance = h;
            ind.config = { ...ind.config, inductance: h };
            if (ind.label) ind.label.text(ind.formatInductance(h));
            ind._refreshCache();
        }
        valueDisplay.textContent = _formatIndDisplay(val);
    }

    slider.addEventListener('input', updateIndFromSlider);

    const ind = sys.comps['test_ind'];
    if (ind) {
        const origOnConfigUpdate = ind.onConfigUpdate.bind(ind);
        ind.onConfigUpdate = (newConfig) => {
            origOnConfigUpdate(newConfig);
            const h = parseFloat(newConfig.inductance);
            if (!isNaN(h)) {
                const val = h * 1000;
                const clamped = Math.max(1, Math.min(10000, Math.round(val)));
                slider.value = clamped;
                valueDisplay.textContent = _formatIndDisplay(clamped);
            }
        };
    }

    if (sys.eventBus) {
        const unsub = sys.eventBus.on('inductor:configUpdate', (data) => {
            if (data && data.id === 'test_ind' && data.inductance != null) {
                const h = parseFloat(data.inductance);
                if (!isNaN(h)) {
                    const val = h * 1000;
                    const clamped = Math.max(1, Math.min(10000, Math.round(val)));
                    slider.value = clamped;
                    valueDisplay.textContent = _formatIndDisplay(clamped);
                }
            }
        });
    }

    const methodSelect = document.getElementById('indMethodSelect');
    methodSelect.addEventListener('change', () => {
        const dmm = sys.comps['dmm_ctrl'];
        if (!dmm) return;
        dmm._indMeasuring = false;
        dmm._indDischarging = false;
        dmm._indResult = null;
        document.getElementById('indResultDisplay').textContent = '';
    });

    document.getElementById('indMeasureBtn').addEventListener('click', () => {
        const sw = sys.comps['smart_switch'];
        const dmm = sys.comps['dmm_ctrl'];
        if (!sw || !dmm) return;
        if (sw.getFunction() !== 'L') sw._selectFunction('L');

        dmm._indMethod = methodSelect.value;
        dmm._indMeasuring = false;
        dmm._indDischarging = false;
        dmm._indResult = null;

        const methodLabel = methodSelect.options[methodSelect.selectedIndex].text;
        document.getElementById('indResultDisplay').textContent = methodLabel + ' 开始充电...';

        sw.setPosition(1);
        dmm._indMeasuring = true;
        dmm._indStartTime = sys.voltageSolver ? sys.voltageSolver.currentTime : 0;
    });

    if (!sys._indPollTimer) {
        sys._indPollTimer = setInterval(() => {
            const dmm = sys.comps['dmm_ctrl'];
            const rd = document.getElementById('indResultDisplay');
            if (!dmm || !rd) return;

            if (dmm._indResult !== null) {
                const actual = sys.comps['test_ind']?.inductance || 0;
                const err = actual > 0 ? ((dmm._indResult - actual) / actual * 100) : 0;
                rd.textContent = '测得: ' + dmm._formatIndValue(dmm._indResult) + '  (误差: ' + err.toFixed(1) + '%)';
            } else if (dmm._indMeasuring) {
                if (dmm._indMethod === 'voltage') {
                    rd.textContent = '电压反推法 充电中...';
                } else {
                    const n = dmm._indMethod === 'tau5' ? 5 : 1;
                    rd.textContent = n + 'τ时间常数法 充电中...';
                }
            } else if (dmm._indDischarging) {
                rd.textContent = '放电中...';
            }
        }, 100);
    }
}

export function applyAllPresets() {
    _doPresetWiring(this.sys);
}

export async function applyStartSystem() {
    const dmm = this.sys.comps['dmm_ctrl'];
    const sw = this.sys.comps['smart_switch'];
    if (sw) sw.setPosition(3);
    if (dmm) {
        dmm._indMeasuring = false;
        dmm._indDischarging = false;
        dmm._indResult = null;
    }
    const ind = this.sys.comps['test_ind'];
    if (ind) {
        const h = ind.inductance || 0.1;
        const slider = document.getElementById('indSlider');
        const valueDisplay = document.getElementById('indValueDisplay');
        if (slider) {
            const val = Math.round(h * 1000);
            const clamped = Math.max(1, Math.min(10000, val));
            slider.value = clamped;
            if (valueDisplay) valueDisplay.textContent = _formatIndDisplay(clamped);
        }
    }
}

function _nearestStep(val, steps) {
    let closest = steps[0];
    let minDiff = Math.abs(val - closest);
    for (const s of steps) {
        const d = Math.abs(s - val);
        if (d < minDiff) { minDiff = d; closest = s; }
    }
    return closest;
}

export function fiveStep() {
    const sys = this.sys;
    const slider = document.getElementById('indSlider');
    if (!slider) return;

    const steps = [1, 10, 100, 500, 1000, 5000, 10000];
    const current = parseFloat(slider.value) || 100;
    const nearest = _nearestStep(current, steps);
    const idx = steps.indexOf(nearest);
    const nextVal = steps[(idx + 1) % steps.length];

    const ind = sys.comps['test_ind'];
    if (ind) {
        const h = nextVal * 1e-3;
        ind.inductance = h;
        ind.config = { ...ind.config, inductance: h };
        if (ind.label) ind.label.text(ind.formatInductance(h));
        ind._refreshCache();
        if (sys.eventBus) {
            sys.eventBus.emit('inductor:configUpdate', { id: 'test_ind', inductance: h });
        }
    }
    slider.value = nextVal;
    const valueDisplay = document.getElementById('indValueDisplay');
    if (valueDisplay) valueDisplay.textContent = _formatIndDisplay(nextVal);
}
