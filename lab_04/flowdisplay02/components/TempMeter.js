import { BaseComponent } from './BaseComponent.js';

export class TempMeter extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);
        this.cache = 'fixed';
        this._initGroups();
        this.radius = config.radius || 70;
        this.textRadius = this.radius - 22;
        // ✔ 船舶仪表标准：270°,这里采用-120° ~ +120°，240度
        this.startAngle = -120;
        this.endAngle = 120;
        this.min = 0;
        this.max = 120;
        this.value = 0;
        this.title = '温度表℃';

        // ── 毛细管传输时间常数 ──
        this._delaySec  = config.capDelay || 2.0;   // 压力传输时间常数（秒）

        this.init();
    }

    init() {
        // 顺序非常关键（从底到顶）
        this._drawShell();
        this._drawPipe();  //温度表引出的一段感温管
        this._drawZones();
        this._drawTicks();
        this._drawPointer();
        this._drawCenter();
        this._drawLcd();
        this._drawname();
    }
    /* ===============================
       数值 → 角度（唯一映射）
    =============================== */
    valueToAngle(value) {
        const ratio = (value - this.min) / (this.max - this.min);
        return this.startAngle + ratio * (this.endAngle - this.startAngle);
    }
    /* ===============================
       仪表外框
    =============================== */
    _drawShell() {
        this._staticGroup.add(new Konva.Circle({
                x: 0,
                y: 0,
                radius: this.radius + 6,
                stroke: '#333',
                strokeWidth: 4,
                // 金属质感：径向渐变
                fillRadialGradientStartPoint: { x: -20, y: -20 },
                fillRadialGradientStartRadius: 0,
                fillRadialGradientEndPoint: { x: 20, y: 20 },
                fillRadialGradientEndRadius: this.radius + 10,
                fillRadialGradientColorStops: [0, '#ffffff', 0.5, '#d0d6da', 1, '#9aa1a5']
            })
        );
    }

    /**
     * 绘制感温包系统（长弯曲毛细管 + 末端感温包）
     * 结构：表壳底部 → 感温管 → 弯曲毛细管(S-路径) → 感温包
     */
    _drawPipe() {
        const r = this.radius;

        // ── 毛细管路径控制点（从表壳出口蜿蜒到感温包）──
        // 每个点 { x, y }，相对组件原点（表盘中心）
        const pathPts = [
            { x: 0,  y: r + 18 },   // P0: 表壳出口
            { x: 16, y: r + 36 },   // P1: 向右弯
            { x: -10,y: r + 54 },   // P2: 向左弯
            { x: 20, y: r + 72 },   // P3: 向右弯
            { x: -6, y: r + 90 },   // P4: 向左弯
            { x: 24, y: r + 108 },  // P5: 向右弯
            { x: 10, y: r + 126 },  // P6: 接近感温包
        ];
        this._capPath = pathPts;
        // 展平为 [x0,y0,x1,y1,...] 数组用于 Konva.Line
        const flatPts = pathPts.flatMap(p => [p.x, p.y]);

        // ── 毛细管总长（用于延迟计算和脉动定位）──
        let totalLen = 0;
        const segLens = [];
        for (let i = 1; i < pathPts.length; i++) {
            const dx = pathPts[i].x - pathPts[i-1].x;
            const dy = pathPts[i].y - pathPts[i-1].y;
            const seg = Math.sqrt(dx*dx + dy*dy);
            segLens.push(seg);
            totalLen += seg;
        }
        this._capTotalLen = totalLen;
        this._capSegLens  = segLens;

        // ── 感温管（金属接头，从表壳底部伸出）──
        this._tube = new Konva.Rect({
            x: -4, y: r + 4, width: 8, height: 14,
            stroke: '#555', strokeWidth: 1.2,
            fillLinearGradientStartPoint: { x: -4, y: 0 },
            fillLinearGradientEndPoint:   { x: 4, y: 0 },
            fillLinearGradientColorStops: [0, '#6a7078', 0.5, '#9aa0a8', 1, '#6a7078'],
            cornerRadius: 1,
        });
        this._staticGroup.add(this._tube);

        // ── 毛细管外壁（金属管，粗线）──
        this._capTube = new Konva.Line({
            points: flatPts,
            stroke: '#7a8288', strokeWidth: 2.8, lineCap: 'round', lineJoin: 'round',
            tension: 0.4,  // 贝塞尔平滑，让路径更自然
        });
        this._staticGroup.add(this._capTube);

        // ── 毛细管内腔（暗色背景线）──
        this._capLumen = new Konva.Line({
            points: flatPts,
            stroke: '#2a3038', strokeWidth: 1.4, lineCap: 'round', lineJoin: 'round',
            tension: 0.4,
        });
        this._staticGroup.add(this._capLumen);

        // ── 毛细管内流体色带（温度色，脉动波传播）──
        this._capFluidGroup = new Konva.Group();
        this._staticGroup.add(this._capFluidGroup);
        this._capFluidSegs = [];

        // 沿路径生成 5 个流体色块，每个覆盖一段路径
        for (let i = 0; i < 6; i++) {
            const seg = new Konva.Line({
                points: [0, 0, 0, 0],
                stroke: '#3a7ab0', strokeWidth: 1.2, lineCap: 'round',
                opacity: 0.55,
                listening: false,
            });
            this._capFluidGroup.add(seg);
            this._capFluidSegs.push(seg);
        }

        // ── 压力脉动波（光点沿路径移动）──
        this._pulseDots = [];
        for (let i = 0; i < 3; i++) {
            const dot = new Konva.Circle({
                radius: 2.5,
                fill: '#80c0ff',
                opacity: 0,
                listening: false,
            });
            this._capFluidGroup.add(dot);
            this._pulseDots.push(dot);
        }

        // ── 感温包（位于毛细管末端）──
        const last = pathPts[pathPts.length - 1];
        const bx = last.x, by = last.y + 14;  // 感温包中心在路径末端下方
        this._bulbX = bx; this._bulbY = by;
        const bR = 17;

        // 外壳（金属圆球）
        this._bulbShell = new Konva.Circle({
            x: bx, y: by, radius: bR,
            fillRadialGradientStartPoint: { x: -bR * 0.3, y: -bR * 0.3 },
            fillRadialGradientEndPoint:   { x: bR * 0.2, y: bR * 0.2 },
            fillRadialGradientStartRadius: 0,
            fillRadialGradientEndRadius: bR,
            fillRadialGradientColorStops: [0, '#d0d8e0', 0.5, '#8a9298', 1, '#505860'],
            stroke: '#3a4048', strokeWidth: 1,
            shadowColor: '#000', shadowBlur: 6, shadowOffsetY: 2, shadowOpacity: 0.3,
        });
        this._staticGroup.add(this._bulbShell);

        // ── 内部液体填充（温度色 + 液位变化）──
        this._liquidGroup = new Konva.Group({ x: bx, y: by });
        this._staticGroup.add(this._liquidGroup);

        const liqR = bR - 2.5;
        this._liquidFill = new Konva.Shape({
            sceneFunc: (ctx, shape) => {
                const fillPct = shape.getAttr('_fillPct');
                const h = liqR * 2 * fillPct;
                const topY = liqR - h;
                ctx.beginPath();
                ctx.arc(0, 0, liqR, 0, Math.PI * 2);
                ctx.clip();
                ctx.fillStyle = shape.getAttr('_colorTop');
                ctx.fillRect(-liqR, topY, liqR * 2, h);
            },
            _fillPct: 0.6,
            _colorTop: '#3a7ab0',
            fill: 'transparent',
            strokeWidth: 0,
        });
        this._liquidGroup.add(this._liquidFill);

        // 液面弯月面
        this._meniscus = new Konva.Line({
            points: [-liqR * 0.7, 0, liqR * 0.7, 0],
            stroke: 'rgba(255,255,255,0.25)',
            strokeWidth: 1.0, lineCap: 'round',
        });
        this._liquidGroup.add(this._meniscus);

        // 球内高光
        this._bulbHighlight = new Konva.Ellipse({
            x: bx - bR * 0.25, y: by - bR * 0.28,
            radiusX: bR * 0.32, radiusY: bR * 0.20,
            fill: 'rgba(255,255,255,0.18)', strokeWidth: 0,
        });
        this._staticGroup.add(this._bulbHighlight);
        this._bulbRef = { bx, by, bR, liqR };

        // ── 压力波纹 ──
        this._rippleGroup = new Konva.Group({ x: bx, y: by });
        this._staticGroup.add(this._rippleGroup);
        this._ripples = [];
        for (let i = 0; i < 3; i++) {
            const ripple = new Konva.Circle({
                radius: bR + 2,
                stroke: 'rgba(100,180,255,0)',
                strokeWidth: 1.2, listening: false,
            });
            this._rippleGroup.add(ripple);
            this._ripples.push({ node: ripple, phase: i / 3 });
        }

        // ── 热晕 ──
        this._heatGlow = new Konva.Circle({
            x: bx, y: by, radius: bR * 1.6,
            fillRadialGradientStartPoint: { x: 0, y: 0 },
            fillRadialGradientEndPoint:   { x: 0, y: 0 },
            fillRadialGradientStartRadius: bR * 0.8,
            fillRadialGradientEndRadius:   bR * 1.6,
            fillRadialGradientColorStops: [0, 'rgba(255,80,20,0)', 1, 'rgba(255,80,20,0)'],
            listening: false,
        });
        this._staticGroup.add(this._heatGlow);

        // ── 压力指示标签 ──
        this._pressLabel = new Konva.Text({
            x: bx + bR + 10, y: by - 10,
            width: 80, text: '0.0 kPa',
            fontSize: 12, fill: '#4a6a8a',
            fontFamily: 'Courier New', align: 'left',
        });
        this._staticGroup.add(this._pressLabel);

        // ── 传输延迟标注 ──
        this._delayLabel = new Konva.Text({
            x: bx + bR + 10, y: by + 6,
            width: 80, text: `τ=${this._delaySec.toFixed(1)}s`,
            fontSize: 10, fill: '#5a7a8a',
            fontFamily: 'Courier New', align: 'left',
        });
        // this._staticGroup.add(this._delayLabel);

        // 动画时间累加器
        this._animTime = 0;
    }

    /**
     * 根据路径比例 [0~1] 计算路径上的坐标
     */
    _capPointAt(t) {
        const pts = this._capPath;
        if (!pts || pts.length < 2) return { x: 0, y: 0 };
        t = Math.max(0, Math.min(1, t));
        let target = t * this._capTotalLen;
        for (let i = 1; i < pts.length; i++) {
            const seg = this._capSegLens[i - 1];
            if (target <= seg) {
                const frac = target / seg;
                return {
                    x: pts[i - 1].x + (pts[i].x - pts[i - 1].x) * frac,
                    y: pts[i - 1].y + (pts[i].y - pts[i - 1].y) * frac,
                };
            }
            target -= seg;
        }
        return { x: pts[pts.length - 1].x, y: pts[pts.length - 1].y };
    }

    /**
     * 更新毛细管流体色带 + 脉动波
     */
    _updateCapillary(tempBulb, tempGauge) {
        if (!this._capPath || !this._capFluidSegs) return;

        const normBulb  = (tempBulb  - this.min) / (this.max - this.min);
        const normGauge = (tempGauge - this.min) / (this.max - this.min);

        // 流体色带：从感温包侧（bulb temp color）渐变到表头侧（gauge temp color）
        const colorAt = (n) => {
            if (n < 0.3) return `rgb(${Math.round(50 + n/0.3*40)},${Math.round(120 + n/0.3*60)},${Math.round(190 - n/0.3*20)})`;
            if (n < 0.6) return `rgb(${Math.round(90 + (n-0.3)/0.3*80)},${Math.round(180 - (n-0.3)/0.3*30)},${Math.round(170 - (n-0.3)/0.3*70)})`;
            const t = Math.min(1, (n - 0.6) / 0.4);
            return `rgb(${Math.round(170 + t*60)},${Math.round(150 - t*80)},${Math.round(100 - t*70)})`;
        };

        // 分 6 段显示从 bulb 到 gauge 的色彩渐变
        const segments = this._capFluidSegs;
        for (let i = 0; i < segments.length; i++) {
            const t0 = i / segments.length;
            const t1 = (i + 1) / segments.length;
            const p0 = this._capPointAt(t0);
            const p1 = this._capPointAt(t1);
            segments[i].points([p0.x, p0.y, p1.x, p1.y]);
            // 混合颜色：靠 bulb 侧偏向 bulbColor，靠 gauge 侧偏向 gaugeColor
            const mix = (t0 + t1) / 2;
            const n = normBulb * mix + normGauge * (1 - mix);
            segments[i].stroke(colorAt(n));
        }

        // 脉动光点：沿路径传播，显示压力波传输
        const speed = 0.15 + normBulb * 0.25;
        this._pulseDots.forEach((dot, i) => {
            const phase = ((this._animTime * speed + i * 0.33) % 1);
            const pos = this._capPointAt(phase);
            dot.x(pos.x);
            dot.y(pos.y);
            const alpha = 0.5 + 0.5 * Math.sin(phase * Math.PI * 2);
            const dotColor = colorAt(normBulb + (normGauge - normBulb) * phase);
            dot.fill(dotColor);
            dot.opacity(alpha * (0.3 + normBulb * 0.4));
            dot.radius(2 + normBulb * 1.5);
        });

        // 毛细管外壁颜色（随温度微变）
        if (this._capTube) {
            const t = Math.min(1, normBulb * 0.15);
            const r = Math.round(122 + t * 20);
            const g = Math.round(130 - t * 30);
            const b = Math.round(136 - t * 40);
            this._capTube.stroke(`rgb(${r},${g},${b})`);
        }
    }

    /**
     * 集中化 tick（由 consys._tickAll 在 20fps 调用）
     * 一阶滞后模拟毛细管压力传输 + 更新指针/LCD/波纹/毛细管
     */
    tick(dt) {
        this._animTime += dt;

        // 一阶滞后（模拟压力在毛细管中传输的平滑过渡）
        if (this._tempBulbLive !== undefined) {
            const alpha = 1 - Math.exp(-dt / this._delaySec);
            this.value += (this._tempBulbLive - this.value) * alpha;
        
        this._refreshCache();
    }

        // 更新指针
        const angle = this.valueToAngle(this.value);
        if (this.pointer) this.pointer.rotation(angle);

        // 更新 LCD
        if (this.lcdText) {
            this.lcdText.text(this.value.toFixed(1));
            this.lcdText.fill(this.value >= 100 ? '#ff4444' : '#7fff7f');
        }

        // 视觉更新
        this._updateRipples();
        this._updateCapillary(this._tempBulbLive ?? this.value, this.value);
    }

    /**
     * 更新压力波纹
     */
    _updateRipples() {
        if (!this._ripples || !this._bulbRef) return;
        const norm = (this._tempBulbLive !== undefined
            ? (this._tempBulbLive - this.min) / (this.max - this.min)
            : (this.value - this.min) / (this.max - this.min));
        const rippleSpeed = 0.8 + norm * 3.0;
        const rippleAlpha = 0.08 + norm * 0.28;
        const rippleColor = norm < 0.3
            ? `rgba(80,160,255,`
            : norm < 0.6
            ? `rgba(100,200,80,`
            : `rgba(255,120,50,`;

        this._ripples.forEach((r, i) => {
            const phase = (this._animTime * rippleSpeed + i * 1.2) % 3;
            const alpha = rippleAlpha * (1 - phase / 3);
            r.node.radius((this._bulbRef.bR || 16) + 2 + phase * 10);
            r.node.stroke(rippleColor + alpha.toFixed(3) + ')');
            r.node.opacity(alpha);
        });
    }


    /* ===============================
       安全区（绿 / 黄 / 红）
    =============================== */
    _drawZones() {
        const zones = [
            { from: 0.0, to: 0.3, color: '#397141' },
            { from: 0.3, to: 0.7, color: '#f1c40f' },
            { from: 0.7, to: 0.9, color: '#7d2c39' },
            { from: 0.9, to: 1.0, color: '#f51313' }
        ];

        zones.forEach(z => {
            const angle = (z.to - z.from) * (this.endAngle - this.startAngle);
            const rotation = this.startAngle - 90 + z.from * (this.endAngle - this.startAngle);

            this._staticGroup.add(new Konva.Arc({
                    x: 0,
                    y: 0,
                    innerRadius: this.radius - 12,
                    outerRadius: this.radius,
                    angle: angle,
                    rotation: rotation,
                    fill: z.color,
                    opacity: 0.65
                })
            );
        });
    }

    /* ===============================
       刻度（完全按数值生成）
    =============================== */
    _drawTicks() {
        const majorCount = 10; // 总共分10个大格
        const totalSteps = 20; // 总共20个小格（minorStep）
        const range = this.max - this.min;

        for (let i = 0; i <= totalSteps; i++) {
            // 通过索引计算当前数值，而不是累加
            const v = this.min + (range * i / totalSteps);
            const angle = this.valueToAngle(v);
            const rad = Konva.getAngle(angle - 90);

            const isMajor = i % (totalSteps / majorCount) === 0;
            const len = isMajor ? 16 : 8;

            // 刻度线
            this._staticGroup.add(new Konva.Line({
                    points: [
                        (this.radius - len) * Math.cos(rad),
                        (this.radius - len) * Math.sin(rad),
                        this.radius * Math.cos(rad),
                        this.radius * Math.sin(rad)
                    ],
                    stroke: '#111',
                    strokeWidth: isMajor ? 2 : 1
                })
            );

            // 主刻度数字
            if (isMajor) {
                const textRad = Konva.getAngle(angle - 90);

                this._staticGroup.add(new Konva.Text({
                        x: this.textRadius * Math.cos(textRad) - 14,
                        y: this.textRadius * Math.sin(textRad) - 6,
                        width: 28,
                        align: 'center',
                        text: v.toString(),
                        fontSize: 11,
                        fill: '#000'
                    })
                );
            }
        }
    }

    /* ===============================
       指针
    =============================== */
    _drawPointer() {
        this.pointer = new Konva.Line({
            points: [0, 0, 0, -(this.radius - 25)],
            stroke: '#c0392b',
            strokeWidth: 3,
            lineCap: 'round',
            rotation: this.startAngle
        });
        this._staticGroup.add(this.pointer);
    }
    /* ===============================
       指针的轴心点
    =============================== */
    _drawCenter() {
        this._staticGroup.add(new Konva.Circle({
                x: 0,
                y: 0,
                radius: 4,
                fill: '#333'
            })
        );
    }
    /* ===============================
       中心下方的LCD显示屏
    =============================== */
    _drawLcd() {
        const w = 70;
        const h = 24;
        const x = -w / 2;
        // 向下移动一点（原 0.38 -> 0.44）
        const y = this.radius * 0.44;

        this.lcdGroup = new Konva.Group({
            x: 0,
            y: y
        });

        // 外壳（浅金属 + 暗边）
        this.lcdGroup.add(new Konva.Rect({
            x: x,
            y: 0,
            width: w,
            height: h,
            cornerRadius: 6,
            stroke: '#333',
            strokeWidth: 1,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint: { x: 0, y: h },
            fillLinearGradientColorStops: [0, '#ececec', 0.6, '#c8c8c8', 1, '#9a9a9a']
        }));

        // 内部显示窗（绿色背光）
        this.lcdGroup.add(new Konva.Rect({
            x: x + 4,
            y: 4,
            width: w - 8,
            height: h - 8,
            cornerRadius: 4,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint: { x: 0, y: h - 8 },
            fillLinearGradientColorStops: [0, '#0b2a0b', 0.6, '#042404', 1, '#072207']
        }));

        // 数字文本（初始显示保留一位小数）
        this.lcdText = new Konva.Text({
            x: x + 4,
            y: 4,
            width: w - 8,
            align: 'center',
            text: Number(this.min).toFixed(1),
            fontSize: 14,
            fontFamily: 'monospace',
            fill: '#7fff7f'
        });
        this.lcdGroup.add(this.lcdText);

        this._staticGroup.add(this.lcdGroup);
    }
    /* ===============================
       在轴心上方显示仪表名称，this.group.name 属性
    =============================== */
    _drawname() {
        const w = 140;
        const h = 20;
        const x = -w / 2;

        // 名称上移一些，确保位于液晶屏上方且仍在轴心下方
        let y;
        if (this.lcdGroup) {
            const desired = this.lcdGroup.y() - h - 12; // 比之前上移更多，留出间隙
            y = Math.max(12, desired); // 最小为 8，确保在轴心（y=0）下方
        } else {
            y = Math.max(12, this.radius * 0.12);
        }

        this.nameText = new Konva.Text({
            x: x,
            y: y,
            width: w,
            align: 'center',
            text: String(this.title ?? ''),
            fontSize: 14,
            fontStyle: 'bold',
            fill: '#222',
            listening: false
        });

        this._staticGroup.add(this.nameText);
    }

    /**
     * 更新仪表 — 感温包瞬时响应，指针由 tick() 一阶滞后平滑
     * @param {number} temp - 当前被测温度（°C）
     */
    update(temp) {
        // ── 1. 感温包瞬时温度（用于视觉反馈）──
        const clamped = Math.max(this.min, Math.min(this.max, temp));
        this._tempBulbLive = clamped;
        const normLive = (clamped - this.min) / (this.max - this.min);

        // ── 2. 感温包液体（使用瞬时值）──
        let liqColor, liqFillPct;
        if (normLive < 0.3) {
            const t = normLive / 0.3;
            liqColor = `rgb(${Math.round(50 + t * 40)},${Math.round(120 + t * 60)},${Math.round(190 - t * 20)})`;
            liqFillPct = 0.45 + t * 0.08;
        } else if (normLive < 0.6) {
            const t = (normLive - 0.3) / 0.3;
            liqColor = `rgb(${Math.round(90 + t * 80)},${Math.round(180 - t * 30)},${Math.round(170 - t * 70)})`;
            liqFillPct = 0.53 + t * 0.08;
        } else {
            const t = Math.min(1, (normLive - 0.6) / 0.4);
            liqColor = `rgb(${Math.round(170 + t * 60)},${Math.round(150 - t * 80)},${Math.round(100 - t * 70)})`;
            liqFillPct = 0.61 + t * 0.14;
        }
        if (this._liquidFill) {
            this._liquidFill.setAttr('_fillPct', liqFillPct);
            this._liquidFill.setAttr('_colorTop', liqColor);
        }
        if (this._meniscus && this._bulbRef) {
            const { liqR } = this._bulbRef;
            this._meniscus.y(-liqR + liqR * 2 * liqFillPct);
            this._meniscus.stroke(normLive > 0.6 ? 'rgba(255,200,150,0.35)' : 'rgba(255,255,255,0.25)');
        }

        // ── 3. 感温包外壳 & 热晕（瞬时值）──
        if (this._bulbShell) {
            const t = Math.min(1, normLive * 0.25);
            this._bulbShell.fillRadialGradientColorStops([
                0, `rgb(${208 - t*30},${216 - t*40},${224 - t*50})`,
                0.5, `rgb(${138 - t*20},${146 - t*30},${152 - t*40})`,
                1, `rgb(${80 - t*10},${88 - t*20},${96 - t*30})`,
            ]);
        }
        if (this._heatGlow) {
            const glowA = Math.max(0, (normLive - 0.55) * 0.9);
            this._heatGlow.fillRadialGradientColorStops([
                0, `rgba(255,${Math.round(120 - glowA*80)},30,${glowA * 0.35})`,
                1, `rgba(255,${Math.round(120 - glowA*80)},30,0)`,
            ]);
        }

        // ── 4. 压力指示（瞬时值）──
        if (this._pressLabel) {
            const press = (normLive * 180 + 20).toFixed(1);
            const pressColor = normLive < 0.3 ? '#4a7ab8' : normLive < 0.6 ? '#5a9a40' : '#c06030';
            this._pressLabel.text(`${press} kPa`);
            this._pressLabel.fill(pressColor);
        }

        // ── 5. 感温管温变色（瞬时值）──
        if (this._tube) {
            const t = Math.min(1, normLive * 0.3);
            this._tube.fillLinearGradientColorStops([
                0, `rgb(${Math.round(106+t*20)},${Math.round(112-t*40)},${Math.round(120-t*50)})`,
                0.5, `rgb(${Math.round(86+t*20)},${Math.round(102-t*40)},${Math.round(120-t*50)})`,
                1, `rgb(${Math.round(106+t*20)},${Math.round(112-t*40)},${Math.round(120-t*50)})`,
            ]);
        }

        // 请求重绘
        if (this.sys && this.sys.layer) this.sys.layer.batchDraw();
    }

    destroy() {
        super.destroy?.();
    }

}