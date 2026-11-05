// 自动化电站主开关跳闸的应急处理仿真工程
// （两台同步发电机 + 两台船用框架式空气断路器主开关 + 汇流排 + 电站自动控制模块）
//
// 教学主线：自动化电站在"机械故障 / 欠压 / 干线短路"三类原因造成主开关跳闸后的
//          自动处置过程——自动识别故障机组并跳过、按备用顺序自动起动备用机组、
//          建压储能后自动合闸恢复供电；短路期间闭锁自动模式，防止对短路点反复送电。
//
// 电路组成（单页工程，全部元件同屏）：
//   1#机组  gen1（80 kW 同步发电机）→ qf1 主开关 → bus1 汇流排第 1 列
//   2#机组  gen2（80 kW 同步发电机）→ qf2 主开关 → bus1 汇流排第 7 列
//   馈出    bus1 第 8 列 → acb_l（QF3）→ lamp1~3 三盏白炽灯
//   采集    bus1 第 4 列 → auto_ctl 母线采集口（bus_a/bus_b）
//   负载    bus1 第 6 列 → load3 三相可调负载（默认 20 kW，可在参数界面改）
//   自动    auto_ctl 电站自动控制模块：手动/自动转换旋钮、备用顺序旋钮、
//           母线采集（bus_a/bus_b）+ 24V 电源 + 与两块遥控面板的通信口
//   控制    dc_uv / dc_uv2（DC 24 V）→ 失压脱扣线圈、储能电机、合闸/分励线圈
//           genpanel / genpanel2 发电机组遥控面板 → 遥控起动/停止、调速、合闸/分闸
//
// 主开关保护（qf1 / qf2 内置，faultSimpleProtect=true）：
//   · 欠压：端子电压 < 额定 ×85% 持续 2 s → 延时跳闸（发电机可仍在运行）
//   · 干线短路：汇流排短路标记存在 → 瞬时跳闸
//   · 过载 / 逆功率 / 频差非同期：本工程未参与教学主线，定值保留在组件内
//
// 自动控制模块的处置逻辑（ShipAutoControl）：
//   · 失电自动起动：母线无电 3 s → 按备用顺序取首台"无故障"机组发起动命令
//   · 自动合闸：机组运行、电压建立、合闸弹簧储能完成后延时 3 s 发合闸命令
//   · 故障机组判定：AVR 欠压故障、超速 / 滑油低压 / 冷却水温高 → 视为不可用并跳过
//   · 短路闭锁：系统中存在 _faultShort 标记时闭锁自动模式（自动灯熄灭，不发起动/合闸）
//
// 约定（与全局 AGENTS.md「最新范式」一致）：
//   · 单页工程：不导出 PROJECT_PAGES，consys.js 不创建 PageManager，工作流无 page op
//   · 默认不接线：applyAllPresets({init:true}) 不接线；只有「自动接线 / 起动系统 / 工作流 op」才接线
//   · 故障一律走「故障设置」界面（op.type='fault'），不直接改组件故障标志
//   · 按钮/旋钮/开关一律模拟真实操作（getClickablePartNode(...).fire('mousedown'/'mouseup'/'click')）
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
import { ThreePhaseLoad } from '../components/ThreePhaseLoad.js';
import { ShipAutoControl } from '../components/ShipAutoControl.js';

// ═══════════════════════════════════════════════════════════════
// 一、故障（一律由「故障设置」界面触发/修复）
// ═══════════════════════════════════════════════════════════════

const _fcomp = (id) => (window.sys && window.sys.comps) ? window.sys.comps[id] : null;

