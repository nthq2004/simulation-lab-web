// 三相异步电动机功能测试仿真工程

import { ACPower3P } from '../components/ACPower3P.js';
import { InductionMotor } from '../components/InductionMotor.js';
import { Multimeter } from '../components/Multimeter.js';
import { MF47Multimeter } from '../components/MF47Multimeter.js';
import { Oscilloscope_tri } from '../components/Osc_tri.js';
import { SignalGenerator } from '../components/SignalGenerator.js';
import { ProcessCalibrator } from '../components/ProcessCalibrator.js';
import { ElecMeter } from '../components/ElecMeter.js';
import { DCPower } from '../components/DCPower.js';
import { TsCurveDisplay } from '../components/TsCurveDisplay.js';

export const FAULT_CONFIGS = {};

export const PROJECT_WORKFLOWS = {
    'motor-starting': {
        id: 'motor-starting',
        name: '1. 三相异步电机运行',
        steps: [
            {
                msg: '第 1 步：将三相电源 U-V-W 分别连接至电动机 U1-V1-W1 端子，并将电动机接成 Y 形（U2-V2-W2 短接）。',
                mode: 'check',
                async act() {
                    await new Promise(r => setTimeout(r, 500));
                    _autoWire(this.sys, 'motor-starting');
                    await new Promise(r => setTimeout(r, 500));
                },
                check() {
                    const c = (a, b) => this.sys.isPortConnected(a, b);
                    return c('ac_wire_u', 'im01_wire_u1')
                        && c('ac_wire_v', 'im01_wire_v1')
                        && c('ac_wire_w', 'im01_wire_w1')
                        && c('im01_wire_u2', 'im01_wire_v2')
                        && c('im01_wire_u2', 'im01_wire_w2');
                },
            },
            {
                msg: '第 2 步：开启三相电源（220V / 50Hz），观察电动机起动过程和面板显示的起动电流。',
                mode: 'check',
                async act() {
                    await new Promise(r => setTimeout(r, 500));
                    const ac = this.sys.comps['ac'];
                    if (ac) ac.onConfigUpdate({ vRms: 220, freq: 50, isOn: true, phaseSeq: 'pos' });
                    await new Promise(r => setTimeout(r, 500));
                },
                check() {
                    const ac = this.sys.comps['ac'];
                    return ac && ac.isOn;
                },
            },
            {
                msg: '第 3 步：将负载转矩调至 60.0 N·m，观察转速和电流随负载增加的变化。',
                mode: 'check',
                async act() {
                    await new Promise(r => setTimeout(r, 500));
                    const slider = document.getElementById('torqueSlider');
                    if (slider) { slider.value = '60'; slider.dispatchEvent(new Event('input')); }
                    await new Promise(r => setTimeout(r, 500));
                },
                check() {
                    const motor = this.sys.comps['im01'];
                    return motor && Math.abs(motor.loadTorque - 60) < 3;
                },
            },
            {
                msg: '第 4 步：关闭三相电源，电动机停机。',
                mode: 'check',
                async act() {
                    await new Promise(r => setTimeout(r, 500));
                    const ac = this.sys.comps['ac'];
                    if (ac) ac.onConfigUpdate({ isOn: false });
                    await new Promise(r => setTimeout(r, 500));
                },
                check() {
                    const ac = this.sys.comps['ac'];
                    return ac && !ac.isOn;
                },
            },
            {
                msg: '第 5 步：三相异步电机起动知识',
                mode: 'quiz',
                quizConfig: {
                    question: '三相异步电动机起动瞬间的起动电流通常为额定电流的多少倍？',
                    options: [
                        '1~2 倍',
                        '4~7 倍',
                        '10~15 倍',
                        '20 倍以上',
                    ],
                    answer: 1,
                    analysis: '起动瞬间转子转速为零，转差率 s=1，转子电路阻抗很小，因此起动电流可达额定电流的 4~7 倍。但起动转矩仅为额定转矩的 1~2 倍，这是异步电动机起动的主要特点。',
                },
            },
        ],
    },

    'rotating-field': {
        id: 'rotating-field',
        name: '2. 旋转磁场的性质',
        steps: [
            {
                msg: '第 1 步：接线并开启三相电源（正序 UVW），观察旋转磁场方向（N-S 红色/黑色半圆的旋转方向）。',
                mode: 'check',
                async act() {
                    await new Promise(r => setTimeout(r, 500));
                    _autoWire(this.sys, 'rotating-field');
                    const ac = this.sys.comps['ac'];
                    if (ac) ac.onConfigUpdate({ vRms: 220, freq: 50, isOn: true, phaseSeq: 'pos' });
                    await new Promise(r => setTimeout(r, 500));
                },
                check() {
                    const ac = this.sys.comps['ac'];
                    return ac && ac.isOn && ac.phaseSeq === 'pos';
                },
            },
            {
                msg: '第 2 步：任意调换两根火线的接入顺序（如将 V 相与 W 相对调），重新开启电源，观察旋转磁场方向是否反转。',
                mode: 'check',
                async act() {
                    await new Promise(r => setTimeout(r, 500));
                    const sys = this.sys;
                    const ac = sys.comps['ac'];
                    if (ac) ac.onConfigUpdate({ isOn: false });
                    await new Promise(r => setTimeout(r, 200));
                    sys.conns.length = 0;
                    const cons = [
                        { from: 'ac_wire_u', to: 'im01_wire_u1', type: 'wire' },
                        { from: 'ac_wire_v', to: 'im01_wire_w1', type: 'wire' },
                        { from: 'ac_wire_w', to: 'im01_wire_v1', type: 'wire' },
                        { from: 'im01_wire_u2', to: 'im01_wire_v2', type: 'wire' },
                        { from: 'im01_wire_u2', to: 'im01_wire_w2', type: 'wire' },
                    ];
                    cons.forEach(c => sys.connMgr.addConn(c));
                    sys.redrawAll();
                    await new Promise(r => setTimeout(r, 500));
                },
                check() {
                    const c = (a, b) => this.sys.isPortConnected(a, b);
                    const ac = this.sys.comps['ac'];
                    return ac && ac.isOn
                        && c('ac_wire_v', 'im01_wire_w1')
                        && c('ac_wire_w', 'im01_wire_v1')
                        && !c('ac_wire_v', 'im01_wire_v1')
                        && !c('ac_wire_w', 'im01_wire_w1');
                },
            },
            {
                msg: '第 3 步：恢复正常的接线顺序（U→U1, V→V1, W→W1），并将频率调至 30 Hz，观察旋转磁场转速和转子转速下降。',
                mode: 'check',
                async act() {
                    await new Promise(r => setTimeout(r, 500));
                    const sys = this.sys;
                    sys.conns.length = 0;
                    const cons = [
                        { from: 'ac_wire_u', to: 'im01_wire_u1', type: 'wire' },
                        { from: 'ac_wire_v', to: 'im01_wire_v1', type: 'wire' },
                        { from: 'ac_wire_w', to: 'im01_wire_w1', type: 'wire' },
                        { from: 'im01_wire_u2', to: 'im01_wire_v2', type: 'wire' },
                        { from: 'im01_wire_u2', to: 'im01_wire_w2', type: 'wire' },
                    ];
                    cons.forEach(c => sys.connMgr.addConn(c));
                    const ac = sys.comps['ac'];
                    if (ac) ac.onConfigUpdate({ freq: 30 });
                    sys.redrawAll();
                    await new Promise(r => setTimeout(r, 500));
                },
                check() {
                    const c = (a, b) => this.sys.isPortConnected(a, b);
                    const wireOk = c('ac_wire_u', 'im01_wire_u1')
                               && c('ac_wire_v', 'im01_wire_v1')
                               && c('ac_wire_w', 'im01_wire_w1');
                    const ac = this.sys.comps['ac'];
                    return wireOk && ac && Math.abs(ac.freq - 30) < 0.5;
                },
            },
            {
                msg: '第 4 步：将频率调至 60 Hz，观察旋转磁场转速和转子转速上升。',
                mode: 'check',
                async act() {
                    await new Promise(r => setTimeout(r, 500));
                    const ac = this.sys.comps['ac'];
                    if (ac) ac.onConfigUpdate({ freq: 60 });
                    await new Promise(r => setTimeout(r, 500));
                },
                check() {
                    const ac = this.sys.comps['ac'];
                    return ac && Math.abs(ac.freq - 60) < 0.5;
                },
            },
            {
                msg: '第 5 步：将频率调回 50 Hz，然后将电机极对数由 2 对极改为 4 对极，观察同步转速变化（1500 → 750 rpm）以及定子齿槽和旋转磁极数目的变化。',
                mode: 'check',
                async act() {
                    await new Promise(r => setTimeout(r, 500));
                    const ac = this.sys.comps['ac'];
                    if (ac) ac.onConfigUpdate({ freq: 50 });
                    await new Promise(r => setTimeout(r, 300));
                    const motor = this.sys.comps['im01'];
                    if (motor) motor.onConfigUpdate({ polePairs: 4 });
                    await new Promise(r => setTimeout(r, 500));
                },
                check() {
                    const ac = this.sys.comps['ac'];
                    const motor = this.sys.comps['im01'];
                    return ac && motor && Math.abs(ac.freq - 50) < 0.5 && motor.polePairs === 4;
                },
            },
            {
                msg: '第 6 步：旋转磁场知识',
                mode: 'quiz',
                quizConfig: {
                    question: '三相异步电动机旋转磁场的转速（同步转速）与什么因素有关？',
                    options: [
                        '仅与电源频率有关',
                        '仅与电机极对数有关',
                        '与电源频率和电机极对数均有关',
                        '与负载大小有关',
                    ],
                    answer: 2,
                    analysis: '同步转速 n₁ = 60f / p（f 为电源频率，p 为极对数）。改变频率可连续调节同步转速实现调速；改变极对数可实现有级调速；旋转磁场方向由相序决定，任意调换两相即可反转。',
                },
            },
        ],
    },

    'characteristic-test': {
        id: 'characteristic-test',
        name: '3. 三相异步电机特性测试',
        steps: [
            {
                msg: '第 1 步：调出数字功率计，将其电流线圈串联接入 U 相（ac_wire_u → I+ → I- → im01_wire_u1），电压线圈 U+ 短接 I+、U- 接 U2（中性点）。V 相和 W 相直连。',
                mode: 'check',
                async act() {
                    await new Promise(r => setTimeout(r, 500));
                    const sys = this.sys;
                    sys.conns.length = 0;
                    const cons = [
                        { from: 'ac_wire_u', to: 'elecmeter_wire_ip', type: 'wire' },
                        { from: 'elecmeter_wire_in', to: 'im01_wire_u1', type: 'wire' },
                        { from: 'elecmeter_wire_up', to: 'elecmeter_wire_ip', type: 'wire' },
                        { from: 'elecmeter_wire_un', to: 'im01_wire_u2', type: 'wire' },
                        { from: 'ac_wire_v', to: 'im01_wire_v1', type: 'wire' },
                        { from: 'ac_wire_w', to: 'im01_wire_w1', type: 'wire' },
                        { from: 'im01_wire_u2', to: 'im01_wire_v2', type: 'wire' },
                        { from: 'im01_wire_u2', to: 'im01_wire_w2', type: 'wire' },
                    ];
                    cons.forEach(c => sys.connMgr.addConn(c));
                    const em = sys.comps['elecmeter'];
                    if (em) em.group.visible(true);
                    const motor = sys.comps['im01'];
                    if (motor) motor.loadTorque = 0;
                    const ac = sys.comps['ac'];
                    if (ac) ac.onConfigUpdate({ vRms: 220, freq: 50, isOn: false, phaseSeq: 'pos' });
                    sys.redrawAll();
                    await new Promise(r => setTimeout(r, 500));
                },
                check() {
                    const c = (a, b) => this.sys.isPortConnected(a, b);
                    const em = this.sys.comps['elecmeter'];
                    return em && em.group.isVisible()
                        && c('ac_wire_u', 'elecmeter_wire_ip')
                        && c('elecmeter_wire_in', 'im01_wire_u1')
                        && c('elecmeter_wire_up', 'elecmeter_wire_ip')
                        && c('elecmeter_wire_un', 'im01_wire_u2')
                        && c('ac_wire_v', 'im01_wire_v1')
                        && c('ac_wire_w', 'im01_wire_w1')
                        && c('im01_wire_u2', 'im01_wire_v2')
                        && c('im01_wire_u2', 'im01_wire_w2');
                },
            },
            {
                msg: '第 2 步：将负载阻力矩设为 200 N·m（大于起动转矩），接通三相电源（220V/50Hz），电机堵转。观察堵转电流和堵转转矩，二者等于起动瞬间的电流和转矩。',
                mode: 'check',
                async act() {
                    await new Promise(r => setTimeout(r, 500));
                    const motor = this.sys.comps['im01'];
                    if (motor) motor.loadTorque = 200;
                    const ac = this.sys.comps['ac'];
                    if (ac) ac.onConfigUpdate({ vRms: 220, freq: 50, isOn: true, phaseSeq: 'pos' });
                    await new Promise(r => setTimeout(r, 500));
                },
                check() {
                    const motor = this.sys.comps['im01'];
                    const ac = this.sys.comps['ac'];
                    return motor && ac && motor.loadTorque >= 200 && ac.isOn;
                },
            },
            {
                msg: '第 3 步：空载实验。将负载阻力矩调为 0 N·m，记录面板显示的空载电流、空载转速。',
                mode: 'check',
                async act() {
                    await new Promise(r => setTimeout(r, 500));
                    const motor = this.sys.comps['im01'];
                    if (motor) motor.loadTorque = 0;
                    const slider = document.getElementById('torqueSlider');
                    if (slider) { slider.value = '0'; slider.dispatchEvent(new Event('input')); }
                    await new Promise(r => setTimeout(r, 500));
                },
                check() {
                    const motor = this.sys.comps['im01'];
                    return motor && Math.abs(motor.loadTorque) < 0.01;
                },
            },
            {
                msg: '第 4 步：额定负载实验。将负载转矩设为 67 N·m，记录面板显示的额定电流、额定转速、额定转矩。',
                mode: 'check',
                async act() {
                    await new Promise(r => setTimeout(r, 500));
                    const motor = this.sys.comps['im01'];
                    if (motor) motor.loadTorque = 67;
                    const slider = document.getElementById('torqueSlider');
                    if (slider) {
                        slider.value = '67';
                        slider.dispatchEvent(new Event('input'));
                    }
                    await new Promise(r => setTimeout(r, 500));
                },
                check() {
                    const motor = this.sys.comps['im01'];
                    return motor && Math.abs(motor.loadTorque - 67) < 0.5;
                },
            },
            {
                msg: '第 5 步：过载能力测试。将负载转矩设为 160 N·m（略小于最大转矩约 165 N·m），观察异步电机仍能稳定运行，体现其过载能力。',
                mode: 'check',
                async act() {
                    await new Promise(r => setTimeout(r, 500));
                    const motor = this.sys.comps['im01'];
                    if (motor) motor.loadTorque = 160;
                    const slider = document.getElementById('torqueSlider');
                    if (slider) {
                        slider.value = '160';
                        slider.dispatchEvent(new Event('input'));
                    }
                    await new Promise(r => setTimeout(r, 500));
                },
                check() {
                    const motor = this.sys.comps['im01'];
                    return motor && Math.abs(motor.loadTorque - 160) < 3;
                },
            },
            {
                msg: '第 6 步：加负载至超过最大转矩。将负载转矩设为 200 N·m（超过最大转矩），观察电机转速迅速下降直至运行中堵转。',
                mode: 'check',
                async act() {
                    await new Promise(r => setTimeout(r, 500));
                    const motor = this.sys.comps['im01'];
                    if (motor) motor.loadTorque = 200;
                    const slider = document.getElementById('torqueSlider');
                    if (slider) {
                        slider.value = '200';
                        slider.dispatchEvent(new Event('input'));
                    }
                    await new Promise(r => setTimeout(r, 500));
                },
                check() {
                    const motor = this.sys.comps['im01'];
                    return motor && Math.abs(motor.loadTorque - 198) < 3;
                },
            },
            {
                msg: '第 7 步：特性测试知识',
                mode: 'quiz',
                quizConfig: {
                    question: '三相异步电动机的堵转电流（起动电流）约为额定电流的多少倍？',
                    options: [
                        '1~2 倍',
                        '4~7 倍',
                        '10~15 倍',
                        '20 倍以上',
                    ],
                    answer: 1,
                    analysis: '起动瞬间转子转速为零，转差率 s=1，转子电路阻抗很小，因此堵转（起动）电流可达额定电流的 4~7 倍。堵转转矩即为起动转矩，通常为额定转矩的 1~2 倍。空载时电流主要为励磁分量，功率因数很低。',
                },
            },
        ],
    },

    'starting-params': {
        id: 'starting-params',
        name: '4. 三相异步电机起动方法',
        steps: [
            {
                msg: '第 1 步：调出数字功率计，串联接入 U 相（ac_wire_u → I+ → I- → im01_wire_u1），电压线圈 U+ 短接 I+、U- 接 U2。V 相和 W 相直连，Y 形接法。',
                mode: 'check',
                async act() {
                    await new Promise(r => setTimeout(r, 500));
                    const sys = this.sys;
                    sys.conns.length = 0;
                    const cons = [
                        { from: 'ac_wire_u', to: 'elecmeter_wire_ip', type: 'wire' },
                        { from: 'elecmeter_wire_in', to: 'im01_wire_u1', type: 'wire' },
                        { from: 'elecmeter_wire_up', to: 'elecmeter_wire_ip', type: 'wire' },
                        { from: 'elecmeter_wire_un', to: 'im01_wire_u2', type: 'wire' },
                        { from: 'ac_wire_v', to: 'im01_wire_v1', type: 'wire' },
                        { from: 'ac_wire_w', to: 'im01_wire_w1', type: 'wire' },
                        { from: 'im01_wire_u2', to: 'im01_wire_v2', type: 'wire' },
                        { from: 'im01_wire_u2', to: 'im01_wire_w2', type: 'wire' },
                    ];
                    cons.forEach(c => sys.connMgr.addConn(c));
                    const em = sys.comps['elecmeter'];
                    if (em) em.group.visible(true);
                    const motor = sys.comps['im01'];
                    if (motor) motor.loadTorque = 0;
                    const ac = sys.comps['ac'];
                    if (ac) ac.onConfigUpdate({ vRms: 220, freq: 50, isOn: false, phaseSeq: 'pos' });
                    sys.redrawAll();
                    await new Promise(r => setTimeout(r, 500));
                },
                check() {
                    const c = (a, b) => this.sys.isPortConnected(a, b);
                    const em = this.sys.comps['elecmeter'];
                    return em && em.group.isVisible()
                        && c('ac_wire_u', 'elecmeter_wire_ip')
                        && c('elecmeter_wire_in', 'im01_wire_u1')
                        && c('elecmeter_wire_up', 'elecmeter_wire_ip')
                        && c('elecmeter_wire_un', 'im01_wire_u2')
                        && c('ac_wire_v', 'im01_wire_v1')
                        && c('ac_wire_w', 'im01_wire_w1')
                        && c('im01_wire_u2', 'im01_wire_v2')
                        && c('im01_wire_u2', 'im01_wire_w2');
                },
            },
            {
                msg: '第 2 步：将负载阻力矩设为 200 N·m（堵转），接通三相电源（220V/50Hz），观察面板显示的起动电流和起动转矩。',
                mode: 'check',
                async act() {
                    await new Promise(r => setTimeout(r, 500));
                    const motor = this.sys.comps['im01'];
                    if (motor) motor.loadTorque = 200;
                    const ac = this.sys.comps['ac'];
                    if (ac) ac.onConfigUpdate({ vRms: 220, freq: 50, isOn: true, phaseSeq: 'pos' });
                    await new Promise(r => setTimeout(r, 500));
                },
                check() {
                    const motor = this.sys.comps['im01'];
                    const ac = this.sys.comps['ac'];
                    return motor && ac && motor.loadTorque >= 200 && ac.isOn;
                },
            },
            {
                msg: '第 3 步：将电压降至 110V（保持 50Hz），观察电流和转矩的变化。降压会减小起动电流和起动转矩。',
                mode: 'check',
                async act() {
                    await new Promise(r => setTimeout(r, 500));
                    const ac = this.sys.comps['ac'];
                    if (ac) ac.onConfigUpdate({ vRms: 110, freq: 50 });
                    await new Promise(r => setTimeout(r, 500));
                },
                check() {
                    const ac = this.sys.comps['ac'];
                    return ac && ac.isOn && Math.abs(ac.vRms - 110) < 2;
                },
            },
            {
                msg: '第 4 步：关闭电源，将接法由 Y 形改为 Δ 形（U1-W2、V1-U2、W1-V2），重新接通电源（220V/50Hz），观察电流和转矩的变化。',
                mode: 'check',
                async act() {
                    await new Promise(r => setTimeout(r, 500));
                    const ac = this.sys.comps['ac'];
                    if (ac) ac.onConfigUpdate({ isOn: false });
                    await new Promise(r => setTimeout(r, 200));
                    const sys = this.sys;
                    sys.conns.length = 0;
                    const cons = [
                        { from: 'ac_wire_u', to: 'elecmeter_wire_ip', type: 'wire' },
                        { from: 'elecmeter_wire_in', to: 'im01_wire_u1', type: 'wire' },
                        { from: 'elecmeter_wire_up', to: 'elecmeter_wire_ip', type: 'wire' },
                        { from: 'elecmeter_wire_un', to: 'im01_wire_u2', type: 'wire' },
                        { from: 'ac_wire_v', to: 'im01_wire_v1', type: 'wire' },
                        { from: 'ac_wire_w', to: 'im01_wire_w1', type: 'wire' },
                        { from: 'im01_wire_u1', to: 'im01_wire_w2', type: 'wire' },
                        { from: 'im01_wire_v1', to: 'im01_wire_u2', type: 'wire' },
                        { from: 'im01_wire_w1', to: 'im01_wire_v2', type: 'wire' },
                    ];
                    cons.forEach(c => sys.connMgr.addConn(c));
                    const motor = sys.comps['im01'];
                    if (motor) motor.loadTorque = 200;
                    if (ac) ac.onConfigUpdate({ isOn: true, vRms: 220, freq: 50 });
                    sys.redrawAll();
                    await new Promise(r => setTimeout(r, 500));
                },
                check() {
                    const c = (a, b) => this.sys.isPortConnected(a, b);
                    const dOk = c('im01_wire_u1', 'im01_wire_w2')
                            && c('im01_wire_v1', 'im01_wire_u2')
                            && c('im01_wire_w1', 'im01_wire_v2');
                    const noY = !this.sys.isPortConnected('im01_wire_u2', 'im01_wire_v2');
                    const ac = this.sys.comps['ac'];
                    const motor = this.sys.comps['im01'];
                    return dOk && noY && ac && ac.isOn && motor && motor.loadTorque >= 200;
                },
            },
            {
                msg: '第 5 步：将频率降至 40Hz，电压等比例降至 176V（保持 V/f 比恒定），观察电流和转矩的变化。',
                mode: 'check',
                async act() {
                    await new Promise(r => setTimeout(r, 500));
                    const ac = this.sys.comps['ac'];
                    if (ac) ac.onConfigUpdate({ freq: 40, vRms: 176 });
                    await new Promise(r => setTimeout(r, 500));
                },
                check() {
                    const ac = this.sys.comps['ac'];
                    return ac && ac.isOn && Math.abs(ac.freq - 40) < 0.5 && Math.abs(ac.vRms - 176) < 2;
                },
            },
            {
                msg: '第 6 步：将转子电阻 R₂ 由 0.46Ω 增大至 0.92Ω，观察电流和转矩的变化。增大转子电阻可减小起动电流、增大起动转矩。',
                mode: 'check',
                async act() {
                    await new Promise(r => setTimeout(r, 500));
                    const motor = this.sys.comps['im01'];
                    if (motor) motor.onConfigUpdate({ R2: 0.92 });
                    await new Promise(r => setTimeout(r, 500));
                },
                check() {
                    const motor = this.sys.comps['im01'];
                    return motor && Math.abs(motor.R2 - 0.92) < 0.01;
                },
            },
            {
                msg: '第 7 步：起动参数知识',
                mode: 'quiz',
                quizConfig: {
                    question: '增大转子电阻 R₂ 对三相异步电动机起动性能有何影响？',
                    options: [
                        '起动电流减小，起动转矩增大',
                        '起动电流增大，起动转矩减小',
                        '起动电流和起动转矩均增大',
                        '起动电流和起动转矩均减小',
                    ],
                    answer: 0,
                    analysis: '增大 R₂ 使转子回路总阻抗增加，起动电流减小；同时临界转差率 sₘ = R₂ / (X₁+X₂) 增大，使起动点（s=1）更靠近最大转矩点，因此起动转矩增大。绕线式异步电机正是利用这一原理，通过在转子回路串电阻来改善起动性能。',
                },
            },
        ],
    },

    'speed-control': {
        id: 'speed-control',
        name: '5. 三相异步电机调速方法',
        steps: [
            {
                msg: '第 1 步：接线（Y 形），设置风机型负载，起动电机（220V/50Hz），观察稳定转速。风机负载阻力矩随转速升高而增大。',
                mode: 'check',
                async act() {
                    await new Promise(r => setTimeout(r, 500));
                    const sys = this.sys;
                    const motor = sys.comps['im01'];
                    _autoWire(sys, 'speed-control');
                    motor.loadType = 'fan';
                    motor.fanK = calcFanK(motor);
                    const ac = sys.comps['ac'];
                    if (ac) ac.onConfigUpdate({ vRms: 220, freq: 50, isOn: true, phaseSeq: 'pos' });
                    await new Promise(r => setTimeout(r, 500));
                },
                check() {
                    const ac = this.sys.comps['ac'];
                    const motor = this.sys.comps['im01'];
                    return ac && ac.isOn && motor && motor.loadType === 'fan';
                },
            },
            {
                msg: '第 2 步：将电压降至 160 V（保持频率 50Hz），观察转速变化。降压调速属于变转差率调速，转差功率损耗大、效率低。',
                mode: 'check',
                async act() {
                    await new Promise(r => setTimeout(r, 500));
                    const ac = this.sys.comps['ac'];
                    if (ac) ac.onConfigUpdate({ vRms: 160 });
                    await new Promise(r => setTimeout(r, 500));
                },
                check() {
                    const ac = this.sys.comps['ac'];
                    return ac && ac.isOn && Math.abs(ac.vRms - 160) < 2;
                },
            },
            {
                msg: '第 3 步：恢复电压 220V，切换为恒转矩负载（约 60 N·m），将转子电阻 R₂ 由 0.46Ω 增大至 1.46Ω，观察转速变化。转子串电阻调速仅适用于绕线式异步电机，属于变转差率调速。',
                mode: 'check',
                async act() {
                    await new Promise(r => setTimeout(r, 500));
                    const ac = this.sys.comps['ac'];
                    if (ac) ac.onConfigUpdate({ vRms: 220 });
                    const motor = this.sys.comps['im01'];
                    if (motor) {
                        motor.loadType = 'constant';
                        motor.loadTorque = 60;
                        motor.onConfigUpdate({ R2: 1.46 });
                    }
                    await new Promise(r => setTimeout(r, 500));
                },
                check() {
                    const motor = this.sys.comps['im01'];
                    const ac = this.sys.comps['ac'];
                    return ac && ac.isOn && motor
                        && motor.loadType === 'constant'
                        && Math.abs(motor.loadTorque - 60) < 3
                        && Math.abs(motor.R2 - 1.46) < 0.2;
                },
            },
            {
                msg: '第 4 步：恢复转子电阻 R₂ 为 0.46Ω，将磁极对数由 2 变为 4，观察转速变化。变极调速通过改变定子绕组接法改变极对数，实现有级调速，仅适用于笼式异步电机。',
                mode: 'check',
                async act() {
                    await new Promise(r => setTimeout(r, 500));
                    const motor = this.sys.comps['im01'];
                    if (motor) motor.onConfigUpdate({ R2: 0.46, polePairs: 4 });
                    await new Promise(r => setTimeout(r, 500));
                },
                check() {
                    const motor = this.sys.comps['im01'];
                    return motor && Math.abs(motor.R2 - 0.46) < 0.01 && motor.polePairs === 4;
                },
            },
            {
                msg: '第 5 步：恢复磁极对数为 2，将频率降至 40 Hz，电压同步降至 176 V（保持 V/f 比 = 4.4 恒定），观察转速变化。变频调速保持 U/f 恒定可实现恒磁通调速，属于高效调速方式。',
                mode: 'check',
                async act() {
                    await new Promise(r => setTimeout(r, 500));
                    const motor = this.sys.comps['im01'];
                    if (motor) motor.onConfigUpdate({ polePairs: 2 });
                    const ac = this.sys.comps['ac'];
                    if (ac) ac.onConfigUpdate({ freq: 40, vRms: 176 });
                    await new Promise(r => setTimeout(r, 500));
                },
                check() {
                    const motor = this.sys.comps['im01'];
                    const ac = this.sys.comps['ac'];
                    return motor && motor.polePairs === 2
                        && ac && ac.isOn
                        && Math.abs(ac.freq - 40) < 0.5
                        && Math.abs(ac.vRms - 176) < 2;
                },
            },
            {
                msg: '第 6 步：将频率升至 60 Hz，电压恢复 220V（V/f 比从 4.4 变为 3.67，主磁通减弱），观察转速变化。弱磁调速可使电机运行在额定转速以上，但转矩能力下降。',
                mode: 'check',
                async act() {
                    await new Promise(r => setTimeout(r, 500));
                    const ac = this.sys.comps['ac'];
                    if (ac) ac.onConfigUpdate({ freq: 60, vRms: 220 });
                    await new Promise(r => setTimeout(r, 500));
                },
                check() {
                    const ac = this.sys.comps['ac'];
                    return ac && ac.isOn
                        && Math.abs(ac.freq - 60) < 0.5
                        && Math.abs(ac.vRms - 220) < 2;
                },
            },
            {
                msg: '第 7 步：调速方式知识',
                mode: 'quiz',
                quizConfig: {
                    question: '下列哪种调速方法属于改变同步转速的高效调速方式？',
                    options: [
                        '转子串电阻调速（绕线式电机）',
                        '变频调速（V/f 恒定）',
                        '降压调速',
                        '定子串电抗调速',
                    ],
                    answer: 1,
                    analysis: '变频调速通过改变电源频率 f 改变同步转速 n₀ = 60f/p，保持 U/f 恒定时主磁通不变、转差率不变，无转差功率损耗，属于高效调速方式。转子串电阻、降压、串电抗均属于变转差率调速，转差功率以发热形式损耗在转子回路中，效率较低。',
                },
            },
        ],
    },

    'braking-methods': {
        id: 'braking-methods',
        name: '6. 三相异步电机制动方法',
        steps: [
            {
                msg: '第 1 步：接线并起动电机（正序 UVW），使电机达到稳定运行状态。',
                mode: 'check',
                async act() {
                    await new Promise(r => setTimeout(r, 500));
                    _autoWire(this.sys, 'braking-methods');
                    const ac = this.sys.comps['ac'];
                    if (ac) ac.onConfigUpdate({ vRms: 220, freq: 50, isOn: true, phaseSeq: 'pos' });
                    await new Promise(r => setTimeout(r, 500));
                },
                check() {
                    const ac = this.sys.comps['ac'];
                    return ac && ac.isOn && ac.phaseSeq === 'pos';
                },
            },
            {
                msg: '第 2 步：将三相电源相序切换为负序（UWV），观察电机转速迅速下降。反接制动利用反向旋转磁场产生制动转矩，使电机快速停机。',
                mode: 'check',
                async act() {
                    await new Promise(r => setTimeout(r, 500));
                    const ac = this.sys.comps['ac'];
                    if (ac) ac.onConfigUpdate({ phaseSeq: 'neg' });
                    await new Promise(r => setTimeout(r, 500));
                },
                check() {
                    const motor = this.sys.comps['im01'];
                    return motor && motor._phaseSeq === -1;
                },
            },
            {
                msg: '第 3 步：恢复正序运行，降低电源频率至 30Hz，观察电机进入再生制动状态，转速下降至接近新同步转速（约 900 rpm）。再生制动将机械能回馈至电网，节能且经济。',
                mode: 'check',
                async act() {
                    await new Promise(r => setTimeout(r, 500));
                    const ac = this.sys.comps['ac'];
                    if (ac) ac.onConfigUpdate({ phaseSeq: 'pos', freq: 30 });
                    await new Promise(r => setTimeout(r, 500));
                },
                check() {
                    const motor = this.sys.comps['im01'];
                    const ac = this.sys.comps['ac'];
                    return ac && ac.isOn && motor && motor._phaseSeq === 1 && Math.abs(ac.freq - 30) < 2;
                },
            },
            {
                msg: '第 4 步：恢复正常频率 50Hz，切断交流电源，将直流电源（DC 24V）正极接 U1、负极接 V1，打开直流电源，观察电机能耗制动停车。',
                mode: 'check',
                async act() {
                    await new Promise(r => setTimeout(r, 500));
                    const ac = this.sys.comps['ac'];
                    if (ac) ac.onConfigUpdate({ freq: 50, isOn: false });
                    const dc = this.sys.comps['dc24v'];
                    if (dc) {
                        this.sys.connMgr.addConn({ from: 'dc24v_wire_p', to: 'im01_wire_u1', type: 'wire' });
                        this.sys.connMgr.addConn({ from: 'dc24v_wire_n', to: 'im01_wire_v1', type: 'wire' });
                        dc.isOn = true;
                        dc.update();
                    }
                    await new Promise(r => setTimeout(r, 1500));
                },
                check() {
                    const ac = this.sys.comps['ac'];
                    const dc = this.sys.comps['dc24v'];
                    const motor = this.sys.comps['im01'];
                    if (!ac || !dc || !motor) return false;
                    const c = (a, b) => this.sys.isPortConnected(a, b);
                    return !ac.isOn
                        && dc.isOn
                        && c('dc24v_wire_p', 'im01_wire_u1')
                        && c('dc24v_wire_n', 'im01_wire_v1')
                        && Math.abs(motor.getOmegaM()) < 10;
                },
            },
            {
                msg: '第 5 步：制动方法知识',
                mode: 'quiz',
                quizConfig: {
                    question: '下列哪种制动方式可以将机械能回馈至电网？',
                    options: [
                        '反接制动 — 通过改变相序实现制动',
                        '再生制动 — 电机转速超过同步转速时回馈发电',
                        '能耗制动 — 通入直流电产生静止磁场制动',
                        '以上三种都可以',
                    ],
                    answer: 1,
                    analysis: '再生制动（又称回馈制动）发生在电机实际转速超过同步转速时，电机处于发电状态，将机械能转化为电能回馈至电网，节能且经济。反接制动和能耗制动均将能量消耗在转子电路中。',
                },
            },
        ],
    },

    'slip-characteristic': {
        id: 'slip-characteristic',
        name: '7. 三相异步电机转差率特性',
        steps: [
            {
                msg: '第 1 步：接线（Y 形），起动电机（220V/50Hz/正序），观察转差率从 1.00 逐渐下降至接近 0 的起动过程。',
                mode: 'check',
                async act() {
                    await new Promise(r => setTimeout(r, 500));
                    _autoWire(this.sys, 'slip-characteristic');
                    const ac = this.sys.comps['ac'];
                    if (ac) ac.onConfigUpdate({ vRms: 220, freq: 50, isOn: true, phaseSeq: 'pos' });
                    await new Promise(r => setTimeout(r, 500));
                },
                check() {
                    const motor = this.sys.comps['im01'];
                    return motor && Math.abs(motor.getOmegaM()) > 140;
                },
            },
            {
                msg: '第 2 步：设置负载阻力矩 200 N·m（恒转矩），观察电机转速迅速下降至停转，转差率从接近 0 上升至 1.00。',
                mode: 'check',
                async act() {
                    await new Promise(r => setTimeout(r, 500));
                    const motor = this.sys.comps['im01'];
                    if (motor) {
                        motor.loadType = 'constant';
                        motor.loadTorque = 200;
                    }
                    await new Promise(r => setTimeout(r, 500));
                },
                check() {
                    const motor = this.sys.comps['im01'];
                    return motor && motor.loadTorque > 190;
                },
            },
            {
                msg: '第 3 步：卸除负载，将三相电源相序切换为负序（UWV），观察电机在正向惯性下遇到反向磁场，转差率瞬间大于 1。',
                mode: 'check',
                async act() {
                    await new Promise(r => setTimeout(r, 500));
                    const motor = this.sys.comps['im01'];
                    if (motor) {
                        motor.loadTorque = 0;
                        motor.loadType = 'constant';
                    }
                    const ac = this.sys.comps['ac'];
                    if (ac) ac.onConfigUpdate({ phaseSeq: 'neg' });
                    await new Promise(r => setTimeout(r, 500));
                },
                check() {
                    const motor = this.sys.comps['im01'];
                    return motor && motor._phaseSeq === -1;
                },
            },
            {
                msg: '第 4 步：恢复正序运行，降低电源频率至 30Hz，观察电机进入再生制动状态，转差率变为负值（s < 0）。',
                mode: 'check',
                async act() {
                    await new Promise(r => setTimeout(r, 500));
                    const ac = this.sys.comps['ac'];
                    if (ac) ac.onConfigUpdate({ phaseSeq: 'pos', freq: 30 });
                    await new Promise(r => setTimeout(r, 500));
                },
                check() {
                    const motor = this.sys.comps['im01'];
                    const ac = this.sys.comps['ac'];
                    return ac && ac.isOn && motor && motor._phaseSeq === 1 && Math.abs(ac.freq - 30) < 2;
                },
            },
            {
                msg: '第 5 步：恢复 50Hz，设置负载阻力矩 19 N·m（恒转矩），记录此时的电磁转矩 Te 和转差率 s。',
                mode: 'check',
                async act() {
                    await new Promise(r => setTimeout(r, 500));
                    const ac = this.sys.comps['ac'];
                    if (ac) ac.onConfigUpdate({ freq: 50 });
                    const motor = this.sys.comps['im01'];
                    if (motor) {
                        motor.loadType = 'constant';
                        motor.loadTorque = 19;
                    }
                    await new Promise(r => setTimeout(r, 500));
                },
                check() {
                    const motor = this.sys.comps['im01'];
                    return motor && Math.abs(motor.loadTorque - 19) < 3 && Math.abs(motor.getOmegaM()) > 140;
                },
            },
            {
                msg: '第 6 步：设置负载阻力矩 29 N·m，记录此时的电磁转矩 Te 和转差率 s。',
                mode: 'check',
                async act() {
                    await new Promise(r => setTimeout(r, 500));
                    const motor = this.sys.comps['im01'];
                    if (motor) {
                        motor.loadType = 'constant';
                        motor.loadTorque = 29;
                    }
                    await new Promise(r => setTimeout(r, 500));
                },
                check() {
                    const motor = this.sys.comps['im01'];
                    return motor && Math.abs(motor.loadTorque - 29) < 3 && Math.abs(motor.getOmegaM()) > 140;
                },
            },
            {
                msg: '第 7 步：设置负载阻力矩 39 N·m，记录此时的电磁转矩 Te 和转差率 s。根据以上三组数据验证：（1）电磁转矩取决于负载阻力矩；（2）s 很小时，电磁转矩与 s 成正比。',
                mode: 'check',
                async act() {
                    await new Promise(r => setTimeout(r, 500));
                    const motor = this.sys.comps['im01'];
                    if (motor) {
                        motor.loadType = 'constant';
                        motor.loadTorque = 39;
                    }
                    await new Promise(r => setTimeout(r, 500));
                },
                check() {
                    const motor = this.sys.comps['im01'];
                    return motor && Math.abs(motor.loadTorque - 39) < 3 && Math.abs(motor.getOmegaM()) > 140;
                },
            },
            {
                msg: '第 8 步：转差率特性知识',
                mode: 'quiz',
                quizConfig: {
                    question: '当转差率 s 很小时（s < 0.06），电磁转矩 Te 与转差率 s 之间近似呈什么关系？',
                    options: [
                        'Te 与 s 无关，基本恒定',
                        'Te 与 s 成正比（Te ∝ s）',
                        'Te 与 s 成反比（Te ∝ 1/s）',
                        'Te 与 s² 成正比（Te ∝ s²）',
                    ],
                    answer: 1,
                    analysis: '当 s 很小时，等效电路中 R₂/s 远大于其他阻抗项，电磁转矩 Te ≈ 3pU₁²s / (2πf₁R₂)，即 Te 与 s 近似成正比。',
                },
            },
        ],
    },

    'fault-analysis': {
        id: 'fault-analysis',
        name: '8. 三相异步电机常见故障分析',
        steps: [
            {
                msg: '第 1 步：Y 形接线，U 相串入数字功率计测电流，设置恒转矩负载 30 N·m，起动电机（220V/50Hz/正序），观察正常运行时电流。',
                mode: 'check',
                async act() {
                    await new Promise(r => setTimeout(r, 500));
                    const sys = this.sys;
                    const ac = sys.comps['ac'];
                    const motor = sys.comps['im01'];
                    const em = sys.comps['elecmeter'];

                    sys.conns.length = 0;
                    _wireFaultAnalysis(sys);

                    if (em) {
                        em.group.position({ x: 100, y: 160 });
                        em.group.visible(true);
                    }

                    if (ac) ac.onConfigUpdate({ vRms: 220, freq: 50, isOn: true, phaseSeq: 'pos' });
                    if (motor) { motor.loadType = 'constant'; motor.loadTorque = 30; }

                    const sel = document.getElementById('loadTypeSelect');
                    if (sel) sel.value = 'constant';
                    const slider = document.getElementById('torqueSlider');
                    if (slider) { slider.value = '30'; slider.dispatchEvent(new Event('input')); }

                    await new Promise(r => setTimeout(r, 500));
                },
                check() {
                    const motor = this.sys.comps['im01'];
                    const ac = this.sys.comps['ac'];
                    const c = (a, b) => this.sys.isPortConnected(a, b);
                    return ac && ac.isOn
                        && motor && motor.loadType === 'constant' && motor.loadTorque > 25
                        && Math.abs(motor.getOmegaM()) > 140
                        && c('ac_wire_u', 'elecmeter_wire_ip')
                        && c('elecmeter_wire_in', 'im01_wire_u1')
                        && c('im01_wire_u2', 'im01_wire_v2')
                        && c('im01_wire_u2', 'im01_wire_w2');
                },
            },
            {
                msg: '第 2 步：运行中断开 W 相（移除 ac_wire_w → im01_wire_w1 的连线），观察功率计电流变化，注意电机是否停转。',
                mode: 'check',
                async act() {
                    await new Promise(r => setTimeout(r, 500));
                    const sys = this.sys;
                    sys.conns = sys.conns.filter(c => !(
                        (c.from === 'ac_wire_w' && c.to === 'im01_wire_w1') ||
                        (c.from === 'im01_wire_w1' && c.to === 'ac_wire_w')
                    ));
                    sys.redrawAll();
                    await new Promise(r => setTimeout(r, 500));
                },
                check() {
                    const motor = this.sys.comps['im01'];
                    const c = (a, b) => this.sys.isPortConnected(a, b);
                    return !c('ac_wire_w', 'im01_wire_w1')
                        && motor && Math.abs(motor.getOmegaM()) > 100;
                },
            },
            {
                msg: '第 3 步：断开交流电源，等待电机完全停止，再重新接通电源，观察缺相状态下电机能否起动。',
                mode: 'check',
                async act() {
                    await new Promise(r => setTimeout(r, 500));
                    const sys = this.sys;
                    const ac = sys.comps['ac'];
                    if (ac) ac.onConfigUpdate({ isOn: false });
                    await new Promise(r => setTimeout(r, 3000));
                    if (ac) ac.onConfigUpdate({ isOn: true });
                    await new Promise(r => setTimeout(r, 1000));
                },
                check() {
                    const motor = this.sys.comps['im01'];
                    const ac = this.sys.comps['ac'];
                    const c = (a, b) => this.sys.isPortConnected(a, b);
                    return ac && ac.isOn
                        && motor
                        && !c('ac_wire_w', 'im01_wire_w1')
                        && Math.abs(motor.getOmegaM()) < 5;
                },
            },
            {
                msg: '第 4 步：恢复 W 相接线（重新连接 ac_wire_w → im01_wire_w1），起动电机至稳定状态。将电源电压降至 160V，观察电机转速下降和电流增大现象。',
                mode: 'check',
                async act() {
                    await new Promise(r => setTimeout(r, 500));
                    const sys = this.sys;
                    const ac = sys.comps['ac'];
                    sys.connMgr.addConn({ from: 'ac_wire_w', to: 'im01_wire_w1', type: 'wire' });
                    if (ac) ac.onConfigUpdate({ vRms: 160 });
                    await new Promise(r => setTimeout(r, 1000));
                },
                check() {
                    const motor = this.sys.comps['im01'];
                    const ac = this.sys.comps['ac'];
                    const c = (a, b) => this.sys.isPortConnected(a, b);
                    return ac && ac.isOn
                        && Math.abs(ac.vRms - 160) < 3
                        && c('ac_wire_w', 'im01_wire_w1')
                        && c('ac_wire_u', 'elecmeter_wire_ip')
                        && c('elecmeter_wire_in', 'im01_wire_u1')
                        && motor && Math.abs(motor.getOmegaM()) > 100;
                },
            },
            {
                msg: '第 5 步：故障分析知识',
                mode: 'quiz',
                quizConfig: {
                    question: '三相异步电机运行中断开一相（缺相运行）后，以下哪个现象是正确的？',
                    options: [
                        '电机立即停转，无法继续运行',
                        '电机继续运行，但电流显著增大，长时间缺相会烧毁电机',
                        '电机运行不受任何影响，各项参数保持不变',
                        '电机转速反而升高，电流减小',
                    ],
                    answer: 1,
                    analysis: '运行中断开一相后，电机变为单相运行状态，仍能依靠惯性继续旋转。但由于缺少一相电压，定子电流显著增大（可达额定电流 1.5～2 倍），导致电机过热，长时间缺相运行会烧毁电机。同时，电机无法在缺相状态下起动（起动转矩为 0）。',
                },
            },
        ],
    },

    'ts-curve-analysis': {
        id: 'ts-curve-analysis',
        name: '9. 三相异步电机 T-s 特性曲线分析',
        steps: [
            {
                msg: '第 1 步：Y 形接线，设置恒转矩负载 30 N·m。T-s 特性面板显示电机的 T-s 曲线（蓝色虚线）和负载特性线（橙色虚线）。',
                mode: 'check',
                async act() {
                    await new Promise(r => setTimeout(r, 500));
                    const sys = this.sys;
                    _autoWire(sys, 'ts-curve-analysis');

                    const tsc = sys.comps['ts-curve'];
                    if (tsc) { tsc.group.position({ x: 850, y: 50 }); tsc.group.visible(true); }

                    const motor = sys.comps['im01'];
                    if (motor) { motor.loadType = 'constant'; motor.loadTorque = 30; }

                    const slider = document.getElementById('torqueSlider');
                    if (slider) { slider.value = '30'; slider.dispatchEvent(new Event('input')); }
                    const sel = document.getElementById('loadTypeSelect');
                    if (sel) sel.value = 'constant';

                    await new Promise(r => setTimeout(r, 500));
                },
                check() {
                    const motor = this.sys.comps['im01'];
                    const c = (a, b) => this.sys.isPortConnected(a, b);
                    return motor && motor.loadType === 'constant' && motor.loadTorque > 25
                        && c('ac_wire_u', 'im01_wire_u1')
                        && c('ac_wire_v', 'im01_wire_v1')
                        && c('im01_wire_u2', 'im01_wire_v2')
                        && c('im01_wire_u2', 'im01_wire_w2');
                },
            },
            {
                msg: '第 2 步：起动电机（220V/50Hz/正序）。红色点（电机工作点）沿 T-s 曲线移动，蓝色点（负载工作点）沿负载线移动，最终两点在交点处稳定（Te = T负载）。',
                mode: 'check',
                async act() {
                    await new Promise(r => setTimeout(r, 500));
                    const ac = this.sys.comps['ac'];
                    if (ac) ac.onConfigUpdate({ vRms: 220, freq: 50, isOn: true, phaseSeq: 'pos' });
                    await new Promise(r => setTimeout(r, 500));
                },
                check() {
                    const motor = this.sys.comps['im01'];
                    return motor && Math.abs(motor.getOmegaM()) > 140;
                },
            },
            {
                msg: '第 3 步：断开电源，将负载类型切换为风机型。T-s 面板上的负载特性线由水平线变为抛物线（风机特性），以虚线显示。',
                mode: 'check',
                async act() {
                    await new Promise(r => setTimeout(r, 500));
                    const sys = this.sys;
                    const ac = sys.comps['ac'];
                    if (ac) ac.onConfigUpdate({ isOn: false });

                    await new Promise(r => setTimeout(r, 1500));

                    const select = document.getElementById('loadTypeSelect');
                    if (select) { select.value = 'fan'; select.dispatchEvent(new Event('change')); }
                    await new Promise(r => setTimeout(r, 500));
                },
                check() {
                    const ac = this.sys.comps['ac'];
                    const motor = this.sys.comps['im01'];
                    return ac && !ac.isOn && motor && motor.loadType === 'fan';
                },
            },
            {
                msg: '第 4 步：重新接通电源，观察电机在风机负载下起动。红色点沿 T-s 曲线移动，蓝色点沿风机抛物线移动，最终交于新的稳定工作点。',
                mode: 'check',
                async act() {
                    await new Promise(r => setTimeout(r, 500));
                    const ac = this.sys.comps['ac'];
                    if (ac) ac.onConfigUpdate({ vRms: 220, freq: 50, isOn: true, phaseSeq: 'pos' });
                    await new Promise(r => setTimeout(r, 1500));
                },
                check() {
                    const motor = this.sys.comps['im01'];
                    const ac = this.sys.comps['ac'];
                    return ac && ac.isOn && motor && motor.loadType === 'fan'
                        && Math.abs(motor.getOmegaM()) > 140;
                },
            },
        ],
    },
};

