# AGENTS.md

## 语言规则

**所有回答、总结、过程说明、代码审查意见、设计决策解释等与用户的交流内容，必须使用中文。**
代码本身（变量名、注释、技术文档）不受此限，但面向用户的任何文字都必须是中文。

## 命令

```bash
pnpm run dev      # Vite 开发服务器 (HMR)
pnpm run build    # 标准构建 → dist/
pnpm run one      # 单文件 HTML → dist-one/（内联所有资源）
pnpm run preview  # 预览构建产物
```

无测试、lint、typecheck 工具。

## 注册新组件（3 步，易遗漏）

1. `components/{Name}.js` — 继承 `BaseComponent`，设 `this.type`，`addPort()` 定义端口
2. `export.js` — **同时添加 import 和 export 条目**（聚合模块，未在 export 列出的符号不可用）
3. `consys.js` — 在文件顶部 `import` 块中添加（`ControlSystem.init()` 遍历创建）

## 项目配置层

`project/*.js` 定义仪表布局、连线预设、工作流、故障。`consys.js:30`、`export.js`、`lib/WorkflowManager.js` 均引用当前项目，切换项目需改这 3 处。
每个文件导出 `componentConfigs`、`PROJECT_WORKFLOWS`、`FAULT_CONFIGS`、`initSlider`、`applyAllPresets`、`applyStartSystem`、`fiveStep`。

**6 种仪表保留规则**：每个项目的 `componentConfigs` 中必须包含以下 6 种仪表（`visible: false`）：
- Multimeter（id: `multimeter`）
- MF47Multimeter（id: `mf47-panel`）
- Oscilloscope_tri（id: `osc`）
- SignalGenerator（id: `sg`）
- ProcessCalibrator（id: `cali`）
- ElecMeter （id: `elecmeter` ）

## 仿真循环

20fps，`setTimeout` 自调度（非 `setInterval`，避免浏览器 Violation）。

求解顺序：`CircuitSolver → PneumaticSolver → DigitalSolver → MicrocontrollerSolver → MCS51Solver → ThermalSolver → Modbus → _tickAll`

自适应：电路稳态 >10 帧后隔帧求解（交流源存在时不跳帧）。`_hasDigital`、`_hasACSource`、`_hasCalibrator` 初始化时静态计算，避免每帧 `Object.values`。

Port 命名：`{compId}_wire_{portName}`（电气）/ `{compId}_pipe_{portName}`（管路）

## 接入要点

| 项目 | 说明 |
|------|------|
| `window.sys` | `ControlSystem` 实例（`consys.js`），全局可用 |
| `cache='fixed'` | 组件上设置启用静态 Konva Canvas 缓存 |
| 网关 | 默认关闭，`new ControlSystem({ gateway: true })` 启用；`main.js` 中动态 `import()` 懒加载 |
| 所有 UI 文字 | 必须使用中文 |
| 详细架构 | `CLAUDE.md`（已通过 `opencode.json` 的 `instructions` 引用） |
