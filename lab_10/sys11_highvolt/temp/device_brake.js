// 圆盘式电磁制动器（失电制动器）仿真工程 — 2 个操作项目
// 电路：DC + → 制动器线圈A1；DC - → 制动器线圈A2
// 原理：通电吸合衔铁松闸（转轴可自由转动）；断电弹簧推衔铁压紧制动盘抱闸（转速减速停止）

import { DCPower } from '../components/DCPower.js';
import { DiscElectromagneticBrake } from '../components/DiscElectromagneticBrake.js';
import { FeelerGauge } from '../components/FeelerGauge.js';
import { Multimeter } from '../components/Multimeter.js';
import { MF47Multimeter } from '../components/MF47Multimeter.js';
import { Oscilloscope_tri } from '../components/Osc_tri.js';
import { SignalGenerator } from '../components/SignalGenerator.js';
import { ProcessCalibrator } from '../components/ProcessCalibrator.js';
import { ElecMeter } from '../components/ElecMeter.js';

export const FAULT_CONFIGS = {
    coil_open: {
        id: 'coil_open', name: '线圈断线', system: '制动器',
        check()  { const c = window.sys && window.sys.comps && window.sys.comps.brk1; return c && c._faultCoilOpen; },
        trigger() { const c = window.sys && window.sys.comps && window.sys.comps.brk1; if (c) c._faultCoilOpen = true; },
        repair() { const c = window.sys && window.sys.comps && window.sys.comps.brk1; if (c) c._faultCoilOpen = false; },
    },
    stuck: {
        id: 'stuck', name: '衔铁卡死', system: '制动器',
        check()  { const c = window.sys && window.sys.comps && window.sys.comps.brk1; return c && c._faultStuck; },
        trigger() { const c = window.sys && window.sys.comps && window.sys.comps.brk1; if (c) c._faultStuck = true; },
        repair() { const c = window.sys && window.sys.comps && window.sys.comps.brk1; if (c) c._faultStuck = false; },
    },
    pad_wear: {
        id: 'pad_wear', name: '摩擦片磨损0.5mm', system: '制动器',
        check()  { const c = window.sys && window.sys.comps && window.sys.comps.brk1; return c && c._faultPadWear; },
        trigger() {
            const c = window.sys && window.sys.comps && window.sys.comps.brk1;
            if (!c) return;
            c._faultPadWear = true;
            // 记录故障前气隙；磨损使动衔铁带摩擦片右移、工作气隙自动增大（磁轭不动）
            if (c._airGapBeforePadWear === undefined) c._airGapBeforePadWear = c.getAirGap();
            c.setPadWear(0.5);
        },
        repair() {
            const c = window.sys && window.sys.comps && window.sys.comps.brk1;
            if (!c) return;
            c._faultPadWear = false;
            // 更换摩擦片：磨损量归零、恢复故障前气隙
            const restore = c._airGapBeforePadWear !== undefined ? c._airGapBeforePadWear : 0.8;
            c._airGapBeforePadWear = undefined;
            c.setPadWear(0);
            c.setAirGap(restore);
        },
    },
};

