import { BaseComponent } from './BaseComponent.js';

// 船舶主配电板三相汇流排组件：
// 三根扁铜条平行排列（L1绿 / L2黄 / L3褐），每根铜条上均匀分布若干电气端口，
// 同一相位上的所有端口在电路求解器中通过 CircuitTopology.internalUnion 短接为同一节点。
// 组件无外框，仅由三根扁铜条与端口组成。
export class Busbar3P extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        // 端口数决定宽度：每端口基准步长 baseStep（默认 160px），
        // 端口数 8 时宽度 = 8×160 = 1280（历史基准），4 口即减半为 640。
        this._portsPerBar = Math.max(2, Math.min(16, parseInt(config.portsPerBar) || 8));
        this._baseStep    = Math.max(90, parseFloat(config.baseStep) || 160);
        this.width        = this._baseStep * this._portsPerBar;
        this.height       = Math.max(92, config.height || 92);

        this.type  = 'busbar_3p';
        this.cache = 'fixed';

        this._initGroups();
        this._recalcGeometry();
        this._initParameters(config);
        this._init();

        this.config = {
            id: this.id,
            width:        this.width,
            portsPerBar:  this._portsPerBar,
            baseStep:     this._baseStep,
        };

        this._rebuildPorts();
    }

    _recalcGeometry() {
        const W = this.width;
        const barH = 16, gap = 22;

        this._barH = barH;
        this._barCy = [
            barH / 2,
            barH / 2 + (barH + gap),
            barH / 2 + 2 * (barH + gap),
        ];

        this._edgePad = Math.min(40, W * 0.09);
        this._spacing = (W - 2 * this._edgePad) / this._portsPerBar;

        this._portX = [];
        for (let j = 0; j < 3; j++) {
            const off = j * this._spacing / 3;
            const arr = [];
            for (let i = 0; i < this._portsPerBar; i++) {
                arr.push(this._edgePad + this._spacing * i + off);
            }
            this._portX.push(arr);
        }
    }

    _initParameters(config) {
        this._portsPerBar = Math.max(2, Math.min(16, parseInt(config.portsPerBar) || 8));
    }

    _init() {
        this._drawStaticParts();
    }

    _drawStaticParts() {
        const W = this.width;
        const barH = this._barH;
        this._barRects = [];

        const colors = [
            { fill: '#3a9e46', stroke: '#245a2a', hl: '#3cf858' },
            { fill: '#e3b12e', stroke: '#8a6a14', hl: '#f5e03a' },
            { fill: '#8b5a2b', stroke: '#4e3217', hl: '#c003fe' },
        ];

        for (let j = 0; j < 3; j++) {
            const cy = this._barCy[j];
            const c = colors[j];
            const bar = new Konva.Rect({
                x: 0, y: cy - barH / 2,
                width: W, height: barH,
                fill: c.fill, stroke: c.stroke, strokeWidth: 1, cornerRadius: 3,
            });
            this._staticGroup.add(bar);
            this._barRects.push(bar);
            this._staticGroup.add(new Konva.Rect({
                x: 0, y: cy - barH / 2 + 2,
                width: W, height: 2,
                fill: c.hl, opacity: 0.55,
            }));
        }
    }

    _rebuildPorts() {
        this.ports.forEach(p => {
            if (p.node && typeof p.node.destroy === 'function') p.node.destroy();
        });
        this.ports = [];

        for (let j = 1; j <= 3; j++) {
            for (let i = 1; i <= this._portsPerBar; i++) {
                this.addPort(this._portX[j - 1][i - 1], this._barCy[j - 1], `l${j}_${i}`, 'wire', j === 1 ? 'p' : null);
            }
        }
    }

    getPortId(phase, idx) {
        return `${this.id}_wire_l${phase}_${idx}`;
    }

    getConfigFields() {
        return [
            { label: '端口数量/根', key: 'portsPerBar', type: 'number', min: 2, max: 16, step: 1 },
            { label: '每端口宽度 (px)', key: 'baseStep', type: 'number', min: 90, step: 10 },
        ];
    }

    onConfigUpdate(cfg) {
        if (cfg.baseStep !== undefined) {
            this._baseStep = Math.max(90, parseFloat(cfg.baseStep) || 160);
        }
        if (cfg.portsPerBar !== undefined) {
            this._portsPerBar = Math.max(2, Math.min(16, parseInt(cfg.portsPerBar) || 8));
        }
        // 宽度随端口数/步长自适应：width = baseStep × portsPerBar
        this.width = this._baseStep * this._portsPerBar;
        this.config = { ...this.config, ...cfg };

        this._recalcGeometry();
        this._barRects.forEach(r => r.width(this.width));
        this._rebuildPorts();
        this.markDirty();
        this._refreshIfDirty();
        if (this.sys && typeof this.sys.requestRedraw === 'function') this.sys.requestRedraw();
    }
}
