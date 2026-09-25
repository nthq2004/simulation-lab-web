// 空白仿真工程，仅保留 7 种仪表（隐藏），并加入电位端子演示电路元件

import { Multimeter } from '../components/Multimeter.js';
import { MF47Multimeter } from '../components/MF47Multimeter.js';
import { Oscilloscope_tri } from '../components/Osc_tri.js';
import { SignalGenerator } from '../components/SignalGenerator.js';
import { ProcessCalibrator } from '../components/ProcessCalibrator.js';
import { ElecMeter } from '../components/ElecMeter.js';
import { RealMegohmMeter } from '../components/RealMegohmMeter.js';
import { PotentialTerminal } from '../components/PotentialTerminal.js';
import { Ground } from '../components/Gnd.js';
import { Transistor } from '../components/Transistor.js';
import { Resistor } from '../components/Resistor.js';
import { SolenoidValve } from '../components/SolenoidValve.js';
import { DiagramStartButton } from '../components/DiagramStartButton.js';
import { Switch } from '../components/Switch.js';

export const FAULT_CONFIGS = {};

export const PROJECT_WORKFLOWS = {

    'sv-drive': {
        id: 'sv-drive',
        name: '1. 电磁阀驱动电路分析',
        steps: [
            {
                msg: '1. 控制回路接线：3V 电源 (pt2) → 开关 SB → 限流电阻 RL (1kΩ) → 三极管基极。',
                mode: 'check',
                op: [
                    { type: 'observe', target: 'pt2', msg: '从 3V 电位端子引出导线',
                      async act() { await _addAnim(this.sys, 'pt2_wire_p', 'sb_wire_l'); } },
                    { type: 'observe', target: 'sb', msg: '经开关 SB 右端引出导线',
                      async act() { await _addAnim(this.sys, 'sb_wire_r', 'rl_wire_l'); } },
                    { type: 'observe', target: 'rl', msg: '经限流电阻接到三极管基极',
                      async act() { await _addAnim(this.sys, 'rl_wire_r', 'q1_wire_b'); } },
                ],
                check() {
                    const c = this.sys.conns;
                    return _hasConn(c, 'pt2_wire_p', 'sb_wire_l')
                        && _hasConn(c, 'sb_wire_r', 'rl_wire_l')
                        && _hasConn(c, 'rl_wire_r', 'q1_wire_b');
                },
            },
            {
                msg: '2. 主回路接线：24V 电源 (pt1) → 电磁阀线圈 → 三极管 C-E → 接地。',
                mode: 'check',
                op: [
                    { type: 'observe', target: 'pt1', msg: '从 24V 电位端子引出导线',
                      async act() { await _addAnim(this.sys, 'pt1_wire_p', 'sv_wire_a'); } },
                    { type: 'observe', target: 'sv', msg: '线圈下端口接到三极管集电极',
                      async act() { await _addAnim(this.sys, 'sv_wire_b', 'q1_wire_c'); } },
                    { type: 'observe', target: 'q1', msg: '发射极接地',
                      async act() { await _addAnim(this.sys, 'q1_wire_e', 'gnd1_wire_gnd'); } },
                ],
                check() {
                    const c = this.sys.conns;
                    return _hasConn(c, 'pt1_wire_p', 'sv_wire_a')
                        && _hasConn(c, 'sv_wire_b', 'q1_wire_c')
                        && _hasConn(c, 'q1_wire_e', 'gnd1_wire_gnd');
                },
            },
            {
                msg: '3. 调出数字万用表，打到直流 200V 档，测量三极管 C、E 之间的电压（开关未合，管子截止）。',
                mode: 'check',
                op: [
                    { type: 'observe', target: 'multimeter', msg: '通过【选择仪表】面板调出数字万用表',
                      async act() { await _openMeterByPanel(this); } },
                    { type: 'observe', target: 'multimeter', msg: '先指向 200V 档，逐档转动档位开关到直流 200V 档',
                      async act() { await _turnToDCV200(this); } },
                    { type: 'observe', target: 'q1', msg: '红表笔接集电极、黑表笔接发射极，观察读数后断开',
                      async act() {
                          await _addAnim(this.sys, 'multimeter_wire_v', 'q1_wire_c');
                          await _addAnim(this.sys, 'multimeter_wire_com', 'q1_wire_e');
                          await new Promise(r => setTimeout(r, 4000));
                          _disconnectMM(this.sys);
                          this.sys.redrawAll();
                      } },
                ],
                check() {
                    const mm = this.sys.comps['multimeter'];
                    const c = this.sys.conns;
                    return mm && mm.group && mm.group.visible() && mm.mode === 'DCV200'
                        && !_hasConn(c, 'multimeter_wire_v', 'q1_wire_c');
                },
            },
            {
                msg: '4. 填空题：三极管 Vce=(  ) V，此时处于（  ）状态。',
                mode: 'fill',
                fields: [
                    { label: '三极管 Vce', unit: 'V', answer: 24 },
                    { label: '工作状态', answer: '截止' },
                ],
            },
            {
                msg: '5. 合上基极开关 SB，三极管饱和导通，线圈电流约 48mA＞30mA，电磁阀吸合。',
                mode: 'check',
                op: [
                    { type: 'switch', target: 'sb', msg: '点击开关 SB 使其闭合（合）',
                      async act() {
                          const sb = this.sys.comps['sb'];
                          if (sb) sb.toggle();
                          await new Promise(r => setTimeout(r, 3000));
                      } },
                ],
                check() {
                    const sb = this.sys.comps['sb'];
                    return sb && sb.isOn;
                },
            },
            {
                msg: '6. 再次用万用表直流 200V 档测量三极管 C、E 之间的电压，观察读数后断开接线。',
                mode: 'check',
                op: [
                    { type: 'observe', target: 'q1', msg: '红表笔接集电极、黑表笔接发射极，观察读数后断开',
                      async act() {
                          await _addAnim(this.sys, 'multimeter_wire_v', 'q1_wire_c');
                          await _addAnim(this.sys, 'multimeter_wire_com', 'q1_wire_e');
                          await new Promise(r => setTimeout(r, 4000));
                          _disconnectMM(this.sys);
                          this.sys.redrawAll();
                      } },
                ],
                check() {
                    const c = this.sys.conns;
                    return !_hasConn(c, 'multimeter_wire_v', 'q1_wire_c');
                },
            },
            {
                msg: '7. 填空题：三极管 Vce=(  ) V，此时处于（  ）状态。',
                mode: 'fill',
                fields: [
                    { label: '三极管 Vce', unit: 'V', answer: 0.1 },
                    { label: '工作状态', answer: '饱和' },
                ],
            },
            {
                msg: '8. 填空题：三极管处于饱和状态的条件是：发射结（  ），集电结（  ）。',
                mode: 'fill',
                fields: [
                    { label: '发射结', answer: '正偏' },
                    { label: '集电结', answer: '正偏' },
                ],
            },
        ],
    },
};

