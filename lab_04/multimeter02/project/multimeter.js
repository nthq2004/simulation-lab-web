// MF47 型指针式万用表内部电路仿真项目
// 展示经典万用表四种测量模式（直流电流/直流电压/交流电压/电阻）的
// 磁电式表头 + 电阻分压/分流 + 二极管整流的完整工作原理

import { Oscilloscope_tri } from '../components/Osc_tri.js';
import { SignalGenerator } from '../components/SignalGenerator.js';
import { Multimeter } from '../components/Multimeter.js';
import { AmpMeter } from '../components/AmpMeter.js';
import { ProcessCalibrator } from '../components/ProcessCalibrator.js';

import { MagnetoelectricAmmeter } from '../components/MagnetoelectricAmmeter.js';
import { Resistor } from '../components/Resistor.js';
import { Diode } from '../components/Diode.js';
import { DCPower } from '../components/DCPower.js';
import { ACPower } from '../components/ACPower.js';
import { Capacitor } from '../components/Capacitor.js';
import { Ground } from '../components/Gnd.js';
import { SPDTSwitch } from '../components/SPDTSwitch.js';
import { SP4TSwitch } from '../components/SP4TSwitch.js';
import { UniversalRotarySwitch } from '../components/UniversalRotarySwitch.js';
import { MF47Multimeter } from '../components/MF47Multimeter.js';export const FAULT_CONFIGS = {};

export const PROJECT_WORKFLOWS = {};

export const componentConfigs = [
    // 五种仪表（初始隐藏）
    { Class: Oscilloscope_tri, id: 'osc3', x: 800, y: 160, visible: false },
    { Class: SignalGenerator, id: 'sg', x: 210, y: 200, visible: false },
    { Class: Multimeter, id: 'multimeter', x: 1350, y: 500, visible: false,scale:1.2 },
    { Class: AmpMeter, id: 'ampmeter', x: 450, y: 100, visible: false },
    { Class: ProcessCalibrator, id: 'cali', x: 600, y: 100, visible: false },

    // 表头（磁电式电流表 46.2μA / 5kΩ）
    { Class: MagnetoelectricAmmeter, id: 'mf47-head', x: 680, y: 20,
      label: 'MF47', fullScale: 46.2, unit: 'μA', internalR: 5000, damping: 0.6,
      width: 400, height: 400 },

    // 交流电压档分压电阻（配合整流桥）
    { Class: Resistor, id: 'r-av50', x: 640, y: 550, value: 1500000 },
    { Class: Resistor, id: 'r-av250', x: 790, y: 550, value: 6100000 },
    { Class: Resistor, id: 'r-av500', x: 940, y: 550, value: 7600000 },

    // 全波整流桥
    { Class: Diode, id: 'd1', x: 260, y: 700, vForward: 0.5 ,rotation: -90},
    { Class: Diode, id: 'd2', x: 360, y: 700, vForward: 0.5, rotation: -90 },
    { Class: Diode, id: 'd3', x: 260, y: 840, vForward: 0.5 , rotation: -90},
    { Class: Diode, id: 'd4', x: 360, y: 840, vForward: 0.5,  rotation: -90 },

    { Class: SP4TSwitch, id: 'sp4t', x: 580, y: 630, label: 'SW', position: 0,
      labelNames:['50V','250V','500V','1000V'] },

    // 交流电源
    { Class: ACPower, id: 'ac-power', x: 10, y: 500, voltageRMS: 24, frequency: 50, isOn: false },

    // 滤波电容与泄放电阻（并联在整流输出端）
    { Class: Capacitor, id: 'c-filter', x: 430, y: 750, capacitance: 1, direction: 'vertical' },
    { Class: Resistor, id: 'r-filter', x: 520, y: 750, value: 10000000, rotation: 90 },

    // 接地
    { Class: Ground, id: 'gnd-ref', x: 300, y: 950 },
    { Class: Ground, id: 'gnd-2', x: 1080, y: 500 },

    { Class: MF47Multimeter, id: 'mf47', x: 1350, y: 100}
];

