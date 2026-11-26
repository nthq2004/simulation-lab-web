/**
 * 风油切断装置的功能实验（单页工程）
 * ═══════════════════════════════════════════════════════════════
 *  画布同屏 4 台设备（1920 × 1080 基准）：
 *    wfcut  风油切断操作与原理演示组件（左）
 *           上半：消防控制室 / 驾驶台 两块完全相同的风油切断控制屏（4 路自锁按钮）
 *           下半：风油切断工作原理 MIMIC（风机切断电路 + 油泵切断电路，24V 直流）
 *    load   部分动力负载屏（中）：3 × 3 塑壳断路器，含 6 路风机/油泵 + 3 路备用
 *    fan1   风机及控制面板（右上）：RUNNING/POWER 指示 + START/STOP + MAN/AUT 旋钮 + 风机
 *    pump1  油泵及控制面板（右下）：面板与风机相同，右侧为油泵符号
 *
 *  控制关系：
 *    任一地点按下应急切断按钮（自锁）→ 该回路中间继电器（KA1/KA2）得电
 *      → 三副常开辅助触头闭合 → 三路分励脱扣器（SR）带电
 *      → 动力负载屏对应塑壳断路器跳闸（手柄停 TRIP 位）
 *      → 风机/油泵失电（POWER 灯灭）、立即停转（RUNNING 灯灭、桨叶/转子停转）
 *    按钮弹出复位后脱扣回路失电；塑壳断路器须先复位到 OFF，再合闸到 ON。
 * ═══════════════════════════════════════════════════════════════
 */

import { WindFuelCutoffDemo } from '../components/WindFuelCutoffDemo.js';
import { PartialLoadPanel } from '../components/PartialLoadPanel.js';
import { FanUnitPanel } from '../components/FanUnitPanel.js';
import { OilPumpUnitPanel } from '../components/OilPumpUnitPanel.js';

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

const _sysOf = (ctx) => (ctx && ctx.sys) ? ctx.sys : window.sys;
const _sleep = (ms) => new Promise(r => setTimeout(r, ms));
const _comp = (sys, id) => (sys && sys.comps) ? sys.comps[id] : null;

const _cut = (sys) => _comp(sys, 'wfcut');
const _load = (sys) => _comp(sys, 'load');
const _fan = (sys) => _comp(sys, 'fan1');
const _pump = (sys) => _comp(sys, 'pump1');

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
    for (let i = 0; i < times; i++) { _firePartClick(c, partId); await _sleep(260); }
}

async function _waitFor(sys, cond, timeoutMs = 15000, intervalMs = 200) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
        try { if (cond(sys)) return true; } catch (e) { /* ignore */ }
        await _sleep(intervalMs);
    }
    return false;
}

/** 合上某一路塑壳断路器（脱扣先复位） */
async function _closeSwitch(sys, idx) {
    const L = _load(sys);
    if (!L) return;
    if (L.isTripped(idx)) { _firePartClick(L, `qf${idx + 1}`); await _sleep(300); }
    if (!L.isOn(idx)) { _firePartClick(L, `qf${idx + 1}`); await _sleep(300); }
}

/** 复位全部状态：按钮弹出、断路器复位合闸、机组回 MAN 停机 */
async function _resetRig(sys) {
    if (!sys) return;
    const cut = _cut(sys), L = _load(sys), fan = _fan(sys), pump = _pump(sys);
    if (cut && cut.resetAll) cut.resetAll();
    if (fan && fan.setMode) fan.setMode('MAN');
    if (pump && pump.setMode) pump.setMode('MAN');
    if (fan) fan.running = false;
    if (pump) pump.running = false;
    if (L && L.resetAll) L.resetAll();
    if (L && L.setBusLive) L.setBusLive(true);      // 复位时恢复主配电板供电
    await _sleep(400);
    if (sys.redrawAll) sys.redrawAll();
}

// ═══════════════════════════════════════════════════════════════
// 故障配置（走故障设置界面）
// ═══════════════════════════════════════════════════════════════

