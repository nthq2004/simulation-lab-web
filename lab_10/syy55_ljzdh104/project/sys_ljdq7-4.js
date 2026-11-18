// ═══════════════════════════════════════════════════════════════
// 项目 7.4 —— PID 数字调节器的接线和参数调整
// （由旧工程 lab_02/pid 的 consys.js + lib/WorkflowManager.js 迁移到本平台，
//   组件一律使用本工程 components/ 下的新组件，不使用旧工程目录里的组件）
//
// 组成（单页工程，全部元件同屏；仪表默认隐藏，由「选择仪表」调出）：
//   pid        PID 数字调节器（PV/SV 双显示、A/M、SET、▲、▼ 面板按键；
//              左侧 4~20mA 输入 pi1/ni1，右侧 24V 电源 vcc/gnd，
//              底部双路输出 po1/no1、po2/no2）
//   temptr     温度变送器（PT100 三线制输入 l/m/r，二线制输出 p/n）
//   varires    可调电阻（模拟 PT100 热电阻，R = 100 + 0.3851·T）
//   dcpower    24V 直流电源（电源键开关，给 PID 供电）
//   ampmeter   电流表（测量回路 PV：4~20mA 输入电流）
//   ampmeter2  电流表（输出回路 MV：4~20mA 输出电流）
//   valve      电动调节阀（接受 4~20mA 控制信号，开度随输出变化）
//
// 两条流程（步骤与原工程 WorkflowManager.js 一一对应）：
//   ① 项目7.4-1（8 步）：24V 供电 → 通电 → PT100 三线制输入 → 测量回路
//      → 输出回路 → SV/PV 概念题 → 调节电阻看测量电流 → 切手动看输出电流。
//   ② 项目7.4-2（10 步）：连线并通电 → 切自动 → 平衡态 → 产生偏差（比例作用）
//      → 改比例带 P → 加积分 Ti → 积分题 → 加微分 Td → 微分题 → 比例带/比例系数题。
//
// 自动演示范式（见全局 AGENTS.md「最新范式」）：
//   · 每个 op 自带 act()：箭头指向目标 → 立即执行 → 停留观察
//   · 接线箭头指向端口（op.ports），操作箭头指向子部件（op.part）
//   · 接线 ≤8 根一律动画接线（addConnectionAnimated），逐根 await
//   · 电源键、A/M、▲、▼ 一律模拟真实按下（fire 组件自身按钮节点的 mousedown/mouseup）
//   · 电阻阻值、P、I、D 一律走「参数配置界面」（弹框 → 填值 → 箭头指向保存 → 真点保存）
//   · 等待一律条件轮询 _waitFor，不写死 sleep 猜时间
//   · 单页工程：不导出 PROJECT_PAGES，工作流不写 page op
// ═══════════════════════════════════════════════════════════════

import { Multimeter } from '../components/Multimeter.js';
import { MF47Multimeter } from '../components/MF47Multimeter.js';
import { Oscilloscope_tri } from '../components/Osc_tri.js';
import { SignalGenerator } from '../components/SignalGenerator.js';
import { ProcessCalibrator } from '../components/ProcessCalibrator.js';
import { ElecMeter } from '../components/ElecMeter.js';
import { RealMegohmMeter } from '../components/RealMegohmMeter.js';

import { PIDController } from '../components/PID.js';
import { TempTransmitter } from '../components/TempTransmitter.js';
import { VariResistor } from '../components/VariResistor.js';
import { DCPower } from '../components/DCPower.js';
import { AmpMeter } from '../components/AmpMeter.js';
import { ElecValve } from '../components/ElecValve.js';

// ═══════════════════════════════════════════════════════════════
// 一、故障（与原工程一致：本项目不设故障，界面为空）
// ═══════════════════════════════════════════════════════════════

export const FAULT_CONFIGS = {};

// ═══════════════════════════════════════════════════════════════
// 二、通用辅助（模拟真实交互 + 条件轮询，不直改内部字段）
// ═══════════════════════════════════════════════════════════════

const _sleep = (ms) => new Promise(r => setTimeout(r, ms));
const _sysOf = (ctx) => (ctx && ctx.sys) ? ctx.sys : window.sys;
const _comp = (sys, id) => (sys && sys.comps) ? sys.comps[id] : null;

/** 条件轮询等待（不写死 sleep 猜时间） */
async function _waitFor(sys, cond, timeout = 10000, interval = 120) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
        try { if (cond(sys)) return true; } catch (e) { /* ignore */ }
        await _sleep(interval);
    }
    try { return !!cond(sys); } catch (e) { return false; }
}

/** 无向判断两端口是否已接线 */
function _wired(sys, a, b) {
    return !!(sys && Array.isArray(sys.conns) && sys.conns.some(c =>
        c && ((c.from === a && c.to === b) || (c.from === b && c.to === a))));
}

/** 动画接一根线（≤8 根一律逐根动画，约 3s/根；已接则跳过） */
async function _wire(ctx, from, to, type = 'wire') {
    const sys = _sysOf(ctx);
    if (!sys || _wired(sys, from, to)) return true;
    await sys.connMgr.addConnectionAnimated({ from, to, type });
    await _sleep(200);
    return true;
}

/** 一根导线的接线 op：箭头指向两端端口，动作为动画接线 */
function _opWire(from, to, msg) {
    return {
        type: 'observe', ports: [from, to], msg,
        async act() { await _wire(this, from, to, 'wire'); },
    };
}

