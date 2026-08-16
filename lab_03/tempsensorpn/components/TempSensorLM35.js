import { BaseComponent } from './BaseComponent.js';

/**
 * LM35 精密温度传感器仿真组件
 * （LM35 Precision Centigrade Temperature Sensor）
 *
 * ── 器件说明 ──────────────────────────────────────────────────
 *
 *  LM35 是 Texas Instruments 生产的高精度摄氏温度传感器 IC，
 *  属于 PN 结型（Band-gap）温度传感器，核心原理：
 *
 *  ┌─────────────────────────────────────────────────────────┐
 *  │  PN 结正向电压与温度的线性关系：                         │
 *  │                                                         │
 *  │    Vbe = Vg0·(1 - T/T0) + Vbe0·(T/T0)                 │
 *  │                                                         │
 *  │  LM35 内部利用两个特性匹配的 BJT（Q1/Q2）的 ΔVbe       │
 *  │  经内部运放放大后，输出电压严格正比于摄氏温度：          │
 *  │                                                         │
 *  │    Vout = 10 mV/°C × T(°C)                             │
 *  │                                                         │
 *  │  即：0°C → 0V，25°C → 250mV，100°C → 1.0V             │
 *  └─────────────────────────────────────────────────────────┘
 *
 * ── 封装说明（TO-92）─────────────────────────────────────────
 *
 *  本组件仿真 TO-92 直插封装，三脚正视图：
 *
 *  外观：D 形半圆柱黑色塑料体，平面朝前
 *  引脚排列（平面朝向观察者，从左到右）：
 *
 *    Pin 1 (VS / VCC) ─── 电源正端，+4V ~ +30V
 *    Pin 2 (VOUT)     ─── 模拟电压输出，10mV/°C
 *    Pin 3 (GND)      ─── 电源地
 *
 *  内部结构（正视剖面透视）：
 *    ┌──────────────────────────┐
 *    │  Die（芯片）             │
 *    │  ┌──────────────────┐   │
 *    │  │ Q1  ΔVbe  Q2     │   │  ← 差分 BJT 对（PN 结核心）
 *    │  │    ↓              │   │
 *    │  │  OpAmp（增益级）  │   │  ← 片上运算放大器
 *    │  │    ↓              │   │
 *    │  │  Vout=10mV/°C    │   │
 *    │  └──────────────────┘   │
 *    │  Lead Frame（引线框架）  │
 *    └──────────────────────────┘
 *
 * ── 仿真特性 ──────────────────────────────────────────────────
 *
 *  1. 精确输出模型：Vout = 0.010 × T(°C) [V]，含非线性误差项
 *  2. 温度范围：-55°C ~ +150°C（仿真），超范围显示饱和/截止
 *  3. 热响应模拟：一阶热时间常数（τ=3s，对应静止空气中的响应）
 *  4. 自热效应：工作电流×内阻产生约 0.08°C 温升叠加
 *  5. 噪声模型：±0.2°C 随机热噪声（可配置关闭）
 *  6. 电源灵敏度：电源电压变化对输出的轻微影响
 *  7. 内部 PN 结动画：温度升高时结点发光增强（红橙渐变）
 *  8. 散热/升温动画：封装体颜色随温度变化（冷蓝→暖红）
 *
 * ── 电气参数 ──────────────────────────────────────────────────
 *
 *  电源电压：+4V ~ +30V（典型 +5V）
 *  静态电流：约 60μA（典型）
 *  输出阻抗：0.1Ω（典型）
 *  精度：±0.5°C（典型，25°C）
 *  线性度：±0.25°C（0~100°C）
 *  响应时间：1s（在搅拌油中），3s（静止空气）
 *
 * ── 端口 ─────────────────────────────────────────────────────
 *  pin_vs   — Pin1：电源正端（VCC，+4V~+30V）
 *  pin_vout — Pin2：模拟电压输出（10mV/°C）
 *  pin_gnd  — Pin3：电源地（GND）
 */
