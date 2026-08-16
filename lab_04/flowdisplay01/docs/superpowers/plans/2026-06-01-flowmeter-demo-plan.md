# 流量计原理演示系统 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 创建独立项目展示三种流量计（差压式、叶轮式、转子）在冷却水循环回路中的工作原理

**Architecture:** 在现有仿真平台中新建项目配置 `project/flowmeter.js`，通过 PneumaticSolver 扩展实现流量分配和流量计驱动，8 个组件通过 pipe 连线构成完整的冷却水循环回路

**Tech Stack:** Konva.js, JavaScript, Vite

---

## 文件结构

| 文件 | 操作 | 职责 |
|------|------|------|
| `export.js` | 修改 | 导出 DpFlowIndicator、ImpellerFlowIndicator、Rotameter |
| `project/flowmeter.js` | 新建 | 项目配置：组件布局、自动连线、五点步进、滑块控制 |
| `tools/PneumaticSolver.js` | 修改 | 扩展 solve()、_processInternalTransfer()、_syncDevices() |
| `consys.js` | 修改 | 切换项目导入路径 |
| `lib/WorkflowManager.js` | 修改 | 切换项目导入路径 |

---

### Task 1: export.js — 添加三个流量计组件导出

**Files:**
- Modify: `export.js:21-85`（import 区域）
- Modify: `export.js:153-161`（export 区域）

- [ ] **Step 1: 在 export.js 的 import 区域添加三个流量计的导入语句**

在第 37 行 `import { ElecValve }` 之前或之后，添加：

```javascript
import { DpFlowIndicator } from './components/DpFlowIndicator.js';
import { ImpellerFlowIndicator } from './components/ImpellerFlowIndicator.js';
import { Rotameter } from './components/Rotameter.js';
```

- [ ] **Step 2: 在 export 区域添加导出**

在 `export { ... ElecValve, ...}` 所在的导出块（第 153-161 行）中，将 `ElecValve` 替换/补充为下列三个组件：

```javascript
export {
    LeakDetector, AirBottle, PressRegulator, PressMeter, TeeConnector, StopValve, Pump, Cooler, Engine, WaterBath, RealPT100, RealTC,
    WaterTankSystem, WaterTankTwoPos, WaterTankLevelControl,
    DiffTransmitter, BubbleLevelTransmitter,
    PIDController, OvenSystem, ElecValve, DpFlowIndicator, ImpellerFlowIndicator, Rotameter,
    // ... 其余不变
};
```

---

### Task 2: 创建 project/flowmeter.js — 项目配置文件

**Files:**
- Create: `project/flowmeter.js`

- [ ] **Step 1: 创建完整的项目配置骨架**

文件包含以下导出：`FAULT_CONFIGS`、`PROJECT_WORKFLOWS`、`componentConfigs`、`initSlider`、`applyAllPresets`、`applyStartSystem`、`fiveStep`。

这是整体框架代码：

