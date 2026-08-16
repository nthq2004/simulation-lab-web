// 电压互感器仿真项目 — PT 原边与白炽灯并联，副边接交流电压表
// 电路：AC → 白炽灯 → GND
//       PT原边与白炽灯并联
//       PT副边 → 交流电压表

import { ACPower } from '../components/ACPower.js';
import { Ground } from '../components/Gnd.js';
import { IncandescentLamp } from '../components/IncandescentLamp.js';
import { ACVoltmeter } from '../components/ACVoltmeter.js';
import { PotentialTransformer } from '../components/PotentialTransformer.js';
import { SinglePhaseFuse } from '../components/SinglePhaseFuse.js';
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
    pt_sec_short: {
        id: 'pt_sec_short',
        name: 'PT 副边短路',
        system: '电压互感器',
        check() {
            const c = window.sys && window.sys.comps && window.sys.comps['pt1'];
            return c && c._faultSecShort;
        },
        trigger() {
            const c = window.sys && window.sys.comps && window.sys.comps['pt1'];
            if (c) c._faultSecShort = true;
        },
        repair() {
            const c = window.sys && window.sys.comps && window.sys.comps['pt1'];
            if (c) c._faultSecShort = false;
        },
    },
};

export const PROJECT_WORKFLOWS = {
    'pt-basic': {
        id: 'pt-basic',
        name: '1. 电压互感器基本测量',
        steps: [
            {
                msg: '1. 连接主电路：交流电源 → FU1 熔断器 → 白炽灯 → 接地',
                mode: 'check',
                act() {
                    _presetWiringPrimary(this.sys);
                },
                check() {
                    const conns = this.sys.conns || [];
                    const has = (a,b) => conns.some(c => (c.from===a && c.to===b) || (c.from===b && c.to===a));
                    return has('ac_wire_p', 'fu1_wire_l')
                        && has('fu1_wire_t', 'lamp1_wire_l')
                        && has('lamp1_wire_r', 'gnd2_wire_gnd')
                        && has('ac_wire_n', 'gnd2_wire_gnd');
                },
            },
            {
                msg: '2. 连接 PT 原边至白炽灯两端（并联），PT 副边经 FU2 熔断器接交流电压表',
                mode: 'check',
                act() {
                    _presetWiringSecondary(this.sys);
                },
                check() {
                    const conns = this.sys.conns || [];
                    const has = (a,b) => conns.some(c => (c.from===a && c.to===b) || (c.from===b && c.to===a));
                    return has('fu1_wire_t', 'pt1_wire_p1')
                        && has('gnd2_wire_gnd', 'pt1_wire_p2')
                        && has('pt1_wire_s1', 'fu2_wire_l')
                        && has('fu2_wire_t', 'volt1_wire_vp')
                        && has('pt1_wire_s2', 'volt1_wire_vn');
                },
            },
            {
                msg: '3. 将 PT 副边 S₂ 端子接地（安全接地）',
                mode: 'check',
                act() {
                    const sys = this.sys;
                    sys.connMgr.addConn({ from: 'pt1_wire_s2', to: 'gnd1_wire_gnd', type: 'wire' });
                },
                check() {
                    const conns = this.sys.conns || [];
                    const has = (a,b) => conns.some(c => (c.from===a && c.to===b) || (c.from===b && c.to===a));
                    return has('pt1_wire_s2', 'gnd1_wire_gnd')
                        || has('volt1_wire_vn', 'gnd1_wire_gnd');
                },
            },
            {
                msg: '4. 接通电源（AC 220V/50Hz），观察 PT 原边电压 V₁ 和副边电压 V₂',
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
                msg: '5. 将电压互感器变比改为 5，验证 V₂ = V₁ / K',
                mode: 'check',
                act() {
                    const pt = this.sys.comps['pt1'];
                    if (pt) { pt._turnsRatio = 5; pt.turnsRatio = 5; }
                },
                check() {
                    const pt = this.sys.comps['pt1'];
                    return pt && pt._turnsRatio === 5;
                },
            },
            {
                msg: '6. 测试题：电压互感器的使用特点',
                mode: 'quiz',
                quizConfig: {
                    question: '电压互感器（PT）在使用中，为什么副边不允许短路？',
                    options: [
                        '短路后副边电流极大，可能烧毁绕组',
                        '短路后原边电压会变为零',
                        '短路后互感器会停止工作',
                        '短路后原边电压会升高，影响负载运行'
                    ],
                    answer: 0,
                    analysis: '电压互感器正常工作时，副边近似开路，副边电流极小。一旦副边短路，' +
                        'I₂ 急剧增大（仅受绕组内阻限制），巨大的短路电流会烧毁副边绕组。' +
                        '同时原边电流也会异常增大。因此 PT 副边绝不允许短路。',
                },
            },
        ],
    },
};

