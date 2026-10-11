import { S7_200_EM_Base } from './S7200_EM_Base.js';

const MODES = [
    { label: '±10V', value: 'V+-10' },
    { label: '0~10V', value: 'V0-10' },
    { label: '0~20mA', value: 'I0-20' },
    { label: '4~20mA', value: 'I4-20' },
];

const clampRaw = (v) => {
    let n = Math.round(v || 0);
    if (n > 32767) n = 32767;
    if (n < -32768) n = -32768;
    return n;
};

/**
 * S7-200 SMART 模拟量输入扩展模块 EM AI04
 * ═══════════════════════════════════════════════════════════════════════════
 *  - 4 个模拟量输入通道（默认 ±10V，可切换 0~10V / 0~20mA / 4~20mA）
 *  - 高度与 CPU SR40 相同，宽度约其 1/4；左侧凸口插入 CPU / 上一级模块右侧凹口
 *  - 右侧含同样凹口，可级联下一块扩展模块
 *  - 地址：第 slot 槽第 ch 通道 → AIW{slot*8 + ch*2}（字索引 slot*4+ch）
 *
 *  通道值来源：优先读取通道端子（ch+ / ch-）间电压；端子未接线时用可设置的
 *  工程值（便于无源演示）。
 */
export class S7_200_EM_AI04 extends S7_200_EM_Base {
    constructor(config, sys) {
        super(config, sys, { model: 'EM AI04', channels: 4, type: 's7200_ai04' });

        // 通道信号模式
        this._modes = [0, 1, 2, 3].map(i =>
            config[`ch${i}mode`] !== undefined ? config[`ch${i}mode`] : 'V+-10');
        // 工程值（V；未接线时的演示值）
        this._values = [0, 1, 2, 3].map(i =>
            config[`ch${i}`] !== undefined ? parseFloat(config[`ch${i}`]) : 0);
        // 原始值（供上位机/求解器读取）
        this._raw = [0, 0, 0, 0];

        this._configExtra = {
            ch0mode: this._modes[0], ch1mode: this._modes[1],
            ch2mode: this._modes[2], ch3mode: this._modes[3],
        };
        this.config = Object.assign({ id: this.id, label: this.label }, this._configExtra);
        this._refreshAddressLabels();
    }

    getOrderNo() { return '6ES7 288-3AE04-0AA0'; }

    buildTerminals() {
        const t = [];
        for (let ch = 0; ch < 4; ch++) {
            const row = ch < 2 ? 0 : 1;
            t.push({ id: `ai${ch}p`, label: `${ch}+`, row });
            t.push({ id: `ai${ch}n`, label: `${ch}-`, row });
        }
        return t;
    }

    /** 通道地址列表（挂接后显示于模块中部） */
    getChannelAddressList() {
        if (!(this._ioBase >= 0)) return [];
        return [0, 1, 2, 3].map(ch => this.getAIWAddress(ch));
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
    /** AIW 起始地址（显示用），如 0 → AIW0 */
    getAIWBase() { return (this._ioBase >= 0) ? this._ioBase : null; }
    /** 求解器内部字索引（= 地址数字，如 AIW2 → 2） */
    getWordIndex(ch) { return (this._ioBase >= 0) ? this._ioBase + ch * 2 : -1; }
    /** 通道地址字符串，如 AIW0 */
    getAIWAddress(ch) {
        if (!(this._ioBase >= 0)) return '';
        return `AIW${this._ioBase + ch * 2}`;
    }

    getChannelInfo() {
        return [0, 1, 2, 3].map(ch => ({
            ch, addr: this.getAIWAddress(ch),
            mode: this._modes[ch], value: this._values[ch], raw: this._raw[ch],
        }));
    }

    /** 通道输入端口对（供求解器读取电路电压） */
    analogInputPorts() {
        return [0, 1, 2, 3].map(ch => [
            `${this.id}_wire_ai${ch}p`, `${this.id}_wire_ai${ch}n`,
        ]);
    }

    // ── 值 ─────────────────────────────────────────────────────
    setEngValue(ch, v) {
        if (ch < 0 || ch > 3) return;
        this._values[ch] = parseFloat(v) || 0;
    }
    /** 工程值：电压档为 V，电流档为 mA */
    getEngValue(ch) { return this._values[ch]; }
    getRawValue(ch) { return this._raw[ch]; }

    /** 是否电流输入档（需要采样电阻） */
    isCurrentMode(ch) { const m = this._modes[ch]; return m === 'I0-20' || m === 'I4-20'; }
    /** 电流档内部采样电阻（Ω）：回路电流经它转为电压供测量 */
    getShuntResistance() { return 250; }

    _voltToRaw(eng, mode) {
        switch (mode) {
            case 'V0-10': return clampRaw(eng / 10 * 27648);        // 0~10V → 0~27648
            case 'V+-10':
            default:      return clampRaw(eng / 10 * 27648);        // ±10V → ±27648
        }
    }
    /** 回路电流(A) → 原始值：4~20mA → 0~27648；0~20mA → 0~27648 */
    _currToRaw(iA, mode) {
        const mA = iA * 1000;
        if (mode === 'I0-20') return clampRaw(mA / 20 * 27648);
        return clampRaw((mA - 4) / 16 * 27648);                     // I4-20
    }

    _updateValues() {
        const sys = this.sys;
        const hasV = sys && typeof sys.getVoltageBetween === 'function';
        for (let ch = 0; ch < 4; ch++) {
            const p = `${this.id}_wire_ai${ch}p`;
            const n = `${this.id}_wire_ai${ch}n`;
            const wired = (sys.conns || []).some(c => c.from === p || c.to === p);
            const mode = this._modes[ch];
            if (this.isCurrentMode(ch)) {
                // 电流档：回路电流流过内部采样电阻 → 电压差 I = V/R
                const R = this.getShuntResistance();
                let vdiff;
                if (hasV && wired) vdiff = sys.getVoltageBetween(p, n) || 0;
                else vdiff = (this._values[ch] || 0) / 1000 * R;    // 未接线：用设定 mA 反推
                const iA = vdiff / R;
                this._values[ch] = +(iA * 1000).toFixed(3);          // 存 mA
                this._raw[ch] = this._currToRaw(iA, mode);
            } else {
                let eng;
                if (hasV && wired) eng = sys.getVoltageBetween(p, n);
                else eng = this._values[ch];
                this._values[ch] = +(eng || 0).toFixed(3);
                this._raw[ch] = this._voltToRaw(eng, mode);
            }
        }
    }
}

export default S7_200_EM_AI04;
