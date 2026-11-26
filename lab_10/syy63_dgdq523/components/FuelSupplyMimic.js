import Konva from 'konva';
import { BaseComponent } from './BaseComponent.js';

/** 三类阀门三角形统一尺寸（三通转换阀 / 手动截止阀 / 单向阀 全图等大）：底边半宽 / 高 */
const TRI_B = 9.5, TRI_A = 13.5;
/** 流动虚线亮色（比管路 DARK 更鲜艳，浅色管上一眼可辨） */
const FLOW = '#d4280a';
/** 卸放 / 放残管深灰色（与工艺燃油管区分） */
const DRAIN = '#5a6167';

/**
 * FuelSupplyMimic — FCM 燃油供油单元系统模拟图（按《燃油供油单元》工艺图重绘）
 *
 * 流程（红色为燃油、蓝色为蒸汽）：
 *   HFO / IDO 日用柜 → 三通转换阀 → 供油泵 SP1/SP2（并联，前设过滤器、后设止回阀）
 *   → 手动/自动滤器 MF / AF（带进出口阀与放残阀）→ FT 流量变送器（带旁通）
 *   → 立式混合筒（LS 液位开关、PT1 压力变送器，顶部两只脱气阀接回油总管）
 *   → 循环泵 CP1/CP2（并联）→ 加热器 SH1/SH2（蒸汽侧为蓝色管路，含疏水阀）
 *   → PT2 / TT / VT → 柴油机；回油经顶部总管返回 HFO 日用柜
 *   → 蒸汽：STEAM INLET → 调节阀 → SH1/SH2 → 疏水阀 → STEAM OUTLET
 *
 * 只保留传感器（FT / PT1 / PT2 / TT / VT / LS），图上不标注 P/C/T 等过程参数。
 *
 * 可点击部件 id：
 *   hfo-tank do-tank cv sp1 sp2 afb pds ft pt1 tank ls dea-valve cp1 cp2
 *   heater pt2 tt vt engine pcv return-valve
 */
