import { BaseComponent } from '../components/BaseComponent.js';

export class ControlTransformer extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.width  = Math.max(70, config.width  || 70);
        this.height = Math.max(110, config.height || 110);

        this.type  = 'control_transformer';
        this.cache = 'fixed';
        this._initGroups();

        this._primaryVoltage   = config.primaryVoltage   || 380;
        this._secondaryVoltage = config.secondaryVoltage || 220;
        this._ratedPower       = config.ratedPower       || 1000;
        this._frequency        = config.frequency        || 50;
        this._primaryResistance   = config.primaryResistance   || 20;
        this._secondaryResistance = config.secondaryResistance || 0.3;

        this._turnsRatio = this._primaryVoltage / Math.max(1, this._secondaryVoltage);

        const Vp = this._primaryVoltage;
        const S  = this._ratedPower;
        const f  = this._frequency;
        const Ip = S / Math.max(1, Vp);
        const Xm = Vp / (0.05 * Ip);
        this._magnetizingInductance = Math.min(10, Xm / (2 * Math.PI * f));
        if (config.magnetizingInductance !== undefined) {
            this._magnetizingInductance = parseFloat(config.magnetizingInductance) || 10;
        }
        this._coreResistance = config.coreResistance || 50000;

        this._primaryLeakage   = config.primaryLeakage   || 0.01;
        this._secondaryLeakage = config.secondaryLeakage || 0.001;
        this._iLmPrev   = 0;
        this._iL1Prev   = 0;
        this._iL2Prev   = 0;
        this._i1Prev    = 0;
        this._i2Prev    = 0;
        this.V_primary   = 0;
        this.V_secondary = 0;
        this.I_primary   = 0;
        this.I_secondary = 0;
        this._acPhase    = 0;

        this.config = {
            id: this.id,
            primaryVoltage:   this._primaryVoltage,
            secondaryVoltage: this._secondaryVoltage,
            ratedPower:       this._ratedPower,
            frequency:        this._frequency,
            magnetizingInductance: this._magnetizingInductance,
            coreResistance:    this._coreResistance,
            primaryResistance:   this._primaryResistance,
            secondaryResistance: this._secondaryResistance,
            primaryLeakage:      this._primaryLeakage,
            secondaryLeakage:    this._secondaryLeakage,
        };

        this._initVisuals();

        this.addPort(0, this._primaryY1, 'p1', 'wire', 'p');
        this.addPort(0, this._primaryY2, 'p2', 'wire', 'n');
        this.addPort(this.width, this._secondaryY1, 's1', 'wire', 'p');
        this.addPort(this.width, this._secondaryY2, 's2', 'wire', 'n');
    }

    _initVisuals() {
        const W = this.width, H = this.height;
        const cx = W / 2;
        const R = 9;
        const priX = cx - 12;
        const secX = cx + 12;

        // 透明拖动区域
        this._interactGroup.add(new Konva.Rect({
            x: 0, y: 0, width: W, height: H,
            fill: 'transparent', listening: true,
        }));

        // ── 原边 4 匝 ──
        const priCount = 4;
        const priD = R * 2;
        const priTotal = priCount * priD;
        const priTop = (H - priTotal) / 2;
        const priBot = priTop + priTotal;
        this._primaryY1 = priTop;
        this._primaryY2 = priBot;

        // P1 → 水平引线到第一匝
        this._staticGroup.add(new Konva.Line({
            points: [0, priTop, priX, priTop],
            stroke: '#c07030', strokeWidth: 1.5, lineCap: 'round', listening: false,
        }));
        // 最后一匝 → P2 水平引线
        this._staticGroup.add(new Konva.Line({
            points: [0, priBot, priX, priBot],
            stroke: '#c07030', strokeWidth: 1.5, lineCap: 'round', listening: false,
        }));
        // 4 个右半圆弧
        for (let i = 0; i < priCount; i++) {
            const y = priTop + i * priD + R;
            this._staticGroup.add(new Konva.Arc({
                x: priX, y,
                innerRadius: R - 1, outerRadius: R,
                angle: 180, rotation: 270,
                fill: 'none', stroke: '#c07030', strokeWidth: 2, listening: false,
            }));
        }

        // ── 副边 3 匝 ──
        const secCount = 3;
        const secD = R * 2;
        const secTotal = secCount * secD;
        const secTop = (H - secTotal) / 2;
        const secBot = secTop + secTotal;
        this._secondaryY1 = secTop;
        this._secondaryY2 = secBot;

        // S1 → 水平引线到第一匝
        this._staticGroup.add(new Konva.Line({
            points: [W, secTop, secX, secTop],
            stroke: '#3080b0', strokeWidth: 1.5, lineCap: 'round', listening: false,
        }));
        // 最后一匝 → S2 水平引线
        this._staticGroup.add(new Konva.Line({
            points: [W, secBot, secX, secBot],
            stroke: '#3080b0', strokeWidth: 1.5, lineCap: 'round', listening: false,
        }));
        // 3 个左半圆弧
        for (let i = 0; i < secCount; i++) {
            const y = secTop + i * secD + R;
            this._staticGroup.add(new Konva.Arc({
                x: secX, y,
                innerRadius: R - 1, outerRadius: R,
                angle: 180, rotation: 90,
                fill: 'none', stroke: '#3080b0', strokeWidth: 2, listening: false,
            }));
        }

        // 端子
        this._drawTerminal(0, priTop, '#c83020');
        this._drawTerminal(0, priBot, '#3068c0');
        this._drawTerminal(W, secTop, '#20a060');
        this._drawTerminal(W, secBot, '#806020');

        const label = { fontSize: 8, fontFamily: 'Arial', fontStyle: 'bold', fill: '#444', align: 'center', width: 16 };
        this._staticGroup.add(new Konva.Text({ x: -6, y: priTop - 4, text: 'P1', ...label }));
        this._staticGroup.add(new Konva.Text({ x: -6, y: priBot - 4, text: 'P2', ...label }));
        this._staticGroup.add(new Konva.Text({ x: W - 12, y: secTop - 4, text: 'S1', ...label }));
        this._staticGroup.add(new Konva.Text({ x: W - 12, y: secBot - 4, text: 'S2', ...label }));
    }

    _drawTerminal(x, y, color) {
        const tR = 4;
        this._staticGroup.add(new Konva.Circle({
            x, y, radius: tR,
            fillLinearGradientStartPoint: { x: -tR, y: -tR },
            fillLinearGradientEndPoint:   { x: tR, y: tR },
            fillLinearGradientColorStops: [0, '#d8c870', 0.5, '#f0e090', 1, '#b8a858'],
            stroke: '#908030', strokeWidth: 1,
        }));
        this._staticGroup.add(new Konva.Circle({
            x, y, radius: tR * 0.4, fill: '#383028',
        }));
    }

    getConfigFields() {
        return [
            { label: '器件名称', key: 'id', type: 'text' },
            { label: '原边电压 (V)', key: 'primaryVoltage', type: 'number' },
            { label: '副边电压 (V)', key: 'secondaryVoltage', type: 'number' },
            { label: '额定功率 (VA)', key: 'ratedPower', type: 'number' },
            { label: '频率 (Hz)', key: 'frequency', type: 'number' },
            { label: '励磁电感 (H)', key: 'magnetizingInductance', type: 'number' },
            { label: '铁损电阻 (Ω)', key: 'coreResistance', type: 'number' },
            { label: '原边铜损电阻 (Ω)', key: 'primaryResistance', type: 'number' },
            { label: '副边铜损电阻 (Ω)', key: 'secondaryResistance', type: 'number' },
            { label: '原边漏感 (H)', key: 'primaryLeakage', type: 'number' },
            { label: '副边漏感 (H)', key: 'secondaryLeakage', type: 'number' },
        ];
    }

    onConfigUpdate(cfg) {
        if (cfg.id                !== undefined) this.id = cfg.id;
        if (cfg.primaryVoltage    !== undefined) this._primaryVoltage   = parseFloat(cfg.primaryVoltage) || 380;
        if (cfg.secondaryVoltage  !== undefined) this._secondaryVoltage = parseFloat(cfg.secondaryVoltage) || 220;
        if (cfg.ratedPower        !== undefined) this._ratedPower       = parseFloat(cfg.ratedPower) || 1000;
        if (cfg.frequency         !== undefined) this._frequency        = parseFloat(cfg.frequency) || 50;
        if (cfg.magnetizingInductance !== undefined) this._magnetizingInductance = parseFloat(cfg.magnetizingInductance) || 10;
        if (cfg.coreResistance !== undefined) this._coreResistance = parseFloat(cfg.coreResistance) || 50000;
        if (cfg.primaryResistance !== undefined) this._primaryResistance   = parseFloat(cfg.primaryResistance) || 20;
        if (cfg.secondaryResistance !== undefined) this._secondaryResistance = parseFloat(cfg.secondaryResistance) || 0.3;
        if (cfg.primaryLeakage !== undefined) this._primaryLeakage   = parseFloat(cfg.primaryLeakage) || 0.01;
        if (cfg.secondaryLeakage !== undefined) this._secondaryLeakage = parseFloat(cfg.secondaryLeakage) || 0.001;

        this._turnsRatio = this._primaryVoltage / Math.max(1, this._secondaryVoltage);

        const Vp = this._primaryVoltage;
        const S  = this._ratedPower;
        const f  = this._frequency;
        const Ip = S / Math.max(1, Vp);
        const Xm = Vp / (0.05 * Ip);
        this._magnetizingInductance = Math.min(10, Xm / (2 * Math.PI * f));
        if (cfg.magnetizingInductance !== undefined) {
            this._magnetizingInductance = parseFloat(cfg.magnetizingInductance) || 10;
        }

        this.config = { ...this.config, ...cfg };

        this._staticGroup.destroyChildren();
        this._dynamicGroup.destroyChildren();
        this._interactGroup.destroyChildren();
        this._initVisuals();
        this._refreshCache?.();
    }

    tick(dt) {
        const sv = this.sys?.voltageSolver;
        if (sv) {
            const getV = (port) => {
                const c = sv.portToCluster.get(`${this.id}_wire_${port}`);
                if (c === undefined) return 0;
                return sv.nodeVoltages.get(c) || 0;
            };
            const vP1 = getV('p1');
            const vP2 = getV('p2');
            const vS1 = getV('s1');
            const vS2 = getV('s2');
            this.V_primary   = vP1 - vP2;
            this.V_secondary = vS1 - vS2;
        }

        this._acPhase = (this._acPhase + dt * 2 * Math.PI * this._frequency) % (2 * Math.PI);

        this.markDirty();
        this._refreshIfDirty();
    }

    destroy() { super.destroy?.(); }
}