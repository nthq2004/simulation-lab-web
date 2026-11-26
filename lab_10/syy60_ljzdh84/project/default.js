// 项目默认配置 — 空的占位配置
// 实际项目可替换此文件中的导出，或创建新的项目配置文件。
// WorkflowManager 从此文件导入 FAULT_CONFIGS、PROJECT_WORKFLOWS、
// fiveStep、applyAllPresets、applyStartSystem。
import { Multimeter } from '../components/Multimeter.js';
import { MF47Multimeter } from '../components/MF47Multimeter.js';
import { Oscilloscope_tri } from '../components/Osc_tri.js';
import { SignalGenerator } from '../components/SignalGenerator.js';
import { ProcessCalibrator } from '../components/ProcessCalibrator.js';
import { ElecMeter } from '../components/ElecMeter.js';
import { RealMegohmMeter } from '../components/RealMegohmMeter.js';


export const FAULT_CONFIGS = {};

export const PROJECT_WORKFLOWS = {};

export const componentConfigs = [

    { Class: Multimeter, id: 'multimeter', x: 1120, y: 200, visible: false },
    { Class: MF47Multimeter, id: 'mf47-panel', x: 1050, y: 150, visible: false },
    { Class: Oscilloscope_tri, id: 'osc', x: 50, y: 50, visible: false },
    { Class: SignalGenerator, id: 'sg', x: 50, y: 50, visible: false },
    { Class: ProcessCalibrator, id: 'cali', x: 50, y: 50, visible: false },
    { Class: ElecMeter, id: 'elecmeter', x: 50, y: 50, visible: false },
    { Class: RealMegohmMeter, id: 'megohm', x: 50, y: 50, visible: false },    
];

export function initSlider(_sys) {
    // 自动演示时只保留箭头指示，不闪亮整个组件
    _sys._noBlinkHighlight = true;    
 }

export function applyAllPresets() {
    // 默认空实现，由项目配置覆盖
}

export async function applyStartSystem() {
    // 默认空实现，由项目配置覆盖
}

export function fiveStep() {
    // 默认空实现，由项目配置覆盖
}
