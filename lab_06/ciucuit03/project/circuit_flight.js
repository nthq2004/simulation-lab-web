// 日光灯电路仿真工程
// 电路：AC 220V → 开关 → 镇流器 → 灯管(左灯丝) → 启辉器 → 灯管(右灯丝) → AC 中性线
// 50W 日光灯：灯管击穿电压 > 400V，正常发光时灯管等效电阻 220Ω

import { ACPower } from '../components/ACPower.js';
import { Switch } from '../components/Switch.js';
import { Ballast } from '../components/Ballast.js';
import { FluorescentLamp } from '../components/FluorescentLamp.js';
import { Starter } from '../components/Starter.js';
// import { Ground } from '../export.js';
import { Multimeter } from '../components/Multimeter.js';
import { MF47Multimeter } from '../components/MF47Multimeter.js';
import { Oscilloscope_tri } from '../components/Osc_tri.js';
import { SignalGenerator } from '../components/SignalGenerator.js';
import { ProcessCalibrator } from '../components/ProcessCalibrator.js';
import { ElecMeter } from '../components/ElecMeter.js';
import { Capacitor } from '../export.js';

export const FAULT_CONFIGS = {
    st_contactStuck: {
        id: 'st_contactStuck', name: '触点粘连', system: '启辉器',
        check() { const c = window.sys && window.sys.comps && window.sys.comps.st; return c && c._faultContactStuck; },
        trigger() { const c = window.sys && window.sys.comps && window.sys.comps.st; if (c) c._faultContactStuck = true; },
        repair() { const c = window.sys && window.sys.comps && window.sys.comps.st; if (c) c._faultContactStuck = false; },
    },
    st_open: {
        id: 'st_open', name: '开路', system: '启辉器',
        check() { const c = window.sys && window.sys.comps && window.sys.comps.st; return c && c._faultOpen; },
        trigger() { const c = window.sys && window.sys.comps && window.sys.comps.st; if (c) c._faultOpen = true; },
        repair() { const c = window.sys && window.sys.comps && window.sys.comps.st; if (c) c._faultOpen = false; },
    },
    lamp_aged: {
        id: 'lamp_aged', name: '老化', system: '灯管',
        check() { const c = window.sys && window.sys.comps && window.sys.comps.lamp; return c && c._faultAged; },
        trigger() { const c = window.sys && window.sys.comps && window.sys.comps.lamp; if (c) c._faultAged = true; },
        repair() { const c = window.sys && window.sys.comps && window.sys.comps.lamp; if (c) c._faultAged = false; },
    },
    bal_open: {
        id: 'bal_open', name: '开路', system: '镇流器',
        check() { const c = window.sys && window.sys.comps && window.sys.comps.bal; return c && c._faultOpen; },
        trigger() { const c = window.sys && window.sys.comps && window.sys.comps.bal; if (c) c._faultOpen = true; },
        repair() { const c = window.sys && window.sys.comps && window.sys.comps.bal; if (c) c._faultOpen = false; },
    },
};

