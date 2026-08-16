// 三相异步电动机正反转控制仿真工程

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
import { Switch } from '../components/Switch.js';
import { ControlTransformer } from '../device/ControlTransformer.js';
import { MainContact } from '../device/MainContact.js';
import { ContactorCoil } from '../device/ContactorCoil.js';
import { AuxNOContact } from '../device/AuxNOContact.js';
import { AuxNCContact } from '../device/AuxNCContact.js';
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
    'forward-reverse-analysis': {
        id: 'forward-reverse-analysis', name: '1. 正反转控制电路分析',
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
                msg: '第 2 步：点击正转起动按钮（SB2），观察电动机是否正转运行', mode: 'check',
                async act() {
                    await new Promise(r => setTimeout(r, 200));
                },
                check() {
                    const motor = this.sys.comps['im01'];
                    return motor && motor.rpm > 1000;
                },
            },
            {
                msg: '第 3 步：点击停止按钮（SB1），观察电动机能否停止', mode: 'check',
                async act() {
                    await new Promise(r => setTimeout(r, 200));
                },
                check() {
                    const motor = this.sys.comps['im01'];
                    return motor && motor.rpm > -500 && motor.rpm < 500;
                },
            },
            {
                msg: '第 4 步：点击反转起动按钮（SB3），观察电动机是否反转运行', mode: 'check',
                async act() {
                    await new Promise(r => setTimeout(r, 200));
                },
                check() {
                    const motor = this.sys.comps['im01'];
                    return motor && motor.rpm < -1000;
                },
            },
            {
                msg: '第 5 步：点击停止按钮（SB1），观察电动机能否停止', mode: 'check',
                async act() {
                    await new Promise(r => setTimeout(r, 200));
                },
                check() {
                    const motor = this.sys.comps['im01'];
                    return motor && motor.rpm > -500 && motor.rpm < 500;
                },
            },
            {
                msg: '第 6 步：互锁验证——正转运行中，按住反转按钮SB3，观察电动机是否仍保持正转', mode: 'check',
                async act() {
                    await new Promise(r => setTimeout(r, 200));
                },
                check() {
                    const motor = this.sys.comps['im01'];
                    const sb3 = this.sys.comps['sb3'];
                    return motor && motor.rpm > 1000 && sb3 && sb3._isPressed;
                },
            },
            {
                msg: '第 7 步：测试题——互锁的作用', mode: 'quiz',
                quizConfig: {
                    question: '在正反转控制电路中，在 KM1、KM2 线圈回路中分别串入对方接触器的常闭触头（互锁）的主要目的是什么？',
                    options: [
                        '防止两个接触器同时吸合造成电源相间短路',
                        '提高电动机的起动转矩',
                        '实现电动机的调速',
                        '防止电动机过载',
                    ],
                    answer: 0,
                    analysis: '互锁（电气联锁）通过在 KM1 线圈回路中串入 KM2 的常闭触头、在 KM2 线圈回路中串入 KM1 的常闭触头实现。当 KM1 吸合后，其常闭触头断开 KM2 线圈回路使 KM2 无法吸合，反之亦然，从而保证任意时刻只有一个接触器吸合。若两个接触器同时吸合，其主触头会使电源两相短路。',
                },
            },
        ],
    },
};

