# AGENTS.md（全局 / 仿真平台）

本文件是 `C:\simulation` 工作区的**全局规范**，适用于 `lab_01` ~ `lab_08` 等所有子工程。
各子工程内的 `AGENTS.md` 可补充其特有约定；如有冲突，以子工程文件为准。
（子工程 AGENTS.md 中“完整规范见全局 `AGENTS.md`”即指本文件。）

## 语言规则

- 所有面向用户的回答、总结、过程说明、代码审查意见、设计决策解释、教学文档、UI 文字
  必须使用**中文**。
- 代码本身（变量名、注释、技术文档）不受此限。

## 仿真平台工作流自动演示模式规范

### 核心原则：指向 → 操作 → 指向下一个 → 操作

自动演示（show 模式，`Workflow._executeSingleStep`）执行带 `op` 数组的步骤时，
**必须逐个操作、边指边做**：

> 箭头指向当前被操作的组件/部件 → **立即执行该操作** → 短暂停留让学员看清结果 →
> 箭头指向下一个组件/部件 → **立即执行该操作** → ……

**严禁**“先把本步所有组件的指示/箭头展示完，再统一执行所有操作”。

### 实现方式：每个 op 自带 act

演示引擎对 `op` 数组的处理是「逐个：指示 → 执行该 op 的 act → 延时」：

```js
for (const op of ops) {
    await this._animateOpIntro(step, opObj);   // 箭头闪烁 + 组件高亮 + 提示 + 观察延时
    if (typeof opObj.act === 'function') {
        await opObj.act.call(this);            // 指向后立即执行该项操作
    }
    await new Promise(r => setTimeout(r, 1200)); // 停留，让学员看清本步结果
}
// 仅当所有 op 都没有 act 时，才回退执行整体 step.act()
if (!ranSubAct && step.act) await step.act.call(this);
```

据此约定：

- **单操作步骤**：可以只用一个 `op`，把操作写在 `step.act()` 里（引擎会回退执行）。
- **多操作步骤**：**每个 op 都必须自带 `act()`**，只把该项对应的动作放进该 op，
  不要再把整步动作合并到 `step.act()`。
- 每个 op 的 `msg` 写清该步“做什么”，`act` 只做这一件事。

```js
// 正确：指向一个 → 做一个 → 再指向下一个 → 再做
op: [
    { type: 'switch', target: 'box', part: 'qf-breaker', msg: '断开电源开关',
      act() { /* 断开 QF / 停机 */ } },
    { type: 'observe', target: 'megohm', part: 'l', msg: 'L 端接 U 相、E 端接 PE',
      async act() { await _wireMegohm(sys, 'u', 'pe'); } },
    { type: 'observe', target: 'megohm', part: 'crank', msg: '摇动测量',
      async act() { await _crankUntil(sys, r => Math.abs(r - 80) < 4); } },
],
```

```js
// 错误：先展示完所有指示，最后再统一操作
op: [
    { type: 'switch', target: 'box', part: 'qf-breaker', msg: '断开电源开关' },
    { type: 'observe', target: 'megohm', part: 'l', msg: 'L 端接 U 相、E 端接 PE' },
    { type: 'observe', target: 'megohm', part: 'crank', msg: '摇动测量' },
],
async act() { /* 断开 QF + 接线 + 摇动 全部塞在这里 */ },
```

### 各步骤类型节奏

- **find（识别/点击）**：箭头闪烁指向组件/部件中心（约 2.5s）→ 停约 2s →
  模拟点击（记录 `lastClickedId` 并高亮一闪）→ 停约 2s。
- **check（操作/演示）**：按上面的“指向 → 操作”逐 op 进行；每个 op 指示后立即执行其 `act`。
- **quiz（测试题）**：展示题目 → 停约 2s → 高亮正确选项并以箭头指向 →
  展示“正确答案 + 解析” → 停约 6s 自动关闭。
- **fill（填空题）**：展示题目 → 自动填入/展示正确答案。

### 操作一律用模拟点击，不直接赋值（硬性要求）

自动演示中凡是"按钮/旋钮/开关/选项/复选框"类操作，**能直接模拟点击的就必须像真的一样点击**
——触发组件/页面自身的 `click` 处理逻辑（`node.fire('click')`、复选框 `.click()`、
Konva 节点 `.fire('click tap')` 等），**禁止**绕过交互直接给属性赋值
（如 `cc.levelCtrl.inputChannel='ch2'`、`ai.channels.ch1.mode='disable'`、
`comp.group.visible(true)`、`FAULT_CONFIG[id].trigger()`）。

