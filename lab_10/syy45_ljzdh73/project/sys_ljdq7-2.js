// ═══════════════════════════════════════════════════════════════
// 项目 7.2 —— 压力开关的功能测试和参数调整
// （由旧工程 lab_02/pressRelay 的 consys.js + lib/WorkflowManager.js
//   迁移到本平台，组件一律使用本工程 components/ 下的新组件）
//
// 组成（单页工程，全部元件同屏；仪表默认隐藏，由「选择仪表」调出）：
//   yt        压力开关 YT1226（给定值螺钉 / 幅差螺钉 / 杠杆 / 波纹管 / NC-NO-COM 触点）
//   pm        压力表（量程 0~0.4 MPa，显示三通支路压力）
//   tee       三通接头（r 进、u 去压力表、l 去压力开关）
//   pressreg  减压/稳压阀（输出 = min(输入, 设定压力)，设定压力走「参数设置」界面）
//   stopvalve 截止阀（点击手柄开/关，控制气源通断）
//   cab       气瓶（压力源 2 MPa，出气口 o）
//   multimeter 数字万用表（200Ω 电阻档检测 NC-COM 触点的通断）
//
// 一条流程（17 步，与旧工程 pressRelay/WorkflowManager.js 的步骤一一对应）：
//   ①   调整压力开关：给定值 60%（动作下限 0.12 MPa）、幅差 60%（第 6 格）
//   ②~⑥ 气路：气瓶 → 截止阀 → 调压阀 → 三通 → 压力表 / 压力开关
//   ⑦   准备万用表：调出仪表并旋到 200Ω 电阻档
//   ⑧⑨ 电路：红表笔 → NC、黑表笔 → COM（测 NC 触点通断）
//   ⑩   打开截止阀，气源进入调压阀
//   ⑪~⑰ 调压演练：0.11 → 0.13 → 0.288 → 0.308 → 0.288 → 0.13 → 0.11 MPa，
//        观察"下限闭合、中间保持、上限断开"的双位（滞环）动作特性
//
// 自动演示范式（见全局 AGENTS.md「最新范式」）：
//   · 每个 op 自带 act()：箭头指向目标 → 立即执行 → 停留观察
//   · 接线箭头指向端口（op.ports），操作箭头指向子部件（op.part）
//   · 接线 ≤8 根一律动画接线（addConnectionAnimated），逐根 await
//   · 阀门手柄一律模拟真实点击（fire 组件自身的 click 处理）
//   · 调压阀设定压力一律走「参数配置界面」（弹框 → 填值 → 点保存）
//   · 仪表一律走「选择仪表」界面（type:'instrument'）
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

import { PressRelay } from '../components/PressRelay.js';
import { PressMeter } from '../components/PressMeter.js';
import { PressRegulator } from '../components/PressRegulator.js';
import { StopValve } from '../components/StopValve.js';
import { AirBottle } from '../components/AirBottle.js';
import { TeeConnector } from '../components/TeeConnector.js';

// ═══════════════════════════════════════════════════════════════
// 一、故障（与本旧工程一致：本项目不设故障，界面为空）
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

/** 一根导线的接线 op：箭头指向两端端口，动作为动画接线 */
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

/**
 * 扳动截止阀手柄（组件自身的 click 处理器即 toggle）。
 * 已处于目标位则不重复扳动，保证流程反复演示时状态正确。
 */
