import { BaseComponent } from './BaseComponent.js';

export class RealPhotodiode extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);
        this.type = 'photodiode';
        this.cache = 'fixed';
        this._initGroups();

        this.vForward = config.vForward !== undefined ? config.vForward : 0.7;
        this.photoCurrent = config.photoCurrent || 0;
        this.rOn = 0.5;
        this.rOff = 1e8;

        this.config = { id: this.id, vForward: this.vForward, photoCurrent: this.photoCurrent };

        this.initVisuals();
        this.initPorts();
    }

    initPorts() {
        this.addPort(-40, 0, 'l', 'wire', 'p');
        this.addPort(40, 0, 'r', 'wire');
    }

    initVisuals() {
        const colors = {
            body: '#1a237e',
            lens: '#263238',
            lensGlint: '#546e7a',
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
            x: -20, y: -7,
            width: 40, height: 14,
            fill: colors.lens,
            cornerRadius: 2,
            stroke: '#111',
            strokeWidth: 1
        });

        this.lensWindow = new Konva.Rect({
            x: -3, y: -5,
            width: 10, height: 10,
            fill: '#ffd54f',
            opacity: 0.15,
            cornerRadius: 1,
            listening: false
        });

        const flatMark = new Konva.Line({
            points: [-20, -7, -20, 7],
            stroke: '#ccc',
            strokeWidth: 2,
            listening: false
        });

        this.paramLabel = new Konva.Text({
            x: -25, y: -28, width: 50,
            text: this.photoCurrent > 0 ? this.photoCurrent.toFixed(0) + 'μA' : '',
            fontSize: 10,
            fill: '#e74c3c',
            fontStyle: 'bold',
            align: 'center',
            listening: false
        });

        this._staticGroup.add(leadL, leadR, this.body, this.lensWindow, flatMark, this.paramLabel);
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
        if (this.paramLabel) {
            this.paramLabel.text(this.photoCurrent > 0 ? this.photoCurrent.toFixed(0) + 'μA' : '');
            this.markDirty();
        }
    }

    destroy() {
        super.destroy?.();
    }
}
