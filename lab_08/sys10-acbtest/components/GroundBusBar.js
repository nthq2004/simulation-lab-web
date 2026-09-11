import { BaseComponent } from './BaseComponent.js';

/**
 * GroundBusBar 接地母排组件
 *
 * 说明：
 * - 一条水平黄铜/镀锡扁母排，上面并排 4 个接线柱（PE1~PE4）。
 * - 母排左端画有接地符号，代表整个母排电气上是接地的（参考地 0V）。
 * - 4 个接线柱在电路求解器中通过 CircuitTopology 内部短接为同一节点（同簇），
 *   且该节点被 CircuitSolver 视为接地参考（0V）。
 * - 缓存：静态图形，设置 `cache='fixed'` 以减少重绘开销。
 */

// 尺寸常量
const DEFAULT_W = 200;   // 组件整体宽度
const DEFAULT_H = 74;    // 组件整体高度（含接地符号）
const BAR_Y = 16;        // 母排顶边 y
const BAR_H = 14;        // 母排高度
const BAR_CY = BAR_Y + BAR_H / 2;     // 母排中线 y
const TERM_W = 9;        // 接线柱头半径

export class GroundBusBar extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        // 端子数量（默认 4），驱动母排宽度自适应
        this._termCount = Math.max(2, Math.min(8, parseInt(config.termCount) || 4));
        this._termSpacing = config.termSpacing || 44;
        this.width  = Math.max(90, config.width || (this._termCount * this._termSpacing + 28));
        this.height = Math.max(60, config.height || DEFAULT_H);

        this.type  = 'ground_bus';
        this.cache = 'fixed';

        this._initGroups();
        this._recalcGeometry();
        this._initParameters(config);
        this._init();

        this.config = {
            id: this.id,
            width: this.width,
            termCount: this._termCount,
        };

        this._addPorts();
        this._setupDynamicWire();
    }

    /**
     * 查找本母排与其他组件之间的"活动黄绿相间导线"连接：
     * 在 sys.conns 中找与第 2 端子（pe2）相连的 wire（标记为 custom 的自绘导线），
     * 记录目标端口，并在 _dynamicGroup 中创建黄绿相间线段。
     */
    _setupDynamicWire() {
        this._wireSegs = [];
        this._targetCompId = null;
        this._targetPortId = null;
        this._peerPortId = this.getTermPortId(2);
        if (!this.sys || !this.sys.conns) return;

        const peer = this._peerPortId;
        const conn = this.sys.conns.find(c => c.type === 'wire' && c.custom &&
            (c.from === peer || c.to === peer));
        if (!conn) return;

        this._targetPortId = conn.from === peer ? conn.to : conn.from;
        this._targetCompId = (this._targetPortId.split('_wire_')[0] || this._targetPortId.split('_')[0]);

        // 预建固定数量黄绿相间线段（沿直线均分），轻量随帧更新
        const N = 14;
        for (let i = 0; i < N; i++) {
            const isYellow = i % 2 === 0;
            const seg = new Konva.Line({
                points: [0, 0, 0, 0],
                stroke: isYellow ? '#f4c542' : '#20a030',
                strokeWidth: 6,
                lineCap: 'round',
                listening: false,
            });
            this._dynamicGroup.add(seg);
            this._wireSegs.push(seg);
        }
    }

    /**
     * 每帧刷新活动黄绿相间导线：读取两端端口的绝对坐标，换算为母排本地坐标，
     * 沿直线均分给各黄绿线段，实现组件拖拽时导线自动重绘。
     */
    tick(dt) {
        // 懒初始化：连接尚未建立时每帧重试（组件构造早于连线创建）
        if ((!this._wireSegs || this._wireSegs.length === 0)
            && this.sys && this.sys.conns && this.sys.conns.length) {
            this._setupDynamicWire();
        }
        if (!this._wireSegs || this._wireSegs.length === 0) return;
        const sys = this.sys;
        if (!sys || !sys.comps) return;
        const target = sys.comps[this._targetCompId];
        if (!target || typeof target.getAbsPortPos !== 'function') return;

        const p1 = this.getAbsPortPos(this._peerPortId);          // 本母排 pe2（世界）
        const p2 = target.getAbsPortPos(this._targetPortId);      // 目标端口（世界）
        if (!p1 || !p2) return;

        // 世界坐标 → 母排本地坐标（含位移/缩放/旋转逆变换）
        let inv = null;
        try { inv = this.group.getAbsoluteTransform().copy().invert(); } catch (e) { return; }
        const s = inv.point({ x: p1.x, y: p1.y });
        const e = inv.point({ x: p2.x, y: p2.y });

        const N = this._wireSegs.length;
        const dx = e.x - s.x, dy = e.y - s.y;
        for (let i = 0; i < N; i++) {
            const t0 = i / N, t1 = (i + 1) / N;
            const seg = this._wireSegs[i];
            // 每段略向外延伸一点避免段间露缝
            seg.points([
                s.x + dx * t0, s.y + dy * t0,
                s.x + dx * t1, s.y + dy * t1,
            ]);
        }
        if (sys.requestRedraw) sys.requestRedraw();
    }


    _recalcGeometry() {
        // 母排：从左侧接地符号内侧起，延伸到覆盖全部端子
        const padL = 26;   // 左端留给接地符号/线头
        const padR = 14;
        this._barW = Math.max(60, this.width - padL - padR);
        this._barX = padL;

        // 端子 x：在母排范围内均匀分布
        this._termXs = [];
        for (let i = 0; i < this._termCount; i++) {
            if (this._termCount === 1) {
                this._termXs.push(this._barX + this._barW / 2);
            } else {
                this._termXs.push(
                    this._barX + (this._barW / (this._termCount - 1)) * i
                );
            }
        }
    }

    _initParameters(config) {
        this._termCount = Math.max(2, Math.min(8, parseInt(config.termCount) || 4));
    }

    _init() {
        this._drawStaticParts();
        this._addClickableParts();
    }

    _addPorts() {
        for (let i = 1; i <= this._termCount; i++) {
            this.addPort(this._termXs[i - 1], BAR_CY, `pe${i}`, 'wire');
        }
    }

    // ══════════════════════════════════════════════
    // 可点击部件（供工作流 find 步骤识别）
    // ══════════════════════════════════════════════

    _addClickableParts() {
        // 母排本体（接地排）
        this.addClickablePart('term-bus', this._barX, BAR_Y, this._barW, BAR_H);
        // 各接线柱（PE1~PEn）
        this._termXs.forEach((tx, i) => {
            this.addClickablePart(`term-n${i + 1}`, tx - TERM_W - 4, BAR_CY - TERM_W - 4, (TERM_W + 4) * 2, (TERM_W + 4) * 2);
        });
        // 左端接地符号
        this.addClickablePart('symbol', this._barX - 24, 20, 34, 40);
    }

    getClickablePartCenter(partId) {
        const gx = this.group ? this.group.x() : 0;
        const gy = this.group ? this.group.y() : 0;
        const lit = /^term-n(\d+)$/.exec(partId);
        if (lit) {
            const idx = parseInt(lit[1]) - 1;
            if (this._termXs[idx] !== undefined) {
                return { x: gx + this._termXs[idx], y: gy + BAR_CY };
            }
        }
        const rel = {
            'term-bus': { x: this._barX + this._barW / 2, y: BAR_CY },
            'symbol': { x: this._barX, y: 34 },
        };
        const p = rel[partId];
        return p ? { x: gx + p.x, y: gy + p.y } : null;
    }

    /**
     * 端子数量（供 CircuitTopology 静态遍历端口用）
     */
    getTermCount() {
        return this._termCount;
    }

    /**
     * 接地参考端口 ID（供 CircuitSolver 识别整条母排为地）
     */
    getGroundPortId() {
        return `${this.id}_wire_pe1`;
    }

    /**
     * 第 n 个端子（1 起）的完整端口 ID
     */
    getTermPortId(n) {
        return `${this.id}_wire_pe${n}`;
    }

    _drawStaticParts() {
        const s = this._staticGroup;

        // ── 母排（黄铜扁条）──
        const bar = new Konva.Rect({
            x: this._barX, y: BAR_Y, width: this._barW, height: BAR_H,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint: { x: 0, y: BAR_H },
            fillLinearGradientColorStops: [0, '#f4c542', 0.5, '#d9a327', 1, '#b8862a'],
            stroke: '#8a6a14', strokeWidth: 1, cornerRadius: 2,
        });
        s.add(bar);
        // 母排顶部高光
        s.add(new Konva.Rect({
            x: this._barX, y: BAR_Y, width: this._barW, height: 2.5,
            fill: 'rgba(255,255,255,0.5)', cornerRadius: 2, listening: false,
        }));

        // ── 4 个接线柱（螺丝头 + 接线孔）──
        this._termXs.forEach((tx, i) => {
            this._drawTerminal(s, tx, BAR_CY, `PE${i + 1}`);
        });

        // ── 左端接地符号 ──
        this._drawGroundSymbol(s);

        // 母排文字标签
        s.add(new Konva.Text({
            x: this._barX + this._barW / 2 - 40, y: BAR_Y + BAR_H + 2, width: 80, align: 'center',
            text: 'PE 接地母排', fontSize: 10, fontStyle: 'bold', fill: '#3a5a2a',
        }));
    }

    _drawTerminal(s, tx, ty, label) {
        // 螺丝头（金色圆台）
        s.add(new Konva.Circle({
            x: tx, y: ty, radius: TERM_W,
            fillLinearGradientStartPoint: { x: -TERM_W, y: -TERM_W },
            fillLinearGradientEndPoint: { x: TERM_W, y: TERM_W },
            fillLinearGradientColorStops: [0, '#8a7a30', 0.4, '#d4aa52', 0.7, '#e8c86a', 1, '#8a7030'],
            stroke: '#6a5a28', strokeWidth: 1, listening: false,
        }));
        // 螺丝十字槽
        s.add(new Konva.Line({ points: [tx - 4, ty - 4, tx + 4, ty + 4], stroke: '#5a4a20', strokeWidth: 1, listening: false }));
        s.add(new Konva.Line({ points: [tx - 4, ty + 4, tx + 4, ty - 4], stroke: '#5a4a20', strokeWidth: 1, listening: false }));
        // 接线孔（下方）
        s.add(new Konva.Circle({ x: tx, y: ty + 2, radius: 3.4, fill: '#3c4a30', stroke: '#2c3820', strokeWidth: 0.8, listening: false }));
        // 端子标签
        s.add(new Konva.Text({
            x: tx - 16, y: BAR_Y - BAR_H / 2 - 18, width: 32, align: 'center',
            text: label, fontSize: 10, fontStyle: 'bold', fill: '#4a4a4a', listening: false,
        }));
    }

    _drawGroundSymbol(s) {
        // 从母排左端向下引一条竖线，再连三条由长到短的横线（接地符号，悬挂在母排下方）
        const x0 = this._barX + 2;
        const yTop = BAR_CY;
        const yBase = 44;                 // 最上一条接地横线 y
        const stroke = '#202020';
        // 竖线：母排行中线下垂到第一条接地横线
        s.add(new Konva.Line({
            points: [x0, yTop, x0, yBase], stroke, strokeWidth: 2.5, listening: false,
        }));
        // 三条由长到短的横线
        s.add(new Konva.Line({ points: [x0 - 15, yBase, x0 + 15, yBase], stroke, strokeWidth: 4, listening: false }));
        s.add(new Konva.Line({ points: [x0 - 10, yBase + 7, x0 + 10, yBase + 7], stroke, strokeWidth: 4, listening: false }));
        s.add(new Konva.Line({ points: [x0 - 5, yBase + 14, x0 + 5, yBase + 14], stroke, strokeWidth: 4, listening: false }));
    }

    getConfigFields() {
        return [
            { label: '端子数量', key: 'termCount', type: 'number', min: 2, max: 8, step: 1 },
            { label: '组件宽度 (px)', key: 'width', type: 'number', min: 90, step: 10 },
        ];
    }

    onConfigUpdate(cfg) {
        if (cfg.termCount !== undefined) {
            this._termCount = Math.max(2, Math.min(8, parseInt(cfg.termCount) || 4));
        }
        if (cfg.width !== undefined) {
            this.width = Math.max(90, parseFloat(cfg.width) || this.width);
        }
        this.config = { ...this.config, ...cfg };

        this._recalcGeometry();
        this.markDirty();
        this._refreshIfDirty();
        if (this.sys && typeof this.sys.requestRedraw === 'function') this.sys.requestRedraw();
    }
}
