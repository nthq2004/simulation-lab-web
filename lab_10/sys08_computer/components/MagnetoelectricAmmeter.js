import { BaseComponent } from './BaseComponent.js';

/**
 * 磁电式电流表（Moving-Coil Ammeter）仿真组件
 *
 * ── 工作原理 ──────────────────────────────────────────────────
 *
 *  磁电式仪表基于载流导体在磁场中受安培力的原理：
 *
 *  1. 永久磁铁（Permanent Magnet）：马蹄形，提供恒定径向磁场 B
 *  2. 铁芯（Iron Core）：圆柱形，置于线圈内，使气隙磁场均匀呈径向分布
 *  3. 可动线圈（Moving Coil）：矩形铜线圈绕铝框，通电后受安培力矩 M = NBLIA
 *     - N：匝数，B：磁感应强度，L：有效长度，I：电流，A：线圈面积
 *  4. 游丝（Hair Spring）：两根螺旋弹簧产生反力矩 M_c = D·α（D：弹性系数）
 *     - 指针在偏转角 α 满足 NBLIA = D·α 时稳定
 *     - 因此 α ∝ I（线性刻度）
 *  5. 指针（Pointer）：固定于线圈轴，随线圈偏转
 *  6. 刻度盘（Scale Dial）：线性均匀刻度，水平向左为 0，水平向右为 100
 *  7. 分流器（Shunt，可选）：并联低值电阻扩大量程
 *
 * ── 内部状态机 ────────────────────────────────────────────────
 *
 *  输入电流 I → 目标角度 α_target = (I / I_FS) × MAX_ANGLE
 *  实际角度 α 以二阶阻尼响应趋近目标（模拟可动系统惯性+游丝弹性）
 *  阻尼比 ζ ≈ 0.7（略欠阻尼，有轻微过冲后回稳）
 *
 *  超量程（I > 1.2×I_FS）时触发过载指示
 *  反向电流（I < 0）时指针打到零挡针
 *
 * ── 视角说明 ──────────────────────────────────────────────────
 *
 *  正视图（Front View）：仪表盘正面
 *  包括：表壳、刻度盘、指针、调零旋钮、磁路示意、铭牌、端子
 *
 * ── 端口 ─────────────────────────────────────────────────────
 *  '+' — 正极（电流流入端）
 *  '-' — 负极（电流流出端）
 *
 * ── 可配置参数 ────────────────────────────────────────────────
 *  label         : 位号（默认 'PA'）
 *  fullScale     : 满偏电流 A（默认 1）
 *  unit          : 量程单位 'A'/'mA'/'μA'（默认 'A'）
 *  internalR     : 内阻 Ω（默认 0.05）
 *  initCurrent   : 初始输入电流 A（默认 0）
 *  damping       : 阻尼系数 0.1~2.0（默认 0.65）
 */
