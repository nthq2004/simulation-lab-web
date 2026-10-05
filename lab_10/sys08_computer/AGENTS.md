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

> **端口识别**：接线演示用 `op.ports`（端口 id 数组）指示，端口坐标由 BaseComponent 的
> `getAbsPortPos(portId)` 提供，无需额外注册；组件只要用 `addPort()` 正确定义端口即可。

## 自动演示（show 模式）步骤节奏规范
编写工作流自动演示时，不同步骤类型遵守各自"展示 → 延时 → 动作"节奏：
- **箭头先行（硬性要求）**：演示中**每做一个动作前，必须先用闪烁箭头指示目标**（组件或部件中心），再执行该动作；一个步骤包含多个子动作时，逐个"箭头指向目标 → 执行该动作"。画布操作用 `Workflow._flashArrow(wf._compCenter(comp), { on: 500, off: 350, times: 3 })` 定位（或 `getClickablePartCenter(partId)` 取部件绝对坐标）；工具栏按钮/面板等 DOM 操作无法用画布箭头指示时，用 `Workflow._tipWorkflow(msg)` 说明后再操作。
- **子部件指示（硬性要求）**：如果操作对象是一个组件内的具体子元素（如电源面板上的电源键、某个旋钮/按钮/开关手柄），指示箭头**必须指向该子部件的中心**（组件已实现 `getClickablePartCenter(partId)` 时用 `part` 字段传入部件 id 定位），**不得只指向整个组件中心**。参考：`project/sys_cddg3-2.js` 步骤 1 开电源用 `{ type:'switch', target:'ac', part:'power' }` 指向电源按钮而非组件中心。
- **接线指向端口（硬性要求）**：自动演示中凡涉及接线的操作，指示箭头**必须指向所接线的端口**（端口的画布绝对坐标），**不得指向组件中心**。工作流 op 需携带端口信息，如 `{ type:'observe', target:'<compId>', ports:['<fromPortId>','<toPortId>'], msg:'…' }`；由演示引擎 `Workflow._introPorts()` 用 `getAbsPortPos(portId)`（BaseComponent 提供）解析端口中心并闪烁箭头，两端口可同时（`Promise.all`）指示。新增组件应保证 `getAbsPortPos()` 返回准确端口坐标。
- **find（操作/点击组件）**：闪烁箭头 + 延时动作（箭头闪烁约 3s → 移除 → 延时 1~2s 再进入下一步）；组件尽量实现 `getClickablePartCenter(partId)` 供箭头定位，否则回退整体高亮；并用 `showFloatingTip` 说明部件作用。
- **quiz（测试题）**：展示题目 → 停约 2s → 高亮全部正确选项并箭头(👉)指向 → 展示 ✅正确答案 与 💡解析 → 停约 6s 自动关闭。
- **fill（填空题）**：展示题目 → 自动填入/展示正确答案。
- **check（操作/演示）硬性格式**：`mode:'check'` 的步骤**必须使用 `op` 数组**（供自动演示模式逐个"指示 → 执行"演示），且**必须提供 `check()` 函数**（供演练/评估模式检测完成状态）；每个 op 自带 `act()`（箭头闪烁指向目标后立即执行），不要再把整步动作合并到 `step.act()`。
- **操作一律用模拟点击，不直接赋值（硬性要求）**：自动演示中凡是"按钮/旋钮/开关/选项/复选框"
  类操作，**能直接模拟点击的就必须像真的一样点击**（`node.fire('click')`、复选框 `.click()` 等，
  触发组件自身 click 处理逻辑），**禁止**绕过交互直接赋值
  （如 `cc.levelCtrl.inputChannel='ch2'`、`ai.channels.ch1.mode='disable'`、
  `comp.group.visible(true)`、`FAULT_CONFIG[id].trigger()`）。
  原因：① 直接赋值画面毫无反馈，学员看不到"按下"这一动作；② 组件点击处理里还含
  联动逻辑（循环切换档位、发送总线帧、刷新行显示等），赋值会漏掉这些。
  实现：`_registerCCParts` 在登记几何时同时保存 `node`，配合统一的
  `_firePartClick(comp, partId)`（项目内已有）；循环切换类（Mode 旋钮）用
  `_clickModeUntil()` 反复点击到目标值。仅当节点确实取不到时才允许带 `console.warn` 的兜底赋值。
