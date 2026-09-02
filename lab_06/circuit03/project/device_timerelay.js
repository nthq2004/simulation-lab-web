import { ACPower } from '../components/ACPower.js';
import { JSZ3N } from '../components/JSZ3N.js';
import { JSZ3 } from '../components/JSZ3.js';
import { Multimeter } from '../components/Multimeter.js';
import { MF47Multimeter } from '../components/MF47Multimeter.js';
import { Oscilloscope_tri } from '../components/Osc_tri.js';
import { SignalGenerator } from '../components/SignalGenerator.js';
import { ProcessCalibrator } from '../components/ProcessCalibrator.js';
import { ElecMeter } from '../components/ElecMeter.js';

export const FAULT_CONFIGS = {};

export const PROJECT_WORKFLOWS = {
    'time-delay-test': {
        id: 'time-delay-test',
        name: '1. 时间继电器延时操作',
        steps: [
            {
                msg: '第 1 步：将单相交流电源输出端连接到 JSZ3 时间继电器线圈（端子 2 和 7）。闭合电源，线圈得电开始计时，观察面板红灯闪烁。',
                mode: 'check',
                async act() {
                    await new Promise(r => setTimeout(r, 500));
                    _autoWire(this.sys, 'time-delay-test');
                    await new Promise(r => setTimeout(r, 2000));
                },
                check() {
                    const tz = this.sys.comps['tz'];
                    const ac = this.sys.comps['ac'];
                    const c = (a, b) => this.sys.isPortConnected(a, b);
                    return ac && ac.isOn
                        && tz && (tz._state === 'timing' || tz._state === 'output')
                        && c('ac_wire_p', 'tz_wire_r')
                        && c('ac_wire_n', 'tz_wire_l');
                },
            },
            {
                msg: '第 2 步：等待延时到达，观察 OUTPUT 指示灯常亮。此时常开触头（6-8、1-3）闭合，常闭触头（5-8、1-4）断开。',
                mode: 'check',
                async act() {
                    const tz = this.sys.comps['tz'];
                    const waitTime = tz ? (tz.delayTime * 1000 + 2000) : 12000;
                    await new Promise(r => setTimeout(r, waitTime));
                },
                check() {
                    const tz = this.sys.comps['tz'];
                    return tz && tz._state === 'output';
                },
            },
            {
                msg: '第 3 步：断开电源，时间继电器复位。观察指示灯熄灭，触头恢复初始状态（NC 闭合、NO 断开）。',
                mode: 'check',
                async act() {
                    await new Promise(r => setTimeout(r, 500));
                    const ac = this.sys.comps['ac'];
                    if (ac) ac.onConfigUpdate({ isOn: false });
                    await new Promise(r => setTimeout(r, 2000));
                },
                check() {
                    const tz = this.sys.comps['tz'];
                    const ac = this.sys.comps['ac'];
                    return ac && !ac.isOn && tz && tz._state === 'idle';
                },
            },
            {
                msg: '第 4 步：时间继电器知识',
                mode: 'quiz',
                quizConfig: {
                    question: '时间继电器的主要功能是什么？',
                    options: [
                        '在线圈得电或失电后，触头延时动作',
                        '瞬时切换电路通断',
                        '测量电路中的电压值',
                        '保护电路免受过载损害',
                    ],
                    answer: 0,
                    analysis: '时间继电器是一种在接收到输入信号（线圈得电或失电）后，经过预设延时时间才使触头动作的继电器。JSZ3 时间继电器的延时范围为 0~30 秒，旋钮刻度可调。广泛应用于电动机星三角启动、顺序控制等需要时间延迟的场合。',
                },
            },
            {
                msg: '第 5 步：调整延时时间为 5s，重新接通电源，再次观察延时过程。',
                mode: 'check',
                async act() {
                    await new Promise(r => setTimeout(r, 500));
                    const tz = this.sys.comps['tz'];
                    const ac = this.sys.comps['ac'];
                    if (tz) tz.onConfigUpdate({ delayTime: 5 });
                    if (ac) ac.onConfigUpdate({ isOn: true });
                    await new Promise(r => setTimeout(r, 10000));
                },
                check() {
                    const tz = this.sys.comps['tz'];
                    return tz && tz._state === 'output';
                },
            },
        ],
    },
    'multimeter-test': {
        id: 'multimeter-test',
        name: '2. 用万用表测试时间继电器',
        steps: [
            {
                msg: '第 1 步：将万用表切换到 200Ω 档，红表笔接 JSZ3 端子 5，黑表笔接端子 8，测量 NC 触头电阻（应接近 0Ω）。',
                mode: 'check',
                async act() {
                    await new Promise(r => setTimeout(r, 500));
                    const sys = this.sys;
                    const mm = sys.comps['multimeter'];
                    if (mm) mm.show();
                    if (mm) { mm.mode = 'RES200'; mm._updateAngleByMode(); }
                    sys.conns.length = 0;
                    sys.connMgr.addConn({ from: 'multimeter_wire_v', to: 'tz_wire_nc_a', type: 'wire' });
                    sys.connMgr.addConn({ from: 'multimeter_wire_com', to: 'tz_wire_com_a', type: 'wire' });
                    sys.redrawAll();
                    await new Promise(r => setTimeout(r, 2000));
                },
                check() {
                    const mm = this.sys.comps['multimeter'];
                    const c = (a, b) => this.sys.isPortConnected(a, b);
                    return mm && mm.mode === 'RES200'
                        && c('multimeter_wire_v', 'tz_wire_nc_a')
                        && c('multimeter_wire_com', 'tz_wire_com_a')
                        && mm.value < 1;
                },
            },
            {
                msg: '第 2 步：接通电源，等待延时到达后，测量 NC 触头（5-8）应断开（万用表显示 O.L），NO 触头（6-8）应闭合（接近 0Ω）。',
                mode: 'check',
                async act() {
                    await new Promise(r => setTimeout(r, 500));
                    const sys = this.sys;
                    const ac = sys.comps['ac'];
                    const tz = sys.comps['tz'];
                    sys.conns.length = 0;
                    sys.connMgr.addConn({ from: 'ac_wire_p', to: 'tz_wire_r', type: 'wire' });
                    sys.connMgr.addConn({ from: 'ac_wire_n', to: 'tz_wire_l', type: 'wire' });
                    sys.connMgr.addConn({ from: 'multimeter_wire_v', to: 'tz_wire_no_a', type: 'wire' });
                    sys.connMgr.addConn({ from: 'multimeter_wire_com', to: 'tz_wire_com_a', type: 'wire' });
                    if (ac) ac.onConfigUpdate({ vRms: 220, freq: 50, isOn: true });
                    const waitTime = tz ? (tz.delayTime * 1000 + 3000) : 13000;
                    sys.redrawAll();
                    await new Promise(r => setTimeout(r, waitTime));
                },
                check() {
                    const tz = this.sys.comps['tz'];
                    const mm = this.sys.comps['multimeter'];
                    return tz && tz._state === 'output'
                        && mm && mm.mode === 'RES200'
                        && mm.value < 1;
                },
            },
        ],
    },
    'off-delay-test': {
        id: 'off-delay-test',
        name: '3. 断电延时继电器功能测试',
        steps: [
            {
                msg: '第 1 步：勾选工具栏"断电延时"复选框，显示断电延时继电器。将单相交流电源连接到 JSZ3N 线圈（端子2和7）。闭合电源，继电器瞬时输出，触点切换至 NO。',
                mode: 'check',
                async act() {
                    await new Promise(r => setTimeout(r, 500));
                    const tzn = this.sys.comps['tzn'];
                    if (tzn && tzn.group) tzn.group.visible(true);
                    const cb = document.getElementById('chkShowTZN');
                    if (cb) cb.checked = true;
                    this.sys.conns.length = 0;
                    this.sys.connMgr.addConn({ from: 'ac_wire_p', to: 'tzn_wire_r', type: 'wire' });
                    this.sys.connMgr.addConn({ from: 'ac_wire_n', to: 'tzn_wire_l', type: 'wire' });
                    const ac = this.sys.comps['ac'];
                    if (ac) ac.onConfigUpdate({ vRms: 220, freq: 50, isOn: true });
                    this.sys.redrawAll();
                    await new Promise(r => setTimeout(r, 2000));
                },
                check() {
                    const tzn = this.sys.comps['tzn'];
                    const ac = this.sys.comps['ac'];
                    const c = (a, b) => this.sys.isPortConnected(a, b);
                    return ac && ac.isOn
                        && tzn && tzn._state === 'output'
                        && c('ac_wire_p', 'tzn_wire_r')
                        && c('ac_wire_n', 'tzn_wire_l');
                },
            },
            {
                msg: '第 2 步：断开电源，继电器进入断电延时状态，触点保持 NO 位置。面板显示"断电延时中"，输出灯闪烁。',
                mode: 'check',
                async act() {
                    await new Promise(r => setTimeout(r, 500));
                    const ac = this.sys.comps['ac'];
                    if (ac) ac.onConfigUpdate({ isOn: false });
                    await new Promise(r => setTimeout(r, 2000));
                },
                check() {
                    const tzn = this.sys.comps['tzn'];
                    const ac = this.sys.comps['ac'];
                    return ac && !ac.isOn && tzn && tzn._state === 'delay';
                },
            },
            {
                msg: '第 3 步：等待延时结束，继电器复位。触点回到 NC 位置，状态恢复为"待机"，输出灯熄灭。',
                mode: 'check',
                async act() {
                    const tzn = this.sys.comps['tzn'];
                    const waitTime = tzn ? (tzn.delayTime * 1000 + 2000) : 17000;
                    await new Promise(r => setTimeout(r, waitTime));
                },
                check() {
                    const tzn = this.sys.comps['tzn'];
                    return tzn && tzn._state === 'idle';
                },
            },
            {
                msg: '第 4 步：断电延时继电器知识',
                mode: 'quiz',
                quizConfig: {
                    question: '断电延时继电器与通电延时继电器的主要区别是什么？',
                    options: [
                        '断电延时继电器得电瞬时动作，失电后延时复位',
                        '断电延时继电器得电延时动作，失电后瞬时复位',
                        '两者工作原理完全相同',
                        '断电延时继电器没有线圈',
                    ],
                    answer: 0,
                    analysis: '断电延时继电器（如 JSZ3N）的特点是：线圈得电后触头瞬时动作，线圈失电后触头不立即复位，而是经过预设延时后才回到初始状态。与 JSZ3 通电延时型（得电延时、失电瞬时复位）正好相反。',
                },
            },
            {
                msg: '第 5 步：将延时时间调整为 8s，重新接通电源再断开，观察完整的断电延时过程。',
                mode: 'check',
                async act() {
                    await new Promise(r => setTimeout(r, 500));
                    const tzn = this.sys.comps['tzn'];
                    const ac = this.sys.comps['ac'];
                    if (tzn) tzn.onConfigUpdate({ delayTime: 8 });
                    if (ac) ac.onConfigUpdate({ isOn: true });
                    await new Promise(r => setTimeout(r, 2000));
                    if (ac) ac.onConfigUpdate({ isOn: false });
                    const waitTime = 10000;
                    await new Promise(r => setTimeout(r, waitTime));
                },
                check() {
                    const tzn = this.sys.comps['tzn'];
                    return tzn && tzn._state === 'idle' && Math.abs(tzn.delayTime - 8) < 0.01;
                },
            },
        ],
    },
};

