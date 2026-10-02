import { BaseComponent } from './BaseComponent.js';

export class RealZener extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);
        this.type = 'zener';
        this.cache = 'fixed';
        this._initGroups();

        this.vForward = config.vForward !== undefined ? config.vForward : 0.7;
        this.vZener = config.vZener !== undefined ? config.vZener : 5.1;
        this.rOn = 0.5;
        this.rOff = 1e8;

        this.config = { id: this.id, vForward: this.vForward, vZener: this.vZener };

        this.initVisuals();
        this.initPorts();
    }

    initPorts() {
        this.addPort(-55, 0, 'l', 'wire', 'p');
        this.addPort(55, 0, 'r', 'wire');
    }

    initVisuals() {
        const colors = {
            body: '#bb7777',
            lead: '#aeb6bf',
            band: '#444',
            whiteRing: '#f5f5f5',
        };

        const leadL = new Konva.Line({
            points: [-55, 0, -35, 0],
            stroke: colors.lead, strokeWidth: 3, lineCap: 'round'
        });
        const leadR = new Konva.Line({
            points: [35, 0, 55, 0],
            stroke: colors.lead, strokeWidth: 3, lineCap: 'round'
        });

        this.body = new Konva.Rect({
            x: -35, y: -8,
            width: 70, height: 16,
            fill: colors.body,
            cornerRadius: 3,
            stroke: '#333',
            strokeWidth: 1
        });

        this.cathodeBand = new Konva.Rect({
            x: 29, y: -8,
            width: 6, height: 16,
            fill: colors.band,
            cornerRadius: [0, 3, 3, 0],
            opacity: 0.8
        });

        this.whiteRing = new Konva.Rect({
            x: 25, y: -8,
            width: 4, height: 16,
            fill: colors.whiteRing,
            opacity: 0.9
        });

        const cathodeMark = new Konva.Text({
            x: 28, y: -17,
            text: 'K',
            fontSize: 12,
            fontStyle: 'bold',
            fill: '#fdfafa',
            width: 20,
            align: 'center',
            listening: false
        });

        const modelText = new Konva.Text({
            x: -18, y: -6,
            text: '1N4742',
            fontSize: 11,
            fill: '#fff',
            listening: false
        });

        this.paramLabel = new Konva.Text({
            x: -35, y: -26, width: 70,
            text: this.vZener.toFixed(1) + 'V',
            fontSize: 14,
            fill: '#e74c3c',
            fontStyle: 'bold',
            align: 'center',
            listening: false
        });

        this._staticGroup.add(leadL, leadR, this.body, this.cathodeBand, this.whiteRing, cathodeMark, modelText, this.paramLabel);
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
        if (this.paramLabel) {
            this.paramLabel.text(this.vZener.toFixed(1) + 'V');
            this.markDirty();
        }
    }

    destroy() {
        super.destroy?.();
    }
}
