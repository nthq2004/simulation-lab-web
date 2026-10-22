// 塑壳式断路器（MCCB）测试电路
//
// 主回路：三相电源(230V/50Hz, 线电压≈398V) → 塑壳式断路器 QF(三极) → 三相可调负载(角形 Δ)
//         —— 负载角形联接，无中性点，仅 3 根线
// 控制回路：24V 直流电源 → 常开按钮 SB → 分励脱扣线圈 fla/flb
//
// 三相可调负载初始：cosφ = 1，有功 69kW
//   Δ 接：每元件跨线电压 UL≈398V，RΔ = 3·UL²/P = 6.9Ω，线电流 I = √3·UL/RΔ = 100A = In
//   注：电源内阻 0.1Ω，100A 时相压降 10V，故电源相电压取 240V，
//       负载端相电压落到 230V（线 398V），线电流正好 100A。
//   —— 通过调大负载功率即可模拟过载，观察断路器的反时限脱扣。

import { ACPower3P } from '../components/ACPower3P.js';
import { MoldedCaseCircuitBreaker } from '../components/MoldedCaseCircuitBreaker.js';
import { ThreePhaseLoad } from '../components/ThreePhaseLoad.js';
import { DCPower } from '../components/DCPower.js';
import { DiagramStartButton } from '../components/DiagramStartButton.js';
import { Multimeter } from '../components/Multimeter.js';
import { MF47Multimeter } from '../components/MF47Multimeter.js';
import { Oscilloscope_tri } from '../components/Osc_tri.js';
import { SignalGenerator } from '../components/SignalGenerator.js';
import { ProcessCalibrator } from '../components/ProcessCalibrator.js';
import { ElecMeter } from '../components/ElecMeter.js';
import { RealMegohmMeter } from '../components/RealMegohmMeter.js';

// ── 故障设置 ────────────────────────────────────────────────
export const FAULT_CONFIGS = {
};

