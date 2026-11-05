// 船舶动力电网绝缘监视与故障排查仿真工程
// （同步发电机 + 主开关 + 汇流排 + 低压配电箱 + 三灯绝缘指示灯 + 绝缘监视仪）
//
// 电路组成：
//   主回路  gen1（同步发电机）→ qf1 主触头 → bus1 汇流排
//           bus1 第 8 列 → pdb1 低压配电箱（三路塑壳开关）
//             sw1 → im01 三相异步电机（Y 接法）
//             sw2 → lamp1~3 三盏白炽灯（星形中性点互联、不接地）
//             sw3 → tload 三相可调负载（星形，中性点不接地）
//   绝缘检测 insul（三灯绝缘指示灯）：三相接母线下缘 tap（l1_4/l2_4/l3_4），
//            地端口经面板常开「测试」按钮接船体地；按钮按住时三灯接于三相与地之间，
//            某相对地绝缘下降（或接地）→ 该相灯变暗（或熄灭）。
//            insulmon（绝缘监视仪）：同 tap 取三相，读三相最小绝缘，
//            < 0.1 MΩ 声光报警（快闪 + 蜂鸣），面板「消音 / 消闪 / 复位」三键。
//   控制回路 dc_uv（DC 24 V）→ sb「模拟失压」（常闭）→ 失压线圈 uv
//                            → sc「合闸」（常开）→ 合闸线圈 c
//                            → ss「分闸」（常开）→ 分励线圈 fl
//                            → 储能电机 m1/m2
//
// 约定（与全局 AGENTS.md「最新范式」一致）：
//   · 单页工程：不导出 PROJECT_PAGES，consys.js 不创建 PageManager，工作流无 page op
//   · 默认不接线：applyAllPresets() 不做接线；只有「自动接线 / 起动系统 / 工作流 op」才接线
//   · 故障一律走「故障设置」界面（op.type='fault'），不直接调 FAULT_CONFIG[...].trigger()
//   · 仪表一律走「选择仪表」界面（op.type='instrument'），表笔用动画接线（约 3 s/根）
//   · 按钮/手柄/塑壳开关一律模拟真实点击（getClickablePartNode(...).fire('click'/'mousedown')）
//   · 等待一律用条件轮询 _waitFor，不写死 sleep 猜时间

import { SyncGenerator3P } from '../components/SyncGenerator3P.js';
import { Busbar3P } from '../components/Busbar3P.js';
import { MarineMainsSwitch } from '../components/MarineMainsSwitch.js';
import { DCPower } from '../components/DCPower.js';
import { Ground } from '../components/Gnd.js';
import { DiagramStartButton } from '../components/DiagramStartButton.js';
import { DiagramStopButton } from '../components/DiagramStopButton.js';
import { InductionMotor2 } from '../components/InductionMotor2.js';
import { IncandescentLamp } from '../components/IncandescentLamp.js';
import { Multimeter } from '../components/Multimeter.js';
import { MF47Multimeter } from '../components/MF47Multimeter.js';
import { Oscilloscope_tri } from '../components/Osc_tri.js';
import { SignalGenerator } from '../components/SignalGenerator.js';
import { ProcessCalibrator } from '../components/ProcessCalibrator.js';
import { ElecMeter } from '../components/ElecMeter.js';
import { RealMegohmMeter } from '../components/RealMegohmMeter.js';
import { DistributionBox } from '../components/DistributionBox.js';
import { ThreePhaseLoad } from '../components/ThreePhaseLoad.js';
import { InsulationIndicator } from '../components/InsulationIndicator.js';
import { InsulationMonitor } from '../components/InsulationMonitor.js';

export const FAULT_CONFIGS = {
    // ── 动力电网绝缘低：三路负载随机选一路、该路三相随机选一相，绝缘设为 0.05 MΩ ──
    insul_low: {
        id: 'insul_low',
        name: '动力电网绝缘低',
        system: '绝缘监测',
        _pick: null,   // { ld, ph } 本次故障选中的负载与相
        trigger() {
            const insul = window.sys?.comps?.['insul'];
            if (!insul) return;
            const ld = Math.floor(Math.random() * 3);   // 0电机/1照明/2可调
            const ph = Math.floor(Math.random() * 3);   // 0A/1B/2C
            this._pick = { ld, ph };
            insul.setLoadInsul(ld, ph, 0.05e6);          // 0.05 MΩ
        },
        repair() {
            const insul = window.sys?.comps?.['insul'];
            if (!insul || !this._pick) return;   // 未设置故障时不动作，避免误恢复他相
            const p = this._pick;
            insul.setLoadInsul(p.ld, p.ph, 100e6);        // 恢复 100 MΩ
            this._pick = null;
        },
        check() {
            const insul = window.sys?.comps?.['insul'];
            if (!insul || !this._pick) return false;
            const v = insul.getLoadInsul(this._pick.ld, this._pick.ph);
            return isFinite(v) && v > 0 && v <= 0.05e6;   // 0.05 MΩ
        },
    },
    // ── 动力电网接地：三路负载随机选一路、该路三相随机选一相，绝缘设为 0（对地短路） ──
    insul_ground: {
        id: 'insul_ground',
        name: '动力电网接地',
        system: '绝缘监测',
        _pick: null,
        trigger() {
            const insul = window.sys?.comps?.['insul'];
            if (!insul) return;
            const ld = Math.floor(Math.random() * 3);
            const ph = Math.floor(Math.random() * 3);
            this._pick = { ld, ph };
            insul.setLoadInsul(ld, ph, 0);                 // 对地短路
        },
        repair() {
            const insul = window.sys?.comps?.['insul'];
            if (!insul || !this._pick) return;   // 未设置故障时不动作，避免误恢复他相
            const p = this._pick;
            insul.setLoadInsul(p.ld, p.ph, 100e6);         // 恢复 100 MΩ
            this._pick = null;
        },
        check() {
            const insul = window.sys?.comps?.['insul'];
            if (!insul || !this._pick) return false;
            return insul.getLoadInsul(this._pick.ld, this._pick.ph) === 0;
        },
    },
};

