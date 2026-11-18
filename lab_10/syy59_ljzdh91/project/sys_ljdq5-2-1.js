// 主开关跳闸的应急处理仿真工程
// （两台同步发电机 + 两台船用框架式空气断路器主开关 + 汇流排 + 数字同步表 + 遥控面板）
//
// 教学主线：机械故障 / 过载 / 逆功率 / 欠压 / 干线短路 五类原因造成主开关跳闸后，
//          如何判断、如何应急恢复供电、如何排除故障后复位。
//
// 电路组成（单页工程，全部元件同屏）：
//   1#机组  gen1（80 kW 同步发电机）→ qf1 主开关 → bus1 汇流排第 1 列
//   2#机组  gen2（80 kW 同步发电机）→ qf2 主开关 → bus1 汇流排第 7 列
//   馈出    bus1 第 8 列 → acb_l（QF3）→ lamp1~3 三盏白炽灯
//   负载    bus1 第 5 列 → load3 三相可调负载（默认 20 kW，可在参数界面改）
//   测量    sync1 数字同步表：bus=汇流排 A 相、gen=待并机 A 相（经 sync_sel）、gnd=船体地
//   选择    sync_sel 单刀四掷：1=OFF、2=1#机、3=2#机、4=预留
//   控制    dc_uv / dc_uv2（DC 24 V）→ 失压脱扣线圈、储能电机、合闸/分励线圈
//           genpanel / genpanel2 发电机组遥控面板 → 遥控起动/停止、调速、合闸/分闸
//
// 主开关保护（qf1 / qf2 内置，faultSimpleProtect=true）：
//   · 过载：本机发电机输出 > 额定 ×120%（96 kW）持续 15 s → 延时跳闸（发电机不停机）
//   · 欠压：端子电压 < 额定 ×85% 持续 2 s → 延时跳闸（发电机可仍在运行）
//   · 干线短路：汇流排短路标记存在 → 瞬时跳闸
//   · 逆功率：待并机原动机故障被母线拖转，逆功率 > 8 kW 持续 5 s → 延时跳闸
//   · 频差 / 非同期：并车合闸时频差 > ±0.5 Hz 或相位落在 60°~270° → 跳闸
//
// 约定（与全局 AGENTS.md「最新范式」一致）：
//   · 单页工程：不导出 PROJECT_PAGES，consys.js 不创建 PageManager，工作流无 page op
//   · 默认不接线：applyAllPresets({init:true}) 不接线；只有「自动接线 / 起动系统 / 工作流 op」才接线
//   · 故障一律走「故障设置」界面（op.type='fault'），不直接改组件故障标志
//   · 按钮/旋钮/开关一律模拟真实操作（getClickablePartNode(...).fire('mousedown'/'mouseup'/'click')）
//   · 参数（负载功率）一律走参数配置界面（_demoSetCfg），不直接赋字段
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
// 一、故障（一律由「故障设置」界面触发/修复）
// ═══════════════════════════════════════════════════════════════

const _fcomp = (id) => (window.sys && window.sys.comps) ? window.sys.comps[id] : null;