export const componentConfigs = [
    { Class: ACPower3P, id: 'ac', x: 220, y: 80, vRms: 220, freq: 50, isOn: false, phaseSeq: 'pos', visible: true },
    { Class: InductionMotor, id: 'im01', x: 150, y: 320, visible: true,
        R1: 0.50, Lsigma1: 0.00334, Rc: 300, Lm: 0.0796,
        R2: 0.46, Lsigma2: 0.00334,
        J: 0.12, B: 0.01, polePairs: 2,
        ratedPower: 10, ratedSpeed: 1440,
        simpleModel: true, loadTorque: 0 },

    { Class: DCPower, id: 'dc24v', x: 420, y: 80, isOn: false, visible: true },

    { Class: Multimeter, id: 'multimeter', x: 1080, y: 440, visible: false },
    { Class: MF47Multimeter, id: 'mf47-panel', x: 1250, y: 180, visible: false },
    { Class: Oscilloscope_tri, id: 'osc', x: 50, y: 50, visible: false },
    { Class: SignalGenerator, id: 'sg', x: 50, y: 50, visible: false },
    { Class: ProcessCalibrator, id: 'cali', x: 50, y: 50, visible: false },
    { Class: ElecMeter, id: 'elecmeter', x: 50, y: 50, visible: false },
    { Class: TsCurveDisplay, id: 'ts-curve', x: 950, y: 100, visible: true, quadrants: 1 },
];

