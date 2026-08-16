import { BaseComponent } from './BaseComponent.js';

/**
 * 交流电流表（电磁系交流电流表 / AC Ammeter）仿真组件
 *
 * ═══ 工作原理 ════════════════════════════════════════════════════════
 *  交流电流表采用"电磁系排斥型"测量机构，无需永磁体，
 *  可直接测量交流电流（响应电流有效值 I_rms）。
 *
 *  ── 排斥型电磁系原理 ──────────────────────────────────────────────
 *    1. 被测交流电流 I 流入固定线圈（扁平椭圆形，少匝粗线）
 *    2. 线圈产生交变磁场 H ∝ I
 *    3. 磁场使固定铁片（Fixed Vane）和活动铁片（Moving Vane）
 *       同时被磁化，且极性始终相同（同相磁化）
 *    4. 同极相斥 → 活动铁片绕轴偏转，驱动指针偏转
 *    5. 偏转力矩 T_d ∝ I² （与电流方向无关，故可测交流）
 *    6. 游丝产生反力矩 T_s = k·α
 *    7. 平衡时：α = k'·I²（平方律，刻度前密后疏）
 *    8. 空气阻尼翼片消除振荡
 *
 *  ── 量程扩展 ──────────────────────────────────────────────────────
 *    小量程（≤5A）：线圈直接串联于被测回路
 *    大量程（>5A）：配合电流互感器（CT），二次侧额定 5A
 *    量程切换：改变线圈串/并联匝数，或选用不同 CT 变比
 *
 *  ── 平方律刻度特点 ────────────────────────────────────────────────
 *    α ∝ I²  →  低端（小电流）刻度密集，高端（大电流）刻度疏朗
 *    有效量程通常为满量程的 20%~100%（低端 <20% 精度差）
 *    与磁电系电流表对比：磁电系只能测直流，电磁系交直流均可
 *
 * ═══ 渲染结构 ═════════════════════════════════════════════════════════
 *  左侧：仪表外观界面
 *    ① 矩形铝合金面板（深灰色，仿工业面板仪表）
 *    ② 圆弧形刻度盘（嵌入面板，白色）
 *       - 平方律非线性刻度（低端密，高端疏）
 *       - 主刻度：0, 1, 2, 3, 4, 5（默认5A量程）
 *       - 有效区域绿弧（20%~100%），低精度区红弧（<20%）
 *    ③ 红色指针 + 游丝（螺旋，随指针偏转）
 *    ④ 铭牌区：型号 T42-A、量程、频率范围、精度等级
 *    ⑤ 电磁系符号（IEC：实心矩形）
 *    ⑥ 水准泡、调零螺钉
 *    ⑦ 装饰端口标注（提示在右侧）
 *
 *  右侧：结构与原理
 *    ① 固定线圈（扁平椭圆形，粗导线，少匝）
 *       - 侧视截面：两个矩形线圈块（上下，或左右），
 *         中间留气隙供铁片活动
 *       - ⊙/⊗ 电流方向符号（随交流相位动态翻转）
 *    ② 固定铁片（Fixed Vane）
 *       - 嵌于线圈内壁，椭圆形薄片，固定不动
 *       - 显示 N/S 极性标注（随磁场相位变化）
 *    ③ 活动铁片（Moving Vane）
 *       - 偏心安装于转轴，形状为弧形薄片
 *       - 随电流增大而偏转（排斥力推开）
 *       - 偏转角度 ∝ I²
 *    ④ 转轴（垂直，穿过线圈中央）
 *       - 上下轴尖支撑
 *       - 游丝（螺旋弹簧，右侧绕轴）
 *    ⑤ 阻尼翼片（铝制扇形，在封闭气室中运动）
 *    ⑥ 磁力线动画（线圈激励时，从固定铁片穿向活动铁片，随 I² 变化）
 *    ⑦ 排斥力箭头（固定铁片 → 活动铁片，动态显示）
 *    ⑧ 力矩分析标注（T_d ∝ I²，T_s = kα）
 *    ⑨ 等效电路（右下角：线圈 + 并联 CT 接法）
 *    ⑩ 接线端 A+（I进）/ A-（I出）（底部黄铜螺柱）
 *
 * ═══ 端口（右侧底部）════════════════════════════════════════════════
 *  ap  — A+（电流进端）
 *  an  — A-（电流出端）
 *
 * ═══ 可配置参数 ══════════════════════════════════════════════════════
 *  current   : 被测电流有效值 A（默认 0）
 *  maxCurrent: 满量程电流 A（默认 5）
 *  frequency : 频率 Hz（默认 50）
 *  rampTime  : 指针响应时间常数 s（默认 0.35）
 *  accuracy  : 精度等级字符串（默认 '2.5'）
 *  ctRatio   : 配用 CT 变比（默认 1，即直接接入；如 '100/5' 表示 100A/5A CT）
 */
