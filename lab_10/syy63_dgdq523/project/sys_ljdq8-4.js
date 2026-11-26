/**
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
 *  流程：1. 主机安全保护装置的使用操作
 *        （驾控台 Safety System → Shut Down 页：逐项越控（J.C.F.W. 低压）、总 Cancel SHD 全越控、
 *         取消越控与消音复位 → Slow Down 页：逐项越控（滑油进口温度高）、总 Cancel SLD 全越控、取消与复位）
 *        2. 主机超速保护实验
 *        （车钟拉回 STOP → 气动页确认主起动阀关闭 → 滑油系统确认泵运行 → 集控台 Safety System →
 *         RPM Detector：模拟转速 65 / 试验值 78、两开关 ON → 模拟转速调 85 触发超速停车 →
 *         驾控台消音 ACK → 集控台模拟转速调回 65，超速报警复位后再消音 ACK）
 *        3. 主机滑油低压保护模拟实验
 *        （压力开关取压转手摇泵 → 0.14 MPa 压力开关闭合 → 驾控台自动停车与消音应答
 *         → 升到 0.21 MPa 开关复位 → 车钟拉回 STOP 复位停车）
 *        附：K-Chief 报警系统流程（模拟量参数的修改 / 开关量参数的修改）见下方说明
 *        （报警组 M/E LO SYSTEM → 双击 ME-LO-P 参数界面 → 下限改 0.22 MPa、回差改 0.06 MPa
 *         并保存 → MIMIC 图把 PT-101 测量管路转手摇泵 → 压力 0.21 MPa 触发低压报警
 *         → 压力回 0.29 MPa 越过下限＋回差，报警返回 → 按确认 ACK 复位）
 *        开关量参数的修改
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
import { CoolingWaterMimic } from '../components/CoolingWaterMimic.js';
import { CoolingWaterPID } from '../components/CoolingWaterPID.js';
import { PressRelay } from '../components/PressRelay.js';
import { Ac600ConsolePanel } from '../components/Ac600ConsolePanel.js';
import { Ac600LocalPanel } from '../components/Ac600LocalPanel.js';
import { Ac600PneumaticSystem } from '../components/Ac600PneumaticSystem.js';
import { Ac600Mimic } from '../components/Ac600Mimic.js';

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

/** 本工程不设故障设置（故障列表为空） */
export const FAULT_CONFIGS = {};

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

// ═══════════════════════════════════════════════════════════════
// 操作流程（多页工程：跨页操作一律先写 { type:'page', page:n }）
// ═══════════════════════════════════════════════════════════════

const _lo = (sys) => _comp(sys, 'lomimic');
const _bridge = (sys) => _comp(sys, 'ac600-bridge');
const _ac600 = (sys) => (sys && sys.ac600) || null;

/** 演示前复位：TIC-101 回自动（SV 45 ℃ / OUT 55 % / 温度 45 ℃）、清减速与报警、车钟回 NAV FULL */
function _resetAlarmDemo(sys) {
    const M = _ac600(sys);
    if (M) {
        M.cancelSLD = false;
        M.sldCancelled = false;
        M.sldPre = null;
        M.slowDown = false;
        M.sldAwaitReset = false;
        M.sldCauses = {};
        M.messages = [];
        M.alarm = false;
        M.alarmText = '';
        M.acked = true;
        M.silenced = false;
        try { M.setLeverById('nav-full', M.controlPos); } catch (e) { /* ignore */ }
    }
    const lo = _lo(sys);
    if (lo && lo.m) {
        const m = lo.m;
        m.pid.auto = true;
        m.pid.sv = 45;
        m.pid.out = 55;
        m.temp = 45;
        m.pid.pv = 45;
        lo._loSld = false;
        lo._loSldT = 0;
        lo._loPre = false;
    }
    const p = _bridge(sys);
    if (p) { p._menuPage = null; p._subPage = null; p._histRows = []; }
}

/**
 * 真实拖动驾控台车钟手柄到指定档位（用鼠标事件：mousedown → mousemove… → mouseup）
 * @param {number} idx 档位索引（TELEGRAPH：0 = NAV FULL … 3 = SLOW … 5 = STOP）
 */
async function _dragTelegraphTo(sys, compId, idx) {
    const c = _comp(sys, compId);
    const stage = sys && sys.stage;
    if (!c || !stage) return false;
    const cv = stage.container().querySelector('canvas');
    const part = c._parts && c._parts.telegraph;
    if (!cv || !part) return false;
    const rect = cv.getBoundingClientRect();
    const minY = c._telMinY, maxY = c._telMaxY;
    const startY = (c._telSlider && typeof c._telSlider.y === 'function') ? c._telSlider.y() : minY;
    const targetY = minY + (idx / 10) * (maxY - minY);
    const lx = part.x + part.w / 2;
    const toScreen = (ly) => {
        const abs = c.group.getAbsoluteTransform().point({ x: lx, y: ly });
        // Konva 的指针坐标是 CSS 像素（getAbsoluteTransform 同样是 CSS 像素空间），
        // 不能再乘 canvas 的像素比，否则派发点会偏（实测 dpr=1.5 时拖不动）
        return { x: rect.left + abs.x, y: rect.top + abs.y };
    };
    const send = (type, ly) => {
        const p = toScreen(ly);
        cv.dispatchEvent(new MouseEvent(type, {
            bubbles: true, cancelable: true, clientX: p.x, clientY: p.y, button: 0,
        }));
    };
    send('mousemove', startY);
    send('mousedown', startY);
    await _sleep(120);
    const steps = 12;
    for (let i = 1; i <= steps; i++) {
        send('mousemove', startY + (targetY - startY) * (i / steps));
        await _sleep(70);
    }
    send('mouseup', targetY);
    await _sleep(500);
    return true;
}

/**
 * 真实拖动「机旁调速手柄」大表盘到指定转速（鼠标事件；起拖点必须落在手柄上）
 * @param {number} rpm 目标转速（正车 0~68 / 倒车 0~−55）
 */
