// 船舶发电机组并车操作仿真工程
// （两台同步发电机 + 两台船用框架式空气断路器主开关 + 汇流排 + 数字同步表 + 遥控面板）
//
// 电路组成（单页工程，全部元件同屏）：
//   1#机组  gen1（80 kW 同步发电机）→ qf1 主开关 → bus1 汇流排第 1 列
//   2#机组  gen2（80 kW 同步发电机）→ qf2 主开关 → bus1 汇流排第 7 列
//   馈出    bus1 第 8 列 → acb_l（QF3）→ lamp1~3 三盏白炽灯
//   负载    bus1 第 5 列 → load3 三相可调负载（20 kW）
//   测量    sync1 数字同步表：bus=汇流排 A 相、gen=待并机 A 相（经 sync_sel）、gnd=船体地
//   选择    sync_sel 单刀四掷：1=OFF、2=1#机、3=2#机、4=预留
//   控制    dc_uv / dc_uv2（DC 24 V）→ 失压脱扣线圈、储能电机、合闸/分励线圈
//           genpanel / genpanel2 发电机组遥控面板 → 遥控起动/停止、调速、合闸/分闸
//
// 约定（与全局 AGENTS.md「最新范式」一致）：
//   · 单页工程：不导出 PROJECT_PAGES，consys.js 不创建 PageManager，工作流无 page op
//   · 默认不接线：applyAllPresets({init:true}) 不接线；只有「自动接线 / 起动系统 / 工作流 op」才接线
//   · 故障一律走「故障设置」界面（op.type='fault'），不直接改组件故障标志
//   · 按钮/旋钮/开关一律模拟真实操作（getClickablePartNode(...).fire('mousedown'/'mouseup'/'click')）
//   · 调速一律按住遥控面板的调速旋钮（knob-inc / knob-dec）直到条件满足，不直接赋 gen.freq
//   · 等待一律用条件轮询 _waitFor，不写死 sleep 猜时间

import { SyncGenerator3P } from '../components/SyncGenerator3P.js';
import { Busbar3P } from '../components/Busbar3P.js';
import { MarineMainsSwitch } from '../components/MarineMainsSwitch.js';
import { GeneratorRemotePanel } from '../components/GeneratorRemotePanel.js';
import { DCPower } from '../components/DCPower.js';
import { Ground } from '../components/Gnd.js';
import { DiagramThreePhaseACB } from '../components/DiagramThreePhaseACB.js';
import { IncandescentLamp } from '../components/IncandescentLamp.js';
import { Multimeter } from '../components/Multimeter.js';
import { MF47Multimeter } from '../components/MF47Multimeter.js';
import { Oscilloscope_tri } from '../components/Osc_tri.js';
import { SignalGenerator } from '../components/SignalGenerator.js';
import { ProcessCalibrator } from '../components/ProcessCalibrator.js';
import { ElecMeter } from '../components/ElecMeter.js';
import { RealMegohmMeter } from '../components/RealMegohmMeter.js';
import { Syncroscope } from '../components/Syncroscope.js';
import { SP4TSwitch } from '../components/SP4TSwitch.js';
import { ThreePhaseLoad } from '../components/ThreePhaseLoad.js';

// ═══════════════════════════════════════════════════════════════
// 一、故障
// ═══════════════════════════════════════════════════════════════

export const FAULT_CONFIGS = {
    // 2# 发电机原动机冷却水温高：并网运行时原动机停机、发电机被母线拖转 →
    // 输出逆功率，逆功率达 8 kW 持续 5 s 后 2# 主开关逆功率保护跳闸。
    gen2_coolant_temp: {
        id: 'gen2_coolant_temp',
        name: '2#发电机冷却水温度高',
        system: '发电机原动机',
        check() {
            const c = window.sys?.comps?.['gen2'];
            return !!(c && c._faultCoolantTemp);
        },
        trigger() {
            const c = window.sys?.comps?.['gen2'];
            if (c) c._faultCoolantTemp = true;
        },
        repair() {
            const c = window.sys?.comps?.['gen2'];
            if (c) c._faultCoolantTemp = false;
        },
    },
};

// ═══════════════════════════════════════════════════════════════
// 二、通用辅助
// ═══════════════════════════════════════════════════════════════

const _sysOf = (ctx) => (ctx && ctx.sys) ? ctx.sys : window.sys;
const _sleep = (ms) => new Promise(r => setTimeout(r, ms));
const _comp = (sys, id) => (sys && sys.comps) ? sys.comps[id] : null;
const _g1 = (ctx) => _comp(_sysOf(ctx), 'gen1');
const _g2 = (ctx) => _comp(_sysOf(ctx), 'gen2');
const _qf = (ctx, id) => _comp(_sysOf(ctx), id);
const _sel = (ctx) => _comp(_sysOf(ctx), 'sync_sel');
const _sc = (ctx) => _comp(_sysOf(ctx), 'sync1');
const _load = (ctx) => _comp(_sysOf(ctx), 'load3');

/** 条件轮询等待（不写死 sleep 猜时间） */
async function _waitFor(sys, cond, timeout = 6000, interval = 100) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
        try { if (cond(sys)) return true; } catch (e) { /* ignore */ }
        await _sleep(interval);
    }
    return false;
}

/** 模拟操作组件部件（触发组件自身按压/点击逻辑，不直接改内部字段） */
function _firePart(comp, partId, evt = 'click') {
    if (!comp || typeof comp.getClickablePartNode !== 'function') return false;
    const node = comp.getClickablePartNode(partId);
    if (!node) return false;
    try { node.fire(evt, { evt: { cancelBubble: false } }); } catch (e) { return false; }
    return true;
}

/** 发电机组遥控面板按钮（合闸/分闸/起动/停止）——真实按压，取不到节点时兜底置位 */
const _PANEL_FLAG = {
    'btn-close': '_userClosePressed', 'btn-open': '_userOpenPressed',
    'btn-start': '_userStartPressed', 'btn-stop': '_userStopPressed',
};
async function _panelPress(ctx, panelId, partId, holdMs = 800) {
    const p = _comp(_sysOf(ctx), panelId);
    if (!p) return false;
    if (_firePart(p, partId, 'mousedown')) {
        await _sleep(holdMs);
        _firePart(p, partId, 'mouseup');
        await _sleep(200);
        return true;
    }
    // 兜底：面板未登记命中节点时，用同一按压标志模拟（带告警，不属主路径）
    const flag = _PANEL_FLAG[partId];
    console.warn(`[遥控面板] 未取到 ${panelId}/${partId} 命中节点，改用按压标志兜底`);
    if (flag && flag in p) {
        p[flag] = true;
        await _sleep(holdMs);
        p[flag] = false;
        await _sleep(200);
        return true;
    }
    return false;
}

/**
 * 遥控调速：把某台机的调速器设定频率调到 target（Hz）。
 * 用「短按旋钮 + 每次重新判方向」的闭环方式：每次按下时间随偏差缩小，
 * 避免长按过冲后再也回不来（调速设定单调积分，方向一旦固定会跑飞）。
 */
async function _setFreqTo(ctx, panelId, genId, target, tol = 0.03) {
    const g = _comp(_sysOf(ctx), genId);
    if (!g) return false;
    if (Math.abs(g.freq - target) <= tol) return true;
    for (let i = 0; i < 240; i++) {
        const err = target - g.freq;
        if (Math.abs(err) <= tol) return true;
        const ms = Math.abs(err) > 2 ? 480 : (Math.abs(err) > 0.4 ? 200 : 70);
        await _nudge(ctx, panelId, genId, err > 0 ? 1 : -1, ms);
    }
    return Math.abs(target - g.freq) <= tol * 2;
}

/**
 * 遥控调速（相对电网）：把待并机频率调到「电网频率 + delta」。
 * 调速是二阶动态且电网频率随负载缓慢漂移，因此采用闭环修正：
 * 每轮以当前电网稳定频率为目标调设定值，等收敛后复核同步表实测频差，
 * 直到实测频差落在 delta ± tol 内（最多 5 轮）。
 */
async function _setFreqRelTo(ctx, panelId, genId, delta, tol = 0.05) {
    const sys = _sysOf(ctx);
    for (let k = 0; k < 5; k++) {
        const base = await _gridFreq(ctx);
        await _setFreqTo(ctx, panelId, genId, base + delta, 0.02);
        await _sleep(1200);                 // 等调速二阶动态收敛
        const sc = _sc({ sys });
        if (!sc) return false;
        const d = sc._fGen - sc._fBus;
        if (Math.abs(d - delta) <= tol) return true;
    }
    return false;
}

