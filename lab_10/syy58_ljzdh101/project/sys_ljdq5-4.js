// 船舶岸电接入仿真工程（船电 ⇄ 岸电双电源 + 电气联锁）
//
// 教学主线：① 认识岸电接入系统的组成；② 由船电供电切换为岸电供电；③ 由岸电供电切换回船电。
//
// 电路组成（单页工程，全部元件同屏）：
//   船电      gen1（1# 同步发电机 80 kW）→ qf1 船用框架式空气断路器 → bus1 主汇流排第 2 口
//   岸电      shore_in（三相四线 220 V）→ 岸电箱 shorebox1 in1/in2/in3（N 接船体接线柱）
//             岸电箱内：相序检测 + 相序转换开关（相序1 / OFF / 相序2）+ 出口空气开关
//   岸电主回路 shorebox1 t1/t2/t3 → pdb1 岸电主开关（塑壳断路器）上端 → bus1 第 6 口
//   相序监视  neg1 负序继电器：进线接岸电箱输出 t1/t2/t3，常闭触点串入岸电主开关失压线圈回路
//   负载      bus1 第 10 口 → bl1/bl2/bl3 三盏星形连接白炽灯（冷态 48.4 Ω）
//   控制电源  dc_uv（DC 24 V）：船电主开关的失压/储能线圈、遥控面板电源
//
// 电气联锁（本工程的核心考点）：
//   每台主开关的失压脱扣线圈由「对方」主开关的常闭辅助触头供电，再加一道负序继电器常闭触点：
//     dc_uv+ → pdb1 常闭触头(nc2→nc1) → qf1 失压线圈(uv1→uv2) → 接地
//     dc_uv+ → neg1 常闭触点(nc2→nc1) → qf1 常闭触头(nc1→nc2) → pdb1 失压线圈 → 接地
//   · 任一台主开关合闸到位 → 其常闭触头断开 → 对方失压线圈失电 → 对方失压脱扣，不能合闸；
//   · 岸电相序为负序（或缺相）时 neg1 常闭触点断开 → 岸电主开关同样无法合闸。
//   因此岸电与船电「只能有一台合闸」，且必须在岸电相序正确后才能接入。
//
// 约定（与全局 AGENTS.md「最新范式」一致）：
//   · 单页工程：不导出 PROJECT_PAGES，consys.js 不创建 PageManager，工作流无 page op
//   · 默认不接线：applyAllPresets({init:true}) 不接线；只有「自动接线 / 起动系统 / 工作流 op」才接线
//   · 按钮/旋钮/开关一律模拟真实交互（getClickablePartNode(...).fire('click'/'mousedown'/'mouseup')）
//   · 接线 ≤ 8 根时用动画接线 addConnectionAnimated，逐根 await
//   · 等待一律用条件轮询 _waitFor，不写死 sleep 猜时间

import { SyncGenerator3P } from '../components/SyncGenerator3P.js';
import { Busbar3P } from '../components/Busbar3P.js';
import { MarineMainsSwitch } from '../components/MarineMainsSwitch.js';
import { GeneratorRemotePanel } from '../components/GeneratorRemotePanel.js';
import { DCPower } from '../components/DCPower.js';
import { Ground } from '../components/Gnd.js';
import { ShorePowerMainSwitch } from '../components/ShorePowerMainSwitch.js';
import { ShorePowerBox } from '../components/ShorePowerBox.js';
import { ACPower3P } from '../components/ACPower3P.js';
import { NegativeSeqRelay } from '../components/NegativeSeqRelay.js';
import { IncandescentLamp } from '../components/IncandescentLamp.js';
import { Multimeter } from '../components/Multimeter.js';
import { MF47Multimeter } from '../components/MF47Multimeter.js';
import { Oscilloscope_tri } from '../components/Osc_tri.js';
import { SignalGenerator } from '../components/SignalGenerator.js';
import { ProcessCalibrator } from '../components/ProcessCalibrator.js';
import { ElecMeter } from '../components/ElecMeter.js';
import { RealMegohmMeter } from '../components/RealMegohmMeter.js';

const _fcomp = (id) => (window.sys && window.sys.comps) ? window.sys.comps[id] : null;

// ═══════════════════════════════════════════════════════════════
// 一、故障
// 本工程教学重点是"双电源切换 + 电气联锁"，不设故障设置项（FAULT_CONFIGS 为空）。
// 需要故障练习时，可直接把岸电电源相序改为负序（右键岸电电源 → 参数设置 → 相序 neg），
// 观察岸电箱负序灯亮、负序继电器常闭触点断开、岸电主开关失压无法合闸。
// ═══════════════════════════════════════════════════════════════

export const FAULT_CONFIGS = {

};

// ═══════════════════════════════════════════════════════════════
// 二、通用辅助（一律模拟真实操作 + 条件轮询）
// ═══════════════════════════════════════════════════════════════

const _sysOf = (ctx) => (ctx && ctx.sys) ? ctx.sys : window.sys;
const _sleep = (ms) => new Promise(r => setTimeout(r, ms));
const _comp = (sys, id) => (sys && sys.comps) ? sys.comps[id] : null;

const _sb = (ctx) => _comp(_sysOf(ctx), 'shorebox1');     // 岸电箱
const _pdb = (ctx) => _comp(_sysOf(ctx), 'pdb1');         // 岸电主开关
const _gen = (ctx) => _comp(_sysOf(ctx), 'gen1');         // 1# 发电机组
const _panel = (ctx) => _comp(_sysOf(ctx), 'genpanel');   // 1# 机组遥控面板

