// 船舶自动化电站仿真工程（两台同步发电机组 + 船用框架式空气断路器 + 自动化电站）
//
// 教学主线：① 认识自动化电站的组成；② 发电机组的自动并车、自动解列；
//          ③ Ⅰ级故障自动化电站带电换机；④ Ⅱ级故障自动化电站断电切换；⑤ 重载询问功能实操。
//
// 电路组成（单页工程，全部元件同屏）：
//   1# 机组   gen1（80 kW / 400 V / 50 Hz）→ qf1 船用框架式空气断路器 → bus1 汇流排第 1 口
//   2# 机组   gen2（80 kW / 400 V / 50 Hz）→ qf2 船用框架式空气断路器 → bus1 汇流排第 7 口
//   遥控面板  genpanel / genpanel2：起/停按钮、合/分闸按钮、调速旋钮、通信接口
//   自动化电站 auto_ctl（ShipAutoControl）：母线采集、手动/自动、备用顺序、comm1~2 通面板
//   负载      load3 三相可调负载（汇流排第 6 口）、heavyload 重载询问---侧推器（第 5 口）
//   馈出支路  bus1 第 8 口 → QF3（acb_l）→ 三盏白炽灯 lamp1~3
//   控制电源  dc_uv / dc_uv2（DC 24 V）：储能电机、合闸/分励/失压线圈、遥控面板电源
//
// 两个核心教学点：
//   1. 自动化电站（自动模式）根据负荷与母线状态自动完成：失电自动起动、自动并车、
//      自动均分负荷、低负荷自动解列、自动停机，以及故障后的自动换机 / 断电切换。
//   2. 重载询问：大功率负载（侧推器）起动前先向电站询问，单机在网时电站强制并车，
//      并车成功应答"允许"后才允许负载起动，避免起动冲击使电网失电。
//
// 约定（与全局 AGENTS.md「最新范式」一致）：
//   · 单页工程：不导出 PROJECT_PAGES，consys.js 不创建 PageManager，工作流无 page op
//   · 默认不接线：applyAllPresets({init:true}) 不接线；只有「自动接线 / 起动系统 / 工作流 op」才接线
//   · 按钮/旋钮/开关一律模拟真实交互（getClickablePartNode(...).fire('click'/'mousedown'/'mouseup')）
//   · 参数（负载功率）一律走参数配置界面（弹框 → 改值 → 点「保存」）
//   · 故障一律走「故障设置」界面，不直接调用 FAULT_CONFIG.trigger()
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
import { HeavyLoadInquiry } from '../components/HeavyLoadInquiry.js';

const _fcomp = (id) => (window.sys && window.sys.comps) ? window.sys.comps[id] : null;

// ═══════════════════════════════════════════════════════════════
// 一、故障
//   Ⅰ级故障（滑油压力下降/冷却水温度异常）：报警级，机组不停机、主开关不动作，
//      由自动化电站执行"带电换机"（备用机并车 → 转移负荷 → 解列 → 停机）。
//   Ⅱ级故障（欠压、超速、滑油低压、冷却水温高）：机组停机或主开关保护跳闸，母线失电，
//      由自动化电站执行"断电切换"（先失电，再自动起动备用机并合闸恢复供电）。
// ═══════════════════════════════════════════════════════════════

