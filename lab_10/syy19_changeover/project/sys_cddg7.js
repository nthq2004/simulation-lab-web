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
import { RealMegohmMeter } from '../components/RealMegohmMeter.js';
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
            // ── 1. 主电路接线（6 根 ≤8 → 动画）────────────────────
            {
                msg: '1. 按电路图接好所有连线：AC 220V → 开关 → 镇流器 → 灯管(右灯丝) → 启辉器 → 灯管(左灯丝) → 中性线',
                mode: 'check',
                check() {
                    const exp = [
                        ['ac_wire_p', 'sw_wire_l'],
                        ['sw_wire_r', 'bal_wire_l'],
                        ['bal_wire_r', 'lamp_wire_right_b'],
                        ['lamp_wire_left_a', 'st_wire_l'],
                        ['st_wire_r', 'lamp_wire_right_a'],
                        ['lamp_wire_left_b', 'ac_wire_n'],
                    ];
                    return exp.every(([a, b]) => _hasConn(this.sys, a, b));
                },
                op: [
                    {
                        type: 'wire',
                        msg: '点击工具栏【自动接线】，按电路图逐根动画完成主回路接线',
                        async act() {
                            await _wireMain(this.sys);
                            this.sys.redrawAll();
                        },
                    },
                ],
            },
            // ── 2. 启辉器参数（必须走参数配置界面）──────────────────
            {
                msg: '2. 修改启辉器参数：辉光时间设为 8.5s 以上，接通时间设为 5.5s 以上，以观察完整工作周期',
                mode: 'check',
                check() {
                    const st = this.sys.comps['st'];
                    return st && st._glowOnTime >= 8 && st._closedTime >= 5;
                },
                op: [
                    {
                        type: 'observe', target: 'st',
                        msg: '打开启辉器「参数设置」，将辉光时间改为 8.5s',
                        async act() {
                            await _demoSetConfig(this, 'st', 'glowOnTime', 8.5, '将「辉光时间」改为 8.5');
                        },
                    },
                    {
                        type: 'observe', target: 'st',
                        msg: '再次打开「参数设置」，将接通时间改为 5.5s',
                        async act() {
                            await _demoSetConfig(this, 'st', 'closedTime', 5.5, '将「接通时间」改为 5.5');
                        },
                    },
                ],
            },
            // ── 3. 上电观察启辉全过程 ─────────────────────────────
            {
                msg: '3. 接通电源（闭合开关），观察：启辉器辉光放电→触点闭合（灯丝预热发红）→触点断开（镇流器产生高压）→灯管点亮',
                mode: 'check',
                check() {
                    const lamp = this.sys.comps['lamp'];
                    return lamp && lamp._state === 'on';
                },
                op: [
                    {
                        type: 'switch', target: 'ac', part: 'power', circleR: 22,
                        msg: '按下交流电源面板「电源」按钮，接通 AC 220V',
                        async act() {
                            _setPower(this.sys, true);
                            await _sleep(1500);
                        },
                    },
                    {
                        type: 'switch', target: 'sw',
                        msg: '闭合电源开关，启辉器开始辉光放电',
                        async act() {
                            _setSwitch(this.sys, 'sw', true);
                            await _sleep(1200);
                        },
                    },
                    {
                        type: 'observe', target: 'lamp',
                        msg: '观察灯管：预热发红 → 镇流器高压 → 正常点亮（约 15s）',
                        async act() {
                            const lamp = this.sys.comps['lamp'];
                            await _waitUntil(() => lamp && lamp._state === 'on', 35000);
                            await _sleep(2000);
                        },
                    },
                ],
            },
            // ── 4. 恢复默认参数并重新点亮 ──────────────────────────
            {
                msg: '4. 将启辉器参数恢复为默认值（辉光时间 1s，接通时间 0.5s），灯管正常点亮',
                mode: 'check',
                check() {
                    const st = this.sys.comps['st'];
                    return st && st._glowOnTime <= 3 && st._closedTime <= 2;
                },
                op: [
                    {
                        type: 'switch', target: 'sw',
                        msg: '先断开电源开关，准备恢复参数',
                        async act() {
                            _setSwitch(this.sys, 'sw', false);
                            _setPower(this.sys, false);
                            await _sleep(1000);
                        },
                    },
                    {
                        type: 'observe', target: 'st',
                        msg: '打开「参数设置」，将辉光时间恢复为 1s',
                        async act() {
                            await _demoSetConfig(this, 'st', 'glowOnTime', 1, '将「辉光时间」恢复为 1');
                        },
                    },
                    {
                        type: 'observe', target: 'st',
                        msg: '将接通时间恢复为 0.5s',
                        async act() {
                            await _demoSetConfig(this, 'st', 'closedTime', 0.5, '将「接通时间」恢复为 0.5');
                        },
                    },
                    {
                        type: 'switch', target: 'ac', part: 'power', circleR: 22,
                        msg: '重新接通交流电源',
                        async act() {
                            _setPower(this.sys, true);
                            await _sleep(800);
                        },
                    },
                    {
                        type: 'switch', target: 'sw',
                        msg: '闭合电源开关，灯管以默认参数快速点亮',
                        async act() {
                            _setSwitch(this.sys, 'sw', true);
                            await _sleep(800);
                        },
                    },
                    {
                        type: 'observe', target: 'lamp',
                        msg: '观察灯管在默认参数下正常点亮',
                        async act() {
                            const lamp = this.sys.comps['lamp'];
                            await _waitUntil(() => lamp && lamp._state === 'on', 20000);
                            await _sleep(1500);
                        },
                    },
                ],
            },
            // ── 5. 万用表测启辉器电压 ──────────────────────────────
            {
                msg: '5. 将数字万用表调至可见、档位打到交流 200V，红黑表笔正确接至启辉器两端',
                mode: 'check',
                check() {
                    const mm = this.sys.comps['multimeter'];
                    if (!mm || !mm.group.visible()) return false;
                    if (mm.mode !== 'ACV200') return false;
                    const mmV = 'multimeter_wire_v', mmC = 'multimeter_wire_com';
                    const vL = _hasConn(this.sys, mmV, 'st_wire_l');
                    const vR = _hasConn(this.sys, mmV, 'st_wire_r');
                    const cL = _hasConn(this.sys, mmC, 'st_wire_l');
                    const cR = _hasConn(this.sys, mmC, 'st_wire_r');
                    return (vL && cR) || (vR && cL);
                },
                op: [
                    {
                        type: 'instrument', instrument: 'multimeter', target: 'multimeter',
                        msg: '打开工具栏「选择仪表」，勾选数字万用表后关闭',
                    },
                    {
                        type: 'knob', target: 'multimeter', part: 'knob',
                        msg: '转动量程开关到交流 200V 档',
                        async act() {
                            _setMMMode(this.sys, 'ACV200');
                            await _sleep(1000);
                        },
                    },
                    {
                        type: 'observe', target: 'multimeter', part: 'v',
                        msg: '红表笔（V·Ω）接启辉器左端',
                        async act() {
                            await _wireAnim(this.sys, 'multimeter_wire_v', 'st_wire_l');
                        },
                    },
                    {
                        type: 'observe', target: 'multimeter', part: 'com',
                        msg: '黑表笔（COM）接启辉器右端',
                        async act() {
                            await _wireAnim(this.sys, 'multimeter_wire_com', 'st_wire_r');
                        },
                    },
                    {
                        type: 'observe', target: 'multimeter', part: 'lcd',
                        msg: '确保电源已接通，读取启辉器两端电压',
                        async act() {
                            _ensurePowerOn(this.sys);
                            await _sleep(3000);
                        },
                    },
                ],
            },
            // ── 6. 测试题 ─────────────────────────────────────────
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
            // ── 1. 接线并点亮 ─────────────────────────────────────
            {
                msg: '1. 按电路图接线，闭合开关，开启日光灯',
                mode: 'check',
                check() {
                    const lamp = this.sys.comps['lamp'];
                    return lamp && lamp._state === 'on';
                },
                op: [
                    {
                        type: 'wire',
                        msg: '点击工具栏【自动接线】，逐根动画完成主回路接线',
                        async act() {
                            await _wireMain(this.sys);
                            this.sys.redrawAll();
                        },
                    },
                    {
                        type: 'switch', target: 'ac', part: 'power', circleR: 22,
                        msg: '接通交流电源',
                        async act() {
                            _setPower(this.sys, true);
                            await _sleep(1000);
                        },
                    },
                    {
                        type: 'switch', target: 'sw',
                        msg: '闭合电源开关，点亮日光灯',
                        async act() {
                            _setSwitch(this.sys, 'sw', true);
                            await _sleep(800);
                        },
                    },
                    {
                        type: 'observe', target: 'lamp',
                        msg: '观察日光灯正常点亮',
                        async act() {
                            const lamp = this.sys.comps['lamp'];
                            await _waitUntil(() => lamp && lamp._state === 'on', 25000);
                            await _sleep(1500);
                        },
                    },
                ],
            },
            // ── 2. 拆启辉器：灯仍亮 → 断电熄灭 ─────────────────────
            {
                msg: '2. 断开启辉器接线（拆掉启辉器两端连线），观察日光灯仍正常发光；再断开电源开关，日光灯熄灭',
                mode: 'check',
                check() {
                    const hasSt = this.sys.conns.some(c =>
                        c.from === 'st_wire_l' || c.to === 'st_wire_l' ||
                        c.from === 'st_wire_r' || c.to === 'st_wire_r');
                    const sw = this.sys.comps['sw'];
                    return !hasSt && sw && !sw.isOn;
                },
                op: [
                    {
                        type: 'observe', target: 'st',
                        msg: '拆除启辉器两端接线（灯管已导通，不依赖启辉器）',
                        async act() {
                            _removeStWires(this.sys);
                            await _sleep(1500);
                        },
                    },
                    {
                        type: 'observe', target: 'lamp',
                        msg: '观察：启辉器已拆除，日光灯仍正常发光',
                        async act() { await _sleep(3000); },
                    },
                    {
                        type: 'switch', target: 'sw',
                        msg: '断开电源开关',
                        async act() {
                            _setSwitch(this.sys, 'sw', false);
                            await _sleep(800);
                        },
                    },
                    {
                        type: 'switch', target: 'ac', part: 'power', circleR: 22,
                        msg: '关闭交流电源，日光灯熄灭',
                        async act() {
                            _setPower(this.sys, false);
                            await _sleep(1000);
                        },
                    },
                ],
            },
            // ── 3. 用开关代替启辉器 ───────────────────────────────
            {
                msg: '3. 用另一个开关（双刀开关）代替启辉器接入电路：将开关两端分别接至灯管左灯丝和右灯丝（left_a/right_a），接通开关，观察灯丝进入预热状态（发红光）',
                mode: 'check',
                check() {
                    const sw = this.sys.comps['sw'];
                    const sw2 = this.sys.comps['sw2'];
                    return sw && sw.isOn && sw2.isOn;
                },
                op: [
                    {
                        type: 'observe', target: 'sw2',
                        msg: '将开关两端分别接到灯管 left_a 与 right_a（代替启辉器）',
                        async act() {
                            await _wireSw2AsStarter(this.sys);
                        },
                    },
                    {
                        type: 'switch', target: 'sw2',
                        msg: '合上该开关，灯丝构成预热回路（发红）',
                        async act() {
                            _setSwitch(this.sys, 'sw2', true);
                            await _sleep(1500);
                        },
                    },
                    {
                        type: 'switch', target: 'ac', part: 'power', circleR: 22,
                        msg: '接通交流电源',
                        async act() {
                            _setPower(this.sys, true);
                            await _sleep(800);
                        },
                    },
                    {
                        type: 'switch', target: 'sw',
                        msg: '闭合电源开关',
                        async act() {
                            _setSwitch(this.sys, 'sw', true);
                            await _sleep(2500);
                        },
                    },
                    {
                        type: 'observe', target: 'lamp',
                        msg: '观察灯丝预热发红（开关仍闭合，灯管未点亮）',
                        async act() { await _sleep(3000); },
                    },
                ],
            },
            // ── 4. 断开开关 → 高压点亮 ────────────────────────────
            {
                msg: '4. 断开该开关；若灯管未亮，反复闭合1s后再断开，直至镇流器高压点亮灯管',
                mode: 'check',
                check() {
                    const lamp = this.sys.comps['lamp'];
                    return lamp && lamp._state === 'on';
                },
                op: [
                    {
                        type: 'switch', target: 'sw2',
                        msg: '断开代替启辉器的开关；若灯管未亮则反复闭合1s再断开，直至点亮',
                        async act() {
                            await _strikeLampBySw2(this.sys);
                        },
                    },
                    {
                        type: 'observe', target: 'lamp',
                        msg: '观察高压脉冲击穿灯管，日光灯正常点亮',
                        async act() {
                            const lamp = this.sys.comps['lamp'];
                            await _waitUntil(() => lamp && lamp._state === 'on', 15000);
                            await _sleep(2000);
                        },
                    },
                ],
            },
            // ── 5. 测试题 ─────────────────────────────────────────
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
            // ── 1. 调出功率计并串入电路（9 根 >8 → 瞬时）──────────
            {
                msg: '1. 按电路图接线，在开关和镇流器之间串入数字功率计（ElecMeter：I+接开关输出，I-接镇流器输入，U+接开关输出，U-接中性线）',
                mode: 'check',
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
                    return exp.every(([a, b]) => _hasConn(this.sys, a, b));
                },
                op: [
                    {
                        type: 'instrument', instrument: 'elecmeter', target: 'elecmeter',
                        msg: '打开工具栏「选择仪表」，勾选数字功率计后关闭',
                    },
                    {
                        type: 'wire',
                        msg: '点击【自动接线】（9 根>8，瞬时接线），将功率计电流线圈串入主回路、电压线圈并联取样',
                        async act() {
                            _wireWithMeter(this.sys);
                            this.sys.redrawAll();
                            await _sleep(1500);
                        },
                    },
                ],
            },
            // ── 2. 点亮并读取功率因数 ─────────────────────────────
            {
                msg: '2. 闭合开关，开启日光灯，待稳定后从功率计上读取电流 I、功率 P 和功率因数 PF 的数值',
                mode: 'check',
                check() {
                    const lamp = this.sys.comps['lamp'];
                    return lamp && lamp._state === 'on';
                },
                op: [
                    {
                        type: 'switch', target: 'ac', part: 'power', circleR: 22,
                        msg: '接通交流电源',
                        async act() {
                            _setPower(this.sys, true);
                            await _sleep(1000);
                        },
                    },
                    {
                        type: 'switch', target: 'sw',
                        msg: '闭合电源开关，点亮日光灯',
                        async act() {
                            _setSwitch(this.sys, 'sw', true);
                            await _sleep(800);
                        },
                    },
                    {
                        type: 'observe', target: 'lamp',
                        msg: '等待日光灯点亮',
                        async act() {
                            const lamp = this.sys.comps['lamp'];
                            await _waitUntil(() => lamp && lamp._state === 'on', 25000);
                            await _sleep(1000);
                        },
                    },
                    {
                        type: 'observe', target: 'elecmeter',
                        msg: '读取功率计：电流 I、有功功率 P、功率因数 PF（稳定后读数）',
                        async act() { await _sleep(3500); },
                    },
                ],
            },
            // ── 3. 万用表测灯管/镇流器电压 ─────────────────────────
            {
                msg: '3. 将数字万用表调至可见、档位打到交流 200V，分别测量灯管两端电压（left_b↔right_b）和镇流器两端电压（bal_l↔bal_r）',
                mode: 'check',
                check() {
                    const mm = this.sys.comps['multimeter'];
                    if (!mm || !mm.group.visible()) return false;
                    if (mm.mode !== 'ACV200') return false;
                    const mmV = 'multimeter_wire_v', mmC = 'multimeter_wire_com';
                    const lampOK = (_hasConn(this.sys, mmV, 'lamp_wire_left_b') && _hasConn(this.sys, mmC, 'lamp_wire_right_b'))
                        || (_hasConn(this.sys, mmV, 'lamp_wire_right_b') && _hasConn(this.sys, mmC, 'lamp_wire_left_b'));
                    const balOK = (_hasConn(this.sys, mmV, 'bal_wire_l') && _hasConn(this.sys, mmC, 'bal_wire_r'))
                        || (_hasConn(this.sys, mmV, 'bal_wire_r') && _hasConn(this.sys, mmC, 'bal_wire_l'));
                    return lampOK || balOK;
                },
                op: [
                    {
                        type: 'instrument', instrument: 'multimeter', target: 'multimeter',
                        msg: '打开工具栏「选择仪表」，勾选数字万用表后关闭',
                    },
                    {
                        type: 'knob', target: 'multimeter', part: 'knob',
                        msg: '转动量程开关到交流 200V 档',
                        async act() {
                            _setMMMode(this.sys, 'ACV200');
                            await _sleep(1000);
                        },
                    },
                    {
                        type: 'observe', target: 'multimeter', part: 'v',
                        msg: '红表笔接灯管 left_b 端',
                        async act() {
                            _disconnectMM(this.sys);
                            await _wireAnim(this.sys, 'multimeter_wire_v', 'lamp_wire_left_b');
                        },
                    },
                    {
                        type: 'observe', target: 'multimeter', part: 'com',
                        msg: '黑表笔接灯管 right_b 端',
                        async act() {
                            await _wireAnim(this.sys, 'multimeter_wire_com', 'lamp_wire_right_b');
                        },
                    },
                    {
                        type: 'observe', target: 'multimeter', part: 'lcd',
                        msg: '读取灯管两端电压',
                        async act() { await _sleep(3000); },
                    },
                    {
                        type: 'observe', target: 'bal',
                        msg: '改接镇流器：红表笔接 bal_l、黑表笔接 bal_r',
                        async act() {
                            _disconnectMM(this.sys);
                            await _wireAnim(this.sys, 'multimeter_wire_v', 'bal_wire_l');
                            await _wireAnim(this.sys, 'multimeter_wire_com', 'bal_wire_r');
                        },
                    },
                    {
                        type: 'observe', target: 'multimeter', part: 'lcd',
                        msg: '读取镇流器两端电压',
                        async act() { await _sleep(3000); },
                    },
                ],
            },
            // ── 4. 并联补偿电容 ───────────────────────────────────
            {
                msg: '4. 将电容器并联接入电路中（电容两端分别接至镇流器输入端 bal_l 和灯管 left_b），观察电流和功率因数的变化',
                mode: 'check',
                check() {
                    return _hasConn(this.sys, 'cap_wire_r', 'bal_wire_l')
                        && _hasConn(this.sys, 'cap_wire_l', 'lamp_wire_left_b');
                },
                op: [
                    {
                        type: 'observe', target: 'cap',
                        msg: '电容左端接 bal_l，右端接 lamp left_b（与感性支路并联）',
                        async act() {
                            await _wireAnim(this.sys, 'cap_wire_r', 'bal_wire_l');
                            await _wireAnim(this.sys, 'cap_wire_l', 'lamp_wire_left_b');
                        },
                    },
                    {
                        type: 'observe', target: 'elecmeter',
                        msg: '观察功率计：电流减小、功率因数 PF 提高',
                        async act() { await _sleep(4000); },
                    },
                ],
            },
            // ── 5. 测试题 ─────────────────────────────────────────
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
            // ── 1. 设置启辉器触点粘连故障 ─────────────────────────
            {
                msg: '1. 设置启辉器触点粘连故障。',
                mode: 'check',
                check() {
                    const st = this.sys.comps['st'];
                    return st && st._faultContactStuck;
                },
                op: [
                    {
                        type: 'fault', fault: 'st_contactStuck',
                        msg: '打开「故障设置」，勾选「启辉器→触点粘连」并应用',
                        async act() {
                            _setFault(this.sys, 'st_contactStuck', true);
                            await _sleep(700);
                        },
                    },
                ],
            },
            // ── 2. 接线上电，观察故障现象 ─────────────────────────
            {
                msg: '2. 接线，闭合开关，观察现象——启辉器触点始终接通，灯管两端灯丝持续发红，灯管无法点亮。',
                mode: 'check',
                check() {
                    const lamp = this.sys.comps['lamp'];
                    const sw = this.sys.comps['sw'];
                    return lamp && lamp._state !== 'on' && sw && sw.isOn;
                },
                op: [
                    {
                        type: 'wire',
                        msg: '点击工具栏【自动接线】，逐根动画完成主回路接线',
                        async act() {
                            await _wireMain(this.sys);
                            this.sys.redrawAll();
                        },
                    },
                    {
                        type: 'switch', target: 'ac', part: 'power', circleR: 22,
                        msg: '接通交流电源',
                        async act() {
                            _setPower(this.sys, true);
                            await _sleep(1000);
                        },
                    },
                    {
                        type: 'switch', target: 'sw',
                        msg: '闭合电源开关',
                        async act() {
                            _setSwitch(this.sys, 'sw', true);
                            await _sleep(800);
                        },
                    },
                    {
                        type: 'observe', target: 'lamp',
                        msg: '观察故障：灯丝持续发红，灯管点不亮',
                        async act() { await _sleep(8000); },
                    },
                ],
            },
            // ── 3. 断电测电阻并排除故障 ───────────────────────────
            {
                msg: '3. 关闭电源开关，调出数字万用表、档位打到200Ω电阻档，红黑表笔接到启辉器两端，测量电阻。然后排除该故障',
                mode: 'check',
                check() {
                    const st = this.sys.comps['st'];
                    if (st && st._faultContactStuck) return false;
                    const mm = this.sys.comps['multimeter'];
                    if (!mm || !mm.group.visible()) return false;
                    if (mm.mode !== 'RES200' && mm.mode !== 'RES2k' && mm.mode !== 'RES200k') return false;
                    const mmV = 'multimeter_wire_v', mmC = 'multimeter_wire_com';
                    const vL = _hasConn(this.sys, mmV, 'st_wire_l');
                    const vR = _hasConn(this.sys, mmV, 'st_wire_r');
                    const cL = _hasConn(this.sys, mmC, 'st_wire_l');
                    const cR = _hasConn(this.sys, mmC, 'st_wire_r');
                    return (vL && cR) || (vR && cL);
                },
                op: [
                    {
                        type: 'switch', target: 'sw',
                        msg: '断开电源开关（断电测量）',
                        async act() {
                            _setSwitch(this.sys, 'sw', false);
                            await _sleep(600);
                        },
                    },
                    {
                        type: 'switch', target: 'ac', part: 'power', circleR: 22,
                        msg: '关闭交流电源',
                        async act() {
                            _setPower(this.sys, false);
                            await _sleep(800);
                        },
                    },
                    {
                        type: 'instrument', instrument: 'multimeter', target: 'multimeter',
                        msg: '打开工具栏「选择仪表」，勾选数字万用表后关闭',
                    },
                    {
                        type: 'knob', target: 'multimeter', part: 'knob',
                        msg: '转动量程开关到电阻 200Ω 档',
                        async act() {
                            _setMMMode(this.sys, 'RES200');
                            await _sleep(1000);
                        },
                    },
                    {
                        type: 'observe', target: 'multimeter', part: 'v',
                        msg: '红表笔接启辉器左端',
                        async act() {
                            _disconnectMM(this.sys);
                            await _wireAnim(this.sys, 'multimeter_wire_v', 'st_wire_l');
                        },
                    },
                    {
                        type: 'observe', target: 'multimeter', part: 'com',
                        msg: '黑表笔接启辉器右端，读取电阻（粘连时≈0Ω）',
                        async act() {
                            await _wireAnim(this.sys, 'multimeter_wire_com', 'st_wire_r');
                            await _sleep(2500);
                        },
                    },
                    {
                        type: 'fault', fault: 'st_contactStuck', repair: true,
                        msg: '打开「故障设置」，取消勾选「启辉器→触点粘连」并应用，排除故障',
                        async act() {
                            _setFault(this.sys, 'st_contactStuck', false);
                            await _sleep(700);
                        },
                    },
                ],
            },
            // ── 4. 设置镇流器开路故障 ─────────────────────────────
            {
                msg: '4. 设置镇流器开路故障。',
                mode: 'check',
                check() {
                    const bal = this.sys.comps['bal'];
                    return bal && bal._faultOpen;
                },
                op: [
                    {
                        type: 'fault', fault: 'bal_open',
                        msg: '打开「故障设置」，勾选「镇流器→开路」并应用',
                        async act() {
                            _setFault(this.sys, 'bal_open', true);
                            await _sleep(700);
                        },
                    },
                ],
            },
            // ── 5. 上电观察：电路无反应 ───────────────────────────
            {
                msg: '5. 闭合电源开关，观察现象——电路无任何反应，灯管不亮。',
                mode: 'check',
                check() {
                    const lamp = this.sys.comps['lamp'];
                    const bal = this.sys.comps['bal'];
                    const sw = this.sys.comps['sw'];
                    return lamp && lamp._state !== 'on' && bal && bal._faultOpen && sw && sw.isOn;
                },
                op: [
                    {
                        type: 'switch', target: 'ac', part: 'power', circleR: 22,
                        msg: '接通交流电源',
                        async act() {
                            _disconnectMM(this.sys);
                            _setPower(this.sys, true);
                            await _sleep(1000);
                        },
                    },
                    {
                        type: 'switch', target: 'sw',
                        msg: '闭合电源开关',
                        async act() {
                            _setSwitch(this.sys, 'sw', true);
                            await _sleep(800);
                        },
                    },
                    {
                        type: 'observe', target: 'lamp',
                        msg: '观察：灯管、启辉器均无反应',
                        async act() { await _sleep(6000); },
                    },
                ],
            },
            // ── 6. 断电测镇流器并排除故障 ─────────────────────────
            {
                msg: '6. 关闭电源开关，将数字万用表调至电阻档，测整流器电阻。然后排除该故障。',
                mode: 'check',
                check() {
                    const bal = this.sys.comps['bal'];
                    if (bal && bal._faultOpen) return false;
                    const mm = this.sys.comps['multimeter'];
                    if (!mm || !mm.group.visible()) return false;
                    if (mm.mode !== 'RES200' && mm.mode !== 'RES2k') return false;
                    const mmV = 'multimeter_wire_v', mmC = 'multimeter_wire_com';
                    const vL = _hasConn(this.sys, mmV, 'bal_wire_l');
                    const vR = _hasConn(this.sys, mmV, 'bal_wire_r');
                    const cL = _hasConn(this.sys, mmC, 'bal_wire_l');
                    const cR = _hasConn(this.sys, mmC, 'bal_wire_r');
                    return (vL && cR) || (vR && cL);
                },
                op: [
                    {
                        type: 'switch', target: 'sw',
                        msg: '断开电源开关',
                        async act() {
                            _setSwitch(this.sys, 'sw', false);
                            await _sleep(600);
                        },
                    },
                    {
                        type: 'switch', target: 'ac', part: 'power', circleR: 22,
                        msg: '关闭交流电源',
                        async act() {
                            _setPower(this.sys, false);
                            await _sleep(800);
                        },
                    },
                    {
                        type: 'instrument', instrument: 'multimeter', target: 'multimeter',
                        msg: '打开工具栏「选择仪表」，勾选数字万用表后关闭',
                    },
                    {
                        type: 'knob', target: 'multimeter', part: 'knob',
                        msg: '转动量程开关到电阻 200Ω 档',
                        async act() {
                            _setMMMode(this.sys, 'RES200');
                            await _sleep(1000);
                        },
                    },
                    {
                        type: 'observe', target: 'multimeter', part: 'v',
                        msg: '红表笔接镇流器 l 端',
                        async act() {
                            _disconnectMM(this.sys);
                            await _wireAnim(this.sys, 'multimeter_wire_v', 'bal_wire_l');
                        },
                    },
                    {
                        type: 'observe', target: 'multimeter', part: 'com',
                        msg: '黑表笔接镇流器 r 端，读取电阻（开路时显示溢出）',
                        async act() {
                            await _wireAnim(this.sys, 'multimeter_wire_com', 'bal_wire_r');
                            await _sleep(2500);
                        },
                    },
                    {
                        type: 'fault', fault: 'bal_open', repair: true,
                        msg: '打开「故障设置」，取消勾选「镇流器→开路」并应用，排除故障',
                        async act() {
                            _setFault(this.sys, 'bal_open', false);
                            await _sleep(700);
                        },
                    },
                ],
            },
            // ── 7. 设置灯管老化故障 ───────────────────────────────
            {
                msg: '7. 设置灯管老化故障。',
                mode: 'check',
                check() {
                    const lamp = this.sys.comps['lamp'];
                    return lamp && lamp._faultAged;
                },
                op: [
                    {
                        type: 'fault', fault: 'lamp_aged',
                        msg: '打开「故障设置」，勾选「灯管→老化」并应用',
                        async act() {
                            _setFault(this.sys, 'lamp_aged', true);
                            await _sleep(700);
                        },
                    },
                ],
            },
            // ── 8. 上电观察老化现象 ───────────────────────────────
            {
                msg: '8. 闭合电源开关，观察现象——灯管发黑、两端闪烁，灯管无法正常点亮。',
                mode: 'check',
                check() {
                    const lamp = this.sys.comps['lamp'];
                    const sw = this.sys.comps['sw'];
                    return lamp && lamp._state !== 'on' && sw && sw.isOn;
                },
                op: [
                    {
                        type: 'switch', target: 'ac', part: 'power', circleR: 22,
                        msg: '接通交流电源',
                        async act() {
                            _disconnectMM(this.sys);
                            _setPower(this.sys, true);
                            await _sleep(1000);
                        },
                    },
                    {
                        type: 'switch', target: 'sw',
                        msg: '闭合电源开关',
                        async act() {
                            _setSwitch(this.sys, 'sw', true);
                            await _sleep(800);
                        },
                    },
                    {
                        type: 'observe', target: 'lamp',
                        msg: '观察老化现象：启动困难、两端发红闪烁、管壁发黑',
                        async act() { await _sleep(8000); },
                    },
                ],
            },
            // ── 9. 测试题 ─────────────────────────────────────────
            {
                msg: '9. 测试题：灯管老化的典型现象。',
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
    { Class: ACPower, id: 'ac', x: 10, y: 320, vRms: 220, freq: 50, isOn: false },
    { Class: Switch, id: 'sw', x: 200, y: 630, isOn: false },
    { Class: Switch, id: 'sw2', x: 1150, y: 180, isOn: false },
    { Class: Capacitor, id: 'cap', x: 580, y: 150, capacitance: 5 },
    { Class: Ballast, id: 'bal', x: 860, y: 650, inductance: 1.4, resistance: 20 },
    { Class: FluorescentLamp, id: 'lamp', x: 980, y: 360, filamentR: 30, gapOnR: 220, scale: 1.0 },
    { Class: Starter, id: 'st', x: 880, y: 120, glowOnTime: 1, closedTime: 0.5, strikeVoltage: 180, scale: 1.0 },

    // ── 7 种仪表（必须保留） ──
    { Class: Multimeter, id: 'multimeter', x: 1100, y: 450, visible: false },
    { Class: MF47Multimeter, id: 'mf47-panel', x: 50, y: 50, visible: false },
    { Class: Oscilloscope_tri, id: 'osc', x: 50, y: 50, visible: false },
    { Class: SignalGenerator, id: 'sg', x: 50, y: 50, visible: false },
    { Class: ProcessCalibrator, id: 'cali', x: 50, y: 50, visible: false },
    { Class: ElecMeter, id: 'elecmeter', x: 350, y: 350, visible: false },
    { Class: RealMegohmMeter, id: 'megohm', x: 50, y: 50, visible: false },
];

