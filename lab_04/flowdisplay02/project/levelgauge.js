// 液位计项目配置文件
// 磁翻板液位计 + 浮子钢带液位计 + 玻璃板液位计 三仪表显示

import { Oscilloscope_tri } from '../components/Osc_tri.js';
import { SignalGenerator } from '../components/SignalGenerator.js';
import { Multimeter } from '../components/Multimeter.js';
import { AmpMeter } from '../components/AmpMeter.js';
import { ProcessCalibrator } from '../components/ProcessCalibrator.js';

import { MagneticFlipLevelGauge } from '../components/MagneticFlipLevelGauge.js';
import { GlassPlateLevelGauge } from '../components/GlassPlateLevelGauge.js';
import { FloatTapeLevelGauge } from '../components/FloatTapeLevelGauge.js';
import { SealedOilTank } from '../components/SealedOilTank.js';

export const FAULT_CONFIGS = {};

export const PROJECT_WORKFLOWS = {};

/** 组件配置列表，由 consys.js 引入并实例化 */
export const componentConfigs = [
    { Class: Oscilloscope_tri, id: 'osc3', x: 800, y: 160, visible: false },
    { Class: SignalGenerator, id: 'sg', x: 210, y: 200, visible: false },
    { Class: Multimeter, id: 'multimeter', x: 1350, y: 500, visible: false },
    { Class: AmpMeter, id: 'ampmeter', x: 450, y: 100, visible: false },
    { Class: ProcessCalibrator, id: 'cali', x: 600, y: 100, visible: false },


    // ── 磁翻板液位计（左侧）──
    { Class: MagneticFlipLevelGauge, id: 'magLevel', x: 120, y: 60,
      width: 340, height: 440, label: 'LI-101',
      totalRange: 1000, flipCount: 30,
      hiAlarm: 85, loAlarm: 15, initLevel: 0,
      withTransmitter: true },


    // ── 玻璃板液位计（右侧）──
    { Class: GlassPlateLevelGauge, id: 'glassLevel', x: 760, y: 60,
      width: 240, height: 440, label: 'LI-201',
      totalRange: 1000,
      hiAlarm: 85, loAlarm: 15, initLevel: 0 },

    // ── 密封油柜（最右侧）──
    { Class: SealedOilTank, id: 'oilTank', x: 1100, y: 60,
      width: 260, height: 420, label: 'TK-101',
      capacity: 100, initLevel: 0 },
];

/**
 * 初始化液位滑块（项目特有）
 * @param {object} sys - ControlSystem 实例
 */
export function initSlider(sys) {
    const toolbar = document.getElementById('toolbar');
    const sliderDiv = document.createElement('div');
    sliderDiv.id = 'levelSliderContainer';
    sliderDiv.style.cssText = 'display:inline-flex;align-items:center;gap:6px;margin-left:12px;';
    sliderDiv.innerHTML = `
        <span style="font-size:12px;font-weight:bold;">液位:</span>
        <input type="range" id="levelSlider" min="0" max="100" value="40" style="width:160px;">
        <span id="levelDisplay" style="font-size:12px;min-width:60px;">40.0 %</span>
    `;
    toolbar.appendChild(sliderDiv);

    const slider = document.getElementById('levelSlider');
    const display = document.getElementById('levelDisplay');
    slider.addEventListener('input', () => {
        const level = parseFloat(slider.value);
        display.textContent = level.toFixed(1) + ' %';
        // 只更新油柜油位，液位计通过管路连接自动同步
        const tank = sys.comps.oilTank;
        if (tank && tank.update) tank.update(level);
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
 * 启动系统
 */
export async function applyStartSystem() {

}

/**
 * 5点步进系统：液位循环 0 → 25 → 50 → 75 → 100 → 0
 * 在 WorkflowManager 上下文中调用，this 指向 WorkflowManager 实例
 */
export function fiveStep() {
    const sys = this.sys;
    const levels = [0, 25, 50, 75, 100];
    // 获取当前液位滑块值
    const slider = document.getElementById('levelSlider');
    const display = document.getElementById('levelDisplay');
    const currentLevel = slider ? parseFloat(slider.value) : 0;

    let nextLevel = levels[0];
    for (const p of levels) {
        if (Math.abs(p - currentLevel) < 1) {
            const idx = levels.indexOf(p);
            nextLevel = levels[(idx + 1) % levels.length];
            break;
        }
    }

    if (slider) slider.value = nextLevel;
    if (display) display.textContent = nextLevel.toFixed(1) + ' %';

    // 只更新油柜油位，液位计通过管路连接自动同步
    const tank = sys.comps.oilTank;
    if (tank && tank.update) tank.update(nextLevel);
}
