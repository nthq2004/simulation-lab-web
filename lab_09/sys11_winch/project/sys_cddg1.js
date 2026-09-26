// 电子元器件识别与测试仿真工程

import { RealResistor } from '../components/RealResistor.js';
import { RealCapacitor } from '../components/RealCapacitor.js';
import { RealInductor } from '../components/RealInductor.js';
import { RealDiode } from '../components/RealDiode.js';
import { RealTransistor } from '../components/RealTransistor.js';
import { RealScr } from '../components/RealScr.js';
import { RealIGBT } from '../components/RealIGBT.js';
import { RealMegohmMeter } from '../components/RealMegohmMeter.js';
import { Resistor } from '../components/Resistor.js';
import { Capacitor } from '../components/Capacitor.js';
import { Inductor } from '../components/Inductor.js';
import { Diode } from '../components/Diode.js';
import { Transistor } from '../components/Transistor.js';
import { SCR } from '../components/Scr.js';
import { IGBT } from '../components/IGBT.js';
import { Multimeter } from '../components/Multimeter.js';
import { MF47Multimeter } from '../components/MF47Multimeter.js';
import { Oscilloscope_tri } from '../components/Osc_tri.js';
import { SignalGenerator } from '../components/SignalGenerator.js';
import { ProcessCalibrator } from '../components/ProcessCalibrator.js';
import { ElecMeter } from '../components/ElecMeter.js';
import { DCPower } from '../components/DCPower.js';
import { Ground } from '../components/Gnd.js';

export const FAULT_CONFIGS = {
};

