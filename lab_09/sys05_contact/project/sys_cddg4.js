// 变压器认知工程
// 电路：24V 直流电源 / 24V 交流电源 → 变压器 → 地（未接线，仅保留元件）
// 另含纯图片组件：变压器铭牌图片

import { ACPower } from '../components/ACPower.js';
import { RealControlTransformer } from '../components/RealControlTransformer.js';
import { Ground } from '../components/Gnd.js';
import { DCPower } from '../components/DCPower.js';
import { PictureImage } from '../components/PictureImage.js';
import { Multimeter } from '../components/Multimeter.js';
import { MF47Multimeter } from '../components/MF47Multimeter.js';
import { Oscilloscope_tri } from '../components/Osc_tri.js';
import { SignalGenerator } from '../components/SignalGenerator.js';
import { ProcessCalibrator } from '../components/ProcessCalibrator.js';
import { ElecMeter } from '../components/ElecMeter.js';
import { RealMegohmMeter } from '../components/RealMegohmMeter.js';
import nameplateSrc from '../images/03-transformer-nameplate.jpg';

export const FAULT_CONFIGS = {};

export const PROJECT_WORKFLOWS = {

    'transformer-nameplate': {
        id: 'transformer-nameplate',
        name: '1. 认识变压器铭牌',
        steps: [
            {
                msg: '1. 勾选工具栏「变压器铭牌」，显示变压器铭牌图片。',
                mode: 'check',
                check() {
                    const np = this.sys.comps['nameplate'];
                    return np && np.group && np.group.visible();
                },
                op: [
                    {
                        type: 'observe',
                        msg: '点击工具栏「变压器铭牌」复选框，显示铭牌图片',
                        async act() {
                            // 先用红框 + 箭头指向工具栏复选框，再执行勾选
                            const cb = document.getElementById('btnNameplate');
                            if (cb) {
                                const label = cb.closest('label') || cb;
                                await this._flashDomElement(label, '勾选「变压器铭牌」复选框', 2400);
                            }
                            const np = this.sys.comps['nameplate'];
                            if (np) { np.show(); np.group.moveToTop(); this.sys.redrawAll(); }
                            if (cb) { cb.checked = true; cb.dispatchEvent(new Event('change')); }
                        },
                    },
                ],
            },
            {
                msg: '2. 填空题：变压器的绝缘等级是（  ），变压器运行时的最高温度不超过（  ）℃。',
                mode: 'fill',
                fields: [
                    { label: '绝缘等级', unit: '', answer: ['F', 'F级'], placeholder: '填写绝缘等级字母' },
                    { label: '最高温度', unit: '℃', answer: 155, tolerance: 0.05, placeholder: '填写最高允许温度' },
                ],
            },
            {
                msg: '3. 填空题：变压器的连接组别是（  ），它的原边连接形式是（  ），副边连接形式是（  ）。',
                mode: 'fill',
                fields: [
                    { label: '连接组别', unit: '', answer: 'Dyn11', placeholder: '填写联结组标号' },
                    { label: '原边连接形式', unit: '', answer: ['三角形', '△', 'D'], placeholder: '填写原边绕组接法' },
                    { label: '副边连接形式', unit: '', answer: ['星形带中性线', '星形', 'Y', 'yn'], placeholder: '填写副边绕组接法' },
                ],
            },
            {
                msg: '4. 填空题：变压器的冷却方式是（  ）。',
                mode: 'fill',
                fields: [
                    { label: '冷却方式', unit: '', answer: ['AN', '自然风冷', '空气自冷'], placeholder: '填写冷却方式代码' },
                ],
            },
            {
                msg: '5. 填空题：变压器的额定视在功率是（  ）。',
                mode: 'fill',
                fields: [
                    { label: '额定视在功率', unit: 'kVA', answer: 1600, tolerance: 0.05, placeholder: '填写额定容量' },
                ],
            },
        ],
    },

    'transformer-dc-polarity': {
        id: 'transformer-dc-polarity',
        name: '2. 直流法验证同名端',
        steps: [
            {
                msg: '1. 识别同名端：变压器原边的红色接线柱（P1）与副边的红色接线柱（S1）是同名端。',
                mode: 'find',
                target: 'tr',
                async act() {
                    // 演练：点击变压器即通过（由 find 判定）；
                    // 演示：依次指示原边红色接线柱 P1 与副边红色接线柱 S1
                    const tr = this.sys.comps['tr'];
                    if (!tr) return;
                    const p1 = tr.getClickablePartCenter && tr.getClickablePartCenter('p1');
                    if (p1) { this._tipWorkflow('这是原边红色接线柱 P1', 3500); await this._flashArrow(p1, { on: 500, off: 350, times: 3 }); }
                    const s1 = tr.getClickablePartCenter && tr.getClickablePartCenter('s1');
                    if (s1) { this._tipWorkflow('这是副边红色接线柱 S1，与 P1 为同名端', 3500); await this._flashArrow(s1, { on: 500, off: 350, times: 3 }); }
                },
            },
            {
                msg: '2. 将 24V 直流电源接到变压器原边（正极接 P1、负极接 P2）。',
                mode: 'check',
                check() {
                    return _hasConn(this.sys, 'dc_wire_p', 'tr_wire_p1')
                        && _hasConn(this.sys, 'dc_wire_n', 'tr_wire_p2');
                },
                op: [
                    { type: 'observe', target: 'dc', part: 'p', msg: '将直流电源正极接到变压器原边红色接线柱 P1',
                      async act() { await _wireAnimated(this.sys, 'dc_wire_p', 'tr_wire_p1'); } },
                    { type: 'observe', target: 'dc', part: 'n', msg: '将直流电源负极接到变压器原边接线柱 P2',
                      async act() { await _wireAnimated(this.sys, 'dc_wire_n', 'tr_wire_p2'); } },
                ],
            },
            {
                msg: '3. 调出模拟万用表（MF47），量程打到直流 10V 档。',
                mode: 'check',
                check() {
                    const mf = this.sys.comps['mf47-panel'];
                    return mf && mf.group && mf.group.visible() && mf._rangeId === 'DCV10';
                },
                op: [
                    { type: 'instrument', instrument: 'mf47', target: 'mf47-panel',
                      msg: '打开工具栏「选择仪表」界面，勾选指针万用表，再点击「关闭」' },
                    { type: 'observe', target: 'mf47-panel',
                      msg: '转动量程开关到直流 10V 档',
                      async act() {
                          const mf = this.sys.comps['mf47-panel'];
                          if (mf) { mf._setRange('DCV10'); mf.update?.(); }
                          this.sys.redrawAll();
                          await new Promise(r => setTimeout(r, 1200));
                      } },
                ],
            },
            {
                msg: '4. 将万用表表笔接到变压器副边（红表笔接 S1、黑表笔接 S2）。',
                mode: 'check',
                check() {
                    return _hasConn(this.sys, 'mf47-panel_wire_v', 'tr_wire_s1')
                        && _hasConn(this.sys, 'mf47-panel_wire_COM', 'tr_wire_s2');
                },
                op: [
                    { type: 'observe', target: 'mf47-panel', part: 'v', msg: '将万用表红表笔（V·Ω）接到变压器副边红色接线柱 S1',
                      async act() { await _wireAnimated(this.sys, 'mf47-panel_wire_v', 'tr_wire_s1'); } },
                    { type: 'observe', target: 'mf47-panel', part: 'com', msg: '将万用表黑表笔（COM）接到变压器副边接线柱 S2',
                      async act() { await _wireAnimated(this.sys, 'mf47-panel_wire_COM', 'tr_wire_s2'); } },
                ],
            },
            {
                msg: '5. 合上 24V 直流电源，观察万用表指针的正偏过程。',
                mode: 'check',
                check() {
                    const dc = this.sys.comps['dc'];
                    return dc && dc.isOn;
                },
                op: [
                    { type: 'switch', target: 'dc', part: 'power', msg: '按下直流电源面板上的电源键，接通 24V 直流电源',
                      async act() {
                          const dc = this.sys.comps['dc'];
                          if (dc) { dc.isOn = true; dc.update?.(); }
                          this.sys.redrawAll();
                          await new Promise(r => setTimeout(r, 3000));
                      } },
                    { type: 'observe', target: 'mf47-panel', msg: '观察万用表指针正向偏转（副边感应出约 6V 电压）',
                      async act() { await new Promise(r => setTimeout(r, 3000)); } },
                ],
            },
            {
                msg: '6. 断开 24V 直流电源，观察万用表指针的反偏过程。',
                mode: 'check',
                check() {
                    const dc = this.sys.comps['dc'];
                    return dc && !dc.isOn;
                },
                op: [
                    { type: 'switch', target: 'dc', part: 'power', msg: '再次按下直流电源面板上的电源键，断开 24V 直流电源',
                      async act() {
                          const dc = this.sys.comps['dc'];
                          if (dc) { dc.isOn = false; dc.update?.(); }
                          this.sys.redrawAll();
                          await new Promise(r => setTimeout(r, 3000));
                      } },
                    { type: 'observe', target: 'mf47-panel', msg: '观察万用表指针反向偏转（磁通塌缩产生反向感应电压）',
                      async act() { await new Promise(r => setTimeout(r, 3000)); } },
                ],
            },
        ],
    },

    'transformer-ac-polarity': {
        id: 'transformer-ac-polarity',
        name: '3. 交流法验证同名端',
        steps: [
            {
                msg: '1. 将 24V 交流电源接到变压器原边（P1、P2）',
                mode: 'check',
                check() {
                    return _hasConn(this.sys, 'ac_wire_p', 'tr_wire_p1')
                        && _hasConn(this.sys, 'ac_wire_n', 'tr_wire_p2');
                },
                op: [
                    { type: 'observe', target: 'ac', part: 'p', msg: '将交流电源输出端接到变压器原边红色接线柱 P1',
                      async act() { await _wireAnimated(this.sys, 'ac_wire_p', 'tr_wire_p1'); } },
                    { type: 'observe', target: 'ac', part: 'n', msg: '将交流电源另一端接到变压器原边接线柱 P2',
                      async act() { await _wireAnimated(this.sys, 'ac_wire_n', 'tr_wire_p2'); } },
                ],
            },
            {
                msg: '2. 调出 MF47 万用表，量程打到交流 50V 档，并将万用表接到变压器副边（S1、S2）',
                mode: 'check',
                check() {
                    const mf = this.sys.comps['mf47-panel'];
                    return mf && mf.group && mf.group.visible() && mf._rangeId === 'ACV50'
                        && _hasConn(this.sys, 'mf47-panel_wire_v', 'tr_wire_s1')
                        && _hasConn(this.sys, 'mf47-panel_wire_COM', 'tr_wire_s2');
                },
                op: [
                    { type: 'instrument', instrument: 'mf47', target: 'mf47-panel',
                      msg: '打开工具栏「选择仪表」界面，勾选指针万用表，再点击「关闭」' },
                    { type: 'knob', target: 'mf47-panel', part: 'range-ACV50', msg: '转动量程开关到交流 50V 档',
                      async act() {
                          const mf = this.sys.comps['mf47-panel'];
                          if (mf) { mf._setRange('ACV50'); mf.update?.(); }
                          this.sys.redrawAll();
                          await new Promise(r => setTimeout(r, 1000));
                      } },
                    { type: 'observe', target: 'mf47-panel', part: 'v', msg: '将万用表红表笔（V·Ω）接到变压器副边红色接线柱 S1',
                      async act() { await _wireAnimated(this.sys, 'mf47-panel_wire_v', 'tr_wire_s1'); } },
                    { type: 'observe', target: 'mf47-panel', part: 'com', msg: '将万用表黑表笔（COM）接到变压器副边接线柱 S2',
                      async act() { await _wireAnimated(this.sys, 'mf47-panel_wire_COM', 'tr_wire_s2'); } },
                ],
            },
            {
                msg: '3. 将变压器的下面两个同名端短接（P2 与 S2 短接）',
                mode: 'check',
                check() {
                    return _hasConn(this.sys, 'tr_wire_p2', 'tr_wire_s2');
                },
                op: [
                    { type: 'observe', target: 'tr', part: 'p2', msg: '用导线将变压器原边下端子 P2 短接到副边下端子 S2',
                      async act() { await _wireAnimated(this.sys, 'tr_wire_p2', 'tr_wire_s2'); } },
                ],
            },
            {
                msg: '4. 调出数字万用表，量程打到交流 200V 档，一端接 P1、一端接 S1',
                mode: 'check',
                check() {
                    const mm = this.sys.comps['multimeter'];
                    return mm && mm.group && mm.group.visible() && mm.mode === 'ACV200'
                        && _hasConn(this.sys, 'multimeter_wire_v', 'tr_wire_s1')
                        && _hasConn(this.sys, 'multimeter_wire_com', 'tr_wire_p1');
                },
                op: [
                    { type: 'instrument', instrument: 'multimeter', target: 'multimeter',
                      msg: '打开工具栏「选择仪表」界面，勾选数字万用表，再点击「关闭」' },
                    { type: 'knob', target: 'multimeter', part: 'knob', msg: '转动量程开关到交流 200V 档',
                      async act() {
                          const mm = this.sys.comps['multimeter'];
                          if (mm) {
                              mm.mode = 'ACV200';
                              mm._updateAngleByMode?.();   // 同步旋钮手柄到 ACV200 档位
                              mm.update?.(0);
                          }
                          this.sys.redrawAll();
                          await new Promise(r => setTimeout(r, 1000));
                      } },
                    { type: 'observe', target: 'multimeter', part: 'v', msg: '将数字万用表红表笔接到副边红色接线柱 P1',
                      async act() { await _wireAnimated(this.sys, 'multimeter_wire_v', 'tr_wire_s1'); } },
                    { type: 'observe', target: 'multimeter', part: 'com', msg: '将数字万用表黑表笔接到原边红色接线柱 S1',
                      async act() { await _wireAnimated(this.sys, 'multimeter_wire_com', 'tr_wire_p1'); } },
                ],
            },
            {
                msg: '5. 合上 24V 交流电源，读取指针万用表和数字万用表的电压值',
                mode: 'check',
                check() {
                    const ac = this.sys.comps['ac'];
                    return ac && ac.isOn;
                },
                op: [
                    { type: 'switch', target: 'ac', part: 'power', msg: '按下交流电源面板上的电源键，接通 24V 交流电源',
                      async act() {
                          const ac = this.sys.comps['ac'];
                          if (ac) { ac.isOn = true; ac.update?.(); }
                          this.sys.redrawAll();
                          await new Promise(r => setTimeout(r, 3000));
                      } },
                    { type: 'observe', target: 'mf47-panel', msg: '读取指针万用表读数：副边电压约 6V',
                      async act() { await new Promise(r => setTimeout(r, 3000)); } },
                    { type: 'observe', target: 'multimeter', msg: '读取数字万用表读数：P1 与 S1 之间的电压约 18V',
                      async act() { await new Promise(r => setTimeout(r, 3000)); } },
                ],
            },
            {
                msg: '6. 填空题：变压器原边电压是（  ）V，变压器副边电压是（  ）V，原边 P1 与副边 S1 两端之间的电压是（  ）V。',
                mode: 'fill',
                fields: [
                    { label: '原边电压', unit: 'V', answer: 24, tolerance: 0.1, placeholder: '填写原边电压' },
                    { label: '副边电压', unit: 'V', answer: 6, tolerance: 0.1, placeholder: '填写副边电压' },
                    { label: 'P1 与 S1 之间电压', unit: 'V', answer: 18, tolerance: 0.1, placeholder: '填写两端电压' },
                ],
            },
            {
                msg: '7. 测试题：交流法判断同名端的原理',
                mode: 'quiz',
                quizConfig: {
                    question: '交流法判断变压器同名端时，将一对端子（如 P2 与 S2）短接，测量另一对端子（P1 与 S1）之间的电压。若测得电压等于两绕组电压之和（U1+U2），说明什么？',
                    options: [
                        'P1 与 S1 是同名端',
                        'P1 与 S1 是异名端（非同名端）',
                        '变压器发生了短路故障',
                        '无法判断同名端',
                    ],
                    answer: 1,
                    analysis: '短接一对端子后，若另一对端子电压为两电压之和（U1+U2），说明这两端是异名端；若为两电压之差（U1−U2），则为同名端。本实验短接 P2-S2 后测得 P1-S1 约为 U1−U2=18V，故 P1 与 S1 是同名端。',
                },
            },
        ],
    },

};