export const PROJECT_WORKFLOWS = {

    // ============================================================
    // 项目1：松闸与抱闸原理
    // ============================================================
    'brake-principle': {
        id: 'brake-principle',
        name: '1. 电磁制动器松闸/抱闸原理',
        steps: [
            {
                msg: '第 1 步：接通直流电源（DC24V），接线：直流电源+→制动器线圈A1；直流电源-→制动器线圈A2。接通后观察：衔铁被吸向铁心（压缩弹簧），摩擦片离开制动盘，制动器松闸。',
                mode: 'check',
                async act() {
                    await new Promise(r => setTimeout(r, 500));
                    const sys = this.sys;
                    sys.conns.length = 0;
                    const dc = sys.comps['dc1'];
                    const brk = sys.comps['brk1'];
                    if (dc) { dc.isOn = false; dc.update(); }
                    await new Promise(r => setTimeout(r, 200));
                    const cons = [
                        { from: 'dc1_wire_p', to: 'brk1_wire_a1', type: 'wire' },
                        { from: 'dc1_wire_n', to: 'brk1_wire_a2', type: 'wire' },
                    ];
                    cons.forEach(c => sys.connMgr.addConn(c));
                    if (dc) { dc.isOn = true; dc.update(); }
                    sys.redrawAll();
                    await new Promise(r => setTimeout(r, 1200));
                },
                check() {
                    const c = (a, b) => this.sys.isPortConnected(a, b);
                    const brk = this.sys.comps['brk1'];
                    const dc = this.sys.comps['dc1'];
                    return brk && brk.isEnergized()
                        && dc && dc.isOn
                        && c('dc1_wire_p', 'brk1_wire_a1')
                        && c('dc1_wire_n', 'brk1_wire_a2');
                },
            },
            {
                msg: '第 2 步：通电松闸状态下，点击转轴（或用鼠标拖住转轴区域拨动），转轴被拨动后可以保持自由转动，转速稳定不衰减。',
                mode: 'check',
                async act() {
                    await new Promise(r => setTimeout(r, 300));
                    const brk = this.sys.comps['brk1'];
                    if (brk) brk.handSpin(900);
                    await new Promise(r => setTimeout(r, 1500));
                },
                check() {
                    const brk = this.sys.comps['brk1'];
                    return brk && brk.isEnergized() && brk.getSpeed() > 400;
                },
            },
            {
                msg: '第 3 步：关闭直流电源，观察：弹簧推动衔铁右移，摩擦片压紧制动盘，制动盘压向固定压板 → 抱闸。若转轴原先在转动，将减速停止。',
                mode: 'check',
                async act() {
                    await new Promise(r => setTimeout(r, 300));
                    const sys = this.sys;
                    const dc = sys.comps['dc1'];
                    if (dc) { dc.isOn = false; dc.update(); }
                    await new Promise(r => setTimeout(r, 2500));
                },
                check() {
                    const brk = this.sys.comps['brk1'];
                    return brk && brk.isBraking() && brk.getSpeed() < 5;
                },
            },
            {
                msg: '第 4 步：测试题',
                mode: 'quiz',
                quizConfig: {
                    question: '圆盘式电磁制动器属于失电制动器，其工作原理是？',
                    options: [
                        '通电时抱闸制动，断电时松闸',
                        '通电时衔铁吸合松闸，断电时弹簧推衔铁压紧制动盘抱闸',
                        '依靠永久磁铁抱闸，与通电无关',
                        '断电时摩擦片自动脱离制动盘',
                    ],
                    answer: 1,
                    analysis: '圆盘式电磁制动器是失电（spring-set）制动器：通电时电磁力克服弹簧力使衔铁吸合、摩擦片脱离制动盘（松闸）；断电时电磁力消失，弹簧推动衔铁使摩擦片压紧制动盘，制动盘压向固定压板产生摩擦力矩（抱闸），实现安全停车。',
                },
            },
        ],
    },
    // ============================================================
    // 项目2：气隙调节与塞尺测量
    // ============================================================
    'brake-gap-measure': {
        id: 'brake-gap-measure',
        name: '2. 气隙调节与塞尺测量',
        steps: [
            {
                msg: '第 1 步：点击工具栏「故障设置」，勾选「摩擦片磨损0.5mm」故障并应用，工作气隙自动增大到 1.3mm。',
                mode: 'check',
                async act() {
                    await new Promise(r => setTimeout(r, 300));
                    const cfg = this.sys.FAULT_CONFIG && this.sys.FAULT_CONFIG.pad_wear;
                    if (cfg) cfg.trigger();
                    await new Promise(r => setTimeout(r, 500));
                },
                check() {
                    const brk = this.sys.comps['brk1'];
                    return brk && brk._faultPadWear === true
                        && typeof brk.getAirGap === 'function' && Math.abs(brk.getAirGap() - 1.3) < 0.02;
                },
            },
            {
                msg: '第 2 步：断开电源使制动器抱闸（气隙张开），用塞尺测量：1.2mm 塞尺片可顺利插入，1.5mm 塞尺片卡阻（气隙在 1.2~1.5mm 之间）。',
                mode: 'check',
                async act() {
                    await new Promise(r => setTimeout(r, 300));
                    const sys = this.sys;
                    const dc = sys.comps['dc1'];
                    const brk = sys.comps['brk1'];
                    if (dc) { dc.isOn = false; dc.update(); }
                    // 等待制动器完成抱闸（气隙张开），避免断电瞬间测量被阻止
                    await new Promise(r => setTimeout(r, 400));
                    const feeler = sys.comps['feeler'];
                    if (feeler) {
                        feeler.setBlade(5); feeler.measure();   // 1.2mm → 插入
                        feeler.setBlade(6); feeler.measure();   // 1.5mm → 卡阻
                    }
                    if (brk) brk.handSpin(0);
                    await new Promise(r => setTimeout(r, 800));
                },
                check() {
                    const feeler = this.sys.comps['feeler'];
                    const log = feeler && feeler._measureLog;
                    return Array.isArray(log) && log.length === 2
                        && log[0] && log[0].blade === 1.2 && log[0].insert === true
                        && log[1] && log[1].blade === 1.5 && log[1].insert === false;
                },
            },
            {
                msg: '第 3 步：用制动器磁轭左侧的「气隙调节」旋钮（滚轮或上下拖动），把工作气隙调回到 0.8mm。',
                mode: 'check',
                async act() {
                    await new Promise(r => setTimeout(r, 300));
                    const brk = this.sys.comps['brk1'];
                    if (brk) brk.setAirGap(0.8);
                    await new Promise(r => setTimeout(r, 500));
                },
                check() {
                    const brk = this.sys.comps['brk1'];
                    return brk && typeof brk.getAirGap === 'function' && Math.abs(brk.getAirGap() - 0.8) < 0.02;
                },
            },
            {
                msg: '第 4 步：再用塞尺测量：0.6mm 塞尺片可顺利插入，0.8mm 塞尺片卡阻（气隙已恢复正常 0.8mm 左右）。',
                mode: 'check',
                async act() {
                    await new Promise(r => setTimeout(r, 300));
                    const feeler = this.sys.comps['feeler'];
                    if (feeler) {
                        feeler.setBlade(2); feeler.measure();   // 0.6mm → 插入
                        feeler.setBlade(3); feeler.measure();   // 0.8mm → 卡阻
                    }
                    await new Promise(r => setTimeout(r, 500));
                },
                check() {
                    const feeler = this.sys.comps['feeler'];
                    const log = feeler && feeler._measureLog;
                    return Array.isArray(log) && log.length === 2
                        && log[0] && log[0].blade === 0.6 && log[0].insert === true
                        && log[1] && log[1].blade === 0.8 && log[1].insert === false;
                },
            },
            {
                msg: '第 5 步：测试题',
                mode: 'quiz',
                quizConfig: {
                    question: '摩擦片磨损 0.5mm 使制动器工作气隙增大到 1.3mm，其直接后果是？',
                    options: [
                        '制动力矩增大，制动更灵敏',
                        '磁轭磁阻增大、吸合力下降，抱闸变松，制动不可靠',
                        '线圈电流增大，制动力矩不变',
                        '气隙增大对制动器性能没有影响',
                    ],
                    answer: 1,
                    analysis: '摩擦片磨损使工作气隙增大：磁路磁阻增大、通电吸合力下降（松闸不彻底），同时弹簧压缩量减小使抱闸力下降，严重时制动器无法可靠制动。发现气隙超限应及时重新调整气隙或更换摩擦片。',
                },
            },
        ],
    },
};

