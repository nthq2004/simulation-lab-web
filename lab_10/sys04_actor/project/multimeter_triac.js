// 晶闸管调光仿真项目 — 双向晶闸管与双向触发二极管
// 电路：AC 220V → 白炽灯 → TRIAC(MT2-MT1) → GND
//       触发回路：TRIAC MT2 → R1 → VR1 → C1 → DIAC → TRIAC(G)

import { ACPower } from '../components/ACPower.js';
import { Ground } from '../components/Gnd.js';
import { IncandescentLamp } from '../components/IncandescentLamp.js';
import { Triac } from '../components/Triac.js';
import { DIAC } from '../components/DIAC.js';
import { RealResistor } from '../components/RealResistor.js';
import { RealVariResistor } from '../components/RealVariResistor.js';
import { Capacitor } from '../components/Capacitor.js';
import { Multimeter }         from '../components/Multimeter.js';
import { MF47Multimeter }     from '../components/MF47Multimeter.js';
import { AmpMeter } from '../components/AmpMeter.js';
import { Oscilloscope_tri }   from '../components/Osc_tri.js';
import { SignalGenerator }    from '../components/SignalGenerator.js';
import { ProcessCalibrator }  from '../components/ProcessCalibrator.js';

export const FAULT_CONFIGS = {
    triac_short: {
        id: 'triac_short',
        name: 'TRIAC 击穿短路',
        system: '晶闸管',
        check() {
            const c = window.sys && window.sys.comps && window.sys.comps['triac1'];
            return c && c._faultMTShort;
        },
        trigger() {
            const c = window.sys && window.sys.comps && window.sys.comps['triac1'];
            if (c) c._faultMTShort = true;
        },
        repair() {
            const c = window.sys && window.sys.comps && window.sys.comps['triac1'];
            if (c) c._faultMTShort = false;
        },
    },
    triac_gate_open: {
        id: 'triac_gate_open',
        name: 'TRIAC 门极开路',
        system: '晶闸管',
        check() {
            const c = window.sys && window.sys.comps && window.sys.comps['triac1'];
            return c && c._faultGateOpen;
        },
        trigger() {
            const c = window.sys && window.sys.comps && window.sys.comps['triac1'];
            if (c) c._faultGateOpen = true;
        },
        repair() {
            const c = window.sys && window.sys.comps && window.sys.comps['triac1'];
            if (c) c._faultGateOpen = false;
        },
    },
    diac_short: {
        id: 'diac_short',
        name: 'DIAC 击穿短路',
        system: '触发二极管',
        check() {
            const c = window.sys && window.sys.comps && window.sys.comps['diac1'];
            return c && c._faultShort;
        },
        trigger() {
            const c = window.sys && window.sys.comps && window.sys.comps['diac1'];
            if (c) c._faultShort = true;
        },
        repair() {
            const c = window.sys && window.sys.comps && window.sys.comps['diac1'];
            if (c) c._faultShort = false;
        },
    },
};

