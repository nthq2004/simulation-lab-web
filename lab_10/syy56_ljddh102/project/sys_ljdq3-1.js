// 船舶发电机主开关仿真工程（同步发电机 + 汇流排 + 船用框架式空气断路器）
//
// 电路组成：
//   主回路  gen1（同步发电机）→ qf1 主触头 → bus1 汇流排 → QF2/电机、QF3/照明
//   控制回路 DC 24 V（dc_uv）→ sb「模拟失压」（常闭）→ 失压线圈 uv
//                          → sc「合闸」→ 合闸线圈 c
//                          → ss「分闸」→ 分励线圈 fl
//                          → 储能电机 m1/m2
//   检测回路 et1 电子脱扣器：电流采样 I+/I-、电压采样 U+/U-、24 V 供电、脱扣输出 t1/t2
//
// 约定（与全局 AGENTS.md「最新范式」一致）：
//   · 单页工程：不导出 PROJECT_PAGES，consys.js 不创建 PageManager
//   · 默认不接线：applyAllPresets({ init:true }) 直接返回；只有「自动接线 / 起动系统 / 工作流 op」才接线
//   · 仪表一律走「选择仪表」界面（op.type='instrument'），表笔用动画接线（约 3 s/根）
//   · 故障一律走「故障设置」界面（op.type='fault'），不得直接调 FAULT_CONFIG[...].trigger()
//   · 动作一律模拟真实交互（getClickablePartNode(...).fire('mousedown'/'click')），不直接改内部字段

import { SyncGenerator3P } from '../components/SyncGenerator3P.js';
import { Busbar3P } from '../components/Busbar3P.js';
import { MarineMainsSwitch } from '../components/MarineMainsSwitch.js';
import { MarineElectronicTrip } from '../components/MarineElectronicTrip.js';
import { DCPower } from '../components/DCPower.js';
import { Ground } from '../components/Gnd.js';
import { DiagramThreePhaseACB } from '../components/DiagramThreePhaseACB.js';
import { DiagramStartButton } from '../components/DiagramStartButton.js';
import { DiagramStopButton } from '../components/DiagramStopButton.js';
import { InductionMotor2 } from '../components/InductionMotor2.js';
import { IncandescentLamp } from '../components/IncandescentLamp.js';
import { Multimeter } from '../components/Multimeter.js';
import { MF47Multimeter } from '../components/MF47Multimeter.js';
import { RealMegohmMeter } from '../components/RealMegohmMeter.js';
import { Oscilloscope_tri } from '../components/Osc_tri.js';
import { SignalGenerator } from '../components/SignalGenerator.js';
import { ProcessCalibrator } from '../components/ProcessCalibrator.js';
import { ElecMeter } from '../components/ElecMeter.js';

// ─────────────────────────────────────────────────────────────────────────
// 故障设置（3 大类，内部随机映射 12 个具体故障）
//
// 原来的 12 个具体故障（内部 enum，保留以备查证/扩展）：
//   #1  uv_coil_open      失压线圈断线          → qf1.setUvCoilOpen
//   #2  uv_stuck          衔铁结构卡死           → qf1.setUvStuck
//   #3  uv_spring         反作用弹簧弹力过大      → qf1.setUvSpring
//   #4  close_coil_open   合闸线圈断线           → qf1.setCloseCoilOpen
//   #5  motor_open        储能电机控制回路断线    → qf1.setMotorOpen
//   #6  store_spring      储能弹簧无法储能        → qf1.setStoreSpring
//   #7  shunt_coil_open   分励线圈断线           → qf1.setShuntCoilOpen
//   #8  shunt_no_act      分励脱扣器不动作        → qf1.setShuntNoAct
//   #9  trip_shaft_stuck  脱扣轴卡死             → qf1.setTripShaftStuck
//   #10 trip_aging        脱扣机构老化           → qf1.setTripAging
//   #11 et_uv_misset      欠压整定失调           → et1.setUvMisSet
//   #12 et_overload_misset 过流整定失调          → et1.setOverloadMisSet
//
// 3 大类故障：
//   1. 主开关合不上闸  → 随机触发 #1~#6 中的一个
//   2. 主开关无法脱扣  → 随机触发 #7~#9 中的一个
//   3. 主开关误跳闸    → 随机触发 #10~#12 中的一个
// ─────────────────────────────────────────────────────────────────────────

function _fcomp(id) {
    const s = window.sys;
    return s && s.comps && s.comps[id] ? s.comps[id] : null;
}

export const FAULT_CONFIGS = {
    sw_no_close: {
        id: 'sw_no_close', name: '1. 主开关合不上闸', system: '主开关',
        items: [
            { comp: 'qf1', flag: '_faultUVCoilOpen',     set: 'setUvCoilOpen'     },
            { comp: 'qf1', flag: '_faultUVStuck',         set: 'setUvStuck'         },
            { comp: 'qf1', flag: '_faultUVSpring',        set: 'setUvSpring'        },
            { comp: 'qf1', flag: '_faultCloseCoilOpen',   set: 'setCloseCoilOpen'   },
            { comp: 'qf1', flag: '_faultMotorOpen',       set: 'setMotorOpen'       },
            { comp: 'qf1', flag: '_faultStoreSpring',     set: 'setStoreSpring'     },
        ],
        check()   { return this.items.some(it => { const c = _fcomp(it.comp); return c && !!c[it.flag]; }); },
        repair()  { this.items.forEach(it => { const c = _fcomp(it.comp); if (c && c[it.set]) c[it.set](false); }); },
        trigger() {
            this.repair();
            const it = this.items[Math.floor(Math.random() * this.items.length)];
            const c = _fcomp(it.comp);
            if (c && c[it.set]) c[it.set](true);
        },
    },
    sw_no_trip: {
        id: 'sw_no_trip', name: '2. 主开关无法脱扣', system: '主开关',
        items: [
            { comp: 'qf1', flag: '_faultShuntCoilOpen',   set: 'setShuntCoilOpen'   },
            { comp: 'qf1', flag: '_faultShuntNoAct',      set: 'setShuntNoAct'      },
            { comp: 'qf1', flag: '_faultTripShaftStuck',  set: 'setTripShaftStuck'  },
        ],
        check()   { return this.items.some(it => { const c = _fcomp(it.comp); return c && !!c[it.flag]; }); },
        repair()  { this.items.forEach(it => { const c = _fcomp(it.comp); if (c && c[it.set]) c[it.set](false); }); },
        trigger() {
            this.repair();
            const it = this.items[Math.floor(Math.random() * this.items.length)];
            const c = _fcomp(it.comp);
            if (c && c[it.set]) c[it.set](true);
        },
    },
    sw_misadjust: {
        id: 'sw_misadjust', name: '3.主开关误跳闸', system: '主开关/电子脱扣器',
        items: [
            { comp: 'qf1', flag: '_faultTripAging',       set: 'setTripAging'       },
            { comp: 'et1', flag: '_faultUvMisSet',        set: 'setUvMisSet'        },
            { comp: 'et1', flag: '_faultOverloadMisSet',  set: 'setOverloadMisSet'  },
        ],
        check()   { return this.items.some(it => { const c = _fcomp(it.comp); return c && !!c[it.flag]; }); },
        repair()  { this.items.forEach(it => { const c = _fcomp(it.comp); if (c && c[it.set]) c[it.set](false); }); },
        trigger() {
            this.repair();
            const it = this.items[Math.floor(Math.random() * this.items.length)];
            const c = _fcomp(it.comp);
            if (c && c[it.set]) c[it.set](true);
        },
    },
};

