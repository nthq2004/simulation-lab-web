/**
 * fieldDevice.mixin.js — 通用 RTU 从站行为混入
 * 船舶机舱监测报警系统 · Modbus 通信架构
 *
 * 为现场设备（TempTransmitter, PressTransmitter 等）提供：
 *   - 寄存器读写实现
 *   - handleRequest() RTU 请求处理
 *   - 状态管理
 */

import { FC, ModbusDevice, encodeRTUFrame } from '../MODBUS.js';

/**
 * 混入 ModbusDevice 方法到目标原型
 * @param {Object} proto - 目标类的 prototype
 */
export function applyFieldDeviceMixin(proto) {

    // ── 初始化寄存器状态 ──
    proto._initModbus = function (slaveId) {
        this.slaveId = slaveId;
        this.online = true;
        this.inputRegisters = new Array(16).fill(0);
        this.holdingRegisters = new Array(16).fill(0);
        this.coils = new Array(16).fill(false);
        this.discreteInputs = new Array(16).fill(false);
        this.txCount = 0;
        this.rxCount = 0;
        this.errorCount = 0;
        this.lastRequest = 0;
    };

    /**
     * 处理 RTU 请求帧，委托给 ModbusDevice 的原型方法
     * @param {number[]} requestFrame
     * @returns {number[] | null} 响应帧
     */
    proto.handleRequest = function (requestFrame) {
        // 直接使用 ModbusDevice.prototype 上的 handleRequest,
        // 因为它只使用了 this 的寄存器属性和方法
        return ModbusDevice.prototype.handleRequest.call(this, requestFrame);
    };

    /**
     * 更新输入寄存器（由子类在每个 tick 调用）
     * @param {Object} regMap - { registerIndex: value, ... }
     */
    proto.updateInputRegisters = function (regMap) {
        for (const [idx, val] of Object.entries(regMap)) {
            const i = parseInt(idx);
            if (i >= 0 && i < this.inputRegisters.length) {
                this.inputRegisters[i] = (Math.round(val * 10)) << 16 >> 16;
            }
        }
    };

    /**
     * 更新线圈状态
     */
    proto.updateCoils = function (coilMap) {
        for (const [idx, val] of Object.entries(coilMap)) {
            const i = parseInt(idx);
            if (i >= 0 && i < this.coils.length) {
                this.coils[i] = !!val;
            }
        }
    };

    /**
     * 设置设备在线/离线
     */
    proto.setOnline = function (online) {
        this.online = online;
        if (!online) {
            this.discreteInputs[0] = 1;
        } else {
            this.discreteInputs[0] = 0;
        }
    };

    /** 获取状态字 */
    proto._getStatusWord = function () {
        let status = 0;
        if (this.isBreak) status |= 0x01;
        if (!this.online) status |= 0x02;
        if (this.moduleFault) status |= 0x04;
        return status;
    };
}
