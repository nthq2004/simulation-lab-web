# AGENTS.md

## 命令

```bash
pnpm run dev      # Vite 开发服务器
pnpm run build    # 构建到 dist/
pnpm run one      # 单文件 HTML 构建到 dist-one/（内联所有资源）
pnpm run preview  # 预览构建产物
```

无测试框架。

## 构建注意事项

- 使用 Vite 8 + Rolldown（默认打包器，非 esbuild/Rollup）
- `--mode one` 启用 `vite-plugin-singlefile` 输出单文件 HTML

## 项目结构关键点

| 目录 | 职责 |
|------|------|
| `components/` | 93 个仿真组件，均继承 `BaseComponent` |
| `tools/` | 仿真求解器（电路 MNA、气路、数字逻辑、MCU、热力学） |
| `digital/` | 数字逻辑门 + 时序电路 + MCU/MCS51 |
| `can/` | CAN 总线模块（AI/AO/DI/DO/CC） |
| `modbus/` | Modbus 设备（PLC、变送器、VFD、IAS 服务器） |
| `gateway/` | 硬件网关（串口 + WebSocket） |
| `lib/` | 子模块（连线管理、渲染、历史、UI、工作流） |
| `project/` | 每种仪表的项目配置（组件布局、流程、故障） |

## 组件开发流程

1. 在 `components/` 创建 `{Name}.js`，继承 `BaseComponent`
2. 在 `export.js` 中导入并导出新组件
3. 在 `consys.js` 顶部导入组件（供 `ControlSystem.init()` 创建）
4. 端口命名惯例：`{compId}_wire_{portName}`（电气）/ `{compId}_pipe_{portName}`（管路）
5. 如需新设备的 MNA stamp，同步更新 `DeviceStamps.js` 和 `CircuitSolver.js`

## 仿真引擎

- 20fps 物理循环，求解顺序：`CircuitSolver → PneumaticSolver → DigitalSolver → MicrocontrollerSolver → MCS51Solver → ThermalSolver`
- `window.sys` 为全局 `ControlSystem` 实例（`consys.js`）
- 网关功能默认关闭，需传 `{ gateway: true }` 启用

## 约定

- 所有 UI 文字必须使用中文
- 项目配置（组件坐标、连线、流程、故障）在 `project/multimeter.js` 中定义
- 已有指令文件 `CLAUDE.md`（详细架构），作为 `opencode.json` 的 `instructions` 引用
