import { BaseComponent } from './BaseComponent.js';

/**
 * 钳形电流表（Clamp-on Ammeter / Clamp Meter）仿真组件
 *
 * ═══ 工作原理 ════════════════════════════════════════════════════════
 *  钳形电流表利用电流互感器（CT）原理，无需断开被测电路即可测量电流。
 *  被测导线作为一次绕组（N1=1），铁心上绕有二次绕组（N2=数百匝）。
 *  根据互感原理：I1·N1 = I2·N2，I2 流入表头线圈驱动指针偏转。
 *
 * ═══ 外观布局（参照 TCM 716Q 实物） ════════════════════════════════
 *  左侧（外观/操作）：
 *  ┌──────────────────────────────┐
 *  │   ╭──────╮                   │  ← 黄色钳口（顶部）
 *  │   │      │                   │
 *  │   ╰──────╯                   │
 *  │  [扳机]                      │
 *  ├──────────────────────────────┤
 *  │     ○━━━━━━━━━━━━○          │  ← 量程转换旋钮（中部）
 *  │     ┃  量程选择  ┃          │
 *  │     ○━━━━━━━━━━━━○          │
 *  ├──────────────────────────────┤
 *  │  ┌────────────────────┐      │  ← 指针表盘（底部）
 *  │  │  0       50A       │      │
 *  │  │       ↑            │      │
 *  │  └────────────────────┘      │
 *  │  [V/Ω]  [COM]               │  ← 表笔接口
 *  └──────────────────────────────┘
 *
 *  右侧（原理结构，浅色风格）：
 *  ┌──────────────────────────────┐
 *  │  铁心 / 二次绕组 / 被测导线  │
 *  │  磁通量 Φ → 感应电流 I2     │
 *  │  等效电路                   │
 *  │  表头线圈偏转示意           │
 *  └──────────────────────────────┘
 *
 * ═══ 端口 ════════════════════════════════════════════════════════════
 *  com  — 公共端（表笔）
 *  va   — 电压/电阻测量端（表笔）
 *
 * ═══ 可配置参数 ══════════════════════════════════════════════════════
 *  current   : 被测电流 A（默认 0）
 *  range     : 量程 A（默认 50，可选 5/50/100/250）
 *  jawOpen   : 钳口是否张开（默认 false）
 *  rampTime  : 指针响应时间常数 s（默认 0.4）
 */
