// 剩磁感应法判断同名端实验

import { InductionMotor } from '../components/InductionMotor.js';
import { ACPower3P } from '../components/ACPower3P.js';
import { Multimeter } from '../components/Multimeter.js';
import { MF47Multimeter } from '../components/MF47Multimeter.js';
import { Oscilloscope_tri } from '../components/Osc_tri.js';
import { SignalGenerator } from '../components/SignalGenerator.js';
import { ProcessCalibrator } from '../components/ProcessCalibrator.js';
import { ElecMeter } from '../components/ElecMeter.js';

export const FAULT_CONFIGS = {};

export const PROJECT_WORKFLOWS = {
    'remanence-flux-test': {
        id: 'remanence-flux-test',
        name: '1. 用剩磁感应法判断同名端',
        steps: [
            {
                msg: '第 1 步：将电动机 U1-V1-W1 短接（节点 A），U2-V2-W2 短接（节点 B）。',
                mode: 'check',
                async act() {
                    await new Promise(r => setTimeout(r, 3000));
                    _autoWire(this.sys, 'remanence-flux-test');
                    await new Promise(r => setTimeout(r, 3000));
                },
                check() {
                    const c = (a, b) => this.sys.isPortConnected(a, b);
                    return c('im01_wire_u1', 'im01_wire_v1')
                        && c('im01_wire_v1', 'im01_wire_w1')
                        && c('im01_wire_u2', 'im01_wire_v2')
                        && c('im01_wire_v2', 'im01_wire_w2');
                },
            },
            {
                msg: '第 2 步：调出指针式万用表，旋至 DC 50mA 档，红表笔插入 mA 孔、黑表笔插入 COM 孔，然后将万用表串接到 U1（节点 A）与 W2（节点 B）之间。',
                mode: 'check',
                async act() {
                    await new Promise(r => setTimeout(r, 3000));
                    const mf47 = this.sys.comps['mf47-panel'];
                    if (mf47) mf47.group.visible(true);
                    const connMgr = this.sys.connMgr;
                    connMgr.addConn({ from: 'mf47-panel_wire_mA', to: 'im01_wire_w1', type: 'wire' });
                    connMgr.addConn({ from: 'mf47-panel_wire_COM', to: 'im01_wire_w2', type: 'wire' });
                    await new Promise(r => setTimeout(r, 3000));
                },
                check() {
                    const mf47 = this.sys.comps['mf47-panel'];
                    if (!mf47 || !mf47.group.isVisible()) return false;
                    if (mf47._rangeId !== 'MA50') return false;
                    const c = (a, b) => this.sys.isPortConnected(a, b);
                    return c('mf47-panel_wire_mA', 'im01_wire_w1')
                        && c('mf47-panel_wire_COM', 'im01_wire_w2');
                },
            },
            {
                msg: '第 3 步：点击电动机下方的「手拨转子」按钮（300 RPM），观察万用表指针是否偏转，并注意偏转方向。',
                mode: 'check',
                async act() {
                    await new Promise(r => setTimeout(r, 3000));
                    const motor = this.sys.comps['im01'];
                    if (motor) motor._onButtonClick('btnClr');
                    await new Promise(r => setTimeout(r, 3000));
                },
                check() {
                    const motor = this.sys.comps['im01'];
                    if (motor && motor._handTurnCount >= 1) {
                        motor._handTurnCount = 0;
                        return true;
                    }
                    return false;
                },
            },
            {
                msg: '第 4 步：调换 W 相绕组：将 W2 改接到节点 A（与 U1、V1 相连），W1 改接到节点 B（与 U2、V2 相连）。注意先拆除原有的 W 相连线。',
                mode: 'check',
                async act() {
                    await new Promise(r => setTimeout(r, 3000));
                    const connMgr = this.sys.connMgr;
                    connMgr.removeConn({ from: 'im01_wire_v1', to: 'im01_wire_w1', type: 'wire' });
                    connMgr.removeConn({ from: 'im01_wire_u2', to: 'im01_wire_w2', type: 'wire' });
                    connMgr.addConn({ from: 'im01_wire_u1', to: 'im01_wire_w2', type: 'wire' });
                    connMgr.addConn({ from: 'im01_wire_u2', to: 'im01_wire_w1', type: 'wire' });
                    await new Promise(r => setTimeout(r, 3000));
                },
                check() {
                    const c = (a, b) => this.sys.isPortConnected(a, b);
                    const newA = c('im01_wire_u1', 'im01_wire_v1')
                              && c('im01_wire_u1', 'im01_wire_w2');
                    const newB = c('im01_wire_u2', 'im01_wire_v2')
                              && c('im01_wire_u2', 'im01_wire_w1');
                    const oldBroken = !c('im01_wire_v1', 'im01_wire_w1')
                                   && !c('im01_wire_u2', 'im01_wire_w2');
                    return newA && newB && oldBroken;
                },
            },
            {
                msg: '第 5 步：再次点击「手拨转子」，观察万用表指针偏转方向是否与第 3 步相反。',
                mode: 'check',
                async act() {
                    await new Promise(r => setTimeout(r, 3000));
                    const motor = this.sys.comps['im01'];
                    if (motor) motor._onButtonClick('btnClr');
                    await new Promise(r => setTimeout(r, 3000));
                },
                check() {
                    const motor = this.sys.comps['im01'];
                    if (motor && motor._handTurnCount >= 1) {
                        motor._handTurnCount = 0;
                        return true;
                    }
                    return false;
                },
            },
            {
                msg: '第 6 步：剩磁感应法工作原理',
                mode: 'quiz',
                quizConfig: {
                    question: '在剩磁感应法实验中，三相对称短接（U1-V1-W1 为节点 A，U2-V2-W2 为节点 B）时手拨转子，万用表串接在 A、B 之间几乎无偏转，其原因是？',
                    options: [
                        '三相对称绕组感应的电动势矢量和为零，节点 A、B 间无电位差',
                        '转子剩磁太弱，不足以产生可测量的电动势',
                        '万用表 50mA 档灵敏度不够',
                        '手拨转速未达到额定值，感应电动势太小',
                    ],
                    answer: 0,
                    analysis: '正确。转子剩磁在三相对称绕组中感应出大小相等、相位互差 120° 的电动势，其矢量和为零，因此两节点间无电位差，万用表不偏转。调换 W 相后矢量和不再为零，万用表即有偏转，据此可判断同名端。',
                },
            },
        ],
    },
};

