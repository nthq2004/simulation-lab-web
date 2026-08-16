// 振动测量原理演示项目
// 振动测试台 → 三种不同原理的振动仪表（机械式、Reed式、电子式）

import { Oscilloscope_tri } from '../components/Osc_tri.js';
import { SignalGenerator } from '../components/SignalGenerator.js';
import { Multimeter } from '../components/Multimeter.js';
import { AmpMeter } from '../components/AmpMeter.js';
import { ProcessCalibrator } from '../components/ProcessCalibrator.js';

import { VibrationTestBench } from '../components/VibrationTestBench.js';
import { MechanicalVibrometer } from '../components/MechanicalVibrometer.js';
import { ReedVibrometer } from '../components/ReedVibrometer.js';
import { ElectronicVibrometer } from '../components/ElectronicVibrometer.js';

export const FAULT_CONFIGS = {};

export const PROJECT_WORKFLOWS = {};

export const componentConfigs = [
    // 工具组件（初始隐藏）
    { Class: Oscilloscope_tri, id: 'osc3', x: 800, y: 160, visible: false },
    { Class: SignalGenerator, id: 'sg', x: 210, y: 200, visible: false },
    { Class: Multimeter, id: 'multimeter', x: 1350, y: 500, visible: false },
    { Class: AmpMeter, id: 'ampmeter', x: 450, y: 100, visible: false },
    { Class: ProcessCalibrator, id: 'cali', x: 600, y: 100, visible: false },

    // ── 振动测试台（左侧）──
    { Class: VibrationTestBench, id: 'vib-bench', x: 20, y: 20,
      label: 'VTB-01', frequency: 0, amplitude: 0 },

    // ── 机械振动表（右列上）──
    { Class: MechanicalVibrometer, id: 'mech-vm', x: 930, y: 20,
      label: 'VM-101', rangeMax: 0.2 },

    // ── Reed 振动计（右列中）──
    { Class: ReedVibrometer, id: 'reed-vm', x: 930, y: 320,
      label: 'RV-201', freqMin: 10, freqMax: 55, freqStep: 2.5,
      vibFrequency: 0, vibAmplitude: 0 },

    // ── 电子振动仪（右列下）──
    { Class: ElectronicVibrometer, id: 'elec-vm', x: 930, y: 710,
      label: 'EV-301', vibAmplitude: 0, vibFrequency: 0 },
];

/**
 * 将测试台的频率 / 幅值同步到三种振动仪表
 * 处理各单位差异：
 *   机械表幅值用 mm（μm ÷ 1000）
 *   Reed 表幅值用 0~1 归一化
 *   电子表幅值用 μm
 */
function _applyVibration(sys, freqHz, ampUM) {
    const mech = sys.comps['mech-vm'];
    const reed = sys.comps['reed-vm'];
    const elec = sys.comps['elec-vm'];

    if (mech && mech.setVibration) mech.setVibration(ampUM / 1000, freqHz);
    if (reed && reed.setVibration) {
        // Reed 幅值 0~1 归一化：250μm 对应满幅 0.8，线性插值
        const reedAmp = Math.min(0.8, ampUM / 62.5);
        reed.setVibration(freqHz, reedAmp);
    }
    if (elec && elec.setVibration) elec.setVibration(ampUM, freqHz);
    sys.requestRedraw();
}