/** 条件轮询等待（不写死 sleep 猜时间） */
async function _waitFor(sys, cond, timeout = 8000, interval = 100) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
        try { if (cond(sys)) return true; } catch (e) { /* ignore */ }
        await _sleep(interval);
    }
    return false;
}

/** 模拟点击组件部件（触发组件自身的点击处理逻辑，不直接改内部字段） */
function _firePart(comp, partId, evt = 'click') {
    if (!comp || typeof comp.getClickablePartNode !== 'function') return false;
    const node = comp.getClickablePartNode(partId);
    if (!node) return false;
    try { node.fire(evt, { evt: { cancelBubble: false } }); } catch (e) { return false; }
    return true;
}

/** 模拟按住部件（按钮类：按下 → 保持 → 松开） */
async function _holdPart(comp, partId, holdMs = 800, down = 'mousedown', up = 'mouseup') {
    if (!_firePart(comp, partId, down)) return false;
    await _sleep(holdMs);
    _firePart(comp, partId, up);
    await _sleep(150);
    return true;
}

/** 点击一次部件（开关/旋钮/手柄类） */
async function _clickPart(comp, partId, waitMs = 350) {
    if (!_firePart(comp, partId, 'click')) return false;
    await _sleep(waitMs);
    return true;
}

/** 工具栏按钮（自动接线 / 起动系统） */
async function _toolbarBtn(id) {
    const btn = document.getElementById(id);
    if (btn && typeof btn.onclick === 'function') btn.onclick();
    await _sleep(1000);
}

/** 接线是否已建立 */
function _wired(sys, a, b) {
    return !!(sys && Array.isArray(sys.conns) && sys.conns.some(c =>
        c && c.type === 'wire' && ((c.from === a && c.to === b) || (c.from === b && c.to === a))));
}

/** 主开关状态 */
const _qfState = (ctx, id) => {
    const c = _comp(_sysOf(ctx), id);
    return c && typeof c.getState === 'function' ? c.getState() : null;
};

// ─── 船电侧操作（遥控面板按钮 / 发电机控制方式）────────────────

/** 遥控起动 1# 机组 */
async function _startGen1(ctx) {
    const sys = _sysOf(ctx);
    const g = _gen(ctx);
    if (!g) return false;
    if (g.isOn) return true;
    await _holdPart(_panel(ctx), 'btn-start', 1000);
    return _waitFor(sys, s => !!_comp(s, 'gen1').isOn, 12000);
}

/** 遥控合闸 1# 主开关：等储能到位 → 按「合闸」→ 等主触头闭合 */
async function _closeQf1(ctx) {
    const sys = _sysOf(ctx);
    if (_qfState(ctx, 'qf1') === 'on') return true;
    await _waitFor(sys, s => { const q = _comp(s, 'qf1'); return !!q && q._charged; }, 15000);
    await _holdPart(_panel(ctx), 'btn-close', 900);
    return _waitFor(sys, s => { const q = _comp(s, 'qf1'); return !!q && q.getState() === 'on'; }, 8000);
}

/** 遥控分闸 1# 主开关 */
async function _openQf1(ctx) {
    const sys = _sysOf(ctx);
    if (_qfState(ctx, 'qf1') !== 'on') return true;
    await _holdPart(_panel(ctx), 'btn-open', 900);
    return _waitFor(sys, s => { const q = _comp(s, 'qf1'); return !!q && q.getState() !== 'on'; }, 8000);
}

/** 「起动系统」：工具栏按钮 → 接线 + 复位 + 起动 1# 机组 + 合闸供电 */
async function _startSystem(ctx) {
    await _toolbarBtn('btnStartSys');
    const sys = _sysOf(ctx);
    const ready = await _waitFor(sys, s => {
        const g = _comp(s, 'gen1'), q = _comp(s, 'qf1');
        return !!g && g.isOn && !!q && q.getState() === 'on';
    }, 25000);
    if (!ready) {                       // 兜底：按钮流程未完成时补齐
        await _startGen1(ctx);
        await _closeQf1(ctx);
    }
    await _sleep(500);
}

// ─── 岸电侧操作（岸电电源 / 岸电箱 / 岸电主开关）──────────────

/** 合上岸电电源（点击电源面板上的电源键） */
async function _shorePowerOn(ctx) {
    const sys = _sysOf(ctx);
    const sp = _comp(sys, 'shore_in');
    if (!sp) return false;
    for (let i = 0; i < 3 && !sp.isOn; i++) {
        if (!_firePart(sp, 'power')) {
            console.warn('[岸电电源] 未取到电源键节点，改用参数兜底');
            sp.isOn = true;
            break;
        }
        await _sleep(350);
    }
    return _waitFor(sys, s => !!_comp(s, 'shore_in').isOn, 4000);
}

/** 断开岸电电源（点击电源键关断） */
async function _shorePowerOff(ctx) {
    const sp = _comp(_sysOf(ctx), 'shore_in');
    if (!sp || !sp.isOn) return true;
    await _clickPart(sp, 'power', 400);
    return !sp.isOn;
}

/** 岸电箱相序转换开关打到指定档（1=相序1 / 0=OFF / 2=相序2） */
async function _ensureKnob(ctx, want) {
    const sb = _sb(ctx);
    if (!sb) return false;
    const partId = want === 1 ? 'knob-pos1' : (want === 2 ? 'knob-pos2' : 'knob-off');
    for (let i = 0; i < 3 && sb.getKnob() !== want; i++) {
        if (!_firePart(sb, partId)) {
            console.warn('[岸电箱] 未取到相序开关节点');
            break;
        }
        await _sleep(320);
    }
    await _sleep(200);
    return sb.getKnob() === want;
}

