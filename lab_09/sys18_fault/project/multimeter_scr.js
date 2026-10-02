// 半导体器件仿真项目 — 万用表测量晶闸管触发特性
// 电路：24V → 1kΩ → SCR(A)  SCR(K)→ GND
//         门极 G → 100kΩ → 开关(12V)

import { DCPower } from '../components/DCPower.js';
import { RealResistor } from '../components/RealResistor.js';
import { Ground } from '../components/Gnd.js';
import { Multimeter } from '../components/Multimeter.js';
import { MF47Multimeter } from '../components/MF47Multimeter.js';
import { SignalGenerator } from '../components/SignalGenerator.js';
import { ProcessCalibrator } from '../components/ProcessCalibrator.js';
import { Oscilloscope_tri } from '../components/Osc_tri.js';
import { RealScr } from '../components/RealScr.js';

export const FAULT_CONFIGS = {
    ak_short: {
        id: 'ak_short',
        name: 'AK 击穿故障',
        system: '晶闸管',
        check() {
            const c = window.sys && window.sys.comps && window.sys.comps['scr1'];
            return c && c._faultAKShort;
        },
        trigger() {
            const c = window.sys && window.sys.comps && window.sys.comps['scr1'];
            if (c) c._faultAKShort = true;
        },
        repair() {
            const c = window.sys && window.sys.comps && window.sys.comps['scr1'];
            if (c) c._faultAKShort = false;
        },
    },
    gate_open: {
        id: 'gate_open',
        name: '门极开路故障',
        system: '晶闸管',
        check() {
            const c = window.sys && window.sys.comps && window.sys.comps['scr1'];
            return c && c._faultGateOpen;
        },
        trigger() {
            const c = window.sys && window.sys.comps && window.sys.comps['scr1'];
            if (c) c._faultGateOpen = true;
        },
        repair() {
            const c = window.sys && window.sys.comps && window.sys.comps['scr1'];
            if (c) c._faultGateOpen = false;
        },
    },
};

