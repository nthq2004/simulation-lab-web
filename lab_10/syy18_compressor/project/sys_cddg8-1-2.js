// 三相交流接触器功能测试仿真工程

import { ACPower } from '../components/ACPower.js';
import { DCPower } from '../components/DCPower.js';
import { Switch } from '../components/Switch.js';
import { ThreePhaseContactor } from '../components/ThreePhaseContactor.js';
import { Multimeter } from '../components/Multimeter.js';
import { MF47Multimeter } from '../components/MF47Multimeter.js';
import { Oscilloscope_tri } from '../components/Osc_tri.js';
import { SignalGenerator } from '../components/SignalGenerator.js';
import { ProcessCalibrator } from '../components/ProcessCalibrator.js';
import { ElecMeter } from '../components/ElecMeter.js';

export const FAULT_CONFIGS = {
    stuck: {
        id: 'stuck', name: '卡死', system: '接触器',
        check()  { const c = window.sys && window.sys.comps && window.sys.comps.km1; return c && c._faultStuck; },
        trigger() { const c = window.sys && window.sys.comps && window.sys.comps.km1; if (c) c._faultStuck = true; },
        repair() { const c = window.sys && window.sys.comps && window.sys.comps.km1; if (c) c._faultStuck = false; },
    },
    coil_open: {
        id: 'coil_open', name: '线圈断线', system: '接触器',
        check()  { const c = window.sys && window.sys.comps && window.sys.comps.km1; return c && c._faultCoilOpen; },
        trigger() { const c = window.sys && window.sys.comps && window.sys.comps.km1; if (c) c._faultCoilOpen = true; },
        repair() { const c = window.sys && window.sys.comps && window.sys.comps.km1; if (c) c._faultCoilOpen = false; },
    },
    contact_l1t1: {
        id: 'contact_l1t1', name: '主触头 L1-T1 接触不良', system: '接触器',
        check()  { const c = window.sys && window.sys.comps && window.sys.comps.km1; return c && c._faultContactL1T1; },
        trigger() { const c = window.sys && window.sys.comps && window.sys.comps.km1; if (c) c._faultContactL1T1 = true; },
        repair() { const c = window.sys && window.sys.comps && window.sys.comps.km1; if (c) c._faultContactL1T1 = false; },
    },
    contact_no1: {
        id: 'contact_no1', name: '辅助常开 NO1 接触不良', system: '接触器',
        check()  { const c = window.sys && window.sys.comps && window.sys.comps.km1; return c && c._faultContactNO1; },
        trigger() { const c = window.sys && window.sys.comps && window.sys.comps.km1; if (c) c._faultContactNO1 = true; },
        repair() { const c = window.sys && window.sys.comps && window.sys.comps.km1; if (c) c._faultContactNO1 = false; },
    },
    shading_ring: {
        id: 'shading_ring', name: '短路环脱落', system: '接触器',
        check()  { const c = window.sys && window.sys.comps && window.sys.comps.km1; return c && c._faultShadingRing; },
        trigger() { const c = window.sys && window.sys.comps && window.sys.comps.km1; if (c) c._faultShadingRing = true; },
        repair() { const c = window.sys && window.sys.comps && window.sys.comps.km1; if (c) c._faultShadingRing = false; },
    },
};