// ─── 接线辅助 ───

function _wireY(sys) {
    const cons = [
        { from: 'ac_wire_u', to: 'im01_wire_u1', type: 'wire' },
        { from: 'ac_wire_v', to: 'im01_wire_v1', type: 'wire' },
        { from: 'ac_wire_w', to: 'im01_wire_w1', type: 'wire' },
        { from: 'im01_wire_u2', to: 'im01_wire_v2', type: 'wire' },
        { from: 'im01_wire_u2', to: 'im01_wire_w2', type: 'wire' },
    ];
    cons.forEach(c => sys.connMgr.addConn(c));
}

function _wireDelta(sys) {
    const cons = [
        { from: 'ac_wire_u', to: 'im01_wire_u1', type: 'wire' },
        { from: 'ac_wire_v', to: 'im01_wire_v1', type: 'wire' },
        { from: 'ac_wire_w', to: 'im01_wire_w1', type: 'wire' },
        { from: 'im01_wire_u1', to: 'im01_wire_w2', type: 'wire' },
        { from: 'im01_wire_v1', to: 'im01_wire_u2', type: 'wire' },
        { from: 'im01_wire_w1', to: 'im01_wire_v2', type: 'wire' },
    ];
    cons.forEach(c => sys.connMgr.addConn(c));
}

