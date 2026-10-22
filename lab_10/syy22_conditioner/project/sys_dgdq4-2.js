// ═══════════════════════════════════════════════════════════════
// 项目 4.2 —— 温控器（数字式温控仪表）最小系统功能测试
//
// 组成（由旧工程 lab_01/tempCon_02 迁移而来，并适配本平台）：
//   oven     烘箱系统（内含 PT100、加热器、散热风扇；顶部 6 个接线端）
//   ttrans   两线制温度变送器（PT100 → 4~20mA，LCD 显示温度/LLHH）
//   pid      数字式 PID 调节器（4~20mA 输入、双路输出 CH1/CH2、报警组态）
//   rplus    加（加热）继电器：PID CH1 → 烘箱加热器
//   rminus   减（散热）继电器：PID CH2 → 烘箱散热风扇
//   dcpower  24V 直流电源
//   ampmeter 电流表（检测 4~20mA 输入回路电流）
//   monitor  监控主机（趋势曲线 + 报警：消音/确认）
//   gnd      接地
//
// 三个流程：
//   1. 数字式温控器最小系统运行（项目 4.2）
//   2. 温控系统阶跃响应（项目 4.2）
//   3. 温控系统输入回路断线故障响应（项目 4.2）
//
// 自动演示规范（见全局 AGENTS）：
//   · 动作前先闪烁箭头指示目标；op 数组逐个「指示 → 执行 act → 间隔」
//   · 接线 ≤8 根一律动画接线（addConnectionAnimated），逐根 await
//   · 故障设置/修复一律走故障界面（type:'fault'）
//   · find 步骤识别主要元件；quiz 步骤展示答案与解析
//   · 演示期间抑制组件自身提示（由 Workflow 引擎统一处理）
//
// 说明：PID 的 4~20mA 输入由 pi1/ni1 端口的 250Ω 采样电阻实测电压换算，
//   监控主机通过 RS485 接线自动发现所连 PID 并采集其数据；相关逻辑均实现在
//   PID / 监控主机组件自身的 tick() 内（不依赖项目层胶水）。
// ═══════════════════════════════════════════════════════════════

import { Multimeter } from '../components/Multimeter.js';
import { MF47Multimeter } from '../components/MF47Multimeter.js';
import { Oscilloscope_tri } from '../components/Osc_tri.js';
import { SignalGenerator } from '../components/SignalGenerator.js';
import { ProcessCalibrator } from '../components/ProcessCalibrator.js';
import { ElecMeter } from '../components/ElecMeter.js';
import { RealMegohmMeter } from '../components/RealMegohmMeter.js';

import { OvenSystem } from '../components/OvenSystem.js';
import { TempTransmitter } from '../components/TempTransmitter.js';
import { PIDController } from '../components/PID.js';
import { Monitor } from '../components/Monitor.js';
import { VoltageRelay } from '../components/VoltageRelay.js';
import { DCPower } from '../components/DCPower.js';
import { AmpMeter } from '../components/AmpMeter.js';
import { Ground } from '../components/Gnd.js';

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

/** 等待条件成立（超时返回最后一次判定结果） */
async function _waitFor(sys, cond, timeoutMs = 15000, intervalMs = 250) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
        try { if (cond()) return true; } catch (e) { /* ignore */ }
        await _sleep(intervalMs);
    }
    try { return !!cond(); } catch (e) { return false; }
}

/**
 * 通过参数配置界面动态演示参数修改（严格遵守「参数调整一律走配置界面」）：
 *   ① 弹框前把实时属性同步进 config 副本（有 get 的字段跳过）
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

// ═══════════════════════════════════════════════════════════════
// 工位复位（内部初始化，不作为教学动作）
// ═══════════════════════════════════════════════════════════════

async function _resetRig(sys) {
    if (!sys) return;
    _clearConns(sys);

    const dc = sys.comps['dcpower'];
    if (dc) { dc.isOn = false; dc.isBreak = false; dc.update && dc.update(); }

    const tt = sys.comps['ttrans'];
    if (tt) tt.isBreak = false;

    ['rplus', 'rminus'].forEach(id => {
        const r = sys.comps[id];
        if (r && r.isEnergized) { r.isEnergized = false; try { r._deenergize && r._deenergize(); } catch (e) { } }
        if (r) r.current = 0;
    });

    const oven = sys.comps['oven'];
    if (oven) {
        oven.temp = oven.ambientT;
        oven.sensorTemp = oven.ambientT;
        oven.tempBuffer = [];
        if (oven._fan) { oven._fan.mode = 'local'; oven._fan.running = false; oven._fan.power = 0; oven._fan.targetPower = 0; }
        if (oven._heater) { oven._heater.mode = 'local'; oven._heater.running = false; oven._heater.power = 0; oven._heater.targetPower = 0; }
        if (oven._fanKnob) oven._fanKnob.rotation(-45);
        if (oven._heaterKnob) oven._heaterKnob.rotation(-45);
        oven.update && oven.update();
    }

    const pid = sys.comps['pid'];
    if (pid) {
        pid.mode = 'MAN';
        pid.APP = 'SPLIT';          // 本工程使用分程 PWM 输出（CH1 加热 / CH2 冷却）
        pid.outSelection = 'BOTH';
        pid.outModes = { CH1: 'PWM', CH2: 'PWM' };
        pid.OUT = 50;
        pid.SV = 50;
        pid.PV = 0;
        pid.integral = 0;
        pid.lastError = 0;
        pid.powerOn = false;
        pid.update && pid.update(4);
    }

    const mon = sys.comps['monitor'];
    if (mon) { mon.activeAlarms = []; mon.faultTimers = {}; mon.history = []; }

    try { sys.FAULT_CONFIG && sys.FAULT_CONFIG['transmitter-open'] && sys.FAULT_CONFIG['transmitter-open'].repair(); } catch (e) { /* ignore */ }
    sys.redrawAll();
    await _sleep(300);
}

