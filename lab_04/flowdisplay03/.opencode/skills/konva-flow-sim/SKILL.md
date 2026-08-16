---
name: konva-flow-sim
description: >-
  工业仪表与过程控制仿真教学平台开发指南。
  使用 Konva.js (Canvas) 实现电路、气路、数字逻辑、Modbus 通信的可视化交互仿真。
  包含组件系统、仿真引擎、教学流程系统、硬件网关四大模块。
license: MIT
compatibility: opencode
---

# Konva Flow Simulation 开发指南

## 核心技术栈

- **Konva.js** — Canvas 2D 绘图，组件继承 `BaseComponent`
- **Vite 8** — 构建工具，支持 `pnpm run build`（标准）和 `pnpm run one`（单文件）
- **JavaScript ES Module** — 所有源码使用 `import/export`

## 项目入口

- `index.html` — 工具栏 UI + Konva 容器
- `main.js` — 入口，绑定工具栏按钮事件，实例化 `ControlSystem`
- `consys.js` — `ControlSystem` 类，系统总控，管理组件/连线/求解器/子模块

## 架构速览

### 组件系统 (`components/`)

所有组件继承 `BaseComponent`，提供：
- Konva Group 管理（拖拽、旋转、高亮）
- 端口创建 `addPort(x, y, id, type, polarity)`
  - `type` 为 `'wire'`（电气）或 `'pipe'`（管路）
- 配置对话框（重写 `getConfigFields()` 和 `onConfigUpdate()`）
- Canvas 缓存（`cache='fixed'` 启用静态缓存）

组件端口命名惯例：`{compId}_wire_{portName}` 或 `{compId}_pipe_{portName}`

### 仿真引擎 (`tools/`)

- **CircuitSolver.js** — 改进节点分析法（MNA）求解电路
- **PneumaticSolver.js** — 气路/液压 BFS 压力传播求解
- **DigitalSolver.js** — 数字逻辑门仿真
- **MicrocontrollerSolver.js / MCS51Solver.js** — 微控制器仿真
- **ThermalSolver.js** — 热力求解

### 教学流程系统

- **Workflow.js** — 四种模式：`show` 自动演示、`step` 单步、`train` 演练、`eval` 评估
- **Show.js** — 视觉效果：箭头闪烁、连线高亮、暗场聚焦、镜头缩放等

### 关键规则

1. 新增组件：`components/{Name}.js` → 继承 `BaseComponent` → 在 `export.js` 中导出
2. 新设备若需 MNA stamp：在 `DeviceStamps.js` 和 `CircuitSolver.js` 中添加
3. 物理循环 20fps：CircuitSolver → PneumaticSolver → DigitalSolver → MicrocontrollerSolver → MCS51Solver → ThermalSolver → _tickAll
4. 子模块在 `consys.js` 中实例化：HistoryManager、ConnectionManager、Renderer、UIManager、WorkflowManager