async function _dragLocalDialTo(sys, compId, rpm) {
    const c = _comp(sys, compId);
    const stage = sys && sys.stage;
    if (!c || !stage) return false;
    const cv = stage.container().querySelector('canvas');
    const part = c._parts && c._parts['local-dial'];
    if (!cv || !part) return false;
    const rect = cv.getBoundingClientRect();
    const cx = part.x + part.w / 2, cy = part.y + part.h / 2;   // 表盘圆心
    const MAXD = 135;
    const degOf = (v) => (v >= 0 ? (Math.min(68, v) / 68) * MAXD : (Math.max(-55, v) / 55) * MAXD);
    const cur = (c.model && typeof c.model.localSpeed === 'number') ? c.model.localSpeed : 0;
    const a0 = degOf(cur) * Math.PI / 180;
    const a1 = degOf(rpm) * Math.PI / 180;
    const R = 50;                                                // 手柄指示条半径（按在手柄上）
    const toScreen = (a) => {
        const abs = c.group.getAbsoluteTransform().point({ x: cx + Math.sin(a) * R, y: cy - Math.cos(a) * R });
        return { x: rect.left + abs.x, y: rect.top + abs.y };
    };
    const send = (type, a) => {
        const p = toScreen(a);
        cv.dispatchEvent(new MouseEvent(type, {
            bubbles: true, cancelable: true, clientX: p.x, clientY: p.y, button: 0,
        }));
    };
    send('mousemove', a0);
    send('mousedown', a0);
    await _sleep(120);
    for (let i = 1; i <= 12; i++) {
        send('mousemove', a0 + (a1 - a0) * (i / 12));
        await _sleep(60);
    }
    send('mouseup', a1);
    await _sleep(400);
    return true;
}

/** 手动把冷却口开度（OUT）按 ▼ 一路减小，直到小于 limit（每按一次 5 %，最多 30 次） */
async function _lowerCoolingOut(sys, limit = 5) {
    const c = _lo(sys);
    if (!c || !c.m) return false;
    for (let i = 0; i < 30; i++) {
        if (c.m.pid.out < limit) break;
        _firePartClick(c, 'pid-sv-dn');
        await _sleep(300);
    }
    return c.m.pid.out < limit;
}

// ── 主机安全保护装置（Safety System）操作辅助 ─────────────────────────

/** Shut Down 页带 Cancelled 灯（可越控）的条目 key */
const _SHD_CANCEL_KEYS = ['thrust', 'tc', 'jcw', 'eicu-a-c', 'eicu-b-c'];
/** Slow Down 页带 Cancelled 灯（可越控）的条目 key（全部 23 项都可越控） */
const _SLD_CANCEL_KEYS = ['sld', 'lo-p', 'lo-t', 'pco-nf', 'pco-t', 'thrust', 'mbrg', 'hps', 'jcw-p',
    'jcw-t', 'scav', 'exh-t', 'exh-d', 'vib', 'mist', 'wear', 'eicu-a', 'eicu-b', 'cyl', 'stern', 'thr-r',
    'jcw-l', 'jcw-c'];

/** 某行是否已选中 */
const _safSelIs = (c, page, key) => !!(c && c._safSel && c._safSel.page === page && c._safSel.key === key);

/** 某项是否已被逐项越控（Cancelled 灯变红） */
const _safIsCancelled = (c, page, key) => !!(c && typeof c._safIsCancelled === 'function' && c._safIsCancelled(page, key));

/** 该页所有可越控项是否全部越控 */
const _allSafCancelled = (c, page, keys) => keys.every((k) => _safIsCancelled(c, page, k));

/** 演示前复位：驾控台回主界面、清逐项越控、清三个 Cancel 与报警 */
function _resetSafetyDemo(sys) {
    const c = _bridge(sys);
    const M = _ac600(sys);
    if (c) {
        c._menuPage = null;
        c._subPage = null;
        c._directPage = null;
        c._safSel = null;
        c._safCancelled = {};
        c._safPrevShd = false;
        c._safPrevSld = false;
        c._safAutoShd = false;
        c._safAutoSld = false;
        c._safetyViewMode = 'all';
        c._listOffset = 0;
        c._cancel = { shd: false, sld: false, lim: false };
        c._menuNextRefresh = 0;
        try { c._renderBand(); c._renderMenu(); c._redraw(); } catch (e) { /* ignore */ }
    }
    if (M) {
        M.cancelSHDBy = { BRIDGE: false, ECR: false, LOCAL: false };
        M.cancelSLDBy = { BRIDGE: false, ECR: false, LOCAL: false };
        M.cancelLimBy = { BRIDGE: false, ECR: false, LOCAL: false };
        M.cancelSHD = false;
        M.cancelSLD = false;
        M.cancelLimits = false;
        M.sldCancelled = false;
        M.autoCancelLimits = false;
        M.cancelAlarmOn = { shd: false, sld: false, lim: false };
        M.messages = [];
        M.alarm = false;
        M.alarmText = '';
        M.acked = false;
        M.silenced = false;
    }
}

/** 点一个部件并等条件成立 */
async function _clickAwait(sys, compId, partId, cond, timeout = 6000) {
    await _click(sys, compId, partId);
    if (cond) await _waitFor(sys, cond, timeout, 120);
    await _sleep(400);
}

// ── 主机超速保护实验（RPM Detector）操作辅助 ─────────────────────────

const _ecr = (sys) => _comp(sys, 'ac600-ecr');
const _pneu = (sys) => _comp(sys, 'ac600-pneumatic');

/**
 * 等主机按降速程序停到 0（车钟已拉回 STOP）。
 * 68 → 57 rpm 走 Load Down 程序（2 min），57 → 0 走减速度限制（3 rpm/s），共约 2.5 min。
 * 每 15 s 用演示提示报一次当前转速，避免学员以为卡住。
 */
async function _waitEngineStopped(sys, maxMs = 260000) {
    const t0 = Date.now();
    let nextTip = 0;
    const wf = sys && sys.workflowComp;
    while (Date.now() - t0 < maxMs) {
        const M = _ac600(sys);
        if (!M || M.isStopped) return true;
        const el = Date.now() - t0;
        if (el >= nextTip) {
            nextTip = el + 15000;
            try {
                if (wf && typeof wf._tipWorkflow === 'function') {
                    wf._tipWorkflow(`主机降速中：当前 ${Number(M.rpm).toFixed(1)} rpm`
                        + '（Load Down 程序 68→57 rpm 约 2 min，之后按 3 rpm/s 减到停）', 7000);
                }
            } catch (e) { /* ignore */ }
        }
        await _sleep(500);
    }
    const M = _ac600(sys);
    return !!(M && M.isStopped);
}

/** RPM Detector 页当前的编辑输入框（_beginDetEdit 追加到 body，无 id，取最后一个） */
function _detInputEl() {
    const list = document.querySelectorAll('body > input');
    return list.length ? list[list.length - 1] : null;
}

/**
 * 双击 RPM Detector 页的白底数值框 → 填值 → 回车确认。
 * 组件用「450 ms 内两次 click」判定双击（不响应 dblclick），因此这里连点两次。
 */