export const PROJECT_WORKFLOWS = {
    'semi-scr-trigger': {
        id: 'semi-scr-trigger',
        name: '1. 晶闸管触发特性测量',
        steps: [
            {
                msg: '1. 接通主电路：直流电源正极→电阻→晶闸管阳极，阴极接地',
                mode: 'check',
                act() {
                    _doPresetWiring(this.sys);
                },
                check() {
                    const conns = this.sys.conns || [];
                    const has = (a, b) => conns.some(c => (c.from === a && c.to === b) || (c.from === b && c.to === a));
                    return has('psu_wire_p', 'r1_wire_l')
                        && has('r1_wire_r', 'scr1_wire_a')
                        && has('scr1_wire_k', 'gnd_wire_gnd');
                },
            },
            {
                msg: '2. 接通门极触发电路：触发电源正极→100kΩ电阻→门极G',
                mode: 'check',
                act() {},
                check() {
                    const conns = this.sys.conns || [];
                    const has = (a, b) => conns.some(c => (c.from === a && c.to === b) || (c.from === b && c.to === a));
                    return has('psu_g_wire_p', 'rg_wire_l')
                        && has('rg_wire_r', 'scr1_wire_g');
                },
            },
            {
                msg: '3. 将万用表拨到 DCV200 档，红黑表笔接晶闸管 A-K 两端',
                mode: 'check',
                act() {
                    const mm = this.sys.comps['multimeter'];
                    if (mm) { mm.mode = 'DCV200'; mm._updateAngleByMode(); mm.update(0); }
                    _disconnectMultimeter(this.sys);
                    this.sys.connMgr.addConn({ from: 'multimeter_wire_v', to: 'scr1_wire_a', type: 'wire' });
                    this.sys.connMgr.addConn({ from: 'multimeter_wire_com', to: 'scr1_wire_k', type: 'wire' });
                    this.sys.redrawAll();
                },
                check() {
                    const mm = this.sys.comps['multimeter'];
                    return mm && mm.mode === 'DCV200'
                        && _sameCluster(this.sys, 'multimeter_wire_v', 'scr1_wire_a')
                        && _sameCluster(this.sys, 'multimeter_wire_com', 'scr1_wire_k');
                },
            },
            {
                msg: '4. 接通主电路电源（24V），观察 AK 两端电压（未触发时 ≈ 24V）',
                mode: 'check',
                act() {
                    const psu = this.sys.comps['psu'];
                    if (psu) { psu.isOn = true; psu.voltage = 24; psu.update(); }
                },
                check() {
                    const psu = this.sys.comps['psu'];
                    const vAK = this.sys.getVoltageBetween('scr1_wire_a', 'scr1_wire_k');
                    return psu && psu.isOn && vAK !== undefined && vAK > 20;
                },
            },
            {
                msg: '5. 接通控制电路电源（12V触发门极），观察 AK 电压（导通后 ≈ 1V）',
                mode: 'check',
                act() {
                    const psuG = this.sys.comps['psu_g'];
                    if (psuG) { psuG.isOn = true; psuG.voltage = 12; psuG.update(); }
                },
                check() {
                    const scr = this.sys.comps['scr1'];
                    const psuG = this.sys.comps['psu_g'];
                    const vAK = this.sys.getVoltageBetween('scr1_wire_a', 'scr1_wire_k');
                    return scr && scr._triggered === true
                        && psuG && psuG.isOn === true
                        && vAK !== undefined && vAK < 1.5;
                },
            },
            {
                msg: '6. 切断控制电路电源，观察 AK 电压（应保持 ≈ 1V，验证自锁特性）',
                mode: 'check',
                act() {
                    const psuG = this.sys.comps['psu_g'];
                    if (psuG) { psuG.isOn = false; psuG.voltage = 0; psuG.update(); }
                },
                check() {
                    const scr = this.sys.comps['scr1'];
                    const psuG = this.sys.comps['psu_g'];
                    const vAK = this.sys.getVoltageBetween('scr1_wire_a', 'scr1_wire_k');
                    return scr && scr._triggered === true
                        && psuG && psuG.isOn === false
                        && vAK !== undefined && vAK < 1.5;
                },
            },
            {
                msg: '7. 切断主电路电源再接通，观察 AK 电压（恢复 ≈ 24V，说明已关断）',
                mode: 'check',
                act() {
                    const psu = this.sys.comps['psu'];
                    if (psu) { psu.isOn = false; psu.update(); }
                    setTimeout(() => {
                        if (psu) { psu.isOn = true; psu.voltage = 24; psu.update(); }
                    }, 500);
                },
                check() {
                    const vAK = this.sys.getVoltageBetween('scr1_wire_a', 'scr1_wire_k');
                    return vAK !== undefined && vAK > 20;
                },
            },
            {
                msg: '8. 测试题：晶闸管特性',
                mode: 'quiz',
                quizConfig: {
                    question: '晶闸管（SCR）导通后，门极信号消失，以下描述正确的是？',
                    options: [
                        'SCR 立即关断',
                        'SCR 保持导通（自锁）',
                        'SCR 变为高阻态',
                        'SCR 反向导通'
                    ],
                    answer: 1,
                    analysis: '晶闸管一旦被触发导通，即使门极信号消失，仍能维持导通状态（自锁特性）。只有当阳极电流降至维持电流以下时才会关断。',
                },
            },
        ],
    },
    'semi-scr-diode-test': {
        id: 'semi-scr-diode-test',
        name: '2. 用数字万用表检测晶闸管',
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
                msg: '2. 红表笔接 G，黑表笔接 K，测量 GK 正向导通电压（应显示约 0.7V）',
                mode: 'check',
                act() {
                    this.sys.connMgr.addConn({ from: 'multimeter_wire_v', to: 'scr1_wire_g', type: 'wire' });
                    this.sys.connMgr.addConn({ from: 'multimeter_wire_com', to: 'scr1_wire_k', type: 'wire' });
                    this.sys.redrawAll();
                },
                check() {
                    const mm = this.sys.comps['multimeter'];
                    return mm && mm.mode === 'DIODE' && mm.value === 0.6868
                        && _sameCluster(this.sys, 'multimeter_wire_v', 'scr1_wire_g')
                        && _sameCluster(this.sys, 'multimeter_wire_com', 'scr1_wire_k');
                },
            },
            {
                msg: '3. 反向测量 GK：红表笔接 K，黑表笔接 G，应显示 OL（溢出）',
                mode: 'check',
                act() {
                    _disconnectMultimeter(this.sys);
                    this.sys.connMgr.addConn({ from: 'multimeter_wire_v', to: 'scr1_wire_k', type: 'wire' });
                    this.sys.connMgr.addConn({ from: 'multimeter_wire_com', to: 'scr1_wire_g', type: 'wire' });
                    this.sys.redrawAll();
                },
                check() {
                    const mm = this.sys.comps['multimeter'];
                    return mm && mm.mode === 'DIODE' && mm.value > 50
                        && _sameCluster(this.sys, 'multimeter_wire_v', 'scr1_wire_k')
                        && _sameCluster(this.sys, 'multimeter_wire_com', 'scr1_wire_g');
                },
            },
            {
                msg: '4. 将万用表拨到 200kΩ 电阻档，测量 AK 之间电阻（应显示 OL）',
                mode: 'check',
                act() {
                    _disconnectMultimeter(this.sys);
                    const mm = this.sys.comps['multimeter'];
                    if (mm) { mm.mode = 'RES200k'; mm._updateAngleByMode(); mm.update(0); }
                    this.sys.connMgr.addConn({ from: 'multimeter_wire_v', to: 'scr1_wire_a', type: 'wire' });
                    this.sys.connMgr.addConn({ from: 'multimeter_wire_com', to: 'scr1_wire_k', type: 'wire' });
                    this.sys.redrawAll();
                },
                check() {
                    const mm = this.sys.comps['multimeter'];
                    return mm && mm.mode === 'RES200k' && mm.value > 200000
                        && _sameCluster(this.sys, 'multimeter_wire_v', 'scr1_wire_a')
                        && _sameCluster(this.sys, 'multimeter_wire_com', 'scr1_wire_k');
                },
            },
            {
                msg: '5. 在故障设置中触发"AK 击穿故障"',
                mode: 'check',
                act() {},
                check() {
                    const scr = this.sys.comps['scr1'];
                    return scr && scr._faultAKShort === true;
                },
            },
            {
                msg: '6. 再次测量 AK 之间电阻（应显示很小，约 1Ω 左右）',
                mode: 'check',
                act() {},
                check() {
                    const mm = this.sys.comps['multimeter'];
                    return mm && mm.value < 10
                        && _sameCluster(this.sys, 'multimeter_wire_v', 'scr1_wire_a')
                        && _sameCluster(this.sys, 'multimeter_wire_com', 'scr1_wire_k');
                },
            },
        ],
    },
    'semi-scr-mf47-test': {
        id: 'semi-scr-mf47-test',
        name: '3. 用指针万用表检测晶闸管',
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
                msg: '2. 黑表笔（COM/+）接 G，红表笔（V/−）接 K\n测量 GK 正向电阻（应显示约 1k～2kΩ）',
                mode: 'check',
                act() {
                    _disconnectMF47(this.sys);
                    this.sys.connMgr.addConn({ from: 'mf47-panel_wire_COM', to: 'scr1_wire_g', type: 'wire' });
                    this.sys.connMgr.addConn({ from: 'mf47-panel_wire_v', to: 'scr1_wire_k', type: 'wire' });
                    this.sys.redrawAll();
                },
                check() {
                    const mf47 = this.sys.comps['mf47-panel'];
                    const vGK = this.sys.getVoltageBetween('scr1_wire_g', 'scr1_wire_k');
                    return mf47 && mf47._range?.group === 'OHM'
                        && _sameCluster(this.sys, 'mf47-panel_wire_COM', 'scr1_wire_g')
                        && _sameCluster(this.sys, 'mf47-panel_wire_v', 'scr1_wire_k')
                        && vGK !== undefined && vGK > 0.5;
                },
            },
            {
                msg: '3. 黑表笔接 K，红表笔接 G\n测量 GK 反向电阻（应显示 ∞，表针不动）',
                mode: 'check',
                act() {
                    _disconnectMF47(this.sys);
                    this.sys.connMgr.addConn({ from: 'mf47-panel_wire_COM', to: 'scr1_wire_k', type: 'wire' });
                    this.sys.connMgr.addConn({ from: 'mf47-panel_wire_v', to: 'scr1_wire_g', type: 'wire' });
                    this.sys.redrawAll();
                },
                check() {
                    const mf47 = this.sys.comps['mf47-panel'];
                    const vGK = this.sys.getVoltageBetween('scr1_wire_g', 'scr1_wire_k');
                    return mf47 && mf47._range?.group === 'OHM'
                        && _sameCluster(this.sys, 'mf47-panel_wire_COM', 'scr1_wire_k')
                        && _sameCluster(this.sys, 'mf47-panel_wire_v', 'scr1_wire_g')
                        && vGK !== undefined && vGK < 0;
                },
            },
            {
                msg: '4. 黑表笔（COM/+）接 A，红表笔（V/−）接 K\n测量 AK 电阻（未触发应显示 ∞）',
                mode: 'check',
                act() {
                    _disconnectMF47(this.sys);
                    this.sys.connMgr.addConn({ from: 'mf47-panel_wire_COM', to: 'scr1_wire_a', type: 'wire' });
                    this.sys.connMgr.addConn({ from: 'mf47-panel_wire_v', to: 'scr1_wire_k', type: 'wire' });
                    this.sys.redrawAll();
                },
                check() {
                    const mf47 = this.sys.comps['mf47-panel'];
                    const scr = this.sys.comps['scr1'];
                    return mf47 && mf47._range?.group === 'OHM' && scr && !scr._triggered
                        && _sameCluster(this.sys, 'mf47-panel_wire_COM', 'scr1_wire_a')
                        && _sameCluster(this.sys, 'mf47-panel_wire_v', 'scr1_wire_k');
                },
            },
            {
                msg: '5. 保持 A-K 测量，用导线短接 A-G 约 1 秒后断开\n（晶闸管触发导通，AK 阻值应变为很小，断开后仍保持）',
                mode: 'check',
                async act() {
                    this.sys.connMgr.addConn({ from: 'scr1_wire_a', to: 'scr1_wire_g', type: 'wire' });
                    this.sys.redrawAll();
                    await new Promise(r => setTimeout(r, 1200));
                    _removeConn(this.sys, 'scr1_wire_a', 'scr1_wire_g');
                    this.sys.redrawAll();
                },
                check() {
                    const mf47 = this.sys.comps['mf47-panel'];
                    const scr = this.sys.comps['scr1'];
                    return mf47 && mf47._range?.group === 'OHM' && scr && scr._triggered === true
                        && _sameCluster(this.sys, 'mf47-panel_wire_COM', 'scr1_wire_a')
                        && _sameCluster(this.sys, 'mf47-panel_wire_v', 'scr1_wire_k')
                        && !_sameCluster(this.sys, 'scr1_wire_a', 'scr1_wire_g');
                },
            },
            {
                msg: '6. 测试题：晶闸管检测',
                mode: 'quiz',
                quizConfig: {
                    question: '用指针万用表 R×100 档检测晶闸管，以下操作和结果描述正确的是？',
                    options: [
                        '黑表笔接 G、红表笔接 K 时 GK 正向导通，指针偏转至较小阻值',
                        '红表笔接 G、黑表笔接 K 时 GK 正向导通，指针偏转至较小阻值',
                        '黑表笔接 A、红表笔接 K 测 AK，短接 A-G 触发后断开，AK 阻值恢复高阻',
                        '无论怎样测量，AK 阻值始终为无穷大',
                    ],
                    answer: 0,
                    analysis: '指针万用表电阻档内部电池正极接黑表笔（COM），负极接红表笔（V）。' +
                        '因此黑笔接 G、红笔接 K 时 GK 正偏导通。触发后 AK 阻值变小，且因自锁特性，断开触发后仍保持低阻。',
                },
            },
        ],
    },
};

