// 真空断路器功能仿真工程（断路器 + 汇流排 + 三相交流电源 + 24V 控制电源）


import { LvPowerOneLine } from '../components/LvPowerOneLine.js';
import { LvSwitchPanel } from '../components/LvSwitchPanel.js';
import { ImportantDistPanel } from '../components/ImportantDistPanel.js';

import { Multimeter } from '../components/Multimeter.js';
import { MF47Multimeter } from '../components/MF47Multimeter.js';
import { Oscilloscope_tri } from '../components/Osc_tri.js';
import { SignalGenerator } from '../components/SignalGenerator.js';
import { ProcessCalibrator } from '../components/ProcessCalibrator.js';
import { ElecMeter } from '../components/ElecMeter.js';
import { RealMegohmMeter } from '../components/RealMegohmMeter.js';



export const FAULT_CONFIGS = {
    // ── 发电机组故障（低压配电板发电机控制屏“准备好”灯条件之一）──
    gen1_fault: {
        id: 'gen1_fault', name: '1. 1#发电机组故障', system: '发电机',
        check() { const p = window.sys && window.sys.comps && window.sys.comps.lv_switch_panel; return p ? p.getGenFault('gen1') : false; },
        trigger() { const p = window.sys && window.sys.comps && window.sys.comps.lv_switch_panel; if (p) p.setGenFault('gen1', true); },
        repair() { const p = window.sys && window.sys.comps && window.sys.comps.lv_switch_panel; if (p) p.setGenFault('gen1', false); },
    },
    gen2_fault: {
        id: 'gen2_fault', name: '2. 2#发电机组故障', system: '发电机',
        check() { const p = window.sys && window.sys.comps && window.sys.comps.lv_switch_panel; return p ? p.getGenFault('gen2') : false; },
        trigger() { const p = window.sys && window.sys.comps && window.sys.comps.lv_switch_panel; if (p) p.setGenFault('gen2', true); },
        repair() { const p = window.sys && window.sys.comps && window.sys.comps.lv_switch_panel; if (p) p.setGenFault('gen2', false); },
    },
    gen3_fault: {
        id: 'gen3_fault', name: '3. 3#发电机组故障', system: '发电机',
        check() { const p = window.sys && window.sys.comps && window.sys.comps.lv_switch_panel; return p ? p.getGenFault('gen3') : false; },
        trigger() { const p = window.sys && window.sys.comps && window.sys.comps.lv_switch_panel; if (p) p.setGenFault('gen3', true); },
        repair() { const p = window.sys && window.sys.comps && window.sys.comps.lv_switch_panel; if (p) p.setGenFault('gen3', false); },
    },
    load_ground: {
        id: 'load_ground', name: '4. 左动力负载屏接地（绝缘降低）', system: '动力负载',
        check() { const p = window.sys && window.sys.comps && window.sys.comps.lv_switch_panel; return p ? p.getLoadGroundFault() : false; },
        trigger() { const p = window.sys && window.sys.comps && window.sys.comps.lv_switch_panel; if (p) p.setLoadGroundFault(true); },
        repair() { const p = window.sys && window.sys.comps && window.sys.comps.lv_switch_panel; if (p) p.setLoadGroundFault(false); },
    },
    gen1_class1: {
        id: 'gen1_class1', name: '5. 1#发电机组I级故障', system: '发电机',
        check() { const p = window.sys && window.sys.comps && window.sys.comps.lv_switch_panel; return p ? p.getGenClass1('gen1') : false; },
        trigger() { const p = window.sys && window.sys.comps && window.sys.comps.lv_switch_panel; if (p) p.setGenClass1('gen1', true); },
        repair() { const p = window.sys && window.sys.comps && window.sys.comps.lv_switch_panel; if (p) p.setGenClass1('gen1', false); },
    },
    bus_short: {
        id: 'bus_short', name: '6. 汇流排短路故障', system: '汇流排',
        check() { const p = window.sys && window.sys.comps && window.sys.comps.lv_switch_panel; return p ? p.getAlarm('short') : false; },
        trigger() { const p = window.sys && window.sys.comps && window.sys.comps.lv_switch_panel; if (p) p.setAlarm('short', true); },
        repair() { const p = window.sys && window.sys.comps && window.sys.comps.lv_switch_panel; if (p) p.setAlarm('short', false); },
    },
    gen1_prime_temp: {
        id: 'gen1_prime_temp', name: '7. 1#原动机冷却水温高', system: '原动机',
        check() { const p = window.sys && window.sys.comps && window.sys.comps.lv_switch_panel; return p ? p.getPrimeFault('gen1') === 'temp' : false; },
        trigger() { const p = window.sys && window.sys.comps && window.sys.comps.lv_switch_panel; if (p) p.setPrimeFault('gen1', 'temp', true); },
        repair() { const p = window.sys && window.sys.comps && window.sys.comps.lv_switch_panel; if (p) p.setPrimeFault('gen1', null, false); },
    },
    gen1_prime_lo: {
        id: 'gen1_prime_lo', name: '8. 1#原动机滑油压力低', system: '原动机',
        check() { const p = window.sys && window.sys.comps && window.sys.comps.lv_switch_panel; return p ? p.getPrimeFault('gen1') === 'lo' : false; },
        trigger() { const p = window.sys && window.sys.comps && window.sys.comps.lv_switch_panel; if (p) p.setPrimeFault('gen1', 'lo', true); },
        repair() { const p = window.sys && window.sys.comps && window.sys.comps.lv_switch_panel; if (p) p.setPrimeFault('gen1', null, false); },
    },
    gen1_prime_over: {
        id: 'gen1_prime_over', name: '9. 1#原动机超速', system: '原动机',
        check() { const p = window.sys && window.sys.comps && window.sys.comps.lv_switch_panel; return p ? p.getPrimeFault('gen1') === 'over' : false; },
        trigger() { const p = window.sys && window.sys.comps && window.sys.comps.lv_switch_panel; if (p) p.setPrimeFault('gen1', 'over', true); },
        repair() { const p = window.sys && window.sys.comps && window.sys.comps.lv_switch_panel; if (p) p.setPrimeFault('gen1', null, false); },
    },
};

