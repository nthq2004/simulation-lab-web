# 船舶机舱数字孪生 — Phase 1 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 搭建数字孪生基础设施，实现冷却水系统的 2D+3D 联动演示

**Architecture:** 在现有 ControlSystem 基础上，新增事件总线(EventBus)、设备对象池(EquipmentPool)、热力求解器(ThermalSolver)、3D渲染模块(Three.js)。3D 模块独立分包 `engineroom3d/`，通过事件总线与 2D Konva 层双向通信。

**Tech Stack:** Three.js (ESM, 通过 Vite 导入), Three.js OrbitControls, 现有 Konva.js 组件体系

---

## 文件结构

### 新建文件

```
tools/EventBus.js              # 事件总线单例
tools/EquipmentPool.js         # 设备对象池 + EngineRoomEquipment 类
tools/ThermalSolver.js         # 热力求解器（基础版，支持冷却水系统）
engineroom3d/EngineRoom3D.js   # 3D 场景主控
engineroom3d/models/ModelLoader.js   # glTF 加载器 + 基础几何体工厂
engineroom3d/models/primitives/Pump3D.js
engineroom3d/models/primitives/HeatExchanger3D.js
engineroom3d/models/primitives/Pipe3D.js
engineroom3d/controls/OrbitControl.js  # 鸟瞰轨道控制
engineroom3d/layout/DeckManager.js     # 甲板布局
engineroom3d/layout/LayoutData.js      # 冷却水系统布局数据
engineroom3d/visualization/StateColors.js  # 状态→颜色映射
engineroom3d/integration/EventBridge.js    # 事件总线桥接
engineroom3d/integration/StateSync.js      # 状态同步
components/HeatExchanger.js    # 换热器 2D Konva 组件
```

### 修改文件

```
package.json   # 添加 three 依赖
export.js      # 导出新模块
consys.js      # ControlSystem 初始化新模块
index.html     # 添加 2D/3D 视图切换按钮
style.css      # 视图切换按钮样式
```

---

### Task 1: 添加 Three.js 依赖

**Files:**
- Modify: `package.json`

- [ ] **Step 1: 检查当前依赖**

Run: `cd "e:\BaiduSyncdisk\03 教学材料\仿真软件制作\网站\lab_03\pressmeter01" && cat package.json`

- [ ] **Step 2: 安装 three 包**

Run: `pnpm add three`

Expected: three 包添加到 dependencies，package.json 更新

---

### Task 2: 创建 EventBus

**Files:**
- Create: `tools/EventBus.js`

- [ ] **Step 1: 编写 EventBus 代码**

```javascript
/**
 * EventBus - 发布-订阅事件总线
 * 用于 2D Konva 层 ↔ 3D Three.js 层之间的解耦通信
 */
export class EventBus {
    constructor() {
        this._channels = {};
        this._initChannels();
    }

    _initChannels() {
        const topics = [
            'equipment:select',
            'equipment:hover',
            'equipment:stateChange',
            'equipment:alarm',
            'camera:focus',
            'view:switch',
            'scene:load',
            'scene:reset',
            'workflow:step',
        ];
        topics.forEach(t => this._channels[t] = []);
    }

    /**
     * 发布事件
     * @param {string} topic
     * @param {*} payload
     */
    emit(topic, payload) {
        const subs = this._channels[topic];
        if (!subs) return;
        subs.forEach(cb => {
            try { cb(payload); } catch (e) { console.warn(`[EventBus] ${topic} handler error:`, e); }
        });
    }

    /**
     * 订阅事件
     * @param {string} topic
     * @param {Function} callback
     * @returns {Function} unsubscribe
     */
    on(topic, callback) {
        if (!this._channels[topic]) this._channels[topic] = [];
        this._channels[topic].push(callback);
        return () => this.off(topic, callback);
    }

    off(topic, callback) {
        const subs = this._channels[topic];
        if (!subs) return;
        this._channels[topic] = subs.filter(cb => cb !== callback);
    }

    /** 获取所有已注册的主题 */
    getTopics() {
        return Object.keys(this._channels);
    }
}
```

- [ ] **Step 2: 验证文件创建正确**

Run: `node -e "const m = require('./tools/EventBus.js'); console.log('OK')"` (will fail as ESM, just check file exists)

Run: `grep -n "EventBus" tools/EventBus.js | head -3`

---

### Task 3: 创建 EquipmentPool (设备对象池)

**Files:**
- Create: `tools/EquipmentPool.js`

- [ ] **Step 1: 编写 EngineRoomEquipment 类和 EquipmentPool 类**

