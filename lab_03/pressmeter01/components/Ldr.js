import { BaseComponent } from './BaseComponent.js';

/**
 * 光敏电阻仿真组件
 * （LDR — Light Dependent Resistor / Photoresistor）
 *
 * ── 结构说明 ──────────────────────────────────────────────────
 *
 *  光敏电阻是一种利用光电导效应制成的无极性电阻型传感器，
 *  由以下部分组成：
 *
 *  1. 陶瓷基底（Ceramic Substrate）：白色氧化铝底板，提供绝缘支撑
 *  2. 光敏层（Photosensitive Layer）：硫化镉（CdS）或硫化铅（PbS）
 *     薄膜，沉积在陶瓷基底表面，呈梳齿状（蛇形）图案
 *     - 蛇形（Serpentine）路径：增大感光面积，提高灵敏度
 *     - 材料：CdS（可见光，峰值约 540nm）/ PbS（近红外）
 *  3. 金属电极（Metal Electrode）：两侧梳齿状金属（金/铜），
 *     收集光电导层产生的自由载流子
 *  4. 封装帽（Epoxy Dome / Window）：透明环氧树脂透镜状帽，
 *     聚光并保护光敏层，顶部有聚光凸起
 *  5. 引脚（Lead）：两根镀锡铜线，焊接于陶瓷底部两侧端子
 *
 * ── 工作原理 ──────────────────────────────────────────────────
 *
 *  暗态（Dark State）：
 *    光敏层中自由载流子极少，电阻率极高，
 *    典型暗阻 Rdark ≈ 1 MΩ（本仿真默认值）
 *
 *  受光（Illuminated State）：
 *    光子激发半导体产生电子-空穴对（光电导效应），
 *    自由载流子浓度↑ → 电导率↑ → 电阻↓
 *    典型亮阻 Rlight ≈ 1~10 kΩ（视照度而定）
 *
 *  光照特性曲线（双对数坐标近似线性）：
 *    R = Rdark × (Ev / Ev0)^(-γ)
 *    其中 γ ≈ 0.7~0.9（光谱灵敏度指数），Ev0 = 1 lux 参考照度
 *
 *  响应时间：上升 ~10ms（亮→暗约 100ms），有惰性（温度相关）
 *
 * ── 仿真动画 ──────────────────────────────────────────────────
 *
 *  拖动"光照强度"滑块（或调用 setIlluminance()）：
 *  1. 封装帽内光晕颜色与亮度随照度实时变化（暗→蓝白→黄白）
 *  2. 蛇形光敏层颜色随电阻值变化（高阻=深棕，低阻=亮橙）
 *  3. 电阻读数实时更新（kΩ / MΩ 自动换算）
 *  4. 引脚间电场线动画（可选，照度变化时短暂出现）
 *  5. 光子粒子从顶部落入封装帽（照度 > 100 lux 时显示）
 *
 *  电阻值计算：
 *    frac = Ev / Ev_max（归一化照度，0~1）
 *    R(Ω) = Rdark × exp(−γ × frac × ln(Rdark / Rlight))
 *
 * ── 视角说明 ──────────────────────────────────────────────────
 *
 *  正视图（Front View），封装帽朝上，引脚朝下。
 *  陶瓷基底侧视剖面可见内部蛇形光敏层结构（半透明叠加）。
 *
 * ── 端口 ─────────────────────────────────────────────────────
 *  terminal_a — A 端（左引脚底部）
 *  terminal_b — B 端（右引脚底部）
 */
