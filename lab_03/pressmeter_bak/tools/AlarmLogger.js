/**
 * AlarmLogger - 报警记录模块
 * 监听 equipment:alarm 事件，将报警记录写入 IndexedDB
 * 数据库：PressmeterDB，存储对象：alarms（自增 ID）
 */
export class AlarmLogger {
    constructor(eventBus) {
        this._db = null; // Promise<IDBDatabase>
        this._initDB();
        // 订阅 equipment:alarm 事件
        this._unsub = eventBus.on('equipment:alarm', (payload) => this._onAlarm(payload));
        this._eventBus = eventBus;
    }

    /**
     * 初始化 IndexedDB 连接（共享数据库 PressmeterDB，version 2）
     * 同时创建 alarms 和 snapshots 两个 store，确保与 HistoryRecorder 兼容
     */
    async _initDB() {
        this._db = new Promise((resolve, reject) => {
            const req = indexedDB.open('PressmeterDB', 2);
            req.onupgradeneeded = (e) => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains('alarms')) {
                    db.createObjectStore('alarms', { keyPath: 'id', autoIncrement: true });
                }
                if (!db.objectStoreNames.contains('snapshots')) {
                    db.createObjectStore('snapshots', { keyPath: 'id', autoIncrement: true });
                }
            };
            req.onsuccess = (e) => resolve(e.target.result);
            req.onerror = (e) => {
                console.error('[AlarmLogger] DB open error:', e.target.error);
                reject(e.target.error);
            };
        });
    }

    /**
     * 内部：等待数据库就绪
     */
    async _getDB() {
        const db = await this._db;
        if (!db) throw new Error('[AlarmLogger] Database not initialized');
        return db;
    }

    /**
     * 处理 equipment:alarm 事件
     */
    async _onAlarm(payload) {
        if (!payload || !payload.id) return;
        try {
            const record = {
                timestamp: Date.now(),
                deviceId: payload.id,
                message: payload.message || '',
                severity: payload.severity || 'info',
                type: payload.type || 'default',
                acknowledged: false,
            };
            const db = await this._getDB();
            const tx = db.transaction('alarms', 'readwrite');
            const store = tx.objectStore('alarms');
            const req = store.add(record);
            req.onsuccess = () => {
                record.id = req.result;
                // 在 alarm:log 通道上重新发出完整记录
                if (this._eventBus) {
                    this._eventBus.emit('alarm:log', record);
                }
            };
            req.onerror = (e) => {
                console.error('[AlarmLogger] Failed to write alarm:', e.target.error);
            };
        } catch (err) {
            console.error('[AlarmLogger] _onAlarm error:', err);
        }
    }

    /**
     * 获取所有报警记录（按时间倒序）
     */
    async getAll() {
        try {
            const db = await this._getDB();
            return new Promise((resolve, reject) => {
                const tx = db.transaction('alarms', 'readonly');
                const store = tx.objectStore('alarms');
                const req = store.getAll();
                req.onsuccess = () => {
                    const records = req.result || [];
                    records.sort((a, b) => b.timestamp - a.timestamp);
                    resolve(records);
                };
                req.onerror = (e) => reject(e.target.error);
            });
        } catch (err) {
            console.error('[AlarmLogger] getAll error:', err);
            return [];
        }
    }

    /**
     * 按设备 ID 查询报警
     */
    async getByDevice(deviceId) {
        try {
            const all = await this.getAll();
            return all.filter(r => r.deviceId === deviceId);
        } catch (err) {
            console.error('[AlarmLogger] getByDevice error:', err);
            return [];
        }
    }

    /**
     * 获取未确认的报警
     */
    async getUnacknowledged() {
        try {
            const all = await this.getAll();
            return all.filter(r => !r.acknowledged);
        } catch (err) {
            console.error('[AlarmLogger] getUnacknowledged error:', err);
            return [];
        }
    }

    /**
     * 确认指定 ID 的报警
     */
    async acknowledge(id) {
        try {
            const db = await this._getDB();
            return new Promise((resolve, reject) => {
                const tx = db.transaction('alarms', 'readwrite');
                const store = tx.objectStore('alarms');
                const getReq = store.get(id);
                getReq.onsuccess = () => {
                    const record = getReq.result;
                    if (record) {
                        record.acknowledged = true;
                        store.put(record);
                    }
                    resolve();
                };
                getReq.onerror = (e) => reject(e.target.error);
            });
        } catch (err) {
            console.error('[AlarmLogger] acknowledge error:', err);
        }
    }

    /**
     * 清除所有报警记录
     */
    async clear() {
        try {
            const db = await this._getDB();
            return new Promise((resolve, reject) => {
                const tx = db.transaction('alarms', 'readwrite');
                const store = tx.objectStore('alarms');
                const req = store.clear();
                req.onsuccess = () => resolve();
                req.onerror = (e) => reject(e.target.error);
            });
        } catch (err) {
            console.error('[AlarmLogger] clear error:', err);
        }
    }

    /**
     * 释放资源
     */
    dispose() {
        if (this._unsub) this._unsub();
        this._eventBus = null;
        this._db = null;
    }
}
