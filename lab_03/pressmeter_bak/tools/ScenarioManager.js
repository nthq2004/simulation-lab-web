/**
 * ScenarioManager - 工况场景管理器
 * 注册、查询和应用预置工况场景
 */
export class ScenarioManager {
    /**
     * @param {import('./EquipmentPool.js').EquipmentPool} pool 设备对象池
     * @param {import('./EventBus.js').EventBus} eventBus 事件总线
     */
    constructor(pool, eventBus) {
        this._pool = pool;
        this._eventBus = eventBus;
        this._scenarios = new Map();
    }

    /**
     * 注册一个场景
     * @param {string} id 场景唯一标识
     * @param {object} scenario 场景定义（含 name, description, states, faults?）
     */
    register(id, scenario) {
        if (!id || !scenario || typeof scenario.name !== 'string' || !scenario.states) {
            console.warn(`[ScenarioManager] invalid scenario registration:`, { id, scenario });
            return;
        }
        this._scenarios.set(id, { ...scenario, id });
    }

    /**
     * 获取指定场景
     * @param {string} id
     * @returns {object|null}
     */
    get(id) {
        return this._scenarios.get(id) || null;
    }

    /**
     * 获取所有已注册场景
     * @returns {object[]}
     */
    getAll() {
        return Array.from(this._scenarios.values());
    }

    /**
     * 应用一个场景：重置所有设备 → 应用场景状态 → 触发事件
     * @param {string} id 场景标识
     */
    apply(id) {
        const scenario = this._scenarios.get(id);
        if (!scenario) {
            console.warn(`[ScenarioManager] 未知场景: ${id}`);
            return;
        }

        // 1. 重置所有设备到初始状态
        this._resetAllDevices();

        // 2. 应用场景定义的设备状态
        if (scenario.states) {
            Object.entries(scenario.states).forEach(([devId, state]) => {
                const dev = this._pool.get(devId);
                if (dev) {
                    Object.assign(dev.state, state);
                    if (this._eventBus) {
                        this._eventBus.emit('equipment:stateChange', {
                            id: devId,
                            state: { ...dev.state },
                        });
                    }
                }
            });
        }

        // 3. 发射场景应用事件
        if (this._eventBus) {
            this._eventBus.emit('scenario:apply', { id, name: scenario.name });
        }

        console.log(`[ScenarioManager] 已应用场景: ${scenario.name} (${id})`);
    }

    /**
     * 将所有设备的常见状态字段归零
     */
    _resetAllDevices() {
        const all = this._pool.getAll();
        all.forEach(dev => {
            Object.keys(dev.state).forEach(key => {
                const val = dev.state[key];
                if (typeof val === 'number') dev.state[key] = 0;
                else if (typeof val === 'boolean') dev.state[key] = false;
                else if (typeof val === 'string') dev.state[key] = '';
                else if (Array.isArray(val)) dev.state[key] = [];
            });
        });
    }
}
