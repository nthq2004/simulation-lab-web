// 半导体器件仿真项目 — 发光二极管(LED)应用电路
// 电路：12V → 330Ω 限流电阻 → LED(2V) → GND
// LED 正向压降约 2V，工作电流约 30mA

import { DCPower } from '../components/DCPower.js';
import { RealResistor } from '../components/RealResistor.js';
import { RealVariResistor } from '../components/RealVariResistor.js';
import { Ground } from '../components/Gnd.js';
import { Multimeter } from '../components/Multimeter.js';
import { MF47Multimeter } from '../components/MF47Multimeter.js';
import { SignalGenerator } from '../components/SignalGenerator.js';
import { ProcessCalibrator } from '../components/ProcessCalibrator.js';
import { AmpMeter } from '../components/AmpMeter.js';
import { RealLED } from '../components/RealLED.js';
import { Oscilloscope_tri } from '../components/Osc_tri.js';

export const FAULT_CONFIGS = {
    led_open: {
        id: 'led_open',
        name: 'LED 开路故障',
        system: 'LED',
        check() {
            const c = window.sys && window.sys.comps && window.sys.comps['led1'];
            return c && c._faultOpen;
        },
        trigger() {
            const c = window.sys && window.sys.comps && window.sys.comps['led1'];
            if (c) c._faultOpen = true;
        },
        repair() {
            const c = window.sys && window.sys.comps && window.sys.comps['led1'];
            if (c) c._faultOpen = false;
        },
    },
    led_short: {
        id: 'led_short',
        name: 'LED 击穿短路',
        system: 'LED',
        check() {
            const c = window.sys && window.sys.comps && window.sys.comps['led1'];
            return c && c._faultShort;
        },
        trigger() {
            const c = window.sys && window.sys.comps && window.sys.comps['led1'];
            if (c) c._faultShort = true;
        },
        repair() {
            const c = window.sys && window.sys.comps && window.sys.comps['led1'];
            if (c) c._faultShort = false;
        },
    },
};

