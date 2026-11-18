// 热继电器过载保护仿真工程

import { ACPower3P } from '../components/ACPower3P.js';
import { ThermalOverloadRelay } from '../components/ThermalOverloadRelay.js';
import { Resistor } from '../components/Resistor.js';
import { Multimeter } from '../components/Multimeter.js';
import { MF47Multimeter } from '../components/MF47Multimeter.js';
import { Oscilloscope_tri } from '../components/Osc_tri.js';
import { SignalGenerator } from '../components/SignalGenerator.js';
import { ProcessCalibrator } from '../components/ProcessCalibrator.js';
import { ElecMeter } from '../components/ElecMeter.js';

export const FAULT_CONFIGS = {};

// ═══════════════════════════════════════════════════════════════
// 通用演示辅助
//   · 所有 check 步骤均使用 op 数组：自动演示时按「箭头指向目标 → 执行该
//     操作 → 停留观察」的节奏逐个演示子操作；
//   · 接线 ≤8 根时使用动画接线（约 3s/根，逐根 await）；
//   · 参数调整一律通过组件参数配置界面动态演示（弹出 → 改值 → 保存）。
// ═══════════════════════════════════════════════════════════════

/** 无向判断两端口是否已连线 */
function _hasConn(sys, a, b) {
    return sys.conns.some(c => (c.from === a && c.to === b) || (c.from === b && c.to === a));
}

/** 动画接线（约 3s/根，用于自动演示逐根接线；已连则跳过） */
async function _wireAnimated(sys, from, to) {
    if (_hasConn(sys, from, to)) return;
    await sys.connMgr.addConnectionAnimated({ from, to, type: 'wire' });
}

/** 清空全部连线 */
function _clearConns(sys) {
    if (sys && Array.isArray(sys.conns)) {
        sys.conns.length = 0;
        sys.redrawAll();
    }
}

/** 移除某端口上的全部连线 */
function _disconnectPort(sys, portId) {
    if (!sys || !Array.isArray(sys.conns)) return;
    for (let i = sys.conns.length - 1; i >= 0; i--) {
        const c = sys.conns[i];
        if (c.from === portId || c.to === portId) sys.conns.splice(i, 1);
    }
    sys.redrawAll();
}

/**
 * 通过参数配置界面动态演示参数修改：
 * ① 弹出参数设置对话框 → ② 高亮目标输入框并填入新值 → ③ 高亮「保存」并点击。
 */
async function _demoSetConfig(wf, compId, key, value, tip) {
    const comp = wf.sys.comps[compId];
    if (!comp || typeof comp.showConfigDialog !== 'function') return;
    // 弹框前把组件实时属性同步进 config 副本，否则「保存」会把旧值（如电源 isOn）一并回写
    (comp.getConfigFields ? comp.getConfigFields() : []).forEach(f => {
        if (f.get) return;
        try { const live = comp[f.key]; if (live !== undefined) comp.config[f.key] = live; } catch (e) { /* 只读属性忽略 */ }
    });
    comp.showConfigDialog();                          // ① 弹出参数设置界面
    await new Promise(r => setTimeout(r, 700));
    const input = document.getElementById('diag_' + key);
    if (input) {
        await wf._flashDomElement(input, tip || `请将该参数改为 ${value}`, 2400);   // ② 高亮输入框并填值
        input.value = value;
    }
    // ③ 取最后打开的配置对话框的「保存」按钮（对话框按打开顺序追加到容器）
    const saveBtns = [...document.querySelectorAll('button')].filter(b => b.textContent.trim() === '保存');
    const saveBtn = saveBtns[saveBtns.length - 1];
    if (saveBtn) {
        await wf._flashDomElement(saveBtn, '点击「保存」确认参数修改', 1800);
        saveBtn.click();
    }
    await new Promise(r => setTimeout(r, 500));
}

