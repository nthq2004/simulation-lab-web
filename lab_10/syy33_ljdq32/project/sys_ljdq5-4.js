// 船舶发电机主开关仿真工程（同步发电机 + 汇流排 + 船用框架式空气断路器）

import { SyncGenerator3P } from '../components/SyncGenerator3P.js';
import { Busbar3P } from '../components/Busbar3P.js';
import { MarineMainsSwitch } from '../components/MarineMainsSwitch.js';
import { EmergencyGenerator3P } from '../components/EmergencyGenerator3P.js';
import { EmergencyMainsSwitch } from '../components/EmergencyMainsSwitch.js';
import { TieSwitch } from '../components/TieSwitch.js';
import { EmergencyPanel } from '../components/EmergencyPanel.js';
import { GeneratorRemotePanel } from '../components/GeneratorRemotePanel.js';
import { DCPower } from '../components/DCPower.js';
import { Ground } from '../components/Gnd.js';
import { ShorePowerMainSwitch } from '../components/ShorePowerMainSwitch.js';
import { ShorePowerBox } from '../components/ShorePowerBox.js';
import { ACPower3P } from '../components/ACPower3P.js';
import { NegativeSeqRelay } from '../components/NegativeSeqRelay.js';
import { IncandescentLamp } from '../components/IncandescentLamp.js';
import { Multimeter } from '../components/Multimeter.js';
import { MF47Multimeter } from '../components/MF47Multimeter.js';
import { Oscilloscope_tri } from '../components/Osc_tri.js';
import { SignalGenerator } from '../components/SignalGenerator.js';
import { ProcessCalibrator } from '../components/ProcessCalibrator.js';
import { ElecMeter } from '../components/ElecMeter.js';

function _fcomp(id) {
    const s = window.sys;
    return s && s.comps && s.comps[id] ? s.comps[id] : null;
}

export const FAULT_CONFIGS = {

};