export function initSlider(sys) {
    const toolbar = document.getElementById('toolbar');
    const sliderDiv = document.createElement('div');
    sliderDiv.id = 'acSliderContainer';
    sliderDiv.style.cssText = 'display:inline-flex;align-items:center;gap:6px;margin-left:12px;';
    sliderDiv.innerHTML = `
        <span style="font-size:12px;font-weight:bold;">AC电压(V):</span>
        <input type="range" id="acVoltageSlider" min="0" max="500" value="0" style="width:160px;">
        <span id="acVoltageDisplay" style="font-size:12px;min-width:50px;">0 V</span>
    `;
    toolbar.appendChild(sliderDiv);

    const slider = document.getElementById('acVoltageSlider');
    const display = document.getElementById('acVoltageDisplay');
    slider.addEventListener('input', () => {
        const v = parseFloat(slider.value);
        display.textContent = v.toFixed(0) + ' V';
        const ac = sys.comps['ac-power'];
        if (ac) {
            ac.voltageRMS = v;
            ac.update();
        }
    });
}

export function applyAllPresets() {
    const sys = this.sys;
    const conns = [
        // AC source → rectifier bridge AC inputs
        { from: 'ac-power_wire_p', to: 'd2_wire_l', type: 'wire' },
        { from: 'd2_wire_l', to: 'd4_wire_r', type: 'wire' },
        { from: 'ac-power_wire_n', to: 'd3_wire_r', type: 'wire' },
        { from: 'd1_wire_l', to: 'd3_wire_r', type: 'wire' },
        // Bridge DC+ / DC-
        { from: 'd1_wire_r', to: 'd2_wire_r', type: 'wire' },
        { from: 'd3_wire_l', to: 'd4_wire_l', type: 'wire' },
        { from: 'd4_wire_l', to: 'gnd-ref_wire_gnd', type: 'wire' },
        // 滤波电容与泄放电阻（并联在整流 DC+ / DC- 间）
        { from: 'd2_wire_r', to: 'c-filter_wire_l', type: 'wire' },
        { from: 'd4_wire_l', to: 'c-filter_wire_r', type: 'wire' },
        { from: 'r-filter_wire_l', to: 'c-filter_wire_l', type: 'wire' },
        { from: 'r-filter_wire_r', to: 'c-filter_wire_r', type: 'wire' },
        // SP4T 公共端接 DC+
        { from: 'r-filter_wire_l', to: 'sp4t_wire_com', type: 'wire' },
        // 分压电阻串联链
        { from: 'r-av50_wire_r', to: 'r-av250_wire_l', type: 'wire' },
        { from: 'r-av250_wire_r', to: 'r-av500_wire_l', type: 'wire' },
        // 分压抽头 → SP4T 触头
        { from: 'r-av50_wire_r', to: 'sp4t_wire_t1', type: 'wire' },
        { from: 'r-av250_wire_r', to: 'sp4t_wire_t2', type: 'wire' },
        { from: 'r-av500_wire_r', to: 'sp4t_wire_t3', type: 'wire' },
        // 表头 — 正极接分压链顶端，负极接 gnd-2
        { from: 'r-av50_wire_l', to: 'mf47-head_wire_l', type: 'wire' },
        { from: 'mf47-head_wire_r', to: 'gnd-2_wire_gnd', type: 'wire' },
    ];
    conns.forEach(c => sys.connMgr.addConn(c));
    sys.redrawAll();
}

export async function applyStartSystem() {
    const sys = this.sys;
    const acPower = sys.comps['ac-power'];
    if (acPower) {
        acPower.isOn = true;
        acPower.voltageRMS = 0;
        acPower.update();
    }
    const slider = document.getElementById('acVoltageSlider');
    const display = document.getElementById('acVoltageDisplay');
    if (slider) slider.value = 0;
    if (display) display.textContent = '0 V';
}

export function fiveStep() {
    const sys = this.sys;
    const sp4t = sys.comps['sp4t'];
    const position = sp4t ? sp4t.getPosition() : 1;

    const rangeSteps = {
        1: [10, 20, 30, 40, 50, 0],
        2: [50, 100, 150, 200, 250, 0],
        3: [100, 200, 300, 400, 500, 0],
        4: [10, 20, 30, 40, 50, 0],
    };

    const steps = rangeSteps[position] || rangeSteps[1];
    const acPower = sys.comps['ac-power'];
    const current = acPower ? acPower.voltageRMS : 0;

    let nextVal = steps[0];
    for (const s of steps) {
        if (Math.abs(s - current) < 0.5) {
            const idx = steps.indexOf(s);
            nextVal = steps[(idx + 1) % steps.length];
            break;
        }
    }

    if (acPower) {
        acPower.voltageRMS = nextVal;
        acPower.update();
    }
    const slider = document.getElementById('acVoltageSlider');
    const display = document.getElementById('acVoltageDisplay');
    if (slider) slider.value = nextVal;
    if (display) display.textContent = nextVal.toFixed(0) + ' V';
    sys.requestRedraw();
}
