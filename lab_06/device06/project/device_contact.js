// 三相交流接触器功能测试仿真工程

import { ACPower } from '../components/ACPower.js';
import { DCPower } from '../components/DCPower.js';
import { Switch } from '../components/Switch.js';
import { ThreePhaseContactor } from '../components/ThreePhaseContactor.js';
import { Multimeter } from '../components/Multimeter.js';
import { MF47Multimeter } from '../components/MF47Multimeter.js';
import { Oscilloscope_tri } from '../components/Osc_tri.js';
import { SignalGenerator } from '../components/SignalGenerator.js';
import { ProcessCalibrator } from '../components/ProcessCalibrator.js';
import { ElecMeter } from '../components/ElecMeter.js';

export const FAULT_CONFIGS = {
    stuck: {
        id: 'stuck', name: '卡死', system: '接触器',
        check()  { const c = window.sys && window.sys.comps && window.sys.comps.km1; return c && c._faultStuck; },
        trigger() { const c = window.sys && window.sys.comps && window.sys.comps.km1; if (c) c._faultStuck = true; },
        repair() { const c = window.sys && window.sys.comps && window.sys.comps.km1; if (c) c._faultStuck = false; },
    },
    coil_open: {
        id: 'coil_open', name: '线圈断线', system: '接触器',
        check()  { const c = window.sys && window.sys.comps && window.sys.comps.km1; return c && c._faultCoilOpen; },
        trigger() { const c = window.sys && window.sys.comps && window.sys.comps.km1; if (c) c._faultCoilOpen = true; },
        repair() { const c = window.sys && window.sys.comps && window.sys.comps.km1; if (c) c._faultCoilOpen = false; },
    },
    contact_l1t1: {
        id: 'contact_l1t1', name: '主触头 L1-T1 接触不良', system: '接触器',
        check()  { const c = window.sys && window.sys.comps && window.sys.comps.km1; return c && c._faultContactL1T1; },
        trigger() { const c = window.sys && window.sys.comps && window.sys.comps.km1; if (c) c._faultContactL1T1 = true; },
        repair() { const c = window.sys && window.sys.comps && window.sys.comps.km1; if (c) c._faultContactL1T1 = false; },
    },
    contact_no1: {
        id: 'contact_no1', name: '辅助常开 NO1 接触不良', system: '接触器',
        check()  { const c = window.sys && window.sys.comps && window.sys.comps.km1; return c && c._faultContactNO1; },
        trigger() { const c = window.sys && window.sys.comps && window.sys.comps.km1; if (c) c._faultContactNO1 = true; },
        repair() { const c = window.sys && window.sys.comps && window.sys.comps.km1; if (c) c._faultContactNO1 = false; },
    },
    shading_ring: {
        id: 'shading_ring', name: '短路环脱落', system: '接触器',
        check()  { const c = window.sys && window.sys.comps && window.sys.comps.km1; return c && c._faultShadingRing; },
        trigger() { const c = window.sys && window.sys.comps && window.sys.comps.km1; if (c) c._faultShadingRing = true; },
        repair() { const c = window.sys && window.sys.comps && window.sys.comps.km1; if (c) c._faultShadingRing = false; },
    },
};

