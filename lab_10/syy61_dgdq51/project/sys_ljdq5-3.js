// 船舶应急发电机系统仿真工程（主电网 + 应急电网 + 应急配电板自动转换）
//
// 教学主线：应急电网的组成认识、应急发电机的手动起动测试、自动起动（试验）测试——
//          即"主电网失电 → 应急配电板自动断开联络开关 → 延时自动起动应急发电机 →
//          延时自动合上应急主开关给应急负载供电 → 主电网恢复后自动退出"的全过程。
//
// 电路组成（单页工程，全部元件同屏）：
//   主电网    gen1（80 kW 同步发电机）→ qf1 主开关 → bus1 主汇流排第 2 口
//   主配电    bus1 第 6 口 → pdb1 低压配电箱（三路出线，第 3 路 sw3 接联络开关）
//   联络      pdb1 第 3 路出线 → tie1 联络开关 → bus2 应急汇流排第 2 口
//   应急电源  egen1（50 kW 应急发电机）→ eqf1 应急主开关 → bus2 第 3 口
//   应急负载  bus2 第 1 口 → el1 / el2 / el3 三盏星形连接应急灯
//   自动控制  ep1 应急配电板：检测口接 pdb1 第 3 路出口，输出口驱动联络开关、
//             应急主开关的合/分励线圈，并经起动/停止/调频线控制应急发电机组
//   控制电源  dc_uv（1# 机失压/储能线圈）、dc_eqf（应急主开关 + 联络开关失压线圈）
//
// 应急配电板（EmergencyPanel）的自动转换逻辑：
//   · 主电有电（检测口峰值 > 120 V）：待机——联络开关合闸、应急主开关分闸、机组停机
//   · 主电失电：联络开关立即断开 → 延时 10 s 发应急机组起动命令 → 机组运行后延时 8 s
//     发应急主开关合闸命令（合闸信号保持 2 s）→ 应急运行
//   · 主电恢复：延时 3 s 应急主开关分闸 → 分闸后合上联络开关 → 延时后应急机组停机
//   · 「试验 / 正常」模式开关：打在试验位即强制联络开关断开，模拟主电网失电，
//     用于在不拉停主电网的情况下做应急发电机自动起动试验
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
import { EmergencyGenerator3P } from '../components/EmergencyGenerator3P.js';
import { EmergencyMainsSwitch } from '../components/EmergencyMainsSwitch.js';
import { TieSwitch } from '../components/TieSwitch.js';
import { EmergencyPanel } from '../components/EmergencyPanel.js';
import { GeneratorRemotePanel } from '../components/GeneratorRemotePanel.js';
import { DCPower } from '../components/DCPower.js';
import { Ground } from '../components/Gnd.js';
import { DistributionBox } from '../components/DistributionBox.js';
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
// 一、故障（一律由「故障设置」界面触发/修复）
// ═══════════════════════════════════════════════════════════════

export const FAULT_CONFIGS = {
    // 应急发电机超速：原动机超速保护动作，机组立即停机（故障未清除前无法起动）
    egen_overspeed: {
        id: 'egen_overspeed',
        name: '应急发电机超速故障',
        system: '应急发电机',
        check() {
            const c = _fcomp('egen1');
            return !!(c && c.getEngineFaults && c.getEngineFaults().overspeed);
        },
        trigger() {
            const c = _fcomp('egen1');
            if (c && c.setEngineFault) c.setEngineFault('overspeed', true);
        },
        repair() {
            const c = _fcomp('egen1');
            if (c && c.setEngineFault) c.setEngineFault('overspeed', false);
        },
    },
    // 应急发电机调压器（AVR）故障：建压不足，线电压跌至 200 V（约 50% 额定）
    egen_avr: {
        id: 'egen_avr',
        name: '应急发电机调压器故障（建压不足）',
        system: '应急发电机',
        check() {
            const c = _fcomp('egen1');
            return !!(c && c._faultAVR);
        },
        trigger() {
            const c = _fcomp('egen1');
            if (c) { c._faultAVR = true; c.markDirty && c.markDirty(); }
        },
        repair() {
            const c = _fcomp('egen1');
            if (c) { c._faultAVR = false; c.markDirty && c.markDirty(); }
        },
    },
    // 应急主开关储能弹簧失效：储能电机无法把合闸弹簧储满，应急主开关无法合闸
    eqf_store_spring: {
        id: 'eqf_store_spring',
        name: '应急主开关储能弹簧失效',
        system: '应急主开关',
        check() {
            const c = _fcomp('eqf1');
            return !!(c && c._faultStoreSpring);
        },
        trigger() {
            const c = _fcomp('eqf1');
            if (c && c.setStoreSpring) c.setStoreSpring(true);
        },
        repair() {
            const c = _fcomp('eqf1');
            if (c && c.setStoreSpring) c.setStoreSpring(false);
        },
    },
    // 应急主开关脱扣轴卡死：合闸后任何脱扣原因都不能分闸（自动退出时无法断开应急供电）
    eqf_shaft_stuck: {
        id: 'eqf_shaft_stuck',
        name: '应急主开关脱扣轴卡死',
        system: '应急主开关',
        check() {
            const c = _fcomp('eqf1');
            return !!(c && c._faultTripShaftStuck);
        },
        trigger() {
            const c = _fcomp('eqf1');
            if (c && c.setTripShaftStuck) c.setTripShaftStuck(true);
        },
        repair() {
            const c = _fcomp('eqf1');
            if (c && c.setTripShaftStuck) c.setTripShaftStuck(false);
        },
    },
};

