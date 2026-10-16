import { WT1226 } from '../components/WT1226.js';
import { CoolingSys } from '../components/CoolingSys.js';
import { Multimeter } from '../components/Multimeter.js';
import { MF47Multimeter } from '../components/MF47Multimeter.js';
import { Oscilloscope_tri } from '../components/Osc_tri.js';
import { SignalGenerator } from '../components/SignalGenerator.js';
import { ProcessCalibrator } from '../components/ProcessCalibrator.js';
import { ElecMeter } from '../components/ElecMeter.js';

export const FAULT_CONFIGS = {};

export const PROJECT_WORKFLOWS = {
    'temp-relay-test': {
        id: 'temp-relay-test',
        name: '温度继电器功能测试',
        steps: [
            {
                msg: '步骤1：测试温度继电器当前的上下限，可通过参数配置查看，打开温控器测试开关。',
                mode: 'check',
                async act() {
                    const sc = document.getElementById('tempSliderContainer');
                    if (sc) sc.style.display = 'flex';
                    await new Promise(r => setTimeout(r, 500));
                },
                check() {
                    const sc = document.getElementById('tempSliderContainer');
                    return sc && sc.style.display !== 'none';
                },
            },
            {
                msg: '步骤2：将温度调到大于上限，温控器开关NO闭合，NC断开。',
                mode: 'check',
                async act() {
                    const slider = document.getElementById('tempSlider');
                    const display = document.getElementById('tempDisplay');
                    if (slider && display) {
                        slider.value = '5';
                        display.textContent = '5 °C';
                        const wt = this.sys.comps['wt'];
                        if (wt && wt.update) wt.update(5);
                    }
                    await new Promise(r => setTimeout(r, 1500));
                },
                check() {
                    const wt = this.sys.comps['wt'];
                    const slider = document.getElementById('tempSlider');
                    if (!wt || !slider) return false;
                    const val = parseFloat(slider.value);
                    return val > wt.highSet && !wt.isEnergized;
                },
            },
            {
                msg: '步骤3：将温度调到低于下限，温控器NO断开，NC恢复闭合。',
                mode: 'check',
                async act() {
                    const slider = document.getElementById('tempSlider');
                    const display = document.getElementById('tempDisplay');
                    if (slider && display) {
                        slider.value = '-5';
                        display.textContent = '-5 °C';
                        const wt = this.sys.comps['wt'];
                        if (wt && wt.update) wt.update(-5);
                    }
                    await new Promise(r => setTimeout(r, 1500));
                },
                check() {
                    const wt = this.sys.comps['wt'];
                    const slider = document.getElementById('tempSlider');
                    if (!wt || !slider) return false;
                    const val = parseFloat(slider.value);
                    return val < wt.lowSet && wt.isEnergized;
                },
            },
            {
                msg: '步骤4：改变温度下限值到-8摄氏度。',
                mode: 'check',
                async act() {
                    const wt = this.sys.comps['wt'];
                    if (wt) {
                        wt.setPoint = 40;
                        wt.update(wt.temperature);
                    }
                    await new Promise(r => setTimeout(r, 1500));
                },
                check() {
                    const wt = this.sys.comps['wt'];
                    return wt && Math.abs(wt.lowSet - (-8)) < 0.5;
                },
            },
            {
                msg: '步骤5：通过幅差旋钮，将幅差调为3，使得温度上限变为-5摄氏度。再次进行温控器测试，然后关闭测试开关。',
                mode: 'check',
                async act() {
                    const wt = this.sys.comps['wt'];
                    if (wt) {
                        wt.differential = 40;
                        wt.update(wt.temperature);
                    }
                    await new Promise(r => setTimeout(r, 1500));
                },
                check() {
                    const wt = this.sys.comps['wt'];
                    return wt && Math.abs(wt.highSet - (-5)) < 0.5;
                },
            },
            {
                msg: '步骤6：将温控器NO、COM与制冷系统控制端点连接，将控制开关转为REMOTE，观察自动双位控制过程，温度始终保持在【-8，-5】区间。',
                mode: 'check',
                async act() {
                    const sc = document.getElementById('tempSliderContainer');
                    if (sc) sc.style.display = 'none';
                    await new Promise(r => setTimeout(r, 500));                    
                    _autoWire(sys);
                    await new Promise(r => setTimeout(r, 2000));
                    const cs = this.sys.comps['cs'];
                    if (cs) {
                        cs.temperature = 0;
                        cs.mode = 'remote';
                        cs.running = true;
                        cs.targetPower = 1.0;
                    }
                    await new Promise(r => setTimeout(r, 15000));
                },
                check() {
                    const cs = this.sys.comps['cs'];
                    const c = (a, b) => this.sys.isPortConnected(a, b);
                    const wired = c('wt_wire_NO', 'cs_wire_l') && c('wt_wire_COM', 'cs_wire_r');
                    if (!wired || !cs || cs.mode !== 'remote') return false;
                    return cs.temperature >= -8.5 && cs.temperature <= -6.5;
                },
            },
            {
                msg: '步骤7：温度继电器测试题。',
                mode: 'quiz',
                quizConfig: {
                    question: '温度继电器双位控制中，切换差（幅差）的作用是什么？',
                    options: [
                        '防止继电器在设定点附近频繁通断',
                        '提高温度控制精度',
                        '加快系统响应速度',
                        '降低能耗',
                    ],
                    answer: 0,
                    analysis: '切换差（滞回）使继电器的接通和断开发生在不同的温度值，避免在设定点附近因微小温度波动导致继电器频繁通断，从而保护触点和负载设备。本系统中切换差为 3°C（-8°C 断开，-5°C 接通）。',
                },
            },
        ],
    },
};

