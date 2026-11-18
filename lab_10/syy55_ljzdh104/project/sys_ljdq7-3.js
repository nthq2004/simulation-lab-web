// ═══════════════════════════════════════════════════════════════
// 项目 7.3 —— 电动差压变送器的功能测试（结构/电路/气路连接 + 零点与量程调整）
// （由旧工程 lab_02/diffTransducer 的 consys.js + lib/WorkflowManager.js
//   迁移到本平台，组件一律使用本工程 components/ 下的新组件）
//
// 组成（单页工程，全部元件同屏；仪表默认隐藏，由「选择仪表」调出）：
//   difftr     差压变送器（低压室 L / 高压室 H，二线制 p+/n−，LCD 显示差压，
//              面板 Z 零点旋钮、S 量程旋钮）
//   3valve     三阀组（高压阀 vH、低压阀 vL、平衡阀 vE）
//   pressreg   高压侧调压阀（输出 = min(输入, 设定压力)）
//   pressreg2  低压侧调压阀
//   tee        三通接头（右口进气，上口→高压支路，下口→低压支路）
//   stopvalve  截止阀（点击手柄通断气源）
//   cab        气瓶（气源 2MPa）
//   dcpower    24V 直流电源（二线制回路供电）
//   varires    可调限流电阻（250Ω）
//   ampmeter   电流表（0~20mA，观察 4~20mA 输出）
//
// 两条流程（步骤与原工程 WorkflowManager.js 一一对应）：
//   ① 项目7.3-1（6 步）：气瓶→截止阀→三通→两路调压→三阀组→变送器 H/L；
//      24V+→可调电阻→变送器 p/n→电流表→24V−。
//   ② 项目7.3-2（12 步）：连线检查 → 通电开阀（4mA）→ 平衡阀投运 →
//      引入 0.1MPa 差压 → 调零至 4mA → 升到 0.9MPa → 调量程至 20mA →
//      回到 0.1MPa → 重新调零 → 回到 0.9MPa → 再次调量程至 20mA。
//
// 自动演示范式（见全局 AGENTS.md「最新范式」）：
//   · 每个 op 自带 act()：箭头指向目标 → 立即执行 → 停留观察
//   · 接线箭头指向端口（op.ports），操作箭头指向子部件（op.part）
//   · 接线 ≤8 根一律动画接线（addConnectionAnimated），逐根 await
//   · 电源键、截止阀手柄、三阀组手轮一律模拟真实按下（fire 组件自身的节点事件）
//   · 调压阀设定压力一律走「参数配置界面」（弹框 → 填值 → 点保存）
//   · 零点/量程一律「按住旋钮」微调（mousedown → 等读数到位 → mouseup）
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

import { DiffTransmitter } from '../components/DiffTransmitter.js';
import { ThreeValve } from '../components/ThreeValve.js';
import { PressRegulator } from '../components/PressRegulator.js';
import { TeeConnector } from '../components/TeeConnector.js';
import { StopValve } from '../components/StopValve.js';
import { AirBottle } from '../components/AirBottle.js';
import { DCPower } from '../components/DCPower.js';
import { VariResistor } from '../components/VariResistor.js';
import { AmpMeter } from '../components/AmpMeter.js';

// ═══════════════════════════════════════════════════════════════
// 一、故障（与原工程一致：本项目不设故障，界面为空）
// ═══════════════════════════════════════════════════════════════

export const FAULT_CONFIGS = {};

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

/** 动画接一根线/管（≤8 根一律逐根动画，约 3s/根；已接则跳过） */
async function _wire(ctx, from, to, type = 'wire') {
    const sys = _sysOf(ctx);
    if (!sys || _wired(sys, from, to)) return true;
    await sys.connMgr.addConnectionAnimated({ from, to, type });
    await _sleep(200);
    return true;
}

/** 一根管路的接线 op：箭头指向两端端口，动作为动画接气 */
function _opPipe(from, to, msg) {
    return {
        type: 'observe', ports: [from, to], msg,
        async act() { await _wire(this, from, to, 'pipe'); },
    };
}

/** 一根导线的接线 op：箭头指向两端端口，动作为动画接线 */
function _opWire(from, to, msg) {
    return {
        type: 'observe', ports: [from, to], msg,
        async act() { await _wire(this, from, to, 'wire'); },
    };
}

/**
 * 通过参数配置界面动态演示参数修改（调压阀设定压力等统一走这里）：
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

/** 把某只调压阀的设定压力调到 target（走参数配置界面） */
async function _setReg(wf, compId, target, tip) {
    await _demoSetCfg(wf, compId, 'setPressure', target,
        tip || `把「设定压力」改为 ${target} MPa`);
}

/** 按电源键（模拟真实按下：触发组件电源键自身的处理逻辑） */
async function _setPower(sys, on) {
    const p = _comp(sys, 'dcpower');
    if (!p) return false;
    if (!!p.isOn === !!on) return true;
    const node = p.powerBtnGroup || (p.getClickablePartNode && p.getClickablePartNode('power'));
    if (node && typeof node.fire === 'function') node.fire('mousedown', { evt: {} });
    await _sleep(400);
    if (!!p.isOn !== !!on) { p.isOn = !!on; p.update && p.update(); }   // 兜底
    if (sys && sys.redrawAll) sys.redrawAll();
    return !!p.isOn === !!on;
}