```javascript
/**
 * EquipmentPool - 数字孪生设备对象池
 * 统一管理所有机舱设备的对象模型、状态和系统分组
 */

class Sensor {
    constructor(config = {}) {
        this.id = config.id || '';
        this.label = config.label || '';
        this.unit = config.unit || '';
        this.value = config.default || 0;
        this.min = config.min || 0;
        this.max = config.max || 100;
        this.alarmHigh = config.alarmHigh || null;
        this.alarmLow = config.alarmLow || null;
    }

    setValue(v) { this.value = v; }
}

class Actuator {
    constructor(config = {}) {
        this.id = config.id || '';
        this.label = config.label || '';
        this.value = config.default || 0;
        this.min = config.min || 0;
        this.max = config.max || 1;
    }

    setValue(v) { this.value = Math.max(this.min, Math.min(this.max, v)); }
}

export class EngineRoomEquipment {
    constructor(config = {}) {
        this.id = config.id;
        this.type = config.type;
        this.label = config.label || config.id;
        this.system = config.system || '';

        // 2D/3D 引用（由各渲染层注册）
        this.konvaRef = null;
        this.threeRef = null;

        // 传感器
        this.sensors = {};
        if (config.sensors) {
            Object.entries(config.sensors).forEach(([key, cfg]) => {
                this.sensors[key] = new Sensor({ id: `${this.id}_${key}`, ...cfg });
            });
        }

        // 执行器
        this.actuators = {};
        if (config.actuators) {
            Object.entries(config.actuators).forEach(([key, cfg]) => {
                this.actuators[key] = new Actuator({ id: `${this.id}_${key}`, ...cfg });
            });
        }

        // 状态
        this.state = { ...(config.initialState || {}) };
        this._prevState = {};
    }

    /** 更新状态并检测变化 */
    updateState(changes) {
        this._prevState = { ...this.state };
        Object.assign(this.state, changes);
        return this._prevState;
    }

    /** 自上次更新后是否有变化 */
    hasChanged(key) {
        return this.state[key] !== this._prevState[key];
    }
}

export class EquipmentPool {
    constructor() {
        this.devices = new Map();
        this.systems = {};
    }

    /** 注册设备 */
    register(config) {
        const dev = new EngineRoomEquipment(config);
        this.devices.set(dev.id, dev);
        if (dev.system) {
            if (!this.systems[dev.system]) this.systems[dev.system] = [];
            if (!this.systems[dev.system].includes(dev.id)) {
                this.systems[dev.system].push(dev.id);
            }
        }
        return dev;
    }

    /** 按 ID 获取设备 */
    get(id) { return this.devices.get(id) || null; }

    /** 按系统分组查询 */
    getBySystem(system) {
        const ids = this.systems[system] || [];
        return ids.map(id => this.devices.get(id)).filter(Boolean);
    }

    /** 获取所有设备 */
    getAll() { return Array.from(this.devices.values()); }

    /** 同步内部状态（预留，后续可添加批量检测逻辑） */
    syncInternalState() {
        // 空实现 — 后续扩展
    }
}
```

- [ ] **Step 2: 验证无语法错误**

Run: `node --check tools/EquipmentPool.js` (will fail as ESM, but worth checking)

Better: `cd "e:\BaiduSyncdisk\03 教学材料\仿真软件制作\网站\lab_03\pressmeter01" && node -e "import('./tools/EquipmentPool.js').then(()=>console.log('OK')).catch(e=>console.log('Expected ESM error:', e.message))"`

---

### Task 4: 创建冷却水系统设备配置

**Files:**
- Create: `tools/CoolingSystemData.js`

- [ ] **Step 1: 定义冷却水系统设备数据**

```javascript
/**
 * CoolingSystemData - 冷却水系统设备配置
 * 供 EquipmentPool 和 3D/2D 渲染层使用
 */
export const COOLING_SYSTEM_DEVICES = [
    {
        id: 'pump-sw-01',
        type: 'pump',
        label: '海水泵',
        system: 'cooling',
        sensors: {
            outletPress: { label: '出口压力', unit: 'kPa', default: 0, min: 0, max: 500, alarmLow: 50 },
            motorCurrent: { label: '电机电流', unit: 'A', default: 0, min: 0, max: 100 },
        },
        actuators: {
            startStop: { label: '启停', default: 0, min: 0, max: 1 },
        },
        initialState: { running: false, speed: 0 },
    },
    {
        id: 'pump-fw-01',
        type: 'pump',
        label: '淡水泵',
        system: 'cooling',
        sensors: {
            outletPress: { label: '出口压力', unit: 'kPa', default: 0, min: 0, max: 500, alarmLow: 50 },
            motorCurrent: { label: '电机电流', unit: 'A', default: 0, min: 0, max: 100 },
        },
        actuators: {
            startStop: { label: '启停', default: 0, min: 0, max: 1 },
        },
        initialState: { running: false, speed: 0 },
    },
    {
        id: 'hx-01',
        type: 'heat_exchanger',
        label: '板式换热器',
        system: 'cooling',
        sensors: {
            fwInTemp: { label: '淡水进口温度', unit: '°C', default: 25, min: 0, max: 100 },
            fwOutTemp: { label: '淡水出口温度', unit: '°C', default: 25, min: 0, max: 100 },
            swInTemp: { label: '海水进口温度', unit: '°C', default: 20, min: 0, max: 60 },
            swOutTemp: { label: '海水出口温度', unit: '°C', default: 20, min: 0, max: 60 },
        },
        initialState: { duty: 0 },
    },
    {
        id: 'valve-sw-01',
        type: 'valve',
        label: '海水进口阀',
        system: 'cooling',
        actuators: {
            position: { label: '开度', default: 0, min: 0, max: 100 },
        },
        sensors: {
            position: { label: '开度反馈', unit: '%', default: 0, min: 0, max: 100 },
        },
        initialState: { open: false, position: 0 },
    },
    {
        id: 'valve-sw-02',
        type: 'valve',
        label: '海水出口阀',
        system: 'cooling',
        actuators: {
            position: { label: '开度', default: 0, min: 0, max: 100 },
        },
        sensors: {
            position: { label: '开度反馈', unit: '%', default: 0, min: 0, max: 100 },
        },
        initialState: { open: false, position: 0 },
    },
    {
        id: 'valve-fw-01',
        type: 'valve',
        label: '淡水进口阀',
        system: 'cooling',
        actuators: {
            position: { label: '开度', default: 0, min: 0, max: 100 },
        },
        sensors: {
            position: { label: '开度反馈', unit: '%', default: 0, min: 0, max: 100 },
        },
        initialState: { open: false, position: 0 },
    },
    {
        id: 'valve-fw-02',
        type: 'valve',
        label: '淡水出口阀',
        system: 'cooling',
        actuators: {
            position: { label: '开度', default: 0, min: 0, max: 100 },
        },
        sensors: {
            position: { label: '开度反馈', unit: '%', default: 0, min: 0, max: 100 },
        },
        initialState: { open: false, position: 0 },
    },
    {
        id: 'temp-fw-in',
        type: 'temperature_sensor',
        label: '淡水进口温度',
        system: 'cooling',
        sensors: {
            value: { label: '温度', unit: '°C', default: 25, min: 0, max: 100, alarmHigh: 55 },
        },
        initialState: { value: 25 },
    },
    {
        id: 'temp-fw-out',
        type: 'temperature_sensor',
        label: '淡水出口温度',
        system: 'cooling',
        sensors: {
            value: { label: '温度', unit: '°C', default: 25, min: 0, max: 100, alarmHigh: 60 },
        },
        initialState: { value: 25 },
    },
];
```