export const PROJECT_WORKFLOWS = {
    'triac-basic': {
        id: 'triac-basic',
        name: '1. 晶闸管调光电路搭建',
        steps: [
            {
                msg: '1. 接通主回路：AC → 白炽灯 → TRIAC → GND，并闭合回路',
                mode: 'check',
                act() {
                    _doPresetWiring(this.sys);
                },
                check() {
                    const conns = this.sys.conns || [];
                    const has = (a, b) => conns.some(c => (c.from === a && c.to === b) || (c.from === b && c.to === a));
                    return has('ac_wire_p', 'lamp1_wire_l')
                        && has('lamp1_wire_r', 'triac1_wire_mt2')
                        && has('triac1_wire_mt1', 'gnd1_wire_gnd')
                        && has('ac_wire_n', 'gnd2_wire_gnd');
                },
            },
            {
                msg: '2. 接触发回路：白炽灯右端（TRIAC 的 MT2）→ 10kΩ → 电位器 → C1，C1 另一端接地',
                mode: 'check',
                act() {},
                check() {
                    const conns = this.sys.conns || [];
                    const has = (a, b) => conns.some(c => (c.from === a && c.to === b) || (c.from === b && c.to === a));
                    return has('lamp1_wire_r', 'r1_wire_l')
                        && has('r1_wire_r', 'vr1_wire_l')
                        && has('vr1_wire_r', 'c1_wire_l')
                        && has('c1_wire_r', 'gnd1_wire_gnd');
                },
            },
            {
                msg: '3. 将 DIAC 串入触发回路：C1 上端（或 VR1 右端）→ DIAC → TRIAC 门极 G',
                mode: 'check',
                act() {},
                check() {
                    const s = this.sys;
                    const same = (a, b) => _sameCluster(s, a, b);
                    const diacLtoC1 = same('diac1_wire_l', 'c1_wire_l');
                    const diacLtoVR1 = same('diac1_wire_l', 'vr1_wire_r');
                    const diacRtoGate = same('diac1_wire_r', 'triac1_wire_g');
                    return (diacLtoC1 || diacLtoVR1) && diacRtoGate;
                },
            },
            {
                msg: '4. 接通电源，观察白炽灯亮度（默认 220V，额定亮度）',
                mode: 'check',
                act() {
                    const ac = this.sys.comps['ac'];
                    if (ac) { ac.isOn = true; ac.vRms = 220; ac.freq = 50; ac.update(); }
                },
                check() {
                    const ac = this.sys.comps['ac'];
                    return ac && ac.isOn;
                },
            },
            {
                msg: '5. 将电位器 VR1 调小（阻值 < 10kΩ），导通角增大，白炽灯变亮',
                mode: 'check',
                act() {},
                check() {
                    const vr1 = this.sys.comps['vr1'];
                    return vr1 && vr1.currentResistance < 10000;
                },
            },
            {
                msg: '6. 将电位器 VR1 调大（阻值 > 380kΩ），导通角减小，白炽灯变暗',
                mode: 'check',
                act() {},
                check() {
                    const vr1 = this.sys.comps['vr1'];
                    return vr1 && vr1.currentResistance > 380000;
                },
            },
            {
                msg: '7. 测试题：调光原理',
                mode: 'quiz',
                quizConfig: {
                    question: '双向晶闸管（TRIAC）调光电路中，电位器 VR1 的作用是？',
                    options: [
                        '限制 TRIAC 门极电流，防止损坏',
                        '改变 RC 充电时间常数，从而改变 DIAC 触发相位角',
                        '分压，为白炽灯提供不同的电压',
                        '作为保护电阻，防止白炽灯短路',
                    ],
                    answer: 1,
                    analysis: '电位器与固定电阻串联，共同决定 C1 的充电时间常数 τ = RC。' +
                        '改变 VR1 即改变 R，从而改变 C1 电压达到 DIAC 转折电压的时间，' +
                        '即改变 TRIAC 的导通角，实现调光。',
                },
            },
        ],
    },
    'triac-overdrive': {
        id: 'triac-overdrive',
        name: '2. 五步进调光与电压过载',
        steps: [
            {
                msg: '1. 确认电路正常运行，AC 220V',
                mode: 'check',
                act() {},
                check() {
                    const ac = this.sys.comps['ac'];
                    return ac && ac.isOn && Math.abs(ac.vRms - 220) < 10;
                },
            },
            {
                msg: '2. 将 VR1 调至 400kΩ —— 导通角小，灯光较暗',
                mode: 'check',
                act() {
                    _setVR1Resistance(this.sys, 400000);
                },
                check() {
                    const vr1 = this.sys.comps['vr1'];
                    return vr1 && Math.abs(vr1.currentResistance - 400000) < 20000;
                },
            },
            {
                msg: '3. 将 VR1 调至 300kΩ —— 导通角增大，灯光变亮',
                mode: 'check',
                act() {
                    _setVR1Resistance(this.sys, 300000);
                },
                check() {
                    const vr1 = this.sys.comps['vr1'];
                    return vr1 && Math.abs(vr1.currentResistance - 300000) < 10000;
                },
            },
            {
                msg: '4. 将 VR1 调至 200kΩ —— 导通角继续增大',
                mode: 'check',
                act() {
                    _setVR1Resistance(this.sys, 200000);
                },
                check() {
                    const vr1 = this.sys.comps['vr1'];
                    return vr1 && Math.abs(vr1.currentResistance - 200000) < 10000;
                },
            },
            {
                msg: '5. 将 VR1 调至 50kΩ —— 导通角更大，灯更亮',
                mode: 'check',
                act() {
                    _setVR1Resistance(this.sys, 50000);
                },
                check() {
                    const vr1 = this.sys.comps['vr1'];
                    return vr1 && Math.abs(vr1.currentResistance - 50000) < 3000;
                },
            },
            {
                msg: '6. 将 VR1 调至 5kΩ —— 导通角最大，灯光最亮',
                mode: 'check',
                act() {
                    _setVR1Resistance(this.sys, 5000);
                },
                check() {
                    const vr1 = this.sys.comps['vr1'];
                    return vr1 && Math.abs(vr1.currentResistance - 5000) < 1000;
                },
            },
            {
                msg: '7. VR1 保持 5kΩ，将电压升至 250V —— 灯丝发白，超额定亮度',
                mode: 'check',
                act() {
                    _setVR1Resistance(this.sys, 5000);
                    const ac = this.sys.comps['ac'];
                    if (ac) { ac.vRms = 250; ac.update(); }
                },
                check() {
                    const ac = this.sys.comps['ac'];
                    const vr1 = this.sys.comps['vr1'];
                    return ac && Math.abs(ac.vRms - 250) < 10
                        && vr1 && Math.abs(vr1.currentResistance - 5000) < 1000;
                },
            },
            {
                msg: '8. 电压升至 300V —— 白炽灯因过压烧毁！',
                mode: 'check',
                act() {
                    const ac = this.sys.comps['ac'];
                    if (ac) { ac.vRms = 300; ac.update(); }
                },
                check() {
                    const lamp = this.sys.comps['lamp1'];
                    return lamp && lamp._burnedOut;
                },
            },
            {
                msg: '9. 测试题：白炽灯烧毁原理',
                mode: 'quiz',
                quizConfig: {
                    question: '白炽灯灯丝烧毁的最主要原因是？',
                    options: [
                        '电压过低，电流过大',
                        '灯丝表面氧化，电阻增大',
                        '灯丝温度超过钨的熔点，导致熔断',
                        '玻璃外壳破碎',
                    ],
                    answer: 2,
                    analysis: '白炽灯依靠灯丝（钨丝）通过电流发热至白炽状态发光。' +
                        '当电压超过额定值（如 270V）时，灯丝温度急剧升高超过钨的熔点（3422°C），' +
                        '导致灯丝熔断。',
                },
            },
        ],
    },
    'triac-osc-measure': {
        id: 'triac-osc-measure',
        name: '3. 用示波器观察调光波形',
        steps: [
            {
                msg: '1. 接通电路，合上电源，打开三路示波器',
                mode: 'check',
                act() {
                    const ac = this.sys.comps['ac'];
                    if (ac) { ac.isOn = true; ac.vRms = 220; ac.freq = 50; ac.update(); }
                    const osc = this.sys.comps['osc3'];
                    if (osc && osc.group) osc.group.visible(true);
                    if (osc && typeof osc._start === 'function') osc._start();
                },
                check() {
                    const ac = this.sys.comps['ac'];
                    const osc = this.sys.comps['osc3'];
                    return ac && ac.isOn && osc && osc.group && osc.group.visible();
                },
            },
            {
                msg: '2. 示波器 CH1 探针接白炽灯两端（L-N），观察负载电压波形',
                mode: 'check',
                act() {
                    _disconnectOsc(this.sys);
                    this.sys.connMgr.addConn({ from: 'osc3_wire_ch1p', to: 'lamp1_wire_l', type: 'wire' });
                    this.sys.connMgr.addConn({ from: 'osc3_wire_ch1n', to: 'lamp1_wire_r', type: 'wire' });
                    this.sys.redrawAll();
                },
                check() {
                    return _sameCluster(this.sys, 'osc3_wire_ch1p', 'lamp1_wire_l')
                        && _sameCluster(this.sys, 'osc3_wire_ch1n', 'lamp1_wire_r');
                },
            },
            {
                msg: '3. 示波器 CH2 探针接 C1 两端，观察 RC 充放电波形（锯齿波）',
                mode: 'check',
                act() {
                    this.sys.connMgr.addConn({ from: 'osc3_wire_ch2p', to: 'c1_wire_l', type: 'wire' });
                    this.sys.connMgr.addConn({ from: 'osc3_wire_ch2n', to: 'c1_wire_r', type: 'wire' });
                    this.sys.redrawAll();
                },
                check() {
                    return _sameCluster(this.sys, 'osc3_wire_ch2p', 'c1_wire_l')
                        && _sameCluster(this.sys, 'osc3_wire_ch2n', 'c1_wire_r');
                },
            },
            {
                msg: '4. 将 VR1 调至大于 400kΩ（导通角极小），观察 CH1 负载电压和 CH2 电容锯齿波',
                mode: 'check',
                act() {},
                check() {
                    const vr1 = this.sys.comps['vr1'];
                    return vr1 && vr1.currentResistance > 380000;
                },
            },
            {
                msg: '5. 将 VR1 调至约 200kΩ（中等导通角），观察 CH1 负载电压和 CH2 电容波形',
                mode: 'check',
                act() {},
                check() {
                    const vr1 = this.sys.comps['vr1'];
                    return vr1 && Math.abs(vr1.currentResistance - 200000) < 20000;
                },
            },
            {
                msg: '6. 将 VR1 调至小于 5kΩ（导通角最大），观察 CH1 负载电压和 CH2 电容波形',
                mode: 'check',
                act() {},
                check() {
                    const vr1 = this.sys.comps['vr1'];
                    return vr1 && vr1.currentResistance < 10000;
                },
            },
            {
                msg: '7. 测试题：调光波形',
                mode: 'quiz',
                quizConfig: {
                    question: '白炽灯两端电压波形在 TRIAC 调光时呈现什么形状？',
                    options: [
                        '完整正弦波',
                        '被斩波后的正弦波片段',
                        '方波',
                        '三角波',
                    ],
                    answer: 1,
                    analysis: 'TRIAC 未导通时白炽灯无电流流过，端电压为零；' +
                        '当触发导通后，白炽灯获得剩余半周的交流电压。' +
                        '因此负载两端为不完整的正弦波片段，即"斩波"波形。' +
                        '导通角越小，斩波越多，灯光越暗。',
                },
            },
        ],
    },
    'triac-mf47-test': {
        id: 'triac-mf47-test',
        name: '4. 用指针万用表测试双向晶闸管',
        steps: [
            {
                msg: '1. 将指针万用表（MF47）拨到 R×100（×100Ω）档位',
                mode: 'check',
                act() {
                    const mf47 = this.sys.comps['mf47-panel'];
                    if (mf47) { mf47.group.visible(true); mf47.setRange('OHM100'); }
                },
                check() {
                    const mf47 = this.sys.comps['mf47-panel'];
                    return mf47 && mf47._rangeId === 'OHM100' && mf47.group.visible();
                },
            },
            {
                msg: '2. 黑表笔（COM/+）接 G，红表笔（V/−）接 MT1\n测量 G-MT1 正向电阻（观察表针偏转情况）',
                mode: 'check',
                act() {
                    _disconnectMF47(this.sys);
                    this.sys.connMgr.addConn({ from: 'mf47-panel_wire_COM', to: 'triac1_wire_g', type: 'wire' });
                    this.sys.connMgr.addConn({ from: 'mf47-panel_wire_v', to: 'triac1_wire_mt1', type: 'wire' });
                    this.sys.redrawAll();
                },
                check() {
                    return _sameCluster(this.sys, 'mf47-panel_wire_COM', 'triac1_wire_g')
                        && _sameCluster(this.sys, 'mf47-panel_wire_v', 'triac1_wire_mt1');
                },
            },
            {
                msg: '3. 交换表笔：黑表笔（COM/+）接 MT1，红表笔（V/−）接 G\n测量 G-MT1 反向电阻（应显示 ∞，表针不动）',
                mode: 'check',
                act() {
                    _disconnectMF47(this.sys);
                    this.sys.connMgr.addConn({ from: 'mf47-panel_wire_COM', to: 'triac1_wire_mt1', type: 'wire' });
                    this.sys.connMgr.addConn({ from: 'mf47-panel_wire_v', to: 'triac1_wire_g', type: 'wire' });
                    this.sys.redrawAll();
                },
                check() {
                    return _sameCluster(this.sys, 'mf47-panel_wire_COM', 'triac1_wire_mt1')
                        && _sameCluster(this.sys, 'mf47-panel_wire_v', 'triac1_wire_g');
                },
            },
            {
                msg: '4. 黑表笔（COM/+）接 MT2，红表笔（V/−）接 MT1\n测量 MT1-MT2 电阻（未触发应显示 ∞）',
                mode: 'check',
                act() {
                    _disconnectMF47(this.sys);
                    this.sys.connMgr.addConn({ from: 'mf47-panel_wire_COM', to: 'triac1_wire_mt2', type: 'wire' });
                    this.sys.connMgr.addConn({ from: 'mf47-panel_wire_v', to: 'triac1_wire_mt1', type: 'wire' });
                    this.sys.redrawAll();
                },
                check() {
                    const mf47 = this.sys.comps['mf47-panel'];
                    const triac = this.sys.comps['triac1'];
                    return mf47 && mf47._range?.group === 'OHM'
                        && triac && !triac._triggered
                        && _sameCluster(this.sys, 'mf47-panel_wire_COM', 'triac1_wire_mt2')
                        && _sameCluster(this.sys, 'mf47-panel_wire_v', 'triac1_wire_mt1');
                },
            },
            {
                msg: '5. 用导线短接 G-MT2 触发双向晶闸管，撤除短路线后观察 MT1-MT2 阻值变化',
                mode: 'check',
                act() {
                    _disconnectMF47(this.sys);
                    this.sys.connMgr.addConn({ from: 'mf47-panel_wire_COM', to: 'triac1_wire_mt2', type: 'wire' });
                    this.sys.connMgr.addConn({ from: 'mf47-panel_wire_v', to: 'triac1_wire_mt1', type: 'wire' });
                    const triac = this.sys.comps['triac1'];
                    if (triac) triac._triggered = true;
                    this.sys.redrawAll();
                },
                check() {
                    const triac = this.sys.comps['triac1'];
                    if (!triac) return false;
                    /* step/auto 模式下 act() 已设为 true */
                    if (triac._triggered) return true;
                    /* train/eval 模式：用户短接 G-MT2 时触发 */
                    const s = this.sys.voltageSolver;
                    const cG = s?.portToCluster?.get('triac1_wire_g');
                    const cMT2 = s?.portToCluster?.get('triac1_wire_mt2');
                    if (cG !== undefined && cG === cMT2) {
                        triac._triggered = true;
                        this.sys.redrawAll();
                    }
                    return triac._triggered;
                },
            },
            {
                msg: '6. 测试题：双向晶闸管检测',
                mode: 'quiz',
                quizConfig: {
                    question: '用指针万用表 R×100 档检测双向晶闸管（TRIAC），以下描述正确的是？',
                    options: [
                        '短接 G-MT2 触发后，MT1-MT2 阻值由∞变为较小阻值',
                        '黑表笔接 G、红表笔接 MT1 时 G-MT1 正向导通，指针偏转至较小阻值',
                        'MT1-MT2 之间无论是否触发，阻值始终为无穷大',
                        '短接 G-MT2 触发后断开，TRIAC 保持导通与 SCR 相同',
                    ],
                    answer: 0,
                    analysis: 'TRIAC 的门极触发电压（约 1.5V）高于普通万用表电阻档的 1.5V 电池电压，' +
                        '因此 G-MT1 正反向测量均显示∞。检测 TRIAC 的方法是：' +
                        '测 MT1-MT2 阻值为∞（未触发），短接 G-MT2 触发后 MT1-MT2 变为低阻，' +
                        '断开触发后因测试电流小于维持电流而恢复∞。',
                },
            },
        ],
    },
};

