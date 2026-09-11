import { BaseComponent } from './BaseComponent.js';

export class SCR extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);
        this.cache = 'fixed';
        this._initGroups();
        this.type = 'scr';

        this.gkForwardV = 0.68;
        this.gkR = 0.5;
        this.gkROff = 1e8;
        this.vOn = 1.0;
        this.rOn = 0.1;
        this.rOnDisp = 100;
        this.rOff = 1e6;
        this.holdCurrent = 0.0005;
        this._triggered = false;
        this._scrStampMode = 'off';
        this._gateWasActive = false;
        this._faultAKShort = false;
        this._faultGateOpen = false;

        this.config = { id: this.id, gkForwardV: this.gkForwardV };

        this.initPorts();
        this.initVisuals();
    }

    initPorts() {
        this.addPort(-40, 0, 'a', 'wire', 'p');
        this.addPort(50, 0, 'k', 'wire');
        this.addPort(35, 22, 'g', 'wire', 'g');
    }

    initVisuals() {
        const stroke = '#000000';

        this._staticGroup.add(new Konva.Line({ points: [-40, 0, -15, 0], stroke, strokeWidth: 2 }));
        this._staticGroup.add(new Konva.Line({ points: [15, 0, 50, 0], stroke, strokeWidth: 2 }));

        const triangle = new Konva.Line({
            points: [-15, -15, -15, 15, 15, 0],
            closed: true,
            fill: '#ffffff',
            stroke,
            strokeWidth: 2,
        });

        const bar = new Konva.Line({
            points: [15, -15, 15, 15],
            stroke,
            strokeWidth: 3,
        });

        const gateLead = new Konva.Line({
            points: [15, 0, 35, 22],
            stroke,
            strokeWidth: 2,
        });

        this._staticGroup.add(triangle, bar, gateLead);

        const lbl = { fontSize: 12, fill: '#333333', fontFamily: 'Arial', fontStyle: 'bold' };
        this._staticGroup.add(new Konva.Text({ x: -48, y: -20, text: 'A', ...lbl }));
        this._staticGroup.add(new Konva.Text({ x: 38, y: -20, text: 'K', ...lbl }));
        this._staticGroup.add(new Konva.Text({ x: 22, y: 36, text: 'G', ...lbl }));
    }

    getConfigFields() {
        return [
            { label: '器件名称', key: 'id', type: 'text' },
            { label: '门极导通压降 (V)', key: 'gkForwardV', type: 'number' },
            { label: '导通管压降 (V)', key: 'vOn', type: 'number' },
            { label: '导通电阻 (Ω)', key: 'rOn', type: 'number' },
            { label: '截止电阻 (Ω)', key: 'rOff', type: 'number' },
            { label: '维持电流 (A)', key: 'holdCurrent', type: 'number' },
        ];
    }

    onConfigUpdate(cfg) {
        if (cfg.id !== undefined) this.id = cfg.id;
        if (cfg.gkForwardV !== undefined) this.gkForwardV = cfg.gkForwardV;
        if (cfg.vOn !== undefined) this.vOn = cfg.vOn;
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
