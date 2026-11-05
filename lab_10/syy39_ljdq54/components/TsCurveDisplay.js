import { BaseComponent } from './BaseComponent.js';

const defaultW = 570;
const defaultH = 420;
const minW = 280;
const minH = 280;

export class TsCurveDisplay extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.width  = Math.max(minW, config.width  || defaultW);
        this.height = Math.max(minH, config.height || defaultH);

        this.type  = 'ts-curve';
        this.cache = 'fixed';

        this._initGroups();
        this._recalcGeometry();
        this._initParameters(config);
        this._init();

        this.config = { id: this.id};
    }

    _recalcGeometry() {
        const m = { top: 30, right: 30, bottom: 40, left: 50 };
        this._margin = m;
        this._plotW = this.width - m.left - m.right;
        this._plotH = this.height - m.top - m.bottom;
    }

    _initParameters(config) {
        this.quadrants = config.quadrants || 1;
        this.sMax = 1.0;
        this._currentSlip = 0;
        this._currentTe = 0;
        this._currentLoadT = 0;
        this._motorRunning = false;
        this._loadType = 'constant';
    }

    _init() {
        this._drawStaticParts();
        this._createDynamicNodes();
    }

    _getMotor() {
        return this.sys?.comps?.['im01'] || null;
    }

    _calcTMax() {
        const motor = this._getMotor();
        if (!motor) return 200;
        const f = 50;
        const V_ph = 220;
        const R1 = motor.R1 || 0.5;
        const X_total = 2 * Math.PI * f * ((motor.Lsigma1 || 0) + (motor.Lsigma2 || 0));
        const sqrt_term = Math.sqrt(R1 * R1 + X_total * X_total);
        const omega_sync = 2 * Math.PI * f / (motor.polePairs || 2);
        const T_max = (3 * V_ph * V_ph) / (2 * omega_sync * (R1 + sqrt_term));
        const rounded = Math.ceil(T_max / 50) * 50;
        return Math.max(rounded, 50);
    }

    _calcNSync(f) {
        const motor = this._getMotor();
        if (!motor) return 1500;
        return 60 * f / (motor.polePairs || 2);
    }

    _nMax() {
        const motor = this._getMotor();
        if (!motor) return 1600;
        const f = this.sys?.voltageSolver?._systemFreq || 50;
        const nSync = 60 * f / (motor.polePairs || 2);
        return Math.ceil((nSync + 100) / 100) * 100;
    }

    _nToY(n) {
        const nMax = this._nMax();
        const ratio = Math.max(0, Math.min(1, 1 - n / nMax));
        return this._margin.top + ratio * this._plotH;
    }

    _calcCurve(V_ph, f, R2) {
        const motor = this._getMotor();
        if (!motor) return [];
        const R1 = motor.R1 || 0.5;
        const X_total = 2 * Math.PI * f * ((motor.Lsigma1 || 0) + (motor.Lsigma2 || 0));
        const omega_sync = 2 * Math.PI * f / (motor.polePairs || 2);
        const nSync = this._calcNSync(f);
        const steps = 200;
        const pts = [];
        for (let i = 0; i <= steps; i++) {
            const s = this.sMax * i / steps;
            const sc = Math.max(0.001, s);
            const R_load = R1 + R2 / sc;
            const Z_sq = R_load * R_load + X_total * X_total;
            const Te = (3 * V_ph * V_ph * (R2 / sc)) / (omega_sync * Z_sq);
            const n = nSync * (1 - s);
            pts.push(this._tToX(Te), this._nToY(n));
        }
        return pts;
    }

    _calcTsCurve() {
        const motor = this._getMotor();
        if (!motor) return [];
        const f = this.sys?.voltageSolver?._systemFreq || 50;
        const V_ph = (motor._Vrms && motor._Vrms > 1) ? motor._Vrms : 220;
        const R2 = motor.R2 || 0.46;
        return this._calcCurve(V_ph, f, R2);
    }

    _calcRefCurve() {
        return this._calcCurve(220, 50, 0.46);
    }

    _calcLoadCurve() {
        const motor = this._getMotor();
        if (!motor) return [];
        const loadTorque = motor.loadTorque || 0;
        const loadType = motor.loadType || 'constant';
        const f = this.sys?.voltageSolver?._systemFreq || 50;
        const nSync = this._calcNSync(f);
        const steps = 200;
        const pts = [];
        for (let i = 0; i <= steps; i++) {
            const s = this.sMax * i / steps;
            const n = nSync * (1 - s);
            let T_load;
            if (loadType === 'fan') {
                const omega_sync = 2 * Math.PI * f / (motor.polePairs || 2);
                const omega_m = omega_sync * (1 - s);
                const fanK = motor.fanK || 0;
                T_load = fanK * omega_m * Math.abs(omega_m);
            } else {
                T_load = loadTorque;
            }
            pts.push(this._tToX(Math.abs(T_load)), this._nToY(n));
        }
        return pts;
    }

    _tToX(T) {
        const tMax = this._calcTMax();
        return this._margin.left + (Math.min(tMax, Math.max(0, T)) / tMax) * this._plotW;
    }

    _drawStaticParts() {
        const g = this._staticGroup;
        const m = this._margin;
        const pW = this._plotW;
        const pH = this._plotH;
        const w = this.width;
        const h = this.height;
        g.add(new Konva.Rect({ x: 0, y: 0, width: w, height: h, fill: '#f9f9f9', stroke: '#888', strokeWidth: 1 }));
        g.add(new Konva.Rect({ x: m.left, y: m.top, width: pW, height: pH, fill: '#fff', stroke: '#ccc', strokeWidth: 1 }));

        for (let i = 0; i <= 5; i++) {
            const y = m.top + pH * i / 5;
            g.add(new Konva.Line({ points: [m.left, y, m.left + pW, y], stroke: '#e0e0e0', strokeWidth: 0.5 }));
        }
        for (let i = 0; i <= 4; i++) {
            const x = m.left + pW * i / 4;
            g.add(new Konva.Line({ points: [x, m.top, x, m.top + pH], stroke: '#e0e0e0', strokeWidth: 0.5 }));
        }

        g.add(new Konva.Line({ points: [m.left, m.top, m.left, m.top + pH], stroke: '#333', strokeWidth: 1.5 }));
        g.add(new Konva.Line({ points: [m.left, m.top + pH, m.left + pW, m.top + pH], stroke: '#333', strokeWidth: 1.5 }));

        g.add(new Konva.Text({ x: 6, y: m.top-25, width: m.left+20, height: 18,
            text: 'n (r/min)', fontSize: 14, fill: '#333', align: 'center', fontFamily: 'Arial' }));
        for (let i = 0; i <= 4; i++) {
            const x = m.left + pW * i / 4;
            g.add(new Konva.Line({ points: [x, m.top + pH, x, m.top + pH + 4], stroke: '#333', strokeWidth: 1 }));
        }
    }

    _createDynamicNodes() {
        const g = this._dynamicGroup;
        const m = this._margin;

        this._refLine  = new Konva.Line({ points: [], stroke: '#99bbdd', strokeWidth: 1.5, dash: [6, 4], lineCap: 'round', lineJoin: 'round' });
        this._ref2Line = new Konva.Line({ points: [], stroke: '#dd9988', strokeWidth: 1.5, dash: [6, 4], lineCap: 'round', lineJoin: 'round' });
        this._ref3Line = new Konva.Line({ points: [], stroke: '#88bb99', strokeWidth: 1.5, dash: [6, 4], lineCap: 'round', lineJoin: 'round' });
        this._tsLine = new Konva.Line({ points: [], stroke: '#0066cc', strokeWidth: 2, dash: [8, 4], lineCap: 'round', lineJoin: 'round' });
        this._loadLine = new Konva.Line({ points: [], stroke: '#cc6600', strokeWidth: 2, dash: [8, 4], lineCap: 'round', lineJoin: 'round' });
        this._motorDot = new Konva.Circle({ x: 0, y: 0, radius: 6, fill: '#ff0000', stroke: '#fff', strokeWidth: 1.5, visible: false });
        this._loadDot = new Konva.Circle({ x: 0, y: 0, radius: 6, fill: '#0066ff', stroke: '#fff', strokeWidth: 1.5, visible: false });
        this._infoText = new Konva.Text({ x: m.left + 5, y: this.height - 20, fontSize: 16, fill: '#022506', fontFamily: 'Arial', visible: false });

        this._xTickLabels = [];
        for (let i = 0; i <= 4; i++) {
            const x = m.left + this._plotW * i / 4;
            const label = new Konva.Text({ x: x - 12, y: m.top + this._plotH + 4, width: 24, text: '',
                fontSize: 10, fill: '#666', align: 'center', fontFamily: 'Arial' });
            this._xTickLabels.push(label);
            g.add(label);
        }
        this._yTickMarks = [];
        this._yTickLabels = [];
        for (let i = 0; i < 20; i++) {
            const mark = new Konva.Line({ points: [0,0,0,0], stroke: '#333', strokeWidth: 1, visible: false });
            const label = new Konva.Text({ x: 0, y: 0, width: m.left - 6, text: '',
                fontSize: 10, fill: '#666', align: 'right', fontFamily: 'Arial', visible: false });
            this._yTickMarks.push(mark);
            this._yTickLabels.push(label);
            g.add(mark, label);
        }
        this._tAxisTitle = new Konva.Text({ x: m.left + this._plotW - 55, y: m.top + this._plotH + 2,
            text: 'T (N·m)', fontSize: 11, fill: '#333', fontFamily: 'Arial' });
        g.add(this._tAxisTitle);

        g.add(this._refLine, this._ref2Line, this._ref3Line, this._tsLine, this._loadLine, this._motorDot, this._loadDot, this._infoText);
    }

    _updateDynamic() {
        const motor = this._getMotor();
        if (!motor) return;

        this._currentSlip = motor.slip !== undefined ? motor.slip : 0;
        this._currentTe = motor._Te || 0;
        this._currentLoadT = Math.abs(motor._appliedLoadTorque || 0);
        this._motorRunning = motor._phaseSeq !== 0 || (motor._omega_m && Math.abs(motor._omega_m) > 0.5);
        this._loadType = motor.loadType || 'constant';

        const tMax = this._calcTMax();
        for (let i = 0; i <= 4; i++) {
            const val = (tMax * i / 4).toFixed(0);
            this._xTickLabels[i].text(val);
        }
        const nMax = this._nMax();
        const nSteps = Math.floor(nMax / 200);
        for (let i = 0; i < 20; i++) {
            if (i <= nSteps) {
                const nv = i * 200;
                const y = this._margin.top + (1 - nv / nMax) * this._plotH;
                this._yTickMarks[i].points([this._margin.left - 4, y, this._margin.left, y]);
                this._yTickMarks[i].visible(true);
                this._yTickLabels[i].text(String(nv));
                this._yTickLabels[i].position({ x: 0, y: y - 7 });
                this._yTickLabels[i].visible(true);
            } else {
                this._yTickMarks[i].visible(false);
                this._yTickLabels[i].visible(false);
            }
        }

        this._refLine.points(this._calcRefCurve());
        this._ref2Line.points(this._calcCurve(110, 25, 0.46));
        this._ref3Line.points(this._calcCurve(220, 50, 1.38));
        this._tsLine.points(this._calcTsCurve());
        this._loadLine.points(this._calcLoadCurve());

        if (this._motorRunning) {
            this._tsLine.dash([]);
            this._loadLine.dash([]);
        } else {
            this._tsLine.dash([8, 4]);
            this._loadLine.dash([8, 4]);
        }

        const freq = this.sys?.voltageSolver?._systemFreq || 50;
        const nSync = this._calcNSync(freq);
        const s = this._currentSlip;
        const n = nSync * (1 - s);
        if (this._motorRunning && s >= 0 && s <= this.sMax && tMax > 0) {
            const sx = this._tToX(Math.abs(this._currentTe));
            const sy = this._nToY(n);
            this._motorDot.position({ x: sx, y: sy });
            this._motorDot.visible(true);

            this._loadDot.position({ x: this._tToX(Math.min(tMax * 1.2, this._currentLoadT)), y: sy });
            this._loadDot.visible(true);

            this._infoText.text(`n = ${n.toFixed(0)} r/min  Te = ${Math.abs(this._currentTe).toFixed(1)} N·m  负载 = ${this._currentLoadT.toFixed(1)} N·m`);
            this._infoText.visible(true);
        } else {
            this._motorDot.visible(false);
            this._loadDot.visible(false);
            this._infoText.visible(false);
        }
    }

    tick(dt) {
        this._updateDynamic();
        this.markDirty();
        this._refreshIfDirty();
    }

    getConfigFields() {
        return [
            { label: '象限模式', key: 'quadrants', type: 'select', options: [
                { value: 1, label: '第 1 象限' },
            ]},
        ];
    }
}