export const PROJECT_WORKFLOWS = {
    // ── 流程：船舶岸电接入系统认识 ──
    'shore-power-intro': {
        id: 'shore-power-intro',
        name: '0. 船舶岸电接入系统认识',
        steps: [
            {
                msg: '1. 请点击识别岸电箱面板上的「相序指示灯」（ 正序 / 负序 指示灯）',
                mode: 'find', target: 'shorebox1', subTarget: 'phase-lamps',
            },
            {
                msg: '2. 请点击识别岸电箱内的「空气开关」（刀片式断路器）',
                mode: 'find', target: 'shorebox1', subTarget: 'breaker',
            },
            {
                msg: '3. 请点击识别「负序继电器」',
                mode: 'find', target: 'neg1',
            },
            {
                msg: '4. 请点击识别「岸电主开关」',
                mode: 'find', target: 'pdb1',
            },
            {
                msg: '5. 测试题：如何确保岸电和船电不同时供电？', mode: 'quiz',
                quizConfig: {
                    question: '船舶靠港接用岸电时，如何确保岸电（岸电电源）与船电（船舶发电机）不会同时向电网供电？',
                    options: [
                        '采用电气联锁：岸电主开关合闸后自动切断船电主开关的失压脱扣线圈电源，使其无法合闸；反之亦然，二者只能有一台合闸',
                        '完全依靠值班人员手动操作，不需要任何联锁保护',
                        '为提高供电可靠性，岸电与船电可同时合闸供电',
                        '岸电与船电是否同时供电没有影响，可以随意操作',
                    ],
                    answer: 0,
                    analysis: '岸电与船电互为备用电源，必须通过电气联锁保证二者不能同时合闸，否则会造成非同期并列、短路等严重事故。岸电主开关合闸时其常闭辅助触头断开，切断船电主开关失压脱扣线圈回路，使船电主开关不能合闸；船电主开关合闸时同样联锁岸电主开关。',
                },
            },
            {
                msg: '6. 测试题：负序继电器的作用', mode: 'quiz',
                quizConfig: {
                    question: '在船舶岸电接入系统中，负序继电器的主要作用是什么？',
                    options: [
                        '检测岸电相序，当相序为负序（或缺相）时其常闭触点断开，切断岸电主开关失压脱扣线圈电源，防止错相（缺相）供电损坏设备',
                        '检测岸电电压高低，电压过低时发出报警',
                        '检测岸电频率，频率偏离 50Hz 时使主开关跳闸',
                        '测量岸电电流大小并显示在面板上',
                    ],
                    answer: 0,
                    analysis: '负序继电器用于监视岸电的相序。当岸电相序正确（正序）时其常闭触点闭合，允许岸电主开关合闸；当相序接反（负序）时触点断开，阻止岸电接入，避免因相序错误导致船舶电动机反转等事故。',
                },
            },
        ],
    },

    // ── 流程二：船电转换为岸电供电 ──
    'shore-power-switch': {
        id: 'shore-power-switch',
        name: '1. 船电转换为岸电供电',
        steps: [
            {
                msg: '1. 自动接线、起动 1# 主发电机并合上船电主开关，由船电向汇流排供电。',
                mode: 'check',
                act() {
                    const sys = this.sys;
                    if (!sys) return;
                    _autoWire(sys);
                    const g1 = sys.comps['gen1'];
                    if (g1) { g1.freq = 50; g1.isOn = true; }
                    const q1 = sys.comps['qf1'];
                    if (q1) {
                        if (q1.getState() === 'on' && q1.tryTrip) q1.tryTrip();
                        q1._chargeProg = 5; q1._charged = true;
                        if (q1.tryClose) q1.tryClose();
                    }
                },
                check() {
                    const sys = this.sys;
                    const g1 = sys.comps['gen1'];
                    const q1 = sys.comps['qf1'];
                    return !!(g1 && g1.isOn && q1 && q1.getState() === 'on');
                },
            },
            {
                msg: '2. 手动接通岸电箱输入线：岸电电源 U/V/W 接岸电箱 in1/in2/in3，岸电电源 N 接岸电箱 N（船体接线柱），然后合上岸电电源。',
                mode: 'check',
                act() {
                    const sys = this.sys;
                    if (!sys) return;
                    const add = (a, b) => sys.connMgr.addConn({ from: a, to: b, type: 'wire' });
                    add('shore_in_wire_u', 'shorebox1_wire_in1');
                    add('shore_in_wire_v', 'shorebox1_wire_in2');
                    add('shore_in_wire_w', 'shorebox1_wire_in3');
                    add('shorebox1_wire_n', 'shore_in_wire_n');
                    const sp = sys.comps['shore_in'];
                    if (sp) { sp.isOn = true; sp.phaseSeq = 'pos'; }
                },
                check() {
                    const sys = this.sys;
                    const connected = (a, b) => sys.conns.some(c => (c.from === a && c.to === b) || (c.from === b && c.to === a));
                    const ok = connected('shore_in_wire_u', 'shorebox1_wire_in1')
                            && connected('shore_in_wire_v', 'shorebox1_wire_in2')
                            && connected('shore_in_wire_w', 'shorebox1_wire_in3')
                            && connected('shorebox1_wire_n', 'shore_in_wire_n');
                    const sp = sys.comps['shore_in'];
                    return ok && !!(sp && sp.isOn);
                },
            },
            {
                msg: '3. 转换相序开关，观察岸电箱液晶显示的线电压、频率与相序指示灯：确认输出为正相序后，合上岸电箱内的空气开关。',
                mode: 'check',
                act() {
                    const sys = this.sys;
                    const sb = sys && sys.comps['shorebox1'];
                    if (!sb) return;
                    sb._knob = 1;                       // 相序1（进线正序时输出为正相序）
                    if (sb._updateSwitchLines) sb._updateSwitchLines();
                    if (sb._knobInd) sb._knobInd.rotation(sb._knobAngle());
                    if (sb.tryCloseBreaker) sb.tryCloseBreaker();
                },
                check() {
                    const sys = this.sys;
                    const sb = sys && sys.comps['shorebox1'];
                    if (!sb) return false;
                    const outPos = (sb._phase === 'pos') !== (sb._knob === 2);
                    return sb._inPowered() && sb.getKnob() !== 0 && outPos && sb.getBreakerOn();
                },
            },
            {
                msg: '4. 测试题：船电与岸电互锁，在接岸电前，主发电机和应急发电机要怎么设置？', mode: 'quiz',
                quizConfig: {
                    question: '在接入岸电之前，为避免船电与岸电非同期并列，主发电机和应急发电机应处于什么状态？',
                    options: [
                        '均切换为手动（或分闸）模式，防止其自动合闸投入电网',
                        '保持自动模式，让其自动跟踪母线电压并网',
                        '只停主发电机，应急发电机保持自动',
                        '不需要任何设置，岸电接入会自动处理',
                    ],
                    answer: 0,
                    analysis: '接入岸电前必须解除船电侧的自动合闸条件：主发电机与应急发电机均应置于手动（或已分闸）状态，使其不会在岸电投入时自动合闸，从而避免船电与岸电非同期并列造成短路、设备损坏等严重事故。',
                },
            },
            {
                msg: '5. 迅速切断船用发电机主开关，再合上岸电主开关，实现由岸电向汇流排供电。',
                mode: 'check',
                act() {
                    const sys = this.sys;
                    const q1 = sys && sys.comps['qf1'];
                    const pdb = sys && sys.comps['pdb1'];
                    if (q1 && q1.tryTrip) q1.tryTrip();
                    if (pdb && pdb.close) pdb.close();
                },
                check() {
                    const sys = this.sys;
                    const q1 = sys && sys.comps['qf1'];
                    const pdb = sys && sys.comps['pdb1'];
                    const qfOff = q1 && q1.getState && q1.getState() !== 'on';
                    const pdbOn = pdb && pdb.isClosed && pdb.isClosed();
                    return !!(qfOff && pdbOn);
                },
            },
            {
                msg: '6. 测试题：中线为何接船体柱？', mode: 'quiz',
                quizConfig: {
                    question: '船舶岸电系统中，岸电电源的中线为什么要接到船体接线柱（船体/船壳）？',
                    options: [
                        '船舶电网中性点通过船体（海水）接地，岸电中线接船体柱可使岸电中性点与船体等电位，构成供电回路参考点，并为绝缘故障提供故障电流通路，保障人身与设备安全',
                        '只是为了方便固定导线，没有电气意义',
                        '为了防止岸电频率漂移',
                        '为了让岸电电压升高',
                    ],
                    answer: 0,
                    analysis: '船舶本身是一个以船体（海水）为接地极的浮动电网，其中性点通过船体接地。将岸电中线接至船体接线柱，可把岸电中性点与船体（船电中性点）连接为同一参考电位，既保证单相负载回路完整，又能在发生绝缘/接地故障时提供故障电流通路，保护人员与设备安全。',
                },
            },
        ],
    },

    // ── 流程三：岸电切换为船电供电 ──
    'shore-to-ship-switch': {
        id: 'shore-to-ship-switch',
        name: '2. 岸电切换为船电供电',
        steps: [
            {
                msg: '1. 自动接线并接通岸电：将岸电电源 U/V/W 接岸电箱 in1/in2/in3，岸电电源 N 接岸电箱船体接线柱，并合上岸电电源。',
                mode: 'check',
                act() {
                    const sys = this.sys;
                    if (!sys) return;
                    _autoWire(sys);
                    const add = (a, b) => sys.connMgr.addConn({ from: a, to: b, type: 'wire' });
                    add('shore_in_wire_u', 'shorebox1_wire_in1');
                    add('shore_in_wire_v', 'shorebox1_wire_in2');
                    add('shore_in_wire_w', 'shorebox1_wire_in3');
                    add('shorebox1_wire_n', 'shore_in_wire_n');
                    const sp = sys.comps['shore_in'];
                    if (sp) { sp.isOn = true; sp.phaseSeq = 'pos'; }
                },
                check() {
                    const sys = this.sys;
                    const connected = (a, b) => sys.conns.some(c => (c.from === a && c.to === b) || (c.from === b && c.to === a));
                    const ok = connected('shore_in_wire_u', 'shorebox1_wire_in1')
                            && connected('shore_in_wire_v', 'shorebox1_wire_in2')
                            && connected('shore_in_wire_w', 'shorebox1_wire_in3')
                            && connected('shorebox1_wire_n', 'shore_in_wire_n');
                    const sp = sys.comps['shore_in'];
                    return ok && !!(sp && sp.isOn);
                },
            },
            {
                msg: '2. 转换相序开关，确认输出为正相序后，合上岸电箱内的空气开关。',
                mode: 'check',
                act() {
                    const sys = this.sys;
                    const sb = sys && sys.comps['shorebox1'];
                    if (!sb) return;
                    sb._knob = 1;
                    if (sb._updateSwitchLines) sb._updateSwitchLines();
                    if (sb._knobInd) sb._knobInd.rotation(sb._knobAngle());
                    if (sb.tryCloseBreaker) sb.tryCloseBreaker();
                },
                check() {
                    const sys = this.sys;
                    const sb = sys && sys.comps['shorebox1'];
                    if (!sb) return false;
                    const outPos = (sb._phase === 'pos') !== (sb._knob === 2);
                    return sb._inPowered() && sb.getKnob() !== 0 && outPos && sb.getBreakerOn();
                },
            },
            {
                msg: '3. 合上岸电主开关，由岸电向汇流排供电。',
                mode: 'check',
                act() {
                    const sys = this.sys;
                    const pdb = sys && sys.comps['pdb1'];
                    if (pdb && pdb.close) pdb.close();
                },
                check() {
                    const sys = this.sys;
                    const pdb = sys && sys.comps['pdb1'];
                    return !!(pdb && pdb.isClosed && pdb.isClosed());
                },
            },
            {
                msg: '4. 起动船舶主发电机，再尝试合上船电主开关——因岸电互锁，合闸应失败。',
                mode: 'check',
                act() {
                    const sys = this.sys;
                    const g1 = sys && sys.comps['gen1'];
                    const q1 = sys && sys.comps['qf1'];
                    if (g1) { g1.freq = 50; g1.isOn = true; }
                    if (q1) {
                        q1._chargeProg = 5; q1._charged = true;
                        if (q1.tryClose) q1.tryClose();   // 受岸电互锁，应无法保持合闸
                    }
                },
                check() {
                    const sys = this.sys;
                    const g1 = sys && sys.comps['gen1'];
                    const q1 = sys && sys.comps['qf1'];
                    const genOn = g1 && g1.isOn;
                    const qfNotClosed = q1 && q1.getState && q1.getState() !== 'on';
                    return !!(genOn && qfNotClosed);
                },
            },
            {
                msg: '5. 测试题：岸电供电时，船舶主发电机合闸失败的原因。', mode: 'quiz',
                quizConfig: {
                    question: '在岸电供电期间，试图合上船舶主发电机主开关却失败，其主要原因是什么？',
                    options: [
                        '岸电主开关合闸后其常闭辅助触头断开，切断了船电主开关的失压脱扣线圈电源，使船电主开关失压脱扣而无法合闸（电气联锁保证只能一台供电）',
                        '船舶主发电机没有起动，所以当然合不上',
                        '岸电电压太低，导致船电主开关拒动',
                        '汇流排上没有电，所以合不上',
                    ],
                    answer: 0,
                    analysis: '系统设有船电/岸电电气联锁：岸电主开关合闸到位后，其常闭辅助触头断开，切断船电主开关失压脱扣线圈的供电，使船电主开关因失压脱扣而合不上（或合上后随即跳闸），从而保证岸电与船电不会同时向电网供电。',
                },
            },
            {
                msg: '6. 分闸岸电主开关，再合上船舶发电机主开关，恢复由船电向汇流排供电。',
                mode: 'check',
                act() {
                    const sys = this.sys;
                    const q1 = sys && sys.comps['qf1'];
                    const pdb = sys && sys.comps['pdb1'];
                    if (pdb && pdb.open) pdb.open();      // 切断岸电
                    if (q1) {
                        q1._chargeProg = 5; q1._charged = true;
                        if (q1.tryClose) q1.tryClose();   // 岸电已断，联锁解除，可合闸
                    }
                },
                check() {
                    const sys = this.sys;
                    const q1 = sys && sys.comps['qf1'];
                    const pdb = sys && sys.comps['pdb1'];
                    const shoreOff = pdb && pdb.isClosed && !pdb.isClosed();
                    const qfOn = q1 && q1.getState && q1.getState() === 'on';
                    return !!(shoreOff && qfOn);
                },
            },
        ],
    },
};

