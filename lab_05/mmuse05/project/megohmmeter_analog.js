import { ACPower3P } from '../components/ACPower3P.js';
import { Resistor } from '../components/Resistor.js';
import { Ground } from '../components/Gnd.js';
import { Megohmmeter } from '../components/Megohmmeter.js';
import { ThreePhaseMotor } from '../components/ThreePhaseMotor.js';

import { AmpMeter } from '../components/AmpMeter.js';
import { MF47Multimeter } from '../components/MF47Multimeter.js';
import { Multimeter } from '../components/Multimeter.js';
import { SignalGenerator } from '../components/SignalGenerator.js';
import { ProcessCalibrator } from '../components/ProcessCalibrator.js';
import { Oscilloscope_tri } from '../components/Osc_tri.js';

export const FAULT_CONFIGS = {
    phase_u_open: {
        id: 'phase_u_open',
        name: '1.1 三相电力系统U 相绝缘损坏',
        system: '绝缘电阻测量',
        check() {
            const r = window.sys && window.sys.comps && window.sys.comps['r_u'];
            return r && r.value === 0;
        },
        trigger() {
            const r = window.sys && window.sys.comps && window.sys.comps['r_u'];
            if (r) { r.value = 0; r.currentResistance = 0; r.update?.(); }
        },
        repair() {
            const r = window.sys && window.sys.comps && window.sys.comps['r_u'];
            if (r) { r.value = 5e6; r.currentResistance = 5e6; r.update?.(); }
        },
    },
    phase_v_degraded: {
        id: 'phase_v_degraded',
        name: '1.2 三相电力系统V 相绝缘老化',
        system: '绝缘电阻测量',
        check() {
            const r = window.sys && window.sys.comps && window.sys.comps['r_v'];
            return r && r.value < 4e6;
        },
        trigger() {
            const r = window.sys && window.sys.comps && window.sys.comps['r_v'];
            if (r) { r.value = 0.5e6; r.currentResistance = 0.5e6; r.update?.(); }
        },
        repair() {
            const r = window.sys && window.sys.comps && window.sys.comps['r_v'];
            if (r) { r.value = 5e6; r.currentResistance = 5e6; r.update?.(); }
        },
    },
    motor_u_fault: {
        id: 'motor_u_fault',
        name: '2.1 三相异步电动机 U 相绝缘故障',
        system: '电动机绝缘测量',
        check() {
            const m = window.sys && window.sys.comps && window.sys.comps['motor'];
            return m && m.uohm !== undefined && m.uohm < 0.5e6;
        },
        trigger() {
            const m = window.sys && window.sys.comps && window.sys.comps['motor'];
            if (m) { m.uohm = 0.1e6; }
        },
        repair() {
            const m = window.sys && window.sys.comps && window.sys.comps['motor'];
            if (m) { m.uohm = 20e6; }
        },
    },
    motor_v_degraded: {
        id: 'motor_v_degraded',
        name: '2.2 三相异步电动机 V 相绝缘老化',
        system: '电动机绝缘测量',
        check() {
            const m = window.sys && window.sys.comps && window.sys.comps['motor'];
            return m && m.vohm !== undefined && m.vohm < 15e6;
        },
        trigger() {
            const m = window.sys && window.sys.comps && window.sys.comps['motor'];
            if (m) { m.vohm = 0.5e6; }
        },
        repair() {
            const m = window.sys && window.sys.comps && window.sys.comps['motor'];
            if (m) { m.vohm = 20e6; }
        },
    },
};

