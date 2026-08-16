/**
 * HistoryRecorder - 历史数据记录模块
 * 每 1 秒对所有设备状态进行快照并写入 IndexedDB
 * 数据库：PressmeterDB，存储对象：snapshots（自增 ID）
 * 最多保留 3600 条记录（1 小时）
 */
export class HistoryRecorder {
    constructor(pool, eventBus) {
        this._pool = pool;
        this._eventBus = eventBus;
        this._timer = null;
        this._db = null; // Promise<IDBDatabase>
        this._maxRecords = 3600;
        this._initDB();
    }

    /**
     * 初始化 IndexedDB 连接（共享数据库 PressmeterDB，version 2）
     * 同时创建 alarms 和 snapshots 两个 store，确保与 AlarmLogger 兼容
     */
    async _initDB() {
        this._db = new Promise((resolve, reject) => {
            const req = indexedDB.open('PressmeterDB', 2);
            req.onupgradeneeded = (e) => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains('snapshots')) {
                    db.createObjectStore('snapshots', { keyPath: 'id', autoIncrement: true });
                }
                if (!db.objectStoreNames.contains('alarms')) {
                    db.createObjectStore('alarms', { keyPath: 'id', autoIncrement: true });
                }
            };
            req.onsuccess = (e) => resolve(e.target.result);
            req.onerror = (e) => {
                console.error('[HistoryRecorder] DB open error:', e.target.error);
                reject(e.target.error);
            };
        });
    }

    /**
     * 内部：等待数据库就绪
     */
    async _getDB() {
        const db = await this._db;
        if (!db) throw new Error('[HistoryRecorder] Database not initialized');
        return db;
    }

    /**
     * 开始记录（每 1 秒一次快照）
     */
    start() {
        if (this._timer) return;
        this._timer = setInterval(() => this._snapshot(), 1000);
    }

    /**
     * 停止记录
     */
    stop() {
        if (this._timer) {
            clearInterval(this._timer);
            this._timer = null;
        }
    }

    /**
     * 执行一次快照：采集所有设备状态并写入 DB
     */
    async _snapshot() {
        try {
            const allDevices = this._pool.getAll();
            const states = {};
            allDevices.forEach(dev => {
                states[dev.id] = {
                    type: dev.type,
                    label: dev.label,
                    state: { ...dev.state },
                    sensors: dev.sensors ? Object.keys(dev.sensors).reduce((acc, k) => {
                        acc[k] = dev.sensors[k].value;
                        return acc;
                    }, {}) : {},
                    actuators: dev.actuators ? Object.keys(dev.actuators).reduce((acc, k) => {
                        acc[k] = dev.actuators[k].value;
                        return acc;
                    }, {}) : {},
                };
            });

            const record = {
                timestamp: Date.now(),
                states,
            };

            const db = await this._getDB();
            const tx = db.transaction('snapshots', 'readwrite');
            const store = tx.objectStore('snapshots');
            store.add(record);

            // 发出快照事件
            if (this._eventBus) {
                this._eventBus.emit('history:snapshot', { timestamp: record.timestamp, deviceCount: Object.keys(states).length });
            }

            // 修剪超出最大数量的旧记录
            this._trimExcess();
        } catch (err) {
            console.error('[HistoryRecorder] _snapshot error:', err);
        }
    }

    /**
     * 修剪多余的旧记录，只保留最新的 _maxRecords 条
     * 使用游标按插入顺序（即 ID 升序）删除最旧的记录
     */
    async _trimExcess(store) {
        try {
            const db = await this._getDB();
            const countReq = db.transaction('snapshots', 'readonly').objectStore('snapshots').count();
            countReq.onsuccess = () => {
                const count = countReq.result;
                if (count <= this._maxRecords) return;

                const excess = count - this._maxRecords;
                const tx = db.transaction('snapshots', 'readwrite');
                const trimStore = tx.objectStore('snapshots');
                const cursorReq = trimStore.openCursor();
                let deleted = 0;
                cursorReq.onsuccess = (e) => {
                    const cursor = e.target.result;
                    if (!cursor || deleted >= excess) return;
                    trimStore.delete(cursor.primaryKey);
                    deleted++;
                    cursor.continue();
                };
            };
        } catch (err) {
            // 静默处理
        }
    }

    /**
     * 获取所有快照（按时间升序）
     */
    async getAll() {
        try {
            const db = await this._getDB();
            return new Promise((resolve, reject) => {
                const tx = db.transaction('snapshots', 'readonly');
                const store = tx.objectStore('snapshots');
                const req = store.getAll();
                req.onsuccess = () => {
                    const records = req.result || [];
                    records.sort((a, b) => a.timestamp - b.timestamp);
                    resolve(records);
                };
                req.onerror = (e) => reject(e.target.error);
            });
        } catch (err) {
            console.error('[HistoryRecorder] getAll error:', err);
            return [];
        }
    }

    /**
     * 获取指定时间范围内的快照
     */
    async getRange(fromTime, toTime) {
        try {
            const all = await this.getAll();
            return all.filter(r => r.timestamp >= fromTime && r.timestamp <= toTime);
        } catch (err) {
            console.error('[HistoryRecorder] getRange error:', err);
            return [];
        }
    }

    /**
     * 清除所有快照
     */
    async clear() {
        try {
            const db = await this._getDB();
            return new Promise((resolve, reject) => {
                const tx = db.transaction('snapshots', 'readwrite');
                const store = tx.objectStore('snapshots');
                const req = store.clear();
                req.onsuccess = () => resolve();
                req.onerror = (e) => reject(e.target.error);
            });
        } catch (err) {
            console.error('[HistoryRecorder] clear error:', err);
        }
    }

    /**
     * 释放资源
     */
    dispose() {
        this.stop();
        this._pool = null;
        this._eventBus = null;
        this._db = null;
    }
}
