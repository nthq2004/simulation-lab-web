import { BaseComponent } from './BaseComponent.js';

/**
 * 离心式本地显示转速表仿真组件
 * （Centrifugal Local-Display Tachometer）
 *
 * ── 工作原理 ──────────────────────────────────────────────────
 *
 *  离心式转速表是利用离心力原理工作的机械式转速测量仪表：
 *
 *  1. 传动轴（Drive Shaft）：与被测旋转设备直连或通过齿轮/皮带传动
 *  2. 飞锤组件（Flyweight Assembly）：
 *     - 两只对称布置的飞锤通过铰接臂连接到主轴
 *     - 转速越高 → 离心力越大 → 飞锤张角越大
 *  3. 套筒/滑块（Sleeve/Collar）：
 *     - 飞锤张开时推动套筒沿轴向上移
 *     - 套筒通过连杆驱动指针
 *  4. 回位弹簧（Return Spring）：
 *     - 拮抗离心力，使套筒在低速时复位
 *     - 弹簧预紧力决定了量程下限
 *  5. 指针与表盘（Pointer & Dial）：
 *     - 指针偏转角与套筒位移线性对应
 *     - 表盘刻度直接标注转速值（rpm）
 *
 * ── 物理模型 ──────────────────────────────────────────────────
 *
 *  飞锤平衡方程：
 *    F_centrifugal = m·ω²·r = k·x  （弹簧力）
 *    其中 ω = 2π·n/60，n 为转速（rpm），x 为套筒位移
 *
 *  套筒位移：x ∝ (n/n_max)²
 *  指针偏角：θ = θ_max · (n/n_max)²  （改进为线性刻度时做开方修正）
 *
 *  本仿真采用：
 *    - 飞锤张角 α = α_max · (n/n_max)²
 *    - 指针角度 = f(α)，通过连杆几何转换
 *    - 一阶惯性滤波：τ = 0.8s（模拟机械响应延迟）
 *
 * ── 结构布局（正视图）──────────────────────────────────────────
 *
 *   ┌──────────────────────────────┐
 *   │  [位号]  n=xxxx rpm          │  ← 标题栏
 *   ├──────────────────────────────┤
 *   │      ┌────────────────┐      │
 *   │      │  半圆表盘刻度   │      │  ← 仪表表盘
 *   │      │    ↑指针       │      │
 *   │      └────────────────┘      │
 *   ├──────────────────────────────┤
 *   │  ┌──────────────────────┐   │
 *   │  │  离心飞锤机构剖面图  │   │  ← 机构示意区
 *   │  │   ◇飞锤  │轴  ◇飞锤  │   │
 *   │  │     \   │  /         │   │
 *   │  │      ▼套筒▼           │   │
 *   │  └──────────────────────┘   │
 *   └──────────────────────────────┘
 *        ▲ shaft（传动轴端口）
 *
 * ── 端口 ─────────────────────────────────────────────────────
 *  shaft — 传动轴输入端口（底部中央）
 *          signal 类型，输入值为转速（rpm）
 *
 * ── 可配置参数 ────────────────────────────────────────────────
 *  label         : 位号（默认 'ST'）
 *  ratedSpeed    : 额定转速 rpm（默认 3000）
 *  maxSpeed      : 量程最大值 rpm（默认 3600）
 *  initSpeed     : 初始转速 rpm（默认 0）
 *  timeConst     : 机械响应时间常数 s（默认 0.8）
 *  showMechanism : 是否显示离心机构示意（默认 true）
 */
