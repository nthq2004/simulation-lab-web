import { BaseComponent } from './BaseComponent.js';

export class IC7805 extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);
        this.type = 'regulator_7805';
        this.cache = 'fixed';
        this._initGroups();

        this.physCurrent = 0;
        this._regMode = 'normal';
        this._lastVi = 0;
        this._lastVt = 0;

        this._drawVisuals();
        this._addPorts();
    }

    _drawVisuals() {
        const w = 80, h = 50;
        const rect = new Konva.Rect({
            x: -w / 2, y: -h / 2,
            width: w, height: h,
            fill: '#d9d9d9',
            stroke: '#000',
            strokeWidth: 2,
            cornerRadius: 4,
        });
        const label = new Konva.Text({
            x: -w / 2, y: -h / 2,
            width: w, height: h,
            text: '7805',
            fontSize: 28,
            fontStyle: 'bold',
            fill: '#1a1a2e',
            align: 'center',
            verticalAlign: 'middle',
            listening: false,
        });
        this._staticGroup.add(rect, label);
    }

    _addPorts() {
        this.addPort(-45, 0, 'in', 'wire');
        this.addPort(45, 0, 'out', 'wire', 'p');
        this.addPort(0, 30, 'gnd', 'wire');
    }

    getConfigFields() {
        return [
            { label: '器件名称', key: 'id', type: 'text' },
        ];
    }
    onConfigUpdate(cfg) {
        if (cfg.id !== undefined) this.id = cfg.id;
        this.config = cfg;
        this._refreshCache();
    }

    tick(dt) {
    }

    destroy() {
        super.destroy?.();
    }
}
