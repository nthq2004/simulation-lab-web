// 电流互感器仿真项目 — CT 原边串联电流表和灯泡，副边串联电流表
// 电路：AC → 电流表2 → CT原边 → 白炽灯 → GND
//       CT副边 → 电流表1 → GND

import { ACPower } from '../components/ACPower.js';
import { Ground } from '../components/Gnd.js';
import { IncandescentLamp } from '../components/IncandescentLamp.js';
import { ACAmmeter } from '../components/ACAmmeter.js';
import { CurrentTransformer } from '../components/CurrentTransformer.js';
import { Multimeter } from '../components/Multimeter.js';
import { MF47Multimeter } from '../components/MF47Multimeter.js';
import { Oscilloscope } from '../components/Oscilloscope.js';
import { SignalGenerator } from '../components/SignalGenerator.js';
import { ProcessCalibrator } from '../components/ProcessCalibrator.js';
import { AmpMeter } from '../components/AmpMeter.js';

export const FAULT_CONFIGS = {
    lamp_burn: {
        id: 'lamp_burn',
        name: '白炽灯灯丝烧断',
        system: '负载',
        check() {
            const c = window.sys && window.sys.comps && window.sys.comps['lamp1'];
            return c && c._burnedOut;
        },
        trigger() {
            const c = window.sys && window.sys.comps && window.sys.comps['lamp1'];
            if (c) c._burnedOut = true;
        },
        repair() {
            const c = window.sys && window.sys.comps && window.sys.comps['lamp1'];
            if (c) c._burnedOut = false;
        },
    },
    ct_sec_open: {
        id: 'ct_sec_open',
        name: 'CT 副边开路',
        system: '电流互感器',
        check() {
            const c = window.sys && window.sys.comps && window.sys.comps['ct1'];
            return c && c._faultSecOpen;
        },
        trigger() {
            const c = window.sys && window.sys.comps && window.sys.comps['ct1'];
            if (c) c._faultSecOpen = true;
        },
        repair() {
            const c = window.sys && window.sys.comps && window.sys.comps['ct1'];
            if (c) c._faultSecOpen = false;
        },
    },
};

export const PROJECT_WORKFLOWS = {
    'ct-basic': {
        id: 'ct-basic',
        name: '1. 电流互感器基本测量',
        steps: [
            {
                msg: '1. 连接主电路：交流电源 → 电流表2 → CT 原边 → 白炽灯 → 接地',
                mode: 'check',
                act() {
                    _presetWiringPrimary(this.sys);
                },
                check() {
                    const conns = this.sys.conns || [];
                    const has = (a,b) => conns.some(c => (c.from===a && c.to===b) || (c.from===b && c.to===a));
                    return has('ac_wire_p', 'ac_amp2_wire_ap')
                        && has('ac_amp2_wire_an', 'ct1_wire_p1')
                        && has('ct1_wire_p2', 'lamp1_wire_l')
                        && has('lamp1_wire_r', 'gnd1_wire_gnd')
                        && has('ac_wire_n', 'gnd2_wire_gnd');
                },
            },
            {
                msg: '2. 连接 CT 副边：CT 副边 S1 → 电流表1 → S2 → 接地',
                mode: 'check',
                act() {
                    _presetWiringSecondary(this.sys);
                },
                check() {
                    const conns = this.sys.conns || [];
                    const has = (a,b) => conns.some(c => (c.from===a && c.to===b) || (c.from===b && c.to===a));
                    return has('ct1_wire_s1', 'ac_amp1_wire_ap')
                        && has('ac_amp1_wire_an', 'ct1_wire_s2')
                        && has('ct1_wire_s2', 'gnd3_wire_gnd');
                },
            },
            {
                msg: '3. 接通电源（AC 220V/50Hz），观察 CT 原边电流 I₁ 和副边电流 I₂',
                mode: 'check',
                act() {
                    const ac = this.sys.comps['ac'];
                    if (ac) { ac.isOn = true; ac.voltageRMS = 220; ac.frequency = 50; ac.update(); }
                },
                check() {
                    const ac = this.sys.comps['ac'];
                    return ac && ac.isOn;
                },
            },
            {
                msg: '4. 将电流互感器变比改为 20，验证 I₂ = I₁ / K',
                mode: 'check',
                act() {
                    const ct = this.sys.comps['ct1'];
                    if (ct) { ct._turnsRatio = 20; ct.turnsRatio = 20; }
                },
                check() {
                    const ct = this.sys.comps['ct1'];
                    return ct && ct._turnsRatio === 20;
                },
            },
            {
                msg: '5. 测试题：电流互感器的使用特点',
                mode: 'quiz',
                quizConfig: {
                    question: '电流互感器（CT）在使用中，为什么副边不允许开路？',
                    options: [
                        '开路后副边感应电压会升高，可能击穿绝缘',
                        '开路后原边电流会变为零',
                        '开路后互感器会停止工作',
                        '开路后原边电流会减小，影响负载运行'
                    ],
                    answer: 0,
                    analysis: '电流互感器正常工作时，副边近似短路，副边电动势很小。一旦副边开路，I₂=0，无法产生去磁磁通，铁芯中磁通急剧增加，副边会感应出很高的尖顶波电压（可达数千伏），' +
                        '危及人身安全和设备绝缘。同时铁损增大，铁芯会严重过热。因此 CT 副边绝不允许开路。',
                },
            },
        ],
    },
};