export const componentConfigs = [
    { Class: DCPower, id: 'dc', x: 320, y: 660, voltage: 24, isOn: false },
    { Class: ACPower, id: 'ac', x: 320, y: 260, vRms: 24, freq: 50, isOn: false },
    { Class: RealControlTransformer, id: 'tr', x: 720, y: 580, primaryVoltage: 220, secondaryVoltage: 55 },
    { Class: Ground, id: 'gnd1', x: 310, y: 580 },

    { Class: PictureImage, id: 'nameplate', x: 500, y: 10, src: nameplateSrc, width: 480, visible: false },

    { Class: Multimeter, id: 'multimeter', x: 720, y: -20, visible: false },
    { Class: MF47Multimeter, id: 'mf47-panel', x: 1150, y: 250, visible: false },
    { Class: Oscilloscope_tri, id: 'osc', x: 50, y: 50, visible: false },
    { Class: SignalGenerator, id: 'sg', x: 50, y: 50, visible: false },
    { Class: ProcessCalibrator, id: 'cali', x: 50, y: 50, visible: false },
    { Class: ElecMeter, id: 'elecmeter', x: 50, y: 50, visible: false },
    { Class: RealMegohmMeter, id: 'megohm', x: 50, y: 50, visible: false },
];

export function initSlider(_sys) { }

export function applyAllPresets() {
    // 清空电路：不做任何预设接线
}

export async function applyStartSystem() {
    // 清空电路：不做任何预设接线
}

export function fiveStep() { }

/** 判断两端口间是否已有连线 */
function _hasConn(sys, a, b) {
    return sys.conns.some(c => (c.from === a && c.to === b) || (c.from === b && c.to === a));
}

/**
 * 动画接线（约 3s/根）：逐根播放连线动画后建立连线。
 */
async function _wireAnimated(sys, from, to) {
    if (_hasConn(sys, from, to)) return;
    await sys.connMgr.addConnectionAnimated({ from, to, type: 'wire' });
    sys.redrawAll();
}