export const FAULT_CONFIGS = {
    // 1#机超速故障：原动机超速保护动作，立即停机；单机运行时失压 → 主开关欠压跳闸
    gen1_overspeed: {
        id: 'gen1_overspeed',
        name: '1#机超速故障',
        system: '发电机',
        check() {
            const c = _fcomp('gen1');
            return !!(c && c.getEngineFaults && c.getEngineFaults().overspeed);
        },
        trigger() {
            const c = _fcomp('gen1');
            if (c && c.setEngineFault) c.setEngineFault('overspeed', true);
        },
        repair() {
            const c = _fcomp('gen1');
            if (c && c.setEngineFault) c.setEngineFault('overspeed', false);
        },
    },
    // 1#机滑油低压故障：滑油压力过低保护动作，立即停机
    gen1_oil_press: {
        id: 'gen1_oil_press',
        name: '1#机滑油低压故障',
        system: '发电机',
        check() {
            const c = _fcomp('gen1');
            return !!(c && c.getEngineFaults && c.getEngineFaults().oilPress);
        },
        trigger() {
            const c = _fcomp('gen1');
            if (c && c.setEngineFault) c.setEngineFault('oilPress', true);
        },
        repair() {
            const c = _fcomp('gen1');
            if (c && c.setEngineFault) c.setEngineFault('oilPress', false);
        },
    },
    // 1#机冷却水温高故障：单机运行时原动机保护停机 → 母线失压 → 主开关欠压跳闸
    gen1_coolant_temp: {
        id: 'gen1_coolant_temp',
        name: '1#机冷却水温高故障',
        system: '发电机',
        check() {
            const c = _fcomp('gen1');
            return !!(c && c.getEngineFaults && c.getEngineFaults().coolantTemp);
        },
        trigger() {
            const c = _fcomp('gen1');
            if (c && c.setEngineFault) c.setEngineFault('coolantTemp', true);
        },
        repair() {
            const c = _fcomp('gen1');
            if (c && c.setEngineFault) c.setEngineFault('coolantTemp', false);
        },
    },
    // 1#机欠压故障：调压器（AVR）故障使输出电压跌至 200 V（约 50% 额定），
    // 主开关简化欠压保护检测到欠压后 2 s 延时跳闸（发电机不停机）
    gen1_undervoltage: {
        id: 'gen1_undervoltage',
        name: '1#机欠压故障',
        system: '发电机',
        check() {
            const c = _fcomp('gen1');
            return !!(c && c._faultAVR);
        },
        trigger() {
            const c = _fcomp('gen1');
            if (c) c._faultAVR = true;
        },
        repair() {
            const c = _fcomp('gen1');
            if (c) c._faultAVR = false;
        },
    },
    // 汇流排干线短路故障：短路保护动作，在网主开关瞬时跳闸，全船失电
    bus_short: {
        id: 'bus_short',
        name: '汇流排干线短路故障',
        system: '汇流排',
        check() {
            const b = _fcomp('bus1');
            return !!(b && b._faultShort);
        },
        trigger() {
            const b = _fcomp('bus1');
            if (b) b._faultShort = true;
        },
        repair() {
            const b = _fcomp('bus1');
            if (b) b._faultShort = false;
        },
    },
};

// ═══════════════════════════════════════════════════════════════
// 二、通用辅助（一律模拟真实操作 + 条件轮询）
// ═══════════════════════════════════════════════════════════════

const _sysOf = (ctx) => (ctx && ctx.sys) ? ctx.sys : window.sys;
const _sleep = (ms) => new Promise(r => setTimeout(r, ms));
const _comp = (sys, id) => (sys && sys.comps) ? sys.comps[id] : null;
const _g1 = (ctx) => _comp(_sysOf(ctx), 'gen1');
const _g2 = (ctx) => _comp(_sysOf(ctx), 'gen2');
const _qf = (ctx, id) => _comp(_sysOf(ctx), id);
const _ac = (ctx) => _comp(_sysOf(ctx), 'auto_ctl');
const _bus = (ctx) => _comp(_sysOf(ctx), 'bus1');

/** 条件轮询等待（不写死 sleep 猜时间） */
async function _waitFor(sys, cond, timeout = 8000, interval = 100) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
        try { if (cond(sys)) return true; } catch (e) { /* ignore */ }
        await _sleep(interval);
    }
    return false;
}

/** 模拟操作组件部件（触发组件自身点击/按压逻辑，不直接改内部字段） */
function _firePart(comp, partId, evt = 'click') {
    if (!comp || typeof comp.getClickablePartNode !== 'function') return false;
    const node = comp.getClickablePartNode(partId);
    if (!node) return false;
    try { node.fire(evt, { evt: { cancelBubble: false } }); } catch (e) { return false; }
    return true;
}

/** 等某只主开关到达指定状态 */
async function _waitQf(ctx, qfId, want = 'off', timeout = 10000) {
    const sys = _sysOf(ctx);
    const ok = await _waitFor(sys, s => {
        const q = _comp(s, qfId);
        return !!q && q.getState() === want;
    }, timeout, 100);
    await _sleep(400);
    return ok;
}

/** 发电机组遥控面板按钮（起动/停止/合闸/分闸）——真实按压，取不到节点时兜底 */
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

/** 遥控起动机组 */
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

/** 遥控停机 */
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
async function _waitCharged(ctx, qfId, timeout = 12000) {
    const sys = _sysOf(ctx);
    return _waitFor(sys, s => { const q = _comp(s, qfId); return !!q && q.isCharged(); }, timeout);
}

/** 遥控合闸：等储能到位 → 按面板「合闸」→ 等主触头闭合 */
async function _closeViaPanel(ctx, panelId, qfId) {
    const q = _qf(ctx, qfId);
    if (!q) return false;
    await _waitCharged(ctx, qfId);
    await _panelPress(ctx, panelId, 'btn-close', 900);
    const ok = await _waitQf(ctx, qfId, 'on', 8000);
    await _sleep(500);
    return ok;
}

/** 遥控分闸：按面板「分闸」→ 等主触头断开 */
async function _openViaPanel(ctx, panelId, qfId) {
    const q = _qf(ctx, qfId);
    if (!q || q.getState() !== 'on') return true;
    await _panelPress(ctx, panelId, 'btn-open', 700);
    const ok = await _waitQf(ctx, qfId, 'off', 8000);
    await _sleep(500);
    return ok;
}

