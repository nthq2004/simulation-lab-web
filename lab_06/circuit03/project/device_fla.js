import { SingleLeadAcidBattery } from '../components/SingleLeadAcidBattery.js';
import { SmallLamp } from '../components/SmallLamp.js';
import { ConstantCurrentSource } from '../components/ConstantCurrentSource.js';
import { Switch } from '../components/Switch.js';
import { Resistor } from '../components/Resistor.js';
import { Multimeter } from '../components/Multimeter.js';
import { MF47Multimeter } from '../components/MF47Multimeter.js';
import { Oscilloscope_tri } from '../components/Osc_tri.js';
import { SignalGenerator } from '../components/SignalGenerator.js';
import { ProcessCalibrator } from '../components/ProcessCalibrator.js';
import { ElecMeter } from '../components/ElecMeter.js';
import { Hydrometer } from '../components/Hydrometer.js';

export const FAULT_CONFIGS = {
    sbt_sulfation: {
        id: 'sbt_sulfation', name: '硫化', system: '蓄电池',
        check() {
            const bt = window.sys && window.sys.comps && window.sys.comps.sbt;
            return bt && bt._faultSulfation;
        },
        trigger() {
            const bt = window.sys && window.sys.comps && window.sys.comps.sbt;
            if (bt) bt._faultSulfation = true;
        },
        repair() {
            const bt = window.sys && window.sys.comps && window.sys.comps.sbt;
            if (bt) bt._faultSulfation = false;
        },
    },
    sbt_lowElectrolyte: {
        id: 'sbt_lowElectrolyte', name: '电解液缺失', system: '蓄电池',
        check() {
            const bt = window.sys && window.sys.comps && window.sys.comps.sbt;
            return bt && bt._faultLowElectrolyte;
        },
        trigger() {
            const bt = window.sys && window.sys.comps && window.sys.comps.sbt;
            if (bt) bt._faultLowElectrolyte = true;
        },
        repair() {
            const bt = window.sys && window.sys.comps && window.sys.comps.sbt;
            if (bt) bt._faultLowElectrolyte = false;
        },
    },
};


