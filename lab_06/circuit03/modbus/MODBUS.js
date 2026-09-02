/**
 * MODBUS.js — Modbus 协议核心
 * 船舶机舱监测报警系统 · Modbus 通信架构
 *
 * 提供：
 *   1. CRC16-Modbus 校验
 *   2. 功能码常量 (0x01~0x10)
 *   3. 异常码定义
 *   4. RTU 帧编解码
 *   5. TCP MBAP 头编解码
 *   6. ModbusDevice 基类（寄存器映射基类）
 */

// ─────────────────────────────────────────────
//  CRC16-Modbus
// ─────────────────────────────────────────────
const crcTable = new Uint16Array(256);
for (let i = 0; i < 256; i++) {
    let crc = i;
    for (let j = 0; j < 8; j++) {
        crc = (crc & 1) ? (0xA001 ^ (crc >> 1)) : (crc >> 1);
    }
    crcTable[i] = crc;
}

export function calcCRC16(data) {
    let crc = 0xFFFF;
    for (let i = 0; i < data.length; i++) {
        crc = crcTable[(crc ^ data[i]) & 0xFF] ^ (crc >> 8);
    }
    return crc; // 低字节在前
}

/** 检查 RTU 帧 CRC */
export function verifyCRC(frame) {
    if (frame.length < 3) return false;
    const data = frame.slice(0, -2);
    const crc = calcCRC16(data);
    return (crc & 0xFF) === frame[frame.length - 2] && ((crc >> 8) & 0xFF) === frame[frame.length - 1];
}

/** 附加 CRC 到数据末尾 */
export function appendCRC(data) {
    const crc = calcCRC16(data);
    return [...data, crc & 0xFF, (crc >> 8) & 0xFF];
}

// ─────────────────────────────────────────────
//  功能码常量
// ─────────────────────────────────────────────
export const FC = {
    READ_COILS:              0x01,
    READ_DISCRETE_INPUTS:    0x02,
    READ_HOLDING_REGISTERS:  0x03,
    READ_INPUT_REGISTERS:    0x04,
    WRITE_SINGLE_COIL:       0x05,
    WRITE_SINGLE_REGISTER:   0x06,
    READ_EXCEPTION_SERIAL:   0x07,
    WRITE_MULTIPLE_COILS:    0x0F,
    WRITE_MULTIPLE_REGISTERS:0x10,
};

// ─────────────────────────────────────────────
//  异常码
// ─────────────────────────────────────────────
export const EXCEPTION = {
    ILLEGAL_FUNCTION:           0x01,
    ILLEGAL_DATA_ADDRESS:       0x02,
    ILLEGAL_DATA_VALUE:         0x03,
    SLAVE_DEVICE_FAILURE:       0x04,
    ACKNOWLEDGE:                0x05,
    SLAVE_DEVICE_BUSY:          0x06,
    NEGATIVE_ACKNOWLEDGE:       0x07,
    MEMORY_PARITY_ERROR:        0x08,
    GATEWAY_PATH_UNAVAILABLE:   0x0A,
    GATEWAY_TARGET_FAILED:      0x0B,
};

// ─────────────────────────────────────────────
//  RTU 帧编解码
// ─────────────────────────────────────────────
/**
 * 编码 RTU 请求帧
 * @param {number} slaveId - 从站地址 (1~247)
 * @param {number} fnCode  - 功能码
 * @param {number[]} data  - PDU 数据字节数组
 * @returns {number[]} 完整 RTU 帧（含 CRC）
 */
export function encodeRTUFrame(slaveId, fnCode, data = []) {
    return appendCRC([slaveId, fnCode, ...data]);
}

/**
 * 解码 RTU 响应帧
 * @param {number[]} frame - 完整 RTU 帧
 * @returns {{ slaveId: number, fnCode: number, data: number[], error: boolean } | null}
 */
export function decodeRTUFrame(frame) {
    if (frame.length < 4) return null;
    if (!verifyCRC(frame)) return { slaveId: frame[0], fnCode: frame[1], data: null, error: true, exceptionCode: null };
    const slaveId = frame[0];
    const fnCode = frame[1];
    const data = frame.slice(2, -2);

    // 异常响应：功能码最高位为 1
    if (fnCode & 0x80) {
        return { slaveId, fnCode: fnCode & 0x7F, data, error: true, exceptionCode: data[0] ?? 0 };
    }
    return { slaveId, fnCode, data, error: false, exceptionCode: null };
}