async function _setValve(sys, open) {
    const sv = _comp(sys, 'stopvalve');
    if (!sv) return false;
    if (!!sv.isOpen === !!open) return true;
    const node = sv.handleGroup;
    if (node && typeof node.fire === 'function') {
        node.fire('click', { evt: { cancelBubble: false } });
    } else if (typeof sv.toggle === 'function') {
        sv.toggle();
    } else if (typeof sv.setValue === 'function') {
        sv.setValue(!!open);
    }
    await _sleep(400);
    if (!!sv.isOpen !== !!open && typeof sv.setValue === 'function') sv.setValue(!!open);   // 兜底
    if (sys && sys.redrawAll) sys.redrawAll();
    return !!sv.isOpen === !!open;
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

/** 把调压阀的设定压力调到 target（走参数配置界面） */
async function _setReg(wf, target, tip) {
    const sys = _sysOf(wf);
    const reg = _comp(sys, 'pressreg');
    if (!reg) return;
    await _demoSetCfg(wf, 'pressreg', 'setPressure', target,
        tip || `把「设定压力」改为 ${target} MPa`);
}

/** 演示前的工位复位（内部初始化，不作为教学动作） */
function _resetRig(sys) {
    if (!sys) return;
    // 清空全部连线
    if (Array.isArray(sys.conns)) sys.conns.length = 0;

    const sv = _comp(sys, 'stopvalve');
    if (sv && sv.isOpen) { sv.isOpen = false; sv.update && sv.update(); }

    const reg = _comp(sys, 'pressreg');
    if (reg) {
        if (typeof reg.onConfigUpdate === 'function') {
            reg.onConfigUpdate({ id: reg.id, unit: reg.displayUnit || 'MPa', setPressure: 0 });
        } else { reg.setPressure = 0; reg.update && reg.update(); }
    }

    const cab = _comp(sys, 'cab');
    if (cab) {
        cab.isConsuming = false;
        if (typeof cab.setPressure === 'function') cab.setPressure(2);
        else { cab.pressure = 2; cab.update && cab.update(); }
    }

    // 压力开关回到零压状态（给定值/幅差由第 1 步设置，这里不动）
    const yt = _comp(sys, 'yt');
    if (yt) { yt._forceLow = false; yt._contactFaultOpen = false; yt.update(0); }

    if (sys.redrawAll) sys.redrawAll();
}

/** 等压力开关的触点动作到位：isEnergized === want */
async function _waitRelay(ctx, want, timeout = 8000) {
    const sys = _sysOf(ctx);
    await _waitFor(sys, s => {
        const yt = _comp(s, 'yt');
        return !!yt && yt.isEnergized === want;
    }, timeout, 100);
    await _sleep(400);
}

/** 等压力表/调压阀压力稳定到 target（MPa） */
async function _waitPress(ctx, target, tol = 0.004, timeout = 8000) {
    const sys = _sysOf(ctx);
    await _waitFor(sys, s => {
        const pm = _comp(s, 'pm');
        return !!pm && Math.abs((pm.pressure || 0) - target) <= tol;
    }, timeout, 100);
    await _sleep(300);
}

/** 等万用表 200Ω 档读数进入"闭合（≈0Ω）"或"断开（O.L）" */
async function _waitOhm(ctx, closed, timeout = 8000) {
    const sys = _sysOf(ctx);
    await _waitFor(sys, s => {
        const mm = _comp(s, 'multimeter');
        if (!mm) return false;
        return closed ? (mm.value < 100) : (mm.value > 1e5);
    }, timeout, 120);
    await _sleep(300);
}

// ═══════════════════════════════════════════════════════════════
// 三、接线表（端口名随本平台组件调整，拓扑与旧工程完全一致）
// ═══════════════════════════════════════════════════════════════

// 气路：气瓶 → 截止阀 → 调压阀 → 三通 ─┬→ 压力表
//                                     └→ 压力开关
const PIPE_CONNS = [
    { from: 'cab_pipe_o', to: 'stopvalve_pipe_i', type: 'pipe' },
    { from: 'stopvalve_pipe_o', to: 'pressreg_pipe_i', type: 'pipe' },
    { from: 'pressreg_pipe_o', to: 'tee_pipe_r', type: 'pipe' },
    { from: 'tee_pipe_u', to: 'pm_pipe_i', type: 'pipe' },
    { from: 'tee_pipe_l', to: 'yt_pipe_i', type: 'pipe' },
];

// 电路：万用表红表笔 → NC，黑表笔 → COM（测常闭触点通断）
const WIRE_CONNS = [
    { from: 'multimeter_wire_v', to: 'yt_wire_NC', type: 'wire' },
    { from: 'multimeter_wire_com', to: 'yt_wire_COM', type: 'wire' },
];

// ═══════════════════════════════════════════════════════════════
// 四、调压演练步骤（第 11~17 步：双位/滞环动作特性）
//   point：'low' → 以动作下限为基准，'high' → 以动作上限为基准
//   offset：+0.01 / -0.01（MPa）
// ═══════════════════════════════════════════════════════════════

function _pressStep(stepNo, point, offset, energized, text) {
    const opName = point === 'low' ? '动作下限' : '动作上限';
    return {
        msg: `第 ${stepNo} 步：${text}`,
        mode: 'check',
        op: [
            {
                type: 'knob', target: 'pressreg', part: 'wheel',
                msg: `右键调压阀 →「参数设置」，把设定压力调到${opName}${offset > 0 ? '以上' : '以下'}`,
                async act() {
                    const sys = _sysOf(this);
                    const yt = _comp(sys, 'yt');
                    const base = (point === 'low') ? (yt ? yt.lowSet : 0.12) : (yt ? yt.highSet : 0.298);
                    const target = +(base + offset).toFixed(3);
                    await _setReg(this, target, `把「设定压力」改为 ${target} MPa（${opName}${offset > 0 ? '+' : '−'}0.01）`);
                    await _waitPress(this, target);
                },
            },
            {
                type: 'observe', target: 'pm', part: 'dial',
                msg: '压力表读数为调压阀输出压力',
                async act() {
                    const sys = _sysOf(this);
                    const yt = _comp(sys, 'yt');
                    const base = (point === 'low') ? (yt ? yt.lowSet : 0.12) : (yt ? yt.highSet : 0.298);
                    await _waitPress(this, +(base + offset).toFixed(3));
                    await _sleep(600);
                },
            },
            {
                type: 'observe', target: 'yt', part: 'contact',
                msg: energized ? 'NC 触点保持闭合，压力开关仍励磁' : 'NC 触点保持断开，压力开关仍释放',
                async act() { await _waitRelay(this, energized); },
            },
            {
                type: 'observe', target: 'multimeter', part: 'lcd',
                msg: energized ? '200Ω 档读数为 0.0Ω（触点闭合）' : '200Ω 档读数 O.L（触点断开）',
                async act() { await _waitOhm(this, energized); },
            },
        ],
        check() {
            const sys = _sysOf(this);
            const yt = _comp(sys, 'yt');
            const reg = _comp(sys, 'pressreg');
            const mm = _comp(sys, 'multimeter');
            if (!yt || !reg || !mm) return false;
            const base = (point === 'low') ? yt.lowSet : yt.highSet;
            const target = +(base + offset).toFixed(3);
            return Math.abs((reg.setPressure || 0) - target) < 0.005
                && Math.abs((reg.outputPressure || 0) - target) < 0.01
                && yt.isEnergized === energized
                && (energized ? (mm.value < 100) : (mm.value > 1e5));
        },
    };
}

// ═══════════════════════════════════════════════════════════════
// 五、工作流（步骤顺序与旧工程完全一致：1 步设参数 + 5 步气路 +
//     1 步仪表准备 + 2 步电路 + 1 步通气 + 7 步调压演练）
// ═══════════════════════════════════════════════════════════════

export const PROJECT_WORKFLOWS = {
    'pressswitch-test': {
        id: 'pressswitch-test',
        name: '1. 压力开关测操作和调整(项目7.2)',
        steps: [
            // ── 第 1 步：调压力开关的给定值与幅差 ──
            {
                msg: '第 1 步：给定值调到 60%（0.12MPa），幅差调到第 6 格。',
                mode: 'check',
                op: [
                    {
                        type: 'knob', target: 'yt', part: 'setscrew',
                        msg: '点「给定值」螺钉上半部，给定值 50% → 60%',
                        async act() {
                            const yt = _comp(_sysOf(this), 'yt');
                            if (!yt) return;
                            // 组件提供 turnSetScrew()（螺钉以"指针落在上/下半区"区分方向，
                            // 合成点击没有指针坐标），自动演示用它逐格调节，画面随动
                            if (typeof yt.turnSetScrew !== 'function') return;
                            let guard = 0;
                            while (yt.setPoint < 60 - 1e-6 && guard++ < 40) {
                                yt.turnSetScrew(1);          // 每格 2%
                                await _sleep(280);
                            }
                        },
                    },
                    {
                        type: 'observe', target: 'yt', part: 'scale',
                        msg: '给定值 60% → 动作下限 0.12 MPa',
                        async act() { await _sleep(1500); },
                    },
                    {
                        type: 'knob', target: 'yt', part: 'diffscrew',
                        msg: '点「幅差」螺钉右半部，幅差 50% → 60%（第 6 格）',
                        async act() {
                            const yt = _comp(_sysOf(this), 'yt');
                            if (!yt) return;
                            // 同上：幅差螺钉用组件的 turnDiffScrew() 逐格右旋（增大）
                            if (typeof yt.turnDiffScrew !== 'function') return;
                            let guard = 0;
                            while (yt.differential < 60 - 1e-6 && guard++ < 40) {
                                yt.turnDiffScrew(1);
                                await _sleep(280);
                            }
                        },
                    },
                    {
                        type: 'observe', target: 'yt', part: 'diffscale',
                        msg: '幅差第 6 格 → 动作上限 0.298 MPa（切换差 0.178MPa）',
                        async act() { await _sleep(1500); },
                    },
                ],
                check() {
                    const yt = _comp(_sysOf(this), 'yt');
                    return !!(yt
                        && Math.abs(yt.setPoint - 60) < 0.5
                        && Math.abs(yt.differential - 60) < 0.5
                        && Math.abs(yt.lowSet - 0.12) < 0.005
                        && Math.abs(yt.highSet - 0.298) < 0.01);
                },
            },

            // ── 第 2 步：气瓶 → 截止阀 ──
            {
                msg: '第 2 步：气路连接——气瓶出口接到截止阀进气端。',
                mode: 'check',
                op: [
                    {
                        type: 'observe', ports: ['cab_pipe_o', 'stopvalve_pipe_i'],
                        msg: '接气①：气瓶出气口 → 截止阀进气端',
                        async act() {
                            const sys = _sysOf(this);
                            _resetRig(sys);                 // 内部复位（清空旧接线、关阀、调压阀归零）
                            await _sleep(400);
                            await _wire(sys, 'cab_pipe_o', 'stopvalve_pipe_i', 'pipe');
                        },
                    },
                ],
                check() {
                    return _wired(_sysOf(this), 'cab_pipe_o', 'stopvalve_pipe_i');
                },
            },

            // ── 第 3 步：截止阀 → 调压阀 ──
            {
                msg: '第 3 步：气路连接——截止阀出口接到调压阀入口。',
                mode: 'check',
                op: [_opPipe('stopvalve_pipe_o', 'pressreg_pipe_i', '接气②：截止阀出口 → 调压阀入口')],
                check() { return _wired(_sysOf(this), 'stopvalve_pipe_o', 'pressreg_pipe_i'); },
            },

            // ── 第 4 步：调压阀 → 三通 ──
            {
                msg: '第 4 步：气路连接——调压阀出口接到三通接头。',
                mode: 'check',
                op: [_opPipe('pressreg_pipe_o', 'tee_pipe_r', '接气③：调压阀出口 → 三通接头 r 口')],
                check() { return _wired(_sysOf(this), 'pressreg_pipe_o', 'tee_pipe_r'); },
            },

            // ── 第 5 步：三通 → 压力表 ──
            {
                msg: '第 5 步：气路连接——三通上支路接到压力表进气口。',
                mode: 'check',
                op: [_opPipe('tee_pipe_u', 'pm_pipe_i', '接气④：三通 u 口 → 压力表进气口')],
                check() { return _wired(_sysOf(this), 'tee_pipe_u', 'pm_pipe_i'); },
            },

            // ── 第 6 步：三通 → 压力开关 ──
            {
                msg: '第 6 步：气路连接——三通左支路接到压力开关进气口。',
                mode: 'check',
                op: [_opPipe('tee_pipe_l', 'yt_pipe_i', '接气⑤：三通 l 口 → 压力开关进气口')],
                check() { return _wired(_sysOf(this), 'tee_pipe_l', 'yt_pipe_i'); },
            },

            // ── 第 7 步：准备万用表（200Ω 电阻档）──
            {
                msg: '第 7 步：调出万用表，档位旋到 200Ω 电阻档。',
                mode: 'check',
                op: [
                    {
                        type: 'instrument', instrument: 'multimeter',
                        msg: '选择仪表：勾选数字万用表并显示',
                        async act() { await _sleep(1200); },
                    },
                    {
                        type: 'knob', target: 'multimeter', part: 'knob',
                        msg: '把档位旋钮由 OFF 旋到 200Ω 电阻档',
                        async act() {
                            const mm = _comp(_sysOf(this), 'multimeter');
                            if (!mm) return;
                            // 组件公开 API：按档位标识切档（供自动演示用）
                            if (typeof mm.setMode === 'function') mm.setMode('RES200');
                            await _sleep(800);
                        },
                    },
                ],
                check() {
                    const sys = _sysOf(this);
                    const mm = _comp(sys, 'multimeter');
                    return !!(mm && mm.group && mm.group.visible() && mm.mode === 'RES200');
                },
            },

            // ── 第 8 步：红表笔 → NC ──
            {
                msg: '第 8 步：红表笔接到压力开关 NC 端子。',
                mode: 'check',
                op: [_opWire('multimeter_wire_v', 'yt_wire_NC', '接红表笔：VΩ 插孔 → NC 端子')],
                check() { return _wired(_sysOf(this), 'multimeter_wire_v', 'yt_wire_NC'); },
            },

            // ── 第 9 步：黑表笔 → COM ──
            {
                msg: '第 9 步：黑表笔接到压力开关 COM 端子。',
                mode: 'check',
                op: [_opWire('multimeter_wire_com', 'yt_wire_COM', '接黑表笔：COM 插孔 → COM 端子')],
                check() { return _wired(_sysOf(this), 'multimeter_wire_com', 'yt_wire_COM'); },
            },

            // ── 第 10 步：打开截止阀 ──
            {
                msg: '第 10 步：打开截止阀，气源进入调压阀。',
                mode: 'check',
                op: [
                    {
                        type: 'switch', target: 'stopvalve', part: 'handle',
                        msg: '扳动手柄，截止阀开启',
                        async act() { await _setValve(_sysOf(this), true); },
                    },
                    {
                        type: 'observe', target: 'pressreg', part: 'i',
                        msg: '气源进入调压阀，输入约 2.0 MPa（输出仍为 0）',
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

            // ── 第 11~17 步：调压演练（双位/滞环动作特性）──
            _pressStep(11, 'low', -0.01, true,
                '压力低于下限复位值（0.11MPa），NC 触点应闭合。'),
            _pressStep(12, 'low', +0.01, true,
                '压力略高于下限值（0.13MPa），幅差内保持闭合。'),
            _pressStep(13, 'high', -0.01, true,
                '压力接近上限但未达到（0.288MPa），仍保持闭合。'),
            _pressStep(14, 'high', +0.01, false,
                '压力超过上限（0.308MPa），NC 触点应立即断开。'),
            _pressStep(15, 'high', -0.01, false,
                '压力跌回上限以下（0.288MPa），因滞后仍保持断开。'),
            _pressStep(16, 'low', +0.01, false,
                '压力跌至下限上方（0.13MPa），仍保持断开。'),
            _pressStep(17, 'low', -0.01, true,
                '压力低于下限值（0.11MPa），NC 触点重新闭合。'),
        ],
    },
};

// ═══════════════════════════════════════════════════════════════
// 六、元件布局（单页 1920×1080，全部同屏；仅仪表默认隐藏）
//   左下电气检测（压力开关端子 ← 万用表），右侧气路（气瓶→截止阀→调压阀→三通→表/开关）
// ═══════════════════════════════════════════════════════════════

export const componentConfigs = [
    // ── 压力开关（被检对象，给定值/幅差可调）──
    { Class: PressRelay, id: 'yt', x: 100, y: 180, model: 'YT1226',
      lowStart: 0, lowEnd: 0.2, diffStart: 0.07, diffEnd: 0.25,
      setPoint: 50, differential: 50, visible: true },

    // ── 压力表（显示三通支路压力）──
    { Class: PressMeter, id: 'pm', x: 710, y: 300, min: 0, max: 0.4, title: '压力表 MPa', visible: true },

    // ── 三通接头：r 进，u → 压力表，l → 压力开关 ──
    { Class: TeeConnector, id: 'tee', x: 660, y: 670, direction: 'up', visible: true },

    // ── 减压/稳压阀：输出 = min(输入, 设定压力) ──
    { Class: PressRegulator, id: 'pressreg', x: 900, y: 636, setPressure: 0, unit: 'MPa', visible: true },

    // ── 截止阀：手柄点击开关 ──
    { Class: StopValve, id: 'stopvalve', x: 1200, y: 652, isOpen: false, reverse: false, visible: true },

    // ── 气瓶（气源 2 MPa）──
    { Class: AirBottle, id: 'cab', x: 1200, y: 320, initialPressure: 2, volume: 50, unit: 'MPa',
      isConsuming: false, consumptionRate: 0.02, visible: true },

    // ── 数字万用表（默认隐藏，由「选择仪表」调出）──
    //    放在压力开关右侧：表笔由插孔直接引到 NC/COM 端子，导线不横穿压力开关本体
    { Class: Multimeter, id: 'multimeter', x: 860, y: 40, visible: true },

    // ── 7 种标准仪表（默认隐藏，由工具栏「选择仪表」调出）──
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

/** 工具栏「起动系统」：复位台架 → 自动接线 → 打开截止阀 → 压力调到下限以下（触点闭合） */
export async function applyStartSystem() {
    const sys = _sysOf(this);
    if (!sys) return;
    try {
        _resetRig(sys);
        await _sleep(300);
        [...PIPE_CONNS, ...WIRE_CONNS].forEach(c => {
            sys.connMgr.addConn({ from: c.from, to: c.to, type: c.type });
        });
        const mm = _comp(sys, 'multimeter');
        if (mm) {
            if (!mm.group.visible()) mm.group.visible(true);
            if (typeof mm.setMode === 'function') mm.setMode('RES200');
        }
        if (sys.redrawAll) sys.redrawAll();
        await _sleep(300);
        await _setValve(sys, true);
        await _sleep(500);

        const yt = _comp(sys, 'yt');
        const reg = _comp(sys, 'pressreg');
        if (yt && reg) {
            const target = +Math.max(0, yt.lowSet - 0.01).toFixed(3);
            if (typeof reg.onConfigUpdate === 'function') {
                reg.onConfigUpdate({ id: reg.id, unit: reg.displayUnit || 'MPa', setPressure: target });
            } else { reg.setPressure = target; reg.update && reg.update(); }
            await _waitRelay({ sys }, true, 8000);
        }
    } catch (e) {
        console.warn('[起动系统] 执行异常：', e);
    }
}

/**
 * 工具栏「5 点步进」：按压力开关的动作下限/上限，把调压阀设定压力依次切到
 * 0.11 / 0.13 / 0.288 / 0.308 / 0.288 MPa，便于快速观察触点"闭合—保持—断开—滞后"的动作（与旧工程 fiveStep 一致）。
 */
export function fiveStep() {
    const sys = _sysOf(this);
    if (!sys) return;
    const yt = _comp(sys, 'yt');
    const reg = _comp(sys, 'pressreg');
    if (!yt || !reg) return;

    const points = [
        yt.lowSet - 0.01,
        yt.lowSet + 0.01,
        yt.highSet - 0.01,
        yt.highSet + 0.01,
        yt.highSet - 0.01,
    ];
    if (sys._pressStepIdx === undefined || sys._pressStepIdx >= points.length) sys._pressStepIdx = 0;
    const target = +Math.max(0, points[sys._pressStepIdx]).toFixed(3);

    if (typeof reg.onConfigUpdate === 'function') {
        reg.onConfigUpdate({ id: reg.id, unit: reg.displayUnit || 'MPa', setPressure: target });
    } else {
        reg.setPressure = target;
        reg.update && reg.update();
    }

    sys._pressStepIdx = (sys._pressStepIdx + 1) % points.length;
    if (sys.redrawAll) sys.redrawAll();
}