// ── 操作流程 ────────────────────────────────────────────────
export const PROJECT_WORKFLOWS = {
    'mccb-structure': {
        id: 'mccb-structure',
        name: '1. 塑壳式断路器结构的认识',
        steps: [
            {
                msg: '1. 识别断路器的操作手柄：请点击左侧「外观」面板上的蓝色操作手柄（壳体中央滑槽内）',
                mode: 'find', target: 'qf', subTarget: 'handle',
            },
            {
                msg: '2. 识别断路器的电磁脱扣器：请在右侧「内部结构」中找到三组电磁脱扣器线圈并点击',
                mode: 'find', target: 'qf', subTarget: 'magnetic-trip',
            },
            {
                msg: '3. 识别断路器的热脱扣器：请在右侧「内部结构」中找到热脱扣器（双金属片）并点击',
                mode: 'find', target: 'qf', subTarget: 'thermal-trip',
            },
            {
                msg: '4. 识别断路器的分励脱扣器：请在右侧「内部结构」中找到分励脱扣器线圈（右侧，接 fla/flb）并点击',
                mode: 'find', target: 'qf', subTarget: 'shunt-trip',
            },
            {
                msg: '5. 识别断路器的主触头：请在右侧「内部结构」中找到三极主触头（可动触头与静触头）并点击',
                mode: 'find', target: 'qf', subTarget: 'contact',
            },
            {
                msg: '6. 测试题：塑壳式断路器跳闸后，先往下扳的作用',
                mode: 'quiz',
                quizConfig: {
                    question: '塑壳式断路器跳闸（TRIP）后，把手柄先往下扳到 OFF 位，其作用是什么？',
                    options: [
                        '使自由脱扣机构复位（再扣），为下一次合闸做好准备',
                        '直接让断路器重新合闸送电',
                        '断开分励脱扣器线圈的电源',
                        '把已经积累的过载电流清零',
                    ],
                    answer: 0,
                    analysis: '跳闸后自由脱扣机构已经释放，手柄停在中间（TRIP）位，此时直接往上推是合不上闸的。必须先把手柄往下扳到 OFF 位，让脱扣机构重新扣合（复位/再扣），再往上推才能合闸——这就是"先复位、后合闸"的操作顺序。',
                },
            },
        ],
    },

    'mccb-function': {
        id: 'mccb-function',
        name: '2. 塑壳式断路器的功能测试',
        steps: [
            // ── 1. 接线 + 上电 ────────────────────────────────────
            {
                msg: '1. 点击工具栏【自动接线】接好测试电路，再合上三相电源开关',
                mode: 'check',
                check() {
                    const exp = [
                        ['ac3_wire_u', 'qf_wire_l1'], ['ac3_wire_v', 'qf_wire_l2'], ['ac3_wire_w', 'qf_wire_l3'],
                        ['qf_wire_t1', 'load_wire_l1'], ['qf_wire_t2', 'load_wire_l2'], ['qf_wire_t3', 'load_wire_l3'],
                        ['dc24_wire_p', 'sb_wire_no2'], ['sb_wire_no1', 'qf_wire_fla'], ['qf_wire_flb', 'dc24_wire_n'],
                    ];
                    const ac3 = this.sys.comps['ac3'];
                    return exp.every(([a, b]) => _hasConn(this.sys, a, b)) && ac3 && ac3.isOn;
                },
                op: [
                    {
                        type: 'wire',
                        msg: '点击工具栏【自动接线】，接好测试电路全部 9 根线',
                        async act() { _wire(this.sys); this.sys.redrawAll(); },
                    },
                    {
                        type: 'switch', target: 'ac3', part: 'power',
                        msg: '按下三相电源的电源键，合上电源开关（24V 分励电源已预先接通）',
                        async act() { _setOn(this.sys, 'ac3', true); await _sleep(800); },
                    },
                ],
            },
            // ── 2. 合闸 ──────────────────────────────────────────
            {
                msg: '2. 点击断路器手柄，合闸',
                mode: 'check',
                check() { const qf = this.sys.comps['qf']; return qf && qf.isClosed(); },
                op: [
                    {
                        type: 'switch', target: 'qf', part: 'handle',
                        msg: '点击断路器手柄（往上推），合闸',
                        async act() { const qf = this.sys.comps['qf']; if (qf) qf.close(); await _sleep(900); },
                    },
                ],
            },
            // ── 3. 分闸 ──────────────────────────────────────────
            {
                msg: '3. 再次点击断路器手柄，分闸，验证合闸、分闸功能正常',
                mode: 'check',
                check() { const qf = this.sys.comps['qf']; return qf && qf.getState() === 'off'; },
                op: [
                    {
                        type: 'switch', target: 'qf', part: 'handle',
                        msg: '再次点击断路器手柄（往下扳），分闸',
                        async act() { const qf = this.sys.comps['qf']; if (qf) qf.open(); await _sleep(900); },
                    },
                ],
            },
            // ── 4. 合闸 + 加载 ───────────────────────────────────
            {
                msg: '4. 再次将断路器合闸，点击三相可调负载的【加载】按钮，接通负载',
                mode: 'check',
                check() {
                    const qf = this.sys.comps['qf'], ld = this.sys.comps['load'];
                    return qf && qf.isClosed() && ld && ld.isLoaded();
                },
                op: [
                    {
                        type: 'switch', target: 'qf', part: 'handle',
                        msg: '点击断路器手柄，合闸',
                        async act() { const qf = this.sys.comps['qf']; if (qf) qf.close(); await _sleep(900); },
                    },
                    {
                        type: 'load', target: 'load', part: 'btn-load',
                        msg: '点击三相可调负载的【加载】按钮，接通负载（约 100A，1×In）',
                        async act() { _loadSet(this.sys, true); await _sleep(1500); },
                    },
                ],
            },
            // ── 5. 过载（热脱扣） ────────────────────────────────
            {
                msg: '5. 将负载调到 90kW 使断路器过载，观察热脱扣器双金属片的变形与脱扣过程；脱扣后卸载负载',
                mode: 'check',
                check() {
                    const qf = this.sys.comps['qf'], ld = this.sys.comps['load'];
                    // 需同时满足：已过载脱扣（热脱扣）+ 负载已卸载
                    return qf && qf.isTripped() && qf.getTripReason() === 'overload'
                        && ld && !ld.isLoaded();
                },
                op: [
                    {
                        type: 'observe', target: 'load',
                        msg: '打开负载参数设置，将「三相有功功率」改为 90kW',
                        async act() { await _demoSetConfig(this, 'load', 'powerKw', 90, '将「三相有功功率」改为 90'); },
                    },
                    {
                        type: 'load', target: 'load', part: 'btn-load',
                        msg: '点击【加载】接通负载：电流升到约 129A（1.29×In），进入过载',
                        async act() { _loadSet(this.sys, true); await _sleep(1500); },
                    },
                    {
                        type: 'observe', target: 'qf', part: 'thermal-trip',
                        msg: '观察热脱扣器：双金属片受热逐渐弯曲，约十几秒后推动脱扣轴跳闸',
                        async act() {
                            const qf = this.sys.comps['qf'];
                            await _waitUntil(() => qf && qf.isTripped(), 30000);
                            await _sleep(2500);
                        },
                    },
                    {
                        type: 'load', target: 'load', part: 'btn-unload',
                        msg: '点击【卸载】断开负载',
                        async act() { _loadSet(this.sys, false); await _sleep(900); },
                    },
                ],
            },
            // ── 6. 短路（电磁脱扣） ──────────────────────────────
            {
                msg: '6. 将断路器合闸，把负载增加到 350kW 并加载，触发短路，观察电磁脱扣器的瞬时脱扣过程；脱扣后卸载',
                mode: 'check',
                check() {
                    const qf = this.sys.comps['qf'], ld = this.sys.comps['load'];
                    // 需同时满足：已短路脱扣（电磁脱扣）+ 负载已卸载
                    return qf && qf.isTripped() && qf.getTripReason() === 'short'
                        && ld && !ld.isLoaded();
                },
                op: [
                    {
                        type: 'switch', target: 'qf', part: 'handle',
                        msg: '复位并合闸（跳闸后先下扳复位，再上推合闸）',
                        async act() { await _qfResetClose(this.sys); await _sleep(1000); },
                    },
                    {
                        type: 'observe', target: 'load',
                        msg: '打开负载参数设置，将「三相有功功率」改为 350kW',
                        async act() { await _demoSetConfig(this, 'load', 'powerKw', 350, '将「三相有功功率」改为 350'); },
                    },
                    {
                        type: 'load', target: 'load', part: 'btn-load',
                        msg: '点击【加载】接通负载：电流升到约 434A（4.3×In），触发短路',
                        async act() { _loadSet(this.sys, true); await _sleep(1500); },
                    },
                    {
                        type: 'observe', target: 'qf', part: 'magnetic-trip',
                        msg: '观察电磁脱扣器：衔铁瞬时吸合弹出，断路器瞬时脱扣跳闸',
                        async act() {
                            const qf = this.sys.comps['qf'];
                            await _waitUntil(() => qf && qf.isTripped(), 8000);
                            await _sleep(2500);
                        },
                    },
                    {
                        type: 'load', target: 'load', part: 'btn-unload',
                        msg: '点击【卸载】断开负载',
                        async act() { _loadSet(this.sys, false); await _sleep(900); },
                    },
                ],
            },
            // ── 7. 分励脱扣 ──────────────────────────────────────
            {
                msg: '7. 将断路器合闸，按下分励脱扣按钮，观察分励脱扣过程',
                mode: 'check',
                check() {
                    const qf = this.sys.comps['qf'];
                    // 需检测到分励脱扣状态才算完成
                    return qf && qf.isTripped() && qf.getTripReason() === 'shunt';
                },
                op: [
                    {
                        type: 'switch', target: 'qf', part: 'handle',
                        msg: '复位并合闸',
                        async act() { await _qfResetClose(this.sys); await _sleep(1000); },
                    },
                    {
                        type: 'btn', target: 'sb', part: 'btn',
                        msg: '按下常开按钮 SB，24V 接通分励脱扣线圈',
                        async act() {
                            const sb = this.sys.comps['sb'];
                            if (sb) {
                                if (typeof sb.setManualOverride === 'function') sb.setManualOverride(true);
                                else sb._isPressed = true;
                            }
                            await _sleep(1500);
                        },
                    },
                    {
                        type: 'observe', target: 'qf', part: 'shunt-trip',
                        msg: '观察分励脱扣器：线圈得电推动脱扣轴，断路器跳闸',
                        async act() {
                            const qf = this.sys.comps['qf'];
                            await _waitUntil(() => qf && qf.isTripped(), 5000);
                            await _sleep(2000);
                            const sb = this.sys.comps['sb'];
                            if (sb) {
                                if (typeof sb.setManualOverride === 'function') sb.setManualOverride(false);
                                else sb._isPressed = false;
                            }
                        },
                    },
                ],
            },
        ],
    },
};

