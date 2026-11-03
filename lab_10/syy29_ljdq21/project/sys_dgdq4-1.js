// ═══════════════════════════════════════════════════════════════
// 项目 4.1 —— 压力变送器功能测试
//
// 组成：
//   ptrans   两线制压力变送器（0 ~ max MPa → 4 ~ 20 mA）
//   preg     压力调节阀（设定输入气压）
//   stopv    截止阀（合上/断开气源）
//   cab      气瓶（压力源；id 必须为 'cab'，PneumaticSolver 硬编码引用）
//   tconn    三通（上接压力表、左接变送器、右接调节阀）
//   pmeter   压力表
//   dcpower  24V 直流电源
//   varires  负载/限流可变电阻
//   ampmeter 电流表（检测 4~20mA 回路电流）
//   leak     检漏瓶（肥皂水，检测气路漏点）
//
// 三个流程：
//   1. 压力变送器的功能测试（项目 4.1）
//   2. 压力变送器回路断路故障排除（项目 4.1）
//   3. 压力变送器气路漏气故障排除（项目 4.1）
//
// 自动演示规范（见全局 AGENTS）：
//   · 动作前先闪烁箭头指示目标；op 数组逐个「指示 → 执行 act → 间隔」
//   · 接线 ≤8 根一律动画接线，逐根 await
//   · 参数调整一律走参数配置界面（_demoSetConfig）
//   · 故障设置/修复一律走故障界面（type:'fault'）
//   · 仪表调出一律走仪表界面（type:'instrument'）
// ═══════════════════════════════════════════════════════════════

import { Multimeter } from '../components/Multimeter.js';
import { MF47Multimeter } from '../components/MF47Multimeter.js';
import { Oscilloscope_tri } from '../components/Osc_tri.js';
import { SignalGenerator } from '../components/SignalGenerator.js';
import { ProcessCalibrator } from '../components/ProcessCalibrator.js';
import { ElecMeter } from '../components/ElecMeter.js';
import { RealMegohmMeter } from '../components/RealMegohmMeter.js';

import { AirBottle } from '../components/AirBottle.js';
import { StopValve } from '../components/StopValve.js';
import { TeeConnector } from '../components/TeeConnector.js';
import { PressRegulator } from '../components/PressRegulator.js';
import { PressTransmitter } from '../components/PressTransmitter.js';
import { PressMeter } from '../components/PressMeter.js';
import { DCPower } from '../components/DCPower.js';
import { VariResistor } from '../components/VariResistor.js';
import { AmpMeter } from '../components/AmpMeter.js';
import { LeakDetector } from '../components/LeakDetector.js';

// ═══════════════════════════════════════════════════════════════
// 通用辅助
// ═══════════════════════════════════════════════════════════════

/** 兼容「this = Workflow / WorkflowManager / ControlSystem / 无」几种调用姿势取 sys */
const _sysOf = (ctx) => (ctx && ctx.sys) ? ctx.sys : window.sys;

const _sleep = (ms) => new Promise(r => setTimeout(r, ms));

/** 无向判断两端口是否已连线 */
function _hasConn(sys, a, b) {
    return !!(sys && sys.conns) && sys.conns.some(c =>
        (c.from === a && c.to === b) || (c.from === b && c.to === a));
}

/** 清空全部连线（演示前先清理，避免残留悬空连线） */
function _clearConns(sys) {
    if (sys && Array.isArray(sys.conns)) {
        sys.conns.length = 0;
        sys.redrawAll();
    }
}

/** 动画接一根线（约 3s/根；已连接则跳过） */
async function _wireOne(sys, conn) {
    if (!sys || !sys.connMgr || !conn) return;
    if (_hasConn(sys, conn.from, conn.to)) return;
    await sys.connMgr.addConnectionAnimated({ from: conn.from, to: conn.to, type: conn.type || 'wire' });
}

/** 逐根动画接线 */
async function _wireSeq(sys, list) {
    for (const c of (list || [])) await _wireOne(sys, c);
}

/** 仪表表笔动画接线（先清旧表笔线，再逐根动画接红/黑表笔） */
async function _probeAnimated(sys, redPort, blackPort) {
    sys.conns = sys.conns.filter(c =>
        !(String(c.from).startsWith('multimeter') || String(c.to).startsWith('multimeter')));
    sys.redrawAll();
    await sys.connMgr.addConnectionAnimated({ from: 'multimeter_wire_v', to: redPort, type: 'wire' });
    await sys.connMgr.addConnectionAnimated({ from: 'multimeter_wire_com', to: blackPort, type: 'wire' });
    await _sleep(1200);
}

/** 接通/断开 DC 24V 电源 */
function _setPower(sys, on) {
    const dc = sys && sys.comps['dcpower'];
    if (dc) { dc.isOn = !!on; dc.update && dc.update(); }
    sys.redrawAll();
}

/** 合上/断开截止阀 */
function _setValve(sys, open) {
    const sv = sys && sys.comps['stopv'];
    if (sv) { sv.isOpen = !!open; sv.update && sv.update(); }
    sys.redrawAll();
}

/** 气瓶压力复位（清漏气标记、恢复气源） */
function _resetCab(sys) {
    const cab = sys && sys.comps['cab'];
    if (!cab) return;
    cab.isConsuming = false;
    cab.pressure = Math.min(5, cab.maxPressure || 20);
    cab.update && cab.update();
}

