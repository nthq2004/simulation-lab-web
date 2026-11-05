import { SmartAnalogSwitch } from '../components/SmartAnalogSwitch.js';
import { DMMController } from '../components/DMMController.js';
import { ConstantCurrentSource } from '../components/ConstantCurrentSource.js';
import { Resistor } from '../components/Resistor.js';
import { Capacitor } from '../components/Capacitor.js';
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
        width: 320, height: 150, function: 'C', position: 3
    },

    {
        Class: DMMController, id: 'dmm_ctrl', x: 800, y: 300,
        width: 360, height: 210, switchId: 'smart_switch'
    },

    { Class: ConstantCurrentSource, id: 'cc_source', x: 320, y: 120 },
    { Class: Ground, id: 'gnd_2', x: 150, y: 280 },

    { Class: Capacitor, id: 'test_cap', x: 460, y: 690, capacitance: 10 },

    { Class: Resistor, id: 'r_discharge', x: 890, y: 220,
        value: 100, label: '100\u03A9' },

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
        { from: 'cc_source_wire_i1', to: 'smart_switch_wire_t1', type: 'wire' },
        { from: 'r_discharge_wire_l', to: 'smart_switch_wire_t2', type: 'wire' },
        { from: 'r_discharge_wire_r', to: 'gnd_ref_wire_gnd', type: 'wire' },
        { from: 'smart_switch_wire_com', to: 'test_cap_wire_l', type: 'wire' },
        { from: 'test_cap_wire_r', to: 'gnd_2_wire_gnd', type: 'wire' },
        { from: 'cc_source_wire_com', to: 'gnd_2_wire_gnd', type: 'wire' },
        { from: 'test_cap_wire_l', to: 'dmm_ctrl_wire_vin_p', type: 'wire' },
        { from: 'gnd_ref_wire_gnd', to: 'dmm_ctrl_wire_vin_n', type: 'wire' },
        { from: 'smart_switch_wire_a', to: 'dmm_ctrl_wire_a', type: 'wire' },
        { from: 'smart_switch_wire_b', to: 'dmm_ctrl_wire_b', type: 'wire' },
    ];

    presetConns.forEach(c => sys.connMgr.addConn(c));
    sys.redrawAll();
}

function _formatCapDisplay(val) {
    if (val >= 1000) return (val / 1000).toFixed(2) + ' mF';
    return val.toFixed(1) + ' \u03BCF';
}

export function initSlider(sys) {
    const toolbar = document.getElementById('toolbar');

    const existing = document.getElementById('capSliderContainer');
    if (existing) existing.remove();

    const container = document.createElement('div');
    container.id = 'capSliderContainer';
    container.style.cssText = 'display:inline-flex;align-items:center;gap:6px;margin-left:12px;';
    container.innerHTML = '\
        <span style="font-size:12px;font-weight:bold;color:white;">电容值:</span>\
        <input type="range" id="capSlider" min="1" max="1000" value="10" style="width:160px;">\
        <span id="capValueDisplay" style="font-size:12px;min-width:70px;color:white;">10.0 \u03BCF</span>\
        <button id="capMeasureBtn" style="padding:2px 10px;font-size:12px;cursor:pointer;">测量</button>\
        <span id="capResultDisplay" style="font-size:12px;min-width:140px;color:#ff0;"></span>\
    ';
    toolbar.appendChild(container);

    const slider = document.getElementById('capSlider');
    const valueDisplay = document.getElementById('capValueDisplay');

    function updateCapFromSlider() {
        const val = parseFloat(slider.value) || 10;
        const cap = sys.comps['test_cap'];
        if (cap) {
            const f = val * 1e-6;
            cap.capacitance = f;
            cap.config = { ...cap.config, capacitance: val };
            if (cap.label) cap.label.text(cap.formatCapacitance(f));
            cap._refreshCache();
        }
        valueDisplay.textContent = _formatCapDisplay(val);
    }

    slider.addEventListener('input', updateCapFromSlider);

    document.getElementById('capMeasureBtn').addEventListener('click', () => {
        const sw = sys.comps['smart_switch'];
        const dmm = sys.comps['dmm_ctrl'];
        if (!sw || !dmm) return;
        if (sw.getFunction() !== 'C') sw._selectFunction('C');

        dmm._capMeasuring = false;
        dmm._capDischarging = false;
        dmm._capResult = null;

        document.getElementById('capResultDisplay').textContent = '放电中...';

        sw.setPosition(2);

        setTimeout(() => {
            sw.setPosition(1);
            dmm._capMeasuring = true;
            dmm._capStartTime = sys.voltageSolver ? sys.voltageSolver.currentTime : 0;
            document.getElementById('capResultDisplay').textContent = '充电中...';
        }, 120);
    });

    if (!sys._capPollTimer) {
        sys._capPollTimer = setInterval(() => {
            const dmm = sys.comps['dmm_ctrl'];
            const rd = document.getElementById('capResultDisplay');
            if (!dmm || !rd) return;

            if (dmm._capResult !== null) {
                const actual = sys.comps['test_cap']?.capacitance || 0;
                const err = actual > 0 ? ((dmm._capResult - actual) / actual * 100) : 0;
                rd.textContent = '测得: ' + dmm._formatCapValue(dmm._capResult) + '  (误差: ' + err.toFixed(1) + '%)';
            } else if (dmm._capMeasuring) {
                rd.textContent = '充电中...';
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
        dmm._capMeasuring = false;
        dmm._capDischarging = false;
        dmm._capResult = null;
    }
}

export function fiveStep() {
    const sys = this.sys;
    const slider = document.getElementById('capSlider');
    if (!slider) return;

    const steps = [1, 10, 47, 100, 220, 470, 1000];
    const current = parseFloat(slider.value) || 10;

    let nextVal = steps[0];
    for (let i = 0; i < steps.length; i++) {
        if (Math.abs(steps[i] - current) < 0.5) {
            nextVal = steps[(i + 1) % steps.length];
            break;
        }
    }

    slider.value = nextVal;
    const cap = sys.comps['test_cap'];
    if (cap) {
        const f = nextVal * 1e-6;
        cap.capacitance = f;
        cap.config = { ...cap.config, capacitance: nextVal };
        if (cap.label) cap.label.text(cap.formatCapacitance(f));
        cap._refreshCache();
    }
    const valueDisplay = document.getElementById('capValueDisplay');
    if (valueDisplay) valueDisplay.textContent = _formatCapDisplay(nextVal);
}