// ═══════════════════════════════════════════════════════════════
// 二、通用辅助（一律模拟真实操作 + 条件轮询）
// ═══════════════════════════════════════════════════════════════

const _sysOf = (ctx) => (ctx && ctx.sys) ? ctx.sys : window.sys;
const _sleep = (ms) => new Promise(r => setTimeout(r, ms));
const _comp = (sys, id) => (sys && sys.comps) ? sys.comps[id] : null;
const _egen = (ctx) => _comp(_sysOf(ctx), 'egen1');
const _eqf = (ctx) => _comp(_sysOf(ctx), 'eqf1');
const _tie = (ctx) => _comp(_sysOf(ctx), 'tie1');
const _ep = (ctx) => _comp(_sysOf(ctx), 'ep1');

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

/** 模拟按住部件（按钮类：按下 → 保持 → 松开，保持期间组件才看得到按压状态） */
async function _holdPart(comp, partId, holdMs = 800, down = 'mousedown', up = 'mouseup') {
    if (!_firePart(comp, partId, down)) return false;
    await _sleep(holdMs);
    _firePart(comp, partId, up);
    await _sleep(150);
    return true;
}

/** 工具栏按钮 */
async function _toolbarBtn(id) {
    const btn = document.getElementById(id);
    if (btn && typeof btn.onclick === 'function') btn.onclick();
    await _sleep(1200);
}

/** 主开关状态 */
const _qfState = (ctx, id) => {
    const c = _comp(_sysOf(ctx), id);
    return c && typeof c.getState === 'function' ? c.getState() : null;
};

/** 应急发电机控制方式开关拨到目标位（点一次换一档，限次防死循环） */
async function _ensureEgenMode(ctx, want) {
    const eg = _egen(ctx);
    if (!eg) return false;
    for (let i = 0; i < 3 && eg.mode !== want; i++) {
        if (!_firePart(eg, 'mode-switch', 'click')) {
            console.warn('[应急发电机] 未取到控制方式开关节点，改用 setter 兜底');
            eg.mode = want;
            break;
        }
        await _sleep(300);
    }
    await _sleep(200);
    return eg.mode === want;
}

/** 应急配电板控制模式开关拨到目标位（自动 / 手动） */
async function _ensureEpMode(ctx, wantAuto) {
    const ep = _ep(ctx);
    if (!ep) return false;
    const want = wantAuto ? 'auto' : 'manual';
    for (let i = 0; i < 3 && ep.getMode() !== want; i++) {
        if (!_firePart(ep, 'mode-knob', 'mousedown')) {
            console.warn('[应急配电板] 未取到控制模式开关节点');
            break;
        }
        await _sleep(320);
    }
    await _sleep(200);
    return ep.getMode() === want;
}

/** 应急配电板「联络开关」模式开关拨到目标位（正常 / 试验） */
async function _ensureTiePos(ctx, want) {
    const ep = _ep(ctx);
    if (!ep) return false;
    for (let i = 0; i < 3 && ep.getTiePos() !== want; i++) {
        if (!_firePart(ep, 'tie-knob', 'mousedown')) {
            console.warn('[应急配电板] 未取到联络开关模式开关节点');
            break;
        }
        await _sleep(320);
    }
    await _sleep(200);
    return ep.getTiePos() === want;
}

/** 遥控面板按钮（1# 机组遥控面板） */
async function _panelPress(ctx, panelId, partId, holdMs = 900) {
    const p = _comp(_sysOf(ctx), panelId);
    if (!p) return false;
    return _holdPart(p, partId, holdMs);
}

/** 遥控起动 / 停止 1# 机组 */
async function _startGen1(ctx) {
    const sys = _sysOf(ctx);
    const g = _comp(sys, 'gen1');
    if (!g) return false;
    if (!g.isOn) {
        await _panelPress(ctx, 'genpanel', 'btn-start', 1000);
        await _waitFor(sys, s => !!_comp(s, 'gen1').isOn, 8000);
    }
    return true;
}

/** 遥控合闸 1# 主开关：等储能到位 → 按面板「合闸」→ 等主触头闭合 */
async function _closeQf1(ctx) {
    const sys = _sysOf(ctx);
    if (_qfState(ctx, 'qf1') === 'on') return true;
    await _waitFor(sys, s => { const q = _comp(s, 'qf1'); return !!q && q._charged; }, 15000);
    await _panelPress(ctx, 'genpanel', 'btn-close', 900);
    return _waitFor(sys, s => {
        const q = _comp(s, 'qf1');
        return !!q && q.getState() === 'on';
    }, 10000);
}

/** 「起动系统」：工具栏按钮 → 接线 + 复位 + 起动 1# 机组 + 合闸供电 */
async function _startSystem(ctx) {
    await _toolbarBtn('btnStartSys');
    const sys = _sysOf(ctx);
    // 工具栏按钮内部是异步流程（接线→复位→起机→合闸）：等它把 1# 机与主开关带到
    // "机组运行 + 主开关合闸"，避免与按钮流程重复按压合闸按钮
    const ready = await _waitFor(sys, s => {
        const g = _comp(s, 'gen1'), q = _comp(s, 'qf1');
        return !!g && g.isOn && !!q && q.getState() === 'on';
    }, 25000);
    // 兜底：按钮流程未能合闸时，按遥控面板「合闸」补齐
    if (!ready || _qfState(ctx, 'qf1') !== 'on') await _closeQf1(ctx);
    await _sleep(600);
}