// ═══════════════════════════════════════════════════════════════
// 二、工作流通用辅助
// ═══════════════════════════════════════════════════════════════

const _sysOf = (ctx) => (ctx && ctx.sys) ? ctx.sys : window.sys;
const _sleep = (ms) => new Promise(r => setTimeout(r, ms));
const _comp = (sys, id) => (sys && sys.comps) ? sys.comps[id] : null;
const _qf = (ctx) => _comp(_sysOf(ctx), 'qf1');
const _pdb = (ctx) => _comp(_sysOf(ctx), 'pdb1');
const _insul = (ctx) => _comp(_sysOf(ctx), 'insul');
const _insulMon = (ctx) => _comp(_sysOf(ctx), 'insulmon');
const _mg = (ctx) => _comp(_sysOf(ctx), 'megohm');

/** 条件轮询等待（不写死 sleep 猜时间） */
async function _waitFor(sys, cond, timeout = 6000, interval = 100) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
        try { if (cond(sys)) return true; } catch (e) { /* ignore */ }
        await _sleep(interval);
    }
    return false;
}

/** 模拟点击组件部件（触发组件自身交互逻辑，不直接改内部字段） */
function _firePart(comp, partId, evt = 'click') {
    if (!comp || typeof comp.getClickablePartNode !== 'function') return false;
    const node = comp.getClickablePartNode(partId);
    if (!node) return false;
    try { node.fire(evt, { evt: { cancelBubble: false } }); } catch (e) { /* ignore */ }
    return true;
}

/** 按住部件 holdMs 后松开（模拟真实「按下—保持—松开」） */
async function _pressPart(comp, partId, holdMs = 400) {
    if (!_firePart(comp, partId, 'mousedown')) return false;
    await _sleep(holdMs);
    _firePart(comp, partId, 'mouseup');
    return true;
}

/** 两端口之间是否已有导线（供 check() 判定） */
function _wired(sys, a, b) {
    return !!(sys && Array.isArray(sys.conns) && sys.conns.some(c =>
        c && c.type === 'wire' && ((c.from === a && c.to === b) || (c.from === b && c.to === a))));
}

/** 动画接线（仪表表笔等 ≤8 根时一律逐根动画，约 3 s/根） */
async function _wire(sys, from, to) {
    if (!sys || !sys.connMgr) return;
    await sys.connMgr.addConnectionAnimated({ from, to, type: 'wire' });
}

/** 拆掉兆欧表表笔 */
function _removeProbes(sys) {
    if (!sys || !Array.isArray(sys.conns)) return;
    const keep = sys.conns.filter(c => {
        const f = String(c && c.from), t = String(c && c.to);
        return !(c && c.type === 'wire' && (f.startsWith('megohm_wire_') || t.startsWith('megohm_wire_')
            || f.startsWith('multimeter_wire_') || t.startsWith('multimeter_wire_')));
    });
    sys.conns.length = 0;
    keep.forEach(c => sys.conns.push(c));
    if (sys.redrawAll) sys.redrawAll();
}

/** 收起仪表（停止摇动 + 拆表笔 + 隐藏仪表） */
async function _putAwayInstrument(ctx, instId) {
    const sys = _sysOf(ctx);
    const mg = _mg(ctx);
    if (mg && mg.isCranking && mg.isCranking()) {
        if (!_firePart(mg, 'crank', 'click') && mg.setCranking) mg.setCranking(false);
        await _sleep(300);
    }
    _removeProbes(sys);
    if (typeof sys.toggleInstrumentVisibility === 'function') sys.toggleInstrumentVisibility(instId, false);
    await _sleep(600);
}

/** 按压储能手柄 times 次（每次真实 mousedown/mouseup），并等储能到位 */
async function _ensureCharged(ctx, times = 5) {
    const sys = _sysOf(ctx);
    const qf = _qf(ctx);
    if (!qf) return;
    if (qf.isCharged()) return;
    for (let i = 0; i < times; i++) {
        if (qf.isCharged()) break;
        if (!_firePart(qf, 'handle', 'mousedown')) {
            console.warn('[主开关] 未取到储能手柄节点，跳过手动储能');
            break;
        }
        await _sleep(180);
        _firePart(qf, 'handle', 'mouseup');
        await _sleep(220);
    }
    await _waitFor(sys, s => { const q = _comp(s, 'qf1'); return q && q.isCharged(); }, 8000);
    await _sleep(400);
}

/** 按手动合闸按钮合闸（储能不足先储能），并等主触头闭合 */
async function _closeQF(ctx) {
    const sys = _sysOf(ctx);
    const qf = _qf(ctx);
    if (!qf) return;
    await _ensureCharged(ctx);
    if (qf.getState() === 'off') {
        if (!_firePart(qf, 'btn-close', 'click') && qf.tryClose) qf.tryClose();
        await _waitFor(sys, s => { const q = _comp(s, 'qf1'); return q && q.getState() === 'on'; }, 6000);
    }
    await _sleep(900);
}

/** 配电箱某一路开关切到目标状态（trip → 先点一次复位到 OFF，再点一次合闸） */
async function _pdbSet(ctx, s, wantOn) {
    const sys = _sysOf(ctx);
    const pdb = _pdb(ctx);
    if (!pdb) return;
    const want = wantOn ? 'on' : 'off';
    for (let i = 0; i < 4; i++) {
        const st = pdb.getStates()[s];
        if (st === want) break;
        if (st === 'trip') {
            _firePart(pdb, `sw${s + 1}`, 'click');   // 脱扣位：点一下复位到 OFF
            await _sleep(600);
            continue;
        }
        _firePart(pdb, `sw${s + 1}`, 'click');
        await _waitFor(sys, sy => {
            const p = _comp(sy, 'pdb1');
            return p && p.getStates()[s] === want;
        }, 3000);
        await _sleep(250);
    }
    await _sleep(300);
}

/** 配电箱三路开关统一操作 */
async function _pdbAll(ctx, on) {
    for (let s = 0; s < 3; s++) await _pdbSet(ctx, s, on);
}