export const FAULT_CONFIGS = {
    'cut-ka-fan': {
        id: 'cut-ka-fan', name: '风机切断回路中间继电器 KA1 线圈断线', system: '控制回路',
        check() { const c = _cut(window.sys); return !!(c && c.hasFaultKA && c.hasFaultKA()); },
        trigger() { const c = _cut(window.sys); if (c && c.setFaultKA) c.setFaultKA(true); },
        repair() { const c = _cut(window.sys); if (c && c.setFaultKA) c.setFaultKA(false); },
    },
    'cut-shunt-f2': {
        id: 'cut-shunt-f2', name: '2# 风机分励脱扣器线圈断线', system: '脱扣回路',
        check() { const c = _cut(window.sys); return !!(c && c.hasFaultShunt && c.hasFaultShunt(1)); },
        trigger() { const c = _cut(window.sys); if (c && c.setFaultShunt) c.setFaultShunt(1, true); },
        repair() { const c = _cut(window.sys); if (c && c.setFaultShunt) c.setFaultShunt(1, false); },
    },
};

// ═══════════════════════════════════════════════════════════════
// 工作流
// ═══════════════════════════════════════════════════════════════

export const PROJECT_WORKFLOWS = {

    // ══════════════════════════════════════════════════════
    // 流程一：风油切断装置的组成与识读
    // ══════════════════════════════════════════════════════
    'cut-identify': {
        id: 'cut-identify', name: '1. 风油切断装置的组成与识读',
        steps: [
            { msg: '第 1 步：识别「机舱风机应急切断」按钮（ESS-1F）。', mode: 'find', target: 'wfcut', subTarget: 'btn-fire-0' },
            { msg: '第 2 步：识别驾驶台的「机舱油泵应急切断」按钮。', mode: 'find', target: 'wfcut', subTarget: 'btn-bridge-1' },
            { msg: '第 3 步：识别中间继电器 KA1。', mode: 'find', target: 'wfcut', subTarget: 'ka-fan' },
            { msg: '第 4 步：识别 1#机舱风机塑壳断路器（ESS-1F）。', mode: 'find', target: 'load', subTarget: 'qf1' },
            { msg: '第 5 步：识别 1#滑油泵塑壳断路器（ESS-1P）。', mode: 'find', target: 'load', subTarget: 'qf4' },
            { msg: '第 6 步：识别风机面板的 START 起动按钮。', mode: 'find', target: 'fan1', subTarget: 'btn-start' },
            { msg: '第 7 步：识别风机面板的 MAN/AUT 控制方式旋钮。', mode: 'find', target: 'fan1', subTarget: 'mode-knob' },
            { msg: '第 8 步：识别油泵面板的 STOP 停止按钮。', mode: 'find', target: 'pump1', subTarget: 'btn-stop' },
        ],
    },

    // ══════════════════════════════════════════════════════
    // 流程二：风油切断的操作与原理演示
    // ══════════════════════════════════════════════════════
    'cut-operate': {
        id: 'cut-operate', name: '2. 风油切断的操作与原理演示',
        steps: [
            {
                msg: '第 1 步：合上开关并起动风机、油泵。',
                mode: 'check',
                op: [
                    { type: 'switch', target: 'load', part: 'qf1', msg: '合上 1#机舱风机塑壳断路器', async act() { const s = _sysOf(this); await _resetRig(s); await _closeSwitch(s, 0); } },
                    { type: 'switch', target: 'load', part: 'qf4', msg: '合上 1#滑油泵塑壳断路器', async act() { const s = _sysOf(this); await _closeSwitch(s, 3); } },
                    { type: 'btn', target: 'fan1', part: 'btn-start', msg: '按风机面板 START，风机起动', async act() { const s = _sysOf(this); await _click(s, 'fan1', 'btn-start'); } },
                    { type: 'btn', target: 'pump1', part: 'btn-start', msg: '按油泵面板 START，油泵起动', async act() { const s = _sysOf(this); await _click(s, 'pump1', 'btn-start'); } },
                    { type: 'observe', target: 'fan1', part: 'run-lamp', msg: '观察 RUNNING 灯亮、桨叶旋转', async act() { const s = _sysOf(this); await _waitFor(s, x => (_fan(x) || {}).running === true, 8000); await _sleep(1200); } },
                ],
                check() {
                    const s = _sysOf(this), L = _load(s), f = _fan(s), p = _pump(s);
                    return !!(L && L.isOn(0) && L.isOn(3) && f && f.running && p && p.running);
                },
            },
            {
                msg: '第 2 步：在消防控制室按下「机舱风机应急切断」，观察风机跳闸停转。',
                mode: 'check',
                op: [
                    { type: 'btn', target: 'wfcut', part: 'btn-fire-0', msg: '按下机舱风机应急切断按钮（自锁）', async act() { const s = _sysOf(this); await _click(s, 'wfcut', 'btn-fire-0'); } },
                    { type: 'observe', target: 'wfcut', part: 'ka-fan', msg: '观察 KA1 得电吸合、三副辅助触头闭合', async act() { const s = _sysOf(this); await _waitFor(s, x => (_cut(x) || {}).isKaFanEnergized && _cut(x).isKaFanEnergized(), 8000); await _sleep(1200); } },
                    { type: 'observe', target: 'load', part: 'qf1', msg: '观察三台风机断路器分励脱扣跳闸', async act() { const s = _sysOf(this); await _waitFor(s, x => (_load(x) || {}).isTripped && _load(x).isTripped(0), 8000); await _sleep(1000); } },
                    { type: 'observe', target: 'fan1', part: 'fan', msg: '观察风机失电停转、RUNNING 与 POWER 灯灭', async act() { const s = _sysOf(this); await _waitFor(s, x => (_fan(x) || {}).running === false, 8000); await _sleep(1200); } },
                ],
                check() {
                    const s = _sysOf(this), C = _cut(s), L = _load(s), f = _fan(s);
                    return !!(C && C.isFanCut() && C.isKaFanEnergized()
                        && L && L.isTripped(0) && L.isTripped(1) && L.isTripped(2)
                        && f && f.running === false);
                },
            },
            {
                msg: '第 3 步：再按一次按钮使其弹出，复位断路器并重新起动风机。',
                mode: 'check',
                op: [
                    { type: 'btn', target: 'wfcut', part: 'btn-fire-0', msg: '再按一次，按钮弹出（脱扣回路失电）', async act() { const s = _sysOf(this); await _click(s, 'wfcut', 'btn-fire-0'); } },
                    { type: 'switch', target: 'load', part: 'qf1', msg: '先复位到 OFF，再合闸到 ON', async act() { const s = _sysOf(this); await _closeSwitch(s, 0); await _closeSwitch(s, 1); await _closeSwitch(s, 2); } },
                    { type: 'btn', target: 'fan1', part: 'btn-start', msg: '重新按 START 起动机舱风机', async act() { const s = _sysOf(this); await _click(s, 'fan1', 'btn-start'); } },
                    { type: 'observe', target: 'fan1', part: 'run-lamp', msg: '观察风机恢复运行', async act() { const s = _sysOf(this); await _waitFor(s, x => (_fan(x) || {}).running === true, 8000); await _sleep(1200); } },
                ],
                check() {
                    const s = _sysOf(this), C = _cut(s), L = _load(s), f = _fan(s);
                    return !!(C && !C.isFanCut() && L && L.isOn(0) && f && f.running);
                },
            },
            {
                msg: '第 4 步：驾驶台按下「机舱油泵应急切断」，油泵断电、发电机停机、全船失电。',
                mode: 'check',
                op: [
                    { type: 'btn', target: 'wfcut', part: 'btn-bridge-1', msg: '按下机舱油泵应急切断按钮（自锁）', async act() { const s = _sysOf(this); await _click(s, 'wfcut', 'btn-bridge-1'); } },
                    { type: 'observe', target: 'wfcut', part: 'ka-oil', msg: '观察 KA2 得电、油泵支路触头闭合', async act() { const s = _sysOf(this); await _waitFor(s, x => (_cut(x) || {}).isKaOilEnergized && _cut(x).isKaOilEnergized(), 8000); await _sleep(1000); } },
                    { type: 'observe', target: 'load', part: 'qf4', msg: '观察三台油泵断路器跳闸', async act() { const s = _sysOf(this); await _waitFor(s, x => (_load(x) || {}).isTripped && _load(x).isTripped(3), 8000); await _sleep(1000); } },
                    { type: 'observe', target: 'pump1', part: 'pump', msg: '观察油泵停转、POWER 灯灭', async act() { const s = _sysOf(this); await _waitFor(s, x => (_pump(x) || {}).running === false, 8000); await _sleep(900); } },
                    { type: 'observe', target: 'load', part: 'board', msg: '观察燃油泵全停 → 发电机停机、主配电板失电', async act() { const s = _sysOf(this); await _waitFor(s, x => { const L = _load(x); return L && L.getBusLive && !L.getBusLive(); }, 8000); await _sleep(1200); } },
                    { type: 'observe', target: 'fan1', part: 'power-lamp', msg: '观察原本运行的风机也失电停转', async act() { const s = _sysOf(this); await _waitFor(s, x => (_fan(x) || {}).running === false, 8000); await _sleep(1200); } },
                ],
                check() {
                    const s = _sysOf(this), C = _cut(s), L = _load(s), p = _pump(s), f = _fan(s);
                    return !!(C && C.isOilCut() && L && L.isTripped(3) && L.isTripped(4) && L.isTripped(5)
                        && !L.getBusLive() && p && p.running === false && f && f.running === false);
                },
            },
            {
                msg: '第 5 步：弹出切断按钮、复位合闸再按 START，观察配电板失电仍不能起动。',
                mode: 'check',
                op: [
                    { type: 'btn', target: 'wfcut', part: 'btn-bridge-1', msg: '再按一次，按钮弹出（脱扣回路失电）', async act() { const s = _sysOf(this); await _click(s, 'wfcut', 'btn-bridge-1'); } },
                    { type: 'switch', target: 'load', part: 'qf4', msg: '复位到 OFF 再合闸，开关处于合闸位', async act() { const s = _sysOf(this); await _closeSwitch(s, 3); await _sleep(400); } },
                    { type: 'btn', target: 'pump1', part: 'btn-start', msg: '按 START 尝试起动油泵', async act() { const s = _sysOf(this); await _click(s, 'pump1', 'btn-start'); await _sleep(600); } },
                    { type: 'observe', target: 'pump1', part: 'power-lamp', msg: '观察 POWER 灯不亮：开关已合闸但汇流排无电', async act() { await _sleep(1500); } },
                ],
                check() {
                    const s = _sysOf(this), L = _load(s), p = _pump(s);
                    return !!(L && L.isOn(3) && !L.getBusLive() && p && p.running === false && !p.hasPower());
                },
            },
            {
                msg: '第 6 步：重新起动发电机组建压，油泵恢复运行。',
                mode: 'check',
                op: [
                    { type: 'btn', target: 'load', part: 'bus-reset', msg: '点击主配电板汇流排指示，发电机组重新起动建压', async act() { const s = _sysOf(this); const L = _load(s); if (L && L.resetBus) L.resetBus(); await _sleep(600); } },
                    { type: 'observe', target: 'load', part: 'board', msg: '观察汇流排恢复带电（指示由红转绿）', async act() { const s = _sysOf(this); await _waitFor(s, x => { const L = _load(x); return L && L.getBusLive && L.getBusLive(); }, 8000); await _sleep(1000); } },
                    { type: 'btn', target: 'pump1', part: 'btn-start', msg: '按 START 重新起动油泵', async act() { const s = _sysOf(this); await _click(s, 'pump1', 'btn-start'); await _sleep(600); } },
                ],
                check() {
                    const s = _sysOf(this), L = _load(s), p = _pump(s);
                    return !!(L && L.getBusLive() && p && p.running === true);
                },
            },
            {
                msg: '第 7 步：选择正确答案。',
                mode: 'quiz',
                quizConfig: {
                    question: '按下应急切断按钮后，风机停止的直接原因是什么？',
                    options: [
                        '按下按钮直接断开了风机电动机的动力电源线',
                        '按钮使控制回路接通中间继电器，其辅助触头接通塑壳断路器的分励脱扣器，断路器跳闸切断动力电源',
                        '按钮使风机的热继电器动作，切断控制回路',
                        '按钮使配电板汇流排失电，全部负荷停电',
                    ],
                    answer: 1,
                    analysis: '风油切断是“弱电控强电”：24V 按钮回路经中间继电器放大触点数量，再由分励脱扣器使塑壳断路器跳闸，从而切断对应负荷的动力电源；汇流排与其他负荷不受影响。',
                },
            },
        ],
    },

    // ══════════════════════════════════════════════════════
    // 流程三：风油切断回路的故障分析
    // ══════════════════════════════════════════════════════
    'cut-fault': {
        id: 'cut-fault', name: '3. 风油切断回路的故障分析',
        steps: [
            {
                msg: '第 1 步：复位回路，设置故障「KA1 线圈断线」。',
                mode: 'check',
                op: [
                    { type: 'btn', target: 'wfcut', part: 'btn-fire-0', msg: '把上次按下的按钮弹出复位', async act() { const s = _sysOf(this); await _resetRig(s); } },
                    { type: 'fault', fault: 'cut-ka-fan', msg: '在故障设置界面勾选「KA1 线圈断线」并应用', async act() { await _sleep(800); } },
                ],
                check() {
                    const s = _sysOf(this), C = _cut(s);
                    return !!(C && C.hasFaultKA());
                },
            },
            {
                msg: '第 2 步：起动风机后按下切断按钮，观察 KA1 不吸合、风机不停。',
                mode: 'check',
                op: [
                    { type: 'switch', target: 'load', part: 'qf1', msg: '合上 1#机舱风机塑壳断路器', async act() { const s = _sysOf(this); await _closeSwitch(s, 0); } },
                    { type: 'btn', target: 'fan1', part: 'btn-start', msg: '按 START 起动风机', async act() { const s = _sysOf(this); await _click(s, 'fan1', 'btn-start'); } },
                    { type: 'btn', target: 'wfcut', part: 'btn-fire-0', msg: '按下机舱风机应急切断按钮（自锁）', async act() { const s = _sysOf(this); await _click(s, 'wfcut', 'btn-fire-0'); } },
                    { type: 'observe', target: 'wfcut', part: 'ka-fan', msg: '观察 KA1 线圈断线，不吸合、触头不闭合', async act() { await _sleep(2000); } },
                    { type: 'observe', target: 'load', part: 'qf1', msg: '观察风机断路器仍在合闸位、风机继续运行', async act() { await _sleep(1500); } },
                ],
                check() {
                    const s = _sysOf(this), C = _cut(s), L = _load(s), f = _fan(s);
                    return !!(C && C.isFanCut() && !C.isKaFanEnergized()
                        && L && !L.isTripped(0) && f && f.running === true);
                },
            },
            {
                msg: '第 3 步：取消故障，观察回路接通、三台风机立即跳闸。',
                mode: 'check',
                op: [
                    { type: 'fault', fault: 'cut-ka-fan', repair: true, msg: '取消勾选「KA1 线圈断线」并应用', async act() { await _sleep(1500); } },
                    { type: 'observe', target: 'load', part: 'qf1', msg: '观察三台风机断路器立即脱扣跳闸', async act() { const s = _sysOf(this); await _waitFor(s, x => (_load(x) || {}).isTripped && _load(x).isTripped(0), 10000); await _sleep(1200); } },
                ],
                check() {
                    const s = _sysOf(this), C = _cut(s), L = _load(s);
                    return !!(C && !C.hasFaultKA() && L && L.isTripped(0) && L.isTripped(1) && L.isTripped(2));
                },
            },
            {
                msg: '第 4 步：复位按钮与断路器，设置故障「2# 风机分励脱扣器断线」。',
                mode: 'check',
                op: [
                    { type: 'btn', target: 'wfcut', part: 'btn-fire-0', msg: '弹出按钮，复位三台风机断路器', async act() {
                        const s = _sysOf(this), C = _cut(s), L = _load(s);
                        if (C && C.isFanCut()) { _firePartClick(C, 'btn-fire-0'); await _sleep(400); }
                        for (let i = 0; i < 3; i++) await _closeSwitch(s, i);
                    } },
                    { type: 'fault', fault: 'cut-shunt-f2', msg: '勾选「2# 风机分励脱扣器线圈断线」并应用', async act() { await _sleep(800); } },
                ],
                check() {
                    const s = _sysOf(this), C = _cut(s), L = _load(s);
                    return !!(C && C.hasFaultShunt(1) && !C.isFanCut() && L && L.isOn(0) && L.isOn(1) && L.isOn(2));
                },
            },
            {
                msg: '第 5 步：按下按钮，观察 1#、3# 风机跳闸而 2# 风机不跳闸。',
                mode: 'check',
                op: [
                    { type: 'btn', target: 'wfcut', part: 'btn-fire-3', msg: '按下泵房风机应急切断按钮（自锁）', async act() { const s = _sysOf(this); await _click(s, 'wfcut', 'btn-fire-3'); } },
                    { type: 'observe', target: 'load', part: 'qf1', msg: '观察 1#、3# 风机跳闸，2# 风机仍在合闸位', async act() { const s = _sysOf(this); await _waitFor(s, x => (_load(x) || {}).isTripped && _load(x).isTripped(0), 10000); await _sleep(1500); } },
                ],
                check() {
                    const s = _sysOf(this), C = _cut(s), L = _load(s);
                    return !!(C && C.isFanCut()
                        && L && L.isTripped(0) && !L.isTripped(1) && L.isTripped(2)
                        && L.isShuntLive(0) && !L.isShuntLive(1) && L.isShuntLive(2));
                },
            },
            {
                msg: '第 6 步：选择正确答案。',
                mode: 'quiz',
                quizConfig: {
                    question: '风机应急切断按钮按下后，风机仍不停止，可能的原因是？',
                    options: [
                        '控制电源电压偏高',
                        '中间继电器线圈断线或分励脱扣器回路断线，脱扣器无法带电',
                        '风机控制面板的 RUNNING 灯损坏',
                        '塑壳断路器额定电流选得过大',
                    ],
                    answer: 1,
                    analysis: '风油切断回路是串联通路：按钮 → 中间继电器线圈 → 辅助触头 → 分励脱扣器。任何一处断线（线圈断线、触头不闭合、脱扣器断线）都会使脱扣器失电，塑壳断路器不跳闸，风机继续运行。',
                },
            },
        ],
    },
};

