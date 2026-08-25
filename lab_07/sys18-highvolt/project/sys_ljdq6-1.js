// 高压同步发电机仿真工程（只保留真空断路器）

import { VacuumCircuitBreaker } from '../components/VacuumCircuitBreaker.js';
import { Multimeter } from '../components/Multimeter.js';
import { MF47Multimeter } from '../components/MF47Multimeter.js';
import { Oscilloscope_tri } from '../components/Osc_tri.js';
import { SignalGenerator } from '../components/SignalGenerator.js';
import { ProcessCalibrator } from '../components/ProcessCalibrator.js';
import { ElecMeter } from '../components/ElecMeter.js';

function _fcomp(id) {
    const s = window.sys;
    return s && s.comps && s.comps[id] ? s.comps[id] : null;
}

export const FAULT_CONFIGS = {

};

export const PROJECT_WORKFLOWS = {

};

export const componentConfigs = [
    // ── 真空断路器（唯一保留的组件）──
    { 
        Class: VacuumCircuitBreaker, 
        id: 'qf1', 
        x: 100, 
        y: 200, 
        ratedCtrlVoltage: 24, 
        label: '10kV真空断路器', 
        genId: '', 
        revPowerKw: 300, 
        revTime: 5, 
        faultSimpleProtect: true, 
        visible: true 
    },

    // ── 测量仪表（隐藏，按需显示）──
    { Class: Multimeter, id: 'multimeter', x: 500, y: 100, visible: false },
    { Class: MF47Multimeter, id: 'mf47-panel', x: 650, y: 100, visible: false },
    { Class: Oscilloscope_tri, id: 'osc', x: 50, y: 50, visible: false },
    { Class: SignalGenerator, id: 'sg', x: 50, y: 50, visible: false },
    { Class: ProcessCalibrator, id: 'cali', x: 50, y: 50, visible: false },
    { Class: ElecMeter, id: 'elecmeter', x: 50, y: 50, visible: false },
];

// ─── 接线辅助 ───

const _sleep = ms => new Promise(r => setTimeout(r, ms));

function _autoWire(sys) {
    // 当前只有真空断路器，无需自动接线
    sys.conns.length = 0;
    sys.redrawAll();
}

export function initSlider(_sys) {
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
    
    // 真空断路器复位
    const q1 = sys.comps.qf1;
    if (q1) {
        // 如果断路器在合闸状态，先分闸
        if (q1.getState() === 'on' && q1.tryTrip) {
            q1.tryTrip();
        }
        // 恢复储能状态
        if (q1._chargeProg !== undefined) { 
            q1._chargeProg = 5; 
            q1._charged = true; 
        }
    }
}

export function fiveStep() {
}
