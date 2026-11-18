// 电池充电回路（镍氢电池恒流充电）仿真工程
// 电路：AC 220V → 控制变压器 T(220V/12V) → 半波整流 D1 → 滤波电容 C1 → 6V 稳压基准(DZ)
//       → 三极管 Q1 恒流源 → 镍氢电池 BT；SA 切换发射极电阻 R3(53Ω)/R4(106Ω) 选择 100mA/50mA
//       R2 + LED 为充电指示支路
// 约定：
//   · 单页工程：不导出 PROJECT_PAGES，consys.js 不创建 PageManager
//   · 默认不预接线：applyAllPresets({ init:true }) 直接返回，只有「自动接线」按钮 / 工作流 / 「起动系统」才接线
//   · 仪表一律走「选择仪表」界面（op.type='instrument'）；表笔接线用动画接线（约 3s/根）
//   · 参数调整一律走参数配置界面（showConfigDialog → 填值 → 点击「保存」）
//   · 动作一律模拟真实交互（getClickablePartNode(...).fire(...)），不直接改内部字段

import { ACPower } from '../components/ACPower.js';
import { RealControlTransformer } from '../components/RealControlTransformer.js';
import { Diode } from '../components/Diode.js';
import { Capacitor } from '../components/Capacitor.js';
import { Resistor } from '../components/Resistor.js';
import { Zener } from '../components/Zener.js';
import { NiMHBattery } from '../components/NiMHBattery.js';
import { Ground } from '../components/Gnd.js';
import { Transistor } from '../components/Transistor.js';
import { LED } from '../components/LED.js';
import { DiagramSPDT } from '../components/DiagramSPDT.js';
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

/** 动画接线：仪表表笔接线一律逐根动画（约 3s/根） */
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

/** 条件轮询等待（不要写死 sleep 猜时间） */
async function _waitFor(sys, cond, timeout = 6000, interval = 100) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
        try { if (cond(sys)) return true; } catch (e) { /* ignore */ }
        await _sleep(interval);
    }
    return false;
}

/**
 * 等仪表读数稳定（连续 need 次与上次相差不超过 tol 才算稳定），
 * 避免"读到一半就跳步"（滤波电容充电、AC 采样都需要时间）。
 */
async function _waitStable(getter, tol = 0.05, need = 3, timeout = 9000) {
    const t0 = Date.now();
    let last = null;
    let ok = 0;
    while (Date.now() - t0 < timeout) {
        const v = getter();
        if (Number.isFinite(v)) {
            if (last !== null && Math.abs(v - last) <= tol) ok++;
            else ok = 1;
            last = v;
            if (ok >= need && Math.abs(v) > 1e-6) return true;
        }
        await _sleep(160);
    }
    return false;
}

/** 模拟点击组件部件（触发组件自身的交互处理） */
function _firePart(comp, partId, evt = 'click') {
    if (!comp || typeof comp.getClickablePartNode !== 'function') return false;
    const node = comp.getClickablePartNode(partId);
    if (!node) return false;
    try { node.fire(evt, { evt: { cancelBubble: false } }); } catch (e) { /* ignore */ }
    return true;
}

/** 合上交流电源：模拟按下电源面板上的「电源」键（不直接赋值） */
async function _powerOn(ctx) {
    const sys = _sysOf(ctx);
    const ac = _comp(sys, 'ac');
    if (!ac) return;
    if (!ac.isOn) {
        if (!_firePart(ac, 'power', 'mousedown')) {
            console.warn('[电池充电回路] 未取到电源键节点，兜底置位');
            ac.isOn = true;
            ac.update();
        }
        await _sleep(700);
    }
    if (sys && sys.redrawAll) sys.redrawAll();
}

/** 断开交流电源（模拟按电源键） */
async function _powerOff(ctx) {
    const sys = _sysOf(ctx);
    const ac = _comp(sys, 'ac');
    if (!ac || !ac.isOn) return;
    if (!_firePart(ac, 'power', 'mousedown')) { ac.isOn = false; ac.update(); }
    await _sleep(500);
    if (sys && sys.redrawAll) sys.redrawAll();
}