export class LM35 extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.width  = Math.max(130, config.width  || 160);
        this.height = Math.max(200, config.height || 240);

        this.type    = 'lm35';
        this.special = 'sensor';
        this.cache   = 'fixed';

        // ── 器件参数 ──
        this.label          = config.label          || 'T';
        this.sensitivity    = config.sensitivity    || 10.0;   // mV/°C（标称值）
        this.vcc            = config.vcc            || 5.0;    // V，外部电源
        this.noiseEnable    = config.noiseEnable    !== false; // 热噪声模拟
        this.selfHeatEnable = config.selfHeatEnable !== false; // 自热效应
        this.tauSec         = config.tauSec         || 3.0;    // 热响应时间常数 (s)

        // ── 温度状态 ──
        this._tempAmbient   = config.initTemp !== undefined ? config.initTemp : 25.0; // °C 环境温度
        this._tempJunction  = this._tempAmbient;  // °C 结温（含热惯性/自热）
        this._tempDisplay   = this._tempAmbient;  // 显示温度（含噪声）
        this._noiseSeed     = 0;
        this._noiseVal      = 0;
        this._noiseTimer    = 0;

        // 电气输出
        this._vout          = this._calcVout(this._tempJunction);

        // ── 动画状态 ──
        this._pnGlow        = 0;   // PN 结发光强度 0~1
        this._pnPhase       = 0;   // PN 结动画相位
        this._ripplePhase   = 0;   // 热涟漪相位
        this._lastTs        = null;
        this._animId        = null;

        // ── 几何布局（相对 width/height）──
        const W = this.width, H = this.height;

        // TO-92 封装体（D 形圆柱，平面朝前）
        this._body = {
            // 外轮廓包络矩形（圆弧半部分在上，平面在下方）
            cx: W * 0.50,
            cy: H * 0.36,
            r:  Math.min(W * 0.38, H * 0.22),   // 半径
        };

        // 三根引脚
        const pinSpacing = this._body.r * 0.90;
        const pinTop     = this._body.cy + this._body.r * 0.38;
        const pinBottom  = H * 0.85;
        this._pins = [
            { id: 'pin_vs',   label: 'VS',   x: this._body.cx - pinSpacing, y1: pinTop, y2: pinBottom },
            { id: 'pin_vout', label: 'VOUT', x: this._body.cx,              y1: pinTop, y2: pinBottom },
            { id: 'pin_gnd',  label: 'GND',  x: this._body.cx + pinSpacing, y1: pinTop, y2: pinBottom },
        ];

        // 内部剖面结构（相对于封装体中心）
        this._die = {
            cx: this._body.cx,
            cy: this._body.cy - this._body.r * 0.12,
            w:  this._body.r * 1.10,
            h:  this._body.r * 0.82,
        };

        this._lastTs = null;
        this._animId = null;

        this._init();

        // 注册端口
        this._pins.forEach(p => {
            this.addPort(p.x, p.y2 + 4, p.id, 'wire', p.label);
        });
    }

    // ═══════════════════════════════════════════
    _init() {
        this._drawStaticLayers();   // 不变部分：管脚金属、TO-92 外壳骨架
        this._dynamicGroup = new Konva.Group();
        this.group.add(this._dynamicGroup);
        this._rebuild();
        this._drawLabel();
        this._drawStatusPanel();
        this._startLoop();
    }

    // ── 静态层：引脚 + 封装外框 ─────────────────
    _drawStaticLayers() {
        // 三根金属引脚
        this._pins.forEach((p, i) => {
            // 引脚主体（银白）
            this.group.add(new Konva.Rect({
                x: p.x - 1.8, y: p.y1,
                width: 3.6, height: p.y2 - p.y1,
                fillLinearGradientStartPoint: { x: -1.8, y: 0 },
                fillLinearGradientEndPoint:   { x:  1.8, y: 0 },
                fillLinearGradientColorStops: [
                    0,   '#606870',
                    0.3, '#c0c8d0',
                    0.6, '#e0e8f0',
                    0.8, '#b0b8c0',
                    1,   '#606870',
                ],
                strokeWidth: 0,
            }));
            // 引脚根部加宽（与封装连接处）
            this.group.add(new Konva.Rect({
                x: p.x - 2.5, y: p.y1 - 2,
                width: 5.0, height: 8,
                fill: '#888898', cornerRadius: 1,
            }));
            // 引脚编号
            this.group.add(new Konva.Text({
                x: p.x - 12, y: p.y2 + 6,
                width: 24, text: p.label,
                fontSize: 7, fill: '#5a7a9a',
                align: 'center', fontStyle: 'bold',
            }));
            // 引脚序号小标
            this.group.add(new Konva.Text({
                x: p.x - 6, y: p.y2 - 14,
                width: 12,
                text: String(i + 1),
                fontSize: 7, fill: '#7a8a9a',
                align: 'center',
            }));
        });
    }

    // ── 动态层：封装体 + 内部结构 + 温度特效 ──
    _rebuild() {
        this._dynamicGroup.destroyChildren();

        const bc   = this._body;
        const T    = this._tempJunction;
        const Tnorm = Math.max(0, Math.min(1, (T + 55) / 205)); // -55~150°C 归一化
        const glow = this._pnGlow;

        // ── TO-92 封装体外壳 ──
        this._drawPackageBody(bc, T, Tnorm);

        // ── 内部剖面：芯片 die 区域 ──
        this._drawDieInterior(T, Tnorm, glow);

        // ── PN 结动画层 ──
        this._drawPNJunction(Tnorm, glow);

        // ── 热涟漪效果 ──
        if (T > 40) this._drawHeatRipple(T);

        // ── 引脚标注更新 ──
        this._drawPinAnnotations();
    }

    _drawPackageBody(bc, T, Tnorm) {
        const g = this._dynamicGroup;

        // 封装体颜色随温度变化（冷态→热态：深黑 → 深蓝灰 → 深红）
        const bodyColor  = this._getTempBodyColor(Tnorm, 0.95);
        const bodyColor2 = this._getTempBodyColor(Tnorm, 0.70);

        // 半圆弧形背面（圆柱弧面）
        g.add(new Konva.Arc({
            x: bc.cx, y: bc.cy,
            innerRadius: 0,
            outerRadius: bc.r,
            angle: 180,
            rotation: 0,          // 0° = 3点钟方向开始，arc 逆时针…
                                   // Konva Arc: rotation 是整体旋转
            fill: bodyColor,
            stroke: this._getTempBodyStroke(Tnorm),
            strokeWidth: 1.2,
            // 半圆：上半部分，Konva Arc angle=180 从 rotation 开始
        }));

        // 用完整圆减去下半：改用 Path 更精确
        g.add(new Konva.Shape({
            sceneFunc(ctx, shape) {
                const { cx, cy, r } = bc;
                ctx.beginPath();
                ctx.arc(cx, cy, r, Math.PI, 2 * Math.PI); // 上半弧（180°~360°=上）
                ctx.lineTo(cx + r, cy);
                ctx.lineTo(cx - r, cy);
                ctx.closePath();
                ctx.fillStrokeShape(shape);
            },
            fillLinearGradientStartPoint: { x: bc.cx - bc.r, y: bc.cy - bc.r },
            fillLinearGradientEndPoint:   { x: bc.cx + bc.r, y: bc.cy + bc.r },
            fillLinearGradientColorStops: [
                0,    bodyColor,
                0.45, bodyColor2,
                0.75, bodyColor,
                1,    this._getTempBodyColor(Tnorm, 0.60),
            ],
            stroke: this._getTempBodyStroke(Tnorm),
            strokeWidth: 1.2,
        }));

        // 封装体下部（平面矩形部分，引脚区域）
        const flatW = bc.r * 2;
        const flatH = bc.r * 0.42;
        g.add(new Konva.Rect({
            x: bc.cx - bc.r, y: bc.cy,
            width: flatW, height: flatH,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint:   { x: flatW, y: flatH },
            fillLinearGradientColorStops: [
                0,   bodyColor,
                0.5, bodyColor2,
                1,   this._getTempBodyColor(Tnorm, 0.55),
            ],
            stroke: this._getTempBodyStroke(Tnorm),
            strokeWidth: 1.2,
        }));

        // 封装正面丝印（白色文字）
        g.add(new Konva.Text({
            x: bc.cx - bc.r * 0.85, y: bc.cy - bc.r * 0.55,
            width: bc.r * 1.7,
            text: 'LM35',
            fontSize: bc.r * 0.26,
            fill: `rgba(230,235,240,${0.55 + Tnorm * 0.30})`,
            align: 'center',
            fontStyle: 'bold',
            fontFamily: 'Courier New, monospace',
        }));
        // 制造商标
        g.add(new Konva.Text({
            x: bc.cx - bc.r * 0.85, y: bc.cy - bc.r * 0.26,
            width: bc.r * 1.7,
            text: 'TI',
            fontSize: bc.r * 0.16,
            fill: `rgba(180,195,210,${0.40 + Tnorm * 0.20})`,
            align: 'center',
            fontFamily: 'Courier New, monospace',
        }));
        // 定位缺口（顶部中心小凹槽）
        g.add(new Konva.Arc({
            x: bc.cx, y: bc.cy - bc.r + 1,
            innerRadius: 0, outerRadius: bc.r * 0.08,
            angle: 180, rotation: -90,
            fill: this._getTempBodyColor(Tnorm, 0.40),
        }));

        // 封装侧面弧面高光
        g.add(new Konva.Shape({
            sceneFunc(ctx, shape) {
                const { cx, cy, r } = bc;
                ctx.beginPath();
                ctx.arc(cx - r*0.12, cy, r*0.72, Math.PI*1.15, Math.PI*1.85);
                ctx.strokeStyle = shape.getAttr('stroke');
                ctx.lineWidth   = shape.getAttr('strokeWidth');
                ctx.stroke();
            },
            stroke: `rgba(255,255,255,${0.07 + Tnorm * 0.04})`,
            strokeWidth: bc.r * 0.18,
        }));
    }

    _drawDieInterior(T, Tnorm, glow) {
        const g  = this._dynamicGroup;
        const d  = this._die;
        const bc = this._body;

        // 芯片 die 基底（硅片灰色，略带蓝）
        g.add(new Konva.Rect({
            x: d.cx - d.w/2, y: d.cy - d.h/2,
            width: d.w, height: d.h,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint:   { x: d.w, y: d.h },
            fillLinearGradientColorStops: [
                0,   `rgba(38,44,60,0.88)`,
                0.4, `rgba(50,58,78,0.88)`,
                0.7, `rgba(38,44,60,0.88)`,
                1,   `rgba(28,32,48,0.88)`,
            ],
            stroke: 'rgba(80,100,140,0.60)',
            strokeWidth: 0.8,
            cornerRadius: 2,
        }));

        // ── 内部电路示意图 ──────────────────
        const dLeft  = d.cx - d.w * 0.44;
        const dRight = d.cx + d.w * 0.44;
        const dTop   = d.cy - d.h * 0.38;
        const dBot   = d.cy + d.h * 0.38;

        // Q1 BJT 符号（左）
        this._drawBJTSymbol(g, d.cx - d.w*0.28, d.cy, d.h*0.20, Tnorm, 'Q1');
        // Q2 BJT 符号（右）
        this._drawBJTSymbol(g, d.cx + d.w*0.28, d.cy, d.h*0.20, Tnorm, 'Q2');

        // 运放符号（中下）
        this._drawOpAmpSymbol(g, d.cx, d.cy + d.h*0.22, d.h*0.28, Tnorm);

        // 连线（Q1/Q2 → 运放）
        const lineAlpha = 0.35 + Tnorm * 0.25;
        const lineColor = `rgba(120,180,220,${lineAlpha})`;
        const lineW = 0.7;

        // Q1 基极到 Q2 基极（顶部横连）
        g.add(new Konva.Line({
            points: [
                d.cx - d.w*0.28, d.cy - d.h*0.10,
                d.cx + d.w*0.28, d.cy - d.h*0.10,
            ],
            stroke: lineColor, strokeWidth: lineW,
        }));
        // Q1/Q2 集电极到运放 -/+ 输入
        g.add(new Konva.Line({
            points: [
                d.cx - d.w*0.20, d.cy + d.h*0.10,
                d.cx - d.w*0.20, d.cy + d.h*0.16,
                d.cx - d.w*0.07, d.cy + d.h*0.16,
            ],
            stroke: lineColor, strokeWidth: lineW, tension: 0,
        }));
        g.add(new Konva.Line({
            points: [
                d.cx + d.w*0.20, d.cy + d.h*0.10,
                d.cx + d.w*0.20, d.cy + d.h*0.16,
                d.cx + d.w*0.07, d.cy + d.h*0.16,
            ],
            stroke: lineColor, strokeWidth: lineW,
        }));
        // 运放输出到右侧
        g.add(new Konva.Line({
            points: [
                d.cx + d.w*0.14, d.cy + d.h*0.22,
                d.cx + d.w*0.40, d.cy + d.h*0.22,
            ],
            stroke: `rgba(100,220,140,${lineAlpha})`, strokeWidth: lineW,
        }));

        // VCC 总线（顶部横线）
        g.add(new Konva.Line({
            points: [dLeft + 2, dTop + 3, dRight - 2, dTop + 3],
            stroke: `rgba(255,80,80,${lineAlpha * 0.8})`, strokeWidth: 0.6,
            dash: [3, 2],
        }));
        // GND 总线（底部横线）
        g.add(new Konva.Line({
            points: [dLeft + 2, dBot - 3, dRight - 2, dBot - 3],
            stroke: `rgba(80,160,255,${lineAlpha * 0.8})`, strokeWidth: 0.6,
            dash: [3, 2],
        }));

        // 标注：ΔVbe 文字
        g.add(new Konva.Text({
            x: d.cx - d.w*0.44, y: d.cy - d.h*0.10,
            width: d.w*0.88, text: 'ΔVbe → 10mV/°C',
            fontSize: 5.5, fill: `rgba(160,200,180,${0.55 + Tnorm*0.3})`,
            align: 'center', fontFamily: 'Courier New',
        }));
    }

    _drawBJTSymbol(g, cx, cy, size, Tnorm, name) {
        // NPN BJT 简化符号：基极竖线 + 发射/集电极斜线
        const alpha = 0.50 + Tnorm * 0.35;

        // 基极线
        g.add(new Konva.Line({
            points: [cx - size*0.5, cy - size*0.55, cx - size*0.5, cy + size*0.55],
            stroke: `rgba(160,190,220,${alpha})`, strokeWidth: 0.9,
        }));
        // 基极连接横线
        g.add(new Konva.Line({
            points: [cx - size*0.5, cy, cx - size*0.05, cy],
            stroke: `rgba(160,190,220,${alpha})`, strokeWidth: 0.9,
        }));
        // 集电极斜线（上）
        g.add(new Konva.Line({
            points: [cx - size*0.05, cy, cx + size*0.5, cy - size*0.55],
            stroke: `rgba(160,190,220,${alpha})`, strokeWidth: 0.9,
        }));
        // 发射极斜线（下，带箭头）
        g.add(new Konva.Line({
            points: [cx - size*0.05, cy, cx + size*0.5, cy + size*0.55],
            stroke: `rgba(160,190,220,${alpha})`, strokeWidth: 0.9,
        }));
        // 发射极箭头（小三角）
        g.add(new Konva.Shape({
            sceneFunc(ctx, shape) {
                const ex = cx + size*0.5, ey = cy + size*0.55;
                const ang = Math.atan2(size*0.55, size*0.55);
                ctx.save();
                ctx.translate(ex, ey);
                ctx.rotate(ang + Math.PI);
                ctx.beginPath();
                ctx.moveTo(0, 0);
                ctx.lineTo(-4, 2);
                ctx.lineTo(-4, -2);
                ctx.closePath();
                ctx.fillStyle = `rgba(160,190,220,${alpha})`;
                ctx.fill();
                ctx.restore();
            },
        }));

        // PN 结圆圈标记（发光核心）
        const jGlow = this._pnGlow;
        g.add(new Konva.Circle({
            x: cx, y: cy,
            radius: size * 0.28,
            fill: `rgba(${Math.round(180+Tnorm*60)},${Math.round(80+Tnorm*40)},${Math.round(40)},${0.15 + jGlow*0.50})`,
            stroke: `rgba(${Math.round(220+Tnorm*35)},${Math.round(120+Tnorm*60)},${Math.round(60)},${0.30 + jGlow*0.55})`,
            strokeWidth: 0.6,
            shadowColor: `rgba(255,${Math.round(100+Tnorm*80)},20,${jGlow*0.8})`,
            shadowBlur: jGlow * 6,
            shadowOpacity: jGlow,
        }));

        // 器件名
        g.add(new Konva.Text({
            x: cx - size*0.7, y: cy + size*0.65,
            width: size*1.4, text: name,
            fontSize: 5, fill: `rgba(120,160,200,${alpha})`,
            align: 'center', fontFamily: 'Courier New',
        }));
    }

    _drawOpAmpSymbol(g, cx, cy, size, Tnorm) {
        const alpha = 0.45 + Tnorm * 0.30;
        const col = `rgba(100,210,160,${alpha})`;

        // 三角形运放符号
        g.add(new Konva.Line({
            points: [
                cx - size*0.5, cy - size*0.45,
                cx + size*0.5, cy,
                cx - size*0.5, cy + size*0.45,
                cx - size*0.5, cy - size*0.45,
            ],
            stroke: col, strokeWidth: 0.8, closed: true, fill: `rgba(30,60,50,0.5)`,
        }));
        // + - 符号
        g.add(new Konva.Text({
            x: cx - size*0.45, y: cy - size*0.34,
            text: '+', fontSize: 5.5, fill: col, fontFamily: 'Courier New',
        }));
        g.add(new Konva.Text({
            x: cx - size*0.45, y: cy + size*0.10,
            text: '−', fontSize: 5.5, fill: col, fontFamily: 'Courier New',
        }));
        g.add(new Konva.Text({
            x: cx - size*0.25, y: cy + size*0.56,
            width: size*0.8, text: 'AMP', fontSize: 4.5,
            fill: `rgba(80,180,140,${alpha * 0.7})`,
            align: 'center', fontFamily: 'Courier New',
        }));
    }

    // ── PN 结发光特效 ────────────────────────
    _drawPNJunction(Tnorm, glow) {
        if (glow < 0.05) return;
        const g  = this._dynamicGroup;
        const d  = this._die;

        // Q1 PN 结辉光
        const jColor = `rgba(${Math.round(255)},${Math.round(100 + Tnorm*80)},${Math.round(30)},${glow * 0.55})`;

        [-1, 1].forEach(side => {
            const jx = d.cx + side * d.w * 0.28;
            const jy = d.cy;
            g.add(new Konva.Circle({
                x: jx, y: jy,
                radius: d.h * 0.14 * (1 + glow * 0.5),
                fill: jColor,
                shadowColor: `rgba(255,${Math.round(140+Tnorm*80)},0,1)`,
                shadowBlur: 8 * glow,
                shadowOpacity: glow * 0.9,
            }));
        });

        // 热辐射线（从 die 中心向外放射，高温时出现）
        if (Tnorm > 0.5) {
            const rays = 6;
            const rayLen = d.h * 0.25 * ((Tnorm - 0.5) * 2);
            for (let i = 0; i < rays; i++) {
                const ang = (i / rays) * Math.PI * 2 + this._ripplePhase;
                g.add(new Konva.Line({
                    points: [
                        d.cx + Math.cos(ang) * d.h * 0.15,
                        d.cy + Math.sin(ang) * d.h * 0.15,
                        d.cx + Math.cos(ang) * (d.h * 0.15 + rayLen),
                        d.cy + Math.sin(ang) * (d.h * 0.15 + rayLen),
                    ],
                    stroke: `rgba(255,${Math.round(160+Tnorm*60)},40,${(Tnorm-0.5)*glow*0.6})`,
                    strokeWidth: 0.7,
                }));
            }
        }
    }

    // ── 热涟漪效果 ───────────────────────────
    _drawHeatRipple(T) {
        if (T < 50) return;
        const g  = this._dynamicGroup;
        const bc = this._body;
        const intensity = Math.min(1, (T - 50) / 80);
        const phase = this._ripplePhase;

        for (let ring = 0; ring < 3; ring++) {
            const rPhase = (phase + ring * 0.67) % 1;
            const rRadius = bc.r * (1.1 + rPhase * 0.8);
            const rAlpha  = (1 - rPhase) * intensity * 0.25;
            if (rAlpha < 0.01) continue;
            g.add(new Konva.Circle({
                x: bc.cx, y: bc.cy - bc.r * 0.1,
                radius: rRadius,
                fill: 'transparent',
                stroke: `rgba(255,${Math.round(100+intensity*80)},30,${rAlpha})`,
                strokeWidth: 0.8,
            }));
        }
    }

    // ── 引脚注释（动态电压值）───────────────
    _drawPinAnnotations() {
        const g = this._dynamicGroup;
        const W = this.width;

        // 输出电压标注（VOUT 引脚旁）
        const voutPin = this._pins[1];
        const vout    = this._vout;
        g.add(new Konva.Text({
            x: voutPin.x + 6,
            y: voutPin.y1 + (voutPin.y2 - voutPin.y1) * 0.55,
            text: `${(vout * 1000).toFixed(1)}mV`,
            fontSize: 7, fill: '#66bb6a', fontStyle: 'bold',
            fontFamily: 'Courier New',
        }));
        // 温度标注
        g.add(new Konva.Text({
            x: 0, y: this._body.cy + this._body.r * 0.55,
            width: W,
            text: `${this._tempDisplay.toFixed(1)} °C`,
            fontSize: 9, fill: this._getTempTextColor(this._tempDisplay),
            align: 'center', fontStyle: 'bold',
            fontFamily: 'Courier New',
        }));
    }

    // ── 标注 ─────────────────────────────────
    _drawLabel() {
        const W = this.width;
        this.group.add(new Konva.Text({
            x: 0, y: -16, width: W,
            text: `${this.label}  LM35DZ`,
            fontSize: 9, fontStyle: 'bold', fill: '#546e7a', align: 'center',
        }));
        this.group.add(new Konva.Text({
            x: 0, y: -6, width: W,
            text: `${this.sensitivity.toFixed(1)} mV/°C  ±0.5°C`,
            fontSize: 7, fill: '#3a5a7a', align: 'center',
            fontFamily: 'Courier New',
        }));
    }

    // ── 状态面板（右侧信息栏）───────────────
    _drawStatusPanel() {
        const W  = this.width;
        const bc = this._body;
        const panY = this._pins[0].y2 + 20;

        // 面板背景
        this._statusPanel = new Konva.Group({ x: 0, y: panY });
        this.group.add(this._statusPanel);

        this._statusPanel.add(new Konva.Rect({
            x: 4, y: 0, width: W - 8, height: 46,
            fill: '#0d1018', stroke: '#1e2a38',
            strokeWidth: 0.8, cornerRadius: 3,
        }));

        // 状态指示点
        this._statusDot = new Konva.Circle({
            x: 12, y: 8, radius: 3.5,
            fill: '#66bb6a', stroke: '#2e7d32', strokeWidth: 0.8,
            shadowColor: '#66bb6a', shadowBlur: 5, shadowOpacity: 0.8,
        });
        this._statusPanel.add(this._statusDot);

        // 文本行（后续由 _updateStatusPanel 更新）
        this._statLines = [];
        const lines = ['Tj: -- °C', 'Vout: -- mV', 'VCC: 5.0 V'];
        lines.forEach((txt, i) => {
            const t = new Konva.Text({
                x: 20, y: 2 + i * 14, width: W - 28,
                text: txt, fontSize: 7.5,
                fill: '#7aaad0', fontFamily: 'Courier New',
            });
            this._statusPanel.add(t);
            this._statLines.push(t);
        });
    }

    _updateStatusPanel() {
        if (!this._statLines) return;
        const T = this._tempDisplay;
        this._statLines[0].text(`Tj: ${T.toFixed(2)} °C`);
        this._statLines[0].fill(this._getTempTextColor(T));
        this._statLines[1].text(`Vout: ${(this._vout * 1000).toFixed(2)} mV`);
        this._statLines[2].text(`VCC: ${this.vcc.toFixed(1)} V`);

        // 状态指示颜色
        const col = T > 100 ? '#ef5350'
                  : T > 60  ? '#ffa726'
                  : T < 0   ? '#5c6bc0'
                  : '#66bb6a';
        this._statusDot.fill(col);
        this._statusDot.stroke(col);
        this._statusDot.shadowColor(col);
    }

    // ═══════════════════════════════════════════
    // ── 物理模型 ─────────────────────────────

    /** Vout 计算（精确模型）
     *  Vout = (10mV/°C) × T + 非线性修正
     *  真实 LM35 线性度 ≤ ±0.25°C，此处加入轻微二阶项
     */
    _calcVout(T) {
        const sensitivity = this.sensitivity * 1e-3;  // V/°C
        const nonlinear   = 2e-7 * T * T;              // 二阶非线性项 (V)
        const vout        = sensitivity * T + nonlinear;
        // 钳位：输出不能低于 0V（不含负温版本），不能超过 VCC-1.5V
        return Math.max(0, Math.min(vout, this.vcc - 1.5));
    }

    /** 热响应：一阶低通，τ = tauSec */
    _updateThermal(dt) {
        const tau    = this.tauSec;
        const alpha  = 1 - Math.exp(-dt / tau);
        this._tempJunction += alpha * (this._tempAmbient - this._tempJunction);

        // 自热效应：工作电流（60μA典型）× 封装热阻（约 150°C/W）
        if (this.selfHeatEnable) {
            const Iq       = 60e-6;   // A
            const Rthja    = 150;     // °C/W (TO-92 静止空气)
            const selfHeat = this.vcc * Iq * Rthja;  // ≈ 0.045°C
            this._tempJunction += selfHeat * alpha * 0.05;
        }
    }

    /** 热噪声：每 0.2s 更新一次 ±0.2°C 高斯近似噪声 */
    _updateNoise(dt) {
        this._noiseTimer += dt;
        if (this._noiseTimer >= 0.20) {
            this._noiseTimer = 0;
            if (this.noiseEnable) {
                // Box-Muller 近似
                const u1 = Math.random(), u2 = Math.random();
                const z  = Math.sqrt(-2 * Math.log(Math.max(u1, 1e-10))) * Math.cos(2 * Math.PI * u2);
                this._noiseVal = z * 0.12;  // σ=0.12°C，近似 ±0.2°C 范围
            } else {
                this._noiseVal = 0;
            }
        }
        this._tempDisplay = this._tempJunction + this._noiseVal;
        this._vout        = this._calcVout(this._tempDisplay);
    }

    /** PN 结辉光：亮度正比于温度，含轻微随机闪烁 */
    _updatePNGlow(dt, ts) {
        this._pnPhase   += dt * 3.5;
        this._ripplePhase = (this._ripplePhase + dt * 0.4) % 1;
        const T = this._tempJunction;
        const targetGlow = Math.max(0, Math.min(1, (T + 20) / 170));
        this._pnGlow += (targetGlow - this._pnGlow) * Math.min(1, dt * 2.5);
        // 轻微脉动（模拟载流子活动）
        this._pnGlow *= (0.92 + 0.08 * Math.abs(Math.sin(this._pnPhase)));
    }

    // ═══════════════════════════════════════════
    _startLoop() {
        const tick = ts => {
            if (this._lastTs !== null) {
                const dt = Math.min((ts - this._lastTs) / 1000, 0.05);
                this._tick(dt, ts);
            }
            this._lastTs = ts;
            this._animId = requestAnimationFrame(tick);
        };
        this._animId = requestAnimationFrame(tick);
    }

    _tick(dt, ts) {
        this._updateThermal(dt);
        this._updateNoise(dt);
        this._updatePNGlow(dt, ts);
        this._rebuild();
        this._updateStatusPanel();
        this._refreshCache();
    }

    // ── 颜色辅助 ─────────────────────────────

    /** 封装体颜色：-55°C=深蓝灰 → 25°C=深黑 → 100°C=深红棕 → 150°C=红 */
    _getTempBodyColor(Tnorm, lightness) {
        // Tnorm: 0(-55°C) ~ 1(150°C)
        const cold = { r: 40, g: 48, b: 72 };
        const room = { r: 28, g: 30, b: 34 };
        const hot  = { r: 80, g: 24, b: 16 };

        let r, g, b;
        if (Tnorm < 0.38) {
            const t = Tnorm / 0.38;
            r = cold.r + (room.r - cold.r) * t;
            g = cold.g + (room.g - cold.g) * t;
            b = cold.b + (room.b - cold.b) * t;
        } else {
            const t = (Tnorm - 0.38) / 0.62;
            r = room.r + (hot.r - room.r) * t;
            g = room.g + (hot.g - room.g) * t;
            b = room.b + (hot.b - room.b) * t;
        }
        r = Math.round(r * lightness);
        g = Math.round(g * lightness);
        b = Math.round(b * lightness);
        return `rgb(${r},${g},${b})`;
    }

    _getTempBodyStroke(Tnorm) {
        const cold = [60, 80, 110];
        const hot  = [140, 40, 30];
        const r = Math.round(cold[0] + (hot[0]-cold[0])*Tnorm);
        const g = Math.round(cold[1] + (hot[1]-cold[1])*Tnorm);
        const b = Math.round(cold[2] + (hot[2]-cold[2])*Tnorm);
        return `rgba(${r},${g},${b},0.70)`;
    }

    _getTempTextColor(T) {
        if (T > 100) return '#ef5350';
        if (T > 60)  return '#ffa726';
        if (T > 30)  return '#ffee58';
        if (T < 0)   return '#5c6bc0';
        return '#66bb6a';
    }

    // ═══════════════════════════════════════════
    // ── 公开 API ─────────────────────────────

    /** 设置环境温度 (°C)，触发热响应过程 */
    setTemperature(tempC) {
        this._tempAmbient = Math.max(-55, Math.min(150, tempC));
    }

    /** 立即跳变到目标温度（跳过热响应动画） */
    setTemperatureImmediate(tempC) {
        this._tempAmbient  = Math.max(-55, Math.min(150, tempC));
        this._tempJunction = this._tempAmbient;
    }

    /** 设置电源电压 */
    setVCC(v) {
        this.vcc = Math.max(4.0, Math.min(30.0, v));
    }

    /** 读取当前输出电压 (V) */
    getVout()   { return this._vout; }

    /** 读取当前结温 (°C) */
    getTemp()   { return this._tempDisplay; }

    /** 读取当前环境设定温度 (°C) */
    getAmbient() { return this._tempAmbient; }

    update(state) {
        if (typeof state === 'number') this.setTemperature(state);
        else if (state && typeof state.temp === 'number') this.setTemperature(state.temp);
        if (state && typeof state.vcc  === 'number') this.setVCC(state.vcc);
        this._refreshCache();
    }

    getConfigFields() {
        return [
            { label: '位号/名称',           key: 'label',          type: 'text'   },
            { label: '灵敏度 (mV/°C)',      key: 'sensitivity',    type: 'number' },
            { label: '初始温度 (°C)',        key: 'initTemp',       type: 'number' },
            { label: '电源电压 VCC (V)',     key: 'vcc',            type: 'number' },
            { label: '热响应时间常数 τ (s)', key: 'tauSec',         type: 'number' },
            { label: '热噪声模拟 (1=开)',    key: 'noiseEnable',    type: 'number' },
            { label: '自热效应 (1=开)',      key: 'selfHeatEnable', type: 'number' },
        ];
    }

    onConfigUpdate(cfg) {
        this.label          = cfg.label          || this.label;
        this.sensitivity    = parseFloat(cfg.sensitivity)    || this.sensitivity;
        this.vcc            = parseFloat(cfg.vcc)            || this.vcc;
        this.tauSec         = parseFloat(cfg.tauSec)         || this.tauSec;
        this.noiseEnable    = !!parseInt(cfg.noiseEnable);
        this.selfHeatEnable = !!parseInt(cfg.selfHeatEnable);
        if (cfg.initTemp !== undefined) this.setTemperature(parseFloat(cfg.initTemp));
        this.config = { ...this.config, ...cfg };
        this._refreshCache();
    }

    destroy() {
        if (this._animId) { cancelAnimationFrame(this._animId); this._animId = null; }
        super.destroy?.();
    }
}