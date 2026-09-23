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
