import { BaseComponent } from './BaseComponent.js';

export class RealTriac extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);
        this.cache = 'fixed';
        this._initGroups();
        this.type = 'triac';

        this.vGt = 1.5;
        this.rG = 10;
        this.rGOff = 1e8;
        this.rOn = 0.1;
        this.rOff = 1e6;
        this.holdCurrent = 0.005;
        this._triggered = false;
        this._gateWasActive = false;
        this._stampMode = 'off';
        this._faultMTShort = false;
        this._faultGateOpen = false;

        this.config = { id: this.id, vGt: this.vGt };

        this.initPorts();
        this.initVisuals();
    }

    initPorts() {
        this.addPort(-70, 0, 'mt2', 'wire', 'p');
        this.addPort(70, 0, 'mt1', 'wire');
        this.addPort(50, 32, 'g', 'wire', 'g');
    }

    initVisuals() {
        const c = {
            pin: '#bcc6cf',
            pinDark: '#8a9299',
            bodyHi: '#1a1a2e',
            bodyLo: '#16213e',
            accent: '#c0a060',
            printed: '#e8d5b0',
        };

        const pins = [
            new Konva.Line({ points: [-40, 0, -70, 0], stroke: c.pin, strokeWidth: 4.5, lineCap: 'round' }),
            new Konva.Line({ points: [40, 0, 70, 0], stroke: c.pin, strokeWidth: 4.5, lineCap: 'round' }),
            new Konva.Line({ points: [28, 22, 56, 32], stroke: c.pin, strokeWidth: 3, lineCap: 'round' }),
        ];
        pins.forEach(p => this._staticGroup.add(p));

        const bodyPath = new Konva.Path({
            data: 'M-40,-24 L24,-24 L40,-13 L40,24 L-40,24 Z',
            fillLinearGradientStartPoint: { x: -40, y: -24 },
            fillLinearGradientEndPoint: { x: 40, y: 24 },
            fillLinearGradientColorStops: [0, c.bodyHi, 0.5, c.bodyLo, 1, c.bodyHi],
            stroke: '#444',
            strokeWidth: 1.5,
            shadowColor: '#000',
            shadowBlur: 6,
            shadowOffset: { x: 2, y: 2 },
            shadowOpacity: 0.2,
        });
        this._staticGroup.add(bodyPath);

        const bodyOutline = new Konva.Line({
            points: [-40, 24, 24, 24, 40, 13, 40, -24, -40, -24],
            closed: true,
            stroke: '#555',
            strokeWidth: 1,
            listening: false,
        });
        this._staticGroup.add(bodyOutline);

        const tab = new Konva.Rect({
            x: -10, y: -34,
            width: 20, height: 10,
            fillLinearGradientStartPoint: { x: -10, y: -34 },
            fillLinearGradientEndPoint: { x: 10, y: -24 },
            fillLinearGradientColorStops: [0, c.bodyHi, 0.5, c.bodyLo, 1, c.bodyHi],
            stroke: '#555',
            strokeWidth: 1,
        });
        this._staticGroup.add(tab);

        const hole = new Konva.Circle({
            x: 0, y: -29,
            radius: 3,
            fill: '#666',
            stroke: '#888',
            strokeWidth: 0.5,
        });
        this._staticGroup.add(hole);

        const textStyle = { fontSize: 9, fill: c.printed, fontFamily: 'Arial', fontStyle: 'bold', listening: false };
        this._staticGroup.add(new Konva.Text({ x: -34, y: -18, text: 'BT136', ...textStyle }));
        this._staticGroup.add(new Konva.Text({ x: -34, y: -6, text: '600E', ...textStyle }));

        const mark = new Konva.Rect({
            x: 24, y: -24,
            width: 16, height: 5,
            fill: c.accent,
            cornerRadius: 1,
            opacity: 0.85,
        });
        this._staticGroup.add(mark);

        const lbl = { fontSize: 11, fill: '#e67e22', fontFamily: 'Arial', fontStyle: 'bold' };
        this._staticGroup.add(new Konva.Text({ x: -66, y: -36, text: 'MT2', ...lbl }));
        this._staticGroup.add(new Konva.Text({ x: 58, y: -36, text: 'MT1', ...lbl }));
        this._staticGroup.add(new Konva.Text({ x: 36, y: 38, text: 'G', ...lbl }));
    }

    getConfigFields() {
        return [
            { label: '器件名称', key: 'id', type: 'text' },
            { label: '门极触发电压 (V)', key: 'vGt', type: 'number' },
            { label: '导通电阻 (Ω)', key: 'rOn', type: 'number' },
            { label: '截止电阻 (Ω)', key: 'rOff', type: 'number' },
            { label: '维持电流 (A)', key: 'holdCurrent', type: 'number' },
        ];
    }

    onConfigUpdate(cfg) {
        if (cfg.id !== undefined) this.id = cfg.id;
        if (cfg.vGt !== undefined) this.vGt = cfg.vGt;
        if (cfg.rOn !== undefined) this.rOn = cfg.rOn;
        if (cfg.rOff !== undefined) this.rOff = cfg.rOff;
        if (cfg.holdCurrent !== undefined) this.holdCurrent = cfg.holdCurrent;
        this.config = cfg;
        this._refreshCache();
    }

    destroy() {
        super.destroy?.();
    }
}