/** 按下发电机机旁起动按钮（真实 mousedown），等发电机建压 */
async function _genStart(ctx) {
    const sys = _sysOf(ctx);
    const gen = _comp(sys, 'gen1');
    if (!gen) return;
    if (!gen.isOn) {
        if (!_pressPart(gen, 'start', 300)) {
            console.warn('[发电机] 未取到起动按钮节点，兜底置位');
            gen.isOn = true;
        }
        await _waitFor(sys, s => { const g = _comp(s, 'gen1'); return g && g.isOn; }, 4000);
    }
    await _sleep(800);
}

/** 自动接线（工具栏按钮真实点击） */
async function _autoWireBtn(ctx) {
    const sys = _sysOf(ctx);
    const btn = document.getElementById('btnAutoWire');
    if (btn && typeof btn.onclick === 'function') btn.click();
    else if (sys && typeof sys.applyAllPresets === 'function') sys.applyAllPresets();
    await _sleep(1200);
}

/** 兆欧表摇动（真实点击手摇柄），并按条件等读数稳定 */
async function _mgCrank(ctx, on, cond, timeout = 8000, interval = 100) {
    const sys = _sysOf(ctx);
    const mg = _mg(ctx);
    if (!mg) return false;
    const cur = mg.isCranking ? mg.isCranking() : false;
    if (cur !== !!on) {
        if (!_firePart(mg, 'crank', 'click') && mg.setCranking) mg.setCranking(on);
        await _sleep(400);
    }
    await _waitFor(sys, () => {
        if (!cond) return true;
        return cond(mg.getResistance());
    }, timeout, interval);
    await _sleep(600);
    return true;
}

/** 兆欧表读数（MΩ） */
function _mgR(ctx) {
    const mg = _mg(ctx);
    return mg ? mg.getResistance() : NaN;
}

/** 兆欧表 L/E 是否已按预期接到指定端口 */
function _mgOn(sys, lPort, ePort) {
    const vs = sys && sys.voltageSolver;
    if (!vs || !vs.portToCluster) return false;
    const cL = vs.portToCluster.get('megohm_wire_l');
    const cE = vs.portToCluster.get('megohm_wire_e');
    const cA = vs.portToCluster.get(lPort);
    const cB = vs.portToCluster.get(ePort);
    if (cL === undefined || cE === undefined || cA === undefined || cB === undefined) return false;
    return cL === cA && cE === cB;
}

/**
 * 绝缘指示灯「测试」按钮：按住观察 → 松开
 * 真实模拟 mousedown/mouseup（组件按住期间才闭合按钮），使三灯切换到对地测量状态。
 */
async function _insulTestHold(ctx, holdMs = 4200) {
    const insul = _insul(ctx);
    if (!insul) return;
    if (_firePart(insul, 'btn', 'mousedown')) {
        await _sleep(holdMs);
        _firePart(insul, 'btn', 'mouseup');
        await _sleep(500);
        return;
    }
    // 兜底：取不到命中节点时锁定按钮，观察后再解除
    console.warn('[绝缘指示灯] 未取到测试按钮节点，改用锁定模拟');
    insul.setButtonLocked(true);
    await _sleep(holdMs);
    insul.setButtonLocked(false);
    await _sleep(400);
}

/** 绝缘监视仪面板按钮（消音 / 消闪 / 复位） */
async function _imPress(ctx, key) {
    const im = _insulMon(ctx);
    if (!im) return false;
    if (!_firePart(im, `btn-${key}`)) {
        console.warn(`[绝缘监视仪] 未取到按钮 btn-${key}，兜底调用`);
        if (typeof im._pressButton === 'function') im._pressButton(key);
    }
    await _sleep(600);
    return true;
}

/** 等绝缘监视仪进入报警锁存 */
async function _waitAlarm(ctx, timeout = 14000) {
    const sys = _sysOf(ctx);
    return _waitFor(sys, s => { const im = _comp(s, 'insulmon'); return im && im.isAlarming(); }, timeout);
}

/** 三相绝缘是否已恢复（≥ 报警阈值） */
function _insulRecovered(ctx) {
    const im = _insulMon(ctx);
    if (!im) return false;
    const th = (typeof im._threshold === 'number') ? im._threshold : 0.1e6;
    return im.getMinResistance() >= th;
}

/** 本此故障所选负载、相别对应的 L 端接入端口 id */
function _faultLoadPort(ctx) {
    const sys = _sysOf(ctx);
    const fc = sys && sys.FAULT_CONFIG ? sys.FAULT_CONFIG['insul_low'] : null;
    const pick = fc && fc._pick;
    const ld = pick ? (pick.ld | 0) : 0;
    const ph = pick ? (pick.ph | 0) : 0;
    const table = [
        ['im01_wire_u1', 'im01_wire_v1', 'im01_wire_w1'],
        ['lamp1_wire_l', 'lamp2_wire_l', 'lamp3_wire_l'],
        ['tload_wire_l1', 'tload_wire_l2', 'tload_wire_l3'],
    ];
    const row = table[ld] || table[0];
    return row[ph] || row[0];
}

/** 步骤级标记（演示中"按下→现象→松开后消失"的操作，供 check 兜底） */
function _flag(ctx, key, value) {
    if (!ctx) return false;
    if (!ctx._projFlag) ctx._projFlag = {};
    if (value === undefined) return !!ctx._projFlag[key];
    ctx._projFlag[key] = value;
    return true;
}

// ═══════════════════════════════════════════════════════════════
// 三、工作流
// ═══════════════════════════════════════════════════════════════

