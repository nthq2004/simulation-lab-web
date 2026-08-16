# 流量计原理演示系统 — 设计文档

## 1. 概述

在工业仪表仿真教学平台中新增一个流量计演示项目，通过一个完整的冷却水循环回路展示三种流量计的工作原理和工作特性：

- **差压式流量计** (DpFlowIndicator) — 测量干路（经冷却器）流量
- **机械式叶轮流量指示器** (ImpellerFlowIndicator) — 测量总回水流量
- **转子流量计** (Rotameter) — 测量旁通管路流量

由电动三通调节阀 (ElecValve) 控制两路回水的混合比例，直观展示流量分配与各流量计的联动响应。

---

## 2. 回路拓扑

```
Engine (柴油机)
  │ o (冷却水出口)
  ▼
Pump (高温淡水泵)
  │ o
  ▼
TeeConnector (三通接头)
  │ l (进口—来自泵)
  ├── u ──→ Rotameter (转子流量计) ──→ ElecValve.u (左口)
  │                                      ↑ 旁路回水
  └── r ──→ DpFlowIndicator (差压式) ──→ Cooler (冷却器)
                                           │ o
                                           ▼
                                        ElecValve.l (下口)
                                           ↑ 冷却器回水
                                           │
                                        ElecValve.r (上口)
                                           │ 混合后总回水
                                           ▼
                                     ImpellerFlowIndicator (叶轮式)
                                           │
                                           ▼
                                     Engine.i (冷却水进口)
```

### 2.1 端口连线明细

| 起始端 | 端口 | 目标端 | 端口 | 管路类型 |
|--------|------|--------|------|---------|
| engine-01 | `pipe_o` | pump-01 | `pipe_i` | pipe |
| pump-01 | `pipe_o` | tee-01 | `pipe_l` | pipe |
| tee-01 | `pipe_u` | rotameter-01 | `pipe_terminal_in` | pipe |
| rotameter-01 | `pipe_terminal_out` | elecValve | `pipe_u` | pipe |
| tee-01 | `pipe_r` | dp-flow-01 | `pipe_terminal_in` | pipe |
| dp-flow-01 | `pipe_terminal_out` | cooler-01 | `pipe_i` | pipe |
| cooler-01 | `pipe_o` | elecValve | `pipe_l` | pipe |
| elecValve | `pipe_r` | impeller-flow-01 | `pipe_terminal_in` | pipe |
| impeller-flow-01 | `pipe_terminal_out` | engine-01 | `pipe_i` | pipe |

---

## 3. 组件配置

### 3.1 坐标布局（canvas 坐标）

| 组件 | ID | 类型 | 坐标 (x, y) | 说明 |
|------|-----|------|-------------|------|
| Engine | engine-01 | Engine | (80, 320) | 柴油机热源 |
| Pump | pump-01 | Pump | (280, 320) | 高温淡水泵 |
| TeeConnector | tee-01 | TeeConnector | (460, 320) | 三通分流 |
| Rotameter | rotameter-01 | Rotameter | (460, 160) | 旁路流量计 |
| DpFlowIndicator | dp-flow-01 | DpFlowIndicator | (660, 320) | 干路差压流量计 |
| Cooler | cooler-01 | Cooler | (880, 320) | 冷却器 |
| ElecValve | elecValve | ElecValve | (660, 520) | 电动三通调节阀(混合阀) |
| ImpellerFlowIndicator | impeller-flow-01 | ImpellerFlowIndicator | (880, 520) | 总回水叶轮流量计 |

**布局说明：**
- 上层：Tee → Rotameter（旁路在上方）
- 中层：Engine → Pump → Tee → DpFlowIndicator → Cooler（干路在中间）
- 下层：ElecValve（混合阀）和 ImpellerFlowIndicator（总回水）在下方
- 干路从左到右流动，回水从下方返回

### 3.2 ElecValve 配置

保持 `type='resistor'` 和 `special = 'actuator'` 不变。PneumaticSolver 通过 `special === 'actuator'` 识别并添加三通混合阀处理分支。

