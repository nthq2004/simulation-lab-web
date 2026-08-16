import { SmartAnalogSwitch } from '../components/SmartAnalogSwitch.js';
import { DMMController } from '../components/DMMController.js';
import { DCVoltage } from '../components/DCVoltage.js';
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
        width: 320, height: 150, function: 'DCV', position: 1 },

    { Class: DMMController, id: 'dmm_ctrl', x: 800, y: 300,
        width: 360, height: 210, switchId: 'smart_switch' },

    { Class: DCVoltage, id: 'dc_voltage', x: 180, y: 660,
        voltageValue: 0, isOn: false },
    { Class: Ground, id: 'gnd_2', x: 240, y: 900 },

    // 电压分压器公共上电阻
    { Class: Resistor, id: 'r_common', x: 510, y: 720,
        value: 10000, label: '10kΩ' },

    // 四个分压档位下电阻（Vin 经分压后不超过 200mV）
    { Class: Resistor, id: 'div_200mV', x: 490, y: 60,
        value: 10000000, label: '10MΩ' },

    { Class: Resistor, id: 'div_2V', x: 580, y: 120,
        value: 1111, label: '1kΩ' },

    { Class: Resistor, id: 'div_20V', x: 670, y: 180,
        value: 100, label: '100Ω' },

    { Class: Resistor, id: 'div_200V', x: 760, y: 240,
        value: 10, label: '10Ω' },

    { Class: Ground, id: 'gnd_ref', x: 950, y: 200 },

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
        // 电压源正极 → 公共上电阻
        { from: 'dc_voltage_wire_p',       to: 'r_common_wire_l',          type: 'wire' },
        { from: 'dc_voltage_wire_n',       to: 'gnd_2_wire_gnd',           type: 'wire' },

        // 公共上电阻 → 开关 COM
        { from: 'r_common_wire_r',          to: 'smart_switch_wire_com',    type: 'wire' },

        // 开关四个档位分别连接四个分压下电阻
        { from: 'smart_switch_wire_t1',     to: 'div_200mV_wire_l',        type: 'wire' },
        { from: 'div_200mV_wire_r',         to: 'gnd_ref_wire_gnd',        type: 'wire' },

        { from: 'smart_switch_wire_t2',     to: 'div_2V_wire_l',           type: 'wire' },
        { from: 'div_2V_wire_r',            to: 'gnd_ref_wire_gnd',        type: 'wire' },

        { from: 'smart_switch_wire_t3',     to: 'div_20V_wire_l',          type: 'wire' },
        { from: 'div_20V_wire_r',           to: 'gnd_ref_wire_gnd',        type: 'wire' },

        { from: 'smart_switch_wire_t4',     to: 'div_200V_wire_l',         type: 'wire' },
        { from: 'div_200V_wire_r',          to: 'gnd_ref_wire_gnd',        type: 'wire' },

        // DMM 测量：Vin+ 接公共上电阻右端（分压中点）, Vin- 接地
        { from: 'r_common_wire_r',          to: 'dmm_ctrl_wire_vin_p',     type: 'wire' },
        { from: 'gnd_ref_wire_gnd',         to: 'dmm_ctrl_wire_vin_n',     type: 'wire' },

        // 开关控制线
        { from: 'smart_switch_wire_a',      to: 'dmm_ctrl_wire_a',         type: 'wire' },
        { from: 'smart_switch_wire_b',      to: 'dmm_ctrl_wire_b',         type: 'wire' },
    ];

    presetConns.forEach(c => sys.connMgr.addConn(c));
    sys.redrawAll();
}

export function initSlider(sys) {
    const toolbar = document.getElementById('toolbar');

    const existing = document.getElementById('dcvSliderContainer');
    if (existing) existing.remove();

    const container = document.createElement('div');
    container.id = 'dcvSliderContainer';
    container.style.cssText = 'display:inline-flex;align-items:center;gap:6px;margin-left:12px;';
    container.innerHTML = '\
        <span style="font-size:12px;font-weight:bold;color:white;">测试电压:</span>\
        <input type="range" id="dcvSlider" min="0" max="200000" value="0" style="width:200px;">\
        <span id="dcvDisplay" style="font-size:12px;min-width:80px;color:white;">0 mV</span>\
    ';
    toolbar.appendChild(container);

    const slider = document.getElementById('dcvSlider');
    const display = document.getElementById('dcvDisplay');
    slider.addEventListener('input', () => {
        const val = parseFloat(slider.value) || 0;
        const source = sys.comps['dc_voltage'];
        if (source) {
            source.voltageValue = val / 1000;
            source.update();
        }
        if (val < 1000) {
            display.textContent = val.toFixed(0) + ' mV';
        } else if (val < 100000) {
            display.textContent = (val / 1000).toFixed(3) + ' V';
        } else {
            display.textContent = (val / 1000).toFixed(1) + ' V';
        }
    });
}

export function applyAllPresets() {
    _doPresetWiring(this.sys);
}

export async function applyStartSystem() {
    const sys = this.sys;
    _doPresetWiring(sys);

    const source = sys.comps['dc_voltage'];
    if (source) {
        source.isOn = true;
        source.voltageValue = 0;
        source.update();
    }

    const sw = sys.comps['smart_switch'];
    if (sw) {
        sw.setPosition(1);
    }

    const slider = document.getElementById('dcvSlider');
    const display = document.getElementById('dcvDisplay');
    if (slider) slider.value = 0;
    if (display) display.textContent = '0 mV';
}

export function fiveStep() {
    const sys = this.sys;
    const source = sys.comps['dc_voltage'];
    if (!source || !source.isOn) return;

    const slider = document.getElementById('dcvSlider');
    const display = document.getElementById('dcvDisplay');
    if (!slider) return;

    const steps = [0, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 50000, 100000, 200000];
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
    source.voltageValue = nextVal / 1000;
    source.update();

    if (nextVal < 1000) {
        display.textContent = nextVal.toFixed(0) + ' mV';
    } else if (nextVal < 100000) {
        display.textContent = (nextVal / 1000).toFixed(3) + ' V';
    } else {
        display.textContent = (nextVal / 1000).toFixed(1) + ' V';
    }
}