// ── 工作流辅助 ──────────────────────────────────────────────
function _sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function _hasConn(sys, a, b) {
    return sys.conns.some(c => (c.from === a && c.to === b) || (c.from === b && c.to === a));
}

/** 轮询等待条件成立（用于灯管点亮等仿真收敛） */
async function _waitUntil(fn, timeout = 20000, step = 250) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
        try { if (fn()) return true; } catch (e) { /* 忽略瞬时异常 */ }
        await _sleep(step);
    }
    return false;
}

/** 动画接线（约 3s/根，≤8 根时使用）；已连接则跳过，保证可重复运行 */
async function _wireAnim(sys, from, to) {
    if (_hasConn(sys, from, to)) return;
    await sys.connMgr.addConnectionAnimated({ from, to, type: 'wire' });
}

/** 逐根动画接线列表（≤8 根一律动画；>8 根瞬时） */
async function _wireList(sys, list, { animated = true } = {}) {
    if (!animated || list.length > 8) {
        list.forEach(([a, b]) => {
            if (!_hasConn(sys, a, b)) sys.connMgr.addConn({ from: a, to: b, type: 'wire' });
        });
        sys.redrawAll();
        return;
    }
    for (const [a, b] of list) {
        await _wireAnim(sys, a, b);
    }
    sys.redrawAll();
}