export class MagnetoelectricAmmeter extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.width  = Math.max(180, config.width  || 220);
        this.height = Math.max(180, config.height || 220);

        this.type    = 'resistor';
        this.special = 'ampmeter';
        this.cache   = 'fixed';

        this._initGroups();
        this._recalcGeometry();
        this._initParameters(config);
        this._init();

        this.config = {
            id: this.id,
            label       : this.label,
            fullScale   : this.fullScale,
            unit        : this.unit,
            internalR   : this.internalR,
            initCurrent : this._current,
            damping     : this._damping,
        };

        // 端口：正极在左下，负极在右下（与外壳端子对应）
        this.addPort(this._portPos.x, this._portPos.y, 'l', 'wire', 'p');
        this.addPort(this._portNeg.x, this._portNeg.y, 'r', 'wire');
    }

    // ═══════════════════════════════════════════════════════════
    // 几何尺寸计算
    // ═══════════════════════════════════════════════════════════

    _recalcGeometry() {
        const W = this.width, H = this.height;

        // 表壳外框
        this._case = {
            x: W * 0.04, y: H * 0.04,
            w: W * 0.92, h: H * 0.88,
            rx: Math.max(4, W * 0.03),
        };

        // 刻度盘圆心及半径（盘面占表壳 80%）
        this._dialCx = W * 0.50;
        this._dialCy = H * 0.49;
        this._dialR  = Math.min(W, H) * 0.34;

        // 刻度弧：水平向左为 0，水平向右为 100
        // 角度系统：Konva 以 3 点钟方向为 0°，顺时针正方向
        this._arcStartDeg = 180;   // 左侧 0（Konva 角度）
        this._arcEndDeg   = 360;   // 右侧最大值
        // 实际偏转范围
        this._pointerMaxAngle = 180; // °，总量程对应偏转角

        // 指针转轴（与刻度盘圆心重合，偏下以留铁芯空间）
        this._pivotX = this._dialCx;
        this._pivotY = this._dialCy + this._dialR * 0.15;

        // 指针长度
        this._ptrLen   = this._dialR * 0.92;
        this._ptrTailL = this._dialR * 0.18; // 尾部配重段长度

        // 磁路（马蹄形磁铁）示意尺寸
        const mr = this._dialR * 0.42;
        this._magnet = {
            cx: this._dialCx,
            cy: this._pivotY,
            ro: mr,
            ri: mr * 0.55,
        };

        // 铁芯圆（圆柱截面）
        this._coreR = this._magnet.ri * 0.70;

        // 调零旋钮
        this._zeroKnob = {
            x: this._dialCx,
            y: this._pivotY + this._dialR * 0.02,
            r: Math.max(4, W * 0.025),
        };

        // 端子接线柱（表壳底部）
        this._portPos = {
            x: this._case.x + this._case.w * 0.28,
            y: this._case.y + this._case.h ,
        };
        this._portNeg = {
            x: this._case.x + this._case.w * 0.72,
            y: this._case.y + this._case.h,
        };

        // 端子柱位置（底边内侧）
        this._termPos = {
            x: this._portPos.x-60, y: this._case.y + this._case.h - H * 0.06,
            r: Math.max(5, W * 0.032),
        };
        this._termNeg = {
            x: this._portNeg.x+60, y: this._case.y + this._case.h - H * 0.06,
            r: Math.max(5, W * 0.032),
        };
    }

    // ═══════════════════════════════════════════════════════════
    // 参数初始化
    // ═══════════════════════════════════════════════════════════

    _initParameters(config) {
        this.label      = config.label      || 'PA';
        this.fullScale  = config.fullScale  !== undefined ? config.fullScale  : 46.2;
        this.unit       = config.unit       || 'μA';
        this.internalR  = config.internalR  !== undefined ? config.internalR  :5000;
        this._damping   = config.damping    !== undefined ? config.damping    : 0.65;

        // 物理状态
        this.currentResistance = 5000;
        this._current   = config.initCurrent || 0;   // 输入电流 A
        this._angle     = 0;                          // 指针当前角度 °
        this._angVel    = 0;                          // 角速度 °/s
        this._overload  = false;                      // 过载标志
        this._zeroPulse = 0;                          // 打零档针时的振动帧计数

        // 自然频率（控制响应速度）
        this._omega0    = 12.0;                       // rad/s
    }

    // ═══════════════════════════════════════════════════════════
    // 初始化
    // ═══════════════════════════════════════════════════════════

    _init() {
        this._drawStaticParts();
        this._bindInteraction();
        this._rebuildDynamic();
    }

    // ═══════════════════════════════════════════════════════════
    // 静态层
    // ═══════════════════════════════════════════════════════════

    _drawStaticParts() {
        this._drawCase();
        this._drawMagnet();
        this._drawIronCore();
        this._drawDial();
        this._drawScaleTicks();
        this._drawScaleNumbers();
        this._drawResistanceScale();
        this._drawPivotBase();
        this._drawTerminals();
        this._drawLabel();
        this._drawZeroKnobBase();
        this._drawCoilSymbol();
    }

    /** 表壳（深灰铝合金外观） */
    _drawCase() {
        const c = this._case;

        // 外壳主体
        this._staticGroup.add(new Konva.Rect({
            x: c.x, y: c.y, width: c.w, height: c.h,
            cornerRadius: c.rx,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint: { x: c.w, y: c.h },
            fillLinearGradientColorStops: [
                0, '#c0c0c2',
                0.4, '#79798d',
                1, '#8f8fc5',
            ],
            stroke: '#5a5a64', strokeWidth: 1.5,
            shadowColor: '#000', shadowBlur: 8,
            shadowOffsetY: 3, shadowOpacity: 0.4,
        }));

        // 顶部高光条
        this._staticGroup.add(new Konva.Rect({
            x: c.x + 3, y: c.y + 2,
            width: c.w - 6, height: c.h * 0.04,
            fill: 'rgba(255,255,255,0.10)',
            cornerRadius: [c.rx, c.rx, 0, 0],
        }));

        // 表盘背景（乳白色表面）
        const dr = this._dialR * 1.12;
        this._staticGroup.add(new Konva.Circle({
            x: this._dialCx, y: this._dialCy,
            radius: dr,
            fill: '#f5f2e8',
            stroke: '#c8c0a8', strokeWidth: 1,
            shadowColor: '#000', shadowBlur: 5,
            shadowOpacity: 0.2,
        }));

        // 表盘玻璃面板（轻微蓝色调，模拟钢化玻璃反光）
        this._staticGroup.add(new Konva.Circle({
            x: this._dialCx - dr * 0.08, y: this._dialCy - dr * 0.08,
            radius: dr * 0.35,
            fillRadialGradientStartPoint: { x: 0, y: 0 },
            fillRadialGradientEndPoint: { x: dr * 0.35, y: dr * 0.35 },
            fillRadialGradientColorStops: [
                0, 'rgba(220,235,255,0.25)',
                1, 'rgba(220,235,255,0)',
            ],
            listening: false,
        }));
    }

    /** 马蹄形永久磁铁（N/S 极） */
    _drawMagnet() {
        const { cx, cy, ro, ri } = this._magnet;

        // 磁铁弧段：左半（N 极，红色）
        for (let i = 0; i < 2; i++) {
            const isN = (i === 0); // i=0 左(N)，i=1 右(S)
            const startA = isN ? 90 : 270;   // Konva 角度（顺时针）
            const endA   = isN ? 270 : 90;

            // 外弧
            this._staticGroup.add(new Konva.Arc({
                x: cx, y: cy,
                innerRadius: ri, outerRadius: ro,
                angle: 180,
                rotation: startA,
                fill: isN ? '#c8281a' : '#1a4ab8',
                stroke: isN ? '#8a180a' : '#0a2878',
                strokeWidth: 0.8,
            }));

            // 极性标记
            this._staticGroup.add(new Konva.Text({
                x: cx + (isN ? -ro * 0.75 : ro * 0.55),
                y: cy - 7,
                text: isN ? 'N' : 'S',
                fontSize: Math.max(9, this.width * 0.050),
                fontStyle: 'bold',
                fill: isN ? '#ff6a5a' : '#6a9aff',
            }));
        }

        // 磁铁上下端盖（连接 N/S 极的导磁体，黑灰色）
        const capH = (ro - ri) * 0.5;
        [- ro * 0.9, ro * 0.9 - capH].forEach((dy) => {
            // 上下极靴
        });

        // 气隙提示线（可动线圈所在位置）
        this._staticGroup.add(new Konva.Arc({
            x: cx, y: cy,
            innerRadius: ri + 0.5, outerRadius: ri + 0.5,
            angle: 360,
            stroke: 'rgba(255,220,80,0.30)',
            strokeWidth: (ro - ri) * 0.90,
            rotation: 0,
            listening: false,
        }));
    }

    /** 圆柱形铁芯（气隙内） */
    _drawIronCore() {
        const { cx, cy } = this._magnet;
        const r = this._coreR;

        // 铁芯主体（深灰色，径向渐变体现圆柱感）
        this._staticGroup.add(new Konva.Circle({
            x: cx, y: cy, radius: r,
            fillRadialGradientStartPoint: { x: -r * 0.3, y: -r * 0.3 },
            fillRadialGradientEndPoint: { x: r, y: r },
            fillRadialGradientColorStops: [
                0, '#9a9aa2',
                0.4, '#5a5a62',
                1, '#2a2a32',
            ],
            stroke: '#3a3a42', strokeWidth: 0.8,
        }));

        // 铁芯顶部高光
        this._staticGroup.add(new Konva.Circle({
            x: cx - r * 0.25, y: cy - r * 0.25,
            radius: r * 0.35,
            fill: 'rgba(255,255,255,0.12)',
            listening: false,
        }));
    }

    /** 刻度盘弧线与零刻度线 */
    _drawDial() {
        const cx = this._dialCx, cy = this._dialCy, r = this._dialR;

        // 刻度弧（顶部半弧，从左侧到右侧）
        this._staticGroup.add(new Konva.Arc({
            x: cx, y: cy+15,
            innerRadius: r * 0.92, outerRadius: r * 0.92,
            angle: 180,
            rotation: 180,
            stroke: '#3a3040',
            strokeWidth: 1.5,
            dash: [],
            listening: false,
        }));

        // 零位挡针（左侧）— 铜色小柱
        const zeroRad = Math.PI; // Konva 180° → 数学 180° = 水平向左
        const zx = cx-5 + r * 0.88 * Math.cos(zeroRad);
        const zy = cy+22 + r * 0.88 * Math.sin(zeroRad);
        this._staticGroup.add(new Konva.Circle({
            x: zx, y: zy, radius: Math.max(3, this.width * 0.018),
            fill: '#c8a840', stroke: '#8a7020', strokeWidth: 0.5,
        }));

        // 满偏挡针（右侧）
        const fx = cx+3 + r * 0.88; // 数学 0° = 水平向右
        const fy = cy+22;            // sin(0)=0
        this._staticGroup.add(new Konva.Circle({
            x: fx, y: fy, radius: Math.max(3, this.width * 0.018),
            fill: '#c8a840', stroke: '#8a7020', strokeWidth: 0.5,
        }));
    }

    /** 刻度线（主刻度 + 副刻度） */
    _drawScaleTicks() {
        const cx = this._dialCx, cy = this._pivotY;
        const r  = this._dialR;
        const TICKS_MAJOR = 10;
        const TICKS_MINOR = 5;  // 每大格内副格数

        for (let i = 0; i <= TICKS_MAJOR * TICKS_MINOR; i++) {
            const frac    = i / (TICKS_MAJOR * TICKS_MINOR);
            // 从左侧 (π) 顺时针到顶部到右侧 (2π)，即顶部半弧
            const rad = (1 + frac) * Math.PI;

            const isMajor  = (i % TICKS_MINOR === 0);
            const isMid    = (i % Math.ceil(TICKS_MINOR / 2) === 0) && !isMajor;

            const tickLen = isMajor
                ? r * 0.10
                : isMid ? r * 0.065 : r * 0.040;

            const ro = r * 0.92;
            const ri = ro - tickLen;

            this._staticGroup.add(new Konva.Line({
                points: [
                    cx + ri * Math.cos(rad), cy + ri * Math.sin(rad),
                    cx + ro * Math.cos(rad), cy + ro * Math.sin(rad),
                ],
                stroke: '#2a2030',
                strokeWidth: isMajor ? 1.5 : 0.8,
                lineCap: 'round',
            }));
        }
    }

    /** 刻度数字 — 固定 0~100，不指明电流大小 */
    _drawScaleNumbers() {
        const cx = this._dialCx, cy = this._pivotY;
        const r  = this._dialR;
        const TICKS_MAJOR = 10;
        const fs = Math.max(7, this.width * 0.044);

        for (let i = 0; i <= TICKS_MAJOR; i++) {
            const frac     = i / TICKS_MAJOR;
            const rad = (1 + frac) * Math.PI;

            const nr   = r * 0.74;
            const nx   = cx + nr * Math.cos(rad);
            const ny   = cy + nr * Math.sin(rad);
            const label = String(Math.round(100 * frac));

            this._staticGroup.add(new Konva.Text({
                x: nx - fs * 1.2, y: ny - fs * 0.6,
                width: fs * 2.4, height: fs * 1.2,
                text: label,
                fontSize: fs * 0.85,
                fill: '#2a1a0a',
                align: 'center', verticalAlign: 'middle',
            }));
        }
    }

    /** 外侧电阻刻度（Ω）— 刻度线和文字朝外，非线性分布 */
    _drawResistanceScale() {
        const cx = this._dialCx, cy = this._dialCy + 15;
        const r  = this._dialR;
        const outerR  = r * 0.98;   // 外圈弧半径
        const majorLen = r * 0.070;
        const minorLen = r * 0.040;
        const R_MID = 20;           // 中值电阻

        // 弧线
        this._staticGroup.add(new Konva.Arc({
            x: cx, y: cy,
            innerRadius: outerR, outerRadius: outerR,
            angle: 180, rotation: 180,
            stroke: '#1a5a2a', strokeWidth: 1,
            listening: false,
        }));

        // 刻度定义：[电阻值, 标签, 主刻度]
        const ticks = [
            [Infinity, '∞', true],
            [500, '', false],
            [200, '200', true],
            [100, '100', true],
            [50, '50', true],
            [30, '30', true],
            [20, '20', true],
            [15, '15', true],
            [10, '10', true],
            [8, '', false],
            [6, '', false],
            [5, '5', true],
            [4, '', false],
            [3, '', false],
            [2, '2', true],
            [1.5, '', false],
            [1, '1', true],
            [0.5, '', false],
            [0, '0', true],
        ];

        const fs = Math.max(6, this.width * 0.032);

        ticks.forEach(([v, label, major]) => {
            const frac = v === Infinity ? 0 : R_MID / (R_MID + v);
            const rad  = (1 + frac) * Math.PI;
            const len  = major ? majorLen : minorLen;
            const ri   = outerR;
            const ro   = outerR + len;

            this._staticGroup.add(new Konva.Line({
                points: [
                    cx + ri * Math.cos(rad), cy + ri * Math.sin(rad),
                    cx + ro * Math.cos(rad), cy + ro * Math.sin(rad),
                ],
                stroke: '#1a5a2a',
                strokeWidth: major ? 1.2 : 0.6,
                lineCap: 'round',
            }));

            if (label && major) {
                const lr   = ro + fs * 0.15;
                const lx   = cx + lr * Math.cos(rad);
                const ly   = cy + lr * Math.sin(rad);
                this._staticGroup.add(new Konva.Text({
                    x: lx - fs * 1.0, y: ly - fs * 0.55,
                    width: fs * 2.0, height: fs * 1.2,
                    text: label,
                    fontSize: fs ,
                    fill: '#1a5a2a',
                    fontStyle: 'bold',
                    align: 'center', verticalAlign: 'middle',
                }));
            }
        });
    }

    /** 指针轴座底部 */
    _drawPivotBase() {
        const { x, y, r } = this._zeroKnob;
        // 轴座圆圈
        this._staticGroup.add(new Konva.Circle({
            x, y, radius: r * 1.6,
            fill: '#d8d0b8',
            stroke: '#b0a888', strokeWidth: 0.8,
        }));
    }

    /** 接线端子柱 */
    _drawTerminals() {
        const termData = [
            { t: this._termPos, label: '+', color: '#e53030' },
            { t: this._termNeg, label: '−', color: '#3050c8' },
        ];
        termData.forEach(({ t, label, color }) => {
            // 端子螺柱（黄铜色）
            this._staticGroup.add(new Konva.Circle({
                x: t.x, y: t.y, radius: t.r,
                fillLinearGradientStartPoint: { x: -t.r, y: -t.r },
                fillLinearGradientEndPoint: { x: t.r, y: t.r },
                fillLinearGradientColorStops: [0, '#d4b850', 0.5, '#f0d070', 1, '#a89030'],
                stroke: '#7a6820', strokeWidth: 0.8,
            }));
        });
    }

    /** 铭牌位号 */
    _drawLabel() {
        const fs = Math.max(16, this.width * 0.050);
        this._staticGroup.add(new Konva.Text({
            x: 0, y: -6, width: this.width,
            text: `${this.label}  ${this.fullScale}${this.unit}  Ri=${this.internalR}Ω`,
            fontSize: fs,
            fontStyle: 'bold',
            fill: '#546e7a',
            align: 'center',
        }));
    }

    /** 调零旋钮底座（槽口符号） */
    _drawZeroKnobBase() {
        const { x, y, r } = this._zeroKnob;
        // 旋钮圆
        this._staticGroup.add(new Konva.Circle({
            x, y, radius: r,
            fill: '#8a8890',
            stroke: '#5a5858', strokeWidth: 0.8,
        }));
        // 一字槽
        this._staticGroup.add(new Konva.Line({
            points: [x - r * 0.7, y, x + r * 0.7, y],
            stroke: '#3a3838', strokeWidth: 1.2, lineCap: 'round',
        }));
    }

    /**
     * 线圈符号（表盘下方，示意可动线圈）
     * 用小矩形框加两条引线表示
     */
    _drawCoilSymbol() {
        const cx = this._dialCx;
        const cy = this._dialCy + this._dialR * 0.20;
        const cw = this._dialR * 0.30;
        const ch = this._dialR * 0.16;

        // 线圈方框
        this._staticGroup.add(new Konva.Rect({
            x: cx - cw / 2, y: cy - ch / 2,
            width: cw, height: ch,
            fill: 'none',
            stroke: '#8a7050', strokeWidth: 0.8,
            dash: [2, 2],
        }));
        // 线圈内细线（匝数示意）
        for (let i = 1; i < 5; i++) {
            this._staticGroup.add(new Konva.Line({
                points: [cx - cw / 2 + cw * i / 5, cy - ch / 2,
                         cx - cw / 2 + cw * i / 5, cy + ch / 2],
                stroke: '#8a7050', strokeWidth: 0.5,
            }));
        }
    }

    // ═══════════════════════════════════════════════════════════
    // 动态层重建
    // ═══════════════════════════════════════════════════════════

    _rebuildDynamic() {
        this._dynamicGroup.destroyChildren();

        this._drawPointer();
        this._drawPivotPin();
        this._drawOverloadIndicator();
        this._drawReadoutText();
    }

    /**
     * 指针
     * 转轴位于 _pivotX/_pivotY，沿 Konva 角度偏转
     * 零点（Konva 180° = 数学 180°，水平向左）+ 当前偏转角（0~180°）
     */
    _drawPointer() {
        const cx   = this._pivotX;
        const cy   = this._pivotY;
        const pLen = this._ptrLen;
        const tail = this._ptrTailL;

        // 将物理偏转角 α（0~180°）映射到 Konva 旋转系
        // 零点方向：Konva 角 180°（水平向左），最大方向：360°（水平向右）
        const clampedAngle = Math.max(-5, Math.min(185, this._angle));
        const konvaRot = 180 + clampedAngle;

        const ptrGroup = new Konva.Group({
            x: cx, y: cy,
            rotation: konvaRot,
        });

        // 指针尾部（配重，短粗，深色）
        ptrGroup.add(new Konva.Line({
            points: [-tail, 0, 0, 0],
            stroke: '#3a3040',
            strokeWidth: Math.max(2.5, this.width * 0.016),
            lineCap: 'round',
        }));

        // 指针主体（逐渐变细）
        ptrGroup.add(new Konva.Line({
            points: [0, 0, pLen * 0.85, 0],
            stroke: '#2a2030',
            strokeWidth: Math.max(1.5, this.width * 0.010),
            lineCap: 'butt',
        }));

        // 指针尖端
        ptrGroup.add(new Konva.Line({
            points: [pLen * 0.85, 0, pLen, 0],
            stroke: '#c82020',
            strokeWidth: Math.max(0.8, this.width * 0.006),
            lineCap: 'round',
        }));

        // 指针根部（细长三角形增强视觉）
        ptrGroup.add(new Konva.Line({
            points: [0, -Math.max(2, this.width * 0.010),
                     pLen * 0.40, 0,
                     0, Math.max(2, this.width * 0.010)],
            closed: true,
            fill: '#3a3040',
            stroke: 'none',
            listening: false,
        }));

        this._dynamicGroup.add(ptrGroup);
    }

    /** 指针转轴中心销 */
    _drawPivotPin() {
        const r = Math.max(4, this.width * 0.022);
        this._dynamicGroup.add(new Konva.Circle({
            x: this._pivotX, y: this._pivotY, radius: r,
            fillRadialGradientStartPoint: { x: -r * 0.3, y: -r * 0.3 },
            fillRadialGradientEndPoint: { x: r, y: r },
            fillRadialGradientColorStops: [0, '#e0d8c0', 0.5, '#a09878', 1, '#6a6050'],
            stroke: '#5a5040', strokeWidth: 0.8,
        }));
        // 中心小点
        this._dynamicGroup.add(new Konva.Circle({
            x: this._pivotX, y: this._pivotY, radius: Math.max(1.5, this.width * 0.008),
            fill: '#2a2030',
        }));
    }

    /** 过载指示（红色感叹号闪烁） */
    _drawOverloadIndicator() {
        if (!this._overload) return;
        const flash = Math.floor(Date.now() / 400) % 2 === 0;
        if (!flash) return;

        const cx = this._case.x + this._case.w * 0.85;
        const cy = this._case.y + this._case.h * 0.18;

        this._dynamicGroup.add(new Konva.Text({
            x: cx - 12, y: cy - 12,
            width: 24, height: 24,
            text: '⚠',
            fontSize: Math.max(12, this.width * 0.072),
            fill: '#ff4040',
            align: 'center',
            shadowColor: '#ff2020',
            shadowBlur: 8,
            shadowOpacity: 0.8,
        }));
    }

    /** 数字示数（右下角小数字，以 0~100 百分数显示） */
    _drawReadoutText() {
        const ratio  = this.fullScale > 0 ? this._current / this.fullScale : 0;
        const pct    = Math.round(Math.max(0, Math.min(100, ratio * 100)));
        const fs     = Math.max(16, this.width * 0.052);

        this._dynamicGroup.add(new Konva.Rect({
            x: this._case.x + this._case.w * 0.32,
            y: this._case.y + this._case.h * 0.78,
            width: this._case.w * 0.38,
            height: fs * 1.7,
            fill: '#1a2a1a',
            cornerRadius: 3,
            stroke: '#2a4a2a', strokeWidth: 0.5,
        }));

        this._dynamicGroup.add(new Konva.Text({
            x: this._case.x + this._case.w * 0.32,
            y: this._case.y + this._case.h * 0.78 + fs * 0.22,
            width: this._case.w * 0.36,
            text: `${pct} %`,
            fontSize: fs,
            fontFamily: 'monospace',
            fill: '#40e040',
            align: 'center',
        }));
    }

    // ═══════════════════════════════════════════════════════════
    // 交互绑定
    // ═══════════════════════════════════════════════════════════

    _bindInteraction() {
        // 表盘区域点击：弹出配置（由框架处理，此处仅设置 cursor）
        const hitArea = new Konva.Circle({
            x: this._dialCx, y: this._dialCy,
            radius: this._dialR * 1.12,
            fill: 'transparent',
        });
        hitArea.on('mouseenter', () => {
            document.body.style.cursor = 'crosshair';
        });
        hitArea.on('mouseleave', () => {
            document.body.style.cursor = '';
        });
        this._interactGroup.add(hitArea);
    }

    // ═══════════════════════════════════════════════════════════
    // tick — 物理仿真（二阶阻尼系统）
    // ═══════════════════════════════════════════════════════════

    /**
     * 二阶阻尼指针模型
     *   α'' + 2ζω₀·α' + ω₀²·α = ω₀²·α_target
     *
     * 采用半步欧拉积分（Symplectic Euler），数值稳定
     */
    tick(dt) {
        const clampDt = Math.min(dt, 0.05); // 防止帧跳跃
        const voltage = this.sys.getVoltageBetween(`${this.id}_wire_l`, `${this.id}_wire_r`);
        this._current = 1e6 * voltage / this.internalR; // 转换为 μA

        // 目标角度（°）
        const ratio   = this.fullScale > 0 ? this._current / this.fullScale : 0;
        let   target  = ratio * this._pointerMaxAngle;

        // 越过零点时打挡针
        if (this._current < 0) {
            if (this._angle > 2) {
                this._zeroPulse = 4; // 触发振动
            }
            target = 0;
        }

        // 过载检测（±20% 容差）
        this._overload = (this._current > this.fullScale * 1.20) ||
                         (this._current < -this.fullScale * 0.20);
        if (this._overload) {
            target = Math.min(target, this._pointerMaxAngle * 1.10);
        }

        // 二阶响应
        const ω0  = this._omega0;
        const ζ   = this._damping;
        const err = target - this._angle;
        const acc = ω0 * ω0 * err - 2 * ζ * ω0 * this._angVel;

        this._angVel += acc * clampDt;
        this._angle  += this._angVel * clampDt;

        // 超限硬钳位
        this._angle = Math.max(-3, Math.min(this._pointerMaxAngle + 3, this._angle));
        if (this._angle < 0 || this._angle > this._pointerMaxAngle) {
            this._angVel *= -0.25; // 打挡针弹回
        }

        // 打零档针振动
        if (this._zeroPulse > 0) {
            this._angVel += (Math.random() - 0.5) * 80;
            this._zeroPulse--;
        }

        // 微振动时停止（节省绘制）
        const settled = Math.abs(err) < 0.08 && Math.abs(this._angVel) < 0.15;

        if (!settled || this._overload) {
            this._rebuildDynamic();
            this.markDirty();
        }

        this._refreshIfDirty();
    }

    // ═══════════════════════════════════════════════════════════
    // 公开 API
    // ═══════════════════════════════════════════════════════════

    /**
     * 设置输入电流（A）
     * @param {number} current
     */
    setCurrent(current) {
        this._current = current/1e6;
    }

    /** 获取当前电流读数（A） */
    getCurrent() { return this._current/1e6; }

    /** 获取指针偏转角（°，0~180） */
    getAngle() { return this._angle; }

    /** 是否过载 */
    isOverload() { return this._overload; }

    update(state) {
        if (typeof state === 'number') {
            this.setCurrent(state);
        }
    }

    getConfigFields() {
        return [
            { label: '位号/名称',       key: 'label',       type: 'text'   },
            { label: '满偏量程',         key: 'fullScale',   type: 'number' },
            { label: '单位 (A/mA/μA)',   key: 'unit',        type: 'text'   },
            { label: '内阻 (Ω)',         key: 'internalR',   type: 'number' },
            { label: '初始电流 (A)',      key: 'initCurrent', type: 'number' },
            { label: '阻尼系数 (0.1~2)', key: 'damping',     type: 'number' },
        ];
    }

    onConfigUpdate(cfg) {
        let needRebuildStatic = false;

        if (cfg.label !== undefined) {
            this.label = cfg.label;
            needRebuildStatic = true;
        }
        if (cfg.fullScale !== undefined) {
            this.fullScale = parseFloat(cfg.fullScale);
            needRebuildStatic = true;
        }
        if (cfg.unit !== undefined) {
            this.unit = cfg.unit;
            needRebuildStatic = true;
        }
        if (cfg.internalR !== undefined) {
            this.internalR = parseFloat(cfg.internalR);
            needRebuildStatic = true;
        }
        if (cfg.initCurrent !== undefined) {
            this._current = parseFloat(cfg.initCurrent);
        }
        if (cfg.damping !== undefined) {
            this._damping = parseFloat(cfg.damping);
        }

        this.config = { ...this.config, ...cfg };

        if (needRebuildStatic) {
            this._recalcGeometry();
            this._staticGroup.destroyChildren();
            this._drawStaticParts();
            this._refreshCache();
        }

        this._rebuildDynamic();
        this.markDirty();
        this._refreshIfDirty();
    }

    destroy() {
        super.destroy?.();
    }
}
