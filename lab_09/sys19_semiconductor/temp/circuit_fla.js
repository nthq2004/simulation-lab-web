// 铅酸蓄电池充放电仿真工程
// 电路：AC 220V → 开关 → 充放电板 → 12V铅酸蓄电池×2
// 比重计用于测量电解液比重

import { ACPower } from '../components/ACPower.js';
import { Switch } from '../components/Switch.js';
import { ChargeBoard } from '../components/ChargeBoard.js';
import { LeadAcidBattery } from '../components/LeadAcidBattery.js';
import { Hydrometer } from '../components/Hydrometer.js';
import { Multimeter } from '../components/Multimeter.js';
import { MF47Multimeter } from '../components/MF47Multimeter.js';
import { Oscilloscope_tri } from '../components/Osc_tri.js';
import { SignalGenerator } from '../components/SignalGenerator.js';
import { ProcessCalibrator } from '../components/ProcessCalibrator.js';
import { ElecMeter } from '../components/ElecMeter.js';
import { Resistor } from '../components/Resistor.js';

export const FAULT_CONFIGS = {
    bt_sulfation: {
        id: 'bt_sulfation', name: '硫化', system: '蓄电池',
        check() {
            const bt = window.sys && window.sys.comps && window.sys.comps.bt1;
            return bt && bt._faultSulfation;
        },
        trigger() {
            const bt = window.sys && window.sys.comps && window.sys.comps.bt1;
            if (bt) bt._faultSulfation = true;
        },
        repair() {
            const bt = window.sys && window.sys.comps && window.sys.comps.bt1;
            if (bt) bt._faultSulfation = false;
        },
    },
    bt_lowElectrolyte: {
        id: 'bt_lowElectrolyte', name: '电解液缺失', system: '蓄电池',
        check() {
            const bt = window.sys && window.sys.comps && window.sys.comps.bt1;
            return bt && bt._faultLowElectrolyte;
        },
        trigger() {
            const bt = window.sys && window.sys.comps && window.sys.comps.bt1;
            if (bt) bt._faultLowElectrolyte = true;
        },
        repair() {
            const bt = window.sys && window.sys.comps && window.sys.comps.bt1;
            if (bt) bt._faultLowElectrolyte = false;
        },
    },
};