/** 清除气路漏气标记 */
function _clearLeak(sys) {
    if (!sys) return;
    ['ptrans_pipe_i', 'pmeter_pipe_i'].forEach(id => {
        const comp = sys.comps[id.split('_')[0]];
        const port = comp && comp.ports && comp.ports.find(p => p.id === id);
        if (port && port.node && port.node.setAttr) port.node.setAttr('isLeaking', false);
    });
}

/** 演示前的工位复位（内部初始化，不作为教学动作） */
function _resetRig(sys) {
    if (!sys) return;
    const dc = sys.comps['dcpower'];
    if (dc) { dc.isOn = false; dc.isBreak = false; dc.update && dc.update(); }
    const pt = sys.comps['ptrans'];
    if (pt) pt.isBreak = false;
    const sv = sys.comps['stopv'];
    if (sv) { sv.isOpen = false; sv.update && sv.update(); }
    const preg = sys.comps['preg'];
    if (preg) {
        // 设定压力归零（复位，非教学演示动作）
        if (typeof preg.onConfigUpdate === 'function') {
            preg.onConfigUpdate({ id: preg.id, unit: preg.displayUnit || 'MPa', setPressure: 0 });
        } else {
            preg.setPressure = 0;
            preg.update && preg.update();
        }
    }
    _clearLeak(sys);
    _resetCab(sys);
    try { sys.FAULT_CONFIG && sys.FAULT_CONFIG['circuit-open'] && sys.FAULT_CONFIG['circuit-open'].repair(); } catch (e) { /* ignore */ }
    try { sys.FAULT_CONFIG && sys.FAULT_CONFIG['air-leak'] && sys.FAULT_CONFIG['air-leak'].repair(); } catch (e) { /* ignore */ }
    sys.redrawAll();
}

/**
 * 通过参数配置界面动态演示参数修改（严格遵守「参数调整一律走配置界面」）：
 *   ① 弹框前把实时属性同步进 config 副本（否则「保存」会把旧值一并回写）
 *   ② comp.showConfigDialog() 弹出参数设置界面
 *   ③ 取 #diag_<key> 输入框 → 闪烁箭头高亮 + 填入新值
 *   ④ 取最后打开的对话框的「保存」按钮 → 闪烁箭头高亮 + 真正 click() 按下
 *   ⑤ 确认对话框已关闭（未关闭则点「取消」兜底）
 */
async function _demoSetConfig(wf, compId, key, value, tip) {
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
        if (wf && typeof wf._flashDomElement === 'function') {
            await wf._flashDomElement(input, tip || `请把该参数改为 ${value}`, 2400);
        }
        input.value = String(value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
    }

    const saveBtns = [...document.querySelectorAll('button')].filter(b => b.textContent.trim() === '保存');
    const saveBtn = saveBtns[saveBtns.length - 1];
    if (saveBtn) {
        if (wf && typeof wf._flashDomElement === 'function') {
            await wf._flashDomElement(saveBtn, '点击「保存」确认参数修改', 1800);
        }
        saveBtn.click();
        await _sleep(600);
    }

    if (input && document.body.contains(input)) {
        const cancelBtns = [...document.querySelectorAll('button')].filter(b => b.textContent.trim() === '取消');
        const cb = cancelBtns[cancelBtns.length - 1];
        if (cb) cb.click();
    }
    await _sleep(300);
}

/** 等待读数稳定（连续两次读数差 ≤ tol） */
async function _waitStable(sys, getter, tol = 0.15, timeoutMs = 8000, intervalMs = 200) {
    const t0 = Date.now();
    let last = null;
    while (Date.now() - t0 < timeoutMs) {
        const v = getter();
        if (last !== null && Math.abs(v - last) <= tol) return v;
        last = v;
        await _sleep(intervalMs);
    }
    return last;
}

/** 查找当前被标记为漏气的管口 */
function _findLeakPort(sys) {
    const ids = ['ptrans_pipe_i', 'pmeter_pipe_i'];
    for (const id of ids) {
        const comp = sys.comps[id.split('_')[0]];
        const port = comp && comp.ports && comp.ports.find(p => p.id === id);
        if (port && port.node && port.node.getAttr && port.node.getAttr('isLeaking')) return port;
    }
    for (const comp of Object.values(sys.comps || {})) {
        if (!comp || !Array.isArray(comp.ports)) continue;
        for (const p of comp.ports) {
            if (p.type === 'pipe' && p.node && p.node.getAttr && p.node.getAttr('isLeaking')) return p;
        }
    }
    return null;
}

/** 把检漏瓶移至漏点并触发气泡检测 */
async function _demoLeakDetector(sys) {
    const leak = sys && sys.comps['leak'];
    if (!leak) return;
    const w = leak.w || 60, h = leak.h || 90;
    const port = _findLeakPort(sys);
    if (port && port.node && port.node.getAbsolutePosition) {
        const p = port.node.getAbsolutePosition();
        leak.group.position({ x: p.x - w / 2, y: p.y + h * 0.1 });
    }
    sys.redrawAll();
    await _sleep(600);
    if (typeof leak.checkCollision === 'function') leak.checkCollision();
    if (!leak.isEmitting && typeof leak.startEmitting === 'function') {
        const pos = leak.group.getAbsolutePosition();
        leak.startEmitting(port && port.node ? port.node.getAbsolutePosition().x : pos.x,
                           port && port.node ? port.node.getAbsolutePosition().y : pos.y);
    }
    await _sleep(2500);
}

