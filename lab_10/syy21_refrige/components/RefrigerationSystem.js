import { BaseComponent } from './BaseComponent.js';

/**
 * RefrigerationSystem —— 制冷系统（整幅工艺流程，按参考图重绘）
 *
 * 关键造型：
 *   · 回热器：窄立式壳，右上斜口接回流制冷剂气体，右下斜口经「筒型气液分离筒」回压缩机入口；
 *   · 冷库制冷剂入口在【右上】（水平进入，非顶部）；
 *   · 库内电磁阀 = 上「线圈」+ 下「截止阀」形式；膨胀阀为特殊节流造型（区别于截止阀）；
 *   · 蒸发器内绘制风扇叶（离心叶轮）。
 *
 * 主管路（细线 + 箭头）：供液/回气/冷却水/滑油；库内为粗管路。
 */
export class RefrigerationSystem extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.W = 1250; this.H = 850;
        this.type = 'refrigeration_system';
        this.special = 'refrigerant';
        this.cache = 'fixed';

        this.THIN = '#ee5cee';
        this.MAG = '#e600e6';
        this.PUR = '#8e3fb5';
        this.WAT = '#2b7fc4';
        this.OIL = '#f2a30f';
        this.TW = 3;
        this.TK = 8;

        this.rooms = [
            { key: 'dry', name: '干货库', cx: 255 },
            { key: 'grain', name: '粮库', cx: 510 },
            { key: 'veg', name: '菜库', cx: 765 },
            { key: 'fish', name: '鱼库', cx: 1020 },
            { key: 'meat', name: '肉库', cx: 1275 },
        ];

        this._initGroups();
        this._drawTop();
        this._drawHeaders();
        this._drawLeftColumn();
        this._drawRooms();
        this._drawMachines();
        this._drawValves();
        this._drawTags();
        this._drawDynamic();
        this._registerParts();

        const s = 1250 / 1390;
        this.group.scale({ x: s, y: 850 / 945 });

        this.config = { id: this.id, width: this.W, height: this.H };
    }

    // ═══════════════════════════════════════════════════════
    // 绘制工具
    // ═══════════════════════════════════════════════════════

    _thin(pts, color, dash) { this._line(pts, color, this.TW, dash); }
    _thick(pts, color) { this._line(pts, color, this.TK); }

    _line(points, color, width, dash) {
        this._staticGroup.add(new Konva.Line({
            points, stroke: color, strokeWidth: width, lineCap: 'round', lineJoin: 'round',
            ...(dash ? { dash } : {}),
        }));
    }

    _text(x, y, w, s, size, fill, align, weight) {
        this._staticGroup.add(new Konva.Text({
            x, y, width: w || 0, text: s, fontSize: size || 12,
            fontStyle: weight ? 'bold' : 'normal', fill: fill || '#37474f',
            align: align || 'left', fontFamily: 'Arial',
        }));
    }

    _arrow(x, y, angle, color, size) {
        size = size || 6;
        const g = new Konva.Group({ x, y, rotation: angle });
        g.add(new Konva.Line({ points: [size, 0, -size * 0.8, -size * 0.9, -size * 0.8, size * 0.9], fill: color, stroke: color, strokeWidth: 1, closed: true }));
        this._staticGroup.add(g);
    }

    _flowArrow(x, y) {
        this._staticGroup.add(new Konva.Line({ points: [x - 18, y - 9, x - 18, y + 9, x, y, x - 18, y - 9], stroke: '#5aa9e6', strokeWidth: 3, fill: '#e8f3fb', closed: true }));
    }

    /** 方框交叉阀（蝶阀/电磁阀体） */
    _vSquare(x, y, color, s, rot) {
        s = s || 1; rot = rot || 0;
        const g = new Konva.Group({ x, y, rotation: rot });
        g.add(new Konva.Rect({ x: -11 * s, y: -11 * s, width: 22 * s, height: 22 * s, stroke: color, strokeWidth: 2, fill: '#ffffff' }));
        g.add(new Konva.Line({ points: [-11 * s, -11 * s, 11 * s, 11 * s], stroke: color, strokeWidth: 2 }));
        g.add(new Konva.Line({ points: [-11 * s, 11 * s, 11 * s, -11 * s], stroke: color, strokeWidth: 2 }));
        this._staticGroup.add(g);
    }

    /** 蝶形手阀 */
    _vHand(x, y, color, s, rot) {
        s = s || 1; rot = rot || 0;
        const g = new Konva.Group({ x, y, rotation: rot });
        g.add(new Konva.Line({ points: [-11 * s, -9 * s, -11 * s, 9 * s, 0, 0, -11 * s, -9 * s], fill: '#ffffff', stroke: color, strokeWidth: 2, closed: true }));
        g.add(new Konva.Line({ points: [11 * s, -9 * s, 11 * s, 9 * s, 0, 0, 11 * s, -9 * s], fill: '#ffffff', stroke: color, strokeWidth: 2, closed: true }));
        g.add(new Konva.Line({ points: [0, 0, 0, -15 * s], stroke: color, strokeWidth: 2 }));
        g.add(new Konva.Rect({ x: -6 * s, y: -20 * s, width: 12 * s, height: 6 * s, stroke: color, strokeWidth: 1.5, fill: '#ffffff' }));
        this._staticGroup.add(g);
    }

    /**
     * 电磁阀：上「线圈」+ 下「截止阀」（截止阀 = 矩形阀体 + 斜线）
     * rot：0=水平管 90=垂直管
     */
    _vSolenoid(x, y, color, s, rot) {
        s = s || 1; rot = rot || 0;
        const g = new Konva.Group({ x, y, rotation: rot });
        // 阀体（截止阀：矩形 + 斜线）
        g.add(new Konva.Rect({ x: -12 * s, y: -8 * s, width: 24 * s, height: 16 * s, fill: '#ffffff', stroke: color, strokeWidth: 2, cornerRadius: 2 }));
        g.add(new Konva.Line({ points: [-12 * s, 8 * s, 12 * s, -8 * s], stroke: color, strokeWidth: 2 }));
        // 阀杆
        g.add(new Konva.Line({ points: [0, -8 * s, 0, -18 * s], stroke: color, strokeWidth: 2 }));
        // 线圈
        g.add(new Konva.Rect({ x: -10 * s, y: -34 * s, width: 20 * s, height: 16 * s, fill: '#ffffff', stroke: color, strokeWidth: 2, cornerRadius: 2 }));
        for (let i = 0; i < 3; i++) g.add(new Konva.Line({ points: [-7 * s, (-30 + i * 5) * s, 7 * s, (-30 + i * 5) * s], stroke: color, strokeWidth: 1.2 }));
        this._staticGroup.add(g);
    }

    /** 膨胀阀（特殊节流造型：顶杆 + 下向三角节流口 + 感温包） */
    _vExp(x, y) {
        const c = '#1565c0';
        const g = new Konva.Group({ x, y });
        // 顶部横杆
        g.add(new Konva.Line({ points: [-13, -12, 13, -12], stroke: c, strokeWidth: 2 }));
        // 下向三角（节流口）
        g.add(new Konva.Line({ points: [-13, -12, 13, -12, 0, 10, -13, -12], fill: '#ffffff', stroke: c, strokeWidth: 2, closed: true }));
        // 感温包（小圆）
        g.add(new Konva.Circle({ x: 0, y: -22, radius: 5, fill: '#ffffff', stroke: c, strokeWidth: 2 }));
        g.add(new Konva.Line({ points: [0, -17, 0, -12], stroke: c, strokeWidth: 2 }));
        // Exp 标牌
        g.add(new Konva.Rect({ x: -20, y: -44, width: 40, height: 14, fill: '#1565c0', stroke: '#0d47a1', strokeWidth: 1, cornerRadius: 2 }));
        g.add(new Konva.Text({ x: -20, y: -42, width: 40, text: 'Exp', fontSize: 11, fontStyle: 'bold', fill: '#ffffff', align: 'center' }));
        this._staticGroup.add(g);
    }

    _tube(x, y, w, h, vertical) {
        const g = this._staticGroup;
        g.add(new Konva.Rect({ x, y, width: w, height: h, fill: '#c2c8ce', stroke: '#6d747a', strokeWidth: 2, cornerRadius: vertical ? w / 2 : h / 2 }));
        g.add(new Konva.Rect({ x: x + 3, y: y + 3, width: vertical ? w - 6 : w * 0.5, height: vertical ? h * 0.5 : h - 6, fill: 'rgba(255,255,255,0.28)', cornerRadius: 4 }));
    }

    /** 风扇叶（离心叶轮：多片弯叶 + 轮毂） */
    _fan(cx, cy, r, group) {
        const g = group || this._staticGroup;
        const n = 11;
        for (let i = 0; i < n; i++) {
            g.add(new Konva.Path({
                x: cx, y: cy, rotation: (360 / n) * i,
                data: `M 0 -5 Q ${r * 0.55} ${-r * 0.38} ${r * 0.62} ${-r * 0.98} Q ${r * 0.34} ${-r * 0.72} 0 -5 Z`,
                fill: '#8a9aa0', stroke: '#5b727a', strokeWidth: 1,
            }));
        }
        g.add(new Konva.Circle({ x: cx, y: cy, radius: r * 0.30, fill: '#5b727a', stroke: '#3d525a', strokeWidth: 1 }));
    }

    // ═══════════════════════════════════════════════════════
    // 顶部
    // ═══════════════════════════════════════════════════════

    _drawTop() {
        this._staticGroup.add(new Konva.Rect({ x: 30, y: 15, width: 100, height: 41, fill: '#f4f6f7', stroke: '#7f8c8d', strokeWidth: 1.5 }));
        this._text(30, 27, 100, '控制器', 13, '#2c3e50', 'center', true);
        this._text(1240, 16, 130, 'Instruction', 12, '#546e7a', 'right', true);

        this._line([132, 34, 1360, 34], '#95a5a6', 1.5, [7, 4]);
        this._line([132, 50, 1360, 50], '#95a5a6', 1.5, [7, 4]);
        this._line([30, 50, 18, 50, 18, 560, 45, 560], '#95a5a6', 1.5, [7, 4]);

        // 供液主管（细线 + 箭头）：自回热器顶部直接往右
        this._thin([58, 72, 1370, 72], this.THIN);
        [120, 380, 640, 900, 1160].forEach(x => this._arrow(x, 72, 0, this.THIN, 6));
    }

    // ═══════════════════════════════════════════════════════
    // 回气总管（细线 + 箭头）
    // ═══════════════════════════════════════════════════════

    _drawHeaders() {
        this._thin([110, 360, 1370, 360], this.THIN);
        [200, 460, 720, 980, 1240].forEach(x => this._arrow(x, 360, 0, this.THIN, 6));
        // 二号管路（压缩机排出，细线）
        this._thin([95, 455, 1370, 455], this.THIN);
        [230, 620, 1000, 1300].forEach(x => this._arrow(x, 455, 0, this.THIN, 6));
    }

    // ═══════════════════════════════════════════════════════
    // 左列：回热器（窄长壳 + 上下法兰 + 右上/右下斜口）+ 气液分离筒
    // ═══════════════════════════════════════════════════════

    _drawLeftColumn() {
        const g = this._staticGroup, M = this.MAG;

        // ── 回热器：高瘦窄壳（上下对称）──
        this._tube(40, 130, 40, 165, true);
        // 内部折流填料（斜向短筋）
        for (let i = 0; i < 8; i++) {
            const y = 150 + i * 18;
            g.add(new Konva.Line({ points: [46, y, 74, y + 6], stroke: '#8e3fb5', strokeWidth: 2.5 }));
        }
        g.add(new Konva.Rect({ x: 33, y: 121, width: 54, height: 9, fill: '#8d9298', stroke: '#5f656b', strokeWidth: 1.5 }));
        g.add(new Konva.Rect({ x: 33, y: 295, width: 54, height: 9, fill: '#8d9298', stroke: '#5f656b', strokeWidth: 1.5 }));
        // 上、下对称法兰连接块
        g.add(new Konva.Rect({ x: 36, y: 109, width: 48, height: 12, fill: '#a8adb3', stroke: '#5f656b', strokeWidth: 1.5, cornerRadius: 3 }));
        g.add(new Konva.Rect({ x: 36, y: 304, width: 48, height: 12, fill: '#a8adb3', stroke: '#5f656b', strokeWidth: 1.5, cornerRadius: 3 }));
        // 右上斜口（回流的制冷剂气体入口）
        this._line([80, 150, 100, 143], M, 7);
        // 右下斜口（经气液分离筒回压缩机入口）
        this._line([80, 274, 98, 282], M, 7);
        this._text(20, 106, 100, '回热器', 13, '#37474f', 'center', true);

        // ── 气液分离筒（筒型）──
        this._tube(130, 385, 72, 95, true);
        g.add(new Konva.Rect({ x: 136, y: 392, width: 60, height: 12, fill: '#8d9298', cornerRadius: 3 }));
        g.add(new Konva.Rect({ x: 136, y: 464, width: 60, height: 12, fill: '#8d9298', cornerRadius: 3 }));
        this._text(208, 420, 110, '气液分离筒', 12, '#37474f', 'left', true);

        // ── 视液镜 / 干燥&过滤 / 接收器 ──
        g.add(new Konva.Circle({ x: 48, y: 560, radius: 30, fill: '#b8bcc0', stroke: '#5f656b', strokeWidth: 2 }));
        g.add(new Konva.Circle({ x: 48, y: 560, radius: 15, fill: '#16a085', stroke: '#0e6655', strokeWidth: 2 }));

        this._tube(35, 660, 55, 90, true);
        for (let i = 0; i < 4; i++) g.add(new Konva.Line({ points: [42, 674 + i * 20, 83, 674 + i * 20], stroke: '#90a4ae', strokeWidth: 3 }));
        this._text(-5, 754, 135, '干燥&过滤', 12, '#37474f', 'center', true);

        this._tube(210, 790, 70, 115, true);
        this._text(190, 908, 130, '接收器', 12, '#37474f', 'center', true);

        // ── 管路 ──
        // 液体：接收器 → 干燥 → 回热器底（下进）
        this._thin([245, 905, 245, 930, 58, 930, 58, 660], M);
        this._thin([58, 660, 58, 304], M);
        // 回热器顶（上出）→ 直接往右接供液主管
        this._thin([58, 109, 58, 72], this.THIN);
        // 回气总管 → 回热器右上斜口（入口，进线右移 10px）
        this._thin([100, 143, 120, 143, 120, 360], this.THIN);
        // 回热器右下斜口 → 气液分离筒 → 压缩机入口
        this._thin([98, 282, 108, 282, 108, 385, 166, 385], M);
        this._thin([166, 480, 166, 590, 150, 590], this.THIN);
        this._thin([166, 590, 830, 590, 830, 490], this.THIN);
    }

    // ═══════════════════════════════════════════════════════
    // 冷库
    // ═══════════════════════════════════════════════════════

    _drawRooms() {
        const g = this._staticGroup, M = this.MAG, P = this.PUR;
        this.rooms.forEach(r => {
            const x0 = r.cx - 110, y0 = 80, w = 220, h = 250;
            g.add(new Konva.Rect({ x: x0, y: y0, width: w, height: h, fill: '#cdeef2', stroke: '#5b8a92', strokeWidth: 1.6, cornerRadius: 4 }));
            this._text(x0, y0 + 6, w, r.name, 15, '#0d47a1', 'center', true);

            // 控制虚线（左：温度开关；右：供液电磁阀）
            this._line([x0 + 48, 34, x0 + 48, y0 + 30], '#95a5a6', 1.5, [6, 4]);
            this._line([x0 + 152, 50, x0 + 152, y0 + 18], '#95a5a6', 1.5, [6, 4]);
            g.add(new Konva.Circle({ x: x0 + 48, y: y0 + 36, radius: 6, fill: '#ecf0f1', stroke: '#7f8c8d', strokeWidth: 2 }));
            g.add(new Konva.Line({ points: [x0 + 48, y0 + 42, x0 + 48, y0 + 50], stroke: '#7f8c8d', strokeWidth: 2 }));

            // 制冷剂入口在【右上】：自右侧水平进入 → 供液电磁阀 → Exp
            this._thin([x0 + 165, 72, x0 + 165, y0 + 46], this.THIN);
            this._thick([x0 + 165, y0 + 46, x0 + 33, y0 + 46], M);
            this._vExp(x0 + 33, y0 + 46);
            // Exp → 左 → 下（沿库左侧）
            this._thick([x0 + 33, y0 + 46, x0 + 14, y0 + 46, x0 + 14, y0 + 215], M);
            // 折向蒸发器（紫支管，贯穿蒸发器）
            this._thick([x0 + 14, y0 + 100, x0 + 80, y0 + 100, x0 + 80, y0 + 215], P);
            // 出口汇合 → 底部 → 回气电磁阀 → 回气总管
            this._thick([x0 + 14, y0 + 215, x0 + 95, y0 + 215], M);
            this._thick([x0 + 95, y0 + 215, x0 + 95, y0 + 290], M);
            this._thin([x0 + 95, y0 + 290, x0 + 95, 360], this.THIN);

            // 蒸发器外壳 + 除霜加热线
            g.add(new Konva.Rect({ x: x0 + 78, y: y0 + 100, width: 95, height: 85, fill: '#f3f6f7', stroke: '#7aa7b0', strokeWidth: 1.4, cornerRadius: 4 }));
            this._text(x0 + 78, y0 + 100, 95, '蒸发器', 12, '#37474f', 'center', true);
            g.add(new Konva.Line({
                points: [x0 + 16, y0 + 196, x0 + 38, y0 + 190, x0 + 60, y0 + 198, x0 + 82, y0 + 190, x0 + 104, y0 + 198, x0 + 126, y0 + 190, x0 + 148, y0 + 198, x0 + 170, y0 + 190, x0 + 192, y0 + 196],
                stroke: '#f1c40f', strokeWidth: 3,
            }));
        });
    }

    // ═══════════════════════════════════════════════════════
    // 动力设备
    // ═══════════════════════════════════════════════════════

    _drawCompressor(x, y) {
        const g = this._staticGroup, w = 300, h = 130;
        g.add(new Konva.Rect({ x, y, width: w, height: h, fill: '#b8bcc0', stroke: '#6d747a', strokeWidth: 2, cornerRadius: 6 }));
        g.add(new Konva.Rect({ x: x + 12, y: y + 26, width: 150, height: 78, fill: '#9aa0a6', stroke: '#5f656b', strokeWidth: 2, cornerRadius: 8 }));
        for (let i = 0; i < 6; i++) g.add(new Konva.Line({ points: [x + 22 + i * 22, y + 32, x + 22 + i * 22, y + 98], stroke: '#7f858b', strokeWidth: 3 }));
        g.add(new Konva.Rect({ x: x + 172, y: y + 16, width: 116, height: 98, fill: '#8d9298', stroke: '#5f656b', strokeWidth: 2, cornerRadius: 8 }));
        g.add(new Konva.Rect({ x: x + 182, y: y + 32, width: 30, height: 72, fill: '#20262b', stroke: '#111', strokeWidth: 2, cornerRadius: 3 }));
        [0, 50, 100].forEach(v => this._text(x + 216, y + 32 + (100 - v) * 0.72 - 5, 20, String(v), 8, '#37474f', 'left'));
    }

    _drawOilSeparator(x, y) {
        const g = this._staticGroup, w = 55, h = 115;
        this._tube(x, y, w, h, true);
        g.add(new Konva.Rect({ x: x + 5, y: y + 5, width: w - 10, height: 22, fill: '#8d9298', cornerRadius: 5 }));
        g.add(new Konva.Rect({ x: x + w / 2 - 12, y: y + 12, width: 24, height: 88, fill: '#20262b', stroke: '#111', strokeWidth: 1.5, cornerRadius: 3 }));
    }

    _drawCondenser(x, y, w, h) {
        const g = this._staticGroup;
        g.add(new Konva.Rect({ x, y, width: w, height: h, fill: '#b0b6bc', stroke: '#5f656b', strokeWidth: 2, cornerRadius: 26 }));
        g.add(new Konva.Rect({ x: x - 8, y: y + 14, width: 18, height: h - 28, fill: '#8d9298', stroke: '#5f656b', strokeWidth: 1.5, cornerRadius: 4 }));
        g.add(new Konva.Rect({ x: x + w - 10, y: y + 14, width: 18, height: h - 28, fill: '#8d9298', stroke: '#5f656b', strokeWidth: 1.5, cornerRadius: 4 }));
        g.add(new Konva.Rect({ x: x + w / 2 - 32, y: y - 26, width: 64, height: 30, fill: '#b0b6bc', stroke: '#5f656b', strokeWidth: 2, cornerRadius: 6 }));
        g.add(new Konva.Rect({ x: x + w / 2 - 32, y: y + h - 4, width: 64, height: 30, fill: '#b0b6bc', stroke: '#5f656b', strokeWidth: 2, cornerRadius: 6 }));
    }

    _drawMachines() {
        const M = this.MAG, TH = this.THIN;
        this._drawCompressor(150, 555);
        this._text(150, 536, 300, '一号压缩机', 13, '#2c3e50', 'center', true);
        this._drawCompressor(800, 490);
        this._text(800, 471, 300, '二号压缩机', 13, '#2c3e50', 'center', true);

        this._drawOilSeparator(435, 450);
        this._text(500, 458, 200, '一号油液分离器', 12, '#37474f', 'left', true);
        this._drawOilSeparator(1070, 440);
        this._text(1135, 448, 200, '二号油液分离器', 12, '#37474f', 'left', true);

        this._drawCondenser(395, 680, 250, 100);
        this._text(270, 715, 120, '一号冷凝器', 13, '#2c3e50', 'center', true);
        this._drawCondenser(1150, 665, 220, 100);
        this._text(1170, 786, 160, '二号冷凝器', 13, '#2c3e50', 'center', true);

        this._flowArrow(410, 855);
        this._flowArrow(1370, 800);

        this._thin([300, 555, 300, 500, 435, 500], TH);
        this._thin([435, 565, 435, 610, 470, 610, 470, 680], TH);
        this._thin([950, 490, 950, 450, 1070, 450], TH);
        this._thin([1070, 555, 1070, 620, 1110, 620, 1110, 665], TH);
        this._thin([300, 685, 300, 740, 360, 740, 360, 660, 420, 660], this.OIL);
        this._thin([900, 620, 900, 700, 980, 700, 980, 640], this.OIL);
        this._thin([470, 780, 470, 855, 280, 855, 280, 790], M);
        this._thin([1260, 765, 1260, 870, 500, 870, 500, 850], M);

        this._thin([395, 780, 300, 780, 300, 900, 700, 900], this.WAT);
        this._thin([645, 780, 700, 780, 700, 900], this.WAT);
        this._thin([1150, 765, 1050, 765, 1050, 900], this.WAT);
        this._thin([1370, 765, 1400, 765, 1400, 900, 900, 900], this.WAT);
        this._thin([470, 745, 470, 780], this.WAT);
        this._thin([1260, 730, 1260, 765], this.WAT);
    }

    // ═══════════════════════════════════════════════════════
    // 阀门
    // ═══════════════════════════════════════════════════════

    _drawValves() {
        const M = this.MAG, P = this.PUR, O = this.OIL, W = this.WAT, BL = '#37474f';

        // 库内：供液电磁阀 / 旁通阀 / 回气电磁阀
        this.rooms.forEach(r => {
            const x0 = r.cx - 110, y0 = 80;
            this._vSolenoid(x0 + 135, y0 + 46, BL, 0.85, 0);      // 供液电磁阀（线圈+截止阀，水平）
            this._vHand(x0 + 14, y0 + 78, P, 0.9, 90);             // 左管手阀（垂直）
            this._vSolenoid(x0 + 95, y0 + 250, BL, 0.85, 90);      // 回气电磁阀（垂直）
        });

        this._vHand(18, 500, M, 1, 90);
        this._vHand(62, 470, P, 1, 90);
        this._vHand(62, 610, P, 1, 90);
        this._vSquare(300, 360, P, 1, 0);
        this._vSquare(700, 360, P, 1, 0);
        this._vSquare(300, 455, P, 1, 0);
        this._vSquare(620, 455, P, 1, 0);
        this._vSquare(870, 455, P, 1, 0);
        this._vHand(160, 855, P, 1, 0);
        this._vHand(160, 915, P, 1, 0);
        this._vHand(360, 500, M, 1, 0);
        this._vHand(1010, 450, M, 1, 0);
        this._vHand(330, 740, O, 1, 0);
        this._vHand(360, 660, O, 1, 90);
        this._vHand(940, 700, O, 1, 0);
        this._vHand(340, 780, W, 1, 0);
        this._vHand(300, 850, W, 1, 90);
        this._vHand(670, 780, W, 1, 0);
        this._vHand(700, 850, W, 1, 90);
        this._vHand(1090, 765, W, 1, 0);
        this._vHand(1050, 850, W, 1, 90);
        this._vHand(1400, 850, W, 1, 90);
    }

    _drawTags() {
        this._text(120, 350, 90, 'P 0.40', 12, '#1565c0', 'left', true);
        this._text(250, 445, 90, 'P 0.30', 12, '#1565c0', 'left', true);
        this._text(380, 445, 90, 'P 11.00', 12, '#1565c0', 'left', true);
        this._text(860, 445, 90, 'P 0.30', 12, '#1565c0', 'left', true);
        this._text(990, 445, 90, 'P 11.00', 12, '#1565c0', 'left', true);
        this._text(660, 758, 90, 'T 36.1', 12, '#1565c0', 'left', true);
        this._text(1185, 744, 90, 'T 36.1', 12, '#1565c0', 'left', true);
        this._text(560, 806, 90, 'G 3.5', 12, '#1565c0', 'left', true);
        this._text(1050, 786, 90, 'G 3.5', 12, '#1565c0', 'left', true);
        this._text(620, 892, 160, '自低温冷却淡水系统', 12, '#1565c0', 'center', true);
        this._text(820, 892, 160, '至低温冷却淡水系统', 12, '#1565c0', 'center', true);
        this._text(700, 862, 180, 'T 36.1  P 2.6', 12, '#1565c0', 'center', true);
        const badge = (x, y, t) => {
            this._staticGroup.add(new Konva.Rect({ x, y, width: 26, height: 18, fill: '#2e7d32', stroke: '#1b5e20', strokeWidth: 1, cornerRadius: 2 }));
            this._text(x, y + 1, 26, t, 11, '#ffffff', 'center', true);
        };
        badge(630, 870, '31');
        badge(890, 730, '31');
        badge(1290, 330, '63');
    }

    // ═══════════════════════════════════════════════════════
    // 动态节点
    // ═══════════════════════════════════════════════════════

    _drawDynamic() {
        const d = this._dynamicGroup;
        this._roomNodes = [];
        this.rooms.forEach(r => {
            const x0 = r.cx - 110, y0 = 80;
            const fan = new Konva.Group({ x: x0 + 118, y: y0 + 142 });
            fan.add(new Konva.Circle({ radius: 40, fill: '#d9e6ea', stroke: '#4a7c86', strokeWidth: 2 }));
            const n = 12;
            for (let i = 0; i < n; i++) {
                fan.add(new Konva.Path({
                    x: 0, y: 0, rotation: (360 / n) * i,
                    data: 'M 0 -4 C 13 -8 20 -18 19 -31 C 10 -24 3 -13 0 -4 Z',
                    fill: '#8a9aa0', stroke: '#5b727a', strokeWidth: 1,
                }));
            }
            fan.add(new Konva.Circle({ radius: 9, fill: '#5b727a', stroke: '#3d525a', strokeWidth: 1 }));
            d.add(fan);
            const green = new Konva.Circle({ x: x0 + 198, y: y0 + 112, radius: 14, fill: '#0b3d0b', stroke: '#08300b', strokeWidth: 2 });
            const red = new Konva.Circle({ x: x0 + 198, y: y0 + 148, radius: 14, fill: '#3d0b0b', stroke: '#300808', strokeWidth: 2 });
            const tText = new Konva.Text({ x: x0 + 95, y: y0 + 68, width: 120, text: 'T --.--', fontSize: 14, fontStyle: 'bold', fill: '#102a43', fontFamily: 'monospace' });
            const zText = new Konva.Text({ x: x0 + 95, y: y0 + 88, width: 120, text: 'Z 0.00', fontSize: 14, fontStyle: 'bold', fill: '#102a43', fontFamily: 'monospace' });
            d.add(green, red, tText, zText);
            this._roomNodes.push({ fan, green, red, tText, zText, key: r.key });
        });

        this._oil1 = new Konva.Rect({ x: 332, y: 588, width: 30, height: 72, fill: '#f2a30f', cornerRadius: 2 });
        this._run1 = new Konva.Circle({ x: 545, y: 598, radius: 12, fill: '#0b3d0b', stroke: '#08300b', strokeWidth: 2 });
        d.add(this._oil1, this._run1);
        this._oil2 = new Konva.Rect({ x: 982, y: 522, width: 30, height: 72, fill: '#f2a30f', cornerRadius: 2 });
        this._run2 = new Konva.Circle({ x: 1195, y: 532, radius: 12, fill: '#0b3d0b', stroke: '#08300b', strokeWidth: 2 });
        d.add(this._oil2, this._run2);

        this._os1 = new Konva.Rect({ x: 462, y: 462, width: 16, height: 84, fill: '#f2a30f', cornerRadius: 2 });
        this._os2 = new Konva.Rect({ x: 1097, y: 452, width: 16, height: 84, fill: '#f2a30f', cornerRadius: 2 });
        d.add(this._os1, this._os2);

        this._recv = new Konva.Rect({ x: 214, y: 796, width: 62, height: 104, fill: '#2196f3', cornerRadius: 12 });
        this._recvText = new Konva.Text({ x: 214, y: 842, width: 62, text: '30', fontSize: 18, fontStyle: 'bold', fill: '#ffffff', align: 'center', fontFamily: 'monospace' });
        d.add(this._recv, this._recvText);

        this._cond1T = new Konva.Text({ x: 400, y: 715, width: 240, text: 'T 30.2', fontSize: 16, fontStyle: 'bold', fill: '#1b5e20', align: 'center', fontFamily: 'monospace' });
        this._cond2T = new Konva.Text({ x: 1145, y: 700, width: 230, text: 'T 30.2', fontSize: 16, fontStyle: 'bold', fill: '#1b5e20', align: 'center', fontFamily: 'monospace' });
        d.add(this._cond1T, this._cond2T);
    }

    _registerParts() {
        this.addClickablePart('comp1', 150, 555, 300, 130);
        this.addClickablePart('comp2', 800, 490, 300, 130);
        this.rooms.forEach(r => this.addClickablePart('evap-' + r.key, r.cx - 32, 180, 95, 85));
        this.addClickablePart('cond1', 395, 680, 250, 100);
        this.addClickablePart('cond2', 1150, 665, 220, 100);
        this.addClickablePart('regen', 33, 109, 54, 207);
        this.addClickablePart('oilsep_acc', 112, 400, 56, 110);
        this.addClickablePart('receiver', 210, 790, 70, 115);
        this.addClickablePart('dryer', 35, 660, 55, 90);
    }

    // ═══════════════════════════════════════════════════════
    // 求解器回写
    // ═══════════════════════════════════════════════════════

    acceptModel(m) {
        this._roomNodes.forEach(rn => {
            const r = m.rooms && m.rooms[rn.key];
            if (!r) return;
            rn.tText.text('T ' + r.temp.toFixed(2));
            rn.zText.text('Z ' + (r.valve !== undefined ? r.valve.toFixed(2) : '0.00'));
            rn.green.fill(r.cooling ? '#00e83a' : '#0b3d0b');
            rn.red.fill(r.alarm ? '#ff2020' : '#3d0b0b');
        });

        const c1 = m.comps && m.comps.comp1, c2 = m.comps && m.comps.comp2;
        if (c1) { this._run1.fill(c1.running ? '#00e83a' : '#0b3d0b'); const h = 72 * (c1.oilLevel / 100); this._oil1.height(h); this._oil1.y(660 - h); }
        if (c2) { this._run2.fill(c2.running ? '#00e83a' : '#0b3d0b'); const h = 72 * (c2.oilLevel / 100); this._oil2.height(h); this._oil2.y(594 - h); }
        if (m.oilsep) {
            const h1 = 84 * ((m.oilsep.comp1 || 0) / 100);
            this._os1.height(Math.max(4, h1)); this._os1.y(546 - Math.max(4, h1));
            const h2 = 84 * ((m.oilsep.comp2 || 0) / 100);
            this._os2.height(Math.max(4, h2)); this._os2.y(536 - Math.max(4, h2));
        }
        if (m.receiver !== undefined) {
            const h = 104 * (m.receiver / 100);
            this._recv.height(h); this._recv.y(900 - h);
            this._recvText.text(String(Math.round(m.receiver)));
        }
        if (this._cond1T) this._cond1T.text('T ' + (m.running ? m.tc : m.tcwIn).toFixed(1));
        if (this._cond2T) this._cond2T.text('T ' + (m.running ? m.tc : m.tcwIn).toFixed(1));
    }

    tick(dt) {
        const m = this.sys && this.sys.refrigSolver ? this.sys.refrigSolver.m : null;
        this._roomNodes && this._roomNodes.forEach(rn => {
            const r = m && m.rooms && m.rooms[rn.key];
            if (r && r.cooling) rn.fan.rotation((rn.fan.rotation() + 240 * dt) % 360);
        });
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

export default RefrigerationSystem;