export const PROJECT_WORKFLOWS = {
    'leadacid-charge': {
        id: 'leadacid-charge',
        name: '1.铅酸蓄电池充电操作',
        steps: [
            {
                msg: '1. 按电路图接好所有连线：AC 220V → 充放电板 → 两个12V蓄电池串联（24V）',
                mode: 'check',
                act() { _autoWire(this.sys); },
                check() {
                    const exp = [
                        ['ac_wire_p', 'cb_wire_ac_l'],
                        ['ac_wire_n', 'cb_wire_ac_n'],
                        ['cb_wire_ch1_p', 'bt1_wire_cell1_p'],
                        ['bt1_wire_cell6_n', 'bt2_wire_cell1_p'],
                        ['bt2_wire_cell6_n', 'cb_wire_ch1_n'],
                    ];
                    const conns = this.sys.conns;
                    return exp.every(([a, b]) =>
                        conns.some(c => (c.from === a && c.to === b) || (c.from === b && c.to === a))
                    );
                },
            },
            {
                msg: '2. 闭合电源开关，充放电板交流指示灯应变亮',
                mode: 'check',
                act() {
                    const ac = this.sys.comps['ac'];
                    if (ac) { ac.isOn = true; ac.update(); }
                },
                check() {
                    const ac = this.sys.comps['ac'];
                    return ac && ac.isOn ;
                },
            },
            {
                msg: '3. 将充放电板仪表切换开关拨到"I路"，观察CH1的电压和电流数值，默认为浮充模式。',
                mode: 'check',
                act() {
                    const cb = this.sys.comps['cb'];
                    if (cb) cb._meterSwitchPos = -1;
                },
                check() {
                    const cb = this.sys.comps['cb'];
                    return cb && cb._meterSwitchPos === -1;
                },
            },
            {
                msg: '4. 将充放电板CH1切换到"均充"模式，观察充电电压和充电电流变化',
                mode: 'check',
                act() {
                    const cb = this.sys.comps['cb'];
                    if (cb) cb._ch1FloatMode = false;
                },
                check() {
                    const cb = this.sys.comps['cb'];
                    return cb && !cb._ch1FloatMode;
                },
            },
            {
                msg: '5. 调整充电电流，将充电电流调整到接近额定值的一半。',
                mode: 'check',
                act() {
                    const cb = this.sys.comps['cb'];
                    if (cb) {
                        cb._ch1CurrentAdj = 0.3;
                        cb._updateKnob('_ch1CurrentAdj');
                    }
                },
                check() {
                    const cb = this.sys.comps['cb'];
                    return cb && cb._ch1CurrentAdj >= 0.22 && cb._ch1CurrentAdj <= 0.32;
                },
            },
            {
                msg: '6. 测试题：铅酸蓄电池充电特性',
                mode: 'quiz',
                quizConfig: {
                    question: '铅酸蓄电池浮充充电和均充充电的主要区别是什么？',
                    options: [
                        '浮充电压高于均充电压',
                        '均充电压高于浮充电压，用于快速充电和活化电池',
                        '浮充用于放电，均充用于充电',
                        '两者没有区别',
                    ],
                    answer: 1,
                    analysis: '浮充充电是在电池充满后以恒定电压（约27V）维持电池容量；均充充电以较高电压（28.8V）进行快速充电，用于补充深放电后的电池容量和消除硫化。',
                },
            },
        ],
    },

    'leadacid-discharge': {
        id: 'leadacid-discharge',
        name: '2.铅酸蓄电池电压与比重测量，判定电池状态',
        steps: [
            {
                msg: '1. 将两组12V蓄电池串联，并将它们的初始容量都设置为0.02，模拟电池电量用光',
                mode: 'check',
                act() {
                    const bt1 = this.sys.comps['bt1'];
                    const bt2 = this.sys.comps['bt2'];
                    if (bt1) bt1.setSOC(0.02);
                    if (bt2) bt2.setSOC(0.02);
                },
                check() {
                    const bt1 = this.sys.comps['bt1'];
                    const bt2 = this.sys.comps['bt2'];
                    return bt1 && bt2 && Math.abs(bt1.getSOC() - 0.02) < 0.03 && Math.abs(bt2.getSOC() - 0.02) < 0.03;
                },
            },
            {
                msg: '2. 调出数字式万用表，打到直流200V档，测量蓄电池组电压',
                mode: 'check',
                act() {
                    const mm = this.sys.comps['multimeter'];
                    if (mm) { mm.group.visible(true); mm.mode = 'DCV200'; }
                },
                check() {
                    const mm = this.sys.comps['multimeter'];
                    if (!mm || !mm.group.visible()) return false;
                    const exp = [
                        ['multimeter_wire_v', 'bt1_wire_cell1_p'],
                        ['multimeter_wire_com', 'bt2_wire_cell6_n'],
                    ];
                    const conns = this.sys.conns;
                    return exp.every(([a, b]) =>
                        conns.some(c => (c.from === a && c.to === b) || (c.from === b && c.to === a))
                    );
                },
            },
            {
                msg: '3. 打开一个注液孔，使用比重计吸取电解液，读取比重',
                mode: 'check',
                act() {
                    const bt1 = this.sys.comps['bt1'];
                    const hy1 = this.sys.comps['hy1'];
                    if (bt1 && hy1) hy1.setSpecificGravity(bt1.getSpecificGravity());
                },
                check() {
                    const hy1 = this.sys.comps['hy1'];
                    return hy1 && hy1.getSpecificGravity() <= 1.19;
                },
            },
            {
                msg: '4. 将它们的初始容量都设置为0.99，模拟电池充满电',
                mode: 'check',
                act() {
                    const bt1 = this.sys.comps['bt1'];
                    const bt2 = this.sys.comps['bt2'];
                    if (bt1) bt1.setSOC(0.99);
                    if (bt2) bt2.setSOC(0.99);
                },
                check() {
                    const bt1 = this.sys.comps['bt1'];
                    const bt2 = this.sys.comps['bt2'];
                    return bt1 && bt2 && Math.abs(bt1.getSOC() - 0.99) < 0.03 && Math.abs(bt2.getSOC() - 0.99) < 0.03;
                },
            },
            {
                msg: '5. 使用数字式万用表，打到直流200V档，测量蓄电池组电压',
                mode: 'check',
                act() {
                    const mm = this.sys.comps['multimeter'];
                    if (mm) { mm.group.visible(true); mm.mode = 'DCV200'; }
                },
                check() {
                    const mm = this.sys.comps['multimeter'];
                    if (!mm || !mm.group.visible()) return false;
                    const exp = [
                        ['multimeter_wire_v', 'bt1_wire_cell1_p'],
                        ['multimeter_wire_com', 'bt2_wire_cell6_n'],
                    ];
                    const conns = this.sys.conns;
                    return exp.every(([a, b]) =>
                        conns.some(c => (c.from === a && c.to === b) || (c.from === b && c.to === a))
                    );
                },
            },
            {
                msg: '6. 打开一个注液孔，使用比重计吸取电解液，读取比重',
                mode: 'check',
                act() {
                    const bt1 = this.sys.comps['bt1'];
                    const hy1 = this.sys.comps['hy1'];
                    if (bt1 && hy1) hy1.setSpecificGravity(bt1.getSpecificGravity());
                },
                check() {
                    const hy1 = this.sys.comps['hy1'];
                    return hy1 && hy1.getSpecificGravity() >= 1.28;
                },
            },
            {
                msg: '7. 测试题：铅酸蓄电池状态判断',
                mode: 'quiz',
                quizConfig: {
                    question: '铅酸蓄电池在亏电（放电）状态和充满电状态相比，开路电压和电解液比重如何变化？',
                    options: [
                        '电压升高，比重升高',
                        '电压降低，比重降低',
                        '电压不变，比重升高',
                        '电压降低，比重不变',
                    ],
                    answer: 1,
                    analysis: '铅酸蓄电池亏电时，开路电压和电解液比重都会较满电时降低。电压和比重是判断电池荷电状态（SOC）的双重指标，两者应同时参考。',
                },
            },
        ],
    },
};