/**
 * 通过参数配置界面动态演示参数修改（电阻阻值、P、I、D 统一走这里）：
 *   ① 弹框前把组件实时属性同步进 config 副本（否则「保存」会把旧值一并回写）
 *   ② comp.showConfigDialog() 弹出参数设置界面
 *   ③ 取 #diag_<key> 输入框 → 闪烁箭头高亮 + 填入新值
 *   ④ 取「保存」按钮 → 闪烁箭头指向 + 真正 click() 按下
 *   ⑤ 确认对话框已关闭（未关闭则点「取消」）
 *   ⑥ 生效兜底：保存后仍未生效则调 onConfigUpdate（带 console.warn）
 * @param {object} wf    Workflow 实例（取自 op.act 的 this）
 * @param {string} compId 组件 id
 * @param {string} key   配置字段 key（即输入框 id 去掉 diag_ 前缀）
 * @param {*} value      目标值
 * @param {string} tip   指向输入框时的提示
 * @param {object} [opts] { read: (comp)=>当前值 } 用于校验是否真正生效
 */
async function _demoSetCfg(wf, compId, key, value, tip, opts = {}) {
    const sys = _sysOf(wf);
    const comp = _comp(sys, compId);
    if (!comp || typeof comp.showConfigDialog !== 'function') return false;

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

    const stillInput = document.getElementById('diag_' + key);
    if (stillInput && stillInput.offsetParent !== null) {
        const closeBtn = [...document.querySelectorAll('button')].find(b => /^(关闭|取消)$/.test(b.textContent.trim()));
        if (closeBtn) {
            if (wf && typeof wf._flashDomElement === 'function') await wf._flashDomElement(closeBtn, '关闭参数对话框', 1500);
            closeBtn.click();
            await _sleep(400);
        }
    }

    // 生效兜底：保存未生效时走公开接口，保证演示不中断
    const read = opts.read || ((c) => c[key]);
    let now = NaN;
    try { now = parseFloat(read(comp)); } catch (e) { now = NaN; }
    if (!(Math.abs(now - parseFloat(value)) <= 1e-4)) {
        if (typeof comp.onConfigUpdate === 'function') {
            comp.onConfigUpdate(Object.assign({}, comp.config, { id: comp.id, [key]: value }));
            console.warn('[演示] 参数界面保存未生效，已用公开接口兜底：', compId, key, value);
        }
    }
    if (sys && sys.redrawAll) sys.redrawAll();
    return true;
}

/** 把「可调电阻」阻值调到 target Ω（模拟 PT100 热电阻，走参数配置界面） */
async function _setPt100(wf, target, tip) {
    await _demoSetCfg(wf, 'varires', 'currentResistance', target,
        tip || `把「可调电阻」阻值改为 ${target}Ω`);
    await _sleep(300);
}

/** 设置 PID 参数（P / I / D / SV，走参数配置界面） */
async function _setPidParam(wf, key, value, prop, label) {
    await _demoSetCfg(wf, 'pid', key, value,
        `把「${label}」改为 ${value}`, { read: (c) => c[prop] });
    await _sleep(300);
}

/** 按电源键（模拟真实按下：触发组件电源键自身的 mousedown 处理） */
async function _setPower(sys, on) {
    const p = _comp(sys, 'dcpower');
    if (!p) return false;
    if (!!p.isOn === !!on) return true;
    const node = p.powerBtnGroup || (p.getClickablePartNode && p.getClickablePartNode('power'));
    if (node && typeof node.fire === 'function') node.fire('mousedown', { evt: {} });
    await _sleep(400);
    if (!!p.isOn !== !!on) { p.isOn = !!on; p.update && p.update(); console.warn('[演示] 电源键未响应，已兜底置位'); }
    if (sys && sys.redrawAll) sys.redrawAll();
    return !!p.isOn === !!on;
}

/**
 * 模拟按下 PID 面板按键（A/M、SET、▲、▼）：
 * 组件把按键处理绑在面板按键组上，这里 fire 与真实鼠标一致的 mousedown/mouseup，
 * 让组件自身的菜单/切换逻辑执行（不直接给 mode/OUT 赋值）。
 */
async function _pidKey(sys, label, holdMs = 80, gapMs = 90) {
    const pid = _comp(sys, 'pid');
    const g = pid && pid.btnObjs && pid.btnObjs[label];
    if (!g || typeof g.fire !== 'function') return false;
    g.fire('mousedown', { evt: {} });
    await _sleep(holdMs);
    g.fire('mouseup', { evt: {} });
    await _sleep(gapMs);
    return true;
}

/** 按 A/M 键把 PID 切到指定模式（反复点击直到达成，不直接赋 mode） */
async function _pidSetMode(sys, mode) {
    const pid = _comp(sys, 'pid');
    if (!pid) return false;
    for (let i = 0; i < 4 && pid.mode !== mode; i++) {
        await _pidKey(sys, 'A/M', 90, 300);
    }
    if (pid.mode !== mode) { pid.mode = mode; console.warn('[演示] A/M 键未切换到位，已兜底置位'); }
    if (sys && sys.redrawAll) sys.redrawAll();
    return pid.mode === mode;
}

/** 手动模式下用 ▲/▼ 把输出 OUT 调到 target（每按一次 ±1%，模拟真实按键） */
async function _pidOutTo(ctx, target) {
    const sys = _sysOf(ctx);
    const pid = _comp(sys, 'pid');
    if (!pid) return false;
    if (pid.mode !== 'MAN') return false;          // 自动模式下 ▲/▼ 改的是 SV，不是 OUT
    let guard = 0;
    while (Math.abs((pid.OUT || 0) - target) > 0.6 && guard++ < 120) {
        const up = (pid.OUT || 0) < target;
        await _pidKey(sys, up ? '▲' : '▼', 60, 60);
    }
    if (sys && sys.redrawAll) sys.redrawAll();
    return Math.abs((pid.OUT || 0) - target) <= 0.6;
}

