// 半导体器件仿真项目 — 万用表测量 IGBT 开关特性
// 电路：24V → 1kΩ → IGBT(C)  IGBT(E)→ GND
//         门极 G → 10kΩ → 开关(15V)

import { DCPower } from '../components/DCPower.js';
import { RealResistor } from '../components/RealResistor.js';
import { Ground } from '../components/Gnd.js';
import { Multimeter } from '../components/Multimeter.js';
import { MF47Multimeter } from '../components/MF47Multimeter.js';
import { SignalGenerator } from '../components/SignalGenerator.js';
import { ProcessCalibrator } from '../components/ProcessCalibrator.js';
import { Oscilloscope_tri } from '../components/Osc_tri.js';
import { RealIGBT } from '../components/RealIGBT.js';
import { RealMosfet } from '../components/RealMosfet.js';

export const FAULT_CONFIGS = {
    ce_short: {
        id: 'ce_short',
        name: 'CE 击穿故障',
        system: 'IGBT',
        check() {
            const c = window.sys && window.sys.comps && window.sys.comps['igbt1'];
            return c && c._faultCEShort;
        },
        trigger() {
            const c = window.sys && window.sys.comps && window.sys.comps['igbt1'];
            if (c) c._faultCEShort = true;
        },
        repair() {
            const c = window.sys && window.sys.comps && window.sys.comps['igbt1'];
            if (c) c._faultCEShort = false;
        },
    },
    ce_open: {
        id: 'ce_open',
        name: 'CE 开路故障',
        system: 'IGBT',
        check() {
            const c = window.sys && window.sys.comps && window.sys.comps['igbt1'];
            return c && c._faultCEOpen;
        },
        trigger() {
            const c = window.sys && window.sys.comps && window.sys.comps['igbt1'];
            if (c) c._faultCEOpen = true;
        },
        repair() {
            const c = window.sys && window.sys.comps && window.sys.comps['igbt1'];
            if (c) c._faultCEOpen = false;
        },
    },
};

