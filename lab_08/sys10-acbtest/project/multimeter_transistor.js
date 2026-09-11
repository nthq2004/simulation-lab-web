// 三极管开关控制工程 — 基极偏置电阻对三极管开关特性的影响
// 电路：
//   基极回路：5V → 基极偏置电阻 → MF47(50mA) → 三极管 B
//   集电极回路：24V → 继电器线圈 → 数字万用表(mA) → 三极管 C→E→GND

import { DCPower } from '../components/DCPower.js';
import { RealResistor } from '../components/RealResistor.js';
import { Ground } from '../components/Gnd.js';
import { Multimeter } from '../components/Multimeter.js';
import { MF47Multimeter } from '../components/MF47Multimeter.js';
import { SignalGenerator } from '../components/SignalGenerator.js';
import { ProcessCalibrator } from '../components/ProcessCalibrator.js';
import { Oscilloscope_tri } from '../components/Osc_tri.js';
import { VoltageRelay } from '../components/VoltageRelay.js';
import { RealTransistor } from '../components/RealTransistor.js';

export const FAULT_CONFIGS = {
    be_open: {
        id: 'be_open',
        name: 'BE 开路故障',
        system: '三极管',
        check() {
            const c = window.sys && window.sys.comps && window.sys.comps['tr1'];
            return c && c._faultBEOpen;
        },
        trigger() {
            const c = window.sys && window.sys.comps && window.sys.comps['tr1'];
            if (c) c._faultBEOpen = true;
        },
        repair() {
            const c = window.sys && window.sys.comps && window.sys.comps['tr1'];
            if (c) c._faultBEOpen = false;
        },
    },
    ce_short: {
        id: 'ce_short',
        name: 'CE 击穿故障',
        system: '三极管',
        check() {
            const c = window.sys && window.sys.comps && window.sys.comps['tr1'];
            return c && c._faultCEShort;
        },
        trigger() {
            const c = window.sys && window.sys.comps && window.sys.comps['tr1'];
            if (c) c._faultCEShort = true;
        },
        repair() {
            const c = window.sys && window.sys.comps && window.sys.comps['tr1'];
            if (c) c._faultCEShort = false;
        },
    },
};

const RB_STEPS = [430, 860, 2150, 4300, 8600];

function _getIB(rb) {
    return (5 - 0.7) / rb;
}

function _getIC(ib) {
    const icMax = 24 / 120;
    return Math.min(icMax, ib * 100);
}

function _updateMeters(sys, rbVal) {
    const ib = _getIB(rbVal);
    const ic = _getIC(ib);
    const mf47 = sys.comps['mf47-panel'];
    if (mf47) { mf47.physCurrent = ib; }
    const mm = sys.comps['multimeter'];
    if (mm) { mm.update(ic); }
    const relay = sys.comps['k1'];
    if (relay) relay.update();
}

function _syncSliderFromResistor(sys) {
    const slider = document.getElementById('rbSlider');
    const display = document.getElementById('rbDisplay');
    if (!slider) return;
    const r = sys.comps['rb'];
    if (!r) return;
    const val = r.currentResistance || r.value;
    slider.value = val;
    display.textContent = val >= 1000 ? (val / 1000).toFixed(1) + ' kΩ' : val + ' Ω';
}

function _updateResistorValue(sys, val) {
    const r = sys.comps['rb'];
    if (!r) return;
    r.value = val;
    r.currentResistance = val;
    r.drawBands();
    r.label.text(val >= 1000 ? (val / 1000).toFixed(1) + ' kΩ' : val + ' Ω');
    r._refreshCache();
}