/** 等某只电流表读数稳定到 target（mA） */
async function _waitAmp(ctx, compId, target, tol = 0.06, timeout = 12000) {
    const sys = _sysOf(ctx);
    await _waitFor(sys, s => {
        const a = _comp(s, compId);
        return !!a && Math.abs((a.value || 0) - target) <= tol;
    }, timeout, 100);
    await _sleep(300);
}

/** 等变送器 LCD 显示温度稳定到 target（℃） */
async function _waitTemp(ctx, target, tol = 0.6, timeout = 12000) {
    const sys = _sysOf(ctx);
    await _waitFor(sys, s => {
        const t = _comp(s, 'temptr');
        return !!t && Math.abs((t.temp || 0) - target) <= tol;
    }, timeout, 100);
    await _sleep(300);
}

/** 等 PID 测量值 PV / 输出 OUT 稳定到 target */
async function _waitPid(ctx, prop, target, tol = 0.2, timeout = 12000) {
    const sys = _sysOf(ctx);
    await _waitFor(sys, s => {
        const p = _comp(s, 'pid');
        return !!p && Math.abs((p[prop] || 0) - target) <= tol;
    }, timeout, 100);
    await _sleep(300);
}

/** 等电动阀开度稳定到 target（%） */
async function _waitValve(ctx, target, tol = 3, timeout = 12000) {
    const sys = _sysOf(ctx);
    await _waitFor(sys, s => {
        const v = _comp(s, 'valve');
        return !!v && typeof v.getOpeningPercent === 'function'
            && Math.abs(v.getOpeningPercent() - target) <= tol;
    }, timeout, 100);
    await _sleep(200);
}

/**
 * 台架复位（内部初始化，不作为教学动作）：
 * 清空接线、断电、PT100 回 0℃、PID 参数回出厂值、阀门回零。
 * pidMode 指定 PID 的初始运行模式（流程①用 AUTO，流程②用 MAN），
 * 保证后续「A/M 切换」这一步在画面上确实有可见的模式变化。
 */
function _resetRig(sys, opts = {}) {
    if (!sys) return;
    if (Array.isArray(sys.conns)) sys.conns.length = 0;

    const p = _comp(sys, 'dcpower');
    if (p && p.isOn) { p.isOn = false; p.update && p.update(); }

    const vr = _comp(sys, 'varires');
    if (vr) {
        vr.currentResistance = 100;      // PT100 0℃
        vr.update && vr.update();
    }

    const pid = _comp(sys, 'pid');
    if (pid) {
        pid.mode = opts.pidMode || 'MAN';
        pid.P = 4; pid.I = 0; pid.D = 0;
        pid.SV = 60; pid.LRV = 0; pid.URV = 100;
        pid.OUT = 50;
        pid.integral = 0; pid.lastError = 0;
        pid.direction = 'DIR';
        pid.APP = 'NORMAL';
        pid.outSelection = 'CH1';
        pid.outModes = { CH1: '4-20mA', CH2: '4-20mA' };
        pid.alarm = { HH: 95, H: 90, L: 30, LL: 10 };
        if (pid.syncAppToConfig) pid.syncAppToConfig();
        pid.update && pid.update(4);
    }

    const v = _comp(sys, 'valve');
    if (v) {
        if (typeof v.setControlMode === 'function') v.setControlMode('REMOTE');
        v.currentPos = 0; v.remotePos = 0;
        v.update && v.update();
    }

    if (sys.redrawAll) sys.redrawAll();
}

// ═══════════════════════════════════════════════════════════════
// 三、接线表（拓扑与原工程完全一致，端口名随本平台组件调整）
// ═══════════════════════════════════════════════════════════════

// 1. PID 工作电源回路：24V(p) → vcc，24V(n) → gnd
// 2. PT100 三线制输入：可变电阻 l/r → 变送器 l、m、r（m、r 在变送器端短接）
// 3. 测量反馈回路：PID 配电 pi1 → 电流表 → 变送器 p，变送器 n → PID ni1
// 4. 控制输出回路：PID 输出 po1 → 电流表2 → 电动阀 l，电动阀 r → PID no1
const WIRE_CONNS = [
    // ── 1. 工作电源 ──
    { from: 'dcpower_wire_p', to: 'pid_wire_vcc', type: 'wire' },
    { from: 'dcpower_wire_n', to: 'pid_wire_gnd', type: 'wire' },

    // ── 2. PT100 三线制输入 ──
    { from: 'varires_wire_l', to: 'temptr_wire_l', type: 'wire' },
    { from: 'varires_wire_r', to: 'temptr_wire_m', type: 'wire' },
    { from: 'varires_wire_r', to: 'temptr_wire_r', type: 'wire' },

    // ── 3. 测量反馈回路（PV 4~20mA）──
    { from: 'pid_wire_pi1', to: 'ampmeter_wire_p', type: 'wire' },
    { from: 'ampmeter_wire_n', to: 'temptr_wire_p', type: 'wire' },
    { from: 'temptr_wire_n', to: 'pid_wire_ni1', type: 'wire' },

    // ── 4. 控制输出回路（MV 4~20mA）──
    { from: 'pid_wire_po1', to: 'ampmeter2_wire_p', type: 'wire' },
    { from: 'ampmeter2_wire_n', to: 'valve_wire_l', type: 'wire' },
    { from: 'valve_wire_r', to: 'pid_wire_no1', type: 'wire' },
];