export const PROJECT_WORKFLOWS = {
    // ── 用仪表确认动力电网绝缘低 / 接地故障 ──
    'insul-detect': {
        id: 'insul-detect',
        name: '1. 用仪表确认动力电网绝缘故障',
        steps: [
            {
                msg: '1. 接线，起动发电机，合闸，合上三路负载开关。',
                mode: 'check',
                op: [
                    { type: 'wire', button: 'btnAutoWire', msg: '点击「自动接线」', async act() { await _autoWireBtn(this); } },
                    { type: 'btn', target: 'gen1', part: 'start', msg: '按机旁起动按钮，发电机建压', async act() { await _genStart(this); } },
                    { type: 'btn', target: 'qf1', part: 'handle', msg: '储能不足时按压手柄储能', async act() { await _ensureCharged(this); } },
                    { type: 'btn', target: 'qf1', part: 'btn-close', msg: '按合闸按钮，主触头闭合', async act() { await _closeQF(this); } },
                    { type: 'btn', target: 'pdb1', part: 'sw1', msg: '合上开关1（电机）', async act() { await _pdbSet(this, 0, true); } },
                    { type: 'btn', target: 'pdb1', part: 'sw2', msg: '合上开关2（照明）', async act() { await _pdbSet(this, 1, true); } },
                    { type: 'btn', target: 'pdb1', part: 'sw3', msg: '合上开关3（可调负载）', async act() { await _pdbSet(this, 2, true); } },
                ],
                check() {
                    const sys = _sysOf(this);
                    if (!_wired(sys, 'gen1_wire_u', 'qf1_wire_t1')) return false;
                    if (!_wired(sys, 'qf1_wire_l1', 'bus1_wire_l1_1')) return false;
                    if (!_wired(sys, 'bus1_wire_l1_8', 'pdb1_wire_in1')) return false;
                    if (!_wired(sys, 'bus1_wire_l1_4', 'insul_wire_l1')) return false;
                    if (!_wired(sys, 'bus1_wire_l1_4', 'insulmon_wire_l1')) return false;
                    const gen = _comp(sys, 'gen1');
                    if (!gen || !gen.isOn) return false;
                    const qf = _qf(this);
                    if (!qf || qf.getState() !== 'on') return false;
                    const st = _pdb(this) ? _pdb(this).getStates() : [];
                    return st[0] === 'on' && st[1] === 'on' && st[2] === 'on';
                },
            },
            {
                msg: '2. 在「故障设置」中勾选动力电网绝缘低。',
                mode: 'check',
                op: [
                    { type: 'fault', fault: 'insul_low', msg: '勾选「动力电网绝缘低」并应用', async act() { await _sleep(800); } },
                ],
                check() {
                    const cfg = _sysOf(this).FAULT_CONFIG['insul_low'];
                    return !!(cfg && cfg.check());
                },
            },
            {
                msg: '3. 读数降到约 0.05 MΩ 报警，按「消音」「消闪」。',
                mode: 'check',
                op: [
                    {
                        type: 'observe', target: 'insulmon', part: 'lcd',
                        msg: '看绝缘监视仪：读数下降，声光报警',
                        async act() { await _waitAlarm(this); await _sleep(1400); },
                    },
                    { type: 'btn', target: 'insulmon', part: 'btn-mute', msg: '按「消音」', async act() { await _imPress(this, 'mute'); } },
                    { type: 'btn', target: 'insulmon', part: 'btn-flash', msg: '按「消闪」，灯转常亮', async act() { await _imPress(this, 'flash'); } },
                ],
                check() {
                    const im = _insulMon(this);
                    const cfg = _sysOf(this).FAULT_CONFIG['insul_low'];
                    return !!(im && im.isAlarming() && im.isMuted() && im.isFlashOff() && cfg && cfg.check());
                },
            },
            {
                msg: '4. 按住绝缘指示灯「测试」按钮，三灯亮度不变。',
                mode: 'check',
                op: [
                    {
                        type: 'btn', target: 'insul', part: 'btn',
                        msg: '按住测试按钮，看三灯亮度',
                        async act() { await _insulTestHold(this, 4200); _flag(this, 's4Test', true); },
                    },
                ],
                check() {
                    const insul = _insul(this);
                    return !!(insul && (insul.isButtonClosed() || _flag(this, 's4Test')));
                },
            },
            {
                msg: '5. 取消绝缘低故障，按「复位」解除报警。',
                mode: 'check',
                op: [
                    { type: 'fault', fault: 'insul_low', repair: true, msg: '取消勾选「动力电网绝缘低」并应用', async act() { await _sleep(600); } },
                    {
                        type: 'observe', target: 'insulmon', part: 'lcd',
                        msg: '读数恢复正常（≥ 0.1 MΩ）',
                        async act() { const sys = _sysOf(this); await _waitFor(sys, s => _insulRecovered({ sys: s }), 8000); await _sleep(1000); },
                    },
                    { type: 'btn', target: 'insulmon', part: 'btn-reset', msg: '按「复位」，报警灯熄灭', async act() { await _imPress(this, 'reset'); } },
                ],
                check() {
                    const im = _insulMon(this);
                    const cfg = _sysOf(this).FAULT_CONFIG['insul_low'];
                    return !!(im && !im.isAlarming() && !im.isMuted() && cfg && cfg._pick === null);
                },
            },
            {
                msg: '6. 勾选动力电网接地，读数降到 0，消音消闪。',
                mode: 'check',
                op: [
                    { type: 'fault', fault: 'insul_ground', msg: '勾选「动力电网接地」并应用', async act() { await _sleep(800); } },
                    {
                        type: 'observe', target: 'insulmon', part: 'lcd',
                        msg: '读数为 0 MΩ，再次声光报警',
                        async act() { await _waitAlarm(this); await _sleep(1400); },
                    },
                    { type: 'btn', target: 'insulmon', part: 'btn-mute', msg: '按「消音」', async act() { await _imPress(this, 'mute'); } },
                    { type: 'btn', target: 'insulmon', part: 'btn-flash', msg: '按「消闪」，灯转常亮锁定', async act() { await _imPress(this, 'flash'); } },
                ],
                check() {
                    const im = _insulMon(this);
                    const cfg = _sysOf(this).FAULT_CONFIG['insul_ground'];
                    return !!(im && im.isAlarming() && im.isMuted() && im.isFlashOff() && cfg && cfg.check());
                },
            },
            {
                msg: '7. 再按住「测试」按钮，接地相灯熄灭，其余两相仍亮。',
                mode: 'check',
                op: [
                    {
                        type: 'btn', target: 'insul', part: 'btn',
                        msg: '按住测试按钮，看三灯哪一相熄灭',
                        async act() { await _insulTestHold(this, 5200); _flag(this, 's7Test', true); },
                    },
                ],
                check() {
                    const insul = _insul(this);
                    const cfg = _sysOf(this).FAULT_CONFIG['insul_ground'];
                    return !!(insul && (insul.isButtonClosed() || _flag(this, 's7Test')) && cfg && cfg.check());
                },
            },
            {
                msg: '8. 取消接地故障，按「复位」，报警解除。',
                mode: 'check',
                op: [
                    { type: 'fault', fault: 'insul_ground', repair: true, msg: '取消勾选「动力电网接地」并应用', async act() { await _sleep(600); } },
                    {
                        type: 'observe', target: 'insulmon', part: 'lcd',
                        msg: '读数恢复正常',
                        async act() { const sys = _sysOf(this); await _waitFor(sys, s => _insulRecovered({ sys: s }), 8000); await _sleep(1000); },
                    },
                    { type: 'btn', target: 'insulmon', part: 'btn-reset', msg: '按「复位」，报警灯熄灭', async act() { await _imPress(this, 'reset'); } },
                ],
                check() {
                    const im = _insulMon(this);
                    const cfg = _sysOf(this).FAULT_CONFIG['insul_ground'];
                    return !!(im && !im.isAlarming() && !im.isMuted() && cfg && cfg._pick === null);
                },
            },
            {
                msg: '9. 测试题：绝缘指示灯怎样判断故障相',
                mode: 'quiz',
                quizConfig: {
                    question: '三灯绝缘指示灯正常时三灯亮度相近；某相对地绝缘下降或接地时，该相灯变暗甚至熄灭。判断故障相的依据是？',
                    options: [
                        '灯最亮的那一相是故障相',
                        '灯变暗或熄灭的那一相是故障相',
                        '三灯亮度相同即正常，无法判断',
                        '灯的颜色决定故障相',
                    ],
                    answer: 1,
                    analysis: '三灯经星点接测试按钮再接地，各相对地绝缘与灯串联分压。某相绝缘下降时该相分压减小，灯变暗或熄灭，故变暗相即故障相。',
                },
            },
            {
                msg: '10. 测试题：绝缘监视仪的工作原理',
                mode: 'quiz',
                quizConfig: {
                    question: '绝缘监视仪向电网注入低频测量信号，通过检测泄漏电流换算出绝缘电阻。下列说法正确的是？',
                    options: [
                        '注入信号用于向电网提供有功功率',
                        '泄漏电流越大，绝缘电阻越高',
                        '内部电阻与绝缘电阻串联分压，由泄漏电流换算绝缘电阻',
                        '直接测量电网电压幅值即可判断绝缘',
                    ],
                    answer: 2,
                    analysis: '测量回路为「仪表内阻 + 被测绝缘电阻」串联，绝缘下降则泄漏电流增大、读数降低；低于阈值（如 0.1 MΩ）即声光报警。',
                },
            },
        ],
    },

    // ── 电网绝缘故障的查找（拉电查找法 + 兆欧表复核）──
    'insul-find': {
        id: 'insul-find',
        name: '2. 电网绝缘故障的查找',
        steps: [
            {
                msg: '1. 接线，起动发电机，合闸供电，合上三路负载开关。',
                mode: 'check',
                op: [
                    { type: 'wire', button: 'btnAutoWire', msg: '点击「自动接线」', async act() { await _autoWireBtn(this); } },
                    { type: 'btn', target: 'gen1', part: 'start', msg: '按机旁起动按钮，发电机建压', async act() { await _genStart(this); } },
                    { type: 'btn', target: 'qf1', part: 'handle', msg: '储能不足时按压手柄储能', async act() { await _ensureCharged(this); } },
                    { type: 'btn', target: 'qf1', part: 'btn-close', msg: '按合闸按钮', async act() { await _closeQF(this); } },
                    { type: 'btn', target: 'pdb1', part: 'sw1', msg: '合上开关1', async act() { await _pdbSet(this, 0, true); } },
                    { type: 'btn', target: 'pdb1', part: 'sw2', msg: '合上开关2', async act() { await _pdbSet(this, 1, true); } },
                    { type: 'btn', target: 'pdb1', part: 'sw3', msg: '合上开关3', async act() { await _pdbSet(this, 2, true); } },
                ],
                check() {
                    const sys = _sysOf(this);
                    if (!_wired(sys, 'gen1_wire_u', 'qf1_wire_t1')) return false;
                    const gen = _comp(sys, 'gen1');
                    if (!gen || !gen.isOn) return false;
                    const qf = _qf(this);
                    if (!qf || qf.getState() !== 'on') return false;
                    const st = _pdb(this) ? _pdb(this).getStates() : [];
                    return st[0] === 'on' && st[1] === 'on' && st[2] === 'on';
                },
            },
            {
                msg: '2. 在「故障设置」中勾选动力电网绝缘低。',
                mode: 'check',
                op: [
                    { type: 'fault', fault: 'insul_low', msg: '勾选「动力电网绝缘低」并应用', async act() { await _sleep(800); } },
                ],
                check() {
                    const cfg = _sysOf(this).FAULT_CONFIG['insul_low'];
                    return !!(cfg && cfg.check());
                },
            },
            {
                msg: '3. 按「消音」「消闪」，报警灯转常亮。',
                mode: 'check',
                op: [
                    { type: 'observe', target: 'insulmon', part: 'lcd', msg: '等读数下降、进入报警', async act() { await _waitAlarm(this); await _sleep(1000); } },
                    { type: 'btn', target: 'insulmon', part: 'btn-mute', msg: '按「消音」', async act() { await _imPress(this, 'mute'); } },
                    { type: 'btn', target: 'insulmon', part: 'btn-flash', msg: '按「消闪」', async act() { await _imPress(this, 'flash'); } },
                ],
                check() {
                    const im = _insulMon(this);
                    const cfg = _sysOf(this).FAULT_CONFIG['insul_low'];
                    return !!(im && im.isAlarming() && im.isMuted() && im.isFlashOff() && cfg && cfg.check());
                },
            },
            {
                msg: '4. 逐路拉开关，读数恢复的那一路即故障支路。',
                mode: 'check',
                op: [
                    {
                        type: 'switch', target: 'pdb1', part: 'sw1', msg: '拉开开关1，看读数',
                        async act() {
                            if (_insulRecovered(this)) { await this._tipWorkflow('读数已恢复：故障在开关1 这一路', 2400); await _sleep(1600); return; }
                            await _pdbSet(this, 0, false);
                            await _sleep(1800);
                        },
                    },
                    {
                        type: 'switch', target: 'pdb1', part: 'sw2', msg: '拉开开关2，看读数',
                        async act() {
                            if (_insulRecovered(this)) { await this._tipWorkflow('读数已恢复：故障在开关2 这一路', 2400); await _sleep(1600); return; }
                            await _pdbSet(this, 1, false);
                            await _sleep(1800);
                        },
                    },
                    {
                        type: 'switch', target: 'pdb1', part: 'sw3', msg: '拉开开关3，读数恢复',
                        async act() {
                            if (_insulRecovered(this)) { await this._tipWorkflow('读数已恢复：故障在开关3 这一路', 2400); await _sleep(1600); return; }
                            await _pdbSet(this, 2, false);
                            await _sleep(1800);
                        },
                    },
                ],
                check() {
                    const cfg = _sysOf(this).FAULT_CONFIG['insul_low'];
                    const pdb = _pdb(this);
                    if (!cfg || !cfg._pick || !pdb) return false;
                    const faultLd = cfg._pick.ld;
                    return !pdb.isClosed(faultLd) && _insulRecovered(this);
                },
            },
            {
                msg: '5. 挂牌，用兆欧表测量故障负载绝缘（约 0.05 MΩ）。',
                mode: 'check',
                op: [
                    { type: 'observe', target: 'pdb1', msg: '挂上「禁止合闸，有人工作」检修牌', async act() { await _sleep(1600); } },
                    { type: 'instrument', instrument: 'megohm', msg: '选择仪表：勾选手摇兆欧表', async act() { await _sleep(800); } },
                    {
                        type: 'observe', target: 'megohm',
                        get ports() { return ['megohm_wire_l', _faultLoadPort(window.sys)]; },
                        msg: 'L 端接故障负载的一相端子',
                        async act() { const sys = _sysOf(this); await _wire(sys, 'megohm_wire_l', _faultLoadPort(sys)); },
                    },
                    {
                        type: 'observe', target: 'megohm', ports: ['megohm_wire_e', 'gnd_l_wire_gnd'],
                        msg: 'E 端接船体地',
                        async act() { const sys = _sysOf(this); await _wire(sys, 'megohm_wire_e', 'gnd_l_wire_gnd'); },
                    },
                    {
                        type: 'btn', target: 'megohm', part: 'crank',
                        msg: '摇动手柄，读数稳定在约 0.05 MΩ',
                        async act() { await _mgCrank(this, true, r => isFinite(r) && r < 0.5, 30000); },
                    },
                ],
                check() {
                    const sys = _sysOf(this);
                    const mg = _mg(this);
                    if (!mg || !mg.group || !mg.group.visible()) return false;
                    if (!(mg.isCranking && mg.isCranking())) return false;
                    if (!_mgOn(sys, _faultLoadPort(this), 'gnd_l_wire_gnd')) return false;
                    const r = mg.getResistance();
                    return isFinite(r) && r < 0.5;
                },
            },
            {
                msg: '6. 取消故障，合回三路开关，按「复位」。',
                mode: 'check',
                op: [
                    { type: 'fault', fault: 'insul_low', repair: true, msg: '取消勾选「动力电网绝缘低」并应用', async act() { await _sleep(600); } },
                    { type: 'observe', target: 'megohm', msg: '停摇、拆表笔、收起兆欧表', async act() { await _putAwayInstrument(this, 'megohm'); } },
                    { type: 'btn', target: 'pdb1', part: 'sw1', msg: '合回开关1', async act() { await _pdbSet(this, 0, true); } },
                    { type: 'btn', target: 'pdb1', part: 'sw2', msg: '合回开关2', async act() { await _pdbSet(this, 1, true); } },
                    { type: 'btn', target: 'pdb1', part: 'sw3', msg: '合回开关3', async act() { await _pdbSet(this, 2, true); } },
                    {
                        type: 'btn', target: 'insulmon', part: 'btn-reset', msg: '按「复位」，报警解除',
                        async act() { const sys = _sysOf(this); await _waitFor(sys, s => _insulRecovered({ sys: s }), 8000); await _imPress(this, 'reset'); },
                    },
                ],
                check() {
                    const im = _insulMon(this);
                    const cfg = _sysOf(this).FAULT_CONFIG['insul_low'];
                    const st = _pdb(this) ? _pdb(this).getStates() : [];
                    return !!(im && !im.isAlarming() && !im.isMuted() && cfg && cfg._pick === null
                        && st[0] === 'on' && st[1] === 'on' && st[2] === 'on');
                },
            },
            {
                msg: '7. 测试题：多支路负载的绝缘故障查找方法',
                mode: 'quiz',
                quizConfig: {
                    question: '某路负载由多个支路组成、各支路分别经开关供电。确定具体故障支路的方法是？',
                    options: [
                        '逐段测量电流的「电流分析法」',
                        '逐支路拉闸、观察绝缘监视仪读数是否恢复的「拉电查找法」',
                        '将所有支路同时断电后重新合闸',
                        '拆开所有接线逐一目测',
                    ],
                    answer: 1,
                    analysis: '依次断开某一支路开关，读数恢复即说明故障在该支路；未恢复则继续下一支路，可快速缩小范围。',
                },
            },
            {
                msg: '8. 测试题：动力电网与照明电网查找的区别',
                mode: 'quiz',
                quizConfig: {
                    question: '查找动力电网与照明电网的绝缘故障时，操作上的主要区别是？',
                    options: [
                        '两者都是直接拉开关',
                        '照明电网可直接拉照明开关断电查找；动力电网负载是电动机，应先停机再操作',
                        '动力电网可直接带电机拉开关，照明电网必须停电机',
                        '两者操作方法完全相同',
                    ],
                    answer: 1,
                    analysis: '照明支路可直接拉开关分段排查；动力负载为电动机，带载拉闸会产生较大工况冲击与电弧，应先停机使其断电再查找。',
                },
            },
        ],
    },
};