- **check() 必须覆盖步骤的全部验收点（硬性要求）**：① 故障设置/修复步骤除故障标志外，
  若该故障会触发报警，还必须校验监控主机 `activeAlarms` 确实产生了报警；
  ② 含"定位"字样的步骤必须校验点击过对应模块（`sys.lastClickedId === 'ai'`）；
  ③ 含"进入/切到某页"的步骤必须校验已切到对应页签（`cc.activePage === n`）；
  ④ "按下按钮使装置响应"类步骤若末尾会松开按钮/复位锁存，必须在 `act()` 里用
  `this._projFlag.xxx = true` 记录本轮达成过，`check()` 读该标记兜底。
- 画布元素用 Konva 节点直接 add/remove + `requestRedraw`；不添加 `shadowColor/shadowBlur/shadowOpacity` 三件套。
- **接线动画（通用要求）**：自动演示中凡涉及接线，若本次接线数量 **≤8 根**，一律使用动画接线（`sys.connMgr.addConnectionAnimated({ from, to, type: 'wire' })`，约 3s/根，逐根 `await`，操作函数声明为 `async`）；接线数量 >8 根时可用瞬时接线（`addConn`）。
- **默认不接线（通用要求）**：系统初始化后画布默认**无任何预接线**（`applyAllPresets` 在 `ControlSystem.init` 中被调用时不做接线）；仅工具栏「自动接线」、工作流 `op.act`、或「启动系统」时按需接线。
- **参数调整一律走配置界面（硬性要求）**：自动演示步骤中凡涉及**可通过参数配置界面改变的参数**（电压幅值、电阻阻值等），演示时**必须调出该组件的参数配置界面**，动态演示参数调整的完整过程：`comp.showConfigDialog()` 弹出对话框 → 高亮目标参数输入框（`wf._flashDomElement(el, tip, ms)`）并填入新值 → 高亮「保存」按钮并点击确认。禁止直接改组件内部属性完成参数调整（如直接赋 `ac.vRms=240`）。参考实现：`project/sys_cddg3-2.js` 的 `_demoSetConfig()`、`project/sys_cddg8-2-1-4.js` 的 `_demoSetPhase()`。
  **注意**：弹对话框前必须把组件实时属性同步进 `comp.config` 副本（`getConfigFields()` 无 `get` 的字段直接读 `config`），否则「保存」会把副本旧值（如电源 `isOn=false`）一并回写，导致状态回退（如电源被关闭）。
