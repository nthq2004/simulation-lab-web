// 三相空气断路器仿真工程

import { DiagramACPower3P } from '../components/DiagramACPower3P.js';
import { DiagramThreePhaseACB } from '../components/DiagramThreePhaseACB.js';
import { InductionMotor2 } from '../components/InductionMotor2.js';
import { Multimeter } from '../components/Multimeter.js';
import { MF47Multimeter } from '../components/MF47Multimeter.js';
import { Oscilloscope_tri } from '../components/Osc_tri.js';
import { SignalGenerator } from '../components/SignalGenerator.js';
import { ProcessCalibrator } from '../components/ProcessCalibrator.js';
import { ElecMeter } from '../components/ElecMeter.js';
import { TsCurveDisplay } from '../components/TsCurveDisplay.js';
import { SinglePhaseFuse } from '../components/SinglePhaseFuse.js';
import { DiagramStopButton } from '../components/DiagramStopButton.js';
import { DiagramStartButton } from '../components/DiagramStartButton.js';

import { ControlTransformer } from '../device/ControlTransformer.js';
import { MainContact } from '../device/MainContact.js';
import { ContactorCoil } from '../device/ContactorCoil.js';
import { AuxNOContact } from '../device/AuxNOContact.js';
import { ThermalHeatElement } from '../device/ThermalHeatElement.js';
import { ThermalNCContact } from '../device/ThermalNCContact.js';

export const FAULT_CONFIGS = {
    km1coil_a1_poor: {
        id: 'km1coil_a1_poor',
        name: '接触器线圈 A1 端子接触不良',
        system: '控制回路',
        check()  { return window.sys?._poorContactPorts?.has('km1-coil_wire_a1'); },
        trigger() { (window.sys._poorContactPorts ??= new Set()).add('km1-coil_wire_a1'); },
        repair() { window.sys._poorContactPorts?.delete('km1-coil_wire_a1'); },
    },
    km1no1_com_poor: {
        id: 'km1no1_com_poor',
        name: '辅助常开 COM 端子接触不良',
        system: '控制回路',
        check()  { return window.sys?._poorContactPorts?.has('km1-no1_wire_com'); },
        trigger() { (window.sys._poorContactPorts ??= new Set()).add('km1-no1_wire_com'); },
        repair() { window.sys._poorContactPorts?.delete('km1-no1_wire_com'); },
    },
};

