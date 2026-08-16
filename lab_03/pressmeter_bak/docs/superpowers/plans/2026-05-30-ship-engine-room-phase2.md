# 船舶机舱数字孪生 — Phase 2 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 补全四大核心系统（主动力/电站/燃油滑油/压缩空气）的 2D 组件、3D 模型和物理仿真，实现完整机舱数字孪生

**Architecture:** 在 Phase 1 基础设施（EventBus/EquipmentPool/ThermalSolver/3D场景）之上，新增船舶专用 Konva 2D 组件和 Three.js 3D 模型。ThermalSolver 扩展发动机热模型，PneumaticSolver 扩展多介质支持。所有新设备通过 EquipmentPool 统一管理和事件总线同步。

**Tech Stack:** Three.js (ESM via Vite), Konva.js, 现有 CircuitSolver/PneumaticSolver/ThermalSolver

---

## 文件结构

### 新建文件

```
tools/Phase2SystemData.js                  # Phase 2 全部系统设备配置
components/Governor.js                     # 调速器 2D 原理图组件
components/GeneratorUnit.js                # 发电机组 2D 原理图组件
components/Switchboard.js                  # 配电板 2D 原理图组件
components/FuelTank.js                     # 燃油舱/日用柜 2D 组件
components/OilSeparator.js                 # 分油机 2D 组件
components/AirDistributor.js               # 压缩空气分配系统 2D 组件
engineroom3d/models/primitives/DieselEngine3D.js  # 柴油机 3D 模型
engineroom3d/models/primitives/Generator3D.js     # 发电机 3D 模型
engineroom3d/models/primitives/Valve3D.js         # 阀门 3D 模型
engineroom3d/models/primitives/AirBottle3D.js     # 气瓶 3D 模型
```

### 修改文件

```
tools/ThermalSolver.js                    # 扩展发动机热模型
tools/PneumaticSolver.js                  # 扩展多介质管路支持
engineroom3d/models/ModelLoader.js        # 注册新 3D 模型工厂
engineroom3d/layout/LayoutData.js         # 添加 Phase 2 设备布局
export.js                                 # 导出新模块
consys.js                                 # 初始化 Phase 2 系统
```

---

### Task 1: Phase 2 全部系统设备配置

**Files:**
- Create: `tools/Phase2SystemData.js`

- [ ] **Step 1: 编写 Phase 2 设备配置**

```javascript
/**
 * Phase2SystemData - Phase 2 全部系统设备配置
 * 主动力系统 / 电站系统 / 燃油滑油系统 / 压缩空气系统
 */
export const MAIN_ENGINE_DEVICES = [
    {
        id: 'me-01',
        type: 'diesel_engine',
        label: '主机',
        system: 'main_engine',
        sensors: {
            rpm: { label: '转速', unit: 'rpm', default: 0, min: 0, max: 200, alarmHigh: 180 },
            exhaustTemp: { label: '排气温度', unit: '°C', default: 30, min: 0, max: 600, alarmHigh: 500 },
            coolantTemp: { label: '冷却水温', unit: '°C', default: 25, min: 0, max: 100, alarmHigh: 90 },
            oilPress: { label: '滑油压力', unit: 'kPa', default: 0, min: 0, max: 500, alarmLow: 100 },
            fuelRate: { label: '喷油量', unit: '%', default: 0, min: 0, max: 100 },
        },
        actuators: {
            startStop: { label: '启停', default: 0, min: 0, max: 1 },
            speedSet: { label: '转速设定', default: 0, min: 0, max: 200 },
        },
        initialState: { running: false, speed: 0, load: 0 },
    },
    {
        id: 'governor-01',
        type: 'governor',
        label: '调速器',
        system: 'main_engine',
        sensors: {
            actualRpm: { label: '实际转速', unit: 'rpm', default: 0, min: 0, max: 200 },
            setRpm: { label: '设定转速', unit: 'rpm', default: 0, min: 0, max: 200 },
            fuelCommand: { label: '油门指令', unit: '%', default: 0, min: 0, max: 100 },
        },
        initialState: { running: false, setRpm: 0, actualRpm: 0, fuelCommand: 0 },
    },
];

export const GENERATOR_DEVICES = [
    {
        id: 'gen-01',
        type: 'generator',
        label: '1号发电机组',
        system: 'power_station',
        sensors: {
            voltage: { label: '电压', unit: 'V', default: 0, min: 0, max: 450, alarmHigh: 440 },
            current: { label: '电流', unit: 'A', default: 0, min: 0, max: 500 },
            frequency: { label: '频率', unit: 'Hz', default: 0, min: 0, max: 60, alarmHigh: 52 },
            power: { label: '功率', unit: 'kW', default: 0, min: 0, max: 500 },
        },
        actuators: {
            startStop: { label: '启停', default: 0, min: 0, max: 1 },
        },
        initialState: { running: false, voltage: 0, frequency: 0 },
    },
    {
        id: 'switchboard-01',
        type: 'switchboard',
        label: '主配电板',
        system: 'power_station',
        sensors: {
            busVoltage: { label: '母线电压', unit: 'V', default: 0, min: 0, max: 450 },
            busCurrent: { label: '母线电流', unit: 'A', default: 0, min: 0, max: 1000 },
            busFrequency: { label: '母线频率', unit: 'Hz', default: 0, min: 0, max: 60 },
        },
        initialState: { energized: false, busVoltage: 0 },
    },
];

export const FUEL_OIL_DEVICES = [
    {
        id: 'tank-hfo-01',
        type: 'fuel_tank',
        label: '重油仓',
        system: 'fuel_oil',
        sensors: {
            level: { label: '液位', unit: '%', default: 80, min: 0, max: 100, alarmLow: 10 },
            temperature: { label: '温度', unit: '°C', default: 50, min: 0, max: 100 },
        },
        actuators: {
            outletValve: { label: '出口阀', default: 0, min: 0, max: 1 },
        },
        initialState: { level: 80, temperature: 50 },
    },
    {
        id: 'tank-doa-01',
        type: 'fuel_tank',
        label: '日用油柜',
        system: 'fuel_oil',
        sensors: {
            level: { label: '液位', unit: '%', default: 60, min: 0, max: 100, alarmLow: 20 },
            temperature: { label: '温度', unit: '°C', default: 60, min: 0, max: 120 },
        },
        actuators: {
            outletValve: { label: '出口阀', default: 0, min: 0, max: 1 },
        },
        initialState: { level: 60, temperature: 60 },
    },
    {
        id: 'purifier-01',
        type: 'oil_separator',
        label: '分油机',
        system: 'fuel_oil',
        sensors: {
            running: { label: '运行状态', unit: '', default: 0, min: 0, max: 1 },
        },
        actuators: {
            startStop: { label: '启停', default: 0, min: 0, max: 1 },
        },
        initialState: { running: false },
    },
    {
        id: 'pump-hfo-01',
        type: 'pump',
        label: '燃油输送泵',
        system: 'fuel_oil',
        sensors: {
            outletPress: { label: '出口压力', unit: 'kPa', default: 0, min: 0, max: 1000 },
        },
        actuators: {
            startStop: { label: '启停', default: 0, min: 0, max: 1 },
        },
        initialState: { running: false, speed: 0 },
    },
];

export const COMPRESSED_AIR_DEVICES = [
    {
        id: 'compressor-01',
        type: 'air_compressor',
        label: '主空压机',
        system: 'compressed_air',
        sensors: {
            outletPress: { label: '出口压力', unit: 'MPa', default: 0, min: 0, max: 3.0 },
            running: { label: '运行状态', unit: '', default: 0, min: 0, max: 1 },
        },
        actuators: {
            startStop: { label: '启停', default: 0, min: 0, max: 1 },
        },
        initialState: { running: false, pressure: 0 },
    },
    {
        id: 'air-bottle-main',
        type: 'air_bottle',
        label: '主气瓶',
        system: 'compressed_air',
        sensors: {
            pressure: { label: '压力', unit: 'MPa', default: 0, min: 0, max: 3.0, alarmLow: 1.5 },
            volume: { label: '容积', unit: 'L', default: 2000, min: 0, max: 5000 },
        },
        initialState: { pressure: 0 },
    },
    {
        id: 'air-distributor-01',
        type: 'air_distributor',
        label: '空气分配器',
        system: 'compressed_air',
        sensors: {
            supplyPress: { label: '供给压力', unit: 'MPa', default: 0, min: 0, max: 3.0 },
        },
        actuators: {
            startAir: { label: '起动空气', default: 0, min: 0, max: 1 },
            controlAir: { label: '控制空气', default: 0, min: 0, max: 1 },
        },
        initialState: { supplyPress: 0, startAirOpen: false, controlAirOpen: false },
    },
];

/** 全系统统一列表 */
export const PHASE2_ALL_DEVICES = [
    ...MAIN_ENGINE_DEVICES,
    ...GENERATOR_DEVICES,
    ...FUEL_OIL_DEVICES,
    ...COMPRESSED_AIR_DEVICES,
];
```

