// 半导体器件仿真项目 — 稳压二极管电压调节器
// 电路：24V → 1kΩ 限流电阻 → 稳压二极管(5.1V) → GND
//                                └── 负载电阻(10kΩ) → GND

import { DCPower } from '../components/DCPower.js';
import { RealResistor } from '../components/RealResistor.js';
import { RealVariResistor } from '../components/RealVariResistor.js';
import { Ground } from '../components/Gnd.js';
import { Multimeter } from '../components/Multimeter.js';
import { MF47Multimeter } from '../components/MF47Multimeter.js';
import { SignalGenerator } from '../components/SignalGenerator.js';
import { ProcessCalibrator } from '../components/ProcessCalibrator.js';
import { AmpMeter } from '../components/AmpMeter.js';
import { RealZener } from '../components/RealZener.js';
import { Oscilloscope_tri } from '../components/Osc_tri.js';

export const FAULT_CONFIGS = {
    zener_open: {
        id: 'zener_open',
        name: '稳压管开路故障',
        system: 'Zener',
        check() {
            const c = window.sys && window.sys.comps && window.sys.comps['zd1'];
            return c && c._faultOpen;
        },
        trigger() {
            const c = window.sys && window.sys.comps && window.sys.comps['zd1'];
            if (c) c._faultOpen = true;
        },
        repair() {
            const c = window.sys && window.sys.comps && window.sys.comps['zd1'];
            if (c) c._faultOpen = false;
        },
    },
    zener_short: {
        id: 'zener_short',
        name: '稳压管击穿短路',
        system: 'Zener',
        check() {
            const c = window.sys && window.sys.comps && window.sys.comps['zd1'];
            return c && c._faultShort;
        },
        trigger() {
            const c = window.sys && window.sys.comps && window.sys.comps['zd1'];
            if (c) c._faultShort = true;
        },
        repair() {
            const c = window.sys && window.sys.comps && window.sys.comps['zd1'];
            if (c) c._faultShort = false;
        },
    },
};

