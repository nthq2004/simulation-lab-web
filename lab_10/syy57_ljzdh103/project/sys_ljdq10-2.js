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
 *  流程：（原有 4 条流程已按要求删除，PROJECT_WORKFLOWS 现为空表，待重新编写）
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

/** 复位：清故障、清报警、参数恢复初值、关闭浮层 */
async function _resetRig(sys) {
    if (!sys) return;
    const M = _M(sys);
    if (M) M.reset();
    const c = _kc(sys);
    if (c && c.closeWatchCall) c.closeWatchCall();
    if (c && c._closeOverlay) c._closeOverlay();
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

// ═══════════════════════════════════════════════════════════════
// 工作流
// ═══════════════════════════════════════════════════════════════

export const PROJECT_WORKFLOWS = {

    // ══════════════════════════════════════════════════════
    // 流程一：值班切换（值班呼叫 → 接班 → 交班 → 退班）
    // ══════════════════════════════════════════════════════
    'duty-shift': {
        id: 'duty-shift', name: '1. 值班切换',
        steps: [
            // ① 调出值班呼叫对话框
            {
                msg: '第 1 步：在报警系统页点「ECR watch」，调出值班切换对话框。',
                mode: 'check',
                op: [
                    { type: 'page', page: 1, msg: '切换到「报警系统主界面」页' },
                    {
                        type: 'btn', target: 'kchief', part: 'watch-box', msg: '点「ECR watch」调出值班切换对话框',
                        async act() {
                            const sys = _sysOf(this);
                            await _resetRig(sys);         // 从干净状态开始：无人值班、无呼叫、无报警
                            await _ensureWatchCall(sys);
                            await _waitFor(sys, s => { const k = _kc(s); return !!(k && k._watchCallOpen); }, 5000);
                        },
                    },
                ],
                check() {
                    const sys = _sysOf(this); const c = _kc(sys);
                    return !!c && c._watchCallOpen === true
                        && !!sys.pageMgr && sys.pageMgr.currentPage === 1;
                },
            },
            // ② 呼叫三管轮（4TH ENG.）
            {
                msg: '第 2 步：点「4TH ENG.」，呼叫三管轮。',
                mode: 'check',
                op: [
                    {
                        type: 'btn', target: 'kchief', part: 'wc-duty-third', msg: '点「4TH ENG.」发起值班呼叫',
                        async act() {
                            const sys = _sysOf(this);
                            await _ensureWatchCall(sys);
                            await _click(sys, 'kchief', 'wc-duty-third');
                            await _waitFor(sys, s => { const M = _M(s); return !!(M && M.callTarget === 'third'); }, 5000);
                        },
                    },
                ],
                check() {
                    const M = _M(_sysOf(this));
                    return !!M && M.callTarget === 'third';
                },
            },
            // ③ 三管轮应答，进入值班状态
            {
                msg: '第 3 步：切到值班系统页，三管轮按扬声器应答，进入三管轮值班。',
                mode: 'check',
                op: [
                    { type: 'page', page: 2, msg: '切换到「延伸报警单元」页' },
                    {
                        type: 'btn', target: 'extunit', part: 'third-buzz', msg: '三管轮按下闪烁的扬声器（消声）应答呼叫',
                        async act() {
                            const sys = _sysOf(this);
                            await _click(sys, 'extunit', 'third-buzz');
                            await _waitFor(sys, s => { const M = _M(s); return !!(M && M.dutyPanel === 'third'); }, 6000);
                        },
                    },
                ],
                check() {
                    const sys = _sysOf(this); const M = _M(sys);
                    return !!M && M.dutyPanel === 'third' && !M.callTarget
                        && !!sys.pageMgr && sys.pageMgr.currentPage === 2;
                },
            },
            // ④ 呼叫二管轮接班
            {
                msg: '第 4 步：回报警系统页，点「3RD ENG.」，呼叫二管轮接班。',
                mode: 'check',
                op: [
                    { type: 'page', page: 1, msg: '切换到「报警系统主界面」页' },
                    {
                        type: 'btn', target: 'kchief', part: 'wc-duty-second', msg: '点「3RD ENG.」呼叫二管轮接班',
                        async act() {
                            const sys = _sysOf(this);
                            await _ensureWatchCall(sys);
                            await _click(sys, 'kchief', 'wc-duty-second');
                            await _waitFor(sys, s => { const M = _M(s); return !!(M && M.callTarget === 'second'); }, 5000);
                        },
                    },
                ],
                check() {
                    const sys = _sysOf(this); const M = _M(sys);
                    return !!M && M.callTarget === 'second'
                        && !!sys.pageMgr && sys.pageMgr.currentPage === 1;
                },
            },
            // ⑤ 二管轮应答，进入交班（待原值班者确认）
            {
                msg: '第 5 步：切到值班系统页，二管轮按扬声器应答，进入交班状态。',
                mode: 'check',
                op: [
                    { type: 'page', page: 2, msg: '切换到「延伸报警单元」页' },
                    {
                        type: 'btn', target: 'extunit', part: 'second-buzz', msg: '二管轮按下闪烁的扬声器应答 → 待接班',
                        async act() {
                            const sys = _sysOf(this);
                            await _click(sys, 'extunit', 'second-buzz');
                            await _waitFor(sys, s => { const M = _M(s); return !!(M && M.pendingDuty === 'second'); }, 6000);
                        },
                    },
                ],
                check() {
                    const sys = _sysOf(this); const M = _M(sys);
                    return !!M && M.pendingDuty === 'second' && M.dutyPanel === 'third'
                        && !!sys.pageMgr && sys.pageMgr.currentPage === 2;
                },
            },
            // ⑥ 三管轮退班，二管轮接班
            {
                msg: '第 6 步：回报警系统页，点「4TH ENG.」，三管轮退班、二管轮接班。',
                mode: 'check',
                op: [
                    { type: 'page', page: 1, msg: '切换到「报警系统主界面」页' },
                    {
                        type: 'btn', target: 'kchief', part: 'wc-duty-third', msg: '点「4TH ENG.」交班：三管轮解除值班',
                        async act() {
                            const sys = _sysOf(this);
                            await _ensureWatchCall(sys);
                            await _click(sys, 'kchief', 'wc-duty-third');
                            await _waitFor(sys, s => { const M = _M(s); return !!(M && M.dutyPanel === 'second' && !M.pendingDuty); }, 6000);
                        },
                    },
                ],
                check() {
                    const sys = _sysOf(this); const M = _M(sys);
                    return !!M && M.dutyPanel === 'second' && !M.pendingDuty
                        && !!sys.pageMgr && sys.pageMgr.currentPage === 1;
                },
            },
        ],
    },

    // ══════════════════════════════════════════════════════
    // 流程二：失职（重复）报警的功能验证
    // ══════════════════════════════════════════════════════
    'repeat-alarm': {
        id: 'repeat-alarm', name: '2. 失职报警的功能验证',
        steps: [
            // ① 右键 → 参数设置，把失职报警延时 3 min 改为 30 s
            {
                msg: '第 1 步：右键报警系统 → 参数设置，把失职报警延时由 3 min 改为 30 s。',
                mode: 'check',
                op: [
                    { type: 'page', page: 1, msg: '切换到「报警系统主界面」页' },
                    {
                        type: 'btn', target: 'kchief', part: 'panel-body', msg: '在报警系统面板上点右键，选「参数设置」',
                        async act() { await _demoSetRepeatDelay(this, 30); },
                    },
                ],
                check() {
                    const M = _M(_sysOf(this));
                    return !!M && Number(M.repeatDelay) === 30;
                },
            },
            // ② 调出值班切换对话框
            {
                msg: '第 2 步：点「ECR watch」，调出值班切换对话框。',
                mode: 'check',
                op: [
                    {
                        type: 'btn', target: 'kchief', part: 'watch-box', msg: '点「ECR watch」调出值班切换对话框',
                        async act() {
                            const sys = _sysOf(this);
                            await _ensureWatchCall(sys);
                            await _waitFor(sys, s => { const k = _kc(s); return !!(k && k._watchCallOpen); }, 5000);
                        },
                    },
                ],
                check() {
                    const sys = _sysOf(this); const c = _kc(sys);
                    return !!c && c._watchCallOpen === true
                        && !!sys.pageMgr && sys.pageMgr.currentPage === 1;
                },
            },
            // ③ 呼叫三管轮（4TH ENG.）
            {
                msg: '第 3 步：点「4TH ENG.」，呼叫三管轮。',
                mode: 'check',
                op: [
                    {
                        type: 'btn', target: 'kchief', part: 'wc-duty-third', msg: '点「4TH ENG.」发起值班呼叫',
                        async act() {
                            const sys = _sysOf(this);
                            await _ensureWatchCall(sys);
                            await _click(sys, 'kchief', 'wc-duty-third');
                            await _waitFor(sys, s => { const M = _M(s); return !!(M && M.callTarget === 'third'); }, 5000);
                        },
                    },
                ],
                check() {
                    const M = _M(_sysOf(this));
                    return !!M && M.callTarget === 'third';
                },
            },
            // ④ 三管轮应答，进入值班状态
            {
                msg: '第 4 步：切到值班系统页，三管轮按扬声器应答，进入三管轮值班。',
                mode: 'check',
                op: [
                    { type: 'page', page: 2, msg: '切换到「延伸报警单元」页' },
                    {
                        type: 'btn', target: 'extunit', part: 'third-buzz', msg: '三管轮按下闪烁的扬声器（消声）应答呼叫',
                        async act() {
                            const sys = _sysOf(this);
                            await _click(sys, 'extunit', 'third-buzz');
                            await _waitFor(sys, s => { const M = _M(s); return !!(M && M.dutyPanel === 'third'); }, 6000);
                        },
                    },
                ],
                check() {
                    const sys = _sysOf(this); const M = _M(sys);
                    return !!M && M.dutyPanel === 'third' && !M.callTarget
                        && !!sys.pageMgr && sys.pageMgr.currentPage === 2;
                },
            },
            // ⑤ 故障设置：主机缸套冷却水出口温度高
            {
                msg: '第 5 步：故障设置里勾选「主机缸套冷却水出口温度高」并应用。',
                mode: 'check',
                op: [
                    {
                        type: 'fault', fault: 'me-cw-temp', msg: '勾选「主机缸套冷却水出口温度高（冷却器脏堵）」并应用',
                        async act() {
                            const sys = _sysOf(this);
                            this._tipWorkflow('等待报警产生（温度越限 + 5 s 报警延时）…', 6000);
                            await _waitFor(sys, s => {
                                const M = _M(s);
                                return !!(M && M.alarms.some(a => a.tagId === 'ME-CW-T'));
                            }, 30000, 200);
                            await _sleep(1200);
                        },
                    },
                    {
                        type: 'observe', target: 'extunit', part: 'third-soundoff', msg: '三管轮值班面板进入报警（红色报警区 + Sound off）',
                    },
                ],
                check() {
                    const M = _M(_sysOf(this));
                    return !!M && M.alarms.some(a => a.tagId === 'ME-CW-T')
                        && !!M.tag('ME-CW-T') && M.tag('ME-CW-T').fault === true;
                },
            },
            // ⑥ 三管轮面板消声，但主站不确认
            {
                msg: '第 6 步：三管轮在值班面板按 Sound off 消声，主站暂不确认。',
                mode: 'check',
                op: [
                    {
                        type: 'btn', target: 'extunit', part: 'third-soundoff', msg: '三管轮按「Sound off」本面板消音（主站仍闪烁）',
                        async act() {
                            const sys = _sysOf(this);
                            await _click(sys, 'extunit', 'third-soundoff');
                            await _waitFor(sys, s => { const M = _M(s); return !!(M && M.extMuted.third); }, 5000);
                            this._projFlag.s6Muted = true;
                        },
                    },
                ],
                check() {
                    const M = _M(_sysOf(this));
                    return !!M && M.extMuted.third === true && M.unackCount() > 0;
                },
            },
            // ⑦ 30 s 延时到 → 驾驶台与轮机长面板触发 REPEAT（失职报警）
            {
                msg: '第 7 步：30 s 延时到，驾驶台与轮机长面板出现 REPEAT 失职报警。',
                mode: 'check',
                op: [
                    {
                        type: 'observe', target: 'extunit', part: 'bridge-repeat', msg: '等待 30 s：驾驶台面板状态栏触发 REPEAT',
                        async act() {
                            const sys = _sysOf(this);
                            this._tipWorkflow('失职报警计时中：主站 30 s 内未确认即报 REPEAT…', 8000);
                            await _waitFor(sys, s => { const M = _M(s); return !!(M && M.repeatActive); }, 45000, 200);
                            this._projFlag.s7Repeat = true;
                            await _sleep(1500);
                        },
                    },
                    {
                        type: 'observe', target: 'extunit', part: 'chief-repeat', msg: '轮机长面板状态栏同样显示 REPEAT',
                    },
                ],
                check() {
                    const sys = _sysOf(this); const M = _M(sys);
                    if (!M || !M.repeatActive) return false;
                    const ex = _ext(sys);
                    const rec = ex && ex._st ? ex._st.bridge : null;
                    return !rec || !rec.repeatText || rec.repeatText.visible() !== false;
                },
            },
            // ⑧ 主站确认 ACK，失职报警消失
            {
                msg: '第 8 步：回报警系统点「确认 ACK」，REPEAT 消失。',
                mode: 'check',
                op: [
                    { type: 'page', page: 1, msg: '切换到「报警系统主界面」页' },
                    {
                        type: 'btn', target: 'kchief', part: 'tb-ack', msg: '点工具栏「确认 ACK」确认报警',
                        async act() {
                            const sys = _sysOf(this);
                            await _click(sys, 'kchief', 'tb-ack');
                            await _waitFor(sys, s => { const M = _M(s); return !!(M && !M.repeatActive); }, 8000);
                        },
                    },
                ],
                check() {
                    const sys = _sysOf(this); const M = _M(sys);
                    return !!M && M.repeatActive === false && M.unackCount() === 0
                        && !!sys.pageMgr && sys.pageMgr.currentPage === 1;
                },
            },
        ],
    },

    // ══════════════════════════════════════════════════════
    // 流程三：轮机员安全报警（Dead Man）的功能验证
    // ══════════════════════════════════════════════════════
    'deadman-alarm': {
        id: 'deadman-alarm', name: '3. 轮机员安全报警的功能验证',
        steps: [
            // ① 在集控台旋钮打到「开」，系统开始计时
            {
                msg: '第 1 步：到轮机员安全系统页，在集控台把旋钮打到「开」，系统启动计时。',
                mode: 'check',
                op: [
                    { type: 'page', page: 4, msg: '切换到「轮机员安全系统」页' },
                    {
                        type: 'switch', target: 'deadman', part: 'ecr-switch-right', msg: '按住集控台旋钮右半「开」，松手后指针回中位',
                        async act() {
                            const sys = _sysOf(this);
                            const dm = _dm(sys);
                            await _resetRig(sys);                 // 干净状态：无报警、无 DEADMAN
                            if (dm) dm.stop();
                            await _sleep(300);
                            await _pressDeadmanSwitch(sys, 'ecr-switch-right');
                            await _waitFor(sys, s => { const d = _dm(s); return !!(d && d.dead.running); }, 5000);
                        },
                    },
                ],
                check() {
                    const sys = _sysOf(this); const dm = _dm(sys);
                    return !!dm && dm.dead.running === true
                        && !!sys.pageMgr && sys.pageMgr.currentPage === 4;
                },
            },
            // ② 点「时间设置」跳出时间设置界面
            {
                msg: '第 2 步：点「时间设置」，弹出时间设置界面。',
                mode: 'check',
                op: [
                    {
                        type: 'btn', target: 'deadman', part: 'ecr-time', msg: '点「时间设置」调出设置界面',
                        async act() {
                            const sys = _sysOf(this);
                            await _ensureTimeDialog(sys, true);
                        },
                    },
                ],
                check() {
                    const d = document.getElementById('deadman_time_dlg');
                    const sys = _sysOf(this);
                    return !!d && d.style.display !== 'none'
                        && !!sys.pageMgr && sys.pageMgr.currentPage === 4;
                },
            },
            // ③ 预警 1 min、报警 0.5 min
            {
                msg: '第 3 步：把预警时间改为 1 min，报警时间改为 0.5 min。',
                mode: 'check',
                op: [
                    {
                        type: 'observe', target: 'deadman', part: 'ecr-time', msg: '预警时间 1.0 min、报警时间 0.5 min',
                        async act() { await _setDeadmanTimes(this, _sysOf(this), 1, 0.5); },
                    },
                ],
                check() {
                    const dm = _dm(_sysOf(this));
                    return !!dm && Number(dm.dead.preWarn) === 1 && Number(dm.dead.alarmTime) === 0.5;
                },
            },
            // ④ 按复位按钮，计时清零重新计时
            {
                msg: '第 4 步：按下复位按钮，计时清零后重新开始计时。',
                mode: 'check',
                op: [
                    {
                        type: 'btn', target: 'deadman', part: 'ecr-reset', msg: '按集控台「复位」按钮，计时清零',
                        async act() {
                            const sys = _sysOf(this);
                            await _pressClick(sys, 'deadman', 'ecr-reset');
                            await _waitFor(sys, s => { const d = _dm(s); return !!(d && d.dead.t < 3); }, 4000);
                            this._projFlag.s4Reset = true;
                            await _sleep(600);
                        },
                    },
                ],
                check() {
                    const dm = _dm(_sysOf(this));
                    return !!dm && dm.dead.running === true && dm.dead.t <= 5
                        && dm.dead.engineAlarm === false && dm.dead.deadman === false;
                },
            },
            // ⑤ 等 1 min：机舱蜂鸣器报警（不复位）
            {
                msg: '第 5 步：等 1 min 预警时间到，机舱蜂鸣器报警，此时不复位。',
                mode: 'check',
                op: [
                    {
                        type: 'observe', target: 'deadman', part: 'ecr-buzz', msg: '预警 1 min 到：机舱蜂鸣器闪烁报警（暂不复位）',
                        async act() {
                            const sys = _sysOf(this);
                            this._tipWorkflow('预警计时中：1 min 到即机舱蜂鸣器报警…', 8000);
                            await _waitFor(sys, s => { const d = _dm(s); return !!(d && d.dead.engineAlarm); }, 80000, 200);
                            this._projFlag.s5Buzz = true;
                            await _sleep(1500);
                            await _ensureTimeDialog(sys, false);   // 收起时间设置界面，便于切页观察
                        },
                    },
                ],
                check() {
                    const dm = _dm(_sysOf(this));
                    return !!dm && dm.dead.engineAlarm === true && dm.dead.deadman === false;
                },
            },
            // ⑥ 切到报警系统页，再等 30 s → DEADMAN 报警
            {
                msg: '第 6 步：切到报警系统页，再等 30 s 触发轮机员安全（DEADMAN）报警。',
                mode: 'check',
                op: [
                    { type: 'page', page: 1, msg: '切换到「报警系统主界面」页' },
                    {
                        type: 'observe', target: 'kchief', part: 'tb-counter', msg: '再等 30 s：主站出现 A 级 DEADMAN 报警',
                        async act() {
                            const sys = _sysOf(this);
                            this._tipWorkflow('报警计时中：再 30 s 未复位即触发 DEADMAN 报警…', 8000);
                            await _waitFor(sys, s => {
                                const M = _M(s); const d = _dm(s);
                                return !!(M && M.deadmanActive && d && d.dead.deadman);
                            }, 70000, 200);
                            this._projFlag.s6Deadman = true;
                            await _sleep(1500);
                        },
                    },
                ],
                check() {
                    const sys = _sysOf(this); const M = _M(sys); const dm = _dm(sys);
                    return !!M && M.deadmanActive === true
                        && M.alarms.some(a => a.tagId === 'DEADMAN')
                        && !!dm && dm.dead.deadman === true
                        && !!sys.pageMgr && sys.pageMgr.currentPage === 1;
                },
            },
            // ⑦ 回到安全系统页，复位警报
            {
                msg: '第 7 步：回到轮机员安全系统页，按「复位」清除 DEADMAN 报警。',
                mode: 'check',
                op: [
                    { type: 'page', page: 4, msg: '切换到「轮机员安全系统」页' },
                    {
                        type: 'btn', target: 'deadman', part: 'ecr-reset', msg: '按「复位」按钮，DEADMAN 报警与蜂鸣器一起消除',
                        async act() {
                            const sys = _sysOf(this);
                            await _pressClick(sys, 'deadman', 'ecr-reset');
                            await _waitFor(sys, s => {
                                const M = _M(s); const d = _dm(s);
                                return !!(M && !M.deadmanActive && d && !d.dead.deadman && !d.dead.engineAlarm);
                            }, 6000);
                            await _sleep(800);
                        },
                    },
                ],
                check() {
                    const sys = _sysOf(this); const M = _M(sys); const dm = _dm(sys);
                    return !!M && M.deadmanActive === false
                        && !M.alarms.some(a => a.tagId === 'DEADMAN')
                        && !!dm && dm.dead.deadman === false && dm.dead.engineAlarm === false
                        && !!sys.pageMgr && sys.pageMgr.currentPage === 4;
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