/**
 * 演示/培训用「系统启动」：清线 → 自动接线 → 上电 → PID 自动/分程 → 烘箱遥控。
 * 分程控制（SPLIT）使 PID 输出 CH1 加热、CH2 散热，与加/减继电器逻辑一致。
 */
async function _startSystem(sys) {
    if (!sys) return;
    _clearConns(sys);
    _autoWire(sys);

    const dc = sys.comps['dcpower'];
    if (dc) { dc.isOn = true; dc.isBreak = false; dc.update && dc.update(); }

    const pid = sys.comps['pid'];
    if (pid) { pid.mode = 'AUTO'; }

    const oven = sys.comps['oven'];
    if (oven) {
        if (oven._fan && oven._fan.mode !== 'remote') oven._fanKnob.fire('click');
        if (oven._heater && oven._heater.mode !== 'remote') oven._heaterKnob.fire('click');
    }
    sys.redrawAll();
    await _sleep(500);
}

// ═══════════════════════════════════════════════════════════════
// 接线表
// ═══════════════════════════════════════════════════════════════

// ① 电源与接地（3 根）　parts: [源端口, 目标端口]（供接线步骤箭头指向端口）
const WIRE_POWER = [
    { conn: { from: 'pid_wire_vcc', to: 'dcpower_wire_p', type: 'wire' }, target: 'pid', parts: ['pid_wire_vcc', 'dcpower_wire_p'], msg: '接线①：PID 控制器 VCC(+) → 24V 电源正端' },
    { conn: { from: 'pid_wire_gnd', to: 'dcpower_wire_n', type: 'wire' }, target: 'pid', parts: ['pid_wire_gnd', 'dcpower_wire_n'], msg: '接线②：PID 控制器 GND(-) → 24V 电源负端' },
    { conn: { from: 'gnd_wire_gnd', to: 'dcpower_wire_n', type: 'wire' }, target: 'gnd', parts: ['gnd_wire_gnd', 'dcpower_wire_n'], msg: '接线③：接地端子 → 24V 电源负端（共地）' },
];

// ② 温度检测回路（烘箱 PT100 → 变送器 → PID 4~20mA 输入）（6 根）
const WIRE_SENSOR = [
    { conn: { from: 'oven_wire_l', to: 'ttrans_wire_l', type: 'wire' }, target: 'oven', parts: ['oven_wire_l', 'ttrans_wire_l'], msg: '接线④：烘箱 PT100(L) → 温度变送器 L 端' },
    { conn: { from: 'oven_wire_r', to: 'ttrans_wire_m', type: 'wire' }, target: 'oven', parts: ['oven_wire_r', 'ttrans_wire_m'], msg: '接线⑤：烘箱 PT100(R) → 温度变送器 M 端' },
    { conn: { from: 'oven_wire_r', to: 'ttrans_wire_r', type: 'wire' }, target: 'oven', parts: ['oven_wire_r', 'ttrans_wire_r'], msg: '接线⑥：温度变送器 M、R 短接（三线制）' },
    { conn: { from: 'pid_wire_pi1', to: 'ampmeter_wire_p', type: 'wire' }, target: 'pid', parts: ['pid_wire_pi1', 'ampmeter_wire_p'], msg: '接线⑦：PID 4~20mA 输入(+) → 电流表 P(+)' },
    { conn: { from: 'ampmeter_wire_n', to: 'ttrans_wire_p', type: 'wire' }, target: 'ampmeter', parts: ['ampmeter_wire_n', 'ttrans_wire_p'], msg: '接线⑧：电流表 N(-) → 温度变送器 P(+)' },
    { conn: { from: 'ttrans_wire_n', to: 'pid_wire_ni1', type: 'wire' }, target: 'ttrans', parts: ['ttrans_wire_n', 'pid_wire_ni1'], msg: '接线⑨：温度变送器 N(-) → PID 输入(-)' },
];