/** 轻推调速旋钮（负荷转移/频率微调用） */
async function _nudge(ctx, panelId, genId, dir, ms = 120) {
    const p = _comp(_sysOf(ctx), panelId);
    const part = dir > 0 ? 'knob-inc' : 'knob-dec';
    if (p && _firePart(p, part, 'mousedown')) {
        await _sleep(ms);
        _firePart(p, part, 'mouseup');
    } else {
        const g = _comp(_sysOf(ctx), genId);
        if (g) g.freq += dir * 0.6 * 0.05;
    }
    await _sleep(140);
}

/** 同步表选择开关转到指定档位（1=OFF / 2=1# / 3=2# / 4=预留），模拟拨动手柄 */
async function _selTo(ctx, pos) {
    const sys = _sysOf(ctx);
    const s = _sel(ctx);
    if (!s) return false;
    for (let i = 0; i < 8 && s.getPosition() !== pos; i++) {
        const cur = s.getPosition();
        const fwd = (pos - cur + 4) % 4;
        const back = (cur - pos + 4) % 4;
        _firePart(s, fwd <= back ? 'sel-knob-next' : 'sel-knob-prev', 'click');
        await _waitFor(sys, () => !s.isAnimating() && s.getPosition() !== cur, 2500, 60);
        await _sleep(150);
    }
    await _sleep(200);
    return s.getPosition() === pos;
}

/** 发电机组遥控起动 */
async function _startGen(ctx, panelId, genId) {
    const sys = _sysOf(ctx);
    const g = _comp(sys, genId);
    if (!g) return false;
    if (!g.isOn) {
        await _panelPress(ctx, panelId, 'btn-start', 1000);
        await _waitFor(sys, s => !!_comp(s, genId).isOn, 6000);
    }
    await _sleep(400);
    return !!g.isOn;
}

/** 发电机组遥控停机 */
async function _stopGen(ctx, panelId, genId) {
    const sys = _sysOf(ctx);
    const g = _comp(sys, genId);
    if (!g) return false;
    if (g.isOn) {
        await _panelPress(ctx, panelId, 'btn-stop', 900);
        await _waitFor(sys, s => !_comp(s, genId).isOn, 6000);
    }
    await _sleep(300);
    return !g.isOn;
}

/** 等主开关储能到位（储能电机自动储能约 2 s） */
async function _waitCharged(ctx, qfId, timeout = 10000) {
    const sys = _sysOf(ctx);
    return _waitFor(sys, s => { const q = _comp(s, qfId); return q && q.isCharged(); }, timeout);
}

/** 遥控合闸：等储能到位 → 按面板「合闸」→ 等主触头闭合 */
async function _closeViaPanel(ctx, panelId, qfId) {
    const sys = _sysOf(ctx);
    const q = _comp(sys, qfId);
    if (!q) return false;
    await _waitCharged(ctx, qfId);
    await _panelPress(ctx, panelId, 'btn-close', 900);
    const ok = await _waitFor(sys, s => _comp(s, qfId).getState() === 'on', 6000);
    await _sleep(600);
    return ok;
}

/** 遥控分闸：按面板「分闸」→ 等主触头断开 */
async function _openViaPanel(ctx, panelId, qfId) {
    const sys = _sysOf(ctx);
    const q = _comp(sys, qfId);
    if (!q || q.getState() !== 'on') return true;
    await _panelPress(ctx, panelId, 'btn-open', 700);
    const ok = await _waitFor(sys, s => _comp(s, qfId).getState() === 'off', 6000);
    await _sleep(600);
    return ok;
}

/** 主开关本体「手动分闸」按钮（复位/联锁演示用） */
async function _tripByHandle(ctx, qfId) {
    const sys = _sysOf(ctx);
    const q = _comp(sys, qfId);
    if (!q || q.getState() !== 'on') return true;
    if (!_firePart(q, 'btn-open', 'mousedown') && typeof q.tryTrip === 'function') {
        console.warn('[主开关] 未取到分闸按钮节点，改用 tryTrip 兜底');
        q.tryTrip();
    }
    await _sleep(200);
    _firePart(q, 'btn-open', 'mouseup');
    const ok = await _waitFor(sys, s => _comp(s, qfId).getState() === 'off', 6000);
    await _sleep(500);
    return ok;
}

/** 工具栏「自动接线」按钮 */
async function _autoWireBtn(ctx) {
    const sys = _sysOf(ctx);
    const btn = document.getElementById('btnAutoWire');
    if (btn && typeof btn.onclick === 'function') btn.onclick();
    else if (sys && typeof sys.applyAllPresets === 'function') sys.applyAllPresets();
    await _sleep(1500);
}

/** 三相可调负载加载/卸载 */
async function _loadSet(ctx, on) {
    const sys = _sysOf(ctx);
    const ld = _load(ctx);
    if (!ld) return false;
    if (!!ld.isLoaded() === !!on) return true;
    _firePart(ld, on ? 'btn-load' : 'btn-unload', 'click');
    const ok = await _waitFor(sys, () => !!ld.isLoaded() === !!on, 4000);
    await _sleep(700);
    return ok;
}

/** 实际输出频率（含下垂），用于观察/判据 */
function _fOut(g) {
    if (!g) return 0;
    return (typeof g._freqOut === 'number' && isFinite(g._freqOut)) ? g._freqOut : g.freq;
}

/** 等单机频率稳定（连续 4 次采样基本不变）后返回该频率 */
async function _gridFreq(ctx, timeout = 8000) {
    const sys = _sysOf(ctx);
    const g = _g1(ctx);
    let last = null, stable = 0;
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
        if (!g) return 50;
        const f = _fOut(g);
        if (last !== null && Math.abs(f - last) < 0.003) {
            if (++stable >= 4) return f;
        } else stable = 0;
        last = f;
        await _sleep(200);
    }
    return _fOut(g);
}

/** 同步表相位差（角度，0~360） */
function _phaseDeg(ctx) {
    const sc = _sc(ctx);
    if (!sc || typeof sc._phaseDiff !== 'number') return null;
    return ((sc._phaseDiff * 180 / Math.PI) % 360 + 360) % 360;
}

/** 等同步表相位差进入「允许并车」窗口（< lo 或 > hi，远离非同期区） */
async function _waitPhaseOK(ctx, lo = 60, hi = 270, timeout = 40000) {
    const sys = _sysOf(ctx);
    return _waitFor(sys, () => {
        const sc = _sc({ sys });
        if (!sc || sc._off || !sc._hasVolt) return false;
        const d = _phaseDeg({ sys });
        return d !== null && (d < lo || d > hi);
    }, timeout, 60);
}

/** 等同步表相位差进入非同期区间 [lo, hi] */
async function _waitPhaseIn(ctx, lo = 60, hi = 270, timeout = 40000) {
    const sys = _sysOf(ctx);
    return _waitFor(sys, () => {
        const sc = _sc({ sys });
        if (!sc || sc._off || !sc._hasVolt) return false;
        const d = _phaseDeg({ sys });
        return d !== null && d >= lo && d <= hi;
    }, timeout, 60);
}

/** 等同步表 LED 转到指定索引窗口（0=12 点，顺时针每格 15°） */
async function _waitLed(ctx, lo, hi, timeout = 40000) {
    const sys = _sysOf(ctx);
    return _waitFor(sys, () => {
        const sc = _sc({ sys });
        return !!sc && !sc._off && sc._activeLED >= lo && sc._activeLED <= hi;
    }, timeout, 60);
}

/** 步骤级标记（"按下 → 现象 → 松开后消失"的操作，供 check 兜底） */
function _flag(ctx, key, value) {
    if (!ctx) return false;
    if (!ctx._projFlag) ctx._projFlag = {};
    if (value === undefined) return !!ctx._projFlag[key];
    ctx._projFlag[key] = value;
    return true;
}

/**
 * 复位时清理残留故障：若上一任务留下了故障（如「2#发电机冷却水温度高」），
 * 下一步就起不来机。这里同样走「故障设置」界面（勾选框取消 → 应用设置），
 * 不直接改组件故障标志。
 */
async function _clearFaultsViaUI(ctx) {
    const sys = _sysOf(ctx);
    const active = Object.values(sys.FAULT_CONFIG || {}).filter(f => {
        try { return f.check(); } catch (e) { return false; }
    });
    if (!active.length) return;
    const faultBtn = document.getElementById('faultBtn');
    if (faultBtn && typeof faultBtn.onclick === 'function') faultBtn.onclick();
    await _sleep(600);
    active.forEach(f => {
        const cb = document.getElementById('fault_check_' + f.id);
        if (cb) cb.checked = false;
    });
    const applyBtn = document.getElementById('applyBtn');
    if (applyBtn && typeof applyBtn.onclick === 'function') applyBtn.onclick();
    await _sleep(1500);
}

