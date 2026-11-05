import { BaseComponent } from './BaseComponent.js';

export class RealIGBT extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);
        this.cache = 'fixed';
        this._initGroups();
        this.type = 'igbt';

        this.vth = 4.5;
        this.vOn = 1.8;
        this.rOn = 0.1;
        this.rOnDisp = 50;
        this.rOff = 1e6;
        // C-E 间固有 PN 结（体二极管）正向压降，供万用表测量；0 表示无体二极管
        this.vBodyDiode = config.vBodyDiode !== undefined ? Number(config.vBodyDiode) : 0.6;
        this._igbtStampMode = 'off';
        this._isOn = false;
        this._faultCEShort = false;
        this._faultCEOpen = false;
        // 测试标志：为真时隐藏型号/参数标注，供考核/测试使用
        this.testFlag = config.testFlag || false;

        this.config = { id: this.id, vth: this.vth, vOn: this.vOn, rOn: this.rOn, rOff: this.rOff, vBodyDiode: this.vBodyDiode, testFlag: this.testFlag };

        this.initPorts();
        this.initVisuals();
    }

    initPorts() {
        this.addPort(-50, 0, 'c', 'wire', 'p');
        this.addPort(50, 0, 'e', 'wire');
        this.addPort(0, 30, 'g', 'wire', 'g');
    }

    initVisuals() {
        const c = {
            pin: '#bcc6cf',
            pinDark: '#8a9299',
            bodyHi: '#2c3e50',
            bodyLo: '#1a252f',
            accent: '#c0a060',
            printed: '#e8ecf0',
        };

        const pins = [
            new Konva.Line({ points: [-30, 0, -50, 0], stroke: c.pin, strokeWidth: 4.5, lineCap: 'round' }),
            new Konva.Line({ points: [30, 0, 50, 0], stroke: c.pin, strokeWidth: 4.5, lineCap: 'round' }),
            new Konva.Line({ points: [0, 18, 0, 30], stroke: c.pin, strokeWidth: 3, lineCap: 'round' }),
        ];
        pins.forEach(p => this._staticGroup.add(p));

        const bodyPath = new Konva.Path({
            data: 'M-30,-18 L18,-18 L30,-10 L30,18 L-30,18 Z',
            fillLinearGradientStartPoint: { x: -30, y: -18 },
            fillLinearGradientEndPoint: { x: 30, y: 18 },
            fillLinearGradientColorStops: [0, c.bodyHi, 0.5, c.bodyLo, 1, c.bodyHi],
            stroke: '#555',
            strokeWidth: 1.5,
            shadowColor: '#000',
            shadowBlur: 6,
            shadowOffset: { x: 2, y: 2 },
            shadowOpacity: 0.3,
        });
        this._staticGroup.add(bodyPath);

        const bodyOutline = new Konva.Line({
            points: [-30, 18, 18, 18, 30, 10, 30, -18, -30, -18],
            closed: true, stroke: '#666', strokeWidth: 1, listening: false,
        });
        this._staticGroup.add(bodyOutline);

        const tab = new Konva.Rect({
            x: -8, y: -26,
            width: 16, height: 8,
            fillLinearGradientStartPoint: { x: -8, y: -26 },
            fillLinearGradientEndPoint: { x: 8, y: -18 },
            fillLinearGradientColorStops: [0, '#3a4a5a', 0.5, '#1a252f', 1, '#3a4a5a'],
            stroke: '#666', strokeWidth: 1,
        });
        this._staticGroup.add(tab);

        const hole = new Konva.Circle({
            x: 0, y: -22, radius: 2.5, fill: '#555', stroke: '#777', strokeWidth: 0.5,
        });
        this._staticGroup.add(hole);

        const textStyle = { fontSize: 8, fill: c.printed, fontFamily: 'Arial', fontStyle: 'bold', listening: false };
        const typeText = new Konva.Text({ x: -26, y: -14, text: 'IGBT', ...textStyle });
        const ratingText = new Konva.Text({ x: -26, y: -4, text: '1200V/50A', ...textStyle });
        this._staticGroup.add(typeText);
        this._staticGroup.add(ratingText);

        const mark = new Konva.Rect({
            x: 18, y: -18, width: 12, height: 4,
            fill: c.accent, cornerRadius: 1, opacity: 0.85,
        });
        this._staticGroup.add(mark);

        const lbl = { fontSize: 11, fill: '#e74c3c', fontFamily: 'Arial', fontStyle: 'bold' };
        const cLbl = new Konva.Text({ x: -46, y: -28, text: 'C', ...lbl });
        const eLbl = new Konva.Text({ x: 42, y: -28, text: 'E', ...lbl });
        const gLbl = new Konva.Text({ x: -8, y: 34, text: 'G', ...lbl });
        this._staticGroup.add(cLbl);
        this._staticGroup.add(eLbl);
        this._staticGroup.add(gLbl);

        const ts = { fontSize: 8, fill: c.printed, fontFamily: 'Arial', listening: false };
        this._valueLabel = new Konva.Text({
            x: -26, y: 6, text: `${this.rOn}Ω`, ...ts, fontStyle: 'bold',
        });
        this._staticGroup.add(this._valueLabel);

        this._testLabels = [typeText, ratingText, cLbl, eLbl, gLbl, this._valueLabel];
        this._applyTestFlag();
    }

    _applyTestFlag() {
        const nodes = this._testLabels || [];
        nodes.forEach(n => { if (n) n.visible(!this.testFlag); });
    }

    setTestFlag(v) {
        v = !!v;
        if (this.testFlag === v) return;
        this.testFlag = v;
        this._applyTestFlag();
        this._refreshCache();
    }

    getConfigFields() {
        return [
            { label: '器件名称', key: 'id', type: 'text' },
            { label: '阈值电压 Vth (V)', key: 'vth', type: 'number' },
            { label: '导通压降 Vce(on) (V)', key: 'vOn', type: 'number' },
            { label: '导通电阻 Ron (Ω)', key: 'rOn', type: 'number' },
            { label: '截止电阻 Roff (Ω)', key: 'rOff', type: 'number' },
            { label: '体二极管压降 (V)', key: 'vBodyDiode', type: 'number' },
        ];
    }

    onConfigUpdate(cfg) {
        if (cfg.id !== undefined) this.id = cfg.id;
        if (cfg.vth !== undefined) this.vth = cfg.vth;
        if (cfg.vOn !== undefined) this.vOn = cfg.vOn;
        if (cfg.rOn !== undefined) this.rOn = cfg.rOn;
        if (cfg.rOff !== undefined) this.rOff = cfg.rOff;
        if (cfg.vBodyDiode !== undefined) this.vBodyDiode = Number(cfg.vBodyDiode);
        this.config = { ...this.config, ...cfg, vBodyDiode: this.vBodyDiode };
        if (this._valueLabel) this._valueLabel.text(`${this.rOn}Ω`);
        if (cfg.testFlag !== undefined) this.testFlag = !!cfg.testFlag;
        this._applyTestFlag();
        this._refreshCache();
    }

    destroy() {
        super.destroy?.();
    }
}
