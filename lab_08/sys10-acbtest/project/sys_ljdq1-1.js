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
import { MotorStarterPanel } from '../components/MotorStarterPanel.js';
import { AuxNCContact } from '../device/AuxNCContact.js';
import { TimeRelayCoil } from '../device/TimeRelayCoil.js';
import { TimeDelayNOContact } from '../device/TimeDelayNOContact.js';
import { TimeDelayNCContact } from '../device/TimeDelayNCContact.js';

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
    'read-circuit': {
        id: 'read-circuit', name: '1.读懂电气控制图',
        steps: [
            {
                msg: '第 1 步：进行电机连续控制线路的接线', mode: 'check',
                async act() {
                    await new Promise(r => setTimeout(r, 300));
                    const sys = this.sys;
                    sys.conns.length = 0;
                    _autoWire(sys);
                    await new Promise(r => setTimeout(r, 300));
                },
                check() {
                    const c = (a, b) => this.sys.isPortConnected(a, b);
                    return c('ac_wire_u', 'acb_wire_l1')
                        && c('acb_wire_t1', 'km1-mc_wire_l1')
                        && c('km1-mc_wire_t3', 'fr_wire_l3')
                        && c('fr_wire_t1', 'im01_wire_u1')
                        && c('tc_wire_s2', 'sb_wire_nc3')
                        && c('sb_wire_nc4', 'ss_wire_no1')
                        && c('ss_wire_no2', 'km1-coil_wire_a1');
                },
            },
            { msg: '第 2 步：识别接触器线圈', mode: 'find', target: 'km1-coil' },
            { msg: '第 3 步：识别接触器主触头', mode: 'find', target: 'km1-mc' },
            { msg: '第 4 步：识别接触器常开辅助触头', mode: 'find', target: 'km1-no1' },
            { msg: '第 5 步：识别微型断路器（空气开关）', mode: 'find', target: 'acb' },
            { msg: '第 6 步：识别熔断器（FU4/FU5 任选其一）', mode: 'find', target: ['fu4', 'fu5'] },
            { msg: '第 7 步：识别热继电器发热元件', mode: 'find', target: 'fr' },
            { msg: '第 8 步：识别热继电器常闭触头', mode: 'find', target: 'fr-nc' },
            { msg: '第 9 步：识别时间继电器线圈', mode: 'find', target: 'kt-coil' },
            { msg: '第 10 步：识别起动按钮', mode: 'find', target: 'ss' },
            { msg: '第 11 步：识别停止按钮', mode: 'find', target: 'sb' },
            { msg: '第 12 步：识别控制变压器', mode: 'find', target: 'tc' },
        ],
    },
    'logic-explained': {        id: 'logic-explained', name: '2.解释控制逻辑关系',
        steps: [
            {
                msg: '第 1 步：进行电路接线，合上电源开关', mode: 'check',
                async act() {
                    await new Promise(r => setTimeout(r, 300));
                    const sys = this.sys;
                    sys.conns.length = 0;
                    _autoWire(sys);
                    await new Promise(r => setTimeout(r, 300));
                    _powerOn(sys);
                    await new Promise(r => setTimeout(r, 300));
                },
                check() {
                    const sys = this.sys;
                    const c = (a, b) => sys.isPortConnected(a, b);
                    const acb = sys.comps['acb'];
                    return c('ac_wire_u', 'acb_wire_l1')
                        && c('acb_wire_t1', 'km1-mc_wire_l1')
                        && c('km1-mc_wire_t3', 'fr_wire_l3')
                        && c('fr_wire_t1', 'im01_wire_u1')
                        && c('tc_wire_s2', 'sb_wire_nc3')
                        && c('sb_wire_nc4', 'ss_wire_no1')
                        && c('ss_wire_no2', 'km1-coil_wire_a1')
                        && acb && acb.getState() === 'on';
                },
            },
            {
                msg: '第 2 步：按下起动按钮 SB2，接触器线圈得电、主触头闭合、常开辅助触头闭合（自锁）', mode: 'check',
                async act() {
                    await new Promise(r => setTimeout(r, 200));
                    _pressButton(this.sys, 'ss', 400);
                    await new Promise(r => setTimeout(r, 3000));
                },
                check() {
                    const sys = this.sys;
                    const coil = sys.comps['km1-coil'];
                    const mc = sys.comps['km1-mc'];
                    const no1 = sys.comps['km1-no1'];
                    return coil && coil.deviceRef && coil.deviceRef.isPickup()
                        && mc && mc.deviceRef && mc.deviceRef.getContactClosed()
                        && no1 && no1.deviceRef && no1.deviceRef.getContactClosed();
                },
            },
            {
                msg: '第 3 步：按下停止按钮 SB1，接触器线圈失电、主触头断开、常开辅助触头断开', mode: 'check',
                async act() {
                    await new Promise(r => setTimeout(r, 200));
                    _pressButton(this.sys, 'sb', 400);
                    await new Promise(r => setTimeout(r, 3000));
                },
                check() {
                    const sys = this.sys;
                    const coil = sys.comps['km1-coil'];
                    const mc = sys.comps['km1-mc'];
                    const no1 = sys.comps['km1-no1'];
                    return coil && coil.deviceRef && !coil.deviceRef.isPickup()
                        && mc && mc.deviceRef && !mc.deviceRef.getContactClosed()
                        && no1 && no1.deviceRef && !no1.deviceRef.getContactClosed();
                },
            },
            { msg: '第 4 步：识别接触器常开辅助触头', mode: 'find', target: 'km1-no1' },
            { msg: '第 5 步：识别接触器常闭辅助触头', mode: 'find', target: 'km1-nc' },
            {
                msg: '第 6 步：测试题——主电路、控制电路的逻辑关系', mode: 'quiz',
                quizConfig: {
                    question: '在电机连续控制电路中，主电路与控制电路的逻辑关系是（　）。',
                    options: [
                        '主电路与控制电路相互独立，无任何联系',
                        '控制电路通过接触器线圈控制主触头通断，从而以弱电控制强电',
                        '主电路直接控制接触器线圈的得电与失电',
                        '控制电路必须先断电，主电路才能工作',
                    ],
                    answer: 1,
                    analysis: '控制电路中，起动按钮、停止按钮与接触器线圈串联（并辅以常开辅助触头自锁），通过小电流控制接触器线圈得电/失电，再由接触器主触头接通或断开主电路的大电流，实现以小控大、远距离控制。',
                },
            },
        ],
    },
    'panel-parts': {
        id: 'panel-parts', name: '3.电机控制箱实物识别',
        steps: [
            { msg: '第 1 步：识别起动控制箱中的空气开关（微型断路器）', mode: 'find', target: 'starter-panel', subTarget: 'cell-acb' },
            { msg: '第 2 步：识别控制箱中的接触器', mode: 'find', target: 'starter-panel', subTarget: 'cell-contact' },
            { msg: '第 3 步：识别控制箱中的热继电器', mode: 'find', target: 'starter-panel', subTarget: 'cell-fr' },
            { msg: '第 4 步：识别控制箱中的起动按钮', mode: 'find', target: 'starter-panel', subTarget: 'cell-start' },
            { msg: '第 5 步：识别控制箱中的停止按钮', mode: 'find', target: 'starter-panel', subTarget: 'cell-stop' },
            { msg: '第 6 步：识别控制箱中的熔断器', mode: 'find', target: 'starter-panel', subTarget: 'cell-fuse' },
            { msg: '第 7 步：识别控制箱中的时间继电器', mode: 'find', target: 'starter-panel', subTarget: 'cell-timer' },
            {
                msg: '第 8 步：测量接触器线圈的电压（ACV 档，应约为 220V）', mode: 'check',
                async act() {
                    const sys = this.sys;
                    await new Promise(r => setTimeout(r, 300));
                    sys.conns.length = 0;
                    _autoWire(sys);
                    await new Promise(r => setTimeout(r, 300));
                    _powerOn(sys);
                    await new Promise(r => setTimeout(r, 800));
                    _pressButton(this.sys, 'ss', 2500);
                    await new Promise(r => setTimeout(r, 3500));
                    const mm = sys.comps['multimeter'];
                    if (mm) {
                        mm.group.visible(true);
                        mm.mode = 'ACV500';
                        if (mm.pointer) mm.pointer.rotation(-150);
                        mm.update(mm.value);
                        sys.connMgr.addConn({ from: 'multimeter_wire_v', to: 'km1-coil_wire_a2', type: 'wire' });
                        sys.connMgr.addConn({ from: 'multimeter_wire_com', to: 'km1-coil_wire_a1', type: 'wire' });
                        sys.redrawAll();
                    }
                    await new Promise(r => setTimeout(r, 600));
                },
                check() {
                    const sys = this.sys;
                    const mm = sys.comps['multimeter'];
                    if (!mm || !mm.group || !mm.group.visible()) return false;
                    const c = (a, b) => sys.isPortConnected(a, b);
                    if (!(c('multimeter_wire_v', 'km1-coil_wire_a2') && c('multimeter_wire_com', 'km1-coil_wire_a1'))) return false;
                    if (!(mm.mode || '').startsWith('ACV')) return false;
                    const v = sys.getVoltageBetween ? sys.getVoltageBetween('km1-coil_wire_a2', 'km1-coil_wire_a1') : 0;
                    return v !== undefined && isFinite(v) && Math.abs(v) > 100;
                },
            },
        ],
    },
};