// ── 电路 ────────────────────────────────────────────────────
export const componentConfigs = [
    // 三相电源（相电压 240V；带载后负载端约 230V/398V）
    { Class: ACPower3P, id: 'ac3', x: 60, y: 200, vRms: 240, freq: 50, isOn: false, phaseSeq: 'pos', visible: true },

    // 塑壳式断路器（左：外观，右：内部结构）
    { Class: MoldedCaseCircuitBreaker, id: 'qf', x: 470, y: 130,
      width: 380, height: 370, label: 'QF', ratedCurrent: 100, ratedVoltage: 400,
      overloadPickup: 1.2, tripTime12: 20, tripTime2: 0.4, shortPickup: 5,
      tripCoilR: 2000, initState: 'off', visible: true },

    // 三相可调负载（角形 Δ，无中性点）：cosφ=1，69kW → 线电流 100A
    { Class: ThreePhaseLoad, id: 'load', x: 630, y: 680,
      powerKw: 69, cosPhi: 1, reactive: 'ind', connection: 'delta',
      loaded: false, noBusUnload: false, visible: true },

    // 控制回路：24V 直流电源 + 常开按钮 → 分励脱扣线圈
    { Class: DCPower, id: 'dc24', x: 1200, y: 520, voltage: 24, isOn: true, label: '24V', visible: true },
    { Class: DiagramStartButton, id: 'sb', x: 1200, y: 360, label: 'SB', visible: true },

    // ── 7 种必备仪表 ──
    { Class: Multimeter, id: 'multimeter', x: 50, y: 50, visible: false },
    { Class: MF47Multimeter, id: 'mf47-panel', x: 50, y: 50, visible: false },
    { Class: Oscilloscope_tri, id: 'osc', x: 50, y: 50, visible: false },
    { Class: SignalGenerator, id: 'sg', x: 50, y: 50, visible: false },
    { Class: ProcessCalibrator, id: 'cali', x: 50, y: 50, visible: false },
    { Class: ElecMeter, id: 'elecmeter', x: 50, y: 50, visible: false },
    { Class: RealMegohmMeter, id: 'megohm', x: 50, y: 50, visible: false },
];