**控制行为：**
- **MANUAL 模式**：点击手轮上半部分（开度+5%）、下半部分（开度-5%）
- **REMOTE 模式**：通过 4-20mA 信号控制开度（0-100%）
- **切换开关**：点击 REMOTE/MANUAL 标签切换模式

**分流/混合逻辑：**
- `currentPos = 0%` → u口(旁路侧)全关，l口(冷却器侧)全开
- `currentPos = 100%` → l口全关，u口全开
- 中间值 → 按比例混合，阻抗与 `(1-pos)` 成正比

### 3.3 流量计配置

三个流量计已有完整的 pipe 端口和 `tick(dt)` 物理仿真，仅需通过外部注入流量值驱动。

| 流量计 | setFlow 驱动 | tick 效果 |
|--------|-------------|-----------|
| DpFlowIndicator | 接收干路流量 Q_main | 差压→U管液面→指针联动 |
| Rotameter | 接收旁路流量 Q_bypass | 浮子力平衡→垂直位置→自旋 |
| ImpellerFlowIndicator | 接收总回水流量 Q_total | 叶轮旋转→磁耦合→指针 |

---

## 4. 气路求解器扩展

以下修改均在 `tools/PneumaticSolver.js` 中。

### 4.1 新增压力源：Pump（`solve()` 方法）

Pump 开启时，其 `pipe_o` 端口作为压力源注入 BFS 队列：

```javascript
if (device.type === 'Pump' && device.pumpOn) {
    const outPortId = `${device.id}_pipe_o`;
    terminalPressures[outPortId] = 0.4;  // 0.4 MPa 基准压力
    queue.push(outPortId);
}
```

Engine 也作为压力源（冷却水循环）：
```javascript
if (device.type === 'engine' && device.engOn) {
    // Engine 输出端 pipe_o 作为热源侧出水压力
}
```

### 4.2 流量计压力穿透（`_processInternalTransfer()` 新增）

三种流量计需要在 `_processInternalTransfer()` 中支持压力从 `terminal_in` 穿透到 `terminal_out`，保证 BFS 压力场能沿回路传播：