export const PROJECT_WORKFLOWS = {
    'zener-reg-basic': {
        id: 'zener-reg-basic',
        name: '1. 稳压二极管基本电路搭建',
        steps: [
            {
                msg: '1. 接通主回路：直流电源正极→1kΩ 限流电阻→稳压管阴极（负极）',
                mode: 'check',
                act() {
                    _doPresetWiring(this.sys);
                },
                check() {
                    const conns = this.sys.conns || [];
                    const has = (a, b) => conns.some(c => (c.from === a && c.to === b) || (c.from === b && c.to === a));
                    return has('psu_wire_p', 'r1_wire_l')
                        && has('r1_wire_r', 'zd1_wire_r');
                },
            },
            {
                msg: '2. 将稳压管阳极（正极）接地，负载电阻（10kΩ）并联在稳压管两端',
                mode: 'check',
                act() {},
                check() {
                    const conns = this.sys.conns || [];
                    const has = (a, b) => conns.some(c => (c.from === a && c.to === b) || (c.from === b && c.to === a));
                    return has('zd1_wire_l', 'gnd2_wire_gnd')
                        && has('zd1_wire_r', 'rl_wire_l')
                        && has('rl_wire_r', 'gnd2_wire_gnd');
                },
            },
            {
                msg: '3. 将万用表拨到 DCV20 档，红表笔接稳压管阴极（Vout），黑表笔接地',
                mode: 'check',
                act() {
                    _disconnectMultimeter(this.sys);
                    const mm = this.sys.comps['multimeter'];
                    if (mm) { mm.mode = 'DCV20'; mm._updateAngleByMode(); mm.update(0); }
                    this.sys.connMgr.addConn({ from: 'multimeter_wire_v', to: 'r1_wire_r', type: 'wire' });
                    this.sys.connMgr.addConn({ from: 'multimeter_wire_com', to: 'gnd2_wire_gnd', type: 'wire' });
                    this.sys.redrawAll();
                },
                check() {
                    const mm = this.sys.comps['multimeter'];
                    return mm && mm.mode === 'DCV20'
                        && _sameCluster(this.sys, 'multimeter_wire_v', 'r1_wire_r')
                        && _sameCluster(this.sys, 'multimeter_wire_com', 'gnd2_wire_gnd');
                },
            },
            {
                msg: '4. 接通电源（24V），观察万用表读数——应稳定在约 5.1V（稳压值）',
                mode: 'check',
                act() {
                    const psu = this.sys.comps['psu'];
                    if (psu) { psu.isOn = true; psu.voltage = 24; psu.update(); }
                },
                check() {
                    const psu = this.sys.comps['psu'];
                    const vOut = this.sys.getVoltageBetween('r1_wire_r', 'gnd2_wire_gnd');
                    return psu && psu.isOn && vOut !== undefined && vOut > 4.5 && vOut < 6.0;
                },
            },
            {
                msg: '5. 调节可变负载电阻（RL），观察万用表——输出电压仍稳定在约 5.1V（稳压效果）',
                mode: 'check',
                act() {},
                check() {
                    const rl = this.sys.comps['rl'];
                    const vOut = this.sys.getVoltageBetween('r1_wire_r', 'gnd2_wire_gnd');
                    return rl.currentResistance > 8000 && vOut !== undefined && vOut > 4.5 && vOut < 6.0;
                },
            },
            {
                msg: '6. 断开电源，将输入电压改为 15V 后再接通，观察稳压效果依然成立',
                mode: 'check',
                act() {
                    const psu = this.sys.comps['psu'];
                    if (psu) { psu.isOn = false; psu.voltage = 15; psu.update(); }
                    setTimeout(() => {
                        if (psu) { psu.isOn = true; psu.update(); }
                    }, 100);
                },
                check() {
                    const psu = this.sys.comps['psu'];
                    const vOut = this.sys.getVoltageBetween('r1_wire_r', 'gnd2_wire_gnd');
                    return psu && psu.isOn && Math.abs(psu.voltage - 15) < 0.3
                        && vOut !== undefined && vOut > 4.5 && vOut < 6.0;
                },
            },
            {
                msg: '7. 测试题：稳压二极管工作原理',
                mode: 'quiz',
                quizConfig: {
                    question: '关于稳压二极管（Zener Diode）的稳压原理，以下描述正确的是？',
                    options: [
                        '稳压管正向导通时起稳压作用',
                        '稳压管工作在反向击穿区，击穿电压即稳压值，需串联限流电阻',
                        '稳压管无需限流电阻可直接并联在电源两端',
                        '稳压管与普通二极管的伏安特性完全相同',
                    ],
                    answer: 1,
                    analysis: '稳压二极管利用反向击穿特性实现稳压，' +
                        '在规定的反向击穿电流范围内，两端电压保持基本恒定。' +
                        '必须串联限流电阻以控制击穿电流，防止过热损坏。',
                },
            },
        ],
    },
    'zener-reg-measure': {
        id: 'zener-reg-measure',
        name: '2. 稳压管故障分析',
        steps: [
            {
                msg: '1. 将万用表拨到 DCV20 档，测量稳压管两端电压',
                mode: 'check',
                act() {
                    _disconnectMultimeter(this.sys);
                    const mm = this.sys.comps['multimeter'];
                    if (mm) { mm.mode = 'DCV20'; mm._updateAngleByMode(); mm.update(0); }
                    this.sys.connMgr.addConn({ from: 'multimeter_wire_v', to: 'r1_wire_r', type: 'wire' });
                    this.sys.connMgr.addConn({ from: 'multimeter_wire_com', to: 'gnd2_wire_gnd', type: 'wire' });
                    const psu = this.sys.comps['psu'];
                    if (psu) { psu.isOn = true; psu.voltage = 24; psu.update(); }
                    this.sys.redrawAll();
                },
                check() {
                    const vZ = this.sys.getVoltageBetween('r1_wire_r', 'gnd2_wire_gnd');
                    return vZ !== undefined && vZ > 4.5 && vZ < 6.0
                        && _sameCluster(this.sys, 'multimeter_wire_v', 'r1_wire_r');
                },
            },
            {
                msg: '2. 在故障设置中触发"稳压管短路"故障---观察输出端电压(应接近 0V)',
                mode: 'check',
                act() {
                    const zd = this.sys.comps['zd1'];
                    zd._faultShort = true;
                },
                check() {
                    const zd = this.sys.comps['zd1'];
                    return zd && zd._faultShort === true;
                },
            },
            {
                msg: '3. 修复故障，然后触发"稳压管开路"故障',
                mode: 'check',
                act() {
                    const zd = this.sys.comps['zd1'];
                    if (zd) { zd._faultShort = false; zd._faultOpen = true; }
                },
                check() {
                    const zd = this.sys.comps['zd1'];
                    return zd && zd._faultOpen === true;
                },
            },
            {
                msg: '4. 增大负载电阻，观察输出端电压——应上升到接近电源电压（稳压管开路，失去稳压作用）',
                mode: 'check',
                act() {},
                check() {
                    const vOut = this.sys.getVoltageBetween('r1_wire_r', 'gnd2_wire_gnd');
                    return vOut !== undefined && vOut > 21;
                },
            },
            {
                msg: '5. 测试题：故障分析',
                mode: 'quiz',
                quizConfig: {
                    question: '稳压管短路故障时，负载两端电压会？',
                    options: [
                        '保持不变（仍在稳压值附近）',
                        '升高到接近电源电压',
                        '降低到接近 0V',
                        '无规律波动',
                    ],
                    answer: 2,
                    analysis: '稳压管短路后，输出端被直接拉到地（GND），' +
                        '负载两端电压接近 0V。此时限流电阻上的压降接近电源电压，' +
                        '可能导致限流电阻过热甚至烧毁。',
                },
            },
        ],
    },
    'zener-mf47-test': {
        id: 'zener-mf47-test',
        name: '3. 用指针万用表检测稳压管',
        steps: [
            {
                msg: '1. 将指针万用表（MF47）拨到 R×100 档位',
                mode: 'check',
                act() {
                    const mf47 = this.sys.comps['mf47-panel'];
                    if (mf47) { mf47.setRange('OHM100'); }
                    _disconnectMF47(this.sys);
                },
                check() {
                    const mf47 = this.sys.comps['mf47-panel'];
                    return mf47 && mf47._rangeId === 'OHM100';
                },
            },
            {
                msg: '2. 红表笔（V）接稳压管阴极（K），黑表笔（COM）接阳极（A）\n测量正向电阻，应显示较小阻值（PN 结正向导通）',
                mode: 'check',
                act() {
                    this.sys.connMgr.addConn({ from: 'mf47-panel_wire_COM', to: 'zd1_wire_l', type: 'wire' });
                    this.sys.connMgr.addConn({ from: 'mf47-panel_wire_v', to: 'zd1_wire_r', type: 'wire' });
                    this.sys.redrawAll();
                },
                check() {
                    return _sameCluster(this.sys, 'mf47-panel_wire_COM', 'zd1_wire_l')
                        && _sameCluster(this.sys, 'mf47-panel_wire_v', 'zd1_wire_r');
                },
            },
            {
                msg: '3. 反接表笔：红表笔接阳极（A），黑表笔接阴极（K）\n测量反向电阻，应显示 ∞（反向截止）',
                mode: 'check',
                act() {
                    _disconnectMF47(this.sys);
                    this.sys.connMgr.addConn({ from: 'mf47-panel_wire_COM', to: 'zd1_wire_r', type: 'wire' });
                    this.sys.connMgr.addConn({ from: 'mf47-panel_wire_v', to: 'zd1_wire_l', type: 'wire' });
                    this.sys.redrawAll();
                },
                check() {
                    return _sameCluster(this.sys, 'mf47-panel_wire_COM', 'zd1_wire_r')
                        && _sameCluster(this.sys, 'mf47-panel_wire_v', 'zd1_wire_l');
                },
            },
            {
                msg: '4. 测试题：稳压管检测',
                mode: 'quiz',
                quizConfig: {
                    question: '用万用表电阻档检测稳压管时，以下说法正确的是？',
                    options: [
                        '正反向测量都显示很小的电阻',
                        '正向测量导通、反向测量截止，与普通二极管检测方法相同',
                        '万用表无法检测稳压管好坏',
                        '稳压管不需要区分极性',
                    ],
                    answer: 1,
                    analysis: '稳压管在正向偏置时与普通二极管相同（PN 结导通），' +
                        '反向在未达到击穿电压前也呈截止状态。' +
                        '因此用万用表电阻档检测时与普通二极管无异，' +
                        '若要测量稳压值，需要外加高于稳压值的电压。',
                },
            },
        ],
    },
};

