# 船舶机舱系统数字孪生架构设计

## 概述

基于现有 Konva.js 工业仿真教学平台，扩展构建船舶机舱数字孪生系统。采用**分层架构（2D Konva + 3D Three.js 混合渲染）**，通过事件总线解耦，分四个阶段迭代交付。

---

## 1. 整体架构

### 三层结构

```
┌──────────────────────────────────────────────────────────────────┐
│  🖥️ 表示层 (Presentation Layer)                                   │
│  ┌─ Konva 2D Canvas ─────────────────────┐                       │
│  │  • 系统原理图 (P&ID 风格)              │  ← 完全复用现有平台     │
│  │  • 设备符号 / 管路 / 仪表              │                       │
│  │  • 现有组件 + 新建船舶专用组件          │                       │
│  └────────────────────────────────────────┘                       │
│  ┌─ Three.js 3D Scene ────────────────────┐                       │
│  │  • 机舱空间布局 (多层甲板)              │  ← 新建模块           │
│  │  • 设备 3D 模型 (LOD 分级)             │                       │
│  │  • 第一/三人称漫游 / 俯视              │                       │
│  │  • 设备状态可视化 (颜色/粒子/标注)     │                       │
│  └────────────────────────────────────────┘                       │
└──────────────────────────────────┬───────────────────────────────┘
                                   │
┌──────────────────────────────────▼───────────────────────────────┐
│  🔌 事件总线 (Event Bus)                                          │
│  发布-订阅模式，9 个标准频道，2D↔3D 双向同步                       │
└──────────────────────────────────┬───────────────────────────────┘
                                   │
┌──────────────────────────────────▼───────────────────────────────┐
│  🧠 数字孪生层 (Digital Twin Layer)                               │
│  ┌─ 设备对象池 ───────────────────────────────────────────────┐   │
│  │  Equipment{ id, type, konvaRef, threeRef, sensors, state } │   │
│  ├─ 物理仿真引擎 ─────────────────────────────────────────────┤   │
│  │  CircuitSolver (电站电气)  ← 复用                            │   │
│  │  PneumaticSolver (管路)     ← 复用 + 扩展多介质              │   │
│  │  MCS51Solver (PLC/控制器)   ← 复用                          │   │
│  │  新增: ThermalSolver (热力)  → 主机/换热器热力计算           │   │
│  ├─ 状态管理器 ────────────────────────────────────────────────┤   │
│  │  统一状态树: { pressure, temp, flow, level, speed, ... }   │   │
│  ├─ 场景管理器 ────────────────────────────────────────────────┤   │
│  │  工况场景: 正常航行 / 备车 / 应急 / 故障                     │   │
│  └─ 教学流程引擎 ──────────────────────────────────────────────┘   │
│     Workflow.js  ← 完全复用，定义船舶操作流程                      │
└──────────────────────────────────┬───────────────────────────────┘
                                   │
┌──────────────────────────────────▼───────────────────────────────┐
│  📊 数据层 (Data Layer)                                          │
│  设备参数配置 (JSON) / 3D 模型资产 (glTF/GLB) /                    │
│  教学大纲 / 故障库 / 运行日志                                     │
└──────────────────────────────────────────────────────────────────┘
```

### 模块复用与新建清单

**复用模块（零改动）：** ControlSystem、BaseComponent、CircuitSolver(MNA)、PneumaticSolver、DigitalSolver、MCS51Solver、Workflow、Show、ConnectionManager、Renderer、CAN/Modbus 通信

**新建模块：** Three.js 3D 场景管理器、3D 设备模型组件库、事件总线 (EventBus)、船舶专用 Konva 组件、ThermalSolver 热力求解器、多介质管路扩展、数字孪生设备对象池、工况/故障场景编辑器

---

## 2. 3D 模块设计 (Three.js)

### 目录结构

