/**
 * ReplayController - 历史数据回放控制器
 * 加载 HistoryRecorder 的快照数据，以可调速回放模式将历史状态注入设备池
 */
export class ReplayController {
    constructor(pool, eventBus) {
        this._pool = pool;
        this._eventBus = eventBus;
        this._snapshots = [];
        this._currentIdx = 0;
        this._speed = 1;
        this._playing = false;
        this._timer = null;
    }

    /**
     * 加载快照数据
     * @param {Array} snapshots - 快照数组（按时间升序）
     */
    load(snapshots) {
        this._snapshots = snapshots || [];
        this._currentIdx = 0;
        if (this._playing) {
            this.pause();
        }
    }

    /**
     * 开始回放
     */
    play() {
        if (this._playing || this._snapshots.length === 0) return;
        this._playing = true;
        this._tick();

        if (this._eventBus) {
            this._eventBus.emit('session:action', {
                action: 'replay:play',
                total: this._snapshots.length,
            });
        }
    }

    /**
     * 内部：回放单步间隔计时
     */
    _tick() {
        if (this._timer) clearTimeout(this._timer);
        if (!this._playing || this._currentIdx >= this._snapshots.length) {
            if (this._currentIdx >= this._snapshots.length && this._playing) {
                this._playing = false;
                if (this._eventBus) {
                    this._eventBus.emit('session:action', { action: 'replay:complete' });
                }
            }
            return;
        }

        const snapshot = this._snapshots[this._currentIdx];
        this._applySnapshot(snapshot);

        if (this._eventBus) {
            this._eventBus.emit('session:action', {
                action: 'replay:progress',
                index: this._currentIdx,
                total: this._snapshots.length,
                progress: this.getProgress(),
                timestamp: snapshot.timestamp,
            });
        }

        this._currentIdx++;
        const interval = 1000 / this._speed;
        this._timer = setTimeout(() => this._tick(), interval);
    }

    /**
     * 暂停回放
     */
    pause() {
        this._playing = false;
        if (this._timer) {
            clearTimeout(this._timer);
            this._timer = null;
        }
        if (this._eventBus) {
            this._eventBus.emit('session:action', { action: 'replay:pause' });
        }
    }

    /**
     * 跳转到指定时间点
     * @param {number} time - Unix 时间戳（毫秒）
     */
    seek(time) {
        if (this._snapshots.length === 0) return;
        // 找到最接近指定时间的快照
        let nearest = 0;
        let minDiff = Infinity;
        for (let i = 0; i < this._snapshots.length; i++) {
            const diff = Math.abs(this._snapshots[i].timestamp - time);
            if (diff < minDiff) {
                minDiff = diff;
                nearest = i;
            }
        }
        this._currentIdx = nearest;
        // 应用跳转到的快照
        this._applySnapshot(this._snapshots[this._currentIdx]);

        if (this._eventBus) {
            this._eventBus.emit('session:action', {
                action: 'replay:seek',
                index: this._currentIdx,
                total: this._snapshots.length,
                timestamp: this._snapshots[this._currentIdx].timestamp,
            });
        }
    }

    /**
     * 设置回放速度倍率
     * @param {number} multiplier - 1/2/4/8 等
     */
    setSpeed(multiplier) {
        this._speed = Math.max(0.25, multiplier);
        if (this._playing) {
            this._tick(); // 重新调度下一帧
        }
    }

    /**
     * 将历史快照状态注入设备池
     * @param {Object} snapshot - { timestamp, states: { devId: { state, sensors, actuators } } }
     */
    _applySnapshot(snapshot) {
        if (!snapshot || !snapshot.states) return;

        Object.entries(snapshot.states).forEach(([devId, data]) => {
            try {
                const dev = this._pool.get(devId);
                if (!dev) return;

                // 恢复主状态
                if (data.state) {
                    const oldState = { ...dev.state };
                    if (typeof dev.updateState === 'function') {
                        dev.updateState(data.state);
                    } else {
                        Object.assign(dev.state, data.state);
                    }
                    // 发送状态变更事件
                    if (this._eventBus) {
                        Object.keys(data.state).forEach(key => {
                            if (data.state[key] !== oldState[key]) {
                                this._eventBus.emit('equipment:stateChange', {
                                    id: devId,
                                    key,
                                    value: data.state[key],
                                    state: { ...dev.state },
                                });
                            }
                        });
                    }
                }

                // 恢复传感器值
                if (data.sensors && dev.sensors) {
                    Object.entries(data.sensors).forEach(([key, val]) => {
                        if (dev.sensors[key] && typeof dev.sensors[key].setValue === 'function') {
                            dev.sensors[key].setValue(val);
                        } else if (dev.sensors[key]) {
                            dev.sensors[key].value = val;
                        }
                    });
                }

                // 恢复执行器值
                if (data.actuators && dev.actuators) {
                    Object.entries(data.actuators).forEach(([key, val]) => {
                        if (dev.actuators[key] && typeof dev.actuators[key].setValue === 'function') {
                            dev.actuators[key].setValue(val);
                        }
                    });
                }
            } catch (e) {
                console.warn(`[ReplayController] error restoring device "${devId}":`, e);
            }
        });
    }

    /**
     * 获取回放进度（0~1）
     */
    getProgress() {
        return this._snapshots.length > 0
            ? Math.min(this._currentIdx / this._snapshots.length, 1)
            : 0;
    }

    /**
     * 当前是否正在回放
     */
    isPlaying() {
        return this._playing;
    }

    /**
     * 获取当前帧索引
     */
    getCurrentIndex() {
        return this._currentIdx;
    }

    /**
     * 获取总帧数
     */
    getTotalCount() {
        return this._snapshots.length;
    }

    /**
     * 获取当前速度
     */
    getSpeed() {
        return this._speed;
    }

    /**
     * 按帧索引跳转
     * @param {number} index 帧索引（0-based）
     */
    seekByIndex(index) {
        if (this._snapshots.length === 0) return;
        this._currentIdx = Math.max(0, Math.min(index, this._snapshots.length - 1));
        this._applySnapshot(this._snapshots[this._currentIdx]);
    }

    /**
     * 跳转到第一帧
     */
    seekToStart() {
        if (this._snapshots.length > 0) {
            this.seekByIndex(0);
        }
    }

    /**
     * 释放资源
     */
    dispose() {
        this.pause();
        this._snapshots = [];
        this._pool = null;
        this._eventBus = null;
    }
}