/** 扳动截止阀手柄（组件自身的 click 处理即 toggle） */
async function _setStopValve(sys, open) {
    const sv = _comp(sys, 'stopvalve');
    if (!sv) return false;
    if (!!sv.isOpen === !!open) return true;
    const node = sv.handleGroup || (sv.getClickablePartNode && sv.getClickablePartNode('handle'));
    if (node && typeof node.fire === 'function') node.fire('click', { evt: { cancelBubble: false } });
    else if (typeof sv.setValue === 'function') sv.setValue(!!open);
    await _sleep(400);
    if (!!sv.isOpen !== !!open && typeof sv.setValue === 'function') sv.setValue(!!open);   // 兜底
    if (sys && sys.redrawAll) sys.redrawAll();
    return !!sv.isOpen === !!open;
}

/** 扳动三阀组的某只手柄（模拟真实点击：fire 该部件命中节点的 click） */
async function _setValve3(sys, key, want) {
    const tv = _comp(sys, '3valve');
    if (!tv) return false;
    if (!!tv[key] === !!want) return true;
    const node = tv.getClickablePartNode && tv.getClickablePartNode(key);
    if (node) node.fire('click', { evt: { cancelBubble: false } });
    else tv.setValve(key, want);
    await _sleep(450);
    if (!!tv[key] !== !!want) tv.setValve(key, want);   // 兜底
    if (sys && sys.redrawAll) sys.redrawAll();
    return !!tv[key] === !!want;
}

/**
 * 按住零点/量程旋钮，把电流表读数调到 target：
 *   阶段 1：长按快速接近（到 ±0.25mA 以内）；
 *   阶段 2：点动微调（每次按住 120ms 再松开等读数稳定），直至进入容差。
 * 全程用真实事件驱动组件自身的按住调节逻辑，不直接改 zeroAdj/spanAdj。
 */
async function _trimToAmp(ctx, comp, kind, target, tol = 0.04, timeout = 25000) {
    const sys = _sysOf(ctx);
    const amp = _comp(sys, 'ampmeter');
    if (!comp || !amp) return false;

    const partOf = (up) => (kind === 'zero'
        ? (up ? 'zero-inc' : 'zero-dec')
        : (up ? 'span-inc' : 'span-dec'));

    const nodeOf = (up) => (comp.getClickablePartNode ? comp.getClickablePartNode(partOf(up)) : null);

    // ── 阶段 1：长按快速接近 ──
    const first = nodeOf((amp.value || 0) < target);
    if (!first) {
        // 取不到命中节点：退回组件公开接口逐格调节（仅兜底）
        const fn = (kind === 'zero') ? 'adjustZero' : 'adjustSpan';
        let guard = 0;
        while (Math.abs((amp.value || 0) - target) > tol && guard++ < 600) {
            comp[fn]((amp.value || 0) < target ? 1 : -1, 1);
            await _sleep(60);
        }
        return Math.abs((amp.value || 0) - target) <= tol;
    }

    first.fire('mousedown', { evt: {} });
    await _waitFor(sys, s => {
        const a = _comp(s, 'ampmeter');
        return !!a && Math.abs((a.value || 0) - target) <= 0.25;
    }, timeout, 60);
    first.fire('mouseup', { evt: {} });
    await _sleep(350);

    // ── 阶段 2：点动微调 ──
    for (let i = 0; i < 40; i++) {
        const cur = amp.value || 0;
        if (Math.abs(cur - target) <= tol) break;
        const node = nodeOf(cur < target);
        if (!node) break;
        node.fire('mousedown', { evt: {} });
        await _sleep(120);
        node.fire('mouseup', { evt: {} });
        await _sleep(260);
    }
    if (sys && sys.redrawAll) sys.redrawAll();
    return Math.abs((amp.value || 0) - target) <= tol;
}

/** 等电流表读数稳定到 target（mA） */
async function _waitAmp(ctx, target, tol = 0.06, timeout = 12000) {
    const sys = _sysOf(ctx);
    await _waitFor(sys, s => {
        const a = _comp(s, 'ampmeter');
        return !!a && Math.abs((a.value || 0) - target) <= tol;
    }, timeout, 100);
    await _sleep(300);
}

/** 等变送器测得的差压稳定到 target（MPa） */
async function _waitDiff(ctx, target, tol = 0.005, timeout = 12000) {
    const sys = _sysOf(ctx);
    await _waitFor(sys, s => {
        const d = _comp(s, 'difftr');
        return !!d && Math.abs((d.press || 0) - target) <= tol;
    }, timeout, 100);
    await _sleep(300);
}

/** 等调压阀输出压力稳定到 target（MPa） */
async function _waitRegOut(ctx, compId, target, tol = 0.006, timeout = 12000) {
    const sys = _sysOf(ctx);
    await _waitFor(sys, s => {
        const r = _comp(s, compId);
        return !!r && Math.abs((r.outputPressure || 0) - target) <= tol;
    }, timeout, 100);
    await _sleep(300);
}

