// 变压器直流飞返仿真工程
// 电路：DC+ → 开关 → 变压器原边 p1；变压器原边 p2 → GND；DC- → GND
//       AC p → 变压器副边 s1；AC n → GND；变压器副边 s2 → GND

import { DCPower } from '../components/DCPower.js';
import { ACPower } from '../components/ACPower.js';
import { Switch } from '../components/Switch.js';
import { RealControlTransformer } from '../components/RealControlTransformer.js';
import { Ground } from '../components/Gnd.js';
import { Multimeter } from '../components/Multimeter.js';
import { MF47Multimeter } from '../components/MF47Multimeter.js';
import { Oscilloscope_tri } from '../components/Osc_tri.js';
import { SignalGenerator } from '../components/SignalGenerator.js';
import { ProcessCalibrator } from '../components/ProcessCalibrator.js';
import { ElecMeter } from '../components/ElecMeter.js';

export const FAULT_CONFIGS = {};

export const PROJECT_WORKFLOWS = {
    'polarity-dc': {
        id: 'polarity-dc',
        name: '1. 直流法测试变压器同名端',
        steps: [
            {
                msg: '1. 电路接线：直流电源正极 → 开关 → 变压器原边 p1；原边 p2 接地；直流电源负极接地',
                mode: 'check',
                act() {
                    _presetStepPolarity(this.sys);
                },
                check() {
                    const _c = (a, b) => this.sys.isPortConnected(a, b);
                    return _c('dc_wire_p', 'switch1_wire_l')
                        && _c('switch1_wire_r', 'transformer_wire_p1')
                        && _c('transformer_wire_p2', 'gnd1_wire_gnd')
                        && _c('dc_wire_n', 'gnd1_wire_gnd');
                },
            },
            {
                msg: '2. 调出指针式万用表，接至变压器副边（COM 接 s2，V 接 s1），档位切换至直流 10V',
                mode: 'check',
                act() {
                    const mm = this.sys.comps['mf47-panel'];
                    if (mm) {
                        mm.group.visible(true);
                        mm.setRange('DCV10');
                    }
                },
                check() {
                    const mm = this.sys.comps['mf47-panel'];
                    if (!mm || !mm.group || !mm.group.visible()) return false;
                    if (mm._rangeId !== 'DCV10') return false;
                    const _c = (a, b) => this.sys.isPortConnected(a, b);
                    return _c('mf47-panel_wire_v', 'transformer_wire_s1')
                        && _c('mf47-panel_wire_COM', 'transformer_wire_s2');
                },
            },
            {
                msg: '3. 打开直流电源（电压调至 3V），闭合开关，观察万用表指针偏转方向。\n若正偏（向右），则直流电源正极（p1）与万用表 V 端（s1）为同名端；\n若反偏（向左），则 p1 与 COM 端（s2）为同名端。',
                mode: 'check',
                act() {
                    const dc = this.sys.comps['dc'];
                    if (dc) { dc.isOn = true; dc.voltage = 3; dc.update(); }
                    const sw = this.sys.comps['switch1'];
                    if (sw && !sw.isOn) sw.toggle();
                },
                check() {
                    const dc = this.sys.comps['dc'];
                    const sw = this.sys.comps['switch1'];
                    return dc && dc.isOn && Math.abs(dc.voltage - 3) < 0.1 && sw && sw.isOn;
                },
            },
            {
                msg: '4. 断开开关，观察万用表指针偏转方向。\n指针应反偏（向左），验证楞次定律：磁场能量不能突变，断电时感应反向电动势。',
                mode: 'check',
                act() {
                    const sw = this.sys.comps['switch1'];
                    if (sw && sw.isOn) sw.toggle();
                },
                check() {
                    const sw = this.sys.comps['switch1'];
                    return sw && !sw.isOn;
                },
            },
            {
                msg: '5. 测试题：关于变压器同名端',
                mode: 'quiz',
                quizConfig: {
                    question: '用直流法测试变压器同名端时，闭合开关瞬间若万用表正偏，说明：',
                    options: [
                        '直流电源正极与万用表正极对应的端子为同名端',
                        '直流电源正极与万用表负极对应的端子为同名端',
                        '变压器变比大于 1',
                        '变压器存在匝间短路',
                    ],
                    answer: 0,
                    analysis: '闭合开关瞬间原边电流增大，若副边感应电压使万用表正偏，说明两绕组电动势方向相同，即直流电源正极和万用表正极所接端子为同名端。',
                },
            },
        ],
    },
    'polarity-ac': {
        id: 'polarity-ac',
        name: '2. 交流法测试变压器同名端',
        steps: [
            {
                msg: '1. 电路接线：交流电源 L → 开关 → 变压器原边 p1；原边 p2 接地；交流电源 N 接地；副边 s2 接地',
                mode: 'check',
                act() {
                    _presetStepAC(this.sys);
                },
                check() {
                    const _c = (a, b) => this.sys.isPortConnected(a, b);
                    return _c('ac_wire_p', 'switch1_wire_l')
                        && _c('switch1_wire_r', 'transformer_wire_p1')
                        && _c('transformer_wire_p2', 'gnd1_wire_gnd')
                        && _c('ac_wire_n', 'gnd1_wire_gnd')
                        && _c('transformer_wire_s2', 'gnd1_wire_gnd');
                },
            },
            {
                msg: '2. 调出数字万用表，接至变压器副边测量副边电压（V 接 s1，COM 接地），档位切换至交流 200V',
                mode: 'check',
                act() {
                    const mm = this.sys.comps['multimeter'];
                    if (mm) {
                        mm.group.visible(true);
                        mm.mode = 'ACV500';
                    }
                },
                check() {
                    const mm = this.sys.comps['multimeter'];
                    if (!mm || !mm.group || !mm.group.visible()) return false;
                    if (!mm.mode || !mm.mode.startsWith('ACV')) return false;
                    const _c = (a, b) => this.sys.isPortConnected(a, b);
                    return _c('multimeter_wire_v', 'transformer_wire_s1')
                        && (_c('multimeter_wire_com', 'gnd1_wire_gnd')
                            || _c('multimeter_wire_com', 'transformer_wire_s2'));
                },
            },
            {
                msg: '3. 闭合开关，接通交流电源（380V/50Hz）。调出数字功率计，将其电压接线柱 U+ 接原边 p1，U- 接副边 s1，观察功率计的电压读数 V。\n若 V ≈ |Vp - Vs| ≈ 160V，则 p1 与 s1 为同名端；\n若 V ≈ Vp + Vs ≈ 600V，则 p1 与 s1 为异名端。',
                mode: 'check',
                act() {
                    const ac = this.sys.comps['ac'];
                    if (ac) { ac.isOn = true; ac.voltageRMS = 380; ac.frequency = 50; ac.update(); }
                    const sw = this.sys.comps['switch1'];
                    if (sw && !sw.isOn) sw.toggle();
                    const em = this.sys.comps['elecmeter'];
                    if (em) em.group.visible(true);
                },
                check() {
                    const ac = this.sys.comps['ac'];
                    const sw = this.sys.comps['switch1'];
                    const em = this.sys.comps['elecmeter'];
                    if (!ac || !ac.isOn) return false;
                    if (!sw || !sw.isOn) return false;
                    if (!em || !em.group || !em.group.visible()) return false;
                    const _c = (a, b) => this.sys.isPortConnected(a, b);
                    return _c('elecmeter_wire_up', 'transformer_wire_p1')
                        && _c('elecmeter_wire_un', 'transformer_wire_s1');
                },
            },
            {
                msg: '4. 测试题：关于交流法测同名端',
                mode: 'quiz',
                quizConfig: {
                    question: '用交流法测试变压器同名端时，将原边 p2 与副边 s2 短接（接地），测得 p1 与 s1 之间电压为 |Vp-Vs|，说明：',
                    options: [
                        'p1 与 s1 为同名端',
                        'p1 与 s1 为异名端',
                        '变压器变比等于 1',
                        '变压器绕组短路',
                    ],
                    answer: 0,
                    analysis: '当 p2 与 s2 短接时，若 p1 与 s1 为同名端，两电动势方向相反，测得的电压差为 |Vp-Vs|；若为异名端，两电动势方向相同，测得电压和为 Vp+Vs。',
                },
            },
        ],
    },
};