export class ACAmmeter extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.width  = Math.max(340, config.width  || 460);
        this.height = Math.max(200, config.height || 260);

        this.type    = 'ac_amp';
        this.special = 'AC_AMMETER';
        this.cache   = 'fixed';

        this._initGroups();
        this._recalcGeometry();
        this._initParameters(config);
        this._init();

        this.config = {
            current:    this._targetI,
            maxCurrent: this.maxCurrent,
            frequency:  this._frequency,
            rampTime:   this._rampTime,
            accuracy:   this._accuracy,
            ctRatio:    this._ctRatio,
        };

        // ── 端口（右侧底部）──────────────────────────
        this.addPort(this._portAp.x, this._portAp.y, 'ap', 'wire', 'p');
        this.addPort(this._portAn.x, this._portAn.y, 'an', 'wire', 'n');
    }

    // ═══════════════════════════════════════════════════
    // 几何尺寸计算
    // ═══════════════════════════════════════════════════

    _recalcGeometry() {
        const W = this.width, H = this.height;
        this._divX  = W * 0.50;
        this._frame = { x: 2, y: 2, w: W - 4, h: H - 4, rx: 6 };

        const lW  = this._divX;
        const fCx = lW * 0.50;
        const fCy = H  * 0.50;
        const fR  = Math.min(lW * 0.46, H * 0.45);
        this._face = { cx: fCx, cy: fCy, r: fR };

        this._angleStart = 165;
        this._angleSweep = 210;

        const rLeft = this._divX;
        const rW    = W - rLeft;
        const coilCx = rLeft + rW * 0.50;
        const coilCy = H * 0.42;
        const coilW  = rW * 0.92;
        const coilH  = H  * 0.84;
        this._coil   = { cx: coilCx, cy: coilCy, w: coilW, h: coilH };

        const cavW = coilW * 0.58, cavH = coilH * 0.76;
        this._cavity = {
            cx: coilCx, cy: coilCy,
            w: cavW, h: cavH,
            x: coilCx - cavW / 2,
            y: coilCy - cavH / 2,
        };

        const fvW = cavW * 0.22, fvH = cavH * 0.50;
        this._fixedVane = {
            x: this._cavity.x + cavW * 0.05,
            y: coilCy - fvH / 2,
            w: fvW, h: fvH,
        };

        this._pivotX = coilCx + cavW * 0.10;
        this._pivotY = coilCy;

        const tY  = H - 5;
        const tCx = coilCx;
        const tSp = rW * 0.18;
        this._termAp = { x: tCx - tSp * 0.5, y: tY - H * 0.1 };
        this._termAn = { x: tCx + tSp * 0.5, y: tY - H * 0.1 };

        this._portAp = { x: this._termAp.x, y: H - 2 };
        this._portAn = { x: this._termAn.x, y: H - 2 };
    }

    // ═══════════════════════════════════════════════════
    // 参数初始化
    // ═══════════════════════════════════════════════════

    _initParameters(config) {
        this.maxCurrent = config.maxCurrent !== undefined ? parseFloat(config.maxCurrent) : 5;
        this._frequency = config.frequency  !== undefined ? parseFloat(config.frequency)  : 50;
        this._rampTime  = config.rampTime   !== undefined ? parseFloat(config.rampTime)   : 0.35;
        this._accuracy  = config.accuracy   || '2.5';
        this._ctRatio   = config.ctRatio    || '1';

        this._targetI   = config.current !== undefined ? parseFloat(config.current) : 0;
        this._currentI  = this._targetI;
        this._rmsBuffer = [];

        this._needleAngle = this._currentToAngle(this._currentI);

        // 活动铁片偏转角（度，0=静止）
        this._mvAngle = 0;

        this._acPhase  = 0;
    }

    /** 平方律：电流 → 指针 Konva 角度 */
    _currentToAngle(i) {
        const frac = Math.max(0, Math.min(1, i / this.maxCurrent));
        return this._angleStart + frac * frac * this._angleSweep;
    }

    /** 平方律：电流值 → 刻度 frac（用于绘制刻度线） */
    _currentToFrac(i) {
        const f = i / this.maxCurrent;
        return f * f;
    }

    // ═══════════════════════════════════════════════════
    // 主初始化
    // ═══════════════════════════════════════════════════

    _init() {
        this._drawStaticParts();
        this._createDynamicNodes();
    }

    // ═══════════════════════════════════════════════════
    // 静态部件
    // ═══════════════════════════════════════════════════

    _drawStaticParts() {
        this._drawFrame();
        this._drawFaceStatic();
        this._drawPrincipleStatic();
    }

    _drawFrame() {
        const f = this._frame;
        this._staticGroup.add(new Konva.Rect({
            x: f.x, y: f.y, width: f.w, height: f.h,
            fill: '#e8eaec',
            stroke: '#b0b4b8', strokeWidth: 1.5,
            cornerRadius: f.rx,
        }));
    }

    // ─── 左侧仪表外观 ─────────────────────────────────

    _drawFaceStatic() {
        const { cx, cy, r } = this._face;
        const f = this._frame;
        const lW = this._divX;

        this._staticGroup.add(new Konva.Rect({
            x: f.x + 2, y: f.y + 2,
            width: lW - f.x - 3, height: f.h - 4,
            fill: '#e8e6e0',
            cornerRadius: [f.rx - 1, 0, 0, f.rx - 1],
        }));

        this._staticGroup.add(new Konva.Circle({
            x: cx, y: cy, radius: r + 8,
            fill: '#c8ccd0',
            stroke: '#a0a4a8', strokeWidth: 1.5,
        }));
        this._staticGroup.add(new Konva.Circle({
            x: cx, y: cy, radius: r + 5,
            fill: '#e8ece8',
            stroke: '#c0c4c0', strokeWidth: 1,
        }));

        this._staticGroup.add(new Konva.Circle({
            x: cx, y: cy, radius: r,
            fill: '#faf8f0',
            stroke: '#d0ccc0', strokeWidth: 1,
        }));

        this._staticGroup.add(new Konva.Circle({
            x: cx, y: cy, radius: r,
            fillRadialGradientStartPoint:  { x: 0, y: 0 },
            fillRadialGradientEndPoint:    { x: 0, y: 0 },
            fillRadialGradientStartRadius: r * 0.50,
            fillRadialGradientEndRadius:   r,
            fillRadialGradientColorStops:  [0, 'rgba(0,0,0,0)', 1, 'rgba(0,0,0,0.06)'],
            listening: false,
        }));

        this._drawAmmeterScale();

        const outerR = r * 0.94;
        const ang20 = this._angleStart + this._currentToFrac(this.maxCurrent * 0.20) * this._angleSweep;
        this._drawScaleArc(cx, cy, outerR, this._angleStart, ang20, 'rgba(200,40,10,0.30)', 5);
        this._drawScaleArc(cx, cy, outerR, ang20,
            this._angleStart + this._angleSweep, 'rgba(30,150,60,0.18)', 5);

        const pW = r * 1.30, pH = r * 0.32;
        const pX = cx - pW / 2, pY = cy - r * 0.62;
        const pFs = Math.max(7, r * 0.138);
        this._staticGroup.add(new Konva.Text({
            x: pX + 2, y: pY + pH - pFs + 10,
            text: `0 ~ ${this.maxCurrent} A` +
                  (this._ctRatio !== '1' ? `  CT ${this._ctRatio}` : ''),
            fontSize: pFs, fontFamily: 'Arial', fontStyle: 'bold', fill: '#483828',
            width: pW - 4, align: 'center',
        }));

        const uFs = Math.max(10, r * 0.185);
        this._staticGroup.add(new Konva.Text({
            x: cx - r * 0.55, y: cy + r * 0.06,
            text: 'A',
            fontSize: uFs, fontFamily: 'Arial', fontStyle: 'bold',
            fill: '#c81808', width: r * 1.10, align: 'center',
        }));

        this._staticGroup.add(new Konva.Text({
            x: cx - r * 0.55, y: cy + r * 0.20,
            text: '~',
            fontSize: Math.max(10, r * 0.200), fontFamily: 'Arial', fontStyle: 'bold',
            fill: '#585048', width: r * 1.10, align: 'center',
        }));

        const symY = cy + r * 0.48;
        const symW = r * 0.99, symH = r * 0.28;
        this._staticGroup.add(new Konva.Rect({
            x: cx - symW / 2, y: symY,
            width: symW, height: symH,
            fill: '#404038', cornerRadius: 2,
        }));

        this._staticGroup.add(new Konva.Circle({
            x: cx, y: cy + r * 0.97,
            radius: r * 0.042, fill: '#c0b870', stroke: '#908840', strokeWidth: 1,
        }));
        this._staticGroup.add(new Konva.Line({
            points: [cx - r * 0.028, cy + r * 0.97, cx + r * 0.028, cy + r * 0.97],
            stroke: '#484030', strokeWidth: 1, lineCap: 'round',
        }));

        this._staticGroup.add(new Konva.Circle({
            x: cx, y: cy, radius: r * 0.053,
            fill: '#c0b878', stroke: '#908848', strokeWidth: 1,
        }));
    }

    /** 平方律非线性刻度线 + 数字 */
    _drawAmmeterScale() {
        const { cx, cy, r } = this._face;
        const outerR = r * 0.94;

        this._drawScaleArc(cx, cy, outerR,
            this._angleStart, this._angleStart + this._angleSweep,
            '#585048', 1.2);

        const majorVals = [];
        const step = this.maxCurrent / 5;
        for (let i = 0; i <= 5; i++) majorVals.push(i * step);

        const minorCount = 50;
        for (let i = 0; i <= minorCount; i++) {
            const iVal   = (i / minorCount) * this.maxCurrent;
            const frac   = this._currentToFrac(iVal);
            const angDeg = this._angleStart + frac * this._angleSweep;
            const angRad = angDeg * Math.PI / 180;
            const isMajor  = (i % 10 === 0);
            const isMedium = (i % 5  === 0);
            const inR = isMajor ? r * 0.74 : (isMedium ? r * 0.82 : r * 0.88);
            const sw  = isMajor ? 1.6 : 0.8;
            const col = isMajor ? '#282018' : '#706858';

            this._staticGroup.add(new Konva.Line({
                points: [
                    cx + outerR * Math.cos(angRad), cy + outerR * Math.sin(angRad),
                    cx + inR    * Math.cos(angRad), cy + inR    * Math.sin(angRad),
                ],
                stroke: col, strokeWidth: sw, lineCap: 'round', listening: false,
            }));
        }

        const labelR = r * 0.60;
        const fs     = Math.max(7, r * 0.145);
        majorVals.forEach(v => {
            const frac   = this._currentToFrac(v);
            const angDeg = this._angleStart + frac * this._angleSweep;
            const angRad = angDeg * Math.PI / 180;
            this._staticGroup.add(new Konva.Text({
                x: cx + labelR * Math.cos(angRad) - fs * 1.1,
                y: cy + labelR * Math.sin(angRad) - fs * 0.6,
                text: v === 0 ? '0' : (Number.isInteger(v) ? String(v) : v.toFixed(1)),
                fontSize: fs, fontFamily: 'Arial', fill: '#282018',
                align: 'center', width: fs * 2.2,
            }));
        });
    }

    _drawScaleArc(cx, cy, radius, startDeg, endDeg, stroke, sw) {
        const steps = Math.max(20, Math.abs(endDeg - startDeg) / 2);
        const pts = [];
        for (let i = 0; i <= steps; i++) {
            const a = (startDeg + (endDeg - startDeg) * (i / steps)) * Math.PI / 180;
            pts.push(cx + radius * Math.cos(a), cy + radius * Math.sin(a));
        }
        this._staticGroup.add(new Konva.Line({
            points: pts, stroke, strokeWidth: sw,
            lineCap: 'round', lineJoin: 'round', listening: false,
        }));
    }

    // ─── 右侧：结构与原理（静态）────────────────────────

    _drawPrincipleStatic() {
        const W = this.width, H = this.height;
        const f = this._frame;

        this._staticGroup.add(new Konva.Rect({
            x: this._divX + 1, y: f.y + 2,
            width: W - this._divX - f.x - 2, height: f.h - 4,
            fill: '#f0f2f4',
            cornerRadius: [0, f.rx - 1, f.rx - 1, 0],
        }));

        this._drawCoilBody();
        this._drawFixedVane();
        this._drawShaftAndSpring();
        this._drawRightTerminals();
    }

    /** 固定线圈体（椭圆截面外框 + 线圈绕线条纹） */
    _drawCoilBody() {
        const { cx, cy, w, h } = this._coil;
        const { x: cvX, y: cvY, w: cvW, h: cvH } = this._cavity;

        this._staticGroup.add(new Konva.Ellipse({
            x: cx, y: cy,
            radiusX: w / 2, radiusY: h / 2,
            fillLinearGradientStartPoint: { x: -w / 2, y: 0 },
            fillLinearGradientEndPoint:   { x:  w / 2, y: 0 },
            fillLinearGradientColorStops: [
                0,    '#c0c8d8',
                0.15, '#d8e0ee',
                0.50, '#e0e6f0',
                0.85, '#d8e0ee',
                1,    '#c0c8d8',
            ],
            stroke: '#8898b0', strokeWidth: 1.5,
        }));

        this._staticGroup.add(new Konva.Rect({
            x: cvX-15, y: cvY+10, width: cvW+30, height: cvH-20,
            fill: '#e8ecf0', stroke: '#b0bcc8', strokeWidth: 1,
            cornerRadius: 3,
        }));

        this._staticGroup.add(new Konva.Line({
            points: [cx - cvW * 0.18, cy + h / 2, cx - cvW * 0.18, cy + h / 2 + 14],
            stroke: '#c07030', strokeWidth: 2.5, lineCap: 'round',
        }));
        this._staticGroup.add(new Konva.Line({
            points: [cx + cvW * 0.18, cy + h / 2, cx + cvW * 0.18, cy + h / 2 + 14],
            stroke: '#c07030', strokeWidth: 2.5, lineCap: 'round',
        }));

        [cx - w * 0.43, cx + w * 0.43].forEach(sx => {
            this._staticGroup.add(new Konva.Circle({
                x: sx, y: cy, radius: w * 0.05,
                fill: '#d8dce4', stroke: '#8898b0', strokeWidth: 1,
            }));
        });
    }

    /** 固定铁片（静态，嵌于线圈内腔左侧） */
    _drawFixedVane() {
        const { x, y, w, h } = this._fixedVane;

        this._staticGroup.add(new Konva.Rect({
            x: x - 18, y: y, width: w -5, height: h,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint:   { x: w, y: 0 },
            fillLinearGradientColorStops: [0, '#b0b8c8', 0.5, '#d0d8e4', 1, '#b0b8c8'],
            stroke: '#8894a8', strokeWidth: 1, cornerRadius: 2,
        }));
    }

    /** 转轴、游丝（弹簧）、阻尼翼片静态结构 */
    _drawShaftAndSpring() {
    }



    _drawRightTerminals() {
        const tR = Math.max(5, this.width * 0.017);
        const termDefs = [
            { pos: this._termAp, label: 'A+', color: '#c83020' },
            { pos: this._termAn, label: 'A−', color: '#3068c0' },
        ];
        termDefs.forEach(td => {
            this._staticGroup.add(new Konva.Circle({
                x: td.pos.x, y: td.pos.y, radius: tR,
                fillLinearGradientStartPoint: { x: -tR, y: -tR },
                fillLinearGradientEndPoint:   { x:  tR, y:  tR },
                fillLinearGradientColorStops: [0, '#d8c870', 0.5, '#f0e090', 1, '#b8a858'],
                stroke: '#908030', strokeWidth: 1,
            }));
            this._staticGroup.add(new Konva.Circle({
                x: td.pos.x, y: td.pos.y, radius: tR * 0.40, fill: '#383028',
            }));
            this._staticGroup.add(new Konva.Line({
                points: [td.pos.x, td.pos.y + tR, td.pos.x, this.height - 2],
                stroke: td.color, strokeWidth: 2,
            }));
        });
    }

    // ═══════════════════════════════════════════════════
    // 动态节点
    // ═══════════════════════════════════════════════════

    _createDynamicNodes() {
        this._createNeedle();
        this._createHairspring();
        this._createMovingVane();
        this._createRightPolarity();
        this._createCCSymbols();
        this._createForceArrow();
        this._createCurrentDisplay();
    }

    /** 指针（左侧表盘） */
    _createNeedle() {
        const { cx, cy, r } = this._face;
        const len  = r * 0.86;
        const tail = r * 0.13;

        this._needleGroup = new Konva.Group({ x: cx, y: cy, rotation: this._needleAngle });
        this._needleGroup.add(new Konva.Line({
            points: [-tail, 0, len * 0.90, 0],
            stroke: '#d01808', strokeWidth: 2.3, lineCap: 'round',
        }));
        this._needleGroup.add(new Konva.Line({
            points: [len * 0.68, -2.0, len * 0.90, 0, len * 0.68, 2.0],
            closed: true, fill: '#d01808', stroke: '#d01808', strokeWidth: 0.5,
        }));
        this._needleGroup.add(new Konva.Rect({
            x: -tail - 5, y: -2.2, width: 7, height: 4.4,
            fill: '#a81006', cornerRadius: 1,
        }));
        this._dynamicGroup.add(this._needleGroup);

        // 金色轴帽
        this._dynamicGroup.add(new Konva.Circle({
            x: cx, y: cy, radius: r * 0.055,
            fillLinearGradientStartPoint: { x: -3, y: -3 },
            fillLinearGradientEndPoint:   { x:  3, y:  3 },
            fillLinearGradientColorStops: [0, '#f0e060', 0.5, '#c8a830', 1, '#908020'],
            stroke: '#706018', strokeWidth: 1, listening: false,
        }));
    }

    /** 游丝（在右边轴的正上方，随指针偏转） */
    _createHairspring() {
        const px = this._pivotX-15, py = this._pivotY+50;
        const { h: coH } = this._coil;
        this._hairspringGrp = new Konva.Group({ x: px, y: py - coH * 0.52, rotation: this._needleAngle });
        const turns = 4.5, steps = 120;
        const r0 = 6, r1 = 18;
        const pts = [];
        for (let i = 0; i <= steps; i++) {
            const t   = i / steps;
            const ang = t * turns * 2 * Math.PI - Math.PI / 2;
            const rad = r0 + (r1 - r0) * t;
            pts.push(rad * Math.cos(ang), rad * Math.sin(ang));
        }
        this._hairspringGrp.add(new Konva.Line({
            points: pts, stroke: '#9080c0', strokeWidth: 1.2,
            lineCap: 'round', lineJoin: 'round', listening: false,
        }));
        this._dynamicGroup.add(this._hairspringGrp);
    }

    _createMovingVane() {
        const { h: cvH, w: cvW } = this._cavity;
        const px = this._pivotX, py = this._pivotY;

        this._mvGroup = new Konva.Group({ x: px, y: py, rotation: -30 });

        const mvLen = cvH * 0.44, mvW = cvW * 0.18;
        const mvX = mvW * 0.30, mvY = -mvLen * 0.55;

        // 三角连接线（从轴心到动铁片左端两角）
        this._mvGroup.add(new Konva.Line({
            points: [-15, 0, mvX, mvY],
            stroke: '#8898a8', strokeWidth: 1.2, lineCap: 'round', listening: false,
        }));
        this._mvGroup.add(new Konva.Line({
            points: [-15, 0, mvX, mvY + mvLen],
            stroke: '#8898a8', strokeWidth: 1.2, lineCap: 'round', listening: false,
        }));

        // 扳弯的动铁片（矩形两边弯曲，像被掰弯的金属片）
        const bend = mvW * 0.45;
        this._mvGroup.add(new Konva.Path({
            data: `M ${mvX} ${mvY}
                   L ${mvX} ${mvY + mvLen}
                   Q ${mvX - bend} ${mvY + mvLen} ${mvX + mvW} ${mvY + mvLen}
                   L ${mvX + mvW} ${mvY}
                   Q ${mvX - bend} ${mvY} ${mvX} ${mvY} Z`,
            fill: '#b8c0cc',
            stroke: '#8090a0', strokeWidth: 1,
        }));

        // N / S 极性文字
        const polFS = Math.max(7, mvW * 0.60);
        this._mvPolTop = new Konva.Text({
            x: mvX, y: mvY + 2,
            text: 'N', fontSize: polFS, fontFamily: 'Arial', fontStyle: 'bold',
            fill: '#d09030', width: mvW, align: 'center',
        });
        this._mvGroup.add(this._mvPolTop);

        this._mvPolBot = new Konva.Text({
            x: mvX, y: mvY + mvLen - polFS - 2,
            text: 'S', fontSize: polFS, fontFamily: 'Arial', fontStyle: 'bold',
            fill: '#d09030', width: mvW, align: 'center',
        });
        this._mvGroup.add(this._mvPolBot);

        this._mvGroup.add(new Konva.Circle({
            x: -15, y: 0, radius: 4,
            fill: '#c8b868', stroke: '#a89848', strokeWidth: 1,
        }));

        this._dynamicGroup.add(this._mvGroup);
    }

    /** 固定铁片 N/S 极性文字（动态） */
    _createRightPolarity() {
        const { x, y, w, h } = this._fixedVane;
        const fs = Math.max(8, w * 0.70);

        this._fvPolTop = new Konva.Text({
            x:x-20, y: y + 2,
            text: 'N',
            fontSize: fs, fontFamily: 'Arial', fontStyle: 'bold',
            fill: '#4a6a9a', width: w, align: 'center',
        });
        this._dynamicGroup.add(this._fvPolTop);

        this._fvPolBot = new Konva.Text({
            x:x-20, y: y + h - fs - 2,
            text: 'S',
            fontSize: fs, fontFamily: 'Arial', fontStyle: 'bold',
            fill: '#4a6a9a', width: w, align: 'center',
        });
        this._dynamicGroup.add(this._fvPolBot);
    }

    /** 线圈电流方向符号（随交流相位动态翻转） */
    _createCCSymbols() {
        const { cx, cy, w } = this._coil;
        const symR = w * 0.09;
        this._ccSymGroup = new Konva.Group({ listening: false });

        this._ccSymL = this._makeCurrentSym(cx - w * 0.38, cy, symR, true);
        this._ccSymR = this._makeCurrentSym(cx + w * 0.38, cy, symR, false);
        this._ccSymGroup.add(...this._ccSymL.nodes, ...this._ccSymR.nodes);
        this._dynamicGroup.add(this._ccSymGroup);
    }

    _makeCurrentSym(x, y, r, isOut) {
        const nodes = [];
        if (isOut) {
            nodes.push(new Konva.Circle({ x: x-10, y: y, radius: r * 0.30, fill: '#d03020' }));
        } else {
            const dl = r * 0.30;
            nodes.push(new Konva.Line({
                points: [x - dl+10, y - dl, x + dl+10, y + dl],
                stroke: '#d03020', strokeWidth: 4, lineCap: 'round',
            }));
            nodes.push(new Konva.Line({
                points: [x + dl+10, y - dl, x - dl+10, y + dl],
                stroke: '#d03020', strokeWidth: 4, lineCap: 'round',
            }));
        }
        return { nodes, isOut };
    }

    /** 排斥力箭头（固定铁片 → 活动铁片） */
    _createForceArrow() {
        this._forceGroup = new Konva.Group({ listening: false });
        this._dynamicGroup.add(this._forceGroup);
    }

    _createCurrentDisplay() {
        const { cx, cy, r } = this._face;
        const fs = Math.max(9, r * 0.195);
        this._currText = new Konva.Text({
            x: cx - r * 0.68,
            y: cy + r * 0.52,
            text: '0.0 A',
            fontSize: fs, fontFamily: 'Courier New', fontStyle: 'bold',
            fill: '#38a860',
            width: r * 1.36, align: 'center',
        });
        this._dynamicGroup.add(this._currText);
    }

    // ═══════════════════════════════════════════════════
    // 动态更新
    // ═══════════════════════════════════════════════════

    _updateDynamic() {
        const i    = this._currentI;
        const frac = Math.max(0, Math.min(1, i / this.maxCurrent));
        const str  = frac * frac;   // 平方律强度（用于磁场、偏转）

        // ── 1) 指针 ───────────────────────────────────
        this._needleAngle = this._currentToAngle(i);
        this._needleGroup.rotation(this._needleAngle);

        // ── 2) 游丝（随指针） ─────────────────────────
        this._hairspringGrp.rotation(this._needleAngle);

        // ── 3) 活动铁片偏转（∝ I²，最大约 38°） ──────
        this._mvAngle = str * 38;
        this._mvGroup.rotation(this._mvAngle);
        // ── 4) N/S 极性标注（随磁场相位同步翻转） ────
        const sign = Math.sin(this._acPhase) >= 0 ? 'N' : 'S';
        this._mvPolTop.text(sign);
        this._mvPolBot.text(sign === 'N' ? 'S' : 'N');
        this._fvPolTop.text(sign);
        this._fvPolBot.text(sign === 'N' ? 'S' : 'N');

        // ── 5) CC 电流方向符号翻转 ──────────────────
        this._updateCCSymbols();

        // ── 5) 排斥力箭头 ────────────────────────────
        this._updateForceArrow(str);

        // ── 7) 数字显示 ──────────────────────────────
        this._currText.text(`${i.toFixed(2)} A`);
        this._currText.fill(frac < 0.20 ? '#e08030' : '#40c870');
    }

    _updateCCSymbols() {
        // 正半周：左⊙右⊗；负半周：左⊗右⊙
        const { cx, cy, w } = this._coil;
        const symR = w * 0.09;
        const isPositiveHalf = Math.sin(this._acPhase) >= 0;
        const alpha = 0.4 + 0.6 * Math.abs(Math.sin(this._acPhase));
        this._ccSymGroup.opacity(alpha * (this._currentI > 0.01 ? 1 : 0.2));
        // 左符号更新
        const lIsOut = isPositiveHalf;
        const rIsOut = !isPositiveHalf;
        this._ccSymGroup.destroyChildren();
        const { nodes: lNodes } = this._makeCurrentSym(cx - w * 0.38, cy, symR, lIsOut);
        const { nodes: rNodes } = this._makeCurrentSym(cx + w * 0.38, cy, symR, rIsOut);
        lNodes.forEach(n => this._ccSymGroup.add(n));
        rNodes.forEach(n => this._ccSymGroup.add(n));
    }

    _updateForceArrow(strength) {
        this._forceGroup.destroyChildren();
        if (strength < 0.04) return;

        const { x: fvX, y: fvY, w: fvW, h: fvH } = this._fixedVane;
        const alpha = Math.min(0.95, strength * 0.85 + 0.10);
        const fLen  = fvW * (0.4 + strength * 1.2);

        const arrowY = fvY + fvH * 0.20;
        this._forceGroup.add(new Konva.Arrow({
            points: [fvX + fvW-22, arrowY, fvX + fvW + fLen-22, arrowY],
            fill:   `rgba(200,70,15,${alpha * 0.85})`,
            stroke: `rgba(200,70,15,${alpha * 0.85})`,
            strokeWidth: 2.5, pointerLength: 7, pointerWidth: 5, listening: false,
        }));

        this._forceGroup.add(new Konva.Text({
            x: fvX + fvW-20, y: arrowY - 12,
            text: '排斥力 ∝ I²',
            fontSize: Math.max(10, this.width * 0.015), fontFamily: 'Arial',
            fill: `rgba(180,60,10,${alpha * 0.90})`,
        }));
    }

    // ═══════════════════════════════════════════════════
    // tick 主循环
    // ═══════════════════════════════════════════════════

    tick(dt) {
        // 从电路求解器获取电流，用滑动窗口 RMS（均方根）求有效值
        if (this.physCurrent !== undefined) {
            const solverDt = this.sys?.voltageSolver?.deltaTime || 1e-4;
            const windowSize = Math.max(10, Math.round(1 / (this._frequency * solverDt)));
            this._rmsBuffer.push(this.physCurrent * this.physCurrent);
            if (this._rmsBuffer.length > windowSize) {
                this._rmsBuffer.shift();
            }
            const sumSq = this._rmsBuffer.reduce((a, b) => a + b, 0);
            const rms = Math.sqrt(sumSq / this._rmsBuffer.length);
            this._targetI = Math.min(this.maxCurrent * 1.20, rms);
        }

        // 一阶惯性跟随
        const tau   = Math.max(0.05, this._rampTime);
        const alpha = 1 - Math.exp(-dt / tau);
        this._currentI += (this._targetI - this._currentI) * alpha;

        // 交流相位
        this._acPhase = (this._acPhase + dt * 2 * Math.PI * this._frequency) % (2 * Math.PI);

        this._updateDynamic();
        this.markDirty();
        this._refreshIfDirty();
    }

    // ═══════════════════════════════════════════════════
    // 公开 API
    // ═══════════════════════════════════════════════════

    /** 设置被测电流有效值（A） */
    setCurrent(i) {
        this._targetI = Math.max(0, Math.min(this.maxCurrent * 1.20, parseFloat(i) || 0));
    }

    getCurrent()   { return this._currentI; }
    getTargetI()   { return this._targetI; }

    update(state) {
        if (typeof state === 'object' && state !== null) {
            if (state.current    !== undefined) this.setCurrent(state.current);
            if (state.maxCurrent !== undefined) {
                this.maxCurrent = parseFloat(state.maxCurrent) || 5;
            }
        } else {
            this.setCurrent(state);
        }
    }

    // ═══════════════════════════════════════════════════
    // 配置界面
    // ═══════════════════════════════════════════════════

    getConfigFields() {
        return [
            { label: '被测电流 A（有效值）',          key: 'current',    type: 'number' },
            { label: '满量程电流 A',                  key: 'maxCurrent', type: 'number' },
            { label: '频率 Hz',                       key: 'frequency',  type: 'number' },
            { label: '响应时间常数 s',                key: 'rampTime',   type: 'number' },
            { label: '精度等级',                      key: 'accuracy',   type: 'text'   },
            { label: 'CT 变比（如 100/5，默认 1）',   key: 'ctRatio',    type: 'text'   },
        ];
    }

    onConfigUpdate(cfg) {
        if (cfg.maxCurrent !== undefined) this.maxCurrent  = parseFloat(cfg.maxCurrent) || 5;
        if (cfg.frequency  !== undefined) this._frequency  = parseFloat(cfg.frequency)  || 50;
        if (cfg.rampTime   !== undefined) this._rampTime   = parseFloat(cfg.rampTime)   || 0.35;
        if (cfg.accuracy   !== undefined) this._accuracy   = cfg.accuracy;
        if (cfg.ctRatio    !== undefined) this._ctRatio    = cfg.ctRatio;
        if (cfg.current    !== undefined) this.setCurrent(cfg.current);

        this.config = { ...this.config, ...cfg };

        this._recalcGeometry();
        this._staticGroup.destroyChildren();
        this._dynamicGroup.destroyChildren();
        this._drawStaticParts();
        this._createDynamicNodes();
        this._refreshCache?.();
    }

    destroy() {
        super.destroy?.();
    }
}