// ═══════════════════════════════════════════════════════════════
// 页面定义（单页工程：不导出页面定义，长度为 0 时 consys.js 不会创建 pageMgr）
// ═══════════════════════════════════════════════════════════════

export const PROJECT_PAGES = [];

// ═══════════════════════════════════════════════════════════════
// 组件配置（1920 × 1080 基准坐标，全部同屏）
//   左：风油切断操作与原理演示（585 × 788）
//   中：部分动力负载屏（495 × 713）
//   右：风机控制屏（293 × 277，上）、油泵控制屏（293 × 277，下）
// ═══════════════════════════════════════════════════════════════

export const componentConfigs = [
    { Class: WindFuelCutoffDemo, id: 'wfcut', x: -100, y: 50, loadId: 'load', visible: true },
    { Class: PartialLoadPanel, id: 'load', x: 650, y: 100, visible: true },
    { Class: FanUnitPanel, id: 'fan1', x: 1300, y: 150, tag: 'ESS-1F', switchKey: 'fan-0', loadId: 'load', label: '1# 机舱风机', mode: 'MAN', visible: true },
    { Class: OilPumpUnitPanel, id: 'pump1', x: 1300, y: 500, tag: 'ESS-1P', switchKey: 'oil-0', loadId: 'load', label: '1# 滑油泵', mode: 'MAN', visible: true },

    // ══ 7 种标准仪表（默认隐藏，通过「选择仪表」调出）══
    { Class: Multimeter, id: 'multimeter', x: 700, y: 200, visible: false },
    { Class: MF47Multimeter, id: 'mf47-panel', x: 700, y: 200, visible: false },
    { Class: Oscilloscope_tri, id: 'osc', x: 700, y: 200, visible: false },
    { Class: SignalGenerator, id: 'sg', x: 700, y: 200, visible: false },
    { Class: ProcessCalibrator, id: 'cali', x: 700, y: 200, visible: false },
    { Class: ElecMeter, id: 'elecmeter', x: 700, y: 200, visible: false },
    { Class: RealMegohmMeter, id: 'megohm', x: 700, y: 200, visible: false },
];

