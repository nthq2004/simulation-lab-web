import { BaseComponent } from './BaseComponent.js';

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

export class HydraulicSteeringSystem extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.W = Math.max(1100, config.width || 1320);
        this.H = Math.max(760, config.height || 1000);
        this.type = 'hydraulic_steering_system';
        this.special = 'steering_system';
        this.cache = 'fixed';

        this.ORANGE = '#f39c12';
        this.PIPE = '#e67e22';
        this.GREEN = '#2e9b4b';
        this.RED = '#c62828';

        this._initGroups();
        this._recalcGeometry();
        this._drawStaticParts();
        this._createDynamicNodes();
        this._registerParts();
        this._syncVisuals();

        this.config = { id: this.id, width: this.W, height: this.H };
    }

    _recalcGeometry() {
        const W = this.W, H = this.H;
        this._geo = {
            background: { x: 0, y: 0, w: W, h: H },
            rudder: { cx: 660, cy: 135, stockTop: 38, bladeBottom: 265 },
            rams: {
                leftBodyX: 390, rightBodyX: 750, bodyW: 180, bodyH: 36,
                ys: [80, 150], leftRodX: 570, rightRodX: 670, rodW: 80, rodH: 14,
                pistonW: 16, leftLabelX: 320, rightLabelX: 938,
            },
            gauge: { cx: 660, cy: 370, r: 95, textX: 630, textY: 400, textW: 60 },
            units: [
                { n: 1, x0: 30, y0: 430, w: 480, h: 520 },
                { n: 2, x0: 800, y0: 430, w: 480, h: 520 },
            ],
            layout: {
                tank: { x: 40, y: 300, w: 64, h: 160 },
                fill: { x: 5, y: 318, w: 35, h: 24 },
                fillValve: { x: 22, y: 332, s: 10 },
                leak: { x: 72, y: 460, w: 0, h: 36 },
                leakValve: { x: 72, y: 480, s: 10 },
                motor: { cx: 230, cy: 410, r: 28 },
                pump: { cx: 270, cy: 410, r: 18 },
                pressureText: { x: 230, y: 260, w: 90 },
                valve4: { x: 310, y: 120, w: 84, h: 60 },
                unload: { x: 310, y: 300, w: 84, h: 60 },
                isolation: { x: 360, y: 210, w: 84, h: 50 },
                checkL: { x: 130, y: 60 }, checkR: { x: 400, y: 60 },
                reliefL: { x: 185, y: 60 }, reliefR: { x: 345, y: 60 },
                seriesL: { x: 130, y: 15 }, seriesR: { x: 400, y: 15 },
                parallel: { x: 265, y: 15 },
                servo: {
                    pump: { cx: 325, cy: 460, r: 14 },
                    motor: { cx: 325, cy: 495, r: 14 },
                    check: { x: 275, y: 460 },
                    filter: { cx: 370, cy: 460, r: 11 },
                    piston: { x: 350, y: 390, w: 65, h: 12 },
                    torque: { cx: 435, cy: 396, r: 9 },
                    pilot: { x: 390, y: 416, w: 30, h: 22 },
                },
            },
            parts: {
                pump1: { x: 30, y: 430, w: 480, h: 520 },
                pump2: { x: 800, y: 430, w: 480, h: 520 },
                rudder: { x: 600, y: 70, w: 120, h: 240 },
            },
        };
    }

    _label(g, x, y, text, size = 11, fill = '#4e342e', bold = false, align = 'left', width = 0) {
        const opts = {
            x, y, text, fontSize: size,
            fontStyle: bold ? 'bold' : 'normal', fill,
            align, fontFamily: 'Arial, sans-serif',
        };
        if (width) opts.width = width;
        g.add(new Konva.Text(opts));
    }

    _line(g, points, color = this.ORANGE, width = 3, dash = null) {
        g.add(new Konva.Line({
            points, stroke: color, strokeWidth: width, lineCap: 'round', lineJoin: 'round',
            ...(dash ? { dash } : {}),
        }));
    }

    _stopValve(g, x, y, s = 10) {
        g.add(new Konva.Line({ points: [x - s, y - s, x + s, y + s], stroke: '#d35400', strokeWidth: 2 }));
        g.add(new Konva.Line({ points: [x - s, y + s, x + s, y - s], stroke: '#d35400', strokeWidth: 2 }));
        g.add(new Konva.Circle({ x, y, radius: s + 2, stroke: '#d35400', strokeWidth: 1.4 }));
    }

    _checkValve(g, x, y, s = 11) {
        g.add(new Konva.Line({ points: [x, y - s, x + s, y + s, x - s, y + s], closed: true, fill: '#f5b041', stroke: '#b9770e', strokeWidth: 1.4 }));
        g.add(new Konva.Line({ points: [x, y + s, x, y + s + 10], stroke: this.ORANGE, strokeWidth: 2 }));
        g.add(new Konva.Line({ points: [x - s - 3, y + s, x + s + 3, y + s], stroke: '#b9770e', strokeWidth: 1.4 }));
    }

    _reliefValve(g, x, y, s = 14) {
        g.add(new Konva.Rect({ x: x - s, y: y - s, width: s * 2, height: s * 2, fill: '#f5b041', stroke: '#b9770e', strokeWidth: 1.4 }));
        g.add(new Konva.Line({ points: [x, y - s, x, y - s - 10], stroke: this.ORANGE, strokeWidth: 2 }));
        g.add(new Konva.Line({ points: [x, y + s, x, y + s + 10], stroke: this.ORANGE, strokeWidth: 2 }));
        g.add(new Konva.Line({ points: [x - 7, y + 4, x + 7, y - 4], stroke: '#7f4f0a', strokeWidth: 2 }));
        g.add(new Konva.Line({ points: [x - 7, y - 5, x + 7, y + 5], stroke: '#7f4f0a', strokeWidth: 1.4 }));
        for (let i = 0; i < 3; i++) {
            g.add(new Konva.Line({ points: [x + 2, y - s + 4 + i * 5, x + 9, y - s + 7 + i * 5], stroke: '#7f4f0a', strokeWidth: 1.2 }));
        }
    }

    _valve22(g, cx, y, opts = {}) {
        const sw = opts.w || 20, sh = opts.h || 24;
        const x = cx - sw, cy = y + sh / 2;
        const openLeft = opts.openSide !== 'right';
        const openX = openLeft ? x + sw / 2 : cx + sw / 2;
        const closeX = openLeft ? cx + sw / 2 : x + sw / 2;
        g.add(new Konva.Rect({ x, y, width: sw * 2, height: sh, fill: '#eef0ed', stroke: '#3f4b4f', strokeWidth: 1.5 }));
        g.add(new Konva.Line({ points: [cx, y, cx, y + sh], stroke: '#3f4b4f', strokeWidth: 1.2 }));
        this._line(g, [cx, y - 8, cx, y], this.ORANGE, 2);
        this._line(g, [cx, y + sh, cx, y + sh + 8], this.ORANGE, 2);
        this._line(g, [openX, y + 4, openX, y + sh - 4], '#3f4b4f', 1.7);
        g.add(new Konva.Line({ points: [openX - 4, y + 9, openX, y + 4, openX + 4, y + 9], stroke: '#3f4b4f', strokeWidth: 1.5 }));
        this._line(g, [closeX, y + 1, closeX, cy - 3], '#3f4b4f', 1.7);
        this._line(g, [closeX, y + sh - 1, closeX, cy + 3], '#3f4b4f', 1.7);
        this._line(g, [closeX - 5, cy, closeX + 5, cy], '#3f4b4f', 1.7);
        const sx = x + sw * 2 + 2;
        g.add(new Konva.Line({ points: [sx, cy, sx + 4, cy - 6, sx + 8, cy + 6, sx + 12, cy - 6, sx + 15, cy], stroke: '#3f4b4f', strokeWidth: 1.4 }));
        if (opts.pilot) {
            g.add(new Konva.Line({ points: [x - 14, cy, x - 2, cy], stroke: this.ORANGE, strokeWidth: 1.2, dash: [4, 3] }));
            g.add(new Konva.Line({ points: [x - 2, cy - 5, x - 2, cy + 5, x + 5, cy], closed: true, fill: '#f5b041', stroke: '#b9770e', strokeWidth: 1.1 }));
        }
        if (opts.manual) {
            this._line(g, [x - 2, cy + 4, x - 16, cy - 8], '#3f4b4f', 2);
            g.add(new Konva.Circle({ x: x - 17, y: cy - 9, radius: 3, fill: '#3f4b4f' }));
        }
        if (opts.solenoid) {
            g.add(new Konva.Rect({ x: x - 20, y: cy - 7, width: 14, height: 14, fill: '#dfe3e0', stroke: '#3f4b4f', strokeWidth: 1.2 }));
            this._line(g, [x - 20, cy + 7, x - 6, cy - 7], '#3f4b4f', 1.2);
        }
        if (opts.label) this._label(g, cx - 8, y - 13, opts.label, 7, '#5d4037', false, 'center', 16);
    }

    _valve24(g, x, y, w, h, opts = {}) {
        const hw = w / 2;
        g.add(new Konva.Rect({ x, y, width: hw, height: h, fill: '#eef0ed', stroke: '#3f4b4f', strokeWidth: 1.5 }));
        g.add(new Konva.Rect({ x: x + hw, y, width: hw, height: h, fill: '#eef0ed', stroke: '#3f4b4f', strokeWidth: 1.5 }));
        const topXs = [x + hw * 0.5, x + hw * 1.5];
        const bottomXs = [x + hw * 0.5, x + hw * 1.5];
        topXs.forEach(px => this._line(g, [px, y - 8, px, y], this.ORANGE, 1.8));
        bottomXs.forEach(px => this._line(g, [px, y + h, px, y + h + 8], this.ORANGE, 1.8));
        const cx1 = x + hw * 0.5, cx2 = x + hw * 1.5;
        this._line(g, [cx1 - 8, y + h - 8, cx1 + 8, y + 8], '#3f4b4f', 1.5);
        g.add(new Konva.Line({ points: [cx1 + 4, y + 8, cx1 + 8, y + 8, cx1 + 8, y + 12], stroke: '#3f4b4f', strokeWidth: 1.5 }));
        this._line(g, [cx1 + 7, y + h - 8, cx1 - 7, y + 8], '#3f4b4f', 1.5);
        this._line(g, [cx2 - 7, y + h - 8, cx2 - 7, y + 8], '#3f4b4f', 1.5);
        this._line(g, [cx2 + 7, y + h - 8, cx2 + 7, y + 8], '#3f4b4f', 1.5);
        const sy = y + h / 2;
        g.add(new Konva.Line({ points: [x + w + 2, sy, x + w + 6, sy - 6, x + w + 10, sy + 6, x + w + 14, sy - 6, x + w + 17, sy], stroke: '#3f4b4f', strokeWidth: 1.4 }));
        if (opts.pilot) {
            this._line(g, [x - 14, sy, x - 2, sy], this.ORANGE, 1.2, [4, 3]);
            g.add(new Konva.Line({ points: [x - 2, sy - 5, x - 2, sy + 5, x + 5, sy], closed: true, fill: '#f5b041', stroke: '#b9770e', strokeWidth: 1.1 }));
        }
        if (opts.manual) {
            this._line(g, [x - 2, sy + 5, x - 16, sy - 8], '#3f4b4f', 2);
            g.add(new Konva.Circle({ x: x - 17, y: sy - 9, radius: 3, fill: '#3f4b4f' }));
        }
        if (opts.solenoid) {
            g.add(new Konva.Rect({ x: x - 20, y: sy - 7, width: 14, height: 14, fill: '#dfe3e0', stroke: '#3f4b4f', strokeWidth: 1.2 }));
            this._line(g, [x - 20, sy + 7, x - 6, sy - 7], '#3f4b4f', 1.2);
        }
        if (opts.label) this._label(g, x + w / 2 - 10, y - 15, opts.label, 7, '#5d4037', false, 'center', 20);
    }

    _drawStaticParts() {
        const g = this._staticGroup, W = this.W, H = this.H, G = this._geo;

        g.add(new Konva.Rect({ x: 0, y: 0, width: W, height: H, fill: '#f2f2ee', stroke: '#d0d2ce', strokeWidth: 2 }));

        this._drawMainLines(g);

        const R = G.rams;
        R.ys.forEach((y, idx) => {
            g.add(new Konva.Rect({ x: R.leftBodyX, y: y - R.bodyH / 2, width: R.bodyW, height: R.bodyH, fill: '#8d8f8c', stroke: '#4d4f4d', strokeWidth: 2, cornerRadius: 3 }));
            g.add(new Konva.Rect({ x: R.leftBodyX + 12, y: y - 12, width: R.bodyW - 24, height: 24, fill: '#b5b7b3', stroke: '#777a77', strokeWidth: 1 }));
            g.add(new Konva.Rect({ x: R.rightBodyX, y: y - R.bodyH / 2, width: R.bodyW, height: R.bodyH, fill: '#8d8f8c', stroke: '#4d4f4d', strokeWidth: 2, cornerRadius: 3 }));
            g.add(new Konva.Rect({ x: R.rightBodyX + 12, y: y - 12, width: R.bodyW - 24, height: 24, fill: '#b5b7b3', stroke: '#777a77', strokeWidth: 1 }));
            this._label(g, R.leftLabelX, y - 28, idx === 0 ? 'NO.2' : 'NO.4', 10, '#6d4c41', true);
            this._label(g, R.rightLabelX, y - 28, idx === 0 ? 'NO.1' : 'NO.3', 10, '#6d4c41', true);
            this._label(g, R.leftLabelX, y + 4, idx === 0 ? 'P 0.8' : 'P 23.5', 9, '#6d4c41');
            this._label(g, R.rightLabelX, y + 4, idx === 0 ? 'P 23.5' : 'P 0.8', 9, '#6d4c41');
        });

        const GA = G.gauge;
        g.add(new Konva.Circle({ x: GA.cx, y: GA.cy, radius: GA.r, fill: '#fbfbf6', stroke: '#455a64', strokeWidth: 2 }));
        for (let v = -40; v <= 40; v += 2) {
            const a = (-140 + (v + 40) / 80 * 280) * Math.PI / 180;
            const major = v % 10 === 0;
            g.add(new Konva.Line({
                points: [GA.cx + Math.sin(a) * (GA.r - 10), GA.cy - Math.cos(a) * (GA.r - 10),
                    GA.cx + Math.sin(a) * (major ? GA.r - 26 : GA.r - 19), GA.cy - Math.cos(a) * (major ? GA.r - 26 : GA.r - 19)],
                stroke: '#37474f', strokeWidth: major ? 1.3 : 0.8,
            }));
            if (major && v !== 0) {
                this._label(g, GA.cx + Math.sin(a) * (GA.r - 38) - 10, GA.cy - Math.cos(a) * (GA.r - 38) - 5,
                    String(Math.abs(v)), 8, '#263238', false, 'center', 20);
            }
        }
        this._label(g, GA.cx - 64, GA.cy - 30, 'P', 11, '#b71c1c', true, 'center', 20);
        this._label(g, GA.cx + 44, GA.cy - 30, 'S', 11, '#1b5e20', true, 'center', 20);
        this._label(g, GA.cx - 28, GA.cy + 48, 'DMU', 9, '#c62828', true, 'center', 56);

        G.units.forEach(u => this._drawUnit(g, u));

        this._label(g, 20, 980, '液压管路（橙色）  ·  1# / 2# 液压动力单元主油路并联  ·  四缸驱动舵柄与舵叶', 10, '#6d4c41');
    }

    _drawMainLines(g) {
        const G = this._geo;
        this._line(g, [150, 445, 150, 220, 390, 220, 390, 98], this.ORANGE, 2.6);
        this._line(g, [410, 445, 410, 235, 750, 235, 750, 98], this.ORANGE, 2.6);
        this._line(g, [930, 445, 930, 250, 570, 250, 570, 168], this.ORANGE, 2.6);
        this._line(g, [1200, 445, 1200, 265, 930, 265, 930, 168], this.ORANGE, 2.6);
        this._line(g, [390, 220, 390, 168], this.ORANGE, 2.6);
        this._line(g, [750, 235, 750, 168], this.ORANGE, 2.6);
        this._line(g, [570, 250, 570, 98], this.ORANGE, 2.6);
        this._line(g, [930, 265, 930, 98], this.ORANGE, 2.6);
    }

    _drawUnit(g, u) {
        const L = this._geo.layout;
        const x0 = u.x0, y0 = u.y0;
        g.add(new Konva.Rect({ x: x0, y: y0, width: u.w, height: u.h, fill: 'rgba(255,255,255,0.30)', stroke: '#c9ccc8', strokeWidth: 1.4, dash: [7, 5], cornerRadius: 5 }));
        this._label(g, x0 + 8, y0 - 18, `${u.n}# 液压动力单元`, 12, '#4e342e', true);

        const T = L.tank;
        g.add(new Konva.Rect({ x: x0 + T.x, y: y0 + T.y, width: T.w, height: T.h, fill: '#e8e4d3', stroke: '#7d6b53', strokeWidth: 2, cornerRadius: 5 }));
        g.add(new Konva.Rect({ x: x0 + T.x - 6, y: y0 + T.y - 8, width: T.w + 12, height: 8, fill: '#b8a77f', stroke: '#7d6b53', strokeWidth: 1 }));
        this._line(g, [x0 + T.x + T.w, y0 + T.y + 26, x0 + T.x + T.w + 40, y0 + T.y + 26], this.ORANGE, 2);
        this._label(g, x0 + T.x + 4, y0 + T.y + 12, '油箱', 9, '#5d4037', true);
        this._label(g, x0 + T.x + T.w + 6, y0 + T.y + 18, 'L 85.00', 8, '#5d4037');
        this._label(g, x0 + T.x + T.w + 6, y0 + T.y + 32, 'T 35.0', 8, '#5d4037');

        const F = L.fill;
        g.add(new Konva.Rect({ x: x0 + F.x, y: y0 + F.y, width: F.w, height: F.h, fill: '#e8e4d3', stroke: '#7d6b53', strokeWidth: 1.2, cornerRadius: 3 }));
        this._line(g, [x0 + F.x + F.w, y0 + F.y + F.h / 2, x0 + T.x, y0 + F.y + F.h / 2], this.ORANGE, 2);
        this._stopValve(g, x0 + F.x + F.w + 12, y0 + F.y + F.h / 2, 8);
        this._label(g, x0 + 2, y0 + F.y - 14, '注油', 9, '#5d4037', true);

        this._line(g, [x0 + L.leak.x, y0 + T.y + T.h, x0 + L.leak.x, y0 + L.leak.y + 36], this.ORANGE, 2);
        this._stopValve(g, x0 + L.leakValve.x, y0 + L.leakValve.y, 8);
        this._label(g, x0 + L.leak.x + 12, y0 + L.leak.y + 30, '泄漏', 9, '#5d4037', true);

        const M = L.motor, P = L.pump;
        g.add(new Konva.Circle({ x: x0 + M.cx, y: y0 + M.cy, radius: M.r, fill: '#d7d9d6', stroke: '#4d4f4d', strokeWidth: 2 }));
        this._label(g, x0 + M.cx - 14, y0 + M.cy - 8, 'M', 16, '#263238', true, 'center', 28);
        g.add(new Konva.Circle({ x: x0 + P.cx, y: y0 + P.cy, radius: P.r, fill: '#f5b041', stroke: '#b9770e', strokeWidth: 1.8 }));
        g.add(new Konva.Line({ points: [x0 + P.cx - 8, y0 + P.cy + 8, x0 + P.cx + 8, y0 + P.cy - 8], stroke: '#7f4f0a', strokeWidth: 2 }));
        g.add(new Konva.Line({ points: [x0 + P.cx + 2, y0 + P.cy - 15, x0 + P.cx + 12, y0 + P.cy - 24], stroke: '#7f4f0a', strokeWidth: 1.6 }));
        this._line(g, [x0 + M.cx + M.r, y0 + M.cy, x0 + P.cx - P.r, y0 + P.cy], '#4d4f4d', 3);
        this._label(g, x0 + P.cx - 24, y0 + P.cy + 34, '变量泵', 9, '#5d4037', true);


        const V4 = L.valve4;
        this._valve24(g, x0 + V4.x, y0 + V4.y, V4.w, V4.h, { pilot: true });
        this._label(g, x0 + V4.x, y0 + V4.y - 20, '液控四通阀', 9, '#5d4037', true);
        this._line(g, [x0 + P.cx, y0 + P.cy - P.r, x0 + P.cx, y0 + 250, x0 + 305, y0 + 250, x0 + 305, y0 + V4.y + V4.h, x0 + V4.x + V4.w * 0.25, y0 + V4.y + V4.h], this.ORANGE, 2);
        const U = L.unload;
        this._valve24(g, x0 + U.x, y0 + U.y, U.w, U.h, { manual: true, solenoid: true });
        this._label(g, x0 + 402, y0 + 294, '卸荷阀', 8, '#5d4037', true);
        this._line(g, [x0 + U.x + U.w / 2, y0 + U.y, x0 + U.x + U.w / 2, y0 + V4.y + V4.h / 2, x0 + V4.x - 14, y0 + V4.y + V4.h / 2], this.ORANGE, 1.2, [4, 3]);

        this._line(g, [x0 + P.cx + P.r, y0 + P.cy, x0 + U.x, y0 + U.y + U.h / 2], this.ORANGE, 2);

        const S = L.isolation;
        this._valve24(g, x0 + S.x, y0 + S.y, S.w, S.h, { manual: true, solenoid: true, pilot: true });
        this._label(g, x0 + S.x, y0 + S.y + S.h + 3, '隔离阀', 9, '#5d4037', true);

        this._drawServoUnit(g, x0, y0, L);
        this._drawMainBranch(g, x0, y0, L.checkL.x, L.checkR.x, L.reliefL.x, L.reliefR.x, L.seriesL.x, L.seriesR.x, L.parallel.x, L, V4, S);
    }

    _drawServoUnit(g, x0, y0, L) {
        const S = L.servo;
        g.add(new Konva.Rect({ x: x0 + S.piston.x, y: y0 + S.piston.y, width: S.piston.w, height: S.piston.h, fill: '#d7d9d6', stroke: '#4d4f4d', strokeWidth: 1.4, cornerRadius: 2 }));
        g.add(new Konva.Rect({ x: x0 + S.piston.x + 6, y: y0 + S.piston.y + 2, width: S.piston.w - 12, height: S.piston.h - 4, fill: '#eef0ed' }));
        this._line(g, [x0 + S.piston.x + S.piston.w, y0 + S.piston.y + S.piston.h / 2, x0 + S.torque.cx - S.torque.r, y0 + S.torque.cy], '#4d4f4d', 2.5);
        g.add(new Konva.Circle({ x: x0 + S.torque.cx, y: y0 + S.torque.cy, radius: S.torque.r, fill: '#d7d9d6', stroke: '#4d4f4d', strokeWidth: 1.5 }));
        this._label(g, x0 + S.torque.cx - 6, y0 + S.torque.cy - 5, 'M', 9, '#263238', true, 'center', 12);

        this._valve22(g, x0 + S.pilot.x + 15, y0 + S.pilot.y, { openSide: 'left', pilot: true, w: 15, h: 22 });
        this._checkValve(g, x0 + S.check.x, y0 + S.check.y, 8);
        g.add(new Konva.Circle({ x: x0 + S.pump.cx, y: y0 + S.pump.cy, radius: S.pump.r, fill: '#f5b041', stroke: '#b9770e', strokeWidth: 1.6 }));
        g.add(new Konva.Line({ points: [x0 + S.pump.cx - 7, y0 + S.pump.cy + 7, x0 + S.pump.cx + 7, y0 + S.pump.cy - 7], stroke: '#7f4f0a', strokeWidth: 1.6 }));
        g.add(new Konva.Circle({ x: x0 + S.motor.cx, y: y0 + S.motor.cy, radius: S.motor.r, fill: '#d7d9d6', stroke: '#4d4f4d', strokeWidth: 1.5 }));
        this._label(g, x0 + S.motor.cx - 6, y0 + S.motor.cy - 5, 'M', 10, '#263238', true, 'center', 12);
        this._line(g, [x0 + S.pump.cx, y0 + S.pump.cy + S.pump.r, x0 + S.motor.cx, y0 + S.motor.cy - S.motor.r], '#4d4f4d', 3);

        const fx = x0 + S.filter.cx, fy = y0 + S.filter.cy, fr = S.filter.r;
        g.add(new Konva.Line({ points: [fx, fy - fr, fx + fr, fy, fx, fy + fr, fx - fr, fy], closed: true, fill: '#eef0ed', stroke: '#4d4f4d', strokeWidth: 1.4 }));

        this._line(g, [x0 + L.tank.x + L.tank.w, y0 + 390, x0 + S.check.x - 8, y0 + 390, x0 + S.check.x - 8, y0 + S.check.y], this.ORANGE, 1.8);
        this._line(g, [x0 + S.check.x + 8, y0 + S.check.y, x0 + S.pump.cx - S.pump.r, y0 + S.pump.cy], this.ORANGE, 1.8);
        this._line(g, [x0 + S.pump.cx + S.pump.r, y0 + S.pump.cy, x0 + S.filter.cx - fr, y0 + S.filter.cy], this.ORANGE, 1.8);
        this._line(g, [x0 + S.filter.cx + fr, y0 + S.filter.cy, x0 + S.pilot.x + 13, y0 + S.pilot.y + 20], this.ORANGE, 1.8);
        this._line(g, [x0 + S.pilot.x + 13, y0 + S.pilot.y, x0 + S.piston.x + S.piston.w, y0 + S.piston.y + S.piston.h / 2], this.ORANGE, 1.4, [4, 3]);
        this._line(g, [x0 + S.piston.x, y0 + S.piston.y + S.piston.h / 2, x0 + 270, y0 + 410], this.ORANGE, 1.2, [4, 3]);

        this._label(g, x0 + S.piston.x, y0 + S.piston.y - 14, '伺服活塞', 8, '#5d4037', true);
        this._label(g, x0 + S.torque.cx - 14, y0 + S.torque.cy - 18, '力矩马达', 7, '#5d4037');
        this._label(g, x0 + S.pilot.x - 4, y0 + S.pilot.y - 14, '先导阀', 8, '#5d4037');
        this._label(g, x0 + S.pump.cx - 24, y0 + S.pump.cy - 28, '伺服泵', 8, '#5d4037', true);
        this._label(g, x0 + S.filter.cx - 12, y0 + S.filter.cy + 14, '滤器', 8, '#5d4037');
    }

    _drawMainBranch(g, x0, y0, xL, xR, relL, relR, serL, serR, par, L, V4, S) {
        const Y = (v) => y0 + v;
        this._line(g, [x0 + V4.x + V4.w * 0.25, Y(V4.y), x0 + xL, Y(V4.y), x0 + xL, Y(90)], this.ORANGE, 2);
        this._line(g, [x0 + V4.x + V4.w * 0.75, Y(V4.y), x0 + xR, Y(V4.y), x0 + xR, Y(90)], this.ORANGE, 2);
        this._line(g, [x0 + xL, Y(90), x0 + xL, Y(39)], this.ORANGE, 2);
        this._line(g, [x0 + xR, Y(90), x0 + xR, Y(39)], this.ORANGE, 2);

        this._checkValve(g, x0 + xL, Y(65), 10);
        this._checkValve(g, x0 + xR, Y(65), 10);
        this._reliefValve(g, x0 + relL, Y(65), 12);
        this._reliefValve(g, x0 + relR, Y(65), 12);
        this._label(g, x0 + xL - 16, Y(44), '单向阀', 8, '#5d4037');
        this._label(g, x0 + xR - 16, Y(44), '单向阀', 8, '#5d4037');
        this._label(g, x0 + relL - 14, Y(30), '溢流阀', 8, '#5d4037');
        this._label(g, x0 + relR - 14, Y(30), '溢流阀', 8, '#5d4037');

        this._line(g, [x0 + relL, Y(80), x0 + relL, Y(235), x0 + L.tank.x + L.tank.w, Y(235), x0 + L.tank.x + L.tank.w, Y(260)], this.ORANGE, 1.8);
        this._line(g, [x0 + relR, Y(80), x0 + relR, Y(250), x0 + L.tank.x + L.tank.w, Y(250), x0 + L.tank.x + L.tank.w, Y(260)], this.ORANGE, 1.8);

        this._valve22(g, x0 + serL, Y(15), { openSide: 'left', pilot: true });
        this._valve22(g, x0 + serR, Y(15), { openSide: 'left', pilot: true });
        this._valve22(g, x0 + par, Y(15), { openSide: 'right', pilot: true });
        this._line(g, [x0 + serL, Y(48), x0 + serR, Y(48)], this.ORANGE, 1.8);
        this._line(g, [x0 + serL, Y(39), x0 + serL, Y(48)], this.ORANGE, 1.8);
        this._line(g, [x0 + serR, Y(39), x0 + serR, Y(48)], this.ORANGE, 1.8);
        this._line(g, [x0 + par, Y(39), x0 + par, Y(48)], this.ORANGE, 1.8);
        this._label(g, x0 + serL - 8, Y(2), '串联阀', 8, '#5d4037');
        this._label(g, x0 + serR - 8, Y(2), '串联阀', 8, '#5d4037');
        this._label(g, x0 + par - 8, Y(42), '并联阀', 8, '#5d4037');

        this._line(g, [x0 + S.x + S.w / 2, Y(S.y), x0 + S.x + S.w / 2, Y(170), x0 + par - 24, Y(170), x0 + par - 24, Y(27)], this.ORANGE, 1.2, [4, 3]);
        this._line(g, [x0 + S.x + S.w / 2, Y(160), x0 + serL - 24, Y(160), x0 + serL - 24, Y(27)], this.ORANGE, 1.2, [4, 3]);
    }

    _createDynamicNodes() {
        const d = this._dynamicGroup, G = this._geo;

        this._rudder = new Konva.Group({ x: G.rudder.cx, y: G.rudder.cy });
        this._rudder.add(new Konva.Line({ points: [0, -97, 0, 40], stroke: '#37474f', strokeWidth: 12, lineCap: 'round' }));
        this._rudder.add(new Konva.Line({
            points: [0, 30, 26, 66, 22, 112, 0, 130, -22, 112, -26, 66],
            closed: true, fill: '#2e9b4b', stroke: '#1b5e20', strokeWidth: 2,
        }));
        this._rudder.add(new Konva.Line({ points: [-42, 35, 42, 35], stroke: '#1b5e20', strokeWidth: 6, lineCap: 'round' }));
        d.add(this._rudder);

        this._ramRods = [];
        const R = G.rams;
        R.ys.forEach(y => {
            const l = new Konva.Group({ x: 0, y: 0 });
            l.add(new Konva.Rect({ x: R.leftRodX, y: y - R.rodH / 2, width: R.rodW, height: R.rodH, fill: '#d7d9d6', stroke: '#6d6f6c', strokeWidth: 1.2 }));
            l.add(new Konva.Rect({ x: R.leftRodX - 10, y: y - R.rodH, width: R.pistonW, height: R.rodH * 2, fill: '#9aa0a0', stroke: '#4d4f4d', strokeWidth: 1 }));
            d.add(l);
            const r = new Konva.Group({ x: 0, y: 0 });
            r.add(new Konva.Rect({ x: R.rightRodX, y: y - R.rodH / 2, width: R.rodW, height: R.rodH, fill: '#d7d9d6', stroke: '#6d6f6c', strokeWidth: 1.2 }));
            r.add(new Konva.Rect({ x: R.rightRodX + R.rodW - R.pistonW + 10, y: y - R.rodH, width: R.pistonW, height: R.rodH * 2, fill: '#9aa0a0', stroke: '#4d4f4d', strokeWidth: 1 }));
            d.add(r);
            this._ramRods.push({ l, r });
        });

        this._needle = new Konva.Group({ x: G.gauge.cx, y: G.gauge.cy });
        this._needle.add(new Konva.Line({ points: [0, 8, 0, -72], stroke: '#b71c1c', strokeWidth: 4, lineCap: 'round' }));
        this._needle.add(new Konva.Circle({ radius: 7, fill: '#263238', stroke: '#111', strokeWidth: 1 }));
        d.add(this._needle);

        this._rudderText = new Konva.Text({
            x: G.gauge.textX, y: G.gauge.textY, width: G.gauge.textW,
            text: '0.0', fontSize: 13, fontStyle: 'bold',
            fill: '#0d47a1', align: 'center', fontFamily: 'Consolas, monospace',
        });
        d.add(this._rudderText);

        this._unitDyn = [];
        G.units.forEach(u => {
            const x0 = u.x0, y0 = u.y0, n = u.n;
            const T = G.layout.tank, U = G.layout.unload, V4 = G.layout.valve4, S = G.layout.isolation;
            const oil = new Konva.Rect({ x: x0 + T.x + 4, y: y0 + T.y + T.h - 8, width: T.w - 8, height: 0, fill: '#e0b52a', listening: false });
            d.add(oil);

            const pt = G.layout.pressureText;
            const gt = new Konva.Text({
                x: x0 + pt.x, y: y0 + pt.y, width: pt.w,
                text: 'P 0.0', fontSize: 10, fill: '#6d4c41', align: 'center', fontFamily: 'Consolas, monospace',
            });
            d.add(gt);

            const rotor = new Konva.Group({ x: x0 + G.layout.pump.cx, y: y0 + G.layout.pump.cy });
            rotor.add(new Konva.Line({ points: [0, -12, 0, 12], stroke: '#5d4037', strokeWidth: 4, lineCap: 'round' }));
            rotor.add(new Konva.Line({ points: [-10, 7, 10, 7], stroke: '#5d4037', strokeWidth: 3, lineCap: 'round' }));
            d.add(rotor);

            const SV = G.layout.servo;
            const srotor = new Konva.Group({ x: x0 + SV.pump.cx, y: y0 + SV.pump.cy });
            srotor.add(new Konva.Line({ points: [0, -10, 0, 10], stroke: '#7f4f0a', strokeWidth: 3, lineCap: 'round' }));
            d.add(srotor);

            const runLamp = new Konva.Circle({ x: x0 + 26, y: y0 + 26, radius: 5, fill: '#0a2f0a', stroke: '#333', strokeWidth: 1 });
            d.add(runLamp);

            const mkInd = (v, half) => new Konva.Rect({
                x: x0 + v.x + (half ? v.w / 2 + 2 : 3), y: y0 + v.y + 4,
                width: v.w / 2 - 5, height: v.h - 8,
                stroke: '#1b5e20', strokeWidth: 2.2, fill: 'rgba(46,155,75,0.16)', listening: false,
            });
            const unloadInd = mkInd(U, false);
            const v4Ind = mkInd(V4, true);
            const isoInd = mkInd(S, false);
            d.add(unloadInd, v4Ind, isoInd);

            const sl = new Konva.Circle({ x: x0 + G.layout.seriesL.x + 11, y: y0 + 26, radius: 5, fill: '#c62828', stroke: '#333', strokeWidth: 1 });
            const sr = new Konva.Circle({ x: x0 + G.layout.seriesR.x + 11, y: y0 + 26, radius: 5, fill: '#c62828', stroke: '#333', strokeWidth: 1 });
            const pl = new Konva.Circle({ x: x0 + G.layout.parallel.x + 11, y: y0 + 48, radius: 5, fill: '#2e9b4b', stroke: '#333', strokeWidth: 1 });
            d.add(sl, sr, pl);

            this._unitDyn.push({ n, oil, pressureText: gt, rotor, srotor, runLamp, unloadInd, v4Ind, isoInd, seriesL: sl, seriesR: sr, parallel: pl });
        });
    }

    _registerParts() {
        const P = this._geo.parts;
        this.addClickablePart('pump1', P.pump1.x, P.pump1.y, P.pump1.w, P.pump1.h, false);
        this.addClickablePart('pump2', P.pump2.x, P.pump2.y, P.pump2.w, P.pump2.h, false);
        this.addClickablePart('rudder', P.rudder.x, P.rudder.y, P.rudder.w, P.rudder.h, false);
    }

    _solver() {
        return this.sys && this.sys.steerSolver ? this.sys.steerSolver : null;
    }

    _syncVisuals() {
        const s = this._solver();
        if (!s) return;
        const m = s.m, G = this._geo;

        const r = clamp(m.displayRudder, -40, 40);
        this._needle.rotation(r);
        this._rudderText.text((r >= 0 ? '+' : '') + r.toFixed(1));
        this._rudder.rotation(m.rudder * 0.85);

        const shift = m.rudder * 1.1;
        this._ramRods.forEach(pair => {
            pair.l.x(shift);
            pair.r.x(-shift);
        });

        this._unitDyn.forEach(d => {
            const p = m.pump[d.n];
            const active = m.sys === d.n;
            const T = G.layout.tank;
            const h = (T.h - 8) * clamp(p.oil / 100, 0.08, 1);
            d.oil.height(h);
            d.oil.y(G.units[d.n - 1].y0 + T.y + T.h - 4 - h);
            d.pressureText.text('P ' + p.pressure.toFixed(1));
            d.runLamp.fill(p.running ? '#25e04a' : '#0a2f0a');
            if (p.running) {
                d.rotor.rotation((d.rotor.rotation() + 13) % 360);
                d.srotor.rotation((d.srotor.rotation() + 16) % 360);
            }

            const u = G.units[d.n - 1], U = G.layout.unload, V4 = G.layout.valve4, S = G.layout.isolation;
            d.unloadInd.x(u.x0 + U.x + (active ? 3 : U.w / 2 + 2));
            d.v4Ind.x(u.x0 + V4.x + (active ? V4.w / 2 + 2 : 3));
            d.isoInd.x(u.x0 + S.x + (active ? 3 : S.w / 2 + 2));
            d.seriesL.fill(active ? '#25e04a' : '#c62828');
            d.seriesR.fill(active ? '#25e04a' : '#c62828');
            d.parallel.fill(active ? '#c62828' : '#25e04a');
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

export default HydraulicSteeringSystem;