/** 拔掉万用表表笔（移动测点前先收线，避免多点并联） */
function _removeProbes(sys, prefix = 'multimeter') {
    if (!sys || !Array.isArray(sys.conns)) return;
    const keep = [];
    sys.conns.forEach(c => {
        const isProbe = c && c.type === 'wire'
            && (String(c.from).startsWith(prefix + '_wire_') || String(c.to).startsWith(prefix + '_wire_'));
        if (!isProbe) keep.push(c);
    });
    sys.conns.length = 0;
    keep.forEach(c => sys.conns.push(c));
    if (sys.redrawAll) sys.redrawAll();
}

/** 万用表当前读数（组件内部 this.value，单位随档位，供提示与校验） */
function _mmReading(sys) {
    const mm = _comp(sys, 'multimeter');
    if (!mm) return NaN;
    if (typeof mm.getValue === 'function') {
        const v = mm.getValue();
        if (v !== undefined && v !== null && !Number.isNaN(Number(v))) return Number(v);
    }
    return Number(mm.value);
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
        // ── 交流侧 ──
        { from: 'ac_wire_p', to: 'tr_wire_p1', type: 'wire' },
        { from: 'ac_wire_n', to: 'gnd1_wire_gnd', type: 'wire' },
        { from: 'tr_wire_p2', to: 'gnd1_wire_gnd', type: 'wire' },

        // ── 整流 + 滤波 ──
        { from: 'tr_wire_s1', to: 'd1_wire_l', type: 'wire' },
        { from: 'tr_wire_s2', to: 'gnd2_wire_gnd', type: 'wire' },
        { from: 'd1_wire_r', to: 'c1_wire_l', type: 'wire' },
        { from: 'c1_wire_r', to: 'gnd3_wire_gnd', type: 'wire' },

        // ── 稳压基准（R1 + DZ）──
        { from: 'c1_wire_l', to: 'r1_wire_l', type: 'wire' },
        { from: 'r1_wire_r', to: 'zd_wire_r', type: 'wire' },
        { from: 'zd_wire_l', to: 'gnd4_wire_gnd', type: 'wire' },

        // ── 充电回路：滤波正端 → 电池 → 三极管集电极 ──
        { from: 'c1_wire_l', to: 'bt_wire_p', type: 'wire' },
        { from: 'bt_wire_n', to: 'q1_wire_c', type: 'wire' },
        { from: 'r1_wire_r', to: 'q1_wire_b', type: 'wire' },

        // ── 发射极：指示支路 + 档位电阻 ──
        { from: 'q1_wire_e', to: 'r2_wire_l', type: 'wire' },
        { from: 'r2_wire_r', to: 'led_wire_l', type: 'wire' },
        { from: 'led_wire_r', to: 'gnd6_wire_gnd', type: 'wire' },

        { from: 'q1_wire_e', to: 'sw_wire_com', type: 'wire' },
        { from: 'sw_wire_t1', to: 'r3_wire_l', type: 'wire' },
        { from: 'sw_wire_t2', to: 'r4_wire_l', type: 'wire' },
        { from: 'r3_wire_r', to: 'gnd5_wire_gnd', type: 'wire' },
        { from: 'r4_wire_r', to: 'gnd5_wire_gnd', type: 'wire' },
    ];
    cons.forEach(c => sys.connMgr.addConn(c));
    if (sys.redrawAll) sys.redrawAll();
}

// ═══════════════════════════════════════════════════════════════
// 二、工作流
// ═══════════════════════════════════════════════════════════════