export const componentConfigs = [
    { Class: DiagramACPower3P, id: 'ac', x: 280, y: 30, vRms: 220, freq: 50, isOn: true, phaseSeq: 'pos', visible: true },
    { Class: DiagramThreePhaseACB, id: 'acb', x: 280, y: 140, height: 105, initState: 'off', label: 'QF', ratedVoltage: 380, ratedCurrent: 100, tripCurrent: 10, visible: true },
    // 主回路：KM2（反转）主触头在左，KM1（正转）主触头在右
    { Class: MainContact, id: 'km2-mc', x: 90, y: 350, height: 105, deviceid: 'KM2', visible: true },
    { Class: MainContact, id: 'km1-mc', x: 270, y: 350, height: 105, deviceid: 'KM1', visible: true },
    { Class: ThermalHeatElement, id: 'fr', x: 270, y: 540, height: 100, deviceid: 'FR1', ratedCurrent: 100, tripClass: 20, visible: true },
    { Class: InductionMotor2, id: 'im01', x: 240, y: 700, visible: true,
        R1: 0.50, Lsigma1: 0.00334, Rc: 300, Lm: 0.0796,
        R2: 0.46, Lsigma2: 0.00334,
        J: 0.12, B: 0.01, polePairs: 2,
        ratedPower: 10, ratedSpeed: 1440,
        simpleModel: true, loadTorque: 20 },

    // 控制回路：熔断器 → 控制变压器 → 停止按钮 → [正转支路|反转支路] → 热继电器常闭 → 熔断器 → 回到变压器
    { Class: SinglePhaseFuse, id: 'fu4', x: 480, y: 150, label: 'FU4', ratedCurrent: 5, rotation: -90, visible: true },
    { Class: ControlTransformer, id: 'tc', x: 620, y: 110, primaryVoltage: 380, secondaryVoltage: 220, visible: true },
    { Class: SinglePhaseFuse, id: 'fu5', x: 780, y: 160, label: 'FU5', ratedCurrent: 5, rotation: -90, visible: true },
    { Class: DiagramStopButton, id: 'sb', x: 780, y: 200, visible: true, label: 'SB1' },
    // ── 正转（KM1）自锁电路 ──
    { Class: DiagramStartButton, id: 'ss', x: 980, y: 180, visible: true, label: 'SB2' },
    { Class: AuxNOContact, id: 'km1-no1', x: 980, y: 350, deviceid: 'KM1', visible: true },
    { Class: AuxNCContact, id: 'km2-nc', x: 1090, y: 180, deviceid: 'KM2', visible: true },
    { Class: ContactorCoil, id: 'km1-coil', x: 1180, y: 200, deviceid: 'KM1', visible: true },
    // ── 反转（KM2）自锁电路（位于 KM1 自锁电路下方）──
    { Class: DiagramStartButton, id: 'sb3', x: 980, y: 480, visible: true, label: 'SB3' },
    { Class: AuxNOContact, id: 'km2-no1', x: 980, y: 580, deviceid: 'KM2', visible: true },
    { Class: AuxNCContact, id: 'km1-nc', x: 1090, y: 480, deviceid: 'KM1', visible: true },
    { Class: ContactorCoil, id: 'km2-coil', x: 1180, y: 480, deviceid: 'KM2', visible: true },
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
        // 主回路：电源 → 断路器 → (KM2 ∥ KM1) 主触头 → 热继电器发热元件 → 电动机
        { from: 'ac_wire_u', to: 'acb_wire_l1', type: 'wire' },
        { from: 'ac_wire_v', to: 'acb_wire_l2', type: 'wire' },
        { from: 'ac_wire_w', to: 'acb_wire_l3', type: 'wire' },
        { from: 'acb_wire_t1', to: 'km1-mc_wire_l1', type: 'wire' },
        { from: 'acb_wire_t2', to: 'km1-mc_wire_l2', type: 'wire' },
        { from: 'acb_wire_t3', to: 'km1-mc_wire_l3', type: 'wire' },
        { from: 'acb_wire_t1', to: 'km2-mc_wire_l1', type: 'wire' },
        { from: 'acb_wire_t2', to: 'km2-mc_wire_l2', type: 'wire' },
        { from: 'acb_wire_t3', to: 'km2-mc_wire_l3', type: 'wire' },
        // KM1 正转：正常相序 U-V-W
        { from: 'km1-mc_wire_t1', to: 'fr_wire_l1', type: 'wire' },
        { from: 'km1-mc_wire_t2', to: 'fr_wire_l2', type: 'wire' },
        { from: 'km1-mc_wire_t3', to: 'fr_wire_l3', type: 'wire' },
        // KM2 反转：交换 U/W 两相
        { from: 'km2-mc_wire_t1', to: 'fr_wire_l3', type: 'wire' },
        { from: 'km2-mc_wire_t2', to: 'fr_wire_l2', type: 'wire' },
        { from: 'km2-mc_wire_t3', to: 'fr_wire_l1', type: 'wire' },
        { from: 'fr_wire_t1', to: 'im01_wire_u1', type: 'wire' },
        { from: 'fr_wire_t2', to: 'im01_wire_v1', type: 'wire' },
        { from: 'fr_wire_t3', to: 'im01_wire_w1', type: 'wire' },
        { from: 'im01_wire_u2', to: 'im01_wire_v2', type: 'wire' },
        { from: 'im01_wire_v2', to: 'im01_wire_w2', type: 'wire' },
        // 控制回路电源：L3 → FU4 → 变压器一次侧 → L2
        { from: 'acb_wire_t3', to: 'fu4_wire_l', type: 'wire' },
        { from: 'fu4_wire_t', to: 'tc_wire_p1', type: 'wire' },
        { from: 'km1-mc_wire_l2', to: 'tc_wire_p2', type: 'wire' },
        // 控制回路：变压器副边下端(s2) → 停止按钮 SB1
        { from: 'tc_wire_s2', to: 'sb_wire_nc3', type: 'wire' },
        // SB1 输出 → 正转支路 / 反转支路
        { from: 'sb_wire_nc4', to: 'ss_wire_no1', type: 'wire' },
        { from: 'sb_wire_nc4', to: 'sb3_wire_no1', type: 'wire' },
        // 正转支路：SB2 ∥ KM1-NO 自锁 → KM2-NC 互锁 → KM1 线圈
        { from: 'ss_wire_no2', to: 'km1-no1_wire_com', type: 'wire' },
        { from: 'km1-no1_wire_no', to: 'ss_wire_no2', type: 'wire' },
        { from: 'ss_wire_no2', to: 'km2-nc_wire_com', type: 'wire' },
        { from: 'km2-nc_wire_nc', to: 'km1-coil_wire_a1', type: 'wire' },
        // 反转支路：SB3 ∥ KM2-NO 自锁 → KM1-NC 互锁 → KM2 线圈
        { from: 'sb3_wire_no2', to: 'km2-no1_wire_com', type: 'wire' },
        { from: 'km2-no1_wire_no', to: 'sb3_wire_no2', type: 'wire' },
        { from: 'sb3_wire_no2', to: 'km1-nc_wire_com', type: 'wire' },
        { from: 'km1-nc_wire_nc', to: 'km2-coil_wire_a1', type: 'wire' },
        // 线圈汇合 → 热继电器常闭 → FU5 → 变压器副边上端(s1)
        { from: 'km1-coil_wire_a2', to: 'fr-nc_wire_nc', type: 'wire' },
        { from: 'km2-coil_wire_a2', to: 'fr-nc_wire_nc', type: 'wire' },
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