export const PROJECT_WORKFLOWS = {
    'overload-test': {
        id: 'overload-test',
        name: '1. 热继电器过载保护操作',
        steps: [
            {
                msg: '第 1 步：将三相电源 U/V/W 依次接入热继电器进线端 L1/L2/L3，热继电器出线端 T1/T2/T3 分别接三个负载电阻（星形连接）。闭合三相电源，电路电流小于热继电器整定值，电路正常工作。',
                mode: 'check',
                check() {
                    const c = (a, b) => this.sys.isPortConnected(a, b);
                    const fr = this.sys.comps['fr'];
                    const ac = this.sys.comps['ac'];
                    return ac && ac.isOn
                        && fr && fr.getState() === 'normal'
                        && c('ac_wire_u', 'fr_wire_l1')
                        && c('ac_wire_v', 'fr_wire_l2')
                        && c('ac_wire_w', 'fr_wire_l3')
                        && c('fr_wire_t1', 'r1_wire_l')
                        && c('fr_wire_t2', 'r2_wire_l')
                        && c('fr_wire_t3', 'r3_wire_l');
                },
                op: [
                    { type: 'observe', target: 'ac',
                      msg: '三相电源 U/V/W 三相接入热继电器进线端 L1/L2/L3',
                      async act() {
                          _clearConns(this.sys);
                          await _wireAnimated(this.sys, 'ac_wire_u', 'fr_wire_l1');
                          await _wireAnimated(this.sys, 'ac_wire_v', 'fr_wire_l2');
                          await _wireAnimated(this.sys, 'ac_wire_w', 'fr_wire_l3');
                      } },
                    { type: 'observe', target: 'fr',
                      msg: '热继电器出线端 T1/T2/T3 分别接三个负载电阻 R1/R2/R3',
                      async act() {
                          await _wireAnimated(this.sys, 'fr_wire_t1', 'r1_wire_l');
                          await _wireAnimated(this.sys, 'fr_wire_t2', 'r2_wire_l');
                          await _wireAnimated(this.sys, 'fr_wire_t3', 'r3_wire_l');
                      } },
                    { type: 'observe', target: 'r1',
                      msg: '三个负载电阻末端星形连接（R1-R2-R3 公共点）',
                      async act() {
                          await _wireAnimated(this.sys, 'r1_wire_r', 'r2_wire_r');
                          await _wireAnimated(this.sys, 'r2_wire_r', 'r3_wire_r');
                      } },
                    { type: 'switch', target: 'ac', part: 'power',
                      msg: '按下三相电源「电源」按钮闭合电路（相电压 50V，电流小于整定值，热继电器保持正常）',
                      async act() {
                          const ac = this.sys.comps['ac'];
                          if (ac) ac.onConfigUpdate({ vRms: 50, freq: 50, isOn: true });
                          await new Promise(r => setTimeout(r, 2500));
                      } },
                ],
            },
            {
                msg: '第 2 步：调节三相电源输出电压到 135V（过载系数约 1.35 倍），热继电器延时后动作（TRIP 指示灯亮，NC 触点断开）。',
                mode: 'check',
                check() {
                    const fr = this.sys.comps['fr'];
                    return fr && fr.getState() === 'tripped';
                },
                op: [
                    { type: 'observe', target: 'ac',
                      msg: '打开三相电源「参数设置」，把相电压有效值改为 135V（过载系数约 1.35 倍）',
                      async act() {
                          await _demoSetConfig(this, 'ac', 'vRms', 135, '将「相电压有效值」改为 135V');
                      } },
                    { type: 'observe', target: 'fr',
                      msg: '观察热继电器：双金属片受热逐渐弯曲，延时到达后 TRIP 指示灯亮、NC 触点断开',
                      async act() { await new Promise(r => setTimeout(r, 12000)); } },
                ],
            },
            {
                msg: '第 3 步：断开三相电源，按下热继电器 RESET 按钮复位。',
                mode: 'check',
                check() {
                    const ac = this.sys.comps['ac'];
                    const fr = this.sys.comps['fr'];
                    return ac && !ac.isOn && fr && fr.getState() === 'normal';
                },
                op: [
                    { type: 'switch', target: 'ac', part: 'power',
                      msg: '再次按下三相电源「电源」按钮断开电源，双金属片开始冷却',
                      async act() {
                          const ac = this.sys.comps['ac'];
                          if (ac) ac.onConfigUpdate({ isOn: false });
                          await new Promise(r => setTimeout(r, 3000));
                      } },
                    { type: 'btn', target: 'fr', part: 'reset',
                      msg: '按下热继电器红色 RESET 按钮复位（双金属片冷却后 NC 恢复闭合）',
                      async act() {
                          const fr = this.sys.comps['fr'];
                          if (fr) fr.reset();
                          await new Promise(r => setTimeout(r, 1500));
                      } },
                ],
            },
            {
                msg: '第 4 步：热继电器知识',
                mode: 'quiz',
                quizConfig: {
                    question: '热继电器主要用于保护电动机免受什么故障的损害？',
                    options: [
                        '长期过载（过电流）',
                        '短路故障',
                        '欠压故障',
                        '缺相故障',
                    ],
                    answer: 0,
                    analysis: '热继电器利用双金属片受热弯曲的原理，在电动机长期过载时断开控制电路，实现过载保护。热继电器具有反时限特性——过载倍数越大，动作时间越短。热继电器不能用于短路保护（短路电流由熔断器或断路器承担），也不能准确反映缺相和欠压故障。',
                },
            },
            {
                msg: '第 5 步：调节三相电源输出电压到 100V，将热继电器整定值调为 8A（过载约 1.25 倍），热继电器延时后动作。',
                mode: 'check',
                check() {
                    const fr = this.sys.comps['fr'];
                    return fr && fr.getState() === 'tripped';
                },
                op: [
                    { type: 'knob', target: 'fr', part: 'knob',
                      msg: '打开热继电器「参数设置」，把整定电流调为 8A，指针随之转动到 8A 刻度',
                      async act() {
                          await _demoSetConfig(this, 'fr', 'ratedCurrent', 8, '将「整定电流 (A)」改为 8，指针会转到 8A 刻度');
                      } },
                    { type: 'switch', target: 'ac', part: 'power',
                      msg: '打开三相电源「参数设置」，把相电压改为 100V 并接通电源',
                      async act() {
                          await _demoSetConfig(this, 'ac', 'vRms', 100, '将「相电压有效值」改为 100V');
                          const ac = this.sys.comps['ac'];
                          if (ac && !ac.isOn) ac.onConfigUpdate({ isOn: true });
                          await new Promise(r => setTimeout(r, 1500));
                      } },
                    { type: 'observe', target: 'fr',
                      msg: '观察热继电器：过载约 1.25 倍，延时后再次动作跳闸',
                      async act() { await new Promise(r => setTimeout(r, 17000)); } },
                ],
            },
        ],
    },
    'multimeter-test': {
        id: 'multimeter-test',
        name: '2. 用万用表测试热继电器',
        steps: [
            {
                msg: '第 1 步：将万用表切换到 200Ω 档，红表笔接热继电器 L1 端子，黑表笔接 T1 端子，测量 A 相发热元件电阻（约 0.01Ω）。',
                mode: 'check',
                check() {
                    const mm = this.sys.comps['multimeter'];
                    const c = (a, b) => this.sys.isPortConnected(a, b);
                    return mm && mm.mode === 'RES200'
                        && c('multimeter_wire_v', 'fr_wire_l1')
                        && c('multimeter_wire_com', 'fr_wire_t1')
                        && mm.value < 1;
                },
                op: [
                    { type: 'instrument', instrument: 'multimeter', target: 'multimeter',
                      msg: '通过工具栏【选择仪表】面板勾选，调出数字万用表',
                      async act() {
                          const mm = this.sys.comps['multimeter'];
                          if (mm && mm.group) mm.group.visible(true);
                          this.sys.redrawAll();
                          await new Promise(r => setTimeout(r, 800));
                      } },
                    { type: 'knob', target: 'multimeter',
                      msg: '把万用表档位开关拨到 200Ω 电阻档',
                      async act() {
                          const mm = this.sys.comps['multimeter'];
                          if (mm) {
                              mm.mode = 'RES200';
                              if (typeof mm._updateAngleByMode === 'function') mm._updateAngleByMode();
                          }
                          this.sys.redrawAll();
                          await new Promise(r => setTimeout(r, 1200));
                      } },
                    { type: 'observe', target: 'fr',
                      msg: '红表笔接 L1 端子、黑表笔接 T1 端子，测量 A 相发热元件电阻（约 0.01Ω）',
                      async act() {
                          _clearConns(this.sys);
                          await _wireAnimated(this.sys, 'multimeter_wire_v', 'fr_wire_l1');
                          await _wireAnimated(this.sys, 'multimeter_wire_com', 'fr_wire_t1');
                          await new Promise(r => setTimeout(r, 1500));
                      } },
                ],
            },
            {
                msg: '第 2 步：保持万用表 200Ω 档，红表笔改接热继电器 NC 端子 95，黑表笔改接 NC 端子 96，测量常闭触头电阻（应接近 0Ω）。',
                mode: 'check',
                check() {
                    const mm = this.sys.comps['multimeter'];
                    const c = (a, b) => this.sys.isPortConnected(a, b);
                    return mm && mm.mode === 'RES200'
                        && c('multimeter_wire_v', 'fr_wire_nc_a')
                        && c('multimeter_wire_com', 'fr_wire_nc_b')
                        && mm.value < 1;
                },
                op: [
                    { type: 'observe', target: 'fr',
                      msg: '红表笔改接常闭端子 95、黑表笔改接端子 96，测量常闭触头（NC）电阻（应接近 0Ω）',
                      async act() {
                          _disconnectPort(this.sys, 'multimeter_wire_v');
                          _disconnectPort(this.sys, 'multimeter_wire_com');
                          await _wireAnimated(this.sys, 'multimeter_wire_v', 'fr_wire_nc_a');
                          await _wireAnimated(this.sys, 'multimeter_wire_com', 'fr_wire_nc_b');
                          await new Promise(r => setTimeout(r, 1500));
                      } },
                ],
            },
            {
                msg: '第 3 步：接通三相电源主线路（ac → fr → 负载电阻），调节电压到 135V（过载系数约 1.35 倍），热继电器延时动作后常闭触头断开（万用表显示 O.L）。',
                mode: 'check',
                check() {
                    const fr = this.sys.comps['fr'];
                    const mm = this.sys.comps['multimeter'];
                    const c = (a, b) => this.sys.isPortConnected(a, b);
                    return fr && fr.getState() === 'tripped'
                        && mm && mm.mode === 'RES200'
                        && c('multimeter_wire_v', 'fr_wire_nc_a')
                        && c('multimeter_wire_com', 'fr_wire_nc_b')
                        && mm.value > 200;
                },
                op: [
                    { type: 'observe', target: 'ac',
                      msg: '接通三相电源主线路：U/V/W → 热继电器 L1/L2/L3（万用表保持在 NC 触头两端）',
                      async act() {
                          await _wireAnimated(this.sys, 'ac_wire_u', 'fr_wire_l1');
                          await _wireAnimated(this.sys, 'ac_wire_v', 'fr_wire_l2');
                          await _wireAnimated(this.sys, 'ac_wire_w', 'fr_wire_l3');
                      } },
                    { type: 'observe', target: 'fr',
                      msg: '热继电器 T1/T2/T3 → 负载电阻 R1/R2/R3，并完成星形连接',
                      async act() {
                          await _wireAnimated(this.sys, 'fr_wire_t1', 'r1_wire_l');
                          await _wireAnimated(this.sys, 'fr_wire_t2', 'r2_wire_l');
                          await _wireAnimated(this.sys, 'fr_wire_t3', 'r3_wire_l');
                          await _wireAnimated(this.sys, 'r1_wire_r', 'r2_wire_r');
                          await _wireAnimated(this.sys, 'r2_wire_r', 'r3_wire_r');
                      } },
                    { type: 'switch', target: 'ac', part: 'power',
                      msg: '打开三相电源「参数设置」，把相电压改为 135V（过载约 1.35 倍）并接通电源',
                      async act() {
                          await _demoSetConfig(this, 'ac', 'vRms', 135, '将「相电压有效值」改为 135V');
                          const ac = this.sys.comps['ac'];
                          if (ac && !ac.isOn) ac.onConfigUpdate({ isOn: true });
                          await new Promise(r => setTimeout(r, 1500));
                      } },
                    { type: 'observe', target: 'fr',
                      msg: '观察万用表：热继电器延时动作后常闭触头断开，万用表显示 O.L（过载 1.35 倍）',
                      async act() { await new Promise(r => setTimeout(r, 12000)); } },
                ],
            },
        ],
    },
};