export const PROJECT_WORKFLOWS = {
    'resistor-identify-measure': {
        id: 'resistor-identify-measure',
        name: '1. 识别电阻并测量',
        steps: [
            {
                msg: '1. 识别电阻的电路符号：点击右侧的电阻符号（矩形框，电路原理图中使用的符号）',
                mode: 'find',
                target: 'r2',
            },
            {
                msg: '2. 识别色环电阻：点击左侧的色环电阻实物（带色环的圆柱形电阻）',
                mode: 'find',
                target: 'r1',
            },
            {
                msg: '3. 调出模拟万用表：在工具栏"选择仪表"中勾选"指针万用表（MF47）"',
                mode: 'check',
                op: [{ type: 'instrument', instrument: 'mf47' }],
                act() {
                    const sys = this.sys;
                    if (sys.toggleInstrumentVisibility) sys.toggleInstrumentVisibility('mf47-panel', true);
                    if (sys.redrawAll) sys.redrawAll();
                },
                check() {
                    const mm = this.sys.comps['mf47-panel'];
                    return !!(mm && mm.group && mm.group.visible());
                },
            },
            {
                msg: '4. 将 MF47 旋至 R×100 档，短接 VΩ 端与 COM 端进行欧姆调零，调零后断开短接线',
                mode: 'check',
                op: [
                    {
                        type: 'knob', target: 'mf47-panel', part: 'range-OHM100',
                        msg: '将 MF47 量程旋钮旋至 R×100 档',
                        act() {
                            const mm = this.sys.comps['mf47-panel'];
                            if (mm) { mm.setRange('OHM100'); }
                        },
                    },
                    {
                        type: 'observe', target: 'mf47-panel', part: 'v',
                        msg: '短接 VΩ 端与 COM 端（两表笔相碰）',
                        async act() { await _shortVCOM(this.sys); },
                    },
                    {
                        type: 'knob', target: 'mf47-panel', part: 'ohm-zero',
                        msg: '旋转欧姆调零旋钮，使指针指到 Ω 刻度的 0 位',
                        act() {
                            const mm = this.sys.comps['mf47-panel'];
                            if (mm) { mm._ohmZeroAdjust = 1; mm.config.ohmZeroAdjust = 1; mm.markDirty(); }
                        },
                    },
                    {
                        type: 'observe', target: 'mf47-panel', part: 'v',
                        msg: '调零完成，断开 VΩ 端与 COM 端的短接线',
                        act() { _openVCOMShort(this.sys); },
                    },
                ],
                check() {
                    const sys = this.sys;
                    const mm = sys.comps['mf47-panel'];
                    return !!(mm && mm._rangeId === 'OHM100' && mm._ohmZeroAdjust >= 0.99)
                        && !_sameCluster(sys, 'mf47-panel_wire_v', 'mf47-panel_wire_COM');
                },
            },
            {
                msg: '5. 将红黑表笔分别接到色环电阻两端，观察指针偏转并读取阻值',
                mode: 'check',
                op: [
                    {
                        type: 'observe', target: 'r1',
                        msg: '红表笔（VΩ）接色环电阻一端，黑表笔（COM）接另一端',
                        async act() { await _probeDev(this.sys, 'r1'); },
                    },
                    {
                        type: 'observe', target: 'mf47-panel', part: 'dial',
                        msg: '观察指针偏转，按 Ω 刻度读取阻值',
                    },
                ],
                check() { return _mf47Across(this.sys, 'r1'); },
            },
            {
                msg: '6. 根据指针读数，填入色环电阻的测量阻值（单位 Ω）',
                mode: 'fill',
                target: 'r1',
                ready() { return _mf47Across(this.sys, 'r1'); },
                fields: [
                    { label: '色环电阻', unit: 'Ω', answer: 1000, tolerance: 0.05, placeholder: '读取 Ω 刻度后输入，如 1000' },
                ],
            },
        ],
    },

    'cap-inductor-identify-measure': {
        id: 'cap-inductor-identify-measure',
        name: '2. 识别电容和电感并测量',
        steps: [
            {
                msg: '1. 识别电容的电路符号：点击右侧的电容符号（两条平行短线的图形符号）',
                mode: 'find',
                target: 'c2',
            },
            {
                msg: '2. 识别电感的电路符号：点击右侧的电感符号（连续半圆线圈的图形符号）',
                mode: 'find',
                target: 'l2',
            },
            {
                msg: '3. 调出模拟万用表：在工具栏"选择仪表"中勾选"指针万用表（MF47）"',
                mode: 'check',
                op: [{ type: 'instrument', instrument: 'mf47' }],
                act() {
                    const sys = this.sys;
                    if (sys.toggleInstrumentVisibility) sys.toggleInstrumentVisibility('mf47-panel', true);
                    if (sys.redrawAll) sys.redrawAll();
                },
                check() {
                    const mm = this.sys.comps['mf47-panel'];
                    return !!(mm && mm.group && mm.group.visible());
                },
            },
            {
                msg: '4. 将 MF47 旋至 R×10 档，短接 VΩ 端与 COM 端进行欧姆调零，调零后断开短接线',
                mode: 'check',
                op: [
                    {
                        type: 'knob', target: 'mf47-panel', part: 'range-OHM10',
                        msg: '将 MF47 量程旋钮旋至 R×10 档',
                        act() {
                            const mm = this.sys.comps['mf47-panel'];
                            if (mm) { mm.setRange('OHM10'); }
                        },
                    },
                    {
                        type: 'observe', target: 'mf47-panel', part: 'v',
                        msg: '短接 VΩ 端与 COM 端（两表笔相碰）',
                        async act() { await _shortVCOM(this.sys); },
                    },
                    {
                        type: 'knob', target: 'mf47-panel', part: 'ohm-zero',
                        msg: '旋转欧姆调零旋钮，使指针指到 Ω 刻度的 0 位',
                        act() {
                            const mm = this.sys.comps['mf47-panel'];
                            if (mm) { mm._ohmZeroAdjust = 1; mm.config.ohmZeroAdjust = 1; mm.markDirty(); }
                        },
                    },
                    {
                        type: 'observe', target: 'mf47-panel', part: 'v',
                        msg: '调零完成，断开 VΩ 端与 COM 端的短接线',
                        act() { _openVCOMShort(this.sys); },
                    },
                ],
                check() {
                    const sys = this.sys;
                    const mm = sys.comps['mf47-panel'];
                    return !!(mm && mm._rangeId === 'OHM10' && mm._ohmZeroAdjust >= 0.99)
                        && !_sameCluster(sys, 'mf47-panel_wire_v', 'mf47-panel_wire_COM');
                },
            },
            {
                msg: '5. 用电阻档测量电容：表笔接电容两端，观察指针先偏转后逐渐回到 ∞，随后断开电容接线',
                mode: 'check',
                op: [
                    {
                        type: 'observe', target: 'c1',
                        msg: '红黑表笔分别接电容两端',
                        async act() { await _probeDev(this.sys, 'c1'); },
                    },
                    {
                        type: 'observe', target: 'mf47-panel', part: 'dial',
                        msg: '观察指针：先向右偏转（充电电流），随后逐渐回到 ∞（绝缘电阻很大，电容正常）',
                        async act() { await _sleep(6000); },
                    },
                    {
                        type: 'observe', target: 'c1',
                        msg: '测量完成，断开电容表笔接线',
                        act() { _disconnectMF47(this.sys); },
                    },
                ],
                check() {
                    const sys = this.sys;
                    const mm = sys.comps['mf47-panel'];
                    return !!(mm && mm._rangeId === 'OHM10' && _mf47Across(sys, 'c1') && mm._inputValue > 1e4);
                },
            },
            {
                msg: '6. 用电阻档测量电感：表笔接电感两端，观察指针稳定后的读数（即线圈的直流等效电阻，约 10Ω）',
                mode: 'check',
                op: [
                    {
                        type: 'observe', target: 'l1',
                        msg: '红黑表笔分别接电感（线圈）两端',
                        async act() { await _probeDev(this.sys, 'l1'); },
                    },
                    {
                        type: 'observe', target: 'mf47-panel', part: 'dial',
                        msg: '观察指针：稳定后读数即为线圈的直流等效电阻（约 10Ω）',
                        async act() { await _sleep(4000); },
                    },
                ],
                check() {
                    const sys = this.sys;
                    const mm = sys.comps['mf47-panel'];
                    return !!(mm && mm._rangeId === 'OHM10' && _mf47Across(sys, 'l1')
                        && mm._inputValue > 1 && mm._inputValue < 100);
                },
            },
            {
                msg: '7. 测试题：用模拟万用表测量电容',
                mode: 'quiz',
                quizConfig: {
                    question: '用指针万用表（MF47）电阻档测量一个完好的电容时，指针的变化是？',
                    options: [
                        '指针先向右偏转（阻值小，充电电流大），随后逐渐向左回到 ∞（阻值变大）',
                        '指针始终指向 ∞ 不动',
                        '指针始终指向 0Ω 不动',
                        '指针在 0 与 ∞ 之间有规律地来回摆动',
                    ],
                    answer: 0,
                    analysis: '电阻档内电池经表内电阻给电容充电：开始充电电流最大，指针偏转（电阻小）；随着电容充满，充电电流趋于 0，指针逐渐回到 ∞（绝缘电阻很大）。指针能回到 ∞ 说明电容不漏电、性能良好。',
                },
            },
            {
                msg: '8. 测试题：用模拟万用表测量电感',
                mode: 'quiz',
                quizConfig: {
                    question: '用指针万用表电阻档测量电感（线圈）时，指针稳定后的读数反映的是？',
                    options: [
                        '线圈的直流等效电阻（通常很小，几欧到几十欧）',
                        '线圈的感抗（随交流频率变化的阻抗）',
                        '始终为无穷大（无读数）',
                        '始终为 0Ω（正好指在 0 位）',
                    ],
                    answer: 0,
                    analysis: '电阻档用直流测试，电感对直流相当于一根导线，指针稳定后的读数就是线圈的直流等效电阻（由漆包线的电阻决定），一般很小；感抗只在交流下才体现。',
                },
            },
        ],
    },

    'diode-identify-polarity': {
        id: 'diode-identify-polarity',
        name: '3. 识别二极管并判别极性',
        steps: [
            {
                msg: '1. 识别二极管的电路符号：点击右侧的二极管符号（三角形加竖线，竖线一侧为阴极）',
                mode: 'find',
                target: 'd2',
            },
            {
                msg: '2. 识别二极管的实物：点击左侧的二极管实物（黑色圆柱体，带白色阴极色环）',
                mode: 'find',
                target: 'd1',
            },
            {
                msg: '3. 调出模拟万用表：在工具栏"选择仪表"中勾选"指针万用表（MF47）"',
                mode: 'check',
                op: [{ type: 'instrument', instrument: 'mf47' }],
                act() {
                    const sys = this.sys;
                    if (sys.toggleInstrumentVisibility) sys.toggleInstrumentVisibility('mf47-panel', true);
                    if (sys.redrawAll) sys.redrawAll();
                },
                check() {
                    const mm = this.sys.comps['mf47-panel'];
                    return !!(mm && mm.group && mm.group.visible());
                },
            },
            {
                msg: '4. 将 MF47 旋至 R×100 档，短接 VΩ 端与 COM 端进行欧姆调零，调零后断开短接线',
                mode: 'check',
                op: [
                    {
                        type: 'knob', target: 'mf47-panel', part: 'range-OHM100',
                        msg: '将 MF47 量程旋钮旋至 R×100 档',
                        act() {
                            const mm = this.sys.comps['mf47-panel'];
                            if (mm) { mm.setRange('OHM100'); }
                        },
                    },
                    {
                        type: 'observe', target: 'mf47-panel', part: 'v',
                        msg: '短接 VΩ 端与 COM 端（两表笔相碰）',
                        async act() { await _shortVCOM(this.sys); },
                    },
                    {
                        type: 'knob', target: 'mf47-panel', part: 'ohm-zero',
                        msg: '旋转欧姆调零旋钮，使指针指到 Ω 刻度的 0 位',
                        act() {
                            const mm = this.sys.comps['mf47-panel'];
                            if (mm) { mm._ohmZeroAdjust = 1; mm.config.ohmZeroAdjust = 1; mm.markDirty(); }
                        },
                    },
                    {
                        type: 'observe', target: 'mf47-panel', part: 'v',
                        msg: '调零完成，断开 VΩ 端与 COM 端的短接线',
                        act() { _openVCOMShort(this.sys); },
                    },
                ],
                check() {
                    const sys = this.sys;
                    const mm = sys.comps['mf47-panel'];
                    return !!(mm && mm._rangeId === 'OHM100' && mm._ohmZeroAdjust >= 0.99)
                        && !_sameCluster(sys, 'mf47-panel_wire_v', 'mf47-panel_wire_COM');
                },
            },
            {
                msg: '5. 第一次测量：红表笔（VΩ）接二极管左端、黑表笔（COM）接右端，观察指针读数',
                mode: 'check',
                op: [
                    {
                        type: 'observe', target: 'd1',
                        msg: '红表笔（VΩ）接二极管左端，黑表笔（COM）接右端',
                        async act() { await _probeDev(this.sys, 'd1', false); },
                    },
                    {
                        type: 'observe', target: 'mf47-panel', part: 'dial',
                        msg: '观察指针：阻值很大（接近 ∞）',
                        async act() { await _sleep(2500); },
                    },
                ],
                check() {
                    const sys = this.sys;
                    const mm = sys.comps['mf47-panel'];
                    return !!(mm && mm._rangeId === 'OHM100' && _mf47Across(sys, 'd1', false));
                },
            },
            {
                msg: '6. 根据指针读数，填入本次测量的电阻值（阻值很大/∞）',
                mode: 'fill',
                target: 'd1',
                ready() { return _mf47Across(this.sys, 'd1', false); },
                fields: [
                    { label: '反向电阻', unit: 'Ω', answer: ['∞', '无穷大', '开路', '很大'], placeholder: '很大，可填 ∞ 或 无穷大' },
                ],
            },
            {
                msg: '7. 断开表笔后反接测量：红表笔（VΩ）接二极管右端、黑表笔（COM）接左端，观察指针读数',
                mode: 'check',
                op: [
                    {
                        type: 'observe', target: 'd1',
                        msg: '断开原接线并反接：红表笔（VΩ）接右端，黑表笔（COM）接左端',
                        async act() { await _probeDev(this.sys, 'd1', true); },
                    },
                    {
                        type: 'observe', target: 'mf47-panel', part: 'dial',
                        msg: '观察指针：阻值较小（正向导通）',
                        async act() { await _sleep(2500); },
                    },
                ],
                check() {
                    const sys = this.sys;
                    const mm = sys.comps['mf47-panel'];
                    return !!(mm && mm._rangeId === 'OHM100' && _mf47Across(sys, 'd1', true));
                },
            },
            {
                msg: '8. 根据指针读数，填入本次测量的正向电阻值（单位 Ω）',
                mode: 'fill',
                target: 'd1',
                ready() { return _mf47Across(this.sys, 'd1', true); },
                fields: [
                    { label: '正向电阻', unit: 'Ω', answer: 1659, tolerance: 0.15, placeholder: '读取 Ω 刻度后输入，如 1659' },
                ],
            },
            {
                msg: '9. 测量完成，断开二极管的表笔接线',
                mode: 'check',
                op: [
                    {
                        type: 'observe', target: 'd1',
                        msg: '断开 MF47 表笔接线',
                        act() { _disconnectMF47(this.sys); },
                    },
                ],
                check() {
                    return !_mf47Across(this.sys, 'd1', false) && !_mf47Across(this.sys, 'd1', true);
                },
            },
            {
                msg: '10. 填空题：二极管的正极（阳极）是＿＿端（填"左端"或"右端"）',
                mode: 'fill',
                target: 'd1',
                fields: [
                    { label: '正极位置', unit: '', answer: ['左端', '左'], placeholder: '填 左端 或 右端' },
                ],
            },
            {
                msg: '11. 测试题：二极管判断极性的方法',
                mode: 'quiz',
                quizConfig: {
                    question: '用指针万用表电阻档判别二极管极性，下列做法正确的是？',
                    options: [
                        '测得阻值小（正向导通）的一次，黑表笔（COM）所接的一端是二极管正极',
                        '测得阻值小的一次，红表笔（VΩ）所接的一端是二极管正极',
                        '两次测量阻值都很大，说明二极管性能良好',
                        '两次测量阻值都很小，说明二极管是好的',
                    ],
                    answer: 0,
                    analysis: '指针表电阻档的黑表笔（COM）接表内电池正极。当测得阻值小（正向导通）时，黑表笔所接的一端为二极管正极（阳极），红表笔所接的一端为负极（阴极）；反接时阻值很大（反向截止）。',
                },
            },
            {
                msg: '12. 调出数字万用表：在工具栏"选择仪表"中勾选"数字万用表"，同时取消勾选"指针万用表（MF47）"',
                mode: 'check',
                op: [{ type: 'instrument', instrument: 'multimeter', uncheck: 'mf47' }],
                act() {
                    const sys = this.sys;
                    if (sys.toggleInstrumentVisibility) {
                        sys.toggleInstrumentVisibility('multimeter', true);
                        sys.toggleInstrumentVisibility('mf47-panel', false);
                    }
                    if (sys.redrawAll) sys.redrawAll();
                },
                check() {
                    const sys = this.sys;
                    const dmm = sys.comps['multimeter'];
                    const mf = sys.comps['mf47-panel'];
                    return !!(dmm && dmm.group && dmm.group.visible())
                        && !(mf && mf.group && mf.group.visible());
                },
            },
            {
                msg: '13. 数字万用表旋至二极管档，红表笔接二极管正极（左端）、黑表笔接负极（右端），验证正向导通',
                mode: 'check',
                op: [
                    {
                        type: 'knob', target: 'multimeter', part: 'knob',
                        msg: '将数字万用表旋至二极管档',
                        act() {
                            const mm = this.sys.comps['multimeter'];
                            if (mm) { mm.mode = 'DIODE'; if (mm._updateAngleByMode) mm._updateAngleByMode(); }
                            if (this.sys.redrawAll) this.sys.redrawAll();
                        },
                    },
                    {
                        type: 'observe', target: 'd1',
                        msg: '红表笔接正极（左端），黑表笔接负极（右端）',
                        async act() { await _probeDMM(this.sys, 'd1', false); },
                    },
                    {
                        type: 'observe', target: 'multimeter', part: 'lcd',
                        msg: '观察显示：约 0.68V，说明二极管正向导通',
                        async act() { await _sleep(2000); },
                    },
                ],
                check() {
                    const sys = this.sys;
                    const mm = sys.comps['multimeter'];
                    return !!(mm && mm.mode === 'DIODE' && _dmmAcross(sys, 'd1', false));
                },
            },
            {
                msg: '14. 根据数字万用表显示，填入二极管的正向导通压降（单位 V）',
                mode: 'fill',
                target: 'd1',
                ready() {
                    const mm = this.sys.comps['multimeter'];
                    return !!(mm && typeof mm.value === 'number' && mm.value > 0.3 && mm.value < 3)
                        && _dmmAcross(this.sys, 'd1', false);
                },
                fields: [
                    { label: '正向导通压降', unit: 'V', answer: 0.68, tolerance: 0.05, placeholder: '读取显示屏，如 0.68' },
                ],
            },
        ],
    },

    'bjt-identify-polarity': {
        id: 'bjt-identify-polarity',
        name: '4. 识别三极管并判别极性',
        steps: [
            {
                msg: '1. 识别三极管的电路符号：点击右侧的三极管符号（带基极竖线的图形符号）',
                mode: 'find',
                target: 't2',
            },
            {
                msg: '2. 识别三极管的实物：点击左侧的三极管实物（TO-92 黑色封装，三根引脚）',
                mode: 'find',
                target: 't1',
            },
            {
                msg: '3. 调出模拟万用表：在工具栏"选择仪表"中勾选"指针万用表（MF47）"',
                mode: 'check',
                op: [{ type: 'instrument', instrument: 'mf47' }],
                act() {
                    const sys = this.sys;
                    if (sys.toggleInstrumentVisibility) sys.toggleInstrumentVisibility('mf47-panel', true);
                    if (sys.redrawAll) sys.redrawAll();
                },
                check() {
                    const mm = this.sys.comps['mf47-panel'];
                    return !!(mm && mm.group && mm.group.visible());
                },
            },
            {
                msg: '4. 将 MF47 旋至 R×100 档，短接 VΩ 端与 COM 端进行欧姆调零，调零后断开短接线',
                mode: 'check',
                op: [
                    {
                        type: 'knob', target: 'mf47-panel', part: 'range-OHM100',
                        msg: '将 MF47 量程旋钮旋至 R×100 档',
                        act() {
                            const mm = this.sys.comps['mf47-panel'];
                            if (mm) { mm.setRange('OHM100'); }
                        },
                    },
                    {
                        type: 'observe', target: 'mf47-panel', part: 'v',
                        msg: '短接 VΩ 端与 COM 端（两表笔相碰）',
                        async act() { await _shortVCOM(this.sys); },
                    },
                    {
                        type: 'knob', target: 'mf47-panel', part: 'ohm-zero',
                        msg: '旋转欧姆调零旋钮，使指针指到 Ω 刻度的 0 位',
                        act() {
                            const mm = this.sys.comps['mf47-panel'];
                            if (mm) { mm._ohmZeroAdjust = 1; mm.config.ohmZeroAdjust = 1; mm.markDirty(); }
                        },
                    },
                    {
                        type: 'observe', target: 'mf47-panel', part: 'v',
                        msg: '调零完成，断开 VΩ 端与 COM 端的短接线',
                        act() { _openVCOMShort(this.sys); },
                    },
                ],
                check() {
                    const sys = this.sys;
                    const mm = sys.comps['mf47-panel'];
                    return !!(mm && mm._rangeId === 'OHM100' && mm._ohmZeroAdjust >= 0.99)
                        && !_sameCluster(sys, 'mf47-panel_wire_v', 'mf47-panel_wire_COM');
                },
            },
            {
                msg: '5. 测量中端与左端之间的 PN 结：红表笔（VΩ）接左端、黑表笔（COM）接中端，读取电阻值',
                mode: 'check',
                op: [
                    {
                        type: 'observe', target: 't1',
                        msg: '红表笔（VΩ）接左端，黑表笔（COM）接中端',
                        async act() {
                            await _wireMF47(this.sys, [
                                ['mf47-panel_wire_v', 't1_wire_e'],
                                ['mf47-panel_wire_COM', 't1_wire_b'],
                            ], 't1');
                        },
                    },
                    {
                        type: 'observe', target: 'mf47-panel', part: 'dial',
                        msg: '观察指针：阻值较小（该 PN 结正向导通）',
                        async act() { await _sleep(2500); },
                    },
                ],
                check() {
                    const sys = this.sys;
                    const mm = sys.comps['mf47-panel'];
                    return !!(mm && mm._rangeId === 'OHM100'
                        && _joined(sys, [['mf47-panel_wire_v', 't1_wire_e'], ['mf47-panel_wire_COM', 't1_wire_b']])
                        && mm._inputValue > 500 && mm._inputValue < 5000);
                },
            },
            {
                msg: '6. 填入本次测量的电阻值（左端—中端之间的正向电阻，单位 Ω）',
                mode: 'fill',
                target: 't1',
                ready() { return _joined(this.sys, [['mf47-panel_wire_v', 't1_wire_e'], ['mf47-panel_wire_COM', 't1_wire_b']]); },
                fields: [
                    { label: '左-中电阻', unit: 'Ω', answer: 1751, tolerance: 0.15, placeholder: '读取 Ω 刻度后输入，如 1751' },
                ],
            },
            {
                msg: '7. 测量中端与右端之间的 PN 结：红表笔（VΩ）接右端、黑表笔（COM）接中端，读取电阻值',
                mode: 'check',
                op: [
                    {
                        type: 'observe', target: 't1',
                        msg: '断开原接线，红表笔（VΩ）接右端，黑表笔（COM）接中端',
                        async act() {
                            await _wireMF47(this.sys, [
                                ['mf47-panel_wire_v', 't1_wire_c'],
                                ['mf47-panel_wire_COM', 't1_wire_b'],
                            ], 't1');
                        },
                    },
                    {
                        type: 'observe', target: 'mf47-panel', part: 'dial',
                        msg: '观察指针：阻值较小（该 PN 结正向导通）',
                        async act() { await _sleep(2500); },
                    },
                ],
                check() {
                    const sys = this.sys;
                    const mm = sys.comps['mf47-panel'];
                    return !!(mm && mm._rangeId === 'OHM100'
                        && _joined(sys, [['mf47-panel_wire_v', 't1_wire_c'], ['mf47-panel_wire_COM', 't1_wire_b']])
                        && mm._inputValue > 500 && mm._inputValue < 5000);
                },
            },
            {
                msg: '8. 填入本次测量的电阻值（右端—中端之间的正向电阻，单位 Ω）',
                mode: 'fill',
                target: 't1',
                ready() { return _joined(this.sys, [['mf47-panel_wire_v', 't1_wire_c'], ['mf47-panel_wire_COM', 't1_wire_b']]); },
                fields: [
                    { label: '右-中电阻', unit: 'Ω', answer: 1410, tolerance: 0.15, placeholder: '读取 Ω 刻度后输入，如 1410' },
                ],
            },
            {
                msg: '9. 填空题：三极管的基极是＿＿；该三极管是＿＿（NPN / PNP）',
                mode: 'fill',
                target: 't1',
                fields: [
                    { label: '基极', unit: '', answer: ['中端', '中'], placeholder: '填 左端/中端/右端' },
                    { label: '类型', unit: '', answer: ['NPN', 'npn'], placeholder: '填 NPN 或 PNP' },
                ],
            },
            {
                msg: '10. 测试题：三极管判断极性的方法',
                mode: 'quiz',
                quizConfig: {
                    question: '用指针万用表判别三极管的基极和类型，下列方法正确的是？',
                    options: [
                        '依次测量各脚间的正反向电阻：与另外两极之间正向阻值都小（两结均导通）的那一脚是基极；黑表笔（COM）接基极时两结均导通，则为 NPN',
                        '与另外两极之间正向阻值都小的那一脚是基极；红表笔接基极时两结均导通，则为 NPN',
                        '任意两脚之间阻值都很小的那一脚就是集电极',
                        '三极管任意两脚之间的正反向电阻都相同',
                    ],
                    answer: 0,
                    analysis: '把万用表拨到电阻档，依次测量各脚之间的正反向电阻。当某脚与另外两脚的正向电阻都很小（相当于两个二极管正向导通，公共端为该 PN 结的 P 端）时，该脚即为基极；黑表笔（表内电池正极）接基极时两结都导通，说明基极为 P 型，管子是 NPN。',
                },
            },
            {
                msg: '11. 判别 C/E（第一次）：黑表笔（COM）接左端、红表笔（VΩ）接右端，并把左端与中端短接，读取电阻值',
                mode: 'check',
                op: [
                    {
                        type: 'observe', target: 't1',
                        msg: '黑表笔（COM）接左端、红表笔（VΩ）接右端；再用导线短接左端与中端',
                        async act() {
                            await _wireMF47(this.sys, [
                                ['mf47-panel_wire_COM', 't1_wire_e'],
                                ['mf47-panel_wire_v', 't1_wire_c'],
                                ['t1_wire_e', 't1_wire_b'],
                            ], 't1');
                        },
                    },
                    {
                        type: 'observe', target: 'mf47-panel', part: 'dial',
                        msg: '观察指针：偏转较小（阻值较大）',
                        async act() { await _sleep(2500); },
                    },
                    {
                        type: 'observe', target: 't1',
                        msg: '读取电阻值后，断开所有接线',
                        act() { _clearWiring(this.sys, 't1'); },
                    },
                ],
                check() {
                    const sys = this.sys;
                    const mm = sys.comps['mf47-panel'];
                    return !!(mm && mm._rangeId === 'OHM100'
                        && _joined(sys, [['mf47-panel_wire_COM', 't1_wire_e'], ['mf47-panel_wire_v', 't1_wire_c'], ['t1_wire_e', 't1_wire_b']])
                        && mm._inputValue > 3000);
                },
            },
            {
                msg: '12. 填入本次测量的电阻值（单位 Ω）',
                mode: 'fill',
                target: 't1',
                fields: [
                    { label: '电阻值', unit: 'Ω', answer: 8000, tolerance: 0.15, placeholder: '读取 Ω 刻度后输入，如 8000' },
                ],
            },
            {
                msg: '13. 判别 C/E（第二次）：黑表笔（COM）接右端、红表笔（VΩ）接左端，并把右端与中端短接，读取电阻值',
                mode: 'check',
                op: [
                    {
                        type: 'observe', target: 't1',
                        msg: '黑表笔（COM）接右端、红表笔（VΩ）接左端；再用导线短接右端与中端',
                        async act() {
                            await _wireMF47(this.sys, [
                                ['mf47-panel_wire_COM', 't1_wire_c'],
                                ['mf47-panel_wire_v', 't1_wire_e'],
                                ['t1_wire_c', 't1_wire_b'],
                            ], 't1');
                        },
                    },
                    {
                        type: 'observe', target: 'mf47-panel', part: 'dial',
                        msg: '观察指针：偏转较大（阻值较小）',
                        async act() { await _sleep(2500); },
                    },
                ],
                check() {
                    const sys = this.sys;
                    const mm = sys.comps['mf47-panel'];
                    return !!(mm && mm._rangeId === 'OHM100'
                        && _joined(sys, [['mf47-panel_wire_COM', 't1_wire_c'], ['mf47-panel_wire_v', 't1_wire_e'], ['t1_wire_c', 't1_wire_b']])
                        && mm._inputValue < 3000);
                },
            },
            {
                msg: '14. 填入本次测量的电阻值（单位 Ω）',
                mode: 'fill',
                target: 't1',
                ready() { return _joined(this.sys, [['mf47-panel_wire_COM', 't1_wire_c'], ['mf47-panel_wire_v', 't1_wire_e'], ['t1_wire_c', 't1_wire_b']]); },
                fields: [
                    { label: '电阻值', unit: 'Ω', answer: 1077, tolerance: 0.15, placeholder: '读取 Ω 刻度后输入，如 1077' },
                ],
            },
            {
                msg: '15. 填空题：三极管的集电极是＿＿（填"左端"、"中端"或"右端"）',
                mode: 'fill',
                target: 't1',
                fields: [
                    { label: '集电极', unit: '', answer: ['右端', '右'], placeholder: '填 左端/中端/右端' },
                ],
            },
            {
                msg: '16. 判断题：模拟万用表判断集电极的方法',
                mode: 'quiz',
                quizConfig: {
                    question: '判断：判别集电极时，把黑表笔（COM）接基极并与假定的集电极短接，红表笔接另一极；指针偏转较大（阻值较小）的一次，黑表笔所接的一极就是集电极。',
                    options: ['正确', '错误'],
                    answer: 0,
                    analysis: '黑表笔接基极并把基极与某一极短接，相当于给该 PN 结加正偏，红表笔接另一极。偏转较大（阻值小）说明该结正向导通程度大，此时黑表笔所接的是集电极、另一极是发射极。',
                },
            },
        ],
    },

    'scr-identify-pins': {
        id: 'scr-identify-pins',
        name: '5. 识别晶闸管并判别引脚',
        steps: [
            {
                msg: '1. 识别晶闸管的电路符号：点击右侧的晶闸管符号（二极管符号加一根门极引线）',
                mode: 'find',
                target: 'scr2',
            },
            {
                msg: '2. 识别晶闸管的实物：点击左侧的晶闸管实物（带散热片的功率器件，三根引脚）',
                mode: 'find',
                target: 'scr1',
            },
            {
                msg: '3. 调出模拟万用表：在工具栏"选择仪表"中勾选"指针万用表（MF47）"',
                mode: 'check',
                op: [{ type: 'instrument', instrument: 'mf47' }],
                act() {
                    const sys = this.sys;
                    if (sys.toggleInstrumentVisibility) sys.toggleInstrumentVisibility('mf47-panel', true);
                    if (sys.redrawAll) sys.redrawAll();
                },
                check() {
                    const mm = this.sys.comps['mf47-panel'];
                    return !!(mm && mm.group && mm.group.visible());
                },
            },
            {
                msg: '4. 将 MF47 旋至 R×100 档，短接 VΩ 端与 COM 端进行欧姆调零，调零后断开短接线',
                mode: 'check',
                op: [
                    {
                        type: 'knob', target: 'mf47-panel', part: 'range-OHM100',
                        msg: '将 MF47 量程旋钮旋至 R×100 档',
                        act() {
                            const mm = this.sys.comps['mf47-panel'];
                            if (mm) { mm.setRange('OHM100'); }
                        },
                    },
                    {
                        type: 'observe', target: 'mf47-panel', part: 'v',
                        msg: '短接 VΩ 端与 COM 端（两表笔相碰）',
                        async act() { await _shortVCOM(this.sys); },
                    },
                    {
                        type: 'knob', target: 'mf47-panel', part: 'ohm-zero',
                        msg: '旋转欧姆调零旋钮，使指针指到 Ω 刻度的 0 位',
                        act() {
                            const mm = this.sys.comps['mf47-panel'];
                            if (mm) { mm._ohmZeroAdjust = 1; mm.config.ohmZeroAdjust = 1; mm.markDirty(); }
                        },
                    },
                    {
                        type: 'observe', target: 'mf47-panel', part: 'v',
                        msg: '调零完成，断开 VΩ 端与 COM 端的短接线',
                        act() { _openVCOMShort(this.sys); },
                    },
                ],
                check() {
                    const sys = this.sys;
                    const mm = sys.comps['mf47-panel'];
                    return !!(mm && mm._rangeId === 'OHM100' && mm._ohmZeroAdjust >= 0.99)
                        && !_sameCluster(sys, 'mf47-panel_wire_v', 'mf47-panel_wire_COM');
                },
            },
            {
                msg: '5. 测量左端与下端之间的 PN 结：红表笔（VΩ）接左端、黑表笔（COM）接下端，读取电阻值',
                mode: 'check',
                op: [
                    {
                        type: 'observe', target: 'scr1',
                        msg: '红表笔（VΩ）接左端，黑表笔（COM）接下端',
                        async act() {
                            await _wireMF47(this.sys, [
                                ['mf47-panel_wire_v', 'scr1_wire_g'],
                                ['mf47-panel_wire_COM', 'scr1_wire_k'],
                            ], 'scr1');
                        },
                    },
                    {
                        type: 'observe', target: 'mf47-panel', part: 'dial',
                        msg: '观察指针：阻值很大（接近 ∞）',
                        async act() { await _sleep(2500); },
                    },
                    {
                        type: 'observe', target: 'scr1',
                        msg: '读取电阻值后，断开所有接线',
                        act() { _clearWiring(this.sys, 'scr1'); },
                    },
                ],
                check() {
                    const sys = this.sys;
                    const mm = sys.comps['mf47-panel'];
                    return !!(mm && mm._rangeId === 'OHM100'
                        && _joined(sys, [['mf47-panel_wire_v', 'scr1_wire_g'], ['mf47-panel_wire_COM', 'scr1_wire_k']])
                        && mm._inputValue > 1e6);
                },
            },
            {
                msg: '6. 填入本次测量的电阻值（左端—下端之间的电阻，很大/∞）',
                mode: 'fill',
                target: 'scr1',
                fields: [
                    { label: '反向电阻', unit: 'Ω', answer: ['∞', '无穷大', '开路', 'ol'], placeholder: '很大，可填 ∞ 或 无穷大' },
                ],
            },
            {
                msg: '7. 反接测量：红表笔（VΩ）接下端、黑表笔（COM）接左端，读取电阻值',
                mode: 'check',
                op: [
                    {
                        type: 'observe', target: 'scr1',
                        msg: '断开原接线并反接：红表笔（VΩ）接下端，黑表笔（COM）接左端',
                        async act() {
                            await _wireMF47(this.sys, [
                                ['mf47-panel_wire_v', 'scr1_wire_k'],
                                ['mf47-panel_wire_COM', 'scr1_wire_g'],
                            ], 'scr1');
                        },
                    },
                    {
                        type: 'observe', target: 'mf47-panel', part: 'dial',
                        msg: '观察指针：阻值较小（该 PN 结正向导通）',
                        async act() { await _sleep(2500); },
                    },
                    {
                        type: 'observe', target: 'scr1',
                        msg: '读取电阻值后，断开所有接线',
                        act() { _clearWiring(this.sys, 'scr1'); },
                    },
                ],
                check() {
                    const sys = this.sys;
                    const mm = sys.comps['mf47-panel'];
                    return !!(mm && mm._rangeId === 'OHM100'
                        && _joined(sys, [['mf47-panel_wire_v', 'scr1_wire_k'], ['mf47-panel_wire_COM', 'scr1_wire_g']])
                        && mm._inputValue > 100 && mm._inputValue < 2000);
                },
            },
            {
                msg: '8. 填入本次测量的电阻值（左端—下端之间的正向电阻，单位 Ω）',
                mode: 'fill',
                target: 'scr1',
                fields: [
                    { label: '正向电阻', unit: 'Ω', answer: 500, tolerance: 0.15, placeholder: '读取 Ω 刻度后输入，如 500' },
                ],
            },
            {
                msg: '9. 填空题：晶闸管的控制极（门极）是＿＿；阴极是＿＿（填"左端"、"上端"或"下端"）',
                mode: 'fill',
                target: 'scr1',
                fields: [
                    { label: '控制极', unit: '', answer: ['左端', '左'], placeholder: '填 左端/上端/下端' },
                    { label: '阴极', unit: '', answer: ['下端', '下'], placeholder: '填 左端/上端/下端' },
                ],
            },
            {
                msg: '10. 测试题：晶闸管判断引脚的方法',
                mode: 'quiz',
                quizConfig: {
                    question: '用指针万用表判别晶闸管（SCR）的引脚，下列方法正确的是？',
                    options: [
                        '测量各脚之间电阻：测得正向电阻小（PN 结导通）的一次，黑表笔（COM）所接为控制极（门极），红表笔所接为阴极，剩下的一脚为阳极',
                        '测得阻值小的一次，红表笔所接为控制极，黑表笔所接为阴极',
                        '三脚之间任意两脚的正反向电阻都相同',
                        '阻值最大的两脚分别是阳极和控制极',
                    ],
                    answer: 0,
                    analysis: '晶闸管的门极与阴极之间是一个 PN 结，可按二极管的方法测其正反向电阻：正向导通（阻值小）的一次，黑表笔（表内电池正极）所接为门极（控制极），红表笔所接为阴极，剩下的一脚即阳极。阳极与其他两脚之间正反向电阻通常都很大。',
                },
            },
        ],
    },

    'igbt-identify-pins': {
        id: 'igbt-identify-pins',
        name: '6. 识别IGBT并判别引脚',
        steps: [
            {
                msg: '1. 识别 IGBT 的电路符号：点击右侧的 IGBT 符号（绝缘栅双极型晶体管图形符号）',
                mode: 'find',
                target: 'igbt2',
            },
            {
                msg: '2. 识别 IGBT 的实物：点击左侧的 IGBT 实物（TO-220 封装，带金属散热片）',
                mode: 'find',
                target: 'igbt1',
            },
            {
                msg: '3. 调出模拟万用表：在工具栏"选择仪表"中勾选"指针万用表（MF47）"',
                mode: 'check',
                op: [{ type: 'instrument', instrument: 'mf47' }],
                act() {
                    const sys = this.sys;
                    if (sys.toggleInstrumentVisibility) sys.toggleInstrumentVisibility('mf47-panel', true);
                    if (sys.redrawAll) sys.redrawAll();
                },
                check() {
                    const mm = this.sys.comps['mf47-panel'];
                    return !!(mm && mm.group && mm.group.visible());
                },
            },
            {
                msg: '4. 将 MF47 旋至 R×100 档，短接 VΩ 端与 COM 端进行欧姆调零，调零后断开短接线',
                mode: 'check',
                op: [
                    {
                        type: 'knob', target: 'mf47-panel', part: 'range-OHM100',
                        msg: '将 MF47 量程旋钮旋至 R×100 档',
                        act() {
                            const mm = this.sys.comps['mf47-panel'];
                            if (mm) { mm.setRange('OHM100'); }
                        },
                    },
                    {
                        type: 'observe', target: 'mf47-panel', part: 'v',
                        msg: '短接 VΩ 端与 COM 端（两表笔相碰）',
                        async act() { await _shortVCOM(this.sys); },
                    },
                    {
                        type: 'knob', target: 'mf47-panel', part: 'ohm-zero',
                        msg: '旋转欧姆调零旋钮，使指针指到 Ω 刻度的 0 位',
                        act() {
                            const mm = this.sys.comps['mf47-panel'];
                            if (mm) { mm._ohmZeroAdjust = 1; mm.config.ohmZeroAdjust = 1; mm.markDirty(); }
                        },
                    },
                    {
                        type: 'observe', target: 'mf47-panel', part: 'v',
                        msg: '调零完成，断开 VΩ 端与 COM 端的短接线',
                        act() { _openVCOMShort(this.sys); },
                    },
                ],
                check() {
                    const sys = this.sys;
                    const mm = sys.comps['mf47-panel'];
                    return !!(mm && mm._rangeId === 'OHM100' && mm._ohmZeroAdjust >= 0.99)
                        && !_sameCluster(sys, 'mf47-panel_wire_v', 'mf47-panel_wire_COM');
                },
            },
            {
                msg: '5. 测量上端与下端之间的 PN 结：红表笔（VΩ）接上端、黑表笔（COM）接下端，读取电阻值',
                mode: 'check',
                op: [
                    {
                        type: 'observe', target: 'igbt1',
                        msg: '红表笔（VΩ）接上端，黑表笔（COM）接下端',
                        async act() {
                            await _wireMF47(this.sys, [
                                ['mf47-panel_wire_v', 'igbt1_wire_c'],
                                ['mf47-panel_wire_COM', 'igbt1_wire_e'],
                            ], 'igbt1');
                        },
                    },
                    {
                        type: 'observe', target: 'mf47-panel', part: 'dial',
                        msg: '观察指针：阻值较小（C-E 体二极管正向导通）',
                        async act() { await _sleep(2500); },
                    },
                    {
                        type: 'observe', target: 'igbt1',
                        msg: '读取电阻值后，断开所有接线',
                        act() { _clearWiring(this.sys, 'igbt1'); },
                    },
                ],
                check() {
                    const sys = this.sys;
                    const mm = sys.comps['mf47-panel'];
                    return !!(mm && mm._rangeId === 'OHM100'
                        && _joined(sys, [['mf47-panel_wire_v', 'igbt1_wire_c'], ['mf47-panel_wire_COM', 'igbt1_wire_e']])
                        && mm._inputValue > 500 && mm._inputValue < 5000);
                },
            },
            {
                msg: '6. 填入本次测量的电阻值（上端—下端之间的正向电阻，单位 Ω）',
                mode: 'fill',
                target: 'igbt1',
                fields: [
                    { label: '上-下电阻', unit: 'Ω', answer: 1417, tolerance: 0.15, placeholder: '读取 Ω 刻度后输入，如 1417' },
                ],
            },
            {
                msg: '7. 测量下端与左端之间（门极与发射极）：红表笔（VΩ）接下端、黑表笔（COM）接左端，读取电阻值',
                mode: 'check',
                op: [
                    {
                        type: 'observe', target: 'igbt1',
                        msg: '红表笔（VΩ）接下端，黑表笔（COM）接左端',
                        async act() {
                            await _wireMF47(this.sys, [
                                ['mf47-panel_wire_v', 'igbt1_wire_e'],
                                ['mf47-panel_wire_COM', 'igbt1_wire_g'],
                            ], 'igbt1');
                        },
                    },
                    {
                        type: 'observe', target: 'mf47-panel', part: 'dial',
                        msg: '观察指针：阻值很大（门极与发射极之间为绝缘栅，接近 ∞）',
                        async act() { await _sleep(2500); },
                    },
                    {
                        type: 'observe', target: 'igbt1',
                        msg: '读取电阻值后，断开所有接线',
                        act() { _clearWiring(this.sys, 'igbt1'); },
                    },
                ],
                check() {
                    const sys = this.sys;
                    const mm = sys.comps['mf47-panel'];
                    return !!(mm && mm._rangeId === 'OHM100'
                        && _joined(sys, [['mf47-panel_wire_v', 'igbt1_wire_e'], ['mf47-panel_wire_COM', 'igbt1_wire_g']])
                        && mm._inputValue > 1e6);
                },
            },
            {
                msg: '8. 填入本次测量的电阻值（下端—左端之间的电阻，很大/∞）',
                mode: 'fill',
                target: 'igbt1',
                fields: [
                    { label: '下-左电阻', unit: 'Ω', answer: ['∞', '无穷大', '开路', 'ol'], placeholder: '很大，可填 ∞ 或 无穷大' },
                ],
            },
            {
                msg: '9. 填空题：IGBT 的集电极是＿＿；发射极是＿＿（填"左端"、"上端"或"下端"）',
                mode: 'fill',
                target: 'igbt1',
                fields: [
                    { label: '集电极', unit: '', answer: ['上端', '上'], placeholder: '填 左端/上端/下端' },
                    { label: '发射极', unit: '', answer: ['下端', '下'], placeholder: '填 左端/上端/下端' },
                ],
            },
            {
                msg: '10. 测试题：IGBT 判断引脚的方法',
                mode: 'quiz',
                quizConfig: {
                    question: '用指针万用表判别 IGBT 的引脚，下列方法正确的是？',
                    options: [
                        '用电阻档测量：C-E 之间有体二极管，测得正向导通（阻值小）的一次，黑表笔（COM）所接为发射极 E、红表笔所接为集电极 C；门极 G 与 E、C 之间均为高阻（∞）',
                        '任意两脚之间都能测到很小的电阻',
                        '门极与发射极之间可测到 PN 结正向电阻',
                        'C-E 之间正反向电阻完全相同',
                    ],
                    answer: 0,
                    analysis: 'IGBT 的 C-E 之间有一个体二极管（类似 MOSFET），可按二极管方法测其正反向电阻：正向导通（阻值小）的一次，黑表笔（表内电池正极）所接为发射极 E，红表笔所接为集电极 C；门极 G 为绝缘栅输入，与 E、C 之间正反向电阻都很大（∞）。',
                },
            },
        ],
    },
};