export const PROJECT_WORKFLOWS = {
    'main-board-ops': {
        id: 'main-board-ops', name: '1. 主配电板设备识别与操作',
        steps: [
            {
                msg: '1. 识别优先脱扣设备：点击一个 PT-1（或 PT-2）铭牌标签 —— 过载一级/二级卸载时，这些开关由分励脱扣器跳闸',
                mode: 'find', target: 'lv_switch_panel', subTarget: 'tag-PT-1',
            },
            {
                msg: '2. 识别应急切断设备：点击一个 ESS-1F（或 ESS-1P）铭牌标签 —— 机舱风机/油泵应急切断时，这些开关分励脱扣',
                mode: 'find', target: 'lv_switch_panel', subTarget: 'tag-ESS-1F',
            },
            {
                msg: '3. 识别应急配电板负荷开关：点击右动力负载屏 QF19「应急配电板」开关（主电网经它向应急配电板送电）',
                mode: 'find', target: 'lv_switch_panel', subTarget: 'emg-load',
            },
            {
                msg: '4. 识别岸电开关：点击右动力负载屏 QF20「岸电开关」（与发电机主开关、应急主开关互锁，下端带电时有点指示）',
                mode: 'find', target: 'lv_switch_panel', subTarget: 'shore-sw',
            },
            {
                msg: '5. 识别绝缘指示灯：点击并车屏下部的绝缘指示灯（地气灯 L1/L2/L3），按下“测试”可试灯查看接地相',
                mode: 'find', target: 'lv_switch_panel', subTarget: 'ins-lamp',
            },
            {
                msg: '6. 将电站改为自动模式：点击并车屏「模式选择」开关，把开关转到“自动”位（检查开关位置，转到自动位方可通过）',
                op: [{
                    type: 'knob', target: 'lv_switch_panel', part: 'plant-mode',
                    msg: '👉 点击并车屏「模式选择」开关，转到“自动”位',
                    act() { const p = this.sys.comps.lv_switch_panel; if (p && p.setPlantMode) p.setPlantMode('AUTO'); },
                }],
                check() { const p = this.sys.comps.lv_switch_panel; return !!(p && p.getPlantMode && p.getPlantMode() === 'AUTO'); },
            },
            {
                msg: '7. 改变发电机备用顺序为 2-3-1：点击并车屏「顺序选择」开关，把开关切到 231（检查开关位置，切到 231 方可通过）',
                op: [{
                    type: 'knob', target: 'lv_switch_panel', part: 'seq',
                    msg: '👉 点击并车屏「顺序选择」开关，切到 231',
                    act() { const p = this.sys.comps.lv_switch_panel; if (p && p.setSeqOrder) p.setSeqOrder('231'); },
                }],
                check() { const p = this.sys.comps.lv_switch_panel; return !!(p && p.getSeqOrder && p.getSeqOrder() === '231'); },
            },
            {
                msg: '8. 读取电网绝缘电阻：读取并车屏下部“配电板式兆欧表”的读数，并在输入框中填入电网绝缘电阻（单位 MΩ）',
                mode: 'fill', target: 'lv_switch_panel', part: 'meg-meter',
                label: '电网绝缘电阻', unit: 'MΩ', answer: 5, tolerance: 0.5,
            },
        ],
    },

    'panel-instruments': {
        id: 'panel-instruments', name: '2. 维护和操作主配电板仪表',
        steps: [
            {
                msg: '1. 点击并车屏「报警测试」按钮，检查声光报警装置（蜂鸣器响、报警灯亮，2s 后自动复位）',
                mode: 'find', target: 'lv_switch_panel', subTarget: 'alarm-test', simClick: true,
            },
            {
                msg: '2. 识别 1# 发电机控制屏的机组「准备好」指示灯（遥控、无故障且停机时亮黄）',
                mode: 'find', target: 'lv_switch_panel', subTarget: 'gen1-ready',
            },
            {
                msg: '3. 识别并车屏「同步表选择」开关（待并机选择：0 / 1# / 2# / 3#，用于并车时选机）',
                mode: 'find', target: 'lv_switch_panel', subTarget: 'sync-select',
            },
            {
                msg: '4. 识别 PPU 组件（发电机参数显示单元：第 1 行电站模式，下面为 U / f / I / P）',
                mode: 'find', target: 'lv_switch_panel', subTarget: 'ppu',
            },
            {
                msg: '5. 识别 1# 发电机组频率表（Hz，与电压表 V、电流表 A 以屏中心左右对称布置）',
                mode: 'find', target: 'lv_switch_panel', subTarget: 'gen1-hz',
            },
        ],
    },

    'panel-acb': {
        id: 'panel-acb', name: '3. 维护和操作自动空气断路器',
        steps: [
            {
                msg: '1. 将电站转为自动模式：点击并车屏「模式选择」开关转到“自动”位，等待 1# 发电机自动起动、1# 主开关自动合闸供电',
                op: [{
                    type: 'knob', target: 'lv_switch_panel', part: 'plant-mode',
                    msg: '👉 点击并车屏「模式选择」开关，转到“自动”位',
                    async act() {
                        const p = this.sys.comps.lv_switch_panel;
                        if (p && p.setPlantMode) p.setPlantMode('AUTO');
                        // 等待 1# 自动起动 + 主开关自动合闸供电完成，再进入下一步演示
                        for (let i = 0; i < 80; i++) {
                            const st = (p && p.getGenState) ? p.getGenState('gen1') : null;
                            if (st && st.run && st.cb) break;
                            await new Promise(r => setTimeout(r, 400));
                        }
                        const st = (p && p.getGenState) ? p.getGenState('gen1') : null;
                        if (st && st.run && st.cb) this._tipWorkflow('✅ 1# 发电机已自动起动、1# 主开关已合闸，1# 机组带载供电', 3000);
                    },
                }],
                check() {
                    const p = this.sys.comps.lv_switch_panel;
                    if (!p || !p.getGenState) return false;
                    const s = p.getGenState('gen1');
                    return !!(s.run && s.cb);
                },
            },
            {
                msg: '2. 调出「其它配电装置」面板（勾选工具栏），按下「机舱风机应急切断」按钮，观察带 ESS-1F 标签的断路器脱扣',
                op: [{
                    type: 'btn', target: 'important_panel', part: 'cutoff-1',
                    msg: '👉 调出「其它配电装置」面板，按下「机舱风机应急切断」按钮',
                    async act() {
                        const cb = document.getElementById('btnImpPanel');
                        if (cb) await this._flashDomElement(cb, '👉 勾选工具栏「其他配电装置」', 2000);
                        if (cb && !cb.checked) { cb.checked = true; cb.dispatchEvent(new Event('change')); }
                        await new Promise(r => setTimeout(r, 1200));                 // 等面板显示出来
                        const ip = this.sys.comps.important_panel;
                        await new Promise(r => setTimeout(r, 400));
                        const c = (ip && ip.getClickablePartCenter) ? ip.getClickablePartCenter('cutoff-1') : null;
                        if (c) { this._tipWorkflow('👉 按下「机舱风机应急切断」按钮', 3000); await this._flashArrow(c, { on: 500, off: 350, times: 3 }); }
                        if (ip) ip.setCutoff(0, true);                               // 点击按钮（按下自锁）
                        await new Promise(r => setTimeout(r, 900));
                        const p = this.sys.comps.lv_switch_panel;
                        const tc = (p && p.getTaggedPartCenter) ? p.getTaggedPartCenter('ESS-1F') : null;
                        if (tc) {
                            this._tipWorkflow('观察：该 ESS-1F 断路器已分励脱扣，手柄停在 TRIP 位', 3200);
                            await this._flashArrow(tc, { on: 500, off: 350, times: 3 });
                        }
                    },
                }],
                check() {
                    const ip = this.sys.comps.important_panel, p = this.sys.comps.lv_switch_panel;
                    if (!ip || !p) return false;
                    return !!ip.getCutoff(0) && !p.allTaggedClosed('ESS-1F');
                },
            },
            {
                msg: '3. 复位「机舱风机应急切断」按钮（再按一次使其弹出），然后关闭「其它配电装置」面板（取消勾选）',
                op: [{
                    type: 'btn', target: 'important_panel', part: 'cutoff-1',
                    msg: '👉 再按一次「机舱风机应急切断」按钮，使其弹出复位',
                    async act() {
                        const ip = this.sys.comps.important_panel;
                        const c = (ip && ip.getClickablePartCenter) ? ip.getClickablePartCenter('cutoff-1') : null;
                        if (c) { this._tipWorkflow('👉 按下该按钮，使其弹出复位', 2500); await this._flashArrow(c, { on: 500, off: 350, times: 3 }); }
                        if (ip) ip.setCutoff(0, false);                              // 弹出复位
                        await new Promise(r => setTimeout(r, 900));
                        const cb = document.getElementById('btnImpPanel');
                        if (cb) await this._flashDomElement(cb, '👉 取消勾选，关闭「其它配电装置」面板', 2000);
                        if (cb && cb.checked) { cb.checked = false; cb.dispatchEvent(new Event('change')); }
                    },
                }],
                check() {
                    const ip = this.sys.comps.important_panel;
                    if (!ip) return false;
                    const cb = document.getElementById('btnImpPanel');
                    return !ip.getCutoff(0) && (!cb || !cb.checked);
                },
            },
            {
                msg: '4. 复位所有带 ESS-1F 标签的断路器：逐个演示“先拉到 OFF 位复位，再推到 ON 位合闸”',
                async act() {
                    const p = this.sys.comps.lv_switch_panel;
                    if (!p || !p.getTaggedIds) return;
                    const ids = p.getTaggedIds('ESS-1F');
                    for (const id of ids) {                                          // 4 个开关逐个演示
                        const c = p.getPartCenterById ? p.getPartCenterById(id) : null;
                        if (c) { this._tipWorkflow('👉 先把手柄拉到 OFF 位复位', 2500); await this._flashArrow(c, { on: 400, off: 300, times: 2 }); }
                        p.setMCB(id, false);                                         // 拉到 OFF 位
                        await new Promise(r => setTimeout(r, 600));
                        if (c) { this._tipWorkflow('👉 再把手柄推到 ON 位合闸', 2500); await this._flashArrow(c, { on: 400, off: 300, times: 2 }); }
                        p.setMCB(id, true);                                          // 推到 ON 位
                        await new Promise(r => setTimeout(r, 500));
                    }
                    this._tipWorkflow('✅ 全部 ESS-1F 断路器已复位并合闸', 3000);
                },
                check() {
                    const p = this.sys.comps.lv_switch_panel;
                    return !!(p && p.allTaggedClosed && p.allTaggedClosed('ESS-1F'));
                },
            },
            {
                msg: '5. 测试题：应急切断断路器的工作原理',
                mode: 'quiz',
                quizConfig: {
                    question: '关于应急切断（机舱风机 ESS-1F 应急切断）断路器的工作原理，正确的是？',
                    options: [
                        '按钮按下后自锁，其触点接通 ESS-1F 断路器的分励脱扣器，脱扣器带电使断路器跳闸（手柄停 TRIP 位）',
                        '按钮直接手动分断断路器，与电气回路无关',
                        '按钮仅点亮指示灯，断路器不会跳闸',
                        '断路器跳闸后手柄停在 OFF 位，可直接重新推到 ON 合闸',
                    ],
                    answer: 0,
                    analysis: '应急切断按钮为自锁式：按下后其触点闭合，带 ESS-1F 标签的塑壳断路器分励脱扣器线圈带电，脱扣器动作使断路器跳闸，手柄停在 TRIP（中间）位。按钮未弹出前沿分励脱扣器一直带电，因此这些断路器合上即脱扣、无法合闸；必须先把按钮弹出复位，再按 TRIP→OFF→ON 的顺序恢复断路器。',
                },
            },
        ],
    },
};

