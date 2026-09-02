import { BaseComponent } from './BaseComponent.js';

export class JSZ3N extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.width = Math.max(380, config.width || 420);
        this.height = Math.max(240, config.height || 280);

        this.type = 'relay';
        this.special = 'time';
        this.cache = 'fixed';

        this._initGroups();
        this._recalcGeometry();
        this._initParameters(config);
        this._init();

        this.config = {
            delayTime: this.delayTime,
            coilResistance: this._coilResistance,
        };

        const cr = this._termCircleR;
        const cx = this._termCircleCx;
        const cy = this._termCircleCy;

        this._termDefs.forEach(([n, portName, ang]) => {
            const rad = ang * Math.PI / 180;
            const px = cx + cr * Math.cos(rad);
            const py = cy + cr * Math.sin(rad);
            this.addPort(px, py, portName, 'wire', portName === 'l' || portName === 'r' ? 'p' : null);
        });
    }

    _recalcGeometry() {
        const W = this.width, H = this.height;
        this._divX = W * 0.48;
        this._frame = { x: 2, y: 2, w: W - 4, h: H - 4, rx: 8 };

        const lCx = this._divX / 2;
        const lCy = H * 0.49;
        const lMaxR = Math.max(lCx * 0.9, lCy * 0.55, (H - lCy) * 0.55);
        this._dialCx = lCx;
        this._dialCy = lCy;
        this._dialR = Math.max(60, lMaxR);

        this._dialStartAngle = 135;
        this._dialSweep = 270;

        this._majorTickLen = 12;
        this._minorTickLen = 6;

        const rLeft = this._divX + 15;
        const rRight = W - 15;
        const rWidth = rRight - rLeft;
        this._termCircleCx = (rLeft + rRight) / 2;
        this._termCircleCy = H / 2;
        this._termCircleR = Math.min(rWidth * 0.44, H * 0.40, 110);

        this._termDefs = [
            [1, 'com_b', 112.5],
            [2, 'l', 157.5],
            [3, 'no_b', 202.5],
            [4, 'nc_b', 247.5],
            [5, 'nc_a', 292.5],
            [6, 'no_a', 337.5],
            [7, 'r', 22.5],
            [8, 'com_a', 67.5],
        ];

        this._ledPowerX = lCx - 30;
        this._ledOutputX = lCx + 30;
        this._ledY = H - 28;
        this._ledR = 6;
    }

    _initParameters(config) {
        this.delayTime = config.delayTime !== undefined ? parseFloat(config.delayTime) : 10;
        this.delayTime = Math.max(0, Math.min(30, this.delayTime));
        this._coilResistance = config.coilResistance || 2000;
        this._state = 'idle';
        this._elapsed = 0;
        this._vAvg = 0;
        this._pickupV = 160;
        this._releaseV = 40;
        this._animTick = 0;
        this._san = null;
    }

    _init() {
        this._drawStaticParts();
        this._createDynamicNodes();
        this._bindInteraction();
    }

    _drawStaticParts() {
        const f = this._frame;
        this._staticGroup.add(new Konva.Rect({
            x: f.x, y: f.y, width: f.w, height: f.h,
            fill: '#f0ece4', stroke: '#b8a898', strokeWidth: 1.5, cornerRadius: f.rx,
        }));
        this._staticGroup.add(new Konva.Text({
            x: 28, y: -18, text: 'JSZ3N 断电延时继电器', fontSize: 16, fontStyle: 'bold', fill: '#202838',
        }));
        this._staticGroup.add(new Konva.Rect({
            x: f.x + 2, y: f.y + 2, width: this._divX - f.x - 2, height: f.h - 4,
            fill: '#f5f2ea', cornerRadius: [f.rx, 0, 0, f.rx],
        }));
        this._staticGroup.add(new Konva.Line({
            points: [this._divX, 10, this._divX, this.height - 10],
            stroke: '#b0a898', strokeWidth: 1.5, dash: [5, 3],
        }));

        this._drawDialStatic();
        this._drawTerminalCircle();
    }

    _drawDialStatic() {
        const cx = this._dialCx, cy = this._dialCy, R = this._dialR;
        const startA = this._dialStartAngle;
        const sweep = this._dialSweep;

        const steps = 80;
        const trackPts = [];
        const midR = R - 7;
        const startRad = startA * Math.PI / 180;
        for (let i = 0; i <= steps; i++) {
            const t = i / steps;
            const a = startRad + sweep * t * Math.PI / 180;
            trackPts.push(cx + midR * Math.cos(a), cy + midR * Math.sin(a));
        }
        this._staticGroup.add(new Konva.Line({
            points: trackPts, stroke: '#e0d8cc', strokeWidth: 16,
            lineCap: 'round', listening: false,
        }));

        const borderPts = [];
        for (let i = 0; i <= steps; i++) {
            const t = i / steps;
            const a = startRad + sweep * t * Math.PI / 180;
            borderPts.push(cx + R * Math.cos(a), cy + R * Math.sin(a));
        }
        this._staticGroup.add(new Konva.Line({
            points: borderPts, stroke: '#c8b8a0', strokeWidth: 3,
            lineCap: 'round', listening: false,
        }));

        for (let s = 0; s <= 30; s++) {
            const frac = s / 30;
            const ang = (startA + frac * this._dialSweep) * Math.PI / 180;
            const isMajor = s % 5 === 0;
            const tickLen = isMajor ? this._majorTickLen : this._minorTickLen;
            const rInner = R - 7;
            const x1 = cx + rInner * Math.cos(ang);
            const y1 = cy + rInner * Math.sin(ang);
            const x2 = cx + (rInner - tickLen) * Math.cos(ang);
            const y2 = cy + (rInner - tickLen) * Math.sin(ang);

            this._staticGroup.add(new Konva.Line({
                points: [x1, y1, x2, y2],
                stroke: '#504030', strokeWidth: isMajor ? 2 : 1,
                lineCap: 'round', listening: false,
            }));

            if (isMajor) {
                const lr = rInner - tickLen - 15;
                this._staticGroup.add(new Konva.Text({
                    x: cx + lr * Math.cos(ang) - 8,
                    y: cy + lr * Math.sin(ang) - 7,
                    text: String(s), fontSize: 12, fill: '#403020',
                    listening: false,
                }));
            }
        }

        this._staticGroup.add(new Konva.Text({
            x: cx - 8, y: cy + R * 0.55, text: '秒', fontSize: 12,
            fill: '#504030', listening: false,
        }));

        this._staticGroup.add(new Konva.Text({
            x: cx - 25, y: cy - R - 30, text: '延时设定', fontSize: 13,
            fill: '#504030', listening: false,
        }));

        this._staticGroup.add(new Konva.Text({
            x: cx - 20, y: cy - R - 14, text: '0 ~ 30', fontSize: 12,
            fill: '#706050', listening: false,
        }));

        const dR = R * 0.22;
        const dGrad = [0, '#908878', 0.3, '#c8c0b0', 0.7, '#b8b0a0', 1, '#706858'];
        this._staticGroup.add(new Konva.Circle({
            x: cx, y: cy, radius: dR,
            fillLinearGradientStartPoint: { x: -dR, y: -dR },
            fillLinearGradientEndPoint: { x: dR, y: dR },
            fillLinearGradientColorStops: dGrad,
            stroke: '#605040', strokeWidth: 2,
        }));
        this._staticGroup.add(new Konva.Circle({
            x: cx, y: cy, radius: dR * 0.15,
            fill: '#d0c8b8', stroke: '#807060', strokeWidth: 1,
        }));
    }

    _drawTerminalCircle() {
        const cx = this._termCircleCx, cy = this._termCircleCy, R = this._termCircleR;

        this._staticGroup.add(new Konva.Circle({
            x: cx, y: cy, radius: R,
            stroke: '#a09080', strokeWidth: 1.5, fill: '#ece8e0',
            listening: false,
        }));

        this._termDefs.forEach(([num, portName, ang]) => {
            const rad = ang * Math.PI / 180;
            const px = cx + R * Math.cos(rad);
            const py = cy + R * Math.sin(rad);

            const isNO = num === 3 || num === 6;
            this._staticGroup.add(new Konva.Circle({
                x: px, y: py, radius: 10,
                fill: isNO ? '#f0c0b8' : '#d0c8b8',
                stroke: isNO ? '#d04020' : '#605040', strokeWidth: 2,
                listening: false,
            }));
            this._staticGroup.add(new Konva.Circle({
                x: px, y: py, radius: 4,
                fill: isNO ? '#c03020' : '#302818', listening: false,
            }));

            const lOff = 18;
            const lx = px + lOff * Math.cos(rad);
            const ly = py + lOff * Math.sin(rad);
            this._staticGroup.add(new Konva.Text({
                x: lx - 7, y: ly - 8,
                text: String(num), fontSize: 14, fontStyle: 'bold',
                fill: isNO ? '#d03020' : '#202020', listening: false,
            }));
        });

        this._drawCoilSymbol();
        this._drawContactSymbols();
    }

    _drawCoilSymbol() {
        const cx = this._termCircleCx, cy = this._termCircleCy, R = this._termCircleR;
        const H = this.height;

        const a2 = 157.5 * Math.PI / 180;
        const x2 = cx + R * Math.cos(a2);
        const y2 = cy + R * Math.sin(a2);

        const a7 = 22.5 * Math.PI / 180;
        const x7 = cx + R * Math.cos(a7);
        const y7 = cy + R * Math.sin(a7);

        const bottomY = H - 20;
        const coilW = 52;
        const coilH = 20;
        const coilY = bottomY - coilH;
        const coilLeft = cx - coilW / 2;
        const coilRight = cx + coilW / 2;

        this._staticGroup.add(new Konva.Line({
            points: [x2, y2, x2, bottomY, coilLeft, bottomY],
            stroke: '#605040', strokeWidth: 2, lineJoin: 'round', listening: false,
        }));

        this._staticGroup.add(new Konva.Rect({
            x: coilLeft, y: coilY + coilH / 2, width: coilW, height: coilH,
            fill: '#f8f4ec', stroke: '#605040', strokeWidth: 2, cornerRadius: 4,
            listening: false,
        }));

        const wave = this._genWave(coilLeft + 8, coilY + coilH, coilRight - 8, coilY + coilH, 4, 2.5);
        this._staticGroup.add(new Konva.Line({
            points: wave, stroke: '#202020', strokeWidth: 2,
            lineCap: 'round', listening: false,
        }));

        this._staticGroup.add(new Konva.Line({
            points: [coilRight, bottomY, x7, bottomY, x7, y7],
            stroke: '#605040', strokeWidth: 2, lineJoin: 'round', listening: false,
        }));

        this._staticGroup.add(new Konva.Text({
            x: cx - 80, y: bottomY + 4,
            text: '线圈 220V~', fontSize: 12, fill: '#b02020',
            listening: false,
        }));
    }

    _drawContactSymbols() {
        const cx = this._termCircleCx, cy = this._termCircleCy, R = this._termCircleR;

        const mkPt = (a, r) => ({
            x: cx + r * Math.cos(a),
            y: cy + r * Math.sin(a),
        });

        const p5 = mkPt(292.5 * Math.PI / 180, R);
        const p6 = mkPt(337.5 * Math.PI / 180, R);
        const p8 = mkPt(67.5 * Math.PI / 180, R);
        const p1 = mkPt(112.5 * Math.PI / 180, R);

        const vX = p5.x;
        const pivotY = cy - 15;
        const armLen = 14;

        const ncX = vX - armLen;
        const noX = vX + armLen;

        // NC path: terminal 5 → left → down → NC static contact
        this._staticGroup.add(new Konva.Line({
            points: [vX, p5.y, ncX, p5.y, ncX, pivotY],
            stroke: '#605040', strokeWidth: 2, lineJoin: 'round', listening: false,
        }));
        this._staticGroup.add(new Konva.Circle({
            x: ncX, y: pivotY, radius: 4,
            fill: '#d0c8b8', stroke: '#605040', strokeWidth: 1.5, listening: false,
        }));

        // NO path: terminal 6 → left → down → NO static contact
        this._staticGroup.add(new Konva.Line({
            points: [p6.x, p6.y, noX, p6.y, noX, pivotY],
            stroke: '#605040', strokeWidth: 2, lineJoin: 'round', listening: false,
        }));
        this._staticGroup.add(new Konva.Circle({
            x: noX, y: pivotY, radius: 4,
            fill: '#d0c8b8', stroke: '#605040', strokeWidth: 1.5, listening: false,
        }));

        // COM path: terminal 8 → up → pivot point
        this._staticGroup.add(new Konva.Line({
            points: [p8.x, p8.y, vX, pivotY + 50],
            stroke: '#605040', strokeWidth: 2, listening: false,
        }));
        this._staticGroup.add(new Konva.Circle({
            x: vX, y: pivotY + 50, radius: 3.5,
            fill: '#706050', stroke: '#504030', strokeWidth: 1.5, listening: false,
        }));

        this._ncContactPos = { x: ncX, y: pivotY };
        this._noContactPos = { x: noX, y: pivotY };
        this._comPivotPos = { x: vX, y: pivotY + 50 };

        // COM labels
        this._staticGroup.add(new Konva.Text({
            x: p8.x + 12, y: p8.y + 4,
            text: 'COM', fontSize: 11, fontStyle: 'bold', fill: '#605040',
            listening: false,
        }));
        this._staticGroup.add(new Konva.Text({
            x: p1.x - 40, y: p1.y + 4,
            text: 'COM', fontSize: 11, fontStyle: 'bold', fill: '#605040',
            listening: false,
        }));

        const offR = R + 24;

        const no3 = mkPt(202.5 * Math.PI / 180, offR);
        this._staticGroup.add(new Konva.Text({
            x: no3.x + 5 - 10, y: no3.y - 23,
            text: 'NO', fontSize: 13, fontStyle: 'bold', fill: '#208020',
            listening: false,
        }));
        const no6 = mkPt(337.5 * Math.PI / 180, offR);
        this._staticGroup.add(new Konva.Text({
            x: no6.x - 15 - 10, y: no6.y - 23,
            text: 'NO', fontSize: 13, fontStyle: 'bold', fill: '#208020',
            listening: false,
        }));

        const nc4 = mkPt(247.5 * Math.PI / 180, offR);
        this._staticGroup.add(new Konva.Text({
            x: nc4.x + 10, y: nc4.y - 8,
            text: 'NC', fontSize: 13, fontStyle: 'bold', fill: '#e03030',
            listening: false,
        }));
        const nc5 = mkPt(292.5 * Math.PI / 180, offR);
        this._staticGroup.add(new Konva.Text({
            x: nc5.x - 40 + 10, y: nc5.y - 8,
            text: 'NC', fontSize: 13, fontStyle: 'bold', fill: '#e03030',
            listening: false,
        }));
    }

    _genWave(x1, y1, x2, y2, amp, cycles) {
        const pts = [];
        const dx = x2 - x1;
        const dy = y2 - y1;
        const steps = Math.max(20, Math.round(cycles * 16));
        for (let i = 0; i <= steps; i++) {
            const t = i / steps;
            pts.push(x1 + dx * t, y1 + dy * t + amp * Math.sin(t * cycles * 2 * Math.PI));
        }
        return pts;
    }


    _createDynamicNodes() {
        this._needle = new Konva.Line({
            points: [0, 0, 0, 0],
            stroke: '#e02020', strokeWidth: 3, lineCap: 'round',
            listening: false,
        });
        this._dynamicGroup.add(this._needle);

        this._powerLed = new Konva.Circle({
            x: this._ledPowerX, y: this._ledY, radius: this._ledR,
            fill: '#103010', stroke: '#205020', strokeWidth: 1,
            listening: false,
        });
        this._dynamicGroup.add(this._powerLed);
        this._powerLabel = new Konva.Text({
            x: this._ledPowerX - 12, y: this._ledY + this._ledR + 3,
            text: '电源', fontSize: 12, fill: '#406040',
            listening: false,
        });
        this._dynamicGroup.add(this._powerLabel);

        this._outputLed = new Konva.Circle({
            x: this._ledOutputX, y: this._ledY, radius: this._ledR,
            fill: '#301010', stroke: '#502020', strokeWidth: 1,
            listening: false,
        });
        this._dynamicGroup.add(this._outputLed);
        this._outputLabel = new Konva.Text({
            x: this._ledOutputX - 12, y: this._ledY + this._ledR + 3,
            text: '输出', fontSize: 12, fill: '#504040',
            listening: false,
        });
        this._dynamicGroup.add(this._outputLabel);

        this._stateText = new Konva.Text({
            x: this._dialCx - 12, y: this._dialCy + this._dialR * 0.9,
            text: '', fontSize: 14, fill: '#607080',
            listening: false,
        });
        this._dynamicGroup.add(this._stateText);

        this._progressArc = new Konva.Line({
            points: [], stroke: '#20a030', strokeWidth: 4,
            lineCap: 'round', listening: false,
            visible: false,
        });
        this._dynamicGroup.add(this._progressArc);

        this._contactArm = new Konva.Line({
            points: [0, 0, 0, 0],
            stroke: '#d04020', strokeWidth: 2.5, lineCap: 'round',
            listening: false,
        });
        this._dynamicGroup.add(this._contactArm);

        this._springL = new Konva.Line({
            points: [0, 0, 0, 0],
            stroke: '#d04020', strokeWidth: 2, lineCap: 'round',
            listening: false,
        });
        this._dynamicGroup.add(this._springL);
        this._springR = new Konva.Line({
            points: [0, 0, 0, 0],
            stroke: '#d04020', strokeWidth: 2, lineCap: 'round',
            listening: false,
        });
        this._dynamicGroup.add(this._springR);
        this._hookL = new Konva.Line({
            points: [0, 0, 0, 0],
            stroke: '#d04020',
            strokeWidth: 2,
            lineCap: 'round',
            lineJoin: 'round',
            listening: false,
        });
        this._dynamicGroup.add(this._hookL);

        this._contactAnim = 0;
        this._contactAnimVel = 0;

        this._updateNeedle();
        this._updateLEDs();
        this._updateContactVisual();
    }

    _updateNeedle() {
        const frac = this.delayTime / 30;
        const ang = (this._dialStartAngle + frac * this._dialSweep) * Math.PI / 180;
        const R = this._dialR;
        const cx = this._dialCx, cy = this._dialCy;
        const innerR = R * 0.25;
        const outerR = R - 9;

        this._needle.points([
            cx + innerR * Math.cos(ang + Math.PI),
            cy + innerR * Math.sin(ang + Math.PI),
            cx + outerR * Math.cos(ang),
            cy + outerR * Math.sin(ang),
        ]);
    }

    _updateLEDs() {
        const energized = this._vAvg > this._pickupV;
        const output = this._state === 'output' || this._state === 'delay';

        this._powerLed.fill(energized ? '#20c020' : '#103010');
        this._powerLabel.fill(energized ? '#30d030' : '#406040');

        const blink = this._state === 'delay' && Math.sin(this._animTick * 6) > 0;

        if (this._state === 'output') {
            this._outputLed.fill('#ff3020');
            this._outputLabel.fill('#ff4030');
        } else if (blink) {
            this._outputLed.fill('#ff2000');
            this._outputLabel.fill('#d05030');
        } else {
            this._outputLed.fill('#301010');
            this._outputLabel.fill('#504040');
        }
    }

    _updateDynamic() {
        const st = this._state;
        const et = this._elapsed;

        const _dirty = !this._san || this._san.st !== st || Math.abs(this._san.et - et) > 0.01 || this._san.dt !== this.delayTime;
        if (_dirty) {
            this._san = { st, et, dt: this.delayTime };
            this._progressArc.visible(st === 'delay');
            if (st === 'delay' && this.delayTime > 0) {
                const frac = Math.min(1, et / this.delayTime);
                const cx = this._dialCx, cy = this._dialCy;
                const R = this._dialR - 5;
                const startA = this._dialStartAngle;
                const endA = startA + frac * this._dialSweep;
                const steps = 30;
                const pts = [];
                const startRad = startA * Math.PI / 180;
                const endRad = endA * Math.PI / 180;
                for (let i = 0; i <= steps; i++) {
                    const t = i / steps;
                    const a = startRad + (endRad - startRad) * t;
                    pts.push(cx + R * Math.cos(a), cy + R * Math.sin(a));
                }
                this._progressArc.points(pts);
            }

            const stateMap = {
                idle: '待机',
                delay: '断电延时中',
                output: '输出',
            };
            this._stateText.text(stateMap[st] || '');

            if (st === 'output' || st === 'delay') {
                this._contactAnimTarget = 1;
            } else {
                this._contactAnimTarget = 0;
            }
        }

        this._updateContactVisual();
        this._updateLEDs();
    }

