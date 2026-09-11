/**
 * PLC.mixin.js — PLC 网关协议处理混入
 * 船舶机舱监测报警系统 · Modbus 通信架构
 *
 * 提供：
 *   - RTU Master 轮询调度器
 *   - TCP ↔ RTU 协议桥接
 *   - 寄存器缓存管理与超时检测
 */

import { FC, encodeRTUFrame, decodeRTUFrame, RegHelper } from '../MODBUS.js';

/**
 * 混入 PLC 协议处理方法到目标原型
 * @param {Object} proto - PLC.prototype
 */
export function applyPLCMixin(proto) {

    /**
     * 初始化 PLC 协议状态
     */
    proto._initPLCProtocol = function () {
        // ── 从站设备列表 ──
        this.slaves = []; // { device, slaveId, name }

        // ── 轮询调度 ──
        this.pollIndex = 0;
        this.pollInterval = 200;   // ms 每轮问询等待
        this._lastPoll = 0;

        // ── 从站数据缓存 ──
        // 缓存每个从站的最新寄存器数据
        this.slaveCache = {}; // { [slaveId]: { inputRegisters: [], holdingRegisters: [], coils: [], discreteInputs: [], online: true, lastUpdate: 0 } }

        // ── 监测数据聚合（供 IAS 读取）──
        this.monitorData = {
            devices: {}
        };

        // ── 通信统计 ──
        this.stats = {
            totalPolls: 0,
            successfulPolls: 0,
            failedPolls: 0,
            lastPollTime: 0,
        };
    };

    /**
     * 添加从站设备
     * @param {Object} device - 实现 handleRequest() 和设备属性的对象
     * @param {number} slaveId - 从站地址 (1~247)
     * @param {string} name - 设备名称
     */
    proto.addSlave = function (device, slaveId, name) {
        this.slaves.push({ device, slaveId, name: name || `Slave_${slaveId}` });
        if (!this.slaveCache[slaveId]) {
            this.slaveCache[slaveId] = {
                inputRegisters: new Array(16).fill(0),
                holdingRegisters: new Array(16).fill(0),
                coils: new Array(16).fill(false),
                discreteInputs: new Array(16).fill(false),
                online: true,
                lastUpdate: 0,
            };
        }
        console.log(`[PLC] 从站添加: ${name} (ID=${slaveId})`);
    };

    /**
     * 执行一次轮询周期
     * 在每个物理 tick 调用
     */
    proto.pollCycle = function () {
        const now = Date.now();
        if (now - this._lastPoll < this.pollInterval) return;
        this._lastPoll = now;

        if (this.slaves.length === 0) return;

        // 轮询下一个从站（轮流访问）
        const slave = this.slaves[this.pollIndex % this.slaves.length];
        this.pollIndex = (this.pollIndex + 1) % this.slaves.length;

        if (!slave || !slave.device) return;

        this.stats.totalPolls++;
        this.stats.lastPollTime = now;

        // 构造读输入寄存器请求（读 8 个寄存器）
        const request = encodeRTUFrame(slave.slaveId, FC.READ_INPUT_REGISTERS, [0x00, 0x00, 0x00, 0x08]);

        // 模拟 RTU 传输延迟
        setTimeout(() => {
            try {
                if (!slave.device.online) {
                    this._handlePollFailure(slave);
                    return;
                }
                const response = slave.device.handleRequest(request);
                if (!response) {
                    this._handlePollFailure(slave);
                    return;
                }
                const decoded = decodeRTUFrame(response);
                if (!decoded || decoded.error) {
                    this._handlePollFailure(slave);
                    return;
                }

                // 解析响应数据（字节 → 寄存器）
                const regData = decoded.data;
                const regCount = (regData[0]) / 2;
                const cache = this.slaveCache[slave.slaveId];
                if (cache) {
                    for (let i = 0; i < regCount && i < 8; i++) {
                        const hi = regData[1 + i * 2] ?? 0;
                        const lo = regData[2 + i * 2] ?? 0;
                        cache.inputRegisters[i] = RegHelper.from16bit(hi, lo);
                    }
                    cache.online = true;
                    cache.lastUpdate = Date.now();
                }

                this.stats.successfulPolls++;
                this.stats.failedPolls = Math.max(0, this.stats.failedPolls - 1); // 恢复计数
            } catch (e) {
                this._handlePollFailure(slave);
            }
        }, 10); // 10ms 仿真延迟
    };

    /**
     * 处理轮询失败
     */
    proto._handlePollFailure = function (slave) {
        this.stats.failedPolls++;
        const cache = this.slaveCache[slave.slaveId];
        if (cache) {
            cache.online = false;
        }
    };

    /**
     * 更新 monitorData 聚合（供 IAS 轮询）
     */
    proto._updateMonitorData = function () {
        const devices = {};
        this.slaves.forEach(slave => {
            const cache = this.slaveCache[slave.slaveId];
            if (cache) {
                devices[slave.slaveId] = {
                    name: slave.name,
                    inputRegisters: [...cache.inputRegisters],
                    holdingRegisters: [...cache.holdingRegisters],
                    coils: [...cache.coils],
                    discreteInputs: [...cache.discreteInputs],
                    online: cache.online,
                    lastUpdate: cache.lastUpdate,
                };
            }
        });
        this.monitorData.devices = devices;
        this.monitorData.timestamp = Date.now();
        this.monitorData.stats = { ...this.stats };
    };

    /**
     * 处理 TCP 请求（由 IAS 发起）
     * @param {number} unitId
     * @param {number} fnCode
     * @param {number[]} data - PDU 数据（不含功能码）
     * @returns {number[] | null} 响应 PDU [fnCode, ...data]
     */
    proto.handleTCPRequest = function (unitId, fnCode, data) {
        this._updateMonitorData();

        // 如果请求的是 PLC 自身的设备数据
        if (unitId === 0) {
            return this._handlePLCInternalRequest(fnCode, data);
        }

        // 从缓存返回对应从站数据
        const cache = this.slaveCache[unitId];
        if (!cache) return null;

        switch (fnCode) {
            case FC.READ_INPUT_REGISTERS: {
                const addr = (data[0] << 8) | data[1];
                const count = (data[2] << 8) | data[3];
                const result = [];
                for (let i = 0; i < count; i++) {
                    result.push(RegHelper.to16bit(cache.inputRegisters[addr + i] ?? 0));
                }
                return [fnCode, count * 2, ...result.flat()];
            }
            case FC.READ_HOLDING_REGISTERS: {
                const addr = (data[0] << 8) | data[1];
                const count = (data[2] << 8) | data[3];
                const result = [];
                for (let i = 0; i < count; i++) {
                    result.push(RegHelper.to16bit(cache.holdingRegisters[addr + i] ?? 0));
                }
                return [fnCode, count * 2, ...result.flat()];
            }
            case FC.READ_COILS: {
                const addr = (data[0] << 8) | data[1];
                const count = (data[2] << 8) | data[3];
                const bits = [];
                for (let i = 0; i < count; i++) bits.push(cache.coils[addr + i] ? 1 : 0);
                const byteCount = Math.ceil(count / 8);
                const bytes = new Array(byteCount).fill(0);
                for (let i = 0; i < bits.length; i++) {
                    if (bits[i]) bytes[Math.floor(i / 8)] |= (1 << (i % 8));
                }
                return [fnCode, byteCount, ...bytes];
            }
            case FC.WRITE_SINGLE_REGISTER: {
                const addr = (data[0] << 8) | data[1];
                if (addr < cache.holdingRegisters.length) {
                    cache.holdingRegisters[addr] = ((data[2] << 8) | data[3]) << 16 >> 16;
                }
                return [fnCode, data[0], data[1], data[2], data[3]];
            }
            default:
                return null;
        }
    };

    /**
     * 处理 PLC 内部寄存器请求
     */
    proto._handlePLCInternalRequest = function (fnCode, data) {
        // 简单的内部寄存器处理
        switch (fnCode) {
            case FC.READ_INPUT_REGISTERS: {
                const count = (data[2] << 8) | data[3];
                const result = [];
                for (let i = 0; i < count; i++) result.push([0x00, 0x00]);
                return [fnCode, count * 2, ...result.flat()];
            }
            default: return null;
        }
    };
}
