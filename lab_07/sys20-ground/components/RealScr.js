import { BaseComponent } from './BaseComponent.js';

export class RealScr extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);
        this.cache = 'fixed';
        this._initGroups();
        this.type = 'scr';

        this.gkForwardV = 0.68;
        this.gkR = 0.5;
        this.gkROff = 1e8;
        this.vOn = 1.0;
        this.rOn = 0.1;
        this.rOnDisp = 100;
        this.rOff = 1e6;
        this.holdCurrent = 0.0005;
        this._triggered = false;
        this._scrStampMode = 'off';
        this._gateWasActive = false;
        this._faultAKShort = false;
        this._faultGateOpen = false;
        // 测试标志：为真时隐藏 A/K/G 引脚标签，供考核/测试使用
        this.testFlag = config.testFlag || false;

        this.config = { id: this.id, gkForwardV: this.gkForwardV, testFlag: this.testFlag };

        this.initPorts();
        this.initVisuals();
    }

    initPorts() {
        this.addPort(-50, 0, 'a', 'wire', 'p');
        this.addPort(50, 0, 'k', 'wire');
        this.addPort(35, 22, 'g', 'wire', 'g');
    }

    initVisuals() {
        const c = {
            pin: '#bcc6cf',
            pinDark: '#8a9299',
            bodyHi: '#e8ecf0',
            bodyLo: '#9aa2aa',
            accent: '#c0a060',
            printed: '#2c3e50',
        };

        const pins = [
            new Konva.Line({ points: [-30, 0, -50, 0], stroke: c.pin, strokeWidth: 4.5, lineCap: 'round' }),
            new Konva.Line({ points: [30, 0, 50, 0], stroke: c.pin, strokeWidth: 4.5, lineCap: 'round' }),
            new Konva.Line({ points: [20, 18, 35, 22], stroke: c.pin, strokeWidth: 3, lineCap: 'round' }),
        ];
        pins.forEach(p => this._staticGroup.add(p));

        const bodyPath = new Konva.Path({
            data: 'M-30,-18 L18,-18 L30,-10 L30,18 L-30,18 Z',
            fillLinearGradientStartPoint: { x: -30, y: -18 },
            fillLinearGradientEndPoint: { x: 30, y: 18 },
            fillLinearGradientColorStops: [0, c.bodyHi, 0.5, c.bodyLo, 1, c.bodyHi],
            stroke: '#666',
            strokeWidth: 1.5,
            shadowColor: '#000',
            shadowBlur: 6,
            shadowOffset: { x: 2, y: 2 },
            shadowOpacity: 0.2,
        });
        this._staticGroup.add(bodyPath);

        const bodyOutline = new Konva.Line({
            points: [-30, 18, 18, 18, 30, 10, 30, -18, -30, -18],
            closed: true,
            stroke: '#777',
            strokeWidth: 1,
            listening: false,
        });
        this._staticGroup.add(bodyOutline);

        const tab = new Konva.Rect({
            x: -8, y: -26,
            width: 16, height: 8,
            fillLinearGradientStartPoint: { x: -8, y: -26 },
            fillLinearGradientEndPoint: { x: 8, y: -18 },
            fillLinearGradientColorStops: [0, c.bodyHi, 0.5, c.bodyLo, 1, c.bodyHi],
            stroke: '#777',
            strokeWidth: 1,
        });
        this._staticGroup.add(tab);

        const hole = new Konva.Circle({
            x: 0, y: -22,
            radius: 2.5,
            fill: '#666',
            stroke: '#888',
            strokeWidth: 0.5,
        });
        this._staticGroup.add(hole);

        const textStyle = { fontSize: 8, fill: c.printed, fontFamily: 'Arial', fontStyle: 'bold', listening: false };
        this._staticGroup.add(new Konva.Text({ x: -26, y: -14, text: 'BT151', ...textStyle }));
        this._staticGroup.add(new Konva.Text({ x: -26, y: -4, text: '600R', ...textStyle }));

        const mark = new Konva.Rect({
            x: 18, y: -18,
            width: 12, height: 4,
            fill: c.accent,
            cornerRadius: 1,
            opacity: 0.85,
        });
        this._staticGroup.add(mark);

        const lbl = { fontSize: 11, fill: '#c0392b', fontFamily: 'Arial', fontStyle: 'bold' };
        const aLbl = new Konva.Text({ x: -46, y: -28, text: 'A', ...lbl });
        const kLbl = new Konva.Text({ x: 42, y: -28, text: 'K', ...lbl });
        const gLbl = new Konva.Text({ x: 24, y: 28, text: 'G', ...lbl });
        this._staticGroup.add(aLbl, kLbl, gLbl);

        this._testLabels = [aLbl, kLbl, gLbl];
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
            { label: '门极导通压降 (V)', key: 'gkForwardV', type: 'number', get: c => c.gkForwardV },
            { label: '导通管压降 (V)', key: 'vOn', type: 'number', get: c => c.vOn },
            { label: '导通电阻 (Ω)', key: 'rOn', type: 'number', get: c => c.rOn },
            { label: '截止电阻 (Ω)', key: 'rOff', type: 'number', get: c => c.rOff },
            { label: '维持电流 (A)', key: 'holdCurrent', type: 'number', get: c => c.holdCurrent },
        ];
    }

    onConfigUpdate(cfg) {
        if (cfg.id !== undefined) this.id = cfg.id;
        if (cfg.gkForwardV !== undefined) this.gkForwardV = cfg.gkForwardV;
        if (cfg.vOn !== undefined) this.vOn = cfg.vOn;
        if (cfg.rOn !== undefined) this.rOn = cfg.rOn;
        if (cfg.rOff !== undefined) this.rOff = cfg.rOff;
        if (cfg.holdCurrent !== undefined) this.holdCurrent = cfg.holdCurrent;
        if (cfg.testFlag !== undefined) this.testFlag = !!cfg.testFlag;
        this.config = cfg;
        this._applyTestFlag();
        this._refreshCache();
    }

    destroy() {
        super.destroy?.();
    }
}
