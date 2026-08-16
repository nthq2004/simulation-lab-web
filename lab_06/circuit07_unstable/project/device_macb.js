// 船舶发电机主开关仿真工程（同步发电机 + 汇流排 + 船用框架式空气断路器）

import { SyncGenerator3P } from '../components/SyncGenerator3P.js';
import { Busbar3P } from '../components/Busbar3P.js';
import { MarineMainsSwitch } from '../components/MarineMainsSwitch.js';
import { DCPower } from '../components/DCPower.js';
import { Ground } from '../components/Gnd.js';
import { LED } from '../components/LED.js';
import { Resistor } from '../components/Resistor.js';
import { Multimeter } from '../components/Multimeter.js';
import { MF47Multimeter } from '../components/MF47Multimeter.js';
import { Oscilloscope_tri } from '../components/Osc_tri.js';
import { SignalGenerator } from '../components/SignalGenerator.js';
import { ProcessCalibrator } from '../components/ProcessCalibrator.js';
import { ElecMeter } from '../components/ElecMeter.js';

export const FAULT_CONFIGS = {
    'mains-uv-fault': {
        id: 'mains-uv-fault',
        name: '失压线圈端子接触不良（失压保护失效）',
        desc: '主开关失压脱扣线圈 uv 端子氧化接触不良，接触电阻过大。合闸后若发电机失压，断路器无法自动脱扣。',
        targets: ['uv'],
    },
    'mains-charge-fault': {
        id: 'mains-charge-fault',
        name: '储能回路断路（无法储能合闸）',
        desc: '储能电机供电回路断开（模拟接线松脱），储能电机不转，主开关无法储能，也就无法合闸。',
        targets: ['charge'],
    },
};