export const componentConfigs = [
    { Class: ACPower, id: 'ac', x: 20, y: 250, voltageRMS: 220, frequency: 50, isOn: false },
    { Class: ACAmmeter, id: 'ac_amp2', x: 70, y: 520, maxCurrent: 50 },
    { Class: CurrentTransformer, id: 'ct1', x: 640, y: 390, turnsRatio: 10 },
    { Class: IncandescentLamp, id: 'lamp1', x: 1220, y: 820, coldResistance: 4.84, rotation: 90 },
    { Class: Ground, id: 'gnd1', x: 1220, y: 950 },
    { Class: Ground, id: 'gnd2', x: 60, y: 500 },
    { Class: ACAmmeter, id: 'ac_amp1', x: 640, y: 30, maxCurrent: 5 },
    { Class: Ground, id: 'gnd3', x: 1220, y: 360 },

    { Class: Multimeter, id: 'multimeter', x: 650, y: 30, scale: 1.1, visible: false },
    { Class: MF47Multimeter, id: 'mf47-panel', x: 650, y: 30, visible: false },
    { Class: Oscilloscope, id: 'osc', x: 650, y: 260, visible: false },
    { Class: SignalGenerator, id: 'sg', x: 80, y: 400, visible: false },
    { Class: ProcessCalibrator, id: 'cali', x: 550, y: 400, visible: false },
    { Class: AmpMeter, id: 'ammeter', x: 350, y: 30, visible: false },
];

function _presetWiringPrimary(sys) {
    const cons = [
        { from: 'ac_wire_p', to: 'ac_amp2_wire_ap', type: 'wire' },
        { from: 'ac_amp2_wire_an', to: 'ct1_wire_p1', type: 'wire' },
        { from: 'ct1_wire_p2', to: 'lamp1_wire_l', type: 'wire' },
        { from: 'lamp1_wire_r', to: 'gnd1_wire_gnd', type: 'wire' },
        { from: 'ac_wire_n', to: 'gnd2_wire_gnd', type: 'wire' },
    ];
    cons.forEach(c => sys.connMgr.addConn(c));
}

function _presetWiringSecondary(sys) {
    const cons = [
        { from: 'ct1_wire_s1', to: 'ac_amp1_wire_ap', type: 'wire' },
        { from: 'ac_amp1_wire_an', to: 'ct1_wire_s2', type: 'wire' },
        { from: 'ct1_wire_s2', to: 'gnd3_wire_gnd', type: 'wire' },
    ];
    cons.forEach(c => sys.connMgr.addConn(c));
}

function _doPresetWiring(sys) {
    sys.conns = [];
    _presetWiringPrimary(sys);
    _presetWiringSecondary(sys);
    sys.redrawAll();
}

function _sameCluster(sys, portA, portB) {
    const map = sys.voltageSolver?.portToCluster;
    if (!map) return false;
    const cA = map.get(portA);
    const cB = map.get(portB);
    return cA !== undefined && cA === cB;
}

export function initSlider(_sys) {}

export function applyAllPresets() {
    _doPresetWiring(this.sys);
}

export async function applyStartSystem() {
    const sys = this.sys;
    _doPresetWiring(sys);
    const ac = sys.comps['ac'];
    if (ac) { ac.isOn = true; ac.voltageRMS = 220; ac.frequency = 50; ac.update(); }
}

export function fiveStep() {
    const sys = this && this.sys ? this.sys : window.sys;
    if (!sys) return;
    const ac = sys.comps['ac'];
    if (!ac) return;
    const voltages = [100, 150, 200, 250, 300];
    const idx = (fiveStep._idx || 0) % voltages.length;
    ac.voltageRMS = voltages[idx];
    ac.update();
    fiveStep._idx = idx + 1;
}
