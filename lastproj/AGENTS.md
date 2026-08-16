# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## 项目概述

工业自动化控制仿真教学平台（浏览器端）。仿真工业现场仪表、电路、气路、数字逻辑、CAN总线、Modbus通信的交互式教学系统。用户可拖拽组件、手动或自动连线、设置故障、按教学流程操作。

## 技术栈与命令

- **Konva.js** v10（Canvas 2D 渲染）
- **Vite** v8 + vite-plugin-singlefile
- **pnpm** 包管理器
- 纯 JavaScript ES Modules，无框架

```bash
pnpm dev          # 开发服务器
pnpm build        # 构建 dist/
pnpm one          # 构建单 HTML 文件 dist-one/（离线分发用）
pnpm preview      # 预览构建
```

## 核心架构

整个系统围绕唯一的 `ControlSystem` 实例（`window.sys`）运行，位于 [consys.js](consys.js)。

### 仿真循环

```
setInterval(20fps)                 requestAnimationFrame(≈30fps)
  ├─ CircuitSolver.update()         └─ layer.batchDraw() + lineLayer.batchDraw()
  ├─ PneumaticSolver.solve()            仅在 _needsRedraw 为 true 且距上次绘制 ≥33ms 时执行
  ├─ DigitalSolver.update()
  ├─ MicrocontrollerSolver.update()
  ├─ MCS51Solver.update()
  └─ ModbusBus.update()
```

物理计算与渲染分离，通过 `sys.requestRedraw()` 标记需要重绘，避免每帧都 draw。

### ControlSystem 关键属性

| 属性 | 说明 |
|------|------|
| `sys.comps` | `{ id: ComponentInstance }` 所有组件 |
| `sys.conns` | `[{from, to, type}]` 所有连线，type 为 `wire` 或 `pipe` |
| `sys.layer` | Konva.Layer，放置组件 |
| `sys.lineLayer` | Konva.Layer，放置连线 |
| `sys.linkingState` | 当前连线交互状态 `{comp, portId, type}`，null 表示空闲 |
| `sys.globalTemp` | 全局温度 °C，所有温度相关组件读取此值 |
| `sys.history` | HistoryManager 实例，管理连线撤销/重做 |
| `sys.voltageSolver` | CircuitSolver 实例 |
| `sys.pressSolver` | PneumaticSolver 实例 |
| `sys.digitalSolver` | DigitalSolver 实例 |

### 端口命名规范

端口 ID 由组件内部自动生成为 `{compId}_{type}_{portId}` 格式（如 `b_q1_wire_c`、`pump1_pipe_o`）。连线存储的 `from`/`to` 均为此格式。

## 目录结构与职责

```
├── consys.js            # ControlSystem 类（~590行），统一管理所有子系统
├── main.js              # 入口：实例化 sys，绑定工具栏按钮与弹窗 DOM 事件
├── export.js            # 聚合导出（import 所有模块后统一 re-export）
├── index.html           # 入口 HTML（工具栏、弹窗、Konva 容器）
├── style.css            # 全局样式
├── vite.config.js       # 双构建模式：正常/单文件
│
├── components/          # 仿真组件（~70+ 个），每个对应一个工业设备或电子元件
│   └── BaseComponent.js # 所有组件的基类
│
├── tools/               # 仿真求解器与工具
│   ├── CircuitSolver.js # 电路求解器（MNA 改进节点分析），核心仿真引擎
│   ├── MNAMatrix.js     # MNA 矩阵底层：填充电导矩阵、电压源/电流源注入、Gauss-Jordan 求解
│   ├── CircuitTopology.js # 并查集拓扑构建：将导线连接的端口归为一个簇
│   ├── DeviceStamps.js  # 各器件 MNA stamp 函数（电阻、BJT、运放、MOSFET 等）
│   ├── CircuitUtils.js  # 等效电阻计算、两点间电压查询
│   ├── InstrumentUpdater.js # 仪表更新：电流表/万用表/示波器/校验仪/频率检测
│   ├── PneumaticSolver.js   # 气路压力求解（BFS 传播 + 管路压损）
│   ├── DigitalSolver.js     # 数字逻辑求解（组合逻辑 + 时序逻辑 + ADC/DAC/555）
│   ├── MicrocontrollerSolver.js # MCU 指令集仿真
│   ├── MCS51Solver.js       # MCS-51 单片机仿真
│   ├── SignalBridge.js      # 模拟↔数字信号桥接（ADC/DAC 通道、数字信号线、时钟）
│   ├── Workflow.js          # 教学流程面板（演示/操练/评估/单步）
│   ├── Show.js              # 演示辅助：闪烁箭头、高亮组件、浮层文字
│   └── PerformanceMonitor.js # 性能监测
│
├── lib/                 # 通用库
│   ├── HistoryManager.js     # 撤销/重做（最大 80 步，基于 action.do/undo 模式）
│   ├── ConnectionManager.js  # 连线交互（端口点击→虚线预览→完成连接，含冲突检测）
│   ├── Renderer.js           # 连线渲染（贝塞尔曲线、管路渲染、多线并排偏移）
│   ├── UIManager.js          # 右键菜单（仿真步长设置）、浮动提示
│   └── WorkflowManager.js    # 流程定义（stepsArray）、故障配置、一键连线/启动/5点步进
│
├── digital/             # 数字电路组件（逻辑门、触发器、ADC/DAC、MCU、555、MCS51）
├── can/                 # CAN 总线仿真（AI/AO/DI/DO + 中央计算机 CC + 总线 BUSCON）
├── modbus/              # Modbus RTU/TCP 仿真（PLC、IAS 服务器、变送器、VFD、阀门定位器）
└── docs/                # 设计文档
```

