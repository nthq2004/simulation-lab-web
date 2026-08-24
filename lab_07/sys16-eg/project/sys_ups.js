// 船舶发电机主开关 + UPS 不间断电源仿真工程
// （同步发电机 + 汇流排 + 船用框架式空气断路器 + UPS 演示区）

import { SyncGenerator3P } from '../components/SyncGenerator3P.js';
import { Busbar3P } from '../components/Busbar3P.js';
import { MarineMainsSwitch } from '../components/MarineMainsSwitch.js';
import { GeneratorRemotePanel } from '../components/GeneratorRemotePanel.js';
import { DCPower } from '../components/DCPower.js';
import { Ground } from '../components/Gnd.js';
import { IncandescentLamp } from '../components/IncandescentLamp.js';
import { UPS } from '../components/UPS.js';
import { Multimeter } from '../components/Multimeter.js';
import { MF47Multimeter } from '../components/MF47Multimeter.js';
import { Oscilloscope_tri } from '../components/Osc_tri.js';
import { SignalGenerator } from '../components/SignalGenerator.js';
import { ProcessCalibrator } from '../components/ProcessCalibrator.js';
import { ElecMeter } from '../components/ElecMeter.js';


export const FAULT_CONFIGS = {

};

export const PROJECT_WORKFLOWS = {
    'ups-parts': {
        id: 'ups-parts',
        name: '1. 识别UPS关键组件',
        steps: [
            {
                msg: '第 1 步：识别 UPS 的整流模块（AC→DC，将交流电整流为直流）。',
                mode: 'find', target: 'ups1', subTarget: 'rectifier',
            },
            {
                msg: '第 2 步：识别 UPS 的逆变模块（DC→AC，将直流逆变为交流供电）。',
                mode: 'find', target: 'ups1', subTarget: 'inverter',
            },
            {
                msg: '第 3 步：识别 UPS 的储能模块（蓄电池组，市电中断时为逆变器提供直流）。',
                mode: 'find', target: 'ups1', subTarget: 'battery',
            },
            {
                msg: '第 4 步：识别 UPS 的静态开关（单刀双掷，在市电旁路与逆变输出之间切换）。',
                mode: 'find', target: 'ups1', subTarget: 'staticSwitch',
            },
            {
                msg: '第 5 步：知识测试——什么是双变换在线式UPS？',
                mode: 'quiz',
                quizConfig: {
                    question: '什么是双变换在线式UPS？',
                    options: [
                        'UPS 正常工作时，市电经整流器整流为直流，再经逆变器逆变回交流为负载供电，电能经过"交流→直流→交流"两级变换；市电异常时由蓄电池经逆变器供电，切换无间断',
                        'UPS 只是市电与负载之间串联一个稳压器，不做任何电能变换',
                        'UPS 平时由市电直接供电，只有断电瞬间才切换电池，切换期间有短暂中断',
                        'UPS 将市电转换为直流后直接给负载供电，不经过逆变器',
                    ],
                    answer: 0,
                    analysis: '双变换在线式UPS：市电正常时，交流电先经整流器变成直流，再经逆变器变回交流供负载使用（即"在线"工作）；同时整流后的直流给蓄电池充电。市电异常或中断时，整流器停止，蓄电池通过逆变器继续供电，负载由逆变器不间断供电。由于负载始终由逆变器供电，电压和频率稳定，且切换无间断。',
                },
            },
        ],
    },

    'ups-startup': {
        id: 'ups-startup',
        name: '2. UPS起动与模式切换',
        steps: [
            {
                msg: '第 1 步：UPS 接线。UPS 输入 L 端接电源 A 相（汇流排第6接口），输入 N 端接地。',
                mode: 'check',
                check() {
                    const c = (a, b) => this.sys.isPortConnected(a, b);
                    return c('bus1_wire_l1_6', 'ups1_wire_in_p') && c('gnd1_wire_gnd', 'ups1_wire_in_n');
                },
            },
            {
                msg: '第 2 步：在发电机组遥控面板上按"起动"按钮起动发电机，待主开关储能完成后合闸；再合上 UPS 输入电源开关，观察 LCD 显示输入/输出电压与电池参数。',
                mode: 'check',
                check() {
                    const sys = this.sys;
                    const gen = sys.comps.gen1;
                    const qf1 = sys.comps.qf1;
                    const ups = sys.comps.ups1;
                    const lcdOn = ups._lcdLine1 && typeof ups._lcdLine1.text === 'function'
                        && ups._lcdLine1.text().length > 0;
                    return gen.isOn && qf1._state === 'on' && ups._inputSwitch && ups._inputOk && lcdOn;
                },
            },
            {
                msg: '第 3 步：合上储能电池开关，再合上 UPS 输出开关（接通两路负载回路）。',
                mode: 'check',
                check() {
                    const ups = this.sys.comps.ups1;
                    return ups._batterySwitch && ups._outputSwitch;
                },
            },
            {
                msg: '第 4 步：长按 ON 按钮 3 秒起动 UPS。观察起动过程：先进入旁通模式（约 10s），约 30s 后切换至在线（LINE）模式。',
                mode: 'check',
                check() {
                    const ups = this.sys.comps.ups1;
                    return ups._powerOn && ups._startPhase === 'line' && ups._mode === 'normal';
                },
            },
            {
                msg: '第 5 步：切断交流电源。UPS 由储能电池经逆变器供电，进入电池模式。',
                mode: 'check',
                check() {
                    return this.sys.comps.ups1._mode === 'battery';
                },
            },
            {
                msg: '第 6 步：恢复交流电源。UPS 自动返回在线（LINE）模式，负载供电不间断。',
                mode: 'check',
                check() {
                    return this.sys.comps.ups1._mode === 'normal';
                },
            },
            {
                msg: '第 7 步：依次合上第1路、第2路负载开关，两路负载总功率约 3000W，超过 UPS 额定功率 2000W（过载）。过载持续约 2 秒后 UPS 自动转入旁路模式（BYPASS 灯亮，输入经旁路直通为负载供电）。',
                mode: 'check',
                check() {
                    const ups = this.sys.comps.ups1;
                    return ups._loadSwitch1 && ups._loadSwitch2 && ups._mode === 'bypass';
                },
            },
            {
                msg: '第 8 步：知识测试——UPS 的工作模式。',
                mode: 'quiz',
                quizConfig: {
                    question: '关于双变换在线式 UPS 的工作模式，下列说法正确的是？',
                    options: [
                        '在线模式（LINE）：市电经整流器整流后给逆变器供电，再由逆变器输出给负载，电压频率稳定，同时对电池充电',
                        '旁路模式（BYPASS）：负载由逆变器供电，市电仅给电池充电',
                        '电池模式（BATTERY）时，UPS 不向负载供电',
                        '三种模式在任何时刻都可以同时工作',
                    ],
                    answer: 0,
                    analysis: '双变换在线式UPS有四种典型状态：①在线模式（LINE）——市电经整流器→逆变器两级变换后为负载供电，同时给电池充电，输出电压频率稳定；②电池模式（BATTERY）——市电中断，电池经逆变器为负载供电，供电无间断；③旁路模式（BYPASS）——UPS 过载或故障时，市电经旁路开关＋静态开关直接为负载供电；④关机状态。三种供电模式由控制系统自动切换，不会同时工作。',
                },
            },
        ],
    },
};

