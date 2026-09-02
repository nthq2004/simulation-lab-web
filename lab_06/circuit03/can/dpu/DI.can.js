/**
 * DI.can.js — 数字量输入模块：CAN 总线通信 Mixin
 *
 * 本文件导出一个 applyCANMixin(proto) 函数，
 * 将所有 CAN 通信方法混入 DIModule 的原型。
 */

import { CAN_FUNC, CANId, NMT_CMD, NMT_STATE } from '../CANBUS.js';

export function applyCANMixin(proto) {

    proto._handleNMT = function (cmd) {
        if (cmd === NMT_CMD.START) {
            if (this.nmtState === NMT_STATE.INIT || this.nmtState === NMT_STATE.PREOP) {
                this.nmtState = NMT_STATE.RUN;
                this.nmtStateTime = Date.now();
                console.log(`[DI #${this.nodeAddress}] NMT: Starting → ${NMT_STATE.RUN} state`);
            }
        } else if (cmd === NMT_CMD.STOP) {
            if (this.nmtState === NMT_STATE.RUN) {
                this.nmtState = NMT_STATE.STOP;
                this.nmtStateTime = Date.now();
                console.log(`[DI #${this.nodeAddress}] NMT: Stopping → ${NMT_STATE.STOP} state`);
            }
        } else if (cmd === NMT_CMD.RESET) {
            this.nmtState = NMT_STATE.INIT;
            this.nmtStateTime = Date.now();
            this.txCount = 0; this.rxCount = 0; this.comErrorCount = 0;
            this.lastTxTime = 0; this.lastRxTime = 0;
            console.log(`[DI #${this.nodeAddress}] NMT: Resetting → ${NMT_STATE.INIT} state`);
        } else if (cmd === NMT_CMD.RESETCOM) {
            this.comErrorCount = 0; this.lastTxTime = 0; this.lastRxTime = 0;
            this.txCount = 0; this.rxCount = 0;
            console.log(`[DI #${this.nodeAddress}] NMT: Communication reset`);
        }
    };

    proto._isCanTransmit = function () {
        return this.nmtState === NMT_STATE.RUN;
    };

    /**
     * 上报帧 ID = (CAN_FUNC_DI << 7) | nodeAddress
     * Data（4字节）：
     *   Byte 0: 通道状态位 [bit0=ch1 … bit3=ch4]
     *   Byte 1: 故障位     [bit0=ch1 … bit3=ch4]
     *   Byte 2: 报警位     [bit0=ch1 … bit3=ch4]
     *   Byte 3: 保留
     */
    proto._canTransmit = function () {
        if (!this._isCanTransmit()) return;
        if (!this.sys || typeof this.sys.canBus === 'undefined') return;

        const stateByte = ['ch1', 'ch2', 'ch3', 'ch4'].reduce((b, id, i) =>
            b | (this.channels[id].state ? (1 << i) : 0), 0);
        const faultByte = ['ch1', 'ch2', 'ch3', 'ch4'].reduce((b, id, i) =>
            b | (this.channels[id].fault ? (1 << i) : 0), 0);
        const alarmByte = ['ch1', 'ch2', 'ch3', 'ch4'].reduce((b, id, i) => {
            const alm = this.alarmConfig[id];
            const ch = this.channels[id];
            const alarm = (alm.trigger === 'NONE') ? false :
                (alm.trigger === 'ON' && ch.state) || (alm.trigger === 'OFF' && !ch.state);
            return b | (alarm ? (1 << i) : 0);
        }, 0);

        try {
            this.sys.canBus.send({
                id: CANId.encode(CAN_FUNC.DI_REPORT, this.nodeAddress),
                extended: false, rtr: false, dlc: 4,
                data: [stateByte, faultByte, alarmByte, 0x00],
                sender: this.id, timestamp: Date.now(),
            });
            this.txCount++;
            this.canBusConnected = true;
        } catch (e) {
            this.comErrorCount++;
            this.canBusConnected = false;
        }
    };

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

        if (frame.id !== CANId.encode(CAN_FUNC.DI_CONFIG, this.nodeAddress)) return;
        this.lastRxTime = Date.now();
        this.rxCount++;

        const cmd = frame.data[0];
        const chKeys = ['ch1', 'ch2', 'ch3', 'ch4'];
        const chMask = frame.data[1] || 0;

        switch (cmd) {
            case 0x04: {
                const chIdxQuery = frame.data[1];
                if (chIdxQuery >= 0 && chIdxQuery < 4) {
                    const currentTrigger = this.alarmConfig[chKeys[chIdxQuery]]?.trigger || 'OFF';
                    const triggerValueMap = { 'OFF': 0, 'ON': 1, 'NONE': 2 };
                    try {
                        this.sys.canBus.send({
                            id: CANId.encode(CAN_FUNC.DI_REPLY, this.nodeAddress),
                            extended: false, rtr: false, dlc: 3,
                            data: [0x04, chIdxQuery, triggerValueMap[currentTrigger] || 0, 0, 0, 0, 0, 0],
                            sender: this.id, timestamp: Date.now(),
                        });
                    } catch (e) { console.warn('[DI] 报警配置查询回复发送失败', e); }
                }
                break;
            }
            case 0x01: {
                const chIdx = frame.data[2];
                const triggerValue = frame.data[3];
                if (chIdx >= 0 && chIdx < 4) {
                    const id = chKeys[chIdx];
                    if (triggerValue === 1) this.alarmConfig[id].trigger = 'ON';
                    else if (triggerValue === 2) this.alarmConfig[id].trigger = 'NONE';
                    else this.alarmConfig[id].trigger = 'OFF';
                }
                try {
                    this.sys.canBus.send({
                        id: CANId.encode(CAN_FUNC.DI_REPLY, this.nodeAddress),
                        extended: false, rtr: false, dlc: 3,
                        data: [0x01, chIdx, triggerValue, 0, 0, 0, 0, 0],
                        sender: this.id, timestamp: Date.now(),
                    });
                } catch (e) { console.warn('[DI] 报警配置回复发送失败', e); }
                break;
            }
            case 0x02:
                chKeys.forEach((id, i) => { if (chMask & (1 << i)) this.channels[id].counter = 0; });
                break;
            case 0x03:
                this.txInterval = Math.max(50, (frame.data[1] << 8) | frame.data[2]);
                break;
            case 0xEE: {
                const id = this.id;
                const payload = [0xEE, 0, 0, 0, 0, 0, 0, 0];
                for (let i = 0; i < 7; i++) { if (i < id.length) payload[i + 1] = id.charCodeAt(i); }
                console.log(`[DI #${this.nodeAddress}] NMT Test Command Received, replying with ID: ${id}`);
                this._sendResponse(payload);
                break;
            }
        }
    };

    proto._sendResponse = function (responseData) {
        if (!this.sys || typeof this.sys.canBus === 'undefined') return;

        const frameId = CANId.encode(CAN_FUNC.DI_REPLY, this.nodeAddress & 0x0F);
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
}
