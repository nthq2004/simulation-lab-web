import { SmartAnalogSwitch } from '../components/SmartAnalogSwitch.js';
import { DMMController } from '../components/DMMController.js';
import { ConstantCurrentSource } from '../components/ConstantCurrentSource.js';
import { Resistor } from '../components/Resistor.js';
import { Diode } from '../components/Diode.js';
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
        width: 320, height: 150, function: 'Diode', position: 1
    },

    {
        Class: DMMController, id: 'dmm_ctrl', x: 800, y: 300,
        width: 360, height: 210, switchId: 'smart_switch'
    },

    { Class: ConstantCurrentSource, id: 'cc_source', x: 220, y: 120 },
    { Class: Ground, id: 'gnd_2', x: 150, y: 280 },

    // 被测二极管
    {
        Class: Diode, id: 'test_diode', x: 380, y: 690,
        vForward: 0.6, direction: 'normal',rotation:180 
    },
    { Class: Resistor, id: 'r_diode', x: 590, y: 600,
        value: 1000, label: '1000Ω' },

    // 1/20 分压电路：19kΩ + 1kΩ
    { Class: Resistor, id: 'r_div_top', x: 560, y: 700,
        value: 19000, label: '19kΩ',rotation:90 },

    { Class: Resistor, id: 'r_div_bot', x: 560, y: 820,
        value: 1000, label: '1kΩ',rotation:90  },

    { Class: Ground, id: 'gnd_ref', x: 780, y: 770 },

    // 五种仪表（初始隐藏）
    { Class: Multimeter, id: 'multimeter', x: 1150, y: 80, visible: false, scale: 1.2 },
    { Class: AmpMeter, id: 'ampmeter', x: 1150, y: 460, visible: false },
    { Class: SignalGenerator, id: 'sg', x: 80, y: 550, visible: false },
    { Class: ProcessCalibrator, id: 'cali', x: 1050, y: 650, visible: false },
    { Class: Oscilloscope_tri, id: 'osc3', x: 800, y: 480, visible: false },
];

function _doPresetWiring(sys, isReverse) {
    sys.conns = [];

    const presetConns = [
        // CC 1mA → 开关 T1
        { from: 'cc_source_wire_i1', to: 'smart_switch_wire_t1', type: 'wire' },
            { from: 'smart_switch_wire_com', to: 'r_diode_wire_r', type: 'wire' },        

        // 开关 COM → 二极管（根据正反向决定连接极性）
        isReverse
            ? { from: 'cc_source_wire_com', to: 'test_diode_wire_l', type: 'wire' }
            : { from: 'cc_source_wire_com', to: 'test_diode_wire_r', type: 'wire' },

        isReverse
            ? { from: 'test_diode_wire_r', to: 'r_diode_wire_l', type: 'wire' }
            : { from: 'test_diode_wire_l', to: 'r_diode_wire_l', type: 'wire' },

        // CC COM → 系统地
        { from: 'cc_source_wire_com', to: 'gnd_2_wire_gnd', type: 'wire' },

        // 分压电路：二极管阳极 → 19kΩ → 分压中点 → 1kΩ → GND
        { from: 'r_diode_wire_l', to: 'r_div_top_wire_l', type: 'wire' },
        { from: 'r_div_top_wire_r', to: 'r_div_bot_wire_l', type: 'wire' },
        { from: 'r_div_bot_wire_r', to: 'gnd_ref_wire_gnd', type: 'wire' },

        // DMM 测量分压中点电压（还原为二极管实际压降）
        { from: 'r_div_top_wire_r', to: 'dmm_ctrl_wire_vin_p', type: 'wire' },
        { from: 'gnd_ref_wire_gnd', to: 'dmm_ctrl_wire_vin_n', type: 'wire' },

        // 开关控制线
        { from: 'smart_switch_wire_a', to: 'dmm_ctrl_wire_a', type: 'wire' },
        { from: 'smart_switch_wire_b', to: 'dmm_ctrl_wire_b', type: 'wire' },
    ];

    presetConns.forEach(c => sys.connMgr.addConn(c));
    sys.redrawAll();
}

function _updateVfDisplay(val) {
    const display = document.getElementById('diodeDisplay');
    if (display) {
        display.textContent = (val / 1000).toFixed(3) + ' V';
    }
}

export function initSlider(sys) {
    const toolbar = document.getElementById('toolbar');

    const existing = document.getElementById('diodeSliderContainer');
    if (existing) existing.remove();

    const container = document.createElement('div');
    container.id = 'diodeSliderContainer';
    container.style.cssText = 'display:inline-flex;align-items:center;gap:6px;margin-left:12px;';
    container.innerHTML = '\
        <span style="font-size:12px;font-weight:bold;color:white;">导通压降:</span>\
        <input type="range" id="diodeVfSlider" min="200" max="800" value="600" style="width:160px;">\
        <span id="diodeDisplay" style="font-size:12px;min-width:70px;color:white;">0.600 V</span>\
        <label style="font-size:12px;color:white;margin-left:12px;user-select:none;">\
            <input type="checkbox" id="reverseCheck"> 反向测试\
        </label>\
    ';
    toolbar.appendChild(container);

    const vfSlider = document.getElementById('diodeVfSlider');
    const reverseCheck = document.getElementById('reverseCheck');

    vfSlider.addEventListener('input', () => {
        const val = parseFloat(vfSlider.value) || 600;
        const diode = sys.comps['test_diode'];
        if (diode) {
            const vf = val / 1000;
            diode.vForward = vf;
            diode.config = { ...diode.config, vForward: vf };
            diode._updateVfLabel();
        }
        _updateVfDisplay(val);
    });

    reverseCheck.addEventListener('change', () => {
        const isReverse = reverseCheck.checked;
        const diode = sys.comps['test_diode'];
        if (diode && isReverse) {
            diode.group.rotation(360);
        } else if (diode) {
            diode.group.rotation(180);
        }
        _doPresetWiring(sys, isReverse);
    });

    if (sys.eventBus) {
        sys.eventBus.on('diode:vfChanged', (data) => {
            if (data.id !== 'test_diode') return;
            const vfVal = Math.round(data.vForward * 1000);
            const slider = document.getElementById('diodeVfSlider');
            const display = document.getElementById('diodeDisplay');
            if (slider) slider.value = vfVal;
            _updateVfDisplay(vfVal);
            const diode = sys.comps['test_diode'];
            if (diode) {
                diode.config = { ...diode.config, vForward: data.vForward };
                diode._updateVfLabel();
            }
        });
    }
}

export function applyAllPresets() {
    _doPresetWiring(this.sys, false);
}

export async function applyStartSystem() {

}

export function fiveStep() {
    const sys = this.sys;

    const slider = document.getElementById('diodeVfSlider');
    const display = document.getElementById('diodeDisplay');
    if (!slider) return;

    const steps = [200, 300, 400, 500, 600, 700, 800];
    const current = parseFloat(slider.value) || 600;

    let nextVal = steps[0];
    for (const s of steps) {
        if (Math.abs(s - current) < 1) {
            const idx = steps.indexOf(s);
            nextVal = steps[(idx + 1) % steps.length];
            break;
        }
    }

    slider.value = nextVal;
    const diode = sys.comps['test_diode'];
    if (diode) {
        const vf = nextVal / 1000;
        diode.vForward = vf;
        diode.config = { ...diode.config, vForward: vf };
        diode._updateVfLabel();
    }
    _updateVfDisplay(nextVal);
}
