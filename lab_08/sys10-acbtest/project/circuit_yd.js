// 三相异步电动机星三角（Y-Δ）降压起动控制仿真工程
//
// 主回路：AC(380V) → QF → KM1 主接触器 → FR 热继电器发热元件 → 电机 U1/V1/W1
//        电机尾端 U2/V2/W2 由 KM3（星形）短接或 KM2（三角形）换接；
//        星形（KM3 吸合）：U2/V2/W2 短接，绕组承受 220V（相电压）
//        三角形（KM2 吸合）：U2↔V1、V2↔W1、W2↔U1 换接，绕组承受 380V（线电压）
// 控制回路：TC 副边 220V → SB1（停止） → 起动节点
//        ├─ 主线圈支路：SB2 ∥ KM1-NO 自锁 → KM1 线圈
//        ├─ 星形支路：  KM2-NC 互锁 → KT1-NC 延时断开 → KM3 线圈
//        ├─ 三角形支路：KT1-NO 延时闭合 → KM3-NC 互锁 → KM2 线圈
//        ├─ KT1 线圈支路（由起动节点供电）
//        └─ 四线圈返回 → FR-NC 常闭 → FU5 → TC 副边上端
//
// 时间继电器 KT1（通电延时型，JSZ3）：
//   idle →(线圈电压>160V)→ timing →(计时≥delayTime)→ output →(电压<40V)→ idle
//   output 后 KT1-NC 立即断开（KM3 释放），KT1-NO 延时 closeGap 后再闭合（KM2 吸合），
//   防止 Y/Δ 换接瞬间两接触器同时吸合造成相间短路。

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
import { AuxNCContact } from '../device/AuxNCContact.js';
import { ThermalHeatElement } from '../device/ThermalHeatElement.js';
import { ThermalNCContact } from '../device/ThermalNCContact.js';
import { TimeRelayCoil } from '../device/TimeRelayCoil.js';
import { TimeDelayNOContact } from '../device/TimeDelayNOContact.js';
import { TimeDelayNCContact } from '../device/TimeDelayNCContact.js';

export const FAULT_CONFIGS = {
    tkt_coil_a1_poor: {
        id: 'tkt_coil_a1_poor',
        name: '时间继电器 KT 线圈 A1 端子接触不良',
        system: '控制回路',
        check()  { return window.sys?._poorContactPorts?.has('tkt-coil_wire_a1'); },
        trigger() { (window.sys._poorContactPorts ??= new Set()).add('tkt-coil_wire_a1'); },
        repair() { window.sys._poorContactPorts?.delete('tkt-coil_wire_a1'); },
    },
    km3_coil_a1_poor: {
        id: 'km3_coil_a1_poor',
        name: '星形接触器 KM3 线圈 A1 端子接触不良',
        system: '控制回路',
        check()  { return window.sys?._poorContactPorts?.has('km3-coil_wire_a1'); },
        trigger() { (window.sys._poorContactPorts ??= new Set()).add('km3-coil_wire_a1'); },
        repair() { window.sys._poorContactPorts?.delete('km3-coil_wire_a1'); },
    },
};