export const PROJECT_WORKFLOWS = {
    'mains-basic': {
        id: 'mains-basic',
        name: '1. 发电机主开关操作演示（储能·合闸·脱扣）',
        steps: [
            {
                msg: '第 1 步：接线。同步发电机 gen1（相电压 220V/50Hz）输出端 U/V/W 接主开关 qf1 下端口 T1/T2/T3，主开关上端口 L1/L2/L3 接汇流排 bus1；中性线 N 接地 gnd1；失压线圈 uv 并联于发电机 U 相。分励（sh）、过流（oc）、合闸（x/y）、储能电机（mp/mn）分别接各自 DC 220V 控制电源；辅助触头 NO/NC 接 24V 指示灯回路。合上发电机观察：主开关处于分闸状态，分闸指示灯（NC 回路）亮。',
                mode: 'check',
                async act() {
                    await new Promise(r => setTimeout(r, 400));
                    _autoWire(this.sys);
                    await new Promise(r => setTimeout(r, 300));
                    const gen = this.sys.comps['gen1'];
                    if (gen) gen.onConfigUpdate({ isOn: true });
                    await new Promise(r => setTimeout(r, 3000));
                },
                check() {
                    const q = this.sys.comps['qf1'];
                    const gen = this.sys.comps['gen1'];
                    const c = (a, b) => this.sys.isPortConnected(a, b);
                    return q && gen
                        && gen.isOn
                        && c('gen1_wire_u', 'qf1_wire_t1')
                        && c('gen1_wire_v', 'qf1_wire_t2')
                        && c('gen1_wire_w', 'qf1_wire_t3')
                        && c('qf1_wire_l1', 'bus1_wire_l1_0')
                        && c('qf1_wire_l2', 'bus1_wire_l2_0')
                        && c('qf1_wire_l3', 'bus1_wire_l3_0')
                        && c('gen1_wire_n', 'gnd1_wire_gnd')
                        && c('gen1_wire_u', 'qf1_wire_uv1')
                        && c('gen1_wire_n', 'qf1_wire_uv2')
                        && c('dc_m_wire_p', 'qf1_wire_mp')
                        && c('dc_c_wire_p', 'qf1_wire_x')
                        && c('dc_s_wire_p', 'qf1_wire_sh1')
                        && c('dc_o_wire_p', 'qf1_wire_oc1')
                        && c('dc_i_wire_p', 'qf1_wire_no_a')
                        && q.getState() === 'open'
                        && !q.isCharged();
                },
            },
            {
                msg: '第 2 步：储能。船用空气断路器合闸前必须先储能（弹簧压缩）。点击面板上的储能手柄按钮（绿色圆钮下方），观察储能指示变为绿色"已储能"。',
                mode: 'check',
                async act() {
                    await new Promise(r => setTimeout(r, 500));
                    const q = this.sys.comps['qf1'];
                    if (q) q.charge();
                    await new Promise(r => setTimeout(r, 1500));
                },
                check() {
                    const q = this.sys.comps['qf1'];
                    return q && q.isCharged() && q.getState() === 'open';
                },
            },
            {
                msg: '第 3 步：合闸。点击绿色合闸按钮（或合闸线圈 x/y 通电），主触头闭合，发电机向汇流排供电。观察：合闸指示变绿、分闸指示熄灭、汇流排带电，主开关面板显示三相电压。',
                mode: 'check',
                async act() {
                    await new Promise(r => setTimeout(r, 400));
                    const q = this.sys.comps['qf1'];
                    if (q) q.close();
                    await new Promise(r => setTimeout(r, 2500));
                },
                check() {
                    const q = this.sys.comps['qf1'];
                    return q && q.isClosed()
                        && q.getRackPos() === 'connected'
                        && this.sys.isPortConnected('qf1_wire_l1', 'bus1_wire_l1_0')
                        && this.sys.isPortConnected('qf1_wire_l2', 'bus1_wire_l2_0')
                        && this.sys.isPortConnected('qf1_wire_l3', 'bus1_wire_l3_0');
                },
            },
            {
                msg: '第 4 步：分励脱扣。使分励线圈 sh 通电（分励电源 dc_s 合上），分励电磁铁吸合撞击脱扣轴，主开关立即分闸。观察：合闸指示熄灭、分闸指示恢复点亮，主开关脱扣锁存。',
                mode: 'check',
                async act() {
                    await new Promise(r => setTimeout(r, 500));
                    const s = this.sys.comps['dc_s'];
                    if (s) s.onConfigUpdate({ isOn: true });
                    await new Promise(r => setTimeout(r, 1200));
                    if (s) s.onConfigUpdate({ isOn: false });
                },
                check() {
                    const q = this.sys.comps['qf1'];
                    return q && q.getState() === 'open' && q.isTrippedLock() && q.getTripSource() === 'shunt';
                },
            },
            {
                msg: '第 5 步：复位并演示失压脱扣。先复位主开关（解除脱扣锁存），重新储能、合闸；然后停止发电机（发电机故障失压），失压线圈 uv 失电吸力消失，主开关失压脱扣。观察脱扣后主开关锁存、无法再次合闸。',
                mode: 'check',
                async act() {
                    await new Promise(r => setTimeout(r, 400));
                    const q = this.sys.comps['qf1'];
                    const gen = this.sys.comps['gen1'];
                    if (q) q.reset();
                    await new Promise(r => setTimeout(r, 300));
                    if (q) q.charge();
                    await new Promise(r => setTimeout(r, 300));
                    if (q) q.close();
                    await new Promise(r => setTimeout(r, 1500));
                    if (gen) gen.onConfigUpdate({ isOn: false });
                    await new Promise(r => setTimeout(r, 3500));
                },
                check() {
                    const q = this.sys.comps['qf1'];
                    return q && q.getState() === 'open' && q.isTrippedLock() && q.getTripSource() === 'undervoltage';
                },
            },
            {
                msg: '第 6 步：复位并演示过流脱扣。先复位、重新储能合闸；然后使过流线圈 oc 通电（模拟外部保护继电器动作信号），过流脱扣电磁铁吸合，主开关立即分闸锁存。',
                mode: 'check',
                async act() {
                    await new Promise(r => setTimeout(r, 400));
                    const q = this.sys.comps['qf1'];
                    const gen = this.sys.comps['gen1'];
                    if (gen) gen.onConfigUpdate({ isOn: true });
                    await new Promise(r => setTimeout(r, 800));
                    if (q) q.reset();
                    await new Promise(r => setTimeout(r, 300));
                    if (q) q.charge();
                    await new Promise(r => setTimeout(r, 300));
                    if (q) q.close();
                    await new Promise(r => setTimeout(r, 1200));
                    const o = this.sys.comps['dc_o'];
                    if (o) o.onConfigUpdate({ isOn: true });
                    await new Promise(r => setTimeout(r, 1200));
                    if (o) o.onConfigUpdate({ isOn: false });
                },
                check() {
                    const q = this.sys.comps['qf1'];
                    return q && q.getState() === 'open' && q.isTrippedLock() && q.getTripSource() === 'overcurrent';
                },
            },
            {
                msg: '第 7 步：摇出至试验位试合闸。将主开关摇出至"试验"位置，重新储能合闸。由于主触头已与主回路分离，虽然断路器显示合闸，但汇流排不带电（qf1 的 L 与 bus1 不连通），用于检修前验证操作机构完好。',
                mode: 'check',
                async act() {
                    await new Promise(r => setTimeout(r, 400));
                    const q = this.sys.comps['qf1'];
                    if (q) q.reset();
                    await new Promise(r => setTimeout(r, 300));
                    if (q) q.charge();
                    await new Promise(r => setTimeout(r, 300));
                    if (q) q.setRackPos('test');
                    await new Promise(r => setTimeout(r, 400));
                    if (q) q.close();
                    await new Promise(r => setTimeout(r, 1800));
                    if (q) q.open();
                    await new Promise(r => setTimeout(r, 400));
                    if (q) q.setRackPos('connected');
                },
                check() {
                    const q = this.sys.comps['qf1'];
                    return q && q.isClosed()
                        && q.getRackPos() === 'test';
                },
            },
            {
                msg: '第 8 步：船用发电机主开关知识测试。',
                mode: 'quiz',
                quizConfig: {
                    question: '船用框架式空气断路器（主开关）的合闸条件是什么？',
                    options: [
                        '必须先储能（弹簧储能到位），且无脱扣锁存，方可合闸',
                        '只要发电机电压正常即可随时合闸',
                        '主开关任意状态都能直接合闸',
                        '必须摇出试验位才能合闸',
                    ],
                    answer: 0,
                    analysis: '船用空气断路器采用弹簧操作机构，合闸前必须完成储能（压缩合闸弹簧），且失压/过流/分励脱扣无锁存（脱扣装置复位）后方可合闸。合闸后若失压线圈失电或保护动作，会立即脱扣并锁存。',
                },
            },
        ],
    },
    'mains-fault': {
        id: 'mains-fault',
        name: '2. 主开关典型故障排查',
        steps: [
            {
                msg: '故障 1（失压保护失效）：失压线圈 uv 端子接触不良。合闸后停掉发电机，正常情况下主开关应立即失压脱扣，但故障情况下主开关仍保持合闸、无法自动断开。诊断思路：检查 uv 端子接线与接触电阻，恢复后重新试验失压脱扣。',
                mode: 'check',
                async act() {
                    await new Promise(r => setTimeout(r, 400));
                    _autoWire(this.sys);
                    await new Promise(r => setTimeout(r, 300));
                    const gen = this.sys.comps['gen1'];
                    if (gen) gen.onConfigUpdate({ isOn: true });
                    await new Promise(r => setTimeout(r, 1200));
                    const q = this.sys.comps['qf1'];
                    if (q) q.charge();
                    await new Promise(r => setTimeout(r, 300));
                    if (q) q.close();
                    await new Promise(r => setTimeout(r, 1200));
                    if (gen) gen.onConfigUpdate({ isOn: false });
                    await new Promise(r => setTimeout(r, 3000));
                },
                check() {
                    const q = this.sys.comps['qf1'];
                    return q && q.isClosed() && !q.isTrippedLock();
                },
            },
            {
                msg: '故障 1 处理：恢复 uv 端子接触（将失压保护接入）。复位并重新合闸后，再停发电机，主开关应能正常失压脱扣。',
                mode: 'check',
                async act() {
                    await new Promise(r => setTimeout(r, 400));
                    const q = this.sys.comps['qf1'];
                    const gen = this.sys.comps['gen1'];
                    if (q) q.reset();
                    if (gen) gen.onConfigUpdate({ isOn: true });
                    await new Promise(r => setTimeout(r, 800));
                    if (q) q.charge();
                    await new Promise(r => setTimeout(r, 300));
                    if (q) q.close();
                    await new Promise(r => setTimeout(r, 1500));
                    if (gen) gen.onConfigUpdate({ isOn: false });
                    await new Promise(r => setTimeout(r, 3500));
                },
                check() {
                    const q = this.sys.comps['qf1'];
                    return q && q.getState() === 'open' && q.isTrippedLock() && q.getTripSource() === 'undervoltage';
                },
            },
            {
                msg: '故障 2（储能回路断路）：储能电机供电回路断开。点击储能按钮时储能电机不转、无法储能，主开关不能合闸。诊断思路：检查储能电机电源 mp/mn 回路通断与储能机构。',
                mode: 'check',
                async act() {
                    await new Promise(r => setTimeout(r, 400));
                    const q = this.sys.comps['qf1'];
                    if (q) q.reset();
                    await new Promise(r => setTimeout(r, 300));
                },
                check() {
                    const q = this.sys.comps['qf1'];
                    return q && !q.isCharged() && q.getState() === 'open';
                },
            },
            {
                msg: '故障 2 处理：恢复储能回路。重新储能后即可正常合闸送电。',
                mode: 'check',
                async act() {
                    await new Promise(r => setTimeout(r, 400));
                    const q = this.sys.comps['qf1'];
                    if (q) q.charge();
                    await new Promise(r => setTimeout(r, 1500));
                    if (q) q.close();
                    await new Promise(r => setTimeout(r, 1800));
                },
                check() {
                    const q = this.sys.comps['qf1'];
                    return q && q.isClosed();
                },
            },
        ],
    },
};