/** 合上岸电箱出口空气开关 */
async function _closeBoxBreaker(ctx) {
    const sys = _sysOf(ctx);
    const sb = _sb(ctx);
    if (!sb) return false;
    if (sb.getBreakerOn()) return true;
    // 等进线有电，避免合上即被失压保护跳开
    await _waitFor(sys, s => { const b = _comp(s, 'shorebox1'); return !!b && b._inPowered(); }, 8000);
    for (let i = 0; i < 3 && !sb.getBreakerOn(); i++) {
        if (!_firePart(sb, 'btn-close')) {
            console.warn('[岸电箱] 未取到合闸按钮节点');
            break;
        }
        await _sleep(400);
    }
    return _waitFor(sys, s => { const b = _comp(s, 'shorebox1'); return !!b && b.getBreakerOn(); }, 4000);
}

/** 断开岸电箱出口空气开关 */
async function _openBoxBreaker(ctx) {
    const sb = _sb(ctx);
    if (!sb || !sb.getBreakerOn()) return true;
    await _clickPart(sb, 'btn-open', 400);
    return !sb.getBreakerOn();
}

/** 岸电主开关合闸（点击手柄；跳闸位先复位再合闸） */
async function _closePdb(ctx) {
    const sys = _sysOf(ctx);
    const pdb = _pdb(ctx);
    if (!pdb) return false;
    for (let i = 0; i < 5 && !pdb.isClosed(); i++) {
        _firePart(pdb, 'sw1');
        await _sleep(700);
    }
    await _waitFor(sys, s => { const p = _comp(s, 'pdb1'); return !!p && p.isClosed(); }, 4000);
    return pdb.isClosed();
}

/** 岸电主开关分闸（点击手柄） */
async function _openPdb(ctx) {
    const pdb = _pdb(ctx);
    if (!pdb) return false;
    for (let i = 0; i < 5 && pdb.isClosed(); i++) {
        _firePart(pdb, 'sw1');
        await _sleep(700);
    }
    return !pdb.isClosed();
}

// ═══════════════════════════════════════════════════════════════
// 三、常用步骤片段（每个子操作自带 act，"指示 → 执行"）
// ═══════════════════════════════════════════════════════════════

/** 一根导线的交接 op（箭头指向两端端口，动作为动画接线） */
function _opWire(from, to, msg) {
    return {
        type: 'observe', ports: [from, to], msg,
        async act() {
            const sys = _sysOf(this);
            if (!sys || _wired(sys, from, to)) return;
            await sys.connMgr.addConnectionAnimated({ from, to, type: 'wire' });
            await _sleep(200);
        },
    };
}

/** 「起动系统 + 船电合闸供电」子操作 */
function _opsShipSupply() {
    return [
        {
            type: 'wire', button: 'btnStartSys',
            msg: '点击「起动系统」：自动接线、起动 1# 机组',
            async act() { await _startSystem(this); },
        },
        {
            type: 'observe', target: 'genpanel', part: 'lcd',
            msg: '观察机组建压、主开关合闸向汇流排供电',
            async act() {
                await _waitFor(_sysOf(this), s => {
                    const g = _comp(s, 'gen1'), q = _comp(s, 'qf1');
                    return !!g && g.isOn && !!q && q.getState() === 'on';
                }, 18000);
            },
        },
    ];
}

/** 「接通岸电 + 合上电源」子操作 */
function _opsShoreInput() {
    return [
        _opWire('shore_in_wire_u', 'shorebox1_wire_in1', 'U 相接岸电箱 in1'),
        _opWire('shore_in_wire_v', 'shorebox1_wire_in2', 'V 相接岸电箱 in2'),
        _opWire('shore_in_wire_w', 'shorebox1_wire_in3', 'W 相接岸电箱 in3'),
        _opWire('shore_in_wire_n', 'shorebox1_wire_n', '岸电中线 N 接船体接线柱'),
        {
            type: 'btn', target: 'shore_in', part: 'power',
            msg: '合上岸电电源',
            async act() { await _shorePowerOn(this); },
        },
        {
            type: 'observe', target: 'shorebox1', part: 'phase-lamps',
            msg: '岸电箱进线带电，相序指示灯点亮',
            async act() {
                await _waitFor(_sysOf(this), s => {
                    const b = _comp(s, 'shorebox1');
                    return !!b && b._inPowered();
                }, 10000);
            },
        },
    ];
}

// ═══════════════════════════════════════════════════════════════
// 四、工作流
// ═══════════════════════════════════════════════════════════════

