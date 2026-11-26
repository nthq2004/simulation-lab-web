// ═══════════════════════════════════════════════════════════════
// 项目 7.1.2 —— 压力变送器好坏的判别（由旧工程 lab_02/pressSensor 迁移并适配本平台）
//
// 组成（单页工程，全部元件同屏）：
//   dcpower   24V 直流电源（面板电源键 + 电压旋钮 + LCD）
//   varires   回路可变电阻（限流/负载，500Ω）
//   ptr       两线制压力变送器（0~1 MPa → 4~20mA，面板 LCD 显示压力）
//   ampmeter  模拟电流表（0~20mA，检测回路电流，验证 4/8/12/16/20mA）
//   cab       气瓶（压力源 2MPa，出气口 o）
//   stopvalve 截止阀（手柄点击开关，控制气源通断）
//   pressreg  减压/稳压阀（输出压力 = min(输入压力, 设定压力)，设定压力走参数配置界面）
//
// 一条流程（13 步，与旧工程 pressSensor/WorkflowManager.js 的步骤一一对应）：
//   ①~③ 气路：气瓶 → 截止阀 → 调压阀 → 变送器输入口
//   ④~⑦ 电路：24V(+) → 回路电阻 → 变送器 P → 电流表 → 24V(-)
//   ⑧ 接通 24V 电源：LCD 点亮、回路电流 4mA（零点）
//   ⑨ 开启截止阀：气源进入调压阀
//   ⑩~⑬ 步进校验：25%/50%/75%/100% 量程 → 8/12/16/20mA
//
// 自动演示范式（见全局 AGENTS.md「最新范式」）：
//   · 每个 op 自带 act()：箭头指向目标 → 立即执行 → 停留观察
//   · 接线箭头指向端口（op.ports），操作箭头指向子部件（op.part）
//   · 接线 ≤8 根一律动画接线（addConnectionAnimated），逐根 await
//   · 按钮/阀门手柄一律模拟真实点击（fire 组件自身的交互事件）
//   · 调压阀设定压力一律走「参数配置界面」（弹框 → 填值 → 点保存）
//   · 故障一律走「故障设置」界面（type:'fault'）
//   · 等待一律条件轮询 _waitFor，不写死 sleep 猜时间
//   · 单页工程：不导出 PROJECT_PAGES，工作流不写 page op
// ═══════════════════════════════════════════════════════════════

import { Multimeter } from '../components/Multimeter.js';
import { MF47Multimeter } from '../components/MF47Multimeter.js';
import { Oscilloscope_tri } from '../components/Osc_tri.js';
import { SignalGenerator } from '../components/SignalGenerator.js';
import { ProcessCalibrator } from '../components/ProcessCalibrator.js';
import { ElecMeter } from '../components/ElecMeter.js';
import { RealMegohmMeter } from '../components/RealMegohmMeter.js';

import { DCPower } from '../components/DCPower.js';
import { VariResistor } from '../components/VariResistor.js';
import { PressTransmitter } from '../components/PressTransmitter.js';
import { AmpMeter } from '../components/AmpMeter.js';
import { AirBottle } from '../components/AirBottle.js';
import { StopValve } from '../components/StopValve.js';
import { PressRegulator } from '../components/PressRegulator.js';

// ═══════════════════════════════════════════════════════════════
// 一、故障（一律通过「故障设置」界面勾选后应用）
// ═══════════════════════════════════════════════════════════════

export const FAULT_CONFIGS = {
    // 变送器开路（内部断线）：回路电流降为 0，电流表指零、变送器 LCD 黑屏
    // 旧工程字段为 ptr.isOpened，本平台组件用 isBreak（同时用于电路求解与 LCD 判断）
    'ptr-open': {
        id: 'ptr-open',
        name: '压力变送器开路（断路）',
        system: '压力变送器',
        check() {
            const c = window.sys && window.sys.comps && window.sys.comps.ptr;
            return !!(c && c.isBreak === true);
        },
        trigger() {
            const c = window.sys && window.sys.comps && window.sys.comps.ptr;
            if (c) { c.isBreak = true; c.update && c.update(); }
        },
        repair() {
            const c = window.sys && window.sys.comps && window.sys.comps.ptr;
            if (c) { c.isBreak = false; c.update && c.update(); }
        },
    },
};

