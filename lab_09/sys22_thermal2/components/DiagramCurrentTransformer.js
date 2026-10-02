// 电流互感器（简化原理图 / Diagram 版）
//
// 电气模型完全继承 CurrentTransformer：type='current_transformer'、
// special='CURRENT_TRANSFORMER'、端口 s1/s2/p1/p2、参数 turnsRatio/primaryRated/
// secondaryRated、回读字段 physCurrent/I_secondary/_prevIPrimary 等均与原型一致，
// 求解器（DeviceStamps.stampCurrentTransformers / CircuitSolver）无需任何改动。
//
// 本类只重写"界面绘制"：横置原理图，左侧原边（少而粗，3 匝）、右侧副边（多而细，8 匝）。

import { CurrentTransformer } from './CurrentTransformer.js';

export class DiagramCurrentTransformer extends CurrentTransformer {
    // 简化尺寸（横置；宽度仅为原型的一半，引线缩短，铁芯与绕组不变）
    static minWidth      = 120;
    static minHeight     = 90;
    static defaultWidth  = 120;
    static defaultHeight = 120;

    // ── 几何：横置，左原边 / 右副边 ──
    _recalcGeometry() {
        const W = this.width, H = this.height;
        this._frame = { x: 1, y: 1, w: W - 2, h: H - 2, rx: 6 };

        // 铁芯：口字型空心框，原边绕左柱、副边绕右柱
        const coreW = 70;
        this._core = {
            cx: W / 2, cy: H / 2, w: coreW, h: H - 40,
            x: W / 2 - coreW / 2, y: 20,
        };
        // 绕组的竖直范围
        this._wTop = this._core.y + 8;
        this._wBot = this._core.y + this._core.h - 8;

        // 端口：左侧原边 P1/P2，右侧副边 S1/S2
        this._portP1 = { x: 2, y: this._wTop };
        this._portP2 = { x: 2, y: this._wBot };
        this._portS1 = { x: W - 2, y: this._wTop };
        this._portS2 = { x: W - 2, y: this._wBot };
    }

    _loadImage() { /* 简化版不加载实物照片 */ }

    _init() {
        // 去掉背景框
        this._drawCoreRect();
        this._drawWindings();
        this._drawLeads();
        this._drawPortLabels();
        this._createDynamicNodes();
    }

    _drawBorder() {
        const f = this._frame;
        this._staticGroup.add(new Konva.Rect({
            x: f.x, y: f.y, width: f.w, height: f.h,
            cornerRadius: f.rx, stroke: '#bbb', strokeWidth: 1, fill: '#fff',
        }));
    }

    _drawCoreRect() {
        const c = this._core;
        // 口字型铁芯框（空心矩形，左右两柱即原/副边绕组所绕的铁芯柱）
        this._staticGroup.add(new Konva.Rect({
            x: c.x, y: c.y, width: c.w, height: c.h,
            stroke: '#555', strokeWidth: 3, fillEnabled: false,
        }));
    }

    // 生成一串半圆（绕组）的路径数据；convexLeft=true 时凸向左
    _windingPath(x, convexLeft, turns, r) {
        const top = this._wTop, bot = this._wBot;
        const sp = (bot - top) / turns;
        let d = '';
        for (let i = 0; i < turns; i++) {
            const yA = top + sp * i, yB = yA + sp;
            const dx = convexLeft ? -2 * r : 2 * r;
            d += `M ${x} ${yA} Q ${x + dx} ${(yA + yB) / 2} ${x} ${yB} `;
        }
        return d;
    }

    _drawWindings() {
        const c = this._core;
        // 原边（左）：少而粗 —— 3 匝
        this._staticGroup.add(new Konva.Path({
            data: this._windingPath(c.x, true, 3, 11),
            stroke: '#c0392b', strokeWidth: 5, lineCap: 'round', fillEnabled: false,
        }));
        // 副边（右）：多而细 —— 8 匝
        this._staticGroup.add(new Konva.Path({
            data: this._windingPath(c.x + c.w, false, 8, 9),
            stroke: '#2471a3', strokeWidth: 1.4, lineCap: 'round', fillEnabled: false,
        }));
    }

    _drawLeads() {
        const c = this._core;
        const line = (x1, y1, x2, y2, color) => this._staticGroup.add(new Konva.Line({
            points: [x1, y1, x2, y2], stroke: color, strokeWidth: 1.6,
        }));
        line(this._portP1.x, this._portP1.y, c.x, this._portP1.y, '#c0392b');
        line(this._portP2.x, this._portP2.y, c.x, this._portP2.y, '#c0392b');
        line(this._portS1.x, this._portS1.y, c.x + c.w, this._portS1.y, '#2471a3');
        line(this._portS2.x, this._portS2.y, c.x + c.w, this._portS2.y, '#2471a3');
    }

    _drawPortLabels() {
        const mk = (txt, x, y, align) => this._staticGroup.add(new Konva.Text({
            x, y, text: txt, fontSize: 9, fill: '#777', width: 22, align,
        }));
        mk('P1', this._portP1.x + 3, this._portP1.y - 12, 'left');
        mk('P2', this._portP2.x + 3, this._portP2.y + 3, 'left');
        mk('S1', this._portS1.x - 25, this._portS1.y - 12, 'right');
        mk('S2', this._portS2.x - 25, this._portS2.y + 3, 'right');
    }

    _createDynamicNodes() {
        const W = this.width, H = this.height;
        this._ratioText = new Konva.Text({
            x: 0, y: 3, width: W, align: 'center',
            text: `变比 ${this._turnsRatio}:1`, fontSize: 10, fontStyle: 'bold', fill: '#777',
        });
        this._primaryText = new Konva.Text({
            x: 6, y: H - 14, text: 'I₁=0.00A', fontSize: 9,
            fontFamily: 'Courier New', fontStyle: 'bold', fill: '#c0392b',
        });
        this._secondaryText = new Konva.Text({
            x: W - 70, y: H - 14, width: 64, align: 'right',
            text: 'I₂=0.00A', fontSize: 9,
            fontFamily: 'Courier New', fontStyle: 'bold', fill: '#2471a3',
        });
        this._dynamicGroup.add(this._ratioText);
        this._dynamicGroup.add(this._primaryText);
        this._dynamicGroup.add(this._secondaryText);
    }

    _updateDynamic() {
        const i1 = this.I_primary || 0, i2 = this.I_secondary || 0;
        this._primaryText.text(`I₁=${i1.toFixed(2)}A`);
        this._secondaryText.text(`I₂=${i2.toFixed(2)}A`);
        this._ratioText.text(`变比 ${this._turnsRatio}:1`);
    }

    onConfigUpdate(cfg) {
        if (cfg.turnsRatio     !== undefined) this._turnsRatio     = Math.max(1, parseFloat(cfg.turnsRatio) || 16);
        if (cfg.primaryRated   !== undefined) this._primaryRated   = parseFloat(cfg.primaryRated)   || 100;
        if (cfg.secondaryRated !== undefined) this._secondaryRated = parseFloat(cfg.secondaryRated) || 5;
        this.config = { ...this.config, ...cfg };

        this._recalcGeometry();
        this._staticGroup.destroyChildren();
        this._dynamicGroup.destroyChildren();
        this._init();
        this._refreshCache?.();
    }
}
