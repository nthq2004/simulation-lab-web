import Konva from 'konva';
import { BaseComponent } from './BaseComponent.js';
import { tempColor, CoolingWaterSolver } from '../tools/CoolingWaterSolver.js';

/** 管路颜色 */
const PIPE = '#bde9fc';
const AUX = '#dedede';
const GREEN = '#188b14';
const ON_COLOR = '#2ecc40';
const STEEL = '#5c7688';

/** 阀门三角形统一尺寸（截止阀 / 单向阀共用） */
const TRI_A = 13.5, TRI_B = 9.5;

/** 把颜色调淡（与白色混合），使流动虚线更醒目 */
function fade(c, k = 0.45) {
    const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(c) || /^#([0-9a-f]{6})$/i.exec(c);
    if (!m) return c;
    let r, g, b;
    if (m.length === 4) { r = +m[1]; g = +m[2]; b = +m[3]; }
    else { const n = parseInt(m[1], 16); r = n >> 16; g = (n >> 8) & 255; b = n & 255; }
    const f = v => Math.round(v + (255 - v) * k);
    return `rgb(${f(r)},${f(g)},${f(b)})`;
}

/** 顶点在阀芯中心 (cx,cy)、基边距中心 a、指向角度 ang 的三角形 */
function triPts(cx, cy, ang, a = TRI_A, b = TRI_B) {
    const r = ang * Math.PI / 180;
    const ux = Math.cos(r), uy = Math.sin(r);
    const px = -uy, py = ux;
    const bx = cx + ux * a, by = cy + uy * a;
    return [bx + px * b, by + py * b, bx - px * b, by - py * b, cx, cy];
}

/** 图片坐标 → 组件坐标（设计基准 1360 × 750，图片 1682 × 936） */
const S = (v) => Math.round(v * 0.79) + 6;

