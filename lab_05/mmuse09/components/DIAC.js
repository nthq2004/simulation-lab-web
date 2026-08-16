import { BaseComponent } from './BaseComponent.js';

export class DIAC extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);
        this.direction = config.direction;
        this.type = 'diac';
        this.cache = 'fixed';
        this._initGroups();

        this.vBreakover = config.vBreakover || 30;
        this.rOn = 0.5;
        this.rOff = 1e8;

        this.config = {id:this.id, vBreakover:this.vBreakover};

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

        const triLeft = new Konva.Line({
            points: [-10, -15, -10, 15, 5, 0],
            closed: true,
            fill: '#ffffff',
            stroke: stroke,
            strokeWidth: 2
        });

        const triRight = new Konva.Line({
            points: [5, -15, 5, 15, -10, 0],
            closed: true,
            fill: '#ffffff',
            stroke: stroke,
            strokeWidth: 2
        });

        this._staticGroup.add(triLeft, triRight);

        this.paramLabel = new Konva.Text({
            x: -35, y: -40, width: 80,
            text: this.vBreakover.toFixed(0) + 'V',
            fontSize: 12, fill: '#e74c3c', fontStyle: 'bold',
            align: 'center', listening: false,
        });
    }

    getConfigFields() {
        return [
            { label: '器件名称', key: 'id', type: 'text' },
            { label: '转折电压 (V)', key: 'vBreakover', type: 'number' }
        ];
    }
    onConfigUpdate(cfg) {
        if (cfg.id !== undefined) {
            this.id = cfg.id;
        }
        if (cfg.vBreakover !== undefined) {
            this.vBreakover = cfg.vBreakover;
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