export const PROJECT_WORKFLOWS = {
    'fluorescent-light': {
        id: 'fluorescent-light',
        name: '1.日光灯电路接线和功能实验',
        steps: [
            {
                msg: '1. 按电路图接好所有连线：AC 220V → 开关 → 镇流器 → 灯管(左灯丝) → 启辉器 → 灯管(右灯丝) → 中性线',
                mode: 'check',
                act() { _autoWire(this.sys); },
                check() {
                    const exp = [
                        ['ac_wire_p', 'sw_wire_l'],
                        ['sw_wire_r', 'bal_wire_l'],
                        ['bal_wire_r', 'lamp_wire_right_b'],
                        ['lamp_wire_left_a', 'st_wire_l'],
                        ['st_wire_r', 'lamp_wire_right_a'],
                        ['lamp_wire_left_b', 'ac_wire_n'],
                    ];
                    const conns = this.sys.conns;
                    return exp.every(([a, b]) =>
                        conns.some(c => (c.from === a && c.to === b) || (c.from === b && c.to === a))
                    );
                },
            },
            {
                msg: '2. 修改启辉器参数：辉光时间设为 8.5s 以上，接通时间设为 5.5s 以上，以观察完整工作周期',
                mode: 'check',
                act() {
                    const st = this.sys.comps['st'];
                    if (st) { st._glowOnTime = 8.5; st._closedTime = 5.5; }
                },
                check() {
                    const st = this.sys.comps['st'];
                    return st && st._glowOnTime >= 8 && st._closedTime >= 5;
                },
            },
            {
                msg: '3. 接通电源（闭合开关），观察：启辉器辉光放电→触点闭合（灯丝预热发红）→触点断开（镇流器产生高压）→灯管点亮',
                mode: 'check',
                act() {
                    const sw = this.sys.comps['sw'];
                    if (sw) sw.isOn = true;
                    const ac = this.sys.comps['ac'];
                    if (ac) { ac.isOn = true; ac.update(); }
                },
                check() {
                    const lamp = this.sys.comps['lamp'];
                    return lamp && lamp._state === 'on';
                },
            },
            {
                msg: '4. 将启辉器参数恢复为默认值（辉光时间 1s，接通时间 0.5s），灯管正常点亮',
                mode: 'check',
                act() {
                    const st = this.sys.comps['st'];
                    if (st) { st._glowOnTime = 1; st._closedTime = 0.5; }
                },
                check() {
                    const st = this.sys.comps['st'];
                    return st && st._glowOnTime <= 3 && st._closedTime <= 2;
                },
            },
            {
                msg: '5. 将数字万用表调至可见、档位打到交流 200V，红黑表笔正确接至启辉器两端',
                mode: 'check',
                check() {
                    const mm = this.sys.comps['multimeter'];
                    if (!mm || !mm.group.visible()) return false;
                    if (mm.mode !== 'ACV200') return false;
                    const conns = this.sys.conns;
                    const stL = 'st_wire_l', stR = 'st_wire_r';
                    const mmV = 'multimeter_wire_v', mmC = 'multimeter_wire_com';
                    const vL = conns.some(c => (c.from === mmV && c.to === stL) || (c.from === stL && c.to === mmV));
                    const vR = conns.some(c => (c.from === mmV && c.to === stR) || (c.from === stR && c.to === mmV));
                    const cL = conns.some(c => (c.from === mmC && c.to === stL) || (c.from === stL && c.to === mmC));
                    const cR = conns.some(c => (c.from === mmC && c.to === stR) || (c.from === stR && c.to === mmC));
                    return (vL && cR) || (vR && cL);
                },
            },
            {
                msg: '6. 测试题：镇流器的作用',
                mode: 'quiz',
                quizConfig: {
                    question: '荧光灯电路中，镇流器的主要作用是什么？',
                    options: [
                        '将交流电转换为直流电',
                        '启动时产生高压击穿灯管，正常工作时限制电流',
                        '调节灯管亮度',
                        '保护启辉器不被烧毁',
                    ],
                    answer: 1,
                    analysis: '镇流器在启辉器断开瞬间产生高压脉冲击穿灯管使其导通；灯管导通后充当限流电感，防止电流过大。',
                },
            },
        ],
    },

    'starter-test': {
        id: 'starter-test',
        name: '2.启辉器作用测试',
        steps: [
            {
                msg: '1. 按电路图接线，闭合开关，开启日光灯',
                mode: 'check',
                act() {
                    _autoWire(this.sys);
                    const sw = this.sys.comps['sw'];
                    if (sw) sw.isOn = true;
                    const ac = this.sys.comps['ac'];
                    if (ac) { ac.isOn = true; ac.update(); }
                },
                check() {
                    const lamp = this.sys.comps['lamp'];
                    return lamp && lamp._state === 'on';
                },
            },
            {
                msg: '2. 断开启辉器接线（拆掉启辉器两端连线），观察日光灯仍正常发光；再断开电源开关，日光灯熄灭',
                mode: 'check',
                act() {
                    _removeStWires(this.sys);
                    const sw = this.sys.comps['sw'];
                    if (sw) sw.isOn = false;
                    const ac = this.sys.comps['ac'];
                    if (ac) { ac.isOn = false; ac.update(); }
                },
                check() {
                    const conns = this.sys.conns;
                    const hasSt = conns.some(c => c.from === 'st_wire_l' || c.to === 'st_wire_l' || c.from === 'st_wire_r' || c.to === 'st_wire_r');
                    const sw = this.sys.comps['sw'];
                    return !hasSt && sw && !sw.isOn;
                },
            },
            {
                msg: '3. 用另一个开关（双刀开关）代替启辉器接入电路：将开关两端分别接至灯管左灯丝和右灯丝（left_a/right_a），接通开关，观察灯丝进入预热状态（发红光）',
                mode: 'check',
                act() {
                    _wireSw2AsStarter(this.sys);
                    const sw2 = this.sys.comps['sw2'];
                    if (sw2) sw2.isOn = true;
                    const sw = this.sys.comps['sw'];
                    if (sw) sw.isOn = true;
                    const ac = this.sys.comps['ac'];
                    if (ac) { ac.isOn = true; ac.update(); }
                },
                check() {
                    const sw = this.sys.comps['sw'];
                    const sw2 = this.sys.comps['sw2'];
                    return sw && sw.isOn && sw2.isOn;
                },
            },
            {
                msg: '4. 断开该开关，镇流器产生高压，灯管被正常点亮',
                mode: 'check',
                act() {
                    const sw2 = this.sys.comps['sw2'];
                    if (sw2) sw2.isOn = false;
                },
                check() {
                    const lamp = this.sys.comps['lamp'];
                    return lamp && lamp._state === 'on';
                },
            },
            {
                msg: '5. 测试题：启辉器的工作原理',
                mode: 'quiz',
                quizConfig: {
                    question: '启辉器在荧光灯启动过程中的工作原理是什么？',
                    options: [
                        '直接产生高压击穿灯管',
                        '辉光放电加热双金属片→触点闭合预热灯丝→冷却断开使镇流器产生高压',
                        '通过电磁感应启动灯管',
                        '串联在电路中限制电流',
                    ],
                    answer: 1,
                    analysis: '启辉器利用氖泡辉光放电加热双金属片，使其弯曲后触点闭合，接通灯丝预热电路；冷却后触点断开，切断电流使镇流器产生高压脉冲，击穿灯管使其导通发光。',
                },
            },
        ],
    },

    'power-factor': {
        id: 'power-factor',
        name: '3.日光灯功率因数测量',
        steps: [
            {
                msg: '1. 按电路图接线，在开关和镇流器之间串入数字功率计（ElecMeter：I+接开关输出，I-接镇流器输入，U+接开关输出，U-接中性线）',
                mode: 'check',
                act() { _autoWireWithMeter(this.sys); },
                check() {
                    const exp = [
                        ['ac_wire_p', 'sw_wire_l'],
                        ['sw_wire_r', 'elecmeter_wire_ip'],
                        ['elecmeter_wire_in', 'bal_wire_l'],
                        ['bal_wire_r', 'lamp_wire_right_b'],
                        ['lamp_wire_left_a', 'st_wire_l'],
                        ['st_wire_r', 'lamp_wire_right_a'],
                        ['lamp_wire_left_b', 'ac_wire_n'],
                        ['elecmeter_wire_up', 'sw_wire_r'],
                        ['elecmeter_wire_un', 'lamp_wire_left_b'],
                    ];
                    const conns = this.sys.conns;
                    return exp.every(([a, b]) =>
                        conns.some(c => (c.from === a && c.to === b) || (c.from === b && c.to === a))
                    );
                },
            },
            {
                msg: '2. 闭合开关，开启日光灯，待稳定后从功率计上读取电流 I、功率 P 和功率因数 PF 的数值',
                mode: 'check',
                act() {
                    const sw = this.sys.comps['sw'];
                    if (sw) sw.isOn = true;
                    const ac = this.sys.comps['ac'];
                    if (ac) { ac.isOn = true; ac.update(); }
                },
                check() {
                    const lamp = this.sys.comps['lamp'];
                    return lamp && lamp._state === 'on';
                },
            },
            {
                msg: '3. 将数字万用表调至可见、档位打到交流 200V，分别测量灯管两端电压（left_b↔right_b）和镇流器两端电压（bal_l↔bal_r）',
                mode: 'check',
                check() {
                    const mm = this.sys.comps['multimeter'];
                    if (!mm || !mm.group.visible()) return false;
                    if (mm.mode !== 'ACV200') return false;
                    const conns = this.sys.conns;
                    const mmV = 'multimeter_wire_v', mmC = 'multimeter_wire_com';
                    const lampL = 'lamp_wire_left_b', lampR = 'lamp_wire_right_b';
                    const balL = 'bal_wire_l', balR = 'bal_wire_r';
                    const vLl = conns.some(c => (c.from === mmV && c.to === lampL) || (c.from === lampL && c.to === mmV));
                    const vLr = conns.some(c => (c.from === mmV && c.to === lampR) || (c.from === lampR && c.to === mmV));
                    const vBl = conns.some(c => (c.from === mmV && c.to === balL) || (c.from === balL && c.to === mmV));
                    const vBr = conns.some(c => (c.from === mmV && c.to === balR) || (c.from === balR && c.to === mmV));
                    const cLl = conns.some(c => (c.from === mmC && c.to === lampL) || (c.from === lampL && c.to === mmC));
                    const cLr = conns.some(c => (c.from === mmC && c.to === lampR) || (c.from === lampR && c.to === mmC));
                    const cBl = conns.some(c => (c.from === mmC && c.to === balL) || (c.from === balL && c.to === mmC));
                    const cBr = conns.some(c => (c.from === mmC && c.to === balR) || (c.from === balR && c.to === mmC));
                    return (vLl && cLr) || (vLr && cLl);
                },
            },
            {
                msg: '4. 将电容器并联接入电路中（电容两端分别接至镇流器输入端 bal_l 和灯管 left_b），观察电流和功率因数的变化',
                mode: 'check',
                act() {
                    _wireCapacitor(this.sys);
                },
                check() {
                    const conns = this.sys.conns;
                    const hasCapL = conns.some(c => (c.from === 'cap_wire_r' && c.to === 'bal_wire_l') || (c.from === 'bal_wire_l' && c.to === 'cap_wire_r'));
                    const hasCapR = conns.some(c => (c.from === 'cap_wire_l' && c.to === 'lamp_wire_left_b') || (c.from === 'lamp_wire_left_b' && c.to === 'cap_wire_l'));
                    return hasCapL && hasCapR;
                },
            },
            {
                msg: '5. 测试题：电容器并联的作用',
                mode: 'quiz',
                quizConfig: {
                    question: '在荧光灯电路中，并联电容器的主要作用是什么？',
                    options: [
                        '提高灯管亮度',
                        '补偿无功功率，提高功率因数',
                        '保护镇流器不被烧毁',
                        '降低启动电压',
                    ],
                    answer: 1,
                    analysis: '荧光灯电路中的镇流器是感性元件，导致功率因数较低。并联电容器利用电容超前电流补偿电感滞后电流，从而减少无功功率，提高功率因数。',
                },
            },
        ],
    },

    'fault-detection': {
        id: 'fault-detection',
        name: '4.日光灯线路故障检测',
        steps: [
            {
                msg: '1. 设置启辉器触点粘连故障（触发故障"启辉器→触点粘连"）',
                mode: 'check',
                act() {
                    const st = this.sys.comps['st'];
                    if (st) st._faultContactStuck = true;
                },
                check() {
                    const st = this.sys.comps['st'];
                    return st && st._faultContactStuck;
                },
            },
            {
                msg: '2. 按电路图接线，闭合开关，观察故障现象——启辉器触点始终接通，灯管两端灯丝持续发红，灯管无法点亮',
                mode: 'check',
                act() {
                    _autoWire(this.sys);
                    const sw = this.sys.comps['sw'];
                    if (sw) sw.isOn = true;
                    const ac = this.sys.comps['ac'];
                    if (ac) { ac.isOn = true; ac.update(); }
                },
                check() {
                    const lamp = this.sys.comps['lamp'];
                    const sw = this.sys.comps['sw'];
                    return lamp && lamp._state !== 'on'&& sw.isOn;
                },
            },
            {
                msg: '3. 关闭电源开关，将数字万用表调至可见、档位打到电阻档（200Ω/2kΩ），红黑表笔接到启辉器两端，测量电阻，然后排除该故障',
                mode: 'check',
                act() {
                    const sw = this.sys.comps['sw'];
                    if (sw) sw.isOn = false;
                    const ac = this.sys.comps['ac'];
                    if (ac) { ac.isOn = false; ac.update(); }
                },
                check() {
                    const st = this.sys.comps['st'];
                    if (st && st._faultContactStuck) return false;
                    const mm = this.sys.comps['multimeter'];
                    if (!mm || !mm.group.visible()) return false;
                    if (mm.mode !== 'RES200' && mm.mode !== 'RES2k' && mm.mode !== 'RES200k') return false;
                    const conns = this.sys.conns;
                    const stL = 'st_wire_l', stR = 'st_wire_r';
                    const mmV = 'multimeter_wire_v', mmC = 'multimeter_wire_com';
                    const vL = conns.some(c => (c.from === mmV && c.to === stL) || (c.from === stL && c.to === mmV));
                    const vR = conns.some(c => (c.from === mmV && c.to === stR) || (c.from === stR && c.to === mmV));
                    const cL = conns.some(c => (c.from === mmC && c.to === stL) || (c.from === stL && c.to === mmC));
                    const cR = conns.some(c => (c.from === mmC && c.to === stR) || (c.from === stR && c.to === mmC));
                    return (vL && cR) || (vR && cL);
                },
            },
            {
                msg: '4. 设置镇流器开路故障（触发故障"镇流器→开路"）',
                mode: 'check',
                act() {
                    const bal = this.sys.comps['bal'];
                    if (bal) bal._faultOpen = true;
                },
                check() {
                    const bal = this.sys.comps['bal'];
                    return bal && bal._faultOpen;
                },
            },
            {
                msg: '5. 闭合电源开关，观察故障现象——电路无任何反应（镇流器线圈断开，无电流通路）',
                mode: 'check',
                act() {
                    const sw = this.sys.comps['sw'];
                    if (sw) sw.isOn = true;
                    const ac = this.sys.comps['ac'];
                    if (ac) { ac.isOn = true; ac.update(); }
                },
                check() {
                    const lamp = this.sys.comps['lamp'];
                    const bal = this.sys.comps['bal'];
                    const sw = this.sys.comps['sw'];
                    return lamp && lamp._state !== 'on' && bal && bal._faultOpen&&sw.isOn;
                },
            },
            {
                msg: '6. 关闭电源开关，将数字万用表调至电阻档（200Ω），红黑表笔接到镇流器两端，排除该故障',
                mode: 'check',
                act() {
                    const sw = this.sys.comps['sw'];
                    if (sw) sw.isOn = false;
                    const ac = this.sys.comps['ac'];
                    if (ac) { ac.isOn = false; ac.update(); }
                },
                check() {
                    const bal = this.sys.comps['bal'];
                    if (bal && bal._faultOpen) return false;
                    const mm = this.sys.comps['multimeter'];
                    if (!mm || !mm.group.visible()) return false;
                    if (mm.mode !== 'RES200' && mm.mode !== 'RES2k') return false;
                    const conns = this.sys.conns;
                    const bL = 'bal_wire_l', bR = 'bal_wire_r';
                    const mmV = 'multimeter_wire_v', mmC = 'multimeter_wire_com';
                    const vL = conns.some(c => (c.from === mmV && c.to === bL) || (c.from === bL && c.to === mmV));
                    const vR = conns.some(c => (c.from === mmV && c.to === bR) || (c.from === bR && c.to === mmV));
                    const cL = conns.some(c => (c.from === mmC && c.to === bL) || (c.from === bL && c.to === mmC));
                    const cR = conns.some(c => (c.from === mmC && c.to === bR) || (c.from === bR && c.to === mmC));
                    return (vL && cR) || (vR && cL);
                },
            },
            {
                msg: '7. 设置灯管老化故障（触发故障"灯管→老化"）',
                mode: 'check',
                act() {
                    const lamp = this.sys.comps['lamp'];
                    if (lamp) lamp._faultAged = true;
                },
                check() {
                    const lamp = this.sys.comps['lamp'];
                    return lamp && lamp._faultAged;
                },
            },
            {
                msg: '8. 闭合电源开关，观察故障现象——灯管发黑、两端闪烁，灯管无法正常点亮',
                mode: 'check',
                act() {
                    const sw = this.sys.comps['sw'];
                    if (sw) sw.isOn = true;
                    const ac = this.sys.comps['ac'];
                    if (ac) { ac.isOn = true; ac.update(); }
                },
                check() {
                    const lamp = this.sys.comps['lamp'];
                    const sw = this.sys.comps['sw'];
                    return lamp && lamp._state !== 'on' && sw && sw.isOn;
                },
            },
            {
                msg: '9. 测试题：灯管老化的典型现象',
                mode: 'quiz',
                quizConfig: {
                    question: '荧光灯管老化时，以下哪种现象最典型？',
                    options: [
                        '灯管亮度异常增高',
                        '启动困难，灯管两端发红但点不亮，管壁发黑',
                        '灯管发出异常响声',
                        '灯管闪烁但能正常点亮',
                    ],
                    answer: 1,
                    analysis: '灯管老化时，管壁两端出现黑色斑块（阴极发射物质耗尽），启动困难，灯丝预热后灯管两端发红但无法正常点亮，或点亮后闪烁严重。',
                },
            },
        ],
    },
};

