import { BaseComponent } from './BaseComponent.js';

/**
 * 磁电式转速指示仪表仿真组件
 * （Magnetoelectric Tachometer Indicator）
 *
 * ── 工作原理 ──────────────────────────────────────────────────
 *
 *  磁电式转速表由两部分组成：
 *
 *  一、测速发电机（Tachogenerator）
 *  ┌────────────────────────────────────────────────────────┐
 *  │  与被测轴同轴连接的永磁直流测速发电机（DC Tachogenerator）  │
 *  │  输出电压 E = K·n（E 正比于转速 n）                       │
 *  │  典型灵敏度 K ≈ 0.1 ~ 2.0 mV / (r·min⁻¹)                │
 *  └────────────────────────────────────────────────────────┘
 *
 *  二、磁电式电流表头（Moving-Coil Galvanometer）
 *  ┌────────────────────────────────────────────────────────┐
 *  │  核心结构：                                              │
 *  │   • 永久磁铁（U形磁轭 + 圆柱铁芯）→ 均匀径向磁场 B         │
 *  │   • 矩形可动线圈（N匝）置于磁隙中，两端引至弹片             │
 *  │   • 游丝（Hairspring）提供复原力矩                        │
 *  │   • 铝框阻尼（涡流阻尼）使指针平稳                        │
 *  │   • 指针固定在线圈轴上                                   │
 *  │                                                        │
 *  │  偏转方程：                                              │
 *  │   驱动力矩 M_d = N·B·L·a·I = N·B·L·a · E/R_total       │
 *  │   复原力矩 M_r = C·θ（C 为游丝系数）                     │
 *  │   平衡时：θ = (N·B·L·a / C·R) · E = S · n              │
 *  │   ∴ 偏转角 θ 与转速 n 成线性关系                         │
 *  └────────────────────────────────────────────────────────┘
 *
 *  三、信号链路：
 *    转速 n → 测速发电机 → EMF E=Kn → 限流电阻 R → 
 *    线圈电流 I=E/R → 力矩 M=NBLA·I → 指针偏角 θ = S·n
 *
 * ── 结构布局 ──────────────────────────────────────────────────
 *
 *   ┌──────────────────────────────────────────┐
 *   │  [位号]           [量程 r/min]            │  ← 铭牌区
 *   ├──────────────────────────────────────────┤
 *   │                                          │
 *   │         ┌──────────────────┐             │
 *   │         │   圆形表盘        │             │  ← 仪表表盘
 *   │         │   刻度弧线        │             │
 *   │         │     ↑指针         │             │
 *   │         └──────────────────┘             │
 *   │                                          │
 *   ├──────────────────────────────────────────┤
 *   │   [磁路截面示意]    [线圈/游丝示意]        │  ← 原理剖视区
 *   └──────────────────────────────────────────┘
 *      ▲sig+  ▲sig-（测速发电机输出端口，底部）
 *
 * ── 端口 ─────────────────────────────────────────────────────
 *  sigP — 测速发电机正极输入（signal，底部左）
 *  sigN — 测速发电机负极输入（signal，底部右）
 *         接入电压值 V，仪表内部换算为 rpm 显示
 *         也可直接接入 rpm 数值（由 inputMode 配置决定）
 *
 * ── 可配置参数 ────────────────────────────────────────────────
 *  label        : 位号（默认 'n'）
 *  maxSpeed     : 量程最大值 rpm（默认 3000）
 *  ratedSpeed   : 额定转速 rpm（默认 1500）
 *  sensitivity  : 测速发电机灵敏度 mV/(r·min⁻¹)（默认 0.5）
 *  inputMode    : 'voltage'=电压输入 | 'rpm'=直接转速输入（默认'rpm'）
 *  initSpeed    : 初始转速（默认 0）
 *  timeConst    : 响应时间常数 s（默认 0.3，磁电式响应快）
 *  showInternal : 是否显示内部结构示意（默认 true）
 */
