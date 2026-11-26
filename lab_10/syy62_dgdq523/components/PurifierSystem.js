import Konva from 'konva';
import { BaseComponent } from './BaseComponent.js';

/**
 * PurifierSystem — S 型分油机系统流程与分离筒半剖
 *
 * 左侧：沉淀柜 → 供油泵 → 滤器 → 加热器 → 转换阀 V1 → 分油机
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
            dirty: { x: 26, y: 81, w: 95, h: 167 },
            pump: { x: 220, y: 225, w: 92, h: 78 },
            filter: { x: 330, y: 240, w: 48, h: 48 },
            heater: { x: 410, y: 212, w: 104, h: 104 },
            v1: { x: 570, y: 237, w: 58, h: 54 },
            sep: { x: 600, y: 280, w: 346, h: 340 },
            bowl: { cx: 796, cy: 452, r: 92 },
            clean: { x: 1084, y: 96, w: 95, h: 167 },
            sludge: { x: 954, y: 630, w: 95, h: 167 },
            waterTank: { x: 26, y: 610, w: 84, h: 150 },
            waterValve: { x: 190, y: 690 },
            waterBox: { x: 270, y: 600, w: 125, h: 180 },
            airBottle: { x: 26, y: 420, w: 64, h: 120 },
            airValve: { x: 190, y: 480 },
            solBox: { x: 270, y: 400, w: 125, h: 170 },
            v4: { x: 960, y: 200 },
            waterTray: { x: 1050, y: 496, w: 50, h: 32 },
            sv10: { x: 312, y: 640, w: 40, h: 40 },
            sv15: { x: 312, y: 688, w: 40, h: 40 },
            sv16: { x: 312, y: 736, w: 40, h: 40 },
            v5: { x: 930, y: 422, w: 58, h: 46 },
            st: { x: 946, y: 545, w: 92, h: 42 },
            vt: { x: 682, y: 670, w: 92, h: 42 },
            pt1: { x: 264, y: 150, w: 92, h: 42 },
            tt1: { x: 485, y: 130, w: 92, h: 42 },
            pt4: { x: 780, y: 130, w: 96, h: 42 },
            mt: { x: 730, y: 237, w: 96, h: 42 },
            pt5: { x: 1001, y: 374, w: 96, h: 42 },

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
        this._label(g, b.x, b.y - 18, label, 12, '#263238', true, 'center', b.w);
        this._label(g, b.x + b.w - 6, b.y + 8, '', 13, color, true, 'right', 0);
    }

    _drawValve(g, b, label, id) {
        g.add(new Konva.Rect({ x: b.x, y: b.y, width: b.w, height: b.h, cornerRadius: 4, fill: '#dfe4e2', stroke: '#546e7a', strokeWidth: 1.5 }));
        const hx = b.x + b.w / 2, hy = b.y + b.h / 2;
        this._label(g, b.x - 20, b.y + b.h + 6, label, 9, '#37474f', true, 'center', 56);
        g.add(new Konva.Circle({ x: hx, y: hy, radius: 11, fill: '#90a4ae', stroke: '#455a64', strokeWidth: 1 }));
        // 上部回油接口（居中）
        g.add(new Konva.Line({ points: [hx, b.y, hx, b.y - 22], stroke: '#8d3f31', strokeWidth: 4 }));
        g.add(new Konva.Circle({ x: hx, y: b.y - 24, radius: 4, fill: '#ffffff', stroke: '#546e7a', strokeWidth: 1.2 }));
        // 下部气路接口（居中）
        g.add(new Konva.Line({ points: [hx, b.y + b.h, hx, b.y + b.h + 18], stroke: '#9e9e9e', strokeWidth: 2 }));
        g.add(new Konva.Rect({ x: hx - 10, y: b.y + b.h + 18, width: 20, height: 20, fill: '#e0e0e0', stroke: '#333', strokeWidth: 1 }));
        this._label(g, hx - 10, b.y + b.h + 21, 'M', 11, '#111', true, 'center', 20);
        this._label(g, b.x, b.y + b.h + 42, id.toUpperCase(), 8, '#78909c', false, 'center', b.w);
    }

    _drawGaugeBox(g, b, label, unit) {
        g.add(new Konva.Rect({ x: b.x, y: b.y, width: b.w, height: b.h, cornerRadius: 3, fill: '#263238', stroke: '#111', strokeWidth: 1 }));
        this._label(g, b.x + 2, b.y + 3, label, 11, '#dcf308', true);
        this._label(g, b.x + b.w - 30, b.y + 3, unit, 11, '#13f906', false, 'right', 0);
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
        this._label(g, 18, 28, 'S 型分油机系统流程（HFO / 98 °C）', 12, '#03a7f9');

        // 油柜
        this._drawTank(g, G.dirty, '沉淀柜', '#c48b2c');
        this._drawTank(g, G.clean, '净油柜', '#2e7d32');
        this._drawTank(g, G.sludge, '排渣柜', '#6d4c41');

        // 供油泵
        const P = G.pump;
        g.add(new Konva.Circle({ x: P.x + P.w / 2, y: P.y + P.h / 2, radius: 28, fill: '#eceff1', stroke: '#455a64', strokeWidth: 1.5 }));
        this._label(g, P.x, P.y - 6, '供油泵', 12, '#37474f', true, 'center', P.w);

        // 滤器
        const F = G.filter;
        g.add(new Konva.Rect({ x: F.x, y: F.y, width: F.w, height: F.h, cornerRadius: 4, fill: '#b0bec5', stroke: '#455a64', strokeWidth: 2 }));
        for (let i = 0; i < 4; i++) {
            g.add(new Konva.Line({ points: [F.x + 8, F.y + 10 + i * 9, F.x + F.w - 8, F.y + 10 + i * 9], stroke: '#78909c', strokeWidth: 1 }));
        }
        this._label(g, F.x, F.y - 17, '滤器', 12, '#37474f', true, 'center', F.w);

        // 加热器
        const Ht = G.heater;
        g.add(new Konva.Rect({ x: Ht.x, y: Ht.y, width: Ht.w, height: Ht.h, cornerRadius: 6, fill: '#cfd8dc', stroke: '#546e7a', strokeWidth: 2 }));
        g.add(new Konva.Rect({ x: Ht.x + 12, y: Ht.y + 12, width: Ht.w - 24, height: Ht.h - 24, cornerRadius: 4, fill: '#e0e0e0', stroke: '#9e9e9e', strokeWidth: 1 }));
        this._label(g, Ht.x, Ht.y - 18, '加热器', 12, '#37474f', true, 'center', Ht.w);

        // 蒸汽加热回路：右下进蒸汽（电动调节阀），左下出凝水（单向阀）
        const stC = '#8fa3ad';
        this._pipe(g, [660, 370, 636, 370], stC, 4);
        this._pipe(g, [604, 370, 488, 370], stC, 4);
        this._pipe(g, [488, 370, 488, Ht.y + Ht.h], stC, 4);
        this._label(g, 512, 384, '电动调节阀', 12, '#546e7a', false, 'center', 66);
        this._label(g, 666, 364, '蒸汽入口', 12, '#546e7a');

        this._pipe(g, [436, Ht.y + Ht.h, 436, 370, 330, 370], stC, 4);
        this._label(g, 382, 384, '单向阀', 12, '#546e7a', false, 'center', 44);
        this._label(g, 276, 352, '凝水出口', 12, '#546e7a', false, 'center', 58);

        // 转换阀 V1
        this._drawV1Valve();

        // 压力/温度/水分表
        this._drawGaugeBox(g, G.pt1, 'PT1 进油', 'MPa');
        this._drawGaugeBox(g, G.tt1, 'TT1 温度', '°C');
        this._drawGaugeBox(g, G.pt4, 'PT4 净油', 'MPa');
        this._drawGaugeBox(g, G.mt, 'MT 水分', 'pF');
        this._drawGaugeBox(g, G.pt5, 'PT5 排水', 'MPa');
        this._drawGaugeBox(g, G.st, 'ST 转速', 'r/min');
        this._drawGaugeBox(g, G.vt, 'VT 振动', 'mm/s');
        // 传感器引线
        this._pipe(g, [G.st.x, G.st.y + 21, G.bowl.cx + 118 * (2 / 3), G.st.y + 21], '#607d8b', 2);
        this._pipe(g, [G.vt.x + 46, G.vt.y, G.vt.x + 46, G.bowl.cy + 238 * (2 / 3)], '#607d8b', 2);

        // 管道
        // 沉淀柜 → 出口阀（阀体处断开，管不穿过三角形）
        this._pipe(g, [
            G.dirty.x + G.dirty.w, G.dirty.y + G.dirty.h - 40,
            148, G.dirty.y + G.dirty.h - 40,
        ], '#8d6e63', 8);
        this._pipe(g, [
            182, G.dirty.y + G.dirty.h - 40,
            200, G.dirty.y + G.dirty.h - 40,
            200, G.pump.y + G.pump.h / 2,
            G.pump.x + G.pump.w / 2 - 28, G.pump.y + G.pump.h / 2,
        ], '#8d6e63', 8);
        this._pipe(g, [G.pump.x + G.pump.w / 2 + 28, G.pump.y + G.pump.h / 2, G.filter.x, G.filter.y + F.h / 2], '#8d6e63', 7);
        this._pipe(g, [G.filter.x + F.w, G.filter.y + F.h / 2, G.heater.x, G.heater.y + Ht.h / 2], '#8d6e63', 7);
        this._pipe(g, [G.heater.x + Ht.w, G.heater.y + Ht.h / 2, G.v1.x, G.v1.y + G.v1.h / 2], '#8d6e63', 7);
        const upperPort = { x: G.bowl.cx - G.bowl.r * 0.707, y: G.bowl.cy - G.bowl.r * 0.707 };
        const lowerPort = { x: G.bowl.cx - G.bowl.r * 0.707, y: G.bowl.cy + G.bowl.r * 0.707 };
        this._pipe(g, [G.v1.x + G.v1.w, G.v1.y + G.v1.h / 2, upperPort.x, upperPort.y], '#8d6e63', 7);
        g.add(new Konva.Circle({ x: upperPort.x, y: upperPort.y, radius: 9, fill: '#8d6e63', stroke: '#5d4037', strokeWidth: 2 }));
        g.add(new Konva.Circle({ x: lowerPort.x, y: lowerPort.y, radius: 8, fill: '#9bd7f5', stroke: '#0277bd', strokeWidth: 2 }));

        // 仪表取压管
        // PT1：供油泵出口管路 → PT1
        this._pipe(g, [312, G.pt1.y + G.pt1.h, 312, G.pump.y + G.pump.h / 2], '#8d6e63', 2);
        g.add(new Konva.Circle({ x: 322, y: G.pump.y + G.pump.h / 2, radius: 3, fill: '#5d4037' }));
        // TT1：加热器出口管路 → TT1
        this._pipe(g, [534, G.tt1.y + G.tt1.h, 534, G.heater.y + 52], '#8d6e63', 2);
        g.add(new Konva.Circle({ x: 534, y: G.heater.y + 52, radius: 3, fill: '#5d4037' }));
        // MT：净油出口管路 → MT
        this._pipe(g, [G.mt.x + G.mt.w, G.mt.y + 21, G.bowl.cx + 100, G.mt.y + 21], '#c48b2c', 2);
        g.add(new Konva.Circle({ x: G.bowl.cx + 100, y: G.mt.y + 21, radius: 3, fill: '#8d5a12' }));
        // PT4：V4 阀前进口管路 → PT4
        this._pipe(g, [G.pt4.x + G.pt4.w / 2, G.pt4.y + G.pt4.h, G.pt4.x + G.pt4.w / 2, 200,
            G.bowl.cx + 100, 200], '#c48b2c', 2);
        g.add(new Konva.Circle({ x: G.bowl.cx + 100, y: 200, radius: 3, fill: '#8d5a12' }));

        // V1 上部回流接口 → 沉淀柜右上角回流口
        this._pipe(g, [
            G.v1.x + G.v1.w / 2, G.v1.y - 24,
            G.v1.x + G.v1.w / 2, 90,
            417, 90,
        ], '#8d3f31', 4);
        this._pipe(g, [383, 90, G.dirty.x + G.dirty.w, 90], '#8d3f31', 4);
        g.add(new Konva.Circle({ x: G.dirty.x + G.dirty.w, y: 90, radius: 4, fill: '#8d3f31', stroke: '#5d4037', strokeWidth: 1.2 }));
        this._label(g, 280, 73, '回流至沉淀柜', 12, '#8d3f31', true);

        // 供油泵反并联单向阀（出口压力高时导通，限制输出压力）
        this._pipe(g, [
            G.pump.x + G.pump.w / 2 + 28, G.pump.y + G.pump.h / 2,
            G.pump.x + G.pump.w / 2 + 28, G.pump.y + G.pump.h / 2 + 55,
            G.pump.x + G.pump.w / 2 - 28, G.pump.y + G.pump.h / 2 + 55,
            G.pump.x + G.pump.w / 2 - 28, G.pump.y + G.pump.h / 2,
        ], '#8d3f31', 3);

        // 净油出口
        this._pipe(g, [
            G.bowl.cx + 50, G.bowl.cy - 69,
            G.bowl.cx + 100, G.bowl.cy - 69,
            G.bowl.cx + 100, 200,
            G.clean.x, 200,
        ], '#c48b2c', 6);
        this._pipe(g, [G.clean.x, G.clean.y + G.clean.h - 40, G.clean.x, G.clean.y + G.clean.h - 40], '#c48b2c', 6);

        // 出水 / 排水
        this._pipe(g, [G.bowl.cx + 64, G.bowl.cy + 23, 910, G.bowl.cy + 23,
            910, G.bowl.cy - 7, G.v5.x + G.v5.w / 2 - 16, G.bowl.cy - 7], '#9bd7f5', 5);
        this._pipe(g, [G.v5.x + G.v5.w / 2 + 16, G.bowl.cy - 7, 1075, G.bowl.cy - 7,
            1075, G.waterTray.y + 4], '#9bd7f5', 5);
        // PT5 取压点（出水总管上）
        this._pipe(g, [G.pt5.x + G.pt5.w / 2, G.bowl.cy - 7, G.pt5.x + G.pt5.w / 2, G.pt5.y + G.pt5.h + 4], '#9bd7f5', 3);
        g.add(new Konva.Circle({ x: G.pt5.x + G.pt5.w / 2, y: G.bowl.cy - 7, radius: 3.5, fill: '#0277bd' }));
        // 开口接水盘
        g.add(new Konva.Line({ points: [G.waterTray.x, G.waterTray.y, G.waterTray.x, G.waterTray.y + G.waterTray.h,
            G.waterTray.x + G.waterTray.w, G.waterTray.y + G.waterTray.h, G.waterTray.x + G.waterTray.w, G.waterTray.y],
            stroke: '#0288d1', strokeWidth: 3, fill: '#e1f5fe' }));

        // 排渣
        this._pipe(g, [G.bowl.cx, G.bowl.cy + 138, G.bowl.cx, G.sludge.y + 30, G.sludge.x, G.sludge.y + 30], '#795548', 8);

        // 工作水：压力水柜 → 手动截止阀 → 电磁阀箱 → 水封 / 开启 / 关闭水
        const WT = G.waterTank;
        g.add(new Konva.Rect({ x: WT.x, y: WT.y, width: WT.w, height: WT.h, cornerRadius: 6, fill: '#e3f2fd', stroke: '#0288d1', strokeWidth: 2 }));
        g.add(new Konva.Rect({ x: WT.x + 6, y: WT.y + 36, width: WT.w - 12, height: WT.h - 42, fill: '#81d4fa', opacity: 0.75 }));
        this._label(g, WT.x - 6, WT.y - 16, '压力水柜', 12, '#0277bd', true, 'center', WT.w + 12);
        this._label(g, WT.x + 16, WT.y + 8, '2~8 bar', 12, '#01579b', true);
        // 供水管：水柜 → 手动截止阀 → 电磁阀箱
        this._pipe(g, [WT.x + WT.w, G.waterValve.y, G.waterValve.x - 18, G.waterValve.y], '#9bd7f5', 5);
        this._pipe(g, [G.waterValve.x + 18, G.waterValve.y, G.waterBox.x, G.waterValve.y], '#9bd7f5', 5);
        // 电磁阀箱
        const WB = G.waterBox;
        g.add(new Konva.Rect({ x: WB.x, y: WB.y, width: WB.w, height: WB.h, cornerRadius: 4, fill: '#e1f5fe', stroke: '#0288d1', strokeWidth: 1.8 }));
        this._label(g, WB.x + 8, WB.y + 6, '工作水电磁阀箱', 12, '#01579b', true);

        // 三个电磁阀（位置由 G.sv10 / sv15 / sv16 决定）
        // 水封水：从箱体右侧引出，直接斜线到分油机左上 45° 大口
        this._pipe(g, [WB.x + WB.w, WB.y + 60, upperPort.x, upperPort.y], '#9bd7f5', 5);
        // SV15 / SV16 共用一根管道：从箱体右侧 2/3 高度引出到左下 45° 口
        this._pipe(g, [WB.x + WB.w, WB.y + 120, lowerPort.x, lowerPort.y], '#9bd7f5', 5);

        // 控制空气：小空气瓶 → 手动截止阀 → 电磁阀箱
        const AB = G.airBottle;
        g.add(new Konva.Rect({ x: AB.x, y: AB.y + 12, width: AB.w, height: AB.h - 24, cornerRadius: 16, fill: '#cfd8dc', stroke: '#546e7a', strokeWidth: 2 }));
        g.add(new Konva.Ellipse({ x: AB.x + AB.w / 2, y: AB.y + 12, radiusX: AB.w / 2, radiusY: 8, fill: '#b0bec5', stroke: '#546e7a', strokeWidth: 1.5 }));
        g.add(new Konva.Ellipse({ x: AB.x + AB.w / 2, y: AB.y + AB.h - 12, radiusX: AB.w / 2, radiusY: 8, fill: '#b0bec5', stroke: '#546e7a', strokeWidth: 1.5 }));
        this._label(g, AB.x - 10, AB.y - 10, '控制空气瓶', 12, '#37474f', true, 'center', AB.w + 20);
        this._label(g, AB.x + 15, AB.y + 30, '5~7 bar', 12, '#546e7a');
        // 空气瓶出口 → 手动截止阀 → 电磁阀箱
        this._pipe(g, [AB.x + AB.w, G.airValve.y, G.airValve.x - 18, G.airValve.y], '#9e9e9e', 4);
        this._pipe(g, [G.airValve.x + 18, G.airValve.y, G.solBox.x, G.airValve.y], '#9e9e9e', 4);
        // 电磁阀箱
        const SB = G.solBox;
        g.add(new Konva.Rect({ x: SB.x, y: SB.y, width: SB.w, height: SB.h, cornerRadius: 4, fill: '#eceff1', stroke: '#546e7a', strokeWidth: 1.5 }));
        this._label(g, SB.x + 6, SB.y + 5, '控制空气电磁阀箱', 12, '#37474f', true);
        // 控制空气出线（至 V1 / V4 / V5 执行机构）不再绘制管路

        // 净油出口阀 V4（水平管路，控制空气驱动）
        this._drawActuatedValve(G.v4.x, G.v4.y, 'V4', 'air-close');
        // 出水阀 V5（水平管路）
        this._drawActuatedValve(G.v5.x + G.v5.w / 2, G.bowl.cy - 7, 'V5', 'air-open');

        // 状态栏按钮：下一步 / 自动停止
        g.add(new Konva.Rect({ x: 830, y: 26, width: 90, height: 38, cornerRadius: 6, fillLinearGradientStartPoint: { x: 830, y: 26 }, fillLinearGradientEndPoint: { x: 830, y: 64 }, fillLinearGradientColorStops: [0, '#2f7fd4', 1, '#1565c0'], stroke: '#0d3d73', strokeWidth: 1.5 }));
        this._label(g, 830, 36, '下一步', 13, '#ffffff', true, 'center', 90);
        g.add(new Konva.Rect({ x: 928, y: 26, width: 84, height: 38, cornerRadius: 6, fillLinearGradientStartPoint: { x: 928, y: 26 }, fillLinearGradientEndPoint: { x: 928, y: 64 }, fillLinearGradientColorStops: [0, '#d84343', 1, '#b71c1c'], stroke: '#6d0f0f', strokeWidth: 1.5 }));
        this._label(g, 928, 36, '自动停止', 13, '#ffffff', true, 'center', 84);

        // 分油机本体
        this._drawSeparatorStatic(g);
    }

    _drawSeparatorStatic(g) {
        const G = this._geo, B = G.bowl;
        const cx = B.cx, cy = B.cy, r = B.r, k = 2 / 3;

        // 机架
        g.add(new Konva.Rect({ x: cx - 160 * k, y: cy + 186 * k, width: 320 * k, height: 34 * k, cornerRadius: 3, fill: '#546e7a', stroke: '#37474f', strokeWidth: 2 }));
        g.add(new Konva.Rect({ x: cx - 128 * k, y: cy + 220 * k, width: 256 * k, height: 18 * k, fill: '#455a64' }));
        // 电机
        g.add(new Konva.Rect({ x: cx + 118 * k, y: cy + 126 * k, width: 78 * k, height: 66 * k, cornerRadius: 4, fill: '#78909c', stroke: '#37474f', strokeWidth: 2 }));
        this._label(g, cx + 130 * k, cy + 196 * k, 'M', 11, '#263238', true, 'center', 30);
        // 皮带护罩
        g.add(new Konva.Line({ points: [cx + 160 * k, cy + 160 * k, cx + 46 * k, cy + 200 * k, cx + 46 * k, cy + 184 * k, cx + 160 * k, cy + 144 * k], closed: true, fill: '#90a4ae', stroke: '#546e7a', strokeWidth: 1.5 }));
        // 立轴
        g.add(new Konva.Rect({ x: cx - 7 * k, y: cy + 60 * k, width: 14 * k, height: 130 * k, fill: '#90a4ae', stroke: '#546e7a', strokeWidth: 1.5 }));
        // 外壳
        g.add(new Konva.Circle({ x: cx, y: cy, radius: r + 11, fill: '#cfd8dc', stroke: '#546e7a', strokeWidth: 2.5 }));
        g.add(new Konva.Circle({ x: cx, y: cy, radius: r, fill: '#eceff1', stroke: '#78909c', strokeWidth: 2 }));
        // 筒盖
        g.add(new Konva.Arc({ x: cx, y: cy, innerRadius: r - 3, outerRadius: r + 8, angle: 180, rotation: 180, fill: '#b0bec5', stroke: '#546e7a', strokeWidth: 2 }));
        // 锁紧环
        g.add(new Konva.Rect({ x: cx - r - 11, y: cy - 5, width: 2 * (r + 11), height: 9, fill: '#78909c', stroke: '#455a64', strokeWidth: 1 }));
        // 进油/水封水由左上 45° 口进入，机内不画管路（进油管至筒壁即止）
        // 向心泵/向心盘
        g.add(new Konva.Rect({ x: cx - 5 * k, y: cy - 80 * k, width: 10 * k, height: 58 * k, fill: '#ffb74d', stroke: '#ef6c00', strokeWidth: 1.5 }));
        g.add(new Konva.Circle({ x: cx, y: cy - 85 * k, radius: 11 * k, fill: '#ffcc80', stroke: '#ef6c00', strokeWidth: 1.5 }));
        // 净油出口：由向心泵顶部引出，与外部净油管在筒壁处对接
        g.add(new Konva.Line({ points: [cx, cy - 62, cx, cy - 69, cx + 100, cy - 69], stroke: '#c48b2c', strokeWidth: 4, lineJoin: 'round' }));
        // 出水口：机内出水腔与外部出水管在筒壁处对接
        g.add(new Konva.Line({ points: [cx + 44, cy + 23, cx + 100, cy + 23], stroke: '#9bd7f5', strokeWidth: 3 }));
        // 排渣口
        g.add(new Konva.Rect({ x: cx - 20 * k, y: cy + r - 3, width: 40 * k, height: 9 * k, fill: '#8d6e63', stroke: '#5d4037', strokeWidth: 1 }));
        // 底部标签
        this._label(g, cx + 16, cy + 166, 'S 936 · 7.5 kW', 12, '#546e7a', false, 'left', 0);

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
            const t = new Konva.Text({ x: b.x - 10, y: b.y + b.h + 6, width: b.w + 20, height: 20, text: '0%', fontSize: 13, align: 'center', fill: '#37474f', fontFamily: 'Consolas, monospace' });
            d.add(t);
            this._tankLabels[id] = t;
        });

        // 泵叶轮 / 电机风扇
        this._impeller = new Konva.Group({ x: G.pump.x + G.pump.w / 2, y: G.pump.y + G.pump.h / 2 });
        for (let i = 0; i < 3; i++) {
            this._impeller.add(new Konva.Line({ points: [0, 0, 16, -6], stroke: '#455a64', strokeWidth: 4, lineCap: 'round', rotation: i * 120 }));
        }
        d.add(this._impeller);
        this._motorFan = new Konva.Group({ x: cx + 105, y: cy + 106 });
        for (let i = 0; i < 4; i++) {
            this._motorFan.add(new Konva.Line({ points: [0, 0, 12, -3], stroke: '#eceff1', strokeWidth: 2.5, lineCap: 'round', rotation: i * 90 }));
        }
        d.add(this._motorFan);

        // 加热器发光
        this._heaterGlow = new Konva.Rect({ x: G.heater.x + 16, y: G.heater.y + 16, width: G.heater.w - 32, height: G.heater.h - 32, cornerRadius: 3, fill: '#ff9800', opacity: 0 });
        d.add(this._heaterGlow);

        // 蒸汽电动调节阀（M 与阀体颜色随加热状态变化，右侧显示开度）
        this._drawMotorValve(545, 370);
        this._drawSteamCheckValve(400, 370);
        this._drawHandValveDyn('steam-inlet', 620, 370, '截止阀');

        this._valveNodes = {};

        // 手动截止阀：沉淀柜出口、V1 回流
        this._handValves = this._handValves || {};
        this._drawHandValveDyn('dirty-outlet', 165, G.dirty.y + G.dirty.h - 40, '出口阀');
        this._drawHandValveDyn('return', 400, 90, '回流阀');

        // 供油泵反并联单向阀
        this._checkValve = this._drawCheckValveDyn(G.pump.x + G.pump.w / 2, G.pump.y + G.pump.h / 2 + 55);
        // 压力水柜出口手动截止阀
        this._drawHandValveDyn('water-inlet', G.waterValve.x, G.waterValve.y, '供水阀');

        // 工作水电磁阀箱内 SV10 / SV15 / SV16
        this._waterSolenoids = [];
        [['SV10', G.sv10], ['SV15', G.sv15], ['SV16', G.sv16]].forEach(([label, b]) => {
            const x = b.x, y = b.y + b.h / 2 - 12;
            const coil = new Konva.Rect({ x, y, width: 40, height: 24, cornerRadius: 3, fill: '#ffffff', stroke: '#37474f', strokeWidth: 1.2 });
            const led = new Konva.Circle({ x: x + 4, y: y + 4, radius: 3, fill: '#2b2f2f', stroke: '#111', strokeWidth: 0.8 });
            const txt = new Konva.Text({ x: b.x + b.w + 4, y: b.y + b.h / 2 - 8, text: label, fontSize: 12, align: 'left', fill: '#37474f', fontFamily: 'Arial' });
            d.add(coil, led, txt);
            this._waterSolenoids.push({ label, coil, led });
        });
        // 控制空气手动截止阀
        this._drawHandValveDyn('air-inlet', G.airValve.x, G.airValve.y, '控制空气');

        // 电磁阀箱：SV1 / SV4 / SV5
        this._solCoils = [];
        [['SV1', 0], ['SV4', 1], ['SV5', 2]].forEach(([label, i]) => {
            const x = G.solBox.x + 42, y = G.solBox.y + 44 + i * 48;
            const coil = new Konva.Rect({ x, y, width: 40, height: 24, cornerRadius: 3, fill: '#ffffff', stroke: '#37474f', strokeWidth: 1.2 });
            const led = new Konva.Circle({ x: x + 4, y: y + 4, radius: 3, fill: '#2b2f2f', stroke: '#111', strokeWidth: 0.8 });
            const txt = new Konva.Text({ x: x + 44, y: y + 5, text: label, fontSize: 12, align: 'left', fill: '#37474f', fontFamily: 'Arial' });
            d.add(coil, led, txt);
            this._solCoils.push({ label, coil, led });
        });



        // 液位/流动
        this._oilFlowA = new Konva.Line({
            points: [G.dirty.x + G.dirty.w, G.dirty.y + G.dirty.h - 40,
                148, G.dirty.y + G.dirty.h - 40],
            stroke: '#ffb300', strokeWidth: 3, dash: [8, 12], dashOffset: 0, opacity: 0,
        });
        d.add(this._oilFlowA);

        this._oilFlow = new Konva.Line({
            points: [182, G.dirty.y + G.dirty.h - 40,
                200, G.dirty.y + G.dirty.h - 40,
                200, G.pump.y + G.pump.h / 2,
                G.pump.x + G.pump.w / 2 - 28, G.pump.y + G.pump.h / 2,
                G.pump.x + G.pump.w / 2 + 28, G.pump.y + G.pump.h / 2, G.filter.x, G.filter.y + 24,
                G.filter.x + 48, G.filter.y + 24, G.heater.x, G.heater.y + 52,
                G.heater.x + G.heater.w, G.heater.y + 52, G.v1.x, G.v1.y + G.v1.h / 2,
                G.v1.x + G.v1.w / 2, G.v1.y + G.v1.h / 2],
            stroke: '#ffb300', strokeWidth: 3, dash: [8, 12], dashOffset: 0, opacity: 0,
        });
        d.add(this._oilFlow);

        this._sepFlow = new Konva.Line({
            points: [G.v1.x + G.v1.w / 2, G.v1.y + G.v1.h / 2,
                G.v1.x + G.v1.w, G.v1.y + G.v1.h / 2,
                cx - r * 0.707, cy - r * 0.707],
            stroke: '#ffb300', strokeWidth: 3, dash: [8, 12], dashOffset: 0, opacity: 0,
        });
        d.add(this._sepFlow);

        this._returnFlow = new Konva.Line({
            points: [G.v1.x + G.v1.w / 2, G.v1.y - 24,
                G.v1.x + G.v1.w / 2, 90, 417, 90],
            stroke: '#ffb300', strokeWidth: 3, dash: [8, 12], dashOffset: 0, opacity: 0,
        });
        d.add(this._returnFlow);

        this._returnFlowB = new Konva.Line({
            points: [383, 90, G.dirty.x + G.dirty.w, 90],
            stroke: '#ffb300', strokeWidth: 3, dash: [8, 12], dashOffset: 0, opacity: 0,
        });
        d.add(this._returnFlowB);

        // 出口阀/回流阀关闭时的内部循环（泵出口 → 单向阀 → 泵入口）
        this._checkFlow = new Konva.Line({
            points: [G.pump.x + G.pump.w / 2 + 28, G.pump.y + G.pump.h / 2,
                G.pump.x + G.pump.w / 2 + 28, G.pump.y + G.pump.h / 2 + 55,
                G.pump.x + G.pump.w / 2 - 28, G.pump.y + G.pump.h / 2 + 55,
                G.pump.x + G.pump.w / 2 - 28, G.pump.y + G.pump.h / 2],
            stroke: '#ffb300', strokeWidth: 3, dash: [8, 12], dashOffset: 0, opacity: 0,
        });
        d.add(this._checkFlow);

        this._cleanFlow = new Konva.Line({
            points: [cx + 50, cy - 69, cx + 100, cy - 69, cx + 100, 200, G.clean.x, 200],
            stroke: '#ffca28', strokeWidth: 3, dash: [8, 12], dashOffset: 0, opacity: 0,
        });
        d.add(this._cleanFlow);

        this._waterSupplyFlow = new Konva.Line({
            points: [G.waterTank.x + G.waterTank.w, G.waterValve.y,
                G.waterValve.x, G.waterValve.y, G.waterBox.x, G.waterValve.y],
            stroke: '#0d47a1', strokeWidth: 4, dash: [8, 12], dashOffset: 0, opacity: 0,
        });
        d.add(this._waterSupplyFlow);

        const upperPort = { x: cx - r * 0.707, y: cy - r * 0.707 };
        const lowerPort = { x: cx - r * 0.707, y: cy + r * 0.707 };
        this._sealFlow = new Konva.Line({
            points: [G.waterBox.x + G.waterBox.w, G.waterBox.y + 60, upperPort.x, upperPort.y],
            stroke: '#0d47a1', strokeWidth: 4, dash: [8, 12], dashOffset: 0, opacity: 0,
        });
        d.add(this._sealFlow);

        this._waterOutFlow = new Konva.Line({
            points: [G.waterBox.x + G.waterBox.w, G.waterBox.y + 120, lowerPort.x, lowerPort.y],
            stroke: '#0d47a1', strokeWidth: 4, dash: [8, 12], dashOffset: 0, opacity: 0,
        });
        d.add(this._waterOutFlow);

        this._drainFlow = new Konva.Line({
            points: [G.v5.x + G.v5.w / 2 + 16, cy - 7, 1075, cy - 7, 1075, G.waterTray.y + 4],
            stroke: '#0d47a1', strokeWidth: 4, dash: [8, 12], dashOffset: 0, opacity: 0,
        });
        d.add(this._drainFlow);

        this._sludgeFlow = new Konva.Line({
            points: [cx, cy + r, cx, G.sludge.y + 30, G.sludge.x, G.sludge.y + 30],
            stroke: '#8d6e63', strokeWidth: 5, dash: [10, 10], dashOffset: 0, opacity: 0,
        });
        d.add(this._sludgeFlow);

        // 分离筒内水体（置换水充筒动画）
        this._bowlWater = new Konva.Group({ x: cx, y: cy, clipFunc: (ctx) => { ctx.arc(0, 0, r - 6, 0, Math.PI * 2, false); } });
        this._bowlWaterRect = new Konva.Rect({ x: -(r - 6), y: r - 6, width: 2 * (r - 6), height: 0, fill: '#4fc3f7', opacity: 0.5 });
        this._bowlWater.add(this._bowlWaterRect);
        d.add(this._bowlWater);

        // 分离筒内部动态
        this._discStack = new Konva.Group({ x: cx, y: cy });
        for (let i = -6; i <= 6; i++) {
            this._discStack.add(new Konva.Line({ points: [-57, i * 7.3, 57, i * 7.3], stroke: '#90a4ae', strokeWidth: 1.4 }));
        }
        this._discStack.add(new Konva.Line({ points: [0, -61, 0, 61], stroke: '#607d8b', strokeWidth: 2.5 }));
        d.add(this._discStack);

        this._sludgeLayer = new Konva.Arc({ x: cx, y: cy, innerRadius: r - 28, outerRadius: r - 8, angle: 300, rotation: 30, fill: '#8d6e63', opacity: 0.85 });
        d.add(this._sludgeLayer);
        this._waterSeal = new Konva.Arc({ x: cx, y: cy, innerRadius: r - 51, outerRadius: r - 33, angle: 300, rotation: 30, fill: '#4fc3f7', opacity: 0.85 });
        // 底盘下部的密封水层（SV16 关闭水建立）
        this._sealWaterLayer = new Konva.Arc({ x: cx, y: cy, innerRadius: r - 12, outerRadius: r - 2, angle: 120, rotation: 30, fill: '#81d4fa', opacity: 0 });
        d.add(this._sealWaterLayer);
        // SV15 通电（开启水）时，工作水在排渣底盘附近聚集
        this._opWaterPool = new Konva.Ellipse({ x: cx, y: cy + r - 26, radiusX: 42, radiusY: 11, fill: '#4fc3f7', opacity: 0 });
        d.add(this._opWaterPool);
        d.add(this._waterSeal);
        this._oilLayer = new Konva.Arc({ x: cx, y: cy, innerRadius: r - 67, outerRadius: r - 53, angle: 300, rotation: 30, fill: '#ffca28', opacity: 0.6 });
        d.add(this._oilLayer);

        // 滑动底盘
        this._slide = new Konva.Rect({ x: cx - 44, y: cy + r - 12, width: 88, height: 7, fill: '#78909c', stroke: '#455a64', strokeWidth: 1 });
        d.add(this._slide);
        // 排渣闪光
        this._dischargeFlash = new Konva.Circle({ x: cx, y: cy + r + 3, radius: 17, fill: '#ffb300', opacity: 0, listening: false });
        d.add(this._dischargeFlash);
        // 漏油痕迹
        this._leakStreak = new Konva.Line({ points: [cx - 27, cy + r - 4, cx - 35, cy + r + 27, cx - 29, cy + r + 48], stroke: '#5d4037', strokeWidth: 5, lineCap: 'round', opacity: 0 });
        d.add(this._leakStreak);

        // 仪表数值
        this._gaugeTexts = {};
        [['pt1', G.pt1], ['tt1', G.tt1], ['pt4', G.pt4], ['mt', G.mt], ['pt5', G.pt5], ['st', G.st], ['vt', G.vt]].forEach(([id, b]) => {
            const t = new Konva.Text({
                x: b.x + 5, y: b.y + 21, width: b.w - 10, height: 24,
                text: '--', fontSize: 15, align: 'center', fill: '#6dff9a',
                fontFamily: 'Consolas, monospace',
            });
            d.add(t);
            this._gaugeTexts[id] = t;
        });

        // 状态文字
        this._statusText = new Konva.Text({
            x: 610, y: 28, width: 200, height: 34,
            text: '', fontSize: 18, fill: '#1b5e20',
            fontFamily: 'Consolas, "Microsoft YaHei", monospace',
        });
        d.add(this._statusText);
        // 状态下一行：Ti68 期间的「进补偿水」/「排水」
        this._statusSub = new Konva.Text({
            x: 610, y: 52, width: 200, height: 22,
            text: '', fontSize: 15, fill: '#0277bd',
            fontFamily: '"Microsoft YaHei", Consolas, monospace',
        });
        d.add(this._statusSub);
    }

    _drawV1Valve() {
        // 动态节点：颜色随阀门状态变化，不能放进静态缓存层
        const g = this._dynamicGroup;
        const v = this._geo.v1;
        const hx = v.x + v.w / 2, hy = v.y + v.h / 2;
        const L = v.x, R = v.x + v.w, T = v.y;
        const hh = 13, tw = 13;

        // 三个三角形阀口：上（回油）、左（进油）、右（供油）
        this._v1Top = new Konva.Line({ points: [hx - tw, T, hx + tw, T, hx, hy], closed: true, fill: '#ffffff', stroke: '#263238', strokeWidth: 3, lineJoin: 'round' });
        this._v1Left = new Konva.Line({ points: [L, hy - hh, L, hy + hh, hx, hy], closed: true, fill: '#ffffff', stroke: '#263238', strokeWidth: 3, lineJoin: 'round' });
        this._v1Right = new Konva.Line({ points: [R, hy - hh, R, hy + hh, hx, hy], closed: true, fill: '#ffffff', stroke: '#263238', strokeWidth: 3, lineJoin: 'round' });
        g.add(this._v1Top, this._v1Left, this._v1Right);

        // 下方弧形室（气动接口）：封口的半圆腔体
        const arcY = hy + 19;
        this._v1Arc = new Konva.Path({
            x: hx, y: arcY,
            data: 'M -11 0 A 11 11 0 0 0 11 0 Z',
            fill: '#ffffff', stroke: '#263238', strokeWidth: 3, lineJoin: 'round',
        });
        g.add(this._v1Arc);
        // 阀杆连到弧形室顶边
        g.add(new Konva.Line({ points: [hx, hy, hx, arcY], stroke: '#263238', strokeWidth: 3 }));

        // 顶部接口接回油管
        g.add(new Konva.Line({ points: [hx, T, hx, v.y - 24], stroke: '#8d3f31', strokeWidth: 4 }));

        this._label(g, hx - 30, arcY + 17, '三通阀 V1', 12, '#37474f', true, 'center', 60);
    }

    // 两色线性插值（t: 0~1）
    _lerpColor(a, b, t) {
        const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
        const r = Math.round(((pa >> 16) & 255) + ((((pb >> 16) & 255) - ((pa >> 16) & 255)) * t));
        const g = Math.round(((pa >> 8) & 255) + ((((pb >> 8) & 255) - ((pa >> 8) & 255)) * t));
        const bl = Math.round((pa & 255) + (((pb & 255) - (pa & 255)) * t));
        return `rgb(${r},${g},${bl})`;
    }

    // 电动调节阀：蝶形阀体 + 上方电动执行机构（M），M 与阀体颜色随加热状态变化
    _drawMotorValve(x, y) {
        const g = this._dynamicGroup;
        const hw = 14, hh = 10;
        const t1 = new Konva.Line({ points: [x - hw, y - hh, x - hw, y + hh, x, y, x - hw, y - hh], closed: true, fill: '#ffffff', stroke: '#263238', strokeWidth: 2.5 });
        const t2 = new Konva.Line({ points: [x + hw, y - hh, x + hw, y + hh, x, y, x + hw, y - hh], closed: true, fill: '#ffffff', stroke: '#263238', strokeWidth: 2.5 });
        g.add(t1, t2);
        // 阀杆：由阀体中心一直连到执行机构
        g.add(new Konva.Line({ points: [x, y, x, y - 26], stroke: '#263238', strokeWidth: 2 }));
        const box = new Konva.Rect({ x: x - 11, y: y - 41, width: 22, height: 15, cornerRadius: 2, fill: '#eceff1', stroke: '#263238', strokeWidth: 1.5 });
        g.add(box);
        const mTxt = new Konva.Text({ x: x - 11, y: y - 38, width: 22, text: 'M', fontSize: 10, align: 'center', fill: '#111', fontStyle: 'bold', fontFamily: 'Arial' });
        g.add(mTxt);
        // 右侧开度显示
        const openText = new Konva.Text({ x: x + 15, y: y - 40, width: 46, text: '0%', fontSize: 11, align: 'left', fill: '#a5d6a7', fontFamily: 'Consolas, monospace' });
        g.add(openText);
        this._steamValve = { t1, t2, box, mTxt, openText };
    }

    // 凝水单向阀：通汽时右侧三角形填充绿色表示导通
    _drawSteamCheckValve(x, y) {
        const g = this._dynamicGroup;
        const hw = 12, hh = 9;
        const left = new Konva.Line({ points: [x - hw, y - hh, x - hw, y + hh, x, y, x - hw, y - hh], closed: true, fill: '#cfd8dc', stroke: '#263238', strokeWidth: 2 });
        const right = new Konva.Line({ points: [x + hw, y - hh, x + hw, y + hh, x, y, x + hw, y - hh], closed: true, fill: '#ffffff', stroke: '#263238', strokeWidth: 2 });
        g.add(left, right);
        this._steamCheck = { left, right };
    }

    // 气动阀：蝶形阀体 + 上方气动弧形室（膜头）
    // mode: 'air-close' 气关阀（V4，有气关阀）、'air-open' 气开阀（V5，有气开阀）
    _drawActuatedValve(x, y, label, mode) {
        const g = this._dynamicGroup;
        const hw = 16, hh = 13;
        const t1 = new Konva.Line({ points: [x - hw, y - hh, x - hw, y + hh, x, y, x - hw, y - hh], closed: true, fill: '#ffffff', stroke: '#263238', strokeWidth: 3, lineJoin: 'round' });
        const t2 = new Konva.Line({ points: [x + hw, y - hh, x + hw, y + hh, x, y, x + hw, y - hh], closed: true, fill: '#ffffff', stroke: '#263238', strokeWidth: 3, lineJoin: 'round' });
        g.add(t1, t2);
        const stemTop = y - 19;      // 与三通阀 V1 的执行接口连杆长度一致（19px）
        g.add(new Konva.Line({ points: [x, y, x, stemTop], stroke: '#263238', strokeWidth: 3 }));
        const arc = new Konva.Path({
            x, y: stemTop,
            data: 'M -11 0 A 11 11 0 0 1 11 0 Z',
            fill: '#ffffff', stroke: '#263238', strokeWidth: 3, lineJoin: 'round',
        });
        g.add(arc);
        this._label(g, x - 22, y + hh + 5, label, 12, '#263238', true, 'center', 44);
        if (!this._actValves) this._actValves = {};
        this._actValves[label] = { t1, t2, arc, mode };
    }

    _drawHandValveDyn(id, x, y, label) {
        const g = new Konva.Group({ x, y, rotation: 0 });
        const hw = 16, hh = 11;
        const t1 = new Konva.Line({ points: [-hw, -hh, -hw, hh, 0, 0, -hw, -hh], closed: true, fill: '#ffffff', stroke: '#b71c1c', strokeWidth: 2 });
        const t2 = new Konva.Line({ points: [hw, -hh, hw, hh, 0, 0, hw, -hh], closed: true, fill: '#ffffff', stroke: '#b71c1c', strokeWidth: 2 });
        g.add(t1, t2);
        g.add(new Konva.Line({ points: [0, 0, 0, -21], stroke: '#37474f', strokeWidth: 2 }));
        g.add(new Konva.Line({ points: [-10, -23, 10, -23], stroke: '#37474f', strokeWidth: 3, lineCap: 'round' }));
        const txt = new Konva.Text({ x: -34, y: -40, width: 68, text: label, fontSize: 12, align: 'center', fill: '#37474f', fontFamily: 'Arial, "Microsoft YaHei", sans-serif' });
        g.add(txt);
        this._dynamicGroup.add(g);
        if (!this._handValves) this._handValves = {};
        this._handValves[id] = { group: g, bodies: [t1, t2], handle: txt, open: true };
        return g;
    }

    _drawCheckValveDyn(x, y) {
        const g = new Konva.Group({ x, y });
        const hw = 16, hh = 11;
        // 与截止阀相同的蝶形阀体；左侧三角形灰色填充，右侧白色
        const left = new Konva.Line({
            points: [-hw, -hh, -hw, hh, 0, 0, -hw, -hh], closed: true,
            fill: '#9e9e9e', stroke: '#b71c1c', strokeWidth: 2,
        });
        const right = new Konva.Line({
            points: [hw, -hh, hw, hh, 0, 0, hw, -hh], closed: true,
            fill: '#ffffff', stroke: '#b71c1c', strokeWidth: 2,
        });
        g.add(left, right);
        // 中间不是手柄，而是弹簧：压力达到阈值后才导通
        g.add(new Konva.Line({ points: [0, 0, 0, -16], stroke: '#37474f', strokeWidth: 2 }));
        const spring = new Konva.Line({
            points: [0, -16, -5, -19, 5, -22, -5, -25, 5, -28, -5, -31, 0, -34],
            stroke: '#e65100', strokeWidth: 2, lineCap: 'round',
        });
        g.add(spring);
        g.add(new Konva.Line({
            points: [26, 16, -26, 16], stroke: '#37474f', strokeWidth: 1.4,
        }));
        g.add(new Konva.Line({
            points: [-26, 16, -19, 12, -19, 20], closed: true, fill: '#37474f',
        }));
        this._dynamicGroup.add(g);
        return { group: g, left, right, spring };
    }

    _toggleManual(id) {
        const s = this._solver();
        if (!s) return;
        // 页 2 系统图不设调试模式：手动截止阀始终可操作
        if (id === 'dirty-outlet') s.setManualValve('dirty-outlet', !s.m.feed.dirtyValveOpen);
        else if (id === 'return') s.setManualValve('return', !s.m.feed.returnValveOpen);
        this._syncVisuals();
    }

    _bindInteraction() {
        const G = this._geo;
        const sepHit = this.addClickablePart('separator', G.sep.x, G.sep.y, G.sep.w, G.sep.h, false);
        if (sepHit) {
            sepHit.off('mouseenter mouseleave');
            const bg = sepHit.getParent() && sepHit.getParent().getChildren()[0];
            if (bg && bg.fill) bg.fill('rgba(0,0,0,0)');
        }
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
        this.addClickablePart('dirty-outlet-valve', 165 - 26, G.dirty.y + G.dirty.h - 40 - 30, 52, 60, true)
            .on('click tap', () => this._toggleManual('dirty-outlet'));
        this.addClickablePart('return-valve', 400 - 26, 90 - 30, 52, 60, true)
            .on('click tap', () => this._toggleManual('return'));
        this.addClickablePart('pump-check', G.pump.x + G.pump.w / 2 - 26, G.pump.y + G.pump.h / 2 + 55 - 30, 52, 60, true)
            .on('click tap', () => { const s = this._solver(); if (s && this.sys && this.sys._tipPurifier) this.sys._tipPurifier('单向阀由出口压力自动开启，用于限制泵输出压力'); });
        this.addClickablePart('water-inlet', G.waterValve.x - 26, G.waterValve.y - 30, 52, 60, true)
            .on('click tap', () => { const s = this._solver(); if (s) s.toggleWaterMain(); this._syncVisuals(); });
        this.addClickablePart('next-step', 830, 26, 90, 38, true)
            .on('click tap', () => { const s2 = this._solver(); if (s2) s2.nextStep(); this._syncVisuals(); });
        this.addClickablePart('auto-stop', 928, 26, 84, 38, true)
            .on('click tap', () => { const s2 = this._solver(); if (s2) s2.requestAutoStop(); this._syncVisuals(); });
        this.addClickablePart('steam-inlet', 620 - 26, 370 - 30, 52, 60, true)
            .on('click tap', () => { const s = this._solver(); if (s) s.toggleSteamValve(); this._syncVisuals(); });
        this.addClickablePart('air-inlet', G.airValve.x - 26, G.airValve.y - 30, 52, 60, true)
            .on('click tap', () => { const s = this._solver(); if (s) s.toggleAirMain(); this._syncVisuals(); });
        this.addClickablePart('pt1', G.pt1.x, G.pt1.y, G.pt1.w, G.pt1.h, true);
        this.addClickablePart('tt1', G.tt1.x, G.tt1.y, G.tt1.w, G.tt1.h, true);
        this.addClickablePart('pt4', G.pt4.x, G.pt4.y, G.pt4.w, G.pt4.h, true);
        this.addClickablePart('mt', G.mt.x, G.mt.y, G.mt.w, G.mt.h, true);
        this.addClickablePart('pt5', G.pt5.x, G.pt5.y, G.pt5.w, G.pt5.h, true);
        this.addClickablePart('st', G.st.x, G.st.y, G.st.w, G.st.h, true);
        this.addClickablePart('vt', G.vt.x, G.vt.y, G.vt.w, G.vt.h, true);
    }

    _manualPump() {
        const s = this._solver();
        if (!s) return;
        if (!s.m.local) { s._tip('AUTO/EPC 方式下供油泵由控制器控制；请把机旁控制模式打到 HAND'); return; }
        s.toggleFeedPump();
        this._syncVisuals();
    }

    _manualHeater() {
        const s = this._solver();
        if (!s) return;
        if (!s.m.local) { s._tip('AUTO/EPC 方式下加热器由控制器控制；请把机旁控制模式打到 HAND'); return; }
        s.toggleHeater();
        this._syncVisuals();
    }

    _syncVisuals() {
        const s = this._solver();
        const m = s ? s.m : null;
        if (!m) return;
        const G = this._geo, B = G.bowl;
        const cx = B.cx, cy = B.cy, r = B.r;

        // 手动截止阀 / 单向阀状态
        if (this._handValves) {
            const states = { 'dirty-outlet': m.feed.dirtyValveOpen, 'return': m.feed.returnValveOpen, 'air-inlet': m.water.airMainOpen, 'water-inlet': m.water.mainOpen, 'steam-inlet': m.feed.steamValveOpen };
            Object.keys(this._handValves).forEach(id => {
                const hv = this._handValves[id];
                const open = !!states[id];
                hv.bodies.forEach(b => { b.fill(open ? '#2e7d32' : '#ffffff'); b.stroke(open ? '#1b5e20' : '#b71c1c'); });
            });
        }
        // 蒸汽电动调节阀：加热时 M 红、阀体绿，右侧显示开度（淡绿→深绿）
        if (this._steamValve) {
            const sv = this._steamValve;
            // 调节器投入即线圈带电；开度 > 0 即阀体导通（关截止阀不会让调节阀关闭）
            const ctrlOn = !!(m.feed.heaterOn && m.mainPower);
            const open = clamp(m.tempCtrl.valve || 0, 0, 100);
            const vOpen = ctrlOn && open > 0.5;
            sv.box.fill(ctrlOn ? '#e53935' : '#eceff1');
            sv.mTxt.fill(ctrlOn ? '#ffffff' : '#111111');
            sv.t1.fill(vOpen ? '#2e7d32' : '#ffffff');
            sv.t2.fill(vOpen ? '#2e7d32' : '#ffffff');
            sv.openText.text(`${Math.round(open)}%`);
            sv.openText.fill(this._lerpColor('#a5d6a7', '#1b5e20', clamp((open - 10) / 90, 0, 1)));

            // 实际有蒸汽流动（截止阀打开且有开度）时凝水单向阀才导通
            if (this._steamCheck) {
                const flowing = !!(m.feed.steamValveOpen && vOpen);
                this._steamCheck.right.fill(flowing ? '#2e7d32' : '#ffffff');
            }
        }

        // 电磁阀：有电红色填充
        // SV1 与 V1 联动（有电→V1 有气→向分油机供油）
        // SV4 与 V4 联动（有电→V4 有气→气关阀关闭）
        // SV5 与 V5 联动（有电→V5 有气→气开阀导通）
        // 控制空气：EPC 主电源接通后电磁阀才可能得电
        // 控制空气：主电源接通且分离程序已投入（起动程序/分油/排渣/停机）才送气，
        // 未按「分离起动 I」之前所有电磁阀均不动作
        const progActive = m.state === 'START_SEQ' || m.state === 'SEPARATION'
            || m.state === 'DISCHARGE' || m.state === 'STOPPING';
        const airOk = !!m.mainPower && progActive;
        const sv1On = airOk && !!m.feed.valveOpen;            // V1 有气 → 向分油机供油
        const sv4On = airOk && !m.oil.outletValveOpen;        // V4 有气 → 气关阀关闭
        const sv5On = airOk && !!m.water.drain;               // V5 有气 → 气开阀导通
        if (this._solCoils) {
            const solStates = [sv1On, sv4On, sv5On];
            this._solCoils.forEach((c, i) => {
                c.led.fill(solStates[i] ? '#28e05a' : '#2b2f2f');
                c.coil.fill(solStates[i] ? '#e53935' : '#ffffff');
            });
        }
        if (this._waterSolenoids) {
            const ws = [m.water.sv10, m.water.sv15, m.water.sv16];
            this._waterSolenoids.forEach((c, i) => {
                c.led.fill(ws[i] ? '#28e05a' : '#2b2f2f');
                c.coil.fill(ws[i] ? '#e53935' : '#ffffff');
            });
        }

        if (this._checkValve) {
            this._checkValve.left.fill('#9e9e9e');
            this._checkValve.left.stroke(m.feed.checkOpen ? '#2e7d32' : '#b71c1c');
            this._checkValve.right.fill(m.feed.checkOpen ? '#2e7d32' : '#ffffff');
            this._checkValve.right.stroke(m.feed.checkOpen ? '#1b5e20' : '#b71c1c');
            this._checkValve.spring.stroke(m.feed.checkOpen ? '#2e7d32' : '#e65100');
        }

        // 液位
        this._setTank('dirty', m.oil.dirty);
        this._setTank('clean', m.oil.clean);
        this._setTank('sludge', m.sludge.tank);

        // 泵/电机/加热器
        const pumpRunning = !!(m.feed.pumpOn && m.mainPower);
        this._impPhase = ((this._impPhase || 0) + (pumpRunning ? 7 : 0)) % 360;
        this._impeller.rotation(this._impPhase);
        this._motorFan.rotation(m.motor.on ? (m.bowl.discRot * 60) % 360 : 0);
        this._heaterGlow.opacity((m.feed.heaterOn && m.mainPower && m.feed.steamValveOpen) ? 0.35 + 0.25 * Math.sin((performance.now ? performance.now() : Date.now()) / 300) : 0);

        // 阀门
        const valveState = { sv10: m.water.sv10, sv15: m.water.sv15, sv16: m.water.sv16, v5: m.water.drain };
        Object.keys(this._valveNodes).forEach(id => {
            const open = !!valveState[id];
            this._valveNodes[id].rotation(open ? 90 : 0);
            this._valveNodes[id].children[0].stroke(open ? '#1b5e20' : '#263238');
        });

        // 气动阀 V4 / V5：弧形室 = 有气（蓝）；阀体三角形 = 导通（绿）
        if (this._actValves) {
            // V4 气关阀：无气（默认）导通；V5 气开阀：有气才导通
            const st = {
                V4: { air: sv4On, open: !sv4On },
                V5: { air: sv5On, open: sv5On },
            };
            Object.keys(this._actValves).forEach(k => {
                const v = this._actValves[k];
                const q = st[k] || { air: false, open: false };
                v.arc.fill(q.air ? '#1e88e5' : '#ffffff');
                const f = q.open ? '#2e7d32' : '#ffffff';
                v.t1.fill(f);
                v.t2.fill(f);
            });
        }

        // 三通阀 V1：供油 = 左/右三角绿色 + 弧形室蓝色；回油 = 左/上三角绿色
        if (this._v1Left) {
            const feeding = !!m.feed.valveOpen;
            this._v1Left.fill('#2e7d32');
            if (feeding) {
                this._v1Right.fill('#2e7d32');
                this._v1Top.fill('#ffffff');
                this._v1Arc.fill('#1e88e5');
            } else {
                this._v1Right.fill('#ffffff');
                this._v1Top.fill('#2e7d32');
                this._v1Arc.fill('#ffffff');
            }
        }

        // 流动
        const pumpOn = !!(m.feed.pumpOn && m.mainPower);
        const oilOn = pumpOn && (m.feed.flow > 0.02 || m.feed.returnFlow > 0.02);
        this._oilFlow.opacity(oilOn ? 0.95 : 0);
        this._oilFlowA.opacity(oilOn ? 0.95 : 0);
        this._sepFlow.opacity(m.feed.flow > 0.02 ? 0.95 : 0);
        this._returnFlow.opacity(m.feed.returnFlow > 0.02 ? 0.95 : 0);
        this._returnFlowB.opacity(m.feed.returnFlow > 0.02 ? 0.95 : 0);
        this._checkFlow.opacity(m.feed.checkFlow > 0.02 ? 0.95 : 0);
        // 净油出口阀 V4 不导通时无净油流出，不显示流动
        // Ti70 断油并出油 / Ti72 置换出油：出油管保持流动
        const pushOil = m.prog && m.phase === 4 && (m.step === 0 || m.step === 2);
        this._cleanFlow.opacity(((oilOn && m.oil.outletValveOpen && m.feed.flow > 0.02) || pushOil) ? 0.95 : 0);
        this._waterSupplyFlow.opacity(m.water.mainOpen ? 0.95 : 0);
        this._sealFlow.opacity(m.water.sv10 ? 0.95 : 0);
        this._waterOutFlow.opacity((m.water.sv15 || m.water.sv16) ? 0.95 : 0);
        this._drainFlow.opacity(m.water.drain ? 0.95 : 0);
        this._sludgeFlow.opacity(m.bowl.discharge > 0 ? 0.95 : 0);
        // 流动相位：按时间推进，与分离机转速无关（泵运行即有流动）
        this._flowPhase = ((this._flowPhase || 0) + 0.9) % 20;
        const off = this._flowPhase;
        this._oilFlow.dashOffset(-off);
        this._oilFlowA.dashOffset(-off);
        this._sepFlow.dashOffset(-off);
        this._returnFlow.dashOffset(-off);
        this._returnFlowB.dashOffset(-off);
        this._checkFlow.dashOffset(-off);
        this._cleanFlow.dashOffset(-off);
        this._waterSupplyFlow.dashOffset(-off);
        this._sealFlow.dashOffset(-off);
        this._waterOutFlow.dashOffset(-off);
        this._drainFlow.dashOffset(-off);
        this._sludgeFlow.dashOffset(-off);

        // 分离筒
        this._discStack.rotation((m.bowl.discRot * 10) % 360);
        if (this._bowlWaterRect) {
            const f = Math.max(0, Math.min(1, m.bowl.fill || 0));
            const H = 2 * (r - 6);
            this._bowlWaterRect.height(H * f);
            this._bowlWaterRect.y((r - 6) - H * f);
            this._bowlWater.visible(f > 0.01);
        }
        // 水封建立动画
        const sealF = m.bowl.waterSeal ? 1 : Math.max(0, Math.min(1, m.bowl.sealForm || 0));
        this._waterSeal.visible(sealF > 0.01);
        this._waterSeal.opacity(0.85 * sealF);
        if (this._opWaterPool) {
            const w = Math.max(0, Math.min(1, m.bowl.opWater || 0));
            this._opWaterPool.opacity(w > 0.02 ? 0.2 + 0.6 * w : 0);
            this._opWaterPool.radiusX(24 + 20 * w);
            this._opWaterPool.radiusY(6 + 6 * w);
        }
        if (this._sealWaterLayer) {
            const sw = Math.max(0, Math.min(1, Number(m.bowl.sealWater) || 0));
            this._sealWaterLayer.opacity(0.9 * sw);
            this._sealWaterLayer.visible(sw > 0.01);
        }
        this._sludgeLayer.visible(m.bowl.speed > 500);
        const load = clamp(m.sludge.nextIn / Math.max(60, m.params.dischargeInterval * 60), 0, 1);
        this._sludgeLayer.opacity(0.25 + (1 - load) * 0.65);
        this._oilLayer.visible(m.state === 'SEPARATION');
        this._oilLayer.opacity(0.35 + clamp(m.feed.flow / Math.max(0.1, m.params.flow), 0, 1) * 0.4);
        this._slide.y(cy + r - 12 + (m.bowl.closed ? 0 : 7));
        this._dischargeFlash.opacity(m.bowl.discharge > 0 ? 0.9 : 0);
        this._leakStreak.opacity(m.faults.leak ? 0.85 : 0);

        // 仪表
        this._gaugeTexts.pt1.text(`${m.feed.pressure.toFixed(3)}`);
        this._gaugeTexts.tt1.text(`${m.feed.temp.toFixed(1)}`);
        this._gaugeTexts.pt4.text(`${m.oil.outletPressure.toFixed(3)}`);
        this._gaugeTexts.mt.text(!m.oil.mtOn ? '0.0' : (m.faults.transducer ? 'NC' : `${m.oil.waterContent.toFixed(1)}`));
        this._gaugeTexts.pt5.text(`${m.water.outletPressure.toFixed(3)}`);
        this._gaugeTexts.st.text(`${Math.round(m.bowl.speed)}`);
        this._gaugeTexts.vt.text(`${m.bowl.vibration.toFixed(1)}`);
        this._gaugeTexts.pt4.fill(m.oil.outletPressure < 0.06 && m.state === 'SEPARATION' ? '#ff8a80' : '#6dff9a');
        this._gaugeTexts.mt.fill(m.faults.transducer ? '#ff8a80' : (m.oil.waterContent > m.params.waterTrigger ? '#ffd54f' : '#6dff9a'));

        // 状态文字
        const st = {
            STANDSTILL: '静止', STARTING: '起动升速', START_SEQ: '起动程序', STANDBY: '待命',
            SEPARATION: '正常分油', DISCHARGE: '排渣程序', STOPPING: '停机程序',
        }[m.state] || m.state;
        // 状态栏只保留时序计时（冻结时显示下一步的定时器名）
        const TIMER_MAP = {
            1: ['Ti50', 'Ti51', 'Ti52', 'Ti53', 'Ti55'],
            2: ['Ti56', 'Ti57', 'Ti58', 'Ti59', 'Ti60', 'Ti61', 'Ti62', 'Ti63'],
            3: ['Ti64', 'Ti65', 'Ti66', 'Ti67', 'Ti68'],
            4: ['Ti70', 'Ti71', 'Ti72', 'Ti73', 'Ti74', 'Ti75', 'Ti62', 'Ti63'],
            5: ['Ti81', 'Ti82', 'Ti83'],
            6: ['Ti85', 'Ti86', 'Ti87', 'Ti88'],
        };
        const TIMER_CN = {
            Ti50: '起动供油泵', Ti51: 'PT1建压', Ti52: '起动分油机', Ti53: '起动加热器', Ti55: '待机',
            Ti56: '排渣', Ti57: '工作水放残', Ti58: '密封', Ti59: '流量校验', Ti60: '排渣',
            Ti61: '工作水放残', Ti62: '密封', Ti63: '水封', Ti64: '进油', Ti65: '水分检查',
            Ti66: '检漏', Ti67: '水分参考', Ti68: '分油', Ti70: '断油并出油', Ti71: '置换停油',
            Ti72: '置换出油', Ti73: '向心管清洗', Ti74: '排渣', Ti75: '放残',
            Ti81: '密封', Ti82: '置换出油', Ti83: '向心管清洗',
            Ti85: '停止马达', Ti86: '马达降速', Ti87: '停止供油泵', Ti89: '马达停止',
        };
        const tiName = m.timerName;          // 只显示已开始的定时器，避免出现 0 s 的重复项
        const cn = TIMER_CN[tiName] ? ` ${TIMER_CN[tiName]}` : '';
        this._statusText.text(m.prog && tiName ? `${tiName}${cn}  ${Math.floor(m.timerT)} s` : (m.prog ? '' : '程序停止'));
        this._statusText.fill(m.paused ? '#ef6c00' : '#1b5e20');

        // 状态下一行：Ti68 期间的进补偿水 / 排水
        if (this._statusSub) {
            const sub = m.drainWater ? '排水' : (m.compWater ? '进补偿水' : '');
            this._statusSub.text(sub);
            this._statusSub.fill(m.drainWater ? '#c62828' : '#0277bd');
        }


        if (this.sys && this.sys.requestRedraw) this.sys.requestRedraw();
    }

    _setTank(id, pct) {
        const t = this._tankFills[id];
        if (!t) return;
        pct = clamp(pct, 0, 100);
        const h = t.h * pct / 100;
        t.fill.y(t.y + (t.h - h));
        t.fill.height(h);
        this._tankLabels[id].text(`${pct.toFixed(1)}%`);
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
