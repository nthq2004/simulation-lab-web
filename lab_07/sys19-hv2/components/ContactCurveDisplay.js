import { BaseComponent } from './BaseComponent.js';

const defaultW = 480;
const defaultH = 360;
const minW = 300;
const minH = 280;

export class ContactCurveDisplay extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.width  = Math.max(minW, config.width  || defaultW);
        this.height = Math.max(minH, config.height || defaultH);

        this.type  = 'contact-curve';
        this.cache = 'fixed';

        this._initGroups();
        this._recalcGeometry();
        this._initParameters(config);
        this._init();

        this.config = { id: this.id};
    }

    _recalcGeometry() {
        const m = { top: 30, right: 45, bottom: 45, left: 45 };
        this._margin = m;
        this._plotW = this.width - m.left - m.right;
        this._plotH = this.height - m.top - m.bottom;
    }

    _initParameters(config) {
        this._gapMax = 14;
        this._R = 1000;
        this._L_open = 0.5;
        this._L_closed = 15;
        this._V = 220;
        this._f = 50;
        this._cached = null;
    }

    _init() {
        this._drawStaticParts();
        this._createDynamicNodes();
    }

    _getContactor() {
        return this.sys?.comps?.['km1'] || null;
    }

    _calcInductance(gapRatio) {
        return this._L_open + (this._L_closed - this._L_open) * (1 - gapRatio) * (1 - gapRatio);
    }

    _calcCurrent(gapRatio) {
        const L = this._calcInductance(gapRatio);
        const X = 2 * Math.PI * this._f * L;
        return this._V / Math.sqrt(this._R * this._R + X * X);
    }

    _calcForce(gapRatio) {
        const F_base = 40;
        const F_boost = 10 * (1 - gapRatio) * (1 - gapRatio);
        return F_base + F_boost;
    }

    _ensureCache() {
        if (this._cached) return;
        let imax = 0, fmax = 0;
        for (let i = 0; i <= 200; i++) {
            const r = i / 200;
            const I = this._calcCurrent(r);
            const F = this._calcForce(r);
            if (I > imax) imax = I;
            if (F > fmax) fmax = F;
        }
        this._cached = { imax: imax * 1.15, fmax: fmax * 1.15 };
    }

    _gapX(ratio) {
        return this._margin.left + ratio * this._plotW;
    }

    _valY(val, maxVal) {
        return this._margin.top + (1 - Math.min(val, maxVal) / maxVal) * this._plotH;
    }

    _calcCurvePoints(fn, maxVal) {
        const pts = [];
        for (let i = 0; i <= 200; i++) {
            const r = i / 200;
            pts.push(this._gapX(r), this._valY(fn(r), maxVal));
        }
        return pts;
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

        g.add(new Konva.Text({ x: m.left + pW / 2 - 45, y: m.top + pH - 20, width: 80, height: 18,
            text: '气隙 δ (mm)', fontSize: 15, fill: '#333', align: 'center', fontFamily: 'Arial' }));
        g.add(new Konva.Text({ x: 6, y: m.top + pH / 2 + 60, width: 40, height: 80,
            text: '电流 (A)', fontSize: 15, fill: '#0066cc', align: 'center', fontFamily: 'Arial' }));
        g.add(new Konva.Text({ x: w - 48, y: m.top + pH / 2 - 60, width: 40, height: 80,
            text: '吸力 (N)', fontSize: 15, fill: '#cc3300', align: 'center', fontFamily: 'Arial' }));

        for (let i = 0; i <= 4; i++) {
            const x = m.left + pW * i / 4;
            const gap = (this._gapMax / 2) * i / 4;
            g.add(new Konva.Line({ points: [x, m.top + pH, x, m.top + pH + 4], stroke: '#333', strokeWidth: 1 }));
            g.add(new Konva.Text({ x: x - 12, y: m.top + pH + 6, width: 24, height: 14,
                text: gap.toFixed(1), fontSize: 12, fill: '#666', align: 'center', fontFamily: 'Arial' }));
        }

        g.add(new Konva.Line({ points: [m.left + 10, m.top + 12, m.left + 35, m.top + 12], stroke: '#0066cc', strokeWidth: 2 }));
        g.add(new Konva.Text({ x: m.left + 38, y: m.top + 5, width: 70, height: 14,
            text: '电流特性', fontSize: 13, fill: '#0066cc', fontFamily: 'Arial' }));
        g.add(new Konva.Line({ points: [m.left + 110, m.top + 12, m.left + 135, m.top + 12], stroke: '#cc3300', strokeWidth: 2 }));
        g.add(new Konva.Text({ x: m.left + 138, y: m.top + 5, width: 70, height: 14,
            text: '吸力特性', fontSize: 13, fill: '#cc3300', fontFamily: 'Arial' }));
    }

    _createDynamicNodes() {
        const g = this._dynamicGroup;
        this._currentLine = new Konva.Line({ points: [], stroke: '#0066cc', strokeWidth: 2, lineCap: 'round', lineJoin: 'round' });
        this._forceLine = new Konva.Line({ points: [], stroke: '#cc3300', strokeWidth: 2, lineCap: 'round', lineJoin: 'round' });
        this._currentDot = new Konva.Circle({ x: 0, y: 0, radius: 5, fill: '#0066cc', stroke: '#fff', strokeWidth: 1.5, visible: false });
        this._forceDot = new Konva.Circle({ x: 0, y: 0, radius: 5, fill: '#cc3300', stroke: '#fff', strokeWidth: 1.5, visible: false });
        this._gapLine = new Konva.Line({ points: [], stroke: '#999', strokeWidth: 1, dash: [4, 3], visible: false });
        this._infoText = new Konva.Text({ x: this._margin.left + 5, y: this.height - 20, fontSize: 14, fill: '#000602', fontFamily: 'Arial',fontstyle:'bold',
             visible: false });
        g.add(this._currentLine, this._forceLine, this._currentDot, this._forceDot, this._gapLine, this._infoText);
    }

    _syncParams() {
        const km = this._getContactor();
        if (!km) return;
        const R = km._coilResistance || 1000;
        const Lo = km._coilInductanceOpen || 0.5;
        const Lc = km._coilInductanceClosed || 15;
        if (R !== this._R || Lo !== this._L_open || Lc !== this._L_closed) {
            this._R = R;
            this._L_open = Lo;
            this._L_closed = Lc;
            this._cached = null;
        }
    }

    _updateDynamic() {
        this._syncParams();
        this._ensureCache();
        const c = this._cached;

        this._currentLine.points(this._calcCurvePoints((r) => this._calcCurrent(r), c.imax));
        this._forceLine.points(this._calcCurvePoints((r) => this._calcForce(r), c.fmax));

        const km = this._getContactor();
        if (!km) return;

        const curGap = km._armOffsetCur !== undefined ? Math.min(km._armOffsetCur, this._gapMax) : this._gapMax;
        const ratio = curGap / this._gapMax;
        const energized = km.getState() === 'on' || !!km._faultStuck;

        if (energized) {
            const x = this._gapX(ratio);
            const curVal = this._calcCurrent(ratio);
            const forceVal = this._calcForce(ratio);
            this._currentDot.position({ x, y: this._valY(curVal, c.imax) });
            this._currentDot.visible(true);
            this._forceDot.position({ x, y: this._valY(forceVal, c.fmax) });
            this._forceDot.visible(true);
            this._gapLine.points([x, this._margin.top, x, this._margin.top + this._plotH]);
            this._gapLine.visible(true);
            const gapMM = curGap / 2;
            this._infoText.text(`I = ${curVal.toFixed(3)} A  |  F = ${forceVal.toFixed(1)} N  |  δ = ${gapMM.toFixed(1)} mm`);
            this._infoText.visible(true);
        } else {
            this._currentDot.visible(false);
            this._forceDot.visible(false);
            this._gapLine.visible(false);
            this._infoText.visible(false);
        }
    }

    tick(dt) {
        this._updateDynamic();
        this.markDirty();
        this._refreshIfDirty();
    }

    getConfigFields() {
        return [];
    }
}
