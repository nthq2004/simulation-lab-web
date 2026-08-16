import { BaseComponent } from './BaseComponent.js';

/**
 * 万用表表头工作原理演示仿真（磁电系电流计）
 * Galvanometer Head – Working Principle Demonstration
 *
 * 规格：满偏电流 50 μA，内阻 2000 Ω
 *
 * ═══ 物理模型 ════════════════════════════════════════════════════════
 *
 *  力矩方程（二阶弹簧-阻尼系统）：
 *    J·α'' + D·α' + K·α = T_em(t)
 *    J  : 转动惯量（线圈+指针+骨架）
 *    D  : 阻尼系数（空气阻尼片 + 感应电流阻尼）
 *    K  : 游丝弹性系数
 *    T_em = N·B·L·W·I = B_NI · I  （电磁转矩，∝ 电流）
 *    平衡时：α = (B_NI / K) · I   →  α ∝ I（线性刻度）
 *
 *  满偏条件：I_fs = 50 μA，α_fs = 120°（左端-60°到右端+60°，0°=中间）
 *    K = T_em_fs / α_fs = (B·N·I_L·W · I_fs) / α_fs
 *    仿真中统一归一化：令 I_n = I / I_fs ∈ [0,1]
 *    则平衡偏角 α_eq = α_fs · I_n
 *
 *  调零旋钮：改变游丝外端固定点角度 φ_zero
 *    等效于对游丝施加初始预扭，使指针零点偏移
 *    T_spring = K · (α - φ_zero)   （φ_zero 可调）
 *    平衡时：α_eq = (B_NI·I / K) + φ_zero
 *
 *  阻尼：临界阻尼模型（实际仪表接近临界阻尼，无明显振荡）
 *    ζ = D / (2·√(J·K)) ≈ 0.7~1.0
 *    仿真用一阶惯性近似（过阻尼简化）+ 轻微欠阻尼振荡
 *
 * ═══ 渲染布局（单页，大画幅） ═══════════════════════════════════════
 *
 *  ┌─────────────────────────────────────────────────────────────────┐
 *  │  【顶部】仪表刻度盘（多弧刻度，中央指针）                        │
 *  ├──────────────────┬──────────────────┬───────────────────────────┤
 *  │ 【左】永磁体剖面  │  【中】线圈/转轴  │  【右】力矩/游丝仪表盘     │
 *  │  + 磁力线动画    │  俯视透视结构     │   T_em箭头（红）           │
 *  │  + 安培力箭头    │  + 阻尼片        │   T_s箭头（蓝）            │
 *  │                  │  + 游丝螺旋      │   数值实时显示              │
 *  ├──────────────────┴──────────────────┴───────────────────────────┤
 *  │  【底部控制区】                                                   │
 *  │  调零旋钮（可拖动） ｜ 电流滑块 0~50μA ｜ 物理参数实时数值面板     │
 *  └─────────────────────────────────────────────────────────────────┘
 *
 * ═══ 可配置参数 ══════════════════════════════════════════════════════
 *  current   : 输入电流 μA（0~50，默认 0）
 *  zeroAdj   : 调零偏置角 °（-5~+5，默认 0）
 *  rampTime  : 响应时间常数 s（默认 0.25）
 */