export const componentConfigs = [
    { Class: DCPower, id: 'psu', x: 10, y: 50, voltage: 24, isOn: false },
    { Class: DCPower, id: 'psu_g', x: 10, y: 500, voltage: 12, isOn: false },
    { Class: Ground, id: 'gnd2', x: 80, y: 300 },
    { Class: Ground, id: 'gnd_g', x: 80, y: 720 },
    { Class: RealResistor, id: 'r1', x: 400, y: 260, value: 1000, rotation: -90 },
    { Class: RealResistor, id: 'rg', x: 350, y: 580, value: 100000, rotation: -90 },
    { Class: RealScr, id: 'scr1', x: 550, y: 320 },
    { Class: Ground, id: 'gnd', x: 680, y: 380 },

    { Class: Multimeter, id: 'multimeter', x: 850, y: 30, scale: 1.1 ,  visible: false},
    { Class: MF47Multimeter, id: 'mf47-panel', x: 950, y: 480,  visible: false},
    { Class: SignalGenerator, id: 'sg', x: 80, y: 400, visible: false },
    { Class: ProcessCalibrator, id: 'cali', x: 550, y: 400, visible: false },
    { Class: Oscilloscope_tri, id: 'osc3', x: 950, y: 60, visible: false },
];

function _doPresetWiring(sys) {
    sys.conns = [];
    const presetConns = [
        { from: 'psu_wire_p', to: 'r1_wire_l', type: 'wire' },
        { from: 'r1_wire_r', to: 'scr1_wire_a', type: 'wire' },
        { from: 'scr1_wire_k', to: 'gnd_wire_gnd', type: 'wire' },
        { from: 'psu_wire_n', to: 'gnd2_wire_gnd', type: 'wire' },
        { from: 'psu_g_wire_p', to: 'rg_wire_l', type: 'wire' },
        { from: 'rg_wire_r', to: 'scr1_wire_g', type: 'wire' },
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

function _hasConn(sys, a, b) {
    return sys.conns.some(c => (c.from === a && c.to === b) || (c.from === b && c.to === a));
}

function _sameCluster(sys, portA, portB) {
    const map = sys.voltageSolver?.portToCluster;
    if (!map) return false;
    const cA = map.get(portA);
    const cB = map.get(portB);
    return cA !== undefined && cA === cB;
}

function _removeConn(sys, from, to) {
    const idx = sys.conns.findIndex(c =>
        (c.from === from && c.to === to) || (c.from === to && c.to === from));
    if (idx >= 0) sys.connMgr.removeConn(sys.conns[idx]);
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
