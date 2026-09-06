import { BaseComponent } from './BaseComponent.js';

/**
 * 交流电压表（AC Voltmeter）仿真组件
 *
 * ═══ 工作原理 ════════════════════════════════════════════════════════
 *  采用电磁系（动铁式 / 排斥型）测量机构，适用于交流电压的有效值测量。
 *
 *  ── 电磁系测量机构 ──────────────────────────────────────────────
 *    ① 固定线圈（Coil）：通入被测交流电流 i(t) 后产生交变磁场 H(t)
 *    ② 固定铁片（Fixed Vane / 静铁片）：装于线圈内壁一侧，被磁化后
 *       极性随电流方向同步变化
 *    ③ 动铁片（Moving Vane / 动铁片）：装于转轴上，与静铁片在同一
 *       磁场中被磁化，产生同极性排斥力矩
 *    ④ 由于静、动铁片极性同时变化，排斥力方向始终不变 → 转矩正比于 i²
 *    ⑤ 游丝（Hairspring）产生反作用力矩，平衡时指针偏转角 θ ∝ I²
 *    ⑥ 刻度为平方律特性：起始密、末端疏
 *
 *  ── 仿真实现要点 ────────────────────────────────────────────────
 *    ① 不自带 stamp，电压值从 MNA 求解结果中直接读取
 *    ② RMS 计算：每帧采集 vp-vn 瞬时值，滑动窗口平方累加后开方
 *    ③ 指针响应：一阶低通滤波模拟机械惯性（时间常数 _rampTime）
 *    ④ ⊙/⊗ 符号：根据当前相位显示电流进出方向，频率高时视觉融合
 *
 * ═══ 渲染结构 ═════════════════════════════════════════════════════════
 *  左侧（50%）：表盘（刻度、指针、量程标识）
 *  右侧（50%）：原理图（线圈 + 静/动铁片 + 限流电阻 Rv + 接线端子）
 *
 * ═══ 端口 ════════════════════════════════════════════════════════════
 *  vp — 正极端（红色，组件右下侧）
 *  vn — 负极端（蓝色，组件右下侧）
 *
 * ═══ 可配置参数 ══════════════════════════════════════════════════════
 *  maxVoltage : 满量程电压（默认 100V）
 *  frequency  : 被测交流电频率 Hz（默认 50）
 *  rampTime   : 指针响应时间常数 s（默认 0.35）
 *  accuracy   : 精度等级（默认 '2.5'）
 */
export class ACVoltmeter extends BaseComponent {
    /**
     * @param {object} config - 配置参数
     * @param {object} sys    - ControlSystem 实例
     */
    constructor(config, sys) {
        super(config, sys);

        // ── 尺寸：最小 340×200，默认 460×260 ──────────────
        this.width  = Math.max(340, config.width  || 460);
        this.height = Math.max(200, config.height || 260);

        this.type    = 'ac_volt';        // 类型标识，供 CircuitSolver 设备分组
        this.special = 'AC_VOLTMETER';   // 特殊标记，求解器用此识别
        this.cache   = 'fixed';          // 启用 Konva 静态缓存（不变部分仅渲染一次）

        // ── 初始化组、几何、参数、绘制 ──────────────────
        this._initGroups();
        this._recalcGeometry();
        this._initParameters(config);
        this._init();

        // ── 暴露给配置对话框的初始值 ────────────────────
        this.config = {
            id: this.id,
            voltage:    this._targetV,
            maxVoltage: this.maxVoltage,
            frequency:  this._frequency,
            rampTime:   this._rampTime,
            accuracy:   this._accuracy,
        };

        // ── 电气端口：vp（正极）/ vn（负极）─────────────
        this.addPort(this._portVp.x, this._portVp.y, 'vp', 'wire', 'p');
        this.addPort(this._portVn.x, this._portVn.y, 'vn', 'wire', 'n');
    }