// ═══════════════════════════════════════════════════════════════
// 接线表
// ═══════════════════════════════════════════════════════════════

const ELEC_CONNS = [
    { from: 'dcpower_wire_p', to: 'varires_wire_l', type: 'wire' },
    { from: 'varires_wire_r', to: 'ptrans_wire_p', type: 'wire' },
    { from: 'ptrans_wire_n', to: 'ampmeter_wire_p', type: 'wire' },
    { from: 'ampmeter_wire_n', to: 'dcpower_wire_n', type: 'wire' },
];

const PNEU_CONNS = [
    { from: 'cab_pipe_o', to: 'stopv_pipe_i', type: 'pipe' },
    { from: 'stopv_pipe_o', to: 'preg_pipe_i', type: 'pipe' },
    { from: 'preg_pipe_o', to: 'tconn_pipe_r', type: 'pipe' },
    { from: 'tconn_pipe_u', to: 'pmeter_pipe_i', type: 'pipe' },
    { from: 'tconn_pipe_l', to: 'ptrans_pipe_i', type: 'pipe' },
];

/** 电气回路接线 op 组（逐根动画，箭头指向来源组件/端口） */
function _elecWireOps(sysRef) {
    const meta = [
        { conn: ELEC_CONNS[0], target: 'dcpower', part: 'p', msg: '接线①：24V 电源正端 (+) → 可变电阻左端' },
        { conn: ELEC_CONNS[1], target: 'varires', part: undefined, msg: '接线②：可变电阻右端 → 压力变送器 P(+)' },
        { conn: ELEC_CONNS[2], target: 'ptrans', part: 'p', msg: '接线③：压力变送器 N(-) → 电流表 P(+)' },
        { conn: ELEC_CONNS[3], target: 'ampmeter', part: undefined, msg: '接线④：电流表 N(-) → 24V 电源负端 (-)' },
    ];
    return meta.map(m => ({
        type: 'observe', target: m.target, part: m.part, msg: m.msg,
        async act() { await _wireOne(this.sys, m.conn); },
    }));
}

/** 气路接线 op 组（逐根动画） */
function _pneuWireOps(sysRef) {
    const meta = [
        { conn: PNEU_CONNS[0], target: 'cab', part: 'o', msg: '接气①：气瓶出口 → 截止阀右端' },
        { conn: PNEU_CONNS[1], target: 'stopv', part: undefined, msg: '接气②：截止阀左端 → 调节阀入口' },
        { conn: PNEU_CONNS[2], target: 'preg', part: undefined, msg: '接气③：调节阀出口 → 三通右端' },
        { conn: PNEU_CONNS[3], target: 'tconn', part: 'u', msg: '接气④：三通上端 → 压力表进气口' },
        { conn: PNEU_CONNS[4], target: 'tconn', part: 'l', msg: '接气⑤：三通左端 → 压力变送器气压口' },
    ];
    return meta.map(m => ({
        type: 'observe', target: m.target, part: m.part, msg: m.msg,
        async act() { await _wireOne(this.sys, m.conn); },
    }));
}

const _allConns = () => [...ELEC_CONNS, ...PNEU_CONNS];

// ═══════════════════════════════════════════════════════════════
// 故障配置（走故障界面：check/trigger/repair 供 UI 与判定使用）
// ═══════════════════════════════════════════════════════════════

export const FAULT_CONFIGS = {
    // ── 故障一：变送器回路断路（电源断线 或 变送器内部断线，随机选 1）──
    'circuit-open': {
        id: 'circuit-open',
        name: '压力变送器回路断路',
        system: '电路',
        check() {
            const sys = window.sys;
            if (!sys) return false;
            return !!(sys.comps['dcpower'] && sys.comps['dcpower'].isBreak)
                || !!(sys.comps['ptrans'] && sys.comps['ptrans'].isBreak);
        },
        trigger() {
            const sys = window.sys;
            if (!sys) return;
            const dc = sys.comps['dcpower'];
            const pt = sys.comps['ptrans'];
            if (dc) { dc.isBreak = false; dc.update && dc.update(); }
            if (pt) pt.isBreak = false;
            const choices = ['dcpower', 'ptrans'];
            const pick = choices[Math.floor(Math.random() * choices.length)];
            const dev = sys.comps[pick];
            if (dev) {
                dev.isBreak = true;
                dev.update && dev.update();
            }
        },
        repair() {
            const sys = window.sys;
            if (!sys) return;
            const dc = sys.comps['dcpower'];
            const pt = sys.comps['ptrans'];
            if (dc) { dc.isBreak = false; dc.update && dc.update(); }
            if (pt) pt.isBreak = false;
        },
    },

    // ── 故障二：气路漏气（变送器接口 或 压力表接口，随机选 1）──
    'air-leak': {
        id: 'air-leak',
        name: '压力变送器气路漏气',
        system: '气路',
        check() {
            const sys = window.sys;
            if (!sys) return false;
            return ['ptrans_pipe_i', 'pmeter_pipe_i'].some(id => {
                const comp = sys.comps[id.split('_')[0]];
                const port = comp && comp.ports && comp.ports.find(p => p.id === id);
                return !!(port && port.node && port.node.getAttr && port.node.getAttr('isLeaking'));
            });
        },
        trigger() {
            const sys = window.sys;
            if (!sys) return;
            const ids = ['ptrans_pipe_i', 'pmeter_pipe_i'];
            // 先全部清除，再随机标记一个
            ids.forEach(id => {
                const comp = sys.comps[id.split('_')[0]];
                const port = comp && comp.ports && comp.ports.find(p => p.id === id);
                if (port && port.node && port.node.setAttr) port.node.setAttr('isLeaking', false);
            });
            const id = ids[Math.floor(Math.random() * ids.length)];
            const comp = sys.comps[id.split('_')[0]];
            const port = comp && comp.ports && comp.ports.find(p => p.id === id);
            if (port && port.node && port.node.setAttr) port.node.setAttr('isLeaking', true);
        },
        repair() {
            const sys = window.sys;
            if (!sys) return;
            ['ptrans_pipe_i', 'pmeter_pipe_i'].forEach(id => {
                const comp = sys.comps[id.split('_')[0]];
                const port = comp && comp.ports && comp.ports.find(p => p.id === id);
                if (port && port.node && port.node.setAttr) port.node.setAttr('isLeaking', false);
            });
        },
    },
};