export const PROJECT_WORKFLOWS = {
    // ───────────────────────────────────────────────────────────
    // 0. 船舶岸电接入系统认识
    // ───────────────────────────────────────────────────────────
    'shore-power-intro': {
        id: 'shore-power-intro',
        name: '0. 船舶岸电接入系统认识',
        steps: [
            {
                msg: '第 1 步：识别岸电箱（相序检测 + 相序转换 + 空气开关）。',
                mode: 'find', target: 'shorebox1',
            },
            {
                msg: '第 2 步：在岸电箱上找到「相序指示灯」（正序 / 负序）。',
                mode: 'find', target: 'shorebox1', subTarget: 'phase-lamps',
            },
            {
                msg: '第 3 步：在岸电箱上找到「空气开关」（刀片式断路器）。',
                mode: 'find', target: 'shorebox1', subTarget: 'breaker',
            },
            {
                msg: '第 4 步：识别负序继电器。',
                mode: 'find', target: 'neg1',
            },
            {
                msg: '第 5 步：识别岸电主开关。',
                mode: 'find', target: 'pdb1',
            },
            {
                msg: '第 6 步：识别岸电输入电源（三相四线）。',
                mode: 'find', target: 'shore_in',
            },
            {
                msg: '第 7 步：识别汇流排与三相负载灯。',
                mode: 'find', target: ['bus1', 'bl1', 'bl2', 'bl3'], demoTarget: 'bus1',
            },
            {
                msg: '第 8 步：测试题：岸电与船电如何互锁。',
                mode: 'quiz',
                quizConfig: {
                    question: '船舶靠港接用岸电时，靠什么保证岸电与船电不会同时向电网供电？',
                    options: [
                        '电气联锁：每台主开关的失压脱扣线圈由对方主开关的常闭辅助触头供电，一台合闸到位即切断对方的线圈电源，使对方无法合闸',
                        '完全依靠值班人员手动操作，不需要任何联锁保护',
                        '为提高供电可靠性，岸电与船电可以同时合闸供电',
                        '岸电与船电是否同时供电没有影响，可以随意操作',
                    ],
                    answer: 0,
                    analysis: '岸电与船电互为备用电源，二者只能有一个投入。岸电主开关合闸到位后其常闭辅助触头断开，切断船电主开关失压脱扣线圈的电源，使船电主开关合不上；船电主开关合闸时同理联锁岸电主开关。',
                },
            },
            {
                msg: '第 9 步：测试题：负序继电器的作用。',
                mode: 'quiz',
                quizConfig: {
                    question: '在船舶岸电接入系统中，负序继电器的主要作用是什么？',
                    options: [
                        '检测岸电相序：相序为负序（或缺相）时常闭触点断开，切断岸电主开关失压线圈电源，禁止合闸',
                        '检测岸电电压高低，电压过低时发出报警',
                        '检测岸电频率，频率偏离 50 Hz 时使主开关跳闸',
                        '测量岸电电流大小并显示在面板上',
                    ],
                    answer: 0,
                    analysis: '负序继电器监视岸电相序。正序时常闭触点闭合，允许岸电主开关合闸；负序或缺相时触点断开，岸电主开关失压脱扣无法合闸，避免相序接反造成电动机反转、设备损坏。',
                },
            },
        ],
    },

    // ───────────────────────────────────────────────────────────
    // 1. 船电转换为岸电供电
    // ───────────────────────────────────────────────────────────
    'shore-power-switch': {
        id: 'shore-power-switch',
        name: '1. 船电转换为岸电供电',
        steps: [
            {
                msg: '第 1 步：起动系统，由船电向汇流排供电。',
                mode: 'check',
                op: _opsShipSupply(),
                check() {
                    const sys = _sysOf(this);
                    const g = _gen(this);
                    return _wired(sys, 'gen1_wire_u', 'qf1_wire_t1')
                        && _qfState(this, 'qf1') === 'on'
                        && !!g && g.isOn;
                },
            },
            {
                msg: '第 2 步：接岸电输入线（U/V/W/N），合上岸电电源。',
                mode: 'check',
                op: _opsShoreInput(),
                check() {
                    const sys = _sysOf(this);
                    const sp = _comp(sys, 'shore_in');
                    return _wired(sys, 'shore_in_wire_u', 'shorebox1_wire_in1')
                        && _wired(sys, 'shore_in_wire_v', 'shorebox1_wire_in2')
                        && _wired(sys, 'shore_in_wire_w', 'shorebox1_wire_in3')
                        && _wired(sys, 'shore_in_wire_n', 'shorebox1_wire_n')
                        && !!sp && sp.isOn;
                },
            },
            {
                msg: '第 3 步：相序开关打「相序1」，确认正序后合上空气开关。',
                mode: 'check',
                op: [
                    {
                        type: 'knob', target: 'shorebox1', part: 'knob-pos1',
                        msg: '相序转换开关打到「相序1」',
                        async act() { await _ensureKnob(this, 1); },
                    },
                    {
                        type: 'observe', target: 'shorebox1', part: 'phase-lamps',
                        msg: '正序灯亮，确认输出为正相序',
                        async act() {
                            await _waitFor(_sysOf(this), s => {
                                const b = _comp(s, 'shorebox1');
                                return !!b && b._inPowered() && b._phase === 'pos';
                            }, 10000);
                        },
                    },
                    {
                        type: 'switch', target: 'shorebox1', part: 'btn-close',
                        msg: '合上空气开关，岸电箱输出带电',
                        async act() { await _closeBoxBreaker(this); },
                    },
                ],
                check() {
                    const sb = _sb(this);
                    return !!sb && sb.getKnob() === 1 && sb.getBreakerOn() && sb._phase === 'pos';
                },
            },
            {
                msg: '第 4 步：测试题：接岸电前主发电机应如何设置。',
                mode: 'quiz',
                quizConfig: {
                    question: '在把负载从船电切换到岸电之前，1# 发电机组与船电主开关应处于什么状态？',
                    options: [
                        '先把船电主开关分闸（机组可继续空载运行），确认岸电相序正确后再合岸电主开关，避免非同期并列',
                        '保持船电主开关合闸，直接合岸电主开关并列运行',
                        '不需要任何操作，联锁会自动处理',
                        '先把岸电主开关合上，再分船电主开关也可以',
                    ],
                    answer: 0,
                    analysis: '岸电与船电相位、频率互不相关，同时合闸会造成非同期并列（产生巨大冲击电流）。正确顺序是"先断后合"：分船电主开关 → 确认岸电正序 → 合岸电主开关。',
                },
            },
            {
                msg: '第 5 步：断船电主开关，合岸电主开关，改由岸电供电。',
                mode: 'check',
                op: [
                    {
                        type: 'btn', target: 'genpanel', part: 'btn-open',
                        msg: '按「分闸」断开船电主开关',
                        async act() { await _openQf1(this); },
                    },
                    {
                        type: 'switch', target: 'pdb1', part: 'sw1',
                        msg: '合上岸电主开关，由岸电供电',
                        async act() { await _closePdb(this); },
                    },
                    {
                        type: 'observe', target: 'bl1',
                        msg: '汇流排三相带电，负载灯保持点亮',
                        async act() {
                            await _waitFor(_sysOf(this), s => {
                                const l = _comp(s, 'bl1');
                                return !!l && l._rmsVoltage > 50;
                            }, 12000);
                        },
                    },
                ],
                check() {
                    const sys = _sysOf(this);
                    const pdb = _pdb(this), l = _comp(sys, 'bl1');
                    return _qfState(this, 'qf1') !== 'on'
                        && !!pdb && pdb.isClosed()
                        && !!l && l._rmsVoltage > 50;
                },
            },
            {
                msg: '第 6 步：测试题：岸电中线为何接船体接线柱。',
                mode: 'quiz',
                quizConfig: {
                    question: '岸电电源的中线（N）为什么要接到船体接线柱？',
                    options: [
                        '船舶电网以船体（海水）为接地参考点，中线接船体可使岸电中性点与船电中性点等电位，构成完整回路并为绝缘故障提供通路',
                        '只是为了方便固定导线，没有电气意义',
                        '为了防止岸电频率漂移',
                        '为了让岸电电压升高',
                    ],
                    answer: 0,
                    analysis: '船舶是独立浮动的三相三线（或四线）系统，中性点经船体接地。把岸电中线接到船体接线柱，使岸电中性点与船体同电位，既保证单相负载回路完整，又在绝缘/接地故障时提供故障电流通路。',
                },
            },
        ],
    },

    // ───────────────────────────────────────────────────────────
    // 2. 岸电切换为船电供电
    // ───────────────────────────────────────────────────────────
    'shore-to-ship-switch': {
        id: 'shore-to-ship-switch',
        name: '2. 岸电切换为船电供电',
        steps: [
            {
                msg: '第 1 步：自动接线，接通岸电（四线 + 合上电源）。',
                mode: 'check',
                op: [
                    {
                        type: 'wire', button: 'btnAutoWire',
                        msg: '点击「自动接线」接好主回路与控制回路',
                        async act() { await _toolbarBtn('btnAutoWire'); },
                    },
                    _opWire('shore_in_wire_u', 'shorebox1_wire_in1', 'U 相接岸电箱 in1'),
                    _opWire('shore_in_wire_v', 'shorebox1_wire_in2', 'V 相接岸电箱 in2'),
                    _opWire('shore_in_wire_w', 'shorebox1_wire_in3', 'W 相接岸电箱 in3'),
                    _opWire('shore_in_wire_n', 'shorebox1_wire_n', '岸电中线 N 接船体接线柱'),
                    {
                        type: 'btn', target: 'shore_in', part: 'power',
                        msg: '合上岸电电源',
                        async act() { await _shorePowerOn(this); },
                    },
                ],
                check() {
                    const sys = _sysOf(this);
                    const sp = _comp(sys, 'shore_in');
                    return _wired(sys, 'shore_in_wire_u', 'shorebox1_wire_in1')
                        && _wired(sys, 'shore_in_wire_v', 'shorebox1_wire_in2')
                        && _wired(sys, 'shore_in_wire_w', 'shorebox1_wire_in3')
                        && _wired(sys, 'shore_in_wire_n', 'shorebox1_wire_n')
                        && _wired(sys, 'pdb1_wire_in1', 'bus1_wire_l1_6')
                        && !!sp && sp.isOn;
                },
            },
            {
                msg: '第 2 步：相序开关打「相序1」，合空开，合岸电主开关。',
                mode: 'check',
                op: [
                    {
                        type: 'knob', target: 'shorebox1', part: 'knob-pos1',
                        msg: '相序转换开关打到「相序1」',
                        async act() { await _ensureKnob(this, 1); },
                    },
                    {
                        type: 'switch', target: 'shorebox1', part: 'btn-close',
                        msg: '合上空气开关',
                        async act() { await _closeBoxBreaker(this); },
                    },
                    {
                        type: 'switch', target: 'pdb1', part: 'sw1',
                        msg: '合上岸电主开关，岸电向汇流排供电',
                        async act() { await _closePdb(this); },
                    },
                    {
                        type: 'observe', target: 'bl1',
                        msg: '负载灯由岸电点亮',
                        async act() {
                            await _waitFor(_sysOf(this), s => {
                                const l = _comp(s, 'bl1');
                                return !!l && l._rmsVoltage > 50;
                            }, 12000);
                        },
                    },
                ],
                check() {
                    const sb = _sb(this), pdb = _pdb(this);
                    return !!sb && sb.getKnob() === 1 && sb.getBreakerOn()
                        && !!pdb && pdb.isClosed();
                },
            },
            {
                msg: '第 3 步：起动主发电机，试合船电主开关（互锁拒动）。',
                mode: 'check',
                op: [
                    {
                        type: 'btn', target: 'genpanel', part: 'btn-start',
                        msg: '按「起动」起动 1# 发电机组',
                        async act() { await _startGen1(this); },
                    },
                    {
                        type: 'observe', target: 'genpanel', part: 'lcd',
                        msg: '机组已建压，观察主开关能否合闸',
                        async act() {
                            await _waitFor(_sysOf(this), s => {
                                const g = _comp(s, 'gen1');
                                return !!g && g.isOn && g._freqOut > 49;
                            }, 12000);
                        },
                    },
                    {
                        type: 'btn', target: 'genpanel', part: 'btn-close',
                        msg: '按「合闸」试合船电主开关',
                        async act() {
                            await _waitFor(_sysOf(this), s => {
                                const q = _comp(s, 'qf1');
                                return !!q && q._charged;
                            }, 15000);
                            await _holdPart(_panel(this), 'btn-close', 900);
                            await _sleep(1500);
                        },
                    },
                ],
                check() {
                    const g = _gen(this), pdb = _pdb(this);
                    return !!g && g.isOn
                        && _qfState(this, 'qf1') !== 'on'
                        && !!pdb && pdb.isClosed();
                },
            },
            {
                msg: '第 4 步：测试题：岸电供电时船电主开关合不上的原因。',
                mode: 'quiz',
                quizConfig: {
                    question: '岸电供电期间，试图合上船电主开关却合不上（合上即跳），主要原因是什么？',
                    options: [
                        '岸电主开关合闸到位后其常闭辅助触头断开，切断了船电主开关失压脱扣线圈的电源，船电主开关因失压脱扣而无法保持合闸',
                        '船舶主发电机没有起动，所以当然合不上',
                        '岸电电压太低，导致船电主开关拒动',
                        '汇流排上没有电，所以合不上',
                    ],
                    answer: 0,
                    analysis: '这是设计好的电气联锁：岸电在供电时绝不允许船电再并上。岸电主开关合闸后其常闭触头断开 → 船电主开关失压线圈失电 → 合闸后立即失压脱扣，保证两个电源不会同时投入。',
                },
            },
            {
                msg: '第 5 步：分闸岸电主开关，合船电主开关，恢复船电。',
                mode: 'check',
                op: [
                    {
                        type: 'switch', target: 'pdb1', part: 'sw1',
                        msg: '分闸岸电主开关，切断岸电',
                        async act() { await _openPdb(this); },
                    },
                    {
                        type: 'btn', target: 'genpanel', part: 'btn-close',
                        msg: '按「合闸」合上船电主开关',
                        async act() { await _closeQf1(this); },
                    },
                    {
                        type: 'observe', target: 'bl1',
                        msg: '负载灯保持点亮，供电已恢复为船电',
                        async act() {
                            await _waitFor(_sysOf(this), s => {
                                const q = _comp(s, 'qf1'), l = _comp(s, 'bl1');
                                return !!q && q.getState() === 'on' && !!l && l._rmsVoltage > 50;
                            }, 12000);
                        },
                    },
                ],
                check() {
                    const pdb = _pdb(this);
                    return !!pdb && !pdb.isClosed() && _qfState(this, 'qf1') === 'on';
                },
            },
        ],
    },
};

