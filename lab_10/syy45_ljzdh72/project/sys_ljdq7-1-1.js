// ═══════════════════════════════════════════════════════════════
// 项目 7.1.1 —— 温度传感器的测试（由旧工程 lab_02/tempSensor 迁移并适配本平台）
//
// 组成（单页工程，全部元件同屏）：
//   temptest   恒温水浴（恒温槽）：温度设定旋钮、加热电源开关、槽温 LCD、加热盘管
//   pt         实物 PT100 铂电阻（三线制：L 红 / T 蓝 / R 蓝，T-R 端内短接）
//   tc         实物 K 型热电偶（R 正 / L 负，温差电动势 α≈0.041 mV/℃）
//   multimeter 数字万用表（电阻档、通断档、直流毫伏档）
//
// 两条流程：
//   1. PT100 温度传感器的测试
//      · 200Ω 档测 T-R 同色端（≈0Ω）→ 验证三线制特征
//      · 测 L-R 不同色端（20℃ ≈107.7Ω）
//      · 故障设置/修复：断路（O.L）、短路（≈0Ω）
//      · 探头插入水槽、旋钮设定 50℃、通电加热 → 阻值升到 ≈119.3Ω
//   2. K 型热电偶的测试
//      · 通断档测热偶冷端电阻（<5Ω，蜂鸣器响）
//      · 直流毫伏档测常温热电势（≈0mV）
//      · 探头插入水槽、加热到 50℃ / 70℃ → 1.2mV / 2.0mV
//
// 自动演示范式（见全局 AGENTS.md「最新范式」）：
//   · 每个 op 自带 act()：箭头指向目标 → 立即执行 → 停留观察
//   · 接线箭头指向端口（op.ports），操作箭头指向子部件（op.part）
//   · 接线 ≤8 根一律动画接线（addConnectionAnimated），逐根 await
//   · 故障一律走「故障设置」界面（type:'fault'），仪表一律走「选择仪表」界面（type:'instrument'）
//   · 按钮/开关/旋钮一律模拟真实点击（getClickablePartNode().fire('click')）
//   · 等待一律条件轮询 _waitFor，不写死 sleep 猜时间
//   · 单页工程：不导出 PROJECT_PAGES，工作流不写 page op
// ═══════════════════════════════════════════════════════════════

import { WaterBath } from '../components/WaterBath.js';
import { RealPT100 } from '../components/RealPT100.js';
import { RealTC } from '../components/RealTC.js';
import { Multimeter } from '../components/Multimeter.js';
import { MF47Multimeter } from '../components/MF47Multimeter.js';
import { Oscilloscope_tri } from '../components/Osc_tri.js';
import { SignalGenerator } from '../components/SignalGenerator.js';
import { ProcessCalibrator } from '../components/ProcessCalibrator.js';
import { ElecMeter } from '../components/ElecMeter.js';
import { RealMegohmMeter } from '../components/RealMegohmMeter.js';

// ═══════════════════════════════════════════════════════════════
// 一、故障（一律通过「故障设置」界面勾选后应用）
// ═══════════════════════════════════════════════════════════════

export const FAULT_CONFIGS = {
    // ── 1. PT100 热电阻断路：R_pt = 1GΩ，万用表 200Ω 档溢出显示 O.L ──
    'pt-open': {
        id: 'pt-open', name: 'PT100 热电阻断路', system: 'PT100 传感器',
        check() {
            const c = window.sys && window.sys.comps && window.sys.comps.pt;
            return !!(c && c.isOpen === true);
        },
        trigger() {
            const c = window.sys && window.sys.comps && window.sys.comps.pt;
            if (c && c.setOpenFault) c.setOpenFault(true);
        },
        repair() {
            const c = window.sys && window.sys.comps && window.sys.comps.pt;
            if (c && c.setOpenFault) c.setOpenFault(false);
        },
    },
    // ── 2. PT100 热电阻短路：R_pt = 0.01Ω，万用表读数≈0Ω ──
    'pt-short': {
        id: 'pt-short', name: 'PT100 热电阻短路', system: 'PT100 传感器',
        check() {
            const c = window.sys && window.sys.comps && window.sys.comps.pt;
            return !!(c && c.isShort === true);
        },
        trigger() {
            const c = window.sys && window.sys.comps && window.sys.comps.pt;
            if (c && c.setShortFault) c.setShortFault(true);
        },
        repair() {
            const c = window.sys && window.sys.comps && window.sys.comps.pt;
            if (c && c.setShortFault) c.setShortFault(false);
        },
    },
};

