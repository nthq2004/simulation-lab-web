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
import { SPDTSwitch } from '../components/SPDTSwitch.js';
import { Multimeter } from '../components/Multimeter.js';
import { MF47Multimeter } from '../components/MF47Multimeter.js';
import { Oscilloscope_tri } from '../components/Osc_tri.js';
import { SignalGenerator } from '../components/SignalGenerator.js';
import { ProcessCalibrator } from '../components/ProcessCalibrator.js';
import { ElecMeter } from '../components/ElecMeter.js';

export const FAULT_CONFIGS = {};

export const PROJECT_WORKFLOWS = {
    'nimh-charger': {
        id: 'nimh-charger',
        name: '镍氢电池充放电电路',
        steps: [
            {
                msg: '1. 检查主电路接线：AC 220V → 控制变压器 → 半波整流 → 470µF滤波 → 三极管恒流源(6V稳压) → 镍氢电池充电回路',
                mode: 'check',
                act() {
                    _autoWire(this.sys);
                },
                check() {
                    return true;
                },
            },
            {
                msg: '2. 用万用表测量电池两端电压，观察充电过程。将万用表红表笔接电池正极，黑表笔接电池负极。',
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
                    return c('multimeter_wire_v', 'bt_wire_p')
                        && c('multimeter_wire_com', 'bt_wire_n');
                },
            },
            {
                msg: '3. 切换 SPDT 开关，观察充电电流在 100mA(T1 档)/50mA(T2 档) 两档间变化，LED 亮度随电流变化。',
                mode: 'check',
                check() {
                    const sw = this.sys.comps['sw'];
                    return sw && (sw.getPosition() === 1 || sw.getPosition() === 2);
                },
            },
            {
                msg: '4. 测试题：关于镍氢电池充电',
                mode: 'quiz',
                quizConfig: {
                    question: '镍氢电池（NiMH）单节充满电后的电压约为：',
                    options: [
                        '1.0V',
                        '1.2V',
                        '1.5V',
                        '2.0V',
                    ],
                    answer: 1,
                    analysis: '镍氢电池单节额定电压 1.2V，充满电约 1.25~1.35V，放电终止电压约 1.0V。',
                },
            },
        ],
    },
};

export const componentConfigs = [
    // ── 充电回路（左→右） ──
    { Class: ACPower, id: 'ac', x: 10, y: 220, voltageRMS: 220, frequency: 50, isOn: true },
    { Class: RealControlTransformer, id: 'tr', x: 290, y: 200, primaryVoltage: 220, secondaryVoltage: 12 },
    { Class: Diode, id: 'd1', x: 670, y: 220, rotation: 0 },
    { Class: Capacitor, id: 'c1', x: 780, y: 280, subtype: 'el', capacitance: 470, leak: 10e6, direction: 'vertical' },
    { Class: Resistor, id: 'r1', x: 890, y: 280, value: 5000, rotation: -90 },
    { Class: Zener, id: 'zd', x: 890, y: 440, vForward: 0.7, vZener: 6.0, rotation: -90 },
    { Class: NiMHBattery, id: 'bt', x: 1000, y: 120, capacity: 100, initialSOC: 0.5 },

    // ── 放电回路（电池下方） ──
    { Class: Transistor, id: 'q1', x: 1020, y: 350, subType: 'NPN', beta: 100 },
    { Class: Resistor, id: 'Re', x: 1050, y: 480, value: 2, rotation: -90 },
    { Class: Resistor, id: 'r2', x: 1250, y: 460, value: 1000, rotation: -90 },
    { Class: LED, id: 'led', x: 1250, y: 590, vForward: 2.0, rotation: 0 ,rotation: 90},
    { Class: SPDTSwitch, id: 'sw', x: 900, y: 600, label: 'SA', initPosition: 1, direction: 'reverse' },
    { Class: Resistor, id: 'r3', x: 980, y: 800, value: 51, rotation: -90 },
    { Class: Resistor, id: 'r4', x: 1080, y: 800, value: 100, rotation: -90 },
    // ── 接地 ──
    { Class: Ground, id: 'gnd1', x: 200, y: 440 },
    { Class: Ground, id: 'gnd2', x: 670, y: 440 },
    { Class: Ground, id: 'gnd3', x: 890, y: 540 },
    { Class: Ground, id: 'gnd4', x: 1030,y: 920 },
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

        // ── 充电电流设定：发射极 → Re → 开关 → (R3 / R4) → 地 ──
        { from: 'q1_wire_e', to: 'Re_wire_r', type: 'wire' },
        { from: 'Re_wire_l', to: 'sw_wire_com', type: 'wire' },
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
