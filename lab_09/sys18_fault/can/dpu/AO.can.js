/**
 * AO.can.js — 模拟量输出模块：CAN 总线通信 Mixin
 * 船舶机舱监测报警系统 · CAN 总线架构
 *
 * 本文件导出一个 applyCANMixin(proto) 函数，
 * 将所有 CAN 通信方法混入 AOModule 的原型。
 */

import { CAN_FUNC, CANId, NMT_CMD, NMT_STATE } from '../CANBUS.js';
import { CH_CONFIG } from './AO.constants.js';

export function applyCANMixin(proto) {

    // ──────────────────────────────────────────
    //  NMT 状态管理
    // ──────────────────────────────────────────
    proto._handleNMT = function (cmd) {
        if (cmd === NMT_CMD.START) {
            if (this.nmtState === NMT_STATE.INIT || this.nmtState === NMT_STATE.PREOP) {
                this.nmtState = NMT_STATE.RUN;
                this.nmtStateTime = Date.now();
                console.log(`[AO #${this.nodeAddress}] NMT: Starting → ${NMT_STATE.RUN} state`);
            }
        } else if (cmd === NMT_CMD.STOP) {
            if (this.nmtState === NMT_STATE.RUN) {
                this.nmtState = NMT_STATE.STOP;
                this.nmtStateTime = Date.now();
                console.log(`[AO #${this.nodeAddress}] NMT: Stopping → ${NMT_STATE.STOP} state`);
            }
        } else if (cmd === NMT_CMD.RESET) {
            this.nmtState = NMT_STATE.INIT;
            this.nmtStateTime = Date.now();
            this.txCount = 0;
            this.rxCount = 0;
            this.comErrorCount = 0;
            this.lastTxTime = 0;
            this.lastRxTime = 0;
            console.log(`[AO #${this.nodeAddress}] NMT: Resetting → ${NMT_STATE.INIT} state`);
        } else if (cmd === NMT_CMD.RESETCOM) {
            this.comErrorCount = 0;
            this.lastTxTime = 0;
            this.lastRxTime = 0;
            this.txCount = 0;
            this.rxCount = 0;
            console.log(`[AO #${this.nodeAddress}] NMT: Communication reset`);
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
            if (targetAddr === 0 || targetAddr === this.nodeAddress) {
                this._handleNMT(nmtCmd);
            }
            return;
        }

        if (funcCode === CAN_FUNC.BROADCAST) {
            if (frame.data && frame.data.length > 0 && frame.data[0] === 0x05) {
                this._lastHeartbeat = Date.now();
                if (this.nmtState === NMT_STATE.PREOP || this.nmtState === NMT_STATE.INIT) {
                    this.nmtState = NMT_STATE.RUN;
                    this.nmtStateTime = Date.now();
                    console.log(`[AO #${this.nodeAddress}] Heartbeat received → ${NMT_STATE.RUN} state`);
                }
            }
            return;
        }

        const expectedId = CANId.encode(CAN_FUNC.AO_CMD, this.nodeAddress);
        if (frame.id !== expectedId) return;

        this.lastRxTime = Date.now();
        this.rxCount++;
        this.ledStatus.com = true;

        const chKeys = ['ch1', 'ch2', 'ch3', 'ch4'];
        const isExtendedCmd = (frame.data[0] & 0xF0) >= 0x10 && (frame.data[0] !== 0xFF);

        if (isExtendedCmd) {
            const cmd = frame.data[0];
            if (cmd === 0x10) {
                chKeys.forEach(id => { this.channels[id].percent = 0; this.channels[id].hold = false; });
            } else if (cmd === 0x11) {
                this.channels.ch3.frequency = (frame.data[2] << 8) | frame.data[3];
                this.channels.ch4.frequency = (frame.data[4] << 8) | frame.data[5];
            } else if (cmd === 0x12) {
                const chIdx = frame.data[1] & 0xFF;
                const mode = frame.data[2] & 0xFF;
                if (chIdx < 4) {
                    const modeStr = mode === 0 ? 'hand' : mode === 1 ? 'auto' : 'disable';
                    this.channels[chKeys[chIdx]].mode = modeStr;
                }
            } else if (cmd === 0x13) {
                const chIdx = frame.data[1] & 0xFF;
                const lrvInt = (frame.data[2] << 8) | frame.data[3];
                const urvInt = (frame.data[4] << 8) | frame.data[5];
                if (chIdx < 4) {
                    this.ranges[chKeys[chIdx]].lrv = Math.max(0, Math.min(100, lrvInt / 100));
                    this.ranges[chKeys[chIdx]].urv = Math.max(0, Math.min(100, urvInt / 100));
                }
            } else if (cmd === 0x14) {
                const chIdx = frame.data[1] & 0xFF;
                if (chIdx < 4) this._sendParamReply(chIdx);
            } else if (cmd === 0x15) {
                const chIdx = frame.data[1] & 0xFF;
                if (chIdx < 4) this._sendSafeOutputReply(chIdx);
            } else if (cmd === 0x16) {
                const chIdx = frame.data[1] & 0xFF;
                const mode = frame.data[2] & 0xFF;
                const presetInt = (frame.data[3] << 8) | frame.data[4];
                if (chIdx < 4) {
                    const modeStr = mode === 0 ? 'hold' : mode === 1 ? 'preset' : 'zero';
                    const presetPercent = Math.max(0, Math.min(100, presetInt / 100));
                    this.safeOutput[chKeys[chIdx]].mode = modeStr;
                    this.safeOutput[chKeys[chIdx]].presetPercent = presetPercent;
                }
            } else if (cmd === 0xEE) {
                const id = this.id;
                const payload = [0xEE, 0, 0, 0, 0, 0, 0, 0];
                for (let i = 0; i < 7; i++) {
                    if (i < id.length) payload[i + 1] = id.charCodeAt(i);
                }
                this._sendResponse(payload);
            }
        } else {
            chKeys.forEach((id, i) => {
                const raw = (frame.data[i * 2] << 8) | frame.data[i * 2 + 1];
                if (raw === 0xFFFF) return;
                const pct = raw / 10;
                this.channels[id].percent = Math.max(0, Math.min(100, pct));
                this.channels[id].hold = false;
            });
        }
    };

    // ──────────────────────────────────────────
    //  发送响应
    // ──────────────────────────────────────────
    proto._sendResponse = function (responseData) {
        if (!this.sys || typeof this.sys.canBus === 'undefined') return;

        const frameId = CANId.encode(CAN_FUNC.AO_REPLY, this.nodeAddress & 0x0F);
        const frame = {
            id: frameId, extended: false, rtr: false, dlc: 8,
            data: responseData, sender: this.id, timestamp: Date.now(),
        };

        try {
            this.sys.canBus.send(frame);
            this.txCount++;
            this.canBusConnected = true;
        } catch (e) {
            if (++this.comErrorCount > 10) this.ledStatus.flt = true;
            this.canBusConnected = false;
        }
    };

    // ──────────────────────────────────────────
    //  参数回复
    // ──────────────────────────────────────────
    proto._sendParamReply = function (chIdx) {
        if (!this.sys || typeof this.sys.canBus === 'undefined') return;

        const chKeys = ['ch1', 'ch2', 'ch3', 'ch4'];
        const chId = chKeys[chIdx];
        if (!chId) return;

        const ch = this.channels[chId];
        const rng = this.ranges[chId];
        const modeMap = { hand: 0, auto: 1, disable: 2 };
        const mode = modeMap[ch.mode] || 2;
        const lrvInt = Math.round(rng.lrv * 100);
        const urvInt = Math.round(rng.urv * 100);

        const frameId = CANId.encode(CAN_FUNC.AO_REPLY, this.nodeAddress);
        const data = [
            chIdx & 0xFF, mode & 0xFF,
            (lrvInt >> 8) & 0xFF, lrvInt & 0xFF,
            (urvInt >> 8) & 0xFF, urvInt & 0xFF,
            0x00, 0x00,
        ];

        try {
            this.sys.canBus.send({
                id: frameId, extended: false, rtr: false, dlc: 8, data,
                sender: this.id, timestamp: Date.now(),
            });
        } catch (e) {
            console.warn(`[AO] 参数回复失败 ${chId}:`, e);
        }
    };

    // ──────────────────────────────────────────
    //  安全输出回复
    // ──────────────────────────────────────────
    proto._sendSafeOutputReply = function (chIdx) {
        if (!this.sys || typeof this.sys.canBus === 'undefined') return;

        const chKeys = ['ch1', 'ch2', 'ch3', 'ch4'];
        const chId = chKeys[chIdx];
        if (!chId) return;

        const safeOut = this.safeOutput[chId];
        const modeMap = { hold: 0, preset: 1, zero: 2 };
        const mode = modeMap[safeOut.mode];
        const presetInt = Math.round(safeOut.presetPercent * 100);

        const frameId = CANId.encode(CAN_FUNC.AO_REPLY, this.nodeAddress);
        const data = [
            chIdx & 0xFF, mode & 0xFF,
            (presetInt >> 8) & 0xFF, presetInt & 0xFF,
            0x00, 0x00, 0x00, 0x00,
        ];

        try {
            this.sys.canBus.send({
                id: frameId, extended: false, rtr: false, dlc: 8, data,
                sender: this.id, timestamp: Date.now(),
            });
        } catch (e) {
            console.warn(`[AO] 安全输出回复失败 ${chId}:`, e);
        }
    };

    // ──────────────────────────────────────────
    //  状态回报（心跳 + 实际输出值）
    // ──────────────────────────────────────────
    proto._canTransmitStatus = function () {
        if (!this.sys || typeof this.sys.canBus === 'undefined') return;

        const frameId = CANId.encode(CAN_FUNC.AO_STATUS, this.nodeAddress);
        const ch1mA100 = Math.round(this.channels.ch1.actual * 100);
        const ch2mA100 = Math.round(this.channels.ch2.actual * 100);
        const faultByte =
            (this.channels.ch1.fault ? 0x01 : 0) |
            (this.channels.ch2.fault ? 0x02 : 0) |
            (this.channels.ch3.fault ? 0x04 : 0) |
            (this.channels.ch4.fault ? 0x08 : 0) |
            (this.comErrorCount > 0 ? 0x10 : 0);

        const data = [
            (ch1mA100 >> 8) & 0xFF, ch1mA100 & 0xFF,
            (ch2mA100 >> 8) & 0xFF, ch2mA100 & 0xFF,
            Math.round(this.channels.ch3.actual) & 0xFF,
            Math.round(this.channels.ch4.actual) & 0xFF,
            faultByte, 0x00,
        ];

        try {
            this.sys.canBus.send({ id: frameId, extended: false, rtr: false, dlc: 8, data, sender: this.id, timestamp: Date.now() });
            this.txCount++;
            this.canBusConnected = true;
        } catch (e) {
            this.comErrorCount++;
            this.canBusConnected = false;
        }
    };
}