- **示波器波形自动调档（通用要求）**：自动演示中示波器接线后，若按当前档位波形显示不完整（越出屏幕或仅占很小区域），演示须**自动按下对应通道的「CHx档」按钮调整档位**，直至波形完整充满屏幕（实测峰值 ≤ 约 4 格取最小档），停留 2~3s 使波形展示清晰后再进入下一步骤。参考实现：`project/sys_cddg3-2.js` 的 `_autoRangeOsc()`。
- **故障设置一律走故障界面（硬性要求）**：自动演示步骤中凡涉及**设置故障 / 修复故障**，演示时**必须完整演示故障设置界面的操作过程**，不得直接调用 `FAULT_CONFIG[id].trigger()/repair()` 跳过界面。工作流中应写 `{ type:'fault', fault:'<故障id>', repair?:true, msg:'…' }` 的 op，由演示引擎 `Workflow._introFault()` 按序演示：① 箭头指向工具栏「故障设置」按钮 → 点击打开界面；② 箭头指向目标故障复选框（高亮）→ 勾选（设置）或取消勾选（修复）；③ 箭头指向「应用设置」按钮 → 点击保存/应用。参考实现：`tools/Workflow.js` 的 `_introFault()`（各工程的 `sys_ljdq1-2.js` 等已使用该 op 形式）。op 的 `act()` 只需占位延时，**不要**再直接注入/修复故障，避免与界面流程重复。
- **选择仪表一律走仪表界面（硬性要求）**：自动演示步骤中凡涉及**调出/选择仪表**（万用表、示波器等），演示时**必须完整演示仪表选择界面的操作过程**，不得直接设置 `comp.group.visible(true)` 跳过界面。工作流中应写 `{ type:'instrument', instrument:'<仪表id>', msg:'…' }` 的 op（注意字段是 `instrument`，**不是** `target`），由演示引擎 `Workflow._introInstrument()` 按序演示：① 箭头指向工具栏「选择仪表」按钮 → 点击打开界面；② 箭头指向并高亮目标仪表复选框 → 勾选；③ 箭头指向「关闭」按钮 → 点击保存/关闭界面。op 的 `act()` 只需占位延时（可顺带设置仪表档位等），**不要**再直接显示仪表，避免与界面流程重复。参考实现：`tools/Workflow.js` 的 `_introInstrument()`。
- **仪表测量接线用动画接线（通用要求）**：自动演示中凡涉及**仪表（万用表表笔、示波器探头等）的接线**，若接线数量 **≤8 根**，一律使用动画接线（`sys.connMgr.addConnectionAnimated({ from, to, type: 'wire' })`，约 3s/根，逐根 `await`，操作函数声明为 `async`）；**禁止**用瞬时 `addConn` 画表笔线。参考实现：`project/sys_cddg10.js` 的 `_probeAnimated()`（先清除旧表笔线，再逐根动画接上红/黑表笔）。
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

### 参数配置一律走配置界面（硬性要求）

自动演示中凡涉及**可通过参数配置界面改变的参数**（电压幅值、电阻阻值、电机负荷率、延时时间等），
必须完整演示"弹出配置界面 → 改参数 → **点击保存** → 关闭对话框"的全过程，禁止直接改组件内部属性。

标准实现（可直接复制 `project/sys_cddg11.js` 的 `_demoSetCfg(wf, compId, key, value, tip)`）：

1. **弹框前同步实时属性**：遍历 `comp.getConfigFields()`，对没有 `get` 的字段把 `comp[f.key]` 写回
   `comp.config[f.key]`；否则「保存」会把 config 副本里的旧值（如电源 `isOn=false`）一并回写，导致状态回退。
2. **弹框**：`comp.showConfigDialog()`，等待约 700ms。
3. **定位输入框**：参数输入框的 id 固定为 **`diag_<key>`**（如 `diag_loadRate`），
   `document.getElementById('diag_' + key)`；用 `wf._flashDomElement(input, tip, 2400)` **闪烁箭头高亮**，
   再 `input.value = value` 并派发 `input`/`change` 事件。
4. **点击保存（必须真正按下）**：保存按钮文本精确等于 `保存`，
   `[...document.querySelectorAll('button')].filter(b => b.textContent.trim() === '保存')`，
   **取最后一个**（对话框按打开顺序追加到容器）；先用 `wf._flashDomElement(btn, '点击「保存」确认参数修改', 1800)`
   **闪烁箭头指向保存按钮**，再 `btn.click()`——**只提示不点击是不允许的**。
5. **确认对话框已关闭**：保存后若 `#diag_<key>` 仍可见，点「关闭/取消」按钮关闭对话框。
6. **生效兜底**：若保存后参数仍未生效，调 `comp.onConfigUpdate({ [key]: value })` 保证演示不中断。

> 注：仅弹框、只填值、或只显示"请点击保存"的文字提示而**没有箭头指向保存按钮、没有真正 click()**，
> 均视为不符合规范（学员看不到"按下保存"这一关键动作）。