async function _setDetValue(sys, field, value) {
    const c = _ecr(sys);
    if (!c) return false;
    const id = `det-edit-${field}`;
    const fire = () => {
        const n = c.getClickablePartNode(id);
        if (n && typeof n.fire === 'function') { n.fire('click'); return true; }
        return false;
    };
    for (let i = 0; i < 4; i++) {
        c._detLastClick = null;
        fire();
        await _sleep(90);
        fire();
        await _sleep(320);
        const inp = _detInputEl();
        if (inp) {
            inp.value = String(value);
            inp.dispatchEvent(new Event('input', { bubbles: true }));
            inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
            await _sleep(350);
            return true;
        }
        await _sleep(200);
    }
    return false;
}

/** 演示前复位：清超速试验开关与超速停车，两块面板回主界面、关掉报警 */
function _resetOverspeedDemo(sys) {
    const M = _ac600(sys);
    if (M) {
        M.overspeedTripped = false;
        M._osTestArmed = true;
        M.shutDown = false;
        M.shdResetArmed = false;
        M._shdStopAck = false;
        M.cancelSHD = false;
        M.cancelSLD = false;
        M.loLowLowShd = false;
        M.jcwLowShd = false;
        M.emStopped = false;
        M.emStopLatched = false;
        M.engineReady = true;
        M.startBlocked = false;
        M.alarm = false;
        M.alarmText = '';
        M.messages = [];
        M.acked = true;
        M.silenced = false;
        M.cancelAlarmOn = { shd: false, sld: false, lim: false };
        M.overspeedTest = {
            simOn: false, simRpm: 65.0, osTestOn: false, osTestRpm: 78.0, osLevel: 78.0,
            msg: '', msgUntil: 0,
        };
    }
    ['ac600-bridge', 'ac600-ecr'].forEach((cid) => {
        const c = _comp(sys, cid);
        if (!c) return;
        c._menuPage = null;
        c._subPage = null;
        c._directPage = null;
        c._listOffset = 0;
        c._safSel = null;
        c._safCancelled = {};
        c._cancel = { shd: false, sld: false, lim: false };
        c._detLastClick = null;
        c._detEditing = false;
        c._menuNextRefresh = 0;
        try { c._renderBand(); c._renderMenu(); c._redraw(); } catch (e) { /* ignore */ }
    });
}