/** 演示前的工位复位（内部初始化，不作为教学动作） */
function _resetRig(sys) {
    if (!sys) return;
    // 清空全部连线
    if (Array.isArray(sys.conns)) sys.conns.length = 0;

    const p = _comp(sys, 'dcpower');
    if (p && p.isOn) { p.isOn = false; p.update && p.update(); }

    const sv = _comp(sys, 'stopvalve');
    if (sv && sv.isOpen) { sv.isOpen = false; sv.update && sv.update(); }

    ['pressreg', 'pressreg2'].forEach(id => {
        const reg = _comp(sys, id);
        if (!reg) return;
        if (typeof reg.onConfigUpdate === 'function') {
            reg.onConfigUpdate({ id: reg.id, unit: reg.displayUnit || 'MPa', setPressure: 0 });
        } else { reg.setPressure = 0; reg.update && reg.update(); }
    });

    const tv = _comp(sys, '3valve');
    if (tv) {
        tv.vE = false; tv.vH = false; tv.vL = false;
        tv.updateUI && tv.updateUI();
    }

    const dt = _comp(sys, 'difftr');
    if (dt) {
        dt.isBreak = false;
        dt.resetTrim && dt.resetTrim();
        dt.press = 0;
    }

    const cab = _comp(sys, 'cab');
    if (cab) {
        cab.isConsuming = false;
        if (typeof cab.setPressure === 'function') cab.setPressure(2);
        else { cab.pressure = 2; cab.update && cab.update(); }
    }

    if (sys.redrawAll) sys.redrawAll();
}

// ═══════════════════════════════════════════════════════════════
// 三、接线表（拓扑与原工程完全一致，端口名随本平台组件调整）
// ═══════════════════════════════════════════════════════════════

// 气路：气瓶 → 截止阀 → 三通 ┬→ 上调压阀1 → 三阀组 inh → 变送器 H
//                              └→ 下调压阀2 → 三阀组 inl → 变送器 L
const PIPE_CONNS = [
    { from: 'cab_pipe_o',       to: 'stopvalve_pipe_i', type: 'pipe' },
    { from: 'stopvalve_pipe_o', to: 'tee_pipe_u',       type: 'pipe' },
    { from: 'tee_pipe_l',       to: 'pressreg_pipe_i',  type: 'pipe' },
    { from: 'pressreg_pipe_o',  to: '3valve_pipe_inh',  type: 'pipe' },
    { from: 'tee_pipe_r',       to: 'pressreg2_pipe_i', type: 'pipe' },
    { from: 'pressreg2_pipe_o', to: '3valve_pipe_inl',  type: 'pipe' },
    { from: '3valve_pipe_outl', to: 'difftr_pipe_l',    type: 'pipe' },
    { from: '3valve_pipe_outh', to: 'difftr_pipe_h',    type: 'pipe' },
];

// 电路：24V+ → 可调电阻 → 变送器 p → 变送器 n → 电流表 → 24V−
const WIRE_CONNS = [
    { from: 'dcpower_wire_p',  to: 'varires_wire_l',  type: 'wire' },
    { from: 'varires_wire_r',  to: 'difftr_wire_p',   type: 'wire' },
    { from: 'difftr_wire_n',   to: 'ampmeter_wire_p', type: 'wire' },
    { from: 'ampmeter_wire_n', to: 'dcpower_wire_n',  type: 'wire' },
];

const ALL_CONNS = [...PIPE_CONNS, ...WIRE_CONNS];

/** 全部连线是否已接好 */
function _allWired(sys) {
    return ALL_CONNS.every(c => _wired(sys, c.from, c.to));
}

// ═══════════════════════════════════════════════════════════════
// 四、工作流（步骤顺序与原工程完全一致：项目7.3-1 共 6 步、项目7.3-2 共 12 步）
// ═══════════════════════════════════════════════════════════════

