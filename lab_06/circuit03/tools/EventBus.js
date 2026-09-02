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
