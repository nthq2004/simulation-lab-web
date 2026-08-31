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

## 对任意组件添加部件识别只需两步：
1. 在组件 _init() 中调用 this.addClickablePart('part-id', x, y, w, h)
2. 在工作流中写 { mode:'find', target:'compId', subTarget:'part-id' }

## 自动演示（show 模式）步骤节奏规范
编写工作流自动演示时，不同步骤类型遵守各自"展示 → 延时 → 动作"节奏：
- **find（操作/点击组件）**：闪烁箭头 + 延时动作（箭头闪烁约 3s → 移除 → 延时 1~2s 再进入下一步）；组件尽量实现 `getClickablePartCenter(partId)` 供箭头定位，否则回退整体高亮；并用 `showFloatingTip` 说明部件作用。
- **quiz（测试题）**：展示题目 → 停约 2s → 高亮全部正确选项并箭头(👉)指向 → 展示 ✅正确答案 与 💡解析 → 停约 6s 自动关闭。
- **fill（填空题）**：展示题目 → 自动填入/展示正确答案。
- 画布元素用 Konva 节点直接 add/remove + `requestRedraw`；不添加 `shadowColor/shadowBlur/shadowOpacity` 三件套。
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