export class FuelSupplyMimic extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.W = Math.max(1200, config.width || 1510);
        this.H = Math.max(390, config.height || 360);
        this.type = 'fuel_supply_mimic';
        this.special = 'fuel_mimic';
        this.cache = 'fixed';

        this._initGroups();
        this._recalcGeometry();
        this._init();

        this.config = { id: this.id, width: this.W, height: this.H };
    }

    _solver() {
        return this.sys && this.sys.fuelSolver ? this.sys.fuelSolver : null;
    }

    _tip(msg) {
        if (this.sys && typeof this.sys._tipPurifier === 'function') this.sys._tipPurifier(msg);
    }

    // ═══════════════════════════════════════════════════════════
    //  几何（直接使用组件坐标）
    // ═══════════════════════════════════════════════════════════
    _recalcGeometry() {
        this._geo = {
            tankHFO: { x: 28, y: 40, w: 60, h: 112 },
            tankDO: { x: 28, y: 226, w: 60, h: 106 },
            cv: { cx: 142, cy: 200 },
            sp1: { cx: 290, cy: 285, r: 17 },
            sp2: { cx: 290, cy: 115, r: 17 },
            st1: { cx: 232, cy: 285, s: 26 },
            st2: { cx: 232, cy: 115, s: 26 },
            mf: { x: 432, y: 100, w: 36, h: 36 },
            af: { x: 432, y: 266, w: 36, h: 36 },
            pds: { x: 410, y: 229, w: 80, h: 22 },   // 紧靠 AF 上方
            ft: { cx: 588, cy: 200, r: 15 },
            tank: { x: 699, y: 86, w: 62, h: 214 },
            ls: { cx: 661, cy: 112, r: 13 },   // 随混油筒右移
            pt1: { cx: 669, cy: 160, r: 13 },
            cp1: { cx: 842, cy: 285, r: 17 },   // 再右移 10px
            cp2: { cx: 842, cy: 115, r: 17 },   // 再右移 10px
            sh2: { x: 985, y: 94, w: 82, h: 42 },   // 居中于管段（水平 922~1130、竖直 y=115）
            sh1: { x: 985, y: 264, w: 82, h: 42 },   // 居中于管段（水平 922~1130、竖直 y=285）
            pt2: { cx: 1158, cy: 160, r: 13 },
            tt: { cx: 1188, cy: 200, r: 13 },
            vt: { cx: 1277, cy: 200, r: 13 },
            engine: { x: 1352, y: 87, w: 108, h: 268 },   // 下移 25px + 右移 100px
            pcv: { cx: 1390, cy: 30 },
            ret: { cx: 480, cy: 345 },
        };
        this._mainY = 200;
        this._flowPhase = 0;
    }

    // ═══════════════════════════════════════════════════════════
    //  绘制工具
    // ═══════════════════════════════════════════════════════════
    _label(g, x, y, text, size = 11, fill = '#263238', bold = false, align = 'left', width = 0) {
        const o = {
            x, y, text, fontSize: size, fontStyle: bold ? 'bold' : 'normal', fill, align,
            fontFamily: 'Arial, "Microsoft YaHei", sans-serif',
        };
        if (width) o.width = width;
        g.add(new Konva.Text(o));
    }

    _pipe(g, pts, color = '#f0a58a', w = 5) {
        g.add(new Konva.Line({ points: pts, stroke: color, strokeWidth: w, lineCap: 'round', lineJoin: 'round' }));
    }

    _arrow(g, x, y, dir, color = '#d63b1f', s = 7) {
        const pts = dir === 'right' ? [x - s, y - s, x + s, y, x - s, y + s]
            : dir === 'left' ? [x + s, y - s, x - s, y, x + s, y + s]
                : dir === 'up' ? [x - s, y + s, x, y - s, x + s, y + s]
                    : [x - s, y - s, x, y + s, x + s, y - s];
        g.add(new Konva.Line({ points: pts, closed: true, fill: color, stroke: color, strokeWidth: 1 }));
    }

    /**
     * 手动三通转换阀：三个顶点相交三角形（同电磁三通阀尺寸），左侧/右侧手柄替代电磁线圈。
     * side='right'：手柄在右、公共口在左（入口型，用于管路分叉）；
     * side='left' ：手柄在左、公共口在右（出口型，用于管路汇合）。
     * 手柄绕枢轴旋转 ±45° 指示阀位：上=MF 支路、下=AF 支路。返回 { up, dn, com, piv, s }。
     */
    _threeWayManual(parent, cx, cy, side) {
        const a = TRI_A, b = TRI_B, s = side === 'right' ? 1 : -1;
        const mk = (pts, fill) => {
            const n = new Konva.Line({
                points: pts, closed: true, fill, stroke: '#666666',
                strokeWidth: 2.2, lineJoin: 'round',
            });
            parent.add(n);
            return n;
        };
        const up = mk([cx - b, cy - a, cx + b, cy - a, cx, cy], '#ffffff');   // 上：MF 支路
        const dn = mk([cx - b, cy + a, cx + b, cy + a, cx, cy], '#ffffff');   // 下：AF 支路
        const com = s > 0
            ? mk([cx - a, cy - b, cx - a, cy + b, cx, cy], '#2ecc40')         // 公共口在左（常绿）
            : mk([cx + a, cy - b, cx + a, cy + b, cx, cy], '#2ecc40');        // 公共口在右（常绿）
        // 阀芯 → 手柄引线（19px，同电磁线圈引线长度）
        parent.add(new Konva.Line({ points: [cx, cy, cx + s * 19, cy], stroke: '#666666', strokeWidth: 1.8 }));
        // 手柄：枢轴在引线端，杆 16px + 端部握条（T 形）
        const piv = new Konva.Group({ x: cx + s * 19, y: cy });
        piv.add(new Konva.Line({ points: [0, 0, s * 16, 0], stroke: '#333333', strokeWidth: 2.4, lineCap: 'round' }));
        piv.add(new Konva.Line({ points: [s * 16, -6, s * 16, 6], stroke: '#333333', strokeWidth: 2.6, lineCap: 'round' }));
        parent.add(piv);
        return { up, dn, com, piv, s };
    }

    /** 竖置截止阀：上下两三角对顶（高度 1.3 倍），阀杆自阀芯中心引出 + 手轮（返回节点供状态填充） */
    _valveV(parent, cx, cy, r, color = '#333333', fill = '#ffffff') {
        const hw = TRI_B;                           // 与三通转换阀三角形同尺寸
        const h = TRI_A;
        const top = new Konva.Line({
            points: [cx - hw, cy - h, cx + hw, cy - h, cx, cy], closed: true,
            fill, stroke: color, strokeWidth: 1.8, lineJoin: 'round',
        });
        const bot = new Konva.Line({
            points: [cx - hw, cy + h, cx + hw, cy + h, cx, cy], closed: true,
            fill, stroke: color, strokeWidth: 1.8, lineJoin: 'round',
        });
        parent.add(top, bot);
        parent.add(new Konva.Line({ points: [cx, cy, cx + hw + 9, cy], stroke: color, strokeWidth: 1.8 }));
        parent.add(new Konva.Line({ points: [cx + hw + 9, cy - 6, cx + hw + 9, cy + 6], stroke: color, strokeWidth: 2.2 }));
        return { top, bot };
    }

    /**
     * 竖置电磁阀：与手动截止阀同形（上下两三角顶点相交），手柄换成电磁线圈。
     * 通电：线圈红 `#e53935`、上下两三角绿 `#2ecc40`；断电：线圈白、两三角白。
     * 返回 { top, bot, coil, coilLines } 供 _syncVisuals 按状态着色。
     */
    _solenoidV(parent, cx, cy, side = 'right') {
        const hw = TRI_B, h = TRI_A;
        const top = new Konva.Line({
            points: [cx - hw, cy - h, cx + hw, cy - h, cx, cy], closed: true,
            fill: '#ffffff', stroke: '#333333', strokeWidth: 1.8, lineJoin: 'round',
        });
        const bot = new Konva.Line({
            points: [cx - hw, cy + h, cx + hw, cy + h, cx, cy], closed: true,
            fill: '#ffffff', stroke: '#333333', strokeWidth: 1.8, lineJoin: 'round',
        });
        parent.add(top, bot);
        // 阀芯 → 线圈引线（19px，同其它电磁阀引线长度）；side='left' 时线圈在左侧
        const sg = side === 'left' ? -1 : 1;
        const coilX = sg > 0 ? cx + hw + 5.5 : cx - hw - 5.5 - 15.6;
        const coilW = 15.6, coilH = 16.8;
        parent.add(new Konva.Line({ points: [cx, cy, sg > 0 ? coilX : coilX + coilW, cy], stroke: '#666666', strokeWidth: 1.8 }));   // 自阀芯中心引出，完整连接
        const coil = new Konva.Rect({
            x: coilX, y: cy - coilH / 2, width: coilW, height: coilH, rx: 2,
            fill: '#ffffff', stroke: '#666666', strokeWidth: 2,
        });
        parent.add(coil);
        const diag = new Konva.Line({
            points: [coilX, cy - coilH / 2, coilX + coilW, cy + coilH / 2],
            stroke: '#666666', strokeWidth: 1.8,
        });
        parent.add(diag);
        return { top, bot, coil, coilLines: [diag] };
    }

    /** 横置手动截止阀：左右两三角顶点相交（流向左右），阀杆自阀芯中心向上引出 + 手轮 */
    _valveH(parent, cx, cy, color = '#333333', fill = '#ffffff') {
        const hw = TRI_B, h = TRI_A;
        const lf = new Konva.Line({
            points: [cx - h, cy - hw, cx - h, cy + hw, cx, cy], closed: true,
            fill, stroke: color, strokeWidth: 1.8, lineJoin: 'round',
        });
        const rt = new Konva.Line({
            points: [cx + h, cy - hw, cx + h, cy + hw, cx, cy], closed: true,
            fill, stroke: color, strokeWidth: 1.8, lineJoin: 'round',
        });
        parent.add(lf, rt);
        const ty = cy - hw - 9;
        parent.add(new Konva.Line({ points: [cx, cy, cx, ty], stroke: color, strokeWidth: 1.8 }));
        parent.add(new Konva.Line({ points: [cx - 7, ty, cx + 7, ty], stroke: color, strokeWidth: 2.2 }));
        return { lf, rt };
    }

    /** 蝶形阀（两三角对顶），返回左右三角节点 */
    _valve(g, cx, cy, r = 10, color = '#333333') {
        const l = new Konva.Line({
            points: [cx - r, cy - r * 0.75, cx - r, cy + r * 0.75, cx, cy], closed: true,
            fill: '#ffffff', stroke: color, strokeWidth: 1.8, lineJoin: 'round',
        });
        const rr = new Konva.Line({
            points: [cx + r, cy - r * 0.75, cx + r, cy + r * 0.75, cx, cy], closed: true,
            fill: '#ffffff', stroke: color, strokeWidth: 1.8, lineJoin: 'round',
        });
        g.add(l, rr);
        return { left: l, right: rr };
    }



    /** 叶轮组（动态层，运行时旋转） */
    _makeFan(cx, cy, r) {
        const fan = new Konva.Group({ x: cx, y: cy, rotation: 0 });
        for (let i = 0; i < 3; i++) {
            const a = (i * 120 - 90) * Math.PI / 180;
            fan.add(new Konva.Line({
                points: [0, 0, Math.cos(a) * r * 0.68, Math.sin(a) * r * 0.68],
                stroke: '#333333', strokeWidth: 2.4, lineCap: 'round',
            }));
        }
        fan.add(new Konva.Circle({ x: 0, y: 0, radius: r * 0.22, fill: '#333333' }));
        this._dynamicGroup.add(fan);
        return fan;
    }

    /** 过滤器/滤器（带斜线阴影的方块） */
    _hatched(g, x, y, w, h) {
        g.add(new Konva.Rect({ x, y, width: w, height: h, fill: '#ffffff', stroke: '#333333', strokeWidth: 2 }));
        const step = 8;
        for (let i = -h; i < w; i += step) {
            g.add(new Konva.Line({
                points: [x + Math.max(0, i), y + Math.max(0, -i), x + Math.min(w, i + h), y + Math.min(h, w - i)],
                stroke: '#333333', strokeWidth: 1,
            }));
        }
    }

    /**
     * 单向阀：两个相对（顶点相交）的三角形
     *  · 流进侧三角：流通时绿色 `#2ecc40`，不流通时白色；
     *  · 流出侧三角：始终灰色 `#b0b6bb`；
     *  · 反向不可流通（流动方向由 dir 决定，反向无流动路径）。
     * 返回 { in, out } 供动态层按状态着色。
     */
    _checkV(parent, cx, cy, dir, a = TRI_A, b = TRI_B, color = '#333333') {
        let inPts, outPts;
        if (dir === 'down') {                 // 流动向下：上为进、下为出
            inPts = [cx - b, cy - a, cx + b, cy - a, cx, cy];
            outPts = [cx - b, cy + a, cx + b, cy + a, cx, cy];
        } else if (dir === 'up') {            // 流动向上：下为进、上为出
            inPts = [cx - b, cy + a, cx + b, cy + a, cx, cy];
            outPts = [cx - b, cy - a, cx + b, cy - a, cx, cy];
        } else {                              // 流动向右：左为进、右为出
            inPts = [cx - a, cy - b, cx - a, cy + b, cx, cy];
            outPts = [cx + a, cy - b, cx + a, cy + b, cx, cy];
        }
        const mk = (pts, fill) => {
            const n = new Konva.Line({
                points: pts, closed: true, fill, stroke: color,
                strokeWidth: 1.8, lineJoin: 'round',
            });
            parent.add(n);
            return n;
        };
        return { in: mk(inPts, '#ffffff'), out: mk(outPts, '#b0b6bb') };
    }

    /** 传感器圆环 */
    _circle(g, s, tag) {
        g.add(new Konva.Circle({ x: s.cx, y: s.cy, radius: s.r, fill: '#ffffff', stroke: '#333333', strokeWidth: 2 }));
        this._label(g, s.cx - s.r, s.cy - 7, tag, 12, '#111111', true, 'center', s.r * 2);
    }

    // ═══════════════════════════════════════════════════════════
    //  静态绘制
    // ═══════════════════════════════════════════════════════════
    _init() {
        this._drawStaticParts();
        this._createDynamicNodes();
        this._bindInteraction();
        this._syncVisuals();
    }

    _drawStaticParts() {
        let g = this._staticGroup;
        const G = this._geo, W = this.W, H = this.H;
        const y = this._mainY;
        const RED = '#d63b1f', BLUE = '#3fa3e8', LIGHT = '#fbe4dc', DARK = '#b03a1f';


        g.add(new Konva.Rect({
            x: 0, y: 0, width: W, height: H, cornerRadius: 10,
            fill: '#ffffff', stroke: '#b9c2ca', strokeWidth: 2,
        }));

        // ── 日用柜 ──
        [[G.tankHFO, 'HFO TANK'], [G.tankDO, 'DO TANK']].forEach(([b, t]) => {
            g.add(new Konva.Path({
                data: `M ${b.x} ${b.y} L ${b.x + b.w} ${b.y} L ${b.x + b.w} ${b.y + b.h - 18}
                       L ${b.x + b.w - 24} ${b.y + b.h} L ${b.x} ${b.y + b.h} Z`,
                fill: '#f57c1f', stroke: '#7a3a06', strokeWidth: 2, lineJoin: 'round',
            }));
            this._label(g, b.x + 8, b.y + b.h / 2 - 7, t, 10, '#ffffff', true, 'left', b.w - 14);
        });

        // ── 右侧全部部件整体上移 25px（两只日用柜及其出口水平支管保持原位）──
        const gR = new Konva.Group({ y: -25 });
        g.add(gR);
        g = gR;

        // ══ 燃油管路（红）══
        // 柜 → 转换阀
        this._pipe(g, [G.tankHFO.x + G.tankHFO.w, 121, G.cv.cx, 121, G.cv.cx, G.cv.cy - 13.5]);
        this._pipe(g, [G.tankDO.x + G.tankDO.w, 305, G.cv.cx, 305, G.cv.cx, G.cv.cy + 13.5]);
        this._arrow(g, G.tankHFO.x + G.tankHFO.w + 6, 121, 'right', DARK, 6);
        this._arrow(g, G.tankDO.x + G.tankDO.w + 6, 305, 'right', DARK, 6);
        // 转换阀 → 两条泵支路
        this._pipe(g, [G.cv.cx + 13.5, y, 190, y]);   // 出口仅到分叉点：向上/向下两条支路（无向右支路）
        this._pipe(g, [190, y, 190, 115, 273, 115]);    // 入口（含泵前过滤器）
        this._pipe(g, [190, y, 190, 285, 273, 285]);
        // 泵支路：过滤器 → 泵 → 止回阀 → 滤器
        // 泵出口：向右 30px 后 SP2 向下、SP1 向上转折，经单向阀汇入向右的管路
        this._pipe(g, [307, 115, 337, 115, 337, y]);
        this._pipe(g, [307, 285, 337, 285, 337, y]);
        this._pipe(g, [337, y, 376.5, y]);   // 止于手动三通阀（分叉）左基边
        // 汇合管再分叉到手动/自动滤器
        this._pipe(g, [390, 186.5, 390, 115, 432, 115]);   // 起于分叉阀上基边（MF 支路）
        this._pipe(g, [390, 213.5, 390, 285, 432, 285]);   // 起于分叉阀下基边（AF 支路）
        // 滤器出口汇合
        this._pipe(g, [462, 115, 498, 115, 498, 186.5]);   // 止于汇合阀上基边
        this._pipe(g, [462, 285, 498, 285, 498, 213.5]);   // 止于汇合阀下基边
        // 主管路 → FT → 混合筒
        this._pipe(g, [511.5, y, G.ft.cx - G.ft.r, y]);   // 起于手动三通阀（汇合）右基边
        this._pipe(g, [G.ft.cx + G.ft.r, y, G.tank.x, y]);
        // FT 旁通
        this._pipe(g, [522, y, 522, y + 64, 654, y + 64, 654, y], LIGHT, 3.5);   // 旁通跨接「进口阀 + FT」，右端接到 FT 后单向阀之后
        // 混合筒 → 循环泵
        this._pipe(g, [G.tank.x + G.tank.w, y, 792, y]);
        this._pipe(g, [792, y, 792, 115, 825, 115]);
        this._pipe(g, [792, y, 792, 285, 825, 285]);
        this._pipe(g, [859, 115, 885, 115, 885, y]);
        this._pipe(g, [859, 285, 885, 285, 885, y]);
        // 循环泵 → 加热器
        this._pipe(g, [885, y, 922, y]);
        this._pipe(g, [922, y, 922, 115, G.sh2.x, 115]);
        this._pipe(g, [922, y, 922, 285, G.sh1.x, 285]);
        // 加热器出口汇合 → 传感器 → 柴油机
        this._pipe(g, [G.sh2.x + G.sh2.w, 115, 1130, 115, 1130, y]);
        this._pipe(g, [G.sh1.x + G.sh1.w, 285, 1130, 285, 1130, y]);
        this._pipe(g, [1130, y, G.engine.x, y]);
        // VT 旁通
        this._pipe(g, [1216, y, 1216, y + 56, 1344, y + 56, 1344, y], LIGHT, 3.5);   // 并联支路：跨接「进口阀+VT+单向阀」
        // 顶部回油总管：在两根脱气管之间断开（左右两段互不相连）
        this._pipe(g, [G.engine.x + 58, G.engine.y + 12, G.engine.x + 58, 30, G.tank.x + 46, 30], LIGHT, 4);
        this._pipe(g, [G.tank.x + 16, 30, 58, 30], LIGHT, 4);
        this._arrow(g, 130, 30, 'left', DARK, 6);
        this._pipe(g, [58, 30, 58, G.tankHFO.y + 25], LIGHT, 4);   // 柜未移动，补偿子组偏移
        // 混合筒顶部两只脱气阀 → 回油总管
        this._pipe(g, [G.tank.x + 16, G.tank.y, G.tank.x + 16, 30], LIGHT, 3.5);
        this._pipe(g, [G.tank.x + 46, G.tank.y, G.tank.x + 46, 30], LIGHT, 3.5);

        // ══ 蒸汽管路（蓝）：入口 → 调节支路 → SH1 / SH2 → 凝水 → 出口 ══
        {
            const SB = '#cfe7fb';            // 蒸汽管：很浅的浅蓝
            const STX = '#5fa8dc';           // 箭头 / 文字
            const OPEN = '#2ecc40';
            const RY = 370;                 // 主蒸汽总管 / 凝水总管高度
            const RX = 1140;                // 凝水立管
            // ① 入口 → 立管
            this._pipe(g, [730, RY, 1000, RY], SB, 4);
            this._arrow(g, 738, RY, 'right', STX, 5);
            this._label(g, 730, RY - 18, 'STEAM INLET', 9, STX, true, 'left', 90);
            // ② 主支路：手动截止阀（默认导通）→ 电动调节阀 → 单向阀
            g.add(new Konva.Line({ points: [840, RY, 840, RY - 16], stroke: STX, strokeWidth: 1.8 }));
            g.add(new Konva.Rect({
                x: 831, y: RY - 28, width: 18, height: 12, cornerRadius: 2,
                fill: '#eaf1fb', stroke: STX, strokeWidth: 1.6,
            }));
            g.add(new Konva.Line({ points: [834, RY - 22, 846, RY - 22], stroke: STX, strokeWidth: 1.4 }));
            g.add(new Konva.Line({ points: [834, RY - 19, 846, RY - 19], stroke: STX, strokeWidth: 1.4 }));
            // ③ 汇合后立管（向上）
            this._pipe(g, [950, RY, 950, 210], SB, 4);
            // ④ SH1 支路：总管 → 竖直向上（阀体在动态层）→ SH1 底部（x=1000）
            this._pipe(g, [1000, RY, 1000, 306], SB, 4);

            // ⑤ SH2 支路：立管上端 → 向右 → 向上（阀体在动态层）→ SH2 底部（x=1000）
            this._pipe(g, [950, 210, 1000, 210, 1000, 136], SB, 4);

            // ⑥ SH1 出汽：底部右端（与进口对称 x=1052）→ 下 → 右 → 单向阀 → 凝水立管
            this._pipe(g, [1052, 306, 1052, RY, RX, RY], SB, 4);
            // ⑦ SH2 出汽：底部右端（对称 x=1052）→ 下 → 右 → 单向阀 → 凝水立管
            this._pipe(g, [1052, 136, 1052, 210, 1102, 210, 1102, RY], SB, 4);
            // ⑧ 凝水立管 → 底部 → 单向阀 → 疏水阀 → STEAM OUTLET
            this._pipe(g, [1052, RY, 1300, RY], SB, 4);
            g.add(new Konva.Circle({ x: 1220, y: RY, radius: 11, fill: '#ffffff', stroke: STX, strokeWidth: 2 }));
            g.add(new Konva.Path({ data: `M 1220 ${RY - 11} A 11 11 0 0 1 1220 ${RY + 11} Z`, fill: '#111111' }));
            this._arrow(g, 1288, RY, 'right', STX, 5);
            this._label(g, 1254, RY - 16, 'STEAM OUTLET', 9, STX, true, 'center', 110);
        }

        // ══ 阀门与设备 ══

        this._arrow(g, G.tank.x + 46, 40, 'down', DARK, 6);   // 右管：向下箭头

        // 泵 / 过滤器 / 止回阀 / 滤器
        this._hatched(g, G.st2.cx - 12, G.st2.cy - 13, 24, 26);
        this._hatched(g, G.st1.cx - 12, G.st1.cy - 13, 24, 26);

        this._hatched(g, G.mf.x, G.mf.y, G.mf.w, G.mf.h);
        this._hatched(g, G.af.x, G.af.y, G.af.w, G.af.h);
        this._label(g, G.mf.x - 6, G.mf.y - 16, 'MF', 14, '#111111', true, 'center', G.mf.w + 12);
        this._label(g, G.af.x - 30, G.af.y + G.af.h - 16, 'AF', 14, '#111111', true, 'center', 30);   // 左下角
        this._label(g, G.sp2.cx - 14, G.sp2.cy - 33, 'SP2', 14, '#111111', true, 'center', 28);
        this._label(g, G.sp1.cx - 14, G.sp1.cy + 21, 'SP1', 14, '#111111', true, 'center', 28);

        // 放残：MF 放残管已取消；AF 放残管上为竖置电磁阀（动态层绘制，通电开启）
        this._pipe(g, [G.af.x + G.af.w / 2, G.af.y + G.af.h, G.af.x + G.af.w / 2, 351], DRAIN, 3);   // 直连到箭头基部
        this._arrow(g, G.af.x + G.af.w / 2, 356, 'down', DARK, 5);

        // PDS 压差开关
        // PDS 并联接在 AF 两端：左取压点接 AF 进口管（y=285）、右取压点接 AF 出口管
        this._pipe(g, [G.pds.x + 12, G.pds.y + G.pds.h, G.pds.x + 12, 285], '#5b9ae0', 1.4);
        this._pipe(g, [G.pds.x + G.pds.w - 12, G.pds.y + G.pds.h, G.pds.x + G.pds.w - 12, 285], '#5b9ae0', 1.4);

        // 混合筒
        g.add(new Konva.Rect({
            x: G.tank.x, y: G.tank.y, width: G.tank.w, height: G.tank.h,
            fill: '#ffffff', stroke: '#333333', strokeWidth: 2.4,
        }));
        this._label(g, G.tank.x - 8, G.tank.y + G.tank.h + 6, 'MIXING TUBE', 13, '#111111', true, 'center', G.tank.w + 16);

        // 循环泵

        this._label(g, G.cp2.cx - 14, G.cp2.cy - 33, 'CP2', 14, '#111111', true, 'center', 28);
        this._label(g, G.cp1.cx - 14, G.cp1.cy + 21, 'CP1', 14, '#111111', true, 'center', 28);

        // 加热器 SH1 / SH2
        [G.sh2, G.sh1].forEach((b) => {
            g.add(new Konva.Rect({ x: b.x, y: b.y, width: b.w, height: b.h, fill: '#ffffff', stroke: '#b03a1f', strokeWidth: 2 }));
            g.add(new Konva.Line({ points: [b.x + 8, b.y + b.h - 8, b.x + b.w - 8, b.y + 8], stroke: '#b03a1f', strokeWidth: 2 }));
        });
        this._label(g, G.sh2.x - 6, G.sh2.y - 16, 'SH2', 14, '#b03a1f', true, 'center', G.sh2.w + 12);
        this._label(g, G.sh1.x - 6, G.sh1.y + G.sh1.h + 3, 'SH1', 14, '#b03a1f', true, 'center', G.sh1.w + 12);

        // 传感器
        this._circle(g, G.ft, 'FT');
        this._circle(g, G.pt1, 'PT1');
        this._pipe(g, [G.pt1.cx, G.pt1.cy + G.pt1.r, G.pt1.cx, y], '#6b7780', 2);   // PT1 垂直向下接主管
        this._pipe(g, [G.ls.cx + G.ls.r, G.ls.cy, G.tank.x, G.ls.cy], '#6b7780', 2);   // LS 水平向右接混油筒
        this._pipe(g, [G.pt2.cx, G.pt2.cy + G.pt2.r, G.pt2.cx, y], '#6b7780', 2);   // PT2 取压引线
        this._circle(g, G.pt2, 'PT2');
        this._circle(g, G.tt, 'TT');
        this._circle(g, G.vt, 'VT');

        // 柴油机（主机）：底座 + 曲轴箱 + 缸体/缸盖 + 飞轮 + 排气集管 + 进油法兰
        const E = G.engine;
        const EG = '#5f6a72', EGL = '#a7b0b7';
        // 底座
        g.add(new Konva.Rect({
            x: E.x + 2, y: E.y + E.h - 20, width: E.w - 4, height: 18, cornerRadius: 2,
            fill: '#8d979f', stroke: EG, strokeWidth: 1.6,
        }));
        // 曲轴箱
        g.add(new Konva.Rect({
            x: E.x + 8, y: E.y + 158, width: E.w - 16, height: E.h - 182, cornerRadius: 6,
            fill: '#cfd5da', stroke: EG, strokeWidth: 2,
        }));
        // 缸体
        g.add(new Konva.Rect({
            x: E.x + 8, y: E.y + 44, width: E.w - 16, height: 116, cornerRadius: 5,
            fill: '#d7dbdf', stroke: EG, strokeWidth: 2,
        }));
        // 缸套分隔
        for (let i = 1; i <= 3; i++) {
            const lx = E.x + 8 + (E.w - 16) * i / 4;
            g.add(new Konva.Line({ points: [lx, E.y + 48, lx, E.y + 156], stroke: EGL, strokeWidth: 1.6 }));
        }
        // 缸盖
        g.add(new Konva.Rect({
            x: E.x + 4, y: E.y + 26, width: E.w - 8, height: 18, cornerRadius: 3,
            fill: '#b6bec4', stroke: EG, strokeWidth: 1.8,
        }));
        // 气门室罩
        g.add(new Konva.Rect({
            x: E.x + 16, y: E.y + 12, width: E.w - 32, height: 14, cornerRadius: 3,
            fill: '#e3e7ea', stroke: EG, strokeWidth: 1.6,
        }));
        // 飞轮
        g.add(new Konva.Circle({
            x: E.x + E.w - 28, y: E.y + E.h - 62, radius: 25,
            fill: '#b6bec4', stroke: EG, strokeWidth: 2,
        }));
        g.add(new Konva.Circle({
            x: E.x + E.w - 28, y: E.y + E.h - 62, radius: 8,
            fill: '#8d979f', stroke: EG, strokeWidth: 1.4,
        }));
        // 排气集管（右侧）
        g.add(new Konva.Rect({
            x: E.x + E.w - 5, y: E.y + 50, width: 7, height: 96, cornerRadius: 3,
            fill: '#9aa3ab', stroke: EG, strokeWidth: 1.4,
        }));
        // 进油法兰（左侧，与来油管对齐）
        g.add(new Konva.Rect({
            x: E.x - 6, y: 188, width: 14, height: 24, cornerRadius: 2,
            fill: '#b6bec4', stroke: EG, strokeWidth: 1.6,
        }));
        this._label(g, E.x - 4, E.y + E.h + 6, '柴油机', 14, '#1b2a38', true, 'center', E.w + 8);


        // 蒸汽进/出标注

    }

    // ═══════════════════════════════════════════════════════════
    //  动态节点
    // ═══════════════════════════════════════════════════════════
    _createDynamicNodes() {
        const d = this._dynamicGroup, G = this._geo;
        d.y(-25);            // 与静态层一致：右侧动态内容整体上移 25px
        this._dyn = {};

        // ── 三通转换阀：三个顶点相交的三角形（管口边各缩短 3px）+ 左侧电磁线圈 ──
        {
            const cx = G.cv.cx, cy = G.cv.cy, a = TRI_A, b = TRI_B;   // b: 22 → 19（-3px）
            const mk = (pts, fill) => {
                const n = new Konva.Line({
                    points: pts, closed: true, fill, stroke: '#666666',
                    strokeWidth: 2.2, lineJoin: 'round',
                });
                d.add(n);
                return n;
            };
            const up = mk([cx - b, cy - a, cx + b, cy - a, cx, cy], '#ffffff');   // 上：HFO 支路
            const dn = mk([cx - b, cy + a, cx + b, cy + a, cx, cy], '#ffffff');   // 下：DO 支路
            const rt = mk([cx + a, cy - b, cx + a, cy + b, cx, cy], '#2ecc40');   // 右：出口（常导通）
            // 电磁线圈（左）：矩形 + 一条对角线
            const coilX = cx - 34.6, coilW = 15.6, coilH = 16.8;   // 原 26×28 × 0.6
            const coil = new Konva.Rect({
                x: coilX, y: cy - coilH / 2, width: coilW, height: coilH, rx: 2,
                fill: '#ffffff', stroke: '#666666', strokeWidth: 2,
            });
            d.add(coil);
            const coilLines = [];
            const diag = new Konva.Line({
                points: [coilX, cy - coilH / 2, coilX + coilW, cy + coilH / 2],
                stroke: '#666666', strokeWidth: 1.8,
            });
            d.add(diag);
            coilLines.push(diag);
            // 线圈 → 阀芯引线（长度为原 28 的 2/3 ≈ 19）
            d.add(new Konva.Line({ points: [cx - 19, cy, cx, cy], stroke: '#666666', strokeWidth: 1.8 }));
            this._cv = { up, dn, rt, coil, coilLines };
        }

        // ── 柴油机负荷调节旋钮（顶部回油口处，0~100%）──
        {
            const KX = 1310, KY = 108, KR = 22;   // 半径加倍；左移 20px，上移 50px
            d.add(new Konva.Circle({ x: KX, y: KY, radius: KR, fill: '#ffffff', stroke: '#9aa0a0', strokeWidth: 1.2 }));
            d.add(new Konva.Circle({ x: KX, y: KY, radius: KR - 3, fill: '#141414', stroke: '#000000', strokeWidth: 1 }));
            this._loadPtr = new Konva.Group({ x: KX, y: KY, rotation: 0 });
            this._loadPtr.add(new Konva.Rect({
                x: -1.6, y: -(KR - 4), width: 3.2, height: KR - 4, cornerRadius: 1.6, fill: '#ffffff',
            }));
            d.add(this._loadPtr);
            this._loadTxt = new Konva.Text({
                x: KX - 30, y: KY - 38, width: 60, align: 'center', text: '负荷 50%',
                fontSize: 14, fontStyle: 'bold', fill: '#263238',
                fontFamily: 'Arial, "Microsoft YaHei", sans-serif',
            });
            d.add(this._loadTxt);
        }

        // ── VT 回路：进口手动截止阀（默认断开）+ VT + 单向阀，并联手动截止阀（默认导通）──
        this._vtv = {
            in: this._valveH(d, 1236, this._mainY),
            par: this._valveH(d, 1280, this._mainY + 56),
        };
        this._vtck = this._checkV(d, 1314, this._mainY, 'right');

        // ── LS 液位开关（动态：动作时红色）──
        this._lsCircle = new Konva.Circle({
            x: G.ls.cx, y: G.ls.cy, radius: G.ls.r, fill: '#ffffff', stroke: '#333333', strokeWidth: 2,
        });
        this._lsTxt = new Konva.Text({
            x: G.ls.cx - G.ls.r, y: G.ls.cy - 8, width: G.ls.r * 2, align: 'center', text: 'LS',
            fontSize: 12, fontStyle: 'bold', fill: '#111111',
            fontFamily: 'Arial, "Microsoft YaHei", sans-serif',
        });
        d.add(this._lsCircle);
        d.add(this._lsTxt);

        // ── 转换阀 HFO 侧开度（转换期间显示）──
        this._cvTxt = new Konva.Text({
            x: G.cv.cx + 10, y: G.cv.cy + 12, width: 36, align: 'center', text: '',
            fontSize: 9.5, fontStyle: 'bold', fill: '#0d6bb8',
            fontFamily: 'Consolas, monospace', visible: false,
        });
        d.add(this._cvTxt);

        // ── 日用柜右上方：油温 / 黏度动态标签 ──
        {
            const mk = (x, y) => new Konva.Text({
                x, y, width: 64, text: '', fontSize: 12.5, fontStyle: 'bold',
                fill: '#b03a1f', lineHeight: 1.15, fontFamily: 'Consolas, monospace',
            });
            this._hfoInfo = mk(G.tankHFO.x + G.tankHFO.w + 4, G.tankHFO.y + 27);   // 局部 42（含 +25 偏移）
            this._doInfo = mk(G.tankDO.x + G.tankDO.w + 4, G.tankDO.y + 27);
            d.add(this._hfoInfo);
            d.add(this._doInfo);
        }

        // ── 混油筒顶部：温度 / 压力动态标签 ──
        {
            const T = G.tank;
            const mkTxt = (dy) => new Konva.Text({
                x: T.x + 2, y: T.y + dy, width: T.w - 4, align: 'center', text: '',
                fontSize: 13, fontStyle: 'bold', fill: '#b03a1f',
                fontFamily: 'Consolas, monospace',
            });
            this._tankTempTxt = mkTxt(8);
            this._tankPressTxt = mkTxt(20);
            d.add(this._tankTempTxt);
            d.add(this._tankPressTxt);
        }

        // ── 混油筒液位（上部液面随进油/耗油变化）──
        {
            const T = G.tank;
            this._tankLvl = new Konva.Rect({
                x: T.x + 3, y: T.y + T.h - 3, width: T.w - 6, height: 0,
                fill: '#f4b9a3', opacity: 0.9,
            });
            d.add(this._tankLvl);
            this._tankLvlTxt = new Konva.Text({
                x: T.x, y: T.y + T.h - 15, width: T.w, align: 'center', text: '60%',
                fontSize: 14, fontStyle: 'bold', fill: '#7a3a06',
                fontFamily: 'Arial, "Microsoft YaHei", sans-serif',
            });
            d.add(this._tankLvlTxt);
        }

        // ── FT 进口阀（串联）与旁通阀（并联）：手动截止阀，可点击切换，导通绿色 ──
        this._ftv = {
            in: this._valveH(d, 548, this._mainY),
            by: this._valveH(d, G.ft.cx, this._mainY + 64),
        };

        // ── AF 清洗状态：箱体背景绿色填充（动态层，压在剖面线上层）──
        this._afBg = new Konva.Rect({
            x: G.af.x + 1, y: G.af.y + 1, width: G.af.w - 2, height: G.af.h - 2,
            fill: '#2ecc40', opacity: 0,
        });
        d.add(this._afBg);

        // ── PDS 压差开关：闭合（ΔP ≥ 0.12）红色填充，断开还原浅蓝 ──
        this._pdsBox = new Konva.Rect({
            x: G.pds.x, y: G.pds.y, width: G.pds.w, height: G.pds.h, cornerRadius: 3,
            fill: '#eaf1fb', stroke: '#5b9ae0', strokeWidth: 1.6,
        });
        this._pdsTxt = new Konva.Text({
            x: G.pds.x, y: G.pds.y + 4, width: G.pds.w, text: 'PDS', align: 'center',
            fontSize: 9, fontStyle: 'bold', fill: '#5b9ae0',
            fontFamily: 'Arial, "Microsoft YaHei", sans-serif',
        });
        d.add(this._pdsBox);
        d.add(this._pdsTxt);
        // PDS 上方：压差动态度数（11px）
        this._pdsVal = new Konva.Text({
            x: G.pds.x, y: G.pds.y - 13, width: G.pds.w, align: 'center', text: '',
            fontSize: 11, fill: '#5b9ae0', fontFamily: 'Consolas, monospace',
        });
        d.add(this._pdsVal);

        // ── AF 放残管上的竖置电磁阀（反冲洗时通电开启）──
        this._sv = this._solenoidV(d, G.af.x + G.af.w / 2, 330);
        this._deaSv = this._solenoidV(d, G.tank.x + 16, 54, 'left');   // 左脱气管：线圈在左

        // ── 滤器手动三通转换阀（分叉 + 汇合，同步动作；手柄替代线圈）──
        const my = this._mainY;
        this._v3 = {
            sp: this._threeWayManual(d, 390, my, 'right'),   // 分叉：泵汇合 → 上 MF / 下 AF
            mg: this._threeWayManual(d, 498, my, 'left'),    // 汇合：MF / AF → 右去 FT
        };

        // ── 两只泵支路竖置手动截止阀（可手动开关，导通填充绿色）──
        this._vv = {
            sp2: this._valveV(d, 190, 150, 8),
            sp1: this._valveV(d, 190, 250, 8),
            cp2: this._valveV(d, 792, 150, 8),   // 循环泵入口竖管（右移 20px）
            cp1: this._valveV(d, 792, 250, 8),
            sh2: this._valveV(d, 922, 150, 8),   // 加热器入口竖管
            sh1: this._valveV(d, 922, 250, 8),
        };

        // ── 单向阀（进侧按流通着色，出侧恒灰）──
        this._ck = {
            sp2: this._checkV(d, 337, 150, 'down'),     // SP2 支路：向下汇合（与截止阀 y 对齐）
            sp1: this._checkV(d, 337, 250, 'up'),       // SP1 支路：向上汇合（与截止阀 y 对齐）
            cp2: this._checkV(d, 885, 150, 'down'),    // CP2 出口竖管：向下汇合（左移 15px）
            cp1: this._checkV(d, 885, 250, 'up'),      // CP1 出口竖管：向上汇合
            ft: this._checkV(d, 640, this._mainY, 'right'),   // FT 下游单向阀
            sh2: this._checkV(d, 1130, 150, 'down'),   // SH2 出口竖管：向下汇合
            sh1: this._checkV(d, 1130, 250, 'up'),     // SH1 出口竖管：向上汇合
        };

        // ── 泵盘面（运行时淡绿）+ 叶轮（运行时旋转）──
        this._pumpFace = {};
        this._pumpFan = {};
        [['sp1', G.sp1], ['sp2', G.sp2], ['cp1', G.cp1], ['cp2', G.cp2]].forEach(([k, P]) => {
            const face = new Konva.Circle({
                x: P.cx, y: P.cy, radius: P.r, fill: '#ffffff', stroke: '#333333', strokeWidth: 2.2,
            });
            d.add(face);
            this._pumpFace[k] = face;
            this._pumpFan[k] = this._makeFan(P.cx, P.cy, P.r);
        });

        // 蒸汽加热器填充（颜色随电动调节阀开度：开度越小越浅，50% 标准红，越大越深）
        this._dyn.heat2 = new Konva.Rect({
            x: G.sh2.x + 3, y: G.sh2.y + 3, width: G.sh2.w - 6, height: G.sh2.h - 6,
            fill: '#d63b1f', opacity: 0,
        });
        this._dyn.heat1 = new Konva.Rect({
            x: G.sh1.x + 3, y: G.sh1.y + 3, width: G.sh1.w - 6, height: G.sh1.h - 6,
            fill: '#d63b1f', opacity: 0,
        });
        d.add(this._dyn.heat2, this._dyn.heat1);

        // 电动调节阀阀体（填充随开度变深）
        this._srvBody = {
            a: new Konva.Line({
                points: [826, 361, 826, 379, 840, 370], closed: true, fill: '#ffffff',
                stroke: '#333333', strokeWidth: 1.8, lineJoin: 'round',
            }),
            b: new Konva.Line({
                points: [854, 361, 854, 379, 840, 370], closed: true, fill: '#ffffff',
                stroke: '#333333', strokeWidth: 1.8, lineJoin: 'round',
            }),
        };
        d.add(this._srvBody.a); d.add(this._srvBody.b);

        // 蒸汽单向阀（有蒸汽流量才填充）
        this._stCk = {
            sh1: this._checkV(d, 1052, 340, 'down'),
            sh2: this._checkV(d, 1052, 176, 'down'),
            out: this._checkV(d, 1178, 370, 'right'),
        };

        // 两只加热器进汽手动截止阀（可单独点击，导通绿色）
        this._htv = {
            sh2: this._valveV(d, 1000, 176, 8),
            sh1: this._valveV(d, 1000, 340, 8),
        };

        // 电动调节阀开度实时显示
        this._srvTxt = new Konva.Text({
            x: 806, y: 370 - 42, width: 68, align: 'center', text: '0%',
            fontSize: 13, fontStyle: 'bold', fill: '#0d6bb8',
            fontFamily: 'Consolas, monospace',
        });
        d.add(this._srvTxt);

        // 流动动画：按「柜 → 转换阀 → 泵运行支路 → 汇合 → 混合筒 → 循环泵支路 → 加热器 → 出口」
        // 逐段判定（泵运行 且 该支路截止阀导通 才流通），不画“从左到右的中心直线”
        this._dyn.flow = [];
        const mkFlow = (pts, cond) => {
            const n = new Konva.Line({
                points: pts, stroke: FLOW, strokeWidth: 3.6, dash: [13, 9], dashOffset: 0, opacity: 0,
            });
            d.add(n);
            this._dyn.flow.push({ node: n, cond });
        };
        const y = this._mainY, cvx = G.cv.cx;
        // ① 日用柜 → 三通阀（按当前柜别：HFO / DO）
        mkFlow([G.tankHFO.x + G.tankHFO.w, 121, cvx, 121, cvx, y],
            m => m.cv === 'HFO' && this._spAny(m));
        mkFlow([G.tankDO.x + G.tankDO.w, 305, cvx, 305, cvx, y],
            m => m.cv === 'DO' && this._spAny(m));
        // ② 电磁三通阀 → 走“泵运行”的那条支路（含该支路截止阀）→ 到手动三通阀（分叉）
        mkFlow([cvx + 13.5, y, 190, y, 190, 115, 290, 115, 337, 115, 337, y, 376.5, y],
            m => this._spRun(m, 'sp2'));
        mkFlow([cvx + 13.5, y, 190, y, 190, 285, 290, 285, 337, 285, 337, y, 376.5, y],
            m => this._spRun(m, 'sp1'));
        // ②b 分叉阀 → 被选中的那条滤器支路（两手动三通阀同步选位）→ 汇合阀
        mkFlow([376.5, y, 390, y, 390, 115, 432, 115, 498, 115, 498, 186.5],
            m => this._spAny(m) && (m.strainerSel || 'af') === 'mf');
        mkFlow([376.5, y, 390, y, 390, 285, 432, 285, 498, 285, 498, 213.5],
            m => this._spAny(m) && (m.strainerSel || 'af') === 'af');
        // ③ 汇合阀 → FT → 混合筒
        // ③a 经 FT 的油路（两阀同开时与旁通并联、流量均分）
        mkFlow([511.5, y, G.tank.x, y],
            m => this._spAny(m) && ((m.ftPath || 'ft') === 'ft' || m.ftPath === 'both'));
        // ③b 经旁通阀的油路（不经过 FT）
        mkFlow([511.5, y, 522, y, 522, y + 64, 654, y + 64, 654, y, G.tank.x, y],
            m => this._spAny(m) && (m.ftPath === 'bypass' || m.ftPath === 'both'));
        // ④ 混合筒 → 循环泵运行支路 → 加热器汇合
        mkFlow([G.tank.x + G.tank.w, y, 792, y, 792, 115, 825, 115, 859, 115, 885, 115, 885, y,
            922, y, 922, 163.5],
            m => this._cpRun(m, 'cp2'));
        mkFlow([922, 136.5, 922, 115, G.sh2.x, 115, G.sh2.x + G.sh2.w, 115, 1130, 115, 1130, y],
            m => this._shRun(m, 'sh2'));
        mkFlow([G.tank.x + G.tank.w, y, 792, y, 792, 285, 825, 285, 859, 285, 885, 285, 885, y,
            922, y, 922, 236.5],
            m => this._cpRun(m, 'cp1'));
        mkFlow([922, 263.5, 922, 285, G.sh1.x, 285, G.sh1.x + G.sh1.w, 285, 1130, 285, 1130, y],
            m => this._shRun(m, 'sh1'));
        // ⑤ 出口 → 柴油机
        // ⑤a 经 VT 的油路（进口阀导通 / 两阀同开均分时）
        mkFlow([1130, y, G.engine.x, y],
            m => this._cpAny(m) && ((m.vtPath || 'vt') === 'vt' || m.vtPath === 'both'));
        // ⑤b 经 VT 并联截止阀的油路（不流经 VT）
        mkFlow([1130, y, 1216, y, 1216, y + 56, 1344, y + 56, 1344, y, G.engine.x, y],
            m => this._cpAny(m) && (m.vtPath === 'bypass' || m.vtPath === 'both'));
        // ⑥ 蒸汽流动虚线（浅蓝底上用中蓝虚线，按各支路进汽阀开关）
        this._steamFlow = [];
        const mkSteamFlow = (pts, cond) => {
            const n = new Konva.Line({
                points: pts, stroke: '#4aa3e0', strokeWidth: 3.4, dash: [12, 9], dashOffset: 0, opacity: 0,
            });
            d.add(n);
            this._steamFlow.push({ node: n, cond });
        };
        mkSteamFlow([730, 370, 1000, 370, 1000, 306],
            m => m.procOn && (m.steamSV || {}).sh1 !== false && (m.heater.shs || 0) > 0.5);
        mkSteamFlow([950, 370, 950, 210, 1000, 210, 1000, 136],
            m => m.procOn && (m.steamSV || {}).sh2 !== false && (m.heater.shs || 0) > 0.5);
        mkSteamFlow([1052, 306, 1052, 370, 1300, 370],
            m => m.procOn && (m.steamSV || {}).sh1 !== false && (m.heater.shs || 0) > 0.5);
        mkSteamFlow([1052, 136, 1052, 210, 1102, 210, 1102, 370, 1300, 370],
            m => m.procOn && (m.steamSV || {}).sh2 !== false && (m.heater.shs || 0) > 0.5);

        // ⑦ 柴油机回油：主机顶部 → 顶部回油总管 → 回混油筒；线宽随负荷（0% 最粗，100% 无回油）
        this._retFlow = new Konva.Line({
            points: [G.engine.x + 58, G.engine.y + 12, G.engine.x + 58, 30, G.tank.x + 46, 30, G.tank.x + 46, G.tank.y],
            stroke: FLOW, strokeWidth: 6, dash: [13, 9], dashOffset: 0, opacity: 0,
        });
        d.add(this._retFlow);

        // 传感器读数
        const val = (x, y2) => {
            const t = new Konva.Text({
                x: x - 20, y: y2, width: 40, align: 'center', text: '',
                fontSize: 11.5, fill: '#b03a1f', fontFamily: 'Consolas, monospace',
            });
            d.add(t);
            return t;
        };
        this._dyn.vFT = val(G.ft.cx, G.ft.cy + 18);
        this._dyn.vPT1 = val(G.pt1.cx, G.pt1.cy - 29);
        this._dyn.vPT2 = val(G.pt2.cx, G.pt2.cy - 31);
        this._dyn.vTT = val(G.tt.cx, G.tt.cy + 16);
        this._dyn.vVT = val(G.vt.cx, G.vt.cy + 16);
    }

    // ═══════════════════════════════════════════════════════════
    //  交互
    // ═══════════════════════════════════════════════════════════
    _clearPartBg(hit) {
        try {
            const p = hit && hit.getParent && hit.getParent();
            const bg = p && p.getChildren && p.getChildren()[0];
            if (bg && typeof bg.fill === 'function') bg.fill('rgba(0,0,0,0)');
        } catch (e) { /* ignore */ }
    }

    _bindInteraction() {
        const G = this._geo;
        const add = (id, x, y, w, h, handler) => {
            const hit = this.addClickablePart(id, x, y, w, h, true);
            if (handler) hit.on('click tap', handler);
            else hit.on('click tap', () => this._tipPart(id));
            this._clearPartBg(hit);
            return hit;
        };

        add('hfo-tank', G.tankHFO.x, G.tankHFO.y, G.tankHFO.w, G.tankHFO.h);
        add('do-tank', G.tankDO.x, G.tankDO.y, G.tankDO.w, G.tankDO.h);
        add('cv', G.cv.cx - 50, G.cv.cy - 18, 66, 36);   // 仅识别（电磁阀只能电控，不可手动）
        add('sp1', G.sp1.cx - 24, G.sp1.cy - 24, 48, 48);
        add('ck-sp1', 337 - 15, 250 - 15, 30, 30);
        add('ck-sp2', 337 - 15, 150 - 15, 30, 30);
        add('valve-sh1', 922 - 16, 250 - 18, 44, 36, () => this._toggleValve('sh1'));
        add('valve-sh2', 922 - 16, 150 - 18, 44, 36, () => this._toggleValve('sh2'));
        // 加热器：整体（供工作流定位）→ SH1 / SH2 各自独立 → 进汽阀（最上层）
        add('heater', G.sh2.x - 6, G.sh2.y - 6, G.sh2.w + 12, (G.sh1.y + G.sh1.h) - G.sh2.y + 12);
        add('heater-sh2', G.sh2.x - 4, G.sh2.y - 4, G.sh2.w + 8, G.sh2.h + 8);
        add('heater-sh1', G.sh1.x - 4, G.sh1.y - 4, G.sh1.w + 8, G.sh1.h + 8);
        add('stv-sh1', 1000 - 16, 340 - 18, 44, 36, () => this._toggleHeaterSV('sh1'));
        add('stv-sh2', 1000 - 16, 176 - 18, 44, 36, () => this._toggleHeaterSV('sh2'));
        add('ck-sh1', 1130 - 15, 250 - 15, 30, 30);
        add('ck-sh2', 1130 - 15, 150 - 15, 30, 30);
        add('ck-ft', 640 - 15, 200 - 15, 30, 30);
        add('ck-cp1', 885 - 15, 250 - 15, 30, 30);
        add('ck-cp2', 885 - 15, 150 - 15, 30, 30);
        add('valve-cp1', 792 - 16, 250 - 18, 44, 36, () => this._toggleValve('cp1'));
        add('valve-cp2', 792 - 16, 150 - 18, 44, 36, () => this._toggleValve('cp2'));
        add('valve-sp1', 190 - 16, 250 - 18, 44, 36, () => this._toggleValve('sp1'));
        add('valve-sp2', 190 - 16, 150 - 18, 44, 36, () => this._toggleValve('sp2'));
        add('sp2', G.sp2.cx - 24, G.sp2.cy - 24, 48, 48);
        add('afb', G.mf.x - 40, G.mf.y - 10, 100, (G.af.y + G.af.h) - G.mf.y + 20);
        add('pds', G.pds.x, G.pds.y, G.pds.w, G.pds.h);
        add('ft', G.ft.cx - G.ft.r, G.ft.cy - G.ft.r, G.ft.r * 2, G.ft.r * 2);
        add('pt1', G.pt1.cx - G.pt1.r, G.pt1.cy - G.pt1.r, G.pt1.r * 2, G.pt1.r * 2);
        add('tank', G.tank.x, G.tank.y, G.tank.w, G.tank.h);
        add('ls', G.ls.cx - G.ls.r, G.ls.cy - G.ls.r, G.ls.r * 2, G.ls.r * 2);
        add('dea-valve', G.tank.x + 4, 40, 26, 40);
        add('cp1', G.cp1.cx - 22, G.cp1.cy - 22, 44, 44);
        add('cp2', G.cp2.cx - 22, G.cp2.cy - 22, 44, 44);
        add('pt2', G.pt2.cx - G.pt2.r, G.pt2.cy - G.pt2.r, G.pt2.r * 2, G.pt2.r * 2);
        add('tt', G.tt.cx - G.tt.r, G.tt.cy - G.tt.r, G.tt.r * 2, G.tt.r * 2);
        add('vt', G.vt.cx - G.vt.r, G.vt.cy - G.vt.r, G.vt.r * 2, G.vt.r * 2);
        add('engine', G.engine.x, G.engine.y, G.engine.w, G.engine.h);
        add('pcv', G.pcv.cx - 14, G.pcv.cy - 18, 28, 36);
        // 手动三通转换阀（最后注册 → 压过 afb 大热区，保证可点）
        add('vt-in', 1236 - 18, 200 - 20, 36, 40, () => this._toggleVtValve('in'));
        add('vt-bye', 1280 - 18, 256 - 20, 36, 40, () => this._toggleVtValve('par'));
        add('vt-ck', 1314 - 15, 200 - 15, 30, 30);
        add('engine-load', 1310 - 22, 108 - 22, 44, 44, (e) => this._bumpEngineLoad(e.target));
        add('ft-in', 548 - 18, 200 - 20, 36, 40, () => this._toggleFtValve('in'));
        add('ft-by', G.ft.cx - 18, 200 + 64 - 20, 36, 40, () => this._toggleFtValve('by'));
        add('af-drain', G.af.x + G.af.w / 2 - 16, 330 - 16, 54, 32);
        add('v3w-split', 374, 184, 56, 32, () => this._toggleStrainer3w());
        add('v3w-merge', 461, 184, 54, 32, () => this._toggleStrainer3w());

        // 右侧热区与图形一致上移 25px（两只日用柜保持原位）
        Object.keys(this._parts || {}).forEach(pid => {
            if (pid === 'hfo-tank' || pid === 'do-tank') return;
            const p = this._parts[pid];
            p.y -= 25;
            const grp = p.node && p.node.getParent ? p.node.getParent() : null;
            if (grp && grp.y) grp.y(grp.y() - 25);
        });
    }

    /** 支路可流通：泵运行 且 该支路手动截止阀导通 且 下游油路未被两阀关断 */
    _spRun(m, id) {
        if (m.ftPath === 'blocked') return false;   // FT 进出口阀全关 → 整条供油油路不通
        return !!(m.pumps[id] && m.pumps[id].on && (!m.manualValves || m.manualValves[id] !== false));
    }

    /** 供油侧任一支路可流通 */
    _spAny(m) { return this._spRun(m, 'sp1') || this._spRun(m, 'sp2'); }

    /** 循环支路可流通：循环泵运行 且 混油筒有油 且 到柴油机油路未被两阀关断（与供油泵无关） */
    _cpRun(m, id) {
        if (!(m.pumps[id] && m.pumps[id].on)) return false;
        if (m.manualValves && m.manualValves[id] === false) return false;   // 支路截止阀关闭
        if (m.tank && m.tank.level <= 1) return false;      // 筒内无油，泵不上油
        return (m.vtPath || 'vt') !== 'blocked';
    }

    _cpAny(m) { return this._cpRun(m, 'cp1') || this._cpRun(m, 'cp2'); }

    /** 加热器支路可流通：对应循环泵支路通 且 该支路截止阀导通 */
    _shRun(m, id) {
        // 两台加热器在循环泵汇合之后**并联**分叉（x=922），
        // 因此只要有任一台循环泵在循环，各支路是否流通只由该支路燃油截止阀决定
        if (!this._cpAny(m)) return false;
        return !(m.manualValves && m.manualValves[id] === false);
    }

    /** 点击负荷旋钮：左半区 −5%、右半区 +5%（无指针位置时默认 +5%） */
    _toggleHeaterSV(k) {
        const s = this._solver();
        if (!s) return;
        s.toggleHeaterSV(k);
        this._syncVisuals();
    }

    _toggleVtValve(k) {
        const s = this._solver();
        if (!s) return;
        s.toggleVtValve(k);
        this._syncVisuals();
    }

    _bumpEngineLoad(node) {
        const s = this._solver();
        if (!s) return;
        let d = 5;
        try {
            const stage = node && node.getStage && node.getStage();
            const ptr = stage && stage.getPointerPosition && stage.getPointerPosition();
            if (ptr && node && node.getAbsoluteTransform) {
                const local = node.getAbsoluteTransform().copy().invert().point(ptr);
                d = local.x >= (node.width ? node.width() / 2 : 14) ? 5 : -5;
            }
        } catch (e) { /* ignore */ }
        s.setEngineLoad((s.m.engineLoad == null ? 50 : s.m.engineLoad) + d);
        this._syncVisuals();
    }

    _toggleFtValve(k) {
        const s = this._solver();
        if (!s) return;
        s.toggleFtValve(k);
        this._syncVisuals();
    }

    _toggleStrainer3w() {
        const s = this._solver();
        if (!s) return;
        s.toggleStrainer3w();
        this._syncVisuals();
    }

    _toggleValve(id) {
        const s = this._solver();
        if (!s) return;
        s.toggleBranchValve(id);
        this._syncVisuals();
    }

    _tipPart(id) {
        const s = this._solver();
        const m = s ? s.m : null;
        if (!m) return;
        if (id && id.startsWith('ck-')) {
            const key = id.slice(3);
            const flow = (key === 'sp1' || key === 'sp2') ? this._spRun(m, key)
                : (key === 'sh1' || key === 'sh2') ? this._shRun(m, key)
                    : (key === 'ft') ? this._spAny(m)
                        : this._cpRun(m, key);
            this._tip(`单向阀（${key.toUpperCase()} 支路）：${flow ? '正向流通（进侧绿、出侧灰）' : '不流通（进侧白、出侧灰）'}，反向不可流通`);
            return;
        }
        if (id && id.startsWith('valve-')) {
            const key = id.slice(6);
            const open = (m.manualValves || {})[key] !== false;
            const nm = key.startsWith('sp') ? `${key === 'sp1' ? '1' : '2'} 号供油泵` : `${key === 'cp1' ? '1' : '2'} 号循环泵`;
            this._tip(`${nm} 支路手动截止阀（竖置）：${open ? '导通（绿色）' : '关闭'}，点击可手动开/关`);
            return;
        }
        if (id === 'heater-sh1' || id === 'heater-sh2') {
            const k = id === 'heater-sh1' ? 'sh1' : 'sh2';
            const svOn = (m.steamSV || {})[k] !== false;
            const cap = (m.steamSV || {}).sh1 !== false;
            this._tip(`${k === 'sh1' ? '1' : '2'} 号蒸汽加热器（S/H）：进汽截止阀${svOn ? '导通' : '关闭'}，`
                + `当前加热量 ${(m.heater.effPower || 0).toFixed(0)}%（总容量系数 ${(m.heater.capFactor == null ? 1 : m.heater.capFactor)}）`);
            return;
        }
        if (id === 'stv-sh1' || id === 'stv-sh2') {
            const k = id === 'stv-sh1' ? 'sh1' : 'sh2';
            const on = (m.steamSV || {})[k] !== false;
            this._tip(`${k === 'sh1' ? '1' : '2'} 号加热器进汽手动截止阀：${on ? '导通（绿色）——该加热器有蒸汽' : '关闭（白色）——该加热器无蒸汽'}，点击切换`);
            return;
        }
        if (id === 'vt-in' || id === 'vt-bye') {
            const on = id === 'vt-in' ? (m.vtValves || {}).in : (m.vtValves || {}).par;
            this._tip(`VT 回路${id === 'vt-in' ? '进口' : '并联'}手动截止阀：${on ? '导通（绿色）' : '断开（白色）'}，点击切换`);
            return;
        }
        if (id === 'vt-ck') {
            const on = this._spAny(m) && (m.vtPath === 'vt' || m.vtPath === 'both');
            this._tip(`VT 出口单向阀：${on ? '正向流通（进侧绿、出侧灰）' : '不流通（进侧白、出侧灰）'}，反向不可流通`);
            return;
        }
        if (id === 'engine-load') {
            this._tip(`柴油机负荷调节旋钮：当前 ${(m.engineLoad == null ? 50 : m.engineLoad)}%；点右侧 +5%、左侧 -5%，负荷决定混油筒向下游的出油消耗`);
            return;
        }
        if (id === 'ft-in' || id === 'ft-by') {
            const v = (m.ftValves || {});
            const on = id === 'ft-in' ? v.in : v.by;
            this._tip(`FT ${id === 'ft-in' ? '进口' : '旁通'}手动截止阀：${on ? '导通（绿色）' : '断开（白色）'}，点击切换`);
            return;
        }
        if (id === 'af-drain') {
            const en = !!m.filter.flushing;
            this._tip(`自动滤器 AF 放残电磁阀（竖置，只能电控）：${en ? '线圈通电（红）→ 阀开（两三角绿），正在反冲洗放残' : '线圈断电 → 阀闭；AUTO 方式按 Fa21 间隔反冲洗时自动通电开阀'}`);
            return;
        }
        if (id === 'v3w-split' || id === 'v3w-merge') {
            const mf = (m.strainerSel || 'af') === 'mf';
            this._tip(`滤器手动三通转换阀（${id === 'v3w-split' ? '分叉' : '汇合'}，两只同步动作）：当前走 ${mf ? '手动滤器 MF（上）' : '自动滤器 AF（下）'} 支路，点击切换`);
            return;
        }
        const tips = {
            'hfo-tank': 'HFO 日用柜（重油）：经三通转换阀向供油泵供油，回油也返回此柜',
            'do-tank': 'IDO 日用柜（柴油）：换油与轻油工况使用',
            'cv': `三通转换阀（电磁换向，只能电控不可手动）：${m.cv === 'HFO' ? '线圈通电（红）→ 上支路 HFO 导通' : '线圈断电 → 下支路 DO 导通'}，右支路（出口）常通；变换请用 EPC-50B 的 HFO/DO 按钮并按「+」确认`,
            'sp1': `1 号供油泵：${m.pumps.sp1.on ? '运行' : '停止'}，泵前设过滤器、泵后设止回阀`,
            'sp2': `2 号供油泵：${m.pumps.sp2.on ? '运行' : '停止'}，与 1 号泵互为备用`,
            'afb': `手动滤器 MF / 自动滤器 AF：压差 ${m.filter.dp.toFixed(3)} MPa；AUTO 方式按 Fa21 间隔自动反冲洗`,
            'pds': `压差开关 PDS：进出口压差达设定值时报滤器脏堵（当前 ${m.filter.dp.toFixed(3)} MPa）`,
            'ft': `流量变送器 FT：${(m.oil.ftFlow || 0).toFixed(2)} m³/h；油路 ${m.ftPath === 'ft' ? '经 FT' : (m.ftPath === 'bypass' ? '经旁通阀（未流经 FT）' : (m.ftPath === 'both' ? '两阀同开：FT 与旁通并联、流量均分' : '不通（两阀全关）'))}`,
            'pt1': `压力变送器 PT1：供油泵出口压力 ${m.oil.supplyPress.toFixed(2)} MPa`,
            'tank': '立式混合筒：主机回油与新供燃油在此混合，气体上浮经顶部脱气阀放回 HFO 柜',
            'ls': `液位开关 LS：检测混合筒液位（当前 ${m.dea.level.toFixed(0)}%，${m.dea.valve ? '脱气中' : '正常'}）`,
            'dea-valve': '脱气阀（混合筒顶部两只）：把气体放回 HFO 日用柜的回油总管',
            'cp1': `1 号循环泵：${m.pumps.cp1.on ? '运行' : '停止'}，向主机提供所需油压`,
            'cp2': `2 号循环泵：${m.pumps.cp2.on ? '运行' : '停止'}`,
            'heater': `加热器 SH1/SH2：蒸汽阀开度 ${Math.round(m.heater.shs)} %，加热量 ${Math.round(m.heater.effPower || 0)} %`,
            'pt2': `压力变送器 PT2：主机进油压力 ${m.oil.circPress.toFixed(2)} MPa`,
            'tt': `温度传感器 TT：${m.oil.temp.toFixed(1)} ℃`,
            'vt': `黏度传感器 VT：${m.oil.visc.toFixed(1)} cSt（带旁通阀）`,
            'engine': '柴油机（主机）：多余燃油经顶部回油总管返回 HFO 日用柜',
            'pcv': `主机回油管路：回油自柴油机顶部经总管回到混油筒；回油量随负荷变化（当前负荷 ${(m.engineLoad == null ? 50 : m.engineLoad)}%，负荷越低回油越多）`,
            'return-valve': '回油阀：顶部回油总管上的截止阀（回油经此返回 HFO 日用柜）',
        };
        this._tip(tips[id] || id);
    }

    // ═══════════════════════════════════════════════════════════
    //  显示同步
    // ═══════════════════════════════════════════════════════════
    _syncVisuals() {
        const s = this._solver();
        const m = s ? s.m : null;
        if (!m) return;
        const G = this._geo, D = this._dyn;

        // 单向阀：进侧流通绿 / 不流通白；出侧恒灰
        if (this._ck) {
            const CK_IN = '#2ecc40', CK_OUT = '#b0b6bb';
            const set = (n, flowing) => {
                if (!n) return;
                n.in.fill(flowing ? CK_IN : '#ffffff');
                n.out.fill(CK_OUT);
            };
            set(this._ck.sp2, this._spRun(m, 'sp2'));
            set(this._ck.sp1, this._spRun(m, 'sp1'));
            set(this._ck.cp2, this._cpRun(m, 'cp2'));
            set(this._ck.sh2, this._shRun(m, 'sh2'));
            set(this._ck.cp1, this._cpRun(m, 'cp1'));
            set(this._ck.sh1, this._shRun(m, 'sh1'));
            set(this._ck.ft, this._spAny(m));
        }

        // 泵：运行时盘面填充淡绿 + 叶轮持续旋转
        const RUNF = '#d4f5dc';
        ['sp1', 'sp2', 'cp1', 'cp2'].forEach(k => {
            const on = m.pumps[k].on;
            const face = this._pumpFace && this._pumpFace[k];
            if (face) face.fill(on ? RUNF : '#ffffff');
            const fan = this._pumpFan && this._pumpFan[k];
            if (fan) fan.rotation((fan.rotation() + (on ? 14 : 0)) % 360);
        });

        // 三通转换阀：线圈通电 → 线圈红、上(HFO)+右 出口绿；断电 → 下(DO)+右 出口绿
        if (this._cv) {
            const energized = m.cv === 'HFO';
            this._cv.coil.fill(energized ? '#e53935' : '#ffffff');
            this._cv.coilLines.forEach(l => l.stroke(energized ? '#ffdada' : '#666666'));
            this._cv.up.fill(energized ? '#2ecc40' : '#ffffff');
            this._cv.dn.fill(energized ? '#ffffff' : '#2ecc40');
            this._cv.rt.fill('#2ecc40');
        }

        // 柴油机负荷旋钮：0% → -135°，100% → +135°
        if (this._loadPtr) {
            const load = m.engineLoad == null ? 50 : m.engineLoad;
            this._loadPtr.rotation(-135 + 270 * load / 100);
            if (this._loadTxt) this._loadTxt.text(`负荷 ${load.toFixed(0)}%`);
        }

        // 转换阀开度显示（转换过程中）
        if (this._cvTxt) {
            const sw = !!m.cvSwitching;
            this._cvTxt.visible(sw);
            if (sw) this._cvTxt.text(`${Math.round(m.cvPos || 0)}%`);
        }

        // LS 液位开关：与 EPC 小图同步（液位低/脱气动作时红色）
        if (this._lsCircle) {
            const on = !!m.dea.valve;
            this._lsCircle.fill(on ? '#e53935' : '#ffffff');
            this._lsTxt.fill(on ? '#ffffff' : '#111111');
        }

        // 日用柜：油温 / 黏度（按当前油品等级换算）
        const sv = this._solver();
        if (sv && sv.tankState) {
            const h = sv.tankState('hfo'), dd = sv.tankState('do');
            if (this._hfoInfo) this._hfoInfo.text([`${h.temp.toFixed(0)}℃`, `${h.visc.toFixed(0)}cSt`].join('\n'));
            if (this._doInfo) this._doInfo.text([`${dd.temp.toFixed(0)}℃`, `${dd.visc.toFixed(0)}cSt`].join('\n'));
        }

        // 混油筒液位：自筒底向上填充
        if (this._tankLvl) {
            const T = G.tank;
            const lv = Math.max(0, Math.min(100, (m.tank && m.tank.level) || 0));
            const hMax = T.h - 6, hh = hMax * lv / 100;
            this._tankLvl.height(hh);
            this._tankLvl.y(T.y + T.h - 3 - hh);
            this._tankLvl.visible(hh > 0.5);
            if (this._tankLvlTxt) this._tankLvlTxt.text(`${lv.toFixed(0)}%`);
            if (this._tankTempTxt) this._tankTempTxt.text(`${(m.tank.temp || 0).toFixed(0)}℃`);
            if (this._tankPressTxt) this._tankPressTxt.text(`${(m.tank.press || 0).toFixed(2)}MPa`);   // 筒压由液位决定
        }

        // VT 回路：进口阀 / 并联阀导通绿色；单向阀进侧随 VT 支路流动着色
        if (this._vtv && m.vtValves) {
            const setV = (v, on) => { if (!v) return; v.lf.fill(on ? '#2ecc40' : '#ffffff'); v.rt.fill(on ? '#2ecc40' : '#ffffff'); };
            setV(this._vtv.in, m.vtValves.in);
            setV(this._vtv.par, m.vtValves.par);
            if (this._vtck) {
                // 有流动才导通：VT 支路被选通 且 供油泵确实在供油（油路未断）
                const on = this._spAny(m) && (m.vtPath === 'vt' || m.vtPath === 'both');
                this._vtck.in.fill(on ? '#2ecc40' : '#ffffff');
                this._vtck.out.fill('#b0b6bb');
            }
        }

        // FT 进口阀 / 旁通阀：导通绿色、不通白色
        if (this._ftv && m.ftValves) {
            const setV = (v, on) => { if (!v) return; v.lf.fill(on ? '#2ecc40' : '#ffffff'); v.rt.fill(on ? '#2ecc40' : '#ffffff'); };
            setV(this._ftv.in, m.ftValves.in);
            setV(this._ftv.by, m.ftValves.by);
        }

        // AF 清洗状态：背景绿色填充；PDS 压差开关闭合（脏堵）红色填充
        if (this._afBg) this._afBg.opacity((m.filter.flushing && m.filter.flushKind === 'clean') ? 0.55 : 0);   // 仅清洗时绿色，周期性卸放不填充
        if (this._pdsBox) {
            const closed = !!m.filter.pds;
            this._pdsBox.fill(closed ? '#e53935' : '#eaf1fb');
            this._pdsBox.stroke(closed ? '#b71c1c' : '#5b9ae0');
            this._pdsTxt.fill(closed ? '#ffffff' : '#5b9ae0');
            if (this._pdsVal) {
                this._pdsVal.text('ΔP ' + (m.filter.dp || 0).toFixed(3));
                this._pdsVal.fill(closed ? '#e53935' : '#5b9ae0');
            }
        }

        // 脱气电磁阀（左管）：脱气时通电 → 线圈红 + 两三角绿
        if (this._deaSv) {
            const dea = !!m.dea.valve;
            this._deaSv.top.fill(dea ? '#2ecc40' : '#ffffff');
            this._deaSv.bot.fill(dea ? '#2ecc40' : '#ffffff');
            this._deaSv.coil.fill(dea ? '#e53935' : '#ffffff');
            this._deaSv.coilLines.forEach(l => l.stroke(dea ? '#ffdada' : '#666666'));
        }

        // AF 放残电磁阀：反冲洗（放残）时线圈通电 → 红 + 两三角绿；否则白
        if (this._sv) {
            const en = !!m.filter.flushing;
            this._sv.top.fill(en ? '#2ecc40' : '#ffffff');
            this._sv.bot.fill(en ? '#2ecc40' : '#ffffff');
            this._sv.coil.fill(en ? '#e53935' : '#ffffff');
            this._sv.coilLines.forEach(l => l.stroke(en ? '#ffdada' : '#666666'));
        }

        // 滤器手动三通转换阀：选中支路绿、公共口常绿，手柄旋转指向在用支路（两阀同步）
        if (this._v3) {
            const upOn = (m.strainerSel || 'af') === 'mf';
            [this._v3.sp, this._v3.mg].forEach(v => {
                v.up.fill(upOn ? '#2ecc40' : '#ffffff');
                v.dn.fill(upOn ? '#ffffff' : '#2ecc40');
                v.com.fill('#2ecc40');
                v.piv.rotation((upOn ? -v.s : v.s) * 45);
            });
        }

        // 泵支路竖置截止阀：导通时两三角填充绿色
        if (this._vv) {
            const mv = m.manualValves || {};
            ['sp1', 'sp2', 'cp1', 'cp2', 'sh1', 'sh2'].forEach(k => {
                const v = this._vv[k];
                if (!v) return;
                const open = mv[k] !== false;
                v.top.fill(open ? '#2ecc40' : '#ffffff');
                v.bot.fill(open ? '#2ecc40' : '#ffffff');
            });
        }

        // 蒸汽加热器填充 + 调节阀开度显示
        const srvOpen = Math.max(0, Math.min(100, m.heater.shs || 0));
        const steamOn = !!(m.procOn && m.mainPower && srvOpen > 0.5);
        const blend = (a, b, t) => `rgb(${Math.round(a[0] + (b[0] - a[0]) * t)},${Math.round(a[1] + (b[1] - a[1]) * t)},${Math.round(a[2] + (b[2] - a[2]) * t)})`;
        const WHT = [255, 255, 255], BASE = [214, 59, 31], DEEP = [122, 24, 8];
        const steamColor = srvOpen <= 50
            ? blend(WHT, BASE, Math.max(0.06, srvOpen / 50))      // 开度越小越浅
            : blend(BASE, DEEP, (srvOpen - 50) / 50);             // 开度越大越深
        const svState = m.steamSV || { sh1: true, sh2: true };
        if (this._htv) {
            [['sh1', this._htv.sh1], ['sh2', this._htv.sh2]].forEach(([k, v]) => {
                if (!v) return;
                const on = svState[k] !== false;
                v.top.fill(on ? '#2ecc40' : '#ffffff');
                v.bot.fill(on ? '#2ecc40' : '#ffffff');
            });
        }
        // 电动调节阀阀体：开度 0% 无填充 → 50% 淡绿 → 100% 深绿
        if (this._srvBody) {
            const WHT = [255, 255, 255], LGREEN = [196, 240, 205], DGREEN = [24, 118, 40];
            const c = srvOpen <= 0.5 ? 'rgb(255,255,255)'
                : srvOpen <= 50 ? blend(WHT, LGREEN, srvOpen / 50)
                    : blend(LGREEN, DGREEN, (srvOpen - 50) / 50);
            this._srvBody.a.fill(c);
            this._srvBody.b.fill(c);
        }
        // 蒸汽单向阀：无蒸汽流量不填充（进侧白），有流量才绿
        if (this._stCk) {
            const setCk = (ck, on) => {
                if (!ck) return;
                ck.in.fill(on ? '#2ecc40' : '#ffffff');
                ck.out.fill('#b0b6bb');
            };
            setCk(this._stCk.sh1, steamOn && svState.sh1 !== false);
            setCk(this._stCk.sh2, steamOn && svState.sh2 !== false);
            setCk(this._stCk.out, steamOn && (svState.sh1 !== false || svState.sh2 !== false));
        }

        const fillH = (r, key) => {
            if (!r) return;
            const on = steamOn && svState[key] !== false;
            r.fill(steamColor);
            r.opacity(on ? 0.85 : 0);
        };
        fillH(D.heat2, 'sh2');
        fillH(D.heat1, 'sh1');
        if (this._srvTxt) this._srvTxt.text(`${srvOpen.toFixed(0)}%`);

        this._flowPhase = (this._flowPhase + 1) % 22;
        (this._steamFlow || []).forEach(f => {
            let on = false;
            try { on = !!f.cond(m); } catch (e) { on = false; }
            f.node.opacity(on ? 0.95 : 0);
            if (on) f.node.dashOffset(-this._flowPhase);
        });
        // 回油流动：负荷越低回油越多（线宽越粗）；100% 负荷时无回油
        if (this._retFlow) {
            const load = (m.engineLoad == null ? 50 : m.engineLoad) / 100;
            const w = Math.max(0, 7 * (1 - load));
            const on = this._cpAny(m) && w > 0.6;
            this._retFlow.opacity(on ? 1 : 0);
            this._retFlow.strokeWidth(w);
            if (on) this._retFlow.dashOffset(-this._flowPhase);
        }
        D.flow.forEach(f => {
            let on = false;
            try { on = !!f.cond(m); } catch (e) { on = false; }
            f.node.opacity(on ? 1 : 0);
            if (on) f.node.dashOffset(-this._flowPhase);
        });

        if (D.vFT) D.vFT.text(`${(m.oil.ftFlow || 0).toFixed(2)}`);
        if (D.vPT1) D.vPT1.text(`${m.oil.supplyPress.toFixed(2)}`);
        if (D.vPT2) D.vPT2.text(`${m.oil.circPress.toFixed(2)}`);
        // TT / VT：显示求解器给出的实测值（无流动为 0；传感器故障显示 ***）
        if (D.vTT) D.vTT.text(m.oil.ttBad ? '***' : `${(m.oil.ttVal || 0).toFixed(0)}℃`);
        if (D.vVT) D.vVT.text(m.oil.vtBad ? '***' : `${(m.oil.vtVal || 0).toFixed(0)}cSt`);

        if (this.sys && this.sys.requestRedraw) this.sys.requestRedraw();
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

export default FuelSupplyMimic;
