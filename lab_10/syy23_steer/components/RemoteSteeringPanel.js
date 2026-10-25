import { BaseComponent } from './BaseComponent.js';

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

export class RemoteSteeringPanel extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.W = Math.max(600, config.width || 680);
        this.H = Math.max(700, config.height || 800);
        this.type = 'remote_steering_panel';
        this.special = 'steering_panel';
        this.cache = 'fixed';

        this._initGroups();
        this._recalcGeometry();
        this._drawStaticParts();
        this._createDynamicNodes();
        this._bindInteraction();
        this._syncVisuals();

        this.config = { id: this.id, width: this.W, height: this.H };
    }

    _recalcGeometry() {
        const W = this.W, H = this.H;
        this._geo = {
            chassis: { x: 0, y: 0, w: W, h: H, r: 10 },
            frame: { x: 12, y: 12, w: W - 24, h: H - 24, r: 7 },
            gauge: { cx: 185, cy: 150, r: 112 },
            heading: {
                label: { x: 352, y: 36 },
                digits: { x: 368, y: 58, w: 50, h: 54, count: 4, gap: 7 },
                dot: { x: 536, y: 85 },
                degree: { x: 596, y: 68 },
            },
            headingSet: {
                label: { x: 352, y: 130 },
                digits: { x: 368, y: 154, w: 50, h: 54, count: 4, gap: 7 },
                dot: { x: 536, y: 181 },
                knob: { cx: 540, cy: 270, rOuter: 45, rInner: 34 },
                label2: { x: 512, y: 324, w: 56 },
                dec: { x: 370, y: 250, w: 38, h: 34 },
                inc: { x: 434, y: 250, w: 38, h: 34 },
            },
            nfu: {
                title: { x: 362, y: 341, w: 274 },
                knob: { cx: 499, cy: 422, rOuter: 45, rInner: 34 },
                left: { x: 398, y: 390, w: 60, text: '左转舵' },
                right: { x: 540, y: 390, w: 70, text: '右转舵' },
                parts: {
                    port: { x: 454, y: 377, w: 45, h: 90 },
                    starboard: { x: 499, y: 377, w: 45, h: 90 },
                },
            },
            mode: {
                title: { x: 362, y: 473, w: 274 },
                knob: { cx: 499, cy: 554, rOuter: 45, rInner: 34 },
                top: { x: 449, y: 494, w: 100, text: '手动' },
                left: { x: 398, y: 520, w: 60, text: '自动' },
                right: { x: 540, y: 520, w: 70, text: 'NFU' },
                parts: {
                    left: { x: 454, y: 509, w: 45, h: 90 },
                    right: { x: 499, y: 509, w: 45, h: 90 },
                    knob: { x: 454, y: 509, w: 90, h: 90 },
                },
            },
            system: {
                title: { x: 362, y: 626, w: 274 },
                knob: { cx: 499, cy: 688, rOuter: 45, rInner: 34 },
                no1: { x: 410, y: 650, w: 60 },
                no2: { x: 530, y: 650, w: 60 },
                lamps: { x1: 438, x2: 563, y: 672, r: 7 },
                parts: {
                    one: { x: 454, y: 643, w: 45, h: 90 },
                    two: { x: 499, y: 643, w: 45, h: 90 },
                },
            },
            command: {
                x: 35, y: 292, w: 300, h: 68, inset: 8,
                innerX: 50, innerW: 270,
                tickTop: 300, majorLen: 27, minorLen: 17,
                labelY: 337, barY: 299, barW: 10, barH: 34,
                values: [-30, -20, -10, 0, 10, 20, 30],
            },
            wheel: {
                cx: 185, cy: 548, r: 150,
                label: { x: 90, y: 718, w: 190 },
                parts: {
                    helm: { x: 15, y: 375, w: 340, h: 260 },
                    ring: { x: 185, y: 548, r: 168 },
                },
            },
            statusBar: {
                box: { x: 22, y: 746, w: 636, h: 48 },
                title: { x: 34, y: 752 },
                hint: { x: 34, y: 770 },
                text: { x: 286, y: 756, w: 366 },
            },
            dmuPart: { x: 64, y: 38, w: 242, h: 244 },
        };
    }

    _label(g, x, y, text, size = 12, fill = '#222', bold = false, align = 'left', width = 0) {
        const opts = {
            x, y, text, fontSize: size,
            fontStyle: bold ? 'bold' : 'normal', fill,
            align, fontFamily: 'Arial, sans-serif',
        };
        if (width) opts.width = width;
        g.add(new Konva.Text(opts));
    }

    _drawGauge(g, cx, cy, r) {
        g.add(new Konva.Circle({ x: cx, y: cy, radius: r + 9, fill: '#eef0ef', stroke: '#3c4a55', strokeWidth: 2 }));
        g.add(new Konva.Circle({ x: cx, y: cy, radius: r, fill: '#fbfbf8', stroke: '#2a3e4d', strokeWidth: 2 }));
        const a0 = -140, a1 = 140;
        for (let v = -40; v <= 40; v += 2) {
            const a = (a0 + (v + 40) / 80 * (a1 - a0)) * Math.PI / 180;
            const major = v % 10 === 0;
            const mid = v % 5 === 0;
            const rr = r - (major ? 22 : mid ? 17 : 12);
            g.add(new Konva.Line({
                points: [cx + Math.sin(a) * (r - 5), cy - Math.cos(a) * (r - 5),
                    cx + Math.sin(a) * rr, cy - Math.cos(a) * rr],
                stroke: '#2b3b47', strokeWidth: major ? 1.6 : 0.9,
            }));
            if (major && v !== 0) {
                const lx = cx + Math.sin(a) * (r - 34);
                const ly = cy - Math.cos(a) * (r - 34);
                this._label(g, lx - 14, ly - 6, String(Math.abs(v)), 10, '#263238', true, 'center', 28);
            }
        }
        this._label(g, cx - 82, cy + 22, 'PORT', 12, '#b71c1c', true, 'center', 48);
        this._label(g, cx + 43, cy + 22, 'STBD', 12, '#1b5e20', true, 'center', 48);
        this._label(g, cx - 18, cy + 46, 'JSSC', 15, '#c62828', true, 'center', 48);
        g.add(new Konva.Rect({ x: cx - 36, y: cy + 72, width: 72, height: 25, fill: '#f5f6f4', stroke: '#607d8b', strokeWidth: 1.2 }));
    }

    _drawDigitBoxes(g, x, y, w, h, count) {
        for (let i = 0; i < count; i++) {
            g.add(new Konva.Rect({
                x: x + i * (w + 7), y, width: w, height: h,
                fill: '#e9e9e4', stroke: '#7b807f', strokeWidth: 1.2,
                fillLinearGradientStartPoint: { x: 0, y: 0 },
                fillLinearGradientEndPoint: { x: 0, y: h },
                fillLinearGradientColorStops: [0, '#f5f5ef', 1, '#dadbd4'],
            }));
        }
    }

    _drawSelectorKnobStatic(g, K) {
        g.add(new Konva.Circle({ x: K.cx, y: K.cy, radius: K.rOuter, fill: '#f4f4f0', stroke: '#596469', strokeWidth: 1.4 }));
        g.add(new Konva.Circle({ x: K.cx, y: K.cy, radius: K.rInner, fill: '#3b3f41', stroke: '#111', strokeWidth: 2 }));
    }

    _drawStaticParts() {
        const g = this._staticGroup, G = this._geo;

        g.add(new Konva.Rect({
            x: G.chassis.x, y: G.chassis.y, width: G.chassis.w, height: G.chassis.h, cornerRadius: G.chassis.r,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint: { x: G.chassis.w, y: G.chassis.h },
            fillLinearGradientColorStops: [0, '#dedfdd', 0.6, '#c9cbca', 1, '#b9bcbb'],
            stroke: '#6d7271', strokeWidth: 3,
        }));
        g.add(new Konva.Rect({
            x: G.frame.x, y: G.frame.y, width: G.frame.w, height: G.frame.h,
            cornerRadius: G.frame.r, stroke: '#8c9190', strokeWidth: 1.5,
        }));

        this._drawGauge(g, G.gauge.cx, G.gauge.cy, G.gauge.r);
        this._label(g, G.heading.label.x, G.heading.label.y, '当前航向显示', 13, '#263238', true);
        this._drawDigitBoxes(g, G.heading.digits.x, G.heading.digits.y, G.heading.digits.w, G.heading.digits.h, G.heading.digits.count);
        g.add(new Konva.Circle({ x: G.heading.dot.x, y: G.heading.dot.y, radius: 2.6, fill: '#8b0000' }));
        this._label(g, G.heading.degree.x, G.heading.degree.y, '°', 16, '#8b0000', true);

        this._label(g, G.headingSet.label.x, G.headingSet.label.y, '航向设定', 13, '#263238', true);
        this._drawDigitBoxes(g, G.headingSet.digits.x, G.headingSet.digits.y, G.headingSet.digits.w, G.headingSet.digits.h, G.headingSet.digits.count);
        g.add(new Konva.Circle({ x: G.headingSet.dot.x, y: G.headingSet.dot.y, radius: 2.4, fill: '#1a1a1a' }));
        g.add(new Konva.Circle({ x: G.headingSet.knob.cx, y: G.headingSet.knob.cy, radius: G.headingSet.knob.rOuter, fill: '#f4f4f0', stroke: '#596469', strokeWidth: 1.4 }));
        g.add(new Konva.Circle({ x: G.headingSet.knob.cx, y: G.headingSet.knob.cy, radius: G.headingSet.knob.rInner, fill: '#3b3f41', stroke: '#111', strokeWidth: 2 }));
        this._label(g, G.headingSet.label2.x, G.headingSet.label2.y, '航向旋钮', 13, '#37474f', false, 'center', G.headingSet.label2.w);
        g.add(new Konva.Rect({ x: G.headingSet.dec.x, y: G.headingSet.dec.y, width: G.headingSet.dec.w, height: G.headingSet.dec.h, fill: '#cfd5d4', stroke: '#607d8b', strokeWidth: 1.2, cornerRadius: 4 }));
        g.add(new Konva.Rect({ x: G.headingSet.inc.x, y: G.headingSet.inc.y, width: G.headingSet.inc.w, height: G.headingSet.inc.h, fill: '#cfd5d4', stroke: '#607d8b', strokeWidth: 1.2, cornerRadius: 4 }));
        this._label(g, G.headingSet.dec.x, G.headingSet.dec.y + 6, '−', 20, '#263238', true, 'center', G.headingSet.dec.w);
        this._label(g, G.headingSet.inc.x, G.headingSet.inc.y + 6, '+', 20, '#263238', true, 'center', G.headingSet.inc.w);

        const N = G.nfu;
        this._label(g, N.title.x, N.title.y + 5, '非随动操舵', 12, '#263238', true, 'center', N.title.w);
        this._label(g, N.left.x, N.left.y, N.left.text, 11, '#b71c1c', true, 'right', N.left.w);
        this._label(g, N.right.x, N.right.y, N.right.text, 11, '#1b5e20', true, 'left', N.right.w);
        this._drawSelectorKnobStatic(g, N.knob);

        const M = G.mode;
        this._label(g, M.title.x, M.title.y, '模式选择', 12, '#263238', true, 'center', M.title.w);
        this._label(g, M.top.x, M.top.y, M.top.text, 11, '#263238', true, 'center', M.top.w);
        this._label(g, M.left.x, M.left.y, M.left.text, 11, '#b71c1c', true, 'right', M.left.w);
        this._label(g, M.right.x, M.right.y, M.right.text, 11, '#1b5e20', true, 'left', M.right.w);
        this._drawSelectorKnobStatic(g, M.knob);

        const S = G.system;
        this._label(g, S.title.x, S.title.y, '舵机选择', 12, '#263238', true, 'center', S.title.w);
        this._label(g, S.no1.x, S.no1.y, 'NO.1', 11, '#263238', true, 'center', S.no1.w);
        this._label(g, S.no2.x, S.no2.y, 'NO.2', 11, '#263238', true, 'center', S.no2.w);
        this._drawSelectorKnobStatic(g, S.knob);
        g.add(new Konva.Circle({ x: S.lamps.x1, y: S.lamps.y, radius: S.lamps.r, fill: '#0a2f0a', stroke: '#333', strokeWidth: 1 }));
        g.add(new Konva.Circle({ x: S.lamps.x2, y: S.lamps.y, radius: S.lamps.r, fill: '#0a2f0a', stroke: '#333', strokeWidth: 1 }));

        const C = G.command;
        g.add(new Konva.Line({
            points: [C.x + C.inset, C.y, C.x + C.w - C.inset, C.y, C.x + C.w, C.y + C.h, C.x, C.y + C.h],
            closed: true, fill: '#fdfdfb', stroke: '#4a4a4a', strokeWidth: 1.5,
        }));
        for (let v = -35; v <= 35; v += 5) {
            const x = C.innerX + (v + 35) / 70 * C.innerW;
            const major = v % 10 === 0;
            g.add(new Konva.Line({
                points: [x, C.tickTop, x, C.tickTop + (major ? C.majorLen : C.minorLen)],
                stroke: '#111111', strokeWidth: major ? 2.2 : 1.5,
            }));
        }
        C.values.forEach(v => {
            const x = C.innerX + (v + 35) / 70 * C.innerW;
            const color = v < 0 ? '#c62828' : (v > 0 ? '#1b5e20' : '#111111');
            this._label(g, x - 12, C.labelY, String(Math.abs(v)), 13, color, true, 'center', 24);
        });
        this._label(g, C.x + 2, C.labelY, 'P', 14, '#c62828', true, 'center', 24);
        this._label(g, C.x + C.w - 26, C.labelY, 'S', 14, '#1b5e20', true, 'center', 24);

        const WH = G.wheel;
        this._drawWheel(g, WH.cx, WH.cy, WH.r);
        this._label(g, WH.label.x, WH.label.y, '随动操舵手轮', 15, '#263238', true, 'center', WH.label.w);

        const B = G.statusBar;
        g.add(new Konva.Rect({ x: B.box.x, y: B.box.y, width: B.box.w, height: B.box.h, fill: '#303334', stroke: '#191a1a', strokeWidth: 2, cornerRadius: 5 }));
        this._label(g, B.title.x, B.title.y, 'REMOTE STEERING CONTROL', 11, '#b0bec5', true);
        this._label(g, B.hint.x, B.hint.y, '拖动手轮或操作模式/系统档位进行操作', 11, '#cfd8dc');
    }

    _drawWheel(g, cx, cy, r) {
        g.add(new Konva.Circle({ x: cx, y: cy, radius: r + 8, fill: '#b5b8b7', stroke: '#666b6a', strokeWidth: 2 }));
        g.add(new Konva.Circle({ x: cx, y: cy, radius: r, fill: '#3c3f40', stroke: '#1d1f20', strokeWidth: 2 }));
        g.add(new Konva.Circle({ x: cx, y: cy, radius: r - 22, fill: '#cfd2d1', stroke: '#777c7b', strokeWidth: 2 }));
        g.add(new Konva.Circle({ x: cx, y: cy, radius: r - 34, fill: '#4a4e4f', stroke: '#252728', strokeWidth: 2 }));
        g.add(new Konva.Circle({ x: cx, y: cy, radius: 44, fill: '#2d3031', stroke: '#121313', strokeWidth: 2 }));
        g.add(new Konva.Circle({ x: cx + 9, y: cy - 8, radius: 20, fill: '#8f7416', stroke: '#4b3c0b', strokeWidth: 2 }));
    }

    _createDynamicNodes() {
        const d = this._dynamicGroup, G = this._geo;

        this._headingDigits = [];
        for (let i = 0; i < G.heading.digits.count; i++) {
            const t = new Konva.Text({
                x: G.heading.digits.x + i * (G.heading.digits.w + G.heading.digits.gap),
                y: G.heading.digits.y + 10, width: G.heading.digits.w,
                text: '0', fontSize: 33,
                fontStyle: 'bold', fill: '#8b0000', align: 'center', fontFamily: 'Consolas, monospace',
            });
            d.add(t);
            this._headingDigits.push(t);
        }

        this._setDigits = [];
        for (let i = 0; i < G.headingSet.digits.count; i++) {
            const t = new Konva.Text({
                x: G.headingSet.digits.x + i * (G.headingSet.digits.w + G.headingSet.digits.gap),
                y: G.headingSet.digits.y + 10, width: G.headingSet.digits.w,
                text: '0', fontSize: 33,
                fontStyle: 'bold', fill: '#111', align: 'center', fontFamily: 'Consolas, monospace',
            });
            d.add(t);
            this._setDigits.push(t);
        }

        this._needle = new Konva.Group({ x: G.gauge.cx, y: G.gauge.cy });
        this._needle.add(new Konva.Line({ points: [0, 8, 0, -86], stroke: '#b71c1c', strokeWidth: 5, lineCap: 'round' }));
        this._needle.add(new Konva.Line({ points: [-5, -72, 0, -88, 5, -72], closed: true, fill: '#b71c1c' }));
        this._needle.add(new Konva.Circle({ radius: 8, fill: '#263238', stroke: '#111', strokeWidth: 1 }));
        d.add(this._needle);

        this._rudderText = new Konva.Text({
            x: G.gauge.cx - 36, y: G.gauge.cy + 72, width: 72, height: 25,
            text: '0.0', fontSize: 16,
            fontStyle: 'bold', fill: '#0d47a1', align: 'center', verticalAlign: 'middle',
            fontFamily: 'Consolas, monospace',
        });
        d.add(this._rudderText);

        this._setKnob = new Konva.Group({ x: G.headingSet.knob.cx, y: G.headingSet.knob.cy });
        this._setKnob.add(new Konva.Rect({ x: -4, y: -31, width: 8, height: 25, fill: '#f2f2ee', cornerRadius: 2 }));
        d.add(this._setKnob);

        this._nfuLever = new Konva.Group({ x: G.nfu.knob.cx, y: G.nfu.knob.cy });
        this._nfuLever.add(new Konva.Rect({ x: -4, y: -31, width: 8, height: 25, fill: '#f2f2ee', cornerRadius: 2 }));
        d.add(this._nfuLever);

        this._modeKnob = new Konva.Group({ x: G.mode.knob.cx, y: G.mode.knob.cy });
        this._modeKnob.add(new Konva.Rect({ x: -4, y: -31, width: 8, height: 25, fill: '#f2f2ee', cornerRadius: 2 }));
        d.add(this._modeKnob);

        this._sysSel = 1;   // 舵机选择开关自身位置（只能人为转动）
        this._sysKnob = new Konva.Group({ x: G.system.knob.cx, y: G.system.knob.cy });
        this._sysKnob.add(new Konva.Rect({ x: -4, y: -31, width: 8, height: 25, fill: '#f2f2ee', cornerRadius: 2 }));
        d.add(this._sysKnob);

        this._sysLamp1 = new Konva.Circle({ x: G.system.lamps.x1, y: G.system.lamps.y, radius: G.system.lamps.r, fill: '#0a2f0a', stroke: '#333', strokeWidth: 1 });
        this._sysLamp2 = new Konva.Circle({ x: G.system.lamps.x2, y: G.system.lamps.y, radius: G.system.lamps.r, fill: '#0a2f0a', stroke: '#333', strokeWidth: 1 });
        d.add(this._sysLamp1, this._sysLamp2);

        const C = G.command;
        this._commandBar = new Konva.Rect({
            x: C.innerX + C.innerW / 2 - C.barW / 2,
            y: C.barY, width: C.barW, height: C.barH,
            fill: '#b71c1c', opacity: 0.92,
        });
        d.add(this._commandBar);

        this._wheel = new Konva.Group({ x: G.wheel.cx, y: G.wheel.cy });
        for (let i = 0; i < 8; i++) {
            const a = i * Math.PI / 4;
            const x1 = Math.cos(a) * 48, y1 = Math.sin(a) * 48;
            const x2 = Math.cos(a) * 135, y2 = Math.sin(a) * 135;
            this._wheel.add(new Konva.Line({ points: [x1, y1, x2, y2], stroke: '#2d3031', strokeWidth: 13, lineCap: 'round' }));
            this._wheel.add(new Konva.Line({ points: [x1, y1, x2, y2], stroke: '#73797a', strokeWidth: 4, lineCap: 'round' }));
        }
        this._wheel.add(new Konva.Circle({ radius: 45, fill: '#2d3031', stroke: '#111', strokeWidth: 2 }));
        this._wheel.add(new Konva.Circle({ x: 9, y: -8, radius: 19, fill: '#8f7416', stroke: '#4b3c0b', strokeWidth: 2 }));
        this._wheel.add(new Konva.Rect({ x: -4, y: -135, width: 8, height: 28, fill: '#d7d9d8', cornerRadius: 3 }));
        d.add(this._wheel);

        this._statusText = new Konva.Text({
            x: G.statusBar.text.x, y: G.statusBar.text.y, width: G.statusBar.text.w,
            text: '', fontSize: 12,
            fill: '#e0e5e7', align: 'right', fontFamily: 'Arial, sans-serif',
        });
        d.add(this._statusText);
    }
    _bindInteraction() {
        const G = this._geo;
        const D = G.dmuPart;
        this.addClickablePart('dmu', D.x, D.y, D.w, D.h, false);
        const mk = (id, p, fn) => {
            const n = this.addClickablePart(id, p.x, p.y, p.w, p.h, true);
            if (n) n.on('click tap', fn);
        };

        mk('set-dec', G.headingSet.dec, () => {
            const s = this._solver();
            if (s) s.nudgeHeading(-0.5);
            this._syncVisuals();
        });
        mk('set-inc', G.headingSet.inc, () => {
            const s = this._solver();
            if (s) s.nudgeHeading(0.5);
            this._syncVisuals();
        });

        const mkHold = (id, p, dir) => {
            const n = this.addClickablePart(id, p.x, p.y, p.w, p.h, true);
            if (!n) return;
            n.on('mousedown touchstart', (e) => {
                e.cancelBubble = true;
                this.pressNfu(dir);
            });
            n.on('mouseup touchend mouseleave', () => this.releaseNfu());
        };
        mkHold('nfu-port', G.nfu.parts.port, 'port');
        mkHold('nfu-starboard', G.nfu.parts.starboard, 'starboard');
        this.sys.stage.on('mouseup touchend', () => this.releaseNfu());

        this.addClickablePart('mode', G.mode.parts.knob.x, G.mode.parts.knob.y,
            G.mode.parts.knob.w, G.mode.parts.knob.h, false);
        mk('mode-left', G.mode.parts.left, () => this.stepMode(-1));
        mk('mode-right', G.mode.parts.right, () => this.stepMode(1));

        mk('sys-1', G.system.parts.one, () => {
            this._sysSel = 1;
            const s = this._solver();
            if (s) s.selectSystem(1);
            this._syncVisuals();
        });
        mk('sys-2', G.system.parts.two, () => {
            this._sysSel = 2;
            const s = this._solver();
            if (s) s.selectSystem(2);
            this._syncVisuals();
        });

        this.addClickablePart('helm', G.wheel.parts.helm.x, G.wheel.parts.helm.y,
            G.wheel.parts.helm.w, G.wheel.parts.helm.h, false);

        const ring = new Konva.Circle({
            x: G.wheel.parts.ring.x, y: G.wheel.parts.ring.y, radius: G.wheel.parts.ring.r,
            fill: 'rgba(0,0,0,0)', stroke: null,
            listening: true, cursor: 'grab',
        });
        this._interactGroup.add(ring);
        let dragging = false;
        ring.on('mousedown touchstart', (e) => {
            dragging = true;
            e.cancelBubble = true;
            this._dragPrevAngle = null;
            this._dragHelmFromPointer();
            if (this.sys.requestRedraw) this.sys.requestRedraw();
        });
        this.sys.stage.on('mousemove touchmove', () => {
            if (dragging) this._dragHelmFromPointer();
        });
        this.sys.stage.on('mouseup touchend', () => {
            dragging = false;
            this._dragPrevAngle = null;
        });
    }

    async rotateWheelTo(v, ms = 600) {
        const s = this._solver();
        if (!s) return;
        const start = s.m.helmAngle;
        const end = clamp(v, -1, 1) * 630;
        const steps = Math.max(1, Math.round(ms / 50));
        for (let i = 1; i <= steps; i++) {
            s.setWheelAngle(start + (end - start) * i / steps);
            this._syncVisuals();
            await new Promise(r => setTimeout(r, 50));
        }
    }

    rotateWheelBy(deg) {
        const s = this._solver();
        if (s) s.rotateWheelBy(deg);
        this._syncVisuals();
    }

    stepMode(dir) {
        const s = this._solver();
        if (!s) return;
        const order = ['auto', 'manual', 'nfu'];
        let i = order.indexOf(s.m.mode);
        if (i < 0) i = 1;
        i = dir > 0 ? Math.min(2, i + 1) : Math.max(0, i - 1);
        s.setMode(order[i]);
        this._syncVisuals();
    }

    pressNfu(dir) {
        const s = this._solver();
        if (s) s.pressNfu(dir);
        this._syncVisuals();
    }

    releaseNfu() {
        const s = this._solver();
        if (s) s.releaseNfu();
        this._syncVisuals();
    }

    _dragHelmFromPointer() {
        const s = this._solver();
        if (!s || !this.sys.stage) return;
        const pt = this.sys.stage.getPointerPosition();
        if (!pt) return;
        const tr = this.group.getAbsoluteTransform().copy().invert();
        const p = tr.point(pt);
        const w = this._geo.wheel;
        const dx = p.x - w.cx, dy = w.cy - p.y;
        if (Math.hypot(dx, dy) < 20) return;
        const a = Math.atan2(dx, dy) * 180 / Math.PI;
        if (this._dragPrevAngle == null) {
            this._dragPrevAngle = a;
            return;
        }
        let d = a - this._dragPrevAngle;
        while (d > 180) d -= 360;
        while (d < -180) d += 360;
        this._dragPrevAngle = a;
        s.rotateWheelBy(d);
        this._syncVisuals();
    }

    _solver() {
        return this.sys && this.sys.steerSolver ? this.sys.steerSolver : null;
    }

    _setCurrentHeadingDigits(nodes, value) {
        let v = ((Number(value) % 360) + 360) % 360;
        if (v > 180) v -= 360;
        v = clamp(Math.round(v * 10) / 10, -90.5, 90.5);
        const sign = v < 0 ? '-' : '+';
        const abs = Math.abs(v);
        const whole = Math.floor(abs).toString().padStart(2, '0');
        const tenth = Math.round((abs - Math.floor(abs)) * 10) % 10;
        const str = sign + whole + String(tenth);
        nodes.forEach((n, i) => n.text(str[i] || '0'));
    }

    _setHeadingDigits(nodes, value) {
        const v = Math.round(clamp(Number(value) || 0, -90, 90) * 10) / 10;
        const sign = v < 0 ? '-' : '+';
        const abs = Math.abs(v);
        const whole = Math.floor(abs).toString().padStart(2, '0');
        const tenth = Math.round((abs - Math.floor(abs)) * 10) % 10;
        const str = sign + whole + String(tenth);
        nodes.forEach((n, i) => n.text(str[i] || '0'));
    }

    _syncVisuals() {
        const s = this._solver();
        if (!s) return;
        const m = s.m;

        this._setCurrentHeadingDigits(this._headingDigits, m.heading);
        this._setHeadingDigits(this._setDigits, m.headingSet);

        const rudderDisplay = clamp(m.displayRudder, -40, 40);
        this._needle.rotation(-140 + (rudderDisplay + 40) / 80 * 280);
        this._rudderText.text((rudderDisplay >= 0 ? '+' : '') + rudderDisplay.toFixed(1));

        this._setKnob.rotation(m.headingSet);

        const C = this._geo.command;
        const cmd = clamp(m.helmAngle / 18, -35, 35);
        this._commandBar.x(C.innerX + (cmd + 35) / 70 * C.innerW - C.barW / 2);

        this._wheel.rotation(m.helmAngle);

        const modeAngle = m.mode === 'auto' ? -45 : (m.mode === 'manual' ? 0 : 45);
        this._modeKnob.rotation(modeAngle);

        const nfuAngle = m.nfu === 'port' ? -45 : (m.nfu === 'starboard' ? 45 : 0);
        this._nfuLever.rotation(nfuAngle);

        this._sysKnob.rotation(this._sysSel === 1 ? -45 : 45);
        this._sysLamp1.fill(m.pump[1] && m.pump[1].running && !m.pump[1].local ? '#25e04a' : '#0a2f0a');
        this._sysLamp2.fill(m.pump[2] && m.pump[2].running && !m.pump[2].local ? '#25e04a' : '#0a2f0a');

        const p = m.pump[m.sys];
        const modeText = m.mode === 'auto' ? '自动' : (m.mode === 'manual' ? '手动' : '非随动');
        const runText = p.running ? '液压运行' : '液压停止';
        const autoText = m.autoPower ? (m.autoEngaged ? '自动舵投入' : '自动舵待机') : '自动舵断电';
        this._statusText.text(`系统 ${m.sys}# | ${runText} | ${modeText} | ${autoText}`);

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

export default RemoteSteeringPanel;