export const PROJECT_WORKFLOWS = {

    'safety-use': {
        id: 'safety-use',
        name: '1. 主机安全保护装置的使用操作',
        steps: [
            {
                msg: '第 1 步：点 Safety System → Shut Down，进入自动停车故障页。',
                mode: 'check',
                op: [
                    { type: 'page', page: 1, msg: '切换到第 1 页（驾控台 AC 600）' },
                    {
                        type: 'observe', target: 'ac600-bridge', part: 'btn-safety',
                        msg: '演示前复位：回到主界面、清越控与报警',
                        async act() {
                            _resetSafetyDemo(_sysOf(this));
                            await _sleep(900);
                        },
                    },
                    {
                        type: 'btn', target: 'ac600-bridge', part: 'btn-safety',
                        msg: '点击主菜单 Safety System',
                        async act() {
                            await _clickAwait(_sysOf(this), 'ac600-bridge', 'btn-safety',
                                (s) => { const c = _bridge(s); return !!(c && c._menuPage === 'btn-safety'); });
                        },
                    },
                    {
                        type: 'btn', target: 'ac600-bridge', part: 'sub-shd',
                        msg: '点击二级菜单 Shut Down',
                        async act() {
                            await _clickAwait(_sysOf(this), 'ac600-bridge', 'sub-shd',
                                (s) => { const c = _bridge(s); return !!(c && c._subPage === 'shd'); });
                        },
                    },
                ],
                check() {
                    const c = _bridge(_sysOf(this));
                    return !!(c && c._menuPage === 'btn-safety' && c._subPage === 'shd');
                },
            },
            {
                msg: '第 2 步：选中第 3 项超速项，看它没有 Cancelled 灯（不可越控）。',
                mode: 'check',
                op: [
                    {
                        type: 'btn', target: 'ac600-bridge', part: 'saf-row-os',
                        msg: '点击第 3 项 OVERSPEED FROM RPM UNIT',
                        async act() {
                            await _clickAwait(_sysOf(this), 'ac600-bridge', 'saf-row-os',
                                (s) => _safSelIs(_bridge(s), 'shd', 'os'));
                        },
                    },
                    {
                        type: 'observe', target: 'ac600-bridge', part: 'saf-row-os',
                        msg: '观察：无 Cancelled 灯，行尾也不出现 Cancel SHD 按钮',
                        async act() { await _sleep(1500); },
                    },
                ],
                check() {
                    const c = _bridge(_sysOf(this));
                    if (!_safSelIs(c, 'shd', 'os')) return false;
                    const it = (c._shdItems() || []).find((x) => x.key === 'os');
                    return !!(it && !it.hasC);
                },
            },
            {
                msg: '第 3 步：选中第 7 项缸套水进口压力低，点行尾 Cancel SHD 越控。',
                mode: 'check',
                op: [
                    {
                        type: 'btn', target: 'ac600-bridge', part: 'saf-row-jcw',
                        msg: '点击第 7 项 J.C.F.W. INLET LOW PRESS',
                        async act() {
                            await _clickAwait(_sysOf(this), 'ac600-bridge', 'saf-row-jcw',
                                (s) => _safSelIs(_bridge(s), 'shd', 'jcw'));
                        },
                    },
                    {
                        type: 'observe', target: 'ac600-bridge', part: 'saf-cancel-jcw',
                        msg: '行尾出现 Cancel SHD 按钮（该项可越控）',
                        async act() { await _sleep(1500); },
                    },
                    {
                        type: 'btn', target: 'ac600-bridge', part: 'saf-cancel-jcw',
                        msg: '点击 Cancel SHD，越控该项',
                        async act() {
                            await _clickAwait(_sysOf(this), 'ac600-bridge', 'saf-cancel-jcw',
                                (s) => _safIsCancelled(_bridge(s), 'shd', 'jcw'));
                        },
                    },
                ],
                check() {
                    const c = _bridge(_sysOf(this));
                    return _safIsCancelled(c, 'shd', 'jcw');
                },
            },
            {
                msg: '第 4 步：按控制台总 Cancel SHD，所有可越控项一起越控。',
                mode: 'check',
                op: [
                    {
                        type: 'btn', target: 'ac600-bridge', part: 'cancel-shd',
                        msg: '按住控制台左侧 Cancel SHD 按钮',
                        async act() {
                            const s = _sysOf(this);
                            await _clickAwait(s, 'ac600-bridge', 'cancel-shd', (x) => {
                                const M = _ac600(x);
                                return !!(M && M.cancelSHD);
                            });
                        },
                    },
                    {
                        type: 'observe', target: 'ac600-bridge', part: 'saf-row-eicu-a-c',
                        msg: '观察：各可越控项的 Cancelled 灯全部变红',
                        async act() { await _sleep(1800); },
                    },
                ],
                check() {
                    const s = _sysOf(this);
                    const M = _ac600(s);
                    const c = _bridge(s);
                    return !!(M && M.cancelSHD && c && c._cancel && c._cancel.shd
                        && _allSafCancelled(c, 'shd', _SHD_CANCEL_KEYS));
                },
            },
            {
                msg: '第 5 步：再按总 Cancel SHD 取消越控，然后消音、复位。',
                mode: 'check',
                op: [
                    {
                        type: 'btn', target: 'ac600-bridge', part: 'cancel-shd',
                        msg: '再按一次 Cancel SHD，取消自动停车越控',
                        async act() {
                            await _clickAwait(_sysOf(this), 'ac600-bridge', 'cancel-shd', (x) => {
                                const M = _ac600(x);
                                return !!(M && !M.cancelSHD);
                            });
                        },
                    },
                    {
                        type: 'btn', target: 'ac600-bridge', part: 'silence',
                        msg: '按消音按钮，停止声响',
                        async act() {
                            await _clickAwait(_sysOf(this), 'ac600-bridge', 'silence', (x) => {
                                const M = _ac600(x);
                                return !!(M && M.silenced);
                            });
                        },
                    },
                    {
                        type: 'btn', target: 'ac600-bridge', part: 'ack',
                        msg: '按 ACK 复位报警',
                        async act() {
                            await _clickAwait(_sysOf(this), 'ac600-bridge', 'ack', (x) => {
                                const M = _ac600(x);
                                return !!(M && M.acked);
                            });
                        },
                    },
                ],
                check() {
                    const M = _ac600(_sysOf(this));
                    const c = _bridge(_sysOf(this));
                    return !!(M && !M.cancelSHD && !(M.cancelAlarmOn && M.cancelAlarmOn.shd)
                        && !M.alarm && M.acked && c && !c._cancel.shd);
                },
            },
            {
                msg: '第 6 步：点 Safety System 子菜单 Slow Down，进入自动减速故障页。',
                mode: 'check',
                op: [
                    {
                        type: 'btn', target: 'ac600-bridge', part: 'sub-sld',
                        msg: '点击 Slow Down',
                        async act() {
                            await _clickAwait(_sysOf(this), 'ac600-bridge', 'sub-sld',
                                (s) => { const c = _bridge(s); return !!(c && c._subPage === 'sld'); });
                        },
                    },
                    {
                        type: 'observe', target: 'ac600-bridge', part: 'saf-row-sld',
                        msg: '观察：Slow Down 页所有项目都带 Cancelled 灯（全可越控）',
                        async act() { await _sleep(1500); },
                    },
                ],
                check() {
                    const c = _bridge(_sysOf(this));
                    return !!(c && c._subPage === 'sld');
                },
            },
            {
                msg: '第 7 步：选中第 3 项滑油进口温度高，点 Cancel SLD 越控。',
                mode: 'check',
                op: [
                    {
                        type: 'btn', target: 'ac600-bridge', part: 'saf-row-lo-t',
                        msg: '点击第 3 项 MAIN L.O.INLET TEMP HIGH',
                        async act() {
                            await _clickAwait(_sysOf(this), 'ac600-bridge', 'saf-row-lo-t',
                                (s) => _safSelIs(_bridge(s), 'sld', 'lo-t'));
                        },
                    },
                    {
                        type: 'observe', target: 'ac600-bridge', part: 'saf-cancel-lo-t',
                        msg: '行尾出现 Cancel SLD 按钮',
                        async act() { await _sleep(1500); },
                    },
                    {
                        type: 'btn', target: 'ac600-bridge', part: 'saf-cancel-lo-t',
                        msg: '点击 Cancel SLD，越控该项',
                        async act() {
                            await _clickAwait(_sysOf(this), 'ac600-bridge', 'saf-cancel-lo-t',
                                (s) => _safIsCancelled(_bridge(s), 'sld', 'lo-t'));
                        },
                    },
                ],
                check() {
                    const c = _bridge(_sysOf(this));
                    return _safIsCancelled(c, 'sld', 'lo-t');
                },
            },
            {
                msg: '第 8 步：按控制台总 Cancel SLD，全部自动减速项一起越控。',
                mode: 'check',
                op: [
                    {
                        type: 'btn', target: 'ac600-bridge', part: 'cancel-sld',
                        msg: '按住控制台左侧 Cancel SLD 按钮',
                        async act() {
                            await _clickAwait(_sysOf(this), 'ac600-bridge', 'cancel-sld', (x) => {
                                const M = _ac600(x);
                                return !!(M && M.cancelSLD);
                            });
                        },
                    },
                    {
                        type: 'observe', target: 'ac600-bridge', part: 'saf-row-eicu-a',
                        msg: '观察：Slow Down 页各行 Cancelled 灯全部变红',
                        async act() { await _sleep(1800); },
                    },
                ],
                check() {
                    const s = _sysOf(this);
                    const M = _ac600(s);
                    const c = _bridge(s);
                    return !!(M && M.cancelSLD && c && c._cancel && c._cancel.sld
                        && _allSafCancelled(c, 'sld', _SLD_CANCEL_KEYS));
                },
            },
            {
                msg: '第 9 步：再按总 Cancel SLD 取消越控，然后消音、复位。',
                mode: 'check',
                op: [
                    {
                        type: 'btn', target: 'ac600-bridge', part: 'cancel-sld',
                        msg: '再按一次 Cancel SLD，取消自动减速越控',
                        async act() {
                            await _clickAwait(_sysOf(this), 'ac600-bridge', 'cancel-sld', (x) => {
                                const M = _ac600(x);
                                return !!(M && !M.cancelSLD);
                            });
                        },
                    },
                    {
                        type: 'btn', target: 'ac600-bridge', part: 'silence',
                        msg: '按消音按钮，停止声响',
                        async act() {
                            await _clickAwait(_sysOf(this), 'ac600-bridge', 'silence', (x) => {
                                const M = _ac600(x);
                                return !!(M && M.silenced);
                            });
                        },
                    },
                    {
                        type: 'btn', target: 'ac600-bridge', part: 'ack',
                        msg: '按 ACK 复位报警',
                        async act() {
                            const s = _sysOf(this);
                            await _clickAwait(s, 'ac600-bridge', 'ack', (x) => {
                                const M = _ac600(x);
                                return !!(M && M.acked && !M.alarm);
                            });
                        },
                    },
                    {
                        type: 'observe', target: 'ac600-bridge', part: 'alarm-bar',
                        msg: '观察：报警栏清空，两页越控标记全部恢复',
                        async act() { await _sleep(1200); },
                    },
                ],
                check() {
                    const M = _ac600(_sysOf(this));
                    const c = _bridge(_sysOf(this));
                    return !!(M && !M.cancelSLD && !(M.cancelAlarmOn && M.cancelAlarmOn.sld)
                        && !M.alarm && M.acked && c && !c._cancel.sld);
                },
            },
        ],
    },

    'overspeed-test': {
        id: 'overspeed-test',
        name: '2. 主机超速保护实验',
        steps: [
            {
                msg: '第 1 步：在驾控台将车钟拉回停车位，确认主起动阀关闭、滑油泵运行。',
                mode: 'check',
                op: [
                    { type: 'page', page: 1, msg: '切换到第 1 页（驾控台 AC 600）' },
                    {
                        type: 'observe', target: 'ac600-bridge', part: 'telegraph',
                        msg: '演示前复位：清超速试验开关与超速停车报警',
                        async act() {
                            _resetOverspeedDemo(_sysOf(this));
                            await _sleep(900);
                        },
                    },
                    {
                        type: 'switch', target: 'ac600-bridge', part: 'telegraph',
                        msg: '按住车钟手柄拉到 STOP 档，等主机降速停车',
                        async act() {
                            const s = _sysOf(this);
                            await _dragTelegraphTo(s, 'ac600-bridge', 5);      // 5 = STOP
                            await _sleep(600);
                            await _waitEngineStopped(s);
                        },
                    },
                    { type: 'page', page: 4, msg: '切换到第 4 页（主机气动操纵系统）' },
                    {
                        type: 'observe', target: 'ac600-pneumatic', part: 'main-valve',
                        msg: '确认主起动阀关闭（起动空气已切断）',
                        async act() {
                            const s = _sysOf(this);
                            const M = _ac600(s);
                            const p = _pneu(s);
                            if (M && M.mainStartValveOk === false && p) {   // 若被阻塞，按「工作」恢复
                                await _clickAwait(s, 'ac600-pneumatic', 'work-btn',
                                    (x) => { const m = _ac600(x); return !!(m && m.mainStartValveOk); });
                            }
                            await _sleep(900);
                        },
                    },
                    { type: 'page', page: 10, msg: '切换到第 10 页（主机滑油系统）' },
                    {
                        type: 'btn', target: 'lomimic', part: 'pp1-start',
                        msg: '确认 1# 主机滑油泵运行',
                        async act() {
                            const s = _sysOf(this);
                            const c = _lo(s);
                            if (c && c.m) {
                                await _clickAwait(s, 'lomimic', 'pp1-start',
                                    (x) => { const k = _lo(x); return !!(k && k.m && k.m.pumps.p1.on); });
                            }
                            await _sleep(500);
                        },
                    },
                ],
                check() {
                    const s = _sysOf(this);
                    const M = _ac600(s);
                    const c = _lo(s);
                    const pumpOk = !!(c && c.m && (c.m.pumps.p1.on || c.m.pumps.p2.on));
                    return !!(M && M.isStopped && !M.mainStartValveOpen && pumpOk);
                },
            },
            {
                msg: '第 2 步：进入集控台见面，点击Safety System → RPM Detector，打开转速检测页。本实验在集控台ACP界面完成。',
                mode: 'check',
                op: [
                    { type: 'page', page: 2, msg: '切换到第 2 页（集控台，本实验在此完成）' },
                    {
                        type: 'btn', target: 'ac600-ecr', part: 'btn-safety',
                        msg: '点击主菜单 Safety System',
                        async act() {
                            await _clickAwait(_sysOf(this), 'ac600-ecr', 'btn-safety',
                                (s) => { const c = _ecr(s); return !!(c && c._menuPage === 'btn-safety'); });
                        },
                    },
                    {
                        type: 'btn', target: 'ac600-ecr', part: 'sub-detector',
                        msg: '点击二级菜单 RPM Detector',
                        async act() {
                            await _clickAwait(_sysOf(this), 'ac600-ecr', 'sub-detector',
                                (s) => { const c = _ecr(s); return !!(c && c._subPage === 'detector'); });
                        },
                    },
                ],
                check() {
                    const c = _ecr(_sysOf(this));
                    return !!(c && c._menuPage === 'btn-safety' && c._subPage === 'detector');
                },
            },
            {
                msg: '第 3 步：模拟转速设 65 rpm、超速试验值设 78 rpm，两开关打 ON。',
                mode: 'check',
                op: [
                    {
                        type: 'btn', target: 'ac600-ecr', part: 'det-edit-simRpm',
                        msg: '双击 Rpm Simulate 值框，改为 65.0 rpm',
                        async act() {
                            const s = _sysOf(this);
                            await _setDetValue(s, 'simRpm', 65);
                            await _waitFor(s, (x) => { const M = _ac600(x); return !!(M && M.overspeedTest && M.overspeedTest.simRpm === 65); }, 6000);
                            await _sleep(400);
                        },
                    },
                    {
                        type: 'btn', target: 'ac600-ecr', part: 'det-edit-osTestRpm',
                        msg: '双击 Overspeed Test Level 值框，改为 78.0 rpm',
                        async act() {
                            const s = _sysOf(this);
                            await _setDetValue(s, 'osTestRpm', 78);
                            await _waitFor(s, (x) => { const M = _ac600(x); return !!(M && M.overspeedTest && M.overspeedTest.osTestRpm === 78); }, 6000);
                            await _sleep(400);
                        },
                    },
                    {
                        type: 'btn', target: 'ac600-ecr', part: 'det-sim-toggle',
                        msg: '把 Rpm Simulate 开关打到 ON',
                        async act() {
                            await _clickAwait(_sysOf(this), 'ac600-ecr', 'det-sim-toggle', (x) => {
                                const M = _ac600(x);
                                return !!(M && M.overspeedTest && M.overspeedTest.simOn);
                            });
                        },
                    },
                    {
                        type: 'btn', target: 'ac600-ecr', part: 'det-os-toggle',
                        msg: '把 Overspeed Test 开关也打到 ON',
                        async act() {
                            await _clickAwait(_sysOf(this), 'ac600-ecr', 'det-os-toggle', (x) => {
                                const M = _ac600(x);
                                return !!(M && M.overspeedTest && M.overspeedTest.osTestOn);
                            });
                        },
                    },
                ],
                check() {
                    const M = _ac600(_sysOf(this));
                    const T = M && M.overspeedTest;
                    return !!(T && T.simOn && T.osTestOn && T.simRpm < T.osTestRpm && !M.overspeedTripped);
                },
            },
            {
                msg: '第 4 步：把模拟转速调到 85 rpm（高于试验值），触发超速保护。',
                mode: 'check',
                op: [
                    {
                        type: 'btn', target: 'ac600-ecr', part: 'det-edit-simRpm',
                        msg: '双击模拟转速值框，改为 85.0 rpm',
                        async act() {
                            const s = _sysOf(this);
                            await _setDetValue(s, 'simRpm', 85);
                            await _waitFor(s, (x) => { const M = _ac600(x); return !!(M && M.overspeedTripped); }, 8000);
                            await _sleep(600);
                        },
                    },
                    {
                        type: 'observe', target: 'ac600-ecr', part: 'det-edit-simRpm',
                        msg: '超速保护动作：燃油切断、主机停车，报警 OVERSPEED SYS.1/2',
                        async act() { await _sleep(2000); },
                    },
                ],
                check() {
                    const M = _ac600(_sysOf(this));
                    return !!(M && M.overspeedTripped && M.shutDown && !M.engineReady);
                },
            },
            {
                msg: '第 5 步：回驾控台看超速停车已触发，消音、复位报警。',
                mode: 'check',
                op: [
                    { type: 'page', page: 1, msg: '切换到第 1 页（驾控台）' },
                    {
                        type: 'observe', target: 'ac600-bridge', part: 'alarm-bar',
                        msg: '报警栏显示 OVERSPEED SYS.1/2 - SW BACKUP, SHUTDN',
                        async act() { await _sleep(1800); },
                    },
                    {
                        type: 'btn', target: 'ac600-bridge', part: 'silence',
                        msg: '按消音按钮，停止声响',
                        async act() {
                            await _clickAwait(_sysOf(this), 'ac600-bridge', 'silence', (x) => {
                                const M = _ac600(x);
                                return !!(M && M.silenced);
                            });
                        },
                    },
                    {
                        type: 'btn', target: 'ac600-bridge', part: 'ack',
                        msg: '按 ACK 确认报警（故障仍在，报警转黄）',
                        async act() {
                            await _clickAwait(_sysOf(this), 'ac600-bridge', 'ack', (x) => {
                                const M = _ac600(x);
                                return !!(M && M.acked);
                            });
                        },
                    },
                ],
                check() {
                    const M = _ac600(_sysOf(this));
                    return !!(M && M.silenced && M.acked && M.overspeedTripped && M.shutDown);
                },
            },
            {
                msg: '第 6 步：回集控台把模拟转速调回 65 rpm，报警复位后消音、复位。',
                mode: 'check',
                op: [
                    { type: 'page', page: 2, msg: '切换到第 2 页（集控台 RPM Detector）' },
                    {
                        type: 'btn', target: 'ac600-ecr', part: 'det-edit-simRpm',
                        msg: '双击模拟转速值框，改回 65.0 rpm（低于试验值）',
                        async act() {
                            const s = _sysOf(this);
                            await _setDetValue(s, 'simRpm', 65);
                            await _waitFor(s, (x) => {
                                const M = _ac600(x);
                                return !!(M && !M.overspeedTripped && !M.shutDown);
                            }, 8000);
                            await _sleep(600);
                        },
                    },
                    {
                        type: 'observe', target: 'ac600-ecr', part: 'det-edit-simRpm',
                        msg: '超速报警复位：主机恢复备车（Eng. Ready）',
                        async act() { await _sleep(1500); },
                    },
                    {
                        type: 'btn', target: 'ac600-ecr', part: 'silence',
                        msg: '按消音按钮，停止声响',
                        async act() {
                            await _clickAwait(_sysOf(this), 'ac600-ecr', 'silence', (x) => {
                                const M = _ac600(x);
                                return !!(M && M.silenced);
                            });
                        },
                    },
                    {
                        type: 'btn', target: 'ac600-ecr', part: 'ack',
                        msg: '按 ACK，所有警报复位',
                        async act() {
                            await _clickAwait(_sysOf(this), 'ac600-ecr', 'ack', (x) => {
                                const M = _ac600(x);
                                return !!(M && M.acked && !M.alarm);
                            });
                        },
                    },
                ],
                check() {
                    const M = _ac600(_sysOf(this));
                    return !!(M && !M.overspeedTripped && !M.shutDown && !M.alarm
                        && M.acked && M.silenced && M.engineReady);
                },
            },
        ],
    },

    'auto-stop-reset': {
        id: 'auto-stop-reset',
        name: '3. 主机滑油低压保护模拟实验',
        steps: [
            {
                msg: '第 1 步：切换到主机滑油系统界面，把滑油压力开关的管路切换到手摇泵输出。',
                mode: 'check',
                op: [
                    { type: 'page', page: 10, msg: '切换到第 10 页（主机滑油系统）' },
                    {
                        type: 'observe', target: 'lomimic', msg: '演示前复位：取压回滑油管路、手摇泵 0.20 MPa、清停车与报警',
                        async act() {
                            const s = _sysOf(this);
                            const M = _ac600(s);
                            const c = _lo(s);
                            if (c && c.m) {
                                c.m.sw3b = 'line';
                                c.m.handP2 = 0.2;
                                c.m.shdTrip = false;
                            }
                            if (M) {
                                M.shutDown = false; M.shdResetArmed = false; M._shdStopAck = false;
                                M.loLowLowShd = false; M.jcwLowShd = false;
                                M.messages = []; M.alarm = false; M.acked = true; M.silenced = false;
                                M.engineReady = true; M.startBlocked = false;
                                try { M.setLeverById('nav-full', M.controlPos); } catch (e) { /* ignore */ }
                            }
                            await _sleep(800);
                        },
                    },
                    {
                        type: 'switch', target: 'lomimic', part: 'cv3c',
                        msg: '把压力开关取压三通阀切到手摇泵输出',
                        async act() { await _click(_sysOf(this), 'lomimic', 'cv3c'); await _sleep(500); },
                    },
                ],
                check() {
                    const c = _lo(_sysOf(this));
                    return !!(c && c.m && c.m.sw3b === 'pump');
                },
            },
            {
                msg: '第 2 步：手动把手摇泵输出压力减小到 0.14 MPa，观察到压力开关闭合。',
                mode: 'check',
                op: [
                    {
                        type: 'btn', target: 'lomimic', part: 'hp2-dn',
                        msg: '按 ▼ 逐次减小手摇泵压力（每次 0.01 MPa）',
                        async act() {
                            const s = _sysOf(this);
                            const c = _lo(s);
                            for (let i = 0; i < 40; i++) {
                                if (!c || !c.m || c.m.handP2 <= 0.14) break;
                                _firePartClick(c, 'hp2-dn');
                                await _sleep(140);
                            }
                            await _sleep(500);
                        },
                    },
                    {
                        type: 'observe', target: 'lomimic', part: 'psw',
                        msg: '观察压力开关（低低压）NC 触点闭合',
                        async act() {
                            await _waitFor(_sysOf(this), (x) => {
                                const p = x.comps && x.comps.psw1;
                                return !!(p && typeof p.getSwitchOutput === 'function' && p.getSwitchOutput() === 1);
                            }, 8000);
                            await _sleep(800);
                        },
                    },
                ],
                check() {
                    const s = _sysOf(this);
                    const c = _lo(s);
                    const p = s.comps && s.comps.psw1;
                    const closed = !!(p && typeof p.getSwitchOutput === 'function' && p.getSwitchOutput() === 1);
                    return !!(c && c.m && c.m.handP2 <= 0.14 && closed);
                },
            },
            {
                msg: '第 3 步：回到驾控台主界面，可观察到主机已经触发自动停车，进行消音和应答。',
                mode: 'check',
                op: [
                    { type: 'page', page: 1, msg: '切换到第 1 页（驾控台 AC 600）' },
                    {
                        type: 'observe', target: 'ac600-bridge', part: 'alarm-bar',
                        msg: '等待安保延时到 → 主机自动停车，观察报警信息',
                        async act() {
                            await _waitFor(_sysOf(this), (x) => {
                                const M = _ac600(x);
                                return !!(M && M.shutDown);
                            }, 25000);
                            await _sleep(1500);
                        },
                    },
                    {
                        type: 'btn', target: 'ac600-bridge', part: 'silence', msg: '按扬声器「消音」',
                        async act() { await _click(_sysOf(this), 'ac600-bridge', 'silence'); await _sleep(500); },
                    },
                    {
                        type: 'btn', target: 'ac600-bridge', part: 'ack', msg: '按「ACK」确认报警',
                        async act() { await _click(_sysOf(this), 'ac600-bridge', 'ack'); await _sleep(700); },
                    },
                ],
                check() {
                    const M = _ac600(_sysOf(this));
                    return !!(M && M.shutDown && M.silenced && M.acked);
                },
            },
            {
                msg: '第 4 步：切回主机滑油系统，把手摇泵压力升到 0.21 MPa 观察开关复位，'
                    + '再把压力开关的管路切回滑油入口管路。',
                mode: 'check',
                op: [
                    { type: 'page', page: 10, msg: '切换到第 10 页（主机滑油系统）' },
                    {
                        type: 'btn', target: 'lomimic', part: 'hp2-up',
                        msg: '按 ▲ 把手摇泵压力升到 0.21 MPa',
                        async act() {
                            const s = _sysOf(this);
                            const c = _lo(s);
                            for (let i = 0; i < 40; i++) {
                                if (!c || !c.m || c.m.handP2 >= 0.21) break;
                                _firePartClick(c, 'hp2-up');
                                await _sleep(140);
                            }
                            await _sleep(600);
                        },
                    },
                    {
                        type: 'observe', target: 'lomimic', part: 'psw', msg: '观察压力开关复位（触点断开）',
                        async act() {
                            await _waitFor(_sysOf(this), (x) => {
                                const p = x.comps && x.comps.psw1;
                                return !!(p && typeof p.getSwitchOutput === 'function' && p.getSwitchOutput() === 0);
                            }, 8000);
                            await _sleep(700);
                        },
                    },
                    {
                        type: 'switch', target: 'lomimic', part: 'cv3c',
                        msg: '把取压三通阀切回滑油入口管路',
                        async act() { await _click(_sysOf(this), 'lomimic', 'cv3c'); await _sleep(500); },
                    },
                ],
                check() {
                    const s = _sysOf(this);
                    const c = _lo(s);
                    return !!(c && c.m && c.m.handP2 >= 0.21 && c.m.sw3b === 'line');
                },
            },
            {
                msg: '第 5 步：回到驾控台主界面，把车钟手柄拉回 STOP，对自动停车故障进行复位。',
                mode: 'check',
                op: [
                    { type: 'page', page: 1, msg: '切换到第 1 页（驾控台 AC 600）' },
                    {
                        type: 'switch', target: 'ac600-bridge', part: 'telegraph',
                        msg: '按住车钟手柄拉到 STOP 档',
                        async act() {
                            const s = _sysOf(this);
                            await _dragTelegraphTo(s, 'ac600-bridge', 5);      // 5 = STOP（0 rpm）
                            await _sleep(600);
                            await _waitFor(s, (x) => {
                                const M = _ac600(x);
                                return !!(M && !M.shutDown);
                            }, 8000);
                        },
                    },
                    {
                        type: 'observe', target: 'ac600-bridge', part: 'alarm-bar',
                        msg: '自动停车复位：报警清除、备车恢复（Eng. Ready）',
                        async act() { await _sleep(1500); },
                    },
                ],
                check() {
                    const M = _ac600(_sysOf(this));
                    return !!(M && !M.shutDown && !M.loLowLowShd && M.engineReady);
                },
            },
        ],
    },
};