export const PROJECT_WORKFLOWS = {
    'megohmmeter-insulation': {
        id: 'megohmmeter-insulation',
        name: '1. 摇表测量三相电源线路绝缘电阻',
        steps: [
            {
                msg: '1. 兆欧表开路测试：摇动手柄，指针应指向 ∞',
                mode: 'check',
                act() {
                    const megger = this.sys.comps['megger'];
                    if (megger) {
                        megger.setCranking(true);
                        megger._stopValue = null;
                    }
                },
                check() {
                    const megger = this.sys.comps['megger'];
                    if (!megger || !megger.isCranking()) return false;
                    const r = megger.getResistance();
                    return !isFinite(r) || r >= 800;
                },
            },
            {
                msg: '2. 兆欧表短路测试：L-E 短接后摇动手柄，指针应指向 0',
                mode: 'check',
                act() {
                    _shortMeggerLE(this.sys);
                    const megger = this.sys.comps['megger'];
                    if (megger) {
                        megger._stopValue = null;
                        megger.setCranking(true);
                    }
                },
                check() {
                    const megger = this.sys.comps['megger'];
                    if (!megger || !megger.isCranking()) return false;
                    const r = megger.getResistance();
                    return isFinite(r) && r < 0.1;
                },
            },
            {
                msg: '3. 连接三相电源与绝缘电阻测试电路',
                mode: 'check',
                act() {
                    _doPresetWiring(this.sys);
                },
                check() {
                    const conns = this.sys.conns || [];
                    const has = (a, b) => conns.some(c => (c.from === a && c.to === b) || (c.from === b && c.to === a));
                    return has('ac3p_wire_u', 'r_u_wire_l')
                        && has('r_u_wire_r', 'gnd_wire_gnd')
                        && has('ac3p_wire_v', 'r_v_wire_l')
                        && has('r_v_wire_r', 'gnd_wire_gnd')
                        && has('ac3p_wire_w', 'r_w_wire_l')
                        && has('r_w_wire_r', 'gnd_wire_gnd')
                        && has('ac3p_wire_n', 'gnd2_wire_gnd');
                },
            },
            {
                msg: '4. 关闭三相电源',
                mode: 'check',
                act() {
                    const power = this.sys.comps['ac3p'];
                    if (power) {
                        power.isOn = false;
                        power.update?.();
                    }
                },
                check() {
                    const power = this.sys.comps['ac3p'];
                    return !power || !power.isOn;
                },
            },
            {
                msg: '5. 将摇表 L 端接 U 相、E 端接地，摇动手柄测量绝缘电阻',
                mode: 'check',
                act() {
                    _connectMeggerToPhase('u');
                    const megger = this.sys.comps['megger'];
                    if (megger) {
                        megger.setCranking(true);
                    }
                },
                check() {
                    const megger = this.sys.comps['megger'];
                    return megger && megger.isCranking()
                        && _sameCluster(this.sys, 'megger_wire_l', 'ac3p_wire_u')
                        && _sameCluster(this.sys, 'megger_wire_e', 'ac3p_wire_n');
                },
            },

            {
                msg: '6. 停止摇动，断开摇表与线路的接线',
                mode: 'check',
                act() {
                    const megger = this.sys.comps['megger'];
                    if (megger) megger.setCranking(false);
                    _disconnectMegger(this.sys);
                },
                check() {
                    const megger = this.sys.comps['megger'];
                    if (megger && megger.isCranking()) return false;
                    return !_sameCluster(this.sys, 'megger_wire_l', 'ac3p_wire_u')
                        && !_sameCluster(this.sys, 'megger_wire_l', 'ac3p_wire_v')
                        && !_sameCluster(this.sys, 'megger_wire_l', 'ac3p_wire_w');
                },
            },
            {
                msg: '7. 将摇表 L 端接 V 相、E 端接地，摇动手柄测量绝缘电阻',
                mode: 'check',
                act() {
                    _connectMeggerToPhase('v');
                    const megger = this.sys.comps['megger'];
                    if (megger) megger.setCranking(true);
                },
                check() {
                    const megger = this.sys.comps['megger'];
                    if (!megger || !megger.isCranking()) return false;
                    return _sameCluster(this.sys, 'megger_wire_l', 'ac3p_wire_v')
                        && _sameCluster(this.sys, 'megger_wire_e', 'ac3p_wire_n');
                },
            },
            {
                msg: '8. 将摇表 L 端接 W 相、E 端接地，摇动手柄测量绝缘电阻',
                mode: 'check',
                act() {
                    const megger = this.sys.comps['megger'];
                    if (megger) megger.setCranking(false);
                    _disconnectMegger(this.sys);
                    _connectMeggerToPhase('w');
                    if (megger) megger.setCranking(true);
                },
                check() {
                    const megger = this.sys.comps['megger'];
                    if (!megger || !megger.isCranking()) return false;
                    return _sameCluster(this.sys, 'megger_wire_l', 'ac3p_wire_w')
                        && _sameCluster(this.sys, 'megger_wire_e', 'ac3p_wire_n');
                },
            },
            {
                msg: '9. 修复 V 相绝缘故障',
                mode: 'check',
                act() {
                    const r = this.sys.comps['r_v'];
                    if (r) { r.value = 5e6; r.currentResistance = 5e6; r.update?.(); }
                },
                check() {
                    const r = this.sys.comps['r_v'];
                    return r && r.value >= 5e6;
                },
            },
            {
                msg: '10. 测试题：摇表使用注意事项',
                mode: 'quiz',
                quizConfig: {
                    question: '使用摇表测量绝缘电阻时，以下哪项操作是正确的？',
                    options: [
                        '被测设备带电时可直接测量',
                        '摇动手柄速度越快越好',
                        '测量前应先断开被测设备电源并放电',
                        '摇表 L、E 端可以任意接线'
                    ],
                    answer: 2,
                    analysis: '使用摇表前必须断开被测设备电源并进行放电处理，以确保人身安全和设备安全。摇动手柄应保持额定转速（约120r/min），并非越快越好。',
                },
            },
        ],
    },
    'motor-insulation': {
        id: 'motor-insulation',
        name: '2. 三相异步电动机各相绝缘电阻测量',
        steps: [
            {
                msg: '1. 兆欧表开路测试：摇动手柄，指针应指向 ∞',
                mode: 'check',
                act() {
                    const megger = this.sys.comps['megger'];
                    if (megger) {
                        megger.setCranking(true);
                        megger._stopValue = null;
                    }
                },
                check() {
                    const megger = this.sys.comps['megger'];
                    if (!megger || !megger.isCranking()) return false;
                    const r = megger.getResistance();
                    return !isFinite(r) || r >= 500;
                },
            },
            {
                msg: '2. 兆欧表短路测试：L-E 短接后摇动手柄，指针应指向 0',
                mode: 'check',
                act() {
                    _shortMeggerLE(this.sys);
                    const megger = this.sys.comps['megger'];
                    if (megger) {
                        megger._stopValue = null;
                        megger.setCranking(true);
                    }
                },
                check() {
                    const megger = this.sys.comps['megger'];
                    if (!megger || !megger.isCranking()) return false;
                    const r = megger.getResistance();
                    return isFinite(r) && r < 0.2;
                },
            },
            {
                msg: '3. 将摇表 L 端接电动机 U 相、E 端接 PE，摇动手柄测量绝缘电阻',
                mode: 'check',
                act() {
                    _connectMeggerToMotorPhase(this.sys, '1');
                    const megger = this.sys.comps['megger'];
                    if (megger) megger.setCranking(true);
                },
                check() {
                    const megger = this.sys.comps['megger'];
                    return megger && megger.isCranking()
                        && _sameCluster(this.sys, 'megger_wire_l', 'motor_wire_l1');
                },
            },
            {
                msg: '4. 读取摇表数值，判断绝缘状况',
                mode: 'quiz',
                quizConfig: {
                    question: '正常情况下，摇表测得的电动机 U 相对地绝缘电阻约为多少？',
                    options: ['0.5 MΩ', '5 MΩ', '20 MΩ', '∞ MΩ'],
                    answer: 2,
                    analysis: '电动机各相绕组与外壳（PE）之间存在分布电容和绝缘电阻，正常绝缘电阻约为 20MΩ。若绝缘电阻过低说明绕组受潮或绝缘老化。',
                },
            },
            {
                msg: '5. 停止摇动，断开摇表与电动机的接线',
                mode: 'check',
                act() {
                    const megger = this.sys.comps['megger'];
                    if (megger) megger.setCranking(false);
                    _disconnectMegger(this.sys);
                },
                check() {
                    const megger = this.sys.comps['megger'];
                    if (megger && megger.isCranking()) return false;
                    return !_sameCluster(this.sys, 'megger_wire_l', 'motor_wire_l1')
                        && !_sameCluster(this.sys, 'megger_wire_l', 'motor_wire_l2')
                        && !_sameCluster(this.sys, 'megger_wire_l', 'motor_wire_l3');
                },
            },
            {
                msg: '6. 将摇表 L 端接电动机 V 相、E 端接 PE，摇动手柄测量绝缘电阻',
                mode: 'check',
                act() {
                    _connectMeggerToMotorPhase(this.sys, '2');
                    const megger = this.sys.comps['megger'];
                    if (megger) megger.setCranking(true);
                },
                check() {
                    const megger = this.sys.comps['megger'];
                    if (!megger || !megger.isCranking()) return false;
                    return _sameCluster(this.sys, 'megger_wire_l', 'motor_wire_l2');
                },
            },
            {
                msg: '7. 将摇表 L 端接电动机 W 相、E 端接 PE，摇动手柄测量绝缘电阻',
                mode: 'check',
                act() {
                    const megger = this.sys.comps['megger'];
                    if (megger) megger.setCranking(false);
                    _disconnectMegger(this.sys);
                    _connectMeggerToMotorPhase(this.sys, '3');
                    if (megger) megger.setCranking(true);
                },
                check() {
                    const megger = this.sys.comps['megger'];
                    if (!megger || !megger.isCranking()) return false;
                    return _sameCluster(this.sys, 'megger_wire_l', 'motor_wire_l3');
                },
            },
            {
                msg: '8. V 相绝缘检查并修复',
                mode: 'check',
                act() {
                    const motor = this.sys.comps['motor'];
                    if (motor) motor.vohm = 20e6;
                },
                check() {
                    const motor = this.sys.comps['motor'];
                    return motor && motor.vohm >= 5e6;
                },
            },
            {
                msg: '9. 测试题：三相异步电动机绝缘测量',
                mode: 'quiz',
                quizConfig: {
                    question: '关于三相异步电动机绝缘电阻测量，以下说法正确的是？',
                    options: [
                        '三相绕组绝缘电阻应分别测量',
                        '只需测量一相即可代表全部',
                        '绝缘电阻大于 10MΩ 才合格',
                        '测量时电动机应处于运行状态'
                    ],
                    answer: 0,
                    analysis: '三相异步电动机的 U、V、W 三相绕组应分别对地（外壳/PE）测量绝缘电阻，各相绝缘电阻应分别合格。不同电压等级的电动机绝缘合格标准不同，一般低压电机不低于 0.5MΩ。',
                },
            },
        ],
    },
};