export const componentConfigs = [
    // ── 主回路：同步发电机 → 主开关 → 汇流排 ──
    { Class: SyncGenerator3P, id: 'gen1', x: -120, y: 700, vRms: 230, freq: 50, isOn: false, mode: 'remote', label: '1#同步发电机', ratedPower: 80, ratedVoltage: 400, ratedCosPhi: 0.8, maxDropV: 200, avrMaxComp: 1, avrDelay: 2, avrTime: 5, autoDecoupleTrim: true, visible: true },
    { Class: MarineMainsSwitch, id: 'qf1', x: -120, y: 180, ratedCtrlVoltage: 24, label: '主开关', genId: 'gen1', revPowerKw: 8, revTime: 5, faultSimpleProtect: true, visible: true },
    { Class: GeneratorRemotePanel, id: 'genpanel', x: 360, y: 700, genId: 'gen1', qfId: 'qf1', label: '1#发电机组遥控面板', busId: 'bus1', visible: true },

    { Class: Busbar3P, id: 'bus1', x: 0, y: 30, portsPerBar: 10, label: '汇流排', visible: true },


    // ── 1号机组控制电源共地（遥控面板与控制电源的中间下方）──
    // dc_uv 负极、genpanel p24_n 共同接此接地，不再向线圈引出负极线
    { Class: Ground, id: 'gnd1_uv', x: 590, y: 1000, label: '控制电源接地', visible: true },
    // ── 1号主开关线圈接地（主开关右下角）──
    // 储能电机 m2 / 失压 uv2 / 合闸 c2 / 分励 flb 负端均接此接地
    { Class: Ground, id: 'gnd1_qf', x: 630, y: 530, label: '线圈接地', visible: true },

    { Class: Ground, id: 'gnd1_pdb', x: 970, y: 430, label: '岸电失压接地', visible: true },   
    // ── 1号遥控面板信号接地（面板上方）──
    // 合闸输出 close_b、分闸输出 open_b 负端接地
    { Class: Ground, id: 'gnd1_panel', x: 530, y: 670, label: '信号接地', visible: true },

    // ── 控制电源（DC 24V）：失压脱扣线圈 ──
    { Class: DCPower, id: 'dc_uv', x: 660, y: 750, voltage: 24, isOn: true, label: '失压脱扣电源', visible: true },

    // ── 岸电主开关（塑壳断路器，替代原低压配电箱第3路）──
    { Class: ShorePowerMainSwitch, id: 'pdb1', x: 730, y: 220, label: '岸电主开关', ratedCurrent: 100, shortDelay: 0.2, overloadK: 4, tripCoilR: 200, initState: 'off', visible: true },
    // ── 岸电箱（相序检测 + 相序转换开关 + 出口断路器）──
    { Class: ShorePowerBox, id: 'shorebox1', x: 1150, y: 320, label: '岸电箱', lineSeq: 'pos', knob: 0, breakerOn: false, visible: true },
    // ── 岸电输入：简单三相电源（正相序 UVW）──
    { Class: ACPower3P, id: 'shore_in', x: 1335, y: 5, vRms: 220, freq: 50, isOn: false, phaseSeq: 'pos', label: '岸电输入电源', visible: true },
    // ── 负序继电器：右接岸电箱输出三线，左常闭触点串入 24V 电源正极与船电主开关常闭触头之间 ──
    { Class: NegativeSeqRelay, id: 'neg1', x: 1010, y: 730, label: '负序继电器', visible: true },
    // ── 岸电箱右侧白炽灯负载（上端接汇流排第10端子，下端星型连接，冷态48.4Ω）──
    { Class: IncandescentLamp, id: 'bl1', x: 1610, y: 480, coldResistance: 48.4, label: 'L1灯',rotation:90, visible: true },
    { Class: IncandescentLamp, id: 'bl2', x: 1680, y: 480, coldResistance: 48.4, label: 'L2灯', rotation: 90, visible: true },
    { Class: IncandescentLamp, id: 'bl3', x: 1750, y: 480, coldResistance: 48.4, label: 'L3灯', rotation: 90, visible: true },

    { Class: Multimeter, id: 'multimeter', x: 920, y: 100, visible: false },
    { Class: MF47Multimeter, id: 'mf47-panel', x: 1050, y: 150, visible: false },
    { Class: Oscilloscope_tri, id: 'osc', x: 50, y: 50, visible: false },
    { Class: SignalGenerator, id: 'sg', x: 50, y: 50, visible: false },
    { Class: ProcessCalibrator, id: 'cali', x: 50, y: 50, visible: false },
    { Class: ElecMeter, id: 'elecmeter', x: 50, y: 50, visible: false },
];