export const componentConfigs = [
    { Class: ACPower, id: 'ac', x: 10, y: 20, vRms: 220, freq: 50, isOn: false },
    { Class: Ground, id: 'gnd1', x: 480, y: 620 },
    { Class: Ground, id: 'gnd2', x: 55, y: 260 },
    { Class: IncandescentLamp, id: 'lamp1', x: 520, y: 280, coldResistance: 484,rotation:90 },
    { Class: Triac, id: 'triac1', x: 520, y: 480, vGt: 1.5, rotation:90 },
    { Class: DIAC, id: 'diac1', x: 350, y: 500, vBreakover: 30 },
    { Class: RealResistor, id: 'r1', x: 100, y: 400, value: 10000 },
    { Class: RealVariResistor, id: 'vr1', x: 210, y: 400, totalResistance: 400000 },
    { Class: Capacitor, id: 'c1', x: 210, y: 550, capacitance: 0.1,},

    { Class: Multimeter, id: 'multimeter', x: 850, y: 30, scale: 1.1, visible: false },
    { Class: MF47Multimeter, id: 'mf47-panel', x: 950, y: 480, visible: false },
    { Class: SignalGenerator, id: 'sg', x: 80, y: 400, visible: false },
    { Class: ProcessCalibrator, id: 'cali', x: 550, y: 400, visible: false },
    { Class: Oscilloscope_tri, id: 'osc3', x: 950, y: 60, visible: false,scale: 1.2 },
    { Class: AmpMeter, id: 'ammeter', x: 1150, y: 480, visible: false, fullScale: 5, unit: 'A' },
];

