import { BaseComponent } from './BaseComponent.js';

export class DIAC extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);
        this.direction = config.direction;
        this.type = 'diac';
        this.cache = 'fixed';
        this._initGroups();

        this.vBreakover = config.vBreakover || 30;
        this.vHold = config.vHold || 10;
        this.rOn = 5;
        this.rOff = 1e12;
        this._diacActive = false;

        this.config = {id:this.id, vBreakover:this.vBreakover, vHold:this.vHold};

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
        this._staticGroup.add(new Konva.Line({ points: [-40, 0, -14, 0], stroke, strokeWidth: 2 }));
        this._staticGroup.add(new Konva.Line({ points: [12, 0, 40, 0], stroke, strokeWidth: 2 }));

        const triLeft = new Konva.Line({
            points: [-14, -22, -14, 2, 11, -10],
            closed: true,
            fill: '#000000',
            stroke: stroke,
            strokeWidth: 2
        });
        const lineLeft = new Konva.Line({
            points: [-14, -24, -14, 24],
            closed: false,
            fill: '#000000',
            stroke: stroke,
            strokeWidth: 4
        });
        const triRight = new Konva.Line({
            points: [12, -4, 12, 20, -11, 8],
            closed: true,
            fill: '#000000',
            stroke: stroke,
            strokeWidth: 2
        });
        const lineright = new Konva.Line({
            points: [12, -24, 12, 24],
            closed: false,
            fill: '#000000',
            stroke: stroke,
            strokeWidth: 4
        });
        this._staticGroup.add(triLeft,lineLeft, triRight,lineright);

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
            { label: '转折电压 (V)', key: 'vBreakover', type: 'number' },
            { label: '导通维持电压 (V)', key: 'vHold', type: 'number' },
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
        if (cfg.vHold !== undefined) this.vHold = cfg.vHold;
        this.config = cfg;
        this._refreshCache();
    }

    _updateLabel() {
    }

    destroy() {
        super.destroy?.();
    }
}