export const componentConfigs = [
    // ── 左侧：7 种真实元器件，按圆周对称分布（圆心 370,440，半径 330）──
    // 电阻/电容/电感/二极管保持原样不旋转（RealResistor 内部自带 90° 旋转）；三极管、晶闸管、IGBT 向右旋转 90°
    { Class: RealResistor, id: 'r1', x: 370, y: 110, value: 1000, rotation: -90, visible: true, testFlag: true },
    { Class: RealCapacitor, id: 'c1', x: 628, y: 234, capacitance: 100e-6, rotation: 0, visible: true, testFlag: true },
    { Class: RealInductor, id: 'l1', x: 692, y: 513, inductance: 0.1, coilR: 10, rotation: 0, visible: true, testFlag: true },
    { Class: RealDiode, id: 'd1', x: 513, y: 737, vForward: 0.68, rotation: 0, visible: true, testFlag: true },
    { Class: RealTransistor, id: 't1', x: 227, y: 737, subType: 'NPN', beta: 100, rotation: 90, visible: true, testFlag: true },
    { Class: RealScr, id: 'scr1', x: 48, y: 513, rotation: 90, visible: true, testFlag: true },
    { Class: RealIGBT, id: 'igbt1', x: 112, y: 234, rotation: 90, visible: true, testFlag: true },

    // ── 右侧：7 种元器件的电路符号，整体位于画布中右侧，避免遮挡右侧面板；圆心 1200,440，半径 330 ──
    // 各符号朝向与左侧对应实物保持一致，便于实物与符号对照
    { Class: Resistor, id: 'r2', x: 1200, y: 110, value: 1000, visible: true },
    { Class: Capacitor, id: 'c2', x: 942, y: 234, capacitance: 100, visible: true },
    { Class: Inductor, id: 'l2', x: 878, y: 513, inductance: 0.1, rotation: 90, visible: true },
    { Class: Diode, id: 'd2', x: 1057, y: 737, vForward: 0.68, visible: true },
    { Class: Transistor, id: 't2', x: 1343, y: 737, rotation: 90, visible: true },
    { Class: SCR, id: 'scr2', x: 1392, y: 513, rotation: 90, visible: true },
    { Class: IGBT, id: 'igbt2', x: 1418, y: 234, visible: true },

    // ── 24V 直流电源与接地（置于两组元器件下方空白处，便于接线测量）──
    { Class: DCPower, id: 'psu', x: 220, y: 300, voltage: 24, isOn: true, visible: true },
    { Class: Ground, id: 'gnd', x: 260, y:590, visible: true },


    // ── 7 种保留仪表（默认隐藏，可从"选择仪表"中调出）──
    { Class: Multimeter, id: 'multimeter', x: 880, y: 440, visible: false },
    { Class: MF47Multimeter, id: 'mf47-panel', x: 1050, y: 180, visible: false },
    { Class: Oscilloscope_tri, id: 'osc', x: 50, y: 50, visible: false },
    { Class: SignalGenerator, id: 'sg', x: 50, y: 50, visible: false },
    { Class: ProcessCalibrator, id: 'cali', x: 50, y: 50, visible: false },
    { Class: ElecMeter, id: 'elecmeter', x: 50, y: 50, visible: false },
    { Class: RealMegohmMeter, id: 'megohm', x: 200, y: 50, voltage: 2500, label: '手摇兆欧表(2500V)', visible: false },
];

