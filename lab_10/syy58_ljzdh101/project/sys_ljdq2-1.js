// 电子元器件识别与测试仿真工程
//   · componentConfigs  组件布局（单页工程，全部同屏显示）
//   · PROJECT_WORKFLOWS 工作流（最新范式：find + check(op[]) + fill + quiz）
// 约定：
//   · 单页工程：不导出 PROJECT_PAGES，consys.js 不创建 PageManager
//   · 无电源/无接线图：初始化不预接线；表笔连线只为测量
//   · 仪表一律走「选择仪表」界面（op.type='instrument'），表笔接线用动画接线（3s/根）

import { RealResistor } from '../components/RealResistor.js';
import { RealCapacitor } from '../components/RealCapacitor.js';
import { RealDiode } from '../components/RealDiode.js';
import { RealTransistor } from '../components/RealTransistor.js';
import { RealScr } from '../components/RealScr.js';
import { ElectronicsPanel } from '../components/ElectronicsPanel.js';
import { Multimeter } from '../components/Multimeter.js';
import { MF47Multimeter } from '../components/MF47Multimeter.js';
import { RealMegohmMeter } from '../components/RealMegohmMeter.js';
import { Oscilloscope_tri } from '../components/Osc_tri.js';
import { SignalGenerator } from '../components/SignalGenerator.js';
import { ProcessCalibrator } from '../components/ProcessCalibrator.js';
import { ElecMeter } from '../components/ElecMeter.js';

export const FAULT_CONFIGS = {
};

// ═══════════════════════════════════════════════════════════════
// 一、通用辅助（工作流用）
// ═══════════════════════════════════════════════════════════════

const _sysOf = (ctx) => (ctx && ctx.sys) ? ctx.sys : window.sys;
const _sleep = (ms) => new Promise(r => setTimeout(r, ms));
const _comp = (sys, id) => (sys && sys.comps) ? sys.comps[id] : null;

/** 撤掉全部表笔线（换元件测量前先收线，避免并联到别的元件上去） */
function _clearWires(sys) {
    if (!sys) return;
    sys.conns.length = 0;
    sys.redrawAll();
    if (typeof sys.requestRedraw === 'function') sys.requestRedraw();
}

/** 动画接线：表笔接线一律逐根动画（约 3s/根），不用瞬时 addConn */
async function _wire(sys, from, to) {
    if (!sys || !sys.connMgr) return;
    await sys.connMgr.addConnectionAnimated({ from, to, type: 'wire' });
}

/** 两个端口之间是否已连（供 check() 判定） */
function _wired(sys, a, b) {
    return !!(sys && Array.isArray(sys.conns) && sys.conns.some(c =>
        c && c.type === 'wire' && ((c.from === a && c.to === b) || (c.from === b && c.to === a))));
}

/** 数字万用表切档（组件公开 API：setMode） */
function _dmmSet(ctx, mode) {
    const dmm = _comp(_sysOf(ctx), 'multimeter');
    if (dmm && typeof dmm.setMode === 'function') dmm.setMode(mode);
}

/** 数字万用表读数（屏幕文字，用于演示提示） */
function _dmmText(ctx) {
    const dmm = _comp(_sysOf(ctx), 'multimeter');
    if (!dmm || !dmm.lcdText) return '';
    const unit = dmm.lcdUnit ? dmm.lcdUnit.text() : '';
    return `${dmm.lcdText.text()} ${unit}`.trim();
}

/** 指针表换档（组件公开 API：setRange；换档后零点漂移，需重新调零） */
function _mf47Set(ctx, rangeId) {
    const mf = _comp(_sysOf(ctx), 'mf47-panel');
    if (mf && typeof mf.setRange === 'function') mf.setRange(rangeId);
    return mf;
}

/** 指针表欧姆调零：把调零旋钮转到"已调零"位置（1.0） */
function _mf47Zero(ctx) {
    const mf = _comp(_sysOf(ctx), 'mf47-panel');
    if (mf && typeof mf.onConfigUpdate === 'function') mf.onConfigUpdate({ ohmZeroAdjust: 1 });
    return mf;
}

