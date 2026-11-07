import { S7_200_EM_Base } from './S7200_EM_Base.js';

/**
 * S7-200 SMART 开关量（数字量）8 路输出扩展模块 EM DQ08（晶体管源型）
 * ═══════════════════════════════════════════════════════════════════════════
 *  - 8 点晶体管源型输出，共用负载电源正端 1L+（与 CPU 的 DQ 输出模型一致）；
 *    某路 Q=1 时该路输出端与 1L+ 内部导通，负载另一端接 0V 即成回路。
 *  - 外观/接口同其它 EM：高同 SR40、宽约 1/4；左侧凸口(伸出 10px，不计入宽度)，
 *    右侧同款凹口，可级联
 *  - 地址：第 k 个 EM DQ08（按类型顺序）→ 输出字节 2+k
 *          通道地址 Q{2+k}.0 ~ Q{2+k}.7（内部位索引 (2+k)*8+n）
 *
 *  数据：CPU 扫描结束回填 Q 过程映像 → 本模块记录各路状态；
 *        拓扑层据 __qOut 将输出端与 1L+ 短接（见 CircuitTopology）。
 */
export class S7_200_EM_DQ08 extends S7_200_EM_Base {
    constructor(config, sys) {
        super(config, sys, { model: 'EM DQ08', channels: 8, type: 's7200_dq08' });

        this._qOut = new Array(8).fill(false);
        // 注意：_chanLeds 已在 _createDynamicNodes()（super 内）建好，勿再清空
        this.config = { id: this.id, label: this.label };
        this._refreshAddressLabels();
    }

    getOrderNo() { return '6ES7 288-2DT08-0AA0'; }

    buildTerminals() {
        // 负载电源 1L+ 单独一行；8 路输出分两行（每行 4 路）
        return [
            { id: '1l',  label: '1L+', row: 0, pwr: true },
            { id: 'dq0', label: '0',   row: 1 },
            { id: 'dq1', label: '1',   row: 1 },
            { id: 'dq2', label: '2',   row: 1 },
            { id: 'dq3', label: '3',   row: 1 },
            { id: 'dq4', label: '4',   row: 2 },
            { id: 'dq5', label: '5',   row: 2 },
            { id: 'dq6', label: '6',   row: 2 },
            { id: 'dq7', label: '7',   row: 2 },
        ];
    }

    // ── 地址 ───────────────────────────────────────────────────
    getByteIndex() { return (this._ioKind === 'Q' && this._ioBase >= 0) ? (this._ioBase / 8) : -1; }
    getAddress(n) { return (this._ioBase >= 0) ? `Q${this._ioBase / 8}.${n}` : ''; }
    getChannelAddressList() {
        if (!(this._ioBase >= 0)) return [];
        const b = this._ioBase / 8;
        return [`QB${b}`, `Q${b}.0~Q${b}.7`];
    }
    getChannelInfo() {
        return Array.from({ length: 8 }, (_, n) => ({ ch: n, addr: this.getAddress(n) }));
    }

    /** 8 路输出端口 id（与 1L+ 内部导通由拓扑层实现） */
    getDigitalOutputPorts() {
        return Array.from({ length: 8 }, (_, n) => `${this.id}_wire_dq${n}`);
    }
    getSupplyPort() { return `${this.id}_wire_1l`; }

    // ── 每通道状态灯 ───────────────────────────────────────────
    _createDynamicNodes() {
        super._createDynamicNodes();
        this._chanLeds = {};
        (this._termSpec || []).forEach(t => {
            if (!t.id || t.id === '1l') return;
            const led = new Konva.Circle({
                x: t.ax, y: t.ay - 12, radius: 5,   // 与 CPU 主模块 I/O 指示灯同尺寸（下移，避免压住标注）
                fill: '#26303a', stroke: '#12161a', strokeWidth: 0.8, listening: false,
            });
            this._dynamicGroup.add(led);
            this._chanLeds[t.id] = led;
        });
    }

    /** 求解器回填 Q 过程映像 → 各路输出状态 */
    applyQ(qArray) {
        if (!Array.isArray(qArray) || this._ioBase < 0) {
            if (this._ioBase < 0) this._qOut.fill(false);
            return;
        }
        for (let n = 0; n < 8; n++) this._qOut[n] = !!qArray[this._ioBase + n];
    }

    _updateValues() {
        for (let n = 0; n < 8; n++) {
            const led = this._chanLeds[`dq${n}`];
            if (led) led.fill(this._qOut[n] ? '#f0a020' : '#26303a');
        }
    }

    _refreshAddressLabels() {
        if (this._ioText) this._ioText.text(this._expSlot >= 0 ? `槽 ${this._expSlot}` : '未挂接');
        if (this._addrText) {
            const list = this.getChannelAddressList();
            this._addrText.text(list.length ? list.join('\n') : '未挂接');
        }
        this.markDirty();
        this._refreshIfDirty();
    }
}

export default S7_200_EM_DQ08;