// ═══════════════════════════════════════════════════════════════
// 二、通用辅助（模拟真实交互 + 条件轮询，不直改内部字段）
// ═══════════════════════════════════════════════════════════════

const _sleep = (ms) => new Promise(r => setTimeout(r, ms));
const _sysOf = (ctx) => (ctx && ctx.sys) ? ctx.sys : window.sys;
const _comp = (sys, id) => (sys && sys.comps) ? sys.comps[id] : null;

const _mm = (ctx) => _comp(_sysOf(ctx), 'multimeter');
const _bath = (ctx) => _comp(_sysOf(ctx), 'temptest');
const _pt = (ctx) => _comp(_sysOf(ctx), 'pt');
const _tc = (ctx) => _comp(_sysOf(ctx), 'tc');

/** 条件轮询等待（不写死 sleep 猜时间） */
async function _waitFor(sys, cond, timeout = 10000, interval = 120) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
        try { if (cond(sys)) return true; } catch (e) { /* ignore */ }
        await _sleep(interval);
    }
    try { return !!cond(sys); } catch (e) { return false; }
}

/** 等万用表读数满足条件 */
async function _waitRead(ctx, cond, timeout = 10000) {
    const sys = _sysOf(ctx);
    return _waitFor(sys, s => {
        const m = _comp(s, 'multimeter');
        return !!m && m.mode !== 'OFF' && cond(m.value, m);
    }, timeout);
}

/** 万用表是否已从「选择仪表」调出 */
function _mmShown(ctx) {
    const m = _mm(ctx);
    return !!(m && m.group && m.group.visible());
}

/** 触发部件命中节点的真实事件（执行组件自身的点击处理逻辑） */
function _firePart(comp, partId, evt = 'click') {
    if (!comp || typeof comp.getClickablePartNode !== 'function') return false;
    const node = comp.getClickablePartNode(partId);
    if (!node) return false;
    try { node.fire(evt, { evt: { cancelBubble: false } }); } catch (e) { return false; }
    return true;
}

/** 模拟点击部件（开关/旋钮/按钮） */
async function _clickPart(comp, partId, waitMs = 320) {
    if (!_firePart(comp, partId, 'click')) return false;
    await _sleep(waitMs);
    return true;
}

/** 无向判断两端口是否已接线 */
function _wired(sys, a, b) {
    return !!(sys && Array.isArray(sys.conns) && sys.conns.some(c =>
        c && c.type === 'wire' && ((c.from === a && c.to === b) || (c.from === b && c.to === a))));
}

/** 动画接一根导线（≤8 根一律逐根动画，约 3s/根；已接则跳过） */
async function _wire(ctx, from, to) {
    const sys = _sysOf(ctx);
    if (!sys || _wired(sys, from, to)) return true;
    await sys.connMgr.addConnectionAnimated({ from, to, type: 'wire' });
    await _sleep(200);
    return true;
}

/** 拆掉一根导线（就地删除，保持 conns 引用不变） */
function _unwire(ctx, from, to) {
    const sys = _sysOf(ctx);
    if (!sys || !Array.isArray(sys.conns)) return;
    for (let i = sys.conns.length - 1; i >= 0; i--) {
        const c = sys.conns[i];
        if (!c || c.type !== 'wire') continue;
        if ((c.from === from && c.to === to) || (c.from === to && c.to === from)) sys.conns.splice(i, 1);
    }
    if (sys.redrawAll) sys.redrawAll();
}

