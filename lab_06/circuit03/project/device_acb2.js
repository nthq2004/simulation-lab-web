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

export const FAULT_CONFIGS = {};

export const PROJECT_WORKFLOWS = {
    'acb-close': {
        id: 'acb-close', name: '1. 断路器合闸送电',
        steps: [
            {
                msg: '1. 连接主回路：三相电源 → 断路器 → 熔断器→ 电动机，并将电动机接成 Y 形', mode: 'check',
                async act() {
                    await new Promise(r => setTimeout(r, 300));
                    _autoWire(this.sys);
                    await new Promise(r => setTimeout(r, 3000));
                },
                check() {
                    const c = (a, b) => this.sys.isPortConnected(a, b);
                    return c('ac_wire_u', 'acb_wire_l1')
                        && c('ac_wire_v', 'acb_wire_l2')
                        && c('ac_wire_w', 'acb_wire_l3')
                        && c('acb_wire_t1', 'fu1_wire_l')
                        && c('acb_wire_t2', 'fu2_wire_l')
                        && c('acb_wire_t3', 'fu3_wire_l')
                        && c('fu1_wire_t', 'im01_wire_u1')
                        && c('fu2_wire_t', 'im01_wire_v1')
                        && c('fu3_wire_t', 'im01_wire_w1')  
                        && c('im01_wire_u2', 'im01_wire_v2')
                        && c('im01_wire_v2', 'im01_wire_w2');
                },
            },
            {
                msg: '2. 闭合空气断路器（点击操作手柄），观察电动机起动过程', mode: 'check',
                async act() {
                    await new Promise(r => setTimeout(r, 300));
                    const acb = this.sys.comps['acb'];
                    if (acb) acb.close();
                    await new Promise(r => setTimeout(r, 2000));
                },
                check() {
                    const acb = this.sys.comps['acb'];
                    const motor = this.sys.comps['im01'];
                    return acb && acb.isClosed() && motor && motor.rpm > 1000;
                },
            },
            {
                msg: '3. 测试题：空气断路器合闸后的状态', mode: 'quiz',
                quizConfig: {
                    question: '三相空气断路器合闸后，以下哪项描述是正确的？',
                    options: [
                        '三极触头闭合，负载得电运行，手柄处于 ON 位置',
                        '三极触头断开，负载断电，手柄处于 OFF 位置',
                        '手柄弹至中间 TRIP 位置，负载断电',
                        '只有 L1 相通电，L2/L3 断开',
                    ],
                    answer: 0,
                    analysis: '断路器合闸后，三极触头同时闭合，负载得电正常运行，操作手柄处于 ON（合闸）位置。',
                },
            },
        ],
    },
    'acb-open': {
        id: 'acb-open', name: '2. 断路器分闸/跳闸操作',
        steps: [
            {
                msg: '1. 首先合闸送电，使电动机正常运行', mode: 'check',
                async act() {
                    await new Promise(r => setTimeout(r, 300));
                    _autoWire(this.sys);
                    await new Promise(r => setTimeout(r, 2000));
                    const ac = this.sys.comps['ac'];
                    if (ac) ac.onConfigUpdate({ vRms: 220, freq: 50, isOn: true, phaseSeq: 'pos' });
                    await new Promise(r => setTimeout(r, 2000));
                    const acb = this.sys.comps['acb'];
                    if (acb) acb.close();
                    await new Promise(r => setTimeout(r, 2000));
                },
                check() {
                    const acb = this.sys.comps['acb'];
                    return acb && acb.getState() === 'on' ;
                },
            },
            {
                msg: '2. 点击断路器操作手柄，进行分闸操作，观察电动机停机过程', mode: 'check',
                async act() {
                    await new Promise(r => setTimeout(r, 300));
                    const acb = this.sys.comps['acb'];
                    if (acb) acb.open();
                    await new Promise(r => setTimeout(r, 2000));
                },
                check() {
                    const acb = this.sys.comps['acb'];
                    return acb && acb.getState() === 'off';
                },
            },
            {
                msg: '3. 重新合闸后，触发跳闸（调用 trip），观察 TRIP 状态及手柄弹至中间位置', mode: 'check',
                async act() {
                    await new Promise(r => setTimeout(r, 300));
                    const ac = this.sys.comps['ac'];
                    if (ac) ac.onConfigUpdate({ vRms: 220, freq: 50, isOn: true, phaseSeq: 'pos' });
                    const acb = this.sys.comps['acb'];
                    if (acb) { acb.close(); setTimeout(() => acb.trip(), 2000); }
                    await new Promise(r => setTimeout(r, 1500));
                },
                check() {
                    const acb = this.sys.comps['acb'];
                    return acb && acb.isTripped();
                },
            },
            {
                msg: '4. 跳闸后先将手柄拨回 OFF（复位），再合闸恢复供电', mode: 'check',
                async act() {
                    await new Promise(r => setTimeout(r, 300));
                    const acb = this.sys.comps['acb'];
                    if (acb) { acb.open(); setTimeout(() => acb.close(), 2000); }
                    await new Promise(r => setTimeout(r, 1000));
                },
                check() {
                    const acb = this.sys.comps['acb'];
                    return acb && acb.isClosed();
                },
            },
            {
                msg: '5. 测试题：断路器跳闸后的正确操作', mode: 'quiz',
                quizConfig: {
                    question: '断路器跳闸（TRIP）后，正确的恢复操作顺序是？',
                    options: [
                        '先将手柄拨到 OFF（复位），再拨到 ON（合闸）',
                        '直接拨到 ON（合闸）即可',
                        '先关闭电源，再直接拨到 ON',
                        '断路器跳闸后不可恢复，必须更换',
                    ],
                    answer: 0,
                    analysis: '断路器跳闸后，操作手柄弹至中间 TRIP 位置，必须先将手柄拨向 OFF 侧完成复位，然后才能进行合闸操作。',
                },
            },
        ],
    },
    'acb-protect': {
        id: 'acb-protect', name: '3. 空气断路器保护脱扣测试',
        steps: [
            {
                msg: '1. 接通电源，接通空气断路器', mode: 'check',
                async act() {
                    await new Promise(r => setTimeout(r, 300));
                    _autoWire(this.sys);
                    _powerOn(this.sys);
                    await new Promise(r => setTimeout(r, 2000));
                    const acb = this.sys.comps['acb'];
                    if (acb) acb.close();
                    await new Promise(r => setTimeout(r, 500));
                },
                check() {
                    const acb = this.sys.comps['acb'];
                    return acb && acb.getState() === 'on';
                },
            },
            {
                msg: '2. 给分励脱扣器通电，观察分励脱扣过程', mode: 'check',
                async act() {
                    await new Promise(r => setTimeout(r, 300));
                    const sys = this.sys;
                    // 分励脱扣器 fla 接 L1（~220V），flb 接中性线 N
                    sys.connMgr.addConn({ from: 'acb_wire_fla', to: 'acb_wire_l1', type: 'wire' });
                    sys.connMgr.addConn({ from: 'acb_wire_flb', to: 'ac_wire_n', type: 'wire' });
                    sys.redrawAll();
                    // 等待分励脱扣（线圈通电后下一帧即触发 trip）
                    await new Promise(r => setTimeout(r, 2000));
                },
                check() {
                    const acb = this.sys.comps['acb'];
                    if (!acb) return false;
                    const vCoil = Math.abs((acb._shuntTripCurrent || 0) * (acb._tripCoilR || 50));
                    return vCoil > 15;
                },
            },
            {
                msg: '3. 短接空气断路器的 T1、T2、T3任意两个端口，观察过流脱扣过程', mode: 'check',
                async act() {
                    await new Promise(r => setTimeout(r, 2000));
                    const sys = this.sys;
                    // 清除旧接线（含分励脱扣器线），重连电源到断路器
                    sys.conns.length = 0;
                    sys.connMgr.addConn({ from: 'ac_wire_u', to: 'acb_wire_l1', type: 'wire' });
                    sys.connMgr.addConn({ from: 'ac_wire_v', to: 'acb_wire_l2', type: 'wire' });
                    sys.connMgr.addConn({ from: 'ac_wire_w', to: 'acb_wire_l3', type: 'wire' });
                    // 短接 T1-T2（模拟相间短路）
                    sys.connMgr.addConn({ from: 'acb_wire_t1', to: 'acb_wire_t2', type: 'wire' });
                    sys.redrawAll();
                    await new Promise(r => setTimeout(r, 2000));
                    // 复位断路器：TRIP → OFF → ON
                    const acb = this.sys.comps['acb'];
                    if (acb) {
                        acb._resetToOff();
                        await new Promise(r => setTimeout(r, 2000));
                        acb.close();
                    }
                    // 等待过流脱扣（40 点 RMS 缓冲 ≈2s + 余量）
                    await new Promise(r => setTimeout(r, 3500));
                },
                check() {
                    const c = (a, b) => this.sys.isPortConnected(a, b);
                    // 检测 T1、T2、T3 是否有任意两端短接
                    return c('acb_wire_t1', 'acb_wire_t2')
                        || c('acb_wire_t2', 'acb_wire_t3')
                        || c('acb_wire_t1', 'acb_wire_t3');
                },
            },
            {
                msg: '4. 测试题：空气断路器脱扣原理', mode: 'quiz',
                quizConfig: {
                    question: '关于空气断路器脱扣保护，以下哪项描述是正确的？',
                    options: [
                        '分励脱扣器通电时线圈产生电磁力使断路器跳闸；过流脱扣通过检测负载电流超过设定值实现保护',
                        '分励脱扣器必须手动按下才能工作；过流脱扣检测电压是否过高',
                        '分励脱扣器在断路器 OFF 状态也能触发跳闸',
                        '分励脱扣器和过流脱扣都是通过加热双金属片实现',
                    ],
                    answer: 0,
                    analysis: '分励脱扣器（Shunt Trip）通过外接电源驱动电磁铁使断路器跳闸，常用于远程控制与紧急分闸；过流脱扣通过电流检测，当负载电流超过额定脱扣电流（通常为额定电流的若干倍）时自动触发跳闸，保护线路和设备免受过载损坏。',
                },
            },
        ],
    },
};

