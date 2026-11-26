/**
 * 项目 10-4 —— 船舶机舱监视报警系统主要参数的设置（Kongsberg K-Chief 600）
 * ═══════════════════════════════════════════════════════════════
 *  多页工程（2 页）：
 *    页 1「报警系统主界面」 kchief   操作站（ROS）Home 菜单：
 *        窗体标题栏 / 工具栏（ROS 节点、时钟、Command control、值班状态框、
 *        未确认报警计数、报警图标、ACK 确认、消音、蜂鸣器、打印）
 *        + 左列 Dock 报警组计数器 + 船舶剪影
 *        + 表格视图（当前报警 / 报警历史 / 标签一览 / 事件历史 / 被越控标签 /
 *          日志 / 被闭锁标签 / 计数器列表 / 标签恢复初值）
 *        + 工艺流程图入口（主机概览）/ 趋势 / 自定义视图
 *        点击表格中的测点行 → 打开该测点的报警参数设置界面
 *        （报警方向、设定值、延时、死区、优先级、报警组、闭锁）
 *    页 2「延伸报警单元」 extunit  6 块值班面板（驾驶室 / 轮机长 / 大管轮 /
 *        二管轮 / 三管轮 / 电机员）：On Watch 值班位置（BRIDGE / ECR）、
 *        Duty 值班交接、延伸报警就地确认、Call All / Call Duty Engineer
 *
 *  报警模型：tools/KChiefSolver.js（sys.kchief）
 *    · 报警状态机：未确认（闪+鸣）→ 已确认（常亮）→ 恢复正常（未确认时显黄色）
 *    · 越限须持续超过「报警延时」才报警；「死区/回差」防止设定值附近抖动反复报警
 *    · 报警组 ME / AUX / BILGE 的报警延伸到驾驶室与当班轮机员值班面板
 *
 *  流程：1. 模拟量参数的修改
 *        （报警组 M/E LO SYSTEM → 双击 ME-LO-P 参数界面 → 下限改 0.22 MPa、回差改 0.06 MPa
 *         并保存 → MIMIC 图把 PT-101 测量管路转手摇泵 → 压力 0.21 MPa 触发低压报警
 *         → 压力回 0.29 MPa 越过下限＋回差，报警返回 → 按确认 ACK 复位）
 *        2. 开关量参数的修改
 *        （双击 ME-LO-PR-SW → 报警延时改 10 s → MIMIC 图右键压力继电器看下限／上限
 *         → 拧螺钉：下限 0.18 MPa、幅差 0.03 MPa（上限 0.21）→ 压力开关测量管路转手摇泵
 *         → 压力 0.17 MPa 延时 10 s 报警 → 压力 0.22 MPa 报警返回 → 确认 ACK 复位）
 * ═══════════════════════════════════════════════════════════════
 */

import { KChiefConsole } from '../components/KChiefConsole.js';
import { ExtensionAlarmUnit } from '../components/ExtensionAlarmUnit.js';
import { FieldbusTopology } from '../components/FieldbusTopology.js';
import { DeadmanPanel } from '../components/DeadmanPanel.js';
import { MainEngineLubeOilMimic } from '../components/MainEngineLubeOilMimic.js';
import { PressRelay } from '../components/PressRelay.js';

import { Multimeter } from '../components/Multimeter.js';
import { MF47Multimeter } from '../components/MF47Multimeter.js';
import { Oscilloscope_tri } from '../components/Osc_tri.js';
import { SignalGenerator } from '../components/SignalGenerator.js';
import { ProcessCalibrator } from '../components/ProcessCalibrator.js';
import { ElecMeter } from '../components/ElecMeter.js';
import { RealMegohmMeter } from '../components/RealMegohmMeter.js';

// ═══════════════════════════════════════════════════════════════
// 通用辅助
// ═══════════════════════════════════════════════════════════════

const _sleep = (ms) => new Promise(r => setTimeout(r, ms));
const _sysOf = (ctx) => (ctx && ctx.sys) ? ctx.sys : window.sys;
const _comp = (sys, id) => (sys && sys.comps) ? sys.comps[id] : null;
/** 报警模型 */
const _M = (sys) => (sys && sys.kchief) ? sys.kchief : null;
const _kc = (sys) => _comp(sys, 'kchief');
const _ext = (sys) => _comp(sys, 'extunit');

/** 模拟真实点击部件（触发组件自身的点击处理逻辑） */
function _firePartClick(comp, partId) {
    if (!comp) return false;
    try {
        const node = comp.getClickablePartNode && comp.getClickablePartNode(partId);
        if (node && typeof node.fire === 'function') { node.fire('click'); return true; }
    } catch (e) { /* ignore */ }
    return false;
}

async function _click(sys, compId, partId, times = 1) {
    const c = _comp(sys, compId);
    for (let i = 0; i < times; i++) {
        _firePartClick(c, partId);
        await _sleep(280);
    }
}

/** 确保操作站处于 Home 页：若当前在列表页 / 参数界面，先点工具栏「主页」返回 */
async function _ensureHome(sys) {
    const c = _comp(sys, 'kchief');
    if (!c) return false;
    if (c._watchCallOpen) { c.closeWatchCall(); await _sleep(300); }   // 关闭值班呼叫对话框
    if (c.overlayKind !== null) {
        _firePartClick(c, 'tb-home');
        await _sleep(600);
        return true;
    }
    await _sleep(300);
    return false;
}

/** 模拟双击部件（列表条目双击打开报警参数界面） */
function _dblclick(sys, compId, partId) {
    const c = _comp(sys, compId);
    if (!c) return false;
    try {
        const node = c.getClickablePartNode && c.getClickablePartNode(partId);
        if (node && typeof node.fire === 'function') { node.fire('dblclick'); return true; }
    } catch (e) { /* ignore */ }
    return false;
}

/**
 * 报警参数界面里改数值：双击数值单元格 → 输入框出现 → 填值 → 回车。
 * （与真实操作一致：双击文本进入编辑状态）
 */
async function _setParamNumber(sys, key, value) {
    _dblclick(sys, 'kchief', `param-${key}`);
    await _sleep(450);
    const inp = document.getElementById(`kchief_param_${key}`);
    if (inp) {
        inp.value = String(value);
        inp.dispatchEvent(new Event('input', { bubbles: true }));
        inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        await _sleep(400);
        return true;
    }
    return false;
}

/**
 * 在报警列表 / 报警组页里按测点 id 找到对应行，双击打开该测点的参数设置界面
 * （与真实操作一致：双击行 → 打开 K-Chief Tag properties 界面）
 */
