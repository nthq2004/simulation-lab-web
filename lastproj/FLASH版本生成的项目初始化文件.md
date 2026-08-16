# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

工业自动化控制仿真系统（浏览器端），用于教学培训。仿真内容包括：电路/气路/数字逻辑/CAN总线/Modbus通信，以及工业仪表（温度、压力、液位、流量传感器等）的接线、配置、故障排查。

## 技术栈

- **Konva.js** v10 — Canvas 2D 渲染，所有组件基于 Konva Group/Circle/Rect 绘制
- **Vite** v8 — 构建工具，支持单文件构建 (`npm run one`)
- **纯 JavaScript ES Modules** — 无框架（Vanilla JS）
- **pnpm** — 包管理器

## 常用命令

```bash
pnpm dev          # 启动开发服务器
pnpm build        # 构建到 dist/
pnpm one          # 构建单 HTML 文件到 dist-one/（用于离线发布）
pnpm preview      # 预览构建产物
```

## 项目结构

```
├── main.js              # 入口：创建 ControlSystem，绑定工具栏/弹窗交互
├── consys.js            # 核心：ControlSystem 类，协调所有子系统
├── export.js            # 统一导出所有模块（聚合导入）
├── style.css            # 全局样式
├── index.html           # 入口页面
├── vite.config.js       # Vite 配置（含 vite-plugin-singlefile）
│
├── components/          # 工业仿真组件（~70+ 个）
│   ├── BaseComponent.js # 基类：端口管理、右键菜单、旋转、配置弹窗
│   ├── Resistor.js      # 示例：每个组件继承 BaseComponent，实现 getConfigFields()
│   ├── NpnTempSensor.js # 温度传感器（BJT 对管）
│   ├── OpAmp.js         # 运算放大器
│   ├── Pump.js          # 泵
│   ├── PressTransmitter.js  # 压力变送器
│   ├── ...              # 其他工业仪表
│
├── tools/               # 仿真引擎工具模块
│   ├── CircuitSolver.js # 电路求解器（MNA 改进节点分析法）
│   ├── MNAMatrix.js     # MNA 矩阵底层操作
│   ├── PneumaticSolver.js # 气路求解器
│   ├── DigitalSolver.js # 数字逻辑求解器
│   ├── MicrocontrollerSolver.js # 单片机仿真
│   ├── MCS51Solver.js   # MCS-51 仿真
│   ├── Workflow.js      # 教学流程（演示/操练/评估/单步演示）
│   ├── Show.js          # 演示高亮辅助（箭头、闪烁）
│   ├── SignalBridge.js  # 信号桥接（不同域之间的信号传递）
│   ├── PerformanceMonitor.js # 性能监测
│
├── lib/                 # 核心库模块
│   ├── HistoryManager.js     # 撤销/重做管理器（最大80步）
│   ├── ConnectionManager.js  # 连线管理
│   ├── Renderer.js           # 渲染管理（重绘优化）
│   ├── UIManager.js          # UI交互（右键菜单、仿真步长设置）
│   ├── WorkflowManager.js    # 流程管理（任务切换、故障注入）
│
├── digital/             # 数字电路组件
│   ├── LogicGates.js    # 与/或/非/与非/或非/异或门
│   ├── Sequential.js    # D触发器、JK触发器、时钟、计数器
│   ├── Interfaces.js    # ADC/DAC
│   ├── MCU.js           # 通用 MCU 仿真
│   ├── MCS51.js         # MCS-51 单片机
│   └── Timer555.js      # 555定时器
│
├── can/                 # CAN 总线仿真
│   ├── CANBUS.js        # CAN 总线通信管理器（帧路由、仲裁、错误注入）
│   ├── BUSCON.js        # 总线配置工具
│   ├── AI.js / AO.js / DI.js / DO.js  # 模拟量/开关量 I/O 模块
│   ├── cc/              # 中央计算机（CC）UI 界面
│   │   ├── index.js, tempPage.js, alarmPage.js, ...
│   └── dpu/             # DPU（远程采集单元）UI + CAN 通信逻辑
│
├── modbus/              # Modbus 通信仿真
│   ├── MODBUS.js        # Modbus 协议核心（帧封装、CRC16）
│   ├── PLC.js           # PLC 仿真
│   ├── IASServer.js     # IAS（集成报警系统）服务器
│   └── TempTransmitter.js, PressTransmitter.js, VFD.js, ...
│
├── docs/superpowers/    # 设计方案文档
└── .vscode/             # VS Code 调试配置
```

## 核心架构

### ControlSystem (`consys.js`)
中心协调器，持有以下关键引用：
- `sys.comps` — 所有组件实例（keyed by id）
- `sys.conns` — 所有连线
- `sys.layer` / `sys.lineLayer` — Konva 渲染层
- `sys.history` — 撤销/重做
- `sys.connMgr` — 连线管理
- `sys.renderer` — 渲染管理
- `sys.voltageSolver` / `sys.pressSolver` — 电路/气路求解

**仿真循环**：20fps `setInterval` 做物理求解 → 60fps `requestAnimationFrame` 渲染。

### 组件体系
每个组件继承 `BaseComponent`，通过 `addPort(x, y, id, type)` 定义端口（`wire` 电气端口或 `pipe` 管路端口）。端口支持鼠标悬停反馈、拖拽连线。组件右键菜单支持旋转（±90°）和参数配置。

### 连线机制
点击一个端口启动连线，点击另一个端口完成连线。支持撤销/重做。连线信息存储在 `sys.conns` 数组，渲染由 `sys.renderer` 统一管理。

## 构建输出模式

- `pnpm build` → `dist/` 目录（分离资源）
- `pnpm one` → `dist-one/` 单个 HTML 文件（CSS/JS 全部内联，适合离线分发）

## 故障注入系统

`sys.FAULT_CONFIG` 配置各种故障场景，通过工具栏「故障设置」按钮弹出复选框面板勾选。每个故障有 `trigger()` 和 `repair()` 方法。