// ═══════════════════════════════════════════════════════════════
// 五、元件布局
// ═══════════════════════════════════════════════════════════════

export const componentConfigs = [
    // ── 船电主回路：同步发电机 → 船电主开关 → 汇流排 —─
    { Class: SyncGenerator3P, id: 'gen1', x: -120, y: 700, vRms: 230, freq: 50, isOn: false, mode: 'remote', label: '1#同步发电机', ratedPower: 80, ratedVoltage: 400, ratedCosPhi: 0.8, maxDropV: 200, avrMaxComp: 1, avrDelay: 2, avrTime: 5, autoDecoupleTrim: true, visible: true },
    { Class: MarineMainsSwitch, id: 'qf1', x: -120, y: 180, ratedCtrlVoltage: 24, label: '船电主开关', genId: 'gen1', revPowerKw: 8, revTime: 5, faultSimpleProtect: true, visible: true },
    { Class: GeneratorRemotePanel, id: 'genpanel', x: 360, y: 700, genId: 'gen1', qfId: 'qf1', label: '1#发电机组遥控面板', busId: 'bus1', visible: true },

    { Class: Busbar3P, id: 'bus1', x: 0, y: 30, portsPerBar: 10, label: '汇流排', visible: true },

    // ── 1号机组控制电源共地（遥控面板与控制电源的中间下方）──
    // dc_uv 负极、genpanel p24_n 共同接此接地，不再向线圈引出负极线
    { Class: Ground, id: 'gnd1_uv', x: 590, y: 1000, label: '控制电源接地', visible: true },
    // ── 船电主开关线圈接地（主开关右下角）──
    // 储能电机 m2 / 失压 uv2 / 合闸 c2 / 分励 flb 负端均接此接地
    { Class: Ground, id: 'gnd1_qf', x: 630, y: 530, label: '线圈接地', visible: true },
    // ── 岸电主开关失压线圈接地 ──
    { Class: Ground, id: 'gnd1_pdb', x: 970, y: 430, label: '岸电失压接地', visible: true },
    // ── 遥控面板信号接地（面板上方）──
    // 合闸输出 close_b、分闸输出 open_b 负端接地
    { Class: Ground, id: 'gnd1_panel', x: 530, y: 670, label: '信号接地', visible: true },

    // ── 控制电源（DC 24V）：失压脱扣线圈 ──
    { Class: DCPower, id: 'dc_uv', x: 660, y: 750, voltage: 24, isOn: true, label: '失压脱扣电源', visible: true },

    // ── 岸电主开关（塑壳断路器）──
    { Class: ShorePowerMainSwitch, id: 'pdb1', x: 730, y: 220, label: '岸电主开关', ratedCurrent: 100, shortDelay: 0.2, overloadK: 4, tripCoilR: 200, initState: 'off', visible: true },
    // ── 岸电箱（相序检测 + 相序转换开关 + 出口断路器）──
    { Class: ShorePowerBox, id: 'shorebox1', x: 1150, y: 320, label: '岸电箱', lineSeq: 'pos', knob: 0, breakerOn: false, visible: true },
    // ── 岸电输入：简单三相电源（正相序 UVW）──
    { Class: ACPower3P, id: 'shore_in', x: 1335, y: 5, vRms: 220, freq: 50, isOn: false, phaseSeq: 'pos', label: '岸电输入电源', visible: true },
    // ── 负序继电器：右接岸电箱输出三线，左常闭触点串入 24V 正极与船电主开关常闭触头之间 ──
    { Class: NegativeSeqRelay, id: 'neg1', x: 1010, y: 730, label: '负序继电器', visible: true },
    // ── 汇流排右侧三相负载：三盏星形连接白炽灯（冷态 48.4 Ω）──
    { Class: IncandescentLamp, id: 'bl1', x: 1610, y: 480, coldResistance: 48.4, label: 'L1灯', rotation: 90, visible: true },
    { Class: IncandescentLamp, id: 'bl2', x: 1680, y: 480, coldResistance: 48.4, label: 'L2灯', rotation: 90, visible: true },
    { Class: IncandescentLamp, id: 'bl3', x: 1750, y: 480, coldResistance: 48.4, label: 'L3灯', rotation: 90, visible: true },

    // ── 仪表停靠（默认隐藏，由工具栏「选择仪表」调出）──
    { Class: Multimeter, id: 'multimeter', x: 920, y: 100, visible: false },
    { Class: MF47Multimeter, id: 'mf47-panel', x: 1050, y: 150, visible: false },
    { Class: Oscilloscope_tri, id: 'osc', x: 50, y: 50, visible: false },
    { Class: SignalGenerator, id: 'sg', x: 50, y: 50, visible: false },
    { Class: ProcessCalibrator, id: 'cali', x: 50, y: 50, visible: false },
    { Class: ElecMeter, id: 'elecmeter', x: 50, y: 50, visible: false },
    { Class: RealMegohmMeter, id: 'megohm', x: 50, y: 50, visible: false },
];

