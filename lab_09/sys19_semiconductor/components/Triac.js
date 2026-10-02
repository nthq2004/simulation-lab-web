import { BaseComponent } from './BaseComponent.js';

export class Triac extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);
        this.cache = 'fixed';
        this._initGroups();
        this.type = 'triac';

        this.vGt = 1.5;
        this.rG = 10;
        this.rGOff = 1e8;
        this.rOn = 0.1;
        this.rOff = 1e6;
        this.holdCurrent = 0.005;
        this._triggered = false;
        this._gateWasActive = false;
        this._stampMode = 'off';
        this._faultMTShort = false;
        this._faultGateOpen = false;

        this.config = { id: this.id, vGt: this.vGt };

        this.initPorts();
        this.initVisuals();
    }

    initPorts() {
        this.addPort(-60, 0, 'mt2', 'wire', 'p');
        this.addPort(70, 0, 'mt1', 'wire');
        this.addPort(50, 32, 'g', 'wire', 'g');
    }

    initVisuals() {
        const stroke = '#000000';

        this._staticGroup.add(new Konva.Line({ points: [-60, 0, -14, 0], stroke, strokeWidth: 2 }));
        this._staticGroup.add(new Konva.Line({ points: [16, 0, 70, 0], stroke, strokeWidth: 2 }));

        const triTop = new Konva.Line({
            points: [-13, -31, -13, 3, 16, -14],
            closed: true,
            fill: '#000000',
            stroke,
            strokeWidth: 2,
        });
        const lineTop = new Konva.Line({
            points: [-13, -35, -13, 35],
            closed: false,
            fill: '#000000',
            stroke,
            strokeWidth: 4,
        });
        const triBot = new Konva.Line({
            points: [16, -3, 16, 31, -13, 14],
            closed: true,
            fill: '#000000',
            stroke,
            strokeWidth: 2,
        });
        const lineBot = new Konva.Line({
            points: [16, -35, 16, 35],
            closed: false,
            fill: '#000000',
            stroke,
            strokeWidth: 4,
        });
        const gateLead = new Konva.Line({
            points: [12, 8, 50, 32],
            stroke,
            strokeWidth: 2,
        });

        this._staticGroup.add(triTop, lineTop, triBot,lineBot, gateLead);

        const lbl = { fontSize: 12, fill: '#333333', fontFamily: 'Arial', fontStyle: 'bold' };
        this._staticGroup.add(new Konva.Text({ x: -68, y: -28, text: 'MT2', ...lbl }));
        this._staticGroup.add(new Konva.Text({ x: 58, y: -28, text: 'MT1', ...lbl }));
        this._staticGroup.add(new Konva.Text({ x: 36, y: 40, text: 'G', ...lbl }));
    }

    getConfigFields() {
        return [
            { label: '器件名称', key: 'id', type: 'text' },
            { label: '门极触发电压 (V)', key: 'vGt', type: 'number' },
            { label: '导通电阻 (Ω)', key: 'rOn', type: 'number' },
            { label: '截止电阻 (Ω)', key: 'rOff', type: 'number' },
            { label: '维持电流 (A)', key: 'holdCurrent', type: 'number' },
        ];
    }

    onConfigUpdate(cfg) {
        if (cfg.id !== undefined) this.id = cfg.id;
        if (cfg.vGt !== undefined) this.vGt = cfg.vGt;
        if (cfg.rOn !== undefined) this.rOn = cfg.rOn;
        if (cfg.rOff !== undefined) this.rOff = cfg.rOff;
        if (cfg.holdCurrent !== undefined) this.holdCurrent = cfg.holdCurrent;
        this.config = cfg;
        this._refreshCache();
    }

    destroy() {
        super.destroy?.();
    }
}
