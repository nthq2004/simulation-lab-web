import { BaseComponent } from './BaseComponent.js';

/**
 * 磁感应涡流式转速指示仪表仿真组件
 * （Eddy-Current / Magnetic Drag Tachometer）
 *
 * ── 工作原理 ──────────────────────────────────────────────────
 *
 *  本仪表属于"磁感应式"（涡流拖动式）转速表，结构完全机械，
 *  无需电源，常见于汽车、船舶、内燃机本地就地显示。
 *
 *  一、旋转磁铁（Rotating Magnet）
 *  ┌────────────────────────────────────────────────────────┐
 *  │  与被测轴通过软轴（Flexible Cable）连接的永久磁铁组件     │
 *  │  转速 n → 磁铁以相同角速度 ω = 2πn/60 旋转              │
 *  │  产生旋转磁场（类似两极异步电机定子磁场）                 │
 *  └────────────────────────────────────────────────────────┘
 *
 *  二、铝盘（Aluminium Drag Cup / Disc）
 *  ┌────────────────────────────────────────────────────────┐
 *  │  非磁性铝盘（或铝罩）与磁铁同轴但相互独立               │
 *  │  旋转磁场切割铝盘 → 感应涡流 I_eddy                     │
 *  │  涡流在旋转磁场中受安培力（拖动力矩 M_d）：               │
 *  │    M_d = K_e · Φ² · n（正比于转速）                     │
 *  │  铝盘跟随磁铁旋转方向偏转                               │
 *  └────────────────────────────────────────────────────────┘
 *
 *  三、回程弹簧（Return / Hair Spring）
 *  ┌────────────────────────────────────────────────────────┐
 *  │  螺旋形游丝（Hair Spring）产生复原力矩 M_r = C·θ        │
 *  │  平衡时：M_d = M_r → K_e·Φ²·n = C·θ                   │
 *  │  ∴ 偏角 θ = (K_e·Φ²/C) · n  ∝  n （线性）              │
 *  │  实际仪表通过凸轮刻度板修正为线性刻度                    │
 *  └────────────────────────────────────────────────────────┘
 *
 *  四、指针 & 表盘
 *  ┌────────────────────────────────────────────────────────┐
 *  │  指针固连铝盘轴，随铝盘偏转指示转速                      │
 *  │  表盘刻度经温度补偿修正（游丝弹性模量随温度变化）         │
 *  └────────────────────────────────────────────────────────┘
 *
 *  五、动力学模型（本仿真）
 *  ┌────────────────────────────────────────────────────────┐
 *  │  铝盘等效为二阶阻尼系统：                                │
 *  │    J·θ'' + b·θ' + C·θ = K_e·Φ²·n                      │
 *  │  其中：                                                  │
 *  │    J = 铝盘转动惯量（决定响应速度）                      │
 *  │    b = 涡流自阻尼 + 机械摩擦                             │
 *  │    C = 游丝系数                                          │
 *  │  → 自然频率 ωₙ = √(C/J)，阻尼比 ζ = b/(2√(JC))         │
 *  │  典型参数：ωₙ ≈ 8~15 rad/s，ζ ≈ 0.6~0.8（接近临界阻尼）│
 *  └────────────────────────────────────────────────────────┘
 *
 * ── 结构布局（正视剖面图，上至下） ──────────────────────────────
 *
 *   ┌─────────────────────────────────────────────┐
 *   │   [位号]        磁感应转速表    [量程]        │  ← 铭牌
 *   ├─────────────────────────────────────────────┤
 *   │         ┌───────────────────────┐            │
 *   │         │    半圆表盘 + 刻度     │            │  ← 表盘区
 *   │         │        ↑ 指针          │            │
 *   │         └───────────────────────┘            │
 *   ├─────────────────────────────────────────────┤
 *   │  ┌──────────────────────────────────────┐   │
 *   │  │          机构剖视示意                 │   │  ← 内部结构区
 *   │  │  [软轴]→[旋转磁铁]  [铝盘]  [游丝]   │   │
 *   │  │      N↗↙S 旋转        ↻偏转  ⊙螺旋  │   │
 *   │  └──────────────────────────────────────┘   │
 *   └─────────────────────────────────────────────┘
 *              ▲ shaft（软轴驱动端口，底部中央）
 *
 * ── 端口 ─────────────────────────────────────────────────────
 *  shaft — 软轴/传动轴输入（signal，底部中央）
 *          输入值为转速 rpm
 *
 * ── 可配置参数 ────────────────────────────────────────────────
 *  label        : 位号（默认 'n'）
 *  maxSpeed     : 量程最大值 rpm（默认 3000）
 *  ratedSpeed   : 额定转速 rpm（默认 1500）
 *  initSpeed    : 初始转速（默认 0）
 *  omegaN       : 铝盘自然角频率 rad/s（默认 10，越大响应越快）
 *  zeta         : 阻尼比（默认 0.70，接近临界阻尼，少量超调）
 *  showInternal : 是否显示机构剖视（默认 true）
 */
