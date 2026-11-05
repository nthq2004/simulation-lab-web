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
