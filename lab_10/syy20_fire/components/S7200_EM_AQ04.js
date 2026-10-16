import { S7_200_EM_Base } from './S7200_EM_Base.js';

const MODES = [
    { label: '±10V', value: 'V+-10' },
    { label: '0~10V', value: 'V0-10' },
    { label: '0~20mA', value: 'I0-20' },
    { label: '4~20mA', value: 'I4-20' },
];

/**
 * S7-200 SMART 模拟量输出扩展模块 EM AQ04
 * ═══════════════════════════════════════════════════════════════════════════
 *  - 4 个模拟量输出通道（默认 ±10V，可切换 0~10V / 0~20mA / 4~20mA）
 *  - 外观/接口要求与 EM AI04 相同：高度同 SR40、宽度约 1/4，
 *    左侧凸口（伸出 10px，不计入宽度），右侧同款凹口可级联
 *  - 地址：第 slot 槽第 ch 通道 → AQW{slot*8 + ch*2}（字索引 slot*4+ch）
 *
 *  数据流：CPU 扫描结束把 AQW 写入本模块（applyAQW），模块据此在输出端子
 *  （chV / chM）间注入 0~±10V 电压（由 DeviceStamps 的诺顿源输出）。
 */
export class S7_200_EM_AQ04 extends S7_200_EM_Base {
    constructor(config, sys) {
        super(config, sys, { model: 'EM AQ04', channels: 4, type: 's7200_aq04' });

        this._modes = [0, 1, 2, 3].map(i =>
            config[`ch${i}mode`] !== undefined ? config[`ch${i}mode`] : 'V+-10');
        this._raw = [0, 0, 0, 0];           // 来自 AQW 的原始值
        this._outVoltages = [0, 0, 0, 0];   // 输出电压（V，电压档）
        this._outCurrents = [0, 0, 0, 0];   // 输出电流（mA，电流档）

        this._configExtra = {
            ch0mode: this._modes[0], ch1mode: this._modes[1],
            ch2mode: this._modes[2], ch3mode: this._modes[3],
        };
        this.config = Object.assign({ id: this.id, label: this.label }, this._configExtra);
        this._refreshAddressLabels();
    }

    getOrderNo() { return '6ES7 288-3AQ04-0AA0'; }

    buildTerminals() {
        const t = [];
        for (let ch = 0; ch < 4; ch++) {
            const row = ch < 2 ? 0 : 1;
            t.push({ id: `aq${ch}v`, label: `${ch}V`, row });
            t.push({ id: `aq${ch}m`, label: `${ch}M`, row });
        }
        return t;
    }

    /** 通道地址列表（挂接后显示于模块中部） */
    getChannelAddressList() {
        if (!(this._ioBase >= 0)) return [];
        return [0, 1, 2, 3].map(ch => this.getAQWAddress(ch));
    }

    getExtraConfigFields() {
        const chField = (i) => ({
            label: `通道 ${i} 模式`, key: `ch${i}mode`, type: 'select',
            options: MODES.map(m => ({ label: m.label, value: m.value })),
        });
        return [chField(0), chField(1), chField(2), chField(3)];
    }

    _applyExtraConfig(cfg) {
        for (let i = 0; i < 4; i++) {
            const k = `ch${i}mode`;
            if (cfg[k] !== undefined) this._modes[i] = cfg[k];
        }
    }

    // ── 地址 ───────────────────────────────────────────────────
    getAQWBase() { return (this._ioBase >= 0) ? this._ioBase : null; }
    /** 求解器内部字索引（= 地址数字，如 AQW0 → 0） */
    getWordIndex(ch) { return (this._ioBase >= 0) ? this._ioBase + ch * 2 : -1; }
    getAQWAddress(ch) {
        if (!(this._ioBase >= 0)) return '';
        return `AQW${this._ioBase + ch * 2}`;
    }

    getChannelInfo() {
        return [0, 1, 2, 3].map(ch => ({
            ch, addr: this.getAQWAddress(ch),
            mode: this._modes[ch], raw: this._raw[ch],
            value: this.isCurrentMode(ch) ? +this._outCurrents[ch].toFixed(3) : +this._outVoltages[ch].toFixed(3),
        }));
    }

    /** 是否电流输出档（输出电流源） */
    isCurrentMode(ch) { const m = this._modes[ch]; return m === 'I0-20' || m === 'I4-20'; }

    /** 通道输出端口对（chV / chM），供 DeviceStamps 注入电压 */
    analogOutputPorts() {
        return [0, 1, 2, 3].map(ch => [
            `${this.id}_wire_aq${ch}v`, `${this.id}_wire_aq${ch}m`,
        ]);
    }

    // ── 数据 ───────────────────────────────────────────────────
    /** CPU 扫描结束回写 AQW → 计算各通道输出（电压档为电压，电流档为电流） */
    applyAQW(aqwArray) {
        if (!Array.isArray(aqwArray)) return;
        for (let ch = 0; ch < 4; ch++) {
            const wi = this.getWordIndex(ch);
            const raw = (wi >= 0 && aqwArray[wi] !== undefined) ? aqwArray[wi] : 0;
            this._raw[ch] = raw;
            if (this.isCurrentMode(ch)) this._outCurrents[ch] = this._rawToCurrent(raw, this._modes[ch]);
            else this._outVoltages[ch] = this._rawToVolt(raw, this._modes[ch]);
        }
    }

    getOutputVoltage(ch) { return this._outVoltages[ch] || 0; }
    /** 输出电流（mA）：电流档 */
    getOutputCurrent(ch) { return this._outCurrents[ch] || 0; }

    _rawToVolt(raw, mode) {
        switch (mode) {
            case 'V0-10': return Math.max(0, Math.min(10, raw / 27648 * 10));
            case 'V+-10':
            default:      return Math.max(-10, Math.min(10, raw / 27648 * 10));
        }
    }
    /** 原始值 → 输出电流(mA)：4~20mA → 4~20mA；0~20mA → 0~20mA */
    _rawToCurrent(raw, mode) {
        const pct = Math.max(-0.25, Math.min(1.0625, raw / 27648));
        if (mode === 'I0-20') return Math.max(0, Math.min(21.25, pct * 20));
        return Math.max(3, Math.min(21, 4 + pct * 16));             // I4-20
    }

    _updateValues() { /* 输出值由 applyAQW 更新，无需每帧重算 */ }
}

export default S7_200_EM_AQ04;
