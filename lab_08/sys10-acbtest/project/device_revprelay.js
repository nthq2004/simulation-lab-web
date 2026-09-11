// 逆功率继电器仿真工程（双交流源 + 同步电抗，功率角 δ 调节逆功率）

import { ACPower } from '../components/ACPower.js';
import { ReversePowerRelay } from '../components/ReversePowerRelay.js';
import { Inductor } from '../components/Inductor.js';
import { Resistor } from '../components/Resistor.js';
import { LED } from '../components/LED.js';
import { DCPower } from '../components/DCPower.js';
import { Ground } from '../components/Gnd.js';
import { Multimeter } from '../components/Multimeter.js';
import { MF47Multimeter } from '../components/MF47Multimeter.js';
import { Oscilloscope_tri } from '../components/Osc_tri.js';
import { SignalGenerator } from '../components/SignalGenerator.js';
import { ProcessCalibrator } from '../components/ProcessCalibrator.js';
import { ElecMeter } from '../components/ElecMeter.js';

export const FAULT_CONFIGS = {};

export const PROJECT_WORKFLOWS = {
    'revpower-basic': {
        id: 'revpower-basic',
        name: '1. 逆功率继电器演示（功率角调节）',
        steps: [
            {
                msg: '第 1 步：接线。母线电源 ac1（220V/50Hz，0°）通过同步电抗 xs 连接发电机电源 ac2（220V/50Hz，相位可调），逆功率继电器电流线圈（I+/I-）串联于发电机输出回路，电压线圈（U+/U-）并联于母线，触点控制信号灯回路。闭合电源观察继电器：发电机超前母线（δ>0）时应显示"正"。',
                mode: 'check',
                async act() {
                    await new Promise(r => setTimeout(r, 400));
                    _autoWire(this.sys);
                    await new Promise(r => setTimeout(r, 300));
                    const ac1 = this.sys.comps['ac1'];
                    const ac2 = this.sys.comps['ac2'];
                    if (ac1) ac1.onConfigUpdate({ vRms: 220, freq: 50, phaseDeg: 0, isOn: true });
                    if (ac2) ac2.onConfigUpdate({ vRms: 220, freq: 50, phaseDeg: 12, isOn: true });
                    await new Promise(r => setTimeout(r, 3000));
                },
                check() {
                    const rp = this.sys.comps['rp'];
                    const c = (a, b) => this.sys.isPortConnected(a, b);
                    return rp
                        && c('ac1_wire_p', 'xs_wire_l')
                        && c('xs_wire_r', 'rp_wire_ip')
                        && c('rp_wire_in', 'ac2_wire_p')
                        && c('ac1_wire_n', 'gnd1_wire_gnd')
                        && c('ac2_wire_n', 'gnd2_wire_gnd')
                        && c('rp_wire_un', 'gnd3_wire_gnd')
                        && c('ac1_wire_p', 'rp_wire_up')
                        && c('rp_wire_NC', 'lamp1_wire_l')
                        && rp.getState() === 'normal'
                        && rp.getPower() > 0;
                },
            },
            {
                msg: '第 2 步：将发电机电源 ac2 相位调为负值（发电机滞后母线，出现逆功率）。当逆功率超过 32kW（动作值）时，继电器进入定时限计时（固定 10s）。',
                mode: 'check',
                async act() {
                    await new Promise(r => setTimeout(r, 400));
                    const ac2 = this.sys.comps['ac2'];
                    if (ac2) ac2.onConfigUpdate({ phaseDeg: -18 });
                    await new Promise(r => setTimeout(r, 4000));
                },
                check() {
                    const rp = this.sys.comps['rp'];
                    return rp && (rp.getState() === 'timing' || rp.getState() === 'tripped');
                },
            },
            {
                msg: '第 3 步：逆功率超过动作值后，继电器定时限延时（10s）结束即跳闸（NO 闭合、NC 断开），信号灯由常亮转为熄灭，TRIP 指示灯亮。',
                mode: 'check',
                async act() {
                    await new Promise(r => setTimeout(r, 500));
                    const ac2 = this.sys.comps['ac2'];
                    if (ac2) ac2.onConfigUpdate({ phaseDeg: -18 });
                    await new Promise(r => setTimeout(r, 14000));
                },
                check() {
                    const rp = this.sys.comps['rp'];
                    return rp && rp.isTripped();
                },
            },
            {
                msg: '第 4 步：逆功率消失（发电机恢复超前、重新输出正功率）后，继电器处于跳闸保持状态，需手动点击复位按钮才能复归。',
                mode: 'check',
                async act() {
                    await new Promise(r => setTimeout(r, 400));
                    const ac2 = this.sys.comps['ac2'];
                    if (ac2) ac2.onConfigUpdate({ phaseDeg: 12 });
                    await new Promise(r => setTimeout(r, 2500));
                },
                check() {
                    const rp = this.sys.comps['rp'];
                    return rp && !rp.isTripped();
                },
            },
            {
                msg: '第 5 步：逆功率继电器知识测试。',
                mode: 'quiz',
                quizConfig: {
                    question: '逆功率继电器主要用于保护什么设备？',
                    options: [
                        '发电机（防止发电机从电网吸收功率转为电动机运行）',
                        '变压器（防止过载）',
                        '电动机（防止堵转）',
                        '线路（防止短路）',
                    ],
                    answer: 0,
                    analysis: '当并网运行的发电机因汽轮机（原动机）故障而失去原动力时，发电机将从电网吸收有功功率转为电动机运行，此时电网向发电机倒送功率（逆功率）。若不及时切除发电机，将导致汽轮机叶片过热损坏。逆功率继电器检测到逆功率超过整定值并经延时后，动作跳闸，将发电机从电网中解列。',
                },
            },
        ],
    },
};

