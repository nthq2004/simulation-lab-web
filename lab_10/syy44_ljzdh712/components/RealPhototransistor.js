import { BaseComponent } from './BaseComponent.js';

export class RealPhototransistor extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);
        this.cache = 'fixed';
        this._initGroups();
        this.type = 'phototransistor';

        this.beta = config.beta || 200;
        this.photoCurrent = config.photoCurrent || 0;
        this.vceSat = 0.3;
        this.rOn = 50;
        this.rOff = 1e8;

        this.config = { id: this.id, beta: this.beta, photoCurrent: this.photoCurrent };

        this.initVisuals();
        this.initPorts();
    }

    initPorts() {
        this.addPort(-20, -60, 'c', 'wire', 'c');
        this.addPort(-20, 60, 'e', 'wire', 'e');
        this.addPort(55, 0, 'b', 'wire', 'b');
    }

    initVisuals() {
        const pinColor = '#bcc6cf';

        const cLead = new Konva.Line({
            points: [-10, -18, -20, -60],
            stroke: pinColor, strokeWidth: 3, lineCap: 'round'
        });
        const eLead = new Konva.Line({
            points: [-10, 18, -20, 60],
            stroke: pinColor, strokeWidth: 3, lineCap: 'round'
        });
        const bLead = new Konva.Line({
            points: [20, 0, 55, 0],
            stroke: pinColor, strokeWidth: 3, lineCap: 'round'
        });

        const body = new Konva.Path({
            data: 'M-22,-22 L22,-22 Q28,-22 28,-16 L28,16 Q28,22 22,22 L-22,22 Q-28,22 -28,16 L-28,-16 Q-28,-22 -22,-22 Z',
            fillLinearGradientStartPoint: { x: -28, y: -22 },
            fillLinearGradientEndPoint: { x: 28, y: 22 },
            fillLinearGradientColorStops: [
                0, '#b3d9e8',
                0.3, '#d4ecf4',
                0.7, '#c5e3f0',
                1, '#a8cfe0'
            ],
            stroke: '#7fa8b8',
            strokeWidth: 1,
            shadowColor: '#000',
            shadowBlur: 8,
            shadowOffset: { x: 3, y: 3 },
            shadowOpacity: 0.2,
        });

        const flatSide = new Konva.Rect({
            x: -28, y: -22, width: 16, height: 44,
            fill: '#b8d8e8',
            stroke: 'transparent',
            strokeWidth: 0,
            opacity: 0.4
        });

        const die = new Konva.Rect({
            x: -6, y: -4, width: 12, height: 8,
            fill: '#2a2a2a',
            cornerRadius: 1,
            opacity: 0.7
        });

        const bondC = new Konva.Line({
            points: [-6, -4, -10, -18],
            stroke: '#d4a017', strokeWidth: 0.8
        });
        const bondE = new Konva.Line({
            points: [-6, 4, -10, 18],
            stroke: '#d4a017', strokeWidth: 0.8
        });

        const markBg = new Konva.Rect({
            x: -16, y: -10, width: 24, height: 14,
            fill: '#1a1a1a',
            cornerRadius: 1,
            opacity: 0.8
        });
        const modelText = new Konva.Text({
            x: -15, y: -9, width: 22,
            text: '3DU5',
            fontSize: 9, fontFamily: 'Arial',
            fill: '#c8c8c8', align: 'center'
        });

        const highlight = new Konva.Path({
            data: 'M-18,-20 L18,-20 Q24,-20 24,-16 L24,-10 L-24,-10 L-24,-16 Q-24,-20 -18,-20 Z',
            fill: 'rgba(255,255,255,0.15)',
            stroke: 'transparent',
        });

        const lblStyle = { fontSize: 11, fill: '#c0392b', fontFamily: 'Arial', fontStyle: 'bold' };
        const cLbl = new Konva.Text({ x: -36, y: -72, text: 'C', ...lblStyle });
        const eLbl = new Konva.Text({ x: -36, y: 56, text: 'E', ...lblStyle });
        const bLbl = new Konva.Text({ x: 42, y: -12, text: 'B', ...lblStyle });

        this._staticGroup.add(cLead, eLead, bLead, body, flatSide, die, bondC, bondE, markBg, modelText, highlight, cLbl, eLbl, bLbl);
    }

    getConfigFields() {
        return [
            { label: '器件名称', key: 'id', type: 'text' },
            { label: '放大倍数 β', key: 'beta', type: 'number' },
            { label: '光生电流 (μA)', key: 'photoCurrent', type: 'number' },
        ];
    }

    onConfigUpdate(cfg) {
        if (cfg.id !== undefined) this.id = cfg.id;
        if (cfg.beta !== undefined) this.beta = cfg.beta;
        if (cfg.photoCurrent !== undefined) this.photoCurrent = cfg.photoCurrent;
        this.config = cfg;
        this._refreshCache();
    }

    destroy() {
        super.destroy?.();
    }
}