export const FAULT_CONFIGS = {
    // 1#机超速故障：原动机超速保护动作，立即停机；单机运行时失压 → 主开关欠压跳闸
    gen1_overspeed: {
        id: 'gen1_overspeed',
        name: '1#机超速故障',
        system: '发电机原动机',
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
        system: '发电机原动机',
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
    // 1#机冷却水温高：并网运行时原动机停机、发电机被母线拖转（逆功率）；
    // 单机运行时停机，母线失压后主开关欠压保护跳闸
    gen1_coolant_temp: {
        id: 'gen1_coolant_temp',
        name: '1#机冷却水温高故障',
        system: '发电机原动机',
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
    // 主开关欠压保护检测到端子欠压后 2 s 延时跳闸（发电机仍在运行）
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
    // 汇流排干线短路故障：主开关短路保护瞬时跳闸，全船失电
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
const _sel = (ctx) => _comp(_sysOf(ctx), 'sync_sel');
const _sc = (ctx) => _comp(_sysOf(ctx), 'sync1');
const _load = (ctx) => _comp(_sysOf(ctx), 'load3');
const _bus = (ctx) => _comp(_sysOf(ctx), 'bus1');

/** 条件轮询等待（不写死 sleep 猜时间） */
async function _waitFor(sys, cond, timeout = 6000, interval = 100) {
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
async function _waitQf(ctx, qfId, want = 'off', timeout = 8000) {
    const sys = _sysOf(ctx);
    const ok = await _waitFor(sys, s => {
        const q = _comp(s, qfId);
        return !!q && q.getState() === want;
    }, timeout, 100);
    await _sleep(400);
    return ok;
}

/** 发电机组遥控面板按钮（合闸/分闸/起动/停止）——真实按压，取不到节点时兜底 */
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

/** 轻推调速旋钮（升速 / 降速），按住若干毫秒后松开 */
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

/**
 * 遥控调速：把某台机的调速器设定值调到 target（Hz）。
 * 用「短按旋钮 + 每次重新判方向」的闭环，避免长按过冲后回不来。
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

/** 调速（相对电网）：把待并机调到「电网频率 + delta」 */
async function _setFreqRelTo(ctx, panelId, genId, delta, tol = 0.05) {
    for (let k = 0; k < 5; k++) {
        const base = await _gridFreq(ctx);
        await _setFreqTo(ctx, panelId, genId, base + delta, 0.02);
        await _sleep(1200);                 // 等调速二阶动态收敛
        const sc = _sc({ sys: _sysOf(ctx) });
        if (!sc) return false;
        const d = sc._fGen - sc._fBus;
        if (Math.abs(d - delta) <= tol) return true;
    }
    return false;
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
    return _waitFor(sys, s => { const q = _comp(s, qfId); return !!q && q.isCharged(); }, timeout);
}

/** 遥控合闸：等储能到位 → 按面板「合闸」→ 等主触头闭合 */
async function _closeViaPanel(ctx, panelId, qfId) {
    const sys = _sysOf(ctx);
    const q = _comp(sys, qfId);
    if (!q) return false;
    await _waitCharged(ctx, qfId);
    await _panelPress(ctx, panelId, 'btn-close', 900);
    const ok = await _waitQf(ctx, qfId, 'on', 6000);
    await _sleep(500);
    return ok;
}

/** 遥控分闸：按面板「分闸」→ 等主触头断开 */
async function _openViaPanel(ctx, panelId, qfId) {
    const sys = _sysOf(ctx);
    const q = _comp(sys, qfId);
    if (!q || q.getState() !== 'on') return true;
    await _panelPress(ctx, panelId, 'btn-open', 700);
    const ok = await _waitQf(ctx, qfId, 'off', 6000);
    await _sleep(500);
    return ok;
}

/** 主开关本体「手动分闸」按钮（复位用） */
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
    const ok = await _waitQf(ctx, qfId, 'off', 6000);
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

/** 三相可调负载加载/卸载（模拟按下负载面板按钮） */
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

/**
 * 通过「参数配置界面」修改参数（硬性规范）：
 *   ① 弹框前把实时属性同步进 config 副本（否则「保存」会把旧值回写）
 *   ② comp.showConfigDialog() 弹出界面
 *   ③ #diag_<key> 输入框闪烁高亮 → 填值
 *   ④ 高亮并真正 click() 最后一个「保存」按钮
 *   ⑤ 对话框未关闭则点「关闭/取消」；最后做生效兜底
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
        if (typeof wf._flashDomElement === 'function') await wf._flashDomElement(input, tip || `把该参数改为 ${value}`, 2400);
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

    // 生效兜底：保存未生效则直接走组件配置接口，保证演示不中断
    if (Math.round(parseFloat(comp[key])) !== Math.round(parseFloat(value))) {
        if (typeof comp.onConfigUpdate === 'function') comp.onConfigUpdate({ [key]: value });
        try { comp[key] = value; } catch (e) { /* 只读属性忽略 */ }
    }
}

/** 实际输出频率（含下垂） */
function _fOut(g) {
    if (!g) return 0;
    return (typeof g._freqOut === 'number' && isFinite(g._freqOut)) ? g._freqOut : g.freq;
}

/** 等单机频率稳定（连续 4 次采样基本不变）后返回该频率 */
async function _gridFreq(ctx, timeout = 8000) {
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

/** 步骤级标记（"按下 → 现象 → 松开后消失"的操作，供 check 兜底） */
function _flag(ctx, key, value) {
    if (!ctx) return false;
    if (!ctx._projFlag) ctx._projFlag = {};
    if (value === undefined) return !!ctx._projFlag[key];
    ctx._projFlag[key] = value;
    return true;
}

/** 接线是否已建立（用于 check 判定主回路/控制回路已接） */
function _wired(sys, a, b) {
    return !!(sys && Array.isArray(sys.conns) && sys.conns.some(c =>
        c && c.type === 'wire' && ((c.from === a && c.to === b) || (c.from === b && c.to === a))));
}

/**
 * 复位时清理残留故障：上一任务留下的故障会让机组起不来。
 * 同样走「故障设置」界面（取消勾选 → 应用设置），不直接改组件故障标志。
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

/** 完整复位：清残留故障 → 卸负载 → 分闸 → 停机 → 选择开关 OFF → 频率回 50 Hz */
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
// 三、常用步骤片段
// ═══════════════════════════════════════════════════════════════

/** 「自动接线 + 复位」子操作 */
function _opsPrepare() {
    return [
        {
            type: 'wire', button: 'btnAutoWire', msg: '点击工具栏「自动接线」',
            async act() { await _autoWireBtn(this); },
        },
        {
            type: 'observe', target: 'genpanel', msg: '复位：两机停机、两只主开关分闸、负载卸载',
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

/** 「起动 2# 机 → 调频 → 看相位 → 并车合闸」子操作 */
function _opsGen2Parallel(selPos = 3) {
    return [
        {
            type: 'knob', target: 'sync_sel', part: 'sel-knob', msg: '选择开关扳到 2# 档，合闸联锁放行',
            async act() { await _selTo(this, selPos); },
        },
        {
            type: 'btn', target: 'genpanel2', part: 'btn-start', msg: '按 2# 面板「起动」',
            async act() { await _startGen(this, 'genpanel2', 'gen2'); },
        },
        {
            type: 'knob', target: 'genpanel2', part: 'knob-inc', msg: '调速旋钮把 2# 机频率调到略高于电网',
            async act() { await _setFreqRelTo(this, 'genpanel2', 'gen2', 0.2, 0.06); },
        },
        {
            type: 'observe', target: 'sync1', msg: '同步表相位差进入允许并车的窗口',
            async act() { await _waitPhaseOK(this); },
        },
        {
            type: 'btn', target: 'genpanel2', part: 'btn-close', msg: '相位合适时按「合闸」并车',
            async act() { await _closeViaPanel(this, 'genpanel2', 'qf2'); },
        },
    ];
}

// ═══════════════════════════════════════════════════════════════
// 四、工作流
// ═══════════════════════════════════════════════════════════════

export const PROJECT_WORKFLOWS = {
    // ───────────────────────────────────────────────────────────
    'mech-trip-recovery': {
        id: 'mech-trip-recovery',
        name: '1.机械故障导致主开关跳闸的应急处理',
        steps: [
            {
                msg: '第 1 步：识别 1# 主开关的主触头。',
                mode: 'find', target: 'qf1', subTarget: 'main-contact',
            },
            {
                msg: '第 2 步：点击「自动接线」后复位到停机状态。',
                mode: 'check',
                op: _opsPrepare(),
                check() {
                    const sys = _sysOf(this);
                    return _wired(sys, 'gen1_wire_u', 'qf1_wire_t1')
                        && _wired(sys, 'genpanel_wire_p24_p', 'dc_uv_wire_p')
                        && _qf(this, 'qf1').getState() === 'off'
                        && _qf(this, 'qf2').getState() === 'off'
                        && !_g1(this).isOn && !_g2(this).isOn && _sel(this).getPosition() === 1;
                },
            },
            {
                msg: '第 3 步：遥控起动 1# 发电机，合闸供电。',
                mode: 'check',
                op: _opsGen1Supply(),
                check() {
                    return !!_g1(this).isOn && _qf(this, 'qf1').getState() === 'on';
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
                    return !!(f.overspeed || f.oilPress || f.coolantTemp)
                        && !_g1(this).isOn
                        && _qf(this, 'qf1').getState() === 'off';
                },
            },
            {
                msg: '第 5 步：测试题——全船失电的应急处理原则。',
                mode: 'quiz',
                quizConfig: {
                    question: '主开关因机械故障跳闸造成全船失电，应急处理的正确顺序是（　）。',
                    options: [
                        '先起动备用机组恢复供电、接通重要负载，再查明并排除故障',
                        '先查明并彻底排除故障，再恢复供电',
                        '立即反复强行合闸，直到合上为止',
                        '先断开全部负载，等待电网自行恢复',
                    ],
                    answer: 0,
                    analysis: '全船失电时船舶失去动力与照明，首要任务是尽快恢复供电。应迅速起动备用机组、接通重要负载，同时组织排查故障；因原动机故障未排除前机组起不来，强行合闸也不会有电压。',
                },
            },
            {
                msg: '第 6 步：起动 2# 机组，合闸恢复全船供电。',
                mode: 'check',
                op: [
                    {
                        type: 'knob', target: 'sync_sel', part: 'sel-knob', msg: '选择开关扳到 2# 档',
                        async act() { await _selTo(this, 3); },
                    },
                    {
                        type: 'btn', target: 'genpanel2', part: 'btn-start', msg: '按 2# 面板「起动」',
                        async act() { await _startGen(this, 'genpanel2', 'gen2'); },
                    },
                    {
                        type: 'btn', target: 'genpanel2', part: 'btn-close', msg: '按 2# 面板「合闸」恢复供电',
                        async act() { await _closeViaPanel(this, 'genpanel2', 'qf2'); },
                    },
                ],
                check() {
                    return !!_g2(this).isOn && _qf(this, 'qf2').getState() === 'on';
                },
            },
            {
                msg: '第 7 步：测试题——机械故障跳闸后能否直接合闸。',
                mode: 'quiz',
                quizConfig: {
                    question: '原动机故障导致主开关跳闸后，能否像过载跳闸那样直接合闸？',
                    options: [
                        '不能，原动机已停机、母线无电压，必须先由备用机组供电',
                        '能，只要主开关储能到位就能合上',
                        '能，合闸后原动机就会自动恢复运行',
                        '不能，必须先更换主开关',
                    ],
                    answer: 0,
                    analysis: '原动机故障停机后发电机不再建压，母线失压使主开关欠压保护跳闸。此时合闸也没有电源，必须先起动备用机组供电，并排除原动机故障后才能重新并网。',
                },
            },
        ],
    },

    // ───────────────────────────────────────────────────────────
    'overload-trip-recovery': {
        id: 'overload-trip-recovery',
        name: '2.过载故障导致主开关跳闸的应急处理',
        steps: [
            {
                msg: '第 1 步：识别三相可调负载的「加载」按钮。',
                mode: 'find', target: 'load3', subTarget: 'btn-load',
            },
            {
                msg: '第 2 步：点击「自动接线」后复位，起动 1# 机供电。',
                mode: 'check',
                op: [..._opsPrepare(), ..._opsGen1Supply()],
                check() {
                    const sys = _sysOf(this);
                    return _wired(sys, 'gen1_wire_u', 'qf1_wire_t1')
                        && !!_g1(this).isOn && _qf(this, 'qf1').getState() === 'on';
                },
            },
            {
                msg: '第 3 步：负载改为 110 kW，观察过载延时跳闸。',
                mode: 'check',
                op: [
                    {
                        type: 'observe', target: 'load3', part: 'power', msg: '在参数界面把负载功率改为 110 kW',
                        async act() { await _demoSetCfg(this, 'load3', 'powerKw', 110, '把「三相有功功率」改为 110 kW'); },
                    },
                    {
                        type: 'btn', target: 'load3', part: 'btn-load', msg: '按「加载」投入 110 kW 负载',
                        async act() { await _loadSet(this, true); await _sleep(600); },
                    },
                    {
                        type: 'observe', target: 'qf1', part: 'main-contact', msg: '超过额定 120% 持续 15 s，主开关跳闸',
                        async act() { await _waitQf(this, 'qf1', 'off', 32000); },
                    },
                ],
                check() {
                    const ld = _load(this);
                    return !!ld && ld.powerKw >= 100 && _qf(this, 'qf1').getState() === 'off'
                        && !!_g1(this).isOn;
                },
            },
            {
                msg: '第 4 步：直接合闸恢复供电，减载后重新投入。',
                mode: 'check',
                op: [
                    {
                        type: 'btn', target: 'load3', part: 'btn-unload', msg: '先确认负载已卸载',
                        async act() { await _loadSet(this, false); },
                    },
                    {
                        type: 'observe', target: 'load3', part: 'power', msg: '把负载功率减到 20 kW，避免再次过载',
                        async act() { await _demoSetCfg(this, 'load3', 'powerKw', 20, '把「三相有功功率」改为 20 kW'); },
                    },
                    {
                        type: 'btn', target: 'genpanel', part: 'btn-close', msg: '按 1# 面板「合闸」恢复供电',
                        async act() { await _closeViaPanel(this, 'genpanel', 'qf1'); },
                    },
                    {
                        type: 'btn', target: 'load3', part: 'btn-load', msg: '重新按「加载」投入 20 kW 负载',
                        async act() { await _loadSet(this, true); },
                    },
                ],
                check() {
                    const ld = _load(this);
                    return _qf(this, 'qf1').getState() === 'on' && !!ld && ld.isLoaded() && ld.powerKw <= 30;
                },
            },
            {
                msg: '第 5 步：起动 2# 机组并车，两机分担负载。',
                mode: 'check',
                op: _opsGen2Parallel(),
                check() {
                    return !!_g2(this).isOn && _qf(this, 'qf2').getState() === 'on';
                },
            },
            {
                msg: '第 6 步：测试题——过载跳闸为何能直接合闸。',
                mode: 'quiz',
                quizConfig: {
                    question: '过载导致主开关跳闸后，为什么可以直接合闸恢复供电？',
                    options: [
                        '过载只跳开主开关，发电机仍在运行；负载随跳闸自动卸载，合闸即恢复',
                        '过载跳闸后发电机自动停机，但可以自动重起',
                        '过载跳闸后必须等待 5 min 冷却才能合闸',
                        '过载跳闸后必须先更换主开关',
                    ],
                    answer: 0,
                    analysis: '过载保护只跳开主开关、切断负载回路，原动机与发电机仍在额定转速运行。跳闸后负载自动卸载，合闸时母线无冲击，因此可直接合闸；随后应控制投入的负载，避免再次过载。',
                },
            },
        ],
    },

    // ───────────────────────────────────────────────────────────
    'rev-power-recovery': {
        id: 'rev-power-recovery',
        name: '3.逆功率故障导致主开关跳闸的应急处理',
        steps: [
            {
                msg: '第 1 步：点击「自动接线」后复位，起动 1# 机供电。',
                mode: 'check',
                op: [..._opsPrepare(), ..._opsGen1Supply()],
                check() {
                    const sys = _sysOf(this);
                    return _wired(sys, 'gen1_wire_u', 'qf1_wire_t1')
                        && !!_g1(this).isOn && _qf(this, 'qf1').getState() === 'on';
                },
            },
            {
                msg: '第 2 步：起动 2# 机组，同期并车。',
                mode: 'check',
                op: _opsGen2Parallel(),
                check() {
                    return !!_g2(this).isOn && _qf(this, 'qf2').getState() === 'on'
                        && _sel(this).getPosition() === 3;
                },
            },
            {
                msg: '第 3 步：负载改为 100 kW，观察两机功率分配。',
                mode: 'check',
                op: [
                    {
                        type: 'observe', target: 'load3', part: 'power', msg: '在参数界面把负载功率改为 100 kW',
                        async act() { await _demoSetCfg(this, 'load3', 'powerKw', 100, '把「三相有功功率」改为 100 kW'); },
                    },
                    {
                        type: 'btn', target: 'load3', part: 'btn-load', msg: '按「加载」投入 100 kW 负载',
                        async act() { await _loadSet(this, true); await _sleep(2500); },
                    },
                ],
                check() {
                    const ld = _load(this);
                    return !!ld && ld.powerKw >= 100 && ld.isLoaded()
                        && _qf(this, 'qf1').getState() === 'on' && _qf(this, 'qf2').getState() === 'on';
                },
            },
            {
                msg: '第 4 步：设置 1# 机冷却水温高，观察逆功率与过载跳闸。',
                mode: 'check',
                op: [
                    {
                        type: 'fault', fault: 'gen1_coolant_temp', msg: '勾选「1#机冷却水温高故障」并应用',
                        async act() { await _sleep(600); },
                    },
                    {
                        type: 'observe', target: 'qf1', part: 'main-contact', msg: '1# 机被母线拖转，逆功率 5 s 后跳闸',
                        async act() { await _waitQf(this, 'qf1', 'off', 20000); },
                    },
                    {
                        type: 'observe', target: 'qf2', part: 'main-contact', msg: '2# 机独自承担全部负载，过载跳闸',
                        async act() { await _waitQf(this, 'qf2', 'off', 30000); },
                    },
                ],
                check() {
                    const f = _g1(this).getEngineFaults ? _g1(this).getEngineFaults() : {};
                    return !!f.coolantTemp
                        && _qf(this, 'qf1').getState() === 'off'
                        && _qf(this, 'qf2').getState() === 'off';
                },
            },
            {
                msg: '第 5 步：减载到 20 kW，合 2# 主开关恢复供电。',
                mode: 'check',
                op: [
                    {
                        type: 'observe', target: 'load3', part: 'power', msg: '在参数界面把负载减到 20 kW',
                        async act() { await _demoSetCfg(this, 'load3', 'powerKw', 20, '把「三相有功功率」改为 20 kW'); },
                    },
                    {
                        type: 'btn', target: 'genpanel2', part: 'btn-close', msg: '按 2# 面板「合闸」恢复供电',
                        async act() { await _closeViaPanel(this, 'genpanel2', 'qf2'); },
                    },
                    {
                        type: 'btn', target: 'load3', part: 'btn-load', msg: '重新投入 20 kW 负载',
                        async act() { await _loadSet(this, true); },
                    },
                ],
                check() {
                    const ld = _load(this);
                    return _qf(this, 'qf2').getState() === 'on' && !!_g2(this).isOn
                        && !!ld && ld.isLoaded() && ld.powerKw <= 30;
                },
            },
            {
                msg: '第 6 步：测试题——逆功率为何会造成全船失电。',
                mode: 'quiz',
                quizConfig: {
                    question: '两台机组并联运行，一台因原动机故障逆功率跳闸，为什么会连带全船失电？',
                    options: [
                        '该机承担的负荷全部转移给另一台，另一台过载延时跳闸，最终全船失电',
                        '逆功率跳闸会直接烧毁汇流排',
                        '逆功率跳闸后电网频率崩溃，保护全部误动',
                        '逆功率跳闸会倒灌烧毁另一台发电机',
                    ],
                    answer: 0,
                    analysis: '并联运行时两台机分担负载。一台原动机故障后不但不出力，反而由母线驱动（逆功率），逆功率保护延时将其切除；它原来承担的负荷瞬间全部加到另一台机上，超过 120% 额定后过载保护延时跳闸，于是全船失电。因此并联运行必须均衡分配负载并监视原动机状态。',
                },
            },
        ],
    },

    // ───────────────────────────────────────────────────────────
    'under-voltage-recovery': {
        id: 'under-voltage-recovery',
        name: '4.欠压故障导致主开关跳闸的应急处理',
        steps: [
            {
                msg: '第 1 步：点击「自动接线」后复位，起动 1# 机供电。',
                mode: 'check',
                op: [..._opsPrepare(), ..._opsGen1Supply()],
                check() {
                    const sys = _sysOf(this);
                    return _wired(sys, 'gen1_wire_u', 'qf1_wire_t1')
                        && !!_g1(this).isOn && _qf(this, 'qf1').getState() === 'on';
                },
            },
            {
                msg: '第 2 步：设置 1# 机欠压故障，观察欠压跳闸。',
                mode: 'check',
                op: [
                    {
                        type: 'fault', fault: 'gen1_undervoltage', msg: '勾选「1#机欠压故障」并应用',
                        async act() { await _sleep(600); },
                    },
                    {
                        type: 'observe', target: 'genpanel', msg: '面板 LCD 电压跌到约 200 V',
                        async act() {
                            await _waitFor(_sysOf(this), s => {
                                const g = _comp(s, 'gen1');
                                return !!g && (g._vRmsOut || g.vRms) * Math.sqrt(3) < 260;
                            }, 8000, 150);
                        },
                    },
                    {
                        type: 'observe', target: 'qf1', part: 'main-contact', msg: '欠压 2 s 后主开关跳闸，发电机仍在运行',
                        async act() { await _waitQf(this, 'qf1', 'off', 10000); },
                    },
                ],
                check() {
                    const g = _g1(this);
                    return !!g && !!g._faultAVR && _qf(this, 'qf1').getState() === 'off' && !!g.isOn;
                },
            },
            {
                msg: '第 3 步：起动 2# 机组，合闸恢复供电。',
                mode: 'check',
                op: [
                    {
                        type: 'knob', target: 'sync_sel', part: 'sel-knob', msg: '选择开关扳到 2# 档',
                        async act() { await _selTo(this, 3); },
                    },
                    {
                        type: 'btn', target: 'genpanel2', part: 'btn-start', msg: '按 2# 面板「起动」',
                        async act() { await _startGen(this, 'genpanel2', 'gen2'); },
                    },
                    {
                        type: 'btn', target: 'genpanel2', part: 'btn-close', msg: '按 2# 面板「合闸」恢复供电',
                        async act() { await _closeViaPanel(this, 'genpanel2', 'qf2'); },
                    },
                ],
                check() {
                    return !!_g2(this).isOn && _qf(this, 'qf2').getState() === 'on';
                },
            },
            {
                msg: '第 4 步：取消欠压故障，1# 机电压恢复额定值。',
                mode: 'check',
                op: [
                    {
                        type: 'fault', fault: 'gen1_undervoltage', repair: true, msg: '取消勾选「1#机欠压故障」并应用',
                        async act() { await _sleep(600); },
                    },
                    {
                        type: 'observe', target: 'genpanel', msg: '面板 LCD 电压回升到约 400 V',
                        async act() {
                            await _waitFor(_sysOf(this), s => {
                                const g = _comp(s, 'gen1');
                                return !!g && !g._faultAVR && (g._vRmsOut || g.vRms) * Math.sqrt(3) > 360;
                            }, 10000, 150);
                        },
                    },
                ],
                check() {
                    const g = _g1(this);
                    return !!g && !g._faultAVR && _qf(this, 'qf2').getState() === 'on';
                },
            },
            {
                msg: '第 5 步：测试题——欠压跳闸后的处理顺序。',
                mode: 'quiz',
                quizConfig: {
                    question: '主开关因欠压跳闸造成全船失电，正确的处理是（　）。',
                    options: [
                        '先起动备用机组恢复供电，再检查调压器（AVR）等欠压原因',
                        '反复按「合闸」按钮，直到电压恢复',
                        '先把全部负载断开，等电压自行恢复',
                        '只做记录并通知值班人员，等待指示',
                    ],
                    answer: 0,
                    analysis: '欠压跳闸后发电机可能仍在运行但电压不足，此时合闸会把低电压送到全船。应急处理应先用备用机组恢复供电保障重要负载，同时查明 AVR、励磁等欠压原因，修好后再并网转移负荷。',
                },
            },
        ],
    },

    // ───────────────────────────────────────────────────────────
    'short-circuit-recovery': {
        id: 'short-circuit-recovery',
        name: '5.短路故障导致主开关跳闸的应急处理',
        steps: [
            {
                msg: '第 1 步：点击「自动接线」后复位，起动 1# 机供电。',
                mode: 'check',
                op: [..._opsPrepare(), ..._opsGen1Supply()],
                check() {
                    const sys = _sysOf(this);
                    return _wired(sys, 'gen1_wire_u', 'qf1_wire_t1')
                        && !!_g1(this).isOn && _qf(this, 'qf1').getState() === 'on';
                },
            },
            {
                msg: '第 2 步：设置汇流排短路故障，观察瞬时跳闸。',
                mode: 'check',
                op: [
                    {
                        type: 'fault', fault: 'bus_short', msg: '勾选「汇流排干线短路故障」并应用',
                        async act() { await _sleep(600); },
                    },
                    {
                        type: 'observe', target: 'qf1', part: 'main-contact', msg: '短路保护瞬时动作，主开关立即跳闸',
                        async act() { await _waitQf(this, 'qf1', 'off', 6000); },
                    },
                ],
                check() {
                    const b = _bus(this);
                    return !!b && !!b._faultShort && _qf(this, 'qf1').getState() === 'off';
                },
            },
            {
                msg: '第 3 步：测试题——短路跳闸后的处理方法。',
                mode: 'quiz',
                quizConfig: {
                    question: '汇流排干线短路导致主开关跳闸后，正确的处理方法是（　）。',
                    options: [
                        '先查明并隔离短路点、确认绝缘合格，再合闸恢复，严禁强行合闸',
                        '立即反复强行合闸，短路点总能被烧断',
                        '不做处理，等短路点自行消失',
                        '直接起动备用机组并车供电，无须查短路点',
                    ],
                    answer: 0,
                    analysis: '干线短路电流极大，短路保护瞬时跳闸以保护发电机与人身安全。必须查明短路原因（绝缘破损、进水、误操作、检修遗留物），隔离并排除故障、确认汇流排绝缘合格后才能合闸。原因不明时强行合闸会造成设备损坏甚至火灾。',
                },
            },
            {
                msg: '第 4 步：排除短路故障后，合闸恢复供电。',
                mode: 'check',
                op: [
                    {
                        type: 'fault', fault: 'bus_short', repair: true, msg: '取消勾选「汇流排干线短路故障」并应用',
                        async act() { await _sleep(600); },
                    },
                    {
                        type: 'btn', target: 'genpanel', part: 'btn-close', msg: '故障排除后按「合闸」恢复供电',
                        async act() { await _closeViaPanel(this, 'genpanel', 'qf1'); },
                    },
                ],
                check() {
                    const b = _bus(this);
                    return !!b && !b._faultShort && _qf(this, 'qf1').getState() === 'on';
                },
            },
            {
                msg: '第 5 步：测试题——保护选择性不当引起的误跳闸。',
                mode: 'quiz',
                quizConfig: {
                    question: '短路保护选择性配合不当，上级主开关先跳而扩大停电范围，应如何处理（　）。',
                    options: [
                        '先恢复非故障段供电（合上主开关），再隔离并检修故障支路',
                        '让所有主开关保持分闸，待全部故障处理完再统一送电',
                        '认定保护失效，把主开关挂牌停用',
                        '直接合上所有主开关继续运行，不必处理',
                    ],
                    answer: 0,
                    analysis: '选择性要求离短路点最近的一级保护先动作、上级不应动作。若配合不当造成上级误跳、扩大停电范围，应急时应先恢复非故障段供电保障重要负载，再隔离故障支路排故，事后重新校核各级保护整定值与动作时限。',
                },
            },
        ],
    },
};

// ═══════════════════════════════════════════════════════════════
// 五、元件布局
// ═══════════════════════════════════════════════════════════════

export const componentConfigs = [
    // ── 主回路：同步发电机 → 主开关 → 汇流排 ──
    { Class: SyncGenerator3P, id: 'gen1', x: -100, y: 700, vRms: 230, freq: 50, isOn: false, mode: 'remote', label: '1#同步发电机', ratedPower: 80, ratedVoltage: 400, ratedCosPhi: 0.8, maxDropV: 200, avrMaxComp: 1, avrDelay: 2, avrTime: 5, autoDecoupleTrim: true, visible: true },
    { Class: MarineMainsSwitch, id: 'qf1', x: -180, y: 180, ratedCtrlVoltage: 24, label: '主开关', genId: 'gen1', syncScopeId: 'sync1', phaseMin: 60, phaseMax: 270, freqDiffMax: 0.5, revPowerKw: 8, revTime: 5, faultSimpleProtect: true, visible: true },
    { Class: GeneratorRemotePanel, id: 'genpanel', x: 330, y: 700, genId: 'gen1', qfId: 'qf1', label: '1#发电机组遥控面板', busId: 'bus1', syncSelId: 'sync_sel', selPos: 2, visible: true },

    // ── 2号机组：2号同步发电机 → 2号主开关 → 汇流排 ──
    { Class: SyncGenerator3P, id: 'gen2', x: 850, y: 700, vRms: 230, freq: 50, isOn: false, mode: 'remote', label: '2#同步发电机', ratedPower: 80, ratedVoltage: 400, ratedCosPhi: 0.8, maxDropV: 200, avrMaxComp: 1, avrDelay: 2, avrTime: 5, autoDecoupleTrim: true, visible: true },
    { Class: MarineMainsSwitch, id: 'qf2', x: 1100, y: 180, ratedCtrlVoltage: 24, label: '主开关2', genId: 'gen2', syncScopeId: 'sync1', phaseMin: 60, phaseMax: 270, freqDiffMax: 0.5, revPowerKw: 8, revTime: 5, faultSimpleProtect: true, visible: true },
    { Class: GeneratorRemotePanel, id: 'genpanel2', x: 1300, y: 700, genId: 'gen2', qfId: 'qf2', label: '2#发电机组遥控面板', busId: 'bus1', syncSelId: 'sync_sel', selPos: 3, visible: true },
    { Class: DCPower, id: 'dc_uv2', x: 1580, y: 750, voltage: 24, isOn: true, label: '失压脱扣电源2', visible: true },
    { Class: Busbar3P, id: 'bus1', x: 220, y: 30, tapsPerPhase: 6, label: '汇流排', visible: true },
    // 同步表中性点接地
    { Class: Ground, id: 'gnd1', x: 680, y: 500, visible: true },

    // ── 1号机组控制电源共地（遥控面板与控制电源的中间下方）──
    { Class: Ground, id: 'gnd1_uv', x: 590, y: 1000, label: '控制电源接地', visible: true },
    // ── 1号主开关线圈接地（主开关右下角）──
    { Class: Ground, id: 'gnd1_qf', x: 345, y: 465, label: '线圈接地', visible: true },
    // ── 1号遥控面板信号接地（面板上方）──
    { Class: Ground, id: 'gnd1_panel', x: 530, y: 670, label: '信号接地', visible: true },

    // ── 2号机组控制电源共地 ──
    { Class: Ground, id: 'gnd2_uv', x: 1560, y: 990, label: '控制电源接地', visible: true },
    { Class: Ground, id: 'gnd2_qf', x: 1606, y: 459, label: '线圈接地', visible: true },
    { Class: Ground, id: 'gnd2_panel', x: 1470, y: 660, label: '信号接地', visible: true },

    // ── 数字同步表：上=汇流排A相，左=待并机A相(经选择开关)，下=接地 ──
    { Class: Syncroscope, id: 'sync1', x: 600, y: 170, label: '数字同步表', visible: true },

    // ── 三相可调负载：汇流排第5口直连，N端接同步表旁接地 ──
    { Class: ThreePhaseLoad, id: 'load3', x: 950, y: 180, powerKw: 20, cosPhi: 1, reactive: 'ind', loaded: false, label: '三相可调负载', visible: true },

    // ── 待并机选择开关：单刀四掷（OFF / 待并机1 / 待并机2 / 预留）──
    { Class: SP4TSwitch, id: 'sync_sel', x: 650, y: 530, label: '同步表选择开关', function: '同步表选择开关', labelNames: ['OFF', '1', '2', '3'], initPosition: 1, visible: true },

    // ── 控制电源（DC 24V）：失压脱扣线圈 ──
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
// 六、接线（68 根 > 8 根，允许瞬时接线）
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