export function initSlider(_sys) { }

/* ── 工作流辅助 ───────────────────────────────────────────── */
function _sameCluster(sys, portA, portB) {
    const map = sys.voltageSolver?.portToCluster;
    if (!map) return false;
    const cA = map.get(portA);
    const cB = map.get(portB);
    return cA !== undefined && cA === cB;
}

/** 移除 MF47 的 VΩ/mA/COM 表笔接线 */
function _disconnectMF47(sys) {
    const ports = ['mf47-panel_wire_v', 'mf47-panel_wire_mA', 'mf47-panel_wire_COM'];
    const existing = sys.conns.filter(c => ports.includes(c.from) || ports.includes(c.to));
    existing.forEach(c => sys.connMgr.removeConn(c));
    sys.redrawAll();
}

/** 逐根动画接线（约 3s/根，本次接线数 <6 时一律动画接线） */
async function _wireAnimated(sys, pairs) {
    for (const [from, to] of pairs) {
        await sys.connMgr.addConnectionAnimated({ from, to, type: 'wire' });
    }
    sys.redrawAll();
}

/** 短接 VΩ 端与 COM 端（用于欧姆调零，动画接线） */
async function _shortVCOM(sys) {
    _disconnectMF47(sys);
    await _wireAnimated(sys, [['mf47-panel_wire_v', 'mf47-panel_wire_COM']]);
}