/** 完整复位：清残留故障 → 卸负载 → 分闸 → 停机 → 同步表选择开关 OFF → 频率设定回 50 Hz */
async function _resetRig(ctx, { sel = 1 } = {}) {
    const sys = _sysOf(ctx);
    if (!sys) return;
    await _clearFaultsViaUI(ctx);
    await _loadSet(ctx, false);
    await _tripByHandle(ctx, 'qf1');
    await _tripByHandle(ctx, 'qf2');
    await _stopGen(ctx, 'genpanel', 'gen1');
    await _stopGen(ctx, 'genpanel2', 'gen2');
    await _selTo(ctx, sel);
    // 频率设定最后复位：解列/停机瞬间模型会做一次等效设定软复位（autoDecoupleTrim），
    // 若在此之前调频会被它覆盖，故留出一拍再调回 50 Hz。
    await _sleep(600);
    await _setFreqTo(ctx, 'genpanel', 'gen1', 50);
    await _setFreqTo(ctx, 'genpanel2', 'gen2', 50);
    await _sleep(400);
}

// ═══════════════════════════════════════════════════════════════
// 三、工作流
// ═══════════════════════════════════════════════════════════════

export const PROJECT_WORKFLOWS = {
    // ───────────────────────────────────────────────────────────
    'parts-id': {
        id: 'parts-id', name: '1.认识船舶主配电装置',
        steps: [
            { msg: '第 1 步：识别 1# 同步发电机。', mode: 'find', target: 'gen1' },
            { msg: '第 2 步：识别 1# 主开关的储能弹簧。', mode: 'find', target: 'qf1', subTarget: 'store-spring' },
            { msg: '第 3 步：识别 1# 主开关的合闸线圈。', mode: 'find', target: 'qf1', subTarget: 'close-coil' },
            { msg: '第 4 步：识别 1# 主开关的失压脱扣器。', mode: 'find', target: 'qf1', subTarget: 'uv-trip' },
            { msg: '第 5 步：识别 1# 发电机组遥控面板。', mode: 'find', target: 'genpanel' },
            { msg: '第 6 步：识别数字同步表。', mode: 'find', target: 'sync1' },
            { msg: '第 7 步：识别同步表选择开关手柄（OFF/1/2/3 四档）。', mode: 'find', target: 'sync_sel', subTarget: 'sel-knob' },
            { msg: '第 8 步：识别三相汇流排。', mode: 'find', target: 'bus1' },
            { msg: '第 9 步：识别三相可调负载的「加载」按钮。', mode: 'find', target: 'load3', subTarget: 'btn-load' },
            { msg: '第 10 步：识别 2# 同步发电机。', mode: 'find', target: 'gen2' },
            { msg: '第 11 步：识别 2# 主开关。', mode: 'find', target: 'qf2' },
            { msg: '第 12 步：识别 2# 发电机组遥控面板。', mode: 'find', target: 'genpanel2' },
        ],
    },

    // ───────────────────────────────────────────────────────────
    'close-interlock': {
        id: 'close-interlock', name: '2.遥控合闸与并车联锁操作',
        steps: [
            {
                msg: '第 1 步：点击「自动接线」，接好主回路与控制回路。',
                mode: 'check',
                op: [
                    { type: 'wire', button: 'btnAutoWire', msg: '点击工具栏「自动接线」', async act() { await _autoWireBtn(this); } },
                ],
                check() {
                    const sys = _sysOf(this);
                    const on = (a, b) => !!(sys && Array.isArray(sys.conns) && sys.conns.some(c =>
                        c && c.type === 'wire' && ((c.from === a && c.to === b) || (c.from === b && c.to === a))));
                    return on('gen1_wire_u', 'qf1_wire_t1') && on('gen2_wire_u', 'qf2_wire_t1')
                        && on('genpanel_wire_p24_p', 'dc_uv_wire_p') && on('genpanel2_wire_p24_p', 'dc_uv2_wire_p');
                },
            },
            {
                msg: '第 2 步：复位——两只主开关分闸、两台机停机、选择开关置 OFF。',
                mode: 'check',
                op: [
                    { type: 'btn', target: 'qf1', part: 'btn-open', msg: '1# 主开关手动分闸', async act() { await _tripByHandle(this, 'qf1'); } },
                    { type: 'btn', target: 'qf2', part: 'btn-open', msg: '2# 主开关手动分闸', async act() { await _tripByHandle(this, 'qf2'); } },
                    { type: 'btn', target: 'genpanel', part: 'btn-stop', msg: '1# 机组遥控停机', async act() { await _stopGen(this, 'genpanel', 'gen1'); } },
                    { type: 'btn', target: 'genpanel2', part: 'btn-stop', msg: '2# 机组遥控停机', async act() { await _stopGen(this, 'genpanel2', 'gen2'); } },
                    { type: 'knob', target: 'sync_sel', part: 'sel-knob', msg: '同步表选择开关扳到 OFF', async act() { await _selTo(this, 1); } },
                ],
                check() {
                    const sys = _sysOf(this);
                    return _qf(this, 'qf1').getState() === 'off' && _qf(this, 'qf2').getState() === 'off'
                        && !_g1(this).isOn && !_g2(this).isOn && _sel(this).getPosition() === 1;
                },
            },
            {
                msg: '第 3 步：测试题——电网无电时遥控合闸。',
                mode: 'quiz',
                quizConfig: {
                    question: '汇流排无电、同步表选择开关处于 OFF 档时，按下遥控面板「合闸」按钮能否直接合闸？',
                    options: [
                        '能，电网无电不存在并车问题，合闸联锁放行，按下即合闸',
                        '不能，必须先起动发电机才能合闸',
                        '不能，必须由通信端口下达合闸指令',
                        '不能，必须先将同步表选择开关转到本机档位',
                    ],
                    answer: 0,
                    analysis: '电网无电时不存在非同期合闸的风险，合闸联锁直接放行；只要主开关储能到位、面板已送电，按「合闸」即输出合闸信号完成合闸。',
                },
            },
            {
                msg: '第 4 步：按 1# 遥控面板「起动」，1# 机建压并完成主开关储能。',
                mode: 'check',
                op: [
                    { type: 'btn', target: 'genpanel', part: 'btn-start', msg: '按 1# 面板「起动」', async act() { await _startGen(this, 'genpanel', 'gen1'); } },
                    { type: 'observe', target: 'qf1', part: 'store-spring', msg: '储能电机把合闸弹簧储满', async act() { await _waitCharged(this, 'qf1'); } },
                ],
                check() {
                    return !!_g1(this).isOn && !!_qf(this, 'qf1').isCharged();
                },
            },
            {
                msg: '第 5 步：电网无电，按 1# 面板「合闸」，1# 主开关合闸。',
                mode: 'check',
                op: [
                    { type: 'btn', target: 'genpanel', part: 'btn-close', msg: '按 1# 面板「合闸」', async act() { await _closeViaPanel(this, 'genpanel', 'qf1'); } },
                ],
                check() {
                    return _qf(this, 'qf1').getState() === 'on';
                },
            },
            {
                msg: '第 6 步：测试题——电网有电时遥控合闸的条件。',
                mode: 'quiz',
                quizConfig: {
                    question: '汇流排已带电，同步表选择开关未转到 2# 档时，按 2# 面板「合闸」按钮会怎样？',
                    options: [
                        '正常输出合闸信号，2# 主开关直接合闸',
                        '合闸信号被联锁封锁，2# 主开关不动作',
                        '输出瞬间合闸信号后自动分闸',
                        '通信端口下达合闸指令时不受影响',
                    ],
                    answer: 1,
                    analysis: '电网有电时待并机必须确认同步条件。同步表选择开关未转到本机档位，合闸联锁封锁合闸输出，防止未同期就合闸造成冲击。',
                },
            },
            {
                msg: '第 7 步：按 2# 遥控面板「起动」，2# 机建压。',
                mode: 'check',
                op: [
                    { type: 'btn', target: 'genpanel2', part: 'btn-start', msg: '按 2# 面板「起动」', async act() { await _startGen(this, 'genpanel2', 'gen2'); } },
                ],
                check() {
                    return !!_g2(this).isOn;
                },
            },
            {
                msg: '第 8 步：选择开关不在 2# 档，按 2# 面板「合闸」，联锁封锁不动作。',
                mode: 'check',
                op: [
                    { type: 'observe', target: 'sync_sel', part: 'sel-knob', msg: '选择开关仍停在 OFF 档', async act() { await _sleep(600); } },
                    { type: 'btn', target: 'genpanel2', part: 'btn-close', msg: '按 2# 面板「合闸」', async act() { await _panelPress(this, 'genpanel2', 'btn-close', 900); _flag(this, 's8Close', true); await _sleep(1200); } },
                ],
                check() {
                    const gp2 = _comp(_sysOf(this), 'genpanel2');
                    return !!gp2 && typeof gp2.isClosePermitted === 'function' && gp2.isClosePermitted() === false
                        && _qf(this, 'qf2').getState() === 'off' && _flag(this, 's8Close');
                },
            },
            {
                msg: '第 9 步：识别同步表选择开关手柄。',
                mode: 'find', target: 'sync_sel', subTarget: 'sel-knob',
            },
            {
                msg: '第 10 步：选择开关转 2# 档，2# 机调频接近电网，相位合适时合闸并车。',
                mode: 'check',
                op: [
                    { type: 'knob', target: 'sync_sel', part: 'sel-knob', msg: '选择开关扳到 2# 档，联锁放行', async act() { await _selTo(this, 3); } },
                    { type: 'knob', target: 'genpanel2', part: 'knob-inc', msg: '调速旋钮微调 2# 机频率接近电网', async act() { await _setFreqRelTo(this, 'genpanel2', 'gen2', 0.3, 0.06); } },
                    { type: 'observe', target: 'sync1', msg: '看同步表，相位差进入允许区', async act() { await _waitPhaseOK(this); } },
                    { type: 'btn', target: 'genpanel2', part: 'btn-close', msg: '按 2# 面板「合闸」并车', async act() { await _closeViaPanel(this, 'genpanel2', 'qf2'); } },
                ],
                check() {
                    return _qf(this, 'qf2').getState() === 'on' && _sel(this).getPosition() === 3;
                },
            },
            {
                msg: '第 11 步：测试题——并车联锁的目的。',
                mode: 'quiz',
                quizConfig: {
                    question: '电网有电时，遥控合闸要求同步表选择开关转到本机档位的根本目的是（　）。',
                    options: [
                        '防止误操作损坏选择开关',
                        '保证并车时电压、频率、相位满足同步条件，避免合闸冲击',
                        '增加操作步骤，防止触电',
                        '使同步表读数保持为零',
                    ],
                    answer: 1,
                    analysis: '并车必须满足电压相等、频率接近、相位一致。选择开关转到本机档位后，操作者通过同步表确认待并机与汇流排的同步情况，同步后再合闸，避免不同步合闸产生巨大冲击电流。',
                },
            },
        ],
    },

    // ───────────────────────────────────────────────────────────
    'sync-protect': {
        id: 'sync-protect', name: '3.并车保护（非同期与频差跳闸）',
        steps: [
            {
                msg: '第 1 步：点击「自动接线」，接好主回路与控制回路。',
                mode: 'check',
                op: [
                    { type: 'wire', button: 'btnAutoWire', msg: '点击工具栏「自动接线」', async act() { await _autoWireBtn(this); } },
                ],
                check() {
                    const sys = _sysOf(this);
                    const on = (a, b) => !!(sys && Array.isArray(sys.conns) && sys.conns.some(c =>
                        c && c.type === 'wire' && ((c.from === a && c.to === b) || (c.from === b && c.to === a))));
                    return on('gen1_wire_u', 'qf1_wire_t1') && on('qf2_wire_l1', 'bus1_wire_l1_7')
                        && on('bus1_wire_l1_3', 'sync1_wire_bus');
                },
            },
            {
                msg: '第 2 步：复位后起动 1# 机并合闸，电网带电。',
                mode: 'check',
                op: [
                    { type: 'observe', target: 'genpanel', msg: '复位：两台机停机、两只主开关分闸', async act() { await _resetRig(this); } },
                    { type: 'btn', target: 'genpanel', part: 'btn-start', msg: '按 1# 面板「起动」', async act() { await _startGen(this, 'genpanel', 'gen1'); } },
                    { type: 'btn', target: 'genpanel', part: 'btn-close', msg: '按 1# 面板「合闸」，电网带电', async act() { await _closeViaPanel(this, 'genpanel', 'qf1'); } },
                ],
                check() {
                    return _qf(this, 'qf1').getState() === 'on' && !!_g1(this).isOn;
                },
            },
            {
                msg: '第 3 步：按 2# 遥控面板「起动」，2# 机建压待并。',
                mode: 'check',
                op: [
                    { type: 'btn', target: 'genpanel2', part: 'btn-start', msg: '按 2# 面板「起动」', async act() { await _startGen(this, 'genpanel2', 'gen2'); } },
                ],
                check() {
                    return !!_g2(this).isOn && _qf(this, 'qf2').getState() === 'off';
                },
            },
            {
                msg: '第 4 步：同步表选择开关扳到 2# 档，联锁放行。',
                mode: 'check',
                op: [
                    { type: 'knob', target: 'sync_sel', part: 'sel-knob', msg: '选择开关扳到 2# 档', async act() { await _selTo(this, 3); } },
                ],
                check() {
                    return _sel(this).getPosition() === 3;
                },
            },
            {
                msg: '第 5 步：测试题——并车必须满足的同步条件。',
                mode: 'quiz',
                quizConfig: {
                    question: '发电机并联投入前，待并机与汇流排必须满足（　）。',
                    options: [
                        '电压相等、频率接近、相位一致',
                        '只要频率相同即可，电压相位不作要求',
                        '只要电压相同即可，频率相位不作要求',
                        '只要相位相同即可，电压频率不作要求',
                    ],
                    answer: 0,
                    analysis: '电压差过大产生无功环流，频差过大产生有功冲击与功率振荡，相位差过大产生巨大合闸冲击电流。相位差与频差越限合闸会触发并车保护，全船主开关跳闸失电。',
                },
            },
            {
                msg: '第 6 步：演示一——把 2# 机频率调到 50.6 Hz（频差 > 0.5 Hz）。',
                mode: 'check',
                op: [
                    { type: 'observe', target: 'genpanel2', part: 'lcd', msg: '看 2# 面板频率显示', async act() { await _sleep(600); } },
                    { type: 'knob', target: 'genpanel2', part: 'knob-inc', msg: '顺时针拧调速旋钮，频率升到 50.6 Hz', async act() { await _setFreqTo(this, 'genpanel2', 'gen2', 50.6, 0.04); await _sleep(1200); } },
                ],
                check() {
                    const sc = _sc(this);
                    return Math.abs(sc._fGen - sc._fBus) > 0.5;
                },
            },
            {
                msg: '第 7 步：演示一——相位进入允许区时按 2# 面板「合闸」，频差越限触发全船跳闸。',
                mode: 'check',
                op: [
                    { type: 'observe', target: 'sync1', msg: '看同步表相位差进入允许区', async act() { await _waitPhaseOK(this); } },
                    { type: 'btn', target: 'genpanel2', part: 'btn-close', msg: '按 2# 面板「合闸」', async act() { await _panelPress(this, 'genpanel2', 'btn-close', 900); _flag(this, 's7Close', true); await _sleep(2500); } },
                ],
                check() {
                    const sys = _sysOf(this);
                    return _flag(this, 's7Close')
                        && _qf(this, 'qf1').getState() === 'off' && _qf(this, 'qf2').getState() === 'off'
                        && _sel(this).getPosition() === 3;
                },
            },
            {
                msg: '第 8 步：测试题——频差超限并车的后果。',
                mode: 'quiz',
                quizConfig: {
                    question: '频差大于 0.5 Hz 时强行并车合闸，保护动作结果是（　）。',
                    options: [
                        '合闸正常进行，两机平稳并联',
                        '产生冲击电流与功率振荡，并车保护动作，全部发电机主开关跳闸（全船失电）',
                        '仅 2# 主开关跳闸，1# 机继续供电',
                        '主开关合闸但两台机不并联',
                    ],
                    answer: 1,
                    analysis: '频差过大并车会产生剧烈功率振荡与冲击电流，超出允许范围（本工程 ±0.5 Hz）时并车保护立即动作：所有发电机主开关自动分闸，全船失电，需重新调速后再并车。',
                },
            },
            {
                msg: '第 9 步：复位重建——1# 机重新合闸供电，2# 机重新待并。',
                mode: 'check',
                op: [
                    { type: 'observe', target: 'genpanel', msg: '复位：两台机停机、两只主开关分闸', async act() { await _resetRig(this); } },
                    { type: 'btn', target: 'genpanel', part: 'btn-start', msg: '按 1# 面板「起动」', async act() { await _startGen(this, 'genpanel', 'gen1'); } },
                    { type: 'btn', target: 'genpanel', part: 'btn-close', msg: '按 1# 面板「合闸」，恢复供电', async act() { await _closeViaPanel(this, 'genpanel', 'qf1'); } },
                    { type: 'btn', target: 'genpanel2', part: 'btn-start', msg: '按 2# 面板「起动」', async act() { await _startGen(this, 'genpanel2', 'gen2'); } },
                    { type: 'knob', target: 'sync_sel', part: 'sel-knob', msg: '选择开关扳到 2# 档', async act() { await _selTo(this, 3); } },
                ],
                check() {
                    return _qf(this, 'qf1').getState() === 'on' && !!_g2(this).isOn && _sel(this).getPosition() === 3;
                },
            },
            {
                msg: '第 10 步：演示二——微调 2# 机频率，让同步表相位缓慢转动。',
                mode: 'check',
                op: [
                    { type: 'observe', target: 'genpanel2', part: 'lcd', msg: '2# 机频率略高于电网（< 0.5 Hz）', async act() { await _setFreqRelTo(this, 'genpanel2', 'gen2', 0.05, 0.03); } },
                    { type: 'observe', target: 'sync1', msg: '看同步表指针缓慢转动', async act() { await _sleep(2500); } },
                ],
                check() {
                    const sc = _sc(this);
                    return !!sc && !sc._off && Math.abs(sc._fGen - sc._fBus) < 0.5 && _sel(this).getPosition() === 3;
                },
            },
            {
                msg: '第 11 步：演示二——相位差落入非同期区时合闸，触发全船跳闸。',
                mode: 'check',
                op: [
                    { type: 'observe', target: 'sync1', msg: '等指针转到非同期区间（60°~270°）', async act() { await _waitPhaseIn(this, 60, 270); } },
                    { type: 'btn', target: 'genpanel2', part: 'btn-close', msg: '按 2# 面板「合闸」', async act() { await _panelPress(this, 'genpanel2', 'btn-close', 900); _flag(this, 's11Close', true); await _sleep(2500); } },
                ],
                check() {
                    return _flag(this, 's11Close')
                        && _qf(this, 'qf1').getState() === 'off' && _qf(this, 'qf2').getState() === 'off';
                },
            },
            {
                msg: '第 12 步：测试题——非同期并车的后果。',
                mode: 'quiz',
                quizConfig: {
                    question: '相位差处于 60°~270°（非同期）时强行合闸，保护动作结果是（　）。',
                    options: [
                        '合闸正常进行，两机平稳并联',
                        '主开关合闸后立即自动分闸，发电机继续运行',
                        '产生巨大冲击电流，并车保护动作，全部发电机主开关跳闸（含已在网机组）',
                        '仅拒绝合闸，不产生任何动作',
                    ],
                    answer: 2,
                    analysis: '非同期合闸瞬间两台机的电压相量差异极大，产生巨大冲击电流，可能损伤发电机绕组与轴系。本工程设定相位差处于 60°~270° 时并车保护立即动作：全部主开关跳闸，全船失电。',
                },
            },
        ],
    },

    // ───────────────────────────────────────────────────────────
    'reverse-power': {
        id: 'reverse-power', name: '4.并联功率分配与逆功率保护',
        steps: [
            {
                msg: '第 1 步：自动接线，起动 1# 机并合闸供电，频率调至 50 Hz。',
                mode: 'check',
                op: [
                    { type: 'wire', button: 'btnAutoWire', msg: '点击工具栏「自动接线」', async act() { await _autoWireBtn(this); } },
                    { type: 'observe', target: 'genpanel', msg: '复位：两台机停机、两只主开关分闸', async act() { await _resetRig(this); } },
                    { type: 'btn', target: 'genpanel', part: 'btn-start', msg: '按 1# 面板「起动」', async act() { await _startGen(this, 'genpanel', 'gen1'); } },
                    { type: 'btn', target: 'genpanel', part: 'btn-close', msg: '按 1# 面板「合闸」', async act() { await _closeViaPanel(this, 'genpanel', 'qf1'); } },
                    { type: 'knob', target: 'genpanel', part: 'knob-inc', msg: '调速让空载频率回到 50 Hz', async act() { await _setFreqTo(this, 'genpanel', 'gen1', 50); await _sleep(800); } },
                ],
                check() {
                    return !!_g1(this).isOn && _qf(this, 'qf1').getState() === 'on'
                        && Math.abs(_g1(this).freq - 50) <= 0.12;
                },
            },
            {
                msg: '第 2 步：起动 2# 机，选择开关转 2# 档，调频接近电网后合闸并车。',
                mode: 'check',
                op: [
                    { type: 'btn', target: 'genpanel2', part: 'btn-start', msg: '按 2# 面板「起动」', async act() { await _startGen(this, 'genpanel2', 'gen2'); } },
                    { type: 'knob', target: 'sync_sel', part: 'sel-knob', msg: '选择开关扳到 2# 档', async act() { await _selTo(this, 3); } },
                    { type: 'knob', target: 'genpanel2', part: 'knob-inc', msg: '调速让 2# 频率接近电网', async act() { await _setFreqRelTo(this, 'genpanel2', 'gen2', 0.1, 0.05); } },
                    { type: 'observe', target: 'sync1', msg: '看同步表，相位差进入允许区', async act() { await _waitPhaseOK(this); } },
                    { type: 'btn', target: 'genpanel2', part: 'btn-close', msg: '按 2# 面板「合闸」并车', async act() { await _closeViaPanel(this, 'genpanel2', 'qf2'); } },
                ],
                check() {
                    return _qf(this, 'qf2').getState() === 'on' && _sel(this).getPosition() === 3;
                },
            },
            {
                msg: '第 3 步：观察两台机面板，有功功率基本均分。',
                mode: 'check',
                op: [
                    { type: 'observe', target: 'genpanel', part: 'lcd', msg: '看 1# 面板有功功率', async act() { await _sleep(1500); } },
                    { type: 'observe', target: 'genpanel2', part: 'lcd', msg: '看 2# 面板有功功率，与 1# 接近', async act() { await _sleep(1500); } },
                ],
                check() {
                    const g1 = _g1(this), g2 = _g2(this);
                    return _qf(this, 'qf1').getState() === 'on' && _qf(this, 'qf2').getState() === 'on'
                        && g1._displayP > 0 && g2._displayP > 0
                        && Math.abs(g1._displayP - g2._displayP) <= 4;
                },
            },
            {
                msg: '第 4 步：减小 2# 机油门（下调调速器），2# 输出功率下降、负荷转移给 1#。',
                mode: 'check',
                op: [
                    { type: 'knob', target: 'genpanel2', part: 'knob-dec', msg: '逆时针拧调速旋钮，减小油门', async act() { await _sharePowerTo(this, 1.5, 1.0); await _sleep(800); } },
                ],
                check() {
                    const g1 = _g1(this), g2 = _g2(this);
                    return g2._displayP <= 2.5 && g1._displayP > g2._displayP
                        && _qf(this, 'qf2').getState() === 'on';
                },
            },
            {
                msg: '第 5 步：增大 2# 机油门（上调调速器），2# 输出功率回升。',
                mode: 'check',
                op: [
                    { type: 'knob', target: 'genpanel2', part: 'knob-inc', msg: '顺时针拧调速旋钮，增大油门', async act() { await _sharePowerTo(this, 10, 1.0); await _sleep(800); } },
                ],
                check() {
                    return _g2(this)._displayP >= 6 && _qf(this, 'qf2').getState() === 'on';
                },
            },
            {
                msg: '第 6 步：投入三相可调负载 20 kW，微调 2# 机使输出约 5 kW。',
                mode: 'check',
                op: [
                    { type: 'load', target: 'load3', part: 'btn-load', msg: '点「加载」，投入 20 kW 负载', async act() { await _loadSet(this, true); } },
                    { type: 'knob', target: 'genpanel2', part: 'knob-dec', msg: '微调 2# 调速器，输出接近 5 kW', async act() { await _sharePowerTo(this, 5, 0.8); } },
                ],
                check() {
                    const ld = _load(this);
                    return !!ld && ld.isLoaded() && Math.abs(_g2(this)._displayP - 5) <= 1.2;
                },
            },
            {
                msg: '第 7 步：故障设置「2# 发电机冷却水温度高」，原动机停机、发电机被拖动。',
                mode: 'check',
                op: [
                    { type: 'fault', fault: 'gen2_coolant_temp', msg: '勾选「2#发电机冷却水温度高」并应用', async act() { await _sleep(1000); } },
                    { type: 'observe', target: 'genpanel2', part: 'lcd', msg: '看 2# 面板：有功功率由正转负（逆功率）', async act() { await _waitFor(_sysOf(this), () => _g2(this)._displayP < 0, 20000); await _sleep(1200); } },
                ],
                check() {
                    const sys = _sysOf(this);
                    const cfg = sys.FAULT_CONFIG['gen2_coolant_temp'];
                    return !!(cfg && cfg.check()) && _g2(this)._displayP < 0
                        && _qf(this, 'qf2').getState() === 'on';
                },
            },
            {
                msg: '第 8 步：逆功率达 8 kW 并持续 5 s，2# 主开关逆功率保护跳闸。',
                mode: 'check',
                op: [
                    { type: 'observe', target: 'qf2', part: 'main-contact', msg: '看 2# 主开关：逆功率延时到后跳闸', async act() { await _waitFor(_sysOf(this), s => _comp(s, 'qf2').getState() === 'off', 40000, 200); await _sleep(1000); } },
                ],
                check() {
                    const q2 = _qf(this, 'qf2');
                    return q2.getState() === 'off' && q2._revTrip === true
                        && _qf(this, 'qf1').getState() === 'on';
                },
            },
            {
                msg: '第 9 步：测试题——逆功率的成因与保护目的。',
                mode: 'quiz',
                quizConfig: {
                    question: '并网运行的发电机出现逆功率（有功功率为负）的原因是（　）。',
                    options: [
                        '发电机电压调得太高，向电网送出无功',
                        '原动机（柴油机）失去动力，发电机被电网拖着转，变成电动机运行',
                        '发电机频率调得太低',
                        '主开关接触不良',
                    ],
                    answer: 1,
                    analysis: '原动机故障停机后，转子失去驱动转矩，同步发电机在电网上变成同步电动机运行，从电网吸收有功（逆功率），会拖动柴油机反转造成损坏。逆功率保护在逆功率达定值并延时后跳闸，把故障机组解列。',
                },
            },
        ],
    },

    // ───────────────────────────────────────────────────────────
    'parallel-load-shift': {
        id: 'parallel-load-shift', name: '5.发电机准同步并车、并联负荷转移、解列',
        steps: [
            {
                msg: '第 1 步：自动接线，起动 1# 机并合闸供电，频率调至 50 Hz。',
                mode: 'check',
                op: [
                    { type: 'wire', button: 'btnAutoWire', msg: '点击工具栏「自动接线」', async act() { await _autoWireBtn(this); } },
                    { type: 'observe', target: 'genpanel', msg: '复位：两台机停机、两只主开关分闸', async act() { await _resetRig(this); } },
                    { type: 'btn', target: 'genpanel', part: 'btn-start', msg: '按 1# 面板「起动」', async act() { await _startGen(this, 'genpanel', 'gen1'); } },
                    { type: 'btn', target: 'genpanel', part: 'btn-close', msg: '按 1# 面板「合闸」', async act() { await _closeViaPanel(this, 'genpanel', 'qf1'); } },
                    { type: 'knob', target: 'genpanel', part: 'knob-inc', msg: '调速让频率回到 50 Hz', async act() { await _setFreqTo(this, 'genpanel', 'gen1', 50); await _sleep(800); } },
                ],
                check() {
                    return !!_g1(this).isOn && _qf(this, 'qf1').getState() === 'on'
                        && Math.abs(_g1(this).freq - 50) <= 0.12;
                },
            },
            {
                msg: '第 2 步：填空题——准同步并车必须满足的三个条件。',
                mode: 'fill',
                target: 'genpanel2',
                fields: [
                    { label: '电压差不超过', unit: '%Un', placeholder: '', answer: 10 },
                    { label: '频率差不超过', unit: 'Hz', placeholder: '', answer: 0.5 },
                    { label: '相位差不超过', unit: '°', placeholder: '', answer: 15 },
                ],
            },
            {
                msg: '第 3 步：识别 2# 面板的 READY FOR START 指示灯。',
                mode: 'find', target: 'genpanel2', subTarget: 'ready-led',
            },
            {
                msg: '第 4 步：起动 2# 机，选择开关转 2# 档，把 2# 频率调到比电网高 0.2 Hz。',
                mode: 'check',
                op: [
                    { type: 'btn', target: 'genpanel2', part: 'btn-start', msg: '按 2# 面板「起动」', async act() { await _startGen(this, 'genpanel2', 'gen2'); } },
                    { type: 'knob', target: 'sync_sel', part: 'sel-knob', msg: '选择开关扳到 2# 档', async act() { await _selTo(this, 3); } },
                    { type: 'knob', target: 'genpanel2', part: 'knob-inc', msg: '顺时针拧调速旋钮，频率比电网高 0.2 Hz', async act() { await _setFreqRelTo(this, 'genpanel2', 'gen2', 0.2, 0.04); } },
                ],
                check() {
                    const sc = _sc(this);
                    const dF = sc._fGen - sc._fBus;
                    return !!_g2(this).isOn && _sel(this).getPosition() === 3
                        && dF > 0.08 && dF < 0.4;
                },
            },
            {
                msg: '第 5 步：观察同步表——正频差 0.2 Hz，指针 3~5 s 转一圈。',
                mode: 'check',
                op: [
                    { type: 'observe', target: 'sync1', msg: '看同步表指针顺时针转动', async act() { await _sleep(3000); } },
                ],
                check() {
                    const sc = _sc(this);
                    const dF = sc._fGen - sc._fBus;
                    return !!sc && !sc._off && sc._hasVolt && dF > 0.08 && dF < 0.4
                        && _sel(this).getPosition() === 3;
                },
            },
            {
                msg: '第 6 步：指针转到「11」位置附近合闸 2# 主开关，随后选择开关回 OFF。',
                mode: 'check',
                op: [
                    { type: 'observe', target: 'sync1', msg: '等指针转到 11 点位置（315°~345°）', async act() { await _waitLed(this, 21, 23); } },
                    { type: 'btn', target: 'genpanel2', part: 'btn-close', msg: '按 2# 面板「合闸」并车', async act() { await _closeViaPanel(this, 'genpanel2', 'qf2'); } },
                    { type: 'knob', target: 'sync_sel', part: 'sel-knob', msg: '选择开关扳回 OFF', async act() { await _selTo(this, 1); } },
                ],
                check() {
                    return _qf(this, 'qf2').getState() === 'on' && _sel(this).getPosition() === 1;
                },
            },
            {
                msg: '第 7 步：观察两台机面板，有功功率基本均分。',
                mode: 'check',
                op: [
                    { type: 'observe', target: 'genpanel', part: 'lcd', msg: '看 1# 面板有功功率', async act() { await _sleep(1500); } },
                    { type: 'observe', target: 'genpanel2', part: 'lcd', msg: '看 2# 面板有功功率，与 1# 接近', async act() { await _sleep(1500); } },
                ],
                check() {
                    return Math.abs(_g1(this)._displayP - _g2(this)._displayP) <= 3;
                },
            },
            {
                msg: '第 8 步：突加负载 20 kW，观察两台机功率分配。',
                mode: 'check',
                op: [
                    { type: 'load', target: 'load3', part: 'btn-load', msg: '点「加载」，投入 20 kW 负载', async act() { await _loadSet(this, true); await _sleep(2000); } },
                ],
                check() {
                    const ld = _load(this);
                    return !!ld && ld.isLoaded()
                        && _qf(this, 'qf1').getState() === 'on' && _qf(this, 'qf2').getState() === 'on'
                        && !!_g1(this).isOn && !!_g2(this).isOn;
                },
            },
            {
                msg: '第 9 步：增大 1# 油门、减小 2# 油门，2# 输出降到 3 kW，电网保持 50 Hz。',
                mode: 'check',
                op: [
                    { type: 'knob', target: 'genpanel2', part: 'knob-dec', msg: '对向微调，把 2# 输出压到 3 kW', async act() { await _sharePowerTo(this, 3, 0.6); } },
                    { type: 'knob', target: 'genpanel', part: 'knob-inc', msg: '两机同步平移调频，电网回到 50 Hz', async act() { await _trimGridFreq(this, 50, 0.05); } },
                ],
                check() {
                    const f = _fOut(_g1(this));
                    return Math.abs(_g2(this)._displayP - 3) <= 1.2 && Math.abs(f - 50) <= 0.5;
                },
            },
            {
                msg: '第 10 步：2# 主开关分闸解列，2# 机停机，负荷全部由 1# 机承担。',
                mode: 'check',
                op: [
                    { type: 'btn', target: 'genpanel2', part: 'btn-open', msg: '按 2# 面板「分闸」解列', async act() { await _openViaPanel(this, 'genpanel2', 'qf2'); await _sleep(2500); } },
                    { type: 'btn', target: 'genpanel2', part: 'btn-stop', msg: '按 2# 面板「停止」停机', async act() { await _stopGen(this, 'genpanel2', 'gen2'); } },
                ],
                check() {
                    return _qf(this, 'qf2').getState() === 'off' && _qf(this, 'qf1').getState() === 'on'
                        && !_g2(this).isOn && !!_g1(this).isOn;
                },
            },
        ],
    },
};

