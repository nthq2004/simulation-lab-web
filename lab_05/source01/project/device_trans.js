// 变压器/开关/白炽灯仿真工程
// 电路：AC L → 变压器原边 p1 → 变压器原边 p2 → AC N → GND
//       变压器副边 s1 → 开关 l → 开关 r → 白炽灯 l → 白炽灯 r → 变压器副边 s2
// 两个互感线圈构成回路，不需要额外接地

import { ACPower } from '../components/ACPower.js';
import { Ground } from '../components/Gnd.js';
import { IncandescentLamp } from '../components/IncandescentLamp.js';
import { RealControlTransformer } from '../components/RealControlTransformer.js';
import { Switch } from '../components/Switch.js';
import { Multimeter } from '../components/Multimeter.js';
import { MF47Multimeter } from '../components/MF47Multimeter.js';
import { Oscilloscope_tri } from '../components/Osc_tri.js';
import { SignalGenerator } from '../components/SignalGenerator.js';
import { ProcessCalibrator } from '../components/ProcessCalibrator.js';
import { ElecMeter } from '../components/ElecMeter.js';
import { Wattmeter } from '../components/Wattmeter.js';

export const FAULT_CONFIGS = {};

export const PROJECT_WORKFLOWS = {
    'trans-basic': {
        id: 'trans-basic',
        name: '1. 变压器驱动白炽灯',
        steps: [
            {
                msg: '1. 电路接线：连接交流电源 → 变压器原边；变压器副边 → 开关 → 白炽灯',
                mode: 'check',
                act() {
                    _presetStep1(this.sys);
                },
                check() {
                    const _c = (a, b) => this.sys.isPortConnected(a, b);
                    return _c('ac_wire_p', 'transformer_wire_p1')
                        && _c('transformer_wire_p2', 'gnd1_wire_gnd')
                        && _c('ac_wire_n', 'gnd1_wire_gnd')
                        && _c('transformer_wire_s1', 'switch1_wire_l')
                        && _c('switch1_wire_r', 'lamp1_wire_l')
                        && _c('lamp1_wire_r', 'transformer_wire_s2');
                },
            },
            {
                msg: '2. 接通交流电源（380V/50Hz）',
                mode: 'check',
                act() {
                    const ac = this.sys.comps['ac'];
                    if (ac) { ac.isOn = true; ac.voltageRMS = 380; ac.frequency = 50; ac.update(); }
                },
                check() {
                    const ac = this.sys.comps['ac'];
                    return ac && ac.isOn;
                },
            },
            {
                msg: '3. 调出数字万用表，连接 V/COM 到变压器副边，测量输出电压（应在 220V 左右）',
                mode: 'check',
                check() {
                    const mm = this.sys.comps['multimeter'];
                    if (!mm || !mm.group || !mm.group.visible()) return false;
                    const v = Math.abs(mm.value || 0);
                    return v > 100 && v < 350;
                },
            },
            {
                msg: '4. 闭合开关，白炽灯应点亮',
                mode: 'check',
                act() {
                    const sw = this.sys.comps['switch1'];
                    if (sw && !sw.isOn) sw.toggle();
                },
                check() {
                    const sw = this.sys.comps['switch1'];
                    return sw && sw.isOn;
                },
            },
            {
                msg: '5. 用数字万用表（电流档）测量副边电流，用数字功率计测量原边电流，对比分析变流效果',
                mode: 'check',
                check() {
                    const sv = this.sys.voltageSolver;
                    const ptc = sv.portToCluster;
                    const _c = (a, b) => this.sys.isPortConnected(a, b);
                    const inCircuit = (cIdx, prefix) => {
                        if (cIdx === undefined || cIdx >= sv.clusters.length) return false;
                        return [...sv.clusters[cIdx]].some(p => !p.startsWith(prefix));
                    };

                    // 万用表在副边回路：其中一个端子必须和变压器副边同簇
                    const mm = this.sys.comps['multimeter'];
                    if (!mm || !mm.group || !mm.group.visible() || mm.mode !== 'MA') return false;
                    const mmMa = ptc.get('multimeter_wire_ma');
                    const mmCom = ptc.get('multimeter_wire_com');
                    if (mmMa === undefined || mmCom === undefined || mmMa === mmCom) return false;
                    if (!inCircuit(mmMa, 'multimeter_') || !inCircuit(mmCom, 'multimeter_')) return false;
                    if (!_c('multimeter_wire_ma', 'transformer_wire_s1')
                        && !_c('multimeter_wire_com', 'transformer_wire_s1')) return false;

                    // 功率计电流线圈在原边回路：其中一个电流端子必须和电源同簇
                    const wm = this.sys.comps['elecmeter'];
                    if (!wm || !wm.group || !wm.group.visible()) return false;
                    const wmIp = ptc.get('elecmeter_wire_ip');
                    const wmIn = ptc.get('elecmeter_wire_in');
                    if (wmIp === undefined || wmIn === undefined || wmIp === wmIn) return false;
                    if (!inCircuit(wmIp, 'elecmeter_') || !inCircuit(wmIn, 'elecmeter_')) return false;
                    if (!_c('elecmeter_wire_ip', 'ac_wire_p')
                        && !_c('elecmeter_wire_in', 'ac_wire_p')) return false;

                    const sw = this.sys.comps['switch1'];
                    return sw && sw.isOn;
                },
            },
            {
                msg: '6. 测试题：变压器的功能',
                mode: 'quiz',
                quizConfig: {
                    question: '变压器的功能不包括以下哪项？',
                    options: ['变换电压', '变换电流', '变换频率', '电气隔离'],
                    answer: 2,
                    analysis: '变压器利用电磁感应原理，可变换电压、电流大小，实现阻抗变换和电气隔离，但不能改变交流电的频率。',
                },
            },
        ],
    },
};

