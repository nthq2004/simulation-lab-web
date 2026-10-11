import { S7_200_EM_Base } from './S7200_EM_Base.js';

/**
 * S7-200 SMART 开关量（数字量）8 路输入扩展模块 EM DI08
 * ═══════════════════════════════════════════════════════════════════════════
 *  - 8 点 24V DC 输入，共用公共端 1M（源型接法）
 *  - 外观/接口同其它 EM：高同 SR40、宽约 1/4；左侧凸口(伸出 10px，不计入宽度)，
 *    右侧同款凹口，可级联
 *  - 地址：第 k 个 EM DI08（按类型顺序）→ 输入字节 3+k
 *          通道地址 I{3+k}.0 ~ I{3+k}.7（内部位索引 (3+k)*8+n）
 *
 *  数据：由 S7200Solver 每个扫描周期读取各通道 dinN 相对 1M 的电平，
 *        写入过程映像 I，并回填本模块用于指示灯显示。
 */
export class S7_200_EM_DI08 extends S7_200_EM_Base {
    constructor(config, sys) {
        super(config, sys, { model: 'EM DI08', channels: 8, type: 's7200_di08' });

        this._inBits = new Array(8).fill(false);
        // 注意：_chanLeds 已在 _createDynamicNodes()（super 内）建好，勿再清空
        this.config = { id: this.id, label: this.label };
        this._refreshAddressLabels();
    }

    getOrderNo() { return '6ES7 288-2DE08-0AA0'; }

    buildTerminals() {
        // 公共端 1M 单独一行；8 路输入分两行（每行 4 路）
        return [
            { id: 'com',  label: '1M', row: 0 },
            { id: 'din0', label: '0',  row: 1 },
            { id: 'din1', label: '1',  row: 1 },
            { id: 'din2', label: '2',  row: 1 },
            { id: 'din3', label: '3',  row: 1 },
            { id: 'din4', label: '4',  row: 2 },
            { id: 'din5', label: '5',  row: 2 },
            { id: 'din6', label: '6',  row: 2 },
            { id: 'din7', label: '7',  row: 2 },
        ];
    }

    // ── 地址 ───────────────────────────────────────────────────
    getByteIndex() { return (this._ioKind === 'I' && this._ioBase >= 0) ? (this._ioBase / 8) : -1; }
    getAddress(n) { return (this._ioBase >= 0) ? `I${this._ioBase / 8}.${n}` : ''; }
    getChannelAddressList() {
        if (!(this._ioBase >= 0)) return [];
        const b = this._ioBase / 8;
        return [`IB${b}`, `I${b}.0~I${b}.7`];
    }
    getChannelInfo() {
        return Array.from({ length: 8 }, (_, n) => ({ ch: n, addr: this.getAddress(n) }));
    }

    /** 每路输入端口对 [输入, 公共端]，供求解器读取电路电平 */
    getDigitalInputPorts() {
        return Array.from({ length: 8 }, (_, n) => [`${this.id}_wire_din${n}`, `${this.id}_wire_com`]);
    }

    // ── 每通道状态灯 ───────────────────────────────────────────
    _createDynamicNodes() {
        super._createDynamicNodes();
        this._chanLeds = {};
        (this._termSpec || []).forEach(t => {
            if (!t.id || t.id === 'com') return;
            const led = new Konva.Circle({
                x: t.ax, y: t.ay - 12, radius: 5,   // 与 CPU 主模块 I/O 指示灯同尺寸（下移，避免压住标注）
                fill: '#26303a', stroke: '#12161a', strokeWidth: 0.8, listening: false,
            });
            this._dynamicGroup.add(led);
            this._chanLeds[t.id] = led;
        });
    }

    /** 求解器回填 8 位输入状态 */
    setInputBits(bits) {
        for (let n = 0; n < 8; n++) this._inBits[n] = !!bits[n];
    }

    _updateValues() {
        for (let n = 0; n < 8; n++) {
            const led = this._chanLeds[`din${n}`];
            if (led) led.fill(this._inBits[n] ? '#26d24e' : '#26303a');   // 与 CPU 输入指示灯同色
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

export default S7_200_EM_DI08;
