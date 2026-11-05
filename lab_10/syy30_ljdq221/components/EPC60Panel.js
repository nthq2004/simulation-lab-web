import Konva from 'konva';
import { BaseComponent } from './BaseComponent.js';

/**
 * EPC60Panel — Alfa Laval EPC-60 分油机控制器面板（按实船面板重绘）
 *
 * 外观：浅蓝色外壳 + 灰色 EPC 面板 + 绿色 LCD + 数字键盘 + 功能图标键；
 * 下方：电源开关、应急停止、电流表。
 *
 * 保留对工作流公开的 part id：
 *  separation / stop / discharge / alarm-reset / info / enter / plus / minus / power
 * 新增：key-0~9、key-dot、key-back、cip、system、emergency
 */
export class EPC60Panel extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.W = Math.max(620, config.width || 680);
        this.H = Math.max(680, config.height || 730);
        this.type = 'epc60_panel';
        this.special = 'epc60';
        this.cache = 'fixed';

        this._ui = {
            page: 'main', menu: 0, param: 0, editing: false,
            editKey: null, editVal: 0, editStr: '', alarm: 0, info: 0,
            menuOpen: false,        // 菜单是否展开（由「返回」键切换）
            question: false,        // 启动前置问题（START_QUESTIONS）
            asked: false,           // 是否已回答过启动问题
            answer: 'YES',          // 闪烁选项：YES / NO
        };

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
            face: { x: 12, y: 12, w: W - 24, h: 512, r: 9 },
            logo: { cx: 205, cy: 40 },
            title: { x: 64, y: 84 },
            lcd: { x: 40, y: 118, w: 370, h: 136 },
            keys: { x: 440, y: 56, w: 58, h: 52, gapX: 8, gapY: 14 },
            io: {
                start: { x: 40, y: 342, w: 58, h: 54 },
                stop: { x: 40, y: 410, w: 58, h: 54 },
            },
            fn: { s: 54, colX: [128, 198, 292, 362], rowY: [342, 410] },
            plateA: { x: 122, y: 336, w: 138, h: 134 },
            nav: {
                back: { x: 442, y: 380, w: 54, h: 54 },
                up: { x: 508, y: 342, w: 54, h: 54 },
                down: { x: 508, y: 410, w: 54, h: 54 },
                info: { x: 574, y: 380, w: 54, h: 54 },
            },
            power: { cx: 110, cy: 612, R: 40 },
            emergency: { cx: 265, cy: 612, r: 40 },
            ammeter: { x: 420, y: 550, w: 170, h: 128 },
        };
    }

    _label(g, x, y, text, size = 13, fill = '#263238', bold = false, align = 'left', width = 0) {
        const opts = {
            x, y, text, fontSize: size,
            fontStyle: bold ? 'bold' : 'normal',
            fill, align, fontFamily: 'Arial, "Microsoft YaHei", sans-serif',
        };
        if (width) opts.width = width;
        g.add(new Konva.Text(opts));
    }

    /** 白色按键 */
    _whiteKey(g, x, y, w, h, r = 8) {
        g.add(new Konva.Rect({
            x, y, width: w, height: h, cornerRadius: r,
            fill: '#fbfbfb', stroke: '#2f2f2f', strokeWidth: 1.6,
        }));
    }

    // ── 功能键图标 ──────────────────────────────────────────
    _iconDisplay(g, cx, cy, s = 32) {
        const w = s * 1.15, h = s * 0.80;
        g.add(new Konva.Rect({ x: cx - w / 2, y: cy - h / 2, width: w, height: h, stroke: '#222', strokeWidth: 2, cornerRadius: 2 }));
        g.add(new Konva.Line({
            points: [cx - w * 0.34, cy + h * 0.24, cx - w * 0.10, cy - h * 0.10, cx + w * 0.08, cy + h * 0.12, cx + w * 0.34, cy - h * 0.24],
            stroke: '#222', strokeWidth: 2, lineJoin: 'round',
        }));
    }

    _iconSeparator(g, cx, cy, s = 32) {         // 分油机（分离筒）符号
        const r = s * 0.46;
        g.add(new Konva.Arc({ x: cx, y: cy + s * 0.06, innerRadius: r * 0.32, outerRadius: r, angle: 180, rotation: 180, fill: '#ffffff', stroke: '#222', strokeWidth: 2 }));
        g.add(new Konva.Line({ points: [cx - r, cy + s * 0.06, cx + r, cy + s * 0.06], stroke: '#222', strokeWidth: 2 }));
        g.add(new Konva.Line({ points: [cx - r * 0.7, cy + s * 0.06, cx - r * 0.7, cy + s * 0.30], stroke: '#222', strokeWidth: 2 }));
        g.add(new Konva.Line({ points: [cx + r * 0.7, cy + s * 0.06, cx + r * 0.7, cy + s * 0.30], stroke: '#222', strokeWidth: 2 }));
        g.add(new Konva.Line({ points: [cx - r * 0.95, cy + s * 0.30, cx + r * 0.95, cy + s * 0.30], stroke: '#222', strokeWidth: 2 }));
        g.add(new Konva.Line({ points: [cx, cy - s * 0.36, cx, cy - s * 0.08], stroke: '#222', strokeWidth: 2 }));
    }

    _iconPump(g, cx, cy, s = 32) {              // 泵（圆内三角）
        g.add(new Konva.Circle({ x: cx, y: cy, radius: s * 0.42, stroke: '#222', strokeWidth: 2 }));
        g.add(new Konva.Line({ points: [cx - s * 0.13, cy - s * 0.17, cx + s * 0.20, cy, cx - s * 0.13, cy + s * 0.17], closed: true, fill: '#ffffff', stroke: '#222', strokeWidth: 2 }));
    }

    _iconProcess(g, cx, cy, s = 32) {           // 锥形喷口 + 液滴（第三个键，保持不变）
        g.add(new Konva.Line({
            points: [cx - s * 0.50, cy, cx - s * 0.04, cy - s * 0.32, cx - s * 0.04, cy + s * 0.32],
            closed: true, fill: '#ffffff', stroke: '#222222', strokeWidth: 2.2, lineJoin: 'round',
        }));
        [[-0.34, -0.14, 1.9], [-0.34, 0.12, 1.9], [-0.20, -0.01, 1.7]].forEach(([dx, dy, r]) => {
            g.add(new Konva.Circle({ x: cx + s * dx, y: cy + s * dy, radius: r, fill: '#222222' }));
        });
        [[0.14, 3.5], [0.29, 2.9], [0.43, 2.3]].forEach(([dx, r]) => {
            g.add(new Konva.Circle({ x: cx + s * dx, y: cy, radius: r, fill: '#222222' }));
        });
    }

    _iconFlow(g, cx, cy, s = 32) {              // 排渣：向右尖角 + 角内/角外各三点
        g.add(new Konva.Line({
            points: [
                cx - s * 0.46, cy - s * 0.44,
                cx + s * 0.06, cy,
                cx - s * 0.46, cy + s * 0.44,
            ],
            stroke: '#111111', strokeWidth: 3, lineCap: 'round', lineJoin: 'round',
        }));
        [[-0.24, -0.13], [-0.06, 0.0], [-0.24, 0.15]].forEach(([dx, dy]) => {
            g.add(new Konva.Circle({ x: cx + s * dx, y: cy + s * dy, radius: 2.3, fill: '#111111' }));
        });
        [[0.24, 0], [0.38, 0], [0.52, 0]].forEach(([dx, dy]) => {
            g.add(new Konva.Circle({ x: cx + s * dx, y: cy + s * dy, radius: 2.6, fill: '#111111' }));
        });
    }

    _iconScreens(g, cx, cy, s = 32) {           // 双屏（后屏 + 前屏 + 底座）
        const w = s * 0.54, h = s * 0.40;
        // 后屏（右上偏移）
        g.add(new Konva.Rect({
            x: cx - w * 0.32, y: cy - h * 1.45, width: w, height: h,
            fill: '#ffffff', stroke: '#222222', strokeWidth: 2, cornerRadius: 2,
        }));
        // 前屏
        g.add(new Konva.Rect({
            x: cx - w * 0.68, y: cy - h * 0.62, width: w, height: h,
            fill: '#ffffff', stroke: '#222222', strokeWidth: 2, cornerRadius: 2,
        }));
        // 底座（梯形）
        g.add(new Konva.Line({
            points: [cx - w * 0.24, cy + h * 0.55, cx + w * 0.06, cy + h * 0.55, cx + w * 0.20, cy + h * 0.95, cx - w * 0.38, cy + h * 0.95],
            closed: true, fill: '#ffffff', stroke: '#222222', strokeWidth: 2, lineJoin: 'round',
        }));
    }

    _iconAlarm(g, cx, cy, s = 32) {             // 报警三角
        g.add(new Konva.Line({ points: [cx, cy - s * 0.34, cx - s * 0.40, cy + s * 0.26, cx + s * 0.40, cy + s * 0.26], closed: true, fill: '#ffffff', stroke: '#222', strokeWidth: 2 }));
        g.add(new Konva.Line({ points: [cx, cy - s * 0.10, cx, cy + s * 0.06], stroke: '#222', strokeWidth: 2.4, lineCap: 'round' }));
        g.add(new Konva.Circle({ x: cx, y: cy + s * 0.16, radius: 1.8, fill: '#222' }));
    }

    _iconEnter(g, cx, cy, s = 44) {             // 回车（返回箭头）
        g.add(new Konva.Line({ points: [cx + s * 0.28, cy - s * 0.24, cx + s * 0.28, cy + s * 0.12, cx - s * 0.24, cy + s * 0.12], stroke: '#111', strokeWidth: 3.2, lineCap: 'round', lineJoin: 'round' }));
        g.add(new Konva.Line({ points: [cx - s * 0.06, cy - s * 0.04, cx - s * 0.30, cy + s * 0.12, cx - s * 0.06, cy + s * 0.28], stroke: '#111', strokeWidth: 3.2, lineCap: 'round', lineJoin: 'round' }));
    }

    _iconBack(g, cx, cy, s = 42) {
        // 返回箭头：从左下起笔 → 向右 → 向上 → 顶端向左引出箭头
        const w = s * 0.34, h = s * 0.30;
        g.add(new Konva.Line({
            points: [
                cx - w * 0.52, cy + h * 0.62,     // 左下起笔
                cx + w * 0.60, cy + h * 0.62,     // 向右
                cx + w * 0.60, cy - h * 0.58,     // 向上
                cx - w * 0.14, cy - h * 0.58,     // 顶端向左
            ],
            stroke: '#111111', strokeWidth: 6.6, lineCap: 'round', lineJoin: 'round', tension: 0.10,
        }));
        // 顶端向左的实心箭头
        g.add(new Konva.Line({
            points: [
                cx - w * 0.16, cy - h * 0.96,
                cx - w * 1.02, cy - h * 0.58,
                cx - w * 0.16, cy - h * 0.20,
            ],
            closed: true, fill: '#111111', stroke: '#111111', strokeWidth: 2, lineJoin: 'round',
        }));
    }

    _drawLogo(g) {
        const L = this._geo.logo;
        g.add(new Konva.Text({
            x: L.cx - 105, y: L.cy - 16, width: 210, text: 'ALFA LAVAL', fontSize: 20,
            fontStyle: 'italic bold', fill: '#2b2bb5', align: 'center',
            fontFamily: 'Georgia, "Times New Roman", serif',
        }));
        [[-6, 5], [20, 31]].forEach(([y1, y2]) => {
            const pts = [];
            for (let i = 0; i <= 14; i++) {
                const t = i / 14;
                pts.push(L.cx - 92 + 184 * t, L.cy + y1 + (y2 - y1) * t + Math.sin(t * Math.PI * 3.2) * 4.2);
            }
            g.add(new Konva.Line({ points: pts, stroke: '#2b2bb5', strokeWidth: 2.4, tension: 0.35 }));
        });
    }

    _drawStaticParts() {
        const g = this._staticGroup, G = this._geo, W = this.W, H = this.H;

        // 浅蓝色外壳
        g.add(new Konva.Rect({
            x: 0, y: 0, width: W, height: H, cornerRadius: G.chassis.r,
            fill: '#a9cadb', stroke: '#5f8fa6', strokeWidth: 2,
        }));
        // 灰色 EPC 面板
        const F = G.face;
        g.add(new Konva.Rect({
            x: F.x, y: F.y, width: F.w, height: F.h, cornerRadius: F.r,
            fill: '#9e9e9e', stroke: '#6b6b6b', strokeWidth: 2.5,
        }));

        this._drawLogo(g);
        this._label(g, G.title.x, G.title.y, 'EPC 60', 20, '#ededed', true);

        // LCD 黑色厚边框
        const L = G.lcd;
        g.add(new Konva.Rect({
            x: L.x - 6, y: L.y - 6, width: L.w + 12, height: L.h + 12, cornerRadius: 7,
            fill: '#1b1b1b', stroke: '#000000', strokeWidth: 2,
        }));

        // ── 数字键盘 3×4 ──
        const K = G.keys;
        this._keyList = [];
        const num = ['7', '8', '9', '4', '5', '6', '1', '2', '3', '.', '0'];
        num.forEach((lab, i) => {
            const col = i % 3, row = Math.floor(i / 3);
            const x = K.x + col * (K.w + K.gapX), y = K.y + row * (K.h + K.gapY);
            this._whiteKey(g, x, y, K.w, K.h, 7);
            this._label(g, x, y + 9, lab, 30, '#111', true, 'center', K.w);
            this._keyList.push({ id: lab === '.' ? 'key-dot' : 'key-' + lab, x, y, w: K.w, h: K.h });
        });
        {
            const x = K.x + 2 * (K.w + K.gapX), y = K.y + 3 * (K.h + K.gapY);
            this._whiteKey(g, x, y, K.w, K.h, 7);
            this._iconEnter(g, x + K.w / 2, y + K.h / 2, 42);
            this._keyList.push({ id: 'enter', x, y, w: K.w, h: K.h });
        }

        // ── 导航键：返回 / ▲ / ▼ / i ──
        const N = G.nav;
        this._whiteKey(g, N.back.x, N.back.y, N.back.w, N.back.h, 7);
        this._iconBack(g, N.back.x + N.back.w / 2, N.back.y + N.back.h / 2, 38);

        this._whiteKey(g, N.up.x, N.up.y, N.up.w, N.up.h, 7);
        g.add(new Konva.Line({
            points: [N.up.x + 13, N.up.y + 35, N.up.x + N.up.w - 13, N.up.y + 35, N.up.x + N.up.w / 2, N.up.y + 16],
            closed: true, fill: '#111111',
        }));

        this._whiteKey(g, N.down.x, N.down.y, N.down.w, N.down.h, 7);
        g.add(new Konva.Line({
            points: [N.down.x + 13, N.down.y + 19, N.down.x + N.down.w - 13, N.down.y + 19, N.down.x + N.down.w / 2, N.down.y + 38],
            closed: true, fill: '#111111',
        }));

        this._whiteKey(g, N.info.x, N.info.y, N.info.w, N.info.h, 7);
        this._label(g, N.info.x, N.info.y + 7, 'i', 30, '#111', true, 'center', N.info.w);

        this._keyList.push({ id: 'plus', x: N.up.x, y: N.up.y, w: N.up.w, h: N.up.h });
        this._keyList.push({ id: 'minus', x: N.down.x, y: N.down.y, w: N.down.w, h: N.down.h });
        this._keyList.push({ id: 'back', x: N.back.x, y: N.back.y, w: N.back.w, h: N.back.h });
        this._keyList.push({ id: 'info', x: N.info.x, y: N.info.y, w: N.info.w, h: N.info.h });

        // ── 起动 I / 停止 O ──
        const S = G.io.start, P = G.io.stop;
        g.add(new Konva.Rect({ x: S.x, y: S.y, width: S.w, height: S.h, cornerRadius: 7, fill: '#2f6b2f', stroke: '#16340f', strokeWidth: 2 }));
        g.add(new Konva.Rect({ x: P.x, y: P.y, width: P.w, height: P.h, cornerRadius: 7, fill: '#7f1d1d', stroke: '#3a0b0b', strokeWidth: 2 }));
        this._label(g, S.x, S.y + 10, 'I', 30, '#ffffff', true, 'center', S.w);
        this._label(g, P.x, P.y + 10, 'O', 30, '#ffffff', true, 'center', P.w);

        // ── 功能键（L 形底板）+ 图标键 ──
        const A = G.plateA;
        g.add(new Konva.Path({
            x: A.x, y: A.y,
            data: 'M 0 6 Q 0 0 6 0 L 132 0 Q 138 0 138 6 L 138 66 L 66 66 L 66 128 Q 66 134 60 134 L 6 134 Q 0 134 0 128 Z',
            fill: '#efefef', stroke: '#7c7c7c', strokeWidth: 1.5,
        }));

        const FN = G.fn;
        const fnDefs = [
            ['system', 'display', 0, 0],
            ['sep-icon', 'separator', 1, 0],
            ['water-icon', 'pump', 0, 1],
            ['discharge', 'flow', 2, 0],
            ['info-icon', 'screens', 3, 0],
            ['bowl-icon', 'pump', 2, 1],
            ['cip', 'cip', 3, 1],
            ['alarm-reset', 'alarm', 1, 1],
        ];
        this._fnRects = [];
        fnDefs.forEach(([id, kind, col, row]) => {
            const x = FN.colX[col], y = FN.rowY[row];
            this._whiteKey(g, x, y, FN.s, FN.s, 7);
            const cx = x + FN.s / 2, cy = y + FN.s / 2;
            if (kind === 'display') this._iconDisplay(g, cx, cy, 28);
            else if (kind === 'separator') this._iconSeparator(g, cx, cy, 36);
            else if (kind === 'pump') this._iconPump(g, cx, cy, 30);
            else if (kind === 'process') this._iconProcess(g, cx, cy, 32);
            else if (kind === 'flow') this._iconFlow(g, cx, cy, 32);
            else if (kind === 'screens') this._iconScreens(g, cx, cy, 30);
            else if (kind === 'alarm') this._iconAlarm(g, cx, cy, 32);
            else if (kind === 'cip') this._label(g, x, y + 17, 'CIP', 15, '#111', true, 'center', FN.s);
            this._fnRects.push({ id, x, y, w: FN.s, h: FN.s });
        });

        // ── 面板下方：电源开关（通用旋钮）/ 应急停止（通用按钮）/ 电机电流表 ──
        const PW = G.power, Em = G.emergency, AM = G.ammeter;

        // 电源开关：白色外框 + 黑色圆面（白色指示条在动态层）
        g.add(new Konva.Circle({ x: PW.cx, y: PW.cy, radius: PW.R, fill: '#ffffff', stroke: '#9aa0a0', strokeWidth: 1.2 }));
        g.add(new Konva.Circle({ x: PW.cx, y: PW.cy, radius: PW.R - 7, fill: '#141414', stroke: '#000000', strokeWidth: 1 }));
        this._label(g, PW.cx - 56, PW.cy - 40, 'OFF', 12, '#37474f', true, 'right', 24);
        this._label(g, PW.cx + 32, PW.cy - 40, 'ON', 12, '#37474f', true, 'left', 24);

        // 应急停止：金属外圈 + 红色蘑菇头
        g.add(new Konva.Circle({ x: Em.cx, y: Em.cy, radius: Em.r, fill: '#cfd3d3', stroke: '#7f8585', strokeWidth: 1.6 }));
        g.add(new Konva.Circle({ x: Em.cx, y: Em.cy, radius: Em.r - 7, fill: '#c62828', stroke: '#5c0d0d', strokeWidth: 2.5 }));
        g.add(new Konva.Circle({ x: Em.cx, y: Em.cy, radius: Em.r - 17, fill: '#e53935', stroke: '#8e1515', strokeWidth: 1.5 }));

        // 中文标注：同一行，位于两个器件下方
        this._label(g, PW.cx - 45, 666, '电源开关', 13, '#263238', true, 'center', 90);
        this._label(g, Em.cx - 45, 666, '应急停止', 13, '#263238', true, 'center', 90);

        // 电机电流表：矩形表壳 + 圆形表盘（直径占表壳高度 4/5 以上）
        this._label(g, AM.x + AM.w / 2 - 45, 684, '电机电流', 13, '#263238', true, 'center', 90);
        g.add(new Konva.Rect({ x: AM.x, y: AM.y, width: AM.w, height: AM.h, cornerRadius: 5, fill: '#3a3a3a', stroke: '#222222', strokeWidth: 2 }));
        g.add(new Konva.Rect({ x: AM.x + 7, y: AM.y + 7, width: AM.w - 14, height: AM.h - 14, cornerRadius: 3, fill: '#f7f7f2', stroke: '#111111', strokeWidth: 1.5 }));

        const acx = AM.x + AM.w / 2, acy = AM.y + AM.h / 2 + 2, ar = Math.min(AM.h - 18, AM.w - 24) / 2;
        g.add(new Konva.Circle({ x: acx, y: acy, radius: ar, fill: '#ffffff', stroke: '#54606a', strokeWidth: 2 }));
        // 刻度：240° 扫角（0 在正上方，左右各 120°）
        for (let i = 0; i <= 10; i++) {
            const a = (-120 + i * 24) * Math.PI / 180;
            const sx = Math.sin(a), cy2 = Math.cos(a);
            const r1 = i % 2 === 0 ? ar - 12 : ar - 7, r2 = ar - 3;
            g.add(new Konva.Line({
                points: [acx + sx * r1, acy - cy2 * r1, acx + sx * r2, acy - cy2 * r2],
                stroke: '#111111', strokeWidth: i % 2 === 0 ? 1.8 : 1,
            }));
            if (i % 2 === 0) {
                const tx = acx + sx * (ar - 26), ty = acy - cy2 * (ar - 26);
                this._label(g, tx - 12, ty - 7, String(i * 10), 11, '#111111', false, 'center', 24);
            }
        }
        // 80~100 过载红色区（+96° ~ +120°）
        g.add(new Konva.Arc({ x: acx, y: acy, innerRadius: ar - 10, outerRadius: ar - 3, angle: 24, rotation: 6, fill: '#e53935' }));
        this._label(g, AM.x + 12, AM.y + 8, 'A', 12, '#111111', true);
    }

    _createDynamicNodes() {
        const d = this._dynamicGroup, G = this._geo;

        // LCD 屏幕面
        this._lcdBg = new Konva.Rect({
            x: G.lcd.x, y: G.lcd.y, width: G.lcd.w, height: G.lcd.h, cornerRadius: 3,
            fill: '#b4b96a', stroke: '#000000', strokeWidth: 1,
        });
        d.add(this._lcdBg);
        this._lcdTexts = [];
        for (let i = 0; i < 4; i++) {
            const t = new Konva.Text({
                x: G.lcd.x + 14, y: G.lcd.y + 10 + i * 28,
                width: G.lcd.w - 28, height: 24, wrap: 'none',
                text: '', fontSize: 16, lineHeight: 1.2,
                fontFamily: 'Consolas, "Courier New", monospace',
                fill: '#1f2410', listening: false,
            });
            d.add(t);
            this._lcdTexts.push(t);
        }
        // 右对齐文字（第 1~3 行）：NO / YES 选项、计时
        this._lcdRights = [];
        for (let i = 1; i <= 3; i++) {
            const t = new Konva.Text({
                x: G.lcd.x + 14, y: G.lcd.y + 10 + i * 28,
                width: G.lcd.w - 28, height: 24, wrap: 'none',
                text: '', fontSize: 16, lineHeight: 1.2, align: 'right',
                fontFamily: 'Consolas, "Courier New", monospace',
                fill: '#1f2412', listening: false,
            });
            d.add(t);
            this._lcdRights.push(t);
        }

        // 电源旋钮指示条（两档：-45° OFF / +45° ON）
        const PW = G.power;
        this._powerKnob = new Konva.Group({ x: PW.cx, y: PW.cy, rotation: -45 });
        this._powerKnob.add(new Konva.Rect({
            x: -4, y: -(PW.R - 6), width: 8, height: (PW.R - 6) * 2,
            cornerRadius: 4, fill: 'rgba(0,0,0,0)', stroke: '#ffffff', strokeWidth: 2,
        }));
        this._powerKnob.add(new Konva.Rect({
            x: -2, y: -(PW.R - 12), width: 4, height: 11, cornerRadius: 1, fill: '#ffffff',
        }));
        d.add(this._powerKnob);

        // 功能键 LED
        this._leds = {};
        this._fnRects.forEach(r => {
            const c = new Konva.Circle({ x: r.x + 9, y: r.y + 9, radius: 4.4, fill: '#2b2f2f', stroke: '#111111', strokeWidth: 1 });
            d.add(c);
            this._leds[r.id] = c;
        });
        // 起动 / 停止 指示点
        this._ledStart = new Konva.Circle({ x: G.io.start.x + 9, y: G.io.start.y + 9, radius: 4.4, fill: '#2b2f2f', stroke: '#111111', strokeWidth: 1 });
        this._ledStop = new Konva.Circle({ x: G.io.stop.x + 9, y: G.io.stop.y + 9, radius: 4.4, fill: '#2b2f2f', stroke: '#111111', strokeWidth: 1 });
        d.add(this._ledStart, this._ledStop);

        // 电流表指针与读数
        const AM = G.ammeter;
        const acx = AM.x + AM.w / 2, acy = AM.y + AM.h / 2 + 2;
        const ar = Math.min(AM.h - 18, AM.w - 24) / 2;
        this._ampNeedle = new Konva.Group({ x: acx, y: acy, rotation: -120 });
        this._ampNeedle.add(new Konva.Line({ points: [0, 0, 0, -(ar - 10)], stroke: '#c62828', strokeWidth: 2.6, lineCap: 'round' }));
        this._ampNeedle.add(new Konva.Circle({ x: 0, y: 0, radius: 5, fill: '#111111' }));
        d.add(this._ampNeedle);
        this._ampText = new Konva.Text({
            x: acx - 40, y: acy + 30, width: 80, height: 24,
            text: '0', fontSize: 17, align: 'center', fontFamily: 'Consolas, monospace', fill: '#111111',
        });
        d.add(this._ampText);
    }

    _clearPartBg(hit) {
        try {
            const p = hit && hit.getParent && hit.getParent();
            const bg = p && p.getChildren && p.getChildren()[0];
            if (bg && typeof bg.fill === 'function') bg.fill('rgba(0,0,0,0)');
        } catch (e) { /* ignore */ }
    }

    _bindInteraction() {
        const G = this._geo;
        this._keyList.forEach(k => {
            const hit = this.addClickablePart(k.id, k.x, k.y, k.w, k.h, true);
            hit.on('click tap', () => this._onKey(k.id));
            this._clearPartBg(hit);
        });
        this._fnRects.forEach(r => {
            const hit = this.addClickablePart(r.id, r.x, r.y, r.w, r.h, true);
            hit.on('click tap', () => this._onKey(r.id));
            this._clearPartBg(hit);
        });
        const S = G.io.start;
        const hs = this.addClickablePart('separation', S.x, S.y, S.w, S.h, true);
        hs.on('click tap', () => this._onKey('separation'));
        this._clearPartBg(hs);
        const P = G.io.stop;
        const hp = this.addClickablePart('stop', P.x, P.y, P.w, P.h, true);
        hp.on('click tap', () => this._onKey('stop'));
        this._clearPartBg(hp);
        const PW = G.power;
        const hw = this.addClickablePart('power', PW.cx - PW.R, PW.cy - PW.R, PW.R * 2, PW.R * 2, true);
        hw.on('click tap', () => this._onKey('power'));
        this._clearPartBg(hw);
        const Em = G.emergency;
        const he = this.addClickablePart('emergency', Em.cx - Em.r, Em.cy - Em.r, Em.r * 2, Em.r * 2, true);
        he.on('click tap', () => this._onKey('emergency'));
        this._clearPartBg(he);

        // ── 识别用热区：液晶显示屏 + 三只状态指示灯（点击只显示说明，不改变状态）──
        const L = G.lcd;
        const hl = this.addClickablePart('lcd', L.x, L.y, L.w, L.h, true);
        hl.on('click tap', () => this._tipPart('lcd'));
        this._clearPartBg(hl);
        [['led-pump', G.fn.colX[0], G.fn.rowY[1]],      // 供油泵运行指示（水图标键上）
            ['led-heater', G.fn.colX[0], G.fn.rowY[0]],    // 加热器运行指示（显示图标键上）
            ['led-motor', G.fn.colX[1], G.fn.rowY[0]]      // 分油机电机运行指示（分离机图标键上）
        ].forEach(([id, kx, ky]) => {
            const h = this.addClickablePart(id, kx + 1, ky + 1, 16, 16, true);
            h.on('click tap', () => this._tipPart(id));
            this._clearPartBg(h);
        });
    }

    /** 识别类部件（显示屏、状态指示灯）的点击说明 */
    _tipPart(id) {
        const s = this._solver();
        const m = s ? s.m : null;
        const tip = (t) => { if (this.sys && this.sys._tipPurifier) this.sys._tipPurifier(t); };
        if (id === 'lcd') {
            tip('液晶显示屏（LCD）：显示程序步骤 / Ti 定时器、运行参数、报警信息与操作菜单');
            return;
        }
        if (!m) return;
        if (id === 'led-pump') {
            tip(`供油泵运行指示灯：${(m.feed.pumpOn && m.mainPower) ? '亮绿灯——供油泵正在运行' : '熄灭——供油泵未运行'}`);
        } else if (id === 'led-heater') {
            tip(`加热器运行指示灯：${(m.feed.heaterOn && m.mainPower) ? '亮绿灯——加热器已投入' : '熄灭——加热器未投入'}`);
        } else if (id === 'led-motor') {
            tip(`分油机电机运行指示灯：${m.motor.on ? '亮绿灯——电机运行中' : '熄灭——电机停止'}`);
        }
    }

    /** Ti 时序 → 英文功能名（EPC 固定模式第二行） */
    static get TI_FN() {
        return {
            Ti50: 'Start feed pump', Ti51: 'Feed pressure', Ti52: 'Start separator', Ti53: 'Start heater',
            Ti55: 'Standby', Ti56: 'Discharge', Ti57: 'Drain water', Ti58: 'Close bowl', Ti59: 'Flow check',
            Ti60: 'Discharge', Ti61: 'Drain water', Ti62: 'Close bowl', Ti63: 'Water seal',
            Ti64: 'Fill separator', Ti65: 'Water check', Ti66: 'Leak test', Ti67: 'Reference',
            Ti68: 'Separation', Ti70: 'Stop feed', Ti71: 'Displace oil', Ti72: 'Displace out',
            Ti73: 'Flush paring', Ti74: 'Discharge', Ti75: 'Drain',
            Ti81: 'Close bowl', Ti82: 'Displace out', Ti83: 'Flush paring',
            Ti85: 'Stop motor', Ti86: 'Motor slowing', Ti87: 'Stop feed pump', Ti89: 'Motor stopped',
        };
    }

    _onKey(id) {
        const s = this._solver();
        if (!s) return;
        const m = s.m;

        // 控制模式在 HAND（机旁）/ AUTO（全自动）时，EPC 面板按键一律无效（电源、应急停止除外）
        if (m.ctrlMode !== 'EPC' && id !== 'power' && id !== 'emergency') {
            if (this.sys && typeof this.sys._tipPurifier === 'function') {
                const cn = m.ctrlMode === 'AUTO' ? 'AUTO 全自动' : (m.ctrlMode === 'HAND' ? 'HAND 机旁' : m.ctrlMode);
                this.sys._tipPurifier(`控制模式在「${cn}」位，EPC-60 面板按钮无效；请把控制模式开关转到「EPC」`);
            }
            return;
        }

        const u = this._ui;

        if (id === 'power') {
            s.toggleEpcPower();
            u.question = false; u.asked = false; u.menuOpen = false; u.page = 'main'; u.editing = false;
        } else if (id === 'emergency') {
            if (m.emergency) s.resetEmergency(); else s.emergencyStop();
        } else if (id === 'separation') {
            this._pressStart();
        } else if (id === 'stop') {
            if (m.epcPower) s.pressStop();
        } else if (id === 'discharge') {
            if (m.epcPower) s.pressDischarge();
        } else if (id === 'alarm-reset') {
            if (m.epcPower) s.pressAlarmReset();
        } else if (id === 'info' || id === 'info-icon') {
            if (u.menuOpen) this._onInfo();
        } else if (id === 'enter') {
            if (u.question) {
                u.question = false; u.asked = true;      // 确认启动问题 → 第 3 屏
            } else if (u.menuOpen) {
                this._onEnter();
            }
        } else if (id === 'plus' || id === 'minus') {
            if (u.question) {
                u.answer = u.answer === 'YES' ? 'NO' : 'YES';   // YES / NO 闪烁切换
            } else if (u.menuOpen) {
                this._onAdjust(id === 'plus' ? -1 : 1);   // ↑ 向上、↓ 向下
            }
        } else if (id === 'back') {
            if (u.menuOpen) {                                  // 再按一次返回固定/状态显示
                u.menuOpen = false; u.page = 'main'; u.editing = false;
            } else if (!u.question) {                          // 第一次按返回 → 进菜单
                u.menuOpen = true; u.page = 'menu'; u.menu = 0; u.editing = false;
            }
        } else if (id === 'bowl-icon') {
            // 排渣泵起动/停止：运行时排渣柜液位逐渐下降，低于 5% 自动停泵
            const wasOn = !!m.sludge.pumpOn;
            s.toggleSludgePump();
            if (this.sys && typeof this.sys._tipPurifier === 'function') {
                const nowOn = !!s.m.sludge.pumpOn;
                if (nowOn) this.sys._tipPurifier(`排渣泵已起动：排渣柜液位 ${s.m.sludge.tank.toFixed(1)}%，低于 5% 自动停泵`);
                else if (wasOn) this.sys._tipPurifier('排渣泵已停止');
                else this.sys._tipPurifier('排渣柜液位已低于 5%，排渣泵无需起动');
            }
            this._syncVisuals();
            return;
        } else if (id === 'cip') {
            s.m.cip = !s.m.cip;
            if (this.sys && this.sys._tipPurifier) this.sys._tipPurifier(s.m.cip ? 'CIP 清洗功能已选择（演示接口）' : 'CIP 清洗功能已取消');
        } else if (id === 'system') {
            if (this.sys && this.sys.pageMgr) this.sys.pageMgr.navigateTo(2);
        } else if (id.startsWith('key-')) {
            this._onNumeric(id === 'key-dot' ? '.' : id.slice(4));
        }
        this._syncVisuals();
    }

    /** I 键（分离起动）：按实船 EPC 的 5 步起动流程推进 */
    _pressStart() {
        const s = this._solver();
        if (!s) return;
        const m = s.m, u = this._ui;
        if (m.prog) return;                       // 程序运行中
        if (u.question) return;                   // 等待回车确认问题
        if (!u.asked) {                           // ① 第 1 次：启动问题，I 灯闪烁
            u.question = true; u.answer = 'YES';
            return;
        }
        if (!m.feed.pumpOn) { s.setFeedPump(true); return; }          // ② 第 2 次：供油泵
        if (!m.feed.heaterOn) { s.setHeater(true); return; }          // ③ 第 3 次：加热器
        if (m.feed.temp < 96) return;                                 //    温度未到 96 ℃
        if (!m.motor.on) { s.start(true); return; }                   // ④ 第 4 次：分油机电机
        if (m.bowl.speed < 10000) return;                             //    转速未到 10000 r/min
        s._startProgram(2);                                           // ⑤ 第 5 次：分离程序（阶段二 Ti60）
    }

    _onNumeric(ch) {
        const u = this._ui;
        if (!u.editing) return;
        if (u.editStr.length > 7) return;
        if (ch === '.' && u.editStr.includes('.')) return;
        u.editStr = (u.editStr === '0' && ch !== '.') ? ch : (u.editStr + ch);
        u.editVal = parseFloat(u.editStr) || 0;
    }

    _onInfo() {
        const u = this._ui;
        if (u.page === 'main') u.page = 'info';
        else u.page = 'main';
        u.editing = false;
    }

    _onEnter() {
        const u = this._ui, s = this._solver();
        if (!s) return;
        if (!s.m.epcPower) return;
        if (u.page === 'main') u.page = 'menu';
        else if (u.page === 'menu') {
            u.page = ['params', 'time', 'alarms', 'info'][u.menu] || 'main';
            if (u.page === 'params') u.param = 0;
        } else if (u.page === 'params') {
            if (u.editing) {
                const val = parseFloat(u.editStr);
                if (Number.isFinite(val)) s.setParam(u.editKey, val);
                u.editing = false;
            } else {
                const item = this._paramItems()[u.param];
                if (item) {
                    u.editing = true;
                    u.editKey = item[0];
                    u.editVal = s.getParam(item[0]);
                    u.editStr = String(u.editVal);
                }
            }
        } else {
            u.page = 'menu';
        }
    }

    _onAdjust(dir) {
        const u = this._ui, s = this._solver();
        if (!s) return;
        if (u.page === 'menu') {
            u.menu = Math.max(0, Math.min(3, u.menu + dir));
        } else if (u.page === 'params') {
            const items = this._paramItems();
            if (u.editing) {
                const item = items[u.param];
                if (!item) return;
                const step = item[3];
                const dec = item[4] || 0;
                u.editVal = Number((u.editVal + dir * step).toFixed(dec));
                u.editStr = String(u.editVal);
            } else {
                u.param = Math.max(0, Math.min(items.length - 1, u.param + dir));
            }
        } else if (u.page === 'alarms') {
            const n = s.m.alarms.length;
            u.alarm = Math.max(0, Math.min(Math.max(0, n - 1), u.alarm + dir));
        } else if (u.page === 'info') {
            u.info = Math.max(0, Math.min(5, u.info + dir));
        }
    }

    _paramItems() {
        return [
            ['dischargeInterval', '排渣间隔', 'min', 1, 0],
            ['minInterval', '最短排渣间隔', 'min', 1, 0],
            ['sepTemp', '分离温度', '°C', 1, 0],
            ['tempLowAlarm', '低温报警', '°C', 1, 0],
            ['flow', '进油流量', 'm³/h', 0.1, 1],
            ['sealTime', '水封时间', 's', 1, 0],
            ['displacementTime', '置换水时间', 's', 1, 0],
            ['drainTime', '排水阀时间', 's', 1, 0],
            ['waterTrigger', '水分触发值', 'pF', 1, 0],
            ['timeScale', '仿真时间倍率', '×', 1, 0],
        ];
    }

    _stateText(m) {
        const map = {
            STANDSTILL: 'STANDSTILL', STARTING: 'START', START_SEQ: 'START_SEQ',
            STANDBY: 'STANDBY', SEPARATION: 'SEPARATION', DISCHARGE: 'DISCHARGE', STOPPING: 'STOP',
        };
        return map[m.state] || m.state;
    }

    _fmtClock(sec) {
        sec = Math.max(0, Math.round(sec));
        const mm = Math.floor(sec / 60);
        const ss = sec % 60;
        return `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
    }

    /** 屏幕内容：{ lines:[4行], right:{行号:文字}, blink:'YES'|'NO'|null } */
    _lcdScreen(m) {
        const u = this._ui;
        if (!m.epcPower) {
            return { lines: ['EPC 60', '', '  POWER OFF', '请合上电源开关'], right: {} };
        }
        if (u.menuOpen) {
            return { lines: this._menuLines(m), right: {} };
        }
        if (m.ctrlMode !== 'EPC') {
            return { lines: this._statusLines(m), right: {} };      // HAND / AUTO：同步显示状态与参数
        }
        return this._epcLines(m);                                    // EPC：实船起动流程屏幕
    }

    /** HAND / AUTO 位：同步显示运行状态与参数（操作无效） */
    _statusLines(m) {
        const st = { STANDSTILL: 'STANDSTILL', STARTING: 'STARTING', START_SEQ: 'STARTING',
            STANDBY: 'RECIRCULATION', SEPARATION: 'SEPARATION', DISCHARGE: 'DISCHARGE', STOPPING: 'STOPPING' }[m.state] || m.state;
        const mode = m.ctrlMode === 'AUTO' ? 'AUTO' : 'HAND';
        return [
            `- ${st} -`,
            `Mode= ${mode}  ${m.epcPower ? 'EPC ON' : 'EPC OFF'}`,
            `Speed= ${Math.round(m.bowl.speed)} rpm`,
            `TT1 ${m.feed.temp.toFixed(1)}C PT4 ${m.oil.outletPressure.toFixed(2)}`,
        ];
    }

    /** EPC 位：按 I 键逐步起动的 7 个画面 + 运行中的固定模式画面 */
    _epcLines(m) {
        const u = this._ui, P = m.params;

        // 运行中：固定模式（第一行阶段、第二行 Ti 功能、底部 Ti 号与计时）
        if (m.prog) {
            const stage = {
                1: 'STARTING', 2: 'STARTING_SEPARATION', 3: 'SEPARATION',
                4: 'DISCHARGE', 5: 'STOPPING', 6: 'STOPPING',
            }[m.phase] || 'RUNNING';
            const fn = (EPC60Panel.TI_FN[m.timerName] || '');
            return {
                lines: [stage, fn, '', m.timerName || ''],
                right: { 3: `${Math.floor(m.timerT)} s` },
            };
        }

        // 启动问题（第 2 屏），YES/NO 闪烁
        if (u.question) {
            return {
                lines: ['- START_QUESTIONS -', 'Has the', 'bowl been', 'dismantled?'],
                right: { 1: 'NO', 2: 'YES' },
                blink: u.answer,
            };
        }

        // 第 1 屏：待机 + 提示需要做启动前问答
        if (!u.asked) {
            return {
                lines: ['- - STANDSTILL - -', 'Startmode: Start', 'questions required!', `Temp  =  ${m.feed.temp.toFixed(1)} C`],
                right: {},
            };
        }

        // 起动过程（第 3~7 屏）
        if (!m.feed.pumpOn) {
            return {
                lines: ['- - STARTING - - -', 'To start feed pump', 'press start button', `Temp  =  ${m.feed.temp.toFixed(1)} C`],
                right: {},
            };
        }
        if (!m.feed.heaterOn || m.feed.temp < P.sepTemp - 2) {
            return {
                lines: ['- - STARTING - - -', 'To start heater', 'press start button', `Temp  =  ${m.feed.temp.toFixed(1)} C`],
                right: {},
            };
        }
        if (!m.motor.on) {
            return {
                lines: ['- - STARTING - - -', 'To start separator', 'press start button', ''],
                right: {},
            };
        }
        if (m.bowl.speed < 10000) {
            return {
                lines: ['- - STARTING - - -', 'Starting Separator', '', `Speed = ${Math.round(m.bowl.speed)} rpm`],
                right: {},
            };
        }
        return {
            lines: ['- RECIRCULATION -', 'To start separation', 'press start button',
                `Temp= ${m.feed.temp.toFixed(1)}C  ${Math.round(m.sludge.nextIn / 60)}min`],
            right: {},
        };
    }

    _menuLines(m) {
        const u = this._ui;
        if (u.page === 'menu') {
            const items = ['参数设置', '时间设置', '报警记录', '操作信息'];
            const lines = ['MAIN MENU   ▲▼ 选择'];
            const start = Math.max(0, Math.min(1, u.menu - 1));
            for (let i = 0; i < 3; i++) {
                const real = start + i;
                if (real > 3) { lines.push(''); continue; }
                lines.push(`${real === u.menu ? '>' : ' '} ${items[real]}`);
            }
            return lines;
        }
        if (u.page === 'params') {
            const items = this._paramItems();
            const lines = [`参数设置 ${u.param + 1}/${items.length}  ${u.editing ? '数字输入' : '↵=修改'}`];
            let win;
            if (u.param <= 0) win = [0, 1, 2];
            else if (u.param >= items.length - 1) win = [items.length - 3, items.length - 2, items.length - 1];
            else win = [u.param - 1, u.param, u.param + 1];
            win.forEach(i => {
                const item = items[i];
                if (!item) { lines.push(''); return; }
                const cur = u.editing && i === u.param
                    ? (u.editStr || '0')
                    : Number(m.params[item[0]]).toFixed(item[4] || 0);
                lines.push(`${i === u.param ? '>' : ' '} ${item[1]}  ${cur} ${item[2]}`);
            });
            return lines;
        }
        if (u.page === 'time') {
            return [
                '时间设置',
                `到下次排渣  ${this._fmtClock(m.sludge.nextIn)}`,
                `运行时间    ${m.counters.runTime.toFixed(1)} h`,
                `排渣次数    ${m.counters.dischargeCount}`,
            ];
        }
        if (u.page === 'alarms') {
            const list = m.alarms.filter(a => a.active);
            const lines = [`报警记录 ${list.length} 条  ALARM RESET`];
            if (!list.length) {
                lines.push('  NO ACTIVE ALARM', '', '');
            } else {
                for (let i = 0; i < 3; i++) {
                    const a = list[Math.min(list.length - 1, u.alarm + i)];
                    if (!a) { lines.push(''); continue; }
                    lines.push(`${a.ack ? ' ' : '*'} ${a.code} ${a.text.slice(0, 22)}`);
                }
            }
            return lines;
        }
        // info
        const pages = [
            ['运行信息', `TT1 ${m.feed.temp.toFixed(1)} °C`, `PT1 ${m.feed.pressure.toFixed(3)} MPa`, `PT4 ${m.oil.outletPressure.toFixed(3)} MPa`],
            ['运行信息', `PT5 ${m.water.outletPressure.toFixed(3)} MPa`, `MT  ${m.faults.transducer ? 'NC' : m.oil.waterContent.toFixed(1) + ' pF'}`, `FLOW ${m.feed.flow.toFixed(2)} m³/h`],
            ['运行信息', `RPM ${Math.round(m.bowl.speed)} r/min`, `VIB ${m.bowl.vibration.toFixed(1)} mm/s`, `RUN ${m.counters.runTime.toFixed(1)} h`],
            ['运行信息', `排渣次数 ${m.counters.dischargeCount}`, `起动次数 ${m.counters.startCount}`, `时间倍率 ${m.timeScale}×`],
            ['操作信息', 'S 型分油机  S 936', 'EPC-60 控制单元', '仿真教学版'],
            ['操作信息', 'I=起动  O=停止', '← 返回=菜单', '↵=确认'],
        ];
        return pages[u.info % pages.length];
    }

    /** 把文本按实船液晶的“宽字距”风格展开 */
    _spaced(t) {
        const str = String(t || '');
        if (/[一-龥]/.test(str)) return str;      // 含中文则不做字距展开
        return str.split('').join(' ');
    }

    _syncVisuals() {
        const s = this._solver();
        const m = s ? s.m : null;
        if (!m) return;
        const u = this._ui;
        const sc = this._lcdScreen(m);

        // 按最长行自适应字号（宽字距后仍能放下）
        const spacedLines = sc.lines.map(t => this._spaced(t));
        const fs = 16;                                  // 液晶字号统一 16px
        const blinkOn = Math.floor((performance.now ? performance.now() : Date.now()) / 400) % 2 === 0;

        this._lcdTexts.forEach((t, i) => {
            t.fontSize(fs);
            t.text(spacedLines[i] || '');
            t.fill(m.epcPower ? '#1f2412' : '#6f7f58');
        });
        // 右对齐文字（NO / YES、计时）
        this._lcdRights.forEach((t, i) => {
            const key = i + 1;
            const val = sc.right ? sc.right[key] : '';
            const hide = sc.blink && sc.blink === val && !blinkOn;
            t.fontSize(fs);
            t.text(hide ? '' : this._spaced(val));
            t.fill(m.epcPower ? '#1f2412' : '#6f7f58');
        });

        this._lcdBg.fill(m.epcPower ? '#b4b96a' : '#7d8258');

        // 指示灯：O 右侧=供油泵、I 右侧=加热器、加热器右侧=分油机马达
        this._setLed('water-icon', !!(m.feed.pumpOn && m.mainPower), '#28e05a');   // 供油泵（O 右边）
        this._setLed('system', !!(m.feed.heaterOn && m.mainPower), '#28e05a');     // 加热器（I 右边）
        this._setLed('sep-icon', !!m.motor.on, '#28e05a');                         // 分油机马达（加热器右边）
        const blinkPhase = Math.floor((performance.now ? performance.now() : Date.now()) / 400) % 2 === 0;
        const inDischarge = m.prog && m.phase === 4;
        const stoppingProg = m.prog && (m.phase === 5 || m.phase === 6);
        this._setLed('discharge', inDischarge && blinkPhase, '#f4b400');   // 排渣指示（排渣阶段闪烁）
        this._setLed('bowl-icon', !!m.sludge.pumpOn, '#28e05a');            // 排渣泵运行指示
        this._setLed('alarm-reset', m.alarmActive, '#ff2d2d');
        this._setLed('info-icon', !!m.epcPower, '#28e05a');
        this._setLed('cip', !!m.cip, '#28e05a');

        // 起动流程复位：停机程序结束（STOPPING → STANDSTILL）后重新回到第 1 屏
        if (this._lastState && this._lastState !== 'STANDSTILL' && m.state === 'STANDSTILL' && !m.prog) {
            u.question = false; u.asked = false;          // 停机完成 → 回到第 1 屏
            u.menuOpen = false; u.page = 'main'; u.editing = false;
        }
        this._lastState = m.state;

        // I 键指示灯：起动全过程闪烁 → 分离程序常亮 → 停机程序熄灭
        const blink = Math.floor((performance.now ? performance.now() : Date.now()) / 400) % 2 === 0;
        if (this._ledStart) {
            const stopping = m.prog && (m.phase === 5 || m.phase === 6);
            const starting = !m.prog && (u.question || u.asked);
            if (stopping) this._ledStart.fill('#2b2f2f');                 // 停机程序：熄灭
            else if (m.prog) this._ledStart.fill('#28e05a');               // 分离程序：常亮
            else if (starting) this._ledStart.fill(blink ? '#28e05a' : '#2b2f2f'); // 起动过程：闪烁
            else this._ledStart.fill('#2b2f2f');
        }
        if (this._ledStop) this._ledStop.fill(stoppingProg && blinkPhase ? '#ffb300' : '#2b2f2f');

        this._powerKnob.rotation(m.epcPower ? 45 : -45);
        this._ampNeedle.rotation(-120 + Math.min(1, m.motor.current / 100) * 240);
        this._ampText.text(String(Math.round(m.motor.current)));

        if (this.sys && this.sys.requestRedraw) this.sys.requestRedraw();
    }

    _setLed(id, on, color = '#28e05a') {
        const c = this._leds[id];
        if (!c) return;
        c.fill(on ? color : '#2b2f2f');
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

export default EPC60Panel;