export const PROJECT_WORKFLOWS = {
    'singlebattery-charge': {
        id: 'singlebattery-charge', name: '1.单节电池充电操作',
        steps: [
            {
                msg: '1. 设定蓄电池初始状态（SOC<0.1），模拟电量放完', mode: 'check',
                act() { const bt = this.sys.comps['sbt']; if (bt) bt.setSOC(0.05); },
                check() { const bt = this.sys.comps['sbt']; return bt && bt.getSOC() < 0.1; },
            },
            {
                msg: '2. 调出数字万用表，打到直流20V档，红表笔接电池正极、黑表笔接负极，测量端电压（应低于1.8V）', mode: 'check',
                act() {
                    const mm = this.sys.comps['multimeter'];
                    if (mm) { mm.group.visible(true); mm.mode = 'DCV20'; }
                    const sys = this.sys;
                    if (sys.connMgr) {
                        sys.connMgr.addConn({ from: 'multimeter_wire_v', to: 'sbt_wire_p', type: 'wire' });
                        sys.connMgr.addConn({ from: 'multimeter_wire_com', to: 'sbt_wire_n', type: 'wire' });
                    }
                    sys.redrawAll();
                },
                check() {
                    const mm = this.sys.comps['multimeter'];
                    if (!mm || !mm.group.visible() || mm.mode !== 'DCV20') return false;
                    const conns = this.sys.conns;
                    const exp = [
                        ['multimeter_wire_v', 'sbt_wire_p'],
                        ['multimeter_wire_com', 'sbt_wire_n'],
                    ];
                    return exp.every(([a, b]) => conns.some(c => (c.from === a && c.to === b) || (c.from === b && c.to === a)));
                },
            },
            {
                msg: '3. 用比重计测量电解液比重（应低于1.18）', mode: 'check',
                act() { const sbt = this.sys.comps['sbt']; const hy = this.sys.comps['hy1']; if (sbt && hy) { hy.setSpecificGravity(sbt.getSpecificGravity()); hy.group.visible(true); } },
                check() { const hy = this.sys.comps['hy1']; return hy && hy.group.visible() && hy.getSpecificGravity() < 1.18; },
            },
            {
                msg: '4. 连接充电线路：恒流源(+) → 开关 → 电池(+); 电池(-) → 采样电阻 → 恒流源(-)', mode: 'check',
                act() { _autoWireCharge(this.sys); },
                check() {
                    const exp = [
                        ['ccsrc_wire_i1', 'sw_wire_l'], ['sw_wire_r', 'sbt_wire_p'],
                        ['sbt_wire_n', 'r10_wire_l'], ['r10_wire_r', 'ccsrc_wire_com'],
                    ];
                    const conns = this.sys.conns;
                    return exp.every(([a, b]) => conns.some(c => (c.from === a && c.to === b) || (c.from === b && c.to === a)));
                },
            },
            {
                msg: '5. 合上开关，观察蓄电池充电过程（电压升高、比重上升）', mode: 'check',
                act() { const sw = this.sys.comps['sw']; if (sw) sw.isOn = true; },
                check() { const sw = this.sys.comps['sw']; return sw && sw.isOn; },
            },
            {
                msg: '6. 测试题：蓄电池放完电后的特征', mode: 'quiz',
                quizConfig: {
                    question: '蓄电池放完电（SOC接近0）后，以下哪项描述是正确的？',
                    options: [
                        '端电压低于1.8V，电解液比重低于1.18，正负极板均为PbSO₄',
                        '端电压为2.1V，电解液比重为1.28，正极为PbO₂负极为Pb',
                        '端电压为1.5V，电解液比重为1.30，正极为PbSO₄负极为Pb',
                        '端电压为0V，电解液为纯水，极板已完全溶解',
                    ],
                    answer: 0,
                    analysis: '蓄电池放完电后，端电压降至1.8V以下，电解液中硫酸被消耗比重降至1.18以下，正负极板均转化为PbSO₄，电解液接近纯水。',
                },
            },
        ],
    },
    'singlebattery-discharge': {
        id: 'singlebattery-discharge', name: '2.单节电池放电与灯泡负载实验',
        steps: [
            {
                msg: '1. 设定蓄电池初始状态（SOC>0.9），模拟电量充满', mode: 'check',
                act() { const bt = this.sys.comps['sbt']; if (bt) bt.setSOC(0.95); },
                check() { const bt = this.sys.comps['sbt']; return bt && bt.getSOC() > 0.9; },
            },
            {
                msg: '2. 调出数字万用表，打到直流20V档，红表笔接正极、黑表笔接负极，测量端电压（应接近2.1V）', mode: 'check',
                act() {
                    const mm = this.sys.comps['multimeter'];
                    if (mm) { mm.group.visible(true); mm.mode = 'DCV20'; }
                    const sys = this.sys;
                    if (sys.connMgr) {
                        sys.connMgr.addConn({ from: 'multimeter_wire_v', to: 'sbt_wire_p', type: 'wire' });
                        sys.connMgr.addConn({ from: 'multimeter_wire_com', to: 'sbt_wire_n', type: 'wire' });
                    }
                    sys.redrawAll();
                },
                check() {
                    const mm = this.sys.comps['multimeter'];
                    if (!mm || !mm.group.visible() || mm.mode !== 'DCV20') return false;
                    const conns = this.sys.conns;
                    const exp = [
                        ['multimeter_wire_v', 'sbt_wire_p'],
                        ['multimeter_wire_com', 'sbt_wire_n'],
                    ];
                    return exp.every(([a, b]) => conns.some(c => (c.from === a && c.to === b) || (c.from === b && c.to === a)));
                },
            },
            {
                msg: '3. 用比重计测量电解液比重（应接近1.3）', mode: 'check',
                act() { const sbt = this.sys.comps['sbt']; const hy = this.sys.comps['hy1']; if (sbt && hy) { hy.setSpecificGravity(sbt.getSpecificGravity()); hy.group.visible(true); } },
                check() { const hy = this.sys.comps['hy1']; return hy && hy.group.visible() && hy.getSpecificGravity() > 1.28; },
            },
            {
                msg: '4. 连接放电线路：电池(+) → 开关2 → 小灯泡 → 电池(-)', mode: 'check',
                act() { _autoWire2(this.sys); },
                check() {
                    const exp = [
                        ['sbt_wire_p', 'sw2_wire_l'], ['sw2_wire_r', 'lamp_wire_l'],
                        ['lamp_wire_r', 'sbt_wire_n'],
                    ];
                    const conns = this.sys.conns;
                    return exp.every(([a, b]) => conns.some(c => (c.from === a && c.to === b) || (c.from === b && c.to === a)));
                },
            },
            {
                msg: '5. 合上开关2，观察蓄电池放电过程（电压下降、灯泡发光）', mode: 'check',
                act() { const sw2 = this.sys.comps['sw2']; if (sw2) sw2.isOn = true; },
                check() { const sw2 = this.sys.comps['sw2']; return sw2 && sw2.isOn; },
            },
            {
                msg: '6. 测试题：蓄电池充满电后的特征', mode: 'quiz',
                quizConfig: {
                    question: '蓄电池充满电（SOC接近1）后，以下哪项描述是正确的？',
                    options: [
                        '端电压接近2.1V，电解液比重接近1.3，正极为PbO₂,负极为Pb',
                        '端电压低于1.8V，电解液比重低于1.18，两极板均为PbSO₄',
                        '端电压为1.5V，电解液比重为1.0，两极板均为Pb',
                        '端电压为0V，电解液为纯水，极板已溶解',
                    ],
                    answer: 0,
                    analysis: '蓄电池充满电后，端电压恢复至2.1V左右，电解液中硫酸浓度升高比重约1.3，正极板为PbO₂、负极板为海绵状Pb。',
                },
            },
        ],
    },
    'device-identification': {
        id: 'device-identification', name: '3.设备和部件识别',
        steps: [
            { msg: '1. 请点击识别蓄电池', mode: 'find', target: 'sbt' },
            { msg: '2. 请点击识别比重计', mode: 'find', target: 'hy1' },
            { msg: '3. 请调出数字万用表', mode: 'check',
              act() { const mm = this.sys.comps['multimeter']; if (mm) mm.group.visible(true); },
              check() { const mm = this.sys.comps['multimeter']; return mm && mm.group.visible(); },
            },
            { msg: '4. 请在蓄电池内部找到负极板并点击', mode: 'find', target: 'sbt', subTarget: 'neg-plate' },
            { msg: '5. 请在蓄电池内部找到隔板并点击', mode: 'find', target: 'sbt', subTarget: 'separator' },
            { msg: '6. 请在蓄电池内部找到正极板并点击', mode: 'find', target: 'sbt', subTarget: 'pos-plate' },
            { msg: '7. 测试题：蓄电池的组成', mode: 'quiz',
              quizConfig: {
                  question: '铅酸蓄电池主要由以下哪几部分组成？',
                  options: [
                      '正极板、负极板、隔板、电解液、外壳',
                      '正极板、负极板、电解液',
                      '正极板、隔板、电解液、外壳',
                      '正极板、负极板、隔板、外壳',
                  ],
                  answer: 0,
                  analysis: '铅酸蓄电池由正极板（PbO₂）、负极板（Pb）、隔板（防止短路）、电解液（稀硫酸）和外壳五部分组成。',
              },
            },
        ],
    },
};