export const PROJECT_WORKFLOWS = {
    'diff-connect': {
        id: 'diff-connect',
        name: '1. 电动差压变送器的结构、电路、气路连接(项目7.3)',
        steps: [
            // ── 第 1 步：主气源：气瓶 → 截止阀 → 三通右端 ──
            {
                msg: '第 1 步：气瓶 → 截止阀 → 三通接头右端。',
                mode: 'check',
                op: [
                    {
                        type: 'observe', ports: ['cab_pipe_o', 'stopvalve_pipe_i'],
                        msg: '接气①：气瓶出气口 → 截止阀进气端',
                        async act() {
                            const sys = _sysOf(this);
                            _resetRig(sys);          // 内部复位（清空旧接线、关阀、调压阀归零）
                            await _sleep(400);
                            await _wire(sys, 'cab_pipe_o', 'stopvalve_pipe_i', 'pipe');
                        },
                    },
                    _opPipe('stopvalve_pipe_o', 'tee_pipe_u', '接气②：截止阀出口 → 三通右口'),
                ],
                check() {
                    const sys = _sysOf(this);
                    return _wired(sys, 'cab_pipe_o', 'stopvalve_pipe_i')
                        && _wired(sys, 'stopvalve_pipe_o', 'tee_pipe_u');
                },
            },

            // ── 第 2 步：低压气路：三通下端 → 调压阀2 → 三阀组 inl ──
            {
                msg: '第 2 步：三通下端 → 调压阀2 → 三阀组低压端。',
                mode: 'check',
                op: [
                    _opPipe('tee_pipe_r', 'pressreg2_pipe_i', '接气③：三通下口 → 调压阀2 入口'),
                    _opPipe('pressreg2_pipe_o', '3valve_pipe_inl', '接气④：调压阀2 出口 → 三阀组 inl'),
                ],
                check() {
                    const sys = _sysOf(this);
                    return _wired(sys, 'tee_pipe_r', 'pressreg2_pipe_i')
                        && _wired(sys, 'pressreg2_pipe_o', '3valve_pipe_inl');
                },
            },

            // ── 第 3 步：高压气路：三通上端 → 调压阀1 → 三阀组 inh ──
            {
                msg: '第 3 步：三通上端 → 调压阀1 → 三阀组高压端。',
                mode: 'check',
                op: [
                    _opPipe('tee_pipe_l', 'pressreg_pipe_i', '接气⑤：三通上口 → 调压阀1 入口'),
                    _opPipe('pressreg_pipe_o', '3valve_pipe_inh', '接气⑥：调压阀1 出口 → 三阀组 inh'),
                ],
                check() {
                    const sys = _sysOf(this);
                    return _wired(sys, 'tee_pipe_l', 'pressreg_pipe_i')
                        && _wired(sys, 'pressreg_pipe_o', '3valve_pipe_inh');
                },
            },

            // ── 第 4 步：三阀组输出 → 变送器 L / H 接口 ──
            {
                msg: '第 4 步：三阀组输出端 → 变送器 L、H 接口。',
                mode: 'check',
                op: [
                    _opPipe('3valve_pipe_outl', 'difftr_pipe_l', '接气⑦：三阀组 outl → 变送器 L 室'),
                    _opPipe('3valve_pipe_outh', 'difftr_pipe_h', '接气⑧：三阀组 outh → 变送器 H 室'),
                ],
                check() {
                    const sys = _sysOf(this);
                    return _wired(sys, '3valve_pipe_outl', 'difftr_pipe_l')
                        && _wired(sys, '3valve_pipe_outh', 'difftr_pipe_h');
                },
            },

            // ── 第 5 步：供电回路：24V+ → 可调电阻 → 变送器 p ──
            {
                msg: '第 5 步：24V 正极 → 可调电阻 → 变送器正极。',
                mode: 'check',
                op: [
                    _opWire('dcpower_wire_p', 'varires_wire_l', '接电①：24V 电源 p(+) → 可调电阻左端'),
                    _opWire('varires_wire_r', 'difftr_wire_p', '接电②：可调电阻右端 → 变送器 p(+)'),
                ],
                check() {
                    const sys = _sysOf(this);
                    return _wired(sys, 'dcpower_wire_p', 'varires_wire_l')
                        && _wired(sys, 'varires_wire_r', 'difftr_wire_p');
                },
            },

            // ── 第 6 步：闭合回路：变送器 n → 电流表 → 电源负极 ──
            {
                msg: '第 6 步：变送器负极 → 电流表 → 电源负极。',
                mode: 'check',
                op: [
                    _opWire('difftr_wire_n', 'ampmeter_wire_p', '接电③：变送器 n(−) → 电流表 p(+)'),
                    _opWire('ampmeter_wire_n', 'dcpower_wire_n', '接电④：电流表 n(−) → 24V 电源负极'),
                ],
                check() {
                    const sys = _sysOf(this);
                    return _wired(sys, 'difftr_wire_n', 'ampmeter_wire_p')
                        && _wired(sys, 'ampmeter_wire_n', 'dcpower_wire_n');
                },
            },
        ],
    },

    'diff-calibrate': {
        id: 'diff-calibrate',
        name: '2. 电动差压变送器的零点和量程调整(项目7.3)',
        steps: [
            // ── 第 1 步：连线并检查 ──
            {
                msg: '第 1 步：连线并检查，气路与电路应已接好。',
                mode: 'check',
                op: [
                    {
                        type: 'wire', button: 'btnAutoWire',
                        msg: '点「自动接线」，一次接好气路与电路',
                        async act() {
                            const sys = _sysOf(this);
                            _resetRig(sys);
                            await _sleep(300);
                            applyAllPresets.call(this);
                            await _sleep(600);
                        },
                    },
                    {
                        type: 'observe', ports: ['cab_pipe_o', 'stopvalve_pipe_i'],
                        msg: '气路：气瓶 → 截止阀 → 三通 → 两路调压 → 三阀组 → 变送器 H/L',
                        async act() { await _sleep(1800); },
                    },
                    {
                        type: 'observe', ports: ['dcpower_wire_p', 'varires_wire_l'],
                        msg: '电路：24V+ → 可调电阻 → 变送器 p → n → 电流表 → 24V−',
                        async act() { await _sleep(1800); },
                    },
                ],
                check() {
                    return _allWired(_sysOf(this));
                },
            },

            // ── 第 2 步：通电、开截止阀，观察初始零点 4mA ──
            {
                msg: '第 2 步：接通电源、打开截止阀，电流应为 4mA。',
                mode: 'check',
                op: [
                    {
                        type: 'switch', target: 'dcpower', part: 'power',
                        msg: '按电源键，接通 24V',
                        async act() { await _setPower(_sysOf(this), true); },
                    },
                    {
                        type: 'observe', target: 'dcpower', part: 'lcd',
                        msg: '电源输出 24.0V',
                        async act() {
                            await _waitFor(_sysOf(this), s => {
                                const p = _comp(s, 'dcpower');
                                return !!p && p.isOn && (p.voltage || 0) > 20;
                            }, 8000, 120);
                            await _sleep(600);
                        },
                    },
                    {
                        type: 'switch', target: 'stopvalve', part: 'handle',
                        msg: '扳动手柄，打开截止阀',
                        async act() { await _setStopValve(_sysOf(this), true); },
                    },
                    {
                        type: 'observe', target: 'difftr', part: 'chamber',
                        msg: '高低压室均未受压，差压为 0',
                        async act() { await _waitDiff(this, 0, 0.004); },
                    },
                    {
                        type: 'observe', target: 'ampmeter', part: 'lcd',
                        msg: '零差压对应 4mA（初始零点）',
                        async act() { await _waitAmp(this, 4, 0.1); },
                    },
                ],
                check() {
                    const sys = _sysOf(this);
                    const p = _comp(sys, 'dcpower');
                    const sv = _comp(sys, 'stopvalve');
                    const a = _comp(sys, 'ampmeter');
                    return !!(p && p.isOn && sv && sv.isOpen && a && Math.abs(a.value - 4) < 0.1);
                },
            },

            // ── 第 3 步：开平衡阀，确认高低压阀关闭 ──
            {
                msg: '第 3 步：开平衡阀 vE，确认 vH、vL 关闭。',
                mode: 'check',
                op: [
                    {
                        type: 'switch', target: '3valve', part: 'vE',
                        msg: '扳动平衡阀手柄，vE 开启',
                        async act() { await _setValve3(_sysOf(this), 'vE', true); },
                    },
                    {
                        type: 'observe', target: '3valve', part: 'vH',
                        msg: '高压阀 vH 保持关闭',
                        async act() {
                            await _setValve3(_sysOf(this), 'vH', false);
                            await _sleep(600);
                        },
                    },
                    {
                        type: 'observe', target: '3valve', part: 'vL',
                        msg: '低压阀 vL 保持关闭',
                        async act() {
                            await _setValve3(_sysOf(this), 'vL', false);
                            await _sleep(600);
                        },
                    },
                ],
                check() {
                    const tv = _comp(_sysOf(this), '3valve');
                    return !!(tv && tv.vE === true && tv.vH === false && tv.vL === false);
                },
            },

            // ── 第 4 步：开高、低压阀，关平衡阀，投入运行 ──
            {
                msg: '第 4 步：开高压阀、低压阀，再关平衡阀投运。',
                mode: 'check',
                op: [
                    {
                        type: 'switch', target: '3valve', part: 'vH',
                        msg: '扳动高压阀手柄，vH 开启',
                        async act() { await _setValve3(_sysOf(this), 'vH', true); },
                    },
                    {
                        type: 'switch', target: '3valve', part: 'vL',
                        msg: '扳动低压阀手柄，vL 开启',
                        async act() { await _setValve3(_sysOf(this), 'vL', true); },
                    },
                    {
                        type: 'switch', target: '3valve', part: 'vE',
                        msg: '关平衡阀 vE，系统投入工作',
                        async act() {
                            await _setValve3(_sysOf(this), 'vE', false);
                            await _sleep(800);
                        },
                    },
                ],
                check() {
                    const tv = _comp(_sysOf(this), '3valve');
                    return !!(tv && tv.vH === true && tv.vL === true && tv.vE === false);
                },
            },

            // ── 第 5 步：设定 0.1MPa 差压（H 0.4 / L 0.3）──
            {
                msg: '第 5 步：高压侧 0.4MPa、低压侧 0.3MPa，差压 0.1MPa。',
                mode: 'check',
                op: [
                    {
                        type: 'knob', target: 'pressreg', part: 'wheel',
                        msg: '右键调压阀1 →「参数设置」，设定压力 0.400MPa',
                        async act() { await _setReg(this, 'pressreg', 0.4); },
                    },
                    {
                        type: 'observe', target: 'pressreg', part: 'o',
                        msg: '高压侧输出 0.400MPa',
                        async act() { await _waitRegOut(this, 'pressreg', 0.4); },
                    },
                    {
                        type: 'knob', target: 'pressreg2', part: 'wheel',
                        msg: '右键调压阀2 →「参数设置」，设定压力 0.300MPa',
                        async act() { await _setReg(this, 'pressreg2', 0.3); },
                    },
                    {
                        type: 'observe', target: 'difftr', part: 'lcd',
                        msg: '差压 0.400−0.300 = 0.100MPa',
                        async act() { await _waitDiff(this, 0.1, 0.006); },
                    },
                    {
                        type: 'observe', target: 'ampmeter', part: 'lcd',
                        msg: '零点未调，电流约 5.60mA（不是 4mA）',
                        async act() { await _waitAmp(this, 5.6, 0.15); },
                    },
                ],
                check() {
                    const sys = _sysOf(this);
                    const r1 = _comp(sys, 'pressreg');
                    const r2 = _comp(sys, 'pressreg2');
                    const d = _comp(sys, 'difftr');
                    return !!(r1 && r2 && d
                        && Math.abs(r1.setPressure - 0.4) < 0.02
                        && Math.abs(r2.setPressure - 0.3) < 0.02
                        && Math.abs(d.press - 0.1) < 0.01);
                },
            },

            // ── 第 6 步：调零，使电流回到 4mA ──
            {
                msg: '第 6 步：调零旋钮，使输出电流回到 4mA。',
                mode: 'check',
                op: [
                    {
                        type: 'knob', target: 'difftr', part: 'zero',
                        msg: '按住调零旋钮 Z，逆时针微调零点',
                        async act() {
                            const d = _comp(_sysOf(this), 'difftr');
                            await _trimToAmp(this, d, 'zero', 4, 0.04);
                        },
                    },
                    {
                        type: 'observe', target: 'ampmeter', part: 'lcd',
                        msg: '输出电流回到 4.00mA',
                        async act() { await _waitAmp(this, 4, 0.06); },
                    },
                    {
                        type: 'observe', target: 'difftr', part: 'lcd',
                        msg: '显示差压仍为 0.100MPa（只是把 4mA 移到新零点）',
                        async act() { await _waitDiff(this, 0.1, 0.006); },
                    },
                ],
                check() {
                    const a = _comp(_sysOf(this), 'ampmeter');
                    return !!(a && Math.abs(a.value - 4) < 0.06);
                },
            },

            // ── 第 7 步：升到量程上限 0.9MPa（H 1.2 / L 0.3）──
            {
                msg: '第 7 步：高压侧 1.2MPa、低压侧 0.3MPa，差压 0.9MPa。',
                mode: 'check',
                op: [
                    {
                        type: 'knob', target: 'pressreg', part: 'wheel',
                        msg: '右键调压阀1 →「参数设置」，设定压力 1.200MPa',
                        async act() { await _setReg(this, 'pressreg', 1.2); },
                    },
                    {
                        type: 'observe', target: 'difftr', part: 'lcd',
                        msg: '差压 1.200−0.300 = 0.900MPa',
                        async act() { await _waitDiff(this, 0.9, 0.008); },
                    },
                    {
                        type: 'observe', target: 'ampmeter', part: 'lcd',
                        msg: '电流约 16.8mA，未到 20mA',
                        async act() { await _waitAmp(this, 16.8, 0.25); },
                    },
                ],
                check() {
                    const sys = _sysOf(this);
                    const r1 = _comp(sys, 'pressreg');
                    const r2 = _comp(sys, 'pressreg2');
                    const d = _comp(sys, 'difftr');
                    return !!(r1 && r2 && d
                        && Math.abs(r1.setPressure - 1.2) < 0.02
                        && Math.abs(r2.setPressure - 0.3) < 0.02
                        && Math.abs(d.press - 0.9) < 0.012);
                },
            },

            // ── 第 8 步：调量程，使电流回到 20mA ──
            {
                msg: '第 8 步：量程旋钮，使输出电流回到 20mA。',
                mode: 'check',
                op: [
                    {
                        type: 'knob', target: 'difftr', part: 'span',
                        msg: '按住量程旋钮 S，顺时针微调量程',
                        async act() {
                            const d = _comp(_sysOf(this), 'difftr');
                            await _trimToAmp(this, d, 'span', 20, 0.05);
                        },
                    },
                    {
                        type: 'observe', target: 'ampmeter', part: 'lcd',
                        msg: '输出电流回到 20.00mA',
                        async act() { await _waitAmp(this, 20, 0.08); },
                    },
                    {
                        type: 'observe', target: 'difftr', part: 'lcd',
                        msg: '满量程 0.900MPa 对应 20mA',
                        async act() { await _waitDiff(this, 0.9, 0.008); },
                    },
                ],
                check() {
                    const a = _comp(_sysOf(this), 'ampmeter');
                    return !!(a && Math.abs(a.value - 20) < 0.1);
                },
            },

            // ── 第 9 步：量程改变后零点改变，回到 0.1MPa 差压 ──
            {
                msg: '第 9 步：回到 0.1MPa 差压（H 0.4 / L 0.3）。',
                mode: 'check',
                op: [
                    {
                        type: 'knob', target: 'pressreg', part: 'wheel',
                        msg: '高压侧设定压力改回 0.400MPa',
                        async act() { await _setReg(this, 'pressreg', 0.4); },
                    },
                    {
                        type: 'observe', target: 'difftr', part: 'lcd',
                        msg: '差压回到 0.100MPa',
                        async act() { await _waitDiff(this, 0.1, 0.006); },
                    },
                    {
                        type: 'observe', target: 'ampmeter', part: 'lcd',
                        msg: '此时电流不是 4mA（量程改动影响了零点）',
                        async act() { await _sleep(1500); },
                    },
                ],
                check() {
                    const sys = _sysOf(this);
                    const r1 = _comp(sys, 'pressreg');
                    const r2 = _comp(sys, 'pressreg2');
                    const d = _comp(sys, 'difftr');
                    return !!(r1 && r2 && d
                        && Math.abs(r1.setPressure - 0.4) < 0.02
                        && Math.abs(r2.setPressure - 0.3) < 0.02
                        && Math.abs(d.press - 0.1) < 0.01);
                },
            },

            // ── 第 10 步：重新调零 ──
            {
                msg: '第 10 步：重新调零，使电流回到 4mA。',
                mode: 'check',
                op: [
                    {
                        type: 'knob', target: 'difftr', part: 'zero',
                        msg: '按住调零旋钮 Z，再次微调零点',
                        async act() {
                            const d = _comp(_sysOf(this), 'difftr');
                            await _trimToAmp(this, d, 'zero', 4, 0.04);
                        },
                    },
                    {
                        type: 'observe', target: 'ampmeter', part: 'lcd',
                        msg: '输出电流回到 4.00mA',
                        async act() { await _waitAmp(this, 4, 0.06); },
                    },
                ],
                check() {
                    const a = _comp(_sysOf(this), 'ampmeter');
                    return !!(a && Math.abs(a.value - 4) < 0.06);
                },
            },

            // ── 第 11 步：回到 0.9MPa 量程上限 ──
            {
                msg: '第 11 步：回到 0.9MPa 差压（H 1.2 / L 0.3）。',
                mode: 'check',
                op: [
                    {
                        type: 'knob', target: 'pressreg', part: 'wheel',
                        msg: '高压侧设定压力改为 1.200MPa',
                        async act() { await _setReg(this, 'pressreg', 1.2); },
                    },
                    {
                        type: 'observe', target: 'difftr', part: 'lcd',
                        msg: '差压回到 0.900MPa',
                        async act() { await _waitDiff(this, 0.9, 0.008); },
                    },
                    {
                        type: 'observe', target: 'ampmeter', part: 'lcd',
                        msg: '电流略低于 20mA，需再调量程',
                        async act() { await _sleep(1500); },
                    },
                ],
                check() {
                    const sys = _sysOf(this);
                    const r1 = _comp(sys, 'pressreg');
                    const r2 = _comp(sys, 'pressreg2');
                    const d = _comp(sys, 'difftr');
                    return !!(r1 && r2 && d
                        && Math.abs(r1.setPressure - 1.2) < 0.02
                        && Math.abs(r2.setPressure - 0.3) < 0.02
                        && Math.abs(d.press - 0.9) < 0.012);
                },
            },

            // ── 第 12 步：再次调量程至 20mA ──
            {
                msg: '第 12 步：再次调量程，使电流回到 20mA。',
                mode: 'check',
                op: [
                    {
                        type: 'knob', target: 'difftr', part: 'span',
                        msg: '按住量程旋钮 S，微调到 20mA',
                        async act() {
                            const d = _comp(_sysOf(this), 'difftr');
                            await _trimToAmp(this, d, 'span', 20, 0.05);
                        },
                    },
                    {
                        type: 'observe', target: 'ampmeter', part: 'lcd',
                        msg: '输出电流 20.00mA，量程整定完成',
                        async act() { await _waitAmp(this, 20, 0.08); },
                    },
                    {
                        type: 'observe', target: 'difftr', part: 'lcd',
                        msg: '零点 4mA ↔ 满量程 20mA 全部对应',
                        async act() { await _sleep(1500); },
                    },
                ],
                check() {
                    const a = _comp(_sysOf(this), 'ampmeter');
                    return !!(a && Math.abs(a.value - 20) < 0.1);
                },
            },
        ],
    },
};

