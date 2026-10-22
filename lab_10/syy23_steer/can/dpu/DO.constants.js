/**
 * DO.constants.js — 数字量输出模块：常量与默认数据工厂
 * 船舶机舱监测报警系统 · CAN 总线架构
 */

export const W = 200;
export const H = 340;

export const CH_CONFIG = [
    { id: 'ch1', label: 'CH1', type: 'RELAY', desc: 'Relay NO' },
    { id: 'ch2', label: 'CH2', type: 'RELAY', desc: 'Relay NO' },
    { id: 'ch3', label: 'CH3', type: 'WET24', desc: '24V PNP' },
    { id: 'ch4', label: 'CH4', type: 'WET24', desc: '24V PNP' },
];

export function defaultChannels() {
    return {
        ch1: { type: 'RELAY', state: false, fault: false, hold: false, toggleCnt: 0, coilOK: true, mode: 'hand' },
        ch2: { type: 'RELAY', state: false, fault: false, hold: false, toggleCnt: 0, coilOK: true, mode: 'hand' },
        ch3: { type: 'WET24', state: false, fault: false, hold: false, loadMA: 0, mode: 'auto' },
        ch4: { type: 'WET24', state: false, fault: false, hold: false, loadMA: 0, mode: 'hand' },
    };
}

export function defaultSafeOutput() {
    return {
        ch1: { mode: 'off', presetState: false },
        ch2: { mode: 'off', presetState: false },
        ch3: { mode: 'off', presetState: false },
        ch4: { mode: 'off', presetState: false },
    };
}

export function defaultPulseConfig() {
    return {
        ch1: { active: false, onMs: 500, offMs: 500, phaseStart: 0 },
        ch2: { active: false, onMs: 500, offMs: 500, phaseStart: 0 },
        ch3: { active: false, onMs: 500, offMs: 500, phaseStart: 0 },
        ch4: { active: false, onMs: 500, offMs: 500, phaseStart: 0 },
    };
}