// ═══════════════════════════════════════════════════════════════
// 一、工作流通用辅助
// ═══════════════════════════════════════════════════════════════

const _sysOf = (ctx) => (ctx && ctx.sys) ? ctx.sys : window.sys;
const _sleep = (ms) => new Promise(r => setTimeout(r, ms));
const _comp = (sys, id) => (sys && sys.comps) ? sys.comps[id] : null;

/** 取主开关 qf1 */
const _qf = (ctx) => _comp(_sysOf(ctx), 'qf1');

/** 动画接线（仪表表笔、单点接线，约 3 s/根） */
async function _wire(sys, from, to) {
    if (!sys || !sys.connMgr) return;
    await sys.connMgr.addConnectionAnimated({ from, to, type: 'wire' });
}

/** 两端口之间是否已连（供 check() 判定） */
function _wired(sys, a, b) {
    return !!(sys && Array.isArray(sys.conns) && sys.conns.some(c =>
        c && c.type === 'wire' && ((c.from === a && c.to === b) || (c.from === b && c.to === a))));
}

/** 条件轮询等待（不写死 sleep 猜时间） */
async function _waitFor(sys, cond, timeout = 6000, interval = 100) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
        try { if (cond(sys)) return true; } catch (e) { /* ignore */ }
        await _sleep(interval);
    }
    return false;
}

/** 模拟点击/按下组件部件（触发组件自身的交互处理，不直接改内部字段） */
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

/** 按压储能手柄 times 次（每次一次真实的 mousedown/mouseup） */
async function _chargeByHandle(ctx, times = 5) {
    const qf = _qf(ctx);
    if (!qf) return;
    for (let i = 0; i < times; i++) {
        if (!_firePart(qf, 'handle', 'mousedown')) {
            console.warn('[主开关] 未取到储能手柄节点，跳过手动储能');
            return;
        }
        await _sleep(180);
        _firePart(qf, 'handle', 'mouseup');
        await _sleep(220);
    }
}

/**
 * 摇动工作位圆盘：dir = 1 顺时针点击右半区，dir = -1 逆时针点击左半区。
 * 每 3 次点击切换一档（连接位 → 试验位 → 断开位）。
 */
async function _dialClicks(ctx, dir = 1, times = 3) {
    const qf = _qf(ctx);
    if (!qf) return;
    const part = dir > 0 ? 'dial' : 'dial-left';
    for (let i = 0; i < times; i++) {
        if (!_firePart(qf, part, 'click')) {
            // 节点取不到时兜底（仅在组件未注册部件时发生）
            console.warn('[主开关] 未取到工作位圆盘节点，兜底调用 _dialTurn');
            if (typeof qf._dialTurn === 'function') qf._dialTurn(dir);
        }
        await _sleep(320);
    }
}