export const PROJECT_WORKFLOWS = {
    'charger-recognize': {
        id: 'charger-recognize',
        name: '1. 识别电池充电回路的元器件',
        steps: [
            {
                msg: '1. 识别控制变压器（T）。',
                mode: 'find',
                target: 'tr',
            },
            {
                msg: '2. 识别整流二极管（D1）。',
                mode: 'find',
                target: 'd1',
            },
            {
                msg: '3. 识别滤波电容（C1）。',
                mode: 'find',
                target: 'c1',
            },
            {
                msg: '4. 识别稳压二极管（DZ）。',
                mode: 'find',
                target: 'zd',
            },
            {
                msg: '5. 识别三极管（Q1）。',
                mode: 'find',
                target: 'q1',
            },
            {
                msg: '6. 识别充电指示发光二极管（LED）。',
                mode: 'find',
                target: 'led',
            },
            {
                msg: '7. 识别镍氢电池（BT）。',
                mode: 'find',
                target: 'bt',
            },
            {
                msg: '8. 测试题：稳压二极管的工作状态',
                mode: 'quiz',
                quizConfig: {
                    question: '在本电路中，稳压二极管 DZ 工作在什么状态？',
                    options: [
                        '反向击穿状态（稳压工作区）',
                        '正向导通状态',
                        '反向截止状态',
                        '饱和导通状态',
                    ],
                    answer: 0,
                    analysis: '稳压二极管工作在反向击穿区：反向电流在一定范围内变化时，' +
                        '两端电压几乎不变，从而为三极管基极提供稳定的 6 V 基准。',
                },
            },
            {
                msg: '9. 测试题：充电电流由什么决定',
                mode: 'quiz',
                quizConfig: {
                    question: '本电路把充电电流设定为 100 mA，主要靠什么实现？',
                    options: [
                        '稳压管稳住基极电位，发射极电阻 R3 决定发射极电流',
                        '电池电压越高，充电电流越大',
                        '整流滤波后的电压直接决定充电电流',
                        '三极管的放大倍数决定充电电流',
                    ],
                    answer: 0,
                    analysis: '基极被稳压管钳在 6 V，发射极电位 Ve≈6−0.7=5.3 V 基本不变，' +
                        '充电电流 I≈Ve/R3，只由发射极电阻决定。',
                },
            },
        ],
    },

    'charger-analyze': {
        id: 'charger-analyze',
        name: '2. 电池恒流充电电路分析',
        steps: [
            {
                msg: '1. 自动接线，合上电源，观察指示灯与电池状态。',
                mode: 'check',
                op: [
                    {
                        type: 'wire', target: 'ac', button: 'btnAutoWire',
                        msg: '点击「自动接线」，按图接好充电回路',
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
                        type: 'observe', target: 'led',
                        msg: '充电指示灯点亮，说明回路已通电',
                        async act() { await _sleep(1500); },
                    },
                    {
                        type: 'observe', target: 'bt',
                        msg: '电池显示电压约 1.2 V，正在充电',
                        async act() { await _sleep(2000); },
                    },
                ],
                check() {
                    const sys = _sysOf(this);
                    const ac = _comp(sys, 'ac');
                    return !!(ac && ac.isOn)
                        && _touches(sys, 'ac_wire_p') && _wired(sys, 'tr_wire_s1', 'd1_wire_l')
                        && _wired(sys, 'bt_wire_n', 'q1_wire_c');
                },
            },
            {
                msg: '2. 用数字万用表直流档测滤波电容电压。',
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
                        type: 'observe', target: 'multimeter', ports: ['multimeter_wire_v', 'c1_wire_l'],
                        msg: '红表笔接滤波电容正端',
                        async act() { await _wire(_sysOf(this), 'multimeter_wire_v', 'c1_wire_l'); },
                    },
                    {
                        type: 'observe', target: 'multimeter', ports: ['multimeter_wire_com', 'c1_wire_r'],
                        msg: '黑表笔接滤波电容负端',
                        async act() { await _wire(_sysOf(this), 'multimeter_wire_com', 'c1_wire_r'); },
                    },
                    {
                        type: 'observe', target: 'multimeter', part: 'lcd',
                        msg: '读数约 15 V：整流后又经电容滤波',
                        async act() { await _waitStable(() => _mmReading(_sysOf(this)), 0.05); },
                    },
                ],
                check() {
                    const sys = _sysOf(this);
                    const mm = _comp(sys, 'multimeter');
                    return !!(mm && mm.group && mm.group.visible() && mm.mode === 'DCV20')
                        && _wired(sys, 'multimeter_wire_v', 'c1_wire_l')
                        && _wired(sys, 'multimeter_wire_com', 'c1_wire_r');
                },
            },
            {
                msg: '3. 表笔移到稳压管两端，读稳定基准电压。',
                mode: 'check',
                op: [
                    {
                        type: 'observe', target: 'multimeter',
                        msg: '先拔下两只表笔（换测点前收线）',
                        async act() { _removeProbes(_sysOf(this)); await _sleep(800); },
                    },
                    {
                        type: 'observe', target: 'multimeter', ports: ['multimeter_wire_v', 'zd_wire_r'],
                        msg: '红表笔接稳压管阴极',
                        async act() { await _wire(_sysOf(this), 'multimeter_wire_v', 'zd_wire_r'); },
                    },
                    {
                        type: 'observe', target: 'multimeter', ports: ['multimeter_wire_com', 'zd_wire_l'],
                        msg: '黑表笔接稳压管阳极',
                        async act() { await _wire(_sysOf(this), 'multimeter_wire_com', 'zd_wire_l'); },
                    },
                    {
                        type: 'observe', target: 'multimeter', part: 'lcd',
                        msg: '读数约 6 V，这就是基极的稳压基准',
                        async act() { await _waitStable(() => _mmReading(_sysOf(this)), 0.02); },
                    },
                ],
                check() {
                    const sys = _sysOf(this);
                    return _wired(sys, 'multimeter_wire_v', 'zd_wire_r')
                        && _wired(sys, 'multimeter_wire_com', 'zd_wire_l');
                },
            },
            {
                msg: '4. 根据读数，填写稳压管两端的电压。',
                mode: 'fill',
                target: 'zd',
                fields: [
                    { label: '稳压管电压', unit: 'V', answer: 6.0, tolerance: 0.05, placeholder: '请输入稳压管两端电压' },
                ],
            },
            {
                msg: '5. 表笔移到发射极与地，测发射极电位。',
                mode: 'check',
                op: [
                    {
                        type: 'observe', target: 'multimeter',
                        msg: '先拔下两只表笔',
                        async act() { _removeProbes(_sysOf(this)); await _sleep(800); },
                    },
                    {
                        type: 'observe', target: 'multimeter', ports: ['multimeter_wire_v', 'q1_wire_e'],
                        msg: '红表笔接三极管发射极',
                        async act() { await _wire(_sysOf(this), 'multimeter_wire_v', 'q1_wire_e'); },
                    },
                    {
                        type: 'observe', target: 'multimeter', ports: ['multimeter_wire_com', 'gnd6_wire_gnd'],
                        msg: '黑表笔接地',
                        async act() { await _wire(_sysOf(this), 'multimeter_wire_com', 'gnd6_wire_gnd'); },
                    },
                    {
                        type: 'observe', target: 'multimeter', part: 'lcd',
                        msg: '读数约 5.3 V，基极 6 V 减去 Vbe',
                        async act() { await _waitStable(() => _mmReading(_sysOf(this)), 0.02); },
                    },
                ],
                check() {
                    const sys = _sysOf(this);
                    return _wired(sys, 'multimeter_wire_v', 'q1_wire_e')
                        && _wired(sys, 'multimeter_wire_com', 'gnd6_wire_gnd');
                },
            },
            {
                msg: '6. 用发射极电位算出 T1 档的充电电流。',
                mode: 'fill',
                target: 'q1',
                fields: [
                    { label: '发射极电位', unit: 'V', answer: 5.3, tolerance: 0.05, placeholder: '请输入 Ve' },
                    { label: '充电电流', unit: 'mA', answer: 100, tolerance: 0.1, placeholder: 'I = Ve / 53Ω' },
                ],
            },
            {
                msg: '7. 把 SA 拨到 T2 档，观察充电电流变小。',
                mode: 'check',
                op: [
                    {
                        type: 'switch', target: 'sw',
                        msg: '点击开关 SA，刀片由 T1 摆向 T2',
                        async act() {
                            const sys = _sysOf(this);
                            const sw = _comp(sys, 'sw');
                            if (!sw) return;
                            // DiagramSPDT 未注册命中部件（整块热区处理 click），
                            // 取不到部件节点时用组件公开方法 toggle() 兜底
                            if (!_firePart(sw, 'blade', 'click') && typeof sw.toggle === 'function') {
                                sw.toggle();
                            }
                            await _waitFor(sys, s => {
                                const c = _comp(s, 'sw');
                                return c && c.getPosition && c.getPosition() === 2;
                            }, 4000);
                        },
                    },
                    {
                        type: 'observe', target: 'multimeter', part: 'lcd',
                        msg: '发射极电位不变，电流按 R4 重新确定',
                        async act() { await _sleep(2200); },
                    },
                    {
                        type: 'observe', target: 'led',
                        msg: '指示灯仍亮，说明电池仍在充电',
                        async act() { await _sleep(1600); },
                    },
                ],
                check() {
                    const sw = _comp(_sysOf(this), 'sw');
                    return !!(sw && typeof sw.getPosition === 'function' && sw.getPosition() === 2);
                },
            },
            {
                msg: '8. 根据 R4 的阻值，填写 T2 档的充电电流。',
                mode: 'fill',
                target: 'sw',
                fields: [
                    { label: '充电电流', unit: 'mA', answer: 50, tolerance: 0.15, placeholder: 'I = Ve / 106Ω' },
                ],
            },
            {
                msg: '9. 把电池初始 SOC 改为 0.95，看电流是否变化。',
                mode: 'check',
                op: [
                    {
                        type: 'observe', target: 'bt',
                        msg: '打开电池参数配置，把「初始 SOC」改为 0.95',
                        async act() { await _demoSetCfg(this, 'bt', 'initialSOC', 0.95, '把「初始 SOC」改为 0.95'); },
                    },
                    {
                        type: 'observe', target: 'bt',
                        msg: '电池电压升到约 1.25 V',
                        async act() {
                            await _waitFor(_sysOf(this), s => {
                                const b = _comp(s, 'bt');
                                return b && typeof b.getSOC === 'function' && b.getSOC() > 0.9;
                            }, 6000);
                            await _sleep(800);
                        },
                    },
                    {
                        type: 'observe', target: 'multimeter', part: 'lcd',
                        msg: '发射极电位几乎不变 —— 充电电流仍是 50 mA',
                        async act() { await _sleep(2400); },
                    },
                ],
                check() {
                    const sys = _sysOf(this);
                    const bt = _comp(sys, 'bt');
                    const soc = bt && typeof bt.getSOC === 'function' ? bt.getSOC() : 0;
                    // 电池 SOC 已改到 0.9 以上，且万用表仍搭在发射极上（正在看电流是否变化）
                    const okProbe = _wired(sys, 'multimeter_wire_v', 'q1_wire_e')
                        || _wired(sys, 'multimeter_wire_com', 'q1_wire_e');
                    return soc > 0.9 && okProbe;
                },
            },
            {
                msg: '10. 测试题：恒流充电的原理',
                mode: 'quiz',
                quizConfig: {
                    question: '电池电压从 1.20 V 升到 1.25 V，充电电流为什么几乎不变？',
                    options: [
                        '基极电位被稳压管钳住，发射极电阻决定电流，与电池电压无关',
                        '电池内阻很大，把电流限制住了',
                        '变压器副边电压稳定，所以电流稳定',
                        '三极管饱和导通，电流由集电极电阻决定',
                    ],
                    answer: 0,
                    analysis: 'Vb 被稳压管钳在 6 V，Ve≈5.3 V 恒定，I≈Ve/R 只由发射极电阻决定；' +
                        '电池电压升高只让三极管管压降 Uce 减小，充电电流基本不变。',
                },
            },
        ],
    },
};

