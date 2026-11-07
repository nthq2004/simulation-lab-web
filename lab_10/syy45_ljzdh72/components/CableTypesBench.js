import { BaseComponent } from './BaseComponent.js';

/**
 * CableTypesBench — 三种常用线缆对比台（3D 立体效果）
 *
 * 平行摆放三种线缆，用于认识线缆结构、连接件，并「测试」其用途与特点：
 *   ① 双绞线网线（UTP）—— 两端压接 RJ45 水晶头
 *   ② 光纤（光缆）      —— 两端带 SC 插接头
 *   ③ 同轴电缆          —— 两端带 BNC 插接件
 *
 * 每根线缆中段带「剖面」，直观显示内部结构；点击线缆或连接件即在右侧
 * 信息面板显示其结构、特点、用途与测试结论。
 *
 * 3D 效果实现：全部使用线性渐变（fillLinearGradient*）+ 高光条 + 端面椭圆，
 * 不使用 shadowColor/shadowBlur/shadowOpacity 三件套（符合平台规范）。
 *
 * 无电气端口（纯识别与演示组件）。
 */

const CABLE_INFO = {
    utp: {
        name: '双绞线网线（UTP）',
        struct: '4 对双绞线 + 两端 RJ45 水晶头',
        feature: '两根导线相互绞合抵消电磁干扰；成本低、柔软易施工、可现场压接水晶头',
        use: '局域网／以太网布线（100M／1000M／2.5G）',
        test: '测线仪：8 芯 1→8 全通，线序正确 ✓\n标称 1000Mbps，单段最长 100m',
    },
    fiber: {
        name: '光纤（光缆）',
        struct: '纤芯 + 包层 + 涂覆层 + 加强件 + 外护套；两端 SC 插接头',
        feature: '以光信号传输：带宽极大、损耗极低、抗电磁干扰、传输距离远；不能过度弯折',
        use: '骨干网、数据中心、长距离与高带宽链路',
        test: '光功率计：收光功率 -3dBm，合格 ✓\n支持 10Gbps 以上，单模可达数十公里',
    },
    coax: {
        name: '同轴电缆',
        struct: '内导体 + 绝缘层 + 外导体（编织网）+ 外护套；两端 BNC 插接件',
        feature: '内外导体共轴，屏蔽性好、特性阻抗稳定（75Ω／50Ω）；线径较粗、成本较高',
        use: '有线电视、视频监控、射频与仪器信号传输',
        test: '阻抗／通断测试：特性阻抗 75Ω，屏蔽层连通 ✓\n适合射频与视频信号',
    },
};

