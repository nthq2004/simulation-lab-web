import { BaseComponent } from './BaseComponent.js';

/**
 * 机械振动表（Mechanical Vibrometer / Seismic Vibration Meter）仿真组件
 *
 * ── 结构说明 ──────────────────────────────────────────────────
 *
 *  机械振动表是工业现场用于测量机械振动幅值的仪表，由以下部分组成：
 *
 *  1. 底座（Base Frame）：重型铸铁机壳，通过螺栓固定在被测机械上
 *     - 提供惯性参考系
 *     - 包含四角固定螺孔
 *
 *  2. 弹簧系统（Spring System）：
 *     - 导向弹簧（Guiding Spring）：两组对称布置的片簧，约束惯性质量块做纯线性运动
 *     - 回复弹簧（Return Spring）：螺旋弹簧，提供中心回复力
 *     - 刚度 k 决定系统固有频率 fn = (1/2π)√(k/m)
 *
 *  3. 惯性质量块（Seismic Mass）：
 *     - 重型黄铜质量块，与底座之间通过弹簧悬挂
 *     - 当底座随机械振动时，质量块因惯性相对底座产生位移
 *     - 位移量 = 振动幅值（低频范围内）
 *     - 运动方程：m·ẍ + c·ẋ + k·x = -m·ÿ_base
 *
 *  4. 放大机构（Amplification Linkage）：
 *     - 杠杆臂（Lever Arm）：以支点为中心，将质量块小位移放大
 *     - 传动拉杆（Connecting Rod）：连接质量块与杠杆
 *     - 放大倍数 N = L2/L1（L1=输入臂长，L2=输出臂长，典型 N=5~20）
 *
 *  5. 指针（Pointer）：
 *     - 铝合金轻质指针，由放大机构驱动
 *     - 在刻度盘上指示振动位移峰-峰值（mm）
 *     - 实时跟随振动运动
 *
 *  6. 刻度盘（Scale Dial）：
 *     - 圆弧形刻度盘，显示 0~量程（典型 0~2mm、0~5mm）
 *     - 中间 0 刻度，两侧为正负半程
 *
 * ── 物理模型 ──────────────────────────────────────────────────
 *
 *  被测振动：y_base(t) = A·sin(2π·f·t)
 *  质量块相对位移（稳态）：
 *    x(t) = A · (f/fn)² / √[(1-(f/fn)²)² + (2ζ·f/fn)²]
 *
 *  在工作频率范围（f >> fn）内，x ≈ A（惯性式测振原理）
 *  指针偏转角 θ = arctan(N·x / R_scale)
 *
 *  其中：
 *    A   = 振动幅值（mm）
 *    f   = 振动频率（Hz）
 *    fn  = 系统固有频率（Hz，典型 2~10 Hz）
 *    ζ   = 阻尼比（典型 0.6~0.7，临界阻尼附近）
 *    N   = 放大倍数
 *    R   = 刻度盘半径
 *
 * ── 视角 ─────────────────────────────────────────────────────
 *
 *  正面剖视图（Front Section View），可见内部弹簧-质量块机构
 *  透明表壳玻璃，显示内部运动部件
 *
 * ── 端口 ─────────────────────────────────────────────────────
 *  无电气端口（纯机械仪表）
 *
 * ── 可配置参数 ────────────────────────────────────────────────
 *  label          : 位号（默认 'VM'）
 *  rangeMax       : 量程最大值 mm（默认 2.0）
 *  naturalFreq    : 系统固有频率 Hz（默认 5）
 *  dampingRatio   : 阻尼比（默认 0.65）
 *  ampRatio       : 放大倍数（默认 10）
 *  vibAmplitude   : 输入振动幅值 mm（默认 0，可由 update() 动态设置）
 *  vibFrequency   : 输入振动频率 Hz（默认 25）
 */
