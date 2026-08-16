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