export const PROJECT_WORKFLOWS = {
    'yd-start': {
        id: 'yd-start', name: '1. 星三角降压起动控制电路分析',
        steps: [
            {
                msg: '第 1 步：接线并合上电源开关 QF。电动机尚未按起动按钮，不应自行起动。', mode: 'check',
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
                    const km1 = this.sys.comps['km1-coil'];
                    const motor = this.sys.comps['im01'];
                    return c('ac_wire_u', 'acb_wire_l1')
                        && c('acb_wire_t1', 'km1-mc_wire_l1')
                        && c('km1-mc_wire_t1', 'fr_wire_l1')
                        && c('fr_wire_t1', 'im01_wire_u1')
                        && motor && Math.abs(motor.rpm) < 50;
                },
            },
            {
                msg: '第 2 步：点击起动按钮 SB2。KM1（主）、KM3（星形）接触器吸合，KT1 开始延时，电动机以星形接法降压起动（绕组电压降为 220V，转速缓慢上升）。', mode: 'check',
                async act() {
                    await new Promise(r => setTimeout(r, 200));
                    _pressButton(this.sys, 'ss', 400);
                    await new Promise(r => setTimeout(r, 2500));
                },
                check() {
                    const sys = this.sys;
                    const km1 = sys.comps['km1-coil'];
                    const km3 = sys.comps['km3-coil'];
                    const tkt = sys.comps['tkt-coil'];
                    const motor = sys.comps['im01'];
                    return km1 && km1.deviceRef && km1.deviceRef.isPickup()
                        && km3 && km3.deviceRef && km3.deviceRef.isPickup()
                        && tkt && tkt.deviceRef && tkt.deviceRef.getState() === 'timing'
                },
            },
            {
                msg: '第 3 步：等待 KT1 延时到达（默认 5s）。KT1 常闭触头断开 KM3（星形释放），经换接间隔后常开触头闭合 KM2（三角形吸合），电动机切换为三角形全压运行，转速升至接近额定值。', mode: 'check',
                async act() {
                    await new Promise(r => setTimeout(r, 200));
                    const tkt = this.sys.comps['tkt-coil'];
                    const delay = tkt && tkt._delayTime !== undefined ? tkt._delayTime : 5;
                    await new Promise(r => setTimeout(r, (delay + 2) * 1000));
                },
                check() {
                    const sys = this.sys;
                    const km2 = sys.comps['km2-coil'];
                    const km3 = sys.comps['km3-coil'];
                    const tkt = sys.comps['tkt-coil'];
                    const motor = sys.comps['im01'];
                    return km2 && km2.deviceRef && km2.deviceRef.isPickup()
                        && km3 && km3.deviceRef && !km3.deviceRef.isPickup()
                        && tkt && tkt.deviceRef && tkt.deviceRef.getState() === 'output'
                        && motor && motor.rpm > 200;
                },
            },
            {
                msg: '第 4 步：点击停止按钮 SB1，各接触器失电释放，电动机断电滑行停止。', mode: 'check',
                async act() {
                    await new Promise(r => setTimeout(r, 200));
                    _pressButton(this.sys, 'sb', 400);
                    await new Promise(r => setTimeout(r, 4000));
                },
                check() {
                    const sys = this.sys;
                    const km1 = sys.comps['km1-coil'];
                    const km2 = sys.comps['km2-coil'];
                    const km3 = sys.comps['km3-coil'];
                    const tkt = sys.comps['tkt-coil'];
                    const motor = sys.comps['im01'];
                    return km1.deviceRef && !km1.deviceRef.isPickup()
                        && (!km2.deviceRef || !km2.deviceRef.isPickup())
                        && (!km3.deviceRef || !km3.deviceRef.isPickup())
                        && (!tkt.deviceRef || tkt.deviceRef.getState() === 'idle')
                        && motor && Math.abs(motor.rpm) < 240;
                },
            },
            {
                msg: '第 5 步：测验题——星三角降压起动的电流与转矩', mode: 'quiz',
                quizConfig: {
                    question: '三相异步电动机采用星三角降压起动时，星形接法下的起动电流约为三角形直接起动时的多少倍？',
                    options: [
                        '1/3（起动电流降至直接起动的三分之一）',
                        '1/√3（约为 0.577 倍）',
                        '1/2',
                        '保持不变',
                    ],
                    answer: 0,
                    analysis: '星形接法时每相绕组电压为线电压的 1/√3（380V 线电压下绕组仅承受 220V）。起动电流与绕组电压成正比，故星形起动电流约为三角形直接起动的 1/3；起动转矩与电压平方成正比，亦降为直接起动的 1/3。因此星三角降压起动仅适用于空载或轻载起动场合。',
                },
            },
        ],
    },
};

