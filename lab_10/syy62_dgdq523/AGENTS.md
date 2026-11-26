# AGENTS.md

## 语言规则

**所有回答、总结、过程说明、代码审查意见、设计决策解释等与用户的交流内容，必须使用中文。**
代码本身（变量名、注释、技术文档）不受此限，但面向用户的任何文字都必须是中文。

## 教学文档规范

- 编写工程教学文档一律使用 **Markdown** 格式（`.md`）。
- 文档**文件名与 `index.html` 中的 `<title>` 标题同名**（本工程为 `风油切断装置的功能实验.md`）。
- 配图统一放入工程下的 `docs-img/` 文件夹，文档内用相对路径引用（如 `![图 1 组成原理图](docs-img/xxx.svg)`）。
- 配图**文件名统一带「特征前缀」**：以**该工程仿真内容的英文概要**作为所有配图的统一前缀（本工程为风油切断装置的功能实验 → `wind-fuel-cutoff-`），前缀后用 `-` 连接图名，例如 `wind-fuel-cutoff-composition.svg`、`wind-fuel-cutoff-control.svg`。目的：同一工程的配图统一可检索、可归类、可跨工程复用。
- 文档字数一般**不超过 2000 字**（用户另有明确要求时从其要求）。

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

> **可点击部件（模拟点击用）**：部件要在自动演示里被"真实点击"，登记时必须同时保存命中节点——
> `comp._parts[id] = { x, y, w, h, node }`（`addClickablePart()` 返回的 hit，或组件自身的交互节点均可），
> 工作流就能用 `comp.getClickablePartNode(id).fire('click'/'mousedown'/'mouseup')` 触发组件原有处理逻辑。
> **方向性部件**（左/右半区、顺时针/逆时针摇柄）必须拆成两个独立热区分别登记
> （合成点击没有指针位置，无法用"按指针判断左右半"的写法）。参考：`VacuumCircuitBreaker.js`
> 的 `dial-cw` / `dial-ccw`、`HvGenRemotePanel.js` 的 `start` / `stop`、`close` / `open`。

> **部件中心取命中节点实际位置（硬性要求）**：`BaseComponent.getClickablePartCenter()` 在部件登记了命中节点时
> 直接取节点中心（`getNodeCenter()`），只有在没有节点时才退回 `p.x + w/2` 再套组件绝对变换。
> 组件内部若把 `_staticGroup` / `_dynamicGroup` / `_interactGroup` 整体平移（如
> `MainEngineLubeOilMimic` 三层统一 `y(60)`），只用 `p.x/p.y` 算出来的箭头会整体偏掉
> （实测偏高 60 px，箭头指不到「手动」「▼」）。
> **旋转/缩放组件定位（硬性要求）**：凡组件带有 `rotation`（含配置旋转、运行时右键/代码
> 旋转）或 `scale`，指示箭头/圈选的部件坐标**必须按组件的绝对变换换算**——把部件坐标当作
> 组件**本地坐标**，用 `comp.group.getAbsoluteTransform().point({ x, y })` 换算成画布绝对坐标
> （`BaseComponent.getAbsPortPos()` 即为此写法）。**禁止**只用 `comp.group.x() + part.x` 这种
> 只加位移、不含旋转/缩放的算法，否则组件旋转后箭头会指偏。`_COMP_PARTS` / `_parts` 等
> 坐标表一律保存部件的**本地（未旋转）坐标**，由绝对变换自动计入旋转。

## 工作流一律按「最新范式」编写

- **取材**：改写/新增工作流前，先在**同级（相邻）工程目录**里找到**最新的工程文件**，以它的
  `PROJECT_WORKFLOWS` 作为范式模板，**不要沿用旧工程的写法**。
  当前最新参照：`lab_10/syy50_ljzdh86/project/sys_ljdq8-6.js`（本工程的燃油供油单元单页工程），
  其次 `lab_10/syy39_ljdq54/project/sys_ljdq5-4.js`、`lab_10/syy38_ljdq53/project/sys_ljdq5-3.js`。
  本工程当前项目文件：`project/sys_ljdq8-9.js`（船舶**主机高温冷却水（缸套淡水）温度控制系统**，**单页工程**；
  两条设备：`mimic`（冷却水系统 MIMIC 图）+ `ldcl`（LDCL 冷却水温度控制器））。
  前一项目 `project/sys_ljdq8-6.js`（燃油供油单元 FCM + EPC-50B）及更早的 `sys_ljdq8-7.js`（辅锅炉 PLC）、
  `sys_ljdq8-8.js`（分油机 EPC-50）文件与组件均保留，需要时可切回。

## 本工程：10 页工程（`project/sys_ljdq9-1.js`，生效项目文件）

`consys.js:50` 与 `lib/WorkflowManager.js:4` 均引用 `project/sys_ljdq9-1.js`（与 `project/sys_ljdq10-4.js`
内容相同，为同一工程的副本）。**共 13 页（页 0 索引 + 12 个装置页），现有 4 条工作流：主机的起动功能测试 / 主机的调速功能测试 /
主机超速保护实验 / 主机滑油低压保护模拟实验**
（K-Chief 的「模拟量参数的修改」「开关量参数的修改」两条流程已删除，辅助函数 `_click` `_openParamByTag`
`_turnScrew` 等仍保留供后续复用）：
· **`alarm-ack`「1. 报警信息获取及报警应答」**（6 步，跨页：10 → 1 → 1 → 1 → 10 → 1）：
   ① 第 10 页 TIC-101 切**手动**、按 ▼ 把冷却口 OUT 降到 **< 5 %**（`_lowerCoolingOut()` 循环点击直到达标），
      观察滑油温度上升；② 回第 1 页等 `MAIN L.O.INLET TEMP HIGH` 触发**自动减速**（不越控）；
   ③ Alarms → **Alarm History** 看全部报警；④ 按**消音** + **ACK**；⑤ 回第 10 页 TIC-101 切**自动**，
      温度回落到 45 ℃ 附近（< 52 ℃）；⑥ 回驾控台开 Alarm History，**按住车钟手柄真实拖动到 SLOW 档**
      （`_dragTelegraphTo()`：向画布派发 mousedown → 逐段 mousemove → mouseup；坐标用 `getAbsoluteTransform()`
      换成 **CSS 像素**，不能再乘 canvas 像素比，否则 dpr=1.5 时拖不动）→ `rpmCmd = 27`、`leverIdx = 3`，复位自动减速。
   驾驶台面板另有两个仅供演示定位的部件：`alarm-bar`（报警信息栏 126,504,1020,78，第 2 步箭头指向它）、
   `telegraph`（车钟整列，`getClickablePartCenter()` 已重写为返回**手柄当前位置**，第 6 步箭头指向手柄）。
   每步 `check()` 逐项对应文案要求（手动态 OUT<5、`slowDown`、`_subPage==='history'`、`silenced&&acked`、
   `pid.auto && temp<55`、`!slowDown && !sldAwaitReset && |rpmCmd|<40`）。
· **`ctrl-transfer`「2. 操纵地点转换」**（4 步，跨页：1 → 2 → 2 → 3）：
   ① 驾控台按 `pos-ecr` → `transferReq = { from:'BRIDGE', to:'ECR', by:'give' }`（ECR 按钮闪烁、状态条
      `Control Transfer`）；② 到集控台**用 `_dragTelegraphTo()` 真实拖车钟**到与驾驶台一致的档位
      （档位由 `M._idxOf(M.leverRpm.BRIDGE)` 实时算，不写死），再按 `pos-ecr` 接管 → `controlPos = 'ECR'`；
   ③ 集控台按 `pos-local` 发出交出请求（`by:'give'`，目标 LOCAL）；④ 到机旁面板按 `tel-<idx>`（同名档位，
      与驾驶台一致）→ 用 `_dragLocalDialTo()` 把调速手柄拖到同一转速 → 按 `pos-local` 接管 → `controlPos = 'LOCAL'`
      （机旁用 `localCompatible` 判据：ECR 不在 STOP 时档位差 ≤2 即相容）。
· **`cancel-sld`「3. 主机遥控系统的越控操作」**（**6 步**，跨页：1 → 11 → 1 → 1 → 11 → 1）：
   ① 驾控台 `btn-param` → `sub-psafety`，**双击 `sdel-sld-cw-t` 行**把缸套水出口温度高的 SLD 延时改为 **15 s**，
      最后按 `sub-home` **退回主界面**（`check()`：`getSafetyDelay('sld-cw-t')===15` 且 `!subPage`；
      ⚠ 按 Home 后 `_openSub('home')` 会把 **`_menuPage` 和 `_subPage` 都置 null**，
      所以判据只能写 `!subPage`，**不能**再要求 `_menuPage === 'btn-param'`，否则演练模式永远判不过）；
   ② 第 11 页按 LDCL 的 `am` 切**手动**、按 `down` 把冷却口开度减到 **< 25 %**（`manualOut` 每按 −1 %），
      等温度升到 86 ℃ 左右；③ 回驾控台等**预报警**（`M.sldPre`，弹 `SLOW DOWN ACTIVE / CANCELLABLE`）
      立即按 `cancel-sld`（面板按钮是"按一次越控、再按一次复位"，act 里最多点两次保证处于越控态）
      → `cancelSLD && sldCancelled && !slowDown`；④ 消音 + ACK；⑤ 第 11 页 `am` 切回自动，等温度 < 88 ℃；
   ⑥ 回驾控台**再按一次 `cancel-sld` 复位（释放）越控** —— 本次已越控、没有发生自动减速，
      **不需要动车钟**（不必拉到 SLOW 再推回）；按钮是切换型，act 里按到 `M.cancelSLD === false` 为止
      （最多两次），面板 Cancel 指示灯随之熄灭。`check()`：`!cancelSLD && !slowDown && !sldAwaitReset`。
· **`auto-stop-reset`「4. 自动停车故障的排除及复位」**（5 步，跨页：10 → 10 → 1 → 10 → 1）：
   ① 第 10 页点 `cv3c` 把压力开关取压切到手摇泵（`m.sw3b='pump'`）；
   ② 按 `hp2-dn` 把 `m.handP2` 降到 **0.14 MPa**（每次 −0.01），`psw1.getSwitchOutput() === 1`（NC 触点闭合）；
   ③ 回驾控台等安保延时到 → `M.shutDown`，报警 `MAIN L.O. LOW-LOW PRESS, SHUTDN`，消音 + ACK；
   ④ 第 10 页按 `hp2-up` 升到 **0.21 MPa**（`getSwitchOutput() === 0` 复位），再点 `cv3c` 切回滑油入口（`'line'`）；
   ⑤ 回驾控台**把车钟手柄拖回 STOP**（`_dragTelegraphTo(..., 5)`）→ 自动停车复位：
      `shutDown / loLowLowShd` 清除、`engineReady` 恢复、报警按应答状态清除。
   ⚠ **自动停车的车钟复位规则**（`AC600Solver`）：`safetyAction('SHD')` 置 `shdResetArmed = true`、并把
      `rpmCmd` 直接清零（**这不算人工拉 STOP**）；只有在 `shdResetArmed` 期间**车钟被人工命令到 STOP**
      （`setLeverAt/setLeverById` 里 `|rpmCmd| < 0.5` → `_shdStopAck = true`）才解除 `shutDown`、
      清 `loLowLowShd / jcwLowShd / overspeedTripped`、恢复备车并调 `_shutAlarmReturn()`。
**启动后默认进入第 1 页**（主机遥控系统 AC 600 驾控台）—— `consys.js` 的 `init()` 中为
`this.pageMgr.navigateTo(1)`；如需改默认页，改这一处即可（索引页仍在，可用工具栏「主页」回到页 0）。

| 页 | 组件 id | 主题 |
|---|---|---|
| 1 | `ac600-bridge` | 主机遥控系统 AC 600 驾控台面板 |
| 2 | `ac600-ecr` | 主机遥控系统 AC 600 集控台面板 |
| 3 | `ac600-local` | 主机遥控系统机旁面板 |
| 4 | `ac600-pneumatic` | 主机气动操纵系统图 |
| 5 | `ac600-mimic` | 现场总线型主机遥控系统（系统结构 MIMIC） |
| 6 | `kchief` | K-Chief 600 报警系统主界面 |
| 7 | `extunit` | K-Chief 600 延伸报警单元 |
| 8 | `topo` | 现场总线型监视报警系统（K-Chief 600 拓扑） |
| 9 | `deadman` | 轮机员安全系统（Dead Man） |
| 10 | `lomimic` + `psw1` | 主机滑油系统（MIMIC + YT1226 压力继电器） |
| 11 | `cwmimic` + `cwpid` | 主机缸套冷却水温度控制系统（MIMIC + LDCL 温度 PID 面板） |

> **索引页版式**（`lib/PageManager.js` 的 `_showIndexPanel()`）：**标题/说明固定在上方**（浮层 `justify-content: flex-start`），
> **5 列网格**（`repeat(5, minmax(0,1fr))`，`gap 14px`，宽 `min(1840px, 98vw)`），
> 卡片 `minHeight 150px / maxHeight 178px`、标题 16.5px、说明 12.5px（3 行截断），
> **一屏可容纳 5 × 4 = 20 张卡**。

## 主机遥控系统 AC 600（页 1~5，MAN B&W AutoChief 600）

- **共享模型**：`tools/AC600Solver.js`（`sys.ac600`，由 `consys.js` 物理循环每帧 `solve(1/20)` 驱动；
  组件侧用 `ac600Of(sys)` 取实例）。5 个页面共享同一状态，任一处操作其余页面同步变化。
  主要字段：`controlPos`（`BRIDGE` / `ECR` / `LOCAL`，三处互斥，只有当前位置能操车钟）、
  `engineMode`（`SEA` / `STANDBY` / `FWE`）、`leverIdx`（`TELEGRAPH` 11 档，0=NAV FULL … 10=EM'CY ASTERN）、
  `rpmCmd`（车令/LEVER）/ `setp`（受限后的转速给定，送调速器）/ `rpm`（实际转速，**倒车为负值**）/ `activeLimiter`（正在执行的限制名）/ `load` / `startAir`（28.3 bar）/ `controlAir`（7.0 bar）/ `hydOil`（280 bar）、
  `running` / `starting` / `startBlocked` / `startFail`、`slowDown` / `shutDown` / `cancelSHD` / `cancelSLD` /
  `cancelLimits`、`turningGearOut`（盘车机脱开）/ `airDistributorOk` / `mainStartValveOk` / `engineReady`、
  `alarm` / `alarmText` / `silenced` / `acked`、`runHours` / `rev`。
  方法：`setControlPos()` `forceTakeControl()` `stepLever(dir, where)` `setLeverById(id, where)` `stepRpmCmd(±)`
  `startEngine(slow)` `emergencyStop()` `toggleEmStopCover()` `pressEmStop()`（自锁：按下→应急停车并保持，
  再按→弹出取消）`cancelSafety('SHD'|'SLD'|'LIM')` `toggleSafety(kind)` `raiseAlarm()` `ack()` `silence()`
  `lampTest()` `toggleTurningGear()` `toggleLoadLimit()` `reset()`。
- **负荷**：`load = 22 + 0.9 × |rpm|`（上限 105 %，负荷限制时封顶 80 %）—— **倒车按转速绝对值计负荷**，
  反向转速越大负荷越高（−21 → 41.5 %、−41 → 59.5 %、−55 → 72.1 %），正/倒车对称；`fuelIndex` 取 `load`。
- **限制链路（`_stepSetp()`）**：车令 `rpmCmd` → 受限 `setp` → 实际 `rpm`。
  · 车令落临界禁区（30~37）：**升速避下限 SETP=37**、**降速避上限 SETP=50**（方向按实际转速趋势判断），限制名 `Crit. Speed`；
  · 升速：`setp < 57` 走加速度限制（2 rpm/s，`Accel. Lim.`），`≥57` 走 Load Up 程序（57→68 / 3 min ≈ 0.061 rpm/s，`Load Up`）；
  · 降速：`setp > 57` 走 Load Down 程序（68→57 / 2 min，`Load Down`），`≤57` 走减速度限制（3 rpm/s，`Decel. Lim.`）；
  · `setp` 不取整（程序速率很慢，取整会卡住）；`limits` 字段由 Limiters 面板 SAVE 同步；
  · **最低稳定运行转速（MSRS）**：车令不是 0、但**低于 `limits.steadyMin`（默认 21 rpm）**时，
    调速器输出给定 `setp` **保持在 ±21 rpm**（`activeLimiter = 'Min. Speed'`，SETP 柱与数值即显示 21）；
    正/倒车对称（−5 rpm 的车令给 −21）；**车令 = 0（STOP）仍给 0**，主机照常停车。
    **机旁调速手柄**（`localSpeed` → `rpmCmd`）走同一条链路，同样受限。
    ⚠ **只在主机起动成功、开始点火之后才生效**：`msrsActive = !_airTurn && !_tgDriven && (running || starting)`
    —— **冲车 / 慢转（起动空气带转）与盘车机带转一律不遵循**（实测冲车 20 rpm、慢转 5 rpm、盘车时
    `setp` 保持车令值，不会被抬到 21）。
    取 `starting` 是为了在转车结束后 `setp` 已 ≥ MSRS，否则转速会从 12 rpm 被 setp=0 拉回到停车。
  · **Cancel Limits 越控**（`model.cancelLimits`）时 `_stepSetp()` 直接令 `setp = 目标值`（加速/减速/Load Up·Down 速率限制全部取消），
    仅保留临界转速避让与最低稳定转速；
  · **主机惯性最大变速率 `model.inertiaRate = 68/15 ≈ 4.53 rpm/s`**：`rpm` 追随 `setp` 时按此速率升降
    （停车动作仍为 55 rpm/s），因此**所有限制取消时 68 → 0 约 15 s**（最快下降，不会瞬跳）、0 → 68 约 15.4 s；
  · **起动方向随车令**（`_startDir = rpmCmd >= 0 ? 1 : -1`）：倒车车令时起动空气把主机**反转**转车到 −12 rpm，
    完成后最低转速取 −12（正车仍 +12）；转车目标为 `_startDir * 12`；
  · **车令稳定 0.4 s 才起动**（`_cmdHold`，`rpmCmd` 一变就清零）：拖动车钟途中车令连续变化，不得起动——
    否则从倒车侧往上拖到正车全速时，拖过倒车区那一下会以**倒车**方向起动（之后才被纠正，属明显错误）；
  · **静止时不自行升速**：`!running && |rpm| < 1` 时 `rpm` 固定为 0（必须经起动程序用起动空气转起来），
    否则车令稳定 0.4 s 之前就把转速顶过 1 rpm，"起动"被跳过（Engine State 不显示 Starting）；
  · **过零换向不得重复起动**：`_autoStart()` 要求主机**静止 ≥ 0.3 s**（`_restTime`，`|rpm| < 1` 时累加）才允许起动。
    否则「正车全速 → 应急倒车」时转速过零 `running` 变假，会被当成"停机"反复起动（而且方向是正车），出现来回摆动；现在只会在过零后**起动一次倒车**；
  · **起动空气转车 `START_DURATION = 3 s`**：转车期间转速由 0 **平顺**升到约 12 rpm（`rpm += (12-rpm)*min(1,dt*1.2)`），
    结束后按惯性速率加速。⚠ 不要把时长设长或让转速收敛到固定值（如 10 rpm），否则从 STOP 推到全速会出现
    「转速长时间卡在 10 rpm」的平台（原来是 10 s 平台，已改掉）；慢转程序在此基础上再加 `slowTurnDurS`；
    ⚠ `rpm` **不要**再取整到 0.1（每帧取整会在慢速率下累积掉速，实测把 4.53 变成 4.0），只在 |rpm| < 0.05 时归零；
  · **正在执行的限制显示在主页 SETP/LEVER 柱下方**（如 `Accel. Lim.` / `Load Up`），SETP 柱与数值显示受限给定、LEVER 柱显示本面板车钟。
- **菜单系统（照 AutoChief 600 ACP 真机两级结构）**：
  - **第 1 级**：菜单区 9 个主菜单（Alarms / Limiters / Control Pos. / Misc Menu / Safety System /
    Engine State / B&W Modes / Param. Change / Home），点某项后**菜单区整体切换成该菜单的二级按钮组**，
    液晶区仍显示主页图形（与真机一致，不是弹出浮层）。
  - **状态条第 3 段 = 控制位置**：`Bridge` 绿底白字（`#0aaa20`）/ `ECR` 黄底黑字（`#ffee00`）/ `Local` 红底白字（`#d81e1e`），
    由 `tick()` 每帧按 `M.controlPos` 重设文字与底色（`_segHi[2].opacity(1)`）；
    **转移过程中该段显示 `Control Transfer`（黄底黑字）**。
  - **控制权转移流程**（统一走 `M.pressPosButton(me, pos)`，`me` = 本面板位置，`pos` = 被按下的位置键）：
    `transferReq = { from, to, by }`，`by = 'give'`（控制位置面板发出）或 `'take'`（目标位置面板发出）。
    请求期间三块面板状态条显示 `Control Transfer`、**目标位置灯闪烁**、蜂鸣器鸣响；**车钟一致（≤1 rpm；转机旁用 `localCompatible`）**
    才允许接管，接管后面板显示新位置、蜂鸣器停。再次按同一目标（发起方）→ 取消。
    · **驾驶台 ↔ 集控室：双向自由，任意一侧都可以发起** ——
      控制位置按对方位置 = **GIVE**（对方面板按自己位置确认 TAKE）；
      对方面板按自己位置 = **TAKE**（控制位置面板按自己位置确认 GIVE）。
    · **集控室 ↔ 机旁**：控制权在**集控室**时，集控室按 `Local` = GIVE、机旁按 `Local` = TAKE **都有效**；
      **控制权在机旁时，其它位置按自己的位置键 TAKE 无效**（返回 `'blocked'`），
      **只有机旁按目标位置键 GIVE 才有效**（随后由目标位置确认接管）。
  - **车钟报警蜂鸣器 `M.buzzerOn`（唯一蜂鸣源）**：**只有『车钟操作 / 控制权转换 / 副车钟操作』条件满足才响，
    任何其它报警都不触发蜂鸣器**：① 控制权转换进行中；② **控制权在 ECR：|ECR 车令 − 驾驶台车令| > 1 rpm** 才响（与机旁无关）；
    ③ **控制权在 LOCAL：按"机旁按键式车钟"（副车钟）相容规则** —— ECR 在 STOP 时机旁必须 STOP，
    ECR 不在 STOP 时两边**档位差 ≤ 2 档**即相容（用 `localCompatible`，档位按 `TELEGRAPH` 索引）；
    ④ 控制权在驾驶台：不响。
    `tick()` 中 `_buzzGlow` **只由 `M.buzzerOn` 驱动**（已去掉 `M.alarm && !M.silenced`），
    `_bellRing` 仍为报警视觉指示（紧急停车期间一并抑制）。
  - **副车钟（航行工况 At Sea / Stand By / FWE）—— 只在驾驶台与集控室之间两步回令切换，机旁只显示不参与**：
    `M.requestEngineMode(mode, by)`（`by` = BRIDGE / ECR）：一方按下 → `modeReq = {to, by}`（该工况灯闪烁、蜂鸣器响）；
    **另一方按同一工况回令** → 生效（`engineMode` 常亮）、请求清除；再按一次同一请求 / 按当前工况 → 取消。
    **切换条件**（`M.canSelectMode`）：`SEA` 需**驾驶台车钟在 NAV FULL**；`STANDBY` **不要求主机停车**
