// 电源电路（7805 三端稳压电源）仿真工程
// 电路：AC 220V → 熔断器 → 控制变压器(220V/12V) → 桥式整流 → 47µF 滤波 → 7805 → 22µF 滤波 → 200Ω 负载
// 约定：
//   · 单页工程：不导出 PROJECT_PAGES，consys.js 不创建 PageManager
//   · 默认不预接线：applyAllPresets({ init:true }) 直接返回，只有「自动接线」按钮 / 工作流 / 「起动系统」才接线
//   · 仪表一律走「选择仪表」界面（op.type='instrument'）；表笔/探头接线用动画接线（约 3s/根）
//   · 参数调整一律走参数配置界面（showConfigDialog → 填值 → 点击「保存」）
//   · 动作一律模拟真实交互（getClickablePartNode(...).fire(...)），不直接改内部字段

import { ACPower } from '../components/ACPower.js';
import { SinglePhaseFuse } from '../components/SinglePhaseFuse.js';
import { RealControlTransformer } from '../components/RealControlTransformer.js';
import { Diode } from '../components/Diode.js';
import { Capacitor } from '../components/Capacitor.js';
import { IC7805 } from '../components/IC7805.js';
import { Resistor } from '../components/Resistor.js';
import { Ground } from '../components/Gnd.js';
import { Multimeter } from '../components/Multimeter.js';
import { MF47Multimeter } from '../components/MF47Multimeter.js';
import { RealMegohmMeter } from '../components/RealMegohmMeter.js';
import { Oscilloscope_tri } from '../components/Osc_tri.js';
import { SignalGenerator } from '../components/SignalGenerator.js';
import { ProcessCalibrator } from '../components/ProcessCalibrator.js';
import { ElecMeter } from '../components/ElecMeter.js';

export const FAULT_CONFIGS = {};

// ═══════════════════════════════════════════════════════════════
// 一、工作流通用辅助
// ═══════════════════════════════════════════════════════════════

const _sysOf = (ctx) => (ctx && ctx.sys) ? ctx.sys : window.sys;
const _sleep = (ms) => new Promise(r => setTimeout(r, ms));
const _comp = (sys, id) => (sys && sys.comps) ? sys.comps[id] : null;

/** 动画接线：仪表探头/表笔接线一律逐根动画（约 3s/根） */
async function _wire(sys, from, to) {
    if (!sys || !sys.connMgr) return;
    await sys.connMgr.addConnectionAnimated({ from, to, type: 'wire' });
}

/** 两端口之间是否已连（供 check() 判定） */
function _wired(sys, a, b) {
    return !!(sys && Array.isArray(sys.conns) && sys.conns.some(c =>
        c && c.type === 'wire' && ((c.from === a && c.to === b) || (c.from === b && c.to === a))));
}

/** 该端口上是否有任意导线（用于"接上了就行"的宽松判定） */
function _touches(sys, portId, extraPorts) {
    const ports = [portId].concat(extraPorts || []);
    return !!(sys && Array.isArray(sys.conns) && sys.conns.some(c =>
        c && c.type === 'wire' && (ports.includes(c.from) || ports.includes(c.to))));
}

/** 模拟点击组件部件（触发组件自身的交互处理） */
function _firePart(comp, partId, evt = 'click') {
    if (!comp || typeof comp.getClickablePartNode !== 'function') return false;
    const node = comp.getClickablePartNode(partId);
    if (!node) return false;
    node.fire(evt);
    return true;
}

/** 接通交流电源：模拟按下电源键（不直接赋值） */
async function _powerOn(ctx) {
    const sys = _sysOf(ctx);
    const ac = _comp(sys, 'ac');
    if (!ac) return;
    if (!ac.isOn) {
        if (!_firePart(ac, 'power', 'mousedown')) {
            console.warn('[电源电路] 未取到电源键节点，兜底置位');
            ac.isOn = true;
            ac.update();
        }
        await _sleep(600);
    }
    if (sys && sys.redrawAll) sys.redrawAll();
}

/** 示波器第 chIdx 路当前瞬时电压（来自电路求解器） */
function _oscChValue(sys, chIdx) {
    const s = sys && sys.voltageSolver;
    if (!s || !s.portToCluster) return 0;
    const p = s.portToCluster.get(`osc_wire_ch${chIdx}p`);
    const n = s.portToCluster.get(`osc_wire_ch${chIdx}n`);
    return (s.nodeVoltages.get(p) || 0) - (s.nodeVoltages.get(n) || 0);
}