export const componentConfigs = [
    { Class: DCPower, id: 'dc', x: 10, y: 300, voltage: 3, isOn: false },
    { Class: Switch, id: 'switch1', x: 300, y: 400 },
    { Class: RealControlTransformer, id: 'transformer', x: 450, y: 340, primaryResistance: 200 },
    { Class: ACPower, id: 'ac', x: 10, y: 300, voltageRMS: 30, frequency: 50, isOn: false },
    { Class: Ground, id: 'gnd1', x: 450, y: 580 },

    { Class: Multimeter, id: 'multimeter', x: 750, y: 30, scale: 1.1, visible: false },
    { Class: MF47Multimeter, id: 'mf47-panel', x: 750, y: 30, visible: false },
    { Class: Oscilloscope_tri, id: 'osc', x: 650, y: 260, visible: false },
    { Class: SignalGenerator, id: 'sg', x: 80, y: 400, visible: false },
    { Class: ProcessCalibrator, id: 'cali', x: 550, y: 400, visible: false },
    { Class: ElecMeter, id: 'elecmeter', x: 550, y: 30, visible: false },
];

function _presetStepPolarity(sys) {
    const cons = [
        { from: 'dc_wire_p', to: 'switch1_wire_l', type: 'wire' },
        { from: 'switch1_wire_r', to: 'transformer_wire_p1', type: 'wire' },
        { from: 'transformer_wire_p2', to: 'gnd1_wire_gnd', type: 'wire' },
        { from: 'dc_wire_n', to: 'gnd1_wire_gnd', type: 'wire' },
    ];
    cons.forEach(c => sys.connMgr.addConn(c));
}