// ③ CH1 加热输出（PID → 加继电器 → 加热器）（4 根）
const WIRE_CH1 = [
    { conn: { from: 'pid_wire_po1', to: 'rplus_wire_l', type: 'wire' }, target: 'pid', parts: ['pid_wire_po1', 'rplus_wire_l'], msg: '接线⑩：PID CH1 输出(+) → 加继电器线圈左端' },
    { conn: { from: 'pid_wire_no1', to: 'rplus_wire_r', type: 'wire' }, target: 'pid', parts: ['pid_wire_no1', 'rplus_wire_r'], msg: '接线⑪：PID CH1 输出(-) → 加继电器线圈右端' },
    { conn: { from: 'rplus_wire_COM', to: 'oven_wire_heaterl', type: 'wire' }, target: 'rplus', parts: ['rplus_wire_COM', 'oven_wire_heaterl'], msg: '接线⑫：加继电器 COM → 烘箱加热器左端' },
    { conn: { from: 'rplus_wire_NO', to: 'oven_wire_heaterr', type: 'wire' }, target: 'rplus', parts: ['rplus_wire_NO', 'oven_wire_heaterr'], msg: '接线⑬：加继电器 NO → 烘箱加热器右端' },
];

// ④ CH2 散热输出（PID → 减继电器 → 风扇）（4 根）
const WIRE_CH2 = [
    { conn: { from: 'pid_wire_po2', to: 'rminus_wire_l', type: 'wire' }, target: 'pid', parts: ['pid_wire_po2', 'rminus_wire_l'], msg: '接线⑭：PID CH2 输出(+) → 减继电器线圈左端' },
    { conn: { from: 'pid_wire_no2', to: 'rminus_wire_r', type: 'wire' }, target: 'pid', parts: ['pid_wire_no2', 'rminus_wire_r'], msg: '接线⑮：PID CH2 输出(-) → 减继电器线圈右端' },
    { conn: { from: 'rminus_wire_COM', to: 'oven_wire_fanl', type: 'wire' }, target: 'rminus', parts: ['rminus_wire_COM', 'oven_wire_fanl'], msg: '接线⑯：减继电器 COM → 烘箱散热风扇左端' },
    { conn: { from: 'rminus_wire_NO', to: 'oven_wire_fanr', type: 'wire' }, target: 'rminus', parts: ['rminus_wire_NO', 'oven_wire_fanr'], msg: '接线⑰：减继电器 NO → 烘箱散热风扇右端' },
];

// ⑤ RS485 通信（PID → 监控主机）（2 根）
const WIRE_RS485 = [
    { conn: { from: 'pid_wire_b1', to: 'monitor_wire_b1', type: 'wire' }, target: 'pid', parts: ['pid_wire_b1', 'monitor_wire_b1'], msg: '接线⑱：PID RS485 B → 监控主机 B' },
    { conn: { from: 'pid_wire_a1', to: 'monitor_wire_a1', type: 'wire' }, target: 'pid', parts: ['pid_wire_a1', 'monitor_wire_a1'], msg: '接线⑲：PID RS485 A → 监控主机 A' },
];

const ALL_WIRE_META = [...WIRE_POWER, ...WIRE_SENSOR, ...WIRE_CH1, ...WIRE_CH2, ...WIRE_RS485];

/** 把接线元数据映射为「逐个指示端口 → 动画接线」的 op 数组 */
function _wireOps(meta) {
    return meta.map(m => ({
        type: 'observe', target: m.target, part: m.part, msg: m.msg,
        // 箭头指向所接线端口（两端），而非组件中心
        ports: [m.conn.from, m.conn.to],
        async act() { await _wireOne(this.sys, m.conn); },
    }));
}

/** 全部接线是否已存在 */
function _allWired(sys) {
    return ALL_WIRE_META.every(m => _hasConn(sys, m.conn.from, m.conn.to));
}

// ═══════════════════════════════════════════════════════════════
// 故障配置（走故障界面：check / trigger / repair）
// ═══════════════════════════════════════════════════════════════

export const FAULT_CONFIGS = {
    // ── 温度变送器输出回路断路（PID 输入回路断线）──
    'transmitter-open': {
        id: 'transmitter-open',
        name: '温度变送器回路断路',
        system: '电路',
        check() {
            const sys = window.sys;
            return !!(sys && sys.comps['ttrans'] && sys.comps['ttrans'].isBreak);
        },
        trigger() {
            const sys = window.sys;
            if (!sys) return;
            const tt = sys.comps['ttrans'];
            if (tt) { tt.isBreak = true; tt.update && tt.update(); }
            sys.redrawAll && sys.redrawAll();
        },
        repair() {
            const sys = window.sys;
            if (!sys) return;
            const tt = sys.comps['ttrans'];
            if (tt) { tt.isBreak = false; tt.update && tt.update(); }
            sys.redrawAll && sys.redrawAll();
        },
    },
};