// ═══════════════════════════════════════════════════════════════
// 二、通用辅助（模拟真实交互 + 条件轮询，不直改内部字段）
// ═══════════════════════════════════════════════════════════════

const _sleep = (ms) => new Promise(r => setTimeout(r, ms));
const _sysOf = (ctx) => (ctx && ctx.sys) ? ctx.sys : window.sys;
const _comp = (sys, id) => (sys && sys.comps) ? sys.comps[id] : null;

/** 条件轮询等待（不写死 sleep 猜时间） */
async function _waitFor(sys, cond, timeout = 10000, interval = 120) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
        try { if (cond(sys)) return true; } catch (e) { /* ignore */ }
        await _sleep(interval);
    }
    try { return !!cond(sys); } catch (e) { return false; }
}

/** 无向判断两端口是否已接线 */
function _wired(sys, a, b) {
    return !!(sys && Array.isArray(sys.conns) && sys.conns.some(c =>
        c && ((c.from === a && c.to === b) || (c.from === b && c.to === a))));
}

/** 动画接一根线（≤8 根一律逐根动画，约 3s/根；已接则跳过） */
async function _wire(ctx, from, to, type = 'wire') {
    const sys = _sysOf(ctx);
    if (!sys || _wired(sys, from, to)) return true;
    await sys.connMgr.addConnectionAnimated({ from, to, type });
    await _sleep(200);
    return true;
}

/** 一根线的接线 op：箭头指向两端端口，动作为动画接线 */
function _opWire(from, to, msg) {
    return {
        type: 'observe', ports: [from, to], msg,
        async act() { await _wire(this, from, to, 'wire'); },
    };
}

/** 一根管路的接线 op：箭头指向两端端口，动作为动画接气 */
function _opPipe(from, to, msg) {
    return {
        type: 'observe', ports: [from, to], msg,
        async act() { await _wire(this, from, to, 'pipe'); },
    };
}

/** 触发部件命中节点的真实事件（执行组件自身的点击处理逻辑） */
function _firePart(comp, partId, evt = 'click') {
    if (!comp || typeof comp.getClickablePartNode !== 'function') return false;
    const node = comp.getClickablePartNode(partId);
    if (!node) return false;
    try { node.fire(evt, { evt: { cancelBubble: false } }); } catch (e) { return false; }
    return true;
}

/** 按下电源面板上的「电源键」（组件把该部件的命中节点直指电源按钮组，mousedown 即真实开关机） */
async function _pressPower(sys) {
    const dc = _comp(sys, 'dcpower');
    if (!dc) return false;
    if (dc.isOn) return true;            // 已通电则不重复按（避免把电源又关掉）
    _firePart(dc, 'power', 'mousedown');
    await _sleep(400);
    // 兜底：节点失效时走公开配置接口（不直改内部字段）
    if (dc.isOn !== true && typeof dc.onConfigUpdate === 'function') {
        dc.onConfigUpdate({ isOn: true });
    }
    if (sys && sys.redrawAll) sys.redrawAll();
    return !!dc.isOn;
}

/** 转动截止阀手柄（组件自身 click 处理器即 toggle） */
async function _openValve(sys) {
    const sv = _comp(sys, 'stopvalve');
    if (!sv) return false;
    if (sv.isOpen) return true;          // 已开启则不重复扳动
    const node = sv.handleGroup;
    if (node && typeof node.fire === 'function') {
        node.fire('click', { evt: { cancelBubble: false } });
    } else if (typeof sv.toggle === 'function') {
        sv.toggle();
    } else if (typeof sv.setValue === 'function') {
        sv.setValue(true);
    }
    await _sleep(400);
    if (!sv.isOpen && typeof sv.toggle === 'function') sv.toggle();   // 兜底：确保处于开启位
    if (sys && sys.redrawAll) sys.redrawAll();
    return !!sv.isOpen;
}

