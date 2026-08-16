# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

Brokaw温度传感器仿真电路 — 基于 Web 的电路仿真教学平台。使用 Konva.js 实现可视化电路，支持交互式连线、实时物理仿真、教学演示流程（自动演示/单步演示/演练/评估）。

## 常用命令

```bash
npm run dev        # 启动开发服务器（Vite）
npm run build      # 构建到 dist/
npm run one        # 构建单 HTML 文件到 dist-one/（使用 vite-plugin-singlefile）
npm run preview    # 预览构建产物
```

## 架构概览

### 入口与核心控制器

- **`main.js`** — 入口，绑定 DOM 按钮事件，将 UI 操作映射到 `ControlSystem` 方法
- **`consys.js`** — `ControlSystem` 类，整个仿真引擎的核心。管理组件池 (`comps`)、连接池 (`conns`)、Konva 双图层 (`layer`/`lineLayer`)、20fps 物理循环 + requestAnimationFrame 渲染循环。通过代理模式将职责委托给子模块
- **`export.js`** — 统一 barrel 导出，所有模块在此聚合并重新 export，`consys.js` 从这里一次性导入

### 子模块 (`lib/`)

`ControlSystem` 将具体职责委托给以下管理者：

| 模块 | 职责 |
|------|------|
| `HistoryManager` | 撤销/重做（仅限用户连线操作），基于 action 对象（do/undo） |
| `ConnectionManager` | 连线交互状态机（起点→虚线预览→终点）、连线增删（带/不带历史记录）、动画连线 |
| `Renderer` | 根据 `conns` 数组重建管路/电路视觉节点，增量更新线条位置 |
| `UIManager` | 右键菜单、浮动提示、仿真步进设置 |
| `WorkflowManager` | 教学流程定义（`stepsArray`）、故障配置（`FAULT_CONFIG`）、一键接线/启动/5点步进 |

### 仿真求解器 (`tools/`)

| 求解器 | 职责 |
|--------|------|
| `CircuitSolver` | MNA（改进节点分析）电路求解，含拓扑构建、矩阵求解、器件 stamp |
| `PneumaticSolver` | 气路/管路压力求解 |
| `DigitalSolver` | 数字逻辑仿真 |
| `MicrocontrollerSolver` | 通用 MCU 仿真 |
| `MCS51Solver` | 51 单片机指令集仿真 |
| `SignalBridge` | 跨域信号桥接（模拟量↔数字量） |
| `Workflow` / `Show` | 教学流程面板控制与展示逻辑 |

### 组件系统 (`components/`)

所有可视化器件继承 `BaseComponent`，通过 Konva.Group 实现拖拽、右键菜单、端口注册。

- **端口规范**: `addPort(offsetX, offsetY, portId, 'wire'|'pipe', 显示名)` — 端口 ID 自动生成为 `{compId}_wire_{portId}` 或 `{compId}_pipe_{portId}`
- **组件必须实现**: `initVisuals()` 绘制 Konva 图形，`initPorts()` 注册端口
- **仿真组件需实现**: `getCompanionModel(v1, v2, ...)` 返回器件的等效电导和电流源（MNA companion model）
- **缓存策略**: `this.cache = 'fixed'` 的组件使用 Konva `group.cache()` 静态缓存

当前电路使用的核心组件: `DCPower`, `NpnTempSensor`（Brokaw NPN 对管，含面积比和 Vbe 温度模型）, `Resistor`, `OpAmp`, `Ground`

### 其他子系统

- **`digital/`** — 数字逻辑器件（门电路、触发器、ADC/DAC、Timer555、MCS51 MCU）
- **`can/`** — CAN 总线仿真模块（AI/AO/DI/DO/中央计算机/CANBus）
- **`modbus/`** — Modbus 通信仿真（PLC、IASServer、各类变送器、VFD）

### 数据流

```
用户点击端口 → BaseComponent 事件 → ControlSystem.handlePortClick()
  → ConnectionManager 处理连线状态机
  → 连线加入 conns[] → Renderer 重绘
  → CircuitSolver.update() 根据 conns 构建拓扑 → MNA 求解 → 更新组件状态
  → requestAnimationFrame 渲染循环按需调用 batchDraw
```

### 教学流程机制

`WorkflowManager.initSteps()` 为每个项目定义步骤数组 `sys.stepsArray[projectId]`，每步包含 `msg`（描述）、`act()`（执行动作）和 `check()`（完成条件）。四种模式：
- **自动演示** (`show`): 自动播放所有步骤
- **单步演示** (`step`): 手动逐步执行
- **演练** (`train`): 用户操作并等待步骤条件满足
- **评估** (`eval`): 考核模式，记录操作正确性

### Konva 图层结构

- `sys.layer` — 组件图层（所有 BaseComponent 的 Konva.Group）
- `sys.lineLayer` — 连线图层（管路/电路线条节点）
- 连线交互时会在 `sys.layer` 上临时添加虚线预览
