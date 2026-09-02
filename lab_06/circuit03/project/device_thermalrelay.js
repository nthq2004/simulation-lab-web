// 热继电器过载保护仿真工程

import { ACPower3P } from '../components/ACPower3P.js';
import { ThermalOverloadRelay } from '../components/ThermalOverloadRelay.js';
import { Resistor } from '../components/Resistor.js';
import { Multimeter } from '../components/Multimeter.js';
import { MF47Multimeter } from '../components/MF47Multimeter.js';
import { Oscilloscope_tri } from '../components/Osc_tri.js';
import { SignalGenerator } from '../components/SignalGenerator.js';
import { ProcessCalibrator } from '../components/ProcessCalibrator.js';
import { ElecMeter } from '../components/ElecMeter.js';

export const FAULT_CONFIGS = {};

export const PROJECT_WORKFLOWS = {
    'overload-test': {
        id: 'overload-test',
        name: '1. 热继电器过载保护操作',
        steps: [
            {
                msg: '第 1 步：将三相电源 U/V/W 依次接入热继电器进线端 L1/L2/L3，热继电器出线端 T1/T2/T3 分别接三个负载电阻（星形连接）。闭合三相电源，电路电流小于热继电器整定值，电路正常工作。',
                mode: 'check',
                async act() {
                    await new Promise(r => setTimeout(r, 500));
                    _autoWire(this.sys, 'overload-test');
                    await new Promise(r => setTimeout(r, 2000));
                },
                check() {
                    const c = (a, b) => this.sys.isPortConnected(a, b);
                    const fr = this.sys.comps['fr'];
                    const ac = this.sys.comps['ac'];
                    return ac && ac.isOn
                        && fr && fr.getState() === 'normal'
                        && c('ac_wire_u', 'fr_wire_l1')
                        && c('ac_wire_v', 'fr_wire_l2')
                        && c('ac_wire_w', 'fr_wire_l3')
                        && c('fr_wire_t1', 'r1_wire_l')
                        && c('fr_wire_t2', 'r2_wire_l')
                        && c('fr_wire_t3', 'r3_wire_l');
                },
            },
            {
                msg: '第 2 步：调节三相电源输出电压到 135V（过载系数约 1.35 倍），热继电器延时后动作（TRIP 指示灯亮，NC 触点断开）。',
                mode: 'check',
                async act() {
                    await new Promise(r => setTimeout(r, 500));
                    const ac = this.sys.comps['ac'];
                    if (ac) ac.onConfigUpdate({ vRms: 135 });
                    await new Promise(r => setTimeout(r, 8000));
                },
                check() {
                    const fr = this.sys.comps['fr'];
                    return fr && fr.getState() === 'tripped';
                },
            },
            {
                msg: '第 3 步：断开三相电源，按下热继电器 RESET 按钮复位。',
                mode: 'check',
                async act() {
                    await new Promise(r => setTimeout(r, 500));
                    const ac = this.sys.comps['ac'];
                    if (ac) ac.onConfigUpdate({ isOn: false });
                    await new Promise(r => setTimeout(r, 2500));
                    const fr = this.sys.comps['fr'];
                    if (fr) fr.reset();
                    await new Promise(r => setTimeout(r, 1000));
                },
                check() {
                    const ac = this.sys.comps['ac'];
                    const fr = this.sys.comps['fr'];
                    return ac && !ac.isOn && fr && fr.getState() === 'normal';
                },
            },
            {
                msg: '第 4 步：热继电器知识',
                mode: 'quiz',
                quizConfig: {
                    question: '热继电器主要用于保护电动机免受什么故障的损害？',
                    options: [
                        '长期过载（过电流）',
                        '短路故障',
                        '欠压故障',
                        '缺相故障',
                    ],
                    answer: 0,
                    analysis: '热继电器利用双金属片受热弯曲的原理，在电动机长期过载时断开控制电路，实现过载保护。热继电器具有反时限特性——过载倍数越大，动作时间越短。热继电器不能用于短路保护（短路电流由熔断器或断路器承担），也不能准确反映缺相和欠压故障。',
                },
            },
            {
                msg: '第 5 步：调节三相电源输出电压到 100V，将热继电器整定值调为 8A（过载约 1.25 倍），热继电器延时后动作。',
                mode: 'check',
                async act() {
                    await new Promise(r => setTimeout(r, 500));
                    const fr = this.sys.comps['fr'];
                    const ac = this.sys.comps['ac'];
                    if (fr) fr.onConfigUpdate({ ratedCurrent: 8 });
                    if (ac) ac.onConfigUpdate({ vRms: 100, isOn: true });
                    await new Promise(r => setTimeout(r, 15000));
                },
                check() {
                    const fr = this.sys.comps['fr'];
                    return fr && fr.getState() === 'tripped';
                },
            },
        ],
    },
    'multimeter-test': {
        id: 'multimeter-test',
        name: '2. 用万用表测试热继电器',
        steps: [
            {
                msg: '第 1 步：将万用表切换到 200Ω 档，红表笔接热继电器 L1 端子，黑表笔接 T1 端子，测量 A 相发热元件电阻（约 0.01Ω）。',
                mode: 'check',
                async act() {
                    await new Promise(r => setTimeout(r, 500));
                    const sys = this.sys;
                    const mm = sys.comps['multimeter'];
                    if (mm) mm.show();
                    if (mm) { mm.mode = 'RES200'; mm._updateAngleByMode(); }
                    sys.conns.length = 0;
                    sys.connMgr.addConn({ from: 'multimeter_wire_v', to: 'fr_wire_l1', type: 'wire' });
                    sys.connMgr.addConn({ from: 'multimeter_wire_com', to: 'fr_wire_t1', type: 'wire' });
                    sys.redrawAll();
                    await new Promise(r => setTimeout(r, 2000));
                },
                check() {
                    const mm = this.sys.comps['multimeter'];
                    const c = (a, b) => this.sys.isPortConnected(a, b);
                    return mm && mm.mode === 'RES200'
                        && c('multimeter_wire_v', 'fr_wire_l1')
                        && c('multimeter_wire_com', 'fr_wire_t1')
                        && mm.value < 1;
                },
            },
            {
                msg: '第 2 步：保持万用表 200Ω 档，红表笔改接热继电器 NC 端子 95，黑表笔改接 NC 端子 96，测量常闭触头电阻（应接近 0Ω）。',
                mode: 'check',
                async act() {
                    await new Promise(r => setTimeout(r, 500));
                    const sys = this.sys;
                    sys.conns.length = 0;
                    sys.connMgr.addConn({ from: 'multimeter_wire_v', to: 'fr_wire_nc_a', type: 'wire' });
                    sys.connMgr.addConn({ from: 'multimeter_wire_com', to: 'fr_wire_nc_b', type: 'wire' });
                    sys.redrawAll();
                    await new Promise(r => setTimeout(r, 2000));
                },
                check() {
                    const mm = this.sys.comps['multimeter'];
                    const c = (a, b) => this.sys.isPortConnected(a, b);
                    return mm && mm.mode === 'RES200'
                        && c('multimeter_wire_v', 'fr_wire_nc_a')
                        && c('multimeter_wire_com', 'fr_wire_nc_b')
                        && mm.value < 1;
                },
            },
            {
                msg: '第 3 步：接通三相电源主线路（ac → fr → 负载电阻），调节电压到 135V（过载系数约 1.35 倍），热继电器延时动作后常闭触头断开（万用表显示 O.L）。',
                mode: 'check',
                async act() {
                    await new Promise(r => setTimeout(r, 500));
                    const sys = this.sys;
                    const ac = sys.comps['ac'];
                    sys.conns.length = 0;
                    // 保持万用表在 NC 触点
                    sys.connMgr.addConn({ from: 'multimeter_wire_v', to: 'fr_wire_nc_a', type: 'wire' });
                    sys.connMgr.addConn({ from: 'multimeter_wire_com', to: 'fr_wire_nc_b', type: 'wire' });
                    // 主线路
                    sys.connMgr.addConn({ from: 'ac_wire_u', to: 'fr_wire_l1', type: 'wire' });
                    sys.connMgr.addConn({ from: 'ac_wire_v', to: 'fr_wire_l2', type: 'wire' });
                    sys.connMgr.addConn({ from: 'ac_wire_w', to: 'fr_wire_l3', type: 'wire' });
                    sys.connMgr.addConn({ from: 'fr_wire_t1', to: 'r1_wire_l', type: 'wire' });
                    sys.connMgr.addConn({ from: 'fr_wire_t2', to: 'r2_wire_l', type: 'wire' });
                    sys.connMgr.addConn({ from: 'fr_wire_t3', to: 'r3_wire_l', type: 'wire' });
                    sys.connMgr.addConn({ from: 'r1_wire_r', to: 'r2_wire_r', type: 'wire' });
                    sys.connMgr.addConn({ from: 'r2_wire_r', to: 'r3_wire_r', type: 'wire' });
                    if (ac) ac.onConfigUpdate({ vRms: 135, isOn: true });
                    sys.redrawAll();
                    await new Promise(r => setTimeout(r, 10000));
                },
                check() {
                    const fr = this.sys.comps['fr'];
                    const mm = this.sys.comps['multimeter'];
                    const c = (a, b) => this.sys.isPortConnected(a, b);
                    return fr && fr.getState() === 'tripped'
                        && mm && mm.mode === 'RES200'
                        && c('multimeter_wire_v', 'fr_wire_nc_a')
                        && c('multimeter_wire_com', 'fr_wire_nc_b')
                        && mm.value > 200;
                },
            },
        ],
    },
};