// ─────────────────────────────────────────────
//  TCP MBAP 头编解码
// ─────────────────────────────────────────────
/**
 * 编码 MBAP 头
 * @param {number} transactionId - 事务标识符
 * @param {number} unitId        - 单元标识符
 * @param {number} pduLength     - PDU 长度（不含 MBAP）
 * @returns {number[]} 7 字节 MBAP 头
 */
export function encodeMBAP(transactionId, unitId, pduLength) {
    return [
        (transactionId >> 8) & 0xFF, transactionId & 0xFF,
        0x00, 0x00,  // 协议标识符（Modbus = 0x0000）
        (pduLength >> 8) & 0xFF, pduLength & 0xFF,
        unitId,
    ];
}

/**
 * 解码 MBAP 头
 * @param {number[]} buffer - 至少 7 字节
 * @returns {{ transactionId: number, protocolId: number, length: number, unitId: number } | null}
 */
export function decodeMBAP(buffer) {
    if (buffer.length < 7) return null;
    return {
        transactionId: (buffer[0] << 8) | buffer[1],
        protocolId:    (buffer[2] << 8) | buffer[3],
        length:        (buffer[4] << 8) | buffer[5],
        unitId:        buffer[6],
    };
}

/**
 * 编码 TCP 请求帧
 * @param {number} transactionId
 * @param {number} unitId
 * @param {number} fnCode
 * @param {number[]} pduData - PDU 数据（不含功能码）
 * @returns {number[]} 完整 TCP 帧
 */
export function encodeTCPFrame(transactionId, unitId, fnCode, pduData = []) {
    const pdu = [fnCode, ...pduData];
    const mbap = encodeMBAP(transactionId, unitId, pdu.length);
    return [...mbap, ...pdu];
}

/**
 * 解码 TCP 响应帧
 * @param {number[]} buffer - 完整 TCP 帧
 * @returns {{ transactionId: number, unitId: number, fnCode: number, data: number[], error: boolean } | null}
 */
export function decodeTCPFrame(buffer) {
    if (buffer.length < 9) return null;
    const mbap = decodeMBAP(buffer);
    if (!mbap) return null;
    const pdu = buffer.slice(7);
    const fnCode = pdu[0];
    const data = pdu.slice(1);
    if (fnCode & 0x80) {
        return { transactionId: mbap.transactionId, unitId: mbap.unitId, fnCode: fnCode & 0x7F, data, error: true, exceptionCode: data[0] ?? 0 };
    }
    return { transactionId: mbap.transactionId, unitId: mbap.unitId, fnCode, data, error: false, exceptionCode: null };
}

// ─────────────────────────────────────────────
//  寄存器数据构造助手
// ─────────────────────────────────────────────
export const RegHelper = {
    /** 将 16 位有符号整数拆为 [高字节, 低字节] */
    to16bit(v) { return [(v >> 8) & 0xFF, v & 0xFF]; },

    /** 从 [高字节, 低字节] 合成 16 位有符号整数 */
    from16bit(hi, lo) { return ((hi << 8) | lo) << 16 >> 16; },

    /** 将浮点数编码为两个寄存器（32 位 IEEE754） */
    toFloat32(v) {
        const buf = new ArrayBuffer(4);
        const dv = new DataView(buf);
        dv.setFloat32(0, v, false); // big-endian
        return [dv.getUint16(0), dv.getUint16(2)];
    },

    /** 从两个寄存器解析 32 位浮点数 */
    fromFloat32(hi, lo) {
        const buf = new ArrayBuffer(4);
        const dv = new DataView(buf);
        dv.setUint16(0, hi);
        dv.setUint16(2, lo);
        return dv.getFloat32(0, false);
    },
};

