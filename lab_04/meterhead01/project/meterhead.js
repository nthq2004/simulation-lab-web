import { DCPower } from '../components/DCPower.js';
import { Resistor } from '../components/Resistor.js';
import { GalvanometerHead } from '../components/GalvanometerHead.js';
import { Ground } from '../components/Gnd.js';
import { Multimeter } from '../components/Multimeter.js';
import { AmpMeter } from '../components/AmpMeter.js';
import { SignalGenerator } from '../components/SignalGenerator.js';
import { ProcessCalibrator } from '../components/ProcessCalibrator.js';
import { Oscilloscope_tri } from '../components/Osc_tri.js';

export const FAULT_CONFIGS = {};

export const PROJECT_WORKFLOWS = {};

export const componentConfigs = [
    { Class: DCPower, id: 'dc_power', x: 350, y: 500, voltage: 0.01, isOn: true },
    { Class: Resistor, id: 'r_series', x: 610, y: 720, value: 98000, label: '98K\u03A9' },
    { Class: GalvanometerHead, id: 'galvanometer', x: 560, y: 230 },
    { Class: Ground, id: 'gnd', x: 700, y: 900 },

    { Class: Oscilloscope_tri, id: 'osc3', x: 800, y: 160, visible: false },
    { Class: SignalGenerator, id: 'sg', x: 210, y: 200, visible: false },
    { Class: Multimeter, id: 'multimeter', x: 1350, y: 500, visible: false },
    { Class: AmpMeter, id: 'ampmeter', x: 450, y: 100, visible: false },
    { Class: ProcessCalibrator, id: 'cali', x: 600, y: 100, visible: false },
];

function _doPresetWiring(sys) {
    sys.conns = [];

    const presetConns = [
        { from: 'dc_power_wire_p', to: 'r_series_wire_l', type: 'wire' },
        { from: 'r_series_wire_r', to: 'galvanometer_wire_l', type: 'wire' },
        { from: 'galvanometer_wire_r', to: 'gnd_wire_gnd', type: 'wire' },
        { from: 'dc_power_wire_n', to: 'gnd_wire_gnd', type: 'wire' },
    ];

    presetConns.forEach(c => sys.connMgr.addConn(c));
    sys.redrawAll();
}

export function initSlider(sys) {
    const toolbar = document.getElementById('toolbar');

    const existing = document.getElementById('meterheadCtrl');
    if (existing) existing.remove();

    const container = document.createElement('div');
    container.id = 'meterheadCtrl';
    container.style.cssText = 'display:inline-flex;align-items:center;gap:8px;margin-left:12px;';
    container.innerHTML = '\
        <span style="font-size:12px;font-weight:bold;color:white;">直流电源:</span>\
        <input type="range" id="voltageSlider" min="0" max="5" step="0.1" value="0" style="width:120px;">\
        <span id="voltageDisplay" style="font-size:12px;min-width:50px;color:#0f0;">0.0 V</span>\
    ';
    toolbar.appendChild(container);

    const slider = document.getElementById('voltageSlider');
    const voltageDisplay = document.getElementById('voltageDisplay');

    slider.addEventListener('input', () => {
        const v = parseFloat(slider.value) || 0;
        const power = sys.comps['dc_power'];
        if (power) {
            power.voltage = v;
            power.isOn = true;
            power.update();
        }
        voltageDisplay.textContent = v.toFixed(1) + ' V';
    });

    if (!sys._meterheadPollTimer) {
        sys._meterheadPollTimer = setInterval(() => {
            const power = sys.comps['dc_power'];
            if (!power) return;
            const v = power.voltage || 0;
            voltageDisplay.textContent = v.toFixed(1) + ' V';
            slider.value = Math.min(5, Math.max(0, v));
        }, 100);
    }
}

export function applyAllPresets() {
    _doPresetWiring(this.sys);
}

export async function applyStartSystem() {
    _doPresetWiring(this.sys);
    const power = this.sys.comps['dc_power'];
    if (power) {
        power.voltage = 0;
        power.isOn = true;
        power.update();
    }
    const slider = document.getElementById('voltageSlider');
    const voltageDisplay = document.getElementById('voltageDisplay');
    if (slider) slider.value = 0;
    if (voltageDisplay) voltageDisplay.textContent = '0.0 V';
}

export function fiveStep() {
}
