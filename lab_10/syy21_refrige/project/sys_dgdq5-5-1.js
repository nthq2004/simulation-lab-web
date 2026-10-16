// ═══════════════════════════════════════════════════════════════
// 制冷系统的自动控制、安全保护及故障处理（syy21_refrige）
//
// 单页布局（1920 × 1080）：
//   · 制冷系统（RefrigerationSystem）—— 左侧整幅工艺流程图：5 个冷库
//     （干货库/粮库/菜库/鱼库/肉库）、回热器、两台压缩机、两台油液分离器、
//     两台冷凝器、干燥&过滤、接收器，及各管路与 P/T/G 标注；
//   · 压缩机控制（CompressorControlPanel）—— 右上；
//   · 温度设置（TempSettingPanel）—— 右中；
//   · 安保报警（SafetyAlarmPanel）—— 右下。
//
// 物理求解：RefrigerationSolver（2 机 5 库，R407C 近似）。
// 报警本期只做显示与复位（不注入可设置故障）。
// ═══════════════════════════════════════════════════════════════

import { RefrigerationSystem } from '../components/RefrigerationSystem.js';
import { CompressorControlPanel } from '../components/CompressorControlPanel.js';
import { TempSettingPanel } from '../components/TempSettingPanel.js';
import { SafetyAlarmPanel } from '../components/SafetyAlarmPanel.js';

import { Multimeter } from '../components/Multimeter.js';
import { MF47Multimeter } from '../components/MF47Multimeter.js';
import { Oscilloscope_tri } from '../components/Osc_tri.js';
import { SignalGenerator } from '../components/SignalGenerator.js';
import { ProcessCalibrator } from '../components/ProcessCalibrator.js';
import { ElecMeter } from '../components/ElecMeter.js';
import { RealMegohmMeter } from '../components/RealMegohmMeter.js';

const _sysOf = (ctx) => (ctx && ctx.sys) ? ctx.sys : window.sys;

// ═══════════════════════════════════════════════════════════════
// 页面定义
// ═══════════════════════════════════════════════════════════════

const PAGE1_COMPS = [
    'refsys', 'cpanel', 'temppanel', 'alarmpanel',
    'multimeter', 'mf47-panel', 'osc', 'sg', 'cali', 'elecmeter', 'megohm',
];

export const PROJECT_PAGES = [
    { id: 0, name: '索引', type: 'index' },
    {
        id: 1, name: '制冷系统的自动控制、安全保护及故障处理',
        comps: PAGE1_COMPS,
        desc: '左侧：制冷系统工艺流程（5 个冷库蒸发器、回热器、两台压缩机/油液分离器/冷凝器、干燥&过滤、接收器）。右侧：压缩机操作台、冷库温度设定、安全保护/报警。',
    },
];

// ═══════════════════════════════════════════════════════════════
// 组件配置（1920 × 1080 基准坐标）
// ═══════════════════════════════════════════════════════════════

export const componentConfigs = [
    // 制冷系统（左侧整幅工艺流程图，1250 × 850）
    { Class: RefrigerationSystem, id: 'refsys', x: -150, y: 10, page: 1, width: 1250, height: 850, visible: true },

    // 右侧三个面板
    { Class: CompressorControlPanel, id: 'cpanel', x: 1420, y: 30, page: 1, width: 455, height: 415, activeComp: 'comp1', visible: true },
    { Class: TempSettingPanel, id: 'temppanel', x: 1420, y: 455, page: 1, width: 455, height: 285, visible: true },
    { Class: SafetyAlarmPanel, id: 'alarmpanel', x: 1420, y: 750, page: 1, width: 455, height: 300, visible: true },

    // 仪表（默认隐藏，供「选择仪表」调出）
    { Class: Multimeter, id: 'multimeter', x: 1120, y: 200, visible: false },
    { Class: MF47Multimeter, id: 'mf47-panel', x: 1050, y: 150, visible: false },
    { Class: Oscilloscope_tri, id: 'osc', x: 50, y: 50, visible: false },
    { Class: SignalGenerator, id: 'sg', x: 50, y: 50, visible: false },
    { Class: ProcessCalibrator, id: 'cali', x: 50, y: 50, visible: false },
    { Class: ElecMeter, id: 'elecmeter', x: 50, y: 50, visible: false },
    { Class: RealMegohmMeter, id: 'megohm', x: 50, y: 50, visible: false },
];

// ═══════════════════════════════════════════════════════════════
// 工具栏快捷操作
// ═══════════════════════════════════════════════════════════════

export function initSlider(sys) {
    if (!sys) return;
    sys._noBlinkHighlight = true;
    sys.pageIndexTitle = '制冷系统的自动控制、安全保护及故障处理 · 页面索引';
}

/** 一键自动接线：本工程工艺管路已内绘，无需外部接线 */
export function applyAllPresets(opts) {
    if (opts && opts.init) return;
    const sys = _sysOf(this);
    if (sys && sys.redrawAll) sys.redrawAll();
}

/** 启动系统：操作台置自动、两机投入自动控制 */
export async function applyStartSystem() {
    const sys = _sysOf(this);
    if (!sys) return;
    const panel = sys.comps && sys.comps['cpanel'];
    if (panel) { panel.mode = 'auto'; panel._syncVisuals && panel._syncVisuals(); }
    const s = sys.refrigSolver;
    if (s && s.m) {
        s.m.mode = 'auto';
        s.m.comps.comp1.manualRun = true;
        s.m.comps.comp2.manualRun = true;
        s.m.trip = false;
        s.m.resetPulse = true;
    }
    sys.redrawAll && sys.redrawAll();
    await new Promise(r => setTimeout(r, 300));
}

/** 5 点步进：演示环境温度（热负荷）阶梯变化 */
export function fiveStep() {
    const sys = _sysOf(this);
    if (!sys || !sys.refrigSolver) return;
    const steps = [28, 32, 36, 40, 32];
    if (sys._fiveStepIdx === undefined || sys._fiveStepIdx >= steps.length) sys._fiveStepIdx = 0;
    sys.refrigSolver._params.ambient = steps[sys._fiveStepIdx];
    sys._fiveStepIdx = (sys._fiveStepIdx + 1) % steps.length;
    sys.redrawAll && sys.redrawAll();
}

// ═══════════════════════════════════════════════════════════════
// 故障 / 流程（本期留空：报警只做显示与复位）
// ═══════════════════════════════════════════════════════════════

export const FAULT_CONFIGS = {};

export const PROJECT_WORKFLOWS = {};