export const PROJECT_WORKFLOWS = {
    'transistor-switch': {
        id: 'transistor-switch',
        name: '1. 三极管工作特性测试',
        steps: [
            {
                msg: '1. 接通基极回路：5V 电源正极→基极偏置电阻→三极管基极 B，5V电源负极→地',
                mode: 'check',
                act() {
                    _doPresetWiring(this.sys);
                },
                check() {
                    const conns = this.sys.conns || [];
                    const has = (a, b) => conns.some(c => (c.from === a && c.to === b) || (c.from === b && c.to === a));
                    return has('psu_b_wire_p', 'rb_wire_l')
                        && has('rb_wire_r', 'tr1_wire_b')
                        && has('psu_b_wire_n', 'gnd_b_wire_gnd');
                },
            },
            {
                msg: '2. 接通集电极回路：24V 电源正极→继电器线圈→三极管集电极 C→三极管发射极E→地，24V电源负极→地',
                mode: 'check',
                act() {},
                check() {
                    const conns = this.sys.conns || [];
                    const has = (a, b) => conns.some(c => (c.from === a && c.to === b) || (c.from === b && c.to === a));
                    return has('psu_c_wire_p', 'k1_wire_r')
                        && has('k1_wire_l', 'tr1_wire_c')
                        && has('tr1_wire_e', 'gnd_wire_gnd')
                        && has('psu_c_wire_n', 'gnd_c_wire_gnd');
                },
            },
            {
                msg: '3. 调出数字万用表，拨到 mA 档（串入继电器和三极管集电极之间）',
                mode: 'check',
                act() {
                    const mm = this.sys.comps['multimeter'];
                    if (mm) { mm.group.visible(true); mm.group.listening(true); mm.mode = 'MA'; mm._updateAngleByMode(); mm.update(0); }
                },
                check() {
                    const mm = this.sys.comps['multimeter'];
                    return mm && mm.group.visible() === true && mm.mode === 'MA';
                },
            },
            {
                msg: '4. 调出指针式万用表（MF47），拨到 50mA 档（串入基极偏置电阻和三极管基极之间）',
                mode: 'check',
                act() {
                    const mf47 = this.sys.comps['mf47-panel'];
                    if (mf47) { mf47.group.visible(true); mf47.group.listening(true); mf47.setRange('MA50'); }
                },
                check() {
                    const mf47 = this.sys.comps['mf47-panel'];
                    return mf47 && mf47.group.visible() === true && mf47._rangeId === 'MA50';
                },
            },
            {
                msg: '5. 接通集电极 24V 电源（基极电源断开），观察集电极电流和继电器动作',
                mode: 'check',
                act() {
                    const psuC = this.sys.comps['psu_c'];
                    if (psuC) { psuC.isOn = true; psuC.voltage = 24; psuC.update(); }
                    const psuB = this.sys.comps['psu_b'];
                    if (psuB) { psuB.isOn = false; psuB.voltage = 0; psuB.update(); }
                    _updateMeters(this.sys, parseFloat(document.getElementById('rbSlider')?.value) || 2150);
                },
                check() {
                    const psuC = this.sys.comps['psu_c'];
                    const relay = this.sys.comps['k1'];
                    return psuC && psuC.isOn && relay && relay.isEnergized === false;
                },
            },
            {
                msg: '6. 接通基极 5V 电源，观察基极电流、集电极电流和继电器动作',
                mode: 'check',
                act() {
                    const psuB = this.sys.comps['psu_b'];
                    if (psuB) { psuB.isOn = true; psuB.voltage = 5; psuB.update(); }
                    const slider = document.getElementById('rbSlider');
                    const rbVal = parseFloat(slider?.value) || 2150;
                    _updateMeters(this.sys, rbVal);
                },
                check() {
                    const psuB = this.sys.comps['psu_b'];
                    const relay = this.sys.comps['k1'];
                    const vBE = this.sys.getVoltageBetween('tr1_wire_b', 'tr1_wire_e');
                    return psuB && psuB.isOn && relay && relay.isEnergized === true
                        && vBE !== undefined && vBE > 0.5;
                },
            },
            {
                msg: '7. 将基极偏置电阻调到 4300Ω，观察基极电流和集电极电流',
                mode: 'check',
                act() {
                    const slider = document.getElementById('rbSlider');
                    const display = document.getElementById('rbDisplay');
                    if (slider) { slider.value = 4300; }
                    if (display) { display.textContent = '4.3 kΩ'; }
                    _updateResistorValue(this.sys, 4300);
                    _updateMeters(this.sys, 4300);
                },
                check() {
                    const slider = document.getElementById('rbSlider');
                    const r = this.sys.comps['rb'];
                    return slider && Math.abs(parseFloat(slider.value) - 4300) < 100
                        && r && Math.abs(r.currentResistance - 4300) < 100;
                },
            },
            {
                msg: '8. 将基极偏置电阻调到 8600Ω，观察基极电流和集电极电流',
                mode: 'check',
                act() {
                    const slider = document.getElementById('rbSlider');
                    const display = document.getElementById('rbDisplay');
                    if (slider) { slider.value = 8600; }
                    if (display) { display.textContent = '8.6 kΩ'; }
                    _updateResistorValue(this.sys, 8600);
                    _updateMeters(this.sys, 8600);
                },
                check() {
                    const slider = document.getElementById('rbSlider');
                    const r = this.sys.comps['rb'];
                    return slider && Math.abs(parseFloat(slider.value) - 8600) < 100
                        && r && Math.abs(r.currentResistance - 8600) < 100;
                },
            },
            {
                msg: '9. 将基极偏置电阻调到 430Ω，观察基极电流和集电极电流',
                mode: 'check',
                act() {
                    const slider = document.getElementById('rbSlider');
                    const display = document.getElementById('rbDisplay');
                    if (slider) { slider.value = 430; }
                    if (display) { display.textContent = '430 Ω'; }
                    _updateResistorValue(this.sys, 430);
                    _updateMeters(this.sys, 430);
                },
                check() {
                    const slider = document.getElementById('rbSlider');
                    const r = this.sys.comps['rb'];
                    return slider && Math.abs(parseFloat(slider.value) - 430) < 10
                        && r && Math.abs(r.currentResistance - 430) < 10;
                },
            },
            {
                msg: '10. 将基极偏置电阻调到 860Ω，观察基极电流和集电极电流',
                mode: 'check',
                act() {
                    const slider = document.getElementById('rbSlider');
                    const display = document.getElementById('rbDisplay');
                    if (slider) { slider.value = 860; }
                    if (display) { display.textContent = '860 Ω'; }
                    _updateResistorValue(this.sys, 860);
                    _updateMeters(this.sys, 860);
                },
                check() {
                    const slider = document.getElementById('rbSlider');
                    const r = this.sys.comps['rb'];
                    return slider && Math.abs(parseFloat(slider.value) - 860) < 10
                        && r && Math.abs(r.currentResistance - 860) < 10;
                },
            },
            {
                msg: '11. 测试题：三极管饱和状态',
                mode: 'quiz',
                quizConfig: {
                    question: 'NPN 三极管进入饱和状态时，以下描述正确的是？',
                    options: [
                        '集电极电流完全由基极电流和放大倍数决定（IC = β×IB），与外部电路无关',
                        '集电极电流由外部电路负载决定，不再随基极电流增加而增加',
                        '三极管饱和时，集电极-发射极电压 VCE 接近电源电压',
                        '三极管饱和时，基极电流为零',
                    ],
                    answer: 1,
                    analysis: '三极管进入饱和状态后，集电极电流不再受基极电流控制（IC ≠ β×IB），' +
                        '而是由外部电路负载决定（饱和电流 = VCC / RC）。此时 VCE 接近 0V（约 0.2V），' +
                        '三极管相当于一个闭合的开关。',
                },
            },
        ],
    },
    'transistor-diode-test': {
        id: 'transistor-diode-test',
        name: '2. 用数字万用表测试三极管',
        steps: [
            {
                msg: '1. 将万用表拨到二极管档',
                mode: 'check',
                act() {
                    _disconnectMultimeter(this.sys);
                    const mm = this.sys.comps['multimeter'];
                    if (mm) { mm.group.visible(true); mm.group.listening(true);
                         mm.mode = 'DIODE'; mm._updateAngleByMode(); mm.update(0); }
                },
                check() {
                    const mm = this.sys.comps['multimeter'];
                    return mm && mm.mode === 'DIODE';
                },
            },
            {
                msg: '2. 红表笔（V）接 B，黑表笔（COM）接 E\n测量 BE 正向压降（应显示约 0.7V）',
                mode: 'check',
                act() {
                    _disconnectMultimeter(this.sys);
                    const mm = this.sys.comps['multimeter'];
                    if (mm) { mm.update(0.687); }
                    this.sys.connMgr.addConn({ from: 'multimeter_wire_v', to: 'tr1_wire_b', type: 'wire' });
                    this.sys.connMgr.addConn({ from: 'multimeter_wire_com', to: 'tr1_wire_e', type: 'wire' });
                    this.sys.redrawAll();
                },
                check() {
                    const mm = this.sys.comps['multimeter'];
                    return mm && mm.mode === 'DIODE' && Math.abs(mm.value - 0.687) < 0.1
                        && _sameCluster(this.sys, 'multimeter_wire_v', 'tr1_wire_b')
                        && _sameCluster(this.sys, 'multimeter_wire_com', 'tr1_wire_e');
                },
            },
            {
                msg: '3. 红表笔接 E，黑表笔接 B\n测量 BE 反向（应显示 OL 溢出）',
                mode: 'check',
                act() {
                    _disconnectMultimeter(this.sys);
                    const mm = this.sys.comps['multimeter'];
                    if (mm) { mm.update(100); }
                    this.sys.connMgr.addConn({ from: 'multimeter_wire_v', to: 'tr1_wire_e', type: 'wire' });
                    this.sys.connMgr.addConn({ from: 'multimeter_wire_com', to: 'tr1_wire_b', type: 'wire' });
                    this.sys.redrawAll();
                },
                check() {
                    const mm = this.sys.comps['multimeter'];
                    return mm && mm.mode === 'DIODE' && mm.value > 50
                        && _sameCluster(this.sys, 'multimeter_wire_v', 'tr1_wire_e')
                        && _sameCluster(this.sys, 'multimeter_wire_com', 'tr1_wire_b');
                },
            },
            {
                msg: '4. 红表笔接 B，黑表笔接 C\n测量 BC 正向压降（应显示约 0.7V）',
                mode: 'check',
                act() {
                    _disconnectMultimeter(this.sys);
                    const mm = this.sys.comps['multimeter'];
                    if (mm) { mm.update(0.687); }
                    this.sys.connMgr.addConn({ from: 'multimeter_wire_v', to: 'tr1_wire_b', type: 'wire' });
                    this.sys.connMgr.addConn({ from: 'multimeter_wire_com', to: 'tr1_wire_c', type: 'wire' });
                    this.sys.redrawAll();
                },
                check() {
                    const mm = this.sys.comps['multimeter'];
                    return mm && mm.mode === 'DIODE' && Math.abs(mm.value - 0.687) < 0.1
                        && _sameCluster(this.sys, 'multimeter_wire_v', 'tr1_wire_b')
                        && _sameCluster(this.sys, 'multimeter_wire_com', 'tr1_wire_c');
                },
            },
            {
                msg: '5. 红表笔接 C，黑表笔接 B\n测量 BC 反向（应显示 OL 溢出）',
                mode: 'check',
                act() {
                    _disconnectMultimeter(this.sys);
                    const mm = this.sys.comps['multimeter'];
                    if (mm) { mm.update(100); }
                    this.sys.connMgr.addConn({ from: 'multimeter_wire_v', to: 'tr1_wire_c', type: 'wire' });
                    this.sys.connMgr.addConn({ from: 'multimeter_wire_com', to: 'tr1_wire_b', type: 'wire' });
                    this.sys.redrawAll();
                },
                check() {
                    const mm = this.sys.comps['multimeter'];
                    return mm && mm.mode === 'DIODE' && mm.value > 50
                        && _sameCluster(this.sys, 'multimeter_wire_v', 'tr1_wire_c')
                        && _sameCluster(this.sys, 'multimeter_wire_com', 'tr1_wire_b');
                },
            },
            {
                msg: '6. 红表笔接 C，黑表笔接 E\n测量 CE（应显示 OL 溢出，验证 C-E 间无直接二极管）',
                mode: 'check',
                act() {
                    _disconnectMultimeter(this.sys);
                    const mm = this.sys.comps['multimeter'];
                    this.sys.connMgr.addConn({ from: 'multimeter_wire_v', to: 'tr1_wire_c', type: 'wire' });
                    this.sys.connMgr.addConn({ from: 'multimeter_wire_com', to: 'tr1_wire_e', type: 'wire' });
                    this.sys.redrawAll();
                },
                check() {
                    const mm = this.sys.comps['multimeter'];
                    return mm && mm.mode === 'DIODE' && mm.value > 50
                        && _sameCluster(this.sys, 'multimeter_wire_v', 'tr1_wire_c')
                        && _sameCluster(this.sys, 'multimeter_wire_com', 'tr1_wire_e');
                },
            },
            {
                msg: '7. 将基极偏置电阻接在集电极和基极之间（为三极管提供基极偏置电流），' +
                    '红表笔接 C、黑表笔接 E，可检测到 CE 导通（200K档能测到电阻）',
                mode: 'check',
                act() {
                    const mm = this.sys.comps['multimeter'];
                    if (mm) { mm.mode = 'RES200k'; }
                    this.sys.connMgr.addConn({ from: 'rb_wire_l', to: 'tr1_wire_b', type: 'wire' });
                    this.sys.connMgr.addConn({ from: 'rb_wire_r', to: 'tr1_wire_c', type: 'wire' });
                    this.sys.redrawAll();
                },
                check() {
                    const mm = this.sys.comps['multimeter'];
                    return mm && mm.mode === 'RES200k'
                        && _sameCluster(this.sys, 'multimeter_wire_v', 'tr1_wire_c')
                        && _sameCluster(this.sys, 'multimeter_wire_com', 'tr1_wire_e')
                        && _sameCluster(this.sys, 'rb_wire_l', 'tr1_wire_b')
                        && _sameCluster(this.sys, 'rb_wire_r', 'tr1_wire_c');
                },
            },
            {
                msg: '8. 测试题：三极管测试',
                mode: 'quiz',
                quizConfig: {
                    question: '用数字万用表二极管档检测 NPN 三极管时，以下检测结果哪个是正常的？',
                    options: [
                        'BE、BC 正向均显示约 0.7V，反向和 CE 均显示 OL',
                        'BE、BC、CE 三个引脚正反向均显示 0.7V',
                        'BE、BC、CE 三个引脚正反向均显示 OL',
                        'BE 正向显示 OL，BC 正向显示 0.7V',
                    ],
                    answer: 0,
                    analysis: 'NPN 三极管的 BE 和 BC 分别是两个 PN 结（二极管），正向导通约 0.7V，反向截止显示 OL。' +
                        'C-E 之间没有直接的 PN 结，正常时正反向均显示 OL。' +
                        '如果在 C-B 间接入偏置电阻使三极管导通，再测 CE 会显示约 0.2V（VCEsat）。',
                },
            },
        ],
    },
    'transistor-mf47-test': {
        id: 'transistor-mf47-test',
        name: '3. 用指针万用表测试三极管',
        steps: [
            {
                msg: '1. 将 MF47 拨到 R×100（×100Ω）档',
                mode: 'check',
                act() {
                    const mf47 = this.sys.comps['mf47-panel'];
                    if (mf47) { mf47.group.visible(true); mf47.group.listening(true); mf47.setRange('OHM100'); }
                    _disconnectMF47(this.sys);
                    _disconnectAll(this.sys);
                },
                check() {
                    const mf47 = this.sys.comps['mf47-panel'];
                    return mf47 && mf47._rangeId === 'OHM100' && mf47.group.visible() === true;
                },
            },
            {
                msg: '2. 黑表笔（COM/+）接 B，红表笔（V/−）接 E\n测 BE 正向电阻（应指示较小阻值，约 1k～2kΩ）',
                mode: 'check',
                act() {
                    _disconnectMF47(this.sys);
                    this.sys.connMgr.addConn({ from: 'mf47-panel_wire_COM', to: 'tr1_wire_b', type: 'wire' });
                    this.sys.connMgr.addConn({ from: 'mf47-panel_wire_v', to: 'tr1_wire_e', type: 'wire' });
                    this.sys.redrawAll();
                },
                check() {
                    const mf47 = this.sys.comps['mf47-panel'];
                    const vBE = this.sys.getVoltageBetween('tr1_wire_b', 'tr1_wire_e');
                    return mf47 && mf47._range?.group === 'OHM'
                        && _sameCluster(this.sys, 'mf47-panel_wire_COM', 'tr1_wire_b')
                        && _sameCluster(this.sys, 'mf47-panel_wire_v', 'tr1_wire_e')
                        && vBE !== undefined && vBE > 0.5;
                },
            },
            {
                msg: '3. 黑表笔接 E，红表笔接 B\n测 BE 反向电阻（应指示 ∞，表针不动）',
                mode: 'check',
                act() {
                    _disconnectMF47(this.sys);
                    this.sys.connMgr.addConn({ from: 'mf47-panel_wire_COM', to: 'tr1_wire_e', type: 'wire' });
                    this.sys.connMgr.addConn({ from: 'mf47-panel_wire_v', to: 'tr1_wire_b', type: 'wire' });
                    this.sys.redrawAll();
                },
                check() {
                    const mf47 = this.sys.comps['mf47-panel'];
                    const vBE = this.sys.getVoltageBetween('tr1_wire_b', 'tr1_wire_e');
                    return mf47 && mf47._range?.group === 'OHM'
                        && _sameCluster(this.sys, 'mf47-panel_wire_COM', 'tr1_wire_e')
                        && _sameCluster(this.sys, 'mf47-panel_wire_v', 'tr1_wire_b')
                        && vBE !== undefined && vBE < 0.1;
                },
            },
            {
                msg: '4. 黑表笔（COM/+）接 B，红表笔（V/−）接 C\n测 BC 正向电阻（应指示较小阻值，约 1k～2kΩ）',
                mode: 'check',
                act() {
                    _disconnectMF47(this.sys);
                    this.sys.connMgr.addConn({ from: 'mf47-panel_wire_COM', to: 'tr1_wire_b', type: 'wire' });
                    this.sys.connMgr.addConn({ from: 'mf47-panel_wire_v', to: 'tr1_wire_c', type: 'wire' });
                    this.sys.redrawAll();
                },
                check() {
                    const mf47 = this.sys.comps['mf47-panel'];
                    const vBC = this.sys.getVoltageBetween('tr1_wire_b', 'tr1_wire_c');
                    return mf47 && mf47._range?.group === 'OHM'
                        && _sameCluster(this.sys, 'mf47-panel_wire_COM', 'tr1_wire_b')
                        && _sameCluster(this.sys, 'mf47-panel_wire_v', 'tr1_wire_c')
                        && vBC !== undefined && vBC > 0.5;
                },
            },
            {
                msg: '5. 黑表笔接 C，红表笔接 B\n测 BC 反向电阻（应指示 ∞，表针不动）',
                mode: 'check',
                act() {
                    _disconnectMF47(this.sys);
                    this.sys.connMgr.addConn({ from: 'mf47-panel_wire_COM', to: 'tr1_wire_c', type: 'wire' });
                    this.sys.connMgr.addConn({ from: 'mf47-panel_wire_v', to: 'tr1_wire_b', type: 'wire' });
                    this.sys.redrawAll();
                },
                check() {
                    const mf47 = this.sys.comps['mf47-panel'];
                    const vBC = this.sys.getVoltageBetween('tr1_wire_b', 'tr1_wire_c');
                    return mf47 && mf47._range?.group === 'OHM'
                        && _sameCluster(this.sys, 'mf47-panel_wire_COM', 'tr1_wire_c')
                        && _sameCluster(this.sys, 'mf47-panel_wire_v', 'tr1_wire_b')
                        && vBC !== undefined && vBC < 0.1;
                },
            },
            {
                msg: '6. 黑表笔接 C，红表笔接 E\n测 CE 电阻（应指示 ∞，CE 间无直接 PN 结）',
                mode: 'check',
                act() {
                    _disconnectMF47(this.sys);
                    this.sys.connMgr.addConn({ from: 'mf47-panel_wire_COM', to: 'tr1_wire_c', type: 'wire' });
                    this.sys.connMgr.addConn({ from: 'mf47-panel_wire_v', to: 'tr1_wire_e', type: 'wire' });
                    this.sys.redrawAll();
                },
                check() {
                    const mf47 = this.sys.comps['mf47-panel'];
                    return mf47 && mf47._range?.group === 'OHM'
                        && _sameCluster(this.sys, 'mf47-panel_wire_COM', 'tr1_wire_c')
                        && _sameCluster(this.sys, 'mf47-panel_wire_v', 'tr1_wire_e');
                },
            },
            {
                msg: '7. 将 MF47 拨到 ×100 档，基极偏置电阻接在集电极和基极之间，' +
                    '黑表笔接 C、红表笔接 E，测得 CE 导通阻值（指针偏转，阻值很小）',
                mode: 'check',
                act() {
                    const mf47 = this.sys.comps['mf47-panel'];
                    if (mf47) { mf47.setRange('OHM100'); }
                    this.sys.connMgr.addConn({ from: 'rb_wire_l', to: 'tr1_wire_b', type: 'wire' });
                    this.sys.connMgr.addConn({ from: 'rb_wire_r', to: 'tr1_wire_c', type: 'wire' });
                    this.sys.redrawAll();
                },
                check() {
                    const mf47 = this.sys.comps['mf47-panel'];
                    const vCE = this.sys.getVoltageBetween('tr1_wire_c', 'tr1_wire_e');
                    return mf47 && mf47._range?.group === 'OHM'
                        && _sameCluster(this.sys, 'mf47-panel_wire_COM', 'tr1_wire_c')
                        && _sameCluster(this.sys, 'mf47-panel_wire_v', 'tr1_wire_e')
                        && _sameCluster(this.sys, 'rb_wire_l', 'tr1_wire_b')
                        && _sameCluster(this.sys, 'rb_wire_r', 'tr1_wire_c')
                        && vCE !== undefined && vCE > 0 && vCE < 1.5;
                },
            },
            {
                msg: '8. 测试题：指针万用表检测三极管',
                mode: 'quiz',
                quizConfig: {
                    question: '用指针万用表 R×100 档检测 NPN 三极管，以下描述正确的是？',
                    options: [
                        '黑表笔（COM/+）接 B，红表笔（V/−）接 E 时指针偏转较大，指示较小阻值',
                        '红表笔（V/−）接 B，黑表笔（COM/+）接 E 时指针偏转较大，指示较小阻值',
                        'CE 之间正反测量均能测得固定阻值',
                        '三极管的三个引脚正反向测量结果完全相同',
                    ],
                    answer: 0,
                    analysis: '指针万用表电阻档内部电池正极接黑表笔（COM），负极接红表笔（V）。' +
                        'NPN 三极管 BE 是一个 PN 结，黑笔接 B、红笔接 E 时正偏导通，指针偏转至较小阻值。' +
                        'CE 之间无直接 PN 结，正反向均指示 ∞。',
                },
            },
        ],
    },
};

