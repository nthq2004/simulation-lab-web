// 7805 三端稳压器整流仿真工程
// 电路：AC 220V → 保险丝 → 控制变压器(220V/12V) → 桥式整流 → 47µF滤波 → 7805 → 22µF滤波 → 200Ω负载

import { ACPower } from '../components/ACPower.js';
import { SinglePhaseFuse } from '../components/SinglePhaseFuse.js';
import { RealControlTransformer } from '../components/RealControlTransformer.js';
import { Diode } from '../components/Diode.js';
import { Capacitor } from '../components/Capacitor.js';
import { IC7805 } from '../components/IC7805.js';
import { Resistor } from '../components/Resistor.js';
import { Ground } from '../components/Gnd.js';
import { Multimeter } from '../components/Multimeter.js';
import { MF47Multimeter } from '../components/MF47Multimeter.js';
import { Oscilloscope_tri } from '../components/Osc_tri.js';
import { SignalGenerator } from '../components/SignalGenerator.js';
import { ProcessCalibrator } from '../components/ProcessCalibrator.js';
import { ElecMeter } from '../components/ElecMeter.js';

export const FAULT_CONFIGS = {};

export const PROJECT_WORKFLOWS = {

    '7805-recognize': {
        id: '7805-recognize',
        name: '1. 识别元器件及其功能',
        steps: [
            {
                msg: '1. 识别变压器：请点击电路中的控制变压器',
                mode: 'find',
                target: 'tr',
            },
            {
                msg: '2. 识别二极管：请点击任意一个整流二极管',
                mode: 'find',
                target: ['d1', 'd2', 'd3', 'd4'],
                demoTarget: 'd1',
            },
            {
                msg: '3. 测试题：二极管的作用',
                mode: 'quiz',
                quizConfig: {
                    question: '在本整流电路中，二极管的主要作用是什么？',
                    options: [
                        '放大电流',
                        '整流，将交流电转换为脉动直流电',
                        '储存电能',
                        '升高电压',
                    ],
                    answer: 1,
                    analysis: '二极管利用单向导电性进行整流，四个二极管构成桥式整流电路，将交流电转换为脉动直流电。',
                },
            },
            {
                msg: '4. 识别电容：请点击滤波电容',
                mode: 'find',
                target: ['c1', 'c2'],
                demoTarget: 'c1',
            },
            {
                msg: '5. 测试题：电容的作用',
                mode: 'quiz',
                quizConfig: {
                    question: '滤波电容在整流电路中的作用是：',
                    options: [
                        '放大整流输出电压',
                        '储能并平滑电压波形，使脉动直流变得平稳',
                        '将直流电转换为交流电',
                        '限制电路中的电流',
                    ],
                    answer: 1,
                    analysis: '电容利用充放电特性进行储能，能平滑整流后的脉动电压，使输出电压波形变得平稳，起到滤波作用。',
                },
            },
            {
                msg: '6. 识别集成稳压器件：请点击三端稳压器.',
                mode: 'find',
                target: 'reg',
            },
            {
                msg: '7. 测试题：电源电路的四个基本环节',
                mode: 'quiz',
                quizConfig: {
                    question: '直流稳压电源电路通常包含哪四个基本环节？',
                    options: [
                        '变压、整流、滤波、稳压',
                        '电源、导线、负载、开关',
                        '放大、整流、滤波、稳压',
                        '变压、整流、放大、滤波',
                    ],
                    answer: 0,
                    analysis: '直流稳压电源电路由四个基本环节组成：变压器将电压变换到合适的幅度，整流电路把交流变为脉动直流，滤波电路平滑波形，稳压电路保证输出电压稳定。',
                },
            },
        ],
    },
    '7805-analyze': {
        id: '7805-analyze',
        name: '2. 电子电路工作流程分析',
        steps: [
            {
                msg: '1. 接线，并接通电源（连线较多，采用自动连线）',
                mode: 'check',
                check() {
                    const ac = this.sys.comps['ac'];
                    return ac && ac.isOn && _hasConn(this.sys, 'ac_wire_p', 'fu_wire_l');
                },
                op: [
                    { type: 'wire', msg: '点击工具栏【自动接线】按钮，按预设一次性完成全部电路连线（AC → 保险丝 → 变压器 → 桥式整流 → 滤波 → 7805 稳压 → 负载）',
                      async act() { _autoWire(this.sys); this.sys.redrawAll(); } },
                    { type: 'switch', target: 'ac', part: 'power', msg: '按下交流电源面板上的「电源」按钮，接通电源（220V、50Hz）',
                      async act() {
                          const ac = this.sys.comps['ac'];
                          if (ac) { ac.isOn = true; ac.vRms = 220; ac.freq = 50; ac.update(); }
                          await new Promise(r => setTimeout(r, 3000));
                      } },
                ],
            },
            {
                msg: '2. 调出三路示波器，测量变压器输入、输出波形',
                mode: 'check',
                check() {
                    const osc = this.sys.comps['osc'];
                    return osc && osc.group && osc.group.visible()
                        && _hasConn(this.sys, 'osc_wire_ch1p', 'tr_wire_p1')
                        && _hasConn(this.sys, 'osc_wire_ch1n', 'tr_wire_p2')
                        && _hasConn(this.sys, 'osc_wire_ch2p', 'tr_wire_s1')
                        && _hasConn(this.sys, 'osc_wire_ch2n', 'tr_wire_s2');
                },
                op: [
                    { type: 'instrument', instrument: 'osc', target: 'osc',
                      msg: '通过工具栏【选择仪表】面板勾选，调出三路示波器',
                      async act() {
                          const osc = this.sys.comps['osc'];
                          if (osc && osc.group) { osc.group.visible(true); osc.group.position({ x: 500, y: 500 }); }
                          this.sys.redrawAll();
                          await new Promise(r => setTimeout(r, 1000));
                      } },
                    { type: 'observe', target: 'tr', part: 'primary', msg: 'CH1 表笔接变压器原边接线柱（一次绕组两端），观察输入波形',
                      async act() {
                          _disconnectOsc(this.sys);
                          await _addAnim(this.sys, 'osc_wire_ch1p', 'tr_wire_p1');
                          await _addAnim(this.sys, 'osc_wire_ch1n', 'tr_wire_p2');
                          this.sys.redrawAll();
                      } },
                    { type: 'observe', target: 'tr', part: 'secondary', msg: 'CH2 表笔接变压器副边接线柱（二次绕组两端），观察输出波形',
                      async act() {
                          await _addAnim(this.sys, 'osc_wire_ch2p', 'tr_wire_s1');
                          await _addAnim(this.sys, 'osc_wire_ch2n', 'tr_wire_s2');
                          this.sys.redrawAll();
                          // 波形若不满屏/越界 → 自动调档至波形完整展示
                          await _autoRangeOsc(this, [0, 1], '自动调整 CH1/CH2 档位，使波形完整展示');
                      } },
                ],
            },
            {
                msg: '3. 示波器第 3 路测量第一个滤波电容上的电压波形',
                mode: 'check',
                check() {
                    return _hasConn(this.sys, 'osc_wire_ch3p', 'c1_wire_l')
                        && _hasConn(this.sys, 'osc_wire_ch3n', 'c1_wire_r');
                },
                op: [
                    { type: 'observe', target: 'c1', msg: 'CH3 表笔接第一个滤波电容 C1 两端，观察滤波后的电压波形',
                      async act() {
                          await _addAnim(this.sys, 'osc_wire_ch3p', 'c1_wire_l');
                          await _addAnim(this.sys, 'osc_wire_ch3n', 'c1_wire_r');
                          this.sys.redrawAll();
                          // 波形若不满屏/越界 → 自动调档至波形完整展示
                          await _autoRangeOsc(this, [2], '自动调整 CH3 档位，使滤波波形完整展示');
                      } },
                ],
            },
            {
                msg: '4. 调出数字万用表，切到直流 20V 档，测量负载两端电压',
                mode: 'check',
                check() {
                    const mm = this.sys.comps['multimeter'];
                    return mm && mm.group && mm.group.visible()
                        && _hasConn(this.sys, 'multimeter_wire_v', 'rl_wire_l')
                        && _hasConn(this.sys, 'multimeter_wire_com', 'rl_wire_r');
                },
                op: [
                    { type: 'instrument', instrument: 'multimeter', target: 'multimeter',
                      msg: '通过工具栏【选择仪表】面板勾选，调出数字万用表',
                      async act() {
                          const mm = this.sys.comps['multimeter'];
                          if (mm && mm.group) { mm.group.visible(true);  }
                          this.sys.redrawAll();
                          await new Promise(r => setTimeout(r, 1000));
                      } },
                    { type: 'observe', target: 'multimeter', msg: '档位开关切到直流 20V 档，并将万用表移到负载附近',
                      async act() {
                          const mm = this.sys.comps['multimeter'];
                          if (mm) {  mm.mode = 'DCV20'; mm._updateAngleByMode?.(); }
                          this.sys.redrawAll();
                          await new Promise(r => setTimeout(r, 1500));
                      } },
                    { type: 'observe', target: 'rl', msg: '红表笔接负载左端、黑表笔接负载右端，观察输出电压读数',
                      async act() {
                          await _addAnim(this.sys, 'multimeter_wire_v', 'rl_wire_l');
                          await _addAnim(this.sys, 'multimeter_wire_com', 'rl_wire_r');
                          this.sys.redrawAll();
                          await new Promise(r => setTimeout(r, 3000));
                      } },
                ],
            },
            {
                msg: '5. 改变电源电压有效值(240V)，观察输出电压变化',
                mode: 'check',
                check() {
                    const ac = this.sys.comps['ac'];
                    return ac && Math.abs(ac.vRms - 240) < 0.1;
                },
                op: [
                    { type: 'observe', target: 'ac', msg: '右键交流电源 → 参数设置，打开参数配置界面',
                      async act() {
                          await _demoSetConfig(this, 'ac', 'vRms', 240, '请将电压有效值改为 240V');
                      } },
                    { type: 'observe', target: 'multimeter', msg: '观察万用表读数：稳压器输出仍保持约 +5V 基本不变',
                      async act() {
                          await new Promise(r => setTimeout(r, 3000));
                      } },
                ],
            },
            {
                msg: '6. 改变负载电阻(300Ω)，观察输出电压变化',
                mode: 'check',
                check() {
                    const rl = this.sys.comps['rl'];
                    return rl && Math.abs(rl.currentResistance - 300) < 0.1;
                },
                op: [
                    { type: 'observe', target: 'rl', msg: '右键负载电阻 → 参数设置，打开参数配置界面',
                      async act() {
                          await _demoSetConfig(this, 'rl', 'currentResistance', 300, '请将阻值改为 300Ω');
                      } },
                    { type: 'observe', target: 'multimeter', msg: '观察万用表读数：稳压器输出仍保持约 +5V 基本不变',
                      async act() {
                          await new Promise(r => setTimeout(r, 3000));
                      } },
                ],
            },
            {
                msg: '7. 测试题：三端稳压器的作用',
                mode: 'quiz',
                quizConfig: {
                    question: '三端稳压器（如 7805）在本电路中的作用是什么？',
                    options: [
                        '将交流电整流为直流电',
                        '将不稳定的直流电压稳压为稳定的 +5V 输出',
                        '放大电路中的电压信号',
                        '将直流电逆变为交流电',
                    ],
                    answer: 1,
                    analysis: '7805 是固定输出 +5V 的三端稳压器。无论输入电压或负载怎样变化，它都能将输出电压稳定在 +5V，保证负载端电压基本不变。',
                },
            },
        ],
    },    
};