export const componentConfigs = [
    { Class: ACPower3P, id: 'ac', x: 100, y: 60, vRms: 50, freq: 50, isOn: false, phaseSeq: 'pos', visible: true },
    { Class: ThermalOverloadRelay, id: 'fr', x: 100, y: 300, ratedCurrent: 10, initState: 'normal', phaseResistance: 0.01, visible: true,scale:1},
    { Class: Resistor, id: 'r1', x: 160, y: 810, value: 10, visible: true, rotation: 90 },
    { Class: Resistor, id: 'r2', x: 260, y: 810, value: 10, visible: true, rotation: 90 },
    { Class: Resistor, id: 'r3', x: 360, y: 810, value: 10, visible: true, rotation: 90 },

    { Class: Multimeter, id: 'multimeter', x: 920, y: 100, visible: false },
    { Class: MF47Multimeter, id: 'mf47-panel', x: 1050, y: 150, visible: false },
    { Class: Oscilloscope_tri, id: 'osc', x: 50, y: 50, visible: false },
    { Class: SignalGenerator, id: 'sg', x: 50, y: 50, visible: false },
    { Class: ProcessCalibrator, id: 'cali', x: 50, y: 50, visible: false },
    { Class: ElecMeter, id: 'elecmeter', x: 50, y: 50, visible: false },
];