/** 反复按「CHx 档」按钮，把该通道调到指定的 V/格（循环档位，限次防死循环） */
async function _oscScale(ctx, chIdx, vPerDiv) {
    const sys = _sysOf(ctx);
    const osc = _comp(sys, 'osc');
    if (!osc || !Array.isArray(osc.channels)) return;
    const ch = osc.channels[chIdx - 1];
    const targetIdx = osc.vScales.indexOf(vPerDiv);
    if (targetIdx < 0) return;
    let guard = 0;
    while (ch.vIdx !== targetIdx && guard++ < osc.vScales.length) {
        if (!_firePart(osc, `ch${chIdx}-scale`, 'mousedown')) {
            ch.vIdx = (ch.vIdx + 1) % osc.vScales.length;   // 兜底：节点缺失时才直接换档
            if (osc.updateStatus) osc.updateStatus();
        }
        if (sys && sys.requestRedraw) sys.requestRedraw();
        await _sleep(450);
    }
}

/** 示波器自动调档：采样实测峰值，选"峰值约占 4 格"的最小档位（波形完整充满屏幕） */
async function _oscAutoRange(ctx, chIdx) {
    const sys = _sysOf(ctx);
    const osc = _comp(sys, 'osc');
    if (!osc) return;
    let peak = 0;
    for (let i = 0; i < 8; i++) {
        peak = Math.max(peak, Math.abs(_oscChValue(sys, chIdx)));
        await _sleep(80);
    }
    const need = Math.max(peak * 1.05, 0.05) / 4;           // 峰值约占 4 格（留 5% 余量）
    const vPerDiv = osc.vScales.find(v => v >= need) || osc.vScales[osc.vScales.length - 1];
    await _oscScale(ctx, chIdx, vPerDiv);
}

/**
 * 通过参数配置界面改参数（弹框 → 填值 → 真正点「保存」）
 * @param {object} ctx 工作流 this
 * @param {string} compId 组件 id
 * @param {string} key 参数字段 key（输入框 id 为 diag_<key>）
 * @param {number|string} value 目标值
 * @param {string} tip 填值时的提示文字
 */
async function _demoSetCfg(ctx, compId, key, value, tip) {
    const sys = _sysOf(ctx);
    const comp = _comp(sys, compId);
    if (!comp || typeof comp.showConfigDialog !== 'function') return;

    // ① 弹框前先把实时属性同步进 config 副本，否则「保存」会把旧值一起回写（如电源被关掉）
    const fields = comp.getConfigFields ? comp.getConfigFields() : [];
    if (!comp.config) comp.config = {};
    fields.forEach(f => {
        if (!f.get && comp[f.key] !== undefined) comp.config[f.key] = comp[f.key];
    });

    // ② 弹出参数配置界面
    comp.showConfigDialog();
    await _sleep(700);

    // ③ 指向输入框并填入新值
    const input = document.getElementById('diag_' + key);
    if (input) {
        if (typeof ctx._flashDomElement === 'function') await ctx._flashDomElement(input, tip || '修改参数', 2400);
        input.value = value;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        await _sleep(500);
    }

    // ④ 指向「保存」按钮并真正按下
    const saveBtns = [...document.querySelectorAll('button')].filter(b => b.textContent.trim() === '保存');
    const saveBtn = saveBtns[saveBtns.length - 1];
    if (saveBtn) {
        if (typeof ctx._flashDomElement === 'function') await ctx._flashDomElement(saveBtn, '点击「保存」确认参数修改', 1800);
        saveBtn.click();
        await _sleep(800);
    }

    // ⑤ 确认对话框已关闭
    const still = document.getElementById('diag_' + key);
    if (still && still.offsetParent !== null) {
        const closeBtn = [...document.querySelectorAll('button')].filter(b => ['取消', '关闭'].includes(b.textContent.trim())).pop();
        if (closeBtn) closeBtn.click();
    }

    // ⑥ 生效兜底：保存后仍未生效时补一次配置更新，保证演示不中断
    const now = comp[key];
    if (now !== undefined && Math.abs(Number(now) - Number(value)) > 1e-6 && comp.onConfigUpdate) {
        comp.onConfigUpdate({ ...comp.config, [key]: Number(value) });
    }
}