/** 瞬时补线（去重）；仅用于 >8 根批量场景 */
function _wireInstant(sys, list) {
    list.forEach(([a, b]) => {
        if (!_hasConn(sys, a, b)) sys.connMgr.addConn({ from: a, to: b, type: 'wire' });
    });
    sys.redrawAll();
}

/** 拆除挂在指定端口上的全部连线 */
function _removePortWires(sys, portIds) {
    const kill = sys.conns.filter(c => portIds.includes(c.from) || portIds.includes(c.to));
    kill.forEach(c => sys.connMgr.removeConn(c));
}

function _disconnectMM(sys) {
    _removePortWires(sys, ['multimeter_wire_v', 'multimeter_wire_com']);
}

/** 主回路 6 根（≤8 → 动画）；先清掉功率计串入线，恢复 sw→bal 直连 */
async function _wireMain(sys) {
    _removePortWires(sys, [
        'elecmeter_wire_ip', 'elecmeter_wire_in',
        'elecmeter_wire_up', 'elecmeter_wire_un',
        'cap_wire_l', 'cap_wire_r',
        'multimeter_wire_v', 'multimeter_wire_com',
    ]);
    await _wireList(sys, [
        ['ac_wire_p', 'sw_wire_l'],
        ['sw_wire_r', 'bal_wire_l'],
        ['bal_wire_r', 'lamp_wire_right_b'],
        ['lamp_wire_left_a', 'st_wire_l'],
        ['st_wire_r', 'lamp_wire_right_a'],
        ['lamp_wire_left_b', 'ac_wire_n'],
    ]);
}