/**
 * 通过参数配置界面动态演示参数修改（所有参数配置场合统一这样演示）：
 *   ① 弹框前把组件实时属性同步进 config 副本（否则「保存」会把旧值一并回写）
 *   ② comp.showConfigDialog() 弹出参数设置界面
 *   ③ 取 #diag_<key> 输入框 → 闪烁箭头高亮 + 填入新值
 *   ④ 取最后打开的对话框的「保存」按钮 → 闪烁箭头高亮 + 真正 click() 按下
 *   ⑤ 确认对话框已关闭（未关闭则点「取消/关闭」）
 *   ⑥ 生效兜底：保存后仍未生效则调 onConfigUpdate
 */
async function _demoSetCfg(wf, compId, key, value, tip) {
    const sys = _sysOf(wf);
    const comp = _comp(sys, compId);
    if (!comp || typeof comp.showConfigDialog !== 'function') return;

    (comp.getConfigFields ? comp.getConfigFields() : []).forEach(f => {
        if (f.get) return;
        try { const live = comp[f.key]; if (live !== undefined) comp.config[f.key] = live; } catch (e) { /* 只读属性忽略 */ }
    });

    comp.showConfigDialog();
    await _sleep(700);

    const input = document.getElementById('diag_' + key);
    if (input) {
        if (wf && typeof wf._flashDomElement === 'function') {
            await wf._flashDomElement(input, tip || `请把该参数改为 ${value}`, 2400);
        }
        input.value = String(value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
    }

    const saveBtns = [...document.querySelectorAll('button')].filter(b => b.textContent.trim() === '保存');
    const saveBtn = saveBtns[saveBtns.length - 1];
    if (saveBtn) {
        if (wf && typeof wf._flashDomElement === 'function') {
            await wf._flashDomElement(saveBtn, '点击「保存」确认参数修改', 1800);
        }
        saveBtn.click();
        await _sleep(600);
    }

    const stillInput = document.getElementById('diag_' + key);
    if (stillInput && stillInput.offsetParent !== null) {
        const closeBtn = [...document.querySelectorAll('button')].find(b => /^(关闭|取消)$/.test(b.textContent.trim()));
        if (closeBtn) {
            if (wf && typeof wf._flashDomElement === 'function') await wf._flashDomElement(closeBtn, '关闭参数对话框', 1500);
            closeBtn.click();
            await _sleep(400);
        }
    }

    // 生效兜底：保存未生效时直接走公开接口，保证演示不中断
    if (Math.abs(parseFloat(comp[key]) - parseFloat(value)) > 1e-4) {
        if (typeof comp.onConfigUpdate === 'function') {
            comp.onConfigUpdate({ id: comp.id, unit: comp.displayUnit || 'MPa', [key]: value });
            console.warn('[演示] 参数界面保存未生效，已用公开接口兜底：', compId, key, value);
        }
    }
    if (sys && sys.redrawAll) sys.redrawAll();
}

/** 演示前的工位复位（内部初始化，不作为教学动作） */
function _resetRig(sys) {
    if (!sys) return;
    // 清空全部连线
    if (Array.isArray(sys.conns)) sys.conns.length = 0;

    const dc = _comp(sys, 'dcpower');
    if (dc) { dc.isBreak = false; if (dc.isOn && typeof dc.onConfigUpdate === 'function') dc.onConfigUpdate({ isOn: false }); dc.update && dc.update(); }

    const pt = _comp(sys, 'ptr');
    if (pt) { pt.isBreak = false; pt.isShort = false; pt.update && pt.update(); }

    const sv = _comp(sys, 'stopvalve');
    if (sv && sv.isOpen) { sv.isOpen = false; sv.update && sv.update(); }

    const reg = _comp(sys, 'pressreg');
    if (reg) {
        if (typeof reg.onConfigUpdate === 'function') reg.onConfigUpdate({ id: reg.id, unit: reg.displayUnit || 'MPa', setPressure: 0 });
        else { reg.setPressure = 0; reg.update && reg.update(); }
    }

    const cab = _comp(sys, 'cab');
    if (cab) {
        cab.isConsuming = false;
        if (typeof cab.setPressure === 'function') cab.setPressure(2);
        else { cab.pressure = 2; cab.update && cab.update(); }
    }

    try { if (sys.FAULT_CONFIG && sys.FAULT_CONFIG['ptr-open']) sys.FAULT_CONFIG['ptr-open'].repair(); } catch (e) { /* ignore */ }

    if (sys.redrawAll) sys.redrawAll();
}

/** 等回路电流稳定到目标值（mA） */
async function _waitCurrent(ctx, target, tol = 0.3, timeout = 8000) {
    const sys = _sysOf(ctx);
    await _waitFor(sys, s => {
        const am = _comp(s, 'ampmeter');
        return !!am && Math.abs((am.value || 0) - target) <= tol;
    }, timeout, 100);
    await _sleep(300);
}

/** 变送器 LCD 是否已点亮（有显示内容） */
function _lcdOn(sys) {
    const pt = _comp(sys, 'ptr');
    return !!(pt && pt.lcdText && String(pt.lcdText.text() || '').length > 0);
}

// ═══════════════════════════════════════════════════════════════
// 三、接线表（与旧工程 autoConns 完全一致，仅端口名随新组件调整）
// ═══════════════════════════════════════════════════════════════

// 气路：气瓶出气口 → 截止阀 → 调压阀 → 变送器输入口
const PIPE_CONNS = [
    { from: 'cab_pipe_o', to: 'stopvalve_pipe_i', type: 'pipe' },
    { from: 'stopvalve_pipe_o', to: 'pressreg_pipe_i', type: 'pipe' },
    { from: 'pressreg_pipe_o', to: 'ptr_pipe_i', type: 'pipe' },
];

// 电路：24V(+) → 回路电阻 → 变送器 P → 变送器 N → 电流表 → 24V(-)
const WIRE_CONNS = [
    { from: 'dcpower_wire_p', to: 'varires_wire_l', type: 'wire' },
    { from: 'varires_wire_r', to: 'ptr_wire_p', type: 'wire' },
    { from: 'ptr_wire_n', to: 'ampmeter_wire_p', type: 'wire' },
    { from: 'ampmeter_wire_n', to: 'dcpower_wire_n', type: 'wire' },
];

// ═══════════════════════════════════════════════════════════════
// 四、步进校验步骤（25% / 50% / 75% / 100% 量程 → 8 / 12 / 16 / 20mA）
// ═══════════════════════════════════════════════════════════════

function _pressureStep(stepNo, ratioText, ratio, current) {
    return {
        msg: `第 ${stepNo} 步：调节压力至 ${ratioText} 量程点，电流应为 ${current}mA。`,
        mode: 'check',
        op: [
            {
                type: 'knob', target: 'pressreg', part: 'wheel',
                msg: `右键调压阀 →「参数设置」，把「设定压力」改为 ${ratioText} 量程`,
                async act() {
                    const sys = _sysOf(this);
                    const pt = _comp(sys, 'ptr');
                    const target = +((pt ? pt.max : 1) * ratio).toFixed(3);
                    await _demoSetCfg(this, 'pressreg', 'setPressure', target, `把「设定压力」改为 ${target} MPa`);
                },
            },
            {
                type: 'observe', target: 'ptr', part: 'lcd',
                msg: '变送器 LCD 显示当前压力值',
                async act() {
                    const sys = _sysOf(this);
                    const pt = _comp(sys, 'ptr');
                    const target = +((pt ? pt.max : 1) * ratio).toFixed(3);
                    await _waitFor(sys, s => {
                        const p = _comp(s, 'ptr');
                        return !!p && Math.abs((p.press || 0) - target) < 0.01;
                    }, 8000, 120);
                    await _sleep(400);
                },
            },
            {
                type: 'observe', target: 'ampmeter', part: 'lcd',
                msg: `回路电流升到 ${current}mA`,
                async act() { await _waitCurrent(this, current, 0.3, 8000); },
            },
        ],
        check() {
            const sys = _sysOf(this);
            const pt = _comp(sys, 'ptr');
            const reg = _comp(sys, 'pressreg');
            const am = _comp(sys, 'ampmeter');
            if (!pt || !reg || !am) return false;
            const target = +(pt.max * ratio).toFixed(3);
            return Math.abs((reg.setPressure || 0) - target) < 0.02
                && Math.abs((reg.outputPressure || 0) - target) < 0.02
                && Math.abs((am.value || 0) - current) < 0.4;
        },
    };
}

// ═══════════════════════════════════════════════════════════════
// 五、工作流（步骤与旧工程完全一致：3 步气路 + 4 步电路 + 2 步启动 + 4 步校验）
// ═══════════════════════════════════════════════════════════════

export const PROJECT_WORKFLOWS = {
    'pt-diagnose': {
        id: 'pt-diagnose',
        name: '1. 压力变送器好坏的判别（项目 7.1.2）',
        steps: [
            // ── 第 1 步：气瓶 → 截止阀 ──
            {
                msg: '第 1 步：气路连接——从气瓶出口接到截止阀进气端。',
                mode: 'check',
                op: [
                    {
                        type: 'observe', ports: ['cab_pipe_o', 'stopvalve_pipe_i'],
                        msg: '接气①：气瓶出气口 → 截止阀进气端',
                        async act() {
                            const sys = _sysOf(this);
                            _resetRig(sys);           // 内部复位（清空旧连线、关闭电源与阀门）
                            await _sleep(400);
                            await _wire(sys, 'cab_pipe_o', 'stopvalve_pipe_i', 'pipe');
                        },
                    },
                ],
                check() {
                    return _wired(_sysOf(this), 'cab_pipe_o', 'stopvalve_pipe_i');
                },
            },

            // ── 第 2 步：截止阀 → 调压阀 ──
            {
                msg: '第 2 步：气路连接——从截止阀出口接到调压阀入口。',
                mode: 'check',
                op: [
                    _opPipe('stopvalve_pipe_o', 'pressreg_pipe_i', '接气②：截止阀出口 → 调压阀入口'),
                ],
                check() {
                    return _wired(_sysOf(this), 'stopvalve_pipe_o', 'pressreg_pipe_i');
                },
            },

            // ── 第 3 步：调压阀 → 变送器输入口 ──
            {
                msg: '第 3 步：气路连接——调压阀出口接到变送器输入口。',
                mode: 'check',
                op: [
                    _opPipe('pressreg_pipe_o', 'ptr_pipe_i', '接气③：调压阀出口 → 变送器输入口'),
                ],
                check() {
                    return _wired(_sysOf(this), 'pressreg_pipe_o', 'ptr_pipe_i');
                },
            },

            // ── 第 4 步：电源正极 → 回路电阻 ──
            {
                msg: '第 4 步：电路连接——24V 电源正极接到回路电阻。',
                mode: 'check',
                op: [
                    _opWire('dcpower_wire_p', 'varires_wire_l', '接线①：24V 电源正极(+) → 回路电阻左端'),
                ],
                check() {
                    return _wired(_sysOf(this), 'dcpower_wire_p', 'varires_wire_l');
                },
            },

            // ── 第 5 步：回路电阻 → 变送器 P ──
            {
                msg: '第 5 步：电路连接——回路电阻接到变送器正极端子 P。',
                mode: 'check',
                op: [
                    _opWire('varires_wire_r', 'ptr_wire_p', '接线②：回路电阻右端 → 变送器 P(+)'),
                ],
                check() {
                    return _wired(_sysOf(this), 'varires_wire_r', 'ptr_wire_p');
                },
            },

            // ── 第 6 步：变送器 N → 电流表正极 ──
            {
                msg: '第 6 步：电路连接——变送器负极端子 N 接到电流表正极。',
                mode: 'check',
                op: [
                    _opWire('ptr_wire_n', 'ampmeter_wire_p', '接线③：变送器 N(-) → 电流表正极'),
                ],
                check() {
                    return _wired(_sysOf(this), 'ptr_wire_n', 'ampmeter_wire_p');
                },
            },

            // ── 第 7 步：电流表负极 → 电源负极 ──
            {
                msg: '第 7 步：电路连接——电流表负极接回 24V 电源负极，闭合回路。',
                mode: 'check',
                op: [
                    _opWire('ampmeter_wire_n', 'dcpower_wire_n', '接线④：电流表负极 → 24V 电源负极(-)'),
                ],
                check() {
                    return _wired(_sysOf(this), 'ampmeter_wire_n', 'dcpower_wire_n');
                },
            },

            // ── 第 8 步：接通直流电源 ──
            {
                msg: '第 8 步：接通直流电源，观察变送器 LCD 是否点亮，电流应为 4mA。',
                mode: 'check',
                op: [
                    {
                        type: 'switch', target: 'dcpower', part: 'power',
                        msg: '按下电源键，接通 DC 24V',
                        async act() { await _pressPower(_sysOf(this)); },
                    },
                    {
                        type: 'observe', target: 'ptr', part: 'lcd',
                        msg: '变送器 LCD 点亮，显示 0.000 MPa',
                        async act() {
                            await _waitFor(_sysOf(this), s => _lcdOn(s), 8000, 120);
                            await _sleep(600);
                        },
                    },
                    {
                        type: 'observe', target: 'ampmeter', part: 'lcd',
                        msg: '回路电流 4.00mA（压力为零点）',
                        async act() { await _waitCurrent(this, 4, 0.3, 8000); },
                    },
                ],
                check() {
                    const sys = _sysOf(this);
                    const dc = _comp(sys, 'dcpower');
                    const am = _comp(sys, 'ampmeter');
                    return !!(dc && dc.isOn) && _lcdOn(sys) && !!am && Math.abs(am.value - 4) < 0.4;
                },
            },

            // ── 第 9 步：开启截止阀 ──
            {
                msg: '第 9 步：开启气瓶截止阀，让气源压力进入调压阀。',
                mode: 'check',
                op: [
                    {
                        type: 'switch', target: 'stopvalve', part: 'handle',
                        msg: '转动手柄，开启截止阀',
                        async act() { await _openValve(_sysOf(this)); },
                    },
                    {
                        type: 'observe', target: 'pressreg',
                        msg: '气源进入调压阀，输入压力约 2.0 MPa（设定压力仍为 0）',
                        async act() {
                            await _waitFor(_sysOf(this), s => {
                                const r = _comp(s, 'pressreg');
                                return !!r && (r.inputPressure || 0) > 0.5;
                            }, 8000, 120);
                            await _sleep(800);
                        },
                    },
                ],
                check() {
                    const sys = _sysOf(this);
                    const sv = _comp(sys, 'stopvalve');
                    const reg = _comp(sys, 'pressreg');
                    return !!(sv && sv.isOpen) && !!reg && (reg.inputPressure || 0) > 0.5;
                },
            },

            // ── 第 10~13 步：步进校验 ──
            _pressureStep(10, '25%', 0.25, 8),
            _pressureStep(11, '50%', 0.50, 12),
            _pressureStep(12, '75%', 0.75, 16),
            _pressureStep(13, '100%', 1.00, 20),
        ],
    },
};

// ═══════════════════════════════════════════════════════════════
// 六、元件布局（单页 1920×1080，全部同屏；仅仪表默认隐藏）
//   左侧电气回路（电源→电阻→变送器→电流表→回电源），右侧气路（气瓶→截止阀→调压阀→变送器）
// ═══════════════════════════════════════════════════════════════

export const componentConfigs = [
    // ── 电气回路 ──
    { Class: DCPower, id: 'dcpower', x: 40, y: 200, voltage: 24, isOn: false, visible: true },
    { Class: VariResistor, id: 'varires', x: 300, y: 300, value: 500, cvalue: 250, visible: true },
    { Class: PressTransmitter, id: 'ptr', x: 390, y: 470, min: 0, max: 1.0, unit: 'MPa', visible: true },
    { Class: AmpMeter, id: 'ampmeter', x: 230, y: 640, min: 0, max: 20, title: '电流表 mA', visible: true },

    // ── 气路 ──
    { Class: PressRegulator, id: 'pressreg', x: 800, y: 620, setPressure: 0, unit: 'MPa', visible: true },
    { Class: StopValve, id: 'stopvalve', x: 1090, y: 640, isOpen: false, reverse: false, visible: true },
    { Class: AirBottle, id: 'cab', x: 1100, y: 380, initialPressure: 2, volume: 50, unit: 'MPa', consumptionRate: 0.02, visible: true },

    // ── 7 种标准仪表（默认隐藏，由工具栏「选择仪表」调出）──
    { Class: Multimeter, id: 'multimeter', x: 1180, y: 150, visible: false },
    { Class: MF47Multimeter, id: 'mf47-panel', x: 1050, y: 150, visible: false },
    { Class: Oscilloscope_tri, id: 'osc', x: 50, y: 50, visible: false },
    { Class: SignalGenerator, id: 'sg', x: 50, y: 50, visible: false },
    { Class: ProcessCalibrator, id: 'cali', x: 50, y: 50, visible: false },
    { Class: ElecMeter, id: 'elecmeter', x: 50, y: 50, visible: false },
    { Class: RealMegohmMeter, id: 'megohm', x: 50, y: 50, visible: false },
];

// ═══════════════════════════════════════════════════════════════
// 七、快捷操作
// ═══════════════════════════════════════════════════════════════

export function initSlider(_sys) {
    // 自动演示时只保留箭头指示，不闪亮整个组件
    if (_sys) _sys._noBlinkHighlight = true;
}

/** 工具栏「自动接线」：一次性接好气路 + 电路（初始化时不预接线） */
export function applyAllPresets(opts) {
    if (opts && opts.init) return;
    const sys = _sysOf(this);
    if (!sys || !sys.connMgr) return;
    sys.conns.length = 0;
    [...PIPE_CONNS, ...WIRE_CONNS].forEach(c => {
        sys.connMgr.addConn({ from: c.from, to: c.to, type: c.type });
    });
    if (sys.redrawAll) sys.redrawAll();
}

/** 工具栏「起动系统」：复位台架 → 自动接线 → 接通 24V → 开启截止阀（设定压力仍为 0，输出 4mA） */
export async function applyStartSystem() {
    const sys = _sysOf(this);
    if (!sys) return;
    try {
        _resetRig(sys);
        await _sleep(300);
        sys.conns.length = 0;
        [...PIPE_CONNS, ...WIRE_CONNS].forEach(c => {
            sys.connMgr.addConn({ from: c.from, to: c.to, type: c.type });
        });
        if (sys.redrawAll) sys.redrawAll();
        await _sleep(300);
        await _pressPower(sys);
        await _sleep(500);
        await _openValve(sys);
        await _waitCurrent({ sys }, 4, 0.4, 8000);
    } catch (e) {
        console.warn('[起动系统] 执行异常：', e);
    }
}

/**
 * 工具栏「5 点步进」：把调压阀设定压力依次切换为 0.25 / 0.5 / 0.75 / 1.0 / 0 倍量程，
 * 便于快速观察 8 / 12 / 16 / 20 / 4 mA 五个输出点（与旧工程 fiveStep 一致）。
 */
export function fiveStep() {
    const sys = _sysOf(this);
    if (!sys) return;
    const pt = _comp(sys, 'ptr');
    const reg = _comp(sys, 'pressreg');
    if (!pt || !reg) return;

    const ratios = [0.25, 0.5, 0.75, 1.0, 0];
    if (sys._ptStep === undefined || sys._ptStep >= ratios.length) sys._ptStep = 0;
    const target = +(ratios[sys._ptStep] * pt.max).toFixed(3);

    if (typeof reg.onConfigUpdate === 'function') {
        reg.onConfigUpdate({ id: reg.id, unit: reg.displayUnit || 'MPa', setPressure: target });
    } else {
        reg.setPressure = target;
        reg.update && reg.update();
    }

    sys._ptStep = (sys._ptStep + 1) % ratios.length;
    if (sys.redrawAll) sys.redrawAll();
}