export class MagnetoelectricTachometer extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.width  = Math.max(200, config.width  || 240);
        this.height = Math.max(280, config.height || 320);

        this.type    = 'magnetoelectric_tachometer';
        this.special = 'none';
        this.cache   = 'fixed';

        this._initGroups();
        this._recalcGeometry();
        this._initParameters(config);
        this._init();

        this.config = {
            id: this.id,
            label       : this.label,
            maxSpeed    : this.maxSpeed,
            ratedSpeed  : this.ratedSpeed,
            sensitivity : this._sensitivity,
            inputMode   : this._inputMode,
            initSpeed   : this._targetSpeed,
            timeConst   : this._timeConst,
            showInternal: this._showInternal,
        };

        // 端口：测速发电机输出（管道口，仅保留左侧信号正极）
        this.addPort(this._portP.x-24, this._portP.y+10, 'shaft', 'pipe');
    }

    // ═══════════════════════════════════════════════════════
    // 几何计算
    // ══════════════════════════════════════════════════════

    _recalcGeometry() {
        const W = this.width, H = this.height;

        // ── 外壳 ──
        this._case = {
            x: W * 0.03, y: H * 0.02,
            w: W * 0.94, h: H * 1.00,
            rx: Math.max(5, W * 0.035),
        };

        // ── 铭牌条（顶部）──
        this._nameplate = {
            x: this._case.x + 2,
            y: this._case.y + 2,
            w: this._case.w - 4,
            h: H * 0.08,
        };

        // ── 表盘区（中上部圆形）──
        this._dialCx = W / 2;
        this._dialCy = H * 0.40;
        this._dialR  = Math.min(W * 0.40, H * 0.30);

        // 指针枢轴
        this._pivotX = this._dialCx;
        this._pivotY = this._dialCy;

        // 指针长度
        this._ptrLen = this._dialR * 0.84;

        // 表盘扫角（经典D'Arsonval型：左 -60° 到 右 +60°，共 240°，基准向上）
        // Konva坐标：0°=右，顺时针
        // 仪表零点在左下，满量程在右下
        this._scaleStartDeg = 210;   // °（Konva坐标，对应0rpm，左下）
        this._scaleTotalDeg = 240;   // °（270° 扫角）

        // ── 内部结构示意区（下部） ──
        this._internalY  = this._dialCy + this._dialR + H * 0.05;
        this._internalH  = H * 0.26;
        this._internalCx = W / 2;

        // 磁铁截面（左侧）
        this._magnetCx = W * 0.28;
        this._magnetCy = this._internalY + this._internalH * 0.46;
        this._magnetW  = W * 0.28;
        this._magnetH  = this._internalH * 0.72;

        // 线圈/游丝示意（右侧）
        this._coilCx = W * 0.72;
        this._coilCy = this._magnetCy;
        this._coilR  = Math.min(W * 0.10, this._internalH * 0.28);

        // ── 端口（底部） ──
        this._portP = { x: W * 0.38, y: H * 0.985 };
    }

    // ═══════════════════════════════════════════════════════
    // 参数初始化
    // ═══════════════════════════════════════════════════════

    _initParameters(config) {
        this.label         = config.label        || 'n';
        this.maxSpeed      = config.maxSpeed     || 3000;
        this.ratedSpeed    = config.ratedSpeed   || 1500;
        this._sensitivity  = config.sensitivity  || 0.5;    // V/(r·min⁻¹)
        this._inputMode    = config.inputMode    || 'rpm';  // 'rpm' | 'voltage'
        this._timeConst    = config.timeConst    !== undefined ? config.timeConst : 0.3;
        this._showInternal = config.showInternal !== undefined ? config.showInternal : true;

        const init          = config.initSpeed || 0;
        this._targetSpeed   = init;
        this._dispSpeed     = init;

        // 线圈振动动画（模拟磁电式响应的轻微超调）
        this._coilAngle    = 0;     // 当前线圈偏角（rad，用于内部结构动画）
        this._coilVel      = 0;     // 角速度（rad/s，二阶动力学）
        this._coilOmegaN   = 12;    // 自然频率 rad/s（磁电式响应较快）
        this._coilZeta     = 0.72;  // 阻尼比（铝框涡流阻尼，略欠阻尼）

        // 测速发电机转子旋转相位
        this._generatorPhase = 0;

        // 游丝动画相位
        this._hairspringPhase = 0;
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
            this._drawInternalFrame();
            this._drawMagnetStatic();
            this._drawHairspringStatic();
        }
    }

    /** 外壳 */
    _drawCase() {
        const c = this._case;
        // 壳体阴影
        this._staticGroup.add(new Konva.Rect({
            x: c.x + 4, y: c.y + 4,
            width: c.w, height: c.h,
            fill: 'rgba(0,0,0,0.30)',
            cornerRadius: c.rx + 2,
        }));
        // 壳体主体（浅色）
        this._staticGroup.add(new Konva.Rect({
            x: c.x, y: c.y, width: c.w, height: c.h,
            fillLinearGradientStartPoint: { x: 0,   y: 0 },
            fillLinearGradientEndPoint:   { x: c.w, y: c.h },
            fillLinearGradientColorStops: [
                0,   '#f0f0f4',
                0.3, '#e6e6ec',
                0.7, '#dedee4',
                1,   '#d4d4dc',
            ],
            stroke: '#b0b0ba', strokeWidth: 1.5,
            cornerRadius: c.rx,
        }));
        // 顶部高光
        this._staticGroup.add(new Konva.Rect({
            x: c.x + 4,   y: c.y + 3,
            width: c.w - 8, height: c.h * 0.08,
            fill: 'rgba(255,255,255,0.25)',
            cornerRadius: [c.rx, c.rx, 0, 0],
        }));
        // 壳体边框装饰线
        this._staticGroup.add(new Konva.Rect({
            x: c.x + 6, y: c.y + 6,
            width: c.w - 12, height: c.h - 12,
            fill: 'transparent',
            stroke: 'rgba(120,120,140,0.15)',
            strokeWidth: 1,
            cornerRadius: c.rx - 2,
        }));
    }

    /** 铭牌（顶部条形） */
    _drawNameplate() {
        const np = this._nameplate;
        const W  = this.width;
        const fontSize = Math.max(12, W * 0.048);

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
        // 位号
        this._staticGroup.add(new Konva.Text({
            x: np.x + 6, y: np.y + np.h * 0.12,
            width: np.w * 0.5, height: np.h * 0.8,
            text: this.label,
            fontSize: fontSize,
            fontStyle: 'bold',
            fill: '#1a3a6a',
            verticalAlign: 'middle',
        }));
        // 仪表类型
        this._staticGroup.add(new Konva.Text({
            x: np.x + np.w * 0.45, y: np.y + np.h * 0.12,
            width: np.w * 0.52, height: np.h * 0.8,
            text: '磁电式转速表',
            fontSize: fontSize ,
            fill: '#556070',
            align: 'right',
            verticalAlign: 'middle',
        }));
    }

    /** 表盘底色 */
    _drawDialFace() {
        const cx = this._dialCx, cy = this._dialCy, r = this._dialR;

        // 外圈金属环（拉丝铝）
        this._staticGroup.add(new Konva.Circle({
            x: cx, y: cy, radius: r + 7,
            fillLinearGradientStartPoint: { x: -(r + 7), y: 0 },
            fillLinearGradientEndPoint:   { x:  (r + 7), y: 0 },
            fillLinearGradientColorStops: [
                0, '#606068', 0.25, '#b0b0b8',
                0.5, '#d0d0d8', 0.75, '#b0b0b8', 1, '#606068',
            ],
        }));
        // 表盘底色（象牙白）
        this._staticGroup.add(new Konva.Circle({
            x: cx, y: cy, radius: r + 2,
            fill: '#f8f6ee',
            stroke: '#d8d4c8', strokeWidth: 1,
        }));
        // 表盘微弱辐射渐变（立体感）
        this._staticGroup.add(new Konva.Circle({
            x: cx - r * 0.12, y: cy - r * 0.12, radius: r * 0.55,
            fillRadialGradientStartPoint:  { x: 0, y: 0 },
            fillRadialGradientEndPoint:    { x: 0, y: 0 },
            fillRadialGradientStartRadius: 0,
            fillRadialGradientEndRadius:   r * 0.55,
            fillRadialGradientColorStops:  [
                0, 'rgba(255,255,255,0.22)', 1, 'rgba(255,255,255,0)',
            ],
            listening: false,
        }));
    }

    /** 表盘刻度 */
    _drawScale() {
        const cx  = this._dialCx, cy = this._dialCy, r = this._dialR;
        const sD  = this._scaleStartDeg;
        const tD  = this._scaleTotalDeg;
        const nMax = this.maxSpeed;

        const majorDivs = 6;      // 主刻度段数（0,500,1000...3000 for 3000rpm）
        const minorPer  = 5;      // 每段内次刻度数

        // ── 色带（量程区域） ──
        // 绿区：0 ~ rated
        this._drawScaleArcBand(
            cx, cy, r * 0.76, r * 0.82,
            sD, sD + (this.ratedSpeed / nMax) * tD,
            '#4caf50', 0.65
        );
        // 黄区：rated ~ 110%rated
        const n110 = Math.min(this.ratedSpeed * 1.1, nMax);
        this._drawScaleArcBand(
            cx, cy, r * 0.76, r * 0.82,
            sD + (this.ratedSpeed / nMax) * tD,
            sD + (n110 / nMax) * tD,
            '#ffd54f', 0.75
        );
        // 红区：110% ~ max
        if (n110 < nMax) {
            this._drawScaleArcBand(
                cx, cy, r * 0.76, r * 0.82,
                sD + (n110 / nMax) * tD,
                sD + tD,
                '#ef5350', 0.72
        );
        }

        // ── 主刻度线 + 数字 ──
        for (let i = 0; i <= majorDivs; i++) {
            const frac = i / majorDivs;
            const aDeg = sD + frac * tD;
            const aRad = aDeg * Math.PI / 180;
            const cos  = Math.cos(aRad), sin = Math.sin(aRad);

            // 主刻度线
            const r0 = r * 0.83, r1 = r * 0.97;
            this._staticGroup.add(new Konva.Line({
                points: [
                    cx + r0 * cos, cy + r0 * sin,
                    cx + r1 * cos, cy + r1 * sin,
                ],
                stroke: '#1a1a1a', strokeWidth: 2, lineCap: 'round',
            }));

            // 数值标注
            const val = Math.round(frac * nMax);
            const rt  = r * 0.68;
            const fontSize = Math.max(7, this.width * 0.040);
            const label = val >= 1000
                ? (val / 1000).toFixed(1) + 'k'
                : String(val);
            this._staticGroup.add(new Konva.Text({
                x: cx + rt * cos - 16, y: cy + rt * sin - fontSize * 0.6,
                width: 32, height: fontSize * 1.3,
                text: label,
                fontSize, fontStyle: 'bold',
                fill: '#1a1a2a', align: 'center',
            }));
        }

        // ── 次刻度线 ──
        const totalMinor = majorDivs * minorPer;
        for (let i = 1; i < totalMinor; i++) {
            if (i % minorPer === 0) continue;
            const frac = i / totalMinor;
            const aDeg = sD + frac * tD;
            const aRad = aDeg * Math.PI / 180;
            const cos  = Math.cos(aRad), sin = Math.sin(aRad);
            const isMid = (i % minorPer === Math.floor(minorPer / 2));
            const r0 = isMid ? r * 0.88 : r * 0.91;
            const r1 = r * 0.97;
            this._staticGroup.add(new Konva.Line({
                points: [
                    cx + r0 * cos, cy + r0 * sin,
                    cx + r1 * cos, cy + r1 * sin,
                ],
                stroke: '#333', strokeWidth: isMid ? 1.2 : 0.8, lineCap: 'round',
            }));
        }

        // ── 弧形底边轮廓线 ──
        this._drawScaleArcBand(cx, cy, r * 0.97, r * 0.985, sD, sD + tD, '#333', 0.5);
    }

    /**
     * 绘制弧形色带（多边形折线近似）
     */
    _drawScaleArcBand(cx, cy, r0, r1, a0Deg, a1Deg, color, opacity) {
        const steps = Math.max(6, Math.round(Math.abs(a1Deg - a0Deg) / 4));
        const pts = [];
        for (let i = 0; i <= steps; i++) {
            const a = (a0Deg + (a1Deg - a0Deg) * i / steps) * Math.PI / 180;
            pts.push(cx + r1 * Math.cos(a), cy + r1 * Math.sin(a));
        }
        for (let i = steps; i >= 0; i--) {
            const a = (a0Deg + (a1Deg - a0Deg) * i / steps) * Math.PI / 180;
            pts.push(cx + r0 * Math.cos(a), cy + r0 * Math.sin(a));
        }
        this._staticGroup.add(new Konva.Line({
            points: pts, fill: color, closed: true, opacity, listening: false,
        }));
    }

    /** 额定转速三角标 */
    _drawRatedMark() {
        const cx = this._dialCx, cy = this._dialCy, r = this._dialR;
        const frac   = this.ratedSpeed / this.maxSpeed;
        const aDeg   = this._scaleStartDeg + frac * this._scaleTotalDeg;
        const aRad   = aDeg * Math.PI / 180;
        const rm     = r * 0.73;
        const mx     = cx + rm * Math.cos(aRad);
        const my     = cy + rm * Math.sin(aRad);
        const ts     = 5;
        const perpRad = aRad + Math.PI / 2;
        this._staticGroup.add(new Konva.Line({
            points: [
                mx + ts * Math.cos(perpRad), my + ts * Math.sin(perpRad),
                mx - ts * Math.cos(perpRad), my - ts * Math.sin(perpRad),
                mx - ts * 1.5 * Math.cos(aRad), my - ts * 1.5 * Math.sin(aRad),
            ],
            fill: '#d32f2f', stroke: '#b71c1c', strokeWidth: 0.5,
            closed: true, listening: false,
        }));
    }

    /** 单位标注 */
    _drawUnitLabel() {
        const cx = this._dialCx, cy = this._dialCy, r = this._dialR;
        const fontSize = Math.max(6, this.width * 0.038);
        // 量程文字
        this._staticGroup.add(new Konva.Text({
            x: cx - r * 0.55, y: cy + r * 0.45,
            width: r * 1.1, height: fontSize * 1.3,
            text: `0 – ${this.maxSpeed}`,
            fontSize: fontSize * 0.85,
            fill: '#556677', align: 'center',
        }));
    }

    /** 内部结构区外框 */
    _drawInternalFrame() {
        const W = this.width;
        const fx = W * 0.04;
        const fy = this._internalY - 2;
        const fw = W * 0.92;
        const fh = this._internalH + 4;

        this._staticGroup.add(new Konva.Rect({
            x: fx, y: fy, width: fw, height: fh,
            fill: '#eef0f2',
            stroke: '#c8ccd0', strokeWidth: 1,
            cornerRadius: 4,
        }));
        this._staticGroup.add(new Konva.Text({
            x: fx, y: fy - 3, width: fw, height: 14,
            text: '内部结构示意',
            fontSize: Math.max(10, W * 0.034),
            fill: '#556070', align: 'center',
        }));
    }

    /** 永久磁铁 U 形截面（静态） */
    _drawMagnetStatic() {
        const cx = this._magnetCx;
        const cy = this._magnetCy;
        const mw = this._magnetW;
        const mh = this._magnetH;
        const yoke = mw * 0.22;   // 磁轭厚度

        // ── 磁轭（U形，三段矩形拼）──
        // 左磁极
        this._staticGroup.add(new Konva.Rect({
            x: cx - mw / 2, y: cy - mh / 2,
            width: yoke, height: mh,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint:   { x: yoke, y: 0 },
            fillLinearGradientColorStops: [
                0, '#d44e0b', 0.5, '#f08316', 1, '#caab0e',
            ],
            stroke: '#404048', strokeWidth: 0.8,
        }));
        // 右磁极
        this._staticGroup.add(new Konva.Rect({
            x: cx + mw / 2 - yoke, y: cy - mh / 2,
            width: yoke, height: mh,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint:   { x: yoke, y: 0 },
            fillLinearGradientColorStops: [
                0, '#2e2e38', 0.5, '#5a5a68', 1, '#1a1a20',
            ],
            stroke: '#404048', strokeWidth: 0.8,
        }));

        // ── 圆柱铁芯（磁隙中央） ──
        const gapW  = mw - 2 * yoke;
        const coreR = gapW * 0.28;
        const coreH = mh * 0.62;

        // ── 磁力线（静态虚线，表示磁场）──
        const gapX0 = cx - mw / 2 + yoke;
        const gapX1 = cx + mw / 2 - yoke;
        for (let i = -1; i <= 1; i++) {
            const lY = cy + i * mh * 0.16;
            this._staticGroup.add(new Konva.Line({
                points: [gapX0 + coreR + 2, lY, gapX1 - coreR - 2, lY],
                stroke: 'rgba(180,160,60,0.35)', strokeWidth: 1,
                dash: [3, 3], listening: false,
            }));
        }
    }

    /** 游丝示意（静态螺旋，仅绘框架） */
    _drawHairspringStatic() {
        const cx = this._coilCx, cy = this._coilCy;
        const r  = this._coilR;

        // 区域标题
        this._staticGroup.add(new Konva.Text({
            x: cx - r * 1.5, y: this._internalY + 4,
            width: r * 3, height: 12,
            text: '线圈/游丝',
            fontSize: Math.max(6, this.width * 0.034),
            fill: '#5a7080', align: 'center',
        }));

        // 线圈支架（矩形框）
        const fw = r * 2.0, fh = r * 2.8;
        this._staticGroup.add(new Konva.Rect({
            x: cx - fw / 2, y: cy - fh / 2,
            width: fw, height: fh,
            fill: '#1e2228',
            stroke: '#3a4250', strokeWidth: 0.8,
            cornerRadius: 2,
        }));
        // 线圈绕组示意（多层横线）
        const coilLines = 8;
        for (let i = 0; i < coilLines; i++) {
            const ly = cy - fh / 2 + (i + 0.5) * (fh / coilLines);
            const alpha = 0.25 + 0.15 * Math.abs(Math.sin(i));
            this._staticGroup.add(new Konva.Line({
                points: [cx - fw / 2 + 3, ly, cx + fw / 2 - 3, ly],
                stroke: `rgba(200,160,60,${alpha.toFixed(2)})`,
                strokeWidth: 0.9, lineCap: 'round', listening: false,
            }));
        }
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
        this._drawNeedlePivot();
        if (this._showInternal) {
            this._drawSignalWires(frac);
            this._drawMagneticField(frac);
            this._drawGeneratorRotor(frac);
            this._drawCoilDynamic(frac);
        }
    }

    /**
     * 绘制指针
     * @param {number} frac 0~1
     */
    _drawNeedle(frac) {
        const cx = this._pivotX, cy = this._pivotY;
        const pL = this._ptrLen;

        const aDeg = this._scaleStartDeg + frac * this._scaleTotalDeg;
        const aRad = aDeg * Math.PI / 180;
        const cos  = Math.cos(aRad), sin = Math.sin(aRad);

        const tipX = cx + pL * cos;
        const tipY = cy + pL * sin;

        // 指针阴影
        this._dynamicGroup.add(new Konva.Line({
            points: [cx + 2, cy + 2, tipX + 2, tipY + 2],
            stroke: 'rgba(0,0,0,0.20)', strokeWidth: 4,
            lineCap: 'round', listening: false,
        }));

        // 指针（刀形：根宽尖细）
        const baseHW = 5;
        const perpRad = aRad + Math.PI / 2;
        this._dynamicGroup.add(new Konva.Line({
            points: [
                cx + baseHW * Math.cos(perpRad), cy + baseHW * Math.sin(perpRad),
                cx - baseHW * Math.cos(perpRad), cy - baseHW * Math.sin(perpRad),
                tipX, tipY,
            ],
            fill: '#1565c0',   // 磁电式仪表指针惯用蓝黑色
            stroke: '#0d47a1', strokeWidth: 0.8,
            closed: true, listening: false,
        }));

        // 指针高光
        this._dynamicGroup.add(new Konva.Line({
            points: [
                cx + baseHW * 0.4 * Math.cos(perpRad),
                cy + baseHW * 0.4 * Math.sin(perpRad),
                cx + pL * 0.72 * cos,
                cy + pL * 0.72 * sin,
            ],
            stroke: 'rgba(100,160,255,0.45)', strokeWidth: 1.2,
            lineCap: 'round', listening: false,
        }));

        // 配重块（尾部）
        const tLen = pL * 0.20;
        this._dynamicGroup.add(new Konva.Line({
            points: [
                cx - tLen * cos * 0.3, cy - tLen * sin * 0.3,
                cx - tLen * cos, cy - tLen * sin,
            ],
            stroke: '#888', strokeWidth: 5, lineCap: 'round', listening: false,
        }));
    }

    /** 指针轴心 */
    _drawNeedlePivot() {
        const cx = this._pivotX, cy = this._pivotY;
        this._dynamicGroup.add(new Konva.Circle({
            x: cx, y: cy, radius: 7,
            fillLinearGradientStartPoint: { x: -5, y: -5 },
            fillLinearGradientEndPoint:   { x:  5, y:  5 },
            fillLinearGradientColorStops: [0, '#b0b8c8', 0.5, '#e8ecf4', 1, '#8090a0'],
            stroke: '#505868', strokeWidth: 1,
        }));
        this._dynamicGroup.add(new Konva.Circle({
            x: cx, y: cy, radius: 2.5,
            fill: '#1a2030',
        }));
    }

    /** 数字显示区（表盘底部小液晶条） */
    _drawSpeedDisplay(n) {
        const cx  = this._dialCx;
        const cy  = this._dialCy;
        const r   = this._dialR;
        const bw  = r * 1.1;
        const bh  = r * 0.22;
        const bx  = cx - bw / 2;
        const by  = cy + r * 0.58;

        this._dynamicGroup.add(new Konva.Rect({
            x: bx, y: by, width: bw, height: bh,
            fill: '#050f05', stroke: '#1a2a1a', strokeWidth: 1,
            cornerRadius: 3,
        }));
        this._dynamicGroup.add(new Konva.Text({
            x: bx + 3, y: by + bh * 0.08,
            width: bw - 6, height: bh * 0.9,
            text: n.toFixed(0).padStart(4, ' ') + ' r/min',
            fontSize: Math.max(7, bh * 0.52),
            fontFamily: 'Courier New, monospace',
            fontStyle: 'bold',
            fill: '#55eeff',
            align: 'center',
            verticalAlign: 'middle',
        }));
    }

    /**
     * 信号导线（发电机转子 → 可动线圈，两根导线）
     * @param {number} frac 0~1
     */
    _drawSignalWires(frac) {
        const W = this.width, H = this.height;
        const cxL = this._magnetCx + this._magnetW * 0.35;
        const cxR = this._coilCx - this._coilR * 1.2;
        const cy  = this._coilCy;

        // 两根导线的 Y 偏移量
        const yOff = this._coilR * 0.7;
        const midX = (cxL + cxR) / 2;
        const midYoff = this._coilR * 0.2;

        // 信号流动相位（由 frac 驱动）
        const flowPhase = this._generatorPhase * 2;

        [{ color: '#ef5350', yDir: -1 }, { color: '#42a5f5', yDir: 1 }].forEach(({ color, yDir }) => {
            const pts = [
                cxL, cy + yDir * yOff,
                midX - W * 0.03, cy + yDir * yOff + midYoff * yDir,
                midX + W * 0.03, cy + yDir * yOff - midYoff * yDir,
                cxR, cy + yDir * yOff,
            ];
            this._dynamicGroup.add(new Konva.Line({
                points: pts,
                stroke: color, strokeWidth: 2,
                tension: 0.4, lineCap: 'round',
                listening: false,
            }));
            // 信号流动点
            if (frac > 0.05) {
                const t = (Math.sin(flowPhase) * 0.5 + 0.5);
                const pathLen = pts.length / 2 - 1;
                const segIdx = Math.floor(t * pathLen);
                const segT = (t * pathLen) - segIdx;
                const i0 = segIdx * 2, i1 = (segIdx + 1) * 2;
                const px = pts[i0] + (pts[i1] - pts[i0]) * segT;
                const py = pts[i0 + 1] + (pts[i1 + 1] - pts[i0 + 1]) * segT;
                const glow = 0.4 + 0.6 * Math.abs(Math.sin(flowPhase));
                this._dynamicGroup.add(new Konva.Circle({
                    x: px, y: py, radius: 3,
                    fill: color, opacity: glow,
                    listening: false,
                }));
            }
        });
    }

    /**
     * 磁场箭头动态效果（随转速变化磁场颜色/强度）
     * @param {number} frac 0~1
     */
    _drawMagneticField(frac) {
        const cx  = this._magnetCx;
        const cy  = this._magnetCy;
        const mw  = this._magnetW;
        const mh  = this._magnetH;
        const yoke = mw * 0.22;
        const gapX0 = cx - mw / 2 + yoke;
        const gapX1 = cx + mw / 2 - yoke;
        const gapW  = gapX1 - gapX0;

        // 根据转速调整磁场颜色强度（实际磁场恒定，仅作视觉反馈）
        const alpha = 0.15 + frac * 0.45;
        const color = `rgba(255,200,40,${alpha.toFixed(2)})`;

        // 磁隙发光（表示有效驱动磁场）
        this._dynamicGroup.add(new Konva.Rect({
            x: gapX0 + gapW * 0.30, y: cy - mh * 0.28,
            width: gapW * 0.40, height: mh * 0.56,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint:   { x: gapW * 0.40, y: 0 },
            fillLinearGradientColorStops: [
                0, 'transparent',
                0.5, color,
                1, 'transparent',
            ],
            listening: false,
        }));

        // 安培力箭头（转速 > 5%时显示）
        if (frac > 0.05) {
            const arrowY = cy;
            const arrowX0 = gapX0 + gapW * 0.30;
            const arrowX1 = gapX0 + gapW * 0.70;
            const dir = frac > 0 ? 1 : -1;  // 箭头方向随转速方向
            const arrowAlpha = 0.5 + frac * 0.45;
            const ac = `rgba(255,220,60,${arrowAlpha.toFixed(2)})`;

            // 箭头主线
            this._dynamicGroup.add(new Konva.Arrow({
                x: 0, y: 0,
                points: [arrowX0, arrowY, arrowX1, arrowY],
                stroke: ac, fill: ac,
                strokeWidth: 1.5,
                pointerLength: 5, pointerWidth: 4,
                listening: false,
            }));
        }
    }

    /**
     * 测速发电机转子（在磁隙中旋转的电枢）
     * @param {number} frac 0~1
     */
    _drawGeneratorRotor(frac) {
        const cx  = this._magnetCx;
        const cy  = this._magnetCy;
        const mw  = this._magnetW;
        const mh  = this._magnetH;
        const yoke = mw * 0.22;
        const gapX0 = cx - mw / 2 + yoke;
        const gapX1 = cx + mw / 2 - yoke;
        const gapW  = gapX1 - gapX0;

        // 转子在磁隙中央
        const rotorGroup = new Konva.Group({
            x: cx, y: cy,
            rotation: (this._generatorPhase * 180 / Math.PI) % 360,
        });

        const rotorR = Math.min(gapW * 0.30, mh * 0.20);
        // 转子铁芯（圆形）
        rotorGroup.add(new Konva.Circle({
            x: 0, y: 0, radius: rotorR,
            fillLinearGradientStartPoint: { x: -rotorR, y: 0 },
            fillLinearGradientEndPoint:   { x:  rotorR, y: 0 },
            fillLinearGradientColorStops: [0, '#4a4a58', 0.5, '#8a8a9a', 1, '#4a4a58'],
            stroke: '#2a2a38', strokeWidth: 0.8,
        }));
        // 转子绕组（交叉线圈示意）
        const w = rotorR * 0.7, h = rotorR * 0.5;
        rotorGroup.add(new Konva.Rect({
            x: -w, y: -h, width: w * 2, height: h * 2,
            fill: 'transparent', stroke: '#c09030', strokeWidth: 1.5,
            cornerRadius: 1,
        }));
        // 绕组高亮（发电状态）
        if (frac > 0.05) {
            const glow = 0.1 + frac * 0.25;
            rotorGroup.add(new Konva.Rect({
                x: -w + 1, y: -h + 1,
                width: w * 2 - 2, height: h * 2 - 2,
                fill: `rgba(255,200,50,${glow.toFixed(2)})`,
                cornerRadius: 1,
            }));
        }
        // 换向器示意（底部）
        rotorGroup.add(new Konva.Rect({
            x: -rotorR * 0.3, y: rotorR * 0.6,
            width: rotorR * 0.6, height: rotorR * 0.25,
            fill: '#b08040', stroke: '#8a6020', strokeWidth: 0.5,
        }));
        // 换向片纹理
        for (let i = -1; i <= 1; i++) {
            rotorGroup.add(new Konva.Line({
                points: [i * rotorR * 0.15, rotorR * 0.6, i * rotorR * 0.15, rotorR * 0.85],
                stroke: '#604010', strokeWidth: 0.5,
            }));
        }

        this._dynamicGroup.add(rotorGroup);

        // 转子转速标注
        if (frac > 0.1) {
            const nFrac = frac;
            const rpmLabel = Math.round(nFrac * this.maxSpeed);
            this._dynamicGroup.add(new Konva.Text({
                x: gapX0 + 2, y: cy + mh * 0.32,
                width: gapW, height: 12,
                text: `n = ${rpmLabel} rpm`,
                fontSize: Math.max(5, this.width * 0.034),
                fill: '#d05030', align: 'center', fontStyle: 'bold',
            }));
        }
    }

    /**
     * 输出电压显示（底部铭牌区）
     * @param {number} frac 0~1
     */
    _drawVoltageOutput(frac) {
        const W = this.width, H = this.height;
        const vol = (frac * this.maxSpeed * this._sensitivity).toFixed(2);
        const vx = W * 0.12, vy = H * 0.89;
        const vw = W * 0.76, vh = H * 0.05;

        this._dynamicGroup.add(new Konva.Rect({
            x: vx, y: vy, width: vw, height: vh,
            fill: '#0a0f0a', stroke: '#2a3a2a', strokeWidth: 1,
            cornerRadius: 3,
        }));
        this._dynamicGroup.add(new Konva.Text({
            x: vx + 4, y: vy + vh * 0.08,
            width: vw * 0.55, height: vh * 0.9,
            text: `U = ${vol} V`,
            fontSize: Math.max(8, vh * 0.55),
            fontFamily: 'Courier New, monospace',
            fontStyle: 'bold',
            fill: frac > 0.05 ? '#ffcc00' : '#445544',
            align: 'left', verticalAlign: 'middle',
        }));
        // 电压柱状条
        const barX = vx + vw * 0.60;
        const barW = vw * 0.36, barH = vh * 0.7;
        const barY = vy + (vh - barH) / 2;
        this._dynamicGroup.add(new Konva.Rect({
            x: barX, y: barY, width: barW, height: barH,
            fill: '#1a1a1a', stroke: '#333', strokeWidth: 0.5,
            cornerRadius: 2,
        }));
        if (frac > 0.01) {
            const fillW = barW * Math.min(1, frac);
            const barColor = frac < 0.3 ? '#4caf50' : frac < 0.7 ? '#ffd54f' : '#ef5350';
            this._dynamicGroup.add(new Konva.Rect({
                x: barX + 1, y: barY + 1,
                width: Math.max(2, fillW - 2), height: barH - 2,
                fill: barColor, cornerRadius: 1,
            }));
        }
    }

    /**
     * 可动线圈动态示意（线圈偏转与游丝形变）
     * @param {number} frac 0~1
     */
    _drawCoilDynamic(frac) {
        const cx = this._coilCx;
        const cy = this._coilCy;
        const r  = this._coilR;

        // 目标偏角（线性：线圈偏角∝转速）
        const targetAngle = frac * (Math.PI * 0.8);   // 最大偏转约 144°

        // 当前线圈偏角（使用 _coilAngle，由tick二阶动力学更新）
        const θ = this._coilAngle;

        // ── 可动线圈矩形（旋转后绘制）──
        const fw = r * 2.0, fh = r * 2.8;

        const coilGroup = new Konva.Group({
            x: cx, y: cy,
            rotation: θ * 180 / Math.PI,   // 偏转角
        });

        // 线圈绕组（竖直矩形框）
        coilGroup.add(new Konva.Rect({
            x: -fw / 2, y: -fh / 2,
            width: fw, height: fh,
            fill: 'transparent',
            stroke: '#c09030', strokeWidth: 1.5,
            cornerRadius: 2,
        }));

        // 线圈内高亮（通电状态）
        const coilAlpha = 0.08 + frac * 0.22;
        coilGroup.add(new Konva.Rect({
            x: -fw / 2 + 2, y: -fh / 2 + 2,
            width: fw - 4, height: fh - 4,
            fill: `rgba(255,200,60,${coilAlpha.toFixed(2)})`,
            cornerRadius: 2,
        }));

        // 指针延伸轴（线圈中心向上）
        coilGroup.add(new Konva.Line({
            points: [0, -fh / 2, 0, -fh / 2 - r * 0.5],
            stroke: '#1565c0', strokeWidth: 1.5, lineCap: 'round',
        }));

        this._dynamicGroup.add(coilGroup);

        // ── 游丝（阿基米德螺旋，根据偏角展开）──
        this._drawHairspringDynamic(cx, cy, r * 0.45, θ, targetAngle);

        // ── 轴心标记 ──
        this._dynamicGroup.add(new Konva.Circle({
            x: cx, y: cy, radius: 3.5,
            fill: '#90a0b0', stroke: '#607080', strokeWidth: 0.8,
        }));
    }

    /**
     * 游丝（螺旋弹簧）动态绘制
     * @param {number} cx 中心X
     * @param {number} cy 中心Y
     * @param {number} maxR 游丝外径
     * @param {number} currentAngle 当前偏转角（rad）
     * @param {number} targetAngle 目标角（rad，决定游丝张力）
     */
    _drawHairspringDynamic(cx, cy, maxR, currentAngle, targetAngle) {
        const turns = 3.5;           // 螺旋圈数
        const steps = 120;           // 折线段数
        const minR  = maxR * 0.18;   // 内径

        // 游丝张紧程度：偏角越大，游丝越展开（内外径间距增大）
        const stretch = currentAngle / (Math.PI * 0.8);
        const rRange  = (maxR - minR) * (0.5 + stretch * 0.5);

        const pts = [];
        for (let i = 0; i <= steps; i++) {
            const t     = i / steps;
            const angle = t * turns * 2 * Math.PI + currentAngle * 0.5;
            const rad   = minR + rRange * t;
            pts.push(
                cx + rad * Math.cos(angle),
                cy + rad * Math.sin(angle),
            );
        }

        const tension = Math.min(1, currentAngle / (Math.PI * 0.8));
        const hairColor = tension < 0.3
            ? '#8090a0'
            : tension < 0.7
                ? '#c09030'
                : '#e05030';

        this._dynamicGroup.add(new Konva.Line({
            points: pts,
            stroke: hairColor, strokeWidth: 0.9,
            lineJoin: 'round', lineCap: 'round',
            listening: false,
        }));
    }

    // ═══════════════════════════════════════════════════════
    // 交互
    // ═══════════════════════════════════════════════════════

    _bindInteraction() {
        const hitArea = new Konva.Circle({
            x: this._dialCx, y: this._dialCy,
            radius: this._dialR + 4,
            fill: 'transparent',
        });
        hitArea.on('click tap', (e) => {
            // 点击表盘设置转速（演示模式）
            const stage = e.target.getStage();
            if (!stage) return;
            const ptr   = stage.getPointerPosition();
            const grp   = this.group;
            const trans = grp.getAbsoluteTransform().copy().invert();
            const lp    = trans.point(ptr);
            const dx    = lp.x - this._dialCx;
            const dy    = lp.y - this._dialCy;
            let clickDeg = Math.atan2(dy, dx) * 180 / Math.PI;
            let relDeg   = clickDeg - this._scaleStartDeg;
            // 归一化到 0~scaleTotalDeg
            relDeg = ((relDeg % 360) + 360) % 360;
            if (relDeg <= this._scaleTotalDeg) {
                this._targetSpeed = (relDeg / this._scaleTotalDeg) * this.maxSpeed;
            }
        });
        this._interactGroup.add(hitArea);
    }

    // ═══════════════════════════════════════════════════════
    // tick（物理仿真循环）
    // ═══════════════════════════════════════════════════════

    tick(dt) {
        let dirty = false;

        // ── 一阶惯性滤波（电气响应）──
        const tau = Math.max(0.02, this._timeConst);
        const err = this._targetSpeed - this._dispSpeed;
        if (Math.abs(err) > 0.3) {
            this._dispSpeed += (dt / tau) * err;
            this._dispSpeed  = Math.max(0, Math.min(this.maxSpeed, this._dispSpeed));
            dirty = true;
        }

        // ── 可动线圈二阶动力学（欠阻尼振荡）──
        const nMax       = this.maxSpeed;
        const frac       = Math.min(1, Math.max(0, this._dispSpeed / nMax));
        const θTarget    = frac * (Math.PI * 0.8);

        // ── 测速发电机转子旋转 ──
        if (frac > 0.01) {
            const rotorOmega = frac * 15;
            this._generatorPhase = (this._generatorPhase + rotorOmega * dt) % (2 * Math.PI);
            dirty = true;
        }

        // 二阶系统：
        //   θ'' + 2ζωₙθ' + ωₙ²θ = ωₙ²·θTarget
        const ωn  = this._coilOmegaN;
        const ζ   = this._coilZeta;
        const θ   = this._coilAngle;
        const dθ  = this._coilVel;

        const acc = ωn * ωn * (θTarget - θ) - 2 * ζ * ωn * dθ;
        this._coilVel   += acc * dt;
        this._coilAngle += this._coilVel * dt;
        this._coilAngle  = Math.max(0, Math.min(Math.PI * 0.8, this._coilAngle));

        if (Math.abs(θTarget - this._coilAngle) > 0.002 || Math.abs(this._coilVel) > 0.005) {
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
     * @param {number} rpm 转速（r/min）
     */
    setSpeed(rpm) {
        this._targetSpeed = Math.max(0, Math.min(this.maxSpeed, rpm));
    }

    /**
     * 通过电压输入（测速发电机输出端）
     * @param {number} voltage 电压（V）
     */
    setVoltage(voltage) {
        const rpm = Math.abs(voltage) / this._sensitivity;
        this.setSpeed(rpm);
    }

    getDisplaySpeed()  { return this._dispSpeed; }
    getTargetSpeed()   { return this._targetSpeed; }

    /**
     * update() — 通用 signal 输入
     * @param {number|{voltage?:number, rpm?:number}} val
     */
    update(val) {
        if (typeof val === 'number') {
            if (this._inputMode === 'voltage') {
                this.setVoltage(val);
            } else {
                this.setSpeed(val);
            }
        } else if (val && typeof val === 'object') {
            if (val.voltage !== undefined) this.setVoltage(val.voltage);
            if (val.rpm     !== undefined) this.setSpeed(val.rpm);
        }
    }

    getConfigFields() {
        return [
            { label: '位号',                key: 'label',        type: 'text'   },
            { label: '量程最大值 (rpm)',     key: 'maxSpeed',     type: 'number' },
            { label: '额定转速 (rpm)',       key: 'ratedSpeed',   type: 'number' },
            { label: '测速机灵敏度 V/rpm',   key: 'sensitivity',  type: 'number' },
            { label: '输入模式(rpm/voltage)',key: 'inputMode',    type: 'text'   },
            { label: '初始转速 (rpm)',       key: 'initSpeed',    type: 'number' },
            { label: '响应时间常数 (s)',     key: 'timeConst',    type: 'number' },
            { label: '显示内部结构(1/0)',   key: 'showInternal', type: 'number' },
        ];
    }

    onConfigUpdate(cfg) {
        if (cfg.label        !== undefined) this.label         = cfg.label;
        if (cfg.maxSpeed     !== undefined) this.maxSpeed      = parseFloat(cfg.maxSpeed);
        if (cfg.ratedSpeed   !== undefined) this.ratedSpeed    = parseFloat(cfg.ratedSpeed);
        if (cfg.sensitivity  !== undefined) this._sensitivity  = parseFloat(cfg.sensitivity);
        if (cfg.inputMode    !== undefined) this._inputMode    = cfg.inputMode;
        if (cfg.timeConst    !== undefined) this._timeConst    = parseFloat(cfg.timeConst);
        if (cfg.showInternal !== undefined) this._showInternal = !!parseInt(cfg.showInternal);
        if (cfg.initSpeed    !== undefined) {
            this._targetSpeed = parseFloat(cfg.initSpeed);
            this._dispSpeed   = this._targetSpeed;
            this._coilAngle   = (this._targetSpeed / this.maxSpeed) * Math.PI * 0.8;
            this._coilVel     = 0;
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
