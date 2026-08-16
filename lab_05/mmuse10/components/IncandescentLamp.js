import { BaseComponent } from './BaseComponent.js';

export class IncandescentLamp extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);
        this.type = 'resistor';
        this.cache = 'fixed';
        this._initGroups();

        this.coldResistance = config.coldResistance || 484;
        this.currentResistance = this.coldResistance;
        this.vRated = 220;
        this.vMax = 240;
        this.vBurn = 270;
        this._burnedOut = false;
        this._rmsBuffer = [];
        this._rmsWindow = 200;
        this._rmsVoltage = 0;
        this._brightness = 0;

        this.config = { id: this.id, coldResistance: this.coldResistance };

        this.initVisuals();
        this.initPorts();
    }

    initPorts() {
        this.addPort(-40, 0, 'l', 'wire', 'p');
        this.addPort(40, 0, 'r', 'wire');
    }

    initVisuals() {
        const stroke = '#000000';
        this._staticGroup.add(new Konva.Line({ points: [-40, 0, -20, 0], stroke, strokeWidth: 2 }));
        this._staticGroup.add(new Konva.Line({ points: [20, 0, 40, 0], stroke, strokeWidth: 2 }));

        const circle = new Konva.Circle({
            x: 0, y: 0, radius: 20,
            stroke, strokeWidth: 2,
            fill: '#fff',
        });
        this._staticGroup.add(circle);

        const filament = new Konva.Line({
            points: [-10, 0, -5, -8, 0, 0, 5, -8, 10, 0],
            stroke: '#888',
            strokeWidth: 1.5,
            tension: 0.3,
            listening: false,
        });
        this._staticGroup.add(filament);

        const supportL = new Konva.Line({
            points: [-10, 0, -10, -16],
            stroke: '#666',
            strokeWidth: 1,
            listening: false,
        });
        const supportR = new Konva.Line({
            points: [10, 0, 10, -16],
            stroke: '#666',
            strokeWidth: 1,
            listening: false,
        });
        this._staticGroup.add(supportL, supportR);

        this.glowOverlay = new Konva.Circle({
            x: 0, y: 0, radius: 23,
            fill: '#000000',
            opacity: 0,
            listening: false,
        });
        this._dynamicGroup.add(this.glowOverlay);

        this.burnMark = new Konva.Line({
            points: [-8, -8, 8, 8],
            stroke: '#000', strokeWidth: 0, lineCap: 'round', listening: false,
        });
        this._dynamicGroup.add(this.burnMark);

        this.rmsLabel = new Konva.Text({
            x: -50, y: -43, width: 100,
            text: '',
            fontSize: 15, fill: '#2c3e50', fontFamily: 'Arial', fontStyle: 'bold',
            align: 'center', listening: false,
        });
        this._dynamicGroup.add(this.rmsLabel);

        const lbl = { fontSize: 11, fill: '#e67e22', fontFamily: 'Arial', fontStyle: 'bold' };
        this._staticGroup.add(new Konva.Text({ x: -36, y: -32, text: 'L', ...lbl }));
        this._staticGroup.add(new Konva.Text({ x: 32, y: -32, text: 'N', ...lbl }));
    }

    getConfigFields() {
        return [
            { label: '器件名称', key: 'id', type: 'text' },
            { label: '冷态电阻 (Ω)', key: 'coldResistance', type: 'number' },
        ];
    }

    onConfigUpdate(cfg) {
        if (cfg.id !== undefined) this.id = cfg.id;
        if (cfg.coldResistance !== undefined) {
            this.coldResistance = cfg.coldResistance;
            this.currentResistance = this.coldResistance;
        }
        this.config = cfg;
        this._refreshCache();
    }

    tick(dt) {
        if (this._burnedOut) {
            this.glowOverlay.opacity(0);
            this.burnMark.strokeWidth(2);
            this.rmsLabel.text('已烧毁');
            this.rmsLabel.fill('#c0392b');
            return;
        }

        const vInstant = this.sys.getVoltageBetween(`${this.id}_wire_l`, `${this.id}_wire_r`) || 0;

        this._rmsBuffer.push(vInstant * vInstant);
        if (this._rmsBuffer.length > this._rmsWindow) {
            this._rmsBuffer.shift();
        }
        const sumSq = this._rmsBuffer.reduce((a, b) => a + b, 0);
        this._rmsVoltage = Math.sqrt(sumSq / this._rmsBuffer.length);

        if (this._rmsVoltage >= this.vBurn) {
            this._burnedOut = true;
            return;
        }

        let targetBrightness;
        if (this._rmsVoltage <= 10) {
            targetBrightness = 0;
        } else if (this._rmsVoltage <= this.vRated) {
            targetBrightness = this._rmsVoltage / this.vRated;
        } else if (this._rmsVoltage <= this.vMax) {
            const ratio = (this._rmsVoltage - this.vRated) / (this.vMax - this.vRated);
            targetBrightness = 1.0 + ratio * 0.4;
        } else {
            targetBrightness = 1.4;
        }
        targetBrightness = Math.min(1.4, Math.max(0, targetBrightness));

        this._brightness += (targetBrightness - this._brightness) * 0.1;

        if (this._brightness < 0.01) {
            this.glowOverlay.opacity(0);
        } else {
            const t = Math.min(1, this._brightness);
            const r = Math.min(255, 70 + Math.round(185 * t));
            const g = Math.min(255, 35 + Math.round(220 * t));
            const bl = Math.min(255, Math.round(200 * Math.max(0, this._brightness - 0.2) / 1.2));
            this.glowOverlay.fill(`rgb(${r},${g},${bl})`);
            this.glowOverlay.opacity(0.25 + 0.75 * t);
        }

        this.rmsLabel.text(this._rmsVoltage.toFixed(1) + 'V');
        this.rmsLabel.fill(this._rmsVoltage >= this.vRated ? '#e67e22' : '#7f8c8d');
    }

    destroy() {
        super.destroy?.();
    }
}
