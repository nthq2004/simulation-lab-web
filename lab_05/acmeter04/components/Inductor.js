import { BaseComponent } from './BaseComponent.js';

export class Inductor extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.cache = 'fixed';
        this._initGroups();
        this.type = 'inductor';
        this.inductance = config.inductance || 100;
        this.iLast = 0;
        this.physCurrent = 0;

        this.config = { id: this.id, inductance: this.inductance };

        this.initVisuals();

        this.addPort(-45, 0, 'l', 'wire', 'p');
        this.addPort(45, 0, 'r', 'wire');
    }

    initVisuals() {
        const leadL = new Konva.Line({
            points: [-45, 0, -30, 0],
            stroke: '#bdc3c7',
            strokeWidth: 2,
            lineCap: 'round'
        });
        const leadR = new Konva.Line({
            points: [30, 0, 45, 0],
            stroke: '#bdc3c7',
            strokeWidth: 2,
            lineCap: 'round'
        });

        const coilPath = new Konva.Path({
            data: 'M -30 5 A 7.5 7.5 0 0 1 -15 5 A 7.5 7.5 0 0 1 0 5 A 7.5 7.5 0 0 1 15 5 A 7.5 7.5 0 0 1 30 5',
            stroke: '#2c3e50',
            strokeWidth: 2.5,
            lineCap: 'round',
            fill: null
        });

        const coreTop = new Konva.Line({
            points: [-27, -7, 27, -7],
            stroke: '#2c3e50',
            strokeWidth: 3,
            lineCap: 'round'
        });
        const coreBottom = new Konva.Line({
            points: [-27, 7, 27, 7],
            stroke: '#2c3e50',
            strokeWidth: 3,
            lineCap: 'round'
        });

        this.label = new Konva.Text({
            x: -30,
            y: 18,
            text: this.formatInductance(this.inductance),
            fontSize: 11,
            fontStyle: 'bold',
            fontFamily: 'Calibri',
            fill: '#2c3e50',
            align: 'center',
            width: 60
        });

        this._staticGroup.add(leadL, leadR, coilPath, coreTop, coreBottom, this.label);
    }

    formatInductance(henrys) {
        if (henrys >= 1) return henrys.toFixed(1) + 'H';
        if (henrys >= 1e-3) return (henrys * 1e3).toFixed(1) + 'mH';
        if (henrys >= 1e-6) return (henrys * 1e6).toFixed(1) + 'μH';
        if (henrys >= 1e-9) return (henrys * 1e9).toFixed(1) + 'nH';
        return henrys.toExponential(1) + 'H';
    }

    getCompanionModel(dt) {
        const gEq = dt / this.inductance;
        const iEq = this.iLast;
        return { gEq, iEq };
    }

    updateState() {
        this.iLast = this.physCurrent;
    }

    calculatePhysicalCurrent(vL, vR, dt) {
        const vDiff = vL - vR;
        const gEq = dt / this.inductance;
        this.physCurrent = gEq * vDiff + this.iLast;
    }

    getConfigFields() {
        return [
            { label: '器件名称 (ID)', key: 'id', type: 'text' },
            { label: '电感量 (H)', key: 'inductance', type: 'number' }
        ];
    }

    onConfigUpdate(newConfig) {
        this.inductance = parseFloat(newConfig.inductance);
        this.label.text(this.formatInductance(this.inductance));
        this._refreshCache();
        if (this.sys && this.sys.eventBus) {
            this.sys.eventBus.emit('inductor:configUpdate', { id: this.id, inductance: this.inductance });
        }
    }

    destroy() {
        super.destroy?.();
    }
}