export const componentConfigs = [
    { Class: DCPower, id: 'psu_b', x: 10, y: 110, voltage: 5, isOn: false },
    { Class: DCPower, id: 'psu_c', x: 510, y: 20, voltage: 24, isOn: false },
    { Class: Ground, id: 'gnd_b', x: 80, y: 380 },
    { Class: Ground, id: 'gnd_c', x: 510, y: 260 },
    { Class: RealResistor, id: 'rb', x: 400, y: 480, value: 2150, rotation: -90 },
    { Class: RealTransistor, id: 'tr1', x: 550, y: 640 },
    { Class: VoltageRelay, id: 'k1', x: 630, y: 480, rotation: -90 },
    { Class: Ground, id: 'gnd', x: 600, y: 800 },

    { Class: Multimeter, id: 'multimeter', x: 850, y: 30, scale: 0.9, visible: false },
    { Class: MF47Multimeter, id: 'mf47-panel', x: 10, y: 510, scale: 0.8, visible: false },
    { Class: SignalGenerator, id: 'sg', x: 80, y: 400, visible: false },
    { Class: ProcessCalibrator, id: 'cali', x: 550, y: 400, visible: false },
    { Class: Oscilloscope_tri, id: 'osc3', x: 950, y: 60, visible: false },
];

function _doPresetWiring(sys) {
    sys.conns = [];
    const presetConns = [
        // 基极回路：5V → rb → MF47(mA) → B
        { from: 'psu_b_wire_p', to: 'rb_wire_l', type: 'wire' },
        { from: 'rb_wire_r', to: 'mf47-panel_wire_mA', type: 'wire' },
        { from: 'mf47-panel_wire_COM', to: 'tr1_wire_b', type: 'wire' },
        { from: 'psu_b_wire_n', to: 'gnd_b_wire_gnd', type: 'wire' },
        // 集电极回路：24V → 继电器 → DMM(mA) → C → E → GND
        { from: 'psu_c_wire_p', to: 'k1_wire_r', type: 'wire' },
        { from: 'k1_wire_l', to: 'multimeter_wire_ma', type: 'wire' },
        { from: 'multimeter_wire_com', to: 'tr1_wire_c', type: 'wire' },
        { from: 'tr1_wire_e', to: 'gnd_wire_gnd', type: 'wire' },
        { from: 'psu_c_wire_n', to: 'gnd_c_wire_gnd', type: 'wire' },
    ];
    presetConns.forEach(c => sys.connMgr.addConn(c));
    sys.redrawAll();
}