/** 数字万用表换挡（调用组件公开方法，旋钮指针同步） */
function _setMM(ctx, mode) {
    const m = _mm(ctx);
    if (!m) return;
    if (typeof m.setMode === 'function') m.setMode(mode);
    else { m.mode = mode; if (m._updateAngleByMode) m._updateAngleByMode(); }
    if (m.sys && m.sys.redrawAll) m.sys.redrawAll();
}

/** 逐帧把组件移动到目标位置（模拟"拿起探头 → 插入水槽"的拖动过程） */
async function _animMoveTo(sys, comp, tx, ty, steps = 22, delay = 28) {
    const x0 = comp.group.x(), y0 = comp.group.y();
    if (Math.abs(tx - x0) < 1 && Math.abs(ty - y0) < 1) return;
    for (let i = 1; i <= steps; i++) {
        const k = i / steps;
        comp.group.position({ x: x0 + (tx - x0) * k, y: y0 + (ty - y0) * k });
        if (sys && sys.redrawAll) sys.redrawAll();
        await _sleep(delay);
    }
}

/** 探头是否浸在水槽水位区域内（判定与 WaterBath.tick 的耦合判定一致） */
function _probeInWater(sys, compId) {
    const c = _comp(sys, compId), bath = _comp(sys, 'temptest');
    if (!c || !bath || !c.probe || !bath.waterRect) return false;
    const p = c.probe.getClientRect(), w = bath.waterRect.getClientRect();
    return !(p.x > w.x + w.width || p.x + p.width < w.x || p.y > w.y + w.height || p.y + p.height < w.y);
}

/** 把探头插入水槽（fx：探头落在水槽宽度的相对位置 0~1，两个探头错开摆放） */
async function _insertProbe(ctx, compId, fx = 0.3) {
    const sys = _sysOf(ctx);
    const c = _comp(sys, compId), bath = _comp(sys, 'temptest');
    if (!c || !bath || !c.probe || !bath.waterRect) return false;
    if (_probeInWater(sys, compId)) return true;
    if (c._homeX === undefined) { c._homeX = c.group.x(); c._homeY = c.group.y(); }
    const pr = c.probe.getClientRect();
    const wr = bath.waterRect.getClientRect();
    const dx = (wr.x + wr.width * fx) - (pr.x + pr.width / 2);
    const dy = (wr.y + wr.height * 0.5) - (pr.y + pr.height / 2);
    await _animMoveTo(sys, c, c.group.x() + dx, c.group.y() + dy);
    return _probeInWater(sys, compId);
}

/** 把探头移回原位（取出水槽） */
async function _probeHome(ctx, compId) {
    const sys = _sysOf(ctx);
    const c = _comp(sys, compId);
    if (!c || c._homeX === undefined) return;
    await _animMoveTo(sys, c, c._homeX, c._homeY);
}

/** 用旋钮把设定温度调到目标值（点击旋钮右/左半区，每次 ±5℃；点不到时用公开方法兜底） */
async function _ensureTargetTemp(ctx, want) {
    const b = _bath(ctx);
    if (!b) return false;
    for (let i = 0; i < 20 && b.targetTemp < want - 0.1; i++) {
        if (!_firePart(b, 'knob-inc')) break;
        await _sleep(240);
    }
    for (let i = 0; i < 20 && b.targetTemp > want + 0.1; i++) {
        if (!_firePart(b, 'knob-dec')) break;
        await _sleep(240);
    }
    if (Math.abs(b.targetTemp - want) > 0.1 && typeof b.setTargetTemp === 'function') b.setTargetTemp(want);
    await _sleep(200);
    return Math.abs(b.targetTemp - want) < 0.1;
}

/** 打开水浴加热电源（点击电源开关） */
async function _heatingOn(ctx) {
    const b = _bath(ctx);
    if (!b) return false;
    for (let i = 0; i < 3 && !b.isHeating; i++) {
        _firePart(b, 'power');
        await _sleep(320);
    }
    return !!b.isHeating;
}

/** 关闭水浴加热电源 */
async function _heatingOff(ctx) {
    const b = _bath(ctx);
    if (!b || !b.isHeating) return;
    _firePart(b, 'power');
    await _sleep(300);
}

