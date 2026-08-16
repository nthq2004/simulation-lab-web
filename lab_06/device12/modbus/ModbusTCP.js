/**
 * ModbusTCP.js — Modbus TCP 传输层抽象
 * 船舶机舱监测报警系统 · Modbus 通信架构
 *
 * 提供：
 *   ModbusTCPServer — TCP 服务端（IAS Server 侧）
 *   ModbusTCPClient — TCP 客户端（PLC 侧）
 *
 * 仿真模式：不涉及真实 socket，使用直接内存调用 + 可配置延迟
 */

import { encodeTCPFrame, decodeTCPFrame } from './MODBUS.js';

// ─────────────────────────────────────────────
//  TCP 服务端
// ─────────────────────────────────────────────
export class ModbusTCPServer {
    /**
     * @param {Object} [options]
     * @param {number} [options.port=502]
     * @param {number} [options.responseDelay=50] - 仿真响应延迟 ms
     */
    constructor(options = {}) {
        this.port = options.port ?? 502;
        this.responseDelay = options.responseDelay ?? 50;
        this._handler = null;     // 由 IAS Server 设置
        this._clients = new Map(); // clientId -> { transactionId }
        this.rxCount = 0;
        this.txCount = 0;
    }

    /** 设置请求处理器（由上层调用） */
    setHandler(handlerFn) {
        this._handler = handlerFn;
    }

    /**
     * 接收 TCP 请求并异步响应
     * @param {string} clientId
     * @param {number[]} tcpFrame - 完整 TCP 帧
     * @param {Function} callback - function(responseFrame)
     */
    onRequest(clientId, tcpFrame, callback) {
        if (!this._handler) { callback(null); return; }
        this.rxCount++;
        const decoded = decodeTCPFrame(tcpFrame);
        if (!decoded) { callback(null); return; }

        if (!this._clients.has(clientId)) {
            this._clients.set(clientId, { transactionId: 0 });
        }

        // 由 handler 处理并生成响应 PDU
        const responsePDU = this._handler(decoded.unitId, decoded.fnCode, decoded.data);

        setTimeout(() => {
            if (responsePDU) {
                const respFrame = encodeTCPFrame(decoded.transactionId, decoded.unitId, responsePDU[0], responsePDU.slice(1));
                this.txCount++;
                callback(respFrame);
            } else {
                callback(null);
            }
        }, this.responseDelay);
    }
}

// ─────────────────────────────────────────────
//  TCP 客户端
// ─────────────────────────────────────────────
export class ModbusTCPClient {
    /**
     * @param {Object} [options]
     * @param {number} [options.timeout=1000] - 超时 ms
     */
    constructor(options = {}) {
        this.timeout = options.timeout ?? 1000;
        this._transactionId = 0;
        this._server = null;  // 服务端引用
        this.rxCount = 0;
        this.txCount = 0;
        this.errorCount = 0;
    }

    /** 连接服务器 */
    connect(server) {
        this._server = server;
        this.clientId = `plc_${Date.now()}`;
    }

    /**
     * 发送请求并等待响应（异步回调）
     * @param {number} unitId
     * @param {number} fnCode
     * @param {number[]} pduData
     * @param {Function} callback - function(response | null)
     */
    request(unitId, fnCode, pduData = [], callback) {
        if (!this._server) { callback(null); return; }
        this._transactionId = (this._transactionId + 1) & 0xFFFF;
        const tcpFrame = encodeTCPFrame(this._transactionId, unitId, fnCode, pduData);
        this.txCount++;

        let timedOut = false;
        const timer = setTimeout(() => {
            timedOut = true;
            this.errorCount++;
            callback(null);
        }, this.timeout);

        this._server.onRequest(this.clientId, tcpFrame, (respFrame) => {
            if (timedOut) return;
            clearTimeout(timer);
            if (!respFrame) {
                this.errorCount++;
                callback(null);
                return;
            }
            this.rxCount++;
            const decoded = decodeTCPFrame(respFrame);
            callback(decoded);
        });
    }
}
