import { BaseComponent } from './BaseComponent.js';

export class RealControlTransformer extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.width  = 220;
        this.height = 170;

        this.type    = 'control_transformer';

        this.cache   = 'fixed';
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

        this._primaryLeakage   = config.primaryLeakage   || 0.01;  // 10mH
        this._secondaryLeakage = config.secondaryLeakage || 0.001; // 1mH
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

        this.addPort(0, this._primaryTopY, 'p1', 'wire', 'p');
        this.addPort(0, this._primaryBotY, 'p2', 'wire', 'n');
        this.addPort(this.width, this._secondaryTopY, 's1', 'wire', 'p');
        this.addPort(this.width, this._secondaryBotY, 's2', 'wire', 'n');
    }

    _initVisuals() {
        const W = this.width, H = this.height;
        const cx = W / 2, cy = H / 2;
        const colW = 28;
        const gap = 76;
        const coreW = colW * 2 + gap;
        const coreH = 132;
        const yokeH = 22;
        const legH = coreH - yokeH * 2;

        const coreLeftX  = cx - coreW / 2;
        const coreRightX = coreLeftX + colW + gap;
        const coreTopY   = cy - coreH / 2;

        const panel = new Konva.Rect({
            x: 0, y: 0, width: W, height: H,
            fill: '#e8eaec',
            stroke: '#b0b4b8', strokeWidth: 1.5,
            cornerRadius: 4,
        });
        this._staticGroup.add(panel);

        const coreColor = '#8898a8';
        const coreStroke = '#485060';

        const drawCoreRect = (x, y, w, h) => {
            this._staticGroup.add(new Konva.Rect({
                x, y, width: w, height: h,
                fill: coreColor, stroke: coreStroke, strokeWidth: 1.5,
                cornerRadius: 1,
            }));
        };

        drawCoreRect(coreLeftX, coreTopY, colW, coreH);
        drawCoreRect(coreRightX, coreTopY, colW, coreH);
        drawCoreRect(coreLeftX, coreTopY, coreW, yokeH);
        drawCoreRect(coreLeftX, coreTopY + coreH - yokeH, coreW, yokeH);

        const lamStripes = (legX) => {
            for (let i = 0; i < 8; i++) {
                const lx = legX + 3 + i * 3;
                this._staticGroup.add(new Konva.Line({
                    points: [lx, coreTopY + yokeH + 2, lx, coreTopY + coreH - yokeH - 2],
                    stroke: '#7a8a9a', strokeWidth: 0.3, listening: false,
                }));
            }
        };
        lamStripes(coreLeftX);
        lamStripes(coreRightX);

        const tilt = 2;
        const spacingPri = legH / 6;
        const spacingSec = legH / 5;
        this._primaryTopY = coreTopY + yokeH + spacingPri;
        this._primaryBotY = coreTopY + yokeH + 5 * spacingPri;
        this._secondaryTopY = coreTopY + yokeH + spacingSec + tilt;
        this._secondaryBotY = coreTopY + yokeH + 4 * spacingSec + tilt;

        this._drawWinding(coreLeftX, coreTopY + yokeH, colW, legH, '#c07030', 5, 'left', tilt,
            this._primaryTopY, this._primaryBotY);
        this._drawWinding(coreRightX, coreTopY + yokeH, colW, legH, '#3080b0', 4, 'right', tilt,
            this._secondaryTopY, this._secondaryBotY);

        const label = { fontSize: 9, fontFamily: 'Arial', fontStyle: 'bold', fill: '#444', align: 'center', width: 20 };

        this._staticGroup.add(new Konva.Text({ x: -8, y: this._primaryTopY - 5, text: 'P1', ...label }));
        this._staticGroup.add(new Konva.Text({ x: -8, y: this._primaryBotY - 5, text: 'P2', ...label }));
        this._staticGroup.add(new Konva.Text({ x: W - 14, y: this._secondaryTopY - 5, text: 'S1', ...label }));
        this._staticGroup.add(new Konva.Text({ x: W - 14, y: this._secondaryBotY - 5, text: 'S2', ...label }));

        this._drawTerminal(0, this._primaryTopY, '#c83020');
        this._drawTerminal(0, this._primaryBotY, '#3068c0');
        this._drawTerminal(W, this._secondaryTopY, '#20a060');
        this._drawTerminal(W, this._secondaryBotY, '#806020');

    }

    _drawWinding(legX, y, legW, h, color, turns, side, tilt, termTopY, termBotY) {
        const spacing = h / (turns + 1);

        const termX = side === 'left' ? 0 : this.width;

        const isLeft = side === 'left';
        const entryX = isLeft ? legX : legX + legW;
        const firstTurnY = y + spacing;
        const lastTurnY = y + turns * spacing;
        const entryY = firstTurnY + (isLeft ? 0 : tilt);
        const exitY = lastTurnY + (isLeft ? 0 : tilt);

        this._staticGroup.add(new Konva.Line({
            points: [termX, termTopY, entryX, entryY],
            stroke: color, strokeWidth: 1.5, lineCap: 'round', listening: false,
        }));

        this._staticGroup.add(new Konva.Line({
            points: [entryX, exitY, termX, termBotY],
            stroke: color, strokeWidth: 1.5, lineCap: 'round', listening: false,
        }));

        for (let t = 0; t < turns; t++) {
            const cy = y + (t + 1) * spacing;
            const endY = cy + tilt;

            this._staticGroup.add(new Konva.Line({
                points: [legX, cy, legX + legW, endY],
                stroke: color, strokeWidth: 1.8, lineCap: 'round',
                listening: false,
            }));
        }
    }

    _drawTerminal(x, y, color) {
        const tR = 5;
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

            // 原/副边电流由求解器（互感耦合电感模型）直接写入 physCurrent / I_secondary
        }

        this._acPhase = (this._acPhase + dt * 2 * Math.PI * this._frequency) % (2 * Math.PI);

        const active = Math.abs(this.V_primary) > 0.5;

        this.markDirty();
        this._refreshIfDirty();
    }

    destroy() {
        super.destroy?.();
    }
}
