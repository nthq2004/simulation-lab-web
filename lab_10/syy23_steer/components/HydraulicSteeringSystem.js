import { BaseComponent } from './BaseComponent.js';

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

export class HydraulicSteeringSystem extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.W = Math.max(1100, config.width || 1250);
        this.H = Math.max(700, config.height || 850);
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
            gauge: { cx: 660, cy: 420, r: 85, textX: 630, textY: 465, textW: 60 },
            units: [
                { n: 1, x0: 60, y0: 330, w: 580, h: 500 },
                { n: 2, x0: 640, y0: 330, w: 580, h: 500 },
            ],
            layout: {
                tank: { x: 110, y: 300, w: 70, h: 160 },
                fill: { x: 52, y: 319, plateH: 22 },
                fillValve: { x: 84, y: 330, s: 7 },
                leakValve: { x: 72, y: 445, s: 7 },
                motor: { cx: 290, cy: 460, r: 19.2 },
                pump: { cx: 290, cy: 390, r: 30 },
                pressureText: { x: 260, y: 260, w: 90 },
                valve4: { x: 268.4, y: 107.5, w: 86.4, h: 30 },
                unload: { x: 382.8, y: 187.5, w: 86.4, h: 30 },
                isolation: { x: 420, y: 30, w: 72, h: 44 },
                checkL: { x: 120, y: 80 }, checkR: { x: 360, y: 80 },
                reliefL: { x: 180, y: 80 }, reliefR: { x: 300, y: 80 },
                seriesL: { x: 120, y: 30 }, seriesR: { x: 360, y: 30 },
                parallel: { x: 240, y: 30 },
                servo: {
                    pump: { cx: 415, cy: 410, r: 22.8 },
                    motor: { cx: 415, cy: 455, r: 16.8 },
                    tank: { x: 375, y: 470 },
                    piston: { x: 370.5, y: 281.6, w: 84, h: 28.8 },
                    pilot: { x: 420, y: 333.8, w: 30, h: 26.4 },
                },
            },
            parts: {
                pump1: { x: 60, y: 330, w: 580, h: 500 },
                pump2: { x: 640, y: 330, w: 580, h: 500 },
                rudder: { x: 600, y: 70, w: 120, h: 240 },
            },
        };
    }

    _label(g, x, y, text, size = 11, fill = '#4e342e', bold = false, align = 'left', width = 0) {
        size += 3;
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

    _spring(g, x, y, dir, len = 14, n = 5) {
        const step = len / n;
        const pts = [x, y];
        for (let i = 1; i <= n; i++) {
            pts.push(x + dir * step * i, y + (i % 2 ? -3.5 : 3.5));
        }
        pts.push(x + dir * len, y);
        g.add(new Konva.Line({ points: pts, stroke: '#3f4b4f', strokeWidth: 1.3, lineJoin: 'round' }));
    }

    _stopValve(g, x, y, s = 8, rot = 0) {
        const grp = new Konva.Group({ x, y, rotation: rot });
        const k = s / 8;
        const hw = 12 * k, hh = 9 * k;
        grp.add(new Konva.Rect({ x: -hw, y: -4 * k, width: hw * 2, height: 8 * k, fill: '#ffffff', listening: false }));
        grp.add(new Konva.Line({ points: [-hw, -hh, -hw, hh, 0, 0, -hw, -hh], closed: true, fill: '#ffffff', stroke: '#d35400', strokeWidth: 1.5 }));
        grp.add(new Konva.Line({ points: [hw, -hh, hw, hh, 0, 0, hw, -hh], closed: true, fill: '#ffffff', stroke: '#d35400', strokeWidth: 1.5 }));
        grp.add(new Konva.Line({ points: [0, 0, 0, -15 * k], stroke: '#d35400', strokeWidth: 1.5 }));
        grp.add(new Konva.Line({ points: [-7 * k, -15 * k, 7 * k, -15 * k], stroke: '#d35400', strokeWidth: 2 }));
        g.add(grp);
    }

    _smallTank(g, x, y) {
        g.add(new Konva.Line({ points: [x - 7, y, x - 7, y + 11, x + 7, y + 11, x + 7, y], stroke: '#3f4b4f', strokeWidth: 1.3 }));
    }

    _drawMakeup(g, x, y) {
        g.add(new Konva.Circle({ x, y, radius: 7, fill: '#ffffff', stroke: '#3f4b4f', strokeWidth: 1.3 }));
        g.add(new Konva.Line({ points: [x - 12.66, y - 4.22, x, y + 10.5], stroke: '#3f4b4f', strokeWidth: 1.3 }));
        g.add(new Konva.Line({ points: [x + 12.66, y - 4.22, x, y + 10.5], stroke: '#3f4b4f', strokeWidth: 1.3 }));
        this._line(g, [x, y + 10.5, x, y + 18], this.ORANGE, 1.5);
        g.add(new Konva.Line({ points: [x - 7, y + 18, x - 7, y + 29, x + 7, y + 29, x + 7, y + 18], stroke: '#3f4b4f', strokeWidth: 1.3 }));
        g.add(new Konva.Rect({ x: x - 6, y: y + 23, width: 12, height: 6, fill: '#e0b52a', listening: false }));
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

    _reliefSymbol(g, x, y, w, h, opts = {}) {
        const dark = '#3f4b4f';
        const dir = opts.dir || 1;
        g.add(new Konva.Rect({ x, y, width: w, height: h, fill: '#eef0ed', stroke: dark, strokeWidth: 1.5 }));
        const cy = y + h / 2;
        const seatX = dir > 0 ? x + w * 0.55 : x + w * 0.45;

        this._line(g, [seatX, y + 3, seatX, y + h - 3], dark, 1.6);
        const inX = dir > 0 ? x + w - 1 : x + 1;
        this._line(g, [inX, cy, seatX, cy], dark, 1.6);
        g.add(new Konva.Line({
            points: [seatX - dir * 6, cy - 4, seatX, cy, seatX - dir * 6, cy + 4],
            closed: true, fill: dark, stroke: dark, strokeWidth: 1,
        }));

        if (dir > 0) this._spring(g, seatX - 2, cy, -1, seatX - x - 5, 7);
        else this._spring(g, seatX + 2, cy, 1, x + w - 5 - seatX, 7);

        if (opts.label) {
            if (opts.labelLeft) this._label(g, x - 34, y + h / 2 - 6, opts.label, 8, '#5d4037', true);
            else if (opts.labelRight) this._label(g, x + w + 2, y + h / 2 - 6, opts.label, 8, '#5d4037', true);
            else this._label(g, x - 2, y - 12, opts.label, 8, '#5d4037', true);
        }
    }

    _makeupCheck(g, x, y, rotation = 0, scale = 1) {
        const grp = new Konva.Group({ x, y, rotation, scaleX: scale, scaleY: scale });
        grp.add(new Konva.Circle({ x: 0, y: 0, radius: 7, fill: '#ffffff', stroke: '#3f4b4f', strokeWidth: 1.3 }));
        grp.add(new Konva.Line({ points: [-12.66, -4.22, 0, 10.5], stroke: '#3f4b4f', strokeWidth: 1.3 }));
        grp.add(new Konva.Line({ points: [12.66, -4.22, 0, 10.5], stroke: '#3f4b4f', strokeWidth: 1.3 }));
        g.add(grp);
    }

    _drawReliefTank(g, x, y, pipeLen = 14) {
        this._line(g, [x, y, x, y + pipeLen], this.ORANGE, 2);
        g.add(new Konva.Line({
            points: [x - 7, y + pipeLen, x - 7, y + pipeLen + 11, x + 7, y + pipeLen + 11, x + 7, y + pipeLen],
            stroke: '#3f4b4f', strokeWidth: 1.3,
        }));
        g.add(new Konva.Rect({ x: x - 6, y: y + pipeLen + 5, width: 12, height: 6, fill: '#e0b52a', listening: false }));
    }

    _valve22(g, cx, y, opts = {}) {
        const sw = opts.w || 16, sh = opts.h || 20;
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

    _valve34(g, cx, y) {
        const w = 108, h = 26.4, sw = w / 3;
        const x = cx - w / 2;
        const dark = '#3f4b4f';
        for (let i = 0; i < 3; i++) {
            g.add(new Konva.Rect({ x: x + i * sw, y, width: sw, height: h, fill: '#eef0ed', stroke: dark, strokeWidth: 1.5 }));
        }

        const q1 = x + sw + sw / 4;
        const q3 = x + sw + sw * 3 / 4;

        const l1 = x + sw / 4, l2 = x + sw * 3 / 4;
        g.add(new Konva.Line({ points: [l1, y, l2, y + h], stroke: dark, strokeWidth: 1.4 }));
        g.add(new Konva.Line({ points: [l1, y + h, l2, y], stroke: dark, strokeWidth: 1.4 }));
        g.add(new Konva.Line({ points: [l1 + 6, y + 4, l1, y, l1 + 1, y + 6], stroke: dark, strokeWidth: 1.4 }));
        g.add(new Konva.Line({ points: [l1 + 6, y + h - 4, l1, y + h, l1 + 1, y + h - 6], stroke: dark, strokeWidth: 1.4 }));

        g.add(new Konva.Line({ points: [q1, y, q3, y + h], stroke: dark, strokeWidth: 1.4 }));
        const mmx = (q1 + q3) / 2, mmy = y + h / 2;
        g.add(new Konva.Line({ points: [mmx + 6, mmy + 4, mmx, mmy, mmx + 1, mmy + 6], stroke: dark, strokeWidth: 1.4 }));
        g.add(new Konva.Line({ points: [q1 - 5, y + h - 6, q1 + 5, y + h - 6], stroke: dark, strokeWidth: 1.4 }));
        g.add(new Konva.Line({ points: [q1, y + h - 6, q1, y + h], stroke: dark, strokeWidth: 1.4 }));
        g.add(new Konva.Line({ points: [q3 - 5, y + 6, q3 + 5, y + 6], stroke: dark, strokeWidth: 1.4 }));
        g.add(new Konva.Line({ points: [q3, y + 6, q3, y], stroke: dark, strokeWidth: 1.4 }));

        const r1 = x + 2 * sw + sw / 4, r2 = x + 2 * sw + sw * 3 / 4;
        g.add(new Konva.Line({ points: [r1, y, r1, y + 6, r2, y + 6], stroke: dark, strokeWidth: 1.4 }));
        g.add(new Konva.Line({ points: [r2, y, r2, y + h], stroke: dark, strokeWidth: 1.4 }));
        g.add(new Konva.Line({ points: [r2 - 3.8, y + h / 2 + 4.8, r2, y + h / 2, r2 + 3.8, y + h / 2 + 4.8], stroke: dark, strokeWidth: 1.4 }));
    }

    _valve42(g, x, y, w, h) {
        const hw = w / 2;
        const dark = '#3f4b4f';
        g.add(new Konva.Rect({ x, y, width: hw, height: h, fill: '#eef0ed', stroke: dark, strokeWidth: 1.5 }));
        g.add(new Konva.Rect({ x: x + hw, y, width: hw, height: h, fill: '#eef0ed', stroke: dark, strokeWidth: 1.5 }));

        const lq1 = x + hw * 0.25, lq2 = x + hw * 0.75;
        [lq1, lq2].forEach(px => {
            this._line(g, [px, y, px, y + 10], dark, 1.5);
            this._line(g, [px - 6, y + 10, px + 6, y + 10], dark, 1.5);
        });
        this._line(g, [lq1, y + h, lq1, y + h - 8, lq2, y + h - 8, lq2, y + h], dark, 1.5);

        const rq1 = x + hw + hw * 0.25, rq2 = x + hw + hw * 0.75;
        this._line(g, [rq1, y, rq1, y + h], dark, 1.5);
        this._line(g, [rq2, y, rq2, y + h], dark, 1.5);
    }

    _valveX(g, x, y, w, h) {
        const hw = w / 2;
        const dark = '#3f4b4f';
        g.add(new Konva.Rect({ x, y, width: hw, height: h, fill: '#eef0ed', stroke: dark, strokeWidth: 1.5 }));
        g.add(new Konva.Rect({ x: x + hw, y, width: hw, height: h, fill: '#eef0ed', stroke: dark, strokeWidth: 1.5 }));

        const lq1 = x + hw * 0.25, lq2 = x + hw * 0.75;
        this._line(g, [lq1, y, lq2, y + h], dark, 1.5);
        this._line(g, [lq1, y + h, lq2, y], dark, 1.5);
        this._line(g, [lq2 - 6, y + 4, lq2, y, lq2 - 1, y + 6], dark, 1.5);
        this._line(g, [lq2 - 6, y + h - 4, lq2, y + h, lq2 - 1, y + h - 6], dark, 1.5);

        const rq1 = x + hw + hw * 0.25, rq2 = x + hw + hw * 0.75;
        this._line(g, [rq1, y, rq1, y + h], dark, 1.5);
        this._line(g, [rq1 + 3.8, y + h / 2 + 4.8, rq1, y + h / 2, rq1 - 3.8, y + h / 2 + 4.8], dark, 1.5);
        this._line(g, [rq2, y, rq2, y + h], dark, 1.5);
        this._line(g, [rq2 - 3.8, y + h / 2 - 4.8, rq2, y + h / 2, rq2 + 3.8, y + h / 2 - 4.8], dark, 1.5);
    }

    _valve22(g, x, y, w, h, openSide = 'left') {
        const hw = w / 2;
        const dark = '#3f4b4f';
        g.add(new Konva.Rect({ x, y, width: w, height: h, fill: '#eef0ed', stroke: dark, strokeWidth: 1.5 }));
        // 两个阀位的绿色高亮（默认隐藏，由 _syncVisuals 按压力信号切换显示）
        const hlLeft = new Konva.Rect({
            x, y, width: hw, height: h, fill: 'rgba(46,155,75,0.22)', listening: false, visible: false,
        });
        const hlRight = new Konva.Rect({
            x: x + hw, y, width: hw, height: h, fill: 'rgba(46,155,75,0.22)', listening: false, visible: false,
        });
        g.add(hlLeft, hlRight);
        this._line(g, [x + hw, y, x + hw, y + h], dark, 1.5);

        const openX = openSide === 'left' ? x + hw / 2 : x + hw + hw / 2;
        this._line(g, [openX, y, openX, y + h], dark, 1.6);

        const closeX = openSide === 'left' ? x + hw + hw / 2 : x + hw / 2;
        this._line(g, [closeX, y, closeX, y + 8], dark, 1.6);
        this._line(g, [closeX - 6, y + 8, closeX + 6, y + 8], dark, 1.6);
        this._line(g, [closeX, y + h, closeX, y + h - 8], dark, 1.6);
        this._line(g, [closeX - 6, y + h - 8, closeX + 6, y + h - 8], dark, 1.6);
        return { hlLeft, hlRight };
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
                    String(Math.abs(v)), 10, '#263238', false, 'center', 20);
            }
        }
        this._label(g, GA.cx - 40, GA.cy - 6, 'P', 11, '#b71c1c', true, 'center', 20);
        this._label(g, GA.cx + 20, GA.cy - 6, 'S', 11, '#1b5e20', true, 'center', 20);
        this._label(g, GA.cx - 28, GA.cy + 68, 'JSSC', 9, '#c62828', true, 'center', 56);

        G.units.forEach(u => this._drawUnit(g, u));
        this._drawUnitLinks(g);
        this._drawSteeringGearActuator(g, 640, 42);
        this._drawCylinderPowerLines(g);

        this._label(g, 20, H - 16, '液压管路（橙色）  ·  1# / 2# 液压动力单元主油路并联  ·  四缸驱动舵柄与舵叶', 10, '#6d4c41');
    }

    // 1#、2# 液压动力单元并联：两并联阀的左右管路分别上引、右行、下引互连
    _drawUnitLinks(g) {
        const G = this._geo, P = G.layout.pump, V4 = G.layout.valve4;
        if (!G.units || G.units.length < 2) return;
        const u1 = G.units[0], u2 = G.units[1];
        const portY = (u) => u.y0 + V4.y - 260;
        const y1 = portY(u1), y2 = portY(u2);
        const l1 = u1.x0 + P.cx - 45, r1 = u1.x0 + P.cx + 45;
        const l2 = u2.x0 + P.cx - 45, r2 = u2.x0 + P.cx + 45;
        const topLeft = y1 - 42.5, topRight = y1 - 32.5;
        this._line(g, [l1, y1, l1, topLeft, l2, topLeft, l2, y2], this.ORANGE, 2);
        this._line(g, [r1, y1, r1, topRight, r2, topRight, r2, y2], this.ORANGE, 2);
    }

    // ===== 油流方向键动画 =====
    _pathLen(pts) {
        let L = 0;
        for (let i = 2; i < pts.length; i += 2) L += Math.hypot(pts[i] - pts[i - 2], pts[i + 1] - pts[i - 1]);
        return L;
    }

    _samplePath(pts, s) {
        let rem = s;
        for (let i = 2; i < pts.length; i += 2) {
            const x0 = pts[i - 2], y0 = pts[i - 1], x1 = pts[i], y1 = pts[i + 1];
            const dx = x1 - x0, dy = y1 - y0;
            const len = Math.hypot(dx, dy);
            if (len > 0 && rem <= len) {
                const t = rem / len;
                return { x: x0 + dx * t, y: y0 + dy * t, ang: Math.atan2(dy, dx) * 180 / Math.PI };
            }
            rem -= len;
        }
        const n = pts.length;
        return { x: pts[n - 2], y: pts[n - 1], ang: 0 };
    }

    _buildFlowPaths() {
        const V4 = this._geo.layout.valve4;
        const v4Top = 330 + V4.y;
        const v4Bot = v4Top + V4.h;
        const jogTop = v4Top - 20;
        const jogBot = v4Bot + 10;
        const HY = 327.5;
        const BR = 330 + V4.y - 260;
        const LINK_L = BR - 42.5;
        const LINK_R = BR - 32.5;
        const L1 = 305, R1 = 395, L2 = 885, R2 = 975;
        const v4L1 = 339.2, v4R1 = 360.8, v4L2 = 919.2, v4R2 = 940.8;
        const pumpY = 720;   // 泵的进出油口（泵两侧水平接管处）
        const RED = '#e53935', GRN = '#43a047';
        const trunk1R = [R1, pumpY, R1, jogBot, v4R1, jogBot, v4R1, v4Bot, v4R1, v4Top, v4R1, jogTop, R1, jogTop, R1, HY];
        const trunk1L = [L1, jogTop, v4L1, jogTop, v4L1, v4Top, v4L1, jogBot, L1, jogBot, L1, pumpY];
        const trunk2R = [R2, pumpY, R2, jogBot, v4R2, jogBot, v4R2, v4Bot, v4R2, v4Top, v4R2, jogTop, R2, jogTop, R2, HY];
        const trunk2L = [L2, jogTop, v4L2, jogTop, v4L2, v4Top, v4L2, jogBot, L2, jogBot, L2, pumpY];
        return [
            { // 1# 进油：泵右 → 四通阀 → 动力管 → 左下缸
                color: RED, unit: 1,
                pts: trunk1R.concat([632, HY, 632, 96, 508, 96, 508, 60, 522, 60]),
            },
            { // 1# 回油：右下缸 → 动力管 → 四通阀 → 泵左
                color: GRN, unit: 1,
                pts: [758, 60, 802, 60, 802, 78, 258, 78, 258, HY, L1, HY].concat(trunk1L),
            },
            { // 2# 进油：泵右 → 四通阀 → 动力管 → 右上缸
                color: RED, unit: 2,
                pts: trunk2R.concat([1212, HY, 1212, 24, 758, 24]),
            },
            { // 2# 回油：左上缸 → 动力管 → 四通阀 → 泵左
                color: GRN, unit: 2,
                pts: [522, 24, 496, 24, 496, 108, 828, 108, 828, HY, L2, HY].concat(trunk2L),
            },
            { // 跨机进油 1→2：1# 右串联阀 → 右侧互连 → 2# 右串联阀 → 2# 右动力管 → 右上缸
                color: RED, need: 's1', unit: 0,
                pts: [R1, HY, R1, BR, R1, LINK_R, R2, LINK_R, R2, BR, R2, HY, 1212, HY, 1212, 24, 758, 24],
            },
            { // 跨机进油 2→1：2# 右串联阀 → 右侧互连 → 1# 右串联阀 → 1# 右动力管 → 左下缸
                color: RED, need: 's2', unit: 0,
                pts: [R2, HY, R2, BR, R2, LINK_R, R1, LINK_R, R1, BR, R1, HY, 632, HY, 632, 96, 508, 96, 508, 60, 522, 60],
            },
            { // 跨机回油 2→1：左上缸 → 2# 左串联阀 → 左侧互连 → 1# 左串联阀 → 1# 泵
                color: GRN, need: 's1', unit: 0,
                pts: [522, 24, 496, 24, 496, 108, 828, 108, 828, HY, L2, HY,
                    L2, BR, L2, LINK_L, L1, LINK_L, L1, BR, L1, HY],
            },
            { // 跨机回油 1→2：右下缸 → 1# 左串联阀 → 左侧互连 → 2# 左串联阀 → 2# 泵
                color: GRN, need: 's2', unit: 0,
                pts: [758, 60, 802, 60, 802, 78, 258, 78, 258, HY, L1, HY,
                    L1, BR, L1, LINK_L, L2, LINK_L, L2, BR, L2, HY],
            },
            { // 1# 四通阀左位旁通
                color: RED, bypass: true, unit: 1,
                pts: [R1, pumpY, R1, jogBot, v4R1, jogBot, v4R1, v4Bot, v4R1, v4Bot - 15,
                    v4L1, v4Bot - 15, v4L1, v4Bot, v4L1, jogBot, L1, jogBot, L1, pumpY],
            },
            { // 2# 四通阀左位旁通
                color: RED, bypass: true, unit: 2,
                pts: [R2, pumpY, R2, jogBot, v4R2, jogBot, v4R2, v4Bot, v4R2, v4Bot - 15,
                    v4L2, v4Bot - 15, v4L2, v4Bot, v4L2, jogBot, L2, jogBot, L2, pumpY],
            },
            { // 1# 隔离：2# 右串联阀 → 右侧互连 → 1# 并联阀（导通） → 左侧互连 → 2# 左串联阀
                color: RED, need: 'iso1', unit: 0,
                pts: [R2, HY, R2, BR, R2, LINK_R, R1, LINK_R, R1, BR,
                    365, BR, 335, BR, L1, BR, L1, LINK_L, L2, LINK_L, L2, BR, L2, HY],
            },
            { // 2# 隔离：1# 右串联阀 → 右侧互连 → 2# 并联阀（导通） → 左侧互连 → 1# 左串联阀
                color: RED, need: 'iso2', unit: 0,
                pts: [R1, HY, R1, BR, R1, LINK_R, R2, LINK_R, R2, BR,
                    945, BR, 915, BR, L2, BR, L2, LINK_L, L1, LINK_L, L1, BR, L1, HY],
            },
        ];
    }

    _createFlowMarks(d) {
        const paths = this._buildFlowPaths();
        const marks = [];
        paths.forEach((p) => {
            const L = this._pathLen(p.pts);
            const n = Math.max(2, Math.round(L / 40));
            for (let k = 0; k < n; k++) {
                const tri = new Konva.Line({
                    points: [-5, -4.5, 5, 0, -5, 4.5], closed: true,
                    fill: p.color, listening: false, opacity: 0.95, visible: false,
                });
                d.add(tri);
                marks.push({ tri, pts: p.pts, offset: (k * L) / n, bypass: !!p.bypass, need: p.need || '', unit: p.unit || 0, cross: !!p.cross, color: p.color });
            }
        });
        this._flow = { marks, t: 0, last: 0 };
    }

    _updateFlow(m) {
        const f = this._flow;
        if (!f) return;
        const now = performance.now();
        const dtf = f.last ? clamp((now - f.last) / 1000, 0, 0.2) : 0;
        f.last = now;
        const err = m.rudderCmd - m.rudder;
        // 斜盘/伺服活塞偏离中位的幅度决定流速
        const devPct = Math.abs((m.servoPos ?? 0.5) - 0.5) / 0.375 * 100;
        const centered = devPct < 1;
        const speedFactor = devPct < 30 ? 0.5 : (devPct > 60 ? 2 : 1);
        const runOf = (i) => !!(m.mainPower && m.pump && m.pump[i] && m.pump[i].running);
        const v4Of = (i) => !!(this._unitDyn && this._unitDyn[i - 1] && this._unitDyn[i - 1].v4Right);
        const run1 = runOf(1), run2 = runOf(2), v4r1 = v4Of(1), v4r2 = v4Of(2);
        const steerCmd = Math.abs(err) > 0.2 || Math.abs(m.steerDir || 0) > 0;   // 含机旁应急操舵
        const actSys = m.activeSys || m.sys;
        const steering1 = actSys === 1 && run1 && v4r1 && !centered && steerCmd;
        const steering2 = actSys === 2 && run2 && v4r2 && !centered && steerCmd;
        const bypass1 = run1 && !v4r1 && (m.activeSys || m.sys) === 1;
        const bypass2 = run2 && !v4r2 && (m.activeSys || m.sys) === 2;
        const isoOf = (i) => {
            const dd = this._unitDyn && this._unitDyn[i];
            return !!(dd && dd.isoState && (dd.isoState.pressed || dd.isoState.coil || dd.isoState.auto));
        };
        const iso1 = isoOf(0), iso2 = isoOf(1);
        const bothOpen = !iso1 && !iso2;
        const dirSign = Math.abs(m.steerDir || 0) > 0 ? Math.sign(m.steerDir) : (err >= 0 ? 1 : -1);   // 应急操舵按本机操舵方向
        f.t += dtf * 26.7 * speedFactor * dirSign;
        f.tB = (f.tB || 0) + dtf * 26.7;
        f.marks.forEach((mk) => {
            let on;
            if (mk.bypass) on = mk.unit === 2 ? bypass2 : bypass1;
            else if (mk.need === 'iso1') on = steering2 && iso1 && !iso2;
            else if (mk.need === 'iso2') on = steering1 && iso2 && !iso1;
            else if (mk.need === 's1') on = steering1 && !iso1 && !iso2;
            else if (mk.need === 's2') on = steering2 && !iso1 && !iso2;
            else if (mk.unit === 1) on = steering1;
            else if (mk.unit === 2) on = steering2;
            else on = false;
            mk.tri.visible(on);
            if (!on) return;
            const L = this._pathLen(mk.pts);
            const base = mk.bypass ? f.tB : f.t;
            const sPos = (((base + mk.offset) % L) + L) % L;
            const pt = this._samplePath(mk.pts, sPos);
            mk.tri.position({ x: pt.x, y: pt.y });
            mk.tri.rotation(pt.ang + (!mk.bypass && dirSign < 0 ? 180 : 0));
        });
    }

    // 四缸驱动舵柄与舵柱（位于两台舵机正上方中央）：缸筒静态，活塞/舵柄动态
    _drawSteeringGearActuator(g, cx, cy) {
        const dark = '#2f3437', barrel = '#4d5257', cap = '#8a7f2e';
        const rowTop = cy - 18, rowBot = cy + 18;
        const halfW = 118, barrelLen = 66, barrelH = 19.5;
        [rowTop, rowBot].forEach((rowY) => {
            [-1, 1].forEach((side) => {
                const bx = side < 0 ? cx - halfW : cx + halfW - barrelLen;
                const by = rowY - barrelH / 2;
                g.add(new Konva.Rect({ x: bx, y: by, width: barrelLen, height: barrelH, fill: barrel, stroke: dark, strokeWidth: 1 }));
                g.add(new Konva.Rect({ x: side < 0 ? bx : bx + barrelLen - 4, y: by, width: 4, height: barrelH, fill: cap, stroke: dark, strokeWidth: 1 }));
            });
        });
    }

    _createActuatorDynamic(d) {
        const cx = 640, cy = 42, rowTop = cy - 18, rowBot = cy + 18;
        const halfW = 118, barrelLen = 66, barrelH = 19.5, rodH = 9;
        const midL = cx - halfW + barrelLen / 2;
        const midR = cx + halfW - barrelLen / 2;
        const oilL = cx - halfW + 5, oilR = cx + halfW - 5;
        const dark = '#2f3437', rod = '#c9ccc9';
        const cyls = [];
        const mk = (rowY, isLeft) => {
            const oil = new Konva.Rect({ x: 0, y: rowY - barrelH / 2 + 1.5, width: 20, height: barrelH - 3, fill: '#e0b52a', listening: false });
            const piston = new Konva.Rect({ x: 0, y: rowY - barrelH / 2 + 0.5, width: 6, height: barrelH - 1, fill: '#e53935', stroke: '#7f1010', strokeWidth: 1 });
            const rodRect = new Konva.Rect({ x: 0, y: rowY - rodH / 2, width: 60, height: rodH, fill: rod, stroke: dark, strokeWidth: 1 });
            d.add(oil, rodRect, piston);
            cyls.push({ oil, piston, rodRect, rowY, isLeft });
        };
        mk(rowTop, true); mk(rowTop, false); mk(rowBot, true); mk(rowBot, false);

        const tiller = new Konva.Group({ x: cx, y: cy });
        tiller.add(new Konva.Shape({
            fill: 'rgba(96,160,60,0.92)', stroke: '#33691e', strokeWidth: 1.1,
            sceneFunc: (ctx, shape) => {
                ctx.beginPath();
                ctx.moveTo(0, -26);
                ctx.quadraticCurveTo(-21, -4, 0, 26);
                ctx.quadraticCurveTo(21, 4, 0, -26);
                ctx.closePath();
                ctx.fillStrokeShape(shape);
            },
        }));
        tiller.add(new Konva.Circle({ x: 0, y: 0, radius: 11, fill: 'rgba(120,150,120,0.95)', stroke: '#2f3437', strokeWidth: 1.5 }));
        tiller.add(new Konva.Circle({ x: 0, y: 0, radius: 5, fill: '#414741' }));
        [-18, 18].forEach((jy) => {
            tiller.add(new Konva.Circle({ x: 0, y: jy, radius: 5, fill: '#6aa84f', stroke: dark, strokeWidth: 1.1 }));
        });
        const arrow = (fromY, toY) => {
            const dir = toY < fromY ? -1 : 1;
            tiller.add(new Konva.Line({ points: [0, fromY, 0, toY], stroke: '#e53935', strokeWidth: 2.6, lineCap: 'round' }));
            tiller.add(new Konva.Line({
                points: [-4, toY - dir * 7, 0, toY, 4, toY - dir * 7],
                stroke: '#e53935', strokeWidth: 2.6, lineCap: 'round', lineJoin: 'round',
            }));
        };
        arrow(-18, -28);
        arrow(18, 28);
        d.add(tiller);

        this._actDyn = { cx, cy, rowTop, halfW, barrelLen, midL, midR, oilL, oilR, cyls, tiller };
    }

    // 1#、2# 舵机动力管路接至四缸（交叉接法）
    _drawCylinderPowerLines(g) {
        const G = this._geo, P = G.layout.pump, V4 = G.layout.valve4;
        const u1 = G.units[0], u2 = G.units[1];
        if (!u1 || !u2) return;
        // 引出点取串联阀与溢流阀之间的中点
        const bot1 = (u1.y0 + V4.y - 170 + u1.y0 + V4.y - 50) / 2;
        const bot2 = (u2.y0 + V4.y - 170 + u2.y0 + V4.y - 50) / 2;
        const l1 = u1.x0 + P.cx - 45, r1 = u1.x0 + P.cx + 45;
        const l2 = u2.x0 + P.cx - 45, r2 = u2.x0 + P.cx + 45;
        const CY = 42, TOP_ROW = CY - 18, BOT_ROW = CY + 18;
        const CX = 640, halfW = 118, barrelLen = 66;
        const cylLeft = CX - halfW, cylRight = CX + halfW;
        const leftInner = cylLeft + barrelLen, rightInner = cylRight - barrelLen;
        // 1# 左 → 右下缸；1# 右 → 左下缸
        this._line(g, [l1, bot1, 258, bot1, 258, 78, 802, 78, 802, BOT_ROW, cylRight, BOT_ROW], this.ORANGE, 3);
        this._line(g, [r1, bot1, 632, bot1, 632, 96, 508, 96, 508, BOT_ROW, cylLeft, BOT_ROW], this.ORANGE, 3);
        // 2# 左 → 左上缸；2# 右 → 右上缸
        this._line(g, [l2, bot2, 828, bot2, 828, 108, 496, 108, 496, TOP_ROW, cylLeft, TOP_ROW], '#1e88e5', 3);
        this._line(g, [r2, bot2, 1212, bot2, 1212, TOP_ROW, cylRight, TOP_ROW], '#1e88e5', 3);
    }

    _drawMainLines(g) {        const G = this._geo;
        const u1 = G.units[0], u2 = G.units[1];
        const yS = u1.y0 + 30;
        const x1L = u1.x0 + 120, x1R = u1.x0 + 360;
        const x2L = u2.x0 + 120, x2R = u2.x0 + 360;
        this._line(g, [x1L, yS, x1L, 172, 390, 172, 390, 98], this.ORANGE, 2.6);
        this._line(g, [x1R, yS, x1R, 176, 750, 176, 750, 98], this.ORANGE, 2.6);
        this._line(g, [x2L, yS, x2L, 180, 570, 180, 570, 168], this.ORANGE, 2.6);
        this._line(g, [x2R, yS, x2R, 184, 930, 184, 930, 168], this.ORANGE, 2.6);
        this._line(g, [570, 180, 570, 98], this.ORANGE, 2.6);
        this._line(g, [930, 184, 930, 98], this.ORANGE, 2.6);
    }

    _drawUnit(g, u) {
        const L = this._geo.layout;
        const x0 = u.x0, y0 = u.y0;

        const T = L.tank;
        g.add(new Konva.Rect({ x: x0 + T.x, y: y0 + T.y, width: T.w, height: T.h, fill: '#e8e4d3', stroke: '#7d6b53', strokeWidth: 2, cornerRadius: 5 }));
        this._label(g, x0 + T.x + 4, y0 + T.y + 12, '油箱', 9, '#5d4037', true);


        const F = L.fill;
        const plateY = y0 + F.y;
        g.add(new Konva.Line({ points: [x0 + F.x, plateY, x0 + F.x, plateY + F.plateH], stroke: '#3f4b4f', strokeWidth: 5, lineCap: 'round' }));
        g.add(new Konva.Line({ points: [x0 + F.x + 10, plateY, x0 + F.x + 10, plateY + F.plateH], stroke: '#3f4b4f', strokeWidth: 5, lineCap: 'round' }));
        this._line(g, [x0 + F.x + 10, y0 + 330, x0 + L.fillValve.x, y0 + 330], this.ORANGE, 2);
        this._stopValve(g, x0 + L.fillValve.x, y0 + L.fillValve.y, L.fillValve.s, 0);
        this._line(g, [x0 + L.fillValve.x + 10, y0 + 330, x0 + T.x, y0 + 330], this.ORANGE, 2);
        this._label(g, x0 + F.x, y0 + 300, '注油', 9, '#5d4037', true);

        this._line(g, [x0 + T.x, y0 + 445, x0 + L.leakValve.x, y0 + 445], this.ORANGE, 2);
        this._stopValve(g, x0 + L.leakValve.x, y0 + L.leakValve.y, L.leakValve.s, 0);
        this._label(g, x0 + L.leakValve.x - 8, y0 + 424, '卸油', 9, '#5d4037', true);

        const M = L.motor, P = L.pump;
        g.add(new Konva.Circle({ x: x0 + P.cx, y: y0 + P.cy, radius: P.r, fill: 'rgba(0,0,0,0)', stroke: '#3f4b4f', strokeWidth: 1.8 }));
        g.add(new Konva.Line({ points: [x0 + P.cx + 9.6, y0 + P.cy - 7.2, x0 + P.cx + 9.6, y0 + P.cy + 7.2, x0 + P.cx + P.r - 2.4, y0 + P.cy], closed: true, fill: '#f5b041', stroke: null }));
        g.add(new Konva.Line({ points: [x0 + P.cx - 9.6, y0 + P.cy - 7.2, x0 + P.cx - 9.6, y0 + P.cy + 7.2, x0 + P.cx - P.r + 2.4, y0 + P.cy], closed: true, fill: '#f5b041', stroke: null }));
        this._label(g, x0 + P.cx - 32, y0 + P.cy - 46, '变量泵', 9, '#5d4037', true);

        g.add(new Konva.Circle({ x: x0 + M.cx, y: y0 + M.cy, radius: M.r, fill: '#d7d9d6', stroke: '#4d4f4d', strokeWidth: 2 }));
        this._label(g, x0 + M.cx - 8, y0 + M.cy - 7, 'M', 12, '#263238', true, 'center', 16);

        this._drawMakeup(g, x0 + P.cx + 45, y0 + P.cy + 22);
        this._drawMakeup(g, x0 + P.cx - 45, y0 + P.cy + 22);
        this._line(g, [x0 + P.cx + P.r + 2, y0 + P.cy, x0 + P.cx + 45, y0 + P.cy, x0 + P.cx + 45, y0 + P.cy + 15], this.ORANGE, 1.8);
        this._line(g, [x0 + P.cx - P.r - 2, y0 + P.cy, x0 + P.cx - 45, y0 + P.cy, x0 + P.cx - 45, y0 + P.cy + 15], this.ORANGE, 1.8);

        const shaftTop = y0 + P.cy + P.r;
        const shaftBottom = y0 + M.cy - M.r;
        g.add(new Konva.Line({
            points: [x0 + P.cx, shaftBottom, x0 + P.cx, shaftTop],
            stroke: '#4d4f4d', strokeWidth: 6, lineCap: 'butt',
        }));
        g.add(new Konva.Rect({
            x: x0 + P.cx - 8.4, y: (shaftTop + shaftBottom) / 2 - 6,
            width: 16.8, height: 12, fill: '#9aa0a0', stroke: '#4d4f4d', strokeWidth: 1,
        }));


        const V4 = L.valve4;
        this._label(g, x0 + V4.x + V4.w + 4, y0 + V4.y - 10, '液控四通阀', 9, '#5d4037', true);
        const v4Bottom = y0 + V4.y + V4.h;
        this._line(g, [x0 + P.cx + 45, y0 + P.cy + 15, x0 + P.cx + 45, v4Bottom + 10, x0 + V4.x + V4.w * 0.375, v4Bottom + 10, x0 + V4.x + V4.w * 0.375, v4Bottom], this.ORANGE, 2);
        this._line(g, [x0 + P.cx - 45, y0 + P.cy + 15, x0 + P.cx - 45, v4Bottom + 10, x0 + V4.x + V4.w * 0.125, v4Bottom + 10, x0 + V4.x + V4.w * 0.125, v4Bottom], this.ORANGE, 2);
        const leftPipeX = x0 + V4.x + V4.w * 0.125;
        const rightPipeX = x0 + V4.x + V4.w * 0.375;
        const valveY = y0 + V4.y - 200;
        const valveW = 40, valveH = 30;
        const longLeftX = x0 + P.cx - 45;
        const longRightX = x0 + P.cx + 45;
        // 两阀对准泵—四通阀之间的两根长液压管道，并绕中线对称
        this._line(g, [longLeftX, valveY + valveH, longLeftX, v4Bottom - 50, leftPipeX, v4Bottom - 50, leftPipeX, v4Bottom], this.ORANGE, 2);
        this._line(g, [longRightX, valveY + valveH, longRightX, v4Bottom - 50, rightPipeX, v4Bottom - 50, rightPipeX, v4Bottom], this.ORANGE, 2);
        // 左阀：左位为截止位、右位为导通位；右阀镜像（右位截止、左位导通）
        // 阀体、阀位高亮与复位弹簧均由 _createDynamicNodes 创建（工作位变化时阀体滑移）

        // 并联阀：两串联阀中间、上方，旋转 90° 的两位两通阀（参照左阀）
        const parCx = (longLeftX + longRightX) / 2;
        const parCy = valveY - 50;
        const parPortY = parCy - valveW * 0.25;
        this._line(g, [longLeftX, valveY, longLeftX, parPortY], this.ORANGE, 2);
        this._line(g, [longRightX, valveY, longRightX, parPortY], this.ORANGE, 2);
        this._line(g, [longLeftX, parPortY, parCx - valveH / 2, parPortY], this.ORANGE, 2);
        this._line(g, [longRightX, parPortY, parCx + valveH / 2, parPortY], this.ORANGE, 2);

        // 溢流阀：分别位于四通阀通往左右两位两通阀的管道外侧，距四通阀约 50px
        const reliefY = y0 + V4.y - 50;
        const reliefW = 40, reliefH = 26;
        const reliefX = longLeftX - 36 - reliefW;
        this._line(g, [longLeftX, reliefY, reliefX + reliefW, reliefY], this.ORANGE, 2);
        this._reliefSymbol(g, reliefX, reliefY - reliefH / 2, reliefW, reliefH, { dir: 1, label: '溢流阀', labelLeft: true });
        this._drawReliefTank(g, reliefX + reliefW * 0.3, reliefY + reliefH / 2);

        const reliefRX = longRightX + 36;
        this._line(g, [longRightX, reliefY, reliefRX, reliefY], this.ORANGE, 2);
        this._reliefSymbol(g, reliefRX, reliefY - reliefH / 2, reliefW, reliefH, { dir: -1, label: '溢流阀', labelRight: true });
        this._drawReliefTank(g, reliefRX + reliefW * 0.7, reliefY + reliefH / 2);

        // 补油：左右溢流阀上方各一套，水平单向阀（与变量泵补油单向阀同型），另一端向外转折向下接小油箱
        const makeupY = reliefY - 29.5;
        const cvX = longLeftX - 47;
        const tankCx = longLeftX - 97;
        this._line(g, [longLeftX, makeupY, cvX + 4.2, makeupY], this.ORANGE, 2);
        this._makeupCheck(g, cvX, makeupY, 90);
        this._line(g, [cvX - 10.5, makeupY, tankCx, makeupY], this.ORANGE, 2);
        this._drawReliefTank(g, tankCx, makeupY, 9);

        const cvRX = longRightX + 47;
        const tankRX = longRightX + 97;
        this._line(g, [longRightX, makeupY, cvRX - 4.2, makeupY], this.ORANGE, 2);
        this._makeupCheck(g, cvRX, makeupY, -90);
        this._line(g, [cvRX + 10.5, makeupY, tankRX, makeupY], this.ORANGE, 2);
        this._drawReliefTank(g, tankRX, makeupY, 9);

        // 隔离阀（右串联阀右侧）：与卸荷阀同型的手动/电磁双控两位四通阀
        const isoX = longRightX + 121, isoW = 72, isoH = 28, isoY = valveY;
        // 四个接口均从默认（右侧）阀位引出
        const isoBL = isoX + isoW * 0.625, isoBR = isoX + isoW * 0.875;
        const isoBot = isoY + isoH;
        const isoMidY = isoY + isoH / 2;
        // 左上接口管路在上层、右上接口管路在下层
        const isoTopY = isoY - 24.5, isoUpY = isoY - 12.5;
        const isoCvX = longRightX + 65;
        const isoFarX = longLeftX - 40;
        // 左下：液控四通阀左右两长管各经一个单向阀后合并接入
        const isoBusY1 = isoY + 37.5, isoBusY2 = isoY + 57.5;
        this._line(g, [isoBL, isoBot, isoBL, isoBusY2], this.ORANGE, 2);
        this._line(g, [longLeftX, isoBusY1, isoBL, isoBusY1], this.ORANGE, 2);
        this._makeupCheck(g, isoCvX, isoBusY1, 90, 0.75);
        this._line(g, [longRightX, isoBusY2, isoBL, isoBusY2], this.ORANGE, 2);
        this._makeupCheck(g, isoCvX, isoBusY2, 90, 0.75);
        // 右下：接小油箱
        this._drawReliefTank(g, isoBR, isoBot);
        this._label(g, isoBR + 9, isoBot + 3, '油箱', 7, '#5d4037');
        // 左上、右上液控虚线改由 _createDynamicNodes 创建（阀位切换时随阀体动态调整）
        const U = L.unload;

        const uTop = y0 + U.y;

        const v4Left = x0 + V4.x, v4Right = x0 + V4.x + V4.w;
        const v4MidY = y0 + V4.y + V4.h / 2;
        const v4TwoThirdY = y0 + V4.y + V4.h * 2 / 3;
        const uBottom = y0 + U.y + U.h;
        const uLeftPortX = x0 + U.x + U.w * 0.625;
        const uRightPortX = x0 + U.x + U.w * 0.875;

        const unloadTankY = uBottom + 20;
        this._line(g, [uRightPortX, uBottom, uRightPortX, unloadTankY], this.ORANGE, 1.8);
        this._smallTank(g, uRightPortX, unloadTankY);
        g.add(new Konva.Rect({ x: uRightPortX - 6, y: unloadTankY + 5, width: 12, height: 6, fill: '#e0b52a', listening: false }));
        this._label(g, uRightPortX + 10, unloadTankY + 2, '油箱', 7, '#5d4037');

        this._drawServoUnit(g, x0, y0, L);
    }

    _drawServoUnit(g, x0, y0, L) {
        const S = L.servo;
        g.add(new Konva.Rect({ x: x0 + S.piston.x, y: y0 + S.piston.y, width: S.piston.w, height: S.piston.h, fill: '#d7d9d6', stroke: '#4d4f4d', strokeWidth: 1.4, cornerRadius: 2 }));
        g.add(new Konva.Rect({ x: x0 + S.piston.x + 6, y: y0 + S.piston.y + 2, width: S.piston.w - 12, height: S.piston.h - 4, fill: '#eef0ed' }));
        const pistonLeftX = x0 + S.piston.x;
        const pistonMidY = y0 + S.piston.y + S.piston.h / 2;
        g.add(new Konva.Rect({ x: pistonLeftX - 1.2, y: pistonMidY - 4.5, width: 2.4, height: 9, fill: '#eef0ed', listening: false }));
        this._line(g, [pistonLeftX - 6, pistonMidY - 4.5, pistonLeftX + 6, pistonMidY - 4.5], '#4d4f4d', 2.2);
        this._line(g, [pistonLeftX - 6, pistonMidY + 4.5, pistonLeftX + 6, pistonMidY + 4.5], '#4d4f4d', 2.2);

        const valveLeft = x0 + S.pilot.x - 39;
        const valveRight = x0 + S.pilot.x + 69;
        const valveMidY = y0 + S.pilot.y + S.pilot.h / 2;
        const valveThirdY = y0 + S.pilot.y + S.pilot.h / 3;
        const valveTwoThirdY = y0 + S.pilot.y + S.pilot.h * 2 / 3;

        const pilotMotorCx = valveRight + 79;
        this._label(g, pilotMotorCx - 33, valveThirdY - 30, '力矩马达', 7, '#5d4037');
        g.add(new Konva.Circle({ x: x0 + S.pump.cx, y: y0 + S.pump.cy, radius: S.pump.r, fill: 'rgba(0,0,0,0)', stroke: '#3f4b4f', strokeWidth: 1.8 }));
        g.add(new Konva.Line({ points: [x0 + S.pump.cx + 7.2, y0 + S.pump.cy - 6, x0 + S.pump.cx + 7.2, y0 + S.pump.cy + 6, x0 + S.pump.cx + S.pump.r - 2.4, y0 + S.pump.cy], closed: true, fill: '#f5b041', stroke: null }));
        g.add(new Konva.Circle({ x: x0 + S.motor.cx, y: y0 + S.motor.cy, radius: S.motor.r, fill: '#d7d9d6', stroke: '#4d4f4d', strokeWidth: 1.5 }));
        this._label(g, x0 + S.motor.cx - 6, y0 + S.motor.cy - 5, 'M', 10, '#263238', true, 'center', 12);
        g.add(new Konva.Line({
            points: [x0 + S.pump.cx, y0 + S.pump.cy + S.pump.r, x0 + S.motor.cx, y0 + S.motor.cy - S.motor.r],
            stroke: '#4d4f4d', strokeWidth: 4.8, lineCap: 'butt',
        }));

        this._line(g, [x0 + S.pump.cx - S.pump.r, y0 + S.pump.cy, x0 + S.tank.x, y0 + S.pump.cy, x0 + S.tank.x, y0 + S.tank.y], this.ORANGE, 1.8);
        this._smallTank(g, x0 + S.tank.x, y0 + S.tank.y);
        g.add(new Konva.Rect({ x: x0 + S.tank.x - 6, y: y0 + S.tank.y + 5, width: 12, height: 6, fill: '#e0b52a', listening: false }));
        this._label(g, x0 + S.tank.x - 12, y0 + S.tank.y + 14, '油箱', 7, '#5d4037');

        const valveTop = y0 + S.pilot.y;
        const valveBottom = valveTop + S.pilot.h;
        const portStubY = valveBottom + 8;
        const portL = x0 + S.pilot.x + 6;
        const portR = x0 + S.pilot.x + 24;
        this._line(g, [portL, valveTop - 8, portL, valveTop], this.ORANGE, 2);
        this._line(g, [portR, valveTop - 8, portR, valveTop], this.ORANGE, 2);
        this._line(g, [portL, valveBottom, portL, valveBottom + 8], this.ORANGE, 2);
        this._line(g, [portR, valveBottom, portR, valveBottom + 8], this.ORANGE, 2);
        const cylLeft = x0 + S.piston.x;
        const cylBottom = y0 + S.piston.y + S.piston.h;
        const cyl1_8 = cylLeft + S.piston.w / 8;
        const pumpRight = x0 + S.pump.cx + S.pump.r;
        const pumpCy = y0 + S.pump.cy;
        const tankX = x0 + S.tank.x;
        const U = L.unload;
        const unloadPortX = x0 + U.x + U.w * 0.625;
        const unloadPortY = y0 + U.y + U.h;
        const motorRightX = pilotMotorCx + 14.8;

        this._line(g, [portR, valveBottom, portR, pumpCy], this.ORANGE, 1.8);
        this._line(g, [pumpRight, pumpCy, motorRightX, pumpCy, motorRightX, unloadPortY + 45, unloadPortX, unloadPortY + 45, unloadPortX, unloadPortY], this.ORANGE, 1.8);
        this._line(g, [portL, portStubY, tankX, portStubY, tankX, pumpCy], this.ORANGE, 1.8);
        this._line(g, [portL, valveTop, portL, valveTop - 8, cyl1_8, valveTop - 8, cyl1_8, cylBottom], this.ORANGE, 1.8);
        this._line(g, [portR, valveTop, portR, cylBottom], this.ORANGE, 1.8);

        this._label(g, x0 + S.piston.x, y0 + S.piston.y - 14, '伺服活塞', 8, '#5d4037', true);
        this._label(g, x0 + S.pump.cx - 30, y0 + S.pump.cy - 38, '伺服泵', 8, '#5d4037', true);
    }

    _drawMainBranch(g, x0, y0, xL, xR, relL, relR, serL, serR, par, L, V4, S) {
        const Y = (v) => y0 + v;
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

        this._line(g, [x0 + relL, Y(80), x0 + relL, Y(104)], this.ORANGE, 1.5);
        this._line(g, [x0 + relR, Y(80), x0 + relR, Y(104)], this.ORANGE, 1.5);
        this._smallTank(g, x0 + relL, Y(104));
        this._smallTank(g, x0 + relR, Y(104));
        this._label(g, x0 + relL - 12, Y(118), '油箱', 7, '#5d4037');
        this._label(g, x0 + relR - 12, Y(118), '油箱', 7, '#5d4037');

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
    }

    _createDynamicNodes() {
        const d = this._dynamicGroup, G = this._geo;

        this._needle = new Konva.Group({ x: G.gauge.cx, y: G.gauge.cy });
        this._needle.add(new Konva.Line({ points: [0, 8, 0, -72], stroke: '#b71c1c', strokeWidth: 4, lineCap: 'round' }));
        this._needle.add(new Konva.Circle({ radius: 7, fill: '#263238', stroke: '#111', strokeWidth: 1 }));
        d.add(this._needle);

        this._createActuatorDynamic(d);
        this._createFlowMarks(d);

        this._rudderText = new Konva.Text({
            x: G.gauge.textX, y: G.gauge.textY, width: G.gauge.textW,
            text: '0.0', fontSize: 16, fontStyle: 'bold',
            fill: '#0d47a1', align: 'center', fontFamily: 'Consolas, monospace',
        });
        d.add(this._rudderText);

        this._unitDyn = [];
        this._unloadHandles = [];
        G.units.forEach(u => {
            const x0 = u.x0, y0 = u.y0, n = u.n;
            const T = G.layout.tank;
            const unload = G.layout.unload;
            const V4 = G.layout.valve4;
            const oil = new Konva.Rect({ x: x0 + T.x + 4, y: y0 + T.y + T.h - 8, width: T.w - 8, height: 0, fill: '#e0b52a', listening: false });
            d.add(oil);
            const oilText = new Konva.Text({
                x: x0 + T.x + T.w + 6, y: y0 + T.y + 16, text: 'L 85.0', fontSize: 10,
                fill: '#5d4037', fontFamily: 'Consolas, monospace', listening: false,
            });
            const tempText = new Konva.Text({
                x: x0 + T.x + T.w + 6, y: y0 + T.y + 32, text: 'T 35.0', fontSize: 10,
                fill: '#5d4037', fontFamily: 'Consolas, monospace', listening: false,
            });
            d.add(oilText, tempText);

            const mkGreen = (cx, cy, r) => new Konva.Circle({
                x: cx, y: cy, radius: r, fill: 'rgba(46,155,75,0.35)', listening: false, visible: false,
            });
            const greenPump = mkGreen(x0 + G.layout.pump.cx, y0 + G.layout.pump.cy, G.layout.pump.r);
            const greenMotor = mkGreen(x0 + G.layout.motor.cx, y0 + G.layout.motor.cy, G.layout.motor.r);
            const greenServoPump = mkGreen(x0 + G.layout.servo.pump.cx, y0 + G.layout.servo.pump.cy, G.layout.servo.pump.r);
            const greenServoMotor = mkGreen(x0 + G.layout.servo.motor.cx, y0 + G.layout.servo.motor.cy, G.layout.servo.motor.r);
            d.add(greenPump, greenMotor, greenServoPump, greenServoMotor);

            const v4Body = new Konva.Group({ x: x0 + V4.x, y: y0 + V4.y });
            this._valve42(v4Body, 0, 0, V4.w, V4.h);
            const v4HLLeft = new Konva.Rect({ x: 0, y: 0, width: V4.w / 2, height: V4.h, fill: 'rgba(46,155,75,0.22)', listening: false, visible: true });
            const v4HLRight = new Konva.Rect({ x: V4.w / 2, y: 0, width: V4.w / 2, height: V4.h, fill: 'rgba(46,155,75,0.22)', listening: false, visible: false });
            v4Body.add(v4HLLeft, v4HLRight);
            d.add(v4Body);
            const v4Spring = new Konva.Group({ x: x0 + V4.x, y: y0 + V4.y + V4.h / 3 });
            this._spring(v4Spring, 0, 0, -1, 16.8);
            d.add(v4Spring);

            const v4BaseX = x0 + V4.x;
            const v4MidY = y0 + V4.y + V4.h / 2;
            const v4TwoThirdY = y0 + V4.y + V4.h * 2 / 3;
            const uTop = y0 + unload.y;
            const uLeftPortX = x0 + unload.x + unload.w * 0.625;
            const uRightPortX = x0 + unload.x + unload.w * 0.875;
            const v4LeftDash = new Konva.Line({
                points: [uLeftPortX, uTop, uLeftPortX, uTop - 10, v4BaseX - 10, uTop - 10, v4BaseX - 10, v4TwoThirdY, v4BaseX, v4TwoThirdY],
                stroke: this.ORANGE, strokeWidth: 1.2, dash: [4, 3], listening: false,
            });
            const v4RightDash = new Konva.Line({
                points: [uRightPortX, uTop, uRightPortX, v4MidY, v4BaseX + V4.w, v4MidY],
                stroke: this.ORANGE, strokeWidth: 1.2, dash: [4, 3], listening: false,
            });
            d.add(v4LeftDash, v4RightDash);

            const pilot = G.layout.servo.pilot;
            const pilotW = 108, pilotBoxW = pilotW / 3;
            const pilotX = x0 + pilot.x + 15 - pilotW / 2;
            const pilotY = y0 + pilot.y;
            const pilotHL = [0, 1, 2].map(i => new Konva.Rect({
                x: pilotX + i * pilotBoxW, y: pilotY, width: pilotBoxW, height: pilot.h,
                fill: 'rgba(46,155,75,0.22)', listening: false, visible: false,
            }));
            const pilotBody = new Konva.Group({ x: x0 + pilot.x + 15, y: pilotY });
            this._valve34(pilotBody, 0, 0);
            this._spring(pilotBody, -54, pilot.h / 2, -1, 16.8);
            this._spring(pilotBody, 54, pilot.h * 2 / 3, 1, 16.8);
            d.add(pilotBody);
            d.add(...pilotHL);

            const pilotRightBase = x0 + pilot.x + 69;
            const pilotBottom = y0 + pilot.y + pilot.h;
            const pilotLabel = new Konva.Text({
                x: pilotRightBase, y: pilotBottom + 5, text: '先导阀', fontSize: 11,
                fontStyle: 'bold', fill: '#5d4037', fontFamily: 'Arial, sans-serif',
            });
            const pilotMotorY = y0 + pilot.y + pilot.h / 3;
            const pilotMotorDash = new Konva.Line({
                points: [pilotRightBase, pilotMotorY, pilotRightBase + 68.2, pilotMotorY],
                stroke: this.ORANGE, strokeWidth: 1.4, dash: [4, 3], listening: false,
            });
            d.add(pilotLabel, pilotMotorDash);
            const pilotMotorCx = pilotRightBase + 79;
            const pilotMotor = new Konva.Circle({
                x: pilotMotorCx, y: pilotMotorY, radius: 10.8,
                fill: '#d7d9d6', stroke: '#4d4f4d', strokeWidth: 1.5,
            });
            const pilotMotorText = new Konva.Text({
                x: pilotMotorCx - 6, y: pilotMotorY - 7, text: 'M', fontSize: 12,
                fontStyle: 'bold', fill: '#263238', fontFamily: 'Arial, sans-serif',
            });
            d.add(pilotMotor, pilotMotorText);

            const pt = G.layout.pressureText;
            const gt = new Konva.Text({
                x: x0 + pt.x, y: y0 + pt.y, width: pt.w,
                text: 'P 0.0', fontSize: 13, fill: '#6d4c41', align: 'center', fontFamily: 'Consolas, monospace',
            });
            d.add(gt);


            const piston = new Konva.Rect({
                x: 0, y: 0, width: 6, height: 24,
                fill: '#9aa0a0', stroke: '#4d4f4d', strokeWidth: 1.2, cornerRadius: 1,
            });
            const servoLink = new Konva.Line({
                points: [0, 0, 0, 0], stroke: '#7f4f0a', strokeWidth: 3, lineCap: 'round',
            });
            const swashRod = new Konva.Line({
                points: [0, 0, 0, 0], stroke: '#7f4f0a', strokeWidth: 3, lineCap: 'round',
            });
            d.add(piston, servoLink, swashRod);

            const unloadBody = new Konva.Group({ x: x0 + unload.x, y: y0 + unload.y });
            this._valveX(unloadBody, 0, 0, unload.w, unload.h);
            const unloadHLLeft = new Konva.Rect({ x: 0, y: 0, width: unload.w / 2, height: unload.h, fill: 'rgba(46,155,75,0.22)', listening: false, visible: false });
            const unloadHLRight = new Konva.Rect({ x: unload.w / 2, y: 0, width: unload.w / 2, height: unload.h, fill: 'rgba(46,155,75,0.22)', listening: false, visible: true });
            unloadBody.add(unloadHLLeft, unloadHLRight);
            this._spring(unloadBody, unload.w, unload.h / 2, 1, 16.8);
            const coilH = 10, coilTop = unload.h - coilH;
            const coilRect = new Konva.Rect({ x: -14, y: coilTop, width: 14, height: coilH, fill: '#dfe3e0', stroke: '#3f4b4f', strokeWidth: 1.2 });
            unloadBody.add(coilRect);
            this._line(unloadBody, [-14, coilTop + coilH, 0, coilTop], '#3f4b4f', 1.2);
            d.add(unloadBody);

            const state = { pressed: false, coil: false, coilAuto: false, centerTimer: 0, lastTimerT: 0 };
            const handle = new Konva.Group({ x: x0 + unload.x, y: y0 + unload.y + unload.h / 3 - 5 });
            const handleLine = new Konva.Line({
                points: [0, 0, -15, 0], stroke: '#3f4b4f', strokeWidth: 3, lineCap: 'round', hitStrokeWidth: 14,
            });
            const handleKnob = new Konva.Circle({ x: -15, y: 0, radius: 4.5, fill: '#9aa0a0', stroke: '#3f4b4f', strokeWidth: 1.5 });
            handle.add(handleLine, handleKnob);
            const coilHit = new Konva.Rect({
                x: x0 + unload.x - 14, y: y0 + unload.y + coilTop, width: 14, height: coilH,
                fill: 'rgba(0,0,0,0)', listening: true, cursor: 'pointer',
            });

            const baseX = x0 + unload.x, half = unload.w / 2;
            const labelBaseX = baseX + unload.w + 4;
            const unloadLabel = new Konva.Text({
                x: labelBaseX, y: y0 + unload.y - 10, text: '卸荷阀', fontSize: 11,
                fontStyle: 'bold', fill: '#5d4037', fontFamily: 'Arial, sans-serif',
            });
            d.add(unloadLabel);
            const applyState = () => {
                const active = state.pressed || state.coil || state.coilAuto;
                const shift = active ? half : 0;
                unloadBody.x(baseX + shift);
                handle.x(baseX + shift);
                coilHit.x(baseX - 14 + shift);
                unloadLabel.x(labelBaseX + shift);
                const coilOn = state.coil || state.coilAuto;
                coilRect.fill(coilOn ? '#c62828' : '#dfe3e0');
                coilRect.stroke(coilOn ? '#c62828' : '#3f4b4f');
                handleLine.points(state.pressed ? [0, 0, -4, 0] : [0, 0, -15, 0]);
                handleKnob.position({ x: state.pressed ? -4 : -15, y: 0 });
                if (this.sys && this.sys.requestRedraw) this.sys.requestRedraw();
            };
            state.apply = applyState;
            handle.on('mouseenter', () => { if (this.sys && this.sys.stage) this.sys.stage.container().style.cursor = 'pointer'; });
            handle.on('mouseleave', () => { if (this.sys && this.sys.stage) this.sys.stage.container().style.cursor = 'default'; });
            handle.on('mousedown touchstart', (e) => { e.cancelBubble = true; });
            handle.on('mouseup touchend', (e) => { e.cancelBubble = true; });
            handle.on('click tap', (e) => {
                e.cancelBubble = true;
                state.pressed = !state.pressed;
                applyState();
            });
            coilHit.on('mouseenter', () => { if (this.sys && this.sys.stage) this.sys.stage.container().style.cursor = 'pointer'; });
            coilHit.on('mouseleave', () => { if (this.sys && this.sys.stage) this.sys.stage.container().style.cursor = 'default'; });
            coilHit.on('click tap', (e) => {
                e.cancelBubble = true;
                state.coil = !state.coil;
                applyState();
            });
            this._interactGroup.add(handle, coilHit);
            this._unloadHandles.push(handle, coilHit);
            applyState();

            // 隔离阀：与卸荷阀同型（手动 + 电磁双控两位四通阀）
            const isoX = x0 + G.layout.pump.cx + 166, isoY = y0 + V4.y - 200;
            const isoW = 72, isoH = 28;
            const isoBody = new Konva.Group({ x: isoX, y: isoY });
            this._valveX(isoBody, 0, 0, isoW, isoH);
            const isoHLLeft = new Konva.Rect({ x: 0, y: 0, width: isoW / 2, height: isoH, fill: 'rgba(46,155,75,0.22)', listening: false, visible: false });
            const isoHLRight = new Konva.Rect({ x: isoW / 2, y: 0, width: isoW / 2, height: isoH, fill: 'rgba(46,155,75,0.22)', listening: false, visible: true });
            isoBody.add(isoHLLeft, isoHLRight);
            this._spring(isoBody, isoW, isoH / 2, 1, 16.8);
            const isoCoilH = 10, isoCoilTop = isoH - isoCoilH;
            const isoCoil = new Konva.Rect({ x: -14, y: isoCoilTop, width: 14, height: isoCoilH, fill: '#dfe3e0', stroke: '#3f4b4f', strokeWidth: 1.2 });
            isoBody.add(isoCoil);
            this._line(isoBody, [-14, isoCoilTop + isoCoilH, 0, isoCoilTop], '#3f4b4f', 1.2);
            d.add(isoBody);

            // 截止阀接通指示：仅阀体两个三角绿色填充，截止时保持原样
            const mkStopTris = (vx, vy, sv) => {
                const k = sv / 8, hw = 12 * k, hh = 9 * k;
                const t1 = new Konva.Line({ x: vx, y: vy, points: [-hw, -hh, -hw, hh, 0, 0], closed: true, fill: 'rgba(0,0,0,0)', listening: false });
                const t2 = new Konva.Line({ x: vx, y: vy, points: [hw, -hh, hw, hh, 0, 0], closed: true, fill: 'rgba(0,0,0,0)', listening: false });
                d.add(t1, t2);
                return [t1, t2];
            };
            const fillRing = mkStopTris(x0 + G.layout.fillValve.x, y0 + G.layout.fillValve.y, G.layout.fillValve.s || 7);
            const drainRing = mkStopTris(x0 + G.layout.leakValve.x, y0 + G.layout.leakValve.y, G.layout.leakValve.s || 7);

            const isoState = { pressed: false, coil: false, auto: false };
            const isoHandle = new Konva.Group({ x: isoX, y: isoY + isoH / 3 - 5 });
            const isoHandleLine = new Konva.Line({
                points: [0, 0, -15, 0], stroke: '#3f4b4f', strokeWidth: 3, lineCap: 'round', hitStrokeWidth: 14,
            });
            const isoHandleKnob = new Konva.Circle({ x: -15, y: 0, radius: 4.5, fill: '#9aa0a0', stroke: '#3f4b4f', strokeWidth: 1.5 });
            isoHandle.add(isoHandleLine, isoHandleKnob);
            const isoCoilHit = new Konva.Rect({
                x: isoX - 14, y: isoY + isoCoilTop, width: 14, height: isoCoilH,
                fill: 'rgba(0,0,0,0)', listening: true, cursor: 'pointer',
            });
            this._label(d, isoX + isoW + 5, isoY - 16, '隔离阀', 11, '#5d4037', true);

            const isoApply = () => {
                const active = isoState.pressed || isoState.coil || isoState.auto;
                const shift = active ? isoW / 2 : 0;
                isoBody.x(isoX + shift);
                isoHandle.x(isoX + shift);
                isoCoilHit.x(isoX - 14 + shift);
                const coilOn = isoState.coil || isoState.auto;
                isoCoil.fill(coilOn ? '#c62828' : '#dfe3e0');
                isoCoil.stroke(coilOn ? '#c62828' : '#3f4b4f');
                isoHandleLine.points(isoState.pressed ? [0, 0, -4, 0] : [0, 0, -15, 0]);
                isoHandleKnob.position({ x: isoState.pressed ? -4 : -15, y: 0 });
                isoHLLeft.visible(active);
                isoHLRight.visible(!active);
                if (this.sys && this.sys.requestRedraw) this.sys.requestRedraw();
            };
            isoHandle.on('mouseenter', () => { if (this.sys && this.sys.stage) this.sys.stage.container().style.cursor = 'pointer'; });
            isoHandle.on('mouseleave', () => { if (this.sys && this.sys.stage) this.sys.stage.container().style.cursor = 'default'; });
            isoHandle.on('mousedown touchstart', (e) => { e.cancelBubble = true; });
            isoHandle.on('click tap', (e) => { e.cancelBubble = true; isoState.pressed = !isoState.pressed; isoApply(); });
            isoCoilHit.on('mouseenter', () => { if (this.sys && this.sys.stage) this.sys.stage.container().style.cursor = 'pointer'; });
            isoCoilHit.on('mouseleave', () => { if (this.sys && this.sys.stage) this.sys.stage.container().style.cursor = 'default'; });
            isoCoilHit.on('click tap', (e) => { e.cancelBubble = true; isoState.coil = !isoState.coil; isoApply(); });
            this._interactGroup.add(isoHandle, isoCoilHit);
            this._unloadHandles.push(isoHandle, isoCoilHit);
            isoApply();

            // 三个两位两通阀（阀位绿色高亮随压力信号切换）
            const v22Y = y0 + V4.y - 200, v22W = 40, v22H = 30;
            const longL = x0 + G.layout.pump.cx - 45, longR = x0 + G.layout.pump.cx + 45;
            const serLBx = longL - v22W * 0.75, serRBx = longR - v22W * 0.25;
            const serLBody = new Konva.Group({ x: serLBx, y: v22Y });
            const serLHL = this._valve22(serLBody, 0, 0, v22W, v22H, 'right');
            this._spring(serLBody, v22W, v22H / 2, 1, 14);
            const serRBody = new Konva.Group({ x: serRBx, y: v22Y });
            const serRHL = this._valve22(serRBody, 0, 0, v22W, v22H, 'left');
            this._spring(serRBody, 0, v22H / 2, -1, 14);
            const parCy2 = v22Y - 50;
            const parBody = new Konva.Group({ x: (longL + longR) / 2, y: parCy2, rotation: 90 });
            const parHL = this._valve22(parBody, -v22W / 2, -v22H / 2, v22W, v22H, 'left');
            this._spring(parBody, -v22W / 2, 0, -1, 14);
            d.add(serLBody, serRBody, parBody);
            const v22Shift = v22W / 2;

            // 隔离阀液控虚线（端点随阀体滑移动态调整）
            const isoDynX = longR + 121, isoDynW = 72, isoDynH = 28;
            const isoBL2 = isoDynX + isoDynW * 0.625, isoBR2 = isoDynX + isoDynW * 0.875;
            const isoBot2 = v22Y + isoDynH, isoMidY2 = v22Y + isoDynH / 2;
            const isoTopY2 = v22Y - 24.5, isoUpY2 = v22Y - 12.5;
            const isoCvX2 = longR + 65, isoFarX2 = longL - 40;
            const dashStyle = { stroke: this.ORANGE, strokeWidth: 1.4, dash: [4, 3], listening: false };
            const parDash = new Konva.Line({ points: [0, 0, 0, 0], ...dashStyle });
            const serDashA = new Konva.Line({ points: [0, 0, 0, 0], ...dashStyle });
            const serDashB = new Konva.Line({ points: [0, 0, 0, 0], ...dashStyle });
            const serDashC = new Konva.Line({ points: [0, 0, 0, 0], ...dashStyle });
            d.add(parDash, serDashA, serDashB, serDashC);

            this._unitDyn.push({ n, oil, oilText, tempText, pressureText: gt, isoApply, fillRing, drainRing, piston, servoLink, swashRod, _servoPos: 0.5, _lastT: 0, unloadState: state, v4Body, v4Spring, v4LeftDash, v4RightDash, v4HLLeft, v4HLRight, unloadHLLeft, unloadHLRight, pilotHL, pilotBody, pilotLabel, pilotMotorDash, pilotMotor, pilotMotorText, pilotRightBase, pilotMotorY, greenPump, greenMotor, greenServoPump, greenServoMotor, isoState, serLHL, serRHL, parHL, serLBody, serLBx, serRBody, serRBx, parBody, parBy: parCy2, v22Shift, parDash, serDashA, serDashB, serDashC, isoBL2, isoBR2, isoMidY2, isoTopY2, isoUpY2, isoCvX2, isoFarX2, isoY2: v22Y, isoBot2, v22W });
        });
    }

    _registerParts() {
        const P = this._geo.parts;
        const add = (id, p) => {
            const hit = this.addClickablePart(id, p.x, p.y, p.w, p.h, false);
            const bg = hit && hit.getParent && hit.getParent().getChildren()[0];
            if (bg) bg.opacity(0);
            if (hit) {
                hit.off('mouseenter mouseleave click tap');
                hit.on('click tap', (e) => {
                    e.cancelBubble = true;
                    this.sys.lastClickedId = this.id;
                    this.sys.lastClickedPartId = this.id + '/' + id;
                });
            }
        };
        add('pump1', P.pump1);
        add('pump2', P.pump2);
        // 油箱注油 / 卸油截止阀
        const G = this._geo;
        [1, 2].forEach((n) => {
            const u = G.units[n - 1];
            const mk = (id, vx, vy, fn) => {
                const hit = this.addClickablePart(id, u.x0 + vx - 14, u.y0 + vy - 18, 28, 30, true);
                if (!hit) return;
                hit.on('click tap', (e) => {
                    e.cancelBubble = true;
                    const s = this._solver();
                    if (s) fn(s, n);
                    if (this.sys && this.sys.requestRedraw) this.sys.requestRedraw();
                });
            };
            mk(`fill${n}`, G.layout.fillValve.x, G.layout.fillValve.y, (sv, k) => sv.toggleFillValve(k));
            mk(`drain${n}`, G.layout.leakValve.x, G.layout.leakValve.y, (sv, k) => sv.toggleDrainValve(k));
        });
        if (this._unloadHandles) this._unloadHandles.forEach(h => h.moveToTop());
    }

    _solver() {
        return this.sys && this.sys.steerSolver ? this.sys.steerSolver : null;
    }

    _syncVisuals() {
        const s = this._solver();
        if (!s) return;
        const m = s.m, G = this._geo;

        const r = clamp(m.rudder, -40, 40);   // 机旁显示为真实舵角
        this._needle.rotation(-140 + (r + 40) / 80 * 280);
        this._rudderText.text((r >= 0 ? '+' : '') + r.toFixed(1));

        this._updateFlow(m);

        // 液压缸/舵柄/舵柱随舵角动作
        if (this._actDyn) {
            const act = this._actDyn;
            const rud = clamp(m.rudder, -40, 40);
            const angDeg = -rud * 0.85;
            act.tiller.rotation(angDeg);
            const dx = 18 * Math.sin(angDeg * Math.PI / 180);
            act.cyls.forEach(c => {
                const jx = c.rowY < act.cy ? dx : -dx;
                const mid = c.isLeft ? act.midL : act.midR;
                c.piston.x(mid + jx - 3);
                if (c.isLeft) {
                    c.oil.x(act.oilL);
                    c.oil.width(Math.max(6, mid + jx - 3 - act.oilL));
                    c.rodRect.x(mid + jx);
                    c.rodRect.width(act.cx - 7 - mid);
                } else {
                    c.oil.x(mid + jx + 3);
                    c.oil.width(Math.max(6, act.oilR - (mid + jx + 3)));
                    c.rodRect.x(act.cx + 7 + jx);
                    c.rodRect.width(mid - act.cx - 7);
                }
            });
        }

        this._unitDyn.forEach(d => {
            const p = m.pump[d.n];
            const active = (m.activeSys || m.sys) === d.n;   // 收到指令的舵机系统
            const u = G.units[d.n - 1];
            const T = G.layout.tank;
            const h = (T.h - 8) * clamp(p.oil / 100, 0.08, 1);
            d.oil.height(h);
            d.oil.y(G.units[d.n - 1].y0 + T.y + T.h - 4 - h);
            if (d.oilText) d.oilText.text('L ' + (p.oil ?? 85).toFixed(1));
            if (d.tempText) d.tempText.text('T ' + (p.temp ?? 35).toFixed(1));

            const swash = active ? clamp(m.servoPos ?? 0.5, 1 / 8, 7 / 8) : 0.5;
            let swashText = '0';
            if (swash < 0.5 - 1e-4) {
                swashText = '左' + Math.round(clamp((0.5 - swash) / 0.375, 0, 1) * 100) + '%';
            } else if (swash > 0.5 + 1e-4) {
                swashText = '右' + Math.round(clamp((swash - 0.5) / 0.375, 0, 1) * 100) + '%';
            }
            d.pressureText.text(swashText);

            d.fillRing.forEach((t) => t.fill(p.fillOpen ? '#2e9b4b' : 'rgba(0,0,0,0)'));
            d.drainRing.forEach((t) => t.fill(p.drainOpen ? '#2e9b4b' : 'rgba(0,0,0,0)'));
            if (d.isoState && d.isoState.auto !== !!p.isoAuto) { d.isoState.auto = !!p.isoAuto; if (d.isoApply) d.isoApply(); }

            const green = !!p.running;
            d.greenPump.visible(green);
            d.greenMotor.visible(green);
            d.greenServoPump.visible(green);
            d.greenServoMotor.visible(green);

            const rudderErr = Math.abs(m.rudderCmd - (m.rudderFeedback ?? m.rudder));   // 遥控系统按反馈值判断是否需要转舵
            const followErrorActive = rudderErr > 0.5;
            const remoteCommand = !m.localEmergency && (
                (m.mode === 'manual' && followErrorActive) ||
                (m.mode === 'auto' && m.autoEngaged && followErrorActive) ||
                ((m.mode === 'nfu' || m.nfuActive) && m.nfu !== 'center')
            );
            const nowT = performance.now();
            const timerDt = d.unloadState.lastTimerT ? clamp((nowT - d.unloadState.lastTimerT) / 1000, 0, 0.2) : 0;
            d.unloadState.lastTimerT = nowT;
            let autoCoil = false;
            if (d.n === (m.activeSys || m.sys) && p.running && m.autoPower && !m.localEmergency && !p.local) {   // 只驱动收到舵令的遥控机组
                if (remoteCommand) {
                    autoCoil = true;
                    d.unloadState.centerTimer = 0;
                } else {
                    const centered = Math.abs((m.servoPos ?? 0.5) - 0.5) <= 0.01;
                    if (!centered) {
                        autoCoil = true;
                        d.unloadState.centerTimer = 0;
                    } else {
                        d.unloadState.centerTimer += timerDt;
                        autoCoil = d.unloadState.centerTimer < 30;
                    }
                }
            } else {
                d.unloadState.centerTimer = 0;
            }
            if (d.unloadState.coilAuto !== autoCoil) {
                d.unloadState.coilAuto = autoCoil;
                if (d.unloadState.apply) d.unloadState.apply();
            }
            const unloadActive = !!(d.unloadState && (d.unloadState.pressed || d.unloadState.coil || d.unloadState.coilAuto));
            // 四通阀是否右位完全由卸荷阀决定；机旁位也必须手动按下卸荷阀，不能自动切换
            const v4Right = !!(p.running && unloadActive);
            if (d.n === (m.activeSys || m.sys)) {
                m.valveReady = v4Right;
                m.solenoidOn = !!(d.unloadState.coil || d.unloadState.coilAuto);
            }
            d.v4Right = v4Right;
            d.v4HLLeft.visible(!v4Right);
            d.v4HLRight.visible(v4Right);
            d.unloadHLLeft.visible(unloadActive);
            d.unloadHLRight.visible(!unloadActive);

            // 压力信号与阀位联动：泵运行且斜盘不在中位 → 管路有高压油
            const linePressure = !!(p.running && Math.abs((m.servoPos ?? 0.5) - 0.5) > 0.005);
            const isoActive = !!(d.isoState && (d.isoState.pressed || d.isoState.coil || d.isoState.auto));
            const parLower = linePressure && !isoActive;   // 隔离阀右位：并联阀下部有压力 → 下位
            const serPilot = linePressure && isoActive;    // 隔离阀左位：并联阀通油箱 → 上位，串联阀受控
            d.parHL.hlRight.visible(parLower);             // 旋转 90°：局部右半 = 下方阀位
            d.parHL.hlLeft.visible(!parLower);
            d.serLHL.hlRight.visible(!serPilot);
            d.serLHL.hlLeft.visible(serPilot);
            d.serRHL.hlLeft.visible(!serPilot);
            d.serRHL.hlRight.visible(serPilot);
            // 工作位切换时阀体滑移，使当前工作位对准管路接口
            d.serLBody.x(d.serLBx + (serPilot ? d.v22Shift : 0));
            d.serRBody.x(d.serRBx - (serPilot ? d.v22Shift : 0));
            d.parBody.y(d.parBy - (parLower ? d.v22Shift : 0));
            // 液控虚线端点跟随阀体边缘
            const parBottom = d.parBody.y() + d.v22W / 2;
            const serLLeft = d.serLBody.x();
            const serRRight = d.serRBody.x() + d.v22W;
            d.parDash.points([d.isoBL2, d.isoY2, d.isoBL2, d.isoTopY2,
                (d.serLBx + d.serRBx) / 2 + d.v22W * 0.5, d.isoTopY2,
                (d.serLBx + d.serRBx) / 2 + d.v22W * 0.5, parBottom]);
            d.serDashA.points([d.isoBR2, d.isoY2, d.isoBR2, d.isoUpY2, d.isoBL2 + 6, d.isoUpY2]);
            d.serDashB.points([d.isoBL2 - 6, d.isoUpY2, d.isoFarX2, d.isoUpY2, d.isoFarX2, d.isoMidY2, serLLeft, d.isoMidY2]);
            d.serDashC.points([d.isoCvX2, d.isoUpY2, d.isoCvX2, d.isoMidY2, serRRight, d.isoMidY2]);
            // 先导阀显示保持：动作后 0.6s 内仍显示该阀位，避免门限附近高频闪烁
            const nowMs = performance.now();
            if (active && m.pilotPos !== 0) { d.pilotShow = m.pilotPos; d.pilotShowUntil = nowMs + 600; }
            const heldPos = (d.pilotShowUntil && nowMs < d.pilotShowUntil) ? (d.pilotShow || 0) : 0;
            const pilotPos = active ? heldPos : 0;
            const pilotIdx = pilotPos < 0 ? 0 : (pilotPos > 0 ? 2 : 1);
            const pilotShift = pilotPos < 0 ? 36 : (pilotPos > 0 ? -36 : 0);
            const pilotBaseX = u.x0 + G.layout.servo.pilot.x + 15;
            d.pilotBody.x(pilotBaseX + pilotShift);
            d.pilotLabel.x(d.pilotRightBase + pilotShift);
            d.pilotMotorDash.points([d.pilotRightBase + pilotShift, d.pilotMotorY, d.pilotRightBase + 68.2, d.pilotMotorY]);
            // 只有“确实在操舵”时才点亮力矩马达（避免松手后伺服回中造成瞬时误亮）
            const cmdLive = Math.abs(m.rudderCmd - m.rudder) > 0.2 || Math.abs(m.steerDir || 0) > 0 || !!m.nfuActive;
            const torqueWorking = active && cmdLive && pilotPos !== 0 && (!m.autoPower || m.solenoidOn);
            d.pilotMotor.fill(torqueWorking ? '#ff2d2d' : '#d7d9d6');
            d.pilotHL.forEach((h, i) => {
                h.x(u.x0 + G.layout.servo.pilot.x - 39 + i * 36 + pilotShift);
                h.visible(i === pilotIdx);
            });
            const V4 = G.layout.valve4;
            const U = G.layout.unload;
            const shift = v4Right ? V4.w / 2 : 0;
            const v4BaseX = u.x0 + V4.x;
            d.v4Body.x(v4BaseX - shift);
            d.v4Spring.x(v4BaseX - shift);
            const uTop = u.y0 + U.y;
            const uLeftPortX = u.x0 + U.x + U.w * 0.625;
            const uRightPortX = u.x0 + U.x + U.w * 0.875;
            const v4MidY = u.y0 + V4.y + V4.h / 2;
            const v4TwoThirdY = u.y0 + V4.y + V4.h * 2 / 3;
            d.v4LeftDash.points([uLeftPortX, uTop, uLeftPortX, uTop - 10, v4BaseX - shift - 10, uTop - 10, v4BaseX - shift - 10, v4TwoThirdY, v4BaseX - shift, v4TwoThirdY]);
            d.v4RightDash.points([uRightPortX, uTop, uRightPortX, v4MidY, v4BaseX + V4.w - shift, v4MidY]);

            const SV = G.layout.servo, P = G.layout.pump;
            const pos = active ? clamp(m.servoPos ?? 0.5, 1 / 8, 7 / 8) : 0.5;
            const pCenterX = u.x0 + SV.piston.x + SV.piston.w * pos;
            const pCenterY = u.y0 + SV.piston.y + SV.piston.h / 2;
            const pistonW = 6, pistonH = 24;
            d.piston.x(pCenterX - pistonW / 2);
            d.piston.y(pCenterY - pistonH / 2);
            d.piston.width(pistonW);
            d.piston.height(pistonH);

            const linkLen = SV.piston.x + SV.piston.w * 0.5 - P.cx;
            const topX = pCenterX - linkLen;
            const topY = pCenterY;
            d.servoLink.points([pCenterX, pCenterY, topX, topY]);

            const pcx = u.x0 + P.cx, pcy = u.y0 + P.cy;
            const vx = topX - pcx, vy = topY - pcy;
            d.swashRod.points([pcx - 0.19 * vx, pcy - 0.19 * vy, topX, topY]);
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
