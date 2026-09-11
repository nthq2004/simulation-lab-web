import { BaseComponent } from './BaseComponent.js';

export class Ballast extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.width = 120;
        this.height = 70;

        this.type = 'ballast';
        this.cache = 'fixed';

        this._initGroups();
        this._recalcGeometry();
        this._initParameters(config);
        this._init();

        this.config = {
            id: this.id,
            inductance: this.inductance,
            resistance: this.resistance,
        };

        this.addPort(-61, 0, 'l', 'wire');
        this.addPort(61, 0, 'r', 'wire');
    }

    _recalcGeometry() {
        const s = this.scale || 1;
        this._W = this.width * s;
        this._H = this.height * s;
    }

    _initParameters(config) {
        this.inductance = config.inductance || 2.2;
        this.resistance = config.resistance || 30;
        this.physCurrent = 0;
        this._useRLSeries = true;
        this._rlPort1 = 'l';
        this._rlPort2 = 'r';
        this._coilResistance = this.resistance;
        this._coilInductance = this.inductance;
        this._coilPrevCurrent = 0;
        this._faultOpen = false;
    }

    _init() {
        this._drawStaticParts();
    }

    tick(dt) {
        if (this._faultOpen) this._coilResistance = 10e6;
        else this._coilResistance = this.resistance;
    }

    _drawStaticParts() {
        const s = this.scale || 1;
        const W = this._W;
        const H = this._H;

        // 透明点击区域（拖拽支持）
        this._interactGroup.add(new Konva.Rect({
            x: -W / 2, y: -H / 2, width: W, height: H, fill: 'transparent',
        }));

        const box = new Konva.Rect({
            x: -W / 2, y: -H / 2, width: W, height: H,
            fill: '#95a5a6', stroke: '#7f8c8d', strokeWidth: 1.5,
            cornerRadius: 3, listening: false,
        });
        this._staticGroup.add(box);

        const ridgeY = [-H / 4, 0, H / 4];
        ridgeY.forEach(ry => {
            const ridge = new Konva.Line({
                points: [-W / 2 + 5, ry, W / 2 - 5, ry],
                stroke: '#7f8c8d', strokeWidth: 0.8, listening: false,
            });
            this._staticGroup.add(ridge);
        });

        const leadL = new Konva.Line({
            points: [-W / 2, 0, -W / 2 - 15 * s, 0],
            stroke: '#bdc3c7', strokeWidth: 2.5, lineCap: 'round', listening: false,
        });
        const leadR = new Konva.Line({
            points: [W / 2, 0, W / 2 + 15 * s, 0],
            stroke: '#bdc3c7', strokeWidth: 2.5, lineCap: 'round', listening: false,
        });

        const coilPath = new Konva.Path({
            data: 'M -30 5 A 7 7 0 0 1 -16 5 A 7 7 0 0 1 -2 5 A 7 7 0 0 1 12 5 A 7 7 0 0 1 26 5 A 7 7 0 0 1 40 5',
            stroke: '#2c3e50', strokeWidth: 2.5, lineCap: 'round', fill: null, listening: false,
        });
        this._staticGroup.add(coilPath);

        const coreTop = new Konva.Line({
            points: [-28, -8, 38, -8],
            stroke: '#2c3e50', strokeWidth: 3, lineCap: 'round', listening: false,
        });
        const coreBot = new Konva.Line({
            points: [-28, -4, 38, -4],
            stroke: '#2c3e50', strokeWidth: 1, lineCap: 'round', listening: false,
        });
        this._staticGroup.add(coreTop, coreBot);

        this._inductanceLabel = new Konva.Text({
            x: -35, y: 12, width: 70,
            text: this._formatInductance(this.inductance),
            fontSize: 11, fontStyle: 'bold', fontFamily: 'Arial',
            fill: '#2c3e50', align: 'center', listening: false,
        });
        this._staticGroup.add(this._inductanceLabel);
    }

    _formatInductance(h) {
        if (h >= 1) return h.toFixed(1) + 'H';
        if (h >= 1e-3) return (h * 1e3).toFixed(1) + 'mH';
        return h.toExponential(1) + 'H';
    }

    // 伴随模型已弃用，改用 stampRLSeries（电压源方程法）
    // 保留 getCompanionModel 供引擎兼容，返回零值
    getCompanionModel() { return { gEq: 0, iEq: 0 }; }
    updateState() {}
    calculatePhysicalCurrent() {}

    getConfigFields() {
        return [
            { label: '器件名称', key: 'id', type: 'text' },
            { label: '电感量 (H)', key: 'inductance', type: 'number' },
            { label: '内阻 (\u03a9)', key: 'resistance', type: 'number' },
        ];
    }

    onConfigUpdate(cfg) {
        if (cfg.id !== undefined) this.id = cfg.id;
        if (cfg.inductance !== undefined) { this.inductance = cfg.inductance; this._coilInductance = cfg.inductance; }
        if (cfg.resistance !== undefined) { this.resistance = cfg.resistance; this._coilResistance = cfg.resistance; }
        if (this._inductanceLabel) this._inductanceLabel.text(this._formatInductance(this.inductance));
        this.config = { ...this.config, ...cfg };
        this.markDirty();
        this._refreshIfDirty();
    }

    destroy() {
        super.destroy?.();
    }
}