async function _openParamByTag(sys, tagId) {
    const c = _kc(sys);
    if (!c) return false;
    let idx = -1;
    try {
        const spec = c._tableSpec ? c._tableSpec() : null;
        if (spec && Array.isArray(spec.rows)) {
            idx = spec.rows.findIndex(r => (r.cells || []).some(cl => cl && String(cl.text || '').trim() === tagId));
        }
    } catch (e) { /* ignore */ }
    const off = c._rowOffset || 0;
    const local = idx - off;
    if (local >= 0 && local < 21) {
        _dblclick(sys, 'kchief', 'row-' + local);
        await _sleep(800);
        if (c.overlayKind === 'param') return true;
    }
    if (c.openParam) { c.openParam(tagId); await _sleep(600); }   // 兜底：公开方法
    return c.overlayKind === 'param';
}

/** 条件轮询等待（不写死 sleep 猜时间） */
async function _waitFor(sys, cond, timeoutMs = 15000, intervalMs = 150) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
        try { if (cond(sys)) return true; } catch (e) { /* ignore */ }
        await _sleep(intervalMs);
    }
    try { return !!cond(sys); } catch (e2) { return false; }
}

/** 复位：清故障、清报警、参数恢复初值、关闭浮层、MIMIC 恢复初始工况 */
async function _resetRig(sys) {
    if (!sys) return;
    const M = _M(sys);
    if (M) M.reset();
    const c = _kc(sys);
    if (c && c.closeWatchCall) c.closeWatchCall();
    if (c && c._closeOverlay) c._closeOverlay();
    // 主机滑油系统 MIMIC：三通阀回「测管路」位、手摇泵压力回初值、1# 泵运行
    const mim = _comp(sys, 'lomimic');
    if (mim && mim.m) {
        const m = mim.m;
        m.sw3 = 'line'; m.sw3b = 'line';
        m.handP = 0.3; m.handP2 = 0.2;
        m.valves.v1 = true; m.valves.v2 = true;
        m.pumps.p1.on = true; m.pumps.p1.overload = false;
        m.pumps.p2.on = false; m.pumps.p2.overload = false;
        m.engOn = true; m.shdTrip = false;
        m.pswClosed = true;
        mim._pumpFaultK = null;
        mim._shdCnt = 0;          // 安保停车计数（不重置会让下一次演示不再触发停车）
    }
    // 压力继电器（YT1226）：给定值 30 %（下限 0.15 MPa）、幅差 30 %（上限 0.20 MPa）
    const psw = _comp(sys, 'psw1');
    if (psw && typeof psw.update === 'function') {
        psw.setPoint = 30;
        psw.differential = 30;
        psw.update(psw.pressure);
    }
    await _sleep(300);
    if (sys.redrawAll) sys.redrawAll();
}

// ═══════════════════════════════════════════════════════════════
// 故障配置（走工具栏「故障设置」界面）
// ═══════════════════════════════════════════════════════════════

export const FAULT_CONFIGS = {
    'me-lo-press': {
        id: 'me-lo-press', name: '主机滑油进机压力低（滑油泵排出压力下降）', system: '滑油系统',
        check() { const M = _M(window.sys); const t = M && M.tag('ME-LO-P'); return !!(t && t.fault); },
        trigger() { const M = _M(window.sys); if (M) M.setFault('ME-LO-P', true); },
        repair() { const M = _M(window.sys); if (M) M.setFault('ME-LO-P', false); },
    },
    'me-cw-temp': {
        id: 'me-cw-temp', name: '主机缸套冷却水出口温度高（冷却器脏堵）', system: '冷却水系统',
        check() { const M = _M(window.sys); const t = M && M.tag('ME-CW-T'); return !!(t && t.fault); },
        trigger() { const M = _M(window.sys); if (M) M.setFault('ME-CW-T', true); },
        repair() { const M = _M(window.sys); if (M) M.setFault('ME-CW-T', false); },
    },
    'lo-pr-sw': {
        id: 'lo-pr-sw', name: '滑油低压开关动作（压力开关触点误闭合）', system: '滑油系统',
        check() { const M = _M(window.sys); const t = M && M.tag('ME-LO-PR-SW'); return !!(t && t.fault); },
        trigger() { const M = _M(window.sys); if (M) M.setFault('ME-LO-PR-SW', true); },
        repair() { const M = _M(window.sys); if (M) M.setFault('ME-LO-PR-SW', false); },
    },
    'lo-pump-f': {
        id: 'lo-pump-f', name: '主滑油泵故障跳闸（备用泵自动投入）', system: '滑油系统',
        check() { const M = _M(window.sys); const t = M && M.tag('ME-LO-PUMP-F'); return !!(t && t.fault); },
        trigger() { const M = _M(window.sys); if (M) M.setFault('ME-LO-PUMP-F', true); },
        repair() { const M = _M(window.sys); if (M) M.setFault('ME-LO-PUMP-F', false); },
    },
    'blg-high': {
        id: 'blg-high', name: '舱底水高位（舱底泵未起动）', system: '舱底系统',
        check() { const M = _M(window.sys); const t = M && M.tag('BLG-LV'); return !!(t && t.fault); },
        trigger() { const M = _M(window.sys); if (M) M.setFault('BLG-LV', true); },
        repair() { const M = _M(window.sys); if (M) M.setFault('BLG-LV', false); },
    },
};

/** 确保「值班呼叫 Watch calling」对话框已打开（关闭时先点顶部「ECR watch」打开） */
async function _ensureWatchCall(sys) {
    const c = _kc(sys);
    if (!c) return false;
    if (!c._watchCallOpen) {
        _firePartClick(c, 'watch-box');
        await _waitFor(sys, s => { const k = _kc(s); return !!(k && k._watchCallOpen); }, 3000);
        await _sleep(350);
    }
    return !!c._watchCallOpen;
}

/**
 * 演示「失职报警延时」修改（走配置界面：右键 → 参数设置 → 填值 → 点保存）
 * ⚠ 必须在 _resetRig() 之后调用（reset 会把 repeatDelay 恢复成默认 180 s = 3 min）
 */