export const componentConfigs = [
    { Class: DCPower, id: 'dc1', x: 20, y: 120, voltage: 24, isOn: true, visible: true },
    { Class: DiscElectromagneticBrake, id: 'brk1', x: 430, y: 120, visible: true, initState: 'off', coilResistance: 500, ratedCoilVoltage: 24, airGapMM: 0.8 },
    { Class: FeelerGauge, id: 'feeler', x: 560, y: 600, visible: true },

    { Class: Multimeter, id: 'multimeter', x: 940, y: 90, visible: false },
    { Class: MF47Multimeter, id: 'mf47-panel', x: 1050, y: 150, visible: false },
    { Class: Oscilloscope_tri, id: 'osc', x: 50, y: 50, visible: false },
    { Class: SignalGenerator, id: 'sg', x: 50, y: 50, visible: false },
    { Class: ProcessCalibrator, id: 'cali', x: 50, y: 50, visible: false },
    { Class: ElecMeter, id: 'elecmeter', x: 700, y: 100, visible: false },
];

function _wireBase(sys) {
    sys.conns.length = 0;
    const cons = [
        { from: 'dc1_wire_p', to: 'brk1_wire_a1', type: 'wire' },
        { from: 'dc1_wire_n', to: 'brk1_wire_a2', type: 'wire' },
    ];
    cons.forEach(c => sys.connMgr.addConn(c));
    sys.redrawAll();
}

export function initSlider(sys) {
}

export function applyAllPresets() {
    const sys = this && this.sys ? this.sys : window.sys;
    if (!sys) return;
    _wireBase(sys);
    const dc = sys.comps['dc1'];
    if (dc) { dc.isOn = true; dc.update(); }
}

export async function applyStartSystem() {
    const sys = this && this.sys ? this.sys : window.sys;
    if (!sys) return;
    _wireBase(sys);
    const dc = sys.comps['dc1'];
    if (dc) { dc.isOn = true; dc.update(); }
}

export function fiveStep() {}