    /**
     * 几何尺寸计算
     *
     * 整体分为左右两半：
     *   - 左半区（0~_divX）：仪表表盘（指针、刻度）
     *   - 右半区（_divX~W）：电磁系原理示意图（线圈、铁片、电阻、端子）
     *
     * 所有位置均相对于组件宽高百分比计算，保证缩放适应性。
     */
    _recalcGeometry() {
        const W = this.width, H = this.height;
        this._divX  = W * 0.50;                                // 左右分界线
        this._frame = { x: 2, y: 2, w: W - 4, h: H - 4, rx: 6 }; // 外框

        // ── 左半区：表盘 ────────────────────────────────
        const lW  = this._divX;
        const fCx = lW * 0.50;                                 // 表盘圆心 X
        const fCy = H  * 0.50;                                 // 表盘圆心 Y
        const fR  = Math.min(lW * 0.46, H * 0.45);             // 表盘半径
        this._face = { cx: fCx, cy: fCy, r: fR };

        this._angleStart = 165;    // 刻度起始角度（度），约左下方
        this._angleSweep = 210;    // 刻度跨幅（度），约 5/6 圆弧

        // ── 右半区：原理图 ──────────────────────────────
        const rLeft = this._divX;
        const rW    = W - rLeft;

        // 固定线圈（椭圆截面）
        const coilCx = rLeft + rW * 0.54;                      // 线圈中心 X
        const coilCy = H * 0.42;                                // 线圈中心 Y
        const coilW  = rW * 0.78;                               // 线圈宽度
        const coilH  = H  * 0.76;                               // 线圈高度
        this._coil   = { cx: coilCx, cy: coilCy, w: coilW, h: coilH };

        // 线圈内腔（静/动铁片活动空间）
        const cavW = coilW * 0.58, cavH = coilH * 0.76;
        this._cavity = {
            cx: coilCx, cy: coilCy,
            w: cavW, h: cavH,
            x: coilCx - cavW / 2,
            y: coilCy - cavH / 2,
        };

        // 静铁片（固定于内腔左侧壁）
        const fvW = cavW * 0.22, fvH = cavH * 0.50;
        this._fixedVane = {
            x: this._cavity.x + cavW * 0.05,
            y: coilCy - fvH / 2,
            w: fvW, h: fvH,
        };

        // 动铁片转轴（位于内腔偏右）
        this._pivotX = coilCx + cavW * 0.10;
        this._pivotY = coilCy;

        // 右下侧接线端子
        const tY  = H - 5;
        const tSp = rW * 0.18;
        this._termVp = { x: rLeft + rW * 0.36, y: tY - H * 0.10 };  // V+（左）
        this._termVn = { x: rLeft + rW * 0.72, y: tY - H * 0.10 };  // V−（右）

        // 端口（组件的电气连接点，位于下边缘）
        this._portVp = { x: this._termVp.x, y: H - 2 };
        this._portVn = { x: this._termVn.x, y: H - 2 };
    }

    /**
     * 初始化仿真参数
     *
     * @param {object} config - 用户配置
     *   - maxVoltage : 满量程电压（V），决定刻度范围
     *   - frequency  : 被测信号频率（Hz），用于 RMS 窗口和相位计算
     *   - rampTime   : 指针阻尼时间常数（s），模拟机械惯性
     *   - accuracy   : 精度等级显示（如 '2.5'）
     *   - voltage    : 初始目标电压（V），用于调试
     */
    _initParameters(config) {
        this.maxVoltage = config.maxVoltage !== undefined ? parseFloat(config.maxVoltage) : 100;
        this._frequency = config.frequency  !== undefined ? parseFloat(config.frequency)  : 50;
        this._rampTime  = config.rampTime   !== undefined ? parseFloat(config.rampTime)   : 0.35;
        this._accuracy  = config.accuracy   || '2.5';

        this._targetV   = config.voltage !== undefined ? parseFloat(config.voltage) : 0;
        this._currentV  = this._targetV;     // 当前显示值（经一阶低通滤波）
        this._rmsBuffer = [];                // 滑动窗口，缓存瞬时值平方用于 RMS 计算

        this._needleAngle = this._voltageToAngle(this._currentV);  // 指针初始角度
        this._mvAngle = 0;                    // 动铁片偏转角
        this._acPhase = 0;                    // 交流电相位角（弧度），用于 ⊙/⊗ 符号
    }