export const componentConfigs = [
    // ── 主回路：同步发电机 → 主开关 → 汇流排 ──
    { Class: SyncGenerator3P, id: 'gen1', x: -60, y: 700, vRms: 230, freq: 50, isOn: false, label: '同步发电机', ratedPower: 80, ratedVoltage: 80, ratedCosPhi: 0.8, rOn: 0.05, avrDelay: 3, avrTime: 5, maxDropV: 80, avrMaxComp: 1, visible: true },
    { Class: MarineMainsSwitch, id: 'qf1', x: -150, y: 220, ratedCtrlVoltage: 24, label: '主开关',  visible: true },
    // ── 控制端子共用地 ──
    // 主开关线圈（储能电机 m / 合闸 c / 失压 uv / 分励 fl）的负极公共接地
    { Class: Ground, id: 'gnd_qf', x: 460, y: 580, visible: true },
    // 直流 24V 电源负极接地
    { Class: Ground, id: 'gnd_dc', x: 1080, y: 420, visible: true },
    // 主开关控制按钮：停止按钮（红、NC）、起动按钮（绿、NO）与合闸按钮（绿、NO）
    { Class: DiagramStopButton, id: 'sb', x: 680, y: 360, label: '模拟失压', visible: true },
    { Class: DiagramStartButton, id: 'ss', x: 760, y: 440, label: '分闸', visible: true },
    { Class: DiagramStartButton, id: 'sc', x: 600, y: 280, label: '合闸', visible: true },
    { Class: Busbar3P, id: 'bus1', x: 220, y: 30, portsPerBar: 8, label: '汇流排', visible: true },

    // ── 控制电源（DC 24V）：失压脱扣线圈 ──
    { Class: DCPower, id: 'dc_uv', x: 980, y: 150, voltage: 24, isOn: true, label: '失压脱扣电源', visible: true },

    // ── 汇流排馈出支路 ──
    // 支路1：配电箱开关1 → 三相感应电机（Y 接法）
    { Class: InductionMotor2, id: 'im01', x: 1080, y: 730, visible: true,
        R1: 0.50, Lsigma1: 0.00334, Rc: 300, Lm: 0.0796,
        R2: 0.46, Lsigma2: 0.00334,
        J: 0.12, B: 0.01, polePairs: 2,
        ratedPower: 10, ratedSpeed: 1440,
        simpleModel: true, loadTorque: 20 },
    // 支路2：配电箱开关2 → 三盏白炽灯（分别接 L1/L2/L3，r 端星形互联后接地）
    { Class: IncandescentLamp, id: 'lamp1', x: 1330, y: 770, coldResistance: 4.84, rotation: 90 },
    { Class: IncandescentLamp, id: 'lamp2', x: 1400, y: 770, coldResistance: 4.84, rotation: 90 },
    { Class: IncandescentLamp, id: 'lamp3', x: 1470, y: 770, coldResistance: 4.84, rotation: 90 },
    { Class: Ground, id: 'gnd_l', x: 800, y: 990, visible: true },

    // 支路3：配电箱开关3 → 三相可调负载（星形，中性点 n 接地）
    { Class: ThreePhaseLoad, id: 'tload', x: 1500, y: 650, powerKw: 20, cosPhi: 1, reactive: 'ind', loaded: false, label: '三相可调负载', visible: true },

    { Class: Multimeter, id: 'multimeter', x: 820, y: 100, visible: false },
    { Class: MF47Multimeter, id: 'mf47-panel', x: 950, y: 150, visible: false },
    { Class: Oscilloscope_tri, id: 'osc', x: -50, y: 50, visible: false },
    { Class: SignalGenerator, id: 'sg', x: -50, y: 50, visible: false },
    { Class: ProcessCalibrator, id: 'cali', x: -50, y: 50, visible: false },
    { Class: ElecMeter, id: 'elecmeter', x: -50, y: 50, visible: false },
    // ── 手摇兆欧表：联动绝缘指示灯模式（不显示实测值，按 L 端接点映射绝缘读数）──
    { Class: RealMegohmMeter, id: 'megohm', x: 1420, y: 700, label: '手摇兆欧表',
        insulSync: true, visible: false },

    // ── 低压三相配电箱（汇流排供电，出线接电机与照明）──
    { Class: DistributionBox, id: 'pdb1', x: 1200, y: 190, label: '低压配电箱', ratedCurrent: 100, shortDelay: 0.2, overloadK: 4, tripCoilR: 200, initStates: ['off', 'off', 'off'], visible: true },

    // ── 船舶三灯绝缘指示灯（检测母线各相对船体绝缘）──
    // loadInsul: 3 路负载（电机/照明/可调负载）× 3 相（A/B/C）绝缘电阻（Ω）
    { Class: InsulationIndicator, id: 'insul', x: 400, y: 620, label: '绝缘指示灯',
        loadInsul: [[100e6, 100e6, 100e6], [100e6, 100e6, 100e6], [100e6, 100e6, 100e6]],
        lampOK: [true, true, true], visible: true },

    // ── 绝缘监视仪（读取绝缘指示灯三相等效值，<0.1MΩ 声光报警）──
    { Class: InsulationMonitor, id: 'insulmon', x: 720, y: 580, label: '绝缘监视仪',
        alarmThreshold: 0.1, insulSourceId: 'insul', visible: true },
];