- [ ] **Step 2: 验证文件**

Run: `ls -la tools/Phase2SystemData.js`

---

### Task 2: ThermalSolver 发动机热模型扩展

**Files:**
- Modify: `tools/ThermalSolver.js`

- [ ] **Step 1: 阅读当前文件**

Run: `cat "e:\BaiduSyncdisk\03 教学材料\仿真软件制作\网站\lab_03\pressmeter01\tools\ThermalSolver.js"`

- [ ] **Step 2: 扩展 ThermalSolver 支持发动机热模型**

在 `addExchanger()` 之后添加：

```javascript
    /**
     * 注册发动机热节点网络
     * @param {Object} config
     * @param {string} config.id
     * @param {Object} [config.coolant]  冷却水初始温度/热容
     * @param {Object} [config.exhaust]  排烟初始温度/热容
     * @param {Object} [config.lubeOil]  滑油初始温度/热容
     */
    addEngine(config) {
        const engine = {
            id: config.id,
            nodes: {},
            _prevFuelRate: 0,
        };

        // 冷却水
        if (config.coolant) {
            const c = config.coolant;
            this.addNode(`${config.id}_coolant`, c.temp || 25, c.capacity || 5000);
            engine.nodes.coolant = `${config.id}_coolant`;
        }

        // 排烟
        if (config.exhaust) {
            const e = config.exhaust;
            this.addNode(`${config.id}_exhaust`, e.temp || 30, e.capacity || 1000);
            engine.nodes.exhaust = `${config.id}_exhaust`;
        }

        // 滑油
        if (config.lubeOil) {
            const l = config.lubeOil;
            this.addNode(`${config.id}_lubeOil`, l.temp || 25, l.capacity || 3000);
            engine.nodes.lubeOil = `${config.id}_lubeOil`;
        }

        if (!this._engines) this._engines = [];
        this._engines.push(engine);
    }
```

在 `solve(dt)` 方法中的冷却水系统热力计算之后添加发动机热模型：

```javascript
        // ── 发动机热模型 ──
        if (this._engines) {
            this._engines.forEach(eng => {
                const eqDevice = eqPool.get(eng.id);
                if (!eqDevice) return;

                const running = eqDevice.state.running || false;
                const fuelRate = eqDevice.state.fuelRate || 0;
                if (!running || fuelRate <= 0) return;

                // 基于喷油量和转速计算发热量
                const rpm = eqDevice.state.speed || 0;
                const heatPower = fuelRate * (rpm / 100 + 0.5) * 100; // 简化热功率

                // 热量分配比例：冷却水 30%, 排烟 40%, 滑油 15%, 做功 15%
                const coolantNode = this._nodes.get(eng.nodes.coolant);
                const exhaustNode = this._nodes.get(eng.nodes.exhaust);
                const oilNode = this._nodes.get(eng.nodes.lubeOil);

                if (coolantNode) {
                    const dT = heatPower * 0.30 * dt / coolantNode.capacity;
                    coolantNode.temp += dT;
                }
                if (exhaustNode) {
                    const dT = heatPower * 0.40 * dt / exhaustNode.capacity;
                    exhaustNode.temp += dT;
                }
                if (oilNode) {
                    const dT = heatPower * 0.15 * dt / oilNode.capacity;
                    oilNode.temp += dT;
                }

                // 更新设备池传感器值
                if (eqDevice.sensors.coolantTemp) {
                    eqDevice.sensors.coolantTemp.value = Math.round(coolantNode?.temp || 25);
                }
                if (eqDevice.sensors.exhaustTemp) {
                    eqDevice.sensors.exhaustTemp.value = Math.round(exhaustNode?.temp || 30);
                }

                eng._prevFuelRate = fuelRate;
            });
        }
```