function _disconnectMultimeter(sys) {
    const ports = ['multimeter_wire_v', 'multimeter_wire_ma', 'multimeter_wire_com'];
    const existing = sys.conns.filter(c => ports.includes(c.from) || ports.includes(c.to));
    existing.forEach(c => sys.connMgr.removeConn(c));
    sys.redrawAll();
}

function _disconnectMF47(sys) {
    const ports = ['mf47-panel_wire_v', 'mf47-panel_wire_mA', 'mf47-panel_wire_COM'];
    const existing = sys.conns.filter(c => ports.includes(c.from) || ports.includes(c.to));
    existing.forEach(c => sys.connMgr.removeConn(c));
    sys.redrawAll();
}

function _disconnectAll(sys) {
    const keep = ['mf47-panel_wire_v', 'mf47-panel_wire_mA', 'mf47-panel_wire_COM'];
    const all = [...sys.conns];
    all.forEach(c => {
        const bothSide = [c.from, c.to];
        if (!keep.some(k => bothSide.includes(k))) {
            sys.connMgr.removeConn(c);
        }
    });
    sys.redrawAll();
}

function _sameCluster(sys, portA, portB) {
    const map = sys.voltageSolver?.portToCluster;
    if (!map) return false;
    const cA = map.get(portA);
    const cB = map.get(portB);
    return cA !== undefined && cA === cB;
}