```javascript
// 流量计原理演示项目
// 冷却水循环回路：Engine → Pump → Tee → (Rotameter/DpFlowIndicator→Cooler) → ElecValve → ImpellerFlowIndicator → Engine

import { Oscilloscope_tri } from '../components/Osc_tri.js';
import { SignalGenerator } from '../components/SignalGenerator.js';
import { Multimeter } from '../components/Multimeter.js';
import { AmpMeter } from '../components/AmpMeter.js';
import { ProcessCalibrator } from '../components/ProcessCalibrator.js';

import { Engine } from '../components/Engine.js';
import { Pump } from '../components/Pump.js';
import { TeeConnector } from '../components/TeeConnector.js';
import { Cooler } from '../components/Cooler.js';
import { ElecValve } from '../components/ElecValve.js';
import { DpFlowIndicator } from '../components/DpFlowIndicator.js';
import { ImpellerFlowIndicator } from '../components/ImpellerFlowIndicator.js';
import { Rotameter } from '../components/Rotameter.js';

export const FAULT_CONFIGS = {};

export const PROJECT_WORKFLOWS = {};

export const componentConfigs = [
    // 工具组件（初始隐藏）
    { Class: Oscilloscope_tri, id: 'osc3', x: 800, y: 160, visible: false },
    { Class: SignalGenerator, id: 'sg', x: 210, y: 200, visible: false },
    { Class: Multimeter, id: 'multimeter', x: 1350, y: 500, visible: false },
    { Class: AmpMeter, id: 'ampmeter', x: 450, y: 100, visible: false },
    { Class: ProcessCalibrator, id: 'cali', x: 600, y: 100, visible: false },

    // ── 冷却水循环系统组件 ──
    { Class: Engine, id: 'engine-01', x: 80, y: 320,
      label: 'ME-01', engOn: true },

    { Class: Pump, id: 'pump-01', x: 300, y: 320,
      label: 'P-01', pumpOn: true },

    { Class: TeeConnector, id: 'tee-01', x: 500, y: 340 },

    { Class: Rotameter, id: 'rotameter-01', x: 440, y: 120,
      label: 'FI-201' },

    { Class: DpFlowIndicator, id: 'dp-flow-01', x: 680, y: 280,
      label: 'FI-101' },

    { Class: Cooler, id: 'cooler-01', x: 920, y: 300,
      label: 'CL-01' },

    { Class: ElecValve, id: 'elecValve', x: 680, y: 520,
      label: 'HV-01' },

    { Class: ImpellerFlowIndicator, id: 'impeller-flow-01', x: 920, y: 520,
      label: 'FI-301' },
];
```

- [ ] **Step 2: 实现 initSlider(sys)**

```javascript
/**
 * 初始化阀位滑块（双向同步）
 * 滑块 → ElecValve（正向控制）
 * ElecValve（手轮操作）→ 滑块（反向轮询同步）
 */
export function initSlider(sys) {
    const toolbar = document.getElementById('toolbar');
    const sliderDiv = document.createElement('div');
    sliderDiv.id = 'valveSliderContainer';
    sliderDiv.style.cssText = 'display:inline-flex;align-items:center;gap:6px;margin-left:12px;';
    sliderDiv.innerHTML = `
        <span style="font-size:12px;font-weight:bold;">阀位:</span>
        <input type="range" id="valveSlider" min="0" max="100" value="0" style="width:160px;">
        <span id="valveDisplay" style="font-size:12px;min-width:50px;">0 %</span>
    `;
    toolbar.appendChild(sliderDiv);

    const slider = document.getElementById('valveSlider');
    const display = document.getElementById('valveDisplay');

    // 正向：滑块 → ElecValve
    slider.addEventListener('input', () => {
        const pos = parseFloat(slider.value);
        display.textContent = pos.toFixed(0) + ' %';
        const valve = sys.comps.elecValve;
        if (!valve) return;
        if (valve.controlMode === 'MANUAL') {
            valve.manualPos = pos / 100;
        } else {
            valve.remotePos = pos / 100;
        }
        valve.update();
        sys.requestRedraw();
    });

    // 反向：ElecValve（手轮/远程改变）→ 滑块（轮询）
    setInterval(() => {
        const valve = sys.comps.elecValve;
        if (!valve || !slider || !display) return;
        const pct = Math.round(valve.currentPos * 100);
        const currentVal = parseFloat(slider.value);
        if (Math.abs(pct - currentVal) > 1) {
            slider.value = pct;
            display.textContent = pct + ' %';
        }
    }, 200);
}
```

- [ ] **Step 3: 实现 applyAllPresets()**