export const FAULT_CONFIGS = {
    gen1_lv1_fault: {
        id: 'gen1_lv1_fault',
        name: '1#机组Ⅰ级故障',
        system: '发电机',
        check() {
            const c = _fcomp('gen1');
            return !!(c && c.hasLv1Fault && c.hasLv1Fault());
        },
        trigger() {
            const c = _fcomp('gen1');
            if (c && c.setLv1Fault) {
                c.setLv1Fault('oilPress', true);
                c.setLv1Fault('coolantTemp', true);
            }
        },
        repair() {
            const c = _fcomp('gen1');
            if (c && c.setLv1Fault) {
                c.setLv1Fault('oilPress', false);
                c.setLv1Fault('coolantTemp', false);
            }
        },
    },
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
            // 干线短路 → 主开关短路保护动作：两台主开关全部跳闸，汇流排失电
            ['qf1', 'qf2'].forEach(id => {
                const q = _fcomp(id);
                if (q && q.getState() === 'on' && q.tryTrip) q.tryTrip();
            });
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

// 常用组件取用（n = 1 / 2 号机组）
const _gen = (ctx, n = 1) => _comp(_sysOf(ctx), n === 1 ? 'gen1' : 'gen2');
const _qf = (ctx, n = 1) => _comp(_sysOf(ctx), n === 1 ? 'qf1' : 'qf2');
const _panel = (ctx, n = 1) => _comp(_sysOf(ctx), n === 1 ? 'genpanel' : 'genpanel2');
const _ac = (ctx) => _comp(_sysOf(ctx), 'auto_ctl');     // 自动化电站
const _hv = (ctx) => _comp(_sysOf(ctx), 'heavyload');    // 重载询问---侧推器
const _load = (ctx) => _comp(_sysOf(ctx), 'load3');      // 三相可调负载

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

/** 主开关状态 / 机组运行状态 */
const _qfState = (ctx, n = 1) => {
    const c = _qf(ctx, n);
    return c && typeof c.getState === 'function' ? c.getState() : null;
};
const _genOn = (ctx, n = 1) => {
    const g = _gen(ctx, n);
    return !!(g && g.isOn);
};

// ─── 机组 / 主开关操作（走遥控面板按钮）────────────────────────

/** 遥控起动机组 */
async function _startGen(ctx, n = 1) {
    const sys = _sysOf(ctx), g = _gen(ctx, n), p = _panel(ctx, n);
    if (!g) return false;
    if (g.isOn) return true;
    await _holdPart(p, 'btn-start', 1000);
    return _waitFor(sys, s => { const c = _comp(s, n === 1 ? 'gen1' : 'gen2'); return !!c && c.isOn; }, 15000);
}

/** 遥控停止机组 */
async function _stopGen(ctx, n = 1) {
    const sys = _sysOf(ctx), g = _gen(ctx, n), p = _panel(ctx, n);
    if (!g || !g.isOn) return true;
    await _holdPart(p, 'btn-stop', 900);
    return _waitFor(sys, s => { const c = _comp(s, n === 1 ? 'gen1' : 'gen2'); return !!c && !c.isOn; }, 15000);
}

/** 遥控合闸：等储能到位 → 按「合闸」→ 等主触头闭合 */
async function _closeQf(ctx, n = 1) {
    const sys = _sysOf(ctx), qid = n === 1 ? 'qf1' : 'qf2';
    if (_qfState(ctx, n) === 'on') return true;
    await _waitFor(sys, s => { const q = _comp(s, qid); return !!q && q._charged; }, 20000);
    await _holdPart(_panel(ctx, n), 'btn-close', 900);
    return _waitFor(sys, s => { const q = _comp(s, qid); return !!q && q.getState() === 'on'; }, 8000);
}

/** 遥控分闸 */
async function _openQf(ctx, n = 1) {
    const sys = _sysOf(ctx), qid = n === 1 ? 'qf1' : 'qf2';
    if (_qfState(ctx, n) !== 'on') return true;
    await _holdPart(_panel(ctx, n), 'btn-open', 900);
    return _waitFor(sys, s => { const q = _comp(s, qid); return !!q && q.getState() !== 'on'; }, 8000);
}

// ─── 自动化电站 / 负载 / 重载询问操作 ──────────────────────────

/** 手动/自动转换开关：点击换档到指定状态（不直接改内部字段） */
async function _setAutoMode(ctx, want = true) {
    const ac = _ac(ctx);
    if (!ac) return false;
    for (let i = 0; i < 3 && ac.isAuto() !== want; i++) {
        if (!_firePart(ac, 'knob-mode')) break;
        await _sleep(450);
    }
    await _sleep(200);
    return ac.isAuto() === want;
}

/** 重载询问面板选择开关：点击换档到 直接起动 / 重载询问 */
async function _setHeavyMode(ctx, mode = 'inquiry') {
    const hv = _hv(ctx);
    if (!hv) return false;
    const wantDirect = mode === 'direct';
    for (let i = 0; i < 3 && hv.isModeDirect() !== wantDirect; i++) {
        if (!_firePart(hv, 'knob')) break;
        await _sleep(450);
    }
    await _sleep(200);
    return hv.isModeDirect() === wantDirect;
}

/** 调出 / 收起重载询问面板（工具栏复选框，与「选择仪表」同一套显隐机制） */
async function _showHeavyPanel(ctx, show = true) {
    const cb = document.getElementById('heavyLoadShow');
    if (cb && cb.checked !== show) {
        cb.checked = show;
        cb.dispatchEvent(new Event('change', { bubbles: true }));
    }
    return _waitFor(_sysOf(ctx), s => {
        const hv = _comp(s, 'heavyload');
        return !!hv && !!hv.group && hv.group.visible() === show;
    }, 5000);
}

/** 投入三相负载 */
async function _loadOn(ctx) {
    const sys = _sysOf(ctx), l = _load(ctx);
    if (!l) return false;
    if (l.isLoaded()) return true;
    await _clickPart(l, 'btn-load', 450);
    return _waitFor(sys, s => { const c = _comp(s, 'load3'); return !!c && c.isLoaded(); }, 5000);
}

/** 退出三相负载 */
async function _loadOff(ctx) {
    const sys = _sysOf(ctx), l = _load(ctx);
    if (!l) return false;
    if (!l.isLoaded()) return true;
    await _clickPart(l, 'btn-unload', 450);
    return _waitFor(sys, s => { const c = _comp(s, 'load3'); return !!c && !c.isLoaded(); }, 5000);
}

/**
 * 通过参数配置界面动态演示参数修改（统一规范）：
 *   ① 弹框前把组件实时属性同步进 config 副本（否则「保存」会把旧值一并回写）
 *   ② comp.showConfigDialog() 弹出参数设置界面
 *   ③ 取 #diag_<key> 输入框 → 闪烁箭头高亮 + 填入新值
 *   ④ 取最后打开的对话框的「保存」按钮 → 闪烁箭头高亮 + 真正 click() 按下
 *   ⑤ 确认对话框已关闭（未关闭则点「取消」）
 */
async function _demoSetCfg(wf, compId, key, value, tip) {
    const sys = _sysOf(wf);
    const comp = sys && sys.comps[compId];
    if (!comp || typeof comp.showConfigDialog !== 'function') return;
    (comp.getConfigFields ? comp.getConfigFields() : []).forEach(f => {
        if (f.get) return;
        try { const live = comp[f.key]; if (live !== undefined) comp.config[f.key] = live; } catch (e) { /* 只读属性忽略 */ }
    });
    comp.showConfigDialog();
    await _sleep(700);

    const input = document.getElementById('diag_' + key);
    if (input) {
        if (typeof wf._flashDomElement === 'function') {
            await wf._flashDomElement(input, tip || `请把该参数改为 ${value}`, 2400);
        }
        input.value = String(value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
    }

    const saveBtns = [...document.querySelectorAll('button')].filter(b => b.textContent.trim() === '保存');
    const saveBtn = saveBtns[saveBtns.length - 1];
    if (saveBtn) {
        if (typeof wf._flashDomElement === 'function') await wf._flashDomElement(saveBtn, '点击「保存」确认参数修改', 1800);
        saveBtn.click();
        await _sleep(600);
    }

    const stillInput = document.getElementById('diag_' + key);
    if (stillInput && stillInput.offsetParent !== null) {
        const closeBtn = [...document.querySelectorAll('button')].find(b => /^(关闭|取消)$/.test(b.textContent.trim()));
        if (closeBtn) {
            if (typeof wf._flashDomElement === 'function') await wf._flashDomElement(closeBtn, '关闭参数对话框', 1500);
            closeBtn.click();
            await _sleep(400);
        }
    }

    // 生效兜底：保存未生效时直接调公开接口，保证演示不中断
    if (Math.round(parseFloat(comp[key])) !== Math.round(parseFloat(value))) {
        if (typeof comp.onConfigUpdate === 'function') comp.onConfigUpdate({ [key]: value });
    }
}

// ═══════════════════════════════════════════════════════════════
// 三、复位 / 常用步骤片段（每个子操作自带 act，"指示 → 执行"）
// ═══════════════════════════════════════════════════════════════

/**
 * 复位电站：两台主开关分闸、两台机组停机、负载与侧推器退出、
 * 自动化电站回到手动位。全部走真实点击，便于学员看到"操作 → 反馈"。
 * 仅在自动电站内部计时器（无界面）上做清零，保证重复演示可复现。
 */
async function _resetRig(ctx) {
    const sys = _sysOf(ctx);
    if (!sys) return;
    for (const n of [1, 2]) {
        if (_qfState(ctx, n) === 'on') await _openQf(ctx, n);
        if (_genOn(ctx, n)) await _stopGen(ctx, n);
    }
    if (_load(ctx) && _load(ctx).isLoaded()) await _loadOff(ctx);
    const hv = _hv(ctx);
    if (hv && hv.isRunning()) await _clickPart(hv, 'btn-stop', 400);
    await _setAutoMode(ctx, false);
    // 自动电站内部计时器清零（无界面反馈的内部状态，保证重复演示可复现）
    const ac = _ac(ctx);
    if (ac) {
        ac._switchIdx = -1; ac._switchPhase = '';
        ac._decoupleIdx = -1; ac._decoupleTimer = 0; ac._stopTimer = 0;
        ac._lossTimer = 0; ac._startTimer = {}; ac._syncTimer = {}; ac._freqAdjTimer = 0;
        ac._heavyInquiry = false; ac._heavyResp = ''; ac._heavyForceParallel = false;
    }
    await _sleep(300);
}

/** 「起动系统」：工具栏按钮 → 接线 + 复位 + 起动 1# + 合闸供电 */
async function _startSystem(ctx) {
    await _toolbarBtn('btnStartSys');
    const sys = _sysOf(ctx);
    const ready = await _waitFor(sys, s => {
        const g = _comp(s, 'gen1'), q = _comp(s, 'qf1');
        return !!g && g.isOn && !!q && q.getState() === 'on';
    }, 30000);
    if (!ready) {                       // 兜底：按钮流程未完成时补齐
        await _startGen(ctx, 1);
        await _closeQf(ctx, 1);
    }
    await _sleep(400);
}

/** 「起动系统 + 合闸供电」子操作 */
function _opsStartSupply() {
    return [
        {
            type: 'wire', button: 'btnStartSys',
            msg: '点击「起动系统」：自动接线、起动 1# 机组并合闸供电',
            async act() { await _startSystem(this); },
        },
        {
            type: 'observe', target: 'genpanel', part: 'lcd',
            msg: '机组建压、主开关合闸，向汇流排供电',
            async act() {
                await _waitFor(_sysOf(this), s => {
                    const g = _comp(s, 'gen1'), q = _comp(s, 'qf1');
                    return !!g && g.isOn && !!q && q.getState() === 'on';
                }, 20000);
            },
        },
    ];
}

/** 「切自动模式」子操作 */
function _opsAutoMode() {
    return [
        {
            type: 'switch', target: 'auto_ctl', part: 'knob-mode',
            msg: '把「手动/自动」转换开关打到自动位',
            async act() { await _setAutoMode(this, true); },
        },
        {
            type: 'observe', target: 'auto_ctl', part: 'led-auto',
            msg: '自动灯亮，电站进入自动运行',
            async act() {
                await _waitFor(_sysOf(this), s => {
                    const ac = _comp(s, 'auto_ctl');
                    return !!ac && ac.isAuto() && ac.isPowered();
                }, 6000);
            },
        },
    ];
}

// ═══════════════════════════════════════════════════════════════
// 四、工作流
// ═══════════════════════════════════════════════════════════════

export const PROJECT_WORKFLOWS = {

    // ───────────────────────────────────────────────────────────
    // 0. 船舶自动化电站系统认识
    // ───────────────────────────────────────────────────────────
    'station-intro': {
        id: 'station-intro',
        name: '0. 船舶自动化电站系统认识',
        steps: [
            { msg: '第 1 步：识别 1# 同步发电机组（含控制屏）。', mode: 'find', target: 'gen1', subTarget: 'lcd' },
            { msg: '第 2 步：识别 1# 主开关（框架式空气断路器）。', mode: 'find', target: 'qf1', subTarget: 'main-contact' },
            { msg: '第 3 步：在遥控面板上找到「起动」按钮。', mode: 'find', target: 'genpanel', subTarget: 'btn-start' },
            { msg: '第 4 步：识别汇流排（三相主汇流排）。', mode: 'find', target: 'bus1' },
            { msg: '第 5 步：在自动化电站上找到「手动/自动」开关。', mode: 'find', target: 'auto_ctl', subTarget: 'knob-mode' },
            { msg: '第 6 步：识别三相可调负载。', mode: 'find', target: 'load3', subTarget: 'power' },
            { msg: '第 7 步：识别馈出支路的三盏白炽灯。', mode: 'find', target: ['lamp1', 'lamp2', 'lamp3'], demoTarget: 'lamp1' },
            {
                msg: '第 8 步：测试题：自动化电站的主要功能。',
                mode: 'quiz',
                quizConfig: {
                    question: '船舶自动化电站（电站自动控制系统）的主要功能是什么？',
                    options: [
                        '根据负荷与母线状态自动完成备用机组的起动、并车、负荷分配、解列与停机，并自动调节频率电压，实现全船发电用电的集中管理',
                        '仅监视发电机电压电流，不参与机组起停',
                        '只做报警，故障后仍需人工倒闸',
                        '只能管理一台发电机，多机并联必须人工操作',
                    ],
                    answer: 0,
                    analysis: '自动化电站对全船发电用电统一管理：负荷增大超过单机容量时自动起动备用机组并自动并车、均分负荷；负荷减小后自动解列并停机；母线失电时自动起动并合闸恢复供电；故障时按等级执行带电换机或断电切换。',
                },
            },
        ],
    },

    // ───────────────────────────────────────────────────────────
    // 1. 发电机组的自动并车、自动解列
    // ───────────────────────────────────────────────────────────
    'auto-parallel-decouple': {
        id: 'auto-parallel-decouple',
        name: '1. 发电机组的自动并车、自动解列',
        steps: [
            {
                msg: '第 1 步：起动系统，1# 机组单机向汇流排供电。',
                mode: 'check',
                op: _opsStartSupply(),
                check() {
                    const sys = _sysOf(this);
                    const g = _gen(this, 1);
                    return _wired(sys, 'gen1_wire_u', 'qf1_wire_t1')
                        && _qfState(this, 1) === 'on'
                        && !!g && g.isOn;
                },
            },
            {
                msg: '第 2 步：把电站切换为自动运行模式。',
                mode: 'check',
                op: _opsAutoMode(),
                check() {
                    const ac = _ac(this);
                    return !!ac && ac.isAuto() === true && ac.isPowered() === true;
                },
            },
            {
                msg: '第 3 步：负载加到 50 kW，2# 机组自动起动并车。',
                mode: 'check',
                op: [
                    {
                        type: 'load', target: 'load3', part: 'power',
                        msg: '打开参数界面，把负载功率改为 50 kW',
                        async act() { await _demoSetCfg(this, 'load3', 'powerKw', 50, '把三相负载有功功率改为 50 kW'); },
                    },
                    {
                        type: 'btn', target: 'load3', part: 'btn-load',
                        msg: '投入负载，负荷超过单机容量阈值',
                        async act() { await _loadOn(this); },
                    },
                    {
                        type: 'observe', target: 'genpanel2', part: 'lcd',
                        msg: '2# 机组自动起动、自动同期合闸、自动均分负荷',
                        async act() {
                            await _waitFor(_sysOf(this), s => {
                                const g = _comp(s, 'gen2'), q = _comp(s, 'qf2');
                                return !!g && g.isOn && !!q && q.getState() === 'on';
                            }, 90000, 200);
                            await _sleep(3000);      // 等待自动均分负荷稳定
                        },
                    },
                ],
                check() {
                    const g2 = _gen(this, 2), l = _load(this);
                    return _qfState(this, 2) === 'on' && _genOn(this, 2)
                        && !!l && l.isLoaded();
                },
            },
            {
                msg: '第 4 步：退出负载，2# 机组自动解列、自动停机。',
                mode: 'check',
                op: [
                    {
                        type: 'btn', target: 'load3', part: 'btn-unload',
                        msg: '退出负载，负荷低于解列阈值',
                        async act() { await _loadOff(this); },
                    },
                    {
                        type: 'observe', target: 'auto_ctl', part: 'lcd',
                        msg: '2# 自动转移负荷、自动分闸、自动停机',
                        async act() {
                            await _waitFor(_sysOf(this), s => {
                                const g = _comp(s, 'gen2'), q = _comp(s, 'qf2');
                                return !!q && q.getState() === 'off' && !!g && !g.isOn;
                            }, 120000, 200);
                        },
                    },
                ],
                check() {
                    return _qfState(this, 2) === 'off' && !_genOn(this, 2)
                        && _genOn(this, 1) && _qfState(this, 1) === 'on';
                },
            },
            {
                msg: '第 5 步：测试题：自动并车与自动解列的判据。',
                mode: 'quiz',
                quizConfig: {
                    question: '自动化电站依据什么决定是否自动并车（增开机组）或自动解列（停掉机组）？',
                    options: [
                        '按电网总负荷与单机容量的比较：负荷超过并车阈值（如单机额定容量的 60%）自动起动备用机组并车；负荷低于解列阈值后延时自动解列并停机',
                        '按电网电压高低决定，与负荷无关',
                        '由值班人员随时手动决定，自动电站不参与',
                        '按机组运行时间轮流切换，与负荷无关',
                    ],
                    answer: 0,
                    analysis: '自动电站连续采集母线总功率，与并车阈值（parallelKw）、解列阈值（decoupleKw）比较，并加入延时防止负荷波动引起频繁起停，从而实现按需增开/停用机组，兼顾供电可靠性与经济性。',
                },
            },
        ],
    },

    // ───────────────────────────────────────────────────────────
    // 2. Ⅰ级故障自动化电站带电换机
    // ───────────────────────────────────────────────────────────
    'lv1-fault-auto-switch': {
        id: 'lv1-fault-auto-switch',
        name: '2. Ⅰ级故障自动化电站带电换机',
        steps: [
            {
                msg: '第 1 步：起动系统，1# 机组单机向汇流排供电。',
                mode: 'check',
                op: _opsStartSupply(),
                check() {
                    const sys = _sysOf(this);
                    const g = _gen(this, 1);
                    return _wired(sys, 'gen1_wire_u', 'qf1_wire_t1')
                        && _qfState(this, 1) === 'on'
                        && !!g && g.isOn;
                },
            },
            {
                msg: '第 2 步：把电站切换为自动运行模式。',
                mode: 'check',
                op: _opsAutoMode(),
                check() {
                    const ac = _ac(this);
                    return !!ac && ac.isAuto() === true && ac.isPowered() === true;
                },
            },
            {
                msg: '第 3 步：设置 1# 机组Ⅰ级故障，观察自动换机。',
                mode: 'check',
                op: [
                    {
                        type: 'fault', fault: 'gen1_lv1_fault',
                        msg: '打开故障设置，勾选「1#机组Ⅰ级故障」并应用',
                        async act() { await _sleep(600); },
                    },
                    {
                        type: 'observe', target: 'auto_ctl', part: 'lcd',
                        msg: '2# 自动并车接带负荷，1# 自动解列停机',
                        async act() {
                            await _waitFor(_sysOf(this), s => {
                                const g1 = _comp(s, 'gen1'), g2 = _comp(s, 'gen2');
                                const q1 = _comp(s, 'qf1'), q2 = _comp(s, 'qf2');
                                return !!g1 && g1.hasLv1Fault() && !!g2 && g2.isOn
                                    && !!q2 && q2.getState() === 'on'
                                    && !!q1 && q1.getState() === 'off' && !g1.isOn;
                            }, 150000, 200);
                        },
                    },
                ],
                check() {
                    const g1 = _gen(this, 1), g2 = _gen(this, 2);
                    if (!g1 || !g2) return false;
                    if (!(g1.hasLv1Fault && g1.hasLv1Fault())) return false;   // Ⅰ级故障已设置
                    return g2.isOn && _qfState(this, 2) === 'on'               // 2# 接管供电
                        && _qfState(this, 1) === 'off' && !g1.isOn;            // 1# 已解列停机
                },
            },
            {
                msg: '第 4 步：测试题：Ⅰ级故障为何带电换机。',
                mode: 'quiz',
                quizConfig: {
                    question: '电站自动运行时，1# 机组发生Ⅰ级故障（滑油压力下降、冷却水温异常），自动化电站如何处理？',
                    options: [
                        'Ⅰ级故障为报警级：机组仍能运行但不宜继续带载。自动电站先起动备用机组并自动并车，把负荷全部转移给新机组，再自动解列并停掉故障机组，全船不停电',
                        'Ⅰ级故障仅报警，自动电站不做任何动作',
                        '立即保护停机并跳开主开关，全船失电',
                        '只发报警，等值班人员手动换机',
                    ],
                    answer: 0,
                    analysis: 'Ⅰ级故障尚未达到跳闸程度，具备"先并后解"的条件，因此自动电站执行带电换机：并车 → 转移负荷 → 解列 → 停机，做到故障机组不带病运行而全船供电不中断。',
                },
            },
        ],
    },

    // ───────────────────────────────────────────────────────────
    // 3. Ⅱ级故障自动化电站断电切换
    // ───────────────────────────────────────────────────────────
    'lv2-fault-power-switch': {
        id: 'lv2-fault-power-switch',
        name: '3. Ⅱ级故障自动化电站断电切换',
        steps: [
            {
                msg: '第 1 步：起动系统，1# 机组单机向汇流排供电。',
                mode: 'check',
                op: _opsStartSupply(),
                check() {
                    const sys = _sysOf(this);
                    const g = _gen(this, 1);
                    return _wired(sys, 'gen1_wire_u', 'qf1_wire_t1')
                        && _qfState(this, 1) === 'on'
                        && !!g && g.isOn;
                },
            },
            {
                msg: '第 2 步：把电站切换为自动运行模式。',
                mode: 'check',
                op: _opsAutoMode(),
                check() {
                    const ac = _ac(this);
                    return !!ac && ac.isAuto() === true && ac.isPowered() === true;
                },
            },
            {
                msg: '第 3 步：设置 1# 机欠压故障，观察断电切换。',
                mode: 'check',
                op: [
                    {
                        type: 'fault', fault: 'gen1_undervoltage',
                        msg: '打开故障设置，勾选「1#机欠压故障」并应用',
                        async act() { await _sleep(600); },
                    },
                    {
                        type: 'observe', target: 'qf1', part: 'uv-trip',
                        msg: '1# 主开关欠压保护跳闸，母线失电',
                        async act() {
                            await _waitFor(_sysOf(this), s => {
                                const q = _comp(s, 'qf1');
                                return !!q && q.getState() === 'off';
                            }, 20000, 200);
                        },
                    },
                    {
                        type: 'observe', target: 'genpanel2', part: 'lcd',
                        msg: '2# 备用机组自动起动、自动合闸恢复供电',
                        async act() {
                            await _waitFor(_sysOf(this), s => {
                                const g = _comp(s, 'gen2'), q = _comp(s, 'qf2');
                                return !!g && g.isOn && !!q && q.getState() === 'on';
                            }, 120000, 200);
                        },
                    },
                ],
                check() {
                    const g1 = _gen(this, 1);
                    if (!g1) return false;
                    if (!g1._faultAVR) return false;                        // 欠压故障已设置
                    return _qfState(this, 1) === 'off'                      // 故障机组已跳闸
                        && _genOn(this, 2) && _qfState(this, 2) === 'on';   // 2# 恢复供电
                },
            },
            {
                msg: '第 4 步：测试题：Ⅱ级故障为何断电切换。',
                mode: 'quiz',
                quizConfig: {
                    question: '1# 机组发生Ⅱ级故障（欠压或机械故障）后，自动化电站采用"断电切换"而不是"带电换机"，原因是什么？',
                    options: [
                        'Ⅱ级故障本身就会使故障机组停机或主开关保护跳闸，母线必然失电；故障机组已不能继续带载，只能先断电、再由备用机组自动起动合闸恢复供电',
                        '自动电站不具备带电并车功能，所以只能断电起动备用机组',
                        'Ⅱ级故障不会导致跳闸或失电，切换时母线始终有电',
                        '断电切换是为了保护用电设备，与故障性质无关',
                    ],
                    answer: 0,
                    analysis: '欠压使主开关欠压保护延时跳闸；超速/滑油低压/冷却水温高使原动机保护停机，并网运行时发电机被母线反拖而逆功率跳闸——母线失电不可避免，因此只能是"先断电、后供电"的断电切换。',
                },
            },
        ],
    },

    // ───────────────────────────────────────────────────────────
    // 4. 重载询问功能实操
    // ───────────────────────────────────────────────────────────
    'heavyload-inquiry-practice': {
        id: 'heavyload-inquiry-practice',
        name: '4. 重载询问功能实操',
        steps: [
            {
                msg: '第 1 步：自动接线、复位电站，转自动后 1# 自动起动供电。',
                mode: 'check',
                op: [
                    {
                        type: 'wire', button: 'btnAutoWire',
                        msg: '点击「自动接线」，并复位电站（两机停机、主开关分闸）',
                        async act() {
                            await _toolbarBtn('btnAutoWire');
                            await _resetRig(this);
                        },
                    },
                    {
                        type: 'switch', target: 'auto_ctl', part: 'knob-mode',
                        msg: '把「手动/自动」转换开关打到自动位',
                        async act() { await _setAutoMode(this, true); },
                    },
                    {
                        type: 'observe', target: 'genpanel', part: 'lcd',
                        msg: '母线失电，自动起动 1# 机组并合闸供电',
                        async act() {
                            await _waitFor(_sysOf(this), s => {
                                const g = _comp(s, 'gen1'), q = _comp(s, 'qf1');
                                return !!g && g.isOn && !!q && q.getState() === 'on';
                            }, 90000, 200);
                        },
                    },
                ],
                check() {
                    const ac = _ac(this);
                    return !!ac && ac.isAuto() === true && ac.isPowered() === true
                        && _genOn(this, 1) && _qfState(this, 1) === 'on'
                        && typeof ac.getBusLive === 'function' && ac.getBusLive();
                },
            },
            {
                msg: '第 2 步：调出重载询问面板，选择开关打到「重载询问」。',
                mode: 'check',
                op: [
                    {
                        type: 'instrument', checkbox: 'heavyLoadShow',
                        msg: '勾选「重载询问面板」，调出面板并自动接线',
                        async act() { await _showHeavyPanel(this, true); },
                    },
                    {
                        type: 'knob', target: 'heavyload', part: 'knob',
                        msg: '选择开关打到「重载询问」档',
                        async act() { await _setHeavyMode(this, 'inquiry'); },
                    },
                ],
                check() {
                    const hv = _hv(this);
                    if (!hv || !hv.group || hv.group.visible() !== true) return false;
                    if (!hv.isModeDirect || hv.isModeDirect()) return false;   // 已切到重载询问档
                    return typeof hv._commConnected === 'function' && hv._commConnected();
                },
            },
            {
                msg: '第 3 步：按「起动/询问」，2# 自动并车后回应转绿。',
                mode: 'check',
                op: [
                    {
                        type: 'btn', target: 'heavyload', part: 'btn',
                        msg: '按「起动/询问」发出询问请求',
                        async act() { await _clickPart(_hv(this), 'btn', 400); },
                    },
                    {
                        type: 'observe', target: 'heavyload', part: 'led-resp',
                        msg: '回应灯转黄（等待）：2# 自动起动并车',
                        async act() {
                            await _waitFor(_sysOf(this), s => {
                                const g = _comp(s, 'gen2'), q = _comp(s, 'qf2');
                                return !!g && g.isOn && !!q && q.getState() === 'on';
                            }, 120000, 200);
                        },
                    },
                    {
                        type: 'observe', target: 'heavyload', part: 'led-resp',
                        msg: '并车成功，回应灯转绿（允许起动）',
                        async act() {
                            const hv = _hv(this);
                            await _waitFor(_sysOf(this), s => {
                                const c = _comp(s, 'heavyload');
                                return !!c && c.getResponse() === 'allow';
                            }, 60000, 200);
                            await _sleep(400);
                        },
                    },
                ],
                check() {
                    const hv = _hv(this);
                    if (!hv || !hv.isInquirying()) return false;
                    if (hv.getResponse() !== 'allow') return false;
                    return _genOn(this, 2) && _qfState(this, 2) === 'on';
                },
            },
            {
                msg: '第 4 步：再按一次按钮，侧推器起动并均分负荷。',
                mode: 'check',
                op: [
                    {
                        type: 'btn', target: 'heavyload', part: 'btn',
                        msg: '再按「起动/询问」，已获允许 → 负载起动',
                        async act() { await _clickPart(_hv(this), 'btn', 400); },
                    },
                    {
                        type: 'observe', target: 'auto_ctl', part: 'lcd',
                        msg: '两台机组自动均分负荷（功率接近）',
                        async act() {
                            const g1 = _gen(this, 1), g2 = _gen(this, 2);
                            await _waitFor(_sysOf(this), () => {
                                const p1 = (g1 && g1._displayP) || 0;
                                const p2 = (g2 && g2._displayP) || 0;
                                return p1 > 5 && p2 > 5 && Math.abs(p1 - p2) < 12;
                            }, 60000, 200);
                            await _sleep(1200);
                        },
                    },
                ],
                check() {
                    const hv = _hv(this), g1 = _gen(this, 1), g2 = _gen(this, 2);
                    if (!hv || !hv.isRunning()) return false;
                    const p1 = (g1 && g1._displayP) || 0, p2 = (g2 && g2._displayP) || 0;
                    return p1 > 1 && p2 > 1 && Math.abs(p1 - p2) < 12;
                },
            },
            {
                msg: '第 5 步：按「停止」，2# 自动解列停机，1# 单机供电。',
                mode: 'check',
                op: [
                    {
                        type: 'btn', target: 'heavyload', part: 'btn-stop',
                        msg: '按「停止」，侧推器重载退出',
                        async act() { await _clickPart(_hv(this), 'btn-stop', 400); },
                    },
                    {
                        type: 'observe', target: 'auto_ctl', part: 'lcd',
                        msg: '2# 自动分闸解列、自动停机，1# 继续供电',
                        async act() {
                            await _waitFor(_sysOf(this), s => {
                                const g = _comp(s, 'gen2'), q = _comp(s, 'qf2');
                                return !!q && q.getState() === 'off' && !!g && !g.isOn;
                            }, 150000, 200);
                        },
                    },
                ],
                check() {
                    const hv = _hv(this);
                    if (!hv || hv.isRunning()) return false;
                    return _qfState(this, 2) === 'off' && !_genOn(this, 2)
                        && _genOn(this, 1) && _qfState(this, 1) === 'on';
                },
            },
            {
                msg: '第 6 步：测试题：重载询问的定义。',
                mode: 'quiz',
                quizConfig: {
                    question: '船舶电站中的"重载询问"（侧推器重载询问）是指什么？',
                    options: [
                        '大功率负载起动前先向自动化电站发出询问：单机在网时电站在应答"等待"期间自动并车备用机组，并车成功、容量足够后改答"允许"，负载才允许起动，避免起动冲击造成过载或失电',
                        '负载起动前由值班人员口头确认，电站不参与',
                        '负载直接起动，靠发电机过载能力硬扛冲击',
                        '重载询问是运行中随机发出的报警信号，与机组控制无关',
                    ],
                    answer: 0,
                    analysis: '侧推器功率大，若电网容量不足直接起动，起动电流会造成电压频率跌落甚至全船失电。因此面板先"询问"，电站在并联时直接应答允许、单机时强制并车后再应答允许，负载接到允许才起动，实现大负载安全投入并自动均分负荷。',
                },
            },
        ],
    },
};

// ═══════════════════════════════════════════════════════════════
// 五、元件布局
// ═══════════════════════════════════════════════════════════════

export const componentConfigs = [
    // ── 1# 机组：同步发电机 → 主开关 → 汇流排 ──
    { Class: SyncGenerator3P, id: 'gen1', x: -100, y: 700, vRms: 230, freq: 50, isOn: false, mode: 'remote', label: '1#同步发电机', ratedPower: 80, ratedVoltage: 400, ratedCosPhi: 0.8, maxDropV: 200, avrMaxComp: 1, avrDelay: 2, avrTime: 5, autoDecoupleTrim: true, visible: true },
    { Class: MarineMainsSwitch, id: 'qf1', x: -180, y: 180, ratedCtrlVoltage: 24, label: '1#主开关', genId: 'gen1', revPowerKw: 8, revTime: 5, faultSimpleProtect: true, visible: true },
    { Class: GeneratorRemotePanel, id: 'genpanel', x: 330, y: 700, genId: 'gen1', qfId: 'qf1', label: '1#发电机组遥控面板', busId: 'bus1', visible: true },

    // ── 2# 机组：同步发电机 → 主开关 → 汇流排 ──
    { Class: SyncGenerator3P, id: 'gen2', x: 850, y: 700, vRms: 230, freq: 50, isOn: false, mode: 'remote', label: '2#同步发电机', ratedPower: 80, ratedVoltage: 400, ratedCosPhi: 0.8, maxDropV: 200, avrMaxComp: 1, avrDelay: 2, avrTime: 5, autoDecoupleTrim: true, visible: true },
    { Class: MarineMainsSwitch, id: 'qf2', x: 1100, y: 180, ratedCtrlVoltage: 24, label: '2#主开关', genId: 'gen2', revPowerKw: 8, revTime: 5, faultSimpleProtect: true, visible: true },
    { Class: GeneratorRemotePanel, id: 'genpanel2', x: 1300, y: 700, genId: 'gen2', qfId: 'qf2', label: '2#发电机组遥控面板', busId: 'bus1', visible: true },
    { Class: DCPower, id: 'dc_uv2', x: 1580, y: 750, voltage: 24, isOn: true, label: '失压脱扣电源2', visible: true },

    // ── 汇流排：8 口/相（第 5 口接侧推器、第 6 口接负载、第 7 口接 2# 主开关、第 8 口接馈出支路）──
    { Class: Busbar3P, id: 'bus1', x: 220, y: 30, portsPerBar: 8, label: '汇流排', visible: true },
    { Class: Ground, id: 'gnd1', x: 1080, y: 600, visible: true },

    // ── 1# 机组接地（控制电源共地 / 线圈接地 / 信号接地）──
    { Class: Ground, id: 'gnd1_uv', x: 590, y: 1000, label: '控制电源接地', visible: true },
    { Class: Ground, id: 'gnd1_qf', x: 345, y: 465, label: '线圈接地', visible: true },
    { Class: Ground, id: 'gnd1_panel', x: 530, y: 670, label: '信号接地', visible: true },

    // ── 2# 机组接地 ──
    { Class: Ground, id: 'gnd2_uv', x: 1560, y: 990, label: '控制电源接地', visible: true },
    { Class: Ground, id: 'gnd2_qf', x: 1606, y: 459, label: '线圈接地', visible: true },
    { Class: Ground, id: 'gnd2_panel', x: 1470, y: 660, label: '信号接地', visible: true },

    // ── 三相可调负载：汇流排第6口直连，N 端接 gnd1 接地参考 ──
    { Class: ThreePhaseLoad, id: 'load3', x: 1050, y: 180, powerKw: 20, cosPhi: 1, reactive: 'ind', loaded: false, label: '三相可调负载', visible: true },

    // ── 重载询问---侧推器：与 load3 同位置、默认隐藏（工具栏「重载询问面板」复选框控制显隐）──
    { Class: HeavyLoadInquiry, id: 'heavyload', x: 1050, y: 180, powerKw: 45, mode: 'direct', loaded: false, label: '重载询问---侧推器', visible: false },

    // ── 船舶电站自动控制模块（自动化电站）：默认手动，演示中切自动 ──
    { Class: ShipAutoControl, id: 'auto_ctl', x: 600, y: 180, genIds: 'gen1,gen2', qfIds: 'qf1,qf2', panelIds: 'genpanel,genpanel2', auto: 'manual', seq: '123', parallelKw: 60, decoupleKw: 28, label: '船舶电站自动控制模块', visible: true },

    // ── 控制电源（DC 24V）：失压脱扣线圈 ──
    { Class: DCPower, id: 'dc_uv', x: 600, y: 750, voltage: 24, isOn: true, label: '失压脱扣电源', visible: true },

    // ── 汇流排馈出支路：QF3 → 三盏白炽灯（L1/L2/L3 各一）──
    { Class: DiagramThreePhaseACB, id: 'acb_l', x: 1826, y: 80, initState: 'on', label: 'QF3', ratedVoltage: 380, ratedCurrent: 100, tripCurrent: 10, visible: true },
    { Class: IncandescentLamp, id: 'lamp1', x: 1850, y: 770, coldResistance: 7.5, rotation: 90 },
    { Class: IncandescentLamp, id: 'lamp2', x: 1920, y: 770, coldResistance: 7.5, rotation: 90 },
    { Class: IncandescentLamp, id: 'lamp3', x: 1990, y: 770, coldResistance: 7.5, rotation: 90 },
    { Class: Ground, id: 'gnd_l', x: 1950, y: 890, visible: true },

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
// 六、自动接线（本电路 60+ 根，> 8 根，允许瞬时接线）
// ═══════════════════════════════════════════════════════════════

function _autoWire(sys) {
    sys.conns.length = 0;
    const cons = [
        // ── 主回路：1# 机组 → 汇流排第1口 ──
        { from: 'gen1_wire_u', to: 'qf1_wire_t1', type: 'wire' },
        { from: 'gen1_wire_v', to: 'qf1_wire_t2', type: 'wire' },
        { from: 'gen1_wire_w', to: 'qf1_wire_t3', type: 'wire' },
        { from: 'qf1_wire_l1', to: 'bus1_wire_l1_1', type: 'wire' },
        { from: 'qf1_wire_l2', to: 'bus1_wire_l2_1', type: 'wire' },
        { from: 'qf1_wire_l3', to: 'bus1_wire_l3_1', type: 'wire' },

        // ── 馈出支路：汇流排第8口 → QF3 → 三盏白炽灯 → 接地 ──
        { from: 'bus1_wire_l1_8', to: 'acb_l_wire_l1', type: 'wire' },
        { from: 'bus1_wire_l2_8', to: 'acb_l_wire_l2', type: 'wire' },
        { from: 'bus1_wire_l3_8', to: 'acb_l_wire_l3', type: 'wire' },
        { from: 'acb_l_wire_t1', to: 'lamp1_wire_l', type: 'wire' },
        { from: 'acb_l_wire_t2', to: 'lamp2_wire_l', type: 'wire' },
        { from: 'acb_l_wire_t3', to: 'lamp3_wire_l', type: 'wire' },
        { from: 'lamp1_wire_r', to: 'gnd_l_wire_gnd', type: 'wire' },
        { from: 'lamp2_wire_r', to: 'gnd_l_wire_gnd', type: 'wire' },
        { from: 'lamp3_wire_r', to: 'gnd_l_wire_gnd', type: 'wire' },

        // ── 主回路：2# 机组 → 汇流排第7口 ──
        { from: 'gen2_wire_u', to: 'qf2_wire_t1', type: 'wire' },
        { from: 'gen2_wire_v', to: 'qf2_wire_t2', type: 'wire' },
        { from: 'gen2_wire_w', to: 'qf2_wire_t3', type: 'wire' },
        { from: 'qf2_wire_l1', to: 'bus1_wire_l1_7', type: 'wire' },
        { from: 'qf2_wire_l2', to: 'bus1_wire_l2_7', type: 'wire' },
        { from: 'qf2_wire_l3', to: 'bus1_wire_l3_7', type: 'wire' },

        // ── 三相可调负载：汇流排第6口三相直连，N 端接地参考 ──
        { from: 'bus1_wire_l1_6', to: 'load3_wire_l1', type: 'wire' },
        { from: 'bus1_wire_l2_6', to: 'load3_wire_l2', type: 'wire' },
        { from: 'bus1_wire_l3_6', to: 'load3_wire_l3', type: 'wire' },
        { from: 'load3_wire_n', to: 'gnd1_wire_gnd', type: 'wire' },

        // ── 2# 机组控制电源与线圈 ──
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

        // ── 1# 机组控制电源与线圈 ──
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

        // ── 自动化电站（auto_ctl）──
        // 母线采集：汇流排第4口 L1/L2 → 判断母线带电
        { from: 'bus1_wire_l1_4', to: 'auto_ctl_wire_bus_a', type: 'wire' },
        { from: 'bus1_wire_l2_4', to: 'auto_ctl_wire_bus_b', type: 'wire' },
        // 24V 工作电源
        { from: 'dc_uv_wire_p', to: 'auto_ctl_wire_p24_p', type: 'wire' },
        { from: 'gnd1_wire_gnd', to: 'auto_ctl_wire_p24_n', type: 'wire' },
        // 通信：comm1 ↔ 1# 面板，comm2 ↔ 2# 面板
        { from: 'auto_ctl_wire_comm1_a', to: 'genpanel_wire_com_a', type: 'wire' },
        { from: 'auto_ctl_wire_comm1_b', to: 'genpanel_wire_com_b', type: 'wire' },
        { from: 'auto_ctl_wire_comm2_a', to: 'genpanel2_wire_com_a', type: 'wire' },
        { from: 'auto_ctl_wire_comm2_b', to: 'genpanel2_wire_com_b', type: 'wire' },
    ];
    cons.forEach(c => sys.connMgr.addConn(c));
    sys.redrawAll();
}

// ─── 重载询问（heavyload）面板接线：显隐时自动连/删的 6 条线 ───
// 与 main.js 的 HEAVYLOAD_WIRES 保持一致：
// 顶部三相 L1/L2/L3 ← bus1 第 5 口；N ← gnd1；左侧通信 heavy_a/heavy_b ↔ auto_ctl
const HEAVY_WIRES = [
    { from: 'bus1_wire_l1_5', to: 'heavyload_wire_l1', type: 'wire' },
    { from: 'bus1_wire_l2_5', to: 'heavyload_wire_l2', type: 'wire' },
    { from: 'bus1_wire_l3_5', to: 'heavyload_wire_l3', type: 'wire' },
    { from: 'heavyload_wire_n', to: 'gnd1_wire_gnd', type: 'wire' },
    { from: 'auto_ctl_wire_heavy_a', to: 'heavyload_wire_heavy_a', type: 'wire' },
    { from: 'auto_ctl_wire_heavy_b', to: 'heavyload_wire_heavy_b', type: 'wire' },
];
const _heavyChecked = () => {
    const cb = document.getElementById('heavyLoadShow');
    return !!(cb && cb.checked);
};
const _syncHeavyWires = (sys, on) => {
    if (!sys || !sys.connMgr) return;
    if (on) HEAVY_WIRES.forEach(c => sys.connMgr.addConn(c));
    else HEAVY_WIRES.forEach(c => sys.connMgr.removeConn(c));
};

// ═══════════════════════════════════════════════════════════════
// 七、工程导出
// ═══════════════════════════════════════════════════════════════

export function initSlider(_sys) {
}

/** 自动接线：初始化（opts.init=true）时不预接线（画布默认无接线） */
export function applyAllPresets(opts) {
    if (opts && opts.init) return;
    const sys = this && this.sys ? this.sys : window.sys;
    if (!sys) return;
    _autoWire(sys);
    if (_heavyChecked()) _syncHeavyWires(sys, true);   // 面板已调出时补回其 6 根线
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
        await _startGen(ctx, 1);
        await _closeQf(ctx, 1);
        if (_heavyChecked()) _syncHeavyWires(sys, true);
    } catch (e) {
        console.warn('[起动系统] 执行异常：', e);
    }
}

export function fiveStep() {
}