function _presetStepAC(sys) {
    const cons = [
        { from: 'ac_wire_p', to: 'switch1_wire_l', type: 'wire' },
        { from: 'switch1_wire_r', to: 'transformer_wire_p1', type: 'wire' },
        { from: 'transformer_wire_p2', to: 'gnd1_wire_gnd', type: 'wire' },
        { from: 'ac_wire_n', to: 'gnd1_wire_gnd', type: 'wire' },
        { from: 'transformer_wire_s2', to: 'gnd1_wire_gnd', type: 'wire' },
    ];
    cons.forEach(c => sys.connMgr.addConn(c));
}

export function initSlider(_sys) {}

function _autoWireDC(sys) {
    sys.conns.length = 0;
    const cons = [
        { from: 'dc_wire_p', to: 'switch1_wire_l', type: 'wire' },
        { from: 'switch1_wire_r', to: 'transformer_wire_p1', type: 'wire' },
        { from: 'transformer_wire_p2', to: 'gnd1_wire_gnd', type: 'wire' },
        { from: 'dc_wire_n', to: 'gnd1_wire_gnd', type: 'wire' },
        { from: 'mf47-panel_wire_v', to: 'transformer_wire_s1', type: 'wire' },
        { from: 'mf47-panel_wire_COM', to: 'transformer_wire_s2', type: 'wire' },
    ];
    cons.forEach(c => sys.connMgr.addConn(c));
    if (sys.comps['dc']) sys.comps['dc'].group.visible(true);
    if (sys.comps['ac']) sys.comps['ac'].group.visible(false);
    const mf = sys.comps['mf47-panel'];
    if (mf) { mf.group.visible(true); mf.setRange('DCV10'); }
    if (sys.comps['multimeter']) sys.comps['multimeter'].group.visible(false);
    sys.redrawAll();
}

function _autoWireAC(sys) {
    sys.conns.length = 0;
    const cons = [
        { from: 'ac_wire_p', to: 'switch1_wire_l', type: 'wire' },
        { from: 'switch1_wire_r', to: 'transformer_wire_p1', type: 'wire' },
        { from: 'transformer_wire_p2', to: 'gnd1_wire_gnd', type: 'wire' },
        { from: 'ac_wire_n', to: 'gnd1_wire_gnd', type: 'wire' },
        { from: 'transformer_wire_s2', to: 'gnd1_wire_gnd', type: 'wire' },
        { from: 'multimeter_wire_v', to: 'transformer_wire_s1', type: 'wire' },
        { from: 'multimeter_wire_com', to: 'transformer_wire_s2', type: 'wire' },
    ];
    cons.forEach(c => sys.connMgr.addConn(c));
    if (sys.comps['ac']) sys.comps['ac'].group.visible(true);
    if (sys.comps['dc']) sys.comps['dc'].group.visible(false);
    const mm = sys.comps['multimeter'];
    if (mm) { mm.group.visible(true); mm.mode = 'ACV200'; mm._updateAngleByMode(); }
    if (sys.comps['mf47-panel']) sys.comps['mf47-panel'].group.visible(false);
    sys.redrawAll();
}

export function applyAllPresets() {
    const sys = this && this.sys ? this.sys : window.sys;
    if (!sys) return;
    if (sys.currentWorkflowId === 'polarity-ac') _autoWireAC(sys);
    else _autoWireDC(sys);
}

export async function applyStartSystem() {
    const sys = this && this.sys ? this.sys : window.sys;
    if (!sys) return;
    if (sys.currentWorkflowId === 'polarity-ac') _autoWireAC(sys);
    else _autoWireDC(sys);
}

export function fiveStep() {}
