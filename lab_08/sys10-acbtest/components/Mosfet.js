import { BaseComponent } from './BaseComponent.js';

export class Mosfet extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);
        this.cache = 'fixed';
        this._initGroups();
        this.type = 'mosfet';

        this.vth = 3.0;
        this.rOn = 0.2;
        this.rOnDisp = 30;
        this.rOff = 1e6;
        this._mosfetStampMode = 'off';
        this._isOn = false;
        this._faultDSShort = false;
        this._faultDSOpen = false;

        this.config = { id: this.id, vth: this.vth, rOn: this.rOn, rOff: this.rOff };

        this.initPorts();
        this.initVisuals();
    }

    initPorts() {
        this.addPort(-40, 0, 'd', 'wire', 'p');
        this.addPort(50, 0, 's', 'wire');
        this.addPort(0, 30, 'g', 'wire', 'g');
    }

    initVisuals() {
        const s = '#000';
        this._staticGroup.add(new Konva.Line({ points: [-40, 0, -15, 0], stroke: s, strokeWidth: 2 }));
        this._staticGroup.add(new Konva.Line({ points: [15, 0, 50, 0], stroke: s, strokeWidth: 2 }));

        this._staticGroup.add(new Konva.Line({ points: [0, 15, 0, 30], stroke: s, strokeWidth: 2 }));

        const tri = new Konva.Line({
            points: [-15, -15, -15, 15, 15, 0],
            closed: true, fill: '#fff', stroke: s, strokeWidth: 2,
        });
        this._staticGroup.add(tri);

        const bar = new Konva.Line({
            points: [15, -15, 15, 15],
            stroke: s, strokeWidth: 3,
        });
        this._staticGroup.add(bar);

        const gap = new Konva.Line({
            points: [-15, -4, -15, 4],
            stroke: '#fff', strokeWidth: 3,
        });
        this._staticGroup.add(gap);

        const lbl = { fontSize: 12, fill: '#333', fontFamily: 'Arial', fontStyle: 'bold' };
        this._staticGroup.add(new Konva.Text({ x: -48, y: -20, text: 'D', ...lbl }));
        this._staticGroup.add(new Konva.Text({ x: 38, y: -20, text: 'S', ...lbl }));
        this._staticGroup.add(new Konva.Text({ x: -10, y: 34, text: 'G', ...lbl }));

        this._valueLabel = new Konva.Text({
            x: -22, y: 10, text: `${this.rOn}Ω`, fontSize: 9,
            fill: '#555', fontFamily: 'Arial', align: 'center', width: 44,
        });
        this._staticGroup.add(this._valueLabel);
    }

    getConfigFields() {
        return [
            { label: '器件名称', key: 'id', type: 'text' },
            { label: '阈值电压 Vth (V)', key: 'vth', type: 'number' },
            { label: '导通电阻 Rds(on) (Ω)', key: 'rOn', type: 'number' },
            { label: '截止电阻 Roff (Ω)', key: 'rOff', type: 'number' },
        ];
    }

    onConfigUpdate(cfg) {
        if (cfg.id !== undefined) this.id = cfg.id;
        if (cfg.vth !== undefined) this.vth = cfg.vth;
        if (cfg.rOn !== undefined) this.rOn = cfg.rOn;
        if (cfg.rOff !== undefined) this.rOff = cfg.rOff;
        this.config = cfg;
        if (this._valueLabel) this._valueLabel.text(`${this.rOn}Ω`);
        this._refreshCache();
    }

    destroy() {
        super.destroy?.();
    }
}
