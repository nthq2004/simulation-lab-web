/**
 * ProtocolAdapter - CAN/Modbus 协议适配器
 *
 * 在仿真系统的内部设备与外部物理硬件之间建立双向映射：
 * - onFieldbusData(frame): 解析从现场总线（CAN/Modbus）收到的数据帧，更新对应设备状态
 * - toFieldbusFrame(devId, key, value): 将设备状态变化编码为现场总线数据帧
 *
 * 支持的 CAN ID → 设备 ID 映射表基于船舶机舱监测报警系统的典型配置。
 */
export class ProtocolAdapter {
    /**
     * @param {import('../tools/EquipmentPool.js').EquipmentPool} pool - 设备对象池
     * @param {import('../tools/EventBus.js').EventBus} [eventBus] - 可选事件总线，状态变更时发布事件
     * @param {object} [options] - 可选配置
     * @param {object} [options.canIdMap] - 自定义 CAN ID 映射表，覆盖默认值
     * @param {object} [options.modbusIdMap] - 自定义 Modbus 地址映射表
     */
    constructor(pool, eventBus, options = {}) {
        this._pool = pool;
        this._eventBus = eventBus;

        // CAN ID → 设备 ID 映射（11 位标准帧）
        this._canIdMap = options.canIdMap || {
            0x110: 'me-01',           // 主机转速
            0x111: 'gen-01',          // 发电机
            0x120: 'pump-sw-01',      // 海水泵
            0x121: 'pump-fw-01',      // 淡水泵
            0x130: 'hx-01',           // 换热器
            0x140: 'compressor-01',   // 空压机
            0x150: 'pump-hfo-01',     // 燃油泵
            0x160: 'governor-01',     // 调速器
            0x170: 'switchboard-01',  // 主配电板
            0x180: 'purifier-01',     // 分油机
        };

        // 设备 ID → CAN ID 反向映射
        this._devIdToCan = {};
        Object.entries(this._canIdMap).forEach(([canId, devId]) => {
            this._devIdToCan[devId] = parseInt(canId);
        });

        // Modbus 从站地址 → 设备 ID 映射
        this._modbusIdMap = options.modbusIdMap || {
            1: 'me-01',
            2: 'gen-01',
            3: 'pump-sw-01',
            4: 'pump-fw-01',
            5: 'hx-01',
            6: 'compressor-01',
            7: 'pump-hfo-01',
            8: 'governor-01',
        };

        // 设备 ID → Modbus 地址反向映射
        this._devIdToModbus = {};
        Object.entries(this._modbusIdMap).forEach(([addr, devId]) => {
            this._devIdToModbus[devId] = parseInt(addr);
        });

        // 数据字段编码表 (field byte → state key)
        this._fieldToKey = {
            1: 'speed',
            2: 'running',
            3: 'voltage',
            4: 'frequency',
            5: 'pressure',
            6: 'temperature',
            7: 'level',
            8: 'flow',
            9: 'current',
            10: 'power',
        };

        // State key → field byte 反向映射
        this._keyToField = {};
        Object.entries(this._fieldToKey).forEach(([field, key]) => {
            this._keyToField[key] = parseInt(field);
        });
    }

    /**
     * 解析 CAN 数据帧并更新对应设备状态
     *
     * 帧格式约定（专为仿真教学简化设计）：
     *   Byte 0:    字段选择器（1-10，对应 speed/running/voltage 等）
     *   Bytes 1-4: Float32 小端序值
     *   Byte 5-7:  保留
     *
     * @param {object} frame - CAN 数据帧
     * @param {number} frame.id - CAN ID
     * @param {Uint8Array} frame.data - 数据字节
     */
    onFieldbusData(frame) {
        if (!frame || !frame.data) return;

        // 先尝试 CAN 模式
        const devId = this._canIdMap[frame.id];
        if (devId) {
            this._applyCanData(devId, frame);
            return;
        }

        // 再尝试 Modbus 模式（通过 frame 中的 slaveAddress 或附加属性）
        if (frame.slaveAddress != null) {
            const mbDevId = this._modbusIdMap[frame.slaveAddress];
            if (mbDevId) {
                this._applyModbusData(mbDevId, frame);
            }
        }
    }