（本仿真已放开，满速也可转机动备车 —— 对应工作流 2 第 7 步"FULL 车钟下直接按备车"）；
    `FWE` 需**主起动阀与空气分配器都关闭**（`!mainStartValveOk && !airDistributorOk`）；不满足返回 `'blocked'`。
    **默认工况 STANDBY**（`reset()` 置 `engineMode='STANDBY'`）。机旁面板三个工况按钮已改为**纯显示**（热区无动作）。
  - **转 Local 的接管条件**用 `localCompatible`（不要求连续一致），其余位置仍要求 ≤1 rpm。
  - **机旁面板同样闪烁**：`Ac600LocalPanel.tick()` 中 `pos-bridge/pos-ecr/pos-local` 三个指示灯，
    当 `M.transferReq.to === 该位置` 时按 `M.blink` 闪烁（ECR→机旁时 Local 灯闪烁），接管后常亮、其余熄灭；
  - **圆形指示灯填充**：底部**弓形**（`Konva.Shape` + sceneFunc，弧 + 水平弦），**高度 = 直径的 1/3、顶面水平**（原为半圆）。
  - **第 2 级**：`_subMenuCells()` 定义各项的二级按钮（Alarms：Sys. Critical / Sys. Non-Crit. / ComErr Crit. /
    ComErr Non-Crit. / I/O Fail / Alarm History；Limiters：Overview·Set limiter；Control Pos.：Overview·Transfer；
    Limiters 二级按钮为 `Set Limiters` / `Show Limiters`；**Show Limiters 共 12 项**（扫气压力/转矩/燃油指数/慢降/最低稳定转速/
    手动RPM(Chief)/加速率/减速率/Load Up/Load Down/慢转程序/临界转速），列宽 LIMITER 310 · STATUS 180 · LEVEL 510，
    扫气与转矩的 LEVEL 按「压力-油量」3 点格式（`0 bar-50 %；1.15 bar-80 %；2.3 bar-100 %`）；
    **STATUS 为实时判定**：扫气/转矩＝调速器输出 `fuelIndex` 超过 3 点折线允许值才 ACTIVE；
    加速/减速＝`rpmCmd` 与 `rpm` 差 >1 时 ACTIVE；Load Up/Down＝加减速且实际转速落在 57~68 时 ACTIVE；
    慢转＝停机 `stoppedTime ≥ stopMin`（默认 20 min）才 ACTIVE；临界＝车钟落在 30~37 才 ACTIVE；
    最大转速（Manual RPM Chief）＝车钟超过 68/55 才 ACTIVE；其余默认 INACTIVE；
    默认值：加速 57 rpm·2 rpm/s、减速 57 rpm·−3 rpm/s、Load Up 57~68·3 min、Load Down 57~68·2 min、
    慢转 20 min·10 s、临界 30.0~37.0 rpm；
    **Set Limiters 与之一一对应 12 行**（行高 33），每行 6 槽等间距文本框（双击编辑，DOM input），行尾独立 SAVE/CANCEL，
    仅当本行有修改时 SAVE 可用，CANCEL 还原（`_lim` 为已保存值、`_limEdit` 为编辑副本）；编辑时暂停页面重建；
    Misc：Counters·Order Printer·Service (LTU)；
    **Safety**：`Shut Down`(0,0) / `Slow Down`(1,0) / `RESET SLD`(3,0) / `Emg. Stop`(0,1) / `RPM Detector`(1,1) ——
    **Shut Down / Slow Down / Emg. Stop 三页统一用 `_paintSafetyTable()`**：真机版式表头
    `Active | Cancelled | Loop fail | Description | Value | Alarms`，**Alarms 之后为空白区**（不放任何列表内容，无按钮列），
    动作行红底 + ALARM，长列表滚动翻页（`_listOffset`、`saf-scroll-up/down`）；
    **每行只画自身具备的指示灯**（条目字段 `hasA` 默认 true / `hasC` / `hasL`）：
    Active 动作亮红、Cancelled 越控后**亮红**、Loop fail 亮黄，未具备的列**不画灯**（如 `FUEL CUT-OUT SOL. V/V` 为纯输出行，一盏灯都没有）；
    **行选中 + 逐项越控**：点击某一行 → 该行选中（底色变亮 `#414141`，动作行 `#6d1414`，再点一次取消选中，存 `this._safSel = {page,key}`）；
    选中行**有 Cancelled 灯**时，其右侧空白区出现蓝色按钮 `Cancel SHD` / `Cancel SLD`（部件 id `saf-cancel-<key>`，行热区 `saf-row-<key>`）；
    点一次 → `Cancelled` 灯变红（该故障对应的自动停车/自动减速被取消，行转橙色、ALARM 清空），**再点一次还原**（`_safToggle(page,key)`）；
    本页所有「可越控且动作中」的项目都被越控 → 置 `cancelSHD` / `cancelSLD`，还原任一项则恢复；
    越控标记存 `this._safCancelled`（键 `'shd:os'`、`'sld:eicu-a'` …），`RESET SLD` 清 `sld:*`；
    ⚠ **清标记的时机**：只在「停车/降速动作由有变无」时清（`_safPrevShd` / `_safPrevSld` 记忆上一次状态），
    不要写成"当前无故障就清"——否则点完 Cancel SHD 下一秒 500 ms 重绘就把红标记清掉，灯看起来不变红；
    **两种显示状态**（`_safetyViewMode` = `'all'` / `'active'`）：首次点击子菜单显示全部条目，**再点同一子菜单只显示故障项**
    （无故障时显示 `NO ACTIVE ALARMS`），与 Alarms 各分类的两态规则一致；
    **Shut Down 13 项**（照真机，A=Active、C=Cancelled、L=Loop fail）：
    ENGINE TRIPPED〔A〕/ FUEL CUT-OUT SOL. V/V〔三灯皆无，纯输出行，值 CLOSED↔OPEN〕/ OVERSPEED FROM RPM UNIT〔A+L〕/
    MAIN L.O. LOW-LOW PRESS〔A〕/ THRUST PAD HIGH-HIGH TEMP·T/C LUB.OIL LOW-LOW PRESS·J.C.F.W. INLET LOW PRESS〔各 A+C+L〕/
    EICU A·B SHUTDOWN NON-CANCELLABLE〔A+L〕/ EICU A·B SHUTDOWN CANCELLABLE〔A+C+L〕/ OVERSPEED SYS.1·2 SW BACKUP〔A〕；
    **Slow Down 23 项**：**所有项目都有 A+C 灯**，只有 4 个回路带 Loop fail 灯 —— AXIAL VIBRATION HIGH、OIL MIST HIGH IN CRANKCASE、
    EICU A SLOWDOWN、EICU B SLOWDOWN〔A+C+L〕；
    **Emg. Stop 6 项**：仅第一行 FUEL CUT-OUT SOL. V/V 三灯皆无，其余 5 处 EMERGENCY STOP SWITCH 为〔A+L〕（急停不可越控，无 Cancelled 灯）；
    **⚠ 三个 Cancel 的"按钮灯各面板独立、报警与动作系统同步"**：
    无论本面板是否拥有控制权，按下都**立即作用于系统**（`M.setCancel()` → 报警 `SHUTDOWN/SLOWDOWN/LIMITS CANCELLED` 与
    主机越控/取消限制全部同步生效）；**只有按钮自身的指示灯是各面板独立的**——在集控室按下 Cancel Limits，
    集控室该灯亮、驾驶台该灯不亮（`this._cancel` 各面板自持）。
    例外：**应急倒车**等"系统自动越控"用 `M.autoCancelLimits` 标记，只点亮**控制权面板**的 Cancel Limits 指示灯，人工按下后清除该标记。
    **三个 Cancel 按钮各面板独立（不同步）**：面板自己存 `this._cancel = { shd, sld, lim }` 驱动本面板 Cancel 指示灯与本站点安全页；
    模型侧按位置记录 `cancelSHDBy / cancelSLDBy / cancelLimBy`（`setCancel(kind, on, posKey)`），**任一位置按下即生效**（`cancelSHD = any(...)`），
    某位置取消时若其它位置仍在越控则系统保持越控状态；
    **每个 Cancel 都会产生报警**：`SHUTDOWN CANCELLED, ACTIVE` / `SLOWDOWN CANCELLED, ACTIVE` / `LIMITS CANCEL FROM ACP, ACTIVE`
    （`setCancelAlarm(kind, on)`：进入报警栏，并在 Alarms → Sys. Non-Crit 里对应项变 `ACTIVE` + `AL. CLOSE`；
    取消越控时若已应答则清除、未应答转 `, NORMAL`；已存在则不重复报警）；
    Sys. Non-Crit 的 `SHUTDOWN CANCELLED` / `SLOWDOWN CANCELLED` / `LIMITS CANCEL FROM ACP` 三项**跟随模型状态**
    （`M.cancelSHD / M.cancelSLD / M.cancelLimits`），因此**两块面板都会显示 ACTIVE、Alarms 菜单灯两侧同时亮红**；
    只有 Cancel **按钮自身的指示灯**按本面板 `_cancel` 独立显示；
    Cancel SHD / Cancel SLD 点击时还会调 `_safCancelAll(page, on)` 把该页**所有带 Cancelled 灯的项目一次性越控**
    （Cancelled 灯全部变红，自动停车/减速功能取消），再点一次全部还原（灯回白）；
    **最低稳定转速（Minimum stable running speed）**：默认 `INACTIVE`，只有**车钟不在 STOP（`|rpmCmd| > 0.5`）且给定转速绝对值小于该值**时才 `ACTIVE`；
    **`Cancel Limits`**：Show Limiters 页除「Minimum stable running speed」「Critical speed」「Scavenge air pressure」「Torque」四项外，
    其余 STATUS 一律显示红色 `CANCELLED`；同时**扫气/转矩每一点燃油开度 +10 %**（50→60、80→90、100→110；转矩 50/90/110→60/100/120），
    **LEVEL 里的数字标红 `#ff4040`**（`_pgRichText()` 分段彩色文字，按最终字号 15.5 量宽、绘制 13.5），不激活时还原；
    **RESET SLD**：本仿真中**按下无任何动作**（`_openSub('reset-sld')` 直接 return，不复位、不跳页，保持与真机一致）；
    **RPM Detector**（`_paintRpmDetector()`）为面板式页面：两个 `Rpm Detector System 1/2` 框（各 Pickup1/2 转速值 + Ahead 绿亮 + Fail 白）、
    第 1 排 Revolution Counter（值 + `Reset`）/ Engine Rpm / Rpm Simulate（灯 + OFF/ON + 值），
    第 2 排 Running Hours（值 + `Reset`）/ Overspeed Level / Overspeed Test Level（灯 + OFF/ON + 值），
    **两排的灯、OFF 按钮、值框同列同基线对齐**（灯 cx=712、按钮 x=730 w=84、值框 x=826 w=168；标签行 y=284/362、控件行 y=310/388）；
    **白底 = 可编辑**（Overspeed Level / Rpm Simulate 值 / Overspeed Test Level 值），
    **灰底 = 只读**（`#bfc4c8`：Pickup1·2 / Engine Rpm / Revolution Counter / Running Hours）；
    **仅 ECR 可操作**（`variant === 'ecr'`）：双击白框走 DOM input（`_beginDetEdit(field,x,y,w,h)`），
    状态存在**模型** `model.overspeedTest`（`simOn/simRpm/osTestOn/osTestRpm/osLevel/msg/msgUntil`，两块面板共享；`_detState()` 即返回它），
    `Reset` 清 `model.rev` / `model.runHours`，OFF⇄ON 走 `model.toggleOverspeedTest('sim'|'os')`；
    **超速保护试验**：只有**停机状态**（`model.isStopped`：`!starting && |rpm| < 1`）才允许把两个 OFF 打到 ON，
    运行中点 ON 被拒（按钮灰显 + 红字「主机未停机，不能进行超速保护试验」）；
    两个开关都 ON 且 `simRpm > osTestRpm` → `_overspeedTrip()` 超速停车（锁存 `overspeedTripped`：
    `shutDown=true`、`cancelSHD=false`、`rpmCmd=0`、车钟回 STOP、`rpm/load=0`，
    报警栏两条 `OVERSPEED SYS.1 - SW BACKUP, SHUTDN` / `OVERSPEED SYS.2 - SW BACKUP, SHUTDN`（照真机），页面底部红字说明）；
    **超速停车后的联动（照真机 8 张截图）**：
    · `engineReady = false`（状态条第 4 段 Eng. Not Ready 红）、`startBlocked = true`（Engine State 的 Start Blocked 红）；
    · `stateText` = `Engine Tripped`，主页红色原因行显示 `Overspeed`；
    · **Shut Down 页只亮 4 项**：ENGINE TRIPPED（`ACTIVE`）+ OVERSPEED FROM RPM UNIT / OVERSPEED SYS.1 / SYS.2（`SHUTDN`），
      FUEL CUT-OUT SOL. V/V 只显示 `OPEN`（不亮红）、EICU A/B 组不亮（`eicuLive = live && !overspeedTripped`）；
    · Safety 表与 Alarms 列表的 Alarms 列统一显示 **`AL. CLOSE`**（不是 ALARM）；
    · Alarms 五类中**只有 Sys. Non-Crit. 被点亮**，其中 `START FAIL/BLOCK` 显示 `ACTIVE`；
      `ESU MAIN POWER FAILURE` / `SUDDEN STOP` / io-fail 里的 EICU 项**不因超速停车而亮**；
    · Engine State 页：STATE 的 Start Blocked、Engine Tripped 红；START FAIL/BLOCK 的 Engine tripped、Start Blocked 红；
      ENGINE NOT READY 的 Engine not ready ECS 红，其余白灯；
    · **报警栏始终显示最新两条报警信息**（不再随打开的菜单切换成菜单故障文字）；
    · RPM Detector 页：Pickup / Engine Rpm 显示**主机实际转速**（模拟值只用于超速试验），
      方向标签 `Ahead` / `Astern` 随转向（转速 ≤ 0 显示 Astern），检出转向才亮绿灯；
    越控 `Cancel SHD`（`cancelSafety/toggleSafety('SHD')`）或退出应急停车会清除 `overspeedTripped`，`reset()` 清空两个试验开关，
    主机起动时自动结束试验；
    **超速试验一次性武装 + 故障自动消失**：`_osTestArmed` —— 越限动作一次后置 false；
    **把模拟转速调回试验值以下（或关掉任一开关）＝ 超速故障消失**：自动清 `overspeedTripped`、解除 `shutDown`（非急停时）、
    调 `_shutAlarmReturn()`（已应答 → 报警直接清除、全部恢复；未应答 → 转 RTN，等 ACK），随后才重新武装，
    因此不会越控后被立刻重新跳闸；
    **三个 Cancel 的报警与超速同一套规则**（`_anyFaultActive()` 统一判定"故障是否仍在"）：
    按下 Cancel → 报警 `…, ACTIVE`（未应答红）；**先应答** → 变黄，再按一次取消（故障消失）→ **自动清除，无需第二次应答**；
    **先取消（故障消失）** → 报警转 `…, NORMAL`（红、列表项 RTN），**再应答**才清除；
    `ack()` 在仍有故障（`_anyFaultActive()`）时把已恢复（`, NORMAL`）的信息移除、保留仍在动作的条目，全部恢复时整体清除；
    **报警应答/恢复状态机**（`_alm(key, active)` + `_almState`，每 200 ms `_pollAlarms()` 轮询；三个 Cancel 的项也纳入轮询）：
    · `unack` 未应答（红字 + 红底 + `AL. CLOSE`）→ 按 **ACK** → `acked` **黄色文字**（深底、Active 灯仍红、`AL. CLOSE` 黄）；
    · 故障消失后：**已应答 → 自动恢复正常（不需要第二次应答）**；**未应答 → `rtn`**（红字、Value 显示 `NORMAL`、无 `AL. CLOSE`、Active 灯灭），按 ACK 才消失；
    · 模型侧 `_shutAlarmReturn()`（越控 SHD 时调用）：`engineReady=true`、`startBlocked=false`；未应答时把报警信息的 `SHUTDN` 改写为 `NORMAL`，已应答则清除报警；
    · `ack()` 在**故障仍在**时不清报警栏（只转黄），故障已恢复/已越控时才清；
    · Safety 表、Alarms 列表都按 `st` 着色；Safety 菜单只有 **Shut Down** 灯随 `_shdAlarmLive`（含 RTN）亮，其它子按钮保持不亮；
    · Safety「仅故障项」视图只看 `st !== 'none'`（不含无故障的已越控项）；
    · `stateText`：停车且未越控 → `Engine Tripped`；停机且备车完成 → `Ready for Start`；
    部件 id `det-reset-rev` `det-reset-hours` `det-sim-toggle` `det-os-toggle` `det-edit-simRpm` `det-edit-osLevel` `det-edit-osTestRpm`；
    **BRIDGE 面板该页只显示、不注册任何热区**（编辑框/Reset/OFF 全部无响应），底部提示「本面板（BRIDGE）该页仅作显示…」；
    Rpm Simulate 接通时 4 路 Pickup 与 Engine Rpm 显示模拟转速；编辑期间暂停 500 ms 页面自动重建（`_detEditing`）。
    B&W：Engine modes·**Running mode**·Slow turning·Cyl. lubrication；
    Param.：Start/Stop·Reversing·Crash astern·Governor (DGU PID)·**Safety**）。Home 固定在第 2 行第 7 列。
    **`Param. Change → Safety` 页**（`_subPage === 'psafety'`，`SAFETY_DELAY_ROWS`）：6 行安保延时设置，
    自动停车 SHD：`thrust pad 高高温` / `增压器滑油低低压` / `缸套水进口低压`；
    自动减速 SLD：`主滑油进口温度高` / `缸套水出口温度高` / `曲轴箱油雾浓度高`，**默认都是 6 s**。
    行部件 `sdel-<key>`（key = `shd-thrust` `shd-tclo` `shd-jcw` `sld-lo-t` `sld-cw-t` `sld-mist`），
    **双击该行 → DOM 输入框（id `ac600_delay_<key>`）→ 回车提交**（`_beginSafetyDelayEdit()`，
    编辑期间 `_limEditing` 暂停自动重建）；数值存 `M.delays`，读 `M.getSafetyDelay(key)`、写 `M.setSafetyDelay(key, s)`（0~120 s）。
    ⚠ **页面内新增的 `addClickablePart` 热区 id 必须 `push` 到 `this._menuHitIds`**，否则 `_clearMenuHits()`
    不会销毁它，每重建一次页面就多叠一层 `rgba(0,180,0,0.03)` 的绿底（6 行 × 多次进出后液晶区会整片发绿）。
    **实际生效的两项**：`sld-cw-t` 被 `CoolingWaterSolver` 用作缸套水高温 SLD 延时、
    `sld-lo-t` 被 `MainEngineLubeOilMimic` 用作滑油高温 SLD 延时（原来是写死 6 s 的常量）。
    ⚠ **Engine State 没有子菜单**：点一下直接在液晶区显示「STATE / START FAIL/BLOCK / ENGINE NOT READY」
    三个白边圆角框 + 指示灯列表（`_directPage = 'estate'`、`_paintEngineState()`），菜单区保持主菜单；
    **指示灯随主机实际状态动态刷新**（tick 的 500 ms 节流条件包含 `_directPage`，每帧按模型重算亮/灭），
    **四色规则**：白=未激活、橙=准备/进行中（Ready for Start·Starting·Stopping）、绿=运行（Runing）、红=故障；
    停机时序：拉回 STOP 且转速 > SLOW(50) → Runing 绿 + Stopping 橙；降到 50 以下 Runing 灭；
    降到 DEAD SLOW(25) 以下 Stopping 灭、Ready for Start 亮。推手柄离开 STOP 自动起动（`_autoStart()`，
    起动空气转车约 10 s：Starting 橙 → 完成后 Runing 绿）；
    再点一次 Engine State 或点 Home 关闭。Limiters 的二级按钮为 `Set Limiters` / `Show Limiters`。
  - **Running mode 页**（`_paintRunningMode()`）：两个并排切换按钮（Economy mode / Emission mode），
    选中项绿底白字亮边、未选中浅灰底深色字，点击即切换 `sys.ac600.runMode`；
    **主页状态条第 2 段随动**：经济模式绿底「Economy Mode」/ 排放模式**红底**「Emission Mode」。
  - **按钮排**：7 × 2 全网格绘制（`_renderBand()`），**空位也画空白矩形占位**；按钮高 38、行距 44（`L.btns`）。
  - **液晶区页面**（`_renderMenu()`，绘制在 `_menuGroup`）：Alarms 五类为真机三列表格
    （白表头 Description / Value / Alarms + 深灰行 + 绿色正常值 / 红色报警行 + 右侧滚动条，表头紧贴状态条、无标题行；
    列表超长时点滚动条上/下三角翻页，状态存 `_listOffset`、切子页回顶部），
    数据由 `_alarmItems(kind)` 生成（项目名照真机：ACP600 ECR、ESU MAIN POWER FAILURE、AUX BLOWER FAILURE、DPU 1920~1931 系列、TELEGRAPH SYS FAILURE、
    EMERGENCY STOP SWITCH <位置>、RPM PICKUP 1.1/1.2、COMM ERR BETW. ACP-ECR&… 等）；
    **除 Alarm History 外的五类为两态**：首次显示全部参数 → 再点只显示未复位（报警）项 → 再点回全部（`_alarmViewMode`）；
    Alarm History 改为**跟踪「本次出现过的报警项」**（表头 Nack / Date/Time / Description / Event / Value，
    数据存在面板 `_histRows`，由 `_pollAlarms()` 按 `M.messages` 增删同步）：
    · 每条记录 `{ desc, value, state, t0 }`；新出现的报警按当前时间登记（`YYYY.MM.DD HH:MM:SS`）；
    · **颜色**：未应答 → 红 `#ff3b30`；已应答但故障仍在 → 黄 `#ffd400`；故障已恢复 → **绿 `#00c000`**，
      且 Value 改写为 `NORMAL`（自动减速的 `SLOWDOWN ACTIVE` 在车钟拉到 40 rpm 以下复位后才转 NORMAL）；
    · **Nack 列圆点**：未应答红点、已应答白点；Event 列留空（与真机一致）；
    · 已恢复的行**保留在列表**（绿色记忆），不清除。
  - **流程指示灯**：7×2 网格固定灯位，**常态一律不显示**，只有该按钮对应存在故障项时亮红灯
    （主菜单按类别：alarms/limiters/misc/safety/estate；Alarms 二级按该子页 `_alarmItems().some(it => it.alarm)`）。
  - 页面软键热区由 `_clearMenuHits()`、按钮热区由 `_clearBandHits()` 在重建前销毁，避免残留与重复点击。
- **`Ac600ConsolePanel`**（1600 × 800，`variant: 'bridge' | 'ecr'`）：左侧 AC 600 操作站（状态条 /
  状态条第 4 段随 `engineReady` 在「Eng. Ready（绿）/ Eng. Not Ready（红）」间切换 /
  M/E RPM 大表 -120…120（表下三行：转速、运行状态、红色原因行 Emergency Stop·Slow Down）/
  起动空气表 0…40 bar（0~10 红区）/ M/E 负荷表 / SETP·LEVER 立式柱（SETP 下显示给定 `rpmCmd`、LEVER 下显示实际 `rpm`）/
  7 列按钮排 Alarms·Limiters·Control Pos.·Misc Menu / Safety System·Engine State·B&W Modes·Param. Change·Home /
  Cancel SHD·SLD·Limits（切换型：按一次越控、再按一次复位，指示灯在按钮左上 45°；本面板所有按钮**不弹浮动提示**）/
  底部三件：消音按钮（白圆环 + 空心喇叭 + 斜杠）／**方形位置标注牌**（`variant` 决定固定标注，
  驾控台 = BRIDGE、集控室 = ECR，报警未确认时外框闪红）／ACK 圆环；三件整体与液晶面板水平居中），
  **ME Run Hour 下方为报警信息栏**（正常时空白无任何显示；有故障时整条变红底、
  最多显示最新两条报警信息如 `ENGINE TRIPPED, ACTIVE` / `START FAIL/BLOCK, ACTIVE`，数据来自
  `sys.ac600.messages`，未确认时闪烁）；**每个菜单按钮左侧有流程指示灯位**（正常不显示，有故障亮红并随未确认闪烁，
  故障与菜单的对应关系见 `_menuFaults`：Alarms←报警、Limiters←负荷限制、Misc Menu←慢降、Safety System←停车/应急停车、
  Engine State←起动阻塞/失败/备车未完成），**点击菜单进入后报警栏改为显示该菜单的具体故障项目**（再点一次返回），
  右侧车钟单元（11 档抽屉式刻度板：NAVIGATION FULL / FULL / HALF / SLOW / DEAD SLOW / STOP / DEAD SLOW /
  SLOW / HALF / FULL / EM'CY ASTERN，规格见 `TELEGRAPH`：68 / 57 / 41 / 27 / 21 / 0 / −21 / −27 / −41 / −51 / −55 rpm；
  **整块车钟面板是一个拖动层 `_telTouch`**（滑条 `_telSlider` 只做视觉、listening=false）：在面板任意位置按下即
  「点哪儿跳哪儿」，上下拖动给连续转速给定（`setLeverContinuous()`，取指针 y 映射 68…−55 rpm），
  松手吸附到最近整档，当前档文字绿色；交互用 **stage 级指针事件**（`mousedown/mousemove/mouseup` + 绝对值反算局部 y），
  不依赖 Konva 的 draggable/hit；拖动期间 `group.draggable(false)`，不会拖动整块面板；
  **三处车钟互相独立**（`leverRpm = { BRIDGE, ECR, LOCAL }`）：**任何面板的车钟都能正常拖动**（手柄自由移动，不受操纵权限制），
  但**只有控制位置的车钟会写入主机给定 `rpmCmd`（LEVER）**，其它位置拖动只动手柄、LEVER 不变；
  **RPM CMD 大字 = 本面板车钟的实际车令**（`M.leverRpm[posKey]`，无控制权时只在不影响主机）；
  `RPM CMD` 上下箭头同样只改本面板车钟（`M.setLeverAt(cur±2, posKey)`）；
  **LEVER 柱与数值显示 `rpmCmd`**（= 拥有控制权面板的车令，不是本面板手柄位置）；`setControlPos()` 切换时把当前 `rpmCmd` 写入新位置手柄（**LEVER 不跳变**），
  之后只有新位置的车钟能改变 LEVER；
  **应急停车（Crash astern）自动越控**：车钟**从 NAV FULL（68）直接拉到「倒车全速及以下」**
  （`CRASH_ASTERN_TO = −50.5`，即 FULL ASTERN −51 或 EM'CY ASTERN −55）→ 触发 `model.crashAstern()`，
  （模型 `_checkCrashAstern()` 与面板拖动手势用同一阈值；控制权面板的 Cancel Limits 指示灯会自动点亮，
  非控制面板不亮 —— `tick()` 中把模型侧自动生效的 `cancelLimits/cancelSHD` 同步到控制权面板的 `_cancel`）
  **`cancelLimits` 自动置真**（面板左侧 Cancel Limits 指示灯自动点亮、限制全部取消，主机按惯性最快速率响应）；
  **只有拥有控制权的面板**车钟这样拉才会触发（无控制权拖只会动手柄、`rpmCmd`/`cancelLimits` 都不变）；
  判定两路并用：① 面板拖动手势（`down` 记 `_telDragFrom`，`up` 吸附后要求 `controlPos === posKey && from ≥ 67.5 && to ≤ −54.5`）；
  ② 模型 `_checkCrashAstern(val)`（只在 `w === controlPos` 时调用；最近 3 s 内停在 NAV FULL 后直接落到 EM'CY ASTERN）；
  `reset()` 清 `crashAsternOn` / `_navFullAt`；
  位置 ↔ 转速按档位实际值分段线性插值（`posToRpm()` / `rpmToPos()`），**松手时只有与最近档位相差 ≤1 rpm 才吸附**，
  否则保持连续值；**只有正好落在整档上该档文字才绿色高亮**（连续值时不突出）；
  调试钩子 `window.__telDebug` 记录最近一次 down/up；
  RPM CMD 数字 + 上/下箭头、Bridge·ECR·Local、At Sea·Standby·FWE、左下蜂鸣器、
  右下 EM.STOP 应急停车按钮）——　EM.STOP 为**自锁型**：外侧有**玻璃盖**（`em-stop-cover`，
  按一次上翻露出按钮、再按一次翻下遮住），开盖后按 `em-stop` 触发应急停车并保持，再按一次弹出取消指令；
  圆形指示灯为「圆环 + 上半圆绿色填充」表示选中，文字颜色固定（Bridge/At Sea 白、ECR/Standby 黄、Local/FWE 橙红）。
  部件 id：`cancel-shd` `cancel-sld` `cancel-limits`、`btn-alarms` `btn-limiters` `btn-cpos` `btn-misc`
  `btn-safety` `btn-estate` `btn-bwm` `btn-param` `btn-home`、`ack` `silence` `alarm-bell`、
  `pos-bridge` `pos-ecr` `pos-local`、`mode-sea` `mode-standby` `mode-fwe`、`lever-up` `lever-down`
  `em-stop-cover`（玻璃盖）`em-stop`（应急停车，自锁）、`tel-0` … `tel-10`。
