import { SmartAnalogSwitch } from '../components/SmartAnalogSwitch.js';
import { DMMController } from '../components/DMMController.js';
import { ConstantCurrentSource } from '../components/ConstantCurrentSource.js';
import { Resistor } from '../components/Resistor.js';
import { RealResistor } from '../components/RealResistor.js';
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
        width: 320, height: 150, function: 'R', position: 1
    },

    {
        Class: DMMController, id: 'dmm_ctrl', x: 800, y: 300,
        width: 360, height: 210, switchId: 'smart_switch'
    },

    { Class: ConstantCurrentSource, id: 'cc_source', x: 220, y: 120 },
    { Class: Ground, id: 'gnd_2', x: 150, y: 280 },
    // 测试电阻（模拟被测电阻）
    {
        Class: RealResistor, id: 'test_r', x: 240, y: 640,
        value: 1000, label: '1kΩ'
    },

    { Class: Ground, id: 'gnd_ref', x: 600, y: 280 },

    // 五种仪表（初始隐藏）
    { Class: Multimeter, id: 'multimeter', x: 1150, y: 80, visible: false, scale: 1.2 },
    { Class: AmpMeter, id: 'ampmeter', x: 1150, y: 460, visible: false },
    { Class: SignalGenerator, id: 'sg', x: 80, y: 550, visible: false },
    { Class: ProcessCalibrator, id: 'cali', x: 1050, y: 650, visible: false },
    { Class: Oscilloscope_tri, id: 'osc3', x: 800, y: 480, visible: false },
];

function _doPresetWiring(sys) {
    sys.conns = [];

    const presetConns = [
        // 恒流源 I1-I4 → 开关 T1-T4
        { from: 'cc_source_wire_i1', to: 'smart_switch_wire_t1', type: 'wire' },
        { from: 'cc_source_wire_i2', to: 'smart_switch_wire_t2', type: 'wire' },
        { from: 'cc_source_wire_i3', to: 'smart_switch_wire_t3', type: 'wire' },
        { from: 'cc_source_wire_i4', to: 'smart_switch_wire_t4', type: 'wire' },

        // 开关 COM → 测试电阻上端
        { from: 'smart_switch_wire_com', to: 'test_r_wire_r', type: 'wire' },

        // 测试电阻下端 → 恒流源 COM
        { from: 'test_r_wire_l', to: 'cc_source_wire_com', type: 'wire' },
        // 恒流源 GND → 系统地
        { from: 'cc_source_wire_com', to: 'gnd_2_wire_gnd', type: 'wire' },

        // DMM 测量电压：Vin+ 接测试电阻上端，Vin- 接测试电阻下端
        { from: 'smart_switch_wire_com', to: 'dmm_ctrl_wire_vin_p', type: 'wire' },
        { from: 'gnd_ref_wire_gnd', to: 'dmm_ctrl_wire_vin_n', type: 'wire' },

        // 开关控制线
        { from: 'smart_switch_wire_a', to: 'dmm_ctrl_wire_a', type: 'wire' },
        { from: 'smart_switch_wire_b', to: 'dmm_ctrl_wire_b', type: 'wire' },
    ];

    presetConns.forEach(c => sys.connMgr.addConn(c));
    sys.redrawAll();
}

export function initSlider(sys) {
    const toolbar = document.getElementById('toolbar');

    const existing = document.getElementById('ohmSliderContainer');
    if (existing) existing.remove();

    const container = document.createElement('div');
    container.id = 'ohmSliderContainer';
    container.style.cssText = 'display:inline-flex;align-items:center;gap:6px;margin-left:12px;';
    container.innerHTML = '\
        <span style="font-size:12px;font-weight:bold;color:white;">测试电阻:</span>\
        <input type="range" id="ohmSlider" min="0" max="2000000" value="1000" style="width:200px;">\
        <span id="ohmDisplay" style="font-size:12px;min-width:80px;color:white;">1.00 kΩ</span>\
    ';
    toolbar.appendChild(container);

    const slider = document.getElementById('ohmSlider');
    const display = document.getElementById('ohmDisplay');
    slider.addEventListener('input', () => {
        const val = parseFloat(slider.value) || 0;
        const r = sys.comps['test_r'];
        if (r) {
            const v = Math.max(1, val);
            r.value = v;
            r.currentResistance = v;
            let txt = v >= 1000 ? (v / 1000).toFixed(1) + ' kΩ' : v + ' Ω';
            r.label.text(txt + ' ');
            r._refreshCache();
        }
        if (val < 1000) {
            display.textContent = val.toFixed(0) + ' Ω';
        } else if (val < 1000000) {
            display.textContent = (val / 1000).toFixed(2) + ' kΩ';
        } else {
            display.textContent = (val / 1000000).toFixed(2) + ' MΩ';
        }
    });
}

export function applyAllPresets() {
    _doPresetWiring(this.sys);
}

export async function applyStartSystem() {
    const sys = this.sys;
    _doPresetWiring(sys);

    const sw = sys.comps['smart_switch'];
    if (sw) {
        sw.setPosition(1);
    }

    const r = sys.comps['test_r'];
    if (r) {
        r.value = 1000;
        r.currentResistance = 1000;
        r.label.text('1.0 kΩ ');
        r._refreshCache();
    }

    const slider = document.getElementById('ohmSlider');
    const display = document.getElementById('ohmDisplay');
    if (slider) slider.value = 1000;
    if (display) display.textContent = '1.00 kΩ';
}

export function fiveStep() {
    const sys = this.sys;

    const slider = document.getElementById('ohmSlider');
    const display = document.getElementById('ohmDisplay');
    if (!slider) return;

    const steps = [1, 10, 100, 1000, 10000, 100000, 1000000, 2000000];
    const current = parseFloat(slider.value) || 1000;

    let nextVal = steps[0];
    for (const s of steps) {
        if (Math.abs(s - current) < 0.5) {
            const idx = steps.indexOf(s);
            nextVal = steps[(idx + 1) % steps.length];
            break;
        }
    }

    slider.value = nextVal;
    const r = sys.comps['test_r'];
    if (r) {
        const v = Math.max(1, nextVal);
        r.value = v;
        r.currentResistance = v;
        let txt = v >= 1000 ? (v / 1000).toFixed(1) + ' kΩ' : v + ' Ω';
        r.label.text(txt + ' ');
        r._refreshCache();
    }

    if (nextVal < 1000) {
        display.textContent = nextVal.toFixed(0) + ' Ω';
    } else if (nextVal < 1000000) {
        display.textContent = (nextVal / 1000).toFixed(2) + ' kΩ';
    } else {
        display.textContent = (nextVal / 1000000).toFixed(2) + ' MΩ';
    }
}
