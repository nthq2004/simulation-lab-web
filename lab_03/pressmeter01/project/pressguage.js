// 压力表项目配置文件
// 空的故障配置和流程配置，但实现 5 点步进压力切换

import { Oscilloscope_tri } from '../components/Osc_tri.js';
import { SignalGenerator } from '../components/SignalGenerator.js';
import { Multimeter } from '../components/Multimeter.js';
import { AmpMeter } from '../components/AmpMeter.js';
import { ProcessCalibrator } from '../components/ProcessCalibrator.js';

import { BourdonTube } from '../components/BourdonTube.js';
import { DiaphragmGauge } from '../components/DiaphragmGauge.js';
import { AirBottle } from '../components/AirBottle.js';
import { PressRegulator } from '../components/PressRegulator.js';
import { TeeConnector } from '../components/TeeConnector.js';

export const FAULT_CONFIGS = {};

export const PROJECT_WORKFLOWS = {};

/** 组件配置列表，由 consys.js 引入并实例化 */
export const componentConfigs = [
    { Class: Oscilloscope_tri, id: 'osc3', x: 800, y: 160, visible: false },
    { Class: SignalGenerator, id: 'sg', x: 210, y: 200, visible: false },
    { Class: Multimeter, id: 'multimeter', x: 1350, y: 500, visible: false },
    { Class: AmpMeter, id: 'ampmeter', x: 450, y: 100, visible: false },
    { Class: ProcessCalibrator, id: 'cali', x: 600, y: 100, visible: false },

    // ── 空气瓶（左侧气源）──
    { Class: AirBottle, id: 'cab', x: 1380, y: 500,
      initialPressure: 2, unit: 'MPa', volume: 50 },

    // ── 调压阀（中部）──
    { Class: PressRegulator, id: 'reg', x: 1080, y: 500,
      setPressure: 0, unit: 'MPa' },

    // ── 三通接口（分流至两块压力表）──
    { Class: TeeConnector, id: 'tee', x: 680, y: 500,
      direction: 'up' },

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
 * 一键自动连线：建立气路连接
 *   cab(气瓶) → reg(调压阀) → tee(三通) → bourdon(波登管)
 *                                        → diaphragm(膜片)
 */
export function applyAllPresets() {
    const sys = this.sys;
    const conns = [
        { from: 'cab_pipe_o', to: 'reg_pipe_i', type: 'pipe' },
        { from: 'reg_pipe_o', to: 'tee_pipe_r', type: 'pipe' },
        { from: 'tee_pipe_l', to: 'bourdon_pipe_i', type: 'pipe' },
        { from: 'tee_pipe_u', to: 'diaphragm_pipe_i', type: 'pipe' },
    ];
    conns.forEach(c => {
        sys.conns.push(c);
    });

    // 调压阀手轮调节时同步滑块值
    const reg = sys.comps['reg'];
    if (reg && reg.applyDelta) {
        const origApplyDelta = reg.applyDelta.bind(reg);
        reg.applyDelta = function(delta) {
            origApplyDelta(delta);
            const slider = document.getElementById('pressSlider');
            const display = document.getElementById('pressDisplay');
            if (slider && display) {
                const kPa = Math.round(this.setPressure * 1000);
                slider.value = Math.min(100, Math.max(0, kPa));
                display.textContent = parseFloat(slider.value).toFixed(1) + ' kPa';
            }
        };
    }

    sys.redrawAll();
}

/**
 * 启动系统：无需额外操作（气源常开）
 */
export async function applyStartSystem() {

}

/**
 * 5点步进系统：压力循环 0 → 25 → 50 → 75 → 100 → 0 (kPa)
 * 仅改变调压阀的设定压力，仪表由气路求解器更新。
 */
export function fiveStep() {
    const sys = this.sys;
    const pressures = [0, 25, 50, 75, 100];
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

    // 仅控制调压阀设定压力（kPa → MPa）
    const reg = sys.comps['reg'];
    if (reg) {
        reg.setPressure = nextPress / 1000;
        reg.update();
    }
}