```javascript
/**
 * 一键自动连线：创建全部 pipe 连接
 */
export function applyAllPresets() {
    const sys = this.sys;
    const conns = [
        { from: 'engine-01_pipe_o', to: 'pump-01_pipe_i', type: 'pipe' },
        { from: 'pump-01_pipe_o', to: 'tee-01_pipe_l', type: 'pipe' },
        { from: 'tee-01_pipe_u', to: 'rotameter-01_pipe_terminal_in', type: 'pipe' },
        { from: 'rotameter-01_pipe_terminal_out', to: 'elecValve_pipe_u', type: 'pipe' },
        { from: 'tee-01_pipe_r', to: 'dp-flow-01_pipe_terminal_in', type: 'pipe' },
        { from: 'dp-flow-01_pipe_terminal_out', to: 'cooler-01_pipe_i', type: 'pipe' },
        { from: 'cooler-01_pipe_o', to: 'elecValve_pipe_l', type: 'pipe' },
        { from: 'elecValve_pipe_r', to: 'impeller-flow-01_pipe_terminal_in', type: 'pipe' },
        { from: 'impeller-flow-01_pipe_terminal_out', to: 'engine-01_pipe_i', type: 'pipe' },
    ];
    conns.forEach(c => sys.connManager.addConn(c));
    sys.redrawAll();
}
```

- [ ] **Step 4: 实现 applyStartSystem()**

```javascript
/**
 * 启动系统：Engine 和 Pump 开启，阀位归零
 */
export async function applyStartSystem() {
    const sys = this.sys;
    const engine = sys.comps['engine-01'];
    const pump = sys.comps['pump-01'];
    if (engine) engine.engOn = true;
    if (pump) pump.pumpOn = true;

    const valve = sys.comps.elecValve;
    if (valve) {
        valve.manualPos = 0;
        valve.remotePos = 0;
        valve.update();
    }

    const slider = document.getElementById('valveSlider');
    const display = document.getElementById('valveDisplay');
    if (slider) slider.value = 0;
    if (display) display.textContent = '0 %';
}
```

- [ ] **Step 5: 实现 fiveStep()**

```javascript
/**
 * 五点步进：阀位循环 0% → 25% → 50% → 75% → 100% → 0%
 */
export function fiveStep() {
    const sys = this.sys;
    const steps = [0, 25, 50, 75, 100];
    const slider = document.getElementById('valveSlider');
    const current = slider ? parseFloat(slider.value) : 0;

    let nextVal = steps[0];
    for (const s of steps) {
        if (Math.abs(s - current) < 1) {
            const idx = steps.indexOf(s);
            nextVal = steps[(idx + 1) % steps.length];
            break;
        }
    }

    if (slider) slider.value = nextVal;
    const display = document.getElementById('valveDisplay');
    if (display) display.textContent = nextVal.toFixed(0) + ' %';

    const valve = sys.comps.elecValve;
    if (valve) {
        valve.manualPos = nextVal / 100;
        valve.update();
    }
}
```

---

### Task 3: tools/PneumaticSolver.js — 扩展气路求解器

**Files:**
- Modify: `tools/PneumaticSolver.js`

三个修改点：
1. `solve()` — 增加 Pump 作为压力源
2. `_processInternalTransfer()` — 增加流量计穿透和 ElecValve 混合
3. `_syncDevices()` — 增加流量计流量注入

- [ ] **Step 1: solve() 中增加 Pump 作为压力源**

在 `solve()` 方法的 `// ── 压力场` 区域，在 `device.type === 'airBottle'` 分支之后，插入 Pump 分支：

```javascript
// 在 solve() 方法中，紧接 device.type === 'airBottle' 分支之后（第 46 行附近）
if (device.type === 'Pump' && device.pumpOn) {
    const outPortId = `${device.id}_pipe_o`;
    terminalPressures[outPortId] = 0.4;  // 0.4 MPa 基准压力
    queue.push(outPortId);
}
```

- [ ] **Step 2: _processInternalTransfer() 中增加流量计压力穿透**

在 `_processInternalTransfer()` 方法的 `switch (device.type)` 中，新增两种 case：