function _doPresetWiring(sys) {
    sys.conns = [];
    const presetConns = [
        { from: 'ac_wire_p', to: 'lamp1_wire_l', type: 'wire' },
        { from: 'lamp1_wire_r', to: 'triac1_wire_mt2', type: 'wire' },
        { from: 'triac1_wire_mt1', to: 'gnd1_wire_gnd', type: 'wire' },
        { from: 'ac_wire_n', to: 'gnd2_wire_gnd', type: 'wire' },

        { from: 'lamp1_wire_r', to: 'r1_wire_l', type: 'wire' },
        { from: 'r1_wire_r', to: 'vr1_wire_l', type: 'wire' },
        { from: 'c1_wire_l', to: 'diac1_wire_l', type: 'wire' },
        { from: 'diac1_wire_r', to: 'triac1_wire_g', type: 'wire' },
        { from: 'vr1_wire_r', to: 'c1_wire_l', type: 'wire' },
        { from: 'c1_wire_r', to: 'gnd1_wire_gnd', type: 'wire' },
    ];
    presetConns.forEach(c => sys.connMgr.addConn(c));
    sys.redrawAll();
}

function _disconnectOsc(sys) {
    const ports = ['osc3_wire_ch1p', 'osc3_wire_ch1n', 'osc3_wire_ch2p', 'osc3_wire_ch2n', 'osc3_wire_ch3p', 'osc3_wire_ch3n'];
    const existing = sys.conns.filter(c => ports.includes(c.from) || ports.includes(c.to));
    existing.forEach(c => sys.connMgr.removeConn(c));
    sys.redrawAll();
}