export const PROJECT_WORKFLOWS = {

    // ============================================================
    // 项目1：识别三相交流接触器的电磁机构与触头系统
    // ============================================================
    'structure-awareness': {
        id: 'structure-awareness',
        name: '1. 电磁铁结构的认识',
        steps: [
            {
                msg: '第 1 步：识别电磁线圈。电磁线圈绕在 E 形静铁心的中柱上，两侧引出 A1、A2 接线端。线圈通电后产生电磁吸力。',
                mode: 'find',
                target: 'km1',
                subTarget: 'coil',
                async act() {
                    // 结构认识在“线圈断电、衔铁释放”状态下进行
                    _deEnergize(this.sys);
                    await _sleep(600);
                },
            },
            {
                msg: '第 2 步：识别静铁芯。静铁芯为 E 形，固定不动，由硅钢片叠压而成。',
                mode: 'find',
                target: 'km1',
                subTarget: 'core',
            },
            {
                msg: '第 3 步：识别动衔铁。动衔铁位于静铁芯右侧，可沿水平方向运动。它通过可动轴带动右侧全部触点动作。',
                mode: 'find',
                target: 'km1',
                subTarget: 'armature',
            },
            {
                msg: '第 4 步：识别反作用弹簧。线圈通电吸合时弹簧被拉伸储存弹性势能，线圈断电后靠弹簧拉力使动衔铁释放复位。',
                mode: 'find',
                target: 'km1',
                subTarget: 'spring',
            },
            {
                msg: '第 5 步：识别主触头。主触头是三对常开触点（L1-T1、L2-T2、L3-T3），用于接通和断开电动机等主电路；触头面积大、开距大，能承载大电流并具有灭弧能力。',
                mode: 'find',
                target: 'km1',
                subTarget: 'main-contact',
            },
            {
                msg: '第 6 步：识别辅助常开触头。辅助常开触头（NO）与主触头同步动作，用于自锁、控制、连锁等信号回路。',
                mode: 'find',
                target: 'km1',
                subTarget: 'aux-no',
            },
            {
                msg: '第 7 步：识别辅助常闭触头。辅助常闭触头（NC）与常开触头相反。',
                mode: 'find',
                target: 'km1',
                subTarget: 'aux-nc',
            },
            {
                msg: '第 8 步：结构知识测试',
                mode: 'quiz',
                quizConfig: {
                    question: '三相交流接触器的电磁机构主要由哪些部件组成？',
                    options: [
                        '线圈、静铁芯、动衔铁、反作用弹簧',
                        '仅由电磁线圈和静铁芯组成',
                        '线圈、主触头和辅助触头',
                        '弹簧、制动盘和转轴',
                    ],
                    answer: 0,
                    analysis: '交流接触器的电磁机构（电磁操动机构）由电磁线圈、静铁芯（E 形铁心）、动衔铁和反作用弹簧组成。线圈通电产生电磁力吸合动衔铁，经可动轴带动主触头与辅助触头切换；线圈断电后，反作用弹簧使动衔铁释放复位。主触头、辅助触头属于触头系统，不属于电磁机构。',
                },
            },
        ],
    },

    // ============================================================
    // 项目2：用万用表检测接触器的线圈与触点（未通电状态）
    // ============================================================
    'multimeter-test': {
        id: 'multimeter-test',
        name: '2. 万用表检测接触器线圈与触点',
        steps: [
            {
                msg: '第 1 步：将数字万用表切换到 2kΩ 电阻档，红表笔（V 孔）接接触器线圈 A1 端，黑表笔（COM 孔）接 A2 端，测量线圈电阻（正常约 1000Ω）。',
                mode: 'check',
                op: [
                    {
                        type: 'instrument', instrument: 'multimeter',
                        msg: '从仪表库调出数字万用表',
                    },
                    {
                        type: 'switch', target: 'multimeter', part: 'knob',
                        msg: '将万用表旋钮转到 2kΩ 电阻档',
                        act() { _setMMMode(this.sys, 'RES2k'); },
                    },
                    {
                        type: 'observe', target: 'multimeter', part: 'v',
                        msg: '红表笔（V 孔）接触器线圈 A1 端',
                        async act() {
                            const sys = this.sys;
                            _deEnergize(sys);          // 保证测的是未通电线圈
                            sys.conns.length = 0;
                            sys.redrawAll();
                            await _wireAnim(sys, 'multimeter_wire_v', 'km1_wire_a1');
                        },
                    },
                    {
                        type: 'observe', target: 'multimeter', part: 'com',
                        msg: '黑表笔（COM 孔）接线圈 A2 端',
                        async act() { await _wireAnim(this.sys, 'multimeter_wire_com', 'km1_wire_a2'); },
                    },
                ],
                check() {
                    const c = (a, b) => this.sys.isPortConnected(a, b);
                    const km = this.sys.comps['km1'];
                    return km && km.getState() === 'off'
                        && c('multimeter_wire_v', 'km1_wire_a1')
                        && c('multimeter_wire_com', 'km1_wire_a2');
                },
            },
            {
                msg: '第 2 步：将万用表红表笔接接触器主触点 L1 端，黑表笔接 T1 端。接触器未通电时，主触点为常开状态，应不导通（阻值无穷大）。',
                mode: 'check',
                op: [
                    {
                        type: 'observe', target: 'km1', part: 'l1',
                        msg: '红表笔接主触点 L1 端',
                        async act() {
                            const sys = this.sys;
                            sys.conns.length = 0;
                            sys.redrawAll();
                            await _wireAnim(sys, 'multimeter_wire_v', 'km1_wire_l1');
                        },
                    },
                    {
                        type: 'observe', target: 'km1', part: 't1',
                        msg: '黑表笔接主触点 T1 端',
                        async act() { await _wireAnim(this.sys, 'multimeter_wire_com', 'km1_wire_t1'); },
                    },
                ],
                check() {
                    const c = (a, b) => this.sys.isPortConnected(a, b);
                    const same = () => _sameCluster(this.sys, 'km1_wire_l1', 'km1_wire_t1');
                    return c('multimeter_wire_v', 'km1_wire_l1')
                        && c('multimeter_wire_com', 'km1_wire_t1')
                        && !same();
                },
            },
            {
                msg: '第 3 步：将万用表红表笔接常开辅助触点 13（NO1a），黑表笔接 14（NO1b）。接触器未通电时，常开触点应不导通。',
                mode: 'check',
                op: [
                    {
                        type: 'observe', target: 'km1', part: 'no1a',
                        msg: '红表笔接常开辅助触点 13',
                        async act() {
                            const sys = this.sys;
                            sys.conns.length = 0;
                            sys.redrawAll();
                            await _wireAnim(sys, 'multimeter_wire_v', 'km1_wire_no1a');
                        },
                    },
                    {
                        type: 'observe', target: 'km1', part: 'no1b',
                        msg: '黑表笔接常开辅助触点 14',
                        async act() { await _wireAnim(this.sys, 'multimeter_wire_com', 'km1_wire_no1b'); },
                    },
                ],
                check() {
                    const c = (a, b) => this.sys.isPortConnected(a, b);
                    const same = () => _sameCluster(this.sys, 'km1_wire_no1a', 'km1_wire_no1b');
                    return c('multimeter_wire_v', 'km1_wire_no1a')
                        && c('multimeter_wire_com', 'km1_wire_no1b')
                        && !same();
                },
            },
            {
                msg: '第 4 步：将万用表红表笔接常闭辅助触点 31（NC1a），黑表笔接 32（NC1b）。接触器未通电时，常闭触点应导通。',
                mode: 'check',
                op: [
                    {
                        type: 'observe', target: 'km1', part: 'nc1a',
                        msg: '红表笔接常闭辅助触点 31',
                        async act() {
                            const sys = this.sys;
                            sys.conns.length = 0;
                            sys.redrawAll();
                            await _wireAnim(sys, 'multimeter_wire_v', 'km1_wire_nc1a');
                        },
                    },
                    {
                        type: 'observe', target: 'km1', part: 'nc1b',
                        msg: '黑表笔接常闭辅助触点 32',
                        async act() { await _wireAnim(this.sys, 'multimeter_wire_com', 'km1_wire_nc1b'); },
                    },
                ],
                check() {
                    const c = (a, b) => this.sys.isPortConnected(a, b);
                    const same = () => _sameCluster(this.sys, 'km1_wire_nc1a', 'km1_wire_nc1b');
                    return c('multimeter_wire_v', 'km1_wire_nc1a')
                        && c('multimeter_wire_com', 'km1_wire_nc1b')
                        && same();
                },
            },
            {
                msg: '第 5 步：接触器结构知识',
                mode: 'quiz',
                quizConfig: {
                    question: '三相交流接触器由哪些主要部分组成？',
                    options: [
                        '线圈、铁心、主触点、辅助触点',
                        '仅由线圈和主触点组成',
                        '由电动机和齿轮箱组成',
                        '由电阻和电容组成',
                    ],
                    answer: 0,
                    analysis: '三相交流接触器主要由电磁操动机构（线圈、静铁心、动衔铁）、主触点（3对常开）、辅助触点（常开/常闭）和复位弹簧组成。线圈通电产生电磁力吸合动衔铁，带动触点切换。',
                },
            },
        ],
    },

    // ============================================================
    // 项目3：通电测试接触器的动作（吸合/释放与触点通断）
    // ============================================================
    'power-on-test': {
        id: 'power-on-test',
        name: '3. 通电测试接触器动作',
        steps: [
            {
                msg: '第 1 步：接线：单相交流电源 L 端 → 开关左端，开关右端 → 接触器线圈 A1 端；交流电源 N 端 → 接触器线圈 A2 端。接通电源并合上开关，线圈得电后接触器自动吸合（吸合电压 ≥ 187V）。',
                mode: 'check',
                op: [
                    {
                        type: 'observe', target: 'sw1',
                        msg: '交流电源 L 端 → 开关左端',
                        async act() {
                            const sys = this.sys;
                            _deEnergize(sys);
                            sys.conns.length = 0;
                            sys.redrawAll();
                            await _wireAnim(sys, 'ac1_wire_p', 'sw1_wire_l');
                        },
                    },
                    {
                        type: 'observe', target: 'km1', part: 'a1',
                        msg: '开关右端 → 接触器线圈 A1 端',
                        async act() { await _wireAnim(this.sys, 'sw1_wire_r', 'km1_wire_a1'); },
                    },
                    {
                        type: 'observe', target: 'km1', part: 'a2',
                        msg: '交流电源 N 端 → 接触器线圈 A2 端',
                        async act() { await _wireAnim(this.sys, 'ac1_wire_n', 'km1_wire_a2'); },
                    },
                    {
                        type: 'switch', target: 'ac1', part: 'power',
                        msg: '按下电源键，接通交流电源（220V）',
                        async act() { await _setAcOn(this.sys, true); },
                    },
                    {
                        type: 'switch', target: 'sw1',
                        msg: '合上开关，线圈得电，接触器吸合',
                        async act() {
                            await _setSwitchOn(this.sys, true);
                            await _sleep(1000);   // 观察衔铁吸合、触点切换
                        },
                    },
                ],
                check() {
                    const c = (a, b) => this.sys.isPortConnected(a, b);
                    const km = this.sys.comps['km1'];
                    return km && km.getState() === 'on'
                        && c('ac1_wire_p', 'sw1_wire_l')
                        && c('sw1_wire_r', 'km1_wire_a1')
                        && c('ac1_wire_n', 'km1_wire_a2');
                },
            },
            {
                msg: '第 2 步：接触器已吸合，将万用表红表笔接主触点 L1，黑表笔接 T1。主触点在吸合后应导通（阻值接近 0）。',
                mode: 'check',
                op: [
                    {
                        type: 'instrument', instrument: 'multimeter',
                        msg: '调出数字万用表',
                    },
                    {
                        type: 'switch', target: 'multimeter', part: 'knob',
                        msg: '将万用表旋钮转到 2kΩ 电阻档',
                        act() { _setMMMode(this.sys, 'RES2k'); },
                    },
                    {
                        type: 'observe', target: 'km1', part: 'l1',
                        msg: '红表笔接主触点 L1',
                        async act() {
                            const sys = this.sys;
                            _clearMMConns(sys);   // 只改接万用表引线，保留电源回路
                            await _wireAnim(sys, 'multimeter_wire_v', 'km1_wire_l1');
                        },
                    },
                    {
                        type: 'observe', target: 'km1', part: 't1',
                        msg: '黑表笔接主触点 T1',
                        async act() { await _wireAnim(this.sys, 'multimeter_wire_com', 'km1_wire_t1'); },
                    },
                ],
                check() {
                    const c = (a, b) => this.sys.isPortConnected(a, b);
                    const same = () => _sameCluster(this.sys, 'km1_wire_l1', 'km1_wire_t1');
                    const km = this.sys.comps['km1'];
                    return km && km.getState() === 'on'
                        && same()
                        && c('multimeter_wire_v', 'km1_wire_l1')
                        && c('multimeter_wire_com', 'km1_wire_t1');
                },
            },
            {
                msg: '第 3 步：将万用表红表笔接常开辅助触点 13（NO1a），黑表笔接 14（NO1b）。吸合后常开触点应导通。',
                mode: 'check',
                op: [
                    {
                        type: 'observe', target: 'km1', part: 'no1a',
                        msg: '红表笔接常开辅助触点 13',
                        async act() {
                            const sys = this.sys;
                            _clearMMConns(sys);
                            await _wireAnim(sys, 'multimeter_wire_v', 'km1_wire_no1a');
                        },
                    },
                    {
                        type: 'observe', target: 'km1', part: 'no1b',
                        msg: '黑表笔接常开辅助触点 14',
                        async act() { await _wireAnim(this.sys, 'multimeter_wire_com', 'km1_wire_no1b'); },
                    },
                ],
                check() {
                    const c = (a, b) => this.sys.isPortConnected(a, b);
                    const same = () => _sameCluster(this.sys, 'km1_wire_no1a', 'km1_wire_no1b');
                    const km = this.sys.comps['km1'];
                    return km && km.getState() === 'on'
                        && same()
                        && c('multimeter_wire_v', 'km1_wire_no1a')
                        && c('multimeter_wire_com', 'km1_wire_no1b');
                },
            },
            {
                msg: '第 4 步：将万用表红表笔接常闭辅助触点 31（NC1a），黑表笔接 32（NC1b）。吸合后常闭触点应断开。',
                mode: 'check',
                op: [
                    {
                        type: 'observe', target: 'km1', part: 'nc1a',
                        msg: '红表笔接常闭辅助触点 31',
                        async act() {
                            const sys = this.sys;
                            _clearMMConns(sys);
                            await _wireAnim(sys, 'multimeter_wire_v', 'km1_wire_nc1a');
                        },
                    },
                    {
                        type: 'observe', target: 'km1', part: 'nc1b',
                        msg: '黑表笔接常闭辅助触点 32',
                        async act() { await _wireAnim(this.sys, 'multimeter_wire_com', 'km1_wire_nc1b'); },
                    },
                ],
                check() {
                    const c = (a, b) => this.sys.isPortConnected(a, b);
                    const same = () => _sameCluster(this.sys, 'km1_wire_nc1a', 'km1_wire_nc1b');
                    const km = this.sys.comps['km1'];
                    return km && km.getState() === 'on'
                        && !same()
                        && c('multimeter_wire_v', 'km1_wire_nc1a')
                        && c('multimeter_wire_com', 'km1_wire_nc1b');
                },
            },
            {
                msg: '第 5 步：先将万用表改接主触点 L1-T1；再断开开关、关闭交流电源，线圈失电，接触器在反作用弹簧作用下释放，主触点恢复断开状态。',
                mode: 'check',
                op: [
                    {
                        type: 'observe', target: 'km1', part: 'l1',
                        msg: '红表笔改接主触点 L1',
                        async act() {
                            const sys = this.sys;
                            _clearMMConns(sys);
                            await _wireAnim(sys, 'multimeter_wire_v', 'km1_wire_l1');
                        },
                    },
                    {
                        type: 'observe', target: 'km1', part: 't1',
                        msg: '黑表笔改接主触点 T1',
                        async act() { await _wireAnim(this.sys, 'multimeter_wire_com', 'km1_wire_t1'); },
                    },
                    {
                        type: 'switch', target: 'sw1',
                        msg: '断开开关',
                        async act() { await _setSwitchOn(this.sys, false); },
                    },
                    {
                        type: 'switch', target: 'ac1', part: 'power',
                        msg: '关闭交流电源，接触器释放',
                        async act() {
                            await _setAcOn(this.sys, false);
                            await _sleep(1000);   // 观察衔铁释放、触点复位
                        },
                    },
                ],
                check() {
                    const c = (a, b) => this.sys.isPortConnected(a, b);
                    const km = this.sys.comps['km1'];
                    const ac = this.sys.comps['ac1'];
                    const same = () => _sameCluster(this.sys, 'km1_wire_l1', 'km1_wire_t1');
                    return km && ac && km.getState() === 'off' && !ac.isOn && !same()
                        && c('multimeter_wire_v', 'km1_wire_l1')
                        && c('multimeter_wire_com', 'km1_wire_t1');
                },
            },
            {
                msg: '第 6 步：接触器动作原理知识',
                mode: 'quiz',
                quizConfig: {
                    question: '交流接触器线圈通电后，以下哪个描述是正确的？',
                    options: [
                        '主触点断开，常开辅助触点闭合',
                        '主触点闭合，常开辅助触点闭合，常闭辅助触点断开',
                        '所有触点均断开',
                        '仅常闭辅助触点动作，主触点不变',
                    ],
                    answer: 1,
                    analysis: '线圈通电后产生电磁力吸合动衔铁，带动三对主触点闭合（接通主电路），同时常开辅助触点闭合、常闭辅助触点断开。线圈断电后，在复位弹簧作用下动衔铁释放，各触点恢复原始状态。',
                },
            },
        ],
    },
};