export const componentConfigs = [
    // ── 主回路：AC 220V → QF → KM1 → FR → 电动机 ──
    { Class: DiagramACPower3P, id: 'ac', x: 300, y: 20, vRms: 220, freq: 50, isOn: true, phaseSeq: 'pos', visible: true },
    { Class: DiagramThreePhaseACB, id: 'acb', x: 300, y: 100, height: 105, initState: 'off', label: 'QF', ratedVoltage: 380, ratedCurrent: 100, tripCurrent: 60, visible: true },
    { Class: MainContact, id: 'km1-mc', x: 300, y: 270, height: 105, deviceid: 'KM1', visible: true },
    { Class: ThermalHeatElement, id: 'fr', x: 300, y: 430, height: 100, deviceid: 'FR1', ratedCurrent: 300, tripClass: 20, visible: true },
    { Class: InductionMotor2, id: 'im01', x: 270, y: 550, visible: true,
        R1: 0.50, Lsigma1: 0.00334, Rc: 300, Lm: 0.0796,
        R2: 0.46, Lsigma2: 0.00334,
        J: 1.0, B: 0.02, polePairs: 2,
        ratedPower: 10, ratedSpeed: 1440,
        simpleModel: true, loadTorque: 20 },

    // ── 星形 / 三角形接触器（尾端 U2/V2/W2 换接）──
    { Class: MainContact, id: 'km3-mc', x: 300, y: 860, height: 105, deviceid: 'KM3', visible: true },
    { Class: MainContact, id: 'km2-mc', x: 600, y: 630, height: 105, deviceid: 'KM2', visible: true },

    // ── 控制回路：FU4 → TC → SB1 → [KM1 自锁 | 星形支路 | 三角形支路 | KT1] → FR-NC → FU5 → TC ──
    { Class: SinglePhaseFuse, id: 'fu4', x: 480, y: 150, label: 'FU4', ratedCurrent: 5, rotation: -90, visible: true },
    { Class: ControlTransformer, id: 'tc', x: 620, y: 110, primaryVoltage: 380, secondaryVoltage: 220, visible: true },
    { Class: SinglePhaseFuse, id: 'fu5', x: 800, y: 160, label: 'FU5', ratedCurrent: 5, rotation: -90, visible: true },
    { Class: DiagramStopButton, id: 'sb', x: 800, y: 200, visible: true, label: 'SB1' },
    // ── 主线圈自锁支路 ──
    { Class: DiagramStartButton, id: 'ss', x: 1000, y: 190, visible: true, label: 'SB2' },
    { Class: AuxNOContact, id: 'km1-no1', x: 1030, y: 260, deviceid: 'KM1', visible: true,rotation:90, },
    { Class: ContactorCoil, id: 'km1-coil', x: 1380, y: 200, deviceid: 'KM1', visible: true },
    // ── 时间继电器 KT1 线圈 ──
    { Class: TimeRelayCoil, id: 'tkt-coil', x: 1380, y: 330, deviceid: 'KT1', delayTime: 5, visible: true },
    // ── 手动连接用（不参与自动接线）：KM2 常闭辅助触点（KT1 线圈左侧）──
    { Class: AuxNCContact, id: 'km2-nc2', x: 1180, y: 310, deviceid: 'KM2', visible: true },
    // ── 星形支路：KM2-NC 互锁 → KT1-NC 延时断开 → KM3 线圈 ──
    { Class: AuxNCContact, id: 'km2-nc', x: 1180, y: 450, deviceid: 'KM2', visible: true },
    { Class: TimeDelayNCContact, id: 'tkt-nc', x: 1000, y: 450, deviceid: 'KT1', visible: true },
    { Class: ContactorCoil, id: 'km3-coil', x: 1380, y: 450, deviceid: 'KM3', visible: true },
    // ── 三角形支路：KT1-NO 延时闭合 → KM3-NC 互锁 → KM2 线圈 ──
    { Class: TimeDelayNOContact, id: 'tkt-no', x: 1000, y: 560, deviceid: 'KT1', visible: true },
    // ── 手动连接用（不参与自动接线）：KM2 常开辅助触点（KT1-NO 下方）──
    { Class: AuxNOContact, id: 'km2-no1', x: 1000, y: 660, deviceid: 'KM2', visible: true },
    { Class: AuxNCContact, id: 'km3-nc', x: 1180, y: 560, deviceid: 'KM3', visible: true },
    { Class: ContactorCoil, id: 'km2-coil', x: 1380, y: 560, deviceid: 'KM2', visible: true },
    { Class: ThermalNCContact, id: 'fr-nc', x: 1350, y: 100, deviceid: 'FR1', visible: true },

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
        // 主回路：电源 → 断路器 → KM1 主触头 → 热继电器发热元件 → 电动机首端 U1/V1/W1
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
        // 三角形接触器 KM2：U2↔V1、V2↔W1、W2↔U1 换接
        { from: 'km2-mc_wire_l1', to: 'fr_wire_t1', type: 'wire' },
        { from: 'km2-mc_wire_l2', to: 'fr_wire_t2', type: 'wire' },
        { from: 'km2-mc_wire_l3', to: 'fr_wire_t3', type: 'wire' },
        { from: 'im01_wire_w2', to: 'km2-mc_wire_t1', type: 'wire' },
        { from: 'im01_wire_u2', to: 'km2-mc_wire_t2', type: 'wire' },
        { from: 'im01_wire_v2', to: 'km2-mc_wire_t3', type: 'wire' },
        // 星形接触器 KM3：U2/V2/W2 经出线侧短接成中性点
        { from: 'km3-mc_wire_l1', to: 'im01_wire_u2', type: 'wire' },
        { from: 'km3-mc_wire_l2', to: 'im01_wire_v2', type: 'wire' },
        { from: 'km3-mc_wire_l3', to: 'im01_wire_w2', type: 'wire' },
        { from: 'km3-mc_wire_t1', to: 'km3-mc_wire_t2', type: 'wire' },
        { from: 'km3-mc_wire_t2', to: 'km3-mc_wire_t3', type: 'wire' },
        // 控制回路电源：L3 → FU4 → 变压器一次侧 → L2
        { from: 'acb_wire_t3', to: 'fu4_wire_l', type: 'wire' },
        { from: 'fu4_wire_t', to: 'tc_wire_p1', type: 'wire' },
        { from: 'km1-mc_wire_l2', to: 'tc_wire_p2', type: 'wire' },
        // 变压器副边下端(s2) → 停止按钮 SB1
        { from: 'tc_wire_s2', to: 'sb_wire_nc3', type: 'wire' },
        // SB1 输出 → 起动节点（SB2 进线端）
        { from: 'sb_wire_nc4', to: 'ss_wire_no1', type: 'wire' },
        // 主线圈支路：SB2 ∥ KM1-NO 自锁 → KM1 线圈
        { from: 'ss_wire_no1', to: 'km1-no1_wire_com', type: 'wire' },
        { from: 'km1-no1_wire_no', to: 'ss_wire_no2', type: 'wire' },
        { from: 'ss_wire_no2', to: 'km1-coil_wire_a1', type: 'wire' },
        // 星形支路：KM2-NC 互锁 → KT1-NC 延时断开 → KM3 线圈
        { from: 'km1-no1_wire_no', to: 'tkt-nc_wire_com', type: 'wire' },
        { from: 'tkt-nc_wire_nc', to: 'km2-nc_wire_com', type: 'wire' },
        { from: 'km2-nc_wire_nc', to: 'km3-coil_wire_a1', type: 'wire' },
        // 三角形支路：KT1-NO 延时闭合 → KM3-NC 互锁 → KM2 线圈
        { from: 'tkt-nc_wire_com', to: 'tkt-no_wire_com', type: 'wire' },
        { from: 'tkt-no_wire_no', to: 'km3-nc_wire_com', type: 'wire' },
        { from: 'km3-nc_wire_nc', to: 'km2-coil_wire_a1', type: 'wire' },
        // KT1 线圈支路
        { from: 'km1-no1_wire_no', to: 'tkt-coil_wire_a1', type: 'wire' },
        // 四线圈汇合 → 热继电器常闭 → FU5 → 变压器副边上端(s1)
        { from: 'km1-coil_wire_a2', to: 'fr-nc_wire_nc', type: 'wire' },
        { from: 'km3-coil_wire_a2', to: 'tkt-coil_wire_a2', type: 'wire' },
        { from: 'km2-coil_wire_a2', to: 'km3-coil_wire_a2', type: 'wire' },
        { from: 'tkt-coil_wire_a2', to: 'km1-coil_wire_a2', type: 'wire' },
        { from: 'fr-nc_wire_com', to: 'fu5_wire_t', type: 'wire' },
        { from: 'fu5_wire_l', to: 'tc_wire_s1', type: 'wire' },
    ];
    cons.forEach(c => sys.connMgr.addConn(c));
    sys.redrawAll();
}

function _powerOn(sys) {
    // 将空气断路器合上
    const acb = sys.comps['acb'];
    if (acb) {
        acb.close();
    }
}

/** 模拟按下按钮：按下 duration ms 后松开（SB2 起动按钮闭合、SB1 停止按钮断开） */
function _pressButton(sys, compId, duration) {
    const comp = sys.comps[compId];
    if (!comp) return;
    const isStart = comp.special === 'START-BTN';
    const closedAng = isStart ? -5 : 22.5;
    const openAng = isStart ? -22.5 : 5;
    comp._isPressed = true;
    comp._curBladeAng = closedAng;
    comp._bladeGroup?.rotation(closedAng);
    comp._updatePlunger?.();
    setTimeout(() => {
        comp._isPressed = false;
        comp._curBladeAng = openAng;
        comp._bladeGroup?.rotation(openAng);
        comp._updatePlunger?.();
    }, duration);
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
