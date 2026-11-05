// 真空断路器功能仿真工程（断路器 + 汇流排 + 三相交流电源 + 24V 控制电源）

import { VacuumCircuitBreaker } from '../components/VacuumCircuitBreaker.js';
import { Busbar3P } from '../components/Busbar3P.js';
import { MarineHVGenerator } from '../components/MarineHVGenerator.js';
import { HvGenRemotePanel } from '../components/HvGenRemotePanel.js';
import { HvGenProtection } from '../components/HvGenProtection.js';
import { HvThreePhaseLoad } from '../components/HvThreePhaseLoad.js';
import { SimpleVCB } from '../components/SimpleVCB.js';
import { SimpleHVGenerator } from '../components/SimpleHVGenerator.js';
import { HvTransformer } from '../components/HvTransformer.js';
import { HvPowerOneLine } from '../components/HvPowerOneLine.js';
import { HvSwitchPanel } from '../components/HvSwitchPanel.js';
import { HvTester } from '../components/HvTester.js';
import { HvGroundMonitor } from '../components/HvGroundMonitor.js';
import { HvDischargeRod } from '../components/HvDischargeRod.js';
import { HvGroundingCable } from '../components/HvGroundingCable.js';
import { DiagramThreePhaseACB } from '../components/DiagramThreePhaseACB.js';
import { IncandescentLamp } from '../components/IncandescentLamp.js';
import { Resistor } from '../components/Resistor.js';
import { DCPower } from '../components/DCPower.js';
import { Ground } from '../components/Gnd.js';
import { Multimeter } from '../components/Multimeter.js';
import { MF47Multimeter } from '../components/MF47Multimeter.js';
import { Oscilloscope_tri } from '../components/Osc_tri.js';
import { SignalGenerator } from '../components/SignalGenerator.js';
import { ProcessCalibrator } from '../components/ProcessCalibrator.js';
import { ElecMeter } from '../components/ElecMeter.js';
import { RealMegohmMeter } from '../components/RealMegohmMeter.js';

function _fcomp(id) {
    const s = window.sys;
    return s && s.comps && s.comps[id] ? s.comps[id] : null;
}

export const FAULT_CONFIGS = {
    // ── 1. 发电机出口相间短路：A/B 两相在发电机【出口】处强制短接。
    //      短路电流同时流经机端 CT 与中性点侧 CT（同一路径穿过整个绕组）→
    //      入口电流 ≈ 出口电流，差流 ≈ 0，差动保护不动作 → 由相间短路（速断）保护动作跳闸 ──
    gen_internal_short_ab: {
        id: 'gen_internal_short_ab', name: '发电机出口两相短路', system: '发电机',
        check() {
            const s = window.sys;
            return !!(s && s._faultShortGroups && s._faultShortGroups.some(g => g[0] === 'gen_hv_wire_u' && g[1] === 'gen_hv_wire_v'));
        },
        trigger() {
            const s = window.sys;
            if (!s) return;
            if (!s._faultShortGroups) s._faultShortGroups = [];
            this.repair();
            const g = ['gen_hv_wire_u', 'gen_hv_wire_v'];
            s._faultShortGroups.push(g);
        },
        repair() {
            const s = window.sys;
            if (!s || !s._faultShortGroups) return;
            s._faultShortGroups = s._faultShortGroups.filter(x => !(x[0] === 'gen_hv_wire_u' && x[1] === 'gen_hv_wire_v'));
        },
    },
    // ── 1b. 发电机绕组中点相间短路：A 相绕组中点与 B 相绕组中点强制短接（内部短路）。
    //      两相中点短接形成的内部环流只流经绕组中性段（中性点侧 CT 回路），
    //      机端侧 CT（出口）几乎测不到电流 → 入口电流 >> 出口电流 → 差流大 → 差动保护动作跳闸 ──
    gen_winding_short_ab: {
        id: 'gen_winding_short_ab', name: '发电机两相绕组中点短路', system: '发电机',
        check() {
            const s = window.sys;
            return !!(s && s._faultShortGroups && s._faultShortGroups.some(g => g[0] === 'gen_hv_wire_u_mid' && g[1] === 'gen_hv_wire_v_mid'));
        },
        trigger() {
            const s = window.sys;
            if (!s) return;
            if (!s._faultShortGroups) s._faultShortGroups = [];
            this.repair();
            const g = ['gen_hv_wire_u_mid', 'gen_hv_wire_v_mid'];
            s._faultShortGroups.push(g);
        },
        repair() {
            const s = window.sys;
            if (!s || !s._faultShortGroups) return;
            s._faultShortGroups = s._faultShortGroups.filter(x => !(x[0] === 'gen_hv_wire_u_mid' && x[1] === 'gen_hv_wire_v_mid'));
        },
    },
    // ── 2. 1号变压器严重散热不良：通电时温度线性上升（约 15s 到 130℃），
//      触发高温保护 3s 延时跳开上级断路器 vcbs3；跳闸断电后自动冷却到环境温度 ──
    tf1_cooling_fault: {
        id: 'tf1_cooling_fault', name: '1# 变压器严重散热不良', system: '变压器',
        check() {
            const c = window.sys && window.sys.comps && window.sys.comps.tf1;
            return !!(c && c.isCoolingFault && c.isCoolingFault());
        },
        trigger() {
            const c = window.sys && window.sys.comps && window.sys.comps.tf1;
            if (c && c.setCoolingFault) c.setCoolingFault(true);
        },
        repair() {
            const c = window.sys && window.sys.comps && window.sys.comps.tf1;
            if (c && c.setCoolingFault) c.setCoolingFault(false);
        },
    },
    // ── 3. 电网绝缘下降：绝缘测试支路电阻由 10MΩ 降为 10Ω → 接地电流剧增 ──
    insul_degraded: {
        id: 'insul_degraded', name: '电网单相接地', system: '电网绝缘',
        check() {
            const c = window.sys && window.sys.comps && window.sys.comps.r_insul;
            return !!(c && c.currentResistance !== undefined && c.currentResistance < 1000);
        },
        trigger() {
            const c = window.sys && window.sys.comps && window.sys.comps.r_insul;
            if (c && typeof c.onConfigUpdate === 'function') c.onConfigUpdate({id: c.id, currentResistance: 10 });
        },
        repair() {
            const c = window.sys && window.sys.comps && window.sys.comps.r_insul;
            if (c && typeof c.onConfigUpdate === 'function') c.onConfigUpdate({id: c.id, currentResistance: 10000000 });
        },
    },
};

// ═══════════════════════════════════════════════════════════════
// 一、通用辅助：一律模拟真实交互 + 条件轮询（不直改内部字段、不写死 sleep 猜时间）
// ═══════════════════════════════════════════════════════════════

const _sysOf = (ctx) => (ctx && ctx.sys) ? ctx.sys : window.sys;
const _c = (sys, id) => (sys && sys.comps) ? sys.comps[id] : null;

/** 条件轮询等待 */
async function _waitFor(sys, cond, timeout = 8000, interval = 100) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
        try { if (cond(sys)) return true; } catch (e) { /* ignore */ }
        await _sleep(interval);
    }
    return false;
}

/** 触发组件交互节点的真实事件（点击组件自身的处理逻辑，不绕过交互） */
function _firePart(comp, partId, evt = 'click') {
    if (!comp || typeof comp.getClickablePartNode !== 'function') return false;
    const node = comp.getClickablePartNode(partId);
    if (!node) return false;
    try { node.fire(evt, { evt: { cancelBubble: false } }); } catch (e) { return false; }
    return true;
}

/** 点一下部件（开关/旋钮/按钮） */
async function _clickPart(comp, partId, waitMs = 400) {
    if (!_firePart(comp, partId, 'click')) return false;
    await _sleep(waitMs);
    return true;
}

/** 按住部件（自复位开关类：按下 → 保持 → 松开） */
async function _holdPart(comp, partId, holdMs = 1000, down = 'mousedown', up = 'mouseup') {
    if (!_firePart(comp, partId, down)) return false;
    await _sleep(holdMs);
    _firePart(comp, partId, up);
    await _sleep(200);
    return true;
}

/** 接线是否已建立 */
function _wired(sys, a, b) {
    return !!(sys && Array.isArray(sys.conns) && sys.conns.some(c =>
        c && c.type === 'wire' && ((c.from === a && c.to === b) || (c.from === b && c.to === a))));
}

/** 工具栏按钮（自动接线 / 起动系统） */
async function _toolbarBtn(id) {
    const btn = document.getElementById(id);
    if (btn && typeof btn.onclick === 'function') btn.onclick();
    await _sleep(1000);
}

// ── 1# 高压发电机遥控操作（全部点遥控面板上的开关，方向由左右半区热区保证）──

/** 遥控起动 1# 高压发电机 */
async function _startGen(ctx) {
    const sys = _sysOf(ctx), hp = _c(sys, 'hvgp'), g = _c(sys, 'gen_hv');
    if (!hp || !g) return false;
    if (g.isOn) return true;
    await _waitFor(sys, s => { const p = _c(s, 'hvgp'); return !!(p && p._powered); }, 8000);
    await _holdPart(hp, 'start', 1600);
    return _waitFor(sys, s => !!_c(s, 'gen_hv').isOn, 8000);
}

/** 遥控停机 */
async function _stopGen(ctx) {
    const sys = _sysOf(ctx), hp = _c(sys, 'hvgp'), g = _c(sys, 'gen_hv');
    if (!hp || !g) return false;
    if (!g.isOn) return true;
    await _holdPart(hp, 'stop', 1600);
    return _waitFor(sys, s => !_c(s, 'gen_hv').isOn, 8000);
}

/** 遥控合闸：等储能到位 → 按住「合闸」→ 等主触头闭合 */
async function _closeQf(ctx) {
    const sys = _sysOf(ctx), q = _c(sys, 'qf1'), hp = _c(sys, 'hvgp');
    if (!q || !hp) return false;
    for (let i = 0; i < 4 && !q.isClosed(); i++) {
        await _waitFor(sys, s => !!_c(s, 'qf1').isCharged(), 12000, 150);
        await _holdPart(hp, 'close', 1300);
        await _waitFor(sys, s => !!_c(s, 'qf1').isClosed(), 4000, 100);
    }
    return q.isClosed();
}