/** 指针表当前档位 id（供 check() 判定） */
function _mf47Range(ctx) {
    const mf = _comp(_sysOf(ctx), 'mf47-panel');
    return mf ? mf._rangeId : undefined;
}

/** 指针表当前欧姆读数（Ω），∞ 用 1e9 表示 */
function _mf47Ohm(ctx) {
    const mf = _comp(_sysOf(ctx), 'mf47-panel');
    return mf ? Number(mf._inputValue) : 0;
}

// ═══════════════════════════════════════════════════════════════
// 二、工作流
// ═══════════════════════════════════════════════════════════════

export const PROJECT_WORKFLOWS = {
    'electronic-id': {
        id: 'electronic-id',
        name: '1. 电子元器件的识别',
        steps: [
            { msg: '1. 识别电子元器件面板中的电阻元件', mode: 'find', target: 'el-panel', subTarget: 'cell-resistor' },
            { msg: '2. 识别三极管', mode: 'find', target: 'el-panel', subTarget: 'cell-transistor' },
            { msg: '3. 识别晶闸管', mode: 'find', target: 'el-panel', subTarget: 'cell-scr' },
            { msg: '4. 识别电容', mode: 'find', target: 'el-panel', subTarget: 'cell-capacitor' },
            { msg: '5. 识别二极管', mode: 'find', target: 'el-panel', subTarget: 'cell-diode' },
            {
                msg: '6. 测试题：电阻和电容的用途',
                mode: 'quiz',
                quizConfig: {
                    question: '关于电阻和电容的用途，下列说法正确的是？',
                    options: [
                        '电阻用于储存电荷，电容用于限制电流',
                        '电阻限制电流、分配电压，电容储存电荷、滤波和隔直通交',
                        '电阻和电容都只能工作在直流电路中',
                        '电阻的阻值单位是法拉，电容的容量单位是欧姆',
                    ],
                    answer: 1,
                    analysis: '电阻的基本用途是限制电流大小、分配电压（分压），单位为欧姆（Ω）；' +
                        '电容的基本用途是储存电荷，常用于滤波、耦合（隔直通交），容量单位为法拉（F）。',
                },
            },
        ],
    },

    'digital-multimeter-test': {
        id: 'digital-multimeter-test',
        name: '2. 用数字式万用表检测电子元件',
        steps: [
            {
                msg: '1. 选择仪表 → 数字万用表，旋钮拨到 2kΩ 电阻档。',
                mode: 'check',
                op: [
                    {
                        type: 'instrument', instrument: 'multimeter',
                        msg: '选择仪表：勾选「数字万用表」，再关闭界面',
                        async act() { await _sleep(800); },
                    },
                    {
                        type: 'knob', target: 'multimeter', part: 'knob',
                        msg: '转动旋钮，拨到 2kΩ 电阻档',
                        async act() { _dmmSet(this, 'RES2k'); await _sleep(1000); },
                    },
                ],
                check() {
                    const dmm = _comp(_sysOf(this), 'multimeter');
                    return !!(dmm && dmm.group.visible() && dmm.mode === 'RES2k');
                },
            },
            {
                msg: '2. 红黑表笔跨接 R1 两端，读数 1.000 kΩ。',
                mode: 'check',
                op: [
                    {
                        type: 'observe', target: 'multimeter',
                        ports: ['multimeter_wire_v', 'r1_wire_l'],
                        msg: '红表笔接电阻左端',
                        async act() { await _wire(_sysOf(this), 'multimeter_wire_v', 'r1_wire_l'); },
                    },
                    {
                        type: 'observe', target: 'multimeter',
                        ports: ['multimeter_wire_com', 'r1_wire_r'],
                        msg: '黑表笔接电阻右端',
                        async act() { await _wire(_sysOf(this), 'multimeter_wire_com', 'r1_wire_r'); },
                    },
                    {
                        type: 'observe', target: 'multimeter', part: 'lcd',
                        msg: '读数 1.000 kΩ（电阻不分方向）',
                        async act() { await _sleep(2200); },
                    },
                ],
                check() {
                    const sys = _sysOf(this);
                    return _wired(sys, 'multimeter_wire_v', 'r1_wire_l')
                        && _wired(sys, 'multimeter_wire_com', 'r1_wire_r');
                },
            },
            {
                msg: '3. 测量电阻，在电阻旁填入阻值',
                mode: 'fill',
                target: 'r1',
                fields: [
                    { label: '阻值', unit: 'Ω', answer: 1000, tolerance: 0.05, placeholder: '请输入阻值' },
                ],
            },
            {
                msg: '4. 收表笔，换 uF 档，跨接 C1 两端等读数稳定。',
                mode: 'check',
                op: [
                    {
                        type: 'knob', target: 'multimeter', part: 'knob',
                        msg: '旋钮拨到 uF 电容档',
                        async act() { _clearWires(_sysOf(this)); _dmmSet(this, 'C'); await _sleep(900); },
                    },
                    {
                        type: 'observe', target: 'multimeter',
                        ports: ['multimeter_wire_v', 'c1_wire_l'],
                        msg: '红表笔接电容左端',
                        async act() { await _wire(_sysOf(this), 'multimeter_wire_v', 'c1_wire_l'); },
                    },
                    {
                        type: 'observe', target: 'multimeter',
                        ports: ['multimeter_wire_com', 'c1_wire_r'],
                        msg: '黑表笔接电容右端',
                        async act() { await _wire(_sysOf(this), 'multimeter_wire_com', 'c1_wire_r'); },
                    },
                    {
                        type: 'observe', target: 'multimeter', part: 'lcd',
                        msg: '充电约 3 s，读数稳定在 100 μF',
                        async act() { await _sleep(6500); },
                    },
                ],
                check() {
                    const sys = _sysOf(this);
                    const dmm = _comp(sys, 'multimeter');
                    return !!(dmm && dmm.mode === 'C')
                        && _wired(sys, 'multimeter_wire_v', 'c1_wire_l')
                        && _wired(sys, 'multimeter_wire_com', 'c1_wire_r');
                },
            },
            {
                msg: '5. 测量电容，在电容旁填入容量',
                mode: 'fill',
                target: 'c1',
                fields: [
                    { label: '容量', unit: 'uF', answer: 100, tolerance: 0.05, placeholder: '请输入容量' },
                ],
            },
            {
                msg: '6. 换二极管档，正、反各测一次 D1。',
                mode: 'check',
                op: [
                    {
                        type: 'knob', target: 'multimeter', part: 'knob',
                        msg: '旋钮拨到 ▶| 二极管档',
                        async act() { _clearWires(_sysOf(this)); _dmmSet(this, 'DIODE'); await _sleep(900); },
                    },
                    {
                        type: 'observe', target: 'multimeter',
                        ports: ['multimeter_wire_v', 'd1_wire_l'],
                        msg: '正向：红表笔接无环端 A、黑表笔接有环端 K',
                        async act() {
                            const sys = _sysOf(this);
                            await _wire(sys, 'multimeter_wire_v', 'd1_wire_l');
                            await _wire(sys, 'multimeter_wire_com', 'd1_wire_r');
                            await _sleep(1800);
                            this._d1Fwd = true;
                        },
                    },
                    {
                        type: 'observe', target: 'multimeter',
                        ports: ['multimeter_wire_v', 'd1_wire_r'],
                        msg: '反向：表笔对调，显示 O.L 说明单向导电',
                        async act() {
                            const sys = _sysOf(this);
                            _clearWires(sys);
                            await _wire(sys, 'multimeter_wire_v', 'd1_wire_r');
                            await _wire(sys, 'multimeter_wire_com', 'd1_wire_l');
                            await _sleep(1800);
                        },
                    },
                ],
                check() {
                    const sys = _sysOf(this);
                    const dmm = _comp(sys, 'multimeter');
                    return !!(dmm && dmm.mode === 'DIODE')
                        && (this._d1Fwd
                            || _wired(sys, 'multimeter_wire_v', 'd1_wire_l')
                            || _wired(sys, 'multimeter_wire_v', 'd1_wire_r'));
                },
            },
            {
                msg: '7. 测量二极管，填入管压降和引脚顺序',
                mode: 'fill',
                target: 'd1',
                fields: [
                    { label: '管压降', unit: 'V', answer: 0.68, tolerance: 0.02, placeholder: '请输入管压降' },
                    { label: '引脚顺序', answer: 'AK', placeholder: '如 AK或KA' },
                ],
            },
            {
                msg: '8. 红表笔接 B，黑表笔依次接 C、E，两次都导通。',
                mode: 'check',
                op: [
                    {
                        type: 'observe', target: 'multimeter',
                        ports: ['multimeter_wire_v', 't1_wire_b'],
                        msg: '收表笔；红表笔接基极 B',
                        async act() { _clearWires(_sysOf(this)); await _wire(_sysOf(this), 'multimeter_wire_v', 't1_wire_b'); },
                    },
                    {
                        type: 'observe', target: 'multimeter',
                        ports: ['multimeter_wire_com', 't1_wire_c'],
                        msg: '黑表笔接 C，读数 0.62 V',
                        async act() { await _wire(_sysOf(this), 'multimeter_wire_com', 't1_wire_c'); await _sleep(1800); },
                    },
                    {
                        type: 'observe', target: 'multimeter',
                        ports: ['multimeter_wire_com', 't1_wire_e'],
                        msg: '黑表笔改接 E，读数 0.70 V',
                        async act() {
                            const sys = _sysOf(this);
                            _clearWires(sys);
                            await _wire(sys, 'multimeter_wire_v', 't1_wire_b');
                            await _wire(sys, 'multimeter_wire_com', 't1_wire_e');
                            await _sleep(1800);
                        },
                    },
                    {
                        type: 'observe', target: 'multimeter', part: 'lcd',
                        msg: 'B 为公共端 → NPN 管',
                        async act() { await _sleep(1500); },
                    },
                ],
                check() {
                    const sys = _sysOf(this);
                    const dmm = _comp(sys, 'multimeter');
                    const comToC = _wired(sys, 'multimeter_wire_com', 't1_wire_c');
                    const comToE = _wired(sys, 'multimeter_wire_com', 't1_wire_e');
                    return !!(dmm && dmm.mode === 'DIODE')
                        && _wired(sys, 'multimeter_wire_v', 't1_wire_b')
                        && (comToC || comToE);
                },
            },
            {
                msg: '9. 检测三极管，填入类型和引脚顺序',
                mode: 'fill',
                target: 't1',
                fields: [
                    { label: '类型', answer: 'NPN', placeholder: '如 NPN或PNP' },
                    { label: '引脚顺序', answer: 'EBC', placeholder: '如 EBC或CBE' },
                ],
            },
            {
                msg: '10. 红笔接 G、黑笔接 K 得 0.68V；A–K 两向均 O.L。',
                mode: 'check',
                op: [
                    {
                        type: 'observe', target: 'multimeter',
                        ports: ['multimeter_wire_v', 'scr1_wire_g'],
                        msg: '收表笔；红表笔接门极 G',
                        async act() { _clearWires(_sysOf(this)); await _wire(_sysOf(this), 'multimeter_wire_v', 'scr1_wire_g'); },
                    },
                    {
                        type: 'observe', target: 'multimeter',
                        ports: ['multimeter_wire_com', 'scr1_wire_k'],
                        msg: '黑表笔接阴极 K，读数 0.68 V',
                        async act() { await _wire(_sysOf(this), 'multimeter_wire_com', 'scr1_wire_k'); await _sleep(1800); },
                    },
                    {
                        type: 'observe', target: 'multimeter',
                        ports: ['multimeter_wire_v', 'scr1_wire_a'],
                        msg: '改测 A–K：正反都是 O.L（未触发不导通）',
                        async act() {
                            const sys = _sysOf(this);
                            _clearWires(sys);
                            await _wire(sys, 'multimeter_wire_v', 'scr1_wire_a');
                            await _wire(sys, 'multimeter_wire_com', 'scr1_wire_k');
                            await _sleep(1800);
                        },
                    },
                ],
                check() {
                    const sys = _sysOf(this);
                    const dmm = _comp(sys, 'multimeter');
                    const gk = _wired(sys, 'multimeter_wire_v', 'scr1_wire_g')
                        && _wired(sys, 'multimeter_wire_com', 'scr1_wire_k');
                    const ak = _wired(sys, 'multimeter_wire_v', 'scr1_wire_a')
                        && _wired(sys, 'multimeter_wire_com', 'scr1_wire_k');
                    return !!(dmm && dmm.mode === 'DIODE') && (gk || ak);
                },
            },
            {
                msg: '11. 检测晶闸管，填入引脚顺序',
                mode: 'fill',
                target: 'scr1',
                fields: [
                    { label: '引脚顺序', answer: 'AGK', placeholder: '按上左右的顺序' },
                    { label: 'GK间压降', unit: 'V', answer: 0.68, tolerance: 0.02, placeholder: '请输入GK间正向压降' },
                ],
            },
            {
                msg: '12. 测试题：二极管和三极管的用途',
                mode: 'quiz',
                quizConfig: {
                    question: '关于二极管和三极管的用途，下列说法正确的是？',
                    options: [
                        '二极管具有单向导电性，三极管具有电流放大和开关作用',
                        '二极管用于放大电流，三极管用于整流',
                        '二极管和三极管都是线性器件，阻值固定不变',
                        '二极管的工作单位是法拉，三极管的放大倍数单位是欧姆',
                    ],
                    answer: 0,
                    analysis: '二极管的核心特性是单向导电性，常用于整流、检波、钳位等；' +
                        '三极管（晶体管的俗称）具有电流放大作用和开关作用，是放大电路与数字电路的基本元件。',
                },
            },
        ],
    },

    'mf47-test': {
        id: 'mf47-test',
        name: '3. 用指针式万用表测试电子元件',
        steps: [
            {
                msg: '1. 选择仪表 → 指针式万用表，旋钮拨到 ×1K 档。',
                mode: 'check',
                op: [
                    {
                        type: 'instrument', instrument: 'mf47',
                        msg: '选择仪表：勾选「指针万用表」，再关闭界面',
                        async act() { await _sleep(800); },
                    },
                    {
                        type: 'knob', target: 'mf47-panel', part: 'range-OHM1K',
                        msg: '旋钮拨到 ×1K 欧姆档',
                        async act() { _mf47Set(this, 'OHM1K'); await _sleep(1000); },
                    },
                ],
                check() {
                    const mf = _comp(_sysOf(this), 'mf47-panel');
                    return !!(mf && mf.group.visible() && mf._rangeId === 'OHM1K');
                },
            },
            {
                msg: '2. 两表笔短接，转调零旋钮使指针指到 0Ω。',
                mode: 'check',
                op: [
                    {
                        type: 'observe', target: 'mf47-panel',
                        ports: ['mf47-panel_wire_v', 'mf47-panel_wire_COM'],
                        msg: '两表笔短接（指针偏向 0Ω 以外）',
                        async act() { await _wire(_sysOf(this), 'mf47-panel_wire_v', 'mf47-panel_wire_COM'); },
                    },
                    {
                        type: 'knob', target: 'mf47-panel', part: 'ohm-zero',
                        msg: '转动欧姆调零旋钮，使指针回到 0Ω',
                        async act() { _mf47Zero(this); await _sleep(1600); },
                    },
                ],
                check() {
                    const sys = _sysOf(this);
                    const mf = _comp(sys, 'mf47-panel');
                    return !!(mf && Number(mf._ohmZeroAdjust) >= 0.9)
                        && _wired(sys, 'mf47-panel_wire_v', 'mf47-panel_wire_COM');
                },
            },
            {
                msg: '3. 接 R1 两端，×1K 档指针指在 1 → 1 kΩ。',
                mode: 'check',
                op: [
                    {
                        type: 'observe', target: 'mf47-panel',
                        ports: ['mf47-panel_wire_COM', 'r1_wire_l'],
                        msg: '收短接线；黑表笔接电阻一端',
                        async act() { _clearWires(_sysOf(this)); await _wire(_sysOf(this), 'mf47-panel_wire_COM', 'r1_wire_l'); },
                    },
                    {
                        type: 'observe', target: 'mf47-panel',
                        ports: ['mf47-panel_wire_v', 'r1_wire_r'],
                        msg: '红表笔接另一端',
                        async act() { await _wire(_sysOf(this), 'mf47-panel_wire_v', 'r1_wire_r'); await _sleep(1500); },
                    },
                    {
                        type: 'observe', target: 'mf47-panel', part: 'dial',
                        msg: '指针指在 1，×1K → 1 kΩ',
                        async act() { await _sleep(2200); },
                    },
                ],
                check() {
                    const sys = _sysOf(this);
                    return _wired(sys, 'mf47-panel_wire_COM', 'r1_wire_l')
                        && _wired(sys, 'mf47-panel_wire_v', 'r1_wire_r');
                },
            },
            {
                msg: '4. 测量电阻，在电阻旁填入阻值',
                mode: 'fill',
                target: 'r1',
                fields: [
                    { label: '阻值', unit: 'Ω', answer: 1000, tolerance: 0.05, placeholder: '请输入阻值' },
                ],
            },
            {
                msg: '5. 指针表没有电容档，容量只能读壳体印字。',
                mode: 'check',
                op: [
                    {
                        type: 'observe', target: 'c1',
                        msg: '指针表无电容档 → 容量读壳体印字（100 μF）',
                        async act() { await _sleep(2000); },
                    },
                ],
                check() { return true; },
            },
            {
                msg: '6. 测量电容，在电容旁填入容量',
                mode: 'fill',
                target: 'c1',
                fields: [
                    { label: '容量', unit: 'uF', answer: 100, tolerance: 0.05, placeholder: '请输入容量' },
                ],
            },
            {
                msg: '7. 换 ×100 档并重新调零，黑笔接 A、红笔接 K 测 D1。',
                mode: 'check',
                op: [
                    {
                        type: 'knob', target: 'mf47-panel', part: 'range-OHM100',
                        msg: '旋钮换到 ×100 档（换档后零点漂移）',
                        async act() { _clearWires(_sysOf(this)); _mf47Set(this, 'OHM100'); await _sleep(900); },
                    },
                    {
                        type: 'observe', target: 'mf47-panel',
                        ports: ['mf47-panel_wire_v', 'mf47-panel_wire_COM'],
                        msg: '两表笔短接，重新调零',
                        async act() {
                            const sys = _sysOf(this);
                            await _wire(sys, 'mf47-panel_wire_v', 'mf47-panel_wire_COM');
                            _mf47Zero(this);
                            await _sleep(1400);
                        },
                    },
                    {
                        type: 'observe', target: 'mf47-panel',
                        ports: ['mf47-panel_wire_COM', 'd1_wire_l'],
                        msg: '黑表笔接 A（无环端）',
                        async act() { _clearWires(_sysOf(this)); await _wire(_sysOf(this), 'mf47-panel_wire_COM', 'd1_wire_l'); },
                    },
                    {
                        type: 'observe', target: 'mf47-panel',
                        ports: ['mf47-panel_wire_v', 'd1_wire_r'],
                        msg: '红表笔接 K（有环端），正向约 1.6 kΩ',
                        async act() { await _wire(_sysOf(this), 'mf47-panel_wire_v', 'd1_wire_r'); await _sleep(2200); },
                    },
                    {
                        type: 'observe', target: 'mf47-panel', part: 'dial',
                        msg: '表笔对调则指针不动（∞），说明单向导电',
                        async act() {
                            const sys = _sysOf(this);
                            _clearWires(sys);
                            await _wire(sys, 'mf47-panel_wire_COM', 'd1_wire_r');
                            await _wire(sys, 'mf47-panel_wire_v', 'd1_wire_l');
                            await _sleep(1600);
                        },
                    },
                ],
                check() {
                    const sys = _sysOf(this);
                    const mf = _comp(sys, 'mf47-panel');
                    return !!(mf && mf._rangeId === 'OHM100')
                        && (mf._ohmZeroAdjust >= 0.9)
                        && (_wired(sys, 'mf47-panel_wire_v', 'd1_wire_l')
                            || _wired(sys, 'mf47-panel_wire_v', 'd1_wire_r'));
                },
            },
            {
                msg: '8. 测量二极管，填入正向电阻和引脚顺序',
                mode: 'fill',
                target: 'd1',
                fields: [
                    { label: '正向电阻', unit: 'Ω', answer: 1656, tolerance: 0.05, placeholder: '请输入正向电阻' },
                    { label: '引脚顺序', answer: 'AK', placeholder: '如 AK或KA' },
                ],
            },
            {
                msg: '9. 黑笔接 B、红笔依次接 C、E，反接均为 ∞。',
                mode: 'check',
                op: [
                    {
                        type: 'observe', target: 'mf47-panel',
                        ports: ['mf47-panel_wire_COM', 't1_wire_b'],
                        msg: '收表笔；黑表笔接基极 B',
                        async act() { _clearWires(_sysOf(this)); await _wire(_sysOf(this), 'mf47-panel_wire_COM', 't1_wire_b'); },
                    },
                    {
                        type: 'observe', target: 'mf47-panel',
                        ports: ['mf47-panel_wire_v', 't1_wire_c'],
                        msg: '红表笔接 C，约 1.4 kΩ',
                        async act() { await _wire(_sysOf(this), 'mf47-panel_wire_v', 't1_wire_c'); await _sleep(1800); },
                    },
                    {
                        type: 'observe', target: 'mf47-panel',
                        ports: ['mf47-panel_wire_v', 't1_wire_e'],
                        msg: '红表笔改接 E，约 1.75 kΩ',
                        async act() {
                            const sys = _sysOf(this);
                            _clearWires(sys);
                            await _wire(sys, 'mf47-panel_wire_COM', 't1_wire_b');
                            await _wire(sys, 'mf47-panel_wire_v', 't1_wire_e');
                            await _sleep(1800);
                        },
                    },
                    {
                        type: 'observe', target: 'mf47-panel', part: 'dial',
                        msg: '表笔对调指针不动 → B 为公共端，NPN 管',
                        async act() {
                            const sys = _sysOf(this);
                            _clearWires(sys);
                            await _wire(sys, 'mf47-panel_wire_COM', 't1_wire_c');
                            await _wire(sys, 'mf47-panel_wire_v', 't1_wire_b');
                            await _sleep(1600);
                        },
                    },
                ],
                check() {
                    const sys = _sysOf(this);
                    const mf = _comp(sys, 'mf47-panel');
                    const comB = _wired(sys, 'mf47-panel_wire_COM', 't1_wire_b');
                    const comAny = comB
                        || _wired(sys, 'mf47-panel_wire_COM', 't1_wire_c')
                        || _wired(sys, 'mf47-panel_wire_COM', 't1_wire_e');
                    return !!(mf && mf._rangeId === 'OHM100') && comAny;
                },
            },
            {
                msg: '10. 检测三极管，填入类型和引脚顺序',
                mode: 'fill',
                target: 't1',
                fields: [
                    { label: '类型', answer: 'NPN', placeholder: '如 NPN或PNP' },
                    { label: '引脚顺序', answer: 'EBC', placeholder: '如 EBC或CBE' },
                ],
            },
            {
                msg: '11. 换 ×10 档并调零，黑笔接 G、红笔接 K 约 500Ω。',
                mode: 'check',
                op: [
                    {
                        type: 'knob', target: 'mf47-panel', part: 'range-OHM10',
                        msg: '旋钮换到 ×10 档',
                        async act() { _clearWires(_sysOf(this)); _mf47Set(this, 'OHM10'); await _sleep(900); },
                    },
                    {
                        type: 'observe', target: 'mf47-panel',
                        ports: ['mf47-panel_wire_v', 'mf47-panel_wire_COM'],
                        msg: '两表笔短接，重新调零',
                        async act() {
                            const sys = _sysOf(this);
                            await _wire(sys, 'mf47-panel_wire_v', 'mf47-panel_wire_COM');
                            _mf47Zero(this);
                            await _sleep(1400);
                        },
                    },
                    {
                        type: 'observe', target: 'mf47-panel',
                        ports: ['mf47-panel_wire_COM', 'scr1_wire_g'],
                        msg: '黑表笔接门极 G',
                        async act() { _clearWires(_sysOf(this)); await _wire(_sysOf(this), 'mf47-panel_wire_COM', 'scr1_wire_g'); },
                    },
                    {
                        type: 'observe', target: 'mf47-panel',
                        ports: ['mf47-panel_wire_v', 'scr1_wire_k'],
                        msg: '红表笔接阴极 K，G–K 正向约 500 Ω',
                        async act() { await _wire(_sysOf(this), 'mf47-panel_wire_v', 'scr1_wire_k'); await _sleep(2200); },
                    },
                ],
                check() {
                    const sys = _sysOf(this);
                    const mf = _comp(sys, 'mf47-panel');
                    return !!(mf && mf._rangeId === 'OHM10')
                        && _wired(sys, 'mf47-panel_wire_COM', 'scr1_wire_g')
                        && _wired(sys, 'mf47-panel_wire_v', 'scr1_wire_k');
                },
            },
            {
                msg: '12. 检测晶闸管，填入引脚顺序',
                mode: 'fill',
                target: 'scr1',
                fields: [
                    { label: '引脚顺序', answer: 'AGK', placeholder: '按上左右的顺序' },
                    { label: 'GK间电阻', unit: 'Ω', answer: 500, tolerance: 0.1, placeholder: '请输入GK间正向电阻' },
                ],
            },
            {
                msg: '13. 测试题：晶闸管的特征和用途',
                mode: 'quiz',
                quizConfig: {
                    question: '关于晶闸管的特征和用途，下列说法正确的是？',
                    options: [
                        '晶闸管具有单向导电性，门极触发导通后撤去触发信号仍能维持导通',
                        '晶闸管是双向导通器件，可像三极管一样对电流进行连续放大',
                        '晶闸管的门极用于连续调节流过主电路的电流大小',
                        '晶闸管只能工作在直流电路中，不能用于交流电路',
                    ],
                    answer: 0,
                    analysis: '晶闸管（可控硅）具有单向导电性，导通由门极触发控制：' +
                        '门极注入触发电流后晶闸管导通，只要阳极电流大于维持电流，撤去触发信号仍能维持导通（自锁特性）。' +
                        '常用于可控整流、交流调压、无触点开关等场合。',
                },
            },
        ],
    },
};

