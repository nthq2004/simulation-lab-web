# 电源电路仿真

基于 Konva.js 的**单相直流稳压电源**仿真，用于教学中的**"变压 → 整流 → 滤波 → 稳压"四级环节认知与仪表检测**训练。
画布上是一条完整的电源电路：交流电源 AC 220 V、熔断器 FU、控制变压器 T（220 V/12 V）、
整流桥 VD1~VD4、滤波电容 C1（47 µF）、三端稳压器 7805、输出电容 C2（22 µF）、负载 RL（200 Ω）。
工具栏「选择仪表」可调出三路示波器、数字万用表、指针式万用表、手摇兆欧表等 7 种仪表。

## 页面（单页工程）

本工程为**单页工程**：全部元件同屏显示，不使用页面索引与翻页（无 `PROJECT_PAGES` / `PageManager`）。

| 区域 | 内容 |
|---|---|
| 上部（y 110~450） | 主电路：`ac` → `fu` → `tr` → 整流桥 `d1~d4` → `c1` → `reg`(7805) → `c2` → `rl`，两处接地 `gnd1`/`gnd2` |
| 下部（y 470~1050） | 7 种仪表停靠区（默认隐藏）：示波器与数字万用表左右并排，互不遮挡，也不被右侧「操作流程」面板挡住 |

## 操作项目（工具栏任务下拉框）

| 项目 | 内容 |
|---|---|
| 1. 识别电源电路中的元器件 | 5 个 `find` 步骤：控制变压器 → 整流二极管 → 三端稳压器 → 滤波电容 → 负载电阻，另加 2 道测试题（四个环节、二极管作用） |
| 2. 电源电路工作过程分析 | 8 步：自动接线并合闸 → 示波器 CH1/CH2 测原边/副边 → CH3 测滤波电容 → 数字万用表 DCV 20 测负载 → 填输出电压 → 把电源改 240 V → 把负载改 300 Ω → 测试题 |

> 第 2 个项目全部按最新范式编写：`mode:'check'` 的每步都用 `op` 数组、每个子操作自带 `act()`，
> 演示引擎逐个子操作执行"**闪烁箭头指向目标 → 立即执行 → 停留观察**"：
> 选择仪表走「选择仪表」界面（`op.type='instrument'`）、探头/表笔逐根动画接线（约 3 s/根）、
> 示波器档位按 CHx 档按钮自动调到"峰值约占 4 格"、参数修改走**参数配置界面**（弹框 → 填值 → 真正点击「保存」）。

## 操作

- **手动操作**：工具栏「自动接线」接好主电路 → 点交流电源面板上的「电源」键合闸 →「选择仪表」调出仪表 →
  转动万用表旋钮选档 / 按示波器 CHx 档按钮调档 → 点击端口接线 → 读数。
  右键任意元件 →「参数设置」可改电压、频率、容量、阻值等。
- **工具栏**：撤销 / 恢复 / 自动接线 / 起动系统 / 5点步进 / 故障设置 / 重置系统 / 任务选择 /
  自动演示 / 单步演示 / 演练 / 评估 / 选择仪表。本工程 `FAULT_CONFIGS` 为空，故障列表为空白；
  `fiveStep` 为空实现，点「5点步进」不产生动作。
- **默认不接线**：`applyAllPresets({ init: true })` 直接返回，初始化后画布无任何预接线；
  只有「自动接线」「起动系统」或工作流才会接线（主电路 19 根导线，> 8 根，允许瞬时接线）。

## 实现要点

- `project/sys_ljdq2-2-1.js`：组件布局（`componentConfigs`）、工作流（`PROJECT_WORKFLOWS`）、
  接线与演示辅助函数。
- 工作流辅助：`_wire()` 动画接线、`_wired()` / `_touches()` 判线、`_powerOn()` 模拟按电源键、
  `_oscScale()` / `_oscAutoRange()` 示波器调档、`_demoSetCfg()` 走配置界面改参数（含"保存后仍不生效"兜底）。
- 动作一律**模拟真实交互**：`getClickablePartNode(partId).fire('mousedown'/'click')`，不直接改内部字段。
  为此组件补了两处定位/命中接口：`ACPower.getClickablePartNode('power')`（电源键）、
  `Oscilloscope_tri` 的 `ch1-scale`/`ch2-scale`/`ch3-scale`/`timebase`/`clear`/`trigger` 面板按钮。
- 部件坐标按"本地坐标 + 绝对变换"换算（`ACPower.getClickablePartCenter` 已改为 `getAbsoluteTransform().point()`），
  组件旋转/缩放后箭头仍指得准。
- 7 种保留仪表：`Multimeter`（`multimeter`）、`MF47Multimeter`（`mf47-panel`）、`RealMegohmMeter`（`megohm`）、
  `Oscilloscope_tri`（`osc`）、`SignalGenerator`（`sg`）、`ProcessCalibrator`（`cali`）、`ElecMeter`（`elecmeter`），全部 `visible: false`。

## 开发

```bash
pnpm run dev      # Vite 开发服务器
pnpm run build    # 标准构建 → dist/
pnpm run one      # 单文件 HTML → dist-one/
```

## 教学文档

- [电源电路仿真.md](电源电路仿真.md)（配图见 `docs-img/`，前缀 `power-supply-`）
