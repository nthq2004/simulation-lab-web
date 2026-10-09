import { ACPower } from '../components/ACPower.js';
import { JSZ3N } from '../components/JSZ3N.js';
import { JSZ3 } from '../components/JSZ3.js';
import { Multimeter } from '../components/Multimeter.js';
import { MF47Multimeter } from '../components/MF47Multimeter.js';
import { Oscilloscope_tri } from '../components/Osc_tri.js';
import { SignalGenerator } from '../components/SignalGenerator.js';
import { ProcessCalibrator } from '../components/ProcessCalibrator.js';
import { ElecMeter } from '../components/ElecMeter.js';
import { RealMegohmMeter } from '../components/RealMegohmMeter.js';

export const FAULT_CONFIGS = {};

// ═══════════════════════════════════════════════════════════════
// 时间继电器延时测试工程
//   tz  = JSZ3  通电延时型时间继电器（0~30s 可调）
//   tzn = JSZ3N 断电延时型时间继电器（0~30s 可调）
//   工具栏「断电延时」复选框在两者间切换显示；切换时隐藏方连线移除、显示方连线恢复。
// ═══════════════════════════════════════════════════════════════

// ─── 通用辅助 ────────────────────────────────────────────────

/** 无向判断两端口是否已连线 */
function _hasConn(sys, a, b) {
    return sys.conns.some(c => (c.from === a && c.to === b) || (c.from === b && c.to === a));
}

/** 动画接线（约 3s/根，用于自动演示逐根接线） */
async function _wireAnimated(sys, from, to) {
    if (_hasConn(sys, from, to)) return;
    await sys.connMgr.addConnectionAnimated({ from, to, type: 'wire' });
}

/** 清空全部连线（演示前先清理，避免残留悬空连线） */
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

/** 接通/断开交流电源（电压频率保持 220V/50Hz，仅切换开关） */
function _setPower(sys, on) {
    const ac = sys.comps['ac'];
    if (ac) ac.onConfigUpdate({ vRms: 220, freq: 50, isOn: !!on });
    sys.redrawAll();
}

/**
 * 通过参数配置界面动态演示参数修改：弹出对话框 → 高亮输入框并填值 → 高亮「保存」并点击。
 */
async function _demoSetConfig(wf, compId, key, value, tip) {
    const comp = wf.sys.comps[compId];
    if (!comp || typeof comp.showConfigDialog !== 'function') return;
    // 弹框前把实时属性同步进 config 副本，避免「保存」把旧值回写
    (comp.getConfigFields ? comp.getConfigFields() : []).forEach(f => {
        if (f.get) return;
        try { const live = comp[f.key]; if (live !== undefined) comp.config[f.key] = live; } catch (e) { /* 只读属性忽略 */ }
    });
    comp.showConfigDialog();                          // ① 弹出参数设置界面
    await new Promise(r => setTimeout(r, 600));
    const input = document.getElementById('diag_' + key);
    const modal = input ? input.closest('div[style*="position: fixed"]') : null;
    if (input) {
        await wf._flashDomElement(input, tip || `请将该参数改为 ${value}`, 2400);   // ② 高亮输入框并填值
        input.value = value;
    }
    if (modal) {
        const saveBtn = [...modal.querySelectorAll('button')].find(b => b.textContent.indexOf('保存') !== -1);
        if (saveBtn) {
            await wf._flashDomElement(saveBtn, '点击「保存」确认参数修改', 1800);       // ③ 高亮保存并点击
            saveBtn.click();
        }
    }
    await new Promise(r => setTimeout(r, 400));
}

/** 时间继电器显隐模式（true=显示 JSZ3N、隐藏 JSZ3；false 反之），并同步工具栏复选框 */
function _setTZNMode(on) {
    const sys = window.sys;
    const cb = document.getElementById('chkShowTZN');
    if (cb) cb.checked = !!on;
    if (typeof window.applyShowTZN === 'function') {
        window.applyShowTZN();
    } else if (sys && sys.comps) {
        const tzn = sys.comps['tzn'];
        const tz = sys.comps['tz'];
        if (tzn && tzn.group) tzn.group.visible(!!on);
        if (tz && tz.group) tz.group.visible(!on);
    }
}