function _wireFaultAnalysis(sys) {
    const cons = [
        { from: 'ac_wire_u', to: 'elecmeter_wire_ip', type: 'wire' },
        { from: 'elecmeter_wire_in', to: 'im01_wire_u1', type: 'wire' },
        { from: 'ac_wire_v', to: 'im01_wire_v1', type: 'wire' },
        { from: 'ac_wire_w', to: 'im01_wire_w1', type: 'wire' },
        { from: 'im01_wire_u2', to: 'im01_wire_v2', type: 'wire' },
        { from: 'im01_wire_u2', to: 'im01_wire_w2', type: 'wire' },
    ];
    cons.forEach(c => sys.connMgr.addConn(c));
}

function calcFanK(motor) {
    if (!motor) return 0;
    const rp = (motor.ratedPower != null ? motor.ratedPower : 10) * 1000;
    const rs = 1200;
    const omega = rs * Math.PI / 30;
    return rp / (omega * omega * omega);
}

function _autoWire(sys, wfId) {
    sys.conns.length = 0;
    const ac = sys.comps['ac'];
    const motor = sys.comps['im01'];
    if (ac) ac.onConfigUpdate({ vRms: 220, freq: 50, isOn: false, phaseSeq: 'pos' });
    _wireY(sys);
    sys.redrawAll();
}