export const componentConfigs = [
    { Class: ACPower3P, id: 'ac', x: 100, y: 60, vRms: 50, freq: 50, isOn: true, phaseSeq: 'pos', visible: true },
    { Class: ThermalOverloadRelay, id: 'fr', x: 100, y: 300, ratedCurrent: 10, initState: 'normal', phaseResistance: 0.01, visible: true,scale:1},
    { Class: Resistor, id: 'r1', x: 160, y: 810, value: 10, visible: true, rotation: 90 },
    { Class: Resistor, id: 'r2', x: 260, y: 810, value: 10, visible: true, rotation: 90 },
    { Class: Resistor, id: 'r3', x: 360, y: 810, value: 10, visible: true, rotation: 90 },

    { Class: Multimeter, id: 'multimeter', x: 920, y: 100, visible: false },
    { Class: MF47Multimeter, id: 'mf47-panel', x: 1050, y: 150, visible: false },
    { Class: Oscilloscope_tri, id: 'osc', x: 50, y: 50, visible: false },
    { Class: SignalGenerator, id: 'sg', x: 50, y: 50, visible: false },
    { Class: ProcessCalibrator, id: 'cali', x: 50, y: 50, visible: false },
    { Class: ElecMeter, id: 'elecmeter', x: 50, y: 50, visible: false },
];

