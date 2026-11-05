import { SmartAnalogSwitch } from '../components/SmartAnalogSwitch.js';
import { DMMController } from '../components/DMMController.js';
import { DCCurrent } from '../components/DCCurrent.js';
import { Resistor } from '../components/Resistor.js';
import { Ground } from '../components/Gnd.js';

import { Multimeter } from '../components/Multimeter.js';
import { AmpMeter } from '../components/AmpMeter.js';
import { SignalGenerator } from '../components/SignalGenerator.js';
import { ProcessCalibrator } from '../components/ProcessCalibrator.js';
import { Oscilloscope_tri } from '../components/Osc_tri.js';

export const FAULT_CONFIGS = {};

export const PROJECT_WORKFLOWS = {};

export const componentConfigs = [
    { Class: SmartAnalogSwitch, id: 'smart_switch', x: 300, y: 380,
        width: 320, height: 150, function: 'DCA', position: 1 },

    { Class: DMMController, id: 'dmm_ctrl', x: 800, y: 300,
        width: 360, height: 210, switchId: 'smart_switch' },

    { Class: DCCurrent, id: 'dc_current', x: 180, y: 660,
        currentValue: 0, isOn: false },
    { Class: Ground, id: 'gnd_2', x: 240, y: 900 },    

    { Class: Resistor, id: 'shunt_50mA', x: 360, y: 180,
        value: 4, label: '4Ω' },

    { Class: Resistor, id: 'shunt_500mA', x: 490, y: 120,
        value: 0.4, label: '0.4Ω' },

    { Class: Resistor, id: 'shunt_5A', x: 620, y: 60,
        value: 0.04, label: '0.04Ω' },

    { Class: Ground, id: 'gnd_ref', x: 760, y: 280 },

    // 五种仪表（初始隐藏）
    { Class: Multimeter, id: 'multimeter', x: 1150, y: 80, visible: false,scale:1.2 },
    { Class: AmpMeter, id: 'ampmeter', x: 1150, y: 460, visible: false },
    { Class: SignalGenerator, id: 'sg', x: 80, y: 550, visible: false },
    { Class: ProcessCalibrator, id: 'cali', x: 1050, y: 650, visible: false },
    { Class: Oscilloscope_tri, id: 'osc3', x: 800, y: 480, visible: false },
];

function _doPresetWiring(sys) {
    sys.conns = [];

    const presetConns = [
        { from: 'dc_current_wire_p',       to: 'smart_switch_wire_com',      type: 'wire' },
        { from: 'dc_current_wire_n',       to: 'gnd_2_wire_gnd',           type: 'wire' },
        { from: 'smart_switch_wire_t1',     to: 'shunt_50mA_wire_l',         type: 'wire' },
        { from: 'shunt_50mA_wire_r',        to: 'gnd_ref_wire_gnd',          type: 'wire' },
        { from: 'smart_switch_wire_t2',     to: 'shunt_500mA_wire_l',        type: 'wire' },
        { from: 'shunt_500mA_wire_r',       to: 'gnd_ref_wire_gnd',          type: 'wire' },
        { from: 'smart_switch_wire_t3',     to: 'shunt_5A_wire_l',           type: 'wire' },
        { from: 'shunt_5A_wire_r',          to: 'gnd_ref_wire_gnd',          type: 'wire' },
        { from: 'smart_switch_wire_com',    to: 'dmm_ctrl_wire_vin_p',       type: 'wire' },
        { from: 'gnd_ref_wire_gnd',         to: 'dmm_ctrl_wire_vin_n',       type: 'wire' },
        { from: 'smart_switch_wire_a',      to: 'dmm_ctrl_wire_a',           type: 'wire' },
        { from: 'smart_switch_wire_b',      to: 'dmm_ctrl_wire_b',           type: 'wire' },
    ];

    presetConns.forEach(c => sys.connMgr.addConn(c));
    sys.redrawAll();
}

export function initSlider(sys) {
    const toolbar = document.getElementById('toolbar');

    const existing = document.getElementById('dcaSliderContainer');
    if (existing) existing.remove();

    const container = document.createElement('div');
    container.id = 'dcaSliderContainer';
    container.style.cssText = 'display:inline-flex;align-items:center;gap:6px;margin-left:12px;';
    container.innerHTML = '\
        <span style="font-size:12px;font-weight:bold;color:white;">测试电流:</span>\
        <input type="range" id="dcaSlider" min="0" max="5000" value="0" style="width:160px;">\
        <span id="dcaDisplay" style="font-size:12px;min-width:80px;color:white;">0 mA</span>\
    ';
    toolbar.appendChild(container);

    const slider = document.getElementById('dcaSlider');
    const display = document.getElementById('dcaDisplay');
    slider.addEventListener('input', () => {
        const val = parseFloat(slider.value) || 0;
        const source = sys.comps['dc_current'];
        if (source) {
            source.currentValue = val;
            source.update();
        }
        if (val < 1000) {
            display.textContent = val.toFixed(0) + ' mA';
        } else {
            display.textContent = (val / 1000).toFixed(2) + ' A';
        }
    });
}

export function applyAllPresets() {
    _doPresetWiring(this.sys);
}

export async function applyStartSystem() {
    const sys = this.sys;
    _doPresetWiring(sys);

    const source = sys.comps['dc_current'];
    if (source) {
        source.isOn = true;
        source.currentValue = 0;
        source.update();
    }

    const sw = sys.comps['smart_switch'];
    if (sw) {
        sw.setPosition(1);
    }

    const slider = document.getElementById('dcaSlider');
    const display = document.getElementById('dcaDisplay');
    if (slider) slider.value = 0;
    if (display) display.textContent = '0 mA';
}

export function fiveStep() {
    const sys = this.sys;
    const source = sys.comps['dc_current'];
    if (!source || !source.isOn) return;

    const slider = document.getElementById('dcaSlider');
    const display = document.getElementById('dcaDisplay');
    if (!slider) return;

    const steps = [0, 10, 20, 50, 100, 500, 1000, 2000, 5000];
    const current = parseFloat(slider.value) || 0;

    let nextVal = steps[0];
    for (const s of steps) {
        if (Math.abs(s - current) < 0.5) {
            const idx = steps.indexOf(s);
            nextVal = steps[(idx + 1) % steps.length];
            break;
        }
    }

    slider.value = nextVal;
    source.currentValue = nextVal;
    source.update();

    if (nextVal < 1000) {
        display.textContent = nextVal.toFixed(0) + ' mA';
    } else {
        display.textContent = (nextVal / 1000).toFixed(2) + ' A';
    }
}