export const componentConfigs = [
    // ── 主回路：同步发电机 → 主开关 → 汇流排 ──
    { Class: SyncGenerator3P, id: 'gen1', x: -100, y: 700, vRms: 230, freq: 50, isOn: false, mode: 'local', label: '同步发电机', ratedPower: 400, ratedVoltage: 400, ratedCosPhi: 0.8, rOn: 0.005, visible: true },
    { Class: MarineMainsSwitch, id: 'qf1', x: -160, y: 250, ratedCtrlVoltage: 24, label: '主开关',  visible: true },
    { Class: GeneratorRemotePanel, id: 'genpanel', x: 400, y: 700, genId: 'gen1', qfId: 'qf1', label: '发电机组遥控面板', visible: true },

    { Class: Busbar3P, id: 'bus1', x: 220, y: 30, tapsPerPhase: 6, label: '汇流排', visible: true },
    // UPS 输入 N 的接地（置于 UPS 输入 N 左下方；发电机中性点不接地）
    { Class: Ground, id: 'gnd1', x: 870, y: 730, visible: true },



    // ── 控制电源（DC 24V）：失压脱扣线圈 ──
    { Class: DCPower, id: 'dc_uv', x: 650, y: 400, voltage: 24, isOn: true, label: '失压脱扣电源', visible: true },

    // ── UPS 不间断电源演示区：汇流排第6接口 A 相取电 → UPS → 两路负载 ──
    { Class: UPS, id: 'ups1', x: 1000, y: 200, label: 'UPS 不间断电源', ratedPower: 2000, powerOn: false, inputSwitch: false, batterySwitch: false, outputSwitch: false, loadSwitch1: false, loadSwitch2: false, visible: true },
    { Class: IncandescentLamp, id: 'lamp_ups1', x: 1920, y: 410, coldResistance: 48.4 },
    { Class: IncandescentLamp, id: 'lamp_ups2', x: 1920, y: 530, coldResistance: 24.2 },

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
        // ── 主回路：同步发电机 → 主开关 → 汇流排 ──
        { from: 'gen1_wire_u', to: 'qf1_wire_t1', type: 'wire' },
        { from: 'gen1_wire_v', to: 'qf1_wire_t2', type: 'wire' },
        { from: 'gen1_wire_w', to: 'qf1_wire_t3', type: 'wire' },
        { from: 'qf1_wire_l1', to: 'bus1_wire_l1_1', type: 'wire' },
        { from: 'qf1_wire_l2', to: 'bus1_wire_l2_1', type: 'wire' },
        { from: 'qf1_wire_l3', to: 'bus1_wire_l3_1', type: 'wire' },
        // ── 控制电源：DC 24V → 主开关失压脱扣线圈 ──
        { from: 'dc_uv_wire_p', to: 'qf1_wire_uv1', type: 'wire' },
        { from: 'dc_uv_wire_n', to: 'qf1_wire_uv2', type: 'wire' },
        // ── 储能电机电源：DC 24V → 主开关储能电机（m1/m2）──
        { from: 'dc_uv_wire_p', to: 'qf1_wire_m1', type: 'wire' },
        { from: 'dc_uv_wire_n', to: 'qf1_wire_m2', type: 'wire' },
        // ── 发电机组遥控面板：左面板 → gen1 遥控端口 ──
        { from: 'genpanel_wire_start_a', to: 'gen1_wire_rm_start_a', type: 'wire' },
        { from: 'genpanel_wire_start_b', to: 'gen1_wire_rm_start_b', type: 'wire' },
        { from: 'genpanel_wire_stop_a', to: 'gen1_wire_rm_stop_a', type: 'wire' },
        { from: 'genpanel_wire_stop_b', to: 'gen1_wire_rm_stop_b', type: 'wire' },
        { from: 'genpanel_wire_spd_p', to: 'gen1_wire_freq_in_p', type: 'wire' },
        { from: 'genpanel_wire_spd_n', to: 'gen1_wire_freq_in_n', type: 'wire' },
        // ── 左面板 → qf1 合闸/分励线圈 ──
        { from: 'genpanel_wire_close_a', to: 'qf1_wire_c1', type: 'wire' },
        { from: 'genpanel_wire_close_b', to: 'qf1_wire_c2', type: 'wire' },
        { from: 'genpanel_wire_open_a', to: 'qf1_wire_fla', type: 'wire' },
        { from: 'genpanel_wire_open_b', to: 'qf1_wire_flb', type: 'wire' },
        // ── 左面板 24V 电源 ← dc_uv ──
        { from: 'dc_uv_wire_p', to: 'genpanel_wire_p24_p', type: 'wire' },
        { from: 'dc_uv_wire_n', to: 'genpanel_wire_p24_n', type: 'wire' },
        // ── UPS：汇流排第6接口 A 相 + 接地 → UPS 输入端 ──
        { from: 'bus1_wire_l1_6', to: 'ups1_wire_in_p', type: 'wire' },
        { from: 'gnd1_wire_gnd', to: 'ups1_wire_in_n', type: 'wire' },
        // ── UPS 第1路输出 → 负载灯1 ──
        { from: 'ups1_wire_out1_p', to: 'lamp_ups1_wire_l', type: 'wire' },
        { from: 'ups1_wire_out1_n', to: 'lamp_ups1_wire_r', type: 'wire' },
        // ── UPS 第2路负载输出 → 负载灯2 ──
        { from: 'ups1_wire_out2_p', to: 'lamp_ups2_wire_l', type: 'wire' },
        { from: 'ups1_wire_out2_n', to: 'lamp_ups2_wire_r', type: 'wire' },
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
    // 起动发电机
    const gen = sys.comps.gen1;
    if (gen) gen.isOn = true;
    // 起动 UPS（上电，开关保持断开状态，由学生自行合闸）
    const ups = sys.comps.ups1;
    if (ups) {
        ups.pressOn();
    }
}

export function fiveStep() {
}
