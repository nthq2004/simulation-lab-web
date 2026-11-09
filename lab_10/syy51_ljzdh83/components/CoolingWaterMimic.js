import Konva from 'konva';
import { BaseComponent } from './BaseComponent.js';
import { tempColor, CoolingWaterSolver } from '../tools/CoolingWaterSolver.js';

/** 管路颜色 */
const PIPE = '#00a9e8';
const AUX = '#777777';
const GREEN = '#188b14';
const ON_COLOR = '#2ecc40';

/** 阀门三角形统一尺寸（截止阀 / 单向阀 / 三通阀共用） */
const TRI_A = 13.5, TRI_B = 9.5;

/** 顶点在阀芯中心 (cx,cy)、基边距中心 a、指向角度 ang 的三角形（Konva 坐标，y 向下） */
function triPts(cx, cy, ang, a = TRI_A, b = TRI_B) {
    const r = ang * Math.PI / 180;
    const ux = Math.cos(r), uy = Math.sin(r);
    const px = -uy, py = ux;
    const bx = cx + ux * a, by = cy + uy * a;
    return [bx + px * b, by + py * b, bx - px * b, by - py * b, cx, cy];
}

/**
 * CoolingWaterMimic — 船舶主机高温冷却水（缸套淡水）系统模拟图（MIMIC）
 * ═══════════════════════════════════════════════════════════════════════════
 *  版式参照「船舶主机冷却水系统 MIMIC 图」（新图），全部直角走线、单一流向：
 *
 *   ┌ 主机（缸套出口 T 36.0 / P 0.0 / G 0.0）
 *   │    ├─ 缸套出口温度表（Cyl. Outlet）
 *   │    └─ TC ─ WB-V28S（止回）── 主管 y=205 ─▶ 右
 *   │         ├ x=560 ↑ WB-V6S ─ 造水机 34 ─ WB-V7S ↓ x=720
 *   │         └ WB-V5 ─▶ x=1010 ↓ 泵吸入竖管 ─┬ WB-V8 ─ 1#泵 ─ WB-V10S ┐
 *   │                                          └ WB-V9 ─ 2#泵 ─ WB-V11S ┴ x=1160
 *   │                                          排出总管 ─▶ 三通调节阀 (1180,290)
 *   │   三通调节阀：上口 ─▶ 高温淡水冷却器（LTFW / 海水 31）─┐
 *   │                直口 ──────── 旁通 ────────────────────┴─▶ 除气柜 ─▶ 膨胀水柜
 *   │   膨胀水柜（F.W. Expansion Tank，日用淡水 35 补水）── WB-V15S ── 下降管 ──
 *   │   底部回水 y=545 ── 缸套水加热器（锅炉蒸汽 42）──▶ 主机吸入侧（PT）
 *
 *  · 三通调节阀是唯一的温度控制对象：0 % = 全经冷却器（最冷），100 % = 全旁通（最热）；
 *    它的开度由 PID 面板（components/CoolingWaterPID.js）直接给定；
 *  · 水位 / 温度 / 压力 / 流量标注随仿真实时刷新，管路按水温着色，泵运行时流动虚线动画。
 *
 *  可点击部件（工作流 subTarget / op.part）：
 *    设备：engine heater distiller cooler tank deaerator
 *    阀门：wb-v4 wb-v28s wb-v5 wb-v27s wb-v25s wb-v6s wb-v7s wb-v8 wb-v9 wb-v15s wb-v26s
 *    冷却泵：cw1 cw2（点击 = 起动 / 停止），cw1-start/-stop、cw2-start/-stop、panel1（操作盒主电源）
 *    三通调节阀：rv-3way（点上半区开大 / 下半区关小）、rv-3way-inc / -dec
 *               （兼容旧名 rv-cooler / rv-bypass 及其 -inc / -dec）
 *    仪表：tc pt ps gauge
 * ═══════════════════════════════════════════════════════════════════════════
 */
