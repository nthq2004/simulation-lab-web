import { BaseComponent } from './BaseComponent.js';

export class RealDIAC extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);
        this.type = 'diac';
        this.cache = 'fixed';
        this._initGroups();

        this.vBreakover = config.vBreakover || 30;
        this.rOn = 5;
        this.rOff = 1e8;

        this.config = { id: this.id, vBreakover: this.vBreakover };

        this.initVisuals();
        this.initPorts();
    }

    initPorts() {
        this.addPort(-40, 0, 'l', 'wire', 'p');
        this.addPort(40, 0, 'r', 'wire');
    }

    initVisuals() {
        const colors = {
            body: '#2c3e50',
            stripe1: '#e74c3c',
            stripe2: '#3498db',
            lead: '#aeb6bf',
        };

        const leadL = new Konva.Line({
            points: [-40, 0, -20, 0],
            stroke: colors.lead, strokeWidth: 3, lineCap: 'round'
        });
        const leadR = new Konva.Line({
            points: [20, 0, 40, 0],
            stroke: colors.lead, strokeWidth: 3, lineCap: 'round'
        });

        this.body = new Konva.Rect({
            x: -20, y: -6,
            width: 40, height: 12,
            fill: colors.body,
            cornerRadius: 2,
            stroke: '#222',
            strokeWidth: 1
        });

        this.stripe1 = new Konva.Rect({
            x: -20, y: -6,
            width: 8, height: 12,
            fill: colors.stripe1,
            cornerRadius: [2, 0, 0, 2],
            listening: false
        });

        this.stripe2 = new Konva.Rect({
            x: 12, y: -6,
            width: 8, height: 12,
            fill: colors.stripe2,
            cornerRadius: [0, 2, 2, 0],
            listening: false
        });

        const modelText = new Konva.Text({
            x: -10, y: -4,
            text: 'DB3',
            fontSize: 10,
            fill: '#fff',
            listening: false
        });

        this.paramLabel = new Konva.Text({
            x: -25, y: -25, width: 50,
            text: this.vBreakover.toFixed(0) + 'V',
            fontSize: 10,
            fill: '#e74c3c',
            fontStyle: 'bold',
            align: 'center',
            listening: false
        });

        this._staticGroup.add(leadL, leadR, this.body, this.stripe1, this.stripe2, modelText, this.paramLabel);
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
        if (this.paramLabel) {
            this.paramLabel.text(this.vBreakover.toFixed(0) + 'V');
            this.markDirty();
        }
    }

    destroy() {
        super.destroy?.();
    }
}