export function initSlider(sys) {
    const toolbar = document.getElementById('toolbar');
    const div = document.createElement('div');
    div.id = 'torqueSliderContainer';
    div.style.cssText = 'display:inline-flex;align-items:center;gap:6px;margin-left:12px;';
    div.innerHTML = `
        <span style="font-size:12px;font-weight:bold;">负载性质:</span>
        <select id="loadTypeSelect" style="font-size:12px;padding:1px 4px;">
            <option value="constant">恒转矩</option>
            <option value="fan">风机型</option>
        </select>
        <input type="range" id="torqueSlider" min="0" max="200" value="0" style="width:160px;">
        <span id="torqueDisplay" style="font-size:12px;min-width:65px;">0.0 N·m</span>
    `;
    toolbar.appendChild(div);

    const motor = sys.comps['im01'];
    const slider = document.getElementById('torqueSlider');
    const display = document.getElementById('torqueDisplay');
    const select = document.getElementById('loadTypeSelect');

    select.addEventListener('change', () => {
        if (!motor) return;
        motor.loadType = select.value;
        if (select.value === 'fan') {
            motor._constantTorqueBackup = motor.loadTorque;
            motor.fanK = calcFanK(motor);
            slider.disabled = true;
            slider.style.opacity = '0.5';
        } else {
            slider.disabled = false;
            slider.style.opacity = '1';
            const restore = motor._constantTorqueBackup !== undefined ? motor._constantTorqueBackup : 0;
            motor.loadTorque = restore;
            slider.value = Math.min(200, Math.round(restore));
            display.textContent = restore.toFixed(1) + ' N·m';
            sys.requestRedraw();
        }
        motor.config.loadType = select.value;
        motor.config.loadTorque = motor.loadTorque;
    });

    slider.addEventListener('input', () => {
        if (select.value === 'constant') {
            const val = parseFloat(slider.value);
            display.textContent = val.toFixed(1) + ' N·m';
            if (motor) {
                motor.loadTorque = val;
                motor.config.loadTorque = val;
            }
            sys.requestRedraw();
        }
    });

    // 风机模式下定时更新滑条和显示（20fps，与物理循环同步）
    setInterval(() => {
        if (!motor || motor.loadType !== 'fan') return;
        const t = Math.abs(motor._appliedLoadTorque || 0);
        display.textContent = t.toFixed(1) + ' N·m';
        slider.value = Math.min(200, Math.round(t));
        motor.config.loadTorque = Math.round(t * 10) / 10;
    }, 50);
}

export function applyAllPresets() {
    const sys = this && this.sys ? this.sys : window.sys;
    if (!sys) return;
    _autoWire(sys, sys.currentWorkflowId || 'motor-starting');
}

export async function applyStartSystem() {
    const sys = this && this.sys ? this.sys : window.sys;
    if (!sys) return;
    _autoWire(sys, sys.currentWorkflowId || 'motor-starting');
    const ac = sys.comps['ac'];
    if (ac) ac.onConfigUpdate({ vRms: 220, freq: 50, isOn: true, phaseSeq: 'pos' });
}

export function fiveStep() {}