```
engineroom3d/
├── EngineRoom3D.js          # 主控: 场景/相机/渲染器/动画循环
├── models/
│   ├── ModelLoader.js       # glTF/GLB 加载器 (DRACO 压缩)
│   ├── ModelRegistry.js     # 模型注册表 (type → mesh factory)
│   └── primitives/          # 基础几何体工厂 (无外部模型时使用)
│       ├── DieselEngine.js / Generator.js / Pump.js
│       ├── Compressor.js / HeatExchanger.js / Pipe3D.js / Tank.js
├── controls/
│   ├── OrbitControl.js      # 俯视旋转 (鸟瞰)
│   ├── WalkControl.js       # 第一人称漫游
│   └── CameraManager.js     # 视角切换 / 自动聚焦
├── visualization/
│   ├── StateColors.js       # 设备状态→颜色映射
│   ├── FlowParticles.js     # 管路流体粒子动画
│   ├── LabelSystem.js       # CSS2DRenderer 悬浮标签
│   └── HeatMap.js           # 温度/压力热力图叠加
├── layout/
│   ├── DeckManager.js       # 多层甲板管理
│   ├── RoomPartition.js     # 舱室分隔
│   └── LayoutData.js        # 机舱布局配置数据
└── integration/
    ├── EventBridge.js       # ↔ 事件总线连接
    └── StateSync.js         # ↔ 数字孪生层状态同步
```

### 三种观察模式

| 模式 | 控制方式 | 用途 |
|------|---------|------|
| 鸟瞰 (Orbit) | 鼠标拖拽旋转 / 滚轮缩放 | 总体观察、教学讲解 |
| 漫游 (Walk) | WASD 行走 + 鼠标转向 | 模拟巡检、靠近观察 |
| 聚焦 (Focus) | 点击设备自动拉近 | 查看设备详情、2D 同步高亮 |

### 设备状态可视化

- **颜色映射：** 正常=绿色、预警=橙色、故障=红色闪烁、停机=灰色、运行=蓝色脉冲
- **附加效果：** 管路流体粒子动画、CSS2D 悬浮参数标签、报警发光、选中轮廓高亮 (OutlinePass)

### 2D↔3D 协同

用户在 3D 场景点击设备 → 事件总线 `equipment:select {id}` → 2D 原理图对应组件高亮。反之亦然。两者共享同一数字孪生对象的状态数据。

---

## 3. 事件总线

### 标准频道

```javascript
class EventBus {
  channels = {
    'equipment:select':      [],   // 设备选中
    'equipment:hover':       [],   // 设备悬停
    'equipment:stateChange': [],   // 状态变更
    'equipment:alarm':       [],   // 报警触发
    'camera:focus':          [],   // 3D 相机聚焦
    'view:switch':           [],   // 2D/3D/分屏切换
    'scene:load':            [],   // 加载场景
    'scene:reset':           [],   // 重置场景
    'workflow:step':         [],   // 教学步骤推进
  }
  emit(topic, payload) { ... }
  on(topic, callback)    { ... }
  off(topic, callback)   { ... }
}
```

### 与 ControlSystem 的集成

```javascript
// consys.js 的 init() 中新增:
this.thermalSolver = new ThermalSolver(this)   // 热力求解器
this.equipmentPool = new EquipmentPool()        // 设备对象池
this.eventBus      = new EventBus()             // 事件总线
this.engineRoom3D  = null                       // 3D 模块 (按需加载)
```

---

## 4. 数字孪生设备对象

### 设备对象模型

```javascript
class EngineRoomEquipment {
  id: 'me-01'
  type: 'diesel_engine'
  label: '主机'
  konvaRef: Konva.Group | null    // 2D 引用
  threeRef: THREE.Group | null    // 3D 引用
  sensors: {                      // 传感器列表
    rpm: Sensor, temp_exhaust: Sensor,
    temp_coolant: Sensor, press_oil: Sensor, fuel_flow: Sensor,
  }
  actuators: { throttle: Actuator, start_air: Actuator }
  state: { running: false, load_pct: 0, alarms: [] }
  physicsRef: Object | null
}
```

### 设备对象池

```javascript
class EquipmentPool {
  devices: Map<string, EngineRoomEquipment>
  systems: {                         // 按系统分组
    'main_engine': ['me-01'],
    'generators':  ['gen-01', 'gen-02'],
    'cooling':     ['pump-sw-01', 'pump-fw-01', 'hx-01', ...],
    'fuel':        ['pump-fuel-01', 'purifier-01', 'tank-daily-01'],
    'air':         ['compressor-01', 'air-bottle-01'],
    'bilge':       ['pump-bilge-01'],
  }
  getBySystem(system): EngineRoomEquipment[]
  getConnectedDevices(pipeId): EngineRoomEquipment[]
  notifyStateChange(devId, key, value)
}
```

---

## 5. 物理仿真扩展

### ThermalSolver (热力求解器)