// ═══════════════════════════════════════════════════════════════
// 工作流
// ═══════════════════════════════════════════════════════════════

/** 压力点测试步骤（0.25/0.5/0.75/1.0 量程 → 8/12/16/20mA） */
function _pressureTestStep(stepNo, ratioText, ratio, current) {
    return {
        msg: `第 ${stepNo} 步：将输入气压调到 ${ratioText} 量程，观察变送器输出电流应上升并稳定在 ${current}mA`,
        mode: 'check',
        op: [
            {
                type: 'knob', target: 'preg',
                msg: `右键调节阀 →「参数设置」，把「设定压力」改为 ${ratioText} 量程`,
                async act() {
                    const sys = this.sys;
                    const target = +(ratio * sys.comps['ptrans'].max).toFixed(3);
                    await _demoSetConfig(this, 'preg', 'setPressure', target, `把「设定压力」改为 ${target} MPa`);
                },
            },
            {
                type: 'observe', target: 'ampmeter',
                msg: `观察电流表读数，应稳定在 ${current}mA 附近`,
                async act() { await _waitStable(this.sys, () => this.sys.comps['ampmeter'].value, 0.15, 8000); },
            },
        ],
        check() {
            const sys = this.sys;
            const pt = sys.comps['ptrans'];
            const am = sys.comps['ampmeter'];
            return Math.abs(sys.comps['preg'].setPressure - ratio * pt.max) < 0.02
                && Math.abs(am.value - current) < 0.4;
        },
    };
}

