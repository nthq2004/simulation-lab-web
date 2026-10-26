import { BaseComponent } from './BaseComponent.js';

export class Photodiode extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);
        this.direction = config.direction;
        this.type = 'photodiode';
        this.cache = 'fixed';
        this._initGroups();

        this.vForward = config.vForward !== undefined ? config.vForward : 0.7;
        this.photoCurrent = config.photoCurrent || 0;
        this.rOn = 0.5;
        this.rOff = 1e8;

        this.config = {id:this.id, vForward:this.vForward, photoCurrent:this.photoCurrent};

        this.initVisuals();
        this.initPorts();

        if (this.direction === 'reverse') this.group.rotate(180);
    }

    initPorts() {
        this.addPort(-40, 0, 'l', 'wire', 'p');
        this.addPort(40, 0, 'r', 'wire');
    }

    initVisuals() {
        const stroke = '#000000';
        this._staticGroup.add(new Konva.Line({ points: [-40, 0, -15, 0], stroke, strokeWidth: 2 }));
        this._staticGroup.add(new Konva.Line({ points: [15, 0, 40, 0], stroke, strokeWidth: 2 }));

        const triangle = new Konva.Line({
            points: [-15, -15, -15, 15, 15, 0],
            closed: true,
            fill: '#ffffff',
            stroke: stroke,
            strokeWidth: 2
        });

        const bar = new Konva.Line({
            points: [15, -15, 15, 15],
            stroke: stroke,
            strokeWidth: 3
        });

        const arrowIn = new Konva.Line({
            points: [28, -8, 35, -15, 42, -8],
            closed: false,
            stroke: stroke,
            strokeWidth: 2,
            tension: 0
        });

        const arrowHead = new Konva.Line({
            points: [35, -15, 38, -10, 35, -12, 32, -10],
            closed: true,
            fill: stroke,
            stroke: stroke,
            strokeWidth: 1
        });

        this._staticGroup.add(triangle, bar, arrowIn, arrowHead);

        this.paramLabel = new Konva.Text({
            x: -35, y: -40, width: 80,
            text: this.photoCurrent > 0 ? this.photoCurrent.toFixed(0) + 'μA' : '',
            fontSize: 12, fill: '#e74c3c', fontStyle: 'bold',
            align: 'center', listening: false,
        });
    }

    getConfigFields() {
        return [
            { label: '器件名称', key: 'id', type: 'text' },
            { label: '导通压降 (V)', key: 'vForward', type: 'number' },
            { label: '光生电流 (μA)', key: 'photoCurrent', type: 'number' }
        ];
    }
    onConfigUpdate(cfg) {
        if (cfg.id !== undefined) {
            this.id = cfg.id;
        }
        if (cfg.vForward !== undefined) {
            this.vForward = cfg.vForward;
        }
        if (cfg.photoCurrent !== undefined) {
            this.photoCurrent = cfg.photoCurrent;
            this._updateLabel();
        }
        this.config = cfg;
        this._refreshCache();
    }

    _updateLabel() {
    }

    destroy() {
        super.destroy?.();
    }
}