export const componentConfigs = [
    { Class: SingleLeadAcidBattery, id: 'sbt', x: 400, y: 400, capacity: 56, initialSOC: 0.5, rOn: 0.001, rp: 0.017, cp: 13.8 },
    { Class: ConstantCurrentSource, id: 'ccsrc', x: 50, y: 50, currentValue: 1 },
    { Class: Switch, id: 'sw', x: 360, y: 280, isOn: false },
    { Class: Switch, id: 'sw2', x: 660, y: 220, isOn: false },
    { Class: Resistor, id: 'r10', x: 100, y: 560, value: 0.1, rotation: -90 },
    { Class: SmallLamp, id: 'lamp', x: 860, y: 220, lampColor: 'green' },
    { Class: Hydrometer, id: 'hy1', x: 1550, y: 200, specificGravity: 1.25 },
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
        { from: 'ccsrc_wire_i1', to: 'sw_wire_l', type: 'wire' },
        { from: 'sw_wire_r', to: 'sbt_wire_p', type: 'wire' },
        { from: 'sbt_wire_n', to: 'r10_wire_l', type: 'wire' },
        { from: 'r10_wire_r', to: 'ccsrc_wire_com', type: 'wire' },
        { from: 'sbt_wire_p', to: 'sw2_wire_l', type: 'wire' },
        { from: 'sw2_wire_r', to: 'lamp_wire_l', type: 'wire' },
        { from: 'lamp_wire_r', to: 'sbt_wire_n', type: 'wire' },
    ];
    cons.forEach(c => sys.connMgr.addConn(c));
    sys.redrawAll();
}

function _autoWire2(sys) {
    sys.conns.length = 0;
    const cons = [
        { from: 'sbt_wire_p', to: 'sw2_wire_l', type: 'wire' },
        { from: 'sw2_wire_r', to: 'lamp_wire_l', type: 'wire' },
        { from: 'lamp_wire_r', to: 'sbt_wire_n', type: 'wire' },
    ];
    cons.forEach(c => sys.connMgr.addConn(c));
    sys.redrawAll();
}

function _autoWireCharge(sys) {
    sys.conns.length = 0;
    const cons = [
        { from: 'ccsrc_wire_i1', to: 'sw_wire_l', type: 'wire' },
        { from: 'sw_wire_r', to: 'sbt_wire_p', type: 'wire' },
        { from: 'sbt_wire_n', to: 'r10_wire_l', type: 'wire' },
        { from: 'r10_wire_r', to: 'ccsrc_wire_com', type: 'wire' },
    ];
    cons.forEach(c => sys.connMgr.addConn(c));
    sys.redrawAll();
}

export function initSlider(_sys) { }

export function applyAllPresets() {
    const sys = (this && this.sys) ? this.sys : window.sys;
    if (!sys) return;
    _autoWire(sys);
}

export async function applyStartSystem() {
    const sys = (this && this.sys) ? this.sys : window.sys;
    if (!sys) return;
    _autoWire(sys);
}

export function fiveStep() { }