export const componentConfigs = [
    { Class: ACPower, id: 'ac1', x: -10, y: 120, vRms: 220, freq: 50, isOn: false, visible: true },
    { Class: Switch, id: 'sw1', x: 280, y: 220, visible: true },
    { Class: ThreePhaseContactor, id: 'km1', x: 440, y: 120, visible: true, initState: 'off', coilResistance: 1000 },

    { Class: Multimeter, id: 'multimeter', x: 1220, y: 200, visible: false },
    { Class: MF47Multimeter, id: 'mf47-panel', x: 1050, y: 150, visible: false },
    { Class: Oscilloscope_tri, id: 'osc', x: 50, y: 50, visible: false },
    { Class: SignalGenerator, id: 'sg', x: 50, y: 50, visible: false },
    { Class: ProcessCalibrator, id: 'cali', x: 50, y: 50, visible: false },
    { Class: ElecMeter, id: 'elecmeter', x: 50, y: 50, visible: false },
];

// ═══════════════════════════════════════════════════════════════
// 演示辅助函数（供 op.act / check 调用）
// ═══════════════════════════════════════════════════════════════

const _sleep = (ms) => new Promise(r => setTimeout(r, ms));

function _sameCluster(sys, portA, portB) {
    const solver = sys.voltageSolver;
    if (!solver || !solver.portToCluster) return false;
    return solver.portToCluster.get(portA) === solver.portToCluster.get(portB);
}