/** 直流 24 V 控制电源通/断：点击电源面板上的「电源键」（真实交互） */
async function _dcSet(ctx, on) {
    const sys = _sysOf(ctx);
    const dc = _comp(sys, 'dc_uv');
    if (!dc) return;
    if (!!dc.isOn === !!on) return;
    if (!_firePart(dc, 'power', 'mousedown')) {
        console.warn('[主开关] 未取到直流电源键节点，兜底置位');
        dc.isOn = !!on;
        dc.update();
    }
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

/** 拔掉万用表表笔（换测点前先收线） */
function _removeProbes(sys) {
    if (!sys || !Array.isArray(sys.conns)) return;
    const keep = [];
    sys.conns.forEach(c => {
        const isProbe = c && c.type === 'wire'
            && (String(c.from).startsWith('multimeter_wire_') || String(c.to).startsWith('multimeter_wire_'));
        if (!isProbe) keep.push(c);
    });
    sys.conns.length = 0;
    keep.forEach(c => sys.conns.push(c));
    if (sys.redrawAll) sys.redrawAll();
}

/** 拆除两端口之间的一根导线（用于"测电阻前先断开回路"等操作） */
function _removeWire(sys, a, b) {
    if (!sys || !Array.isArray(sys.conns)) return;
    sys.conns
        .filter(c => c && c.type === 'wire' && ((c.from === a && c.to === b) || (c.from === b && c.to === a)))
        .forEach(c => sys.connMgr.removeConn(c));
    if (sys.redrawAll) sys.redrawAll();
}

/** 接回一根导线（瞬时接一根，用于恢复被拆开的回路） */
function _addWire(sys, a, b) {
    if (!sys || !sys.connMgr) return;
    sys.connMgr.addConn({ from: a, to: b, type: 'wire' });
    if (sys.redrawAll) sys.redrawAll();
}

/** 数字万用表当前读数 */
function _mmReading(sys) {
    const mm = _comp(sys, 'multimeter');
    if (!mm) return NaN;
    if (typeof mm.getValue === 'function') {
        const v = mm.getValue();
        if (v !== undefined && v !== null && !Number.isNaN(Number(v))) return Number(v);
    }
    return Number(mm.value);
}

/** 失压线圈两端是否已接上万用表表笔（供 check() 判定） */
function _probesOnUvCoil(sys) {
    const vs = sys && sys.voltageSolver;
    if (!vs || !vs.portToCluster) return false;
    const mv = vs.portToCluster.get('multimeter_wire_v');
    const mc = vs.portToCluster.get('multimeter_wire_com');
    const u1 = vs.portToCluster.get('qf1_wire_uv1');
    const u2 = vs.portToCluster.get('qf1_wire_uv2');
    if (mv === undefined || mc === undefined || u1 === undefined || u2 === undefined) return false;
    return (mv === u1 && mc === u2) || (mv === u2 && mc === u1);
}

// ═══════════════════════════════════════════════════════════════
// 二、工作流
// ═══════════════════════════════════════════════════════════════

export const PROJECT_WORKFLOWS = {
    'acb-parts': {
        id: 'acb-parts',
        name: '1. 空气断路器的部件及其功能',
        steps: [
            {
                msg: '1. 识别储能弹簧。',
                mode: 'find', target: 'qf1', subTarget: 'store-spring',
            },
            {
                msg: '2. 测试题：储能弹簧的作用',
                mode: 'quiz',
                quizConfig: {
                    question: '框架式空气断路器中储能弹簧的作用是什么？',
                    options: [
                        '储存压缩能量，合闸时释放能量快速推动主触头闭合',
                        '分闸时把动触头与静触头拉开',
                        '为储能电机提供电源',
                        '用于检测主回路的电流大小',
                    ],
                    answer: 0,
                    analysis: '储能弹簧由储能电机压缩储能，合闸时释放储存的能量，使主触头快速可靠闭合，该过程不依赖电源的瞬间容量。',
                },
            },
            {
                msg: '3. 识别合闸线圈。',
                mode: 'find', target: 'qf1', subTarget: 'close-coil',
            },
            {
                msg: '4. 测试题：合闸过程',
                mode: 'quiz',
                quizConfig: {
                    question: '框架式空气断路器合闸时，以下过程描述正确的是？',
                    options: [
                        '脱扣轴处于正常位，储能弹簧释放能量，主轴推动动触头与静触头闭合',
                        '合闸线圈得电后脱扣轴立即跳开，断路器保持分闸',
                        '主触头先闭合，再由储能电机反向把弹簧拉开',
                        '失压线圈失电时主轴直接推动动触头合闸',
                    ],
                    answer: 0,
                    analysis: '脱扣轴处于正常位时，合闸线圈释放储能弹簧的锁扣，储能弹簧储存的能量通过主轴推动三对动触头与静触头闭合，完成合闸。',
                },
            },
            {
                msg: '5. 识别失压脱扣器。',
                mode: 'find', target: 'qf1', subTarget: 'uv-trip',
            },
            {
                msg: '6. 测试题：失压脱扣器的作用',
                mode: 'quiz',
                quizConfig: {
                    question: '失压脱扣器的主要作用是什么？',
                    options: [
                        '当电压过低或失压时自动使断路器分闸，防止欠压运行',
                        '在合闸时为主触头提供闭合动力',
                        '检测短路电流并限制其大小',
                        '为储能电机提供工作电源',
                    ],
                    answer: 0,
                    analysis: '失压脱扣器线圈正常带电时使脱扣轴保持闭锁；电压降低或消失时线圈失磁，脱扣轴被释放并联动分闸，防止电机等负荷欠电压运行。',
                },
            },
            {
                msg: '7. 识别分励线圈。',
                mode: 'find', target: 'qf1', subTarget: 'shunt-coil',
            },
            {
                msg: '8. 识别电子脱扣器（ET）。',
                mode: 'find', target: 'et1',
            },
            {
                msg: '9. 测试题：电子脱扣器的功能',
                mode: 'quiz',
                quizConfig: {
                    question: '电子脱扣器的主要功能是什么？',
                    options: [
                        '实时检测主回路电流/电压，异常时发出脱扣信号使断路器分闸',
                        '仅为断路器提供合闸电源，不影响分闸',
                        '只在手动操作时点亮指示灯',
                        '用于测量发电机的转速',
                    ],
                    answer: 0,
                    analysis: '电子脱扣器通过电流/电压采样与整定值比较，一旦检测到短路、过载、欠压、逆功率等故障即触发脱扣输出，使主开关分闸保护系统。',
                },
            },
            {
                msg: '10. 识别主触头（三极）。',
                mode: 'find', target: 'qf1', subTarget: 'main-contact',
            },
            {
                msg: '11. 识别辅助触头。',
                mode: 'find', target: 'qf1', subTarget: 'aux-contact',
            },
            {
                msg: '12. 识别分闸弹簧。',
                mode: 'find', target: 'qf1', subTarget: 'open-spring',
            },
            {
                msg: '13. 测试题：分闸过程',
                mode: 'quiz',
                quizConfig: {
                    question: '框架式空气断路器分闸时，以下过程描述正确的是？',
                    options: [
                        '脱扣轴转动，分闸弹簧释放能量，主轴左移使动触头与静触头分离',
                        '储能电机反向转动把主触头拉开',
                        '合闸线圈得电推动主轴继续压紧触头',
                        '电子脱扣器直接熄灭触头间的电弧',
                    ],
                    answer: 0,
                    analysis: '分闸时脱扣轴转动触发，分闸弹簧释放能量拉动主轴左移，三对动触头与静触头分离；灭弧由栅片灭弧装置完成，与储能电机无关。',
                },
            },
        ],
    },

    'acb-ops': {
        id: 'acb-ops',
        name: '2. 主开关储能、合闸、分闸',
        steps: [
            {
                msg: '1. 按压储能手柄 5 次，手动给储能弹簧储能。',
                mode: 'check',
                op: [
                    {
                        type: 'observe', target: 'qf1', part: 'store-ind',
                        msg: '先看储能指示牌：此时未储能',
                        async act() { await _sleep(1300); },
                    },
                    {
                        type: 'btn', target: 'qf1', part: 'handle',
                        msg: '按压储能手柄，连按 5 次',
                        async act() { await _chargeByHandle(this, 5); await _sleep(600); },
                    },
                    {
                        type: 'observe', target: 'qf1', part: 'store-spring',
                        msg: '储能弹簧被压缩，指示牌变为已储能',
                        async act() {
                            await _waitFor(_sysOf(this), s => { const q = _comp(s, 'qf1'); return q && q.isCharged(); }, 5000);
                            await _sleep(900);
                        },
                    },
                ],
                check() {
                    const qf = _qf(this);
                    return !!(qf && qf.isCharged());
                },
            },
            {
                msg: '2. 自动接线，按下机旁起动按钮起动发电机组。',
                mode: 'check',
                op: [
                    {
                        type: 'wire', button: 'btnAutoWire',
                        msg: '点击「自动接线」，接好主回路与控制回路',
                        async act() {
                            const sys = _sysOf(this);
                            if (sys && typeof sys.applyAllPresets === 'function') sys.applyAllPresets();
                            await _sleep(1200);
                        },
                    },
                    {
                        type: 'btn', target: 'gen1', part: 'start',
                        msg: '按机旁起动按钮，发电机建压',
                        async act() { await _genStart(this); },
                    },
                    {
                        type: 'observe', target: 'bus1',
                        msg: '主开关未合闸，汇流排暂不带电',
                        async act() { await _sleep(1600); },
                    },
                ],
                check() {
                    const sys = _sysOf(this);
                    const gen = _comp(sys, 'gen1');
                    return !!(gen && gen.isOn && _wired(sys, 'gen1_wire_u', 'qf1_wire_t1'));
                },
            },
            {
                msg: '3. 按手动合闸按钮，储能弹簧释放、主触头闭合。',
                mode: 'check',
                op: [
                    {
                        type: 'btn', target: 'qf1', part: 'btn-close',
                        msg: '按下手动合闸按钮',
                        async act() {
                            const sys = _sysOf(this);
                            _firePart(_qf(this), 'btn-close', 'click');
                            await _waitFor(sys, s => { const q = _comp(s, 'qf1'); return q && q.getState() === 'on'; }, 6000);
                            await _sleep(800);
                        },
                    },
                    {
                        type: 'observe', target: 'qf1', part: 'main-contact',
                        msg: '主触头闭合，储能弹簧能量被释放',
                        async act() { await _sleep(1600); },
                    },
                    {
                        type: 'observe', target: 'bus1',
                        msg: '汇流排带电，馈出支路已具备送电条件',
                        async act() { await _sleep(1600); },
                    },
                ],
                check() {
                    const qf = _qf(this);
                    return !!(qf && qf.getState() === 'on');
                },
            },
            {
                msg: '4. 储能电机自动为下一次合闸重新储能。',
                mode: 'check',
                op: [
                    {
                        type: 'observe', target: 'qf1', part: 'store-spring',
                        msg: '储能电机得电，弹簧重新储能',
                        async act() {
                            await _waitFor(_sysOf(this), s => { const q = _comp(s, 'qf1'); return q && q.isCharged(); }, 8000);
                            await _sleep(1000);
                        },
                    },
                ],
                check() {
                    const qf = _qf(this);
                    return !!(qf && qf.getState() === 'on' && qf.isCharged());
                },
            },
            {
                msg: '5. 按住手动分闸按钮，主触头分离。',
                mode: 'check',
                op: [
                    {
                        type: 'btn', target: 'qf1', part: 'btn-open',
                        msg: '按住手动分闸按钮（机械脱扣）',
                        async act() {
                            const sys = _sysOf(this);
                            await _pressPart(_qf(this), 'btn-open', 500);
                            await _waitFor(sys, s => { const q = _comp(s, 'qf1'); return q && q.getState() === 'off'; }, 6000);
                            await _sleep(900);
                        },
                    },
                    {
                        type: 'observe', target: 'qf1', part: 'main-contact',
                        msg: '主触头分断，汇流排失电',
                        async act() { await _sleep(1500); },
                    },
                ],
                check() {
                    const qf = _qf(this);
                    return !!(qf && qf.getState() === 'off');
                },
            },
            {
                msg: '6. 按遥控合闸按钮，合闸线圈得电合闸。',
                mode: 'check',
                op: [
                    {
                        type: 'btn', target: 'sc', part: 'btn',
                        msg: '按住「合闸」按钮，合闸线圈得电',
                        async act() {
                            const sys = _sysOf(this);
                            const sc = _comp(sys, 'sc');
                            _firePart(sc, 'btn', 'mousedown');
                            await _waitFor(sys, s => { const q = _comp(s, 'qf1'); return q && q.getState() === 'on'; }, 6000);
                            // 记录本轮确实让合闸线圈得电（松开后线圈电压会消失，check() 读该标记兜底）
                            const v = sys.getVoltageBetween ? sys.getVoltageBetween('qf1_wire_c1', 'qf1_wire_c2') : 0;
                            this._s6Coil = isFinite(v) && Math.abs(v) > 18;
                            await _sleep(600);
                            _firePart(sc, 'btn', 'mouseup');
                            await _sleep(600);
                        },
                    },
                    {
                        type: 'observe', target: 'qf1', part: 'close-coil',
                        msg: '合闸线圈通电释放锁扣，主开关合闸',
                        async act() { await _sleep(1500); },
                    },
                ],
                check() {
                    const qf = _qf(this);
                    return !!(this._s6Coil && qf && qf.getState() === 'on');
                },
            },
            {
                msg: '7. 按遥控分闸按钮，分励脱扣器分闸。',
                mode: 'check',
                op: [
                    {
                        type: 'btn', target: 'ss', part: 'btn',
                        msg: '按住「分闸」按钮，分励线圈得电',
                        async act() {
                            const sys = _sysOf(this);
                            const ss = _comp(sys, 'ss');
                            _firePart(ss, 'btn', 'mousedown');
                            await _waitFor(sys, s => { const q = _comp(s, 'qf1'); return q && q.getState() === 'off'; }, 6000);
                            const v = sys.getVoltageBetween ? sys.getVoltageBetween('qf1_wire_fla', 'qf1_wire_flb') : 0;
                            this._s7Coil = isFinite(v) && Math.abs(v) > 18;
                            await _sleep(600);
                            _firePart(ss, 'btn', 'mouseup');
                            await _sleep(600);
                        },
                    },
                    {
                        type: 'observe', target: 'qf1', part: 'shunt-coil',
                        msg: '分励线圈通电，脱扣轴转动分闸',
                        async act() { await _sleep(1500); },
                    },
                ],
                check() {
                    const qf = _qf(this);
                    return !!(this._s7Coil && qf && qf.getState() === 'off');
                },
            },
            {
                msg: '8. 按住「模拟失压」按钮，失压线圈失电。',
                mode: 'check',
                op: [
                    {
                        type: 'btn', target: 'sb', part: 'btn',
                        msg: '按住「模拟失压」（常闭触点断开）',
                        async act() {
                            const sys = _sysOf(this);
                            const sb = _comp(sys, 'sb');
                            _firePart(sb, 'btn', 'mousedown');
                            // 等失压线圈失电、脱扣器释放
                            const ok = await _waitFor(sys, s => {
                                const q = _comp(s, 'qf1');
                                return q && q._uvOn === false;
                            }, 5000);
                            this._s8Uv = ok;
                            await _sleep(900);
                        },
                    },
                    {
                        type: 'observe', target: 'qf1', part: 'uv-trip',
                        msg: '失压脱扣器失电，脱扣轴释放',
                        async act() { await _sleep(1500); },
                    },
                    {
                        type: 'btn', target: 'sb', part: 'btn',
                        msg: '松开按钮，失压线圈重新得电',
                        async act() {
                            const sb = _comp(_sysOf(this), 'sb');
                            _firePart(sb, 'btn', 'mouseup');
                            await _sleep(1200);
                        },
                    },
                ],
                check() {
                    return this._s8Uv === true;
                },
            },
            {
                msg: '9. 测试题：合闸线圈的作用',
                mode: 'quiz',
                quizConfig: {
                    question: '框架式空气断路器中合闸线圈的作用是什么？',
                    options: [
                        '得电后释放储能弹簧的锁扣，使储能弹簧能量推动主轴合闸',
                        '分闸时拉动主轴与动触头分离',
                        '为储能电机提供工作电源',
                        '检测主回路的电流并发出跳闸信号',
                    ],
                    answer: 0,
                    analysis: '合闸线圈得电吸合后释放储能弹簧的锁扣，储能弹簧储存的能量通过主轴推动三对动触头与静触头闭合，完成合闸。',
                },
            },
        ],
    },

    'acb-no-close': {
        id: 'acb-no-close',
        name: '3. 主开关不能合闸故障判断和排除',
        steps: [
            {
                msg: '1. 在「故障设置」中勾选主开关合不上闸。',
                mode: 'check',
                op: [
                    {
                        type: 'fault', fault: 'sw_no_close',
                        msg: '打开故障设置界面，勾选并应用',
                        async act() { await _sleep(600); },
                    },
                ],
                check() {
                    const cfg = _sysOf(this).FAULT_CONFIG['sw_no_close'];
                    return !!(cfg && cfg.check());
                },
            },
            {
                msg: '2. 自动接线，起动发电机组，遥控合闸失败。',
                mode: 'check',
                op: [
                    {
                        type: 'wire', button: 'btnAutoWire',
                        msg: '点击「自动接线」',
                        async act() {
                            const sys = _sysOf(this);
                            if (sys && typeof sys.applyAllPresets === 'function') sys.applyAllPresets();
                            await _sleep(1000);
                        },
                    },
                    {
                        type: 'btn', target: 'gen1', part: 'start',
                        msg: '按机旁起动按钮，发电机建压',
                        async act() { await _genStart(this); },
                    },
                    {
                        type: 'btn', target: 'sc', part: 'btn',
                        msg: '按遥控合闸按钮，主开关合不上闸',
                        async act() {
                            const sys = _sysOf(this);
                            await _pressPart(_comp(sys, 'sc'), 'btn', 1500);
                            await _sleep(1200);
                        },
                    },
                ],
                check() {
                    const sys = _sysOf(this);
                    const gen = _comp(sys, 'gen1');
                    return !!(gen && gen.isOn && _wired(sys, 'gen1_wire_u', 'qf1_wire_t1'));
                },
            },
            {
                msg: '3. 看储能指示：未储能则按压储能手柄。',
                mode: 'check',
                op: [
                    {
                        type: 'observe', target: 'qf1', part: 'store-ind',
                        msg: '观察储能指示牌',
                        async act() {
                            const qf = _qf(this);
                            await _sleep(1200);
                            if (qf && qf.isCharged()) await _sleep(800);
                        },
                    },
                    {
                        type: 'btn', target: 'qf1', part: 'handle',
                        msg: '未储能则按压储能手柄 5 次',
                        async act() {
                            const qf = _qf(this);
                            if (qf && qf.isCharged()) { await _sleep(1500); return; }
                            await _chargeByHandle(this, 5);
                            await _sleep(800);
                        },
                    },
                ],
                async check() {
                    const qf = _qf(this);
                    if (!qf) return false;
                    if (qf.isCharged()) return true;
                    // 必须已实际按压储能手柄，且储能仍失败，才判定为储能弹簧故障
                    return qf._handlePressCount > 0 && qf._chargeProg < 1;
                },
                async next() {
                    const qf = _qf(this);
                    if (!qf) return 2;
                    if (qf._faultStoreSpring) return 9;          // 储能弹簧故障 → 第10步
                    if (qf._faultMotorOpen) return 3;            // 储能电机控制回路故障 → 第4步
                    if (qf.isCharged()) return 4;                // 已储能 → 第5步
                    return 2;
                },
            },
            {
                msg: '4. 手动储能成功，说明储能电机控制回路故障。',
                mode: 'check',
                op: [
                    {
                        type: 'observe', target: 'qf1', part: 'store-spring',
                        msg: '储能靠手柄完成，储能电机回路异常',
                        async act() { await _sleep(2500); },
                    },
                ],
                check() {
                    const qf = _qf(this);
                    return !!(qf && qf._faultMotorOpen && qf.isCharged());
                },
                next: 9,
            },
            {
                msg: '5. 按手动合闸按钮：储能释放但合不上闸。',
                mode: 'check',
                op: [
                    {
                        type: 'observe', target: 'qf1', part: 'store-ind',
                        msg: '此时已储能',
                        async act() { await _sleep(1200); },
                    },
                    {
                        type: 'btn', target: 'qf1', part: 'btn-close',
                        msg: '按手动合闸按钮，储能弹簧释放',
                        async act() {
                            const sys = _sysOf(this);
                            _firePart(_qf(this), 'btn-close', 'click');
                            await _waitFor(sys, s => {
                                const q = _comp(s, 'qf1');
                                return q && (q.getState() === 'on' || q._chargeProg < 1);
                            }, 6000);
                            await _sleep(1200);
                        },
                    },
                    {
                        type: 'observe', target: 'qf1', part: 'main-contact',
                        msg: '主触头未闭合（或已闭合），据此分支判断',
                        async act() { await _sleep(1800); },
                    },
                ],
                async check() {
                    const qf = _qf(this);
                    if (!qf) return false;
                    if (qf._faultCloseCoilOpen) {
                        // 合闸回路故障：手动合闸能成功
                        return qf.getState() === 'on';
                    }
                    // 失压类故障：储能已释放但未能合闸
                    return qf._chargeProg < 1 && qf.getState() !== 'on';
                },
                async next() {
                    const qf = _qf(this);
                    if (!qf) return 4;
                    if (qf._faultCloseCoilOpen) return 9;        // 合闸回路故障 → 第10步
                    return 5;                                    // 失压脱扣器故障 → 第6步
                },
            },
            {
                msg: '6. 点击电子脱扣器，确认其工作正常。',
                mode: 'find', target: 'et1',
                next: 6,
            },
            {
                msg: '7. 断电拆线，用万用表 2kΩ 档测失压线圈电阻。',
                mode: 'check',
                op: [
                    {
                        type: 'instrument', instrument: 'multimeter',
                        msg: '选择仪表：勾选数字万用表并关闭界面',
                        async act() { await _sleep(800); },
                    },
                    {
                        type: 'knob', target: 'multimeter', part: 'knob',
                        msg: '旋钮拨到 2kΩ 电阻档',
                        async act() {
                            const mm = _comp(_sysOf(this), 'multimeter');
                            if (mm && mm.setMode) mm.setMode('RES2k');
                            await _sleep(900);
                        },
                    },
                    {
                        type: 'btn', target: 'dc_uv', part: 'power',
                        msg: '按电源键，切断控制电源（测电阻须断电）',
                        async act() { await _dcSet(this, false); },
                    },
                    {
                        type: 'observe', target: 'qf1', ports: ['qf1_wire_uv1', 'sb_wire_nc3'],
                        msg: '拆下失压线圈一端的接线',
                        async act() {
                            _removeWire(_sysOf(this), 'sb_wire_nc3', 'qf1_wire_uv1');
                            await _sleep(900);
                        },
                    },
                    {
                        type: 'observe', target: 'multimeter', ports: ['multimeter_wire_v', 'qf1_wire_uv1'],
                        msg: '红表笔接失压线圈 uv1',
                        async act() { await _wire(_sysOf(this), 'multimeter_wire_v', 'qf1_wire_uv1'); },
                    },
                    {
                        type: 'observe', target: 'multimeter', ports: ['multimeter_wire_com', 'qf1_wire_uv2'],
                        msg: '黑表笔接失压线圈 uv2',
                        async act() { await _wire(_sysOf(this), 'multimeter_wire_com', 'qf1_wire_uv2'); },
                    },
                    {
                        type: 'observe', target: 'multimeter', part: 'lcd',
                        msg: '读数约 2 kΩ；显示 O.L 即线圈断线',
                        async act() { await _sleep(2400); },
                    },
                ],
                check() {
                    const sys = _sysOf(this);
                    const mm = _comp(sys, 'multimeter');
                    if (!mm || !(mm.group && mm.group.visible())) return false;
                    if (!(mm.mode && String(mm.mode).startsWith('RES'))) return false;
                    // 已断开线圈与 +24V 的联系（拆掉一根线），并接上两只表笔
                    if (_wired(sys, 'sb_wire_nc3', 'qf1_wire_uv1')) return false;
                    if (!_probesOnUvCoil(sys)) return false;
                    return typeof _mmReading(sys) === 'number' && isFinite(_mmReading(sys));
                },
                async next() {
                    const qf = _qf(this);
                    if (!qf) return 6;
                    // 失压线圈断线 → 实测 O.L → 第10步
                    if (qf._faultUVCoilOpen) return 9;
                    return 7;
                },
            },
            {
                msg: '8. 接通 24V 后手动按压动衔铁，看能否复位。',
                mode: 'check',
                op: [
                    {
                        type: 'observe', target: 'multimeter',
                        msg: '拔下表笔，收起万用表，接回线圈接线',
                        async act() {
                            const sys = _sysOf(this);
                            _removeProbes(sys);
                            _addWire(sys, 'sb_wire_nc3', 'qf1_wire_uv1');
                            if (typeof sys.toggleInstrumentVisibility === 'function') {
                                sys.toggleInstrumentVisibility('multimeter', false);
                            }
                            await _sleep(900);
                        },
                    },
                    {
                        type: 'btn', target: 'dc_uv', part: 'power',
                        msg: '按电源键恢复 24V 控制电源',
                        async act() { await _dcSet(this, true); await _sleep(800); },
                    },
                    {
                        type: 'btn', target: 'qf1', part: 'uv-armature',
                        msg: '手动按压失压脱扣器动衔铁',
                        async act() {
                            await _pressPart(_qf(this), 'uv-armature', 800);
                            await _sleep(1500);
                        },
                    },
                ],
                check() {
                    const qf = _qf(this);
                    return !!(qf && qf._uvPressCount > 0 && qf._uvPressResult !== null);
                },
                async next() {
                    const qf = _qf(this);
                    if (!qf) return 7;
                    // 按压后脱扣器可复位 → 反作用弹簧弹力过大 → 第10步
                    if (qf._uvPressResult === true) return 9;
                    // 按压后仍无法复位 → 脱扣器卡死 → 第9步
                    return 8;
                },
            },
            {
                msg: '9. 手动按压也无法复位，确认失压脱扣器卡死。',
                mode: 'check',
                op: [
                    {
                        type: 'observe', target: 'qf1', part: 'uv-trip',
                        msg: '脱扣器卡死，脱扣轴不能复位',
                        async act() { await _sleep(2000); },
                    },
                ],
                check() {
                    const qf = _qf(this);
                    return !!(qf && qf._faultUVStuck);
                },
                next: 9,
            },
            {
                msg: '10. 取消故障设置，接回接线，遥控合闸成功。',
                mode: 'check',
                op: [
                    {
                        type: 'observe', target: 'qf1', ports: ['sb_wire_nc3', 'qf1_wire_uv1'],
                        msg: '若第 8 步拆过线，先接回失压线圈',
                        async act() {
                            const sys = _sysOf(this);
                            if (!_wired(sys, 'sb_wire_nc3', 'qf1_wire_uv1')) {
                                _addWire(sys, 'sb_wire_nc3', 'qf1_wire_uv1');
                            }
                            await _sleep(700);
                        },
                    },
                    {
                        type: 'fault', fault: 'sw_no_close', repair: true,
                        msg: '打开故障设置界面，取消勾选并应用',
                        async act() { await _sleep(600); },
                    },
                    {
                        type: 'btn', target: 'qf1', part: 'store-spring',
                        msg: '等储能电机把弹簧重新储满',
                        async act() {
                            await _waitFor(_sysOf(this), s => { const q = _comp(s, 'qf1'); return q && q.isCharged(); }, 10000);
                            await _sleep(800);
                        },
                    },
                    {
                        type: 'btn', target: 'sc', part: 'btn',
                        msg: '按遥控合闸按钮，主开关合闸成功',
                        async act() {
                            const sys = _sysOf(this);
                            await _pressPart(_comp(sys, 'sc'), 'btn', 1500);
                            await _waitFor(sys, s => { const q = _comp(s, 'qf1'); return q && q.getState() === 'on'; }, 6000);
                            await _sleep(1000);
                        },
                    },
                ],
                check() {
                    const sys = _sysOf(this);
                    const cfg = sys.FAULT_CONFIG['sw_no_close'];
                    const qf = _qf(this);
                    return !!(cfg && qf && !cfg.check() && qf.getState() === 'on');
                },
            },
            {
                msg: '11. 测试题：无法合闸的检查顺序',
                mode: 'quiz',
                quizConfig: {
                    question: '船舶发电机主开关无法合闸时，正确的检查顺序是？',
                    options: [
                        '先看储能指示、再试遥控/手动合闸，最后检查失压脱扣器',
                        '直接拆开主开关检查触头磨损情况',
                        '先检查汇流排绝缘电阻，再更换发电机',
                        '反复多次按合闸按钮直到合闸成功',
                    ],
                    answer: 0,
                    analysis: '先判断储能是否到位；遥控合闸无反应时试手动合闸，区分合闸回路故障；储能释放仍合不上则检查失压脱扣器（测线圈电阻、通电试验、按压动衔铁），逐步定位故障。',
                },
            },
        ],
    },

    'acb-drawer-ops': {
        id: 'acb-drawer-ops',
        name: '4. 可抽拉式主开关的操作',
        steps: [
            {
                msg: '1. 摇动手柄，由连接位摇到测试位。',
                mode: 'check',
                op: [
                    {
                        type: 'observe', target: 'qf1', part: 'dial',
                        msg: '工作位圆盘当前指示「连接」',
                        async act() { await _sleep(1300); },
                    },
                    {
                        type: 'btn', target: 'qf1', part: 'dial',
                        msg: '顺时针点击圆盘右半侧 3 次 → 试验位',
                        async act() {
                            const sys = _sysOf(this);
                            await _dialClicks(this, 1, 3);
                            await _waitFor(sys, s => { const q = _comp(s, 'qf1'); return q && q.getWorkPos() === 1; }, 4000);
                            await _sleep(900);
                        },
                    },
                ],
                check() {
                    const qf = _qf(this);
                    return !!(qf && qf.getWorkPos() === 1);   // 试验位
                },
                next: 1,
            },
            {
                msg: '2. 测试题：测试位的特征',
                mode: 'quiz',
                quizConfig: {
                    question: '主开关处于测试位（Test）时，下列描述正确的是？',
                    options: [
                        '主回路与汇流排、发电机断开，控制线圈保持通电，可做分合闸试验',
                        '主回路保持连接，仅断开控制回路',
                        '主回路与全部控制线圈均断开，可安全检修',
                        '主开关仍带额定电流运行，仅仪表切换量程',
                    ],
                    answer: 0,
                    analysis: '测试位时主开关本体从连接位摇出，主回路触头与汇流排、发电机母排脱离（不带电），但控制回路保持连接，可通电进行储能、合闸、分闸动作试验。',
                },
            },
            {
                msg: '3. 继续摇到脱开位（检修位）。',
                mode: 'check',
                op: [
                    {
                        type: 'btn', target: 'qf1', part: 'dial',
                        msg: '再顺时针点击 3 次 → 断开位',
                        async act() {
                            const sys = _sysOf(this);
                            await _dialClicks(this, 1, 3);
                            await _waitFor(sys, s => { const q = _comp(s, 'qf1'); return q && q.getWorkPos() === 2; }, 4000);
                            await _sleep(900);
                        },
                    },
                    {
                        type: 'observe', target: 'qf1', part: 'main-contact',
                        msg: '主回路与控制回路全部断开',
                        async act() { await _sleep(1600); },
                    },
                ],
                check() {
                    const qf = _qf(this);
                    return !!(qf && qf.getWorkPos() === 2);   // 断开位
                },
                next: 3,
            },
            {
                msg: '4. 测试题：脱开位的特征',
                mode: 'quiz',
                quizConfig: {
                    question: '主开关处于脱开位（Disconnected，检修位）时，下列描述正确的是？',
                    options: [
                        '主回路与全部控制线圈均断开，主开关完全断电，可抽出检修',
                        '主回路断开，控制线圈仍通电可操作',
                        '主回路与控制回路均保持连接，仅机械锁定',
                        '主开关仍能正常分合闸运行',
                    ],
                    answer: 0,
                    analysis: '脱开位时主开关从开关柜中完全抽出，主回路触头与汇流排、发电机母排断开，控制回路与脱扣器线圈也全部断开，主开关完全不带电，方可抽出检修。',
                },
            },
            {
                msg: '5. 逆时针摇回测试位。',
                mode: 'check',
                op: [
                    {
                        type: 'btn', target: 'qf1', part: 'dial-left',
                        msg: '逆时针点击圆盘左半侧 3 次 → 试验位',
                        async act() {
                            const sys = _sysOf(this);
                            await _dialClicks(this, -1, 3);
                            await _waitFor(sys, s => { const q = _comp(s, 'qf1'); return q && q.getWorkPos() === 1; }, 4000);
                            await _sleep(900);
                        },
                    },
                ],
                check() {
                    const qf = _qf(this);
                    return !!(qf && qf.getWorkPos() === 1);   // 试验位
                },
                next: 5,
            },
            {
                msg: '6. 继续逆时针摇回连接位（工作位）。',
                mode: 'check',
                op: [
                    {
                        type: 'btn', target: 'qf1', part: 'dial-left',
                        msg: '再逆时针点击 3 次 → 连接位',
                        async act() {
                            const sys = _sysOf(this);
                            await _dialClicks(this, -1, 3);
                            await _waitFor(sys, s => { const q = _comp(s, 'qf1'); return q && q.getWorkPos() === 0; }, 4000);
                            await _sleep(900);
                        },
                    },
                    {
                        type: 'observe', target: 'qf1', part: 'main-contact',
                        msg: '主回路与控制回路恢复接通',
                        async act() { await _sleep(1600); },
                    },
                ],
                check() {
                    const qf = _qf(this);
                    return !!(qf && qf.getWorkPos() === 0);   // 连接位
                },
                next: 6,
            },
            {
                msg: '7. 测试题：连接位（工作位）的特征',
                mode: 'quiz',
                quizConfig: {
                    question: '主开关处于连接位（Connected，工作位）时，下列描述正确的是？',
                    options: [
                        '主回路与汇流排、发电机母排可靠接通，控制线圈通电，正常投入运行',
                        '主回路断开，仅控制回路通电',
                        '主回路与控制回路均断开，可抽出检修',
                        '主回路接通但控制回路断电，无法分合闸',
                    ],
                    answer: 0,
                    analysis: '连接位时主开关完全推入开关柜，主回路触头与汇流排、发电机母排可靠接通，控制回路同时通电，可正常储能、合闸、分闸并接受保护动作。',
                },
            },
        ],
    },
};

// ═══════════════════════════════════════════════════════════════
// 三、组件布局（单页工程，全部同屏）
// ═══════════════════════════════════════════════════════════════

export const componentConfigs = [
    // ── 主回路：同步发电机 → 主开关 → 汇流排 ──
    { Class: SyncGenerator3P, id: 'gen1', x: 90, y: 700, vRms: 230, freq: 50, isOn: false, label: '同步发电机', ratedPower: 400, ratedVoltage: 400, ratedCosPhi: 0.8, visible: true },
    { Class: MarineMainsSwitch, id: 'qf1', x: -100, y: 220, ratedCtrlVoltage: 24, label: '主开关',  visible: true },
    { Class: MarineElectronicTrip, id: 'et1', x: 700, y: 650, In: 100, Un: 380, phase: '3', cosPhi: 0.8, label: 'ET', visible: true },
    // ── 控制端子共用地 ──
    // 主开关 5 个线圈（储能电机 m / 合闸 c / 失压 uv / 分励 fl / 电子脱扣 et）的负极公共接地
    { Class: Ground, id: 'gnd_qf', x: 560, y: 580, visible: true },
    // 电子脱扣器脱扣输出 t2 与 24V 电源负极 vn 公共接地
    { Class: Ground, id: 'gnd_et', x: 890, y: 640, visible: true },
    // 直流 24V 电源负极接地
    { Class: Ground, id: 'gnd_dc', x: 1050, y: 340, visible: true },
    // 主开关控制按钮：停止按钮（红、NC）、起动按钮（绿、NO）与合闸按钮（绿、NO）
    { Class: DiagramStopButton, id: 'sb', x: 780, y: 360, label: '模拟失压', visible: true },
    { Class: DiagramStartButton, id: 'ss', x: 860, y: 440, label: '分闸', visible: true },
    { Class: DiagramStartButton, id: 'sc', x: 700, y: 280, label: '合闸', visible: true },
    { Class: Busbar3P, id: 'bus1', x: 220, y: 30, tapsPerPhase: 6, label: '汇流排', visible: true },

    // ── 控制电源（DC 24V）：失压脱扣线圈 ──
    { Class: DCPower, id: 'dc_uv', x: 1100, y: 150, voltage: 24, isOn: true, label: '失压脱扣电源', visible: true },

    // ── 汇流排馈出支路 ──
    // 支路1（第7列）：三相空气开关 QF2 → 三相感应电机（Y 接法）
    { Class: DiagramThreePhaseACB, id: 'acb_m', x: 1310, y: 470, initState: 'off', label: 'QF2', ratedVoltage: 380, ratedCurrent: 100, tripCurrent: 10, visible: true },
    { Class: InductionMotor2, id: 'im01', x: 1290, y: 620, visible: true,
        R1: 0.50, Lsigma1: 0.00334, Rc: 300, Lm: 0.0796,
        R2: 0.46, Lsigma2: 0.00334,
        J: 0.12, B: 0.01, polePairs: 2,
        ratedPower: 10, ratedSpeed: 1440,
        simpleModel: true, loadTorque: 20 },
    // 支路2（第8列）：三相空气开关 QF3 → 三盏白炽灯（分别接 L1/L2/L3）
    { Class: DiagramThreePhaseACB, id: 'acb_l', x: 1535, y: 460, initState: 'off', label: 'QF3', ratedVoltage: 380, ratedCurrent: 100, tripCurrent: 10, visible: true },
    { Class: IncandescentLamp, id: 'lamp1', x: 1550, y: 670, coldResistance: 4.84, rotation: 90 },
    { Class: IncandescentLamp, id: 'lamp2', x: 1620, y: 670, coldResistance: 4.84, rotation: 90 },
    { Class: IncandescentLamp, id: 'lamp3', x: 1690, y: 670, coldResistance: 4.84, rotation: 90 },
    { Class: Ground, id: 'gnd_l', x: 1650, y: 870, visible: true },

    // ── 7 种保留仪表（默认隐藏，从「选择仪表」调出；位置互不重叠，可拖动）──
    { Class: Multimeter, id: 'multimeter', x: 440, y: 545, visible: false },
    { Class: MF47Multimeter, id: 'mf47-panel', x: 1105, y: 640, visible: false },
    { Class: Oscilloscope_tri, id: 'osc', x: 1230, y: 960, visible: false },
    { Class: RealMegohmMeter, id: 'megohm', x: 60, y: 960, visible: false },
    { Class: ElecMeter, id: 'elecmeter', x: 1620, y: 960, visible: false },
    { Class: SignalGenerator, id: 'sg', x: 430, y: 960, visible: false },
    { Class: ProcessCalibrator, id: 'cali', x: 830, y: 960, visible: false },
];

// ─── 接线辅助（本电路 41 根导线，> 8 根，允许瞬时接线）───

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
        // ── 支路1：汇流排第7列三相 → QF2 → 感应电机（Y 接法）──
        { from: 'bus1_wire_l1_7', to: 'acb_m_wire_l1', type: 'wire' },
        { from: 'bus1_wire_l2_7', to: 'acb_m_wire_l2', type: 'wire' },
        { from: 'bus1_wire_l3_7', to: 'acb_m_wire_l3', type: 'wire' },
        { from: 'acb_m_wire_t1', to: 'im01_wire_u1', type: 'wire' },
        { from: 'acb_m_wire_t2', to: 'im01_wire_v1', type: 'wire' },
        { from: 'acb_m_wire_t3', to: 'im01_wire_w1', type: 'wire' },
        { from: 'im01_wire_u2', to: 'im01_wire_v2', type: 'wire' },
        { from: 'im01_wire_v2', to: 'im01_wire_w2', type: 'wire' },
        // ── 支路2：汇流排第8列三相 → QF3 → 三盏白炽灯（L1/L2/L3 各一）→ 接地 ──
        { from: 'bus1_wire_l1_8', to: 'acb_l_wire_l1', type: 'wire' },
        { from: 'bus1_wire_l2_8', to: 'acb_l_wire_l2', type: 'wire' },
        { from: 'bus1_wire_l3_8', to: 'acb_l_wire_l3', type: 'wire' },
        { from: 'acb_l_wire_t1', to: 'lamp1_wire_l', type: 'wire' },
        { from: 'acb_l_wire_t2', to: 'lamp2_wire_l', type: 'wire' },
        { from: 'acb_l_wire_t3', to: 'lamp3_wire_l', type: 'wire' },
        { from: 'lamp1_wire_r', to: 'gnd_l_wire_gnd', type: 'wire' },
        { from: 'lamp2_wire_r', to: 'gnd_l_wire_gnd', type: 'wire' },
        { from: 'lamp3_wire_r', to: 'gnd_l_wire_gnd', type: 'wire' },
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
        // ── 主开关其余线圈负极 → 公共地：合闸线圈 c2、电子脱扣 et2 ──
        { from: 'qf1_wire_c2', to: 'gnd_qf_wire_gnd', type: 'wire' },
        { from: 'qf1_wire_et2', to: 'gnd_qf_wire_gnd', type: 'wire' },
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