// ─── 接线辅助 ───

function _autoWire(sys) {
    sys.conns.length = 0;
    const cons = [
        // ── 主回路：同步发电机 → 主开关 → 汇流排 ──
        { from: 'gen1_wire_u', to: 'qf1_wire_t1', type: 'wire' },
        { from: 'gen1_wire_v', to: 'qf1_wire_t2', type: 'wire' },
        { from: 'gen1_wire_w', to: 'qf1_wire_t3', type: 'wire' },
        { from: 'qf1_wire_l1', to: 'bus1_wire_l1_1', type: 'wire' },
        { from: 'qf1_wire_l2', to: 'bus1_wire_l2_1', type: 'wire' },
        { from: 'qf1_wire_l3', to: 'bus1_wire_l3_1', type: 'wire' },
        // 直流 24V 电源负极接地
        { from: 'dc_uv_wire_n', to: 'gnd_dc_wire_gnd', type: 'wire' },
        // ── 支路：配电箱进线（汇流排三相）→ 开关1→电机、开关2→照明 ──
        { from: 'bus1_wire_l1_8', to: 'pdb1_wire_in1', type: 'wire' },
        { from: 'bus1_wire_l2_8', to: 'pdb1_wire_in2', type: 'wire' },
        { from: 'bus1_wire_l3_8', to: 'pdb1_wire_in3', type: 'wire' },
        // 开关1 → 感应电机（Y 接法）
        { from: 'pdb1_wire_sw1_t1', to: 'im01_wire_u1', type: 'wire' },
        { from: 'pdb1_wire_sw1_t2', to: 'im01_wire_v1', type: 'wire' },
        { from: 'pdb1_wire_sw1_t3', to: 'im01_wire_w1', type: 'wire' },
        { from: 'im01_wire_u2', to: 'im01_wire_v2', type: 'wire' },
        { from: 'im01_wire_v2', to: 'im01_wire_w2', type: 'wire' },
        // 开关2 → 三盏白炽灯（L1/L2/L3 各一），r 端星形互联（不接地，浮空星点）
        { from: 'pdb1_wire_sw2_t1', to: 'lamp1_wire_l', type: 'wire' },
        { from: 'pdb1_wire_sw2_t2', to: 'lamp2_wire_l', type: 'wire' },
        { from: 'pdb1_wire_sw2_t3', to: 'lamp3_wire_l', type: 'wire' },
        // 三盏白炽灯中性点星形连接：r 端互联（不接地，配合绝缘指示灯形成对地绝缘检测回路）
        { from: 'lamp1_wire_r', to: 'lamp2_wire_r', type: 'wire' },
        { from: 'lamp2_wire_r', to: 'lamp3_wire_r', type: 'wire' },
        // 开关3 → 三相可调负载（星形，中性点 n 不接地）
        { from: 'pdb1_wire_sw3_t1', to: 'tload_wire_l1', type: 'wire' },
        { from: 'pdb1_wire_sw3_t2', to: 'tload_wire_l2', type: 'wire' },
        { from: 'pdb1_wire_sw3_t3', to: 'tload_wire_l3', type: 'wire' },
        // ── 绝缘指示灯：三相并联母线（=下缘取用 l1_4/l2_4/l3_4），地端口经内部常开检测按钮接船体地 ──
        { from: 'bus1_wire_l1_4', to: 'insul_wire_l1', type: 'wire' },
        { from: 'bus1_wire_l2_4', to: 'insul_wire_l2', type: 'wire' },
        { from: 'bus1_wire_l3_4', to: 'insul_wire_l3', type: 'wire' },
        { from: 'insul_wire_gnd', to: 'gnd_l_wire_gnd', type: 'wire' },
        // ── 绝缘监视仪：顶部三相端口并联母线（与绝缘指示灯同 tap），底部地端口接船体地 ──
        { from: 'bus1_wire_l1_4', to: 'insulmon_wire_l1', type: 'wire' },
        { from: 'bus1_wire_l2_4', to: 'insulmon_wire_l2', type: 'wire' },
        { from: 'bus1_wire_l3_4', to: 'insulmon_wire_l3', type: 'wire' },
        { from: 'insulmon_wire_gnd', to: 'gnd_l_wire_gnd', type: 'wire' },
        // ── 控制回路：DC 24V 正极 → 停止按钮 SB1（常闭 NC）→ 失压脱扣线圈 uv → 公共地
        //    停止按钮用于正常停机：按下断开 → 失压线圈断电 → 主开关分闸
        { from: 'dc_uv_wire_p', to: 'sb_wire_nc4', type: 'wire' },
        { from: 'sb_wire_nc3', to: 'qf1_wire_uv1', type: 'wire' },
        { from: 'qf1_wire_uv2', to: 'gnd_qf_wire_gnd', type: 'wire' },
        // ── 控制回路：DC 24V 正极 → 起动按钮 SB2（常开 NO）→ 分励脱扣线圈 fl → 公共地
        //    按下起动按钮（闭合）→ 分励线圈得电 → 主开关分闸
        { from: 'dc_uv_wire_p', to: 'ss_wire_no2', type: 'wire' },
        { from: 'ss_wire_no1', to: 'qf1_wire_fla', type: 'wire' },
        { from: 'qf1_wire_flb', to: 'gnd_qf_wire_gnd', type: 'wire' },
        // ── 控制回路：DC 24V 正极 → 合闸按钮 SB3（常开 NO）→ 合闸线圈 c1 → 公共地 ──
        //    按下合闸按钮（闭合）→ 合闸线圈得电 → 主开关合闸
        { from: 'dc_uv_wire_p', to: 'sc_wire_no2', type: 'wire' },
        { from: 'sc_wire_no1', to: 'qf1_wire_c1', type: 'wire' },
        // ── 储能电机电源：DC 24V 正极 → 主开关储能电机（m1/m2），负极 → 公共地 ──
        { from: 'dc_uv_wire_p', to: 'qf1_wire_m1', type: 'wire' },
        { from: 'qf1_wire_m2', to: 'gnd_qf_wire_gnd', type: 'wire' },
        // ── 主开关合闸线圈负极 → 公共地 ──
        { from: 'qf1_wire_c2', to: 'gnd_qf_wire_gnd', type: 'wire' },
    ];
    cons.forEach(c => sys.connMgr.addConn(c));
    sys.redrawAll();
}

export function initSlider(_sys) {
}

export function applyAllPresets(opts) {
    if (opts && opts.init) return;   // 初始化不预接线（默认空画布）
    const sys = this && this.sys ? this.sys : window.sys;
    if (!sys) return;
    _autoWire(sys);
}

export async function applyStartSystem() {
    const sys = this && this.sys ? this.sys : window.sys;
    if (!sys) return;
    _autoWire(sys);
    // 起动发电机
    const gen = sys.comps.gen1;
    if (gen) gen.isOn = true;
}

export function fiveStep() {
}
