import { BaseComponent } from './BaseComponent.js';

/**
 * 汇流排（3 相 · 8 抽头仿真组件）
 *
 * 概述：三根长扁铜条分别对应 L1（红）、L2（绿）、L3（蓝）三相，
 * 每根铜条等距分布 8 个电气接口（接线端子）。同一铜条上的全部接口
 * 在拓扑层面由 CircuitTopology 通过 union 合并为同一节点簇（等电位），
 * 模拟实际汇流排"一根铜排就是一个节点"的物理特性。
 *
 * 三相接口横向错开一定距离（L1 偏右、L2 居中、L3 偏左），
 * 便于外部出线互不遮挡。
 *
 * 端口命名：{id}_wire_{l1|l2|l3}_{0..7}
 *
 * 可配置参数：
 *  - taps: 每相接口数量（默认 8）
 *  - stagger: 三相接口错开距离（默认 12px）
 */
export class Busbar3P extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.width  = Math.max(360, config.width  || 640);
        this.height = Math.max(120, config.height || 210);

        this.type  = 'busbar_3p';
        this.cache = 'fixed';

        this._tapsPerPhase = config.taps !== undefined ? config.taps : 8;
        this._stagger      = config.stagger !== undefined ? config.stagger : 12;

        this._phases = [
            { id: 'l1', name: 'L1', color: '#e03030', dark: '#8a1a1a', yRatio: 0.22 },
            { id: 'l2', name: 'L2', color: '#20a030', dark: '#0f6a1c', yRatio: 0.50 },
            { id: 'l3', name: 'L3', color: '#2050e0', dark: '#12308a', yRatio: 0.78 },
        ];

        this._initGroups();
        this._recalcGeometry();
        this._drawStaticParts();

        this._phases.forEach((ph, pi) => {
            for (let k = 0; k < this._tapsPerPhase; k++) {
                const x = this._tapXs[ph.id][k];
                this.addPort(x, this._barYs[pi], `${ph.id}_${k}`, 'wire');
            }
        });
    }

    _recalcGeometry() {
        const W = this.width, H = this.height;

        this._barH = Math.max(10, H * 0.07);
        this._barYs = this._phases.map(ph => H * ph.yRatio);

        const padX = Math.max(40, W * 0.07);
        const usable = W - padX * 2;
        const spacing = usable / Math.max(1, this._tapsPerPhase - 1);

        this._tapXs = {};
        this._phases.forEach(ph => {
            const dx = ph.id === 'l1' ? this._stagger : (ph.id === 'l3' ? -this._stagger : 0);
            const xs = [];
            for (let k = 0; k < this._tapsPerPhase; k++) {
                xs.push(padX + k * spacing + dx);
            }
            this._tapXs[ph.id] = xs;
        });
    }

    _drawStaticParts() {
        // 背景底板
        this._staticGroup.add(new Konva.Rect({
            x: 2, y: 2, width: this.width - 4, height: this.height - 4,
            fill: '#e8edf2', stroke: '#9aa8b8', strokeWidth: 1, cornerRadius: 6,
        }));
        // 标题
        this._staticGroup.add(new Konva.Text({
            x: 8, y: 4, text: '汇流排 BUS', fontSize: 12,
            fontStyle: 'bold', fill: '#38506a',
        }));

        this._phases.forEach((ph, pi) => {
            const y = this._barYs[pi];
            const x0 = Math.min(...this._tapXs[ph.id]) - 26;
            const x1 = Math.max(...this._tapXs[ph.id]) + 26;
            const w = x1 - x0;

            // 扁铜条主体
            this._staticGroup.add(new Konva.Rect({
                x: x0, y: y - this._barH / 2, width: w, height: this._barH,
                fillLinearGradientStartPoint: { x: x0, y: 0 },
                fillLinearGradientEndPoint: { x: x1, y: 0 },
                fillLinearGradientColorStops: [0, ph.dark, 0.5, ph.color, 1, ph.dark],
                stroke: ph.dark, strokeWidth: 1, cornerRadius: 3,
            }));
            // 铜条高光
            this._staticGroup.add(new Konva.Rect({
                x: x0 + 2, y: y - this._barH / 2 + 1,
                width: w - 4, height: this._barH * 0.35,
                fill: 'rgba(255,255,255,0.30)', cornerRadius: 2,
            }));
            // 相名标签
            this._staticGroup.add(new Konva.Text({
                x: x0 - 34, y: y - 7, text: ph.name, fontSize: 13,
                fontStyle: 'bold', fill: ph.color,
            }));
            // 相色标识块
            this._staticGroup.add(new Konva.Rect({
                x: x0 - 26, y: y - this._barH / 2 - 3,
                width: 10, height: this._barH + 6,
                fill: ph.color, stroke: ph.dark, strokeWidth: 0.8, cornerRadius: 2,
            }));

            // 接线端子底座（相色圆环，addPort 圆点叠加其上）
            this._tapXs[ph.id].forEach(x => {
                this._staticGroup.add(new Konva.Circle({
                    x, y, radius: 8,
                    fill: '#f0f2f4', stroke: ph.dark, strokeWidth: 1.4,
                }));
                this._staticGroup.add(new Konva.Circle({
                    x, y, radius: 3, fill: ph.dark,
                }));
            });
        });
    }

    getConfigFields() {
        return [
            { label: '每相接口数量', key: 'taps', type: 'number', min: 2, max: 16, step: 1 },
            { label: '接口错开距离 (px)', key: 'stagger', type: 'number', min: 0, max: 60, step: 1 },
        ];
    }

    onConfigUpdate(cfg) {
        if (cfg.taps !== undefined) this._tapsPerPhase = Math.max(2, Math.min(16, parseInt(cfg.taps) || 8));
        if (cfg.stagger !== undefined) this._stagger = parseFloat(cfg.stagger) || 12;
        this.config = { ...this.config, ...cfg };
        this._recalcGeometry();
        this._staticGroup.destroyChildren();
        this._drawStaticParts();
        this._refreshCache();
    }

    destroy() {
        super.destroy?.();
    }
}
