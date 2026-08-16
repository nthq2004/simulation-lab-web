// 三相绕组接线盒仿真工程
// 项目1：测量三相绕组电阻（Y/Δ 接法）
// 项目2：通电感应法检测同名端
// 项目3：交流感应法

import { ACPower } from '../components/ACPower.js';
import { DCPower } from '../components/DCPower.js';
import { MotorTerminalBox } from '../components/MotorTerminalBox.js';
import { Multimeter } from '../components/Multimeter.js';
import { MF47Multimeter } from '../components/MF47Multimeter.js';
import { Oscilloscope_tri } from '../components/Osc_tri.js';
import { SignalGenerator } from '../components/SignalGenerator.js';
import { ProcessCalibrator } from '../components/ProcessCalibrator.js';
import { ElecMeter } from '../components/ElecMeter.js';

export const FAULT_CONFIGS = {};

export const PROJECT_WORKFLOWS = {
    'winding-resistance': {
        id: 'winding-resistance',
        name: '项目1：测量三相绕组电阻,实现Y型和Δ型接法',
        steps: [
            {
                msg: '1. 将数字万用表切换到电阻档（RES200），依次测量 U 相（U1-U2）、V 相（V1-V2）、W 相（W1-W2）的绕组电阻值。',
                mode: 'check',
                act() {
                    const mm = this.sys.comps['multimeter'];
                    if (mm) {
                        mm.group.visible(true);
                        mm.mode = 'RES200';
                    }
                },
                check() {
                    const mm = this.sys.comps['multimeter'];
                    if (!mm || !mm.group || !mm.group.visible()) return false;
                    if (mm.mode !== 'RES200') return false;
                    const c = (a, b) => this.sys.isPortConnected(a, b);
                    return c('multimeter_wire_v', 'mtb01_wire_u1')
                        && c('multimeter_wire_com', 'mtb01_wire_u2');
                },
            },
            {
                msg: '2. 手动进行 Y 型连接：将 U2-V2-W2 三个尾端短接在一起（或点击"Y 接法"按钮演示）。',
                mode: 'check',
                act() {
                    const mtb = this.sys.comps['mtb01'];
                    if (mtb) mtb._onButtonClick('btnY');
                },
                check() {
                    const c = (a, b) => this.sys.isPortConnected(a, b);
                    return c('mtb01_wire_u2', 'mtb01_wire_v2')
                        && c('mtb01_wire_v2', 'mtb01_wire_w2');
                },
            },
            {
                msg: '3. 手动进行 Δ 型连接：将 U1-W2、V1-U2、W1-V2 首尾相接（或点击"Δ 接法"按钮演示）。',
                mode: 'check',
                act() {
                    const mtb = this.sys.comps['mtb01'];
                    if (mtb) mtb._onButtonClick('btnD');
                },
                check() {
                    const c = (a, b) => this.sys.isPortConnected(a, b);
                    return c('mtb01_wire_u1', 'mtb01_wire_w2')
                        && c('mtb01_wire_v1', 'mtb01_wire_u2')
                        && c('mtb01_wire_w1', 'mtb01_wire_v2');
                },
            },
            {
                msg: '4. 测试题：三相绕组星形接法',
                mode: 'quiz',
                quizConfig: {
                    question: '三相异步电动机绕组采用星形（Y）接法时，线电压与相电压的关系是：',
                    options: [
                        '线电压 = 相电压',
                        '线电压 = √3 × 相电压',
                        '相电压 = √3 × 线电压',
                        '线电压 = 2 × 相电压',
                    ],
                    answer: 1,
                    analysis: '星形接法时，线电压等于√3倍相电压（UL = √3 × UP），线电流等于相电流。',
                },
            },
        ],
    },
    'winding-dc-test': {
        id: 'winding-dc-test',
        name: '项目2：通电感应法检测同名端',
        steps: [
            {
                msg: '1. 将直流 12V 电源连接到 U 相绕组（正极→U1，负极→U2），并接通电源。',
                mode: 'check',
                act() {
                    _autoWire(this.sys, 'winding-dc-test');
                    const dc = this.sys.comps['dc'];
                    if (dc) dc.isOn = true;
                },
                check() {
                    const c = (a, b) => this.sys.isPortConnected(a, b);
                    return c('dc_wire_p', 'mtb01_wire_u1')
                        && c('dc_wire_n', 'mtb01_wire_u2');
                },
            },
            {
                msg: '2. 将指针式万用表切换到直流电压档（DCV10），红表笔接 V1、黑表笔接 V2，检测 V 相感应电压。',
                mode: 'check',
                act() {
                    const mf = this.sys.comps['mf47-panel'];
                    if (mf) {
                        mf.group.visible(true);
                        mf.rangeId = 'DCV10';
                    }
                },
                check() {
                    const mf = this.sys.comps['mf47-panel'];
                    if (!mf || !mf.group || !mf.group.visible()) return false;
                    if (mf._rangeId !== 'DCV10') return false;
                    const c = (a, b) => this.sys.isPortConnected(a, b);
                    return c('mf47-panel_wire_v', 'mtb01_wire_v1')
                        && c('mf47-panel_wire_COM', 'mtb01_wire_v2');
                },
            },
            {
                msg: '3. 观察：在直流电源接通瞬间，指针式万用表指针反向偏转；断开瞬间，指针正向偏转。请观察该现象。',
                mode: 'check',
                act() {
                    const dc = this.sys.comps['dc'];
                    if (dc) { dc.isOn = true; dc.update(); }
                },
                check() {
                    const dc = this.sys.comps['dc'];
                    return dc && dc.isOn === true;
                },
            },
            {
                msg: '4. 测试题：同名端判断',
                mode: 'quiz',
                quizConfig: {
                    question: '通电感应法中，当 U 相绕组接通直流电源（U1 接正、U2 接负）的瞬间，若指针式万用表（红表笔接 V1、黑表笔接 V2）指针反向偏转，则说明：',
                    options: [
                        'U1 与 V1 为同名端',
                        'U1 与 V2 为同名端',
                        'U2 与 V1 为同名端',
                        '无法判断同名端',
                    ],
                    answer: 0,
                    analysis: '接通瞬间 U 相电流增大（di/dt > 0），若 V 相感应电压使红表笔为负（指针反向偏转），因为U、V相位差120°，则 U1 与 V1 为同名端（极性相同）。',
                },
            },
        ],
    },
    'winding-ac-test': {
        id: 'winding-ac-test',
        name: '项目3：交流感应法测量同名端',
        steps: [
            {
                msg: '1. 系统自动将交流 12V 电源连接到 U 相绕组（U1-U2），并接通电源。',
                mode: 'check',
                act() {
                    _autoWire(this.sys, 'winding-ac-test');
                    const ac = this.sys.comps['ac'];
                    if (ac) ac.isOn = true;
                },
                check() {
                    const c = (a, b) => this.sys.isPortConnected(a, b);
                    return c('ac_wire_p', 'mtb01_wire_u1')
                        && c('ac_wire_n', 'mtb01_wire_u2');
                },
            },
            {
                msg: '2. 连接连接 V1 和 W1（V-W 两相绕组反向串联）。',
                mode: 'check',
                check() {
                    const c = (a, b) => this.sys.isPortConnected(a, b);
                    return c('mtb01_wire_v1', 'mtb01_wire_w1');
                },
            },
            {
                msg: '3. 将数字万用表切换到交流电压档（ACV200），红表笔接 V2、黑表笔接 W2，测量开口电压。',
                mode: 'check',
                act() {
                    const mm = this.sys.comps['multimeter'];
                    if (mm) {
                        mm.group.visible(true);
                        mm.mode = 'ACV200';
                    }
                },
                check() {
                    const mm = this.sys.comps['multimeter'];
                    if (!mm || !mm.group || !mm.group.visible()) return false;
                    if (mm.mode !== 'ACV200') return false;
                    const c = (a, b) => this.sys.isPortConnected(a, b);
                    return c('multimeter_wire_v', 'mtb01_wire_v2')
                        && c('multimeter_wire_com', 'mtb01_wire_w2');
                },
            },
            {
                msg: '4. 测试题：感应电压分析',
                mode: 'quiz',
                quizConfig: {
                    question: '在 U 相施加交流 12V 电压，V-W 两相绕组反向串联（V1-W1 连接），测量 V2-W2 之间的电压，其值约为：',
                    options: [
                        '0V（感应电压相互抵消）',
                        '12V（与 U 相同）',
                        '20.8V（√3 × 12V）',
                        '24V（2 × 12V）',
                    ],
                    answer: 0,
                    analysis: 'V-W 两相绕组反向串联时，感应电压相位相反、相互抵消，因此 V2-W2 之间的电压接近 0V。若改为同名端串联则互感增强，电压约为 1 倍相电压。',
                },
            },
        ],
    },
};