async function _demoSetRepeatDelay(wf, value) {
    const sys = _sysOf(wf);
    const c = _kc(sys);
    if (!c) return false;
    const target = Number(value);
    await _resetRig(sys);      // 演示从干净状态开始（复位会把延时恢复 180 s，随后改为目标值）

    // ① 在报警系统面板上点右键（与真实操作一致：fire contextmenu 调出上下文菜单）
    const stage = c.group.getStage && c.group.getStage();
    const rect = (stage && stage.container) ? stage.container().getBoundingClientRect() : { left: 0, top: 0 };
    const box = c.group.getClientRect ? c.group.getClientRect() : { x: 0, y: 0 };
    c.group.fire('contextmenu', {
        evt: {
            clientX: rect.left + box.x + 80,
            clientY: rect.top + box.y + 16,
            preventDefault() { },
        },
    });
    await _sleep(600);

    // ② 点上下文菜单里的「参数设置」
    const menu = document.getElementById('comp-context-menu');
    let item = null;
    if (menu) item = Array.prototype.filter.call(menu.children, el => String(el.textContent).trim() === '参数设置')[0] || null;
    if (item) {
        await wf._flashDomElement(item, '选择「参数设置」，打开配置界面', 1800);
        item.click();
    } else {
        c.showConfigDialog();          // 兜底：上下文菜单未出现时直接弹配置界面
    }
    await _sleep(800);

    // ③ 高亮「失职报警延时 Repeat delay」输入框并填入新值
    const input = document.getElementById('diag_repeatDelay');
    if (input) {
        await wf._flashDomElement(input, `把失职报警延时由 ${c.model.repeatDelay} s（3 min）改为 ${target} s`, 2600);
        input.value = String(target);
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        await _sleep(400);
    }

    // ④ 指向并真正按下「保存」
    const btns = Array.prototype.filter.call(document.querySelectorAll('button'),
        b => String(b.textContent).trim() === '保存');
    const saveBtn = btns[btns.length - 1];
    if (saveBtn) {
        await wf._flashDomElement(saveBtn, '点「保存」确认修改失职报警延时', 1800);
        saveBtn.click();
    }
    await _sleep(700);

    // ⑤ 生效兜底（保存未生效时补写，保证演示不中断）
    if (Number(c.model.repeatDelay) !== target) c.onConfigUpdate({ id: c.id, repeatDelay: target });
    return Number(c.model.repeatDelay) === target;
}

/** 轮机员安全系统（Dead Man）面板 */
const _dm = (sys) => _comp(sys, 'deadman');

/** 点部件（click 事件） */
async function _pressClick(sys, compId, partId) {
    _firePartClick(_comp(sys, compId), partId);
    await _sleep(350);
}

/**
 * 按住轮机员安全系统的自复位旋钮某一半（mousedown）→ 松开（stage mouseup 使指针回中位）。
 * 旋钮只响应 mousedown，所以不能用 fire('click')。
 */
async function _pressDeadmanSwitch(sys, partId) {
    const dm = _dm(sys);
    if (!dm) return false;
    const node = dm.getClickablePartNode && dm.getClickablePartNode(partId);
    if (!node) return false;
    node.fire('mousedown', { evt: {} });
    await _sleep(150);
    if (sys.stage) sys.stage.fire('mouseup', { evt: {} });   // 松手：自复位旋钮回中位
    await _sleep(250);
    return true;
}

/** 打开（或关闭）轮机员安全系统的「时间设置」对话框 */
async function _ensureTimeDialog(sys, open = true) {
    const el = () => document.getElementById('deadman_time_dlg');
    const visible = () => { const d = el(); return !!(d && d.style.display !== 'none'); };
    if (open) {
        if (!visible()) await _pressClick(sys, 'deadman', 'ecr-time');
        await _waitFor(sys, visible, 4000);
    } else if (visible()) {
        const btn = document.getElementById('dm-close');
        if (btn) btn.click();                 // 非模态对话框：点右上角 × 关闭
        await _sleep(350);
    }
    return visible();
}

/** 在时间设置对话框里设定 预警时间 / 报警时间（单位 min） */
async function _setDeadmanTimes(wf, sys, preMin, alarmMin) {
    const dm = _dm(sys);
    if (!dm) return false;
    await _ensureTimeDialog(sys, true);
    const setOne = async (id, val, tip) => {
        const el = document.getElementById(id);
        if (!el) return false;
        await wf._flashDomElement(el, tip, 2200);
        el.value = String(val);
        el.dispatchEvent(new Event('change', { bubbles: true }));
        await _sleep(300);
        return true;
    };
    await setOne('dm-pre', preMin, `预警时间改为 ${preMin} min`);
    await setOne('dm-alarm', alarmMin, `报警时间改为 ${alarmMin} min（${Math.round(alarmMin * 60)} s）`);
    return Number(dm.dead.preWarn) === Number(preMin) && Number(dm.dead.alarmTime) === Number(alarmMin);
}

/**
 * 报警模型查询小工具
 *   _activeAlarm：该测点当前是否有活动报警（当前报警 / 报警组页里能看到）
 *   _histAlarm  ：该测点是否已进入报警历史（报警消失后才进历史）
 */
const _activeAlarm = (sys, tagId) => { const M = _M(sys); return !!(M && M.alarms.some(a => a.tagId === tagId)); };
const _histAlarm = (sys, tagId) => { const M = _M(sys); return !!(M && M.history.some(h => h.tagId === tagId)); };

/**
 * 当前列表页 / 报警组页里某测点所占的行部件 id（row-N），供自动演示箭头精确定位。
 * 行顺序随报警排序变化，因此每帧按表格数据实时反查，不写死行号。
 */
function _rowPartOfTag(sys, tagId) {
    const c = _kc(sys);
    if (c) {
        try {
            const spec = c._tableSpec ? c._tableSpec() : null;
            if (spec && Array.isArray(spec.rows)) {
                const idx = spec.rows.findIndex(r => (r.cells || []).some(cl => cl && String(cl.text || '').trim() === tagId));
                const local = idx - (c._rowOffset || 0);
                if (local >= 0 && local < 21) return 'row-' + local;
            }
        } catch (e) { /* ignore */ }
    }
    return 'row-0';
}

/**
 * 用 MIMIC 上的手摇泵加压 / 减压按钮把压力调到目标值（每点一次 ±0.01 MPa）。
 * 与真实操作一致：反复点击 hp-up / hp-dn，直到压力表指到目标值。
 * which：'pt' = PT-101 侧手摇泵（hp-up / hp-dn，压力 m.handP）
 *        'psw' = 压力继电器侧手摇泵（hp2-up / hp2-dn，压力 m.handP2）
 */