export const componentConfigs = [
    { Class: ACPower, id: 'ac', x: 10, y: 200, voltageRMS: 380, frequency: 50, isOn: false },
    { Class: RealControlTransformer, id: 'transformer', x: 280, y: 340 },
    { Class: Switch, id: 'switch1', x: 700, y: 400 },
    { Class: IncandescentLamp, id: 'lamp1', x: 750, y: 500, coldResistance: 484,rotation:90 },
    { Class: Ground, id: 'gnd1', x: 10, y: 510 },

    { Class: Multimeter, id: 'multimeter', x: 650, y: 30, scale: 1.1, visible: false },
    { Class: MF47Multimeter, id: 'mf47-panel', x: 650, y: 30, visible: false },
    { Class: Oscilloscope_tri, id: 'osc', x: 650, y: 260, visible: false },
    { Class: SignalGenerator, id: 'sg', x: 80, y: 400, visible: false },
    { Class: ProcessCalibrator, id: 'cali', x: 550, y: 400, visible: false },
    { Class: ElecMeter, id: 'elecmeter', x: 350, y: 30, visible: false },
];

function _presetStep1(sys) {
    const cons = [
        { from: 'ac_wire_p', to: 'transformer_wire_p1', type: 'wire' },
        { from: 'transformer_wire_p2', to: 'gnd1_wire_gnd', type: 'wire' },
        { from: 'ac_wire_n', to: 'gnd1_wire_gnd', type: 'wire' },
        { from: 'transformer_wire_s1', to: 'switch1_wire_l', type: 'wire' },
        { from: 'switch1_wire_r', to: 'lamp1_wire_l', type: 'wire' },
        { from: 'lamp1_wire_r', to: 'transformer_wire_s2', type: 'wire' },
    ];
    cons.forEach(c => sys.connMgr.addConn(c));
}

export function initSlider(_sys) {}

export function applyAllPresets() {
    _presetStep1(this.sys);
}

export async function applyStartSystem() {
    _presetStep1(this.sys);
}

export function fiveStep() {
    const sys = this && this.sys ? this.sys : window.sys;
    if (!sys) return;
}