原因：① 学员看到的是一次"按下"动作，直接赋值会让画面毫无反馈；
② 组件点击处理里还包含联动逻辑（循环切换档位、发送总线帧、刷新行显示、
加/去重记录等），赋值会漏掉这些，导致状态与画面不一致。

实现要点：

- 组件用 `addClickablePart(partId, x, y, w, h)` 注册部件时，`_parts[partId]` 应**同时保存
  `node`**，以便 `getClickablePartNode(partId).fire('click')` 能取出真实节点。
- 分页类组件（如监控主机的 AI 设置页旋钮、液位页通道按钮）若未用 `addClickablePart` 注册，
  项目侧应在登记部件几何时一并保存 node（见 `project/sys_dgdq8.js` 的 `_registerCCParts`），
  并提供统一的点击辅助函数（如 `_firePartClick(comp, partId)`）。
- 只有当部件确实取不到节点（未注册/已销毁）时，才允许**带 `console.warn` 的兜底赋值**，
  且兜底不应当是主路径。
- 需要"调成某个目标值"的操作（如循环切换的 Mode 旋钮 `normal→disable→test`），应
  **反复点击直到目标值达成**（限次，如 4 次），而不是一次性赋值。

### check() 必须覆盖步骤的全部验收点（硬性要求）

演练（train）/评估（eval）模式靠 `check()` 判定该步是否完成，因此 **`check()` 必须与步骤
描述里承诺的每一个验收点一一对应**，缺一项就会"描述已完成但判不过"或"没做也算过"：

1. **故障设置/修复步骤**：除了 `FAULT_CONFIG[id].check()` 判定故障标志，
   若该故障**会触发报警**（`_faultStep` 的 `waitAlarm` 为真），还必须检测监控主机
   `cc.activeAlarms` 确实产生了报警（可再按 `waitText` 校验报警文字）。
2. **含"定位"字样的步骤**：必须校验学员**点击过对应模块**（如 `sys.lastClickedId === 'ai'`），
   不能只看故障标志。
3. **含"进入/切到某某页面"的步骤**：必须校验**已切换到对应页签**
   （如 `cc.activePage === 3`），不能只看参数是否改对。
4. **含"按下按钮使某装置响应"的步骤**：若该步会松开按钮/复位锁存（导致结束时状态已消失），
   必须在 `act()` 中用**步骤级标记**记录"本轮确实达成过"（如 `this._projFlag.s2Alarm = true`），
   `check()` 读该标记兜底，否则结束状态必为假、演练模式永远过不去。

### 指示箭头必须指向「目标本身」（硬性要求）

自动演示中的闪烁箭头是学员的“视线引导”，必须精确指向真正被操作的对象，**不得一律指向组件中心**：

- **接线 → 指向端口**：凡涉及接线的 op，箭头**必须指向所接线的端口**（端口的画布绝对坐标），
  不得指向组件中心。op 需携带端口信息：

  ```js
  { type: 'observe', target: '<compId>', ports: ['<fromPortId>', '<toPortId>'], msg: '…', async act() { /* 接线 */ } }
  ```

  由演示引擎 `Workflow._introPorts()` 解析端口中心（BaseComponent 的 `getAbsPortPos(portId)`）并
  闪烁箭头，两端可同时（`Promise.all`）指示。组件只要用 `addPort()` 正确定义端口即可。

- **操作子部件 → 指向部件中心**：凡操作组件内的具体子元素（按钮、旋钮、开关手柄、LCD 等），
  箭头**必须指向该子部件的中心**。工作流 op 用 `part` 字段传入部件 id：

  ```js
  { type: 'switch', target: '<compId>', part: '<partId>', msg: '…', async act() { /* 操作 */ } }
  ```

  由 `comp.getClickablePartCenter(partId)` 返回部件绝对坐标（组件须在 `_init()` 中用
  `addClickablePart(partId, x, y, w, h)` 注册）。

> 回退规则：仅当目标组件确实没有可定位的部件/端口信息时，才允许回退到组件中心。

### 故障设置/修复一律走故障界面（硬性要求）

自动演示中凡涉及**设置故障 / 修复故障**，**必须完整演示故障设置界面的操作过程**，
不得直接调用 `FAULT_CONFIG[id].trigger()/repair()` 跳过界面。工作流中写：

```js
{ type: 'fault', fault: '<故障id>', repair?: true, msg: '…', async act() { /* 仅占位延时 */ } }
```