// ─────────────────────────────────────────────
//  ModbusDevice 基类（寄存器映射）
// ─────────────────────────────────────────────
export class ModbusDevice {
    /**
     * @param {Object} [options]
     * @param {number} [options.slaveId=1] - 从站地址
     */
    constructor(options = {}) {
        this.slaveId = options.slaveId ?? 1;
        this.online = true;

        // ── 寄存器映射 ──
        this.inputRegisters    = [];   // 只读
        this.holdingRegisters  = [];   // 读写
        this.coils             = [];   // 读写
        this.discreteInputs    = [];   // 只读

        // ── 通信统计 ──
        this.txCount = 0;
        this.rxCount = 0;
        this.errorCount = 0;
        this.lastRequest = 0;
    }

    /** 处理 RTU 请求帧，返回响应帧 */
    handleRequest(requestFrame) {
        this.rxCount++;
        this.lastRequest = Date.now();
        const decoded = decodeRTUFrame(requestFrame);
        if (!decoded || decoded.error) {
            this.errorCount++;
            return null;
        }
        const { fnCode, data } = decoded;
        let response;
        try {
            switch (fnCode) {
                case FC.READ_COILS:
                    response = this._readCoils(data);
                    break;
                case FC.READ_DISCRETE_INPUTS:
                    response = this._readDiscreteInputs(data);
                    break;
                case FC.READ_HOLDING_REGISTERS:
                    response = this._readHoldingRegisters(data);
                    break;
                case FC.READ_INPUT_REGISTERS:
                    response = this._readInputRegisters(data);
                    break;
                case FC.WRITE_SINGLE_COIL:
                    response = this._writeSingleCoil(data);
                    break;
                case FC.WRITE_SINGLE_REGISTER:
                    response = this._writeSingleRegister(data);
                    break;
                case FC.WRITE_MULTIPLE_COILS:
                    response = this._writeMultipleCoils(data);
                    break;
                case FC.WRITE_MULTIPLE_REGISTERS:
                    response = this._writeMultipleRegisters(data);
                    break;
                default:
                    return this._buildException(fnCode, EXCEPTION.ILLEGAL_FUNCTION);
            }
        } catch (e) {
            this.errorCount++;
            return this._buildException(fnCode, EXCEPTION.SLAVE_DEVICE_FAILURE);
        }
        if (!response) return this._buildException(fnCode, EXCEPTION.ILLEGAL_DATA_ADDRESS);
        this.txCount++;
        return encodeRTUFrame(this.slaveId, fnCode, response);
    }

    // ── 内部读/写方法（子类可覆盖） ──

    _readCoils(data) {
        const addr = (data[0] << 8) | data[1];
        const count = (data[2] << 8) | data[3];
        if (addr + count > this.coils.length) return null;
        const bits = [];
        for (let i = 0; i < count; i++) bits.push(this.coils[addr + i] ? 1 : 0);
        const byteCount = Math.ceil(count / 8);
        const bytes = new Array(byteCount).fill(0);
        for (let i = 0; i < bits.length; i++) {
            if (bits[i]) bytes[Math.floor(i / 8)] |= (1 << (i % 8));
        }
        return [byteCount, ...bytes];
    }

    _readDiscreteInputs(data) {
        const addr = (data[0] << 8) | data[1];
        const count = (data[2] << 8) | data[3];
        if (addr + count > this.discreteInputs.length) return null;
        const bits = [];
        for (let i = 0; i < count; i++) bits.push(this.discreteInputs[addr + i] ? 1 : 0);
        const byteCount = Math.ceil(count / 8);
        const bytes = new Array(byteCount).fill(0);
        for (let i = 0; i < bits.length; i++) {
            if (bits[i]) bytes[Math.floor(i / 8)] |= (1 << (i % 8));
        }
        return [byteCount, ...bytes];
    }

    _readHoldingRegisters(data) {
        const addr = (data[0] << 8) | data[1];
        const count = (data[2] << 8) | data[3];
        if (addr + count > this.holdingRegisters.length) return null;
        const result = [];
        for (let i = 0; i < count; i++) {
            result.push(RegHelper.to16bit(this.holdingRegisters[addr + i] ?? 0));
        }
        return [count * 2, ...result.flat()];
    }

    _readInputRegisters(data) {
        const addr = (data[0] << 8) | data[1];
        const count = (data[2] << 8) | data[3];
        if (addr + count > this.inputRegisters.length) return null;
        const result = [];
        for (let i = 0; i < count; i++) {
            result.push(RegHelper.to16bit(this.inputRegisters[addr + i] ?? 0));
        }
        return [count * 2, ...result.flat()];
    }