export const componentConfigs = [
    // ── 左侧：真实元器件，按五边形对称分布（圆心 330,430，半径 260），保持原始尺寸 ──
    // 电阻/电容/二极管保持原样不旋转（RealResistor 内部自带 90° 旋转）；三极管、晶闸管向右旋转 90°
    { Class: RealResistor, id: 'r1', x: 330, y: 160, value: 1000, rotation: -90, visible: true, testFlag: true },
    { Class: RealCapacitor, id: 'c1', x: 555, y: 345, capacitance: 100e-6, rotation: 0, visible: true, testFlag: true },
    { Class: RealDiode, id: 'd1', x: 470, y: 665, vForward: 0.68, rotation: 0, visible: true, testFlag: true },
    { Class: RealTransistor, id: 't1', x: 180, y: 665, subType: 'NPN', beta: 100, rotation: 90, visible: true, testFlag: true },
    { Class: RealScr, id: 'scr1', x: 85, y: 345, rotation: 90, visible: true, testFlag: true },

    // ── 中部：电子元器件面板（800×720，3 行 2 列实物图片；缩至 0.72 让出右侧仪表区）──
    { Class: ElectronicsPanel, id: 'el-panel', x: 620, y: 60, scale: 1, visible: true },

    // ── 7 种保留仪表（默认隐藏，可从"选择仪表"中调出）──
    // 统一停靠在识别面板右侧（约 1200~1550 设计区）：既不被识别面板遮挡，
    // 也不被右侧「操作流程」面板（≥1560）遮挡，保证自动演示时仪表、表笔、读数全程可见。
    { Class: Multimeter, id: 'multimeter', x: 1220, y: 30, visible: false },
    { Class: MF47Multimeter, id: 'mf47-panel', x: 1210, y: 30, visible: false },
    { Class: RealMegohmMeter, id: 'megohm', x: 1230, y: 520, visible: false },
    { Class: ElecMeter, id: 'elecmeter', x: 1350, y: 830, visible: false },
    { Class: Oscilloscope_tri, id: 'osc', x: 1120, y: 600, visible: false },
    { Class: SignalGenerator, id: 'sg', x: 1080, y: 620, visible: false },
    { Class: ProcessCalibrator, id: 'cali', x: 1200, y: 300, visible: false },
];

export function initSlider(_sys) { }

export function applyAllPresets() { }

export async function applyStartSystem() { }

export function fiveStep() { }
