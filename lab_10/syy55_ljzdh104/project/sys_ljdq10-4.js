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

// ═══════════════════════════════════════════════════════════════
// 工作流
// ═══════════════════════════════════════════════════════════════

export const PROJECT_WORKFLOWS = {

    // ══════════════════════════════════════════════════════
    // 流程一：机舱监视与报警系统的认识
    // ══════════════════════════════════════════════════════
    'alarm-basic': {
        id: 'alarm-basic', name: '1. 机舱监视与报警系统的认识',
        steps: [
            // ① 进入 Home，识别「当前报警」
            {
                msg: '第 1 步：进入报警系统 Home 页面，识别「当前报警 Active alarms」。',
                mode: 'find', target: 'kchief', subTarget: 'tab-active',
            },
            // ② 返回 Home，识别「报警历史」
            {
                msg: '第 2 步：返回 Home 页面，识别「报警历史 Alarm history」。',
                mode: 'check',
                op: [
                    {
                        type: 'btn', target: 'kchief', part: 'tb-home', msg: '点「主页」返回 Home',
                        async act() { await _click(_sysOf(this), 'kchief', 'tb-home'); await _sleep(500); },
                    },
                    { type: 'observe', target: 'kchief', part: 'tab-history', msg: '识别「报警历史」入口' },
                ],
                check() {
                    const sys = _sysOf(this); const c = _kc(sys);
                    return !!c && c.overlayKind === null && (c._visited || []).indexOf('alarms') >= 0;
                },
            },
            // ③ 打开报警历史 → 返回 Home，识别「标签一览」
            {
                msg: '第 3 步：返回 Home 页面，识别「标签一览 Tag summary」。',
                mode: 'check',
                op: [
                    {
                        type: 'btn', target: 'kchief', part: 'tab-history', msg: '打开「报警历史」列表',
                        async act() { await _click(_sysOf(this), 'kchief', 'tab-history'); await _sleep(900); },
                    },
                    {
                        type: 'btn', target: 'kchief', part: 'tb-home', msg: '点「主页」返回 Home',
                        async act() { await _click(_sysOf(this), 'kchief', 'tb-home'); await _sleep(500); },
                    },
                    { type: 'observe', target: 'kchief', part: 'tab-tags', msg: '识别「标签一览」入口' },
                ],
                check() {
                    const sys = _sysOf(this); const c = _kc(sys);
                    return !!c && c.overlayKind === null && (c._visited || []).indexOf('history') >= 0;
                },
            },
            // ④ 打开标签一览 → 返回 Home，识别「被闭锁标签」
            {
                msg: '第 4 步：返回 Home 页面，识别「被闭锁标签 Inhibit tags」。',
                mode: 'check',
                op: [
                    {
                        type: 'btn', target: 'kchief', part: 'tab-tags', msg: '打开「标签一览」列表',
                        async act() { await _click(_sysOf(this), 'kchief', 'tab-tags'); await _sleep(900); },
                    },
                    {
                        type: 'btn', target: 'kchief', part: 'tb-home', msg: '点「主页」返回 Home',
                        async act() { await _click(_sysOf(this), 'kchief', 'tb-home'); await _sleep(500); },
                    },
                    { type: 'observe', target: 'kchief', part: 'tab-inhibit', msg: '识别「被闭锁标签」入口' },
                ],
                check() {
                    const sys = _sysOf(this); const c = _kc(sys);
                    return !!c && c.overlayKind === null && (c._visited || []).indexOf('tags') >= 0;
                },
            },
            // ⑤ 打开被闭锁标签 → 返回 Home，识别报警组「M/E LO SYSTEM」
            {
                msg: '第 5 步：返回 Home 页面，识别报警组「M/E LO SYSTEM」。',
                mode: 'check',
                op: [
                    {
                        type: 'btn', target: 'kchief', part: 'tab-inhibit', msg: '打开「被闭锁标签」列表',
                        async act() { await _click(_sysOf(this), 'kchief', 'tab-inhibit'); await _sleep(900); },
                    },
                    {
                        type: 'btn', target: 'kchief', part: 'tb-home', msg: '点「主页」返回 Home',
                        async act() { await _click(_sysOf(this), 'kchief', 'tb-home'); await _sleep(500); },
                    },
                    { type: 'observe', target: 'kchief', part: 'dock-ME-LO', msg: '识别左侧报警组「M/E LO SYSTEM」' },
                ],
                check() {
                    const sys = _sysOf(this); const c = _kc(sys);
                    return !!c && c.overlayKind === null && (c._visited || []).indexOf('inhibit') >= 0;
                },
            },
            // ⑥ 识别报警确认按钮
            {
                msg: '第 6 步：返回 Home 页面，识别「确认 ACK」按钮。',
                mode: 'find', target: 'kchief', subTarget: 'tb-ack',
            },
            // ⑦ 识别趋势 1
            {
                msg: '第 7 步：识别「趋势 1 Trend view 1」入口。',
                mode: 'find', target: 'kchief', subTarget: 'trend-1',
            },
            // ⑧ 返回 Home，识别自定义视图 1
            {
                msg: '第 8 步：返回 Home 页面，识别「自定义视图 1 Custom view 1」。',
                mode: 'check',
                op: [
                    {
                        type: 'btn', target: 'kchief', part: 'tb-home', msg: '点「主页」返回 Home',
                        async act() { await _click(_sysOf(this), 'kchief', 'tb-home'); await _sleep(500); },
                    },
                    { type: 'observe', target: 'kchief', part: 'custom-1', msg: '识别「自定义视图 1」入口' },
                ],
                check() {
                    const sys = _sysOf(this); const c = _kc(sys);
                    return !!c && c.overlayKind === null && (c._visited || []).indexOf('trend') >= 0;
                },
            },
            // ⑨ 测试题：失职报警
            {
                msg: '第 9 步：测试题——失职报警的功能。',
                mode: 'quiz',
                quizConfig: {
                    question: '关于轮机员安全系统中的「失职报警（Repeat alarm）」，下列说法正确的是？',
                    options: [
                        '失职报警表示某个测点的测量值再次越限、故障重复发生，故障排除后会自行消失',
                        '报警发生后，若值班人员在设定时间（默认 180 s）内未确认，或值班面板消音后主站仍未确认，驾驶台与轮机长值班面板就会显示闪烁的 REPEAT，提醒值班人员失职；必须由主站按「确认 ACK」才能清除',
                        '按下值班面板的消音按钮后，失职报警立即清除，不必再确认',
                        '失职报警只在集控室操作站显示，与驾驶台、轮机长的延伸报警面板无关',
                    ],
                    answer: 1,
                    analysis: '失职（Repeat）报警是对「报警无人确认」的再次提醒：默认 180 s 内值班人员未确认，或面板消音后主站仍未确认，驾驶台与轮机长面板就显示闪烁的 REPEAT。它不表示故障重复发生，也不会被消音清除，只能由主站「确认 ACK」消除，目的是防止报警被漏看、拖延。',
                },
            },
        ],
    },
    // ══════════════════════════════════════════════════════
    // 流程二：机舱监视与报警系统的网络结构
    // ══════════════════════════════════════════════════════
    'alarm-network': {
        id: 'alarm-network', name: '2. 机舱监视与报警系统的网络结构',
        steps: [
            // ① 进入网络结构页，识别主 ROS
            {
                msg: '第 1 步：进入网络结构页，识别主 ROS（控制 CAN Bus 1）。',
                mode: 'check',
                op: [
                    { type: 'page', page: 3, msg: '切换到「现场总线型系统结构」页' },
                    {
                        type: 'observe', target: 'topo', part: 'os-sgw-2',
                        msg: '识别主 ROS：集控室右侧 OS/SGW，经实线直接控制 CAN Bus 1',
                    },
                ],
                check() {
                    const sys = _sysOf(this);
                    return !!sys.pageMgr && sys.pageMgr.currentPage === 3
                        && sys.lastClickedId === 'topo' && sys.lastClickedPartId === 'topo/os-sgw-2';
                },
            },
            // ② 测试题：网络结构
            {
                msg: '第 2 步：测试题——机舱监视与报警系统的网络结构。',
                mode: 'quiz',
                quizConfig: {
                    question: 'K-Chief 600 机舱监视与报警系统采用的是哪种网络结构？',
                    options: [
                        '星型结构：每个测点都用独立电缆直接接到集控室操作站',
                        '现场总线和以太网相结合的网络结构：上层用以太网相互通信，下层使用 CAN 总线连接各个 DPU',
                        '环形光纤结构：各 DPU 首尾串成一个环网，集控室不设操作站',
                        '纯点对点 4~20 mA 模拟量网络，系统里没有任何数字总线',
                    ],
                    answer: 1,
                    analysis: 'K-Chief 600 采用「现场总线 + 以太网」相结合的结构：下层是 CAN 现场总线（CAN Bus 1 主用、CAN Bus 2 备用冗余），把机舱各个 dPSC 分布式处理单元——RDi-32 数字量输入、RDo-16 数字量输出、RAi-16 / RAi-10tc 模拟量输入、RAo-8 模拟量输出、RIO-C4——就近连接起来；上层用以太网（Ethernet 1 / 2）把集控室、住舱、驾驶台的操作站 OS、WBU、WCU 相互通信，并用 CAN Bus 3 连接值班召唤单元。这样布线少、扩展方便、可靠性高。',
                },
            },
            // ③ 数字量采集 DPU（两只 RDi-32 任选其一）
            {
                msg: '第 3 步：识别用于数字量采集的 DPU 模块（RDi-32，两只任选其一）。',
                mode: 'check',
                op: [
                    { type: 'observe', target: 'topo', part: 'dp-rdi1', msg: '识别数字量输入模块 RDi-32（旁边另一只同型号）' },
                ],
                check() {
                    const sys = _sysOf(this);
                    const part = (sys.lastClickedPartId || '').split('/')[1];
                    return sys.lastClickedId === 'topo' && (part === 'dp-rdi1' || part === 'dp-rdi2');
                },
            },
            // ④ 模拟量输出 DPU
            {
                msg: '第 4 步：识别用于模拟量输出的 DPU 模块（RAo-8）。',
                mode: 'find', target: 'topo', subTarget: 'dp-rao',
            },
            // ⑤ 机旁现场操作站
            {
                msg: '第 5 步：识别用于机旁控制的现场操作站（LOS）。',
                mode: 'find', target: 'topo', subTarget: 'los',
            },
            // ⑥ 住舱延伸报警 / 值班召唤单元（两台 WCU 任选其一）
            {
                msg: '第 6 步：识别住舱延伸报警与值班召唤单元（WCU，两台任选其一）。',
                mode: 'check',
                op: [
                    { type: 'observe', target: 'topo', part: 'wcu-1', msg: '识别住舱值班召唤单元 WCU（旁边另一台同型号）' },
                ],
                check() {
                    const sys = _sysOf(this);
                    const part = (sys.lastClickedPartId || '').split('/')[1];
                    return sys.lastClickedId === 'topo' && (part === 'wcu-1' || part === 'wcu-2');
                },
            },
            // ⑦ 驾驶台值班召唤与延伸报警单元
            {
                msg: '第 7 步：识别驾驶室值班召唤与延伸报警单元（WBU）。',
                mode: 'find', target: 'topo', subTarget: 'wbu',
            },
            // ⑧ 测试题：值班召唤所用网络
            {
                msg: '第 8 步：测试题——值班召唤系统所用的通信网络。',
                mode: 'quiz',
                quizConfig: {
                    question: '值班召唤（Watch calling）与住舱 / 驾驶台的延伸报警，走的是哪一条通信网络？',
                    options: [
                        'CAN Bus 3：住舱的 WCU、驾驶台的 WBU 都通过干线挂在这条值班召唤专用 CAN 总线上，再由集控室 OS/SGW 与操作系统联网',
                        'Ethernet 1：值班召唤信号通过以太网直接送到驾驶台',
                        'CAN Bus 2：值班召唤与机舱备用总线共用一条线',
                        '独立的 RS-232 串口线，与监视报警系统完全无关',
                    ],
                    answer: 0,
                    analysis: '从系统结构图可见，两台 WCU 与 WBU 都经红色干线接入 CAN Bus 3，集控室左右 OS/SGW 之间同样用 CAN Bus 3 相连，因此值班召唤与住舱 / 驾驶台延伸报警走 CAN Bus 3；CAN Bus 1 / CAN Bus 2 只服务机舱 dPSC 的现场采集。',
                },
            },
        ],
    },

    // ══════════════════════════════════════════════════════
    // 流程三：查询和修改参数
    // ══════════════════════════════════════════════════════
    'param-query': {
        id: 'param-query', name: '3. 查询和修改参数',
        steps: [
            // ① 进入报警组 M/E LO SYSTEM
            {
                msg: '第 1 步：进入报警系统页面，点击报警分组「M/E LO SYSTEM」。',
                mode: 'check',
                op: [
                    { type: 'page', page: 1, msg: '切换到「报警系统主界面」页' },
                    {
                        type: 'btn', target: 'kchief', part: 'dock-ME-LO', msg: '点击报警分组「M/E LO SYSTEM」',
                        async act() { await _click(_sysOf(this), 'kchief', 'dock-ME-LO'); await _sleep(900); },
                    },
                ],
                check() {
                    const sys = _sysOf(this); const c = _kc(sys);
                    return !!c && c.overlayKind === 'group' && c._groupFilter === 'ME-LO';
                },
            },
            // ② 填空：ME-LO-P 的报警类型 / 方式 / 当前限值
            {
                msg: '第 2 步：填写 ME-LO-P 的报警类型、报警方式与当前报警限。',
                mode: 'fill',
                target: 'kchief',
                ready() { const c = _kc(_sysOf(this)); return !!c && c.overlayKind === 'group'; },
                fields: [
                    { label: '报警类型', answer: ['模拟量报警', '模拟量'], placeholder: '如：模拟量报警' },
                    { label: '报警方式', answer: ['下限报警', '低限报警'], placeholder: '如：下限报警' },
                    { label: '当前报警限', unit: 'MPa', answer: 0.25, tolerance: 0.02, placeholder: '如：0.25' },
                ],
            },
            // ③ 填空：ME-LO-PR-SW 的报警类型
            {
                msg: '第 3 步：填写开关量测点 ME-LO-PR-SW 的报警类型。',
                mode: 'fill',
                target: 'kchief',
                ready() { const c = _kc(_sysOf(this)); return !!c && c.overlayKind === 'group'; },
                fields: [
                    { label: '报警类型', answer: ['开关量报警', '开关量'], placeholder: '如：开关量报警' },
                ],
            },
            // ④ 修改 ME-LO-P 的下限与死区
            {
                msg: '第 4 步：双击 ME-LO-P 行，下限改 0.22 MPa、死区改 0.06 MPa 并保存。',
                mode: 'check',
                op: [
                    {
                        type: 'observe', target: 'kchief', part: 'row-0', msg: '双击 ME-LO-P 行，打开报警参数界面',
                        async act() { await _openParamByTag(_sysOf(this), 'ME-LO-P'); },
                    },
                    {
                        type: 'observe', target: 'kchief', part: 'param-limit', msg: '把下限（Low Limit）改为 0.22',
                        async act() { await _setParamNumber(_sysOf(this), 'limit', 0.22); },
                    },
                    {
                        type: 'observe', target: 'kchief', part: 'param-deadband', msg: '把报警死区（Deadband）改为 0.06',
                        async act() { await _setParamNumber(_sysOf(this), 'deadband', 0.06); },
                    },
                    {
                        type: 'btn', target: 'kchief', part: 'param-save', msg: '点击「保存」写入参数',
                        async act() { await _click(_sysOf(this), 'kchief', 'param-save'); await _sleep(700); },
                    },
                ],
                check() {
                    const sys = _sysOf(this); const M = _M(sys); const c = _kc(sys);
                    const t = M && M.tag('ME-LO-P');
                    return !!(t && Math.abs(t.limit - 0.22) < 0.001
                        && Math.abs(t.deadband - 0.06) < 0.001
                        && c && c.overlayKind !== 'param');
                },
            },
            // ⑤ 修改 ME-LO-PR-SW 的报警延时
            {
                msg: '第 5 步：双击 ME-LO-PR-SW 行，把报警延时改为 3 s 并保存。',
                mode: 'check',
                op: [
                    {
                        // M/E LO SYSTEM 组页里 ME-LO-PR-SW 是第 7 行（行部件 row-6，0 基）
                        type: 'observe', target: 'kchief', part: 'row-6', msg: '双击 ME-LO-PR-SW 行，打开报警参数界面',
                        async act() { await _openParamByTag(_sysOf(this), 'ME-LO-PR-SW'); },
                    },
                    {
                        type: 'observe', target: 'kchief', part: 'param-delay', msg: '把报警延时（Delay Time）改为 3 s',
                        async act() { await _setParamNumber(_sysOf(this), 'delay', 3); },
                    },
                    {
                        type: 'btn', target: 'kchief', part: 'param-save', msg: '点击「保存」写入参数',
                        async act() { await _click(_sysOf(this), 'kchief', 'param-save'); await _sleep(700); },
                    },
                ],
                check() {
                    const sys = _sysOf(this); const M = _M(sys); const c = _kc(sys);
                    const t = M && M.tag('ME-LO-PR-SW');
                    return !!(t && Number(t.delay) === 3 && c && c.overlayKind !== 'param');
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