- **机旁面板交互规范（照真机截图）**：
  · **按钮样式**：黑色操纵板（宽 **390**）上的圆钮（左列 9 个 + 车钟 11 档）统一为**单圈亮白描边**（`#f2f4f5`、`strokeWidth 3`），
    **不再画内圈白线**；左列按钮由模块常量 `LEFT_BTNS` 定义，**三组内按钮间距 10 px**（圆钮直径 **66**、中心距 76，
    静态绘制 / 动态指示灯 / 热区三处共用该常量）；第 3 组为 **备用（`spare-1`，位于组内最上方、**无文字**、无动作）** / Wrong Way / Lamp Test；
  · **两列位置**：左列中心 `COL_LEFT = 112`、右列（车钟）中心 `COL_TEL = 290`（车钟列连同外框整体左移 30，板宽相应 420→390）；
  · **板高与车钟高度**：黑色操纵板 `BOARD_H = 804`；车钟 11 档 `TEL_Y0 = 60 / TEL_STEP = 70`，跨 31…789，**11 档上下对称**；
  · **四组白色外框**（`stroke #ffffff 2px`、圆角 22）：左列三组各 236 高、**组 1 距上边缘 15 px（y=23）、组 2 居中（y=292）、
    组 3 距下边缘 15 px（y=561）**；车钟组 y=23 h=774（上下各留 15 px，四组同跨距 23…797）；
  · **文字**：左列字号 16（长标签 14.5）+ 加粗；车钟档位文字 `verticalAlign: 'middle'`（高 36）居中、字号 **15** + 加粗；
  · **指示灯位置**：左列与车钟的指示灯**一律在外圆左上角**，且**圆钮描边正好穿过指示灯圆心**
    （左列半径 **33** → 偏移 −23, −23；车钟半径 29 → 偏移 −21, −21），半径 **7**；
  · **指示灯配色**：**不亮 = 暗白 `#c8cccc`**（`C_LAMP_OFF`）；点亮时为**亮色**（`C_LAMP_G #46ff7d` / `C_LAMP_A #fff23c` /
    `C_LAMP_R #ff4d4d` / `C_LAMP_W #ffffff`）：**Stand By / ECR / 车钟 Stop = 亮黄**，
    **FWE / Local / Wrong Way / 车钟倒车档（index 6~10）= 亮红**，**Lamp Test = 亮白**，
    其余（At Sea / Bridge / 备用 / 车钟正车档 index 0~4）= **亮绿**；
  · **不弹浮动提示**：`Ac600LocalPanel._tip()` 为空实现（与驾控台/集控台面板一致），操作只靠指示灯与面板状态反馈；
  · **两套灯测试互相独立（不共用模型 `M.lampTest`）**：
    · 左列 **Lamp Test** 圆钮（`lamp-test`）→ `this._ltBoard`，**只点亮黑色操纵板上的 20 个灯**（左列 9 个圆钮 + 车钟 11 档），
      点亮时各灯显示**各自的亮色**（黄/绿/红/白），右侧矩阵不受影响；
    · 中部 **试灯** 按钮（`test-lamp`，热区 446,400,96,74）→ `this._ltPanel`，**只点亮右侧状态矩阵**：
      20 个格子（含 `mx-force` / `mx-sld-cancel` / `mx-sd-cancel` / `mx-lim-up` 这 4 个**带灯操作按钮**）全部点亮；
      原按钮内的小试灯指示灯 `_testLamp` 已删除（试灯效果由矩阵整片点亮体现）；
    · 两者均为**自复位式**（`_bindMomentaryLamp(partId, prop)`）：**mousedown 按下保持灯亮、mouseup 松手即灭**，
      指针移出按钮再松开也能灭（舞台级 `mouseup` 兜底）；**真实点击不再延时**，
      仅程序化 `fire('click')`（无 `e.evt`）亮 1.5 s 供自动演示使用；
  · **EM STOP 外观**：**白色金属外框（护圈 r=32，含内凹阴影圈 r=28/25）+ 红色按钮帽**（动态 `_emCap`：落影圆 + 帽体，
    **无任何指示灯 / 高光装饰**）；**弹出常态**：帽体 **r=28（大于护圈开口 25，凸起）**、上浮 2 px、亮红 `#d0232c`、
    底部露出落影（`_emCapShadow` 可见）；**按下**：帽体 **r=27（略小于弹出 28，凹进护圈）**、下沉 4 px、暗红 `#8e1119`、落影隐藏。
  · **EM STOP 外盖（翻开就立在按钮旁边，可反复开合）**：`em-stop-cover` 点击开/合 ——
    **合上**：盖板 (472,480) 74×74 盖住按钮帽 —— **不透明金属盖板**（实心浅灰 `#c6ccd0` + 深描边 `#3f464a` 3 px
    + 内嵌框 `#b6bdc2` + **四角螺钉** + 底部提手 + 加粗「外盖」文字 y=24），遮盖感明显；此时 `em-stop` 无效（提示先开盖）；
    **打开**：盖板**立在按钮左边缘旁**（侧视窄条 472…485，`scaleX = 0.18`），「外盖」文字隐藏，
    **热区缩成同宽窄条 (472,480,18×74)**（不挡按钮其余部分，EM STOP 可正常按下）；
    **再点一次就盖回来**（盖板始终可见，不再隐藏）；
    ⚠ 热区移动必须移动 `emCoverHit.getParent()`（`addClickablePart` 返回的是组内 Rect，直接改它的 xy 会把命中区推到远处）；
    **`em-stop` 为自锁型 —— 机旁紧急停车，与"停车激活"无关**：
    盖打开后**按一次** → `M.pressEmStop(<位置>)` → `M.localEmergencyStop()`：置 `emStopped`、记录 `emStopBy`（LOCAL/ECR/BRIDGE）、
    `engineReady = false`、`startBlocked = true`（燃油切断、转速快速降到 0、禁止起动/自动起动），
    报警信息两条 `EMERGENCY STOP SWITCH <位置>, ACTIVE` / `START FAIL/BLOCK, ACTIVE`；
    **但不置 `shutDown`**，因此矩阵「停车激活」(`sdAct`) 不亮、安保 Shut Down 页的越控逻辑不受影响；
    **各页故障表现**（与真机一致）：**Sys. Critical 不动作**（`ESU MAIN POWER FAILURE` 恒 NORMAL）；Sys. Non-Crit → `START FAIL/BLOCK`；
    **I/O Fail → `EMERGENCY STOP SWITCH <按下位置>`**；Shut Down 页 → `ENGINE TRIPPED`(ACTIVE) + `EICU A/B SHUTDOWN
    NON-CANCELLABLE`(值 NORMAL，**CANCELLABLE 两行不亮**，紧急停车属不可越控停车)；Emg. Stop 页 → `FUEL CUT-OUT SOL. V/V`=OPEN +
    `EMERGENCY STOP SWITCH <位置>`=PRESSED；Engine State → `Engine Tripped` / `Start Blocked` / `Engine not ready ECS` 红、`Ready for Start` 白；
    **应答（ACK）后上述项全部转黄**（已应答语义）：`Emg. Stop` 页的 `em:*` 条目也接入了报警状态机
    （`_emItems` 每项带 `st = _alm('em:<key>', active)`，`_pollAlarms()` 一并轮询 `em:fuel` 与三个开关），
    点一次 ACK → `_ackAlarms()` 把**所有仍在动作**的项目标记已确认（黄色）；
    `_alm()` 在故障"新出现"时按 `M.acked` 决定初值——一次确认后同批新出现的项目直接为已确认（不会残留未确认红）；
    **且完全不动车钟 / 给定**（`rpmCmd`、`leverRpm`、`leverIdx` 均不改），所以对机旁手动调速旋钮毫无影响；
    **蜂鸣器 / 报警铃不响**：`emStopped || emStopLatched` 期间，驾控台与集控台的 `_buzzGlow`、`_bellRing` 一律置 0
    （报警仍在：报警栏与各故障页照常显示，`buzzerOn` 的车钟不一致鸣响也一并抑制），复位后恢复正常；
    **辅助鼓风机随负荷起停**：`auxBlower = load > 25 %` —— 紧急停车后负荷归零，**鼓风机随之停机**（矩阵「辅助鼓风机运行」灯灭）；
    **矩阵伴随指示**：按下紧急停车 → **「停车激活」/「主机备车未完成」/「起动阻塞」三个格子常亮红灯（不闪烁）**，
    其中 `sdAct = (shutDown && !cancelSHD) || emStopped`；这三格 `alarm = false`（状态灯语义，不参与未确认闪烁）；
    **再按一次（弹出）** → 清 `emStopLatched`：**只有 I/O Fail 的 `EMERGENCY STOP SWITCH <位置>` 自动复位**
    （该项按 `emStopLatched` 判定），**其余故障全部保持**（`emStopped` 未清）；报警与停车保持，不会自动消除 ——
    **按 ACK 确认也不清除**（`_anyFaultActive()` 已含 `emStopped / emStopLatched`，确认只转黄停声）；
    必须由**拥有控制权的面板**把**本面板车钟拉回 STOP**（`|leverRpm[controlPos]| < 0.5`）
    **或机旁调速手柄拉回 STOP**（`|leverRpm.LOCAL| < 0.5`，任一满足即可，solve() 内判定）：
    清 `emStopped` / `emStopBy` / `alarm` / 报警信息，并恢复 `engineReady = true`、`startBlocked = false`
    （若同时没有安保停车/超速），Engine State 变为 **Ready for Start**；主机可重新起动；
    该规则对机旁 / ECR / 驾驶台三块面板一体适用（都走 `M.pressEmStop(<位置>)`）；
    **三处急停的反应完全一致**（仅 `emStopBy` 决定的项目不同）：置位/报警信息/各页故障/矩阵三灯/鼓风机停机全都相同，
    只有 **I/O Fail 的 `EMERGENCY STOP SWITCH <位置>`、Emg. Stop 页对应开关行、报警栏文字** 随按下面板变化
    （`M.emStopBy = 'BRIDGE' | 'ECR' | 'LOCAL'`）；
    组件外盖状态先同步到 `M.emStopCoverOpen` 再调模型的自锁方法；
  · **冲车 / 自动 / 慢转起动 为三档转换开关** `start-knob`（BLOW −60° / AUTO 0° / SLOW +60°），
    点右半区顺时针、左半区逆时针、端点不循环；AUTO → `startEngine(false)`，SLOW → `startEngine(true)`，BLOW → 冲车提示；
  · **右区重绘（照真机照片）**：① 三只仪表 = **黑色矩形边框 + 白色表面 + 弧形刻度 + 单位（bar/rpm）+ 白色数字框（水平居中、比原来下移 15 px）
    （`⊙-1.5|☆` 小标）+ 右上 `▽R` 标记 + 右下黑色旋塞**，几何 `GAUGE_Y = -5 / GAUGE_W = 176 / GAUGE_H = 165`（面板 −27…174），
    表心 `(x + W/2, GAUGE_Y + H − 34)`、指针长 46；② 控制箱的**电源开关** = 黑底方板（ON 绿 / OFF 深红）+ 中央大圆旋钮
    （白色斜指示条指向 ON）；③ **电流表** = 黑边框白面 A 表（0…150，末端红色高量程弧、指针、白色数字框 0、`▽R`、右下黑旋塞）；
    ④ 矩阵第 3 行后两位改为**两个转换开关**（原为指示灯）：第 3 列 = **本地/遥控选择开关**（`tg-sel`，指左=本地/指右=遥控），
    第 4 列 = **加热器通断开关**（`tg-heat`，指右=通/指左=断）；「遥控 / 本地控制」与「空间加热」灯跟随这两个开关；
    ⑤ **盘车机控制箱电源开关旋钮**（`tg-power-knob`）可点：ON ⇄ OFF（指针 0°/90°），**只切换 `M.turningGearPower`，
    不改变盘车机脱开/合上**；遥控盒「电源」为**常亮指示**（`tg-power` 无动作），原来的小绿灯已删除；
    矩阵「电源」灯**恒亮**；「备用 / 本地 / 遥控」三个多余灯已删除（9 个灯 + 2 个开关）。
    **盘车机默认脱开**（`turningGearOut = true`，ctor 与 `reset()` 都置 true）；**机旁控制箱的任何操作都不改变它** ——
    矩阵「盘车机脱开」为**纯指示灯**（`mkCell('mx-turn-out', null)`），合上/脱开只在**气动操纵系统**页
    的 `turning-gear` 部件上操作（`M.toggleTurningGear()`）。
  · **状态矩阵版式**：4 列 × 5 行按钮 `MX_W = 74 / MX_H = 70`（起点 `MX_X0 = 472 / MX_Y0 = 12`，
    矩阵占 469…789 × 9…389），按钮之间为 **6 px 黑色分隔**（`MX_GAP`，底板亦为黑色），
    格子描边 **1.5 px 黑色**（`MX_LINE`）；文字居中（`verticalAlign: 'middle'`、字号 **14**、行距 1.12）；
  · **每格亮/暗配色**（`mx(id, text, color, key, alarm)`）：`color` = 点亮色、`dim` = 不亮色（按色系自动取暗色）、
    `alarm` 决定未确认时是否闪烁。**本地控制 = 亮红 `#ff4d4d` / 暗红 `#761d1d`**、
    **集控室控制 = 亮黄 `#fff23c` / 暗黄 `#6a5f00`**、**负荷限制激活·负荷限制增高 = 亮白 `#ffffff` / 暗白 `#c8cccc`**，
    其余沿用绿（`#00d24a` / `#134a1f`）与红（`#ea1212` / `#4e1111`）；
    浅底亮灯时文字用深色 `#101010`（`DARK_TEXT`）；**暗白底不亮时文字用深色 `#2f3538`**（`DIM_DARK_TEXT`，否则灰字看不清）；
  · **中部控制区（矩阵下方，尺寸/对齐规则）**：试灯 **74×74 方形**(472,400) 与 EM STOP **74×74 方形**(472,480)
    **左边缘与矩阵按钮左边缘对齐（x = 472 = `MX_X0`）**；冲车-自动-慢转起动面板 **176×154**(610,400)
    **右边缘与矩阵按钮右边缘对齐（右 = 786）**、**下边缘与 EM STOP 下边缘对齐（y = 554）**，
    旋钮圆心 (698,488)、热区 (633,423,130,130)；
    车钟大表盘圆心 (725,**690**)、热区 (620,585,210,210)；
  · **手动降速请求（机旁）**：`mx-sld-req` → `M.setManualSlowDown(on)` —— **与自动减速完全同一套动作**
    （`safetyAction('SLD','MANUAL-SLD')`：置 `slowDown`、减速到 40 rpm、报警栏 `MANUAL SLOW DOWN, SLOWDN` + `SLOWDOWN ACTIVE, ACTIVE`；
    撤销走 `safetyClear`，减速动作锁存到车钟拉到 40 rpm 以下）；
    `mx-sld-cancel` 按下（on）时同时 `setManualSlowDown(false)` + `_sldActHeld = false`
    → **手动降速请求灯熄灭、降速取消灯亮**，再按一次降速取消灯熄灭；
    **降速激活不会自动触发**：`sldAct = slowDown && !cancelSLD && _sldActHeld`，取消后必须**再次按「手动降速请求」**才重新点亮；
    四个降速格（请求 / 激活 / 取消 / 复位）都是 `alarm = false` —— **常亮、不闪烁**；
    `mx-sld-reset` 解除减速锁存（清 `slowDown` / `sldAwaitReset`）。
  · **矩阵中 5 个带灯按钮**：`mx-local`（= 机旁 Local，走转移确认）、`mx-force`（`forceTakeControl()` **直接夺权**，不走常规转移）、
    `mx-sld-cancel`（= Cancel SLD）、`mx-sd-cancel`（= Cancel SHD）、`mx-lim-up`（= Cancel Limits）——
    后三者调 `M.setCancel(kind, on, 'LOCAL')` + `M.setCancelAlarm()`，灯亮 = 该越控生效；
    **`mx-lim-act`（负荷限制激活）是纯指示灯**：`mkCell('mx-lim-act', null)`，只反映 `S.limAct = loadLimit && !cancelLimits`，
    **按下无效**（原 `M.toggleLoadLimit()` 已移除）；
  · **机旁车钟与机旁调速手柄互相独立**：
    · 车钟 `tel-0…tel-10` → `leverRpm.LOCAL`（`setLeverById(id,'LOCAL',true)`，只动手指令、不改 `rpmCmd`）；
      **只有控制权在机旁（`controlPos === 'LOCAL'`）时按钮才有效**，其它控制位置按下无反应；
    · 调速手柄（大表盘 `local-dial`）→ 模型独立字段 **`M.localSpeed`**（`M.setLocalSpeed(rpm)`），
      **不动车钟 `leverRpm.LOCAL`**；控制权在机旁时才改写 `rpmCmd`，否则只移动手柄本身（不影响主机）；
      指针始终显示 `M.localSpeed`；**控制权转移时机旁调速手柄不自动跟随**（`setControlPos()` 不再改写 `localSpeed`，
      `_syncCmdFromLever()` 在 LOCAL 下保持 `rpmCmd` 不变）——必须人工拖动手柄后才改写给定；
      紧急停车复位判定也用 `|localSpeed| < 0.5`（机旁调速手柄回 STOP）。
  · **机旁车钟档位灯规则**：① 机旁车令所在档 —— **常亮**；② 与**驾驶台**车令一致时，只有该档常亮；
    ③ 不一致时，**驾驶台对应的档位灯闪烁**（`M.blink` 交替，机旁档仍常亮）；试灯时 11 档全亮；
    **驾驶台车钟上**：机旁车令与驾驶台车令差 >1 rpm 时，对应机旁请求档位的文字**闪烁**（本机旁档位灯保持常亮）；
    ⚠ 只在机旁手柄**确实给出车令**（`|leverRpm.LOCAL| > 0.5`，不在 STOP）时才闪烁 ——
    机旁手柄停在 STOP 属于常态（系统起动默认驾驶台 NAV FULL、集控室/机旁 STOP），
    若不加这个条件，驾驶台一上电 STOP 档就会一直闪。
    ⚠ **还要「机旁确实参与操纵」才闪**（`Ac600ConsolePanel.tick()` 的 `locRelevant`）：
    控制权在机旁（`controlPos === 'LOCAL'`）或正在与机旁做控制权转移（`transferReq` 涉及 LOCAL）。
    控制权在驾驶台时，机旁手柄只是"预置"——**起动系统后三处车钟都在 NAV FULL**，
    若仍按"不一致就闪"，驾驶台一动档 NAV FULL 就一直闪，与"本档高亮"混淆（实测误判）。
  · **调速旋钮大表盘 `local-dial`**：圆心 **(629, 690)**（与矩阵 16 个按钮的中间对齐）、半径 `DIAL_R = 96`；
    **刻度跨 −135°…+135°**（`DIAL_MAX`，正上 STOP / 右 AHEAD 0…10 → 0…68 rpm / 左 ASTERN 0…10 → 0…−55 rpm），
    刻度线 84…94、**数字环半径 72、字号 13**；`STOP` 文字在正上方（比中心上移 5 px），`AHEAD` 在弧的**最右端**、`ASTERN` 在**最左端**；
    **旋钮 r=30/26 在圆心**（可按住拖动），指针（指示条）长 52、端部小圆头 r=7（外沿 59，**不遮刻度数字**）；
    **操作方式：只能按住手柄拖动给出车令** —— `mousedown` 落点距圆心 **≤ 64** 才起拖（覆盖旋钮 + 指示条 + 端头整个手柄，
    端头外沿 59；点刻度盘其它位置无效、单击也不改变转速），起拖后由舞台 `mousemove/touchmove` 连续跟随、`mouseup` 结束；
    ⚠ 真实鼠标事件由 Konva 挂在**画布元素**上（不是容器 div），测试需向 `stage.container().querySelector('canvas')` 派发 MouseEvent；
    拖动期间**临时关闭整块面板的 `draggable`**（松手恢复），避免拖旋钮变成拖面板；点击也直接跳到该角度；
    **手柄任何时候都可拖**（与是否拥有控制权无关）：`setLeverAt(rpm, 'LOCAL')` 只在控制权在机旁时才同步改写主机给定，
    控制权在别处时**只移动本机旁手柄、不影响主机**（等价于"对车令/预置"）；
    **指针始终显示本机旁手柄的实际位置**（`leverRpm.LOCAL`），控制权转移时 `setControlPos()` 会把当前给定写入手柄，指针随之无扰对齐。
- **气动页的机旁操纵复刻件（页 4，`Ac600PneumaticSystem._drawLocalControls()`）**：在「主机转速」框下方
  两件器具**按机旁面板原尺寸的 2/3 缩放**（`LCP_K = 2/3`，绘制时装在带 scale 的组里，
  部件坐标/热区/拖动半径都乘 `LCP_K`），**并列摆在「主机转速」框正下方**：
  `LCP = { boxX: 1205, boxY: 700, boxW: 117.3, boxH: 102.7, knobX: 1263.7, knobY: 758.7,
  dialX: 1450, dialY: 750, dialMax: 135 }`（整体已右移 30），**原样复制机旁面板的两件操车器具**：
  ①「冲车 / 自动 / 慢转起动」三档转换开关（部件 `start-knob`，与机旁面板同一套点击逻辑与提示；
     **旋钮任何控制位置都能转，只是控制权不在机旁时不输出** —— `setStartKnob()` 已不再返回 `'blocked'`，
     是否驱动电磁阀/起动空气由 `solve()` 里的 `controlPos === LOCAL` 决定）；
  ②「主机机旁调速手柄」大表盘（部件 `local-dial`，−135°…+135°、STOP 正上 / AHEAD 最右 / ASTERN 最左，
  按住手柄拖动 → `M.setLocalSpeed()`）。两者**完全靠模型状态同步**（`startKnob` / `localSpeed`），
  一端操作另一端立即跟随（实测：机旁面板打 SLOW → 气动页手柄同步；气动页拖手柄 → 机旁指针同步）。
  ⚠ 摆放位置避开慢转控制阀（`V5B` y 612~656）、底部控制空气总管（`BOT_Y = 840`）及其右端立管（x≈1136），
  否则会盖住气路。

