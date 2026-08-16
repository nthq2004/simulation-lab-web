// 流量计原理演示项目
// 冷却水循环回路：Engine → Pump → Tee → (Rotameter/DpFlowIndicator→Cooler) → ElecValve → ImpellerFlowIndicator → Engine

import { Oscilloscope_tri } from '../components/Osc_tri.js';
import { SignalGenerator } from '../components/SignalGenerator.js';
import { Multimeter } from '../components/Multimeter.js';
import { AmpMeter } from '../components/AmpMeter.js';
import { ProcessCalibrator } from '../components/ProcessCalibrator.js';

import { Engine } from '../components/Engine.js';
import { Pump } from '../components/Pump.js';
import { TeeConnector } from '../components/TeeConnector.js';
import { Cooler } from '../components/Cooler.js';
import { ElecValve } from '../components/ElecValve.js';
import { DpFlowIndicator } from '../components/DpFlowIndicator.js';
import { ImpellerFlowIndicator } from '../components/ImpellerFlowIndicator.js';
import { Rotameter } from '../components/Rotameter.js';

export const FAULT_CONFIGS = {};

export const PROJECT_WORKFLOWS = {};

export const componentConfigs = [
    // 工具组件（初始隐藏）
    { Class: Oscilloscope_tri, id: 'osc3', x: 800, y: 160, visible: false },
    { Class: SignalGenerator, id: 'sg', x: 210, y: 200, visible: false },
    { Class: Multimeter, id: 'multimeter', x: 1350, y: 500, visible: false },
    { Class: AmpMeter, id: 'ampmeter', x: 450, y: 100, visible: false },
    { Class: ProcessCalibrator, id: 'cali', x: 600, y: 100, visible: false },

    // ── 冷却水循环系统组件 ──
    { Class: Engine, id: 'engine-01', x: 80, y: 320,
      label: 'ME-01' },

    { Class: Pump, id: 'pump-01', x: 300, y: 320,
      label: 'P-01' },

    { Class: TeeConnector, id: 'tee-01', x: 500, y: 340 },

    { Class: Rotameter, id: 'rotameter-01', x: 440, y: 120,
      label: 'FI-201', scale: 0.8 },

    { Class: DpFlowIndicator, id: 'dp-flow-01', x: 680, y: 280,
      label: 'FI-101', scale: 0.8 },

    { Class: Cooler, id: 'cooler-01', x: 920, y: 300,
      label: 'CL-01' },

    { Class: ElecValve, id: 'elecValve', x: 680, y: 520,
      label: 'HV-01' },

    { Class: ImpellerFlowIndicator, id: 'impeller-flow-01', x: 920, y: 520,
      label: 'FI-301', scale: 0.8 },
];

/**
 * 初始化阀位滑块（双向同步）
 * 滑块 → ElecValve（正向控制）
 * ElecValve（手轮操作）→ 滑块（反向轮询同步）
 */
export function initSlider(sys) {
    const toolbar = document.getElementById('toolbar');
    const sliderDiv = document.createElement('div');
    sliderDiv.id = 'valveSliderContainer';
    sliderDiv.style.cssText = 'display:inline-flex;align-items:center;gap:6px;margin-left:12px;';
    sliderDiv.innerHTML = `
        <span style="font-size:12px;font-weight:bold;">阀位:</span>
        <input type="range" id="valveSlider" min="0" max="100" value="0" style="width:160px;">
        <span id="valveDisplay" style="font-size:12px;min-width:50px;">0 %</span>
    `;
    toolbar.appendChild(sliderDiv);

    const slider = document.getElementById('valveSlider');
    const display = document.getElementById('valveDisplay');

    // 正向：滑块 → ElecValve
    slider.addEventListener('input', () => {
        const pos = parseFloat(slider.value);
        display.textContent = pos.toFixed(0) + ' %';
        const valve = sys.comps.elecValve;
        if (!valve) return;
        if (valve.controlMode === 'MANUAL') {
            valve.manualPos = pos / 100;
        } else {
            valve.remotePos = pos / 100;
        }
        valve.update();
        sys.requestRedraw();
    });

    // 反向：ElecValve（手轮/远程改变）→ 滑块（轮询）
    setInterval(() => {
        const valve = sys.comps.elecValve;
        if (!valve || !slider || !display) return;
        const pct = Math.round(valve.currentPos * 100);
        const currentVal = parseFloat(slider.value);
        if (Math.abs(pct - currentVal) > 1) {
            slider.value = pct;
            display.textContent = pct + ' %';
        }
    }, 200);
}

/**
 * 一键自动连线：创建全部 pipe 连接
 */
export function applyAllPresets() {
    const sys = this.sys;
    const conns = [
        { from: 'engine-01_pipe_o', to: 'pump-01_pipe_i', type: 'pipe' },
        { from: 'pump-01_pipe_o', to: 'tee-01_pipe_l', type: 'pipe' },
        { from: 'tee-01_pipe_u', to: 'rotameter-01_pipe_terminal_in', type: 'pipe' },
        { from: 'rotameter-01_pipe_terminal_out', to: 'elecValve_pipe_u', type: 'pipe' },
        { from: 'tee-01_pipe_r', to: 'dp-flow-01_pipe_terminal_in', type: 'pipe' },
        { from: 'dp-flow-01_pipe_terminal_out', to: 'cooler-01_pipe_i', type: 'pipe' },
        { from: 'cooler-01_pipe_o', to: 'elecValve_pipe_l', type: 'pipe' },
        { from: 'elecValve_pipe_r', to: 'impeller-flow-01_pipe_terminal_in', type: 'pipe' },
        { from: 'impeller-flow-01_pipe_terminal_out', to: 'engine-01_pipe_i', type: 'pipe' },
    ];
    conns.forEach(c => sys.connMgr.addConn(c));
    sys.redrawAll();
}

/**
 * 启动系统：Engine 和 Pump 开启，阀位归零
 */
export async function applyStartSystem() {
    const sys = this.sys;
    const engine = sys.comps['engine-01'];
    const pump = sys.comps['pump-01'];
    if (engine) engine.engOn = true;
    if (pump) pump.pumpOn = true;

    const valve = sys.comps.elecValve;
    if (valve) {
        valve.manualPos = 0;
        valve.remotePos = 0;
        valve.update();
    }

    const slider = document.getElementById('valveSlider');
    const display = document.getElementById('valveDisplay');
    if (slider) slider.value = 0;
    if (display) display.textContent = '0 %';
}

/**
 * 五点步进：阀位循环 0% → 25% → 50% → 75% → 100% → 0%
 */
export function fiveStep() {
    const sys = this.sys;
    const steps = [0, 25, 50, 75, 100];
    const slider = document.getElementById('valveSlider');
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
    const display = document.getElementById('valveDisplay');
    if (display) display.textContent = nextVal.toFixed(0) + ' %';

    const valve = sys.comps.elecValve;
    if (valve) {
        if (valve.controlMode === 'MANUAL') {
            valve.manualPos = nextVal / 100;
        } else {
            valve.remotePos = nextVal / 100;
        }
        valve.update();
    }
}