/** 演示前的公共 op：确认处于通电延时模式（显示 JSZ3、隐藏 JSZ3N） */
function _opEnsureTZ() {
    return {
        type: 'instrument', checkbox: 'chkShowTZN', checkState: false,
        msg: '确认工具栏「断电延时」复选框未勾选，画面显示通电延时继电器 JSZ3',
        async act() { _setTZNMode(false); },
    };
}

/** 演示前的公共 op：确认处于断电延时模式（显示 JSZ3N、隐藏 JSZ3） */
function _opEnsureTZN() {
    return {
        type: 'instrument', checkbox: 'chkShowTZN', checkState: true,
        msg: '勾选工具栏「断电延时」复选框，画面切换到断电延时继电器 JSZ3N（JSZ3 自动隐藏）',
        async act() { _setTZNMode(true); },
    };
}

/** 时间继电器线圈接线 + 通电的公共 op 组（端子 2/7 接电源 N/P） */
function _coilWiringOps(relayId, relayName) {
    return [
        { type: 'observe', target: 'ac', part: 'p',
          msg: `电源正端 P → ${relayName} 端子 7（线圈右端）`,
          async act() {
              _clearConns(this.sys);
              await _wireAnimated(this.sys, 'ac_wire_p', `${relayId}_wire_r`);
          } },
        { type: 'observe', target: 'ac', part: 'n',
          msg: `电源负端 N → ${relayName} 端子 2（线圈左端）`,
          async act() { await _wireAnimated(this.sys, 'ac_wire_n', `${relayId}_wire_l`); } },
        { type: 'switch', target: 'ac', part: 'power',
          msg: '按下交流电源面板上的「电源」按钮，接通 220V/50Hz 电源',
          async act() {
              _setPower(this.sys, true);
              await new Promise(r => setTimeout(r, 1500));
          } },
    ];
}

// ═══════════════════════════════════════════════════════════════
// 工作流定义
// ═══════════════════════════════════════════════════════════════

