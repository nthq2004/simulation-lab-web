# 分油机自动控制系统的功能测试

基于 Konva.js 的 **船舶 S 936 型分油机 + Alfa Laval EPC-50 控制器** 自动控制仿真教学工程。

EPC-50 是 Alfa Laval 为 S / P 型分油机配套的电子程序控制器（1999 推出，2010 停产，
现由 EPC-70 取代）。本工程把 **EPC-50 操作面板（OP）** 与 **电机起动控制箱** 合并为一个仿真组件
`components/EPC50Controller.js`，控制逻辑参照后继机型 **EPC-60**（`tools/PurifierSolver.js`），
用 Ti 定时器驱动排渣 / 放残 / 密封 / 水封 / 进油 / 分油等全部分离程序。

## 画布（单页工程）

本工程为**单页工程**：不导出 `PROJECT_PAGES`，`consys.js` 不创建 `PageManager`，
工具栏无「主页 / 上一页 / 下一页」按钮，工作流中也没有切页 op。

| 组件 | id | 说明 |
|---|---|---|
| EPC-50 控制器 | `epc` | 650×760，`x:90, y:150` —— OP 操作面板 + 电机起动控制箱 |
| 分油机系统模拟图 | `mimic` | 1060×760，`x:820, y:150` —— 与控制器**等高并列** |

> 原「分油机运行状态仪」「S 型分油机系统流程」「机旁控制箱」三台组件本工程不再使用
> （组件文件 `PurifierStatusPanel.js` / `PurifierSystem.js` / `PurifierLocalPanel.js`
> 与 `export.js` 导出均保留，需要时可另行启用）。

7 种仪表默认隐藏，由工具栏「选择仪表」调出（万用表、指针万用表、示波器、信号发生器、
过程校验仪、数字功率计、兆欧表）。

## EPC-50 控制器（`epc`）

一个组件内含上下两台设备：

- **上部 OP 操作面板**：左上为 P&ID 流程图（供油泵、滤器/加热器、TT/PT、三通阀 V1 与回油支路、
  分离机剖面与皮带轮、MT/PT4、净油出口阀 V4、工作水阀组 16/15/10，上方一排圆形指示泡：
  执行组件运行时亮绿、传感器仅故障时红）；
  左下 INFO 信息区、黑底红字液晶显示器、−/+/ENTER 三只软键；
  右侧按钮区为 5 个白色圆角分组框（HEATER / SEPARATION+STOP / DISCHARGE / OP ACTIVE / ALARM）。
- **下部电机起动控制箱**：START/STOP FEED PUMP、START/STOP MOTOR、MOTOR CURRENT 电流表、
  SEPARATOR MODE（三档：左 60° CIP / 垂直向上 MAN / 右 60° AUT）、POWER SWITCH（OFF/ON）、
  BUZZER 蜂鸣器、EMCY STOP 应急停止。

### 控制逻辑

| SEPARATOR MODE | 位置 | 控制权 | 可用操作 |
|---|---|---|---|
| CIP | 左 60° | 无 | 清洗位（本仿真不实现 CIP 程序），系统停止、控制指令不响应 |
| MAN | 垂直向上 | 机旁手动 | 起动箱四只按钮 + OP 的 HEATER / SEPARATION / DISCHARGE / ALARM |
| AUT | 右 60° | 自动 | OP 功能键（SEPARATION 起动前先答三问）；起动箱按钮无效 |

### 手动操作时序（MAN）

```
① POWER SWITCH 合闸 ON → 面板正常（无报警）时 OP ACTIVE 灯亮，液晶显示 Standst
② 起动箱 START FEED PUMP 起供油泵 → 按按钮区 HEATER 投入加热器（进油温度升到 ≥96 ℃）
③ 按 SEPARATION 键 → 分离指示灯闪烁，液晶依次提出三问（＋ = YES，− = NO）：
     Bowl dismantled? → Assembled per manual? → Bowl cleaned?
     · 第 1 问答 NO（未拆检）→ 显示 Start Separator
     · 第 1 答 YES 且第 2、3 问均答 YES → 同样显示 Start Separator
     · 拆检后「按手册装配 / 已清洗」答 NO → 需校准起动（本仿真不实现），返回 Standst
④ 屏幕显示 Start Separator 之前，起动箱 START MOTOR **按下无效**；
   显示后才能起动机电 → 左上角交替显示转速 / Wait!（右下角固定显示 MOTOR ACCELERATING）
   → 转速升到 10000 r/min 以上显示 Standby
⑤ 再按 SEPARATION → 分离指示灯常亮，程序自 Ti60 开始：
     Ti60 排渣 → Ti61 → Ti62 关闭分离筒 → Ti63 建立水封 → Ti64~Ti67 → Ti68 正常分油
⑥ Ti68 期间液晶显示分油倒计时「68= xx」（xx = 距下次排渣的分钟数）；
   倒计时到 → 阶段四排渣 Ti70~Ti75 → 返回 Ti62 循环执行
⑦ 分油中按 DISCHARGE → 执行同样的排渣程序，排渣后返回 Ti62
⑧ 分油中按 SEPARATION → 先排渣 Ti70~Ti75，再执行手动停机 Ti81~Ti83，回到 Standby
   （电机继续运行，需要停电机时按起动箱 STOP MOTOR）
```