- [ ] **Step 2: 验证文件创建**

Run: `ls -la tools/CoolingSystemData.js`

---

### Task 5: 创建 ThermalSolver (基础版)

**Files:**
- Create: `tools/ThermalSolver.js`

- [ ] **Step 1: 编写基础热力求解器**

```javascript
/**
 * ThermalSolver - 热力求解器（基础版）
 * 热节点网络，支持换热器建模
 * 与 PneumaticSolver 耦合（流量影响换热量）
 */
export class ThermalSolver {
    constructor(sys) {
        this.sys = sys;
        this._nodes = new Map();     // nodeId → { temp, capacity }
        this._exchangers = [];       // 换热器列表
    }

    /**
     * 注册热节点
     */
    addNode(id, initialTemp = 25, heatCapacity = 1000) {
        this._nodes.set(id, { temp: initialTemp, capacity: heatCapacity });
    }

    /**
     * 注册换热器
     * @param {Object} config
     * @param {string} config.id
     * @param {string} config.hotSide  热侧节点
     * @param {string} config.coldSide 冷侧节点
     * @param {number} config.area     换热面积
     * @param {number} config.kValue   传热系数
     */
    addExchanger(config) {
        this._exchangers.push({ ...config });
    }

    /**
     * 主求解方法 — 每帧在 _updatePhysics 中调用
     */
    solve(dt) {
        // 冷却水系统热力模型：
        // 淡水从设备吸收热量 → 流经换热器 → 传递给海水 → 排出
        // 简化：仅根据当前状态计算温度变化趋势

        const eqPool = this.sys.equipmentPool;
        if (!eqPool) return;

        const hx = eqPool.get('hx-01');
        if (!hx || !hx.state) return;

        const fwIn = hx.sensors.fwInTemp?.value || 25;
        const swIn = hx.sensors.swInTemp?.value || 20;
        const duty = hx.state.duty || 0.5;

        // 简化换热模型：Δt = (fwIn - swIn) * duty * 0.1
        const fwOut = fwIn - (fwIn - swIn) * duty * 0.3;
        const swOut = swIn + (fwIn - swIn) * duty * 0.3;

        hx.sensors.fwOutTemp && (hx.sensors.fwOutTemp.value = Math.round(fwOut * 10) / 10);
        hx.sensors.swOutTemp && (hx.sensors.swOutTemp.value = Math.round(swOut * 10) / 10);
    }

    /** 重置所有节点温度 */
    reset() {
        this._nodes.forEach((node, id) => { node.temp = 25; });
    }
}
```

- [ ] **Step 2: 验证文件创建**

Run: `ls -la tools/ThermalSolver.js`

---

### Task 6: 创建 3D 基础工具模块

**Files:**
- Create: `engineroom3d/visualization/StateColors.js`
- Create: `engineroom3d/integration/EventBridge.js`
- Create: `engineroom3d/integration/StateSync.js`

- [ ] **Step 1: StateColors — 设备状态到颜色的映射**

```javascript
/**
 * StateColors - 设备状态到 Three.js 颜色的映射
 */
export const STATE_COLORS = {
    normal:   0x4caf50,  // 绿
    warning:  0xff9800,  // 橙
    alarm:    0xf44336,  // 红
    stopped:  0x9e9e9e,  // 灰
    running:  0x2196f3,  // 蓝
    selected: 0xffeb3b,  // 黄 (高亮)
};

export function getStateColor(device) {
    if (!device) return STATE_COLORS.stopped;
    if (device.state.alarms && device.state.alarms.length > 0) return STATE_COLORS.alarm;
    if (device.state.running) return STATE_COLORS.running;
    return STATE_COLORS.stopped;
}
```

- [ ] **Step 2: EventBridge — 连接 3D 模块与事件总线**

```javascript
/**
 * EventBridge - 将 3D 模块的事件订阅/发布到全局 EventBus
 */
export class EventBridge {
    /**
     * @param {import('../../tools/EventBus.js').EventBus} eventBus
     * @param {import('../EngineRoom3D.js').EngineRoom3D} engineRoom3D
     */
    constructor(eventBus, engineRoom3D) {
        this.bus = eventBus;
        this.three = engineRoom3D;
        this._unsubs = [];
    }

    /** 建立所有订阅连接 */
    connect() {
        // 事件总线 → 3D
        this._unsubs.push(
            this.bus.on('equipment:select', ({ id }) => this.three.focusOn(id))
        );
        this._unsubs.push(
            this.bus.on('equipment:stateChange', ({ id, state }) => this.three.updateDeviceState(id, state))
        );
        this._unsubs.push(
            this.bus.on('scene:reset', () => this.three.reset())
        );

        // 3D → 事件总线 (3D 内部调用 EventBus.emit 直接发送)
    }

    /** 断开所有订阅 */
    disconnect() {
        this._unsubs.forEach(fn => fn());
        this._unsubs = [];
    }
}
```

- [ ] **Step 3: StateSync — 将设备池状态同步到 3D 场景**