async function _setHandPressure(sys, target, which = 'pt') {
    const mim = _comp(sys, 'lomimic');
    if (!mim || !mim.m) return false;
    const m = mim.m;
    const isPsw = which === 'psw';
    const key = isPsw ? 'handP2' : 'handP';
    const up = isPsw ? 'hp2-up' : 'hp-up';
    const dn = isPsw ? 'hp2-dn' : 'hp-dn';
    let guard = 0;
    while (Math.abs(m[key] - target) > 0.004 && guard++ < 60) {
        _firePartClick(mim, m[key] > target ? dn : up);
        await _sleep(140);
    }
    await _sleep(300);
    return Math.abs(m[key] - target) <= 0.004;
}

/**
 * 转动压力继电器（YT1226）的调节螺钉：
 *   which='set' → 给定值螺钉（每格 2 %），dir=+1 升 / -1 降
 *   which='diff' → 幅差螺钉（每格 2 %），dir=+1 升 / -1 降
 * 组件为螺钉提供了 turnSetScrew() / turnDiffScrew() 程序化接口（供自动演示）。
 */
async function _turnScrew(sys, which, dir, times) {
    const psw = _comp(sys, 'psw1');
    if (!psw) return false;
    for (let i = 0; i < times; i++) {
        if (which === 'set') psw.turnSetScrew(dir);
        else psw.turnDiffScrew(dir);
        await _sleep(160);
    }
    await _sleep(200);
    return true;
}

/**
 * 组件右键菜单 →「参数设置」：与真实操作一致（fire contextmenu 弹菜单，再点菜单项）。
 * 返回配置对话框是否已打开（以压力继电器的 diag_lowSet 字段为判据）。
 */
async function _openCompConfig(wf, sys, compId) {
    const comp = _comp(sys, compId);
    if (!comp) return false;
    const stage = comp.group.getStage && comp.group.getStage();
    const rect = (stage && stage.container) ? stage.container().getBoundingClientRect() : { left: 0, top: 0 };
    const box = comp.group.getClientRect ? comp.group.getClientRect() : { x: 0, y: 0 };
    comp.group.fire('contextmenu', {
        evt: {
            clientX: rect.left + box.x + box.width / 2,
            clientY: rect.top + box.y + box.height / 2,
            preventDefault() { },
        },
    });
    await _sleep(500);
    const menu = document.getElementById('comp-context-menu');
    const item = menu
        ? Array.prototype.filter.call(menu.children, el => String(el.textContent).trim() === '参数设置')[0] || null
        : null;
    if (item) {
        if (wf && wf._flashDomElement) await wf._flashDomElement(item, '选择「参数设置」，打开参数界面', 1600);
        item.click();
    } else {
        comp.showConfigDialog();       // 兜底：上下文菜单未出现时直接弹配置界面
    }
    await _sleep(700);
    return !!document.getElementById('diag_lowSet');
}

// ═══════════════════════════════════════════════════════════════
// 工作流
// ═══════════════════════════════════════════════════════════════