// ═══════════════════════════════════════════════════════════════
// 四、功率/频率调节（并联运行用）
// ═══════════════════════════════════════════════════════════════

/**
 * 并联负荷转移：对向微调两台机调速器，使 2# 机输出功率逼近 targetKw。
 * 并联运行时 2# 功率由频差（f2−f1）决定，电网频率由平均设定决定，两者近似正交，
 * 因此只用频差调节功率（1# 加、2# 减或反之），不改动平均频率。
 */
async function _sharePowerTo(ctx, targetKw, tol = 1.0) {
    const g2 = _g2(ctx);
    if (!g2) return false;
    for (let i = 0; i < 200; i++) {
        const err = g2._displayP - targetKw;
        if (Math.abs(err) <= tol) break;
        // 偏差大 → 长按旋钮大步调；接近目标 → 短按微调，避免过冲
        const ms = Math.max(80, Math.min(900, Math.abs(err) * 45));
        const dir = err > 0 ? 1 : -1;   // 2# 偏高 → 1# 加油门(+)、2# 减油门(−)
        await _nudge(ctx, 'genpanel', 'gen1', dir, ms);
        await _nudge(ctx, 'genpanel2', 'gen2', -dir, ms);
        await _sleep(200);
    }
    await _sleep(600);
    return Math.abs(_g2(ctx)._displayP - targetKw) <= tol * 2;
}

