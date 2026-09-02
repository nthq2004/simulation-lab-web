import { BaseComponent } from './BaseComponent.js';

export class PowerFactor extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.width  = Math.max(340, config.width  || 470);
        this.height = Math.max(200, config.height || 240);

        this.type    = 'wattmeter';
        this.special = 'WATTMETER';
        this.cache   = 'fixed';

        this._initGroups();
        this._recalcGeometry();
        this._initParameters(config);
        this._init();

        this.config = {
            pf:        this._targetPF,
            maxPF:     1,
            rampTime:  this._rampTime,
            accuracy:  this._accuracy,
        };

        this.addPort(this._portIP.x, this._portIP.y, 'ip', 'wire', 'p');
        this.addPort(this._portIN.x, this._portIN.y, 'in', 'wire', 'n');
        this.addPort(this._portUP.x, this._portUP.y, 'up', 'wire', 'p');
        this.addPort(this._portUN.x, this._portUN.y, 'un', 'wire', 'n');
    }

    // ═══════════════════════════════════════════════════
    // 几何尺寸计算
    // ═══════════════════════════════════════════════════

    _recalcGeometry() {
        const W = this.width, H = this.height;
        this._divX  = W * 0.50;
        this._frame = { x: 2, y: 2, w: W - 4, h: H - 4, rx: 8 };

        const lW  = this._divX;
        const fCx = lW * 0.50;
        const fCy = H  * 0.48;
        const fR  = Math.min(lW * 0.48, H * 0.46);
        this._face = { cx: fCx, cy: fCy, r: fR };

        this._angleStart = 150;
        this._angleSweep = 240;

        const rLeft = this._divX + 6;
        const rW    = W - rLeft + 36;
        const rCx   = rLeft + rW * 0.44;
        const rCy   = H * 0.48;

        const ccW = rW * 0.52, ccH = H * 0.10;
        const ccSep = H * 0.26;
        this._ccTop = {
            x: rCx - ccW / 2, y: rCy - ccSep - ccH / 2,
            w: ccW, h: ccH,
        };
        this._ccBot = {
            x: rCx - ccW / 2, y: rCy + ccSep - ccH / 2,
            w: ccW, h: ccH,
        };

        this._ccTopL = { x: this._ccTop.x, y: this._ccTop.y + ccH / 2 };
        this._ccTopR = { x: this._ccTop.x + ccW, y: this._ccTop.y + ccH / 2 };
        this._ccBotL = { x: this._ccBot.x, y: this._ccBot.y + ccH / 2 };
        this._ccBotR = { x: this._ccBot.x + ccW, y: this._ccBot.y + ccH / 2 };

        this._rCx = rCx;
        this._rCy = rCy;

        const coilLen = H * 0.18;
        const coilWid = 10;
        this._vcVert = { cx: rCx, cy: rCy, w: coilWid, h: coilLen };
        this._vcHorz = { cx: rCx, cy: rCy, w: coilLen, h: coilWid };

        this._shaft = {
            x: rCx,
            y0: this._ccTop.y - 12,
            y1: this._ccBot.y + ccH + 12,
        };

        const pSpan = rW * 0.72;
        const pSp   = pSpan / 3;
        const pX0   = rCx - pSpan / 2;
        this._portIP = { x: pX0,        y: H - 2 };
        this._portIN = { x: pX0 + pSp,  y: H - 2 };
        this._portUP = { x: pX0 + pSp*2, y: H - 2 };
        this._portUN = { x: pX0 + pSpan, y: H - 2 };

        this._rvPos = { cx: this._portUP.x, cy: H - 14 - rW * 0.10 };
        this._lVPos = { cx: this._portUP.x, cy: this._rvPos.cy - 28 };

        this._springPos = { cx: rCx, cy: this._ccTop.y - 16 };

        const tY = H - 16;
        this._termCY = H - 14;
        this._termLabels = [
            { x: this._portIP.x, y: tY, label: 'I+' },
            { x: this._portIN.x, y: tY, label: 'I-' },
            { x: this._portUP.x, y: tY, label: 'U+' },
            { x: this._portUN.x, y: tY, label: 'U-' },
        ];
    }

    // ═══════════════════════════════════════════════════
    // 参数初始化
    // ═══════════════════════════════════════════════════

    _initParameters(config) {
        this._targetPF  = config.pf !== undefined ? parseFloat(config.pf) : 1.0;
        this._pfSign    = config.pfSign !== undefined ? parseFloat(config.pfSign) : 1;
        this._phaseDeg  = config.phaseDeg || 0;
        this._currentPF = this._targetPF;
        this._accuracy  = config.accuracy || '1.0';
        this._rampTime  = config.rampTime !== undefined ? parseFloat(config.rampTime) : 0.4;

        this.currentIdx = undefined;
        this.physCurrent = 0;

        this._needleAngle = this._pfToAngle(this._targetPF, this._pfSign);

        this._vcAngle = 45;

        this._fieldPhase = 0;

        this._bufLen = 200;
        this._bufV2 = new Float64Array(this._bufLen);
        this._bufI2 = new Float64Array(this._bufLen);
        this._bufP  = new Float64Array(this._bufLen);
        this._bufV  = new Float64Array(this._bufLen);
        this._bufIdx = 0;
        this._bufCount = 0;
        this._sumV2 = 0;
        this._sumI2 = 0;
        this._sumP = 0;
        this._lastV = 0;
        this._sumIdv = 0;
    }

    _pfToAngle(pf, sign) {
        const phi = Math.acos(Math.max(0.01, Math.min(1, pf)));
        const phiDeg = phi * 180 / Math.PI;
        return 270 - sign * phiDeg;
    }

    // ═══════════════════════════════════════════════════
    // 主初始化
    // ═══════════════════════════════════════════════════

    _init() {
        this._drawStaticParts();
        this._createDynamicNodes();
    }

    // ═══════════════════════════════════════════════════
    // 静态部件
    // ═══════════════════════════════════════════════════

    _drawStaticParts() {
        this._drawFrame();
        this._drawFaceStatic();
        this._drawPrincipleStatic();
    }

    _drawFrame() {
        const f = this._frame;
        this._staticGroup.add(new Konva.Rect({
            x: f.x, y: f.y, width: f.w, height: f.h,
            fill: '#d6d0be',
            stroke: '#908878', strokeWidth: 2,
            cornerRadius: f.rx,
        }));
        this._staticGroup.add(new Konva.Rect({
            x: f.x + 2, y: f.y + 2,
            width: f.w - 4, height: f.h * 0.07,
            fill: 'rgba(255,255,255,0.18)',
            cornerRadius: [f.rx, f.rx, 0, 0],
        }));
    }

    _drawFaceStatic() {
        const { cx, cy, r } = this._face;
        const f = this._frame;
        const lW = this._divX;

        this._staticGroup.add(new Konva.Rect({
            x: f.x + 2, y: f.y + 2,
            width: lW - f.x - 3, height: f.h - 4,
            fill: '#ece8d8',
            cornerRadius: [f.rx - 1, 0, 0, f.rx - 1],
        }));

        this._staticGroup.add(new Konva.Circle({
            x: cx, y: cy, radius: r + 6,
            fillLinearGradientStartPoint: { x: -(r+6), y: -(r+6) },
            fillLinearGradientEndPoint:   { x:  (r+6), y:  (r+6) },
            fillLinearGradientColorStops: [0, '#888080', 0.5, '#d0c8c0', 1, '#706868'],
            stroke: '#504848', strokeWidth: 1.5,
        }));

        this._staticGroup.add(new Konva.Circle({
            x: cx, y: cy, radius: r,
            fill: '#f6f2e4',
            stroke: '#ccc4b0', strokeWidth: 1,
        }));

        this._staticGroup.add(new Konva.Circle({
            x: cx, y: cy, radius: r,
            fillRadialGradientStartPoint:  { x: 0, y: 0 },
            fillRadialGradientEndPoint:    { x: 0, y: 0 },
            fillRadialGradientStartRadius: r * 0.52,
            fillRadialGradientEndRadius:   r,
            fillRadialGradientColorStops:  [0, 'rgba(0,0,0,0)', 1, 'rgba(0,0,0,0.08)'],
            listening: false,
        }));

        const pfMarks = [
            { pf: 0.3, side: -1 }, { pf: 0.4, side: -1 },
            { pf: 0.5, side: -1 }, { pf: 0.6, side: -1 },
            { pf: 0.7, side: -1 }, { pf: 0.8, side: -1 },
            { pf: 0.9, side: -1 }, { pf: 1.0, side: 0 },
            { pf: 0.9, side: 1 }, { pf: 0.8, side: 1 },
            { pf: 0.7, side: 1 }, { pf: 0.6, side: 1 },
            { pf: 0.5, side: 1 }, { pf: 0.4, side: 1 },
            { pf: 0.3, side: 1 },
        ];

        const outerR = r * 0.94;
        pfMarks.forEach((m) => {
            let angDeg;
            if (m.side === 0) {
                angDeg = 270;
            } else {
                const phi = Math.acos(Math.max(0.01, Math.min(1, m.pf)));
                const phiDeg = phi * 180 / Math.PI;
                angDeg = 270 - m.side * phiDeg;
            }
            const angRad = angDeg * Math.PI / 180;

            const showLabel = m.pf === 1.0 || m.pf === 0.9 || m.pf === 0.7 || m.pf === 0.5;
            const isMajor = m.pf >= 0.5;
            const innerR = isMajor ? r * 0.74 : r * 0.82;
            const sw = isMajor ? 1.7 : 0.85;
            const col = isMajor ? '#181818' : '#606060';

            this._staticGroup.add(new Konva.Line({
                points: [
                    cx + outerR * Math.cos(angRad), cy + outerR * Math.sin(angRad),
                    cx + innerR * Math.cos(angRad), cy + innerR * Math.sin(angRad),
                ],
                stroke: col, strokeWidth: sw, lineCap: 'round', listening: false,
            }));

            if (showLabel) {
                const labelR = r * 0.66;
                const fs = Math.max(7, r * 0.140);
                this._staticGroup.add(new Konva.Text({
                    x: cx + labelR * Math.cos(angRad) - fs * 1.1,
                    y: cy + labelR * Math.sin(angRad) - fs * 0.5,
                    text: m.pf >= 1 ? '1' : m.pf.toFixed(1),
                    fontSize: fs, fontFamily: 'Arial', fill: '#181818',
                    align: 'center', width: fs * 2.2,
                }));
            }
        });

        this._drawFaceArc(cx, cy, outerR, this._angleStart, this._angleStart + this._angleSweep, '#282818', 1.2);
        this._drawFaceArc(cx, cy, outerR,
            this._angleStart + 15, this._angleStart + this._angleSweep - 15,
            'rgba(210,30,10,0.25)', 4.5);

        const pW = r * 1.30, pH = r * 0.22;
        const pX = cx - pW / 2, pY = cy + r * 0.28;
        this._staticGroup.add(new Konva.Rect({
            x: pX, y: pY, width: pW, height: pH,
            fill: '#e8e2d0', stroke: '#b0a890', strokeWidth: 0.8, cornerRadius: 2,
        }));
        const pFs = Math.max(8, r * 0.150);
        this._staticGroup.add(new Konva.Text({
            x: pX + 2, y: pY + pH - pFs - 2,
            text: 'cosφ  0 ~ 1',
            fontSize: pFs, fontFamily: 'Arial', fontStyle: 'bold', fill: '#381818',
            width: pW - 4, align: 'center',
        }));

        const symR = r * 0.10;
        const symY = cy + r * 0.54;
        this._drawInductorSymbol(cx - r * 0.72, symY, symR * 1.2, symR * 0.7);
        this._drawCapacitorSymbol(cx + r * 0.76, symY, symR * 0.6, symR * 1.0);

        this._staticGroup.add(new Konva.Circle({
            x: cx, y: cy, radius: r * 0.055,
            fill: '#c0b878', stroke: '#908848', strokeWidth: 1,
        }));
    }

    _drawFaceArc(cx, cy, radius, startDeg, endDeg, stroke, sw) {
        const steps = Math.max(24, Math.abs(endDeg - startDeg) / 2);
        const pts = [];
        for (let i = 0; i <= steps; i++) {
            const a = (startDeg + (endDeg - startDeg) * (i / steps)) * Math.PI / 180;
            pts.push(cx + radius * Math.cos(a), cy + radius * Math.sin(a));
        }
        this._staticGroup.add(new Konva.Line({
            points: pts, stroke, strokeWidth: sw,
            lineCap: 'round', lineJoin: 'round', listening: false,
        }));
    }

    _drawInductorSymbol(x, y, w, h) {
        const pts = [];
        const segments = 6;
        for (let i = 0; i <= segments; i++) {
            const t = i / segments;
            const px = x - w / 2 + t * w;
            const py = y + h * (i % 2 === 0 ? 0.5 : -0.5);
            pts.push(px, py);
        }
        this._staticGroup.add(new Konva.Line({
            points: pts,
            stroke: '#383838', strokeWidth: 1.8, lineCap: 'round', listening: false,
        }));
        this._staticGroup.add(new Konva.Line({
            points: [x - w / 2 - 4, y, x - w / 2, y],
            stroke: '#383838', strokeWidth: 1.5, listening: false,
        }));
        this._staticGroup.add(new Konva.Line({
            points: [x + w / 2, y, x + w / 2 + 4, y],
            stroke: '#383838', strokeWidth: 1.5, listening: false,
        }));
    }

    _drawCapacitorSymbol(x, y, gap, hh) {
        this._staticGroup.add(new Konva.Line({
            points: [x - gap / 2, y - hh / 2, x - gap / 2, y + hh / 2],
            stroke: '#383838', strokeWidth: 2, lineCap: 'round', listening: false,
        }));
        this._staticGroup.add(new Konva.Line({
            points: [x + gap / 2, y - hh / 2, x + gap / 2, y + hh / 2],
            stroke: '#383838', strokeWidth: 2, lineCap: 'round', listening: false,
        }));
        this._staticGroup.add(new Konva.Line({
            points: [x - gap / 2 - 4, y, x - gap / 2, y],
            stroke: '#383838', strokeWidth: 1.5, listening: false,
        }));
        this._staticGroup.add(new Konva.Line({
            points: [x + gap / 2, y, x + gap / 2 + 4, y],
            stroke: '#383838', strokeWidth: 1.5, listening: false,
        }));
    }

    // ─── 右侧原理结构 ─────────────────────────

    _drawPrincipleStatic() {
        const W = this.width, H = this.height;
        const f = this._frame;

        this._staticGroup.add(new Konva.Rect({
            x: this._divX + 1, y: f.y + 2,
            width: W - this._divX - f.x - 2, height: f.h - 4,
            fill: '#eaecf4',
            cornerRadius: [0, f.rx - 1, f.rx - 1, 0],
        }));

        this._drawFixedCoils();
        this._drawCurrentPath();
        this._drawVoltagePaths();
        this._drawRvLv();
        this._drawShaft();
        this._drawTerminals();
        this._drawRotorLabels();
    }

    _drawFixedCoils() {
        const turnCount = 4;
        const turnW = Math.max(4, this._ccTop.w * 0.06);
        [this._ccTop, this._ccBot].forEach((cc, idx) => {
            const { x, y, w, h } = cc;
            const isTop = idx === 0;

            this._staticGroup.add(new Konva.Rect({
                x, y, width: w, height: h,
                fill: '#d8e0ee',
                stroke: '#8090b0', strokeWidth: 1,
                cornerRadius: 2,
            }));

            for (let t = 0; t < turnCount; t++) {
                const tx = x + w * (0.10 + t * 0.22);
                const tw = turnW;
                this._staticGroup.add(new Konva.Rect({
                    x: tx - tw / 2, y: y + 3,
                    width: tw, height: h - 6,
                    fill: '#c87830',
                    stroke: '#a05018',
                    strokeWidth: 0.8,
                    cornerRadius: 1,
                }));
                if (t < turnCount - 1) {
                    const nextTx = x + w * (0.10 + (t + 1) * 0.22);
                    this._staticGroup.add(new Konva.Line({
                        points: [tx + tw / 2, y + h / 2, nextTx - tw / 2, y + h / 2],
                        stroke: '#a05820', strokeWidth: 1.2,
                        listening: false,
                    }));
                }
            }

            const symR = h * 0.28;
            const syms = isTop
                ? [{ dx: w * 0.15, out: true }, { dx: w * 0.85, out: false }]
                : [{ dx: w * 0.15, out: false }, { dx: w * 0.85, out: true }];
            syms.forEach(s => {
                const sx = x + s.dx, sy = y + h / 2;
                this._staticGroup.add(new Konva.Circle({
                    x: sx, y: sy, radius: symR,
                    fill: '#e8f0f8', stroke: '#3050a0', strokeWidth: 1.2,
                }));
                if (s.out) {
                    this._staticGroup.add(new Konva.Circle({
                        x: sx, y: sy, radius: symR * 0.28,
                        fill: '#d03020',
                    }));
                } else {
                    const dl = symR * 0.55;
                    this._staticGroup.add(new Konva.Line({
                        points: [sx - dl, sy - dl, sx + dl, sy + dl],
                        stroke: '#d03020', strokeWidth: 1.4, lineCap: 'round',
                    }));
                    this._staticGroup.add(new Konva.Line({
                        points: [sx + dl, sy - dl, sx - dl, sy + dl],
                        stroke: '#d03020', strokeWidth: 1.4, lineCap: 'round',
                    }));
                }
            });
        });
    }

    _drawCurrentPath() {
        const ip = this._portIP;
        const inn = this._portIN;
        const tL = this._ccTopL, tR = this._ccTopR;
        const bL = this._ccBotL, bR = this._ccBotR;
        const tcy = this._termCY;
        const st = '#b03020';

        this._staticGroup.add(new Konva.Line({
            points: [ip.x, tcy, ip.x, tL.y, tL.x, tL.y],
            stroke: st, strokeWidth: 1.5, dash: [6, 4], lineCap: 'round',
        }));
        this._staticGroup.add(new Konva.Line({
            points: [tR.x, tR.y, tR.x, bR.y],
            stroke: st, strokeWidth: 1.5, dash: [6, 4], lineCap: 'round',
        }));
        this._staticGroup.add(new Konva.Line({
            points: [bL.x, bL.y, bL.x, tcy, inn.x, tcy],
            stroke: st, strokeWidth: 1.5, dash: [6, 4], lineCap: 'round',
        }));
    }

    _drawVoltagePaths() {
        const up = this._portUP;
        const un = this._portUN;
        const vc = this._vcVert;
        const rv = this._rvPos;
        const lv = this._lVPos;
        const tcy = this._termCY;
        const rh = 18;
        const st1 = '#1a7a2a';
        const st2 = '#2a4aaa';

        this._staticGroup.add(new Konva.Line({
            points: [up.x, tcy, rv.cx, rv.cy + rh / 2 + 6],
            stroke: st1, strokeWidth: 1.5, dash: [6, 4], lineCap: 'round',
        }));

        this._staticGroup.add(new Konva.Line({
            points: [rv.cx, rv.cy - rh / 2, rv.cx, lv.cy + 10],
            stroke: st1, strokeWidth: 1.5, listening: false,
        }));

        const branchY = (rv.cy - rh / 2 + lv.cy + 10) / 2;
        this._staticGroup.add(new Konva.Line({
            points: [rv.cx - 8, branchY, rv.cx + 8, branchY],
            stroke: '#605040', strokeWidth: 1, listening: false,
        }));

        this._staticGroup.add(new Konva.Line({
            points: [rv.cx, lv.cy + 10, rv.cx, vc.cy + vc.h / 2],
            stroke: st1, strokeWidth: 1.5, dash: [6, 4], lineCap: 'round',
        }));
        this._staticGroup.add(new Konva.Line({
            points: [vc.cx, vc.cy - vc.h / 2, un.x, vc.cy - vc.h / 2, un.x, tcy],
            stroke: st1, strokeWidth: 1.5, dash: [6, 4], lineCap: 'round',
        }));

        this._staticGroup.add(new Konva.Line({
            points: [rv.cx, lv.cy + 10, rv.cx + 24, lv.cy + 10],
            stroke: st2, strokeWidth: 1.5, listening: false,
        }));

        const lvHh = this._lVHalfH || 16;
        this._staticGroup.add(new Konva.Line({
            points: [rv.cx + 24, lv.cy - lvHh, rv.cx + 24, vc.cy + vc.h / 2],
            stroke: st2, strokeWidth: 1.5, dash: [6, 4], lineCap: 'round',
        }));
        this._staticGroup.add(new Konva.Line({
            points: [vc.cx, vc.cy + vc.h / 2, rv.cx + 24, vc.cy + vc.h / 2],
            stroke: st2, strokeWidth: 1.5, dash: [6, 4], lineCap: 'round',
        }));
    }

    _drawRvLv() {
        const rv = this._rvPos;
        const lv = this._lVPos;
        const rw = 10, rh = 18;

        this._staticGroup.add(new Konva.Line({
            points: [rv.cx, rv.cy + rh / 2, rv.cx, rv.cy + rh / 2 + 6],
            stroke: '#1a7a2a', strokeWidth: 1.5, listening: false,
        }));
        this._staticGroup.add(new Konva.Line({
            points: [rv.cx, rv.cy - rh / 2, rv.cx, rv.cy - rh / 2 - 6],
            stroke: '#1a7a2a', strokeWidth: 1.5, listening: false,
        }));
        this._staticGroup.add(new Konva.Rect({
            x: rv.cx - rw / 2, y: rv.cy - rh / 2,
            width: rw, height: rh,
            fill: '#e0e8f0', stroke: '#1a7a2a', strokeWidth: 2,
        }));
        const fsR = Math.max(8, this.width * 0.018);
        this._staticGroup.add(new Konva.Text({
            x: rv.cx - 10, y: rv.cy + 7,
            text: 'Rv', fontSize: fsR, fontFamily: 'Arial', fontStyle: 'italic',
            fill: '#1a7a2a', width: 20, align: 'center',
        }));

        const lvHh = 16;
        this._lVHalfH = lvHh;
        this._staticGroup.add(new Konva.Line({
            points: [lv.cx, lv.cy + lvHh, lv.cx, lv.cy + lvHh + 6],
            stroke: '#2a4aaa', strokeWidth: 1.5, listening: false,
        }));
        this._staticGroup.add(new Konva.Line({
            points: [lv.cx, lv.cy - lvHh, lv.cx, lv.cy - lvHh - 6],
            stroke: '#2a4aaa', strokeWidth: 1.5, listening: false,
        }));

        const arcR = 5;
        for (let i = 0; i < 4; i++) {
            const cyOff = lv.cy - lvHh + 8 + i * 8;
            this._staticGroup.add(new Konva.Path({
                data: `M ${lv.cx - 8} ${cyOff} Q ${lv.cx} ${cyOff - 5} ${lv.cx + 8} ${cyOff}`,
                stroke: '#2a4aaa', strokeWidth: 2, fill: null, listening: false,
            }));
        }

        const fsL = Math.max(8, this.width * 0.018);
        this._staticGroup.add(new Konva.Text({
            x: lv.cx + 12, y: lv.cy - 9,
            text: 'Lv', fontSize: fsL, fontFamily: 'Arial', fontStyle: 'italic',
            fill: '#2a4aaa', width: 20, align: 'center',
        }));
    }

    _drawShaft() {
        const { x, y0, y1 } = this._shaft;
        this._staticGroup.add(new Konva.Line({
            points: [x, y0, x, y1],
            stroke: '#707070', strokeWidth: 1.8, dash: [5, 3], lineCap: 'round',
        }));
        [y0 + 4, y1 - 4].forEach(py => {
            this._staticGroup.add(new Konva.Rect({
                x: x - 4, y: py - 3, width: 8, height: 6,
                fill: '#b0a870', stroke: '#808050', strokeWidth: 1, cornerRadius: 2,
            }));
        });
    }

    _drawTerminals() {
        const tR = Math.max(10, this.width * 0.012);
        const tcy = this._termCY;
        const fs = Math.max(14, this.width * 0.016);
        const labelY = tcy + 10;

        this._termLabels.forEach(td => {
            const cx = td.x;
            this._staticGroup.add(new Konva.Circle({
                x: cx, y: tcy+12, radius: tR,
                fill: '#e0d878', stroke: '#908030', strokeWidth: 1,
            }));
            this._staticGroup.add(new Konva.Text({
                x: cx - 32, y: labelY,
                text: td.label, fontSize: fs, fontFamily: 'Arial', fontStyle: 'bold',
                fill: '#381818', width: 24, align: 'center',
            }));
            if (td.label === 'I+' || td.label === 'U+') {
                this._staticGroup.add(new Konva.Text({
                    x: cx - 18, y: tcy - tR,
                    text: '*', fontSize: fs + 12, fontFamily: 'Arial',
                    fill: '#c02020', width: 20, align: 'center',
                }));
            }
        });
    }

    _drawRotorLabels() {
        const vc = this._vcVert;
        const fs = Math.max(7, this.width * 0.017);
        this._staticGroup.add(new Konva.Text({
            x: vc.cx + vc.w / 2 + 4, y: vc.cy - 8,
            text: '同相', fontSize: fs, fontFamily: 'Arial',
            fill: '#1a7a2a', width: 30, align: 'left',
        }));
        this._staticGroup.add(new Konva.Text({
            x: vc.cx + vc.w / 2 + 4, y: vc.cy + 4,
            text: '(Rv)', fontSize: fs - 1, fontFamily: 'Arial', fontStyle: 'italic',
            fill: '#1a7a2a', width: 30, align: 'left',
        }));
        const fs2 = Math.max(7, this.width * 0.017);
        this._staticGroup.add(new Konva.Text({
            x: vc.cx + vc.h / 2 + 2, y: vc.cy - vc.h / 2 - fs2 - 4,
            text: '正交', fontSize: fs2, fontFamily: 'Arial',
            fill: '#2a4aaa', width: 30, align: 'center',
        }));
        this._staticGroup.add(new Konva.Text({
            x: vc.cx + vc.h / 2 + 2, y: vc.cy - vc.h / 2 - 2,
            text: '(Rv+Lv)', fontSize: fs2 - 1, fontFamily: 'Arial', fontStyle: 'italic',
            fill: '#2a4aaa', width: 34, align: 'center',
        }));
    }

    // ═══════════════════════════════════════════════════
    // 动态节点
    // ═══════════════════════════════════════════════════

    _createDynamicNodes() {
        this._createNeedle();
        this._createHairspringLeft();
        this._createPointerShaft();
        this._createRotorCoils();
        this._createForceArrows();
        this._createPFDisplay();
    }

    _createNeedle() {
        const { cx, cy, r } = this._face;
        const needleLen = r * 0.86;
        const tailLen   = r * 0.14;

        this._needleGroup = new Konva.Group({ x: cx, y: cy, rotation: this._needleAngle });

        this._needleGroup.add(new Konva.Line({
            points: [-tailLen, 0, needleLen * 0.90, 0],
            stroke: '#cc2010', strokeWidth: 2.3, lineCap: 'round',
        }));
        this._needleGroup.add(new Konva.Line({
            points: [needleLen * 0.68, -2.0, needleLen * 0.90, 0, needleLen * 0.68, 2.0],
            closed: true, fill: '#cc2010', stroke: '#cc2010', strokeWidth: 0.5,
        }));
        this._needleGroup.add(new Konva.Rect({
            x: -tailLen - 5, y: -2.2, width: 7, height: 4.4,
            fill: '#aa1008', cornerRadius: 1,
        }));

        this._dynamicGroup.add(this._needleGroup);

        this._dynamicGroup.add(new Konva.Circle({
            x: cx, y: cy, radius: r * 0.058,
            fillLinearGradientStartPoint: { x: -3, y: -3 },
            fillLinearGradientEndPoint:   { x:  3, y:  3 },
            fillLinearGradientColorStops: [0, '#f0e060', 0.5, '#c8a838', 1, '#908020'],
            stroke: '#706018', strokeWidth: 1, listening: false,
        }));
    }

    _createHairspringLeft() {
        const { cx, cy, r } = this._face;

        this._hairspringGroup = new Konva.Group({ x: cx, y: cy, rotation: this._needleAngle });

        const turns = 2.5, steps = 80;
        const r0 = r * 0.065, r1 = r * 0.185;
        const pts = [];
        for (let i = 0; i <= steps; i++) {
            const t   = i / steps;
            const ang = t * turns * 2 * Math.PI - Math.PI / 2;
            const rad = r0 + (r1 - r0) * t;
            pts.push(rad * Math.cos(ang), rad * Math.sin(ang));
        }
        this._hairspringGroup.add(new Konva.Line({
            points: pts, stroke: '#9080c0', strokeWidth: 0.8,
            lineCap: 'round', lineJoin: 'round', listening: false,
        }));
        this._dynamicGroup.add(this._hairspringGroup);
    }

    _createRotorCoils() {
        const vcVert = this._vcVert;
        const vcHorz = this._vcHorz;

        this._rotorGroup = new Konva.Group({
            x: vcVert.cx, y: vcVert.cy,
            rotation: this._vcAngle,
        });

        const hwV = vcVert.w / 2, hhV = vcVert.h / 2;
        this._rotorGroup.add(new Konva.Line({
            points: [-hwV, -hhV, hwV, -hhV, hwV, hhV, -hwV, hhV],
            closed: true,
            fill: 'rgba(30,130,50,0.25)',
            stroke: '#1a7a2a', strokeWidth: 2,
        }));
        const turnCount = 8;
        for (let i = 1; i < turnCount; i++) {
            const ry = -hhV + (i / turnCount) * vcVert.h;
            this._rotorGroup.add(new Konva.Line({
                points: [-hwV + 3, ry, hwV - 3, ry],
                stroke: '#1a7a2a', strokeWidth: 0.6, listening: false,
            }));
        }

        const hwH = vcHorz.w / 2, hhH = vcHorz.h / 2;
        this._rotorGroup.add(new Konva.Line({
            points: [-hwH, -hhH, hwH, -hhH, hwH, hhH, -hwH, hhH],
            closed: true,
            fill: 'rgba(40,80,180,0.25)',
            stroke: '#2a4aaa', strokeWidth: 2,
        }));
        for (let i = 1; i < turnCount; i++) {
            const rx = -hwH + (i / turnCount) * vcHorz.w;
            this._rotorGroup.add(new Konva.Line({
                points: [rx, -hhH + 3, rx, hhH - 3],
                stroke: '#2a4aaa', strokeWidth: 0.6, listening: false,
            }));
        }

        this._rotorGroup.add(new Konva.Circle({
            x: 0, y: 0, radius: 4,
            fill: '#d0c060', stroke: '#a09040', strokeWidth: 1,
        }));

        this._dynamicGroup.add(this._rotorGroup);
    }

    _createPointerShaft() {
        const rCx = this._shaft.x;
        const rCy = this._vcVert.cy;
        const len = this._face.r * 0.86;

        this._pointerGroup = new Konva.Group({ x: rCx, y: rCy, rotation: 0 });

        this._pointerGroup.add(new Konva.Line({
            points: [0, 0, len, 0],
            stroke: '#cc2010', strokeWidth: 2, lineCap: 'round',
        }));
        this._pointerGroup.add(new Konva.Line({
            points: [len * 0.75, -2.5, len, 0, len * 0.75, 2.5],
            closed: true,
            fill: '#cc2010', stroke: '#cc2010', strokeWidth: 0.5,
        }));

        this._dynamicGroup.add(this._pointerGroup);
    }

    _createForceArrows() {
        this._forceGroup = new Konva.Group({ listening: false });
        this._dynamicGroup.add(this._forceGroup);
    }

    _createPFDisplay() {
        const { cx, cy, r } = this._face;
        const fs = Math.max(9, r * 0.195);

        this._pfText = new Konva.Text({
            x: cx - r * 0.68,
            y: cy + r * 0.58,
            text: '1.000',
            fontSize: fs + 4, fontFamily: 'Courier New', fontStyle: 'bold',
            fill: '#204060',
            width: r * 1.36, align: 'center',
        });
        this._dynamicGroup.add(this._pfText);
    }

    // ═══════════════════════════════════════════════════
    // 动态更新
    // ═══════════════════════════════════════════════════

    _updateDynamic() {
        const pf = Math.max(0, Math.min(1, this._currentPF));
        const sign = this._pfSign;

        this._needleAngle = this._pfToAngle(pf, sign);
        this._needleGroup.rotation(this._needleAngle);
        this._hairspringGroup.rotation(this._needleAngle);

        const phiDeg = Math.acos(Math.max(0.01, Math.min(1, pf))) * 180 / Math.PI;
        this._vcAngle = 45 - sign * phiDeg;
        this._rotorGroup.rotation(this._vcAngle);
        this._pointerGroup.rotation(this._needleAngle);

        this._updateForceArrows(pf);

        const pfStr = pf >= 0.999 ? '1.000' : pf.toFixed(3);
        this._pfText.text(pfStr);
    }

    _updateForceArrows(strength) {
        this._forceGroup.destroyChildren();
        const sign = Math.sin(this._fieldPhase) >= 0 ? 1 : -1;
        if (strength < 0.05 || sign === 0) return;

        const topY = this._ccTop.y + this._ccTop.h;
        const botY = this._ccBot.y;
        const alpha = Math.min(0.80, strength * 0.50 + 0.15);
        const midX = this._rCx;
        const midY = (topY + botY) / 2;
        const arrowLen = (botY - topY) * 0.35;

        this._forceGroup.add(new Konva.Arrow({
            points: [midX, midY - arrowLen * sign, midX, midY + arrowLen * sign],
            fill: `rgba(40,80,200,${alpha})`,
            stroke: `rgba(40,80,200,${alpha})`,
            strokeWidth: 2.5, pointerLength: 10, pointerWidth: 7, listening: false,
        }));
    }

    // ═══════════════════════════════════════════════════
    // tick 主循环
    // ═══════════════════════════════════════════════════

    tick(dt) {
        if (!this.sys || !this.sys.voltageSolver) return;

        const solver = this.sys.voltageSolver;
        const ptc = solver.portToCluster;

        const hasV = ptc.has(`${this.id}_wire_up`) && ptc.has(`${this.id}_wire_un`);
        const hasI = ptc.has(`${this.id}_wire_ip`) && ptc.has(`${this.id}_wire_in`);

        let vInstant = 0, iInstant = 0;

        if (hasV) {
            vInstant = solver.getPD(`${this.id}_wire_up`, `${this.id}_wire_un`) || 0;
        }
        if (hasI && this.currentIdx !== undefined) {
            iInstant = this.physCurrent || 0;
        }

        const pInstant = vInstant * iInstant;
        const v2 = vInstant * vInstant;
        const i2 = iInstant * iInstant;

        this._sumV2 -= this._bufV2[this._bufIdx];
        this._bufV2[this._bufIdx] = v2;
        this._sumV2 += v2;

        this._sumI2 -= this._bufI2[this._bufIdx];
        this._bufI2[this._bufIdx] = i2;
        this._sumI2 += i2;

        this._sumP -= this._bufP[this._bufIdx];
        this._bufP[this._bufIdx] = pInstant;
        this._sumP += pInstant;

        const dv = vInstant - this._lastV;
        this._sumIdv += iInstant * dv;
        this._lastV = vInstant;

        this._bufV[this._bufIdx] = vInstant;

        this._bufIdx = (this._bufIdx + 1) % this._bufLen;
        if (this._bufCount < this._bufLen) this._bufCount++;

        const cnt = this._bufCount;
        let vRms = hasV ? Math.sqrt(this._sumV2 / cnt) : 0;
        let iRms = hasI ? Math.sqrt(this._sumI2 / cnt) : 0;
        const pAvg = cnt > 0 ? (this._sumP / cnt) : 0;

        if (vRms < 0.01 || iRms < 0.01) {
            this._targetPF = 1.0;
            this._pfSign = 1;
        } else {
            const pfMag = Math.abs(pAvg) / (vRms * iRms);
            this._targetPF = Math.max(0, Math.min(1, pfMag));

            const dvSign = this._sumIdv;
            const threshold = 1e-6 * vRms * iRms * cnt;
            this._pfSign = Math.abs(dvSign) < threshold ? 1 : (dvSign > 0 ? -1 : 1);
        }

        const tau = Math.max(0.05, this._rampTime);
        const alpha = 1 - Math.exp(-dt / tau);
        this._currentPF += (this._targetPF - this._currentPF) * alpha;

        this._fieldPhase = (this._fieldPhase + dt * 2 * Math.PI * 50) % (2 * Math.PI);

        this._updateDynamic();
        this.markDirty();
        this._refreshIfDirty();
    }

    // ═══════════════════════════════════════════════════
    // 公开 API
    // ═══════════════════════════════════════════════════

    setPF(pf, sign) {
        this._targetPF = Math.max(0, Math.min(1, parseFloat(pf) || 1));
        this._pfSign = sign !== undefined ? (sign >= 0 ? 1 : -1) : 1;
    }

    setRampTime(v) { this._rampTime = Math.max(0.05, parseFloat(v) || 0.4); }

    getPF()   { return this._currentPF; }
    getPhaseDeg() {
        const pf = Math.max(0.01, Math.min(1, this._currentPF));
        return this._pfSign * Math.acos(pf) * 180 / Math.PI;
    }

    update(state) {
        if (typeof state === 'object' && state !== null) {
            if (state.pf !== undefined) this.setPF(state.pf, state.pfSign);
            if (state.rampTime !== undefined) this.setRampTime(state.rampTime);
        } else {
            this.setPF(state);
        }
    }

    // ═══════════════════════════════════════════════════
    // 配置界面
    // ═══════════════════════════════════════════════════

    getConfigFields() {
        return [
            { label: '功率因数 PF',          key: 'pf',       type: 'number' },
            { label: '感性(1)/容性(-1)',     key: 'pfSign',   type: 'number' },
            { label: '响应时间常数 s',       key: 'rampTime', type: 'number' },
            { label: '精度等级',             key: 'accuracy', type: 'text'   },
        ];
    }

    onConfigUpdate(cfg) {
        if (cfg.pf !== undefined) this._targetPF = Math.max(0, Math.min(1, parseFloat(cfg.pf) || 1));
        if (cfg.pfSign !== undefined) this._pfSign = parseFloat(cfg.pfSign) >= 0 ? 1 : -1;
        if (cfg.rampTime !== undefined) this._rampTime = Math.max(0.05, parseFloat(cfg.rampTime) || 0.4);
        if (cfg.accuracy !== undefined) this._accuracy = cfg.accuracy;

        this.config = { ...this.config, ...cfg };

        this._recalcGeometry();
        this._staticGroup.destroyChildren();
        this._dynamicGroup.destroyChildren();
        this._drawStaticParts();
        this._createDynamicNodes();
        this._refreshCache?.();
    }

    destroy() {
        super.destroy?.();
    }
}