- **机旁起动旋钮（冲车 / 自动 / 慢转）** —— 机旁面板 `start-knob` 三档（左 BLOW / 中 AUTO / 右 SLOW，-60°/0°/+60°）：
  · **只有控制权在机旁（`controlPos === 'LOCAL'`）时才有效**：其它位置点击不改变旋钮、只提示「控制权不在机旁：操作无效」
    （模型侧 `setStartKnob(pos, 'LOCAL')` 返回 `'blocked'`）；控制权被拿走时冲车 / 慢转立即中止（电磁阀失电、转速回落）。
  · **冲车 BLOW**：**起动电磁阀 A（气动页 `abc0`）得电**（`setThreeWay('abc0', true)`，线圈红），
    主机由起动空气**逐渐加速到 20 rpm 并保持**（`BLOW_RPM` / `BLOW_RATE = 2 rpm/s`），`stateText = 'Blowing'`。
  · **慢转 SLOW**：**慢转电磁阀 C（`abc2`）得电**，主机以**很低转速正转 5 rpm**（`SLOWTURN_RPM`，同样 2 rpm/s 升速），
    `stateText = 'Slow Turning'`。
  · **自动 AUTO**：两个电磁阀都失电、空气带转停止，转速按惯性回落到车令给定（`stateText` 回到 `Ready for Start` 等）。
  · 空气带转**不算主机运行**：`_airTurn` 期间 `running = false`、`load = 0`、运行小时与转数不计；
    只有 `!shutDown && !emStopped` 时才允许（安保停车后冲车 / 慢转无效）。
  · 气动页的同步在 `Ac600PneumaticSystem.tick()` 里：`setThreeWay('abc0', 机旁 && BLOW)`、
    `setThreeWay('abc2', 机旁 && SLOW)`（`setThreeWay()` 为程序化设定阀位的公开方法，`toggleThreeWay()` 已改为调用它）。

- **盘车机（Turning Gear）运行规则**（`AC600Solver` + `Ac600LocalPanel` 控制箱/遥控盒）：
  · **机旁车钟档位按钮任何时候都能按**（`tel-0…tel-10`）：按下只把**机旁车令**对到该档
    （提示「机旁车令预置：xxx」），控制权在机旁时才改写主机给定；因此**没有控制权时也能把手柄对到
    与驾驶台一致，驾驶台那边的档位闪烁随之消失**（闪烁表示两边车令不一致）。
  · **控制方式互锁**：`M.turningGearMode` = `'LOCAL'`（机旁控制箱末排 `tg-jog-fwd` / `tg-jog-rev`）
    / `'REMOTE'`（遥控盒 `tg-fwd` / `tg-rev`），由控制箱的本地/遥控选择开关 `tg-sel` 切换（`toggleTurningGearMode()`）。
    **当前方式之外的按钮按下无效**（`setTurningGearJog(dir, by)` 里按 `by` 拦截，面板同时弹提示）；
    **停止命令（dir = 0）任何来源都有效**。
  · **指示灯与控制方式无关**：`正转`/`倒转` 灯只看 `M.turningGearJog`，`电源`/`空间加热`/`过载` 同理；
    只有 `遥控`/`本地控制` 两灯反映当前控制方式。
  · **电机电流**（控制箱电流表 0~150 A）：`M.turningGearCurrent`（由 `tgCurrent` 平滑，τ=0.25 s）——
    **不转 = 0 A**；**脱开空转 ≈ 6 A**（`TG_FREE_CURRENT`）；**合上带主机 ≈ 92 A**（`TG_LOAD_CURRENT`）。
    面板 `_gauges.amp` 指针（`_mkNeedle`）与数字框每帧刷新。
  · **脱开（`turningGearOut = true`）点动**：电机转但**主机不转**（`rpm` 保持 0）；
    **合上（`turningGearOut = false`）点动**：带动主机**很低速正/反转** —— `rpm → ±4`（`TG_JOG_RPM`），
    正转 `+4`、倒转 `−4`。
  · 盘车带转**不算主机运行**：`_tgDriven` 期间 `running = false`、`load = 0`、运行小时与转数不计；
    `stateText` 不会显示 `Running`（rpm 4 < 5），主机窗仍为 `Ready for Start`。
  · 盘车机未通电（`turningGearPower = false`）时点动一律无效、电流归零。

- **`Ac600LocalPanel`**（1600 × 800）：左黑色机旁操纵板（At Sea / Stand By / FWE、Bridge / ECR / Local、
  Wrong Way / Lamp Test 圆钮 + 右列车钟档位 11 档）；中状态矩阵 4 列 × 5 行（本地·集控室·驾驶台控制、
  控制权强制获取、手动降速请求/降速激活/降速取消/降速复位、停车激活/停车取消/辅助鼓风机运行/报警、
  盘车机脱开/空气分配器/主起动阀在工作位/备车未完成、负荷限制激活/增高/起动阻塞/起动失败）+ 试灯 +
  EM STOP + 自动/慢转起动旋钮 + STOP·AHEAD·ASTERN 车钟大表盘；右三只机旁仪表（起动空气 28 bar /
  主机转速 68 rpm / 动力液压油 280 bar）+ 盘车机遥控盒（`tg-power` `tg-fwd` `tg-rev` `tg-estop`）+
  盘车机控制箱（`ts-power` `ts-mode-local` `ts-mode-remote` `ts-heat` 与 4×3 指示灯）。
  矩阵格部件 id 即 `mx-local` `mx-ecr` `mx-bridge` `mx-force` `mx-sld-req` `mx-sld-act` `mx-sld-cancel`
  `mx-sld-reset` `mx-sd-act` `mx-sd-cancel` `mx-blower-run` `mx-blower-alarm` `mx-turn-out` `mx-air-dist`
  `mx-main-valve` `mx-not-ready` `mx-lim-act` `mx-lim-up` `mx-start-block` `mx-start-fail`；
  另有 `start-auto` `slow-turn` `blow` `test-lamp` `em-stop` `tel-0…tel-10`。
- **`Ac600PneumaticSystem`**（1600 × **870**）：气动操纵系统图，**照参考图（AC 600 气动操纵系统）逐块还原**，
  术语已按要求统一为「起动空气 / 盘车机 / 阻塞」。
  **本组件点击不弹浮动提示**（`_tip()` 为空实现）——反馈只靠阀位切换、绿填充、指示灯与数值变化。
  · **左上** 空气干燥器组（虚线框）：左截止阀 → 两条并联支路（**止回阀 → 减压阀 → 滤器菱形**）+ 中竖支两位阀
    → **右立管（一条连通竖管，上面不再挂阀）** 汇合 → 出口截止阀 → 数值框；两条支路 `y = 50 / 176`。
  · **单向止回阀画法（`_check(cx, cy, r, dir)`，共 3 处）**：**球（圆）+ V 形**，
    斜线与水平夹角 **26.9°**（`CHK_TH`，比原 `atan(r/23)` 每边大 10°）；
    **尖端位置由「球与两斜线相切」反算**：`CHK_TIP(cx, r, dir) = cx + dir·r/sinθ`；
    两条斜线**相交于尖端**（尖端即下游管路接点），并从尖端画到**越过切点再延伸 10 px**
    （`tanLen + 10`，`tanLen = r/tanθ`）—— 延伸段穿到球的外侧可见，形成"球被两条斜线夹住"的符号；
    **球先画、斜线后画**（否则延伸段会被白球盖掉）。
    · **工作逻辑（气源键）**：`dry1/dry2` = 角侧（V 尖、下游）有气 = `vin && riserN && vout`；
      **圆侧（上游）`dryIn1/dryIn2` = `v.vin || dry1/dry2`** ——
      **角这头有气 → 圆那头一定有气**；角这头没气时再看圆侧管路自身是否导通。
    · **管路不在 V 形内部穿行**：干燥器组两条支路的管路在止回阀处断开——
      上游止于**球左缘**（`185 - r`），下游自**尖端**（`CHK_TIP(185, 8)`）续出；
      排气阀那处的入口管直接接在**尖端**（`CHK_TIP(251.5, 7, -1)`）。
    · ⚠ `150, DRY_MID` 的竖直段**两条支路都要画**（`→ DRY_Y1` 与 `→ DRY_Y2`），漏掉上段会导致上支路断路。
  · **减压阀画法（照参考图）**：方框阀体 + 框内**阀座竖线 + 双向箭头**（内有两个实心小三角）
    + 右上角**先导口小三角** + 框顶**斜置调节弹簧**（`_coilSpring(s, cx, T-4, 21)`：锯齿向左上、顶端调节钩；
    高度 16→**21**，弹簧上的调节箭头 `L = 29`（原 24，伸长 5 px））
    + 框底**虚线取压反馈**（向下 14 → 向左 62 → 回到上游管路）+ 右侧管路上的先导取压小箭头。
  · **气源标注**：数值框左侧只画**短箭头**，箭头上方标「**来自主空气瓶**」（原「83」号牌已取消，牌左侧也不接任何管路）；
  · **滤器菱形**：宽高 **29 × 29**（`r = 14.5`，比最初 26×26 各 +3px），并在**上顶点 → 下顶点**之间画一条
    `dash [3.5, 3]` 的虚线代表**过滤网**；
  · **管线只接阀两端（硬性）**：任何管线都不得从阀体中间穿过，阀两侧管线止于 `cx ± TRI_A`。
  · **手动截止阀（硬性）**：全部按 `mimic-valve-symbols` 技能绘制 —— 两个**顶点相交于阀芯中心**的三角形
    （统一 `TRI_A = 13.5` / `TRI_B = 9.5`）+ 沿 `angHandle` 伸出的阀杆（`TRI_B + 9`）+ 杆端**垂直于杆的 ±6 短棒**手轮；
    横管用 `angAxis=180, angHandle=270`（杆朝上），竖管用 `angAxis=270, angHandle=0`（杆朝右）。
    **禁止**再用「蝴蝶结对顶 + 侧面小圆」的老画法（`_butterfly` 已删除）。
  · **控制空气管（细管）**：自起动空气**主管**（数值框右边缘 830 处）向右走 **25 px** 到 855，再**向下**下折、
    然后**向左**引入到**干燥器出口截止阀的右端**（`472 + TRI_A`）；线宽 **3.5**、色 `#5aa0e0`。
  · **粗细两套管路（硬性）**：**起动空气 30 bar** 用粗管（6~7 px、深蓝 `#1c56d6`）；
    **控制空气 7 bar** 一律用细管（**3.5 px、浅蓝 `#5aa0e0`**）—— 包括从主管到出口截止阀的引入线、
    **干燥器组内自 `vin` 出口起的全部管路**（分叉竖段 + 两条减压阀支路 + 右立管 + 出口汇合段）、
    底部控制空气总管（4.5 px）、两只五通阀的向下引线、盘车机支管、两只手动阀接管。
    干燥器组内只有最左侧「左干管 → `vin` 进油侧」那一段仍是粗管（属 30 bar 进气主干）。
    数值框左侧只有「来自主空气瓶」文字 + 短箭头，**左侧不接任何管路**。
  · **截止阀可手动操作（硬性）**：干燥器组内共**四只**——`vin`（左）/ `vout`（出口）/ `riser1` `riser2`（右立管上下），
    点击即切换开/闭，公开方法 `toggleValve(id)`，状态存 `this._valves`；
    **导通时两个三角形填充绿 `#2ecc40`**、关闭为白。阀体节点必须建在**动态层**
    （静态层 `cache='fixed'` 已烘焙，改 `fill()` 不生效）。
    热区 id：`valve-vin` `valve-vout` `valve-riser1` `valve-riser2`。
    （中间支路上的那个两位阀件及其竖管已按要求删除，干燥器组内只剩两条并联支路。）
    ⚠ **热区注册顺序**：干燥器组的整框热区 `dryer` **必须先注册**，四个阀门热区后注册才能盖在其上——
    Konva 同层后加者在上，若反过来注册，`dryer` 会吞掉阀门点击（表现为“阀点不动”）。
  · **主起动阀 `MSV = (936.5, 55, r=26)`**、**慢转起动阀 `STV = (1085, 145, r=26)`（右移 30）**；