/** 一根导线的交接 op：箭头指向两端端口，动作为动画接线 */
function _opWire(from, to, msg) {
    return {
        type: 'observe', ports: [from, to], msg,
        async act() { await _wire(this, from, to); },
    };
}

/** 一根导线的拆除 op：箭头指向两端端口，动作为拆线 */
function _opUnwire(from, to, msg) {
    return {
        type: 'observe', ports: [from, to], msg,
        async act() { _unwire(this, from, to); await _sleep(400); },
    };
}

// ═══════════════════════════════════════════════════════════════
// 三、工作流
// ═══════════════════════════════════════════════════════════════

export const PROJECT_WORKFLOWS = {
    // ───────────────────────────────────────────────────────────
    // 1. PT100 温度传感器的测试（9 步，与原工程步骤一一对应）
    //    ① 拨 200Ω 档 ② 同色端 0Ω ③ 不同色端 107.7Ω
    //    ④ 开路→O.L ⑤ 修复开路 ⑥ 短路→0Ω ⑦ 修复短路
    //    ⑧ 探头入水槽 ⑨ 加热 50℃ → 119.3Ω
    // ───────────────────────────────────────────────────────────
    'pt100-test': {
        id: 'pt100-test',
        name: '1. PT100 温度传感器的测试（项目 7.1.1）',
        steps: [
            {
                msg: '第 1 步：准备检测，把万用表旋钮拨到 200Ω 电阻档。',
                mode: 'check',
                op: [
                    {
                        type: 'instrument', instrument: 'multimeter',
                        msg: '从「选择仪表」调出数字万用表',
                        async act() { await _sleep(500); },
                    },
                    {
                        type: 'knob', target: 'multimeter', part: 'knob',
                        msg: '旋钮拨到 200Ω 电阻档',
                        async act() { _setMM(this, 'RES200'); await _sleep(600); },
                    },
                    {
                        type: 'observe', target: 'multimeter', part: 'lcd',
                        msg: '表笔未接，显示 O.L',
                        async act() { await _sleep(1200); },
                    },
                ],
                check() {
                    const m = _mm(this);
                    return _mmShown(this) && !!m && m.mode === 'RES200';
                },
            },
            {
                msg: '第 2 步：测同色两端（T、R），三线制阻值约 0Ω。',
                mode: 'check',
                op: [
                    {
                        type: 'observe', target: 'pt', part: 'probe',
                        msg: 'PT100 探头置于水槽外（环境温度）',
                        async act() { await _probeHome(this, 'pt'); },
                    },
                    {
                        type: 'switch', target: 'temptest', part: 'power',
                        msg: '确认水浴未加热',
                        async act() { await _heatingOff(this); },
                    },
                    _opWire('multimeter_wire_v', 'pt_wire_t', '红表笔(V) → PT100 的 T 端'),
                    _opWire('multimeter_wire_com', 'pt_wire_r', '黑表笔(COM) → PT100 的 R 端'),
                    {
                        type: 'observe', target: 'multimeter', part: 'lcd',
                        msg: '读数≈0Ω：T、R 为同色引线（三线制补偿引线电阻）',
                        async act() { await _waitRead(this, v => v < 0.5, 8000); },
                    },
                ],
                check() {
                    const sys = _sysOf(this), m = _mm(this), b = _bath(this);
                    return _mmShown(this) && !!m && m.mode === 'RES200'
                        && !_probeInWater(sys, 'pt') && !!b && !b.isHeating
                        && _wired(sys, 'multimeter_wire_v', 'pt_wire_t')
                        && _wired(sys, 'multimeter_wire_com', 'pt_wire_r')
                        && m.value < 0.5;
                },
            },
            {
                msg: '第 3 步：测不同色两端（L、R），常温阻值约 107.7Ω。',
                mode: 'check',
                op: [
                    _opUnwire('multimeter_wire_v', 'pt_wire_t', '取下 T 端的红表笔'),
                    _opWire('multimeter_wire_v', 'pt_wire_l', '红表笔(V) → PT100 的 L 端（红色引线）'),
                    {
                        type: 'observe', target: 'multimeter', part: 'lcd',
                        msg: '读数≈107.7Ω，即 20℃ 时的阻值',
                        async act() { await _waitRead(this, v => Math.abs(v - 107.7) < 1.5, 8000); },
                    },
                ],
                check() {
                    const sys = _sysOf(this), m = _mm(this);
                    return _wired(sys, 'multimeter_wire_v', 'pt_wire_l')
                        && _wired(sys, 'multimeter_wire_com', 'pt_wire_r')
                        && !!m && Math.abs(m.value - 107.7) < 1.5;
                },
            },
            {
                msg: '第 4 步：设置 PT100 开路故障，观察读数溢出（O.L）。',
                mode: 'check',
                op: [
                    {
                        type: 'fault', fault: 'pt-open',
                        msg: '勾选「PT100 热电阻断路」并应用',
                        async act() { await _waitFor(_sysOf(this), s => !!_pt(s) && _pt(s).isOpen, 4000); },
                    },
                    {
                        type: 'observe', target: 'multimeter', part: 'lcd',
                        msg: '读数溢出，显示 O.L',
                        async act() { await _waitRead(this, v => v > 1e5, 6000); },
                    },
                ],
                check() {
                    const m = _mm(this), pt = _pt(this);
                    return !!pt && pt.isOpen === true && !!m && m.value > 1e5;
                },
            },
            {
                msg: '第 5 步：修复开路故障，确认读数恢复到 107.7Ω。',
                mode: 'check',
                op: [
                    {
                        type: 'fault', fault: 'pt-open', repair: true,
                        msg: '取消勾选断路并应用，修复故障',
                        async act() { await _waitFor(_sysOf(this), s => !!_pt(s) && !_pt(s).isOpen, 4000); },
                    },
                    {
                        type: 'observe', target: 'multimeter', part: 'lcd',
                        msg: '读数恢复约 107.7Ω',
                        async act() { await _waitRead(this, v => Math.abs(v - 107.7) < 1.5, 6000); },
                    },
                ],
                check() {
                    const m = _mm(this), pt = _pt(this);
                    return !!pt && !pt.isOpen && !!m && Math.abs(m.value - 107.7) < 1.5;
                },
            },
            {
                msg: '第 6 步：设置 PT100 短路故障，观察读数归零。',
                mode: 'check',
                op: [
                    {
                        type: 'fault', fault: 'pt-short',
                        msg: '勾选「PT100 热电阻短路」并应用',
                        async act() { await _waitFor(_sysOf(this), s => !!_pt(s) && _pt(s).isShort, 4000); },
                    },
                    {
                        type: 'observe', target: 'multimeter', part: 'lcd',
                        msg: '读数≈0Ω（远小于 107.7Ω）',
                        async act() { await _waitRead(this, v => v < 0.5, 6000); },
                    },
                ],
                check() {
                    const m = _mm(this), pt = _pt(this);
                    return !!pt && pt.isShort === true && !!m && m.value < 0.5;
                },
            },
            {
                msg: '第 7 步：修复短路故障，确认读数恢复为当前阻值。',
                mode: 'check',
                op: [
                    {
                        type: 'fault', fault: 'pt-short', repair: true,
                        msg: '取消勾选短路并应用，修复故障',
                        async act() { await _waitFor(_sysOf(this), s => !!_pt(s) && !_pt(s).isShort, 4000); },
                    },
                    {
                        type: 'observe', target: 'multimeter', part: 'lcd',
                        msg: '读数恢复到 107.7Ω 左右',
                        async act() { await _waitRead(this, v => Math.abs(v - 107.7) < 1.5, 6000); },
                    },
                ],
                check() {
                    const m = _mm(this), pt = _pt(this);
                    return !!pt && !pt.isShort && !!m && Math.abs(m.value - 107.7) < 1.5;
                },
            },
            {
                msg: '第 8 步：把 PT100 探头插入恒温水槽。',
                mode: 'check',
                op: [
                    {
                        type: 'observe', target: 'pt', part: 'probe',
                        msg: '拿起探头，插入水槽水中',
                        async act() { await _insertProbe(this, 'pt', 0.3); },
                    },
                    {
                        type: 'observe', target: 'temptest', part: 'water',
                        msg: '探头已浸入水中，感受槽内水温',
                        async act() { await _sleep(1200); },
                    },
                ],
                check() {
                    return _probeInWater(_sysOf(this), 'pt');
                },
            },
            {
                msg: '第 9 步：水槽加热至 50℃，阻值升至约 119.3Ω。',
                mode: 'check',
                op: [
                    {
                        type: 'knob', target: 'temptest', part: 'knob-inc',
                        msg: '温度设定旋钮调到 50℃',
                        async act() { await _ensureTargetTemp(this, 50); },
                    },
                    {
                        type: 'switch', target: 'temptest', part: 'power',
                        msg: '打开水浴电源，开始加热',
                        async act() { await _heatingOn(this); },
                    },
                    {
                        type: 'observe', target: 'temptest', part: 'lcd',
                        msg: '槽温逐渐升高到 50℃',
                        async act() {
                            await _waitFor(_sysOf(this), s => {
                                const b = _comp(s, 'temptest');
                                return !!b && Math.abs(b.currentTemp - 50) < 1.5;
                            }, 120000, 300);
                        },
                    },
                    {
                        type: 'observe', target: 'multimeter', part: 'lcd',
                        msg: '阻值随之升到约 119.3Ω',
                        async act() { await _waitRead(this, v => Math.abs(v - 119.3) < 1.5, 15000); },
                    },
                ],
                check() {
                    const b = _bath(this), m = _mm(this);
                    return _probeInWater(_sysOf(this), 'pt')
                        && !!b && !!b.isHeating && Math.abs(b.currentTemp - 50) < 2
                        && !!m && Math.abs(m.value - 119.3) < 1.5;
                },
            },
        ],
    },

    // ───────────────────────────────────────────────────────────
    // 2. K 型热电偶的测试（6 步，与原工程步骤一一对应）
    //    ① 拨通断档 ② 通断检测<5Ω ③ 拨直流毫伏档 0mV
    //    ④ 探头入水槽 ⑤ 50℃ → 1.2mV ⑥ 70℃ → 2.0mV
    // ───────────────────────────────────────────────────────────
    'tc-test': {
        id: 'tc-test',
        name: '2. K 型热电偶的测试（项目 7.1.1）',
        steps: [
            {
                msg: '第 1 步：准备检测，把万用表旋钮拨到通断（二极管）档。',
                mode: 'check',
                op: [
                    {
                        type: 'instrument', instrument: 'multimeter',
                        msg: '从「选择仪表」调出数字万用表',
                        async act() { await _sleep(500); },
                    },
                    {
                        type: 'knob', target: 'multimeter', part: 'knob',
                        msg: '旋钮拨到通断（二极管/蜂鸣）档',
                        async act() { _setMM(this, 'DIODE'); await _sleep(600); },
                    },
                ],
                check() {
                    const m = _mm(this);
                    return _mmShown(this) && !!m && m.mode === 'DIODE';
                },
            },
            {
                msg: '第 2 步：接热电偶 R、L 两端，内部阻值应小于 5Ω。',
                mode: 'check',
                op: [
                    _opUnwire('multimeter_wire_v', 'pt_wire_l', '拆下接 PT100 的红表笔'),
                    _opUnwire('multimeter_wire_com', 'pt_wire_r', '拆下接 PT100 的黑表笔'),
                    _opWire('multimeter_wire_v', 'tc_wire_r', '红表笔(V) → 热电偶 R 端（正极）'),
                    _opWire('multimeter_wire_com', 'tc_wire_l', '黑表笔(COM) → 热电偶 L 端（负极）'),
                    {
                        type: 'observe', target: 'multimeter', part: 'lcd',
                        msg: '蜂鸣器响、约 0.5Ω，说明热偶丝完好',
                        async act() { await _waitRead(this, v => v < 0.005, 8000); },
                    },
                ],
                check() {
                    const sys = _sysOf(this), m = _mm(this);
                    return !!m && m.mode === 'DIODE'
                        && _wired(sys, 'multimeter_wire_v', 'tc_wire_r')
                        && _wired(sys, 'multimeter_wire_com', 'tc_wire_l')
                        && m.value < 0.005;
                },
            },
            {
                msg: '第 3 步：旋钮拨到直流毫伏档，常温热电势约 0mV。',
                mode: 'check',
                op: [
                    {
                        type: 'knob', target: 'multimeter', part: 'knob',
                        msg: '旋钮拨到 200mV 直流电压档',
                        async act() { _setMM(this, 'DCVmv'); await _sleep(600); },
                    },
                    {
                        type: 'observe', target: 'multimeter', part: 'lcd',
                        msg: '冷热端同温，热电势约为 0mV',
                        async act() { await _waitRead(this, v => Math.abs(v * 1000) < 0.3, 8000); },
                    },
                ],
                check() {
                    const m = _mm(this);
                    return !!m && m.mode === 'DCVmv' && Math.abs(m.value * 1000) < 0.3;
                },
            },
            {
                msg: '第 4 步：把热电偶探头插入恒温水槽。',
                mode: 'check',
                op: [
                    {
                        type: 'observe', target: 'tc', part: 'probe',
                        msg: '拿起热电偶，插入水槽水中',
                        async act() { await _insertProbe(this, 'tc', 0.7); },
                    },
                    {
                        type: 'observe', target: 'temptest', part: 'water',
                        msg: '工作端浸入水中，与冷端形成温差',
                        async act() { await _sleep(1200); },
                    },
                ],
                check() {
                    return _probeInWater(_sysOf(this), 'tc');
                },
            },
            {
                msg: '第 5 步：水槽加热至 50℃，热电势约 1.2mV。',
                mode: 'check',
                op: [
                    {
                        type: 'knob', target: 'temptest', part: 'knob-inc',
                        msg: '温度设定旋钮调到 50℃',
                        async act() { await _ensureTargetTemp(this, 50); },
                    },
                    {
                        type: 'switch', target: 'temptest', part: 'power',
                        msg: '合上水浴电源，加热',
                        async act() { await _heatingOn(this); },
                    },
                    {
                        type: 'observe', target: 'multimeter', part: 'lcd',
                        msg: '温差 30℃，热电势约 1.2mV',
                        async act() {
                            await _waitFor(_sysOf(this), s => {
                                const b = _comp(s, 'temptest'), m = _comp(s, 'multimeter');
                                return !!b && !!m && Math.abs(b.currentTemp - 50) < 1.5
                                    && Math.abs(m.value * 1000 - 1.2) < 0.3;
                            }, 120000, 300);
                        },
                    },
                ],
                check() {
                    const b = _bath(this), m = _mm(this);
                    return !!b && Math.abs(b.currentTemp - 50) < 2
                        && !!m && Math.abs(m.value * 1000 - 1.2) < 0.3;
                },
            },
            {
                msg: '第 6 步：继续加热至 70℃，热电势增至约 2.0mV。',
                mode: 'check',
                op: [
                    {
                        type: 'knob', target: 'temptest', part: 'knob-inc',
                        msg: '温度设定旋钮调到 70℃',
                        async act() { await _ensureTargetTemp(this, 70); },
                    },
                    {
                        type: 'observe', target: 'temptest', part: 'lcd',
                        msg: '槽温继续升到 70℃',
                        async act() {
                            await _waitFor(_sysOf(this), s => {
                                const b = _comp(s, 'temptest');
                                return !!b && Math.abs(b.currentTemp - 70) < 1.5;
                            }, 90000, 300);
                        },
                    },
                    {
                        type: 'observe', target: 'multimeter', part: 'lcd',
                        msg: '热电势升至约 2.0mV（温差 50℃）',
                        async act() { await _waitRead(this, v => Math.abs(v * 1000 - 2.0) < 0.3, 20000); },
                    },
                ],
                check() {
                    const b = _bath(this), m = _mm(this);
                    return !!b && Math.abs(b.currentTemp - 70) < 2
                        && !!m && Math.abs(m.value * 1000 - 2.0) < 0.3;
                },
            },
        ],
    },
};

