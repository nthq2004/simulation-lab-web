// 压力表项目配置文件
// 空的故障配置和流程配置，但实现 5 点步进压力切换

import { Oscilloscope_tri } from '../components/Osc_tri.js';
import { SignalGenerator } from '../components/SignalGenerator.js';
import { Multimeter } from '../components/Multimeter.js';
import { AmpMeter } from '../components/AmpMeter.js';
import { ProcessCalibrator } from '../components/ProcessCalibrator.js';

import { BourdonTube } from '../components/BourdonTube.js';
import { DiaphragmGauge } from '../components/DiaphragmGauge.js';

export const FAULT_CONFIGS = {};

export const PROJECT_WORKFLOWS = {};

/** 组件配置列表，由 consys.js 引入并实例化 */
export const componentConfigs = [
    { Class: Oscilloscope_tri, id: 'osc3', x: 800, y: 160, visible: false },
    { Class: SignalGenerator, id: 'sg', x: 210, y: 200, visible: false },
    { Class: Multimeter, id: 'multimeter', x: 1350, y: 500, visible: false },
    { Class: AmpMeter, id: 'ampmeter', x: 450, y: 100, visible: false },
    { Class: ProcessCalibrator, id: 'cali', x: 600, y: 100, visible: false },

    // ── 波登管压力表（左侧）──
    { Class: BourdonTube, id: 'bourdon', x: 350, y: 80,
      width: 300, height: 360, label: 'PI-101',
      rangeMax: 100, rangeUnit: 'kPa', dialDivs: 10,
      initPressure: 0 },
    // ── 膜片式压力表（右侧）──
    { Class: DiaphragmGauge, id: 'diaphragm', x: 800, y: 80,
      width: 300, height: 400, label: 'PI-201',
      rangeMax: 100, rangeUnit: 'kPa', dialDivs: 10,
      initPressure: 0 },
];

/**
 * 初始化压力滑块（项目特有）
 * @param {object} sys - ControlSystem 实例
 */
export function initSlider(sys) {
    const toolbar = document.getElementById('toolbar');
    const sliderDiv = document.createElement('div');
    sliderDiv.id = 'pressSliderContainer';
    sliderDiv.style.cssText = 'display:inline-flex;align-items:center;gap:6px;margin-left:12px;';
    sliderDiv.innerHTML = `
        <span style="font-size:12px;font-weight:bold;">压力:</span>
        <input type="range" id="pressSlider" min="0" max="100" value="0" style="width:160px;">
        <span id="pressDisplay" style="font-size:12px;min-width:60px;">0.0 kPa</span>
    `;
    toolbar.appendChild(sliderDiv);

    const slider = document.getElementById('pressSlider');
    const display = document.getElementById('pressDisplay');
    slider.addEventListener('input', () => {
        const press = parseFloat(slider.value);
        display.textContent = press.toFixed(1) + ' kPa';
        if (sys.comps['bourdon'] && sys.comps['bourdon'].applyPressure) {
            sys.comps['bourdon'].applyPressure(press);
        }
        if (sys.comps['diaphragm'] && sys.comps['diaphragm'].applyPressure) {
            sys.comps['diaphragm'].applyPressure(press);
        }
        sys.requestRedraw();
    });
}

/**
 * 一键自动连线：将预设的逻辑关系注入连接池
 */
export function applyAllPresets() {
    const sys = this.sys;
    sys.redrawAll();
}

/**
 * 启动系统：开启直流电源
 */
export async function applyStartSystem() {

}

/**
 * 5点步进系统：压力循环 0 → 25 → 50 → 75 → 100 → 0
 * 在 WorkflowManager 上下文中调用，this 指向 WorkflowManager 实例
 */
export function fiveStep() {
    const sys = this.sys;
    const pressures = [0, 25, 50, 75, 100];
    // 获取当前压力滑块值
    const slider = document.getElementById('pressSlider');
    const display = document.getElementById('pressDisplay');
    const currentPress = slider ? parseFloat(slider.value) : 0;

    let nextPress = pressures[0];
    for (const p of pressures) {
        if (Math.abs(p - currentPress) < 1) {
            const idx = pressures.indexOf(p);
            nextPress = pressures[(idx + 1) % pressures.length];
            break;
        }
    }

    if (slider) slider.value = nextPress;
    if (display) display.textContent = nextPress.toFixed(1) + ' kPa';

    if (sys.comps['bourdon'] && sys.comps['bourdon'].applyPressure) {
        sys.comps['bourdon'].applyPressure(nextPress);
    }
    if (sys.comps['diaphragm'] && sys.comps['diaphragm'].applyPressure) {
        const dPress = Math.min(nextPress, sys.comps['diaphragm'].rangeMax);
        sys.comps['diaphragm'].applyPressure(dPress);
    }
}