function _doPresetWiring(sys) {
    sys.conns = [];
    const presetConns = [
        { from: 'ac3p_wire_u', to: 'r_u_wire_l', type: 'wire' },
        { from: 'r_u_wire_r', to: 'gnd_wire_gnd', type: 'wire' },
        { from: 'ac3p_wire_v', to: 'r_v_wire_l', type: 'wire' },
        { from: 'r_v_wire_r', to: 'gnd_wire_gnd', type: 'wire' },
        { from: 'ac3p_wire_w', to: 'r_w_wire_l', type: 'wire' },
        { from: 'r_w_wire_r', to: 'gnd_wire_gnd', type: 'wire' },
        { from: 'ac3p_wire_n', to: 'gnd2_wire_gnd', type: 'wire' },
    ];
    presetConns.forEach(c => sys.connMgr.addConn(c));
    sys.redrawAll();
}

function _connectMeggerToPhase(phase) {
    const sys = window.sys;
    if (!sys) return;
    const megger = sys.comps['megger'];
    if (!megger) return;
    const phasePort = `ac3p_wire_${phase}`;
    const gndPort = 'gnd_wire_gnd';
    const lPort = 'megger_wire_l';
    const ePort = 'megger_wire_e';
    const existing = sys.conns.filter(c =>
        (c.from === lPort || c.to === lPort || c.from === ePort || c.to === ePort));
    existing.forEach(c => sys.connMgr.removeConn(c));
    sys.connMgr.addConn({ from: lPort, to: phasePort, type: 'wire' });
    sys.connMgr.addConn({ from: ePort, to: gndPort, type: 'wire' });
    sys.redrawAll();
}