export const PROJECT_WORKFLOWS = {
    // ══════════════════════════════════════════════════════════
    // 流程一：压力变送器的功能测试
    // ══════════════════════════════════════════════════════════
    'pt-function-test': {
        id: 'pt-function-test',
        name: '1. 压力变送器的功能测试',
        steps: [
            {
                msg: '第 1 步：按 24V 电源(+) → 可变电阻 → 压力变送器 → 电流表 → 电源(-) 的顺序接好电气回路。',
                mode: 'check',
                op: [
                    {
                        type: 'observe', target: 'dcpower', part: 'p',
                        msg: '准备接线：先清空画布连线，再逐根接好电气回路',
                        async act() {
                            _clearConns(this.sys);
                            _resetRig(this.sys);
                            await _sleep(400);
                        },
                    },
                    ..._elecWireOps(),
                ],
                check() {
                    return ELEC_CONNS.every(c => _hasConn(this.sys, c.from, c.to));
                },
            },
            {
                msg: '第 2 步：接好气路——气瓶 → 截止阀 → 调节阀 → 三通 → 压力表 / 压力变送器气压口。',
                mode: 'check',
                op: [ ..._pneuWireOps() ],
                check() {
                    return PNEU_CONNS.every(c => _hasConn(this.sys, c.from, c.to));
                },
            },
            {
                msg: '第 3 步：按下 24V 电源键，接通变送器回路电源。',
                mode: 'check',
                op: [
                    {
                        type: 'switch', target: 'dcpower', part: 'power',
                        msg: '按下电源面板上的「电源键」，接通 DC 24V',
                        async act() { _setPower(this.sys, true); await _sleep(1200); },
                    },
                ],
                check() {
                    const dc = this.sys.comps['dcpower'];
                    return !!(dc && dc.isOn);
                },
            },
            {
                msg: '第 4 步：合上截止阀送入气压；此时设定气压为 0，变送器输出应为 4mA（零点）。',
                mode: 'check',
                op: [
                    {
                        type: 'switch', target: 'stopv',
                        msg: '转动手柄合上截止阀，向气路送气（设定气压当前为 0）',
                        async act() { _setValve(this.sys, true); await _sleep(1200); },
                    },
                    {
                        type: 'observe', target: 'ampmeter',
                        msg: '观察电流表：输入气压为 0 时，回路电流应为 4mA',
                        async act() { await _waitStable(this.sys, () => this.sys.comps['ampmeter'].value, 0.15, 8000); },
                    },
                ],
                check() {
                    const sys = this.sys;
                    const am = sys.comps['ampmeter'];
                    return !!(sys.comps['stopv'] && sys.comps['stopv'].isOpen)
                        && !sys.comps['ptrans'].isBreak
                        && Math.abs(am.value - 4) < 0.4;
                },
            },
            _pressureTestStep(5, '0.25 倍', 0.25, 8),
            _pressureTestStep(6, '0.5 倍', 0.5, 12),
            _pressureTestStep(7, '0.75 倍', 0.75, 16),
            _pressureTestStep(8, '1.0 倍', 1.0, 20),
            {
                msg: '第9步：压力变送器知识考核',
                mode: 'quiz',
                quizConfig: {
                    question: '两线制压力变送器输出的标准电流信号及其对应关系是：',
                    options: [
                        '4~20mA 线性对应 0~100% 量程（4mA 为零点、20mA 为满度）',
                        '0~20mA 非线性对应量程',
                        '4~20mA 对应 0~10V 电压',
                        '输出电流与气压无关，仅与电源电压有关',
                    ],
                    answer: 0,
                    analysis: '两线制压力变送器把被测压力线性转换为 4~20mA 标准电流信号：输入 0% 量程对应 4mA，100% 量程对应 20mA，中间按比例线性变化。因此测得回路电流即可反推压力（如 0.5 倍量程对应 12mA）。供电与信号共用两根导线，故称两线制。',
                },
            },
        ],
    },

    // ══════════════════════════════════════════════════════════
    // 流程二：回路断路故障排除
    // ══════════════════════════════════════════════════════════
    'pt-open-circuit': {
        id: 'pt-open-circuit',
        name: '2. 压力变送器回路断路故障排除',
        steps: [
            {
                msg: '第 1 步：接好电气回路——24V 电源(+) → 可变电阻 → 变送器 → 电流表 → 电源(-)。',
                mode: 'check',
                op: [
                    {
                        type: 'observe', target: 'dcpower', part: 'p',
                        msg: '准备接线：清空画布连线，逐根接好电气回路',
                        async act() {
                            _clearConns(this.sys);
                            _resetRig(this.sys);
                            await _sleep(400);
                        },
                    },
                    ..._elecWireOps(),
                ],
                check() { return ELEC_CONNS.every(c => _hasConn(this.sys, c.from, c.to)); },
            },
            {
                msg: '第 2 步：接好气路——气瓶 → 截止阀 → 调节阀 → 三通 → 压力表 / 变送器。',
                mode: 'check',
                op: [ ..._pneuWireOps() ],
                check() { return PNEU_CONNS.every(c => _hasConn(this.sys, c.from, c.to)); },
            },
            {
                msg: '第 3 步：设置「压力变送器回路断路」故障（电源断线或变送器内部断线）。',
                mode: 'check',
                op: [
                    {
                        type: 'fault', fault: 'circuit-open',
                        msg: '打开「故障设置」界面，勾选「压力变送器回路断路」，点击「应用设置」',
                        async act() { await _sleep(400); },
                    },
                ],
                check() { return this.sys.FAULT_CONFIG['circuit-open'].check(); },
            },
            {
                msg: '第 4 步：合上电源和截止阀，观察电流表显示为 0（回路无电流）。',
                mode: 'check',
                op: [
                    {
                        type: 'switch', target: 'dcpower', part: 'power',
                        msg: '按下电源键，接通 DC 24V',
                        async act() { _setPower(this.sys, true); await _sleep(1000); },
                    },
                    {
                        type: 'switch', target: 'stopv',
                        msg: '合上截止阀送气',
                        async act() { _setValve(this.sys, true); await _sleep(1000); },
                    },
                    {
                        type: 'observe', target: 'ampmeter',
                        msg: '观察电流表：回路断路时电流应为 0mA',
                        async act() { await _sleep(1500); },
                    },
                ],
                check() {
                    const sys = this.sys;
                    return !!(sys.comps['dcpower'].isOn && sys.comps['stopv'].isOpen)
                        && Math.abs(sys.comps['ampmeter'].value) < 0.3;
                },
            },
            {
                msg: '第 5 步：关闭气源，准备用万用表测量电压、查找断路点。',
                mode: 'check',
                op: [
                    {
                        type: 'switch', target: 'stopv',
                        msg: '转动手柄关闭截止阀',
                        async act() { _setValve(this.sys, false); await _sleep(1000); },
                    },
                ],
                check() { return !this.sys.comps['stopv'].isOpen; },
            },
            {
                msg: '第 6 步：调出数字万用表并置于 DC 200V 档，测量各段电压以定位断路点。',
                mode: 'check',
                op: [
                    {
                        type: 'instrument', instrument: 'multimeter',
                        msg: '通过工具栏「选择仪表」调出数字万用表',
                        async act() {
                            const mm = this.sys.comps['multimeter'];
                            if (mm) { mm.mode = 'DCV200'; mm._updateAngleByMode && mm._updateAngleByMode(); }
                        },
                    },
                    {
                        type: 'observe', target: 'multimeter', part: 'lcd',
                        msg: '红/黑表笔先跨接电源两端测电压：若无电压，再改接变送器 P(+) / N(-) 两端',
                        async act() {
                            const sys = this.sys;
                            const pt = sys.comps['ptrans'];
                            await _probeAnimated(sys, 'dcpower_wire_p', 'dcpower_wire_n');
                            await _sleep(1500);
                            // 电源正常则断点在变送器内部，改测变送器两端
                            if (pt && pt.isBreak) {
                                await _probeAnimated(sys, 'ptrans_wire_p', 'ptrans_wire_n');
                                await _sleep(1500);
                            }
                            const mm = sys.comps['multimeter'];
                            if (mm) { mm.mode = 'DCV200'; mm._updateAngleByMode && mm._updateAngleByMode(); }
                            await _sleep(600);
                        },
                    },
                ],
                check() {
                    const sys = this.sys;
                    const mm = sys.comps['multimeter'];
                    const pt = sys.comps['ptrans'];
                    const dc = sys.comps['dcpower'];
                    if (!mm || mm.mode !== 'DCV200' || !dc.isOn) return false;
                    if (pt.isBreak) {
                        if (!(_hasConn(sys, 'multimeter_wire_v', 'ptrans_wire_p')
                            && _hasConn(sys, 'multimeter_wire_com', 'ptrans_wire_n'))) return false;
                        return Math.abs(sys.getVoltageBetween('ptrans_wire_p', 'ptrans_wire_n')) > 10;
                    }
                    if (dc.isBreak) {
                        if (!(_hasConn(sys, 'multimeter_wire_v', 'dcpower_wire_p')
                            && _hasConn(sys, 'multimeter_wire_com', 'dcpower_wire_n'))) return false;
                        return Math.abs(sys.getVoltageBetween('dcpower_wire_p', 'dcpower_wire_n')) < 1;
                    }
                    return false;
                },
            },
            {
                msg: '第 7 步：关闭电源，在故障界面取消勾选并修复断路故障。',
                mode: 'check',
                op: [
                    {
                        type: 'switch', target: 'dcpower', part: 'power',
                        msg: '按下电源键，断开 DC 24V',
                        async act() { _setPower(this.sys, false); await _sleep(1000); },
                    },
                    {
                        type: 'fault', fault: 'circuit-open', repair: true,
                        msg: '打开「故障设置」界面，取消勾选「压力变送器回路断路」，点击「应用设置」修复',
                        async act() { await _sleep(400); },
                    },
                ],
                check() {
                    return !this.sys.comps['dcpower'].isOn
                        && !this.sys.FAULT_CONFIG['circuit-open'].check();
                },
            },
            {
                msg: '第 8 步：重新接通电源，确认无气压输入情况下电流恢复为 4mA。',
                mode: 'check',
                op: [
                    {
                        type: 'switch', target: 'dcpower', part: 'power',
                        msg: '按下电源键，重新接通 DC 24V',
                        async act() { _setPower(this.sys, true); await _sleep(1200); },
                    },
                    {
                        type: 'observe', target: 'ampmeter',
                        msg: '观察电流表：断点修复后电流应恢复为 4mA 左右',
                        async act() { await _waitStable(this.sys, () => this.sys.comps['ampmeter'].value, 0.15, 8000); },
                    },
                ],
                check() {
                    const sys = this.sys;
                    return !!(sys.comps['dcpower'].isOn)
                        && Math.abs(sys.comps['ampmeter'].value - 4) < 0.5;
                },
            },
            {
                msg: '第9步：回路断路故障排查知识考核',
                mode: 'quiz',
                quizConfig: {
                    question: '两线制变送器回路断路后，用万用表测量电压判断断点的正确思路是：',
                    options: [
                        '沿回路逐段测量：电源两端有正常电压说明电源完好；若电源两端无电压则电源断线，若变送器两端出现电源电压则变送器内部断线',
                        '断路时电流最大，应先用电流档测量',
                        '直接用电阻档带电测量回路电阻即可',
                        '断路后变送器仍会输出 20mA',
                    ],
                    answer: 0,
                    analysis: '回路断路时电流为 0，用万用表 DC 电压档逐段测量：电源输出端有 24V 说明电源正常；把表笔移到变送器 P(+)/N(-) 两端，若测得接近电源电压，说明回路其它部分完好、断点在变送器内部（开路处承受全部电压）。据此可快速定位故障点。注意不可带电用电阻档测量。',
                },
            },
        ],
    },

    // ══════════════════════════════════════════════════════════
    // 流程三：气路漏气故障排除
    // ══════════════════════════════════════════════════════════
    'pt-air-leak': {
        id: 'pt-air-leak',
        name: '3. 压力变送器气路漏气故障排除',
        steps: [
            {
                msg: '第 1 步：接好电气回路——24V 电源(+) → 可变电阻 → 变送器 → 电流表 → 电源(-)。',
                mode: 'check',
                op: [
                    {
                        type: 'observe', target: 'dcpower', part: 'p',
                        msg: '准备接线：清空画布连线，逐根接好电气回路',
                        async act() {
                            _clearConns(this.sys);
                            _resetRig(this.sys);
                            await _sleep(400);
                        },
                    },
                    ..._elecWireOps(),
                ],
                check() { return ELEC_CONNS.every(c => _hasConn(this.sys, c.from, c.to)); },
            },
            {
                msg: '第 2 步：接好气路——气瓶 → 截止阀 → 调节阀 → 三通 → 压力表 / 变送器。',
                mode: 'check',
                op: [ ..._pneuWireOps() ],
                check() { return PNEU_CONNS.every(c => _hasConn(this.sys, c.from, c.to)); },
            },
            {
                msg: '第 3 步：设置「压力变送器气路漏气」故障（变送器接口或压力表接口漏气）。',
                mode: 'check',
                op: [
                    {
                        type: 'fault', fault: 'air-leak',
                        msg: '打开「故障设置」界面，勾选「压力变送器气路漏气」，点击「应用设置」',
                        async act() { await _sleep(400); },
                    },
                ],
                check() { return this.sys.FAULT_CONFIG['air-leak'].check(); },
            },
            {
                msg: '第 4 步：合上电源和截止阀，电流应显示正常（未加压时约 4mA）。',
                mode: 'check',
                op: [
                    {
                        type: 'switch', target: 'dcpower', part: 'power',
                        msg: '按下电源键，接通 DC 24V',
                        async act() { _setPower(this.sys, true); await _sleep(1000); },
                    },
                    {
                        type: 'switch', target: 'stopv',
                        msg: '合上截止阀送气',
                        async act() { _setValve(this.sys, true); await _sleep(1000); },
                    },
                    {
                        type: 'observe', target: 'ampmeter',
                        msg: '观察电流表：未加压时电流约 4mA',
                        async act() { await _waitStable(this.sys, () => this.sys.comps['ampmeter'].value, 0.15, 8000); },
                    },
                ],
                check() {
                    const sys = this.sys;
                    return !!(sys.comps['dcpower'].isOn && sys.comps['stopv'].isOpen)
                        && Math.abs(sys.comps['ampmeter'].value - 4) < 0.4;
                },
            },
            {
                msg: '第 5 步：把输入气压调到 0.5 倍量程，观察压力表与变送器读数出现差异（漏气征兆）。',
                mode: 'check',
                op: [
                    {
                        type: 'knob', target: 'preg',
                        msg: '右键调节阀 →「参数设置」，把「设定压力」改为 0.5 倍量程',
                        async act() {
                            const sys = this.sys;
                            const target = +(0.5 * sys.comps['ptrans'].max).toFixed(3);
                            await _demoSetConfig(this, 'preg', 'setPressure', target, `把「设定压力」改为 ${target} MPa`);
                        },
                    },
                    {
                        type: 'observe', target: 'pmeter',
                        msg: '观察压力表与变送器读数：漏气处压力损失会导致两者读数偏差',
                        async act() { await _sleep(2000); },
                    },
                ],
                check() {
                    const sys = this.sys;
                    const pt = sys.comps['ptrans'];
                    return Math.abs(sys.comps['preg'].setPressure - 0.5 * pt.max) < 0.05;
                },
            },
            {
                msg: '第 6 步：用检漏瓶（肥皂水）移向各接口，冒泡处即为漏点。',
                mode: 'check',
                op: [
                    {
                        type: 'observe', target: 'leak',
                        msg: '把检漏瓶瓶口依次靠近变送器接口和压力表接口，观察何处冒泡',
                        async act() { await _demoLeakDetector(this.sys); },
                    },
                ],
                check() {
                    const leak = this.sys.comps['leak'];
                    return !!(leak && leak.isEmitting === true);
                },
            },
            {
                msg: '第 7 步：关闭电源和气源，准备修复漏点。',
                mode: 'check',
                op: [
                    {
                        type: 'switch', target: 'dcpower', part: 'power',
                        msg: '按下电源键，断开 DC 24V',
                        async act() { _setPower(this.sys, false); await _sleep(1000); },
                    },
                    {
                        type: 'switch', target: 'stopv',
                        msg: '转动手柄关闭截止阀',
                        async act() { _setValve(this.sys, false); await _sleep(1000); },
                    },
                ],
                check() {
                    const sys = this.sys;
                    return !sys.comps['dcpower'].isOn && !sys.comps['stopv'].isOpen;
                },
            },
            {
                msg: '第 8 步：在故障界面取消勾选并修复漏气故障。',
                mode: 'check',
                op: [
                    {
                        type: 'fault', fault: 'air-leak', repair: true,
                        msg: '打开「故障设置」界面，取消勾选「压力变送器气路漏气」，点击「应用设置」修复',
                        async act() { await _sleep(400); },
                    },
                    {
                        type: 'observe', target: 'leak',
                        msg: '观察检漏瓶：漏点修复后不再冒泡',
                        async act() {
                            const leak = this.sys.comps['leak'];
                            if (leak && typeof leak.clearAllBubbles === 'function') leak.clearAllBubbles();
                            await _sleep(1500);
                        },
                    },
                ],
                check() { return !this.sys.FAULT_CONFIG['air-leak'].check(); },
            },
            {
                msg: '第 9 步：重新合上电源和气源，确认压力表与变送器读数接近相等（漏气已排除）。',
                mode: 'check',
                op: [
                    {
                        type: 'switch', target: 'dcpower', part: 'power',
                        msg: '按下电源键，重新接通 DC 24V',
                        async act() { _setPower(this.sys, true); await _sleep(1000); },
                    },
                    {
                        type: 'switch', target: 'stopv',
                        msg: '合上截止阀送气',
                        async act() { _setValve(this.sys, true); await _sleep(1000); },
                    },
                    {
                        type: 'observe', target: 'ampmeter',
                        msg: '观察压力表与电流表：0.5 倍量程下电流应恢复约 12mA，两表读数一致',
                        async act() { await _waitStable(this.sys, () => this.sys.comps['ampmeter'].value, 0.15, 8000); },
                    },
                ],
                check() {
                    const sys = this.sys;
                    const pm = sys.comps['pmeter'];
                    const pt = sys.comps['ptrans'];
                    const am = sys.comps['ampmeter'];
                    if (!sys.comps['dcpower'].isOn || !sys.comps['stopv'].isOpen) return false;
                    if (!pm || !pt) return false;
                    return Math.abs(sys.comps['preg'].setPressure - 0.5 * pt.max) < 0.05
                        && Math.abs(pm.getValue() - pt.press) < 0.05
                        && Math.abs(am.value - 12) < 0.5;
                },
            },
            {
                msg: '第10步：气路漏气故障排查知识考核',
                mode: 'quiz',
                quizConfig: {
                    question: '压力变送器气路漏气时，正确的判断与检漏方法是：',
                    options: [
                        '压力表与变送器读数出现差异，用肥皂水（检漏瓶）涂在各接口，冒泡处即为漏点',
                        '漏气只会使电流增大，与压力表读数无关',
                        '漏气时应先拆开变送器内部检查',
                        '只要电源正常，气路漏气不会影响 4~20mA 输出',
                    ],
                    answer: 0,
                    analysis: '气路（尤其变送器接口、压力表接口）漏气后，管路压力沿程损失，压力表与变送器的取样压力不再一致，导致两表读数出现偏差、输出电流偏离理论值。检漏时关闭电源、合上气源，将肥皂水涂在各接头处，冒泡处即为漏点；修复后重新加压，两表读数应恢复一致。',
                },
            },
        ],
    },
};