// ═══════════════════════════════════════════════════════════════
// 五、元件布局（沿用原工程 consys.js 的坐标，单页 1920×1080）
//   左：变送器 + 三阀组；中：两只调压阀；右：三通 → 截止阀 → 气瓶
//   电气回路：24V 电源 → 可调电阻 → 变送器 → 电流表 → 电源
// ═══════════════════════════════════════════════════════════════

export const componentConfigs = [
    // ── 电气回路（左上 / 左下）──
    { Class: DCPower, id: 'dcpower', x: -60, y: 65, voltage: 24, isOn: false, visible: true },
    { Class: VariResistor, id: 'varires', x: 350, y: 165, value: 500, cvalue: 250, visible: true },
    { Class: AmpMeter, id: 'ampmeter', x: 80, y: 500, min: 0, max: 20, title: '电流表 mA', visible: true },

    // ── 被检对象：差压变送器（量程 0~1MPa，二线制 4~20mA）──
    { Class: DiffTransmitter, id: 'difftr', x: 200, y: 230, min: 0, max: 1, unit: 'MPa', visible: true },

    // ── 三阀组：outl/outh → 变送器 L/H；inl/inh ← 两路调压阀 ──
    { Class: ThreeValve, id: '3valve', x: 230, y: 480, visible: true },

    // ── 高压侧调压阀（上）与低压侧调压阀（下）──
    { Class: PressRegulator, id: 'pressreg', x: 600, y: 465, setPressure: 0, unit: 'MPa', visible: true },
    { Class: PressRegulator, id: 'pressreg2', x: 600, y: 685, setPressure: 0, unit: 'MPa', visible: true },

    // ── 三通接头：右口进气，上口 → 高压支路，下口 → 低压支路 ──
    { Class: TeeConnector, id: 'tee', x: 900, y: 585, direction: 'right', visible: true },

    // ── 截止阀：点击手柄通断气源 ──
    { Class: StopValve, id: 'stopvalve', x: 1100, y: 495, isOpen: false, visible: true },

    // ── 气瓶（气源 2MPa，试验台气源，耗气极慢以保持压力稳定）──
    { Class: AirBottle, id: 'cab', x: 1100, y: 285, initialPressure: 2, volume: 50, unit: 'MPa',
      isConsuming: false, consumptionRate: 0.002, visible: true },

    // ── 7 种标准仪表（默认隐藏，由工具栏「选择仪表」调出）──
    { Class: Multimeter, id: 'multimeter', x: 700, y: 10, visible: false },
    { Class: ProcessCalibrator, id: 'cali', x: 600, y: 100, visible: false },
    { Class: Oscilloscope_tri, id: 'osc', x: 510, y: 300, visible: false },
    { Class: SignalGenerator, id: 'sg', x: 510, y: 300, visible: false },
    { Class: MF47Multimeter, id: 'mf47-panel', x: 1400, y: 100, visible: false },
    { Class: ElecMeter, id: 'elecmeter', x: 1400, y: 620, visible: false },
    { Class: RealMegohmMeter, id: 'megohm', x: 1700, y: 300, visible: false },
];