/** 断开 VΩ 端与 COM 端的短接线 */
function _openVCOMShort(sys) {
    const c = sys.conns.find(c =>
        (c.from === 'mf47-panel_wire_v' && c.to === 'mf47-panel_wire_COM') ||
        (c.from === 'mf47-panel_wire_COM' && c.to === 'mf47-panel_wire_v'));
    if (c) { sys.connMgr.removeConn(c); sys.redrawAll(); }
}

/** 延时辅助 */
function _sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

/** 红黑表笔接到指定元器件两端（动画接线）。swap=true 时 V 接右端、COM 接左端 */
async function _probeDev(sys, id, swap) {
    _disconnectMF47(sys);
    const vP = swap ? `${id}_wire_r` : `${id}_wire_l`;
    const cP = swap ? `${id}_wire_l` : `${id}_wire_r`;
    await _wireAnimated(sys, [
        ['mf47-panel_wire_v', vP],
        ['mf47-panel_wire_COM', cP],
    ]);
}

/** MF47 表笔是否跨接在指定元器件两端（swap 指定表笔方向） */
function _mf47Across(sys, id, swap) {
    const vP = swap ? `${id}_wire_r` : `${id}_wire_l`;
    const cP = swap ? `${id}_wire_l` : `${id}_wire_r`;
    return _sameCluster(sys, 'mf47-panel_wire_v', vP)
        && _sameCluster(sys, 'mf47-panel_wire_COM', cP);
}