**上中** 起动空气数值框（`startAir`，「起动空气」29.8 Bar，左侧箭头指示流向）→ **主起动阀**
    （圆阀 + 下置执行机构；上方「**工作**」绿灯 / 「**阻塞**」灰灯，**不再是“报警”**；标注 `_cap(MSV.x-70, 10, 140, '主起动阀')` 已下移 8）；
  · **右上** **慢转起动阀与主起动阀并联**（左端 `[900,55]→[900,145]→慢转阀左口`，右端 `[慢转阀右口]→[1081,55]`
    接回顶部总管）；**不再**从顶部总管下引至 A/B/C 左母线（该管已删除，A/B/C 左母线只连 A/B/C 三只阀）。
    **PS 压力开关及其附属小弹簧阀已按要求删除**（含两条取气管与热区 `ps`）；1 号气缸起动阀 / 2号
    （**`CV1 = (1230,260,170×200)`、2 号灰块 `(1428,250,48×200)`、主机转速 `RPM = (1265,500,175×75)`**
    —— 三者已整体**下移 100 px**）；
    · **手动两位两通阀（空气分配器，`_twoWayManual(cx,cy,W,H,key)`，1 号气缸起动阀上方）**：
      `this._twoWayManual(CV1.x + CV1.w*0.1 + 22, 115, 44, 34, 'mv2a')`——**横置两格**，
      **左格**＝竖直直通箭头（绿＝工作）、**右格**＝上下两个 T（切断）；右端**手动手柄**与左下角两只
      两位三通阀**同一套画法**（`_paintTwoWayHandle`：两根横杆 + 斜杆/竖杆 + 圆点 r=3.6）；
      点击 `toggleTwoWay('mv2a')` → 阀体左移一格 + 手柄转垂直 + 工作格换色；
      管路均**细管**：入口 `[1247, TOP_Y → 98]`（`airAfter`）、出口 `[1247, 132 → CV1.y]`（`mv2aOut`，切断即灰）；
      名称标注「**空气分配器**」在阀体**右上角**（`_cap(1282, 79, 88)`，已左移 30、随阀上移 15）；热区 `mv2a`。
      **出口管中途分支**：`[1247, 190] → [1444, 190] → [1444, 250]`（接 **2 号上边缘 1/3 处**，同为 `mv2aOut`）。
      **工作逻辑**：`mv2aOut = this._airTest('airAfter') && !mv2a.shift` ——
      **上方入口有气 且 工作于左位** → 下方出口有气（切到右位即切断，下游管路全部变灰）。
    · **框内先导两位三通阀（电磁控制，`cv1-pilot`）**：复用 `_threeWayManual(CV1.x+40, CV1.y+124, 40, 34, 90, 'cv1-pilot',
      { **swap:false**, coil:true, spring:true, initShift:false, fillOnLeft:true, **flipCS:true** })`——
      **上格＝卸放（斜箭头 + T + ▽）、下格＝直通（右箭头）**（与 A/B/C 相反，`swap:false`）；
      `flipCS` 把弹簧放到上端、线圈放到下端；**默认工作在上位**（`fillOnLeft:true` → 上格绿）；
      可点击切换（热区 `cv1-pilot`）；阀体在 `cy = CV1.y+124`；
      **`upShift: true`** —— 点击/通电时阀体**向上平移一格**（`off = -W`），工作位落到**下位**（下格绿、线圈变红）；
      阀体在 `CV1.x + 50`（已右移 10）；名称标注「**1号起动电磁阀**」在**右上角**（`_cap(1286, 278, 100)`，已左移 10）；
      **入口**改由上游细管从**上方引下并右折进入阀体左缘**（`mv2aOut`：`[1247,132] → [1247, CV1.y+84] → [CV1.x+33, CV1.y+84]`）；
      **出口** `[CV1.x+67, CV1.y+84] → [exC-22, CV1.y+84]` 从**上格右侧**（正对 T 的入口）引出到执行器横梁。
    · **1 号进气管**在框**上边缘 9/10** 处（`CV1.x + CV1.w*0.9`）下来，进框后在 `CV1.y+84` 处左拐，
      接到执行器横梁右缘（`CV1.x + 138`）；**2 号进气管**在灰块**上边缘 2/3** 处（`1428 + 48*2/3` = **1460**）——
      ⚠ 顶部总管右端 `TOP_X2` 必须 ≥ 1460（已由 1450 改为 **1460**），否则总管与竖管之间会留 10 px 间隙。
  · **中** 气缸起动阀组 **A / B / C**（复用 `_threeWayManual`，参数
    `(GRP.x + GRP.w/2 - 60, cy, **47**, 42, 90, 'abc0/1/2', { embed 选项 })`——
    **宽度仍 42、每格高 52→47**（总高 104→94，两格各减 5），
    `CYL_YS = [227, 432, 632]`（阀体位置不变），
    分组矩形外框已删，原 A/B/C 字母标签已换成**完整名称标注**（见下）：
    · `swap: true` —— **两块矩形图形整体平移 W 互换**（上格＝卸放、下格＝直通），
      注意是**图形互换位置**，不是改格内内容；
    · `coil: true` —— 左端（旋转后在**上方**）画**线圈**（18×18 方框 + 左上→右下对角线），
      **线圈直接贴住阀体、无短引线**；
      **通电指示**：阀工作于**上位**（`shift=true`）时线圈**红色填充 `#e53935`**，默认白底——
      由 `_mv3Parts[key].coil` 引用驱动，`toggleThreeWay()` 内更新；
    · `spring: true` —— 右端（旋转后在**下方**）画**弹簧**（**8 折、波高 ±5.3**，
      **8 折、波高 ±5.3**，舒展 **27 px**、压缩 **14 px**）；
    · `initShift: false` + `fillOnLeft: false` —— **默认工作位在「弹簧侧」那格（下格）**；
      旋转 90° 顺时针后**右格落在下方**，故 `fillOnLeft` 必须为 **false** 才能让下格绿；
      此时 `shift=false`、**弹簧处于舒展（27 px）状态**；点击后切到上格并压缩到 14 px；
    · **点击整只阀任意处**（热区 `abc-valve-0/1/2`，`(cx-26, cy-72, 52, 122)`；
      早期覆盖整组的大热区 `cyl-valve` 已删除）
      → `toggleThreeWay('abc'+i)`：**阀体平移一格 + 弹簧压缩**（32 → 19 px），绿格随工作位切换。
      **不是靠改填充来换阀位。**
    · **名称标注**（`_cap`，字号 13.5，静态层）：A = **「起动电磁阀A」在阀体左边**（`575, cy-9, 100`）；
      B = **「起动电磁阀B」在右下角**（`775, cy+14, 100`）；C = **「慢转电磁阀」在右下角**（`775, cy+14, 100`，与 B 同一版式）；
    · **慢转电磁阀 C 的出口管路**：从 **C 下格右边缘 3/4 处**（`[769, CYL_YS[2]]`，即 `y = cy = 632`）
      **水平**直连到慢转控制阀**气动控制接口的左缘** `[769, cy, V5B.x-18, cy]`（细管 3.5 px）——
      为保持水平，V5B 的 `y = 612`，使控制接口中心正好落在 `cy`；
    · **进气管路**：盘车机左侧机械两位三通阀出口 `[680,729]` **一直向上**到 `CYL_YS[0]`，
      在每只阀 **`cy`**（阀体中心线）处右转 `[680, cy] → [727, cy]` **直接接到阀口**
      （`727` 即阀体左缘，接口落在绿格工作位一侧）；**原「机械阀 → 盘车机顶部」的管路已删除**。
    五通阀仍经底边引线接底部总管。
  · **双座止回阀（梭阀，`_shuttle()`，`SV = (823.5,292,32.5×75)`，中心 (839.75,329.5)）—— 在起动控制阀前面（左侧）**：
    **竖置矩形** + **上阀座 ∧**（**顶点直接落在顶边** `y`、两脚 `0.28h`、`±0.44w`）+ **中间球**（`r = 0.30w`）
    + **下阀座 ∨**（**顶点直接落在底边** `y + h`、两脚 `0.72h`）—— **框内框外一律不画竖线**；
    **两个三角的底边不画线**：三角用**闭合填充层（`strokeEnabled: false`）**再加上**单独描边的两条斜边**，
    因此底边（两脚连线）没有任何描边、也不会出现白色覆盖线，只有填充色与白底的自然交界；
    **顶部入口**来自**起动电磁阀 A**、**底部入口**来自**起动电磁阀 B**、**右侧出口**去**起动控制阀气动接口**；
    · A / B 的输出管（静态层，`_drawPipes`）：从各阀**右缘**（`769`）在**下边矩形右边缘 3/4**（即 `cy`）引出 →
      右行至 `SV.x + 0.5w` → 上下分别**直接接到梭阀的顶边 / 底边**（无短接头）；
      **两路入口管的竖直段等长**（各 65 px）：A `227 → 292`、B `432 → 367`，
      因此梭阀与起动控制阀整体下移（`SV.y = 292`、`V5A.y = 309`）使 `V5A` 接口中心（329.46）与梭阀出口（329.5）齐平；
    · 梭阀出口 → 起动控制阀接口的管子为**动态管 `_aPipe`**，`toggleFiveWay('V5A')` 时终点随 `inner.x()` 伸缩。
    · **两位三通阀（A / B / C）工作逻辑**：**下位**（`shift=false`）＝**出口卸放、无气**；
      **上位**（`shift=true`）**且入口有气**＝出口有气。入口气来自盘车机左侧的机械两位三通阀
      （左位导通 `!this._mechShift` → 有气；盘车机 engaged 时机械阀断开 → 全路无气）；
    · **动态工作特性（`_updateShuttle()`，梭阀画在动态层）**：`topOn = supply && A.shift`、`botOn = supply && B.shift`；
      · 上下同时有气 / 都没气 → **钢球停在中间**；同时有气时**两个三角都绿 `#2ecc40`**；
      · 只有上部有气 → 钢球下移到**与下三角两边相切**处（`SV.y + h - d`，`d = r / sin θ`，`θ = atan(0.44w / 0.28h)`），**上三角绿**；
      · 只有下部有气 → 钢球上移到**与上三角两边相切**处（`SV.y + d`），**下三角绿**；
      · 任一路有气 → 输出有气 → **起动控制阀自动工作在左位**（阀体右移、左格绿、弹簧压缩、控制接口蓝色），
        由 `_applyFiveWay('V5A', out)` 驱动；**慢转电磁阀 C 同理**（`cOn = supply && C.shift`）
        直接决定慢转控制阀 V5B 的工作位；
      A / B / C 切换（`toggleThreeWay()` 末尾）、盘车机状态变化（`tick()` 内机械阀切换后）与初始化都会调用 `_updateShuttle()`。
  · **主起动阀 / 慢转起动阀（`_startValve(g, cx, cy, r, v5, key)`，照参考图重设计）**—— 画在**动态层** `_svGroup`：
    · **阀体圆**（描边 2.4）+ 圆内**粗黑竖条**＝**起动空气通道**（`0.30r × 1.92r`，初始**竖直**，左右进出口不通）；
    · 圆下方**齿条**（底线 + **11 个三角齿**朝上，`y = cy + 1.26r`，`cx - 1.4r … cx + 1.72r - 20`）
      → **横杆** → 右侧**执行气缸**（`cx + 2.03r - 10` 起，宽 `2.56r - 10`、高 `1.13r`，白底描边 2）——
      **气缸纵向位置由齿条反推**：`cylY = rackY − cylH/2`，使**齿条正好接到活塞中央**；
    · 气缸内**活塞**（竖线，**默认在 `2/10`＝最左**，即右入口进气时被推到左端）；齿条 + 横杆 + 活塞同在一个 `rackG` 里整体平移；
      **气缸进气着色**（`fillL` / `fillR`，`C_AIR_ON` 蓝）：**哪边入口有气就亮哪半边**——
      左进气（`open && inAir`）→ 左半蓝；右进气（`!open && inAir`）→ 右半蓝。
      **填充始终贴到活塞边缘**（不是固定半宽）：创建时按初始活塞位 `p0 = cylX + cylW*0.2` 定宽，
      `_stepStartValve()` 每帧按 `px = pistonX + rackG.x()` 重算 `fillL.width = px − (cylX+2)`、
      `fillR.x = px; fillR.width = (cylX+cylW−2) − px`，活塞移动时填充动态伸缩。
    · 气缸下边缘 **1/10 / 9/10** 两个入口 → 细管（3.5 px）接所控两位五通阀顶部两个出口
      （主起动阀 → V5A、慢转起动阀 → V5B，`x` 偏差 <0.6 走直线，否则在 `气缸底 +14` 折一次）；
    · **工作逻辑（`_syncStartValve(key, open)` + `_stepStartValve(key, dt)`）**：
      **默认 / 右侧入口进气** → 活塞在 **`2/10`**（最左，`rackG.x = 0`）、通道**竖直**＝不导通；
      **左侧入口进气**（五通阀左位）→ 活塞用 **3 s** 匀速**右移到 `8/10`**（`rackG.x = travel·pos`），
      齿条带动阀芯逆时针转 90° → 通道**水平**＝**导通**。
    · **导通判定**：`pos > 0.98`（活塞已到 **8/10**）。`airAfter`（顶部总管）＝ **主阀或慢转阀任一导通**；
      `slowOut`＝慢转阀自身导通（用于其右侧出口粗管着色）。
    · **气缸两根进气管的着色按五通阀工作位**（`_syncStartValve`）：
      **右位**（气动接口无气）→ **左管通大气（灰）**、**右管通入口（蓝，有气）**；
      **左位**（气动接口有气）→ **右管通大气（灰）**、**左管通入口（蓝，有气）**。
      ⚠ `_svParts[key].target` 初始必须为 **`null`**，否则首次 `_syncStartValve` 会因 `target === open` 早退、颜色不更新。
    · **来气管着色**：`_aPipe`（梭阀→起动控制阀）、`_cPipe`（C 阀→慢转控制阀）在 `_updateShuttle()` 中按输出变蓝/灰；
      ⚠ `_updateShuttle()` 的**首次调用必须放在这两根管子创建之后**，否则颜色不生效（原顺序有误，已修正）。
  · **两只气动控制的横向两位五通换向阀（`_fiveTwo()`，V5A `(900,309)`＝起动控制阀 / V5B `(1060,612)`＝慢转控制阀（已右移 25），均 135×44）**：
    · **左端气动先导控制头**：矩形 **18×20**（在 `0.111w + 3` × `0.34h + 5`，中心 `0.465h`）；
      框内**右向空心三角**（高 `0.56·0.34h + 5`、宽 `0.52·0.111w + 2`），**三角左边缘与矩形左边缘重合**；
    · 阀体白底、描边 2.2；中间**一条竖直实线**（`0.5w`、**线宽 3**、贯通 `0h…1h`）把阀体分成左右两格；
    · **左格**：T 形在**下边缘 1/4**（横线 `0.76h`、半宽 `0.055w`）；
      箭头「下边缘 1/2 → 上边缘 1/4」；箭头「上边缘 3/4 → 下边缘 3/4」（竖直向下）；
    · **右格（与左格镜像）**：T 形在**下边缘 3/4**；箭头「下边缘 1/2 → 上边缘 3/4」；
      箭头「上边缘 1/4 → 下边缘 1/4」（竖直向下）；箭头头部对称双翼（头长 8、半翼 3.8）；
    · **管路接口（世界坐标固定，不随阀体平移）**：
      **入口＝右边矩形下边缘的 1/2（`0.75w`）**，由 `_drawPipes` 引线接底部控制空气总管
      （`BOT_X2 = V5B.x + V5B.w*0.75`，总管右端即慢转控制阀引线处，不再外伸）；
      **出口＝右边矩形上边缘的 1/4、3/4（`0.625w` / `0.875w`）**——
      **不再画短竖线**，改由所控起动阀执行器下方的两根**细管**直接接到阀体顶边；
      **名称标注**：V5A = 「起动控制阀」（**左下方**，`V5A.x-8, +h+8, 84`）；
      V5B = 「慢转控制阀」（**右下方**，`V5B.x+w-18, +h+8, 84`，避开底部引线）；
    · **右端复位弹簧**：`_springPts(w, 27)`（8 折、波高 ±5.3、长 27），自 `(x+w, h/2)` 水平伸出；
    · **可点击切换工位**（画在**动态层** `_v5Group`，状态存 `_v5State` / `_v5Parts`，`toggleFiveWay(key)`）：
      **默认右位**（右格绿 `#c8e6c9`、弹簧舒展 27、控制接口白底）；
      **点击 → 左位**：**整个阀体（两格 + 符号 + 控制接口 + 弹簧）向右平移一格（`w/2`）**
      —— 管路固定不动，接口因此自动对应到左格同样的 1/4、1/2、3/4 位置；
      同时左格绿、弹簧压缩 27→**14**、左端控制接口**蓝色填充 `#3fa3e8`**（表示有先导气体）；
      **慢转控制阀左侧来气管随阀位伸缩**：该管画在**动态层**（`_cPipe`，`_drawPipes` 里已不画），
      `toggleFiveWay('V5B')` 中把终点更新为 `V5B.x - 18 + inner.x()`，切换后仍接在新位置的控制接口左缘；
      热区 `distributor`（V5A）/ `v5-b`（V5B）**已取消手动切换**（`onClick = null`，仅作部件标识）——
      两只控制阀的阀位**只由左侧气动接口的气压决定**（`_updateShuttle()` 自动设置）。
      V5B 在 `(1035,612)`，右移一格后弹簧仍不压「主机转速」框。
  · **1 号气缸起动阀执行器（`_cylStartValve()`，照参考图重绘）**——框内只有一只**单作用气缸**：
    **宽度为原尺寸的 2/3 再减 6**：顶部矩形宽 `BW = 76×2/3 − 6 ≈ 44.7`（`cx=x+118`）——
    **只画上边与左右两条竖边，下边缘完全隐藏**；左右竖边**向下延长到与拱弧相接**
    （`yJoin = ACY − √(AR² − (BW/2)²)`）；矩形内**下缘粗横条**（同宽 × 7，`#1b2430`＝活塞）；
    **中部粗竖线**（活塞杆，宽 5）；**下部拱形缸体**（`AR = 44×2/3 ≈ 29.3` 半圆 + 两侧竖边 + 底部粗横条 `2·AR × 6`）；
    **左上接口** `[x+67, y+84] → [cx-BW/2, y+84]` 接**1 号起动电磁阀出口**；
    **右下接口** `[1386, TOP_Y] → [1386, CV1.y+152] → [cv1x+AR, CV1.y+152]`（粗管 6 px）接缸体右侧；
    名称标注「1号气缸起动阀」已移到**虚线框外下方**（`_cap(x, y+h+6, w)`）。
    · 整只阀画在**动态层** `_cv1Group`（`_cylStartValve(g, b)`）。**固定部分**：顶部矩形三条边（左右边延长到拱弧，
      `yJoin = ACY − √(AR²−(BW/2)²)`）+ 拱形半圆与两侧竖边（竖边下端 **`y+169`**，即延长到工字下横线两端，按初始 `pist.y = 5`）。
      **可动的「黑色工字结构」** = **上横（活塞粗条）+ 竖杆 + 下横（底部粗条）**，三者同放 `pist` 组，**初始 `y = 5`**；
      动作时**只有它下移**，其余部位不动。
    · **缸头起动阀逻辑（`_syncCylPiston(hasAir)`）**：入口有气 → `pist.y = 5 + stroke`
      （`stroke = (ACY−AR) − (y+93) − 5`，即活塞上横下缘刚好顶到拱弧上端）；无气 → 回到 `y = 5`。
    · **进气流动效果（`_cv1Flows`）**：工字下移后，**拱形两侧竖边下端（`y+169`）与下移后的下横之间**
      形成左右两个开口；各画一条**斜向外下**的虚线（`[cx∓AR±2, y+172] → [cx∓AR∓22, y+192]`，起点落在开口中央，
      `C_PIPE_LP`、**6 px**（原 3 px 加粗一倍）、`dash [10,8]`），`tick()` 中 `dashOffset(-phase)` 滚动表示气流源源流出；
      **工字还原时一并隐藏**（`_syncCylPiston` 里 `visible(hasAir)`）。
    · **绿色填充（`_cv1Charge`）**：入口有气时，**工字上横上方**的矩形内区域填 `#c8e6c9`（宽 `BW-4`）；
      **高度随工字下移动态调整**：`h = (y+86 + pist.y) − (topY+2)`，始终贴到活塞上横上缘；无气隐藏。
    · **1 号起动电磁阀逻辑**：`hasAir = _airTest('mv2aOut') && cv1-pilot.shift`（入口有气**且**线圈得电/手动切到**下位**）；
      有气时左上接口线变蓝 `C_PIPE_LP`、否则灰 `#c3ccd4`。`tick()` 每帧同步。
  · **1 号气缸排气阀（照参考图重画，`_cylExhValve()`）**：框内自左至右 ——
    **入口单向止回阀**（球 + V，**方向反向：尖朝左**，`_check(cx, cy, r, -1)`）
    → **细管直线**接气缸左颈 → **气动执行器**（上杆头 + 中环 + 中杆 + 下大腔体，整体**下移 10 px**）
    → **细管直线**接右侧**减压阀**（`_reduceValve(cx, cy, 46, 42, -1, 40)` 镜像版：左进右出）。
    ⚠ 止回阀与气缸之间**不再画波纹软管/弹簧**；减压阀虚线取压反馈方向按 `cx - dir*fb` 计算，
    保证正向（dir=1）仍向左、镜像（dir=-1）才向右。
    标注文字移到**部件框下方**（`y + h + 6`）。
    ⚠ 外框**不填充**（`rgba(0,0,0,0)`），否则会遮住框内下引到止回阀的供气管；
    供气管 `[230,265] → [230,344] → [244,344]` 从框顶进入后接止回阀入口。
  · **盘车机联锁的机械二位三通阀**（`_mech3Way()`，中心 `cy=750`、管路 `x=680`，**与手动两位三通阀同尺寸 52×42**）：
    **当前工作位所在格绿色填充**（`#c8e6c9`）；右侧小圆与盘车机之间有一段**蓝色推杆**（`#3fa3e8`），
    盘车机 engaged 时推杆**向左增长**顶动阀芯（阀体左移一格）。
    **左右阀位与手动阀互换**，两格内部都按手动阀的画法加箭头：
    · **左格**：3/4 处竖线 + **向上箭头**（两翼开度 `±W*0.11`，与手动阀右格箭头完全一致）；
    · **右格**：**斜箭头自右上 3/4 引到左下 1/4**；**T 形横线下移 6 px**、只保留向下的竖线
      （接到下方底边，上方连线已删除）；**T 横线位于 `cy+9`、宽 14**；**▽ 卸放位于下边缘 1/4 处**；
    左端为**弹簧（12 折、宽度 48 px、波高 ±8 px 即总高 16 px）**——切到右位时压缩到 **28 px**，压缩效果非常明显；
    右端为**机械碰触柄**：两根横线围绕中线对称、**间距 = 边长的 1/8**，收拢到一个小圆。
    · **初始**（盘车机 Disengaged）工作在**左位**——阀体 `bx=641`，管路通、弹簧舒展（48px）；
    · **盘车机 engaged** 时工作在**右位**——阀体左移到 `bx=589`、**弹簧压缩到 28px**，
      下方气路堵死，上方气经 ▽ 卸放。状态由 `tick()` 比对 `!M.turningGearOut` 自动切换。
    阀体**不填充**（否则会盖住穿过的管路）。
  · **左中** 1 号气缸排气阀 / **2号**；**下** 盘车机（`TG` **790,725 / 130×60**，Engaged / Disengaged）、
    控制空气 7.0 Bar（`CA` **505,780 / 130×50**，位于 40 L 气瓶之后；框底 830 不贴总线，
    由**下端中心** `[570,830] → [570,BOT_Y]` 一段细管接入）、40 L 气瓶（`BTL` 365,822 / 140×36）。
    `_valBox()` 的标签区高度与字号已改为随框高自适应（`lh = clamp(17, 0.34h, 26)`），小尺寸框不再溢出。
    **底部整排（`BOT_Y` = 840）**：控制空气总管、40 L 气瓶（`BTL` 365,**822 / 140×36**，以总线为中心）、控制空气框（`CA` 505,**780**）
    与左下两只两位三通阀（`a` 中心 y=**760**、`b` 中心 y=BOT_Y）同步位于该行。
    ⚠ 组件高度已加到 870，竖置的 `b` 阀（高 104）下缘约 892，超出组件底边约 22 px（可拖动查看）。
    **左下手动两位三通阀**（`_threeWayManual()`，管路 `x=140`、**每格宽 52**、**高 42**，总宽 104；
    热区 `valve-mv3` 为 `(20,626,190,90)`，右侧未用部分已裁掉）：
    两格方框 + 左侧手柄；**管路对准「当前格 3/4 位置」的上下边缘**；
    · **右格（直通位）**：3/4 处竖直箭头，上下顶到边缘；
    · **左格（卸放位）**：斜箭头自「上边 3/4」引到「下边 1/4」（两端顶到边缘，**箭柄画到尖端不留空**；
      **T 形横线为 `H*0.04+7`（T 高比原版少 4px）、总宽 `2*W*0.11`（比原版宽 2px）**；
      **箭头两翼必须按箭柄方向用 `ux/uy + 法向` 计算**，不得硬编码偏移，否则箭头尖会歪）、
      3/4 处 T 形阀座连到底边、1/4 处 ▽ 卸放口；
    · **当前工作位所在格绿色填充**（`#c8e6c9`，`_syncThreeWay()` 切换）。
    · **初始**：右格对准管路（`x=140`），**上下相通**；手柄第二根横杆在 1/2 处、与斜杆相接不冒头；
      切到左阀位后手柄**垂直向下**，第二根横杆与第一根等长；
    · **40 L 气瓶前另有一只同型阀**（`_threeWayManual(305, BOT_Y, 52, 42, 90, 'b')`，热区 `valve-mv3b` 260,728）——
      顺时针旋转 90° 成竖置，管路水平进出；热区 `valve-mv3b`；两只阀状态独立（`_mv3Parts[key].shift`）。
    · **点击手柄**（热区 `valve-mv3` → `toggleThreeWay('a')`）：管路不动、**阀体沿格排列方向平移一格**，
      左格对准管路 → **上下切断**，气体从 ▽ 卸放。
    下口接底部总管、上口（`x=125`）向上 → `y=265` → 右行 → 从**顶部**进入 1 号排气阀（`x=320`）/ …2（`x=512`）。
    ⚠ 两个排气阀已整体**右移 50 px**；排气阀入口只从这只阀上端引出；左下角不接左干管（`x=10`）。
    **右下** 主机转速。
  · **两只手动两位三通阀的名称标注与工作逻辑**：
    · 左下阀（`_threeWayManual(140,760,…,'a')`）= 「**排气阀气源**」（`_cap(19, 715, 92)`，阀体**左上方**）——
      **下边＝入口**（接底部总管，`ctrl` 常通）；**入口有气 且 工作于右位（`shift=false`，默认）** → 出口才有气。
      气源键 `exhSrc = _airTest('ctrl') && !a.shift`，出口侧三根管（`[140,739]→[140,265]→[512,265]`、
      `[230,265]→…344`、`[512,265]→[512,275]`）都挂该键；切到左位（卸放）后全部变灰。
    · 40 L 前竖置阀（`'b'`）= 「**控制气源**」（`_cap(334, 760, 82)`，阀体**右边**）——
      **左边＝入口**；**入口有气 且 工作于下位（`shift=false`，默认）** → 出口才有气。
      「控制空气」数值框随之显示：**通 → 7.0 Bar，断 → 0.0 Bar**（`tick()` 中按 `b.shift` 取值）。
      **底部总管在阀 b 处拆成两段**：`[10,BOT_Y]→[305,BOT_Y]` 挂 `ctrl`（常通）；
      `[305,BOT_Y]→[BOT_X2,BOT_Y]` 挂 **`ctrlB`**（`= ctrl && !b.shift`），切到上位即变灰。
      **挂在总管右段（40 L 之后）的分支全部同挂 `ctrlB`**，共 **5 条**：
      总管右段本身、CA 框引管、**起动控制阀 V5A 底部引线**、**慢转控制阀 V5B 底部引线**、**机械二位三通阀下口**。
      （阀 a 下口在阀 b 左侧，仍为 `ctrl` 常通。）
  · **管路「有气 / 无气」着色（`_pipe()` 第 5 参 `airKey` + `_syncPipes()`）**：
    所有管路画在**不缓存的 `_pipeGroup`**（`_init()` 中创建，位于 `_bgNode` 之上、`_staticGroup` 之下），
    每帧按 `_airTest(airKey)` 结果上色：**有气＝原色**（`C_PIPE` / `C_PIPE_LP`），**无气＝灰 `#c3ccd4`**。
    气源分段键：`ctrl`（控制空气总管＝**`dryFinal`**，即气源来自干燥器出口左干管，出口截止阀关闭则整条总管无气）、`dryUp`（左截止阀前）、`dry1` / `dry2`（两条干燥支路，
    需 `vin + riserN`）、`dryOut`（任一支路通）、`dryFinal`（`dryOut && vout`，出口截止阀后）、
    `airMain`（主空气瓶→主起动阀，常通）、
    **四只截止阀的逐段逻辑（气流方向：主空气 → 出口阀 472 → 两分支 → 入口阀 108 → 左干管）**：
    `dryOut = airMain && vout`（出口阀左侧出口→右立管）→ `dry1/dry2 = dryOut && riser1/2`（两分支）
    → `dryUp = dry1 || dry2`（汇合→入口阀右入口）→ `dryFinal = dryUp && vin`（入口阀左侧出口→左干管）；
    **`ctrl` ＝ `dryFinal`**，所以出口截止阀一关，最下方那段水平总管也跟着变灰。
    `airAfter`（主起动阀后＝`mainStartValveOpen && !blocked`）、`mech`（盘车机机械阀导通）、
    `abA` / `abB` / `abC`（对应电磁阀上位且有气）。执行气缸的两根入口管在 `_syncStartValve()` 内单独着色。
    · **入口无气则出口必无气（链路闭合要求）**：
      `mech`（盘车机机械阀出口）＝ **阀导通 且 `ctrlB`**；`abA/B/C` 继承该条件；
      `_syncStartValve()` 里 `inAir = _airTest('ctrlB')`，**入口断气时五通阀两根出口管一律变灰**
      （并把 `inAir` 纳入早退比较，否则断气不刷新）；`tick()` 中检测 `mech` 变化会重算 `_updateShuttle()`。
    · ⚠ **禁止在 `_airTest()` 内再调用 `this._airTest('mech')`**（局部变量 `mech` 必须写 `!this._mechShift`），
      否则无限递归、组件初始化失败（`window.sys` 不存在）。
    ⚠ **层序用 `zIndex()`**（`_bgNode.zIndex(0)`、`_pipeGroup.zIndex(1)`）；
    不要用 `moveTo(rect)` —— Konva 的 `moveTo()` 参数必须是**容器**，传 Rect 会抛 `newContainer.add is not a function`。
    ⚠ `tick()` **没有形参**，动画步长在方法内取 `const dt = 1 / 20`（consys 固定 20 fps）。
  · **布线规则（硬性）**：所有管线为正交折线，端点一律落在设备端口 / 母管 / 圆阀圆周上，
    不得悬空；坐标常量集中在文件头（`DRY` `MSV` `STV` `TOP_Y` `GRP` `CYL_L/R` `V5A/B` `TG` `CA` `BOT_Y`…），
    新增管件一律引用常量。A/B/C 分组框与干燥器虚线框允许管线穿过（仅作分组用）。
  · 部件 id：`dryer` `bottle` `main-valve` `slow-valve` `ps` `cyl-valve` `distributor`
    `turning-gear` `ctrl-air` `rpm-tag`（旧的 `start-air` / `valve-58` 已取消，工作流请用新 id）。
  · **「工作 / 阻塞」两键（可点击，`setBlock(on)`）**：位于主起动阀上方 `(1062,22)` / `(1136,22)`，均 30×18
    （已左移 30 px，标签「工作」「阻塞」随之为 `1056` / `1130`），热区 `work-btn` / `block-btn`：
    · **默认工作**：工作键亮绿 `#16c60c`、阻塞键暗 `#d8dcdd`；
    · 按**阻塞** → 工作键还原为灰 `#c9ccce`、阻塞键**红 `#e53935`**，并**把主起动阀锁死在断开状态**：
      强制 `mainStartValveOpen = false`、`mainStartValveOk = false`，同时置
      **`startBlocked = true`（Start Blocked / 报警项）、`engineReady = false`（Eng. Not Ready）**，
      `M.acked = false` 并把报警栏写成 **`START FAIL/BLOCK, ACTIVE`**；
      Engine State 页随之：STATE 的 `Start Blocked` 红、START FAIL/BLOCK 的 `Start Blocked`/`Engine Blocked` 红、
      ENGINE NOT READY 的 `Main start valve blocked` 红；
    · 按**工作**（解除）→ `mainStartValveOk = true`、`startBlocked = false`、
      `engineReady = turningGearOut && airDistributorOk && !startFail && !shutDown && !emStopped`，
      **Engine State 页立即恢复正常、`Ready for Start` 亮（不需要应答）**；
      报警栏：已应答 → 直接清除；**未应答 → 改写为 `START FAIL/BLOCK, NORMAL`（红字记忆）**，
      该项在 Alarms→Sys. Non-Crit 保持红色、Value 为 `NORMAL`、无 `AL. CLOSE`，**必须按 ACK 才消失**；
    · ⚠ **应答不清除仍在的故障**：`AC600Solver._anyFaultActive()` 已加入 `startBlocked` ——
      阻塞期间按 ACK 只把该项转黄，报警栏仍保留 `START FAIL/BLOCK, ACTIVE`，**只有恢复工作状态才自动消失**；
    · **同一套逻辑也用于「空气分配器右位（不导通）」**：`_syncStartBlock()` 统一处理
      `blocked || mv2a.shift` → `airDistributorOk = false`、`startBlocked = true`、`engineReady = false`、
      报警栏 `START FAIL/BLOCK, ACTIVE`；两种故障的处理与报警语义完全相同，
      仅 Engine State 的 ENGINE NOT READY 组不同：主起动阀阻塞亮 **`Main start valve blocked`**，
      空气分配器右位亮 **`Start air distributor blocked`**（`!M.airDistributorOk`）；
      该组里的 **`Engine not ready ECS` 在起动阻塞期间不亮**（`!engineReady && !startBlocked`）；
    · **四种起动阻塞源，报警相同、Engine State 灯不同**（`_syncStartBlock()` 统一置 `startBlocked` / `engineReady`）：
      | 故障源 | 条件 | START FAIL/BLOCK 组 | ENGINE NOT READY 组 |
      |---|---|---|---|
      | 主起动阀阻塞（按钮） | `_blocked` | Start Blocked 红 + **Engine Blocked 红** | **Main start valve blocked** 红 |
      | 空气分配器右位 | `mv2a.shift` | Start Blocked 红 + Engine Blocked 红 | **Start air distributor blocked** 红 |
      | **盘车机 Engaged** | `!M.turningGearOut` | Start Blocked 红，**Engine Blocked 白** | **Turning gear engaged** 红 |
      | **控制气源阀上位** | `mv3Parts.b.shift` → `M.controlAirVented` | Start Blocked 红 + **Engine Blocked 红** | **Control air vented** 红 |
      ⚠ **只有「主起动阀阻塞」按钮**才把 `mainStartValveOk/Open` 锁死；其余三种不改主起动阀状态，
      否则 `Main start valve blocked` 会误亮。`Engine Blocked = !(mainStartValveOk && airDistributorOk) || controlAirVented`。
    · **主机运行中（`M.running || M.starting`）阻塞不产生报警**：`wantAlarm = blk && !running` 才写
      `M.messages` / `M.alarm` —— 运行时只让状态条显示 `Eng. Not Ready`、Engine State 页按上表点亮，
      **报警栏保持空白**；恢复工作状态后状态与页面立即恢复（`_blkAlarm` 记录上一次报警态，避免重复触发）。
    · **运行中盘车机不可切换**：`turning-gear` 点击处理里 `if (M.running || M.starting) return;`，
      按下无反应、不切换、也不产生报警。
    · ⚠ **主起动阀已开启（`mainStartValveOpen`）时按阻塞无效**（`setBlock(true)` 直接 return false）；
  · 动态：主起动阀「工作」灯亮绿 = 非阻塞；
    起动中/工作中顶部总管叠加绿色色带淡入；盘车机文字随 `turningGearOut` 在 Engaged / Disengaged 间切换，
    点击 `turning-gear` 走 `M.toggleTurningGear()`。
- **`Ac600Mimic`**（842 × 800，页 5）：**直接显示 `images/ac600.png`（原图 1024×973，contain 等比缩放）**的
  系统结构图，整块可拖动（`_addDragPlate()`）；组件坐标 = 图片像素 × `K`（`K = min(W/1024, H/973)`），
  `PARTS` 表按**原图像素**填 `x1,y1,x2,y2`，由 `mx()/my()` 换算 —— 换图时只改这张表即可。
  · **模块识别**：图面 19 个装置都注册成可点击部件（`addClickablePart`），**点击即在图上框出该模块
    （绿框 + 半透明绿底）并弹出深色标注框（英文名 + 中文名 + 一句话功能），4 s 后自动淡出**
    （`_identify()` / `_hideIdentify()`，节点画在 `_dynamicGroup`、`listening:false`）；
    也可以 `comp.identifyPart(id)` 程序化触发；点击同时记录 `sys.lastClickedId / lastClickedPartId`。
    工作流 `find` 步骤用 `subTarget:'<部件 id>'` 即可让箭头指向该模块（`getClickablePartCenter()`）。
  · **部件 id**（= `_parts` 键）：`bmu`（Bridge Manoeuvring Unit 桥楼操纵单元）、`cmu`（Control Room Manoeuvring Unit
    集控室操纵单元）、`bwu-port` / `bwu-stb`（Bridge Wing Manoeuvring Unit 两翼操纵单元）、`op`（Order Printer 车令打印机）、
    `ssl`（Start/Stop Speedset Lever 起动/停车与转速设定手柄）、`ipu`（Indicating Panel Unit 指示面板单元）、
    `lcp`（Local Control Panel with Engine Telegraph 机旁控制面板）、`dpu`（nn. 通用 DPU 分布式处理单元，编号 nn.）、
    `rai16`（遥控模拟量输入模块）、`mei`（Main Engine Interface 主机接口单元）、`esu`（Engine Safety Unit 主机安全单元）、
    `dgu`（Digital Governor Unit 数字调速器）、`servo`（Servo Unit 伺服单元）、`actuator`（Electric Actuator 电动执行器）、
    `rpmu`（Dual RPM Units incl. Overspeed 双转速单元）、`rpmdet`（RPM Detectors 转速探头）、
    `engine`（MAN B&W MC 主机）、`prop`（Propeller 螺旋桨）。
    ⚠ 旧的绘图版部件 id（`bw-port` `bridge-unit` `cr-unit` `cr-lever` `cr-indicator` `local-panel` `rai`
    `rpm-units`）已随图片化改造**不再存在**，工作流请用上面的新 id。
  · **双击跳页**（`DBL_PAGE`）：**双击 BMU → 第 1 页**（驾控台）、**双击 CMU → 第 2 页**（集控台）、
    **双击 LCP → 第 3 页**（机旁面板）、**双击主机（`engine`）→ 第 4 页**（气动操纵系统）；
    处理在热区 `dblclick` 里调 `goPage(n)`（内部走 `sys.navigateTo`）。单击仍是识别（框选 + 名称标注）。
  · **螺旋桨动画**（`_drawPropeller()` + `tick(dt)`）：原图叶片用白块遮掉（`PROP_MASK`，避开左侧
    「Propeller」文字后由组件重画该文字），改画**三片桨叶（0°/120°/240°）+ 桨毂 + 尾锥**：
    · 几何常量 `PROP = { hubX: 918, hubY: 913, L: 52, W: 14 }`（原图像素）——**桨毂中心与尾轴中心线对齐**
      （尾轴在图上 y 904~923，中心 913.5）、桨毂左端压住轴端（x 894~940），尾锥 936~960；
    · **转速与转向跟随 `sys.ac600.rpm`**：`角速度 = rpm × π/30`（rad/s，与真机一致：68 rpm ≈ 1.13 r/s），
      正车顺时针、倒车（rpm 为负）逆时针，**主机停车（rpm = 0）时桨叶静止**；
    · 叶片组 `_propSpin` 绕桨毂中心转动，桨毂/尾锥画在其上遮住叶片根部，`listening:false` 不挡点击；
    · 该区域热区常态**不再显示 3% 绿底**（白底上会显成淡绿方块），只在鼠标悬停时显示。