/** 全部连线是否已接好 */
function _allWired(sys) {
    return WIRE_CONNS.every(c => _wired(sys, c.from, c.to));
}

// ═══════════════════════════════════════════════════════════════
// 四、工作流（步骤顺序与原工程完全一致：项目7.4-1 共 8 步、项目7.4-2 共 10 步）
// ═══════════════════════════════════════════════════════════════

export const PROJECT_WORKFLOWS = {
    'pid-wiring': {
        id: 'pid-wiring',
        name: '1. PID调节器接线及功能(项目7.4)',
        steps: [
            // ── 第 1 步：24V 供电回路 ──
            {
                msg: '第 1 步：建立控制系统供电回路（24V → PID）。',
                mode: 'check',
                op: [
                    {
                        type: 'observe', ports: ['dcpower_wire_p', 'pid_wire_vcc'],
                        msg: '接电①：24V 电源 p(+) → PID 电源 vcc',
                        async act() {
                            _resetRig(_sysOf(this), { pidMode: 'AUTO' });   // 内部复位
                            await _sleep(400);
                            await _wire(this, 'dcpower_wire_p', 'pid_wire_vcc', 'wire');
                        },
                    },
                    _opWire('dcpower_wire_n', 'pid_wire_gnd', '接电②：24V 电源 n(−) → PID 电源 gnd'),
                ],
                check() {
                    const sys = _sysOf(this);
                    return _wired(sys, 'dcpower_wire_p', 'pid_wire_vcc')
                        && _wired(sys, 'dcpower_wire_n', 'pid_wire_gnd');
                },
            },

            // ── 第 2 步：接通 24V 电源 ──
            {
                msg: '第 2 步：接通 24V 电源，观察后续接线过程中的变化。',
                mode: 'check',
                op: [
                    {
                        type: 'switch', target: 'dcpower', part: 'power',
                        msg: '按电源键，接通 24V',
                        async act() { await _setPower(_sysOf(this), true); },
                    },
                    {
                        type: 'observe', target: 'dcpower', part: 'lcd',
                        msg: '电源输出 24.0V',
                        async act() {
                            await _waitFor(_sysOf(this), s => {
                                const p = _comp(s, 'dcpower');
                                return !!p && p.isOn && (p.voltage || 0) > 20;
                            }, 8000, 120);
                            await _sleep(600);
                        },
                    },
                    {
                        type: 'observe', target: 'pid', part: 'display',
                        msg: 'PID 得电，PV/SV 显示点亮',
                        async act() {
                            await _waitFor(_sysOf(this), s => {
                                const p = _comp(s, 'pid');
                                return !!p && p.powerOn === true;
                            }, 8000, 120);
                            await _sleep(600);
                        },
                    },
                ],
                check() {
                    const p = _comp(_sysOf(this), 'dcpower');
                    return !!(p && p.isOn);
                },
            },

            // ── 第 3 步：PT100 三线制输入 ──
            {
                msg: '第 3 步：连接 PT100 传感器模拟输入（三线制）。',
                mode: 'check',
                op: [
                    _opWire('varires_wire_l', 'temptr_wire_l', '接传感器①：可调电阻 l → 变送器 l'),
                    _opWire('varires_wire_r', 'temptr_wire_m', '接传感器②：可调电阻 r → 变送器 m'),
                    _opWire('varires_wire_r', 'temptr_wire_r', '接传感器③：可调电阻 r → 变送器 r（三线补偿）'),
                    {
                        type: 'observe', target: 'temptr', part: 'lcd',
                        msg: '三线接好，变送器须 p/n 通电后才显示温度',
                        async act() { await _sleep(1500); },
                    },
                ],
                check() {
                    const sys = _sysOf(this);
                    return _wired(sys, 'varires_wire_l', 'temptr_wire_l')
                        && _wired(sys, 'varires_wire_r', 'temptr_wire_m')
                        && _wired(sys, 'varires_wire_r', 'temptr_wire_r');
                },
            },

            // ── 第 4 步：测量反馈回路 ──
            {
                msg: '第 4 步：连接测量回路（PID 配电 → 电流表 → 变送器 → PID 输入）。',
                mode: 'check',
                op: [
                    _opWire('pid_wire_pi1', 'ampmeter_wire_p', '接测量①：PID 配电 pi1 → 电流表 p(+)'),
                    _opWire('ampmeter_wire_n', 'temptr_wire_p', '接测量②：电流表 n(−) → 变送器 p(+)'),
                    _opWire('temptr_wire_n', 'pid_wire_ni1', '接测量③：变送器 n(−) → PID 输入 ni1'),
                    {
                        type: 'observe', target: 'ampmeter', part: 'lcd',
                        msg: '测量回路 4.00mA（0℃ 对应 0%）',
                        async act() { await _waitAmp(this, 'ampmeter', 4, 0.15); },
                    },
                ],
                check() {
                    const sys = _sysOf(this);
                    const a = _comp(sys, 'ampmeter');
                    return _wired(sys, 'pid_wire_pi1', 'ampmeter_wire_p')
                        && _wired(sys, 'ampmeter_wire_n', 'temptr_wire_p')
                        && _wired(sys, 'temptr_wire_n', 'pid_wire_ni1')
                        && !!(a && a.value > 0.4);
                },
            },

            // ── 第 5 步：控制输出回路 ──
            {
                msg: '第 5 步：连接输出回路（PID 输出 → 电流表2 → 电动阀 → 回路闭合）。',
                mode: 'check',
                op: [
                    _opWire('pid_wire_po1', 'ampmeter2_wire_p', '接输出①：PID 输出 po1 → 电流表2 p(+)'),
                    _opWire('ampmeter2_wire_n', 'valve_wire_l', '接输出②：电流表2 n(−) → 电动阀 l'),
                    _opWire('valve_wire_r', 'pid_wire_no1', '接输出③：电动阀 r → PID 输出 no1'),
                    {
                        type: 'observe', target: 'ampmeter2', part: 'lcd',
                        msg: '输出电流升至 20.00mA（测量偏低，PID 输出到上限）',
                        async act() { await _waitAmp(this, 'ampmeter2', 20, 0.4); },
                    },
                    {
                        type: 'observe', target: 'valve', part: 'wheel',
                        msg: '电动阀开度跟着输出到 100%',
                        async act() { await _waitValve(this, 100, 4); },
                    },
                ],
                check() {
                    const sys = _sysOf(this);
                    const a2 = _comp(sys, 'ampmeter2');
                    return _wired(sys, 'pid_wire_po1', 'ampmeter2_wire_p')
                        && _wired(sys, 'ampmeter2_wire_n', 'valve_wire_l')
                        && _wired(sys, 'valve_wire_r', 'pid_wire_no1')
                        && !!(a2 && a2.value > 15);
                },
            },

            // ── 第 6 步：概念题 ──
            {
                msg: '第 6 步：PID 调节器的 SV 和 PV 分别代表什么含义？',
                mode: 'quiz',
                quizConfig: {
                    question: '在当前 PID 温度控制系统中，SV 和 PV 分别代表什么含义？',
                    options: [
                        'SV 是测量值(电流)，PV 是设定值(温度)',
                        'SV 是设定值(目标温度)，PV 是过程测量值(反馈温度)',
                        'SV 是阀门开度，PV 是电源电压',
                        'SV 是输出电流，PV 是电阻阻值',
                    ],
                    answer: 1,
                    analysis: 'SV (Setpoint Value) 是希望系统达到的目标值；PV (Process Value) 是传感器实时采集的测量值。两者之差就是偏差，PID 按偏差运算输出。',
                },
            },

            // ── 第 7 步：调节电阻，观察测量值变化 ──
            {
                msg: '第 7 步：电阻调到 119.25Ω（50℃），观察测量电流变化。',
                mode: 'check',
                op: [
                    {
                        type: 'knob', target: 'varires', part: 'slider',
                        msg: '右键可调电阻 →「参数设置」，阻值改为 119.25Ω',
                        async act() { await _setPt100(this, 119.25); },
                    },
                    {
                        type: 'observe', target: 'temptr', part: 'lcd',
                        msg: '变送器显示 50.0℃',
                        async act() { await _waitTemp(this, 50, 0.8); },
                    },
                    {
                        type: 'observe', target: 'ampmeter', part: 'lcd',
                        msg: '测量电流 12.00mA（50℃ = 50%）',
                        async act() { await _waitAmp(this, 'ampmeter', 12, 0.15); },
                    },
                    {
                        type: 'observe', target: 'pid', part: 'display',
                        msg: 'PID 的 PV 跟随测量值，显示 50.0',
                        async act() { await _waitPid(this, 'PV', 50, 0.4); },
                    },
                ],
                check() {
                    const sys = _sysOf(this);
                    const vr = _comp(sys, 'varires');
                    const a = _comp(sys, 'ampmeter');
                    return !!(vr && Math.abs(vr.currentResistance - 119.25) < 0.5
                        && a && Math.abs(a.value - 12) < 0.3);
                },
            },

            // ── 第 8 步：切手动，设输出 60%，观察输出电流 ──
            {
                msg: '第 8 步：切手动，输出设为 60%，观察输出电流。',
                mode: 'check',
                op: [
                    {
                        type: 'btn', target: 'pid', part: 'am',
                        msg: '按 A/M 键，切到手动 MAN',
                        async act() { await _pidSetMode(_sysOf(this), 'MAN'); },
                    },
                    {
                        type: 'btn', target: 'pid',
                        part: function () {                        // 箭头指向实际要按的那个键
                            const p = _comp(_sysOf(this), 'pid');
                            return (p && p.OUT > 60) ? 'down' : 'up';
                        },
                        msg: '按 ▲/▼ 把输出 OUT 调到 60%',
                        async act() { await _pidOutTo(this, 60); },
                    },
                    {
                        type: 'observe', target: 'pid', part: 'display',
                        msg: 'OUT 显示 60.0%',
                        async act() { await _waitPid(this, 'OUT', 60, 1.0); },
                    },
                    {
                        type: 'observe', target: 'ampmeter2', part: 'lcd',
                        msg: '输出电流 13.60mA（4 + 16×60%）',
                        async act() { await _waitAmp(this, 'ampmeter2', 13.6, 0.3); },
                    },
                ],
                check() {
                    const sys = _sysOf(this);
                    const p = _comp(sys, 'pid');
                    const a2 = _comp(sys, 'ampmeter2');
                    return !!(p && p.mode === 'MAN'
                        && Math.abs(p.OUT - 60) < 1
                        && a2 && Math.abs(a2.value - 13.6) < 0.3);
                },
            },
        ],
    },

    'pid-param': {
        id: 'pid-param',
        name: '2. PID调节器的参数调节(项目7.4)',
        steps: [
            // ── 第 1 步：连线检查 + 通电 ──
            {
                msg: '第 1 步：连线检查，24V 电源合上。',
                mode: 'check',
                op: [
                    {
                        type: 'wire', button: 'btnAutoWire',
                        msg: '点「自动接线」，一次接好全部 11 根线',
                        async act() {
                            const sys = _sysOf(this);
                            _resetRig(sys, { pidMode: 'MAN' });
                            await _sleep(300);
                            applyAllPresets.call(this);
                            await _sleep(600);
                        },
                    },
                    {
                        type: 'observe', ports: ['pid_wire_pi1', 'ampmeter_wire_p'],
                        msg: '测量回路：PID 配电 → 电流表 → 变送器 → PID 输入',
                        async act() { await _sleep(1500); },
                    },
                    {
                        type: 'observe', ports: ['pid_wire_po1', 'ampmeter2_wire_p'],
                        msg: '输出回路：PID 输出 → 电流表2 → 电动阀 → 回到 PID',
                        async act() { await _sleep(1500); },
                    },
                    {
                        type: 'switch', target: 'dcpower', part: 'power',
                        msg: '按电源键，接通 24V',
                        async act() { await _setPower(_sysOf(this), true); },
                    },
                    {
                        type: 'observe', target: 'ampmeter', part: 'lcd',
                        msg: '测量回路 4.00mA（0℃），仪表全部进入工作状态',
                        async act() { await _waitAmp(this, 'ampmeter', 4, 0.15); },
                    },
                ],
                check() {
                    const sys = _sysOf(this);
                    const p = _comp(sys, 'dcpower');
                    return _allWired(sys) && !!(p && p.isOn);
                },
            },

            // ── 第 2 步：切自动 ──
            {
                msg: '第 2 步：PID 设为自动（AUTO），进入闭环控制。',
                mode: 'check',
                op: [
                    {
                        type: 'btn', target: 'pid', part: 'am',
                        msg: '按 A/M 键，切到自动 AUTO',
                        async act() { await _pidSetMode(_sysOf(this), 'AUTO'); },
                    },
                    {
                        type: 'observe', target: 'pid', part: 'display',
                        msg: 'AUTO 灯亮，PV 低于 SV，输出自动升到上限',
                        async act() {
                            await _waitPid(this, 'OUT', 100, 0.6);
                            await _waitAmp(this, 'ampmeter2', 20, 0.4);
                        },
                    },
                ],
                check() {
                    const p = _comp(_sysOf(this), 'pid');
                    return !!(p && p.mode === 'AUTO');
                },
            },

            // ── 第 3 步：平衡状态（PV = SV）──
            {
                msg: '第 3 步：电阻调到 123.11Ω（60℃），PV = SV，输出回到 50%。',
                mode: 'check',
                op: [
                    {
                        type: 'knob', target: 'varires', part: 'slider',
                        msg: '右键可调电阻 →「参数设置」，阻值改为 123.11Ω',
                        async act() { await _setPt100(this, 123.11); },
                    },
                    {
                        type: 'observe', target: 'ampmeter', part: 'lcd',
                        msg: '测量回路 13.60mA（60℃ = 60%）',
                        async act() { await _waitAmp(this, 'ampmeter', 13.6, 0.15); },
                    },
                    {
                        type: 'observe', target: 'pid', part: 'display',
                        msg: 'PV = SV = 60.0，偏差为零',
                        async act() { await _waitPid(this, 'PV', 60, 0.4); },
                    },
                    {
                        type: 'observe', target: 'ampmeter2', part: 'lcd',
                        msg: '输出回到中间值：OUT = 50%，12.00mA',
                        async act() {
                            await _waitPid(this, 'OUT', 50, 0.8);
                            await _waitAmp(this, 'ampmeter2', 12, 0.2);
                        },
                    },
                ],
                check() {
                    const sys = _sysOf(this);
                    const vr = _comp(sys, 'varires');
                    const a2 = _comp(sys, 'ampmeter2');
                    return !!(vr && Math.abs(vr.currentResistance - 123.11) < 0.4
                        && a2 && Math.abs(a2.value - 12) < 0.2);
                },
            },

            // ── 第 4 步：产生负偏差，观察比例作用 ──
            {
                msg: '第 4 步：电阻降到 119.25Ω（50℃），偏差 10℃，输出跃变。',
                mode: 'check',
                op: [
                    {
                        type: 'knob', target: 'varires', part: 'slider',
                        msg: '右键可调电阻 →「参数设置」，阻值改为 119.25Ω',
                        async act() { await _setPt100(this, 119.25); },
                    },
                    {
                        type: 'observe', target: 'pid', part: 'display',
                        msg: 'PV 掉到 50.0，偏差 = 60 − 50 = 10℃',
                        async act() { await _waitPid(this, 'PV', 50, 0.4); },
                    },
                    {
                        type: 'observe', target: 'pid', part: 'display',
                        msg: 'P = 4，OUT = 50 + 4×10 = 90.0%',
                        async act() { await _waitPid(this, 'OUT', 90, 0.8); },
                    },
                    {
                        type: 'observe', target: 'ampmeter2', part: 'lcd',
                        msg: '输出电流 18.40mA，阀门开度跟着上升到 90%',
                        async act() {
                            await _waitAmp(this, 'ampmeter2', 18.4, 0.25);
                            await _waitValve(this, 90, 5);
                        },
                    },
                ],
                check() {
                    const sys = _sysOf(this);
                    const a2 = _comp(sys, 'ampmeter2');
                    return !!(a2 && Math.abs(a2.value - 18.4) < 0.25);
                },
            },

            // ── 第 5 步：改比例带 P ──
            {
                msg: '第 5 步：比例带 P 由 4 改为 3，输出减小到 80%。',
                mode: 'check',
                op: [
                    {
                        type: 'knob', target: 'pid', part: 'display',
                        msg: '右键 PID →「参数设置」，比例 P 改为 3',
                        async act() { await _setPidParam(this, 'p', 3, 'P', '比例 P'); },
                    },
                    {
                        type: 'observe', target: 'pid', part: 'display',
                        msg: 'P 减小，比例作用减弱：OUT = 50 + 3×10 = 80.0%',
                        async act() { await _waitPid(this, 'OUT', 80, 0.8); },
                    },
                    {
                        type: 'observe', target: 'ampmeter2', part: 'lcd',
                        msg: '输出电流回落到 16.80mA',
                        async act() { await _waitAmp(this, 'ampmeter2', 16.8, 0.25); },
                    },
                ],
                check() {
                    const sys = _sysOf(this);
                    const p = _comp(sys, 'pid');
                    const a2 = _comp(sys, 'ampmeter2');
                    return !!(p && Math.abs(p.P - 3) < 0.5
                        && a2 && Math.abs(a2.value - 16.8) < 0.3);
                },
            },

            // ── 第 6 步：加入积分作用 ──
            {
                msg: '第 6 步：积分时间 Ti 设为 20s，用积分消除静差。',
                mode: 'check',
                op: [
                    {
                        type: 'knob', target: 'pid', part: 'display',
                        msg: '右键 PID →「参数设置」，积分 I 改为 20',
                        async act() { await _setPidParam(this, 'i', 20, 'I', '积分 I'); },
                    },
                    {
                        type: 'observe', target: 'pid', part: 'display',
                        msg: '积分投入后 OUT 不再停在 80%，而是持续上升',
                        async act() {
                            await _sleep(3000);
                            await _waitFor(_sysOf(this), s => {
                                const p = _comp(s, 'pid');
                                return !!p && p.OUT > 80.5;
                            }, 10000, 120);
                        },
                    },
                ],
                check() {
                    const p = _comp(_sysOf(this), 'pid');
                    return !!(p && Math.abs(p.I - 20) < 2);
                },
            },

            // ── 第 7 步：积分概念题 ──
            {
                msg: '第 7 步：积分作用 I 的职能与积分时间 Ti 的含义。',
                mode: 'quiz',
                quizConfig: {
                    question: '在 PID 调节中，积分作用(I)的主要职能是什么？积分时间 Ti 越小意味着什么？',
                    options: [
                        '消除静差；Ti 越小积分作用越强',
                        '加快响应速度；Ti 越小积分作用越弱',
                        '防止超调；Ti 越小积分作用越强',
                        '抑制干扰；Ti 越小积分作用越弱',
                    ],
                    answer: 0,
                    analysis: '积分项对偏差随时间累加，只要还有偏差就继续修正，直到静差为零。Ti 越小，积分速度越快、作用越强，但过小会引起振荡。',
                },
            },

            // ── 第 8 步：加入微分作用 ──
            {
                msg: '第 8 步：微分时间 Td 设为 5s，增强预见性。',
                mode: 'check',
                op: [
                    {
                        type: 'knob', target: 'pid', part: 'display',
                        msg: '右键 PID →「参数设置」，微分 D 改为 5',
                        async act() { await _setPidParam(this, 'd', 5, 'D', '微分 D'); },
                    },
                    {
                        type: 'observe', target: 'pid', part: 'display',
                        msg: '偏差不变时 D 不动作，偏差突变时才超前调节',
                        async act() { await _sleep(2000); },
                    },
                ],
                check() {
                    const p = _comp(_sysOf(this), 'pid');
                    return !!(p && Math.abs(p.D - 5) < 1);
                },
            },

            // ── 第 9 步：微分概念题 ──
            {
                msg: '第 9 步：微分作用 D 的主要功能。',
                mode: 'quiz',
                quizConfig: {
                    question: '微分作用(D)在控制系统中通常起什么作用？',
                    options: [
                        '消除测量噪声的干扰',
                        '在偏差变化剧烈时产生超前调节，抑制超调',
                        '彻底消除系统进入稳态后的余差',
                        '降低系统的整体响应速度以求稳定',
                    ],
                    answer: 1,
                    analysis: '微分项按偏差的变化率动作，具有"超前控制"的特点，能改善动态特性、减小超调；但对噪声敏感，纯微分不能消除静差。',
                },
            },

            // ── 第 10 步：比例带 / 比例系数概念辨析 ──
            {
                msg: '第 10 步：比例带 PB 调小、比例系数 Kp 调大，影响有何不同？',
                mode: 'quiz',
                quizConfig: {
                    question: '在工业 PID 调节器中，如果把"比例带 (PB)"数值调小，或者把"比例系数 (Kp)"数值调大，对控制效果的影响是：',
                    options: [
                        '都会使控制作用变得更温和，响应变慢',
                        '都会使控制作用变得更灵敏、更剧烈',
                        '比例带调小使控制变剧烈，比例系数调大使控制变温和',
                        '两者互为倒数，调小比例带等同于调小比例系数',
                    ],
                    answer: 1,
                    analysis: '比例带是使输出变化 100% 所需要的偏差范围，带子越窄（数值越小）比例作用越强；Kp 与 PB 互为倒数，Kp 越大比例作用也越强。两者方向一致。',
                },
            },
        ],
    },
};