export function initSlider(sys) {
    const toolbar = document.getElementById('toolbar');
    const container = document.createElement('div');
    container.id = 'vibSliderContainer';
    container.style.cssText = 'display:inline-flex;align-items:center;gap:8px;margin-left:12px;';
    container.innerHTML = `
        <span style="font-size:13px;font-weight:bold;color:#1a3040;">频率:</span>
        <input type="range" id="freqSlider" min="0" max="200" value="0" step="1" style="width:120px;">
        <span id="freqDisplay" style="font-size:13px;font-weight:bold;min-width:55px;color:#004080;">0 Hz</span>
        <span style="font-size:13px;font-weight:bold;color:#1a3040;margin-left:8px;">幅值:</span>
        <input type="range" id="ampSlider" min="0" max="200" value="0" step="0.5" style="width:120px;">
        <span id="ampDisplay" style="font-size:13px;font-weight:bold;min-width:55px;color:#004080;">0 μm</span>
    `;
    toolbar.appendChild(container);

    const bench = sys.comps['vib-bench'];
    const freqSlider = document.getElementById('freqSlider');
    const freqDisplay = document.getElementById('freqDisplay');
    const ampSlider = document.getElementById('ampSlider');
    const ampDisplay = document.getElementById('ampDisplay');

    const syncNow = () => {
        _applyVibration(sys, parseFloat(freqSlider.value), parseFloat(ampSlider.value));
    };

    freqSlider.addEventListener('input', () => {
        const v = parseFloat(freqSlider.value);
        freqDisplay.textContent = v.toFixed(0) + ' Hz';
        if (bench) bench.frequency = v;
        syncNow();
    });

    ampSlider.addEventListener('input', () => {
        const v = parseFloat(ampSlider.value);
        ampDisplay.textContent = v.toFixed(1) + ' μm';
        if (bench) bench.amplitude = v;
        syncNow();
    });

    // 拦截 bench._handleCtrl 以在启动/停止时立即同步仪表
    const origHandleCtrl = bench._handleCtrl.bind(bench);
    bench._handleCtrl = (key) => {
        origHandleCtrl(key);
        if (key === 'start') {
            const f = bench.frequency, a = bench.amplitude;
            freqSlider.value = f; freqSlider.disabled = false;
            freqDisplay.textContent = f.toFixed(0) + ' Hz';
            ampSlider.value = a; ampSlider.disabled = false;
            ampDisplay.textContent = a.toFixed(1) + ' μm';
            _applyVibration(sys, f, a);
        } else if (key === 'stop') {
            freqSlider.value = 0; freqSlider.disabled = true;
            freqDisplay.textContent = '0 Hz';
            ampSlider.value = 0; ampSlider.disabled = true;
            ampDisplay.textContent = '0.0 μm';
            _applyVibration(sys, 0, 0);
        }
    };
    // 初始状态：停止时滑块禁用
    freqSlider.disabled = true;
    ampSlider.disabled = true;

    let _lastRunning = false;

    // 反向同步：测试台运行中的实时参数 → 滑块 + 仪表
    setInterval(() => {
        if (!bench) return;
        const nowRunning = bench._running;

        if (nowRunning) {
            // 确保滑块启用
            if (freqSlider.disabled) freqSlider.disabled = false;
            if (ampSlider.disabled) ampSlider.disabled = false;

            const bFreq = bench._curFreq || bench.frequency;
            const bAmp = bench.amplitude;
            let changed = false;
            if (Math.abs(parseFloat(freqSlider.value) - bFreq) > 0.5) {
                freqSlider.value = bFreq;
                freqDisplay.textContent = bFreq.toFixed(0) + ' Hz';
                changed = true;
            }
            if (Math.abs(parseFloat(ampSlider.value) - bAmp) > 0.1) {
                ampSlider.value = bAmp;
                ampDisplay.textContent = bAmp.toFixed(1) + ' μm';
                changed = true;
            }
            if (changed || !_lastRunning) _applyVibration(sys, bFreq, bAmp);
        } else {
            // 停止时滑块归零并禁用
            if (parseFloat(freqSlider.value) !== 0 || parseFloat(ampSlider.value) !== 0) {
                freqSlider.value = 0;
                ampSlider.value = 0;
                freqDisplay.textContent = '0 Hz';
                ampDisplay.textContent = '0.0 μm';
                _applyVibration(sys, 0, 0);
            }
            freqSlider.disabled = true;
            ampSlider.disabled = true;
        }
        _lastRunning = nowRunning;
    }, 100);

    syncNow();
}

export function applyAllPresets() {}

export async function applyStartSystem() {
    const sys = this.sys;
    const bench = sys.comps['vib-bench'];
    if (bench) {
        bench.vibMode = 'sine';
        bench.frequency = 25;
        bench.amplitude = 10;
        bench.start();
    }

    const freqSlider = document.getElementById('freqSlider');
    const freqDisplay = document.getElementById('freqDisplay');
    const ampSlider  = document.getElementById('ampSlider');
    const ampDisplay  = document.getElementById('ampDisplay');

    if (freqSlider) { freqSlider.value = 25; freqSlider.disabled = false; }
    if (freqDisplay) freqDisplay.textContent = '25 Hz';
    if (ampSlider)  { ampSlider.value = 10;  ampSlider.disabled = false; }
    if (ampDisplay)  ampDisplay.textContent = '10 μm';

    _applyVibration(sys, 25, 10);
}

export function fiveStep() {
    const sys = this.sys;
    const steps = [5, 25, 50, 100, 200];
    const slider = document.getElementById('freqSlider');
    const current = slider ? parseFloat(slider.value) : 0;

    let nextVal = steps[0];
    for (const s of steps) {
        if (Math.abs(s - current) < 1) {
            const idx = steps.indexOf(s);
            nextVal = steps[(idx + 1) % steps.length];
            break;
        }
    }

    const bench = sys.comps['vib-bench'];
    if (slider) slider.value = nextVal;
    const fDisp = document.getElementById('freqDisplay');
    if (fDisp) fDisp.textContent = nextVal.toFixed(0) + ' Hz';
    if (bench) bench.frequency = nextVal;

    const ampSlider = document.getElementById('ampSlider');
    let ampVal = ampSlider ? parseFloat(ampSlider.value) : 0;
    if (ampVal < 0.5) {
        ampVal = 10;
        if (ampSlider) ampSlider.value = 10;
        const aDisp = document.getElementById('ampDisplay');
        if (aDisp) aDisp.textContent = '10 μm';
        if (bench) bench.amplitude = 10;
    }
    _applyVibration(sys, nextVal, ampVal);
}