## 船舶机舱监视报警系统（K-Chief 600，页 6~10）

**原型为 Kongsberg K-Chief 600 机舱监视报警系统**（`project/sys_ljdq10-4.js` 为同一工程副本）。

| 组件 | id | 尺寸 | 页 | 说明 |
|---|---|---|---|---|
| 报警系统主界面（操作站 OS） | `kchief` | 1620 × 850 | 6 | 窗体标题栏 / 工具栏（ROS 节点、时钟、Command control、值班状态框、未确认报警计数、报警图标、确认 ACK、消音、蜂鸣器）/ 左列 **UnDock 报警组列表** / 船舶剪影 / 表格视图 / 工艺流程图入口 / 趋势 / 自定义视图 |
| 现场总线型系统结构图 | `topo` | 1340 × 860 | 8 | K-Chief 600 现场总线型拓扑（纯静态结构图）：住舱/驾驶台（WCU×2、OS、WBU、OS）→ 集控室（OS/SGW×2、Printer、UPS、CAN Bus 3 / Ethernet 1·2）→ 机舱（CAN Bus 1·2、dPSC：RDi-32 / RDo-16 / RAi-16 / RAo-8 / RAi-10tc / RIO-C4、LOS、MOS）。部件 id：`wcu-1` `wcu-2` `os-cabin` `wbu` `os-bridge` `os-sgw-1` `printer` `ups` `os-sgw-2` `can1` `can2` `can3` `eth1` `eth2` `dp-rdi1` `dp-rdi2` `dp-rdo` `dp-rai1` `dpsc` `dp-rai2` `dp-rao` `dp-rai10` `los` `mos` `rio` |
| 轮机员安全系统面板 | `deadman` | 1860 × 900 | 9 | 轮机员安全系统（Dead Man）三块面板：左＝机舱入口甲板上层左、中＝集控室操作面板、右＝机舱入口甲板上层右。中面板：系统运行灯 / 关\|开 自复位旋钮 / 复位 / 蜂鸣器 / 时间设置；左右面板：绿色指示灯 + 旋钮 + 4 块复位按钮板。部件 id：`ecr-switch-left` `ecr-switch-right` `ecr-reset` `ecr-time` `ecr-buzz`、`left-switch-left` `left-switch-right` `left-reset-1..4`、`right-…`（同左）。逻辑见 `components/DeadmanPanel.js` 头部注释：旋钮按住右半→开、左半→关（松手回中位，系统状态保持）；预警时间内按任意复位按钮清零；超预警时间机舱蜂鸣器闪；超「预警+报警时间」→ `sys.kchief.setDeadman(true)` 触发 A 级 DEADMAN 报警（MISC 组），驾驶台与轮机长面板显示红色 DEADMAN + 扬声器（只能由安全系统复位按钮清除，主站 ACK 只消闪）。时间设置对话框为 DOM 非模态，`#deadman_time_dlg`，必须点右上角 `#dm-close` 才关闭；预警最小 1 min、报警最小 0 min |
| 延伸报警单元 | `extunit` | 1569 × 810 | 7 | 3 列 × 2 行共 6 块值班面板（K-Chief 版式，标题牌岗位名 14px / （值班面板）12px），每块有 **Home / Alarms / Settings 三页**（状态栏按钮切换，激活页按钮变绿）：Home＝驾驶台：On Watch（BRIDGE 白 / ECR 绿，各 190 宽）+ Duty + 岗位名（左对齐 26px，**未指定值班时留空**）+ Call All/Call Duty Engineer（始终显示）；
其他面板：Duty + 岗位名（居中 34px，**未指定值班时留空**）；岗位名只显示"当班轮机员"；
**红色报警区 + Sound off 只出现在值班轮机员面板**（驾驶台永远不出现，始终显示 On Watch / Duty / 呼叫按钮）；Alarms＝`SAT NOV 14 11:26:55 2026 ALARM SUMMARY` + 报警列表 + Up/Down/Select/Tag details；Settings＝Dimming/System test/Configuration/About + Backlight(Day/Night) + Night Screensaver(Disable/Enable)（**固定显示页，不设任何热区**）；**仅值班面板**在 Home 页、**所有面板**在 Alarms 页底部显示 8 个报警类别标签（标签名：M/E MISC / M/E SHD / M/E SLD / **BOILER** / **FIRE ALARM** / **MISC** / **AUX ENG** / BILGE，字号 10.5 加粗；有未确认报警的标红并闪烁，已确认的常亮红） |

- **报警模型**：`tools/KChiefSolver.js`（`sys.kchief`，由 `kchief.tick()` 每帧 `solve(dt)` 驱动，
  两块组件共享同一模型）。状态机：未确认 UNACK（闪+鸣）→ 已确认 ACK（常亮）→
  已恢复正常 RTN（黄，未确认时）→ 确认后移除；越限须持续超过「延时」才报警，恢复须越过「死区」。
  **列表状态标记**（当前报警与报警历史一致）：未确认＝A 块亮红/深红闪；已确认＝✓ + A；
  故障先恢复后确认＝⏎ + A（当前报警页闪烁，历史页常显且不闪，Alarm state 显示 `Returned(HIGH/LOW/ALARM)`）。
  **列结构**：`Status | Pri(A块) | 时间 | ID | Tag | Description | Function | Alarm state | Value | Eng unit | Limit | Alarm group`；
  「标签一览」与「报警组页」（点击左侧 UnDock 分组）**格式完全相同**：同一列结构但去掉 Status 与时间两列，
  行数据统一由 `KChiefConsole._tagRow(tg, idx)` 生成；Alarm state 列在参数报警时**红色高亮**（否则 `NORMAL` 灰），
  无报警时优先级块淡灰；报警组页把有报警的测点按报警时间排在上方。
  **Function 功能号**：开关量＝`XA`（接受外来开关信号）；模拟量＝前缀（压力 `P` / 流量 `Q` / 液位 `L` / 温度 `T`，其余 `X`）
  ＋ `I` ＋ 后缀（高报警 `AH` / 低报警 `AL`），如 `PIAL`、`TIAH`、`LIAH`；如需 `AHH`/`ALL` 等特殊后缀用 `opt.fn` 直接指定。
  **Status 栏宽度**＝A 块宽度的 2 倍（`markX=124, prioX=156, prioW=32`），✓ / ⏎ 与 A 块等宽、字号 20。
- **越控（Override）**：不是屏蔽报警（屏蔽报警用「闭锁 Inhibit」，本工程中文统一译作「闭锁」）。AHH/ALL（A 级）报警会启动安保动作延时（`tag.safetyDelay`，默认 5 s），
  到时间未越控即执行主机**自动停车 SHD**（A 级低限）或**自动减速 SLD**（A 级高限），记录在 `safetyActions`；
  在延时内按 Operate→`Cancel Shut Down` / `Cancel Slow Down`（`model.cancelSafety('SHD'|'SLD')`）即越控该安保信号，
  记录在 `model.overrides`（「被越控标签 Overridden tags」页），报警行 Alarm state 追加 `· OVR`。
- **报警组**：`ALARM_GROUPS` 共 19 组（M/E GENERAL、M/E LO SYSTEM、AUX BOILER、MISCELLANEOUS …），
  左列 UnDock 逐组显示计数（有未确认报警→亮红/深红闪烁；已全部确认但故障未排除→深红常亮显示该组报警数；无报警→灰）；可在「标签参数设置」中指定的 6 个组见 `SETTABLE_GROUPS`。
- **测点**（`ALARM_TAGS`）：19 个组各 8 个、共 **152 个**（每组 5 个模拟量 `T(...)` + 3 个开关量 `D(...)`）。
  教学示例测点（工作流/故障引用）：`ME-LO-P`（M/E LO）、`ME-CW-T`（M/E COOL FW SYS）、
  `ME-FO-P`（M/E FO）、`AUX-BLR-L`（AUX BOILER）、`AUX-AC-T`（AUX MACHINERY）、`BLG-LV`（MISC）。
  **开关量**（`digital:true`）：动作（1）即报警，无设定值/死区，趋近时间常数 0.4 s；
  表格中"方向"显示「开关量」、「设定值」显示「动作即报警」、「死区」显示「—」、「实测值」显示「动作/正常」；
  参数对话框对开关量只允许改「延时 / 优先级 / 报警组 / 闭锁」。
- **`kchief` 部件 id**：`tb-home` `tb-ack` `tb-silence` `tb-print` `tb-counter`
  `tb-prev` `tb-next`（列表翻页）、`watch-box` `undock-toggle`、
  菜单按钮 `menu-view` `menu-operate` `menu-tools` `menu-system` 及其子项
  `menu-view-0…7`（对应表格视图前 8 项）、`menu-operate-0…2`（Watch call / Acknowledgement /
  Sound off）、`menu-tools-0…1`（DPU replacement / Trim and list controls）、
  `menu-system-0…4`（Print / Scheduled print / Date and time / Help / About）、
  `dock-<组键>`（如 `dock-ME-LO`）、
  `tab-active` `tab-history` `tab-tags` `tab-events` `tab-override` `tab-log` `tab-inhibit`
  `tab-counters` `tab-recover`、`mimic-me`（主机概览）；
  **趋势 1**（部件 `trend-1`，`_openTrend()`）：整页参数表（Visible/Color/ID/Tag/Description/Value/Eng unit/Measure range
  ＋ `trend-add` `trend-remove` `trend-row-N` `trend-vis-N`）＋ 曲线图（左 % 轴、右数值轴、8 槽图例、120 s 窗口，
  每 0.5 s 采样一次，数据自起动即缓存）；默认两条曲线 `ME-LO-P`（**0~0.6 MPa**）与 `ME-LO-T`（**0~100 ℃**）。
  **自定义视图 1**（部件 `custom-1`，`_openCustom()`）：整页参数表（ID/Tag/Description/Function/Alarm state/Value/
  Eng unit/LimitLL·L·H·HH/Signal type/Alarm group ＋ `custom-remove` `custom-up` `custom-down` `custom-convert`
  `custom-row-N`）＋ 半圆仪表盘（刻度带、指针、数字显示框），量程同样为 **0~0.6 MPa / 0~100 ℃**；
  **主机概览**（部件 `mimic-me`，`_openMimic()` → `_renderMimic()`，照 K-Chief「Main engine overview」版式，
  **4 缸、两排共 10 只仪表**）：① 两排仪表（F.O/L.O press、Jacket CFW press、SCAV. air press、Starting air press、
  F.O/L.O temp、Jacket CFW out temp、SCAV. air temp、Control air press）；② 气缸参数表 `No.1~No.4`
  （Exh.gas outlet/deviation、Cyl. cover CFW outlet、Scav.air、PCO outlet、PCO non-flow NFA）；
  ③ 右列 `TC system`（Rpm / Exh.gas in·out / TC LO out，No.1·No.2）、`LO system`（3 只报警灯）、
  `FO system`（粘度值 + 2 只报警灯）；④ 轴承温度（Thrust / Inter shaft / Stern tube AFT(S)(P)）；
  ⑤ `ME safety & control system` 五列指示灯（LOCAL / E.C.R. / BRIDGE / At Sea / Stand by）；⑥ `Aux.blower`；
  ⑦ `ME RUN` 负荷/转速大数字 + Fuel index / Order rpm + `Shaft power`（Power / Torque / Rpm）。
  取值均来自 `KChiefSolver` 测点（无对应测点的 SCAV. air press/temp、PCO 等按负荷推算），页面每 500 ms 重绘。
  辅助方法：`_mimicGauge()`（单只半圆仪表）、`_mimicBlock()`（带标题牌分区框）、`_mimicBearing()`（轴承温度小框）；
  **发电机组概览**（部件 `gen-1` `gen-2` `gen-3`，`_openGen(n)` → `_renderGen()`，照 K-Chief「Generator Engine」版式，
  **4 缸**）：① 顶部两排 8 只仪表（FO/LO/HT/LT 进水压力、FO/LO/HT 进水与 HT 出水温度）；② 左列 Turbo charger
  （Exh.gas outlet、TC rpm×10）＋ Charge air Temp / press 两只小表；③ 中部柴油机：标题 `Generator Engine No.N`、
  状态 `REMOTE / LOCAL / RUNNING|STOPPED`、`No.1~No.4 + Mean` 排气温度表（Exh.gas outlet / deviation）、
  下方 `Starting air inlet` 表 / `Fuel Oil`（MGO use、粘度）/ `Trip Condition`（5 个条件灯）/ `Engine RPM` 表、
  底栏 `LO filter diff press PDAH`、`Pre L.O pump RUN/FAIL`、`L.O sump tank LAH/LAL`；④ 联轴器 + `Generator`
  （Winding temp R/S/T）；⑤ 右列 `Alarm overview`（5 只灯）＋ `Load`（Load 柱、Power、cosφ、Freq、Volt、Curr、Reac）。
  **默认仅 1# 运行**（4 缸排气温度取 `DG1-EXH-T` 分缸递减、转速取 `DG1-RPM`、20 % 负荷 228 kW），
  2#/3# 停机：各参数归零、状态显示 `STOPPED`、转速表变灰。;
  **首页跳页**：工艺流程图分组支持 `parts: ['page-5']` 之类部件 id —— 点击「主机滑油与气缸油 ME LO」直接
  `pageMgr.navigateTo(5)` 切到第 5 页（滑油系统 MIMIC）；`gen-N` 打开机组概览，其余有 id 的打开主机概览；
  列表行：`row-0…row-20`（**双击**打开报警参数界面，单击仅选中）。
  ⚠ 双击判定在 `click` 处理器里自行实现（同一测点 450 ms 内两次点击），因为列表页每 500 ms 重建、
  节点会被替换，Konva 自带 `dblclick` 无法跨节点识别；`fire('dblclick')` 仍可被自动演示使用。
  ⚠ 层级：`_pageGroup` 必须位于 `_interactGroup` **之上**（zIndex 4 > 3），否则整块拖动热区会吞掉列表页点击。
  **报警参数界面**（双击行弹出，K-Chief Tag properties 样式）：标题 `序号 - 英文描述`、左侧 `Acknowledge`、
  标签页 `param-tab-summary/trend/alarm/other/help`、参数行 `param-isalarm` `param-isinhibit`（Yes/No 单击切换）、
  `param-limit` `param-delay` `param-repeatDelay`（**双击数值进入编辑**，DOM 输入框 id = `kchief_param_<key>`）、
  `param-ack` `param-save` `param-cancel` `param-close`。
  工作副本 `_edit = { isAlarm, isInhibit, limit, delay }`，可一次改多项：保存写入 `enabled/limit/delay/inhibit`，
  取消全部还原；开关量没有 Limit / Deadband 行（只有 Is Alarm / Is Inhibit / Delay Time）。
  模拟量行为 `Is Alarm / Is Inhibit / High(Low) Limit / Deadband / Delay Time`：
  **Deadband（报警回差）**——低限 0.20 + 回差 0.05 时，低于 0.20 报警、高于 0.25 才消警；
  高限 0.80 + 回差 0.10 时，高于 0.80 报警、低于 0.70 才消警（判定见 `KChiefSolver.solve()` 的 `back`）。
- **值班呼叫对话框（Watch calling）**：点击顶部 `ECR watch`（`watch-box`）或 Operate→`Watch call` 弹出
  （`_wcGroup` 层，350 ms 定时重建以实现闪烁）。部件 id：`wc-close` `wc-collapse`、
  `wc-duty-chief|first|second|third|elec`（Engine duty 5 位轮机员：呼叫中绿/亮绿闪，当班常绿，
  再点同一按钮取消呼叫）、`wc-watch-ecr` `wc-watch-bridge`（Engine watch 位置）、
  `wc-call-all` `wc-call-duty`（广播呼叫）、`wc-accept`（应答：被呼叫者接班，原来有人→值班交接，
  无人→首次值班）、`wc-reject`（拒绝呼叫）。模型侧 `callTarget` / `callEngineer()` / `acceptCall()` /
  `rejectCall()`；`dutyPanel` 默认 `null`（无人值班）。打开参数界面、回 Home、起动系统时自动关闭该对话框。
- **`extunit` 部件 id**：`<岗位>-buzz`（状态栏扬声器：呼叫中按下＝应答接班，报警中按下＝本面板消音）、
  `<岗位>-soundoff`（绿色 Sound off，等同 `<岗位>-ack` 别名）、`<岗位>-home` `<岗位>-alarms`
  `<岗位>-settings`（切页）、`<岗位>-duty`（中部岗位名区域，点击设为当班）、
  `<岗位>-alarm-up|down|select|tag`（Alarms 页按钮）；**Settings 页为固定显示，无热区**
  （岗位：`bridge` `chief` `first` `second` `third` `elec`）。
  驾驶台另有 `bridge-watch-bridge` `bridge-watch-ecr` `bridge-call-all` `bridge-call-duty`（Home 页）。
- **失职（重复 Repeat）报警**：报警产生后值班面板 `repeatDelay` 秒未确认，或面板消音后主站 `repeatDelay` 秒未确认
  → `repeatActive`，**驾驶台与轮机长面板**状态栏显示闪烁红底 `REPEAT`（与扬声器同相位），
  按扬声器可消声但 REPEAT 保留，**主站按「确认 ACK」（`ackAll()`）才消失**。
  `repeatDelay` 默认 **180 s**（`DEFAULT_REPEAT_DELAY`），在**报警参数界面**的 `Repeat delay` 行双击修改（10~600 s，保存生效）。
- **主界面内部为「整页切换」而非浮层**：点击表格视图（当前报警 / 报警历史 / 标签一览 …）
  或工艺流程图「主机概览」时，Home 内容层 `_homeStatic`（船图 + 表格视图 + 工艺流程图 + 趋势 +
  自定义视图）与 `_homeInteract` 热区层整体隐藏，`_pageGroup` 显示该页（页头只有标题，**不设返回按钮**，回 Home 用工具栏「主页」`tb-home`）；
  只有**标签参数设置**仍是浮层对话框（`_overlayGroup`）。`overlayKind` 返回当前页/对话框类型
  （`null` = Home，`'param'` = 参数对话框），工作流 `check()` 用它判断。
- **两块组件均为可拖动面板**：静态图形一律 `listening:false`，因此各加了一块
  "整块拖动热区"（`_addDragPlate()`，置于交互层最底层），面板空白处按下即可拖动。
  ⚠ **液晶屏显示页面时禁止拖动**：`_renderMenu()` 末尾按 `(menuPage && subPage) || _directPage` 置
  `group.draggable(false)`（回 Home/关闭页面自动恢复 `true`），否则在页面上选中行/点按钮会把整块面板拖走。
- **工作流**：原有流程已全部删除，现有两条（均 `check` + `op` + `check()`）：
  ① `analog-param-modify`「1. 模拟量参数的修改」（7 步）：
  第 1 页点 `dock-ME-LO`（M/E LO SYSTEM）→ `overlayKind='group'`、`_groupFilter='ME-LO'`
  → 双击 ME-LO-P 信息条（`_openParamByTag()`，行号由 `_rowPartOfTag()` 实时反查）→ 参数界面
  → 双击 `param-limit` 改 **0.22**、`param-deadband` 改 **0.06**（`_setParamNumber()` 走
  `#kchief_param_<key>` 输入框 + 回车），点 `param-save` 保存
  → 切第 5 页（MIMIC），点三通阀 `cv3b` 把 PT-101 测量管路转手摇泵（`m.sw3='pump'`）
  → 点 `hp-dn` 把手摇泵压力降到 **0.21 MPa**（`_setHandPressure()`，`which='pt'`，每点 ±0.01 MPa），
  回第 1 页等 3 s 报警延时 → `ME-LO-P` 未确认报警
  → 切第 5 页点 `hp-up` 升到 **0.29 MPa**（越过 0.22＋0.06 回差）
  → 回第 1 页报警转「已恢复正常（未确认）」RTN，点 `tb-ack` 复位，进报警历史。
  ② `digital-param-modify`「2. 开关量参数的修改」（8 步）：
  点 `dock-ME-LO` → 双击 ME-LO-PR-SW 信息条 → `param-delay` 改 **10 s** 并保存（开关量参数界面只有
  Is Alarm / Is Inhibit / Delay Time，无设定值与回差）→ 切第 5 页，右键压力继电器 `psw1`
  （`_openCompConfig()`：fire contextmenu → 点菜单「参数设置」）→ 观察 `diag_lowSet` /
  `diag_highSet`（压力下限＝报警动作值、压力上限＝报警复位值）→ 点「取消」关闭，
  拧螺钉 `setscrew`（给定值 +3 格 → 36 % → 下限 **0.18 MPa**）、`diffscrew`（幅差 −10 格 → 10 % →
  幅差 **0.03 MPa**、上限 **0.21 MPa**），组件提供 `turnSetScrew()/turnDiffScrew()` 程序化接口
  → 点 `cv3c` 把压力开关测量管路转手摇泵（`m.sw3b='pump'`）、`hp2-dn` 降到 **0.17 MPa**
  （`_setHandPressure(sys, 0.17, 'psw')`）→ 回第 1 页等 10 s → `ME-LO-PR-SW` 报警
  → 第 5 页 `hp2-up` 升到 **0.22 MPa**（越过上限 0.21）→ 回第 1 页报警 RTN → `tb-ack` 复位。
  ⚠ 压力继电器 `psw1`（YT1226）的 `lowSet/highSet` 是由**给定值百分比＋幅差百分比**换算的派生量：
  `lowSet = lowEnd×setPoint/100`、`highSet = lowSet + diffStart + (diffEnd−diffStart)×differential/100`；
  参数界面里这两个字段只**显示**（`onConfigUpdate` 不接收），实际调整靠机身上的两颗螺钉。
  辅助函数（`_firePartClick` `_click` `_dblclick` `_ensureHome` `_ensureWatchCall` `_setParamNumber`
  `_openParamByTag` `_waitFor` `_resetRig` `_rowPartOfTag` `_setHandPressure` `_turnScrew`
  `_openCompConfig` `_demoSetRepeatDelay`）保留复用；两条流程第 1 步 `act()` 都先 `_resetRig()`
  （清报警 / 参数回初值 / MIMIC 三通阀回测管路、手摇泵回 0.30 与 0.20 MPa / 压力继电器回 30 %·30 %），
  保证演示从干净状态开始。末步 `check()` 判据同时接受 `_projFlag` 标记与历史记录 `state==='RTN'`，
  演练 / 评估模式（不经 `act` 的 flag）也能判过。