export const componentConfigs = [
    // ── 主电路（左→右） ──
    { Class: ACPower, id: 'ac', x: 180, y: 320, vRms: 220, freq: 50, isOn: false },
    { Class: Switch, id: 'sw', x: 480, y: 580, isOn: false },
    { Class: Switch, id: 'sw2', x: 1250, y: 180, isOn: false },
    { Class: Capacitor, id: 'cap', x: 1390, y: 150, capacitance: 5 },
    { Class: Ballast, id: 'bal', x: 760, y: 590, inductance: 1.4, resistance: 20 },
    { Class: FluorescentLamp, id: 'lamp', x: 780, y: 360, filamentR: 30, gapOnR: 220, scale: 1.0 },
    { Class: Starter, id: 'st', x: 780, y: 120, glowOnTime: 1, closedTime: 0.5, strikeVoltage: 180, scale: 1.0 },

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
        { from: 'ac_wire_p', to: 'sw_wire_l', type: 'wire' },
        { from: 'sw_wire_r', to: 'bal_wire_l', type: 'wire' },
        { from: 'bal_wire_r', to: 'lamp_wire_right_b', type: 'wire' },
        { from: 'lamp_wire_left_a', to: 'st_wire_l', type: 'wire' },
        { from: 'st_wire_r', to: 'lamp_wire_right_a', type: 'wire' },
        { from: 'lamp_wire_left_b', to: 'ac_wire_n', type: 'wire' },
    ];
    cons.forEach(c => sys.connMgr.addConn(c));
    sys.redrawAll();
}