// ═══════════════════════════════════════════════════════════════
// 四、元件布局（单页 1920×1080，全部同屏；仅仪表默认隐藏）
// ═══════════════════════════════════════════════════════════════

export const componentConfigs = [
    // ── 恒温水浴：水槽区域（本地）x 80~250、y 50~170 ──
    { Class: WaterBath, id: 'temptest', x: 140, y: 680, targetTemp: 20, label: '恒温水浴', scale: 1.2, visible: true },

    // ── 被测试的温度传感器（探头朝下，位于水槽右上方待插入）──
    { Class: RealPT100, id: 'pt', x: 260, y: 260, r0: 100, label: 'PT100 铂电阻', scale:1.2,visible: true },
    { Class: RealTC, id: 'tc', x: 500, y: 260, label: 'K 型热电偶',scale:0.9, visible: true },

    // ── 数字万用表（默认隐藏，由工具栏「选择仪表」调出）──
    { Class: Multimeter, id: 'multimeter', x: 780, y: 290, width: 240, height: 400, visible: false },

    // ── 其余标准仪表停靠（默认隐藏）──
    { Class: MF47Multimeter, id: 'mf47-panel', x: 1050, y: 150, visible: false },
    { Class: Oscilloscope_tri, id: 'osc', x: 50, y: 50, visible: false },
    { Class: SignalGenerator, id: 'sg', x: 50, y: 50, visible: false },
    { Class: ProcessCalibrator, id: 'cali', x: 50, y: 50, visible: false },
    { Class: ElecMeter, id: 'elecmeter', x: 50, y: 50, visible: false },
    { Class: RealMegohmMeter, id: 'megohm', x: 50, y: 50, visible: false },
];