export const componentConfigs = [
    // ── 主电路 ──
    { Class: ACPower, id: 'ac', x: 600, y: 2, vRms: 220, freq: 50, isOn: false },
    { Class: Switch, id: 'sw', x: 1200, y: 300, isOn: false },
    { Class: ChargeBoard, id: 'cb', x: 400, y: 220, ch1FloatMode: true, ch2FloatMode: true },
    { Class: LeadAcidBattery, id: 'bt1', x: 250, y: 670, capacity: 56, initialSOC: 0.5, rOn: 0.006, rp: 0.1, cp: 2.3 },
    { Class: LeadAcidBattery, id: 'bt2', x: 750, y: 670, capacity: 56, initialSOC: 0.8, rOn: 0.006, rp: 0.1, cp: 2.3 },
    { Class: Hydrometer, id: 'hy1', x: 1550, y: 200, specificGravity: 1.25 },
    { Class: Resistor, id: 'load', x: 1350, y: 300, resistance: 10, visible: true },

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
        { from: 'ac_wire_p', to: 'cb_wire_ac_l', type: 'wire' },
        { from: 'ac_wire_n', to: 'cb_wire_ac_n', type: 'wire' },
        // 充放电板第1路 → 两个12V蓄电池串联 → 24V
        { from: 'cb_wire_ch1_p', to: 'bt1_wire_cell1_p', type: 'wire' },
        { from: 'bt1_wire_cell6_n', to: 'bt2_wire_cell1_p', type: 'wire' },
        { from: 'bt2_wire_cell6_n', to: 'cb_wire_ch1_n', type: 'wire' },
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
    const ac = sys.comps['ac'];
    if (ac) { ac.isOn = true; ac.update(); }
    const sw = sys.comps['sw'];
    if (sw) sw.isOn = true;
    const cb = sys.comps['cb'];
    if (cb) { cb._meterSwitchPos = -1; cb._updateMeterSwitch(); }

}

export function fiveStep() { }