```javascript
/**
 * StateSync - 数字孪生层 → 3D 场景的状态同步
 */
export class StateSync {
    /**
     * @param {import('../../tools/EquipmentPool.js').EquipmentPool} pool
     * @param {import('../../tools/EventBus.js').EventBus} bus
     */
    constructor(pool, bus) {
        this.pool = pool;
        this.bus = bus;
        this._prevStates = new Map();
    }

    /** 同步所有设备状态到 3D 场景 */
    sync() {
        const allDevices = this.pool.getAll();
        allDevices.forEach(dev => {
            const prev = this._prevStates.get(dev.id);
            if (!prev) {
                this._prevStates.set(dev.id, { ...dev.state });
                return;
            }

            // 检测变化并发出事件
            for (const key of Object.keys(dev.state)) {
                if (dev.state[key] !== prev[key]) {
                    this.bus.emit('equipment:stateChange', {
                        id: dev.id,
                        key,
                        value: dev.state[key],
                        state: { ...dev.state },
                    });
                }
            }
            this._prevStates.set(dev.id, { ...dev.state });
        });
    }
}
```

- [ ] **Step 4: 验证所有文件创建**

Run: `ls -la engineroom3d/visualization/ engineroom3d/integration/`

---

### Task 7: 创建 3D 模型原始几何体

**Files:**
- Create: `engineroom3d/models/primitives/Pump3D.js`
- Create: `engineroom3d/models/primitives/HeatExchanger3D.js`
- Create: `engineroom3d/models/primitives/Pipe3D.js`

- [ ] **Step 1: Pump3D — 泵的 3D 几何体**

```javascript
import * as THREE from 'three';

/**
 * 创建泵的 3D 模型（基础几何体组合）
 * @param {Object} opts
 * @param {number} opts.color  状态颜色，默认灰色
 * @returns {THREE.Group}
 */
export function createPumpModel(opts = {}) {
    const color = opts.color || 0x9e9e9e;
    const group = new THREE.Group();

    // 泵体
    const body = new THREE.Mesh(
        new THREE.BoxGeometry(1.2, 0.8, 0.8),
        new THREE.MeshStandardMaterial({ color })
    );
    body.position.y = 0.4;
    group.add(body);

    // 电机
    const motor = new THREE.Mesh(
        new THREE.CylinderGeometry(0.5, 0.5, 0.8, 16),
        new THREE.MeshStandardMaterial({ color: 0x607d8b })
    );
    motor.position.set(0.9, 0.4, 0);
    motor.rotation.z = Math.PI / 2;
    group.add(motor);

    // 进口法兰
    const inlet = new THREE.Mesh(
        new THREE.CylinderGeometry(0.15, 0.15, 0.3, 8),
        new THREE.MeshStandardMaterial({ color: 0x795548 })
    );
    inlet.position.set(-0.8, 0.4, 0);
    inlet.rotation.z = Math.PI / 2;
    group.add(inlet);

    // 出口法兰
    const outlet = new THREE.Mesh(
        new THREE.CylinderGeometry(0.15, 0.15, 0.3, 8),
        new THREE.MeshStandardMaterial({ color: 0x795548 })
    );
    outlet.position.set(0, 0.4, 0.6);
    outlet.rotation.x = Math.PI / 2;
    group.add(outlet);

    // 底座
    const base = new THREE.Mesh(
        new THREE.BoxGeometry(1.4, 0.1, 0.8),
        new THREE.MeshStandardMaterial({ color: 0x616161 })
    );
    base.position.y = 0.05;
    group.add(base);

    group.userData.parts = { body, motor, base };

    return group;
}
```

- [ ] **Step 2: HeatExchanger3D — 换热器 3D 模型**

```javascript
import * as THREE from 'three';

/**
 * 创建板式换热器 3D 模型
 * @param {Object} opts
 * @returns {THREE.Group}
 */
export function createHeatExchangerModel(opts = {}) {
    const color = opts.color || 0x607d8b;
    const group = new THREE.Group();

    // 换热器主体（长方形板组）
    const plates = new THREE.Mesh(
        new THREE.BoxGeometry(1.0, 1.2, 0.5),
        new THREE.MeshStandardMaterial({ color, metalness: 0.3, roughness: 0.6 })
    );
    plates.position.y = 0.6;
    group.add(plates);

    // 板片纹理（条纹效果）
    for (let i = -4; i <= 4; i++) {
        const strip = new THREE.Mesh(
            new THREE.BoxGeometry(0.02, 0.9, 0.4),
            new THREE.MeshStandardMaterial({ color: 0x455a64 })
        );
        strip.position.set(i * 0.1, 0.6, 0);
        group.add(strip);
    }

    // 四接口法兰
    const flangeMat = new THREE.MeshStandardMaterial({ color: 0x795548 });
    const positions = [
        [-0.4, 1.0, 0.3],  // 淡水进口
        [0.4, 1.0, 0.3],   // 淡水出口
        [-0.4, 0.2, 0.3],  // 海水进口
        [0.4, 0.2, 0.3],   // 海水出口
    ];
    positions.forEach(pos => {
        const flange = new THREE.Mesh(
            new THREE.CylinderGeometry(0.1, 0.12, 0.15, 8),
            flangeMat
        );
        flange.position.set(pos[0], pos[1], pos[2]);
        flange.rotation.x = Math.PI / 2;
        group.add(flange);
    });

    // 框架
    const frame = new THREE.Mesh(
        new THREE.BoxGeometry(1.1, 0.05, 0.55),
        new THREE.MeshStandardMaterial({ color: 0x37474f })
    );
    frame.position.y = 0.05;
    group.add(frame);

    return group;
}
```

- [ ] **Step 3: Pipe3D — 管路 3D 模型**