// ═══════════════════════════════════════════════════════════
// 页面定义（多页工程：页 0 索引 + 10 个电路页）
//   页 1~5  主机遥控系统 AC 600（驾控台 / 集控台 / 机旁 / 气动操纵系统 / MIMIC）
//   页 6~10 船舶机舱监视报警系统 K-Chief 600
// ═══════════════════════════════════════════════════════════

export const PROJECT_PAGES = [
    { id: 0, name: '索引', type: 'index' },
    {
        id: 1, name: '主机遥控系统 AC 600 驾控台', comps: ['ac600-bridge'],
        desc: '驾驶台 AC 600 操纵面板：状态条（At Sea / Economy Mode / ECR / Eng. Ready / System Ready）、'
            + 'M/E RPM 表、起动空气压力表、M/E 负荷表、SETP / LEVER 柱状指示、'
            + 'Cancel SHD / SLD / Limits 越控、ACK 确认与消音、右侧 NAVIGATION FULL 车钟与'
            + 'Bridge / ECR / Local 控制位置、At Sea / Standby / FWE 工况、EM.STOP 应急停车',
    },
    {
        id: 2, name: '主机遥控系统 AC 600 集控台', comps: ['ac600-ecr'],
        desc: '集控室 AC 600 操纵面板：与驾控台同一版式，控制位置默认在 ECR；'
            + '车钟、越控、确认/消音、工况灯与应急停车同驾控台',
    },
    {
        id: 3, name: '主机遥控系统机旁面板', comps: ['ac600-local'],
        desc: '机旁操纵面板：车钟档位（Nav.Full … Emp.Astern）、At Sea / Stand By / FWE、'
            + 'Bridge / ECR / Local 位置灯、Wrong Way / Lamp Test、状态指示矩阵'
            + '（本地/集控室/驾驶台控制、控制权强制获取、减速、停车、辅助鼓风机、'
            + '盘车机脱开、空气分配器、主起动阀、备车未完成、负荷限制、起动阻塞/失败）、'
            + '试灯、EM STOP、冲车/慢转起动、盘车机遥控盒与盘车机控制箱、三只机旁仪表',
    },
    {
        id: 4, name: '主机气动操纵系统', comps: ['ac600-pneumatic'],
        desc: '主机气动操纵系统图：起动空气 28.3 bar（空压机/干燥器/安全阀组）、主起动阀、'
            + '慢转起动阀、气缸起动阀组与空气分配器、盘车机（Disengaged）、'
            + '控制空气 7.0 bar、40 L 气瓶、转速与工作/阻塞指示',
    },
    {
        id: 5, name: '现场总线型主机遥控系统', comps: ['ac600-mimic'],
        desc: 'AC 600 系统结构 MIMIC：驾驶台 / 两翼（Bridge Unit、Order Printer、'
            + 'Bridge Wing Manoeuvring Unit）、集控室（Control Room Manoeuvring Unit、'
            + 'Start/Stop Speedset Lever、Indicating Panel Unit）、双 CAN 总线、'
            + '机舱（机旁操纵台、MEI、ESU、RAi16、DGU + Servo Unit、双测速单元、电动执行器）',
    },
    {
        id: 6, name: '报警系统主界面', comps: ['kchief'],
        desc: 'K-Chief 600 操作站 Home 菜单：表格视图（当前报警 / 标签一览 / 被闭锁标签…）、'
            + '工艺流程图入口、Dock 报警组计数、报警确认与测点报警参数设置',
    },
    {
        id: 7, name: '延伸报警单元', comps: ['extunit'],
        desc: '驾驶室 / 轮机长 / 大管轮 / 二管轮 / 三管轮 / 电机员六块值班面板：'
            + 'On Watch 值班位置、Duty 值班交接、延伸报警就地确认、轮机员呼叫',
    },
    {
        id: 8, name: '现场总线型监视报警系统', comps: ['topo'],
        desc: 'K-Chief 600 现场总线型机舱监视与报警系统拓扑：住舱 / 驾驶台（WCU、OS、WBU）、'
            + '集控室（OS/SGW、Printer、UPS、CAN Bus 3 / Ethernet 1·2）、机舱（CAN Bus 1·2、'
            + 'dPSC 分布式处理单元 RDi-32 / RDo-16 / RAi-16 / RAo-8 / RAi-10tc / RIO-C4、LOS、MOS）',
    },
    {
        id: 9, name: '轮机员安全系统', comps: ['deadman'],
        desc: '轮机员安全系统（Dead Man System）三块操作面板：集控室操作面板、机舱左入口面板、'
            + '机舱右入口面板；自复位启停旋钮、任意复位按钮清零、预警/报警时间设置，'
            + '超时触发 DEADMAN 报警并延伸至驾驶室与轮机长值班面板',
    },
    {
        id: 10, name: '主机滑油系统', comps: ['lomimic', 'psw1'],
        desc: '主机滑油系统流程图：柴油机 → 滑油循环柜 → 两台并联滑油泵（截止阀/泵/单向阀）'
            + ' → 旁通与滑油冷却器 → 三通调节阀 → 滤器 → YT1226 压力开关与压力变送器 → 柴油机右下入口；'
            + '含温度传感器与 PID 调节器面板、两台滑油泵控制面板',
    },
    {
        id: 11, name: '主机缸套冷却水温度控制系统', comps: ['cwmimic', 'cwpid'],
        desc: '主机高温冷却水（缸套淡水）系统 MIMIC：主机 → 缸套水加热器 / 造水机 / 旁通 → 高温淡水冷却器、'
            + '两台高温冷却淡水泵、三通调节阀、除气柜与膨胀水柜、TT 温度变送器与温度表；'
            + '右侧 LDCL 温度 PID 调节器面板（AUTO / MANU 切换、SV 设定、P/I/DB 与报警限参数）',
    },
];