// ═══════════════════════════════════════════════════════════════
// 工作流
// ═══════════════════════════════════════════════════════════════

export const PROJECT_WORKFLOWS = {
    // ══════════════════════════════════════════════════════════
    // 流程一：数字式温控器最小系统运行
    // ══════════════════════════════════════════════════════════
    'tc-system-run': {
        id: 'tc-system-run',
        name: '1. 数字式温控器最小系统运行',
        steps: [
            {
                msg: '第 1 步：识别温控系统主要组成——烘箱、温度变送器、PID 调节器、加/减继电器、监控主机、24V 电源与电流表。',
                mode: 'find',
                target: ['oven', 'ttrans', 'pid', 'rplus', 'rminus', 'monitor', 'dcpower', 'ampmeter'],
                // 自动演示时只逐个指出其中的关键元件，避免识别步骤过长；评估/操练仍以全部 target 判定
                demoTarget: ['oven', 'ttrans', 'pid', 'monitor'],
            },
            {
                msg: '第 2 步：连接 PID 控制器与 24V 直流电源，并做好共地。',
                mode: 'check',
                op: [
                    {
                        type: 'observe', target: 'dcpower', part: 'power',
                        msg: '准备接线：先清空画布连线，再把工位复位到初始状态',
                        async act() { await _resetRig(this.sys); },
                    },
                    ..._wireOps(WIRE_POWER),
                ],
                check() { return WIRE_POWER.every(m => _hasConn(this.sys, m.conn.from, m.conn.to)); },
            },
            {
                msg: '第 3 步：连接烘箱 PT100 传感器 → 温度变送器 → 电流表 → PID 4~20mA 输入端。',
                mode: 'check',
                op: [ ..._wireOps(WIRE_SENSOR) ],
                check() { return WIRE_SENSOR.every(m => _hasConn(this.sys, m.conn.from, m.conn.to)); },
            },
            {
                msg: '第 4 步：连接 PID 第 1 路输出 → 加继电器 → 烘箱加热器。',
                mode: 'check',
                op: [ ..._wireOps(WIRE_CH1) ],
                check() { return WIRE_CH1.every(m => _hasConn(this.sys, m.conn.from, m.conn.to)); },
            },
            {
                msg: '第 5 步：连接 PID 第 2 路输出 → 减继电器 → 烘箱散热风扇。',
                mode: 'check',
                op: [ ..._wireOps(WIRE_CH2) ],
                check() { return WIRE_CH2.every(m => _hasConn(this.sys, m.conn.from, m.conn.to)); },
            },
            {
                msg: '第 6 步：连接 PID 与监控主机的 RS485 通信端子。',
                mode: 'check',
                op: [ ..._wireOps(WIRE_RS485) ],
                check() { return WIRE_RS485.every(m => _hasConn(this.sys, m.conn.from, m.conn.to)); },
            },
            {
                msg: '第 7 步：按下电源键上电，确认 PID 处于手动(MAN)状态、输出 50% 中位。',
                mode: 'check',
                op: [
                    {
                        type: 'switch', target: 'dcpower', part: 'power',
                        msg: '按下 24V 电源键，给系统上电',
                        async act() { const dc = this.sys.comps['dcpower']; if (dc) { dc.isOn = true; dc.update && dc.update(); } await _sleep(1000); },
                    },
                    {
                        type: 'observe', target: 'pid', part: 'am',
                        msg: '确认 PID 处于手动(MAN)状态，输出 OUT = 50%（中位不输出）',
                        async act() { const p = this.sys.comps['pid']; if (p) { p.mode = 'MAN'; p.OUT = 50; } await _sleep(1000); },
                    },
                    {
                        type: 'observe', target: 'monitor', part: 'mute',
                        msg: '对监控主机进行消音、确认，清除初始报警',
                        async act() { const m = this.sys.comps['monitor']; if (m) { m.btnMuteFunc && m.btnMuteFunc(); m.btnAckFunc && m.btnAckFunc(); } await _sleep(800); },
                    },
                ],
                check() {
                    const p = this.sys.comps['pid'];
                    return !!(this.sys.comps['dcpower'].isOn && p.mode === 'MAN' && Math.abs(p.OUT - 50) < 2);
                },
            },
            {
                msg: '第 8 步：把烘箱加热器与散热风扇的控制模式由就地转为遥控。',
                mode: 'check',
                op: [
                    {
                        type: 'switch', target: 'oven', part: 'heater-knob',
                        msg: '转动加热器控制旋钮，由「就地」转为「遥控」',
                        async act() { const o = this.sys.comps['oven']; if (o && o._heater && o._heater.mode !== 'remote') o._heaterKnob.fire('click'); await _sleep(900); },
                    },
                    {
                        type: 'switch', target: 'oven', part: 'fan-knob',
                        msg: '转动散热风扇控制旋钮，由「就地」转为「遥控」',
                        async act() { const o = this.sys.comps['oven']; if (o && o._fan && o._fan.mode !== 'remote') o._fanKnob.fire('click'); await _sleep(900); },
                    },
                    {
                        type: 'observe', target: 'monitor', part: 'mute',
                        msg: '消音、确认报警，准备转入自动运行',
                        async act() { const m = this.sys.comps['monitor']; if (m) { m.btnMuteFunc && m.btnMuteFunc(); m.btnAckFunc && m.btnAckFunc(); } await _sleep(800); },
                    },
                ],
                check() {
                    const o = this.sys.comps['oven'];
                    return !!(o && o._heater.mode === 'remote' && o._fan.mode === 'remote');
                },
            },
            {
                msg: '第 9 步：将 PID 转为自动(AUTO)模式，系统开始调节，直到 PV 与 SV 偏差小于 10℃。',
                mode: 'check',
                op: [
                    {
                        type: 'knob', target: 'pid', part: 'am',
                        msg: '按 A/M 键，将 PID 由手动切换为自动(AUTO)模式',
                        async act() { const p = this.sys.comps['pid']; if (p) { p.mode = 'AUTO'; } await _sleep(1000); },
                    },
                    {
                        type: 'observe', target: 'pid',
                        msg: '观察 PID 自动调节：温度偏低时加继电器吸合、加热器工作，直至 PV 与 SV 偏差小于 10℃',
                        async act() { await _waitFor(this.sys, () => { const p = this.sys.comps['pid']; return p.mode === 'AUTO' && Math.abs(p.PV - p.SV) < 10; }, 60000, 400); await _sleep(3000); },
                    },
                    {
                        type: 'observe', target: 'monitor', part: 'mute',
                        msg: '对监控主机消音、确认，确认系统工作正常',
                        async act() { const m = this.sys.comps['monitor']; if (m) { m.btnMuteFunc && m.btnMuteFunc(); m.btnAckFunc && m.btnAckFunc(); } await _sleep(800); },
                    },
                ],
                check() {
                    const p = this.sys.comps['pid'];
                    const m = this.sys.comps['monitor'];
                    const alarmsOk = m.activeAlarms.every(a => a.muted === true && a.confirmed === true);
                    // 必须 PV 与 SV 偏差小于 10℃ 才认为本步完成
                    return !!(p.mode === 'AUTO' && Math.abs(p.PV - p.SV) < 10 && alarmsOk);
                },
            },
            {
                msg: '第 10 步：温控器最小系统知识考核',
                mode: 'quiz',
                quizConfig: {
                    question: '数字式温控器最小系统中，温度变送器与 PID 调节器之间的标准信号及其作用是：',
                    options: [
                        '温度变送器把 PT100 阻值转换成 4~20mA 标准电流信号送入 PID，PID 据此计算并输出控制信号',
                        '温度变送器输出 0~10V 电压直接驱动加热器',
                        'PID 直接测量 PT100 电阻，无需温度变送器',
                        '4~20mA 信号只用于显示，不参与控制',
                    ],
                    answer: 0,
                    analysis: 'PT100 的阻值随温度变化，温度变送器把它线性转换成 4~20mA 标准电流信号（4mA 对应量程下限、20mA 对应上限），送入 PID 调节器作为测量值 PV。PID 将 PV 与设定值 SV 比较后按控制规律输出，经继电器控制加热器或散热风扇，从而构成闭环温度控制系统。',
                },
            },
        ],
    },

    // ══════════════════════════════════════════════════════════
    // 流程二：温控系统阶跃响应
    // ══════════════════════════════════════════════════════════
    'tc-step-response': {
        id: 'tc-step-response',
        name: '2. 温控系统阶跃响应',
        steps: [
            {
                msg: '第 1 步：一键接好线路并启动系统，使 PID 处于自动模式、PV 与 SV 偏差小于 10℃。',
                mode: 'check',
                op: [
                    {
                        type: 'observe', target: 'dcpower', part: 'power',
                        msg: '自动接线并启动系统（电源 ON、PID 自动、分程控制、烘箱遥控）',
                        async act() { await _resetRig(this.sys); await _startSystem(this.sys); },
                    },
                    {
                        type: 'observe', target: 'pid',
                        msg: '等待系统温度稳定，PV 逐步趋近 SV',
                        async act() { await _waitFor(this.sys, () => { const p = this.sys.comps['pid']; return p.mode === 'AUTO' && Math.abs(p.PV - p.SV) < 10; }, 25000, 400); },
                    },
                    {
                        type: 'observe', target: 'monitor', part: 'mute',
                        msg: '消音、确认报警，确认系统运行正常',
                        async act() { const m = this.sys.comps['monitor']; if (m) { m.btnMuteFunc && m.btnMuteFunc(); m.btnAckFunc && m.btnAckFunc(); } await _sleep(800); },
                    },
                ],
                check() {
                    const p = this.sys.comps['pid'];
                    const m = this.sys.comps['monitor'];
                    return !!(p.mode === 'AUTO' && this.sys.comps['dcpower'].isOn
                        && m.activeAlarms.every(a => a.muted === true));
                },
            },
            {
                msg: '第 2 步：将设定值 SV 上调到 80℃，观察加继电器吸合、加热器工作的阶跃响应。',
                mode: 'check',
                op: [
                    {
                        type: 'knob', target: 'pid', part: 'display',
                        msg: '右键 PID →「参数设置」，把「设定值 SV」调到 80℃（温度偏低，输出增大）',
                        async act() { await _demoSetConfig(this, 'pid', 'sv', 80, '把「设定值 SV」改为 80 ℃'); },
                    },
                    {
                        type: 'observe', target: 'rplus',
                        msg: '观察加继电器（CH1）：PID 输出增大后吸合，加热器回路接通',
                        async act() { await _waitFor(this.sys, () => this.sys.comps['rplus'].isEnergized, 8000, 200); await _sleep(4000); },
                    },
                    {
                        type: 'observe', target: 'oven', part: 'lcd',
                        msg: '观察烘箱温度：加热器工作后温度逐步上升，逼近新的设定值',
                        async act() { await _sleep(6000); },
                    },
                ],
                check() {
                    const p = this.sys.comps['pid'];
                    return Math.abs(p.SV - 80) < 2 && p.OUT > 60;
                },
            },
            {
                msg: '第 3 步：将设定值 SV 下调到 50℃，观察减继电器吸合、散热风扇工作的阶跃响应。',
                mode: 'check',
                op: [
                    {
                        type: 'knob', target: 'pid', part: 'display',
                        msg: '右键 PID →「参数设置」，把「设定值 SV」调到 50℃（温度偏高，输出减小）',
                        async act() { await _demoSetConfig(this, 'pid', 'sv', 50, '把「设定值 SV」改为 50 ℃'); },
                    },
                    {
                        type: 'observe', target: 'rminus',
                        msg: '观察减继电器（CH2）：PID 输出减小后吸合，散热风扇回路接通',
                        async act() { await _waitFor(this.sys, () => this.sys.comps['rminus'].isEnergized, 12000, 200); await _sleep(4000); },
                    },
                    {
                        type: 'observe', target: 'oven', part: 'lcd',
                        msg: '观察烘箱温度：散热风扇工作后温度逐步下降，逼近新的设定值',
                        async act() { await _sleep(6000); },
                    },
                ],
                check() {
                    const p = this.sys.comps['pid'];
                    return Math.abs(p.SV - 50) < 2 && p.OUT < 40;
                },
            },
            {
                msg: '第 4 步：温控系统阶跃响应知识考核',
                mode: 'quiz',
                quizConfig: {
                    question: '在分程(Split)控制的温控系统中，PID 设定值阶跃变化时，加热与散热输出的正确规律是：',
                    options: [
                        'SV 高于 PV 时输出增大，加继电器吸合、加热器工作；SV 低于 PV 时输出减小，减继电器吸合、风扇散热',
                        '无论偏差方向，加热器和风扇同时全功率工作',
                        'SV 变化只影响显示，不影响继电器动作',
                        'SV 高于 PV 时应开启风扇降温',
                    ],
                    answer: 0,
                    analysis: 'PID 将测量值 PV 与设定值 SV 比较：偏差为正（PV<SV，温度偏低）时输出增大，经加继电器接通加热器，温度上升；偏差为负（PV>SV，温度偏高）时输出减小，经减继电器接通散热风扇，温度下降。分程控制把 50% 输出设为中位死区，高于 53% 输出加热、低于 47% 输出散热，从而实现对温度的升降双向调节。',
                },
            },
        ],
    },

    // ══════════════════════════════════════════════════════════
    // 流程三：温控系统输入回路断线故障响应
    // ══════════════════════════════════════════════════════════
    'tc-open-circuit': {
        id: 'tc-open-circuit',
        name: '3. 温控系统输入回路断线故障响应',
        steps: [
            {
                msg: '第 1 步：一键接好线路并启动系统，使系统正常运行、PV 与 SV 偏差小于 10℃。',
                mode: 'check',
                op: [
                    {
                        type: 'observe', target: 'dcpower', part: 'power',
                        msg: '自动接线并启动系统（电源 ON、PID 自动、分程控制、烘箱遥控）',
                        async act() { await _resetRig(this.sys); await _startSystem(this.sys); },
                    },
                    {
                        type: 'observe', target: 'pid',
                        msg: '等待系统温度稳定，PID 自动运行',
                        async act() { await _waitFor(this.sys, () => { const p = this.sys.comps['pid']; return p.mode === 'AUTO' && Math.abs(p.PV - p.SV) < 10; }, 25000, 400); },
                    },
                    {
                        type: 'observe', target: 'monitor', part: 'mute',
                        msg: '消音、确认报警，确认系统运行正常',
                        async act() { const m = this.sys.comps['monitor']; if (m) { m.btnMuteFunc && m.btnMuteFunc(); m.btnAckFunc && m.btnAckFunc(); } await _sleep(800); },
                    },
                ],
                check() {
                    const p = this.sys.comps['pid'];
                    return !!(p.mode === 'AUTO' && this.sys.comps['dcpower'].isOn);
                },
            },
            {
                msg: '第 2 步：通过「故障设置」界面设置「温度变送器回路断路」故障。',
                mode: 'check',
                op: [
                    {
                        type: 'fault', fault: 'transmitter-open',
                        msg: '打开「故障设置」界面，勾选「温度变送器回路断路」，点击「应用设置」',
                        async act() { await _sleep(400); },
                    },
                ],
                check() { return this.sys.FAULT_CONFIG['transmitter-open'].check(); },
            },
            {
                msg: '第 3 步：观察现象——输入回路电流为 0，PID 温度显示 LLLL。',
                mode: 'check',
                op: [
                    {
                        type: 'observe', target: 'ttrans', part: 'lcd',
                        msg: '观察温度变送器与电流表：回路断路后电流为 0，PID 显示 LLLL',
                        async act() { await _sleep(5000); },
                    },
                ],
                check() {
                    const am = this.sys.comps['ampmeter'];
                    return Math.abs(am.value) < 0.5;
                },
            },
            {
                msg: '第 4 步：查看监控主机报警，进行消音、确认。',
                mode: 'check',
                op: [
                    {
                        type: 'observe', target: 'monitor',
                        msg: '观察监控主机出现「温度变送器输入断路」报警',
                        async act() { await _sleep(4000); },
                    },
                    {
                        type: 'observe', target: 'monitor', part: 'mute',
                        msg: '点击「消音」再点击「确认」，完成报警消音、确认',
                        async act() { const m = this.sys.comps['monitor']; if (m) { m.btnMuteFunc && m.btnMuteFunc(); await _sleep(600); m.btnAckFunc && m.btnAckFunc(); } await _sleep(800); },
                    },
                ],
                check() {
                    const m = this.sys.comps['monitor'];
                    return m.activeAlarms.length > 0 && m.activeAlarms.every(a => a.muted === true);
                },
            },
            {
                msg: '第 5 步：描述现象——PID 认为温度偏低，以最大加热功率输出，烘箱温度超高。',
                mode: 'check',
                op: [
                    {
                        type: 'observe', target: 'oven', part: 'lcd',
                        msg: '观察 PID 以最大功率加热，烘箱温度持续升高并超过报警上限',
                        async act() { await _waitFor(this.sys, () => this.sys.comps['oven'].temp >= 80, 30000, 500); },
                    },
                ],
                check() { return this.sys.comps['oven'].temp >= 80; },
            },
            {
                msg: '第 6 步：在「故障设置」界面取消勾选并修复「温度变送器回路断路」故障。',
                mode: 'check',
                op: [
                    {
                        type: 'fault', fault: 'transmitter-open', repair: true,
                        msg: '打开「故障设置」界面，取消勾选「温度变送器回路断路」，点击「应用设置」修复',
                        async act() { await _sleep(400); },
                    },
                ],
                check() { return !this.sys.FAULT_CONFIG['transmitter-open'].check(); },
            },
            {
                msg: '第 7 步：故障修复后，PID 测得实际温度超高，以最大散热功率输出，系统迅速降温。',
                mode: 'check',
                op: [
                    {
                        type: 'observe', target: 'rminus',
                        msg: '观察减继电器吸合、散热风扇全速工作，烘箱温度迅速下降',
                        async act() { await _waitFor(this.sys, () => this.sys.comps['rminus'].isEnergized, 15000, 250); await _sleep(6000); },
                    },
                    {
                        type: 'observe', target: 'monitor', part: 'mute',
                        msg: '对监控主机消音、确认，确认故障已排除',
                        async act() { const m = this.sys.comps['monitor']; if (m) { m.btnMuteFunc && m.btnMuteFunc(); m.btnAckFunc && m.btnAckFunc(); } await _sleep(800); },
                    },
                ],
                check() {
                    const sys = this.sys;
                    return !sys.FAULT_CONFIG['transmitter-open'].check() && sys.comps['rminus'].isEnergized;
                },
            },
            {
                msg: '第 8 步：温控系统断线故障响应知识考核',
                mode: 'quiz',
                quizConfig: {
                    question: '温度变送器（4~20mA）回路断路后，PID 温度显示 LLLL 并最终导致系统温度超高的原因是：',
                    options: [
                        '回路电流为 0（低于 4mA 零点），PID 判定温度低于量程下限，以最大加热功率输出，导致温度失控升高',
                        '断线后 PID 自动停机保护，温度不会变化',
                        '断线会使回路电流增大到 20mA 以上，PID 反而停止加热',
                        '断线只影响监控主机显示，不影响 PID 输出',
                    ],
                    answer: 0,
                    analysis: '两线制变送器回路断路后回路电流为 0，低于 4mA 量程下限，PID 按 4~20mA 线性关系算得的测量值低于下限，显示 LLLL 并认为温度远低于设定值，于是持续以最大加热功率输出，最终使实际温度远超设定值（系统温度超高）。正确做法是及时通过监控报警发现断线并排除，恢复 4~20mA 输入后再投入自动运行。',
                },
            },
        ],
    },
};