export class CoolingWaterMimic extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.W = Math.max(1200, config.width || 1360);
        this.H = Math.max(560, config.height || 750);
        this.type = 'cooling_water_mimic';
        this.special = 'cooling_mimic';
        this.cache = 'fixed';

        this._flowPhase = 0;

        this._initGroups();
        this._recalcGeometry();
        this._init();
        this._syncVisuals();

        this.config = { id: this.id, width: this.W, height: this.H };
    }

    _solver() {
        return this.sys && this.sys.coolingSolver ? this.sys.coolingSolver : null;
    }

    _tip(msg) {
        if (this.sys && typeof this.sys._tipPurifier === 'function') this.sys._tipPurifier(msg);
    }

    // ═══════════════════════════════════════════════════════════
    //  几何（组件本地坐标，设计基准 1360 × 750）
    // ═══════════════════════════════════════════════════════════
    _recalcGeometry() {
        this._geo = {
            backdrop: { x: 8, y: 240, w: 240, h: 450 },
            host: { x: 24, y: 260, w: 186, h: 355 },

            // ── 主管 y = 225 ──
            tc: { cx: 185, cy: 200, r: 12 },       // TT 温度变送器
            gauge: { cx: 250, cy: 105, r: 58 },    // 缸套出口温度表
            v28s: { cx: 310, cy: 225 },            // 主管单向阀
            v5: { cx: 855, cy: 225 },              // 主管进泵截止阀

            // ── 造水机支路 ──
            v6s: { cx: 510, cy: 190 },
            dist: { cx: 590, cy: 110, r: 36 },
            v7s: { cx: 670, cy: 190 },

            // ── 冷却泵 ──
            pumps: {
                cw1: { cx: 1000, cy: 420, r: 24 },
                cw2: { cx: 1000, cy: 560, r: 24 },
            },
            v8: { cx: 925, cy: 420 },
            v9: { cx: 925, cy: 560 },
            ck1: { cx: 1048, cy: 420 },
            ck2: { cx: 1048, cy: 560 },
            ps: { cx: 1035, cy: 490, r: 12 },

            // ── 三通调节阀 / 冷却器 / 除气柜 ──
            v3w: { cx: 1090, cy: 370 },
            cool: { x: 1130, y: 190, w: 90, h: 46 },
            dea: { cx: 1270, cy: 300, w: 40, h: 60 },
            tank: { x: 1060, y: 55, w: 280, h: 100 },
            v15s: { cx: 1328, cy: 200 },
            v13s: { cx: 1150, cy: 370 },

            // ── 底部回水 / 加热器 ──
            heater: { x: 400, y: 664, w: 120, h: 52 },
            v27s: { cx: 350, cy: 690 },
            v25s: { cx: 530, cy: 690 },
            pt: { cx: 222, cy: 540, r: 12 },
            v4: { cx: 300, cy: 711 },
            v26s: { cx: 1150, cy: 711 },

            // ── 冷却泵操作盒 ──
            panel2: { x: 700, y: 45, w: 190, h: 126 },
        };

        // 管路折线表（静态底图 / 温度着色 / 流动动画共用）
        this._L = {
            hostOut: [120, 286, 120, 225],
            hdr: [120, 225, 910, 225],
            sucRiser: [910, 225, 910, 560],
            suc1: [910, 420, 976, 420],
            suc2: [910, 560, 976, 560],
            dis1: [1024, 420, 1070, 420],
            dis2: [1024, 560, 1070, 560],
            manifold: [1070, 420, 1070, 560],
            disRise: [1070, 490, 1070, 370, 1079, 370],
            byp: [1101, 370, 1270, 370, 1270, 330],
            coolUp: [1090, 359, 1090, 300, 1130, 300, 1130, 236],
            coolOut: [1215, 236, 1270, 236, 1270, 270],
            deaUp: [1290, 300, 1300, 300, 1300, 165],
            tankOut: [1328, 155, 1328, 690, 250, 690, 250, 560, 192, 560],
            distIn: [510, 225, 510, 110, 554, 110],
            distOut: [626, 110, 670, 110, 670, 225],
            // 辅助管路（灰）
            makeup: [1358, 105, 1340, 105],
            drain4: [300, 690, 300, 723],
            drain26: [1150, 690, 1150, 723],
        };
    }

    // ═══════════════════════════════════════════════════════════
    //  绘制工具
    // ═══════════════════════════════════════════════════════════
    _label(g, x, y, text, size = 11, fill = '#333333', bold = false, align = 'left', width = 0) {
        const o = {
            x, y, text, fontSize: size, fontStyle: bold ? 'bold' : 'normal', fill, align,
            fontFamily: 'Arial, "Microsoft YaHei", sans-serif',
        };
        if (width) o.width = width;
        g.add(new Konva.Text(o));
    }

    _pipe(g, pts, color = PIPE, w = 5) {
        const n = new Konva.Line({ points: pts, stroke: color, strokeWidth: w, lineCap: 'round', lineJoin: 'round' });
        g.add(n);
        return n;
    }

    /**
     * 截止阀阀体：两个三角形顶点相交于阀芯（尺寸统一 TRI_A / TRI_B）
     * @param {number} angAxis 阀体轴向角度：180 = 横管、270 = 竖管
     */
    _valve(g, cx, cy, angAxis = 180) {
        const mk = (ang) => {
            const n = new Konva.Line({
                points: triPts(cx, cy, ang), closed: true,
                fill: '#ffffff', stroke: '#333333', strokeWidth: 1.8, lineJoin: 'round',
            });
            g.add(n);
            return n;
        };
        return { a: mk(angAxis), b: mk(angAxis + 180) };
    }

    /**
     * 手动截止阀（阀体 + 阀杆 + 手轮）
     * @param {number} angAxis   阀体轴向：180 横管 / 270 竖管
     * @param {number} angHandle 手轮方向，默认 angAxis + 90（竖管时朝右；朝左用 180）
     */
    _handValve(g, cx, cy, angAxis = 270, angHandle = angAxis + 90) {
        const v = this._valve(g, cx, cy, angAxis);
        const r = angHandle * Math.PI / 180, ux = Math.cos(r), uy = Math.sin(r);
        const ex = cx + ux * (TRI_B + 9), ey = cy + uy * (TRI_B + 9);
        g.add(new Konva.Line({ points: [cx, cy, ex, ey], stroke: '#333333', strokeWidth: 1.8 }));
        const px = -uy, py = ux;
        g.add(new Konva.Line({
            points: [ex + px * 6, ey + py * 6, ex - px * 6, ey - py * 6],
            stroke: '#333333', strokeWidth: 2.2,
        }));
        return v;
    }

    /** 造水机进口手动截止阀：竖管、手轮朝左 */
    _handValveLeft(g, cx, cy) {
        return this._handValve(g, cx, cy, 270, 180);
    }

    /**
     * 单向阀（两个顶点相对的三角形）：进侧三角流通时变绿，出侧恒灰
     * @param {number} angFlow 流向角度：0 向右、90 向下、180 向左、270 向上
     */
    _checkValve(g, cx, cy, angFlow = 0) {
        const mk = (ang, fill) => {
            const n = new Konva.Line({
                points: triPts(cx, cy, ang), closed: true, fill,
                stroke: '#333333', strokeWidth: 1.8, lineJoin: 'round',
            });
            g.add(n);
            return n;
        };
        return { in: mk(angFlow + 180, '#ffffff'), out: mk(angFlow, '#b0b6bb'), ang: angFlow };
    }

    /** 三通调节阀（左为进口、右为旁通出口、上为冷却器出口） */
    _threeWayValve(g, cx, cy) {
        g.add(new Konva.Circle({ x: cx, y: cy, radius: 11, fill: '#ffffff', stroke: '#555555', strokeWidth: 1.8 }));
        g.add(new Konva.Line({ points: [cx - 6, cy - 5, cx, cy + 4, cx + 6, cy - 5], closed: true, fill: '#c9d2d6', stroke: '#555555', strokeWidth: 1.2 }));
        g.add(new Konva.Line({ points: [cx, cy - 11, cx, cy - 28], stroke: '#555555', strokeWidth: 2 }));
        g.add(new Konva.Rect({ x: cx - 16, y: cy - 46, width: 32, height: 18, cornerRadius: 3, fill: '#dfe3e6', stroke: '#555555', strokeWidth: 1.4 }));
    }

    /** 传感器圆环 + 引线（dir：引线指向管路的方位） */
    _sensor(g, s, tag, dir = 'down') {
        const r = s.r, L = r + 14;
        const lead = {
            down: [s.cx, s.cy + r, s.cx, s.cy + L],
            up: [s.cx, s.cy - r, s.cx, s.cy - L],
            left: [s.cx - r, s.cy, s.cx - L, s.cy],
            right: [s.cx + r, s.cy, s.cx + L, s.cy],
        }[dir];
        g.add(new Konva.Line({ points: lead, stroke: '#555555', strokeWidth: 2 }));
        g.add(new Konva.Circle({ x: s.cx, y: s.cy, radius: r, fill: '#eefcff', stroke: '#555555', strokeWidth: 2.2 }));
        this._label(g, s.cx - r, s.cy - 7, tag, 11, '#009bd7', true, 'center', r * 2);
    }

    /** 主机（简化侧视图） */
    _drawHost(g, H) {
        const x = H.x, y = H.y, w = H.w, h = H.h;
        g.add(new Konva.Rect({ x: x + 26, y: y + 96, width: w - 44, height: h - 96, cornerRadius: 12, fill: '#9fb9bc', stroke: '#59686b', strokeWidth: 2.5 }));
        g.add(new Konva.Rect({ x: x + 38, y: y + 168, width: w - 66, height: h - 206, cornerRadius: 8, fill: '#b8ced0', stroke: '#59686b', strokeWidth: 1.6 }));
        for (let i = 0; i < 5; i++) {
            const cx = x + 46 + i * 26;
            g.add(new Konva.Rect({ x: cx, y: y + 74, width: 16, height: 104, cornerRadius: 3, fill: '#d9e5e6', stroke: '#555555', strokeWidth: 1.6 }));
            g.add(new Konva.Circle({ x: cx + 8, y: y + 80, radius: 7, fill: '#cdd7d8', stroke: '#555555', strokeWidth: 1.2 }));
            g.add(new Konva.Line({ points: [cx + 8, y + 104, cx + 8, y + 160], stroke: '#536568', strokeWidth: 6 }));
        }
        g.add(new Konva.Rect({ x: x + 38, y: y + 26, width: w - 66, height: 50, cornerRadius: 8, fill: '#e83b32', stroke: '#6d2620', strokeWidth: 1.8 }));
        g.add(new Konva.Circle({ x: x + 36, y: y + 50, radius: 20, fill: '#e33b32', stroke: '#6d2620', strokeWidth: 1.8 }));
        g.add(new Konva.Circle({ x: x + 36, y: y + 50, radius: 9, fill: '#f6c8c4', stroke: '#6d2620', strokeWidth: 1.2 }));
        g.add(new Konva.Circle({ x: x + 4, y: y + 190, radius: 22, fill: '#91a8aa', stroke: '#4e5d60', strokeWidth: 2 }));
        g.add(new Konva.Circle({ x: x + 4, y: y + 190, radius: 10, fill: '#dfe7e8', stroke: '#4e5d60', strokeWidth: 1.4 }));
        g.add(new Konva.Rect({ x: x + 4, y: y + 236, width: 40, height: 46, cornerRadius: 5, fill: '#7c9699', stroke: '#4e5d60', strokeWidth: 1.6 }));
        [0, 1, 2].forEach(i => g.add(new Konva.Rect({ x: x + 9, y: y + 242 + i * 13, width: 30, height: 7, fill: '#d9e5e6' })));
        this._label(g, x + 4, y + h + 14, '主机（B&W 7S80MC）', 11, '#333333', true, 'left', 180);
    }

    // ═══════════════════════════════════════════════════════════
    //  初始化
    // ═══════════════════════════════════════════════════════════
    _init() {
        this._drawStaticParts();
        this._createDynamicNodes();
        this._bindInteraction();
    }

    _drawStaticParts() {
        const g = this._staticGroup, G = this._geo, W = this.W, Hh = this.H;
        const L = this._L;

        g.add(new Konva.Rect({ x: 0, y: 0, width: W, height: Hh, cornerRadius: 8, fill: '#f7f7f7', stroke: '#b9c2ca', strokeWidth: 2 }));
        this._label(g, 10, 2, '主机缸套冷却水（高温淡水）温度控制系统', 12, '#0b3d91', true);

        // ══ ⓪ 主机工作台底板（最底层）══
        const B = G.backdrop;
        g.add(new Konva.Rect({ x: B.x, y: B.y, width: B.w, height: B.h, cornerRadius: 14, fill: '#eceeef', stroke: '#d8dcde', strokeWidth: 1.5 }));

        // ══ ① 管路（先画管道，设备压在上面）══
        ['hostOut', 'hdr', 'sucRiser', 'suc1', 'suc2', 'dis1', 'dis2', 'manifold', 'disRise',
            'byp', 'coolUp', 'coolOut', 'deaUp', 'tankOut',
            'distIn', 'distOut'].forEach(k => this._pipe(g, L[k], PIPE, 5));
        this._pipe(g, L.makeup, AUX, 2.5);
        this._pipe(g, L.drain4, AUX, 2.5);
        this._pipe(g, L.drain26, AUX, 2.5);

        // ══ ② 主机 ══
        this._drawHost(g, G.host);

        // ══ ③ 设备 ══
        // 缸套出口温度表
        const GG = G.gauge;
        g.add(new Konva.Circle({ x: GG.cx, y: GG.cy, radius: GG.r, fill: '#d8f5ff', stroke: '#333333', strokeWidth: 2.5 }));
        for (let v = 0; v <= 150; v += 15) {
            const a = (-135 + (v / 150) * 270) * Math.PI / 180;
            const r1 = GG.r - 6, r2 = GG.r - 13, rl = GG.r - 22;
            g.add(new Konva.Line({
                points: [GG.cx + Math.sin(a) * r1, GG.cy - Math.cos(a) * r1, GG.cx + Math.sin(a) * r2, GG.cy - Math.cos(a) * r2],
                stroke: '#333333', strokeWidth: 1.5,
            }));
            this._label(g, GG.cx + Math.sin(a) * rl - 10, GG.cy - Math.cos(a) * rl - 5, String(v), 9, '#444444', false, 'center', 20);
        }
        this._label(g, GG.cx - 11, GG.cy + GG.r - 24, '℃', 11, '#555555', false, 'center', 22);
        this._label(g, GG.cx - 40, GG.cy + GG.r + 4, 'Cyl. Outlet', 10, '#555555', false, 'center', 80);
        g.add(new Konva.Line({ points: [GG.cx, GG.cy + GG.r, GG.cx, 225], stroke: '#555555', strokeWidth: 2 }));

        // 造水机（Fresh Water Generator 34）
        const D = G.dist;
        g.add(new Konva.Circle({ x: D.cx, y: D.cy, radius: D.r, fill: '#2fbd5a', stroke: '#146c2e', strokeWidth: 2.5 }));
        g.add(new Konva.Path({ data: `M ${D.cx - 22} ${D.cy - 22} L ${D.cx} ${D.cy + 12} L ${D.cx + 22} ${D.cy - 22}`, stroke: '#00a9e8', strokeWidth: 3.5, fill: 'none', lineJoin: 'round' }));
        this._label(g, D.cx - 40, D.cy - D.r - 32, '造水机 34', 10, '#333333', false, 'center', 80);

        // 高温淡水冷却器（LTFW / 海水 31）
        const C = G.cool;
        g.add(new Konva.Rect({
            x: C.x, y: C.y, width: C.w, height: C.h, cornerRadius: 5,
            fillLinearGradientStartPoint: { x: C.x, y: C.y },
            fillLinearGradientEndPoint: { x: C.x, y: C.y + C.h },
            fillLinearGradientColorStops: [0, '#e9eeee', 0.5, '#9aa2a5', 1, '#4f5659'],
            stroke: '#333333', strokeWidth: 1.8,
        }));
        for (let i = 1; i < 6; i++) {
            const lx = C.x + (C.w / 6) * i;
            g.add(new Konva.Line({ points: [lx, C.y + 4, lx, C.y + C.h - 4], stroke: '#333333', strokeWidth: 1 }));
        }
        this._label(g, 1126, 282, '高温淡水冷却器（LTFW 31）', 9, '#555555', false, 'center', 118);

        // 膨胀水柜（F.W. Expansion Tank）
        const T = G.tank;
        g.add(new Konva.Rect({ x: T.x, y: T.y, width: T.w, height: T.h, fill: '#10aee7', stroke: '#555555', strokeWidth: 2.2 }));
        [T.x + 20, T.x + T.w - 34].forEach(lx => {
            g.add(new Konva.Rect({ x: lx, y: T.y + 12, width: 14, height: T.h - 24, fill: '#f4f4f4', stroke: '#555555', strokeWidth: 1.4 }));
        });
        this._label(g, T.x + 36, T.y + 20, '高温冷却水系统膨胀水柜', 11, '#ffffff', true, 'center', T.w - 104);
        this._label(g, T.x + 36, T.y + 38, 'F.W. Expansion Tank (2.5M³)', 9, '#ffffff', false, 'center', T.w - 104);
        this._label(g, T.x + T.w - 116, T.y + 8, 'L 85.0', 9, '#ffffff', true, 'left', 58);

        // 除气柜（Deaerating Chamber）
        const DA = G.dea;
        g.add(new Konva.Rect({ x: DA.cx - DA.w / 2, y: DA.cy - DA.h / 2, width: DA.w, height: DA.h, cornerRadius: 10, fill: '#cfe9fb', stroke: '#555555', strokeWidth: 2 }));
        g.add(new Konva.Circle({ x: DA.cx + 7, y: DA.cy + 12, radius: 4, fill: '#c62828', stroke: '#5c0d0d', strokeWidth: 1 }));
        this._label(g, DA.cx - 34, DA.cy + DA.h / 2 + 6, '除气柜', 9, '#555555', false, 'center', 68);

        // 缸套水加热器（M/E Jacket Water Heater）
        const HT = G.heater;
        g.add(new Konva.Rect({ x: HT.x, y: HT.y, width: HT.w, height: HT.h, cornerRadius: 26, fill: '#f6c6cf', stroke: '#a8636f', strokeWidth: 2 }));
        this._label(g, HT.x, HT.y + 12, 'M/E 缸套水加热器', 10, '#5b2b32', true, 'center', HT.w);
        this._label(g, HT.x, HT.y + 28, 'Jacket Water Heater', 8, '#7a4a52', false, 'center', HT.w);
        // 锅炉蒸汽进出（42）
        this._pipe(g, [HT.x + 22, HT.y, HT.x + 22, 638, 350, 638], AUX, 2.5);
        this._pipe(g, [HT.x + HT.w - 20, HT.y + HT.h, HT.x + HT.w - 20, 730, 545, 730], AUX, 2.5);
        this._label(g, 250, 616, '锅炉蒸汽系统', 9, '#777777');
        this._label(g, 556, 732, '锅炉蒸汽系统', 9, '#777777');

        // 冷却泵（圆 + 叶轮，盘面在动态层）
        [['cw1', G.pumps.cw1, '1# 缸套冷却淡水泵'], ['cw2', G.pumps.cw2, '2# 缸套冷却淡水泵']].forEach(([k, P, nm]) => {
            g.add(new Konva.Line({ points: [P.cx - 8, P.cy - 9, P.cx + 11, P.cy, P.cx - 8, P.cy + 9], closed: true, fill: '#999999', stroke: '#555555', strokeWidth: 1.3 }));
            g.add(new Konva.Rect({ x: P.cx + 18, y: P.cy + 10, width: 16, height: 12, cornerRadius: 2, fill: '#c9c9c9', stroke: '#555555', strokeWidth: 1.1 }));
            this._label(g, P.cx - 58, P.cy + P.r + 6, nm, 9, '#333333', false, 'center', 116);
            void k;
        });

        // ══ ④ 阀门 ══
        const V = {};
        V.v4 = this._valve(g, G.v4.cx, G.v4.cy, 270);
        V.v27s = this._valve(g, G.v27s.cx, G.v27s.cy);
        V.v25s = this._valve(g, G.v25s.cx, G.v25s.cy);
        V.v6s = this._handValveLeft(g, G.v6s.cx, G.v6s.cy);
        V.v5 = this._valve(g, G.v5.cx, G.v5.cy);
        V.v8 = this._valve(g, G.v8.cx, G.v8.cy);
        V.v9 = this._valve(g, G.v9.cx, G.v9.cy);
        V.v15s = this._valve(g, G.v15s.cx, G.v15s.cy, 270);
        V.v26s = this._valve(g, G.v26s.cx, G.v26s.cy, 270);
        V.v13s = this._valve(g, G.v13s.cx, G.v13s.cy);
        this._valves = V;
        this._checks = {
            v28s: this._checkValve(g, G.v28s.cx, G.v28s.cy, 0),
            ck1: this._checkValve(g, G.ck1.cx, G.ck1.cy, 0),
            ck2: this._checkValve(g, G.ck2.cx, G.ck2.cy, 0),
            v7s: this._checkValve(g, G.v7s.cx, G.v7s.cy, 90),
        };
        this._threeWayValve(g, G.v3w.cx, G.v3w.cy);

        // 阀门名称
        const tag = (x, y, t, w = 56, align = 'left', size = 9) => this._label(g, x, y, t, size, '#666666', false, align, w);
        tag(252, 248, 'WB-V28S', 60);
        tag(806, 252, 'WB-V5', 46);
        tag(428, 160, 'WB-V6S', 54);
        tag(612, 178, 'WB-V7S', 54);
        tag(838, 426, 'WB-V8', 54);
        tag(838, 566, 'WB-V9', 54);
        tag(1026, 396, 'WB-V10S', 42);
        tag(1026, 536, 'WB-V11S', 42);
        tag(330, 666, 'WB-V27S', 56);
        tag(534, 666, 'WB-V25S', 56);
        tag(1240, 186, 'WB-V15S', 58);
        tag(1156, 380, 'WB-V13S', 54);
        tag(238, 700, 'WB-V4', 56);
        tag(1072, 700, 'WB-V26S', 66);
        this._label(g, 996, 360, '三通调节阀', 9, '#444444', true, 'left', 76);

        // 至污水井
        this._label(g, 306, 705, '至污水井', 9, '#777777');
        this._label(g, 1156, 705, '至污水井', 9, '#777777');

        // 补水（F.W. HYD Tank 35）
        this._label(g, 1186, 36, 'F.W. HYD Tank', 8, '#555555', false, 'left', 84);
        g.add(new Konva.Rect({ x: 1274, y: 34, width: 20, height: 13, fill: GREEN }));
        this._label(g, 1274, 35, '35', 8, '#ffffff', true, 'center', 20);

        // ══ ⑤ 仪表 ══
        this._sensor(g, G.tc, 'TT', 'down');
        this._sensor(g, G.pt, 'PT', 'down');
        this._sensor(g, G.ps, 'PS', 'right');

        // ══ ⑥ 冷却泵操作盒 ══
        const Q = G.panel2;
        g.add(new Konva.Rect({
            x: Q.x, y: Q.y, width: Q.w, height: Q.h, cornerRadius: 6,
            fillLinearGradientStartPoint: { x: Q.x, y: Q.y },
            fillLinearGradientEndPoint: { x: Q.x, y: Q.y + Q.h },
            fillLinearGradientColorStops: [0, '#d9dde0', 0.5, '#b9bfc3', 1, '#9aa1a5'],
            stroke: '#4a4f50', strokeWidth: 1.8,
        }));
        g.add(new Konva.Rect({ x: Q.x + 5, y: Q.y + 5, width: Q.w - 10, height: Q.h - 10, cornerRadius: 3, fill: '#efe9d6', stroke: '#b9b3a0', strokeWidth: 1 }));
        this._label(g, Q.x, Q.y + 6, '缸套冷却淡水泵 操作盒', 10, '#222222', true, 'center', Q.w);
        this._label(g, 734, Q.y + 22, '1', 9, '#222222', true, 'center', 16);
        this._label(g, 790, Q.y + 22, '2', 9, '#222222', true, 'center', 16);
        this._label(g, Q.x + 2, Q.y + 39, '起动', 9, '#222222', true, 'right', 30);
        this._label(g, Q.x + 2, Q.y + 71, '停止', 9, '#222222', true, 'right', 30);
        const kx = 860, ky = 101, R = 16;
        g.add(new Konva.Circle({ x: kx, y: ky, radius: R, fill: '#ffffff', stroke: '#9aa0a0', strokeWidth: 1.2 }));
        g.add(new Konva.Circle({ x: kx, y: ky, radius: R - 5, fill: '#141414', stroke: '#000000', strokeWidth: 1 }));
        this._label(g, kx - 15, ky - R - 12, 'STOP', 8, '#222222', true, 'center', 30);
        this._label(g, kx - 38, ky + 3, 'MAN', 8, '#222222', true, 'right', 24);
        this._label(g, kx + 16, ky + 3, 'AUTO', 8, '#222222', true, 'center', 30);
        this._label(g, kx - 15, ky + R + 8, '方式', 8, '#222222', true, 'center', 30);
        g.add(new Konva.Rect({ x: Q.x + 6, y: Q.y + Q.h - 18, width: 50, height: 13, fill: '#ffffff', stroke: '#777777', strokeWidth: 1 }));
        this._label(g, Q.x + 6, Q.y + Q.h - 16, '主电源', 8, '#222222', true, 'center', 50);
        g.add(new Konva.Rect({ x: Q.x + 62, y: Q.y + Q.h - 18, width: 58, height: 13, fill: '#ffffff', stroke: '#777777', strokeWidth: 1 }));
        this._label(g, Q.x + 62, Q.y + Q.h - 16, '辅助电压', 8, '#222222', true, 'center', 58);

    }

    // ═══════════════════════════════════════════════════════════
    //  动态节点
    // ═══════════════════════════════════════════════════════════
    _createDynamicNodes() {
        const d = this._dynamicGroup, G = this._geo, L = this._L;

        // ── 管路温度着色层 ──
        const tint = (key, w = 5) => {
            const n = new Konva.Line({ points: L[key], stroke: '#8fd6f5', strokeWidth: w, lineCap: 'round', lineJoin: 'round' });
            d.add(n);
            return n;
        };
        this._tint = {
            hostOut: tint('hostOut'), hdr: tint('hdr'), sucRiser: tint('sucRiser'), suc1: tint('suc1'), suc2: tint('suc2'),
            dis1: tint('dis1'), dis2: tint('dis2'), manifold: tint('manifold'), disRise: tint('disRise'),
            byp: tint('byp', 4), coolUp: tint('coolUp', 4), coolOut: tint('coolOut', 4),
            deaUp: tint('deaUp', 4), tankOut: tint('tankOut', 4),
            distIn: tint('distIn', 2.5), distOut: tint('distOut', 2.5),
        };

        // ── 流动虚线 ──
        this._flows = [];
        const flow = (key, cond, color = '#d4280a', w = 3) => {
            const n = new Konva.Line({ points: L[key], stroke: color, strokeWidth: w, dash: [10, 8], dashOffset: 0, opacity: 0 });
            d.add(n);
            this._flows.push({ node: n, cond });
        };
        flow('hdr', m => m.psUp || m.pumps.cw1.run || m.pumps.cw2.run);
        flow('distIn', m => (m.pumps.cw1.run || m.pumps.cw2.run) && m.sw.wbV6S && m.sw.wbV7S, '#d4280a', 2.2);
        flow('distOut', m => (m.pumps.cw1.run || m.pumps.cw2.run) && m.sw.wbV6S && m.sw.wbV7S, '#d4280a', 2.2);
        flow('sucRiser', m => m.pumps.cw1.run || m.pumps.cw2.run);
        flow('suc1', m => m.pumps.cw1.run);
        flow('suc2', m => m.pumps.cw2.run);
        flow('dis1', m => m.pumps.cw1.run);
        flow('dis2', m => m.pumps.cw2.run);
        flow('manifold', m => m.pumps.cw1.run || m.pumps.cw2.run);
        flow('disRise', m => m.pumps.cw1.run || m.pumps.cw2.run);
        flow('coolUp', m => m.psUp && (100 - m.manip) > 3, '#2b6fc4', 2.6);
        flow('coolOut', m => m.psUp && (100 - m.manip) > 3, '#2b6fc4', 2.6);
        flow('byp', m => m.psUp && m.manip > 3, '#d97706', 2.6);
        flow('deaUp', m => m.psUp);
        flow('tankOut', m => m.psUp);

        // ── 泵盘面与叶轮 ──
        this._pumpFace = {};
        this._fans = {};
        ['cw1', 'cw2'].forEach(k => {
            const P = G.pumps[k];
            const face = new Konva.Circle({ x: P.cx, y: P.cy, radius: P.r, fill: '#f4f4f4', stroke: '#555555', strokeWidth: 2.2 });
            d.add(face);
            this._pumpFace[k] = face;
            const fan = new Konva.Group({ x: P.cx - 4, y: P.cy, rotation: 0 });
            for (let i = 0; i < 3; i++) {
                const a = (i * 120 - 90) * Math.PI / 180;
                fan.add(new Konva.Line({ points: [0, 0, Math.cos(a) * 13, Math.sin(a) * 13], stroke: '#333333', strokeWidth: 2, lineCap: 'round' }));
            }
            fan.add(new Konva.Circle({ x: 0, y: 0, radius: 4, fill: '#333333' }));
            d.add(fan);
            this._fans[k] = fan;
        });

        // ── 主机曲轴 ──
        this._crank = new Konva.Group({ x: G.host.x + 112, y: G.host.y + G.host.h - 62 });
        for (let i = 0; i < 4; i++) {
            const a = (i * 90) * Math.PI / 180;
            this._crank.add(new Konva.Line({ points: [0, 0, Math.cos(a) * 22, Math.sin(a) * 22], stroke: '#4e5d60', strokeWidth: 4, lineCap: 'round' }));
        }
        this._crank.add(new Konva.Circle({ x: 0, y: 0, radius: 6, fill: '#dfe7e8', stroke: '#4e5d60', strokeWidth: 1.6 }));
        d.add(this._crank);

        // ── 温度表指针与数值 ──
        this._gaugeNeedle = new Konva.Group({ x: G.gauge.cx, y: G.gauge.cy, rotation: -135 });
        this._gaugeNeedle.add(new Konva.Line({ points: [0, 0, 0, -G.gauge.r + 14], stroke: '#222222', strokeWidth: 2.6, lineCap: 'round' }));
        this._gaugeNeedle.add(new Konva.Circle({ x: 0, y: 0, radius: 4, fill: '#222222' }));
        d.add(this._gaugeNeedle);
        this._gaugeText = new Konva.Text({
            x: G.gauge.cx - 46, y: G.gauge.cy + 6, width: 92, align: 'center', text: '--.-',
            fontSize: 20, fontStyle: 'bold', fill: '#222222', fontFamily: 'Arial, "Microsoft YaHei", sans-serif',
        });
        d.add(this._gaugeText);

        // ── 操作盒：按钮灯、方式旋钮、电源灯 ──
        const Q = G.panel2;
        this._btnLamps = {};
        [[0, 740], [1, 796]].forEach(([i, cx]) => {
            const start = new Konva.Circle({ x: cx, y: 91, radius: 11, fill: '#1bd63e', stroke: '#0b3b16', strokeWidth: 1.2 });
            const stop = new Konva.Circle({ x: cx, y: 123, radius: 11, fill: '#2b2b2b', stroke: '#7f1010', strokeWidth: 2 });
            const stopRing = new Konva.Circle({ x: cx, y: 123, radius: 11, fill: 'rgba(0,0,0,0)', stroke: '#e5352f', strokeWidth: 2.4 });
            const num = new Konva.Text({ x: cx - 6, y: 85, width: 12, align: 'center', text: String(i + 1), fontSize: 9, fontStyle: 'bold', fill: '#0b3b16', fontFamily: 'Arial' });
            d.add(start, stop, stopRing, num);
            this._btnLamps[i] = { start, stop, stopRing };
        });
        const kx = 860, ky = 101, R = 16;
        this._modeKnob = new Konva.Group({ x: kx, y: ky, rotation: 0 });
        this._modeKnob.add(new Konva.Rect({ x: -3, y: -(R - 5), width: 6, height: (R - 5) * 2, cornerRadius: 3, fill: 'rgba(0,0,0,0)', stroke: '#ffffff', strokeWidth: 1.5 }));
        this._modeKnob.add(new Konva.Rect({ x: -2, y: -(R - 8), width: 4, height: 8, cornerRadius: 1, fill: '#ffffff' }));
        d.add(this._modeKnob);
        this._mainLamp = new Konva.Circle({ x: Q.x + 12, y: Q.y + Q.h - 26, radius: 4, fill: '#2b2f2f', stroke: '#111111' });
        this._auxLamp = new Konva.Circle({ x: Q.x + 68, y: Q.y + Q.h - 26, radius: 4, fill: '#2b2f2f', stroke: '#111111' });
        d.add(this._auxLamp, this._mainLamp);

        // ── 三通调节阀开度指针与数值 ──
        this._rv = {};
        {
            const p = G.v3w;
            const ptr = new Konva.Line({ points: [p.cx, p.cy, p.cx, p.cy - 8], stroke: '#c62828', strokeWidth: 2, lineCap: 'round' });
            d.add(ptr);
            const txt = new Konva.Text({
                x: p.cx - 16, y: p.cy - 43, width: 32, align: 'center', text: '0%', fontSize: 9, fontStyle: 'bold',
                fill: '#b07800', fontFamily: 'Arial, "Microsoft YaHei", sans-serif',
            });
            d.add(txt);
            this._rv['rv-3way'] = { ptr, txt, cx: p.cx, cy: p.cy };
        }

        // ── 顶部出口流向箭头（向上）──
        this._outArrow = new Konva.Line({
            points: [114, 258, 126, 258, 120, 246],
            closed: true, fill: PIPE, stroke: '#0b6a99', strokeWidth: 1, lineJoin: 'round',
        });
        d.add(this._outArrow);

        // ── 报警文字 ──
        this._alarmTxt = new Konva.Text({
            x: 700, y: 734, width: 640, height: 16, text: '', fontSize: 10, fontStyle: 'bold', fill: '#c62828',
            fontFamily: 'Arial, "Microsoft YaHei", sans-serif',
        });
        d.add(this._alarmTxt);

    }

    // ═══════════════════════════════════════════════════════════
    //  交互
    // ═══════════════════════════════════════════════════════════
    _bindInteraction() {
        const G = this._geo, s = this;
        const clearBg = (hit) => {
            try {
                const bg = hit.getParent().getChildren()[0];
                if (bg && bg.fill) bg.fill('rgba(0,0,0,0)');
            } catch (e) { /* ignore */ }
        };
        const add = (id, x, y, w, h, fn) => {
            const hit = this.addClickablePart(id, x, y, w, h, true);
            hit.on('click tap', () => {
                if (fn) fn();
                s._syncVisuals();
            });
            clearBg(hit);
            return hit;
        };

        // —— 设备 ——
        add('engine', G.host.x, G.host.y, G.host.w, G.host.h, () => s._tipPart('engine'));
        add('heater', G.heater.x, G.heater.y, G.heater.w, G.heater.h, () => s._tipPart('heater'));
        add('distiller', G.dist.cx - G.dist.r, G.dist.cy - G.dist.r, G.dist.r * 2, G.dist.r * 2, () => s._tipPart('distiller'));
        add('cooler', G.cool.x, G.cool.y, G.cool.w, G.cool.h, () => s._tipPart('cooler'));
        add('tank', G.tank.x, G.tank.y, G.tank.w, G.tank.h, () => s._tipPart('tank'));
        add('deaerator', G.dea.cx - G.dea.w / 2 - 4, G.dea.cy - G.dea.h / 2, G.dea.w + 8, G.dea.h, () => s._tipPart('deaerator'));

        // —— 阀门 ——
        const vs = (id, key, v) => add(id, v.cx - 14, v.cy - 14, 28, 28, () => s._toggle(key));
        vs('wb-v4', 'wbV4', G.v4);
        vs('wb-v27s', 'wbV27S', G.v27s);
        vs('wb-v25s', 'wbV25S', G.v25s);
        vs('wb-v6s', 'wbV6S', G.v6s);
        add('wb-v7s', G.v7s.cx - 14, G.v7s.cy - 14, 28, 28, () => s._tip('WB-V7S 为造水机出口单向阀，只能由上向下流通，不可关闭'));
        vs('wb-v28s', 'wbV28S', G.v28s);
        vs('wb-v5', 'wbV5', G.v5);
        vs('wb-v8', 'wbV8', G.v8);
        vs('wb-v9', 'wbV9', G.v9);
        vs('wb-v15s', 'wbV15S', G.v15s);
        vs('wb-v26s', 'wbV26S', G.v26s);
        add('wb-v13s', G.v13s.cx - 14, G.v13s.cy - 14, 28, 28, () => s._toggle('wbV13S'));

        // —— 三通调节阀：上 / 下半区增减（兼容旧 part 名）——
        {
            const p = G.v3w;
            add('rv-3way-inc', p.cx - 14, p.cy - 20, 28, 20, () => s._nudgeValve(5));
            add('rv-3way-dec', p.cx - 14, p.cy, 28, 20, () => s._nudgeValve(-5));
            add('rv-3way', p.cx - 14, p.cy - 20, 28, 40, () => s._tipPart('rv-3way'));
            // 旧名兼容（工作流 rv-cooler / rv-bypass / wb-v502 / wb-v12s）
            add('rv-cooler', p.cx - 14, p.cy - 20, 28, 40, () => s._tipPart('rv-3way'));
            add('rv-bypass', p.cx - 14, p.cy - 20, 28, 40, () => s._tipPart('rv-3way'));
            add('wb-v502', p.cx - 14, p.cy - 20, 28, 20, () => s._tipPart('rv-3way'));
            add('wb-v12s', p.cx - 14, p.cy, 28, 20, () => s._tipPart('rv-3way'));
            add('rv-cooler-inc', p.cx - 14, p.cy - 20, 28, 20, () => s._nudgeValve(5));
            add('rv-cooler-dec', p.cx - 14, p.cy, 28, 20, () => s._nudgeValve(-5));
            add('rv-bypass-inc', p.cx - 14, p.cy - 20, 28, 20, () => s._nudgeValve(5));
            add('rv-bypass-dec', p.cx - 14, p.cy, 28, 20, () => s._nudgeValve(-5));
        }

        // —— 冷却泵 ——
        [['cw1', 740], ['cw2', 796]].forEach(([k, cx]) => {
            const P = G.pumps[k];
            add(k, P.cx - P.r, P.cy - P.r, P.r * 2, P.r * 2, () => s._togglePump(k));
            add(k + '-start', cx - 12, 91 - 12, 24, 24, () => { if (s._solver()) s._solver().startPump(k); });
            add(k + '-stop', cx - 12, 123 - 12, 24, 24, () => { if (s._solver()) s._solver().stopPump(k); });
        });
        {
            const kx = 860, ky = 101, R = 16;
            add('mode-knob-ccw', kx - R, ky - R, R, R * 2, () => s._mainMode(-1));
            add('mode-knob', kx, ky - R, R, R * 2, () => s._mainMode(1));
        }

        // —— 操作盒主电源 ——
        {
            const Q = G.panel2;
            add('panel1', Q.x + 6, Q.y + Q.h - 18, 50, 13, () => {
                const sv = s._solver(); if (!sv) return;
                sv.m.panelMain = !sv.m.panelMain;
                s._tip(`水泵操作盒主电源：${sv.m.panelMain ? 'ON' : 'OFF'}`);
            });
        }

        // —— 仪表 ——
        add('tc', G.tc.cx - G.tc.r, G.tc.cy - G.tc.r, G.tc.r * 2, G.tc.r * 2, () => s._tipPart('tc'));
        add('pt', G.pt.cx - G.pt.r, G.pt.cy - G.pt.r, G.pt.r * 2, G.pt.r * 2, () => s._tipPart('pt'));
        add('ps', G.ps.cx - G.ps.r, G.ps.cy - G.ps.r, G.ps.r * 2, G.ps.r * 2, () => s._tipPart('ps'));
        add('gauge', G.gauge.cx - G.gauge.r, G.gauge.cy - G.gauge.r, G.gauge.r * 2, G.gauge.r * 2, () => s._tipPart('gauge'));
    }

    _toggle(key) {
        const sv = this._solver();
        if (!sv) return;
        if (key === 'wbV28S') { this._tip('WB-V28S 为主管单向阀，只能正向流通，不可手动关闭'); return; }
        if (!(key in sv.m.sw)) { this._tip('该处为单向阀，只能正向流通，不可手动关闭'); return; }
        sv.toggleValve(key);
    }

    _togglePump(k) {
        const sv = this._solver();
        if (!sv) return;
        const p = sv.m.pumps[k];
        if (p && p.run) sv.stopPump(k); else sv.startPump(k);
    }

    /** 操作盒"方式"旋钮：MAN → STOP → AUTO（顺时针 +1 / 逆时针 −1，端点不循环，两台泵同步） */
    _mainMode(dir) {
        const sv = this._solver();
        if (!sv) return;
        const order = ['MAN', 'STOP', 'AUTO'];
        const cur = sv.m.pumps.cw1.mode;
        const i = Math.max(0, order.indexOf(cur));
        const n = Math.max(0, Math.min(order.length - 1, i + (dir > 0 ? 1 : -1)));
        if (n === i) return;
        ['cw1', 'cw2'].forEach(k => sv.setPumpMode(k, order[n]));
        this._tip(`缸套冷却淡水泵方式：${order[n]}（${order[n] === 'AUTO' ? '按控制方式自动起停' : order[n] === 'MAN' ? '手动运行' : '停止'}）`);
    }

    /** 三通调节阀手动增减（点上半区开大、下半区关小） */
    _nudgeValve(d) {
        const sv = this._solver();
        if (!sv) return;
        if (sv.autoActive()) { this._tip('自动控制中：三通阀开度由 PID 调节器给定，请先把面板 Ctrl 切到 MANU'); return; }
        sv.stepManip(d > 0 ? 1 : -1);
    }

    _tipPart(id) {
        const sv = this._solver() || (this._fallbackSolver = this._fallbackSolver || new CoolingWaterSolver(this.sys));
        const m = sv.m;
        const tips = {
            engine: `主机（B&W 7S80MC 柴油机）：缸套水出口 ${m.temp.toFixed(1)} ℃，负荷 ${m.load.toFixed(0)} %${m.tripped ? '（保护停机）' : ''}`,
            heater: `缸套水加热器：${m.sw.wbV25S ? '进出口阀已开' : '进出口阀关闭'}，蒸汽阀${m.heatherOn ? '开（加热中）' : '关（无加热）'}。冷机起动前用蒸汽把缸套水加热到 85 ℃ 再起主机`,
            distiller: `造水机（Fresh Water Generator）：用缸套水作热源加热海水。${(m.sw.wbV6S && m.sw.wbV7S) ? '进出口阀已开，投入运行' : '进出口阀关，未投运'}`,
            cooler: `高温淡水冷却器（LTFW）：缸套水在管内被管外海水冷却（淡水出水 ${sv.coolerOut().toFixed(1)} ℃），海水侧由低温淡水系统供水`,
            tank: `膨胀水柜（F.W. Expansion Tank）：容纳缸套水膨胀量并补水、除气；液位 ${m.tank.toFixed(0)} %，低于 20 % 触发 A 31 报警`,
            deaerator: '除气柜（Deaerating Chamber）：分离缸套水中的空气与蒸汽，防止冷却水循环气阻',
            'rv-3way': `三通调节阀：开度 ${m.manip.toFixed(0)} % —— 0 % 全经冷却器（最冷），100 % 全旁通（最热）。开度由 PID 面板直接给定`,
            tc: `TT 温度变送器（缸套水出口）：${m.faults.tt ? '读数失效（故障）' : m.tcMeas.toFixed(1) + ' ℃'}，其读数直接送至 PID 调节器作 PV`,
            pt: `PT 压力变送器（主机吸入侧）：${m.pressIn.toFixed(2)} bar`,
            ps: `PS 水流开关：${m.psUp ? '冷却水流量正常' : '断开——冷却水中断'}。断开持续 5 s → 主机保护停车`,
            gauge: `缸套水出口温度表：${m.temp.toFixed(1)} ℃`,
        };
        this._tip(tips[id] || id);
    }

    // ═══════════════════════════════════════════════════════════
    //  显示同步
    // ═══════════════════════════════════════════════════════════
    _syncVisuals() {
        const sv = this._solver() || (this._fallbackSolver = this._fallbackSolver || new CoolingWaterSolver(this.sys));
        const m = sv.m;

        // —— 阀门 ——
        const setV = (v, on) => { if (!v) return; v.a.fill(on ? ON_COLOR : '#ffffff'); v.b.fill(on ? ON_COLOR : '#ffffff'); };
        const V = this._valves || {};
        setV(V.v4, m.sw.wbV4);
        setV(V.v27s, m.sw.wbV27S);
        setV(V.v25s, m.sw.wbV25S);
        setV(V.v6s, m.sw.wbV6S);
        setV(V.v5, m.sw.wbV5 !== false);
        setV(V.v8, m.sw.wbV8 !== false);
        setV(V.v9, m.sw.wbV9 !== false);
        setV(V.v15s, m.sw.wbV15S);
        setV(V.v26s, m.sw.wbV26S);

        // —— 管路温度着色 ——
        const tOut = tempColor(m.temp);
        const tRet = tempColor(sv.tankTemp());
        const tCool = tempColor(sv.coolerOut());
        const T = this._tint || {};
        const paint = (keys, color, op = 1) => keys.forEach(k => {
            const n = T[k];
            if (!n) return;
            n.stroke(color);
            n.opacity(op);
        });
        const running = m.pumps.cw1.run || m.pumps.cw2.run;
        const distOn = running && m.sw.wbV6S && m.sw.wbV7S;

        // —— 单向阀：进侧三角流通变绿，出侧恒灰 ——
        const CK = this._checks || {};
        if (CK.v28s) CK.v28s.in.fill((m.psUp || running) ? ON_COLOR : '#ffffff');
        if (CK.ck1) CK.ck1.in.fill(m.pumps.cw1.run ? ON_COLOR : '#ffffff');
        if (CK.ck2) CK.ck2.in.fill(m.pumps.cw2.run ? ON_COLOR : '#ffffff');
        if (CK.v7s) CK.v7s.in.fill(distOn ? ON_COLOR : '#ffffff');

        paint(['hostOut', 'hdr', 'sucRiser', 'suc1', 'suc2', 'dis1', 'dis2', 'manifold', 'disRise'], tOut);
        if (this._outArrow) this._outArrow.fill(tOut);
        paint(['byp'], tOut);
        paint(['coolUp', 'coolOut'], tCool, m.psUp ? 0.95 : 0.6);
        paint(['deaUp'], tOut);
        paint(['tankOut'], tRet);
        paint(['distIn', 'distOut'], tOut, distOn ? 0.95 : 0.2);

        // —— 泵 ——
        ['cw1', 'cw2'].forEach((k, i) => {
            const p = m.pumps[k];
            const face = this._pumpFace && this._pumpFace[k];
            const faulted = k === 'cw1' ? m.faults.pump1 : m.faults.pump2;
            if (face) face.fill(faulted ? '#f3c4c0' : (p.run ? '#d4f5dc' : '#f4f4f4'));
            const fan = this._fans && this._fans[k];
            if (fan) fan.rotation((fan.rotation() + (p.run ? 16 : 0)) % 360);
            const lamp = this._btnLamps && this._btnLamps[i];
            if (lamp) {
                lamp.start.fill(p.run ? '#1bd63e' : '#1b5e20');
                lamp.stop.fill(p.run ? '#2b2b2b' : '#e5352f');
                lamp.stopRing.visible(!p.run);
            }
        });
        if (this._modeKnob) this._modeKnob.rotation({ MAN: -45, STOP: 0, AUTO: 45 }[m.pumps.cw1.mode] || 0);
        if (this._mainLamp) this._mainLamp.fill(m.panelMain ? '#27e05a' : '#2b2f2f');
        if (this._auxLamp) this._auxLamp.fill(running ? '#27e05a' : '#2b2f2f');

        // —— 主机曲轴 ——
        if (this._crank) this._crank.rotation((this._crank.rotation() + (m.tripped ? 0 : (m.psUp ? 6 : 2))) % 360);

        // —— 温度表 ——
        const tShow = Number.isFinite(sv.showValue()) ? sv.showValue() : m.temp;
        if (this._gaugeNeedle) this._gaugeNeedle.rotation(-135 + Math.max(0, Math.min(150, tShow)) / 150 * 270);
        if (this._gaugeText) this._gaugeText.text(m.faults.tt ? '***' : tShow.toFixed(1));

        // —— 三通阀开度 ——
        const rv = this._rv && this._rv['rv-3way'];
        if (rv) {
            const a = (-135 + m.manip / 100 * 270) * Math.PI / 180;
            rv.ptr.points([rv.cx, rv.cy, rv.cx + Math.sin(a) * 8, rv.cy - Math.cos(a) * 8]);
            rv.txt.text(`${m.manip.toFixed(0)}%`);
        }

        // —— 报警文字 ——
        const act = m.alarms.filter(a => a.active);
        if (this._alarmTxt) {
            const trip = m.tripped ? `⚠ 主机保护停车：${m.tripCause}` : '';
            this._alarmTxt.text(act.length
                ? act.map(a => `● ${a.code} ${a.text}${a.ack ? '' : '（未确认）'}`).join('   ') + (trip ? `   ${trip}` : '')
                : trip);
        }

        // —— 流动动画 ——
        this._flowPhase = (this._flowPhase + 1) % 19;
        (this._flows || []).forEach(f => {
            let on = false;
            try { on = !!f.cond(m); } catch (e) { on = false; }
            f.node.opacity(on ? 0.95 : 0);
            if (on) f.node.dashOffset(-this._flowPhase);
        });

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

export default CoolingWaterMimic;