// ═══════════════════════════════════════════════════════════════
// 六、自动接线（本电路 40+ 根，> 8 根，允许瞬时接线）
// ═══════════════════════════════════════════════════════════════

function _autoWire(sys) {
    sys.conns.length = 0;
    const cons = [
        // ── 船电主回路：同步发电机 → 主开关 → 汇流排（第2口）──
        { from: 'gen1_wire_u', to: 'qf1_wire_t1', type: 'wire' },
        { from: 'gen1_wire_v', to: 'qf1_wire_t2', type: 'wire' },
        { from: 'gen1_wire_w', to: 'qf1_wire_t3', type: 'wire' },
        { from: 'qf1_wire_l1', to: 'bus1_wire_l1_2', type: 'wire' },
        { from: 'qf1_wire_l2', to: 'bus1_wire_l2_2', type: 'wire' },
        { from: 'qf1_wire_l3', to: 'bus1_wire_l3_2', type: 'wire' },
        // ── 岸电回路：岸电箱输入（U/V/W 三线 + N）需学员手动连接，不在此自动接线 ──
        //    （岸电箱输出 → 负序继电器、岸电主开关 由自动接线完成）
        // 岸电箱输出 T1-T3 → 负序继电器右侧进线 L1-L3
        { from: 'shorebox1_wire_t1', to: 'neg1_wire_l1', type: 'wire' },
        { from: 'shorebox1_wire_t2', to: 'neg1_wire_l2', type: 'wire' },
        { from: 'shorebox1_wire_t3', to: 'neg1_wire_l3', type: 'wire' },
        // 岸电箱输出 T1-T3 → 岸电主开关下端（sw1_t1-t3）
        { from: 'shorebox1_wire_t1', to: 'pdb1_wire_sw1_t1', type: 'wire' },
        { from: 'shorebox1_wire_t2', to: 'pdb1_wire_sw1_t2', type: 'wire' },
        { from: 'shorebox1_wire_t3', to: 'pdb1_wire_sw1_t3', type: 'wire' },
        // 岸电主开关上端（in1-in3）→ 汇流排第6口
        { from: 'pdb1_wire_in1', to: 'bus1_wire_l1_6', type: 'wire' },
        { from: 'pdb1_wire_in2', to: 'bus1_wire_l2_6', type: 'wire' },
        { from: 'pdb1_wire_in3', to: 'bus1_wire_l3_6', type: 'wire' },
        // ── 负载：三盏灯上端(l)接汇流排第10端子，下端(r)星型连接 ──
        { from: 'bus1_wire_l1_10', to: 'bl1_wire_l', type: 'wire' },
        { from: 'bus1_wire_l2_10', to: 'bl2_wire_l', type: 'wire' },
        { from: 'bus1_wire_l3_10', to: 'bl3_wire_l', type: 'wire' },
        { from: 'bl1_wire_r', to: 'bl2_wire_r', type: 'wire' },
        { from: 'bl2_wire_r', to: 'bl3_wire_r', type: 'wire' },

        // ── 控制电源 DC 24V 双向互锁（岸电 / 船电主开关失压线圈）──
        // 互锁逻辑：每台开关的失压线圈由"对方"主开关的常闭辅助触头供电，
        // 任一台完全合闸到位即切断对方线圈电源 → 对方失压脱扣 → 不能同时合闸。
        // 注意：常闭触头仅在"合闸完全到位"才断开（见 isNCClosed），
        // 推闸中途/被锁弹回时保持闭合，不会误切对方线圈。
        // 24V+ → 岸电常闭触头(nc2→nc1) → 船电主开关失压线圈(qf1 uv1)
        { from: 'dc_uv_wire_p', to: 'pdb1_wire_nc2', type: 'wire' },
        { from: 'pdb1_wire_nc1', to: 'qf1_wire_uv1', type: 'wire' },
        // 24V+ → 负序继电器 NC2 → 常闭触点 → NC1 → 船电主开关常闭触头(nc1→nc2) → 岸电失压线圈
        { from: 'dc_uv_wire_p', to: 'neg1_wire_nc2', type: 'wire' },
        { from: 'neg1_wire_nc1', to: 'qf1_wire_nc1', type: 'wire' },
        { from: 'qf1_wire_nc2', to: 'pdb1_wire_sw1_uv1', type: 'wire' },
        // 两台失压线圈另一端均接地
        { from: 'qf1_wire_uv2', to: 'gnd1_qf_wire_gnd', type: 'wire' },
        { from: 'pdb1_wire_sw1_uv2', to: 'gnd1_pdb_wire_gnd', type: 'wire' },
        // 船电主开关储能电机仍由 24V+ 直接供电（不受互锁影响）
        { from: 'dc_uv_wire_p', to: 'qf1_wire_m1', type: 'wire' },
        { from: 'qf1_wire_m2', to: 'gnd1_qf_wire_gnd', type: 'wire' },

        // ── 发电机组遥控面板：面板 → gen1 遥控端口 ──
        { from: 'genpanel_wire_start_a', to: 'gen1_wire_rm_start_a', type: 'wire' },
        { from: 'genpanel_wire_start_b', to: 'gen1_wire_rm_start_b', type: 'wire' },
        { from: 'genpanel_wire_stop_a', to: 'gen1_wire_rm_stop_a', type: 'wire' },
        { from: 'genpanel_wire_stop_b', to: 'gen1_wire_rm_stop_b', type: 'wire' },
        { from: 'genpanel_wire_spd_p', to: 'gen1_wire_freq_in_p', type: 'wire' },
        { from: 'genpanel_wire_spd_n', to: 'gen1_wire_freq_in_n', type: 'wire' },
        // 合闸/分闸正端 → 线圈正端；输出负端接地（gnd1_panel）、线圈负端接地（gnd1_qf）
        { from: 'genpanel_wire_close_a', to: 'qf1_wire_c1', type: 'wire' },
        { from: 'genpanel_wire_open_a', to: 'qf1_wire_fla', type: 'wire' },
        { from: 'genpanel_wire_close_b', to: 'gnd1_panel_wire_gnd', type: 'wire' },
        { from: 'genpanel_wire_open_b', to: 'gnd1_panel_wire_gnd', type: 'wire' },
        { from: 'qf1_wire_c2', to: 'gnd1_qf_wire_gnd', type: 'wire' },
        { from: 'qf1_wire_flb', to: 'gnd1_qf_wire_gnd', type: 'wire' },
        // ── 遥控面板 24V 电源 ← dc_uv（正端）；负端接地（gnd1_uv）──
        { from: 'dc_uv_wire_p', to: 'genpanel_wire_p24_p', type: 'wire' },
        { from: 'dc_uv_wire_n', to: 'gnd1_uv_wire_gnd', type: 'wire' },
        { from: 'genpanel_wire_p24_n', to: 'gnd1_uv_wire_gnd', type: 'wire' },
    ];
    cons.forEach(c => sys.connMgr.addConn(c));
    sys.redrawAll();
}