// ═══════════════════════════════════════════════════════════════
// 五、元件布局（沿用原工程 consys.js 的相对位置，单页 1920×1080）
//   左：变送器 / 可调电阻 / 测量电流表；中：PID 调节器 + 输出电流表 + 电动阀；
//   右：24V 直流电源
// ═══════════════════════════════════════════════════════════════

export const componentConfigs = [
    // ── 被检对象：温度变送器（PT100 三线制输入，二线制 4~20mA 输出，量程 0~100℃）──
    { Class: TempTransmitter, id: 'temptr', x: 220, y: 200, min: 0, max: 100, visible: true },

    // ── PT100 模拟：可调电阻（100Ω=0℃，138.51Ω=100℃）──
    { Class: VariResistor, id: 'varires', x: 260, y: 560, value: 385.1, cvalue: 100, visible: true },

    // ── 测量电流表（PV 回路 4~20mA）──
    { Class: AmpMeter, id: 'ampmeter', x: 500, y: 100, min: 0, max: 20, title: '测量电流 mA', visible: true },

    // ── PID 数字调节器（量程 0~100℃，SV=60℃，P=4，I=0，D=0）──
    { Class: PIDController, id: 'pid', x: 700, y: 120, SV: 60, LRV: 0, URV: 100, split: false, visible: true },

    // ── 输出电流表（MV 回路 4~20mA）──
    { Class: AmpMeter, id: 'ampmeter2', x: 550, y: 520, min: 0, max: 20, title: '输出电流 mA', visible: true },

    // ── 电动调节阀（4~20mA 远程给定开度）──
    { Class: ElecValve, id: 'valve', x: 500, y: 700, visible: true },

    // ── 24V 直流电源（PID 工作电源）──
    { Class: DCPower, id: 'dcpower', x: 1350, y: 220, voltage: 24, isOn: false, visible: true },

    // ── 7 种标准仪表（默认隐藏，由工具栏「选择仪表」调出）──
    { Class: Multimeter, id: 'multimeter', x: 700, y: 800, visible: false },
    { Class: ProcessCalibrator, id: 'cali', x: 1000, y: 800, visible: false },
    { Class: Oscilloscope_tri, id: 'osc', x: 1350, y: 660, visible: false },
    { Class: SignalGenerator, id: 'sg', x: 1350, y: 420, visible: false },
    { Class: MF47Multimeter, id: 'mf47-panel', x: 1600, y: 480, visible: false },
    { Class: ElecMeter, id: 'elecmeter', x: 1600, y: 700, visible: false },
    { Class: RealMegohmMeter, id: 'megohm', x: 1600, y: 860, visible: false },
];

