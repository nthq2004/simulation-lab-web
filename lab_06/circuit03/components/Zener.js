import { BaseComponent } from './BaseComponent.js';

export class Zener extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);
        this.direction = config.direction;
        this.type = 'zener';
        this.cache = 'fixed';
        this._initGroups();

        this.vForward = config.vForward !== undefined ? config.vForward : 0.7;
        this.vZener = config.vZener !== undefined ? config.vZener : 5.1;
        this.rOn = 0.5;
        this.rOff = 1e8;

        this.config = {id:this.id, vForward:this.vForward, vZener:this.vZener};

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

        const triangle = new Konva.Line({
            points: [-15, -13, -15, 13, 12, 0],
            closed: true,
            fill: '#ffffff',
            stroke: stroke,
            strokeWidth: 2
        });

        const bar = new Konva.Line({
            points: [14, -19, 14, 19],
            stroke: stroke,
            strokeWidth: 3
        });

        const topWing = new Konva.Line({
            points: [14, -18, 26, -18],
            stroke: stroke,
            strokeWidth: 3
        });

        const bottomWing = new Konva.Line({
            points: [2, 18, 14, 18],
            stroke: stroke,
            strokeWidth: 3
        });

        const rightLead = new Konva.Line({
            points: [17, 0, 40, 0],
            stroke: stroke,
            strokeWidth: 2
        });

        this._staticGroup.add(triangle,  bar, topWing, bottomWing, rightLead);

        this.paramLabel = new Konva.Text({
            x: -35, y: -40, width: 80,
            text: this.vZener.toFixed(1) + 'V',
            fontSize: 12, fill: '#e74c3c', fontStyle: 'bold',
            align: 'center', listening: false,
        });
    }

    getConfigFields() {
        return [
            { label: '器件名称', key: 'id', type: 'text' },
            { label: '导通压降 (V)', key: 'vForward', type: 'number' },
            { label: '稳压值 (V)', key: 'vZener', type: 'number' }
        ];
    }
    onConfigUpdate(cfg) {
        if (cfg.id !== undefined) {
            this.id = cfg.id;
        }
        if (cfg.vForward !== undefined) {
            this.vForward = cfg.vForward;
        }
        if (cfg.vZener !== undefined) {
            this.vZener = cfg.vZener;
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