```javascript
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

### 4.3 ElecValve 混合处理（`_processInternalTransfer()` 新增）

利用 `special === 'actuator'` 标识，识别 ElecValve 并实现三通混合阀逻辑：

```javascript
// 在 _processInternalTransfer switch 之后，增加：
// ElecValve 三通混合阀（special === 'actuator'）
// port_u(左口) = bypass 回水入口
// port_l(下口) = cooler 回水入口  
// port_r(上口) = 混合出口
if (device.special === 'actuator' && device.type === 'resistor') {
    const pos = device.currentPos || 0;
    if (inputPortId.includes('_pipe_u') || inputPortId.includes('_pipe_l')) {
        const outPortId = `${deviceId}_pipe_r`;
        const mixRatio = inputPortId.includes('_pipe_u') ? pos : (1 - pos);
        const prevP = terminalPressures[outPortId] || 0;
        terminalPressures[outPortId] = Math.max(prevP, inP * mixRatio * 0.95);
        queue.push(outPortId);
    }
}
```

### 4.4 流量注入（`_syncDevices()` 新增）

在 `_syncDevices()` 中增加三个流量计类型的流量注入：

```javascript
else if (device.type === 'dp_flow_indicator' || 
         device.type === 'rotameter' || 
         device.type === 'impeller_flow_indicator') {
    const inPortId = `${device.id}_pipe_terminal_in`;
    const Q = getPortFlow(inPortId);
    if (device.setFlow) device.setFlow(Q);
}
```

---

## 5. Pump 和 Engine 的气路集成

### 5.1 Pump 作为压力源

Pump 目前使用 `setInterval` 自驱动（每 50ms），`pumpOn` 控制启停。在 PneumaticSolver 中应将其 pipe 端口 `o` 识别为压力源端口，提供基准压力。

扩展方法：
- 在 `_findSources()` 中识别 `type === 'Pump'` 且 `pumpOn === true`
- 提供 0.4 MPa 基准压力

### 5.2 Engine 作为负载

Engine 的 `pipe_o` 为冷却水出口，`pipe_i` 为冷却水进口。在求解器中：
- `pipe_o` 视为压力源（来自发动机的泵送压力）
- `pipe_i` 视为回水入口

---

## 6. 项目配置

### 6.1 新建文件 `project/flowmeter.js`

**格式参考 `levelgauge.js`**，导出以下内容：

- **`componentConfigs`** — 8 个组件的位置和参数（见第 3.1 节）
- **`FAULT_CONFIGS = {}`** — 初始为空
- **`PROJECT_WORKFLOWS = {}`** — 初始为空

#### `initSlider(sys)` — 阀门开度滑块（双向同步）

```javascript
export function initSlider(sys) {
    // 1. 在工具栏创建 range slider
    const toolbar = document.getElementById('toolbar');
    const sliderDiv = document.createElement('div');
    sliderDiv.innerHTML = `
        <span>阀门开度:</span>
        <input type="range" id="valveSlider" min="0" max="100" value="0">
        <span id="valveDisplay">0%</span>
    `;
    toolbar.appendChild(sliderDiv);

    // 2. 滑块 → ElecValve（正向控制）
    const slider = document.getElementById('valveSlider');
    const display = document.getElementById('valveDisplay');
    slider.addEventListener('input', () => {
        const pos = parseFloat(slider.value);
        display.textContent = pos.toFixed(0) + ' %';
        const valve = sys.comps.elecValve;
        if (!valve) return;
        if (valve.controlMode === 'MANUAL') {
            valve.manualPos = pos / 100;
        } else {
            valve.update(pos / 100);
        }
        valve.update();
        sys.requestRedraw();
    });

    // 3. ElecValve → 滑块（反向同步，通过定时轮询）
    // 当用户点击手轮改变开度时，读取 valve 的当前值更新滑块
    setInterval(() => {
        const valve = sys.comps.elecValve;
        if (!valve) return;
        const pct = Math.round(valve.currentPos * 100);
        const currentSliderVal = parseFloat(slider.value);
        if (Math.abs(pct - currentSliderVal) > 1) {
            slider.value = pct;
            display.textContent = pct + ' %';
        }
    }, 200);
}
```

#### `applyAllPresets()` — 一键自动连线

创建全部 9 条 pipe 连线，使用 `sys.connManager.addConn()`（无动画、不可撤销）：

```
engine-01_pipe_o  →  pump-01_pipe_i
pump-01_pipe_o    →  tee-01_pipe_l
tee-01_pipe_u     →  rotameter-01_pipe_terminal_in
rotameter-01_pipe_terminal_out  →  elecValve_pipe_u
tee-01_pipe_r     →  dp-flow-01_pipe_terminal_in
dp-flow-01_pipe_terminal_out    →  cooler-01_pipe_i
cooler-01_pipe_o  →  elecValve_pipe_l
elecValve_pipe_r  →  impeller-flow-01_pipe_terminal_in
impeller-flow-01_pipe_terminal_out →  engine-01_pipe_i
```

```javascript
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

#### `fiveStep()` — 五点步进

循环切换 ElecValve 开度：0% → 25% → 50% → 75% → 100% → 0% ...

```javascript
export function fiveStep() {
    const sys = this.sys;
    const steps = [0, 25, 50, 75, 100];
    const slider = document.getElementById('valveSlider');
    const current = slider ? parseFloat(slider.value) : 0;

    let next = steps[0];
    for (const s of steps) {
        if (Math.abs(s - current) < 1) {
            next = steps[(steps.indexOf(s) + 1) % steps.length];
            break;
        }
    }

    if (slider) slider.value = next;
    const display = document.getElementById('valveDisplay');
    if (display) display.textContent = next.toFixed(0) + ' %';

    const valve = sys.comps.elecValve;
    if (valve) {
        valve.manualPos = next / 100;
        valve.update();
    }
}
```