/** 遥控分闸 */
async function _openQf(ctx) {
    const sys = _sysOf(ctx), q = _c(sys, 'qf1'), hp = _c(sys, 'hvgp');
    if (!q || !hp) return false;
    for (let i = 0; i < 3 && q.isClosed(); i++) {
        await _holdPart(hp, 'open', 1300);
        await _waitFor(sys, s => !_c(s, 'qf1').isClosed(), 4000, 100);
    }
    return !q.isClosed();
}

/** 按遥控面板「复位」，解除保护跳闸闭锁 */
async function _resetProt(ctx) {
    const sys = _sysOf(ctx), hp = _c(sys, 'hvgp'), p = _c(sys, 'prot1');
    if (!hp) return false;
    await _clickPart(hp, 'reset', 800);
    if (p) await _waitFor(sys, s => !_c(s, 'prot1')._tripped, 6000);
    return !!(p && !p._tripped);
}

// ── 简易真空断路器 / 空气开关（点击主触头或手柄即合分闸）──

async function _closeVCB(ctx, id) {
    const sys = _sysOf(ctx), b = _c(sys, id);
    if (!b) return false;
    for (let i = 0; i < 4 && !b.isClosed(); i++) {
        _firePart(b, 'main-contact');
        await _waitFor(sys, s => !!_c(s, id).isClosed(), 2500, 100);
    }
    return b.isClosed();
}

async function _openVCB(ctx, id) {
    const sys = _sysOf(ctx), b = _c(sys, id);
    if (!b) return false;
    for (let i = 0; i < 4 && b.isClosed(); i++) {
        _firePart(b, 'main-contact');
        await _waitFor(sys, s => !_c(s, id).isClosed(), 2500, 100);
    }
    return !b.isClosed();
}

/** 空气开关（三相图式）合/分：点击手柄热区 */
async function _setACB(ctx, id, want) {
    const sys = _sysOf(ctx), a = _c(sys, id);
    if (!a) return false;
    for (let i = 0; i < 5; i++) {
        if (!!a.isClosed() === want) break;
        _firePart(a, 'handle');
        await _waitFor(sys, s => !!_c(s, id).isClosed() === want, 2000, 100);
    }
    return !!a.isClosed() === want;
}

// ── 真空断路器：工作位转换 / 接地开关 / 柜门 ──

/** 把工作位旋钮摇到目标档（0 连接 / 1 试验 / 2 检修）：一次点击点动 30°，3 次换一档 */
async function _dialTo(ctx, target) {
    const sys = _sysOf(ctx), q = _c(sys, 'qf1');
    if (!q) return false;
    for (let i = 0; i < 18; i++) {
        const cur = q.getWorkPos();
        if (cur === target) break;
        const partId = target > cur ? 'dial-cw' : 'dial-ccw';
        if (!_firePart(q, partId)) {
            // 兜底：部件节点缺失时调用组件自身的换档逻辑（带告警，非主路径）
            console.warn('[VCB] 未取到工作位旋钮点击节点，改用 _dialTurn 兜底');
            q._dialTurn(target > cur ? 1 : -1);
        }
        await _sleep(320);
    }
    return q.getWorkPos() === target;
}

/** 插入摇柄、合上三相接地开关（先点电磁锁解锁，再顺时针摇柄） */
async function _groundOn(ctx) {
    const sys = _sysOf(ctx), q = _c(sys, 'qf1');
    if (!q) return false;
    if (q.isGrounded()) return true;
    if (!q._emLockUnlocked) {
        _firePart(q, 'emlock');
        await _sleep(500);
    }
    if (!q._emLockUnlocked) return false;          // 联锁未满足（带电 / 工作位 / 开门）
    for (let i = 0; i < 14 && !q.isGrounded(); i++) {
        if (!_firePart(q, 'crank-r')) break;
        await _sleep(260);
    }
    return q.isGrounded();
}

/** 逆摇断开三相接地开关 */
async function _groundOff(ctx) {
    const sys = _sysOf(ctx), q = _c(sys, 'qf1');
    if (!q) return false;
    if (!q.isGrounded()) return true;
    if (!q._emLockUnlocked) {
        _firePart(q, 'emlock');
        await _sleep(400);
    }
    for (let i = 0; i < 14 && q.isGrounded(); i++) {
        if (!_firePart(q, 'crank-l')) break;
        await _sleep(260);
    }
    return !q.isGrounded();
}

/** 开 / 关柜门（点击柜门热区） */
async function _toggleDoor(ctx, wantOpen) {
    const sys = _sysOf(ctx), q = _c(sys, 'qf1');
    if (!q) return false;
    if (q.isDoorOpen() === wantOpen) return true;
    _firePart(q, 'door');
    await _waitFor(sys, s => _c(s, 'qf1').isDoorOpen() === wantOpen, 3000);
    return q.isDoorOpen() === wantOpen;
}

// ── 手摇兆欧表：逐相测量对地绝缘 ──

let _insulLog = [];      // [[相别, 读数(MΩ)], …]

/** 动画接线（约 3 s/根）；若页签不可见等原因使动画帧不推进，超时后瞬时补接，保证演示不中断 */
async function _animatedWire(sys, from, to) {
    if (!sys) return false;
    if (_wired(sys, from, to)) return true;
    let done = false;
    sys.connMgr.addConnectionAnimated({ from, to, type: 'wire' }).then(() => { done = true; });
    const t0 = Date.now();
    while (Date.now() - t0 < 5000 && !done) await _sleep(100);
    if (!done && !_wired(sys, from, to)) {
        sys.connMgr.addConn({ from, to, type: 'wire' });
        if (typeof sys.redrawAll === 'function') sys.redrawAll();
    }
    await _sleep(150);
    return true;
}

/** 更换 L 端测量线（≤8 根 → 动画接线） */
async function _probeTo(ctx, toPort) {
    const sys = _sysOf(ctx);
    if (!sys) return false;
    for (const c of [...sys.conns]) {
        if (c.from === 'megohm_wire_l' || c.to === 'megohm_wire_l') sys.removeConn(c);
    }
    if (_wired(sys, toPort, 'megohm_wire_l')) return true;
    await _animatedWire(sys, toPort, 'megohm_wire_l');
    return true;
}

/** 摇动手柄测量一相对地绝缘：指针稳定过程用真实测量值读数（∞ 相直接读 ∞） */
async function _crankMeasure(ctx, label) {
    const sys = _sysOf(ctx), meg = _c(sys, 'megohm');
    if (!meg) return null;
    if (!meg.isCranking()) _firePart(meg, 'crank');
    await _sleep(2600);                              // 摇动、指针起动
    // 读数取仪表自身 L-E 等效电阻测量值（指针按仪表阻尼缓慢跟随，避免读到中间值）
    let rM = NaN;
    try {
        const rOhm = typeof meg._measureLE === 'function' ? meg._measureLE() : NaN;
        rM = isFinite(rOhm) ? rOhm / 1e6 : Infinity;
    } catch (e) { rM = meg.getResistance(); }
    if (!isFinite(rM)) rM = Infinity;
    await _sleep(2200);                              // 指针继续摆到接近读数，便于学员看清
    if (meg.isCranking()) _firePart(meg, 'crank');   // 停止摇动
    await _sleep(300);
    _insulLog.push([label, rM]);
    return rM;
}

/** 汇总三相读数，判定接地相 */
async function _summarizeInsul(ctx) {
    const sys = _sysOf(ctx), meg = _c(sys, 'megohm');
    const fmt = r => (!isFinite(r) || r >= 20) ? '良好' : r.toFixed(2) + 'MΩ';
    const bad = _insulLog.find(([, r]) => isFinite(r) && r < 1);
    const summary = _insulLog.map(([l, r]) => `${l} ${fmt(r)}`).join('，');
    if (ctx && typeof ctx._tipWorkflow === 'function') {
        ctx._tipWorkflow(bad
            ? `逐相测量：${summary} → 判定左段汇流排${bad[0]}接地`
            : `逐相测量：${summary}（三相绝缘均正常）`, 7000);
    }
    if (meg) meg._demoMeasured = true;
    if (ctx && ctx._projFlag) ctx._projFlag.insulFound = true;
    await _sleep(4000);
}

// ── 台架复位（每次流程开始前把上一轮的残留状态清掉，不是教学步骤）──

async function _resetRig(ctx) {
    const sys = _sysOf(ctx);
    if (!sys) return;
    const sub = { sys };
    // 1) 分闸 + 停机
    if (_c(sys, 'qf1') && _c(sys, 'qf1').isClosed()) await _openQf(sub);
    if (_c(sys, 'gen_hv') && _c(sys, 'gen_hv').isOn) await _stopGen(sub);
    if (_c(sys, 'gen_s')) { _c(sys, 'gen_s').isOn = false; }
    // 2) 其余断路器 / 空气开关分闸
    for (const id of ['vcbs', 'vcbs2', 'vcbs3', 'vcbs4']) await _openVCB(sub, id);
    for (const id of ['aq1', 'aq2', 'aq3']) await _setACB(sub, id, false);
    // 3) 真空断路器机械状态回到初始（连接位、柜门关闭、接地开关断开、摇柄拔出）
    const q = _c(sys, 'qf1');
    if (q) {
        q._animating = false;
        if (q._state === 'on') q._state = 'off';
        q._workPos = 0; q._detent = 0; q._isoT = 0; q._dialAngle = 0; q._clickAcc = 0;
        q._doorOpen = false; q._doorSlide = 0;
        q._gsSwitches = [false, false, false];
        q._emLockUnlocked = false; q._crankInserted = false;
        q._crankTurnCount = 0; q._crankRotation = 0; q._crankCur = 0;
        q._chargeProg = 0; q._charged = false;
        if (q._btnCovers) Object.values(q._btnCovers).forEach(c => { c.open = false; });
        if (typeof q._syncMainCircuits === 'function') q._syncMainCircuits();
        if (typeof q._updateGroundSwitchState === 'function') q._updateGroundSwitchState();
    }
    // 4) 保护装置 / 接地监视仪 / 兆欧表复位
    const p = _c(sys, 'prot1');
    if (p) { p._tripped = false; p._active = 'normal'; p._phase = 'idle'; }
    const mon = _c(sys, 'hv_ground_monitor');
    if (mon) {
        mon._latched = false; mon._ack = false; mon._fault = false; mon._igFilt = 0;
        if (mon._beepStop) mon._beepStop();
    }
    const meg = _c(sys, 'megohm');
    if (meg) {
        for (const c of [...sys.conns]) {
            if (c.from.startsWith('megohm_wire') || c.to.startsWith('megohm_wire')) sys.removeConn(c);
        }
        if (meg.isCranking()) meg.setCranking(false);
        meg._demoMeasured = false;
    }
    // 5) 清除上一轮遗留的故障注入
    ['gen_internal_short_ab', 'gen_winding_short_ab', 'tf1_cooling_fault', 'insul_degraded']
        .forEach(id => { const f = sys.FAULT_CONFIG && sys.FAULT_CONFIG[id]; if (f) f.repair(); });
    await _sleep(300);
}