/** 功率因数实验：串入功率计（9 根 >8 → 瞬时） */
function _wireWithMeter(sys) {
    _removePortWires(sys, [
        'elecmeter_wire_ip', 'elecmeter_wire_in',
        'elecmeter_wire_up', 'elecmeter_wire_un',
        'multimeter_wire_v', 'multimeter_wire_com',
        'cap_wire_l', 'cap_wire_r',
    ]);
    // 去掉可能残留的 sw→bal 直连
    const direct = sys.conns.filter(c =>
        (c.from === 'sw_wire_r' && c.to === 'bal_wire_l') ||
        (c.from === 'bal_wire_l' && c.to === 'sw_wire_r'));
    direct.forEach(c => sys.connMgr.removeConn(c));
    _wireInstant(sys, [
        ['ac_wire_p', 'sw_wire_l'],
        ['sw_wire_r', 'elecmeter_wire_ip'],
        ['elecmeter_wire_in', 'bal_wire_l'],
        ['bal_wire_r', 'lamp_wire_right_b'],
        ['lamp_wire_left_a', 'st_wire_l'],
        ['st_wire_r', 'lamp_wire_right_a'],
        ['lamp_wire_left_b', 'ac_wire_n'],
        ['elecmeter_wire_up', 'sw_wire_r'],
        ['elecmeter_wire_un', 'lamp_wire_left_b'],
    ]);
    const em = sys.comps['elecmeter'];
    if (em && !em.group.visible()) em.show();
    sys.redrawAll();
}