export const componentConfigs = [
    // ── 交流侧与整流滤波 ──
    { Class: ACPower, id: 'ac', x: 40, y: 150, vRms: 220, freq: 50, isOn: false },
    { Class: RealControlTransformer, id: 'tr', x: 250, y: 110, primaryVoltage: 220, secondaryVoltage: 12 },
    { Class: Ground, id: 'gnd1', x: 130, y: 380 },
    { Class: Diode, id: 'd1', x: 600, y: 160 },
    { Class: Capacitor, id: 'c1', x: 740, y: 210, subtype: 'el', capacitance: 2200, rotation: 90, leak: 10000 },
    { Class: Ground, id: 'gnd2', x: 520, y: 330 },
    { Class: Ground, id: 'gnd3', x: 740, y: 310 },

    // ── 稳压基准 ──
    { Class: Resistor, id: 'r1', x: 880, y: 210, value: 470, rotation: 90 },
    { Class: Zener, id: 'zd', x: 880, y: 330, vForward: 0.7, vZener: 6.0, rotation: -90 },
    { Class: Ground, id: 'gnd4', x: 880, y: 430 },

    // ── 充电回路：电池 + 恒流三极管 ──
    { Class: NiMHBattery, id: 'bt', x: 1000, y: 160, capacity: 100, initialSOC: 0.5 },
    { Class: Transistor, id: 'q1', x: 1060, y: 380, subType: 'NPN', beta: 100 },

    // ── 充电指示支路：R2 + LED ──
    { Class: Resistor, id: 'r2', x: 1080, y: 500, value: 2000, rotation: 90 },
    { Class: LED, id: 'led', x: 1080, y: 580, vForward: 2.0, rotation: 90 },
    { Class: Ground, id: 'gnd6', x: 1080, y: 650 },

    // ── 充电电流档位：SA + R3(53Ω) / R4(106Ω) ──
    { Class: DiagramSPDT, id: 'sw', x: 1300, y: 340, label: 'SA', initPosition: 1, direction: 'reverse' },
    { Class: Resistor, id: 'r3', x: 1330, y: 500, value: 53, rotation: 90 },
    { Class: Resistor, id: 'r4', x: 1430, y: 500, value: 106, rotation: 90 },
    { Class: Ground, id: 'gnd5', x: 1380, y: 590 },

    // ── 7 种保留仪表（默认隐藏，从「选择仪表」调出）──
    // 主电路（含 SA、R3/R4）占 y ≤ 620；仪表统一停靠在电路下方 y ≥ 650，
    // 示波器 / 数字万用表 / 指针表三者互不遮挡，其余仪表分区摆放。
    { Class: Multimeter, id: 'multimeter', x: 630, y: 500, visible: false },
    { Class: Oscilloscope_tri, id: 'osc', x: 700, y: 890, visible: false },
    { Class: MF47Multimeter, id: 'mf47-panel', x: 1200, y: 640, visible: false },
    { Class: RealMegohmMeter, id: 'megohm', x: 40, y: 430, visible: false },
    { Class: ElecMeter, id: 'elecmeter', x: 40, y: 730, visible: false },
    { Class: SignalGenerator, id: 'sg', x: 600, y: 560, visible: false },
    { Class: ProcessCalibrator, id: 'cali', x: 1220, y: 660, visible: false },
];

export function initSlider(_sys) { }

/** 工具栏「自动接线」：接好充电回路（初始化时不做，保持画布无预接线） */
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