#### `applyStartSystem()` — 启动系统

设置 Engine 和 Pump 初始为开启状态，ElecValve 初始开度 0%。

```javascript
export async function applyStartSystem() {
    const sys = this.sys;
    const engine = sys.comps['engine-01'];
    const pump = sys.comps['pump-01'];
    if (engine && engine.engOn !== undefined) engine.engOn = true;
    if (pump && pump.pumpOn !== undefined) pump.pumpOn = true;
    const slider = document.getElementById('valveSlider');
    if (slider) slider.value = 0;
    const display = document.getElementById('valveDisplay');
    if (display) display.textContent = '0 %';
}
```

### 6.2 已存在的文件修改

- **`export.js`** — 添加以下导出：
  - `DpFlowIndicator`
  - `ImpellerFlowIndicator`
  - `Rotameter`
  - `ElecValve`（如果尚未导出）

- **`tools/PneumaticSolver.js`** — 扩展：
  - `_processInternalTransfer()`: 增加 `special === '3wayvalve'` 分支
  - `_syncDevices()`: 增加三个流量计类型的流量注入

- **`components/ElecValve.js`** — **无需修改**（保持 `special = 'actuator'`）

- **`consys.js`**（第 13 行）— 将导入从 `./project/levelgauge.js` 切换为 `./project/flowmeter.js`：
  ```javascript
  // 原: import { componentConfigs, initSlider } from './project/levelgauge.js';
  // 新:
  import { componentConfigs, initSlider } from './project/flowmeter.js';
  ```

- **`lib/WorkflowManager.js`**（第 1-4 行）— 将导入从 `../project/levelgauge.js` 切换为 `../project/flowmeter.js`：
  ```javascript
  // 原: import { ... } from '../project/levelgauge.js';
  // 新:
  import { PROJECT_WORKFLOWS, FAULT_CONFIGS,
      fiveStep as defaultFiveStep,
      applyAllPresets as defaultApplyAllPresets,
      applyStartSystem as defaultApplyStartSystem } from '../project/flowmeter.js';
  ```

---

## 7. 交互演示流程

### 7.1 默认启动状态

- Engine 开启（`engOn = true`）
- Pump 开启（`pumpOn = true`）
- ElecValve 处于 REMOTE 模式，`currentPos = 0%`（冷却器侧全开）
- 所有流量计初始状态为 0

### 7.2 教学演示操作

**演示 1 — 差压式流量计原理**
- ElecValve pos 保持 0%（冷却器全开）
- 调节泵速或阀门改变干路流量
- 观察 DpFlowIndicator 的 U 管液面和指针响应

**演示 2 — 电动三通阀混合控制**
- 逐步增大 ElecValve 开度（0% → 50% → 100%）
- 观察 DpFlowIndicator 流量减小、Rotameter 流量增大
- 观察 ImpellerFlowIndicator 总流量基本不变（验证流量守恒）

**演示 3 — 转子流量计响应**
- 当 ElecValve 开度增大时
- 旁路流量增加 → Rotameter 浮子上升 + 自旋加快

**演示 4 — 手动/遥控切换**
- 切换 ElecValve 到 MANUAL 模式
- 通过手轮手动调节混合比例
- 切换回 REMOTE 模式观察追踪

---

## 8. 设计自检

- [x] 所有组件均在项目中存在，无待建组件
- [x] 端口映射清晰，连线关系可逆推
- [x] 流量计已有 setFlow() API 和 tick() 仿真
- [x] PneumaticSolver 扩展点明确（_processInternalTransfer + _syncDevices）
- [x] ElecValve 保持 `special = 'actuator'`，PneumaticSolver 通过该标识 + `type === 'resistor'` 识别
- [x] 项目配置格式与现有 levelgauge/pressguage 一致
- [x] 布局坐标可微调，不影响逻辑
- [x] 项目加载需修改 `consys.js`（第 13 行）和 `lib/WorkflowManager.js`（第 1-4 行）的导入路径