export const PROJECT_WORKFLOWS = {
    'semi-igbt-switch': {
        id: 'semi-igbt-switch',
        name: '1. IGBT 开关特性测量',
        steps: [
            {
                msg: '1. 接通主电路：直流电源正极→电阻→IGBT 集电极，发射极接地',
                mode: 'check',
                act() {
                    _doPresetWiring(this.sys);
                },
                check() {
                    const conns = this.sys.conns || [];
                    const has = (a, b) => conns.some(c => (c.from === a && c.to === b) || (c.from === b && c.to === a));
                    return has('psu_wire_p', 'r1_wire_l')
                        && has('r1_wire_r', 'igbt1_wire_c')
                        && has('igbt1_wire_e', 'gnd_wire_gnd');
                },
            },
            {
                msg: '2. 接通门极驱动电路：驱动电源正极→10kΩ 电阻→门极 G',
                mode: 'check',
                act() {},
                check() {
                    const conns = this.sys.conns || [];
                    const has = (a, b) => conns.some(c => (c.from === a && c.to === b) || (c.from === b && c.to === a));
                    return has('psu_g_wire_p', 'rg_wire_l')
                        && has('rg_wire_r', 'igbt1_wire_g');
                },
            },
            {
                msg: '3. 将万用表拨到 DCV200 档，红黑表笔接 IGBT 集电极-发射极两端',
                mode: 'check',
                act() {
                    const mm = this.sys.comps['multimeter'];
                    if (mm) { mm.mode = 'DCV200'; mm._updateAngleByMode(); mm.update(0); }
                    _disconnectMultimeter(this.sys);
                    this.sys.connMgr.addConn({ from: 'multimeter_wire_v', to: 'igbt1_wire_c', type: 'wire' });
                    this.sys.connMgr.addConn({ from: 'multimeter_wire_com', to: 'igbt1_wire_e', type: 'wire' });
                    this.sys.redrawAll();
                },
                check() {
                    const mm = this.sys.comps['multimeter'];
                    return mm && mm.mode === 'DCV200'
                        && _sameCluster(this.sys, 'multimeter_wire_v', 'igbt1_wire_c')
                        && _sameCluster(this.sys, 'multimeter_wire_com', 'igbt1_wire_e');
                },
            },
            {
                msg: '4. 接通主电路电源（24V），门极不加电压，观察 CE 两端电压（≈ 24V，IGBT 截止）',
                mode: 'check',
                act() {
                    const psu = this.sys.comps['psu'];
                    if (psu) { psu.isOn = true; psu.voltage = 24; psu.update(); }
                },
                check() {
                    const psu = this.sys.comps['psu'];
                    const vCE = this.sys.getVoltageBetween('igbt1_wire_c', 'igbt1_wire_e');
                    return psu && psu.isOn && vCE !== undefined && vCE > 20;
                },
            },
            {
                msg: '5. 接通门极驱动电源（+15V），观察 CE 电压（导通后 ≈ 1.8V）',
                mode: 'check',
                act() {
                    const psuG = this.sys.comps['psu_g'];
                    if (psuG) { psuG.isOn = true; psuG.voltage = 15; psuG.update(); }
                },
                check() {
                    const igbt = this.sys.comps['igbt1'];
                    const psuG = this.sys.comps['psu_g'];
                    const vCE = this.sys.getVoltageBetween('igbt1_wire_c', 'igbt1_wire_e');
                    return igbt && igbt._isOn === true
                        && psuG && psuG.isOn === true
                        && vCE !== undefined && vCE < 3;
                },
            },
            {
                msg: '6. 切断门极驱动电源（0V），观察 CE 电压（应恢复 ≈ 24V，IGBT 关断，无自锁特性）',
                mode: 'check',
                act() {
                    const psuG = this.sys.comps['psu_g'];
                    if (psuG) { psuG.isOn = false; psuG.voltage = 0; psuG.update(); }
                },
                check() {
                    const igbt = this.sys.comps['igbt1'];
                    const psuG = this.sys.comps['psu_g'];
                    const vCE = this.sys.getVoltageBetween('igbt1_wire_c', 'igbt1_wire_e');
                    return igbt && igbt._isOn === false
                        && psuG && psuG.isOn === false
                        && vCE !== undefined && vCE > 20;
                },
            },
            {
                msg: '7. 测试题：IGBT 特性',
                mode: 'quiz',
                quizConfig: {
                    question: 'IGBT 与 SCR（晶闸管）相比，以下描述正确的是？',
                    options: [
                        'IGBT 导通后门极信号消失仍保持导通（自锁）',
                        'IGBT 是电压控制器件，门极正压导通、零压或负压关断',
                        'IGBT 只能通过过零电流关断',
                        'IGBT 与 SCR 的开关特性完全相同',
                    ],
                    answer: 1,
                    analysis: 'IGBT 是电压控制型器件，门极施加高于阈值电压的正压时导通，' +
                        '门极电压降至阈值以下或施加负压时关断，无自锁特性。' +
                        '而 SCR 一旦触发导通，即使门极信号消失仍保持导通（自锁）。',
                },
            },
        ],
    },
    'semi-igbt-diode-test': {
        id: 'semi-igbt-diode-test',
        name: '2. 用数字万用表检测 IGBT',
        steps: [
            {
                msg: '1. 将万用表拨到二极管档',
                mode: 'check',
                act() {
                    _disconnectMultimeter(this.sys);
                    const mm = this.sys.comps['multimeter'];
                    if (mm) { mm.mode = 'DIODE'; mm._updateAngleByMode(); mm.update(0); }
                },
                check() {
                    const mm = this.sys.comps['multimeter'];
                    return mm && mm.mode === 'DIODE';
                },
            },
            {
                msg: '2. 测量 GE 之间正反向特性\n红笔接 G，黑笔接 E：应显示 OL（极高阻抗）\n红笔接 E，黑笔接 G：也应显示 OL',
                mode: 'check',
                act() {
                    this.sys.connMgr.addConn({ from: 'multimeter_wire_v', to: 'igbt1_wire_g', type: 'wire' });
                    this.sys.connMgr.addConn({ from: 'multimeter_wire_com', to: 'igbt1_wire_e', type: 'wire' });
                    this.sys.redrawAll();
                },
                check() {
                    const mm = this.sys.comps['multimeter'];
                    return mm && mm.mode === 'DIODE' && mm.value > 50
                        && _sameCluster(this.sys, 'multimeter_wire_v', 'igbt1_wire_g')
                        && _sameCluster(this.sys, 'multimeter_wire_com', 'igbt1_wire_e');
                },
            },
            {
                msg: '3. 测量 CE 之间体二极管正向特性\n红笔接 E，黑笔接 C：应显示约 0.7V（体二极管导通）',
                mode: 'check',
                act() {
                    _disconnectMultimeter(this.sys);
                    this.sys.connMgr.addConn({ from: 'multimeter_wire_v', to: 'igbt1_wire_e', type: 'wire' });
                    this.sys.connMgr.addConn({ from: 'multimeter_wire_com', to: 'igbt1_wire_c', type: 'wire' });
                    this.sys.redrawAll();
                },
                check() {
                    const mm = this.sys.comps['multimeter'];
                    return mm && mm.mode === 'DIODE' && mm.value > 0.4 && mm.value < 0.7
                        && _sameCluster(this.sys, 'multimeter_wire_v', 'igbt1_wire_e')
                        && _sameCluster(this.sys, 'multimeter_wire_com', 'igbt1_wire_c');
                },
            },
            {
                msg: '4. 将万用表拨到 200kΩ 电阻档，测量 CE 之间电阻（应显示 OL）',
                mode: 'check',
                act() {
                    _disconnectMultimeter(this.sys);
                    const mm = this.sys.comps['multimeter'];
                    if (mm) { mm.mode = 'RES200k'; mm._updateAngleByMode(); mm.update(0); }
                    this.sys.connMgr.addConn({ from: 'multimeter_wire_v', to: 'igbt1_wire_c', type: 'wire' });
                    this.sys.connMgr.addConn({ from: 'multimeter_wire_com', to: 'igbt1_wire_e', type: 'wire' });
                    this.sys.redrawAll();
                },
                check() {
                    const mm = this.sys.comps['multimeter'];
                    return mm && mm.mode === 'RES200k' && mm.value > 200000
                        && _sameCluster(this.sys, 'multimeter_wire_v', 'igbt1_wire_c')
                        && _sameCluster(this.sys, 'multimeter_wire_com', 'igbt1_wire_e');
                },
            },
            {
                msg: '5. 在故障设置中触发"CE 击穿故障"',
                mode: 'check',
                act() {},
                check() {
                    const igbt = this.sys.comps['igbt1'];
                    return igbt && igbt._faultCEShort === true;
                },
            },
            {
                msg: '6. 再次测量 CE 之间电阻（应显示很小，约 1Ω 左右）',
                mode: 'check',
                act() {},
                check() {
                    const mm = this.sys.comps['multimeter'];
                    return mm && mm.value < 10
                        && _sameCluster(this.sys, 'multimeter_wire_v', 'igbt1_wire_c')
                        && _sameCluster(this.sys, 'multimeter_wire_com', 'igbt1_wire_e');
                },
            },
        ],
    },
    'semi-igbt-mf47-test': {
        id: 'semi-igbt-mf47-test',
        name: '3. 用指针万用表检测 IGBT',
        steps: [
            {
                msg: '1. 将指针万用表（MF47）拨到 R×100（Ω×100）档位',
                mode: 'check',
                act() {
                    const mf47 = this.sys.comps['mf47-panel'];
                    if (mf47) { mf47.setRange('OHM100'); }
                },
                check() {
                    const mf47 = this.sys.comps['mf47-panel'];
                    return mf47 && mf47._rangeId === 'OHM100';
                },
            },
            {
                msg: '2. 测量 CE 体二极管正向特性\n黑表笔（COM）接 E，红表笔（V）接 C\n指针应偏转至较小阻值（体二极管导通）',
                mode: 'check',
                act() {
                    _disconnectMF47(this.sys);
                    this.sys.connMgr.addConn({ from: 'mf47-panel_wire_COM', to: 'igbt1_wire_e', type: 'wire' });
                    this.sys.connMgr.addConn({ from: 'mf47-panel_wire_v', to: 'igbt1_wire_c', type: 'wire' });
                    this.sys.redrawAll();
                },
                check() {
                    const mf47 = this.sys.comps['mf47-panel'];
                    return mf47 && mf47._range?.group === 'OHM'
                        && _sameCluster(this.sys, 'mf47-panel_wire_COM', 'igbt1_wire_e')
                        && _sameCluster(this.sys, 'mf47-panel_wire_v', 'igbt1_wire_c');
                },
            },
            {
                msg: '3. 反接测量 CE：黑表笔接 C，红表笔接 E\n应显示 ∞（体二极管反向截止）',
                mode: 'check',
                act() {
                    _disconnectMF47(this.sys);
                    this.sys.connMgr.addConn({ from: 'mf47-panel_wire_COM', to: 'igbt1_wire_c', type: 'wire' });
                    this.sys.connMgr.addConn({ from: 'mf47-panel_wire_v', to: 'igbt1_wire_e', type: 'wire' });
                    this.sys.redrawAll();
                },
                check() {
                    const mf47 = this.sys.comps['mf47-panel'];
                    const igbt = this.sys.comps['igbt1'];
                    return mf47 && mf47._range?.group === 'OHM' && igbt && !igbt._isOn
                        && _sameCluster(this.sys, 'mf47-panel_wire_COM', 'igbt1_wire_c')
                        && _sameCluster(this.sys, 'mf47-panel_wire_v', 'igbt1_wire_e');
                },
            },
            {
                msg: '4. 测量 G-E 之间阻抗：两个方向均应显示 ∞（门极为高阻抗输入）',
                mode: 'check',
                act() {
                    _disconnectMF47(this.sys);
                    this.sys.connMgr.addConn({ from: 'mf47-panel_wire_COM', to: 'igbt1_wire_g', type: 'wire' });
                    this.sys.connMgr.addConn({ from: 'mf47-panel_wire_v', to: 'igbt1_wire_e', type: 'wire' });
                    this.sys.redrawAll();
                },
                check() {
                    const mf47 = this.sys.comps['mf47-panel'];
                    return mf47 && mf47._range?.group === 'OHM'
                        && _sameCluster(this.sys, 'mf47-panel_wire_COM', 'igbt1_wire_g')
                        && _sameCluster(this.sys, 'mf47-panel_wire_v', 'igbt1_wire_e');
                },
            },
            {
                msg: '5. 测试题：IGBT 检测',
                mode: 'quiz',
                quizConfig: {
                    question: '关于 IGBT 的检测，以下说法正确的是？',
                    options: [
                        'IGBT 的门极 G-E 之间可以测得 PN 结正向压降',
                        'IGBT 的 E-C 之间有体二极管，正向可测到约 0.7V 压降',
                        'IGBT 与 MOSFET 检测方法完全不同',
                        'IGBT 的门极加上电压后 C-E 会自锁导通',
                    ],
                    answer: 1,
                    analysis: 'IGBT 的 C-E 间集成有体二极管（类似 MOSFET），正向可测到约 0.4～0.7V 压降。' +
                        '门极为高阻抗输入（MOS 结构），正反向测量均应显示高阻。' +
                        'IGBT 是电压控制器件，无自锁特性，门极电压撤除后关断。',
                },
            },
        ],
    },
};

