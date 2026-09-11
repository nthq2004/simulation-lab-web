// 转速测量原理演示项目
// 可调速柴油机 → 三种不同原理的转速表（离心式、磁电式、涡流式）

import { Oscilloscope_tri } from '../components/Osc_tri.js';
import { SignalGenerator } from '../components/SignalGenerator.js';
import { Multimeter } from '../components/Multimeter.js';
import { AmpMeter } from '../components/AmpMeter.js';
import { ProcessCalibrator } from '../components/ProcessCalibrator.js';

import { EngineSpeed } from '../components/enginespeed.js';
import { CentrifugalTachometer } from '../components/CentrifugalTachometer.js';
import { MagnetoelectricTachometer } from '../components/MagnetoelectricTachometer.js';
import { EddyCurrentTachometer } from '../components/EddyCurrentTachometer.js';

export const FAULT_CONFIGS = {};

export const PROJECT_WORKFLOWS = {};

export const componentConfigs = [
    // 工具组件（初始隐藏）
    { Class: Oscilloscope_tri, id: 'osc3', x: 800, y: 160, visible: false },
    { Class: SignalGenerator, id: 'sg', x: 210, y: 200, visible: false },
    { Class: Multimeter, id: 'multimeter', x: 1350, y: 500, visible: false },
    { Class: AmpMeter, id: 'ampmeter', x: 450, y: 100, visible: false },
    { Class: ProcessCalibrator, id: 'cali', x: 600, y: 100, visible: false },

    // ── 可调速柴油机（左上）──
    { Class: EngineSpeed, id: 'engine-speed', x: 160, y: 500 },

    // ── 离心式转速表 ──
    { Class: CentrifugalTachometer, id: 'centrifugal-tm', x: 320, y: 20,
      label: 'ST-101', ratedSpeed: 800, maxSpeed: 1200 },

    // ── 磁电式转速表 ──
    { Class: MagnetoelectricTachometer, id: 'magnetoelectric-tm', x: 620, y: 20,
      label: 'ST-102', ratedSpeed: 800, maxSpeed: 1200 },

    // ── 涡流式转速表 ──
    { Class: EddyCurrentTachometer, id: 'eddy-current-tm', x: 940, y: 20,
      label: 'ST-103', ratedSpeed: 800, maxSpeed: 1200 },
];

/** 统一设置转速：仅柴油机起动后调速才有效 */
function _applySpeed(sys, speed) {
    const engine = sys.comps['engine-speed'];
    const tachIds = ['centrifugal-tm', 'magnetoelectric-tm', 'eddy-current-tm'];

    // 柴油机未起动时所有转速表归零，拒绝调速
    if (!engine || !engine.engOn) {
        if (engine && engine.setSpeed) engine.setSpeed(0);
        tachIds.forEach(id => {
            const comp = sys.comps[id];
            if (comp && comp.setSpeed) comp.setSpeed(0);
        });
        sys.requestRedraw();
        return;
    }

    if (engine.setSpeed) engine.setSpeed(speed);

    // 动态检测与柴油机管路连通的转速表
    const connectedIds = new Set();
    const enginePort = 'engine-speed_pipe_o';
    (sys.conns || []).forEach(conn => {
        if (conn.type !== 'pipe') return;
        let otherPort = null;
        if (conn.from === enginePort) otherPort = conn.to;
        else if (conn.to === enginePort) otherPort = conn.from;
        if (!otherPort) return;
        // 从对方端口 ID 提取组件 ID（格式：compId_type_name）
        const compId = otherPort.split('_pipe_')[0] || otherPort.split('_')[0];
        if (tachIds.includes(compId)) connectedIds.add(compId);
    });

    tachIds.forEach(id => {
        const comp = sys.comps[id];
        if (comp && comp.setSpeed) {
            comp.setSpeed(connectedIds.has(id) ? speed : 0);
        }
    });
    sys.requestRedraw();
}

/**
 * 初始化转速滑块
 * 滑块 → 柴油机转速设定 + 三只转速表同步
 */
export function initSlider(sys) {
    const toolbar = document.getElementById('toolbar');
    const sliderDiv = document.createElement('div');
    sliderDiv.id = 'speedSliderContainer';
    sliderDiv.style.cssText = 'display:inline-flex;align-items:center;gap:6px;margin-left:12px;';
    sliderDiv.innerHTML = `
        <span style="font-size:12px;font-weight:bold;">转速:</span>
        <input type="range" id="speedSlider" min="0" max="1000" value="0" style="width:160px;">
        <span id="speedDisplay" style="font-size:12px;min-width:60px;">0 rpm</span>
    `;
    toolbar.appendChild(sliderDiv);

    const slider = document.getElementById('speedSlider');
    const display = document.getElementById('speedDisplay');
    // 正向：滑块拖动 → 柴油机 + 转速表
    slider.addEventListener('input', () => {
        const speed = parseFloat(slider.value);
        display.textContent = speed.toFixed(0) + ' rpm';
        _applySpeed(sys, speed);
    });

    // 反向：柴油机调速旋钮 → 滑块 + 转速表（轮询同步）
    setInterval(() => {
        const engine = sys.comps['engine-speed'];
        if (!engine || !slider || !display) return;
        const engineTarget = engine._targetSpeed;
        const currentVal = parseFloat(slider.value);
        if (Math.abs(engineTarget - currentVal) > 1) {
            slider.value = engineTarget;
            display.textContent = engineTarget.toFixed(0) + ' rpm';
            _applySpeed(sys, engineTarget);
        }
    }, 200);

    // 管路连接/断开后立即刷新转速表
    if (sys.eventBus) {
        sys.eventBus.on('connection:pipeChanged', () => {
            const speed = parseFloat(slider.value);
            _applySpeed(sys, speed);
        });
    }
}

/**
 * 一键自动连线：柴油机出口 → 离心式转速表（管路连接）
 */
export function applyAllPresets() {
    const sys = this.sys;
    const conns = [
        { from: 'engine-speed_pipe_o', to: 'centrifugal-tm_pipe_shaft', type: 'pipe' },
    ];
    conns.forEach(c => sys.connMgr.addConn(c));
    sys.redrawAll();
}

/**
 * 启动系统：柴油机开启，初始转速 500 rpm
 */
export async function applyStartSystem() {
    const sys = this.sys;
    const engine = sys.comps['engine-speed'];
    if (engine) {
        engine.engOn = true;
        engine.setSpeed(500);
    }

    _applySpeed(sys, 500);

    const slider = document.getElementById('speedSlider');
    const display = document.getElementById('speedDisplay');
    if (slider) slider.value = 500;
    if (display) display.textContent = '500 rpm';
}

/**
 * 五点步进：转速循环 0 → 250 → 500 → 750 → 1000 → 0
 */
export function fiveStep() {
    const sys = this.sys;
    const steps = [0, 250, 500, 750, 1000];
    const slider = document.getElementById('speedSlider');
    const current = slider ? parseFloat(slider.value) : 200;

    let nextVal = steps[0];
    for (const s of steps) {
        if (Math.abs(s - current) < 1) {
            const idx = steps.indexOf(s);
            nextVal = steps[(idx + 1) % steps.length];
            break;
        }
    }

    if (slider) slider.value = nextVal;
    const display = document.getElementById('speedDisplay');
    if (display) display.textContent = nextVal.toFixed(0) + ' rpm';

    _applySpeed(sys, nextVal);
}
