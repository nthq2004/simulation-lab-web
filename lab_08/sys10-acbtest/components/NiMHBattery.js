import { BaseComponent } from './BaseComponent.js';

export class NiMHBattery extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.width  = Math.max(60, config.width  || 80);
        this.height = Math.max(100, config.height || 130);

        this.type  = 'nimh_battery';
        this.cache = 'fixed';

        this._initGroups();
        this._recalcGeometry();
        this._initParameters(config);
        this._init();

        this.config = {
            id: this.id,
            capacity:   this._capacity,
            initialSOC: this._soc,
            rOn:        this._rOn,
            rp:         this._rp,
            cp:         this._cp,
            initVP:     this._initVP,
        };

        this.addPort(this._portP.x, this._portP.y, 'p', 'wire', 'p');
        this.addPort(this._portN.x, this._portN.y, 'n', 'wire', 'n');
    }

    _recalcGeometry() {
        const W = this.width, H = this.height;
        this._cx = W * 0.50;

        this._termH  = Math.max(6,  H * 0.06);
        this._bodyTop = this._termH + 4;
        this._bodyBot = H - this._termH - 4;
        this._bodyH   = this._bodyBot - this._bodyTop;
        this._bodyW   = Math.max(30, W * 0.70);

        this._portP = { x: this._cx, y: 0 };
        this._portN = { x: this._cx, y: H - 8 };
    }

    _initParameters(config) {
        this._capacity    = parseFloat(config.capacity)   || 100;
        this._soc         = Math.max(0, Math.min(1, parseFloat(config.initialSOC) || 0.8));
        this._rOn         = parseFloat(config.rOn)        || 0.05;
        this._rp          = parseFloat(config.rp)         || 1.0;
        this._cp          = parseFloat(config.cp)         || 0.33;
        this._initVP      = parseFloat(config.initVP)     || -0.15;
        this._tau         = this._rp * this._cp;
        this._vp          = this._initVP;
        this._voltage     = this._socToVoltage(this._soc);
        this._current     = 0;
    }

    _socToVoltage(s) {
        const soc = Math.max(0, Math.min(1, s));
        const table = [
            [0.00, 1.00], [0.05, 1.10], [0.15, 1.15],
            [0.30, 1.18], [0.60, 1.20], [0.85, 1.22],
            [0.95, 1.25], [1.00, 1.25],
        ];
        for (let i = 1; i < table.length; i++) {
            if (soc <= table[i][0]) {
                const t = (soc - table[i-1][0]) / (table[i][0] - table[i-1][0]);
                return table[i-1][1] + t * (table[i][1] - table[i-1][1]);
            }
        }
        return table[table.length - 1][1];
    }

    _init() {
        this._drawStaticParts();
        this._createDynamicNodes();
    }

    _drawStaticParts() {
        const cx = this._cx, W = this.width, H = this.height;
        const tH = this._termH, bT = this._bodyTop, bH = this._bodyH;
        const bW = this._bodyW;

        // 正极端子
        this._staticGroup.add(new Konva.Rect({
            x: cx - bW * 0.18, y: 0,
            width: bW * 0.36, height: tH+4,
            fill: '#f88a05', stroke: '#303438', strokeWidth: 1, cornerRadius: [2, 2, 0, 0],
        }));

        // 电池主体
        this._staticGroup.add(new Konva.Rect({
            x: cx - bW / 2, y: bT,
            width: bW, height: bH,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint:   { x: bW, y: 0 },
            fillLinearGradientColorStops: [0, '#3a4048', 0.3, '#505860', 0.7, '#505860', 1, '#3a4048'],
            stroke: '#202428', strokeWidth: 1.5, cornerRadius: 3,
        }));

        // 铭牌
        const lFs = Math.max(10, bW * 0.11);
        this._staticGroup.add(new Konva.Text({
            x: cx - bW / 2 + 4, y: bT + 4,
            text: 'NiMH', fontSize: lFs, fontFamily: 'Arial', fontStyle: 'bold',
            fill: '#0fd40f',
        }));
    }

    _createDynamicNodes() {
        const cx = this._cx;
        const bW = this._bodyW, bT = this._bodyTop, bH = this._bodyH;
        const dFs = Math.max(12, bW * 0.11);

        // SOC 进度条背景
        const barW = bW * 0.55, barH = bH * 0.08;
        const barX = cx ;
        const barY = bT + bH * 0.22;
        this._barBg = new Konva.Rect({
            x: barX-15 , y: barY, width: barW, height: barH,
            fill: '#202428', cornerRadius: 2,
        });
        this._dynamicGroup.add(this._barBg);

        // SOC 进度条填充
        this._barFill = new Konva.Rect({
            x: barX-15 , y: barY + 1,
            width: Math.max(0, (barW - 2) * this._soc),
            height: barH - 2,
            fill: '#30b868', cornerRadius: 1,
        });
        this._dynamicGroup.add(this._barFill);

        // SOC 文字
        this._socText = new Konva.Text({
            x: cx - bW / 2+ 6, y: bT + bH * 0.46,
            text: `${(this._soc * 100).toFixed(2)}%`,
            fontSize: dFs, fontFamily: 'Courier New', fontStyle: 'bold',
            fill: '#e0e8e0',
        });
        this._dynamicGroup.add(this._socText);

        // 电压文字
        this._voltText = new Konva.Text({
            x: cx - bW / 2 + 6, y: bT + bH * 0.62,
            text: `${this._voltage.toFixed(3)}V`,
            fontSize: dFs, fontFamily: 'Courier New',
            fill: '#f0d050',
        });
        this._dynamicGroup.add(this._voltText);

        // 电流文字
        this._curText = new Konva.Text({
            x: cx - bW / 2 + 6, y: bT + bH * 0.78,
            text: `${this._current >= 0 ? '' : '-'}${Math.abs(this._current).toFixed(2)}A`,
            fontSize: dFs, fontFamily: 'Courier New',
            fill: '#60b0f0',
        });
        this._dynamicGroup.add(this._curText);
    }

    tick(dt) {
        const solver = this.sys?.voltageSolver;
        if (solver) {
            const cP = solver.portToCluster.get(`${this.id}_wire_p`);
            const cN = solver.portToCluster.get(`${this.id}_wire_n`);
            if (cP !== undefined && cN !== undefined) {
                const vP = solver.nodeVoltages.get(cP) || 0;
                const vN = solver.nodeVoltages.get(cN) || 0;
                const vTerminal = vP - vN;
                const vSrc = this._voltage - this._vp;
                this._current = (vSrc - vTerminal) / this._rOn;

                const expFactor = Math.exp(-dt / this._tau);
                this._vp = this._vp * expFactor + this._current * this._rp * (1 - expFactor);

                const dSOC = (this._current * dt) / (this._capacity * 3.6);
                this._soc = Math.max(0, Math.min(1, this._soc - dSOC));
                this._voltage = this._socToVoltage(this._soc);
            }
        }

        this._updateDynamic();
        this.markDirty();
        this._refreshIfDirty();
    }

    _updateDynamic() {
        const bW = this._bodyW, bT = this._bodyTop, bH = this._bodyH;
        const barW = bW * 0.55, barH = bH * 0.08;
        const barX = this._cx + bW * 0.12 + 1;
        const barY = bT + bH * 0.22 + 1;

        this._barFill.width(Math.max(0, (barW - 2) * this._soc));
        this._socText.text(`${(this._soc * 100).toFixed(2)}%`);

        const vSrc = this._voltage - this._vp;
        this._voltText.text(`${vSrc.toFixed(3)}V`);

        const sign = this._current >= 0 ? '' : '-';
        this._curText.text(`${sign}${Math.abs(this._current).toFixed(2)}A`);

        const socPct = this._soc;
        if (socPct > 0.3) {
            this._barFill.fill('#30b868');
        } else if (socPct > 0.15) {
            this._barFill.fill('#e0a030');
        } else {
            this._barFill.fill('#d04030');
        }
    }

    getValue() {
        return this._voltage - this._vp;
    }

    getSOC() { return this._soc; }
    setSOC(v) {
        this._soc = Math.max(0, Math.min(1, parseFloat(v) || 0));
        this._voltage = this._socToVoltage(this._soc);
    }

    getConfigFields() {
        return [
            { label: '容量 mAh',        key: 'capacity',   type: 'number' },
            { label: '初始 SOC (0~1)',   key: 'initialSOC', type: 'number' },
            { label: '内阻 Ω',          key: 'rOn',        type: 'number' },
            { label: '极化电阻 Ω',      key: 'rp',         type: 'number' },
            { label: '极化电容 F',      key: 'cp',         type: 'number' },
            { label: '初始极化电压 V',  key: 'initVP',     type: 'number' },
        ];
    }

    onConfigUpdate(cfg) {
        if (cfg.capacity   !== undefined) this._capacity = parseFloat(cfg.capacity);
        if (cfg.initialSOC !== undefined) this.setSOC(parseFloat(cfg.initialSOC));
        if (cfg.rOn        !== undefined) this._rOn = parseFloat(cfg.rOn);
        if (cfg.rp         !== undefined) { this._rp = parseFloat(cfg.rp); this._tau = this._rp * this._cp; }
        if (cfg.cp         !== undefined) { this._cp = parseFloat(cfg.cp); this._tau = this._rp * this._cp; }
        if (cfg.initVP     !== undefined) this._vp = parseFloat(cfg.initVP);
        this.config = { ...this.config, ...cfg };
    }

    destroy() { super.destroy?.(); }
}