// ── 常用步骤片段 ──

/** 「自动接线 + 起动 1# 高压发电机 + 合闸供电」 */
function _opsSupply() {
    return [
        {
            type: 'wire', button: 'btnAutoWire',
            msg: '点击「自动接线」：复位台架并接好全部接线',
            async act() {
                await _resetRig(this);
                await _toolbarBtn('btnAutoWire');
            },
        },
        {
            type: 'btn', target: 'hvgp', part: 'start',
            msg: '按住面板「起动」，起动机组',
            async act() { await _startGen(this); },
        },
        {
            type: 'observe', target: 'hvgp', part: '带电显示器',
            msg: '机组建压，待电压、频率稳定',
            async act() {
                await _waitFor(_sysOf(this), s => {
                    const g = _c(s, 'gen_hv');
                    if (!g || !g.isOn) return false;
                    const lineV = (g._rmsV || 0) * Math.sqrt(3);
                    const f = (g._freqOut ?? g.freq) || 0;
                    return lineV > g.ratedVoltage * 0.9 && Math.abs(f - 50) < 0.6;
                }, 15000, 200);
            },
        },
        {
            type: 'btn', target: 'hvgp', part: 'close',
            msg: '按住「合闸」，向汇流排供电',
            async act() { await _closeQf(this); },
        },
    ];
}

/** 「手摇兆欧表逐相测量左汇流排对地绝缘」 */
function _opsMegohmPhases() {
    const phases = [
        ['bus1_wire_l1_5', 'A 相'],
        ['bus1_wire_l2_5', 'B 相'],
        ['bus1_wire_l3_5', 'C 相'],
    ];
    const ops = [
        {
            type: 'instrument', instrument: 'megohm',
            msg: '调出手摇式兆欧表（2500V）',
            async act() { _insulLog = []; await _sleep(300); },
        },
        {
            type: 'observe', ports: ['megohm_wire_e', 'gnd_insul_wire_gnd'],
            msg: 'E 端接地',
            async act() {
                const sys = _sysOf(this);
                await _animatedWire(sys, 'megohm_wire_e', 'gnd_insul_wire_gnd');
            },
        },
    ];
    phases.forEach(([port, label]) => {
        ops.push({
            type: 'observe', ports: [port, 'megohm_wire_l'],
            msg: `L 端接左汇流排${label}`,
            async act() { await _probeTo(this, port); },
        });
        ops.push({
            type: 'observe', target: 'megohm', part: 'crank',
            msg: `摇动测量${label}对地绝缘`,
            async act() { await _crankMeasure(this, label); },
        });
    });
    ops.push({
        type: 'observe', target: 'megohm', part: 'crank',
        msg: '比对三相读数，找出接地相',
        async act() { await _summarizeInsul(this); },
    });
    return ops;
}