export const componentConfigs = [
    { Class: ACPower, id: 'ac', x: 10, y: 110, vRms: 220, freq: 50, isOn: false },
    { Class: SinglePhaseFuse, id: 'fu', x: 230, y: 280, rotation: -90 },
    { Class: RealControlTransformer, id: 'tr', x: 390, y: 230, primaryVoltage: 220, secondaryVoltage: 12 },
    { Class: Ground, id: 'gnd1', x: 100, y: 430 },

    { Class: Diode, id: 'd1', x: 780, y: 260, rotation: -90 },
    { Class: Diode, id: 'd2', x: 860, y: 260, rotation: -90 },
    { Class: Diode, id: 'd3', x: 780, y: 420, rotation: -90 },
    { Class: Diode, id: 'd4', x: 860, y: 420, rotation: -90 },

    { Class: Capacitor, id: 'c1', x: 970, y: 280, subtype: 'el', capacitance: 47, leak: 10000 },
    { Class: IC7805, id: 'reg', x: 1090, y: 230 },
    { Class: Capacitor, id: 'c2', x: 1210, y: 280, subtype: 'el', capacitance: 22, },

    { Class: Resistor, id: 'rl', x: 1320, y: 280, value: 200, rotation: 90 },

    { Class: Ground, id: 'gnd2', x: 1100, y: 420 },

    { Class: Multimeter, id: 'multimeter', x: 1160, y: 420, visible: false },
    { Class: MF47Multimeter, id: 'mf47-panel', x: 50, y: 50, visible: false },
    { Class: Oscilloscope_tri, id: 'osc', x: 50, y: 50, visible: false },
    { Class: SignalGenerator, id: 'sg', x: 50, y: 50, visible: false },
    { Class: ProcessCalibrator, id: 'cali', x: 50, y: 50, visible: false },
    { Class: ElecMeter, id: 'elecmeter', x: 50, y: 50, visible: false },
];

