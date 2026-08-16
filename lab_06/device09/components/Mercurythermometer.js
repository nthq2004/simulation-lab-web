import { BaseComponent } from './BaseComponent.js';

/**
 * 水银温度计仿真组件
 * （Mercury-in-Glass Thermometer）
 *
 * ── 工作原理 ──────────────────────────────────────────────────
 *
 *  水银温度计是利用液态汞（Mercury）热膨胀性质来测量温度的
 *  经典玻璃仪器。其工作基础是汞的体积与温度呈高度线性关系：
 *
 *  ┌─────────────────────────────────────────────────────────┐
 *  │  汞的体积热膨胀系数（视膨胀）：                         │
 *  │    β_apparent ≈ 1.82 × 10⁻⁴ /°C（相对于玻璃）         │
 *  │                                                         │
 *  │  示数原理：                                             │
 *  │    ΔV_汞 = V₀ · β · ΔT                                 │
 *  │    → 液柱高度变化 = ΔV / 毛细管截面积                  │
 *  │    → 线性刻度对应温度变化                               │
 *  │                                                         │
 *  │  液柱上升：温度↑ → 汞膨胀 → 液柱在毛细管中升高        │
 *  │  液柱下降：温度↓ → 汞收缩 → 液柱在毛细管中降低        │
 *  └─────────────────────────────────────────────────────────┘
 *
 * ── 器件结构（正视图，竖立式）────────────────────────────────
 *
 *  ┌──────────────────────────────────────────────────┐
 *  │  顶部封口（Sealed Top）                           │
 *  │  ┌───┐  ← 玻璃外管（Outer Glass Tube）           │
 *  │  │   │     外径约 6~7mm，无色透明钠钙玻璃         │
 *  │  │ | │  ← 毛细管（Capillary Tube）               │
 *  │  │ | │     内径约 0.1~0.3mm，承载液柱             │
 *  │  │ | │  ← 汞液柱（Mercury Column）               │
 *  │  │▓▓▓│     银白色金属光泽，随温度升降              │
 *  │  │▓▓▓│                                           │
 *  │  │▓▓▓│  ← 刻度区域（Scale）                      │
 *  │  │▓▓▓│     左侧°C刻度，右侧°F刻度（可选）         │
 *  │  │   │     主格：10°C；中格：5°C；细格：1°C       │
 *  │  └─┬─┘                                           │
 *  │  ┌─┴─────────────────┐                          │
 *  │  │     安全球          │  ← 收缩颈（Constriction） │
 *  │  │  （Safety Bulb）   │     防止液柱倒流（体温计）  │
 *  │  └────────────────────┘                          │
 *  │  ┌─────────────────────┐                        │
 *  │  │                     │  ← 储汞球（Reservoir）   │
 *  │  │    ████████████     │     存储大量汞液，对温变   │
 *  │  │    ████████████     │     高度敏感              │
 *  │  └─────────────────────┘                        │
 *  └──────────────────────────────────────────────────┘
 *
 * ── 各部件详解 ────────────────────────────────────────────────
 *
 *  1. 储汞球（Mercury Reservoir / Bulb）
 *     - 位于温度计底部，圆柱或球形
 *     - 壁厚极薄（约 0.2mm），导热迅速
 *     - 充满液态汞（密度 13,600 kg/m³）
 *     - 工业型有金属保护套
 *
 *  2. 收缩颈（Constriction）
 *     - 毛细管在储汞球上方的极细收缩段
 *     - 体温计专用：液柱升温时可通过，降温时断开（防回流）
 *     - 普通型无此结构，液柱可双向运动
 *
 *  3. 毛细管（Capillary Tube）
 *     - 极细玻璃管，内径 0.1~0.3mm
 *     - 截面积越小，灵敏度越高（相同 ΔV → 更大 Δh）
 *     - 外管保护，内外管间充惰性气体或真空
 *
 *  4. 外保护管（Stem / Outer Tube）
 *     - 透明玻璃，兼作放大镜（截面为凸透镜形或圆形）
 *     - 正面平面→正视放大，背面圆弧→聚焦内部汞柱
 *
 *  5. 刻度线（Scale Markings）
 *     - 直接刻蚀或印刷在外管背面白色涂层上
 *     - °C 标准刻度：-10°C 到 110°C（通用型）
 *     - °F 辅助刻度（可选，对应右侧）
 *     - 精度：±0.1°C（精密型），±0.5°C（普通型）
 *
 *  6. 汞液柱（Mercury Column）
 *     - 银白色，高反射率金属光泽
 *     - 液柱顶端弯月面（Meniscus）：汞不润湿玻璃→凸弯月面
 *     - 视差误差：读数时视线需与液柱顶端齐平
 *
 *  7. 顶部封口（Sealed Top）
 *     - 真空封口或充氮气
 *     - 防止汞氧化，保证液柱自由上升
 *
 * ── 仿真精度模型 ──────────────────────────────────────────────
 *
 *  热响应：一阶低通，时间常数 τ（秒）
 *    τ_空气  ≈ 20s（静止空气，含球部）
 *    τ_液体  ≈  5s（搅拌水或油浴）
 *
 *  随机噪声：±0.05°C（读数抖动模拟）
 *  热滞后：±0.1°C（升降温路径差）
 *  分辨率：0.1°C（显示精度）
 *  体温计模式：收缩颈防回流（只升不降，需"甩"才能复位）
 *
 * ── 动画效果 ──────────────────────────────────────────────────
 *
 *  1. 汞液柱高度随温度连续变化（一阶热响应）
 *  2. 液柱顶端凸弯月面（Meniscus）精确渲染
 *  3. 储汞球随温度着色：冷→银蓝，热→银红
 *  4. 汞柱内部金属光泽流动效果（竖向渐变）
 *  5. 玻璃管壁折射高光（两侧竖向亮线）
 *  6. 收缩颈动画（体温计模式下液柱卡住不回落）
 *  7. 过量程：液柱冲顶，顶部红色闪烁警报
 *  8. 读数游标：当前温度对应的刻度线高亮显示
 *
 * ── 端口 ─────────────────────────────────────────────────────
 *  （水银温度计为纯机械仪表，无电气端口）
 *  JS 驱动接口：
 *    setTemperature(T)      — 设置被测温度（°C）
 *    getReading()           — 读取当前示数（°C）
 *    shake()                — 模拟甩表（体温计模式复位）
 *    setMode(mode)          — 'clinical'=体温计 / 'industrial'=工业型
 */