export const componentConfigs = [
    { Class: ACPower3P, id: 'ac', x: 30, y: 160, vRms: 220, freq: 50, isOn: false, visible: true },
    { Class: InductionMotor, id: 'im01', x: 420, y: 120, visible: true,
        R1: 0.50, Lsigma1: 0.00334, Rc: 300, Lm: 0.0796,
        R2: 0.46, Lsigma2: 0.00334,
        J: 0.12, B: 0.01, polePairs: 2,
        ratedPower: 10, ratedSpeed: 1440,
        simpleModel: true, remanenceFlux: 0.012 },

    { Class: MF47Multimeter, id: 'mf47-panel', x: 1250, y: 180, visible: true, rangeId: 'MA50' },
    { Class: Multimeter, id: 'multimeter', x: 1080, y: 440, visible: false },
    { Class: Oscilloscope_tri, id: 'osc', x: 50, y: 50, visible: false },
    { Class: SignalGenerator, id: 'sg', x: 50, y: 50, visible: false },
    { Class: ProcessCalibrator, id: 'cali', x: 50, y: 50, visible: false },
    { Class: ElecMeter, id: 'elecmeter', x: 50, y: 50, visible: false },
];

function _autoWire(sys, wfId) {
    sys.conns.length = 0;
    const cons = [];
    if (wfId === 'remanence-flux-test') {
        cons.push(
            // 节点 A：u1-v1-w1 短接
            { from: 'im01_wire_u1', to: 'im01_wire_v1', type: 'wire' },
            { from: 'im01_wire_v1', to: 'im01_wire_w1', type: 'wire' },
            // 节点 B：u2-v2-w2 短接
            { from: 'im01_wire_u2', to: 'im01_wire_v2', type: 'wire' },
            { from: 'im01_wire_u2', to: 'im01_wire_w2', type: 'wire' },
        );
    }
    cons.forEach(c => sys.connMgr.addConn(c));
    sys.redrawAll();
}

export function initSlider(sys) {
    const toolbar = document.getElementById('toolbar');
    const sliderDiv = document.createElement('div');
    sliderDiv.id = 'torqueSliderContainer';
    sliderDiv.style.cssText = 'display:inline-flex;align-items:center;gap:6px;margin-left:12px;';
    sliderDiv.innerHTML = `
        <span style="font-size:12px;font-weight:bold;">负载转矩:</span>
        <input type="range" id="torqueSlider" min="0" max="200" value="0" style="width:160px;">
        <span id="torqueDisplay" style="font-size:12px;min-width:60px;">0.0 N·m</span>
    `;
    toolbar.appendChild(sliderDiv);

    const slider = document.getElementById('torqueSlider');
    const display = document.getElementById('torqueDisplay');
    slider.addEventListener('input', () => {
        const val = parseFloat(slider.value);
        display.textContent = val.toFixed(1) + ' N·m';
        const motor = sys.comps['im01'];
        if (motor) motor.loadTorque = val;
        sys.requestRedraw();
    });
}

export function applyAllPresets() {
    const sys = this && this.sys ? this.sys : window.sys;
    if (!sys) return;
    _autoWire(sys, 'remanence-flux-test');
}

export async function applyStartSystem() {
    const sys = this && this.sys ? this.sys : window.sys;
    if (!sys) return;
    _autoWire(sys, 'remanence-flux-test');
}

export function fiveStep() { }
