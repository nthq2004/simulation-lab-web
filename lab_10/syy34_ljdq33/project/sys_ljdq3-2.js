// 船舶发电机主开关保护仿真工程（同步发电机 + 主开关 + 汇流排 + 低压配电箱 + 电子脱扣器）
//
// 电路组成：
//   主回路  gen1（同步发电机）—[第3相串 et1 电流采样]→ qf1 主触头 → bus1 汇流排
//           bus1 第8列 → pdb1 低压配电箱（三路塑壳开关）
//             sw1 → im01 三相异步电机（Y 接法）
//             sw2 → lamp1~3 三盏白炽灯（星形中性点接地）
//             sw3 → tload 三相可调负载（星形，中性点接地）
//   控制回路 dc_uv（DC 24 V）→ sb「模拟失压」（常闭）→ 失压线圈 uv
//                            → sc「合闸」（常开）→ 合闸线圈 c
//                            → ss「分闸」（常开）→ 分励线圈 fl
//                            → 储能电机 m1/m2
//   保护回路 et1 电子脱扣器：电流采样 I+/I-、电压采样 U+/U-、24 V 供电 vp/vn、
//                            脱扣输出 t1/t2 → 主开关 et 线圈、
//                            过载分级卸载输出 f1a/f1b → pdb1 sw1 分励线圈、
//                                               f2a/f2b → pdb1 sw2 分励线圈
//
// 约定（与全局 AGENTS.md「最新范式」一致）：
//   · 单页工程：不导出 PROJECT_PAGES，consys.js 不创建 PageManager，工作流无 page op
//   · 默认不接线：applyAllPresets({ init:true }) 直接返回；只有「自动接线 / 起动系统 / 工作流 op」才接线
//   · 故障一律走「故障设置」界面（op.type='fault'），不直接调 FAULT_CONFIG[...].trigger()
//   · 仪表一律走「选择仪表」界面（op.type='instrument'），表笔用动画接线（约 3 s/根）
//   · 参数（可调负载功率 / 加载状态）一律走参数配置界面（_setTload + 真正点击「保存」）
//   · 按钮/手柄/开关一律模拟真实点击（getClickablePartNode(...).fire('click'/'mousedown')）
//   · 等待一律用条件轮询 _waitFor，不写死 sleep 猜时间

import { SyncGenerator3P } from '../components/SyncGenerator3P.js';
import { Busbar3P } from '../components/Busbar3P.js';
import { MarineMainsSwitch } from '../components/MarineMainsSwitch.js';
import { MarineElectronicTrip } from '../components/MarineElectronicTrip.js';
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

// ═══════════════════════════════════════════════════════════════
// 一、故障设置（4 类，全部由「故障设置」界面勾选后应用）
//   1. 主汇流排短路   ：汇流排第 7 对三相触点强制合为一簇（相间短路）
//   2. 重要负载短路   ：三相可调负载三个输入端子强制合为一簇（负载支路短路）
//   3. 调速器故障     ：原动机转速下降 → 频率 25 Hz、线电压 280 V（f、U 同时偏低）
//   4. 调压器故障     ：AVR 失效 → 线电压 200 V（频率正常、仅电压偏低）
// ═══════════════════════════════════════════════════════════════

const _faultSys = () => window.sys;

