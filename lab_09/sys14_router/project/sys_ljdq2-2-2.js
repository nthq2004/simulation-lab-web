// 镍氢电池恒流充电仿真工程
// 电路：AC 220V → 控制变压器(220V/12V) → 半波整流 → 470µF滤波(6V稳压) → 三极管恒流源 → 镍氢电池
//       开关选择充电电流 100mA(T1) / 50mA(T2)，R2+LED 为充电指示

import { ACPower } from '../components/ACPower.js';
import { RealControlTransformer } from '../components/RealControlTransformer.js';
import { Diode } from '../components/Diode.js';
import { Capacitor } from '../components/Capacitor.js';
import { Resistor } from '../components/Resistor.js';
import { Zener } from '../components/Zener.js';
import { NiMHBattery } from '../components/NiMHBattery.js';
import { Ground } from '../components/Gnd.js';
import { Transistor } from '../components/Transistor.js';
import { LED } from '../components/LED.js';
import { DiagramSPDT } from '../components/DiagramSPDT.js';
import { Multimeter } from '../components/Multimeter.js';
import { MF47Multimeter } from '../components/MF47Multimeter.js';
import { Oscilloscope_tri } from '../components/Osc_tri.js';
import { SignalGenerator } from '../components/SignalGenerator.js';
import { ProcessCalibrator } from '../components/ProcessCalibrator.js';
import { ElecMeter } from '../components/ElecMeter.js';

export const FAULT_CONFIGS = {};