function _autoWire(sys) {
    sys.conns.length = 0;
    const cons = [
        { from: 'ac_wire_p', to: 'fu_wire_l', type: 'wire' },
        { from: 'fu_wire_t', to: 'tr_wire_p1', type: 'wire' },
        { from: 'ac_wire_n', to: 'gnd1_wire_gnd', type: 'wire' },
        { from: 'tr_wire_p2', to: 'gnd1_wire_gnd', type: 'wire' },

        { from: 'tr_wire_s1', to: 'd1_wire_l', type: 'wire' },
        { from: 'd1_wire_l', to: 'd3_wire_r', type: 'wire' },
        { from: 'tr_wire_s2', to: 'd2_wire_l', type: 'wire' },
        { from: 'd2_wire_l', to: 'd4_wire_r', type: 'wire' },

        { from: 'd1_wire_r', to: 'd2_wire_r', type: 'wire' },
        { from: 'd2_wire_r', to: 'c1_wire_l', type: 'wire' },
        { from: 'd3_wire_l', to: 'd4_wire_l', type: 'wire' },
        { from: 'd4_wire_l', to: 'c1_wire_r', type: 'wire' },

        { from: 'c1_wire_r', to: 'gnd2_wire_gnd', type: 'wire' },
        { from: 'c1_wire_l', to: 'reg_wire_in', type: 'wire' },

        { from: 'reg_wire_out', to: 'c2_wire_l', type: 'wire' },
        { from: 'c2_wire_r', to: 'gnd2_wire_gnd', type: 'wire' },
        { from: 'reg_wire_gnd', to: 'gnd2_wire_gnd', type: 'wire' },

        { from: 'c2_wire_l', to: 'rl_wire_l', type: 'wire' },
        { from: 'rl_wire_r', to: 'c2_wire_r', type: 'wire' },
    ];
    cons.forEach(c => sys.connMgr.addConn(c));
    sys.redrawAll();
}