    _writeSingleCoil(data) {
        const addr = (data[0] << 8) | data[1];
        const value = (data[2] << 8) | data[3];
        if (addr >= this.coils.length) return null;
        this.coils[addr] = value === 0xFF00;
        return [data[0], data[1], data[2], data[3]];
    }

    _writeSingleRegister(data) {
        const addr = (data[0] << 8) | data[1];
        if (addr >= this.holdingRegisters.length) return null;
        this.holdingRegisters[addr] = ((data[2] << 8) | data[3]) << 16 >> 16;
        return data;
    }

    _writeMultipleCoils(data) {
        const addr = (data[0] << 8) | data[1];
        const count = (data[2] << 8) | data[3];
        if (addr + count > this.coils.length) return null;
        const byteCount = data[4];
        for (let i = 0; i < count; i++) {
            const byteIdx = Math.floor(i / 8);
            if (byteIdx < byteCount) {
                this.coils[addr + i] = !!(data[5 + byteIdx] & (1 << (i % 8)));
            }
        }
        return [data[0], data[1], data[2], data[3]];
    }

    _writeMultipleRegisters(data) {
        const addr = (data[0] << 8) | data[1];
        const count = (data[2] << 8) | data[3];
        if (addr + count > this.holdingRegisters.length) return null;
        for (let i = 0; i < count; i++) {
            this.holdingRegisters[addr + i] = ((data[5 + i * 2] << 8) | data[6 + i * 2]) << 16 >> 16;
        }
        return [data[0], data[1], data[2], data[3]];
    }

    _buildException(fnCode, exceptionCode) {
        return encodeRTUFrame(this.slaveId, fnCode | 0x80, [exceptionCode]);
    }
}

// ─────────────────────────────────────────────
//  系统初始化助手（一键组网）
// ─────────────────────────────────────────────
/**
 * 创建并配置整套 Modbus 网络系统
 *
 * @param {Object} modules — { ias, plc, temp, press, vfd, level, valve } 各模块实例
 * @returns {{ update: Function }} 总线更新接口
 *
 * @example
 * import { createModbusSystem } from './modbus/MODBUS.js';
 * const bus = createModbusSystem({ ias, plc, temp, press, vfd, level, valve });
 * // 在 _updatePhysics() 中调用 bus.update()
 */
export function createModbusSystem(modules) {
    if (!modules.plc || !modules.ias) {
        console.warn('[Modbus] PLC 和 IAS 是必需的模块');
        return { update() {} };
    }

    const { plc, ias, temp, press, vfd, level, valve } = modules;

    // 1. PLC 连接到 IAS Server
    plc.connectToServer(ias);

    // 2. 将现场设备注册为 PLC 的 RTU 从站
    const slaves = [
        { dev: temp, id: 1, name: '温度变送器' },
        { dev: press, id: 2, name: '压力变送器' },
        { dev: vfd, id: 3, name: '变频器' },
        { dev: level, id: 4, name: '液位变送器' },
        { dev: valve, id: 5, name: '阀门定位器' },
    ];

    slaves.forEach(s => {
        if (s.dev) plc.addSlave(s.dev, s.id, s.name);
    });

    console.log('[Modbus] 系统初始化完成，从站数:', slaves.filter(s => s.dev).length);

    // 3. 返回总线更新接口
    return {
        /**
         * 每个物理 tick 调用一次
         */
        update() {
            // PLC 轮询从站设备
            plc.pollCycle();

            // IAS 轮询 PLC 获取数据
            ias.updateDeviceData(plc.monitorData.devices);

            // IAS 检查报警
            ias.checkAlarms();

            // IAS 更新界面显示
            ias.pollPLC();

            // 更新从站设备的通信指示灯闪烁
            const now = Date.now();
            if (now % 200 < 20) {
                slaves.forEach(s => {
                    if (s.dev && typeof s.dev.blinkComm === 'function') {
                        const cache = plc.slaveCache[s.id];
                        if (cache && cache.online) s.dev.blinkComm();
                    }
                });
            }
        },

        /** 获取 PLC 统计数据 */
        getStats() {
            return plc.stats;
        },

        /** 获取 IAS 报警列表 */
        getAlarms() {
            return ias.alarms.filter(a => a.active);
        },
    };
}