function _autoWire(sys, mode) {
    sys.conns.length = 0;
    const cons = [
        { from: 'ac_wire_u', to: 'fr_wire_l1', type: 'wire' },
        { from: 'ac_wire_v', to: 'fr_wire_l2', type: 'wire' },
        { from: 'ac_wire_w', to: 'fr_wire_l3', type: 'wire' },
        { from: 'fr_wire_t1', to: 'r1_wire_l', type: 'wire' },
        { from: 'fr_wire_t2', to: 'r2_wire_l', type: 'wire' },
        { from: 'fr_wire_t3', to: 'r3_wire_l', type: 'wire' },
        { from: 'r1_wire_r', to: 'r2_wire_r', type: 'wire' },
        { from: 'r2_wire_r', to: 'r3_wire_r', type: 'wire' },
    ];
    cons.forEach(c => sys.connMgr.addConn(c));
    sys.redrawAll();
}

export function initSlider(sys) {
}

export function applyAllPresets() {
    const sys = this && this.sys ? this.sys : window.sys;
    if (!sys) return;
    _autoWire(sys, 'overload-test');
}

export async function applyStartSystem() {
    const sys = this && this.sys ? this.sys : window.sys;
    if (!sys) return;
    _autoWire(sys, 'overload-test');
    const ac = sys.comps['ac'];
    if (ac) ac.onConfigUpdate({ vRms: 50, freq: 50, isOn: true, phaseSeq: 'pos' });    
}

export function fiveStep() {}
