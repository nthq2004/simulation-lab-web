import { BaseComponent } from './BaseComponent.js';

export class RealUJT extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);
        this.cache = 'fixed';
        this._initGroups();
        this.type = 'ujt';

        this.rBB = 5000;
        this.eta = 0.63;
        this.vD = 0.6;
        this.rOn = 15;
        this.rOff = 1e8;
        this.vOn = 1.5;
        this.holdCurrent = 0.005;
        this._triggered = false;

        this.config = { id: this.id, eta: this.eta, rBB: this.rBB };

        this.initPorts();
        this.initVisuals();
    }

    initPorts() {
        this.addPort(-50, 0, 'b1', 'wire');
        this.addPort(50, 0, 'b2', 'wire', 'p');
        this.addPort(0, 38, 'e', 'wire');
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
            new Konva.Line({ points: [-28, 0, -50, 0], stroke: c.pin, strokeWidth: 4.5, lineCap: 'round' }),
            new Konva.Line({ points: [28, 0, 50, 0], stroke: c.pin, strokeWidth: 4.5, lineCap: 'round' }),
            new Konva.Line({ points: [0, 20, 0, 38], stroke: c.pin, strokeWidth: 3.5, lineCap: 'round' }),
        ];
        pins.forEach(p => this._staticGroup.add(p));

        const bodyPath = new Konva.Path({
            data: 'M-28,-22 L28,-22 Q32,-22 32,-18 L32,20 L-32,20 L-32,-18 Q-32,-22 -28,-22 Z',
            fillLinearGradientStartPoint: { x: -28, y: -22 },
            fillLinearGradientEndPoint: { x: 28, y: 20 },
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
            points: [-32, 20, 32, 20, 32, -18, 28, -22, -28, -22, -32, -18],
            closed: true,
            stroke: '#777',
            strokeWidth: 1,
            listening: false,
        });
        this._staticGroup.add(bodyOutline);

        const tab = new Konva.Rect({
            x: -8, y: -30,
            width: 16, height: 8,
            fillLinearGradientStartPoint: { x: -8, y: -30 },
            fillLinearGradientEndPoint: { x: 8, y: -22 },
            fillLinearGradientColorStops: [0, c.bodyHi, 0.5, c.bodyLo, 1, c.bodyHi],
            stroke: '#777',
            strokeWidth: 1,
        });
        this._staticGroup.add(tab);

        const hole = new Konva.Circle({
            x: 0, y: -26,
            radius: 2.5,
            fill: '#666',
            stroke: '#888',
            strokeWidth: 0.5,
        });
        this._staticGroup.add(hole);

        const textStyle = { fontSize: 8, fill: c.printed, fontFamily: 'Arial', fontStyle: 'bold', listening: false };
        this._staticGroup.add(new Konva.Text({ x: -24, y: -18, text: '2N2646', ...textStyle }));
        this._staticGroup.add(new Konva.Text({ x: -24, y: -8, text: 'UJT', ...textStyle }));

        const mark = new Konva.Rect({
            x: 22, y: -22,
            width: 10, height: 4,
            fill: c.accent,
            cornerRadius: 1,
            opacity: 0.85,
        });
        this._staticGroup.add(mark);

        const lbl = { fontSize: 11, fill: '#c0392b', fontFamily: 'Arial', fontStyle: 'bold' };
        this._staticGroup.add(new Konva.Text({ x: -46, y: -30, text: 'B1', ...lbl }));
        this._staticGroup.add(new Konva.Text({ x: 42, y: -30, text: 'B2', ...lbl }));
        this._staticGroup.add(new Konva.Text({ x: -10, y: 28, text: 'E', ...lbl }));
    }

    getConfigFields() {
        return [
            { label: '器件名称', key: 'id', type: 'text' },
            { label: '分压比 η', key: 'eta', type: 'number' },
            { label: '基极电阻 RBB (Ω)', key: 'rBB', type: 'number' },
            { label: '发射极导通电阻 (Ω)', key: 'rOn', type: 'number' },
            { label: '发射极关断电阻 (Ω)', key: 'rOff', type: 'number' },
            { label: '发射极导通压降 (V)', key: 'vOn', type: 'number' },
            { label: '维持电流 (A)', key: 'holdCurrent', type: 'number' },
        ];
    }

    onConfigUpdate(cfg) {
        if (cfg.id !== undefined) this.id = cfg.id;
        if (cfg.eta !== undefined) this.eta = cfg.eta;
        if (cfg.rBB !== undefined) this.rBB = cfg.rBB;
        if (cfg.rOn !== undefined) this.rOn = cfg.rOn;
        if (cfg.rOff !== undefined) this.rOff = cfg.rOff;
        if (cfg.vOn !== undefined) this.vOn = cfg.vOn;
        if (cfg.holdCurrent !== undefined) this.holdCurrent = cfg.holdCurrent;
        this.config = cfg;
        this._refreshCache();
    }

    destroy() {
        super.destroy?.();
    }
}
