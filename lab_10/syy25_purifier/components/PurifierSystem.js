import Konva from 'konva';
import { BaseComponent } from './BaseComponent.js';

/**
 * PurifierSystem — S 型分油机系统流程与分离筒半剖
 *
 * 左侧：沉淀柜 → 进油泵 → 滤器 → 加热器 → 转换阀 V1 → 分油机
 * 右侧：净油出口（PT4 / MT）→ 净油柜；出水（PT5 / V5）；排渣 → 排渣柜
 * 下部：工作水模块 SV10/SV15/SV16；控制空气模块
 */
export class PurifierSystem extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.W = Math.max(1100, config.width || 1400);
        this.H = Math.max(720, config.height || 900);
        this.type = 'purifier_system';
        this.special = 'purifier_system';
        this.cache = 'fixed';

        this._initGroups();
        this._recalcGeometry();
        this._drawStaticParts();
        this._createDynamicNodes();
        this._bindInteraction();
        this._syncVisuals();

        this.config = { id: this.id, width: this.W, height: this.H };
    }

    _solver() {
        return this.sys && this.sys.purifierSolver ? this.sys.purifierSolver : null;
    }

    _recalcGeometry() {
        const W = this.W, H = this.H;
        this._geo = {
            chassis: { x: 0, y: 0, w: W, h: H, r: 12 },
            dirty: { x: 36, y: 96, w: 190, h: 250 },
            pump: { x: 282, y: 238, w: 92, h: 78 },
            filter: { x: 408, y: 252, w: 48, h: 48 },
            heater: { x: 498, y: 212, w: 104, h: 104 },
            v1: { x: 646, y: 238, w: 58, h: 54 },
            sep: { x: 750, y: 60, w: 346, h: 640 },
            bowl: { cx: 946, cy: 372, r: 138 },
            clean: { x: 1084, y: 96, w: 100, h: 250 },
            sludge: { x: 1084, y: 630, w: 100, h: 176 },
            water: { x: 250, y: 556, w: 470, h: 260 },
            air: { x: 36, y: 556, w: 190, h: 260 },
            sv10: { x: 296, y: 620, w: 100, h: 58 },
            sv15: { x: 420, y: 620, w: 100, h: 58 },
            sv16: { x: 544, y: 620, w: 100, h: 58 },
            v5: { x: 1020, y: 548, w: 58, h: 54 },
            pt1: { x: 356, y: 172, w: 92, h: 42 },
            tt1: { x: 512, y: 156, w: 92, h: 42 },
            pt4: { x: 720, y: 150, w: 96, h: 42 },
            mt: { x: 720, y: 202, w: 96, h: 42 },
            pt5: { x: 978, y: 490, w: 96, h: 42 },
            inlet: { x: 230, y: 700, w: 86, h: 46 },
            airIn: { x: 52, y: 618, w: 86, h: 46 },
        };
    }

    _label(g, x, y, text, size = 12, fill = '#263238', bold = false, align = 'left', width = 0) {
        const opts = {
            x, y, text, fontSize: size, fontStyle: bold ? 'bold' : 'normal',
            fill, align, fontFamily: 'Arial, "Microsoft YaHei", sans-serif',
        };
        if (width) opts.width = width;
        g.add(new Konva.Text(opts));
    }

    _pipe(g, points, color = '#607d8b', width = 5) {
        g.add(new Konva.Line({ points, stroke: color, strokeWidth: width, lineCap: 'round', lineJoin: 'round' }));
    }

    _drawTank(g, b, label, color) {
        g.add(new Konva.Rect({ x: b.x, y: b.y, width: b.w, height: b.h, cornerRadius: 6, fill: '#e8ecea', stroke: '#546e7a', strokeWidth: 2 }));
        g.add(new Konva.Rect({ x: b.x + 6, y: b.y + 6, width: b.w - 12, height: b.h - 12, cornerRadius: 3, fill: '#fbfcfb', stroke: '#b0bec5', strokeWidth: 1 }));
        this._label(g, b.x, b.y - 20, label, b.w < 115 ? 10 : 12, '#263238', true, 'center', b.w);
        this._label(g, b.x + b.w - 6, b.y + 8, '', 10, color, true, 'right', 0);
    }

    _drawValve(g, b, label, id) {
        g.add(new Konva.Rect({ x: b.x, y: b.y, width: b.w, height: b.h, cornerRadius: 4, fill: '#dfe4e2', stroke: '#546e7a', strokeWidth: 1.5 }));
        this._label(g, b.x, b.y - 17, label, 10, '#37474f', true, 'center', b.w);
        const hx = b.x + b.w / 2, hy = b.y + b.h / 2;
        g.add(new Konva.Circle({ x: hx, y: hy, radius: 11, fill: '#90a4ae', stroke: '#455a64', strokeWidth: 1 }));
        this._label(g, b.x, b.y + b.h + 3, id.toUpperCase(), 9, '#78909c', false, 'center', b.w);
    }

    _drawGaugeBox(g, b, label, unit) {
        g.add(new Konva.Rect({ x: b.x, y: b.y, width: b.w, height: b.h, cornerRadius: 3, fill: '#263238', stroke: '#111', strokeWidth: 1 }));
        this._label(g, b.x + 5, b.y + 3, label, 8, '#90a4ae', true);
        this._label(g, b.x + b.w - 5, b.y + 3, unit, 8, '#90a4ae', false, 'right', 0);
    }

    _drawStaticParts() {
        const g = this._staticGroup, G = this._geo, W = this.W, H = this.H;

        // 面板
        g.add(new Konva.Rect({
            x: 0, y: 0, width: W, height: H, cornerRadius: G.chassis.r,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint: { x: 0, y: H },
            fillLinearGradientColorStops: [0, '#eef1ef', 1, '#dfe4e1'],
            stroke: '#9aa19d', strokeWidth: 2,
        }));
        this._label(g, 18, 8, 'S-TYPE SEPARATOR SYSTEM  ·  S 936', 13, '#37474f', true);
        this._label(g, 18, 28, 'S 型分油机系统流程（HFO / 98 °C）', 10, '#78909c');

        // 油柜
        this._drawTank(g, G.dirty, '沉淀柜  DIRTY OIL', '#c48b2c');
        this._drawTank(g, G.clean, '净油柜', '#2e7d32');
        this._drawTank(g, G.sludge, '排渣柜', '#6d4c41');

        // 进油泵
        const P = G.pump;
        g.add(new Konva.Rect({ x: P.x, y: P.y, width: P.w, height: P.h, cornerRadius: 6, fill: '#cfd8dc', stroke: '#546e7a', strokeWidth: 2 }));
        g.add(new Konva.Circle({ x: P.x + P.w / 2, y: P.y + P.h / 2, radius: 28, fill: '#eceff1', stroke: '#455a64', strokeWidth: 1.5 }));
        this._label(g, P.x, P.y + P.h + 4, '进油泵  FEED PUMP', 10, '#37474f', true, 'center', P.w);

        // 滤器
        const F = G.filter;
        g.add(new Konva.Rect({ x: F.x, y: F.y, width: F.w, height: F.h, cornerRadius: 4, fill: '#b0bec5', stroke: '#455a64', strokeWidth: 2 }));
        for (let i = 0; i < 4; i++) {
            g.add(new Konva.Line({ points: [F.x + 8, F.y + 10 + i * 9, F.x + F.w - 8, F.y + 10 + i * 9], stroke: '#78909c', strokeWidth: 1 }));
        }
        this._label(g, F.x, F.y - 17, '滤器', 10, '#37474f', true, 'center', F.w);

        // 加热器
        const Ht = G.heater;
        g.add(new Konva.Rect({ x: Ht.x, y: Ht.y, width: Ht.w, height: Ht.h, cornerRadius: 6, fill: '#cfd8dc', stroke: '#546e7a', strokeWidth: 2 }));
        g.add(new Konva.Rect({ x: Ht.x + 12, y: Ht.y + 12, width: Ht.w - 24, height: Ht.h - 24, cornerRadius: 4, fill: '#e0e0e0', stroke: '#9e9e9e', strokeWidth: 1 }));
        this._label(g, Ht.x, Ht.y - 20, '加热器  HEATER', 10, '#37474f', true, 'center', Ht.w);
        this._label(g, Ht.x, Ht.y + Ht.h + 4, '蒸汽/电加热', 9, '#78909c', false, 'center', Ht.w);

        // 转换阀 V1
        this._drawValve(g, G.v1, '转换阀', 'v1');

        // 压力/温度/水分表
        this._drawGaugeBox(g, G.pt1, 'PT1 进油', 'MPa');
        this._drawGaugeBox(g, G.tt1, 'TT1 温度', '°C');
        this._drawGaugeBox(g, G.pt4, 'PT4 净油', 'MPa');
        this._drawGaugeBox(g, G.mt, 'MT 水分', 'pF');
        this._drawGaugeBox(g, G.pt5, 'PT5 出水', 'MPa');

        // 管道
        this._pipe(g, [G.dirty.x + G.dirty.w, G.dirty.y + G.dirty.h - 40, G.pump.x, G.pump.y + G.pump.h - 30], '#8d6e63', 8);
        this._pipe(g, [G.pump.x + G.pump.w, G.pump.y + G.pump.h / 2, G.filter.x, G.filter.y + F.h / 2], '#8d6e63', 7);
        this._pipe(g, [G.filter.x + F.w, G.filter.y + F.h / 2, G.heater.x, G.heater.y + Ht.h / 2], '#8d6e63', 7);
        this._pipe(g, [G.heater.x + Ht.w, G.heater.y + Ht.h / 2, G.v1.x, G.v1.y + G.v1.h / 2], '#8d6e63', 7);
        this._pipe(g, [G.v1.x + G.v1.w, G.v1.y + G.v1.h / 2, G.sep.x + 52, G.sep.y + 430], '#8d6e63', 7);

        // 净油出口
        this._pipe(g, [G.bowl.cx + 76, G.bowl.cy - 104, G.clean.x, G.bowl.cy - 104], '#c48b2c', 6);
        this._pipe(g, [G.clean.x, G.clean.y + G.clean.h - 40, G.clean.x, G.clean.y + G.clean.h - 40], '#c48b2c', 6);

        // 出水 / 排水
        this._pipe(g, [G.bowl.cx + 70, G.bowl.cy + 40, G.v5.x, G.bowl.cy + 40], '#4fc3f7', 5);
        this._pipe(g, [G.v5.x + G.v5.w / 2, G.v5.y + G.v5.h, G.v5.x + G.v5.w / 2, G.sludge.y - 20], '#4fc3f7', 5);

        // 排渣
        this._pipe(g, [G.bowl.cx, G.bowl.cy + 138, G.bowl.cx, G.sludge.y + 30, G.sludge.x, G.sludge.y + 30], '#795548', 8);

        // 工作水模块
        const Wb = G.water;
        g.add(new Konva.Rect({ x: Wb.x, y: Wb.y, width: Wb.w, height: Wb.h, cornerRadius: 6, fill: '#e3f2fd', stroke: '#4fc3f7', strokeWidth: 1.5 }));
        this._label(g, Wb.x + 10, Wb.y + 7, 'WORKING WATER BLOCK  工作水模块', 10, '#0277bd', true);
        this._drawValve(g, G.sv10, '水封/置换水', 'sv10');
        this._drawValve(g, G.sv15, '开启水', 'sv15');
        this._drawValve(g, G.sv16, '关闭水', 'sv16');
        this._label(g, G.inlet.x - 18, G.inlet.y - 24, '工作水进口 C1/C2/C3', 10, '#0277bd', true, 'center', G.inlet.w + 36);
        g.add(new Konva.Rect({ x: G.inlet.x, y: G.inlet.y, width: G.inlet.w, height: G.inlet.h, cornerRadius: 4, fill: '#bbdefb', stroke: '#2196f3', strokeWidth: 1.5 }));
        this._label(g, G.inlet.x + 6, G.inlet.y + 15, '2~8 bar', 10, '#0d47a1', true);

        // 工作水到本体
        this._pipe(g, [G.inlet.x + G.inlet.w, G.inlet.y + G.inlet.h / 2, G.sv10.x, G.sv10.y + G.sv10.h / 2], '#4fc3f7', 5);
        this._pipe(g, [G.sv10.x + G.sv10.w, G.sv10.y + G.sv10.h / 2, G.sv15.x, G.sv15.y + G.sv15.h / 2], '#4fc3f7', 5);
        this._pipe(g, [G.sv15.x + G.sv15.w, G.sv15.y + G.sv15.h / 2, G.sv16.x, G.sv16.y + G.sv16.h / 2], '#4fc3f7', 5);
        this._pipe(g, [G.sv16.x + G.sv16.w, G.sv16.y + G.sv16.h / 2, 780, G.sv16.y + G.sv16.h / 2, 780, 700, G.bowl.cx - 30, 700, G.bowl.cx - 30, G.bowl.cy + 120], '#4fc3f7', 5);

        // 控制空气
        const Ab = G.air;
        g.add(new Konva.Rect({ x: Ab.x, y: Ab.y, width: Ab.w, height: Ab.h, cornerRadius: 6, fill: '#e8f5e9', stroke: '#66bb6a', strokeWidth: 1.5 }));
        this._label(g, Ab.x + 8, Ab.y + 7, 'CONTROL AIR  控制空气', 10, '#2e7d32', true);
        g.add(new Konva.Rect({ x: G.airIn.x, y: G.airIn.y, width: G.airIn.w, height: G.airIn.h, cornerRadius: 4, fill: '#c8e6c9', stroke: '#43a047', strokeWidth: 1.5 }));
        this._label(g, G.airIn.x + 6, G.airIn.y + 15, '5~7 bar', 10, '#1b5e20', true);
        this._label(g, G.airIn.x, G.airIn.y - 17, '空气进口', 9, '#2e7d32', true, 'center', G.airIn.w);
        g.add(new Konva.Circle({ x: 120, y: 710, radius: 18, fill: '#a5d6a7', stroke: '#2e7d32', strokeWidth: 1.5 }));
        this._label(g, 100, 738, '过滤减压阀', 8, '#2e7d32', false, 'center', 80);

        // 分油机本体
        this._drawSeparatorStatic(g);
    }

    _drawSeparatorStatic(g) {
        const G = this._geo, B = G.bowl;
        const cx = B.cx, cy = B.cy, r = B.r;

        this._label(g, G.sep.x + 10, G.sep.y + 6, 'SEPARATOR  S 936', 11, '#37474f', true);
        this._label(g, G.sep.x + 10, G.sep.y + 24, '分油机本体（半剖）', 10, '#78909c');

        // 机架
        g.add(new Konva.Rect({ x: cx - 160, y: cy + 186, width: 320, height: 34, cornerRadius: 4, fill: '#546e7a', stroke: '#37474f', strokeWidth: 2 }));
        g.add(new Konva.Rect({ x: cx - 128, y: cy + 220, width: 256, height: 18, fill: '#455a64' }));
        // 电机
        g.add(new Konva.Rect({ x: cx - 196, y: cy + 126, width: 78, height: 66, cornerRadius: 6, fill: '#78909c', stroke: '#37474f', strokeWidth: 2 }));
        this._label(g, cx - 200, cy + 196, 'M', 16, '#263238', true, 'center', 36);
        // 皮带护罩
        g.add(new Konva.Line({ points: [cx - 160, cy + 160, cx - 46, cy + 200, cx - 46, cy + 184, cx - 160, cy + 144], closed: true, fill: '#90a4ae', stroke: '#546e7a', strokeWidth: 1.5 }));
        // 立轴
        g.add(new Konva.Rect({ x: cx - 7, y: cy + 60, width: 14, height: 130, fill: '#90a4ae', stroke: '#546e7a', strokeWidth: 1.5 }));
        // 外壳
        g.add(new Konva.Circle({ x: cx, y: cy, radius: r + 16, fill: '#cfd8dc', stroke: '#546e7a', strokeWidth: 3 }));
        g.add(new Konva.Circle({ x: cx, y: cy, radius: r, fill: '#eceff1', stroke: '#78909c', strokeWidth: 2 }));
        // 筒盖
        g.add(new Konva.Arc({ x: cx, y: cy, innerRadius: r - 4, outerRadius: r + 12, angle: 180, rotation: 180, fill: '#b0bec5', stroke: '#546e7a', strokeWidth: 2 }));
        // 锁紧环
        g.add(new Konva.Rect({ x: cx - r - 16, y: cy - 8, width: 2 * (r + 16), height: 14, fill: '#78909c', stroke: '#455a64', strokeWidth: 1 }));
        // 进油管
        g.add(new Konva.Line({ points: [cx - 118, cy + 122, cx - 118, cy + 184, cx - 46, cy + 184], stroke: '#8d6e63', strokeWidth: 7 }));
        // 向心泵/向心盘
        g.add(new Konva.Rect({ x: cx - 8, y: cy - 120, width: 16, height: 86, fill: '#ffb74d', stroke: '#ef6c00', strokeWidth: 1.5 }));
        g.add(new Konva.Circle({ x: cx, y: cy - 128, radius: 16, fill: '#ffcc80', stroke: '#ef6c00', strokeWidth: 1.5 }));
        this._label(g, cx + 24, cy - 126, '向心盘', 9, '#ef6c00', true);
        // 净油出口
        g.add(new Konva.Line({ points: [cx + 16, cy - 112, cx + 76, cy - 112, cx + 76, cy - 104], stroke: '#c48b2c', strokeWidth: 6 }));
        // 出水口
        g.add(new Konva.Line({ points: [cx + 96, cy + 34, cx + 140, cy + 34], stroke: '#4fc3f7', strokeWidth: 5 }));
        // 排渣口
        g.add(new Konva.Rect({ x: cx - 30, y: cy + r - 4, width: 60, height: 14, fill: '#8d6e63', stroke: '#5d4037', strokeWidth: 1 }));
        // 工作水通道
        g.add(new Konva.Line({ points: [cx - 30, cy + 120, cx - 30, cy + 60, cx - 8, cy + 42], stroke: '#4fc3f7', strokeWidth: 4 }));
        // 标签
        this._label(g, cx - 70, cy + 244, 'S 936  ·  10680 r/min  ·  7.5 kW', 9, '#546e7a', false, 'center', 140);

        // 操作水/密封腔示意
        g.add(new Konva.Line({ points: [cx + 40, cy + 52, cx + 104, cy + 52, cx + 104, cy + 120], stroke: '#4fc3f7', strokeWidth: 3 }));
        this._label(g, cx + 58, cy + 132, '开启/关闭水腔', 8, '#0277bd');
    }

    _createDynamicNodes() {
        const d = this._dynamicGroup, G = this._geo, B = G.bowl;
        const cx = B.cx, cy = B.cy, r = B.r;

        // 油柜液位
        this._tankFills = {};
        const tankDefs = [
            ['dirty', G.dirty, '#c48b2c'],
            ['clean', G.clean, '#2e7d32'],
            ['sludge', G.sludge, '#6d4c41'],
        ];
        tankDefs.forEach(([id, b, color]) => {
            const fill = new Konva.Rect({ x: b.x + 6, y: b.y + b.h - 6, width: b.w - 12, height: 0, cornerRadius: 3, fill: color, opacity: 0.75 });
            d.add(fill);
            this._tankFills[id] = { fill, x: b.x + 6, y: b.y + 6, h: b.h - 12 };
        });
        this._tankLabels = {};
        tankDefs.forEach(([id, b]) => {
            const t = new Konva.Text({ x: b.x - 10, y: b.y + b.h + 6, width: b.w + 20, height: 20, text: '0%', fontSize: 11, align: 'center', fill: '#37474f', fontFamily: 'Consolas, monospace' });
            d.add(t);
            this._tankLabels[id] = t;
        });

        // 泵叶轮 / 电机风扇
        this._impeller = new Konva.Group({ x: G.pump.x + G.pump.w / 2, y: G.pump.y + G.pump.h / 2 });
        for (let i = 0; i < 3; i++) {
            this._impeller.add(new Konva.Line({ points: [0, 0, 16, -6], stroke: '#455a64', strokeWidth: 4, lineCap: 'round', rotation: i * 120 }));
        }
        d.add(this._impeller);
        this._motorFan = new Konva.Group({ x: cx - 157, y: cy + 159 });
        for (let i = 0; i < 4; i++) {
            this._motorFan.add(new Konva.Line({ points: [0, 0, 18, -5], stroke: '#eceff1', strokeWidth: 3, lineCap: 'round', rotation: i * 90 }));
        }
        d.add(this._motorFan);

        // 加热器发光
        this._heaterGlow = new Konva.Rect({ x: G.heater.x + 16, y: G.heater.y + 16, width: G.heater.w - 32, height: G.heater.h - 32, cornerRadius: 3, fill: '#ff9800', opacity: 0 });
        d.add(this._heaterGlow);

        // 阀门手柄
        this._valveNodes = {};
        ['v1', 'sv10', 'sv15', 'sv16', 'v5'].forEach(id => {
            const b = G[id];
            const hx = b.x + b.w / 2, hy = b.y + b.h / 2;
            const grp = new Konva.Group({ x: hx, y: hy });
            grp.add(new Konva.Line({ points: [0, 0, 0, -20], stroke: '#263238', strokeWidth: 3, lineCap: 'round' }));
            grp.add(new Konva.Circle({ x: 0, y: -20, radius: 4, fill: '#263238' }));
            d.add(grp);
            this._valveNodes[id] = grp;
        });

        // 液位/流动
        this._oilFlow = new Konva.Line({
            points: [G.dirty.x + G.dirty.w, G.dirty.y + G.dirty.h - 40, G.pump.x, G.pump.y + G.pump.h - 30,
                G.pump.x + G.pump.w, G.pump.y + G.pump.h / 2, G.filter.x, G.filter.y + 24,
                G.filter.x + 48, G.filter.y + 24, G.heater.x, G.heater.y + 52,
                G.heater.x + G.heater.w, G.heater.y + 52, G.v1.x, G.v1.y + G.v1.h / 2,
                G.v1.x + G.v1.w, G.v1.y + G.v1.h / 2, G.sep.x + 52, G.sep.y + 430],
            stroke: '#ffb300', strokeWidth: 3, dash: [8, 12], dashOffset: 0, opacity: 0,
        });
        d.add(this._oilFlow);

        this._cleanFlow = new Konva.Line({
            points: [cx + 76, cy - 112, G.clean.x, cy - 112],
            stroke: '#ffca28', strokeWidth: 3, dash: [8, 12], dashOffset: 0, opacity: 0,
        });
        d.add(this._cleanFlow);

        this._waterFlow = new Konva.Line({
            points: [G.inlet.x + G.inlet.w, G.inlet.y + 23, G.sv10.x, G.sv10.y + 29,
                G.sv10.x + G.sv10.w, G.sv10.y + 29, G.sv15.x, G.sv15.y + 29,
                G.sv15.x + G.sv15.w, G.sv15.y + 29, G.sv16.x, G.sv16.y + 29,
                G.sv16.x + G.sv16.w, G.sv16.y + 29, 780, G.sv16.y + 29, 780, 700,
                cx - 30, 700, cx - 30, cy + 120],
            stroke: '#29b6f6', strokeWidth: 3, dash: [8, 12], dashOffset: 0, opacity: 0,
        });
        d.add(this._waterFlow);

        this._drainFlow = new Konva.Line({
            points: [cx + 96, cy + 34, G.v5.x + 29, cy + 34, G.v5.x + 29, G.v5.y + G.v5.h, G.v5.x + 29, G.sludge.y - 10],
            stroke: '#4fc3f7', strokeWidth: 3, dash: [8, 12], dashOffset: 0, opacity: 0,
        });
        d.add(this._drainFlow);

        this._sludgeFlow = new Konva.Line({
            points: [cx, cy + r, cx, G.sludge.y + 30, G.sludge.x, G.sludge.y + 30],
            stroke: '#8d6e63', strokeWidth: 5, dash: [10, 10], dashOffset: 0, opacity: 0,
        });
        d.add(this._sludgeFlow);

        // 分离筒内部动态
        this._discStack = new Konva.Group({ x: cx, y: cy });
        for (let i = -6; i <= 6; i++) {
            this._discStack.add(new Konva.Line({ points: [-86, i * 11, 86, i * 11], stroke: '#90a4ae', strokeWidth: 1.6 }));
        }
        this._discStack.add(new Konva.Line({ points: [0, -92, 0, 92], stroke: '#607d8b', strokeWidth: 3 }));
        d.add(this._discStack);

        this._sludgeLayer = new Konva.Arc({ x: cx, y: cy, innerRadius: r - 42, outerRadius: r - 12, angle: 300, rotation: 30, fill: '#8d6e63', opacity: 0.85 });
        d.add(this._sludgeLayer);
        this._waterSeal = new Konva.Arc({ x: cx, y: cy, innerRadius: r - 76, outerRadius: r - 50, angle: 300, rotation: 30, fill: '#4fc3f7', opacity: 0.85 });
        d.add(this._waterSeal);
        this._oilLayer = new Konva.Arc({ x: cx, y: cy, innerRadius: r - 100, outerRadius: r - 80, angle: 300, rotation: 30, fill: '#ffca28', opacity: 0.6 });
        d.add(this._oilLayer);

        // 滑动底盘
        this._slide = new Konva.Rect({ x: cx - 66, y: cy + r - 18, width: 132, height: 10, fill: '#78909c', stroke: '#455a64', strokeWidth: 1 });
        d.add(this._slide);
        // 排渣闪光
        this._dischargeFlash = new Konva.Circle({ x: cx, y: cy + r + 4, radius: 26, fill: '#ffb300', opacity: 0, listening: false });
        d.add(this._dischargeFlash);
        // 漏油痕迹
        this._leakStreak = new Konva.Line({ points: [cx - 40, cy + r - 6, cx - 52, cy + r + 40, cx - 44, cy + r + 72], stroke: '#5d4037', strokeWidth: 7, lineCap: 'round', opacity: 0 });
        d.add(this._leakStreak);

        // 仪表数值
        this._gaugeTexts = {};
        [['pt1', G.pt1], ['tt1', G.tt1], ['pt4', G.pt4], ['mt', G.mt], ['pt5', G.pt5]].forEach(([id, b]) => {
            const t = new Konva.Text({
                x: b.x + 5, y: b.y + 15, width: b.w - 10, height: 24,
                text: '--', fontSize: 14, align: 'right', fill: '#6dff9a',
                fontFamily: 'Consolas, monospace',
            });
            d.add(t);
            this._gaugeTexts[id] = t;
        });

        // 状态文字
        this._statusText = new Konva.Text({
            x: 728, y: 20, width: 430, height: 40,
            text: '', fontSize: 12, lineHeight: 1.4, fill: '#37474f',
            fontFamily: 'Arial, "Microsoft YaHei", sans-serif',
        });
        d.add(this._statusText);
    }

    _bindInteraction() {
        const G = this._geo;
        this.addClickablePart('separator', G.sep.x, G.sep.y, G.sep.w, G.sep.h, false);
        this.addClickablePart('dirty-tank', G.dirty.x, G.dirty.y, G.dirty.w, G.dirty.h, true);
        this.addClickablePart('clean-tank', G.clean.x, G.clean.y, G.clean.w, G.clean.h, true);
        this.addClickablePart('sludge-tank', G.sludge.x, G.sludge.y, G.sludge.w, G.sludge.h, true);
        this.addClickablePart('feed-pump', G.pump.x, G.pump.y, G.pump.w, G.pump.h, true)
            .on('click tap', () => this._manualPump());
        this.addClickablePart('heater', G.heater.x, G.heater.y, G.heater.w, G.heater.h, true)
            .on('click tap', () => this._manualHeater());
        this.addClickablePart('v1', G.v1.x, G.v1.y, G.v1.w, G.v1.h, true)
            .on('click tap', () => { const s = this._solver(); if (s) s.toggleValve('v1'); this._syncVisuals(); });
        this.addClickablePart('sv10', G.sv10.x, G.sv10.y, G.sv10.w, G.sv10.h, true)
            .on('click tap', () => { const s = this._solver(); if (s) s.toggleValve('sv10'); this._syncVisuals(); });
        this.addClickablePart('sv15', G.sv15.x, G.sv15.y, G.sv15.w, G.sv15.h, true)
            .on('click tap', () => { const s = this._solver(); if (s) s.toggleValve('sv15'); this._syncVisuals(); });
        this.addClickablePart('sv16', G.sv16.x, G.sv16.y, G.sv16.w, G.sv16.h, true)
            .on('click tap', () => { const s = this._solver(); if (s) s.toggleValve('sv16'); this._syncVisuals(); });
        this.addClickablePart('v5', G.v5.x, G.v5.y, G.v5.w, G.v5.h, true)
            .on('click tap', () => { const s = this._solver(); if (s) s.toggleValve('v5'); this._syncVisuals(); });
        this.addClickablePart('water-inlet', G.inlet.x, G.inlet.y, G.inlet.w, G.inlet.h, true)
            .on('click tap', () => { const s = this._solver(); if (s) s.toggleWaterMain(); this._syncVisuals(); });
        this.addClickablePart('air-inlet', G.airIn.x, G.airIn.y, G.airIn.w, G.airIn.h, true)
            .on('click tap', () => { const s = this._solver(); if (s) s.toggleAirMain(); this._syncVisuals(); });
        this.addClickablePart('pt1', G.pt1.x, G.pt1.y, G.pt1.w, G.pt1.h, true);
        this.addClickablePart('tt1', G.tt1.x, G.tt1.y, G.tt1.w, G.tt1.h, true);
        this.addClickablePart('pt4', G.pt4.x, G.pt4.y, G.pt4.w, G.pt4.h, true);
        this.addClickablePart('mt', G.mt.x, G.mt.y, G.mt.w, G.mt.h, true);
        this.addClickablePart('pt5', G.pt5.x, G.pt5.y, G.pt5.w, G.pt5.h, true);
    }

    _manualPump() {
        const s = this._solver();
        if (!s) return;
        if (!s.m.debugMode && s.m.mode !== 'MAN') { s._tip('AUTO 模式下进油泵由 EPC-60 控制'); return; }
        s.toggleFeedPump();
        this._syncVisuals();
    }

    _manualHeater() {
        const s = this._solver();
        if (!s) return;
        if (!s.m.debugMode && s.m.mode !== 'MAN') { s._tip('AUTO 模式下加热器由 EPC-60 控制'); return; }
        s.toggleHeater();
        this._syncVisuals();
    }

    _syncVisuals() {
        const s = this._solver();
        const m = s ? s.m : null;
        if (!m) return;
        const G = this._geo, B = G.bowl;
        const cx = B.cx, cy = B.cy, r = B.r;

        // 液位
        this._setTank('dirty', m.oil.dirty);
        this._setTank('clean', m.oil.clean);
        this._setTank('sludge', m.sludge.tank);

        // 泵/电机/加热器
        this._impeller.rotation(m.feed.pumpOn ? (m.bowl.discRot * 40) % 360 : 0);
        this._motorFan.rotation(m.motor.on ? (m.bowl.discRot * 60) % 360 : 0);
        this._heaterGlow.opacity(m.feed.heaterOn && m.mainPower ? 0.35 + 0.25 * Math.sin((performance.now ? performance.now() : Date.now()) / 300) : 0);

        // 阀门
        const valveState = { v1: m.feed.valveOpen, sv10: m.water.sv10, sv15: m.water.sv15, sv16: m.water.sv16, v5: m.water.drain };
        Object.keys(this._valveNodes).forEach(id => {
            const open = !!valveState[id];
            this._valveNodes[id].rotation(open ? 90 : 0);
            this._valveNodes[id].children[0].stroke(open ? '#1b5e20' : '#263238');
        });

        // 流动
        const oilOn = m.feed.flow > 0.02;
        this._oilFlow.opacity(oilOn ? 0.95 : 0);
        this._cleanFlow.opacity(oilOn ? 0.95 : 0);
        const waterOn = m.water.sv10 || m.water.sv15 || m.water.sv16;
        this._waterFlow.opacity(waterOn ? 0.95 : 0);
        this._drainFlow.opacity(m.water.drain ? 0.95 : 0);
        this._sludgeFlow.opacity(m.bowl.discharge > 0 ? 0.95 : 0);
        const off = (m.bowl.discRot * 18) % 20;
        this._oilFlow.dashOffset(-off);
        this._cleanFlow.dashOffset(-off);
        this._waterFlow.dashOffset(-off);
        this._drainFlow.dashOffset(-off);
        this._sludgeFlow.dashOffset(-off);

        // 分离筒
        this._discStack.rotation((m.bowl.discRot * 10) % 360);
        this._waterSeal.visible(m.bowl.waterSeal);
        this._sludgeLayer.visible(m.bowl.speed > 500);
        const load = clamp(m.sludge.nextIn / Math.max(60, m.params.dischargeInterval * 60), 0, 1);
        this._sludgeLayer.opacity(0.25 + (1 - load) * 0.65);
        this._oilLayer.visible(m.state === 'SEPARATION');
        this._oilLayer.opacity(0.35 + clamp(m.feed.flow / Math.max(0.1, m.params.flow), 0, 1) * 0.4);
        this._slide.y(cy + r - 18 + (m.bowl.closed ? 0 : 10));
        this._dischargeFlash.opacity(m.bowl.discharge > 0 ? 0.9 : 0);
        this._leakStreak.opacity(m.faults.leak ? 0.85 : 0);

        // 仪表
        this._gaugeTexts.pt1.text(`${m.feed.pressure.toFixed(3)}`);
        this._gaugeTexts.tt1.text(`${m.feed.temp.toFixed(1)}`);
        this._gaugeTexts.pt4.text(`${m.oil.outletPressure.toFixed(3)}`);
        this._gaugeTexts.mt.text(m.faults.transducer ? 'NC' : `${m.oil.waterContent.toFixed(1)}`);
        this._gaugeTexts.pt5.text(`${m.water.outletPressure.toFixed(3)}`);
        this._gaugeTexts.pt4.fill(m.oil.outletPressure < 0.06 && m.state === 'SEPARATION' ? '#ff8a80' : '#6dff9a');
        this._gaugeTexts.mt.fill(m.faults.transducer ? '#ff8a80' : (m.oil.waterContent > m.params.waterTrigger ? '#ffd54f' : '#6dff9a'));

        // 状态文字
        const st = {
            STANDSTILL: '静止', STARTING: '起动升速', START_SEQ: '起动程序', STANDBY: '待命',
            SEPARATION: '正常分油', DISCHARGE: '排渣程序', STOPPING: '停机程序',
        }[m.state] || m.state;
        this._statusText.text(
            `状态：${st}    ${m.mode} / ${m.local ? 'LOCAL' : 'REMOTE'}\n`
            + `转速 ${Math.round(m.bowl.speed)} r/min    振动 ${m.bowl.vibration.toFixed(1)} mm/s\n`
            + `下次排渣 ${formatClock(m.sludge.nextIn)}    排渣次数 ${m.counters.dischargeCount}`
        );

        if (this.sys && this.sys.requestRedraw) this.sys.requestRedraw();
    }

    _setTank(id, pct) {
        const t = this._tankFills[id];
        if (!t) return;
        pct = clamp(pct, 0, 100);
        const h = t.h * pct / 100;
        t.fill.y(t.y + (t.h - h));
        t.fill.height(h);
        this._tankLabels[id].text(`${Math.round(pct)}%`);
    }

    tick() {
        this._syncVisuals();
        this._refreshIfDirty();
    }

    getConfigFields() {
        return [
            { label: '器件名称 (ID)', key: 'id', type: 'text' },
            { label: '宽度', key: 'width', type: 'number' },
            { label: '高度', key: 'height', type: 'number' },
        ];
    }

    onConfigUpdate(cfg) {
        if (cfg.id) this.id = cfg.id;
        this.config = { ...this.config, ...cfg };
        if (this.sys && this.sys.requestRedraw) this.sys.requestRedraw();
    }
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
function formatClock(sec) {
    sec = Math.max(0, Math.round(sec));
    const mm = Math.floor(sec / 60);
    const ss = sec % 60;
    return `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
}

export default PurifierSystem;