// ═══════════════════════════════════════════════════════════════
// 六、快捷操作
// ═══════════════════════════════════════════════════════════════

export function initSlider(_sys) {
    // 自动演示时只保留箭头指示，不闪亮整个组件
    if (_sys) _sys._noBlinkHighlight = true;
}

/** 工具栏「自动接线」：一次接好供电、PT100、测量、输出四条回路（初始化时不预接线） */
export function applyAllPresets(opts) {
    if (opts && opts.init) return;
    const sys = _sysOf(this);
    if (!sys || !sys.connMgr) return;
    sys.conns.length = 0;
    WIRE_CONNS.forEach(c => {
        sys.connMgr.addConn({ from: c.from, to: c.to, type: c.type });
    });
    if (sys.redrawAll) sys.redrawAll();
}

/** 工具栏「起动系统」：复位 → 自动接线 → 通电（PID 置 AUTO、PT100 置 0℃） */
export async function applyStartSystem() {
    const sys = _sysOf(this);
    if (!sys) return;
    try {
        _resetRig(sys, { pidMode: 'AUTO' });
        await _sleep(300);
        applyAllPresets.call(this);
        await _sleep(300);
        await _setPower(sys, true);
        if (sys.redrawAll) sys.redrawAll();
        await _sleep(600);
    } catch (e) {
        console.warn('[起动系统] 执行异常：', e);
    }
}