### 自动操作时序（AUT）

```
① POWER SWITCH 合闸、SEPARATOR MODE 打到 AUT → 液晶显示 Standst（此时尚未起动）
② 按 SEPARATION → 液晶依次提出三问（＋ = YES，− = NO）：
     Bowl dismantled? → Assembled per manual? → Bowl cleaned?
     · 第 1 问答 NO（未拆检）→ 立即自动从 Ti50 开始执行
     · 第 1 答 YES 且第 2、3 问均答 YES → 同样自动从 Ti50 开始执行
     · 拆检后「按手册装配 / 已清洗」答 NO → 需校准起动（本仿真不实现），返回 Standst
③ 自动程序：Ti50 供油泵 → Ti51 进油压力 → Ti52 电机（≥10000 r/min）→ Ti53 加热器（≥96 ℃）
     → Ti55 回流待命 → Ti56~Ti61 → **Ti62 起分离指示灯由闪烁转为常亮**
     → Ti63 水封 → Ti64~Ti67 进油/含水检查/检漏 → Ti68 稳定分油
④ Ti68 期间液晶显示「68= xx」分油倒计时；到点自动排渣 Ti70~Ti75 → 返回 Ti62 循环执行
⑤ 分油中按 SEPARATION（自动方式）：排渣 Ti70~Ti75 → 停机 Ti81~Ti83 → 自动停机 Ti85~Ti89，回到 Standst
⑥ 手动排渣 DISCHARGE（排渣后回 Ti62）；报警复位 ALARM 或蜂鸣器；应急停止 EMCY STOP
```

- **停止**：分油中按 SEPARATION → 阶段四排渣 → 阶段五置换密封 → 阶段六自动停机 → Standst。
- **手动排渣**：DISCHARGE；**报警复位**：ALARM 或点蜂鸣器；**应急停止**：EMCY STOP。

## 操作项目（工具栏任务下拉框）

| 项目 | 内容 |
|---|---|
| 1. 分油机系统的认识 | 系统模拟图的 SV1/V1/SV4/V5/SV10/SV15/SV16、PT1/PT4/PT5/TT1/MT/ST 与分离原理 |
| 2. EPC-50 控制器的认识 | 逐件识别 OP 面板与电机起动控制箱上的 36 个可点击部件 |
| 3. 分油机的起动和停机 | 模拟图上开阀上气 → 上电 → 远程接管 → 五步起动 → 手动排渣 → 停机 |
| 4. 分油机故障的处理 | 注入密封失效、传感器故障、温度低等故障并按报警提示处理复位 |

> 全部按最新范式编写：`mode:'check'` 的每步都用 `op` 数组、每个子操作自带 `act()`，
> 演示引擎逐个执行「**闪烁箭头指向目标 → 立即执行 → 停留观察**」；
> 操作一律**模拟真实点击**（`getClickablePartNode(id).fire('click')`）触发组件自身处理逻辑。

## 操作要点

- **默认不接线**：初始化后画布无预接线；只有「自动接线」「起动系统」或工作流 op 才动作。
- **起动系统**：复位后快速进入分离运行（教学快捷）。
- **5 点步进**：停止 → 起动升速 → 水封/待命 → 正常分油 → 排渣。
- **工具栏**：撤销 / 恢复 / 自动接线 / 起动系统 / 5点步进 / 故障设置 / 重置系统 / 任务选择 /
  自动演示 / 单步演示 / 演练 / 评估 / 选择仪表。

## 故障

七种故障可在「故障设置」中注入：分离筒密封失效（跑油）、水分传感器故障、分油温度低、
分油机振动高、排渣失败、工作水压力低、分油机电机过载。

## 教学文档

`分油机自动控制系统的功能测试.md`（配图见 `docs-img/`，统一前缀 `purifier-epc50-`）。