/** 并联频率调整：两台机设定同向平移（保持频差不变），把电网频率调到 target */
async function _trimGridFreq(ctx, target, tol = 0.05) {
    const g1 = _g1(ctx);
    if (!g1) return false;
    for (let i = 0; i < 80; i++) {
        const f = _fOut(g1);
        const err = target - f;
        if (Math.abs(err) <= tol) break;
        const dir = err > 0 ? 1 : -1;
        const ms = Math.max(80, Math.min(700, Math.abs(err) * 320));
        await _nudge(ctx, 'genpanel', 'gen1', dir, ms);
        await _nudge(ctx, 'genpanel2', 'gen2', dir, ms);
        await _sleep(200);
    }
    await _sleep(600);
    return Math.abs(_fOut(_g1(ctx)) - target) <= tol * 3;
}

// ═══════════════════════════════════════════════════════════════
// 五、组件布局
// ═══════════════════════════════════════════════════════════════

export const componentConfigs = [
    // ── 1# 机组：同步发电机 → 主开关 → 汇流排 ──
    { Class: SyncGenerator3P, id: 'gen1', x: -100, y: 700, vRms: 230, freq: 50, isOn: false, mode: 'remote', label: '1#同步发电机', ratedPower: 80, ratedVoltage: 400, ratedCosPhi: 0.8, maxDropV: 200, avrMaxComp: 1, avrDelay: 2, avrTime: 5, autoDecoupleTrim: true, visible: true },
    { Class: MarineMainsSwitch, id: 'qf1', x: -180, y: 180, ratedCtrlVoltage: 24, label: '主开关', genId: 'gen1', syncScopeId: 'sync1', phaseMin: 60, phaseMax: 270, freqDiffMax: 0.5, revPowerKw: 8, revTime: 5, visible: true },
    { Class: GeneratorRemotePanel, id: 'genpanel', x: 330, y: 700, genId: 'gen1', qfId: 'qf1', label: '1#发电机组遥控面板', busId: 'bus1', syncSelId: 'sync_sel', selPos: 2, visible: true },

    // ── 2# 机组：同步发电机 → 主开关 → 汇流排 ──
    { Class: SyncGenerator3P, id: 'gen2', x: 850, y: 700, vRms: 230, freq: 50, isOn: false, mode: 'remote', label: '2#同步发电机', ratedPower: 80, ratedVoltage: 400, ratedCosPhi: 0.8, maxDropV: 200, avrMaxComp: 1, avrDelay: 2, avrTime: 5, autoDecoupleTrim: true, visible: true },
    { Class: MarineMainsSwitch, id: 'qf2', x: 1100, y: 180, ratedCtrlVoltage: 24, label: '主开关2', genId: 'gen2', syncScopeId: 'sync1', phaseMin: 60, phaseMax: 270, freqDiffMax: 0.5, revPowerKw: 8, revTime: 5, visible: true },
    { Class: GeneratorRemotePanel, id: 'genpanel2', x: 1300, y: 700, genId: 'gen2', qfId: 'qf2', label: '2#发电机组遥控面板', busId: 'bus1', syncSelId: 'sync_sel', selPos: 3, visible: true },
    { Class: DCPower, id: 'dc_uv2', x: 1580, y: 750, voltage: 24, isOn: true, label: '失压脱扣电源2', visible: true },
    { Class: Busbar3P, id: 'bus1', x: 220, y: 30, tapsPerPhase: 6, label: '汇流排', visible: true },
    // 改为同步表中性点接地
    { Class: Ground, id: 'gnd1', x: 680, y: 500, visible: true },

    // ── 1# 机组控制电源共地（遥控面板与控制电源的中间下方）──
    { Class: Ground, id: 'gnd1_uv', x: 590, y: 1000, label: '控制电源接地', visible: true },
    // ── 1# 主开关线圈接地（主开关右下角）：储能电机 m2 / 失压 uv2 / 合闸 c2 / 分励 flb ──
    { Class: Ground, id: 'gnd1_qf', x: 345, y: 465, label: '线圈接地', visible: true },
    // ── 1# 遥控面板信号接地（面板上方）：合闸 close_b / 分闸 open_b 负端 ──
    { Class: Ground, id: 'gnd1_panel', x: 530, y: 670, label: '信号接地', visible: true },

    // ── 2# 机组控制电源共地 ──
    { Class: Ground, id: 'gnd2_uv', x: 1560, y: 990, label: '控制电源接地', visible: true },
    { Class: Ground, id: 'gnd2_qf', x: 1606, y: 459, label: '线圈接地', visible: true },
    { Class: Ground, id: 'gnd2_panel', x: 1470, y: 660, label: '信号接地', visible: true },

    // ── 数字同步表：上=汇流排 A 相，左=待并机 A 相（经选择开关），下=接地 ──
    { Class: Syncroscope, id: 'sync1', x: 600, y: 170, label: '数字同步表', visible: true },

    // ── 三相可调负载：置于同步表与 2# 主开关之间（汇流排第 5 列直连）──
    { Class: ThreePhaseLoad, id: 'load3', x: 950, y: 180, powerKw: 20, cosPhi: 1, reactive: 'ind', loaded: false, label: '三相可调负载', visible: true },

    // ── 待并机选择开关：单刀四掷（OFF / 待并机1 / 待并机2 / 待并机3）──
    // 档位 1=OFF（同步表关闭）、2=1# 机、3=2# 机、4=3# 机（预留）
    { Class: SP4TSwitch, id: 'sync_sel', x: 650, y: 530, label: '同步表选择开关', function: '同步表选择开关', labelNames: ['OFF', '1', '2', '3'], initPosition: 1, visible: true },

    // ── 控制电源（DC 24 V）：失压脱扣线圈 ──
    { Class: DCPower, id: 'dc_uv', x: 600, y: 750, voltage: 24, isOn: true, label: '失压脱扣电源', visible: true },

    // ── 汇流排馈出支路：QF3 → 三盏白炽灯（分别接 L1/L2/L3）──
    { Class: DiagramThreePhaseACB, id: 'acb_l', x: 1826, y: 80, initState: 'on', label: 'QF3', ratedVoltage: 380, ratedCurrent: 100, tripCurrent: 10, visible: true },
    { Class: IncandescentLamp, id: 'lamp1', x: 1850, y: 770, coldResistance: 4.84, rotation: 90 },
    { Class: IncandescentLamp, id: 'lamp2', x: 1920, y: 770, coldResistance: 4.84, rotation: 90 },
    { Class: IncandescentLamp, id: 'lamp3', x: 1990, y: 770, coldResistance: 4.84, rotation: 90 },
    { Class: Ground, id: 'gnd_l', x: 1950, y: 890, visible: true },

    // ── 7 种保留仪表（默认隐藏，由工具栏「选择仪表」调出）──
    { Class: Multimeter, id: 'multimeter', x: 920, y: 100, visible: false },
    { Class: MF47Multimeter, id: 'mf47-panel', x: 1050, y: 150, visible: false },
    { Class: Oscilloscope_tri, id: 'osc', x: 50, y: 50, visible: false },
    { Class: SignalGenerator, id: 'sg', x: 50, y: 50, visible: false },
    { Class: ProcessCalibrator, id: 'cali', x: 50, y: 50, visible: false },
    { Class: ElecMeter, id: 'elecmeter', x: 50, y: 50, visible: false },
    { Class: RealMegohmMeter, id: 'megohm', x: 1600, y: 100, rampTime: 0.5, visible: false },
];