/** 移除数字万用表的 V/mA/COM 表笔接线 */
function _disconnectDMM(sys) {
    const ports = ['multimeter_wire_v', 'multimeter_wire_ma', 'multimeter_wire_com'];
    const existing = sys.conns.filter(c => ports.includes(c.from) || ports.includes(c.to));
    existing.forEach(c => sys.connMgr.removeConn(c));
    sys.redrawAll();
}

/** 数字万用表表笔接到指定元器件两端（动画接线）。swap=true 时 V 接右端、COM 接左端 */
async function _probeDMM(sys, id, swap) {
    _disconnectDMM(sys);
    const vP = swap ? `${id}_wire_r` : `${id}_wire_l`;
    const cP = swap ? `${id}_wire_l` : `${id}_wire_r`;
    await _wireAnimated(sys, [
        ['multimeter_wire_v', vP],
        ['multimeter_wire_com', cP],
    ]);
}

/** 数字万用表表笔是否跨接在指定元器件两端 */
function _dmmAcross(sys, id, swap) {
    const vP = swap ? `${id}_wire_r` : `${id}_wire_l`;
    const cP = swap ? `${id}_wire_l` : `${id}_wire_r`;
    return _sameCluster(sys, 'multimeter_wire_v', vP)
        && _sameCluster(sys, 'multimeter_wire_com', cP);
}