export const componentConfigs = [
    { Class: ACPower, id: 'ac', x: 900, y: 580, vRms: 220, freq: 50, isOn: false, visible: true },
    { Class: JSZ3, id: 'tz', x: 350, y: 130, delayTime: 15, visible: true },    
    { Class: JSZ3N, id: 'tzn', x: 950, y: 130, delayTime: 15, visible: false },

    { Class: Multimeter, id: 'multimeter', x: 920, y: 100, visible: false },
    { Class: MF47Multimeter, id: 'mf47-panel', x: 1050, y: 150, visible: false },
    { Class: Oscilloscope_tri, id: 'osc', x: 50, y: 50, visible: false },
    { Class: SignalGenerator, id: 'sg', x: 50, y: 50, visible: false },
    { Class: ProcessCalibrator, id: 'cali', x: 50, y: 50, visible: false },
    { Class: ElecMeter, id: 'elecmeter', x: 50, y: 50, visible: false },
];

function _autoWire(sys, mode) {
    sys.conns.length = 0;
    let cons;
    if (mode === 'off-delay-test') {
        cons = [
            { from: 'ac_wire_p', to: 'tzn_wire_r', type: 'wire' },
            { from: 'ac_wire_n', to: 'tzn_wire_l', type: 'wire' },
        ];
    } else {
        cons = [
            { from: 'ac_wire_p', to: 'tz_wire_r', type: 'wire' },
            { from: 'ac_wire_n', to: 'tz_wire_l', type: 'wire' },
        ];
    }
    cons.forEach(c => sys.connMgr.addConn(c));
    sys.redrawAll();
}

export function initSlider(sys) {
}

export function applyAllPresets() {
    const sys = this && this.sys ? this.sys : window.sys;
    if (!sys) return;
    _autoWire(sys, 'time-delay-test');
}

export async function applyStartSystem() {
    const sys = this && this.sys ? this.sys : window.sys;
    if (!sys) return;
    _autoWire(sys, 'time-delay-test');
    const ac = sys.comps['ac'];
    if (ac) ac.onConfigUpdate({ vRms: 220, freq: 50, isOn: true });
}

export function fiveStep() {}