export const componentConfigs = [
    { Class: ACPower, id: 'ac', x: 10, y: 450, voltageRMS: 220, frequency: 50, isOn: false },
    { Class: IncandescentLamp, id: 'lamp1', x: 400, y: 720, coldResistance: 48.4, rotation: 90 },
    { Class: SinglePhaseFuse, id: 'fu1', x: 210, y: 650, label: 'FU1', ratedCurrent: 10 ,rotation:-90},
    { Class: Ground, id: 'gnd1', x: 1260, y: 390 },
    { Class: Ground, id: 'gnd2', x: 400, y: 900 },
    { Class: PotentialTransformer, id: 'pt1', x: 640, y: 390, turnsRatio: 10 },
    { Class: ACVoltmeter, id: 'volt1', x: 640, y: 30, maxVoltage: 100 },
    { Class: SinglePhaseFuse, id: 'fu2', x: 950, y: 450, label: 'FU2', ratedCurrent: 0.5,rotation:180 },

    { Class: Multimeter, id: 'multimeter', x: 650, y: 30, scale: 1.1, visible: false },
    { Class: MF47Multimeter, id: 'mf47-panel', x: 650, y: 30, visible: false },
    { Class: Oscilloscope, id: 'osc', x: 650, y: 260, visible: false },
    { Class: SignalGenerator, id: 'sg', x: 80, y: 400, visible: false },
    { Class: ProcessCalibrator, id: 'cali', x: 550, y: 400, visible: false },
    { Class: AmpMeter, id: 'ammeter', x: 350, y: 30, visible: false },
];

function _presetWiringPrimary(sys) {
    const cons = [
        { from: 'ac_wire_p', to: 'fu1_wire_l', type: 'wire' },
        { from: 'fu1_wire_t', to: 'lamp1_wire_l', type: 'wire' },
        { from: 'lamp1_wire_r', to: 'gnd2_wire_gnd', type: 'wire' },
        { from: 'ac_wire_n', to: 'gnd2_wire_gnd', type: 'wire' },
    ];
    cons.forEach(c => sys.connMgr.addConn(c));
}

function _presetWiringSecondary(sys) {
    const cons = [
        { from: 'fu1_wire_t', to: 'pt1_wire_p1', type: 'wire' },
        { from: 'gnd2_wire_gnd', to: 'pt1_wire_p2', type: 'wire' },
        { from: 'pt1_wire_s1', to: 'fu2_wire_l', type: 'wire' },
        { from: 'fu2_wire_t', to: 'volt1_wire_vp', type: 'wire' },
        { from: 'pt1_wire_s2', to: 'volt1_wire_vn', type: 'wire' },
    ];
    cons.forEach(c => sys.connMgr.addConn(c));
}

function _doPresetWiring(sys) {
    sys.conns = [];
    _presetWiringPrimary(sys);
    _presetWiringSecondary(sys);
    sys.connMgr.addConn({ from: 'pt1_wire_s2', to: 'gnd1_wire_gnd', type: 'wire' });
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
