import { BaseComponent } from './BaseComponent.js';

export class HallClampMeter extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.width  = Math.max(300, config.width  || 380);
        this.height = Math.max(360, config.height || 480);

        this.type    = 'hallclamp';
        this.cache   = 'fixed';

        this._initGroups();
        this._recalcGeometry();
        this._initParameters(config);
        this._init();

        this.config = {
            id: this.id,
            current:  this._targetI,
            range:    this._range,
            jawOpen:  this._jawOpen,
            rampTime: this._rampTime,
            isDC:     this._isDC,
        };

        this.addPort(this._portCom.x, this._portCom.y-3, 'com', 'wire', 'n');
        this.addPort(this._portVA.x,  this._portVA.y-3,  'v',  'wire', 'p');
    }

    _recalcGeometry() {
        const W = this.width, H = this.height;
        this._divX = W * 0.50;
        this._frame = { x: 2, y: 2, w: W - 4, h: H - 4, rx: 10 };

        const lW = this._divX;
        const bodyCx = lW * 0.50;

        const jawH    = H * 0.28;
        const jawW    = lW * 0.65;
        const jawTopY = 0;
        this._jaw = {
            cx: bodyCx, topY: jawTopY, w: jawW, h: jawH,
            outerR: jawW * 0.48, innerR: jawW * 0.25,
        };

        const knobCy = H * 0.47;
        this._knob = { cx: bodyCx, cy: knobCy, r: Math.min(lW * 0.22, H * 0.08) };

        const lcdW = lW * 0.76;
        const lcdH = H * 0.30;
        this._lcd = {
            cx: bodyCx, cy: H * 0.82, w: lcdW, h: lcdH,
        };

        this._trigger = {
            x: bodyCx - jawW * 0.72,
            y: jawTopY + jawH * 0.5,
            w: lW * 0.14, h: H * 0.08, rx: 5,
        };

        this._btnFunc = {
            cx: bodyCx - lW * 0.22,
            cy: H * 0.93, r: Math.max(6, lW * 0.025),
        };
        this._btnMode = {
            cx: bodyCx + lW * 0.24,
            cy: H * 0.93, r: Math.max(6, lW * 0.025),
        };

        const jackY = H * 0.99;
        this._jackCOM = { x: bodyCx - lW * 0.14, y: jackY };
        this._jackVA  = { x: bodyCx + lW * 0.14, y: jackY };
        this._portCom = { x: this._jackCOM.x, y: H - 2 };
        this._portVA  = { x: this._jackVA.x,  y: H - 2 };

        const rLeft = this._divX + W * 0.025;
        const rW    = W - rLeft - W * 0.020;
        const rCx   = rLeft + rW * 0.50;
        const coreR = Math.min(rW * 0.35, H * 0.20);
        this._core = { cx: rCx, cy: H * 0.15, outerR: coreR, innerR: coreR * 0.46 };
        this._wireLine = { x0: rLeft, x1: rLeft + rW, y: this._core.cy };
        const coreBottom = H * 0.15 + coreR;
        const useableH = (H - 14) - coreBottom;
        const ampH = useableH * 0.22;
        const condH = useableH * 0.16;
        const gap = useableH * 0.04;
        const adcH = useableH * 0.22;
        const mcuH = useableH * 0.22;
        let y = coreBottom + gap;
        this._amplifier = {
            cx: rCx, cy: y + ampH/2, w: rW * 0.50, h: ampH,
        };
        y += ampH + gap;
        this._conditioner = {
            cx: rCx, cy: y + condH/2, w: rW * 0.46, h: condH,
        };
        y += condH + gap;
        this._adc = {
            cx: rCx, cy: y + adcH/2, w: rW * 0.44, h: adcH,
        };
        y += adcH + gap;
        this._mcu = {
            cx: rCx, cy: y + mcuH/2, w: rW * 0.40, h: mcuH,
        };

        this._hallGap = {
            x: rCx - coreR * 0.12,
            y: this._core.cy + coreR * 0.75,
            w: coreR * 0.24,
            h: coreR * 0.20,
        };
    }

    _initParameters(config) {
        this._range     = config.range    !== undefined ? parseFloat(config.range)   : 5;
        this._targetI   = config.current  !== undefined ? parseFloat(config.current) : 0;
        this._currentI  = this._targetI;
        this._rampTime  = config.rampTime !== undefined ? parseFloat(config.rampTime): 0.4;
        this._jawOpen   = !!config.jawOpen;
        this._jawAngle  = this._jawOpen ? 1 : 0;
        this._measuring = false;
        this._oilFault = false;
        this._knobAngle = this._rangeToKnobAngle(this._range);
        this._holdMode = false;
        this._isDC = config.isDC !== undefined ? !!config.isDC : true;
        this._backlight = false;
    }

    _rangeToKnobAngle(range) {
        const map = { 5: -90, 50: 0, 100: 90, 250: 180 };
        return map[range] !== undefined ? map[range] : 0;
    }

    _init() {
        this._drawStaticParts();
        this._createDynamicNodes();
        this._bindInteraction();
    }

    _drawStaticParts() {
        this._drawBodyShell();
        this._drawJawStatic();
        this._drawLCDStatic();
        this._drawTriggerStatic();
        this._drawKnobStatic();
        this._drawJackStatic();
        this._drawFuncButtons();
        this._drawDivider();
        this._drawPrincipleStatic();
    }

    _drawBodyShell() {
        const W = this.width, H = this.height;
        const f = this._frame;
        const lW = this._divX;

        this._staticGroup.add(new Konva.Rect({
            x: f.x + 2, y: f.y + 2,
            width: lW - f.x - 3, height: f.h - 4,
            fill: '#dbe6f1',
            cornerRadius: [f.rx - 1, 0, 0, f.rx - 1],
        }));

        const bodyTop = this._jaw.topY + this._jaw.h - H * 0.01;
        const bodyW = lW * 0.80;
        const bodyX = this._jaw.cx - bodyW / 2;
        const bodyH = H - bodyTop - H * 0.02;
        this._staticGroup.add(new Konva.Rect({
            x: bodyX, y: bodyTop-5,
            width: bodyW, height: bodyH,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint:   { x: bodyW, y: 0 },
            fillLinearGradientColorStops: [
                0, '#2a2f35', 0.08, '#40464e',
                0.50, '#343940', 0.92, '#40464e', 1, '#2a2f35',
            ],
            stroke: '#1e2226', strokeWidth: 1.5,
            cornerRadius: [4, 4, 8, 8],
        }));

        const badgeW = bodyW * 0.70, badgeH = bodyH * 0.06;
        const badgeX = this._jaw.cx - badgeW / 2;
        const badgeY = bodyTop + bodyH * 0.04;
        this._staticGroup.add(new Konva.Rect({
            x: badgeX, y: badgeY-10, width: badgeW, height: badgeH,
            fill: '#2a3848', stroke: '#1a2838', strokeWidth: 0.8, cornerRadius: 2,
        }));
        const bFs = Math.max(7, badgeW * 0.11);
        this._staticGroup.add(new Konva.Text({
            x: badgeX + 3, y: badgeY -8,
            text: '霍尔钳形电流表',
            fontSize: bFs, fontFamily: 'Arial', fontStyle: 'bold',
            fill: '#e0e8f0', width: badgeW + 6, align: 'center',
        }));
    }

    _drawJawStatic() {
        const { cx, topY, outerR, innerR, h } = this._jaw;
        const midY = topY + h * 0.50;

        this._staticGroup.add(new Konva.Arc({
            x: cx, y: midY,
            innerRadius: innerR, outerRadius: outerR,
            angle: 180, rotation: 0,
            fillLinearGradientStartPoint: { x: -outerR, y: 0 },
            fillLinearGradientEndPoint:   { x:  outerR, y: 0 },
            fillLinearGradientColorStops: [
                0, '#e8a820', 0.2, '#f0c040',
                0.5, '#f8d860', 0.8, '#f0c040', 1, '#e8a820',
            ],
            stroke: '#c88810', strokeWidth: 2,
            listening: false,
        }));

        for (let i = 1; i < 8; i++) {
            const ang = (i / 8) * Math.PI;
            this._staticGroup.add(new Konva.Line({
                points: [
                    cx + innerR * Math.cos(ang), midY + innerR * Math.sin(ang),
                    cx + outerR * Math.cos(ang), midY + outerR * Math.sin(ang),
                ],
                stroke: '#c88810', strokeWidth: 0.6, listening: false,
            }));
        }

        [cx - outerR * 0.85, cx + outerR * 0.85].forEach(hx => {
            this._staticGroup.add(new Konva.Circle({
                x: hx, y: midY, radius: outerR * 0.10,
                fill: '#d0a030', stroke: '#a07820', strokeWidth: 1,
            }));
        });

        const iFs = Math.max(12, outerR * 0.18);
        this._staticGroup.add(new Konva.Text({
            x: cx - outerR * 0.6, y: midY + outerR * 0.15,
            text: '导线穿入', fontSize: iFs, fontFamily: 'Arial',
            fill: '#fa3c02', width: outerR * 1.2, align: 'center',
        }));
    }

    _drawLCDStatic() {
        const { cx, cy, w, h } = this._lcd;
        const hw = w/2, hh = h/2;

        this._staticGroup.add(new Konva.Rect({
            x: cx - hw - 4, y: cy - hh - 4,
            width: w + 8, height: h + 8,
            fill: '#1a1e22', stroke: '#101214', strokeWidth: 2,
            cornerRadius: 4,
        }));

        this._staticGroup.add(new Konva.Rect({
            x: cx - hw, y: cy - hh,
            width: w, height: h,
            fill: '#203020', stroke: '#304030', strokeWidth: 1,
            cornerRadius: 2,
        }));

        this._staticGroup.add(new Konva.Rect({
            x: cx - hw + 3, y: cy - hh + 3,
            width: w - 6, height: h - 6,
            fillRadialGradientStartPoint: { x: 0, y: 0 },
            fillRadialGradientEndPoint:   { x: 0, y: 0 },
            fillRadialGradientStartRadius: 0,
            fillRadialGradientEndRadius: Math.max(w, h) * 0.6,
            fillRadialGradientColorStops: [0, 'rgba(60,160,60,0.08)', 1, 'rgba(0,50,0,0)'],
            listening: false,
        }));

        const uFs = Math.max(10, h * 0.15);
        this._staticGroup.add(new Konva.Text({
            x: cx + hw - 52, y: cy - hh - 2,
            text: 'A',
            fontSize: uFs, fontFamily: 'Arial', fontStyle: 'bold',
            fill: '#80c080', width: 48, align: 'right',
        }));

        this._staticGroup.add(new Konva.Text({
            x: cx - hw + 4, y: cy - hh + 2,
            text: 'AC/DC',
            fontSize: Math.max(16, uFs * 0.5), fontFamily: 'Arial',
            fill: '#609060',
        }));

        this._rangeLabel = new Konva.Text({
            x: cx  -18, y: cy + hh - 16,
            text: `~${this._range}A`,
            fontSize: Math.max(9, h * 0.13), fontFamily: 'Arial',
            fill: '#609060',
        });
        this._staticGroup.add(this._rangeLabel);
    }

    _drawTriggerStatic() {
        const { x, y, w, h, rx } = this._trigger;

        this._staticGroup.add(new Konva.Rect({
            x: x - 3, y: y - 3, width: w + 6, height: h + 6,
            fill: '#0e1014', stroke: '#06080a', strokeWidth: 1.5,
            cornerRadius: rx + 3,
        }));
        this._staticGroup.add(new Konva.Rect({
            x: x - 1, y: y - 1, width: w + 2, height: h + 2,
            fill: '#161a20', cornerRadius: rx + 1,
        }));

        const fs = Math.max(12, w * 0.16);
        this._staticGroup.add(new Konva.Text({
            x: x, y: y + h + 6,
            text: '扳机', fontSize: fs, fontFamily: 'Arial',
            fill: '#f80404', width: w, align: 'center',
        }));
    }

    _drawKnobStatic() {
        const { cx, cy, r } = this._knob;

        this._staticGroup.add(new Konva.Circle({
            x: cx, y: cy, radius: r + 5,
            fill: '#1a1e22', stroke: '#101214', strokeWidth: 2,
        }));

        const ranges = [5, 50, 100, 250];
        const knobAngles = [-90, 0, 90, 180];
        const labelFs = Math.max(8, r * 0.32);
        ranges.forEach((rng, i) => {
            const ang = (knobAngles[i] - 90) * Math.PI / 180;
            const dx  = (r + 5) * Math.cos(ang);
            const dy  = (r + 5) * Math.sin(ang);
            this._staticGroup.add(new Konva.Circle({
                x: cx + dx * 0.80, y: cy + dy * 0.80, radius: 2,
                fill: '#b0b8a0',
            }));
            this._staticGroup.add(new Konva.Text({
                x: cx + dx * 1.30 - labelFs,
                y: cy + dy * 1.30 - labelFs * 0.5,
                text: String(rng),
                fontSize: labelFs, fontFamily: 'Arial',
                fill: '#c0c8b0', width: labelFs * 2, align: 'center',
            }));
        });
    }

    _drawFuncButtons() {
        const { cx: fc, cy: fcy, r: fr } = this._btnFunc;
        const { cx: hc, cy: hcy } = this._btnMode;

        this._staticGroup.add(new Konva.Circle({
            x: fc, y: fcy, radius: fr + 2,
            fill: '#1a1e22', stroke: '#101214', strokeWidth: 1,
        }));
        this._staticGroup.add(new Konva.Circle({
            x: fc, y: fcy, radius: fr,
            fill: '#40464e', stroke: '#30363e', strokeWidth: 0.8,
        }));

        this._staticGroup.add(new Konva.Circle({
            x: hc, y: hcy, radius: fr + 2,
            fill: '#1a1e22', stroke: '#101214', strokeWidth: 1,
        }));
        this._staticGroup.add(new Konva.Circle({
            x: hc, y: hcy, radius: fr,
            fill: '#40464e', stroke: '#30363e', strokeWidth: 0.8,
        }));
    }

    _drawJackStatic() {
        const tR = Math.max(5, this._divX * 0.028);
        const jackDefs = [
            { pos: this._jackCOM, label: 'COM', color: '#d03020' },
            { pos: this._jackVA,  label: 'V/A', color: '#f0c030' },
        ];
        jackDefs.forEach(jd => {
            this._staticGroup.add(new Konva.Circle({
                x: jd.pos.x, y: jd.pos.y, radius: tR + 2,
                fill: '#1a1e22', stroke: '#101214', strokeWidth: 1,
            }));
            this._staticGroup.add(new Konva.Circle({
                x: jd.pos.x, y: jd.pos.y, radius: tR,
                fill: '#c8b040', stroke: '#906820', strokeWidth: 1,
            }));
            this._staticGroup.add(new Konva.Circle({
                x: jd.pos.x, y: jd.pos.y, radius: tR * 0.40,
                fill: '#101214',
            }));
            this._staticGroup.add(new Konva.Line({
                points: [jd.pos.x, jd.pos.y + tR, jd.pos.x, this.height - 2],
                stroke: '#506070', strokeWidth: 1.5,
            }));
        });
    }

    _drawDivider() {
        const f = this._frame;
        this._staticGroup.add(new Konva.Line({
            points: [this._divX, f.y + 8, this._divX, f.y + f.h - 8],
            stroke: '#506050', strokeWidth: 1, dash: [5, 4],
        }));
    }

    _drawPrincipleStatic() {
        const W = this.width, H = this.height;
        const f = this._frame;
        const { cx, cy, outerR, innerR } = this._core;

        this._staticGroup.add(new Konva.Rect({
            x: this._divX + 1, y: f.y + 2,
            width: W - this._divX - f.x - 2, height: f.h - 4,
            fill: '#f5f2e8',
            cornerRadius: [0, f.rx - 1, f.rx - 1, 0],
            stroke: '#d0c8b0', strokeWidth: 1,
        }));

        this._drawHallCoreLower();
        this._drawHallElement();
        this._drawMeasuredWire();

        this._drawAmplifier();
        this._drawConditioner();
        this._drawADC();
        this._drawMCU();
    }

    _drawHallCoreLower() {
        const { cx, cy, outerR, innerR } = this._core;

        this._staticGroup.add(new Konva.Arc({
            x: cx, y: cy,
            innerRadius: innerR, outerRadius: outerR,
            angle: 180, rotation: 0,
            fillLinearGradientStartPoint: { x: -outerR, y: 0 },
            fillLinearGradientEndPoint:   { x:  outerR, y: 0 },
            fillLinearGradientColorStops: [
                0, '#b0a8a0', 0.3, '#c8c0b8', 0.7, '#c8c0b8', 1, '#b0a8a0',
            ],
            stroke: '#908880', strokeWidth: 1.5,
        }));

        this._staticGroup.add(new Konva.Text({
            x: cx - outerR, y: cy - outerR - 13,
            text: '聚磁铁芯',
            fontSize: Math.max(12, outerR * 0.16), fontFamily: 'Arial',
            fill: '#706050', width: outerR * 2, align: 'center',
        }));
    }

    _drawHallElement() {
        const { cx, cy, outerR } = this._core;
        const gx = cx - outerR * 0.15;
        const gy = cy + outerR * 0.60;
        const gw = outerR * 0.30;
        const gh = outerR * 0.27;

        this._staticGroup.add(new Konva.Rect({
            x: gx, y: gy, width: gw, height: gh,
            fill: '#e0d0a0', stroke: '#b0a060', strokeWidth: 1.2,
            cornerRadius: 2,
        }));

        this._staticGroup.add(new Konva.Text({
            x: gx - 20, y: gy + gh + 10,
            text: '霍尔元件',
            fontSize: Math.max(12, gh * 0.45), fontFamily: 'Arial',
            fill: '#605030', width: gw + 40, align: 'center',
        }));

        const halfCx = cx + outerR * 0.80;
        const hallRight = gx + gw;
        this._staticGroup.add(new Konva.Line({
            points: [hallRight, gy + gh/2, halfCx, gy + gh/2, halfCx, this._amplifier.cy - this._amplifier.h/2],
            stroke: '#c05030', strokeWidth: 1.5, dash: [4, 3],
        }));
        this._staticGroup.add(new Konva.Line({
            points: [gx, gy + gh/2, cx - outerR * 0.80, gy + gh/2, cx - outerR * 0.80, this._amplifier.cy - this._amplifier.h/2],
            stroke: '#c05030', strokeWidth: 1.5, dash: [4, 3],
        }));
    }

    _drawMeasuredWire() {
        const { x0, x1, y: wireY } = this._wireLine;
        this._staticGroup.add(new Konva.Line({
            points: [x0, wireY, x1, wireY],
            stroke: '#e05030', strokeWidth: 3.5, lineCap: 'round',
        }));
        this._staticGroup.add(new Konva.Line({
            points: [x0, wireY, x1, wireY],
            stroke: '#c03818', strokeWidth: 2, lineCap: 'round', dash: [8, 4],
        }));
    }

    _drawAmplifier() {
        const { cx, cy, w, h } = this._amplifier;
        const hw = w/2, hh = h/2;

        this._staticGroup.add(new Konva.Rect({
            x: cx - hw, y: cy - hh, width: w, height: h,
            fill: 'rgba(240,235,220,0.50)', stroke: '#b0a890', strokeWidth: 0.8,
            cornerRadius: 4,
        }));

        const opR = Math.min(h * 0.30, w * 0.15);
        this._staticGroup.add(new Konva.Line({
            points: [cx - opR, cy - opR*0.7, cx - opR, cy + opR*0.7, cx + opR*0.8, cy],
            closed: true,
            fill: '#d0d8e0', stroke: '#808890', strokeWidth: 0.8,
        }));

        this._staticGroup.add(new Konva.Text({
            x: cx - opR - 18, y: cy - opR*0.8,
            text: '+', fontSize: Math.max(8, opR*0.5), fontFamily: 'Arial', fill: '#c03020',
        }));
        this._staticGroup.add(new Konva.Text({
            x: cx - opR - 18, y: cy + opR*0.2,
            text: '−', fontSize: Math.max(8, opR*0.5), fontFamily: 'Arial', fill: '#2080c0',
        }));

        const rBot = this._core.cy + this._core.outerR;
        this._staticGroup.add(new Konva.Line({
            points: [cx, rBot + 2, cx, cy - hh + 2],
            stroke: '#2080c0', strokeWidth: 1.2, dash: [3, 3],
        }));

        this._staticGroup.add(new Konva.Text({
            x: cx - 2*hw + 10, y: cy - hh * 0.4,
            text: '差分\n放大', fontSize: Math.max(12, h*0.14),
            fontFamily: 'Arial', fill: '#705030', lineHeight: 1.2,
        }));

        const condBot = cy + hh;
        this._staticGroup.add(new Konva.Line({
            points: [cx, condBot + 2, cx, condBot + 4 + (this._conditioner.cy - this._conditioner.h/2 - condBot - 6)/2],
            stroke: '#2080c0', strokeWidth: 1.2, dash: [3, 3],
        }));
    }

    _drawConditioner() {
        const { cx, cy, w, h } = this._conditioner;
        const hw = w/2, hh = h/2;

        this._staticGroup.add(new Konva.Rect({
            x: cx - hw, y: cy - hh, width: w, height: h,
            fill: 'rgba(240,235,220,0.50)', stroke: '#b0a890', strokeWidth: 0.8,
            cornerRadius: 4,
        }));

        const opR = Math.min(h * 0.30, w * 0.15);
        this._staticGroup.add(new Konva.Line({
            points: [cx - opR, cy - opR*0.7, cx - opR, cy + opR*0.7, cx + opR*0.8, cy],
            closed: true,
            fill: '#d0d8e0', stroke: '#808890', strokeWidth: 0.8,
        }));
        this._staticGroup.add(new Konva.Text({
            x: cx - opR - 18, y: cy - opR*0.8,
            text: '+', fontSize: Math.max(8, opR*0.5), fontFamily: 'Arial', fill: '#c03020',
        }));
        this._staticGroup.add(new Konva.Text({
            x: cx - opR - 18, y: cy + opR*0.2,
            text: '−', fontSize: Math.max(8, opR*0.5), fontFamily: 'Arial', fill: '#2080c0',
        }));

        const rBot = this._amplifier.cy + this._amplifier.h/2;
        this._staticGroup.add(new Konva.Line({
            points: [cx, rBot + 2, cx, cy - hh + 2],
            stroke: '#2080c0', strokeWidth: 1.2, dash: [3, 3],
        }));

        this._staticGroup.add(new Konva.Text({
            x: cx - 2*hw +2, y: cy - hh * 0.4,
            text: '滤波\n放大', fontSize: Math.max(12, h*0.14),
            fontFamily: 'Arial', fill: '#705030', lineHeight: 1.2,
        }));

        const condBot = cy + hh;
        this._staticGroup.add(new Konva.Line({
            points: [cx, condBot + 2, cx, condBot + 4 + (this._adc.cy - this._adc.h/2 - condBot - 6)/2],
            stroke: '#2080c0', strokeWidth: 1.2, dash: [3, 3],
        }));
    }

    _drawADC() {
        const { cx, cy, w, h } = this._adc;
        const hw = w/2, hh = h/2;

        this._staticGroup.add(new Konva.Rect({
            x: cx - hw, y: cy - hh, width: w, height: h,
            fill: 'rgba(220,235,240,0.50)', stroke: '#6090a0', strokeWidth: 0.8,
            cornerRadius: 4,
        }));

        const fs = Math.max(10, h * 0.16);
        this._staticGroup.add(new Konva.Text({
            x: cx - hw + 14, y: cy - hh + 16,
            text: 'ADC\n模数转换', fontSize: fs, fontFamily: 'Arial',
            fill: '#206080', lineHeight: 1.2,
        }));

        const condBot = this._conditioner.cy + this._conditioner.h/2;
        this._staticGroup.add(new Konva.Line({
            points: [cx, condBot + 6, cx, cy - hh + 2],
            stroke: '#2080c0', strokeWidth: 1.2, dash: [3, 3],
        }));

        const adcBot = cy + hh;
        const mcuTop = this._mcu.cy - this._mcu.h/2;
        this._staticGroup.add(new Konva.Line({
            points: [cx + hw*0.4, adcBot + 2, cx + hw*0.4, mcuTop],
            stroke: '#2080c0', strokeWidth: 1.5,
            pointerLength: 6, pointerWidth: 4,
        }));

        this._staticGroup.add(new Konva.Line({
            points: [cx + hw*0.4, mcuTop - 6, cx + hw*0.4, mcuTop],
            stroke: '#2080c0', strokeWidth: 3,
        }));
        for (let bi = 0; bi < 4; bi++) {
            const by = mcuTop - 6 - bi * 3;
            this._staticGroup.add(new Konva.Line({
                points: [cx + hw*0.4 - 3, by, cx + hw*0.4 + 3, by],
                stroke: '#2080c0', strokeWidth: 0.6,
            }));
        }
    }

    _drawMCU() {
        const { cx, cy, w, h } = this._mcu;
        const hw = w/2, hh = h/2;

        this._staticGroup.add(new Konva.Rect({
            x: cx - hw, y: cy - hh, width: w, height: h,
            fill: 'rgba(230,220,240,0.50)', stroke: '#8070a0', strokeWidth: 0.8,
            cornerRadius: 4,
        }));

        const fs = Math.max(10, h * 0.16);
        this._staticGroup.add(new Konva.Text({
            x: cx - hw + 14, y: cy - hh + 16,
            text: 'MCU\n真有效值\nLCD 驱动', fontSize: fs, fontFamily: 'Arial',
            fill: '#503080', lineHeight: 1.2,
        }));
    }

    _createDynamicNodes() {
        this._createJawDynamic();
        this._createLCDDynamic();
        this._createTriggerButton();
        this._createKnobDynamic();
        this._createFluxArrows();
        this._createCoreUpperDynamic();
        this._createFuncButtonDynamic();
    }

    _createJawDynamic() {
        const { cx, topY, outerR, innerR, h } = this._jaw;
        const midY = topY + h * 0.50;

        this._jawGroup = new Konva.Group({ x: cx, y: midY, rotation: 0 });

        this._jawGroup.add(new Konva.Arc({
            x: 0, y: 0,
            innerRadius: innerR, outerRadius: outerR,
            angle: 180, rotation: -180,
            fillLinearGradientStartPoint: { x: -outerR, y: 0 },
            fillLinearGradientEndPoint:   { x:  outerR, y: 0 },
            fillLinearGradientColorStops: [
                0, '#e8a820', 0.2, '#f0c040',
                0.5, '#f8d860', 0.8, '#f0c040', 1, '#e8a820',
            ],
            stroke: '#c88810', strokeWidth: 2,
            listening: false,
        }));

        for (let i = 1; i < 8; i++) {
            const ang = Math.PI + (i / 8) * Math.PI;
            this._jawGroup.add(new Konva.Line({
                points: [
                    innerR * Math.cos(ang), innerR * Math.sin(ang),
                    outerR * Math.cos(ang), outerR * Math.sin(ang),
                ],
                stroke: '#c88810', strokeWidth: 0.6, listening: false,
            }));
        }

        const midR = (outerR + innerR) / 2;
        for (let i = 0; i < 10; i++) {
            const ang0 = Math.PI + Math.PI * (i / 10);
            const ang1 = Math.PI + Math.PI * ((i + 0.6) / 10);
            this._jawGroup.add(new Konva.Line({
                points: [
                    midR * Math.cos(ang0), midR * Math.sin(ang0),
                    (midR + 3) * Math.cos(ang1), (midR + 3) * Math.sin(ang1),
                ],
                stroke: '#c07020', strokeWidth: 1.8, lineCap: 'round', listening: false,
            }));
        }

        this._dynamicGroup.add(this._jawGroup);
    }

    _createCoreUpperDynamic() {
        const { cx, cy, outerR, innerR } = this._core;

        this._coreUpperGroup = new Konva.Group({ x: cx, y: cy, rotation: 0 });

        this._coreUpperGroup.add(new Konva.Arc({
            x: 0, y: 0,
            innerRadius: innerR, outerRadius: outerR,
            angle: 180, rotation: -180,
            fillLinearGradientStartPoint: { x: -outerR, y: 0 },
            fillLinearGradientEndPoint:   { x:  outerR, y: 0 },
            fillLinearGradientColorStops: [
                0, '#b0a8a0', 0.3, '#c8c0b8', 0.7, '#c8c0b8', 1, '#b0a8a0',
            ],
            stroke: '#908880', strokeWidth: 1.5, listening: false,
        }));

        this._dynamicGroup.add(this._coreUpperGroup);
    }

    _createLCDDynamic() {
        const { cx, cy, w, h } = this._lcd;
        const hw = w/2, hh = h/2;
        const fs = Math.max(24, h * 0.24);

        this._lcdText = new Konva.Text({
            x: cx - hw,
            y: cy - hh-12,
            text: '0.00',
            fontSize: fs, fontFamily: 'Courier New', fontStyle: 'bold',
            fill: '#40c040',
            width: w - 24, height: h - 20,
            align: 'right', verticalAlign: 'middle',
        });
        this._dynamicGroup.add(this._lcdText);

        const sFs = Math.max(9, h * 0.14);
        this._lcdUnit = new Konva.Text({
            x: cx - hw + 12,
            y: cy  + sFs - 16,
            text: 'A',
            fontSize: sFs, fontFamily: 'Arial', fontStyle: 'bold',
            fill: '#40c040',
            width: w - 24, align: 'right',
        });
        this._dynamicGroup.add(this._lcdUnit);

        this._lcdSub = new Konva.Text({
            x: cx - hw + 12,
            y: cy + sFs - 16,
            text: 'DC',
            fontSize: sFs, fontFamily: 'Arial', fontStyle: 'bold',
            fill: '#30a030',
        });
        this._dynamicGroup.add(this._lcdSub);

        this._holdIndicator = new Konva.Text({
            x: cx - hw + 12,
            y: cy + 34,
            text: '',
            fontSize: Math.max(10, h * 0.08), fontFamily: 'Arial', fontStyle: 'bold',
            fill: '#f0a020',
        });
        this._dynamicGroup.add(this._holdIndicator);
    }

    _createTriggerButton() {
        const { x, y, w, h, rx } = this._trigger;

        this._triggerGroup = new Konva.Group({ x, y });

        this._triggerBody = new Konva.Rect({
            x: 0, y: 0, width: w, height: h,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint:   { x: 0, y: h },
            fillLinearGradientColorStops: [0, '#5a6470', 0.5, '#3e4854', 1, '#28303a'],
            stroke: '#1a1e22', strokeWidth: 1, cornerRadius: rx,
        });
        this._triggerGroup.add(this._triggerBody);

        this._triggerGroup.add(new Konva.Line({
            points: [rx + 2, 1.5, w - rx - 2, 1.5],
            stroke: '#8090a0', strokeWidth: 0.8, lineCap: 'round',
        }));

        const groovePositions = [0.28, 0.45, 0.62];
        const grooveW = w * 0.55;
        const grooveStart = (w - grooveW) / 2;
        groovePositions.forEach(ratio => {
            const gy = h * ratio;
            this._triggerGroup.add(new Konva.Line({
                points: [grooveStart, gy, grooveStart + grooveW, gy],
                stroke: '#1a1e22', strokeWidth: 1.8, lineCap: 'round',
            }));
            this._triggerGroup.add(new Konva.Line({
                points: [grooveStart, gy + 1.2, grooveStart + grooveW, gy + 1.2],
                stroke: '#6a7480', strokeWidth: 0.6, lineCap: 'round',
            }));
        });

        this._triggerGroup.add(new Konva.Line({
            points: [rx + 2, h - 1.5, w - rx - 2, h - 1.5],
            stroke: '#1a1e22', strokeWidth: 1.2, lineCap: 'round',
        }));

        this._dynamicGroup.add(this._triggerGroup);
    }

    _createKnobDynamic() {
        const { cx, cy, r } = this._knob;

        this._knobGroup = new Konva.Group({ x: cx, y: cy, rotation: this._knobAngle });

        this._knobGroup.add(new Konva.Circle({
            x: 0, y: 0, radius: r,
            fillRadialGradientStartPoint:  { x: -r * 0.3, y: -r * 0.3 },
            fillRadialGradientEndPoint:    { x: 0, y: 0 },
            fillRadialGradientStartRadius: 0,
            fillRadialGradientEndRadius:   r,
            fillRadialGradientColorStops:  [0, '#707870', 0.6, '#484e50', 1, '#30383a'],
            stroke: '#202828', strokeWidth: 1.5,
        }));

        this._knobGroup.add(new Konva.Line({
            points: [0, -r * 0.25, 0, -r * 0.80],
            stroke: '#e0f0d0', strokeWidth: 2.5, lineCap: 'round',
        }));
        this._knobGroup.add(new Konva.Circle({
            x: 0, y: 0, radius: r * 0.16,
            fill: '#303838', stroke: '#404c4e', strokeWidth: 1,
        }));

        this._dynamicGroup.add(this._knobGroup);
    }

    _createFluxArrows() {
        this._fluxGroup = new Konva.Group({ listening: false });
        this._dynamicGroup.add(this._fluxGroup);
    }

    _createFuncButtonDynamic() {
        const { cx: fc, cy: fcy, r: fr } = this._btnFunc;
        const { cx: hc, cy: hcy } = this._btnMode;

        this._holdButtonState = new Konva.Circle({
            x: fc, y: fcy, radius: fr,
            fill: '#40464e', stroke: '#30363e', strokeWidth: 0.8,
        });
        this._dynamicGroup.add(this._holdButtonState);

        this._modeButtonState = new Konva.Circle({
            x: hc, y: hcy, radius: fr,
            fill: '#40464e', stroke: '#30363e', strokeWidth: 0.8,
        });
        this._dynamicGroup.add(this._modeButtonState);
    }

    _bindInteraction() {
        const { x, y, w, h } = this._trigger;

        const trigHit = new Konva.Rect({
            x: x - 4, y: y - 4, width: w + 8, height: h + 8,
            fill: 'transparent',
        });
        trigHit.on('click tap', () => {
            const wasOpen = this._jawOpen;
            this._jawOpen = !this._jawOpen;
            if (wasOpen && !this._jawOpen) {
                this._measuring = !this._measuring;
                if (!this._measuring) this._targetI = 0;
            }
        });
        trigHit.on('mouseenter', () => { document.body.style.cursor = 'pointer'; });
        trigHit.on('mouseleave', () => { document.body.style.cursor = 'default'; });
        this._interactGroup.add(trigHit);

        const { cx: kx, cy: ky, r: kr } = this._knob;
        const knobHit = new Konva.Circle({
            x: kx, y: ky, radius: kr + 8, fill: 'transparent',
        });
        const ranges = [5, 50, 100, 250];

        knobHit.on('click tap', (e) => {
            const idx = ranges.indexOf(this._range);
            const stage = knobHit.getStage();
            const pos = stage ? stage.getPointerPosition() : null;
            if (pos && pos.y < ky) {
                this._range = ranges[(idx - 1 + ranges.length) % ranges.length];
            } else {
                this._range = ranges[(idx + 1) % ranges.length];
            }
            this._knobAngle = this._rangeToKnobAngle(this._range);
            this._rangeLabel.text(`~${this._range}A`);
        });
        knobHit.on('mouseenter', () => { document.body.style.cursor = 'pointer'; });
        knobHit.on('mouseleave', () => { document.body.style.cursor = 'default'; });
        this._interactGroup.add(knobHit);

        const holdHit = new Konva.Circle({
            x: this._btnFunc.cx, y: this._btnFunc.cy,
            radius: this._btnFunc.r + 6, fill: 'transparent',
        });
        holdHit.on('click tap', () => {
            this._holdMode = !this._holdMode;
        });
        holdHit.on('mouseenter', () => { document.body.style.cursor = 'pointer'; });
        holdHit.on('mouseleave', () => { document.body.style.cursor = 'default'; });
        this._interactGroup.add(holdHit);

        const modeHit = new Konva.Circle({
            x: this._btnMode.cx, y: this._btnMode.cy,
            radius: this._btnFunc.r + 6, fill: 'transparent',
        });
        modeHit.on('click tap', () => {
            this._isDC = !this._isDC;
        });
        modeHit.on('mouseenter', () => { document.body.style.cursor = 'pointer'; });
        modeHit.on('mouseleave', () => { document.body.style.cursor = 'default'; });
        this._interactGroup.add(modeHit);
    }

    _updateDynamic() {
        const i = this._oilFault ? this._currentI * 0.55 : this._currentI;

        const jawTarget = this._jawOpen ? 1 : 0;
        this._jawAngle += (jawTarget - this._jawAngle) * 0.15;
        const jawOpenDeg = this._jawAngle * 42;
        this._jawGroup.rotation(-jawOpenDeg);
        this._coreUpperGroup.rotation(-jawOpenDeg);

        const { y: ty, h: th } = this._trigger;
        this._triggerGroup.y(this._jawOpen ? ty + th * 0.08 : ty);
        this._triggerBody.fillLinearGradientColorStops(
            this._jawOpen
                ? [0, '#4a7a6a', 0.5, '#306050', 1, '#1e3830']
                : [0, '#5a6470', 0.5, '#3e4854', 1, '#28303a']
        );

        this._knobGroup.rotation(this._knobAngle);

        this._updateFluxArrows(i);

        const displayVal = this._holdMode ? (this._holdValue !== undefined ? this._holdValue : i) : i;
        const decimals = this._range < 10 ? 3 : (this._range < 100 ? 2 : 1);
        this._lcdText.text(displayVal.toFixed(decimals));
        this._lcdUnit.text('A');

        this._lcdSub.text(this._isDC ? 'DC' : 'AC');
        this._holdIndicator.text(this._holdMode ? 'HOLD' : '');
        this._holdButtonState.fill(this._holdMode ? '#d08020' : '#40464e');
        this._modeButtonState.fill(this._isDC ? '#2080c0' : '#c08020');
    }

    _updateFluxArrows(current) {
        this._fluxGroup.destroyChildren();
        if (current < 0.05 || this._jawAngle > 0.3) return;

        const { cx, cy, innerR } = this._core;
        const alpha = Math.min(0.95, current / this._range * 0.85 + 0.15);

        const arrowCount = 4;
        for (let k = 0; k < arrowCount; k++) {
            const angStart = (k / arrowCount) * 2 * Math.PI + this._fluxPhase;
            const angEnd = angStart + (2 * Math.PI / arrowCount) * 0.65;
            const steps = 12;
            const pts = [];
            const r = innerR * 0.76;
            for (let s = 0; s <= steps; s++) {
                const a = angStart + (angEnd - angStart) * s / steps;
                pts.push(cx + r * Math.cos(a), cy + r * Math.sin(a));
            }
            this._fluxGroup.add(new Konva.Line({
                points: pts,
                stroke: `rgba(50,180,120,${alpha * 0.99})`,
                strokeWidth: 3.4,
                lineCap: 'round', lineJoin: 'round', listening: false,
            }));
            const ax = cx + r * Math.cos(angEnd);
            const ay = cy + r * Math.sin(angEnd);
            const tDx = -Math.sin(angEnd) * 5;
            const tDy =  Math.cos(angEnd) * 5;
            this._fluxGroup.add(new Konva.Line({
                points: [ax - tDx * 0.5 + tDy * 0.3, ay - tDy * 0.5 - tDx * 0.3,
                         ax, ay,
                         ax - tDx * 0.5 - tDy * 0.3, ay - tDy * 0.5 + tDx * 0.3],
                stroke: `rgba(50,180,120,${alpha * 0.9})`,
                strokeWidth: 2.3, lineCap: 'round', listening: false,
            }));
        }
    }

    tick(dt) {
        const tau = Math.max(0.05, this._rampTime);
        const alpha = 1 - Math.exp(-dt / tau);
        this._currentI += (this._targetI - this._currentI) * alpha;

        if (this._currentI > 0.05) {
            this._fluxPhase = (this._fluxPhase + dt * 3.14 * 2) % (Math.PI * 2);
        }

        if (this._holdMode && this._currentI > 0.01) {
            this._holdValue = this._currentI;
        }

        this._updateDynamic();
        this.markDirty();
        this._refreshIfDirty();
    }

    setCurrent(i) {
        if (!this._measuring) { this._targetI = 0; return; }
        this._targetI = Math.max(0, Math.min(this._range * 1.2, parseFloat(i) || 0));
    }
    setJawOpen(open) { this._jawOpen = !!open; }
    setRange(r) {
        const valid = [5, 50, 100, 250];
        if (valid.includes(parseFloat(r))) {
            this._range = parseFloat(r);
            this._knobAngle = this._rangeToKnobAngle(this._range);
            if (this._rangeLabel) this._rangeLabel.text(`~${this._range}A`);
        }
    }
    getCurrent() { return this._currentI; }
    setMode(isDC) { this._isDC = !!isDC; }
    getMode() { return this._isDC; }

    update(state) {
        if (typeof state === 'object' && state !== null) {
            if (state.current !== undefined) this.setCurrent(state.current);
            if (state.jawOpen !== undefined) this.setJawOpen(state.jawOpen);
            if (state.range   !== undefined) this.setRange(state.range);
            if (state.isDC    !== undefined) this.setMode(state.isDC);
        } else {
            this.setCurrent(state);
        }
    }

    getConfigFields() {
        return [
            { label: '被测电流 A',                       key: 'current',  type: 'number' },
            { label: '量程 A（5/50/100/250）', key: 'range',    type: 'number' },
            { label: '钳口张开（true/false）',            key: 'jawOpen',  type: 'text'   },
            { label: '响应时间常数 s',                    key: 'rampTime', type: 'number' },
            { label: 'DC 模式（true=DC/false=AC）',      key: 'isDC',     type: 'text'   },
        ];
    }

    destroy() {
        super.destroy?.();
    }
}