export const PROJECT_WORKFLOWS = {
    'two-location-control-analysis': {
        id: 'two-location-control-analysis', name: '1. 两地控制电路分析',
        steps: [
            {
                msg: '第 1 步：接线并合上电源开关。观察电动机是否自行起动.', mode: 'check',
                async act() {
                    await new Promise(r => setTimeout(r, 300));
                    const sys = this.sys;
                    sys.conns.length = 0;
                    _autoWire(sys);
                    await new Promise(r => setTimeout(r, 200));
                    const acb = sys.comps['acb'];
                    if (acb) { acb.close(); }
                    await new Promise(r => setTimeout(r, 500));
                },
                check() {
                    const c = (a, b) => this.sys.isPortConnected(a, b);
                    return c('ac_wire_u', 'acb_wire_l1')
                        && c('acb_wire_t1', 'km1-mc_wire_l1')
                        && c('km1-mc_wire_t1', 'im01_wire_u1');
                },
            },
            {
                msg: '第 2 步：将按钮SB3与按钮SB1串联（先断开控制变压器副边与SB1的连线，再串入SB3）', mode: 'check',
                async act() {
                    const sys = this.sys;
                    sys.connMgr.removeConn({ from: 'tc_wire_s2', to: 'sb_wire_nc3', type: 'wire' });
                    sys.connMgr.addConn({ from: 'tc_wire_s2', to: 'sb3_wire_nc3', type: 'wire' });
                    sys.connMgr.addConn({ from: 'sb3_wire_nc4', to: 'sb_wire_nc3', type: 'wire' });
                    await new Promise(r => setTimeout(r, 200));
                },
                check() {
                    const sys = this.sys;
                    const has = (a, b) => sys.conns.some(c =>
                        c.type === 'wire' && ((c.from === a && c.to === b) || (c.from === b && c.to === a)));
                    return !has('tc_wire_s2', 'sb_wire_nc3')
                        && has('tc_wire_s2', 'sb3_wire_nc3')
                        && has('sb3_wire_nc4', 'sb_wire_nc3');
                },
            },
            {
                msg: '第 3 步：将SB4与SB2并联', mode: 'check',
                async act() {
                    const sys = this.sys;
                    sys.connMgr.addConn({ from: 'sb_wire_nc4', to: 'sb4_wire_no1', type: 'wire' });
                    sys.connMgr.addConn({ from: 'sb4_wire_no2', to: 'ss_wire_no2', type: 'wire' });
                    await new Promise(r => setTimeout(r, 200));
                },
                check() {
                    const sys = this.sys;
                    const c = (a, b) => sys.isPortConnected(a, b);
                    const inNode  = 'ss_wire_no1';   // SB2 输入端节点
                    const outNode = 'ss_wire_no2';   // SB2 输出端节点
                    return (c('sb4_wire_no1', inNode) && c('sb4_wire_no2', outNode))
                        || (c('sb4_wire_no1', outNode) && c('sb4_wire_no2', inNode));
                },
            },
            {
                msg: '第 4 步：用SB4起动电动机', mode: 'check',
                async act() {
                    await new Promise(r => setTimeout(r, 200));
                },
                check() {
                    const motor = this.sys.comps['im01'];
                    return motor && motor.rpm > 1000;
                },
            },
            {
                msg: '第 5 步：用SB1停止电动机', mode: 'check',
                async act() {
                    await new Promise(r => setTimeout(r, 200));
                },
                check() {
                    const motor = this.sys.comps['im01'];
                    return motor && motor.rpm < 500;
                },
            },
            {
                msg: '第 6 步：测试题——两地控制实现方法', mode: 'quiz',
                quizConfig: {
                    question: '在两（异）地控制电路中，两个停止按钮（SB1、SB3）与两个起动按钮（SB2、SB4）应如何连接，才能在任意一处都可起动和停止电动机？',
                    options: [
                        '停止按钮串联，起动按钮并联',
                        '停止按钮并联，起动按钮串联',
                        '停止按钮与起动按钮均串联',
                        '停止按钮与起动按钮均并联',
                    ],
                    answer: 0,
                    analysis: '两地控制中，两个停止按钮采用串联连接：在任意一处按下停止按钮都会切断控制回路使电动机停转；两个起动按钮采用并联连接：在任意一处按下起动按钮都能接通起动回路。本电路 SB3 与 SB1 串联、SB4 与 SB2 并联，正是实现两地控制的接线方式。',
                },
            },
        ],
    },
};

export const componentConfigs = [
    { Class: DiagramACPower3P, id: 'ac', x: 280, y: 30, vRms: 220, freq: 50, isOn: true, phaseSeq: 'pos', visible: true },
    { Class: DiagramThreePhaseACB, id: 'acb', x: 280, y: 140, height: 105, initState: 'off', label: 'QF', ratedVoltage: 380, ratedCurrent: 100, tripCurrent: 10, visible: true },
    { Class: MainContact, id: 'km1-mc', x: 270, y: 350, height: 105, deviceid: 'KM1', visible: true },
    { Class: ThermalHeatElement, id: 'fr', x: 270, y: 540, height: 100, deviceid: 'FR1', ratedCurrent: 100, tripClass: 20, visible: true },
    { Class: InductionMotor2, id: 'im01', x: 240, y: 700, visible: true,
        R1: 0.50, Lsigma1: 0.00334, Rc: 300, Lm: 0.0796,
        R2: 0.46, Lsigma2: 0.00334,
        J: 0.12, B: 0.01, polePairs: 2,
        ratedPower: 10, ratedSpeed: 1440,
        simpleModel: true, loadTorque: 20 },

    // 两地控制（远端）按钮：SB3 停止 / SB4 起动，不参与自动接线，供后期手动接线使用
    { Class: DiagramStopButton, id: 'sb3', x: 500, y: 720, visible: true, label: 'SB3' },
    { Class: DiagramStartButton, id: 'sb4', x: 700, y: 720, visible: true, label: 'SB4' },

    // 控制回路：熔断器 → 控制变压器 → 停止按钮 → 起动按钮 → 线圈 → 熔断器 → 回到变压器
    { Class: SinglePhaseFuse, id: 'fu4', x: 480, y: 150, label: 'FU4', ratedCurrent: 5, rotation: -90, visible: true },
    { Class: ControlTransformer, id: 'tc', x: 620, y: 110, primaryVoltage: 380, secondaryVoltage: 220, visible: true },
    { Class: SinglePhaseFuse, id: 'fu5', x: 780, y: 160, label: 'FU5', ratedCurrent: 5, rotation: -90, visible: true },
    { Class: DiagramStopButton, id: 'sb', x: 780, y: 200, visible: true ,label:'SB1'},
    { Class: DiagramStartButton, id: 'ss', x: 980, y: 200, visible: true ,label:'SB2'},
    { Class: AuxNOContact, id: 'km1-no1', x: 980, y: 350, deviceid: 'KM1', visible: true },
    { Class: ContactorCoil, id: 'km1-coil', x: 1180, y: 200, deviceid: 'KM1', visible: true },
    { Class: ThermalNCContact, id: 'fr-nc', x: 1150, y: 100, deviceid: 'FR1', visible: true },

    { Class: TsCurveDisplay, id: 'ts-curve', x: 1350, y: 100, visible: false, quadrants: 1 },
    { Class: Multimeter, id: 'multimeter', x: 1080, y: 440, visible: false },    
    { Class: MF47Multimeter, id: 'mf47-panel', x: 1250, y: 180, visible: false },
    { Class: Oscilloscope_tri, id: 'osc', x: 50, y: 50, visible: false },
    { Class: SignalGenerator, id: 'sg', x: 50, y: 50, visible: false },
    { Class: ProcessCalibrator, id: 'cali', x: 50, y: 50, visible: false },
    { Class: ElecMeter, id: 'elecmeter', x: 50, y: 50, visible: false },
];

