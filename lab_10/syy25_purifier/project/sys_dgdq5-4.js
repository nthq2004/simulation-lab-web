/**
 * 船舶分油机（S 型 / EPC-60）自动控制仿真项目配置
 *
 * 页 1：分油机运行状态仪
 * 页 2：S 型分油机系统流程 + 机旁控制箱
 * 页 3：EPC-60 控制面板 + 系统模拟图
 */
import { EPC60Panel } from '../components/EPC60Panel.js';
import { EPC60SystemMimic } from '../components/EPC60SystemMimic.js';
import { PurifierStatusPanel } from '../components/PurifierStatusPanel.js';
import { PurifierSystem } from '../components/PurifierSystem.js';
import { PurifierLocalPanel } from '../components/PurifierLocalPanel.js';

import { Multimeter } from '../components/Multimeter.js';
import { MF47Multimeter } from '../components/MF47Multimeter.js';
import { Oscilloscope_tri } from '../components/Osc_tri.js';
import { SignalGenerator } from '../components/SignalGenerator.js';
import { ProcessCalibrator } from '../components/ProcessCalibrator.js';
import { ElecMeter } from '../components/ElecMeter.js';
import { RealMegohmMeter } from '../components/RealMegohmMeter.js';

const _sysOf = (ctx) => (ctx && ctx.sys) ? ctx.sys : window.sys;
const _sleep = (ms) => new Promise(r => setTimeout(r, ms));
const _comp = (sys, id) => (sys && sys.comps) ? sys.comps[id] : null;
const _solver = (sys) => (sys && sys.purifierSolver) ? sys.purifierSolver : null;
const _model = (sys) => { const s = _solver(sys); return s ? s.m : null; };

function _firePartClick(comp, partId) {
    if (!comp) return false;
    try {
        const node = comp.getClickablePartNode && comp.getClickablePartNode(partId);
        if (node && typeof node.fire === 'function') { node.fire('click'); return true; }
    } catch (e) { /* ignore */ }
    return false;
}

async function _clickUntil(comp, partId, pred, maxTimes = 8, gap = 240) {
    for (let i = 0; i < maxTimes; i++) {
        if (pred()) return true;
        _firePartClick(comp, partId);
        await _sleep(gap);
    }
    return pred();
}

async function _waitFor(sys, cond, timeoutMs = 30000, intervalMs = 250) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
        try { if (cond(sys)) return true; } catch (e) { /* ignore */ }
        await _sleep(intervalMs);
    }
    try { return !!cond(sys); } catch (e) { return false; }
}

// ═══════════════════════════════════════════════════════════════
// 页面定义
// ═══════════════════════════════════════════════════════════════

const INSTRUMENTS = ['multimeter', 'mf47-panel', 'osc', 'sg', 'cali', 'elecmeter', 'megohm'];

export const PROJECT_PAGES = [
    { id: 0, name: '索引', type: 'index' },
    {
        id: 1, name: '分油机运行状态',
        comps: ['status', ...INSTRUMENTS],
        desc: '分油机运行状态仪：转速表、TT1、PT1、PT4、PT5、MT、流量、运行时间、排渣次数、分离筒示意、油柜液位、报警列表与下次排渣倒计时。',
    },
    {
        id: 2, name: 'S 型分油机系统与机旁控制',
        comps: ['process', 'local', ...INSTRUMENTS],
        desc: '左侧：S 型分油机系统流程（沉淀柜、进油泵、滤器、加热器、转换阀、分油机半剖、净油柜、排渣柜、工作水模块 SV10/SV15/SV16、控制空气）。右侧：机旁控制箱（主电源、起动/停止、应急停止、机旁/遥控、进油泵、加热器、压力表、振动、报警）。',
    },
    {
        id: 3, name: 'EPC-60 面板与系统模拟图',
        comps: ['epc', 'mimic', ...INSTRUMENTS],
        desc: '左侧：EPC-60 控制面板（LCD、数字键盘、功能键、电源开关、应急停止、电流表）。右侧：EPC-60 系统模拟图（管线、SV4/SV1/SV10/SV15/SV16/SV5、传感器、分油机、加热器、温度控制器、冷却水）。',
    },
];

// ═══════════════════════════════════════════════════════════════
// 组件配置（1920 × 1080 基准坐标）
// ═══════════════════════════════════════════════════════════════