/** 主电路一键接线（瞬时接线：本电路导线 > 8 根，允许瞬时接） */
function _autoWire(sys) {
    if (!sys || !sys.connMgr) return;
    sys.conns.length = 0;
    const cons = [
        { from: 'ac_wire_p', to: 'fu_wire_l', type: 'wire' },
        { from: 'fu_wire_t', to: 'tr_wire_p1', type: 'wire' },
        { from: 'ac_wire_n', to: 'gnd1_wire_gnd', type: 'wire' },
        { from: 'tr_wire_p2', to: 'gnd1_wire_gnd', type: 'wire' },

        { from: 'tr_wire_s1', to: 'd1_wire_l', type: 'wire' },
        { from: 'd1_wire_l', to: 'd3_wire_r', type: 'wire' },
        { from: 'tr_wire_s2', to: 'd2_wire_l', type: 'wire' },
        { from: 'd2_wire_l', to: 'd4_wire_r', type: 'wire' },

        { from: 'd1_wire_r', to: 'd2_wire_r', type: 'wire' },
        { from: 'd2_wire_r', to: 'c1_wire_l', type: 'wire' },
        { from: 'd3_wire_l', to: 'd4_wire_l', type: 'wire' },
        { from: 'd4_wire_l', to: 'c1_wire_r', type: 'wire' },

        { from: 'c1_wire_r', to: 'gnd2_wire_gnd', type: 'wire' },
        { from: 'c1_wire_l', to: 'reg_wire_in', type: 'wire' },

        { from: 'reg_wire_out', to: 'c2_wire_l', type: 'wire' },
        { from: 'c2_wire_r', to: 'gnd2_wire_gnd', type: 'wire' },
        { from: 'reg_wire_gnd', to: 'gnd2_wire_gnd', type: 'wire' },

        { from: 'c2_wire_l', to: 'rl_wire_l', type: 'wire' },
        { from: 'rl_wire_r', to: 'c2_wire_r', type: 'wire' },
    ];
    cons.forEach(c => sys.connMgr.addConn(c));
    if (sys.redrawAll) sys.redrawAll();
}

// ═══════════════════════════════════════════════════════════════
// 二、工作流
// ═══════════════════════════════════════════════════════════════

