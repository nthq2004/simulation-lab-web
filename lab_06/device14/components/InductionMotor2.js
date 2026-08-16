import { BaseComponent } from './BaseComponent.js';

export class InductionMotor2 extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.width  = Math.max(160, config.width  || 200);
        this.height = Math.max(200, config.height || 260);

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
        this.addPort(this._tp.u2.x, this._tp.u2.y, 'u2', 'wire', 'p');
        this.addPort(this._tp.v2.x, this._tp.v2.y, 'v2', 'wire', 'p');
        this.addPort(this._tp.w2.x, this._tp.w2.y, 'w2', 'wire', 'p');
    }

    _recalcGeometry() {
        const W = this.width, H = this.height;

        // 顶部/底部接线柱区域（端口向定子靠近）
        const termPad = 14;
        const topTermY = 26;
        const botTermY = H - 26;

        // 转子中心
        this._rotorCX = W / 2;
        this._rotorCY = termPad + (H - termPad * 2) / 2;

        // 转子半径
        const avail = Math.min((W - 32) / 2, (H - termPad * 2 - 8) / 2);
        this._rotorR = Math.max(24, avail);

        // 接线柱间距（左右引线需要外斜，故接线柱间距大于定子锚点间距）
        const termSpan = Math.min(this._rotorR * 1.8, W * 0.56);

        this._tp = {};
        this._tp.u1 = { x: this._rotorCX - termSpan / 2, y: topTermY };
        this._tp.v1 = { x: this._rotorCX,                  y: topTermY };
        this._tp.w1 = { x: this._rotorCX + termSpan / 2, y: topTermY };
        this._tp.u2 = { x: this._rotorCX - termSpan / 2, y: botTermY };
        this._tp.v2 = { x: this._rotorCX,                  y: botTermY };
        this._tp.w2 = { x: this._rotorCX + termSpan / 2, y: botTermY };

        this._termR = 4;
        this._termColors = {
            u1: '#e03030', u2: '#e03030',
            v1: '#20a030', v2: '#20a030',
            w1: '#2050e0', w2: '#2050e0',
        };

        // 导线在定子外圆上的附着角度
        const outerR = this._rotorR * 0.95;
        const cx = this._rotorCX, cy = this._rotorCY;
        const wireAngle = {
            u1: -2 * Math.PI / 3,
            v1: -Math.PI / 2,
            w1: -Math.PI / 3,
            u2:  2 * Math.PI / 3,
            v2:  Math.PI / 2,
            w2:  Math.PI / 3,
        };

        // 计算每条导线的路径点
        this._wirePaths = {};
        ['u1','v1','w1','u2','v2','w2'].forEach(name => {
            const ang = wireAngle[name];
            const ax = cx + outerR * Math.cos(ang);
            const ay = cy + outerR * Math.sin(ang);
            const tp = this._tp[name];
            const isTop = name[1] === '1';

            if (name === 'v1' || name === 'v2') {
                // 中间：直线
                this._wirePaths[name] = [ax, ay, tp.x, tp.y];
            } else {
                // 左右：短斜线 → 短垂直线
                const cornerX = tp.x;
                const cornerY = isTop ? ay - 3 : ay + 3;
                this._wirePaths[name] = [ax, ay, cornerX, cornerY, tp.x, tp.y];
            }
        });
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
        this.loadType = config.loadType || 'constant';
        this.fanK = config.fanK || 0;
        this._appliedLoadTorque = 0;
        this.simpleModel = true;

        this.ratedPower       = config.ratedPower       !== undefined ? config.ratedPower       : null;
        this.ratedSpeed       = config.ratedSpeed       !== undefined ? config.ratedSpeed       : null;

        this._omega_m     = 0;
        this._theta_m     = 0;
        this._theta_r     = 0;
        this._Te          = 0;
        this._omega_sync  = 2 * Math.PI * 50 / this.polePairs;
        this.slip         = 1;
        this._fieldAngle  = 0;

        this._phaseSeq    = 1;
        this._dcBraking   = false;
        this._VuPrev      = 0;
        this._VvPrev      = 0;
        this._VwPrev      = 0;

        this._iuPrev  = 0;
        this._ivPrev  = 0;
        this._iwPrev  = 0;

        this._magVuPrev = 0;
        this._magVvPrev = 0;
        this._magVwPrev = 0;
        this._magIuPrev = 0;
        this._magIvPrev = 0;
        this._magIwPrev = 0;

        this.phaseCurrents = { u: 0, v: 0, w: 0 };
        this.rpm = 0;
    }

    _init() {
        this._drawStaticParts();
        this._createDynamicNodes();
    }

    // ═══════════════════════════════════════════
    // 静态绘制
    // ═══════════════════════════════════════════

    _drawStaticParts() {
        this._drawStatorCore();
        this._drawTerminals();
        this._drawWires();
    }

    _drawStatorCore() {
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

        // 定子齿槽
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

    _drawTerminals() {
        const R = this._termR;
        const names = ['u1','v1','w1','u2','v2','w2'];
        const labels = { u1:'U1', v1:'V1', w1:'W1', u2:'U2', v2:'V2', w2:'W2' };
        names.forEach(name => {
            const p = this._tp[name];
            const color = this._termColors[name];
            this._staticGroup.add(new Konva.Circle({
                x: p.x, y: p.y, radius: R,
                fillLinearGradientStartPoint: { x: -R, y: -R },
                fillLinearGradientEndPoint:   { x:  R, y:  R },
                fillLinearGradientColorStops: [0, '#9a8030', 0.4, '#e8c050', 0.7, '#f8d870', 1, '#9a8030'],
                stroke: '#7a6028', strokeWidth: 1,
            }));
            this._staticGroup.add(new Konva.Circle({
                x: p.x, y: p.y, radius: R * 0.48,
                fill: color, stroke: '#666', strokeWidth: 0.5,
            }));
            this._staticGroup.add(new Konva.Circle({
                x: p.x, y: p.y, radius: 1.5, fill: '#333',
            }));
            this._staticGroup.add(new Konva.Text({
                x: p.x - R - 28, y: p.y - 8,
                text: labels[name], fontSize: 16,
                fontStyle: 'bold', fill: color,
            }));
        });
    }

    _drawWires() {
        const names = ['u1','v1','w1','u2','v2','w2'];
        names.forEach(name => {
            const pts = this._wirePaths[name];
            const color = this._termColors[name];
            this._staticGroup.add(new Konva.Line({
                points: pts,
                stroke: color, strokeWidth: 4.5,
                lineCap: 'round',
            }));
        });
    }

    // ═══════════════════════════════════════════
    // 动态层
    // ═══════════════════════════════════════════

    _createDynamicNodes() {
        this._createFieldGroup();
        this._createRotorGroup();
    }

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

    _createRotorGroup() {
        this._rotorGroup = new Konva.Group({
            x: this._rotorCX, y: this._rotorCY,
            rotation: 0, listening: false,
        });

        const r = this._rotorR * 0.50;
        this._rotorGroup.add(new Konva.Circle({
            x: 0, y: 0, radius: r,
            fillLinearGradientStartPoint: { x: -r, y: -r },
            fillLinearGradientEndPoint:   { x:  r, y:  r },
            fillLinearGradientColorStops: [0, '#b8b8c0', 0.35, '#d0d0d8', 0.65, '#c8c8d0', 1, '#b0b0b8'],
            stroke: '#909098', strokeWidth: 1,
        }));

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

        const shaftR = r * 0.20;
        this._dynamicGroup.add(new Konva.Circle({
            x: this._rotorCX, y: this._rotorCY, radius: shaftR,
            fill: '#c0c4c8', stroke: '#909898', strokeWidth: 1, listening: false,
        }));
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

        if (hasAllPhases && solver) {
            const seq = Vu_raw * (this._VvPrev - this._VwPrev)
                      + Vv_raw * (this._VwPrev - this._VuPrev)
                      + Vw_raw * (this._VuPrev - this._VvPrev);
            this._phaseSeq = seq >= 0 ? 1 : -1;
        } else if (!hasVoltage) {
            this._phaseSeq = 0;
        }
        this._VuPrev = Vu_raw;
        this._VvPrev = Vv_raw;
        this._VwPrev = Vw_raw;

        if (hasVoltage && !this._dcBraking) {
            this._fieldAngle += this._omega_sync * 2 * (solver?.deltaTime || 0.5e-3);
            this._fieldAngle %= 2 * Math.PI;
            this._fieldGroup.rotation(this._fieldAngle * 180 / Math.PI);
        }
        this._fieldGroup.visible(hasVoltage || this._dcBraking);

        const deg = (this._theta_m * 180 / Math.PI) % 360;
        this._rotorGroup.rotation(deg * 2);
    }

    // ═══════════════════════════════════════════
    // 转矩规格计算
    // ═══════════════════════════════════════════

    _computeTorqueSpecs() {
        const sysFreq = (this.sys?.voltageSolver?._systemFreq) || 50;
        const omega_sync = 2 * Math.PI * sysFreq / this.polePairs;
        const absOmega = Math.abs(omega_sync);
        const V_ph = (this._Vrms && this._Vrms > 1)
            ? this._Vrms
            : (Object.values(this.sys?.comps || {}).find(c => c.type === 'source_3p')?.vRms || 220);

        const X1 = 2 * Math.PI * sysFreq * this.Lsigma1;
        const X2 = 2 * Math.PI * sysFreq * this.Lsigma2;
        const X_total = X1 + X2;

        const R_start = this.R1 + this.R2;
        const Z_start_sq = R_start * R_start + X_total * X_total;
        this._T_start = absOmega > 1e-6 ? (3 * V_ph * V_ph * this.R2) / (absOmega * Z_start_sq) : 0;

        const R1_sq = this.R1 * this.R1;
        const sqrt_term = Math.sqrt(R1_sq + X_total * X_total);
        this._s_max = this.R2 / sqrt_term;
        this._T_max = absOmega > 1e-6 ? (3 * V_ph * V_ph) / (2 * absOmega * (this.R1 + sqrt_term)) : 0;

        if (this.ratedPower !== null && this.ratedSpeed !== null) {
            const n_N = this.ratedSpeed;
            const s_N = (1500 - n_N) / 1500;
            this._s_N = Math.max(0.001, s_N);
            this._n_rated = n_N;
            this._P_rated = this.ratedPower * 1000;
            const omega_m_N = n_N * 2 * Math.PI / 60;
            this._T_rated = this._P_rated / omega_m_N;
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
    // MNA 求解器接口
    // ═══════════════════════════════════════════

    _preSolve(dt) {
        const sysFreq = (this.sys?.voltageSolver?._systemFreq) || 50;
        const omegaSyncNew = 2 * Math.PI * sysFreq / this.polePairs;

        let loadT = 0;
        const absOmega = Math.abs(this._omega_m);
        if (this.loadType === 'fan') {
            loadT = this.fanK * this._omega_m * absOmega;
            this.loadTorque = Math.abs(loadT);
        } else if (absOmega > 0.001) {
            loadT = this.loadTorque * Math.sign(this._omega_m);
        }
        this._appliedLoadTorque = loadT;

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

        if (Math.abs(this._omega_m) < 0.5) {
            const stallLoad = this.loadType === 'fan' ? 0 : this.loadTorque;
            if (stallLoad > Math.abs(this._Te) || this._dcBraking) this._omega_m = 0;
        }

        if (this._phaseSeq > 0 && this._omega_m < 0) this._omega_m = 0;

        this._omega_sync = omegaSyncNew * this._phaseSeq;
        if (this._dcBraking) this._omega_sync = 0;

        this._theta_m += this._omega_m * dt;
        this._theta_r = this.polePairs * this._theta_m;
        const absSync = Math.abs(this._omega_sync);
        this.slip = absSync > 0.001 ? (this._omega_sync - this._omega_m) / this._omega_sync : 1;
        if (Math.abs(this.slip) < 0.0001) this.slip = this.slip >= 0 ? 0.0001 : -0.0001;
        this.rpm = this._omega_m * 60 / (2 * Math.PI);
    }

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

    getOmegaM() {
        return this._omega_m;
    }

    getThetaR() {
        return this._theta_r;
    }

    getOmegaSync() {
        return this._omega_sync;
    }

    // ═══════════════════════════════════════════
    // tick
    // ═══════════════════════════════════════════

    tick(dt) {
        if (this._dcBraking) this._Te = -Math.abs(this._omega_m);
        this._updateDynamic();
        this.markDirty();
        this._refreshIfDirty();
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