export const PROJECT_WORKFLOWS = {

    // ══════════════════════════════════════════════════════
    // 流程一：模拟量参数的修改
    //   报警组页 → 双击 ME-LO-P 参数界面 → 改下限 0.22 / 回差 0.06 并保存
    //   → MIMIC 图把 PT-101 测量管路转手摇泵 → 压力 0.21 MPa 触发报警
    //   → 压力回 0.29 MPa，报警返回（恢复正常） → 按确认 ACK 复位
    // ══════════════════════════════════════════════════════
    'analog-param-modify': {
        id: 'analog-param-modify', name: '1. 模拟量参数的修改',
        steps: [
            // ① 回 Home，点左侧报警组 M/E LO SYSTEM
            {
                msg: '第 1 步：点报警组 M/E LO SYSTEM，查看该组监测参数。',
                mode: 'check',
                op: [
                    {
                        type: 'page', page: 1, msg: '回到报警系统主界面（干净状态）',
                        async act() {
                            const sys = _sysOf(this);
                            await _resetRig(sys);       // 清报警、参数恢复初值、MIMIC 回初始工况
                            await _ensureHome(sys);
                        },
                    },
                    {
                        type: 'btn', target: 'kchief', part: 'dock-ME-LO', msg: '点左侧报警组「M/E LO SYSTEM」',
                        async act() {
                            const sys = _sysOf(this);
                            await _click(sys, 'kchief', 'dock-ME-LO');
                            await _waitFor(sys, s => { const c = _kc(s); return !!(c && c.overlayKind === 'group'); }, 5000);
                            await _sleep(600);
                        },
                    },
                ],
                check() {
                    const c = _kc(_sysOf(this));
                    return !!c && c.overlayKind === 'group' && c._groupFilter === 'ME-LO';
                },
            },
            // ② 双击 ME-LO-P 信息条 → 参数修改界面
            {
                msg: '第 2 步：双击 ME-LO-P 信息条，打开参数修改界面。',
                mode: 'check',
                op: [
                    {
                        type: 'observe', target: 'kchief',
                        part: function () { return _rowPartOfTag(_sysOf(this), 'ME-LO-P'); },
                        msg: '双击「ME-LO-P 主机滑油进机压力」信息条',
                        async act() {
                            const sys = _sysOf(this);
                            const ok = await _openParamByTag(sys, 'ME-LO-P');
                            if (this._projFlag) this._projFlag.s2Opened = !!ok;
                            await _sleep(500);
                        },
                    },
                ],
                check() {
                    const c = _kc(_sysOf(this));
                    return !!c && c.overlayKind === 'param' && c._paramTagId === 'ME-LO-P';
                },
            },
            // ③ 改下限 0.22、回差 0.06，保存
            {
                msg: '第 3 步：报警下限改 0.22 MPa、回差改 0.06 MPa，保存。',
                mode: 'check',
                op: [
                    {
                        type: 'observe', target: 'kchief', part: 'param-limit',
                        msg: '双击「Low Limit」，改为 0.22',
                        async act() {
                            const sys = _sysOf(this);
                            await _setParamNumber(sys, 'limit', 0.22);
                        },
                    },
                    {
                        type: 'observe', target: 'kchief', part: 'param-deadband',
                        msg: '双击「Deadband」，改为 0.06',
                        async act() {
                            const sys = _sysOf(this);
                            await _setParamNumber(sys, 'deadband', 0.06);
                        },
                    },
                    {
                        type: 'btn', target: 'kchief', part: 'param-save', msg: '点「保存」使参数生效',
                        async act() {
                            const sys = _sysOf(this);
                            await _click(sys, 'kchief', 'param-save');
                            await _waitFor(sys, s => {
                                const M = _M(s); const t = M && M.tag('ME-LO-P');
                                return !!(t && Math.abs(t.limit - 0.22) < 1e-6 && Math.abs(t.deadband - 0.06) < 1e-6);
                            }, 6000);
                            await _sleep(500);
                        },
                    },
                ],
                check() {
                    const sys = _sysOf(this); const M = _M(sys); const c = _kc(sys);
                    const t = M && M.tag('ME-LO-P');
                    return !!t && Math.abs(t.limit - 0.22) < 1e-6 && Math.abs(t.deadband - 0.06) < 1e-6
                        && !!c && c.overlayKind === 'group';
                },
            },
            // ④ 切到 MIMIC 图，把 PT-101 测量管路转到手摇泵
            {
                msg: '第 4 步：MIMIC 图里把压力传感器测量管路转到手摇泵。',
                mode: 'check',
                op: [
                    {
                        type: 'page', page: 5, msg: '切换到「主机滑油系统 MIMIC」页',
                        async act() { await _sleep(400); },
                    },
                    {
                        type: 'switch', target: 'lomimic', part: 'cv3b',
                        msg: '点 PT-101 下方三通阀手柄 → 转接手摇泵',
                        async act() {
                            const sys = _sysOf(this);
                            const mim = _comp(sys, 'lomimic');
                            if (mim && mim.m && mim.m.sw3 !== 'pump') {
                                _firePartClick(mim, 'cv3b');
                                await _waitFor(sys, s => { const c = _comp(s, 'lomimic'); return !!(c && c.m && c.m.sw3 === 'pump'); }, 3000);
                            }
                            await _sleep(600);
                        },
                    },
                ],
                check() {
                    const sys = _sysOf(this);
                    const mim = _comp(sys, 'lomimic');
                    const onPage = !sys.pageMgr || sys.pageMgr.currentPage === 5;
                    return onPage && !!mim && !!mim.m && mim.m.sw3 === 'pump';
                },
            },
            // ⑤ 手摇泵压力降到 0.21 MPa，回报警界面等报警触发
            {
                msg: '第 5 步：手摇泵压力调到 0.21 MPa，回主界面等报警。',
                mode: 'check',
                op: [
                    {
                        type: 'knob', target: 'lomimic', part: 'hp-dn',
                        msg: '点「−」把手摇泵压力降到 0.21 MPa',
                        async act() {
                            const sys = _sysOf(this);
                            this._tipWorkflow('每点一次减压 0.01 MPa，降到 0.21 MPa…', 5000);
                            await _setHandPressure(sys, 0.21);
                            await _sleep(600);
                        },
                    },
                    {
                        type: 'page', page: 1, msg: '回到报警系统主界面',
                        async act() {
                            const sys = _sysOf(this);
                            this._tipWorkflow('压力低于 0.22 MPa 后须持续超过 3 s 报警延时才报警…', 8000);
                            await _waitFor(sys, s => _activeAlarm(s, 'ME-LO-P'), 30000, 200);
                            await _sleep(1200);
                        },
                    },
                    {
                        type: 'observe', target: 'kchief', part: 'tb-counter',
                        msg: '未确认报警计数变为 1，横幅出现 ME-LO-P 低压报警',
                    },
                ],
                check() {
                    const sys = _sysOf(this);
                    const mim = _comp(sys, 'lomimic');
                    const onPage = !sys.pageMgr || sys.pageMgr.currentPage === 1;
                    return onPage && !!mim && !!mim.m && Math.abs(mim.m.handP - 0.21) < 0.006
                        && _activeAlarm(sys, 'ME-LO-P');
                },
            },
            // ⑥ 回 MIMIC 图，手摇泵压力升到 0.29 MPa
            {
                msg: '第 6 步：回 MIMIC 图把手摇泵压力调到 0.29 MPa。',
                mode: 'check',
                op: [
                    {
                        type: 'page', page: 5, msg: '切换到「主机滑油系统 MIMIC」页',
                        async act() { await _sleep(400); },
                    },
                    {
                        type: 'knob', target: 'lomimic', part: 'hp-up',
                        msg: '点「+」把手摇泵压力升到 0.29 MPa',
                        async act() {
                            const sys = _sysOf(this);
                            this._tipWorkflow('压力升过 0.28 MPa（下限＋回差）后报警才会返回…', 6000);
                            await _setHandPressure(sys, 0.29);
                            await _sleep(600);
                        },
                    },
                ],
                check() {
                    const sys = _sysOf(this);
                    const mim = _comp(sys, 'lomimic');
                    const onPage = !sys.pageMgr || sys.pageMgr.currentPage === 5;
                    return onPage && !!mim && !!mim.m && Math.abs(mim.m.handP - 0.29) < 0.006;
                },
            },
            // ⑦ 回主界面，报警已返回 → 按确认 ACK 复位
            {
                msg: '第 7 步：报警已返回，按确认 ACK 使报警复位。',
                mode: 'check',
                op: [
                    {
                        type: 'page', page: 1, msg: '回到报警系统主界面',
                        async act() {
                            const sys = _sysOf(this);
                            this._tipWorkflow('压力回升越过下限＋回差，报警自动恢复正常（黄色，待确认）…', 8000);
                            await _waitFor(sys, s => {
                                const M = _M(s); const al = M && M.alarmOf('ME-LO-P');
                                return !al || al.state === 'RTN';
                            }, 20000, 200);
                            await _sleep(1000);
                            if (this._projFlag) {
                                const M = _M(sys); const al = M && M.alarmOf('ME-LO-P');
                                this._projFlag.s7Returned = !!(al && al.state === 'RTN');
                            }
                        },
                    },
                    {
                        type: 'observe', target: 'kchief',
                        part: function () { return _rowPartOfTag(_sysOf(this), 'ME-LO-P'); },
                        msg: '报警条显示「已恢复正常（未确认）」，⏎ 标记闪烁',
                    },
                    {
                        type: 'btn', target: 'kchief', part: 'tb-ack', msg: '按工具栏「确认 ACK」复位报警',
                        async act() {
                            const sys = _sysOf(this);
                            await _click(sys, 'kchief', 'tb-ack');
                            await _waitFor(sys, s => !_activeAlarm(s, 'ME-LO-P'), 8000);
                            await _sleep(800);
                        },
                    },
                ],
                check() {
                    const sys = _sysOf(this);
                    const M = _M(sys);
                    const flag = this._projFlag || {};
                    // 报警先「已恢复正常（未确认）」再被 ACK 清除 → 历史记录的 state 为 RTN，
                    // 因此演练/评估模式（不经 act 的 flag）也能判过
                    const h = M && M.history.find(x => x.tagId === 'ME-LO-P');
                    return !_activeAlarm(sys, 'ME-LO-P') && !!h
                        && (flag.s7Returned === true || h.state === 'RTN');
                },
            },
        ],
    },

    // ══════════════════════════════════════════════════════
    // 流程二：开关量参数的修改
    //   报警组页 → 双击 ME-LO-PR-SW → 报警延时改 10 s 并保存
    //   → MIMIC 图右键压力开关看参数界面（下限／上限）
    //   → 拧螺钉：下限 0.18 MPa、幅差 0.03 MPa（上限 0.21 MPa）
    //   → 测量管路转手摇泵、压力 0.17 MPa → 延时 10 s 后报警
    //   → 压力升到 0.22 MPa（越过上限）报警返回 → 确认 ACK 复位
    // ══════════════════════════════════════════════════════
    'digital-param-modify': {
        id: 'digital-param-modify', name: '2. 开关量参数的修改',
        steps: [
            // ① 回 Home，点左侧报警组 M/E LO SYSTEM
            {
                msg: '第 1 步：点报警组 M/E LO SYSTEM，查看该组监测参数。',
                mode: 'check',
                op: [
                    {
                        type: 'page', page: 1, msg: '回到报警系统主界面（干净状态）',
                        async act() {
                            const sys = _sysOf(this);
                            await _resetRig(sys);       // 清报警、参数回初值、MIMIC / 压力继电器回初始工况
                            await _ensureHome(sys);
                        },
                    },
                    {
                        type: 'btn', target: 'kchief', part: 'dock-ME-LO', msg: '点左侧报警组「M/E LO SYSTEM」',
                        async act() {
                            const sys = _sysOf(this);
                            await _click(sys, 'kchief', 'dock-ME-LO');
                            await _waitFor(sys, s => { const c = _kc(s); return !!(c && c.overlayKind === 'group'); }, 5000);
                            await _sleep(600);
                        },
                    },
                ],
                check() {
                    const c = _kc(_sysOf(this));
                    return !!c && c.overlayKind === 'group' && c._groupFilter === 'ME-LO';
                },
            },
            // ② 双击 ME-LO-PR-SW 信息条 → 参数修改界面
            {
                msg: '第 2 步：双击 ME-LO-PR-SW 信息条，打开参数界面。',
                mode: 'check',
                op: [
                    {
                        type: 'observe', target: 'kchief',
                        part: function () { return _rowPartOfTag(_sysOf(this), 'ME-LO-PR-SW'); },
                        msg: '双击「ME-LO-PR-SW 滑油低压开关」信息条',
                        async act() {
                            const sys = _sysOf(this);
                            await _openParamByTag(sys, 'ME-LO-PR-SW');
                            await _sleep(500);
                        },
                    },
                ],
                check() {
                    const c = _kc(_sysOf(this));
                    return !!c && c.overlayKind === 'param' && c._paramTagId === 'ME-LO-PR-SW';
                },
            },
            // ③ 报警延时改 10 s，保存
            {
                msg: '第 3 步：报警延时改为 10 s，保存。',
                mode: 'check',
                op: [
                    {
                        type: 'observe', target: 'kchief', part: 'param-delay',
                        msg: '双击「Delay Time」，改为 10',
                        async act() {
                            const sys = _sysOf(this);
                            await _setParamNumber(sys, 'delay', 10);
                        },
                    },
                    {
                        type: 'btn', target: 'kchief', part: 'param-save', msg: '点「保存」使参数生效',
                        async act() {
                            const sys = _sysOf(this);
                            await _click(sys, 'kchief', 'param-save');
                            await _waitFor(sys, s => { const M = _M(s); const t = M && M.tag('ME-LO-PR-SW'); return !!(t && t.delay === 10); }, 6000);
                            await _sleep(500);
                        },
                    },
                ],
                check() {
                    const sys = _sysOf(this); const M = _M(sys); const c = _kc(sys);
                    const t = M && M.tag('ME-LO-PR-SW');
                    return !!t && t.delay === 10 && !!c && c.overlayKind === 'group';
                },
            },
            // ④ MIMIC 图右键压力开关 → 参数界面，观察压力下限 / 上限
            {
                msg: '第 4 步：右键压力开关打开参数界面，看下限与上限。',
                mode: 'check',
                op: [
                    {
                        type: 'page', page: 5, msg: '切换到「主机滑油系统 MIMIC」页',
                        async act() { await _sleep(400); },
                    },
                    {
                        type: 'observe', target: 'psw1', msg: '在压力继电器 YT1226 上点右键',
                        async act() {
                            const sys = _sysOf(this);
                            this._tipWorkflow('右键 → 参数设置，调出压力继电器的参数界面…', 6000);
                            const ok = await _openCompConfig(this, sys, 'psw1');
                            if (this._projFlag) this._projFlag.s4Opened = !!ok;
                            await _sleep(500);
                        },
                    },
                    {
                        type: 'observe', target: 'psw1', msg: '观察「压力下限」＝报警动作值',
                        async act() {
                            const sys = _sysOf(this);
                            const psw = _comp(sys, 'psw1');
                            const el = document.getElementById('diag_lowSet');
                            if (el && this._flashDomElement) {
                                await this._flashDomElement(el, `压力下限（报警动作值）＝ ${psw.lowSet.toFixed(3)} MPa`, 2600);
                            }
                            await _sleep(400);
                        },
                    },
                    {
                        type: 'observe', target: 'psw1', msg: '观察「压力上限」＝报警复位值',
                        async act() {
                            const sys = _sysOf(this);
                            const psw = _comp(sys, 'psw1');
                            const el = document.getElementById('diag_highSet');
                            if (el && this._flashDomElement) {
                                await this._flashDomElement(el, `压力上限（报警复位值）＝ ${psw.highSet.toFixed(3)} MPa`, 2600);
                            }
                            if (this._projFlag) this._projFlag.s4Observed = true;
                            await _sleep(400);
                        },
                    },
                ],
                check() {
                    const sys = _sysOf(this);
                    const flag = this._projFlag || {};
                    const dlgOpen = !!document.getElementById('diag_lowSet') && !!document.getElementById('diag_highSet');
                    return flag.s4Observed === true || dlgOpen;
                },
            },
            // ⑤ 拧螺钉：下限 0.18 MPa、幅差 0.03 MPa
            {
                msg: '第 5 步：拧螺钉把下限调到 0.18、幅差调到 0.03。',
                mode: 'check',
                op: [
                    {
                        type: 'observe', target: 'psw1', msg: '点「取消」关闭参数界面，回到 MIMIC 图',
                        async act() {
                            const btns = Array.prototype.filter.call(document.querySelectorAll('button'),
                                b => String(b.textContent).trim() === '取消');
                            const cancel = btns[btns.length - 1];
                            if (cancel) {
                                if (this._flashDomElement) await this._flashDomElement(cancel, '点「取消」关闭参数界面（参数在螺钉上调整）', 1500);
                                cancel.click();
                            }
                            await _sleep(600);
                        },
                    },
                    {
                        type: 'observe', target: 'psw1', part: 'setscrew',
                        msg: '顺时针拧「给定值」螺钉 3 格 → 下限 0.18 MPa',
                        async act() {
                            const sys = _sysOf(this);
                            this._tipWorkflow('给定值螺钉每格 2 %：30 % → 36 %，下限由 0.15 升到 0.18 MPa', 7000);
                            await _turnScrew(sys, 'set', +1, 3);
                            await _sleep(600);
                        },
                    },
                    {
                        type: 'observe', target: 'psw1', part: 'diffscrew',
                        msg: '拧「幅差」螺钉 10 格 → 幅差 0.03 MPa',
                        async act() {
                            const sys = _sysOf(this);
                            this._tipWorkflow('幅差螺钉每格 2 %：30 % → 10 %，幅差 0.05 → 0.03 MPa（上限 0.21 MPa）', 7000);
                            await _turnScrew(sys, 'diff', -1, 10);
                            await _sleep(600);
                        },
                    },
                ],
                check() {
                    const sys = _sysOf(this);
                    const psw = _comp(sys, 'psw1');
                    return !!psw && Math.abs(psw.lowSet - 0.18) < 0.006 && Math.abs(psw.highSet - 0.21) < 0.006;
                },
            },
            // ⑥ 测量管路转手摇泵、压力 0.17 MPa → 回主界面等报警
            {
                msg: '第 6 步：点压力开关下方三通阀手柄，压力开关测量管路接手摇泵。手摇泵压力调到 0.17 MPa，回主界面等报警。',
                mode: 'check',
                op: [
                    {
                        type: 'switch', target: 'lomimic', part: 'cv3c',
                        msg: '点压力开关下方三通阀手柄 → 测量管路接手摇泵',
                        async act() {
                            const sys = _sysOf(this);
                            const mim = _comp(sys, 'lomimic');
                            if (mim && mim.m && mim.m.sw3b !== 'pump') {
                                _firePartClick(mim, 'cv3c');
                                await _waitFor(sys, s => { const c = _comp(s, 'lomimic'); return !!(c && c.m && c.m.sw3b === 'pump'); }, 3000);
                            }
                            await _sleep(600);
                        },
                    },
                    {
                        type: 'knob', target: 'lomimic', part: 'hp2-dn',
                        msg: '点「−」把手摇泵压力降到 0.17 MPa（低于下限 0.18）',
                        async act() {
                            const sys = _sysOf(this);
                            this._tipWorkflow('压力低于 0.18 MPa 时 NC 触点闭合（开关量动作＝1），触发低压报警', 7000);
                            await _setHandPressure(sys, 0.17, 'psw');
                            await _sleep(600);
                        },
                    },
                    {
                        type: 'page', page: 1, msg: '回到报警系统主界面',
                        async act() {
                            const sys = _sysOf(this);
                            this._tipWorkflow('延时已改为 10 s：触点持续动作超过 10 s 才报警…', 8000);
                            await _waitFor(sys, s => _activeAlarm(s, 'ME-LO-PR-SW'), 40000, 200);
                            await _sleep(1200);
                        },
                    },
                    {
                        type: 'observe', target: 'kchief', part: 'tb-counter',
                        msg: '未确认报警计数变为 1，出现 ME-LO-PR-SW 报警',
                    },
                ],
                check() {
                    const sys = _sysOf(this);
                    const mim = _comp(sys, 'lomimic');
                    const onPage = !sys.pageMgr || sys.pageMgr.currentPage === 1;
                    return onPage && !!mim && !!mim.m && Math.abs(mim.m.handP2 - 0.17) < 0.006
                        && _activeAlarm(sys, 'ME-LO-PR-SW');
                },
            },
            // ⑦ 回 MIMIC 图，压力升到 0.22 MPa
            {
                msg: '第 7 步：回 MIMIC 图把手摇泵压力调到 0.22 MPa。',
                mode: 'check',
                op: [
                    {
                        type: 'page', page: 5, msg: '切换到「主机滑油系统 MIMIC」页',
                        async act() { await _sleep(400); },
                    },
                    {
                        type: 'knob', target: 'lomimic', part: 'hp2-up',
                        msg: '点「+」把手摇泵压力升到 0.22 MPa（高于上限 0.21）',
                        async act() {
                            const sys = _sysOf(this);
                            this._tipWorkflow('压力升过上限 0.21 MPa 后触点才复位（这就是幅差／回差的作用）', 7000);
                            await _setHandPressure(sys, 0.22, 'psw');
                            await _sleep(600);
                        },
                    },
                ],
                check() {
                    const sys = _sysOf(this);
                    const mim = _comp(sys, 'lomimic');
                    const onPage = !sys.pageMgr || sys.pageMgr.currentPage === 5;
                    return onPage && !!mim && !!mim.m && Math.abs(mim.m.handP2 - 0.22) < 0.006;
                },
            },
            // ⑧ 回主界面，报警已返回 → 确认 ACK 复位
            {
                msg: '第 8 步：报警已返回，按确认 ACK 使报警复位。',
                mode: 'check',
                op: [
                    {
                        type: 'page', page: 1, msg: '回到报警系统主界面',
                        async act() {
                            const sys = _sysOf(this);
                            this._tipWorkflow('触点复位（实测值回到 0），报警自动恢复正常（黄色，待确认）…', 8000);
                            await _waitFor(sys, s => {
                                const M = _M(s); const al = M && M.alarmOf('ME-LO-PR-SW');
                                return !al || al.state === 'RTN';
                            }, 20000, 200);
                            await _sleep(1000);
                            if (this._projFlag) {
                                const M = _M(sys); const al = M && M.alarmOf('ME-LO-PR-SW');
                                this._projFlag.s8Returned = !!(al && al.state === 'RTN');
                            }
                        },
                    },
                    {
                        type: 'observe', target: 'kchief',
                        part: function () { return _rowPartOfTag(_sysOf(this), 'ME-LO-PR-SW'); },
                        msg: '报警条显示「已恢复正常（未确认）」',
                    },
                    {
                        type: 'btn', target: 'kchief', part: 'tb-ack', msg: '按工具栏「确认 ACK」复位报警',
                        async act() {
                            const sys = _sysOf(this);
                            await _click(sys, 'kchief', 'tb-ack');
                            await _waitFor(sys, s => !_activeAlarm(s, 'ME-LO-PR-SW'), 8000);
                            await _sleep(800);
                        },
                    },
                ],
                check() {
                    const sys = _sysOf(this);
                    const M = _M(sys);
                    const flag = this._projFlag || {};
                    const h = M && M.history.find(x => x.tagId === 'ME-LO-PR-SW');
                    return !_activeAlarm(sys, 'ME-LO-PR-SW') && !!h
                        && (flag.s8Returned === true || h.state === 'RTN');
                },
            },
        ],
    },

};