export const PROJECT_WORKFLOWS = {
    // ──────────────────────────────────────────────
    // 1. 高压发电机差动电流超过阈值
    // 流程：供电 → 设置绕组中点相间短路（差动跳闸）→ F1 看入口/出口电流 →
    //       清除故障 + 复位 + 重新合闸 → 测试题
    // ──────────────────────────────────────────────
    'hv-gen-diff-overcurrent': {
        id: 'hv-gen-diff-overcurrent',
        name: '1.高压发电机差动电流超过阈值',
        steps: [
            // ── 步骤 1：自动接线，起动发电机并合闸供电 ──
            {
                msg: '第 1 步：自动接线，起动 1# 高压发电机，建压稳定后合闸供电。',
                mode: 'check',
                op: _opsSupply(),
                check() {
                    const sys = _sysOf(this);
                    const g = _c(sys, 'gen_hv'), q = _c(sys, 'qf1');
                    return !!(g && g.isOn && q && q.isClosed());
                },
            },
            // ── 步骤 2：设置两相绕组中点短路，观察差动保护跳闸 ──
            {
                msg: '第 2 步：设置「两相绕组中点短路」，观察差动保护跳闸。',
                mode: 'check',
                op: [
                    {
                        type: 'fault', fault: 'gen_winding_short_ab',
                        msg: '勾选「发电机两相绕组中点短路」并应用',
                        async act() { await _sleep(300); },
                    },
                    {
                        type: 'observe', target: 'prot1', part: 'f0',
                        msg: '保护动作，显示「差动跳闸」',
                        async act() {
                            await _waitFor(_sysOf(this), s => {
                                const p = _c(s, 'prot1');
                                return !!(p && p._tripped);
                            }, 15000, 150);
                            await _waitFor(_sysOf(this), s => {
                                const q = _c(s, 'qf1');
                                return !!(q && !q.isClosed());
                            }, 8000, 150);
                        },
                    },
                ],
                check() {
                    const sys = _sysOf(this);
                    const f = sys.FAULT_CONFIG && sys.FAULT_CONFIG['gen_winding_short_ab'];
                    const p = _c(sys, 'prot1'), q = _c(sys, 'qf1');
                    return !!(f && f.check() && p && p._tripped && q && !q.isClosed());
                },
            },
            // ── 步骤 3：按 F1 键查看入口 / 出口电流 ──
            {
                msg: '第 3 步：按 F1 键，查看入口、出口三相电流。',
                mode: 'find', target: 'prot1', subTarget: 'f1', simClick: true,
            },
            // ── 步骤 4：清除故障、复位、重新合闸 ──
            {
                msg: '第 4 步：清除绕组短路，复位保护后重新合闸。',
                mode: 'check',
                op: [
                    {
                        type: 'fault', fault: 'gen_winding_short_ab', repair: true,
                        msg: '取消勾选，清除绕组短路',
                        async act() { await _sleep(1800); },
                    },
                    {
                        type: 'observe', target: 'prot1', part: 'f0',
                        msg: '故障电流衰减，保护具备复位条件',
                        async act() {
                            await _waitFor(_sysOf(this), s => {
                                const p = _c(s, 'prot1');
                                return !!(p && typeof p._evaluateFault === 'function' && p._evaluateFault() === null);
                            }, 15000, 200);
                        },
                    },
                    {
                        type: 'btn', target: 'hvgp', part: 'reset',
                        msg: '按面板「复位」解除跳闸闭锁',
                        async act() { await _resetProt(this); },
                    },
                    {
                        type: 'btn', target: 'hvgp', part: 'close',
                        msg: '储能后重新合闸供电',
                        async act() { await _closeQf(this); },
                    },
                ],
                check() {
                    const sys = _sysOf(this);
                    const f = sys.FAULT_CONFIG && sys.FAULT_CONFIG['gen_winding_short_ab'];
                    const p = _c(sys, 'prot1'), q = _c(sys, 'qf1'), g = _c(sys, 'gen_hv');
                    return !!(f && !f.check() && p && !p._tripped && q && q.isClosed() && g && g.isOn);
                },
            },
            // ── 步骤 5：测试题 ──
            {
                msg: '第 5 步：测试题——差动电流保护的作用。',
                mode: 'quiz',
                quizConfig: {
                    question: '高压发电机差动电流保护的主要作用是什么？',
                    options: [
                        '防止高压电网过载，正常运行时限制发电机输出电流',
                        '比较机端（出口）与中性点（入口）两侧电流，绕组内部短路使差流超过定值时瞬时跳闸，快速切除发电机内部故障',
                        '仅作为后备保护，故障时延时数秒后才动作',
                        '在发电机起动过程中屏蔽全部保护，防止误动作',
                    ],
                    answer: 1,
                    analysis: '差动保护按基尔霍夫电流定律构成：正常或外部故障时两侧电流近似相等、差流≈0；绕组内部短路时差流超过整定值即跳闸。它只切除发电机内部故障，不做外部过载保护，也不是延时后备保护。',
                },
            },
        ],
    },
    // ──────────────────────────────────────────────
    // 2. 日用变压器高温导致跳闸保护
    // 流程：供电 → 合母联 + 变压器两侧开关（灯亮）→ 设置散热不良（高温跳闸）→
    //       切 2# 变压器供电 → 修复故障（温度回落）
    // ──────────────────────────────────────────────
    'hv-tf1-overheat-trip': {
        id: 'hv-tf1-overheat-trip',
        name: '2.日用变压器高温导致跳闸保护',
        steps: [
            // ── 步骤 1：自动接线，起动 1# 高压发电机并合闸供电 ──
            {
                msg: '第 1 步：自动接线，起动 1# 高压发电机，建压稳定后合闸供电。',
                mode: 'check',
                op: _opsSupply(),
                check() {
                    const sys = _sysOf(this);
                    const g = _c(sys, 'gen_hv'), q = _c(sys, 'qf1');
                    return !!(g && g.isOn && q && q.isClosed());
                },
            },
            // ── 步骤 2：合母联与 1# 变压器两侧开关，白炽灯点亮 ──
            {
                msg: '第 2 步：合上母联和 1# 变压器两侧开关，低压灯亮。',
                mode: 'check',
                op: [
                    {
                        type: 'switch', target: 'vcbs2', part: 'main-contact',
                        msg: '合上高压母联断路器',
                        async act() { await _closeVCB(this, 'vcbs2'); },
                    },
                    {
                        type: 'switch', target: 'vcbs3', part: 'main-contact',
                        msg: '合上 1# 变压器高压断路器',
                        async act() { await _closeVCB(this, 'vcbs3'); },
                    },
                    {
                        type: 'switch', target: 'aq1', part: 'handle',
                        msg: '合上 1# 变压器低压空气开关',
                        async act() { await _setACB(this, 'aq1', true); },
                    },
                    {
                        type: 'switch', target: 'aq3', part: 'handle',
                        msg: '合上低压母联开关',
                        async act() { await _setACB(this, 'aq3', true); },
                    },
                    {
                        type: 'observe', target: 'lamp_a',
                        msg: '440V 母线带电，白炽灯点亮',
                        async act() { await _waitFor(_sysOf(this), s => _lampLit(s), 12000, 150); },
                    },
                ],
                check() {
                    const sys = _sysOf(this);
                    const closed = id => { const c = _c(sys, id); return !!(c && c.isClosed && c.isClosed()); };
                    return closed('vcbs2') && closed('vcbs3') && closed('aq1') && closed('aq3') && _lampLit(sys);
                },
            },
            // ── 步骤 3：设置变压器散热不良，高温保护跳开 vcbs3 ──
            {
                msg: '第 3 步：设置「变压器严重散热不良」，观察高温跳闸。',
                mode: 'check',
                op: [
                    {
                        type: 'fault', fault: 'tf1_cooling_fault',
                        msg: '勾选「1# 变压器严重散热不良」并应用',
                        async act() { await _sleep(300); },
                    },
                    {
                        type: 'observe', target: 'tf1',
                        msg: '变压器温度升至 130℃，3 s 后跳开 vcbs3',
                        async act() {
                            await _waitFor(_sysOf(this), s => {
                                const tf = _c(s, 'tf1');
                                return !!(tf && tf.getTemp && tf.getTemp() >= 130);
                            }, 45000, 200);
                            await _waitFor(_sysOf(this), s => {
                                const b = _c(s, 'vcbs3');
                                return !!(b && !b.isClosed());
                            }, 15000, 150);
                        },
                    },
                    {
                        type: 'observe', target: 'lamp_a',
                        msg: '变压器断电冷却，白炽灯熄灭',
                        async act() { await _waitFor(_sysOf(this), s => !_lampLit(s), 15000, 200); },
                    },
                ],
                check() {
                    const sys = _sysOf(this);
                    const f = sys.FAULT_CONFIG && sys.FAULT_CONFIG['tf1_cooling_fault'];
                    const b3 = _c(sys, 'vcbs3');
                    return !!(f && f.check() && b3 && !b3.isClosed());
                },
            },
            // ── 步骤 4：断开 aq1，改由 2# 变压器供电 ──
            {
                msg: '第 4 步：断开 aq1，改由 2# 变压器供电。',
                mode: 'check',
                op: [
                    {
                        type: 'switch', target: 'aq1', part: 'handle',
                        msg: '断开 1# 变压器低压空气开关',
                        async act() { await _setACB(this, 'aq1', false); },
                    },
                    {
                        type: 'switch', target: 'vcbs4', part: 'main-contact',
                        msg: '合上 2# 变压器高压断路器',
                        async act() { await _closeVCB(this, 'vcbs4'); },
                    },
                    {
                        type: 'switch', target: 'aq2', part: 'handle',
                        msg: '合上 2# 变压器低压空气开关',
                        async act() { await _setACB(this, 'aq2', true); },
                    },
                    {
                        type: 'observe', target: 'lamp_a',
                        msg: '白炽灯重新点亮',
                        async act() { await _waitFor(_sysOf(this), s => _lampLit(s), 12000, 150); },
                    },
                ],
                check() {
                    const sys = _sysOf(this);
                    const closed = id => { const c = _c(sys, id); return !!(c && c.isClosed && c.isClosed()); };
                    const a1 = _c(sys, 'aq1');
                    return !!(a1 && !a1.isClosed()) && closed('vcbs4') && closed('aq2') && _lampLit(sys);
                },
            },
            // ── 步骤 5：修复散热故障，温度回落，保护解除 ──
            {
                msg: '第 5 步：修复散热故障，温度回落后高温保护解除。',
                mode: 'check',
                op: [
                    {
                        type: 'fault', fault: 'tf1_cooling_fault', repair: true,
                        msg: '取消勾选，修复散热不良',
                        async act() { await _sleep(300); },
                    },
                    {
                        type: 'observe', target: 'tf1',
                        msg: '温度降至 120℃ 以下，高温保护解除',
                        async act() {
                            await _waitFor(_sysOf(this), s => {
                                const tf = _c(s, 'tf1');
                                return !!(tf && tf.getTemp && tf.getTemp() < 120);
                            }, 60000, 200);
                        },
                    },
                ],
                check() {
                    const sys = _sysOf(this);
                    const f = sys.FAULT_CONFIG && sys.FAULT_CONFIG['tf1_cooling_fault'];
                    const tf = _c(sys, 'tf1');
                    return !!(f && !f.check() && tf && tf.getTemp && tf.getTemp() < 120);
                },
            },
        ],
    },
    // ──────────────────────────────────────────────
    // 3. 左汇流排接地故障判断
    // 流程：供电（含母联）→ 设置接地故障并消音消闪 → 断母联确认在左段 →
    //       分闸停机 → 兆欧表逐相测量找接地相 → 测试题
    // ──────────────────────────────────────────────
    'hv-bus1-ground-fault': {
        id: 'hv-bus1-ground-fault',
        name: '3.左汇流排接地故障判断',
        steps: [
            // ── 步骤 1：供电，并合母联使两段汇流排带电 ──
            {
                msg: '第 1 步：供电后合上高压母联，两段汇流排带电。',
                mode: 'check',
                op: _opsSupply().concat([
                    {
                        type: 'switch', target: 'vcbs2', part: 'main-contact',
                        msg: '合上高压母联断路器',
                        async act() { await _closeVCB(this, 'vcbs2'); },
                    },
                ]),
                check() {
                    const sys = _sysOf(this);
                    const g = _c(sys, 'gen_hv'), q = _c(sys, 'qf1'), v2 = _c(sys, 'vcbs2');
                    return !!(g && g.isOn && q && q.isClosed() && v2 && v2.isClosed());
                },
            },
            // ── 步骤 2：设置单相接地，监视仪报警，按「确认」消音消闪 ──
            {
                msg: '第 2 步：设置电网单相接地，报警后按「确认」消音。',
                mode: 'check',
                op: [
                    {
                        type: 'fault', fault: 'insul_degraded',
                        msg: '勾选「电网单相接地」并应用',
                        async act() { await _sleep(300); },
                    },
                    {
                        type: 'observe', target: 'hv_ground_monitor',
                        msg: '接地监视仪报警：红灯闪、蜂鸣',
                        async act() {
                            await _waitFor(_sysOf(this), s => {
                                const m = _c(s, 'hv_ground_monitor');
                                return !!(m && m._latched);
                            }, 15000, 150);
                        },
                    },
                    {
                        type: 'btn', target: 'hv_ground_monitor', part: 'ack',
                        msg: '按「确认」消音消闪',
                        async act() {
                            await _clickPart(_c(_sysOf(this), 'hv_ground_monitor'), 'ack', 900);
                            await _sleep(800);
                        },
                    },
                ],
                check() {
                    const sys = _sysOf(this);
                    const f = sys.FAULT_CONFIG && sys.FAULT_CONFIG['insul_degraded'];
                    const m = _c(sys, 'hv_ground_monitor');
                    return !!(f && f.check() && m && m._fault && m._latched && m._ack);
                },
            },
            // ── 步骤 3：断开母联，报警保持 → 故障在左汇流排 ──
            {
                msg: '第 3 步：断开高压母联，报警仍保持，判定故障在左段。',
                mode: 'check',
                op: [
                    {
                        type: 'switch', target: 'vcbs2', part: 'main-contact',
                        msg: '断开高压母联断路器',
                        async act() { await _openVCB(this, 'vcbs2'); },
                    },
                    {
                        type: 'observe', target: 'hv_ground_monitor',
                        msg: '右段失电，报警灯仍常亮',
                        async act() { await _sleep(1800); },
                    },
                ],
                check() {
                    const sys = _sysOf(this);
                    const b = _c(sys, 'vcbs2'), m = _c(sys, 'hv_ground_monitor');
                    return !!(b && !b.isClosed() && m && m._latched && m._fault);
                },
            },
            // ── 步骤 4：1# 机分闸停机，左段失电 ──
            {
                msg: '第 4 步：1# 机分闸、停机，左段汇流排失电。',
                mode: 'check',
                op: [
                    {
                        type: 'btn', target: 'hvgp', part: 'open',
                        msg: '按「分闸」断开断路器',
                        async act() { await _openQf(this); },
                    },
                    {
                        type: 'btn', target: 'hvgp', part: 'stop',
                        msg: '按「停机」停止发电机组',
                        async act() { await _stopGen(this); },
                    },
                    {
                        type: 'observe', target: 'hv_ground_monitor',
                        msg: '母线失电，故障电流消失',
                        async act() {
                            await _waitFor(_sysOf(this), s => {
                                const m = _c(s, 'hv_ground_monitor');
                                return !!(m && !m._fault);
                            }, 12000, 150);
                        },
                    },
                ],
                check() {
                    const sys = _sysOf(this);
                    const q = _c(sys, 'qf1'), g = _c(sys, 'gen_hv'), m = _c(sys, 'hv_ground_monitor');
                    return !!(q && !q.isClosed() && g && !g.isOn && m && m._latched && !m._fault);
                },
            },
            // ── 步骤 5：兆欧表逐相测量，找出接地相 ──
            {
                msg: '第 5 步：兆欧表逐相测量左段对地绝缘，找出接地相。',
                mode: 'check',
                op: _opsMegohmPhases(),
                check() {
                    const sys = _sysOf(this);
                    const meg = _c(sys, 'megohm');
                    if (!meg) return false;
                    if (this._projFlag && this._projFlag.insulFound) return true;
                    if (meg._demoMeasured) return true;
                    // 学员操作路径：摇动中读到 <0.5 MΩ 即认为找到接地相
                    return !!(meg.isCranking && meg.isCranking() && meg.getResistance() < 0.5);
                },
            },
            // ── 步骤 6：测试题 ──
            {
                msg: '第 6 步：测试题——高压电网测量绝缘的安全要求。',
                mode: 'quiz',
                quizConfig: {
                    question: '在 6600V 船舶高压电网上测量各相对地绝缘电阻时，下列做法正确的是？',
                    options: [
                        '测量前不必停电，可带电直接摇测，方便实时监测绝缘',
                        '停电、验电、人工放电后，用 2500V 兆欧表逐相对地测量，测毕再次充分放电',
                        '用 500V 电压等级的摇表即可，电压等级越高反而越危险',
                        '测完一相对地绝缘后不必放电，可直接换接下一相继续测量',
                    ],
                    answer: 1,
                    analysis: '高压测绝缘必须"停电—验电—放电—测量—再放电"：使用 2500V 及以上兆欧表逐相测量，测毕对被测相充分放电，防止剩余电荷伤人。',
                },
            },
        ],
    },
    // ──────────────────────────────────────────────
    // 4. 真空断路器隔离切换操作（五防教学）
    // 流程：合闸工作状态 → 五防题① → 分闸停机摇至试验位 → 五防题②③ →
    //       合接地开关 → 五防题④ → 开门检修 → 检修安全题 →
    //       关门断接地 → 摇回工作位重新供电 → 五防题⑤
    // ──────────────────────────────────────────────
    'hv-vcb-isolation': {
        id: 'hv-vcb-isolation',
        name: '4.真空断路器隔离切换操作',
        steps: [
            // ── 步骤 1：供电，建立工作（合闸）状态 ──
            {
                msg: '第 1 步：起动 1# 高压发电机并合闸，建立工作状态。',
                mode: 'check',
                op: _opsSupply(),
                check() {
                    const sys = _sysOf(this);
                    const g = _c(sys, 'gen_hv'), q = _c(sys, 'qf1');
                    return !!(g && g.isOn && q && q.isClosed() && q.getWorkPos() === 0);
                },
            },
            // ── 步骤 2：测试题① ──
            {
                msg: '第 2 步：测试题——合闸状态摇柄无法转动。',
                mode: 'quiz',
                quizConfig: {
                    question: '真空断路器处于合闸（连接位投入运行）状态时，插入摇柄试图摇动工作位转换机构，摇柄无法转动，这属于电气"五防"中的（　）。',
                    options: [
                        '防止误分、误合断路器',
                        '防止带负荷拉合隔离开关（防止带负荷摇动隔离手车）',
                        '防止带接地线合闸',
                        '防止误入带电间隔',
                    ],
                    answer: 1,
                    analysis: '断路器合闸即带负荷运行，工作位机构被机械闭锁，禁止摇动隔离手车，否则会造成带负荷拉合隔离开关的严重事故。',
                },
            },
            // ── 步骤 3：分闸停机，摇至试验位 ──
            {
                msg: '第 3 步：分闸停机，把工作位由连接位摇到试验位。',
                mode: 'check',
                op: [
                    {
                        type: 'btn', target: 'hvgp', part: 'open',
                        msg: '按「分闸」断开断路器',
                        async act() { await _openQf(this); },
                    },
                    {
                        type: 'btn', target: 'hvgp', part: 'stop',
                        msg: '按「停机」停止发电机组',
                        async act() { await _stopGen(this); },
                    },
                    {
                        type: 'knob', target: 'qf1', part: 'dial-cw',
                        msg: '摇动工作位转换开关，由连接位摇到试验位',
                        async act() { await _dialTo(this, 1); },
                    },
                ],
                check() {
                    const sys = _sysOf(this);
                    const g = _c(sys, 'gen_hv'), q = _c(sys, 'qf1');
                    return !!(q && !q.isClosed() && q.getWorkPos() === 1 && g && !g.isOn);
                },
            },
            // ── 步骤 4a：测试题②（按钮防护盖）──
            {
                msg: '第 4 步（之一）：测试题——合分闸按钮的防护盖。',
                mode: 'quiz',
                quizConfig: {
                    question: '真空断路器的合、分闸按钮均设有防护玻璃盖，需先翻开防护盖才能操作按钮，这属于电气"五防"中的（　）。',
                    options: [
                        '防止带负荷拉合隔离开关',
                        '防止带接地线合闸',
                        '防止误分、误合断路器',
                        '防止带电合接地开关',
                    ],
                    answer: 2,
                    analysis: '加防护盖防止误碰、误触导致断路器误分误合，即"防止误分、误合断路器"。',
                },
            },
            // ── 步骤 4b：测试题③（接地未合门不能开）──
            {
                msg: '第 4 步（之二）：测试题——接地开关未合时柜门闭锁。',
                mode: 'quiz',
                quizConfig: {
                    question: '断路器柜在接地开关尚未合上（负荷侧未可靠接地）时，柜门无法打开，这属于电气"五防"中的（　）。',
                    options: [
                        '防止误入带电间隔（未可靠接地前禁止开门进入柜内）',
                        '防止带负荷拉合隔离开关',
                        '防止误分、误合断路器',
                        '防止带接地线合闸',
                    ],
                    answer: 0,
                    analysis: '柜门与接地开关互为联锁：未确认无电、未可靠接地前不得开门检修，即"防止误入带电间隔"。',
                },
            },
            // ── 步骤 5：插入摇柄，合上接地开关 ──
            {
                msg: '第 5 步：点电磁锁解锁，插入摇柄合上接地开关。',
                mode: 'check',
                op: [
                    {
                        type: 'switch', target: 'qf1', part: 'emlock',
                        msg: '点电磁锁解锁摇柄孔',
                        async act() {
                            const q = _c(_sysOf(this), 'qf1');
                            if (q && !q._emLockUnlocked) _firePart(q, 'emlock');
                            await _sleep(500);
                        },
                    },
                    {
                        type: 'switch', target: 'qf1', part: 'crank-r',
                        msg: '插入摇柄并顺时针摇动，合上接地开关',
                        async act() { await _groundOn(this); },
                    },
                ],
                check() {
                    const q = _c(_sysOf(this), 'qf1');
                    return !!(q && q.isGrounded());
                },
            },
            // ── 步骤 6：测试题④（接地时禁止合闸）──
            {
                msg: '第 6 步：测试题——接地闭合时合闸被闭锁。',
                mode: 'quiz',
                quizConfig: {
                    question: '接地开关处于闭合状态（负荷侧已接地）时，真空断路器的合闸被可靠闭锁、无法合闸，这属于电气"五防"中的（　）。',
                    options: [
                        '防止带电挂接地线',
                        '防止误分、误合断路器',
                        '防止带负荷拉合隔离开关',
                        '防止带接地线合闸',
                    ],
                    answer: 3,
                    analysis: '线路已接地时若再合闸，等于对地短路，会烧毁动静触头，因此合闸回路被机械与电气双重闭锁——"防止带接地线合闸"。',
                },
            },
            // ── 步骤 7：打开柜门检修 ──
            {
                msg: '第 7 步：负荷侧已接地，打开柜门进行检修。',
                mode: 'check',
                op: [
                    {
                        type: 'switch', target: 'qf1', part: 'door',
                        msg: '打开柜门',
                        async act() { await _toggleDoor(this, true); },
                    },
                ],
                check() {
                    const q = _c(_sysOf(this), 'qf1');
                    return !!(q && q.isDoorOpen() && q.isGrounded());
                },
            },
            // ── 步骤 8：测试题⑤（检修安全要求）──
            {
                msg: '第 8 步：测试题——检修过程中对人的要求。',
                mode: 'quiz',
                quizConfig: {
                    question: '打开柜门对真空断路器进行检修时，对检修人员的要求是（　）。',
                    options: [
                        '检修时间紧，可一人独立作业，带电操作也没关系',
                        '持证上岗、至少两人作业；停电—验电—放电—挂接地线—挂"禁止合闸"标示牌，使用合格绝缘工器具',
                        '只需戴普通棉纱手套即可保证安全',
                        '检修中可随意短接闭锁装置以简化操作',
                    ],
                    answer: 1,
                    analysis: '高压柜检修必须落实组织措施与技术措施：工作票、至少两人、停电验电放电挂接地线挂标示牌、使用合格绝缘工器具，严禁擅自解除闭锁。',
                },
            },
            // ── 步骤 9：关门、断开接地开关 ──
            {
                msg: '第 9 步：关闭柜门，逆摇断开接地开关。',
                mode: 'check',
                op: [
                    {
                        type: 'switch', target: 'qf1', part: 'door',
                        msg: '关闭柜门',
                        async act() { await _toggleDoor(this, false); },
                    },
                    {
                        type: 'switch', target: 'qf1', part: 'crank-l',
                        msg: '逆时针摇动，断开接地开关',
                        async act() { await _groundOff(this); },
                    },
                ],
                check() {
                    const q = _c(_sysOf(this), 'qf1');
                    return !!(q && !q.isDoorOpen() && !q.isGrounded());
                },
            },
            // ── 步骤 10：摇回连接位，重新供电 ──
            {
                msg: '第 10 步：摇回连接位，起动发电机重新合闸供电。',
                mode: 'check',
                op: [
                    {
                        type: 'knob', target: 'qf1', part: 'dial-ccw',
                        msg: '摇动工作位转换开关，由试验位摇回连接位',
                        async act() { await _dialTo(this, 0); },
                    },
                    {
                        type: 'btn', target: 'hvgp', part: 'start',
                        msg: '按住「起动」重新起动机组',
                        async act() { await _startGen(this); },
                    },
                    {
                        type: 'btn', target: 'hvgp', part: 'close',
                        msg: '按住「合闸」恢复供电',
                        async act() { await _closeQf(this); },
                    },
                ],
                check() {
                    const sys = _sysOf(this);
                    const g = _c(sys, 'gen_hv'), q = _c(sys, 'qf1');
                    return !!(q && q.getWorkPos() === 0 && q.isClosed() && g && g.isOn);
                },
            },
            // ── 步骤 11：测试题⑥（合闸时接地开关闭锁）──
            {
                msg: '第 11 步：测试题——合闸时接地开关被闭锁。',
                mode: 'quiz',
                quizConfig: {
                    question: '真空断路器处于合闸（带电运行）状态时，接地开关被闭锁、无法合上，这属于电气"五防"中的（　）。',
                    options: [
                        '防止带接地线合闸',
                        '防止带电合接地开关（防止带电挂接地线）',
                        '防止误分、误合断路器',
                        '防止带负荷拉合隔离开关',
                    ],
                    answer: 1,
                    analysis: '断路器合闸时负荷侧带电，接地开关被闭锁，摇柄插不进、合不上，防止带电挂接地线造成人身与设备事故。与第 6 步的"防带接地线合闸"构成双向互锁。',
                },
            },
        ],
    },
    // ──────────────────────────────────────────────
    // 5. 微机综合保护装置说明
    // 识装置 → CT/PT 采样（填空）→ 信号传递（选择）→ 高压特有保护 → 内部短路跳闸
    // ──────────────────────────────────────────────
    'hv-prot-intro': {
        id: 'hv-prot-intro',
        name: '5.微机综合保护装置说明',
        steps: [
            {
                msg: '第 1 步：在画面上找到并点击微机综合保护装置。',
                mode: 'find',
                target: 'prot1',
            },
            {
                msg: '第 2 步：填空题——装置采样用的互感器。',
                mode: 'fill',
                target: 'prot1',
                fields: [
                    { label: '电流', answer: ['电流互感器', 'ct'], placeholder: '如：电流互感器 或 CT' },
                    { label: '电压', answer: ['电压互感器', 'pt'], placeholder: '如：电压互感器 或 PT' },
                ],
            },
            {
                msg: '第 3 步：测试题——数字式保护装置的信号传递。',
                mode: 'quiz',
                quizConfig: {
                    question: '在数字式综合保护装置（微机保护装置）中，正确的信号传递关系是（　）。',
                    options: [
                        '跳闸回路 → 微机保护装置 → CT/PT → VCB',
                        'CT/PT → 微机保护装置 → 跳闸回路 → VCB',
                        'VCB → 跳闸回路 → 微机保护装置 → CT/PT',
                        '微机保护装置 → CT/PT → VCB → 跳闸回路',
                    ],
                    answer: 1,
                    analysis: 'CT/PT 先把电流、电压降幅隔离后送入装置运算判断；故障时装置出口接通跳闸回路，驱动 VCB 分闸。',
                },
            },
            {
                msg: '第 4 步：测试题——高压发电机特有的保护。',
                mode: 'quiz',
                quizConfig: {
                    question: '与低压船舶发电机相比，下列属于高压发电机（如 6.6kV）特有的保护是（　）。',
                    options: [
                        '失压保护',
                        '纵联差动保护',
                        '逆功率保护',
                        '过载保护',
                    ],
                    answer: 1,
                    analysis: '高压发电机额定电流小、绕组相间短路危害大，必须增设纵联差动保护（定子绕组相间短路主保护）等高压机组特有的保护。',
                },
            },
            {
                msg: '第 5 步：测试题——内部相间短路由哪种保护跳闸。',
                mode: 'quiz',
                quizConfig: {
                    question: '某高压发电机内部绕组发生相间短路时，依靠（　）实现快速可靠跳闸？',
                    options: [
                        '逆功率保护',
                        '过载保护（长延时）',
                        '差动保护',
                        '绝缘监测（接地显示）',
                    ],
                    answer: 2,
                    analysis: '绕组内部相间短路由纵联差动保护承担：比较机端与中性点两侧电流，差流超定值即瞬时跳闸。',
                },
            },
        ],
    },
};