/** 等主电正常：检测口有电、联络开关合闸、应急主开关分闸、应急机组停机 */
async function _waitMainSupply(ctx, timeout = 25000) {
    const sys = _sysOf(ctx);
    return _waitFor(sys, s => {
        const ep = _comp(s, 'ep1'), tie = _comp(s, 'tie1'), eg = _comp(s, 'egen1'), eqf = _comp(s, 'eqf1');
        return !!ep && ep.isDetPowered()
            && !!tie && tie.getState() === 'on'
            && !!eg && !eg.isOn
            && !!eqf && eqf.getState() !== 'on';
    }, timeout, 150);
}

/** 完整复位：主开关分闸 → 应急主开关分闸 → 应急机组停机 → 应急配电板回待机/自动 */
async function _resetRig(ctx) {
    const sys = _sysOf(ctx);
    if (!sys) return;
    const qf = _comp(sys, 'qf1');
    if (qf && qf.getState() === 'on') {
        await _panelPress(ctx, 'genpanel', 'btn-open', 700);
        await _waitFor(sys, s => _comp(s, 'qf1').getState() !== 'on', 8000);
    }
    const eqf = _comp(sys, 'eqf1');
    if (eqf && eqf.getState() === 'on') {
        await _holdPart(eqf, 'btn-open', 700);
        await _waitFor(sys, s => _comp(s, 'eqf1').getState() !== 'on', 8000);
    }
    const eg = _comp(sys, 'egen1');
    if (eg && eg.isOn) {
        await _ensureEgenMode(ctx, 'local');      // 机旁停止按钮仅在手动位有效
        await _holdPart(eg, 'stop', 600);
        await _waitFor(sys, s => !_comp(s, 'egen1').isOn, 8000);
    }
    await _ensureEgenMode(ctx, 'remote');
    const ep = _comp(sys, 'ep1');
    if (ep && typeof ep.reset === 'function') ep.reset();
    await _sleep(400);
}

/** 接线是否已建立 */
function _wired(sys, a, b) {
    return !!(sys && Array.isArray(sys.conns) && sys.conns.some(c =>
        c && c.type === 'wire' && ((c.from === a && c.to === b) || (c.from === b && c.to === a))));
}

// ═══════════════════════════════════════════════════════════════
// 三、常用步骤片段（每个子操作自带 act，"指向 → 执行"）
// ═══════════════════════════════════════════════════════════════

/** 「起动系统 + 合闸供电 + 主电正常」子操作 */
function _opsSupply() {
    return [
        {
            type: 'wire', button: 'btnStartSys',
            msg: '点击「起动系统」：接线、复位后起动 1# 机组',
            async act() { await _startSystem(this); },
        },
        {
            type: 'observe', target: 'ep1', part: 'lcd',
            msg: '等联络开关合闸、应急机组停机（主电正常）',
            async act() { await _waitMainSupply(this); },
        },
    ];
}

/** 「应急发电机控制方式开关」子操作 */
function _opEgenMode(want, msg) {
    return {
        type: 'switch', target: 'egen1', part: 'mode-switch', msg,
        async act() { await _ensureEgenMode(this, want); },
    };
}

// ═══════════════════════════════════════════════════════════════
// 四、工作流
// ═══════════════════════════════════════════════════════════════