export const componentConfigs = [
    // 电位端子 ×2（替代直流电源：24V 主电路 / 3V 基极）
    { Class: PotentialTerminal, id: 'pt1', x: 900, y: 200, potential: 24 },
    { Class: PotentialTerminal, id: 'pt2', x: 300, y: 550, potential: 3 },

    // 地
    { Class: Ground, id: 'gnd1', x: 890, y: 760 },

    // 三极管符号（NPN）
    { Class: Transistor, id: 'q1', x: 870, y: 575 },

    // 电阻符号（水平放置，串入基极支路）
    { Class: Resistor, id: 'rl', x: 632, y: 580, value: 1000 },

    // 单级开关符号（串入基极支路，点击切换分/合）
    { Class: Switch, id: 'sb', x: 435, y: 570 },

    // 电磁阀（线圈串入集电极主回路）
    { Class: SolenoidValve, id: 'sv', x: 960, y: 340, scale: 1 },

    { Class: Multimeter, id: 'multimeter', x: 1120, y: 300, visible: false },
    { Class: MF47Multimeter, id: 'mf47-panel', x: 50, y: 50, visible: false },
    { Class: Oscilloscope_tri, id: 'osc', x: 50, y: 50, visible: false },
    { Class: SignalGenerator, id: 'sg', x: 50, y: 50, visible: false },
    { Class: ProcessCalibrator, id: 'cali', x: 50, y: 50, visible: false },
    { Class: ElecMeter, id: 'elecmeter', x: 50, y: 50, visible: false },
    { Class: RealMegohmMeter, id: 'megohm', x: 50, y: 50, visible: false },
];

export function initSlider(_sys) { }

/** 箭头先行：闪烁箭头指向组件中心后再执行动作 */
async function _flashTo(wf, compId) {
    const comp = wf.sys.comps[compId];
    if (!comp) return;
    if (wf._compCenter && wf._flashArrow) {
        await wf._flashArrow(wf._compCenter(comp), { on: 500, off: 350, times: 3 });
    } else {
        comp.highlight && comp.highlight(true);
        await new Promise(r => setTimeout(r, 1500));
        comp.highlight && comp.highlight(false);
    }
}

async function _addAnim(sys, from, to) {
    await sys.connMgr.addConnectionAnimated({ from, to, type: 'wire' });
}