export class LDR extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.width  = Math.max(100, config.width  || 130);
        this.height = Math.max(140, config.height || 180);

        this.type    = 'resistor';
        this.special = 'light';
        this.cache   = 'fixed';

        // ── 器件参数 ──
        this.label      = config.label      || 'RG';    // 位号
        this.material   = config.material   || 'CdS';   // 光敏材料
        this.rDark      = config.rDark      || 1e6;     // Ω，暗阻（默认 1 MΩ）
        this.rLight     = config.rLight     || 2e3;     // Ω，最大照度时阻值（默认 2 kΩ）
        this.gamma      = config.gamma      || 0.80;    // 光照特性指数

        // ── 光照状态 ──
        this._illuminance  = config.initEv || 0;        // lux，当前照度
        this._evMax        = config.evMax  || 1000;     // lux，仿真最大照度
        this.currentResistance   = this.rDark;                // Ω，当前电阻

        // 动画
        this._animating    = false;
        this._animT        = 0;
        this._animDur      = config.animDur || 0.5;     // s
        this._evFrom       = 0;
        this._evTo         = 0;

        // 光子粒子列表（{ x, y, vy, alpha }）
        this._photons      = [];
        this._photonTimer  = 0;

        // 操作计数
        this.opsCount      = config.initOps || 0;


        // ── 几何尺寸 ──
        const W = this.width, H = this.height;

        // 封装帽（椭圆形透明帽，顶部）
        this._domeCx  = W * 0.50;
        this._domeCy  = H * 0.28;
        this._domeRx  = W * 0.36;
        this._domeRy  = H * 0.22;

        // 陶瓷基底（封装帽下方矩形体）
        this._bodyX   = W * 0.14;
        this._bodyY   = H * 0.46;
        this._bodyW   = W * 0.72;
        this._bodyH   = H * 0.22;

        // 蛇形光敏层区域（陶瓷基底内）
        this._snakeX  = this._bodyX + this._bodyW * 0.08;
        this._snakeY  = this._bodyY + this._bodyH * 0.12;
        this._snakeW  = this._bodyW * 0.84;
        this._snakeH  = this._bodyH * 0.76;

        // 引脚（两根，从基底底部延伸）
        this._pinAX   = W * 0.32;
        this._pinBX   = W * 0.68;
        this._pinTopY = this._bodyY + this._bodyH;
        this._pinBotY = H * 0.96;
        this._pinW    = W * 0.038;

        this._init();

        // 端口：两根引脚底部
        this.addPort(this._pinAX, this._pinBotY + 2, 'terminal_a', 'wire', 'A');
        this.addPort(this._pinBX, this._pinBotY + 2, 'terminal_b', 'wire', 'B');
    }

    // ═══════════════════════════════════════════
    _init() {
        this._drawBody();           // 静态：陶瓷基底 + 封装帽轮廓
        this._drawPins();           // 静态：引脚
        this._drawLightLayer();     // 动态层：光晕 + 光子
        this._drawSnakeLayer();     // 动态层：蛇形光敏层
        this._drawDomeFront();      // 静态：封装帽前景（轮廓 + 高光，覆盖在光晕之上）
        this._drawLabel();
        this._drawStatusIndicator();
        
    }

    // ── 陶瓷基底 + 封装帽底层（静态背景）──────────────────
    _drawBody() {
        const W = this.width;

        // ── 封装帽底层（暗色背景椭圆，用于遮挡帽内内容之外区域）──
        this.group.add(new Konva.Ellipse({
            x: this._domeCx, y: this._domeCy,
            radiusX: this._domeRx + 1, radiusY: this._domeRy + 1,
            fill: '#1a1a20', stroke: '#2a2a30', strokeWidth: 0,
        }));

        // ── 陶瓷基底主体（白色氧化铝，带立体感）──
        // 阴影
        this.group.add(new Konva.Rect({
            x: this._bodyX + 2, y: this._bodyY + 3,
            width: this._bodyW, height: this._bodyH,
            fill: 'rgba(0,0,0,0.30)', cornerRadius: 3,
        }));
        // 主体
        this.group.add(new Konva.Rect({
            x: this._bodyX, y: this._bodyY,
            width: this._bodyW, height: this._bodyH,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint:   { x: 0, y: this._bodyH },
            fillLinearGradientColorStops: [
                0,   '#e8e4dc',
                0.3, '#f0ece4',
                0.7, '#e4e0d8',
                1,   '#d8d4cc',
            ],
            stroke: '#b0a898', strokeWidth: 1,
            cornerRadius: 3,
        }));
        // 顶面高光
        this.group.add(new Konva.Rect({
            x: this._bodyX + 3, y: this._bodyY + 2,
            width: this._bodyW - 6, height: this._bodyH * 0.18,
            fill: 'rgba(255,255,255,0.40)',
            cornerRadius: [2, 2, 0, 0],
        }));
        // 两侧金属电极条（黄铜/金色，梳齿总线）
        [this._bodyX + 2, this._bodyX + this._bodyW - 6].forEach(ex => {
            this.group.add(new Konva.Rect({
                x: ex, y: this._bodyY + 2,
                width: 4, height: this._bodyH - 4,
                fillLinearGradientStartPoint: { x: 0, y: 0 },
                fillLinearGradientEndPoint:   { x: 4, y: 0 },
                fillLinearGradientColorStops: [
                    0,   '#7a6820',
                    0.4, '#d4b040',
                    0.7, '#c0a030',
                    1,   '#7a6820',
                ],
                cornerRadius: 1,
            }));
        });
    }

    // ── 引脚（两根镀锡铜引线）──────────────────────────────
    _drawPins() {
        const topY = this._pinTopY, botY = this._pinBotY;
        const pW   = this._pinW;

        [this._pinAX, this._pinBX].forEach((px, i) => {
            // 引脚主体（银灰色镀锡）
            this.group.add(new Konva.Rect({
                x: px - pW / 2, y: topY,
                width: pW, height: botY - topY,
                fillLinearGradientStartPoint: { x: 0, y: 0 },
                fillLinearGradientEndPoint:   { x: pW, y: 0 },
                fillLinearGradientColorStops: [
                    0,   '#6a6a70',
                    0.3, '#b0b0b8',
                    0.6, '#c8c8d0',
                    1,   '#6a6a70',
                ],
                stroke: '#505058', strokeWidth: 0.5,
            }));
            // 引脚弯折处倒角（与基底衔接）
            this.group.add(new Konva.Rect({
                x: px - pW * 1.2, y: topY - 2,
                width: pW * 2.4, height: 5,
                fill: '#909098', stroke: '#686870', strokeWidth: 0.5,
                cornerRadius: 1,
            }));
            // 端子标注
            this.group.add(new Konva.Text({
                x: px - 6, y: botY + 3,
                text: i === 0 ? 'A' : 'B',
                fontSize: 8, fontStyle: 'bold',
                fill: i === 0 ? '#ef9a9a' : '#90caf9',
            }));
        });
    }

    // ── 动态层①：帽内光晕 + 光子粒子 ─────────────────────
    _drawLightLayer() {
        this._lightGroup = new Konva.Group();
        this.group.add(this._lightGroup);
        this._rebuildLightLayer();
    }

    _rebuildLightLayer() {
        this._lightGroup.destroyChildren();
        const frac = this._evFrac();

        if (frac < 0.005) return;   // 完全暗态，不绘制

        const cx = this._domeCx, cy = this._domeCy;
        const rx = this._domeRx - 2, ry = this._domeRy - 2;

        // 光晕强度：低照度→冷蓝白，高照度→暖黄白
        const rC = Math.round(180 + frac * 70);
        const gC = Math.round(200 + frac * 50);
        const bC = Math.round(255);
        const alpha = 0.10 + frac * 0.55;

        // 主光晕（径向渐变椭圆）
        this._lightGroup.add(new Konva.Ellipse({
            x: cx, y: cy,
            radiusX: rx, radiusY: ry,
            fillRadialGradientStartPoint:  { x: 0, y: -ry * 0.2 },
            fillRadialGradientEndPoint:    { x: 0, y: -ry * 0.2 },
            fillRadialGradientStartRadius: 0,
            fillRadialGradientEndRadius:   Math.max(rx, ry),
            fillRadialGradientColorStops: [
                0,   `rgba(${rC},${gC},${bC},${alpha})`,
                0.5, `rgba(${rC},${gC},${bC},${alpha * 0.55})`,
                1,   `rgba(${rC},${gC},${bC},0)`,
            ],
        }));

        // 强光时叠加一层亮白核心
        if (frac > 0.40) {
            const cAlpha = (frac - 0.40) / 0.60 * 0.50;
            this._lightGroup.add(new Konva.Ellipse({
                x: cx, y: cy - ry * 0.15,
                radiusX: rx * 0.45, radiusY: ry * 0.38,
                fill: `rgba(255,255,240,${cAlpha})`,
            }));
        }

        // 光子粒子（从顶部落入，照度 > 200 lux = frac > 0.20）
        if (frac > 0.20) {
            this._photons.forEach(ph => {
                const pAlpha = ph.alpha * frac;
                this._lightGroup.add(new Konva.Circle({
                    x: ph.x, y: ph.y,
                    radius: 1.5 + ph.alpha * 1.5,
                    fill: `rgba(255,240,180,${pAlpha})`,
                    shadowColor: 'rgba(255,220,100,0.8)',
                    shadowBlur: 3,
                }));
            }
            );
        }
    }

    // ── 动态层②：蛇形光敏层 ────────────────────────────────
    _drawSnakeLayer() {
        this._snakeGroup = new Konva.Group();
        this.group.add(this._snakeGroup);
        this._rebuildSnakeLayer();
    }

    _rebuildSnakeLayer() {
        this._snakeGroup.destroyChildren();
        const frac = this._evFrac();

        // 颜色：高阻（暗）= 深棕，低阻（亮）= 亮橙黄
        const r = Math.round(100 + frac * 155);
        const g = Math.round(60  + frac * 120);
        const b = Math.round(20  + frac * 10);
        const snakeCol  = `rgb(${r},${g},${b})`;
        const glowAlpha = frac * 0.50;

        const x0 = this._snakeX, y0 = this._snakeY;
        const sw = this._snakeW, sh = this._snakeH;

        // 蛇形路径（7条竖线 + 6个 U 形弯折）
        const cols   = 7;
        const colW   = sw / (cols - 1);
        const lineW  = Math.max(1.5, sw * 0.040);
        const pts    = [];

        for (let c = 0; c < cols; c++) {
            const xc = x0 + c * colW;
            if (c % 2 === 0) {
                // 从上到下
                pts.push({ x: xc, y: y0 });
                pts.push({ x: xc, y: y0 + sh });
            } else {
                // 从下到上
                pts.push({ x: xc, y: y0 + sh });
                pts.push({ x: xc, y: y0 });
            }
        }

        // 用折线绘制蛇形（Konva.Line，tension=0 确保直角）
        const flatPts = pts.flatMap(p => [p.x, p.y]);
        // 蛇形发光外晕
        if (frac > 0.05) {
            this._snakeGroup.add(new Konva.Line({
                points: flatPts,
                stroke: `rgba(${r},${g},${b},${glowAlpha})`,
                strokeWidth: lineW + 4,
                lineCap: 'square', lineJoin: 'round',
                tension: 0,
            }));
        }
        // 蛇形主体
        this._snakeGroup.add(new Konva.Line({
            points: flatPts,
            stroke: snakeCol,
            strokeWidth: lineW,
            lineCap: 'square', lineJoin: 'round',
            tension: 0,
        }));

        // 弯折圆弧（U形转角，增加真实感）
        for (let c = 0; c < cols - 1; c++) {
            const xc   = x0 + c * colW;
            const xn   = xc + colW;
            const yArc = (c % 2 === 0) ? y0 + sh : y0;   // 底部或顶部弯折
            this._snakeGroup.add(new Konva.Arc({
                x: (xc + xn) / 2, y: yArc,
                innerRadius: 0,
                outerRadius: colW / 2,
                angle: 180,
                rotation: (c % 2 === 0) ? 0 : 180,
                fill: snakeCol,
            }));
        }

        // 两侧电极梳齿（从竖线伸出，模拟交指电极）
        const toothCount = 4;
        const toothLen   = sw * 0.06;
        const toothW     = lineW * 0.7;
        for (let t = 0; t < toothCount; t++) {
            const ty = y0 + sh * (t + 0.5) / toothCount;
            // 左侧梳齿（A极）
            this._snakeGroup.add(new Konva.Line({
                points: [x0, ty, x0 + toothLen, ty],
                stroke: `rgba(180,150,40,0.70)`, strokeWidth: toothW, lineCap: 'round',
            }));
            // 右侧梳齿（B极）
            this._snakeGroup.add(new Konva.Line({
                points: [x0 + sw - toothLen, ty, x0 + sw, ty],
                stroke: `rgba(180,150,40,0.70)`, strokeWidth: toothW, lineCap: 'round',
            }));
        }
    }

    // ── 封装帽前景（覆盖动态层，保持帽形轮廓清晰）──────────
    _drawDomeFront() {
        const cx = this._domeCx, cy = this._domeCy;
        const rx = this._domeRx, ry = this._domeRy;

        // 帽体轮廓（透明填充 + 边框）
        this.group.add(new Konva.Ellipse({
            x: cx, y: cy, radiusX: rx, radiusY: ry,
            fill: 'rgba(200,220,255,0.08)',
            stroke: '#7090b0', strokeWidth: 1.2,
        }));
        // 帽底边（与陶瓷基底的连接线）
        this.group.add(new Konva.Line({
            points: [cx - rx, cy, cx + rx, cy],
            stroke: '#506880', strokeWidth: 1,
        }));
        // 顶部聚光凸起（小椭圆，模拟镜头突起）
        this.group.add(new Konva.Ellipse({
            x: cx, y: cy - ry * 0.82,
            radiusX: rx * 0.22, radiusY: ry * 0.12,
            fill: 'rgba(200,230,255,0.18)',
            stroke: '#8aaccc', strokeWidth: 0.8,
        }));
        // 帽左侧高光弧（镜面反射感）
        this.group.add(new Konva.Arc({
            x: cx, y: cy,
            innerRadius: rx * 0.65, outerRadius: rx * 0.68,
            angle: 55, rotation: -165,
            fill: 'rgba(255,255,255,0.22)',
        }));
        // 帽右下内侧暗影（增加球面感）
        this.group.add(new Konva.Arc({
            x: cx + rx * 0.10, y: cy + ry * 0.05,
            innerRadius: rx * 0.72, outerRadius: rx * 0.78,
            angle: 80, rotation: 20,
            fill: 'rgba(0,0,0,0.12)',
        }));
    }

    // ── 位号 + 参数标注 ────────────────────────────────────
    _drawLabel() {
        const W = this.width;
        // 位号
        this.group.add(new Konva.Text({
            x: 0, y: -16, width: W,
            text: `${this.label}  ${this.material}  LDR`,
            fontSize: 9, fontStyle: 'bold', fill: '#546e7a', align: 'center',
        }));
        // 暗阻/亮阻标注（基底下方）
        this.group.add(new Konva.Text({
            x: 0, y: this._bodyY + this._bodyH + 2,
            width: W,
            text: `${this._fmtR(this.rDark)} ～ ${this._fmtR(this.rLight)}`,
            fontSize: 7, fill: '#6a7a84', align: 'center',
        }));
    }

    // ── 状态指示（陶瓷基底左下角）──────────────────────────
    _drawStatusIndicator() {
        const ix = this._bodyX + 6;
        const iy = this._bodyY + this._bodyH * 0.50;
        const frac = this._evFrac();

        this._statusDot = new Konva.Circle({
            x: ix, y: iy, radius: 3.5,
            fill: this._ledColor(frac),
            stroke: this._ledStroke(frac),
            strokeWidth: 0.7,
            shadowColor: this._ledColor(frac),
            shadowBlur: frac > 0.05 ? 5 : 1,
            shadowOpacity: 0.8,
        });
        this._statusText = new Konva.Text({
            x: ix + 6, y: iy - 5,
            text: this._evLabel(frac),
            fontSize: 7, fontStyle: 'bold',
            fill: this._ledColor(frac),
        });
        // 当前电阻读数
        this._readout = new Konva.Text({
            x: this._bodyX, y: iy - 5,
            width: this._bodyW,
            text: this._fmtR(this.currentResistance),
            fontSize: 9, fontStyle: 'bold',
            fill: this._ledColor(frac),
            align: 'center',
        });
        this.group.add(this._statusDot, this._statusText, this._readout);
    }

    // ── 点击交互（切换预设照度档位）──────────────────────────
    _bindInteraction() {
        this.group.on('click tap', () => this.stepIlluminance());
        this.group.listening(true);
    }

    // ═══════════════════════════════════════════
    // 集中化 tick（由 consys._tickAll 在 20fps 调用）
    tick(dt) {
        this._tickAnimation(dt);
    }
    _tickAnimation(dt) {
        let needRefresh = false;

        // ── 照度变化动画 ──
        if (this._animating) {
            this._animT += dt / this._animDur;
            if (this._animT >= 1) {
                this._animT       = 1;
                this._animating   = false;
                this._illuminance = this._evTo;
            }
            const ease         = 0.5 - 0.5 * Math.cos(this._animT * Math.PI);
            this._illuminance  = this._evFrom + (this._evTo - this._evFrom) * ease;
            this.currentResistance   = this._calcResistance(this._illuminance);
            needRefresh = true;
        }

        // ── 光子粒子动画（持续运行，照度 > 阈值时激活）──
        const frac = this._evFrac();
        if (frac > 0.20) {
            // 生成新光子
            this._photonTimer += dt;
            const spawnInterval = 0.06 + (1 - frac) * 0.10;
            if (this._photonTimer > spawnInterval) {
                this._photonTimer = 0;
                const spawnX = this._domeCx + (Math.random() - 0.5) * this._domeRx * 1.4;
                this._photons.push({
                    x:     spawnX,
                    y:     this._domeCy - this._domeRy * 0.70,
                    vy:    18 + Math.random() * 20,  // px/s
                    alpha: 0.4 + Math.random() * 0.6,
                });
            }
            // 更新光子位置，移除越界粒子
            this._photons = this._photons.filter(ph => {
                ph.y += ph.vy * dt;
                ph.alpha -= dt * 1.2;
                return ph.alpha > 0 && ph.y < this._bodyY + this._bodyH;
            });
            needRefresh = true;
        } else {
            this._photons = [];
        }

        if (needRefresh || frac > 0.20) {
            this._rebuildLightLayer();
            this._rebuildSnakeLayer();
            this._updateStatus();
            this._refreshCache();
        }
    }

    _updateStatus() {
        const frac = this._evFrac();
        const col  = this._ledColor(frac);
        const sc   = this._ledStroke(frac);

        if (this._statusDot) {
            this._statusDot.fill(col);
            this._statusDot.stroke(sc);
            this._statusDot.shadowColor(col);
            this._statusDot.shadowBlur(frac > 0.05 ? 5 : 1);
        }
        if (this._statusText) {
            this._statusText.text(this._evLabel(frac));
            this._statusText.fill(col);
        }
        if (this._readout) {
            this._readout.text(this._fmtR(this.currentResistance));
            this._readout.fill(col);
        }
    }

    // ── 辅助：归一化照度 ─────────────────────────────────────
    _evFrac() {
        return Math.max(0, Math.min(1, this._illuminance / this._evMax));
    }

    // ── 辅助：计算当前电阻（对数插值）──────────────────────
    _calcResistance(ev) {
        if (ev <= 0) return this.rDark;
        const frac = Math.min(1, ev / this._evMax);
        // R = Rdark × (Rlight/Rdark)^frac  （对数线性插值）
        return this.rDark * Math.pow(this.rLight / this.rDark, Math.pow(frac, this.gamma));
    }

    // ── 辅助：格式化电阻值 ────────────────────────────────────
    _fmtR(ohm) {
        if (ohm >= 1e6)      return `${(ohm / 1e6).toFixed(2)} MΩ`;
        if (ohm >= 1e3)      return `${(ohm / 1e3).toFixed(1)} kΩ`;
        return `${Math.round(ohm)} Ω`;
    }

    // ── 辅助：指示灯颜色 ─────────────────────────────────────
    _ledColor(frac) {
        if (frac >= 0.70) return '#ffd740';   // 强光：金黄
        if (frac >= 0.30) return '#80cbc4';   // 中等：青色
        if (frac >= 0.05) return '#90caf9';   // 弱光：蓝色
        return '#546e7a';                      // 暗态：暗灰
    }
    _ledStroke(frac) {
        if (frac >= 0.70) return '#f9a825';
        if (frac >= 0.30) return '#00897b';
        if (frac >= 0.05) return '#1565c0';
        return '#2e454f';
    }
    _evLabel(frac) {
        if (frac >= 0.70) return '强光';
        if (frac >= 0.30) return '中光';
        if (frac >= 0.05) return '弱光';
        return '暗态';
    }

    // ═══════════════════════════════════════════
    /**
     * 设置目标照度（lux），带动画过渡
     * @param {number} ev  目标照度（lux）
     */
    setIlluminance(ev) {
        const target = Math.max(0, Math.min(this._evMax, ev));
        if (Math.abs(target - this._illuminance) < 0.1) return;
        this._evFrom    = this._illuminance;
        this._evTo      = target;
        this._animT     = 0;
        this._animating = true;
        this.opsCount++;
        this._refreshCache();
    }

    /**
     * 点击切换预设照度档位
     * 档位循环：0 → 100 → 300 → 600 → 1000 → 0 lux
     */
    stepIlluminance() {
        if (this._animating) return;
        const steps = [0, 100, 300, 600, 1000];
        const cur   = this._illuminance;
        const next  = steps.find(s => s > cur + 1) ?? 0;
        this.setIlluminance(next);
    }

    /** 设置为完全暗态 */
    dark()    { this.setIlluminance(0); }

    /** 设置为满量程光照 */
    bright()  { this.setIlluminance(this._evMax); }

    /** 当前照度（lux） */
    getIlluminance()  { return this._illuminance; }

    /** 当前电阻值（Ω） */
    getResistance()   { return this.currentResistance; }

    /** 当前电阻值（格式化字符串） */
    getResistanceStr(){ return this._fmtR(this.currentResistance); }

    isAnimating()     { return this._animating; }
    getOpsCount()     { return this.opsCount; }

    update(state) {
        if (typeof state === 'number') {
            this.setIlluminance(state);
        }
        this._refreshCache();
    }

    getConfigFields() {
        return [
            { label: '位号/名称',         key: 'label',       type: 'text'   },
            { label: '光敏材料',          key: 'material',    type: 'text'   },
            { label: '暗阻 (Ω)',          key: 'rDark',       type: 'number' },
            { label: '亮阻 (Ω)',          key: 'rLight',      type: 'number' },
            { label: '灵敏度指数 γ',      key: 'gamma',       type: 'number' },
            { label: '最大照度 (lux)',    key: 'evMax',       type: 'number' },
            { label: '初始照度 (lux)',    key: 'initEv',      type: 'number' },
            { label: '动作时间 (s)',      key: 'animDur',     type: 'number' },
        ];
    }

    onConfigUpdate(cfg) {
        if (cfg.label    !== undefined) this.label    = cfg.label;
        if (cfg.material !== undefined) this.material = cfg.material;
        if (cfg.rDark    !== undefined) this.rDark    = parseFloat(cfg.rDark)    || this.rDark;
        if (cfg.rLight   !== undefined) this.rLight   = parseFloat(cfg.rLight)   || this.rLight;
        if (cfg.gamma    !== undefined) this.gamma    = parseFloat(cfg.gamma)    || this.gamma;
        if (cfg.evMax    !== undefined) this._evMax   = parseFloat(cfg.evMax)    || this._evMax;
        if (cfg.animDur  !== undefined) this._animDur = parseFloat(cfg.animDur)  || this._animDur;
        if (cfg.initEv   !== undefined) {
            const ev = parseFloat(cfg.initEv);
            if (!isNaN(ev)) this.setIlluminance(ev);
        }
        this.config = { ...this.config, ...cfg };
        // 重建静态层（材料/暗亮阻变化需重绘标注）
        this.group.destroyChildren();
        this._statusDot  = null;
        this._statusText = null;
        this._readout    = null;
        this._init();
        this._refreshCache();
    }

    destroy() {
        super.destroy?.();
    }
}