# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

工业仪表与过程控制仿真教学平台。使用 Konva.js (Canvas) 实现电路、气路、数字逻辑、Modbus 通信的可视化交互仿真。

## 常用命令

```bash
pnpm run dev      # Vite 开发服务器
pnpm run build    # 标准构建 → dist/
pnpm run one      # 单文件 HTML 构建 → dist-one/（内联所有资源）
pnpm run preview  # 预览构建产物
```

无测试框架配置。

## 架构概览

### 入口与系统主控

- **`index.html`** — 工具栏 UI（按钮、下拉框、故障弹窗、仪表弹窗）+ Konva 容器
- **`main.js`** — 入口，绑定所有工具栏按钮事件，实例化 `ControlSystem` 为 `window.sys`
- **`consys.js`** — `ControlSystem` 类，系统总控：
  - 管理两个 Konva Layer：`layer`（组件）、`lineLayer`（连线）
  - 维护 `comps`（组件字典）和 `conns`（连线数组）
  - 子模块代理：`HistoryManager`、`ConnectionManager`、`Renderer`、`UIManager`、`WorkflowManager`
  - 物理循环 20fps（`setInterval`），依次调用：CircuitSolver → PneumaticSolver → DigitalSolver → MicrocontrollerSolver → MCS51Solver
  - 渲染循环 `_renderLoop`（`requestAnimationFrame`），按需重绘
  - 初始化时在 `init()` 中创建所有组件并启动仿真

### 组件系统 (`components/`)

所有组件继承 `BaseComponent`，它提供：
- Konva Group 管理（拖拽、旋转、高亮、显示/隐藏）
- 端口创建 `addPort(x, y, id, type, polarity)` — `type` 为 `'wire'`（电气）或 `'pipe'`（管路）
- 配置对话框 `showConfigDialog()` — 子类重写 `getConfigFields()` 和 `onConfigUpdate()`
- 右键菜单（旋转、参数设置）
- Canvas 缓存（`cache='fixed'` 的组件启用静态缓存）

典型组件模式（以 `Resistor.js` 为例）：
1. `constructor(config, sys)` — 设置 `this.type`，绘制图形，调用 `addPort()` 定义端口
2. `getConfigFields()` — 返回可配置参数列表
3. `onConfigUpdate(newConfig)` — 保存配置并刷新显示
4. `getValue()` — 供仿真引擎读取参数

组件端口命名惯例：`{compId}_wire_{portName}` 或 `{compId}_pipe_{portName}`，由 `addPort()` 自动合成。

### 仿真引擎 (`tools/`)

- **`CircuitSolver.js`** — 核心电路求解器，使用改进节点分析法（MNA）：
  1. `_buildTopology()` — 并查集构建端口簇拓扑（`CircuitTopology.js`）
  2. `_solve()` — 构建 MNA 矩阵，迭代求解（最大 200 次，阻尼因子 0.3，收敛阈值 1e-6）
  3. `_updateDeviceCurrents()` — 求解后统一计算所有设备电流并回填状态
  4. 各类设备的 stamp 在 `DeviceStamps.js` 中实现
  5. 矩阵运算（Gaussian 消元）在 `MNAMatrix.js` 中
  6. 等效电阻缓存机制：拓扑签名变化时清空缓存

- **`PneumaticSolver.js`** — 气路/液压求解器
- **`DigitalSolver.js`** — 数字逻辑门仿真
- **`MicrocontrollerSolver.js`** / **`MCS51Solver.js`** — 微控制器仿真（ADC/DAC/定时器等）
- **`SignalBridge.js`** — 模拟-数字信号桥接（ADC/DAC 通道、数字信号线、时钟信号）

### 教学流程系统

- **`Workflow.js`** — 四种教学模式：
  - `show` — 自动演示（顺序执行步骤）
  - `step` — 单步演示（点击下一步逐步执行）
  - `train` — 演练模式（用户自行操作，check 检测是否完成）
  - `eval` — 评估模式（隐藏未执行步骤，包含 find/quiz/check 步骤类型）
  - 步骤支持模式：`find`（点击指定组件）、`quiz`（选择题）、`check`（行为检测）

- **`Show.js`** — 视觉展示效果：箭头闪烁、连线高亮/脉冲、提示文字、暗场聚焦、信号流动动画、镜头缩放、状态扩散环、端口闪烁

### 子模块（在 `consys.js` 中实例化）

- **`HistoryManager`** — 撤销/重做（连线操作）
- **`ConnectionManager`** — 端口点击连线交互、虚线预览、右键取消
- **`Renderer`** — 连线渲染与增量更新
- **`UIManager`** — 右键菜单、浮动提示、仿真步长设置
- **`WorkflowManager`** — 流程切换、预设连接、系统启动、故障管理

### 构建配置 (`vite.config.js`)

- 基础路径 `./`（相对路径）
- `--mode one` 启用 `vite-plugin-singlefile` 生成单文件，输出到 `dist-one/`
- 使用 Rolldown（Vite 8 默认打包器）

## 组件开发规范

新增一个仿真组件只需要：
1. 在 `components/` 创建 `{Name}.js`，继承 `BaseComponent`
2. 在 `constructor` 中设置 `this.type`（供求解器识别），绘制 Konva 图形，调用 `addPort()` 定义电气/管路端口
3. 如需配置对话框，重写 `getConfigFields()` 和 `onConfigUpdate()`
4. 如有动态特性（如非线性电阻），实现供求解器调用的 getter 方法
5. 如需要新设备的 MNA stamp，在 `DeviceStamps.js` 和 `CircuitSolver.js` 中同步添加
6. 在 `export.js` 中导出