export const componentConfigs = [
    { Class: DCPower, id: 'psu', x: 10, y: 20, voltage: 24, isOn: false },
    { Class: Ground, id: 'gnd1', x: 80, y: 280 },
    { Class: RealResistor, id: 'r1', x: 350, y: 100, value: 1000, rotation: -90 },
    { Class: RealZener, id: 'zd1', x: 550, y: 180, vForward: 0.7, vZener: 5.1, rotation: -90 },
    { Class: RealVariResistor, id: 'rl', x: 680, y: 180, value: 10000, min: 100, max: 100000, rotation: 0 },
    { Class: Ground, id: 'gnd2', x: 560, y: 340 },

    { Class: Multimeter, id: 'multimeter', x: 850, y: 30, scale: 1.1, visible: false },
    { Class: MF47Multimeter, id: 'mf47-panel', x: 950, y: 480, visible: false },
    { Class: SignalGenerator, id: 'sg', x: 80, y: 400, visible: false },
    { Class: ProcessCalibrator, id: 'cali', x: 550, y: 400, visible: false },
    { Class: AmpMeter, id: 'ampmeter', x: 300, y: 400, visible: false },
    { Class: Oscilloscope_tri, id: 'osc3', x: 950, y: 60, visible: false },
];

function _doPresetWiring(sys) {
    sys.conns = [];
    const presetConns = [
        { from: 'psu_wire_p', to: 'r1_wire_l', type: 'wire' },
        { from: 'r1_wire_r', to: 'zd1_wire_r', type: 'wire' },
        { from: 'zd1_wire_l', to: 'gnd2_wire_gnd', type: 'wire' },
        { from: 'zd1_wire_r', to: 'rl_wire_l', type: 'wire' },
        { from: 'rl_wire_r', to: 'gnd2_wire_gnd', type: 'wire' },
        { from: 'psu_wire_n', to: 'gnd1_wire_gnd', type: 'wire' },
    ];
    presetConns.forEach(c => sys.connMgr.addConn(c));
    sys.redrawAll();
}

function _disconnectMultimeter(sys) {
    const ports = ['multimeter_wire_v', 'multimeter_wire_ma', 'multimeter_wire_com'];
    const existing = sys.conns.filter(c => ports.includes(c.from) || ports.includes(c.to));
    existing.forEach(c => sys.connMgr.removeConn(c));
    sys.redrawAll();
}

function _disconnectMF47(sys) {
    const ports = ['mf47-panel_wire_v', 'mf47-panel_wire_mA', 'mf47-panel_wire_COM'];
    const existing = sys.conns.filter(c => ports.includes(c.from) || ports.includes(c.to));
    existing.forEach(c => sys.connMgr.removeConn(c));
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
    const psu = sys.comps['psu'];
    if (psu) { psu.isOn = true; psu.voltage = 24; psu.update(); }
}

export function fiveStep() {}