export class EddyCurrentTachometer extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.width  = Math.max(210, config.width  || 260);
        this.height = Math.max(300, config.height || 350);

        this.type    = 'eddy_current_tachometer';
        this.special = 'none';
        this.cache   = 'fixed';

        this._initGroups();
        this._recalcGeometry();
        this._initParameters(config);
        this._init();

        this.config = {
            label       : this.label,
            maxSpeed    : this.maxSpeed,
            ratedSpeed  : this.ratedSpeed,
            initSpeed   : this._targetSpeed,
            omegaN      : this._omegaN,
            zeta        : this._zeta,
            showInternal: this._showInternal,
        };

        this.addPort(this._shaftPort.x-72, this._shaftPort.y+2, 'shaft', 'pipe');
    }

    // ═══════════════════════════════════════════════════════
    // 几何计算
    // ═══════════════════════════════════════════════════════

    _recalcGeometry() {
        const W = this.width, H = this.height;

        // ── 外壳 ──
        this._case = {
            x: W * 0.03, y: H * 0.015,
            w: W * 0.94, h: H * 0.965,
            rx: Math.max(6, W * 0.032),
        };

        // ── 铭牌 ──
        this._np = {
            x: this._case.x + 2, y: this._case.y + 2,
            w: this._case.w - 4, h: H * 0.075,
        };

        // ── 表盘 ──
        this._dialCx = W / 2;
        this._dialCy = H * 0.385;
        this._dialR  = Math.min(W * 0.405, H * 0.285);

        // 指针
        this._pivotX = this._dialCx;
        this._pivotY = this._dialCy;
        this._ptrLen = this._dialR * 0.86;

        // 刻度角（Konva坐标：0°=右，顺时针）
        // 仪表零点左下，满量程右下，270°扫角
        this._scaleStartDeg = 210;
        this._scaleTotalDeg = 240;

        // ── 内部机构区 ──
        this._mechY  = this._dialCy + this._dialR + H * 0.045;
        this._mechH  = H * 0.295;
        this._mechCx = W / 2;

        // 三个子区横向排布：磁铁 | 铝盘 | 游丝
        const zoneW = W * 0.27;
        this._magnetZone = { cx: W * 0.22, cy: this._mechY + this._mechH * 0.52 };
        this._discZone   = { cx: W * 0.50, cy: this._mechY + this._mechH * 0.52 };
        this._springZone = { cx: W * 0.78, cy: this._mechY + this._mechH * 0.52 };

        // 磁铁参数
        this._magnetR   = Math.min(W * 0.10, this._mechH * 0.26);

        // 铝盘参数
        this._discR     = Math.min(W * 0.11, this._mechH * 0.28);
        this._discThick = W * 0.025;

        // 游丝参数
        this._springR   = Math.min(W * 0.09, this._mechH * 0.22);

        // 软轴连接线（磁铁到底部端口）
        this._shaftPort = { x: W / 2, y: H * 0.982 };
    }

    // ═══════════════════════════════════════════════════════
    // 参数初始化
    // ═══════════════════════════════════════════════════════

    _initParameters(config) {
        this.label         = config.label        || 'n';
        this.maxSpeed      = config.maxSpeed     || 3000;
        this.ratedSpeed    = config.ratedSpeed   || 1500;
        this._showInternal = config.showInternal !== undefined ? config.showInternal : true;

        // 二阶动力学参数
        this._omegaN = config.omegaN !== undefined ? config.omegaN : 10;   // rad/s
        this._zeta   = config.zeta   !== undefined ? config.zeta   : 0.70; // 阻尼比

        const init         = config.initSpeed || 0;
        this._targetSpeed  = init;
        // 铝盘偏角状态（rad）
        this._discAngle    = (init / this.maxSpeed) * Math.PI * 0.82;
        this._discVel      = 0;     // rad/s

        // 旋转磁铁视觉相位（rad）
        this._magnetPhase  = 0;
        // 涡流粒子动画
        this._eddyParticles = [];
        this._initEddyParticles();
    }

    /** 初始化涡流粒子池 */
    _initEddyParticles() {
        this._eddyParticles = [];
        for (let i = 0; i < 12; i++) {
            this._eddyParticles.push({
                angle  : (i / 12) * Math.PI * 2,   // 在铝盘上的角度
                r      : this._discR * (0.35 + Math.random() * 0.45),
                life   : Math.random(),             // 0~1
                speed  : 0.8 + Math.random() * 0.4,
                size   : 1.5 + Math.random() * 2,
            });
        }
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
        this._drawNameplate();
        this._drawDialFace();
        this._drawScale();
        this._drawRatedMark();
        if (this._showInternal) {
            this._drawMechFrame();
            this._drawMagnetStatic();
            this._drawDiscStatic();
            this._drawSpringStatic();
            this._drawCouplingArrows();
        }
    }

    /** 外壳 */
    _drawCase() {
        const c = this._case;
        // 阴影
        this._staticGroup.add(new Konva.Rect({
            x: c.x + 4, y: c.y + 4, width: c.w, height: c.h,
            fill: 'rgba(0,0,0,0.32)', cornerRadius: c.rx + 2,
        }));
        // 主体（浅色）
        this._staticGroup.add(new Konva.Rect({
            x: c.x, y: c.y, width: c.w, height: c.h,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint:   { x: c.w, y: c.h },
            fillLinearGradientColorStops: [
                0, '#f0f0f4', 0.35, '#e6e6ec', 0.7, '#dedee4', 1, '#d4d4dc',
            ],
            stroke: '#b0b0ba', strokeWidth: 1.5,
            cornerRadius: c.rx,
        }));
        // 顶部高光条
        this._staticGroup.add(new Konva.Rect({
            x: c.x + 4, y: c.y + 3, width: c.w - 8, height: c.h * 0.07,
            fill: 'rgba(255,255,255,0.25)', cornerRadius: [c.rx, c.rx, 0, 0],
        }));
        // 内嵌凹槽边框
        this._staticGroup.add(new Konva.Rect({
            x: c.x + 7, y: c.y + 7, width: c.w - 14, height: c.h - 14,
            fill: 'transparent', stroke: 'rgba(120,120,140,0.15)',
            strokeWidth: 1, cornerRadius: c.rx - 3,
        }));
    }

    /** 铭牌条 */
    _drawNameplate() {
        const np = this._np, W = this.width;
        const fs = Math.max(7, W * 0.044);

        this._staticGroup.add(new Konva.Rect({
            x: np.x, y: np.y, width: np.w, height: np.h,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint:   { x: np.w, y: 0 },
            fillLinearGradientColorStops: [
                0, '#e0e0e6', 0.5, '#ececf2', 1, '#e0e0e6',
            ],
            stroke: '#c0c0cc', strokeWidth: 0.8,
            cornerRadius: [this._case.rx, this._case.rx, 0, 0],
        }));
        this._staticGroup.add(new Konva.Text({
            x: np.x + 6, y: np.y, width: np.w * 0.45, height: np.h,
            text: this.label, fontSize: fs, fontStyle: 'bold',
            fill: '#1a3a6a', verticalAlign: 'middle',
        }));
        this._staticGroup.add(new Konva.Text({
            x: np.x + np.w * 0.40, y: np.y, width: np.w * 0.57, height: np.h,
            text: '磁感应式转速表', fontSize: fs,
            fill: '#556070', align: 'right', verticalAlign: 'middle',
        }));
    }

    /** 表盘底色（象牙白金属圆盘） */
    _drawDialFace() {
        const cx = this._dialCx, cy = this._dialCy, r = this._dialR;

        // 外圈锌合金框（拉丝）
        this._staticGroup.add(new Konva.Circle({
            x: cx, y: cy, radius: r + 8,
            fillLinearGradientStartPoint: { x: -(r + 8), y: 0 },
            fillLinearGradientEndPoint:   { x:  (r + 8), y: 0 },
            fillLinearGradientColorStops: [
                0, '#5a5a62', 0.28, '#aaaaB2', 0.50, '#d0d0d8',
                0.72, '#aaaaB2', 1, '#5a5a62',
            ],
        }));
        // 玻璃盖（蓝灰反光）
        this._staticGroup.add(new Konva.Circle({
            x: cx, y: cy, radius: r + 3,
            fillRadialGradientStartPoint:  { x: -r * 0.1, y: -r * 0.2 },
            fillRadialGradientEndPoint:    { x: -r * 0.1, y: -r * 0.2 },
            fillRadialGradientStartRadius: 0,
            fillRadialGradientEndRadius:   r * 1.5,
            fillRadialGradientColorStops:  [
                0, 'rgba(210,230,255,0.18)',
                0.4, 'rgba(180,210,255,0.06)',
                1, 'rgba(160,180,220,0.02)',
            ],
            stroke: '#808898', strokeWidth: 0.8,
        }));
        // 表盘底色（奶白）
        this._staticGroup.add(new Konva.Circle({
            x: cx, y: cy, radius: r + 1,
            fill: '#f4f2ec', stroke: '#d8d4c6', strokeWidth: 0.8,
        }));
        // 中心散射高光
        this._staticGroup.add(new Konva.Circle({
            x: cx - r * 0.10, y: cy - r * 0.12, radius: r * 0.52,
            fillRadialGradientStartPoint:  { x: 0, y: 0 },
            fillRadialGradientEndPoint:    { x: 0, y: 0 },
            fillRadialGradientStartRadius: 0,
            fillRadialGradientEndRadius:   r * 0.52,
            fillRadialGradientColorStops:  [
                0, 'rgba(255,255,255,0.24)', 1, 'rgba(255,255,255,0)',
            ],
            listening: false,
        }));
    }

    /** 表盘刻度 */
    _drawScale() {
        const cx   = this._dialCx, cy = this._dialCy, r = this._dialR;
        const sD   = this._scaleStartDeg, tD = this._scaleTotalDeg;
        const nMax = this.maxSpeed;
        const majorDivs = 6, minorPer = 5;

        // ── 色带 ──
        const n110 = Math.min(this.ratedSpeed * 1.1, nMax);
        this._drawArcBand(cx, cy, r * 0.77, r * 0.83,
            sD, sD + (this.ratedSpeed / nMax) * tD, '#43a047', 0.68);
        this._drawArcBand(cx, cy, r * 0.77, r * 0.83,
            sD + (this.ratedSpeed / nMax) * tD,
            sD + (n110 / nMax) * tD, '#ffb300', 0.76);
        if (n110 < nMax) {
            this._drawArcBand(cx, cy, r * 0.77, r * 0.83,
                sD + (n110 / nMax) * tD, sD + tD, '#e53935', 0.74);
        }

        // ── 主刻度 + 数字 ──
        for (let i = 0; i <= majorDivs; i++) {
            const f   = i / majorDivs;
            const rad = (sD + f * tD) * Math.PI / 180;
            const c0  = Math.cos(rad), s0 = Math.sin(rad);
            // 刻度线
            this._staticGroup.add(new Konva.Line({
                points: [
                    cx + r * 0.83 * c0, cy + r * 0.83 * s0,
                    cx + r * 0.97 * c0, cy + r * 0.97 * s0,
                ],
                stroke: '#1a1a22', strokeWidth: 2.0, lineCap: 'round',
            }));
            // 数字
            const val = Math.round(f * nMax);
            const fs  = Math.max(7, this.width * 0.038);
            const rt  = r * 0.67;
            const lbl = val >= 1000 ? (val / 1000).toFixed(1) + 'k' : String(val);
            this._staticGroup.add(new Konva.Text({
                x: cx + rt * c0 - 16, y: cy + rt * s0 - fs * 0.6,
                width: 32, height: fs * 1.3,
                text: lbl, fontSize: fs, fontStyle: 'bold',
                fill: '#1a1a28', align: 'center',
            }));
        }

        // ── 次刻度 ──
        const total = majorDivs * minorPer;
        for (let i = 1; i < total; i++) {
            if (i % minorPer === 0) continue;
            const f   = i / total;
            const rad = (sD + f * tD) * Math.PI / 180;
            const c0  = Math.cos(rad), s0 = Math.sin(rad);
            const mid = i % minorPer === Math.floor(minorPer / 2);
            this._staticGroup.add(new Konva.Line({
                points: [
                    cx + r * (mid ? 0.88 : 0.91) * c0, cy + r * (mid ? 0.88 : 0.91) * s0,
                    cx + r * 0.97 * c0, cy + r * 0.97 * s0,
                ],
                stroke: '#333', strokeWidth: mid ? 1.2 : 0.8, lineCap: 'round',
            }));
        }

        // 弧线底边
        this._drawArcBand(cx, cy, r * 0.965, r * 0.98, sD, sD + tD, '#2a2a32', 0.6);
    }

    _drawArcBand(cx, cy, r0, r1, a0, a1, color, opacity) {
        const steps = Math.max(6, Math.round(Math.abs(a1 - a0) / 4));
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
            points: pts, fill: color, closed: true, opacity, listening: false,
        }));
    }

    /** 额定转速三角标 */
    _drawRatedMark() {
        const cx = this._dialCx, cy = this._dialCy, r = this._dialR;
        const rad = (this._scaleStartDeg + (this.ratedSpeed / this.maxSpeed) * this._scaleTotalDeg) * Math.PI / 180;
        const rm  = r * 0.74;
        const mx  = cx + rm * Math.cos(rad), my = cy + rm * Math.sin(rad);
        const ts  = 5, pr = rad + Math.PI / 2;
        this._staticGroup.add(new Konva.Line({
            points: [
                mx + ts * Math.cos(pr), my + ts * Math.sin(pr),
                mx - ts * Math.cos(pr), my - ts * Math.sin(pr),
                mx - ts * 1.6 * Math.cos(rad), my - ts * 1.6 * Math.sin(rad),
            ],
            fill: '#d32f2f', stroke: '#b71c1c', strokeWidth: 0.5,
            closed: true, listening: false,
        }));
    }

    /** 单位 & 量程文字 */
    _drawUnitLabel() {
        const cx = this._dialCx, cy = this._dialCy, r = this._dialR;
        const fs = Math.max(6, this.width * 0.037);
        this._staticGroup.add(new Konva.Text({
            x: cx - r * 0.55, y: cy + r * 0.44,
            width: r * 1.10, height: fs * 1.3,
            text: `0 – ${this.maxSpeed}`,
            fontSize: fs * 0.84, fill: '#566677', align: 'center',
        }));
    }

    /** 内部机构区外框 */
    _drawMechFrame() {
        const W  = this.width;
        const fx = W * 0.04, fy = this._mechY - 3;
        const fw = W * 0.92, fh = this._mechH - 8;
        this._staticGroup.add(new Konva.Rect({
            x: fx, y: fy, width: fw, height: fh,
            fill: '#eef0f2', stroke: '#c8ccd0',
            strokeWidth: 1, cornerRadius: 5,
        }));
        // 中轴线（磁铁—铝盘—游丝对齐轴）
        const axisY = this._magnetZone.cy;
        this._staticGroup.add(new Konva.Line({
            points: [W * 0.06, axisY, W * 0.94, axisY],
            stroke: 'rgba(160,170,190,0.30)', strokeWidth: 0.8,
            dash: [6, 4], listening: false,
        }));
    }

    /** 旋转磁铁静态部分（壳体 + 轴） */
    _drawMagnetStatic() {
        const { cx, cy } = this._magnetZone;
        const mr = this._magnetR;

        // 磁铁外壳（圆形，表示截面）
        this._staticGroup.add(new Konva.Circle({
            x: cx, y: cy, radius: mr + 4,
            fill: '#252530', stroke: '#384048', strokeWidth: 1,
        }));
        // 磁铁转轴孔
        this._staticGroup.add(new Konva.Circle({
            x: cx, y: cy, radius: mr * 0.14,
            fill: '#1a1a22', stroke: '#404850', strokeWidth: 0.8,
        }));
        // 软轴连接端（向下延伸到端口）
        const portY = this._shaftPort.y;
        this._staticGroup.add(new Konva.Line({
            points: [cx, cy + mr + 4, cx, cy + mr + 12],
            stroke: '#607080', strokeWidth: 2.5, lineCap: 'round',
        }));
    }


    /** 铝盘静态部分（盘体轮廓） */
    _drawDiscStatic() {
        const { cx, cy } = this._discZone;
        const dr = this._discR;
        const dt = this._discThick;

        // 铝盘侧视（正视为圆盘边缘，表现厚度）
        // 外圆（铝盘正面）
        this._staticGroup.add(new Konva.Circle({
            x: cx, y: cy, radius: dr + 3,
            fill: '#1c2028', stroke: '#303848', strokeWidth: 0.8,
        }));
        // 铝盘圆环（边缘厚度感）
        this._staticGroup.add(new Konva.Ring({
            x: cx, y: cy,
            innerRadius: dr * 0.15,
            outerRadius: dr,
            fillLinearGradientStartPoint: { x: -dr, y: 0 },
            fillLinearGradientEndPoint:   { x:  dr, y: 0 },
            fillLinearGradientColorStops: [
                0, '#5a6070', 0.3, '#9aA0b0', 0.5, '#c0c8d4',
                0.7, '#9aA0b0', 1, '#5a6070',
            ],
            stroke: '#485060', strokeWidth: 0.8,
        }));
        // 铝盘中心轴孔
        this._staticGroup.add(new Konva.Circle({
            x: cx, y: cy, radius: dr * 0.15,
            fill: '#282830', stroke: '#404858', strokeWidth: 0.8,
        }));
    }

    /** 回程游丝静态（外框） */
    _drawSpringStatic() {
        const { cx, cy } = this._springZone;
        const sr = this._springR;

        // 游丝盒外壳
        this._staticGroup.add(new Konva.Circle({
            x: cx, y: cy, radius: sr + 5,
            fill: '#1a1e26', stroke: '#2c3440', strokeWidth: 1,
        }));
        // 游丝盒盖（浅灰金属）
        this._staticGroup.add(new Konva.Circle({
            x: cx, y: cy, radius: sr + 3,
            fillLinearGradientStartPoint: { x: -(sr+3), y: 0 },
            fillLinearGradientEndPoint:   { x:  (sr+3), y: 0 },
            fillLinearGradientColorStops: [
                0, '#484860', 0.5, '#7878a0', 1, '#484860',
            ],
            stroke: '#585878', strokeWidth: 0.8,
        }));
        // 中心轴
        this._staticGroup.add(new Konva.Circle({
            x: cx, y: cy, radius: sr * 0.12,
            fill: '#2a2a38', stroke: '#484860', strokeWidth: 0.8,
        }));
    }

    /** 机构区各子区标签 */
    _drawMechLabels() {
        const W  = this.width;
        const fs = Math.max(6, W * 0.034);
        const topY = this._mechY + 4;
        [
            { x: this._magnetZone.cx, label: '旋转磁铁' },
            { x: this._discZone.cx,   label: '铝  盘'  },
            { x: this._springZone.cx, label: '回程游丝' },
        ].forEach(({ x, label }) => {
            this._staticGroup.add(new Konva.Text({
                x: x - 28, y: topY, width: 56, height: 13,
                text: label, fontSize: fs, fill: '#5a7888', align: 'center',
            }));
        });
        // 底部文字说明
        const botY = this._mechY + this._mechH - 14;
        this._staticGroup.add(new Konva.Text({
            x: W * 0.04, y: botY, width: W * 0.92, height: 12,
            text: '涡流拖动力矩 M_d = K·Φ²·n  /  回程力矩 M_r = C·θ  →  θ ∝ n',
            fontSize: Math.max(5, W * 0.030), fill: '#384858', align: 'center',
        }));
    }

    /** 子区间耦合箭头（静态） */
    _drawCouplingArrows() {
        // 磁铁 → 铝盘（涡流感应，波浪箭头）
        const mx  = this._magnetZone.cx + this._magnetR + 4;
        const dx  = this._discZone.cx   - this._discR   - 4;
        const ay  = this._magnetZone.cy;
        const mid = (mx + dx) / 2;
        // 磁力线弧
        this._staticGroup.add(new Konva.Arrow({
            points: [mx, ay, mid, ay - 8, dx, ay],
            stroke: 'rgba(255,200,60,0.45)', fill: 'rgba(255,200,60,0.45)',
            strokeWidth: 1.5, tension: 0.5,
            pointerLength: 5, pointerWidth: 4, listening: false,
        }));
        // 铝盘 → 游丝（力矩传递，实线箭头）
        const sx1 = this._discZone.cx   + this._discR   + 4;
        const sx2 = this._springZone.cx - this._springR - 4;
        const ay2 = this._discZone.cy;
        this._staticGroup.add(new Konva.Arrow({
            points: [sx1, ay2, sx2, ay2],
            stroke: 'rgba(140,200,140,0.50)', fill: 'rgba(140,200,140,0.50)',
            strokeWidth: 1.5,
            pointerLength: 5, pointerWidth: 4, listening: false,
        }));
    }

    // ═══════════════════════════════════════════════════════
    // 动态层重建
    // ═══════════════════════════════════════════════════════

    _rebuildDynamic() {
        this._dynamicGroup.destroyChildren();

        const nMax = this.maxSpeed;
        const frac = Math.min(1, Math.max(0, this._discAngle / (Math.PI * 0.82)));

        this._drawNeedle(frac);
        this._drawNeedlePivot();
        this._drawSpeedDisplay(frac * nMax);
        if (this._showInternal) {
            this._drawMagnetDynamic();
            this._drawDiscDynamic(frac);
            this._drawSpringDynamic(frac);
            this._drawEddyParticles(frac);
        }
    }

    /** 指针 */
    _drawNeedle(frac) {
        const cx  = this._pivotX, cy = this._pivotY;
        const pL  = this._ptrLen;
        const aDeg = this._scaleStartDeg + frac * this._scaleTotalDeg;
        const aRad = aDeg * Math.PI / 180;
        const cos  = Math.cos(aRad), sin = Math.sin(aRad);
        const tipX = cx + pL * cos, tipY = cy + pL * sin;
        const bHW  = 5.5;
        const prp  = aRad + Math.PI / 2;

        // 阴影
        this._dynamicGroup.add(new Konva.Line({
            points: [cx + 2, cy + 2, tipX + 2, tipY + 2],
            stroke: 'rgba(0,0,0,0.18)', strokeWidth: 4,
            lineCap: 'round', listening: false,
        }));
        // 指针（刀形，深蓝黑）
        this._dynamicGroup.add(new Konva.Line({
            points: [
                cx + bHW * Math.cos(prp), cy + bHW * Math.sin(prp),
                cx - bHW * Math.cos(prp), cy - bHW * Math.sin(prp),
                tipX, tipY,
            ],
            fill: '#0d2a4a', stroke: '#0a1e36', strokeWidth: 0.8,
            closed: true, listening: false,
        }));
        // 指针高光（中脊线）
        this._dynamicGroup.add(new Konva.Line({
            points: [cx, cy, cx + pL * 0.75 * cos, cy + pL * 0.75 * sin],
            stroke: 'rgba(80,140,220,0.40)', strokeWidth: 1.2,
            lineCap: 'round', listening: false,
        }));
        // 配重块（尾部）
        const tL = pL * 0.22;
        this._dynamicGroup.add(new Konva.Line({
            points: [cx - tL * 0.3 * cos, cy - tL * 0.3 * sin, cx - tL * cos, cy - tL * sin],
            stroke: '#7a8090', strokeWidth: 5.5, lineCap: 'round', listening: false,
        }));
    }

    /** 指针轴心 */
    _drawNeedlePivot() {
        const cx = this._pivotX, cy = this._pivotY;
        this._dynamicGroup.add(new Konva.Circle({
            x: cx, y: cy, radius: 7.5,
            fillLinearGradientStartPoint: { x: -5, y: -5 },
            fillLinearGradientEndPoint:   { x:  5, y:  5 },
            fillLinearGradientColorStops: [0, '#c0c8d8', 0.5, '#e8eef8', 1, '#808898'],
            stroke: '#505870', strokeWidth: 1,
        }));
        this._dynamicGroup.add(new Konva.Circle({
            x: cx, y: cy, radius: 2.8, fill: '#1a2030',
        }));
    }

    /** 数字显示（表盘下部液晶条） */
    _drawSpeedDisplay(n) {
        const cx = this._dialCx, cy = this._dialCy-40, r = this._dialR;
        const bw = r * 1.15, bh = r * 0.22;
        const bx = cx - bw / 2, by = cy + r * 0.58;

        this._dynamicGroup.add(new Konva.Rect({
            x: bx, y: by, width: bw, height: bh,
            fill: '#040c04', stroke: '#182018', strokeWidth: 1, cornerRadius: 3,
        }));
        this._dynamicGroup.add(new Konva.Text({
            x: bx + 3, y: by + bh * 0.08,
            width: bw - 6, height: bh * 0.9,
            text: n.toFixed(0).padStart(4, ' ') + ' r/min',
            fontSize: Math.max(7, bh * 0.52),
            fontFamily: 'Courier New, monospace', fontStyle: 'bold',
            fill: '#44ddcc', align: 'center', verticalAlign: 'middle',
        }));
    }

    /**
     * 旋转磁铁动画（两极永磁铁随相位旋转）
     * 磁铁绘制：圆形截面，N/S两极用颜色区分，随 _magnetPhase 旋转
     */
    _drawMagnetDynamic() {
        const { cx, cy } = this._magnetZone;
        const mr   = this._magnetR;
        const φ    = this._magnetPhase;   // 当前旋转相位（rad）

        // 磁铁圆盘（旋转）
        const magnetGroup = new Konva.Group({ x: cx, y: cy, rotation: φ * 180 / Math.PI });

        // N 极（上半弧，红色）
        magnetGroup.add(new Konva.Arc({
            x: 0, y: 0,
            innerRadius: mr * 0.28,
            outerRadius: mr,
            angle: 180,
            rotation: -90,
            fill: '#c62828',
            stroke: '#8a1a1a', strokeWidth: 0.8,
        }));
        // S 极（下半弧，蓝色）
        magnetGroup.add(new Konva.Arc({
            x: 0, y: 0,
            innerRadius: mr * 0.28,
            outerRadius: mr,
            angle: 180,
            rotation: 90,
            fill: '#1565c0',
            stroke: '#0d3d82', strokeWidth: 0.8,
        }));
        // 分界线
        magnetGroup.add(new Konva.Line({
            points: [-mr, 0, mr, 0],
            stroke: '#1a1a28', strokeWidth: 1.5,
        }));
        // N 极标注
        magnetGroup.add(new Konva.Text({
            x: -8, y: -mr * 0.72,
            width: 16, height: mr * 0.50,
            text: 'N', fontSize: Math.max(7, mr * 0.42),
            fontStyle: 'bold', fill: '#ffcdd2', align: 'center',
        }));
        // S 极标注
        magnetGroup.add(new Konva.Text({
            x: -8, y: mr * 0.24,
            width: 16, height: mr * 0.50,
            text: 'S', fontSize: Math.max(7, mr * 0.42),
            fontStyle: 'bold', fill: '#bbdefb', align: 'center',
        }));
        // 磁铁中心轴
        magnetGroup.add(new Konva.Circle({
            x: 0, y: 0, radius: mr * 0.14,
            fill: '#303040', stroke: '#505060', strokeWidth: 0.8,
        }));

        this._dynamicGroup.add(magnetGroup);

        // 旋转磁场辐射光圈（转速越高越亮）
        const nFrac = Math.min(1, (this._targetSpeed / this.maxSpeed));
        if (nFrac > 0.03) {
            const glowAlpha = nFrac * 0.28;
            this._dynamicGroup.add(new Konva.Circle({
                x: cx, y: cy, radius: mr + 6,
                fillRadialGradientStartPoint:  { x: 0, y: 0 },
                fillRadialGradientEndPoint:    { x: 0, y: 0 },
                fillRadialGradientStartRadius: mr * 0.6,
                fillRadialGradientEndRadius:   mr + 6,
                fillRadialGradientColorStops:  [
                    0, `rgba(255,180,60,${(glowAlpha * 1.2).toFixed(2)})`,
                    1, 'rgba(255,160,40,0)',
                ],
                listening: false,
            }));
        }
    }

    /**
     * 铝盘动画（铝盘随偏角偏转，叠加辐射纹）
     * @param {number} frac 0~1（偏角比）
     */
    _drawDiscDynamic(frac) {
        const { cx, cy } = this._discZone;
        const dr = this._discR;

        // 偏角（铝盘偏转方向与磁铁旋转方向相同）
        const dispAngle = frac * 300;   // °（最大偏转300°，仅视觉）

        // 铝盘旋转组
        const discGroup = new Konva.Group({ x: cx, y: cy, rotation: dispAngle });

        // 铝盘面（辐射条纹，表现涡流路径）
        const spokes = 8;
        for (let i = 0; i < spokes; i++) {
            const a = (i / spokes) * Math.PI * 2;
            const alpha = 0.10 + 0.08 * Math.abs(Math.sin(a + frac * Math.PI));
            discGroup.add(new Konva.Line({
                points: [dr * 0.18 * Math.cos(a), dr * 0.18 * Math.sin(a),
                         dr * 0.92 * Math.cos(a), dr * 0.92 * Math.sin(a)],
                stroke: `rgba(200,220,255,${alpha.toFixed(2)})`,
                strokeWidth: 0.9, lineCap: 'round', listening: false,
            }));
        }

        // 铝盘正面（叠加涡流感应色调）
        const eddyAlpha = 0.06 + frac * 0.14;
        discGroup.add(new Konva.Ring({
            x: 0, y: 0,
            innerRadius: dr * 0.16,
            outerRadius: dr * 0.95,
            fillLinearGradientStartPoint: { x: -dr, y: -dr * 0.5 },
            fillLinearGradientEndPoint:   { x:  dr, y:  dr * 0.5 },
            fillLinearGradientColorStops: [
                0,   '#7a8898',
                0.35, `rgba(180,200,255,${(0.15 + frac * 0.20).toFixed(2)})`,
                0.65, '#9aaabb',
                1,   '#6a7888',
            ],
            stroke: '#607080', strokeWidth: 0.5,
        }));

        // 参考标线（显示铝盘偏转量）
        discGroup.add(new Konva.Line({
            points: [0, -dr * 0.18, 0, -dr * 0.88],
            stroke: 'rgba(255,220,80,0.60)', strokeWidth: 1.8,
            lineCap: 'round', listening: false,
        }));

        this._dynamicGroup.add(discGroup);

        // 铝盘轴心
        this._dynamicGroup.add(new Konva.Circle({
            x: cx, y: cy, radius: dr * 0.16,
            fillLinearGradientStartPoint: { x: -dr*0.12, y: -dr*0.12 },
            fillLinearGradientEndPoint:   { x:  dr*0.12, y:  dr*0.12 },
            fillLinearGradientColorStops: [0, '#909898', 0.5, '#d0d8d8', 1, '#707878'],
            stroke: '#505858', strokeWidth: 0.8,
        }));
    }

    /**
     * 回程游丝动画（阿基米德螺旋，随偏角张紧）
     * @param {number} frac 0~1
     */
    _drawSpringDynamic(frac) {
        const { cx, cy } = this._springZone;
        const sr     = this._springR;
        const turns  = 4.0;
        const steps  = 150;
        const minR   = sr * 0.14;
        const rRange = (sr - minR) * (0.45 + frac * 0.55);

        const pts = [];
        // 游丝相位随偏角偏移（内端固定轴，外端随铝盘偏转）
        const phaseOffset = frac * Math.PI * 0.8;
        for (let i = 0; i <= steps; i++) {
            const t   = i / steps;
            const a   = t * turns * 2 * Math.PI + phaseOffset;
            const rad = minR + rRange * t;
            pts.push(cx + rad * Math.cos(a), cy + rad * Math.sin(a));
        }

        // 游丝颜色随张紧度变化
        const tension = frac;
        const r_ch = Math.round(100 + tension * 120);
        const g_ch = Math.round(160 - tension * 80);
        const b_ch = Math.round(200 - tension * 100);
        this._dynamicGroup.add(new Konva.Line({
            points: pts,
            stroke: `rgb(${r_ch},${g_ch},${b_ch})`,
            strokeWidth: 0.9, lineJoin: 'round', lineCap: 'round',
            listening: false,
        }));

        // 外端固定夹（游丝锚点）
        const anchorAngle = phaseOffset + turns * 2 * Math.PI;
        this._dynamicGroup.add(new Konva.Circle({
            x: cx + sr * Math.cos(anchorAngle),
            y: cy + sr * Math.sin(anchorAngle),
            radius: 2.5, fill: '#a0b0c0', stroke: '#707888', strokeWidth: 0.8,
        }));
        // 内端轴心
        this._dynamicGroup.add(new Konva.Circle({
            x: cx, y: cy, radius: sr * 0.14,
            fill: '#606878', stroke: '#485060', strokeWidth: 0.8,
        }));
    }

    /**
     * 涡流粒子动画（在铝盘上漂移的发光点）
     * @param {number} frac 转速比 0~1
     */
    _drawEddyParticles(frac) {
        if (frac < 0.04) return;

        const { cx, cy } = this._discZone;
        const dr = this._discR;

        this._eddyParticles.forEach(p => {
            const x = cx + p.r * Math.cos(p.angle);
            const y = cy + p.r * Math.sin(p.angle);
            const glow = 0.5 + 0.5 * Math.sin(p.life * Math.PI);
            const alpha = glow * Math.min(1, frac * 2.5) * 0.75;
            const col   = frac > 0.6
                ? `rgba(255,160,60,${alpha.toFixed(2)})`
                : `rgba(120,180,255,${alpha.toFixed(2)})`;

            this._dynamicGroup.add(new Konva.Circle({
                x, y, radius: p.size * (0.7 + glow * 0.5),
                fill: col, listening: false,
            }));
            // 粒子尾迹（短弧，顺磁铁旋转方向）
            const tailAngle = p.angle - frac * 0.4;
            const tx = cx + p.r * Math.cos(tailAngle);
            const ty = cy + p.r * Math.sin(tailAngle);
            this._dynamicGroup.add(new Konva.Line({
                points: [tx, ty, x, y],
                stroke: col, strokeWidth: p.size * 0.6,
                lineCap: 'round', listening: false,
            }));
        });
    }

    // ═══════════════════════════════════════════════════════
    // 交互
    // ═══════════════════════════════════════════════════════

    _bindInteraction() {
        const hitArea = new Konva.Circle({
            x: this._dialCx, y: this._dialCy,
            radius: this._dialR + 5, fill: 'transparent',
        });
        hitArea.on('click tap', (e) => {
            const stage = e.target.getStage();
            if (!stage) return;
            const ptr   = stage.getPointerPosition();
            const trans = this.group.getAbsoluteTransform().copy().invert();
            const lp    = trans.point(ptr);
            const dx    = lp.x - this._dialCx;
            const dy    = lp.y - this._dialCy;
            let relDeg  = (Math.atan2(dy, dx) * 180 / Math.PI - this._scaleStartDeg + 720) % 360;
            if (relDeg <= this._scaleTotalDeg) {
                this._targetSpeed = (relDeg / this._scaleTotalDeg) * this.maxSpeed;
            }
        });
        this._interactGroup.add(hitArea);
    }

    // ═══════════════════════════════════════════════════════
    // tick（物理循环）
    // ═══════════════════════════════════════════════════════

    tick(dt) {
        let dirty = false;

        // ── 旋转磁铁相位更新 ──
        // 视觉角速度：转速越高转得越快（最高 12 rad/s 视觉速度）
        const nFrac = Math.min(1, this._targetSpeed / this.maxSpeed);
        if (nFrac > 0.005) {
            const visOmega   = nFrac * 12;
            this._magnetPhase = (this._magnetPhase + visOmega * dt) % (2 * Math.PI);
            dirty = true;
        }

        // ── 铝盘二阶动力学 ──
        // J·θ'' + b·θ' + C·θ = K·n（简化为标准二阶系统）
        // θ_target = frac·θ_max（线性，对应转速）
        const θMax    = Math.PI * 0.82;
        const θTarget = nFrac * θMax;
        const ωn      = this._omegaN;
        const ζ       = this._zeta;
        const θ       = this._discAngle;
        const dθ      = this._discVel;

        const acc = ωn * ωn * (θTarget - θ) - 2 * ζ * ωn * dθ;
        this._discVel   += acc * dt;
        this._discAngle += this._discVel * dt;
        this._discAngle  = Math.max(0, Math.min(θMax, this._discAngle));

        if (Math.abs(θTarget - this._discAngle) > 0.0015 || Math.abs(this._discVel) > 0.004) {
            dirty = true;
        }

        // ── 涡流粒子推进 ──
        if (nFrac > 0.04) {
            this._eddyParticles.forEach(p => {
                // 粒子沿铝盘切线方向漂移（方向与磁铁旋转方向相同）
                p.angle  = (p.angle + nFrac * p.speed * dt * 3.5) % (Math.PI * 2);
                p.life   = (p.life + dt * (0.6 + nFrac * 1.2)) % 1;
            });
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
     * 设置转速
     * @param {number} rpm  r/min
     */
    setSpeed(rpm) {
        this._targetSpeed = Math.max(0, Math.min(this.maxSpeed, rpm));
    }

    getDisplaySpeed()  { return (this._discAngle / (Math.PI * 0.82)) * this.maxSpeed; }
    getTargetSpeed()   { return this._targetSpeed; }

    /** 通用 signal 输入（rpm） */
    update(val) {
        if (typeof val === 'number') this.setSpeed(val);
    }

    getConfigFields() {
        return [
            { label: '位号',             key: 'label',        type: 'text'   },
            { label: '量程最大值 (rpm)', key: 'maxSpeed',     type: 'number' },
            { label: '额定转速 (rpm)',   key: 'ratedSpeed',   type: 'number' },
            { label: '初始转速 (rpm)',   key: 'initSpeed',    type: 'number' },
            { label: '自然角频率 rad/s', key: 'omegaN',       type: 'number' },
            { label: '阻尼比 ζ',        key: 'zeta',         type: 'number' },
            { label: '显示内部机构(1/0)',key: 'showInternal', type: 'number' },
        ];
    }

    onConfigUpdate(cfg) {
        if (cfg.label        !== undefined) this.label         = cfg.label;
        if (cfg.maxSpeed     !== undefined) this.maxSpeed      = parseFloat(cfg.maxSpeed);
        if (cfg.ratedSpeed   !== undefined) this.ratedSpeed    = parseFloat(cfg.ratedSpeed);
        if (cfg.omegaN       !== undefined) this._omegaN       = parseFloat(cfg.omegaN);
        if (cfg.zeta         !== undefined) this._zeta         = parseFloat(cfg.zeta);
        if (cfg.showInternal !== undefined) this._showInternal = !!parseInt(cfg.showInternal);
        if (cfg.initSpeed    !== undefined) {
            this._targetSpeed = parseFloat(cfg.initSpeed);
            this._discAngle   = (this._targetSpeed / this.maxSpeed) * Math.PI * 0.82;
            this._discVel     = 0;
        }
        this.config = { ...this.config, ...cfg };
        this._recalcGeometry();
        this._staticGroup.destroyChildren();
        this._drawStaticParts();
        this._initEddyParticles();
        this._rebuildDynamic();
        this._refreshCache();
    }

    destroy() {
        super.destroy?.();
    }
}