export const PROJECT_WORKFLOWS = {
    'power-supply-recognize': {
        id: 'power-supply-recognize',
        name: '1. 识别电源电路中的元器件',
        steps: [
            {
                msg: '1. 识别控制变压器（T）。',
                mode: 'find',
                target: 'tr',
            },
            {
                msg: '2. 识别整流二极管（任意一只）。',
                mode: 'find',
                target: ['d1', 'd2', 'd3', 'd4'],
                demoTarget: 'd1',
            },
            {
                msg: '3. 识别三端稳压器。',
                mode: 'find',
                target: 'reg',
            },
            {
                msg: '4. 识别滤波电容（任意一只）。',
                mode: 'find',
                target: ['c1', 'c2'],
                demoTarget: 'c1',
            },
            {
                msg: '5. 识别负载电阻。',
                mode: 'find',
                target: 'rl',
            },
            {
                msg: '6. 测试题：直流稳压电源的四个基本环节',
                mode: 'quiz',
                quizConfig: {
                    question: '直流稳压电源电路通常包含哪四个基本环节？',
                    options: [
                        '变压、整流、滤波、稳压',
                        '电源、导线、负载、开关',
                        '放大、整流、滤波、稳压',
                        '变压、整流、放大、滤波',
                    ],
                    answer: 0,
                    analysis: '变压器把电网电压降到合适的幅度，整流把交流变成脉动直流，' +
                        '滤波把脉动成分滤掉，稳压再保证输出不随电网电压和负载变化。',
                },
            },
            {
                msg: '7. 测试题：二极管的作用',
                mode: 'quiz',
                quizConfig: {
                    question: '在本整流电路中，二极管的主要作用是什么？',
                    options: [
                        '放大电流',
                        '整流，把交流电转换为脉动直流电',
                        '储存电能',
                        '升高电压',
                    ],
                    answer: 1,
                    analysis: '二极管利用单向导电性整流，四只二极管接成桥式电路，' +
                        '使负载上始终流过同一方向的电流。',
                },
            },
        ],
    },

    'power-supply-analyze': {
        id: 'power-supply-analyze',
        name: '2. 电源电路工作过程分析',
        steps: [
            {
                msg: '1. 自动接线，合上电源开关。',
                mode: 'check',
                op: [
                    {
                        type: 'wire', target: 'ac', button: 'btnAutoWire',
                        msg: '点击「自动接线」，按图接好主电路',
                        async act() {
                            const sys = _sysOf(this);
                            if (sys && typeof sys.applyAllPresets === 'function') sys.applyAllPresets();
                            await _sleep(1200);
                        },
                    },
                    {
                        type: 'switch', target: 'ac', part: 'power',
                        msg: '按下电源键，接通 AC 220 V',
                        async act() { await _powerOn(this); },
                    },
                    {
                        type: 'observe', target: 'ac', part: 'lcd',
                        msg: '电源面板显示 220.0 V / 50.0 Hz',
                        async act() { await _sleep(1500); },
                    },
                ],
                check() {
                    const sys = _sysOf(this);
                    const ac = _comp(sys, 'ac');
                    return !!(ac && ac.isOn) && _touches(sys, 'ac_wire_p') && _touches(sys, 'fu_wire_l');
                },
            },
            {
                msg: '2. 用示波器 CH1、CH2 测变压器输入、输出波形。',
                mode: 'check',
                op: [
                    {
                        type: 'instrument', instrument: 'osc',
                        msg: '选择仪表：勾选「三路示波器」，再关闭界面',
                        async act() { await _sleep(800); },
                    },
                    {
                        type: 'observe', target: 'osc', ports: ['osc_wire_ch1p', 'tr_wire_p1'],
                        msg: 'CH1 探针接变压器原边 p1',
                        async act() { await _wire(_sysOf(this), 'osc_wire_ch1p', 'tr_wire_p1'); },
                    },
                    {
                        type: 'observe', target: 'osc', ports: ['osc_wire_ch1n', 'tr_wire_p2'],
                        msg: 'CH1 地夹接原边 p2',
                        async act() { await _wire(_sysOf(this), 'osc_wire_ch1n', 'tr_wire_p2'); },
                    },
                    {
                        type: 'observe', target: 'osc', ports: ['osc_wire_ch2p', 'tr_wire_s1'],
                        msg: 'CH2 探针接副边 s1',
                        async act() { await _wire(_sysOf(this), 'osc_wire_ch2p', 'tr_wire_s1'); },
                    },
                    {
                        type: 'observe', target: 'osc', ports: ['osc_wire_ch2n', 'tr_wire_s2'],
                        msg: 'CH2 地夹接副边 s2',
                        async act() { await _wire(_sysOf(this), 'osc_wire_ch2n', 'tr_wire_s2'); },
                    },
                    {
                        type: 'knob', target: 'osc', part: 'ch1-scale',
                        msg: '按「CH1 档」，把 CH1 调到 100 V/格',
                        async act() { await _oscAutoRange(this, 1); },
                    },
                    {
                        type: 'knob', target: 'osc', part: 'ch2-scale',
                        msg: '按「CH2 档」，把 CH2 调到 5 V/格',
                        async act() { await _oscAutoRange(this, 2); },
                    },
                    {
                        type: 'observe', target: 'osc', part: 'screen',
                        msg: 'CH1 为 220 V 正弦波，CH2 为 12 V 同相正弦波',
                        async act() { await _sleep(2500); },
                    },
                ],
                check() {
                    const sys = _sysOf(this);
                    const osc = _comp(sys, 'osc');
                    return !!(osc && osc.group && osc.group.visible())
                        && _wired(sys, 'osc_wire_ch1p', 'tr_wire_p1')
                        && _wired(sys, 'osc_wire_ch1n', 'tr_wire_p2')
                        && _wired(sys, 'osc_wire_ch2p', 'tr_wire_s1')
                        && _wired(sys, 'osc_wire_ch2n', 'tr_wire_s2');
                },
            },
            {
                msg: '3. 用 CH3 测滤波电容两端的电压波形。',
                mode: 'check',
                op: [
                    {
                        type: 'observe', target: 'osc', ports: ['osc_wire_ch3p', 'c1_wire_l'],
                        msg: 'CH3 探针接电容 c1 正端',
                        async act() { await _wire(_sysOf(this), 'osc_wire_ch3p', 'c1_wire_l'); },
                    },
                    {
                        type: 'observe', target: 'osc', ports: ['osc_wire_ch3n', 'c1_wire_r'],
                        msg: 'CH3 地夹接电容 c1 负端',
                        async act() { await _wire(_sysOf(this), 'osc_wire_ch3n', 'c1_wire_r'); },
                    },
                    {
                        type: 'knob', target: 'osc', part: 'ch3-scale',
                        msg: '按「CH3 档」，调到 5 V/格',
                        async act() { await _oscAutoRange(this, 3); },
                    },
                    {
                        type: 'observe', target: 'osc', part: 'screen',
                        msg: '整流后为脉动直流，电容滤波后波形被"填平"',
                        async act() { await _sleep(2600); },
                    },
                ],
                check() {
                    const sys = _sysOf(this);
                    const osc = _comp(sys, 'osc');
                    return !!(osc && osc.group && osc.group.visible())
                        && _wired(sys, 'osc_wire_ch3p', 'c1_wire_l')
                        && _wired(sys, 'osc_wire_ch3n', 'c1_wire_r');
                },
            },
            {
                msg: '4. 用数字万用表直流档测负载两端电压。',
                mode: 'check',
                op: [
                    {
                        type: 'instrument', instrument: 'multimeter',
                        msg: '选择仪表：勾选「数字万用表」，再关闭界面',
                        async act() { await _sleep(800); },
                    },
                    {
                        type: 'knob', target: 'multimeter', part: 'knob',
                        msg: '旋钮拨到 DCV 20 档',
                        async act() {
                            const mm = _comp(_sysOf(this), 'multimeter');
                            if (mm && mm.setMode) mm.setMode('DCV20');
                            await _sleep(900);
                        },
                    },
                    {
                        type: 'observe', target: 'multimeter', ports: ['multimeter_wire_v', 'rl_wire_l'],
                        msg: '红表笔接负载正端',
                        async act() { await _wire(_sysOf(this), 'multimeter_wire_v', 'rl_wire_l'); },
                    },
                    {
                        type: 'observe', target: 'multimeter', ports: ['multimeter_wire_com', 'rl_wire_r'],
                        msg: '黑表笔接负载负端',
                        async act() { await _wire(_sysOf(this), 'multimeter_wire_com', 'rl_wire_r'); },
                    },
                    {
                        type: 'observe', target: 'multimeter', part: 'lcd',
                        msg: '读数约 +5.00 V，说明稳压器输出稳定',
                        async act() { await _sleep(2200); },
                    },
                ],
                check() {
                    const sys = _sysOf(this);
                    const mm = _comp(sys, 'multimeter');
                    return !!(mm && mm.group && mm.group.visible() && mm.mode === 'DCV20')
                        && _wired(sys, 'multimeter_wire_v', 'rl_wire_l')
                        && _wired(sys, 'multimeter_wire_com', 'rl_wire_r');
                },
            },
            {
                msg: '5. 根据读数，在负载旁填写输出电压。',
                mode: 'fill',
                target: 'rl',
                fields: [
                    { label: '输出电压', unit: 'V', answer: 5, tolerance: 0.05, placeholder: '请输入输出电压' },
                ],
            },
            {
                msg: '6. 把电源电压调到 240 V，观察稳压输出是否变化。',
                mode: 'check',
                op: [
                    {
                        type: 'observe', target: 'ac',
                        msg: '打开电源的参数配置，把电压有效值改为 240 V',
                        async act() { await _demoSetCfg(this, 'ac', 'vRms', 240, '把「电压有效值」改为 240'); },
                    },
                    {
                        type: 'observe', target: 'ac', part: 'lcd',
                        msg: '输入升到 240 V，整流滤波后的电压也跟着升高',
                        async act() { await _sleep(1600); },
                    },
                    {
                        type: 'observe', target: 'multimeter', part: 'lcd',
                        msg: '输出仍是 +5.00 V —— 7805 稳压的结果',
                        async act() { await _sleep(2400); },
                    },
                ],
                check() {
                    const ac = _comp(_sysOf(this), 'ac');
                    return !!(ac && Math.abs(Number(ac.vRms) - 240) < 0.5);
                },
            },
            {
                msg: '7. 把负载电阻改为 300 Ω，观察输出电压。',
                mode: 'check',
                op: [
                    {
                        type: 'observe', target: 'rl',
                        msg: '打开负载的参数配置，把阻值改为 300 Ω',
                        async act() { await _demoSetCfg(this, 'rl', 'currentResistance', 300, '把「阻值」改为 300'); },
                    },
                    {
                        type: 'observe', target: 'multimeter', part: 'lcd',
                        msg: '负载改变，输出电压依旧 +5.00 V',
                        async act() { await _sleep(2400); },
                    },
                ],
                check() {
                    const rl = _comp(_sysOf(this), 'rl');
                    return !!(rl && Math.abs(Number(rl.currentResistance) - 300) < 1);
                },
            },
            {
                msg: '8. 测试题：三端稳压器的作用',
                mode: 'quiz',
                quizConfig: {
                    question: '三端稳压器（如 7805）在本电路中的作用是什么？',
                    options: [
                        '把交流电整流为直流电',
                        '把不稳定的直流电压稳压为稳定的 +5 V 输出',
                        '放大电路中的电压信号',
                        '把直流电逆变为交流电',
                    ],
                    answer: 1,
                    analysis: '7805 是固定输出 +5 V 的三端稳压器，' +
                        '只要输入电压高于 7 V 左右、输出电流不超过 1.5 A，输出电压就稳定在 5 V。',
                },
            },
        ],
    },
};