// ═══════════════════════════════════════════════════════════════
// 工具栏快捷操作
// ═══════════════════════════════════════════════════════════════

export function initSlider(sys) {
    if (!sys) return;
    sys._noBlinkHighlight = true;
}

export function applyAllPresets(opts) {
    // 本工程为纯逻辑联锁（无电气/管路端口），无需接线
    if (opts && opts.init) return;
    const sys = _sysOf(this);
    if (!sys) return;
    sys.showFloatingTip && sys.showFloatingTip('本工程无外部接线：控制关系由组件内部联锁完成', 2600);
}

export async function applyStartSystem() {
    const sys = _sysOf(this);
    if (!sys) return;
    await _resetRig(sys);

    const L = _load(sys);
    if (L) for (let i = 0; i < 6; i++) await _closeSwitch(sys, i);

    const fan = _fan(sys), pump = _pump(sys);
    if (fan && fan.setMode) fan.setMode('MAN');
    if (pump && pump.setMode) pump.setMode('MAN');
    _firePartClick(fan, 'btn-start'); await _sleep(350);
    _firePartClick(pump, 'btn-start'); await _sleep(350);

    sys.redrawAll && sys.redrawAll();
}

export function fiveStep() {
    const sys = _sysOf(this);
    if (!sys) return;
    const C = _cut(sys);
    if (C && C.resetAll) C.resetAll();
    const L = _load(sys);
    if (L && L.resetAll) L.resetAll();
    // 5 点步进：机组切到 AUT，随供电状态自动起停，便于观察断电停转
    const fan = _fan(sys), pump = _pump(sys);
    if (fan && fan.setMode) fan.setMode('AUT');
    if (pump && pump.setMode) pump.setMode('AUT');
    sys.redrawAll && sys.redrawAll();
}