```javascript
import * as THREE from 'three';

/**
 * 创建管路 3D 模型
 * @param {Object} opts
 * @param {THREE.Vector3} opts.from  起点
 * @param {THREE.Vector3} opts.to    终点
 * @param {number} opts.radius       管径
 * @param {number} opts.color        颜色
 * @returns {THREE.Mesh}
 */
export function createPipeSegment(opts = {}) {
    const from = opts.from || new THREE.Vector3(0, 0, 0);
    const to = opts.to || new THREE.Vector3(1, 0, 0);
    const radius = opts.radius || 0.04;
    const color = opts.color || 0x90a4ae;

    const direction = new THREE.Vector3().copy(to).sub(from);
    const length = direction.length();

    const geometry = new THREE.CylinderGeometry(radius, radius, length, 8);
    const material = new THREE.MeshStandardMaterial({ color });
    const pipe = new THREE.Mesh(geometry, material);

    // 定位到中点并朝向终点方向
    const mid = new THREE.Vector3().copy(from).add(to).multiplyScalar(0.5);
    pipe.position.copy(mid);

    const up = new THREE.Vector3(0, 1, 0);
    const quat = new THREE.Quaternion().setFromUnitVectors(up, direction.clone().normalize());
    pipe.quaternion.copy(quat);

    return pipe;
}

/**
 * 创建弯头 (90度)
 */
export function createPipeElbow(opts = {}) {
    const group = new THREE.Group();
    const radius = opts.radius || 0.04;
    const color = opts.color || 0x90a4ae;
    const mat = new THREE.MeshStandardMaterial({ color });

    // 简化弯头 = 一个环段 (用环形几何体近似)
    const elbow = new THREE.Mesh(
        new THREE.TorusGeometry(radius * 2.5, radius, 6, 8, Math.PI / 2),
        mat
    );
    group.add(elbow);

    return group;
}
```

- [ ] **Step 4: 验证文件创建**

Run: `ls -la engineroom3d/models/primitives/`

---

### Task 8: 创建 3D 模型加载器

**Files:**
- Create: `engineroom3d/models/ModelLoader.js`

- [ ] **Step 1: 编写 ModelLoader**

```javascript
import * as THREE from 'three';
import { createPumpModel } from './primitives/Pump3D.js';
import { createHeatExchangerModel } from './primitives/HeatExchanger3D.js';
import { createPipeSegment } from './primitives/Pipe3D.js';

/**
 * ModelLoader - 3D 设备模型加载和创建工厂
 * 无 glTF 时使用基础几何体组合
 */
export class ModelLoader {
    constructor() {
        // 设备类型 → 工厂函数映射
        this._factories = {
            'pump':             (opts) => createPumpModel(opts),
            'heat_exchanger':   (opts) => createHeatExchangerModel(opts),
        };
    }

    /**
     * 创建设备 3D 模型
     * @param {string} type  设备类型
     * @param {Object} opts  可包含 color, 位置等
     * @returns {THREE.Group}
     */
    createDevice(type, opts = {}) {
        const factory = this._factories[type];
        if (factory) return factory(opts);

        // 未知类型回退：灰色方块
        const fallback = new THREE.Mesh(
            new THREE.BoxGeometry(0.5, 0.5, 0.5),
            new THREE.MeshStandardMaterial({ color: opts.color || 0x9e9e9e })
        );
        return fallback;
    }

    /**
     * 创建管路线段
     */
    createPipe(from, to, opts = {}) {
        return createPipeSegment({ from, to, ...opts });
    }

    /**
     * 注册自定义设备工厂
     */
    register(type, factoryFn) {
        this._factories[type] = factoryFn;
    }
}
```

- [ ] **Step 2: 验证文件**

Run: `ls -la engineroom3d/models/ModelLoader.js`

---

### Task 9: 创建 3D 场景主控 EngineRoom3D

**Files:**
- Create: `engineroom3d/EngineRoom3D.js`

- [ ] **Step 1: 编写 EngineRoom3D 主控类**