// ═══════════════════════════════════════════════════════════
// 页面定义（多页工程：页 0 索引 + 2 个电路页）
// ═══════════════════════════════════════════════════════════

export const PROJECT_PAGES = [
    { id: 0, name: '索引', type: 'index' },
    {
        id: 1, name: '报警系统主界面', comps: ['kchief'],
        desc: 'K-Chief 600 操作站 Home 菜单：表格视图（当前报警 / 标签一览 / 被闭锁标签…）、'
            + '工艺流程图入口、Dock 报警组计数、报警确认与测点报警参数设置',
    },
    {
        id: 2, name: '延伸报警单元', comps: ['extunit'],
        desc: '驾驶室 / 轮机长 / 大管轮 / 二管轮 / 三管轮 / 电机员六块值班面板：'
            + 'On Watch 值班位置、Duty 值班交接、延伸报警就地确认、轮机员呼叫',
    },
    {
        id: 3, name: '现场总线型系统结构', comps: ['topo'],
        desc: 'K-Chief 600 现场总线型机舱监视与报警系统拓扑：住舱 / 驾驶台（WCU、OS、WBU）、'
            + '集控室（OS/SGW、Printer、UPS、CAN Bus 3 / Ethernet 1·2）、机舱（CAN Bus 1·2、'
            + 'dPSC 分布式处理单元 RDi-32 / RDo-16 / RAi-16 / RAo-8 / RAi-10tc / RIO-C4、LOS、MOS）',
    },
    {
        id: 4, name: '轮机员安全系统', comps: ['deadman'],
        desc: '轮机员安全系统（Dead Man System）三块操作面板：集控室操作面板、机舱左入口面板、'
            + '机舱右入口面板；自复位启停旋钮、任意复位按钮清零、预警/报警时间设置，'
            + '超时触发 DEADMAN 报警并延伸至驾驶室与轮机长值班面板',
    },
    {
        id: 5, name: '主机滑油系统 MIMIC', comps: ['lomimic', 'psw1'],
        desc: '主机滑油系统流程图：柴油机 → 滑油循环柜 → 两台并联滑油泵（截止阀/泵/单向阀）'
            + ' → 旁通与滑油冷却器 → 三通调节阀 → 滤器 → YT1226 压力开关与压力变送器 → 柴油机右下入口；'
            + '含温度传感器与 PID 调节器面板、两台滑油泵控制面板',
    },
];

