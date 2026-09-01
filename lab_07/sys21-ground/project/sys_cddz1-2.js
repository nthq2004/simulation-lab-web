
import { Multimeter } from '../components/Multimeter.js';
import { MF47Multimeter } from '../components/MF47Multimeter.js';
import { Oscilloscope_tri } from '../components/Osc_tri.js';
import { SignalGenerator } from '../components/SignalGenerator.js';
import { ProcessCalibrator } from '../components/ProcessCalibrator.js';
import { ElecMeter } from '../components/ElecMeter.js';
import { RealMegohmMeter } from '../components/RealMegohmMeter.js';
import { MotorControlBox } from '../components/MotorControlBox.js';



export const FAULT_CONFIGS = {

};

export const PROJECT_WORKFLOWS = {

};

export const componentConfigs = [
 
    // ── 测量仪表（隐藏，按需显示）──
    { Class: Multimeter, id: 'multimeter', x: 500, y: 100, visible: false },
    { Class: MF47Multimeter, id: 'mf47-panel', x: 650, y: 100, visible: false },
    { Class: Oscilloscope_tri, id: 'osc', x: 50, y: 50, visible: false },
    { Class: SignalGenerator, id: 'sg', x: 50, y: 50, visible: false },
    { Class: ProcessCalibrator, id: 'cali', x: 50, y: 50, visible: false },
    { Class: ElecMeter, id: 'elecmeter', x: 50, y: 50, visible: false },
    // ── 手摇式兆欧表（摇表，2500V 型；隐藏，测试绝缘时按需调出）──
    { Class: RealMegohmMeter, id: 'megohm', x: 200, y: 50, voltage: 2500, label: '手摇兆欧表(2500V)', visible: false },
    // ── 电机控制箱（打开状态，内含供电开关/设备/端子/保护接地）──
    { Class: MotorControlBox, id: 'motor-control-box', x: 280, y: 50, visible: true },

];

// ─── 接线辅助 ───

const _sleep = ms => new Promise(r => setTimeout(r, ms));



function _autoWire(sys) {
    sys.conns.length = 0;
    const cons = [];
    cons.forEach(c => sys.connMgr.addConn(c));
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
 
}

export function fiveStep() {
}