```javascript
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { ModelLoader } from './models/ModelLoader.js';
import { getStateColor } from './visualization/StateColors.js';

/**
 * EngineRoom3D - 3D 机舱场景主控
 * 管理 Three.js 场景、相机、渲染器和设备模型
 */
export class EngineRoom3D {
    /**
     * @param {HTMLElement} container  DOM 容器
     */
    constructor(container) {
        if (!container) throw new Error('EngineRoom3D: container is required');

        this.container = container;
        this._deviceMeshes = new Map();  // devId → THREE.Group
        this._modelLoader = new ModelLoader();

        this._initScene();
        this._initCamera();
        this._initRenderer();
        this._initLights();
        this._initControls();
        this._initHelpers();

        // 启动渲染循环
        this._animate();
    }

    _initScene() {
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x1a1a2e);

        // 雾效
        this.scene.fog = new THREE.Fog(0x1a1a2e, 20, 40);
    }

    _initCamera() {
        const rect = this.container.getBoundingClientRect();
        this.camera = new THREE.PerspectiveCamera(45, rect.width / rect.height, 0.1, 100);
        this.camera.position.set(8, 6, 8);
        this.camera.lookAt(0, 0, 0);
    }

    _initRenderer() {
        this.renderer = new THREE.WebGLRenderer({ antialias: true });
        this.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = 1.0;
        this.container.appendChild(this.renderer.domElement);
    }

    _initLights() {
        // 环境光
        const ambient = new THREE.AmbientLight(0x404060, 0.5);
        this.scene.add(ambient);

        // 主方向光
        const dirLight = new THREE.DirectionalLight(0xffffff, 1.0);
        dirLight.position.set(10, 15, 10);
        dirLight.castShadow = true;
        this.scene.add(dirLight);

        // 补光
        const fillLight = new THREE.DirectionalLight(0x8888ff, 0.3);
        fillLight.position.set(-10, 5, -10);
        this.scene.add(fillLight);

        // 机舱顶部灯 (点光源阵列)
        for (let x = -6; x <= 6; x += 4) {
            for (let z = -6; z <= 6; z += 4) {
                const point = new THREE.PointLight(0xffeedd, 0.2, 8);
                point.position.set(x, 4, z);
                this.scene.add(point);
            }
        }
    }

    _initControls() {
        this.controls = new OrbitControls(this.camera, this.renderer.domElement);
        this.controls.target.set(0, 1, 0);
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.08;
        this.controls.minDistance = 2;
        this.controls.maxDistance = 30;
        this.controls.maxPolarAngle = Math.PI / 2.1;
        this.controls.update();
    }

    _initHelpers() {
        // 网格地面
        const grid = new THREE.GridHelper(20, 20, 0x444466, 0x333355);
        grid.position.y = -0.01;
        this.scene.add(grid);

        // 地面平面（接收阴影）
        const ground = new THREE.Mesh(
            new THREE.PlaneGeometry(20, 20),
            new THREE.ShadowMaterial({ opacity: 0.3 })
        );
        ground.rotation.x = -Math.PI / 2;
        ground.position.y = -0.01;
        ground.receiveShadow = true;
        this.scene.add(ground);
    }

    /**
     * 添加设备模型到场景
     * @param {string} devId  设备 ID
     * @param {string} type   设备类型
     * @param {THREE.Vector3} position
     * @param {Object} opts
     */
    addDevice(devId, type, position, opts = {}) {
        const mesh = this._modelLoader.createDevice(type, { color: getStateColor(), ...opts });
        mesh.position.copy(position);
        mesh.scale.setScalar(opts.scale || 1);
        mesh.castShadow = true;
        this.scene.add(mesh);
        this._deviceMeshes.set(devId, mesh);
        return mesh;
    }

    /**
     * 更新设备 3D 颜色
     */
    updateDeviceState(devId, state) {
        const mesh = this._deviceMeshes.get(devId);
        if (!mesh) return;

        // 遍历更新材质颜色
        mesh.traverse(child => {
            if (child.isMesh && child.material) {
                const color = getStateColor({ state, alarms: state.alarms, running: state.running });
                if (Array.isArray(child.material)) {
                    child.material.forEach(m => m.color.setHex(color));
                } else {
                    child.material.color.setHex(color);
                }
            }
        });
    }

    /**
     * 相机聚焦到设备
     */
    focusOn(devId) {
        const mesh = this._deviceMeshes.get(devId);
        if (!mesh) return;
        const target = mesh.position.clone();
        // 简单的平滑聚焦
        this.controls.target.copy(target);
    }

    /** 重置场景 */
    reset() {
        this.controls.target.set(0, 1, 0);
        this.camera.position.set(8, 6, 8);
        this.controls.update();
    }

    /** 调整大小 */
    resize() {
        const rect = this.container.getBoundingClientRect();
        this.camera.aspect = rect.width / rect.height;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(rect.width, rect.height);
    }

    _animate() {
        this._rafId = requestAnimationFrame(() => this._animate());
        this.controls.update();
        this.renderer.render(this.scene, this.camera);
    }

    /** 销毁 */
    dispose() {
        if (this._rafId) cancelAnimationFrame(this._rafId);
        this.renderer.dispose();
        if (this.container.contains(this.renderer.domElement)) {
            this.container.removeChild(this.renderer.domElement);
        }
    }
}
```

- [ ] **Step 2: 验证文件**

Run: `ls -la engineroom3d/EngineRoom3D.js`

---

### Task 10: 创建甲板布局管理器

**Files:**
- Create: `engineroom3d/layout/DeckManager.js`
- Create: `engineroom3d/layout/LayoutData.js`

- [ ] **Step 1: DeckManager**

```javascript
import * as THREE from 'three';

/**
 * DeckManager - 机舱甲板布局管理
 * 支持多层甲板、地板、舱壁
 */
export class DeckManager {
    constructor(scene) {
        this.scene = scene;
        this.decks = [];
    }

    /**
     * 创建一层甲板
     * @param {number} y        高度
     * @param {number} width    宽度
     * @param {number} depth    深度
     * @param {Object} opts
     */
    addDeck(y, width, depth, opts = {}) {
        const mat = new THREE.MeshStandardMaterial({
            color: opts.color || 0x37474f,
            roughness: 0.8,
            metalness: 0.2,
        });
        const deck = new THREE.Mesh(new THREE.PlaneGeometry(width, depth), mat);
        deck.rotation.x = -Math.PI / 2;
        deck.position.set(0, y, 0);
        deck.receiveShadow = true;
        this.scene.add(deck);

        this.decks.push({ y, width, depth, mesh: deck });
        return deck;
    }

    /**
     * 创建舱壁
     */
    addWall(x, y, z, width, height, depth, opts = {}) {
        const mat = new THREE.MeshStandardMaterial({
            color: opts.color || 0x455a64,
            roughness: 0.9,
            metalness: 0.1,
            transparent: true,
            opacity: opts.opacity || 0.3,
        });
        const wall = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), mat);
        wall.position.set(x, y, z);
        wall.castShadow = true;
        wall.receiveShadow = true;
        this.scene.add(wall);
        return wall;
    }
}
```

- [ ] **Step 2: LayoutData — 冷却水系统布局配置**

