// MF47 型指针式万用表内部电路仿真项目
// 展示经典万用表四种测量模式（直流电流/直流电压/交流电压/电阻）的
// 磁电式表头 + 电阻分压/分流 + 二极管整流的完整工作原理

import { Oscilloscope_tri } from '../components/Osc_tri.js';
import { SignalGenerator } from '../components/SignalGenerator.js';
import { Multimeter } from '../components/Multimeter.js';
import { AmpMeter } from '../components/AmpMeter.js';
import { ProcessCalibrator } from '../components/ProcessCalibrator.js';

import { MagnetoelectricAmmeter } from '../components/MagnetoelectricAmmeter.js';
import { Resistor } from '../components/Resistor.js';
import { RealResistor } from '../components/RealResistor.js';
import { Diode } from '../components/Diode.js';
import { DCPower } from '../components/DCPower.js';
import { Ground } from '../components/Gnd.js';
import { SPDTSwitch } from '../components/SPDTSwitch.js';
import { SP4TSwitch } from '../components/SP4TSwitch.js';
import { UniversalRotarySwitch } from '../components/UniversalRotarySwitch.js';
import { MF47Multimeter } from '../components/MF47Multimeter.js';

export const FAULT_CONFIGS = {};

export const PROJECT_WORKFLOWS = {};

export const componentConfigs = [
    // 五种仪表（初始隐藏）
    { Class: Oscilloscope_tri, id: 'osc3', x: 800, y: 160, visible: false },
    { Class: SignalGenerator, id: 'sg', x: 210, y: 200, visible: false },
    { Class: Multimeter, id: 'multimeter', x: 1350, y: 500, visible: false, scale: 1.2 },
    { Class: AmpMeter, id: 'ampmeter', x: 450, y: 100, visible: false },
    { Class: ProcessCalibrator, id: 'cali', x: 600, y: 100, visible: false },

    // 表头（磁电式电流表 46.2μA / 5kΩ）
    {
        Class: MagnetoelectricAmmeter, id: 'mf47-head', x: 320, y: 30,
        label: 'MF47', fullScale: 46.2, unit: 'μA', internalR: 5000, damping: 0.65,
        width: 400, height: 400
    },


    // 电阻档电池 + 限流电阻 + 分流电阻
    // 各档位电路：电池(1.5V) → R_series → (R_shunt ‖ R_head=5kΩ) → Rx → GND
    // 条件：Rx=0 时 I_head = 46.2μA（满偏）
    //        Rx=R_mid 时 I_head = 23.1μA（半偏）
    // 结果：R_series + R_eff = R_mid,  R_eff = (R_shunt×5000)/(R_shunt+5000)
    // ×1K: R_mid=20000Ω → R_series=16920Ω, R_shunt=8021Ω
    // ×100: R_mid=2000Ω → R_series=1692Ω, R_shunt=328Ω
    // ×10: R_mid=200Ω → R_series=169Ω, R_shunt=31Ω
    // ×10K 档：9V 电池，无需分流（直接串联即可满足满偏条件）
    // R_mid = R_series + R_head = 194805Ω, 刻度读数 ≈19.5（×10K 后 ≈195kΩ）
    { Class: DCPower, id: 'bat-ohmx10k', x: 1180, y: 240, voltage: 9, isOn: true },
    { Class: Resistor, id: 'r-ohmx10k', x: 830, y: 540, value: 190000 },
    { Class: DCPower, id: 'bat-ohm', x: 920, y: 220, voltage: 1.5, isOn: true },
    { Class: Resistor, id: 'r-ohmx1k', x: 830, y: 620, value: 16920 },
    { Class: Resistor, id: 'r-ohmx100', x: 830, y: 700, value: 1692 },
    { Class: Resistor, id: 'r-ohmx10', x: 830, y: 780, value: 169 },
    { Class: Resistor, id: 'r-sh-ohmx1k', x: 720, y: 580, value: 8021, rotation: 90 },
    { Class: Resistor, id: 'r-sh-ohmx100', x: 660, y: 660, value: 328, rotation: 90 },
    { Class: Resistor, id: 'r-sh-ohmx10', x: 600, y: 740, value: 31, rotation: 90 },


    { Class: MF47Multimeter, id: 'mf47-panel', x: 1450, y: 60, rangeMode: 'ACV_500' },

    // 接地
    // { Class: Ground, id: 'gnd-ref', x: 680, y: 900 },

    // 被测电阻 Rx（阻值由滑块调节）
    { Class: RealResistor, id: 'rx', x: 1100, y: 650, value: 0.01, label: 'Rx',rotation:-90,scale:1.5 },
];

const RANGE_MAP = {
    x10: { multiplier: 10, seriesR: 'r-ohmx10', shuntR: 'r-sh-ohmx10' },
    x100: { multiplier: 100, seriesR: 'r-ohmx100', shuntR: 'r-sh-ohmx100' },
    x1k: { multiplier: 1000, seriesR: 'r-ohmx1k', shuntR: 'r-sh-ohmx1k' },
    x10k: { multiplier: 10000, seriesR: 'r-ohmx10k', shuntR: null },
};

function _getMaxResistance(rangeKey) {
    return RANGE_MAP[rangeKey].multiplier * 50;
}

function _formatResistance(val) {
    if (val >= 1000) return (val / 1000).toFixed(1) + ' kΩ';
    return val.toFixed(0) + ' Ω';
}

