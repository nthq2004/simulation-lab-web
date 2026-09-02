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

        this.width  = Math.max(480, config.width  || 540);
        this.height = Math.max(380, config.height || 380);

        this.type    = 'resistor';
        this.special = 'meterhead';
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

        this.currentResistance = this.R_i;

        // 端口（底部）
        this.addPort(this._portP.x, this._portP.y, 'l', 'wire', 'p');
        this.addPort(this._portN.x, this._portN.y, 'r', 'wire', 'n');
    }

    // ═══════════════════════════════════════════════════
    // 几何
    // ═══════════════════════════════════════════════════

    _recalcGeometry() {
        const W = this.width, H = this.height;
        this._frame = { x: 50, y: 2, w: W - 100, h: H - 4, rx: 10 };

        // ── 刻度盘（顶部）─────────────────────────────
        const dialCx = W * 0.50;
        const dialCy = H * 0.025;        // 圆心在顶部框外（只露弧形刻度盘）
        const dialR  = Math.min(W * 0.50, H * 0.60);
        this._dial   = { cx: dialCx, cy: dialCy + dialR * 0.08, r: dialR };

        // 指针：从圆心向上（Konva 270°，即-90°）为零点，±60°为两端
        // Konva 角度：0°=右，顺时针正
        // 零偏角(右方向): 270°，左满偏: 270-60=210°，右满偏: 270+60=330°
        this._needleCenter = 270;   // 对应电流=0，零点方向
        this._needleHalf   = 60;    // 单侧最大偏角

        // ── 结构剖面区（中部）─────────────────────────
        const structTop  = dialCy + dialR * 0.38;  // 刻度盘底边下方
        const structH    = H * 0.45;
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
        this._spring = { cx: magCx, cy: magCy - gapH * 1.22, r: coreR * 1.8 };


        // ── 控制区（底部）────────────────────────────
        const ctrlY = structTop + structH -20;
        const ctrlH = H - ctrlY-10;
        this._ctrl  = { y: ctrlY, h: ctrlH };

        // 调零旋钮（左）
        this._knob  = { cx: W * 0.5, cy: ctrlY + ctrlH * 0.40, r: Math.min(ctrlH * 0.26, W * 0.04) };

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

        this._knobDragging   = false;
        this._knobAngle      = 0;   // 旋钮当前角度（度）

        // 力矩数值（实时计算）
        this._T_em = 0;
        this._T_s  = 0;
    }

    /** 计算指针目标 Konva 角度（线性刻度，零点=needleCenter） */
    _calcNeedleAngle(I_uA) {
        const frac   = Math.max(0, Math.min(1, I_uA / 50));
        const startDeg = this._needleCenter - this._needleHalf;
        return startDeg + frac * 2 * this._needleHalf + this._zeroAdj;
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
        this._drawDashedLines();
        this._drawControlAreaStatic();
    }

    _drawDashedLines() {
        const W = this.width, H = this.height;
        const { cx: dcx, cy: dcy } = this._dial;
        const { cx: mcx, cy: mcy } = this._mag;
        const { w: cW } = this._coil;
        const kx = this._knob.cx, ky = this._knob.cy;

        // 端口 P → 线圈左侧（电流输入路径）
        this._staticGroup.add(new Konva.Line({
            points: [this._portP.x, H - 2, this._portP.x, mcy, mcx - cW / 2 - 6, mcy],
            stroke: '#d03018', strokeWidth: 1.5, dash: [5, 4], lineCap: 'round',
            listening: false,
        }));

        // 端口 N → 线圈右侧（电流返回路径）
        this._staticGroup.add(new Konva.Line({
            points: [this._portN.x, H - 2, this._portN.x, mcy, mcx + cW / 2 + 6, mcy],
            stroke: '#3060d0', strokeWidth: 1.5, dash: [5, 4], lineCap: 'round',
            listening: false,
        }));
        // 调零旋钮中心 → 指针轴心（同轴指示）
        this._staticGroup.add(new Konva.Line({
            points: [dcx, dcy, kx, ky],
            stroke: '#808878', strokeWidth: 3.2, dash: [3, 4], lineCap: 'round',
            listening: false,
        }));
    }

    _drawBackground() {
        const f = this._frame;
        // 主背景（深蓝灰）
        this._staticGroup.add(new Konva.Rect({
            x: f.x, y: f.y, width: f.w, height: f.h,
            fill: '#f0ece4',
            stroke: '#c0bcb0', strokeWidth: 2,
            cornerRadius: f.rx,
        }));
        // 标题
        this._staticGroup.add(new Konva.Text({
            x: f.x + 8, y: f.y + 5,
            text: '万用表表头工作原理演示',
            fontSize: Math.max(16, this.width * 0.017),
            fontFamily: 'Arial', fontStyle: 'bold',
            fill: '#2a5a78',
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
            points: arcPts,             stroke: color, strokeWidth: 1.2,
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
            fillLinearGradientColorStops: [0, '#1028a0', 0.5, '#2040c8', 1, '#081880'],
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

    }



    /** 控制区静态底层 */
    _drawControlAreaStatic() {
        const { y, h } = this._ctrl;
        const W = this.width;

        // 调零旋钮区标注
        const kx = this._knob.cx, ky = this._knob.cy;
        const kr = this._knob.r;
        this._staticGroup.add(new Konva.Text({
            x: kx - kr * 2, y: ky + kr + 8,
            text: '调零旋钮', fontSize: Math.max(12, kr * 0.38),
            fontFamily: 'Arial',             fill: '#506070',
            width: kr * 4, align: 'center',
        }));

        // 旋钮外圈
        this._staticGroup.add(new Konva.Circle({
            x: kx, y: ky, radius: kr + 4,
            fill: '#d0ccc4', stroke: '#909088', strokeWidth: 1.5,
        }));
    }

    // ═══════════════════════════════════════════════════
    // 动态节点
    // ═══════════════════════════════════════════════════

    _createDynamicNodes() {
        this._createNeedle();
        this._createCoil();
        this._createHairspring();
        this._createKnobDynamic();
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
            stroke: '#303030', strokeWidth: 1.8, lineCap: 'round',
        }));
        // 针尖
        this._needleGroup.add(new Konva.Line({
            points: [needleLen * 0.72, -1.5, needleLen * 0.94, 0, needleLen * 0.72, 1.5],
            closed: true, fill: '#303030', stroke: '#303030', strokeWidth: 0.5,
        }));
        // 配重
        this._needleGroup.add(new Konva.Rect({
            x: -tailLen - 4, y: -2, width: 6, height: 4,
            fill: '#282828', cornerRadius: 1,
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
            text: '动圈（N匝）', fontSize: Math.max(12, this.width * 0.014),
            fontFamily: 'Arial', fill: '#b08030',
            width: cW, align: 'center',
        }));

        this._dynamicGroup.add(this._coilGroup);

        this._dampGroup = new Konva.Group({ x: cx, y: cy });
        this._dynamicGroup.add(this._dampGroup);
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
            x: cx - r * 2.5, y: cy - r - 4,
            text: '游丝（弹性反力矩）',
            fontSize: Math.max(12, this.width * 0.016), fontFamily: 'Arial',
            fill: '#4050a0', width: r * 5, align: 'center',
        }));
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
            fillRadialGradientColorStops:  [0, '#b0b8c0', 0.6, '#d0d4d8', 1, '#e0e4e8'],
            stroke: '#d0ccc4', strokeWidth: 1.5,
        }));

        // 指示线（随旋转变化）
        this._knobGroup.add(new Konva.Line({
            points: [0, -r * 0.25, 0, -r * 0.82],
            stroke: '#cc2222', strokeWidth: 3.5, lineCap: 'round',
        }));

        // 中心点
        this._knobGroup.add(new Konva.Circle({
            x: 0, y: 0, radius: r * 0.18,
            fill: '#c8c8c0', stroke: '#a0a098', strokeWidth: 1,
        }));

        // 十字槽
        this._knobGroup.add(new Konva.Line({
            points: [-r * 0.12, 0, r * 0.12, 0],
            stroke: '#909088', strokeWidth: 1.2, lineCap: 'round',
        }));
        this._knobGroup.add(new Konva.Line({
            points: [0, -r * 0.12, 0, r * 0.12],
            stroke: '#909088', strokeWidth: 1.2, lineCap: 'round',
        }));

        this._dynamicGroup.add(this._knobGroup);
    }



    // ═══════════════════════════════════════════════════
    // 交互绑定
    // ═══════════════════════════════════════════════════

    _bindInteraction() {
        const { cx: kx, cy: ky, r: kr } = this._knob;

        const onMove = (e) => { this._updateKnobFromEvent(e); };
        const onUp   = () => {
            this._knobDragging = false;
            document.body.style.cursor = 'default';
            const stage = this._interactGroup.getStage();
            if (stage) {
                stage.off('mousemove touchmove', onMove);
                stage.off('mouseup touchend',    onUp);
            }
        };

        // ── 旋钮拖动 ─────────────────────────────────
        const knobHit = new Konva.Circle({
            x: kx, y: ky, radius: kr + 6, fill: 'transparent',
        });
        knobHit.on('mousedown touchstart', (e) => {
            e.cancelBubble = true;
            this._knobDragging = true;
            this._knobDragStartY = e.evt.clientY || e.evt.touches?.[0]?.clientY || ky;
            this._knobDragStartAdj = this._zeroAdj;
            const stage = this._interactGroup.getStage();
            if (stage) {
                stage.on('mousemove touchmove', onMove);
                stage.on('mouseup touchend',    onUp);
            }
        });
        knobHit.on('mouseenter', () => { document.body.style.cursor = 'pointer'; });
        knobHit.on('mouseleave', () => { if (!this._knobDragging) document.body.style.cursor = 'default'; });

        this._interactGroup.add(knobHit);
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

        const targetAngle = this._calcNeedleAngle(I_uA);

        const tau = this._rampTime * 0.5;
        const alpha = 1 - Math.exp(-dt / tau);
        this._needleAngle += (targetAngle - this._needleAngle) * alpha;

        const minAng = this._needleCenter - this._needleHalf - 2 + this._zeroAdj;
        const maxAng = this._needleCenter + this._needleHalf + 2 + this._zeroAdj;
        this._needleAngle = Math.max(minAng, Math.min(maxAng, this._needleAngle));

        const alpha_deg = this._needleAngle - (this._needleCenter + this._zeroAdj);

        // ── 1) 主指针 ────────────────────────────────
        this._needleGroup.rotation(this._needleAngle);

        // ── 2) 动圈 ──────────────────────────────────
        const coilAngle = alpha_deg;
        this._coilGroup.rotation(coilAngle);
        this._dampGroup.rotation(coilAngle);

        // ── 3) 游丝 ──────────────────────────────────
        this._updateHairspring(alpha_deg);

        // ── 4) 调零旋钮 ──────────────────────────────
        this._knobGroup.rotation(this._knobAngle);
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
            strokeWidth: 1.8 + twist * 1.0,
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





    // ═══════════════════════════════════════════════════
    // tick 主循环
    // ═══════════════════════════════════════════════════

    tick(dt) {
        const solver = this.sys?.voltageSolver;
        if (solver) {
            const vL = solver.getVoltageAtPort(`${this.id}_wire_l`);
            const vR = solver.getVoltageAtPort(`${this.id}_wire_r`);
            if (vL !== undefined && vR !== undefined) {
                this._targetI_uA = Math.max(0, Math.min(50, ((vL - vR) / this.R_i) * 1e6));
            }
        }
        // 电流一阶跟随（软化）
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
