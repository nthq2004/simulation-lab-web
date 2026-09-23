# AGENTS.md

## 语言规则

**所有回答、总结、过程说明、代码审查意见、设计决策解释等与用户的交流内容，必须使用中文。**
代码本身（变量名、注释、技术文档）不受此限，但面向用户的任何文字都必须是中文。

## 教学文档规范

- 编写工程教学文档一律使用 **Markdown** 格式（`.md`）。
- 文档**文件名与 `index.html` 中的 `<title>` 标题同名**。
- 配图统一放入工程下的 `docs-img/` 文件夹，文档内用相对路径引用（如 `![图 1 组成原理图](docs-img/xxx.svg)`）。
- 文档字数一般**不超过 2000 字**。

## 命令

```bash
pnpm run dev      # Vite 开发服务器 (HMR)
pnpm run build    # 标准构建 → dist/
pnpm run one      # 单文件 HTML → dist-one/（内联所有资源）
pnpm run preview  # 预览构建产物
```

无测试、lint、typecheck 工具。

## 对任意组件添加部件识别只需两步：
1. 在组件 _init() 中调用 this.addClickablePart('part-id', x, y, w, h)
2. 在工作流中写 { mode:'find', target:'compId', subTarget:'part-id' }

## 自动演示（show 模式）步骤节奏规范
编写工作流自动演示时，不同步骤类型遵守各自"展示 → 延时 → 动作"节奏：
- **箭头先行（硬性要求）**：演示中**每做一个动作前，必须先用闪烁箭头指示目标**（组件或部件中心），再执行该动作；一个步骤包含多个子动作时，逐个"箭头指向目标 → 执行该动作"。画布操作用 `Workflow._flashArrow(wf._compCenter(comp), { on: 500, off: 350, times: 3 })` 定位（或 `getClickablePartCenter(partId)` 取部件绝对坐标）；工具栏按钮/面板等 DOM 操作无法用画布箭头指示时，用 `Workflow._tipWorkflow(msg)` 说明后再操作。
- **子部件指示（硬性要求）**：如果操作对象是一个组件内的具体子元素（如电源面板上的电源键、某个旋钮/按钮/开关手柄），指示箭头**必须指向该子部件**（组件已实现 `getClickablePartCenter(partId)` 时用 `part` 字段传入部件 id 定位），不得只指向整个组件中心。参考：`project/sys_cddg3-2.js` 步骤 1 开电源用 `{ type:'switch', target:'ac', part:'power' }` 指向电源按钮而非组件中心。
- **find（操作/点击组件）**：闪烁箭头 + 延时动作（箭头闪烁约 3s → 移除 → 延时 1~2s 再进入下一步）；组件尽量实现 `getClickablePartCenter(partId)` 供箭头定位，否则回退整体高亮；并用 `showFloatingTip` 说明部件作用。
- **quiz（测试题）**：展示题目 → 停约 2s → 高亮全部正确选项并箭头(👉)指向 → 展示 ✅正确答案 与 💡解析 → 停约 6s 自动关闭。
- **fill（填空题）**：展示题目 → 自动填入/展示正确答案。
- **check（操作/演示）硬性格式**：`mode:'check'` 的步骤**必须使用 `op` 数组**（供自动演示模式逐个"指示 → 执行"演示），且**必须提供 `check()` 函数**（供演练/评估模式检测完成状态）；每个 op 自带 `act()`（箭头闪烁指向目标后立即执行），不要再把整步动作合并到 `step.act()`。
- 画布元素用 Konva 节点直接 add/remove + `requestRedraw`；不添加 `shadowColor/shadowBlur/shadowOpacity` 三件套。
- **接线动画（通用要求）**：自动演示中凡涉及接线，若本次接线数量 **≤8 根**，一律使用动画接线（`sys.connMgr.addConnectionAnimated({ from, to, type: 'wire' })`，约 3s/根，逐根 `await`，操作函数声明为 `async`）；接线数量 >8 根时可用瞬时接线（`addConn`）。
- **默认不接线（通用要求）**：系统初始化后画布默认**无任何预接线**（`applyAllPresets` 在 `ControlSystem.init` 中被调用时不做接线）；仅工具栏「自动接线」、工作流 `op.act`、或「启动系统」时按需接线。
- **参数调整一律走配置界面（硬性要求）**：自动演示步骤中凡涉及**可通过参数配置界面改变的参数**（电压幅值、电阻阻值等），演示时**必须调出该组件的参数配置界面**，动态演示参数调整的完整过程：`comp.showConfigDialog()` 弹出对话框 → 高亮目标参数输入框（`wf._flashDomElement(el, tip, ms)`）并填入新值 → 高亮「保存」按钮并点击确认。禁止直接改组件内部属性完成参数调整（如直接赋 `ac.vRms=240`）。参考实现：`project/sys_cddg3-2.js` 的 `_demoSetConfig()`、`project/sys_cddg8-2-1-4.js` 的 `_demoSetPhase()`。
  **注意**：弹对话框前必须把组件实时属性同步进 `comp.config` 副本（`getConfigFields()` 无 `get` 的字段直接读 `config`），否则「保存」会把副本旧值（如电源 `isOn=false`）一并回写，导致状态回退（如电源被关闭）。