export const componentConfigs = [
    { Class: DCPower, id: 'psu', x: 10, y: 20, voltage: 24, isOn: false },
    { Class: DCPower, id: 'psu_g', x: 10, y: 450, voltage: 15, isOn: false },
    { Class: Ground, id: 'gnd2', x: 80, y: 300 },
    { Class: Ground, id: 'gnd_g', x: 80, y: 720 },
    { Class: RealResistor, id: 'r1', x: 400, y: 160, value: 1000, rotation: -90 },
    { Class: RealResistor, id: 'rg', x: 350, y: 380, value: 10000, rotation: -90 },
    { Class: RealIGBT, id: 'igbt1', x: 550, y: 320 ,scale: 1.2,rotation:90},
    { Class: RealMosfet, id: 'mos1', x: 780, y: 320, scale: 1.2, rotation:90 },
    { Class: Ground, id: 'gnd', x: 580, y: 480 },

    { Class: Multimeter, id: 'multimeter', x: 850, y: 30, scale: 1.1, visible: false },
    { Class: MF47Multimeter, id: 'mf47-panel', x: 950, y: 480, visible: false },
    { Class: SignalGenerator, id: 'sg', x: 80, y: 400, visible: false },
    { Class: ProcessCalibrator, id: 'cali', x: 550, y: 400, visible: false },
    { Class: Oscilloscope_tri, id: 'osc3', x: 950, y: 60, visible: false },
];

function _doPresetWiring(sys) {
    sys.conns = [];
    const presetConns = [
        { from: 'psu_wire_p', to: 'r1_wire_l', type: 'wire' },
        { from: 'r1_wire_r', to: 'igbt1_wire_c', type: 'wire' },
        { from: 'igbt1_wire_e', to: 'gnd_wire_gnd', type: 'wire' },
        { from: 'psu_wire_n', to: 'gnd2_wire_gnd', type: 'wire' },
        { from: 'psu_g_wire_p', to: 'rg_wire_l', type: 'wire' },
        { from: 'rg_wire_r', to: 'igbt1_wire_g', type: 'wire' },
        { from: 'psu_g_wire_n', to: 'gnd_g_wire_gnd', type: 'wire' },
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
