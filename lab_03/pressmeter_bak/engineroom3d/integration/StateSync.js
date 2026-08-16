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