export const componentConfigs = [
    { Class: DiagramACPower3P, id: 'ac', x: 80, y: 30, vRms: 220, freq: 50, isOn: true, phaseSeq: 'pos', visible: true },
    { Class: DiagramThreePhaseACB, id: 'acb', x: 80, y: 140, height: 105, initState: 'off', label: 'QF', ratedVoltage: 380, ratedCurrent: 100, tripCurrent: 10, visible: true },
    { Class: MainContact, id: 'km1-mc', x: 70, y: 350, height: 105, deviceid: 'KM1', visible: true },
    { Class: ThermalHeatElement, id: 'fr', x: 70, y: 540, height: 100, deviceid: 'FR1', ratedCurrent: 100, tripClass: 20, visible: true },
    { Class: InductionMotor2, id: 'im01', x: 40, y: 700, visible: true,
        R1: 0.50, Lsigma1: 0.00334, Rc: 300, Lm: 0.0796,
        R2: 0.46, Lsigma2: 0.00334,
        J: 0.12, B: 0.01, polePairs: 2,
        ratedPower: 10, ratedSpeed: 1440,
        simpleModel: true, loadTorque: 20 },

    // 控制回路：熔断器 → 控制变压器 → 停止按钮 → 起动按钮 → 线圈 → 熔断器 → 回到变压器
    { Class: SinglePhaseFuse, id: 'fu4', x: 280, y: 150, label: 'FU4', ratedCurrent: 5, rotation: -90, visible: true },
    { Class: ControlTransformer, id: 'tc', x: 420, y: 110, primaryVoltage: 380, secondaryVoltage: 220, visible: true },
    { Class: SinglePhaseFuse, id: 'fu5', x: 580, y: 160, label: 'FU5', ratedCurrent: 5, rotation: -90, visible: true },
    { Class: DiagramStopButton, id: 'sb', x: 580, y: 200, visible: true ,label:'SB1'},
    { Class: DiagramStartButton, id: 'ss', x: 780, y: 200, visible: true ,label:'SB2'},
    { Class: AuxNOContact, id: 'km1-no1', x: 780, y: 350, deviceid: 'KM1', visible: true },
    { Class: ContactorCoil, id: 'km1-coil', x: 980, y: 200, deviceid: 'KM1', visible: true },
    { Class: ThermalNCContact, id: 'fr-nc', x: 950, y: 100, deviceid: 'FR1', visible: true },

    { Class: TsCurveDisplay, id: 'ts-curve', x: 1150, y: 100, visible: false, quadrants: 1 },
    { Class: Multimeter, id: 'multimeter', x: 880, y: 440, visible: false },    
    { Class: MF47Multimeter, id: 'mf47-panel', x: 1050, y: 180, visible: false },
    { Class: Oscilloscope_tri, id: 'osc', x: 50, y: 50, visible: false },
    { Class: SignalGenerator, id: 'sg', x: 50, y: 50, visible: false },
    { Class: ProcessCalibrator, id: 'cali', x: 50, y: 50, visible: false },
    { Class: ElecMeter, id: 'elecmeter', x: 50, y: 50, visible: false },

    // 电机起动控制箱（实物图片展示，用于考核点击识别设备）
    { Class: MotorStarterPanel, id: 'starter-panel', x: 1180, y: 20, visible: true },

    // 接触器常闭辅助触点 + 时间继电器（位于电机右侧）
    { Class: AuxNCContact, id: 'km1-nc', x: 300, y: 700, deviceid: 'KM1', visible: true },
    { Class: TimeRelayCoil, id: 'kt-coil', x: 470, y: 700, deviceid: 'KT1', label: 'KT1', delayTime: 5, visible: true },
    { Class: TimeDelayNOContact, id: 'kt-no', x: 300, y: 820, deviceid: 'KT1', label: 'KT1', visible: true },
    { Class: TimeDelayNCContact, id: 'kt-nc', x: 470, y: 820, deviceid: 'KT1', label: 'KT1', visible: true },
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