export const PROJECT_WORKFLOWS = {
    'multimeter-test': {
        id: 'multimeter-test',
        name: '1. 万用表检测接触器线圈与触点',
        steps: [
            {
                msg: '第 1 步：将数字万用表切换到电阻档，红表笔（V 孔）接接触器线圈 A1 端，黑表笔（COM 孔）接 A2 端，测量线圈电阻。',
                mode: 'check',
                async act() {
                    await new Promise(r => setTimeout(r, 500));
                    const sys = this.sys;
                    sys.conns.length = 0;
                    const cons = [
                        { from: 'multimeter_wire_v', to: 'km1_wire_a1', type: 'wire' },
                        { from: 'multimeter_wire_com', to: 'km1_wire_a2', type: 'wire' },
                    ];
                    cons.forEach(c => sys.connMgr.addConn(c));
                    const mm = sys.comps['multimeter'];
                    if (mm) { mm.group.position({ x: 920, y: 100 }); mm.group.visible(true); }
                    sys.redrawAll();
                    await new Promise(r => setTimeout(r, 500));
                },
                check() {
                    const c = (a, b) => this.sys.isPortConnected(a, b);
                    return c('multimeter_wire_v', 'km1_wire_a1')
                        && c('multimeter_wire_com', 'km1_wire_a2');
                },
            },
            {
                msg: '第 2 步：将万用表红表笔接接触器主触点 L1 端，黑表笔接 T1 端。接触器未通电时，主触点为常开状态，应不导通（阻值无穷大）。',
                mode: 'check',
                async act() {
                    await new Promise(r => setTimeout(r, 500));
                    const sys = this.sys;
                    sys.conns.length = 0;
                    const cons = [
                        { from: 'multimeter_wire_v', to: 'km1_wire_l1', type: 'wire' },
                        { from: 'multimeter_wire_com', to: 'km1_wire_t1', type: 'wire' },
                    ];
                    cons.forEach(c => sys.connMgr.addConn(c));
                    sys.redrawAll();
                    await new Promise(r => setTimeout(r, 500));
                },
                check() {
                    const c = (a, b) => this.sys.isPortConnected(a, b);
                    const same = () => _sameCluster(this.sys, 'km1_wire_l1', 'km1_wire_t1');
                    return c('multimeter_wire_v', 'km1_wire_l1')
                        && c('multimeter_wire_com', 'km1_wire_t1')
                        && !same();
                },
            },
            {
                msg: '第 3 步：将万用表红表笔接常开辅助触点 13（NO1a），黑表笔接 14（NO1b）。接触器未通电时，常开触点应不导通。',
                mode: 'check',
                async act() {
                    await new Promise(r => setTimeout(r, 500));
                    const sys = this.sys;
                    sys.conns.length = 0;
                    const cons = [
                        { from: 'multimeter_wire_v', to: 'km1_wire_no1a', type: 'wire' },
                        { from: 'multimeter_wire_com', to: 'km1_wire_no1b', type: 'wire' },
                    ];
                    cons.forEach(c => sys.connMgr.addConn(c));
                    sys.redrawAll();
                    await new Promise(r => setTimeout(r, 500));
                },
                check() {
                    const c = (a, b) => this.sys.isPortConnected(a, b);
                    const same = () => _sameCluster(this.sys, 'km1_wire_no1a', 'km1_wire_no1b');
                    return c('multimeter_wire_v', 'km1_wire_no1a')
                        && c('multimeter_wire_com', 'km1_wire_no1b')
                        && !same();
                },
            },
            {
                msg: '第 4 步：将万用表红表笔接常闭辅助触点 31（NC1a），黑表笔接 32（NC1b）。接触器未通电时，常闭触点应导通。',
                mode: 'check',
                async act() {
                    await new Promise(r => setTimeout(r, 500));
                    const sys = this.sys;
                    sys.conns.length = 0;
                    const cons = [
                        { from: 'multimeter_wire_v', to: 'km1_wire_nc1a', type: 'wire' },
                        { from: 'multimeter_wire_com', to: 'km1_wire_nc1b', type: 'wire' },
                    ];
                    cons.forEach(c => sys.connMgr.addConn(c));
                    sys.redrawAll();
                    await new Promise(r => setTimeout(r, 500));
                },
                check() {
                    const c = (a, b) => this.sys.isPortConnected(a, b);
                    const same = () => _sameCluster(this.sys, 'km1_wire_nc1a', 'km1_wire_nc1b');
                    return c('multimeter_wire_v', 'km1_wire_nc1a')
                        && c('multimeter_wire_com', 'km1_wire_nc1b')
                        && same();
                },
            },
            {
                msg: '第 5 步：接触器结构知识',
                mode: 'quiz',
                quizConfig: {
                    question: '三相交流接触器由哪些主要部分组成？',
                    options: [
                        '线圈、铁心、主触点、辅助触点、复位弹簧',
                        '仅由线圈和主触点组成',
                        '由电动机和齿轮箱组成',
                        '由电阻和电容组成',
                    ],
                    answer: 0,
                    analysis: '三相交流接触器主要由电磁操动机构（线圈、静铁心、动衔铁）、主触点（3对常开）、辅助触点（常开/常闭）和复位弹簧组成。线圈通电产生电磁力吸合动衔铁，带动触点切换。',
                },
            },
        ],
    },

    'power-on-test': {
        id: 'power-on-test',
        name: '2. 通电测试接触器动作',
        steps: [
            {
                msg: '第 1 步：接线：单相交流电源 L 端 → 开关左端，开关右端 → 接触器线圈 A1 端；交流电源 N 端 → 接触器线圈 A2 端。接触器线圈得电后自动吸合（吸合电压 ≥ 187V）。',
                mode: 'check',
                async act() {
                    await new Promise(r => setTimeout(r, 500));
                    const sys = this.sys;
                    sys.conns.length = 0;
                    const cons = [
                        { from: 'ac1_wire_p', to: 'sw1_wire_l', type: 'wire' },
                        { from: 'sw1_wire_r', to: 'km1_wire_a1', type: 'wire' },
                        { from: 'ac1_wire_n', to: 'km1_wire_a2', type: 'wire' },
                    ];
                    cons.forEach(c => sys.connMgr.addConn(c));
                    const sw = sys.comps['sw1'];
                    if (sw) sw.isOn = true;
                    const ac = sys.comps['ac1'];
                    if (ac) ac.onConfigUpdate({ isOn: true });
                    sys.redrawAll();
                    await new Promise(r => setTimeout(r, 1000));
                },
                check() {
                    const c = (a, b) => this.sys.isPortConnected(a, b);
                    const km = this.sys.comps['km1'];
                    return km && km.getState() === 'on'
                        && c('ac1_wire_p', 'sw1_wire_l')
                        && c('sw1_wire_r', 'km1_wire_a1')
                        && c('ac1_wire_n', 'km1_wire_a2');
                },
            },
            {
                msg: '第 2 步：接触器已吸合，将万用表红表笔接主触点 L1，黑表笔接 T1。主触点在吸合后应导通。',
                mode: 'check',
                async act() {
                    await new Promise(r => setTimeout(r, 500));
                    const sys = this.sys;
                    sys.conns.length = 0;
                    const pwrCons = [
                        { from: 'ac1_wire_p', to: 'sw1_wire_l', type: 'wire' },
                        { from: 'sw1_wire_r', to: 'km1_wire_a1', type: 'wire' },
                        { from: 'ac1_wire_n', to: 'km1_wire_a2', type: 'wire' },
                    ];
                    pwrCons.forEach(c => sys.connMgr.addConn(c));
                    const mmCons = [
                        { from: 'multimeter_wire_v', to: 'km1_wire_l1', type: 'wire' },
                        { from: 'multimeter_wire_com', to: 'km1_wire_t1', type: 'wire' },
                    ];
                    mmCons.forEach(c => sys.connMgr.addConn(c));
                    const mm = sys.comps['multimeter'];
                    if (mm) { mm.group.position({ x: 920, y: 100 }); mm.group.visible(true); }
                    sys.redrawAll();
                    await new Promise(r => setTimeout(r, 500));
                },
                check() {
                    const c = (a, b) => this.sys.isPortConnected(a, b);
                    const same = () => _sameCluster(this.sys, 'km1_wire_l1', 'km1_wire_t1');
                    const km = this.sys.comps['km1'];
                    return km && km.getState() === 'on'
                        && same()
                        && c('multimeter_wire_v', 'km1_wire_l1')
                        && c('multimeter_wire_com', 'km1_wire_t1');
                },
            },
            {
                msg: '第 3 步：将万用表红表笔接常开辅助触点 13（NO1a），黑表笔接 14（NO1b）。吸合后常开触点应导通。',
                mode: 'check',
                async act() {
                    await new Promise(r => setTimeout(r, 500));
                    const sys = this.sys;
                    sys.conns.length = 0;
                    const pwrCons = [
                        { from: 'ac1_wire_p', to: 'sw1_wire_l', type: 'wire' },
                        { from: 'sw1_wire_r', to: 'km1_wire_a1', type: 'wire' },
                        { from: 'ac1_wire_n', to: 'km1_wire_a2', type: 'wire' },
                    ];
                    pwrCons.forEach(c => sys.connMgr.addConn(c));
                    const mmCons = [
                        { from: 'multimeter_wire_v', to: 'km1_wire_no1a', type: 'wire' },
                        { from: 'multimeter_wire_com', to: 'km1_wire_no1b', type: 'wire' },
                    ];
                    mmCons.forEach(c => sys.connMgr.addConn(c));
                    sys.redrawAll();
                    await new Promise(r => setTimeout(r, 500));
                },
                check() {
                    const c = (a, b) => this.sys.isPortConnected(a, b);
                    const same = () => _sameCluster(this.sys, 'km1_wire_no1a', 'km1_wire_no1b');
                    const km = this.sys.comps['km1'];
                    return km && km.getState() === 'on'
                        && same()
                        && c('multimeter_wire_v', 'km1_wire_no1a')
                        && c('multimeter_wire_com', 'km1_wire_no1b');
                },
            },
            {
                msg: '第 4 步：将万用表红表笔接常闭辅助触点 31（NC1a），黑表笔接 32（NC1b）。吸合后常闭触点应断开。',
                mode: 'check',
                async act() {
                    await new Promise(r => setTimeout(r, 500));
                    const sys = this.sys;
                    sys.conns.length = 0;
                    const pwrCons = [
                        { from: 'ac1_wire_p', to: 'sw1_wire_l', type: 'wire' },
                        { from: 'sw1_wire_r', to: 'km1_wire_a1', type: 'wire' },
                        { from: 'ac1_wire_n', to: 'km1_wire_a2', type: 'wire' },
                    ];
                    pwrCons.forEach(c => sys.connMgr.addConn(c));
                    const mmCons = [
                        { from: 'multimeter_wire_v', to: 'km1_wire_nc1a', type: 'wire' },
                        { from: 'multimeter_wire_com', to: 'km1_wire_nc1b', type: 'wire' },
                    ];
                    mmCons.forEach(c => sys.connMgr.addConn(c));
                    sys.redrawAll();
                    await new Promise(r => setTimeout(r, 500));
                },
                check() {
                    const c = (a, b) => this.sys.isPortConnected(a, b);
                    const same = () => _sameCluster(this.sys, 'km1_wire_nc1a', 'km1_wire_nc1b');
                    const km = this.sys.comps['km1'];
                    return km && km.getState() === 'on'
                        && !same()
                        && c('multimeter_wire_v', 'km1_wire_nc1a')
                        && c('multimeter_wire_com', 'km1_wire_nc1b');
                },
            },
            {
                msg: '第 5 步：关断交流电源，接触器线圈失电，接触器自动释放。再次测量主触点 L1-T1，应恢复断开状态。',
                mode: 'check',
                async act() {
                    await new Promise(r => setTimeout(r, 500));
                    const sys = this.sys;
                    const ac = sys.comps['ac1'];
                    if (ac) ac.onConfigUpdate({ isOn: false });
                    const sw = sys.comps['sw1'];
                    if (sw) sw.isOn = false;
                    await new Promise(r => setTimeout(r, 1500));
                },
                check() {
                    const km = this.sys.comps['km1'];
                    const ac = this.sys.comps['ac1'];
                    const same = () => _sameCluster(this.sys, 'km1_wire_l1', 'km1_wire_t1');
                    return km && ac && km.getState() === 'off' && !ac.isOn && !same();
                },
            },
            {
                msg: '第 6 步：接触器动作原理知识',
                mode: 'quiz',
                quizConfig: {
                    question: '交流接触器线圈通电后，以下哪个描述是正确的？',
                    options: [
                        '主触点断开，常开辅助触点闭合',
                        '主触点闭合，常开辅助触点闭合，常闭辅助触点断开',
                        '所有触点均断开',
                        '仅常闭辅助触点动作，主触点不变',
                    ],
                    answer: 1,
                    analysis: '线圈通电后产生电磁力吸合动衔铁，带动三对主触点闭合（接通主电路），同时常开辅助触点闭合、常闭辅助触点断开。线圈断电后，在复位弹簧作用下动衔铁释放，各触点恢复原始状态。',
                },
            },
        ],
    },
};