- **示波器波形自动调档（通用要求）**：自动演示中示波器接线后，若按当前档位波形显示不完整（越出屏幕或仅占很小区域），演示须**自动按下对应通道的「CHx档」按钮调整档位**，直至波形完整充满屏幕（实测峰值 ≤ 约 4 格取最小档），停留 2~3s 使波形展示清晰后再进入下一步骤。参考实现：`project/sys_cddg3-2.js` 的 `_autoRangeOsc()`。
- **提示信息隔离（通用要求）**：进入自动演示（show）模式后，**必须抑制组件原有的流程信息提示**（组件 `_tip()` / `showFloatingTip()` 一律不弹出），画面只显示与自动演示相关的信息（步骤说明、箭头/圈选指示、演示专用提示），避免组件提示与演示提示相互干扰。实现：演示开始时 `sys._suppressComponentTips = true`（`UIManager.showFloatingTip` 首行据此直接 return），演示结束或关闭流程面板时恢复 `false`；演示引擎自身提示统一走 `Workflow._tipWorkflow(msg, ms)`（临时置 `sys._tipBypass = true` 绕过抑制）。演示中的组件状态变化（跳闸、报警灯、仪表读数）仍照常生效，仅**文字提示**被抑制。
> 完整规范见全局 `AGENTS.md` 的「仿真平台工作流自动演示模式规范」章节。

## 注册新组件（3 步，易遗漏）

1. `components/{Name}.js` — 继承 `BaseComponent`，设 `this.type`，`addPort()` 定义端口
2. `export.js` — **同时添加 import 和 export 条目**（聚合模块，未在 export 列出的符号不可用）
3. `consys.js` — 在文件顶部 `import` 块中添加（`ControlSystem.init()` 遍历创建）

## 新组件模板（源自 ClampMeter.js）

### 构造函数固定结构

```js
constructor(config, sys) {
    super(config, sys);

    this.width  = Math.max(minW, config.width  || defaultW);
    this.height = Math.max(minH, config.height || defaultH);

    this.type  = 'your-type';
    this.cache = 'fixed';

    this._initGroups();
    this._recalcGeometry();
    this._initParameters(config);
    this._init();

    this.config = { /* 各参数的副本 */ };

    this.addPort(x, y, id, 'wire', polarity);
}
```

按此顺序固定调用 4 个函数：`_initGroups()` → `_recalcGeometry()` → `_initParameters(config)` → `_init()`，最后 `addPort()`。

### _init() 固定调用 3 个函数

```js
_init() {
    this._drawStaticParts();
    this._createDynamicNodes();
    this._bindInteraction();   // 若无交互可省略此函数
}
```

### 动态节点处理原则（3 条铁律）

1. **in‑place 更新**：所有动态元素通过 `.rotation()`、`.fill()`、`.visible()`、`.text()` 等轻量方法直接修改已有 Konva 节点属性，**不在每帧销毁重建**。
2. **消除 shadow**：不使用 `shadowColor`/`shadowBlur`/`shadowOpacity`，避免触发离屏阴影渲染。
3. **不刷新缓存**：不调用 `_refreshCache()` / `clearCache()` + `cache()`，静态部件仅 `_staticGroup` 在 init 时做一次位图缓存，运行时不再刷新。

### tick(dt) 中完成所有动态更新

```js
tick(dt) {
    // 状态插值/物理计算
    this._updateDynamic();   // 内部通过 in‑place 方式更新节点
    this.markDirty();
    this._refreshIfDirty();
}
```

### 公开 API 要求

- **组件特有参数 getter/setter**（如 `setCurrent()`, `getCurrent()` 等）
- **`getConfigFields()`** — 返回配置字段数组
- **`onConfigUpdate(cfg)`** — 处理配置更新（如有必要）

## 项目配置层

`project/*.js` 定义仪表布局、连线预设、工作流、故障。`consys.js:45`、`lib/WorkflowManager.js:4` 均引用当前项目，切换项目需改这 2 处（`export.js` 为聚合模块，不引用项目文件，无需修改）。
每个文件导出 `componentConfigs`、`PROJECT_WORKFLOWS`、`FAULT_CONFIGS`、`initSlider`、`applyAllPresets`、`applyStartSystem`、`fiveStep`。

**7 种仪表保留规则**：每个项目的 `componentConfigs` 中必须包含以下 7 种仪表（`visible: false`）：
- Multimeter（id: `multimeter`）
- MF47Multimeter（id: `mf47-panel`）
- Oscilloscope_tri（id: `osc`）
- SignalGenerator（id: `sg`）
- ProcessCalibrator（id: `cali`）
- ElecMeter （id: `elecmeter` ）
- RealMegohmMeter（id: `megohm`）

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