/** 移除某元器件全部引脚上的连线（如三极管的短接线） */
function _clearCompWiring(sys, compId) {
    const pre = `${compId}_wire_`;
    const existing = sys.conns.filter(c => (c.from && c.from.startsWith(pre)) || (c.to && c.to.startsWith(pre)));
    existing.forEach(c => sys.connMgr.removeConn(c));
    sys.redrawAll();
}

/** 断开 MF47 表笔及指定元器件的全部接线 */
function _clearWiring(sys, compId) {
    _disconnectMF47(sys);
    if (compId) _clearCompWiring(sys, compId);
}

/** 先断开 MF47 表笔（及指定元器件接线），再按给定端口对逐根动画接线 */
async function _wireMF47(sys, pairs, compId) {
    _disconnectMF47(sys);
    if (compId) _clearCompWiring(sys, compId);
    await _wireAnimated(sys, pairs);
}

/** 给定端口对是否都处于同一 cluster（用于校验接线） */
function _joined(sys, pairs) {
    return pairs.every(([a, b]) => _sameCluster(sys, a, b));
}

export function applyAllPresets() {
    const sys = this.sys;
    if (!sys) return;
    // 本工程为元器件识别测量，无预设连线：仅复位 MF47 并收起
    _disconnectMF47(sys);
    if (typeof sys.toggleInstrumentVisibility === 'function') {
        sys.toggleInstrumentVisibility('mf47-panel', false);
    }
    const mm = sys.comps['mf47-panel'];
    if (mm) {
        mm.setRange('ACV500');
        mm._ohmZeroAdjust = 0.5;
        mm.config.ohmZeroAdjust = 0.5;
        mm.markDirty();
    }
    if (sys.redrawAll) sys.redrawAll();
}

export async function applyStartSystem() { }

export function fiveStep() { }