function _updateRxValue(sys, val) {
    const rx = sys.comps.rx;
    if (!rx) return;
    rx.currentResistance = val;
    if (rx.label) {
        rx.label.text(_formatResistance(val) + ' ');
    }
    rx._refreshCache();
    sys.requestRedraw();
}

function _rewireForRange(sys, rangeKey) {
    sys.conns = [];
    const info = RANGE_MAP[rangeKey];
    let conns;
    if (rangeKey === 'x10k') {
        conns = [
            { from: 'bat-ohmx10k_wire_n', to: 'mf47-head_wire_r', type: 'wire' },
            { from: 'mf47-head_wire_l', to: 'r-ohmx10k_wire_l', type: 'wire' },
            { from: 'r-ohmx10k_wire_r', to: 'rx_wire_l', type: 'wire' },
            { from: 'rx_wire_r', to: 'bat-ohmx10k_wire_p', type: 'wire' },
        ];
    } else {
        const sR = info.seriesR;
        const shR = info.shuntR;
        conns = [
            { from: 'bat-ohm_wire_n', to: 'mf47-head_wire_r', type: 'wire' },
            { from: shR + '_wire_l', to: 'mf47-head_wire_r', type: 'wire' },
            { from: shR + '_wire_r', to: 'mf47-head_wire_l', type: 'wire' },
            { from: shR + '_wire_r', to: sR + '_wire_l', type: 'wire' },
            { from: sR + '_wire_r', to: 'rx_wire_l', type: 'wire' },
            { from: 'rx_wire_r', to: 'bat-ohm_wire_p', type: 'wire' },
        ];
    }
    conns.forEach(c => sys.connMgr.addConn(c));
    sys.redrawAll();
}

export function initSlider(sys) {
    const toolbar = document.getElementById('toolbar');

    const rangeDiv = document.createElement('div');
    rangeDiv.id = 'rangeContainer';
    rangeDiv.style.cssText = 'display:inline-flex;align-items:center;gap:4px;margin-left:8px;';
    rangeDiv.innerHTML = '\
        <span style="font-size:12px;font-weight:bold;color:white;">量程:</span>\
        <select id="rangeSelect" style="padding:3px;border-radius:4px;">\
            <option value="x10" selected>×10</option>\
            <option value="x100">×100</option>\
            <option value="x1k">×1K</option>\
            <option value="x10k">×10K</option>\
        </select>\
    ';
    toolbar.appendChild(rangeDiv);

    const sliderDiv = document.createElement('div');
    sliderDiv.id = 'rxSliderContainer';
    sliderDiv.style.cssText = 'display:inline-flex;align-items:center;gap:6px;margin-left:12px;';
    sliderDiv.innerHTML = '\
        <span style="font-size:12px;font-weight:bold;color:white;">Rx:</span>\
        <input type="range" id="rxSlider" min="0" max="500" value="0" style="width:160px;">\
        <span id="rxDisplay" style="font-size:12px;min-width:70px;color:white;">0 Ω</span>\
    ';
    toolbar.appendChild(sliderDiv);

    const rangeSelect = document.getElementById('rangeSelect');
    const rxSlider = document.getElementById('rxSlider');
    const rxDisplay = document.getElementById('rxDisplay');

    rangeSelect.addEventListener('change', () => {
        const range = rangeSelect.value;
        const maxVal = _getMaxResistance(range);
        rxSlider.max = maxVal;
        rxSlider.value = 0;
        rxDisplay.textContent = '0 Ω';
        _updateRxValue(sys, 0);
        sys.conns = [];
        sys.redrawAll();
        // _rewireForRange(sys, range);
    });

    rxSlider.addEventListener('input', () => {
        const val = parseFloat(rxSlider.value);
        rxDisplay.textContent = _formatResistance(val);
        _updateRxValue(sys, val);
    });

}

export function applyAllPresets() {
    const sys = this.sys;
    const rangeSelect = document.getElementById('rangeSelect');
    const range = rangeSelect ? rangeSelect.value : 'x10';
    _rewireForRange(sys, range);
}

export async function applyStartSystem() {
    const sys = this.sys;
    const bat = sys.comps['bat-ohmx10k'];
    if (bat && bat.setVoltage) bat.setVoltage(9);
    const bat2 = sys.comps['bat-ohm'];
    if (bat2 && bat2.setVoltage) bat2.setVoltage(1.5);
    const rangeSelect = document.getElementById('rangeSelect');
    const range = rangeSelect ? rangeSelect.value : 'x10';
    _rewireForRange(sys, range);
}

export function fiveStep() {
    const sys = this.sys;
    const rangeSelect = document.getElementById('rangeSelect');
    const rxSlider = document.getElementById('rxSlider');
    const rxDisplay = document.getElementById('rxDisplay');
    if (!rangeSelect || !rxSlider) return;

    const range = rangeSelect.value;
    const maxVal = _getMaxResistance(range);
    const steps = [0, maxVal * 0.2, maxVal * 0.4, maxVal * 0.6, maxVal * 0.8, maxVal];
    const current = parseFloat(rxSlider.value) || 0;

    let nextVal = steps[0];
    for (const s of steps) {
        if (Math.abs(s - current) < 1) {
            const idx = steps.indexOf(s);
            nextVal = steps[(idx + 1) % steps.length];
            break;
        }
    }

    rxSlider.value = nextVal;
    rxDisplay.textContent = _formatResistance(nextVal);
    _updateRxValue(sys, nextVal);
}