export const componentConfigs = [
    { Class: ACPower3P, id: 'ac3p', x: 30, y: 20, vRms: 220, freq: 50, isOn: true },
    { Class: Ground, id: 'gnd2', x: 320, y: 120 },
    { Class: Resistor, id: 'r_u', x: 100, y: 320, value: 5e6, label: '5MΩ' },
    { Class: Resistor, id: 'r_v', x: 360, y: 290, value: 0.5e6, label: '5MΩ' },
    { Class: Resistor, id: 'r_w', x: 620, y: 260, value: 5e6, label: '5MΩ' },
    { Class: Ground, id: 'gnd', x: 450, y: 420 },

    { Class: Megohmmeter, id: 'megger', x: 820, y: 60, voltage: 500, resistance: Infinity, cranking: false },
    { Class: ThreePhaseMotor, id: 'motor', x: 30, y: 480, initState: 'stop', uohm: 20e6, vohm: 0.5e6, wohm: 20e6 },

    { Class: Oscilloscope_tri, id: 'osc3', x: 1050, y: 60, visible: false },
    { Class: SignalGenerator, id: 'sg', x: 100, y: 60, visible: false },
    { Class: Multimeter, id: 'multimeter', x: 800, y: 300, scale: 1.2, visible: false },
    { Class: AmpMeter, id: 'ampmeter', x: 350, y: 60, visible: false },
    { Class: ProcessCalibrator, id: 'cali', x: 550, y: 60, visible: false },
    { Class: MF47Multimeter, id: 'mf47-panel', x: 680, y: 60, rangeMode: 'ACV_500', visible: false },
];