export const componentConfigs = [
    // ── 电源（左→右） ──
    { Class: ACPower, id: 'ac', x: 30, y: 200, voltageRMS: 12, frequency: 50, isOn: false, visible: true },
    { Class: DCPower, id: 'dc', x: 200, y: 200, voltage: 12, isOn: false, visible: true },

    // ── 三相绕组接线盒 ──
    { Class: MotorTerminalBox, id: 'mtb01', x: 420, y: 20, visible: true },

    // ── 6 种仪表（必须保留） ──
    { Class: Multimeter, id: 'multimeter', x: 1080, y: 440, visible: true },
    { Class: MF47Multimeter, id: 'mf47-panel', x: 1080, y: 40, visible: true },
    { Class: Oscilloscope_tri, id: 'osc', x: 50, y: 50, visible: false },
    { Class: SignalGenerator, id: 'sg', x: 50, y: 50, visible: false },
    { Class: ProcessCalibrator, id: 'cali', x: 50, y: 50, visible: false },
    { Class: ElecMeter, id: 'elecmeter', x: 50, y: 50, visible: false },
];

function _autoWire(sys, wfId) {
    sys.conns.length = 0;
    const cons = [];
    if (wfId === 'winding-resistance') {
        cons.push(
            { from: 'multimeter_wire_v', to: 'mtb01_wire_u1', type: 'wire' },
            { from: 'multimeter_wire_com', to: 'mtb01_wire_u2', type: 'wire' },
        );
    } else if (wfId === 'winding-dc-test') {
        cons.push(
            { from: 'dc_wire_p', to: 'mtb01_wire_u1', type: 'wire' },
            { from: 'dc_wire_n', to: 'mtb01_wire_u2', type: 'wire' },
        );
    } else if (wfId === 'winding-ac-test') {
        cons.push(
            { from: 'ac_wire_p', to: 'mtb01_wire_u1', type: 'wire' },
            { from: 'ac_wire_n', to: 'mtb01_wire_u2', type: 'wire' },
            { from: 'mtb01_wire_v1', to: 'mtb01_wire_w1', type: 'wire' },
        );
    }
    cons.forEach(c => sys.connMgr.addConn(c));
    sys.redrawAll();
}

export function initSlider(_sys) { }

export function applyAllPresets() {
    const sys = this && this.sys ? this.sys : window.sys;
    if (!sys) return;
    const wfId = sys.currentWorkflowId;
    if (wfId) _autoWire(sys, wfId);
}

export async function applyStartSystem() {
    const sys = this && this.sys ? this.sys : window.sys;
    if (!sys) return;
    const wfId = sys.currentWorkflowId;
    if (wfId) _autoWire(sys, wfId);
}

export function fiveStep() { }