// ─── 接线辅助 ───

function _autoWire(sys) {
    sys.conns.length = 0;
    const cons = [
        // 主回路：电源 → 断路器 → 接触器主触头 → 热继电器发热元件 → 电动机
        { from: 'ac_wire_u', to: 'acb_wire_l1', type: 'wire' },
        { from: 'ac_wire_v', to: 'acb_wire_l2', type: 'wire' },
        { from: 'ac_wire_w', to: 'acb_wire_l3', type: 'wire' },
        { from: 'acb_wire_t1', to: 'km1-mc_wire_l1', type: 'wire' },
        { from: 'acb_wire_t2', to: 'km1-mc_wire_l2', type: 'wire' },
        { from: 'acb_wire_t3', to: 'km1-mc_wire_l3', type: 'wire' },
        { from: 'km1-mc_wire_t1', to: 'fr_wire_l1', type: 'wire' },
        { from: 'km1-mc_wire_t2', to: 'fr_wire_l2', type: 'wire' },
        { from: 'km1-mc_wire_t3', to: 'fr_wire_l3', type: 'wire' },
        { from: 'fr_wire_t1', to: 'im01_wire_u1', type: 'wire' },
        { from: 'fr_wire_t2', to: 'im01_wire_v1', type: 'wire' },
        { from: 'fr_wire_t3', to: 'im01_wire_w1', type: 'wire' },
        { from: 'im01_wire_u2', to: 'im01_wire_v2', type: 'wire' },
        { from: 'im01_wire_v2', to: 'im01_wire_w2', type: 'wire' },
        // 控制回路：L3 → FU4 → 变压器一次侧 → 经接触器主触头 → L2
        { from: 'acb_wire_t3', to: 'fu4_wire_l', type: 'wire' },
        { from: 'fu4_wire_t', to: 'tc_wire_p1', type: 'wire' },
        { from: 'km1-mc_wire_l2', to: 'tc_wire_p2', type: 'wire' },
        // 控制回路：变压器副边下端(s2) → 停止按钮 → [起动按钮 ∥ 常开触点] → 线圈 → FU5 → 副边上端(s1)
        { from: 'tc_wire_s2',  to: 'sb_wire_nc3', type: 'wire' },
        // 停止按钮输出 → 并联支路
        { from: 'sb_wire_nc4', to: 'ss_wire_no1', type: 'wire' },
        { from: 'sb_wire_nc4', to: 'km1-no1_wire_com', type: 'wire' },
        // 并联支路汇合 → 线圈
        { from: 'ss_wire_no2', to: 'km1-coil_wire_a1', type: 'wire' },
        { from: 'km1-no1_wire_no', to: 'ss_wire_no2', type: 'wire' },
        // 线圈 → 热继电器常闭触点 → FU5 → 副边上端
        { from: 'km1-coil_wire_a2', to: 'fr-nc_wire_nc', type: 'wire' },
        { from: 'fr-nc_wire_com', to: 'fu5_wire_t', type: 'wire' },
        { from: 'fu5_wire_l', to: 'tc_wire_s1', type: 'wire' },
    ];
    cons.forEach(c => sys.connMgr.addConn(c));
    sys.redrawAll();
}

function _powerOn(sys) {
    //将空气断路器合上
    const acb = sys.comps['acb'];
    if (acb) {
        acb.close();
    }
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
    _powerOn(sys);
}

export function fiveStep() { }