export const PROJECT_WORKFLOWS = {
    // ───────────────────────────────────────────────────────────
    // 0. 应急电网组件认识
    // ───────────────────────────────────────────────────────────
    'emergency-power-intro': {
        id: 'emergency-power-intro',
        name: '0. 应急电网组件认识',
        steps: [
            {
                msg: '第 1 步：识别应急电网各部件，点击应急汇流排。',
                mode: 'find',
                target: ['egen1', 'eqf1', 'tie1', 'ep1', 'bus2', 'el1', 'el2', 'el3'],
                demoTarget: 'bus2',
            },
            {
                msg: '第 2 步：在主配电板上找到并点击「应急配电开关」（第 3 路）。',
                mode: 'find', target: 'pdb1', subTarget: 'sw3',
            },
            {
                msg: '第 3 步：识别联络开关（应急汇流排与主配电板的联络）。',
                mode: 'find', target: 'tie1',
            },
            {
                msg: '第 4 步：识别应急配电板（应急电源自动控制装置）。',
                mode: 'find', target: 'ep1',
            },
            {
                msg: '第 5 步：在应急配电板上找到「控制模式」开关。',
                mode: 'find', target: 'ep1', subTarget: 'mode-knob',
            },
            {
                msg: '第 6 步：在应急配电板上找到「联络开关」模式开关。',
                mode: 'find', target: 'ep1', subTarget: 'tie-knob',
            },
            {
                msg: '第 7 步：识别应急发电机机旁控制面板。',
                mode: 'find', target: 'egen1',
            },
            {
                msg: '第 8 步：识别应急发电机主开关。',
                mode: 'find', target: 'eqf1',
            },
            {
                msg: '第 9 步：测试题：主电网与应急电网的关系。',
                mode: 'quiz',
                quizConfig: {
                    question: '关于船舶主电网与应急电网的关系，以下说法正确的是？',
                    options: [
                        '主电网失电时应急电网自动投入，主电网恢复后自动切回并停掉应急发电机',
                        '应急电网与主电网完全独立，任何时候都不需要切换',
                        '应急电网只给照明供电，不给其他设备供电',
                        '主电网失电时应急电网也无法供电',
                    ],
                    answer: 0,
                    analysis: '主电网有电时联络开关合闸、应急机组待机；主电网失电后应急配电板断开联络开关、起动应急发电机、合上应急主开关，由应急汇流排给应急负载供电；主电网恢复后按相反顺序自动退出。',
                },
            },
        ],
    },

    // ───────────────────────────────────────────────────────────
    // 1. 应急发电机手动起动测试（机旁手动起停）
    // ───────────────────────────────────────────────────────────
    'emergency-gen-manual-test': {
        id: 'emergency-gen-manual-test',
        name: '1. 应急发电机手动起动测试',
        steps: [
            {
                msg: '第 1 步：起动系统，1# 机合闸供电（主电网正常）。',
                mode: 'check',
                op: _opsSupply(),
                check() {
                    const sys = _sysOf(this);
                    const ep = _ep(this);
                    return _wired(sys, 'gen1_wire_u', 'qf1_wire_t1')
                        && _wired(sys, 'eqf1_wire_l1', 'bus2_wire_l1_3')
                        && _qfState(this, 'qf1') === 'on'
                        && !!ep && ep.isDetPowered()
                        && !!_gen_on(this);
                },
            },
            {
                msg: '第 2 步：把应急发电机的控制方式开关拨到「手动」。',
                mode: 'check',
                op: [_opEgenMode('local', '控制方式开关拨到「手动」')],
                check() {
                    const eg = _egen(this);
                    return !!eg && eg.mode === 'local';
                },
            },
            {
                msg: '第 3 步：按机旁「起动」，应急发电机建压运行。',
                mode: 'check',
                op: [
                    {
                        type: 'btn', target: 'egen1', part: 'start', msg: '按机旁「起动」按钮',
                        async act() {
                            await _holdPart(_egen(this), 'start', 800);
                            await _waitFor(_sysOf(this), s => !!_comp(s, 'egen1').isOn, 8000);
                        },
                    },
                    {
                        type: 'observe', target: 'egen1', part: 'lcd', msg: '观察 LCD 电压/频率建立',
                        async act() {
                            await _waitFor(_sysOf(this), s => {
                                const g = _comp(s, 'egen1');
                                return !!g && g.isOn && g._freqOut > 49 && g._vRmsOut > 200;
                            }, 10000);
                        },
                    },
                ],
                check() {
                    const eg = _egen(this);
                    return !!eg && eg.isOn && eg.mode === 'local' && eg._freqOut > 49;
                },
            },
            {
                msg: '第 4 步：按机旁「停止」，应急发电机停机。',
                mode: 'check',
                op: [
                    {
                        type: 'btn', target: 'egen1', part: 'stop', msg: '按机旁「停止」按钮',
                        async act() {
                            await _holdPart(_egen(this), 'stop', 700);
                            await _waitFor(_sysOf(this), s => !_comp(s, 'egen1').isOn, 8000);
                        },
                    },
                ],
                check() {
                    const eg = _egen(this);
                    return !!eg && !eg.isOn;
                },
            },
            {
                msg: '第 5 步：控制方式开关拨回「自动」，恢复自动控制。',
                mode: 'check',
                op: [_opEgenMode('remote', '控制方式开关拨回「自动」')],
                check() {
                    const eg = _egen(this);
                    return !!eg && eg.mode === 'remote';
                },
            },
            {
                msg: '第 6 步：测试题：应急发电机的控制方式。',
                mode: 'quiz',
                quizConfig: {
                    question: '应急发电机控制方式开关处于「手动」位时，正确的说法是？',
                    options: [
                        '只能由机旁按钮起停，应急配电板的遥控起动/停止命令不起作用',
                        '应急配电板仍可自动起动与停机',
                        '手动位时起动按钮无效，必须切到自动位才能起动',
                        '手动位时机组不能运行',
                    ],
                    answer: 0,
                    analysis: '控制方式开关在手动（机旁）位时，机组只接受机旁起动/停止按钮的指令；在自动（遥控）位时才接受应急配电板经起动/停止线发来的遥控命令，这也是自动转换能起动机组的前提。',
                },
            },
        ],
    },

    // ───────────────────────────────────────────────────────────
    // 2. 应急发电机自动起动测试（联络开关「试验」位）
    // ───────────────────────────────────────────────────────────
    'emergency-gen-auto-test': {
        id: 'emergency-gen-auto-test',
        name: '2. 应急发电机自动起动测试',
        steps: [
            {
                msg: '第 1 步：起动系统，1# 机合闸供电（主电网正常）。',
                mode: 'check',
                op: _opsSupply(),
                check() {
                    const sys = _sysOf(this);
                    const ep = _ep(this);
                    return _wired(sys, 'gen1_wire_u', 'qf1_wire_t1')
                        && _qfState(this, 'qf1') === 'on'
                        && !!ep && ep.isDetPowered()
                        && !!_gen_on(this);
                },
            },
            {
                msg: '第 2 步：确认应急机在「自动」、配电板在「自动」，联络开关转「试验」。',
                mode: 'check',
                op: [
                    {
                        type: 'observe', target: 'egen1', part: 'mode-switch',
                        msg: '确认应急机控制方式在「自动」',
                        async act() { await _ensureEgenMode(this, 'remote'); },
                    },
                    {
                        type: 'observe', target: 'ep1', part: 'mode-knob',
                        msg: '确认应急配电板控制模式在「自动」',
                        async act() { await _ensureEpMode(this, true); },
                    },
                    {
                        type: 'switch', target: 'ep1', part: 'tie-knob',
                        msg: '联络开关模式开关转到「试验」',
                        async act() { await _ensureTiePos(this, 'test'); },
                    },
                ],
                check() {
                    const eg = _egen(this), ep = _ep(this);
                    return !!eg && eg.mode === 'remote'
                        && !!ep && ep.getMode() === 'auto' && ep.getTiePos() === 'test';
                },
            },
            {
                msg: '第 3 步：观察联络开关断开、应急机自动起动、应急主开关自动合闸。',
                mode: 'check',
                op: [
                    {
                        type: 'switch', target: 'tie1', msg: '联络开关分闸（模拟主电网失电）',
                        async act() {
                            await _waitFor(_sysOf(this), s => {
                                const t = _comp(s, 'tie1');
                                return !!t && t.getState() !== 'on';
                            }, 8000, 150);
                        },
                    },
                    {
                        type: 'observe', target: 'egen1', part: 'lcd',
                        msg: '约 10 s 后应急发电机自动起动',
                        async act() {
                            await _waitFor(_sysOf(this), s => !!_comp(s, 'egen1').isOn, 25000, 150);
                        },
                    },
                    {
                        type: 'observe', target: 'eqf1',
                        msg: '应急主开关合闸，应急灯亮',
                        async act() {
                            await _waitFor(_sysOf(this), s => {
                                const q = _comp(s, 'eqf1'), l = _comp(s, 'el1'), ep = _comp(s, 'ep1');
                                // 应急灯端电压建立（星形负载每相 ≈ 230 V）且配电板进入应急运行
                                return !!q && q.getState() === 'on'
                                    && !!l && l._rmsVoltage > 100
                                    && !!ep && ep.getPhase() === 'running';
                            }, 30000, 150);
                        },
                    },
                ],
                check() {
                    const ep = _ep(this), eg = _egen(this);
                    return !!eg && eg.isOn
                        && _qfState(this, 'eqf1') === 'on'
                        && _tie(this).getState() !== 'on'
                        && !!ep && ep.getPhase() === 'running';
                },
            },
            {
                msg: '第 4 步：联络开关模式转回「正常」，观察自动退出。',
                mode: 'check',
                op: [
                    {
                        type: 'switch', target: 'ep1', part: 'tie-knob',
                        msg: '联络开关模式开关转回「正常」',
                        async act() { await _ensureTiePos(this, 'normal'); },
                    },
                    {
                        type: 'observe', target: 'eqf1', msg: '应急主开关自动分闸（约 3 s）',
                        async act() {
                            await _waitFor(_sysOf(this), s => {
                                const q = _comp(s, 'eqf1');
                                return !!q && q.getState() !== 'on';
                            }, 12000, 150);
                        },
                    },
                    {
                        type: 'observe', target: 'tie1', msg: '联络开关自动合闸恢复主电',
                        async act() {
                            await _waitFor(_sysOf(this), s => {
                                const t = _comp(s, 'tie1');
                                return !!t && t.getState() === 'on';
                            }, 12000, 150);
                        },
                    },
                    {
                        type: 'observe', target: 'egen1', part: 'lcd',
                        msg: '应急发电机自动停机（约 13 s）',
                        async act() {
                            await _waitFor(_sysOf(this), s => !_comp(s, 'egen1').isOn, 20000, 150);
                        },
                    },
                ],
                check() {
                    const ep = _ep(this), eg = _egen(this), tie = _tie(this);
                    return !!ep && ep.getTiePos() === 'normal'
                        && !!eg && !eg.isOn
                        && _qfState(this, 'eqf1') !== 'on'
                        && !!tie && tie.getState() === 'on';
                },
            },
            {
                msg: '第 5 步：测试题：试验位与恢复过程。',
                mode: 'quiz',
                quizConfig: {
                    question: '把联络开关模式开关从「试验」转回「正常」后，应急配电板按什么顺序退出？',
                    options: [
                        '应急主开关先分闸 → 延时合上联络开关 → 再延时停掉应急发电机',
                        '应急发电机先停机 → 再分应急主开关 → 最后合联络开关',
                        '联络开关先合闸 → 应急主开关直接分闸 → 机组继续运行',
                        '三只开关同时动作，无先后顺序',
                    ],
                    answer: 0,
                    analysis: '退出顺序必须"先断应急电源、再合主电联络、最后停机组"：先分应急主开关让应急汇流排失电，再合联络开关恢复主电，避免非同期并列；主电恢复后停掉应急发电机。',
                },
            },
        ],
    },
};

