// 船舶高压系统操作和绝缘监测（6.6kV 高压发电机 + 真空断路器 + 微机综合保护 + 高压接地监视 + 双变压器低压配电）
// 教学项目：起动并网操作 / 变压器转换 / 停电后绝缘测量 / 绝缘监测与接地判别

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

/** 汇流排是否带电：取该汇流排 l1_1 / l2_1 两口之间的线电压 */
function _busLive(sys, busId, minV = 6000) {
    if (!sys || typeof sys.getVoltageBetween !== 'function') return false;
    try {
        const v = Math.abs(sys.getVoltageBetween(`${busId}_wire_l1_1`, `${busId}_wire_l2_1`) || 0);
        return v > minV;
    } catch (e) { return false; }
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
    // 1. 高压发电机起动、建压与并网供电操作
    // 流程：识别起停开关 → 自动接线 + 起动 + 建压 → 合闸供电 → 识别真空泡 →
    //       合母联并联 → 并网条件题 → 分断母联/分闸/停机
    // ──────────────────────────────────────────────
    'hv-gen-start-parallel': {
        id: 'hv-gen-start-parallel',
        name: '1.高压发电机起动与并网供电操作',
        steps: [
            // ── 步骤 1：识别遥控面板起停开关 ──
            {
                msg: '第 1 步：识别遥控面板起停开关（左起、右停）。',
                mode: 'find',
                target: 'hvgp',
                subTarget: 'start',
            },
            // ── 步骤 2：自动接线，按住「起动」，机组建压至额定 ──
            {
                msg: '第 2 步：自动接线，按住「起动」，机组建压至额定。',
                mode: 'check',
                op: _opsSupply().slice(0, 3),
                check() {
                    const sys = _sysOf(this);
                    const g = _c(sys, 'gen_hv');
                    if (!g || !g.isOn) return false;
                    const lineV = (g._rmsV || 0) * Math.sqrt(3);
                    const f = (g._freqOut ?? g.freq) || 0;
                    return lineV > g.ratedVoltage * 0.9 && Math.abs(f - 50) < 0.6;
                },
            },
            // ── 步骤 3：按住「合闸」，真空断路器合闸向汇流排供电 ──
            {
                msg: '第 3 步：按住「合闸」，断路器合闸向汇流排供电。',
                mode: 'check',
                op: [
                    {
                        type: 'btn', target: 'hvgp', part: 'close',
                        msg: '按住「合闸」，断路器合闸',
                        async act() { await _closeQf(this); },
                    },
                    {
                        type: 'observe', target: 'qf1', part: 'main-contact',
                        msg: '主触头闭合，汇流排带电',
                        async act() {
                            await _waitFor(_sysOf(this), s => _busLive(s, 'bus1', 6000), 12000, 150);
                        },
                    },
                ],
                check() {
                    const sys = _sysOf(this);
                    const q = _c(sys, 'qf1');
                    return !!(q && q.isClosed() && _busLive(sys, 'bus1', 6000));
                },
            },
            // ── 步骤 4：识别真空断路器的真空泡（主触头）──
            {
                msg: '第 4 步：识别真空断路器的真空泡（主触头）。',
                mode: 'find',
                target: 'qf1',
                subTarget: 'main-contact',
            },
            // ── 步骤 5：合上高压母联，两段汇流排并联供电 ──
            {
                msg: '第 5 步：合上高压母联，右段汇流排带电。',
                mode: 'check',
                op: [
                    {
                        type: 'switch', target: 'vcbs2', part: 'main-contact',
                        msg: '合上高压母联断路器',
                        async act() { await _closeVCB(this, 'vcbs2'); },
                    },
                    {
                        type: 'observe', target: 'hvload',
                        msg: '右段汇流排带电，负载具备投运条件',
                        async act() {
                            await _waitFor(_sysOf(this), s => _busLive(s, 'bus_s2', 6000), 12000, 150);
                        },
                    },
                ],
                check() {
                    const sys = _sysOf(this);
                    const v2 = _c(sys, 'vcbs2');
                    return !!(v2 && v2.isClosed() && _busLive(sys, 'bus_s2', 6000));
                },
            },
            // ── 步骤 6：测试题——并网合闸条件 ──
            {
                msg: '第 6 步：测试题——并网合闸必须具备的条件。',
                mode: 'quiz',
                quizConfig: {
                    question: '船舶高压发电机手动并网合闸前，必须具备的条件是（　）。',
                    options: [
                        '只要发电机已经起动、转速稳定就可以合闸',
                        '发电机电压幅值、频率、相位（相序）与电网一致，且断路器已储能',
                        '只要断路器储能弹簧已储能，无需核对电压和频率',
                        '电压略低于电网电压时合闸更安全，可减少冲击电流',
                    ],
                    answer: 1,
                    analysis: '并网必须满足"电压幅值相等、频率相等、相位一致、相序相同"，否则合闸瞬间会产生很大的冲击电流和机械应力；真空断路器还需储能到位才能合闸。',
                },
            },
            // ── 步骤 7：分断母联、分闸、停机 ──
            {
                msg: '第 7 步：分断母联，分闸停机，系统退出运行。',
                mode: 'check',
                op: [
                    {
                        type: 'switch', target: 'vcbs2', part: 'main-contact',
                        msg: '分断高压母联断路器',
                        async act() { await _openVCB(this, 'vcbs2'); },
                    },
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
                ],
                check() {
                    const sys = _sysOf(this);
                    const v2 = _c(sys, 'vcbs2'), q = _c(sys, 'qf1'), g = _c(sys, 'gen_hv');
                    return !!(v2 && !v2.isClosed() && q && !q.isClosed() && g && !g.isOn);
                },
            },
        ],
    },
    // ──────────────────────────────────────────────
    // 2. 日用变压器的转换操作
    // 流程：供电 + 合母联 → 1# 变供电（灯亮）→ 2# 变投入并联 →
    //       并联条件题 → 先断低压后断高压退出 1# 变 → 转换顺序题
    // ──────────────────────────────────────────────
    'hv-tf-changeover': {
        id: 'hv-tf-changeover',
        name: '2.日用变压器的转换操作',
        steps: [
            // ── 步骤 1：供电，合上高压母联 ──
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
            // ── 步骤 2：合 1# 变两侧开关与低压母联，白炽灯点亮 ──
            {
                msg: '第 2 步：合 1# 变两侧开关与低压母联，白炽灯点亮。',
                mode: 'check',
                op: [
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
                        async act() { await _waitFor(_sysOf(this), s => _lampLit(s), 15000, 150); },
                    },
                ],
                check() {
                    const sys = _sysOf(this);
                    const closed = id => { const c = _c(sys, id); return !!(c && c.isClosed && c.isClosed()); };
                    return closed('vcbs3') && closed('aq1') && closed('aq3') && _lampLit(sys);
                },
            },
            // ── 步骤 3：合 2# 变两侧开关，两变短时并联 ──
            {
                msg: '第 3 步：合 2# 变两侧开关，两台变压器短时并联。',
                mode: 'check',
                op: [
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
                        msg: '两台变压器并联供电，白炽灯保持点亮',
                        async act() { await _sleep(1500); },
                    },
                ],
                check() {
                    const sys = _sysOf(this);
                    const closed = id => { const c = _c(sys, id); return !!(c && c.isClosed && c.isClosed()); };
                    return closed('vcbs3') && closed('aq1') && closed('vcbs4') && closed('aq2') && _lampLit(sys);
                },
            },
            // ── 步骤 4：测试题——并联运行条件 ──
            {
                msg: '第 4 步：测试题——日用变压器并联运行的条件。',
                mode: 'quiz',
                quizConfig: {
                    question: '日用变压器并联运行必须满足哪些条件？',
                    options: [
                        '只要容量相同即可并联',
                        '变比相等、联结组别相同、短路阻抗（百分比）相等、相位一致',
                        '只要电压等级相同即可并联',
                        '只要接在同一段母线上就可以并联',
                    ],
                    answer: 1,
                    analysis: '变比相等避免空载环流；组别相同保证二次电压相位一致；短路阻抗百分比相等使负载按容量比例分配；否则并联瞬间会产生环流甚至跳闸。',
                },
            },
            // ── 步骤 5：先断低压、再断高压，1# 变退出 ──
            {
                msg: '第 5 步：先断 aq1、再断 vcbs3，1# 变退出运行。',
                mode: 'check',
                op: [
                    {
                        type: 'switch', target: 'aq1', part: 'handle',
                        msg: '断开 1# 变压器低压空气开关',
                        async act() { await _setACB(this, 'aq1', false); },
                    },
                    {
                        type: 'switch', target: 'vcbs3', part: 'main-contact',
                        msg: '断开 1# 变压器高压断路器',
                        async act() { await _openVCB(this, 'vcbs3'); },
                    },
                    {
                        type: 'observe', target: 'lamp_a',
                        msg: '由 2# 变压器继续供电，白炽灯保持点亮',
                        async act() { await _waitFor(_sysOf(this), s => _lampLit(s), 12000, 150); },
                    },
                ],
                check() {
                    const sys = _sysOf(this);
                    const a1 = _c(sys, 'aq1'), b3 = _c(sys, 'vcbs3');
                    return !!(a1 && !a1.isClosed() && b3 && !b3.isClosed() && _lampLit(sys));
                },
            },
            // ── 步骤 6：测试题——转换操作顺序 ──
            {
                msg: '第 6 步：测试题——变压器转换的操作顺序。',
                mode: 'quiz',
                quizConfig: {
                    question: '把负载由 1# 变压器转换到 2# 变压器时，正确的操作顺序是（　）。',
                    options: [
                        '先断开 1# 变压器两侧开关，再合上 2# 变压器，避免并联运行',
                        '先合上 2# 变压器两侧开关（短时并联），再先断低压侧、后断高压侧退出 1# 变压器',
                        '先断开 1# 变压器高压侧，再断开低压侧',
                        '两台变压器不能短时并联，必须先断后合且无需考虑顺序',
                    ],
                    answer: 1,
                    analysis: '转换时先合后断可避免低压母线瞬时失电；退出时先断低压侧再断高压侧，防止高压侧带负荷分闸产生电弧；短时并联要求满足并联条件。',
                },
            },
        ],
    },
    // ──────────────────────────────────────────────
    // 3. 高压汇流排停电与绝缘电阻测量
    // 流程：分闸停机 → 摇至试验位 → 合接地开关放电 → 安全题 →
    //       断接地开关、兆欧表逐相测量 → 测量流程题
    // ──────────────────────────────────────────────
    'hv-insulation-test': {
        id: 'hv-insulation-test',
        name: '3.高压汇流排停电与绝缘电阻测量',
        steps: [
            // ── 步骤 1：分闸、停机，汇流排停电 ──
            {
                msg: '第 1 步：分闸、停机，使汇流排停电。',
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
                ],
                check() {
                    const sys = _sysOf(this);
                    const q = _c(sys, 'qf1'), g = _c(sys, 'gen_hv');
                    return !!(q && !q.isClosed() && g && !g.isOn);
                },
            },
            // ── 步骤 2：工作位由连接位摇到试验位 ──
            {
                msg: '第 2 步：把工作位由连接位摇到试验位。',
                mode: 'check',
                op: [
                    {
                        type: 'knob', target: 'qf1', part: 'dial-cw',
                        msg: '摇动工作位转换开关至试验位',
                        async act() { await _dialTo(this, 1); },
                    },
                ],
                check() {
                    const q = _c(_sysOf(this), 'qf1');
                    return !!(q && q.getWorkPos() === 1 && !q.isClosed());
                },
            },
            // ── 步骤 3：点电磁锁解锁，合上接地开关放电 ──
            {
                msg: '第 3 步：点电磁锁解锁，合上接地开关放电。',
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
            // ── 步骤 4：测试题——停电后先合接地开关的原因 ──
            {
                msg: '第 4 步：测试题——停电后先合接地开关的原因。',
                mode: 'quiz',
                quizConfig: {
                    question: '高压设备停电后、检修或测绝缘前，合上接地开关的主要作用是（　）。',
                    options: [
                        '降低设备温度，便于散热',
                        '泄放电缆与设备电容上的剩余电荷，并防止突然来电（反送电）伤人',
                        '提高设备的绝缘电阻数值',
                        '把三相电流短接以提高功率因数',
                    ],
                    answer: 1,
                    analysis: '接地开关把检修段三相短接接地：一方面泄放剩余电荷，另一方面在误送电或反送电时将电流导入大地并引起保护动作，保障检修人员安全。',
                },
            },
            // ── 步骤 5：断接地开关，兆欧表逐相测量 ──
            {
                msg: '第 5 步：断接地开关，用兆欧表逐相测量绝缘。',
                mode: 'check',
                op: [
                    {
                        type: 'switch', target: 'qf1', part: 'crank-l',
                        msg: '逆时针摇动，断开接地开关',
                        async act() { await _groundOff(this); },
                    },
                ].concat(_opsMegohmPhases()),
                check() {
                    const sys = _sysOf(this);
                    const meg = _c(sys, 'megohm');
                    if (!meg) return false;
                    if (this._projFlag && this._projFlag.insulFound) return true;
                    if (meg._demoMeasured) return true;
                    return !!(meg.isCranking && meg.isCranking() && meg.getResistance() > 1);
                },
            },
            // ── 步骤 6：测试题——测量绝缘的完整流程 ──
            {
                msg: '第 6 步：测试题——高压设备测绝缘的完整流程。',
                mode: 'quiz',
                quizConfig: {
                    question: '高压发电机/汇流排测量绝缘电阻的完整操作流程是（　）。',
                    options: [
                        '直接摇表测量即可，不必停电',
                        '停电→验电→摇到试验位→合接地开关放电→断开接地→接线→摇表测量→记录→恢复送电',
                        '只需断开断路器即可测量',
                        '合上接地开关后直接测量',
                    ],
                    answer: 1,
                    analysis: '流程要点：停电、验电、人工放电（接地开关）、断开接地后用 2500V 兆欧表逐相测量，测毕再充分放电，最后恢复接地开关与工作位。',
                },
            },
        ],
    },
    // ──────────────────────────────────────────────
    // 4. 汇流排绝缘监测与单相接地判别
    // 流程：供电观察读数 → 设置单相接地报警 → 按「确认」消音 → 修复 + 复位 → 仪表作用题
    // ──────────────────────────────────────────────
    'hv-insul-monitor': {
        id: 'hv-insul-monitor',
        name: '4.汇流排绝缘监测与单相接地判别',
        steps: [
            // ── 步骤 1：识别接地监视仪的「确认」按钮 ──
            {
                msg: '第 1 步：识别接地监视仪的「确认」按钮。',
                mode: 'find',
                target: 'hv_ground_monitor',
                subTarget: 'ack',
            },
            // ── 步骤 2：供电并合母联，观察三相绝缘读数 ──
            {
                msg: '第 2 步：供电并合母联，观察三相绝缘读数。',
                mode: 'check',
                op: _opsSupply().concat([
                    {
                        type: 'switch', target: 'vcbs2', part: 'main-contact',
                        msg: '合上高压母联断路器',
                        async act() { await _closeVCB(this, 'vcbs2'); },
                    },
                    {
                        type: 'observe', target: 'hv_ground_monitor',
                        msg: '液晶三行显示 A/B/C 相绝缘电阻，无报警',
                        async act() {
                            await _waitFor(_sysOf(this), s => {
                                const m = _c(s, 'hv_ground_monitor');
                                return !!(m && m._minInsul > 1 && !m._latched);
                            }, 15000, 200);
                        },
                    },
                ]),
                check() {
                    const sys = _sysOf(this);
                    const m = _c(sys, 'hv_ground_monitor');
                    const v2 = _c(sys, 'vcbs2');
                    return !!(m && m._minInsul > 1 && !m._latched && v2 && v2.isClosed());
                },
            },
            // ── 步骤 3：设置「电网单相接地」，监视仪报警 ──
            {
                msg: '第 3 步：设置「电网单相接地」，监视仪报警。',
                mode: 'check',
                op: [
                    {
                        type: 'fault', fault: 'insul_degraded',
                        msg: '勾选「电网单相接地」并应用',
                        async act() { await _sleep(300); },
                    },
                    {
                        type: 'observe', target: 'hv_ground_monitor',
                        msg: '绝缘降至报警值：红灯闪、蜂鸣',
                        async act() {
                            await _waitFor(_sysOf(this), s => {
                                const m = _c(s, 'hv_ground_monitor');
                                return !!(m && m._latched && m._fault);
                            }, 15000, 150);
                        },
                    },
                ],
                check() {
                    const sys = _sysOf(this);
                    const f = sys.FAULT_CONFIG && sys.FAULT_CONFIG['insul_degraded'];
                    const m = _c(sys, 'hv_ground_monitor');
                    return !!(f && f.check() && m && m._latched && m._fault);
                },
            },
            // ── 步骤 4：按「确认」消音消闪 ──
            {
                msg: '第 4 步：按「确认」消音消闪，报警灯转常亮。',
                mode: 'check',
                op: [
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
                    const m = _c(_sysOf(this), 'hv_ground_monitor');
                    return !!(m && m._latched && m._ack);
                },
            },
            // ── 步骤 5：修复接地后按「复位」熄灭报警 ──
            {
                msg: '第 5 步：修复接地，按「复位」熄灭报警。',
                mode: 'check',
                op: [
                    {
                        type: 'fault', fault: 'insul_degraded', repair: true,
                        msg: '取消勾选，清除单相接地',
                        async act() { await _sleep(300); },
                    },
                    {
                        type: 'observe', target: 'hv_ground_monitor',
                        msg: '绝缘恢复，故障消失',
                        async act() {
                            await _waitFor(_sysOf(this), s => {
                                const m = _c(s, 'hv_ground_monitor');
                                return !!(m && !m._fault);
                            }, 15000, 150);
                        },
                    },
                    {
                        type: 'btn', target: 'hv_ground_monitor', part: 'reset',
                        msg: '按「复位」熄灭报警灯',
                        async act() {
                            await _clickPart(_c(_sysOf(this), 'hv_ground_monitor'), 'reset', 900);
                            await _waitFor(_sysOf(this), s => {
                                const m = _c(s, 'hv_ground_monitor');
                                return !!(m && !m._latched);
                            }, 6000, 150);
                        },
                    },
                ],
                check() {
                    const sys = _sysOf(this);
                    const f = sys.FAULT_CONFIG && sys.FAULT_CONFIG['insul_degraded'];
                    const m = _c(sys, 'hv_ground_monitor');
                    return !!(f && !f.check() && m && !m._fault && !m._latched);
                },
            },
            // ── 步骤 6：测试题——接地监视仪的作用 ──
            {
                msg: '第 6 步：测试题——高压接地监视仪的作用。',
                mode: 'quiz',
                quizConfig: {
                    question: '高压接地监视仪（绝缘监视装置）的主要作用是（　）。',
                    options: [
                        '测量发电机输出的有功功率',
                        '实时监测电网对地绝缘电阻，绝缘降到报警值时发出声光报警并记忆故障',
                        '控制断路器的合闸与分闸',
                        '测量高压母线电流以计算负荷率',
                    ],
                    answer: 1,
                    analysis: '监视仪经三相电压互感器测量中性点对地电压与零序电流，折算成各相对地绝缘电阻；低于阈值即声光报警并锁存，供值班人员确认、排查。',
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
