/**
 * 001 简单3D电路的搭建 —— three.js 真 3D 实验台工程（单页）
 *
 * 组件构成：
 *   lab3d  Circuit3DScene   3D 实验台宿主（桌面 + 四腿 + 3D 交互 + 3D 电缆）
 *   bat    Battery3D        电池（直流源，type='source'，端口 p/n）
 *   sw     Switch3D         闸刀开关（type='switch'，端口 l/r，点击闸刀合/分闸）
 *   bulb   Bulb3D           灯泡（type='resistor'，端口 l/r，点亮发光）
 *   另含 7 种隐藏仪表（平台保留规则）
 *
 * 教学回路：电池正极 → 开关左端；开关右端 → 灯泡左端；
 *           灯泡右端 → 电池负极。合闸 → 灯亮，分闸 → 灯灭。
 */
import { Circuit3DScene } from '../3dcomps/Circuit3DScene.js';
import { Battery3D } from '../3dcomps/Battery3D.js';
import { Switch3D } from '../3dcomps/Switch3D.js';
import { Bulb3D } from '../3dcomps/Bulb3D.js';

import { Multimeter } from '../components/Multimeter.js';
import { MF47Multimeter } from '../components/MF47Multimeter.js';
import { Oscilloscope_tri } from '../components/Osc_tri.js';
import { SignalGenerator } from '../components/SignalGenerator.js';
import { ProcessCalibrator } from '../components/ProcessCalibrator.js';
import { ElecMeter } from '../components/ElecMeter.js';
import { RealMegohmMeter } from '../components/RealMegohmMeter.js';

// ── 工具 ──────────────────────────────────────────────────────────
// 调用方可能是 ControlSystem（this.sys 不存在）或 WorkflowManager（this.sys 存在）
const _sysOf = (ctx) => (ctx && ctx.sys) ? ctx.sys : window.sys;
const _sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 标准回路连线定义
const CIRCUIT = [
    { from: 'bat_wire_p', to: 'sw_wire_l' },
    { from: 'sw_wire_r', to: 'bulb_wire_l' },
    { from: 'bulb_wire_r', to: 'bat_wire_n' },
];
const DEV_PORTS = [
    'bat_wire_p', 'bat_wire_n',
    'sw_wire_l', 'sw_wire_r',
    'bulb_wire_l', 'bulb_wire_r',
];

function _clear3DWires(sys) {
    sys.conns
        .filter(c => c.type === 'wire' && DEV_PORTS.includes(c.from) && DEV_PORTS.includes(c.to))
        .forEach(c => sys.connMgr.removeConn(c));
}

function _wireAll(sys) {
    for (const d of CIRCUIT) sys.connMgr.addConn({ ...d, type: 'wire' });
}

function _tip(sys, msg, ms = 2600) {
    if (sys && typeof sys.showFloatingTip === 'function') {
        try { sys.showFloatingTip(msg, ms); } catch (e) { /* ignore */ }
    }
}

// ── 组件布局（1920×1080 基准坐标）────────────────────────────────
export const componentConfigs = [
    // 7 种平台保留仪表（默认隐藏，右侧条带排布，避开 3D 视窗）
    { Class: Multimeter, id: 'multimeter', x: 1655, y: 70, visible: false },
    { Class: MF47Multimeter, id: 'mf47-panel', x: 1655, y: 200, visible: false },
    { Class: Oscilloscope_tri, id: 'osc', x: 1655, y: 330, visible: false },
    { Class: SignalGenerator, id: 'sg', x: 1655, y: 460, visible: false },
    { Class: ProcessCalibrator, id: 'cali', x: 1655, y: 590, visible: false },
    { Class: ElecMeter, id: 'elecmeter', x: 1655, y: 720, visible: false },
    { Class: RealMegohmMeter, id: 'megohm', x: 1655, y: 850, visible: false },    
    
    // 3D 实验台宿主（WebGL 视窗区）
    { Class: Circuit3DScene, id: 'lab3d', x: 50, y: 50, width: 1600, height: 880 },

    // 三个 3D 器件（组位置与宿主视窗原点一致，端口锚点由宿主投影同步）
    { Class: Battery3D, id: 'bat', x: 250, y: 150, hostId: 'lab3d' },
    { Class: Switch3D, id: 'sw', x: 250, y: 150, hostId: 'lab3d' },
    { Class: Bulb3D, id: 'bulb', x: 250, y: 150, hostId: 'lab3d' },
];

// ── 滑块（本工程无）────────────────────────────────────────────
export function initSlider() { /* 本工程无滑块 */ }

// ── 工具栏「自动接线」────────────────────────────────────────────
export function applyAllPresets(opts) {
    if (opts && opts.init) return;           // 初始化阶段不预接线
    const sys = _sysOf(this);
    _clear3DWires(sys);
    _wireAll(sys);
    _tip(sys, '自动接线完成：电池 → 开关 → 灯泡。点击闸刀手柄合闸点亮！', 3200);
}

// ── 工具栏「启动系统」────────────────────────────────────────────
export async function applyStartSystem() {
    const sys = _sysOf(this);
    _clear3DWires(sys);
    _wireAll(sys);
    await _sleep(500);                       // 等待 3D 电缆生长动画
    const sw = sys.comps['sw'];
    if (sw && !sw.isOn) sw.toggle();         // 合闸
    _tip(sys, '系统起动：回路已接通并合闸，灯泡点亮。', 3000);
}

// ── 工具栏「分步演示」（每按一次前进一步，5 步循环）──────────────
export async function fiveStep() {
    const sys = _sysOf(this);
    sys._fiveStepIdx = sys._fiveStepIdx || 0;
    const i = sys._fiveStepIdx % 5;

    const addOne = (d, msg) => {
        sys.connMgr.addConn({ ...d, type: 'wire' });
        _tip(sys, msg, 3200);
    };

    if (i === 0) {
        _clear3DWires(sys);
        addOne(CIRCUIT[0], '第 1 步：接「电池正极(红) → 开关左端」');
    } else if (i === 1) {
        addOne(CIRCUIT[1], '第 2 步：接「开关右端 → 灯泡左端」');
    } else if (i === 2) {
        addOne(CIRCUIT[2], '第 3 步：接「灯泡右端 → 电池负极」，回路闭合');
    } else if (i === 3) {
        const sw = sys.comps['sw'];
        if (sw && !sw.isOn) sw.toggle();
        _tip(sys, '第 4 步：合闸！灯泡点亮', 3000);
    } else {
        const sw = sys.comps['sw'];
        if (sw && sw.isOn) sw.toggle();
        _tip(sys, '第 5 步：分闸，灯泡熄灭。继续点按将从第 1 步重新开始', 3400);
    }
    sys._fiveStepIdx++;
}

// ── 故障 / 工作流 / 页面（本工程均为空）─────────────────────────
export const FAULT_CONFIGS = {};
export const PROJECT_WORKFLOWS = {};
export const PROJECT_PAGES = [];
