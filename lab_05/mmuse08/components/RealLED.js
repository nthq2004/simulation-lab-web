import { BaseComponent } from './BaseComponent.js';

export class RealLED extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);
        this.type = 'led';
        this.cache = 'fixed';
        this._initGroups();

        this.vForward = config.vForward || 2.0;
        this.rOn = 0.5;
        this.rOff = 1e8;

        this.config = { id: this.id, vForward: this.vForward };

        this.initVisuals();
        this.initPorts();
    }

    initPorts() {
        this.addPort(-40, 0, 'l', 'wire', 'p');
        this.addPort(40, 0, 'r', 'wire');
    }

    initVisuals() {
        const colors = {
            lens: '#e74c3c',
            lensHighlight: '#ff9999',
            body: '#1a1a1a',
            bodyRing: '#888',
            lead: '#aeb6bf',
            flatSide: '#ddd',
        };

        const leadL = new Konva.Line({
            points: [-40, 0, -14, 0],
            stroke: colors.lead, strokeWidth: 3, lineCap: 'round'
        });
        const leadR = new Konva.Line({
            points: [14, 0, 40, 0],
            stroke: colors.lead, strokeWidth: 3, lineCap: 'round'
        });

        this.ledLens = new Konva.Circle({
            x: 0, y: 0,
            radius: 14,
            fill: colors.lens,
            stroke: '#333',
            strokeWidth: 1.5
        });

        this.lensHighlight = new Konva.Ellipse({
            x: -4, y: -5,
            radiusX: 6, radiusY: 4,
            fill: colors.lensHighlight,
            opacity: 0.5,
            listening: false
        });

        this.bodyRing = new Konva.Rect({
            x: -14, y: -6,
            width: 28, height: 12,
            fill: colors.bodyRing,
            cornerRadius: 2,
            stroke: '#555',
            strokeWidth: 0.5,
            listening: false
        });

        this.flatSide = new Konva.Line({
            points: [-14, -6, -14, 6],
            stroke: colors.flatSide,
            strokeWidth: 2,
            listening: false
        });

        this.paramLabel = new Konva.Text({
            x: -30, y: -35, width: 60,
            text: this.vForward.toFixed(1) + 'V',
            fontSize: 10,
            fill: '#e74c3c',
            fontStyle: 'bold',
            align: 'center',
            listening: false
        });

        this._staticGroup.add(leadL, leadR, this.ledLens, this.lensHighlight, this.bodyRing, this.flatSide, this.paramLabel);
    }

    getConfigFields() {
        return [
            { label: '器件名称', key: 'id', type: 'text' },
            { label: '导通压降 (V)', key: 'vForward', type: 'number' }
        ];
    }

    onConfigUpdate(cfg) {
        if (cfg.id !== undefined) {
            this.id = cfg.id;
        }
        if (cfg.vForward !== undefined) {
            this.vForward = cfg.vForward;
            this._updateLabel();
        }
        this.config = cfg;
        this._refreshCache();
    }

    _updateLabel() {
        if (this.paramLabel) {
            this.paramLabel.text(this.vForward.toFixed(1) + 'V');
            this.markDirty();
        }
    }

    destroy() {
        super.destroy?.();
    }
}
