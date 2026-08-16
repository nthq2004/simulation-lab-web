import { BaseComponent } from './BaseComponent.js';

export class UJT extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);
        this.cache = 'fixed';
        this._initGroups();
        this.type = 'ujt';

        this.rBB = 5000;
        this.eta = 0.63;
        this.vD = 0.6;
        this.rOn = 15;
        this.rOff = 1e8;
        this.vOn = 1.5;
        this.holdCurrent = 0.005;
        this._triggered = false;

        this.config = { id: this.id, eta: this.eta, rBB: this.rBB };

        this.initPorts();
        this.initVisuals();
    }

    initPorts() {
        this.addPort(-40, 0, 'b1', 'wire');
        this.addPort(40, 0, 'b2', 'wire', 'p');
        this.addPort(0, 35, 'e', 'wire');
    }

    initVisuals() {
        const s = '#000000';

        this._staticGroup.add(new Konva.Line({ points: [-40, 0, -25, 0], stroke: s, strokeWidth: 2 }));
        this._staticGroup.add(new Konva.Line({ points: [25, 0, 40, 0], stroke: s, strokeWidth: 2 }));

        const bar = new Konva.Line({
            points: [-25, 0, 25, 0],
            stroke: s,
            strokeWidth: 3,
        });

        const emitterLead = new Konva.Line({
            points: [0, 0, -10, 20, 0, 35],
            stroke: s,
            strokeWidth: 2,
        });

        const arrow = new Konva.Line({
            points: [-10, 10, -4, 14, -10, 18],
            closed: true,
            fill: s,
            stroke: s,
            strokeWidth: 1,
        });

        this._staticGroup.add(bar, emitterLead, arrow);

        const lbl = { fontSize: 12, fill: '#333333', fontFamily: 'Arial', fontStyle: 'bold' };
        this._staticGroup.add(new Konva.Text({ x: -50, y: -16, text: 'B1', ...lbl }));
        this._staticGroup.add(new Konva.Text({ x: 32, y: -16, text: 'B2', ...lbl }));
        this._staticGroup.add(new Konva.Text({ x: -22, y: 26, text: 'E', ...lbl }));
    }

    getConfigFields() {
        return [
            { label: '器件名称', key: 'id', type: 'text' },
            { label: '分压比 η', key: 'eta', type: 'number' },
            { label: '基极电阻 RBB (Ω)', key: 'rBB', type: 'number' },
            { label: '发射极导通电阻 (Ω)', key: 'rOn', type: 'number' },
            { label: '发射极关断电阻 (Ω)', key: 'rOff', type: 'number' },
            { label: '发射极导通压降 (V)', key: 'vOn', type: 'number' },
            { label: '维持电流 (A)', key: 'holdCurrent', type: 'number' },
        ];
    }

    onConfigUpdate(cfg) {
        if (cfg.id !== undefined) this.id = cfg.id;
        if (cfg.eta !== undefined) this.eta = cfg.eta;
        if (cfg.rBB !== undefined) this.rBB = cfg.rBB;
        if (cfg.rOn !== undefined) this.rOn = cfg.rOn;
        if (cfg.rOff !== undefined) this.rOff = cfg.rOff;
        if (cfg.vOn !== undefined) this.vOn = cfg.vOn;
        if (cfg.holdCurrent !== undefined) this.holdCurrent = cfg.holdCurrent;
        this.config = cfg;
        this._refreshCache();
    }

    destroy() {
        super.destroy?.();
    }
}