_updateContactVisual() {

    const nc = this._ncContactPos;
    const no = this._noContactPos;
    const pov = this._comPivotPos;
    const t = this._contactAnim;
    //--------------------------------------
    // 1. 动触点位置
    //--------------------------------------
    const mx =
        nc.x + (no.x - nc.x) * t;
    const my =
        nc.y + (no.y - nc.y) * t;
    //--------------------------------------
    // 2. 动触臂
    //--------------------------------------
    this._contactArm.points([
        pov.x,
        pov.y,
        mx,
        my
    ]);
    //--------------------------------------
    // 3. 动触臂方向
    //--------------------------------------
    let dx = mx - pov.x;
    let dy = my - pov.y;
    let len = Math.sqrt(
        dx * dx +
        dy * dy
    );
    if(len < 0.001)
        return;
    let ux = dx / len;
    let uy = dy / len;
    //--------------------------------------
    // 4. 法向量
    //--------------------------------------
    let vx = -uy;
    let vy = ux;
    // 固定弹簧在左侧
    if(vx > 0)
    {
        vx = -vx;
        vy = -vy;
    }
    //--------------------------------------
    // 5. 簧片起点
    //--------------------------------------
    // 靠近动触点
    const startRatio = 0.55;
    const sx =
        pov.x + dx * startRatio;
    const sy =
        pov.y + dy * startRatio;
    //--------------------------------------
    // 6. 簧片长度
    //--------------------------------------
    const springLength = 18;
    const spread = 3;
    //--------------------------------------
    // 7. 两根直线
    //--------------------------------------
    const l1x1 =
        sx + ux * spread;
    const l1y1 =
        sy + uy * spread;
    const l1x2 =
        sx + ux * spread
           + vx * springLength;
    const l1y2 =
        sy + uy * spread
           + vy * springLength;
    const l2x1 =
        sx - ux * spread;
    const l2y1 =
        sy - uy * spread;
    const l2x2 =
        sx - ux * spread
           + vx * springLength;
    const l2y2 =
        sy - uy * spread
           + vy * springLength;
    this._springL.points([
        l1x1,
        l1y1,
        l1x2,
        l1y2
    ]);
    this._springR.points([
        l2x1,
        l2y1,
        l2x2,
        l2y2
    ]);
    //--------------------------------------
    // 8. 弧形接在两根簧片尾端并向两侧展开
    //--------------------------------------
    const points = [];
    const segments = 20;
    const sideExtend = 5;
    const bend = 10;
    const baseExtend = 9;
    const ax1 = l1x2 + ux * sideExtend;
    const ay1 = l1y2 + uy * sideExtend;
    const ax2 = l2x2 - ux * sideExtend;
    const ay2 = l2y2 - uy * sideExtend;
    for (let i = 0; i <= segments; i++) {
        const k = i / segments;
        const x = ax1 + (ax2 - ax1) * k;
        const y = ay1 + (ay2 - ay1) * k;
        const offset = baseExtend - Math.sin(Math.PI * k) * bend;
        points.push(x + vx * offset, y + vy * offset);
    }
    this._hookL.points(points);
}

    _bindInteraction() {
        const cx = this._dialCx, cy = this._dialCy;
        const knobHit = new Konva.Circle({
            x: cx, y: cy, radius: this._dialR * 0.35,
            draggable: true, fill: 'transparent',
        });
        const step = 0.5;
        const clamp = (v) => Math.max(0, Math.min(30, Math.round(v / step) * step));

        knobHit.on('wheel', (e) => {
            e.evt.preventDefault();
            e.evt.stopPropagation();
            this.delayTime = clamp(this.delayTime + (e.evt.deltaY < 0 ? step : -step));
            this._redrawDynamic();
        });

        const origX = cx, origY = cy;
        let dragY = 0, dragAccum = 0;
        knobHit.on('dragstart', (e) => {
            dragY = knobHit.getStage().getPointerPosition().y;
            dragAccum = 0;
            e.cancelBubble = true;
        });
        knobHit.on('dragmove', (e) => {
            e.cancelBubble = true;
            const curY = knobHit.getStage().getPointerPosition().y;
            const dy = origY - curY;
            dragAccum += dy;
            const s = Math.round(dragAccum / 10);
            if (s !== 0) {
                this.delayTime = clamp(this.delayTime + s * step);
                this._redrawDynamic();
                dragAccum -= s * 10;
            }
            knobHit.position({ x: origX, y: origY });
        });
        knobHit.on('dragend', (e) => {
            e.cancelBubble = true;
            knobHit.position({ x: origX, y: origY });
        });

        knobHit.on('mousedown touchstart', (e) => {
            const pos = knobHit.getRelativePointerPosition();
            if (pos.x < 0) {
                this.delayTime = clamp(this.delayTime - step);
            } else {
                this.delayTime = clamp(this.delayTime + step);
            }
            this._redrawDynamic();
            e.cancelBubble = true;
        });
        knobHit.on('mouseenter', () => { document.body.style.cursor = 'pointer'; });
        knobHit.on('mouseleave', () => { document.body.style.cursor = 'default'; });
        this._interactGroup.add(knobHit);
    }

    tick(dt) {
        if (this.sys && typeof this.sys.getVoltageBetween === 'function') {
            const vInst = Math.abs(this.sys.getVoltageBetween(
                `${this.id}_wire_l`,
                `${this.id}_wire_r`
            ));
            this._vAvg = this._vAvg * 0.92 + (isFinite(vInst) ? vInst : 0) * 0.08;
        } else {
            this._vAvg *= 0.9;
        }
        this._animTick += dt;

        const energized = this._vAvg > this._pickupV;
        const deenergized = this._vAvg < this._releaseV;

        if (this._state === 'idle') {
            if (energized) {
                this._state = 'output';
                this._elapsed = 0;
            }
        } else if (this._state === 'output') {
            if (deenergized) {
                this._state = 'delay';
                this._elapsed = 0;
            }
        } else if (this._state === 'delay') {
            if (energized) {
                this._state = 'output';
                this._elapsed = 0;
            } else {
                this._elapsed += dt;
                if (this._elapsed >= this.delayTime) {
                    this._state = 'idle';
                    this._elapsed = 0;
                }
            }
        }

        const target = this._contactAnimTarget !== undefined ? this._contactAnimTarget : 0;
        const diff = target - this._contactAnim;
        if (Math.abs(diff) > 0.001) {
            this._contactAnimVel += diff * 30 * dt;
            this._contactAnimVel *= 0.82;
            this._contactAnim += this._contactAnimVel;
            this._contactAnim = Math.max(0, Math.min(1, this._contactAnim));
        } else {
            this._contactAnim = target;
            this._contactAnimVel = 0;
        }

        this._updateDynamic();
        this.markDirty();
        this._refreshIfDirty();
        if (this.sys && typeof this.sys.requestRedraw === 'function') {
            this.sys.requestRedraw();
        }
    }

    _redrawDynamic() {
        this._updateNeedle();
        this._updateDynamic();
        if (this.sys && typeof this.sys.requestRedraw === 'function') {
            this.sys.requestRedraw();
        }
    }

    getConfigFields() {
        return [
            { label: '延时时间 (s)', key: 'delayTime', type: 'number', min: 0, max: 30, step: 0.5 },
        ];
    }

    onConfigUpdate(cfg) {
        if (cfg.delayTime !== undefined) {
            this.delayTime = Math.max(0, Math.min(30, parseFloat(cfg.delayTime)));
        }
        this.config = { ...this.config, delayTime: this.delayTime };
        this._redrawDynamic();
        this._refreshCache?.();
    }

    destroy() { super.destroy?.(); }
}