export const componentConfigs = [


    // ── 船舶低压电力系统单线图（交互组件，替代高压单线图）──
    { Class: LvPowerOneLine, id: 'lv_one_line', x: 1200, y: 0, label: '低压电力系统单线图', visible: true },

    // ── 低压配电板组件图（主配电板，默认显示）──
    { Class: LvSwitchPanel, id: 'lv_switch_panel', x: 20, y: 30, label: '主配电板', visible: true },

    // ── 重要配电装置（应急发电机机旁控制箱 / 应急配电板 / 岸电箱 / 重载问询 / 应急风油切断）──
    { Class: ImportantDistPanel, id: 'important_panel', x: 20, y: 300, label: '重要配电装置', visible: true },

    // ── 测量仪表（隐藏，按需显示）──
    { Class: Multimeter, id: 'multimeter', x: 500, y: 100, visible: false },
    { Class: MF47Multimeter, id: 'mf47-panel', x: 650, y: 100, visible: false },
    { Class: Oscilloscope_tri, id: 'osc', x: 50, y: 50, visible: false },
    { Class: SignalGenerator, id: 'sg', x: 50, y: 50, visible: false },
    { Class: ProcessCalibrator, id: 'cali', x: 50, y: 50, visible: false },
    { Class: ElecMeter, id: 'elecmeter', x: 50, y: 50, visible: false },
    // ── 手摇式兆欧表（摇表，2500V 型；隐藏，测试绝缘时按需调出）──
    { Class: RealMegohmMeter, id: 'megohm', x: 200, y: 50, voltage: 2500, label: '手摇兆欧表(2500V)', visible: false },
];

// ─── 接线辅助 ───

const _sleep = ms => new Promise(r => setTimeout(r, ms));



function _autoWire(sys) {
    sys.conns.length = 0;
    const cons = [];
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

}

export function fiveStep() {
}