export const componentConfigs = [
    // ── 主回路：三相交流电源 → 真空断路器(T端进) → L端出 → 汇流排 ──
    {
        Class: VacuumCircuitBreaker,
        id: 'qf1',
        x: -100,
        y: 160,
        ratedCtrlVoltage: 24,
        label: '10kV真空断路器',
        genId: '',
        revPowerKw: 300,
        revTime: 5,
        faultSimpleProtect: true,
        visible: true
    },
    { Class: Busbar3P, id: 'bus1', x: -100, y: 10, portsPerBar: 6, label: '汇流排', visible: true },
    // ── 船舶高压发电机：6600V / 50Hz / 2000kW，初始停机（T端无压，满足接地五防前提）──
    {
        Class: MarineHVGenerator, id: 'gen_hv', x: -100, y: 680,
        freq: 50, vRms: 3810, ratedPower: 2000, ratedVoltage: 6600, ratedCosPhi: 0.8,
        isOn: false, mode: 'remote', label: '船舶高压发电机', visible: true
    },

    // ── 控制回路：DC 24V 电源（正极 → 储能电机 m1 / 失压线圈 uv1；负极接地）──
    { Class: DCPower, id: 'dc24', x: 280, y: 0, voltage: 24, isOn: true, label: '24V控制电源', visible: true },
    // 24V 电源负极接地（接地一）
    { Class: Ground, id: 'gnd_dc', x: 520, y: 270, label: '电源负极接地', visible: true },
    // 四个线圈负端公共接地（接地二）：m2 / c2 / uv2 / flb
    { Class: Ground, id: 'gnd_coil', x: 400, y: 280, label: '线圈负端接地', visible: true },
    // 发电机中性点接地
    { Class: Ground, id: 'gnd_coil2', x: 450, y: 990, label: '发电机中性点接地', visible: true },    
    // 遥控面板3个线圈负端公共接地（接地三）：m2 / c2 / uv2 / flb
    { Class: Ground, id: 'gnd_hv', x: 750, y: 620, label: '高压负端接地', visible: true },
    // 遥控面板3个线圈负端公共接地（接地三）：m2 / c2 / uv2 / flb
    { Class: Ground, id: 'gnd_prot', x: 1000, y: 880, label: '保护负端接地', visible: true },    
    // ── 高压发电机遥控面板：监控/遥控高压发电机与真空断路器 ──
    {
        Class: HvGenRemotePanel, id: 'hvgp', x: 420, y: 320,
        genId: 'gen_hv', qfId: 'qf1', protId: 'prot1', busId: 'bus1',
        label: '高压发电机遥控面板', visible: true
    },

    // ── 微机综合保护装置：差动/短路/过载/接地/欠压/逆功率（直接读发电机量）──
    {
        Class: HvGenProtection, id: 'prot1', x: 500, y: 660,
        genId: 'gen_hv', qfId: 'qf1', In: 218.7, label: '微机综合保护装置', visible: true
    },

    // ── 中性点接地电阻：500Ω，发电机中性点经此电阻接地 ──
    { Class: Resistor, id: 'rn', x: 310, y: 980, value: 500, direction: 'vertical', label: '中性点接地电阻', rotation: -90, visible: true },

    // ── 高压三相可调负载：三角联接（无中性点，对地绝缘），接汇流排第 5 口 ──
    {
        Class: HvThreePhaseLoad, id: 'hvload', x: 1560, y: 150,
        powerKw: 500, cosPhi: 0.8, reactive: 'ind', loaded: false, label: '高压三相可调负载', visible: true
    },

    // ── 船舶高压电力系统单线图（交互组件）──
    { Class: HvPowerOneLine, id: 'one_line', x: 2200, y: 40, label: '电力系统单线图', visible: false },

    // ── 高压三相变压器：6600V 原边（接汇流排2），440V 副边输出 ──
    // ── 左侧高压变压器 tf1：bus1 第5口 → vcbs3 → tf1 原边；副边 → aq1 → 低压汇流排1 ──
    {
        Class: HvTransformer, id: 'tf1', x: 1050, y: 420,
        vPrimary: 6600, vSecondary: 440, label: '高压三相变压器',
        protBk: 'vcbs3', hTripTemp: 130, hTripDelay: 3, visible: true
    },
    // ── 右侧高压变压器 tf2：bus_s2 第2口 → vcbs4 → tf2 原边；副边 → aq2 → 低压汇流排2 ──
    { Class: HvTransformer, id: 'tf2', x: 1400, y: 420, vPrimary: 6600, vSecondary: 440, label: '高压三相变压器2', protBk: 'vcbs4', hTripTemp: 130, hTripDelay: 3, visible: true },
    { Class: SimpleVCB, id: 'vcbs3', x: 1030, y: 160, initState: 'off', initIso: 'on', label: '断路器3', visible: true },
    // ── 右侧高压变压器回路：bus_s2 第2口 → vcbs4 → tf1 原边 ──
    { Class: SimpleVCB, id: 'vcbs4', x: 1400, y: 160, initState: 'off', initIso: 'on', label: '断路器4', visible: true },
    // ── 空气开关（三相图式）：aq1 左侧副边 / aq2 右侧副边 / aq3 低压互联 ──
    { Class: DiagramThreePhaseACB, id: 'aq1', x: 1050, y: 690, initState: 'off', label: '空气开关1', ratedVoltage: 440, ratedCurrent: 100, tripCurrent: 100, visible: true },
    { Class: DiagramThreePhaseACB, id: 'aq2', x: 1400, y: 690, initState: 'off', label: '空气开关2', ratedVoltage: 440, ratedCurrent: 100, tripCurrent: 100, visible: true },

    // ── 低压 440V 汇流排（2 端口）──
    { Class: Busbar3P, id: 'bus_lv1', x: 950, y: 900, portsPerBar: 2, label: '低压汇流排1', visible: true },
    { Class: Busbar3P, id: 'bus_lv2', x: 1420, y: 900, portsPerBar: 2, label: '低压汇流排2', visible: true },
    // ── 低压母线2 上方的 3 盏白炽灯：每盏 10kW（R = 254²/10kW ≈ 6.45Ω），星型连接（中点浮动不接地）──
    { Class: IncandescentLamp, id: 'lamp_a', x: 1620, y: 780, coldResistance: 6.45, rotation: 90, label: '白炽灯A' },
    { Class: IncandescentLamp, id: 'lamp_b', x: 1680, y: 780, coldResistance: 6.45, rotation: 90, label: '白炽灯B' },
    { Class: IncandescentLamp, id: 'lamp_c', x: 1740, y: 780, coldResistance: 6.45, rotation: 90, label: '白炽灯C' },
    { Class: DiagramThreePhaseACB, id: 'aq3', x: 1420, y: 880, rotation: 90, initState: 'off', label: '空气开关3', ratedVoltage: 440, ratedCurrent: 100, tripCurrent: 100, visible: true },

    // ── 简化版高压发电机：只保留操作界面，顶部三相输出 + 底部中性点 ──
    {
        Class: SimpleHVGenerator, id: 'gen_s', x: 1800, y: 460,
        isOn: false, mode: 'local', label: '简化高压发电机', visible: true
    },
    // ── 2号发电机中性点接地：500Ω 电阻 + 地 ──
    { Class: Resistor, id: 'rn_s', x: 1960, y: 750, value: 500, direction: 'vertical', label: '中性点接地电阻', rotation: -90, visible: true },
    { Class: Ground, id: 'gnd_gen_s', x: 2030, y: 800, label: '发电机2中性点接地', visible: true },

    // ── 简化版真空断路器（带上下隔离）：发电机 → 汇流排2 输送 ──
    {
        Class: SimpleVCB, id: 'vcbs', x: 1920, y: 180,
        initState: 'off', initIso: 'on', label: '真空断路器(带隔离)', visible: true
    },
    // ── 汇流排2（第二汇流排）：接简化发电机/断路器 ──
    { Class: Busbar3P, id: 'bus_s2', x: 1350, y: 10, portsPerBar: 4, label: '汇流排2', visible: true },
    // ── 简化版真空断路器2：旋转 90°，连接 汇流排1 ↔ 汇流排2 ──
    {
        Class: SimpleVCB, id: 'vcbs2', x: 1300, y: 10, rotation: 90,
        initState: 'off', initIso: 'on', label: '断路器(旋转90°)', visible: true
    },
    // ── 高压配电柜组件图（展示组件）──
    { Class: HvSwitchPanel, id: 'switch_panel', x: 20, y: 40, label: '高压配电柜', visible: false },
    // ── 高压验电器（手持验电工具）──
    { Class: HvTester, id: 'hv_tester', x: 2050, y: 700, label: '高压验电器', visible: false },
    // ── 高压接地监视仪：液晶屏三行显示 A/B/C 相绝缘电阻，上端 3 端子接汇流排1 第 4 口 ──
    { Class: HvGroundMonitor, id: 'hv_ground_monitor', x: 580, y: 130, label: '高压接地监视仪', visible: true },
    // ── 绝缘电阻测试支路：汇流排1 第5口第3相 → 10MΩ 竖放电阻 → 接地（模拟绝缘下降）──
    { Class: Resistor, id: 'r_insul', x: 852, y: 190, value: 10000000, direction: 'vertical', label: '绝缘电阻10MΩ', visible: true },
    { Class: Ground, id: 'gnd_insul', x: 852, y: 280, label: '接地', visible: true },
    // ── 高压放电棒（手持放电工具：钩尖碰带电体 → 10MΩ 放电电阻 → 接地线 → 地）──
    // 3 个电气端口：l(钩尖) / r(连接处·接地引出) / gnd(接地线末端)；未自动接线，教师可按需接入
    { Class: HvDischargeRod, id: 'hv_rod', x: 1980, y: 920, label: '高压放电棒', value: 10000000, visible: false },
    // ── 高压接地线（三相短路接地线：三个相接线夹竖排 + 三根向下弯曲软线 + 接地夹；右侧绝缘杆与手柄）──
    // 4 个电气端口：p1/p2/p3(相接线夹) / gnd(接地夹)，内部三相短接接地；未自动接线，教师可按需接入
    { Class: HvGroundingCable, id: 'hv_ground_cable', x: 1960, y: 960, label: '高压接地线', visible: false },
    // ── 测量仪表（隐藏，按需显示）──
    { Class: Multimeter, id: 'multimeter', x: 500, y: 100, visible: false },
    { Class: MF47Multimeter, id: 'mf47-panel', x: 650, y: 100, visible: false },
    { Class: Oscilloscope_tri, id: 'osc', x: 50, y: 50, visible: false },
    { Class: SignalGenerator, id: 'sg', x: 50, y: 50, visible: false },
    { Class: ProcessCalibrator, id: 'cali', x: 50, y: 50, visible: false },
    { Class: ElecMeter, id: 'elecmeter', x: 50, y: 50, visible: false },
    // ── 手摇式兆欧表（摇表，2500V 型；隐藏，测试绝缘时按需调出）──
    { Class: RealMegohmMeter, id: 'megohm', x: 200, y: 50, voltage: 2500, label: '手摇兆欧表(2500V)', visible: false },
];