export const FAULT_CONFIGS = {
    // ── 1. 主汇流排短路：汇流排第 7 对三相触点（L1/L2/L3）强制合为一簇 ──
    bus_short: {
        id: 'bus_short', name: '1. 主汇流排短路', system: '汇流排',
        check() {
            const s = _faultSys();
            return !!(s && s._faultShortGroups && s._faultShortGroups.some(g => g[0] === 'bus1_wire_l1_7'));
        },
        trigger() {
            const s = _faultSys();
            if (!s) return;
            if (!s._faultShortGroups) s._faultShortGroups = [];
            const g = ['bus1_wire_l1_7', 'bus1_wire_l2_7', 'bus1_wire_l3_7'];
            s._faultShortGroups = s._faultShortGroups.filter(x => x[0] !== g[0]);
            s._faultShortGroups.push(g);
        },
        repair() {
            const s = _faultSys();
            if (!s || !s._faultShortGroups) return;
            s._faultShortGroups = s._faultShortGroups.filter(x => x[0] !== 'bus1_wire_l1_7');
        },
    },
    // ── 2. 重要负载短路：三相可调负载三个输入端口强制合为一簇 ──
    tload_short: {
        id: 'tload_short', name: '2. 重要负载短路', system: '三相可调负载',
        check() {
            const s = _faultSys();
            return !!(s && s._faultShortGroups && s._faultShortGroups.some(g => g[0] === 'tload_wire_l1'));
        },
        trigger() {
            const s = _faultSys();
            if (!s) return;
            if (!s._faultShortGroups) s._faultShortGroups = [];
            const g = ['tload_wire_l1', 'tload_wire_l2', 'tload_wire_l3'];
            s._faultShortGroups = s._faultShortGroups.filter(x => x[0] !== g[0]);
            s._faultShortGroups.push(g);
        },
        repair() {
            const s = _faultSys();
            if (!s || !s._faultShortGroups) return;
            s._faultShortGroups = s._faultShortGroups.filter(x => x[0] !== 'tload_wire_l1');
        },
    },
    // ── 3. 1# 发电机调速器故障：频率降到 25 Hz，线电压降到 280 V ──
    gen_governor_fault: {
        id: 'gen_governor_fault', name: '3. 1#发电机调速器故障', system: '同步发电机',
        check() {
            const c = window.sys && window.sys.comps && window.sys.comps.gen1;
            return !!(c && c._faultGovernor);
        },
        trigger() {
            const c = window.sys && window.sys.comps && window.sys.comps.gen1;
            if (c) { c._faultGovernor = true; c._faultAVR = false; }
        },
        repair() {
            const c = window.sys && window.sys.comps && window.sys.comps.gen1;
            if (c) c._faultGovernor = false;
        },
    },
    // ── 4. 1# 发电机调压器（AVR）故障：线电压降到 200 V，频率正常 ──
    gen_avr_fault: {
        id: 'gen_avr_fault', name: '4. 1#发电机调压器故障', system: '同步发电机',
        check() {
            const c = window.sys && window.sys.comps && window.sys.comps.gen1;
            return !!(c && c._faultAVR);
        },
        trigger() {
            const c = window.sys && window.sys.comps && window.sys.comps.gen1;
            if (c) { c._faultAVR = true; c._faultGovernor = false; }
        },
        repair() {
            const c = window.sys && window.sys.comps && window.sys.comps.gen1;
            if (c) c._faultAVR = false;
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
const _et = (ctx) => _comp(_sysOf(ctx), 'et1');
const _mg = (ctx) => _comp(_sysOf(ctx), 'megohm');
const _tload = (ctx) => _comp(_sysOf(ctx), 'tload');

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

/** 拆除一对端口之间的导线 */
function _unwire(sys, a, b) {
    if (!sys || !Array.isArray(sys.conns)) return;
    sys.conns
        .filter(c => c && c.type === 'wire' && ((c.from === a && c.to === b) || (c.from === b && c.to === a)))
        .forEach(c => sys.connMgr.removeConn(c));
    if (sys.redrawAll) sys.redrawAll();
}

/** 拆掉仪表表笔（兆欧表 / 万用表） */
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
        if (!_firePart(mg, 'crank', 'click')) mg.setCranking(false);
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
        if (!_firePart(qf, 'btn-close', 'click')) qf.tryClose && qf.tryClose();
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

/** 电子脱扣器脱扣后复位（真实点击面板「复位」按钮） */
async function _etReset(ctx) {
    const et = _et(ctx);
    if (!et) return;
    if (!_firePart(et, 'reset', 'click') && typeof et.reset === 'function') et.reset();
    await _sleep(600);
}

/** 按下发电机机旁起动按钮（真实 mousedown），等发电机建压 */
async function _genStart(ctx) {
    const sys = _sysOf(ctx);
    const gen = _comp(sys, 'gen1');
    if (!gen) return;
    if (!gen.isOn) {
        if (!_pressPart(gen, 'start', 300)) {
            console.warn('[主开关] 未取到发电机起动按钮节点，兜底置位');
            gen.isOn = true;
        }
        await _waitFor(sys, s => { const g = _comp(s, 'gen1'); return g && g.isOn; }, 4000);
    }
    await _sleep(800);
}

/**
 * 通过「参数配置界面」改可调负载参数（统一规范，禁止直接改内部字段）：
 *   ① 弹框前把组件实时属性同步进 config 副本（否则「保存」会把旧值一并回写）
 *   ② comp.showConfigDialog() 弹出参数设置界面
 *   ③ 取 #diag_<key> 控件 → 闪烁箭头高亮 + 填入新值
 *   ④ 取最后打开的对话框的「保存」按钮 → 闪烁箭头高亮 + 真正 click() 按下
 *   ⑤ 确认对话框已关闭；参数未生效则调 onConfigUpdate 兜底
 */
async function _setTload(ctx, patch, tip) {
    const comp = _tload(ctx);
    if (!comp || typeof comp.showConfigDialog !== 'function') return;
    // ① 同步实时属性 → config 副本
    (comp.getConfigFields ? comp.getConfigFields() : []).forEach(f => {
        if (f.get) return;
        try { const live = comp[f.key]; if (live !== undefined) comp.config[f.key] = live; } catch (e) { /* 只读属性忽略 */ }
    });
    comp.showConfigDialog();                       // ② 弹出参数设置界面
    await _sleep(700);

    // ③ 高亮控件并填值
    for (const key of Object.keys(patch)) {
        const el = document.getElementById('diag_' + key);
        if (!el) continue;
        if (typeof ctx._flashDomElement === 'function') {
            await ctx._flashDomElement(el, tip || `把该参数改为 ${patch[key]}`, 1800);
        }
        el.value = String(patch[key]);
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
    }

    // ④ 高亮并真正按下「保存」（对话框按打开顺序追加，取最后一个）
    const saveBtns = [...document.querySelectorAll('button')].filter(b => b.textContent.trim() === '保存');
    const saveBtn = saveBtns[saveBtns.length - 1];
    if (saveBtn) {
        if (typeof ctx._flashDomElement === 'function') await ctx._flashDomElement(saveBtn, '点击「保存」确认参数修改', 1600);
        saveBtn.click();
        await _sleep(600);
    }

    // ⑤ 确认对话框已关闭
    const still = document.getElementById('diag_' + Object.keys(patch)[0]);
    if (still && still.offsetParent !== null) {
        const closeBtn = [...document.querySelectorAll('button')].find(b => /^(关闭|取消)$/.test(b.textContent.trim()));
        if (closeBtn) closeBtn.click();
        await _sleep(400);
    }

    // 生效兜底：避免演示中断
    if (patch.powerKw !== undefined && Math.abs(parseFloat(comp.powerKw) - parseFloat(patch.powerKw)) > 0.5) {
        if (typeof comp.onConfigUpdate === 'function') comp.onConfigUpdate(patch);
    }
    if (patch.loaded !== undefined && typeof comp.isLoaded === 'function'
        && String(comp.isLoaded()) !== String(patch.loaded)) {
        if (typeof comp.onConfigUpdate === 'function') comp.onConfigUpdate(patch);
    }
    await _sleep(800);
}

/** 兆欧表摇动（真实点击手摇柄），并按条件等读数稳定 */
async function _mgCrank(ctx, on, cond, timeout = 6000, interval = 100) {
    const sys = _sysOf(ctx);
    const mg = _mg(ctx);
    if (!mg) return false;
    const cur = mg.isCranking ? mg.isCranking() : false;
    if (cur !== !!on) {
        if (!_firePart(mg, 'crank', 'click')) mg.setCranking(on);
        await _sleep(400);
    }
    await _waitFor(sys, () => {
        if (!cond) return true;
        const r = mg.getResistance();
        return cond(r);
    }, timeout, interval);
    await _sleep(600);
    return !!cond;
}

/** 兆欧表读数（MΩ） */
function _mgR(ctx) {
    const mg = _mg(ctx);
    return mg ? mg.getResistance() : NaN;
}

/** 兆欧表 L/E 是否已按预期接到指定端口簇内 */
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

/** 自动接线（工具栏按钮真实点击） */
async function _autoWireBtn(ctx) {
    const sys = _sysOf(ctx);
    const btn = document.getElementById('btnAutoWire');
    if (btn && typeof btn.onclick === 'function') btn.click();
    else if (sys && typeof sys.applyAllPresets === 'function') sys.applyAllPresets();
    await _sleep(1200);
}

// ═══════════════════════════════════════════════════════════════
// 三、工作流
// ═══════════════════════════════════════════════════════════════

export const PROJECT_WORKFLOWS = {
    'short-fault-detect': {
        id: 'short-fault-detect',
        name: '1. 发电机短路故障的判断和排除',
        steps: [
            {
                msg: '1. 自动接线，起动发电机，合闸供电，合上三路负载开关。',
                mode: 'check',
                op: [
                    { type: 'wire', button: 'btnAutoWire', msg: '点击「自动接线」', async act() { await _autoWireBtn(this); } },
                    { type: 'btn', target: 'gen1', part: 'start', msg: '按机旁起动按钮，发电机建压', async act() { await _genStart(this); } },
                    { type: 'btn', target: 'qf1', part: 'handle', msg: '等储能储满（不足则按压手柄 5 次）', async act() { await _ensureCharged(this); } },
                    { type: 'btn', target: 'qf1', part: 'btn-close', msg: '按手动合闸按钮，主触头闭合', async act() { await _closeQF(this); } },
                    { type: 'btn', target: 'pdb1', part: 'sw1', msg: '合上开关1（动力负载）', async act() { await _pdbSet(this, 0, true); } },
                    { type: 'btn', target: 'pdb1', part: 'sw2', msg: '合上开关2（照明负载）', async act() { await _pdbSet(this, 1, true); } },
                    { type: 'btn', target: 'pdb1', part: 'sw3', msg: '合上开关3（可调负载）', async act() { await _pdbSet(this, 2, true); } },
                ],
                check() {
                    const sys = _sysOf(this);
                    if (!_wired(sys, 'gen1_wire_u', 'qf1_wire_t1')) return false;
                    if (!_wired(sys, 'qf1_wire_l1', 'bus1_wire_l1_1')) return false;
                    if (!_wired(sys, 'bus1_wire_l1_8', 'pdb1_wire_in1')) return false;
                    const gen = _comp(sys, 'gen1');
                    if (!gen || !gen.isOn) return false;
                    const qf = _qf(this);
                    if (!qf || qf.getState() !== 'on') return false;
                    const pdb = _pdb(this);
                    const st = pdb ? pdb.getStates() : [];
                    return st[0] === 'on' && st[1] === 'on' && st[2] === 'on';
                },
            },
            {
                msg: '2. 在「故障设置」中勾选主汇流排短路。',
                mode: 'check',
                op: [
                    { type: 'fault', fault: 'bus_short', msg: '勾选「1. 主汇流排短路」并应用', async act() { await _sleep(800); } },
                ],
                check() {
                    const cfg = _sysOf(this).FAULT_CONFIG['bus_short'];
                    return !!(cfg && cfg.check());
                },
            },
            {
                msg: '3. 观察脱扣器显示短路，主开关跳闸。',
                mode: 'check',
                op: [
                    {
                        type: 'observe', target: 'et1', part: 'lcd',
                        msg: '看电子脱扣器：短路脱扣、电流很大',
                        async act() { await _sleep(1500); },
                    },
                    {
                        type: 'observe', target: 'qf1', part: 'main-contact',
                        msg: '主触头分断，汇流排失电',
                        async act() {
                            const sys = _sysOf(this);
                            await _waitFor(sys, s => {
                                const q = _comp(s, 'qf1');
                                return q && q.getState() === 'off';
                            }, 15000);
                            await _sleep(1200);
                        },
                    },
                ],
                check() {
                    const qf = _qf(this);
                    const et = _et(this);
                    return !!(qf && qf.getState() === 'off' && et && et.isTripped()
                        && String(et._tripReason || '').includes('短路'));
                },
            },
            {
                msg: '4. 断开三路负载开关，隔离负载回路。',
                mode: 'check',
                op: [
                    { type: 'switch', target: 'pdb1', part: 'sw1', msg: '拉开开关1', async act() { await _pdbSet(this, 0, false); } },
                    { type: 'switch', target: 'pdb1', part: 'sw2', msg: '拉开开关2', async act() { await _pdbSet(this, 1, false); } },
                    { type: 'switch', target: 'pdb1', part: 'sw3', msg: '拉开开关3', async act() { await _pdbSet(this, 2, false); } },
                ],
                check() {
                    const pdb = _pdb(this);
                    const st = pdb ? pdb.getStates() : [];
                    return st[0] === 'off' && st[1] === 'off' && st[2] === 'off';
                },
            },
            {
                msg: '5. 用兆欧表测量干线绝缘：短路段读数为 0。',
                mode: 'check',
                op: [
                    { type: 'instrument', instrument: 'megohm', msg: '选择仪表：勾选手摇兆欧表', async act() { await _sleep(800); } },
                    {
                        type: 'observe', target: 'megohm', ports: ['megohm_wire_l', 'bus1_wire_l1_2'],
                        msg: 'L 端接汇流排 L1 端子',
                        async act() { await _wire(_sysOf(this), 'megohm_wire_l', 'bus1_wire_l1_2'); },
                    },
                    {
                        type: 'observe', target: 'megohm', ports: ['megohm_wire_e', 'bus1_wire_l2_2'],
                        msg: 'E 端接汇流排 L2 端子',
                        async act() { await _wire(_sysOf(this), 'megohm_wire_e', 'bus1_wire_l2_2'); },
                    },
                    {
                        type: 'btn', target: 'megohm', part: 'crank',
                        msg: '摇动手柄，读数降到 0 MΩ',
                        async act() { await _mgCrank(this, true, r => isFinite(r) && r < 0.2, 12000); },
                    },
                ],
                check() {
                    const sys = _sysOf(this);
                    const mg = _mg(this);
                    if (!mg || !mg.group || !mg.group.visible()) return false;
                    if (!(mg.isCranking && mg.isCranking())) return false;
                    if (!_mgOn(sys, 'bus1_wire_l1_2', 'bus1_wire_l2_2')) return false;
                    const r = mg.getResistance();
                    return isFinite(r) && r < 0.5;
                },
            },
            {
                msg: '6. 取消短路故障，复位脱扣器，合闸恢复供电。',
                mode: 'check',
                op: [
                    { type: 'fault', fault: 'bus_short', repair: true, msg: '取消勾选「1. 主汇流排短路」并应用', async act() { await _sleep(600); } },
                    {
                        type: 'observe', target: 'megohm',
                        msg: '停止摇动，拆下表笔，收起兆欧表',
                        async act() { await _putAwayInstrument(this, 'megohm'); },
                    },
                    { type: 'btn', target: 'et1', part: 'reset', msg: '按脱扣器「复位」按钮', async act() { await _etReset(this); } },
                    { type: 'btn', target: 'qf1', part: 'handle', msg: '储能到位后按合闸按钮', async act() { await _closeQF(this); } },
                    { type: 'btn', target: 'pdb1', part: 'sw1', msg: '恢复开关1', async act() { await _pdbSet(this, 0, true); } },
                    { type: 'btn', target: 'pdb1', part: 'sw2', msg: '恢复开关2', async act() { await _pdbSet(this, 1, true); } },
                    { type: 'btn', target: 'pdb1', part: 'sw3', msg: '恢复开关3', async act() { await _pdbSet(this, 2, true); } },
                ],
                check() {
                    const sys = _sysOf(this);
                    const cfg = sys.FAULT_CONFIG['bus_short'];
                    const qf = _qf(this);
                    if (!cfg || cfg.check()) return false;
                    if (!qf || qf.getState() !== 'on') return false;
                    const st = _pdb(this) ? _pdb(this).getStates() : [];
                    return st[0] === 'on' && st[1] === 'on' && st[2] === 'on';
                },
            },
            {
                msg: '7. 在「故障设置」中勾选重要负载短路。',
                mode: 'check',
                op: [
                    { type: 'fault', fault: 'tload_short', msg: '勾选「2. 重要负载短路」并应用', async act() { await _sleep(800); } },
                ],
                check() {
                    const cfg = _sysOf(this).FAULT_CONFIG['tload_short'];
                    return !!(cfg && cfg.check());
                },
            },
            {
                msg: '8. 观察主开关再次跳闸，确认负载支路短路。',
                mode: 'check',
                op: [
                    {
                        type: 'observe', target: 'et1', part: 'lcd',
                        msg: '看脱扣器：又一次短路脱扣',
                        async act() { await _sleep(1200); },
                    },
                    {
                        type: 'observe', target: 'qf1', part: 'main-contact',
                        msg: '主开关跳闸，汇流排失电',
                        async act() {
                            const sys = _sysOf(this);
                            await _waitFor(sys, s => { const q = _comp(s, 'qf1'); return q && q.getState() === 'off'; }, 15000);
                            await _sleep(1000);
                        },
                    },
                ],
                check() {
                    const sys = _sysOf(this);
                    const qf = _qf(this);
                    const et = _et(this);
                    const cfg = sys.FAULT_CONFIG['tload_short'];
                    return !!(cfg && cfg.check() && qf && qf.getState() === 'off'
                        && et && et.isTripped() && String(et._tripReason || '').includes('短路'));
                },
            },
            {
                msg: '9. 再测干线绝缘：仍为 0，说明短路在负载侧。',
                mode: 'check',
                op: [
                    { type: 'instrument', instrument: 'megohm', msg: '重新调出手摇兆欧表', async act() { await _sleep(800); } },
                    {
                        type: 'observe', target: 'megohm', ports: ['megohm_wire_l', 'bus1_wire_l1_2'],
                        msg: 'L 端接汇流排 L1 端子',
                        async act() { await _wire(_sysOf(this), 'megohm_wire_l', 'bus1_wire_l1_2'); },
                    },
                    {
                        type: 'observe', target: 'megohm', ports: ['megohm_wire_e', 'bus1_wire_l2_2'],
                        msg: 'E 端接汇流排 L2 端子',
                        async act() { await _wire(_sysOf(this), 'megohm_wire_e', 'bus1_wire_l2_2'); },
                    },
                    {
                        type: 'btn', target: 'megohm', part: 'crank',
                        msg: '摇动手柄，读数仍为 0 MΩ',
                        async act() { await _mgCrank(this, true, r => isFinite(r) && r < 0.2, 12000); },
                    },
                ],
                check() {
                    const sys = _sysOf(this);
                    const mg = _mg(this);
                    if (!mg || !mg.group || !mg.group.visible()) return false;
                    if (!(mg.isCranking && mg.isCranking())) return false;
                    if (!_mgOn(sys, 'bus1_wire_l1_2', 'bus1_wire_l2_2')) return false;
                    const r = mg.getResistance();
                    return isFinite(r) && r < 0.5;
                },
            },
            {
                msg: '10. 逐路拉掉负载开关，读数恢复的那一路即短路支路。',
                mode: 'check',
                op: [
                    { type: 'switch', target: 'pdb1', part: 'sw1', msg: '拉掉开关1，读数仍为 0', async act() { await _pdbSet(this, 0, false); await _sleep(1200); } },
                    { type: 'switch', target: 'pdb1', part: 'sw2', msg: '拉掉开关2，读数仍为 0', async act() { await _pdbSet(this, 1, false); await _sleep(1200); } },
                    { type: 'switch', target: 'pdb1', part: 'sw3', msg: '拉掉开关3，读数恢复 ∞', async act() { await _pdbSet(this, 2, false); await _mgCrank(this, true, r => !isFinite(r) || r >= 50, 8000); } },
                ],
                check() {
                    const mg = _mg(this);
                    const st = _pdb(this) ? _pdb(this).getStates() : [];
                    if (st[2] !== 'off') return false;
                    if (!mg || !mg.group || !mg.group.visible() || !(mg.isCranking && mg.isCranking())) return false;
                    const r = mg.getResistance();
                    return !isFinite(r) || r >= 50;
                },
            },
            {
                msg: '11. 取消负载短路，复位脱扣器，合闸恢复供电。',
                mode: 'check',
                op: [
                    { type: 'fault', fault: 'tload_short', repair: true, msg: '取消勾选「2. 重要负载短路」并应用', async act() { await _sleep(600); } },
                    { type: 'observe', target: 'megohm', msg: '停止摇动，拆表笔，收起兆欧表', async act() { await _putAwayInstrument(this, 'megohm'); } },
                    { type: 'btn', target: 'et1', part: 'reset', msg: '按脱扣器「复位」按钮', async act() { await _etReset(this); } },
                    { type: 'btn', target: 'qf1', part: 'handle', msg: '储能到位后按合闸按钮', async act() { await _closeQF(this); } },
                    { type: 'btn', target: 'pdb1', part: 'sw1', msg: '恢复开关1', async act() { await _pdbSet(this, 0, true); } },
                    { type: 'btn', target: 'pdb1', part: 'sw2', msg: '恢复开关2', async act() { await _pdbSet(this, 1, true); } },
                    { type: 'btn', target: 'pdb1', part: 'sw3', msg: '恢复开关3', async act() { await _pdbSet(this, 2, true); } },
                ],
                check() {
                    const sys = _sysOf(this);
                    const cfg = sys.FAULT_CONFIG['tload_short'];
                    const qf = _qf(this);
                    if (!cfg || cfg.check()) return false;
                    if (!qf || qf.getState() !== 'on') return false;
                    const st = _pdb(this) ? _pdb(this).getStates() : [];
                    return st[0] === 'on' && st[1] === 'on' && st[2] === 'on';
                },
            },
            {
                msg: '12. 测试题：选择性保护设置不当的后果',
                mode: 'quiz',
                quizConfig: {
                    question: '船舶电网中，上、下级保护电器的选择性保护（保护配合）设置不当时，会出现什么后果？',
                    options: [
                        '下级支路故障时上级主开关也同时动作，扩大停电范围，造成全船或大范围失电',
                        '故障支路的保护电器更快动作，仅切除故障支路',
                        '保护电器在故障时完全不动作，只烧毁设备',
                        '保护电器自动修正整定值，无需人为整定',
                    ],
                    answer: 0,
                    analysis: '选择性保护要求上、下级按电流级差与时间级差配合：故障应由最近的保护电器先切除。整定不配合时上级会越级跳闸，扩大停电范围。',
                },
            },
            {
                msg: '13. 测试题：短路跳闸后用什么仪表查故障',
                mode: 'quiz',
                quizConfig: {
                    question: '发电机主开关因短路保护跳闸后，查找并确认短路点应使用哪种仪表？',
                    options: [
                        '兆欧表（绝缘电阻表），断电后测量干线绝缘电阻，短路时读数接近 0',
                        '万用表交流电压挡，带电测量电压',
                        '钳形电流表，带电测量电流',
                        '相位表，测量电压相位',
                    ],
                    answer: 0,
                    analysis: '查短路必须在停电状态下测量绝缘电阻：正常干线绝缘为数十 MΩ 以上，短路时接近 0。逐段、逐支路断开后测量，绝缘恢复的那一段即短路支路。',
                },
            },
        ],
    },

    'overload-detect': {
        id: 'overload-detect',
        name: '2. 发电机过载故障的判断和处理',
        steps: [
            {
                msg: '1. 接线、起动、合闸，合上三路负载并加载 20 kW。',
                mode: 'check',
                op: [
                    { type: 'wire', button: 'btnAutoWire', msg: '点击「自动接线」', async act() { await _autoWireBtn(this); } },
                    { type: 'btn', target: 'gen1', part: 'start', msg: '按机旁起动按钮，发电机建压', async act() { await _genStart(this); } },
                    { type: 'btn', target: 'qf1', part: 'handle', msg: '等储能储满（不足则按压手柄 5 次）', async act() { await _ensureCharged(this); } },
                    { type: 'btn', target: 'qf1', part: 'btn-close', msg: '按手动合闸按钮', async act() { await _closeQF(this); } },
                    { type: 'btn', target: 'pdb1', part: 'sw1', msg: '合上动力负载开关', async act() { await _pdbSet(this, 0, true); } },
                    { type: 'btn', target: 'pdb1', part: 'sw2', msg: '合上照明负载开关', async act() { await _pdbSet(this, 1, true); } },
                    { type: 'btn', target: 'pdb1', part: 'sw3', msg: '合上可调负载开关', async act() { await _pdbSet(this, 2, true); } },
                    { type: 'observe', target: 'tload', part: 'power', msg: '在配置界面把有功功率改为 20 kW', async act() { await _setTload(this, { powerKw: 20, loaded: 'true' }, '把「三相有功功率」改为 20 kW，初始状态选「加载」'); } },
                ],
                check() {
                    const sys = _sysOf(this);
                    if (!_wired(sys, 'gen1_wire_u', 'qf1_wire_t1')) return false;
                    const gen = _comp(sys, 'gen1');
                    if (!gen || !gen.isOn) return false;
                    const qf = _qf(this);
                    if (!qf || qf.getState() !== 'on') return false;
                    const st = _pdb(this) ? _pdb(this).getStates() : [];
                    if (!(st[0] === 'on' && st[1] === 'on' && st[2] === 'on')) return false;
                    const tl = _tload(this);
                    return !!(tl && tl.isLoaded && tl.isLoaded());
                },
            },
            {
                msg: '2. 把可调负载调到 95 kW，观察过载分级卸载。',
                mode: 'check',
                op: [
                    { type: 'observe', target: 'et1', part: 'lcd', msg: '先看脱扣器电流与功率', async act() { await _sleep(1200); } },
                    { type: 'observe', target: 'tload', part: 'power', msg: '在配置界面把有功功率改为 95 kW', async act() { await _setTload(this, { powerKw: 95 }, '把「三相有功功率」改为 95 kW'); } },
                    {
                        type: 'observe', target: 'et1', part: 'lcd',
                        msg: '脱扣器判定过载，5 s 后输出第 1 路卸载',
                        async act() {
                            const sys = _sysOf(this);
                            await _waitFor(sys, s => { const p = _comp(s, 'pdb1'); return p && p.getStates()[0] === 'trip'; }, 25000);
                            await _sleep(1200);
                        },
                    },
                    {
                        type: 'observe', target: 'pdb1', part: 'sw1',
                        msg: '开关1 已被分励脱扣（卸载次要动力负载）',
                        async act() { await _sleep(1500); },
                    },
                    {
                        type: 'observe', target: 'et1', part: 'lcd',
                        msg: '再过 5 s 输出第 2 路卸载',
                        async act() {
                            const sys = _sysOf(this);
                            await _waitFor(sys, s => { const p = _comp(s, 'pdb1'); return p && p.getStates()[1] === 'trip'; }, 25000);
                            await _sleep(1200);
                        },
                    },
                    {
                        type: 'observe', target: 'qf1', part: 'main-contact',
                        msg: '负荷降到额定以内，主开关保持合闸',
                        async act() { await _sleep(1800); },
                    },
                ],
                check() {
                    const tl = _tload(this);
                    const st = _pdb(this) ? _pdb(this).getStates() : [];
                    const qf = _qf(this);
                    if (!tl) return false;
                    const kw = parseFloat(tl.powerKw);
                    if (!(kw >= 90 && kw <= 105)) return false;   // 允许学员在 90~105 kW 间取值
                    if (!(st[0] === 'trip' && st[1] === 'trip')) return false;
                    return !!(qf && qf.getState() === 'on');
                },
            },
            {
                msg: '3. 继续把负荷加到 125 kW，过载延时后跳闸。',
                mode: 'check',
                op: [
                    { type: 'observe', target: 'tload', part: 'power', msg: '在配置界面把有功功率改为 125 kW', async act() { await _setTload(this, { powerKw: 125 }, '把「三相有功功率」改为 125 kW'); } },
                    {
                        type: 'observe', target: 'et1', part: 'lcd',
                        msg: '过载超过整定值，开始 15 s 反时限计时',
                        async act() { await _sleep(2200); },
                    },
                    {
                        type: 'observe', target: 'qf1', part: 'main-contact',
                        msg: '过载延时到，主开关跳闸',
                        async act() {
                            const sys = _sysOf(this);
                            await _waitFor(sys, s => { const q = _comp(s, 'qf1'); return q && q.getState() === 'off'; }, 35000);
                            await _sleep(1200);
                        },
                    },
                ],
                check() {
                    const tl = _tload(this);
                    const qf = _qf(this);
                    const et = _et(this);
                    if (!tl) return false;
                    const kw2 = parseFloat(tl.powerKw);
                    if (!(kw2 >= 115 && kw2 <= 140)) return false;   // 允许学员在 115~140 kW 间取值
                    return !!(qf && qf.getState() === 'off' && et && et.isTripped()
                        && String(et._tripReason || '').includes('过载'));
                },
            },
            {
                msg: '4. 测试题：单机运行易过载的情况',
                mode: 'quiz',
                quizConfig: {
                    question: '发电机单机运行时，下列哪种情况最容易导致过载？',
                    options: [
                        '几台大功率电动机同时直接起动，起动电流大且总负荷超过发电机额定功率',
                        '发电机频率略高于 50 Hz',
                        '汇流排电压略高于额定值',
                        '照明负荷切换到备用回路',
                    ],
                    answer: 0,
                    analysis: '单机运行时若多台大功率电动机同时起动，起动电流可达额定电流的 5~7 倍，总负荷超过发电机额定值，自动分级卸载动作，仍不缓解则过载跳闸。',
                },
            },
            {
                msg: '5. 测试题：并联运行易过载的情况',
                mode: 'quiz',
                quizConfig: {
                    question: '两台及以上发电机并联运行时，下列哪种情况最容易导致某台机组过载？',
                    options: [
                        '功率分配不均，某台机组承担超过其额定功率的负荷',
                        '发电机电压设置得比额定值高',
                        '负载功率因数变高',
                        '汇流排频率小幅波动',
                    ],
                    answer: 0,
                    analysis: '并联时各机按调差率分配负荷。调差率设置不当，或一台机组故障退出后负荷全部转移，都会造成剩余机组过载。',
                },
            },
            {
                msg: '6. 测试题：自动分级卸载的作用',
                mode: 'quiz',
                quizConfig: {
                    question: '关于发电机自动分级卸载装置，下列说法正确的是？',
                    options: [
                        '过载时按预定顺序自动切除次要负载，优先保证重要负载供电，避免过载跳闸',
                        '它是短路时的快速保护，瞬时切断全部负载',
                        '它只在并联运行时起作用',
                        '它动作时直接分闸主开关',
                    ],
                    answer: 0,
                    analysis: '自动分级卸载在过载时按设定延时（本工程 5 s、10 s）分级切除次要负载，保留重要负载，使发电机回到不过载状态；切除后仍过载才由脱扣器跳闸。',
                },
            },
        ],
    },

    'undervoltage-detect': {
        id: 'undervoltage-detect',
        name: '3. 发电机失压（欠压）故障的判断和处理',
        steps: [
            {
                msg: '1. 接线、起动、合闸，合上三路负载并加载 20 kW。',
                mode: 'check',
                op: [
                    { type: 'wire', button: 'btnAutoWire', msg: '点击「自动接线」', async act() { await _autoWireBtn(this); } },
                    { type: 'btn', target: 'gen1', part: 'start', msg: '按机旁起动按钮，发电机建压', async act() { await _genStart(this); } },
                    { type: 'btn', target: 'qf1', part: 'handle', msg: '等储能储满（不足则按压手柄 5 次）', async act() { await _ensureCharged(this); } },
                    { type: 'btn', target: 'qf1', part: 'btn-close', msg: '按手动合闸按钮', async act() { await _closeQF(this); } },
                    { type: 'btn', target: 'pdb1', part: 'sw1', msg: '合上动力负载开关', async act() { await _pdbSet(this, 0, true); } },
                    { type: 'btn', target: 'pdb1', part: 'sw2', msg: '合上照明负载开关', async act() { await _pdbSet(this, 1, true); } },
                    { type: 'btn', target: 'pdb1', part: 'sw3', msg: '合上可调负载开关', async act() { await _pdbSet(this, 2, true); } },
                    { type: 'observe', target: 'tload', part: 'power', msg: '在配置界面把有功功率改为 20 kW 并加载', async act() { await _setTload(this, { powerKw: 20, loaded: 'true' }, '把「三相有功功率」改为 20 kW，初始状态选「加载」'); } },
                ],
                check() {
                    const sys = _sysOf(this);
                    if (!_wired(sys, 'gen1_wire_u', 'qf1_wire_t1')) return false;
                    const gen = _comp(sys, 'gen1');
                    if (!gen || !gen.isOn) return false;
                    const qf = _qf(this);
                    if (!qf || qf.getState() !== 'on') return false;
                    const st = _pdb(this) ? _pdb(this).getStates() : [];
                    if (!(st[0] === 'on' && st[1] === 'on' && st[2] === 'on')) return false;
                    const tl = _tload(this);
                    return !!(tl && tl.isLoaded && tl.isLoaded());
                },
            },
            {
                msg: '2. 在「故障设置」中勾选调速器故障。',
                mode: 'check',
                op: [
                    { type: 'fault', fault: 'gen_governor_fault', msg: '勾选「3. 1#发电机调速器故障」并应用', async act() { await _sleep(800); } },
                ],
                check() {
                    const cfg = _sysOf(this).FAULT_CONFIG['gen_governor_fault'];
                    return !!(cfg && cfg.check());
                },
            },
            {
                msg: '3. 观察频率、电压同时下降，欠压延时后跳闸。',
                mode: 'check',
                op: [
                    {
                        type: 'observe', target: 'et1', part: 'lcd',
                        msg: '看脱扣器：f≈25 Hz、U≈280 V',
                        async act() { await _sleep(2200); },
                    },
                    {
                        type: 'observe', target: 'qf1', part: 'main-contact',
                        msg: '欠压延时到，主开关跳闸',
                        async act() {
                            const sys = _sysOf(this);
                            await _waitFor(sys, s => {
                                const q = _comp(s, 'qf1');
                                return q && q.getState() === 'off';
                            }, 15000);
                            await _sleep(1200);
                        },
                    },
                ],
                check() {
                    const qf = _qf(this);
                    const et = _et(this);
                    return !!(qf && qf.getState() === 'off' && et && et.isTripped()
                        && String(et._tripReason || '').includes('欠压'));
                },
            },
            {
                msg: '4. 点击电子脱扣器，查看欠压脱扣记录。',
                mode: 'find', target: 'et1', subTarget: 'lcd',
            },
            {
                msg: '5. 取消调速器故障，复位脱扣器，重新合闸供电。',
                mode: 'check',
                op: [
                    { type: 'fault', fault: 'gen_governor_fault', repair: true, msg: '取消勾选「3. 1#发电机调速器故障」并应用', async act() { await _sleep(600); } },
                    { type: 'btn', target: 'et1', part: 'reset', msg: '按脱扣器「复位」按钮', async act() { await _etReset(this); } },
                    { type: 'btn', target: 'qf1', part: 'handle', msg: '储能到位后按合闸按钮', async act() { await _closeQF(this); } },
                ],
                check() {
                    const sys = _sysOf(this);
                    const cfg = sys.FAULT_CONFIG['gen_governor_fault'];
                    const qf = _qf(this);
                    return !!(cfg && !cfg.check() && qf && qf.getState() === 'on');
                },
            },
            {
                msg: '6. 在「故障设置」中勾选调压器故障。',
                mode: 'check',
                op: [
                    { type: 'fault', fault: 'gen_avr_fault', msg: '勾选「4. 1#发电机调压器故障」并应用', async act() { await _sleep(800); } },
                ],
                check() {
                    const cfg = _sysOf(this).FAULT_CONFIG['gen_avr_fault'];
                    return !!(cfg && cfg.check());
                },
            },
            {
                msg: '7. 观察频率正常、电压降到 200 V 后欠压跳闸。',
                mode: 'check',
                op: [
                    {
                        type: 'observe', target: 'et1', part: 'lcd',
                        msg: '看脱扣器：f≈50 Hz、U≈200 V',
                        async act() { await _sleep(2200); },
                    },
                    {
                        type: 'observe', target: 'qf1', part: 'main-contact',
                        msg: '欠压延时到，主开关跳闸',
                        async act() {
                            const sys = _sysOf(this);
                            await _waitFor(sys, s => {
                                const q = _comp(s, 'qf1');
                                return q && q.getState() === 'off';
                            }, 15000);
                            await _sleep(1200);
                        },
                    },
                ],
                check() {
                    const qf = _qf(this);
                    const et = _et(this);
                    return !!(qf && qf.getState() === 'off' && et && et.isTripped()
                        && String(et._tripReason || '').includes('欠压'));
                },
            },
            {
                msg: '8. 取消调压器故障，复位脱扣器，合闸恢复供电。',
                mode: 'check',
                op: [
                    { type: 'fault', fault: 'gen_avr_fault', repair: true, msg: '取消勾选「4. 1#发电机调压器故障」并应用', async act() { await _sleep(600); } },
                    { type: 'btn', target: 'et1', part: 'reset', msg: '按脱扣器「复位」按钮', async act() { await _etReset(this); } },
                    { type: 'btn', target: 'qf1', part: 'handle', msg: '储能到位后按合闸按钮', async act() { await _closeQF(this); } },
                ],
                check() {
                    const sys = _sysOf(this);
                    const cfg = sys.FAULT_CONFIG['gen_avr_fault'];
                    const qf = _qf(this);
                    return !!(cfg && !cfg.check() && qf && qf.getState() === 'on');
                },
            },
            {
                msg: '9. 测试题：引起发电机欠压故障的原因',
                mode: 'quiz',
                quizConfig: {
                    question: '下列哪种情况会引起发电机失压（欠压）故障？',
                    options: [
                        '调速器故障使转速下降（频率、电压同时降低）',
                        'AVR 故障使励磁异常（频率正常、电压降低）',
                        '负载短路或大功率负载突然投入使端电压骤降',
                        '以上均可能',
                    ],
                    answer: 3,
                    analysis: '欠压原因包括：调速器故障（f、U 同降）、AVR/励磁回路故障（仅 U 降）、负载短路或大负荷突加（端电压骤降）等。看频率是否同时下降即可初步区分调速器与调压器故障。',
                },
            },
        ],
    },
};

// ═══════════════════════════════════════════════════════════════
// 四、组件布局（单页工程，全部同屏；仅仪表默认隐藏）
// ═══════════════════════════════════════════════════════════════

export const componentConfigs = [
    // ── 主回路：同步发电机 → 主开关 → 汇流排 ──
    { Class: SyncGenerator3P, id: 'gen1', x: -10, y: 700, vRms: 230, freq: 50, isOn: false, label: '同步发电机', ratedPower: 80, ratedVoltage: 400, ratedCosPhi: 0.8, rOn: 0.05, avrDelay: 3, avrTime: 5, maxDropV: 80, avrMaxComp: 1, visible: true },
    { Class: MarineMainsSwitch, id: 'qf1', x: -150, y: 220, ratedCtrlVoltage: 24, label: '主开关', visible: true },
    // 电子脱扣器：In=100 A、Un=380 V，过载 1.5In 延时 15 s，欠压 80%Un 延时 3 s
    { Class: MarineElectronicTrip, id: 'et1', x: 600, y: 600, In: 100, Un: 380, phase: '3', cosPhi: 0.8, genId: 'gen1', label: 'ET', shortMult: 4, overloadMult: 1.5, overloadTime: 15, uvPercent: 80, uvTime: 3, visible: true },
    // ── 控制端子共用地 ──
    // 主开关 5 个线圈（储能电机 m / 合闸 c / 失压 uv / 分励 fl / 电子脱扣 et）的负极公共接地
    { Class: Ground, id: 'gnd_qf', x: 460, y: 580, visible: true },
    // 电子脱扣器脱扣输出 t2 与 24V 电源负极 vn 公共接地
    { Class: Ground, id: 'gnd_et', x: 790, y: 640, visible: true },
    // 直流 24V 电源负极接地
    { Class: Ground, id: 'gnd_dc', x: 850, y: 340, visible: true },
    // 主开关控制按钮：停止按钮（红、NC）、分闸按钮、合闸按钮（绿、NO）
    { Class: DiagramStopButton, id: 'sb', x: 680, y: 360, label: '模拟失压', visible: true },
    { Class: DiagramStartButton, id: 'ss', x: 760, y: 440, label: '分闸', visible: true },
    { Class: DiagramStartButton, id: 'sc', x: 600, y: 280, label: '合闸', visible: true },
    { Class: Busbar3P, id: 'bus1', x: 220, y: 30, tapsPerPhase: 6, label: '汇流排', visible: true },

    // ── 控制电源（DC 24V）──
    { Class: DCPower, id: 'dc_uv', x: 900, y: 150, voltage: 24, isOn: true, label: '失压脱扣电源', visible: true },

    // ── 汇流排馈出支路 ──
    // 支路1：配电箱开关1 → 三相感应电机（Y 接法）
    { Class: InductionMotor2, id: 'im01', x: 1080, y: 680, visible: true,
        R1: 0.50, Lsigma1: 0.00334, Rc: 300, Lm: 0.0796,
        R2: 0.46, Lsigma2: 0.00334,
        J: 0.12, B: 0.01, polePairs: 2,
        ratedPower: 10, ratedSpeed: 1440,
        simpleModel: true, loadTorque: 20 },
    // 支路2：配电箱开关2 → 三盏白炽灯（L1/L2/L3 各一），r 端星形互联后接地
    { Class: IncandescentLamp, id: 'lamp1', x: 1330, y: 770, coldResistance: 4.84, rotation: 90 },
    { Class: IncandescentLamp, id: 'lamp2', x: 1400, y: 770, coldResistance: 4.84, rotation: 90 },
    { Class: IncandescentLamp, id: 'lamp3', x: 1470, y: 770, coldResistance: 4.84, rotation: 90 },
    { Class: Ground, id: 'gnd_l', x: 1450, y: 900, visible: true },

    // 支路3：配电箱开关3 → 三相可调负载（星形，中性点 n 接地）
    { Class: ThreePhaseLoad, id: 'tload', x: 1530, y: 650, powerKw: 20, cosPhi: 1, reactive: 'ind', loaded: false, label: '三相可调负载', visible: true },

    // ── 低压三相配电箱（汇流排供电，三路出线：动力 / 照明 / 可调负载）──
    { Class: DistributionBox, id: 'pdb1', x: 1200, y: 190, label: '低压配电箱', ratedCurrent: 100, shortDelay: 0.2, overloadK: 4, tripCoilR: 200, initStates: ['off', 'off', 'off'], visible: true },

    // ── 7 种保留仪表（默认隐藏，从「选择仪表」调出；位置互不重叠，可拖动）──
    { Class: RealMegohmMeter, id: 'megohm', x: 20, y: 1000, rampTime: 0.5, visible: false },
    { Class: Multimeter, id: 'multimeter', x: 380, y: 1000, visible: false },
    { Class: MF47Multimeter, id: 'mf47-panel', x: 660, y: 1000, visible: false },
    { Class: Oscilloscope_tri, id: 'osc', x: 1030, y: 1020, visible: false },
    { Class: SignalGenerator, id: 'sg', x: 1500, y: 1000, visible: false },
    { Class: ProcessCalibrator, id: 'cali', x: 1030, y: 1480, visible: false },
    { Class: ElecMeter, id: 'elecmeter', x: 1380, y: 1460, visible: false },
];

// ─── 接线辅助（本电路 48 根导线，> 8 根，允许瞬时接线）───

function _autoWire(sys) {
    if (!sys || !sys.connMgr) return;
    sys.conns.length = 0;
    const cons = [
        // ── 主回路：同步发电机 → 主开关 → 汇流排 ──
        { from: 'gen1_wire_u', to: 'qf1_wire_t1', type: 'wire' },
        { from: 'gen1_wire_v', to: 'qf1_wire_t2', type: 'wire' },
        // 第3相（W）串联电子脱扣器电流采样端（I+ → 发电机，I- → 主开关）
        { from: 'gen1_wire_w', to: 'et1_wire_i+', type: 'wire' },
        { from: 'et1_wire_i-', to: 'qf1_wire_t3', type: 'wire' },
        { from: 'qf1_wire_l1', to: 'bus1_wire_l1_1', type: 'wire' },
        { from: 'qf1_wire_l2', to: 'bus1_wire_l2_1', type: 'wire' },
        { from: 'qf1_wire_l3', to: 'bus1_wire_l3_1', type: 'wire' },
        // ── 电子脱扣器：测量第3相相电压（W-N）、24V 供电、脱扣输出接主开关 ET ──
        { from: 'gen1_wire_w', to: 'et1_wire_u+', type: 'wire' },
        { from: 'gen1_wire_n', to: 'et1_wire_u-', type: 'wire' },
        { from: 'dc_uv_wire_p', to: 'et1_wire_vp', type: 'wire' },
        // 直流 24V 电源负极接地
        { from: 'dc_uv_wire_n', to: 'gnd_dc_wire_gnd', type: 'wire' },
        { from: 'et1_wire_t1', to: 'qf1_wire_et1', type: 'wire' },
        // 电子脱扣器脱扣输出负极 t2 → 公共地
        { from: 'et1_wire_t2', to: 'gnd_et_wire_gnd', type: 'wire' },
        // 电子脱扣器 24V 电源负极 vn → 公共地
        { from: 'et1_wire_vn', to: 'gnd_et_wire_gnd', type: 'wire' },
        // ── 支路：配电箱进线（汇流排三相）→ 开关1→电机、开关2→照明、开关3→可调负载 ──
        { from: 'bus1_wire_l1_8', to: 'pdb1_wire_in1', type: 'wire' },
        { from: 'bus1_wire_l2_8', to: 'pdb1_wire_in2', type: 'wire' },
        { from: 'bus1_wire_l3_8', to: 'pdb1_wire_in3', type: 'wire' },
        // 开关1 → 感应电机（Y 接法）
        { from: 'pdb1_wire_sw1_t1', to: 'im01_wire_u1', type: 'wire' },
        { from: 'pdb1_wire_sw1_t2', to: 'im01_wire_v1', type: 'wire' },
        { from: 'pdb1_wire_sw1_t3', to: 'im01_wire_w1', type: 'wire' },
        { from: 'im01_wire_u2', to: 'im01_wire_v2', type: 'wire' },
        { from: 'im01_wire_v2', to: 'im01_wire_w2', type: 'wire' },
        // 开关2 → 三盏白炽灯（L1/L2/L3 各一），r 端星形互联后接地
        { from: 'pdb1_wire_sw2_t1', to: 'lamp1_wire_l', type: 'wire' },
        { from: 'pdb1_wire_sw2_t2', to: 'lamp2_wire_l', type: 'wire' },
        { from: 'pdb1_wire_sw2_t3', to: 'lamp3_wire_l', type: 'wire' },
        // 三盏白炽灯中性点星形连接：r 端互联后共同接地
        { from: 'lamp1_wire_r', to: 'lamp2_wire_r', type: 'wire' },
        { from: 'lamp2_wire_r', to: 'lamp3_wire_r', type: 'wire' },
        { from: 'lamp2_wire_r', to: 'gnd_l_wire_gnd', type: 'wire' },
        // 开关3 → 三相可调负载（星形，中性点 n 接地）
        { from: 'pdb1_wire_sw3_t1', to: 'tload_wire_l1', type: 'wire' },
        { from: 'pdb1_wire_sw3_t2', to: 'tload_wire_l2', type: 'wire' },
        { from: 'pdb1_wire_sw3_t3', to: 'tload_wire_l3', type: 'wire' },
        { from: 'tload_wire_n', to: 'gnd_l_wire_gnd', type: 'wire' },
        // ── 控制回路：DC 24V 正极 → 停止按钮 SB1（常闭 NC）→ 失压脱扣线圈 uv → 公共地 ──
        { from: 'dc_uv_wire_p', to: 'sb_wire_nc4', type: 'wire' },
        { from: 'sb_wire_nc3', to: 'qf1_wire_uv1', type: 'wire' },
        { from: 'qf1_wire_uv2', to: 'gnd_qf_wire_gnd', type: 'wire' },
        // ── 控制回路：DC 24V 正极 → 分闸按钮（常开 NO）→ 分励脱扣线圈 fl → 公共地 ──
        { from: 'dc_uv_wire_p', to: 'ss_wire_no2', type: 'wire' },
        { from: 'ss_wire_no1', to: 'qf1_wire_fla', type: 'wire' },
        { from: 'qf1_wire_flb', to: 'gnd_qf_wire_gnd', type: 'wire' },
        // ── 控制回路：DC 24V 正极 → 合闸按钮（常开 NO）→ 合闸线圈 c1 → 公共地 ──
        { from: 'dc_uv_wire_p', to: 'sc_wire_no2', type: 'wire' },
        { from: 'sc_wire_no1', to: 'qf1_wire_c1', type: 'wire' },
        // ── 储能电机电源：DC 24V 正极 → 主开关储能电机（m1/m2），负极 → 公共地 ──
        { from: 'dc_uv_wire_p', to: 'qf1_wire_m1', type: 'wire' },
        { from: 'qf1_wire_m2', to: 'gnd_qf_wire_gnd', type: 'wire' },
        // ── 主开关其余线圈负极 → 公共地：合闸线圈 c2、电子脱扣 et2 ──
        { from: 'qf1_wire_c2', to: 'gnd_qf_wire_gnd', type: 'wire' },
        { from: 'qf1_wire_et2', to: 'gnd_qf_wire_gnd', type: 'wire' },
        // ── 电子脱扣器过载分级卸载输出 → 配电箱分励线圈 ──
        // 过载 5s：第 1 路输出（F1）→ 配电箱开关1 分励脱扣
        { from: 'et1_wire_f1a', to: 'pdb1_wire_sw1_fla', type: 'wire' },
        { from: 'et1_wire_f1b', to: 'pdb1_wire_sw1_flb', type: 'wire' },
        // 过载 10s：第 2 路输出（F2）→ 配电箱开关2 分励脱扣
        { from: 'et1_wire_f2a', to: 'pdb1_wire_sw2_fla', type: 'wire' },
        { from: 'et1_wire_f2b', to: 'pdb1_wire_sw2_flb', type: 'wire' },
    ];
    cons.forEach(c => sys.connMgr.addConn(c));
    if (sys.redrawAll) sys.redrawAll();
}

export function initSlider(_sys) { }

/** 工具栏「自动接线」：初始化时不做（保持画布无预接线），只有点击按钮/工作流时才接线 */
export function applyAllPresets(opts) {
    if (opts && opts.init) return;
    const sys = _sysOf(this);
    if (!sys) return;
    _autoWire(sys);
}

/** 工具栏「起动系统」：接线 + 起动发电机组 */
export async function applyStartSystem() {
    const sys = _sysOf(this);
    if (!sys) return;
    _autoWire(sys);
    await _sleep(400);
    await _genStart(sys);
}

export function fiveStep() { }