- **第 11 页：主机缸套冷却水温度控制系统**（`cwmimic` = `CoolingWaterMimic`（1360×750，x=-20 y=40）、
  `cwpid` = `CoolingWaterPID`（330×290，x=1390 y=60））：两者共用 `sys.coolingSolver`（`CoolingWaterSolver`，
  在 `consys.js` 中创建并每帧 `solve(1/20)`，与 `sys.ac600` 同一条循环）；
  MIMIC 部件：设备 `engine heater distiller cooler tank deaerator`、阀门 `wb-v4 wb-v25s wb-v5 wb-v25s wb-v27s wb-v6s wb-v7s wb-v8 wb-v9 wb-v502 wb-v12s wb-v13s wb-v15s wb-v26s`、
  两台冷却泵 `cw1 cw2`（含面板起动/停止按钮）、三通调节阀 `rv-cooler rv-bypass`、仪表 `tc pt ps gauge`；
  PID 面板部件：`am`（A/M 切换）/`set`/`up`/`down`/`reset`、`pv`/`sv`/`out`、`alarm-reset`；
  控制量 = 三通阀冷却口开度 `m.manip`（0 % 全旁通最热 / 100 % 全经冷却器最冷），PI + 负荷前馈 + 积分分离，SV 默认 85 ℃。
  **面板增减按钮**（`CoolingWaterPID._level0`）：**AUTO 每次改设定值 ±1 ℃**；
  **MANU 每次改 OUT ±1 %**（`CoolingWaterSolver.stepManip`）。
  **系统起动默认工况：驾驶台车钟 NAV FULL、集控室/机旁手柄在 STOP，主机稳定全速运行** ——
  `AC600Solver` 构造（与 `reset()`）中 `leverRpm = { BRIDGE: 68, ECR: 0, LOCAL: 0 }`（即
  `TELEGRAPH[0]` / `TELEGRAPH[5]`）、`leverIdx = 0`（驾驶台在 NAV FULL）、控制权在 `BRIDGE`、
  `rpmCmd = setp = rpm = 68`、`load = 22 + 0.9×68 = 83.2 %`、`running = true`、
  `engineMode = 'SEA'`（At Sea）、`stateText = 'Running'`，无报警、蜂鸣器不响。
  · **转数计数 Rev 与运行小时只在主机转动时累加**：`|rpm| > 1` 才执行
    `rev += dt × 1.7 × |rpm|/68`、`runHours += dt/3600` —— **停机（rpm = 0）时两者都保持不变**
    （原来无条件累加，停车后 Rev 还会一直涨）。
  **默认即为稳定运行工况**（`CoolingWaterSolver.createModel()` 的初值）：
  `engineSw/engineOn = true`（柴油机运转，负荷 50 %）、两台泵 `mode 'AUTO'` 且 **1# 泵运行**（`autoLead='cw1'`，2# 备用）、
  `psUp=true`（排出 2.05 bar / 41 m³/h）、LDCL `mode='AUTO'` 且 `tempCtrl='AUTO'`、
  `temp = tcMeas = setTemp = 85 ℃`、阀位 `manip = outCmd = 32 %`（50 % 负荷的前馈稳态开度），无报警。
- **滑油温度调节器 TIC-101（页 10 MIMIC 面板，`MainEngineLubeOilMimic._pidPanel()`）**：
  面板 `(650,320,250,190)`，三行 PV/SV/OUT 数值框 + 第 4 行「手动 / 自动 / ▲ / ▼」
  （部件 `pid-man` `pid-auto` `pid-sv-up` `pid-sv-dn`）。
  **增减按钮步长**：**自动（`pid.auto === true`）每次改设定值 SV ±1 ℃**（35~70 ℃）；
  **手动每次改输出 OUT ±5 %**（0~100 %）—— 手动时 OUT 固定不变，PID 不再自动调节
  （`tick()` 中只有 `m.pid.auto` 为真才按偏差改 `m.pid.out`）。
- **滑油流动动画（页 10 MIMIC）**：`_createDynamic()` 里按管路走向建立 18 条 `Konva.Line` 流动虚线
  （`stroke '#e2a020'`、`dash [9,7]`、`dashOffset` 滚动、`listening:false`，存入 `this._flows`），
  `tick()` 中 `this._flowPhase = (phase + 1) % 16` —— **速度为冷却水 MIMIC 的一半**（那边是 `+2`）；
  每条的 `cond()` 决定是否显示：泵支路 = 该泵 `on && 对应截止阀开 && 未过载`；总管 = 任一台泵在运行；
  旁通/冷却器两条支路按三通阀开度 `m.cv3` 分别给 0~100 % 的流量宽度。
  **管路底色改为淡绿 `C_PIPE = '#a8cdb8'`**（原深绿 `#1f6f43`），让橙色流动虚线更醒目。
- **缸套冷却水进口低压自动停车（由冷却水 MIMIC 的 PS 压力开关触发）**：
  `CoolingWaterSolver.solve()` 第 5 步 —— 水流开关 `m.psUp === false`（PS 断开）持续 **`PS_TRIP_DELAY = 10 s`**
  → `m.tripped = true`、`m.engineOn = false`（MIMIC 柴油机停车），并回调 `sys.coolingHostTrip(true)`；
  `consys.js` 中定义 `coolingHostTrip = (on) => on && ac600.safetyAction('SHD', 'CW-PS')`，
  因此主机遥控模型同时停车：Shut Down 页多亮一行 `J.C.F.W. INLET LOW PRESS`（`SHUTDN`，标志 `M.jcwLowShd`）、
  报警信息 `JACKET C.F.W. INLET PRESS LOW, SHUTDN`、主页原因行 `Safety Shut Down`、状态条 `Eng. Not Ready`；
  PS 恢复时 `m.tripped` 自动复位（AC600 侧仍需 Cancel SHD 越控）。⚠ 两台泵都打 STOP 才会让 PS 保持断开
  （只停一台时 3 s 后备用泵自动投入，PS 恢复）。
- **温度高自动减速（SLD，两处触发，规则一致）**：
  · **滑油**（`MainEngineLubeOilMimic.tick()`）：油温 `m.temp > 60 ℃` 持续 **6 s** → `ac600.safetyAction('SLD','ME-LO-T')`；
    降到 `< 58 ℃`（回差 2 ℃）→ `ac600.safetyClear('SLD','ME-LO-T')`；
  · **缸套冷却水**（`CoolingWaterSolver.solve()` 第 5b 步）：出口温度 `m.temp > 90 ℃` 持续 **6 s** → `safetyAction('SLD','CW-T')`；
    `< 88 ℃` → `safetyClear('SLD','CW-T')`；
  · AC600 侧 `sldCauses` 记录减速原因；存在原因时 `_stepSetp()` 把 `setp` **压到 40 rpm** 并按减速度（3 rpm/s）下降，
    `activeLimiter = 'Slow Down'`；
  · **预报警（可取消弹窗）**：温度越限立即 `ac600.sldPreAlarm(tagId)` → 报警栏 `<TAG>, SLOWDN`，
    主机遥控面板液晶区弹出 `_popupGroup`（红标题 `SLOW DOWN ACTIVE` + 灰底 `SLOWDOWN ALARM` / `CANCELLABLE` /
    `Engine load will be reduced`）；显示条件 `M.sldPre && !M.cancelSLD`，6 s 延时内温度回落（`sldPreAlarmClear`）或按 Cancel SLD 即消失；
  · 延时到执行动作后：报警栏两行 **`<TAG>, SLOWDN`** + **`SLOWDOWN ACTIVE, ACTIVE`**（`safetyAction('SLD')` 直接设 messages）；
  · Slow Down 页：`SLOWDOWN ACTIVE` = `ACTIVE`，原因行（`MAIN L.O.INLET TEMP HIGH` / `JACKET C.F.W. OUTLET TEMP HIGH`，注意 L.O. 后无空格）**值显示 `SLOWDN`**；
  · Engine State 页 `Runing` 绿灯只看 `M.running`（不再要求 > 50 rpm）；
  · **菜单指示灯**：慢降只点亮 **Safety System**（主菜单）与 **Slow Down**（二级菜单），
    **Alarms / Misc Menu 不亮**；`_updateBandLamps()` 里 `alarms` 改为"报警列表确有触发项"（按 `_alm` 状态判定，不再看 `M.alarm`），
    `misc` 恒 false，`safety` 含 `slowDown`；I/O Fail 页的 `EICU A/B SLOWDOWN` **不再随慢降动作点亮**（恒 false）；
  · **报警复位（`safetyClear`）**：温度 / 压力回到回差值以内时，**报警栏里该条信息直接移除**
    （不再区分是否已应答 —— 原先「未应答 → 改写成 `, NORMAL` 留在栏里」，会出现「温度已降到 88 ℃ 以下、
    报警栏那条仍挂着」的问题）；Alarm History 里仍保留一条绿色 `NORMAL` 记录（面板 `_histRows`）；
    `SLOWDOWN ACTIVE` 仍按锁存保留到车钟拉到 40 rpm 以下。
  · **预报警期间按 Cancel SLD**（`setCancel('SLD', true)` 且尚未真正减速）：弹窗消失、计时清零，
    **该条预报警信息同时从报警栏移除**（只留 `SLOWDOWN CANCELLED, ACTIVE` 这条越控记录）；
    否则 `sldPre` 已被置空，温度回落后 `sldPreAlarmClear()` 无从清除，信息会永远挂在栏里。
  · **应答与自动还原**：按 **ACK** 后 Slow Down 页两项变**黄色**（故障仍在，报警栏保留两行）；
    温度回落（故障消失）→ 已应答的原因行**自动消失**（无需再次 ACK），`SLOWDOWN ACTIVE` 因锁存保持黄色；
    车钟拉到 40 以下解除锁存时，`SLOWDOWN ACTIVE` 行同时消失并清掉报警栏的 `SLOWDOWN ACTIVE, ACTIVE`；
    `_anyFaultActive()` 已包含 `sldPre` / `slowDown`，因此故障期间按 ACK 不会清空报警栏；
  · **Cancel SLD 语义（只对"未触发的减速"有效）**：
    预报警期间按 Cancel SLD → `sldCancelled = true`、清 `sldPre`（弹窗消失）、装置侧计时清零，**本次减速被取消（暂停）**，
    温度仍越限也不会触发；**再按一次释放** Cancel SLD → `sldCancelled = false`，若温度仍越限会**重新弹出预报警并重新计时 6 s**；
    **已触发减速后按 Cancel SLD 对本次无效**：`_stepSetp()` / `solve()` 已不再看 `cancelSLD`，仍需把车钟拉到 40 以下才复位；
    面板侧 Slow Down 行的 `live`、菜单灯 `safety` / `sld`、主页原因行都只看 `M.slowDown`（不再显示 Overridden）；
  · **锁存期间报警栏必须保留 `SLOWDOWN ACTIVE, ACTIVE`**：`solve()` 中只要 `slowDown && !cancelSLD && sldAwaitReset`
    就检查 `messages` 里是否有该行，缺失则补回并令 `alarm = true`（防止任何路径把它清空，出现"温度已恢复但报警栏空白"）；
  · **减速动作不自动复位（锁存）**：`safetyClear()` 只清原因并把报警信息改写（已应答→清除，未应答→`, NORMAL`），
    同时置 `sldAwaitReset = true`，`slowDown` 保持——**必须由拥有控制权的面板把车令 `rpmCmd` 拉到 40 rpm 以下**
    （`solve()` 中 `|rpmCmd| < 40` 判定）才解除自动减速；正好 40 不复位；
  · Slow Down 页对应行 `MAIN L.O. INLET TEMP HIGH` / `JACKET C.F.W. OUTLET TEMP HIGH` 随 `sldCauses` 点亮，
    有明确原因时（以及 `sldAwaitReset` 锁存期间）**EICU A/B 组不再跟着点亮**；
  · **Slow Down 页报警项状态键用 `sld:<key>`**（曾误写成 `shd:` 与停车页共用状态，会串色）；
    车钟拉到 40 rpm 以下、`slowDown` 落下的那一帧，`_pollAlarms()` 会**清掉全部 `sld:*` 状态**，
    因此 `SLOWDOWN ACTIVE` / `MAIN L.O. INLET TEMP HIGH` / `EICU A/B SLOWDOWN` 等行**同时还原**（无需再按 ACK）。
- **故障设置已清空**：`project/sys_ljdq9-1.js` 的 `FAULT_CONFIGS = {}`（原 5 项已删除），
  工具栏「故障设置」界面不再有可勾选故障；所有故障改由装置本身触发。
- **主滑油低低压自动停车（由压力继电器触发，替代原 `lo-pr-sw` 故障）**：
  页 10 MIMIC 上的压力继电器 `psw1`（YT1226）取压来自继电器侧三通阀（`m.sw3b`：line=滤器出口压力 / pump=手摇泵 `m.handP2`）；
  **压力低于下限 `lowSet`（默认 0.15 MPa，受给定值/幅差螺钉影响）→ NC 触点闭合**（`psw.getSwitchOutput()=1`）
  → K-Chief 测点 `ME-LO-PR-SW`（`delay: 0` 触点闭合立即判报警，`prio: 'A'`，`safety: 'SHD'`，**`safetyDelay: 6`**）
  → 安保延时 6 s 到且未被越控 → `kc.safetyActions` 记录 SHD → MIMIC `m.shdTrip = true`、`m.engOn = false`（主机停车）；
  **延时内触点断开（压力回升）→ `_safetyTimers` 立即删除、报警转 RTN，不触发停车**（`KChiefSolver.solve()` 的 `back` 分支）；
  越控：K-Chief Operate → `Cancel Shut Down`（Cancel SHD）。
- **安保停车状态联动（页面 10 → K-Chief）**：滑油 MIMIC 的 `m.shdTrip` **跟随 `sys.ac600.shutDown`**
  （`if (acM && typeof acM.shutDown === 'boolean') m.shdTrip = !!acM.shutDown;`），
  由它驱动测点 `ME-GEN-SHDN`（M/E SAFETY SHUTDOWN ACTIVE）的 `normal` 值。因此
  **驾控台把车钟拉回 STOP 复位自动停车后，报警系统这条也会一起恢复**（已应答 → 自动清除、
  未应答 → 转 RTN）；之前 `shdTrip` 只在滑油 MIMIC 的 engine-switch 打开时才清，导致 K-Chief 报警一直挂着。
- **主机动作 → 报警系统（K-Chief）**：`consys.js` 每帧在 `ac600.solve()` 之后把三项状态推给 `sys.kchief`：
  `setExternal('ME-GEN-EMSTOP', emStopped || emStopLatched)`（**M/E EMERGENCY STOP**）、
  `setExternal('ME-GEN-TRIP', shutDown)`（**M/E AUTO STOP ACTIVE**）、
  `setExternal('ME-GEN-SLOWDN', slowDown)`（**M/E SLOW DOWN ACTIVE**），三者在 **M/E GENERAL** 组；
  `KChiefSolver.setExternal(tagId, on)` 让开关量测点接受外部信号（`solve()` 中 `tag.external` 优先），
  走同一套延时/未确认/已确认/RTN 状态机（`delay: 0` 立即报警）。
- **安保动作联锁到主机遥控模型**：`KChiefSolver` 执行安保动作时调用 `sys.ac600.safetyAction(kind, tagId)` ——
  SHD → 燃油切断、主机停车（`shutDown`、`rpm=0`、`engineReady=false`、`startBlocked=true`，报警信息 `<TAG>, SHUTDN`），
  SLD → 自动减速 `<TAG>, SLDN`；`ME-LO-PR-SW` 会置 `loLowLowShd`，AC600 的 Shut Down 页因此多亮一行
  `MAIN L.O. LOW-LOW PRESS`（值 `SHUTDN`），主页红色原因行显示 `Safety Shut Down`，EICU 组不亮；
  越控 Cancel SHD 时清 `loLowLowShd`。延时内触点断开 → K-Chief 撤销计时、报警转 RTN，不会停车。

## 上一项目（保留）：风油切断装置的功能实验（`project/sys_ljdq9-3-2.js`）

单页工程（`PROJECT_PAGES = []`），4 台设备同屏（1920×1080 基准坐标）：

| 组件 | id | 尺寸 | 说明 |
|---|---|---|---|
| 风油切断操作与原理演示 | `wfcut` | 585 × 788 | 上半：消防控制室 / 驾驶台两块相同控制屏（4 路按钮下移 15px）；下半：MIMIC 两个 24V 切断回路（风机 / 油泵） |
| 部分动力负载屏 | `load` | 495 × 713 | 3 × 3 塑壳断路器（110 × 159）；整块可拖动（`board` 热区，标题栏也能拖） |
| 风机及控制面板 | `fan1` | 293 × 277 | 控制面板 + 风机符号；供电源自 `load` 的 `ESS-1F` |
| 油泵及控制面板 | `pump1` | 293 × 277 | 控制面板 + 油泵符号；供电源自 `load` 的 `ESS-1P` |

- **尺寸约定**：组件内部坐标即画布真实尺寸（**不使用** `group.scale()` 缩放），缩小一律重排几何与字号。
- **联锁方向**：`wfcut` 每帧把 `_shuntMap()` 推给 `load.setShuntLive()`；`load` 断路器跳闸后
  `fan1/pump1` 的 `_supply()` 变为 false → 立即停转、POWER 灯灭；按钮弹出 + 断路器复位合闸后自动恢复。
- **全船失电联锁**：燃油泵切断回路一旦动作（`isOilCut()`），`wfcut._syncPower()` 立即令
  `load.setBusLive(false)` —— 燃油泵全停 → 发电机断油停机 → 主配电板失电：所有负载**合闸也无电**、
  不能起动（`_supplyInfo()` 返回 `why:'bus'`）。负载屏标题右侧有汇流排指示（绿「配电板带电」/
  红「配电板失电」），**点击该指示（部件 `bus-reset`）** 模拟发电机组重新起动建压、恢复供电
  （无定时自动恢复，避免与演示节奏冲突）。
- **部件 id**（工作流 `subTarget` / `op.part`）：
  - `wfcut`：`panel-fire` `panel-bridge`、`btn-fire-0~3` `btn-bridge-0~3`、`mimic-fan` `mimic-oil`、`ka-fan` `ka-oil`
  - `load`：`board`（整屏，可拖动/识别）、`qf1 ~ qf9`、`bus-reset`（汇流排指示：重新建压恢复供电）
  - `fan1` / `pump1`：`panel` `run-lamp` `power-lamp` `btn-start` `btn-stop` `mode-knob` `fan`（油泵为 `pump`）
- **负载铭牌**（`components/PartialLoadPanel.js` 的 `SWITCHES`，按行）：
  - 第 1 排：1#机舱风机 / 2#机舱风机 / 舵机房风机，铭牌均为 `ESS-1F`（分组 `fan`）
  - 第 2 排：1#滑油泵 / 1#燃油泵 / 1#增压泵，铭牌均为 `ESS-1P`（分组 `oil`）
  - 第 3 排：1#厨房变压器 `PT-1`（优先脱扣 Preferential Trip）/ 1#主空压机 `HEF-1`（消防高泡释放 High Expansion Foam）/ 1#主海水泵 `SQ4`（顺序起动 Sequential Start）；一般负载，不受风油切断控制，但随全船失电而停运
  - 铭牌配色：`ESS` 红、`PT` 黄、`SQ` 绿、`HEF` 蓝（`_tagStyle()`）
  - 同一排多台开关铭牌相同，风油切断联动用**位置键** `key`（`fan-0..2` / `oil-0..2`）逐路判定；
    `fan1/pump1` 组件用 `switchKey`（`fan-0` / `oil-0`）取电。
- **工作流**：`cut-identify`（组成与识读）、`cut-operate`（操作与原理演示，7 步含全船失电与重新建压）、
  `cut-fault`（故障分析）；故障 2 项：KA1 线圈断线（`cut-ka-fan`）、2# 风机分励脱扣器线圈断线（`cut-shunt-f2`）；
  **故障 `name` 不要带序号前缀**（界面会自动编号，否则显示成「1. 1. …」）。

## 冷却水温度控制系统（`sys_ljdq8-9.js`）

- 组件：`components/CoolingWaterMimic.js`（MIMIC）、`components/CoolingWaterController.js`（LDCL 盘）；
  过程模型 `tools/CoolingWaterSolver.js`（`sys.coolingSolver`，在 `consys.js` 每帧 `solve(1/20)`）。
- **控制量 Ctrl = 冷却水旁通阀开度（0~100 %）**：0 % 全经高温淡水冷却器（最冷），100 % 全旁通（最热）；
  TEMP = TC 实测缸套水出口温度。自动方式为"负荷前馈 + PI + 积分分离"，85 ℃ 处灵敏度约 0.3 ℃/%。
- **LDCL 盘部件 id**：`mode-knob` / `mode-knob-ccw`（Automatic / Manual）、`ldcl-state`、
  `temp-auto` `temp-manu` `ctrl-auto` `ctrl-manu`（TEMP / Ctrl 行）、`key-minus` `key-plus` `key-set`、
  `set-minus` `set-plus`、`alarm-reset` `alarm-ack` `lamp-test`。
- **MIMIC 部件 id**：设备 `engine heater distiller cooler tank deaerator`；阀门 `wb-v4 wb-v28s wb-v5
  wb-v25s wb-v27s wb-v6s wb-v7s wb-v8 wb-v9 wb-v502 wb-v12s wb-v13s wb-v15s wb-v26s`；
  冷却泵 `cw1 cw2`（点击起动/停止）及面板按钮 `cw1-start cw1-stop cw2-start cw2-stop`；
  调节阀 `rv-cooler` `rv-bypass`（上半区开大 / 下半区关小）；`mode-knob`（面板方式 MAN→STOP→AUTO）、
  `panel1`（主电源）、`ldcl-mode temp-tag ctrl-tag`、仪表 `tc pt ps gauge`。
- 泵"起动"按钮只会把方式改为 MAN 并运行（再点一次不会停），停止须点"停止"按钮或方式旋钮；工作流里
  起动写 `_clickUntil(... 'cw1-start', p.run && p.mode==='MAN')`。
- 主机保护：两台泵全停或出口压力 < 0.3 bar 持续约 5 s → PS 断开、主机停车，随后缸套水升温触发 A 11。
- 故障走故障界面：`tt-fault` `pump1-fault` `pump2-fault` `valve-stuck` `controller-fault` `tank-leak`。
- **步骤基本形状**：
  - `find`：`{ msg:'第 n 步：识别 xxx。', mode:'find', target:'<compId>', subTarget:'<partId>' }`（说明从简，见下节文字要求）
  - `check`：`{ msg, mode:'check', op:[ { type, target, part, msg, async act(){} }, … ], check(){…} }`
    —— 每个子操作自带 `act()`，逐个“箭头指向 → 立即执行 → 停留观察”；**禁止**把所有动作塞进 `step.act()`。
  - `quiz`：`{ msg, mode:'quiz', quizConfig:{ question, options, answer, analysis } }`，`analysis` 必须讲清原理。
- **op 类型**：`switch`（开关/刀闸/阀门手柄）、`btn`（按钮）、`knob`（旋钮）、`observe`（观察现象）、
  `instrument`（走「选择仪表」界面）、`fault`（走故障设置界面）、`load`、`wire`、
  `page`（切页，仅多页工程用，本工程可用）；接线 op 用 `ports:[端口id…]` 指向端口，不指向组件中心。
- **动作一律模拟真实交互**：优先 `comp.getClickablePartNode(partId).fire('click'/'mousedown'/'mouseup')`，
  让组件自身的点击处理逻辑执行；取不到命中节点时才用组件公开方法（`setManualOverride()`、
  `close()/open()` 等）兜底，**不得直改内部字段**。
- **等待用条件轮询** `_waitFor(sys, cond, timeout, interval)`，不要写死 `sleep(3000)` 猜时间。
- 每个 `check()` 必须与步骤描述的全部验收点一一对应；“按下按钮 → 现象 → 松开后现象消失”的步骤，
  需在 `act()` 里用步骤级标记（如 `this._s8Volt = true`）记录“本轮确实达成过”。

## 操作流程文字：从简，只讲清「做什么」

- 每一步 `msg` 只写**操作对象 + 动作 + 期望现象**，一般 **1 句、不超过约 30 字**；
  不写元件原理、不写教材段落、不写背景铺陈。
- `op.msg` 只写这一下动作（如「按住 SB2」「合上 QF」「红表笔接 A2」），一句话以内。
- `find` 步骤最多补一个简短限定（如「（常开）」「（A1、A2）」），不展开作用与原理。
- `quiz` 的 `analysis` 保留必要解析，1~3 句即可。
- 原理性、系统性内容写进教学文档（`.md`），演示界面不复述。

## 本工程为单页工程（不使用 PageManager）

`project/sys_ljdq8-6.js` 不导出页面定义（导出 `PROJECT_PAGES = []` 以满足 `consys.js` 的具名导入，
长度为 0 时不会创建 `pageMgr`）。画布上只有两台设备，按 1920×1080 基准同屏排布：

| 组件 | id | 位置 / 尺寸 | 说明 |
|---|---|---|---|
| 燃油供油单元 P&ID | `mimic` | (205, 55) 1510×360 | 工艺图：HFO/IDO 柜、三通转换阀、过滤器+SP1/SP2、MF/AF+PDS、FT、立式 MIXING TUBE（LS/PT1、顶部双脱气阀）、CP1/CP2、SH1/SH2、PT2/TT/VT、柴油机；另有蒸汽（蓝）进出系统与疏水阀、空气冷却器 |
| EPC-50B 控制器 | `epc` | (205, 430) 1510×470 | **左右结构**：左为 OP 面板（流程图 520×300 / INFO / 液晶 / −+ENTER / 5 张白卡），右为电机与加热控制箱（按 `电机控制和加热控制.svg` 版式：顶排 5 个选择开关、左侧 2×2 泵盒、右侧调节阀与 AutoFilter 盒） |

- `index.html` 不保留「主页 / 上一页 / 下一页」按钮，`main.js` 的 `actionMap` 不绑定它们。
- 工作流不写 `{ type:'page' }` op。
- 只保留 7 种仪表（`visible:false`）与两台主设备。

> 若要恢复多页（辅锅炉项目）：改回 `project/sys_ljdq8-7.js`（`consys.js:54` 与
> `lib/WorkflowManager.js:4` 两处），并恢复 `index.html` 的导航按钮与 `main.js` 绑定。

## EPC-50B 控制器组件（本工程使用）