export const PROJECT_WORKFLOWS = {
    'time-delay-test': {
        id: 'time-delay-test',
        name: '1. 通电延时继电器（JSZ3）延时操作',
        steps: [
            {
                msg: '第 1 步：把单相交流电源接入 JSZ3 时间继电器线圈（正端 P→端子 7、负端 N→端子 2），然后按下电源按钮通电，线圈得电开始计时。',
                mode: 'check',
                check() {
                    const tz = this.sys.comps['tz'];
                    const ac = this.sys.comps['ac'];
                    const c = (a, b) => this.sys.isPortConnected(a, b);
                    return ac && ac.isOn
                        && tz && (tz._state === 'timing' || tz._state === 'output')
                        && c('ac_wire_p', 'tz_wire_r')
                        && c('ac_wire_n', 'tz_wire_l');
                },
                op: [
                    _opEnsureTZ(),
                    ..._coilWiringOps('tz', 'JSZ3'),
                ],
            },
            {
                msg: '第 2 步：线圈持续得电，观察面板指示灯闪烁（计时中）；延时到达后 OUTPUT 指示灯常亮，常开触头（6-8、1-3）闭合、常闭触头（5-8、1-4）断开。',
                mode: 'check',
                check() {
                    const tz = this.sys.comps['tz'];
                    return tz && tz._state === 'output';
                },
                op: [
                    { type: 'observe', target: 'tz', part: 'led-power',
                      msg: '观察电源指示灯：线圈得电，红色指示灯闪烁表示正在计时',
                      async act() { await new Promise(r => setTimeout(r, 2000)); } },
                    { type: 'observe', target: 'tz', part: 'led-output',
                      msg: '等待延时到达：OUTPUT 指示灯由闪烁转为常亮，触头动作（可由万用表进一步验证）',
                      async act() {
                          const tz = this.sys.comps['tz'];
                          const wait = tz ? (tz.delayTime * 1000 + 1500) : 12000;
                          await new Promise(r => setTimeout(r, wait));
                      } },
                ],
            },
            {
                msg: '第 3 步：断开电源，时间继电器立即复位。观察 OUTPUT 指示灯熄灭，触头恢复初始状态（NC 闭合、NO 断开）。',
                mode: 'check',
                check() {
                    const tz = this.sys.comps['tz'];
                    const ac = this.sys.comps['ac'];
                    return ac && !ac.isOn && tz && tz._state === 'idle';
                },
                op: [
                    { type: 'switch', target: 'ac', part: 'power',
                      msg: '再次按下电源按钮，断开电源',
                      async act() {
                          _setPower(this.sys, false);
                          await new Promise(r => setTimeout(r, 1500));
                      } },
                    { type: 'observe', target: 'tz', part: 'led-output',
                      msg: '观察 OUTPUT 指示灯熄灭，触头复位（NC 闭合、NO 断开）',
                      async act() { await new Promise(r => setTimeout(r, 1800)); } },
                ],
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
                msg: '第 5 步：通过参数设置界面把延时时间由 15s 改为 5s，重新接通电源，再次观察延时过程。',
                mode: 'check',
                check() {
                    const tz = this.sys.comps['tz'];
                    return tz && tz._state === 'output' && Math.abs(tz.delayTime - 5) < 0.01;
                },
                op: [
                    { type: 'observe', target: 'tz', part: 'dial',
                      msg: '右键时间继电器 →「参数设置」，把「延时时间 (s)」改为 5',
                      async act() { await _demoSetConfig(this, 'tz', 'delayTime', 5, '将「延时时间 (s)」改为 5'); } },
                    { type: 'switch', target: 'ac', part: 'power',
                      msg: '重新按下电源按钮，观察 5s 延时到达后 OUTPUT 指示灯点亮',
                      async act() {
                          _setPower(this.sys, true);
                          await new Promise(r => setTimeout(r, 5000 + 1500));
                      } },
                ],
            },
        ],
    },

    'multimeter-test': {
        id: 'multimeter-test',
        name: '2. 用万用表检测时间继电器触头',
        steps: [
            {
                msg: '第 1 步：调出数字万用表并拨到 200Ω 电阻档，测量 JSZ3 常闭触头（端子 5-8）电阻，正常应接近 0Ω。',
                mode: 'check',
                check() {
                    const mm = this.sys.comps['multimeter'];
                    const c = (a, b) => this.sys.isPortConnected(a, b);
                    return mm && mm.mode === 'RES200'
                        && c('multimeter_wire_v', 'tz_wire_nc_a')
                        && c('multimeter_wire_com', 'tz_wire_com_a')
                        && mm.value < 1;
                },
                op: [
                    _opEnsureTZ(),
                    { type: 'instrument', instrument: 'multimeter', target: 'multimeter',
                      msg: '通过工具栏【选择仪表】面板勾选，调出数字万用表',
                      async act() {
                          const mm = this.sys.comps['multimeter'];
                          if (mm && mm.group) mm.group.visible(true);
                          this.sys.redrawAll();
                          await new Promise(r => setTimeout(r, 800));
                      } },
                    { type: 'observe', target: 'multimeter', part: 'knob',
                      msg: '把万用表档位开关拨到 200Ω 电阻档',
                      async act() {
                          const mm = this.sys.comps['multimeter'];
                          if (mm) { mm.mode = 'RES200'; mm._updateAngleByMode?.(); }
                          this.sys.redrawAll();
                          await new Promise(r => setTimeout(r, 1200));
                      } },
                    { type: 'observe', target: 'tz', part: 'nc',
                      msg: '红表笔接端子 5（NC）、黑表笔接端子 8（COM），测量常闭触头电阻',
                      async act() {
                          _clearConns(this.sys);
                          await _wireAnimated(this.sys, 'multimeter_wire_v', 'tz_wire_nc_a');
                          await _wireAnimated(this.sys, 'multimeter_wire_com', 'tz_wire_com_a');
                          await new Promise(r => setTimeout(r, 1200));
                      } },
                ],
            },
            {
                msg: '第 2 步：接线并接通电源，延时到达后 NC 触头断开（显示 O.L）；把红表笔移到端子 6（NO），NO 触头闭合（读数接近 0Ω）。',
                mode: 'check',
                check() {
                    const tz = this.sys.comps['tz'];
                    const mm = this.sys.comps['multimeter'];
                    return tz && tz._state === 'output'
                        && mm && mm.mode === 'RES200'
                        && mm.value < 1;
                },
                op: [
                    { type: 'observe', target: 'ac', part: 'p',
                      msg: '接通电源前，先把交流电源正端 P 接到 JSZ3 端子 7',
                      async act() { await _wireAnimated(this.sys, 'ac_wire_p', 'tz_wire_r'); } },
                    { type: 'observe', target: 'ac', part: 'n',
                      msg: '交流电源负端 N 接到 JSZ3 端子 2',
                      async act() { await _wireAnimated(this.sys, 'ac_wire_n', 'tz_wire_l'); } },
                    { type: 'switch', target: 'ac', part: 'power',
                      msg: '按下电源按钮接通电源，线圈得电开始计时',
                      async act() {
                          _setPower(this.sys, true);
                          await new Promise(r => setTimeout(r, 1500));
                      } },
                    { type: 'observe', target: 'tz', part: 'no',
                      msg: '延时到达后：NC（5-8）断开→万用表显示 O.L；把红表笔移到端子 6（NO），NO（6-8）闭合→读数接近 0Ω',
                      async act() {
                          const tz = this.sys.comps['tz'];
                          const wait = tz ? (tz.delayTime * 1000 + 1500) : 12000;
                          await new Promise(r => setTimeout(r, wait));
                          _disconnectPort(this.sys, 'multimeter_wire_v');
                          await _wireAnimated(this.sys, 'multimeter_wire_v', 'tz_wire_no_a');
                          await new Promise(r => setTimeout(r, 1200));
                      } },
                ],
            },
            {
                msg: '第 3 步：时间继电器触头知识',
                mode: 'quiz',
                quizConfig: {
                    question: '通电延时型时间继电器（JSZ3）的常开（NO）、常闭（NC）触头，在延时到达后的状态是：',
                    options: [
                        '常开触头闭合、常闭触头断开',
                        '常开触头断开、常闭触头闭合',
                        '常开、常闭触头都闭合',
                        '常开、常闭触头都断开',
                    ],
                    answer: 0,
                    analysis: '通电延时型时间继电器在线圈得电后开始计时，延时到达时触头动作：常开（NO）触头闭合、常闭（NC）触头断开；线圈失电则立即复位。',
                },
            },
        ],
    },

    'off-delay-test': {
        id: 'off-delay-test',
        name: '3. 断电延时继电器（JSZ3N）功能测试',
        steps: [
            {
                msg: '第 1 步：勾选工具栏「断电延时」复选框，画面切换到 JSZ3N（JSZ3 自动隐藏且连线移除）。将单相交流电源接入 JSZ3N 线圈（端子 2、7），通电后继电器瞬时输出，触点切换至 NO。',
                mode: 'check',
                check() {
                    const tzn = this.sys.comps['tzn'];
                    const ac = this.sys.comps['ac'];
                    const c = (a, b) => this.sys.isPortConnected(a, b);
                    return ac && ac.isOn
                        && tzn && tzn._state === 'output'
                        && c('ac_wire_p', 'tzn_wire_r')
                        && c('ac_wire_n', 'tzn_wire_l');
                },
                op: [
                    _opEnsureTZN(),
                    ..._coilWiringOps('tzn', 'JSZ3N'),
                ],
            },
            {
                msg: '第 2 步：断开电源，继电器进入断电延时状态，触点保持 NO 位置。面板显示“断电延时中”，输出灯闪烁。',
                mode: 'check',
                check() {
                    const tzn = this.sys.comps['tzn'];
                    const ac = this.sys.comps['ac'];
                    return ac && !ac.isOn && tzn && tzn._state === 'delay';
                },
                op: [
                    { type: 'switch', target: 'ac', part: 'power',
                      msg: '再次按下电源按钮，断开电源',
                      async act() {
                          _setPower(this.sys, false);
                          await new Promise(r => setTimeout(r, 1500));
                      } },
                    { type: 'observe', target: 'tzn', part: 'led-output',
                      msg: '观察面板：显示“断电延时中”，输出灯闪烁，触点保持在 NO 位置',
                      async act() { await new Promise(r => setTimeout(r, 1800)); } },
                ],
            },
            {
                msg: '第 3 步：等待延时结束，继电器复位。触点回到 NC 位置，状态恢复为“待机”，输出灯熄灭。',
                mode: 'check',
                check() {
                    const tzn = this.sys.comps['tzn'];
                    return tzn && tzn._state === 'idle';
                },
                op: [
                    { type: 'observe', target: 'tzn', part: 'led-output',
                      msg: '等待延时结束：触点回到 NC 位置，状态恢复“待机”，输出灯熄灭',
                      async act() {
                          const tzn = this.sys.comps['tzn'];
                          const wait = tzn ? (tzn.delayTime * 1000 + 1500) : 12000;
                          await new Promise(r => setTimeout(r, wait));
                      } },
                ],
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
                msg: '第 5 步：通过参数设置界面把延时时间改为 8s，重新接通电源后再断开，观察完整的断电延时过程。',
                mode: 'check',
                check() {
                    const tzn = this.sys.comps['tzn'];
                    return tzn && tzn._state === 'idle' && Math.abs(tzn.delayTime - 8) < 0.01;
                },
                op: [
                    { type: 'observe', target: 'tzn', part: 'dial',
                      msg: '右键断电延时继电器 →「参数设置」，把「延时时间 (s)」改为 8',
                      async act() { await _demoSetConfig(this, 'tzn', 'delayTime', 8, '将「延时时间 (s)」改为 8'); } },
                    { type: 'switch', target: 'ac', part: 'power',
                      msg: '重新接通电源 2s 后再断开，观察 8s 断电延时结束后触点复位',
                      async act() {
                          _setPower(this.sys, true);
                          await new Promise(r => setTimeout(r, 2000));
                          _setPower(this.sys, false);
                          await new Promise(r => setTimeout(r, 8000 + 1500));
                      } },
                ],
            },
        ],
    },
};

