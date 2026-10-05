import { BaseComponent } from './BaseComponent.js';

export class Phototransistor extends BaseComponent {
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
        this.addPort(-30, -40, 'c', 'wire', 'c');
        this.addPort(-30, 40, 'e', 'wire', 'e');
        this.addPort(30, 0, 'b', 'wire', 'b');
    }

    initVisuals() {
        const s = '#000000';

        const circle = new Konva.Circle({
            x: 0, y: 0, radius: 28,
            stroke: s, strokeWidth: 2, fill: '#ffffff'
        });

        const baseBar = new Konva.Line({
            points: [8, -14, 8, 14],
            stroke: s, strokeWidth: 3
        });

        const cLine = new Konva.Line({
            points: [8, -8, -18, -25, -30, -40],
            stroke: s, strokeWidth: 2
        });
        const eLine = new Konva.Line({
            points: [8, 8, -18, 25, -30, 40],
            stroke: s, strokeWidth: 2
        });
        const bLine = new Konva.Line({
            points: [8, 0, 30, 0],
            stroke: s, strokeWidth: 2
        });

        const arrow = new Konva.Arrow({
            points: [-2, 16, -14, 22],
            pointerLength: 6,
            pointerWidth: 5,
            fill: s,
            stroke: s,
            strokeWidth: 1
        });

        const lightArrow1 = new Konva.Arrow({
            points: [24, -18, 16, -10],
            pointerLength: 5,
            pointerWidth: 4,
            fill: '#e67e22',
            stroke: '#e67e22',
            strokeWidth: 1.5
        });
        const lightArrow2 = new Konva.Arrow({
            points: [26, -12, 16, -6],
            pointerLength: 5,
            pointerWidth: 4,
            fill: '#e67e22',
            stroke: '#e67e22',
            strokeWidth: 1.5
        });

        this._staticGroup.add(circle, baseBar, cLine, eLine, bLine, arrow, lightArrow1, lightArrow2);

        const lbl = { fontSize: 11, fill: '#c0392b', fontFamily: 'Arial', fontStyle: 'bold' };
        this._staticGroup.add(new Konva.Text({ x: -44, y: -56, text: 'C', ...lbl }));
        this._staticGroup.add(new Konva.Text({ x: -44, y: 36, text: 'E', ...lbl }));
        this._staticGroup.add(new Konva.Text({ x: 20, y: -14, text: 'B', ...lbl }));
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