/**
 * 工具栏「5 点步进」：快速核对输入输出的线性度
 *   · 手动（MAN）模式：PID 输出依次取 0 / 25 / 50 / 75 / 100%
 *   · 自动（AUTO）模式：PT100 电阻依次取 115.40 / 119.25 / 123.11 / 126.96 / 130.81Ω
 *     （对应 40 / 50 / 60 / 70 / 80℃，即 4 / 8 / 12 / 16 / 20mA）
 * 说明：这是工具栏快捷按钮，非教学演示动作，故直接调用组件公开配置接口。
 */
export function fiveStep() {
    const sys = _sysOf(this);
    if (!sys) return;
    const pid = _comp(sys, 'pid');
    const vr = _comp(sys, 'varires');
    if (!pid || !vr) return;

    const isManual = pid.mode === 'MAN';
    const steps = isManual
        ? [0, 25, 50, 75, 100]
        : [115.40, 119.25, 123.11, 126.96, 130.81];

    if (sys._pidStepIdx === undefined || sys._pidStepIdx >= steps.length) sys._pidStepIdx = 0;
    const target = steps[sys._pidStepIdx];

    if (isManual) {
        pid.OUT = target;
        pid.update && pid.update(pid.inputmA);
    } else if (typeof vr.onConfigUpdate === 'function') {
        vr.onConfigUpdate({ ...vr.config, id: vr.id, currentResistance: target });
    } else {
        vr.currentResistance = target;
        vr.update && vr.update();
    }

    sys._pidStepIdx = (sys._pidStepIdx + 1) % steps.length;
    if (sys.redrawAll) sys.redrawAll();
}