export const componentConfigs = [
    { Class: ACPower, id: 'ac1', x: 20, y: 120, vRms: 220, freq: 50, isOn: true, visible: true },
    { Class: DCPower, id: 'dc1', x: 20, y: 420, voltage: 220, isOn: true, visible: true },
    { Class: Switch, id: 'sw1', x: 260, y: 220, visible: true },
    { Class: ThreePhaseContactor, id: 'km1', x: 440, y: 120, visible: true, initState: 'off', coilResistance: 1000 },

    { Class: Multimeter, id: 'multimeter', x: 920, y: 100, visible: false },
    { Class: MF47Multimeter, id: 'mf47-panel', x: 1050, y: 150, visible: false },
    { Class: Oscilloscope_tri, id: 'osc', x: 50, y: 50, visible: false },
    { Class: SignalGenerator, id: 'sg', x: 50, y: 50, visible: false },
    { Class: ProcessCalibrator, id: 'cali', x: 50, y: 50, visible: false },
    { Class: ElecMeter, id: 'elecmeter', x: 50, y: 50, visible: false },
];

function _sameCluster(sys, portA, portB) {
    const solver = sys.voltageSolver;
    if (!solver || !solver.portToCluster) return false;
    return solver.portToCluster.get(portA) === solver.portToCluster.get(portB);
}

function _autoWire(sys) {
    sys.conns.length = 0;
    const cons = [
        { from: 'ac1_wire_p', to: 'sw1_wire_l', type: 'wire' },
        { from: 'sw1_wire_r', to: 'km1_wire_a1', type: 'wire' },
        { from: 'ac1_wire_n', to: 'km1_wire_a2', type: 'wire' },
    ];
    cons.forEach(c => sys.connMgr.addConn(c));
    const sw = sys.comps['sw1'];
    if (sw) sw.isOn = true;
    sys.redrawAll();
}

export function initSlider(sys) {
}

export function applyAllPresets() {
    const sys = this && this.sys ? this.sys : window.sys;
    if (!sys) return;
    _autoWire(sys);
    const sw = sys.comps['sw1'];
    if (sw) sw.isOn = true;
}

export async function applyStartSystem() {
    const sys = this && this.sys ? this.sys : window.sys;
    if (!sys) return;
    _autoWire(sys);
    const ac = sys.comps['ac1'];
    if (ac) ac.onConfigUpdate({ isOn: true });
    const sw = sys.comps['sw1'];
    if (sw) sw.isOn = true;
}

export function fiveStep() {}