/** 1# 机组是否在运行（check 辅助） */
function _gen_on(ctx) {
    const g = _comp(_sysOf(ctx), 'gen1');
    return !!(g && g.isOn);
}

export const componentConfigs = [
    // ── 主回路：同步发电机 → 主开关 → 汇流排 ──
    { Class: SyncGenerator3P, id: 'gen1', x: -120, y: 700, vRms: 230, freq: 50, isOn: false, mode: 'remote', label: '1#同步发电机', ratedPower: 80, ratedVoltage: 400, ratedCosPhi: 0.8, maxDropV: 200, avrMaxComp: 1, avrDelay: 2, avrTime: 5, autoDecoupleTrim: true, visible: true },
    { Class: MarineMainsSwitch, id: 'qf1', x: -120, y: 180, ratedCtrlVoltage: 24, label: '主开关', genId: 'gen1', revPowerKw: 8, revTime: 5, faultSimpleProtect: true, visible: true },
    { Class: GeneratorRemotePanel, id: 'genpanel', x: 360, y: 700, genId: 'gen1', qfId: 'qf1', label: '1#发电机组遥控面板', busId: 'bus1', visible: true },

    { Class: Busbar3P, id: 'bus1', x: -120, y: 30, portsPerBar: 6, label: '汇流排', visible: true },
    // ── 应急汇流排：紧邻主汇流排右侧，3 个端口 ──
    { Class: Busbar3P, id: 'bus2', x: 1280, y: 30, portsPerBar: 3, label: '应急汇流排', visible: true },

    // ── 应急负载：主汇流排与应急汇流排中间，三个星型连接的白炽灯（接应急汇流排第1接口）──
    { Class: IncandescentLamp, id: 'el1', x: 1060, y: 70, label: '应急灯1', coldResistance: 48.4, visible: true, rotation: 90 },
    { Class: IncandescentLamp, id: 'el2', x: 1130, y: 110, label: '应急灯2', coldResistance: 48.4, visible: true, rotation: 90 },
    { Class: IncandescentLamp, id: 'el3', x: 1200, y: 150, label: '应急灯3', coldResistance: 48.4, visible: true, rotation: 90 },
    // ── 应急发电机主开关：应急汇流排与应急发电机之间 ──
    { Class: EmergencyMainsSwitch, id: 'eqf1', x: 1500, y: 180, ratedCtrlVoltage: 24, genId: 'egen1', faultSimpleProtect: true, label: '应急发电机主开关', visible: true },
    // ── 应急发电机组件：位于主开关下方，经 eqf1 接入 bus2 ──
    { Class: EmergencyGenerator3P, id: 'egen1', x: 1500, y: 650, isOn: false, mode: 'remote', label: '应急发电机组', ratedPower: 50, ratedVoltage: 400, ratedCosPhi: 0.8, freq: 50, visible: true },

    // ── 1号机组控制电源共地（遥控面板与控制电源的中间下方）──
    // dc_uv 负极、genpanel p24_n 共同接此接地，不再向线圈引出负极线
    { Class: Ground, id: 'gnd1_uv', x: 590, y: 1000, label: '控制电源接地', visible: true },
    // ── 1号主开关线圈接地（主开关右下角）──
    // 储能电机 m2 / 失压 uv2 / 合闸 c2 / 分励 flb 负端均接此接地
    { Class: Ground, id: 'gnd1_qf', x: 660, y: 400, label: '线圈接地', visible: true },
    // ── 1号遥控面板信号接地（面板上方）──
    // 合闸输出 close_b、分闸输出 open_b 负端接地
    { Class: Ground, id: 'gnd1_panel', x: 530, y: 670, label: '信号接地', visible: true },

    // ── 控制电源（DC 24V）：失压脱扣线圈 ──
    { Class: DCPower, id: 'dc_uv', x: 660, y: 750, voltage: 24, isOn: true, label: '失压脱扣电源', visible: true },

    // ── 应急主开关控制电源（DC 24V）与接地：独立配置，不与 1号机共用 ──
    { Class: DCPower, id: 'dc_eqf', x: 1850, y: 350, voltage: 24, isOn: true, label: '应急控制电源', visible: true },
    // ── 应急24V电源接地（应急控制电源下方）──
    // 失压 uv2 / 储能电机 m2 负端、电源负端均接此接地
    { Class: Ground, id: 'gnd_eqf', x: 1900, y: 600, label: '应急电源接地', visible: true },
    // ── 联络开关线圈接地（独立接地，不与应急电源共用）──
    // 联络开关合闸 c2 / 分励 flb 负端、应急配电板联络输出负端均接此接地
    { Class: Ground, id: 'gnd_tie', x: 1350, y: 530, label: '联络线圈接地', visible: true },
    // ── 应急配电板线圈接地（独立接地，驱动应急主开关合/分励线圈回路）──
    // 应急主开关合闸 c2 / 分励 flb 负端、应急配电板应急输出负端均接此接地
    { Class: Ground, id: 'gnd_ep', x: 1600, y: 620, label: '配电板线圈接地', visible: true },

    // ── 低压三相配电箱（进线接汇流排第6口，出线由学员自行连接）──
    { Class: DistributionBox, id: 'pdb1', x: 700, y: 220, label: '低压配电箱', ratedCurrent: 100, shortDelay: 0.2, overloadK: 4, tripCoilR: 200, initStates: ['off', 'off', 'on'], visible: true },

    // ── 联络开关：上端接应急汇流排（bus2 第2口），下端接配电箱第3路输出 ──
    { Class: TieSwitch, id: 'tie1', x: 1450, y: 220, label: '联络开关', ratedVoltage: 400, ratedCurrent: 100, tripCurrent: 10, visible: true, rotation: 90 },

    // ── 应急配电板：自动控制应急发电机、应急主开关和联络开关 ──
    { Class: EmergencyPanel, id: 'ep1', x: 1100, y: 600, label: '应急配电板', genId: 'egen1', eqfId: 'eqf1', tieId: 'tie1', visible: true },

    // ── 仪表停靠（默认隐藏，由工具栏「选择仪表」调出）──
    { Class: Multimeter, id: 'multimeter', x: 920, y: 100, visible: false },
    { Class: MF47Multimeter, id: 'mf47-panel', x: 1050, y: 150, visible: false },
    { Class: Oscilloscope_tri, id: 'osc', x: 50, y: 50, visible: false },
    { Class: SignalGenerator, id: 'sg', x: 50, y: 50, visible: false },
    { Class: ProcessCalibrator, id: 'cali', x: 50, y: 50, visible: false },
    { Class: ElecMeter, id: 'elecmeter', x: 50, y: 50, visible: false },
    { Class: RealMegohmMeter, id: 'megohm', x: 50, y: 50, visible: false },
];