// ═══════════════════════════════════════════════════════════════
// 组件配置（1920 × 1080 基准坐标）
// ═══════════════════════════════════════════════════════════════

export const componentConfigs = [
    // ── 电气回路 ──
    { Class: DCPower, id: 'dcpower', x: 30, y: 180, voltage: 24, isOn: false, visible: true },
    { Class: VariResistor, id: 'varires', x: 280, y: 250, value: 500, cvalue: 100, visible: true },
    { Class: PressTransmitter, id: 'ptrans', x: 350, y: 420, min: 0, max: 1.0, unit: 'MPa', visible: true },
    { Class: AmpMeter, id: 'ampmeter', x: 220, y: 620, visible: true },

    // ── 气路 ──
    { Class: PressMeter, id: 'pmeter', x: 680, y: 260, radius: 80, min: 0, max: 1.0, title: '压力表 MPa', visible: true },
    { Class: TeeConnector, id: 'tconn', x: 620, y: 540, direction: 'up', visible: true },
    { Class: PressRegulator, id: 'preg', x: 830, y: 500, setPressure: 0, unit: 'MPa', visible: true },
    { Class: StopValve, id: 'stopv', x: 1050, y: 520, scale: 1, isOpen: false, reverse: false, visible: true },
    { Class: AirBottle, id: 'cab', x: 1300, y: 500, initialPressure: 5, volume: 50, unit: 'MPa', consumptionRate: 0.02, visible: true },
    { Class: LeakDetector, id: 'leak', x:1120, y: 230, scale: 1, visible: true },

    // ── 7 种标准仪表（默认隐藏，按需通过「选择仪表」调出）──
    { Class: Multimeter, id: 'multimeter', x: 1180, y: 150, visible: false },
    { Class: MF47Multimeter, id: 'mf47-panel', x: 1050, y: 150, visible: false },
    { Class: Oscilloscope_tri, id: 'osc', x: 50, y: 50, visible: false },
    { Class: SignalGenerator, id: 'sg', x: 50, y: 50, visible: false },
    { Class: ProcessCalibrator, id: 'cali', x: 50, y: 50, visible: false },
    { Class: ElecMeter, id: 'elecmeter', x: 50, y: 50, visible: false },
    { Class: RealMegohmMeter, id: 'megohm', x: 50, y: 50, visible: false },
];

