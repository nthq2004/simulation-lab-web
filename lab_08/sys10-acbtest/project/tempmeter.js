// 温度仪表原理演示项目
// 四种温度显示仪表：双金属温度计、水银温度计、温度表、手持红外测温仪

import { Oscilloscope_tri } from '../components/Osc_tri.js';
import { SignalGenerator } from '../components/SignalGenerator.js';
import { Multimeter } from '../components/Multimeter.js';
import { AmpMeter } from '../components/AmpMeter.js';
import { ProcessCalibrator } from '../components/ProcessCalibrator.js';

import { BimetallicThermometer } from '../components/Bimetallicthermometer.js';
import { MercuryThermometer } from '../components/Mercurythermometer.js';
import { TempMeter } from '../components/TempMeter.js';
import { IRThermometer } from '../components/IRthermometer.js';

export const FAULT_CONFIGS = {};

export const PROJECT_WORKFLOWS = {};

export const componentConfigs = [
    // 工具组件（初始隐藏）
    { Class: Oscilloscope_tri, id: 'osc3', x: 800, y: 160, visible: false },
    { Class: SignalGenerator, id: 'sg', x: 210, y: 200, visible: false },
    { Class: Multimeter, id: 'multimeter', x: 1350, y: 500, visible: false },
    { Class: AmpMeter, id: 'ampmeter', x: 450, y: 100, visible: false },
    { Class: ProcessCalibrator, id: 'cali', x: 600, y: 100, visible: false },

    // ── 双金属温度计（等间距排列）──
    { Class: BimetallicThermometer, id: 'bimetal-tm', x: 160, y: 80,
      label: 'TI-101', tempMin: 0, tempMax: 100, initTemp: 0 },

    // ── 水银温度计 ──
    { Class: MercuryThermometer, id: 'mercury-tm', x: 580, y: 80,
      label: 'TT-201', tempMin: 0, tempMax: 100, initTemp: 0 },

    // ── 温度表 ──
    { Class: TempMeter, id: 'tempmeter', x: 900, y: 180,
      title: '温度表℃', min: 0, max: 100 },

    // ── 手持红外测温仪 ──
    { Class: IRThermometer, id: 'ir-tm', x: 1180, y: 120,
      label: 'IR-301', initTemp: 0, emissivity: 0.95 },
];

function _applyTemp(sys, temp) {
    const ids = ['bimetal-tm', 'mercury-tm', 'tempmeter', 'ir-tm'];
    ids.forEach(id => {
        const comp = sys.comps[id];
        if (comp && comp.update) comp.update(temp);
    });
    sys.requestRedraw();
}

export function initSlider(sys) {
    const toolbar = document.getElementById('toolbar');
    const sliderDiv = document.createElement('div');
    sliderDiv.id = 'tempSliderContainer';
    sliderDiv.style.cssText = 'display:inline-flex;align-items:center;gap:6px;margin-left:12px;';
    sliderDiv.innerHTML = `
        <span style="font-size:12px;font-weight:bold;">温度:</span>
        <input type="range" id="tempSlider" min="0" max="100" value="0" style="width:160px;">
        <span id="tempDisplay" style="font-size:12px;min-width:60px;">0 °C</span>
    `;
    toolbar.appendChild(sliderDiv);

    const slider = document.getElementById('tempSlider');
    const display = document.getElementById('tempDisplay');
    slider.addEventListener('input', () => {
        const temp = parseFloat(slider.value);
        display.textContent = temp.toFixed(0) + ' °C';
        _applyTemp(sys, temp);
    });
}

export function applyAllPresets() {
}

export async function applyStartSystem() {
}

export function fiveStep() {
    const sys = this.sys;
    const steps = [0, 25, 50, 75, 100];
    const slider = document.getElementById('tempSlider');
    const current = slider ? parseFloat(slider.value) : 0;

    let nextVal = steps[0];
    for (const s of steps) {
        if (Math.abs(s - current) < 1) {
            const idx = steps.indexOf(s);
            nextVal = steps[(idx + 1) % steps.length];
            break;
        }
    }

    if (slider) slider.value = nextVal;
    const display = document.getElementById('tempDisplay');
    if (display) display.textContent = nextVal.toFixed(0) + ' °C';

    _applyTemp(sys, nextVal);
}