```javascript
import * as THREE from 'three';

/**
 * LayoutData - 机舱布局配置
 * 定义设备位置、管路路径和甲板参数
 */

// 冷却水系统设备 3D 坐标
export const COOLING_LAYOUT = {
    decks: [
        { y: 0, width: 12, depth: 10, color: 0x37474f },     // 底层
        { y: 2.8, width: 12, depth: 10, color: 0x37474f },   // 顶层
    ],

    devices: [
        // 海水泵
        { id: 'pump-sw-01', type: 'pump',   position: new THREE.Vector3(-2.5, 0.4, 1.5),  scale: 1.0 },
        // 淡水泵
        { id: 'pump-fw-01', type: 'pump',   position: new THREE.Vector3(2.5, 0.4, 1.5),   scale: 1.0 },
        // 板式换热器 (跨层)
        { id: 'hx-01',      type: 'heat_exchanger', position: new THREE.Vector3(0, 0.6, -1.5), scale: 1.0 },
        // 阀门
        { id: 'valve-sw-01', type: 'valve', position: new THREE.Vector3(-3.0, 0.2, 2.0),  scale: 0.6 },
        { id: 'valve-sw-02', type: 'valve', position: new THREE.Vector3(-2.0, 0.2, 0.5),  scale: 0.6 },
        { id: 'valve-fw-01', type: 'valve', position: new THREE.Vector3(2.0, 0.2, 0.5),   scale: 0.6 },
        { id: 'valve-fw-02', type: 'valve', position: new THREE.Vector3(3.0, 0.2, 2.0),   scale: 0.6 },
        // 传感器
        { id: 'temp-fw-in',  type: 'temperature_sensor', position: new THREE.Vector3(1.5, 0.3, -0.5), scale: 0.4 },
        { id: 'temp-fw-out', type: 'temperature_sensor', position: new THREE.Vector3(1.0, 0.3, 2.5),  scale: 0.4 },
    ],

    // 管路路径 [{from, to, opts}]
    pipes: [
        { from: [-3.0, 0.3, 2.0],  to: [-2.5, 0.3, 1.5],  color: 0x42a5f5 }, // 海水→海水泵入口
        { from: [-2.5, 0.3, 1.0],  to: [-0.5, 0.3, -0.5], color: 0x42a5f5 }, // 海水泵出口→换热器
        { from: [-0.5, 0.3, -0.5], to: [0, 0.5, -1.5],    color: 0x42a5f5 }, // →换热器海水侧
        { from: [0, 0.5, -1.5],    to: [0, 4.0, -1.5],     color: 0x42a5f5 }, // 换热器海水出口(垂直)
        { from: [2.0, 0.3, 0.5],   to: [0, 0.5, -1.5],     color: 0xef5350 }, // 淡水→换热器
        { from: [2.5, 0.3, 1.5],   to: [2.0, 0.3, 0.5],    color: 0xef5350 }, // 淡水泵出口→
        { from: [0, 0.5, -1.5],    to: [1.0, 0.3, 2.5],     color: 0xef5350 }, // 换热器淡水出口→
    ],
};
```

- [ ] **Step 3: 验证文件**

Run: `ls -la engineroom3d/layout/`

---

### Task 11: 创建换热器 2D Konva 组件

**Files:**
- Create: `components/HeatExchanger.js`

- [ ] **Step 1: 编写换热器 2D 组件**

```javascript
import { BaseComponent } from './BaseComponent.js';

/**
 * HeatExchanger - 板式换热器 2D 原理图符号
 * 用于冷却水系统原理图
 */
export class HeatExchanger extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.type = 'heat_exchanger';
        this.cache = 'fixed';

        const W = this.width || 80;
        const H = this.height || 100;

        // 矩形主体
        const rect = new Konva.Rect({
            x: -W / 2, y: -H / 2, width: W, height: H,
            fill: '#e8f5e9', stroke: '#2e7d32', strokeWidth: 2,
            cornerRadius: 4,
        });
        this.group.add(rect);

        // 波纹板片示意（竖线）
        for (let i = 0; i < 5; i++) {
            const line = new Konva.Line({
                points: [
                    -W / 2 + 8 + i * (W - 16) / 4, -H / 2 + 10,
                    -W / 2 + 8 + i * (W - 16) / 4,  H / 2 - 10,
                ],
                stroke: '#a5d6a7', strokeWidth: 1.5,
            });
            this.group.add(line);
        }

        // "HX" 标签
        const label = new Konva.Text({
            x: -15, y: -8, width: 30,
            text: 'HX', fontSize: 14, fontStyle: 'bold',
            fill: '#2e7d32', align: 'center',
        });
        this.group.add(label);

        // 四个接口端口
        this.addPort(-W / 2, -H / 4, 'sw_in', 'wire');
        this.addPort(-W / 2,  H / 4, 'fw_in', 'wire');
        this.addPort(W / 2,  -H / 4, 'sw_out', 'wire');
        this.addPort(W / 2,   H / 4, 'fw_out', 'wire');

        // 温度标签文字
        const tempHot = new Konva.Text({
            x: -W / 2 - 30, y: -H / 4 - 10,
            text: 'T↓', fontSize: 10, fill: '#e53935',
        });
        this.group.add(tempHot);

        const tempCold = new Konva.Text({
            x: -W / 2 - 30, y: H / 4 - 5,
            text: 'T↑', fontSize: 10, fill: '#1e88e5',
        });
        this.group.add(tempCold);
    }

    getConfigFields() {
        return [
            { label: '位号', key: 'label', type: 'text' },
        ];
    }

    onConfigUpdate(newConfig) {
        this.label = newConfig.label;
    }
}
```

- [ ] **Step 2: 验证文件**

Run: `ls -la components/HeatExchanger.js`

---

### Task 12: 更新 export.js 导出新模块

**Files:**
- Modify: `export.js`

- [ ] **Step 1: 添加导入和导出语句**

在 `tools` 导入区块追加：
```javascript
import { EventBus } from './tools/EventBus.js';
import { EquipmentPool, EngineRoomEquipment } from './tools/EquipmentPool.js';
import { ThermalSolver } from './tools/ThermalSolver.js';
```

在 `components` 导入区块追加：
```javascript
import { HeatExchanger } from './components/HeatExchanger.js';
```

在第一个 `export {` 块追加：
```javascript
    EventBus, EquipmentPool, EngineRoomEquipment, ThermalSolver,
```

在 `export { BourdonTube, DiaphragmGauge }` 行追加：
```javascript
    HeatExchanger,
```

---

### Task 13: 更新 consys.js — ControlSystem 集成

**Files:**
- Modify: `consys.js`

- [ ] **Step 1: 导入新模块**