- [ ] **Step 3: 添加 getNodeTemp 查询方法**

在 `reset()` 之前添加：

```javascript
    /** 查询热节点温度 */
    getNodeTemp(nodeId) {
        return this._nodes.get(nodeId)?.temp || null;
    }
```

- [ ] **Step 4: 验证无语法错误**

Run: `cd "e:\BaiduSyncdisk\03 教学材料\仿真软件制作\网站\lab_03\pressmeter01" && node -e "import('./tools/ThermalSolver.js').then(()=>console.log('OK')).catch(e=>console.log(e.message))"`

---

### Task 3: 柴油机 3D 模型

**Files:**
- Create: `engineroom3d/models/primitives/DieselEngine3D.js`

- [ ] **Step 1: 编写柴油机 3D 模型**

```javascript
import * as THREE from 'three';

/**
 * 创建柴油机 3D 模型（直列 4 缸基础几何体组合）
 * @param {Object} opts
 * @param {number} opts.color 状态颜色
 * @returns {THREE.Group}
 */
export function createDieselEngineModel(opts = {}) {
    const color = opts.color || 0x78909c;
    const group = new THREE.Group();

    // 机体（长方体）
    const block = new THREE.Mesh(
        new THREE.BoxGeometry(3.0, 1.2, 1.0),
        new THREE.MeshStandardMaterial({ color, roughness: 0.7, metalness: 0.3 })
    );
    block.position.y = 0.6;
    group.add(block);

    // 气缸盖（顶部）
    const head = new THREE.Mesh(
        new THREE.BoxGeometry(2.8, 0.15, 0.9),
        new THREE.MeshStandardMaterial({ color: 0x546e7a })
    );
    head.position.set(0, 1.28, 0);
    group.add(head);

    // 排烟管
    const exhaustPipe = new THREE.Mesh(
        new THREE.CylinderGeometry(0.06, 0.06, 2.8, 6),
        new THREE.MeshStandardMaterial({ color: 0x37474f })
    );
    exhaustPipe.position.set(0, 1.5, 0.5);
    exhaustPipe.rotation.x = Math.PI / 2;
    group.add(exhaustPipe);

    // 增压器（圆柱+锥体）
    const turboBody = new THREE.Mesh(
        new THREE.CylinderGeometry(0.25, 0.3, 0.3, 12),
        new THREE.MeshStandardMaterial({ color: 0x607d8b })
    );
    turboBody.position.set(1.6, 1.5, 0);
    group.add(turboBody);

    // 飞轮（圆盘）
    const flywheel = new THREE.Mesh(
        new THREE.CylinderGeometry(0.6, 0.6, 0.15, 16),
        new THREE.MeshStandardMaterial({ color: 0x616161, metalness: 0.6, roughness: 0.4 })
    );
    flywheel.position.set(-1.6, 0.6, 0);
    flywheel.rotation.z = Math.PI / 2;
    group.add(flywheel);

    // 底座
    const base = new THREE.Mesh(
        new THREE.BoxGeometry(3.2, 0.1, 1.2),
        new THREE.MeshStandardMaterial({ color: 0x424242 })
    );
    base.position.y = 0.05;
    group.add(base);

    // 曲轴箱（底部凸起）
    const crankCase = new THREE.Mesh(
        new THREE.BoxGeometry(2.6, 0.3, 0.8),
        new THREE.MeshStandardMaterial({ color: 0x455a64 })
    );
    crankCase.position.y = 0.25;
    group.add(crankCase);

    group.userData.parts = { block, flywheel, turboBody };

    return group;
}
```

- [ ] **Step 2: 验证文件**

Run: `ls -la engineroom3d/models/primitives/DieselEngine3D.js`

---

### Task 4: 调速器 2D 组件

**Files:**
- Create: `components/Governor.js`

- [ ] **Step 1: 编写调速器 2D Konva 组件**

```javascript
import { BaseComponent } from './BaseComponent.js';

/**
 * Governor - 调速器 2D 原理图组件
 * 转速设定、实际转速显示、油门输出
 */
export class Governor extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.type = 'governor';
        this.cache = 'fixed';

        const W = 120;
        const H = 140;

        // 主体矩形
        const rect = new Konva.Rect({
            x: -W / 2, y: -H / 2, width: W, height: H,
            fill: '#e3f2fd', stroke: '#1565c0', strokeWidth: 2,
            cornerRadius: 6,
        });
        this.group.add(rect);

        // 标题
        const title = new Konva.Text({
            x: -W / 2 + 5, y: -H / 2 + 5, width: W - 10,
            text: '调速器', fontSize: 13, fontStyle: 'bold',
            fill: '#0d47a1', align: 'center',
        });
        this.group.add(title);

        // 转速表盘
        const dial = new Konva.Arc({
            x: 0, y: -H / 2 + 40,
            innerRadius: 20, outerRadius: 30,
            angle: 180, fill: '#bbdefb',
            stroke: '#1565c0', strokeWidth: 1,
            rotation: 180,
        });
        this.group.add(dial);

        // 指针
        this.needle = new Konva.Line({
            points: [0, 0, 0, -25],
            x: 0, y: -H / 2 + 40,
            stroke: '#e53935', strokeWidth: 2,
            lineCap: 'round',
        });
        this.group.add(this.needle);

        // 转速数字显示
        this.rpmText = new Konva.Text({
            x: -25, y: -H / 2 + 45, width: 50,
            text: '0 rpm', fontSize: 9,
            fill: '#333', align: 'center',
        });
        this.group.add(this.rpmText);

        // 油门输出指示
        this.fuelText = new Konva.Text({
            x: -W / 2 + 5, y: H / 2 - 30, width: W - 10,
            text: '油门: 0%', fontSize: 10,
            fill: '#2e7d32', align: 'center',
        });
        this.group.add(this.fuelText);

        // 端口：控制输入
        this.addPort(-W / 2, 0, 'ctrl', 'wire');
        // 端口：油门输出
        this.addPort(W / 2, 0, 'fuel_out', 'wire');
    }

    /** 更新调速器显示 */
    updateState(rpm, fuelCommand) {
        const displayRpm = Math.round(rpm || 0);
        const displayFuel = Math.round((fuelCommand || 0) * 100);
        this.rpmText.text(`${displayRpm} rpm`);
        this.fuelText.text(`油门: ${displayFuel}%`);

        // 指针角度: 0rpm=-90deg, 180rpm=90deg
        const angle = -90 + (rpm || 0) * 180 / 180;
        this.needle.rotation(Math.max(-90, Math.min(90, angle)));

        this._refreshCache();
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

Run: `ls -la components/Governor.js`

---

### Task 5: 发电机组 2D 组件

**Files:**
- Create: `components/GeneratorUnit.js`

- [ ] **Step 1: 编写发电机组 2D 组件**

```javascript
import { BaseComponent } from './BaseComponent.js';