    /**
     * 从设备状态变化构造 CAN 数据帧
     *
     * @param {string} devId - 设备 ID
     * @param {string} key   - 状态键名（如 'speed', 'running'）
     * @param {*}      value - 状态值
     * @returns {object|null} 数据帧 { id, data: Uint8Array }，若无法映射则返回 null
     */
    toFieldbusFrame(devId, key, value) {
        const canId = this._devIdToCan[devId];
        if (!canId) return null;

        const field = this._keyToField[key];
        if (!field) return null;

        // 构造 5 字节 CAN 数据帧
        const buf = new ArrayBuffer(5);
        const view = new DataView(buf);
        view.setUint8(0, field);
        view.setFloat32(1, typeof value === 'boolean' ? (value ? 1 : 0) : value, true);

        return { id: canId, data: new Uint8Array(buf) };
    }

    /**
     * 从设备状态变化构造 Modbus 数据帧
     *
     * @param {string} devId   - 设备 ID
     * @param {string} key     - 状态键名
     * @param {*}      value   - 状态值
     * @param {number} [funcCode=6] - Modbus 功能码（默认 6=写单个寄存器）
     * @returns {object|null} 数据帧 { slaveAddress, functionCode, register, value }，若无法映射则返回 null
     */
    toModbusFrame(devId, key, value, funcCode = 6) {
        const slaveAddr = this._devIdToModbus[devId];
        if (!slaveAddr) return null;

        const field = this._keyToField[key];
        if (!field) return null;

        const register = field; // 简化映射：字段编号即寄存器地址
        let regValue;
        if (typeof value === 'boolean') {
            regValue = value ? 1 : 0;
        } else if (typeof value === 'number') {
            // 缩放：将物理量映射到 Modbus 16 位寄存器范围
            regValue = Math.round(value * 10);
        } else {
            return null;
        }

        return {
            slaveAddress: slaveAddr,
            functionCode: funcCode,
            register,
            value: regValue,
        };
    }

    /**
     * 将 CAN 数据帧应用到指定设备
     */
    _applyCanData(devId, frame) {
        const dev = this._pool ? this._pool.get(devId) : null;
        if (!dev) return;

        const data = frame.data;
        if (data.length < 5) return;

        const field = data[0];
        const view = new DataView(data.buffer, data.byteOffset + 1, 4);
        const rawValue = view.getFloat32(0, true); // little-endian

        const key = this._fieldToKey[field];
        if (!key) return;

        // boolean 字段特殊处理
        let value;
        if (key === 'running' || key === 'energized' || key === 'alarm') {
            value = rawValue > 0;
        } else {
            value = rawValue;
        }

        // 更新设备状态
        if (dev.state && dev.state[key] !== undefined) {
            dev.state[key] = value;

            if (this._eventBus) {
                this._eventBus.emit('equipment:stateChange', {
                    id: devId,
                    key,
                    value,
                    source: 'fieldbus',
                });
            }
        } else {
            // 状态不存在，但设备已注册 — 可能是动态添加的属性
            if (dev.state) {
                dev.state[key] = value;
            }
        }
    }

    /**
     * 将 Modbus 数据帧应用到指定设备（预留接口）
     */
    _applyModbusData(devId, frame) {
        const dev = this._pool ? this._pool.get(devId) : null;
        if (!dev) return;

        // Modbus 帧的数据解析逻辑取决于具体功能码和寄存器映射
        // 此处为简化实现，默认使用与 CAN 相同的字段映射
        if (frame.register != null) {
            const key = this._fieldToKey[frame.register];
            if (key && dev.state) {
                dev.state[key] = frame.value;
            }
        }
    }

    /**
     * 获取设备对应的 CAN ID
     * @param {string} devId
     * @returns {number|undefined}
     */
    getCanId(devId) {
        return this._devIdToCan[devId];
    }

    /**
     * 获取 CAN ID 对应的设备 ID
     * @param {number} canId
     * @returns {string|undefined}
     */
    getDeviceIdByCanId(canId) {
        return this._canIdMap[canId];
    }

    /**
     * 获取所有受支持的 CAN ID 列表
     * @returns {number[]}
     */
    getSupportedCanIds() {
        return Object.keys(this._canIdMap).map(k => parseInt(k));
    }

    /**
     * 获取当前 CAN ID 映射表的副本
     * @returns {object}
     */
    getCanIdMap() {
        return { ...this._canIdMap };
    }

    /**
     * 获取当前 Modbus 地址映射表的副本
     * @returns {object}
     */
    getModbusIdMap() {
        return { ...this._modbusIdMap };
    }
}