export const PROJECT_WORKFLOWS = {
    'nimh-recognize': {
        id: 'nimh-recognize',
        name: '1. 电池充电回路的元器件认识',
        steps: [
            {
                msg: '1. 识别半波整流电路的整流器件：请点击电路中的整流二极管',
                mode: 'find',
                target: 'd1',
            },
            {
                msg: '2. 识别半波整流电路的滤波器件：请点击电路中的滤波电容',
                mode: 'find',
                target: 'c1',
            },
            {
                msg: '3. 识别稳压器件：请点击电路中的稳压二极管',
                mode: 'find',
                target: 'zd',
            },
            {
                msg: '4. 识别电流放大部件：请点击电路中的三极管',
                mode: 'find',
                target: 'q1',
            },
            {
                msg: '5. 识别充电指示灯：请点击电路中的充电指示灯（LED）',
                mode: 'find',
                target: 'led',
            },
            {
                msg: '6. 识别充电电池：请点击电路中的镍氢电池',
                mode: 'find',
                target: 'bt',
            },
            {
                msg: '7. 测试题：稳压二极管工作在什么状态？',
                mode: 'quiz',
                quizConfig: {
                    question: '在本电路中，稳压二极管工作在什么状态？',
                    options: [
                        '反向击穿状态（稳压工作区）',
                        '正向导通状态',
                        '反向截止状态',
                        '饱和导通状态',
                    ],
                    answer: 0,
                    analysis: '稳压二极管工作于反向击穿状态（即稳压工作区）。反向击穿电流在很大范围内变化时，其两端电压基本保持稳定，从而为电路提供稳定的参考电压（本电路约 6V）。',
                },
            },
        ],
    },
    'nimh-charger': {
        id: 'nimh-charger',
        name: '2. 电池恒流充电电路分析',
        steps: [
            {
                msg: '1. 接线，合上电源开关，观察充电指示灯、充电电压、充电电流大小、容量变化。',
                mode: 'check',
                act() {
                    _autoWire(this.sys);
                    const ac = this.sys.comps['ac'];
                    if (ac) { ac.isOn = true; ac.update(); }
                },
                check() {
                    const ac = this.sys.comps['ac'];
                    return ac && ac.isOn;
                },
            },
            {
                msg: '2. 用数字万用表直流电压档，测量滤波电容输出电压。将万用表红表笔接电容正极，黑表笔接地。',
                mode: 'check',
                act() {
                    const mm = this.sys.comps['multimeter'];
                    if (mm) {
                        mm.group.visible(true);
                        mm.mode = 'DCV20';
                    }
                },
                check() {
                    const mm = this.sys.comps['multimeter'];
                    if (!mm || !mm.group || !mm.group.visible()) return false;
                    const c = (a, b) => this.sys.isPortConnected(a, b);
                    return c('multimeter_wire_v', 'c1_wire_l')
                        && (c('multimeter_wire_com', 'c1_wire_r')
                            || c('multimeter_wire_com', 'gnd2_wire_gnd'));
                },
            },
            {
                msg: '3. 测量稳压管两端电压并填空。红表笔接稳压管阴极，黑表笔接阳极。',
                mode: 'fill',
                target: 'zd',
                fields: [
                    { label: '稳压管电压', unit: 'V', answer: 6.0, tolerance: 0.05, placeholder: '请输入稳压管两端电压' },
                ],
            },
            {
                msg: '4. 测量三极管发射极电位，计算充电电流并填入答案（I = Ve / R，R = 53Ω）。',
                mode: 'fill',
                target: 'q1',
                fields: [
                    { label: '发射极电位', unit: 'V', answer: 5.3, tolerance: 0.05, placeholder: '请输入Ve' },
                    { label: '充电电流', unit: 'mA', answer: 100, tolerance: 0.05, placeholder: 'I = Ve / 53Ω' },
                ],
            },
            {
                msg: '5. 将档位开关切换到 T2 档，重新计算充电电流并填空（R = 106Ω）。',
                mode: 'fill',
                target: 'sw',
                ready() {
                    const sw = this.sys.comps['sw'];
                    return sw && sw.getPosition() === 2;
                },
                fields: [
                    { label: '充电电流', unit: 'mA', answer: 50, tolerance: 0.05, placeholder: 'I = Ve / 106Ω' },
                ],
            },
            {
                msg: '6. 测试题：恒流充电的原理',
                mode: 'quiz',
                quizConfig: {
                    question: '关于本电路三极管恒流充电的原理，下列说法正确的是？',
                    options: [
                        '稳压管为基极提供稳定电压，发射极电位基本恒定，充电电流由发射极电阻决定，与电池电压无关',
                        '充电电流取决于电池电压，电池电压越高充电电流越大',
                        '充电电流由整流滤波电压直接决定，随电网电压波动而变化',
                        '三极管的作用是放大充电电流，基极电压越高充电电流越小',
                    ],
                    answer: 0,
                    analysis: '稳压管稳定基极电位（约6V），发射极电位 Ve≈Vz-Vbe≈5.3V 基本恒定，充电电流 I=Ve/R 由发射极电阻决定。电池电压变化时，只要三极管工作在放大区，充电电流基本保持不变，从而实现恒流充电。',
                },
            },
        ],
    },
};

export const componentConfigs = [
    // ── 充电回路（左→右） ──
    { Class: ACPower, id: 'ac', x: 10, y: 100, vRms: 220, freq: 50, isOn: false },
    { Class: RealControlTransformer, id: 'tr', x: 290, y: 200, primaryVoltage: 220, secondaryVoltage: 12 },
    { Class: Diode, id: 'd1', x: 650, y: 250, rotation: 0 },
    { Class: Capacitor, id: 'c1', x: 780, y: 280, subtype: 'el', capacitance: 470, leak: 10e6, direction: 'vertical' },
    { Class: Resistor, id: 'r1', x: 890, y: 250, value: 5000, rotation: -90 },
    { Class: Zener, id: 'zd', x: 890, y: 440, vForward: 0.7, vZener: 6.0, rotation: -90 },
    { Class: NiMHBattery, id: 'bt', x: 1000, y: 160, capacity: 100, initialSOC: 0.5 },

    // ── 放电回路（电池下方） ──
    { Class: Transistor, id: 'q1', x: 1025, y: 395, subType: 'NPN', beta: 100 },
    { Class: Resistor, id: 'r2', x: 1250, y: 490, value: 1000, rotation: -90 },
    { Class: LED, id: 'led', x: 1250, y: 620, vForward: 2.0, rotation: 0 ,rotation: 90},
    { Class: DiagramSPDT, id: 'sw', x: 960, y: 500, label: 'SA', initPosition: 1, direction: 'reverse' },
    { Class: Resistor, id: 'r3', x: 1000, y: 760, value: 53, rotation: -90 },
    { Class: Resistor, id: 'r4', x: 1100, y: 760, value: 106, rotation: -90 },
    // ── 接地 ──
    { Class: Ground, id: 'gnd1', x: 80, y: 440 },
    { Class: Ground, id: 'gnd2', x: 780, y: 440 },
    { Class: Ground, id: 'gnd3', x: 890, y: 540 },
    { Class: Ground, id: 'gnd4', x: 1060,y: 900 },
    { Class: Ground, id: 'gnd5', x: 1250, y: 730 },

    // ── 6 种仪表（必须保留） ──
    { Class: Multimeter, id: 'multimeter', x: 50, y: 50, visible: false },
    { Class: MF47Multimeter, id: 'mf47-panel', x: 50, y: 50, visible: false },
    { Class: Oscilloscope_tri, id: 'osc', x: 50, y: 50, visible: false },
    { Class: SignalGenerator, id: 'sg', x: 50, y: 50, visible: false },
    { Class: ProcessCalibrator, id: 'cali', x: 50, y: 50, visible: false },
    { Class: ElecMeter, id: 'elecmeter', x: 50, y: 50, visible: false },
];