```javascript
// 在 case 'regulator' 之后（第 409 行附近），添加：
case 'dp_flow_indicator':
case 'rotameter':
case 'impeller_flow_indicator':
    // 从 terminal_in 穿透到 terminal_out（直通，小压降）
    if (inputPortId.includes('terminal_in')) {
        const outPort = device.ports.find(p => p.id.includes('terminal_out'));
        if (outPort) {
            terminalPressures[outPort.id] = inP * 0.95;  // 5% 压降
            queue.push(outPort.id);
        }
    }
    break;
```

- [ ] **Step 3: _processInternalTransfer() 中增加 ElecValve 三通混合**

在 `switch` 语句块之后、函数返回之前，添加 ElecValve 混合处理：

```javascript
// 在 _processInternalTransfer 末尾（break 之后），添加：
// ElecValve 三通混合阀（通过 special='actuator' + type='resistor' 识别）
if (device.special === 'actuator' && device.type === 'resistor') {
    const pos = device.currentPos || 0;
    if (inputPortId.includes('_pipe_u') || inputPortId.includes('_pipe_l')) {
        const outPortId = `${deviceId}_pipe_r`;
        const mixRatio = inputPortId.includes('_pipe_u') ? (1 - pos) : pos;
        const prevP = terminalPressures[outPortId] || 0;
        terminalPressures[outPortId] = Math.max(prevP, inP * Math.max(mixRatio, 0.01));
        queue.push(outPortId);
    }
}
```

- [ ] **Step 4: _syncDevices() 中增加流量注入**

在 `_syncDevices()` 方法的 `// 流量传感器 / 变送器：注入流量值` 分支之后（第 276 行附近），添加：

```javascript
// 三种流量计的流量注入
else if (device.type === 'dp_flow_indicator' ||
         device.type === 'rotameter' ||
         device.type === 'impeller_flow_indicator') {
    const inPortId = `${device.id}_pipe_terminal_in`;
    const Q = getPortFlow(inPortId);
    if (device.setFlow) device.setFlow(Q);
}
```

---

### Task 4: 切换项目导入路径

**Files:**
- Modify: `consys.js:13`
- Modify: `lib/WorkflowManager.js:1-4`

- [ ] **Step 1: 修改 consys.js 第 13 行**

将：
```javascript
import { componentConfigs, initSlider } from './project/levelgauge.js';
```
改为：
```javascript
import { componentConfigs, initSlider } from './project/flowmeter.js';
```

- [ ] **Step 2: 修改 lib/WorkflowManager.js 第 1-4 行**

将：
```javascript
import { PROJECT_WORKFLOWS, FAULT_CONFIGS,
    fiveStep as defaultFiveStep,
    applyAllPresets as defaultApplyAllPresets,
    applyStartSystem as defaultApplyStartSystem } from '../project/levelgauge.js';
```
改为：
```javascript
import { PROJECT_WORKFLOWS, FAULT_CONFIGS,
    fiveStep as defaultFiveStep,
    applyAllPresets as defaultApplyAllPresets,
    applyStartSystem as defaultApplyStartSystem } from '../project/flowmeter.js';
```

---

## 验证步骤

完成所有任务后：

1. 运行 `pnpm run dev` 启动开发服务器
2. 浏览器打开页面，应看到 8 个组件按布局排列
3. 点击"一键连线"按钮（`btnAutoWire`），验证 9 条 pipe 连线自动生成
4. 点击"启动系统"按钮（`btnStartSys`），验证 Engine 和 Pump 启动
5. 拖动"阀位"滑块，验证 ElecValve 的 LCD 显示和阀板旋转
6. 点击三流量计，验证它们显示流量值
7. 点击"五点步进"按钮（`btnFiveStep`），观察阀位循环 0→25→50→75→100→0
8. 在 ElecValve 上点击 REMOTE/MANUAL 切换开关，切换到手轮模式，点击手轮上下半部分调节开度，观察滑块值跟随变化