function _removeStWires(sys) {
    _removePortWires(sys, ['st_wire_l', 'st_wire_r']);
    sys.redrawAll();
}

/** 用 sw2 代替启辉器（2 根 → 动画接线） */
async function _wireSw2AsStarter(sys) {
    _removeStWires(sys);
    await _wireAnim(sys, 'sw2_wire_l', 'lamp_wire_left_a');
    await _wireAnim(sys, 'sw2_wire_r', 'lamp_wire_right_a');
    sys.redrawAll();
}

function _setPower(sys, on) {
    const ac = sys.comps['ac'];
    if (ac) { ac.isOn = !!on; ac.update(); }
    sys.redrawAll();
}

function _ensurePowerOn(sys) {
    const ac = sys.comps['ac'];
    if (ac && !ac.isOn) { ac.isOn = true; ac.update(); sys.redrawAll(); }
}

function _setSwitch(sys, id, on) {
    const sw = sys.comps[id];
    if (sw) sw.isOn = !!on;
    sys.redrawAll();
}

/**
 * 断开 sw2 尝试点亮灯管；若未点亮则反复「闭合 → 延时1s → 断开」直至点亮。
 * @returns {Promise<boolean>} 灯管是否已点亮
 */
async function _strikeLampBySw2(sys, { openWaitMs = 1200, maxRetries = 12 } = {}) {
    const isLit = () => {
        const lamp = sys.comps['lamp'];
        return !!(lamp && lamp._state === 'on');
    };

    _setSwitch(sys, 'sw2', false);
    await _sleep(openWaitMs);
    if (isLit()) return true;

    for (let i = 0; i < maxRetries && !isLit(); i++) {
        _setSwitch(sys, 'sw2', true);
        await _sleep(1000);
        _setSwitch(sys, 'sw2', false);
        await _sleep(openWaitMs);
    }
    return isLit();
}