/** 通过通用"选择仪表"面板调出数字万用表：每个动作前红虚线框框选 + 箭头指示 */
async function _openMeterByPanel(wf) {
    const flash = (id, msg) => wf._flashDomElement
        ? wf._flashDomElement(document.getElementById(id), msg, 2500)
        : Promise.resolve();

    // 1) 红虚线框选中"选择仪表"按钮 + 箭头 → 点击
    await flash('btnInstrument', '点击工具栏【选择仪表】');
    const btn = document.getElementById('btnInstrument');
    if (btn) { btn.click(); }
    await new Promise(r => setTimeout(r, 2000));   // 停约2s看清面板

    // 2) 红虚线框选中"数字万用表"复选框 + 箭头 → 勾选（触发 change → toggleInstrumentVisibility）
    const cb = document.getElementById('instr_multimeter');
    await flash('instr_multimeter', '勾选【数字万用表】');
    if (cb && !cb.checked) {
        cb.checked = true;
        cb.dispatchEvent(new Event('change', { bubbles: true }));
    }
    await new Promise(r => setTimeout(r, 2000));   // 停约2s看清勾选生效

    // 3) 红虚线框选中"关闭"按钮 + 箭头 → 关闭面板
    await flash('instrumentCancelBtn', '点击【关闭】');
    const close = document.getElementById('instrumentCancelBtn');
    if (close) close.click();
    await new Promise(r => setTimeout(r, 1000));
}

/** 数字万用表 200V 档刻度的画布坐标（箭头定位用） */
function _dcv200TickPos(wf) {
    const mm = wf.sys.comps['multimeter'];
    if (!mm) return null;
    const c = mm.getClickablePartCenter('knob');
    if (!c) return null;
    const scale = mm.scale || 1;
    const radius = Math.min(110 * scale, Math.max(40 * scale, Math.floor(mm.width / 3)));
    // 200V 档刻度位于旋钮正左方（draw 时 rad = angle-90 → -180°）
    return { x: c.x - radius, y: c.y, mm };
}

/** 箭头指向 200V 档刻度 → 分 3 步（每步 30°、间隔 0.5s）把档位开关旋到直流 200V 档 */
async function _turnToDCV200(wf) {
    const tick = _dcv200TickPos(wf);
    const sys = wf.sys;
    const mm = sys && sys.comps['multimeter'];
    if (!mm || !tick) return;
    // 先闪烁箭头指向 200V 档刻度
    if (wf._flashArrow) {
        await wf._flashArrow(tick, { on: 500, off: 350, times: 3 });
    }
    // 再逐档转动旋钮：0 → -30(DCVmv) → -60(DCV20) → -90(DCV200)
    for (let r = -30; r >= -90; r -= 30) {
        mm.pointer.rotation(r);
        if (typeof mm._updateModeByAngle === 'function') mm._updateModeByAngle(r);
        mm.markDirty();
        mm._refreshIfDirty();
        if (typeof sys.requestRedraw === 'function') sys.requestRedraw();
        await new Promise(resp => setTimeout(resp, 500));
    }
    sys.redrawAll();
}

/** 万用表打到 DCV200，红表笔接集电极、黑表笔接发射极，等待读数稳定 */
async function _measureCE(wf) {
    const sys = wf.sys;
    const mm0 = sys.comps['multimeter'];
    // 万用表已显示时不再点击"选择仪表"
    const alreadyVisible = mm0 && mm0.group && mm0.group.visible();
    if (!alreadyVisible) {
        await _openMeterByPanel(wf);
    } else {
        await _flashTo(wf, 'multimeter');
    }
    // 先指向 200V 档，再转动档位开关
    await _turnToDCV200(wf);
    await _flashTo(wf, 'q1');
    await _addAnim(sys, 'multimeter_wire_v', 'q1_wire_c');
    await _flashTo(wf, 'q1');
    await _addAnim(sys, 'multimeter_wire_com', 'q1_wire_e');
    // 等读数稳定
    await new Promise(r => setTimeout(r, 4000));
}

/** 断开万用表接线并收起表笔 */
function _disconnectMM(sys) {
    const ports = ['multimeter_wire_v', 'multimeter_wire_com'];
    const existing = sys.conns.filter(c => ports.includes(c.from) || ports.includes(c.to));
    existing.forEach(c => sys.connMgr.removeConn(c));
}

function _autoWire(sys) {
    sys.conns.length = 0;
    const cons = [
        // 主回路：24V → 电磁阀线圈 → 集电极
        { from: 'pt1_wire_p', to: 'sv_wire_a', type: 'wire' },
        { from: 'sv_wire_b', to: 'q1_wire_c', type: 'wire' },
        // 基极支路：3V → 按钮 → 电阻 → 基极
        { from: 'pt2_wire_p', to: 'sb_wire_l', type: 'wire' },
        { from: 'sb_wire_r', to: 'rl_wire_l', type: 'wire' },
        { from: 'rl_wire_r', to: 'q1_wire_b', type: 'wire' },
        // 发射极接地
        { from: 'q1_wire_e', to: 'gnd1_wire_gnd', type: 'wire' },
    ];
    cons.forEach(c => sys.connMgr.addConn(c));
    sys.redrawAll();
}

export function applyAllPresets() {
    const sys = this && this.sys ? this.sys : window.sys;
    if (!sys) return;
    _autoWire(sys);
}

export function applyStartSystem() {
    const sys = this && this.sys ? this.sys : window.sys;
    if (!sys) return;
    _autoWire(sys);
}

function _hasConn(conns, a, b) {
    return conns.some(c => (c.from === a && c.to === b) || (c.from === b && c.to === a));
}

export function fiveStep() { }
