/**
 * AI.constants.js — 模拟量输入模块常量与通道配置
 * 船舶机舱监测报警系统 · CAN 总线架构
 */

// ─────────────────────────────────────────────
//  模块尺寸
// ─────────────────────────────────────────────
export const W = 200;   // 模块主体宽度
export const H = 340;   // 模块主体高度

// ─────────────────────────────────────────────
//  通道配置
// ─────────────────────────────────────────────
/** 4个通道的配置数组：ID、标签、类型和垂直位置 */
export const CH_CONFIG = [
    { id: 'ch1', label: 'CH1', type: '4-20mA', yPort: 60 },
    { id: 'ch2', label: 'CH2', type: '4-20mA', yPort: 100 },
    { id: 'ch3', label: 'RTD', type: 'RTD',    yPort: 140 },
    { id: 'ch4', label: 'TC',  type: 'TC',     yPort: 180 },
];

// ─────────────────────────────────────────────
//  默认通道数据
// ─────────────────────────────────────────────
/** 返回默认的通道数据对象（每次调用返回全新副本） */
export function defaultChannels() {
    return {
        ch1: { value: 0, raw: 0,       fault: false, faultText: null, mode: 'normal', type: '4-20mA' },
        ch2: { value: 0, raw: 0,       fault: false, faultText: null, mode: 'disable', type: '4-20mA' },
        ch3: { value: 0, raw: 1e9,   fault: false, faultText: null, mode: 'normal', type: 'RTD'    }, // PT100 初始值 100.5Ω 对应 ~20°C
        ch4: { value: -100, raw: -100,       fault: false, faultText: null, mode: 'disable', type: 'TC'     }, // K型 @ 20°C ≈ 0.8mV
    };
}

/** 返回默认的量程配置（每次调用返回全新副本） */
export function defaultRanges() {
    return {
        ch1: { lrv: 0,   urv: 100,  unit: '%' },
        ch2: { lrv: 0,   urv: 100,   unit: '%' },
        ch3: { lrv: -200, urv: 850, unit: '°C'  },
        ch4: { lrv: -200,   urv: 1800, unit: '°C'  },
    };
}

/** 返回默认的报警阈值（每次调用返回全新副本） */
export function defaultAlarms() {
    return {
        ch1: { hh: 90,  h: 80,  l: 20,   ll: 10,  status: 'normal' },
        ch2: { hh: 90,  h: 80,  l: 20, ll: 10,  status: 'normal' },
        ch3: { hh: 500,  h: 450,  l: -20,   ll: -40,  status: 'normal' },
        ch4: { hh: 380,  h: 350,  l: 10,  ll: 5,    status: 'normal' },
    };
}