/**
 * DO.can.js — 数字量输出模块：CAN 总线通信 Mixin
 * 船舶机舱监测报警系统 · CAN 总线架构
 *
 * 本文件导出一个 applyCANMixin(proto) 函数，
 * 将所有 CAN 通信方法混入 DOModule 的原型。
 */

import { CAN_FUNC, CANId, NMT_CMD, NMT_STATE } from '../CANBUS.js';
import { CH_CONFIG } from './DO.constants.js';

export function applyCANMixin(proto) {

    // ──────────────────────────────────────────
    //  NMT 状态管理
    // ──────────────────────────────────────────
    proto._handleNMT = function (cmd) {
        if (cmd === NMT_CMD.START) {
            if (this.nmtState === NMT_STATE.INIT || this.nmtState === NMT_STATE.PREOP) {
                this.nmtState = NMT_STATE.RUN;
                this.nmtStateTime = Date.now();
                console.log(`[DO #${this.nodeAddress}] NMT: Starting → ${NMT_STATE.RUN} state`);
            }
        } else if (cmd === NMT_CMD.STOP) {
            if (this.nmtState === NMT_STATE.RUN) {
                this.nmtState = NMT_STATE.STOP;
                this.nmtStateTime = Date.now();
                console.log(`[DO #${this.nodeAddress}] NMT: Stopping → ${NMT_STATE.STOP} state`);
            }
        } else if (cmd === NMT_CMD.RESET) {
            this.nmtState = NMT_STATE.INIT;
            this.nmtStateTime = Date.now();
            this.txCount = 0;
            this.rxCount = 0;
            this.comErrorCount = 0;
            this.lastTxTime = 0;
            this.lastRxTime = 0;
            console.log(`[DO #${this.nodeAddress}] NMT: Resetting → ${NMT_STATE.INIT} state`);
        } else if (cmd === NMT_CMD.RESETCOM) {
            this.comErrorCount = 0;
            this.lastTxTime = 0;
            this.lastRxTime = 0;
            this.txCount = 0;
            this.rxCount = 0;
            console.log(`[DO #${this.nodeAddress}] NMT: Communication reset`);
        }
    };

    proto._isCanTransmit = function () {
        return this.nmtState === NMT_STATE.RUN;
    };

    // ──────────────────────────────────────────
    //  CAN 接收
    // ──────────────────────────────────────────
    proto.onCanReceive = function (frame) {
        if (!frame) return;

        const { funcCode, nodeAddr } = CANId.decode(frame.id);

        if (funcCode === CAN_FUNC.NMT) {
            const nmtCmd = frame.data[0];
            const targetAddr = frame.data[1];
            if (targetAddr === 0 || targetAddr === this.nodeAddress) this._handleNMT(nmtCmd);
            return;
        }

        if (funcCode === CAN_FUNC.BROADCAST) {
            if (frame.data && frame.data.length > 0 && frame.data[0] === 0x05) {
                this._lastHeartbeat = Date.now();
                if (this.nmtState === NMT_STATE.PREOP || this.nmtState === NMT_STATE.INIT) {
                    this.nmtState = NMT_STATE.RUN;
                    this.nmtStateTime = Date.now();
                }
            }
            return;
        }

        const expectedId = CANId.encode(CAN_FUNC.DO_CMD, this.nodeAddress);
        if (frame.id !== expectedId) return;

        this.lastRxTime = Date.now();
        this.rxCount++;
        this.ledStatus.com = true;

        const cmd = frame.data[0];
        const chKeys = ['ch1', 'ch2', 'ch3', 'ch4'];
        const chMask = frame.data[1] || 0;

        switch (cmd) {
            case 0x01: {
                const stateMask = frame.data[2] || 0;
                chKeys.forEach((id, i) => {
                    if (chMask & (1 << i)) {
                        this.channels[id].hold = false;
                        this.pulseConfig[id].active = false;
                        this._setOutput(id, !!(stateMask & (1 << i)));
                    }
                });
                break;
            }
            case 0x02: {
                const onMs = (frame.data[2] << 8) | frame.data[3];
                const offMs = (frame.data[4] << 8) | frame.data[5];
                const phStart = (frame.data[6] << 8) | frame.data[7];
                chKeys.forEach((id, i) => {
                    if (chMask & (1 << i)) {
                        this.channels[id].hold = false;
                        this.pulseConfig[id].active = true;
                        this.pulseConfig[id].onMs = Math.max(50, onMs);
                        this.pulseConfig[id].offMs = Math.max(50, offMs);
                        this.pulseConfig[id].phaseStart = phStart;
                    }
                });
                break;
            }
            case 0x03:
                chKeys.forEach((id, i) => {
                    if (chMask & (1 << i)) this.pulseConfig[id].active = false;
                });
                break;
            case 0x04:
                chKeys.forEach(id => { this._setOutput(id, false); this.channels[id].hold = false; this.pulseConfig[id].active = false; });
                break;
            case 0x05: {
                const modeMap = ['off', 'hold', 'preset'];
                const modeMask = frame.data[2] & 0x03;
                const presMask = frame.data[3] || 0;
                chKeys.forEach((id, i) => {
                    if (chMask & (1 << i)) {
                        this.safeOutput[id].mode = modeMap[modeMask] || 'off';
                        this.safeOutput[id].presetState = !!(presMask & (1 << i));
                    }
                });
                break;
            }
            case 0x06:
                this.txInterval = Math.max(100, (frame.data[1] << 8) | frame.data[2]);
                break;

            case 0x10: {
                const modeNames = ['hand', 'auto', 'pulse', 'disable'];
                chKeys.forEach((id, i) => {
                    if (chMask & (1 << i)) {
                        const m = modeNames[frame.data[2] & 0x03] || 'hand';
                        this.channels[id].mode = m;
                        this.pulseConfig[id].active = (m === 'pulse');
                    }
                });
                break;
            }
            case 0x11: {
                const onMs2 = (frame.data[2] << 8) | frame.data[3];
                const offMs2 = (frame.data[4] << 8) | frame.data[5];
                const phaseMs = (frame.data[6] << 8) | frame.data[7];
                chKeys.forEach((id, i) => {
                    if (chMask & (1 << i)) {
                        this.pulseConfig[id].onMs = Math.max(50, onMs2);
                        this.pulseConfig[id].offMs = Math.max(50, offMs2);
                        this.pulseConfig[id].phaseStart = phaseMs;
                    }
                });
                break;
            }
            case 0x12: {
                const modeMap2 = ['off', 'hold', 'preset'];
                const modeMask2 = frame.data[2] & 0x03;
                const presMask2 = frame.data[3] || 0;
                chKeys.forEach((id, i) => {
                    if (chMask & (1 << i)) {
                        this.safeOutput[id].mode = modeMap2[modeMask2] || 'off';
                        this.safeOutput[id].presetState = !!(presMask2 & (1 << i));
                    }
                });
                break;
            }
            case 0x20: {
                const chIdx2 = frame.data[1] & 0x03;
                const cid = chKeys[chIdx2];
                const modeIdx = ['hand', 'auto', 'pulse', 'disable'].indexOf(this.channels[cid].mode);
                this._sendResponse([0x20, chIdx2, modeIdx < 0 ? 0 : modeIdx, 0, 0, 0, 0, 0]);
                break;
            }
            case 0x21: {
                const chIdx3 = frame.data[1] & 0x03;
                const cid2 = chKeys[chIdx3];
                const pc = this.pulseConfig[cid2];
                const onMs3 = Math.round(pc.onMs) & 0xFFFF;
                const offMs3 = Math.round(pc.offMs) & 0xFFFF;
                const phMs = Math.round(pc.phaseStart) & 0xFFFF;
                this._sendResponse([
                    0x21, chIdx3,
                    (onMs3 >> 8) & 0xFF, onMs3 & 0xFF,
                    (offMs3 >> 8) & 0xFF, offMs3 & 0xFF,
                    (phMs >> 8) & 0xFF, phMs & 0xFF,
                ]);
                break;
            }
            case 0x22: {
                const chIdx4 = frame.data[1] & 0x03;
                const cid3 = chKeys[chIdx4];
                const safe = this.safeOutput[cid3];
                const safeModeIdx = ['off', 'hold', 'preset'].indexOf(safe.mode);
                this._sendResponse([
                    0x22, chIdx4,
                    safeModeIdx < 0 ? 0 : safeModeIdx,
                    safe.presetState ? 1 : 0,
                    0, 0, 0, 0,
                ]);
                break;
            }
            case 0xEE: {
                const id = this.id;
                const payload = [0xEE, 0, 0, 0, 0, 0, 0, 0];
                for (let i = 0; i < 7; i++) { if (i < id.length) payload[i + 1] = id.charCodeAt(i); }
                this._sendResponse(payload);
                break;
            }
        }
    };

    // ──────────────────────────────────────────
    //  发送响应
    // ──────────────────────────────────────────
    proto._sendResponse = function (responseData) {
        if (!this.sys || typeof this.sys.canBus === 'undefined') return;

        const frameId = CANId.encode(CAN_FUNC.DO_REPLY, this.nodeAddress & 0x0F);
        try {
            this.sys.canBus.send({
                id: frameId, extended: false, rtr: false, dlc: 8,
                data: responseData, sender: this.id, timestamp: Date.now(),
            });
            this.txCount++;
            this.canBusConnected = true;
        } catch (e) {
            if (++this.comErrorCount > 10) this.ledStatus.flt = true;
            this.canBusConnected = false;
        }
    };

    // ──────────────────────────────────────────
    //  状态心跳
    // ──────────────────────────────────────────
    proto._canTransmitStatus = function () {
        if (!this._isCanTransmit()) return;
        if (!this.sys || typeof this.sys.canBus === 'undefined') return;

        const chKeys = ['ch1', 'ch2', 'ch3', 'ch4'];
        const mkByte = fn => chKeys.reduce((b, id, i) => b | (fn(this.channels[id], id) ? (1 << i) : 0), 0);

        const data = [
            mkByte(c => c.state),
            mkByte(c => c.fault),
            mkByte(c => c.hold),
            chKeys.reduce((b, id, i) => b | (this.pulseConfig[id].active ? (1 << i) : 0), 0),
        ];

        try {
            this.sys.canBus.send({
                id: CANId.encode(CAN_FUNC.DO_STATUS, this.nodeAddress),
                extended: false, rtr: false, dlc: 4, data, sender: this.id, timestamp: Date.now(),
            });
            this.txCount++;
            this.canBusConnected = true;
        } catch (e) {
            this.comErrorCount++;
            this.canBusConnected = false;
        }
    };
}