/** 动画接线（约 3s/根） */
async function _wireAnim(sys, from, to) {
    await sys.connMgr.addConnectionAnimated({ from, to, type: 'wire' });
}

/** 只移除万用表引线，保留电源回路的其它接线 */
function _clearMMConns(sys) {
    for (let i = sys.conns.length - 1; i >= 0; i--) {
        const c = sys.conns[i];
        const f = String(c.from || ''), t = String(c.to || '');
        if (f.indexOf('multimeter_wire_') === 0 || t.indexOf('multimeter_wire_') === 0) {
            sys.conns.splice(i, 1);
        }
    }
    sys.redrawAll();
}

/** 设置万用表档位（电阻档等） */
function _setMMMode(sys, mode) {
    const mm = sys.comps['multimeter'];
    if (mm && typeof mm.setMode === 'function') mm.setMode(mode);
}

/** 线圈断电（关电源 + 断开关），保证接触器处于释放状态 */
function _deEnergize(sys) {
    const ac = sys.comps['ac1'];
    if (ac && ac.isOn) ac.onConfigUpdate({ isOn: false });
    const sw = sys.comps['sw1'];
    if (sw && sw.isOn) sw.isOn = false;
    sys.redrawAll();
}

/** 切换开关（带动画），并等待动作完成 */
async function _setSwitchOn(sys, on) {
    const sw = sys.comps['sw1'];
    if (!sw) return;
    if (sw.isOn !== on) sw.toggle();
    await _sleep(350);
}

/** 接通/断开交流电源 */
async function _setAcOn(sys, on) {
    const ac = sys.comps['ac1'];
    if (ac) ac.onConfigUpdate({ isOn: on });
    await _sleep(350);
}

function _autoWire(sys) {
    sys.conns.length = 0;
    const cons = [
        { from: 'ac1_wire_p', to: 'sw1_wire_l', type: 'wire' },
        { from: 'sw1_wire_r', to: 'km1_wire_a1', type: 'wire' },
        { from: 'ac1_wire_n', to: 'km1_wire_a2', type: 'wire' },
    ];
    cons.forEach(c => sys.connMgr.addConn(c));
    const sw = sys.comps['sw1'];
    if (sw) sw.isOn = true;
    sys.redrawAll();
}

export function initSlider(sys) {
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
    const ac = sys.comps['ac1'];
    if (ac) ac.onConfigUpdate({ isOn: true });
    const sw = sys.comps['sw1'];
    if (sw) sw.isOn = true;
}

export function fiveStep() {}
