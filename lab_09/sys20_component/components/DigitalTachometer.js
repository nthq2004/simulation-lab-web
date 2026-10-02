import { BaseComponent } from './BaseComponent.js';

/**
 * DigitalTachometer — 数字转速表（4~20mA 输入）
 * ═══════════════════════════════════════════════════════════════════════════
 *  - 输入 4~20mA（对应量程 n_min~n_max r/min）；内部采样电阻 R=250Ω，
 *    4~20mA 转换为 1~5V 电压后测量显示： n = (I−4)/16 × (n_max−n_min) + n_min
 *  - 端口：sig（信号 +）、com（信号 −/公共）
 *  - 采样电阻由 `DeviceStamps.stampDigitalTachometers` 注入电路。
 */
export class DigitalTachometer extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.width = Math.max(170, config.width || 200);
        this.height = Math.max(110, config.height || 130);

        this.type = 'digital_tachometer';
        this.special = 'digital_tach';
        this.cache = 'fixed';
        this.label = config.label || '数字转速表';

        this.rpmMin = config.rpmMin !== undefined ? parseFloat(config.rpmMin) : 0;
        this.rpmMax = config.rpmMax !== undefined ? parseFloat(config.rpmMax) : 2000;
        this.inputMode = config.inputMode || 'I4-20';   // I4-20 / I0-20

        this._shuntR = 250;
        this._mA = 0;
        this._rpm = 0;

        this._initGroups();
        this._draw();
        this._bind();

        this.addPort(55, this.height, 'sig', 'wire', 'p');
        this.addPort(145, this.height, 'com', 'wire');

        this.config = {
            id: this.id, label: this.label,
            rpmMin: this.rpmMin, rpmMax: this.rpmMax, inputMode: this.inputMode,
        };
    }

    _draw() {
        const W = this.width, H = this.height;
        this._staticGroup.add(new Konva.Rect({
            x: 0, y: 0, width: W, height: H, cornerRadius: 6,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint: { x: 0, y: H },
            fillLinearGradientColorStops: [0, '#4a5058', 0.5, '#343a41', 1, '#23282e'],
            stroke: '#12161a', strokeWidth: 1.5, listening: false,
        }));
        // 铭牌
        this._staticGroup.add(new Konva.Text({
            x: 6, y: 6, width: W - 12, text: this.label,
            fontSize: Math.max(11, W * 0.06), fontStyle: 'bold', fontFamily: 'Microsoft YaHei',
            fill: '#cfd6dd', align: 'left', listening: false,
        }));
        // 数码屏
        this._staticGroup.add(new Konva.Rect({
            x: W * 0.08, y: H * 0.26, width: W * 0.84, height: H * 0.42,
            fill: '#05140a', stroke: '#0a3a1a', strokeWidth: 1, cornerRadius: 3, listening: false,
        }));
        // 端子
        [[55, 'sig'], [145, 'com']].forEach(([x]) => {
            this._staticGroup.add(new Konva.Rect({
                x: x - 5, y: H - 6, width: 10, height: 10, cornerRadius: 1,
                fill: '#8a929a', stroke: '#5a6168', strokeWidth: 0.6, listening: false,
            }));
        });
        this._staticGroup.add(new Konva.Text({
            x: 25, y: H - 26, width: 60, text: 'sig', fontSize: 11,
            fontFamily: 'Arial', fill: '#dbe2e8', align: 'center', listening: false,
        }));
        this._staticGroup.add(new Konva.Text({
            x: 115, y: H - 26, width: 60, text: 'com', fontSize: 11,
            fontFamily: 'Arial', fill: '#dbe2e8', align: 'center', listening: false,
        }));

        // 动态显示
        this._valText = new Konva.Text({
            x: W * 0.08, y: H * 0.30, width: W * 0.84, text: '0',
            fontSize: Math.max(22, W * 0.16), fontStyle: 'bold', fontFamily: 'Consolas, monospace',
            fill: '#4df08a', align: 'center', listening: false,
        });
        this._unitText = new Konva.Text({
            x: W * 0.08, y: H * 0.56, width: W * 0.84, text: 'r/min  0.00mA',
            fontSize: Math.max(10, W * 0.055), fontFamily: 'Consolas, monospace',
            fill: '#9fe0b8', align: 'center', listening: false,
        });
        this._dynamicGroup.add(this._valText, this._unitText);

        this._interactGroup.add(new Konva.Rect({
            x: 0, y: 0, width: W, height: H, fill: 'rgba(0,0,0,0)', listening: true,
        }));

        // 端子热区（供工作流箭头精确定位）
        this.addClickablePart('term-sig', 45, H - 32, 20, 38);
        this.addClickablePart('term-com', 135, H - 32, 20, 38);
    }

    _bind() {
        this.group.on('dblclick dbltap', (e) => { e.cancelBubble = true; this.showConfigDialog(); });
    }

    /** 采样电阻（供 DeviceStamps 注入） */
    getShuntResistance() { return this._shuntR; }

    tick() {
        const sys = this.sys;
        let mA = 0;
        if (sys && typeof sys.getVoltageBetween === 'function') {
            const v = sys.getVoltageBetween(`${this.id}_wire_sig`, `${this.id}_wire_com`) || 0;
            mA = (v / this._shuntR) * 1000;
        }
        this._mA = mA;
        const span = this.rpmMax - this.rpmMin;

        let text, fill;
        if (mA < 3.6) { text = 'LLLL'; fill = '#ff5a5a'; this._rpm = 0; }
        else if (mA > 21) { text = 'HHHH'; fill = '#ff5a5a'; this._rpm = 0; }
        else {
            const rpm = (this.inputMode === 'I0-20')
                ? (mA / 20) * span + this.rpmMin
                : ((mA - 4) / 16) * span + this.rpmMin;
            this._rpm = Math.max(this.rpmMin, Math.min(this.rpmMax, Math.round(rpm)));
            text = String(this._rpm).padStart(4, ' ');
            fill = '#4df08a';
        }
        if (this._valText) { this._valText.text(text); this._valText.fill(fill); }
        if (this._unitText) this._unitText.text(`r/min  ${mA.toFixed(2)}mA`);
        this.markDirty();
        this._refreshIfDirty();
    }

    getSpeed() { return this._rpm; }
    getCurrent() { return this._mA; }

    getConfigFields() {
        return [
            { label: '位号/名称', key: 'label', type: 'text' },
            { label: '量程下限 (r/min)', key: 'rpmMin', type: 'number' },
            { label: '量程上限 (r/min)', key: 'rpmMax', type: 'number' },
            { label: '输入信号', key: 'inputMode', type: 'select', options: [
                { label: '4~20mA', value: 'I4-20' }, { label: '0~20mA', value: 'I0-20' },
            ] },
        ];
    }

    onConfigUpdate(cfg = {}) {
        if (cfg.label !== undefined) this.label = cfg.label;
        if (cfg.rpmMin !== undefined) this.rpmMin = parseFloat(cfg.rpmMin) || 0;
        if (cfg.rpmMax !== undefined) this.rpmMax = parseFloat(cfg.rpmMax) || 2000;
        if (cfg.inputMode !== undefined) this.inputMode = cfg.inputMode;
        this.config = Object.assign({}, this.config, cfg);
        this.markDirty();
        this._refreshIfDirty();
    }

    destroy() { super.destroy?.(); }
}

export default DigitalTachometer;
