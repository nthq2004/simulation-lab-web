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

## 本工程：掌握船舶机舱监视报警系统的使用（`project/sys_ljdq10-4.js`）

**多页工程（2 页）**，原型为 Kongsberg **K-Chief 600** 机舱监视报警系统。

| 组件 | id | 尺寸 | 页 | 说明 |
|---|---|---|---|---|
| 报警系统主界面（操作站 OS） | `kchief` | 1620 × 850 | 1 | 窗体标题栏 / 工具栏（ROS 节点、时钟、Command control、值班状态框、未确认报警计数、报警图标、确认 ACK、消音、蜂鸣器）/ 左列 **UnDock 报警组列表** / 船舶剪影 / 表格视图 / 工艺流程图入口 / 趋势 / 自定义视图 |
| 现场总线型系统结构图 | `topo` | 1340 × 860 | 3 | K-Chief 600 现场总线型拓扑（纯静态结构图）：住舱/驾驶台（WCU×2、OS、WBU、OS）→ 集控室（OS/SGW×2、Printer、UPS、CAN Bus 3 / Ethernet 1·2）→ 机舱（CAN Bus 1·2、dPSC：RDi-32 / RDo-16 / RAi-16 / RAo-8 / RAi-10tc / RIO-C4、LOS、MOS）。部件 id：`wcu-1` `wcu-2` `os-cabin` `wbu` `os-bridge` `os-sgw-1` `printer` `ups` `os-sgw-2` `can1` `can2` `can3` `eth1` `eth2` `dp-rdi1` `dp-rdi2` `dp-rdo` `dp-rai1` `dpsc` `dp-rai2` `dp-rao` `dp-rai10` `los` `mos` `rio` |
| 轮机员安全系统面板 | `deadman` | 1860 × 900 | 4 | 轮机员安全系统（Dead Man）三块面板：左＝机舱入口甲板上层左、中＝集控室操作面板、右＝机舱入口甲板上层右。中面板：系统运行灯 / 关\|开 自复位旋钮 / 复位 / 蜂鸣器 / 时间设置；左右面板：绿色指示灯 + 旋钮 + 4 块复位按钮板。部件 id：`ecr-switch-left` `ecr-switch-right` `ecr-reset` `ecr-time` `ecr-buzz`、`left-switch-left` `left-switch-right` `left-reset-1..4`、`right-…`（同左）。逻辑见 `components/DeadmanPanel.js` 头部注释：旋钮按住右半→开、左半→关（松手回中位，系统状态保持）；预警时间内按任意复位按钮清零；超预警时间机舱蜂鸣器闪；超「预警+报警时间」→ `sys.kchief.setDeadman(true)` 触发 A 级 DEADMAN 报警（MISC 组），驾驶台与轮机长面板显示红色 DEADMAN + 扬声器（只能由安全系统复位按钮清除，主站 ACK 只消闪）。时间设置对话框为 DOM 非模态，`#deadman_time_dlg`，必须点右上角 `#dm-close` 才关闭；预警最小 1 min、报警最小 0 min |
| 延伸报警单元 | `extunit` | 1569 × 810 | 2 | 3 列 × 2 行共 6 块值班面板（K-Chief 版式，标题牌岗位名 14px / （值班面板）12px），每块有 **Home / Alarms / Settings 三页**（状态栏按钮切换，激活页按钮变绿）：Home＝驾驶台：On Watch（BRIDGE 白 / ECR 绿，各 190 宽）+ Duty + 岗位名（左对齐 26px，**未指定值班时留空**）+ Call All/Call Duty Engineer（始终显示）；
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
- **工作流**：原有 4 条流程与教学文档已按要求删除，现为重新编写的第一条：
  `alarm-basic`「1. 机舱监视与报警系统的认识」（9 步：`find` 当前报警 → 3 个 `check`
  「打开某列表页 → 点「主页」回 Home → 识别下一个入口」（判据用 `kchief._visited` 记录曾打开的页型
  `alarms` / `history` / `tags` / `inhibit`）→ `find` 确认 ACK → `find` 趋势 1 → `check` 回 Home 识别自定义视图 1
  （判据 `_visited` 含 `trend`）→ `quiz` 失职报警）。
  第二条 `alarm-network`「2. 机舱监视与报警系统的网络结构」（8 步，全部在第 3 页 `topo` 上：
  `page` op 切页 + 识别主 ROS `os-sgw-2` → `quiz` 网络结构 → 数字量采集 DPU `dp-rdi1/dp-rdi2`（任点其一，
  判据 `lastClickedPartId`）→ `find` 模拟量输出 `dp-rao` → `find` 机旁操作站 `los` → 住舱 WCU
  `wcu-1/wcu-2`（任点其一）→ `find` 驾驶台 `wbu` → `quiz` 值班召唤走 CAN Bus 3）。
  第三条 `param-query`「3. 查询和修改参数」（5 步）：点击报警组 `dock-ME-LO`（判据 `overlayKind==='group' && _groupFilter==='ME-LO'`）
  → `fill` 填 ME-LO-P 的报警类型（模拟量报警）/ 报警方式（下限报警）/ 当前报警限（0.25 MPa，数值+容差）
  → `fill` 填 ME-LO-PR-SW 的报警类型（开关量报警）→ `check` 双击行改 ME-LO-P 下限 0.22、死区 0.06 并保存
  → `check` 双击行改 ME-LO-PR-SW 延时 3 s 并保存；辅助函数 `_openParamByTag(sys, tagId)` 在列表里按测点 id
  找行号并 `fire('dblclick')` 打开参数界面（找不到行时用 `openParam()` 兜底）。
- **故障**（均走「故障设置」界面）：`me-lo-press`、`me-cw-temp`、`blg-high`（模拟量），
  以及两个**开关量**故障 —— `lo-pr-sw`（滑油低压开关触点误闭合 → `ME-LO-PR-SW` 动作，
  5 s 安保延时后主机 SHD 停车）、`lo-pump-f`（主滑油泵故障 → `ME-LO-PUMP-F` 动作；
  MIMIC 联动：运行泵置 `overload` 跳闸、备用泵自动投入，修复后过载标志清除、备泵续转）。

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