function _sameCluster(sys, portA, portB) {
    const map = sys.voltageSolver?.portToCluster;
    if (!map) return false;
    const cA = map.get(portA);
    const cB = map.get(portB);
    return cA !== undefined && cA === cB;
}

function _disconnectMF47(sys) {
    const ports = ['mf47-panel_wire_v', 'mf47-panel_wire_mA', 'mf47-panel_wire_COM'];
    const existing = sys.conns.filter(c => ports.includes(c.from) || ports.includes(c.to));
    existing.forEach(c => sys.connMgr.removeConn(c));
    sys.redrawAll();
}

function _hasConn(sys, a, b) {
    return sys.conns.some(c => (c.from === a && c.to === b) || (c.from === b && c.to === a));
}

function _removeConn(sys, from, to) {
    const idx = sys.conns.findIndex(c =>
        (c.from === from && c.to === to) || (c.from === to && c.to === from));
    if (idx >= 0) sys.connMgr.removeConn(sys.conns[idx]);
}

function _setVR1Resistance(sys, value) {
    const vr1 = sys.comps['vr1'];
    if (!vr1) return;
    const ratio = value / vr1.totalResistance;
    vr1.currentDeg = (ratio - 0.5) * vr1.maxAngle;
    vr1.knobGroup.rotation(vr1.currentDeg);
    vr1.fTrack.angle(vr1.currentDeg + 135);
    vr1.updateResistors();
    vr1.title.text((value / 1000).toFixed(0) + 'kΩ');
    sys.redrawAll();
}

export function initSlider(_sys) {}

export function applyAllPresets() {
    _doPresetWiring(this.sys);
}

export async function applyStartSystem() {
    const sys = this.sys;
    _doPresetWiring(sys);
    const ac = sys.comps['ac'];
    if (ac) { ac.isOn = true; ac.vRms = 220; ac.freq = 50; ac.update(); }
}

const _fiveStepResistances = [400000, 300000, 200000, 50000, 5000];
let _fiveStepIndex = 0;

export function fiveStep() {
    const sys = this && this.sys ? this.sys : window.sys;
    if (!sys) return;
    const vr1 = sys.comps['vr1'];
    if (!vr1) return;
    const target = _fiveStepResistances[_fiveStepIndex];
    if (target !== undefined) {
        _setVR1Resistance(sys, target);
        _fiveStepIndex = (_fiveStepIndex + 1) % _fiveStepResistances.length;
    }
}