export class MercuryThermometer extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.width  = Math.max(80,  config.width  || 100);
        this.height = Math.max(380, config.height || 460);

        this.type    = 'mercury_thermometer';
        this.special = 'sensor';
        this.cache   = 'fixed';

        this._initGroups();
        // ── 参数 ──
        this.label      = config.label   || 'TT';
        this.tempMin    = config.tempMin !== undefined ? config.tempMin : -10;   // °C
        this.tempMax    = config.tempMax !== undefined ? config.tempMax : 110;   // °C
        this.showF      = config.showF   !== false;      // 是否显示华氏副刻度
        this.accuracy   = config.accuracy || 0.1;        // °C 精度
        this.tauSec     = config.tauSec   || 20;         // 热响应时间常数 s
        // 'clinical'=体温计(收缩颈防回流) / 'industrial'=工业型 / 'lab'=实验室型
        this.mode       = config.mode     || 'industrial';

        // ── 温度状态 ──
        const initT = config.initTemp !== undefined ? config.initTemp : 20;
        this._tempTarget   = initT;
        this._tempSensor   = initT;
        this._tempDisplay  = initT;
        this._noiseVal     = 0;
        this._noiseTimer   = 0;

        // 体温计模式：收缩颈锁定
        this._constrictLock = false;    // 液柱被收缩颈锁住
        this._lockedTemp    = initT;    // 锁定时的温度

        // 过量程
        this._overRange    = false;
        this._overFlash    = 0;

        // ── 几何布局 ──
        const W = this.width, H = this.height;

        // 管体中心线 X
        this._tubeCX = W * 0.50;

        // 外管尺寸
        this._stem = {
            x:  W * 0.30,
            y1: H * 0.025,   // 顶封口
            y2: H * 0.770,   // 管体底部
            w:  W * 0.40,    // 外管宽度
            rx: W * 0.20,    // 圆角（外管是椭圆截面）
        };

        // 储汞球
        this._bulb = {
            cx: W * 0.50,
            cy: H * 0.840,
            rx: W * 0.200,   // 水平半径
            ry: H * 0.060,   // 垂直半径
        };

        // 毛细管（在外管内）
        this._capillary = {
            cx: W * 0.50,
            x:  W * 0.50 - W * 0.045,
            w:  W * 0.090,
            y1: this._stem.y1 + 4,
            y2: this._stem.y2,
        };

        // 收缩颈位置（球体正上方）
        this._constriction = {
            y:  this._stem.y2 - H * 0.008,
            w:  W * 0.036,
        };

        // 刻度区域
        this._scale = {
            x:    this._stem.x - W * 0.01,
            y1:   this._stem.y1 + H * 0.04,
            y2:   this._stem.y2 - H * 0.01,
            wL:   W * 0.28,    // 左侧刻度宽（°C）
            wR:   W * 0.28,    // 右侧刻度宽（°F）
        };

        // 动画
        this._glassPhase   = 0;
        this._mercuryFlow  = 0;   // 汞液流动相位
        // （rAF 循环已迁移至 consys._tickAll）

        this._init();
    }

    // ═══════════════════════════════════════════
    _init() {
        this._drawBackground();
        this._drawStem();         // 玻璃外管（静态）
        this._drawScaleMarks();   // 刻度线（静态）

        // 动态层
        this._mercuryGroup = new Konva.Group();
        this._glassTopGroup = new Konva.Group();
        this._staticGroup.add(this._mercuryGroup);
        this._staticGroup.add(this._glassTopGroup);

        this._drawStemGlassTop();    // 玻璃管高光（置于汞之上）
        this._drawBulb();            // 储汞球（静态外壳）
        this._drawLabel();
        this._drawStatusPanel();

        this._rebuildMercury();
    }

    // ── 背景 ─────────────────────────────────
    _drawBackground() {
        const W = this.width, H = this.height;
        // 细微背景纹（象牙白衬底，仿老式温度计纸板背景）
        this._staticGroup.add(new Konva.Rect({
            x: 0, y: 0, width: W, height: H,
            fill: 'transparent',
        }));
    }

    // ── 玻璃外管（静态骨架）──────────────────
    _drawStem() {
        const s = this._stem;
        const W = this.width;

        // ── 白色刻度背板（外管背面涂层）──
        this._staticGroup.add(new Konva.Rect({
            x: s.x, y: s.y1,
            width: s.w, height: s.y2 - s.y1,
            fill: '#f2f0e8',
            cornerRadius: [W*0.20, W*0.20, W*0.06, W*0.06],
            stroke: '#c8c4b8', strokeWidth: 0.6,
        }));

        // ── 外管主体（透明玻璃，侧壁渐变）──
        // 左侧玻璃壁
        this._staticGroup.add(new Konva.Rect({
            x: s.x, y: s.y1,
            width: s.w * 0.18, height: s.y2 - s.y1,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint:   { x: s.w * 0.18, y: 0 },
            fillLinearGradientColorStops: [
                0,   'rgba(180,200,220,0.70)',
                0.5, 'rgba(220,235,245,0.45)',
                1,   'rgba(190,210,225,0.15)',
            ],
            cornerRadius: [W*0.20, 0, 0, W*0.06],
        }));
        // 右侧玻璃壁
        this._staticGroup.add(new Konva.Rect({
            x: s.x + s.w * 0.82, y: s.y1,
            width: s.w * 0.18, height: s.y2 - s.y1,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint:   { x: s.w * 0.18, y: 0 },
            fillLinearGradientColorStops: [
                0,   'rgba(190,210,225,0.15)',
                0.5, 'rgba(220,235,245,0.45)',
                1,   'rgba(180,200,220,0.70)',
            ],
            cornerRadius: [0, W*0.20, W*0.06, 0],
        }));

        // ── 顶部封口帽（圆顶）──
        this._staticGroup.add(new Konva.Ellipse({
            x: s.x + s.w/2, y: s.y1 + 4,
            radiusX: s.w/2, radiusY: W*0.10,
            fillLinearGradientStartPoint: { x: -s.w/2, y: 0 },
            fillLinearGradientEndPoint:   { x:  s.w/2, y: 0 },
            fillLinearGradientColorStops: [
                0, '#8aa8c0', 0.3, '#b8d0e4', 0.6, '#c8dcea', 0.85, '#a0bcd0', 1, '#7090a8',
            ],
            stroke: '#6080a0', strokeWidth: 0.8,
        }));
        // 顶封口高光
        this._staticGroup.add(new Konva.Ellipse({
            x: s.x + s.w * 0.38, y: s.y1 + 3,
            radiusX: s.w * 0.14, radiusY: W * 0.045,
            fill: 'rgba(255,255,255,0.35)', strokeWidth: 0,
        }));

        // ── 管体外轮廓线 ──
        this._staticGroup.add(new Konva.Rect({
            x: s.x, y: s.y1,
            width: s.w, height: s.y2 - s.y1,
            fill: 'transparent',
            cornerRadius: [W*0.20, W*0.20, W*0.06, W*0.06],
            stroke: 'rgba(100,140,180,0.50)', strokeWidth: 0.8,
        }));
    }

    // ── 玻璃管高光（覆盖在汞上方）───────────
    _drawStemGlassTop() {
        const s = this._stem, W = this.width;

        // 左侧竖向高光线
        this._glassTopGroup.add(new Konva.Line({
            points: [s.x + s.w*0.12, s.y1 + W*0.10, s.x + s.w*0.12, s.y2 - 4],
            stroke: 'rgba(255,255,255,0.30)', strokeWidth: 1.6, lineCap: 'round',
        }));
        // 右侧竖向高光线（较弱）
        this._glassTopGroup.add(new Konva.Line({
            points: [s.x + s.w*0.88, s.y1 + W*0.10, s.x + s.w*0.88, s.y2 - 4],
            stroke: 'rgba(255,255,255,0.15)', strokeWidth: 1.0, lineCap: 'round',
        }));
    }

    // ── 刻度线（静态，绘制在白色背板上）────
    _drawScaleMarks() {
        const sc   = this._scale;
        const W    = this.width;
        const span = this.tempMax - this.tempMin;

        // 计算刻度线 Y 坐标（0°C=底部，100°C=顶部）
        const tempToY = T => {
            const frac = (T - this.tempMin) / span;
            return sc.y2 - frac * (sc.y2 - sc.y1);
        };

        // ── °C 刻度（左侧）──
        for (let T = this.tempMin; T <= this.tempMax; T += 1) {
            const y     = tempToY(T);
            const isMaj = T % 10 === 0;
            const isMed = T % 5  === 0;
            const tickW  = isMaj ? sc.wL * 0.62 : isMed ? sc.wL * 0.40 : sc.wL * 0.24;
            const tickLW = isMaj ? 1.0 : isMed ? 0.7 : 0.4;
            const tickC  = isMaj ? '#1a1a1a' : isMed ? '#3a3a3a' : '#888';

            // 从左边缘往右画
            this._staticGroup.add(new Konva.Line({
                points: [sc.x - tickW, y, sc.x, y],
                stroke: tickC, strokeWidth: tickLW, lineCap: 'round',
            }));
        }

        // ── °C 数字（左侧，每10°C）──
        for (let T = this.tempMin; T <= this.tempMax; T += 10) {
            const y = tempToY(T);
            this._staticGroup.add(new Konva.Text({
                x: sc.x - sc.wL - W*0.01,
                y: y - 10,
                width: sc.wL * 0.95,
                text: String(T),
                fontSize: Math.max(7, W * 0.078),
                fill: '#1a1a1a',
                align: 'right',
                fontFamily: 'Arial, sans-serif',
                fontStyle: 'bold',
            }));
        }

        // °C 单位
        this._staticGroup.add(new Konva.Text({
            x: sc.x - sc.wL - W*0.01,
            y: sc.y1 - 20,
            width: sc.wL * 0.95,
            text: '°C',
            fontSize: Math.max(8, W * 0.085),
            fill: '#2a3a5a',
            align: 'right',
            fontFamily: 'Arial, sans-serif',
            fontStyle: 'bold',
        }));

        // ── °F 刻度（右侧）──
        if (this.showF) {
            const tMinF = this.tempMin * 9/5 + 32;
            const tMaxF = this.tempMax * 9/5 + 32;

            for (let T = this.tempMin; T <= this.tempMax; T += 1) {
                const y     = tempToY(T);
                const Tf    = T * 9/5 + 32;
                const isMaj = Tf % 20 === 0;
                const isMed = Tf % 10 === 0;
                if (!isMaj && !isMed && T % 5 !== 0) continue;  // 仅画 5°C 倍数
                const tickW  = isMaj ? sc.wR * 0.62 : isMed ? sc.wR * 0.40 : sc.wR * 0.24;
                const tickLW = isMaj ? 1.0 : isMed ? 0.7 : 0.4;
                const rx     = sc.x + this._stem.w + W*0.01;
                this._staticGroup.add(new Konva.Line({
                    points: [rx, y, rx + tickW, y],
                    stroke: isMaj ? '#444' : '#888', strokeWidth: tickLW, lineCap: 'round',
                }));
            }

            // °F 数字（每20°F）
            for (let T = this.tempMin; T <= this.tempMax; T += 1) {
                const Tf = T * 9/5 + 32;
                if (Math.abs(Tf % 20) > 0.01) continue;
                const y  = tempToY(T);
                const rx = sc.x + this._stem.w + W*0.015;
                this._staticGroup.add(new Konva.Text({
                    x: rx, y: y - 10,
                    width: sc.wR * 0.95,
                    text: String(Math.round(Tf)),
                    fontSize: Math.max(7, W * 0.078),
                    fill: '#3a3a3a',
                    align: 'left',
                    fontFamily: 'Arial, sans-serif',
                    fontStyle: 'bold',
                }));
            }

            // °F 单位
            this._staticGroup.add(new Konva.Text({
                x: sc.x + this._stem.w + W*0.015,
                y: sc.y1 - 20,
                width: sc.wR,
                text: '°F',
                fontSize: Math.max(8, W * 0.085),
                fill: '#5a2a2a',
                align: 'left',
                fontFamily: 'Arial, sans-serif',
                fontStyle: 'bold',
            }));
        }
    }

    // ── 储汞球（静态外壳）──────────────────
    _drawBulb() {
        const b = this._bulb, W = this.width;

        // 球体主体（椭圆形，玻璃壁）
        this._staticGroup.add(new Konva.Ellipse({
            x: b.cx, y: b.cy,
            radiusX: b.rx, radiusY: b.ry,
            fillRadialGradientStartPoint:  { x: -b.rx*0.3, y: -b.ry*0.3 },
            fillRadialGradientEndPoint:    { x: 0, y: 0 },
            fillRadialGradientStartRadius: 0,
            fillRadialGradientEndRadius:   Math.max(b.rx, b.ry),
            fillRadialGradientColorStops:  [
                0,   'rgba(210,225,235,0.85)',
                0.5, 'rgba(175,195,215,0.70)',
                1,   'rgba(130,160,185,0.55)',
            ],
            stroke: 'rgba(90,130,165,0.55)', strokeWidth: 0.8,
        }));
    }

    // ── 汞柱 + 球内汞（动态重绘）───────────
    _rebuildMercury() {
        this._mercuryGroup.destroyChildren();
        this._dynamicGroup.destroyChildren();

        const T       = this._getDisplayTemp();
        const span    = this.tempMax - this.tempMin;
        const frac    = Math.max(-0.02, Math.min(1.02, (T - this.tempMin) / span));
        const sc      = this._scale;
        const cap     = this._capillary;
        const b       = this._bulb;
        const s       = this._stem;
        const W       = this.width;

        // 液柱顶端 Y 坐标
        const mercuryTopY = sc.y2 - frac * (sc.y2 - sc.y1);
        const mercuryBotY = this._stem.y2;

        this._overRange = (T > this.tempMax + span*0.02) || (T < this.tempMin - span*0.02);
        if (this._overRange) this._overFlash += 0.016;

        // ── 毛细管内汞柱 ──
        if (mercuryTopY < mercuryBotY - 2) {
            const capW = cap.w;
            const capX = cap.cx - capW / 2;

            // 汞柱主体（银白金属渐变，含流动效果）
            const flowOff = (this._mercuryFlow % 1) * (mercuryBotY - mercuryTopY);
            const g1 = new Konva.Shape({
                sceneFunc: (ctx, shape) => {
                    const x  = capX, y  = mercuryTopY;
                    const hw = capW / 2, h = mercuryBotY - mercuryTopY;
                    ctx.beginPath();
                    ctx.rect(x, y, capW, h);
                    ctx.fillStyle = shape.getAttr('_fill');
                    ctx.fill();
                },
                _fill: this._getMercuryGradientCSS(
                    mercuryTopY, mercuryBotY, T, this.tempMin, this.tempMax
                ),
            });

            // 用 Konva.Rect 实现（兼容性更好）
            this._mercuryGroup.add(new Konva.Rect({
                x: capX, y: mercuryTopY,
                width: capW, height: mercuryBotY - mercuryTopY,
                fillLinearGradientStartPoint: { x: 0, y: 0 },
                fillLinearGradientEndPoint:   { x: capW, y: 0 },
                fillLinearGradientColorStops: this._getMercuryHorizGradient(T),
                strokeWidth: 0,
            }));

            // 汞柱内部金属竖向光泽（亮度条）
            const glowH = Math.min(60, (mercuryBotY - mercuryTopY) * 0.25);
            this._mercuryGroup.add(new Konva.Rect({
                x: capX + capW*0.18, y: mercuryTopY,
                width: capW * 0.25, height: mercuryBotY - mercuryTopY,
                fillLinearGradientStartPoint: { x: 0, y: 0 },
                fillLinearGradientEndPoint:   { x: 0, y: mercuryBotY - mercuryTopY },
                fillLinearGradientColorStops: this._getMercuryVertGlow(T),
                strokeWidth: 0,
            }));

            // ── 凸弯月面（Meniscus）──
            // 汞不润湿玻璃 → 液面为向上凸的弯月面
            const mH = Math.max(1.5, capW * 0.28);   // 弯月面高度
            this._mercuryGroup.add(new Konva.Shape({
                sceneFunc(ctx, shape) {
                    ctx.beginPath();
                    ctx.moveTo(capX, mercuryTopY + mH);
                    ctx.quadraticCurveTo(
                        cap.cx, mercuryTopY - mH * 0.5,  // 控制点（向上凸）
                        capX + capW, mercuryTopY + mH
                    );
                    ctx.lineTo(capX + capW, mercuryTopY + mH * 0.1);
                    ctx.quadraticCurveTo(
                        cap.cx, mercuryTopY + mH * 0.1 - mH * 0.4,
                        capX, mercuryTopY + mH * 0.1
                    );
                    ctx.closePath();
                    ctx.fillStyle = 'rgba(210,218,225,0.90)';
                    ctx.fill();
                },
            }));

            // 弯月面高光（小白椭圆）
            this._mercuryGroup.add(new Konva.Ellipse({
                x: cap.cx - capW*0.08, y: mercuryTopY - mH*0.1,
                radiusX: capW * 0.22, radiusY: mH * 0.30,
                fill: 'rgba(255,255,255,0.70)', strokeWidth: 0,
            }));
        }

        // ── 收缩颈（体温计模式）──
        if (this.mode === 'clinical') {
            const con = this._constriction;
            const cy  = con.y;
            // 收缩处：管径变窄的小段
            this._mercuryGroup.add(new Konva.Rect({
                x: cap.cx - con.w/2, y: cy - 3,
                width: con.w, height: 6,
                fill: 'rgba(180,195,210,0.85)',
                stroke: 'rgba(100,140,180,0.40)', strokeWidth: 0.5,
            }));
            // 锁定标记
            if (this._constrictLock) {
                this._mercuryGroup.add(new Konva.Line({
                    points: [cap.cx - con.w*0.7, cy, cap.cx + con.w*0.7, cy],
                    stroke: '#c0392b', strokeWidth: 1.0, lineCap: 'round',
                    dash: [2, 2],
                }));
            }
        }

        // ── 储汞球内汞液 ──
        const hotFrac = Math.max(0, Math.min(1, (T - this.tempMin) / (this.tempMax - this.tempMin)));
        const rH = b.ry * 0.88, rW = b.rx * 0.88;
        this._mercuryGroup.add(new Konva.Ellipse({
            x: b.cx, y: b.cy,
            radiusX: rW, radiusY: rH,
            fillRadialGradientStartPoint:  { x: -rW*0.35, y: -rH*0.35 },
            fillRadialGradientEndPoint:    { x: 0, y: 0 },
            fillRadialGradientStartRadius: 0,
            fillRadialGradientEndRadius:   Math.max(rW, rH) * 1.1,
            fillRadialGradientColorStops:  this._getBulbMercuryGradient(hotFrac),
            strokeWidth: 0,
        }));
        // 球面高光
        this._mercuryGroup.add(new Konva.Ellipse({
            x: b.cx - rW*0.28, y: b.cy - rH*0.32,
            radiusX: rW * 0.30, radiusY: rH * 0.22,
            fill: `rgba(255,255,255,${0.35 + hotFrac*0.05})`, strokeWidth: 0,
        }));

        // 高温时球底热晕
        if (hotFrac > 0.55) {
            const haloR = Math.max(b.rx, b.ry) * (1.5 + (hotFrac-0.55)*1.2);
            const gHalo = new Konva.Circle({
                x: b.cx, y: b.cy, radius: haloR,
                fillRadialGradientStartPoint:  { x: 0, y: 0 },
                fillRadialGradientEndPoint:    { x: 0, y: 0 },
                fillRadialGradientStartRadius: Math.max(b.rx, b.ry) * 0.9,
                fillRadialGradientEndRadius:   haloR,
                fillRadialGradientColorStops:  [
                    0, `rgba(255,${Math.round(80-hotFrac*60)},20,${(hotFrac-0.55)*0.45})`,
                    1, 'rgba(255,80,20,0)',
                ],
                strokeWidth: 0,
                listening: false,
            });
            this._mercuryGroup.add(gHalo);
        }

        // 过量程警报（液柱顶端红色闪烁）
        if (this._overRange) {
            const flash = Math.abs(Math.sin(this._overFlash * Math.PI * 4));
            this._mercuryGroup.add(new Konva.Rect({
                x: s.x, y: s.y1,
                width: s.w, height: s.y1 + 20,
                fill: `rgba(255,50,30,${flash * 0.22})`,
                cornerRadius: [W*0.20, W*0.20, 0, 0],
                strokeWidth: 0,
            }));
            this._mercuryGroup.add(new Konva.Text({
                x: s.x, y: s.y1 + 6,
                width: s.w, text: '!',
                fontSize: 11, fill: `rgba(255,60,30,${flash})`,
                align: 'center', fontStyle: 'bold',
            }));
        }

        // ── 读数游标（当前温度对应的刻度高亮线）──
        if (!this._overRange) {
            const rY = sc.y2 - Math.max(0, Math.min(1, frac)) * (sc.y2 - sc.y1);
            const rX0 = sc.x - this._scale.wL * 0.90;
            const rX1 = (this.showF
                ? sc.x + s.w + this._scale.wR * 0.90
                : sc.x + s.w * 1.02);

            // 游标线（细红线）
            this._dynamicGroup.add(new Konva.Line({
                points: [rX0, rY, rX1, rY],
                stroke: 'rgba(200,40,40,0.55)',
                strokeWidth: 0.8,
                dash: [4, 3],
            }));

            // 读数标签
            const labelX = this.showF ? rX1 + 3 : s.x + s.w + 3;
            this._dynamicGroup.add(new Konva.Text({
                x: s.x - this._scale.wL - this.width*0.01 - 36,
                y: rY - 5,
                width: 34,
                text: `${T.toFixed(1)}`,
                fontSize: Math.max(6.5, this.width * 0.085),
                fill: '#c02020',
                align: 'right',
                fontStyle: 'bold',
                fontFamily: 'Arial, sans-serif',
            }));
        }
    }

    // ── 颜色辅助 ─────────────────────────────

    /** 汞柱水平（左右）渐变：产生圆管截面金属感 */
    _getMercuryHorizGradient(T) {
        const hot = Math.max(0, Math.min(1, (T - this.tempMin) / (this.tempMax - this.tempMin)));
        // 冷→银蓝，热→银红
        const r = Math.round(175 + hot * 55);
        const g = Math.round(185 - hot * 30);
        const b = Math.round(195 - hot * 50);
        return [
            0,   `rgba(${Math.round(r*0.6)},${Math.round(g*0.65)},${Math.round(b*0.7)},0.92)`,
            0.18,`rgba(${r},${g},${b},0.96)`,
            0.45,`rgba(${Math.min(255,r+55)},${Math.min(255,g+50)},${Math.min(255,b+45)},0.99)`,
            0.65,`rgba(${r},${g},${b},0.96)`,
            0.85,`rgba(${Math.round(r*0.75)},${Math.round(g*0.78)},${Math.round(b*0.80)},0.92)`,
            1,   `rgba(${Math.round(r*0.55)},${Math.round(g*0.60)},${Math.round(b*0.65)},0.88)`,
        ];
    }

    /** 汞柱竖向（流动光泽）渐变 */
    _getMercuryVertGlow(T) {
        const hot = Math.max(0, Math.min(1, (T - this.tempMin) / (this.tempMax - this.tempMin)));
        const alpha = 0.18 + hot * 0.08;
        return [
            0,   `rgba(255,255,255,${alpha * 0.4})`,
            0.15,`rgba(255,255,255,${alpha})`,
            0.35,`rgba(255,255,255,${alpha * 0.6})`,
            0.55,`rgba(255,255,255,${alpha * 0.3})`,
            0.75,`rgba(255,255,255,${alpha * 0.6})`,
            1,   `rgba(255,255,255,${alpha * 0.2})`,
        ];
    }

    /** 储汞球汞液径向渐变 */
    _getBulbMercuryGradient(hotFrac) {
        const r = Math.round(190 + hotFrac * 50);
        const g = Math.round(200 - hotFrac * 50);
        const b = Math.round(210 - hotFrac * 80);
        return [
            0,   `rgba(${Math.min(255,r+60)},${Math.min(255,g+55)},${Math.min(255,b+50)},1)`,
            0.35,`rgba(${r},${g},${b},1)`,
            0.70,`rgba(${Math.round(r*0.80)},${Math.round(g*0.82)},${Math.round(b*0.85)},1)`,
            1,   `rgba(${Math.round(r*0.60)},${Math.round(g*0.62)},${Math.round(b*0.65)},1)`,
        ];
    }

    _getMercuryGradientCSS(y1, y2, T, mn, mx) {
        return `linear-gradient(to bottom, #aab8c8 ${y1}px, #c8d0d8 ${y2}px)`;
    }

    // ── 标注 ─────────────────────────────────
    _drawLabel() {
        const W = this.width;
        this._staticGroup.add(new Konva.Text({
            x: 0, y: -24, width: W,
            text: this.label+'水银温度计',
            fontSize: 12, fontStyle: 'bold', fill: '#546e7a',
            align: 'center',
        }));
        this._staticGroup.add(new Konva.Text({
            x: 0, y: -10, width: W,
            text: `${this.tempMin}~${this.tempMax} °C`,
            fontSize: 12, fill: '#3a5a7a',
            align: 'center',
            fontFamily: 'Courier New',
        }));
    }

    // ── 状态面板 ─────────────────────────────
    _drawStatusPanel() {
        const W    = this.width;
        const panY = this._bulb.cy + this._bulb.ry + 12;

        this._statusGroup = new Konva.Group({ x: 0, y: panY });
        this._staticGroup.add(this._statusGroup);

        this._statusGroup.add(new Konva.Rect({
            x: 2, y: 0, width: W + 10, height: 54,
            fill: '#e7ebf3', stroke: '#182028',
            strokeWidth: 0.8, cornerRadius: 4,
        }));

        this._statusDot = new Konva.Circle({
            x: 11, y: 11, radius: 3.2,
            fill: '#66bb6a', shadowColor: '#66bb6a',
            shadowBlur: 5, shadowOpacity: 0.9,
        });
        this._statusGroup.add(this._statusDot);

        this._statLines = [];
        ['示数: --', '目标: --', '状态: --'].forEach((t, i) => {
            const node = new Konva.Text({
                x: 20, y: 5 + i * 16,
                width: W - 10, text: t,
                fontSize: 12, fill: '#7aaad0',
                fontFamily: 'Courier New',
            });
            this._statusGroup.add(node);
            this._statLines.push(node);
        });
    }

    _updateStatusPanel() {
        if (!this._statLines) return;
        const T    = this._tempDisplay;
        const col  = this._getTempColor(T);
        this._statLines[0].text(`示数: ${T.toFixed(1)} °C`);
        this._statLines[0].fill(col);
        this._statLines[1].text(`目标: ${this._tempTarget.toFixed(1)} °C`);
        this._statLines[2].text(
            this._overRange ? '⚠ 过量程'
            : this.mode === 'clinical' && this._constrictLock ? '🔒 收缩颈锁定'
            : '正常'
        );
        this._statLines[2].fill(this._overRange ? '#ef5350' : '#66bb6a');
        const dotC = this._overRange ? '#ef5350' : col;
        this._statusDot.fill(dotC);
        this._statusDot.shadowColor(dotC);
    }

    _getTempColor(T) {
        const span = this.tempMax - this.tempMin;
        const frac = (T - this.tempMin) / span;
        if (frac > 0.90) return '#ef5350';
        if (frac > 0.70) return '#ffa726';
        if (frac < 0.10) return '#7986cb';
        return '#66bb6a';
    }

    // ═══════════════════════════════════════════
    // ── 物理模型 ─────────────────────────────

    /** 获取实际显示温度（含噪声、收缩颈逻辑） */
    _getDisplayTemp() {
        if (this.mode === 'clinical' && this._constrictLock) {
            return this._lockedTemp;
        }
        return this._tempDisplay;
    }

    /** 一阶热响应 + 噪声 */
    _updateThermal(dt) {
        const tau   = Math.max(0.1, this.tauSec);
        const alpha = 1 - Math.exp(-dt / tau);
        this._tempSensor += alpha * (this._tempTarget - this._tempSensor);

        // 微小热噪声
        this._noiseTimer += dt;
        if (this._noiseTimer >= 0.25) {
            this._noiseTimer = 0;
            const z = (Math.random() + Math.random() - 1) * this.accuracy * 0.35;
            this._noiseVal = z;
        }
        this._tempDisplay = this._tempSensor + this._noiseVal;

        // 体温计收缩颈逻辑
        if (this.mode === 'clinical') {
            if (!this._constrictLock) {
                // 液柱只能升高，不能下降（除非甩表）
                if (this._tempDisplay > this._lockedTemp) {
                    this._lockedTemp = this._tempDisplay;
                }
                // 当温度升高时，自动更新锁定值
                if (this._tempSensor < this._lockedTemp - 0.5) {
                    this._constrictLock = true;   // 降温时收缩颈锁住液柱
                }
            }
        }

        // 汞流动相位（慢速漂移，产生金属液体视觉）
        this._mercuryFlow += dt * 0.08;
        this._overFlash   += dt;
    }

    // ═══════════════════════════════════════════
    // 集中化 tick（由 consys._tickAll 在 20fps 调用）
    tick(dt) {
        this._updateThermal(dt);

        // ── 惰性重建：只有显示值变化时才重绘 ──
        if (this._lastRebuildDisplay === undefined || Math.abs(this._tempDisplay - this._lastRebuildDisplay) > 0.005) {
            this._lastRebuildDisplay = this._tempDisplay;
            this._rebuildMercury();
            this._updateStatusPanel();
            this._refreshCache();
        }
    }

    // ═══════════════════════════════════════════
    // ── 公开 API ─────────────────────────────

    /** 设置被测温度（°C） */
    setTemperature(T) {
        this._tempTarget = Math.max(
            this.tempMin - 5,
            Math.min(this.tempMax + 5, T)
        );
    }

    /** 立即跳变（不经过热响应过程） */
    setTemperatureImmediate(T) {
        this._tempTarget  = T;
        this._tempSensor  = T;
        this._tempDisplay = T;
        if (this.mode === 'clinical') {
            this._lockedTemp    = T;
            this._constrictLock = false;
        }
    }

    /** 模拟甩表（体温计模式：复位收缩颈，液柱落回当前温度） */
    shake() {
        if (this.mode !== 'clinical') return;
        this._constrictLock = false;
        this._lockedTemp    = this._tempDisplay;
    }

    /** 切换模式：'clinical' / 'industrial' / 'lab' */
    setMode(mode) {
        this.mode = mode;
        if (mode !== 'clinical') {
            this._constrictLock = false;
        }
    }

    /** 读取当前示数（°C） */
    getReading()  { return this._getDisplayTemp(); }

    /** 是否过量程 */
    isOverRange() { return this._overRange; }

    update(state) {
        if (typeof state === 'number')                    this.setTemperature(state);
        else if (state && typeof state.temp === 'number') this.setTemperature(state.temp);
        if (state && state.mode) this.setMode(state.mode);
        this._refreshCache();
    }

    getConfigFields() {
        return [
            { label: '位号/名称',           key: 'label',    type: 'text'   },
            { label: '量程下限 (°C)',        key: 'tempMin',  type: 'number' },
            { label: '量程上限 (°C)',        key: 'tempMax',  type: 'number' },
            { label: '初始温度 (°C)',        key: 'initTemp', type: 'number' },
            { label: '热响应时间常数 τ (s)', key: 'tauSec',   type: 'number' },
            { label: '精度 (°C)',            key: 'accuracy', type: 'number' },
            { label: '显示°F副刻度 (1=是)',  key: 'showF',    type: 'number' },
            { label: '模式 (industrial/clinical/lab)', key: 'mode', type: 'text' },
        ];
    }

    onConfigUpdate(cfg) {
        if (cfg.label    !== undefined) this.label    = cfg.label;
        if (cfg.tempMin  !== undefined) this.tempMin  = parseFloat(cfg.tempMin);
        if (cfg.tempMax  !== undefined) this.tempMax  = parseFloat(cfg.tempMax);
        if (cfg.tauSec   !== undefined) this.tauSec   = parseFloat(cfg.tauSec);
        if (cfg.accuracy !== undefined) this.accuracy = parseFloat(cfg.accuracy);
        if (cfg.showF    !== undefined) this.showF    = !!parseInt(cfg.showF);
        if (cfg.mode     !== undefined) this.setMode(cfg.mode);
        if (cfg.initTemp !== undefined) this.setTemperature(parseFloat(cfg.initTemp));
        this.config = { ...this.config, ...cfg };
        this._refreshCache();
    }

    destroy() { super.destroy?.(); }
}