// ═══════════════════════════════════════════════════════════════
// 组件配置（1920 × 1080 基准坐标）
// ═══════════════════════════════════════════════════════════════

export const componentConfigs = [
    // ── 温控被控对象与调节器 ──
    // PID 量程与被测温度量程一致（0~100℃），保证 PV 与变送器 LCD 显示相符；
    // split:true 启用分程 PWM 输出（本温控系统 CH1 加热 / CH2 冷却），
    // 学员按 A/M 切到自动即可驱动加/减继电器，无需再进菜单设置分程。
    { Class: PIDController, id: 'pid', x: 600, y: 20, LRV: 0, URV: 100, SV: 50, split: true, visible: true },
    { Class: OvenSystem, id: 'oven', x: 500, y: 660, title: '烘箱系统', visible: true },
    { Class: TempTransmitter, id: 'ttrans', x: 260, y: 300, min: 0, max: 100, visible: true },
    { Class: Monitor, id: 'monitor', x: 1100, y: 530, visible: true },

    // ── 执行回路 ──
    { Class: VoltageRelay, id: 'rplus', x: 600, y: 460, label: '加继电器', visible: true },
    { Class: VoltageRelay, id: 'rminus', x: 800, y: 460, label: '减继电器', visible: true },

    // ── 电源与测量 ──
    { Class: DCPower, id: 'dcpower', x: 1150, y: 130, voltage: 24, isOn: false, visible: true },
    { Class: AmpMeter, id: 'ampmeter', x: 400, y: 150, radius: 70, min: 0, max: 20, title: '电流表mA', visible: true },
    { Class: Ground, id: 'gnd', x: 1250, y: 390, visible: true },

    // ── 7 种标准仪表（默认隐藏，按需通过「选择仪表」调出）──
    { Class: Multimeter, id: 'multimeter', x: 1180, y: 450, visible: false },
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
    ALL_WIRE_META.forEach(m => sys.connMgr.addConn({ from: m.conn.from, to: m.conn.to, type: m.conn.type }));
    sys.redrawAll();
}

export function initSlider(_sys) {
    if (!_sys) return;
    // 自动演示时只保留箭头指示，不闪亮整个组件
    _sys._noBlinkHighlight = true;
}

export function applyAllPresets() {
    const sys = _sysOf(this);
    if (!sys) return;
    _autoWire(sys);
}

export async function applyStartSystem() {
    const sys = _sysOf(this);
    if (!sys) return;
    await _resetRig(sys);
    await _startSystem(sys);
}

/**
 * 5 点步进：手动模式步进 PID 输出（0/25/50/75/100%）；
 * 自动模式步进设定值（25/50/75/100/0℃）。
 */
export function fiveStep() {
    const sys = _sysOf(this);
    if (!sys) return;
    const pid = sys.comps['pid'];
    if (!pid) return;

    const steps = (pid.mode === 'MAN') ? [0, 25, 50, 75, 100] : [25, 50, 75, 100, 0];
    if (sys._tcStep === undefined || sys._tcStep >= steps.length) sys._tcStep = 0;

    if (pid.mode === 'MAN') pid.OUT = steps[sys._tcStep];
    else pid.SV = steps[sys._tcStep];

    sys._tcStep = (sys._tcStep + 1) % steps.length;
    sys.redrawAll();
}
