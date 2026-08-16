/**
 * ActionLogger - 学员操作记录模块
 * 监听 EventBus 事件，将学员操作、设备选择、流程步骤等记录写入 IndexedDB
 * 数据库：PressmeterDB，存储对象：actions（自增 ID）
 */
export class ActionLogger {
    /**
     * @param {EventBus} eventBus
     */
    constructor(eventBus) {
        this._eventBus = eventBus;
        this._db = null;
        this._initDB();

        // 订阅需要记录的事件
        this._unsubs = [];
        this._unsubs.push(eventBus.on('equipment:select', (payload) => this._onEvent('equipment:select', payload)));
        this._unsubs.push(eventBus.on('workflow:step', (payload) => this._onEvent('workflow:step', payload)));
        this._unsubs.push(eventBus.on('session:action', (payload) => this._onEvent('session:action', payload)));
    }

    /**
     * 初始化 IndexedDB（复用 PressmeterDB，升级到 version 3 以添加 actions 和 reports 存储）
     */
    async _initDB() {
        this._db = new Promise((resolve, reject) => {
            // 尝试打开 version 3（兼容现有 version 2 数据库）
            const req = indexedDB.open('PressmeterDB', 3);
            req.onupgradeneeded = (e) => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains('alarms')) {
                    db.createObjectStore('alarms', { keyPath: 'id', autoIncrement: true });
                }
                if (!db.objectStoreNames.contains('snapshots')) {
                    db.createObjectStore('snapshots', { keyPath: 'id', autoIncrement: true });
                }
                if (!db.objectStoreNames.contains('actions')) {
                    db.createObjectStore('actions', { keyPath: 'id', autoIncrement: true });
                }
                if (!db.objectStoreNames.contains('reports')) {
                    db.createObjectStore('reports', { keyPath: 'id', autoIncrement: true });
                }
            };
            req.onsuccess = (e) => resolve(e.target.result);
            req.onerror = (e) => {
                console.error('[ActionLogger] DB open error:', e.target.error);
                reject(e.target.error);
            };
        });
    }

    /**
     * 获取数据库实例
     */
    async _getDB() {
        const db = await this._db;
        if (!db) throw new Error('[ActionLogger] Database not initialized');
        return db;
    }

    /**
     * 处理事件，写入 IndexedDB
     */
    async _onEvent(topic, payload) {
        if (!payload) return;
        try {
            const record = {
                timestamp: Date.now(),
                topic: topic,
                type: payload.action || payload.type || topic,
                target: payload.id || payload.target || '',
                sessionId: payload.sessionId || '',
                details: JSON.parse(JSON.stringify(payload)),
            };
            const db = await this._getDB();
            const tx = db.transaction('actions', 'readwrite');
            const store = tx.objectStore('actions');
            const req = store.add(record);
            req.onerror = (e) => {
                console.error('[ActionLogger] Failed to write action:', e.target.error);
            };
        } catch (err) {
            console.error('[ActionLogger] _onEvent error:', err);
        }
    }

    /**
     * 获取所有操作记录（按时间倒序）
     */
    async getAll() {
        try {
            const db = await this._getDB();
            return new Promise((resolve, reject) => {
                const tx = db.transaction('actions', 'readonly');
                const store = tx.objectStore('actions');
                const req = store.getAll();
                req.onsuccess = () => {
                    const records = req.result || [];
                    records.sort((a, b) => b.timestamp - a.timestamp);
                    resolve(records);
                };
                req.onerror = (e) => reject(e.target.error);
            });
        } catch (err) {
            console.error('[ActionLogger] getAll error:', err);
            return [];
        }
    }

    /**
     * 按会话 ID 查询操作记录（按时间正序）
     * @param {string} sessionId
     */
    async getBySession(sessionId) {
        try {
            const all = await this.getAll();
            return all.filter(r => r.sessionId === sessionId).sort((a, b) => a.timestamp - b.timestamp);
        } catch (err) {
            console.error('[ActionLogger] getBySession error:', err);
            return [];
        }
    }

    /**
     * 清除所有操作记录
     */
    async clear() {
        try {
            const db = await this._getDB();
            return new Promise((resolve, reject) => {
                const tx = db.transaction('actions', 'readwrite');
                const store = tx.objectStore('actions');
                const req = store.clear();
                req.onsuccess = () => resolve();
                req.onerror = (e) => reject(e.target.error);
            });
        } catch (err) {
            console.error('[ActionLogger] clear error:', err);
        }
    }

    /**
     * 释放资源
     */
    dispose() {
        this._unsubs.forEach(fn => fn());
        this._unsubs = [];
        this._eventBus = null;
        this._db = null;
    }
}