export const componentConfigs = [
    { Class: WT1226, id: 'wt', x: 350, y: 130, visible: true },
    { Class: CoolingSys, id: 'cs', x: 850, y: 130, initTemp: 0, visible: true },
    // { Class: ACPower, id: 'ac', x: 50, y: 50, vRms: 220, freq: 50, isOn: false, visible: false },

    { Class: Multimeter, id: 'multimeter', x: 920, y: 100, visible: false },
    { Class: MF47Multimeter, id: 'mf47-panel', x: 1050, y: 150, visible: false },
    { Class: Oscilloscope_tri, id: 'osc', x: 50, y: 50, visible: false },
    { Class: SignalGenerator, id: 'sg', x: 50, y: 50, visible: false },
    { Class: ProcessCalibrator, id: 'cali', x: 50, y: 50, visible: false },
    { Class: ElecMeter, id: 'elecmeter', x: 50, y: 50, visible: false },
];

function _autoWire(sys) {
    sys.conns.length = 0;
    const cons = [
        { from: 'wt_wire_NO', to: 'cs_wire_l', type: 'wire' },
        { from: 'wt_wire_COM', to: 'cs_wire_r', type: 'wire' },
    ];
    cons.forEach(c => sys.connMgr.addConn(c));
    sys.redrawAll();
}

export function initSlider(sys) {
    const toolbar = document.getElementById('toolbar');
    const sliderDiv = document.createElement('div');
    sliderDiv.id = 'tempSliderContainer';
    sliderDiv.style.cssText = 'display:none;align-items:center;gap:6px;margin-left:12px;';
    sliderDiv.innerHTML = [
        '<span style="font-size:12px;font-weight:bold;color:#e0d8c8;">\u6e29\u5ea6:</span>',
        '<input type="range" id="tempSlider" min="-30" max="30" value="0" style="width:140px;">',
        '<span id="tempDisplay" style="font-size:12px;min-width:50px;color:#e0d8c8;">0 \u00b0C</span>',
    ].join('');
    toolbar.appendChild(sliderDiv);

    const slider = document.getElementById('tempSlider');
    const display = document.getElementById('tempDisplay');
    slider.addEventListener('input', () => {
        const temp = parseFloat(slider.value);
        display.textContent = temp.toFixed(0) + ' \u00b0C';
        const wt = sys.comps['wt'];
        if (wt && wt.update) wt.update(temp);
    });
}

export function applyAllPresets() {
    const sys = this && this.sys ? this.sys : window.sys;
    if (!sys) return;
    _autoWire(sys);
}

export async function applyStartSystem() {
    const sys = this && this.sys ? this.sys : window.sys;
    if (!sys) return;
    _autoWire(sys);
    const cs = sys.comps['cs'];
    if (cs) {
        cs.temperature = 0;
        cs.mode = 'remote';
        cs.targetPower = 1.0;
        cs.running = true;
    }
}

export function fiveStep() {
    const sys = this.sys;
    const cs = sys.comps['cs'];
    if (!cs) return;
    if (cs.running) {
        cs.running = false;
        cs.targetPower = 0;
    } else {
        cs.running = true;
        cs.targetPower = 1.0;
    }
}