    /**
     * 电压值 → 指针偏转角
     *
     * 电磁系仪表刻度为平方律特性：θ ∝ I²
     * 因此先求 f = V/Vmax，再用 f² 映射到角度范围。
     *
     * @param {number} v - 电压值
     * @returns {number} 偏转角（度）
     */
    _voltageToAngle(v) {
        const frac = Math.max(0, Math.min(1, v / this.maxVoltage));
        return this._angleStart + frac * frac * this._angleSweep;
    }

    /**
     * 电压值 → 刻度位置分数（0~1），平方律
     * @param {number} v - 电压值
     * @returns {number} 分数位置（0~1）
     */
    _voltageToFrac(v) {
        const f = v / this.maxVoltage;
        return f * f;
    }

    /**
     * 主初始化入口
     * 顺序：先绘制所有静态内容（缓存层）→ 再创建动态节点（每帧可更新）
     */
    _init() {
        this._drawStaticParts();
        this._createDynamicNodes();
    }

    /**
     * 绘制所有静态部件
     * 这部分只需绘制一次，Konva cache='fixed' 会将结果缓存为离屏 Canvas
     */
    _drawStaticParts() {
        this._drawFrame();
        this._drawFaceStatic();
        this._drawPrincipleStatic();
    }

    /**
     * 绘制组件外框（浅灰圆角矩形边框）
     */
    _drawFrame() {
        const f = this._frame;
        this._staticGroup.add(new Konva.Rect({
            x: f.x, y: f.y, width: f.w, height: f.h,
            fill: '#e8eaec',
            stroke: '#b0b4b8', strokeWidth: 1.5,
            cornerRadius: f.rx,
        }));
    }

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

        this._drawVoltmeterScale();

        const outerR = r * 0.94;
        const ang20 = this._angleStart + this._voltageToFrac(this.maxVoltage * 0.20) * this._angleSweep;
        this._drawScaleArc(cx, cy, outerR, this._angleStart, ang20, 'rgba(200,40,10,0.30)', 5);
        this._drawScaleArc(cx, cy, outerR, ang20,
            this._angleStart + this._angleSweep, 'rgba(30,150,60,0.18)', 5);

        const pW = r * 1.30, pH = r * 0.32;
        const pX = cx - pW / 2, pY = cy - r * 0.62;
        const pFs = Math.max(7, r * 0.138);
        this._staticGroup.add(new Konva.Text({
            x: pX + 2, y: pY + pH - pFs + 10,
            text: `0 ~ ${this.maxVoltage} V`,
            fontSize: pFs, fontFamily: 'Arial', fontStyle: 'bold', fill: '#483828',
            width: pW - 4, align: 'center',
        }));