export function initSlider(sys) {
    const existing = document.getElementById('rbSliderContainer');
    if (existing) existing.remove();

    const toolbar = document.getElementById('toolbar');
    const container = document.createElement('div');
    container.id = 'rbSliderContainer';
    container.style.cssText = 'display:inline-flex;align-items:center;gap:6px;margin-left:12px;';
    container.innerHTML = '\
        <span style="font-size:12px;font-weight:bold;color:white;">基极电阻:</span>\
        <input type="range" id="rbSlider" min="430" max="8600" value="2150" style="width:160px;">\
        <span id="rbDisplay" style="font-size:12px;min-width:60px;color:white;">2.2 kΩ</span>\
    ';
    toolbar.appendChild(container);

    const slider = document.getElementById('rbSlider');
    const display = document.getElementById('rbDisplay');

    slider.addEventListener('input', () => {
        const val = parseFloat(slider.value) || 2150;
        display.textContent = val >= 1000 ? (val / 1000).toFixed(1) + ' kΩ' : val + ' Ω';
        _updateResistorValue(sys, val);
        _updateMeters(sys, val);
    });

    const r = sys.comps['rb'];
    if (r && r.onConfigUpdate) {
        const origOnConfigUpdate = r.onConfigUpdate.bind(r);
        r.onConfigUpdate = function(cfg) {
            origOnConfigUpdate(cfg);
            r._refreshCache();
            _syncSliderFromResistor(sys);
            const val = r.currentResistance || r.value;
            _updateMeters(sys, val);
        };
    }
}