// ─── 接线辅助 ───

const _sleep = ms => new Promise(r => setTimeout(r, ms));

// 模拟按住遥控面板按钮（btnKey: _userStartPressed / _userStopPressed / _userClosePressed / _userOpenPressed）
async function _pressPanelBtn(sys, pid, btnKey, ms = 900) {
    const gp = sys.comps[pid];
    if (!gp || !(btnKey in gp)) return;
    gp[btnKey] = true;
    await _sleep(ms);
    gp[btnKey] = false;
}

function _autoWire(sys) {
    sys.conns.length = 0;
    const cons = [
        // ── 主回路：同步发电机 → 主开关 → 汇流排（第2口）──
        { from: 'gen1_wire_u', to: 'qf1_wire_t1', type: 'wire' },
        { from: 'gen1_wire_v', to: 'qf1_wire_t2', type: 'wire' },
        { from: 'gen1_wire_w', to: 'qf1_wire_t3', type: 'wire' },
        { from: 'qf1_wire_l1', to: 'bus1_wire_l1_2', type: 'wire' },
        { from: 'qf1_wire_l2', to: 'bus1_wire_l2_2', type: 'wire' },
        { from: 'qf1_wire_l3', to: 'bus1_wire_l3_2', type: 'wire' },
        // ── 岸电回路：岸电箱输入（U/V/W 三线 + N）需学员手动连接，不在此自动接线 ──
        //    （岸电箱输出 → 负序继电器、岸电主开关 仍自动接线）
        // 岸电箱输出 T1-T3 → 负序继电器右侧进线 L1-L3
        { from: 'shorebox1_wire_t1', to: 'neg1_wire_l1', type: 'wire' },
        { from: 'shorebox1_wire_t2', to: 'neg1_wire_l2', type: 'wire' },
        { from: 'shorebox1_wire_t3', to: 'neg1_wire_l3', type: 'wire' },
        // 岸电箱输出 T1-T3 → 岸电主开关下端（sw1_t1-t3）
        { from: 'shorebox1_wire_t1', to: 'pdb1_wire_sw1_t1', type: 'wire' },
        { from: 'shorebox1_wire_t2', to: 'pdb1_wire_sw1_t2', type: 'wire' },
        { from: 'shorebox1_wire_t3', to: 'pdb1_wire_sw1_t3', type: 'wire' },
        // 岸电主开关上端（in1-in3）→ 汇流排第6口
        { from: 'pdb1_wire_in1', to: 'bus1_wire_l1_6', type: 'wire' },
        { from: 'pdb1_wire_in2', to: 'bus1_wire_l2_6', type: 'wire' },
        { from: 'pdb1_wire_in3', to: 'bus1_wire_l3_6', type: 'wire' },
        // （岸电箱 N → 岸电电源 N 由学员在操作流程 2 第 2 步手动连接，不在此自动接线）
        // ── 岸电箱右侧白炽灯：上端(l)接汇流排第10端子，下端(r)星型连接（冷态48.4Ω）──
        { from: 'bus1_wire_l1_10', to: 'bl1_wire_l', type: 'wire' },
        { from: 'bus1_wire_l2_10', to: 'bl2_wire_l', type: 'wire' },
        { from: 'bus1_wire_l3_10', to: 'bl3_wire_l', type: 'wire' },
        { from: 'bl1_wire_r', to: 'bl2_wire_r', type: 'wire' },
        { from: 'bl2_wire_r', to: 'bl3_wire_r', type: 'wire' },


        // ── 控制电源 DC 24V 双向互锁（岸电 / 发电机主开关 失压线圈）──
        // 互锁逻辑：每台开关的失压线圈由“对方”主开关的常闭辅助触头供电，
        // 任一台完全合闸到位即切断对方线圈电源 → 对方失压脱扣 → 不能同时合闸。
        // 注意：常闭触头仅在“合闸完全到位”才断开（见 isNCClosed），
        // 推闸中途/被锁弹回（TRIP）时保持闭合，不会误切对方线圈。
        // 24V+ → 岸电常闭触头(nc1→nc2) → 发电机主开关失压线圈(qf1 uv1)
        { from: 'dc_uv_wire_p', to: 'pdb1_wire_nc2', type: 'wire' },
        { from: 'pdb1_wire_nc1', to: 'qf1_wire_uv1', type: 'wire' },
        // 24V+ → 负序继电器 NC2 → 常闭触点 → NC1 → 船电主开关常闭触头(nc1) → 岸电失压线圈
        { from: 'dc_uv_wire_p', to: 'neg1_wire_nc2', type: 'wire' },
        { from: 'neg1_wire_nc1', to: 'qf1_wire_nc1', type: 'wire' },
        { from: 'qf1_wire_nc2', to: 'pdb1_wire_sw1_uv1', type: 'wire' },
        // 两台失压线圈另一端均接地（gnd1_qf，线圈接地）
        { from: 'qf1_wire_uv2', to: 'gnd1_qf_wire_gnd', type: 'wire' },
        { from: 'pdb1_wire_sw1_uv2', to: 'gnd1_pdb_wire_gnd', type: 'wire' },
        // 发电机主开关储能电机仍由 24V+ 直接供电（不受互锁影响）
        { from: 'dc_uv_wire_p', to: 'qf1_wire_m1', type: 'wire' },
        { from: 'qf1_wire_m2', to: 'gnd1_qf_wire_gnd', type: 'wire' },
        { from: 'dc_eqf_wire_n', to: 'gnd_eqf_wire_gnd', type: 'wire' },
        // ── 发电机组遥控面板：左面板 → gen1 遥控端口 ──
        { from: 'genpanel_wire_start_a', to: 'gen1_wire_rm_start_a', type: 'wire' },
        { from: 'genpanel_wire_start_b', to: 'gen1_wire_rm_start_b', type: 'wire' },
        { from: 'genpanel_wire_stop_a', to: 'gen1_wire_rm_stop_a', type: 'wire' },
        { from: 'genpanel_wire_stop_b', to: 'gen1_wire_rm_stop_b', type: 'wire' },
        { from: 'genpanel_wire_spd_p', to: 'gen1_wire_freq_in_p', type: 'wire' },
        { from: 'genpanel_wire_spd_n', to: 'gen1_wire_freq_in_n', type: 'wire' },
        // 合闸/分闸正端 → 线圈正端；输出负端接地（gnd1_panel，面板上方）、线圈负端接地（gnd1_qf）
        { from: 'genpanel_wire_close_a', to: 'qf1_wire_c1', type: 'wire' },
        { from: 'genpanel_wire_open_a', to: 'qf1_wire_fla', type: 'wire' },
        { from: 'genpanel_wire_close_b', to: 'gnd1_panel_wire_gnd', type: 'wire' },
        { from: 'genpanel_wire_open_b', to: 'gnd1_panel_wire_gnd', type: 'wire' },
        { from: 'qf1_wire_c2', to: 'gnd1_qf_wire_gnd', type: 'wire' },
        { from: 'qf1_wire_flb', to: 'gnd1_qf_wire_gnd', type: 'wire' },
        // ── 左面板 24V 电源 ← dc_uv（正端）；负端接地（gnd1_uv，面板与控制电源中间下方）──
        { from: 'dc_uv_wire_p', to: 'genpanel_wire_p24_p', type: 'wire' },
        { from: 'dc_uv_wire_n', to: 'gnd1_uv_wire_gnd', type: 'wire' },
        { from: 'genpanel_wire_p24_n', to: 'gnd1_uv_wire_gnd', type: 'wire' },
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
    // 起动发电机前先完整复位（防止上次流程残留的极端设定/开关状态
    // 导致加载系统时发电机运行状态异常）：
    // 设定频率归位 50Hz；1 号机投入运行；主开关分闸。
    const g1 = sys.comps.gen1;
    if (g1) { g1.freq = 50; g1.isOn = true; }
    const q1 = sys.comps.qf1;
    if (q1 && q1.getState() === 'on' && q1.tryTrip) q1.tryTrip();
    // 应急发电机：停机状态，频率 50Hz，控制方式远程（由应急配电板控制）
    const eg1 = sys.comps.egen1;
    if (eg1) { eg1.freq = 50; eg1.isOn = false; eg1.mode = 'remote'; }
    // 应急发电机主开关：分闸复位，恢复储能
    const eq1 = sys.comps.eqf1;
    if (eq1) {
        if (eq1.getState() === 'on' && eq1.tryTrip) eq1.tryTrip();
        if (eq1._chargeProg !== undefined) { eq1._chargeProg = 5; eq1._charged = true; }
    }
    // 联络开关：分闸复位
    const t1 = sys.comps.tie1;
    if (t1 && t1.getState() === 'on' && t1.tryTrip) t1.tryTrip();
    // 应急配电板：复位状态机为 idle，模式切回自动
    const ep = sys.comps.ep1;
    if (ep) { ep._phase = 'idle'; ep._timer = 0; ep._manualTieTimer = 0; ep._mode = 'auto'; ep._tiePosition = 'normal'; }
    // 岸电输入三相电源：确保开启（正相序）
    const sp = sys.comps.shore_in;
    if (sp) { sp.isOn = true; sp.phaseSeq = 'pos'; }
}

export function fiveStep() {
}