export class CableTypesBench extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.width = Math.max(900, config.width || 1000);
        this.height = Math.max(560, config.height || 620);

        this.type = 'cable_types_bench';
        this.cache = 'fixed';

        this._initGroups();
        this._recalcGeometry();
        this._initParameters(config);
        this._init();

        this.config = { id: this.id, label: this.label };
    }

    // ═══════════════════════════════════════════
    // 几何与参数
    // ═══════════════════════════════════════════

    _recalcGeometry() {
        this._lanes = [
            { key: 'utp',   y: 170, h: 34, x1: 212, x2: 652, name: '① 双绞线网线', sub: 'UTP · RJ45 水晶头' },
            { key: 'fiber', y: 320, h: 18, x1: 212, x2: 652, name: '② 光纤（光缆）', sub: 'SC 插接头' },
            { key: 'coax',  y: 470, h: 28, x1: 212, x2: 652, name: '③ 同轴电缆', sub: 'BNC 插接件' },
        ];
        this._connW = 40;   // 连接件宽度
        this._info = { x: 716, y: 74, w: 268, h: 486 };
    }

    _initParameters(config) {
        this.label = (config && config.label) || '三种常用线缆对比台';
        this._selected = null;
        this._viewed = {};   // 记录已查看过的线缆
    }

    _lane(key) { return this._lanes.find(l => l.key === key); }

    // ═══════════════════════════════════════════
    // 绘制
    // ═══════════════════════════════════════════

    _init() {
        this._drawStaticParts();
        this._createDynamicNodes();
        this._bindInteraction();
        this._addHitArea();
        this._refreshDynamic();
    }

    _addHitArea() {
        if (this._hitRect) return;
        this._hitRect = new Konva.Rect({
            x: 0, y: 0, width: this.width, height: this.height,
            fill: '#ffffff', opacity: 0.002, listening: true,
        });
        this.group.add(this._hitRect);
        this._hitRect.moveToBottom();
    }

    /** 3D 圆柱体：竖向渐变的圆角条 + 顶部高光 */
    _cylinder(g, x, y, w, h, stops, radius) {
        const r = (radius === undefined) ? h / 2 : radius;
        g.add(new Konva.Rect({
            x, y, width: w, height: h, cornerRadius: r,
            fillLinearGradientStartPoint: { x: 0, y },
            fillLinearGradientEndPoint: { x: 0, y: y + h },
            fillLinearGradientColorStops: stops,
            stroke: '#00000022', strokeWidth: 1, listening: false,
        }));
        g.add(new Konva.Rect({
            x: x + Math.min(8, w * 0.05), y: y + h * 0.16,
            width: Math.max(4, w - Math.min(16, w * 0.1)), height: Math.max(2, h * 0.16),
            fill: 'rgba(255,255,255,0.5)', cornerRadius: 3, listening: false,
        }));
    }

    /** 3D 端面（椭圆） */
    _cap(g, cx, cy, rx, ry, stops) {
        g.add(new Konva.Ellipse({
            x: cx, y: cy, radiusX: rx, radiusY: ry,
            fillLinearGradientStartPoint: { x: 0, y: cy - ry },
            fillLinearGradientEndPoint: { x: 0, y: cy + ry },
            fillLinearGradientColorStops: stops,
            stroke: '#00000022', strokeWidth: 1, listening: false,
        }));
    }

    _drawStaticParts() {
        const s = this._staticGroup;

        // 底板
        s.add(new Konva.Rect({
            x: 0, y: 0, width: this.width, height: this.height,
            fill: '#f7f9fc', stroke: '#d8e0ea', strokeWidth: 1.5, cornerRadius: 10, listening: false,
        }));
        s.add(new Konva.Text({
            x: 24, y: 16, text: this.label, fontSize: 20, fontStyle: 'bold', fill: '#1f3a5f', listening: false,
        }));
        s.add(new Konva.Text({
            x: 24, y: 44, text: '点击线缆或连接件，查看结构、特点、用途与测试结论',
            fontSize: 12, fill: '#64748b', listening: false,
        }));

        // 信息面板
        const I = this._info;
        s.add(new Konva.Rect({
            x: I.x, y: I.y, width: I.w, height: I.h,
            fill: '#ffffff', stroke: '#e2e8f0', strokeWidth: 1.2, cornerRadius: 8, listening: false,
        }));
        s.add(new Konva.Text({
            x: I.x + 14, y: I.y + 12, text: '结构 · 特点 · 用途 · 测试',
            fontSize: 13, fontStyle: 'bold', fill: '#334155', listening: false,
        }));

        // 三条线缆
        this._lanes.forEach(l => this._drawCable(s, l));

        // 每条线缆的名称与连接件说明（左侧）
        this._lanes.forEach(l => {
            const cy = l.y + l.h / 2;
            s.add(new Konva.Text({
                x: 24, y: cy - 28, width: 138, text: l.name,
                fontSize: 15, fontStyle: 'bold', fill: '#1f3a5f', listening: false,
            }));
            s.add(new Konva.Text({
                x: 24, y: cy - 4, width: 138, text: l.sub,
                fontSize: 11, fill: '#64748b', listening: false,
            }));
            // 3D 置物台（线缆下方渐隐托板）
            s.add(new Konva.Rect({
                x: 168, y: cy + l.h / 2 + 14, width: 528, height: 10, cornerRadius: 5,
                fillLinearGradientStartPoint: { x: 168, y: 0 }, fillLinearGradientEndPoint: { x: 696, y: 0 },
                fillLinearGradientColorStops: [0, 'rgba(148,163,184,0.05)', 0.5, 'rgba(148,163,184,0.28)', 1, 'rgba(148,163,184,0.05)'],
                listening: false,
            }));
        });
    }

    _drawCable(s, l) {
        const y = l.y, h = l.h, cy = y + h / 2;
        const x1 = l.x1, x2 = l.x2;
        const len = x2 - x1;

        if (l.key === 'utp') {
            // 蓝色网线护套
            this._cylinder(s, x1, y, len, h, [0, '#8bb8e8', 0.35, '#4a86c8', 0.55, '#6ba0d8', 1, '#2c5f92']);
            this._cap(s, x1, cy, 5, h / 2, [0, '#8bb8e8', 1, '#2c5f92']);
            this._cap(s, x2, cy, 5, h / 2, [0, '#8bb8e8', 1, '#2c5f92']);
            // 中段半透明剖切窗
            const cxw = 396, cww = 72;
            s.add(new Konva.Rect({
                x: cxw, y: y + 2, width: cww, height: h - 4,
                fill: 'rgba(255,255,255,0.72)', cornerRadius: 4, listening: false,
            }));
            const pairCols = [['#E8A33D', '#FF7A00'], ['#69C24A', '#1E9E38'], ['#2F6FE0', '#7FA8F0'], ['#A9763C', '#7A4A22']];
            pairCols.forEach((pc, k) => {
                const by = y + 6 + k * ((h - 12) / 4);
                const pts = [];
                for (let t = 0; t <= 12; t++) {
                    const px = cxw + 3 + t * ((cww - 6) / 12);
                    pts.push(px, by + 2.2 * Math.sin(t * 0.9));
                }
                s.add(new Konva.Line({ points: pts, stroke: pc[0], strokeWidth: 1.8, listening: false }));
            });
            // 两端 RJ45 水晶头
            this._drawRJ45(s, x1 - this._connW, cy - 26, this._connW, 52, false);
            this._drawRJ45(s, x2, cy - 26, this._connW, 52, true);

        } else if (l.key === 'fiber') {
            // 黄色单模光缆护套
            this._cylinder(s, x1, y, len, h, [0, '#ffe08a', 0.35, '#f0c23a', 0.55, '#f6d35c', 1, '#b8892a']);
            this._cap(s, x1, cy, 4, h / 2, [0, '#ffe08a', 1, '#b8892a']);
            this._cap(s, x2, cy, 4, h / 2, [0, '#ffe08a', 1, '#b8892a']);
            // 中段剖面：纤芯/包层/涂覆
            this._section(s, 428, cy, [
                { r: 11, c: '#d6dfe8' }, { r: 8, c: '#ffffff' },
                { r: 5, c: '#f0c23a' }, { r: 2.4, c: '#4aa3ff' },
            ]);
            // 两端 SC 插接头
            this._drawSC(s, x1 - this._connW, cy, this._connW, false);
            this._drawSC(s, x2, cy, this._connW, true);

        } else {
            // 黑色同轴护套
            this._cylinder(s, x1, y, len, h, [0, '#6f7680', 0.35, '#3a4149', 0.55, '#525a63', 1, '#191d22']);
            this._cap(s, x1, cy, 5, h / 2, [0, '#6f7680', 1, '#191d22']);
            this._cap(s, x2, cy, 5, h / 2, [0, '#6f7680', 1, '#191d22']);
            // 中段剖面：内导体/绝缘/编织网/护套
            this._section(s, 426, cy, [
                { r: 14, c: '#252a30' }, { r: 10.5, c: '#9aa4ad' },
                { r: 7, c: '#f2f4f7' }, { r: 2.6, c: '#c0812a' },
            ]);
            // 两端 BNC 插接件
            this._drawBNC(s, x1 - this._connW, cy, this._connW, false);
            this._drawBNC(s, x2, cy, this._connW, true);
        }
    }

    /** 同轴/光纤剖面同心圆 */
    _section(s, cx, cy, layers) {
        s.add(new Konva.Circle({ x: cx, y: cy, radius: layers[0].r + 4, fill: '#eef2f7', stroke: '#cbd5e1', strokeWidth: 1, listening: false }));
        layers.forEach(ly => {
            s.add(new Konva.Circle({ x: cx, y: cy, radius: ly.r, fill: ly.c, stroke: '#00000022', strokeWidth: 0.8, listening: false }));
        });
    }

    /** RJ45 水晶头（3D 透明塑料 + 金脚） */
    _drawRJ45(s, x, y, w, h, flip) {
        s.add(new Konva.Rect({
            x, y, width: w, height: h, cornerRadius: 5,
            fillLinearGradientStartPoint: { x: 0, y },
            fillLinearGradientEndPoint: { x: 0, y: y + h },
            fillLinearGradientColorStops: [0, '#dbe9f7', 0.4, '#b9d4ec', 1, '#8fb4d6'],
            stroke: '#6d94b8', strokeWidth: 1.2, listening: false,
        }));
        // 卡扣
        s.add(new Konva.Rect({
            x: x + w / 2 - 5, y: flip ? y + h : y - 10, width: 10, height: 10,
            fill: '#cfe0f0', stroke: '#6d94b8', strokeWidth: 1, cornerRadius: 2, listening: false,
        }));
        // 金脚（朝向线缆一侧）
        const px = flip ? x + w - 14 : x + 4;
        for (let i = 0; i < 6; i++) {
            s.add(new Konva.Rect({
                x: px, y: y + 7 + i * 6.4, width: 10, height: 3.4,
                fill: '#d4af37', stroke: '#8a6d13', strokeWidth: 0.6, cornerRadius: 1, listening: false,
            }));
        }
    }

    /** 光纤 SC 插接头（蓝色方口 + 白色陶瓷插芯） */
    _drawSC(s, x, cy, w, flip) {
        const h = 34, y = cy - h / 2;
        // 尾套
        s.add(new Konva.Rect({
            x: flip ? x : x + w - 14, y: cy - 6, width: 14, height: 12, cornerRadius: 3,
            fillLinearGradientStartPoint: { x: 0, y: cy - 6 }, fillLinearGradientEndPoint: { x: 0, y: cy + 6 },
            fillLinearGradientColorStops: [0, '#ffe08a', 1, '#b8892a'], stroke: '#8a6d13', strokeWidth: 1, listening: false,
        }));
        // 蓝色主体
        s.add(new Konva.Rect({
            x, y, width: w, height: h, cornerRadius: 4,
            fillLinearGradientStartPoint: { x: 0, y },
            fillLinearGradientEndPoint: { x: 0, y: y + h },
            fillLinearGradientColorStops: [0, '#7fb6ea', 0.4, '#2f6fe0', 1, '#1b4aa0'],
            stroke: '#123a80', strokeWidth: 1.2, listening: false,
        }));
        // 陶瓷插芯（2.5mm）
        s.add(new Konva.Rect({
            x: flip ? x - 8 : x + w, y: cy - 3.5, width: 8, height: 7, cornerRadius: 2,
            fill: '#f2f4f7', stroke: '#9aa4ad', strokeWidth: 1, listening: false,
        }));
    }

    /** 同轴 BNC 插接件（金属滚花 + 中心针） */
    _drawBNC(s, x, cy, w, flip) {
        const h = 30, y = cy - h / 2;
        // 金属本体
        s.add(new Konva.Rect({
            x, y, width: w, height: h, cornerRadius: 4,
            fillLinearGradientStartPoint: { x: 0, y },
            fillLinearGradientEndPoint: { x: 0, y: y + h },
            fillLinearGradientColorStops: [0, '#e8edf2', 0.4, '#a9b4bd', 0.6, '#c4cdd5', 1, '#6f7a84'],
            stroke: '#5b6670', strokeWidth: 1.2, listening: false,
        }));
        // 滚花
        for (let i = 0; i < 5; i++) {
            s.add(new Konva.Line({
                points: [x + 7 + i * 6, y + 2, x + 7 + i * 6, y + h - 2],
                stroke: '#7c8791', strokeWidth: 1, listening: false,
            }));
        }
        // 中心针 + 绝缘
        s.add(new Konva.Circle({ x: flip ? x - 3 : x + w + 3, y: cy, radius: 6, fill: '#f2f4f7', stroke: '#9aa4ad', strokeWidth: 1, listening: false }));
        s.add(new Konva.Circle({ x: flip ? x - 3 : x + w + 3, y: cy, radius: 2.6, fill: '#c0812a', stroke: '#8a5522', strokeWidth: 0.8, listening: false }));
    }

    _createDynamicNodes() {
        const d = this._dynamicGroup;

        // 选中高亮框
        this._selRect = new Konva.Rect({
            x: 168, y: 0, width: 528, height: 112,
            stroke: '#0ea5e9', strokeWidth: 2.5, dash: [8, 5], cornerRadius: 10, visible: false, listening: false,
        });
        d.add(this._selRect);

        // 信息面板内容
        const I = this._info;
        this._infoTitle = new Konva.Text({
            x: I.x + 14, y: I.y + 40, width: I.w - 28,
            text: '请点击一种线缆', fontSize: 15, fontStyle: 'bold', fill: '#0f766e', listening: false,
        });
        this._infoBody = new Konva.Text({
            x: I.x + 14, y: I.y + 70, width: I.w - 28, height: I.h - 90,
            text: '', fontSize: 12, lineHeight: 1.5, fill: '#334155',
            wrap: 'word', listening: false,
        });
        d.add(this._infoTitle, this._infoBody);
    }

    _bindInteraction() {
        this._lanes.forEach(l => {
            const y = l.y, h = l.h;
            // 线缆本体
            this.addClickablePart('cable-' + l.key, l.x1, y - 6, l.x2 - l.x1, h + 12)
                .on('click tap', () => this.selectCable(l.key));
            // 两端连接件
            const connName = l.key === 'utp' ? 'rj45' : (l.key === 'fiber' ? 'fiber' : 'coax');
            const connH = l.key === 'utp' ? 60 : (l.key === 'fiber' ? 44 : 38);
            this.addClickablePart(connName + '-left', l.x1 - this._connW - 10, l.y + h / 2 - connH / 2, this._connW + 14, connH)
                .on('click tap', () => this.selectCable(l.key));
            this.addClickablePart(connName + '-right', l.x2 - 4, l.y + h / 2 - connH / 2, this._connW + 14, connH)
                .on('click tap', () => this.selectCable(l.key));
        });
    }

    // ═══════════════════════════════════════════
    // 选择 / 测试
    // ═══════════════════════════════════════════

    selectCable(key) {
        if (!CABLE_INFO[key]) return false;
        this._selected = key;
        this._viewed[key] = true;
        this._refreshDynamic();
        this._render();
        this._tip(`已选择${CABLE_INFO[key].name}`);
        return true;
    }

    getSelected() { return this._selected; }
    hasViewed(key) { return !!this._viewed[key]; }
    getInfo(key) { return CABLE_INFO[key]; }
    getTestResult(key) { return CABLE_INFO[key] ? CABLE_INFO[key].test : ''; }

    _refreshDynamic() {
        if (!this._selRect) return;
        const l = this._lane(this._selected);
        if (l) {
            this._selRect.y(l.y - 42);
            this._selRect.visible(true);
        } else {
            this._selRect.visible(false);
        }

        if (l) {
            const info = CABLE_INFO[l.key];
            this._infoTitle.text(info.name);
            this._infoBody.text(
                `【结构】\n${info.struct}\n\n` +
                `【特点】\n${info.feature}\n\n` +
                `【用途】\n${info.use}\n\n` +
                `【测试结论】\n${info.test}`
            );
        } else {
            this._infoTitle.text('请点击一种线缆');
            this._infoBody.text('');
        }
    }

    _render() {
        if (!this.sys) return;
        if (this.sys.layer) {
            try { this.sys.layer.draw(); }
            catch (e) { if (typeof this.sys.layer.batchDraw === 'function') this.sys.layer.batchDraw(); }
        }
        if (typeof this.sys.requestRedraw === 'function') this.sys.requestRedraw();
    }

    _tip(msg) {
        if (this.sys && typeof this.sys.showFloatingTip === 'function') this.sys.showFloatingTip(msg, 2400);
    }

    getClickablePartCenter(partId) {
        const p = this._parts && this._parts[partId];
        if (!p) return null;
        const local = { x: p.x + p.w / 2, y: p.y + p.h / 2 };
        try {
            if (this.group && this.group.getAbsoluteTransform) {
                const pt = this.group.getAbsoluteTransform().point(local);
                return { x: pt.x, y: pt.y };
            }
        } catch (e) { /* fallthrough */ }
        const abs = this.group && this.group.getAbsolutePosition ? this.group.getAbsolutePosition() : { x: 0, y: 0 };
        return { x: abs.x + local.x, y: abs.y + local.y };
    }

    getConfigFields() {
        return [{ label: '器件名称', key: 'label', type: 'text' }];
    }

    onConfigUpdate(cfg) {
        if (cfg.label !== undefined) this.label = cfg.label;
        this.config = { id: this.id, label: this.label };
        this._render();
    }
}