function _setMMMode(sys, mode) {
    const mm = sys.comps['multimeter'];
    if (!mm) return;
    mm.mode = mode;
    if (typeof mm._updateAngleByMode === 'function') mm._updateAngleByMode();
    if (typeof mm.update === 'function') mm.update(0);
    sys.redrawAll();
}

/** 通过故障配置触发/排除故障（故障 UI 演示后的兜底） */
function _setFault(sys, faultId, on) {
    const fc = sys.FAULT_CONFIG && sys.FAULT_CONFIG[faultId];
    if (!fc) return;
    if (on && !fc.check()) fc.trigger();
    if (!on && fc.check()) fc.repair();
}

/**
 * 打开组件参数配置对话框，动态演示参数调整并保存：
 * 弹框前同步实时属性 → 高亮输入框填值 → 高亮「保存」并点击。
 * （参数调整一律走配置界面，禁止直接改内部属性）
 */
async function _demoSetConfig(wf, compId, key, value, tip) {
    const comp = wf.sys.comps[compId];
    if (!comp) return;
    (comp.getConfigFields() || []).forEach(f => {
        if (f.get) return;
        try {
            const live = comp[f.key];
            if (live !== undefined) comp.config[f.key] = live;
        } catch (e) { /* 忽略只读属性 */ }
    });
    // 启辉器等组件实时值在 _glowOnTime 私有字段，同步进 config 副本
    if (compId === 'st') {
        comp.config.glowOnTime = comp._glowOnTime;
        comp.config.closedTime = comp._closedTime;
        comp.config.strikeVoltage = comp._strikeVoltage;
    }
    comp.showConfigDialog();
    await _sleep(600);
    const input = document.getElementById('diag_' + key);
    const modal = input ? input.closest('div[style*="position: fixed"]') : null;
    if (input) {
        if (wf._flashDomElement) {
            await wf._flashDomElement(input, tip || `请将该参数改为 ${value}`, 2400);
        }
        input.value = value;
    }
    if (modal) {
        const saveBtn = [...modal.querySelectorAll('button')].find(b => b.textContent.indexOf('保存') !== -1);
        if (saveBtn) {
            if (wf._flashDomElement) {
                await wf._flashDomElement(saveBtn, '点击「保存」确认参数修改', 1800);
            }
            saveBtn.click();
        }
    }
    await _sleep(400);
}

export function initSlider(_sys) {
    // 自动演示时只保留箭头指示，不闪亮整个组件
    _sys._noBlinkHighlight = true;
}

export function applyAllPresets() {
    // 默认不接线：ControlSystem.init 直接调用（无 this.sys）时返回；
    // 工具栏「自动接线」经 WorkflowManager（有 this.sys）时才接主线
    if (this && this.sys && this.sys.connMgr) {
        void _wireMain(this.sys);
    }
}

export async function applyStartSystem() {
    const sys = (this && this.sys && this.sys.connMgr) ? this.sys
        : (this && this.connMgr) ? this
        : window.sys;
    if (!sys || !sys.connMgr) return;
    await _wireMain(sys);
    _setPower(sys, true);
    _setSwitch(sys, 'sw', true);
}

export function fiveStep() { }