        const uFs = Math.max(10, r * 0.185);
        this._staticGroup.add(new Konva.Text({
            x: cx - r * 0.55, y: cy + r * 0.06,
            text: 'V',
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

    _drawVoltmeterScale() {
        const { cx, cy, r } = this._face;
        const outerR = r * 0.94;

        this._drawScaleArc(cx, cy, outerR,
            this._angleStart, this._angleStart + this._angleSweep,
            '#585048', 1.2);

        const majorVals = [];
        const step = this.maxVoltage / 5;
        for (let i = 0; i <= 5; i++) majorVals.push(i * step);

        const minorCount = 50;
        for (let i = 0; i <= minorCount; i++) {
            const vVal   = (i / minorCount) * this.maxVoltage;
            const frac   = this._voltageToFrac(vVal);
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
            const frac   = this._voltageToFrac(v);
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

    _drawPrincipleStatic() {
        const W = this.width, H = this.height;
        const f = this._frame;

        this._staticGroup.add(new Konva.Rect({
            x: this._divX + 1, y: f.y + 2,
            width: W - this._divX - f.x - 2, height: f.h - 4,
            fill: '#f0f2f4',
            cornerRadius: [0, f.rx - 1, f.rx - 1, 0],
        }));

        this._staticGroup.add(new Konva.Text({
            x: this._divX + 8, y: 10,
            text: '原理图',
            fontSize: 13, fontFamily: 'Arial', fontStyle: 'bold',
            fill: '#555',
        }));

        this._drawCoilBody();
        this._drawFixedVane();
        this._drawSeriesResistor();
        this._drawShaftAndSpring();
        this._drawRightTerminals();
    }

    /**
     * 绘制原理图区域背景（右侧浅色面板）及标题
     */
    /**
     * 绘制固定线圈体（椭圆截面外框 + 线圈绕线条纹）
     *
     * 线圈为电磁系机构的核心部件，通入交流电流后产生交变磁场。
     * 椭圆外形配合渐变填充模拟三维线圈的立体感。
     */
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
    }

    /**
     * 绘制静铁片（固定于线圈内腔左侧壁）
     *
     * 静铁片与动铁片在同一交变磁场中被磁化，产生同极性排斥力。
     * 由于两者极性同时变化，排斥力方向始终不变 → 产生单向转矩。
     */
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

    /**
     * 绘制限流分压电阻 Rv（小矩形，串联在 V+ 垂直引线上，与 V- 侧对称）
     *
     * 电磁系电压表必须串联限流电阻以将电压转换为电流。
     * Rv 决定了电压表的量程：Vmax = Imax × (Rv + Rcoil)
     * 此处仅作示意图展示，实际阻值由 MNA 求解器中的交流电压表处理逻辑决定。
     */
    _drawSeriesResistor() {
        const rx = this._termVp.x;
        const leadY = this._coil.cy + this._cavity.h / 2;
        const rw = 14, rh = 22;
        const ry = leadY - (leadY - this._termVp.y) * 0.35;

        this._staticGroup.add(new Konva.Rect({
            x: rx - rw / 2, y: ry - rh / 2,
            width: rw, height: rh,
            fill: '#e8dcc8', stroke: '#b09060', strokeWidth: 1.5, cornerRadius: 2,
        }));

        this._staticGroup.add(new Konva.Text({
            x: rx - 38, y: ry + rh / 2 -12,
            text: 'Rv', fontSize: 12, fontFamily: 'Arial', fontStyle: 'bold',
            fill: '#666', width: 36, align: 'center',
        }));

        this._staticGroup.add(new Konva.Line({
            points: [this._cavity.x - 5, leadY, rx, leadY, rx, ry - rh / 2],
            stroke: '#c83020', strokeWidth: 2,
        }));
        this._staticGroup.add(new Konva.Line({
            points: [rx, ry + rh / 2, rx, this._termVp.y],
            stroke: '#c83020', strokeWidth: 2,
        }));
    }

    _drawShaftAndSpring() {
    }

    /**
     * 绘制右侧接线端子（V+ / V−）
     *
     * 包括黄铜螺柱、引出线及与线圈的连接线。
     * V+ 侧（红色）：经 Rv 连接至线圈左端
     * V− 侧（蓝色）：直接连接至线圈右端
     * 两侧引线布局对称，便于理解测量回路。
     */
    _drawRightTerminals() {
        const tR = Math.max(5, this.width * 0.017);
        const termDefs = [
            { pos: this._termVp, label: 'V+', color: '#c83020' },
            { pos: this._termVn, label: 'V−', color: '#3068c0' },
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

        const rLeft = this._divX;
        const W = this.width, H = this.height;
        const leadY = this._coil.cy + this._cavity.h / 2;
        this._staticGroup.add(new Konva.Line({
            points: [this._cavity.x + this._cavity.w + 5, leadY, this._termVn.x, leadY, this._termVn.x, this._termVn.y],
            stroke: '#3068c0', strokeWidth: 2,
        }));
    }

    /**
     * 创建所有动态节点（每帧根据仿真结果更新）
     *
     * 动态节点包括：
     *   - 指针（_createNeedle）
     *   - 游丝（_createHairspring）
     *   - 动铁片（_createMovingVane）
     *   - 极性标签 N/S（_createRightPolarity）
     *   - 电流方向符号 ⊙/⊗（_createCCSymbols）
     *   - 数字电压显示（_createVoltageDisplay）
     */
    _createDynamicNodes() {
        this._createNeedle();
        this._createHairspring();
        this._createMovingVane();
        this._createRightPolarity();
        this._createCCSymbols();
        this._createVoltageDisplay();
    }

    /**
     * 创建指针（红色刀形指针，带尾部平衡块）
     *
     * 指针固定在 _needleGroup 中，通过旋转该组实现偏转。
     * 指针形状：细长杆 + 箭头尖端 + 尾部矩形平衡块。
     */
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

        this._dynamicGroup.add(new Konva.Circle({
            x: cx, y: cy, radius: r * 0.055,
            fillLinearGradientStartPoint: { x: -3, y: -3 },
            fillLinearGradientEndPoint:   { x:  3, y:  3 },
            fillLinearGradientColorStops: [0, '#f0e060', 0.5, '#c8a830', 1, '#908020'],
            stroke: '#706018', strokeWidth: 1, listening: false,
        }));
    }

    /**
     * 创建游丝（螺旋弹簧，提供反作用力矩）
     *
     * 游丝为阿基米德螺旋线，内外端分别固定在转轴和支架上。
     * 指针偏转时游丝产生与偏转角成正比的回复力矩，
     * 与电磁驱动力矩平衡，使偏转角正比于电流平方。
     * 游丝组随指针同步旋转。
     */
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

    /**
     * 创建动铁片（可绕轴旋转的软磁体，与静铁片产生排斥力矩）
     *
     * 动铁片为矩形软磁片，固定在转轴上，标有 N/S 极性标记。
     * 当线圈通入交流电流时，静/动铁片同时被磁化，
     * 产生同极性排斥力 → 动铁片带动指针偏转。
     * 由于交流电流的极性同时变化，排斥力方向始终不变。
     * _mvAngle 控制偏转角，由 _updateDynamic 驱动。
     */
    _createMovingVane() {
        const { h: cvH, w: cvW } = this._cavity;
        const px = this._pivotX, py = this._pivotY;

        this._mvGroup = new Konva.Group({ x: px, y: py, rotation: -30 });

        const mvLen = cvH * 0.44, mvW = cvW * 0.18;
        const mvX = mvW * 0.30, mvY = -mvLen * 0.55;

        this._mvGroup.add(new Konva.Line({
            points: [-15, 0, mvX, mvY],
            stroke: '#8898a8', strokeWidth: 1.2, lineCap: 'round', listening: false,
        }));
        this._mvGroup.add(new Konva.Line({
            points: [-15, 0, mvX, mvY + mvLen],
            stroke: '#8898a8', strokeWidth: 1.2, lineCap: 'round', listening: false,
        }));

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

    /**
     * 创建静铁片上的 N/S 极性标签
     *
     * 极性与动铁片同步更新（同极性），以反映当前半周的磁场方向。
     * 通过 _updateDynamic 每帧刷新。
     */
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

    /**
     * 创建电流方向符号 ⊙（流出）和 ⊗（流入）
     *
     * 在线圈两侧各放置一个符号，根据交流电当前半周方向交替显示。
     * ⊙ = 圆点（电流垂直纸面向外）
     * ⊗ = 十字（电流垂直纸面向里）
     * 频率较高时视觉融合，形成明暗交替效果。
     */
    _createCCSymbols() {
        const { cx, cy, w } = this._coil;
        const symR = w * 0.09;
        this._ccSymGroup = new Konva.Group({ listening: false });

        this._ccSymL = this._makeCurrentSym(cx - w * 0.38, cy, symR, true);
        this._ccSymR = this._makeCurrentSym(cx + w * 0.38, cy, symR, false);
        this._ccSymGroup.add(...this._ccSymL.nodes, ...this._ccSymR.nodes);
        this._dynamicGroup.add(this._ccSymGroup);
    }

    /**
     * 生成单个电流方向符号（⊙ 或 ⊗）
     *
     * @param {number}  x     - 符号中心 X
     * @param {number}  y     - 符号中心 Y
     * @param {number}  r     - 符号参考半径
     * @param {boolean} isOut - true=⊙（流出），false=⊗（流入）
     * @returns {{ nodes: Konva.Node[], isOut: boolean }}
     */
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

    /**
     * 每帧更新电流方向符号
     *
     * 根据当前交流相位 _acPhase 确定正负半周：
     *   - 正半周：左侧 ⊙（流出）、右侧 ⊗（流入）
     *   - 负半周：左侧 ⊗（流入）、右侧 ⊙（流出）
     * 透明度随瞬时值变化，过零时最暗。
     */
    _updateCCSymbols() {
        const { cx, cy, w } = this._coil;
        const symR = w * 0.09;
        const isPositiveHalf = Math.sin(this._acPhase) >= 0;
        const alpha = 0.4 + 0.6 * Math.abs(Math.sin(this._acPhase));
        this._ccSymGroup.opacity(alpha * (this._currentV > 0.5 ? 1 : 0.2));
        const lIsOut = isPositiveHalf;
        const rIsOut = !isPositiveHalf;
        this._ccSymGroup.destroyChildren();
        const { nodes: lNodes } = this._makeCurrentSym(cx - w * 0.38, cy, symR, lIsOut);
        const { nodes: rNodes } = this._makeCurrentSym(cx + w * 0.38, cy, symR, rIsOut);
        lNodes.forEach(n => this._ccSymGroup.add(n));
        rNodes.forEach(n => this._ccSymGroup.add(n));
    }

    /**
     * 创建数字电压显示（表盘下方的绿色/橙色数值）
     *
     * 显示当前有效值（RMS），低电压时橙色，正常后绿色。
     */
    _createVoltageDisplay() {
        const { cx, cy, r } = this._face;
        const fs = Math.max(9, r * 0.195);
        this._voltText = new Konva.Text({
            x: cx - r * 0.68,
            y: cy + r * 0.52,
            text: '0.0 V',
            fontSize: fs, fontFamily: 'Courier New', fontStyle: 'bold',
            fill: '#38a860',
            width: r * 1.36, align: 'center',
        });
        this._dynamicGroup.add(this._voltText);
    }

    /**
     * 每帧更新所有动态视觉元素
     *
     * 更新内容包括：
     *   - 指针偏转角（方形律映射）
     *   - 游丝旋转（跟随指针）
     *   - 动铁片偏转角
     *   - N/S 极性标签（随相位翻转）
     *   - ⊙/⊗ 电流方向符号
     *   - 数字电压读数
     */
    _updateDynamic() {
        const v    = this._currentV;
        const frac = Math.max(0, Math.min(1, v / this.maxVoltage));
        const str  = frac * frac;

        this._needleAngle = this._voltageToAngle(v);
        this._needleGroup.rotation(this._needleAngle);

        this._hairspringGrp.rotation(this._needleAngle);

        this._mvAngle = str * 38;
        this._mvGroup.rotation(this._mvAngle);

        const sign = Math.sin(this._acPhase) >= 0 ? 'N' : 'S';
        this._mvPolTop.text(sign);
        this._mvPolBot.text(sign === 'N' ? 'S' : 'N');
        this._fvPolTop.text(sign);
        this._fvPolBot.text(sign === 'N' ? 'S' : 'N');

        this._updateCCSymbols();

        this._voltText.text(`${v.toFixed(1)} V`);
        this._voltText.fill(frac < 0.20 ? '#e08030' : '#40c870');
    }

    /**
     * 每帧仿真更新（由 ControlSystem 的集中式 tick 循环驱动，20fps）
     *
     * 执行流程：
     *   1. 从 MNA 求解器获取 vp/vn 节点电压，计算瞬时值 vInstant = vp - vn
     *   2. 将瞬时值平方后推入滑动窗口（_rmsBuffer），窗口长度约一个工频周期
     *   3. 对窗口内数据取均方根 → _targetV（目标显示值）
     *   4. 一阶低通滤波：_currentV 向 _targetV 逼近（模拟机械惯性）
     *   5. 更新交流相位角 _acPhase（用于 ⊙/⊗ 符号和极性切换）
     *   6. 调用 _updateDynamic 刷新所有动态节点
     *
     * @param {number} dt - 帧时间间隔（秒），约 0.05s（20fps）
     */
    tick(dt) {
        const sv = this.sys?.voltageSolver;
        if (sv) {
            const cVp = sv.portToCluster.get(`${this.id}_wire_vp`);
            const cVn = sv.portToCluster.get(`${this.id}_wire_vn`);
            if (cVp !== undefined && cVn !== undefined) {
                const vp = sv.nodeVoltages.get(cVp) || 0;
                const vn = sv.nodeVoltages.get(cVn) || 0;
                const vInstant = vp - vn;
                const windowSize = Math.max(10, Math.round(1 / (this._frequency * (sv.deltaTime || 1e-4))));
                this._rmsBuffer.push(vInstant * vInstant);
                if (this._rmsBuffer.length > windowSize) {
                    this._rmsBuffer.shift();
                }
                const sumSq = this._rmsBuffer.reduce((a, b) => a + b, 0);
                this._targetV = Math.min(this.maxVoltage * 1.20, Math.sqrt(sumSq / this._rmsBuffer.length));
            }
        }

        const tau   = Math.max(0.05, this._rampTime);
        const alpha = 1 - Math.exp(-dt / tau);
        this._currentV += (this._targetV - this._currentV) * alpha;

        this._acPhase = (this._acPhase + dt * 2 * Math.PI * this._frequency) % (2 * Math.PI);

        this._updateDynamic();
        this.markDirty();
        this._refreshIfDirty();
    }

    /**
     * 设置目标电压值（外部调用，如 Workflow 或故障注入）
     * @param {number} v - 目标电压有效值（V）
     */
    setVoltage(v) {
        this._targetV = Math.max(0, Math.min(this.maxVoltage * 1.20, parseFloat(v) || 0));
    }

    /** 获取当前显示电压（经低通滤波后的值） */
    getVoltage()   { return this._currentV; }

    /**
     * 外部状态更新接口（被 ControlSystem 或 Workflow 调用）
     *
     * 支持两种调用方式：
     *   update({ voltage: 50, maxVoltage: 100 }) — 同时更新多个参数
     *   update(50) — 仅设置目标电压
     *
     * @param {object|number} state - 新状态
     */
    update(state) {
        if (typeof state === 'object' && state !== null) {
            if (state.voltage    !== undefined) this.setVoltage(state.voltage);
            if (state.maxVoltage !== undefined) {
                this.maxVoltage = parseFloat(state.maxVoltage) || 100;
            }
        } else {
            this.setVoltage(state);
        }
    }

    getConfigFields() {
        return [
            { label: '被测电压 V（有效值）',        key: 'voltage',    type: 'number' },
            { label: '满量程电压 V',                key: 'maxVoltage', type: 'number' },
            { label: '频率 Hz',                     key: 'frequency',  type: 'number' },
            { label: '响应时间常数 s',              key: 'rampTime',   type: 'number' },
            { label: '精度等级',                    key: 'accuracy',   type: 'text'   },
        ];
    }

    onConfigUpdate(cfg) {
        if (cfg.maxVoltage !== undefined) this.maxVoltage = parseFloat(cfg.maxVoltage) || 100;
        if (cfg.frequency  !== undefined) this._frequency = parseFloat(cfg.frequency)  || 50;
        if (cfg.rampTime   !== undefined) this._rampTime  = parseFloat(cfg.rampTime)   || 0.35;
        if (cfg.accuracy   !== undefined) this._accuracy  = cfg.accuracy;
        if (cfg.voltage    !== undefined) this.setVoltage(cfg.voltage);

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