function _hasConn(sys, a, b) {
    return sys.conns.some(c => (c.from === a && c.to === b) || (c.from === b && c.to === a));
}

/** 动画接线（约 3s/根，用于自动演示中少于 6 根的逐根接线） */
async function _addAnim(sys, from, to) {
    await sys.connMgr.addConnectionAnimated({ from, to, type: 'wire' });
}

/**
 * 示波器自动调档：按当前实测电压幅值为指定通道选最小档位，使波形完整充满屏幕（≈4 格）。
 * 演示过程：闪烁箭头指向该通道「CHx档」按钮 → 模拟逐次接地按档钮到目标档位 → 停留观察波形。
 * @param {object} wf Workflow 实例（op 的 this）
 * @param {number[]} chIdxs 需要调档的通道索引（0=CH1, 1=CH2, 2=CH3）
 * @param {string} tip 提示文字
 */
async function _autoRangeOsc(wf, chIdxs, tip) {
    const sys = wf.sys;
    const osc = sys.comps['osc'];
    const s = sys.voltageSolver;
    if (!osc || !s) return;
    const ports = [['ch1p', 'ch1n'], ['ch2p', 'ch2n'], ['ch3p', 'ch3n']];

    for (const i of chIdxs) {
        // ① 按实测端口电压幅值选档：取使峰值 ≤4 格的最小档位（屏内可用约 ±5 格）
        const [p, n] = ports[i];
        const cp = s.portToCluster.get(`osc_wire_${p}`);
        const cn = s.portToCluster.get(`osc_wire_${n}`);
        const peak = Math.abs((s.nodeVoltages.get(cp) || 0) - (s.nodeVoltages.get(cn) || 0)) || 0;
        let target = osc.vScales.length - 1;
        for (let k = 0; k < osc.vScales.length; k++) {
            if (peak / osc.vScales[k] <= 4) { target = k; break; }
        }
        const ch = osc.channels[i];
        if (target === ch.vIdx) continue;

        // ② 箭头指向该通道档位按钮（面板圈内位置经组件绝对变换换算到画布）
        const btnPt = osc.group.getAbsoluteTransform().point({ x: -180 + i * 60, y: 135 });
        if (wf._flashArrow) {
            await wf._flashArrow({ x: btnPt.x, y: btnPt.y }, { on: 500, off: 350, times: 2 });
        }
        // ③ 模拟逐次点按档位钮前进到目标档位
        while (ch.vIdx !== target) {
            ch.vIdx = (ch.vIdx + 1) % osc.vScales.length;
            osc.updateStatus();
            osc.markDirty?.(); osc._refreshIfDirty?.();
            if (typeof sys.requestRedraw === 'function') sys.requestRedraw();
            await new Promise(r => setTimeout(r, 700));
        }
    }
    // ④ 停留约 3.5s 让波形按新档位完整展示后再进入下一步
    await new Promise(r => setTimeout(r, 3500));
}

