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
import { Switch } from '../components/Switch.js';
import { ControlTransformer } from '../device/ControlTransformer.js';
import { MainContact } from '../device/MainContact.js';
import { ContactorCoil } from '../device/ContactorCoil.js';
import { AuxNOContact } from '../device/AuxNOContact.js';

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
    'self-lock-analysis': {
        id: 'self-lock-analysis', name: '1. 自锁控制电路分析',
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
                msg: '第 2 步：点击起动按钮（SB2），观察电动机能否正常起动并保持运行', mode: 'check',
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
                    return motor && motor.rpm < 500;
                },
            },
            {
                msg: '第 4 步：测试题——自锁环节的原理', mode: 'quiz',
                quizConfig: {
                    question: '在接触器自锁控制电路中，自锁环节的作用是什么？',
                    options: [
                        '当起动按钮松开后，依靠并联的辅助常开触点保持线圈持续通电',
                        '用于保护电动机免受过载损坏',
                        '用于实现电动机的正反转切换',
                        '用于在按下停止按钮后自动恢复运行',
                    ],
                    answer: 0,
                    analysis: '自锁环节利用接触器自身的辅助常开触头与起动按钮并联。当按下起动按钮、接触器线圈得电吸合后，辅助常开触头闭合，与起动按钮形成并联通路。松开起动按钮后，电流仍可通过辅助常开触头维持线圈通电，从而实现自锁保持。',
                },
            },
        ],
    },
    'self-lock-fault': {
        id: 'self-lock-fault', name: '2. 自锁故障分析',
        steps: [
            {
                msg: '第 1 步：接线并合上电源开关', mode: 'check',
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
                    const acb = this.sys.comps['acb'];
                    return acb && acb.isClosed();
                },
            },
            {
                msg: '第 2 步：设置自锁触头接触不良故障（辅助常开 COM 端子）', mode: 'check',
                async act() {
                    await new Promise(r => setTimeout(r, 200));
                    const fault = this.sys.FAULT_CONFIG && this.sys.FAULT_CONFIG['km1no1_com_poor'];
                    if (fault) fault.trigger();
                    await new Promise(r => setTimeout(r, 200));
                },
                check() {
                    return this.sys._poorContactPorts?.has('km1-no1_wire_com');
                },
            },
            {
                msg: '第 3 步：点击起动按钮（SB2），观察故障现象（电机仅在按下时转动，松开后即停）', mode: 'check',
                async act() {
                    await new Promise(r => setTimeout(r, 200));
                },
                check() {
                    const ss = this.sys.comps['ss'];
                    return ss && ss._isPressed;
                },
            },
            {
                msg: '第 4 步：断开电源，调出万用表，打到 200Ω 档位', mode: 'check',
                async act() {
                    await new Promise(r => setTimeout(r, 200));
                    const acb = this.sys.comps['acb'];
                    if (acb) acb.open();
                    const mm = this.sys.comps['multimeter'];
                    if (mm) {
                        mm.group.visible(true);
                        mm.group.position({ x: 780, y: 500 });
                        mm.mode = 'RES200';
                        mm._updateAngleByMode();
                        mm.update(0);
                    }
                    await new Promise(r => setTimeout(r, 300));
                },
                check() {
                    const acb = this.sys.comps['acb'];
                    const mm = this.sys.comps['multimeter'];
                    return acb && !acb.isClosed() && mm && mm.group.visible() && mm.mode === 'RES200';
                },
            },
            {
                msg: '第 5 步：将万用表红表笔测量触点引出线、触点本身的电阻', mode: 'check',
                async act() {
                    await new Promise(r => setTimeout(r, 200));
                    const sys = this.sys;
                    sys.connMgr.addConn({ from: 'multimeter_wire_v', to: 'sb_wire_nc4', type: 'wire' });
                    sys.connMgr.addConn({ from: 'multimeter_wire_com', to: 'km1-no1_wire_com', type: 'wire' });
                    sys.redrawAll();
                    await new Promise(r => setTimeout(r, 300));
                },
                check() {
                    const hasWire = (a, b) => this.sys.conns.some(c =>
                        c.type === 'wire' && ((c.from === a && c.to === b) || (c.from === b && c.to === a))
                    );
                    return hasWire('multimeter_wire_v', 'sb_wire_nc4')
                        && hasWire('multimeter_wire_com', 'km1-no1_wire_com');
                },
            },
            {
                msg: '第 6 步：万用表显示 OL（无穷大），确认 COM 端子接触不良。点击"修复"，合上电源，再点击起动按钮验证', mode: 'check',
                async act() {
                    await new Promise(r => setTimeout(r, 200));
                    const sys = this.sys;
                    // 清除万用表接线
                    sys.conns.length = 0;
                    _autoWire(sys);
                    // 修复故障
                    const fault = this.sys.FAULT_CONFIG && this.sys.FAULT_CONFIG['km1no1_com_poor'];
                    if (fault) fault.repair();
                    await new Promise(r => setTimeout(r, 200));
                    const acb = sys.comps['acb'];
                    if (acb) acb.close();
                    const mm = sys.comps['multimeter'];
                    if (mm) mm.group.visible(false);
                    await new Promise(r => setTimeout(r, 500));
                },
                check() {
                    const motor = this.sys.comps['im01'];
                    const noPoor = !this.sys._poorContactPorts?.has('km1-no1_wire_com');
                    const acb = this.sys.comps['acb'];
                    return motor && motor.rpm > 1000 && noPoor && acb && acb.isClosed();
                },
            },
            {
                msg: '第 7 步：测试题——断路故障的排查方法', mode: 'quiz',
                quizConfig: {
                    question: '在自锁控制电路中，若按下起动按钮时接触器吸合、松开后释放，最可能的故障原因是？',
                    options: [
                        '辅助常开触头（自锁触头）回路断路，无法维持线圈通电',
                        '起动按钮损坏，无法正常闭合',
                        '停止按钮损坏，无法正常复位',
                        '电源电压过低，接触器无法维持吸合',
                    ],
                    answer: 0,
                    analysis: '按下起动按钮时接触器吸合，说明线圈、起动按钮及电源均正常。松开后释放，说明自锁回路未能提供持续的电流通路。最直接的排查方法是：用万用表电阻档测量辅助常开触头的 COM 与 NO 两端，正常应短接（导通），若显示 OL 则说明该回路断路。',
                },
            },
        ],
    },
};