由演示引擎 `Workflow._introFault()` 按序演示（每一步都“先箭头指示、再动作”）：

1. 箭头指向工具栏「故障设置」按钮 → 点击打开界面；
2. 高亮并箭头指向目标故障复选框 → 勾选（设置）或取消勾选（修复）；
3. 箭头指向「应用设置」按钮 → 点击保存/应用。

op 的 `act()` 只做占位延时，**不要**再直接注入/修复故障（界面流程已执行），否则会重复操作。

### 选择仪表一律走仪表界面（硬性要求）

自动演示中凡涉及**调出/选择仪表**（万用表、示波器等），**必须完整演示仪表选择界面的操作过程**，
不得直接设置 `comp.group.visible(true)` 跳过界面。工作流中写：

```js
{ type: 'instrument', instrument: '<仪表id>', msg: '…', async act() { /* 仅占位延时 */ } }
```

> 注意字段是 `instrument`，**不是** `target`。

由演示引擎 `Workflow._introInstrument()` 按序演示（每一步都“先箭头指示、再动作”）：

1. 箭头指向工具栏「选择仪表」按钮 → 点击打开界面；
2. 箭头指向并高亮目标仪表复选框 → 勾选；
3. 箭头指向「关闭」按钮 → 点击保存/关闭界面。

op 的 `act()` 只需占位延时（可顺带设置仪表档位等），**不要**再直接显示仪表，避免与界面流程重复。

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

### 仪表测量接线用动画接线（通用要求）

自动演示中凡涉及**仪表（万用表表笔、示波器探头等）的接线**，若接线数量 **≤8 根**，
一律使用动画接线（`sys.connMgr.addConnectionAnimated({ from, to, type: 'wire' })`，约 3s/根，
逐根 `await`）；**禁止**用瞬时 `addConn` 画表笔线。参考实现：`project/sys_cddg10.js` 的
`_probeAnimated()`（先清除旧表笔线，再逐根动画接上红/黑表笔）。

### 接线与读数节奏

- **接线**：一次接线数量 **≤8 根**时，一律使用动画接线
  （`sys.connMgr.addConnectionAnimated({ from, to, type: 'wire' })`，约 3s/根，逐根 `await`，
  操作函数声明为 `async`）；数量 **>8 根**时可用瞬时接线（`addConn`）。
- **默认不接线**：系统初始化后画布默认**无预接线**；`applyAllPresets` 在
  `ControlSystem.init` 中被调用时不做接线，仅工具栏「自动接线」/工作流 `op.act`/
  「启动系统」时按需接线。
- **读数类演示**：应先让仪表读数**稳定**（连续多次基本不变）后再进入下一步，
  不要读到一半就跳步。

### 提示信息隔离

进入自动演示（show）模式后，**抑制组件自身的流程提示**
（`sys._suppressComponentTips = true`；`showFloatingTip` 首行据此返回），
画面只显示与自动演示相关的信息（步骤说明、箭头/圈选指示、演示专用提示），
避免组件提示与演示提示相互干扰。
演示引擎自身提示统一走 `Workflow._tipWorkflow(msg, ms)`（临时置 `sys._tipBypass` 绕过抑制）。
演示中的组件状态变化（跳闸、报警灯、仪表读数）仍照常生效，仅**文字提示**被抑制；
演示结束或关闭流程面板时恢复 `false`。

### 画布与定位约定

- 画布元素用 Konva 节点直接 add/remove + `requestRedraw`；
  **不使用** `shadowColor` / `shadowBlur` / `shadowOpacity` 三件套。
- 组件实现 `getClickablePartCenter(partId)` 时**必须返回画布绝对坐标**
  （用组件的绝对变换换算，计入组件自身的位移、旋转与缩放），否则箭头会指偏。
- **旋转/缩放组件（硬性要求）**：部件/端口坐标一律视为组件**本地坐标**，指示前用
  `comp.group.getAbsoluteTransform().point({ x, y })` 换算为画布绝对坐标；**禁止**只用
  `comp.group.x() + part.x`（只加位移、不含旋转/缩放，组件旋转后会指偏）。
  `_COMP_PARTS` / `_parts` 等坐标表一律保存部件的**本地（未旋转）坐标**，由绝对变换自动计入旋转。
- 端口定位复用 BaseComponent 的 `getAbsPortPos(portId)`；组件用 `addPort()` 定义端口后即可
  供接线演示箭头定位，无需再注册部件。