// ═══════════════════════════════════════════════════════════════
// 七、复位 / 工程导出
// ═══════════════════════════════════════════════════════════════

/** 完整复位：岸电退出（分岸电主开关、开空开、关电源、相序开关回 OFF）→ 船电主开关分闸 */
async function _resetRig(ctx) {
    const sys = _sysOf(ctx);
    if (!sys) return;
    await _openPdb(ctx);
    await _openBoxBreaker(ctx);
    await _shorePowerOff(ctx);
    await _ensureKnob(ctx, 0);
    if (_qfState(ctx, 'qf1') === 'on') await _openQf1(ctx);
    await _sleep(300);
}

export function initSlider(_sys) {
}

/** 自动接线：初始化（opts.init=true）时不预接线 */
export function applyAllPresets(opts) {
    if (opts && opts.init) return;
    const sys = this && this.sys ? this.sys : window.sys;
    if (!sys) return;
    _autoWire(sys);
}

/** 起动系统：接线 → 复位 → 起动 1# 机组 → 合闸供电（全部模拟面板按钮） */
export async function applyStartSystem() {
    const sys = this && this.sys ? this.sys : window.sys;
    if (!sys) return;
    try {
        _autoWire(sys);
        await _sleep(400);
        const ctx = { sys };
        await _resetRig(ctx);
        await _startGen1(ctx);
        await _closeQf1(ctx);
    } catch (e) {
        console.warn('[起动系统] 执行异常：', e);
    }
}

export function fiveStep() {
}