- 组件文件：`components/EPC50BController.js`，**左右结构**：
  左 = OP 操作面板（FCM 流程小图 + INFO + 黑底液晶 + −/+/ENTER + 右侧 6 张白卡），
  右 = 油泵与加热控制箱（4 台泵的选择开关与主开关、自动滤器、调节阀 MAN/EPC、DECR/INCR、HEATING TRACING）。
- 过程模型：`tools/FuelSupplySolver.js`（`sys.fuelSolver`），
  详见文件头注释（黏度/温度控制、DO/HFO 转换、泵运行备用、滤器与脱气、参数管理、报警表 6-2-3）。
- 部件 id（工作流 `subTarget` / `part` 一律用这些）：
  - OP 面板：`lcd` `info` `key-minus` `key-plus` `key-enter`
    `fn-start`（START/STOP）`btn-oil`（HFO/DO 转换，单按钮）`fn-process`（PROCESS INFO）`fn-alarm`
    `fn-op`（OP ACTIVE 灯）
  - 卡片灯：`led-start` `led-hfo` `led-do` `led-op` `led-alarm`
    （HFO / DO 两灯按三通转换阀实际位置点亮，按同一只 `btn-oil` 切换）
  - 流程图：`cv` `sp` `af` `ft` `ps1` `tank` `cp` `sh` `ps2` `tt` `vt`
    及指示灯 `led-sp` `led-af` `led-ft` `led-ps1` `led-ls` `led-cp` `led-sh` `led-ps2` `led-tt` `led-vt`
    和 `led-epc-pump`（点击切换 LOCAL / EPC 泵控制权）
  - 控制箱：`sp1-sel` `sp2-sel` `cp1-sel` `cp2-sel` `af-sel`（四/三档选择开关，`xxx-ccw` 逆时针）
    `sp1-main` `sp2-main` `cp1-main` `cp2-main` `af-main`（主开关，`xxx-ccw` 关）
    `aux-sp1` `aux-sp2` `aux-cp1` `aux-cp2` `aux-af` `af-overload`
    `rv-man` `rv-epc`（调节阀 MAN/EPC 白牌）`heat-decr` `heat-incr`（手动增减加热量）`ht` `ht-ccw`（伴行加热 0/1）
- 泵选择开关四档 `MAN / STOP / EPC / REM`（`MAN` 直接起泵，`EPC` 由 Pr1/Pr2 自动控制）；
  自动滤器三档 `MAN / STOP / AUTO`；两/三/四档旋钮到端点不循环。
- **调节阀默认 MAN**（`heater.regMode = 'MAN'`），自动控温前须把 REGULATING VALVE 打到 **EPC**；
  **DECR/INCR 为自复位旋钮**：中位朝上（0°）；**按住**右侧 → 指向 +45°（INCR），
  开度以约 25 %/s 连续增大、SRV 右灯亮；**按住**左侧 → 指向 −45°（DECR），开度连续减小、SRV 左灯亮；
  **松手**旋钮立即回中位，**开度保持**不变。自动演示用 `fire('click')` 时按 5 % 步进（并短暂显示指针方向）。
  **HEATING TRACING 默认 1**（伴行加热投入）。
- **EPC-50B 面板默认带电**（`m.mainPower`/`m.epcPower` 恒为 true，不依赖任何主开关）；
  各泵由自身 MAIN SWITCH 送电后按选择开关运行；**AUTO FILTER 的 MAIN SWITCH 只给自清洗滤器供电**，
  不影响控制器与其他设备。三通转换阀**默认在 DO 位**（`cv = 'DO'`，DO 模式默认温度控制）。
  工艺投入（START）不再受 Fa11 延时，泵按 Fa10 间隔依次起动。
- **`mimic` 的可用部件**：`hfo-tank` `do-tank` `cv` `sp1` `sp2` `afb` `pds` `ft` `pt1`
  `tank` `ls` `dea-valve` `cp1` `cp2` `heater` `pt2` `tt` `vt` `engine` `pcv` `return-valve`。
- **OP 面板流程图**按 `epc50b面板.svg`（1835×857）映射（横向 0.25、纵向 0.32），
  状态灯（`led-*`，共 20 只）与设备状态绑定：

  | 灯 | 点亮条件 |
  |---|---|
  | `led-hfo` / `led-do` | 三通转换阀在上位（HFO→右）/ 在下位（DO→右） |
  | `led-sp1` / `led-sp2` | 对应供油泵运行 |
  | `led-mf` / `led-af` | 滤器主开关 ON 且选择开关在 MAN / AUTO |
  | `led-drain` | 滤器放残（冲洗）动作中 |
  | `led-ft` / `led-ps1` | 供油泵运行且出口压力建立 |
  | `led-ls` | 混合筒液位低于给定（气体多，< 30 %） |
  | `led-dea` | 脱气阀接通回气 |
  | `led-cp1` / `led-cp2` | 对应循环泵运行 |
  | `led-sh` | 加热（蒸汽/电加热）投入 |
  | `led-srv-dec` / `led-srv-inc` | 加热中且蒸汽阀开度 ≤ 40 % / > 40 %（开大） |
  | `led-ps2` `led-tt` `led-vt` | 任一循环泵运行 |
  | `led-epc-pump` | 任一油泵已合主开关且选择开关在 EPC 位 |
- 旧 EPC-50（分油机）组件 `components/EPC50Controller.js`、EPC-60 面板与
  `project/sys_ljdq8-8.js` / `sys_ljdq8-7.js` 均保留，需要时可切回对照教学。

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


## 默认初始状态 + 「启动系统」工况 + 转速检测页超速动作值（本工程当前行为）

### 1. 默认初始状态（冷态：停车待命，未备车）

`AC600Solver.reset()` 与 `Ac600PneumaticSystem` 的初值统一改为「冷态待命」：

| 项目 | 默认值 | 说明 |
|---|---|---|
| 控制位置 | `controlPos = 'LOCAL'` | 控制权在**机旁**（状态条第 3 段 `Local` 红底） |
| 三处车钟 | `leverRpm = { BRIDGE:0, ECR:0, LOCAL:0 }` | 驾控台 / 集控室 / 机旁按键车钟**全部 STOP** |
| 机旁调速手柄 | `localSpeed = 0` | 大表盘指针在 STOP |
| 工况 | `engineMode = 'FWE'` | At Sea / Standby / FWE 中点亮 FWE |
| 主起动阀 | `mainStartValveOk = false`、组件 `_blocked = true` | 气动页「工作」灯灰、「阻塞」灯**红** |
| 空气分配器 | `airDistributorOk = false`、`mv2a.shift = true` | 手动两位两通阀在**右位（切断）** |
| 控制空气 | `controlAirVented = true`、`mv3Parts.b.shift = true` | 40 L 前控制气源阀在**上位（卸放）**，控制空气框显示 **0.0 Bar** |
| 主机 | `rpm = rpmCmd = setp = 0`、`running = false`、`load = 0` | 状态条 `Eng. Not Ready` |
| 备车 | `engineReady = false`、`startBlocked = true` | Engine State 的 `Start Blocked` 红 |

- **冷态不弹报警**：`Ac600PneumaticSystem._blkAlarm` 初值置 **`true`**（"已处理"），
  因此起动阻塞只体现在状态灯 / Engine State / 矩阵红灯上，**报警栏保持空白**；
  只有「先在正常状态、再改为阻塞」的过渡才会产生 `START FAIL/BLOCK, ACTIVE`。
- `_syncStartBlock()` 的 `M.startBlocked` 现在同时考虑
  **`shutDown && !cancelSHD` / `emStopped` / `overspeedTripped`**（超速或安保停车后 Engine State 的
  `Start Blocked` 会正确点亮，不再被气动页每帧刷回 false）。
- 起动联锁增加**控制空气**：`startEngine()` / `_autoStart()` 在 `controlAirVented` 时拒绝起动。

### 2. 工具栏「启动系统」→ 直接进入海上全速运行

`applyStartSystem()` = `_resetRig()`（冷态干净起点）+ `_startEngineRig()`：

```js
async function _startEngineRig(sys) {
    const p = _pneu(sys), M = _ac600(sys);
    if (p) { p.setTwoWay('mv2a', false); p.setThreeWay('b', false); p.setBlock(false); p._syncStartBlock(); }
    if (M && M.startSystem) M.startSystem();      // 控制权驾驶台 + 三处车钟 NAV FULL + 全速运行
    if (sys.coolingSolver && sys.coolingSolver.reset) sys.coolingSolver.reset();   // 高温淡水恢复默认运行
    await _sleep(400);
}
```

点击后状态（实测）：`controlPos = BRIDGE`、`engineMode = SEA`、
`leverRpm = { 68, 68, 68 }`、`localSpeed = 68`、`rpm = 68`、`load = 83.2 %`、`running = true`、
`mainStartValveOk / airDistributorOk = true`、`controlAirVented = false`、`engineReady = true`、
报警栏空；滑油 MIMIC 1# 泵运行、缸套冷却水 85 ℃ / 1# 泵运行 / PS 建立。

相关公开方法：
- `AC600Solver.startSystem()` —— 遥控侧一次性置为海上全速运行工况（清越控 / 报警 / 锁存）；
- `Ac600PneumaticSystem.setTwoWay(key, shift)` —— 程序化设定手动两位两通阀（`toggleTwoWay` 改为调用它）；
- `CoolingWaterSolver.reset()` —— 缸套冷却水模型恢复 `createModel()` 默认正常运行工况。

### 3. 集控台 Safety System → RPM Detector：Overspeed Level 立即动作

`AC600Solver.solve()` 的超速判定现在是**两条并列**：

1. **试验**：`simOn && osTestOn && simRpm > osTestRpm`（原逻辑不变）；
2. **实际超速**：`|rpm| > Overspeed Level`（`overSpeedTest.osLevel`，默认 78 rpm）——
   在转速检测页把动作值改到**低于当前实际转速**即**立即**触发超速保护。

由于动作后主机停车、`rpm` 归零，不能再用"当前转速 > 动作值"判断，因此用 `_osLevelTrip`
**锁存动作那一瞬的实际转速**（`{ rpm, level }`）：

- 触发条件：`lv > 0.5 && !shutDown && !emStopped && |rpm| > lv + 0.05`；
- 解除条件：把 Overspeed Level 调回**动作转速以上**（`_osLevelTrip.rpm <= lv`）或 `reset()` / 越控；
- 动作表现与试验超速完全一致：`overspeedTripped`、燃油切断、`rpm/rpmCmd = 0`、`Engine Tripped`、
  `engineReady = false`、`startBlocked = true`、报警栏 `OVERSPEED SYS.1/2 - SW BACKUP, SHUTDN`，
  页面底部红字提示改为「超速保护动作：实际转速 68.0 rpm 超过 Overspeed Level 60.0 rpm」；
- 故障消失时按既有状态机恢复（已应答→清除、未应答→转 `NORMAL`）。

⚠ 因此**工作流若把 Overspeed Level 调到低于当前转速，会立即停车**；需要主机保持运行时不要改该值。
`_resetOverspeedDemo()` 与 `_startEngineRig()` 都会把它留在 78 rpm。

## 新增故障：曲轴箱油雾浓度高（`crankcase-mist-high`）

`project/sys_dgdq5-1.js` 的 `FAULT_CONFIGS` 现有一项（工具栏「故障设置」里显示为「1. 曲轴箱油雾浓度高 (主机遥控系统)」）：

```js
'crankcase-mist-high': {
    id: 'crankcase-mist-high', name: '曲轴箱油雾浓度高', system: '主机遥控系统', alarm: 'SLOWDN',
    check()   { return !!(_ac600(window.sys) || {}).mistHigh; },
    trigger() { _ac600(window.sys).setCrankcaseMist(true); },
    repair()  { _ac600(window.sys).setCrankcaseMist(false); },
}
```

### 逻辑（`AC600Solver`）

- 新字段 `mistHigh`（+ `_mistSldT` / `_mistPre` / `_mistSld`），`setCrankcaseMist(on)` 注入/清除；
- `solve()` 中：`mistHigh` 为真时**立即预报警**（`sldPreAlarm('ME-MIST')` → 主面板弹
  `SLOW DOWN ACTIVE / SLOWDOWN ALARM / CANCELLABLE`，报警栏 `OIL MIST HIGH IN CRANKCASE, SLOWDN`），
  并按 **`Param. Change → Safety` 的「OIL MIST HIGH IN CRANKCASE」延时**（`delays['sld-mist']`，**默认 6 s**）计时，
  到时 → `safetyAction('SLD', 'ME-MIST')`：`slowDown = true`、`sldCauses['ME-MIST']`、
  报警栏两行 `OIL MIST HIGH IN CRANKCASE, SLOWDN` + `SLOWDOWN ACTIVE, ACTIVE`、`activeLimiter = 'Slow Down'`
  （SETP 压到 40 rpm 按减速度下降）；
- 修复（`mistHigh = false`）→ `safetyClear('SLD','ME-MIST')`：减速原因清除、
  **减速动作照既有规则锁存**（`sldAwaitReset`），需把车钟拉到 40 rpm 以下才解除；
- 与温度类减速一致：**延时内按 Cancel SLD 可暂停本次减速**（`sldCancelled`），松开后重新计时；
- `reset()` / `startSystem()` 均清 `mistHigh`，因此「启动系统」/「重置系统」后故障自动消失。

### 面板表现

- `Ac600ConsolePanel._sldItems()` 的 `mist` 行（`OIL MIST HIGH IN CRANKCASE`，带 Active + Cancelled + Loop fail 灯）
  已接 `M.sldCauses['ME-MIST']`：动作时红色 `SLOWDN` + `AL. CLOSE`，应答后转黄；
- Slow Down 菜单灯随之点亮；`sldCauses` 非空时 EICU A/B 组不再跟随点亮；
- `SAFETY_TEXT['ME-MIST'] = 'OIL MIST HIGH IN CRANKCASE'`（报警栏文字）。

## 新增第 5 页：主机 ME 气缸与辅助系统（`components/MeEngineMimic.js`，id `me-mimic`）

**工程默认进入第 1 页**（`consys.js` 的 `pageMgr.navigateTo(1)`，AC 600 驾控台；如需默认停在新页把 1 改成 5）。新增的第 5 页插在气动操纵系统之后，原来第 5 页起的页面整体后移一位：

| 页 | 内容 |
|---|---|
| 4 | 主机气动操纵系统（`ac600-pneumatic`） |
| **5** | **主机 ME 气缸与辅助系统（`me-mimic`，新）** |
| 6 | 现场总线型主机遥控系统（`ac600-mimic`，原 5） |
| 7 | 报警系统主界面（原 6） |
| 8 | 延伸报警单元（原 7） |
| 9 | 现场总线型监视报警系统（原 8） |
| 10 | 轮机员安全系统（原 9） |
| 11 | 主机滑油系统（原 10） |
| 12 | 主机缸套冷却水温度控制系统（原 11） |

- 联动改动：`PROJECT_PAGES`、`componentConfigs` 的 `page`、工作流里"第 10 页（主机滑油系统）"→ 第 11 页、
  `KChiefConsole` 工艺流程图 `parts: ['page-5']` → `'page-11'`。
- **组件尺寸 1560 × 828**，底图 `images/me_engine.png`（1736 × 1028）等比 contain；
  所有叠加件按**图片像素**锚定（`mx()/my()`），改尺寸只改 `W/H`。

### 叠加件

| 部件 id | 说明 |
|---|---|
| `indicator-valve` | **示功阀**：手动截止阀画法（两三角 + 阀杆 + 手轮），点击开/关；开＝两三角填充绿，关＝**完全透明**（组件不再加白底遮罩）。⚠ **原图的蝶阀符号、虚线手柄和「示功阀」标注已在图片文件本身擦除**（`images/me_engine.png`；**重新编码时保留了原图的 sRGB / gAMA / pHYs 辅助块**，否则整幅图颜色会偏；原图备份 `images/me_engine.orig.png`）。不显示「开/关」动态标签，只保留阀下方「示功阀」名称 |
| `start-valve` | **缸头起动阀**：与原图阀**完全重合、同尺寸**（顶点 (442,256)、半长 17 / 半高 10.5 图片像素，两三角交点左移 2.5 px、左右对称）；原图阀芯与上方小方框已遮掉，改由本页绘制：**线圈**（13 × 9.5，位于原方框位置、上移 3 / 左移 2 px，得电红填充）+ **线圈到两三角交点的连线**；与气动操纵系统页 **1 号起动电磁阀 `cv1-pilot` 同步**（`M.airValveOpen` 期间间歇得电）：得电→两三角绿填充 + 线圈红 |
| `blower` | **辅助鼓风机**：圆心/外径与原图风机一致（图片 (308,675)、R=39 px），**5 片弧形叶片**（`Konva.Shape` sceneFunc 画内外弧带，72° 对称），运行时旋转 |
| `hps-ctrl` / `hps-master` | 液压动力泵：左上 `Ctrl` = **机带泵**、右上 `Master` = **电动机带动**；原图 "50%"/"Stopped" 徽标被覆盖，改为显示 **运行 / 停止** |
| `scav-box` | 扫气箱（压力测点位置） |
| 控制盒 | `bl-power` `bl-mode` `bl-start` `bl-stop`、`hp-power` `hp-mode` `hp-start` `hp-stop`；两盒宽 **330 / 352**，左边缘锚定机身右侧 `mx(921)`。每盒：一排 4 只指示灯（r=**14.5**；**电源 / 运行 / 过载 / 压力正常**）+ 两只**转换开关**（电源 OFF/ON、本地/遥控；**旋钮 r=25**、档位名标在**左上/右上**、名称「电源」「控制方式」在**旋钮下方**、**无动态状态文字**）+ **起动 / 停止 圆形按钮**（彩色 r=22.5 + **白色外框环 r=26**）；盒脚显示**扫气压力 MPa** / **液压油 MPa**（内部 `hydOil` 为 bar，显示时 ÷10 保留 1 位小数，如 280 bar → 28.0 MPa） |

### 逻辑（`AC600Solver._stepAuxMachines(dt)`）

- 新字段：`blowerPower/blowerMode/blowerRun/blowerCmdRun/blowerOverload`、
  `hpsPower/hpsMode/hpsRun/hpsCmdRun/hpsOverload`、`engPumpOk`、`scavOkPress`；
  方法：`setBlowerPower/toggleBlowerPower/setBlowerMode/toggleBlowerMode/blowerStart/blowerStop`
  与 `setHpsPower/toggleHpsPower/setHpsMode/toggleHpsMode/hpsStart/hpsStop`。
- **扫气箱压力 `scavPressMPa`（MPa）** = **增压器**（每增加 10 转 +0.02 MPa，即 `0.002 × |rpm|`）
  + **辅助鼓风机**（运行 **0.04** / 停止 **0.001**）。例：主机停车 + 鼓风机停 → 0.001；只有鼓风机 → 0.040；
  20 rpm + 鼓风机 → 0.080；40 rpm（鼓风机已停）→ 0.081。**`scavOkPress = scavPressMPa > 0.03`**（「压力正常」灯）。
  ⚠ `AC600Solver.scavAir`（bar，0.02~2.4）仍保留给 Limiters 页的 Scavenge air pressure 显示，与本页是两套量纲。
- **辅助鼓风机**：电源 OFF → 停；**遥控** → 按扫气箱压力自动起停：**低于 0.03 MPa 自动起动**、
  **大于 0.08 MPa 自动停止**（回差防抖，对应主机约 15 rpm 以下重启 / 20 rpm 以上停）；
  **本地** → 按起动/停止按钮；本地强行运行且压力已 > 0.08 MPa → **过载保护**（停鼓风机 + 过载灯）。
- **指示灯配色**（`LAMP_STYLE`）：电源 **灰→白**、运行 **暗绿→亮绿**、过载 **暗红→亮红**、压力正常 **暗黄→亮黄**；
  泵徽标：**停止＝蓝底 `#32508c` / 运行＝亮绿底 `#2ecc40`**（文字「停止 / 运行」）。
- 两只控制盒整体比机身右侧锚点**再左移 35 px**（`_layout()` 里 `mx(921) - 35`）。
- **液压动力泵**：机带泵 `Ctrl` 在 **|rpm| > 20** 时压力足够（`engPumpOk`）；**遥控**方式下电动泵
  `hpsRun = !engPumpOk`（主机停止时提供动力、20 rpm 以上自动停止）；本地方式手动起停，
  机带泵已建压仍强行起电动泵 → **过载保护**。
- **液压油压力**：机带泵或电动泵任一运行 → 280 bar，都停止则按 2.5 s 时间常数衰减（`M.hydOil`）；
  机旁面板的液压油表随之变化。
- `M.auxBlower = blowerRun`（机旁面板矩阵「辅助鼓风机运行」）、`M.auxBlowerAlarm = blowerOverload`；
  `reset()` / `startSystem()` 把两台电机控制盒复位为「电源 ON + 遥控」。
- 左上角标题：文字「ME主机气缸」，`x = 88, y = 4`、字号 **20**。
- 示功阀 / 缸头起动阀 / 叶轮 / 徽标 / 控制盒的位置都按**图片像素**锚定（`A.iv` 等常量 + `mx()/my()`），
  微调位置只改这些常量（1 屏幕像素 ≈ 1/0.8054 ≈ 1.24 图片像素）。

## 工作流「1. 主机的起动功能测试」（`main-start-test`，7 步）

本工程现有 **4 条工作流**（编号连续）：

| 编号 | id | 名称 | 步数 |
|---|---|---|---|
| 1 | `main-start-test` | 主机的起动功能测试 | 7 |
| 2 | `speed-test` | 主机的调速功能测试 | 11 |
| 3 | `overspeed-test` | 主机超速保护实验 | 6 |
| 4 | `auto-stop-reset` | 主机滑油低压保护模拟实验 | 6 |
| 5 | `mist-sld-test` | 主机曲轴箱油雾浓度高保护实验 | 5 |

> 「主机安全保护装置的使用操作（`safety-use`）」工作流**已按要求删除**；
> Safety System 相关辅助函数（`_resetSafetyDemo` `_safSelIs` `_safIsCancelled` `_allSafCancelled`
> `_SHD_CANCEL_KEYS` `_SLD_CANCEL_KEYS`）仍保留在项目文件里，需要时可据此重建该流程。

| 步 | 内容 | check() 判据 |
|---|---|---|
| 1 | 驾控台点 **Engine State** 看主机状态（演示前复位：停稳主机、清停机与报警，并把控制权放回**机旁**） | `_directPage==='estate' && M.isStopped` |
| 2 | 气动页：主起动阀「工作」、空气分配器工作位、控制气源阀下位（接通控制空气） | `mainStartValveOk && airDistributorOk && !controlAirVented` |
| 3 | 机旁起动开关打「**慢转**」→ 转速 >3 rpm → 打回「自动」 | `startKnob==='AUTO' && (标记 slowTurned 或 rpm>3)` |
| 4 | 机旁起动开关打「**冲车**」→ 转速 >10 rpm（约 20）→ 打回「自动」 | `startKnob==='AUTO' && (标记 blowed 或 rpm>10)` |
| 5 | ME 主机页：鼓风机运行、HPS 泵运行、扫气 0.040 MPa、液压 28.0 MPa → **关闭示功阀** | `blowerRun && hpsRun && scavOkPress && hydOil≥100 && !_ivOpen` |
| 6 | 机旁调速手柄推**正向慢速 27 rpm** 试车 → 回 STOP | `abs(localSpeed)<1 && abs(rpmCmd)<1 && (标记 s6 或 rpm>15)` |
| 7 | 机旁调速手柄推**反向慢速 −27 rpm**（倒车）试车 → 回 STOP | `abs(localSpeed)<1 && abs(rpmCmd)<1 && (标记 s7 或 rpm<−15)` |

要点：

- **不再演示「控制权强制获取」** —— 本工程默认工况控制权就在机旁；第 1 步复位末尾也会把控制权放回机旁
  （`_resetStartDemo()` 内 `setControlPos('LOCAL')`）。机旁起动旋钮与调速手柄都要**机旁控制**才输出。
- 新增辅助函数（`project/sys_dgdq5-1.js`）：
  - `_clickUntil(sys, compId, partId, cond)`：**条件未成立才点**，避免把两态开关点过头；
  - `_clickPartAt(sys, compId, partId, 'left'|'right')`：在部件左/右半区派发**带坐标的真实鼠标事件**——
    三档旋钮（BLOW/AUTO/SLOW）靠指针位置判方向，合成 `fire('click')` 无指针只会顺时针；
  - `_clickKnobTo(sys, compId, partId, 'BLOW'|'AUTO'|'SLOW')`：按左右半区点到位，连点无效再 `setStartKnob()` 兜底；
  - `_resetStartDemo(sys)` / `_ensureEngineStopped(sys)`：清停机/报警/超速/慢降锁存并把主机停稳。
- ⚠ **画布坐标换算**：`_clickPartAt` / `_dragLocalDialTo` / `_dragTelegraphTo` 派发鼠标事件时，
  client 坐标必须按 `rect.width / stage.width()` 换算（容器被 CSS 缩小时，直接把舞台坐标当 client 坐标会指偏、拖不动）。
  另外**窗口小于 1920×1080 时舞台会被裁小**（stage 尺寸 = 窗口），下半部分部件（如机旁大表盘）落在舞台外无法命中，
  演示与自动化测试请用 1920×1080 视口。