// ── 接线辅助 ────────────────────────────────────────────────

/** 主回路 6 根 + 分励控制回路 3 根 = 9 根（>8 → 瞬时接线） */
function _wire(sys) {
    sys.conns.length = 0;
    const cons = [
        // 三相电源 → 断路器进线端
        { from: 'ac3_wire_u', to: 'qf_wire_l1', type: 'wire' },
        { from: 'ac3_wire_v', to: 'qf_wire_l2', type: 'wire' },
        { from: 'ac3_wire_w', to: 'qf_wire_l3', type: 'wire' },
        // 断路器出线端 → 三相可调负载（角形，无中性线）
        { from: 'qf_wire_t1', to: 'load_wire_l1', type: 'wire' },
        { from: 'qf_wire_t2', to: 'load_wire_l2', type: 'wire' },
        { from: 'qf_wire_t3', to: 'load_wire_l3', type: 'wire' },
        // 24V → 常开按钮 → 分励脱扣线圈
        { from: 'dc24_wire_p', to: 'sb_wire_no2', type: 'wire' },
        { from: 'sb_wire_no1', to: 'qf_wire_fla', type: 'wire' },
        { from: 'qf_wire_flb', to: 'dc24_wire_n', type: 'wire' },
    ];
    cons.forEach(c => sys.connMgr.addConn(c));
    sys.redrawAll();
}