export class ClampMeter extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.width  = Math.max(300, config.width  || 380);
        this.height = Math.max(360, config.height || 480);

        this.type    = 'clamp';
        this.cache   = 'fixed';
        

        this._initGroups();
        this._recalcGeometry();
        this._initParameters(config);
        this._init();

        this.config = {
            current:  this._targetI,
            range:    this._range,
            jawOpen:  this._jawOpen,
            rampTime: this._rampTime,
        };

        this.addPort(this._portCom.x, this._portCom.y-3, 'com', 'wire', 'n');
        this.addPort(this._portVA.x,  this._portVA.y-3,  'v',  'wire', 'p');
    }

    // ═══════════════════════════════════════════════════════
    // 几何尺寸
    // ═══════════════════════════════════════════════════════

    _recalcGeometry() {
        const W = this.width, H = this.height;
        this._divX = W * 0.50;
        this._frame = { x: 2, y: 2, w: W - 4, h: H - 4, rx: 10 };

        const lW = this._divX;
        const bodyCx = lW * 0.50;

        // ── 左侧：上=钳口 中=旋钮 下=表盘 ──
        // 钳口（顶部 35%）
        const jawH    = H * 0.30;
        const jawW    = lW * 0.65;
        const jawTopY = -H * 0.01;
        this._jaw = {
            cx: bodyCx, topY: jawTopY, w: jawW, h: jawH,
            outerR: jawW * 0.48, innerR: jawW * 0.25,
        };

        // 量程旋钮（中部 30%）
        const knobCy = H * 0.48;
        this._knob = { cx: bodyCx, cy: knobCy, r: Math.min(lW * 0.24, H * 0.09) };

        // 指针表盘（底部 35%）
        const faceR = Math.min(lW * 0.40, H * 0.16);
        this._face = { cx: bodyCx, cy: H * 0.80, r: faceR };

        // 机械调零螺丝（位于表盘左下方的表壳上）
        this._mechZero = {
            x: bodyCx - faceR * 0.55,
            y: H * 0.80 + faceR * 0.30,
            r: Math.max(5, lW * 0.028),
        };

        // 指针扫描角度
        this._angleStart = 210;
        this._angleSweep = 120;

        // 扳机（钳口左侧）
        this._trigger = {
            x: bodyCx - jawW * 0.72,
            y: jawTopY + jawH * 0.55,
            w: lW * 0.14, h: H * 0.08,
            rx: 5,
        };

        // 表笔插孔（底部）
        const jackY = H * 0.99;
        this._jackCOM = { x: bodyCx - lW * 0.14, y: jackY };
        this._jackVA  = { x: bodyCx + lW * 0.14, y: jackY };
        this._portCom = { x: this._jackCOM.x, y: H - 2 };
        this._portVA  = { x: this._jackVA.x,  y: H - 2 };

        // ── 右侧：原理结构 ──
        const rLeft = this._divX + W * 0.025;
        const rW    = W - rLeft - W * 0.020;
        const rCx   = rLeft + rW * 0.50;
        const coreR = Math.min(rW * 0.35, H * 0.22);
        this._core = { cx: rCx, cy: H * 0.17, outerR: coreR, innerR: coreR * 0.46 };
        this._wireLine = { x0: rLeft, x1: rLeft + rW, y: this._core.cy };
        const coreBottom = H * 0.17 + coreR;
        const useableH = (H - 14) - coreBottom;
        const rectH = useableH * 0.28;
        const shuntH = useableH * 0.16;
        const gap = useableH * 0.05;
        const meterH = useableH * 0.36;
        let y = coreBottom + gap;
        this._rectifier = {
            cx: rCx, cy: y + rectH/2,
            w: rW * 0.55, h: rectH, d: rW * 0.28,
        };
        y += rectH + gap;
        this._shunt = {
            cx: rCx, cy: y + shuntH/2,
            w: rW * 0.46, h: shuntH,
        };
        y += shuntH + gap;
        this._meterHead = {
            cx: rCx, cy: y + meterH/2,
            w: Math.min(rW * 0.62, H * 0.30),
            h: meterH,
        };
    }

    // ═══════════════════════════════════════════════════════
    // 参数初始化
    // ═══════════════════════════════════════════════════════

    _initParameters(config) {
        this._range     = config.range    !== undefined ? parseFloat(config.range)   : 5;
        this._targetI   = config.current  !== undefined ? parseFloat(config.current) : 0;
        this._currentI  = this._targetI;
        this._rampTime  = config.rampTime !== undefined ? parseFloat(config.rampTime): 0.4;
        this._jawOpen   = !!config.jawOpen;
        this._jawAngle  = this._jawOpen ? 1 : 0;
        this._measuring = false;
        this._mechanicalOffset = config.mechanicalOffset ?? 0;
        this._oilFault = false;
        this._needleAngle = this._currentToAngle(this._currentI);
        this._rightPointerAngle = 0;
        this._fluxPhase = 0;
        this._knobAngle = this._rangeToKnobAngle(this._range);
    }

    _currentToAngle(i) {
        const frac = Math.max(0, Math.min(1, i / this._range));
        return this._angleStart + frac * this._angleSweep;
    }

    _rangeToKnobAngle(range) {
        const map = { 5: -90, 50: 0, 100: 90, 250: 180 };
        return map[range] !== undefined ? map[range] : 0;
    }

    // ═══════════════════════════════════════════════════════
    // 主初始化
    // ═══════════════════════════════════════════════════════

    _init() {
        this._drawStaticParts();
        this._createDynamicNodes();
        this._bindInteraction();
    }

    // ═══════════════════════════════════════════════════════
    // 静态部件
    // ═══════════════════════════════════════════════════════

    _drawStaticParts() {
        this._drawBodyShell();
        this._drawJawStatic();
        this._drawFaceStatic();
        this._drawMechZeroScrew();
        this._drawTriggerStatic();
        this._drawKnobStatic();
        this._drawJackStatic();
        this._drawDivider();
        this._drawPrincipleStatic();
    }

    // ─── 左侧外壳（深色） ─────────────────────────────

    _drawBodyShell() {
        const W = this.width, H = this.height;
        const f = this._frame;
        const lW = this._divX;

        // 左侧面板底色
        this._staticGroup.add(new Konva.Rect({
            x: f.x + 2, y: f.y + 2,
            width: lW - f.x - 3, height: f.h - 4,
            fill: '#dbe6f1',
            cornerRadius: [f.rx - 1, 0, 0, f.rx - 1],
        }));

        // 表体轮廓（钳口以下的手柄）
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
                0, '#3a3f45', 0.08, '#50565e',
                0.50, '#42484f', 0.92, '#50565e', 1, '#3a3f45',
            ],
            stroke: '#1e2226', strokeWidth: 1.5,
            cornerRadius: [4, 4, 8, 8],
        }));

        // 铭牌
        const badgeW = bodyW * 0.70, badgeH = bodyH * 0.06;
        const badgeX = this._jaw.cx - badgeW / 2;
        const badgeY = bodyTop + bodyH * 0.04;
        this._staticGroup.add(new Konva.Rect({
            x: badgeX, y: badgeY-10, width: badgeW, height: badgeH,
            fill: '#f0e8d0', stroke: '#c0b890', strokeWidth: 0.8, cornerRadius: 2,
        }));
        const bFs = Math.max(7, badgeW * 0.12);
        this._staticGroup.add(new Konva.Text({
            x: badgeX + 3, y: badgeY -8,
            text: '钳形电流表',
            fontSize: bFs, fontFamily: 'Arial', fontStyle: 'bold',
            fill: '#202020', width: badgeW - 6, align: 'center',
        }));
    }

    // ─── 黄色钳口（顶部） ─────────────────────────────

    _drawJawStatic() {
        const { cx, topY, outerR, innerR, h } = this._jaw;
        const midY = topY + h * 0.50;

        // 下半钳口（固定）
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

        // 铁心叠层线
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

        // 铰链
        [cx - outerR * 0.85, cx + outerR * 0.85].forEach(hx => {
            this._staticGroup.add(new Konva.Circle({
                x: hx, y: midY, radius: outerR * 0.10,
                fill: '#d0a030', stroke: '#a07820', strokeWidth: 1,
            }));
        });

        // 钳口内孔标注
        const iFs = Math.max(12, outerR * 0.18);
        this._staticGroup.add(new Konva.Text({
            x: cx - outerR * 0.6, y: midY + outerR * 0.15,
            text: '导线穿入', fontSize: iFs, fontFamily: 'Arial',
            fill: '#fa3c02', width: outerR * 1.2, align: 'center',
        }));
    }

    // ─── 指针表盘（底部） ─────────────────────────────

    _drawFaceStatic() {
        const { cx, cy, r } = this._face;

        // 表盘窗框
        this._staticGroup.add(new Konva.Circle({
            x: cx, y: cy, radius: r + 4,
            fill: '#1e2226', stroke: '#141618', strokeWidth: 2,
        }));

        // 表盘面（米白）
        this._staticGroup.add(new Konva.Circle({
            x: cx, y: cy, radius: r,
            fill: '#f2eedf', stroke: '#ccc8b0', strokeWidth: 1,
        }));

        // 暗晕
        this._staticGroup.add(new Konva.Circle({
            x: cx, y: cy, radius: r,
            fillRadialGradientStartPoint:  { x: 0, y: 0 },
            fillRadialGradientEndPoint:    { x: 0, y: 0 },
            fillRadialGradientStartRadius: r * 0.50,
            fillRadialGradientEndRadius:   r,
            fillRadialGradientColorStops:  [0, 'rgba(0,0,0,0)', 1, 'rgba(0,0,0,0.10)'],
            listening: false,
        }));

        // 刻度
        const majorCount = 5, minorPerMajor = 5;
        const totalMinor = majorCount * minorPerMajor;
        for (let i = 0; i <= totalMinor; i++) {
            const frac   = i / totalMinor;
            const angDeg = this._angleStart + frac * this._angleSweep;
            const angRad = angDeg * Math.PI / 180;
            const isMajor  = (i % minorPerMajor === 0);
            const isMedium = (i % minorPerMajor === Math.floor(minorPerMajor / 2));
            const oR = r * 0.94;
            const iR = isMajor ? r * 0.74 : (isMedium ? r * 0.82 : r * 0.87);
            const sw = isMajor ? 1.4 : 0.6;
            const col = isMajor ? '#1a1a1a' : '#666660';

            this._staticGroup.add(new Konva.Line({
                points: [
                    cx + oR * Math.cos(angRad), cy + oR * Math.sin(angRad),
                    cx + iR * Math.cos(angRad), cy + iR * Math.sin(angRad),
                ],
                stroke: col, strokeWidth: sw, lineCap: 'round', listening: false,
            }));

            if (isMajor) {
                const v = Math.round(frac * this._range);
                const labelR = r * 0.60;
                const fs = Math.max(12, r * 0.13);
                this._staticGroup.add(new Konva.Text({
                    x: cx + labelR * Math.cos(angRad) - fs,
                    y: cy + labelR * Math.sin(angRad) - fs * 0.5,
                    text: String(v),
                    fontSize: fs, fontFamily: 'Arial', fill: '#1a1a1a',
                    align: 'center', width: fs * 2,
                }));
            }
        }

        // 刻度弧
        this._drawArc(cx, cy, r * 0.94, this._angleStart, this._angleStart + this._angleSweep, '#303030', 1.0);

        // 红色超量程区
        this._drawArc(cx, cy, r * 0.94,
            this._angleStart + this._angleSweep * 0.90,
            this._angleStart + this._angleSweep,
            'rgba(220,30,10,0.35)', 4);

        // 单位
        const unitFs = Math.max(12, r * 0.16);
        this._staticGroup.add(new Konva.Text({
            x: cx - r * 0.65, y: cy - r * 0.12,
            text: 'A', fontSize: unitFs, fontFamily: 'Arial', fontStyle: 'bold',
            fill: '#cc2010', width: r * 1.30, align: 'center',
        }));

        // 量程标签
        this._rangeLabel = new Konva.Text({
            x: cx - r * 0.65, y: cy + r * 0.18,
            text: `0–${this._range}A`,
            fontSize: Math.max(13, r * 0.13), fontFamily: 'Arial',
            fill: '#404040', width: r * 1.30, align: 'center',
        });
        this._staticGroup.add(this._rangeLabel);

        // 中心轴
        this._staticGroup.add(new Konva.Circle({
            x: cx, y: cy, radius: r * 0.05,
            fill: '#b0a870', stroke: '#807840', strokeWidth: 1,
        }));
    }

    _drawArc(cx, cy, radius, startDeg, endDeg, stroke, sw) {
        const steps = Math.max(20, Math.abs(endDeg - startDeg) / 2);
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

    _drawMechZeroScrew() {
        const { x, y, r } = this._mechZero;
        this._staticGroup.add(new Konva.Circle({
            x, y, radius: r + 2,
            fill: '#5a5248', stroke: '#3a3228', strokeWidth: 1,
        }));
        this._staticGroup.add(new Konva.Circle({
            x, y, radius: r,
            fill: '#7a7268', stroke: '#4a4238', strokeWidth: 0.5,
        }));
        this._staticGroup.add(new Konva.Text({
            x: x - 22, y: y + r + 4, width: 44,
            text: '调零', fontSize: Math.max(9, r * 0.55),
            fill: '#037143', align: 'center', fontFamily: 'Arial',
        }));
    }

    // ─── 扳机按钮 ─────────────────────────────────

    _drawTriggerStatic() {
        const { x, y, w, h, rx } = this._trigger;

        // 扳机槽（仪表壳体的凹陷区域）
        this._staticGroup.add(new Konva.Rect({
            x: x - 3, y: y - 3, width: w + 6, height: h + 6,
            fill: '#0e1014', stroke: '#06080a', strokeWidth: 1.5,
            cornerRadius: rx + 3,
        }));
        // 槽内底部阴影
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

    // ─── 量程旋钮（中部，大旋钮） ─────────────────────

    _drawKnobStatic() {
        const { cx, cy, r } = this._knob;

        // 旋钮底座环
        this._staticGroup.add(new Konva.Circle({
            x: cx, y: cy, radius: r + 5,
            fill: '#1a1e22', stroke: '#101214', strokeWidth: 2,
        }));

        // 量程刻度点 + 数字
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

    // ─── 表笔插孔 ─────────────────────────────────

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

    // ─── 分割线 ──────────────────────────────────

    _drawDivider() {
        const f = this._frame;
        this._staticGroup.add(new Konva.Line({
            points: [this._divX, f.y + 8, this._divX, f.y + f.h - 8],
            stroke: '#506050', strokeWidth: 1, dash: [5, 4],
        }));
    }

    // ─── 右侧原理结构（浅色风格） ─────────────────────

    _drawPrincipleStatic() {
        const W = this.width, H = this.height;
        const f = this._frame;
        const { cx, cy, outerR, innerR } = this._core;

        // 右侧面板（浅色背景）
        this._staticGroup.add(new Konva.Rect({
            x: this._divX + 1, y: f.y + 2,
            width: W - this._divX - f.x - 2, height: f.h - 4,
            fill: '#f5f2e8',
            cornerRadius: [0, f.rx - 1, f.rx - 1, 0],
            stroke: '#d0c8b0', strokeWidth: 1,
        }));

        // 铁心下半
        this._staticGroup.add(new Konva.Arc({
            x: cx, y: cy,
            innerRadius: innerR, outerRadius: outerR,
            angle: 180, rotation: 0,
            fillLinearGradientStartPoint: { x: -outerR, y: 0 },
            fillLinearGradientEndPoint:   { x:  outerR, y: 0 },
            fillLinearGradientColorStops: [
                0, '#80a080', 0.3, '#90b890', 0.7, '#90b890', 1, '#80a080',
            ],
            stroke: '#607060', strokeWidth: 1.5,
        }));

        // 二次绕组
        this._drawCoilWinding(cx, cy, outerR, innerR);

        // 被测导线
        const { x0, x1, y: wireY } = this._wireLine;
        this._staticGroup.add(new Konva.Line({
            points: [x0, wireY, x1, wireY],
            stroke: '#e05030', strokeWidth: 3.5, lineCap: 'round',
        }));
        this._staticGroup.add(new Konva.Line({
            points: [x0, wireY, x1, wireY],
            stroke: '#c03818', strokeWidth: 2, lineCap: 'round', dash: [8, 4],
        }));

        this._staticGroup.add(new Konva.Text({
            x: cx - outerR, y: cy - outerR - 13,
            text: '环形硅钢片铁心',
            fontSize: Math.max(12, W * 0.016), fontFamily: 'Arial',
            fill: '#406040', width: outerR * 2, align: 'center',
        }));

        // 整流电路
        this._drawRectifierCircuit();

        // 直流分流电阻
        this._drawShuntResistors();

        // 磁电系表头（动圈、永磁体、指针）
        this._drawMovingCoilMeter();

        // DC+ 引线（整流桥正极 → 表头正极）
        const rCx = this._rectifier.cx;
        const rTop = this._rectifier.cy - this._rectifier.h/2;
        const rBot = this._rectifier.cy + this._rectifier.h/2;
        const mA_top = this._meterHead.cy - this._meterHead.h/2;
        // DC+ stub 终点在 rTop-4，从此往下引到表头
        this._staticGroup.add(new Konva.Line({
            points: [rCx, rTop - 4, rCx, mA_top - 8],
            stroke: '#2080c0', strokeWidth: 1.5, dash: [4, 3],
        }));

        this._staticGroup.add(new Konva.Text({
            x: rCx + 32, y: mA_top - 8 - 6,
            text: '表头', fontSize: Math.max(12, this._meterHead.w * 0.08),
            fontFamily: 'Arial', fill: '#c03020', fontStyle: 'bold',
        }));
    }

    _drawCoilWinding(cx, cy, outerR, innerR) {
        const midR = (outerR + innerR) / 2;
        const turnCount = 12;
        for (let i = 0; i < turnCount; i++) {
            const ang0 = Math.PI * (i / turnCount);
            const ang1 = Math.PI * ((i + 0.6) / turnCount);
            this._staticGroup.add(new Konva.Line({
                points: [
                    cx + midR * Math.cos(ang0), cy + midR * Math.sin(ang0),
                    cx + (midR + 3) * Math.cos(ang1), cy + (midR + 3) * Math.sin(ang1),
                ],
                stroke: '#c07020', strokeWidth: 1.8, lineCap: 'round',
            }));
        }

        // 二次绕组两出线端（引至整流桥左右臂）
        const exitL = { x: cx - innerR * 0.60, y: cy + outerR * 0.85 };
        const exitR = { x: cx + innerR * 0.60, y: cy + outerR * 0.85 };
        const rectTop = this._rectifier.cy - this._rectifier.h / 2;
        const rectLX = cx - this._rectifier.d / 2;
        const rectRX = cx + this._rectifier.d / 2;
        this._staticGroup.add(new Konva.Line({
            points: [exitL.x, exitL.y, exitL.x, rectTop, rectLX, rectTop],
            stroke: '#f83104', strokeWidth: 3.5, dash: [4, 3],
        }));
        this._staticGroup.add(new Konva.Line({
            points: [exitR.x, exitR.y, exitR.x, rectTop, rectRX, rectTop],
            stroke: '#f83104', strokeWidth: 3.5, dash: [4, 3],
        }));

        this._staticGroup.add(new Konva.Text({
            x: cx - outerR * 1.30, y: cy + outerR * 0.45,
            text: 'N₂\n二次绕组',
            fontSize: Math.max(12, outerR * 0.17), fontFamily: 'Arial',
            fill: '#806030', lineHeight: 1.3,
        }));
    }

    _drawShuntResistors() {
        const { cx, cy, w, h } = this._shunt;
        const hw = w / 2, hh = h / 2;
        const ranges = [5, 50, 100, 250];
        const fs = Math.max(7, w * 0.10);

        // 背景框
        this._staticGroup.add(new Konva.Rect({
            x: cx - hw, y: cy - hh, width: w, height: h,
            fill: 'rgba(240,235,220,0.50)', stroke: '#b0a890', strokeWidth: 0.8,
            cornerRadius: 3,
        }));

        // 母线上沿（DC- 输入线从整流桥来）
        const bTop = cy - hh + 4;
        this._staticGroup.add(new Konva.Line({
            points: [cx - hw + 4, bTop, cx + hw - 4, bTop],
            stroke: '#2080c0', strokeWidth: 1.2,
        }));

        // 分流电阻锯齿符号
        const rCount = 4;
        const rSpacing = w * 0.70 / (rCount + 1);
        const rStartX = cx - w * 0.35 + rSpacing;
        const rH = h * 0.30;
        const rTopY = bTop + 2;

        this._shuntLabels = [];
        for (let i = 0; i < rCount; i++) {
            const rx = rStartX + i * rSpacing;
            const pts = [rx, rTopY];
            for (let s = 0; s < 4; s++) {
                pts.push(rx + (s % 2 === 0 ? -3 : 3), rTopY + (s + 1) * (rH / 4));
            }
            pts.push(rx, rTopY + rH);
            this._staticGroup.add(new Konva.Line({
                points: pts, stroke: '#905030', strokeWidth: 1.5, tension: 0.1,
            }));

            const lbl = new Konva.Text({
                x: rx - rSpacing * 0.40, y: cy - hh + 2,
                text: `R${i+1}`, fontSize: Math.max(6, fs * 0.50),
                fontFamily: 'Arial', fill: '#908070',
                width: rSpacing * 0.8, align: 'center',
            });
            this._staticGroup.add(lbl);
            this._shuntLabels.push(lbl);
        }

        // 选中指示线（动态更新）
        const idx = ranges.indexOf(this._range);
        const selX = rStartX + idx * rSpacing;
        this._shuntActiveLine = new Konva.Line({
            points: [selX, rTopY + rH + 2, selX, cy + hh - 2],
            stroke: '#c03020', strokeWidth: 1.8,
        });
        this._staticGroup.add(this._shuntActiveLine);
        this._shuntRStartX = rStartX;
        this._shuntRSpacing = rSpacing;
        this._shuntTopY = rTopY + rH + 2;
        this._shuntBotY = cy + hh - 2;

        // 母线中沿（输出至表头负极）
        const bBot = cy + hh - 4;
        this._staticGroup.add(new Konva.Line({
            points: [cx - hw + 4, bBot, cx + hw - 4, bBot],
            stroke: '#2080c0', strokeWidth: 1.2,
        }));

        // 输入线（整流桥 DC− 短桩 → 分流母线上沿）
        const rBotReal = this._rectifier.cy + this._rectifier.h/2 + 4;
        this._staticGroup.add(new Konva.Line({
            points: [cx, rBotReal, cx, bTop],
            stroke: '#2080c0', strokeWidth: 1.5, dash: [4, 3],
        }));

        // 输出线（分流母线中沿 → 表头负极）
        const mBot = this._meterHead.cy + this._meterHead.h/2;
        const outX = cx - hw + 6;
        this._staticGroup.add(new Konva.Line({
            points: [outX, bBot, outX, mBot],
            stroke: '#2080c0', strokeWidth: 1.5, dash: [4, 3],
        }));

        // 标注
        this._staticGroup.add(new Konva.Text({
            x: cx - 2*hw - 20, y: cy - 6,
            text: '分流电阻\n（并联表头）', fontSize: Math.max(12, fs * 0.55),
            fontFamily: 'Arial', fill: '#705030', width: w - 4, align: 'center',
        }));

        this._updateShuntDisplay();
    }

    _updateShuntDisplay() {
        if (!this._shuntLabels) return;
        const ranges = [5, 50, 100, 250];
        const idx = ranges.indexOf(this._range);
        const selX = this._shuntRStartX + idx * this._shuntRSpacing;
        this._shuntLabels.forEach((l, i) => {
            l.fill(i === idx ? '#c03020' : '#908070');
            l.fontStyle(i === idx ? 'bold' : 'normal');
        });
        this._shuntActiveLine.points([selX, this._shuntTopY, selX, this._shuntBotY]);
    }

    _drawRectifierCircuit() {
        const { cx, cy, w, h, d } = this._rectifier;
        const fs = Math.max(8, w * 0.10);
        const hw = w / 2, hh = h / 2;

        // 背景框
        this._staticGroup.add(new Konva.Rect({
            x: cx - hw, y: cy - hh, width: w, height: h,
            fill: 'rgba(240,235,220,0.50)', stroke: '#b0a890', strokeWidth: 0.8,
            cornerRadius: 4,
        }));

        // 桥式整流符号——4个二极管构成菱形
        // D1: 左上→右上（上臂，朝右）
        // D2: 左下→右下（下臂，朝右）
        // D3: 左上→左下（左臂，朝下）
        // D4: 右上→右下（右臂，朝下）
        const dSize = Math.min(d * 0.30, h * 0.22);
        const gap = dSize * 0.15;

        // 菱形4个顶点
        const top = { x: cx, y: cy - hh + gap };
        const bot = { x: cx, y: cy + hh - gap };
        const lef = { x: cx - d/2, y: cy };
        const rig = { x: cx + d/2, y: cy };

        // 二极管绘制函数：三角形 + 竖线
        const drawDiode = (from, to, label) => {
            const dx = to.x - from.x, dy = to.y - from.y;
            const len = Math.sqrt(dx*dx + dy*dy);
            if (len < 1) return;
            const nx = dx/len, ny = dy/len;
            // 三角形（指向 to 方向）
            const triLen = dSize * 2/3;
            const triBase = dSize;
            const mx = from.x + nx * (len * 0.5);
            const my = from.y + ny * (len * 0.5);
            // 三角形顶点（指向 to）
            const tipX = mx + nx * triLen/2;
            const tipY = my + ny * triLen/2;
            // 三角形底边中点
            const baseX = mx - nx * triLen/2;
            const baseY = my - ny * triLen/2;
            // 底边两侧
            const px = -ny * triBase/2;
            const py =  nx * triBase/2;

            this._staticGroup.add(new Konva.Line({
                points: [tipX, tipY, baseX+px, baseY+py, baseX-px, baseY-py, tipX, tipY],
                closed: true,
                fill: '#c05030', stroke: '#801010', strokeWidth: 0.6,
            }));
            // 竖线（阴极）
            const barX = from.x + nx * (len * 0.5 + triLen/2 + gap/2);
            const barY = from.y + ny * (len * 0.5 + triLen/2 + gap/2);
            const barLen = dSize * 0.30;
            const bpx = -ny * barLen/2;
            const bpy =  nx * barLen/2;
            this._staticGroup.add(new Konva.Line({
                points: [barX + bpx, barY + bpy, barX - bpx, barY - bpy],
                stroke: '#c05030', strokeWidth: 1.8,
            }));
        };

        // D1: anode at left, cathode at top (电流左→上)
        drawDiode(lef, top);
        // D2: anode at right, cathode at top (电流右→上)
        drawDiode(rig, top);
        // D3: anode at bottom, cathode at left (电流底→左)
        drawDiode(bot, lef);
        // D4: anode at bottom, cathode at right (电流底→右)
        drawDiode(bot, rig);

        // 菱形连接线（4条边）
        const connPts = [
            [top, lef], [top, rig], [bot, lef], [bot, rig]
        ];
        connPts.forEach(([f, t]) => {
            this._staticGroup.add(new Konva.Line({
                points: [f.x, f.y, t.x, t.y],
                stroke: '#c05030', strokeWidth: 1.0,
            }));
        });

        // 标注
        this._staticGroup.add(new Konva.Text({
            x: cx - 2*hw - 20, y: cy  - 30,
            text: '桥式整流', fontSize: 12, fontFamily: 'Arial',
            fill: '#0d0a07', width: w, align: 'center',
        }));

    }

    _drawMovingCoilMeter() {
        const { cx, cy, w, h } = this._meterHead;
        const fs = Math.max(7, w * 0.09);

        // 表头外壳
        this._staticGroup.add(new Konva.Rect({
            x: cx - w/2, y: cy - h/2, width: w, height: h,
            fill: '#e8e4d8', stroke: '#b0a890', strokeWidth: 1.2,
            cornerRadius: 4,
        }));

        // 永磁体 N（左）S（右）
        const magW = w * 0.18, magH = h * 0.50;
        this._staticGroup.add(new Konva.Rect({
            x: cx - w/2 + 4, y: cy - magH/2, width: magW, height: magH,
            fill: '#4070c0', stroke: '#3050a0', strokeWidth: 0.8, cornerRadius: 2,
        }));
        this._staticGroup.add(new Konva.Rect({
            x: cx + w/2 - 4 - magW, y: cy - magH/2, width: magW, height: magH,
            fill: '#c04040', stroke: '#a03030', strokeWidth: 0.8, cornerRadius: 2,
        }));
        // N/S 文字
        const mFs = Math.max(12, magW * 0.50);
        this._staticGroup.add(new Konva.Text({
            x: cx - w/2 + 4, y: cy - mFs/2, text: 'N',
            fontSize: mFs, fontFamily: 'Arial', fontStyle: 'bold',
            fill: '#ffffff', width: magW, align: 'center',
        }));
        this._staticGroup.add(new Konva.Text({
            x: cx + w/2 - 4 - magW, y: cy - mFs/2, text: 'S',
            fontSize: mFs, fontFamily: 'Arial', fontStyle: 'bold',
            fill: '#ffffff', width: magW, align: 'center',
        }));

        // 磁极靴
        const poleW = w * 0.08, poleH = h * 0.55;
        [{ x: cx - w*0.20, fill: '#6080d0' },
         { x: cx + w*0.20 - poleW, fill: '#d06060' }].forEach(p => {
            this._staticGroup.add(new Konva.Rect({
                x: p.x, y: cy - poleH/2, width: poleW, height: poleH,
                fill: p.fill, stroke: '#404040', strokeWidth: 0.5, cornerRadius: 1,
            }));
        });

        // 动圈（旋转框架）
        const coilW = w * 0.24, coilH = h * 0.35;
        this._coilGroup = new Konva.Group({ x: cx, y: cy, rotation: 0 });
        this._coilGroup.add(new Konva.Rect({
            x: -coilW/2, y: -coilH/2, width: coilW, height: coilH,
            fill: 'rgba(180,120,30,0.25)', stroke: '#a07020', strokeWidth: 1.2,
            cornerRadius: 1,
        }));
        // 动圈绕线示意
        for (let i = 0; i < 6; i++) {
            const ly = -coilH/2 + (coilH/(6+1)) * (i+1);
            this._coilGroup.add(new Konva.Line({
                points: [-coilW/2 + 2, ly, coilW/2 - 2, ly],
                stroke: '#c08020', strokeWidth: 0.6,
            }));
        }
        // 动圈电流方向箭头
        this._coilGroup.add(new Konva.Text({
            x: -coilW/2 - 10, y: -coilH/2 - 10,
            text: '→', fontSize: Math.max(8, coilW*0.25),
            fontFamily: 'Arial', fill: '#2080c0',
        }));
        this._dynamicGroup.add(this._coilGroup);

        // 指针（从动圈向上延伸）
        this._rightPointerGroup = new Konva.Group({ x: cx, y: cy, rotation: 0 });
        this._rightPointerGroup.add(new Konva.Line({
            points: [0, 0, 0, -h * 0.60],
            stroke: '#cc2010', strokeWidth: 1.8, lineCap: 'round',
        }));
        this._rightPointerGroup.add(new Konva.Circle({
            x: 0, y: 0, radius: 2.5,
            fill: '#a07020', stroke: '#604010', strokeWidth: 0.5,
        }));
        this._dynamicGroup.add(this._rightPointerGroup);

        // 刻度弧（表头顶部）
        const scaleR = h * 0.55;
        const arcStart = 210, arcSweep = 120;
        const steps = 20;
        const pts = [];
        for (let i = 0; i <= steps; i++) {
            const a = (arcStart + arcSweep * (i / steps)) * Math.PI / 180;
            pts.push(cx + scaleR * Math.cos(a), cy - h/2 + scaleR + scaleR * Math.sin(a));
        }
        this._staticGroup.add(new Konva.Line({
            points: pts, stroke: '#505050', strokeWidth: 1.2,
            listening: false,
        }));
        // 刻度基线
        const baseLen = h * 0.06;
        for (let i = 0; i <= 5; i++) {
            const a = (arcStart + arcSweep * (i / 5)) * Math.PI / 180;
            const ox = scaleR * Math.cos(a);
            const oy = scaleR * Math.sin(a);
            const ix = (scaleR - baseLen) * Math.cos(a);
            const iy = (scaleR - baseLen) * Math.sin(a);
            this._staticGroup.add(new Konva.Line({
                points: [
                    cx + ox, cy - h/2 + scaleR + oy,
                    cx + ix, cy - h/2 + scaleR + iy,
                ],
                stroke: '#303030', strokeWidth: i % 2 === 0 ? 1.4 : 0.8,
                listening: false,
            }));
        }

        // 标注文字
        this._staticGroup.add(new Konva.Text({
            x: cx - w/2 + 2, y: cy + h/2 + 2,
            text: '永磁体·动圈·指针', fontSize: 12, fontFamily: 'Arial',
            fill: '#406040', width: w - 4, align: 'center',
        }));
    }

    // ═══════════════════════════════════════════════════════
    // 动态节点
    // ═══════════════════════════════════════════════════════

    _createDynamicNodes() {
        this._createJawDynamic();
        this._createNeedle();
        this._createTriggerButton();
        this._createKnobDynamic();
        this._createFluxArrows();
        this._createCoreUpperDynamic();
        this._createCurrentDisplay();
        this._createMechZeroDynamic();
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
                0, '#80a080', 0.3, '#90b890', 0.7, '#90b890', 1, '#80a080',
            ],
            stroke: '#607060', strokeWidth: 1.5, listening: false,
        }));

        const midR = (outerR + innerR) / 2;
        for (let i = 0; i < 10; i++) {
            const ang0 = Math.PI + Math.PI * (i / 10);
            const ang1 = Math.PI + Math.PI * ((i + 0.6) / 10);
            this._coreUpperGroup.add(new Konva.Line({
                points: [
                    midR * Math.cos(ang0), midR * Math.sin(ang0),
                    (midR + 3) * Math.cos(ang1), (midR + 3) * Math.sin(ang1),
                ],
                stroke: '#c07020', strokeWidth: 1.8, lineCap: 'round', listening: false,
            }));
        }

        this._dynamicGroup.add(this._coreUpperGroup);
    }

    _createNeedle() {
        const { cx, cy, r } = this._face;
        const needleLen = r * 0.82;
        const tailLen = r * 0.12;

        this._needleGroup = new Konva.Group({ x: cx, y: cy, rotation: this._needleAngle });

        this._needleGroup.add(new Konva.Line({
            points: [-tailLen, 0, needleLen * 0.88, 0],
            stroke: '#cc2010', strokeWidth: 1.8, lineCap: 'round',
        }));
        this._needleGroup.add(new Konva.Line({
            points: [needleLen * 0.68, -1.8, needleLen * 0.88, 0, needleLen * 0.68, 1.8],
            closed: true, fill: '#cc2010', stroke: '#cc2010', strokeWidth: 0.4,
        }));
        this._needleGroup.add(new Konva.Rect({
            x: -tailLen - 4, y: -2, width: 6, height: 4,
            fill: '#aa1006', cornerRadius: 1,
        }));

        this._dynamicGroup.add(this._needleGroup);

        this._dynamicGroup.add(new Konva.Circle({
            x: cx, y: cy, radius: r * 0.05,
            fillLinearGradientStartPoint: { x: -2, y: -2 },
            fillLinearGradientEndPoint:   { x:  2, y:  2 },
            fillLinearGradientColorStops: [0, '#f0e060', 0.5, '#c8a838', 1, '#908020'],
            stroke: '#706018', strokeWidth: 0.8, listening: false,
        }));
    }

    _createTriggerButton() {
        const { x, y, w, h, rx } = this._trigger;

        this._triggerGroup = new Konva.Group({ x, y });

        // 扳机主体
        this._triggerBody = new Konva.Rect({
            x: 0, y: 0, width: w, height: h,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint:   { x: 0, y: h },
            fillLinearGradientColorStops: [0, '#5a6470', 0.5, '#3e4854', 1, '#28303a'],
            stroke: '#1a1e22', strokeWidth: 1, cornerRadius: rx,
        });
        this._triggerGroup.add(this._triggerBody);

        // 顶部高光
        this._triggerGroup.add(new Konva.Line({
            points: [rx + 2, 1.5, w - rx - 2, 1.5],
            stroke: '#8090a0', strokeWidth: 0.8, lineCap: 'round',
        }));

        // 防滑纹路（3 条凹槽，每条带下方高光）
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

        // 底部边缘
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

    _createCurrentDisplay() {
        const { cx, cy, r } = this._face;
        const fs = Math.max(8, r * 0.18);

        this._currentText = new Konva.Text({
            x: cx - r * 0.60,
            y: cy + r * 0.50,
            text: '0.0 A',
            fontSize: fs, fontFamily: 'Courier New', fontStyle: 'bold',
            fill: '#fc0303',
            width: r * 1.20, align: 'center',
        });
        this._dynamicGroup.add(this._currentText);
    }

    _createMechZeroDynamic() {
        const { x, y, r } = this._mechZero;
        this._mechSlot = new Konva.Line({
            points: [x - r * 0.6, y, x + r * 0.6, y],
            stroke: '#2a2826', strokeWidth: 1.5, lineCap: 'round',
        });
        this._dynamicGroup.add(this._mechSlot);
    }

    // ═══════════════════════════════════════════════════════
    // 交互
    // ═══════════════════════════════════════════════════════

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
            this._rangeLabel.text(`0–${this._range}A`);
            this._updateShuntDisplay();
        });
        knobHit.on('mouseenter', () => { document.body.style.cursor = 'pointer'; });
        knobHit.on('mouseleave', () => { document.body.style.cursor = 'default'; });
        this._interactGroup.add(knobHit);

        // 机械调零旋钮
        const mz = this._mechZero;
        const mzHit = new Konva.Circle({
            x: mz.x, y: mz.y, radius: mz.r + 8, fill: 'transparent',
        });
        const mzSteps = [-0.05, 0, 0.05];
        mzHit.on('click tap', (e) => {
            e.cancelBubble = true;
            const idx = mzSteps.indexOf(this._mechanicalOffset);
            this._mechanicalOffset = mzSteps[(idx + 1) % mzSteps.length];
        });
        mzHit.on('mouseenter', () => { document.body.style.cursor = 'pointer'; });
        mzHit.on('mouseleave', () => { document.body.style.cursor = 'default'; });
        this._interactGroup.add(mzHit);
    }

    // ═══════════════════════════════════════════════════════
    // 动态更新
    // ═══════════════════════════════════════════════════════

    _updateDynamic() {
        const i = this._oilFault ? this._currentI * 0.55 : this._currentI;
        const offsetDeg = this._mechanicalOffset * this._angleSweep;

        // 指针
        this._needleAngle = this._currentToAngle(i) + offsetDeg;
        this._needleGroup.rotation(this._needleAngle);

        // 右侧动圈指针
        const frac = Math.min(1, i / Math.max(1, this._range));
        this._rightPointerAngle = -20 + frac * 40 + this._mechanicalOffset * 40;
        this._rightPointerGroup.rotation(this._rightPointerAngle);
        this._coilGroup.rotation(this._rightPointerAngle);

        // 钳口动画
        const jawTarget = this._jawOpen ? 1 : 0;
        this._jawAngle += (jawTarget - this._jawAngle) * 0.15;
        const jawOpenDeg = this._jawAngle * 42;
        this._jawGroup.rotation(-jawOpenDeg);
        this._coreUpperGroup.rotation(-jawOpenDeg);

        // 扳机
        const { y: ty, h: th } = this._trigger;
        this._triggerGroup.y(this._jawOpen ? ty + th * 0.08 : ty);
        this._triggerBody.fillLinearGradientColorStops(
            this._jawOpen
                ? [0, '#4a7a6a', 0.5, '#306050', 1, '#1e3830']
                : [0, '#5a6470', 0.5, '#3e4854', 1, '#28303a']
        );

        // 旋钮
        this._knobGroup.rotation(this._knobAngle);

        // 磁通
        this._updateFluxArrows(i);

        // 数字显示
        this._currentText.text(`${i.toFixed(1)} A`);

        // 机械调零螺丝槽线
        const mz = this._mechZero;
        const mzAngle = this._mechanicalOffset * 2400;
        const mzRad = mzAngle * Math.PI / 180;
        this._mechSlot.points([
            mz.x - mz.r * 0.6 * Math.cos(mzRad),
            mz.y - mz.r * 0.6 * Math.sin(mzRad),
            mz.x + mz.r * 0.6 * Math.cos(mzRad),
            mz.y + mz.r * 0.6 * Math.sin(mzRad),
        ]);
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

    // ═══════════════════════════════════════════════════════
    // tick
    // ═══════════════════════════════════════════════════════

    tick(dt) {
        const tau = Math.max(0.05, this._rampTime);
        const alpha = 1 - Math.exp(-dt / tau);
        this._currentI += (this._targetI - this._currentI) * alpha;

        if (this._currentI > 0.05) {
            this._fluxPhase = (this._fluxPhase + dt * 3.14 * 2) % (Math.PI * 2);
        }

        this._updateDynamic();
        this.markDirty();
        this._refreshIfDirty();
    }

    // ═══════════════════════════════════════════════════════
    // 公开 API
    // ═══════════════════════════════════════════════════════

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
            if (this._rangeLabel) this._rangeLabel.text(`0–${this._range}A`);
            this._updateShuntDisplay();
        }
    }
    getCurrent() { return this._currentI; }

    update(state) {
        if (typeof state === 'object' && state !== null) {
            if (state.current !== undefined) this.setCurrent(state.current);
            if (state.jawOpen !== undefined) this.setJawOpen(state.jawOpen);
            if (state.range   !== undefined) this.setRange(state.range);
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
            { label: '机械调零偏移',                      key: 'mechanicalOffset', type: 'number' },
        ];
    }

    destroy() {
        super.destroy?.();
    }
}