// ═══════════════════════════════════════════════════════════
// 组件配置（1920 × 1080 基准坐标）
// ═══════════════════════════════════════════════════════════

export const componentConfigs = [
    { Class: KChiefConsole, id: 'kchief', x: -160, y: 20, page: 1, visible: true },
    { Class: ExtensionAlarmUnit, id: 'extunit', x: -150, y: 20, page: 2, visible: true },
    { Class: FieldbusTopology, id: 'topo', x: -100, y: 5, page: 3, visible: true },
    { Class: DeadmanPanel, id: 'deadman', x: -120, y: 50, page: 4, visible: true },
    { Class: MainEngineLubeOilMimic, id: 'lomimic', x: -120, y: 10, page: 5, visible: true },
    { Class: PressRelay, id: 'psw1', x: 220, y: 30, page: 5, visible: true, lowStart: 0, lowEnd: 0.5, diffStart: 0.02, diffEnd: 0.12, setPoint: 30, differential: 30 },

    // ══ 7 种标准仪表（默认隐藏，通过「选择仪表」调出）══
    { Class: Multimeter, id: 'multimeter', x: 700, y: 200, page: 1, visible: false },
    { Class: MF47Multimeter, id: 'mf47-panel', x: 700, y: 200, page: 1, visible: false },
    { Class: Oscilloscope_tri, id: 'osc', x: 700, y: 200, page: 1, visible: false },
    { Class: SignalGenerator, id: 'sg', x: 700, y: 200, page: 1, visible: false },
    { Class: ProcessCalibrator, id: 'cali', x: 700, y: 200, page: 1, visible: false },
    { Class: ElecMeter, id: 'elecmeter', x: 700, y: 200, page: 1, visible: false },
    { Class: RealMegohmMeter, id: 'megohm', x: 700, y: 200, page: 1, visible: false },
];