// ═══════════════════════════════════════════════════════════════
// 六、接线
// ═══════════════════════════════════════════════════════════════

function _autoWire(sys) {
    if (!sys || !sys.connMgr) return;
    sys.conns.length = 0;
    const cons = [
        // ── 主回路：1# 同步发电机 → 主开关 → 汇流排 ──
        { from: 'gen1_wire_u', to: 'qf1_wire_t1', type: 'wire' },
        { from: 'gen1_wire_v', to: 'qf1_wire_t2', type: 'wire' },
        { from: 'gen1_wire_w', to: 'qf1_wire_t3', type: 'wire' },
        { from: 'qf1_wire_l1', to: 'bus1_wire_l1_1', type: 'wire' },
        { from: 'qf1_wire_l2', to: 'bus1_wire_l2_1', type: 'wire' },
        { from: 'qf1_wire_l3', to: 'bus1_wire_l3_1', type: 'wire' },
        // ── 支路：汇流排第 8 列三相 → QF3 → 三盏白炽灯 → 接地 ──
        { from: 'bus1_wire_l1_8', to: 'acb_l_wire_l1', type: 'wire' },
        { from: 'bus1_wire_l2_8', to: 'acb_l_wire_l2', type: 'wire' },
        { from: 'bus1_wire_l3_8', to: 'acb_l_wire_l3', type: 'wire' },
        { from: 'acb_l_wire_t1', to: 'lamp1_wire_l', type: 'wire' },
        { from: 'acb_l_wire_t2', to: 'lamp2_wire_l', type: 'wire' },
        { from: 'acb_l_wire_t3', to: 'lamp3_wire_l', type: 'wire' },
        { from: 'lamp1_wire_r', to: 'gnd_l_wire_gnd', type: 'wire' },
        { from: 'lamp2_wire_r', to: 'gnd_l_wire_gnd', type: 'wire' },
        { from: 'lamp3_wire_r', to: 'gnd_l_wire_gnd', type: 'wire' },
        // ── 2# 机组：gen2 → qf2 → 汇流排（第 7 列）──
        { from: 'gen2_wire_u', to: 'qf2_wire_t1', type: 'wire' },
        { from: 'gen2_wire_v', to: 'qf2_wire_t2', type: 'wire' },
        { from: 'gen2_wire_w', to: 'qf2_wire_t3', type: 'wire' },
        { from: 'qf2_wire_l1', to: 'bus1_wire_l1_7', type: 'wire' },
        { from: 'qf2_wire_l2', to: 'bus1_wire_l2_7', type: 'wire' },
        { from: 'qf2_wire_l3', to: 'bus1_wire_l3_7', type: 'wire' },
        // ── 三相可调负载（load3）：汇流排第 5 列直连，N 端接同步表旁接地 ──
        { from: 'bus1_wire_l1_5', to: 'load3_wire_l1', type: 'wire' },
        { from: 'bus1_wire_l2_5', to: 'load3_wire_l2', type: 'wire' },
        { from: 'bus1_wire_l3_5', to: 'load3_wire_l3', type: 'wire' },
        { from: 'load3_wire_n', to: 'gnd1_wire_gnd', type: 'wire' },
        // ── 数字同步表：汇流排 A 相 + 待并机 A 相（经选择开关 COM）+ 接地参考 ──
        { from: 'bus1_wire_l1_3', to: 'sync1_wire_bus', type: 'wire' },
        { from: 'sync_sel_wire_com', to: 'sync1_wire_gen', type: 'wire' },
        { from: 'sync1_wire_gnd', to: 'gnd1_wire_gnd', type: 'wire' },
        // ── 选择开关：T2=1# 机，T3=2# 机，T4=3# 机（预留悬空），T1=OFF（悬空）──
        { from: 'sync_sel_wire_t2', to: 'gen1_wire_u', type: 'wire' },
        { from: 'sync_sel_wire_t3', to: 'gen2_wire_u', type: 'wire' },
        // ── 2# 机组控制电源：失压线圈 / 储能电机 正端接电源，负端接地 ──
        { from: 'dc_uv2_wire_p', to: 'qf2_wire_uv1', type: 'wire' },
        { from: 'dc_uv2_wire_p', to: 'qf2_wire_m1', type: 'wire' },
        { from: 'qf2_wire_uv2', to: 'gnd2_qf_wire_gnd', type: 'wire' },
        { from: 'qf2_wire_m2', to: 'gnd2_qf_wire_gnd', type: 'wire' },
        // ── 2# 遥控面板 → gen2 / qf2 ──
        { from: 'genpanel2_wire_start_a', to: 'gen2_wire_rm_start_a', type: 'wire' },
        { from: 'genpanel2_wire_start_b', to: 'gen2_wire_rm_start_b', type: 'wire' },
        { from: 'genpanel2_wire_stop_a', to: 'gen2_wire_rm_stop_a', type: 'wire' },
        { from: 'genpanel2_wire_stop_b', to: 'gen2_wire_rm_stop_b', type: 'wire' },
        { from: 'genpanel2_wire_spd_p', to: 'gen2_wire_freq_in_p', type: 'wire' },
        { from: 'genpanel2_wire_spd_n', to: 'gen2_wire_freq_in_n', type: 'wire' },
        { from: 'genpanel2_wire_close_a', to: 'qf2_wire_c1', type: 'wire' },
        { from: 'genpanel2_wire_open_a', to: 'qf2_wire_fla', type: 'wire' },
        { from: 'genpanel2_wire_close_b', to: 'gnd2_panel_wire_gnd', type: 'wire' },
        { from: 'genpanel2_wire_open_b', to: 'gnd2_panel_wire_gnd', type: 'wire' },
        { from: 'qf2_wire_c2', to: 'gnd2_qf_wire_gnd', type: 'wire' },
        { from: 'qf2_wire_flb', to: 'gnd2_qf_wire_gnd', type: 'wire' },
        { from: 'dc_uv2_wire_p', to: 'genpanel2_wire_p24_p', type: 'wire' },
        { from: 'dc_uv2_wire_n', to: 'gnd2_uv_wire_gnd', type: 'wire' },
        { from: 'genpanel2_wire_p24_n', to: 'gnd2_uv_wire_gnd', type: 'wire' },
        // ── 1# 机组控制电源：失压线圈 / 储能电机 正端接电源，负端接地 ──
        { from: 'dc_uv_wire_p', to: 'qf1_wire_uv1', type: 'wire' },
        { from: 'dc_uv_wire_p', to: 'qf1_wire_m1', type: 'wire' },
        { from: 'qf1_wire_uv2', to: 'gnd1_qf_wire_gnd', type: 'wire' },
        { from: 'qf1_wire_m2', to: 'gnd1_qf_wire_gnd', type: 'wire' },
        // ── 1# 遥控面板 → gen1 / qf1 ──
        { from: 'genpanel_wire_start_a', to: 'gen1_wire_rm_start_a', type: 'wire' },
        { from: 'genpanel_wire_start_b', to: 'gen1_wire_rm_start_b', type: 'wire' },
        { from: 'genpanel_wire_stop_a', to: 'gen1_wire_rm_stop_a', type: 'wire' },
        { from: 'genpanel_wire_stop_b', to: 'gen1_wire_rm_stop_b', type: 'wire' },
        { from: 'genpanel_wire_spd_p', to: 'gen1_wire_freq_in_p', type: 'wire' },
        { from: 'genpanel_wire_spd_n', to: 'gen1_wire_freq_in_n', type: 'wire' },
        { from: 'genpanel_wire_close_a', to: 'qf1_wire_c1', type: 'wire' },
        { from: 'genpanel_wire_open_a', to: 'qf1_wire_fla', type: 'wire' },
        { from: 'genpanel_wire_close_b', to: 'gnd1_panel_wire_gnd', type: 'wire' },
        { from: 'genpanel_wire_open_b', to: 'gnd1_panel_wire_gnd', type: 'wire' },
        { from: 'qf1_wire_c2', to: 'gnd1_qf_wire_gnd', type: 'wire' },
        { from: 'qf1_wire_flb', to: 'gnd1_qf_wire_gnd', type: 'wire' },
        { from: 'dc_uv_wire_p', to: 'genpanel_wire_p24_p', type: 'wire' },
        { from: 'dc_uv_wire_n', to: 'gnd1_uv_wire_gnd', type: 'wire' },
        { from: 'genpanel_wire_p24_n', to: 'gnd1_uv_wire_gnd', type: 'wire' },
    ];
    cons.forEach(c => sys.connMgr.addConn(c));
    if (typeof sys.redrawAll === 'function') sys.redrawAll();
}

export function initSlider(_sys) {
}

/** 默认不接线：初始化（opts.init=true）时不预接线 */
export function applyAllPresets(opts) {
    if (opts && opts.init) return;
    const sys = this && this.sys ? this.sys : window.sys;
    if (!sys) return;
    _autoWire(sys);
}

/** 起动系统：接线 → 复位 → 遥控起动 1# 机（频率回 50 Hz） */
export async function applyStartSystem() {
    const sys = this && this.sys ? this.sys : window.sys;
    if (!sys) return;
    try {
        _autoWire(sys);
        await _sleep(400);
        const ctx = { sys };
        await _resetRig(ctx);
        await _startGen(ctx, 'genpanel', 'gen1');
        await _setFreqTo(ctx, 'genpanel', 'gen1', 50);
    } catch (e) {
        console.warn('[起动系统] 执行异常：', e);
    }
}

export function fiveStep() {
}