export class CentrifugalTachometer extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.width  = Math.max(180, config.width  || 220);
        this.height = Math.max(260, config.height || 300);

        this.type    = 'centrifugal_tachometer';
        this.special = 'none';
        this.cache   = 'fixed';

        this._initGroups();
        this._recalcGeometry();
        this._initParameters(config);
        this._init();

        this.config = {
            label         : this.label,
            ratedSpeed    : this.ratedSpeed,
            maxSpeed      : this.maxSpeed,
            initSpeed     : this._targetSpeed,
            timeConst     : this._timeConst,
            showMechanism : this._showMechanism,
        };

        // 端口：传动轴输入（底部中央）
        this.addPort(
            this._shaftPort.x, this._shaftPort.y,
            'shaft', 'signal', 'n'
        );
    }

    // ═══════════════════════════════════════════════════════
    // 几何计算
    // ═══════════════════════════════════════════════════════

    _recalcGeometry() {
        const W = this.width, H = this.height;

        // ── 表壳 ──
        this._case = {
            x: W * 0.04, y: H * 0.02,
            w: W * 0.92, h: H * 0.95,
            rx: Math.max(4, W * 0.03),
        };

        // ── 表盘区（上部圆形/半圆区域）──
        this._dialCx = W / 2;
        this._dialCy = H * 0.36;
        this._dialR  = Math.min(W * 0.38, H * 0.28);

        // 指针参数
        this._ptrLen    = this._dialR * 0.88;
        this._ptrOrigin = { x: this._dialCx, y: this._dialCy };

        // 表盘角度范围：-225° ~ 45°（相对12点方向，顺时针）
        // 即从左下(-135°)扫到右下(+135°)，总扫角270°
        this._dialAngleMin = -225 * Math.PI / 180;  // 起始角（低速端，左下）
        this._dialAngleMax =  45  * Math.PI / 180;  // 终止角（高速端，右下）
        // 对应到Konva坐标系（0°=右，顺时针），表盘从左下到右下顺时针
        // Konva角度：起始 = 225°，终止 = 315°（顺时针270°扫描）
        this._needleAngleStart = 225; // °，对应 0 rpm（左下）
        this._needleAngleRange = 270; // °，0~maxSpeed 扫过 270°

        // ── 机构示意区（下部）──
        this._mechY   = this._dialCy + this._dialR + H * 0.06;
        this._mechH   = H * 0.30;
        this._mechCx  = W / 2;
        this._mechTop = this._mechY;
        this._mechBot = this._mechY + this._mechH;

        // 主轴几何
        this._shaftX     = W / 2;
        this._shaftTopY  = this._mechTop + this._mechH * 0.05;
        this._shaftBotY  = this._mechBot - this._mechH * 0.10;
        this._shaftW     = W * 0.028;

        // 飞锤臂参数
        this._flyArmLen  = W * 0.28;   // 飞锤臂半长（单侧）
        this._flyArmPivY = this._shaftTopY + this._mechH * 0.15;  // 铰接点Y
        this._flyMaxHalf = W * 0.24;   // 最大张开时飞锤端X偏移（单侧）
        this._flyMinHalf = W * 0.03;   // 最小张开（0rpm，飞锤收拢）

        // 套筒参数
        this._sleeveW    = W * 0.08;
        this._sleeveH    = H * 0.05;
        this._sleeveMinY = this._flyArmPivY + H * 0.06;  // 低速位置（弹簧压缩态）
        this._sleeveMaxY = this._flyArmPivY + H * 0.18;  // 高速位置（弹簧拉伸，套筒下推）

        // 弹簧（套筒下方到底部支撑）
        this._springTopY = this._sleeveMinY + this._sleeveH;
        this._springBotY = this._shaftBotY - H * 0.02;

        // 端口位置
        this._shaftPort = { x: W / 2, y: H * 0.98 };
    }

    // ═══════════════════════════════════════════════════════
    // 参数初始化
    // ═══════════════════════════════════════════════════════

    _initParameters(config) {
        this.label          = config.label         || 'ST';
        this.ratedSpeed     = config.ratedSpeed    || 3000;   // rpm
        this.maxSpeed       = config.maxSpeed      || 3600;   // rpm
        this._timeConst     = config.timeConst     !== undefined ? config.timeConst : 0.8;
        this._showMechanism = config.showMechanism !== undefined ? config.showMechanism : true;

        const init        = config.initSpeed || 0;
        this._targetSpeed = init;   // 外部设定值（rpm）
        this._dispSpeed   = init;   // 当前显示值（一阶滤波输出）

        // 主轴旋转动画相位（用于绘制旋转细节）
        this._shaftPhase  = 0;      // rad

        // 上次 tick 时间戳（用于积分）
        this._lastDt      = 0;
    }

    // ═══════════════════════════════════════════════════════
    // 初始化
    // ═══════════════════════════════════════════════════════

    _init() {
        this._drawStaticParts();
        this._bindInteraction();
        this._rebuildDynamic();
    }

    // ═══════════════════════════════════════════════════════
    // 静态层
    // ═══════════════════════════════════════════════════════

    _drawStaticParts() {
        this._drawCase();
        this._drawDialFace();
        this._drawDialScale();
        this._drawRatedMark();
        this._drawLabel();
        if (this._showMechanism) {
            this._drawMechFrame();
            this._drawShaftStatic();
        }
    }

    /** 表壳 */
    _drawCase() {
        const c = this._case;
        // 外壳阴影
        this._staticGroup.add(new Konva.Rect({
            x: c.x + 3, y: c.y + 3,
            width: c.w, height: c.h,
            fill: 'rgba(0,0,0,0.35)',
            cornerRadius: c.rx + 2,
        }));
        // 表壳主体
        this._staticGroup.add(new Konva.Rect({
            x: c.x, y: c.y, width: c.w, height: c.h,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint:   { x: c.w, y: c.h },
            fillLinearGradientColorStops: [
                0,   '#4a4a52',
                0.4, '#3a3a42',
                1,   '#2a2a30',
            ],
            stroke: '#5a5a62', strokeWidth: 1.5,
            cornerRadius: c.rx,
        }));
        // 表壳顶部高光
        this._staticGroup.add(new Konva.Rect({
            x: c.x + 3, y: c.y + 2,
            width: c.w - 6, height: c.h * 0.10,
            fill: 'rgba(255,255,255,0.07)',
            cornerRadius: [c.rx, c.rx, 0, 0],
        }));
    }

    /** 表盘面板（乳白色圆盘背景） */
    _drawDialFace() {
        const cx = this._dialCx, cy = this._dialCy, r = this._dialR;

        // 表盘外圈金属环
        this._staticGroup.add(new Konva.Circle({
            x: cx, y: cy, radius: r + 6,
            fillLinearGradientStartPoint: { x: -r - 6, y: 0 },
            fillLinearGradientEndPoint:   { x:  r + 6, y: 0 },
            fillLinearGradientColorStops: [
                0, '#5a5a60', 0.3, '#9a9aA0', 0.5, '#c0c0c8',
                0.7, '#9a9aA0', 1, '#5a5a60',
            ],
        }));

        // 表盘底色
        this._staticGroup.add(new Konva.Circle({
            x: cx, y: cy, radius: r + 2,
            fill: '#f5f5ee',
            stroke: '#ccccbe', strokeWidth: 1,
        }));

        // 表盘径向渐变（立体感）
        this._staticGroup.add(new Konva.Circle({
            x: cx - r * 0.15, y: cy - r * 0.15, radius: r * 0.6,
            fillRadialGradientStartPoint: { x: 0, y: 0 },
            fillRadialGradientEndPoint:   { x: 0, y: 0 },
            fillRadialGradientStartRadius: 0,
            fillRadialGradientEndRadius:   r * 0.6,
            fillRadialGradientColorStops: [
                0, 'rgba(255,255,255,0.30)',
                1, 'rgba(255,255,255,0)',
            ],
            listening: false,
        }));

        // 表盘下半部裁剪遮罩（仅显示半圆+少量）
        // 用弧线勾勒底边轮廓
        this._staticGroup.add(new Konva.Arc({
            x: cx, y: cy,
            innerRadius: r * 0.10,
            outerRadius: r * 0.14,
            angle: 270,
            rotation: 135,
            fill: '#d0c8a0',
            stroke: '#a09878', strokeWidth: 0.5,
        }));
    }

    /** 表盘刻度（静态，绘制一次） */
    _drawDialScale() {
        const cx   = this._dialCx;
        const cy   = this._dialCy;
        const r    = this._dialR;
        const nMax = this.maxSpeed;

        // 总刻度数
        const majorDivs = 6;  // 主刻度间隔段数
        const minorPer  = 5;  // 每主刻度间的次刻度数

        const startDeg = this._needleAngleStart;  // 225°
        const totalDeg = this._needleAngleRange;  // 270°

        // ── 主刻度线 + 数字 ──
        for (let i = 0; i <= majorDivs; i++) {
            const frac = i / majorDivs;
            const angleDeg = startDeg + frac * totalDeg;
            const rad = angleDeg * Math.PI / 180;
            const cos = Math.cos(rad), sin = Math.sin(rad);

            // 主刻度线
            const r0 = r * 0.82, r1 = r * 0.95;
            this._staticGroup.add(new Konva.Line({
                points: [
                    cx + r0 * cos, cy + r0 * sin,
                    cx + r1 * cos, cy + r1 * sin,
                ],
                stroke: '#222', strokeWidth: 1.8, lineCap: 'round',
            }));

            // 数字标注
            const speedVal = Math.round(frac * nMax);
            const rt = r * 0.68;
            const tx = cx + rt * cos;
            const ty = cy + rt * sin;
            const fontSize = Math.max(7, this.width * 0.042);
            this._staticGroup.add(new Konva.Text({
                x: tx - 14, y: ty - fontSize * 0.55,
                width: 28, height: fontSize * 1.2,
                text: speedVal >= 1000
                    ? (speedVal / 1000).toFixed(1) + 'k'
                    : String(speedVal),
                fontSize,
                fontStyle: 'bold',
                fill: '#222233',
                align: 'center',
            }));
        }

        // ── 次刻度线 ──
        const totalMinor = majorDivs * minorPer;
        for (let i = 0; i <= totalMinor; i++) {
            // 跳过主刻度位置
            if (i % minorPer === 0) continue;
            const frac = i / totalMinor;
            const angleDeg = startDeg + frac * totalDeg;
            const rad = angleDeg * Math.PI / 180;
            const cos = Math.cos(rad), sin = Math.sin(rad);

            const isMid = (i % minorPer === Math.floor(minorPer / 2));
            const r0 = isMid ? r * 0.87 : r * 0.90;
            const r1 = r * 0.95;
            this._staticGroup.add(new Konva.Line({
                points: [
                    cx + r0 * cos, cy + r0 * sin,
                    cx + r1 * cos, cy + r1 * sin,
                ],
                stroke: '#444', strokeWidth: isMid ? 1.2 : 0.8, lineCap: 'round',
            }));
        }

        // ── 弧形量程色带 ──
        // 绿色区（0 ~ rated）
        this._drawArcBand(
            cx, cy, r * 0.76, r * 0.82,
            startDeg,
            startDeg + (this.ratedSpeed / nMax) * totalDeg,
            '#4caf50', 0.7
        );
        // 黄色区（rated ~ 110% rated）
        const y110 = Math.min(this.ratedSpeed * 1.1, nMax);
        this._drawArcBand(
            cx, cy, r * 0.76, r * 0.82,
            startDeg + (this.ratedSpeed / nMax) * totalDeg,
            startDeg + (y110        / nMax) * totalDeg,
            '#ffb300', 0.8
        );
        // 红色区（110% ~ 最大）
        if (y110 < nMax) {
            this._drawArcBand(
                cx, cy, r * 0.76, r * 0.82,
                startDeg + (y110 / nMax) * totalDeg,
                startDeg + totalDeg,
                '#e53935', 0.8
            );
        }

        // ── 表盘中心文字 ──
        this._staticGroup.add(new Konva.Text({
            x: cx - r * 0.5, y: cy + r * 0.30,
            width: r, height: r * 0.25,
            text: 'r/min',
            fontSize: Math.max(6, this.width * 0.040),
            fill: '#445566',
            align: 'center',
        }));
    }

    /**
     * 绘制圆弧色带（近似多段折线）
     * @param {number} cx 圆心X
     * @param {number} cy 圆心Y
     * @param {number} r0 内半径
     * @param {number} r1 外半径
     * @param {number} a0 起始角(°)
     * @param {number} a1 终止角(°)
     * @param {string} color 颜色
     * @param {number} opacity 透明度
     */
    _drawArcBand(cx, cy, r0, r1, a0, a1, color, opacity) {
        const steps = Math.max(4, Math.round(Math.abs(a1 - a0) / 5));
        const pts = [];
        for (let i = 0; i <= steps; i++) {
            const a = (a0 + (a1 - a0) * i / steps) * Math.PI / 180;
            pts.push(cx + r1 * Math.cos(a), cy + r1 * Math.sin(a));
        }
        for (let i = steps; i >= 0; i--) {
            const a = (a0 + (a1 - a0) * i / steps) * Math.PI / 180;
            pts.push(cx + r0 * Math.cos(a), cy + r0 * Math.sin(a));
        }
        this._staticGroup.add(new Konva.Line({
            points: pts,
            fill: color, closed: true,
            opacity, listening: false,
        }));
    }

    /** 额定转速三角标记 */
    _drawRatedMark() {
        const cx = this._dialCx, cy = this._dialCy, r = this._dialR;
        const frac = this.ratedSpeed / this.maxSpeed;
        const angleDeg = this._needleAngleStart + frac * this._needleAngleRange;
        const rad = angleDeg * Math.PI / 180;
        const rm = r * 0.74;
        const mx = cx + rm * Math.cos(rad);
        const my = cy + rm * Math.sin(rad);
        // 三角指示
        const ts = 5;
        const perpRad = rad + Math.PI / 2;
        this._staticGroup.add(new Konva.Line({
            points: [
                mx + ts * Math.cos(perpRad), my + ts * Math.sin(perpRad),
                mx - ts * Math.cos(perpRad), my - ts * Math.sin(perpRad),
                mx - (ts * 1.4) * Math.cos(rad), my - (ts * 1.4) * Math.sin(rad),
            ],
            fill: '#e53935', stroke: '#b71c1c', strokeWidth: 0.5,
            closed: true, listening: false,
        }));
    }

    /** 位号标签 */
    _drawLabel() {
        const fontSize = Math.max(8, this.width * 0.048);
        this._staticGroup.add(new Konva.Text({
            x: 0, y: this._case.y - 14, width: this.width,
            text: `${this.label}`,
            fontSize, fontStyle: 'bold',
            fill: '#546e7a', align: 'center',
        }));
    }

    /** 机构区外框 */
    _drawMechFrame() {
        const W = this.width;
        const mx = W * 0.06;
        const mw = W * 0.88;
        this._staticGroup.add(new Konva.Rect({
            x: mx, y: this._mechTop - 2,
            width: mw, height: this._mechH + 4,
            fill: '#1e2028',
            stroke: '#3a3a46', strokeWidth: 1,
            cornerRadius: 4,
        }));
        // 标题文字
        this._staticGroup.add(new Konva.Text({
            x: mx, y: this._mechTop + 2,
            width: mw, height: 14,
            text: '离心机构',
            fontSize: Math.max(6, W * 0.038),
            fill: '#6a8090', align: 'center',
        }));
    }

    /** 主轴静态底部（固定支撑） */
    _drawShaftStatic() {
        const cx = this._shaftX;
        const sw = this._shaftW;
        const botY = this._shaftBotY;

        // 底部轴承座
        this._staticGroup.add(new Konva.Rect({
            x: cx - sw * 2, y: botY,
            width: sw * 4, height: sw * 2,
            fill: '#5a5a68', stroke: '#4a4a56', strokeWidth: 0.8,
            cornerRadius: 2,
        }));
        // 底部端口引线标注
        this._staticGroup.add(new Konva.Text({
            x: cx - 12, y: botY + sw * 2.5,
            width: 24, height: 12,
            text: 'n',
            fontSize: Math.max(7, this.width * 0.042),
            fill: '#90a4ae', align: 'center', fontStyle: 'bold',
        }));
    }

    // ═══════════════════════════════════════════════════════
    // 动态层重建
    // ═══════════════════════════════════════════════════════

    _rebuildDynamic() {
        this._dynamicGroup.destroyChildren();

        const n    = this._dispSpeed;
        const nMax = this.maxSpeed;
        const frac = Math.min(1, Math.max(0, n / nMax));

        this._drawNeedle(frac);
        this._drawPointerPivot();
        this._drawSpeedDisplay(n);
        if (this._showMechanism) {
            this._drawFlyweightMechanism(frac);
        }
    }

    /**
     * 绘制指针
     * @param {number} frac 0~1（速度比）
     */
    _drawNeedle(frac) {
        const cx = this._ptrOrigin.x;
        const cy = this._ptrOrigin.y;
        const pLen = this._ptrLen;

        const angleDeg = this._needleAngleStart + frac * this._needleAngleRange;
        const rad = angleDeg * Math.PI / 180;
        const cos = Math.cos(rad), sin = Math.sin(rad);

        // 指针阴影
        this._dynamicGroup.add(new Konva.Line({
            points: [
                cx + 2, cy + 2,
                cx + (pLen - 2) * cos + 2, cy + (pLen - 2) * sin + 2,
            ],
            stroke: 'rgba(0,0,0,0.25)', strokeWidth: 3,
            lineCap: 'round', listening: false,
        }));

        // 指针主体（渐细）
        const tipX = cx + pLen * cos;
        const tipY = cy + pLen * sin;
        const baseW = 6;
        const perpRad = rad + Math.PI / 2;
        this._dynamicGroup.add(new Konva.Line({
            points: [
                cx + baseW * Math.cos(perpRad), cy + baseW * Math.sin(perpRad),
                cx - baseW * Math.cos(perpRad), cy - baseW * Math.sin(perpRad),
                tipX, tipY,
            ],
            fill: '#c62828', stroke: '#8b0000', strokeWidth: 0.8,
            closed: true, listening: false,
        }));

        // 指针高光
        this._dynamicGroup.add(new Konva.Line({
            points: [
                cx + 2, cy,
                cx + pLen * 0.7 * cos, cy + pLen * 0.7 * sin,
            ],
            stroke: 'rgba(255,100,80,0.4)', strokeWidth: 1.2,
            lineCap: 'round', listening: false,
        }));

        // 平衡锤（指针尾部）
        const tailLen = pLen * 0.18;
        this._dynamicGroup.add(new Konva.Line({
            points: [
                cx, cy,
                cx - tailLen * cos, cy - tailLen * sin,
            ],
            stroke: '#888', strokeWidth: 4, lineCap: 'round',
            listening: false,
        }));
    }

    /** 指针轴心 */
    _drawPointerPivot() {
        const cx = this._ptrOrigin.x, cy = this._ptrOrigin.y;
        this._dynamicGroup.add(new Konva.Circle({
            x: cx, y: cy, radius: 6,
            fillLinearGradientStartPoint: { x: -4, y: -4 },
            fillLinearGradientEndPoint:   { x:  4, y:  4 },
            fillLinearGradientColorStops: [0, '#aaa', 0.5, '#eee', 1, '#888'],
            stroke: '#555', strokeWidth: 1,
        }));
        this._dynamicGroup.add(new Konva.Circle({
            x: cx, y: cy, radius: 2,
            fill: '#222',
        }));
    }

    /** 数字显示区（表盘下方铭牌条） */
    _drawSpeedDisplay(n) {
        const W   = this.width;
        const cx  = this._dialCx;
        const cy  = this._dialCy;
        const r   = this._dialR;
        const bx  = cx - W * 0.22;
        const by  = cy + r * 0.55;
        const bw  = W * 0.44;
        const bh  = r * 0.24;

        // 液晶条背景
        this._dynamicGroup.add(new Konva.Rect({
            x: bx, y: by, width: bw, height: bh,
            fill: '#0a1a0a', stroke: '#1a3a1a', strokeWidth: 1,
            cornerRadius: 3,
        }));

        // 数值
        const dispStr = n.toFixed(0).padStart(5, ' ') + ' rpm';
        this._dynamicGroup.add(new Konva.Text({
            x: bx + 2, y: by + bh * 0.1,
            width: bw - 4, height: bh * 0.9,
            text: dispStr,
            fontSize: Math.max(8, bh * 0.55),
            fontFamily: 'Courier New, monospace',
            fontStyle: 'bold',
            fill: '#44ff66',
            align: 'center',
            verticalAlign: 'middle',
        }));
    }

    /**
     * 绘制离心飞锤机构动画
     * @param {number} frac 0~1（速度比）
     */
    _drawFlyweightMechanism(frac) {
        if (!this._showMechanism) return;

        const cx     = this._shaftX;
        const pivY   = this._flyArmPivY;
        const maxH   = this._flyMaxHalf;
        const minH   = this._flyMinHalf;
        const sw     = this._shaftW;
        const phase  = this._shaftPhase;

        // 飞锤张开程度（平方律：离心力 ∝ n²）
        // frac² 决定飞锤张开量
        const spread = minH + (maxH - minH) * frac * frac;

        // 套筒位置（速度↑ → 套筒↓）
        const sleeveY = this._sleeveMinY + (this._sleeveMaxY - this._sleeveMinY) * frac * frac;

        // ── 主轴（旋转纹理）──
        const shaftH = this._shaftBotY - this._shaftTopY;
        // 轴主体
        this._dynamicGroup.add(new Konva.Rect({
            x: cx - sw / 2, y: this._shaftTopY,
            width: sw, height: shaftH,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint:   { x: sw, y: 0 },
            fillLinearGradientColorStops: [
                0, '#4a4a54', 0.4, '#8a8a96', 0.6, '#c0c0cc',
                0.8, '#8a8a96', 1, '#4a4a54',
            ],
            stroke: '#3a3a42', strokeWidth: 0.5,
        }));

        // 旋转刻线（表示轴在转动）
        const numLines = 6;
        for (let i = 0; i < numLines; i++) {
            const yPos = this._shaftTopY + (i / numLines) * shaftH
                + ((phase / (2 * Math.PI)) * (shaftH / numLines));
            const yMod = this._shaftTopY +
                ((yPos - this._shaftTopY) % shaftH + shaftH) % shaftH;
            const alpha = 0.15 + 0.20 * Math.abs(Math.sin(phase + i));
            this._dynamicGroup.add(new Konva.Line({
                points: [cx - sw / 2, yMod, cx + sw / 2, yMod],
                stroke: `rgba(200,200,220,${alpha.toFixed(2)})`,
                strokeWidth: 0.8, listening: false,
            }));
        }

        // ── 飞锤臂（左右各一，铰接在主轴上）──
        // 铰接点
        const hingeY = pivY;

        // 臂末端（飞锤中心位置）
        const flyEndY = hingeY + Math.sqrt(
            Math.max(0, (this._flyArmLen * this._flyArmLen) - spread * spread)
        );
        // 夹角（弧度）
        const alpha = Math.asin(Math.min(1, spread / this._flyArmLen));

        // 左臂
        this._dynamicGroup.add(new Konva.Line({
            points: [cx, hingeY, cx - spread, flyEndY],
            stroke: '#c0a050', strokeWidth: 3, lineCap: 'round',
        }));
        // 右臂
        this._dynamicGroup.add(new Konva.Line({
            points: [cx, hingeY, cx + spread, flyEndY],
            stroke: '#c0a050', strokeWidth: 3, lineCap: 'round',
        }));

        // ── 飞锤（椭圆形重锤）──
        const flyR = Math.max(5, this.width * 0.045);
        // 左飞锤
        this._dynamicGroup.add(new Konva.Ellipse({
            x: cx - spread, y: flyEndY,
            radiusX: flyR * 0.7, radiusY: flyR,
            fillLinearGradientStartPoint: { x: -flyR, y: 0 },
            fillLinearGradientEndPoint:   { x:  flyR, y: 0 },
            fillLinearGradientColorStops: [
                0, '#3a3a42', 0.4, '#9090a0', 0.7, '#c0c0cc', 1, '#5a5a62',
            ],
            stroke: '#2a2a30', strokeWidth: 1,
        }));
        // 右飞锤
        this._dynamicGroup.add(new Konva.Ellipse({
            x: cx + spread, y: flyEndY,
            radiusX: flyR * 0.7, radiusY: flyR,
            fillLinearGradientStartPoint: { x: -flyR, y: 0 },
            fillLinearGradientEndPoint:   { x:  flyR, y: 0 },
            fillLinearGradientColorStops: [
                0, '#3a3a42', 0.4, '#9090a0', 0.7, '#c0c0cc', 1, '#5a5a62',
            ],
            stroke: '#2a2a30', strokeWidth: 1,
        }));

        // ── 连杆（飞锤到套筒）──
        // 左连杆
        this._dynamicGroup.add(new Konva.Line({
            points: [cx - spread, flyEndY, cx - sw, sleeveY],
            stroke: '#888898', strokeWidth: 1.5, lineCap: 'round',
            dash: [4, 3],
        }));
        // 右连杆
        this._dynamicGroup.add(new Konva.Line({
            points: [cx + spread, flyEndY, cx + sw, sleeveY],
            stroke: '#888898', strokeWidth: 1.5, lineCap: 'round',
            dash: [4, 3],
        }));

        // ── 套筒（滑块）──
        const sl = this._sleeveW, sh = this._sleeveH;
        this._dynamicGroup.add(new Konva.Rect({
            x: cx - sl / 2, y: sleeveY,
            width: sl, height: sh,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint:   { x: sl, y: 0 },
            fillLinearGradientColorStops: [
                0, '#3a3a48', 0.5, '#8888a0', 1, '#3a3a48',
            ],
            stroke: '#5a5a72', strokeWidth: 1,
            cornerRadius: 2,
        }));

        // ── 回位弹簧（套筒下方） ──
        this._drawSpring(
            cx, sleeveY + sh,
            cx, this._springBotY,
            sw * 0.7, 10
        );

        // 铰接点标记
        this._dynamicGroup.add(new Konva.Circle({
            x: cx, y: hingeY, radius: sw * 0.55,
            fill: '#d0c060', stroke: '#a09040', strokeWidth: 0.8,
        }));
    }

    /**
     * 绘制弹簧（折线近似）
     * @param {number} x0 起点X
     * @param {number} y0 起点Y
     * @param {number} x1 终点X
     * @param {number} y1 终点Y
     * @param {number} amplitude 弹簧振幅
     * @param {number} coils 圈数
     */
    _drawSpring(x0, y0, x1, y1, amplitude, coils) {
        const len = Math.sqrt((x1 - x0) ** 2 + (y1 - y0) ** 2);
        if (len < 4) return;
        const dx = (x1 - x0) / len, dy = (y1 - y0) / len;
        const px = -dy, py = dx;  // 垂直方向

        const pts = [x0, y0];
        const steps = coils * 4;

        for (let i = 1; i <= steps; i++) {
            const t = i / steps;
            const sign = (i % 2 === 0) ? 1 : -1;
            // 首尾端直段
            const amp = (t < 0.05 || t > 0.95) ? 0 : amplitude * sign;
            pts.push(
                x0 + dx * len * t + px * amp,
                y0 + dy * len * t + py * amp,
            );
        }
        pts.push(x1, y1);

        this._dynamicGroup.add(new Konva.Line({
            points: pts,
            stroke: '#7a8a9a', strokeWidth: 1.2,
            lineJoin: 'round', lineCap: 'round',
            listening: false,
        }));
    }

    // ═══════════════════════════════════════════════════════
    // 交互绑定（点击调整转速演示）
    // ═══════════════════════════════════════════════════════

    _bindInteraction() {
        const W = this.width, H = this.height;
        const hitArea = new Konva.Rect({
            x: this._case.x, y: this._case.y,
            width: this._case.w, height: this._dialR * 2.2,
            fill: 'transparent',
        });
        hitArea.on('click tap', (e) => {
            // 根据点击位置在表盘内计算对应转速（演示模式）
            const stage = e.target.getStage();
            if (!stage) return;
            const ptr   = stage.getPointerPosition();
            const grp   = this.group;
            const trans = grp.getAbsoluteTransform().copy().invert();
            const lp    = trans.point(ptr);
            // 计算相对表盘中心的角度
            const dx = lp.x - this._dialCx;
            const dy = lp.y - this._dialCy;
            const clickAngle = Math.atan2(dy, dx) * 180 / Math.PI;
            // 将 clickAngle 映射回转速
            // needleAngleStart=225, range=270
            let relAngle = clickAngle - this._needleAngleStart;
            // 归一化到 0~range
            while (relAngle < 0) relAngle += 360;
            while (relAngle > 360) relAngle -= 360;
            if (relAngle <= this._needleAngleRange) {
                const frac = relAngle / this._needleAngleRange;
                this._targetSpeed = frac * this.maxSpeed;
            }
        });
        this._interactGroup.add(hitArea);
    }

    // ═══════════════════════════════════════════════════════
    // tick（物理循环）
    // ═══════════════════════════════════════════════════════

    /**
     * 每帧调用
     * @param {number} dt 帧时间步长（s）
     */
    tick(dt) {
        let dirty = false;

        // ── 一阶惯性滤波（模拟机械响应延迟）──
        // τ·dN/dt = N_target - N_disp
        // 离散：N[k] = N[k-1] + dt/τ · (N_target - N[k-1])
        const tau = Math.max(0.05, this._timeConst);
        const err = this._targetSpeed - this._dispSpeed;

        if (Math.abs(err) > 0.5) {
            this._dispSpeed += (dt / tau) * err;
            this._dispSpeed = Math.max(0, Math.min(this.maxSpeed, this._dispSpeed));
            dirty = true;
        }

        // ── 主轴转速 → 旋转相位 ──
        // 机构动画：只要转速 > 0 就让轴线滚动
        if (this._dispSpeed > 1) {
            // 旋转角速度 = 2π·n/60 rad/s，缩放到视觉可见速度
            const visualOmega = (this._dispSpeed / this.maxSpeed) * 8;  // 最高 8 rad/s（视觉速度）
            this._shaftPhase = (this._shaftPhase + visualOmega * dt) % (2 * Math.PI);
            dirty = true;
        }

        if (dirty) {
            this._rebuildDynamic();
            this.markDirty();
        }

        this._refreshIfDirty();
    }

    // ═══════════════════════════════════════════════════════
    // 公开 API
    // ═══════════════════════════════════════════════════════

    /**
     * 设置转速（外部驱动）
     * @param {number} rpm 转速（r/min）
     */
    setSpeed(rpm) {
        this._targetSpeed = Math.max(0, Math.min(this.maxSpeed, rpm));
    }

    /** 获取当前显示转速 */
    getDisplaySpeed() { return this._dispSpeed; }

    /** 获取当前设定转速 */
    getTargetSpeed()  { return this._targetSpeed; }

    /**
     * update()：接收 signal 输入（转速 rpm）
     * @param {number} rpm
     */
    update(rpm) {
        if (typeof rpm === 'number') {
            this.setSpeed(rpm);
        }
    }

    getConfigFields() {
        return [
            { label: '位号',            key: 'label',         type: 'text'   },
            { label: '额定转速 (rpm)',  key: 'ratedSpeed',    type: 'number' },
            { label: '量程最大值 (rpm)',key: 'maxSpeed',      type: 'number' },
            { label: '初始转速 (rpm)',  key: 'initSpeed',     type: 'number' },
            { label: '响应时间常数 (s)',key: 'timeConst',     type: 'number' },
            { label: '显示离心机构(1/0)',key: 'showMechanism',type: 'number' },
        ];
    }

    onConfigUpdate(cfg) {
        if (cfg.label         !== undefined) this.label         = cfg.label;
        if (cfg.ratedSpeed    !== undefined) this.ratedSpeed    = parseFloat(cfg.ratedSpeed);
        if (cfg.maxSpeed      !== undefined) this.maxSpeed      = parseFloat(cfg.maxSpeed);
        if (cfg.timeConst     !== undefined) this._timeConst    = parseFloat(cfg.timeConst);
        if (cfg.showMechanism !== undefined) this._showMechanism = !!parseInt(cfg.showMechanism);
        if (cfg.initSpeed     !== undefined) {
            this._targetSpeed = parseFloat(cfg.initSpeed);
            this._dispSpeed   = this._targetSpeed;
        }

        this.config = { ...this.config, ...cfg };
        this._recalcGeometry();
        this._staticGroup.destroyChildren();
        this._drawStaticParts();
        this._rebuildDynamic();
        this._refreshCache();
    }

    destroy() {
        super.destroy?.();
    }
}