新增求解器，与现有求解器并列：

- 热节点网络（热阻 + 热容模型）
- 换热器模型（板式/管壳式）
- 燃烧放热模型（基于负荷）
- 与 PneumaticSolver 耦合（冷却水流路影响热交换）

### 多介质管路扩展

现有 PneumaticSolver 扩展：

- 支持燃油、滑油、淡水、海水、蒸汽多种介质
- 每种介质独立物性参数（密度/粘度/比热）
- 多回路耦合（如冷却水→换热器→海水）
- 阀门/泵特性曲线

### 物理循环扩展

```javascript
// _updatePhysics() 中新增:
this.thermalSolver?.solve()
this.equipmentPool?.syncInternalState()
```

---

## 6. 实施路线图

### Phase 1: 基础设施 (4-6周)

| 模块 | 交付物 |
|------|--------|
| 事件总线 | EventBus 单例，标准频道，2D↔3D 通信验证 |
| 设备对象池 | EquipmentPool + EngineRoomEquipment 模型 |
| 3D 基础框架 | Three.js 场景/相机/渲染器、鸟瞰控制、glTF 加载 |
| 机舱布局 | 单层甲板、基础几何体设备模型（占位） |
| **演示系统** | **冷却水系统 2D+3D 联动完整演示** |

**里程碑：** 浏览器中看到 3D 机舱 + 冷却水系统 2D/3D 联动

### Phase 2: 核心系统补全 (6-8周)

| 系统 | 内容 |
|------|------|
| 主动力系统 | 柴油机模型 + ThermalSolver + 调速器 + 轴系 |
| 电站系统 | 发电机组 + 配电板原理图 (复用 CircuitSolver) |
| 燃油/滑油系统 | 多介质管路 + 净化 + 泵阀控制 |
| 压缩空气系统 | 空压机 + 气瓶 + 起动/控制空气 (复用 PneumaticSolver) |

**里程碑：** 完整机舱数字孪生，正常航行工况全系统联动

### Phase 3: 教学与交互 (6-8周)

| 功能 | 内容 |
|------|------|
| 教学流程 | Workflow 适配：备车/起动/并车/调速/停车 SOP |
| 故障场景 | 冷却水高温/滑油低压/燃油泄漏/电网失电等 10+ 模式 |
| 漫游模式 | WASD 巡检，设备点击查看参数 |
| 评估系统 | find/quiz/check 适配船舶场景，自动评分 |

**里程碑：** 完整教学闭环：演示→演练→评估

### Phase 4: 进阶扩展 (持续)

- 主机 3D 模型精细化（活塞/曲轴运动动画）
- 管路流体粒子动画
- 报警记录 / 历史数据回放
- CAN/Modbus 网关对接真实设备
- 多工况场景库
- 学员操作记录分析报告

---

## 7. 首个演示系统：冷却水系统

### 选择理由

- 系统闭环（泵→阀→换热器→管路→循环）
- 包含热力过程（可展示 ThermalSolver 价值）
- 现有平台匹配度高（泵阀组件已有基础）
- 教学价值明显（工作原理直观，故障后果清晰）
- 规模适中（约 10 个设备，4-6 周交付）

### 设备清单

| 编号 | 设备 | 类型 | 现有组件基础 |
|------|------|------|------------|
| pump-sw-01 | 海水泵 | Pump | ✅ 已有 Pump 组件 |
| pump-fw-01 | 淡水泵 | Pump | ✅ 已有 Pump 组件 |
| hx-01 | 板式换热器 | HeatExchanger | ❌ 需新建 |
| valve-01~04 | 截止阀 | StopValve | ✅ 已有 StopValve 组件 |
| pipe-* | 管路 | Pipe | ✅ 已有连接系统 |
| temp-01~02 | 温度传感器 | TempSensor | ✅ 已有 |
| press-01~02 | 压力传感器 | PressSensor | ✅ 已有 |

---

## 8. 技术约束与设计原则

1. **向后兼容：** 所有新增模块不得破坏现有 200+ 组件的正常运行
2. **按需加载：** Three.js 和 3D 资源仅在用户切换到 3D 视图时加载
3. **渐进增强：** 2D 原理图始终可用，3D 视图作为增强层
4. **单一数据源：** 设备状态由数字孪生层统一管理，2D/3D 只读
5. **事件驱动：** 2D↔3D 通信仅通过事件总线，不允许直接引用