export class MechanicalVibrometer extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.width  = Math.max(180, config.width  || 220);
        this.height = Math.max(220, config.height || 280);

        this.type    = 'mechanical_vibrometer';
        this.special = 'none';
        this.cache   = 'fixed';

        this._initGroups();
        this._recalcGeometry();
        this._initParameters(config);
        this._init();

        this.config = {
            label        : this.label,
            rangeMax     : this.rangeMax,
            naturalFreq  : this.naturalFreq,
            dampingRatio : this.dampingRatio,
            ampRatio     : this.ampRatio,
            vibAmplitude : this.vibAmplitude,
            vibFrequency : this.vibFrequency,
        };
    }

    // ═══════════════════════════════════════════
    // 几何尺寸计算
    // ═══════════════════════════════════════════

    _recalcGeometry() {
        const W = this.width, H = this.height;

        // ── 外壳 ──
        this._shell = {
            x: W * 0.04, y: H * 0.02,
            w: W * 0.92, h: H * 0.94,
            rx: W * 0.05,
        };

        // ── 底部安装底座 ──
        this._mountBase = {
            x: W * 0.08, y: H * 0.87,
            w: W * 0.84, h: H * 0.09,
            rx: W * 0.02,
        };

        // ── 四角安装螺孔 ──
        this._mountScrews = [
            { x: W * 0.13, y: H * 0.915 },
            { x: W * 0.87, y: H * 0.915 },
            { x: W * 0.13, y: H * 0.895 },
            { x: W * 0.87, y: H * 0.895 },
        ];
        // 只保留左右两个
        this._mountScrews = [
            { x: W * 0.14, y: H * 0.910 },
            { x: W * 0.86, y: H * 0.910 },
        ];

        // ── 表盘区域（上方圆弧刻度盘）──
        this._dialCx = W * 0.50;
        this._dialCy = H * 0.36;
        this._dialR  = W * 0.36;
        // 刻度弧：从 -60° 到 +60°（以向下为0°基准）
        this._dialArcStart = -Math.PI * 0.85;   // 约 -153°（左端）
        this._dialArcEnd   =  Math.PI * 0.85 - Math.PI;  // 约 -27°（... 重算）
        // 重新定义：表盘圆心向上，指针从下方扫过
        // 以顶部为 -90°（12点），刻度从左 -150° 到右 -30°
        this._dialStartAngle = (Math.PI / 180) * 210;  // 210° = 左端（逆时针从 x+ 轴）
        this._dialEndAngle   = (Math.PI / 180) * 330;  // 330° = 右端
        // 指针轴心 = 表盘圆心
        this._pivotCx = this._dialCx;
        this._pivotCy = this._dialCy;
        this._pointerLen = this._dialR * 0.80;

        // ── 内部机构区域（表盘下方）──
        this._mechanismY   = H * 0.54;    // 机构顶部 Y
        this._mechanismH   = H * 0.30;    // 机构高度
        this._mechanismCx  = W * 0.50;

        // 质量块
        this._massW  = W * 0.38;
        this._massH  = H * 0.13;
        this._massCx = this._mechanismCx;
        // massY 随振动变化，_massBaseY 为静止位置中心
        this._massBaseY = this._mechanismY + this._mechanismH * 0.50;

        // 导向弹簧（左右各一组片簧）
        this._springLeft  = { x: W * 0.14, yTop: this._mechanismY, yBot: this._mechanismY + this._mechanismH };
        this._springRight = { x: W * 0.86, yTop: this._mechanismY, yBot: this._mechanismY + this._mechanismH };

        // 杠杆支点
        this._leverPivot = { x: this._mechanismCx, y: this._mechanismY - H * 0.04 };
        this._leverL1 = W * 0.10;  // 输入臂长（质量块侧）
        this._leverL2 = W * 0.34;  // 输出臂长（指针侧）

        // 拉杆连接点（质量块顶部中心）
        this._rodAttachY = this._massBaseY - this._massH / 2;

        // 标签
        this._labelPos = { x: W * 0.50, y: H * 0.955 };
    }

    // ═══════════════════════════════════════════
    // 参数初始化
    // ═══════════════════════════════════════════

    _initParameters(config) {
        this.label        = config.label        || 'VM';
        this.rangeMax     = config.rangeMax     !== undefined ? config.rangeMax     : 2.0;   // mm
        this.naturalFreq  = config.naturalFreq  !== undefined ? config.naturalFreq  : 5.0;   // Hz
        this.dampingRatio = config.dampingRatio !== undefined ? config.dampingRatio : 0.65;
        this.ampRatio     = config.ampRatio     !== undefined ? config.ampRatio     : 10;
        this.vibAmplitude = config.vibAmplitude !== undefined ? config.vibAmplitude : 0.0;   // mm
        this.vibFrequency = config.vibFrequency !== undefined ? config.vibFrequency : 25.0;  // Hz

        // 内部物理状态
        this._time         = 0;       // 累计时间 s
        this._massDisp     = 0;       // 质量块实际位移 mm（相对底座）
        this._massVel      = 0;       // 质量块速度 mm/s
        this._pointerAngle = 0;       // 指针当前角度 rad（相对中心）
        this._peakDisp     = 0;       // 峰值位移（用于峰值保持显示）
        this._peakHoldTime = 0;       // 峰值保持计时器 s

        // 视觉偏移量（像素）
        this._massPixelOffset = 0;    // 质量块在画布上的位移（像素）

        this._lastPointerAngle = 0;

        // 弹簧动画相位
        this._springPhase = 0;
    }

    // ═══════════════════════════════════════════
    // 初始化
    // ═══════════════════════════════════════════

    _init() {
        this._drawStaticParts();
        this._bindInteraction();
        this._rebuildDynamic();
    }

    /**
     * 在 _rebuildDynamic() 后缓存所有需要每帧更新的图形引用
     */
    _saveDynamicRefs() {
        this._massGroup      = this._dynamicGroup.findOne('.mass_group');
        this._springData     = this._dynamicGroup.find('.spring_line');
        this._springAxisData = this._dynamicGroup.find('.spring_axis');
        this._rodLine        = this._dynamicGroup.findOne('.rod_line');
        this._rodJoints      = this._dynamicGroup.find('.rod_joint');
        this._leverLine      = this._dynamicGroup.findOne('.lever_line');
        this._leverPin       = this._dynamicGroup.findOne('.lever_pin');
        this._pointerShadow  = this._dynamicGroup.findOne('.pointer_shadow');
        this._pointerPoly    = this._dynamicGroup.findOne('.pointer_body');
        this._readoutValText = this._dynamicGroup.findOne('.readout_val');
        this._freqText       = this._dynamicGroup.findOne('.freq_text');
    }

    /**
     * 每帧原地更新所有动态图形属性（替代 _rebuildDynamic 全量重建）
     */
    _updateDynamic() {
        const disp = this._massPixelOffset;
        const H    = this.height;

        // ── 弹簧：更新 coil/axis 的 y 终点 ──
        const massTopY = this._massBaseY - this._massH / 2 + disp;
        const topY     = this._mechanismY + H * 0.02;
        const halfW    = this.width * 0.038;

        this._springData.forEach((line, i) => {
            const cx = i === 0 ? this.width * 0.18 : this.width * 0.82;
            line.points(this._calcCoilSpringPts(cx, topY, massTopY, halfW, 8));
        });
        this._springAxisData.forEach((line, i) => {
            const cx = i === 0 ? this.width * 0.18 : this.width * 0.82;
            line.points([cx, topY, cx, massTopY]);
        });

        // ── 质量块 Y 偏移 ──
        if (this._massGroup) this._massGroup.y(disp);

        // ── 拉杆 & 杠杆 ──
        this._updateRodAndLever(disp);

        // ── 指针 ──
        this._updatePointer();

        // ── 读数 ──
        if (this._readoutValText) {
            this._readoutValText.text(Math.abs(this._massDisp).toFixed(2));
        }
        if (this._freqText) {
            this._freqText.text(`f=${this.vibFrequency.toFixed(0)}Hz  fn=${this.naturalFreq}Hz`);
        }

        // 更新全部动态属性完成
    }

    /** 计算螺旋弹簧点集 */
    _calcCoilSpringPts(cx, yTop, yBot, halfW, coils) {
        const length  = yBot - yTop;
        if (length <= 0) return [cx, yTop, cx, yTop];
        const segPerCoil = 8;
        const totalSeg   = coils * segPerCoil;
        const pts = [];
        pts.push(cx, yTop);
        pts.push(cx, yTop + length * 0.06);
        for (let i = 0; i <= totalSeg; i++) {
            const t   = i / totalSeg;
            const y   = yTop + length * 0.06 + length * 0.88 * t;
            const phase = t * coils * 2 * Math.PI;
            const x   = cx + Math.sin(phase) * halfW;
            pts.push(x, y);
        }
        pts.push(cx, yBot - length * 0.06);
        pts.push(cx, yBot);
        return pts;
    }

    /** 更新拉杆和杠杆 */
    _updateRodAndLever(disp) {
        const massTopY = this._massBaseY - this._massH / 2 + disp;
        const px = this._leverPivot.x;
        const py = this._leverPivot.y;
        const rodEndX = px - this._leverL1;
        const leverAngle = this._calcLeverAngle();
        const inputY = py + Math.sin(leverAngle) * this._leverL1;

        // 拉杆
        if (this._rodLine) {
            this._rodLine.points([this._massCx, massTopY, rodEndX, inputY]);
        }
        if (this._rodJoints && this._rodJoints.length >= 2) {
            this._rodJoints[0].x(this._massCx);
            this._rodJoints[0].y(massTopY);
            this._rodJoints[1].x(rodEndX);
            this._rodJoints[1].y(inputY);
        }

        // 杠杆
        const cos = Math.cos(leverAngle);
        const sin = Math.sin(leverAngle);
        const L1  = this._leverL1;
        const L2  = this._leverL2;
        const inX  = px - cos * L1;
        const inY  = py - sin * L1;
        const outX = px + cos * L2;
        const outY = py + sin * L2;

        if (this._leverLine) {
            this._leverLine.points([inX, inY, outX, outY]);
        }
        if (this._leverPin) {
            this._leverPin.x(outX);
            this._leverPin.y(outY);
        }
    }

    /** 更新指针多边形 */
    _updatePointer() {
        const cx  = this._pivotCx;
        const cy  = this._pivotCy;
        const len = this._pointerLen;
        const angle = this._pointerAngle;

        const tipX = cx + Math.cos(angle) * len;
        const tipY = cy + Math.sin(angle) * len;
        const tailLen = len * 0.18;
        const tailX   = cx - Math.cos(angle) * tailLen;
        const tailY   = cy - Math.sin(angle) * tailLen;
        const perpAngle = angle + Math.PI / 2;
        const baseHalfW = Math.max(2, this.width * 0.012);

        const newPts = [
            tipX, tipY,
            cx + Math.cos(perpAngle) * baseHalfW * 1.2,
            cy + Math.sin(perpAngle) * baseHalfW * 1.2,
            tailX, tailY,
            cx - Math.cos(perpAngle) * baseHalfW * 1.2,
            cy - Math.sin(perpAngle) * baseHalfW * 1.2,
        ];

        if (this._pointerShadow) this._pointerShadow.points(newPts);
        if (this._pointerPoly) this._pointerPoly.points(newPts);
    }

    // ═══════════════════════════════════════════
    // 静态层
    // ═══════════════════════════════════════════

    _drawStaticParts() {
        this._drawShellBack();
        this._drawDial();
        this._drawDialScale();
        this._drawDialGlass();
        this._drawMechanismFrame();
        this._drawSpringGuides();
        this._drawLeverPivotStub();
        this._drawMountBase();
        this._drawLabel();
    }

    // 外壳背景
    _drawShellBack() {
        const s = this._shell;

        // 主壳体
        this._staticGroup.add(new Konva.Rect({
            x: s.x, y: s.y, width: s.w, height: s.h,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint:   { x: s.w, y: s.h },
            fillLinearGradientColorStops: [
                0,   '#e0e0e4',
                0.4, '#d4d4d8',
                1,   '#c8c8cc',
            ],
            stroke: '#a0a4a8', strokeWidth: 1.5,
            cornerRadius: s.rx,
            shadowColor: '#000', shadowBlur: 8,
            shadowOffsetY: 3, shadowOpacity: 0.5,
        }));

        // 顶面高光
        this._staticGroup.add(new Konva.Rect({
            x: s.x + 2, y: s.y + 2,
            width: s.w - 4, height: s.h * 0.08,
            fill: 'rgba(255,255,255,0.07)',
            cornerRadius: [s.rx, s.rx, 0, 0],
        }));

        // 型号铭牌区域
        this._staticGroup.add(new Konva.Rect({
            x: this.width * 0.25, y: this._shell.y + this._shell.h * 0.02,
            width: this.width * 0.50, height: this.height * 0.04,
            fill: '#e8e8ec',
            stroke: '#b0b4b8', strokeWidth: 0.5,
            cornerRadius: 2,
        }));
        this._staticGroup.add(new Konva.Text({
            x: this.width * 0.25, y: this._shell.y + this._shell.h * 0.025,
            width: this.width * 0.50,
            text: 'VIBROMETER',
            fontSize: Math.max(7, this.width * 0.042),
            fontFamily: 'Arial',
            fontStyle: 'bold',
            fill: '#8a6a30',
            align: 'center',
        }));
    }

    // 刻度盘底板
    _drawDial() {
        const cx = this._dialCx, cy = this._dialCy, R = this._dialR;

        // 刻度盘外圈（金属环）
        this._staticGroup.add(new Konva.Circle({
            x: cx, y: cy, radius: R + 6,
            fillLinearGradientStartPoint: { x: -R, y: -R },
            fillLinearGradientEndPoint:   { x:  R, y:  R },
            fillLinearGradientColorStops: [
                0, '#888', 0.4, '#ccc', 0.6, '#aaa', 1, '#666',
            ],
            stroke: '#b0b4b8', strokeWidth: 1,
        }));

        // 刻度盘内圈（乳白色）
        this._staticGroup.add(new Konva.Circle({
            x: cx, y: cy, radius: R,
            fill: '#f5f0e8',
            stroke: '#ccc', strokeWidth: 0.5,
        }));

        // 中心区域渐变（模拟深度感）
        this._staticGroup.add(new Konva.Circle({
            x: cx, y: cy, radius: R * 0.95,
            fillRadialGradientStartPoint: { x: 0, y: -R * 0.2 },
            fillRadialGradientEndPoint:   { x: 0, y: 0 },
            fillRadialGradientStartRadius: 0,
            fillRadialGradientEndRadius:   R * 0.95,
            fillRadialGradientColorStops: [
                0,   '#fafaf5',
                0.7, '#f2ede0',
                1,   '#e8e0cc',
            ],
        }));
    }

    // 刻度线与数字
    _drawDialScale() {
        const cx   = this._dialCx;
        const cy   = this._dialCy;
        const R    = this._dialR;
        const aS   = this._dialStartAngle;   // 左端角度 rad
        const aE   = this._dialEndAngle;     // 右端角度 rad
        const span = aE - aS;                // 总弧度

        // 刻度数量：总共显示 -rangeMax ~ +rangeMax
        // 主刻度：0, ±0.5, ±1.0, ±1.5, ±2.0（共 9 格）
        const majorSteps = 10;   // 每侧 5 格，共 10 格

        for (let i = 0; i <= majorSteps; i++) {
            const frac  = i / majorSteps;            // 0 → 1
            const angle = aS + span * frac;
            const cos   = Math.cos(angle);
            const sin   = Math.sin(angle);

            const isMajor  = (i % 2 === 0) || (i === majorSteps / 2);
            const isMid    = (i === majorSteps / 2);   // 中心 0 刻度
            const tickOuter = R * 0.94;
            const tickInner = isMajor ? R * 0.76 : R * 0.85;
            const tickW     = isMajor ? 1.8 : 1.0;
            const tickColor = isMid ? '#c04020' : '#333';

            this._staticGroup.add(new Konva.Line({
                points: [
                    cx + tickInner * cos, cy + tickInner * sin,
                    cx + tickOuter * cos, cy + tickOuter * sin,
                ],
                stroke: tickColor,
                strokeWidth: tickW,
                lineCap: 'round',
            }));

            // 小刻度（五等分中间）
            if (i < majorSteps) {
                for (let j = 1; j <= 4; j++) {
                    const sf = (i + j / 5) / majorSteps;
                    const sa = aS + span * sf;
                    this._staticGroup.add(new Konva.Line({
                        points: [
                            cx + R * 0.88 * Math.cos(sa), cy + R * 0.88 * Math.sin(sa),
                            cx + R * 0.94 * Math.cos(sa), cy + R * 0.94 * Math.sin(sa),
                        ],
                        stroke: '#a0a4a8', strokeWidth: 0.8,
                    }));
                }
            }

            // 数字标注（主刻度）
            if (isMajor) {
                const valFrac = frac - 0.5;               // -0.5 ~ +0.5
                const val     = (valFrac * 2 * this.rangeMax).toFixed(1);
                const txtR    = R * 0.62;
                this._staticGroup.add(new Konva.Text({
                    x: cx + txtR * cos - 14,
                    y: cy + txtR * sin - 7,
                    width: 28, height: 14,
                    text: val,
                    fontSize: Math.max(7, this.width * 0.038),
                    fontFamily: 'Arial',
                    fontStyle: isMid ? 'bold' : 'normal',
                    fill: isMid ? '#c04020' : '#222',
                    align: 'center',
                }));
            }
        }

        // 单位标注
        this._staticGroup.add(new Konva.Text({
            x: cx - 30,
            y: cy + R * 0.28,
            width: 60,
            text: 'mm',
            fontSize: Math.max(8, this.width * 0.040),
            fontFamily: 'Arial',
            fontStyle: 'bold',
            fill: '#333',
            align: 'center',
        }));

        // 量程标注
        this._staticGroup.add(new Konva.Text({
            x: cx - 40,
            y: cy + R * 0.12,
            width: 80,
            text: `±${this.rangeMax} mm`,
            fontSize: Math.max(6, this.width * 0.032),
            fontFamily: 'Arial',
            fill: '#555',
            align: 'center',
        }));
    }

    // 表盘玻璃高光
    _drawDialGlass() {
        const cx = this._dialCx, cy = this._dialCy, R = this._dialR;
        // 玻璃反光（椭圆高光）
        this._staticGroup.add(new Konva.Ellipse({
            x: cx - R * 0.18,
            y: cy - R * 0.30,
            radiusX: R * 0.30,
            radiusY: R * 0.15,
            fill: 'rgba(255,255,255,0.18)',
            rotation: -20,
            listening: false,
        }));
    }

    // 机构框架（内部透明视窗）
    _drawMechanismFrame() {
        const W = this.width, H = this.height;
        const mY = this._mechanismY - H * 0.01;
        const mH = this._mechanismH + H * 0.06;
        const mX = W * 0.10;
        const mW = W * 0.80;

        // 机构背景
        this._staticGroup.add(new Konva.Rect({
            x: mX, y: mY, width: mW, height: mH,
            fill: '#e8eaec',
            stroke: '#b0b4b8', strokeWidth: 1,
            cornerRadius: 4,
        }));

        // 机构顶部隔板
        this._staticGroup.add(new Konva.Rect({
            x: mX, y: mY, width: mW, height: H * 0.012,
            fill: '#c0c4c8',
            cornerRadius: [4, 4, 0, 0],
        }));

        // 左右导轨槽
        [W * 0.18, W * 0.82].forEach(gx => {
            this._staticGroup.add(new Konva.Rect({
                x: gx - W * 0.015, y: mY + H * 0.012,
                width: W * 0.030, height: mH - H * 0.012,
                fill: '#d0d4d8',
                stroke: '#b0b4b8', strokeWidth: 0.5,
            }));
        });
    }

    // 导向弹簧支架（静态外框，弹簧圈在动态层）
    _drawSpringGuides() {
        // 左右弹簧柱顶端固定块
        const W = this.width, H = this.height;
        const blockH = H * 0.025, blockW = W * 0.08;
        [W * 0.18, W * 0.82].forEach(gx => {
            // 顶部固定块
            this._staticGroup.add(new Konva.Rect({
                x: gx - blockW / 2, y: this._mechanismY - H * 0.005,
                width: blockW, height: blockH,
                fill: '#b8b8c0',
                stroke: '#d0d0d8', strokeWidth: 0.8,
                cornerRadius: 2,
            }));
            // 底部固定块（连接底座）
            this._staticGroup.add(new Konva.Rect({
                x: gx - blockW / 2, y: this._mechanismY + this._mechanismH - H * 0.01,
                width: blockW, height: blockH,
                fill: '#a8a8b0',
                stroke: '#c8c8d0', strokeWidth: 0.8,
                cornerRadius: 2,
            }));
        });
    }

    // 杠杆支点（静态固定件）
    _drawLeverPivotStub() {
        const px = this._leverPivot.x;
        const py = this._leverPivot.y;
        const W  = this.width;

        // 支点固定三角架
        this._staticGroup.add(new Konva.Line({
            points: [
                px - W * 0.04, py + W * 0.035,
                px, py,
                px + W * 0.04, py + W * 0.035,
                px - W * 0.04, py + W * 0.035,
            ],
            closed: true,
            fill: '#b8b8c0',
            stroke: '#d0d0d8', strokeWidth: 1,
        }));

        // 底部横梁
        this._staticGroup.add(new Konva.Rect({
            x: px - W * 0.06, y: py + W * 0.030,
            width: W * 0.12, height: W * 0.010,
            fill: '#d0d0d8',
            cornerRadius: 1,
        }));
    }

    // 安装底座
    _drawMountBase() {
        const b = this._mountBase;

        this._staticGroup.add(new Konva.Rect({
            x: b.x, y: b.y, width: b.w, height: b.h,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint:   { x: 0, y: b.h },
            fillLinearGradientColorStops: [
                0, '#c0c0c4', 0.5, '#d0d0d4', 1, '#e0e0e4',
            ],
            stroke: '#b0b0b4', strokeWidth: 1,
            cornerRadius: b.rx,
        }));

        // 螺孔
        this._mountScrews.forEach(({ x, y }) => {
            const r = this.width * 0.022;
            this._staticGroup.add(new Konva.Circle({
                x, y, radius: r,
                fill: '#c8c8c8',
                stroke: '#d0d0d8', strokeWidth: 0.8,
            }));
            this._staticGroup.add(new Konva.Circle({
                x, y, radius: r * 0.45,
                fill: '#d0d0d8',
            }));
            [0, 90].forEach(deg => {
                const rad = deg * Math.PI / 180;
                this._staticGroup.add(new Konva.Line({
                    points: [
                        x + Math.cos(rad) * r * 0.3, y + Math.sin(rad) * r * 0.3,
                        x - Math.cos(rad) * r * 0.3, y - Math.sin(rad) * r * 0.3,
                    ],
                    stroke: '#b0b4b8', strokeWidth: 0.8,
                }));
            });
        });

        // 接触面齿纹（防滑）
        for (let i = 0; i < 8; i++) {
            const tx = b.x + b.w * 0.15 + b.w * 0.70 * (i / 7);
            this._staticGroup.add(new Konva.Line({
                points: [tx, b.y, tx, b.y + b.h * 0.3],
                stroke: '#c0c0c4', strokeWidth: 0.6,
            }));
        }
    }

    // 位号标签
    _drawLabel() {
        this._staticGroup.add(new Konva.Text({
            x: this._labelPos.x - 40,
            y: this._labelPos.y - 10,
            width: 80, height: 14,
            text: this.label,
            fontSize: Math.max(9, this.width * 0.046),
            fontFamily: 'Arial',
            fontStyle: 'bold',
            fill: '#8a6a30',
            align: 'center',
        }));
    }

    // ═══════════════════════════════════════════
    // 动态层（每 tick 重建）
    // ═══════════════════════════════════════════

    _rebuildDynamic() {
        this._dynamicGroup.destroyChildren();

        this._drawSprings();
        this._drawConnectingRod();
        this._drawLeverArm();
        this._drawMassBlock();
        this._drawPointer();
        this._drawPointerHub();
        this._drawReadout();

        this._saveDynamicRefs();
    }

    // 导向弹簧（压缩/拉伸随质量块位移变化）
    _drawSprings() {
        const W    = this.width, H  = this.height;
        const disp = this._massPixelOffset;   // px，质量块偏移量

        [W * 0.18, W * 0.82].forEach(gx => {
            this._drawCoilSpring(
                gx,
                this._mechanismY + H * 0.02,       // 顶端固定点
                this._massBaseY - this._massH / 2 + disp,  // 底端（质量块顶部）
                W * 0.038,   // 弹簧半宽
                8,           // 圈数
            );
        });
    }

    // 螺旋弹簧绘制（折线模拟）
    _drawCoilSpring(cx, yTop, yBot, halfW, coils) {
        const length  = yBot - yTop;
        const segPerCoil = 8;
        const totalSeg   = coils * segPerCoil;
        const pts = [];

        // 进入段
        pts.push(cx, yTop);
        pts.push(cx, yTop + length * 0.06);

        for (let i = 0; i <= totalSeg; i++) {
            const t   = i / totalSeg;
            const y   = yTop + length * 0.06 + length * 0.88 * t;
            const phase = t * coils * 2 * Math.PI;
            const x   = cx + Math.sin(phase) * halfW;
            pts.push(x, y);
        }

        // 退出段
        pts.push(cx, yBot - length * 0.06);
        pts.push(cx, yBot);

        this._dynamicGroup.add(new Konva.Line({
            points: pts,
            stroke: '#206090',
            strokeWidth: 1.4,
            lineCap: 'round',
            lineJoin: 'round',
            listening: false,
            name: 'spring_line',
        }));

        // 弹簧中心轴（细线）
        this._dynamicGroup.add(new Konva.Line({
            points: [cx, yTop, cx, yBot],
            stroke: 'rgba(40,80,120,0.25)',
            strokeWidth: 0.5,
            dash: [3, 3],
            listening: false,
            name: 'spring_axis',
        }));
    }

    // 传动拉杆（质量块 → 杠杆输入端）
    _drawConnectingRod() {
        const disp  = this._massPixelOffset;
        const massTopY = this._massBaseY - this._massH / 2 + disp;
        const px    = this._leverPivot.x;
        const py    = this._leverPivot.y;
        // 拉杆连接点：杠杆输入端（支点左侧 L1 处）
        const rodEndX = px - this._leverL1;
        // 杠杆绕支点转角（由质量块位移决定）
        const leverAngle = this._calcLeverAngle();
        const inputY = py + Math.sin(leverAngle) * this._leverL1;

        this._dynamicGroup.add(new Konva.Line({
            points: [this._massCx, massTopY, rodEndX, inputY],
            stroke: '#8a7020',
            strokeWidth: Math.max(2, this.width * 0.014),
            lineCap: 'round',
            listening: false,
            name: 'rod_line',
        }));

        // 拉杆销（圆头连接）
        [{ x: this._massCx, y: massTopY }, { x: rodEndX, y: inputY }].forEach(p => {
            this._dynamicGroup.add(new Konva.Circle({
                x: p.x, y: p.y,
                radius: Math.max(3, this.width * 0.018),
                fill: '#8a7528',
                stroke: '#6a5020', strokeWidth: 0.8,
                name: 'rod_joint',
            }));
        });
    }

    // 杠杆臂
    _drawLeverArm() {
        const px   = this._leverPivot.x;
        const py   = this._leverPivot.y;
        const L1   = this._leverL1;
        const L2   = this._leverL2;
        const angle = this._calcLeverAngle();
        const cos   = Math.cos(angle);
        const sin   = Math.sin(angle);

        // 输入端点（质量块侧）
        const inX = px - cos * L1;
        const inY = py - sin * L1;   // 注意方向

        // 输出端点（指针侧）
        const outX = px + cos * L2;
        const outY = py + sin * L2;

        // 杠杆主体
        this._dynamicGroup.add(new Konva.Line({
            points: [inX, inY, outX, outY],
            stroke: '#788090',
            strokeWidth: Math.max(3, this.width * 0.022),
            lineCap: 'round',
            listening: false,
            name: 'lever_line',
        }));

        // 支点销
        this._dynamicGroup.add(new Konva.Circle({
            x: px, y: py,
            radius: Math.max(4, this.width * 0.025),
            fill: '#687080',
            stroke: '#404850', strokeWidth: 1,
        }));

        // 输出端连接点
        this._dynamicGroup.add(new Konva.Circle({
            x: outX, y: outY,
            radius: Math.max(3, this.width * 0.018),
            fill: '#607090',
            stroke: '#404860', strokeWidth: 0.8,
            name: 'lever_pin',
        }));
    }

    // 惯性质量块
    _drawMassBlock() {
        const cx    = this._massCx;
        const baseCy = this._massBaseY;
        const mW    = this._massW;
        const mH    = this._massH;

        // 包裹在 Group 中以供 _updateDynamic 整体偏移
        const massGroup = new Konva.Group({ name: 'mass_group' });
        const cy = baseCy;

        // 主体（黄铜色）
        massGroup.add(new Konva.Rect({
            x: cx - mW / 2, y: cy - mH / 2,
            width: mW, height: mH,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint:   { x: mW, y: 0 },
            fillLinearGradientColorStops: [
                0,    '#6a5820',
                0.15, '#b89840',
                0.40, '#d4b858',
                0.55, '#e8cc70',
                0.75, '#c0a048',
                1,    '#6a5820',
            ],
            stroke: '#3a2800', strokeWidth: 1.2,
            cornerRadius: 3,
        }));

        // 顶面高光
        massGroup.add(new Konva.Rect({
            x: cx - mW / 2 + 3, y: cy - mH / 2 + 2,
            width: mW - 6, height: mH * 0.22,
            fill: 'rgba(255,255,220,0.18)',
            cornerRadius: [3, 3, 0, 0],
        }));

        // 质量块刻纹（减重槽）
        for (let i = 1; i <= 3; i++) {
            const sx = cx - mW / 2 + mW * 0.18 * i + mW * 0.05;
            massGroup.add(new Konva.Rect({
                x: sx, y: cy - mH * 0.30,
                width: mW * 0.06, height: mH * 0.60,
                fill: 'rgba(0,0,0,0.30)',
                cornerRadius: 1,
            }));
        }

        // 左右导向销（插入导轨槽）
        [cx - mW / 2 - this.width * 0.04, cx + mW / 2 + this.width * 0.01].forEach(px => {
            massGroup.add(new Konva.Rect({
                x: px, y: cy - mH * 0.20,
                width: this.width * 0.040, height: mH * 0.40,
                fill: '#707070',
                stroke: '#404040', strokeWidth: 0.6,
                cornerRadius: 2,
            }));
        });

        // 质量标识
        massGroup.add(new Konva.Text({
            x: cx - mW / 2, y: cy - 7,
            width: mW, height: 14,
            text: 'm',
            fontSize: Math.max(8, this.width * 0.042),
            fontFamily: 'Times New Roman',
            fontStyle: 'italic bold',
            fill: '#3a2800',
            align: 'center',
        }));

        this._dynamicGroup.add(massGroup);
    }

    // 指针
    _drawPointer() {
        const cx  = this._pivotCx;
        const cy  = this._pivotCy;
        const len = this._pointerLen;

        // 指针角度（由质量块位移决定，经放大机构）
        const angle = this._pointerAngle;

        // 指针尖端位置
        const tipX = cx + Math.cos(angle) * len;
        const tipY = cy + Math.sin(angle) * len;

        // 指针尾端（短尾平衡）
        const tailLen = len * 0.18;
        const tailX   = cx - Math.cos(angle) * tailLen;
        const tailY   = cy - Math.sin(angle) * tailLen;

        // 指针主体（细长三角形）
        const perpAngle = angle + Math.PI / 2;
        const baseHalfW = Math.max(2, this.width * 0.012);
        const pts = [
            tipX, tipY,
            cx + Math.cos(perpAngle) * baseHalfW * 1.2, cy + Math.sin(perpAngle) * baseHalfW * 1.2,
            tailX, tailY,
            cx - Math.cos(perpAngle) * baseHalfW * 1.2, cy - Math.sin(perpAngle) * baseHalfW * 1.2,
        ];

        // 指针阴影
        this._dynamicGroup.add(new Konva.Line({
            points: pts,
            closed: true,
            fill: 'rgba(0,0,0,0.15)',
            listening: false,
            offsetX: -1, offsetY: 1,
            name: 'pointer_shadow',
        }));

        // 指针主体（深红色）
        this._dynamicGroup.add(new Konva.Line({
            points: pts,
            closed: true,
            fillLinearGradientStartPoint: { x: tailX - cx, y: tailY - cy },
            fillLinearGradientEndPoint:   { x: tipX - cx, y: tipY - cy },
            fillLinearGradientColorStops: [
                0, '#800000',
                0.6, '#cc2020',
                1,   '#ff3030',
            ],
            stroke: '#600000', strokeWidth: 0.5,
            listening: false,
            name: 'pointer_body',
        }));

        // 指针中心帽
        this._dynamicGroup.add(new Konva.Circle({
            x: cx, y: cy, radius: Math.max(4, this.width * 0.025),
            fill: '#e0e4e8',
            stroke: '#b0b8c0', strokeWidth: 1,
        }));
    }

    // 指针轴帽（中心固定件，静态但在动态层保证渲染顺序）
    _drawPointerHub() {
        const cx = this._pivotCx, cy = this._pivotCy;
        const r  = Math.max(3, this.width * 0.016);
        this._dynamicGroup.add(new Konva.Circle({
            x: cx, y: cy, radius: r,
            fill: '#e8ecf0',
            stroke: '#c0c8c8', strokeWidth: 0.8,
        }));
        // 中心点
        this._dynamicGroup.add(new Konva.Circle({
            x: cx, y: cy, radius: r * 0.35,
            fill: '#909898',
        }));
    }

    // 数字读数窗（右下角）
    _drawReadout() {
        const W = this.width, H = this.height;
        const rx = W * 0.60, ry = H * 0.62;
        const rw = W * 0.30, rh = H * 0.060;

        // 读数窗背景
        this._dynamicGroup.add(new Konva.Rect({
            x: rx, y: ry, width: rw, height: rh,
            fill: '#e8eaec',
            stroke: '#b0c0b0', strokeWidth: 1,
            cornerRadius: 3,
        }));

        // 当前读数（实际测量位移）
        const dispMM = Math.abs(this._massDisp).toFixed(2);
        this._dynamicGroup.add(new Konva.Text({
            x: rx + 2, y: ry + rh * 0.08,
            width: rw - 4, height: rh * 0.84,
            text: `${dispMM}`,
            fontSize: Math.max(8, W * 0.050),
            fontFamily: 'Courier New',
            fill: '#1a8040',
            align: 'right',
            name: 'readout_val',
        }));
        this._dynamicGroup.add(new Konva.Text({
            x: rx + 2, y: ry + rh * 0.08,
            width: rw - 4, height: rh * 0.84,
            text: 'mm',
            fontSize: Math.max(5, W * 0.030),
            fontFamily: 'Arial',
            fill: '#2a7018',
            align: 'left',
        }));

        // 频率/量程标注
        const fHz = this.vibFrequency.toFixed(0);
        this._dynamicGroup.add(new Konva.Text({
            x: W * 0.09, y: H * 0.623,
            width: W * 0.44,
            text: `f=${fHz}Hz  fn=${this.naturalFreq}Hz`,
            fontSize: Math.max(5, W * 0.028),
            fontFamily: 'Arial',
            fill: '#506840',
            name: 'freq_text',
        }));
    }

    // ═══════════════════════════════════════════
    // 交互绑定
    // ═══════════════════════════════════════════

    _bindInteraction() {
        // 点击仪表切换测试振动状态
        const hitArea = new Konva.Rect({
            x: this._shell.x, y: this._shell.y,
            width: this._shell.w, height: this._shell.h,
            fill: 'transparent',
        });
        hitArea.on('click tap', () => {
            // 点击循环切换演示振动幅值：0 → 0.5 → 1.0 → 1.5 → 2.0 → 0
            const steps = [0, 0.3, 0.8, 1.2, 1.8, this.rangeMax];
            let idx = steps.findIndex(v => Math.abs(v - this.vibAmplitude) < 0.05);
            idx = (idx + 1) % steps.length;
            this.vibAmplitude = steps[idx];
        });
        this._interactGroup.add(hitArea);
    }

    // ═══════════════════════════════════════════
    // 物理计算
    // ═══════════════════════════════════════════

    /**
     * 计算质量块相对底座的稳态位移幅值
     * 使用二阶系统频率响应函数
     */
    _calcSeismicResponse(inputAmp) {
        if (inputAmp <= 0) return 0;
        const r   = this.vibFrequency / this.naturalFreq;  // 频率比
        const z   = this.dampingRatio;
        const r2  = r * r;
        const denom = Math.sqrt(
            Math.pow(1 - r2, 2) + Math.pow(2 * z * r, 2)
        );
        // 惯性式传感器响应（测量绝对运动）
        const mag = r2 / denom;
        return inputAmp * mag;
    }

    /**
     * 计算杠杆臂角度（rad）
     * 质量块向上位移（disp<0）→ 拉杆缩短 → 输入端下压 → 杠杆顺时针
     */
    _calcLeverAngle() {
        // 质量块位移（像素）→ 输入端位移
        // 放大系数 (L2/L1) 已隐含在 _pointerAngle 中
        // 此处只需要让杠杆跟随质量块
        const dispPx = this._massPixelOffset;
        const maxDispPx = this.height * 0.08;   // 质量块最大可见位移
        const normDisp = dispPx / (maxDispPx || 1);
        return normDisp * 0.20;   // 最大杠杆角 ≈ ±0.20 rad
    }

    /**
     * 将测量位移映射到指针角度
     */
    _calcPointerAngle(dispMM) {
        const maxMM   = this.rangeMax;
        const norm    = Math.max(-1, Math.min(1, dispMM / maxMM));
        // 指针中心角（朝上方 = -π/2）
        const halfSpan = (this._dialEndAngle - this._dialStartAngle) / 2;
        const midAngle = (this._dialStartAngle + this._dialEndAngle) / 2;
        return midAngle + norm * halfSpan;
    }

    // ═══════════════════════════════════════════
    // tick（物理循环）
    // ═══════════════════════════════════════════

    tick(dt) {
        this._time += dt;

        // ── 用稳态解析解替代数值积分 ──
        // 物理循环 20fps (dt=50ms) 对 25~200Hz 激励来说步长过大，
        // RK2 数值积分会发散。改用频响函数直接计算稳态幅值。
        const wn    = 2 * Math.PI * this.naturalFreq;
        const A     = this.vibAmplitude;       // mm
        const f     = this.vibFrequency;       // Hz
        const wf    = 2 * Math.PI * f;
        const z     = this.dampingRatio;
        const t     = this._time;

        // 稳态幅值（含频率响应）
        const steadyAmp = this._calcSeismicResponse(A);
        // 考虑相位滞后的稳态位移
        const r = f / (this.naturalFreq || 1);
        const phi = Math.atan2(2 * z * r, 1 - r * r);
        this._massDisp = steadyAmp * Math.sin(wf * t - phi);
        this._massVel  = steadyAmp * wf * Math.cos(wf * t - phi);

        // 限幅（防止超量程过大）
        const maxDisp = this.rangeMax * 1.2;
        this._massDisp = Math.max(-maxDisp, Math.min(maxDisp, this._massDisp));

        // ── 映射到像素偏移 ──
        // 比例：rangeMax mm 对应 height * 0.07 px
        const scale = (this.height * 0.07) / (this.rangeMax || 1);
        this._massPixelOffset = this._massDisp * scale;

        // ── 指针角度 ──
        this._pointerAngle = this._calcPointerAngle(this._massDisp);

        // ── 原地更新动态图形（避免每帧全量重建）──
        this._updateDynamic();
        this._refreshIfDirty();
    }

    // ═══════════════════════════════════════════
    // 公开 API
    // ═══════════════════════════════════════════

    /** 设置振动输入 */
    setVibration(amplitudeMM, frequencyHz) {
        this.vibAmplitude = amplitudeMM;
        if (frequencyHz !== undefined) this.vibFrequency = frequencyHz;
        this._massDisp = 0;
        this._massVel  = 0;
        // 立即触发一次视觉更新，无需等待下一物理 tick
        this._pointerAngle = this._calcPointerAngle(amplitudeMM);
        this._rebuildDynamic();
        this._saveDynamicRefs();
    }

    /** 读取当前测量值（mm） */
    getMeasuredDisp() { return this._massDisp; }

    /** 读取当前指针角度（deg） */
    getPointerAngleDeg() { return this._pointerAngle * 180 / Math.PI; }

    update(state) {
        if (typeof state === 'object' && state !== null) {
            if (state.amplitude !== undefined) this.vibAmplitude = state.amplitude;
            if (state.frequency !== undefined) this.vibFrequency = state.frequency;
        }
        this._refreshCache();
    }

    getConfigFields() {
        return [
            { label: '位号/名称',       key: 'label',        type: 'text'   },
            { label: '量程最大值 (mm)', key: 'rangeMax',     type: 'number' },
            { label: '固有频率 (Hz)',   key: 'naturalFreq',  type: 'number' },
            { label: '阻尼比 ζ',        key: 'dampingRatio', type: 'number' },
            { label: '放大倍数 N',      key: 'ampRatio',     type: 'number' },
            { label: '输入幅值 (mm)',   key: 'vibAmplitude', type: 'number' },
            { label: '输入频率 (Hz)',   key: 'vibFrequency', type: 'number' },
        ];
    }

    onConfigUpdate(cfg) {
        if (cfg.label        !== undefined) this.label        = cfg.label;
        if (cfg.rangeMax     !== undefined) this.rangeMax     = parseFloat(cfg.rangeMax);
        if (cfg.naturalFreq  !== undefined) this.naturalFreq  = parseFloat(cfg.naturalFreq);
        if (cfg.dampingRatio !== undefined) this.dampingRatio = parseFloat(cfg.dampingRatio);
        if (cfg.ampRatio     !== undefined) this.ampRatio     = parseFloat(cfg.ampRatio);
        if (cfg.vibAmplitude !== undefined) this.vibAmplitude = parseFloat(cfg.vibAmplitude);
        if (cfg.vibFrequency !== undefined) this.vibFrequency = parseFloat(cfg.vibFrequency);

        this.config = { ...this.config, ...cfg };
        this._recalcGeometry();
        this._rebuildDynamic();
        this._refreshCache();
    }

    destroy() {
        super.destroy?.();
    }
}