export function initSlider(sys) {
    const toolbar = document.getElementById('toolbar');

    const existing = document.getElementById('megohmmeterCtrl');
    if (existing) existing.remove();

    const container = document.createElement('div');
    container.id = 'megohmmeterCtrl';
    container.style.cssText = 'display:inline-flex;align-items:center;gap:8px;margin-left:12px;';
    container.innerHTML = '\
        <span style="font-size:12px;font-weight:bold;color:white;">三相电源:</span>\
        <button id="powerToggle3p" style="padding:4px 12px;font-size:12px;background:#2d8cf0;color:white;border:none;border-radius:4px;cursor:pointer;font-weight:bold;">开启</button>\
        <span style="font-size:12px;color:#888;">|</span>\
        <span style="font-size:12px;font-weight:bold;color:white;">相电压:</span>\
        <span id="voltageDisplay3p" style="font-size:12px;min-width:50px;color:#0f0;">220 V</span>\
        <span style="font-size:12px;color:#888;">|</span>\
        <span style="font-size:12px;font-weight:bold;color:white;">摇表:</span>\
        <button id="meggerCrankBtn" style="padding:4px 12px;font-size:12px;background:#f0a030;color:white;border:none;border-radius:4px;cursor:pointer;font-weight:bold;">摇动</button>\
        <span id="meggerReadingDisplay" style="font-size:12px;min-width:60px;color:#f80;">— MΩ</span>\
    ';
    toolbar.appendChild(container);

    const powerBtn = document.getElementById('powerToggle3p');
    powerBtn.onclick = () => {
        const power = sys.comps['ac3p'];
        if (!power) return;
        power.isOn = !power.isOn;
        power.update?.();
        powerBtn.textContent = power.isOn ? '关闭' : '开启';
        powerBtn.style.background = power.isOn ? '#e03030' : '#2d8cf0';
        const vd = document.getElementById('voltageDisplay3p');
        if (vd) vd.textContent = power.isOn ? `${power.vRms} V` : '0 V';
    };

    const crankBtn = document.getElementById('meggerCrankBtn');
    crankBtn.onclick = () => {
        const megger = sys.comps['megger'];
        if (!megger) return;
        const next = !megger.isCranking();
        megger.setCranking(next);
        crankBtn.textContent = next ? '停止' : '摇动';
        crankBtn.style.background = next ? '#e03030' : '#f0a030';
    };

    if (!sys._meggerPollTimer) {
        sys._meggerPollTimer = setInterval(() => {
            const megger = sys.comps['megger'];
            const rd = document.getElementById('meggerReadingDisplay');
            if (megger && rd) {
                const r = megger.getResistance();
                if (!megger.isCranking()) {
                    rd.textContent = '— MΩ';
                } else if (!isFinite(r) || r >= 1e9) {
                    rd.textContent = '∞ MΩ';
                } else {
                    rd.textContent = r >= 1000
                        ? (r / 1000).toFixed(1) + 'G MΩ'
                        : r.toFixed(r < 10 ? 1 : 0) + ' MΩ';
                }
            }
        }, 200);
    }
}