/** 主开关本体「手动分闸」按钮（复位用） */
async function _tripByHandle(ctx, qfId) {
    const q = _qf(ctx, qfId);
    if (!q || q.getState() !== 'on') return true;
    if (!_firePart(q, 'btn-open', 'mousedown') && typeof q.tryTrip === 'function') {
        console.warn('[主开关] 未取到分闸按钮节点，改用 tryTrip 兜底');
        q.tryTrip();
    }
    await _sleep(200);
    _firePart(q, 'btn-open', 'mouseup');
    const ok = await _waitQf(ctx, qfId, 'off', 8000);
    await _sleep(400);
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

/**
 * 手动/自动转换旋钮拨到目标位置（模拟点击旋钮，触发组件自身的换档逻辑）。
 * 旋钮是「点一次换一档」的循环开关：反复点击直到到达目标位，限次防死循环。
 */
async function _autoModeTo(ctx, wantAuto) {
    const ac = _ac(ctx);
    if (!ac) return false;
    const want = !!wantAuto;
    for (let i = 0; i < 4 && ac._auto !== want; i++) {
        if (!_firePart(ac, 'knob-mode', 'click')) {
            console.warn('[自动电站] 未取到手动/自动旋钮节点，改用 setter 兜底');
            ac._auto = want;
            ac.config.auto = want ? 'auto' : 'manual';
            break;
        }
        await _sleep(300);
    }
    await _sleep(400);
    return ac._auto === want;
}

/** 等自动电站完成「失电 → 自动起动 2# → 自动合闸」全过程 */
async function _waitAutoRecover(ctx, timeout = 30000) {
    const sys = _sysOf(ctx);
    return _waitFor(sys, s => {
        const g2 = _comp(s, 'gen2'), q2 = _comp(s, 'qf2');
        return !!g2 && g2.isOn && !!q2 && q2.getState() === 'on';
    }, timeout, 150);
}

/**
 * 复位时清理残留故障：上一任务留下的故障会让机组起不来。
 * 同样走「故障设置」界面（取消勾选 → 应用设置），不直接改组件故障标志。
 */
async function _clearFaultsViaUI(ctx) {
    const sys = _sysOf(ctx);
    if (!sys || !sys.FAULT_CONFIG) return;
    const active = Object.values(sys.FAULT_CONFIG).filter(f => {
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

/** 完整复位：清残留故障 → 分闸 → 两机停机 → 自动模块拨回手动 */
async function _resetRig(ctx) {
    const sys = _sysOf(ctx);
    if (!sys) return;
    await _clearFaultsViaUI(ctx);
    await _tripByHandle(ctx, 'qf1');
    await _tripByHandle(ctx, 'qf2');
    await _stopGen(ctx, 'genpanel', 'gen1');
    await _stopGen(ctx, 'genpanel2', 'gen2');
    await _autoModeTo(ctx, false);
    await _sleep(400);
}

/** 接线是否已建立（用于 check 判定主回路/控制回路已接） */
function _wired(sys, a, b) {
    return !!(sys && Array.isArray(sys.conns) && sys.conns.some(c =>
        c && c.type === 'wire' && ((c.from === a && c.to === b) || (c.from === b && c.to === a))));
}

// ═══════════════════════════════════════════════════════════════
// 三、常用步骤片段（每个子操作自带 act，"指向 → 执行"）
// ═══════════════════════════════════════════════════════════════

/** 「自动接线 + 复位」子操作 */
function _opsPrepare() {
    return [
        {
            type: 'wire', button: 'btnAutoWire', msg: '点击工具栏「自动接线」',
            async act() { await _autoWireBtn(this); },
        },
        {
            type: 'observe', target: 'auto_ctl', part: 'knob-mode', msg: '复位：两机停机、两只主开关分闸、旋钮回手动',
            async act() { await _resetRig(this); },
        },
    ];
}

/** 「起动 1# 机 → 合闸供电」子操作 */
function _opsGen1Supply() {
    return [
        {
            type: 'btn', target: 'genpanel', part: 'btn-start', msg: '按 1# 面板「起动」',
            async act() { await _startGen(this, 'genpanel', 'gen1'); },
        },
        {
            type: 'observe', target: 'qf1', part: 'store-spring', msg: '储能电机把合闸弹簧储满',
            async act() { await _waitCharged(this, 'qf1'); },
        },
        {
            type: 'btn', target: 'genpanel', part: 'btn-close', msg: '按 1# 面板「合闸」供电',
            async act() { await _closeViaPanel(this, 'genpanel', 'qf1'); },
        },
    ];
}

/** 「把自动控制模块投入自动」子操作 */
function _opsAutoMode() {
    return [
        {
            type: 'knob', target: 'auto_ctl', part: 'knob-mode', msg: '把「手动/自动」旋钮转到自动档',
            async act() { await _autoModeTo(this, true); },
        },
    ];
}

// ═══════════════════════════════════════════════════════════════
// 四、工作流
// ═══════════════════════════════════════════════════════════════

export const PROJECT_WORKFLOWS = {
    // ───────────────────────────────────────────────────────────
    // 1# 机组机械故障 → 主开关跳闸 → 自动电站自动起动 2# 机组恢复
    // ───────────────────────────────────────────────────────────
    'auto-mech-trip-recovery': {
        id: 'auto-mech-trip-recovery',
        name: '1.机械故障导致主开关跳闸（自动电站自动恢复）',
        steps: [
            {
                msg: '第 1 步：识别自动控制模块的「手动/自动」转换旋钮。',
                mode: 'find', target: 'auto_ctl', subTarget: 'knob-mode',
            },
            {
                msg: '第 2 步：自动接线，起动 1# 机并合闸供电。',
                mode: 'check',
                op: [..._opsPrepare(), ..._opsGen1Supply()],
                check() {
                    const sys = _sysOf(this);
                    return _wired(sys, 'gen1_wire_u', 'qf1_wire_t1')
                        && _wired(sys, 'genpanel_wire_p24_p', 'dc_uv_wire_p')
                        && !!_g1(this).isOn && _qf(this, 'qf1').getState() === 'on';
                },
            },
            {
                msg: '第 3 步：旋钮转到自动档，电站投入自动运行。',
                mode: 'check',
                op: _opsAutoMode(),
                check() {
                    const ac = _ac(this);
                    return !!ac && ac._auto === true && ac._powered === true;
                },
            },
            {
                msg: '第 4 步：设置「冷却水温高」，观察停机与主开关跳闸。',
                mode: 'check',
                op: [
                    {
                        type: 'fault', fault: 'gen1_coolant_temp', msg: '勾选「1#机冷却水温高故障」并应用',
                        async act() { await _sleep(600); },
                    },
                    {
                        type: 'observe', target: 'genpanel', part: 'run-led', msg: '原动机保护停机，1# 机转速下降',
                        async act() { await _waitFor(_sysOf(this), s => !_comp(s, 'gen1').isOn, 12000, 150); },
                    },
                    {
                        type: 'observe', target: 'qf1', part: 'main-contact', msg: '母线失压，主开关欠压保护跳闸',
                        async act() { await _waitQf(this, 'qf1', 'off', 12000); },
                    },
                ],
                check() {
                    const f = _g1(this).getEngineFaults ? _g1(this).getEngineFaults() : {};
                    return !!f.coolantTemp && !_g1(this).isOn && _qf(this, 'qf1').getState() === 'off';
                },
            },
            {
                msg: '第 5 步：观察自动电站自动起动 2# 机并合闸恢复。',
                mode: 'check',
                op: [
                    {
                        type: 'observe', target: 'auto_ctl', part: 'lcd', msg: '自动电站检测全船失电，跳过故障的 1# 机，起动 2# 机',
                        async act() { await _waitFor(_sysOf(this), s => !!_comp(s, 'gen2').isOn, 20000, 150); },
                    },
                    {
                        type: 'observe', target: 'qf2', part: 'main-contact', msg: '2# 机建压储能后自动合闸，恢复全船供电',
                        async act() { await _waitAutoRecover(this); },
                    },
                ],
                check() {
                    return !!_g2(this).isOn && _qf(this, 'qf2').getState() === 'on'
                        && !!_ac(this) && _ac(this)._auto === true;
                },
            },
            {
                msg: '第 6 步：测试题——自动电站的失电恢复流程。',
                mode: 'quiz',
                quizConfig: {
                    question: '自动化电站运行中，1# 机组因冷却水温高保护停机、主开关跳闸造成全船失电，自动电站接下来会怎样处理？',
                    options: [
                        '检测到母线失电后，跳过故障的 1# 机，按备用顺序自动起动 2# 机组，建压储能后自动合闸恢复供电',
                        '检测到失电后自动恢复 1# 机继续运行并重新合闸',
                        '立即停止工作，等待人工手动起动 2# 机组',
                        '反复尝试合闸 1# 主开关直至成功',
                    ],
                    answer: 0,
                    analysis: '自动电站检测到母线失电后，按备用顺序逐台查找可用机组：1# 机带原动机故障被判定为"不可用"并跳过，随后自动向 2# 机组发出起动命令；2# 机组运行、建压且储能完成后，自动延时发出合闸命令恢复供电，全过程无需人工干预。',
                },
            },
        ],
    },

    // ───────────────────────────────────────────────────────────
    // 1# 机组欠压（AVR）→ 主开关欠压跳闸 → 自动电站换机恢复
    // ───────────────────────────────────────────────────────────
    'auto-uv-trip-recovery': {
        id: 'auto-uv-trip-recovery',
        name: '2.欠压故障导致主开关跳闸（自动电站自动恢复）',
        steps: [
            {
                msg: '第 1 步：识别 1# 主开关的主触头（欠压保护动作处）。',
                mode: 'find', target: 'qf1', subTarget: 'main-contact',
            },
            {
                msg: '第 2 步：自动接线，起动 1# 机并合闸供电。',
                mode: 'check',
                op: [..._opsPrepare(), ..._opsGen1Supply()],
                check() {
                    const sys = _sysOf(this);
                    return _wired(sys, 'gen1_wire_u', 'qf1_wire_t1')
                        && !!_g1(this).isOn && _qf(this, 'qf1').getState() === 'on';
                },
            },
            {
                msg: '第 3 步：旋钮转到自动档，电站投入自动运行。',
                mode: 'check',
                op: _opsAutoMode(),
                check() {
                    const ac = _ac(this);
                    return !!ac && ac._auto === true && ac._powered === true;
                },
            },
            {
                msg: '第 4 步：设置「1#机欠压故障」，观察电压跌落与延时跳闸。',
                mode: 'check',
                op: [
                    {
                        type: 'fault', fault: 'gen1_undervoltage', msg: '勾选「1#机欠压故障」并应用',
                        async act() { await _sleep(600); },
                    },
                    {
                        type: 'observe', target: 'genpanel', part: 'run-led', msg: 'AVR 故障，机端电压跌至 200 V，机组仍在运行',
                        async act() { await _waitFor(_sysOf(this), s => {
                            const g = _comp(s, 'gen1');
                            return !!g && g._faultAVR && g.isOn;
                        }, 6000, 150); },
                    },
                    {
                        type: 'observe', target: 'qf1', part: 'main-contact', msg: '欠压持续 2 s，主开关欠压保护跳闸',
                        async act() { await _waitQf(this, 'qf1', 'off', 12000); },
                    },
                ],
                check() {
                    return !!_g1(this)._faultAVR && _g1(this).isOn && _qf(this, 'qf1').getState() === 'off';
                },
            },
            {
                msg: '第 5 步：观察自动电站跳过带故障的 1# 机，起动 2# 机恢复。',
                mode: 'check',
                op: [
                    {
                        type: 'observe', target: 'auto_ctl', part: 'lcd', msg: '1# 机带欠压故障不可用，自动电站按顺序起动 2# 机',
                        async act() { await _waitFor(_sysOf(this), s => !!_comp(s, 'gen2').isOn, 20000, 150); },
                    },
                    {
                        type: 'observe', target: 'qf2', part: 'main-contact', msg: '2# 机自动合闸，恢复全船供电',
                        async act() { await _waitAutoRecover(this); },
                    },
                ],
                check() {
                    return !!_g2(this).isOn && _qf(this, 'qf2').getState() === 'on'
                        && !!_ac(this) && _ac(this)._auto === true;
                },
            },
            {
                msg: '第 6 步：测试题——为什么要隔离带故障的机组。',
                mode: 'quiz',
                quizConfig: {
                    question: '1# 机组 AVR 欠压故障使 1# 主开关跳闸、全船失电，自动电站为什么改为起动 2# 机组而不是恢复 1# 机组？',
                    options: [
                        '1# 机带欠压故障不能正常供电，自动电站按备用顺序跳过它，起动无故障的 2# 机恢复供电',
                        '欠压只影响电压显示，不影响供电，可继续使用 1# 机',
                        '自动电站只能起动 1# 机，与故障无关',
                        '欠压故障会自动恢复，等待 1# 机重新建压即可',
                    ],
                    answer: 0,
                    analysis: '自动电站的机组可用性判定：AVR 欠压故障或任一原动机故障（超速、滑油低压、冷却水温高）都会把该机组标记为"不可用"。母线失电时按规定顺序逐台查找可用机组，带故障的 1# 机被跳过，2# 机被选中并自动合闸。把带病机组隔离在电网之外，是恢复供电可靠性的关键。',
                },
            },
        ],
    },

    // ───────────────────────────────────────────────────────────
    // 汇流排干线短路 → 主开关瞬时跳闸 → 自动模式闭锁 → 排故后恢复
    // ───────────────────────────────────────────────────────────
    'auto-short-trip-recovery': {
        id: 'auto-short-trip-recovery',
        name: '3.短路故障导致主开关跳闸（自动模式闭锁）',
        steps: [
            {
                msg: '第 1 步：识别自动控制模块的「自动模式」指示灯。',
                mode: 'find', target: 'auto_ctl', subTarget: 'led-auto',
            },
            {
                msg: '第 2 步：自动接线，起动 1# 机并合闸供电。',
                mode: 'check',
                op: [..._opsPrepare(), ..._opsGen1Supply()],
                check() {
                    const sys = _sysOf(this);
                    return _wired(sys, 'gen1_wire_u', 'qf1_wire_t1')
                        && !!_g1(this).isOn && _qf(this, 'qf1').getState() === 'on';
                },
            },
            {
                msg: '第 3 步：旋钮转到自动档，电站投入自动运行。',
                mode: 'check',
                op: _opsAutoMode(),
                check() {
                    const ac = _ac(this);
                    return !!ac && ac._auto === true && ac._powered === true;
                },
            },
            {
                msg: '第 4 步：设置「汇流排干线短路」，观察主开关瞬时跳闸。',
                mode: 'check',
                op: [
                    {
                        type: 'fault', fault: 'bus_short', msg: '勾选「汇流排干线短路故障」并应用',
                        async act() { await _sleep(600); },
                    },
                    {
                        type: 'observe', target: 'qf1', part: 'main-contact', msg: '干线短路，1# 主开关短路保护瞬时跳闸、全船失电',
                        async act() { await _waitQf(this, 'qf1', 'off', 8000); },
                    },
                ],
                check() {
                    return !!_bus(this)._faultShort && _qf(this, 'qf1').getState() === 'off';
                },
            },
            {
                msg: '第 5 步：观察自动模式被闭锁，再把旋钮拨回手动。',
                mode: 'check',
                op: [
                    {
                        type: 'observe', target: 'auto_ctl', part: 'led-auto', msg: '自动灯熄灭：短路期间闭锁，不自动起动、不自动合闸',
                        async act() { await _sleep(6000); },
                    },
                    {
                        type: 'knob', target: 'auto_ctl', part: 'knob-mode', msg: '把旋钮拨回手动档，退出自动运行',
                        async act() { await _autoModeTo(this, false); },
                    },
                ],
                check() {
                    const ac = _ac(this);
                    return !!ac && ac._shortFault === true && ac._auto === false
                        && !_g2(this).isOn && _qf(this, 'qf2').getState() === 'off';
                },
            },
            {
                msg: '第 6 步：排除短路故障后，合上 1# 主开关恢复供电。',
                mode: 'check',
                op: [
                    {
                        type: 'fault', fault: 'bus_short', repair: true, msg: '取消勾选「汇流排干线短路故障」，排除短路',
                        async act() { await _sleep(600); },
                    },
                    {
                        type: 'observe', target: 'auto_ctl', part: 'led-auto', msg: '短路标记清除，闭锁解除',
                        async act() { await _waitFor(_sysOf(this), s => !s.comps.bus1._faultShort, 5000, 150); },
                    },
                    {
                        type: 'btn', target: 'genpanel', part: 'btn-close', msg: '手动合上 1# 主开关恢复全船供电',
                        async act() { await _closeViaPanel(this, 'genpanel', 'qf1'); },
                    },
                ],
                check() {
                    return !_bus(this)._faultShort && _qf(this, 'qf1').getState() === 'on';
                },
            },
            {
                msg: '第 7 步：测试题——短路跳闸后的正确恢复方式。',
                mode: 'quiz',
                quizConfig: {
                    question: '汇流排干线短路使主开关瞬时跳闸、自动模式被闭锁，正确的恢复步骤是（　）。',
                    options: [
                        '先查明并隔离短路点，确认短路排除后，再合闸恢复供电',
                        '把旋钮拨回自动档，让自动电站马上自动恢复',
                        '不查明原因，反复手动合闸直到合上为止',
                        '断开全部负载即可直接合闸',
                    ],
                    answer: 0,
                    analysis: '干线短路电流极大，主开关瞬时跳闸以保护发电机与人身安全。自动电站检测到短路标记时闭锁自动模式，正是为了防止对短路点反复送电、扩大故障。必须查明并隔离短路点（绝缘损坏、进水、误操作、检修遗留物等），确认短路排除后才能合闸恢复；未排除就合闸会再次造成短路冲击。',
                },
            },
        ],
    },
};

// ═══════════════════════════════════════════════════════════════
// 五、组件布局
// ═══════════════════════════════════════════════════════════════

export const componentConfigs = [
    // ── 主回路：1# 同步发电机 → 1# 主开关 → 汇流排 ──
    { Class: SyncGenerator3P, id: 'gen1', x: -100, y: 700, vRms: 230, freq: 50, isOn: false, mode: 'remote', label: '1#同步发电机', ratedPower: 80, ratedVoltage: 400, ratedCosPhi: 0.8, maxDropV: 200, avrMaxComp: 1, avrDelay: 2, avrTime: 5, autoDecoupleTrim: true, visible: true },
    { Class: MarineMainsSwitch, id: 'qf1', x: -180, y: 180, ratedCtrlVoltage: 24, label: '主开关', genId: 'gen1', phaseMin: 60, phaseMax: 270, freqDiffMax: 0.5, revPowerKw: 8, revTime: 5, faultSimpleProtect: true, visible: true },
    { Class: GeneratorRemotePanel, id: 'genpanel', x: 330, y: 700, genId: 'gen1', qfId: 'qf1', label: '1#发电机组遥控面板', visible: true },

    // ── 2# 机组：2# 同步发电机 → 2# 主开关 → 汇流排 ──
    { Class: SyncGenerator3P, id: 'gen2', x: 850, y: 700, vRms: 230, freq: 50, isOn: false, mode: 'remote', label: '2#同步发电机', ratedPower: 80, ratedVoltage: 400, ratedCosPhi: 0.8, maxDropV: 200, avrMaxComp: 1, avrDelay: 2, avrTime: 5, autoDecoupleTrim: true, visible: true },
    { Class: MarineMainsSwitch, id: 'qf2', x: 1100, y: 180, ratedCtrlVoltage: 24, label: '主开关2', genId: 'gen2', phaseMin: 60, phaseMax: 270, freqDiffMax: 0.5, revPowerKw: 8, revTime: 5, faultSimpleProtect: true, visible: true },
    { Class: GeneratorRemotePanel, id: 'genpanel2', x: 1300, y: 700, genId: 'gen2', qfId: 'qf2', label: '2#发电机组遥控面板', visible: true },
    { Class: DCPower, id: 'dc_uv2', x: 1580, y: 750, voltage: 24, isOn: true, label: '失压脱扣电源2', visible: true },

    // ── 汇流排：8 口，第 1 列 1# 机进线、第 4 列自动模块采集、第 5 列负载、第 7 列 2# 机进线、第 8 列馈出 ──
    { Class: Busbar3P, id: 'bus1', x: 220, y: 30, portsPerBar: 8, label: '汇流排', visible: true },
    // 负载中性点接地（放在负载右侧下方）
    { Class: Ground, id: 'gnd1', x: 2020, y: 480, visible: true },

    // ── 1# 机组控制电源共地（遥控面板与控制电源的中间下方）──
    { Class: Ground, id: 'gnd1_uv', x: 590, y: 1000, label: '控制电源接地', visible: true },
    // ── 1# 主开关线圈接地（主开关右下角）──
    { Class: Ground, id: 'gnd1_qf', x: 345, y: 465, label: '线圈接地', visible: true },
    // ── 1# 遥控面板信号接地（面板上方）──
    { Class: Ground, id: 'gnd1_panel', x: 530, y: 670, label: '信号接地', visible: true },

    // ── 2# 机组控制电源共地 ──
    { Class: Ground, id: 'gnd2_uv', x: 1560, y: 990, label: '控制电源接地', visible: true },
    { Class: Ground, id: 'gnd2_qf', x: 1606, y: 459, label: '线圈接地', visible: true },
    { Class: Ground, id: 'gnd2_panel', x: 1470, y: 660, label: '信号接地', visible: true },

    // ── 电站自动控制模块：母线采集 + 24V 电源 + 两块遥控面板通信 ──
    { Class: ShipAutoControl, id: 'auto_ctl', x: 600, y: 170, genIds: 'gen1,gen2', qfIds: 'qf1,qf2', panelIds: 'genpanel,genpanel2', auto: 'manual', seq: '123', parallelKw: 80, decoupleKw: 30, label: '船舶电站自动控制模块', visible: true },

    // ── 三相可调负载：汇流排第 6 口三相直连，N 端接地 gnd1 ──
    { Class: ThreePhaseLoad, id: 'load3', x: 1760, y: 220, powerKw: 20, cosPhi: 1, reactive: 'ind', loaded: false, label: '三相可调负载', visible: true },

    // ── 控制电源（DC 24V）：1# 机组失压脱扣线圈 / 自动模块电源 ──
    { Class: DCPower, id: 'dc_uv', x: 600, y: 750, voltage: 24, isOn: true, label: '失压脱扣电源', visible: true },

    // ── 汇流排馈出支路 ──
    // 支路（第 8 列）：三相空气开关 QF3 → 三盏白炽灯（分别接 L1/L2/L3）
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
// 六、接线（71 根 > 8 根，允许瞬时接线）
// ═══════════════════════════════════════════════════════════════

function _autoWire(sys) {
    if (!sys || !sys.connMgr) return;
    sys.conns.length = 0;
    const cons = [
        // ── 主回路：1# 同步发电机 → 1# 主开关 → 汇流排第 1 列 ──
        { from: 'gen1_wire_u', to: 'qf1_wire_t1', type: 'wire' },
        { from: 'gen1_wire_v', to: 'qf1_wire_t2', type: 'wire' },
        { from: 'gen1_wire_w', to: 'qf1_wire_t3', type: 'wire' },
        { from: 'qf1_wire_l1', to: 'bus1_wire_l1_1', type: 'wire' },
        { from: 'qf1_wire_l2', to: 'bus1_wire_l2_1', type: 'wire' },
        { from: 'qf1_wire_l3', to: 'bus1_wire_l3_1', type: 'wire' },
        // ── 2# 机组：gen2 → qf2 → 汇流排第 7 列 ──
        { from: 'gen2_wire_u', to: 'qf2_wire_t1', type: 'wire' },
        { from: 'gen2_wire_v', to: 'qf2_wire_t2', type: 'wire' },
        { from: 'gen2_wire_w', to: 'qf2_wire_t3', type: 'wire' },
        { from: 'qf2_wire_l1', to: 'bus1_wire_l1_7', type: 'wire' },
        { from: 'qf2_wire_l2', to: 'bus1_wire_l2_7', type: 'wire' },
        { from: 'qf2_wire_l3', to: 'bus1_wire_l3_7', type: 'wire' },

        // ── 馈出：汇流排第 8 列 → QF3 → 三盏白炽灯（L1/L2/L3 各一）→ 接地 ──
        { from: 'bus1_wire_l1_8', to: 'acb_l_wire_l1', type: 'wire' },
        { from: 'bus1_wire_l2_8', to: 'acb_l_wire_l2', type: 'wire' },
        { from: 'bus1_wire_l3_8', to: 'acb_l_wire_l3', type: 'wire' },
        { from: 'acb_l_wire_t1', to: 'lamp1_wire_l', type: 'wire' },
        { from: 'acb_l_wire_t2', to: 'lamp2_wire_l', type: 'wire' },
        { from: 'acb_l_wire_t3', to: 'lamp3_wire_l', type: 'wire' },
        { from: 'lamp1_wire_r', to: 'gnd_l_wire_gnd', type: 'wire' },
        { from: 'lamp2_wire_r', to: 'gnd_l_wire_gnd', type: 'wire' },
        { from: 'lamp3_wire_r', to: 'gnd_l_wire_gnd', type: 'wire' },

        // ── 三相可调负载：汇流排第 6 列三相直连，N 端接地 gnd1 ──
        { from: 'bus1_wire_l1_6', to: 'load3_wire_l1', type: 'wire' },
        { from: 'bus1_wire_l2_6', to: 'load3_wire_l2', type: 'wire' },
        { from: 'bus1_wire_l3_6', to: 'load3_wire_l3', type: 'wire' },
        { from: 'load3_wire_n', to: 'gnd1_wire_gnd', type: 'wire' },

        // ── 自动控制模块：母线采集（第 4 列）+ 24V 电源 + 两块遥控面板通信 ──
        { from: 'bus1_wire_l1_4', to: 'auto_ctl_wire_bus_a', type: 'wire' },
        { from: 'bus1_wire_l2_4', to: 'auto_ctl_wire_bus_b', type: 'wire' },
        { from: 'dc_uv_wire_p', to: 'auto_ctl_wire_p24_p', type: 'wire' },
        { from: 'gnd1_wire_gnd', to: 'auto_ctl_wire_p24_n', type: 'wire' },
        { from: 'auto_ctl_wire_comm1_a', to: 'genpanel_wire_com_a', type: 'wire' },
        { from: 'auto_ctl_wire_comm1_b', to: 'genpanel_wire_com_b', type: 'wire' },
        { from: 'auto_ctl_wire_comm2_a', to: 'genpanel2_wire_com_a', type: 'wire' },
        { from: 'auto_ctl_wire_comm2_b', to: 'genpanel2_wire_com_b', type: 'wire' },

        // ── 1# 机组控制电源：dc_uv → 失压线圈 / 储能电机 正端；负端接地 ──
        { from: 'dc_uv_wire_p', to: 'qf1_wire_uv1', type: 'wire' },
        { from: 'dc_uv_wire_p', to: 'qf1_wire_m1', type: 'wire' },
        { from: 'qf1_wire_uv2', to: 'gnd1_qf_wire_gnd', type: 'wire' },
        { from: 'qf1_wire_m2', to: 'gnd1_qf_wire_gnd', type: 'wire' },

        // ── 1# 遥控面板：起动/停止/调速 → gen1；合闸/分闸 → qf1 线圈 ──
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
        // 面板 24V 电源 ← dc_uv（正端）；负端接地（gnd1_uv）
        { from: 'dc_uv_wire_p', to: 'genpanel_wire_p24_p', type: 'wire' },
        { from: 'dc_uv_wire_n', to: 'gnd1_uv_wire_gnd', type: 'wire' },
        { from: 'genpanel_wire_p24_n', to: 'gnd1_uv_wire_gnd', type: 'wire' },

        // ── 2# 机组控制电源：dc_uv2 → 失压线圈 / 储能电机 正端；负端接地 ──
        { from: 'dc_uv2_wire_p', to: 'qf2_wire_uv1', type: 'wire' },
        { from: 'dc_uv2_wire_p', to: 'qf2_wire_m1', type: 'wire' },
        { from: 'qf2_wire_uv2', to: 'gnd2_qf_wire_gnd', type: 'wire' },
        { from: 'qf2_wire_m2', to: 'gnd2_qf_wire_gnd', type: 'wire' },

        // ── 2# 遥控面板：起动/停止/调速 → gen2；合闸/分闸 → qf2 线圈 ──
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
        // 面板 24V 电源 ← dc_uv2（正端）；负端接地（gnd2_uv）
        { from: 'dc_uv2_wire_p', to: 'genpanel2_wire_p24_p', type: 'wire' },
        { from: 'dc_uv2_wire_n', to: 'gnd2_uv_wire_gnd', type: 'wire' },
        { from: 'genpanel2_wire_p24_n', to: 'gnd2_uv_wire_gnd', type: 'wire' },
    ];
    cons.forEach(c => sys.connMgr.addConn(c));
    sys.redrawAll();
}

// ═══════════════════════════════════════════════════════════════
// 七、工程导出
// ═══════════════════════════════════════════════════════════════

export function initSlider(_sys) {
}

/** 默认不接线：初始化（opts.init=true）时不预接线 */
export function applyAllPresets(opts) {
    if (opts && opts.init) return;
    const sys = this && this.sys ? this.sys : window.sys;
    if (!sys) return;
    _autoWire(sys);
}

/** 起动系统：接线 → 复位 → 遥控起动 1# 机并合闸供电 */
export async function applyStartSystem() {
    const sys = this && this.sys ? this.sys : window.sys;
    if (!sys) return;
    try {
        _autoWire(sys);
        await _sleep(400);
        const ctx = { sys };
        await _resetRig(ctx);
        await _startGen(ctx, 'genpanel', 'gen1');
        await _closeViaPanel(ctx, 'genpanel', 'qf1');
    } catch (e) {
        console.warn('[起动系统] 执行异常：', e);
    }
}

export function fiveStep() {
}