export const componentConfigs = [
    { Class: DiagramACPower3P, id: 'ac', x: 280, y: 20, vRms: 220, freq: 50, isOn: true, phaseSeq: 'pos', visible: true },
    { Class: DiagramThreePhaseACB, id: 'acb', x: 280, y: 100, initState: 'off', label: 'QF', ratedVoltage: 380, ratedCurrent: 100, tripCurrent: 10, visible: true },
    { Class: MainContact, id: 'km1-mc', x: 270, y: 290, deviceid: 'KM1', visible: true },
    { Class: InductionMotor2, id: 'im01', x: 240, y: 735, visible: true,
        R1: 0.50, Lsigma1: 0.00334, Rc: 300, Lm: 0.0796,
        R2: 0.46, Lsigma2: 0.00334,
        J: 0.12, B: 0.01, polePairs: 2,
        ratedPower: 10, ratedSpeed: 1440,
        simpleModel: true, loadTorque: 20 },

    // 控制回路：熔断器 → 控制变压器 → 停止按钮 → 起动按钮 → 线圈 → 熔断器 → 回到变压器
    { Class: SinglePhaseFuse, id: 'fu4', x: 500, y: 150, label: 'FU4', ratedCurrent: 5, rotation: -90, visible: true },
    { Class: ControlTransformer, id: 'tc', x: 650, y: 110, primaryVoltage: 380, secondaryVoltage: 220, visible: true },
    { Class: SinglePhaseFuse, id: 'fu5', x: 1180, y: 160, label: 'FU5', ratedCurrent: 5, rotation: -90, visible: true },
    { Class: DiagramStopButton, id: 'sb', x: 780, y: 200, visible: true ,label:'SB1'},
    { Class: DiagramStartButton, id: 'ss', x: 980, y: 200, visible: true ,label:'SB2'},
    { Class: AuxNOContact, id: 'km1-no1', x: 980, y: 350, deviceid: 'KM1', visible: true },
    { Class: ContactorCoil, id: 'km1-coil', x: 1180, y: 200, deviceid: 'KM1', visible: true },

    { Class: Switch, id: 'qs', x: 50, y: 50, visible: true, isOn: false, label: 'QS' },
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
        // 主回路：电源 → 断路器 → 接触器主触头 → 电动机
        { from: 'ac_wire_u', to: 'acb_wire_l1', type: 'wire' },
        { from: 'ac_wire_v', to: 'acb_wire_l2', type: 'wire' },
        { from: 'ac_wire_w', to: 'acb_wire_l3', type: 'wire' },
        { from: 'acb_wire_t1', to: 'km1-mc_wire_l1', type: 'wire' },
        { from: 'acb_wire_t2', to: 'km1-mc_wire_l2', type: 'wire' },
        { from: 'acb_wire_t3', to: 'km1-mc_wire_l3', type: 'wire' },
        { from: 'km1-mc_wire_t1', to: 'im01_wire_u1', type: 'wire' },
        { from: 'km1-mc_wire_t2', to: 'im01_wire_v1', type: 'wire' },
        { from: 'km1-mc_wire_t3', to: 'im01_wire_w1', type: 'wire' },
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
        // 线圈 → FU5 → 副边上端
        { from: 'km1-coil_wire_a2', to: 'fu5_wire_t', type: 'wire' },
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