export const componentConfigs = [
    // 母线电源（电网）
    { Class: ACPower, id: 'ac1', x: 60, y: 40, vRms: 220, freq: 50, phase: 0, label: '母线', isOn: true, visible: true },
    // 同步电抗（发电机内阻抗 Xs）
    { Class: Inductor, id: 'xs', x: 300, y: 320, inductance: 0.0005, rotation: 90, visible: true },
    // 发电机电源（可调相位 δ）
    { Class: ACPower, id: 'ac2', x: 60, y: 420, vRms: 220, freq: 50, phase: 0, label: '发电机', isOn: true, visible: true },
    // 公共地：两电源负极与继电器 U- 分别接地，减少中性线互连
    { Class: Ground, id: 'gnd1', x: 120, y: 260, visible: true },
    { Class: Ground, id: 'gnd2', x: 120, y: 660, visible: true },
    { Class: Ground, id: 'gnd3', x: 420, y: 360, visible: true },
    // 逆功率继电器
    { Class: ReversePowerRelay, id: 'rp', x: 520, y: 200, ratedPower: 400, actionRatio: 8, tMax: 10, tMin: 0.5, curveN: 2, sign: -1, visible: true },
    // 触点控制回路：DC 电源 + 信号灯（NO 断开 / NC 闭合）
    { Class: DCPower, id: 'dc', x: 1120, y: 120, voltage: 24, isOn: true, visible: true },
    { Class: LED, id: 'lamp1', x: 850, y: 280, color: 'red', visible: true },
    { Class: Resistor, id: 'rl', x: 980, y: 280, value: 2200, rotation: 0, visible: true },

    { Class: Multimeter, id: 'multimeter', x: 920, y: 100, visible: false },
    { Class: MF47Multimeter, id: 'mf47-panel', x: 1050, y: 150, visible: false },
    { Class: Oscilloscope_tri, id: 'osc', x: 50, y: 50, visible: false },
    { Class: SignalGenerator, id: 'sg', x: 50, y: 50, visible: false },
    { Class: ProcessCalibrator, id: 'cali', x: 50, y: 50, visible: false },
    { Class: ElecMeter, id: 'elecmeter', x: 50, y: 50, visible: false },
];

// ─── 接线辅助 ───

function _autoWire(sys) {
    sys.conns.length = 0;
    const cons = [
        // 主回路：母线 ac1 → 同步电抗 xs → 继电器电流线圈 I+/I- → 发电机 ac2
        { from: 'ac1_wire_p', to: 'xs_wire_l', type: 'wire' },
        { from: 'xs_wire_r', to: 'rp_wire_ip', type: 'wire' },
        { from: 'rp_wire_in', to: 'ac2_wire_p', type: 'wire' },
        // 公共地：ac1 负极 / ac2 负极 / rp U- 分别接地
        { from: 'ac1_wire_n', to: 'gnd1_wire_gnd', type: 'wire' },
        { from: 'ac2_wire_n', to: 'gnd2_wire_gnd', type: 'wire' },
        { from: 'rp_wire_un', to: 'gnd3_wire_gnd', type: 'wire' },
        // 电压线圈并联于母线
        { from: 'ac1_wire_p', to: 'rp_wire_up', type: 'wire' },
        // 触点控制回路：DC+ → NC → 灯 → 限流电阻 → DC-
        { from: 'dc_wire_p', to: 'rp_wire_NC', type: 'wire' },
        { from: 'rp_wire_COM', to: 'lamp1_wire_l', type: 'wire' },
        { from: 'lamp1_wire_r', to: 'rl_wire_l', type: 'wire' },
        { from: 'rl_wire_r', to: 'dc_wire_n', type: 'wire' },
    ];
    cons.forEach(c => sys.connMgr.addConn(c));
    sys.redrawAll();
}

export function initSlider(_sys) {
}

export function applyAllPresets() {
    const sys = this && this.sys ? this.sys : window.sys;
    if (!sys) return;
    _autoWire(sys);
}

export async function applyStartSystem() {
    const sys = this && this.sys ? this.sys : window.sys;
    if (!sys) return;
    _autoWire(sys);
    const ac1 = sys.comps['ac1'];
    const ac2 = sys.comps['ac2'];
    if (ac1) ac1.onConfigUpdate({ vRms: 220, freq: 50, phaseDeg: 0, isOn: true });
    if (ac2) ac2.onConfigUpdate({ vRms: 220, freq: 50, phaseDeg: 12, isOn: true });
}

export function fiveStep() {
}