function _autoWire(sys) {
    sys.conns.length = 0;
    const cons = [
        // ── 充电回路 ──
        { from: 'ac_wire_p', to: 'tr_wire_p1', type: 'wire' },
        { from: 'ac_wire_n', to: 'gnd1_wire_gnd', type: 'wire' },
        { from: 'tr_wire_p2', to: 'gnd1_wire_gnd', type: 'wire' },

        { from: 'tr_wire_s1', to: 'd1_wire_l', type: 'wire' },
        { from: 'tr_wire_s2', to: 'gnd2_wire_gnd', type: 'wire' },

        { from: 'd1_wire_r', to: 'c1_wire_l', type: 'wire' },
        { from: 'c1_wire_r', to: 'gnd2_wire_gnd', type: 'wire' },

        { from: 'c1_wire_l', to: 'r1_wire_r', type: 'wire' },
        { from: 'r1_wire_l', to: 'zd_wire_r', type: 'wire' },
        { from: 'zd_wire_l', to: 'gnd3_wire_gnd', type: 'wire' },
        { from: 'r1_wire_r', to: 'bt_wire_p', type: 'wire' },
        { from: 'bt_wire_n', to: 'q1_wire_c', type: 'wire' },


        { from: 'zd_wire_r', to: 'q1_wire_b', type: 'wire' },

        // ── 指示支路：发射极 → R2 → LED → 独立地 ──
        { from: 'q1_wire_e', to: 'r2_wire_r', type: 'wire' },
        { from: 'r2_wire_l', to: 'led_wire_l', type: 'wire' },
        { from: 'led_wire_r', to: 'gnd5_wire_gnd', type: 'wire' },

        // ── 充电电流设定：发射极 → 开关 → (R3 / R4) → 地 ──
        { from: 'q1_wire_e', to: 'sw_wire_com', type: 'wire' },
        { from: 'sw_wire_t1', to: 'r3_wire_r', type: 'wire' },
        { from: 'sw_wire_t2', to: 'r4_wire_r', type: 'wire' },
        { from: 'r3_wire_l', to: 'gnd4_wire_gnd', type: 'wire' },
        { from: 'r4_wire_l', to: 'gnd4_wire_gnd', type: 'wire' },
    ];
    cons.forEach(c => sys.connMgr.addConn(c));
    sys.redrawAll();
}

export function initSlider(_sys) { }

export function applyAllPresets() {
    const sys = this && this.sys ? this.sys : window.sys;
    if (!sys) return;
    _autoWire(sys);
}

export async function applyStartSystem() {
    const sys = this && this.sys ? this.sys : window.sys;
    if (!sys) return;
    _autoWire(sys);
}

export function fiveStep() { }