// ─── 接线辅助 ───

const _sleep = ms => new Promise(r => setTimeout(r, ms));

// 白炽灯是否通电点亮：低压母线2 线电压 > 300V（440V 系统），或灯丝亮度上升（双保险）
function _lampLit(sys) {
    let byBus = false;
    if (sys.getVoltageBetween) {
        const v = Math.abs(sys.getVoltageBetween('bus_lv2_wire_l1_1', 'bus_lv2_wire_l3_1') || 0);
        byBus = v > 300;
    }
    const byBright = ['lamp_a', 'lamp_b', 'lamp_c'].some(id => {
        const l = sys.comps[id];
        return l && l._brightness > 0.4;
    });
    return byBus || byBright;
}

function _autoWire(sys) {
    sys.conns.length = 0;
    const cons = [
        // ── 主回路：高压发电机 → 断路器 T1-T3（U/V/W 直连）──
        { from: 'gen_hv_wire_u', to: 'qf1_wire_t1', type: 'wire' },
        { from: 'gen_hv_wire_v', to: 'qf1_wire_t2', type: 'wire' },
        { from: 'gen_hv_wire_w', to: 'qf1_wire_t3', type: 'wire' },
        // ── 中性点 N → 500Ω 接地电阻 → 接地（绕组中点经电阻接地）──
        { from: 'gen_hv_wire_n', to: 'rn_wire_l', type: 'wire' },
        { from: 'rn_wire_r', to: 'gnd_coil2_wire_gnd', type: 'wire' },        
        // ── 高压三相可调负载：汇流排第 5 口 → 负载 L1/L2/L3（三角联接，无中性点）──
        { from: 'bus_s2_wire_l1_3', to: 'hvload_wire_l1', type: 'wire' },
        { from: 'bus_s2_wire_l2_3', to: 'hvload_wire_l2', type: 'wire' },
        { from: 'bus_s2_wire_l3_3', to: 'hvload_wire_l3', type: 'wire' },
        // ── 主回路：断路器 L1-L3 → 汇流排第 1 号接口 ──
        { from: 'qf1_wire_l1', to: 'bus1_wire_l1_1', type: 'wire' },
        { from: 'qf1_wire_l2', to: 'bus1_wire_l2_1', type: 'wire' },
        { from: 'qf1_wire_l3', to: 'bus1_wire_l3_1', type: 'wire' },
        // ── 控制回路：24V 正极 → 储能电机正端 m1 / 失压线圈正端 uv1 ──
        { from: 'dc24_wire_p', to: 'qf1_wire_m1', type: 'wire' },
        { from: 'dc24_wire_p', to: 'qf1_wire_uv1', type: 'wire' },
        // ── 24V 负极 → 接地一 ──
        { from: 'dc24_wire_n', to: 'gnd_dc_wire_gnd', type: 'wire' },
        // ── 四个线圈负端（m2/c2/uv2/flb）→ 接地二 ──
        { from: 'qf1_wire_m2',  to: 'gnd_coil_wire_gnd', type: 'wire' },
        { from: 'qf1_wire_c2',  to: 'gnd_coil_wire_gnd', type: 'wire' },
        { from: 'qf1_wire_uv2', to: 'gnd_coil_wire_gnd', type: 'wire' },
        { from: 'qf1_wire_flb', to: 'gnd_coil_wire_gnd', type: 'wire' },
        // ── 高压发电机遥控面板 ──
        // 左侧：发电机组起动/停止/调速（接发电机遥控端口）
        { from: 'hvgp_wire_start_a', to: 'gen_hv_wire_rm_start_a', type: 'wire' },
        { from: 'hvgp_wire_start_b', to: 'gen_hv_wire_rm_start_b', type: 'wire' },
        { from: 'hvgp_wire_stop_a',  to: 'gen_hv_wire_rm_stop_a',  type: 'wire' },
        { from: 'hvgp_wire_stop_b',  to: 'gen_hv_wire_rm_stop_b',  type: 'wire' },
        { from: 'hvgp_wire_spd_p',   to: 'gen_hv_wire_freq_in_p',  type: 'wire' },
        { from: 'hvgp_wire_spd_n',   to: 'gen_hv_wire_freq_in_n',  type: 'wire' },
        // 下方：合闸 / 分闸 / 灭磁输出
        { from: 'hvgp_wire_close_a', to: 'qf1_wire_c1',          type: 'wire' },
        { from: 'hvgp_wire_close_b', to: 'gnd_hv_wire_gnd',    type: 'wire' },
        { from: 'hvgp_wire_open_a',  to: 'qf1_wire_fla',         type: 'wire' },
        { from: 'hvgp_wire_open_b',  to: 'gnd_hv_wire_gnd',    type: 'wire' },
        { from: 'hvgp_wire_demag_a', to: 'gen_hv_wire_mc_a',     type: 'wire' },
        { from: 'hvgp_wire_demag_b', to: 'gen_hv_wire_mc_b',     type: 'wire' },
        // 右侧：24V 电源接口
        { from: 'dc24_wire_p', to: 'hvgp_wire_p24_p', type: 'wire' },
        { from: 'gnd_hv_wire_gnd', to: 'hvgp_wire_p24_n', type: 'wire' },
        // ── 微机综合保护装置：左边 4 对接线（表面演示，不参与电路求解）──
        //   3 对电流信号（出口/入口/中性点 CT）+ PT 电压
        { from: 'gen_hv_wire_cta_out_s1', to: 'prot1_wire_cta_out_s1', type: 'wire' },
        { from: 'gen_hv_wire_cta_out_s2', to: 'prot1_wire_cta_out_s2', type: 'wire' },
        { from: 'gen_hv_wire_cta_in_s1',  to: 'prot1_wire_cta_in_s1',  type: 'wire' },
        { from: 'gen_hv_wire_cta_in_s2',  to: 'prot1_wire_cta_in_s2',  type: 'wire' },
        { from: 'gen_hv_wire_ctn_s1',     to: 'prot1_wire_ctn_s1',     type: 'wire' },
        { from: 'gen_hv_wire_ctn_s2',     to: 'prot1_wire_ctn_s2',     type: 'wire' },
        { from: 'gen_hv_wire_pt_a',       to: 'prot1_wire_pt_a',       type: 'wire' },
        { from: 'gen_hv_wire_pt_b',       to: 'prot1_wire_pt_b',       type: 'wire' },
        // 24V 电源 + 保护通信（右侧）
        { from: 'dc24_wire_p',   to: 'prot1_wire_p24_p', type: 'wire' },
        { from: 'gnd_prot_wire_gnd',   to: 'prot1_wire_p24_n', type: 'wire' },
        { from: 'hvgp_wire_prot_a', to: 'prot1_wire_prot_a', type: 'wire' },
        { from: 'hvgp_wire_prot_b', to: 'prot1_wire_prot_b', type: 'wire' },
        // ── 简化高压发电机：三相输出 → 简化断路器 T 端；中性点 → 接地 ──
        { from: 'gen_s_wire_u', to: 'vcbs_wire_t1', type: 'wire' },
        { from: 'gen_s_wire_v', to: 'vcbs_wire_t2', type: 'wire' },
        { from: 'gen_s_wire_w', to: 'vcbs_wire_t3', type: 'wire' },
        { from: 'gen_s_wire_n', to: 'rn_s_wire_l', type: 'wire' },
        { from: 'rn_s_wire_r', to: 'gnd_gen_s_wire_gnd', type: 'wire' },

        // ═══════════════════════════════════════════════════════════
        // 双变压器供配电网络
        // ═══════════════════════════════════════════════════════════
        // ── 左侧：bus1 第5口 → vcbs3 L 端 → tf1 原边（T 端）──
        { from: 'bus1_wire_l1_5', to: 'vcbs3_wire_l1', type: 'wire' },
        { from: 'bus1_wire_l2_5', to: 'vcbs3_wire_l2', type: 'wire' },
        { from: 'bus1_wire_l3_5', to: 'vcbs3_wire_l3', type: 'wire' },
        { from: 'vcbs3_wire_t1', to: 'tf1_wire_h1', type: 'wire' },
        { from: 'vcbs3_wire_t2', to: 'tf1_wire_h2', type: 'wire' },
        { from: 'vcbs3_wire_t3', to: 'tf1_wire_h3', type: 'wire' },
        // ── tf1 副边 → aq1 → 低压汇流排1 ──
        { from: 'tf1_wire_x1', to: 'aq1_wire_l1', type: 'wire' },
        { from: 'tf1_wire_x2', to: 'aq1_wire_l2', type: 'wire' },
        { from: 'tf1_wire_x3', to: 'aq1_wire_l3', type: 'wire' },
        { from: 'aq1_wire_t1', to: 'bus_lv1_wire_l1_1', type: 'wire' },
        { from: 'aq1_wire_t2', to: 'bus_lv1_wire_l2_1', type: 'wire' },
        { from: 'aq1_wire_t3', to: 'bus_lv1_wire_l3_1', type: 'wire' },
        // ── 右侧：bus_s2 第2口 → vcbs4 L 端 → tf2 原边（T 端）──
        { from: 'bus_s2_wire_l1_2', to: 'vcbs4_wire_l1', type: 'wire' },
        { from: 'bus_s2_wire_l2_2', to: 'vcbs4_wire_l2', type: 'wire' },
        { from: 'bus_s2_wire_l3_2', to: 'vcbs4_wire_l3', type: 'wire' },
        { from: 'vcbs4_wire_t1', to: 'tf2_wire_h1', type: 'wire' },
        { from: 'vcbs4_wire_t2', to: 'tf2_wire_h2', type: 'wire' },
        { from: 'vcbs4_wire_t3', to: 'tf2_wire_h3', type: 'wire' },
        // ── tf2 副边 → aq2 → 低压汇流排2 ──
        { from: 'tf2_wire_x1', to: 'aq2_wire_l1', type: 'wire' },
        { from: 'tf2_wire_x2', to: 'aq2_wire_l2', type: 'wire' },
        { from: 'tf2_wire_x3', to: 'aq2_wire_l3', type: 'wire' },
        { from: 'aq2_wire_t1', to: 'bus_lv2_wire_l1_1', type: 'wire' },
        // ── 白炽灯星型连接（母线2 第1口取电，中点浮动不接地）──
        { from: 'bus_lv2_wire_l1_2', to: 'lamp_a_wire_r', type: 'wire' },
        { from: 'bus_lv2_wire_l2_2', to: 'lamp_b_wire_r', type: 'wire' },
        { from: 'bus_lv2_wire_l3_2', to: 'lamp_c_wire_r', type: 'wire' },
        { from: 'lamp_a_wire_l', to: 'lamp_b_wire_l', type: 'wire' },
        { from: 'lamp_b_wire_l', to: 'lamp_c_wire_l', type: 'wire' },
        { from: 'aq2_wire_t2', to: 'bus_lv2_wire_l2_1', type: 'wire' },
        { from: 'aq2_wire_t3', to: 'bus_lv2_wire_l3_1', type: 'wire' },
        // ── 两个低压汇流排通过 aq3 连接（L 端接低压汇流排1，T 端接低压汇流排2）──
        { from: 'bus_lv1_wire_l1_2', to: 'aq3_wire_t1', type: 'wire' },
        { from: 'bus_lv1_wire_l2_2', to: 'aq3_wire_t2', type: 'wire' },
        { from: 'bus_lv1_wire_l3_2', to: 'aq3_wire_t3', type: 'wire' },
        { from: 'aq3_wire_l1', to: 'bus_lv2_wire_l1_1', type: 'wire' },
        { from: 'aq3_wire_l2', to: 'bus_lv2_wire_l2_1', type: 'wire' },
        { from: 'aq3_wire_l3', to: 'bus_lv2_wire_l3_1', type: 'wire' },
        // ── 低压负载（星形接地）──

        // ── 断路器1（发电机路径）→ 汇流排2（第 4 口）──
        { from: 'vcbs_wire_l1', to: 'bus_s2_wire_l1_4', type: 'wire' },
        { from: 'vcbs_wire_l2', to: 'bus_s2_wire_l2_4', type: 'wire' },
        { from: 'vcbs_wire_l3', to: 'bus_s2_wire_l3_4', type: 'wire' },
        // ── 母联断路器2（旋转90°）：汇流排1 第 6 口 → T 端；L 端 → 汇流排2 第 1 口 ──
        { from: 'bus1_wire_l1_6', to: 'vcbs2_wire_t1', type: 'wire' },
        { from: 'bus1_wire_l2_6', to: 'vcbs2_wire_t2', type: 'wire' },
        { from: 'bus1_wire_l3_6', to: 'vcbs2_wire_t3', type: 'wire' },
        { from: 'vcbs2_wire_l1', to: 'bus_s2_wire_l1_1', type: 'wire' },
        { from: 'vcbs2_wire_l2', to: 'bus_s2_wire_l2_1', type: 'wire' },
        { from: 'vcbs2_wire_l3', to: 'bus_s2_wire_l3_1', type: 'wire' },
        // ── 高压接地监视仪：汇流排1 第 4 口 → 监视仪上端 3 端子 ──
        { from: 'bus1_wire_l1_4', to: 'hv_ground_monitor_wire_l1', type: 'wire' },
        { from: 'bus1_wire_l2_4', to: 'hv_ground_monitor_wire_l2', type: 'wire' },
        { from: 'bus1_wire_l3_4', to: 'hv_ground_monitor_wire_l3', type: 'wire' },
        // ── 绝缘电阻测试支路：汇流排1 第5口第3相 → 10MΩ 竖放电阻 → 接地 ──
        { from: 'bus1_wire_l3_5', to: 'r_insul_wire_l', type: 'wire' },
        { from: 'r_insul_wire_r', to: 'gnd_insul_wire_gnd', type: 'wire' },
    ];
    cons.forEach(c => sys.connMgr.addConn(c));
    sys.redrawAll();
}

export function initSlider(_sys) {
}

/** 自动接线：初始化（opts.init=true）时不预接线，画布默认无任何接线 */
export function applyAllPresets(opts) {
    if (opts && opts.init) return;
    const sys = this && this.sys ? this.sys : window.sys;
    if (!sys) return;
    _autoWire(sys);
}

/** 起动系统：自动接线 → 复位台架 → 起动 1# 高压发电机 → 合闸供电（全部模拟面板操作） */
export async function applyStartSystem() {
    const sys = this && this.sys ? this.sys : window.sys;
    if (!sys) return;
    try {
        _autoWire(sys);
        await _sleep(400);
        const ctx = { sys };
        await _resetRig(ctx);
        await _startGen(ctx);
        await _closeQf(ctx);
    } catch (e) {
        console.warn('[起动系统] 执行异常：', e);
    }
}

export function fiveStep() {
}