在文件顶部的 import 区添加：
```javascript
import { EventBus, EquipmentPool, EngineRoomEquipment, ThermalSolver } from './export.js';
```

- [ ] **Step 2: 在 init() 末尾添加初始化**

在 `this.showComp = new Show(this);` 之后：
```javascript
// ── 数字孪生模块初始化 ──
this.eventBus = new EventBus();
this.equipmentPool = new EquipmentPool();
this.thermalSolver = new ThermalSolver(this);
this.engineRoom3D = null;  // 按需加载
```

在 `this._animCompIds = ...` 之前或之后添加设备注册。

- [ ] **Step 3: 在 import 顶部添加冷却系统数据导入**

在现有 import 区块中追加：
```javascript
import { COOLING_SYSTEM_DEVICES } from './tools/CoolingSystemData.js';
```

- [ ] **Step 4: 添加设备注册调用（在 init() 末尾，构建完所有组件后）**

```javascript
// 注册冷却水系统设备到对象池
COOLING_SYSTEM_DEVICES.forEach(cfg => this.equipmentPool.register(cfg));
```

- [ ] **Step 5: 在 _updatePhysics() 末尾添加 thermalSolver 调用**

在 `this._tickAll(dt);` 之前：
```javascript
if (this.thermalSolver) this.thermalSolver.solve(1 / 20);
```

---

### Task 14: 更新 index.html — 视图切换按钮

**Files:**
- Modify: `index.html`
- Modify: `style.css`

- [ ] **Step 1: 在工具栏添加视图切换按钮**

在 `btnInstrument` 按钮后追加：
```html
<button id="btnViewToggle" title="切换2D/3D视图">3D 视图</button>
```

- [ ] **Step 2: 添加 3D 容器**

在 `container` div 后追加：
```html
<div id="container3d" style="display:none;position:absolute;top:48px;left:0;width:100%;height:calc(100vh - 48px);"></div>
```

- [ ] **Step 3: 在 style.css 添加视图切换相关样式**

```css
#btnViewToggle {
    background: #37474f;
    color: white;
    border: none;
    padding: 6px 14px;
    border-radius: 4px;
    cursor: pointer;
    font-size: 13px;
    margin-left: 8px;
}
#btnViewToggle.active {
    background: #1565c0;
}
```

- [ ] **Step 4: 在 main.js 添加视图切换逻辑**

```javascript
// 5. 2D/3D 视图切换
document.getElementById('btnViewToggle').onclick = () => {
    const container2d = document.getElementById('container');
    const container3d = document.getElementById('container3d');
    const btn = document.getElementById('btnViewToggle');
    const is3D = container3d.style.display === 'block';

    if (is3D) {
        // 切换回 2D
        container3d.style.display = 'none';
        container2d.style.display = 'block';
        btn.textContent = '3D 视图';
        btn.classList.remove('active');
        if (sys.engineRoom3D) { sys.engineRoom3D.dispose(); sys.engineRoom3D = null; }
    } else {
        // 切换到 3D
        container2d.style.display = 'none';
        container3d.style.display = 'block';
        btn.textContent = '2D 视图';
        btn.classList.add('active');
        // 动态加载 Three.js
        import('./engineroom3d/EngineRoom3D.js').then(({ EngineRoom3D }) => {
            sys.engineRoom3D = new EngineRoom3D(container3d);
            _buildEngineRoomScene(sys);
        }).catch(err => {
            console.error('Failed to load 3D engine:', err);
            btn.textContent = '3D 视图';
            btn.classList.remove('active');
            container3d.style.display = 'none';
            container2d.style.display = 'block';
        });
    }
};

// 构建 3D 机舱场景
async function _buildEngineRoomScene(sys) {
    const er3d = sys.engineRoom3D;
    if (!er3d) return;

    const THREE = await import('three');
    const { DeckManager } = await import('./engineroom3d/layout/DeckManager.js');
    const { COOLING_LAYOUT } = await import('./engineroom3d/layout/LayoutData.js');
    const { createPipeSegment } = await import('./engineroom3d/models/primitives/Pipe3D.js');

    const deck = new DeckManager(er3d.scene);

    // 创建甲板
    COOLING_LAYOUT.decks.forEach(d => deck.addDeck(d.y, d.width, d.depth, d));

    // 创建设备
    COOLING_LAYOUT.devices.forEach(dev => {
        er3d.addDevice(dev.id, dev.type, dev.position, { scale: dev.scale });
    });

    // 创建管路
    COOLING_LAYOUT.pipes.forEach(p => {
        const from = new THREE.Vector3(p.from[0], p.from[1], p.from[2]);
        const to = new THREE.Vector3(p.to[0], p.to[1], p.to[2]);
        const pipe = createPipeSegment({ from, to, color: p.color });
        er3d.scene.add(pipe);
    });
}

---

### Task 15: 构建验证

**Files:**
- Verify: 整个项目

- [ ] **Step 1: 构建项目**

Run: `cd "e:\BaiduSyncdisk\03 教学材料\仿真软件制作\网站\lab_03\pressmeter01" && pnpm run build 2>&1`

Expected: 构建成功，无错误

- [ ] **Step 2: 启动开发服务器**

Run: `pnpm run dev` 并截图验证页面正常加载

- [ ] **Step 3: 检查 2D 原理图和 3D 切换按钮**

在浏览器中确认：
- 页面正常加载，2D 原理图显示正常
- "3D 视图"按钮可见
- 点击按钮后切换到 3D 视图，机舱场景显示

---

## 自检清单

- [ ] 所有文件路径均为绝对或正确相对路径
- [ ] 每个文件职责单一、清晰
- [ ] 所有新模块通过 export.js 统一导出
- [ ] 无"TBD/TODO/稍后实现"等占位符
- [ ] 类型和方法签名跨任务一致
- [ ] 不允许 `require()`（项目使用 ESM）
- [ ] 后端文件与前端文件分离清晰