// ─── 接线 ───

function _autoWire(sys) {
    sys.conns.length = 0;
    const cons = [
        // ── 主回路：同步发电机 → 主开关 → 汇流排（第2口）──
        { from: 'gen1_wire_u', to: 'qf1_wire_t1', type: 'wire' },
        { from: 'gen1_wire_v', to: 'qf1_wire_t2', type: 'wire' },
        { from: 'gen1_wire_w', to: 'qf1_wire_t3', type: 'wire' },
        { from: 'qf1_wire_l1', to: 'bus1_wire_l1_2', type: 'wire' },
        { from: 'qf1_wire_l2', to: 'bus1_wire_l2_2', type: 'wire' },
        { from: 'qf1_wire_l3', to: 'bus1_wire_l3_2', type: 'wire' },
        // ── 低压配电箱：汇流排第6口三相进线 ──
        { from: 'bus1_wire_l1_6', to: 'pdb1_wire_in1', type: 'wire' },
        { from: 'bus1_wire_l2_6', to: 'pdb1_wire_in2', type: 'wire' },
        { from: 'bus1_wire_l3_6', to: 'pdb1_wire_in3', type: 'wire' },
        // ── 应急负载：三个星型连接白炽灯 ← 应急汇流排第1接口（L1/L2/L3）──
        { from: 'bus2_wire_l1_1', to: 'el1_wire_l', type: 'wire' },
        { from: 'bus2_wire_l2_1', to: 'el2_wire_l', type: 'wire' },
        { from: 'bus2_wire_l3_1', to: 'el3_wire_l', type: 'wire' },
        // 星点互连（中性点，三灯 R 端相连）
        { from: 'el1_wire_r', to: 'el2_wire_r', type: 'wire' },
        { from: 'el2_wire_r', to: 'el3_wire_r', type: 'wire' },
        // ── 应急发电机主回路：egen1 → eqf1(T端) → bus2 应急汇流排（第3口）──
        { from: 'egen1_wire_u', to: 'eqf1_wire_t1', type: 'wire' },
        { from: 'egen1_wire_v', to: 'eqf1_wire_t2', type: 'wire' },
        { from: 'egen1_wire_w', to: 'eqf1_wire_t3', type: 'wire' },
        { from: 'eqf1_wire_l1', to: 'bus2_wire_l1_3', type: 'wire' },
        { from: 'eqf1_wire_l2', to: 'bus2_wire_l2_3', type: 'wire' },
        { from: 'eqf1_wire_l3', to: 'bus2_wire_l3_3', type: 'wire' },
        // ── 联络开关：上端接应急汇流排（bus2 第2口），下端接配电箱第3路输出 ──
        { from: 'tie1_wire_l1', to: 'bus2_wire_l1_2', type: 'wire' },
        { from: 'tie1_wire_l2', to: 'bus2_wire_l2_2', type: 'wire' },
        { from: 'tie1_wire_l3', to: 'bus2_wire_l3_2', type: 'wire' },
        { from: 'tie1_wire_t1', to: 'pdb1_wire_sw3_t1', type: 'wire' },
        { from: 'tie1_wire_t2', to: 'pdb1_wire_sw3_t2', type: 'wire' },
        { from: 'tie1_wire_t3', to: 'pdb1_wire_sw3_t3', type: 'wire' },
        // ── 应急配电板接线 ──
        // 检测端口：接配电箱第3路出口（sw3_t1/t2），检测主配电板是否失电
        { from: 'ep1_wire_det_a', to: 'pdb1_wire_sw3_t2', type: 'wire' },
        { from: 'ep1_wire_det_b', to: 'pdb1_wire_sw3_t1', type: 'wire' },
        // 联络开关控制：合闸线圈 c1/c2、分励线圈 fla/flb（线圈负端接独立接地 gnd_tie）
        { from: 'ep1_wire_tie_close_a', to: 'tie1_wire_c1', type: 'wire' },
        { from: 'ep1_wire_tie_close_b', to: 'gnd_tie_wire_gnd', type: 'wire' },
        { from: 'ep1_wire_tie_open_a', to: 'tie1_wire_fla', type: 'wire' },
        { from: 'ep1_wire_tie_open_b', to: 'gnd_tie_wire_gnd', type: 'wire' },
        { from: 'tie1_wire_c2', to: 'gnd_tie_wire_gnd', type: 'wire' },
        { from: 'tie1_wire_flb', to: 'gnd_tie_wire_gnd', type: 'wire' },
        // 失压线圈：由应急控制电源 dc_eqf（24V）供电，负端接联络线圈接地 gnd_tie
        { from: 'dc_eqf_wire_p', to: 'tie1_wire_uv1', type: 'wire' },
        { from: 'tie1_wire_uv2', to: 'gnd_tie_wire_gnd', type: 'wire' },
        // 应急主开关控制：合闸线圈 c1/c2、分励线圈 fla/flb（线圈负端接独立接地 gnd_ep）
        { from: 'ep1_wire_eqf_close_a', to: 'eqf1_wire_c1', type: 'wire' },
        { from: 'ep1_wire_eqf_close_b', to: 'gnd_ep_wire_gnd', type: 'wire' },
        { from: 'ep1_wire_eqf_open_a', to: 'eqf1_wire_fla', type: 'wire' },
        { from: 'ep1_wire_eqf_open_b', to: 'gnd_ep_wire_gnd', type: 'wire' },
        { from: 'eqf1_wire_c2', to: 'gnd_ep_wire_gnd', type: 'wire' },
        { from: 'eqf1_wire_flb', to: 'gnd_ep_wire_gnd', type: 'wire' },
        // 应急发电机遥控：起动/停止/调频
        { from: 'ep1_wire_egen_start_a', to: 'egen1_wire_rm_start_a', type: 'wire' },
        { from: 'ep1_wire_egen_start_b', to: 'egen1_wire_rm_start_b', type: 'wire' },
        { from: 'ep1_wire_egen_stop_a', to: 'egen1_wire_rm_stop_a', type: 'wire' },
        { from: 'ep1_wire_egen_stop_b', to: 'egen1_wire_rm_stop_b', type: 'wire' },
        { from: 'ep1_wire_egen_freq_p', to: 'egen1_wire_freq_in_p', type: 'wire' },
        { from: 'ep1_wire_egen_freq_n', to: 'egen1_wire_freq_in_n', type: 'wire' },
        // ── 应急发电机主开关控制回路：独立控制电源 dc_eqf 供电，负端接 gnd_eqf ──
        { from: 'dc_eqf_wire_p', to: 'eqf1_wire_uv1', type: 'wire' },
        { from: 'dc_eqf_wire_p', to: 'eqf1_wire_m1', type: 'wire' },
        { from: 'eqf1_wire_uv2', to: 'gnd_eqf_wire_gnd', type: 'wire' },
        { from: 'eqf1_wire_m2', to: 'gnd_eqf_wire_gnd', type: 'wire' },
        // ── 控制电源：DC 24V → 失压脱扣线圈 / 储能电机 正端；负端均接地 ──
        { from: 'dc_uv_wire_p', to: 'qf1_wire_uv1', type: 'wire' },
        { from: 'dc_uv_wire_p', to: 'qf1_wire_m1', type: 'wire' },
        { from: 'dc_eqf_wire_n', to: 'gnd_eqf_wire_gnd', type: 'wire' },
        // 线圈负端接地（gnd1_qf，主开关右下角）
        { from: 'qf1_wire_uv2', to: 'gnd1_qf_wire_gnd', type: 'wire' },
        { from: 'qf1_wire_m2', to: 'gnd1_qf_wire_gnd', type: 'wire' },
        // ── 发电机组遥控面板：左面板 → gen1 遥控端口 ──
        { from: 'genpanel_wire_start_a', to: 'gen1_wire_rm_start_a', type: 'wire' },
        { from: 'genpanel_wire_start_b', to: 'gen1_wire_rm_start_b', type: 'wire' },
        { from: 'genpanel_wire_stop_a', to: 'gen1_wire_rm_stop_a', type: 'wire' },
        { from: 'genpanel_wire_stop_b', to: 'gen1_wire_rm_stop_b', type: 'wire' },
        { from: 'genpanel_wire_spd_p', to: 'gen1_wire_freq_in_p', type: 'wire' },
        { from: 'genpanel_wire_spd_n', to: 'gen1_wire_freq_in_n', type: 'wire' },
        // 合闸/分闸正端 → 线圈正端；输出负端接地（gnd1_panel，面板上方）、线圈负端接地（gnd1_qf）
        { from: 'genpanel_wire_close_a', to: 'qf1_wire_c1', type: 'wire' },
        { from: 'genpanel_wire_open_a', to: 'qf1_wire_fla', type: 'wire' },
        { from: 'genpanel_wire_close_b', to: 'gnd1_panel_wire_gnd', type: 'wire' },
        { from: 'genpanel_wire_open_b', to: 'gnd1_panel_wire_gnd', type: 'wire' },
        { from: 'qf1_wire_c2', to: 'gnd1_qf_wire_gnd', type: 'wire' },
        { from: 'qf1_wire_flb', to: 'gnd1_qf_wire_gnd', type: 'wire' },
        // ── 左面板 24V 电源 ← dc_uv（正端）；负端接地（gnd1_uv，面板与控制电源中间下方）──
        { from: 'dc_uv_wire_p', to: 'genpanel_wire_p24_p', type: 'wire' },
        { from: 'dc_uv_wire_n', to: 'gnd1_uv_wire_gnd', type: 'wire' },
        { from: 'genpanel_wire_p24_n', to: 'gnd1_uv_wire_gnd', type: 'wire' },
    ];
    cons.forEach(c => sys.connMgr.addConn(c));
    sys.redrawAll();
}

// ═══════════════════════════════════════════════════════════════
// 五、工程导出
// ═══════════════════════════════════════════════════════════════

export function initSlider(_sys) {
}

/** 自动接线：初始化（opts.init=true）时不预接线 */
export function applyAllPresets(opts) {
    if (opts && opts.init) return;
    const sys = this && this.sys ? this.sys : window.sys;
    if (!sys) return;
    _autoWire(sys);
}

/** 起动系统：接线 → 复位 → 起动 1# 机组 → 合闸供电 */
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