function _removeStWires(sys) {
    sys.conns = sys.conns.filter(c =>
        c.from !== 'st_wire_l' && c.to !== 'st_wire_l' &&
        c.from !== 'st_wire_r' && c.to !== 'st_wire_r'
    );
    sys.redrawAll();
}

function _wireSw2AsStarter(sys) {
    _removeStWires(sys);
    const cons = [
        { from: 'sw2_wire_l', to: 'lamp_wire_left_a', type: 'wire' },
        { from: 'sw2_wire_r', to: 'lamp_wire_right_a', type: 'wire' },
    ];
    cons.forEach(c => sys.connMgr.addConn(c));
    sys.redrawAll();
}

function _autoWireWithMeter(sys) {
    sys.conns.length = 0;
    const cons = [
        { from: 'ac_wire_p', to: 'sw_wire_l', type: 'wire' },
        { from: 'sw_wire_r', to: 'elecmeter_wire_ip', type: 'wire' },
        { from: 'elecmeter_wire_in', to: 'bal_wire_l', type: 'wire' },
        { from: 'bal_wire_r', to: 'lamp_wire_right_b', type: 'wire' },
        { from: 'lamp_wire_left_a', to: 'st_wire_l', type: 'wire' },
        { from: 'st_wire_r', to: 'lamp_wire_right_a', type: 'wire' },
        { from: 'lamp_wire_left_b', to: 'ac_wire_n', type: 'wire' },
        { from: 'elecmeter_wire_up', to: 'sw_wire_r', type: 'wire' },
        { from: 'elecmeter_wire_un', to: 'lamp_wire_left_b', type: 'wire' },
    ];
    cons.forEach(c => sys.connMgr.addConn(c));
    const em = sys.comps['elecmeter'];
    if (em && !em.group.visible()) em.show();
    sys.redrawAll();
}

function _wireCapacitor(sys) {
    const hasCap = sys.conns.some(c =>
        (c.from === 'cap_wire_l' || c.to === 'cap_wire_l') ||
        (c.from === 'cap_wire_r' || c.to === 'cap_wire_r')
    );
    if (!hasCap) {
        const cons = [
            { from: 'cap_wire_l', to: 'bal_wire_l', type: 'wire' },
            { from: 'cap_wire_r', to: 'lamp_wire_left_b', type: 'wire' },
        ];
        cons.forEach(c => sys.connMgr.addConn(c));
        sys.redrawAll();
    }
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
    if (ac) {
        ac.isOn = true;
        ac.update();
    }
    const sw = sys.comps['sw'];
    if (sw) {
        sw.isOn = true;
    }
}

export function fiveStep() { }