/**
 * 打开组件参数配置对话框，动态演示参数调整过程并自动保存：
 * ① 弹出对话框（箭头/提示已由 op 指示完成）→ ② 高亮目标参数输入框并填入新值 →
 * ③ 高亮「保存」按钮并点击确认。
 * @param {object} wf Workflow 实例（op 的 this）
 * @param {string} compId 组件 id
 * @param {string} key 配置字段 key（输入框 id 为 diag_${key}）
 * @param {number|string} value 要填入的参数新值
 * @param {string} tip 提示文字
 */
async function _demoSetConfig(wf, compId, key, value, tip) {
    const comp = wf.sys.comps[compId];
    if (!comp) return;
    // ⓪ 弹框前把组件实时属性同步进 config 副本（对话框无 getter 的字段直接读 config），
    //    否则「保存」会把 config 里的旧值（如交流电源的 isOn=false）一起写回，导致电源被关闭
    (comp.getConfigFields() || []).forEach(f => {
        if (f.get) return;
        try { const live = comp[f.key]; if (live !== undefined) comp.config[f.key] = live; } catch (e) { /* 忽略只读属性 */ }
    });
    comp.showConfigDialog();                          // ① 弹出参数设置界面
    await new Promise(r => setTimeout(r, 600));
    const input = document.getElementById('diag_' + key);
    const modal = input ? input.closest('div[style*="position: fixed"]') : null;
    if (input) {
        // ② 高亮目标参数输入框，模拟填写新值
        await wf._flashDomElement(input, tip || `请将该参数改为 ${value}`, 2400);
        input.value = value;
    }
    if (modal) {
        // ③ 高亮「保存」按钮并点击确认
        const saveBtn = [...modal.querySelectorAll('button')].find(b => b.textContent.indexOf('保存') !== -1);
        if (saveBtn) {
            await wf._flashDomElement(saveBtn, '点击「保存」确认参数修改', 1800);
            saveBtn.click();
        }
    }
    await new Promise(r => setTimeout(r, 400));
}

function _disconnectOsc(sys) {
    const ports = ['osc_wire_ch1p', 'osc_wire_ch1n', 'osc_wire_ch2p', 'osc_wire_ch2n', 'osc_wire_ch3p', 'osc_wire_ch3n'];
    const existing = sys.conns.filter(c => ports.includes(c.from) || ports.includes(c.to));
    existing.forEach(c => sys.connMgr.removeConn(c));
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
}

export function fiveStep() { }