// ═══════════════════════════════════════════════════════════════
// 六、快捷操作
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
    ALL_CONNS.forEach(c => {
        sys.connMgr.addConn({ from: c.from, to: c.to, type: c.type });
    });
    if (sys.redrawAll) sys.redrawAll();
}

/** 工具栏「起动系统」：复位 → 自动接线 → 通电 → 开截止阀 → 三阀组投运 → 加 0.1MPa 差压 */
export async function applyStartSystem() {
    const sys = _sysOf(this);
    if (!sys) return;
    try {
        _resetRig(sys);
        await _sleep(300);
        ALL_CONNS.forEach(c => {
            sys.connMgr.addConn({ from: c.from, to: c.to, type: c.type });
        });
        if (sys.redrawAll) sys.redrawAll();
        await _sleep(300);

        await _setPower(sys, true);
        await _setStopValve(sys, true);
        await _setValve3(sys, 'vE', true);
        await _setValve3(sys, 'vH', true);
        await _setValve3(sys, 'vL', true);
        await _setValve3(sys, 'vE', false);
        await _sleep(300);

        // 高压 0.4MPa / 低压 0.3MPa → 差压 0.1MPa
        const r1 = _comp(sys, 'pressreg');
        const r2 = _comp(sys, 'pressreg2');
        if (r1 && typeof r1.onConfigUpdate === 'function') {
            r1.onConfigUpdate({ id: r1.id, unit: r1.displayUnit || 'MPa', setPressure: 0.4 });
        }
        if (r2 && typeof r2.onConfigUpdate === 'function') {
            r2.onConfigUpdate({ id: r2.id, unit: r2.displayUnit || 'MPa', setPressure: 0.3 });
        }
        if (sys.redrawAll) sys.redrawAll();
        await _sleep(800);
    } catch (e) {
        console.warn('[起动系统] 执行异常：', e);
    }
}