## 组件开发

### 基类 BaseComponent

所有组件继承 [BaseComponent](components/BaseComponent.js)：

- `constructor(config, sys)` — config 必须包含 `{id, x, y, scale, rotation}`
- `addPort(x, y, id, type, polarity)` — type: `wire`（电气）/ `pipe`（管路），polarity: `p`（正极红色）
- `getAbsPortPos(portId)` — 返回端口在舞台上的绝对坐标
- `getConfigFields()` — 重写此方法定义右键「参数设置」的输入字段
- `onConfigUpdate(newConfig)` — 参数保存后的回调
- `showContextMenu(evt)` — 右键菜单（旋转±90°/参数设置）
- `highlight(active, color)` — 组件高亮/呼吸灯效果
- `hide()` / `show()` — 控制可见性并同步隐藏/显示关联连线
- `connectPortNumToCluster(solver)` — 在电路求解前调用，将端口电流注入对应 MNA 簇

### 电路仿真求解流程

1. `CircuitSolver.update()` 被 20fps 定时器调用
2. `_buildTopology()` — 并查集遍历所有 wire 连线，将电气连通的端口归为一个簇（cluster）
3. `_solve()` — 构建 MNA 矩阵：遍历原始设备，按类型调用 DeviceStamps 填入 G/B；接地簇设为 0V；运行 Gauss-Jordan 消元求解
4. 所有设备在 `updateDisplay()` 中读取 `nodeVoltages` 更新自身显示（LED 颜色、仪表数值等）
5. `InstrumentUpdater.update()` — 更新电流表、万用表、示波器等

### 流体仿真求解流程

`PneumaticSolver.solve()` 从气源（AirBottle、执行器）开始 BFS 传播压力，经过调压阀→执行器/变送器→回气/排气口，同时计算管路流量和压损。器件需在 `applyPressure()` 中处理终端压力变化。

### 数字逻辑仿真

`DigitalSolver.update(deltaTime)` 按组合逻辑→时序逻辑→接口组件的顺序更新。通过 `SignalBridge` 全局单例与模拟域交换数据（ADC 读电压输出数字，DAC 读数字输出模拟电压）。

## 关键约定

- **所有组件通过 `export.js` 统一导入**，增删组件时同步修改 `export.js`
- **连线不可撤销删除**只有通过 `addConnWithHistory`/`removeConnWithHistory` 创建的才可撤销
- **管路端口独占**：一个 pipe 端口只能有一条连接；电路端口允许多条并联
- **全局温度** `sys.globalTemp` 由工具栏滑块控制，组件在 `updateDisplay()` 中读取
- **教学流程定义在** `WorkflowManager.initSteps()` 中，每个步骤 `{msg, act, check}`