export const componentConfigs = [
    { Class: DiagramACPower3P, id: 'ac', x: 280, y: 20, vRms: 220, freq: 50, isOn: true, phaseSeq: 'pos', visible: true },
    { Class: DiagramThreePhaseACB, id: 'acb', x: 280, y: 100, initState: 'off', label: 'QF', ratedVoltage: 380, ratedCurrent: 100, tripCurrent: 10, visible: true },
    { Class: SinglePhaseFuse, id: 'fu1', x: 283, y: 260, label: 'FU1', ratedCurrent: 210, visible: true },
    { Class: SinglePhaseFuse, id: 'fu2', x: 333, y: 260, label: 'FU2', ratedCurrent: 210, visible: true },
    { Class: SinglePhaseFuse, id: 'fu3', x: 383, y: 260, label: 'FU3', ratedCurrent: 210, visible: true },
    { Class: InductionMotor2, id: 'im01', x: 240, y: 740, visible: true,
        R1: 0.50, Lsigma1: 0.00334, Rc: 300, Lm: 0.0796,
        R2: 0.46, Lsigma2: 0.00334,
        J: 0.12, B: 0.01, polePairs: 2,
        ratedPower: 10, ratedSpeed: 1440,
        simpleModel: true, loadTorque: 20 },

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
        { from: 'ac_wire_u', to: 'acb_wire_l1', type: 'wire' },
        { from: 'ac_wire_v', to: 'acb_wire_l2', type: 'wire' },
        { from: 'ac_wire_w', to: 'acb_wire_l3', type: 'wire' },
        { from: 'acb_wire_t1', to: 'fu1_wire_l', type: 'wire' },
        { from: 'acb_wire_t2', to: 'fu2_wire_l', type: 'wire' },
        { from: 'acb_wire_t3', to: 'fu3_wire_l', type: 'wire' },
        { from: 'fu1_wire_t', to: 'im01_wire_u1', type: 'wire' },
        { from: 'fu2_wire_t', to: 'im01_wire_v1', type: 'wire' },
        { from: 'fu3_wire_t', to: 'im01_wire_w1', type: 'wire' },
        { from: 'im01_wire_u2', to: 'im01_wire_v2', type: 'wire' },
        { from: 'im01_wire_v2', to: 'im01_wire_w2', type: 'wire' },
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
