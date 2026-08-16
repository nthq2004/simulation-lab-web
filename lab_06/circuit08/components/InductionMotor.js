import { BaseComponent } from './BaseComponent.js';

export class InductionMotor extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.width  = Math.max(480, config.width  || 660);
        this.height = Math.max(380, config.height || 480);

        this.type  = 'induction_motor';
        this.cache = 'fixed';

        this._initGroups();
        this._recalcGeometry();
        this._initParameters(config);
        this._init();

        this.config = {
            label:         this.label,
            R1:            this.R1,
            Lsigma1:       this.Lsigma1,
            Rc:            this.Rc,
            Lm:            this.Lm,
            R2:            this.R2,
            Lsigma2:       this.Lsigma2,
            polePairs:     this.polePairs,
            remanenceFlux: this.remanenceFlux,
            J:             this.J,
            B:             this.B,
            loadTorque:    this.loadTorque,
        };

        this.addPort(this._tp.u1.x, this._tp.u1.y, 'u1', 'wire', 'p');
        this.addPort(this._tp.v1.x, this._tp.v1.y, 'v1', 'wire', 'p');
        this.addPort(this._tp.w1.x, this._tp.w1.y, 'w1', 'wire', 'p');
        this.addPort(this._tp.w2.x, this._tp.w2.y, 'w2', 'wire', 'p');
        this.addPort(this._tp.u2.x, this._tp.u2.y, 'u2', 'wire', 'p');
        this.addPort(this._tp.v2.x, this._tp.v2.y, 'v2', 'wire', 'p');
    }

    _recalcGeometry() {
        const W = this.width, H = this.height;
        const pad = 8;

        this._frame = { x: 2, y: 2, w: W - 4, h: H - 4, rx: 6 };

        // ── 左半区：接线盒（45%） ──
        this._boxL = pad;
        this._boxT = 30;
        this._boxW = W * 0.45 - pad * 2;
        this._boxH = H - 90;

        const bx = this._boxL + this._boxW / 2;
        const by = this._boxT + 20;
        const rowH = this._boxH - 70;
        const halfSpan = this._boxW * 0.33;

        const termY1 = by + rowH * 0.32;
        const termY2 = by + rowH * 0.72;

        this._tp = {};
        this._tp.u1 = { x: bx - halfSpan, y: termY1 };
        this._tp.v1 = { x: bx,             y: termY1 };
        this._tp.w1 = { x: bx + halfSpan, y: termY1 };
        this._tp.w2 = { x: bx - halfSpan, y: termY2 };
        this._tp.u2 = { x: bx,             y: termY2 };
        this._tp.v2 = { x: bx + halfSpan, y: termY2 };

        this._termR = 9;
        this._termColors = {
            u1: '#e03030', u2: '#e03030',
            v1: '#20a030', v2: '#20a030',
            w1: '#2050e0', w2: '#2050e0',
        };

        // ── 右半区：上（转子动画40%）+ 下（状态数据60%） ──
        this._rightL = W * 0.48;
        this._rightT = this._boxT;
        this._rightW = W - this._rightL - pad;
        this._rightH = this._boxH;

        // 转子中心
        this._rotorCX = this._rightL + this._rightW / 2;
        this._rotorCY = this._boxT + this._rightH * 0.22;
        this._rotorR  = Math.min(this._rightW, this._rightH * 0.80) * 0.30;

        // 状态数据区
        this._dataX = this._rightL + 10;
        this._dataY = this._boxT + this._rightH * 0.50;

        // 按钮
        const bw = Math.min(120, (this._boxW - 10) / 3);
        const bh = 32;
        const btnY = this._boxT + this._boxH + 10;
        this._btnY = [
            { x: this._boxL + 5,           y: btnY, w: bw, h: bh, label: 'Y 接法',    id: 'btnY' },
            { x: this._boxL + bw + 10,     y: btnY, w: bw, h: bh, label: 'Δ 接法',    id: 'btnD' },
            { x: this._boxL + bw * 2 + 15, y: btnY, w: bw, h: bh, label: '手拨转子',  id: 'btnClr' },
        ];

        this._statusY = btnY + bh + 8;
    }

    _initParameters(config) {
        this.label   = config.label || 'M';
        this.function = config.function || '三相异步电动机';

        this.R1      = config.R1      !== undefined ? config.R1      : 0.50;
        this.Lsigma1 = config.Lsigma1 !== undefined ? config.Lsigma1 : 0.00334;
        this.Rc      = config.Rc      !== undefined ? config.Rc      : 300;
        this.Lm      = config.Lm      !== undefined ? config.Lm      : 0.0796;
        this.R2      = config.R2      !== undefined ? config.R2      : 0.46;
        this.Lsigma2 = config.Lsigma2 !== undefined ? config.Lsigma2 : 0.00334;

        this.polePairs     = config.polePairs     !== undefined ? config.polePairs     : 2;
        this.remanenceFlux = config.remanenceFlux !== undefined ? config.remanenceFlux : 0.012;
        this.J  = config.J  !== undefined ? config.J  : 0.12;
        this.B  = config.B  !== undefined ? config.B  : 0.001;
        this.loadTorque = config.loadTorque !== undefined ? config.loadTorque : 0;
        this.loadType = config.loadType || 'constant';   // 'constant' | 'fan'
        this.fanK = config.fanK || 0;
        this._appliedLoadTorque = 0;
        this.simpleModel = true;

        // 铭牌额定值（可选，若提供则直接显示，否则由等效电路计算）
        this.ratedPower       = config.ratedPower       !== undefined ? config.ratedPower       : null;   // kW
        this.ratedSpeed       = config.ratedSpeed       !== undefined ? config.ratedSpeed       : null;   // rpm

        // 机械状态
        this._omega_m     = 0;
        this._theta_m     = 0;
        this._theta_r     = 0;
        this._Te          = 0;
        this._omega_sync  = 2 * Math.PI * 50 / this.polePairs;
        this.slip         = 1;
        this._fieldAngle  = 0;   // 旋转磁场机械角度

        // 相序检测
        this._phaseSeq    = 1;   // 1=正序, -1=逆序
        this._dcBraking   = false;
        this._VuPrev      = 0;   // 上帧端电压瞬时值
        this._VvPrev      = 0;
        this._VwPrev      = 0;

        // MNA 电流（上帧值）
        this._iuPrev  = 0;
        this._ivPrev  = 0;
        this._iwPrev  = 0;

        // 励磁支路历史状态（用于 Rc || Lm 的梯形积分 Norton 模型）
        this._magVuPrev = 0;   // 上帧端电压 (u1-u2)
        this._magVvPrev = 0;   // 上帧端电压 (v1-v2)
        this._magVwPrev = 0;   // 上帧端电压 (w1-w2)
        this._magIuPrev = 0;   // 上帧 Lm 电流 (u 相)
        this._magIvPrev = 0;   // 上帧 Lm 电流 (v 相)
        this._magIwPrev = 0;   // 上帧 Lm 电流 (w 相)

        this._connType   = 'none';
        this._jumpConn   = [];
        this._btnClickTime = 0;
        this._handTurnCount = 0;

        this.phaseCurrents = { u: 0, v: 0, w: 0 };
        this.rpm = 0;
    }

    _init() {
        this._drawStaticParts();
        this._createDynamicNodes();
        this._bindInteraction();
    }

    // ═══════════════════════════════════════════
    // 静态部件
    // ═══════════════════════════════════════════

    _drawStaticParts() {
        this._drawFrame();
        this._drawTerminalBox();
        this._drawTerminals();
        this._drawRotorStatic();
        this._drawButtons();
    }

    _drawFrame() {
        const f = this._frame;
        this._staticGroup.add(new Konva.Rect({
            x: f.x, y: f.y, width: f.w, height: f.h,
            fill: '#e0e2ec', stroke: '#b0a898', strokeWidth: 1.5, cornerRadius: f.rx,
        }));
        this._staticGroup.add(new Konva.Rect({
            x: f.x + 2, y: f.y + 2, width: f.w - 4, height: 22,
            fill: 'rgba(40,80,180,0.12)', cornerRadius: [f.rx, f.rx, 0, 0],
        }));
        const fs = Math.max(16, this.width * 0.020);
        this._staticGroup.add(new Konva.Text({
            x: f.x + 6, y: f.y + 3,
            text: this.function,
            fontSize: fs, fill: '#0c0c0c',
        }));
        this._staticGroup.add(new Konva.Text({
            x: f.x + f.w - 120, y: f.y + 1,
            text: this.label,
            fontSize: fs, fontStyle: 'bold', fill: '#404060',
        }));

        // 分隔线
        const divX = this._boxL + this._boxW + 6;
        this._staticGroup.add(new Konva.Line({
            points: [divX, this._frame.y + 8, divX, this._frame.y + this._frame.h - 8],
            stroke: '#b0a898', strokeWidth: 1.2, dash: [5, 3],
        }));
    }

    _drawTerminalBox() {
        const { x, y, w, h } = { x: this._boxL, y: this._boxT, w: this._boxW, h: this._boxH };
        this._staticGroup.add(new Konva.Rect({
            x, y, width: w, height: h,
            fill: '#c8c0a0', stroke: '#908060', strokeWidth: 1.5, cornerRadius: 4,
        }));
        this._staticGroup.add(new Konva.Rect({
            x: x + 4, y: y + 4, width: w - 8, height: h - 8,
            fill: '#e8e4dc', stroke: '#b0a898', strokeWidth: 0.8, cornerRadius: 2,
        }));
        const divY = y + h * 0.52;
        this._staticGroup.add(new Konva.Line({
            points: [x + 8, divY, x + w - 8, divY],
            stroke: '#908060', strokeWidth: 3, lineCap: 'round',
        }));
    }

    _drawTerminals() {
        const R = this._termR;
        const names = ['u1','v1','w1','w2','u2','v2'];
        const labels = { u1:'U1', v1:'V1', w1:'W1', w2:'W2', u2:'U2', v2:'V2' };
        names.forEach(name => {
            const p = this._tp[name];
            const color = this._termColors[name];
            this._staticGroup.add(new Konva.Circle({
                x: p.x, y: p.y, radius: R,
                fillLinearGradientStartPoint: { x: -R, y: -R },
                fillLinearGradientEndPoint:   { x:  R, y:  R },
                fillLinearGradientColorStops: [0, '#9a8030', 0.4, '#e8c050', 0.7, '#f8d870', 1, '#9a8030'],
                stroke: '#7a6028', strokeWidth: 1.2,
            }));
            this._staticGroup.add(new Konva.Circle({
                x: p.x, y: p.y, radius: R * 0.52,
                fill: color, stroke: '#666', strokeWidth: 0.8,
            }));
            this._staticGroup.add(new Konva.Circle({
                x: p.x, y: p.y, radius: 2.5, fill: '#333',
            }));
            const fs = Math.max(11, this.width * 0.014);
            this._staticGroup.add(new Konva.Text({
                x: p.x - 12, y: p.y + R + 3,
                text: labels[name], fontSize: fs,
                fontStyle: 'bold', fill: color,
            }));
        });
    }

    /** 转子剖面（静态背景环） */
    _drawRotorStatic() {
        const cx = this._rotorCX, cy = this._rotorCY, r = this._rotorR;

        // 定子铁心环
        this._staticGroup.add(new Konva.Ring({
            x: cx, y: cy,
            innerRadius: r * 0.55, outerRadius: r * 0.95,
            fillLinearGradientStartPoint: { x: -r, y: 0 },
            fillLinearGradientEndPoint:   { x:  r, y: 0 },
            fillLinearGradientColorStops: [
                0,   '#b0b0b8', 0.3, '#c8c8d0', 0.5, '#d0d0d8', 0.7, '#c8c8d0', 1, '#b0b0b8',
            ],
            stroke: '#909098', strokeWidth: 0.8,
        }));

        // 定子齿槽（polePairs × 6 槽，U 红 / V 绿 / W 蓝，每相 2 槽/极对）
        const slotCount = this.polePairs * 6;
        const phaseColors = ['#f30101','#1dfe1d','#4f9bf9','#fa0909','#0dfb0d','#358efb'];
        const slotColors = [];
        for (let pp = 0; pp < this.polePairs; pp++) slotColors.push(...phaseColors);
        const stepAngle = Math.PI * 2 / slotCount;
        const halfWidth = stepAngle * 0.25;
        const rI = r * 0.56, rO = r * 0.63;
        for (let i = 0; i < slotCount; i++) {
            const a  = i * stepAngle;
            const a1 = a - halfWidth;
            const a2 = a + halfWidth;
            const pts = [
                cx + rI * Math.cos(a1), cy + rI * Math.sin(a1),
                cx + rO * Math.cos(a1), cy + rO * Math.sin(a1),
                cx + rO * Math.cos(a2), cy + rO * Math.sin(a2),
                cx + rI * Math.cos(a2), cy + rI * Math.sin(a2),
            ];
            this._staticGroup.add(new Konva.Line({
                points: pts, closed: true,
                fill: slotColors[i], stroke: '#606060', strokeWidth: 0.3,
            }));
        }
    }

    _drawButtons() {
        this._btnY.forEach(btn => {
            const color = btn.id === 'btnY' ? '#304080'
                       : btn.id === 'btnD' ? '#805030' : '#606060';
            this._staticGroup.add(new Konva.Rect({
                x: btn.x, y: btn.y, width: btn.w, height: btn.h,
                fill: color, stroke: '#888', strokeWidth: 1, cornerRadius: 4,
            }));
            this._staticGroup.add(new Konva.Text({
                x: btn.x, y: btn.y + 6, width: btn.w,
                text: btn.label,
                fontSize: Math.max(13, this.width * 0.017),
                fill: '#e0e0e0', align: 'center',
            }));
        });
    }

    // ═══════════════════════════════════════════
    // 动态层
    // ═══════════════════════════════════════════

    _createDynamicNodes() {
        this._createFieldGroup();
        this._createRotorGroup();
        this._createStatusTexts();
        this._createWindingDiagram();
        this._createConnText();
    }

    /** 旋转磁场：N（红）S（黑），按 polePairs 对数生成弧形磁极 */
    _createFieldGroup() {
        this._fieldGroup = new Konva.Group({
            x: this._rotorCX, y: this._rotorCY,
            rotation: 0, listening: false,
        });

        const rInner = this._rotorR * 0.69;
        const rOuter = this._rotorR * 0.85;
        const numPoles = this.polePairs * 2;
        const arcAngle = 180 / this.polePairs;

        for (let i = 0; i < numPoles; i++) {
            const isN = i % 2 === 0;
            this._fieldGroup.add(new Konva.Arc({
                x: 0, y: 0,
                innerRadius: rInner, outerRadius: rOuter,
                angle: arcAngle,
                fill: isN ? '#e03030' : '#303030',
                stroke: isN ? '#c02020' : '#202020',
                strokeWidth: 1,
                rotation: i * arcAngle,
                opacity: 0.85,
            }));
        }

        this._dynamicGroup.add(this._fieldGroup);
    }

    /** 转子旋转组 + 导条 */
    _createRotorGroup() {
        this._rotorGroup = new Konva.Group({
            x: this._rotorCX, y: this._rotorCY,
            rotation: 0, listening: false,
        });

        const r = this._rotorR * 0.50;
        // 转子铁心
        this._rotorGroup.add(new Konva.Circle({
            x: 0, y: 0, radius: r,
            fillLinearGradientStartPoint: { x: -r, y: -r },
            fillLinearGradientEndPoint:   { x:  r, y:  r },
            fillLinearGradientColorStops: [0, '#b8b8c0', 0.35, '#d0d0d8', 0.65, '#c8c8d0', 1, '#b0b0b8'],
            stroke: '#909098', strokeWidth: 1,
        }));

        // 导条（12 根金色辐条）
        const barCount = 12;
        const barR = Math.max(2, r * 0.09);
        for (let k = 0; k < barCount; k++) {
            const a  = (k / barCount) * Math.PI * 2;
            const br = r - barR - 1;
            this._rotorGroup.add(new Konva.Circle({
                x: br * Math.cos(a), y: br * Math.sin(a),
                radius: barR,
                fillLinearGradientStartPoint: { x: -barR, y: -barR },
                fillLinearGradientEndPoint:   { x:  barR, y:  barR },
                fillLinearGradientColorStops: [0, '#9a8030', 0.4, '#e8c050', 0.7, '#f8d870', 1, '#9a8030'],
                stroke: '#7a6028', strokeWidth: 0.6,
            }));
        }

        this._dynamicGroup.add(this._rotorGroup);

        // 转轴中心（覆盖在转子上方，不旋转）
        const shaftR = r * 0.20;
        this._dynamicGroup.add(new Konva.Circle({
            x: this._rotorCX, y: this._rotorCY, radius: shaftR,
            fill: '#c0c4c8', stroke: '#909898', strokeWidth: 1, listening: false,
        }));
    }

    /** 状态文字 */
    _createStatusTexts() {
        const fs  = Math.max(15, this.width * 0.016);
        const fsS = Math.max(13, this.width * 0.013); // 规格参数用小字
        const lh  = fs + 6;
        const lhS = fsS + 4;
        const x = this._dataX, y = this._dataY;

        this._statusTexts = {};
        const fields = [
            { key: 'seq',   label: '相序' },
            { key: 'slip',  label: '转差率 s' },
            { key: 'torque',label: '转矩 Te' },
            { key: 'load',  label: '负载 TL' },
            { key: 'speed', label: '转速 n' },
            { key: 'curr',  label: '电流 I' },
        ];
        fields.forEach((f, i) => {
            const t = new Konva.Text({
                x, y: y + i * lh,
                text: `${f.label}: --`,fontStyle:'bold',
                fontSize: fs, fill: '#202020', listening: false,
            });
            this._dynamicGroup.add(t);
            this._statusTexts[f.key] = t;
        });

        // 规格参数行（更小的字号 + 浅色）
        const specY = y + fields.length * lh + 20;
        this._statusTexts.tStart = new Konva.Text({
            x, y: specY,
            text: '起动转矩: -- N·m',
            fontSize: fsS, fill: '#079407', listening: false,
        });
        this._dynamicGroup.add(this._statusTexts.tStart);

        this._statusTexts.tMax = new Konva.Text({
            x, y: specY + lhS,
            text: '最大转矩: -- N·m',
            fontSize: fsS, fill: '#059205', listening: false,
        });
        this._dynamicGroup.add(this._statusTexts.tMax);

        // 额定参数行（更小的字号 + 浅色）
        const ratedY = specY + 2 * lhS + 4;
        const ratedLabels = [
            { key: 'ratedPower',   label: '额定功率' },
            { key: 'ratedSpeed',   label: '额定转速' },
            { key: 'ratedTorque',  label: '额定转矩' },
            { key: 'ratedCurrent', label: '额定电流' },
        ];
        ratedLabels.forEach((r, i) => {
            const t = new Konva.Text({
                x, y: ratedY + i * lhS,
                text: `${r.label}: --`,fontStyle:'bold',
                fontSize: fsS, fill: '#d80808', listening: false,
            });
            this._dynamicGroup.add(t);
            this._statusTexts[r.key] = t;
        });
    }

    /** 动态接线图 */
    _createWindingDiagram() {
        this._wdGroup = new Konva.Group({ listening: false });
        this._dynamicGroup.add(this._wdGroup);
    }

    /** 顶部接法标注 */
    _createConnText() {
        const fs = Math.max(12, this.width * 0.015);
        this._connLabel = new Konva.Text({
            x: this._rightL, y: this._boxT + 4,
            text: '', fontSize: fs, fontStyle: 'bold',
            fill: '#606060', listening: false,
        });
        this._dynamicGroup.add(this._connLabel);
    }

    // ═══════════════════════════════════════════
    // 转矩规格计算
    // ═══════════════════════════════════════════

    /** 从等效电路参数计算起动转矩与最大转矩 */
    _computeTorqueSpecs() {
        // 相电压：优先使用求解器实测的电机端电压 RMS，其次取 AC 源设定值，最后回退 220V
        const sysFreq = (this.sys?.voltageSolver?._systemFreq) || 50;
        const omega_sync = 2 * Math.PI * sysFreq / this.polePairs;
        const absOmega = Math.abs(omega_sync);
        const V_ph = (this._Vrms && this._Vrms > 1)
            ? this._Vrms
            : (Object.values(this.sys?.comps || {}).find(c => c.type === 'source_3p')?.vRms || 220);

        // 漏抗
        const X1 = 2 * Math.PI * sysFreq * this.Lsigma1;
        const X2 = 2 * Math.PI * sysFreq * this.Lsigma2;
        const X_total = X1 + X2;

        // ── 起动转矩（转差率 s = 1）──
        const R_start = this.R1 + this.R2;
        const Z_start_sq = R_start * R_start + X_total * X_total;
        this._T_start = absOmega > 1e-6 ? (3 * V_ph * V_ph * this.R2) / (absOmega * Z_start_sq) : 0;

        // ── 最大转矩（临界转差率）──
        const R1_sq = this.R1 * this.R1;
        const sqrt_term = Math.sqrt(R1_sq + X_total * X_total);
        this._s_max = this.R2 / sqrt_term;
        this._T_max = absOmega > 1e-6 ? (3 * V_ph * V_ph) / (2 * absOmega * (this.R1 + sqrt_term)) : 0;

        // ── 额定参数（铭牌值优先，否则由等效电路计算）──
        if (this.ratedPower !== null && this.ratedSpeed !== null) {
            // 直接使用铭牌值
            const n_N = this.ratedSpeed;
            const s_N = (1500 - n_N) / 1500;  // 同步转速 1500 rpm (50Hz/2pp)
            this._s_N = Math.max(0.001, s_N);
            this._n_rated = n_N;
            this._P_rated = this.ratedPower * 1000;   // W

            // 由 P = T·ω 反算额定转矩
            const omega_m_N = n_N * 2 * Math.PI / 60;
            this._T_rated = this._P_rated / omega_m_N;

            // 额定电流：由等效电路计算
            const R2_sN = this.R2 / this._s_N;
            const Z_N_sq = (this.R1 + R2_sN) * (this.R1 + R2_sN) + X_total * X_total;
            const I2 = V_ph / Math.sqrt(Z_N_sq);
            const Xm = 2 * Math.PI * sysFreq * this.Lm;
            const Im = V_ph / Xm;
            const Ic = V_ph / this.Rc;
            const cos_phi = (this.R1 + R2_sN) / Math.sqrt(Z_N_sq);
            const sin_phi = X_total / Math.sqrt(Z_N_sq);
            const I2a = I2 * cos_phi + Ic;
            const I2r = I2 * sin_phi + Im;
            this._I_rated = Math.sqrt(I2a * I2a + I2r * I2r);
        } else {
            const target = Z_start_sq * 1.2;
            let s_low = 0.01, s_high = 0.20;
            for (let i = 0; i < 30; i++) {
                const s_mid = (s_low + s_high) / 2;
                const R2_s = this.R2 / s_mid;
                const Z2 = (this.R1 + R2_s) * (this.R1 + R2_s) + X_total * X_total;
                const val = s_mid * Z2;
                if (val > target) s_low = s_mid;
                else s_high = s_mid;
            }
            this._s_N = (s_low + s_high) / 2;

            const n_sync = 120 * sysFreq / (2 * this.polePairs);
            this._n_rated = Math.round(n_sync * (1 - this._s_N));

            const R2_sN = this.R2 / this._s_N;
            const Z_N_sq = (this.R1 + R2_sN) * (this.R1 + R2_sN) + X_total * X_total;
            this._T_rated = (3 * V_ph * V_ph * R2_sN) / (omega_sync * Z_N_sq);

            const omega_m_N = omega_sync * (1 - this._s_N);
            this._P_rated = this._T_rated * omega_m_N;

            const I2 = V_ph / Math.sqrt(Z_N_sq);
            const Xm = 2 * Math.PI * sysFreq * this.Lm;
            const Im = V_ph / Xm;
            const Ic = V_ph / this.Rc;
            const cos_phi = (this.R1 + R2_sN) / Math.sqrt(Z_N_sq);
            const sin_phi = X_total / Math.sqrt(Z_N_sq);
            const I2a = I2 * cos_phi + Ic;
            const I2r = I2 * sin_phi + Im;
            this._I_rated = Math.sqrt(I2a * I2a + I2r * I2r);
        }
    }

    // ═══════════════════════════════════════════
    // 动态更新
    // ═══════════════════════════════════════════

    _updateDynamic() {
        const solver = this.sys?.voltageSolver;
        const getV = (port) => {
            if (!solver) return 0;
            const ci = solver.portToCluster.get(`${this.id}_wire_${port}`);
            return ci !== undefined ? (solver.nodeVoltages.get(ci) || 0) : 0;
        };
        const Vu_raw = getV('u1') - getV('u2');
        const Vv_raw = getV('v1') - getV('v2');
        const Vw_raw = getV('w1') - getV('w2');
        const Vu = Math.abs(Vu_raw);
        const Vv = Math.abs(Vv_raw);
        const Vw = Math.abs(Vw_raw);
        const hasVoltage = Vu > 15 || Vv > 15 || Vw > 15;
        const hasAllPhases = Vu > 15 && Vv > 15 && Vw > 15;

        // ── 相序检测（瞬时值法）：三相电压均有效时才更新 ──
        if (hasAllPhases && solver) {
            const seq = Vu_raw * (this._VvPrev - this._VwPrev)
                      + Vv_raw * (this._VwPrev - this._VuPrev)
                      + Vw_raw * (this._VuPrev - this._VvPrev);
            this._phaseSeq = seq >= 0 ? 1 : -1;
        } else if (!hasVoltage) {
            this._phaseSeq = 0;
        }
        // 零交叉（hasVoltage 但 !hasAllPhases）→ 保持上次 _phaseSeq 不变
        this._VuPrev = Vu_raw;
        this._VvPrev = Vv_raw;
        this._VwPrev = Vw_raw;

        // 1. 旋转磁场（相序决定方向，能耗制动时静止）
        if (hasVoltage && !this._dcBraking) {
            this._fieldAngle += this._omega_sync*4 * (this.sys?.voltageSolver?.deltaTime || 0.5e-3);
            this._fieldAngle %= 2 * Math.PI;
            this._fieldGroup.rotation(this._fieldAngle * 180 / Math.PI);
        }
        this._fieldGroup.visible(hasVoltage || this._dcBraking);

        // 2. 转子旋转（机械角度）
        const deg = (this._theta_m * 180 / Math.PI) % 360;
        this._rotorGroup.rotation(deg*4);

        // 3. 状态数据
        const rpm = this._omega_m * 60 / (2 * Math.PI);
        const speedRPM = rpm.toFixed(1);
        this.rpm = speedRPM;
        const slipPct = (this.slip * 100).toFixed(2);
        const TeVal = this._Te.toFixed(2);
        const iuA = (this._iuDisplayPrev !== undefined ? this._iuDisplayPrev : this._iuPrev).toFixed(3);
        const ivA = (this._ivDisplayPrev !== undefined ? this._ivDisplayPrev : this._ivPrev).toFixed(3);
        const iwA = (this._iwDisplayPrev !== undefined ? this._iwDisplayPrev : this._iwPrev).toFixed(3);

        const connMap = { 'Y': 'Y 星形接法', 'D': 'Δ 三角形接法', 'none': '未连接', 'custom': '自定义接法' };
        const connStr = connMap[this._connType] || '未连接';

        this._statusTexts.seq.text(`相序: ${this._phaseSeq > 0 ? '正序(UVW)' : this._phaseSeq < 0 ? '逆序(UWV)' : '无相序'}`);
        this._statusTexts.slip.text(`转差率 s: ${slipPct}%`);
        this._statusTexts.torque.text(`转矩 Te: ${TeVal} N·m`);
        this._statusTexts.load.text(`负载 TL: ${this.loadTorque.toFixed(2)} N·m`);
        this._statusTexts.speed.text(`转速 n: ${speedRPM} rpm`);
        this._statusTexts.curr.text(`电流 I: ${iuA} A`);

        this._connLabel.text(connStr);

        // 3. 转矩规格参数
        this._computeTorqueSpecs();
        this._statusTexts.tStart.text(
            `起动转矩: ${this._T_start.toFixed(1)} N·m`
        );
        this._statusTexts.tMax.text(
            `最大转矩: ${this._T_max.toFixed(1)} N·m  ` +
            `(临界转差率 ${(this._s_max * 100).toFixed(1)}%)`
        );

        // 4. 额定参数
        this._statusTexts.ratedPower.text(
            `额定功率: ${(this._P_rated / 1000).toFixed(1)} kW`
        );
        this._statusTexts.ratedSpeed.text(
            `额定转速: ${this._n_rated} rpm`
        );
        this._statusTexts.ratedTorque.text(
            `额定转矩: ${this._T_rated.toFixed(1)} N·m `
        );
        this._statusTexts.ratedCurrent.text(
            `额定电流: ${this._I_rated.toFixed(1)} A`
        );

        // 5. 拓扑 → 接线图
        this._readConnections();
        this._drawWindingDiagram();
    }

    /** 从拓扑检测接法 */
    _readConnections() {
        const ptc = this.sys.voltageSolver.portToCluster;
        const get = (name) => ptc.get(`${this.id}_wire_${name}`);

        this._jumpConn = this.sys.conns.filter(c =>
            c.type === 'wire' &&
            (c.from.startsWith(this.id) || c.to.startsWith(this.id))
        );

        const cu2 = get('u2'), cv2 = get('v2'), cw2 = get('w2');
        const cu1 = get('u1'), cv1 = get('v1'), cw1 = get('w1');

        if (cu2 !== undefined && cv2 !== undefined && cw2 !== undefined &&
            cu2 === cv2 && cv2 === cw2) {
            this._connType = 'Y';
        } else if (cu1 !== undefined && cw2 !== undefined && cu1 === cw2 &&
                   cv1 !== undefined && cu2 !== undefined && cv1 === cu2 &&
                   cw1 !== undefined && cv2 !== undefined && cw1 === cv2) {
            this._connType = 'D';
        } else if (this._jumpConn.length === 0) {
            this._connType = 'none';
        } else {
            this._connType = 'custom';
        }
    }

    /** 绘制动态接线图（接线关系由系统连线直观可见，不做额外绘制） */
    _drawWindingDiagram() {
        this._wdGroup.destroyChildren();
    }

    _extractTermName(portId) {
        const parts = portId.split('_wire_');
        if (parts.length !== 2) return null;
        const name = parts[1].toLowerCase();
        if (['u1','u2','v1','v2','w1','w2'].includes(name)) return name;
        return null;
    }

    // ═══════════════════════════════════════════
    // MNA 交互方法（由 CircuitSolver 调用）
    // ═══════════════════════════════════════════

    /** 在电路求解前更新机械状态 */
    _preSolve(dt) {
        // 机械积分（欧拉法）：使用求解器检测到的系统频率
        const sysFreq = (this.sys?.voltageSolver?._systemFreq) || 50;
        const omegaSyncNew = 2 * Math.PI * sysFreq / this.polePairs;

        // 计算反抗性负载转矩：方向始终与转速相反
        let loadT = 0;
        const absOmega = Math.abs(this._omega_m);
        if (this.loadType === 'fan') {
            loadT = this.fanK * this._omega_m * absOmega;
            this.loadTorque = Math.abs(loadT);
        } else if (absOmega > 0.001) {
            loadT = this.loadTorque * Math.sign(this._omega_m);
        }
        this._appliedLoadTorque = loadT;

        // 直流能耗制动：检测 DC24V 电源是否接至 U1/V1 且开启
        let brakeT = 0;
        this._dcBraking = false;
        const comps = Object.values(this.sys?.comps || {});
        const _dc = comps.find(c => c.type === 'source' && c.isOn);
        if (_dc && !comps.some(c => c.type === 'source_3p' && c.isOn)) {
            const _ic = (a, b) => this.sys?.isPortConnected(a, b);
            if (_ic && _ic(`${_dc.id}_wire_p`, `${this.id}_wire_u1`) && _ic(`${_dc.id}_wire_n`, `${this.id}_wire_v1`)) {
                this._dcBraking = true;
                brakeT = this._omega_m;
            }
        }
        const TeOrig = this._Te;
        const accel = (TeOrig - loadT - brakeT - this.B * this._omega_m) / this.J;
        this._omega_m += accel * dt;

        // 堵转保持：极低转速下若负载 > 电磁转矩，维持停转
        if (Math.abs(this._omega_m) < 0.5) {
            const stallLoad = this.loadType === 'fan' ? 0 : this.loadTorque;
            if (stallLoad > Math.abs(this._Te) || this._dcBraking) this._omega_m = 0;
        }

        // 堵转保护：正序时不允许反转（负载过大时停转而非逆转）
        if (this._phaseSeq > 0 && this._omega_m < 0) this._omega_m = 0;

        // 更新同步速（相序决定方向）
        this._omega_sync = omegaSyncNew * this._phaseSeq;
        if (this._dcBraking) this._omega_sync = 0;

        // 更新角度
        this._theta_m += this._omega_m * dt;
        this._theta_r = this.polePairs * this._theta_m;
        const absSync = Math.abs(this._omega_sync);
        this.slip = absSync > 0.001 ? (this._omega_sync - this._omega_m) / this._omega_sync : 1;
        // 保留正/负滑差符号，只钳位绝对值最小值
        if (Math.abs(this.slip) < 0.0001) this.slip = this.slip >= 0 ? 0.0001 : -0.0001;
    }

    /** 求解后将回读的电流存入（含限幅防止 MNA 数值发散） */
    _postSolve(iu, iv, iw) {
        const IM_MAX = 300;
        const clamp = (v) => Math.max(-IM_MAX, Math.min(IM_MAX, v));
        this._iuPrev  = clamp(iu);
        this._ivPrev  = clamp(iv);
        this._iwPrev  = clamp(iw);
        this.phaseCurrents = { u: clamp(iu), v: clamp(iv), w: clamp(iw) };
    }

    _setTorque(te) {
        this._Te = te;
    }

    /** 获取当前机械角速度 */
    getOmegaM() {
        return this._omega_m;
    }

    /** 获取电角度 */
    getThetaR() {
        return this._theta_r;
    }

    /** 获取同步角速度 */
    getOmegaSync() {
        return this._omega_sync;
    }

    // ═══════════════════════════════════════════
    // tick（20fps 视觉效果）
    // ═══════════════════════════════════════════

    tick(dt) {
        if (this._dcBraking) this._Te = -Math.abs(this._omega_m);
        this._updateDynamic();
        this.markDirty();
        this._refreshIfDirty();
    }

    // ═══════════════════════════════════════════
    // 交互绑定
    // ═══════════════════════════════════════════

    _bindInteraction() {
        this._btnY.forEach(btn => {
            const hit = new Konva.Rect({
                x: btn.x, y: btn.y, width: btn.w, height: btn.h, fill: 'transparent',
            });
            hit.on('click tap', () => this._onButtonClick(btn.id));
            hit.on('mouseenter', () => { document.body.style.cursor = 'pointer'; });
            hit.on('mouseleave', () => { document.body.style.cursor = 'default'; });
            this._interactGroup.add(hit);
        });
    }

    _onButtonClick(btnId) {
        const now = Date.now();
        if (now - this._btnClickTime < 200) return;
        this._btnClickTime = now;

        const portId = (n) => `${this.id}_wire_${n}`;

        if (btnId === 'btnClr') {
            // 手拨转子：关电源 → 清历史 → 设转速 300RPM → 阻尼加大使 ~120s 停
            const ac = Object.values(this.sys.comps || {}).find(c => c.type === 'source_3p');
            if (ac) ac.onConfigUpdate({ vRms: 220, freq: 50, isOn: false });
            // 清除电磁历史（剩磁注入不受影响，保证电压纯净）
            this._iuPrev = 0; this._ivPrev = 0; this._iwPrev = 0;
            this._magIuPrev = 0; this._magIvPrev = 0; this._magIwPrev = 0;
            this._magVuPrev = 0; this._magVvPrev = 0; this._magVwPrev = 0;
            // 拨到 300 RPM = 31.416 rad/s
            const omega = 300 * 2 * Math.PI / 60;
            this._omega_m = omega;
            // 调高阻尼：B=0.04 → 机械时间常数 J/B=3.0s sim ≈ 120s real
            //（实测额外阻尼使有效 B 约 2× 设定值，故取 B=0.04）
            this._savedB = this.B;
            this.B = 0.04;
            this._handTurnCount++;
            return;
        }

        const existing = this.sys.conns.filter(c =>
            c.type === 'wire' &&
            (c.from.startsWith(this.id) || c.to.startsWith(this.id))
        );
        existing.forEach(c => this.sys.removeConnWithHistory(c));

        const conns = btnId === 'btnY'
            ? [
                { from: portId('u2'), to: portId('v2'), type: 'wire' },
                { from: portId('u2'), to: portId('w2'), type: 'wire' },
              ]
            : [
                { from: portId('u1'), to: portId('w2'), type: 'wire' },
                { from: portId('v1'), to: portId('u2'), type: 'wire' },
                { from: portId('w1'), to: portId('v2'), type: 'wire' },
              ];

        conns.forEach(c => this.sys.addConnWithHistory(c));
    }

    // ═══════════════════════════════════════════
    // 配置
    // ═══════════════════════════════════════════

    getConfigFields() {
        return [
            { label: '位号/名称',        key: 'label',         type: 'text'   },
            { label: '定子电阻 R1 (Ω)',   key: 'R1',           type: 'number' },
            { label: '定子漏感 Lσ1 (H)',  key: 'Lsigma1',      type: 'number' },
            { label: '铁损电阻 Rc (Ω)',   key: 'Rc',           type: 'number' },
            { label: '励磁电感 Lm (H)',   key: 'Lm',           type: 'number' },
            { label: '转子电阻 R2 (Ω)',   key: 'R2',           type: 'number' },
            { label: '转子漏感 Lσ2 (H)',  key: 'Lsigma2',      type: 'number' },
            { label: '极对数',            key: 'polePairs',    type: 'number' },
            { label: '剩磁通 (Wb)',       key: 'remanenceFlux',type: 'number' },
            { label: '转动惯量 J (kg·m²)',key: 'J',            type: 'number' },
            { label: '粘滞系数 B (N·m·s)', key: 'B',           type: 'number' },
            { label: '负载转矩 (N·m)',    key: 'loadTorque',   type: 'number' },
            { label: '负载类型',          key: 'loadType',     type: 'select', options: [
                { value: 'constant', label: '恒转矩' },
                { value: 'fan',     label: '风机型' },
            ]},
        ];
    }

    onConfigUpdate(cfg) {
        if (cfg.label         !== undefined) this.label         = cfg.label;
        if (cfg.R1            !== undefined) this.R1            = parseFloat(cfg.R1);
        if (cfg.Lsigma1       !== undefined) this.Lsigma1       = parseFloat(cfg.Lsigma1);
        if (cfg.Rc            !== undefined) this.Rc            = parseFloat(cfg.Rc);
        if (cfg.Lm            !== undefined) this.Lm            = parseFloat(cfg.Lm);
        if (cfg.R2            !== undefined) this.R2            = parseFloat(cfg.R2);
        if (cfg.Lsigma2       !== undefined) this.Lsigma2       = parseFloat(cfg.Lsigma2);
        if (cfg.polePairs     !== undefined) this.polePairs     = parseInt(cfg.polePairs);
        if (cfg.remanenceFlux !== undefined) this.remanenceFlux = parseFloat(cfg.remanenceFlux);
        if (cfg.J             !== undefined) this.J             = parseFloat(cfg.J);
        if (cfg.B             !== undefined) this.B             = parseFloat(cfg.B);
        if (cfg.loadTorque    !== undefined) this.loadTorque    = parseFloat(cfg.loadTorque);
        if (cfg.loadType      !== undefined) {
            this.loadType = cfg.loadType;
            if (this.loadType === 'fan' && (!this.fanK || this.fanK === 0)) {
                this.fanK = this.ratedPower * 1000 / Math.pow(this.ratedSpeed * Math.PI / 30, 3);
            }
        }

        this._omega_sync = 2 * Math.PI * 50 / this.polePairs;
        this.config = { ...this.config, ...cfg };
        this._recalcGeometry();
        this._staticGroup.destroyChildren();
        this._dynamicGroup.destroyChildren();
        this._drawStaticParts();
        this._createDynamicNodes();
        this._refreshCache();

        // 同步工具栏 UI
        const select = document.getElementById('loadTypeSelect');
        const slider = document.getElementById('torqueSlider');
        const display = document.getElementById('torqueDisplay');
        if (select) select.value = this.loadType;
        if (slider && display) {
            if (this.loadType === 'fan') {
                slider.disabled = true;
                slider.style.opacity = '0.5';
            } else {
                slider.disabled = false;
                slider.style.opacity = '1';
                slider.value = Math.min(200, Math.round(this.loadTorque));
                display.textContent = this.loadTorque.toFixed(1) + ' N·m';
            }
        }
    }

    showContextMenu(evt) {
        const oldMenu = document.getElementById('comp-context-menu');
        if (oldMenu) oldMenu.remove();

        const menu = document.createElement('div');
        menu.id = 'comp-context-menu';
        menu.style = `
        position: fixed; top: ${evt.clientY}px; left: ${evt.clientX}px;
        background: white; border: 1px solid #ccc; border-radius: 4px;
        box-shadow: 2px 2px 10px rgba(0,0,0,0.2); z-index: 10000;
        padding: 5px 0; min-width: 120px; font-family: sans-serif; font-size: 14px;
    `;

        const createItem = (label, onClick) => {
            const item = document.createElement('div');
            item.innerText = label;
            item.style = 'padding: 8px 15px; cursor: pointer; transition: background 0.2s;';
            item.onmouseenter = () => item.style.background = '#f0f0f0';
            item.onmouseleave = () => item.style.background = 'transparent';
            item.onclick = () => {
                onClick();
                menu.remove();
            };
            return item;
        };

        menu.appendChild(createItem('向右旋转 90°', () => this.rotate(90)));
        menu.appendChild(createItem('向左旋转 90°', () => this.rotate(-90)));
        menu.appendChild(createItem('参数设置', () => this.showConfigDialog()));

        const ts = this.sys?.comps?.['ts-curve'];
        if (ts) {
            const hidden = ts.group?.isVisible?.() === false;
            menu.appendChild(createItem(
                hidden ? '显示 T-s 曲线' : '隐藏 T-s 曲线',
                () => { hidden ? ts.show() : ts.hide(); }
            ));
        }

        this.sys.container.appendChild(menu);

        const closeMenu = () => {
            menu.remove();
            window.removeEventListener('click', closeMenu);
        };
        window.addEventListener('click', closeMenu);
    }

    destroy() {
        super.destroy?.();
    }
}