export class GalvanometerHead extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.width  = Math.max(480, config.width  || 640);
        this.height = Math.max(380, config.height || 520);

        this.type    = 'INSTRUMENT';
        this.special = 'GALVANOMETER_HEAD';
        this.cache   = 'fixed';

        // 物理规格
        this.I_fs    = 50e-6;    // 满偏电流 50 μA
        this.R_i     = 2000;     // 内阻 2000 Ω
        this.α_fs    = 120;      // 满偏角度（度），指针从左60°到右60°，共120°
        this.α_half  = 60;       // 半偏角（单侧最大）

        this._initGroups();
        this._recalcGeometry();
        this._initParameters(config);
        this._init();

        this.config = {
            current:  this._targetI_uA,
            zeroAdj:  this._zeroAdj,
            rampTime: this._rampTime,
        };

        // 端口（底部）
        this.addPort(this._portP.x, this._portP.y, 'p', 'wire', 'p');
        this.addPort(this._portN.x, this._portN.y, 'n', 'wire', 'n');
    }

    // ═══════════════════════════════════════════════════
    // 几何
    // ═══════════════════════════════════════════════════

    _recalcGeometry() {
        const W = this.width, H = this.height;
        this._frame = { x: 2, y: 2, w: W - 4, h: H - 4, rx: 10 };

        // ── 刻度盘（顶部）─────────────────────────────
        const dialCx = W * 0.50;
        const dialCy = H * 0.025;        // 圆心在顶部框外（只露弧形刻度盘）
        const dialR  = Math.min(W * 0.44, H * 0.58);
        this._dial   = { cx: dialCx, cy: dialCy + dialR * 0.08, r: dialR };

        // 指针：从圆心向上（Konva 270°，即-90°）为零点，±60°为两端
        // Konva 角度：0°=右，顺时针正
        // 零偏角(右方向): 270°，左满偏: 270-60=210°，右满偏: 270+60=330°
        this._needleCenter = 270;   // 对应电流=0，零点方向
        this._needleHalf   = 60;    // 单侧最大偏角

        // ── 结构剖面区（中部）─────────────────────────
        const structTop  = dialCy + dialR * 0.88;  // 刻度盘底边下方
        const structH    = H * 0.38;
        const structCy   = structTop + structH * 0.50;

        // 磁钢（永磁体）：中央磁路
        const magW  = W * 0.56;
        const magH  = structH * 0.76;
        const magCx = W * 0.50;
        const magCy = structCy + structH * 0.04;
        this._mag   = { cx: magCx, cy: magCy, w: magW, h: magH };

        // 气隙（线圈活动区域）
        const gapW = magW * 0.36;
        const gapH = magH * 0.58;
        this._gap  = { cx: magCx, cy: magCy, w: gapW, h: gapH };

        // 软磁铁心（圆柱形，位于气隙中央）
        const coreR = gapW * 0.26;
        this._core  = { cx: magCx, cy: magCy, r: coreR };

        // 线圈骨架（在气隙中旋转）
        const coilW = gapW * 0.85, coilH = gapH * 0.80;
        this._coil  = { cx: magCx, cy: magCy, w: coilW, h: coilH };

        // 游丝区（线圈上方，视觉上叠在轴处）
        this._spring = { cx: magCx, cy: magCy - gapH * 0.52, r: coreR * 1.8 };

        // 阻尼片（线圈左侧）
        this._damp = { cx: magCx - gapW * 0.65, cy: magCy, w: gapW * 0.18, h: gapH * 0.52 };

        // ── 力矩显示区（右侧）─────────────────────────
        const torqX = W * 0.74, torqY = structTop + structH * 0.10;
        const torqW = W * 0.24, torqH = structH * 0.88;
        this._torqBox = { x: torqX, y: torqY, w: torqW, h: torqH };

        // ── 控制区（底部）────────────────────────────
        const ctrlY = structTop + structH + H * 0.01;
        const ctrlH = H - ctrlY - H * 0.03;
        this._ctrl  = { y: ctrlY, h: ctrlH };

        // 调零旋钮（左）
        this._knob  = { cx: W * 0.14, cy: ctrlY + ctrlH * 0.50, r: Math.min(ctrlH * 0.36, W * 0.055) };

        // 电流滑块（中）
        this._slider = { x: W * 0.32, y: ctrlY + ctrlH * 0.30, w: W * 0.38, h: ctrlH * 0.40 };

        // 数值面板（右）
        this._numPanel = { x: W * 0.74, y: ctrlY + 4, w: W * 0.24, h: ctrlH - 6 };

        // 端口（底边）
        this._portP = { x: W * 0.42, y: H - 2 };
        this._portN = { x: W * 0.58, y: H - 2 };
    }

    // ═══════════════════════════════════════════════════
    // 参数初始化
    // ═══════════════════════════════════════════════════

    _initParameters(config) {
        this._targetI_uA = config.current !== undefined ? parseFloat(config.current) : 0;
        this._currentI_uA = this._targetI_uA;
        this._zeroAdj    = config.zeroAdj  !== undefined ? parseFloat(config.zeroAdj) : 0;
        this._rampTime   = config.rampTime !== undefined ? parseFloat(config.rampTime) : 0.25;

        // 指针角度（Konva度）
        this._needleAngle  = this._calcNeedleAngle(this._currentI_uA);
        // 游丝外端固定点角度（调零时变化）
        this._springOuterAngle = this._needleCenter + this._zeroAdj;

        // 阻尼振荡模型
        this._velocity  = 0;    // 角速度（度/s）
        this._ζ         = 0.72; // 阻尼比

        // 安培力闪光计时（动画用）
        this._animTime = 0;

        // 滑块拖动状态
        this._sliderDragging = false;
        this._knobDragging   = false;
        this._knobAngle      = 0;   // 旋钮当前角度（度）

        // 力矩数值（实时计算）
        this._T_em = 0;
        this._T_s  = 0;
    }

    /** 计算指针目标 Konva 角度（线性刻度，零点=needleCenter） */
    _calcNeedleAngle(I_uA) {
        const frac   = Math.max(-1, Math.min(1, I_uA / 50));
        const rawAng = this._needleCenter + frac * this._needleHalf;
        return rawAng + this._zeroAdj;
    }

    // ═══════════════════════════════════════════════════
    // 主初始化
    // ═══════════════════════════════════════════════════

    _init() {
        this._drawStaticParts();
        this._createDynamicNodes();
        this._bindInteraction();
    }

    // ═══════════════════════════════════════════════════
    // 静态部件
    // ═══════════════════════════════════════════════════

    _drawStaticParts() {
        this._drawBackground();
        this._drawDialStatic();
        this._drawMagnetStatic();
        this._drawTorqueBoxStatic();
        this._drawControlAreaStatic();
        this._drawPortLabels();
    }

    _drawBackground() {
        const f = this._frame;
        // 主背景（深蓝灰）
        this._staticGroup.add(new Konva.Rect({
            x: f.x, y: f.y, width: f.w, height: f.h,
            fill: '#1e2430',
            stroke: '#303848', strokeWidth: 2,
            cornerRadius: f.rx,
        }));
        // 标题
        this._staticGroup.add(new Konva.Text({
            x: f.x + 8, y: f.y + 5,
            text: '万用表表头（磁电系）工作原理演示  |  I_fs = 50 μA，R_i = 2000 Ω',
            fontSize: Math.max(9, this.width * 0.017),
            fontFamily: 'Arial', fontStyle: 'bold',
            fill: '#80c8f0',
        }));
    }

    _drawDialStatic() {
        const { cx, cy, r } = this._dial;
        const W = this.width;

        // 刻度盘外圆弧（只显示上半部分）
        // 刻度盘背景扇形（奶白色，从 180° 到 360°，即上半圆）
        this._staticGroup.add(new Konva.Arc({
            x: cx, y: cy,
            innerRadius: r * 0.52, outerRadius: r,
            angle: this._needleHalf * 2 + 10,
            rotation: this._needleCenter - this._needleHalf - 5,
            fill: '#f0ece0',
            stroke: '#c0bca8', strokeWidth: 1.5,
        }));

        // 多层刻度弧线
        this._drawMultiScales();

        // 零线（中央竖向红线）
        const zeroRad = this._needleCenter * Math.PI / 180;
        this._staticGroup.add(new Konva.Line({
            points: [
                cx + r * 0.54 * Math.cos(zeroRad), cy + r * 0.54 * Math.sin(zeroRad),
                cx + r * 0.97 * Math.cos(zeroRad), cy + r * 0.97 * Math.sin(zeroRad),
            ],
            stroke: '#e04020', strokeWidth: 2.0, lineCap: 'round',
        }));

        // 刻度盘下边装饰线（底部圆弧切线）
        this._staticGroup.add(new Konva.Line({
            points: [
                cx + r * Math.cos((this._needleCenter - this._needleHalf - 5) * Math.PI / 180),
                cy + r * Math.sin((this._needleCenter - this._needleHalf - 5) * Math.PI / 180),
                cx + r * Math.cos((this._needleCenter + this._needleHalf + 5) * Math.PI / 180),
                cy + r * Math.sin((this._needleCenter + this._needleHalf + 5) * Math.PI / 180),
            ],
            stroke: '#b0aca0', strokeWidth: 1,
        }));

        // 中心轴孔
        this._staticGroup.add(new Konva.Circle({
            x: cx, y: cy, radius: r * 0.025,
            fill: '#808878', stroke: '#606060', strokeWidth: 1,
        }));

        // 底部"A-V-Ω"铭文
        const textFs = Math.max(10, r * 0.060);
        this._staticGroup.add(new Konva.Text({
            x: cx - r * 0.60, y: cy + r * 0.16,
            text: 'A — V — Ω',
            fontSize: textFs, fontFamily: 'Arial', fontStyle: 'bold italic',
            fill: '#404030',
            width: r * 1.20, align: 'center',
        }));
    }

    /** 绘制多弧刻度（三层：电流μA、百分比、参考Ω） */
    _drawMultiScales() {
        const { cx, cy, r } = this._dial;

        // ── 第1层（最外）：电流 μA 主刻度 ─────────────
        this._drawLinearArcScale({
            cx, cy,
            outerR: r * 0.97, innerR: r * 0.78,
            labelR: r * 0.70,
            startDeg: this._needleCenter - this._needleHalf,
            endDeg:   this._needleCenter + this._needleHalf,
            minVal: 0, maxVal: 50,
            majorDiv: 5, minorPerMajor: 5,
            labelSuffix: '',
            color: '#181818',
            fontSize: Math.max(7, r * 0.075),
        });

        // "μA" 单位
        const uaRad = this._needleCenter * Math.PI / 180;
        this._staticGroup.add(new Konva.Text({
            x: cx + r * 0.58 * Math.cos(uaRad) - 16,
            y: cy + r * 0.58 * Math.sin(uaRad) - 8,
            text: 'μA', fontSize: Math.max(8, r * 0.065),
            fontFamily: 'Arial', fontStyle: 'bold', fill: '#c81808',
            width: 32, align: 'center',
        }));

        // ── 第2层：百分比刻度（内层，蓝色） ──────────
        this._drawLinearArcScale({
            cx, cy,
            outerR: r * 0.76, innerR: r * 0.62,
            labelR: r * 0.55,
            startDeg: this._needleCenter - this._needleHalf,
            endDeg:   this._needleCenter + this._needleHalf,
            minVal: 0, maxVal: 100,
            majorDiv: 5, minorPerMajor: 2,
            labelSuffix: '',
            color: '#2050c0',
            fontSize: Math.max(6, r * 0.062),
            label: (v) => v === 0 ? '0' : (v === 50 ? '50' : (v === 100 ? '100%' : (v % 10 === 0 ? String(v) : '')))
        });
    }

    /** 通用线性弧形刻度绘制 */
    _drawLinearArcScale({ cx, cy, outerR, innerR, labelR, startDeg, endDeg,
                          minVal, maxVal, majorDiv, minorPerMajor,
                          labelSuffix, color, fontSize, label }) {
        const totalMajor  = majorDiv;
        const totalMinor  = majorDiv * minorPerMajor;

        for (let i = 0; i <= totalMinor; i++) {
            const frac   = i / totalMinor;
            const angDeg = startDeg + frac * (endDeg - startDeg);
            const angRad = angDeg * Math.PI / 180;
            const isMajor  = (i % minorPerMajor === 0);
            const isMedium = (i % minorPerMajor === Math.floor(minorPerMajor / 2));
            const inR = isMajor ? innerR : (isMedium ? innerR + (outerR - innerR) * 0.35 : outerR - (outerR - innerR) * 0.30);
            const sw  = isMajor ? 1.5 : 0.75;

            this._staticGroup.add(new Konva.Line({
                points: [
                    cx + outerR * Math.cos(angRad), cy + outerR * Math.sin(angRad),
                    cx + inR    * Math.cos(angRad), cy + inR    * Math.sin(angRad),
                ],
                stroke: color, strokeWidth: sw, lineCap: 'round', listening: false,
            }));

            if (isMajor) {
                const val = minVal + frac * (maxVal - minVal);
                const labelStr = label ? label(Math.round(val)) : (String(Math.round(val)) + labelSuffix);
                if (!labelStr) continue;
                this._staticGroup.add(new Konva.Text({
                    x: cx + labelR * Math.cos(angRad) - fontSize * 1.2,
                    y: cy + labelR * Math.sin(angRad) - fontSize * 0.6,
                    text: labelStr,
                    fontSize, fontFamily: 'Arial', fill: color,
                    align: 'center', width: fontSize * 2.4,
                }));
            }
        }

        // 导轨弧
        const arcPts = [];
        for (let i = 0; i <= 30; i++) {
            const a = (startDeg + (endDeg - startDeg) * i / 30) * Math.PI / 180;
            arcPts.push(cx + outerR * Math.cos(a), cy + outerR * Math.sin(a));
        }
        this._staticGroup.add(new Konva.Line({
            points: arcPts, stroke: color, strokeWidth: 1.2,
            lineCap: 'round', lineJoin: 'round', listening: false,
        }));
    }

    /** 磁钢 + 极靴 + 铁心（静态） */
    _drawMagnetStatic() {
        const { cx, cy, w, h }    = this._mag;
        const { w: gW, h: gH }    = this._gap;
        const { r: coreR }        = this._core;
        const W = this.width;

        // ── 永磁体（左N右S，深色背景） ───────────────
        // 磁钢体（竖向矩形，左=N，右=S）
        const mThk = (w - gW) / 2 * 0.80;  // 磁钢厚度
        // N极（左，蓝色）
        this._staticGroup.add(new Konva.Rect({
            x: cx - w / 2, y: cy - h / 2,
            width: mThk, height: h,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint:   { x: mThk, y: 0 },
            fillLinearGradientColorStops: [0, '#1028a0', 0.5, '#2040c8', 1, '#0818808'],
            stroke: '#102090', strokeWidth: 1.5, cornerRadius: 3,
        }));
        this._staticGroup.add(new Konva.Text({
            x: cx - w / 2, y: cy - h / 2 + h * 0.38,
            text: 'N', fontSize: Math.max(14, mThk * 0.55),
            fontFamily: 'Arial', fontStyle: 'bold',
            fill: '#d8e8ff', width: mThk, align: 'center',
        }));

        // S极（右，红色）
        this._staticGroup.add(new Konva.Rect({
            x: cx + w / 2 - mThk, y: cy - h / 2,
            width: mThk, height: h,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint:   { x: mThk, y: 0 },
            fillLinearGradientColorStops: [0, '#a01818', 0.5, '#c82020', 1, '#a01818'],
            stroke: '#901010', strokeWidth: 1.5, cornerRadius: 3,
        }));
        this._staticGroup.add(new Konva.Text({
            x: cx + w / 2 - mThk, y: cy - h / 2 + h * 0.38,
            text: 'S', fontSize: Math.max(14, mThk * 0.55),
            fontFamily: 'Arial', fontStyle: 'bold',
            fill: '#ffd8d8', width: mThk, align: 'center',
        }));

        // ── 极靴（软磁铁心，弧形，左右各一）──────────
        const poleW = (w / 2 - gW / 2) * 0.95;
        const poleX_L = cx - w / 2 + mThk;
        const poleX_R = cx + gW / 2;
        [poleX_L, poleX_R].forEach((px, side) => {
            this._staticGroup.add(new Konva.Rect({
                x: px, y: cy - gH / 2 * 1.10,
                width: poleW * (side === 0 ? 1 : -1) + (side === 0 ? 0 : poleW),
                height: gH * 1.10,
                fill: side === 0 ? '#384858' : '#384858',
                stroke: '#283848', strokeWidth: 1.2,
                cornerRadius: side === 0 ? [0, 4, 4, 0] : [4, 0, 0, 4],
            }));
        });
        // 极靴（IEC形弧面，简化为圆弧矩形）
        this._staticGroup.add(new Konva.Rect({
            x: cx - w / 2 + mThk, y: cy - gH * 1.10 / 2,
            width: poleW, height: gH * 1.10,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint:   { x: poleW, y: 0 },
            fillLinearGradientColorStops: [0, '#384858', 0.8, '#506070', 1, '#607080'],
            stroke: '#283848', strokeWidth: 1.2,
        }));
        this._staticGroup.add(new Konva.Rect({
            x: cx + gW / 2, y: cy - gH * 1.10 / 2,
            width: poleW, height: gH * 1.10,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint:   { x: poleW, y: 0 },
            fillLinearGradientColorStops: [0, '#607080', 0.2, '#506070', 1, '#384858'],
            stroke: '#283848', strokeWidth: 1.2,
        }));

        // ── 气隙区域（线圈活动空间）────────────────
        this._staticGroup.add(new Konva.Rect({
            x: cx - gW / 2, y: cy - gH / 2,
            width: gW, height: gH,
            fill: '#1a2230',
        }));

        // ── 软磁铁心（圆柱形，气隙中央固定）──────────
        this._staticGroup.add(new Konva.Ellipse({
            x: cx, y: cy,
            radiusX: coreR, radiusY: coreR * 0.65,
            fillLinearGradientStartPoint: { x: -coreR, y: 0 },
            fillLinearGradientEndPoint:   { x:  coreR, y: 0 },
            fillLinearGradientColorStops: [0, '#4a5a6a', 0.5, '#788898', 1, '#4a5a6a'],
            stroke: '#3a4a5a', strokeWidth: 1.5,
        }));
        this._staticGroup.add(new Konva.Text({
            x: cx - coreR, y: cy - coreR * 0.38,
            text: '铁心', fontSize: Math.max(6, coreR * 0.38),
            fontFamily: 'Arial', fill: '#b0c0d0',
            width: coreR * 2, align: 'center',
        }));

        // ── 结构标注 ──────────────────────────────────
        const fs = Math.max(8, this.width * 0.018);
        [
            { x: cx - w / 2 - 2, y: cy - h / 2 - 16, text: '永磁体（磁钢）', color: '#80a8e0' },
            { x: cx - w / 2 + mThk + 2, y: cy - gH / 2 - 16, text: '极靴（软磁）', color: '#90b8c8' },
            { x: cx - gW / 2, y: cy + gH / 2 + 4, text: '气隙', color: '#70a8c0' },
        ].forEach(lb => {
            this._staticGroup.add(new Konva.Text({
                x: lb.x, y: lb.y, text: lb.text,
                fontSize: fs, fontFamily: 'Arial', fill: lb.color,
            }));
        });

        // ── 磁场方向箭头（静态，气隙内 B 水平向右）────
        const arrowY = cy;
        const arrowX0 = cx - gW / 2 + 4, arrowX1 = cx + gW / 2 - 4;
        for (let i = -1; i <= 1; i++) {
            const ay = cy + (gH / 3) * i * 0.65;
            this._staticGroup.add(new Konva.Arrow({
                points: [cx - gW / 3, ay, cx + gW / 3, ay],
                fill: 'rgba(100,180,255,0.45)',
                stroke: 'rgba(100,180,255,0.45)',
                strokeWidth: 1.2, pointerLength: 5, pointerWidth: 4,
                listening: false,
            }));
        }
        this._staticGroup.add(new Konva.Text({
            x: cx + gW * 0.55, y: cy - 10,
            text: 'B →', fontSize: fs, fontFamily: 'Arial',
            fill: '#60b0f0',
        }));

        // ── 底座圆盘 ──────────────────────────────────
        this._staticGroup.add(new Konva.Ellipse({
            x: cx, y: cy + h / 2 + 6,
            radiusX: w * 0.52, radiusY: h * 0.06,
            fillLinearGradientStartPoint: { x: -w * 0.52, y: 0 },
            fillLinearGradientEndPoint:   { x:  w * 0.52, y: 0 },
            fillLinearGradientColorStops: [0, '#3a4050', 0.5, '#5a6070', 1, '#3a4050'],
            stroke: '#283038', strokeWidth: 1.5,
        }));

        // ── 力矩盒分割线 ─────────────────────────────
        const tbx = this._torqBox;
        this._staticGroup.add(new Konva.Rect({
            x: tbx.x, y: tbx.y, width: tbx.w, height: tbx.h,
            fill: '#151c28', stroke: '#304050', strokeWidth: 1.2, cornerRadius: 5,
        }));
        const tfs = Math.max(8, this.width * 0.017);
        this._staticGroup.add(new Konva.Text({
            x: tbx.x + 3, y: tbx.y + 4,
            text: '力矩分析',
            fontSize: tfs, fontFamily: 'Arial', fontStyle: 'bold',
            fill: '#70c0f0', width: tbx.w - 6, align: 'center',
        }));
    }

    /** 力矩盒静态 */
    _drawTorqueBoxStatic() {
        const { x, y, w, h } = this._torqBox;
        const fs = Math.max(7, this.width * 0.015);
        const lh = fs + 4;

        // 说明文字（静态标注）
        const lines = [
            { t: 'T_em（电磁驱动）', c: '#f06040' },
            { t: '= N·B·L·W·I', c: '#f09060' },
            { t: '= k_em · I', c: '#f09060' },
            { t: '', c: '' },
            { t: 'T_s（游丝反力）', c: '#4090f0' },
            { t: '= K · α', c: '#60b0f0' },
            { t: '', c: '' },
            { t: '平衡时：', c: '#90c0d0' },
            { t: 'T_em = T_s', c: '#c0e8f0' },
            { t: 'α = k_em/K · I', c: '#c0e8f0' },
            { t: 'α ∝ I（线性）', c: '#80d0a0' },
        ];
        const startY = y + fs * 3.5;
        lines.forEach((ln, i) => {
            if (!ln.t) return;
            this._staticGroup.add(new Konva.Text({
                x: x + 5, y: startY + i * lh,
                text: ln.t, fontSize: fs,
                fontFamily: i % 3 === 1 || i % 3 === 2 ? 'Courier New' : 'Arial',
                fill: ln.c, width: w - 10,
            }));
        });
    }

    /** 控制区静态底层 */
    _drawControlAreaStatic() {
        const { y, h } = this._ctrl;
        const W = this.width;

        // 控制区背景
        this._staticGroup.add(new Konva.Rect({
            x: 6, y: y + 2, width: W - 12, height: h - 2,
            fill: '#151c28', stroke: '#304050', strokeWidth: 1, cornerRadius: 5,
        }));

        // 调零旋钮区标注
        const kx = this._knob.cx, ky = this._knob.cy;
        const kr = this._knob.r;
        this._staticGroup.add(new Konva.Text({
            x: kx - kr * 2, y: ky - kr - 18,
            text: '调零旋钮', fontSize: Math.max(8, kr * 0.45),
            fontFamily: 'Arial', fill: '#80c0d0',
            width: kr * 4, align: 'center',
        }));
        this._staticGroup.add(new Konva.Text({
            x: kx - kr * 2, y: ky + kr + 4,
            text: '点击拖动调零', fontSize: Math.max(7, kr * 0.38),
            fontFamily: 'Arial', fill: '#507090',
            width: kr * 4, align: 'center',
        }));

        // 旋钮外圈
        this._staticGroup.add(new Konva.Circle({
            x: kx, y: ky, radius: kr + 4,
            fill: '#202830', stroke: '#405060', strokeWidth: 1.5,
        }));

        // 电流滑块区标注
        const sl = this._slider;
        this._staticGroup.add(new Konva.Text({
            x: sl.x, y: sl.y - 18,
            text: '输入电流 I（μA）',
            fontSize: Math.max(8, sl.h * 0.26), fontFamily: 'Arial',
            fill: '#80c0d0', width: sl.w,
        }));
        // 滑槽背景
        this._staticGroup.add(new Konva.Rect({
            x: sl.x, y: sl.y + sl.h * 0.35,
            width: sl.w, height: sl.h * 0.28,
            fill: '#202830', stroke: '#304050', strokeWidth: 1, cornerRadius: 3,
        }));
        // 刻度标注（0、12.5、25、37.5、50）
        [0, 0.25, 0.5, 0.75, 1.0].forEach(t => {
            const tx = sl.x + t * sl.w;
            const val = Math.round(t * 50);
            this._staticGroup.add(new Konva.Line({
                points: [tx, sl.y + sl.h * 0.63, tx, sl.y + sl.h * 0.72],
                stroke: '#507080', strokeWidth: 1,
            }));
            this._staticGroup.add(new Konva.Text({
                x: tx - 12, y: sl.y + sl.h * 0.73,
                text: String(val), fontSize: Math.max(7, sl.h * 0.22),
                fontFamily: 'Arial', fill: '#607888',
                width: 24, align: 'center',
            }));
        });

        // 端口标注
        const fs = Math.max(8, this.width * 0.018);
        this._staticGroup.add(new Konva.Text({
            x: this._portP.x - 12, y: this.height - 14,
            text: 'P（+）', fontSize: fs, fontFamily: 'Arial', fontStyle: 'bold',
            fill: '#d03018',
        }));
        this._staticGroup.add(new Konva.Text({
            x: this._portN.x - 12, y: this.height - 14,
            text: 'N（-）', fontSize: fs, fontFamily: 'Arial', fontStyle: 'bold',
            fill: '#3060d0',
        }));

        // 数值面板框
        const np = this._numPanel;
        this._staticGroup.add(new Konva.Rect({
            x: np.x, y: np.y, width: np.w, height: np.h,
            fill: '#0e1420', stroke: '#304050', strokeWidth: 1, cornerRadius: 4,
        }));
        this._staticGroup.add(new Konva.Text({
            x: np.x + 3, y: np.y + 3,
            text: '实时物理量', fontSize: Math.max(7, np.w * 0.10),
            fontFamily: 'Arial', fontStyle: 'bold', fill: '#608090',
            width: np.w - 6, align: 'center',
        }));
    }

    _drawPortLabels() {
        // 端口引线
        [this._portP, this._portN].forEach((pt, i) => {
            this._staticGroup.add(new Konva.Line({
                points: [pt.x, this._ctrl.y + this._ctrl.h - 8, pt.x, this.height - 2],
                stroke: i === 0 ? '#d03018' : '#3060d0', strokeWidth: 2,
            }));
        });
    }

    // ═══════════════════════════════════════════════════
    // 动态节点
    // ═══════════════════════════════════════════════════

    _createDynamicNodes() {
        this._createNeedle();
        this._createCoil();
        this._createHairspring();
        this._createDampingVane();
        this._createMagneticFieldLines();
    this._createAmpereForceDynamic();
        this._createTorqueArrows();
        this._createKnobDynamic();
        this._createSliderDynamic();
        this._createNumDisplay();
    }

    /** 指针（主表针） */
    _createNeedle() {
        const { cx, cy } = this._dial;
        const { r } = this._dial;
        const needleLen  = r * 0.92;
        const tailLen    = r * 0.08;

        this._needleGroup = new Konva.Group({ x: cx, y: cy, rotation: this._needleAngle });

        // 针身（细长三角形）
        this._needleGroup.add(new Konva.Line({
            points: [-tailLen, 0, needleLen * 0.94, 0],
            stroke: '#181410', strokeWidth: 1.8, lineCap: 'round',
        }));
        // 针尖
        this._needleGroup.add(new Konva.Line({
            points: [needleLen * 0.72, -1.5, needleLen * 0.94, 0, needleLen * 0.72, 1.5],
            closed: true, fill: '#181410', stroke: '#181410', strokeWidth: 0.5,
        }));
        // 配重
        this._needleGroup.add(new Konva.Rect({
            x: -tailLen - 4, y: -2, width: 6, height: 4,
            fill: '#101008', cornerRadius: 1,
        }));

        this._dynamicGroup.add(this._needleGroup);

        // 中心轴帽
        this._dynamicGroup.add(new Konva.Circle({
            x: cx, y: cy, radius: r * 0.025,
            fillLinearGradientStartPoint: { x: -3, y: -3 },
            fillLinearGradientEndPoint:   { x:  3, y:  3 },
            fillLinearGradientColorStops: [0, '#f0e060', 0.5, '#c8a030', 1, '#907020'],
            stroke: '#706018', strokeWidth: 1, listening: false,
        }));
    }

    /** 动圈线圈（矩形框，随指针同步旋转，在气隙中） */
    _createCoil() {
        const { cx, cy }   = this._mag;
        const { w: cW, h: cH } = this._coil;

        this._coilGroup = new Konva.Group({ x: cx, y: cy, rotation: 0 });

        // 铝框线圈（矩形骨架）
        this._coilGroup.add(new Konva.Rect({
            x: -cW / 2, y: -cH / 2, width: cW, height: cH,
            fill: 'transparent',
            stroke: '#c07030', strokeWidth: 2.5,
            cornerRadius: 2,
        }));

        // 导线匝（内部横线，表示多匝绕线）
        const turnCount = 8;
        for (let i = 0; i < turnCount; i++) {
            const t  = (i + 0.5) / turnCount;
            const lx = -cW / 2 + cW * t;
            this._coilGroup.add(new Konva.Line({
                points: [-cW / 2 + 2, -cH / 2 + cH * t, cW / 2 - 2, -cH / 2 + cH * t],
                stroke: `rgba(180,100,30,${0.3 + t * 0.3})`,
                strokeWidth: 0.8, listening: false,
            }));
        }

        // 线圈标注
        this._coilGroup.add(new Konva.Text({
            x: -cW / 2, y: -cH / 2 - 14,
            text: '动圈（N匝）', fontSize: Math.max(6, this.width * 0.014),
            fontFamily: 'Arial', fill: '#e0a050',
            width: cW, align: 'center',
        }));

        this._dynamicGroup.add(this._coilGroup);
    }

    /** 游丝（螺旋弹簧，绕轴中心） */
    _createHairspring() {
        const { cx, cy, r } = this._spring;

        this._hairspringGroup = new Konva.Group({ x: cx, y: cy });

        // 多圈螺旋游丝
        this._springLine = null;   // 动态重建
        this._hairspringInnerAngle  = 0;   // 内端（随线圈转）
        this._hairspringOuterAngle  = this._needleCenter + this._zeroAdj;  // 外端（调零时改变）

        this._dynamicGroup.add(this._hairspringGroup);

        // 游丝静态标注
        this._staticGroup.add(new Konva.Text({
            x: cx - r * 2.5, y: cy - r - 14,
            text: '游丝（弹性反力矩）',
            fontSize: Math.max(7, this.width * 0.016), fontFamily: 'Arial',
            fill: '#7080d0', width: r * 5, align: 'center',
        }));
    }

    /** 阻尼翼片（空气阻尼） */
    _createDampingVane() {
        const { cx, cy, w, h } = this._damp;

        this._dampGroup = new Konva.Group({ x: this._mag.cx, y: this._mag.cy, rotation: 0 });

        // 阻尼翼片（铝质，固定在线圈骨架上）
        const dvW = w * 1.8, dvH = h;
        this._dampGroup.add(new Konva.Rect({
            x: -dvW / 2, y: -dvH / 2,
            width: dvW, height: dvH,
            fill: 'rgba(160,180,200,0.55)',
            stroke: '#8898a8', strokeWidth: 0.8, cornerRadius: 2,
        }));

        this._dynamicGroup.add(this._dampGroup);

        // 阻尼标注
        this._staticGroup.add(new Konva.Text({
            x: this._mag.cx - this._gap.w * 1.2,
            y: this._mag.cy + this._gap.h / 2 + 4,
            text: '阻尼片', fontSize: Math.max(7, this.width * 0.015),
            fontFamily: 'Arial', fill: '#8098b0',
        }));
    }

    /** 磁场线（气隙内，静态磁场动画） */
    _createMagneticFieldLines() {
        this._bFieldGroup = new Konva.Group({ listening: false });
        this._dynamicGroup.add(this._bFieldGroup);
    }

    /** 安培力箭头（线圈两侧，随电流和转角变化） */
    _createAmpereForceDynamic() {
        this._ampereGroup = new Konva.Group({ listening: false });
        this._dynamicGroup.add(this._ampereGroup);
    }

    /** 力矩箭头仪表（右侧力矩盒内） */
    _createTorqueArrows() {
        const { x, y, w, h } = this._torqBox;
        const barMaxH = h * 0.22;
        const barW    = w * 0.55;
        const barX    = x + (w - barW) / 2;

        // T_em 条形（红色）
        const emBarY = y + h * 0.56;
        this._emBar = new Konva.Rect({
            x: barX + barW / 2, y: emBarY, width: 0, height: barMaxH,
            fill: '#e06030', cornerRadius: [0, 0, 2, 2],
        });
        this._dynamicGroup.add(new Konva.Rect({
            x: barX, y: emBarY, width: barW, height: barMaxH,
            fill: '#1a1e28', stroke: '#e06030', strokeWidth: 1, cornerRadius: 2,
        }));
        this._dynamicGroup.add(this._emBar);

        // T_s 条形（蓝色）
        const sBarY  = y + h * 0.78;
        this._sBar = new Konva.Rect({
            x: barX + barW / 2, y: sBarY, width: 0, height: barMaxH,
            fill: '#3060e0', cornerRadius: [0, 0, 2, 2],
        });
        this._dynamicGroup.add(new Konva.Rect({
            x: barX, y: sBarY, width: barW, height: barMaxH,
            fill: '#1a1e28', stroke: '#3060e0', strokeWidth: 1, cornerRadius: 2,
        }));
        this._dynamicGroup.add(this._sBar);

        // 条形标注
        const bfs = Math.max(7, this.width * 0.014);
        this._emBarLabel = new Konva.Text({
            x: barX, y: emBarY - bfs - 2,
            text: 'T_em = 0.00 nN·m',
            fontSize: bfs, fontFamily: 'Courier New', fill: '#f08060',
            width: barW,
        });
        this._sBarLabel = new Konva.Text({
            x: barX, y: sBarY - bfs - 2,
            text: 'T_s  = 0.00 nN·m',
            fontSize: bfs, fontFamily: 'Courier New', fill: '#6090f0',
            width: barW,
        });
        this._dynamicGroup.add(this._emBarLabel);
        this._dynamicGroup.add(this._sBarLabel);
    }

    /** 调零旋钮（动态可旋转） */
    _createKnobDynamic() {
        const { cx, cy, r } = this._knob;

        this._knobGroup = new Konva.Group({ x: cx, y: cy, rotation: this._knobAngle });

        // 旋钮本体
        this._knobGroup.add(new Konva.Circle({
            x: 0, y: 0, radius: r,
            fillRadialGradientStartPoint:  { x: -r * 0.3, y: -r * 0.3 },
            fillRadialGradientEndPoint:    { x: 0, y: 0 },
            fillRadialGradientStartRadius: 0,
            fillRadialGradientEndRadius:   r,
            fillRadialGradientColorStops:  [0, '#6a7278', 0.6, '#3a4248', 1, '#252c32'],
            stroke: '#202830', strokeWidth: 1.5,
        }));

        // 指示线（随旋转变化）
        this._knobGroup.add(new Konva.Line({
            points: [0, -r * 0.25, 0, -r * 0.82],
            stroke: '#e8d060', strokeWidth: 2, lineCap: 'round',
        }));

        // 中心点
        this._knobGroup.add(new Konva.Circle({
            x: 0, y: 0, radius: r * 0.18,
            fill: '#1a2028', stroke: '#384050', strokeWidth: 1,
        }));

        // 十字槽
        this._knobGroup.add(new Konva.Line({
            points: [-r * 0.12, 0, r * 0.12, 0],
            stroke: '#303838', strokeWidth: 1.2, lineCap: 'round',
        }));
        this._knobGroup.add(new Konva.Line({
            points: [0, -r * 0.12, 0, r * 0.12],
            stroke: '#303838', strokeWidth: 1.2, lineCap: 'round',
        }));

        this._dynamicGroup.add(this._knobGroup);
    }

    /** 滑块（电流输入） */
    _createSliderDynamic() {
        const sl = this._slider;
        const sliderH = sl.h * 0.55;
        const sliderW = sl.h * 0.42;

        this._sliderHandle = new Konva.Rect({
            x: sl.x - sliderW / 2, y: sl.y + sl.h * 0.20,
            width: sliderW, height: sliderH,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint:   { x: sliderW, y: 0 },
            fillLinearGradientColorStops: [0, '#506878', 0.5, '#6888a0', 1, '#506878'],
            stroke: '#304050', strokeWidth: 1.5, cornerRadius: 3,
        });
        this._dynamicGroup.add(this._sliderHandle);

        // 填充条（左侧已填充部分）
        this._sliderFill = new Konva.Rect({
            x: sl.x, y: sl.y + sl.h * 0.35,
            width: 0, height: sl.h * 0.28,
            fill: '#d06030', cornerRadius: [3, 0, 0, 3],
        });
        this._dynamicGroup.add(this._sliderFill);
    }

    /** 数值面板 */
    _createNumDisplay() {
        const np = this._numPanel;
        const fs = Math.max(7, np.w * 0.090);
        const lh = fs + 4;
        const startY = np.y + fs * 2.0;

        const labels = [
            { key: 'I',       label: 'I =',      unit: ' μA',    color: '#e08040' },
            { key: 'U',       label: 'U =',      unit: ' mV',    color: '#e08040' },
            { key: 'alpha',   label: 'α =',      unit: ' °',     color: '#40d080' },
            { key: 'Tem',     label: 'T_em =',   unit: ' nN·m',  color: '#f06040' },
            { key: 'Ts',      label: 'T_s =',    unit: ' nN·m',  color: '#4090f0' },
            { key: 'dT',      label: 'ΔT =',     unit: ' nN·m',  color: '#d0c040' },
            { key: 'zero',    label: 'φ₀ =',     unit: ' °',     color: '#80b0d0' },
        ];

        this._numTexts = {};
        labels.forEach((lb, i) => {
            this._staticGroup.add(new Konva.Text({
                x: np.x + 4, y: startY + i * lh,
                text: lb.label, fontSize: fs, fontFamily: 'Arial',
                fill: '#607888',
            }));
            this._numTexts[lb.key] = new Konva.Text({
                x: np.x + np.w * 0.42, y: startY + i * lh,
                text: '0', fontSize: fs, fontFamily: 'Courier New',
                fill: lb.color, width: np.w * 0.58 - 4,
            });
            this._dynamicGroup.add(this._numTexts[lb.key]);
        });

        // 单位（静态）
        labels.forEach((lb, i) => {
            this._staticGroup.add(new Konva.Text({
                x: np.x + np.w * 0.58, y: startY + i * lh,
                text: lb.unit, fontSize: fs * 0.82, fontFamily: 'Arial',
                fill: '#506070',
            }));
        });
    }

    // ═══════════════════════════════════════════════════
    // 交互绑定
    // ═══════════════════════════════════════════════════

    _bindInteraction() {
        const sl  = this._slider;
        const { cx: kx, cy: ky, r: kr } = this._knob;

        // ── 滑块拖动 ─────────────────────────────────
        const sliderHit = new Konva.Rect({
            x: sl.x - 10, y: sl.y,
            width: sl.w + 20, height: sl.h,
            fill: 'transparent',
        });

        sliderHit.on('mousedown touchstart', (e) => {
            this._sliderDragging = true;
            this._updateSliderFromEvent(e);
        });
        sliderHit.on('mouseenter', () => { document.body.style.cursor = 'ew-resize'; });
        sliderHit.on('mouseleave', () => { if (!this._sliderDragging) document.body.style.cursor = 'default'; });

        const stage = this._interactGroup.getStage?.();
        if (stage) {
            stage.on('mousemove touchmove', (e) => {
                if (this._sliderDragging) this._updateSliderFromEvent(e);
                if (this._knobDragging)   this._updateKnobFromEvent(e);
            });
            stage.on('mouseup touchend', () => {
                this._sliderDragging = false;
                this._knobDragging   = false;
                document.body.style.cursor = 'default';
            });
        }

        this._interactGroup.add(sliderHit);

        // ── 旋钮拖动 ─────────────────────────────────
        const knobHit = new Konva.Circle({
            x: kx, y: ky, radius: kr + 6, fill: 'transparent',
        });
        knobHit.on('mousedown touchstart', (e) => {
            this._knobDragging = true;
            this._knobDragStartY = e.evt.clientY || e.evt.touches?.[0]?.clientY || ky;
            this._knobDragStartAdj = this._zeroAdj;
        });
        knobHit.on('mouseenter', () => { document.body.style.cursor = 'pointer'; });
        knobHit.on('mouseleave', () => { if (!this._knobDragging) document.body.style.cursor = 'default'; });
        this._interactGroup.add(knobHit);
    }

    _updateSliderFromEvent(e) {
        const sl  = this._slider;
        const pos = e.target.getStage().getPointerPosition();
        if (!pos) return;
        const t   = Math.max(0, Math.min(1, (pos.x - sl.x) / sl.w));
        this._targetI_uA = t * 50;
    }

    _updateKnobFromEvent(e) {
        if (!this._knobDragging) return;
        const clientY = e.evt.clientY || e.evt.touches?.[0]?.clientY || 0;
        const dy = this._knobDragStartY - clientY;
        const newAdj = Math.max(-5, Math.min(5, this._knobDragStartAdj + dy * 0.18));
        this._zeroAdj = newAdj;
        this._knobAngle = this._zeroAdj * 12;   // 旋钮视觉旋转
    }

    // ═══════════════════════════════════════════════════
    // 动态更新
    // ═══════════════════════════════════════════════════

    _updateDynamic(dt) {
        const I_uA  = this._currentI_uA;
        const I_A   = I_uA * 1e-6;
        const frac  = I_uA / 50;   // 归一化 0~1

        // 当前指针目标角度
        const targetAngle = this._calcNeedleAngle(I_uA);

        // 带欠阻尼振荡的二阶响应（简化离散实现）
        const ω0   = 2 * Math.PI / this._rampTime;
        const ζ    = 0.72;
        const kp   = ω0 * ω0 * dt * dt + 2 * ζ * ω0 * dt;
        const err  = targetAngle - this._needleAngle;
        const acc  = ω0 * ω0 * err - 2 * ζ * ω0 * this._velocity;
        this._velocity   += acc * dt;
        this._needleAngle += this._velocity * dt;

        // 角度限位
        const minAng = this._needleCenter - this._needleHalf - 2 + this._zeroAdj;
        const maxAng = this._needleCenter + this._needleHalf + 2 + this._zeroAdj;
        this._needleAngle = Math.max(minAng, Math.min(maxAng, this._needleAngle));

        // 当前偏转角（相对零点）
        const alpha_deg = this._needleAngle - (this._needleCenter + this._zeroAdj);

        // 力矩计算（归一化）
        // 物理参数：N=50匝，B=0.1T，L=20mm，W=15mm → k_em = N·B·L·W ≈ 150 μN·m/A
        const k_em = 150e-9;   // N·m/A
        const K    = k_em / (this._needleHalf * Math.PI / 180);   // 游丝刚度（N·m/rad）

        this._T_em = k_em * I_A;                                          // N·m
        this._T_s  = K * ((alpha_deg - this._zeroAdj) * Math.PI / 180);  // N·m（游丝）

        const T_em_nNm = this._T_em * 1e9;
        const T_s_nNm  = this._T_s  * 1e9;

        // ── 1) 主指针 ────────────────────────────────
        this._needleGroup.rotation(this._needleAngle);

        // ── 2) 动圈（与指针同步，但在表头磁路中） ───
        const coilAngle = alpha_deg;
        this._coilGroup.rotation(coilAngle);
        this._dampGroup.rotation(coilAngle);

        // ── 3) 游丝（螺旋，内端随线圈转，外端固定） ──
        this._updateHairspring(alpha_deg);

        // ── 4) 安培力箭头（线圈两侧） ────────────────
        this._updateAmpereForces(frac, coilAngle);

        // ── 5) 力矩条形图 ─────────────────────────────
        this._updateTorqueBars(T_em_nNm, T_s_nNm);

        // ── 6) 调零旋钮 ──────────────────────────────
        this._knobGroup.rotation(this._knobAngle);

        // ── 7) 滑块位置 ──────────────────────────────
        const sl    = this._slider;
        const slPos = (I_uA / 50) * sl.w;
        this._sliderHandle.x(sl.x + slPos - this._sliderHandle.width() / 2);
        this._sliderFill.width(slPos);
        this._sliderFill.x(sl.x);

        // ── 8) 数值面板 ──────────────────────────────
        this._numTexts['I'].text(I_uA.toFixed(2));
        this._numTexts['U'].text((I_A * this.R_i * 1000).toFixed(2));
        this._numTexts['alpha'].text(alpha_deg.toFixed(1));
        this._numTexts['Tem'].text(T_em_nNm.toFixed(3));
        this._numTexts['Ts'].text(T_s_nNm.toFixed(3));
        this._numTexts['dT'].text((T_em_nNm - T_s_nNm).toFixed(3));
        this._numTexts['zero'].text(this._zeroAdj.toFixed(1));
    }

    /** 游丝螺旋（内端=线圈角，外端=零点调节角） */
    _updateHairspring(alpha_deg) {
        const { cx, cy, r } = this._spring;
        this._hairspringGroup.destroyChildren();

        const innerAng = (alpha_deg * Math.PI / 180);     // 内端角度（随线圈）
        const outerAng = (this._zeroAdj * Math.PI / 180); // 外端角度（调零）
        const turns    = 3.5;
        const r0 = r * 0.18, r1 = r * 0.95;
        const steps = 100;
        const pts = [];

        for (let i = 0; i <= steps; i++) {
            const t   = i / steps;
            // 从内端到外端：角度从 innerAng 渐变到 outerAng + turns圈
            const ang = innerAng + (outerAng - innerAng + turns * 2 * Math.PI) * t;
            const rad = r0 + (r1 - r0) * t;
            pts.push(rad * Math.cos(ang), rad * Math.sin(ang));
        }

        // 颜色随扭转程度变化（扭紧=偏蓝，扭松=暗）
        const twist = Math.abs(alpha_deg) / 60;
        const col   = `rgba(${Math.round(80 + twist * 80)},${Math.round(100 + twist * 60)},${Math.round(200 + twist * 55)},0.85)`;

        this._hairspringGroup.add(new Konva.Line({
            points: pts, stroke: col,
            strokeWidth: 0.9 + twist * 0.5,
            lineCap: 'round', lineJoin: 'round', listening: false,
        }));

        // 外端固定点标注（小圆点）
        const outerEndAng = outerAng + turns * 2 * Math.PI;
        this._hairspringGroup.add(new Konva.Circle({
            x: r1 * Math.cos(outerEndAng), y: r1 * Math.sin(outerEndAng),
            radius: 2.5, fill: '#d0a030',
        }));
        // 内端
        this._hairspringGroup.add(new Konva.Circle({
            x: r0 * Math.cos(innerAng), y: r0 * Math.sin(innerAng),
            radius: 2, fill: '#60b0d0',
        }));
    }

    /** 安培力箭头（线圈两侧，F=BIL） */
    _updateAmpereForces(frac, coilAngle_deg) {
        this._ampereGroup.destroyChildren();
        if (frac < 0.01) return;

        const { cx, cy }   = this._mag;
        const { w: cW, h: cH } = this._coil;
        const ang  = coilAngle_deg * Math.PI / 180;
        const cosA = Math.cos(ang), sinA = Math.sin(ang);

        // 线圈两侧导体中点（局部坐标 → 全局）
        const halfW = cW / 2;
        // 左侧导体
        const lx = cx + (-halfW) * cosA - 0 * sinA;
        const ly = cy + (-halfW) * sinA + 0 * cosA;
        // 右侧导体
        const rx = cx + ( halfW) * cosA - 0 * sinA;
        const ry = cy + ( halfW) * sinA + 0 * cosA;

        const arrowLen = cH * 0.42 * frac + cH * 0.15;
        const alpha    = 0.5 + frac * 0.5;

        // 安培力方向：F = I·L × B
        // B 向右（+x），电流在左导体向上（+y），则 F = I·(+ŷ) × B·(+x̂) = I·B·(-ẑ... 2D取法向）
        // 二维简化：左侧导体受力向上（+y方向），右侧受力向下（-y方向）→产生顺时针力矩（I>0时）
        // 绕轴旋转：左侧向上力 + 右侧向下力 → 合力矩顺时针 → 指针向右偏

        // 左侧：安培力向"上"（垂直于磁场和电流，此处简化为绕轴切向）
        const fDx = -sinA * arrowLen;  // 切向单位向量 × arrowLen
        const fDy =  cosA * arrowLen;
        this._ampereGroup.add(new Konva.Arrow({
            points: [lx, ly, lx + fDx, ly + fDy],
            fill:   `rgba(255,80,30,${alpha})`,
            stroke: `rgba(255,80,30,${alpha})`,
            strokeWidth: 2.5, pointerLength: 7, pointerWidth: 6,
        }));
        // "F" 标注
        this._ampereGroup.add(new Konva.Text({
            x: lx + fDx - 8, y: ly + fDy - 14,
            text: 'F₁',
            fontSize: Math.max(8, this.width * 0.018), fontFamily: 'Arial', fontStyle: 'bold',
            fill: `rgba(255,120,60,${alpha})`,
        }));

        // 右侧：安培力向"下"
        this._ampereGroup.add(new Konva.Arrow({
            points: [rx, ry, rx - fDx, ry - fDy],
            fill:   `rgba(255,80,30,${alpha})`,
            stroke: `rgba(255,80,30,${alpha})`,
            strokeWidth: 2.5, pointerLength: 7, pointerWidth: 6,
        }));
        this._ampereGroup.add(new Konva.Text({
            x: rx - fDx - 2, y: ry - fDy,
            text: 'F₂',
            fontSize: Math.max(8, this.width * 0.018), fontFamily: 'Arial', fontStyle: 'bold',
            fill: `rgba(255,120,60,${alpha})`,
        }));

        // 力矩弧（指示旋转方向）
        const { r: coreR } = this._core;
        const arcR = coreR * 1.6;
        const arcPts = [];
        const startA = ang - Math.PI * 0.20;
        const endA   = ang + Math.PI * 0.20;
        for (let i = 0; i <= 12; i++) {
            const a = startA + (endA - startA) * i / 12;
            arcPts.push(cx + arcR * Math.cos(a), cy + arcR * Math.sin(a));
        }
        this._ampereGroup.add(new Konva.Line({
            points: arcPts,
            stroke: `rgba(255,160,40,${alpha * 0.65})`,
            strokeWidth: 1.8, dash: [4, 2],
            lineCap: 'round', lineJoin: 'round',
        }));
        // 力矩方向箭头
        const arrowA  = endA;
        const tangDx  = -Math.sin(arrowA) * 5;
        const tangDy  =  Math.cos(arrowA) * 5;
        this._ampereGroup.add(new Konva.Line({
            points: [
                cx + arcR * Math.cos(arrowA) - tangDx - tangDy * 0.5,
                cy + arcR * Math.sin(arrowA) - tangDy + tangDx * 0.5,
                cx + arcR * Math.cos(arrowA), cy + arcR * Math.sin(arrowA),
                cx + arcR * Math.cos(arrowA) - tangDx + tangDy * 0.5,
                cy + arcR * Math.sin(arrowA) - tangDy - tangDx * 0.5,
            ],
            stroke: `rgba(255,160,40,${alpha * 0.80})`,
            strokeWidth: 1.8, lineCap: 'round',
        }));

        // 力矩标注
        this._ampereGroup.add(new Konva.Text({
            x: cx + arcR + 3, y: cy - 8,
            text: `T_em`, fontSize: Math.max(8, this.width * 0.016),
            fontFamily: 'Arial', fontStyle: 'bold',
            fill: `rgba(255,160,60,${alpha * 0.90})`,
        }));
    }

    /** 更新力矩条形图（T_em 红，T_s 蓝） */
    _updateTorqueBars(T_em_nNm, T_s_nNm) {
        const { x, y, w, h } = this._torqBox;
        const barMaxW = w * 0.55;
        const barX    = x + (w - barMaxW) / 2;
        const maxTnNm = 7.5;   // 满偏时 T_em ≈ 7.5 nN·m

        const emFrac = Math.min(1, Math.abs(T_em_nNm) / maxTnNm);
        const sFrac  = Math.min(1, Math.abs(T_s_nNm)  / maxTnNm);

        // T_em 条
        this._emBar.x(barX + barMaxW * 0.5 - barMaxW * emFrac * 0.5);
        this._emBar.width(barMaxW * emFrac);

        // T_s 条
        this._sBar.x(barX + barMaxW * 0.5 - barMaxW * sFrac * 0.5);
        this._sBar.width(barMaxW * sFrac);

        this._emBarLabel.text(`T_em=${T_em_nNm.toFixed(2)}`);
        this._sBarLabel.text(`T_s =${T_s_nNm.toFixed(2)}`);
    }

    // ═══════════════════════════════════════════════════
    // tick 主循环
    // ═══════════════════════════════════════════════════

    tick(dt) {
        // 电流一阶跟随（仅限输入端软化）
        const tau   = Math.max(0.02, this._rampTime * 0.30);
        const alpha = 1 - Math.exp(-dt / tau);
        this._currentI_uA += (this._targetI_uA - this._currentI_uA) * alpha;

        this._animTime += dt;

        this._updateDynamic(dt);
        this.markDirty();
        this._refreshIfDirty();
    }

    // ═══════════════════════════════════════════════════
    // 公开 API
    // ═══════════════════════════════════════════════════

    /** 设置输入电流（μA，0~50） */
    setCurrent(uA) {
        this._targetI_uA = Math.max(0, Math.min(50, parseFloat(uA) || 0));
    }

    /** 设置调零偏置（°，-5~+5） */
    setZeroAdj(deg) {
        this._zeroAdj  = Math.max(-5, Math.min(5, parseFloat(deg) || 0));
        this._knobAngle = this._zeroAdj * 12;
    }

    getCurrent() { return this._currentI_uA; }
    getAngle()   { return this._needleAngle - (this._needleCenter + this._zeroAdj); }

    update(state) {
        if (typeof state === 'object' && state !== null) {
            if (state.current !== undefined) this.setCurrent(state.current);
            if (state.zeroAdj !== undefined) this.setZeroAdj(state.zeroAdj);
        } else {
            this.setCurrent(state);
        }
    }

    // ═══════════════════════════════════════════════════
    // 配置界面
    // ═══════════════════════════════════════════════════

    getConfigFields() {
        return [
            { label: '输入电流 μA（0~50）',    key: 'current',  type: 'number' },
            { label: '调零偏置角 °（-5~+5）',  key: 'zeroAdj',  type: 'number' },
            { label: '响应时间常数 s',          key: 'rampTime', type: 'number' },
        ];
    }

    onConfigUpdate(cfg) {
        if (cfg.current  !== undefined) this.setCurrent(cfg.current);
        if (cfg.zeroAdj  !== undefined) this.setZeroAdj(cfg.zeroAdj);
        if (cfg.rampTime !== undefined) this._rampTime = parseFloat(cfg.rampTime) || 0.25;

        this.config = { ...this.config, ...cfg };

        this._recalcGeometry();
        this._staticGroup.destroyChildren();
        this._dynamicGroup.destroyChildren();
        this._interactGroup.destroyChildren();
        this._drawStaticParts();
        this._createDynamicNodes();
        this._bindInteraction();
        this._refreshCache?.();
    }

    destroy() {
        super.destroy?.();
    }
}