/**
 * 工具栏「5 点步进」：差压依次取 0 / 0.25 / 0.5 / 0.75 / 1.0 MPa
 * （低压侧固定 0.3MPa，高压侧 = 0.3 + 差压），
 * 便于快速核对「0%、25%、50%、75%、100% 差压 ↔ 4/8/12/16/20mA」的线性度。
 */
export function fiveStep() {
    const sys = _sysOf(this);
    if (!sys) return;
    const r1 = _comp(sys, 'pressreg');
    const r2 = _comp(sys, 'pressreg2');
    if (!r1 || !r2) return;

    const lPress = 0.3;
    const diffs = [0, 0.25, 0.5, 0.75, 1.0];
    if (sys._diffStepIdx === undefined || sys._diffStepIdx >= diffs.length) sys._diffStepIdx = 0;
    const diff = diffs[sys._diffStepIdx];
    const hPress = +(lPress + diff).toFixed(3);

    if (typeof r1.onConfigUpdate === 'function') {
        r1.onConfigUpdate({ id: r1.id, unit: r1.displayUnit || 'MPa', setPressure: hPress });
    } else { r1.setPressure = hPress; r1.update && r1.update(); }

    if (typeof r2.onConfigUpdate === 'function') {
        r2.onConfigUpdate({ id: r2.id, unit: r2.displayUnit || 'MPa', setPressure: lPress });
    } else { r2.setPressure = lPress; r2.update && r2.update(); }

    sys._diffStepIdx = (sys._diffStepIdx + 1) % diffs.length;
    if (sys.redrawAll) sys.redrawAll();
}
