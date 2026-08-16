/**
 * AI.can.js — 模拟量输入模块：CAN 总线通信 Mixin
 * 船舶机舱监测报警系统 · CAN 总线架构
 *
 * 包含：_canTransmit、_sendResponse、onCanReceive、
 *       _handleNMT、_isCanTransmit、_int16ToBytes
 */

import { CAN_FUNC, CANId, NMT_CMD, NMT_STATE } from '../CANBUS.js';

export function applyCANMixin(proto) {

    // ──────────────────────────────────────────
    //  辅助：有符号 16 位整数 → 大端字节对
    // ──────────────────────────────────────────
    proto._int16ToBytes = function (value) {
        let v = value < 0 ? 0x10000 + value : value;
        return [(v >> 8) & 0xFF, v & 0xFF];
    };

    // ──────────────────────────────────────────
    //  NMT 状态检查
    // ──────────────────────────────────────────
    proto._isCanTransmit = function () {
        return this.nmtState === NMT_STATE.RUN;
    };

    // ──────────────────────────────────────────
    //  NMT 命令处理
    // ──────────────────────────────────────────
    proto._handleNMT = function (cmd) {
        if (cmd === NMT_CMD.START) {
            if (this.nmtState === NMT_STATE.INIT || this.nmtState === NMT_STATE.PREOP) {
                this.nmtState = NMT_STATE.RUN;
                this.nmtStateTime = Date.now();
                console.log(`[AI #${this.nodeAddress}] NMT: Starting → ${NMT_STATE.RUN} state`);
            }
        } else if (cmd === NMT_CMD.STOP) {
            if (this.nmtState === NMT_STATE.RUN) {
                this.nmtState = NMT_STATE.STOP;
                this.nmtStateTime = Date.now();
                console.log(`[AI #${this.nodeAddress}] NMT: Stopping → ${NMT_STATE.STOP} state`);
            }
        } else if (cmd === NMT_CMD.RESET) {
            this.nmtState = NMT_STATE.INIT;
            this.nmtStateTime = Date.now();
            this.txCount = this.rxCount = this.comErrorCount = 0;
            this.lastTxTime = this.lastRxTime = 0;
            console.log(`[AI #${this.nodeAddress}] NMT: Resetting → ${NMT_STATE.INIT} state`);
        } else if (cmd === NMT_CMD.RESETCOM) {
            this.comErrorCount = 0;
            this.lastTxTime = this.lastRxTime = 0;
            this.txCount = this.rxCount = 0;
            console.log(`[AI #${this.nodeAddress}] NMT: Communication reset`);
        }
    };

    // ──────────────────────────────────────────
    //  定时上报帧（AI_REPORT）
    // ──────────────────────────────────────────
    proto._canTransmit = function () {
        if (!this._isCanTransmit()) return;
        if (!this.busConnected || this.commFault) {
            this.canBusConnected = false;
            if (++this.comErrorCount > 10) this.ledStatus.flt = true;
            return;
        }
        if (!this.sys || typeof this.sys.canBus === 'undefined') return;

        const frameId = CANId.encode(CAN_FUNC.AI_REPORT, this.nodeAddress & 0x0F);

        // 辅助：将有符号整数转为大端字节对（保持两补码）
        const pack16Signed = (raw) => {
            // 确保在 16 位范围内，保持两补码表示
            let v = raw & 0xFFFF;
            return [(v >> 8) & 0xFF, v & 0xFF];
        };

        const { ch1, ch2, ch3, ch4 } = this.channels;
        // ch1, ch2: scale=100 (2位小数)；ch3, ch4: scale=10 (1位小数)
        // 故障标记：所有通道故障时返回 0x8000 (两补码表示的 -32768)
        const data = [
            ...pack16Signed(ch1.fault ? 0x8000 : Math.round(ch1.value * 100)),
            ...pack16Signed(ch2.fault ? 0x8000 : Math.round(ch2.value * 100)),
            ...pack16Signed(ch3.fault ? 0x8000 : Math.round(ch3.value * 10)),
            ...pack16Signed(ch4.fault ? 0x8000 : Math.round(ch4.value * 10)),
        ];

        const frame = {
            id: frameId, extended: false, rtr: false, dlc: 8,
            data, sender: this.id, timestamp: Date.now(),
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
    //  发送响应帧（AI_REPLY）
    // ──────────────────────────────────────────
    proto._sendResponse = function (responseData) {
        if (!this.sys || typeof this.sys.canBus === 'undefined') return;

        const frameId = CANId.encode(CAN_FUNC.AI_REPLY, this.nodeAddress & 0x0F);
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
    //  接收帧处理（由 CAN 总线管理器调用）
    // ──────────────────────────────────────────
    proto.onCanReceive = function (frame) {
        if (!frame) return;
        if (!this.busConnected || this.commFault) return;

        const { funcCode, nodeAddr } = CANId.decode(frame.id);

        // ── NMT 广播命令 ──
        if (funcCode === CAN_FUNC.NMT) {
            const nmtCmd = frame.data[0];
            const targetAddr = frame.data[1];
            if (targetAddr === 0 || targetAddr === this.nodeAddress) {
                this._handleNMT(nmtCmd);
            }
            return;
        }

        // ── 广播心跳（Operational = 0x05）──
        if (funcCode === CAN_FUNC.BROADCAST) {
            if (frame.data && frame.data.length > 0 && frame.data[0] === 0x05) {
                this._lastHeartbeat = Date.now();
                if (this.nmtState === NMT_STATE.PREOP || this.nmtState === NMT_STATE.INIT) {
                    this.nmtState = NMT_STATE.RUN;
                    this.nmtStateTime = Date.now();
                    console.log(`[AI #${this.nodeAddress}] Heartbeat received → ${NMT_STATE.RUN} state`);
                }
            }
            return;
        }

        // ── 配置命令（AI_CONFIG，且地址匹配）──
        if (funcCode !== CAN_FUNC.AI_CONFIG || nodeAddr !== (this.nodeAddress & 0x0F)) return;

        this.lastRxTime = Date.now();
        this.rxCount++;
        this.ledStatus.com = true;

        const cmd = frame.data[0];
        const chKeys = ['ch1', 'ch2', 'ch3', 'ch4'];

        switch (cmd) {
            case 0x01: // 修改采样/上报周期
                this.txInterval = Math.max(50, (frame.data[1] << 8) | frame.data[2]);
                break;

            case 0x02: // 立即上报
                this.lastTxTime = 0;
                break;

            case 0x03: { // 修改报警阈值 HH / LL
                const chId = chKeys[frame.data[1] & 0x03];
                if (chId && this.alarms[chId]) {
                    // ch1, ch2: scale=100 (2位小数)；ch3, ch4: scale=10 (1位小数)
                    const scale = (chId === 'ch1' || chId === 'ch2') ? 100 : 10;
                    const hhRaw = (frame.data[2] << 8) | frame.data[3];
                    const llRaw = (frame.data[4] << 8) | frame.data[5];
                    const hhSigned = hhRaw > 32767 ? hhRaw - 65536 : hhRaw;
                    const llSigned = llRaw > 32767 ? llRaw - 65536 : llRaw;
                    this.alarms[chId].hh = hhSigned / scale;
                    this.alarms[chId].ll = llSigned / scale;
                }
                break;
            }
            case 0x04: { // 修改报警阈值 H / L
                const chId = chKeys[frame.data[1] & 0x03];
                if (chId && this.alarms[chId]) {
                    // ch1, ch2: scale=100 (2位小数)；ch3, ch4: scale=10 (1位小数)
                    const scale = (chId === 'ch1' || chId === 'ch2') ? 100 : 10;
                    const hRaw = (frame.data[2] << 8) | frame.data[3];
                    const lRaw = (frame.data[4] << 8) | frame.data[5];
                    const hSigned = hRaw > 32767 ? hRaw - 65536 : hRaw;
                    const lSigned = lRaw > 32767 ? lRaw - 65536 : lRaw;
                    this.alarms[chId].h = hSigned / scale;
                    this.alarms[chId].l = lSigned / scale;
                }
                break;
            }
            case 0x05: { // 设置通道模式
                const modeMap = { 0: 'normal', 1: 'test', 2: 'disable' };
                const chId = chKeys[frame.data[1] & 0x03];
                const mode = modeMap[frame.data[2] & 0x03];
                if (chId && mode) this.setChannelMode(chId, mode);
                break;
            }
            case 0x06: { // 设置工程量（test 模式）
                const chId = chKeys[frame.data[1] & 0x03];
                // ch1, ch2: scale=100 (2位小数)；ch3, ch4: scale=10 (1位小数)
                const scale = (chId === 'ch1' || chId === 'ch2') ? 100 : 10;
                const rawValue = (frame.data[2] << 8) | frame.data[3];
                const signed = rawValue > 32767 ? rawValue - 65536 : rawValue;
                if (chId) this.setValue(chId, signed / scale);
                break;
            }
            case 0x07: { // 读取报警 HH / LL
                const chId = chKeys[frame.data[1] & 0x03];
                if (chId && this.alarms[chId]) {
                    // ch1, ch2: scale=100 (2位小数)；ch3, ch4: scale=10 (1位小数)
                    const scale = (chId === 'ch1' || chId === 'ch2') ? 100 : 10;
                    const [hhH, hhL] = this._int16ToBytes(Math.round(this.alarms[chId].hh * scale));
                    const [llH, llL] = this._int16ToBytes(Math.round(this.alarms[chId].ll * scale));
                    this._sendResponse([0x07, frame.data[1] & 0x03, hhH, hhL, llH, llL, 0, 0]);
                }
                break;
            }
            case 0x08: { // 读取报警 H / L
                const chId = chKeys[frame.data[1] & 0x03];
                if (chId && this.alarms[chId]) {
                    // ch1, ch2: scale=100 (2位小数)；ch3, ch4: scale=10 (1位小数)
                    const scale = (chId === 'ch1' || chId === 'ch2') ? 100 : 10;
                    const [hH, hL] = this._int16ToBytes(Math.round(this.alarms[chId].h * scale));
                    const [lH, lL] = this._int16ToBytes(Math.round(this.alarms[chId].l * scale));
                    this._sendResponse([0x08, frame.data[1] & 0x03, hH, hL, lH, lL, 0, 0]);
                }
                break;
            }
            case 0x09: { // 读取量程上下限和单位
                const unitMap = { 'MPa': 1, 'bar': 2, '°C': 3, 'cm': 4, 'L/min': 5, '%': 6 };
                const chId = chKeys[frame.data[1] & 0x03];
                if (chId && this.ranges[chId]) {
                    const range = this.ranges[chId];
                    // ch1, ch2: scale=100 (2位小数)；ch3, ch4: scale=10 (1位小数)
                    const scale = (chId === 'ch1' || chId === 'ch2') ? 100 : 10;
                    const [uH, uL] = this._int16ToBytes(Math.round(range.urv * scale));
                    const [lH, lL] = this._int16ToBytes(Math.round(range.lrv * scale));
                    const unitCode = unitMap[range.unit] || 0;
                    this._sendResponse([0x09, frame.data[1] & 0x03, uH, uL, lH, lL, unitCode, 0]);
                }
                break;
            }
            case 0x0A: { // 读取所有通道报警和故障状态
                const alarmCodeMap = { 'LL': 1, 'L': 2, 'H': 3, 'HH': 4, 'normal': 0, 'FAULT': 0 };
                const faultCodeMap = { 'OPEN': 1, 'SHORT': 2, 'OUTRANGE': 3, 'normal': 0 };
                const resp = [0x0A, 0, 0, 0, 0, 0, 0, 0];

                chKeys.forEach((chId, idx) => {
                    const ch = this.channels[chId];
                    const alm = this.alarms[chId];
                    const alarmCode = alarmCodeMap[alm.status] || 0;
                    const faultCode = ch.fault ? (faultCodeMap[ch.faultText] || 0) : 0;
                    resp[idx + 1] = (alarmCode << 4) | faultCode;
                });
                this._sendResponse(resp);
                break;
            }
            case 0x0B: { // 写入量程上下限和单位
                const chId = chKeys[frame.data[1] & 0x03];
                const unitMapR = { 1: 'MPa', 2: 'bar', 3: '°C', 4: 'cm', 5: 'L/min', 6: '%' };
                if (chId) {
                    // ch1, ch2: scale=100 (2位小数)；ch3, ch4: scale=10 (1位小数)
                    const scale = (chId === 'ch1' || chId === 'ch2') ? 100 : 10;
                    const urvRaw = (frame.data[2] << 8) | frame.data[3];
                    const lrvRaw = (frame.data[4] << 8) | frame.data[5];
                    const urvSigned = urvRaw > 32767 ? urvRaw - 65536 : urvRaw;
                    const lrvSigned = lrvRaw > 32767 ? lrvRaw - 65536 : lrvRaw;
                    const urv = urvSigned / scale;
                    const lrv = lrvSigned / scale;
                    const unitCode = frame.data[6] & 0xFF;
                    const unit = unitMapR[unitCode] || '%';
                    this.ranges[chId] = { urv, lrv, unit };
                    // 回复：发送量程确认帧
                    const [uH, uL] = this._int16ToBytes(Math.round(urv * scale));
                    const [lH, lL] = this._int16ToBytes(Math.round(lrv * scale));
                    this._sendResponse([0x09, frame.data[1] & 0x03, uH, uL, lH, lL, unitCode, 0]);
                }
                break;
            }
            case 0xEE: {
                const id = this.id; // 例如 "hello" 或 "hello world"

                // 1. 初始化数组：0xEE 开头，后面跟 7 个 0 占位
                // 这样如果字符串不足 7 位，剩下的会自动补 0
                const payload = [0xEE, 0, 0, 0, 0, 0, 0, 0];

                // 2. 将字符串截取前 7 位，并转换为 ASCII 码填入
                for (let i = 0; i < 7; i++) {
                    if (i < id.length) {
                        payload[i + 1] = id.charCodeAt(i); // i+1 是因为第 0 位是 0xEE
                    }
                }

                this._sendResponse(payload);
                break;
            }
        }
    };
}