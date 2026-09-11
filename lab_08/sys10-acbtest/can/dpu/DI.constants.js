/**
 * DI.constants.js — 数字量输入模块：常量与默认数据工厂
 * 船舶机舱监测报警系统 · CAN 总线架构
 */

export const W = 200;
export const H = 340;

export const CH_CONFIG = [
    { id: 'ch1', label: 'CH1', type: 'DRY', desc: 'Dry NC' },
    { id: 'ch2', label: 'CH2', type: 'DRY', desc: 'Dry NC' },
    { id: 'ch3', label: 'CH3', type: 'WET', desc: 'Wet 24V' },
    { id: 'ch4', label: 'CH4', type: 'WET', desc: 'Wet 24V' },
];

export const DEBOUNCE_MS = 20;

export function defaultChannels() {
    return {
        ch1: { type: 'DRY', state: false, raw: false, debounceAt: 0, fault: false, counter: 0, lastEdge: null },
        ch2: { type: 'DRY', state: false, raw: false, debounceAt: 0, fault: false, counter: 0, lastEdge: null },
        ch3: { type: 'WET', state: false, raw: false, debounceAt: 0, fault: false, counter: 0, lastEdge: null, voltage: 0 },
        ch4: { type: 'WET', state: false, raw: false, debounceAt: 0, fault: false, counter: 0, lastEdge: null, voltage: 0 },
    };
}

export function defaultAlarmConfig() {
    return {
        ch1: { trigger: 'OFF', label: 'CH1 ALARM' },
        ch2: { trigger: 'ON', label: 'CH2 ALARM' },
        ch3: { trigger: 'ON', label: 'CH3 ALARM' },
        ch4: { trigger: 'ON', label: 'CH4 ALARM' },
    };
}