// ═══════════════════════════════════════════════════════════════
// 五、快捷操作
// ═══════════════════════════════════════════════════════════════

export function initSlider(_sys) {
    // 自动演示时只保留箭头指示，不闪亮整个组件
    _sys._noBlinkHighlight = true;
}

/** 自动接线：初始化（opts.init=true）时不预接线 */
export function applyAllPresets(opts) {
    if (opts && opts.init) return;
    const sys = (this && this.sys) ? this.sys : window.sys;
    if (!sys) return;
    // 默认测阻值接法：红表笔 → PT100 L 端，黑表笔 → PT100 R 端
    ['multimeter_wire_v|pt_wire_l', 'multimeter_wire_com|pt_wire_r'].forEach(k => {
        const [from, to] = k.split('|');
        if (!_wired(sys, from, to)) sys.connMgr.addConn({ from, to, type: 'wire' });
    });
    if (sys.redrawAll) sys.redrawAll();
}

/** 起动系统：调出万用表置 200Ω 档 → 接线 → 探头入水 → 设定 50℃ 加热 */
export async function applyStartSystem() {
    const sys = (this && this.sys) ? this.sys : window.sys;
    if (!sys) return;
    try {
        const ctx = { sys };
        const mm = _comp(sys, 'multimeter');
        if (mm && mm.group) { mm.group.visible(true); mm.group.listening(true); }
        _setMM(ctx, 'RES200');
        await _sleep(300);

        if (!_wired(sys, 'multimeter_wire_v', 'pt_wire_l')) {
            sys.connMgr.addConn({ from: 'multimeter_wire_v', to: 'pt_wire_l', type: 'wire' });
        }
        if (!_wired(sys, 'multimeter_wire_com', 'pt_wire_r')) {
            sys.connMgr.addConn({ from: 'multimeter_wire_com', to: 'pt_wire_r', type: 'wire' });
        }
        if (sys.redrawAll) sys.redrawAll();

        await _insertProbe(ctx, 'pt', 0.3);
        await _ensureTargetTemp(ctx, 50);
        await _heatingOn(ctx);
        await _waitFor(sys, s => {
            const b = _comp(s, 'temptest');
            return !!b && Math.abs(b.currentTemp - 50) < 1.5;
        }, 120000, 300);
    } catch (e) {
        console.warn('[起动系统] 执行异常：', e);
    }
}

export function fiveStep() {
    // 本工程无 PID 回路，5 点步进不适用
}