// ═══════════════════════════════════════════════════════════
// 工具栏快捷操作
// ═══════════════════════════════════════════════════════════

export function initSlider(sys) {
    if (!sys) return;
    sys._noBlinkHighlight = true;
}

export function applyAllPresets(opts) {
    // 本工程为纯数据监视系统（无电气/管路端口），无需接线
    if (opts && opts.init) return;
    const sys = _sysOf(this);
    if (!sys) return;
}

export async function applyStartSystem() {
    const sys = _sysOf(this);
    if (!sys) return;
    await _resetRig(sys);
    if (sys.pageMgr) sys.pageMgr.navigateTo(1);
    sys.redrawAll && sys.redrawAll();
}

/** 5 点步进：依次让每个测点进入报警状态，便于逐点观察（再按一次切换下一个） */
let _step5Idx = 0;
export function fiveStep() {
    const sys = _sysOf(this);
    const M = _M(sys);
    if (!M) return;
    const order = [null, 'ME-LO-P', 'ME-CW-T', 'ME-FO-P', 'AUX-BLR-L', 'BLG-LV'];
    _step5Idx = (_step5Idx + 1) % order.length;
    const cur = order[_step5Idx];
    // 清掉上一次注入
    ['ME-LO-P', 'ME-CW-T', 'ME-FO-P', 'AUX-BLR-L', 'AUX-AC-T', 'BLG-LV'].forEach(id => M.setFault(id, false));
    if (cur) {
        M.setFault(cur, true);
        const tag = M.tag(cur);
    } else {
    }
    if (sys.pageMgr) sys.pageMgr.navigateTo(1);
    sys.redrawAll && sys.redrawAll();
}