export const componentConfigs = [
    { Class: PurifierStatusPanel, id: 'status', x: 40, y: 20, page: 1, width: 1060, height: 840, visible: true },

    { Class: PurifierSystem, id: 'process', x:-160, y: 25, page: 2, width: 1190, height: 830, visible: true },
    { Class: PurifierLocalPanel, id: 'local', x: 1250, y: 40, page: 2, width: 420, height: 820, visible: true },

    { Class: EPC60Panel, id: 'epc', x: 20, y: 40, page: 3, width: 780, height: 1000, visible: true },
    { Class: EPC60SystemMimic, id: 'mimic', x: 820, y: 40, page: 3, width: 1060, height: 1000, visible: true },

    { Class: Multimeter, id: 'multimeter', x: 1120, y: 200, visible: false },
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

export function initSlider(sys) {
    if (!sys) return;
    sys._noBlinkHighlight = true;
    sys.pageIndexTitle = '船舶分油机自动控制 · 页面索引';
}

/** 工具栏「自动投用」：阀门排列到正常运行位，不启动分油机 */
export function applyAllPresets(opts) {
    if (opts && opts.init) return;
    const sys = _sysOf(this);
    const s = _solver(sys);
    if (!s) return;
    s.setMainPower(true);
    s.setWaterMain(true);
    s.setAirMain(true);
    s.setLocal(false);
    s.setMode('AUTO');
    if (sys.redrawAll) sys.redrawAll();
}

/** 工具栏「起动系统」：快速进入分油运行（教学快捷） */
export async function applyStartSystem() {
    const sys = _sysOf(this);
    const s = _solver(sys);
    if (!s) return;
    if (s.m.state !== 'STANDSTILL') {
        s.resetAll();
    }
    s.quickStart();
    await _sleep(800);
    if (sys.redrawAll) sys.redrawAll();
}

/** 工具栏「5 点步进」：停止 → 升速 → 水封 → 分油 → 排渣 */
export function fiveStep() {
    const sys = _sysOf(this);
    const s = _solver(sys);
    if (!s) return;
    if (sys._fiveStepIdx === undefined) sys._fiveStepIdx = 0;
    const idx = sys._fiveStepIdx % 5;
    sys._fiveStepIdx = idx + 1;
    s.fiveStep(idx);
    if (sys.redrawAll) sys.redrawAll();
}

// ═══════════════════════════════════════════════════════════════
// 故障配置
// ═══════════════════════════════════════════════════════════════

function _faults() {
    const m = _model(window.sys);
    return m ? m.faults : null;
}

function _mkFault(id, name, system, key) {
    return {
        id, name, system,
        check() { const f = _faults(); return !!(f && f[key]); },
        trigger() { const s = _solver(window.sys); if (s) s.setFault(key, true); },
        repair() { const s = _solver(window.sys); if (s) s.repairFault(key); },
    };
}

export const FAULT_CONFIGS = {
    'vibration-high': _mkFault('vibration-high', '分油机振动高', '分油机本体', 'vibration'),
    'bowl-leak': _mkFault('bowl-leak', '分离筒密封失效 / 跑油', '分油机本体', 'leak'),
    'discharge-fail': _mkFault('discharge-fail', '排渣失败（无排渣反馈）', '排渣系统', 'dischargeFail'),
    'temp-low': _mkFault('temp-low', '分油温度低（加热器故障）', '加热系统', 'tempLow'),
    'op-water-low': _mkFault('op-water-low', '工作水压力低', '工作水系统', 'opWaterLow'),
    'transducer': _mkFault('transducer', '水分传感器故障', 'ALCAP 系统', 'transducer'),
    'motor-overload': _mkFault('motor-overload', '分油机电机过载', '电机/起动器', 'motorOverload'),
};

// ═══════════════════════════════════════════════════════════════
// 工作流辅助
// ═══════════════════════════════════════════════════════════════

function _epc(sys) { return _comp(sys, 'epc'); }
function _process(sys) { return _comp(sys, 'process'); }
function _local(sys) { return _comp(sys, 'local'); }

async function _epcClick(sys, part, times = 1, gap = 220) {
    for (let i = 0; i < times; i++) {
        _firePartClick(_epc(sys), part);
        await _sleep(gap);
    }
}

async function _setEpcPower(sys, on) {
    const s = _solver(sys);
    if (!s) return false;
    for (let i = 0; i < 6 && s.m.epcPower !== !!on; i++) {
        _firePartClick(_epc(sys), 'power');
        await _sleep(350);
    }
    return s.m.epcPower === !!on;
}

async function _ensureMainPower(sys, on = true) {
    const s = _solver(sys);
    if (!s) return false;
    for (let i = 0; i < 5 && s.m.mainPower !== !!on; i++) {
        _firePartClick(_local(sys), 'main-power');
        await _sleep(300);
    }
    return s.m.mainPower === !!on;
}

async function _ensureRemote(sys) {
    const s = _solver(sys);
    if (!s) return false;
    for (let i = 0; i < 5 && s.m.local; i++) {
        _firePartClick(_local(sys), 'local-remote');
        await _sleep(300);
    }
    return !s.m.local;
}

async function _ensureLocal(sys) {
    const s = _solver(sys);
    if (!s) return false;
    for (let i = 0; i < 5 && !s.m.local; i++) {
        _firePartClick(_local(sys), 'local-remote');
        await _sleep(300);
    }
    return !!s.m.local;
}

async function _ensureSupply(sys) {
    const s = _solver(sys);
    const p = _process(sys);
    if (!s) return false;
    for (let i = 0; i < 4 && !s.m.water.mainOpen; i++) { _firePartClick(p, 'water-inlet'); await _sleep(260); }
    for (let i = 0; i < 4 && !s.m.water.airMainOpen; i++) { _firePartClick(p, 'air-inlet'); await _sleep(260); }
    await _waitFor(sys, x => _model(x).water.supply > 2 && _model(x).water.air > 5, 6000, 200);
    return s.m.water.mainOpen && s.m.water.airMainOpen;
}

async function _ensurePump(sys, on) {
    const s = _solver(sys);
    if (!s) return false;
    for (let i = 0; i < 5 && s.m.feed.pumpOn !== !!on; i++) {
        _firePartClick(_local(sys), 'feed-pump');
        await _sleep(280);
    }
    return s.m.feed.pumpOn === !!on;
}

async function _ensureHeater(sys, on) {
    const s = _solver(sys);
    if (!s) return false;
    for (let i = 0; i < 5 && s.m.feed.heaterOn !== !!on; i++) {
        _firePartClick(_local(sys), 'heater');
        await _sleep(280);
    }
    return s.m.feed.heaterOn === !!on;
}

async function _ensureValve(sys, id, on) {
    const s = _solver(sys);
    if (!s) return false;
    const get = () => id === 'v1' ? s.m.feed.valveOpen
        : id === 'v5' ? s.m.water.drain : s.m.water[id];
    for (let i = 0; i < 5 && get() !== !!on; i++) {
        _firePartClick(_process(sys), id);
        await _sleep(280);
    }
    return get() === !!on;
}

async function _ensureStarted(sys) {
    await _setEpcPower(sys, true);
    await _ensureMainPower(sys, true);
    await _ensureRemote(sys);
    await _ensureSupply(sys);
    const s = _solver(sys);
    if (!s) return false;
    // 若上一次停机程序尚未结束，先等它回到 STANDSTILL
    if (!['STANDSTILL', 'STARTING', 'START_SEQ', 'STANDBY', 'SEPARATION'].includes(s.m.state)) {
        await _waitFor(sys, x => _model(x).state === 'STANDSTILL', 900000, 300);
    }
    if (s.m.state === 'STANDSTILL') {
        _firePartClick(_epc(sys), 'separation');
        await _sleep(500);
    }
    return _waitFor(sys, x => {
        const m = _model(x);
        return m && ['STARTING', 'START_SEQ', 'STANDBY', 'SEPARATION'].includes(m.state);
    }, 20000, 250);
}

async function _waitSeparation(sys, timeout = 600000) {
    timeout = Math.max(timeout, 600000);
    return _waitFor(sys, x => {
        const m = _model(x);
        return !!(m && m.state === 'SEPARATION' && m.feed.flow > 0.3 && m.bowl.speed > 9000);
    }, timeout, 300);
}

async function _epcSetParam(sys, key, value) {
    const s = _solver(sys);
    const epc = _epc(sys);
    if (!s || !epc) return false;
    const u = epc._ui;
    // 回到主界面
    for (let i = 0; i < 4 && u.page !== 'main'; i++) { _firePartClick(epc, 'info'); await _sleep(220); }
    // 进入菜单
    _firePartClick(epc, 'enter'); await _sleep(260);
    // 菜单光标移到“参数设置”
    for (let i = 0; i < 6 && u.menu !== 0; i++) { _firePartClick(epc, 'minus'); await _sleep(180); }
    _firePartClick(epc, 'enter'); await _sleep(260);
    // 参数条目
    const items = epc._paramItems();
    const idx = items.findIndex(it => it[0] === key);
    if (idx < 0) return false;
    for (let i = 0; i < 20 && u.param !== idx; i++) {
        _firePartClick(epc, u.param < idx ? 'plus' : 'minus');
        await _sleep(160);
    }
    // 进入编辑
    _firePartClick(epc, 'enter'); await _sleep(220);
    const item = items[idx];
    const step = item[3] || 1;
    for (let i = 0; i < 300 && Math.abs(u.editVal - value) > step / 2; i++) {
        _firePartClick(epc, u.editVal < value ? 'plus' : 'minus');
        await _sleep(90);
    }
    // 保存
    _firePartClick(epc, 'enter'); await _sleep(280);
    // 返回主界面
    for (let i = 0; i < 4 && u.page !== 'main'; i++) { _firePartClick(epc, 'info'); await _sleep(200); }
    return Math.abs(s.getParam(key) - value) < step / 2;
}

async function _resetAlarms(sys) {
    const s = _solver(sys);
    if (!s) return false;
    for (let i = 0; i < 5; i++) {
        const active = s.m.alarms.some(a => a.active);
        if (!active) break;
        _firePartClick(_epc(sys), 'alarm-reset');
        await _sleep(300);
    }
    return !s.m.alarms.some(a => a.active);
}

// ═══════════════════════════════════════════════════════════════
// 工作流
// ═══════════════════════════════════════════════════════════════

export const PROJECT_WORKFLOWS = {
    'purifier-start': {
        id: 'purifier-start', name: '1. 分油机自动起动与分油操作',
        steps: [
            {
                msg: '第 1 步：认识页 1 的分油机运行状态仪与页 3 的 EPC-60 控制面板。EPC-60 面板包括 LCD、数字键盘、起动/停止、排渣、报警复位、CIP、信息键，以及电源开关、应急停止和电流表；右侧为 P&ID 风格系统模拟图；状态仪显示转速、温度、压力、水分、流量、油柜液位和报警。',
                mode: 'find', target: ['status', 'epc', 'mimic'], demoTarget: ['status', 'epc', 'mimic'],
            },
            {
                msg: '第 2 步：切换到页 2，认识 S 型分油机系统流程与机旁控制箱。流程包括沉淀柜、进油泵、滤器、加热器、转换阀 V1、分油机本体、净油柜、排渣柜、工作水模块 SV10/SV15/SV16 和控制空气。',
                mode: 'find', target: ['process', 'local'], demoTarget: ['process', 'local'],
            },
            {
                msg: '第 3 步：起动前检查——打开工作水进口阀（2～8 bar）和控制空气进口阀（5～7 bar），合上机旁主电源，机旁/遥控开关置于「遥控」。',
                mode: 'check',
                op: [
                    { type: 'page', page: 2, msg: '切换到页 2（系统流程与机旁控制）' },
                    { type: 'switch', target: 'process', part: 'water-inlet', msg: '打开工作水进口阀，观察压力升到 2 bar 以上',
                      async act() { const s = _sysOf(this); await _ensureSupply(s); await _sleep(500); } },
                    { type: 'switch', target: 'process', part: 'air-inlet', msg: '打开控制空气进口阀，观察压力升到 5 bar 以上',
                      async act() { const s = _sysOf(this); await _ensureSupply(s); await _sleep(500); } },
                    { type: 'switch', target: 'local', part: 'main-power', msg: '合上机旁主电源开关',
                      async act() { const s = _sysOf(this); await _ensureMainPower(s, true); } },
                    { type: 'switch', target: 'local', part: 'local-remote', msg: '机旁/遥控开关置于「遥控」',
                      async act() { const s = _sysOf(this); await _ensureRemote(s); } },
                    { type: 'observe', target: 'local', msg: '观察工作水压力表 2～6 bar、控制空气压力表 5～7 bar，电流表为 0',
                      async act() { const s = _sysOf(this); await _waitFor(s, x => { const m = _model(x); return m.water.supply > 2 && m.water.air > 5; }, 8000, 250); await _sleep(1000); } },
                ],
                check() {
                    const s = _sysOf(this), m = _model(s);
                    return !!(m && m.mainPower && !m.local && m.water.mainOpen && m.water.airMainOpen
                        && m.water.supply > 2 && m.water.air > 5);
                },
            },
            {
                msg: '第 4 步：回到页 3，给 EPC-60 上电，按绿色「I」键起动分油机。',
                mode: 'check',
                op: [
                    { type: 'page', page: 3, msg: '切换到页 3（EPC-60 面板与系统模拟图）' },
                    { type: 'switch', target: 'epc', part: 'power', msg: '合上 EPC-60 电源开关',
                      async act() { const s = _sysOf(this); await _setEpcPower(s, true); } },
                    { type: 'btn', target: 'epc', part: 'separation', msg: '按绿色「I」键起动分油机',
                      async act() { const s = _sysOf(this); const sol = _solver(s); if (sol && sol.m.state === 'STANDSTILL') { _firePartClick(_epc(s), 'separation'); await _sleep(600); } } },
                ],
                check() {
                    const s = _sysOf(this), m = _model(s);
                    return !!(m && m.epcPower && m.motor.on
                        && ['STARTING', 'START_SEQ', 'STANDBY', 'SEPARATION'].includes(m.state));
                },
            },
            {
                msg: '第 5 步：观察起动程序——分离筒升速到约 10680 r/min，4000 r/min 时关闭水脉冲；达到转速后先预排渣、再关闭分离筒并建立水封；加热器把油温升到 98 °C 后自动进油。',
                mode: 'check',
                op: [
                    { type: 'observe', target: 'status', msg: '观察转速、振动、油温和水封状态',
                      async act() { const s = _sysOf(this); await _waitSeparation(s, 120000); await _sleep(1500); } },
                    { type: 'page', page: 2, msg: '切换到页 2，观察系统流程', async act() { await _sleep(400); } },
                    { type: 'observe', target: 'process', part: 'separator', msg: '观察分离盘组旋转、水封建立、V1 打开、进油流量建立',
                      async act() { const s = _sysOf(this); await _waitSeparation(s, 60000); await _sleep(1500); } },
                ],
                check() {
                    const s = _sysOf(this), m = _model(s);
                    return !!(m && m.state === 'SEPARATION' && m.bowl.speed > 9000
                        && m.bowl.closed && m.bowl.waterSeal && m.feed.flow > 0.3);
                },
            },
            {
                msg: '第 6 步：思考题——分油机排渣前为什么要先加置换水？',
                mode: 'quiz',
                quizConfig: {
                    question: 'S 型分油机排渣前先加入置换水的主要目的是什么？',
                    options: [
                        '把分离筒内的净油赶出，减少排渣时随渣排掉的油损失',
                        '降低分离筒转速',
                        '提高进油温度',
                        '清洗工作水滤器',
                    ],
                    answer: 0,
                    analysis: '排渣前关闭进油阀 V1，经 SV10 加入置换水，把筒内净油置换到净油出口，然后再用开启水 SV15 打开排渣口。这样可显著减少排渣带油损失。',
                },
            },
            {
                msg: '第 7 步：观察自动排渣程序——关闭进油阀 → SV10 加置换水 → SV15 开启水打开排渣口 → 等待 → SV16 关闭水关闭分离筒 → SV10 补水封 → 恢复进油。',
                mode: 'check',
                op: [
                    { type: 'page', page: 2, msg: '切换到页 2（系统流程）' },
                    { type: 'observe', target: 'process', part: 'separator', msg: '观察排渣时滑动底盘下移、排渣口打开、渣流入排渣柜',
                      async act() {
                          const s = _sysOf(this);
                          const before = _model(s).counters.dischargeCount;
                          await _waitFor(s, x => _model(x).counters.dischargeCount > before, 420000, 300);
                          this._projFlag = this._projFlag || {};
                          if (_model(s).counters.dischargeCount > before) this._projFlag.purifierDischarged = true;
                          await _sleep(1500);
                      } },
                ],
                check() {
                    const s = _sysOf(this), m = _model(s);
                    return !!(m && (m.counters.dischargeCount > 0 || (this._projFlag && this._projFlag.purifierDischarged)));
                },
            },
            {
                msg: '第 8 步：正常停机——按 EPC-60 的「STOP」，系统自动完成断油、置换水、排渣、停电机、降速，最后显示 STANDSTILL。',
                mode: 'check',
                op: [
                    { type: 'page', page: 3, msg: '切换到页 3（EPC-60 面板）' },
                    { type: 'btn', target: 'epc', part: 'stop', msg: '按红色「O」键停止，观察停机程序',
                      async act() { const s = _sysOf(this); _firePartClick(_epc(s), 'stop'); await _sleep(800); } },
                    { type: 'observe', target: 'status', msg: '观察转速下降、程序结束后显示 STANDSTILL',
                      async act() { const s = _sysOf(this); await _waitFor(s, x => _model(x).state === 'STANDSTILL', 900000, 300); await _sleep(1200); } },
                ],
                check() {
                    const s = _sysOf(this), m = _model(s);
                    return !!(m && m.state === 'STANDSTILL' && !m.motor.on && m.bowl.speed < 100);
                },
            },
        ],
    },

    'purifier-params': {
        id: 'purifier-params', name: '2. EPC-60 参数设置与手动排渣',
        steps: [
            {
                msg: '第 1 步：点击工具栏「起动系统」，快速进入正常分油状态（教学快捷）。',
                mode: 'check',
                op: [
                    { type: 'page', page: 1, msg: '切换到页 1（分油机运行状态）' },
                    { type: 'wire', button: 'btnStartSys', msg: '箭头指向工具栏「起动系统」按钮', flashMs: 2200, holdMs: 900,
                      async act() { const btn = document.getElementById('btnStartSys'); if (btn) btn.click(); await _sleep(1000); } },
                    { type: 'observe', target: 'status', msg: '观察系统进入 SEPARATION 正常分油',
                      async act() { const s = _sysOf(this); await _waitSeparation(s, 90000); await _sleep(1000); } },
                ],
                check() {
                    const s = _sysOf(this), m = _model(s);
                    return !!(m && m.state === 'SEPARATION' && m.feed.flow > 0.3);
                },
            },
            {
                msg: '第 2 步：通过 EPC-60 面板菜单修改参数——排渣间隔改为 10 min，进油流量改为 1.2 m³/h，水分触发值改为 12 pF。操作顺序：↵ 进入菜单 → 参数设置 → 选择条目 → ↵ 修改 → ▲▼ 调整或数字键输入 → ↵ 保存。',
                mode: 'check',
                op: [
                    { type: 'knob', target: 'epc', part: 'enter', msg: '进入 EPC-60 参数菜单，修改排渣间隔',
                      async act() { const s = _sysOf(this); await _epcSetParam(s, 'dischargeInterval', 10); await _sleep(500); } },
                    { type: 'knob', target: 'epc', part: 'plus', msg: '修改进油流量为 1.2 m³/h',
                      async act() { const s = _sysOf(this); await _epcSetParam(s, 'flow', 1.2); await _sleep(500); } },
                    { type: 'knob', target: 'epc', part: 'plus', msg: '修改水分触发值为 12 pF',
                      async act() { const s = _sysOf(this); await _epcSetParam(s, 'waterTrigger', 12); await _sleep(500); } },
                ],
                check() {
                    const s = _sysOf(this), m = _model(s);
                    return !!(m && Math.abs(m.params.dischargeInterval - 10) < 0.5
                        && Math.abs(m.params.flow - 1.2) < 0.06
                        && Math.abs(m.params.waterTrigger - 12) < 0.5);
                },
            },
            {
                msg: '第 3 步：查看 EPC-60 的运行信息与时间页——确认 TT1、PT4、MT、转速、运行时间和下次排渣倒计时。',
                mode: 'check',
                op: [
                    { type: 'knob', target: 'epc', part: 'info', msg: '按 INFO 查看运行信息',
                      async act() { const s = _sysOf(this); const epc = _epc(s); for (let i = 0; i < 3; i++) { _firePartClick(epc, 'info'); await _sleep(300); } } },
                    { type: 'observe', target: 'status', msg: '观察状态仪上的温度、压力、水分、流量与排渣倒计时', async act() { await _sleep(1200); } },
                ],
                check() {
                    const s = _sysOf(this), m = _model(s);
                    const epc = _comp(s, 'epc');
                    return !!(m && epc && epc._ui.page === 'info' && m.state === 'SEPARATION' && m.feed.temp > 90);
                },
            },
            {
                msg: '第 4 步：按 EPC-60 的「DISCHARGE」执行一次手动排渣，观察排渣程序与排渣次数增加。',
                mode: 'check',
                op: [
                    { type: 'btn', target: 'epc', part: 'discharge', msg: '按「DISCHARGE」手动排渣',
                      async act() {
                          const s = _sysOf(this);
                          const before = _model(s).counters.dischargeCount;
                          _firePartClick(_epc(s), 'discharge');
                          await _waitFor(s, x => _model(x).counters.dischargeCount > before, 60000, 300);
                          this._projFlag = this._projFlag || {};
                          if (_model(s).counters.dischargeCount > before) this._projFlag.manualDischarged = true;
                          await _sleep(800);
                      } },
                ],
                check() {
                    const s = _sysOf(this), m = _model(s);
                    return !!(m && (m.counters.dischargeCount > 0 || (this._projFlag && this._projFlag.manualDischarged)));
                },
            },
            {
                msg: '第 5 步：填空题——S 型分油机的正常工作水压力范围是（ ）bar，控制空气压力范围是（ ）bar。',
                mode: 'fill',
                fields: [
                    { label: '工作水压力下限', unit: 'bar', answer: 2, tolerance: 0.05 },
                    { label: '工作水压力上限', unit: 'bar', answer: 8, tolerance: 0.05 },
                    { label: '控制空气压力下限', unit: 'bar', answer: 5, tolerance: 0.05 },
                ],
            },
        ],
    },

    'purifier-fault': {
        id: 'purifier-fault', name: '3. 分油机常见故障判断与处理',
        steps: [
            {
                msg: '第 1 步：点击工具栏「起动系统」，进入正常分油状态，作为故障演示的基础。',
                mode: 'check',
                op: [
                    { type: 'page', page: 1, msg: '切换到页 1' },
                    { type: 'wire', button: 'btnStartSys', msg: '箭头指向工具栏「起动系统」按钮', flashMs: 2200, holdMs: 900,
                      async act() { const btn = document.getElementById('btnStartSys'); if (btn) btn.click(); await _sleep(1000); } },
                    { type: 'observe', target: 'status', msg: '观察进入 SEPARATION',
                      async act() { const s = _sysOf(this); await _waitSeparation(s, 90000); await _sleep(800); } },
                ],
                check() { const s = _sysOf(this), m = _model(s); return !!(m && m.state === 'SEPARATION'); },
            },
            {
                msg: '第 2 步：设置「排渣失败（无排渣反馈）」故障，然后按 EPC-60 的「DISCHARGE」或等待自动排渣。分油机排渣时收不到排渣口打开反馈，EPC-60 会重试一次；仍失败则报警并停机。',
                mode: 'check',
                op: [
                    { type: 'page', page: 2, msg: '切换到页 2（系统流程）' },
                    { type: 'fault', fault: 'discharge-fail', msg: '打开故障设置界面，勾选「排渣失败」并应用', async act() { await _sleep(400); } },
                    { type: 'btn', target: 'epc', part: 'discharge', msg: '按「DISCHARGE」触发排渣，观察无反馈后的重试与报警',
                      async act() { const s = _sysOf(this); const sol = _solver(s); if (sol && ['SEPARATION', 'STANDBY'].includes(sol.m.state)) { _firePartClick(_epc(s), 'discharge'); await _sleep(600); } } },
                    { type: 'observe', target: 'process', part: 'separator', msg: '观察排渣失败与报警',
                      async act() { const s = _sysOf(this); await _waitFor(s, x => _model(x).alarms.some(a => a.active && a.code === 'A04'), 60000, 300); await _sleep(1200); } },
                ],
                check() {
                    const s = _sysOf(this), m = _model(s);
                    return !!(m && m.faults.dischargeFail && m.alarms.some(a => a.active && a.code === 'A04'));
                },
            },
            {
                msg: '第 3 步：在故障设置界面取消「排渣失败」，按 EPC-60 的「ALARM RESET」确认并复位报警，然后重新起动分油机。',
                mode: 'check',
                op: [
                    { type: 'fault', fault: 'discharge-fail', repair: true, msg: '取消「排渣失败」故障并应用', async act() { await _sleep(400); } },
                    { type: 'btn', target: 'epc', part: 'alarm-reset', msg: '按「ALARM RESET」确认/复位报警',
                      async act() { const s = _sysOf(this); await _resetAlarms(s); } },
                    { type: 'observe', target: 'status', msg: '确认报警消失后重新起动',
                      async act() { const s = _sysOf(this); await _ensureStarted(s); await _waitSeparation(s, 90000); await _sleep(800); } },
                ],
                check() {
                    const s = _sysOf(this), m = _model(s);
                    return !!(m && !m.faults.dischargeFail && !m.alarms.some(a => a.active) && m.state === 'SEPARATION');
                },
            },
            {
                msg: '第 4 步：设置「分离筒密封失效 / 跑油」故障。净油压力 PT4 迅速下降，EPC-60 报警并切断进油、执行停机程序。',
                mode: 'check',
                op: [
                    { type: 'page', page: 2, msg: '切换到页 2' },
                    { type: 'fault', fault: 'bowl-leak', msg: '勾选「分离筒密封失效 / 跑油」并应用', async act() { await _sleep(400); } },
                    { type: 'observe', target: 'process', part: 'pt4', msg: '观察 PT4 下降、跑油痕迹与 OIL LEAKING 报警',
                      async act() { const s = _sysOf(this); await _waitFor(s, x => _model(x).alarms.some(a => a.active && a.code === 'A03'), 30000, 250); await _sleep(1200); } },
                ],
                check() {
                    const s = _sysOf(this), m = _model(s);
                    return !!(m && m.faults.leak && m.alarms.some(a => a.active && a.code === 'A03'));
                },
            },
            {
                msg: '第 5 步：修复跑油故障并复位报警，重新起动进入正常分油；再设置「分油机振动高」故障，观察振动超限停机与 HIGH VIBRATION 报警。',
                mode: 'check',
                op: [
                    { type: 'fault', fault: 'bowl-leak', repair: true, msg: '取消跑油故障并应用', async act() { await _sleep(400); } },
                    { type: 'btn', target: 'epc', part: 'alarm-reset', msg: '复位报警', async act() { const s = _sysOf(this); await _resetAlarms(s); } },
                    { type: 'observe', target: 'status', msg: '重新起动并进入正常分油，为振动故障演示做准备',
                      async act() { const s = _sysOf(this); await _ensureStarted(s); await _waitSeparation(s, 90000); await _sleep(800); } },
                    { type: 'fault', fault: 'vibration-high', msg: '勾选「分油机振动高」并应用', async act() { await _sleep(400); } },
                    { type: 'observe', target: 'status', msg: '观察振动值超限、电机停转与 HIGH VIBRATION - SHUTDOWN 报警',
                      async act() { const s = _sysOf(this); await _waitFor(s, x => _model(x).alarms.some(a => a.active && a.code === 'A01'), 20000, 250); await _sleep(1200); } },
                ],
                check() {
                    const s = _sysOf(this), m = _model(s);
                    return !!(m && m.faults.vibration && m.alarms.some(a => a.active && a.code === 'A01'));
                },
            },
        ],
    },

    'purifier-stop': {
        id: 'purifier-stop', name: '4. 正常停机与应急停机',
        steps: [
            {
                msg: '第 1 步：点击工具栏「起动系统」，进入正常分油状态。',
                mode: 'check',
                op: [
                    { type: 'page', page: 1, msg: '切换到页 1' },
                    { type: 'wire', button: 'btnStartSys', msg: '箭头指向工具栏「起动系统」按钮', flashMs: 2200, holdMs: 900,
                      async act() { const btn = document.getElementById('btnStartSys'); if (btn) btn.click(); await _sleep(1000); } },
                    { type: 'observe', target: 'status', msg: '观察进入 SEPARATION',
                      async act() { const s = _sysOf(this); await _waitSeparation(s, 90000); await _sleep(800); } },
                ],
                check() { const s = _sysOf(this), m = _model(s); return !!(m && m.state === 'SEPARATION'); },
            },
            {
                msg: '第 2 步：按 EPC-60 的「STOP」执行正常停机——断油、加置换水、排渣、停电机、降速，最后显示 STANDSTILL。',
                mode: 'check',
                op: [
                    { type: 'btn', target: 'epc', part: 'stop', msg: '按「STOP」执行停机程序',
                      async act() { const s = _sysOf(this); _firePartClick(_epc(s), 'stop'); await _sleep(800); } },
                    { type: 'observe', target: 'status', msg: '观察停机程序与转速下降',
                      async act() { const s = _sysOf(this); await _waitFor(s, x => _model(x).state === 'STANDSTILL', 900000, 300); await _sleep(1200); } },
                ],
                check() { const s = _sysOf(this), m = _model(s); return !!(m && m.state === 'STANDSTILL' && m.bowl.speed < 100); },
            },
            {
                msg: '第 3 步：重新起动分油机，等待进入正常分油，为应急停机演示做准备。',
                mode: 'check',
                op: [
                    { type: 'btn', target: 'epc', part: 'separation', msg: '再次按「SEPARATION」起动',
                      async act() { const s = _sysOf(this); const sol = _solver(s); if (sol && sol.m.state === 'STANDSTILL') { _firePartClick(_epc(s), 'separation'); await _sleep(600); } } },
                    { type: 'observe', target: 'status', msg: '等待重新进入 SEPARATION',
                      async act() { const s = _sysOf(this); await _waitSeparation(s, 120000); await _sleep(800); } },
                ],
                check() { const s = _sysOf(this), m = _model(s); return !!(m && m.state === 'SEPARATION'); },
            },
            {
                msg: '第 4 步：切换到页 2，按下机旁控制箱的「EMERGENCY STOP」蘑菇按钮。电机、加热器、进油泵立即停止，EPC-60 发出应急停止报警。',
                mode: 'check',
                op: [
                    { type: 'page', page: 2, msg: '切换到页 2（机旁控制箱）' },
                    { type: 'btn', target: 'local', part: 'emergency', msg: '按下应急停止蘑菇按钮',
                      async act() { const s = _sysOf(this); _firePartClick(_local(s), 'emergency'); await _sleep(800); } },
                    { type: 'observe', target: 'status', msg: '观察电机停转、报警灯亮、EMERGENCY STOP 报警',
                      async act() { const s = _sysOf(this); await _waitFor(s, x => _model(x).emergency, 8000, 200); await _sleep(1200); } },
                ],
                check() {
                    const s = _sysOf(this), m = _model(s);
                    return !!(m && m.emergency && !m.motor.on && m.alarms.some(a => a.active && a.code === 'A14'));
                },
            },
            {
                msg: '第 5 步：等待分离筒完全静止（转速 < 100 r/min），再旋转复位应急停止按钮，报警复位后系统回到 STANDSTILL。',
                mode: 'check',
                op: [
                    { type: 'observe', target: 'local', msg: '等待分离筒完全静止',
                      async act() { const s = _sysOf(this); await _waitFor(s, x => _model(x).bowl.speed < 100, 900000, 300); await _sleep(800); } },
                    { type: 'btn', target: 'local', part: 'emergency', msg: '旋转复位应急停止按钮',
                      async act() { const s = _sysOf(this); _firePartClick(_local(s), 'emergency'); await _sleep(500); } },
                    { type: 'btn', target: 'epc', part: 'alarm-reset', msg: '按「ALARM RESET」复位报警',
                      async act() { const s = _sysOf(this); await _resetAlarms(s); } },
                ],
                check() {
                    const s = _sysOf(this), m = _model(s);
                    return !!(m && !m.emergency && m.state === 'STANDSTILL' && !m.alarms.some(a => a.active));
                },
            },
        ],
    },

    'purifier-local': {
        id: 'purifier-local', name: '5. 机旁控制与应急操作',
        steps: [
            {
                msg: '第 1 步：在页 3 给 EPC-60 上电；切换到页 2，打开工作水与控制空气进口阀，合上机旁主电源，机旁/遥控开关置于「LOCAL」。',
                mode: 'check',
                op: [
                    { type: 'page', page: 3, msg: '切换到页 3（EPC-60 面板）' },
                    { type: 'switch', target: 'epc', part: 'power', msg: '给 EPC-60 上电',
                      async act() { const s = _sysOf(this); await _setEpcPower(s, true); } },
                    { type: 'page', page: 2, msg: '切换到页 2（机旁控制）' },
                    { type: 'switch', target: 'process', part: 'water-inlet', msg: '打开工作水进口阀',
                      async act() { const s = _sysOf(this); await _ensureSupply(s); } },
                    { type: 'switch', target: 'process', part: 'air-inlet', msg: '打开控制空气进口阀',
                      async act() { const s = _sysOf(this); await _ensureSupply(s); } },
                    { type: 'switch', target: 'local', part: 'main-power', msg: '合上机旁主电源',
                      async act() { const s = _sysOf(this); await _ensureMainPower(s, true); } },
                    { type: 'switch', target: 'local', part: 'local-remote', msg: '机旁/遥控开关置于「LOCAL」',
                      async act() { const s = _sysOf(this); await _ensureLocal(s); } },
                ],
                check() {
                    const s = _sysOf(this), m = _model(s);
                    return !!(m && m.epcPower && m.mainPower && m.local
                        && m.water.mainOpen && m.water.airMainOpen);
                },
            },
            {
                msg: '第 2 步：按机旁控制箱的「START」按钮起动机电，观察电流表与转速上升。',
                mode: 'check',
                op: [
                    { type: 'btn', target: 'local', part: 'start', msg: '按机旁「START」按钮',
                      async act() { const s = _sysOf(this); _firePartClick(_local(s), 'start'); await _sleep(600); } },
                    { type: 'observe', target: 'local', msg: '观察电流表上升、运行指示灯亮、转速升到 4000 r/min 以上',
                      async act() { const s = _sysOf(this); await _waitFor(s, x => _model(x).bowl.speed > 4000, 120000, 250); await _sleep(1000); } },
                ],
                check() {
                    const s = _sysOf(this), m = _model(s);
                    return !!(m && m.motor.on && m.bowl.speed > 4000);
                },
            },
            {
                msg: '第 3 步：把机旁/遥控开关切回「遥控」，EPC-60 在 AUTO 下自动完成预排渣、水封、加热与进油，进入正常分油。',
                mode: 'check',
                op: [
                    { type: 'switch', target: 'local', part: 'local-remote', msg: '机旁/遥控开关切回「遥控」',
                      async act() { const s = _sysOf(this); await _ensureRemote(s); } },
                    { type: 'observe', target: 'status', msg: '观察系统自动进入 SEPARATION',
                      async act() { const s = _sysOf(this); await _waitSeparation(s, 600000); await _sleep(800); } },
                ],
                check() {
                    const s = _sysOf(this), m = _model(s);
                    return !!(m && !m.local && m.state === 'SEPARATION' && m.feed.flow > 0.3);
                },
            },
            {
                msg: '第 4 步：按下机旁控制箱的「EMERGENCY STOP」蘑菇按钮，电机、加热器、进油泵立即停止，EPC-60 发出应急停止报警。',
                mode: 'check',
                op: [
                    { type: 'btn', target: 'local', part: 'emergency', msg: '按下应急停止蘑菇按钮',
                      async act() { const s = _sysOf(this); _firePartClick(_local(s), 'emergency'); await _sleep(800); } },
                    { type: 'observe', target: 'status', msg: '观察电机停转、报警灯亮、EMERGENCY STOP 报警',
                      async act() { const s = _sysOf(this); await _waitFor(s, x => _model(x).emergency, 8000, 200); await _sleep(1200); } },
                ],
                check() {
                    const s = _sysOf(this), m = _model(s);
                    return !!(m && m.emergency && !m.motor.on && m.alarms.some(a => a.active && a.code === 'A14'));
                },
            },
            {
                msg: '第 5 步：等待分离筒完全静止（转速 < 100 r/min），旋转复位应急停止按钮，按 EPC-60 的「ALARM RESET」复位报警。',
                mode: 'check',
                op: [
                    { type: 'observe', target: 'local', msg: '等待分离筒完全静止',
                      async act() { const s = _sysOf(this); await _waitFor(s, x => _model(x).bowl.speed < 100, 900000, 300); await _sleep(800); } },
                    { type: 'btn', target: 'local', part: 'emergency', msg: '旋转复位应急停止按钮',
                      async act() { const s = _sysOf(this); _firePartClick(_local(s), 'emergency'); await _sleep(500); } },
                    { type: 'btn', target: 'epc', part: 'alarm-reset', msg: '按「ALARM RESET」复位报警',
                      async act() { const s = _sysOf(this); await _resetAlarms(s); } },
                ],
                check() {
                    const s = _sysOf(this), m = _model(s);
                    return !!(m && !m.emergency && m.state === 'STANDSTILL' && !m.alarms.some(a => a.active));
                },
            },
        ],
    },
};