function _setOn(sys, id, on) {
    const c = sys.comps[id];
    if (!c) return;
    if (c.type === 'source_3p') { c.isOn = !!on; if (typeof c.update === 'function') c.update(); }
    else if (c.type === 'source') { c.isOn = !!on; if (typeof c.update === 'function') c.update(); }
    sys.redrawAll();
}

// ── 工作流辅助 ──────────────────────────────────────────────

function _sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function _hasConn(sys, a, b) {
    return sys.conns.some(c => (c.from === a && c.to === b) || (c.from === b && c.to === a));
}

/** 轮询等待条件成立（用于脱扣等仿真收敛） */
async function _waitUntil(fn, timeout = 20000, step = 250) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
        try { if (fn()) return true; } catch (e) { /* 忽略瞬时异常 */ }
        await _sleep(step);
    }
    return false;
}

/** 负载加载/卸载（等效于点击负载面板的「加载 / 卸载」按钮） */
function _loadSet(sys, on) {
    const ld = sys.comps['load'];
    if (!ld) return;
    ld._loaded = !!on;
    ld.config.loaded = !!on;
    if (!on) { ld._vLast = [0, 0, 0]; ld._iLast = [0, 0, 0]; }
    if (typeof ld._refresh === 'function') ld._refresh();
    sys.redrawAll();
}

/** 断路器复位并合闸（跳闸后须先复位到 OFF，再合闸） */
async function _qfResetClose(sys) {
    const qf = sys.comps['qf'];
    if (!qf) return;
    if (qf.getState() === 'trip') qf.reset();
    else if (qf.getState() === 'on') qf.open();
    await _sleep(600);
    qf.close();
}

/**
 * 打开组件参数配置对话框，动态演示参数调整并保存：
 * 弹框前同步实时属性 → 高亮输入框填值 → 高亮「保存」并点击。
 * （参数调整一律走配置界面，禁止直接改内部属性）
 */
async function _demoSetConfig(wf, compId, key, value, tip) {
    const comp = wf.sys.comps[compId];
    if (!comp) return;
    (comp.getConfigFields() || []).forEach(f => {
        if (f.get) return;
        try {
            const live = comp[f.key];
            if (live !== undefined) comp.config[f.key] = live;
        } catch (e) { /* 忽略只读属性 */ }
    });
    comp.showConfigDialog();
    await _sleep(600);
    const input = document.getElementById('diag_' + key);
    const modal = input ? input.closest('div[style*="position: fixed"]') : null;
    if (input) {
        if (wf._flashDomElement) await wf._flashDomElement(input, tip || `请将该参数改为 ${value}`, 2400);
        input.value = value;
    }
    if (modal) {
        const saveBtn = [...modal.querySelectorAll('button')].find(b => b.textContent.indexOf('保存') !== -1);
        if (saveBtn) {
            if (wf._flashDomElement) await wf._flashDomElement(saveBtn, '点击「保存」确认参数修改', 1800);
            saveBtn.click();
        }
    }
    await _sleep(400);
}

export function initSlider(_sys) { }

/** 工具栏「自动接线」：接好测试电路全部 10 根线 */
export function applyAllPresets() {
    const sys = (this && this.sys) ? this.sys : window.sys;
    if (!sys || !sys.connMgr) return;
    _wire(sys);
}

/** 工具栏「启动系统」：接线 → 投电源 → 合断路器 */
export async function applyStartSystem() {
    const sys = (this && this.sys) ? this.sys : window.sys;
    if (!sys || !sys.connMgr) return;
    _wire(sys);
    _setOn(sys, 'ac3', true);
    _setOn(sys, 'dc24', true);
    await new Promise(r => setTimeout(r, 300));
    const qf = sys.comps['qf'];
    if (qf) qf.close();
    sys.redrawAll();
}

export function fiveStep() { }