function _showMeters(sys) {
    const mm = sys.comps['multimeter'];
    if (mm) { mm.group.visible(true); mm.group.listening(true); mm.mode = 'MA'; mm._updateAngleByMode(); mm.update(0); }
    const mf47 = sys.comps['mf47-panel'];
    if (mf47) { mf47.group.visible(true); mf47.group.listening(true); mf47.setRange('MA50'); }
}

export function applyAllPresets() {
    _doPresetWiring(this.sys);
    _showMeters(this.sys);
}

export async function applyStartSystem() {
    const sys = this.sys;
    _doPresetWiring(sys);
    _showMeters(sys);
    const psuC = sys.comps['psu_c'];
    if (psuC) { psuC.isOn = true; psuC.voltage = 24; psuC.update(); }
    const psuB = sys.comps['psu_b'];
    if (psuB) { psuB.isOn = true; psuB.voltage = 5; psuB.update(); }

    _updateResistorValue(sys, 2150);
    _syncSliderFromResistor(sys);
    _updateMeters(sys, 2150);
}

export function fiveStep() {
    const sys = this.sys;
    const slider = document.getElementById('rbSlider');
    const display = document.getElementById('rbDisplay');
    if (!slider) return;

    const current = parseFloat(slider.value) || 2150;

    let nextVal = RB_STEPS[0];
    for (const s of RB_STEPS) {
        if (Math.abs(s - current) < 1) {
            const idx = RB_STEPS.indexOf(s);
            nextVal = RB_STEPS[(idx + 1) % RB_STEPS.length];
            break;
        }
    }

    slider.value = nextVal;
    display.textContent = nextVal >= 1000 ? (nextVal / 1000).toFixed(1) + ' kΩ' : nextVal + ' Ω';
    _updateResistorValue(sys, nextVal);
    _updateMeters(sys, nextVal);
}