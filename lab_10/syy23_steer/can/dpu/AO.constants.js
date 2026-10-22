/**
 * AO.constants.js — 模拟量输出模块：常量与默认数据工厂
 * 船舶机舱监测报警系统 · CAN 总线架构
 */

// ── 模块尺寸 ──
export const W = 200;
export const H = 340;

// ── 通道配置 ──
export const CH_CONFIG = [
    { id: 'ch1', label: 'CH1', type: '4-20mA', yPort: 60 },
    { id: 'ch2', label: 'CH2', type: '4-20mA', yPort: 100 },
    { id: 'ch3', label: 'CH3', type: 'PWM', yPort: 140 },
    { id: 'ch4', label: 'CH4', type: 'PWM', yPort: 180 },
];

// ── PWM 可视化更新周期 (ms) ──
export const PWM_RENDER_INTERVAL = 50;

// ── 默认通道数据工厂 ──
export function defaultChannels() {
    return {
        ch1: { type: '4-20mA', percent: 0, actual: 4.0, fault: false, hold: false, mode: 'hand' },
        ch2: { type: '4-20mA', percent: 0, actual: 4.0, fault: false, hold: false, mode: 'hand' },
        ch3: {
            type: 'PWM', percent: 0, actual: 0, fault: false, hold: false, mode: 'hand',
            frequency: 1000, pwmPhase: 0, instantOn: false,
        },
        ch4: {
            type: 'PWM', percent: 0, actual: 0, fault: false, hold: false, mode: 'hand',
            frequency: 1000, pwmPhase: 0, instantOn: false,
        },
    };
}

// ── 默认量程配置工厂 ──
export function defaultRanges() {
    return {
        ch1: { lrv: 0, urv: 100, unit: '%' },
        ch2: { lrv: 0, urv: 100, unit: '%' },
        ch3: { lrv: 0, urv: 100, unit: '%' },
        ch4: { lrv: 0, urv: 100, unit: '%' },
    };
}

// ── 默认安全输出配置工厂 ──
export function defaultSafeOutput() {
    return {
        ch1: { mode: 'hold', presetPercent: 0 },
        ch2: { mode: 'hold', presetPercent: 0 },
        ch3: { mode: 'preset', presetPercent: 50 },
        ch4: { mode: 'preset', presetPercent: 50 },
    };
}