// ═══════════════════════════════════════════════════════════════
// 工具栏快捷操作
// ═══════════════════════════════════════════════════════════════

/** 瞬时接线（工具栏「自动接线」，非演示用） */
function _autoWire(sys) {
    if (!sys || !sys.connMgr) return;
    sys.conns.length = 0;
    _allConns().forEach(c => sys.connMgr.addConn({ from: c.from, to: c.to, type: c.type }));
    sys.redrawAll();
}

export function initSlider(_sys) {
    // 自动演示时只保留箭头指示，不闪亮整个组件
    if (_sys) _sys._noBlinkHighlight = true;
}

export function applyAllPresets() {
    const sys = _sysOf(this);
    if (!sys) return;
    _autoWire(sys);
}

export async function applyStartSystem() {
    const sys = _sysOf(this);
    if (!sys) return;
    _resetRig(sys);
    _autoWire(sys);
    _setPower(sys, true);
    _setValve(sys, true);
}

/**
 * 5 点步进：把调节阀设定压力依次切换为 0.25 / 0.5 / 0.75 / 1.0 / 0 倍量程，
 * 便于快速观察 8 / 12 / 16 / 20 / 4 mA 五个输出点。
 */
export function fiveStep() {
    const sys = _sysOf(this);
    if (!sys) return;
    const pt = sys.comps['ptrans'];
    const preg = sys.comps['preg'];
    if (!pt || !preg) return;

    const ratios = [0.25, 0.5, 0.75, 1.0, 0];
    if (sys._ptStep === undefined || sys._ptStep >= ratios.length) sys._ptStep = 0;
    const target = +(ratios[sys._ptStep] * pt.max).toFixed(3);

    if (typeof preg.onConfigUpdate === 'function') {
        preg.onConfigUpdate({ id: preg.id, unit: preg.displayUnit || 'MPa', setPressure: target });
    } else {
        preg.setPressure = target;
        preg.update && preg.update();
    }

    sys._ptStep = (sys._ptStep + 1) % ratios.length;
    sys.redrawAll();
}
