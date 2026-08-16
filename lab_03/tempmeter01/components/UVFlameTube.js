import { BaseComponent } from './BaseComponent.js';

/**
 * 紫外线火焰探测管仿真组件
 * （UV Flame Detector Tube — Boiler Flame Detection）
 *
 * ── 器件说明 ──────────────────────────────────────────────────
 *
 *  紫外线火焰探测管（UV Tube）是一种充气式光电管，专用于工业
 *  锅炉、燃烧器的火焰监测与熄火保护，由以下部分组成：
 *
 *  1. 玻璃/石英外壳（Envelope）
 *     - 材质：紫外透射石英玻璃（截止波长 < 185 nm）
 *     - 外形：圆柱形管，典型尺寸 φ10×40mm（端窗式）
 *     - 充填气体：氩气（Ar）或氖氩混合气，压力约 100 mmHg
 *
 *  2. 阴极（Cathode，K）
 *     - 材质：镍基底 + 金属氟化物（MgF₂ / CsI）光电发射膜
 *     - 形态：圆筒形或平板形，包围/正对阳极
 *     - 作用：吸收 UV 光子 → 光电效应 → 发射光电子
 *
 *  3. 阳极（Anode，A）
 *     - 材质：镍丝或镍网，位于管轴线位置
 *     - 作用：收集阴极发射的光电子，形成阳极电流
 *
 *  4. UV 透射窗口（UV Window）
 *     - 位于管端，正对火焰方向
 *     - 对 185~260 nm 紫外线透射率 > 70%
 *     - 对可见光及红外不响应（抗干扰）
 *
 *  5. 引脚（Pin）：两引脚（K/A），从管底部密封引出
 *
 * ── 工作原理（光电效应 + 气体放电）──────────────────────────
 *
 *  正常燃烧（有火焰）：
 *    ① 火焰辐射的 UV（185~260 nm）穿过石英窗口射入管内
 *    ② UV 光子轰击阴极 → 光电效应 → 阴极发射光电子
 *    ③ 光电子在阳极高压（约 +200 V）电场下加速
 *    ④ 高速电子与充填气体（Ar）碰撞 → 雪崩电离 → 气体放电
 *    ⑤ 管内产生紫蓝色辉光放电（Glow Discharge）
 *    ⑥ 阳极回路产生脉冲电流（I ≈ 50~500 μA），触发燃烧控制器
 *
 *  熄火（无火焰）：
 *    ① 无 UV 输入 → 无光电子 → 无气体放电
 *    ② 管内暗态，阳极电流为 0（漏电流 < 1 nA）
 *    ③ 燃烧控制器检测到电流消失 → 输出熄火信号 → 关闭燃料阀
 *
 *  抗干扰特性：
 *    - 仅响应 UV（< 260 nm），不响应可见光与红外
 *    - 对白炽灯、阳光（有大气过滤）不误动
 *    - 典型响应时间：< 0.5 s（探测），< 1 s（熄火保护）
 *
 * ── 仿真动画 ──────────────────────────────────────────────────
 *
 *  状态一：无火焰（Dark / No Flame）
 *    - 管内完全暗态，无辉光
 *    - 阳极电流 = 0，输出信号 LOW
 *    - 状态指示灯：红色（熄火报警）
 *
 *  状态二：检测到火焰（Flame Detected）
 *    触发动画序列（正弦缓动，持续性循环）：
 *    ① UV 光子束从窗口端射入（紫色箭头射线，持续闪烁）
 *    ② 阴极表面光电子发射（蓝白粒子从阴极逸出）
 *    ③ 光电子在电场加速（粒子轨迹向阳极弯曲）
 *    ④ 气体碰撞雪崩（管内扩散紫蓝辉光，强度随机脉动）
 *    ⑤ 管外阳极回路电流箭头（显示输出电流方向）
 *    - 阳极电流读数：实时显示（μA）
 *    - 状态指示灯：绿色脉冲闪烁（有火焰）
 *
 *  点击组件：切换有焰/无焰状态（模拟火焰投切）
 *
 * ── 视角说明 ──────────────────────────────────────────────────
 *
 *  纵向布局（管轴水平），左端为 UV 窗口（朝向火焰），
 *  右端为引脚底座。管内结构半透明叠加显示。
 *
 * ── 端口 ─────────────────────────────────────────────────────
 *  pin_k  — 阴极 K（左引脚）
 *  pin_a  — 阳极 A（右引脚）
 */