export const componentConfigs = [
    // ── 主回路：同步发电机 → 主开关 → 汇流排 ──
    { Class: SyncGenerator3P, id: 'gen1', x: 90, y: 600, vRms: 220, freq: 50, isOn: true, label: '同步发电机', visible: true },
    { Class: MarineMainsSwitch, id: 'qf1', x: 560, y: 300, ctrlRated: 220, label: '主开关', visible: true },
    { Class: Busbar3P, id: 'bus1', x: 820, y: 60, tapsPerPhase: 8, label: '汇流排', visible: true },
    // 发电机中性点接地
    { Class: Ground, id: 'gnd1', x: 90, y: 790, visible: true },

    // ── 控制电源（DC 220V）：储能电机 / 合闸线圈 / 分励线圈 / 过流线圈 ──
    { Class: DCPower, id: 'dc_m', x: 1400, y: 280, voltage: 220, isOn: false, label: '储能电机电源', visible: true },
    { Class: DCPower, id: 'dc_c', x: 1400, y: 470, voltage: 220, isOn: false, label: '合闸线圈电源', visible: true },
    { Class: DCPower, id: 'dc_s', x: 1400, y: 660, voltage: 220, isOn: false, label: '分励线圈电源', visible: true },
    { Class: DCPower, id: 'dc_o', x: 1400, y: 850, voltage: 220, isOn: false, label: '过流线圈电源', visible: true },

    // ── 指示灯回路（DC 24V）：NO=合闸指示，NC=分闸指示 ──
    { Class: DCPower, id: 'dc_i', x: 1400, y: 950, voltage: 24, isOn: true, label: '指示回路电源', visible: true },
    { Class: LED, id: 'lamp_close', x: 1660, y: 330, color: 'green', label: '合闸指示', visible: true },
    { Class: Resistor, id: 'rl1', x: 1780, y: 330, value: 2200, rotation: 0, visible: true },
    { Class: LED, id: 'lamp_open', x: 1660, y: 620, color: 'red', label: '分闸指示', visible: true },
    { Class: Resistor, id: 'rl2', x: 1780, y: 620, value: 2200, rotation: 0, visible: true },

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
        // 主回路：发电机 U/V/W → 主开关下口 T1/T2/T3
        { from: 'gen1_wire_u', to: 'qf1_wire_t1', type: 'wire' },
        { from: 'gen1_wire_v', to: 'qf1_wire_t2', type: 'wire' },
        { from: 'gen1_wire_w', to: 'qf1_wire_t3', type: 'wire' },
        // 主开关上口 L1/L2/L3 → 汇流排
        { from: 'qf1_wire_l1', to: 'bus1_wire_l1_0', type: 'wire' },
        { from: 'qf1_wire_l2', to: 'bus1_wire_l2_0', type: 'wire' },
        { from: 'qf1_wire_l3', to: 'bus1_wire_l3_0', type: 'wire' },
        // 中性线接地
        { from: 'gen1_wire_n', to: 'gnd1_wire_gnd', type: 'wire' },
        // 失压线圈并联发电机 U 相
        { from: 'gen1_wire_u', to: 'qf1_wire_uv1', type: 'wire' },
        { from: 'gen1_wire_n', to: 'qf1_wire_uv2', type: 'wire' },
        // 储能电机电源
        { from: 'dc_m_wire_p', to: 'qf1_wire_mp', type: 'wire' },
        { from: 'dc_m_wire_n', to: 'qf1_wire_mn', type: 'wire' },
        // 合闸线圈电源
        { from: 'dc_c_wire_p', to: 'qf1_wire_x', type: 'wire' },
        { from: 'dc_c_wire_n', to: 'qf1_wire_y', type: 'wire' },
        // 分励线圈电源
        { from: 'dc_s_wire_p', to: 'qf1_wire_sh1', type: 'wire' },
        { from: 'dc_s_wire_n', to: 'qf1_wire_sh2', type: 'wire' },
        // 过流线圈电源
        { from: 'dc_o_wire_p', to: 'qf1_wire_oc1', type: 'wire' },
        { from: 'dc_o_wire_n', to: 'qf1_wire_oc2', type: 'wire' },
        // 指示灯回路：NO → 合闸指示
        { from: 'dc_i_wire_p', to: 'qf1_wire_no_a', type: 'wire' },
        { from: 'qf1_wire_no_b', to: 'lamp_close_wire_l', type: 'wire' },
        { from: 'lamp_close_wire_r', to: 'rl1_wire_l', type: 'wire' },
        { from: 'rl1_wire_r', to: 'dc_i_wire_n', type: 'wire' },
        // 指示灯回路：NC → 分闸指示
        { from: 'dc_i_wire_p', to: 'qf1_wire_nc_a', type: 'wire' },
        { from: 'qf1_wire_nc_b', to: 'lamp_open_wire_l', type: 'wire' },
        { from: 'lamp_open_wire_r', to: 'rl2_wire_l', type: 'wire' },
        { from: 'rl2_wire_r', to: 'dc_i_wire_n', type: 'wire' },
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
    const gen = sys.comps['gen1'];
    if (gen) gen.onConfigUpdate({ isOn: true });
    const q = sys.comps['qf1'];
    if (q) q.reset();
}

export function fiveStep() {
}