/**
 * GeneratorUnit - 发电机组 2D 原理图符号
 * 包含原动机 + 发电机 + 电压/频率表
 */
export class GeneratorUnit extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.type = 'generator';
        this.cache = 'fixed';

        const W = 140;
        const H = 120;

        // 发电机主体（圆形）
        const body = new Konva.Circle({
            x: 0, y: 0, radius: 40,
            fill: '#fff3e0', stroke: '#e65100', strokeWidth: 2,
        });
        this.group.add(body);

        // 转子绕组符号（~）
        const wave = new Konva.Path({
            x: -20, y: -8,
            data: 'M0 8 Q10 -8 20 8 Q30 -8 40 8',
            stroke: '#e65100', strokeWidth: 2,
            fill: null,
        });
        this.group.add(wave);

        // "G" 标签
        const label = new Konva.Text({
            x: -10, y: 15, width: 20,
            text: 'G', fontSize: 18, fontStyle: 'bold',
            fill: '#bf360c', align: 'center',
        });
        this.group.add(label);

        // 电压表
        this.voltText = new Konva.Text({
            x: -W / 2 + 5, y: -H / 2 + 5, width: W - 10,
            text: 'V: 0 V', fontSize: 10,
            fill: '#1b5e20', align: 'left',
        });
        this.group.add(this.voltText);

        // 频率表
        this.freqText = new Konva.Text({
            x: -W / 2 + 5, y: -H / 2 + 18, width: W - 10,
            text: 'Hz: 0.0', fontSize: 10,
            fill: '#1b5e20', align: 'left',
        });
        this.group.add(this.freqText);

        // 端口：电能输出（三相）
        this.addPort(50, -15, 'L1', 'wire');
        this.addPort(50, 0, 'L2', 'wire');
        this.addPort(50, 15, 'L3', 'wire');
    }

    /** 更新仪表显示 */
    updateState(voltage, frequency) {
        this.voltText.text(`V: ${Math.round(voltage || 0)} V`);
        this.freqText.text(`Hz: ${(frequency || 0).toFixed(1)}`);
        this._refreshCache();
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

Run: `ls -la components/GeneratorUnit.js`

---

### Task 6: 配电板 2D 组件

**Files:**
- Create: `components/Switchboard.js`

- [ ] **Step 1: 编写配电板 2D 组件**

```javascript
import { BaseComponent } from './BaseComponent.js';

/**
 * Switchboard - 主配电板 2D 原理图组件
 * 包含母线、断路器、电压/电流/频率表
 */
export class Switchboard extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.type = 'switchboard';
        this.cache = 'fixed';

        const W = 160;
        const H = 140;

        // 配电柜体
        const cabinet = new Konva.Rect({
            x: -W / 2, y: -H / 2, width: W, height: H,
            fill: '#f5f5f5', stroke: '#37474f', strokeWidth: 2,
            cornerRadius: 3,
        });
        this.group.add(cabinet);

        // 标题
        const title = new Konva.Text({
            x: -W / 2 + 5, y: -H / 2 + 5, width: W - 10,
            text: '主配电板', fontSize: 12, fontStyle: 'bold',
            fill: '#263238', align: 'center',
        });
        this.group.add(title);

        // 母线（三条水平线）
        for (let i = 0; i < 3; i++) {
            const bus = new Konva.Line({
                points: [-W / 2 + 15, -H / 2 + 35 + i * 15, W / 2 - 15, -H / 2 + 35 + i * 15],
                stroke: '#f57f17', strokeWidth: 3,
            });
            this.group.add(bus);
        }

        // 母线标签
        const busLabel = new Konva.Text({
            x: -W / 2 + 5, y: -H / 2 + 32,
            text: 'L1 L2 L3', fontSize: 8,
            fill: '#e65100', align: 'center',
        });
        this.group.add(busLabel);

        // 断路器（方形符号）
        for (let i = 0; i < 3; i++) {
            const breaker = new Konva.Rect({
                x: -15 + i * 20, y: -H / 2 + 60,
                width: 12, height: 16,
                fill: '#fff', stroke: '#c62828', strokeWidth: 1.5,
            });
            this.group.add(breaker);
        }

        // 电压表
        this.voltText = new Konva.Text({
            x: -W / 2 + 5, y: -H / 2 + 85, width: W - 10,
            text: 'V: 0 V', fontSize: 10,
            fill: '#1565c0', align: 'left',
        });
        this.group.add(this.voltText);

        // 电流表
        this.ampText = new Konva.Text({
            x: -W / 2 + 5, y: -H / 2 + 100, width: W - 10,
            text: 'A: 0 A', fontSize: 10,
            fill: '#1565c0', align: 'left',
        });
        this.group.add(this.ampText);

        // 频率表
        this.hzText = new Konva.Text({
            x: -W / 2 + 5, y: -H / 2 + 115, width: W - 10,
            text: 'Hz: 0.0', fontSize: 10,
            fill: '#1565c0', align: 'left',
        });
        this.group.add(this.hzText);

        // 端口：发电机进线
        this.addPort(-W / 2, -H / 4, 'gen_in', 'wire');
        // 端口：负载出线
        this.addPort(W / 2, -H / 4, 'load_out', 'wire');
        // 端口：控制信号
        this.addPort(0, H / 2, 'ctrl', 'wire');
    }

    /** 更新仪表显示 */
    updateState(voltage, current, frequency) {
        this.voltText.text(`V: ${Math.round(voltage || 0)} V`);
        this.ampText.text(`A: ${Math.round(current || 0)} A`);
        this.hzText.text(`Hz: ${(frequency || 0).toFixed(1)}`);
        this._refreshCache();
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

Run: `ls -la components/Switchboard.js`

---

### Task 7: 发电机 3D 模型

**Files:**
- Create: `engineroom3d/models/primitives/Generator3D.js`

- [ ] **Step 1: 编写发电机 3D 模型**

```javascript
import * as THREE from 'three';

/**
 * 创建发电机/交流发电机 3D 模型
 * @param {Object} opts
 * @param {number} opts.color 状态颜色
 * @returns {THREE.Group}
 */
export function createGeneratorModel(opts = {}) {
    const color = opts.color || 0x90a4ae;
    const group = new THREE.Group();

    // 定子外壳
    const stator = new THREE.Mesh(
        new THREE.CylinderGeometry(0.7, 0.8, 0.9, 16),
        new THREE.MeshStandardMaterial({ color, metalness: 0.4, roughness: 0.5 })
    );
    stator.position.y = 0.5;
    stator.rotation.z = Math.PI / 2;
    group.add(stator);

    // 前端盖
    const frontCover = new THREE.Mesh(
        new THREE.CircleGeometry(0.7, 16),
        new THREE.MeshStandardMaterial({ color: 0x78909c })
    );
    frontCover.position.set(0.55, 0.5, 0);
    frontCover.rotation.y = Math.PI / 2;
    group.add(frontCover);

    // 后端盖
    const rearCover = new THREE.Mesh(
        new THREE.CircleGeometry(0.7, 16),
        new THREE.MeshStandardMaterial({ color: 0x78909c })
    );
    rearCover.position.set(-0.55, 0.5, 0);
    rearCover.rotation.y = -Math.PI / 2;
    group.add(rearCover);

    // 接线盒
    const jbox = new THREE.Mesh(
        new THREE.BoxGeometry(0.2, 0.25, 0.3),
        new THREE.MeshStandardMaterial({ color: 0x455a64 })
    );
    jbox.position.set(0, 0.9, 0.7);
    group.add(jbox);

    // 底座
    const base = new THREE.Mesh(
        new THREE.BoxGeometry(1.4, 0.1, 0.8),
        new THREE.MeshStandardMaterial({ color: 0x424242 })
    );
    base.position.y = 0.05;
    group.add(base);

    // 轴伸端
    const shaft = new THREE.Mesh(
        new THREE.CylinderGeometry(0.08, 0.1, 0.3, 8),
        new THREE.MeshStandardMaterial({ color: 0x616161, metalness: 0.7 })
    );
    shaft.position.set(0.75, 0.5, 0);
    shaft.rotation.z = Math.PI / 2;
    group.add(shaft);

    group.userData.parts = { stator, base, jbox };

    return group;
}
```

- [ ] **Step 2: 验证文件**

Run: `ls -la engineroom3d/models/primitives/Generator3D.js`

---

### Task 8: 阀门 + 气瓶 3D 模型

**Files:**
- Create: `engineroom3d/models/primitives/Valve3D.js`
- Create: `engineroom3d/models/primitives/AirBottle3D.js`

- [ ] **Step 1: 阀门 3D 模型**

```javascript
import * as THREE from 'three';

/**
 * 创建阀门 3D 模型
 * @param {Object} opts
 * @returns {THREE.Group}
 */
export function createValveModel(opts = {}) {
    const color = opts.color || 0x78909c;
    const group = new THREE.Group();

    // 阀体
    const body = new THREE.Mesh(
        new THREE.SphereGeometry(0.15, 12, 8),
        new THREE.MeshStandardMaterial({ color, roughness: 0.6 })
    );
    body.scale.set(1, 0.8, 0.8);
    body.position.y = 0.15;
    group.add(body);

    // 手轮
    const wheel = new THREE.Mesh(
        new THREE.TorusGeometry(0.1, 0.02, 6, 12),
        new THREE.MeshStandardMaterial({ color: 0xff8f00 })
    );
    wheel.position.y = 0.35;
    group.add(wheel);

    // 阀杆
    const stem = new THREE.Mesh(
        new THREE.CylinderGeometry(0.02, 0.02, 0.15, 6),
        new THREE.MeshStandardMaterial({ color: 0x616161 })
    );
    stem.position.y = 0.28;
    group.add(stem);

    // 法兰接口（两侧）
    const flangeMat = new THREE.MeshStandardMaterial({ color: 0x795548 });
    for (const x of [-0.12, 0.12]) {
        const flange = new THREE.Mesh(
            new THREE.CylinderGeometry(0.05, 0.06, 0.08, 8),
            flangeMat
        );
        flange.position.set(x, 0.15, 0);
        flange.rotation.z = Math.PI / 2;
        group.add(flange);
    }

    return group;
}
```

- [ ] **Step 2: 气瓶 3D 模型**

```javascript
import * as THREE from 'three';

/**
 * 创建空气瓶 3D 模型
 * @param {Object} opts
 * @returns {THREE.Group}
 */
export function createAirBottleModel(opts = {}) {
    const color = opts.color || 0x4db6ac;
    const group = new THREE.Group();

    // 瓶体（长圆柱 + 半球端）
    const body = new THREE.Mesh(
        new THREE.CylinderGeometry(0.25, 0.3, 1.2, 12),
        new THREE.MeshStandardMaterial({ color, metalness: 0.3, roughness: 0.5 })
    );
    body.position.y = 0.6;
    group.add(body);

    // 上端半球封头
    const topCap = new THREE.Mesh(
        new THREE.SphereGeometry(0.25, 10, 8, 0, Math.PI * 2, 0, Math.PI / 2),
        new THREE.MeshStandardMaterial({ color })
    );
    topCap.position.y = 1.2;
    group.add(topCap);

    // 下端半球封头
    const bottomCap = new THREE.Mesh(
        new THREE.SphereGeometry(0.3, 10, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2),
        new THREE.MeshStandardMaterial({ color })
    );
    bottomCap.position.y = 0;
    bottomCap.rotation.z = Math.PI;
    group.add(bottomCap);

    // 阀门
    const valve = new THREE.Mesh(
        new THREE.CylinderGeometry(0.04, 0.05, 0.1, 6),
        new THREE.MeshStandardMaterial({ color: 0xff8f00 })
    );
    valve.position.y = 1.3;
    group.add(valve);

    // 底座
    const base = new THREE.Mesh(
        new THREE.CylinderGeometry(0.35, 0.4, 0.05, 8),
        new THREE.MeshStandardMaterial({ color: 0x616161 })
    );
    base.position.y = 0.025;
    group.add(base);

    return group;
}
```

- [ ] **Step 3: 验证文件**

Run: `ls -la engineroom3d/models/primitives/Valve3D.js engineroom3d/models/primitives/AirBottle3D.js`

---

### Task 9: 燃油柜 + 分油机 2D 组件

**Files:**
- Create: `components/FuelTank.js`
- Create: `components/OilSeparator.js`

- [ ] **Step 1: 燃油柜 2D 组件**

```javascript
import { BaseComponent } from './BaseComponent.js';

/**
 * FuelTank - 燃油舱/日用柜 2D 原理图组件
 * 带液位指示和温度显示
 */
export class FuelTank extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.type = 'fuel_tank';
        this.cache = 'fixed';

        const W = 80;
        const H = 120;

        // 柜体（圆角矩形，象征油柜）
        const tank = new Konva.Rect({
            x: -W / 2, y: -H / 2, width: W, height: H,
            fill: '#fce4ec', stroke: '#b71c1c', strokeWidth: 2,
            cornerRadius: 4,
        });
        this.group.add(tank);

        // 液位指示条
        this.levelBar = new Konva.Rect({
            x: -W / 2 + 10, y: -H / 2 + 10,
            width: W - 20, height: H - 20,
            fill: '#ffcdd2', stroke: '#ef9a9a', strokeWidth: 1,
        });
        this.group.add(this.levelBar);

        // 液位填充
        this.levelFill = new Konva.Rect({
            x: -W / 2 + 12, y: -H / 2 + 12,
            width: W - 24, height: 0,
            fill: '#c62828',
            cornerRadius: 2,
        });
        this.group.add(this.levelFill);

        // 液位文字
        this.levelText = new Konva.Text({
            x: -W / 2 + 5, y: H / 2 - 30, width: W - 10,
            text: '0%', fontSize: 11,
            fill: '#fff', align: 'center',
            fontStyle: 'bold',
        });
        this.group.add(this.levelText);

        // 温度显示
        this.tempText = new Konva.Text({
            x: -W / 2 + 5, y: H / 2 - 16, width: W - 10,
            text: '25°C', fontSize: 9,
            fill: '#c62828', align: 'center',
        });
        this.group.add(this.tempText);

        // 端口
        this.addPort(0, -H / 2, 'inlet', 'pipe');
        this.addPort(0, H / 2, 'outlet', 'pipe');
    }

    /** 更新液位显示 */
    updateState(level, temperature) {
        const H = this.height || 120;
        const pct = Math.max(0, Math.min(1, (level || 0) / 100));
        const fillH = (H - 24) * pct;
        this.levelFill.height(fillH);
        this.levelFill.y(-H / 2 + 12 + (H - 24 - fillH));
        this.levelText.text(`${Math.round(level || 0)}%`);
        this.tempText.text(`${Math.round(temperature || 25)}°C`);
        this._refreshCache();
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

- [ ] **Step 2: 分油机 2D 组件**

```javascript
import { BaseComponent } from './BaseComponent.js';

/**
 * OilSeparator - 分油机 2D 原理图符号
 * 用于燃油/滑油净化系统
 */
export class OilSeparator extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.type = 'oil_separator';
        this.cache = 'fixed';

        const R = 35;

        // 分离筒（圆形）
        const bowl = new Konva.Circle({
            x: 0, y: 0, radius: R,
            fill: '#e8f5e9', stroke: '#2e7d32', strokeWidth: 2,
        });
        this.group.add(bowl);

        // 同心圆（象征离心分离）
        for (let i = 1; i <= 3; i++) {
            const ring = new Konva.Circle({
                x: 0, y: 0, radius: R * i / 4,
                stroke: '#a5d6a7', strokeWidth: 1,
                fill: null,
            });
            this.group.add(ring);
        }

        // 标签
        const label = new Konva.Text({
            x: -15, y: -8, width: 30,
            text: 'sep', fontSize: 10, fontStyle: 'bold',
            fill: '#1b5e20', align: 'center',
        });
        this.group.add(label);

        // 运行指示灯
        this.runLight = new Konva.Circle({
            x: R - 8, y: -R + 8, radius: 4,
            fill: '#9e9e9e',
        });
        this.group.add(this.runLight);

        // 端口
        this.addPort(0, -R, 'inlet', 'pipe');
        this.addPort(-R / 2, R, 'oil_out', 'pipe');
        this.addPort(R / 2, R, 'water_out', 'pipe');
    }

    /** 更新状态 */
    updateState(running) {
        this.runLight.fill(running ? '#4caf50' : '#9e9e9e');
        this._refreshCache();
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

- [ ] **Step 3: 验证文件**

Run: `ls -la components/FuelTank.js components/OilSeparator.js`

---

### Task 10: 空气分配器 2D 组件

**Files:**
- Create: `components/AirDistributor.js`

- [ ] **Step 1: 编写空气分配器 2D 组件**

```javascript
import { BaseComponent } from './BaseComponent.js';

/**
 * AirDistributor - 压缩空气分配系统 2D 组件
 * 含起动空气 + 控制空气双路输出
 */
export class AirDistributor extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.type = 'air_distributor';
        this.cache = 'fixed';

        const W = 140;
        const H = 130;

        // 分配器主体
        const rect = new Konva.Rect({
            x: -W / 2, y: -H / 2, width: W, height: H,
            fill: '#e3f2fd', stroke: '#0d47a1', strokeWidth: 2,
            cornerRadius: 6,
        });
        this.group.add(rect);

        // 标题
        const title = new Konva.Text({
            x: -W / 2 + 5, y: -H / 2 + 5, width: W - 10,
            text: '空气分配器', fontSize: 12, fontStyle: 'bold',
            fill: '#0d47a1', align: 'center',
        });
        this.group.add(title);

        // 起动空气路
        const startLabel = new Konva.Text({
            x: -W / 2 + 10, y: -H / 2 + 35,
            text: '起动空气', fontSize: 10,
            fill: '#1565c0',
        });
        this.group.add(startLabel);

        this.startIndicator = new Konva.Rect({
            x: -W / 2 + 10, y: -H / 2 + 50,
            width: 50, height: 12,
            fill: '#bbdefb', stroke: '#64b5f6', strokeWidth: 1,
            cornerRadius: 2,
        });
        this.group.add(this.startIndicator);

        this.startText = new Konva.Text({
            x: -W / 2 + 12, y: -H / 2 + 50, width: 46,
            text: '关', fontSize: 9,
            fill: '#333', align: 'center',
        });
        this.group.add(this.startText);

        // 控制空气路
        const ctrlLabel = new Konva.Text({
            x: -W / 2 + 10, y: -H / 2 + 70,
            text: '控制空气', fontSize: 10,
            fill: '#1565c0',
        });
        this.group.add(ctrlLabel);

        this.ctrlIndicator = new Konva.Rect({
            x: -W / 2 + 10, y: -H / 2 + 85,
            width: 50, height: 12,
            fill: '#bbdefb', stroke: '#64b5f6', strokeWidth: 1,
            cornerRadius: 2,
        });
        this.group.add(this.ctrlIndicator);

        this.ctrlText = new Konva.Text({
            x: -W / 2 + 12, y: -H / 2 + 85, width: 46,
            text: '关', fontSize: 9,
            fill: '#333', align: 'center',
        });
        this.group.add(this.ctrlText);

        // 压力显示
        this.pressText = new Konva.Text({
            x: 15, y: -H / 2 + 50, width: W - 20,
            text: 'P: 0.0 MPa', fontSize: 10,
            fill: '#1b5e20', align: 'right',
        });
        this.group.add(this.pressText);

        // 端口
        this.addPort(0, -H / 2, 'supply', 'pipe');
        this.addPort(-W / 2, H / 4, 'start_out', 'pipe');
        this.addPort(W / 2, H / 4, 'ctrl_out', 'pipe');
    }

    /** 更新状态 */
    updateState(supplyPress, startAirOn, controlAirOn) {
        this.pressText.text(`P: ${(supplyPress || 0).toFixed(1)} MPa`);
        this.startIndicator.fill(startAirOn ? '#4caf50' : '#bbdefb');
        this.startText.text(startAirOn ? '开' : '关');
        this.ctrlIndicator.fill(controlAirOn ? '#4caf50' : '#bbdefb');
        this.ctrlText.text(controlAirOn ? '开' : '关');
        this._refreshCache();
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

Run: `ls -la components/AirDistributor.js`

---

### Task 11: ModelLoader 注册 + LayoutData 扩展

**Files:**
- Modify: `engineroom3d/models/ModelLoader.js`
- Modify: `engineroom3d/layout/LayoutData.js`

- [ ] **Step 1: 在 ModelLoader 中注册新 3D 模型工厂**

在文件顶部导入区域添加：

```javascript
import { createDieselEngineModel } from './primitives/DieselEngine3D.js';
import { createGeneratorModel } from './primitives/Generator3D.js';
import { createValveModel } from './primitives/Valve3D.js';
import { createAirBottleModel } from './primitives/AirBottle3D.js';
```

在 `this._factories` 中追加：

```javascript
            'diesel_engine':     (opts) => createDieselEngineModel(opts),
            'generator':         (opts) => createGeneratorModel(opts),
            'valve':             (opts) => createValveModel(opts),
            'air_bottle':        (opts) => createAirBottleModel(opts),
```

- [ ] **Step 2: 扩展 LayoutData — 添加 Phase 2 设备布局**

在 `COOLING_LAYOUT` 同级新建 `PHASE2_LAYOUT`：

```javascript
/**
 * PHASE2_LAYOUT - Phase 2 设备 3D 空间布局
 * 在冷却水系统基础上扩展四大核心系统
 */
export const PHASE2_LAYOUT = {
    decks: [
        { y: 0, width: 16, depth: 12, color: 0x37474f },
        { y: 2.8, width: 16, depth: 12, color: 0x37474f },
    ],

    devices: [
        // ── 主动力系统 (左侧区域) ──
        { id: 'me-01',              type: 'diesel_engine',  position: new THREE.Vector3(-5.0, 0.6, 0),    scale: 1.0 },
        { id: 'governor-01',        type: 'governor',       position: new THREE.Vector3(-5.0, 2.0, 2.5), scale: 0.5 },

        // ── 电站系统 (右侧区域) ──
        { id: 'gen-01',             type: 'generator',      position: new THREE.Vector3(5.0, 0.5, 0),    scale: 1.0 },
        { id: 'switchboard-01',     type: 'switchboard',    position: new THREE.Vector3(5.0, 0.5, 3.0),  scale: 0.8 },

        // ── 燃油系统 (后方区域) ──
        { id: 'tank-hfo-01',        type: 'fuel_tank',      position: new THREE.Vector3(-3.0, 0.3, 4.5), scale: 0.8 },
        { id: 'tank-doa-01',        type: 'fuel_tank',      position: new THREE.Vector3(-1.5, 0.3, 4.5), scale: 0.8 },
        { id: 'purifier-01',        type: 'oil_separator',  position: new THREE.Vector3(0, 0.3, 3.5),    scale: 0.6 },
        { id: 'pump-hfo-01',        type: 'pump',           position: new THREE.Vector3(-2.0, 0.4, 2.5), scale: 0.8 },

        // ── 压缩空气系统 (右后方区域) ──
        { id: 'compressor-01',      type: 'compressor',     position: new THREE.Vector3(3.0, 0.4, 4.0),  scale: 0.8 },
        { id: 'air-bottle-main',    type: 'air_bottle',     position: new THREE.Vector3(4.5, 0.6, 4.0),  scale: 0.8 },
        { id: 'air-distributor-01', type: 'air_distributor',position: new THREE.Vector3(3.0, 0.3, 2.0),  scale: 0.6 },
    ],

    // 管路路径（简化版，仅示意系统间连接）
    pipes: [
        // 燃油：油柜 → 日用柜 → 分油机 → 主机
        { from: [-3.0, 0.3, 4.5],  to: [-1.5, 0.3, 4.5],  color: 0x795548 },
        { from: [-1.5, 0.3, 4.5],  to: [0, 0.3, 3.5],     color: 0x795548 },
        { from: [0, 0.3, 3.5],     to: [-0.5, 0.3, 2.5],  color: 0x795548 },
        { from: [-0.5, 0.3, 2.5],  to: [-3.0, 0.3, 1.5],  color: 0x795548 },
        { from: [-3.0, 0.3, 1.5],  to: [-4.0, 0.6, 0.5],  color: 0x795548 },

        // 压缩空气：空压机 → 气瓶 → 分配器
        { from: [3.0, 0.3, 4.0],   to: [4.5, 0.3, 4.0],   color: 0x4fc3f7 },
        { from: [4.5, 0.3, 4.0],   to: [3.5, 0.3, 3.0],   color: 0x4fc3f7 },
        { from: [3.5, 0.3, 3.0],   to: [3.0, 0.3, 2.0],   color: 0x4fc3f7 },
        { from: [3.0, 0.3, 2.0],   to: [3.0, 0.3, 1.5],   color: 0x4fc3f7 },
    ],
};
```

- [ ] **Step 3: 验证无语法错误**

Run: `cd "e:\BaiduSyncdisk\03 教学材料\仿真软件制作\网站\lab_03\pressmeter01" && node -e "import('./engineroom3d/models/ModelLoader.js').then(()=>console.log('OK')).catch(e=>console.log('ModelLoader:', e.message)); import('./engineroom3d/layout/LayoutData.js').then(()=>console.log('LayoutData OK')).catch(e=>console.log('LayoutData:', e.message))"`

---

### Task 12: export.js 导出新模块

**Files:**
- Modify: `export.js`

- [ ] **Step 1: 添加导入**

在 `components` 导入区块追加：

```javascript
import { Governor } from './components/Governor.js';
import { GeneratorUnit } from './components/GeneratorUnit.js';
import { Switchboard } from './components/Switchboard.js';
import { FuelTank } from './components/FuelTank.js';
import { OilSeparator } from './components/OilSeparator.js';
import { AirDistributor } from './components/AirDistributor.js';
```

在 `tools` 导入区块追加：

```javascript
import { PHASE2_ALL_DEVICES, MAIN_ENGINE_DEVICES, GENERATOR_DEVICES, FUEL_OIL_DEVICES, COMPRESSED_AIR_DEVICES } from './tools/Phase2SystemData.js';
```

- [ ] **Step 2: 添加导出**

在 `export { BourdonTube, DiaphragmGauge, ... }` 行追加：

```javascript
    Governor, GeneratorUnit, Switchboard, FuelTank, OilSeparator, AirDistributor,
```

在 `export { EventBus, EquipmentPool, ... }` 行追加：

```javascript
    PHASE2_ALL_DEVICES, MAIN_ENGINE_DEVICES, GENERATOR_DEVICES, FUEL_OIL_DEVICES, COMPRESSED_AIR_DEVICES,
```

---

### Task 13: consys.js 集成 Phase 2 系统

**Files:**
- Modify: `consys.js`

- [ ] **Step 1: 添加 Phase 2 数据导入**

在 `import { COOLING_SYSTEM_DEVICES }` 附近添加：

```javascript
import { PHASE2_ALL_DEVICES } from './tools/Phase2SystemData.js';
```

- [ ] **Step 2: 注册 Phase 2 设备到 EquipmentPool**

在 `COOLING_SYSTEM_DEVICES.forEach(cfg => this.equipmentPool.register(cfg));` 之后添加：

```javascript
        // 注册 Phase 2 系统设备到对象池
        PHASE2_ALL_DEVICES.forEach(cfg => this.equipmentPool.register(cfg));
```

- [ ] **Step 3: 初始化 ThermalSolver 发动机热节点**

在 `this.thermalSolver = new ThermalSolver(this);` 之后添加：

```javascript
        // 注册发动机热节点网络
        if (this.thermalSolver.addEngine) {
            this.thermalSolver.addEngine({
                id: 'me-01',
                coolant: { temp: 25, capacity: 5000 },
                exhaust: { temp: 30, capacity: 1000 },
                lubeOil: { temp: 25, capacity: 3000 },
            });
        }
```

- [ ] **Step 4: 在工具栏添加 Phase 2 系统切换选项**

在 main.js 的 taskSelect 初始化部分，确认任务选择下拉框已包含 Phase 2 工作流选项（WorkflowManager 中已有 initSteps 处理下拉框填充，此步骤仅做确认）。

---

### Task 14: 构建验证

**Files:**
- Verify: 整个项目

- [ ] **Step 1: 构建项目**

Run: `cd "e:\BaiduSyncdisk\03 教学材料\仿真软件制作\网站\lab_03\pressmeter01" && pnpm run build 2>&1`

Expected: 构建成功，无错误

- [ ] **Step 2: 验证构建产物中包含新模块**

Run: `ls -la dist/assets/ | findstr -i "engine generator valve bottle governor"`

Expected: 构建产物中包含新模块的 chunk

---

## 自检清单

- [ ] 所有文件路径均为绝对或正确相对路径
- [ ] 每个文件职责单一、清晰
- [ ] 所有新模块通过 export.js 统一导出
- [ ] 无"TBD/TODO/稍后实现"等占位符
- [ ] 类型和方法签名跨任务一致
- [ ] Phase 2 设备布局与 Phase 1 冷却水布局不重叠（避免坐标冲突）
- [ ] 不允许 `require()`（项目使用 ESM）