// ═══════════════════════════════════════════════════════════════
// 组件配置
// ═══════════════════════════════════════════════════════════════

export const componentConfigs = [
    { Class: ACPower, id: 'ac', x: 600, y: 580, vRms: 220, freq: 50, isOn: false, visible: true },
    { Class: JSZ3, id: 'tz', x: 350, y: 130, delayTime: 15, visible: true },
    { Class: JSZ3N, id: 'tzn', x: 350, y: 130, delayTime: 15, visible: false },

    { Class: Multimeter, id: 'multimeter', x: 1120, y: 200, visible: false },
    { Class: MF47Multimeter, id: 'mf47-panel', x: 1050, y: 150, visible: false },
    { Class: Oscilloscope_tri, id: 'osc', x: 50, y: 50, visible: false },
    { Class: SignalGenerator, id: 'sg', x: 50, y: 50, visible: false },
    { Class: ProcessCalibrator, id: 'cali', x: 50, y: 50, visible: false },
    { Class: ElecMeter, id: 'elecmeter', x: 50, y: 50, visible: false },
    { Class: RealMegohmMeter, id: 'megohm', x: 50, y: 50, visible: false },
];

// ═══════════════════════════════════════════════════════════════
// 工具栏快捷操作（瞬时接线，非演示用）
// ═══════════════════════════════════════════════════════════════

function _autoWire(sys, mode) {
    sys.conns.length = 0;
    const tzn = mode === 'off-delay-test';
    const id = tzn ? 'tzn' : 'tz';
    const cons = [
        { from: 'ac_wire_p', to: `${id}_wire_r`, type: 'wire' },
        { from: 'ac_wire_n', to: `${id}_wire_l`, type: 'wire' },
    ];
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
    _setTZNMode(false);
    _autoWire(sys, 'time-delay-test');
    _setPower(sys, true);
}

export function fiveStep() {}