export const componentConfigs = [
    // ── 主电路（AC 220V → 熔断器 → 变压器 → 桥式整流 → 滤波 → 7805 → 滤波 → 负载）──
    { Class: ACPower, id: 'ac', x: 10, y: 110, vRms: 220, freq: 50, isOn: false },
    { Class: SinglePhaseFuse, id: 'fu', x: 200, y: 280, rotation: -90 },
    { Class: RealControlTransformer, id: 'tr', x: 390, y: 230, primaryVoltage: 220, secondaryVoltage: 12 },
    { Class: Ground, id: 'gnd1', x: 100, y: 430 },

    { Class: Diode, id: 'd1', x: 780, y: 260, rotation: -90 },
    { Class: Diode, id: 'd2', x: 860, y: 260, rotation: -90 },
    { Class: Diode, id: 'd3', x: 780, y: 420, rotation: -90 },
    { Class: Diode, id: 'd4', x: 860, y: 420, rotation: -90 },

    { Class: Capacitor, id: 'c1', x: 970, y: 280, subtype: 'el', capacitance: 47, rotation: 90, leak: 10000 },
    { Class: IC7805, id: 'reg', x: 1090, y: 230 },
    { Class: Capacitor, id: 'c2', x: 1210, y: 280, subtype: 'el', capacitance: 22, rotation: 90 },
    { Class: Resistor, id: 'rl', x: 1320, y: 280, value: 200, rotation: 90 },

    { Class: Ground, id: 'gnd2', x: 1100, y: 420 },

    // ── 7 种保留仪表（默认隐藏，从「选择仪表」调出）──
    // 统一停靠在主电路下方（y ≥ 460）：不遮住电路，也不被右侧「操作流程」面板挡住；
    // 演示中同时使用的示波器与数字万用表左右并排、互不重叠，仪表与读数全程可见。
    { Class: Oscilloscope_tri, id: 'osc', x: 950, y: 700, visible: false },
    { Class: Multimeter, id: 'multimeter', x: 1280, y: 470, visible: false },
    { Class: MF47Multimeter, id: 'mf47-panel', x: 360, y: 470, visible: false },
    { Class: RealMegohmMeter, id: 'megohm', x: 20, y: 470, visible: false },
    { Class: ElecMeter, id: 'elecmeter', x: 20, y: 790, visible: false },
    { Class: SignalGenerator, id: 'sg', x: 720, y: 960, visible: false },
    { Class: ProcessCalibrator, id: 'cali', x: 1050, y: 420, visible: false },
];

export function initSlider(_sys) { }

/** 工具栏「自动接线」：接好主电路（初始化时不做，保持画布无预接线） */
export function applyAllPresets(opts) {
    if (opts && opts.init) return;
    const sys = _sysOf(this);
    if (!sys) return;
    _autoWire(sys);
}

/** 工具栏「起动系统」：接线并接通交流电源 */
export async function applyStartSystem() {
    const sys = _sysOf(this);
    if (!sys) return;
    _autoWire(sys);
    await _sleep(400);
    await _powerOn(sys);
}

export function fiveStep() { }