// ═══════════════════════════════════════════════════════════
// 组件配置（1920 × 1080 基准坐标）
// ═══════════════════════════════════════════════════════════

export const componentConfigs = [
    // ══ 主机遥控系统 AC 600（页 1~5）══
    { Class: Ac600ConsolePanel, id: 'ac600-bridge', variant: 'bridge', x: -160, y: 30, page: 1, visible: true },
    { Class: Ac600ConsolePanel, id: 'ac600-ecr', variant: 'ecr', x: -160, y: 30, page: 2, visible: true },
    { Class: Ac600LocalPanel, id: 'ac600-local', x: -160, y: 30, page: 3, visible: true },
    { Class: Ac600PneumaticSystem, id: 'ac600-pneumatic', x: -120, y: 5, page: 4, visible: true },
    { Class: Ac600Mimic, id: 'ac600-mimic', x: 260, y: 30, page: 5, visible: true },

    // ══ 船舶机舱监视报警系统 K-Chief 600（页 6~10）══
    { Class: KChiefConsole, id: 'kchief', x: -160, y: 20, page: 6, visible: true },
    { Class: ExtensionAlarmUnit, id: 'extunit', x: -150, y: 20, page: 7, visible: true },
    { Class: FieldbusTopology, id: 'topo', x: -100, y: 5, page: 8, visible: true },
    { Class: DeadmanPanel, id: 'deadman', x: -120, y: 50, page: 9, visible: true },
    { Class: MainEngineLubeOilMimic, id: 'lomimic', x: -120, y: 10, page: 10, visible: true },
    { Class: PressRelay, id: 'psw1', x: 220, y: 30, page: 10, visible: true, lowStart: 0, lowEnd: 0.5, diffStart: 0.02, diffEnd: 0.12, setPoint: 30, differential: 30 },

    // ══ 主机缸套冷却水温度控制系统（页 11）══
    { Class: CoolingWaterMimic, id: 'cwmimic', x: -150, y: 40, page: 11, visible: true },
    { Class: CoolingWaterPID, id: 'cwpid', x: 1280, y: 510, page: 11, visible: true },

    // ══ 7 种标准仪表（默认隐藏，通过「选择仪表」调出）══
    { Class: Multimeter, id: 'multimeter', x: 700, y: 200, page: 6, visible: false },
    { Class: MF47Multimeter, id: 'mf47-panel', x: 700, y: 200, page: 6, visible: false },
    { Class: Oscilloscope_tri, id: 'osc', x: 700, y: 200, page: 6, visible: false },
    { Class: SignalGenerator, id: 'sg', x: 700, y: 200, page: 6, visible: false },
    { Class: ProcessCalibrator, id: 'cali', x: 700, y: 200, page: 6, visible: false },
    { Class: ElecMeter, id: 'elecmeter', x: 700, y: 200, page: 6, visible: false },
    { Class: RealMegohmMeter, id: 'megohm', x: 700, y: 200, page: 6, visible: false },
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