function _autoWire(sys, mode) {
    sys.conns.length = 0;
    const cons = [
        { from: 'ac_wire_u', to: 'fr_wire_l1', type: 'wire' },
        { from: 'ac_wire_v', to: 'fr_wire_l2', type: 'wire' },
        { from: 'ac_wire_w', to: 'fr_wire_l3', type: 'wire' },
        { from: 'fr_wire_t1', to: 'r1_wire_l', type: 'wire' },
        { from: 'fr_wire_t2', to: 'r2_wire_l', type: 'wire' },
        { from: 'fr_wire_t3', to: 'r3_wire_l', type: 'wire' },
        { from: 'r1_wire_r', to: 'r2_wire_r', type: 'wire' },
        { from: 'r2_wire_r', to: 'r3_wire_r', type: 'wire' },
    ];
    cons.forEach(c => sys.connMgr.addConn(c));
    sys.redrawAll();
}

export function initSlider(sys) {
}

export function applyAllPresets() {
    const sys = this && this.sys ? this.sys : window.sys;
    if (!sys) return;
    _autoWire(sys, 'overload-test');
}

export async function applyStartSystem() {
    const sys = this && this.sys ? this.sys : window.sys;
    if (!sys) return;
    _autoWire(sys, 'overload-test');
    const ac = sys.comps['ac'];
    if (ac) ac.onConfigUpdate({ vRms: 50, freq: 50, isOn: true, phaseSeq: 'pos' });    
}

export function fiveStep() {}