export const PROJECT_WORKFLOWS = {
    'led-basic': {
        id: 'led-basic',
        name: '1. LED 基本电路搭建',
        steps: [
            {
                msg: '1. 接通主回路：直流电源正极→330Ω 限流电阻→LED 阳极（正极）',
                mode: 'check',
                act() {
                    _doPresetWiring(this.sys);
                },
                check() {
                    const conns = this.sys.conns || [];
                    const has = (a, b) => conns.some(c => (c.from === a && c.to === b) || (c.from === b && c.to === a));
                    return has('psu_wire_p', 'r1_wire_l')
                        && has('r1_wire_r', 'led1_wire_l');
                },
            },
            {
                msg: '2. 将 LED 阴极（负极）接地',
                mode: 'check',
                act() {},
                check() {
                    const conns = this.sys.conns || [];
                    const has = (a, b) => conns.some(c => (c.from === a && c.to === b) || (c.from === b && c.to === a));
                    return has('led1_wire_r', 'gnd1_wire_gnd');
                },
            },
            {
                msg: '3. 将万用表拨到 DCV20 档，红表笔接 LED 阳极，黑表笔接地，测量 LED 两端电压',
                mode: 'check',
                act() {
                    _disconnectMultimeter(this.sys);
                    const mm = this.sys.comps['multimeter'];
                    if (mm) { mm.mode = 'DCV20'; mm._updateAngleByMode(); mm.update(0); }
                    this.sys.connMgr.addConn({ from: 'multimeter_wire_v', to: 'r1_wire_r', type: 'wire' });
                    this.sys.connMgr.addConn({ from: 'multimeter_wire_com', to: 'gnd1_wire_gnd', type: 'wire' });
                    this.sys.redrawAll();
                },
                check() {
                    const mm = this.sys.comps['multimeter'];
                    return mm && mm.mode === 'DCV20'
                        && _sameCluster(this.sys, 'multimeter_wire_v', 'r1_wire_r')
                        && _sameCluster(this.sys, 'multimeter_wire_com', 'gnd1_wire_gnd');
                },
            },
            {
                msg: '4. 接通电源（12V），观察万用表读数——LED 正向压降应稳定在约 2V',
                mode: 'check',
                act() {
                    const psu = this.sys.comps['psu'];
                    if (psu) { psu.isOn = true; psu.voltage = 12; psu.update(); }
                },
                check() {
                    const psu = this.sys.comps['psu'];
                    const vLed = this.sys.getVoltageBetween('r1_wire_r', 'gnd1_wire_gnd');
                    return psu && psu.isOn && vLed !== undefined && vLed > 1.5 && vLed < 2.5;
                },
            },
            {
                msg: '5. 测试题：LED 发光原理',
                mode: 'quiz',
                quizConfig: {
                    question: '发光二极管（LED）正常发光时的工作状态是？',
                    options: [
                        '反向击穿状态',
                        '正向导通状态，两端电压约为其正向压降（通常 1.8~3.3V）',
                        '零偏置状态',
                        'LED 不需要特定偏置即可发光',
                    ],
                    answer: 1,
                    analysis: 'LED 工作在正向偏置状态，当正向电压超过其导通阈值时，' +
                        'PN 结注入的载流子复合产生光子而发光。' +
                        '必须串联限流电阻控制电流，防止 LED 烧毁。',
                },
            },
        ],
    },
    'led-current-measure': {
        id: 'led-current-measure',
        name: '2. LED 电流测量与分析',
        steps: [
            {
                msg: '1. 断开电源，将电流表串联接入 LED 支路（电流表正端接限流电阻输出，负端接 LED 阳极）',
                mode: 'check',
                act() {
                    const psu = this.sys.comps['psu'];
                    if (psu) { psu.isOn = false; psu.update(); }
                    _disconnectAmmeter(this.sys);
                    const amp = this.sys.comps['ampmeter'];
                    if (amp) { amp.update(0); }
                    this.sys.connMgr.addConn({ from: 'r1_wire_r', to: 'ampmeter_wire_p', type: 'wire' });
                    this.sys.connMgr.addConn({ from: 'ampmeter_wire_n', to: 'led1_wire_l', type: 'wire' });
                    this.sys.redrawAll();
                },
                check() {
                    return _sameCluster(this.sys, 'r1_wire_r', 'ampmeter_wire_p')
                        && _sameCluster(this.sys, 'ampmeter_wire_n', 'led1_wire_l');
                },
            },
            {
                msg: '2. 【5点步进-1】限流电阻 10kΩ，理论电流 I = (12V-2V)/10kΩ = 1mA，观察 LED 微亮',
                mode: 'check',
                act() {
                    _setResistor(this.sys, 'r1', 10000);
                    const psu = this.sys.comps['psu'];
                    if (psu) { psu.isOn = true; psu.voltage = 12; psu.update(); }
                },
                check() {
                    const r1 = this.sys.comps['r1'];
                    return r1 && Math.abs(r1.currentResistance - 10000) < 100;
                },
            },
            {
                msg: '3. 【5点步进-2】限流电阻 2kΩ，理论电流 I = (12V-2V)/2kΩ = 5mA，LED 够亮',
                mode: 'check',
                act() {
                    _setResistor(this.sys, 'r1', 2000);
                },
                check() {
                    const r1 = this.sys.comps['r1'];
                    return r1 && Math.abs(r1.currentResistance - 2000) < 50;
                },
            },
            {
                msg: '4. 【5点步进-3】限流电阻 1kΩ，理论电流 I = (12V-2V)/1kΩ = 10mA，LED 最亮',
                mode: 'check',
                act() {
                    _setResistor(this.sys, 'r1', 1000);
                },
                check() {
                    const r1 = this.sys.comps['r1'];
                    return r1 && Math.abs(r1.currentResistance - 1000) < 30;
                },
            },
            {
                msg: '5. 【5点步进-4】限流电阻 330Ω，理论电流 I = (12V-2V)/330Ω ≈ 30mA，LED 正常驱动电流',
                mode: 'check',
                act() {
                    _setResistor(this.sys, 'r1', 330);
                },
                check() {
                    const r1 = this.sys.comps['r1'];
                    return r1 && Math.abs(r1.currentResistance - 330) < 10;
                },
            },
            {
                msg: '6. 【5点步进-5】限流电阻 100Ω，理论电流 I = (12V-2V)/100Ω = 100mA，LED 过流烧毁！',
                mode: 'check',
                act() {
                    _setResistor(this.sys, 'r1', 100);
                },
                check() {
                    const r1 = this.sys.comps['r1'];
                    return r1 && Math.abs(r1.currentResistance - 100) < 5;
                },
            },
            {
                msg: '7. 测试题：LED 限流电阻计算',
                mode: 'quiz',
                quizConfig: {
                    question: '已知电源电压 12V，LED 正向压降 2V，工作电流 20mA，应选用多大限流电阻？',
                    options: [
                        '100Ω',
                        '500Ω',
                        '1kΩ',
                        '10kΩ',
                    ],
                    answer: 1,
                    analysis: 'R = (Vcc - Vf) / If = (12V - 2V) / 0.02A = 500Ω。' +
                        '实际可选标准值 510Ω 或 560Ω，保证电流不超过 LED 额定值。',
                },
            },
        ],
    },
    'led-mf47-test': {
        id: 'led-mf47-test',
        name: '3. 用指针万用表测试发光二极管',
        steps: [
            {
                msg: '1. 将指针万用表（MF47）拨到 R×10K 档位',
                mode: 'check',
                act() {
                    const mf47 = this.sys.comps['mf47-panel'];
                    if (mf47) { mf47.setRange('OHM10K'); }
                    _disconnectMF47(this.sys);
                },
                check() {
                    const mf47 = this.sys.comps['mf47-panel'];
                    return mf47 && mf47._rangeId === 'OHM10K';
                },
            },
            {
                msg: '2. 红表笔（V）接 LED 阳极（正极），黑表笔（COM）接阴极（负极）\n测量正向电阻，应显示较小阻值（PN 结正向导通，LED 微微发光）',
                mode: 'check',
                act() {
                    this.sys.connMgr.addConn({ from: 'mf47-panel_wire_COM', to: 'led1_wire_l', type: 'wire' });
                    this.sys.connMgr.addConn({ from: 'mf47-panel_wire_v', to: 'led1_wire_r', type: 'wire' });
                    this.sys.redrawAll();
                },
                check() {
                    return _sameCluster(this.sys, 'mf47-panel_wire_COM', 'led1_wire_l')
                        && _sameCluster(this.sys, 'mf47-panel_wire_v', 'led1_wire_r');
                },
            },
            {
                msg: '3. 反接表笔：红表笔接阴极（负极），黑表笔接阳极（正极）\n测量反向电阻，应显示 ∞（反向截止，LED 不发光）',
                mode: 'check',
                act() {
                    _disconnectMF47(this.sys);
                    this.sys.connMgr.addConn({ from: 'mf47-panel_wire_COM', to: 'led1_wire_r', type: 'wire' });
                    this.sys.connMgr.addConn({ from: 'mf47-panel_wire_v', to: 'led1_wire_l', type: 'wire' });
                    this.sys.redrawAll();
                },
                check() {
                    return _sameCluster(this.sys, 'mf47-panel_wire_COM', 'led1_wire_r')
                        && _sameCluster(this.sys, 'mf47-panel_wire_v', 'led1_wire_l');
                },
            },
            {
                msg: '4. 测试题：LED 检测',
                mode: 'quiz',
                quizConfig: {
                    question: '用指针万用表电阻档检测 LED 时，以下说法正确的是？',
                    options: [
                        '正反向测量电阻都很小，说明 LED 正常',
                        '正向导通（LED 微亮）、反向截止，与普通二极管检测方法相同',
                        'LED 无法用万用表检测',
                        'LED 不需要区分正负极',
                    ],
                    answer: 1,
                    analysis: 'LED 本质上是一个 PN 结发光二极管，其单向导电性与普通二极管一致。' +
                        '用万用表 R×100 档正向测量时，表内电池（1.5V）可使 LED 导通并微微发光；' +
                        '反向测量时则截止。注意 LED 的正向压降（1.8~3.3V）高于普通二极管（0.7V），' +
                        '有些 LED 在 R×1 档（1.5V）下可能无法导通，需使用 R×10k 档（9V 或 15V 电池）。',
                },
            },
        ],
    },
};