/**
 * CoolingWaterMimic — 主机缸套冷却水（高温淡水）系统模拟图
 * ═══════════════════════════════════════════════════════════════════════════
 *  版式 1:1 按参考 MIMIC 图复刻（图片 1682×936，缩放 0.79 后落在 1360×750）：
 *
 *   ① 缸套水出口：Cyl Outlet 温度表 + 主管（热）y=325 →
 *        造水机 FW Generator 支路（进/出各一阀）
 *        高温淡水冷却器 HTFW Cooler 支路（LTFW 低温淡水，进/出各一阀）
 *        三通调节阀 → 除气柜 Deaerating Chamber → 膨胀水柜（L 85.0）
 *   ② 泵侧：1#/2# 缸套冷却淡水泵（进/出阀 + 电机）→ 除气柜 / 水柜
 *   ③ 加热侧：M/E 缸套水加热器（锅炉蒸汽 42 进 / 出）在底部回水线上
 *   ④ 仪表：两只温度表（缸套出口 / 缸套水）、PS 压力开关、TEMP/Ctrl 显示窗
 *
 *  可点击部件（工作流 subTarget / op.part）：engine heater distiller cooler tank deaerator
 *  阀门 wb-v4 wb-v5 wb-v6s wb-v7s wb-v8 wb-v9 wb-v12s wb-v13s wb-v15s wb-v25s wb-v27s
 *  三通阀 rv-3way（兼容 rv-cooler / rv-bypass / wb-v502）、泵 cw1/cw2 + 起停按钮、
 *  操作盒 panel1 / mode-knob、仪表 tc pt ps gauge
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
        this._local = { makeUp: false, drain: false };   // 补水阀 / 卸放阀（本地手动阀）

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
    //  几何（图片坐标 × 0.79）
    // ═══════════════════════════════════════════════════════════
    _recalcGeometry() {
        // 造水机接管点（球体下沿）与出口立管
        const FWG_CX = S(530) - 60, FWG_CY = S(145), FWG_R = Math.round(S(72) * 0.8);
        this._FWG = { CX: FWG_CX, CY: FWG_CY, R: FWG_R };
        this._FWGP = { IN: FWG_CX - 20, OUT: FWG_CX + 20, Y: FWG_CY + 46, RISER: S(720) - 80 };
        this._geo = {
            gauge1: { cx: S(190) - 60, cy: S(185), r: Math.round(S(110) * 0.8) },
            gauge2: { cx: S(815), cy: S(710), r: Math.round(S(110) * 0.8) },
            fwg: { cx: FWG_CX, cy: FWG_CY, r: FWG_R },
            cooler: { x: S(885) - 20, y: S(147), w: S(140), h: S(76) },
            tank: { x: S(1430), y: S(85), w: S(180), h: S(160) },
            dea: { cx: S(1498), cy: S(475), w: S(58), h: S(88) },
            heater: { x: S(310) + 70, y: S(590), w: S(190), h: S(70) },
            pumps: {
                cw1: { cx: S(1215), cy: S(630) + 20, r: S(55) - 20 },
                cw2: { cx: S(1215), cy: S(830), r: S(55) - 20 },
            },
            ps: { cx: S(975), cy: S(770), r: S(18) },
            v3w: { cx: S(1150), cy: S(325) },
            face: { x: S(670) - 150, y: S(385), w: S(210), h: S(70) },
            host: { x: 18, y: 373, w: 186, h: 355, k: 0.72 },
            tt: { cx: S(70) + 110, cy: S(298), r: S(18) },
            panel2: { x: 760, y: 338, w: 225, h: 146 },
        };

        // 管路（图片坐标）
        this._L = {
            hostOut: [[S(35), 373, S(35), S(325), 353.5, S(325)], [380.5, S(325), S(1150) - 17, S(325)]],
            mainR: [[S(1150) + 17, S(325), 1050, S(325), 1050, S(480), S(1498) - 27, S(480)]],
            fwgIn: [[S(295), S(325), S(295), S(225), 270.5, S(225)], [297.5, S(225), this._FWGP.IN, S(225), this._FWGP.IN, this._FWGP.Y]],
            fwgOut: [[this._FWGP.OUT, this._FWGP.Y, this._FWGP.OUT, S(225), 426.5, S(225)], [453.5, S(225), this._FWGP.RISER, S(225), this._FWGP.RISER, S(325)]],
            coolIn: [[S(790) - 40, S(325), S(790) - 40, S(235), 630.5, S(235)], [657.5, S(235), 696, S(235)]],
            coolOut: [[791, S(235), S(1075) - 10 - 13.5, S(235)], [S(1075) - 10 + 13.5, S(235), S(1150), S(235), S(1150), S(325) - 17]],
            tankTop: [[S(1540), S(85), S(1540), S(25), 1196.5, S(25)], [1169.5, S(25), 1140, S(25)]],
            tankDown: [[1231, 205, 1231, S(350) - 13.5], [1231, S(350) + 13.5, 1231, 381, 1215, 381]],
            deaOut: [[S(1500), S(519) + 4, S(1500), S(830)]],
            pumpOut1: [[S(1500), S(630) + 20, 1050 + 13.5, S(630) + 20], [1050 - 13.5, S(630) + 20, S(1215) + 29, S(630) + 20]],
            pumpOut2: [[S(1500), S(830), 1050 + 13.5, S(830)], [1050 - 13.5, S(830), S(1215) + 29, S(830)]],
            pumpSuc: [[S(1040), S(630) + 20, S(1040), S(830)]],
            pumpSuc1: [[S(1215) - 29, S(630) + 20, 880 - 13.5, S(630) + 20], [880 + 13.5, S(630) + 20, S(1040), S(630) + 20]],
            pumpSuc2: [[S(1215) - 29, S(830), 880 - 13.5, S(830)], [880 + 13.5, S(830), S(1040), S(830)]],
            hostIn: [[210, S(830), 210, 490, 152, 490]],
            bottom: [[210, S(830), 385.5, S(830)],
                [412.5, S(830), 880 - 13.5, S(830)],
                [880 + 13.5, S(830), S(1215) - 29, S(830)],
                [S(1215) + 29, S(830), 1050 - 13.5, S(830)],
                [1050 + 13.5, S(830), S(1500), S(830)]],
            heatIn: [[S(310) + 70, S(630), 271, S(630), 271, S(690) + 6.5], [271, S(690) + 33.5, 271, S(830)]],
            heatOut: [[S(310) + 70 + 156, S(630), S(660), S(630), S(660), S(690) + 6.5], [S(660), S(690) + 33.5, S(660), S(830)]],
            steamIn: [[361, S(590), 361, S(505), 331, S(505)]],
            steamOut: [[401, S(660), 401, S(740), 445, S(740)]],
            scupper: [[1284, 205, 1318, 205, 1318, 240 - 13.5], [1318, 240 + 13.5, 1318, 300]],
        };

        // 手动截止阀：{ id, x, y, ang(轴向), handle }
        this._valveDefs = [
            { id: 'wb-v6s', key: 'wbV6S', x: S(390) - 30, y: S(225), ang: 180, handle: 270 },   // 造水机进口
            { id: 'wb-v5', key: 'wbV5', x: 367, y: S(325), ang: 180, handle: 270 },             // 与造水机并联的主管截止阀（居中）
            { id: 'wb-v502', key: 'wbV502', x: S(845) - 30, y: S(235), ang: 180, handle: 270 },  // 冷却器进口
            { id: 'wb-v25s', key: 'wbV25S', x: S(660), y: S(690) + 20, ang: 90, handle: 0 },    // 加热器出口（右立管）
            { id: 'wb-v8', key: 'wbV8', x: 1050, y: S(630) + 20, ang: 180, handle: 270 },       // 1# 泵进口（右侧）
            { id: 'wb-v9', key: 'wbV9', x: 1050, y: S(830), ang: 180, handle: 270 },            // 2# 泵进口（右侧）
            { id: 'wb-v4', key: 'wbV4', x: (271 + 527) / 2, y: S(830), ang: 180, handle: 270 },   // 与预热器并联的截止阀（管段中间）
            { id: 'wb-fw', local: 'makeUp', x: 1183, y: S(25), ang: 180, handle: 270 },           // 水柜补水阀（手动，默认关）
            { id: 'wb-v13s', local: 'drain', x: 1318, y: 240, ang: 90, handle: 0 },               // 水柜卸放阀（手动，默认关）
        ];
        // 单向阀：{ id, x, y, angFlow }
        this._checkDefs = [
            { id: 'wb-v7s', x: S(625) - 60, y: S(225), ang: 0 },      // 造水机出口（向右）
            { id: 'wb-ck1', x: 880, y: S(630) + 20, ang: 180 },  // 1# 泵出口单向阀（向左）
            { id: 'wb-ck2', x: 880, y: S(830), ang: 180 },       // 2# 泵出口单向阀（向左）
            { id: 'wb-v15s', x: 1231, y: S(350), ang: 90 },         // 水柜至除气柜单向阀（向下）
            { id: 'wb-v12s', x: S(1075) - 10, y: S(235), ang: 0 },  // 冷却器出口单向阀（向右）
            { id: 'wb-v27s', x: 271, y: S(690) + 20, ang: 90 },     // 加热器进口单向阀（自上而下）
        ];
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

    _pipe(g, pts, color = PIPE, w = 3.2) {
        g.add(new Konva.Line({ points: pts, stroke: color, strokeWidth: w, lineCap: 'round', lineJoin: 'round' }));
    }

    /** 三角端口的"填充深度"着色：k=0 全白，k=1 全绿，中间按比例自基边向顶点填充 */
    _portFill(node, x0, y0, x1, y1, k) {
        if (!node) return;
        // 让"绿色面积/整块面积"与开度一致：三角形面积与深度的平方成正比，故深度取 √k
        const kk = Math.round(Math.sqrt(Math.max(0, Math.min(1, k))) * 100) / 100;
        if (node._fillK === kk) return;
        node._fillK = kk;
        if (kk <= 0) {
            node.fillPriority('color');
            node.fill('#ffffff');
        } else if (kk >= 1) {
            node.fillPriority('color');
            node.fill(ON_COLOR);
        } else {
            node.fillLinearGradientStartPoint({ x: x0, y: y0 });
            node.fillLinearGradientEndPoint({ x: x1 + (x1 - x0) * 0.0001, y: y1 + (y1 - y0) * 0.0001 });
            node.fillLinearGradientColorStops([0, ON_COLOR, kk, ON_COLOR, Math.min(1, kk + 0.002), '#ffffff', 1, '#ffffff']);
            node.fillPriority('linear-gradient');
        }
    }

    /** 管道流向箭头（顶点指向 ang 方向；180 = 向左，90 = 向下，270 = 向上） */
    _flowArrow(g, x, y, ang, s = 6, color = '#1a7fb5') {
        const r = ang * Math.PI / 180, ux = Math.cos(r), uy = Math.sin(r);
        const px = -uy, py = ux;
        g.add(new Konva.Line({
            points: [
                x + ux * s, y + uy * s,
                x - ux * s * 0.5 + px * s * 0.8, y - uy * s * 0.5 + py * s * 0.8,
                x - ux * s * 0.5 - px * s * 0.8, y - uy * s * 0.5 - py * s * 0.8,
            ],
            closed: true, fill: color,
        }));
    }

    /** 截止阀阀体（两三角顶点相交） */
    _valveBody(g, cx, cy, ang) {
        const mk = (a) => {
            const n = new Konva.Line({
                points: triPts(cx, cy, a), closed: true,
                fill: '#ffffff', stroke: '#333333', strokeWidth: 1.8, lineJoin: 'round',
                perfectDrawEnabled: false,
            });
            g.add(n);
            return n;
        };
        return { a: mk(ang), b: mk(ang + 180) };
    }

    /**
     * 电磁三通转换阀：三个三角形顶点相交于阀芯（西/东/北三端口），电磁线圈在最下方
     */
    _threeWaySolenoid(g, cx, cy) {
        const A = 17, B = 12;
        const mk = (ang) => {
            const n = new Konva.Line({
                points: triPts(cx, cy, ang, A, B), closed: true,
                fill: '#ffffff', stroke: '#333333', strokeWidth: 1.8, lineJoin: 'round',
                perfectDrawEnabled: false,
            });
            g.add(n);
            return n;
        };
        const west = mk(180), east = mk(0), north = mk(270);
        // 引线 → 电磁线圈（正下方；线圈 15.6×16.8 按本图三角尺寸等比缩放）
        const cw = 14, ch = 15, lead = A - 3;
        g.add(new Konva.Line({ points: [cx, cy, cx, cy + lead], stroke: '#666666', strokeWidth: 1.6 }));
        const coil = new Konva.Rect({ x: cx - cw / 2, y: cy + lead, width: cw, height: ch, cornerRadius: 2, fill: '#e53935', stroke: '#666666', strokeWidth: 1.6 });
        const diag = new Konva.Line({ points: [cx - cw / 2, cy + lead, cx + cw / 2, cy + lead + ch], stroke: '#ffdada', strokeWidth: 1.2 });
        g.add(coil, diag);
        return { west, east, north, coil, diag };
    }

    /** 手动截止阀（阀体 + 阀杆 + 手轮） */
    _handValve(g, cx, cy, ang = 180, handle = ang + 90) {
        const v = this._valveBody(g, cx, cy, ang);
        const r = handle * Math.PI / 180, ux = Math.cos(r), uy = Math.sin(r);
        const ex = cx + ux * (TRI_B + 9), ey = cy + uy * (TRI_B + 9);
        g.add(new Konva.Line({ points: [cx, cy, ex, ey], stroke: '#333333', strokeWidth: 1.8 }));
        const px = -uy, py = ux;
        g.add(new Konva.Line({ points: [ex + px * 6, ey + py * 6, ex - px * 6, ey - py * 6], stroke: '#333333', strokeWidth: 2.2 }));
        return v;
    }

    /** 单向阀（两顶点相对三角形） */
    _checkValve(g, cx, cy, angFlow) {
        const mk = (ang, fill) => {
            const n = new Konva.Line({
                points: triPts(cx, cy, ang), closed: true, fill,
                stroke: '#333333', strokeWidth: 1.8, lineJoin: 'round',
                perfectDrawEnabled: false,
            });
            g.add(n);
            return n;
        };
        return { in: mk(angFlow + 180, '#ffffff'), out: mk(angFlow, '#b0b6bb') };
    }

    /** 主机（简化侧视图，设计尺寸 186×355，由调用方按需缩放） */
    _drawHost(g) {
        const x = 0, y = 0, w = 186, h = 355;
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
    }

    /** 表盘（刻度 + 文字），指针由动态层画 */
    _dial(g, cx, cy, r, value, caption) {
        g.add(new Konva.Circle({ x: cx, y: cy, radius: r, fill: '#c9f0fb', stroke: '#222222', strokeWidth: 2.6 }));
        g.add(new Konva.Circle({ x: cx, y: cy, radius: r - 6, fillEnabled: false, stroke: '#7fd4ee', strokeWidth: 1 }));
        for (let v = 0; v <= 150; v += 15) {
            const a = (-135 + (v / 150) * 270) * Math.PI / 180;
            const r1 = r - 8, r2 = r - 22;
            g.add(new Konva.Line({
                points: [cx + Math.sin(a) * r1, cy - Math.cos(a) * r1, cx + Math.sin(a) * r2, cy - Math.cos(a) * r2],
                stroke: '#222222', strokeWidth: 2,
            }));
            const rl = r - 30;
            this._label(g, cx + Math.sin(a) * rl - 12, cy - Math.cos(a) * rl - 6, String(v), 11, '#111111', false, 'center', 24);
        }

        void caption;
        void value;
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

        g.add(new Konva.Rect({ x: 0, y: 0, width: W, height: Hh, cornerRadius: 8, fill: '#ffffff', stroke: '#c8cfd4', strokeWidth: 2 }));
        this._label(g, 10, 2, '主机缸套冷却水（高温淡水）温度控制系统', 18, '#0b3d91', true);

        // ══ ① 主机（柴油机，先画以便管线压在主机之上）══
        const HB = G.host;
        const bw = HB.w * HB.k, bh = HB.h * HB.k;
        g.add(new Konva.Rect({ x: HB.x - 8, y: HB.y - 8, width: bw + 16, height: bh + 16, cornerRadius: 14, fill: '#eceeef', stroke: '#d8dcde', strokeWidth: 1.5 }));
        const hg = new Konva.Group({ x: HB.x, y: HB.y, scaleX: HB.k, scaleY: HB.k });
        this._drawHost(hg);
        g.add(hg);
        this._label(g, HB.x + bw / 2 - 50, HB.y + bh + 12, '主机（柴油机）', 14, '#333333', true, 'center', 100);

        // ══ ② 管路 ══
        Object.keys(L).forEach(k => {
            const isAux = k === 'steamIn' || k === 'steamOut';
            L[k].forEach(seg => this._pipe(g, seg, isAux ? AUX : PIPE, isAux ? 2 : 3.2));
        });

        // 除气通道：除气柜顶部 → 膨胀水柜（带向上箭头的虚线）
        {
            const DX = G.dea.cx, y0 = G.tank.y + G.tank.h, y1 = G.dea.cy - G.dea.h / 2;
            const ay = (y0 + y1) / 2;
            // 静止状态下也显示虚线（流动虚线仅在冷却水循环时才叠加显示）
            g.add(new Konva.Line({ points: [DX, y0, DX, y1], stroke: '#9fb3c2', strokeWidth: 2, dash: [7, 5], lineCap: 'butt' }));
            g.add(new Konva.Line({ points: [DX, ay - 10, DX - 6.5, ay + 3, DX + 6.5, ay + 3], closed: true, fill: '#7a8c99' }));
        }

        // ══ ③ 仪表：缸套出口温度表 / 缸套水温度表 ══
        const G1 = G.gauge1, G2 = G.gauge2;
        this._pipe(g, [G1.cx, G1.cy + G1.r, G1.cx, S(325)], '#555555', 2);
        this._dial(g, G1.cx, G1.cy, G1.r, 36, '');
        this._pipe(g, [G2.cx, G2.cy + G2.r, G2.cx, S(830)], '#555555', 2);
        this._dial(g, G2.cx, G2.cy, G2.r, 36, '');

        // ══ ③ 造水机（Fresh Water Generator）══
        const D = G.fwg;
        g.add(new Konva.Circle({
            x: D.cx, y: D.cy, radius: D.r,
            fillRadialGradientStartPoint: { x: D.cx - D.r * 0.3, y: D.cy - D.r * 0.35 },
            fillRadialGradientStartRadius: 0,
            fillRadialGradientEndPoint: { x: D.cx, y: D.cy },
            fillRadialGradientEndRadius: D.r,
            fillRadialGradientColorStops: [0, '#8be08f', 0.55, '#33a35a', 1, '#1d6b39'],
            stroke: '#146c2e', strokeWidth: 2.5,
        }));
        const MP = this._FWGP;
        g.add(new Konva.Line({
            points: [
                MP.IN, MP.Y - 4,
                MP.IN, D.cy - D.r * 0.45,
                D.cx, MP.Y - 8,
                MP.OUT, D.cy - D.r * 0.45,
                MP.OUT, MP.Y - 4,
            ],
            stroke: '#1d9bf0', strokeWidth: 3, lineJoin: 'round', lineCap: 'round',
        }));
        this._label(g, D.cx - 90, D.cy - D.r - 22, 'Fresh Water Generator', 14, '#222222', true, 'center', 180);

        // ══ ④ 高温淡水冷却器（壳管式）══
        const C = G.cooler;
        const capW = 14, shellX = C.x + capW + 4, shellW = C.w - (capW + 4) * 2;
        g.add(new Konva.Rect({
            x: shellX, y: C.y + 6, width: shellW, height: C.h - 12, cornerRadius: 2,
            fillLinearGradientStartPoint: { x: 0, y: C.y },
            fillLinearGradientEndPoint: { x: 0, y: C.y + C.h },
            fillLinearGradientColorStops: [0, '#e8f4fb', 0.45, '#b5d1e3', 1, '#8aa8bd'],
            stroke: STEEL, strokeWidth: 1.3,
        }));
        for (let i = 1; i <= 6; i++) {
            const ly = C.y + 6 + (C.h - 12) * i / 7;
            g.add(new Konva.Line({ points: [shellX + 2, ly, shellX + shellW - 2, ly], stroke: '#6d8ea6', strokeWidth: 1 }));
        }
        [{ x: C.x + 2 }, { x: C.x + C.w - capW - 2 }].forEach(o => {
            g.add(new Konva.Rect({ x: o.x, y: C.y + 1, width: capW, height: C.h - 2, cornerRadius: 6, fill: '#d3e6f4', stroke: STEEL, strokeWidth: 1.4 }));
        });
        [C.x + capW / 2 + 4, C.x + C.w - capW / 2 - 4].forEach(px => {
            g.add(new Konva.Rect({ x: px - 3, y: C.y - 8, width: 6, height: 10, fill: '#d3e6f4', stroke: STEEL, strokeWidth: 1.1 }));
        });
        // 底部（缸套水）接管：左右对称，与顶部接管同轴
        [C.x + capW / 2 + 4, C.x + C.w - capW / 2 - 4].forEach(px => {
            g.add(new Konva.Rect({ x: px - 3, y: C.y + C.h - 4, width: 6, height: 8, fill: '#d3e6f4', stroke: STEEL, strokeWidth: 1.1 }));
        });
        // 低温淡水（LTFW）接管：右上进（自右向左、再向下进右上接口）；左上出（向上、再向左引出）
        const ltfwIn = C.x + C.w - capW / 2 - 4, ltfwOut = C.x + capW / 2 + 4;
        const ltfwTop = C.y - 8, ltfwY = 58, ltfwRun = 96, ltfwMy = (ltfwY + ltfwTop) / 2;
        // 进 / 出口关于冷却器中线完全对称：立管等长、横管等长、同一高度
        this._pipe(g, [ltfwIn + ltfwRun, ltfwY, ltfwIn, ltfwY, ltfwIn, ltfwTop], PIPE, 3);
        this._pipe(g, [ltfwOut, ltfwTop, ltfwOut, ltfwY, ltfwOut - ltfwRun, ltfwY], PIPE, 3);
        this._flowArrow(g, ltfwIn + ltfwRun / 2, ltfwY, 180, 6);    // 入口：向左流入
        this._flowArrow(g, ltfwIn, ltfwMy, 90, 6);                  // 入口：向下进入接口
        this._flowArrow(g, ltfwOut, ltfwMy, 270, 6);                // 出口：自接口向上引出
        this._flowArrow(g, ltfwOut - ltfwRun / 2, ltfwY, 180, 6);   // 出口：向左流出
        this._label(g, ltfwIn + ltfwRun / 2 - 40, 34, '低温淡水入口', 10, '#222222', false, 'center', 80);
        this._label(g, C.x + C.w / 2 - 50, C.y + C.h + 12, 'HTFW Cooler', 14, '#222222', true, 'center', 100);

        // ══ ⑤ 膨胀水柜 ══
        const T = G.tank;
        g.add(new Konva.Rect({ x: T.x, y: T.y, width: T.w, height: T.h, cornerRadius: 4, fill: '#1fb6e8', stroke: '#1b6f8f', strokeWidth: 2 }));
        // 左边缘玻璃液位计
        g.add(new Konva.Rect({ x: T.x - 16, y: T.y, width: 14, height: T.h, fill: '#f4fbfe', stroke: '#1b6f8f', strokeWidth: 1.4 }));
        this._label(g, T.x - 40, T.y - 24, '膨胀水柜', 14, '#0b2b38', true, 'center', T.w);

        // ══ ⑥ 除气柜 ══
        const DA = G.dea;
        g.add(new Konva.Rect({
            x: DA.cx - DA.w / 2, y: DA.cy - DA.h / 2, width: DA.w, height: DA.h, cornerRadius: 14,
            fillLinearGradientStartPoint: { x: DA.cx - DA.w / 2, y: 0 },
            fillLinearGradientEndPoint: { x: DA.cx + DA.w / 2, y: 0 },
            fillLinearGradientColorStops: [0, '#eaf4fb', 0.4, '#bfd9ea', 1, '#8fb2c8'],
            stroke: STEEL, strokeWidth: 1.6,
        }));
        this._label(g, DA.cx + DA.w / 2 + 6, DA.cy + DA.h / 2 - 14, 'Deaerating Chamber', 12, '#222222', false, 'left', 130);

        // ══ ⑦ 缸套水加热器 ══
        const HT = G.heater;
        g.add(new Konva.Rect({
            x: HT.x, y: HT.y, width: HT.w, height: HT.h, cornerRadius: HT.h / 2,
            fillLinearGradientStartPoint: { x: 0, y: HT.y },
            fillLinearGradientEndPoint: { x: 0, y: HT.y + HT.h },
            fillLinearGradientColorStops: [0, '#fbd6e2', 0.5, '#f6b8cd', 1, '#e79bb5'],
            stroke: '#b3667f', strokeWidth: 1.8,
        }));
        // 蒸汽接口（顶部进、底部出）
        g.add(new Konva.Rect({ x: 356, y: HT.y - 8, width: 10, height: 12, fill: '#dfe7ec', stroke: STEEL, strokeWidth: 1.2 }));
        g.add(new Konva.Rect({ x: 396, y: HT.y + HT.h - 4, width: 10, height: 12, fill: '#dfe7ec', stroke: STEEL, strokeWidth: 1.2 }));
        this._label(g, HT.x + HT.w + 6 - 60, HT.y - 42 + 20, '缸套水预热器', 13, '#222222', true);
        // 蒸汽进 / 凝水出的流向箭头
        this._flowArrow(g, 346, S(505), 0, 6);        // 蒸汽：向右进入
        this._flowArrow(g, 361, S(505) + 30, 90, 6);  // 蒸汽：向下进入预热器
        this._flowArrow(g, 401, S(660) + 32, 90, 6);  // 凝水：向下流出
        this._flowArrow(g, 423, S(740), 0, 6);        // 凝水：向右流出
        this._label(g, 300, S(505) - 16, '蒸汽入口', 10, '#555555');
        this._label(g, 452, S(740) - 4, '凝水出口', 10, '#555555');
        // 锅炉蒸汽 42

        // ══ ⑧ 冷却泵 ══
        [['cw1', G.pumps.cw1], ['cw2', G.pumps.cw2]].forEach(([k, P]) => {
            g.add(new Konva.Circle({ x: P.cx, y: P.cy, radius: P.r, fill: '#f4f4f4', stroke: '#555555', strokeWidth: 2 }));
            this._label(g, P.cx - 110, P.cy + P.r + 6, k === 'cw1' ? 'NO.1 Jacket Cool. F.W. Pump' : 'NO.2 Jacket Cool. F.W. Pump', 12, '#222222', true, 'center', 220);
            void k;
        });

        // ══ ⑩ 传感器 ══
        const TT = G.tt, PS = G.ps;
        g.add(new Konva.Line({ points: [TT.cx, TT.cy + TT.r, TT.cx, S(325)], stroke: '#555555', strokeWidth: 2 }));
        g.add(new Konva.Circle({ x: TT.cx, y: TT.cy, radius: TT.r, fill: '#eefcff', stroke: '#555555', strokeWidth: 2 }));
        this._label(g, TT.cx - TT.r, TT.cy - 8, 'TT', 13, '#009bd7', true, 'center', TT.r * 2);
        g.add(new Konva.Line({ points: [PS.cx, PS.cy + PS.r, PS.cx, S(830)], stroke: '#555555', strokeWidth: 2 }));
        // PS 圆圈画在动态层（压力正常闭合时绿色填充、压力低断开时不填充）

        // ══ ⑪ TEMP / Ctrl 显示窗（只读）══
        const F = G.face;
        g.add(new Konva.Rect({ x: F.x, y: F.y, width: F.w, height: F.h, fill: '#d8d8d8', stroke: '#9a9a9a', strokeWidth: 1 }));
        g.add(new Konva.Rect({ x: F.x, y: F.y, width: 46, height: F.h / 2, fill: '#1f7a1f' }));
        g.add(new Konva.Rect({ x: F.x, y: F.y + F.h / 2, width: 46, height: F.h / 2, fill: '#1f7a1f' }));
        this._label(g, F.x + 4, F.y + 8, 'TEMP', 9, '#ffffff', true);
        this._label(g, F.x + 4, F.y + F.h / 2 + 8, 'Ctrl', 9, '#ffffff', true);
        g.add(new Konva.Rect({ x: F.x + 48, y: F.y + 4, width: 40, height: F.h / 2 - 8, fillEnabled: false, stroke: '#8a8a8a', strokeWidth: 1 }));
        g.add(new Konva.Rect({ x: F.x + 48, y: F.y + F.h / 2 + 4, width: 40, height: F.h / 2 - 8, fillEnabled: false, stroke: '#8a8a8a', strokeWidth: 1 }));
        // 虚线控制线：测点 → 显示窗 → 三通阀
        const dash = (pts) => g.add(new Konva.Line({ points: pts, stroke: '#8a8a8a', strokeWidth: 1.2, dash: [7, 6] }));
        dash([G.tt.cx, G.tt.cy + G.tt.r, G.tt.cx, S(420), F.x - 4, S(420), F.x - 4, F.y + 10]);
        dash([F.x + F.w, F.y + 10, S(1150), F.y + 10, S(1150), G.v3w.cy - 12]);

        // ══ ⑫ 冷态读数（静态文字，与图一致）══

        // ══ ⑬ 冷却泵操作盒（两组起动 / 停止按钮）══
        const Q = G.panel2;
        g.add(new Konva.Rect({
            x: Q.x, y: Q.y, width: Q.w, height: Q.h, cornerRadius: 6,
            fillLinearGradientStartPoint: { x: Q.x, y: Q.y },
            fillLinearGradientEndPoint: { x: Q.x, y: Q.y + Q.h },
            fillLinearGradientColorStops: [0, '#d9dde0', 0.5, '#b9bfc3', 1, '#9aa1a5'],
            stroke: '#4a4f50', strokeWidth: 1.6,
        }));
        g.add(new Konva.Rect({ x: Q.x + 4, y: Q.y + 4, width: Q.w - 8, height: Q.h - 8, cornerRadius: 3, fill: '#efe9d6', stroke: '#b9b3a0', strokeWidth: 1 }));
        // 每台泵一行：编号 / 起动 / 停止 / 手动-自动 转换开关
        this._panelRows = [Q.y + 48, Q.y + 112];
        this._panelCols = { no: Q.x + 18, start: Q.x + 70, stop: Q.x + 126, knob: Q.x + 184 };
        const PC = this._panelCols;
        this._panelRows.forEach((ry, i) => {
            this._label(g, PC.no - 10, ry - 10, String(i + 1), 16, '#222222', true, 'center', 20);
            this._label(g, PC.start - 15, ry - 40, '起动', 12, '#222222', true, 'center', 30);
            this._label(g, PC.stop - 15, ry - 40, '停止', 12, '#222222', true, 'center', 30);
            this._label(g, PC.knob - 35, ry - 40, '手动', 11, '#333333', true, 'center', 26);
            this._label(g, PC.knob + 9, ry - 40, '自动', 11, '#333333', true, 'center', 26);
            // 按钮底座（金属外圈 + 内斜面，标准圆钮）
            [PC.start, PC.stop].forEach(cx => {
                g.add(new Konva.Circle({ x: cx, y: ry, radius: 20, fill: '#e8eaeb', stroke: '#6d7376', strokeWidth: 1.4 }));
                g.add(new Konva.Circle({ x: cx, y: ry, radius: 18, fill: '#bcc1c4', stroke: '#8e9497', strokeWidth: 1 }));
            });
            // 手/自动转换开关底座
            g.add(new Konva.Circle({ x: PC.knob, y: ry, radius: 23, fill: '#ffffff', stroke: '#9aa0a0', strokeWidth: 1.2 }));
            g.add(new Konva.Circle({ x: PC.knob, y: ry, radius: 16, fill: '#141414', stroke: '#000000', strokeWidth: 1 }));
        });
        // ══ ⑭ 柴油机控制盒（起停开关 + 负荷调节旋钮）══
        const EB = { x: 46, y: 310, w: 118, h: 62 };
        this._engBox = EB;
        const EK = { start: { x: EB.x + 28, y: EB.y + 32 }, load: { x: EB.x + 88, y: EB.y + 32 }, r: 14 };
        this._engKnob = EK;
        g.add(new Konva.Rect({
            x: EB.x, y: EB.y, width: EB.w, height: EB.h, cornerRadius: 5,
            fillLinearGradientStartPoint: { x: EB.x, y: EB.y },
            fillLinearGradientEndPoint: { x: EB.x, y: EB.y + EB.h },
            fillLinearGradientColorStops: [0, '#dfe3e6', 0.5, '#c2c8cc', 1, '#a3aaae'],
            stroke: '#4a4f50', strokeWidth: 1.6,
        }));
        g.add(new Konva.Rect({ x: EB.x + 3, y: EB.y + 3, width: EB.w - 6, height: EB.h - 6, cornerRadius: 3, fill: '#efe9d6', stroke: '#b9b3a0', strokeWidth: 1 }));
        this._label(g, EK.start.x - 10, EB.y + 4, '起停', 9, '#222222', true, 'center', 20);
        this._label(g, EK.load.x - 10, EB.y + 4, '负荷', 9, '#222222', true, 'center', 20);
        [EK.start, EK.load].forEach(k => {
            g.add(new Konva.Circle({ x: k.x, y: k.y, radius: 14, fill: '#ffffff', stroke: '#9aa0a0', strokeWidth: 1.2 }));
            g.add(new Konva.Circle({ x: k.x, y: k.y, radius: 9, fill: '#141414', stroke: '#000000', strokeWidth: 1 }));
        });
    }

    // ═══════════════════════════════════════════════════════════
    //  动态节点
    // ═══════════════════════════════════════════════════════════
    _createDynamicNodes() {
        const d = this._dynamicGroup, G = this._geo, L = this._L;

        // 主管温度着色（只着色主管与就近管段）
        const tint = (pts, w = 3.2) => {
            const n = new Konva.Line({ points: pts, stroke: '#8fd6f5', strokeWidth: w, lineCap: 'round', lineJoin: 'round' });
            d.add(n);
            return n;
        };
        this._tint = {
            main: L.hostOut.map(s => tint(s)),
            mainR: L.mainR.map(s => tint(s)),
            fwgIn: L.fwgIn.map(s => tint(s, 2.4)),
            fwgOut: L.fwgOut.map(s => tint(s, 2.4)),
            coolIn: L.coolIn.map(s => tint(s, 2.4)),
            coolOut: L.coolOut.map(s => tint(s, 2.4)),
            bottom: L.bottom.map(s => tint(s)),
            hostIn: L.hostIn.map(s => tint(s)),
            heatIn: L.heatIn.map(s => tint(s)),
            heatOut: L.heatOut.map(s => tint(s)),
            deaOut: L.deaOut.map(s => tint(s)),
            pumpOut1: L.pumpOut1.map(s => tint(s)),
            pumpOut2: L.pumpOut2.map(s => tint(s)),
            pumpSuc: L.pumpSuc.map(s => tint(s)),
            pumpSuc1: L.pumpSuc1.map(s => tint(s)),
            pumpSuc2: L.pumpSuc2.map(s => tint(s)),
        };

        // 流动虚线（受手动截止阀导通状态与水泵运行状态约束）
        this._flows = [];
        const rev = (pts) => {           // 按点对反向，保持 [x,y,x,y…] 结构
            const out = [];
            for (let i = pts.length - 2; i >= 0; i -= 2) out.push(pts[i], pts[i + 1]);
            return out;
        };
        // 主管上"造水机支路"与"WB-V5 截止阀"是并联的两条通路：
        // 两条都不通时，整个冷却水回路被切断，全系统都不应有流动
        //  · 主管：WB-V5 与造水机支路并联
        //  · 回水：WB-V25S（预热器出口）与 WB-V4（并联阀）并联
        //  任一组"两条都不通"→ 整个冷却水回路被切断，全系统都不应有流动
        const loopClosed = (m) => (m.sw.wbV5 === false && !m.sw.wbV6S)
            || (m.sw.wbV25S === false && m.sw.wbV4 === false);
        const flow = (pts, cond, color = '#ff2f1f', w = 3.8, speed = 1) => {
            const w0 = typeof w === 'function' ? w({ manip: 70, pump: 1 }) : w;
            const n = new Konva.Line({ points: pts, stroke: color, strokeWidth: w0, dash: [9, 7], dashOffset: 0, opacity: 0, lineCap: 'round' });
            d.add(n);
            this._flows.push({ node: n, cond: (m) => !loopClosed(m) && cond(m), w, speed });
        };
        const anyRun = (m) => !!(m.pumps.cw1.run || m.pumps.cw2.run);
        // 主机出口 → 三通调节阀：造水机并联段（WB-V5 与造水机支路并联）分段判断
        const mainOn = (m) => anyRun(m) || m.psUp;
        const TAP = S(295), RET = this._FWGP.RISER;   // 支路引出点 / 返回点
        flow([S(35), 373, S(35), S(325), TAP, S(325)], mainOn);
        flow([TAP, S(325), 353.5, S(325)], m => mainOn(m) && m.sw.wbV5 !== false);
        flow([380.5, S(325), RET, S(325)], m => mainOn(m) && m.sw.wbV5 !== false);
        flow([RET, S(325), 590, S(325)], m => mainOn(m) && (m.sw.wbV5 !== false || m.sw.wbV6S));
        // 冷却器引出点 → 三通阀西口（旁通口）：只走旁通那部分流量（100 % − 冷却口开度）
        flow([590, S(325), S(1150) - 17, S(325)],
            m => mainOn(m) && (m.sw.wbV5 !== false || m.sw.wbV6S) && m.manip < 99,
            '#ff2f1f', (m) => 1.4 + 2.4 * Math.max(0, Math.min(100, 100 - m.manip)) / 100);
        // 三通阀 → 除气柜
        flow(this._L.mainR[0], m => m.psUp);   // 东口 = 合流口，始终 100 % 流量
        // 造水机支路（进口截止阀 WB-V6S）
        flow(this._L.fwgIn[0], m => m.psUp && m.sw.wbV6S, '#1f8dff', 2.8);
        flow(this._L.fwgIn[1], m => m.psUp && m.sw.wbV6S, '#1f8dff', 2.8);
        flow(this._L.fwgOut[0], m => m.psUp && m.sw.wbV6S, '#1f8dff', 2.8);
        flow(this._L.fwgOut[1], m => m.psUp && m.sw.wbV6S, '#1f8dff', 2.8);
        // 高温淡水冷却器支路（冷却口开度 > 0 才走）
        const coolFlow = (m) => m.psUp && m.sw.wbV502 !== false && m.manip > 2;
        const coolW = (m) => 1.4 + 2.4 * Math.max(0, Math.min(100, m.manip)) / 100;
        flow(this._L.coolIn[0], coolFlow, '#1f8dff', coolW);
        flow(this._L.coolIn[1], coolFlow, '#1f8dff', coolW);
        flow(this._L.coolOut[0], coolFlow, '#1f8dff', coolW);
        flow(this._L.coolOut[1], coolFlow, '#1f8dff', coolW);
        // 膨胀水柜 → 除气柜（经单向阀）：缓慢的间隙补水，每 2 min 流动 5 s
        const tankPulse = (m) => m.psUp && (m.clock % 120) < 5;
        flow(this._L.tankDown[0], tankPulse, '#ff2f1f', 1.2, 0.2);
        flow(this._L.tankDown[1], tankPulse, '#ff2f1f', 1.2, 0.2);
        // 除气柜 → 泵吸入总管
        flow([S(1500), S(519) + 4, S(1500), S(630) + 20], m => m.psUp);
        flow([S(1500), S(630) + 20, S(1500), S(830)], m => m.pumps.cw2.run);
        // 1# / 2# 泵：吸入（经泵吸入阀 WB-V8 / WB-V9）、排出
        flow(this._L.pumpOut1[0], m => m.pumps.cw1.run && m.sw.wbV8 !== false);
        flow(this._L.pumpOut1[1], m => m.pumps.cw1.run && m.sw.wbV8 !== false);
        flow(this._L.pumpOut2[0], m => m.pumps.cw2.run && m.sw.wbV9 !== false);
        flow(this._L.pumpOut2[1], m => m.pumps.cw2.run && m.sw.wbV9 !== false);
        flow(this._L.pumpSuc[0], anyRun);
        flow(this._L.pumpSuc1[0], m => m.pumps.cw1.run);
        flow(this._L.pumpSuc1[1], m => m.pumps.cw1.run);
        flow(this._L.pumpSuc2[0], m => m.pumps.cw2.run);
        flow(this._L.pumpSuc2[1], m => m.pumps.cw2.run);
        // 缸套水预热器支路（出口截止阀 WB-V25S 导通才走；进水管反向为自下而上）
        const heatFlow = (m) => m.psUp && m.sw.wbV25S;
        flow(rev(this._L.heatOut[0]), heatFlow);   // 右立管：自下而上进预热器
        flow(rev(this._L.heatOut[1]), heatFlow);
        flow(this._L.heatIn[0], heatFlow);          // 左立管：自预热器向下出
        flow(this._L.heatIn[1], heatFlow);
        // 底部回水总管（并联阀 WB-V4 或预热器通路任一导通）
        const retFlow = (m) => m.psUp && (m.sw.wbV4 !== false || m.sw.wbV25S);
        flow(rev(this._L.bottom[0]), retFlow);
        flow([880 + 13.5, S(830), 828, S(830)], m => m.pumps.cw2.run);
        flow([828, S(830), 412.5, S(830)], retFlow);
        // 主机回水（底部总管 → 主机）
        flow(this._L.hostIn[0], m => m.psUp);
        // 除气通道：自下而上（除气柜顶部 → 膨胀水柜）
        flow([G.dea.cx, G.dea.cy - G.dea.h / 2, G.dea.cx, G.tank.y + G.tank.h], m => m.psUp, '#3aa0ff', 1.6, 0.12);

        // 主机曲轴
        const HB = G.host, kk = HB.k;
        this._crank = new Konva.Group({ x: HB.x + 97 * kk, y: HB.y + 293 * kk });
        for (let i = 0; i < 4; i++) {
            const a = (i * 90) * Math.PI / 180;
            this._crank.add(new Konva.Line({ points: [0, 0, Math.cos(a) * 22 * kk, Math.sin(a) * 22 * kk], stroke: '#4e5d60', strokeWidth: 3, lineCap: 'round' }));
        }
        this._crank.add(new Konva.Circle({ x: 0, y: 0, radius: 6 * kk, fill: '#dfe7e8', stroke: '#4e5d60', strokeWidth: 1.4 }));
        d.add(this._crank);

        // 表针
        this._needle1 = new Konva.Group({ x: G.gauge1.cx, y: G.gauge1.cy, rotation: -135 });
        this._needle1.add(new Konva.Line({ points: [0, 0, 0, -G.gauge1.r + 30], stroke: '#222222', strokeWidth: 3, lineCap: 'round' }));
        this._needle1.add(new Konva.Circle({ x: 0, y: 0, radius: 5, fill: '#222222' }));
        this._needle2 = new Konva.Group({ x: G.gauge2.cx, y: G.gauge2.cy, rotation: -135 });
        this._needle2.add(new Konva.Line({ points: [0, 0, 0, -G.gauge2.r + 30], stroke: '#222222', strokeWidth: 3, lineCap: 'round' }));
        this._needle2.add(new Konva.Circle({ x: 0, y: 0, radius: 5, fill: '#222222' }));
        d.add(this._needle1, this._needle2);
        const digit = (g0) => new Konva.Text({
            x: g0.cx - 44, y: g0.cy - g0.r - 28, width: 80, align: 'center', text: '36.0', fontSize: 18,
            fontStyle: 'bold', fill: '#111111', fontFamily: 'Arial, "Microsoft YaHei", sans-serif',
        });
        this._digi1 = digit(G.gauge1);
        d.add(new Konva.Text({ x: G.gauge1.cx + 29, y: G.gauge1.cy - G.gauge1.r - 25, text: '℃', fontSize: 13, fontStyle: 'bold', fill: '#222222', fontFamily: 'Arial' }));
        this._digi2 = digit(G.gauge2);
        d.add(new Konva.Text({ x: G.gauge2.cx + 29, y: G.gauge2.cy - G.gauge2.r - 25, text: '℃', fontSize: 13, fontStyle: 'bold', fill: '#222222', fontFamily: 'Arial' }));
        d.add(this._digi1, this._digi2);

        // 泵叶轮
        this._pumpFace = {};
        this._fans = {};
        this._pumpFill = {};
        ['cw1', 'cw2'].forEach(k => {
            const P = G.pumps[k];
            const face = new Konva.Circle({ x: P.cx, y: P.cy, radius: P.r - 1, fill: '#f4f4f4' });
            d.add(face);
            this._pumpFill[k] = face;
            const fan = new Konva.Group({ x: P.cx, y: P.cy, rotation: 0 });
            const R = P.r * 0.72;
            for (let i = 0; i < 3; i++) {
                const a = (i * 120 - 90) * Math.PI / 180;
                const tip = [Math.cos(a) * R, Math.sin(a) * R];
                const c1 = a - 0.62, c2 = a + 0.52;
                const p1 = [Math.cos(c1) * R * 0.55, Math.sin(c1) * R * 0.55];
                const p2 = [Math.cos(c2) * R * 0.64, Math.sin(c2) * R * 0.64];
                fan.add(new Konva.Path({
                    data: `M 0 0 Q ${p1[0].toFixed(1)} ${p1[1].toFixed(1)} ${tip[0].toFixed(1)} ${tip[1].toFixed(1)} Q ${p2[0].toFixed(1)} ${p2[1].toFixed(1)} 0 0 Z`,
                    fill: '#9aa4a9', stroke: '#6b757a', strokeWidth: 0.8, lineJoin: 'round',
                }));
            }
            fan.add(new Konva.Circle({ x: 0, y: 0, radius: P.r * 0.16, fill: '#6b757a' }));
            d.add(fan);
            this._fans[k] = fan;
        });

        // PS 压力开关指示圆（PS 闭合 → 绿色填充；断开 → 不填充）
        this._psCircle = new Konva.Circle({
            x: G.ps.cx, y: G.ps.cy, radius: G.ps.r,
            fill: '#ffffff', stroke: '#555555', strokeWidth: 2,
        });
        this._psTxt = new Konva.Text({
            x: G.ps.cx - G.ps.r, y: G.ps.cy - 8, width: G.ps.r * 2, align: 'center',
            text: 'PS', fontSize: 13, fontStyle: 'bold', fill: '#009bd7',
            fontFamily: 'Arial, "Microsoft YaHei", sans-serif',
        });
        d.add(this._psCircle, this._psTxt);

        // 柴油机运行时缸内火焰
        this._flames = [];
        {
            const HG = G.host, hk = HG.k;
            for (let i = 0; i < 5; i++) {
                const fg = new Konva.Group({
                    x: HG.x + (54 + i * 26) * hk,
                    y: HG.y + 170 * hk,
                    visible: false,
                });
                fg.add(new Konva.Line({
                    points: [0, 0, -6.2, -6, -4.4, -12, 0, -17, 4.4, -12, 6.2, -6],
                    closed: true, fill: '#ff7a00', stroke: '#c94200', strokeWidth: 0.6, lineJoin: 'round',
                    perfectDrawEnabled: false,
                }));
                fg.add(new Konva.Line({
                    points: [0, -2, -3.4, -7.2, 0, -11.5, 3.4, -7.2],
                    closed: true, fill: '#ffd93b',
                }));
                d.add(fg);
                this._flames.push(fg);
            }
        }

        // 柴油机旋钮手柄与读数
        {
            const EK = this._engKnob || { start: { x: 74, y: 342 }, load: { x: 134, y: 342 } };
            const mkH = (k) => {
                const h = new Konva.Group({ x: k.x, y: k.y, rotation: 0 });
                h.add(new Konva.Rect({ x: -2.5, y: -9, width: 5, height: 18, cornerRadius: 2.5, fill: 'rgba(0,0,0,0)', stroke: '#ffffff', strokeWidth: 1.6 }));
                h.add(new Konva.Rect({ x: -1.5, y: -9, width: 3, height: 4, cornerRadius: 1, fill: '#ffffff' }));
                d.add(h);
                return h;
            };
            this._engStartKnob = mkH(EK.start);
            this._engLoadKnob = mkH(EK.load);
            this._engStateTxt = new Konva.Text({ x: EK.start.x - 20, y: EK.start.y + 16, width: 40, align: 'center', text: '运转', fontSize: 9, fontStyle: 'bold', fill: '#0b7a0b', fontFamily: 'Arial, "Microsoft YaHei", sans-serif' });
            this._engLoadTxt = new Konva.Text({ x: EK.load.x - 20, y: EK.load.y + 16, width: 40, align: 'center', text: '64 %', fontSize: 9, fontStyle: 'bold', fill: '#0b3d91', fontFamily: 'Arial, "Microsoft YaHei", sans-serif' });
            d.add(this._engStateTxt, this._engLoadTxt);
        }

        // 水柜液位（动态管）
        const T = G.tank;
        this._tankLvl = new Konva.Rect({ x: T.x - 15, y: T.y, width: 12, height: T.h, fill: '#0b93c9' });
        this._lvlTxt = new Konva.Text({ x: T.x - 90, y: T.y + T.h / 2 - 10, width: 72, align: 'right', text: 'L 85.0', fontSize: 15, fontStyle: 'bold', fill: '#0b2b38', fontFamily: 'Arial, "Microsoft YaHei", sans-serif' });
        d.add(this._tankLvl, this._lvlTxt);

        // 操作盒按钮灯
        const Q = G.panel2;
        const PC0 = this._panelCols;
        this._btnLamps = {};
        this._modeKnobs = {};
        (this._panelRows || [Q.y + 48, Q.y + 112]).forEach((ry, i) => {
            const start = new Konva.Circle({ x: PC0.start, y: ry, radius: 17.4, fill: '#1f7a1f', stroke: '#0d4d0d', strokeWidth: 1.2 });
            const stop = new Konva.Circle({ x: PC0.stop, y: ry, radius: 17.4, fill: '#7d1a12', stroke: '#4a0d08', strokeWidth: 1.2 });
            d.add(start, stop);
            this._btnLamps[i] = { start, stop };
            // 手动 / 自动 旋钮手柄（−45° = 手动，+45° = 自动）
            const h = new Konva.Group({ x: PC0.knob, y: ry, rotation: -45 });
            h.add(new Konva.Rect({ x: -4, y: -17, width: 8, height: 34, cornerRadius: 4, fill: 'rgba(0,0,0,0)', stroke: '#ffffff', strokeWidth: 2 }));
            h.add(new Konva.Rect({ x: -2.5, y: -16, width: 5, height: 7, cornerRadius: 1, fill: '#ffffff' }));
            d.add(h);
            this._modeKnobs[i] = h;
        });

        // 三通阀开度
        const V3 = G.v3w;
        this._rvPtr = null;
        // 三通阀开度：左侧管道 = 旁通开度（红）；上方管道 = 冷却口开度（蓝）
        this._rvBypassTxt = new Konva.Text({
            x: V3.cx - 180, y: V3.cy + 10, width: 150, align: 'right', text: '旁通开度 0%',
            fontSize: 16, fontStyle: 'bold', fill: '#d4280a',
            fontFamily: 'Arial, "Microsoft YaHei", sans-serif',
        });
        this._rvCoolTxt = new Konva.Text({
            x: V3.cx + 14, y: V3.cy - 55, text: '冷却口开度 0%',
            fontSize: 16, fontStyle: 'bold', fill: '#0d6bb8',
            fontFamily: 'Arial, "Microsoft YaHei", sans-serif',
        });
        d.add(this._rvBypassTxt, this._rvCoolTxt);

        // TEMP / Ctrl 数值（字体 +4、加粗）
        const F = G.face;
        this._tempVal = new Konva.Text({ x: F.x + 92, y: F.y + 7, text: '0.00', fontSize: 14, fontStyle: 'bold', fill: '#222222', fontFamily: 'Consolas, monospace' });
        this._ctrlVal = new Konva.Text({ x: F.x + 92, y: F.y + F.h / 2 + 7, text: '0.00', fontSize: 14, fontStyle: 'bold', fill: '#222222', fontFamily: 'Consolas, monospace' });
        // 与 LDCL 面板联动的控制方式底色：AUTO（上）/ MANU（下）
        this._autoBox = new Konva.Rect({ x: F.x + 49, y: F.y + 5, width: 38, height: F.h / 2 - 10, fill: '#d9e6f5' });
        this._manuBox = new Konva.Rect({ x: F.x + 49, y: F.y + F.h / 2 + 5, width: 38, height: F.h / 2 - 10, fill: '#d9e6f5' });
        this._autoTxt = new Konva.Text({ x: F.x + 48, y: F.y + 8, width: 40, align: 'center', text: 'AUTO', fontSize: 9, fontStyle: 'bold', fill: '#333333', fontFamily: 'Arial, "Microsoft YaHei", sans-serif' });
        this._manuTxt = new Konva.Text({ x: F.x + 48, y: F.y + F.h / 2 + 8, width: 40, align: 'center', text: 'MANU', fontSize: 9, fontStyle: 'bold', fill: '#333333', fontFamily: 'Arial, "Microsoft YaHei", sans-serif' });
        d.add(this._autoBox, this._manuBox, this._tempVal, this._ctrlVal, this._autoTxt, this._manuTxt);

        // ── 阀门（放在动态层：静态层缓存后改 fill 不生效）──
        this._valves = {};
        this._valveDefs.forEach(v => { this._valves[v.id] = this._handValve(d, v.x, v.y, v.ang, v.handle); });
        this._checks = {};
        this._checkDefs.forEach(c => { this._checks[c.id] = this._checkValve(d, c.x, c.y, c.ang); });
        this._v3 = this._threeWaySolenoid(d, G.v3w.cx, G.v3w.cy);

        // 报警 / 停车提示
        this._alarmTxt = new Konva.Text({
            x: S(60), y: S(890), width: S(1500), text: '', fontSize: 10, fontStyle: 'bold', fill: '#c62828',
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
            hit.on('click tap', () => { if (fn) fn(); s._syncVisuals(); });
            clearBg(hit);
            return hit;
        };

        // 设备
        add('engine', G.host.x, G.host.y, G.host.w * G.host.k, G.host.h * G.host.k, () => s._tipPart('engine'));
        add('heater', G.heater.x, G.heater.y, G.heater.w, G.heater.h, () => s._tipPart('heater'));
        add('distiller', G.fwg.cx - G.fwg.r, G.fwg.cy - G.fwg.r, G.fwg.r * 2, G.fwg.r * 2, () => s._tipPart('distiller'));
        add('cooler', G.cooler.x, G.cooler.y, G.cooler.w, G.cooler.h, () => s._tipPart('cooler'));
        add('tank', G.tank.x, G.tank.y, G.tank.w, G.tank.h, () => s._tipPart('tank'));
        add('deaerator', G.dea.cx - G.dea.w / 2, G.dea.cy - G.dea.h / 2, G.dea.w, G.dea.h, () => s._tipPart('deaerator'));

        // 阀门
        this._valveDefs.forEach(v => {
            add(v.id, v.x - 13, v.y - 13, 26, 26, () => {
                if (v.local) s._local[v.local] = !s._local[v.local];
                else if (v.key) s._toggle(v.key);
            });
        });

        // 单向阀（只识别）
        this._checkDefs.forEach(c => add(c.id, c.x - 13, c.y - 13, 26, 26, () => {}));

        // 三通调节阀
        const V3 = G.v3w;
        add('rv-3way-inc', V3.cx - 13, V3.cy - 20, 26, 20, () => s._nudgeValve(5));
        add('rv-3way-dec', V3.cx - 13, V3.cy, 26, 20, () => s._nudgeValve(-5));
        add('rv-3way', V3.cx - 13, V3.cy - 20, 26, 40, () => s._tipPart('rv-3way'));
        add('rv-cooler', V3.cx - 13, V3.cy - 20, 26, 40, () => s._tipPart('rv-3way'));
        add('rv-bypass', V3.cx - 13, V3.cy - 20, 26, 40, () => s._tipPart('rv-3way'));

        // 泵

        add('panel1', G.panel2.x, G.panel2.y, G.panel2.w, G.panel2.h, () => s._tip('缸套冷却淡水泵操作盒：每台泵一行（起动 / 停止 / 手动-自动 转换开关）'));
        [['cw1', 0], ['cw2', 1]].forEach(([k, i]) => {
            const P = G.pumps[k];
            const PC = s._panelCols, ry = s._panelRows[i];
            add(k, P.cx - P.r, P.cy - P.r, P.r * 2, P.r * 2, () => s._togglePump(k));
            add(k + '-start', PC.start - 20, ry - 20, 40, 40, () => { if (s._solver()) s._solver().startPump(k); });
            add(k + '-stop', PC.stop - 20, ry - 20, 40, 40, () => { if (s._solver()) s._solver().stopPump(k); });
            add(k + '-mode', PC.knob - 23, ry - 23, 46, 46, () => {
                const sv = s._solver(); if (!sv) return;
                const p = sv.m.pumps[k];
                sv.setPumpMode(k, p.mode === 'AUTO' ? 'MAN' : 'AUTO');
            });
        });
        // 柴油机控制盒
        {
            const EK = s._engKnob;
            add('engine-start', EK.start.x - 14, EK.start.y - 14, 28, 28, () => {
                const sv = s._solver(); if (sv) sv.setEngine(!sv.m.engineSw);   // 按开关位置翻转
            });
            add('engine-load', EK.load.x - 14, EK.load.y - 14, 28, 28, () => {
                const sv = s._solver(); if (sv) s._tip(`柴油机负荷 ${(sv.m.load || 0).toFixed(0)} %：点击旋钮左半区减负荷、右半区加负荷`);
            });
            add('engine-load-dec', EK.load.x - 14, EK.load.y - 14, 14, 28, () => { const sv = s._solver(); if (sv) sv.stepLoad(-1); });
            add('engine-load-inc', EK.load.x, EK.load.y - 14, 14, 28, () => { const sv = s._solver(); if (sv) sv.stepLoad(1); });
        }

        // 仪表
        add('tt', G.tt.cx - G.tt.r, G.tt.cy - G.tt.r, G.tt.r * 2, G.tt.r * 2, () => s._tipPart('tt'));
        add('pt', G.gauge2.cx - 30, G.gauge2.cy - 30, 60, 60, () => s._tipPart('pt'));
        add('ps', G.ps.cx - G.ps.r, G.ps.cy - G.ps.r, G.ps.r * 2, G.ps.r * 2, () => s._tipPart('ps'));
        add('gauge', G.gauge1.cx - G.gauge1.r, G.gauge1.cy - G.gauge1.r, G.gauge1.r * 2, G.gauge1.r * 2, () => s._tipPart('gauge'));
    }

    /** 阀门开/关（静默切换，不弹浮动提示） */
    _toggle(key) {
        const sv = this._solver();
        if (!sv) return;
        if (!(key in sv.m.sw)) return;
        const sys = this.sys;
        const prev = sys ? sys._suppressComponentTips : false;
        if (sys) sys._suppressComponentTips = true;
        try { sv.toggleValve(key); } finally { if (sys) sys._suppressComponentTips = prev; }
    }

    _togglePump(k) {
        const sv = this._solver();
        if (!sv) return;
        const p = sv.m.pumps[k];
        if (p && p.run) sv.stopPump(k); else sv.startPump(k);
    }

    _mainMode(dir) {
        const sv = this._solver();
        if (!sv) return;
        const order = ['MAN', 'STOP', 'AUTO'];
        const cur = sv.m.pumps.cw1.mode;
        const i = Math.max(0, order.indexOf(cur));
        const n = Math.max(0, Math.min(order.length - 1, i + (dir > 0 ? 1 : -1)));
        if (n === i) return;
        ['cw1', 'cw2'].forEach(k => sv.setPumpMode(k, order[n]));
        this._tip(`缸套冷却淡水泵方式：${order[n]}`);
    }

    _nudgeValve(d) {
        const sv = this._solver();
        if (!sv) return;
        if (sv.autoActive()) { this._tip('自动控制中：三通阀开度由 PID 调节器给定，请先把 Ctrl 切到 MANU'); return; }
        sv.stepManip(d > 0 ? 1 : -1);
    }

    _tipPart(id) {
        const sv = this._solver() || (this._fallbackSolver = this._fallbackSolver || new CoolingWaterSolver(this.sys));
        const m = sv.m;
        const tips = {
            engine: `柴油机：${m.tripped ? '保护停车' : (m.engineOn ? '运转' : (m.engineSw ? '起动闭锁（PS 断开）' : '停车'))}，负荷 ${m.load.toFixed(0)} %；缸套水出口 ${m.temp.toFixed(1)} ℃`,
            heater: `缸套水加热器（M/E Jacket Water Heater）：${m.sw.wbV25S ? '进出口阀已开' : '进出口阀关闭'}，蒸汽阀${m.heatherOn ? '开（加热中）' : '关（无加热）'}`,
            distiller: `造水机（Fresh Water Generator）：用缸套水作热源加热海水。${(m.sw.wbV6S && m.sw.wbV7S) ? '进出口阀已开，投入运行' : '进出口阀关，未投运'}`,
            cooler: `高温淡水冷却器（HTFW Cooler）：缸套水被 LTFW 低温淡水冷却，淡水出水 ${sv.coolerOut().toFixed(1)} ℃`,
            tank: `膨胀水柜：容纳膨胀量并补水、除气；液位 ${m.tank.toFixed(0)} %`,
            deaerator: '除气柜（Deaerating Chamber）：分离缸套水中的空气与蒸汽',
            'rv-3way': `三通调节阀：冷却口实际开度 ${m.manip.toFixed(0)} %（0 % 全旁通，100 % 全经冷却器）`
                + (m.faults.valve ? `；调节阀卡涩，PID 输出已达 ${(m.outCmd != null ? m.outCmd : m.manip).toFixed(0)} %` : '，由 PID 面板给定'),
            tt: `TT 温度变送器（缸套水出口）：${m.faults.tt ? '读数失效（故障）' : m.tcMeas.toFixed(1) + ' ℃'}`,
            pt: `缸套水进机温度表（回水）：${sv.tankTemp().toFixed(1)} ℃（低于出口 ${m.temp.toFixed(1)} ℃）`,
            ps: `PS 压力开关：${m.psUp ? '冷却水压力正常' : '压力低——水流中断'}`
                + (!m.psUp && (m.autoTimer || 0) > 0.2 ? `（自动起动信号延时 ${(3 - m.autoTimer).toFixed(1)} s）` : '')
                + (m.autoLead && m.pumps[m.autoLead] ? `；自动运行机组：${m.pumps[m.autoLead].name}${m.pumps[m.autoLead].run ? '（运转中）' : '（待起动）'}` : ''),
            gauge: `缸套出口温度表（Cyl. Outlet）：${m.temp.toFixed(1)} ℃`,
        };
        this._tip(tips[id] || id);
    }

    // ═══════════════════════════════════════════════════════════
    //  显示同步
    // ═══════════════════════════════════════════════════════════
    _syncVisuals() {
        // 默认阀位（仅对真实过程模型生效一次）
        const svReal = this._solver();
        if (svReal && !this._appliedDefaults) {
            this._appliedDefaults = true;
            if ('wbV4' in svReal.m.sw) svReal.m.sw.wbV4 = true;        // 与预热器并联的截止阀：默认导通
            if ('wbV25S' in svReal.m.sw) svReal.m.sw.wbV25S = false;    // 预热器出口截止阀：默认关闭
        }
        const sv = svReal || (this._fallbackSolver = this._fallbackSolver || new CoolingWaterSolver(this.sys));
        const m = sv.m;
        const running = m.pumps.cw1.run || m.pumps.cw2.run;

        // 阀门颜色
        const setV = (v, on) => { if (!v) return; v.a.fill(on ? ON_COLOR : '#ffffff'); v.b.fill(on ? ON_COLOR : '#ffffff'); };
        const V = this._valves || {};
        setV(V['wb-v4'], m.sw.wbV4);
        setV(V['wb-v25s'], m.sw.wbV25S);
        setV(V['wb-v6s'], m.sw.wbV6S);
        setV(V['wb-v502'], m.sw.wbV502);
        setV(V['wb-v8'], m.sw.wbV8 !== false);
        setV(V['wb-v9'], m.sw.wbV9 !== false);
        setV(V['wb-v5'], m.sw.wbV5 !== false);
        setV(V['wb-fw'], this._local.makeUp);
        setV(V['wb-v13s'], this._local.drain);

        // 单向阀：进侧流通绿 / 出侧恒灰
        const CK = this._checks || {};
        if (CK['wb-v7s']) CK['wb-v7s'].in.fill((running && m.sw.wbV6S) ? ON_COLOR : '#ffffff');
        if (CK['wb-ck1']) CK['wb-ck1'].in.fill(m.pumps.cw1.run ? ON_COLOR : '#ffffff');
        if (CK['wb-ck2']) CK['wb-ck2'].in.fill(m.pumps.cw2.run ? ON_COLOR : '#ffffff');
        if (CK['wb-v12s']) CK['wb-v12s'].in.fill((m.psUp && m.sw.wbV502 !== false && m.manip > 3) ? ON_COLOR : '#ffffff');
        if (CK['wb-v27s']) CK['wb-v27s'].in.fill((m.psUp && m.sw.wbV27S !== false) ? ON_COLOR : '#ffffff');
        if (CK['wb-v15s']) CK['wb-v15s'].in.fill(m.psUp ? ON_COLOR : '#ffffff');

        // 管路着色
        // 柴油机停车时，管路按静态水温 60 ℃ 显示
        const tSrc = m.engineOn ? m.temp : 60;
        const tOut = fade(tempColor(tSrc), 0.6);
        const tRet = fade(tempColor(m.engineOn ? sv.tankTemp() : 60), 0.6);
        const tCool = fade(tempColor(m.engineOn ? sv.coolerOut() : 60), 0.6);
        const paint = (arr, color, op = 1) => (arr || []).forEach(n => { n.stroke(color); n.opacity(op); });
        paint(this._tint.main, tOut);
        paint(this._tint.mainR, tOut);
        paint(this._tint.fwgIn, tOut, (running && m.sw.wbV6S) ? 0.95 : 0.55);
        paint(this._tint.fwgOut, tOut, (running && m.sw.wbV6S) ? 0.95 : 0.55);
        paint(this._tint.coolIn, tOut, m.psUp ? 0.95 : 0.55);
        paint(this._tint.coolOut, tCool, m.psUp ? 0.95 : 0.55);
        paint(this._tint.bottom, tOut);
        paint(this._tint.hostIn, tOut);
        paint(this._tint.heatIn, tOut);
        paint(this._tint.heatOut, tOut);
        paint(this._tint.deaOut, tOut);
        paint(this._tint.pumpOut1, tOut);
        paint(this._tint.pumpOut2, tOut);
        paint(this._tint.pumpSuc, tOut);
        paint(this._tint.pumpSuc1, tOut);
        paint(this._tint.pumpSuc2, tOut);


        // 表针与读数
        const tvOut = Number.isFinite(sv.showValue()) ? sv.showValue() : m.temp;   // 缸套出口
        const tvIn = sv.tankTemp();                                               // 进机（回水）
        const ang = (t) => -135 + Math.max(0, Math.min(150, t)) / 150 * 270;
        if (this._needle1) this._needle1.rotation(ang(tvOut));
        if (this._needle2) this._needle2.rotation(ang(tvIn));
        if (this._digi1) this._digi1.text(m.faults.tt ? '***' : tvOut.toFixed(1));
        if (this._digi2) this._digi2.text(tvIn.toFixed(1));

        // 泵
        ['cw1', 'cw2'].forEach((k, i) => {
            const p = m.pumps[k];
            const fan = this._fans && this._fans[k];
            if (fan) fan.rotation((fan.rotation() - (p.run ? 14 : 0) + 360) % 360);
            const pf = this._pumpFill && this._pumpFill[k];
            if (pf) pf.fill(p.run ? '#d8f5d0' : '#f4f4f4');
            const lamp = this._btnLamps && this._btnLamps[i];
            if (lamp) {
                lamp.start.fill(p.run ? '#2ee82e' : '#1f7a1f');   // 电机运行：起钮亮绿
                lamp.stop.fill(p.run ? '#7d1a12' : '#e8281c');
            }
            const kn = this._modeKnobs && this._modeKnobs[i];
            if (kn) kn.rotation(p.mode === 'AUTO' ? 45 : -45);
        });
        // 缸内火焰（运转且未保护停车时燃烧、闪烁）
        if (this._flames) {
            const burning = !!m.engineOn && !m.tripped;
            this._flameT = (this._flameT || 0) + 1;
            this._flames.forEach((fg, i) => {
                fg.visible(burning);
                if (!burning) return;
                fg.scaleY(0.76 + 0.26 * Math.sin((this._flameT + i * 9) * 0.55));
                fg.scaleX(0.90 + 0.12 * Math.sin((this._flameT + i * 5) * 0.8));
                fg.opacity(0.82 + 0.15 * Math.sin((this._flameT + i * 13) * 0.7));
            });
        }
        if (this._crank) this._crank.rotation((this._crank.rotation() + ((m.tripped || !m.engineOn) ? 0 : (m.psUp ? 6 : 2))) % 360);
        if (this._engStartKnob) this._engStartKnob.rotation(m.engineSw ? 45 : -45);
        if (this._engLoadKnob) this._engLoadKnob.rotation(-135 + Math.max(0, Math.min(110, m.load || 0)) / 110 * 270);
        if (this._engStateTxt) {
            const run = !!m.engineOn && !m.tripped;
            const blocked = !!m.engineSw && !run && !m.tripped;
            this._engStateTxt.text(m.tripped ? '保护停车' : (run ? '运转' : (blocked ? '起动闭锁' : '停车')));
            this._engStateTxt.fill(run ? '#0b7a0b' : (blocked ? '#c07a00' : '#c62828'));
        }
        if (this._engLoadTxt) this._engLoadTxt.text(`${(m.load || 0).toFixed(0)} %`);

        // 水柜液位（补水阀开 → 上升；卸放阀开 → 下降）
        const T = this._geo.tank;
        if (this._local.makeUp) m.tank = Math.min(100, m.tank + 0.08);
        if (this._local.drain) m.tank = Math.max(0, m.tank - 0.08);
        if (this._tankLvl) {
            const hMax = T.h;
            this._tankLvl.height(Math.max(3, hMax * Math.max(0, Math.min(100, m.tank)) / 100));
            this._tankLvl.y(T.y + (hMax - this._tankLvl.height()));
        }
        if (this._lvlTxt) this._lvlTxt.text(`L ${m.tank.toFixed(1)}`);

        // 三通调节阀：东口（合流出口）常绿；西口填充深度 = 旁通开度；北口填充深度 = 冷却口开度（Ctrl）
        const v3 = this._v3;
        if (v3) {
            const V3 = this._geo.v3w, TA = 17;
            this._portFill(v3.east, V3.cx, V3.cy, V3.cx + TA, V3.cy, 1);
            this._portFill(v3.west, V3.cx, V3.cy, V3.cx - TA, V3.cy, (100 - m.manip) / 100);   // 西口 = 旁通口
            this._portFill(v3.north, V3.cx, V3.cy, V3.cx, V3.cy - TA, m.manip / 100);          // 北口 = 冷却口
            const powered = m.panelMain !== false;
            v3.coil.fill(powered ? '#e53935' : '#ffffff');
            v3.diag.stroke(powered ? '#ffdada' : '#666666');
        }
        if (this._rvBypassTxt) this._rvBypassTxt.text(`旁通开度 ${(100 - m.manip).toFixed(0)}%`);
        if (this._rvCoolTxt) this._rvCoolTxt.text(`冷却口开度 ${m.manip.toFixed(0)}%`);

        // PS 压力开关：闭合（压力正常）→ 绿色填充；断开（压力低）→ 不填充
        if (this._psCircle) this._psCircle.fill(m.psUp ? ON_COLOR : '#ffffff');

        // TEMP / Ctrl 显示窗（与 PID 调节器联动：AUTO 亮绿 / MANU 亮绿）
        if (this._tempVal) this._tempVal.text(m.faults.tt ? '***' : m.tcMeas.toFixed(2));
        if (this._ctrlVal) this._ctrlVal.text((m.outCmd != null ? m.outCmd : m.manip).toFixed(2));
        {
            const isAuto = m.mode === 'AUTO';
            if (this._autoBox) this._autoBox.fill(isAuto ? '#1f9a3a' : '#d9e6f5');
            if (this._manuBox) this._manuBox.fill(!isAuto ? '#1f9a3a' : '#d9e6f5');
            if (this._autoTxt) this._autoTxt.fill(isAuto ? '#ffffff' : '#333333');
            if (this._manuTxt) this._manuTxt.fill(!isAuto ? '#ffffff' : '#333333');
        }

        // 报警
        const act = m.alarms.filter(a => a.active);
        if (this._alarmTxt) {
            const trip = m.tripped ? `⚠ 主机保护停车：${m.tripCause}` : '';
            this._alarmTxt.text(act.length
                ? act.map(a => `● ${a.code} ${a.text}${a.ack ? '' : '（未确认）'}`).join('   ') + (trip ? `   ${trip}` : '')
                : trip);
        }

        // 流动
        this._flowPhase = (this._flowPhase + 2) % 16;   // 与 dash 周期 [9,7] 对齐，避免回跳抖动
        (this._flows || []).forEach(f => {
            let on = false;
            try { on = !!f.cond(m); } catch (e) { on = false; }
            f.node.opacity(on ? 0.95 : 0);
            if (on) {
                f.node.dashOffset(-this._flowPhase * (f.speed || 1));
                if (typeof f.w === 'function') f.node.strokeWidth(Math.max(0.8, f.w(m)));
            }
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