export function applyAllPresets() {
    _doPresetWiring(this.sys);
}

export async function applyStartSystem() {
    const sys = this.sys;
    _doPresetWiring(sys);
    const power = sys.comps['ac3p'];
    if (power) {
        power.vRms = 220;
        power.isOn = true;
        power.update?.();
    }
    const megger = sys.comps['megger'];
    if (megger) {
        megger.setResistance(5e6);
    }
    // 默认触发 V 相绝缘老化故障
    const rv = sys.comps['r_v'];
    if (rv) { rv.value = 0.5e6; rv.currentResistance = 0.5e6; rv.update?.(); }
    const vd = document.getElementById('voltageDisplay3p');
    if (vd) vd.textContent = '220 V';
    const powerBtn = document.getElementById('powerToggle3p');
    if (powerBtn) {
        powerBtn.textContent = '关闭';
        powerBtn.style.background = '#e03030';
    }
}

function _disconnectMegger(sys) {
    const lPort = 'megger_wire_l';
    const ePort = 'megger_wire_e';
    const existing = sys.conns.filter(c =>
        (c.from === lPort || c.to === lPort || c.from === ePort || c.to === ePort));
    existing.forEach(c => sys.connMgr.removeConn(c));
    sys.redrawAll();
}

/** 短路摇表 L-E 端 */
function _shortMeggerLE(sys) {
    const lPort = 'megger_wire_l';
    const ePort = 'megger_wire_e';
    const existing = sys.conns.filter(c =>
        (c.from === lPort || c.to === lPort || c.from === ePort || c.to === ePort));
    existing.forEach(c => sys.connMgr.removeConn(c));
    sys.connMgr.addConn({ from: lPort, to: ePort, type: 'wire' });
    sys.redrawAll();
}

/** 将摇表 L 接电动机相端子、E 接 PE */
function _connectMeggerToMotorPhase(sys, phase) {
    const lPort = 'megger_wire_l';
    const ePort = 'megger_wire_e';
    const existing = sys.conns.filter(c =>
        (c.from === lPort || c.to === lPort || c.from === ePort || c.to === ePort));
    existing.forEach(c => sys.connMgr.removeConn(c));
    sys.connMgr.addConn({ from: lPort, to: `motor_wire_l${phase}`, type: 'wire' });
    sys.connMgr.addConn({ from: ePort, to: 'motor_wire_pe', type: 'wire' });
    sys.redrawAll();
}

/** 检查两个端口是否在同一个电路簇中 */
function _sameCluster(sys, portA, portB) {
    const map = sys.voltageSolver?.portToCluster;
    if (!map) return false;
    const cA = map.get(portA);
    const cB = map.get(portB);
    return cA !== undefined && cA === cB;
}

export function fiveStep() {}