export const componentConfigs = [
    { Class: DCPower, id: 'psu', x: 10, y: 20, voltage: 12, isOn: false },
    { Class: Ground, id: 'gnd1', x: 200, y: 280 },
    { Class: RealResistor, id: 'r1', x: 350, y: 100, value: 330, rotation: -90 },
    { Class: RealLED, id: 'led1', x: 500, y: 180, vForward: 2.0, rotation: 90 },

    { Class: Multimeter, id: 'multimeter', x: 850, y: 30, scale: 1.1, visible: false },
    { Class: SignalGenerator, id: 'sg', x: 80, y: 400, visible: false },
    { Class: ProcessCalibrator, id: 'cali', x: 550, y: 400, visible: false },
    { Class: AmpMeter, id: 'ampmeter', x: 650, y: 30, visible: false },
    { Class: MF47Multimeter, id: 'mf47-panel', x: 950, y: 480, visible: false },
    { Class: Oscilloscope_tri, id: 'osc3', x: 950, y: 60, visible: false },
];

function _doPresetWiring(sys) {
    sys.conns = [];
    const presetConns = [
        { from: 'psu_wire_p', to: 'r1_wire_l', type: 'wire' },
        { from: 'r1_wire_r', to: 'led1_wire_l', type: 'wire' },
        { from: 'led1_wire_r', to: 'gnd1_wire_gnd', type: 'wire' },
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

function _disconnectAmmeter(sys) {
    const ports = ['ampmeter_wire_p', 'ampmeter_wire_n'];
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
    if (psu) { psu.isOn = true; psu.voltage = 12; psu.update(); }
}

export function fiveStep() {
    const sys = this.sys;
    const step = (sys._fiveStepIndex = (sys._fiveStepIndex || 0) % 5) + 1;
    sys._fiveStepIndex = step;

    const resistors = [10000, 2000, 1000, 330, 100];
    const labels = ['10kΩ(1mA)', '2kΩ(5mA)', '1kΩ(10mA)', '330Ω(30mA)', '100Ω(100mA)'];
    const idx = step - 1;

    _setResistor(sys, 'r1', resistors[idx]);
    const psu = sys.comps['psu'];
    if (psu) { psu.isOn = true; psu.voltage = 12; psu.update(); }

    _showTooltip(sys, `5点步进 ${step}/5：限流电阻 = ${labels[idx]}，I = (12V-2V)/${resistors[idx]}Ω`);
}

function _setResistor(sys, id, value) {
    const r = sys.comps[id];
    if (r) {
        r.currentResistance = value;
        r.onConfigUpdate({ currentResistance: value, tolerance: r.tolerance || 1 });
    }
}

function _showTooltip(sys, msg) {
    if (sys.uiManager) {
        sys.uiManager.showFloatingTip(msg, 3000);
    }
}