export class UVFlameTube extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.width  = Math.max(200, config.width  || 260);
        this.height = Math.max(140, config.height || 180);

        this.type    = 'uv_flame_tube';
        this.special = 'none';
        this.cache   = 'fixed';

        // ── 器件参数 ──
        this.label       = config.label      || 'UV';     // 位号
        this.model       = config.model      || 'UV-Tron';// 型号
        this.anodeVoltage= config.anodeV     || 200;      // V，阳极工作电压
        this.peakWave    = config.peakWave   || 220;      // nm，峰值响应波长
        this.iMax        = config.iMax       || 500;      // μA，最大阳极电流

        // ── 状态 ──
        this._flameOn    = config.initFlame  || false;    // 当前是否检测到火焰
        this._animating  = false;
        this._animDir    = 1;           // +1 点火，-1 熄火
        this._animT      = 0;
        this._animDur    = config.animDur || 0.40;        // s，状态切换过渡时长

        // 持续运行的粒子动画相位（有焰时持续更新）
        this._glowPhase  = 0;           // 辉光脉动相位（rad）
        this._glowAmp    = 0;           // 辉光当前强度 0~1
        this._targetGlow = 0;           // 目标辉光强度

        // 光电子粒子（{ x, y, vx, vy, alpha, trail[] }）
        this._electrons  = [];
        this._eTimer     = 0;

        // UV 光子射线（{ phase, alpha }）
        this._uvRays     = [];
        this._uvTimer    = 0;

        // 放电脉冲（{ t, x, y, r, alpha }）
        this._discharges = [];
        this._disTimer   = 0;

        // 操作计数
        this.opsCount    = config.initOps || 0;


        // ── 几何尺寸（所有坐标相对组件左上角）──
        const W = this.width, H = this.height;

        // 管体（水平圆柱，横向布局）
        this._tubeX  = W * 0.05;
        this._tubeY  = H * 0.20;
        this._tubeW  = W * 0.78;
        this._tubeH  = H * 0.38;
        this._tubeCx = this._tubeX + this._tubeW / 2;
        this._tubeCy = this._tubeY + this._tubeH / 2;

        // UV 窗口（左端圆形端面）
        this._winCx  = this._tubeX + 4;
        this._winCy  = this._tubeCy;
        this._winRx  = this._tubeH * 0.40;
        this._winRy  = this._tubeH * 0.50;

        // 阴极圆筒（管内，紧贴内壁，覆盖管长 70%）
        this._katX   = this._tubeX + this._tubeW * 0.08;
        this._katW   = this._tubeW * 0.68;
        this._katH   = this._tubeH * 0.74;
        this._katY   = this._tubeCy - this._katH / 2;

        // 阳极丝（管轴线，居中细线）
        this._anX    = this._tubeX + this._tubeW * 0.10;
        this._anW    = this._tubeW * 0.64;
        this._anY    = this._tubeCy;

        // 底座（管右端，引脚支撑）
        this._baseX  = this._tubeX + this._tubeW - 2;
        this._baseY  = H * 0.14;
        this._baseW  = W * 0.16;
        this._baseH  = H * 0.50;

        // 引脚（从底座右侧引出，垂直向下）
        this._pinKX  = this._baseX + this._baseW * 0.30;
        this._pinAX  = this._baseX + this._baseW * 0.70;
        this._pinTopY= this._baseY + this._baseH;
        this._pinBotY= H * 0.96;
        this._pinW   = W * 0.030;

        this._init();

        // 端口
        this.addPort(this._pinKX, this._pinBotY + 2, 'pin_k', 'wire', 'K');
        this.addPort(this._pinAX, this._pinBotY + 2, 'pin_a', 'wire', 'A');
    }

    // ═══════════════════════════════════════════
    _init() {
        this._drawMountingBase();     // 静态：安装底座（金属固定件）
        this._drawTubeBody();         // 静态：石英玻璃管外壳
        this._drawUVWindow();         // 静态：UV 透射窗口（左端面）
        this._drawInternalStructure();// 静态：阴极筒 + 阳极丝（半透明）
        this._drawPinBase();          // 静态：引脚底座（陶瓷封口）
        this._drawPins();             // 静态：引脚 K / A
        this._drawFlameLayer();       // 动态层①：UV光子 + 辉光放电
        this._drawElectronLayer();    // 动态层②：光电子粒子
        this._drawTubeFront();        // 静态前景：管体高光 + 轮廓（覆盖动态层）
        this._drawLabel();
        this._drawStatusIndicator();
        
    }

    // ── 安装底座（外部金属固定环）────────────────────────────
    _drawMountingBase() {
        const tx = this._tubeX, ty = this._tubeY;
        const tw = this._tubeW, th = this._tubeH;

        // 安装环（两个，分布在管长 1/4 和 3/4 处）
        [0.25, 0.72].forEach(frac => {
            const rx = tx + tw * frac;
            const rW = tw * 0.06;
            this.group.add(new Konva.Rect({
                x: rx - rW / 2, y: ty - 4,
                width: rW, height: th + 8,
                fillLinearGradientStartPoint: { x: 0, y: 0 },
                fillLinearGradientEndPoint:   { x: rW, y: 0 },
                fillLinearGradientColorStops: [
                    0,   '#4a4a50',
                    0.4, '#8a8a92',
                    0.6, '#9a9aa2',
                    1,   '#4a4a50',
                ],
                stroke: '#3a3a40', strokeWidth: 0.8,
                cornerRadius: 2,
                shadowColor: '#000', shadowBlur: 3, shadowOffsetY: 1, shadowOpacity: 0.25,
            }));
            // 安装螺钉（环两侧）
            [ty - 1, ty + th + 1].forEach(sy => {
                this.group.add(new Konva.Circle({
                    x: rx, y: sy, radius: 2.5,
                    fill: '#707078', stroke: '#505058', strokeWidth: 0.5,
                }));
                this.group.add(new Konva.Line({
                    points: [rx - 1.5, sy, rx + 1.5, sy],
                    stroke: '#404048', strokeWidth: 0.8, lineCap: 'round',
                }));
            });
        });
    }

    // ── 石英玻璃管外壳（主体）────────────────────────────────
    _drawTubeBody() {
        const x = this._tubeX, y = this._tubeY;
        const w = this._tubeW, h = this._tubeH;

        // 管体阴影
        this.group.add(new Konva.Rect({
            x: x + 2, y: y + 4, width: w, height: h,
            fill: 'rgba(0,0,0,0.30)', cornerRadius: h / 2,
        }));
        // 管体主体（石英玻璃：冷灰色透明感）
        this.group.add(new Konva.Rect({
            x, y, width: w, height: h,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint:   { x: 0, y: h },
            fillLinearGradientColorStops: [
                0,    'rgba(160,170,195,0.55)',
                0.18, 'rgba(200,210,230,0.30)',
                0.50, 'rgba(120,130,160,0.18)',
                0.82, 'rgba(80,90,120,0.28)',
                1,    'rgba(50,60,90,0.50)',
            ],
            stroke: '#6a7090', strokeWidth: 1,
            cornerRadius: h * 0.12,
        }));
    }

    // ── UV 透射窗口（左端椭圆端面）──────────────────────────
    _drawUVWindow() {
        const cx = this._winCx, cy = this._winCy;
        const rx = this._winRx, ry = this._winRy;

        // 窗口端面（石英，紫色调，表示 UV 透射）
        this.group.add(new Konva.Ellipse({
            x: cx, y: cy, radiusX: rx, radiusY: ry,
            fillRadialGradientStartPoint:  { x: 0, y: 0 },
            fillRadialGradientEndPoint:    { x: 0, y: 0 },
            fillRadialGradientStartRadius: 0,
            fillRadialGradientEndRadius:   Math.max(rx, ry),
            fillRadialGradientColorStops: [
                0,   'rgba(180,150,220,0.35)',
                0.6, 'rgba(120,100,180,0.20)',
                1,   'rgba(60,50,110,0.55)',
            ],
            stroke: '#7060a0', strokeWidth: 1.2,
        }));
        // 窗口高光（左上角弧形反光）
        this.group.add(new Konva.Arc({
            x: cx - rx * 0.20, y: cy - ry * 0.25,
            innerRadius: rx * 0.35, outerRadius: rx * 0.55,
            angle: 70, rotation: -140,
            fill: 'rgba(220,210,255,0.30)',
        }));
        // "UV" 文字标注（窗口中心）
        this.group.add(new Konva.Text({
            x: cx - 8, y: cy - 6,
            text: 'UV', fontSize: 8, fontStyle: 'bold',
            fill: 'rgba(200,180,255,0.75)',
        }));
    }

    // ── 内部结构（阴极筒 + 阳极丝，半透明）──────────────────
    _drawInternalStructure() {
        // 阴极圆筒（镍基底 + 发射膜，深色圆管轮廓）
        this.group.add(new Konva.Rect({
            x: this._katX, y: this._katY,
            width: this._katW, height: this._katH,
            fill: 'rgba(60,70,100,0.25)',
            stroke: 'rgba(100,120,180,0.50)', strokeWidth: 1,
            cornerRadius: this._katH * 0.08,
            dash: [4, 3],
        }));
        // 阴极标注
        this.group.add(new Konva.Text({
            x: this._katX + 2, y: this._katY - 12,
            text: 'K（阴极）', fontSize: 7, fill: '#8090b8',
        }));

        // 阳极丝（轴线中央，细线）
        this.group.add(new Konva.Line({
            points: [this._anX, this._anY, this._anX + this._anW, this._anY],
            stroke: 'rgba(200,180,100,0.60)', strokeWidth: 1.2,
            lineCap: 'round', dash: [3, 2],
        }));
        // 阳极标注
        this.group.add(new Konva.Text({
            x: this._anX + this._anW * 0.35, y: this._anY + 5,
            text: 'A（阳极）', fontSize: 7, fill: '#c8b870',
        }));

        // 电场线（阴极→阳极方向，4根，虚线弧形）
        const fieldCount = 4;
        for (let i = 0; i < fieldCount; i++) {
            const fy = this._katY + this._katH * (i + 1) / (fieldCount + 1);
            const dy = fy - this._anY;
            // 抛物线近似：用二次贝塞尔曲线
            const mx = this._anX + this._anW * 0.50;
            this.group.add(new Konva.Path({
                data: `M ${this._katX + 2},${fy} Q ${mx},${fy - dy * 0.40} ${this._anX + this._anW * 0.55},${this._anY + (i % 2 === 0 ? 1 : -1)}`,
                fill: 'none',
                stroke: 'rgba(130,150,200,0.20)',
                strokeWidth: 0.6,
                dash: [2, 3],
            }));
        }
    }

    // ── 引脚底座（陶瓷封口，右端）───────────────────────────
    _drawPinBase() {
        const x = this._baseX, y = this._baseY;
        const w = this._baseW, h = this._baseH;

        // 底座阴影
        this.group.add(new Konva.Rect({
            x: x + 2, y: y + 3, width: w, height: h,
            fill: 'rgba(0,0,0,0.28)', cornerRadius: 3,
        }));
        // 陶瓷底座（米白色）
        this.group.add(new Konva.Rect({
            x, y, width: w, height: h,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint:   { x: w, y: 0 },
            fillLinearGradientColorStops: [
                0,   '#a09080',
                0.3, '#d8cfc0',
                0.6, '#e4dbd0',
                0.8, '#c8c0b0',
                1,   '#9a9080',
            ],
            stroke: '#7a7060', strokeWidth: 1,
            cornerRadius: 3,
        }));
        // 底座顶面高光
        this.group.add(new Konva.Rect({
            x: x + 2, y: y + 2, width: w - 4, height: h * 0.15,
            fill: 'rgba(255,255,255,0.20)', cornerRadius: [2, 2, 0, 0],
        }));
        // 管-底座连接处金属环
        this.group.add(new Konva.Rect({
            x: x - 4, y: this._tubeY - 2,
            width: 6, height: this._tubeH + 4,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint:   { x: 6, y: 0 },
            fillLinearGradientColorStops: [
                0, '#505058', 0.5, '#909098', 1, '#505058',
            ],
            stroke: '#3a3a40', strokeWidth: 0.5,
        }));
    }

    // ── 引脚（两根，K 和 A）─────────────────────────────────
    _drawPins() {
        const topY = this._pinTopY, botY = this._pinBotY;
        const pW   = this._pinW;

        const pins = [
            { x: this._pinKX, label: 'K', col: '#ef9a9a' },
            { x: this._pinAX, label: 'A', col: '#90caf9' },
        ];
        pins.forEach(({ x: px, label, col }) => {
            // 引脚主体（镀锡铜）
            this.group.add(new Konva.Rect({
                x: px - pW / 2, y: topY,
                width: pW, height: botY - topY,
                fillLinearGradientStartPoint: { x: 0, y: 0 },
                fillLinearGradientEndPoint:   { x: pW, y: 0 },
                fillLinearGradientColorStops: [
                    0, '#6a6a70', 0.3, '#b0b0b8', 0.6, '#c8c8d0', 1, '#6a6a70',
                ],
                stroke: '#505058', strokeWidth: 0.5,
            }));
            // 引脚顶部焊接点
            this.group.add(new Konva.Rect({
                x: px - pW * 1.2, y: topY - 2,
                width: pW * 2.4, height: 5,
                fill: '#909098', stroke: '#686870', strokeWidth: 0.5, cornerRadius: 1,
            }));
            // 端子标注
            this.group.add(new Konva.Text({
                x: px - 5, y: botY + 3,
                text: label, fontSize: 9, fontStyle: 'bold', fill: col,
            }));
        });
    }

    // ── 动态层①：UV 光子 + 管内辉光放电 ────────────────────
    _drawFlameLayer() {
        this._flameGroup = new Konva.Group();
        this.group.add(this._flameGroup);
        this._rebuildFlameLayer();
    }

    _rebuildFlameLayer() {
        this._flameGroup.destroyChildren();
        const glow = this._glowAmp;   // 0~1
        if (glow < 0.01) return;

        // ── 管内辉光（紫蓝色，脉动）──
        const ix = this._katX + 2;
        const iw = this._katW - 4;
        const iy = this._katY + 2;
        const ih = this._katH - 4;

        // 辉光基底（渐变矩形，填满阴极内腔）
        const glR = Math.round(80  + glow * 60);
        const glG = Math.round(60  + glow * 40);
        const glB = Math.round(180 + glow * 70);
        this._flameGroup.add(new Konva.Rect({
            x: ix, y: iy, width: iw, height: ih,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint:   { x: 0, y: ih },
            fillLinearGradientColorStops: [
                0,   `rgba(${glR},${glG},${glB},${glow * 0.12})`,
                0.5, `rgba(${glR},${glG},${glB},${glow * 0.28})`,
                1,   `rgba(${glR},${glG},${glB},${glow * 0.12})`,
            ],
            cornerRadius: ih * 0.05,
        }));

        // 辉光核心（阳极丝周围最亮）
        const coreAlpha = glow * 0.55;
        this._flameGroup.add(new Konva.Ellipse({
            x: this._anX + this._anW * 0.50,
            y: this._anY,
            radiusX: iw * 0.38,
            radiusY: ih * 0.32,
            fillRadialGradientStartPoint:  { x: 0, y: 0 },
            fillRadialGradientEndPoint:    { x: 0, y: 0 },
            fillRadialGradientStartRadius: 0,
            fillRadialGradientEndRadius:   iw * 0.40,
            fillRadialGradientColorStops: [
                0,   `rgba(200,180,255,${coreAlpha})`,
                0.4, `rgba(140,100,220,${coreAlpha * 0.55})`,
                1,   `rgba(80,60,160,0)`,
            ],
        }));

        // 放电脉冲闪烁斑（随机小亮斑）
        this._discharges.forEach(d => {
            this._flameGroup.add(new Konva.Circle({
                x: d.x, y: d.y, radius: d.r,
                fill: `rgba(220,200,255,${d.alpha * glow})`,
                shadowColor: `rgba(180,140,255,0.8)`,
                shadowBlur: d.r * 2,
                shadowOpacity: d.alpha * glow * 0.6,
            }));
        });

        // ── UV 光子射线（从窗口射入，紫色箭头）──
        this._uvRays.forEach(ray => {
            const rayAlpha = ray.alpha * glow;
            if (rayAlpha < 0.01) return;
            const startX = this._winCx + this._winRx * 0.6;
            const endX   = this._katX + this._katW * ray.phase;
            const rayY   = this._tubeCy + (ray.yOff * this._katH * 0.35);
            // 射线主体
            this._flameGroup.add(new Konva.Line({
                points: [startX, rayY, endX, rayY],
                stroke: `rgba(180,130,255,${rayAlpha})`,
                strokeWidth: 0.8 + ray.alpha * 0.6,
                lineCap: 'round',
                dash: [4, 3],
            }));
            // 箭头尖端
            this._flameGroup.add(new Konva.Line({
                points: [endX - 5, rayY - 3, endX, rayY, endX - 5, rayY + 3],
                stroke: `rgba(200,160,255,${rayAlpha * 0.8})`,
                strokeWidth: 0.8, lineCap: 'round', lineJoin: 'round',
            }));
        });

        // ── 管外：阳极电流输出指示（两引脚间虚线弧）──
        if (glow > 0.25) {
            const arcAlpha = Math.min(1, (glow - 0.25) / 0.30) * 0.65;
            const arcY     = this._pinBotY + 14;
            this._flameGroup.add(new Konva.Line({
                points: [
                    this._pinKX, this._pinBotY - 4,
                    this._pinKX, arcY,
                    this._pinAX, arcY,
                    this._pinAX, this._pinBotY - 4,
                ],
                stroke: `rgba(160,220,255,${arcAlpha})`,
                strokeWidth: 1.2, lineCap: 'round', lineJoin: 'round',
            }));
            // 电流方向箭头（K→A方向，从A引脚向上，表示电子流）
            this._flameGroup.add(new Konva.Line({
                points: [
                    this._pinAX - 3, arcY - 5,
                    this._pinAX,     arcY - 10,
                    this._pinAX + 3, arcY - 5,
                ],
                stroke: `rgba(160,220,255,${arcAlpha})`,
                strokeWidth: 1.2, lineCap: 'round', lineJoin: 'round',
            }));
            // 电流值标注
            const iDisp = (this.iMax * glow).toFixed(0);
            this._flameGroup.add(new Konva.Text({
                x: (this._pinKX + this._pinAX) / 2 - 16,
                y: arcY + 3,
                text: `${iDisp} μA`,
                fontSize: 7, fontStyle: 'bold',
                fill: `rgba(160,220,255,${arcAlpha})`,
            }));
        }
    }

    // ── 动态层②：光电子粒子（阴极→阳极轨迹）──────────────
    _drawElectronLayer() {
        this._electronGroup = new Konva.Group();
        this.group.add(this._electronGroup);
        this._rebuildElectronLayer();
    }

    _rebuildElectronLayer() {
        this._electronGroup.destroyChildren();
        const glow = this._glowAmp;
        if (glow < 0.05) return;

        this._electrons.forEach(e => {
            const alpha = e.alpha * glow;
            // 拖尾
            if (e.trail.length > 1) {
                for (let i = 1; i < e.trail.length; i++) {
                    const ta = alpha * (i / e.trail.length) * 0.45;
                    this._electronGroup.add(new Konva.Line({
                        points: [e.trail[i-1].x, e.trail[i-1].y, e.trail[i].x, e.trail[i].y],
                        stroke: `rgba(160,200,255,${ta})`,
                        strokeWidth: 0.8, lineCap: 'round',
                    }));
                }
            }
            // 粒子本体
            this._electronGroup.add(new Konva.Circle({
                x: e.x, y: e.y, radius: 1.8,
                fill: `rgba(180,210,255,${alpha})`,
                shadowColor: 'rgba(140,180,255,0.9)',
                shadowBlur: 4, shadowOpacity: alpha * 0.7,
            }));
        });
    }

    // ── 管体前景（高光 + 边框，覆盖动态层）──────────────────
    _drawTubeFront() {
        const x = this._tubeX, y = this._tubeY;
        const w = this._tubeW, h = this._tubeH;

        // 管顶高光条（玻璃镜面反射）
        this.group.add(new Konva.Rect({
            x: x + h * 0.12, y: y + h * 0.06,
            width: w - h * 0.24, height: h * 0.14,
            fill: 'rgba(220,230,255,0.22)',
            cornerRadius: h * 0.07,
        }));
        // 管底暗影条
        this.group.add(new Konva.Rect({
            x: x + h * 0.12, y: y + h * 0.80,
            width: w - h * 0.24, height: h * 0.14,
            fill: 'rgba(0,0,20,0.20)',
            cornerRadius: h * 0.07,
        }));
        // 管体外轮廓（覆盖确保边框清晰）
        this.group.add(new Konva.Rect({
            x, y, width: w, height: h,
            fill: 'transparent',
            stroke: '#6a7090', strokeWidth: 1,
            cornerRadius: h * 0.12,
        }));
    }

    // ── 位号 + 规格标注 ────────────────────────────────────
    _drawLabel() {
        const W = this.width;
        this.group.add(new Konva.Text({
            x: 0, y: -16, width: W,
            text: `${this.label}  ${this.model}  ${this.peakWave}nm  +${this.anodeVoltage}V`,
            fontSize: 9, fontStyle: 'bold', fill: '#546e7a', align: 'center',
        }));
    }

    // ── 状态指示（管体右下方）────────────────────────────────
    _drawStatusIndicator() {
        const ix = this._tubeX + this._tubeW * 0.60;
        const iy = this._tubeY + this._tubeH + 8;

        const on  = this._flameOn;
        const col  = on ? '#66bb6a' : '#ef5350';
        const scol = on ? '#2e7d32' : '#c62828';
        const text = on ? '有焰' : '无焰';

        this._statusDot = new Konva.Circle({
            x: ix, y: iy, radius: 4,
            fill: col, stroke: scol, strokeWidth: 0.8,
            shadowColor: col,
            shadowBlur: on ? 7 : 2,
            shadowOpacity: 0.85,
        });
        this._statusText = new Konva.Text({
            x: ix + 7, y: iy - 5,
            text, fontSize: 8, fontStyle: 'bold', fill: col,
        });
        this.group.add(this._statusDot, this._statusText);
    }

    // ── 点击切换有焰/无焰 ─────────────────────────────────
    _bindInteraction() {
        this.group.on('click tap', () => this.toggle());
        this.group.listening(true);
    }

    // ═══════════════════════════════════════════
    // 集中化 tick（由 consys._tickAll 在 20fps 调用）
    tick(dt) {
        this._tickAnimation(dt);
    }
    _tickAnimation(dt) {
        // ── 辉光强度平滑过渡 ──
        this._targetGlow = this._flameOn ? 1.0 : 0.0;
        const diff = this._targetGlow - this._glowAmp;
        if (Math.abs(diff) > 0.001) {
            // 点火快（0.4s），熄火较快（0.3s）
            const rate = this._flameOn ? 1 / 0.40 : 1 / 0.30;
            this._glowAmp += diff * Math.min(1, rate * dt);
        }

        // ── 辉光脉动相位 ──
        this._glowPhase += dt * 6.5;    // 约 1 Hz 脉动

        // 脉动调制（±8%）
        const pulseMod = 1.0 + 0.08 * Math.sin(this._glowPhase);
        const glow     = Math.max(0, Math.min(1, this._glowAmp * pulseMod));

        const active = glow > 0.02;

        // ── UV 光子射线 ──
        if (active) {
            this._uvTimer += dt;
            if (this._uvTimer > 0.12) {
                this._uvTimer = 0;
                this._uvRays.push({
                    phase: 0.20 + Math.random() * 0.60,
                    yOff:  (Math.random() - 0.5) * 2,
                    alpha: 0.6 + Math.random() * 0.4,
                    life:  0,
                    dur:   0.25 + Math.random() * 0.20,
                });
            }
            this._uvRays = this._uvRays.filter(r => {
                r.life += dt;
                r.alpha = (1 - r.life / r.dur) * (0.6 + Math.random() * 0.4);
                return r.life < r.dur;
            });
        } else {
            this._uvRays = [];
        }

        // ── 光电子粒子 ──
        if (active) {
            this._eTimer += dt;
            const spawnRate = 0.04 + (1 - glow) * 0.06;
            if (this._eTimer > spawnRate) {
                this._eTimer = 0;
                // 从阴极随机位置逸出
                const ey = this._katY + Math.random() * this._katH;
                const ex = this._katX + Math.random() * this._katW * 0.25;
                this._electrons.push({
                    x: ex, y: ey,
                    // 向阳极（管轴线）方向漂移 + 纵向加速
                    vx: 28 + Math.random() * 24,          // px/s，向右向阳极
                    vy: (this._anY - ey) * (3.5 + Math.random() * 2.5),
                    alpha: 0.7 + Math.random() * 0.3,
                    trail: [],
                });
            }
            this._electrons = this._electrons.filter(e => {
                // 记录拖尾（最多 5 点）
                e.trail.push({ x: e.x, y: e.y });
                if (e.trail.length > 5) e.trail.shift();

                e.x     += e.vx * dt;
                e.y     += e.vy * dt;
                e.vy    *= (1 - dt * 4);   // 纵向阻尼（趋向阳极后减速）
                e.alpha -= dt * 1.8;
                return e.alpha > 0
                    && e.x < this._anX + this._anW * 0.92
                    && e.y > this._katY && e.y < this._katY + this._katH;
            });
        } else {
            this._electrons = [];
        }

        // ── 放电脉冲闪烁斑 ──
        if (active) {
            this._disTimer += dt;
            if (this._disTimer > 0.06 + Math.random() * 0.08) {
                this._disTimer = 0;
                const dx = this._anX + Math.random() * this._anW * 0.80;
                const dy = this._katY + Math.random() * this._katH;
                this._discharges.push({
                    x: dx, y: dy,
                    r: 2 + Math.random() * 4,
                    alpha: 0.5 + Math.random() * 0.5,
                    life: 0, dur: 0.08 + Math.random() * 0.10,
                });
            }
            this._discharges = this._discharges.filter(d => {
                d.life  += dt;
                d.alpha  = (1 - d.life / d.dur);
                return d.life < d.dur;
            });
        } else {
            this._discharges = [];
        }

        // ── 重建动态层 ──
        // 将实际辉光强度（含脉动）传给绘制层
        this._glowAmp = glow;
        this._rebuildFlameLayer();
        this._rebuildElectronLayer();
        this._updateStatus();
        this._refreshCache();
        // 恢复平滑值（去掉脉动的）
        this._glowAmp = Math.max(0, Math.min(1,
            this._flameOn
                ? this._glowAmp / pulseMod
                : this._glowAmp / pulseMod
        ));
    }

    _updateStatus() {
        const on   = this._flameOn;
        const glow = this._glowAmp;

        // 指示灯：脉动闪烁（有焰时随辉光强度跳动）
        const dotCol  = on ? `rgba(102,187,106,${0.6 + glow * 0.4})`  : '#ef5350';
        const dotSCol = on ? '#2e7d32' : '#c62828';
        const dotBlur = on ? 4 + glow * 8 : 2;
        const dotText = on ? '有焰' : '无焰';

        if (this._statusDot) {
            this._statusDot.fill(dotCol);
            this._statusDot.stroke(dotSCol);
            this._statusDot.shadowColor(dotCol);
            this._statusDot.shadowBlur(dotBlur);
        }
        if (this._statusText) {
            this._statusText.text(dotText);
            this._statusText.fill(on ? '#66bb6a' : '#ef5350');
        }
    }

    // ═══════════════════════════════════════════
    /** 切换有焰/无焰状态（模拟火焰投切） */
    toggle() {
        this._flameOn = !this._flameOn;
        this.opsCount++;
        this._refreshCache();
    }

    /** 模拟检测到火焰（点火） */
    flameOn() {
        if (this._flameOn) return;
        this._flameOn = true;
        this.opsCount++;
        this._refreshCache();
    }

    /** 模拟熄火 */
    flameOff() {
        if (!this._flameOn) return;
        this._flameOn = false;
        this.opsCount++;
        this._refreshCache();
    }

    /** 是否检测到火焰 */
    hasFlame()    { return this._flameOn; }

    /** 当前阳极电流（μA，仿真值） */
    getAnodeCurrent() { return this._flameOn ? this.iMax * this._glowAmp : 0; }

    isAnimating() { return this._glowAmp > 0.01 && !this._flameOn; }
    getOpsCount() { return this.opsCount; }

    update(state) {
        if (typeof state === 'boolean') {
            state ? this.flameOn() : this.flameOff();
        }
        this._refreshCache();
    }

    getConfigFields() {
        return [
            { label: '位号/名称',         key: 'label',     type: 'text'   },
            { label: '型号',              key: 'model',     type: 'text'   },
            { label: '阳极电压 (V)',       key: 'anodeV',    type: 'number' },
            { label: '峰值响应波长 (nm)',  key: 'peakWave',  type: 'number' },
            { label: '最大阳极电流 (μA)', key: 'iMax',      type: 'number' },
            { label: '初始有焰（1=有）',  key: 'initFlame', type: 'number' },
            { label: '过渡时间 (s)',       key: 'animDur',   type: 'number' },
        ];
    }

    onConfigUpdate(cfg) {
        if (cfg.label     !== undefined) this.label        = cfg.label;
        if (cfg.model     !== undefined) this.model        = cfg.model;
        if (cfg.anodeV    !== undefined) this.anodeVoltage = parseFloat(cfg.anodeV)    || this.anodeVoltage;
        if (cfg.peakWave  !== undefined) this.peakWave     = parseFloat(cfg.peakWave)  || this.peakWave;
        if (cfg.iMax      !== undefined) this.iMax         = parseFloat(cfg.iMax)      || this.iMax;
        if (cfg.animDur   !== undefined) this._animDur     = parseFloat(cfg.animDur)   || this._animDur;
        if (cfg.initFlame !== undefined) {
            const want = !!parseInt(cfg.initFlame);
            if (want !== this._flameOn) this.toggle();
        }
        this.config = { ...this.config, ...cfg };
        // 重建静态层（型号/参数变化需重绘标注）
        this.group.destroyChildren();
        this._statusDot  = null;
        this._statusText = null;
        this._init();
        this._refreshCache();
    }

    destroy() {
        super.destroy?.();
    }
}