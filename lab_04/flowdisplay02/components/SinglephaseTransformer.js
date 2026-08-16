import { BaseComponent } from './BaseComponent.js';

/**
 * 单相变压器仿真组件
 * （Single-Phase Transformer）
 *
 * ── 工作原理 ──────────────────────────────────────────────────
 *
 *  单相变压器基于法拉第电磁感应定律工作：
 *
 *  1. 主磁通建立（铁芯耦合）：
 *     原绕组通入交流电压 V₁，产生励磁电流 i₀
 *     → 在铁芯中建立交变磁通 Φ = Φ_m × sin(ωt)
 *
 *  2. 电动势方程：
 *     原绕组感应电动势：E₁ = 4.44 × f × N₁ × Φ_m
 *     副绕组感应电动势：E₂ = 4.44 × f × N₂ × Φ_m
 *
 *  3. 变比关系：
 *     k = N₁/N₂ = E₁/E₂ ≈ V₁/V₂（空载时）
 *     负载电流变比：I₁/I₂ ≈ N₂/N₁ = 1/k
 *
 *  4. 理想变压器方程组：
 *     V₂ = V₁ × N₂/N₁（电压变换）
 *     I₁ × N₁ = I₂ × N₂（安匝平衡，磁通势守恒）
 *     S₁ ≈ S₂（视在功率近似守恒，忽略损耗）
 *
 *  5. 实际变压器损耗：
 *     铁芯损耗：P_fe = 涡流损耗 + 磁滞损耗 ∝ f × B²
 *     铜线损耗：P_cu = I₁² × R₁ + I₂² × R₂
 *     效率：η = P₂/(P₂ + P_fe + P_cu)
 *
 * ── 等效电路参数 ──────────────────────────────────────────────
 *  R₁   — 原绕组电阻（Ω）
 *  X₁   — 原绕组漏抗（Ω）
 *  R₂'  — 副绕组电阻（折算到原边，Ω）
 *  X₂'  — 副绕组漏抗（折算到原边，Ω）
 *  R_m  — 励磁电阻（模拟铁损）
 *  X_m  — 励磁感抗
 *
 * ── 组件结构 ──────────────────────────────────────────────────
 *  ① 铁芯（叠片铁芯，E-I 型或环形）
 *     - 主铁芯柱（中央，蓝灰色叠片纹理）
 *     - 上下轭铁（闭合磁路）
 *  ② 原绕组（左侧，N₁ 匝，橙色线圈）
 *  ③ 副绕组（右侧，N₂ 匝，蓝色线圈）
 *  ④ 磁通动画（铁芯内部磁力线流动）
 *  ⑤ 漏磁通动画（绕组周围散漏磁场）
 *  ⑥ 电压/电流波形（原副边实时波形）
 *  ⑦ 等效电路图（小型示意）
 *  ⑧ 仪表 LCD（V₁、V₂、I₁、I₂、P、η）
 *  ⑨ 负载调节（阻性/感性/容性负载）
 *
 * ── 端口 ─────────────────────────────────────────────────────
 *  wire_v1_p — 原边正极（V₁+）
 *  wire_v1_n — 原边负极（V₁−）
 *  wire_v2_p — 副边正极（V₂+）
 *  wire_v2_n — 副边负极（V₂−）
 */
export class SinglePhaseTransformer extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.width  = Math.max(420, config.width  || 500);
        this.height = Math.max(320, config.height || 380);

        this.type    = 'single_phase_xfmr';
        this.special = 'none';
        this.cache   = 'fixed';

        this._initGroups();
        // ── 额定参数 ──
        this.ratedKVA   = config.ratedKVA   || 5;       // kVA
        this.V1rated    = config.V1rated    || 220;     // 原边额定电压 V
        this.V2rated    = config.V2rated    || 110;     // 副边额定电压 V
        this.N1         = config.N1         || 200;     // 原边匝数
        this.frequency  = config.frequency  || 50;      // 频率 Hz
        this.R1         = config.R1         || 0.05;    // 原边电阻 Ω（%）
        this.X1         = config.X1         || 0.03;    // 原边漏抗 Ω（%）
        this.R2         = config.R2         || 0.05;    // 副边电阻（折算）Ω
        this.X2         = config.X2         || 0.03;    // 副边漏抗（折算）Ω
        this.Rm         = config.Rm         || 500;     // 励磁电阻 Ω
        this.Xm         = config.Xm         || 200;     // 励磁感抗 Ω
        this.efficiency0= config.efficiency0|| 98;      // 空载效率基准 %

        // 变比
        this.k = this.N1 / (this.N2 || Math.round(this.N1 * this.V2rated / this.V1rated));
        this.N2 = Math.round(this.N1 / this.k);

        // ── 负载参数 ──
        this.loadR      = config.loadR    || 0;       // 负载电阻 Ω（0=空载）
        this._manualLoadR = config.loadR  || 0;
        this.loadType   = config.loadType || 'R';     // 'R' | 'RL' | 'RC'
        this.loadPF     = config.loadPF   || 1.0;     // 负载功率因数（带RL时）
        this.V1apply    = config.V1apply  || this.V1rated;  // 施加电压 V

        // ── 状态 ──
        this.V1         = 0;    // 原边电压有效值 V
        this.V2         = 0;    // 副边电压有效值 V
        this.I1         = 0;    // 原边电流有效值 A
        this.I2         = 0;    // 副边电流有效值 A
        this.I0         = 0;    // 励磁电流 A
        this.S1         = 0;    // 原边视在功率 VA
        this.S2         = 0;    // 副边有功功率 W
        this.P_fe       = 0;    // 铁损 W
        this.P_cu       = 0;    // 铜损 W
        this.eta        = 0;    // 效率 %
        this.Phi_m      = 0;    // 最大磁通 Wb
        this.loadPct    = 0;    // 负载率 %

        // ── 动画 ──
        this._time      = 0;
        this._fluxPhase = 0;
        this._phase     = 0;

        // ── 波形缓冲（四路）──
        this._wavLen    = 240;
        this._wavV1     = new Float32Array(this._wavLen).fill(0);
        this._wavV2     = new Float32Array(this._wavLen).fill(0);
        this._wavI1     = new Float32Array(this._wavLen).fill(0);
        this._wavI2     = new Float32Array(this._wavLen).fill(0);
        this._wavAcc    = 0;

        // ── 几何布局 ──
        // 铁芯主体（中央）
        this._coreX  = Math.round(this.width * 0.20);
        this._coreY  = Math.round(this.height * 0.12);
        this._coreW  = Math.round(this.width  * 0.60);
        this._coreH  = Math.round(this.height * 0.64);

        // 铁芯柱参数
        this._yoke   = Math.round(this._coreH * 0.18);  // 轭铁高度
        this._legW   = Math.round(this._coreW * 0.20);  // 铁芯柱宽
        this._legH   = this._coreH - this._yoke * 2;     // 铁芯柱高
        this._legY   = this._coreY + this._yoke;
        this._leftLegX = this._coreX;
        this._rightLegX= this._coreX + this._coreW - this._legW;
        this._midLegX  = this._coreX + (this._coreW - this._legW) / 2;  // 中央柱

        // 绕组位置（缠绕在中央柱）
        this._windingCX = this._midLegX + this._legW/2;
        this._windingCY = this._coreY + this._coreH/2;

        // 仪表 LCD（右侧）
        this._lcdX   = this._coreX + this._coreW + 16;
        this._lcdY   = this._coreY;
        this._lcdW   = this.width - this._lcdX - 8;
        this._lcdH   = Math.round(this.height * 0.60);

        // 波形区（底部）
        this._wavX   = 6;
        this._wavY   = Math.round(this.height * 0.76);
        this._wavW   = this.width - 12;
        this._wavH   = this.height - this._wavY - 6;

        this.knobs   = {};

        this.config = {
            id: this.id, V1rated: this.V1rated, V2rated: this.V2rated,
            N1: this.N1, N2: this.N2, ratedKVA: this.ratedKVA,
        };

        this._init();

        this.addPort(this._coreX - 22, this._windingCY - 18, 'v1p', 'wire', 'p');
        this.addPort(this._coreX - 22, this._windingCY + 18, 'v1n', 'wire');
        this.addPort(this._rightLegX + this._legW + 10, this._windingCY - 18, 'v2p', 'wire', 'p');
        this.addPort(this._rightLegX + this._legW + 10, this._windingCY + 18, 'v2n', 'wire' );
    }

    // ═══════════════════════════════════════════
    _init() {
        this._drawLabel();
        this._drawCore();
        this._drawFluxLayer();
        this._drawLeakageFluxLayer();
        this._drawWindings();
        this._drawCoreLaminations();
        this._drawEquivCircuit();
        this._drawInstrHead();
        this._drawLCD();
        this._drawKnobs();
        this._drawWaveform();
        this._drawLoadPanel();
        this._setupDrag();
        
    }

    _drawLabel() {
        this._staticGroup.add(new Konva.Text({
            x: 0, y: -22, width: this.width,
            text: `单相变压器（${this.V1rated}V/${this.V2rated}V  ${this.ratedKVA}kVA）`,
            fontSize: 12.5, fontStyle: 'bold', fill: '#1a2634', align: 'center',
        }));
    }

    // ── 铁芯（E-I 型叠片铁芯）───────────────
    _drawCore() {
        const cx = this._coreX, cy = this._coreY, cw = this._coreW, ch = this._coreH;
        const yk = this._yoke, lw = this._legW, lh = this._legH;
        const lly = this._legY;

        const coreCol  = '#546e7a';
        const coreEdge = '#37474f';

        // 上轭铁
        const topYoke = new Konva.Rect({ x: cx, y: cy, width: cw, height: yk, fill: coreCol, stroke: coreEdge, strokeWidth: 1.5 });
        // 下轭铁
        const botYoke = new Konva.Rect({ x: cx, y: cy+ch-yk, width: cw, height: yk, fill: coreCol, stroke: coreEdge, strokeWidth: 1.5 });
        // 左腿
        const leftLeg = new Konva.Rect({ x: cx, y: lly, width: lw, height: lh, fill: coreCol, stroke: coreEdge, strokeWidth: 1.5 });
        // 右腿
        const rightLeg= new Konva.Rect({ x: cx+cw-lw, y: lly, width: lw, height: lh, fill: coreCol, stroke: coreEdge, strokeWidth: 1.5 });
        // 中心柱（绕组所在）
        this._midLegRect = new Konva.Rect({ x: this._midLegX, y: lly, width: lw, height: lh, fill: '#607d8b', stroke: coreEdge, strokeWidth: 1.5 });

        // 轭铁高光
        this._staticGroup.add(new Konva.Rect({ x: cx+2, y: cy+2, width: cw-4, height: 4, fill: 'rgba(255,255,255,0.12)', cornerRadius: [1,1,0,0] }));
        this._staticGroup.add(new Konva.Rect({ x: cx+2, y: cy+ch-yk+2, width: cw-4, height: 4, fill: 'rgba(255,255,255,0.08)' }));

        // 铁芯标注
        this._staticGroup.add(new Konva.Text({ x: cx+lw+4, y: lly+lh/2-6, text: '铁芯', fontSize: 9, fontStyle: 'bold', fill: 'rgba(255,255,255,0.3)', align: 'center', width: cw-lw*3 }));

        this._staticGroup.add(topYoke, botYoke, leftLeg, rightLeg, this._midLegRect);
    }

    // ── 叠片纹理（铁芯表面装饰）─────────────
    _drawCoreLaminations() {
        const cx = this._coreX, cy = this._coreY, cw = this._coreW, ch = this._coreH;
        const yk = this._yoke, lw = this._legW, lh = this._legH, lly = this._legY;

        // 上轭铁叠片纹
        for (let i = 2; i < yk-1; i += 3) {
            this._staticGroup.add(new Konva.Line({ points: [cx+2, cy+i, cx+cw-2, cy+i], stroke: 'rgba(0,0,0,0.15)', strokeWidth: 0.7 }));
        }
        // 下轭铁叠片纹
        for (let i = 2; i < yk-1; i += 3) {
            this._staticGroup.add(new Konva.Line({ points: [cx+2, cy+ch-yk+i, cx+cw-2, cy+ch-yk+i], stroke: 'rgba(0,0,0,0.15)', strokeWidth: 0.7 }));
        }
        // 左腿叠片纹
        for (let i = 2; i < lh-1; i += 3) {
            this._staticGroup.add(new Konva.Line({ points: [cx+2, lly+i, cx+lw-2, lly+i], stroke: 'rgba(0,0,0,0.15)', strokeWidth: 0.7 }));
        }
        // 右腿叠片纹
        for (let i = 2; i < lh-1; i += 3) {
            this._staticGroup.add(new Konva.Line({ points: [cx+cw-lw+2, lly+i, cx+cw-2, lly+i], stroke: 'rgba(0,0,0,0.15)', strokeWidth: 0.7 }));
        }
        // 中心柱叠片纹
        for (let i = 2; i < lh-1; i += 3) {
            this._staticGroup.add(new Konva.Line({ points: [this._midLegX+2, lly+i, this._midLegX+this._legW-2, lly+i], stroke: 'rgba(0,0,0,0.18)', strokeWidth: 0.7 }));
        }
    }

    // ── 主磁通动画层 ──────────────────────────
    _drawFluxLayer() {
        this._fluxGroup = new Konva.Group();
        this._staticGroup.add(this._fluxGroup);
    }

    // ── 漏磁通动画层 ──────────────────────────
    _drawLeakageFluxLayer() {
        this._leakGroup = new Konva.Group();
        this._staticGroup.add(this._leakGroup);
    }

    // ── 原副边绕组 ────────────────────────────
    _drawWindings() {
        const midX = this._windingCX, midY = this._windingCY;
        const legH = this._legH, legW = this._legW;
        const legY = this._legY;
        const coilH= Math.round(legH * 0.80);
        const coilY= legY + (legH - coilH) / 2;

        // ── 原绕组（左侧缠绕，橙色 N₁ 匝）──
        const n1turns = Math.min(24, Math.round(this.N1 / 10));  // 显示匝数（简化）
        const t1step  = coilH / n1turns;
        const w1X1    = this._leftLegX - 16;
        const w1X2    = this._leftLegX;
        this._priCoils = [];
        for (let i = 0; i < n1turns; i++) {
            const ty = coilY + i * t1step;
            const col = i % 2 === 0 ? '#ff8f00' : '#ffa726';
            const coil = new Konva.Line({
                points: [w1X1, ty, w1X2, ty, w1X2, ty+t1step*0.85, w1X1, ty+t1step*0.85, w1X1, ty+t1step],
                stroke: col, strokeWidth: 3.5, lineCap: 'round', lineJoin: 'round', opacity: 0.85,
            });
            this._priCoils.push(coil);
            this._staticGroup.add(coil);
        }
        // 原绕组引线
        this._staticGroup.add(new Konva.Line({ points: [w1X1, coilY, w1X1-12, coilY, w1X1-12, midY-18], stroke: '#ff8f00', strokeWidth: 2, lineCap: 'round' }));
        this._staticGroup.add(new Konva.Line({ points: [w1X1, coilY+coilH, w1X1-12, coilY+coilH, w1X1-12, midY+18], stroke: '#ff8f00', strokeWidth: 2, lineCap: 'round' }));
        // 端子螺栓
        this._staticGroup.add(new Konva.Circle({ x: w1X1-12, y: midY-18, radius: 4.5, fill: '#37474f', stroke: '#263238', strokeWidth: 1 }));
        this._staticGroup.add(new Konva.Circle({ x: w1X1-12, y: midY+18, radius: 4.5, fill: '#37474f', stroke: '#263238', strokeWidth: 1 }));
        // 原绕组标注
        this._staticGroup.add(new Konva.Text({ x: w1X1-32, y: coilY-18, text: `N₁=${this.N1}`, fontSize: 9, fontStyle: 'bold', fill: '#ff8f00' }));
        this._staticGroup.add(new Konva.Text({ x: w1X1-28, y: coilY+coilH+4, text: '原边', fontSize: 8.5, fill: '#ff8f00' }));

        // ── 副绕组（右侧缠绕，蓝色 N₂ 匝）──
        const n2turns = Math.min(24, Math.round(this.N2 / 10));
        const t2step  = coilH / n2turns;
        const w2X1    = this._rightLegX + legW;
        const w2X2    = this._rightLegX + legW + 16;
        this._secCoils = [];
        for (let i = 0; i < n2turns; i++) {
            const ty = coilY + i * t2step;
            const col = i % 2 === 0 ? '#1565c0' : '#1e88e5';
            const coil = new Konva.Line({
                points: [w2X1, ty, w2X2, ty, w2X2, ty+t2step*0.85, w2X1, ty+t2step*0.85, w2X1, ty+t2step],
                stroke: col, strokeWidth: 3.5, lineCap: 'round', lineJoin: 'round', opacity: 0.85,
            });
            this._secCoils.push(coil);
            this._staticGroup.add(coil);
        }
        // 副绕组引线
        this._staticGroup.add(new Konva.Line({ points: [w2X2, coilY, w2X2+12, coilY, w2X2+12, midY-18], stroke: '#42a5f5', strokeWidth: 2, lineCap: 'round' }));
        this._staticGroup.add(new Konva.Line({ points: [w2X2, coilY+coilH, w2X2+12, coilY+coilH, w2X2+12, midY+18], stroke: '#42a5f5', strokeWidth: 2, lineCap: 'round' }));
        // 端子螺栓
        this._staticGroup.add(new Konva.Circle({ x: w2X2+12, y: midY-18, radius: 4.5, fill: '#37474f', stroke: '#263238', strokeWidth: 1 }));
        this._staticGroup.add(new Konva.Circle({ x: w2X2+12, y: midY+18, radius: 4.5, fill: '#37474f', stroke: '#263238', strokeWidth: 1 }));
        // 副绕组标注
        this._staticGroup.add(new Konva.Text({ x: w2X2+16, y: coilY-18, text: `N₂=${this.N2}`, fontSize: 9, fontStyle: 'bold', fill: '#42a5f5' }));
        this._staticGroup.add(new Konva.Text({ x: w2X2+16, y: coilY+coilH+4, text: '副边', fontSize: 8.5, fill: '#42a5f5' }));

        this._w1X1 = w1X1; this._w2X2 = w2X2;
        this._coilY = coilY; this._coilH = coilH;
        this._priCurrentGroup = new Konva.Group();
        this._secCurrentGroup = new Konva.Group();
        this._staticGroup.add(this._priCurrentGroup, this._secCurrentGroup);
    }

    // ── 等效电路示意图（铁芯窗口内）──────────
    _drawEquivCircuit() {
        const wx = this._midLegX + 4, wy = this._legY + this._legH * 0.28;
        const ww = this._legW - 8;

        // 等效电路小图（极简）
        const bg = new Konva.Rect({ x: wx, y: wy, width: ww, height: Math.round(this._legH*0.44), fill: 'rgba(0,0,0,0.3)', cornerRadius: 2 });
        this._staticGroup.add(bg);

        const cx2 = wx + ww/2, cy2 = wy + this._legH*0.10;
        // 磁通符号 Φ
        this._staticGroup.add(new Konva.Text({ x: cx2-8, y: cy2, text: 'Φ', fontSize: 13, fontStyle: 'bold', fill: 'rgba(79,195,247,0.6)' }));
        this._phiLabel = new Konva.Text({ x: cx2-18, y: cy2+15, width: 36, text: '0 mWb', fontSize: 7.5, fontFamily: 'Courier New, monospace', fill: 'rgba(79,195,247,0.5)', align: 'center' });
        // 变比
        this._staticGroup.add(new Konva.Text({ x: cx2-18, y: cy2+28, width: 36, text: `k=${this.k.toFixed(2)}`, fontSize: 8, fontFamily: 'Courier New, monospace', fill: 'rgba(255,255,255,0.35)', align: 'center' }));
        // 频率
        this._staticGroup.add(new Konva.Text({ x: cx2-18, y: cy2+40, width: 36, text: `${this.frequency}Hz`, fontSize: 8, fontFamily: 'Courier New, monospace', fill: 'rgba(255,255,255,0.25)', align: 'center' }));

        this._staticGroup.add(this._phiLabel);
    }

    // ── 仪表头 ────────────────────────────────
    _drawInstrHead() {
        const hx = this._lcdX, hy = this._lcdY, hw = this._lcdW;

        const jBox = new Konva.Rect({ x: hx, y: hy, width: hw, height: 44, fill: '#cfd8dc', stroke: '#90a4ae', strokeWidth: 1.5, cornerRadius: [5,5,0,0] });
        for (let i = 0; i < 3; i++) this._staticGroup.add(new Konva.Line({ points: [hx, hy+6+i*10, hx+hw, hy+6+i*10], stroke: 'rgba(255,255,255,0.14)', strokeWidth: 0.8 }));
        const plate = new Konva.Rect({ x: hx+7, y: hy+4, width: hw-14, height: 27, fill: '#eceff1', stroke: '#b0bec5', strokeWidth: 0.5, cornerRadius: 2 });
        this._idText = new Konva.Text({ x: hx+7, y: hy+7, width: hw-14, text: this.id || 'T-01', fontSize: 9, fontStyle: 'bold', fill: '#263238', align: 'center' });
        this._staticGroup.add(new Konva.Text({ x: hx+7, y: hy+17, width: hw-14, text: `${this.V1rated}/${this.V2rated}V`, fontSize: 7, fill: '#78909c', align: 'center' }));
        this._staticGroup.add(new Konva.Text({ x: hx+7, y: hy+27, width: hw-14, text: `${this.ratedKVA}kVA  ${this.frequency}Hz`, fontSize: 7, fill: '#90a4ae', align: 'center' }));
        const lcap = new Konva.Rect({ x: hx, y: hy+3, width: 9, height: 40, fill: '#b0bec5', cornerRadius: [2,0,0,2] });
        const rcap = new Konva.Rect({ x: hx+hw-9, y: hy+3, width: 9, height: 40, fill: '#b0bec5', cornerRadius: [0,2,2,0] });
        const body = new Konva.Rect({ x: hx, y: hy+44, width: hw, height: this._lcdH-44, fill: '#1e2a36', stroke: '#0d1520', strokeWidth: 1.5, cornerRadius: [0,0,4,4] });
        this._staticGroup.add(jBox, plate, lcap, rcap, this._idText, body);
    }

    // ── 圆形 LCD ──────────────────────────────
    _drawLCD() {
        const hx = this._lcdX, hw = this._lcdW;
        const lcy = this._lcdY + 44 + (this._lcdH - 44) * 0.48;
        const lcx = hx + hw / 2;
        const R   = Math.min(hw * 0.40, 42);
        this._lcCX = lcx; this._lcCY = lcy; this._lcR = R;

        this._staticGroup.add(new Konva.Circle({ x: lcx, y: lcy, radius: R+4, fill: '#0d1520', stroke: '#1a252f', strokeWidth: 1 }));
        const ring = new Konva.Circle({ x: lcx, y: lcy, radius: R+2, fill: '#001040', stroke: '#1a3a8a', strokeWidth: 2.5 });
        this._lcdBg = new Konva.Circle({ x: lcx, y: lcy, radius: R, fill: '#020c14' });
        this._loadArc = new Konva.Arc({ x: lcx, y: lcy, innerRadius: R-5, outerRadius: R-3, angle: 0, fill: '#4dd0e1', rotation: -90 });

        this._lcdMain  = new Konva.Text({ x: lcx-R+4, y: lcy-R*.40, width:(R-4)*2, text:'0',      fontSize:R*.44, fontFamily:'Courier New, monospace', fontStyle:'bold', fill:'#4dd0e1', align:'center' });
        this._lcdUnit  = new Konva.Text({ x: lcx-R+4, y: lcy+R*.10, width:(R-4)*2, text:'%',      fontSize:R*.16, fill:'#001040', align:'center' });
        this._lcdEta   = new Konva.Text({ x: lcx-R+4, y: lcy+R*.28, width:(R-4)*2, text:'η=--',   fontSize:R*.13, fontFamily:'Courier New, monospace', fill:'#37474f', align:'center' });
        this._lcdV1    = new Konva.Text({ x: lcx-R+4, y: lcy-R*.62, width:(R-4)*2, text:'V₁=--',  fontSize:R*.12, fontFamily:'Courier New, monospace', fill:'#ff8f00', align:'center' });
        this._lcdV2    = new Konva.Text({ x: lcx-R+4, y: lcy+R*.46, width:(R-4)*2, text:'V₂=--',  fontSize:R*.12, fontFamily:'Courier New, monospace', fill:'#42a5f5', align:'center' });

        this._staticGroup.add(ring, this._lcdBg, this._loadArc, this._lcdMain, this._lcdUnit, this._lcdEta, this._lcdV1, this._lcdV2);
    }

    // ── 旋钮（施加电压调节）──────────────────
    _drawKnobs() {
        const hx = this._lcdX, hw = this._lcdW;
        const kx = hx + hw/2, ky = this._lcCY + this._lcR + 16;

        const base = new Konva.Circle({ x: kx, y: ky, radius: 18, fill: '#263238', stroke: '#1a252f', strokeWidth: 1.5 });
        this._knobRotor = new Konva.Group({ x: kx, y: ky });
        this._knobRotor.add(
            new Konva.Circle({ radius: 14, fill: '#37474f', stroke: '#263238', strokeWidth: 1 }),
            new Konva.Line({ points: [0,-12,0,-4], stroke: '#ffd54f', strokeWidth: 3, lineCap: 'round' }),
        );
        this._knobAngle = 0;
        this._knobRotor.on('mousedown touchstart', (e) => {
            e.cancelBubble = true;
            const sy = e.evt.clientY ?? e.evt.touches?.[0]?.clientY ?? 0;
            const sv = this.loadR;
            const sa = this._knobAngle;
            const mv = me => {
                const cy2 = me.clientY ?? me.touches?.[0]?.clientY ?? 0;
                const newA = Math.max(-150, Math.min(150, sa + (sy - cy2) * 1.8));
                this._knobAngle = newA;
                this._knobRotor.rotation(newA);
                this._manualLoadR = Math.max(0, sv + (sy - cy2) * (this.V2rated / this.ratedKVA / 15));
            };
            const up = () => { window.removeEventListener('mousemove', mv); window.removeEventListener('touchmove', mv); window.removeEventListener('mouseup', up); window.removeEventListener('touchend', up); };
            window.addEventListener('mousemove', mv); window.addEventListener('touchmove', mv);
            window.addEventListener('mouseup', up); window.addEventListener('touchend', up);
        });
        this._interactGroup.add(base, this._knobRotor, new Konva.Text({ x: kx-18, y: ky+21, width: 36, text: '负载调节', fontSize: 8.5, fill: '#546e7a', align: 'center' }));
    }

    // ── 波形示波器 ────────────────────────────
    _drawWaveform() {
        const { _wavX: wx, _wavY: wy, _wavW: ww, _wavH: wh } = this;
        if (wh < 16) return;

        const bg      = new Konva.Rect({ x: wx, y: wy, width: ww, height: wh, fill: '#010d18', stroke: '#1a3040', strokeWidth: 1.5, cornerRadius: 4 });
        const titleBg = new Konva.Rect({ x: wx, y: wy, width: ww, height: 13, fill: '#0a1a28', cornerRadius: [4,4,0,0] });
        this._staticGroup.add(new Konva.Text({ x: wx+4, y: wy+2, width: ww-8, text: 'V₁(原边)  V₂(副边)  I₁(原边)  I₂(副边)', fontSize: 8, fontStyle: 'bold', fill: '#4dd0e1', align: 'center' }));

        const h4 = (wh-13)/4;
        this._wavMids = [wy+13+h4*0.5, wy+13+h4*1.5, wy+13+h4*2.5, wy+13+h4*3.5];
        this._wavMids.forEach(my => {
            this._staticGroup.add(new Konva.Line({ points: [wx+2, my, wx+ww-2, my], stroke: 'rgba(200,200,200,0.08)', strokeWidth: 0.5, dash: [4,3] }));
        });

        this._wLineV1 = new Konva.Line({ points: [], stroke: '#ff8f00', strokeWidth: 1.7, lineJoin: 'round' });
        this._wLineV2 = new Konva.Line({ points: [], stroke: '#42a5f5', strokeWidth: 1.7, lineJoin: 'round' });
        this._wLineI1 = new Konva.Line({ points: [], stroke: '#ffa726', strokeWidth: 1.4, lineJoin: 'round' });
        this._wLineI2 = new Konva.Line({ points: [], stroke: '#64b5f6', strokeWidth: 1.4, lineJoin: 'round' });

        const lbls = ['V₁','V₂','I₁','I₂'];
        const cols = ['#ff8f00','#42a5f5','#ffa726','#64b5f6'];
        lbls.forEach((l, i) => { this._staticGroup.add(new Konva.Text({ x: wx+4, y: wy+13+h4*i+4, text: l, fontSize: 8, fill: cols[i] })); });

        this._wV1Lbl = new Konva.Text({ x: wx+ww-80, y: wy+13+4, width: 76, text: '0V', fontSize: 8, fontFamily: 'Courier New, monospace', fill: '#ff8f00', align: 'right' });
        this._wV2Lbl = new Konva.Text({ x: wx+ww-80, y: wy+13+h4+4, width: 76, text: '0V', fontSize: 8, fontFamily: 'Courier New, monospace', fill: '#42a5f5', align: 'right' });
        this._wI1Lbl = new Konva.Text({ x: wx+ww-80, y: wy+13+h4*2+4, width: 76, text: '0A', fontSize: 8, fontFamily: 'Courier New, monospace', fill: '#ffa726', align: 'right' });
        this._wI2Lbl = new Konva.Text({ x: wx+ww-80, y: wy+13+h4*3+4, width: 76, text: '0A', fontSize: 8, fontFamily: 'Courier New, monospace', fill: '#64b5f6', align: 'right' });

        this._staticGroup.add(bg, titleBg, this._wLineV1, this._wLineV2, this._wLineI1, this._wLineI2, this._wV1Lbl, this._wV2Lbl, this._wI1Lbl, this._wI2Lbl);
        this._wavH4 = h4;
    }

    // ── 负载参数面板（LCD下方）───────────────
    _drawLoadPanel() {
        const hx = this._lcdX, hw = this._lcdW;
        const panY = this._lcdY + this._lcdH + 6;
        const ph   = this.height - panY - 4;
        if (ph < 14) return;

        const bg = new Konva.Rect({ x: hx, y: panY, width: hw, height: ph, fill: '#020c14', stroke: '#1a3040', strokeWidth: 1.2, cornerRadius: 4 });
        this._staticGroup.add(new Konva.Text({ x: hx+2, y: panY+2, width: hw-4, text: '负载参数', fontSize: 8, fontStyle: 'bold', fill: '#546e7a', align: 'center' }));
        this._panelI1  = new Konva.Text({ x: hx+4, y: panY+14, text: 'I₁=--A', fontSize: 8, fontFamily: 'Courier New, monospace', fill: '#ffa726' });
        this._panelI2  = new Konva.Text({ x: hx+4, y: panY+24, text: 'I₂=--A', fontSize: 8, fontFamily: 'Courier New, monospace', fill: '#64b5f6' });
        this._panelP   = new Konva.Text({ x: hx+4, y: panY+34, text: 'P=--W',  fontSize: 8, fontFamily: 'Courier New, monospace', fill: '#a5d6a7' });
        this._panelPfe = new Konva.Text({ x: hx+4, y: panY+44, text: 'Pfe=--', fontSize: 8, fontFamily: 'Courier New, monospace', fill: '#ef9a9a' });
        this._staticGroup.add(bg, this._panelI1, this._panelI2, this._panelP, this._panelPfe);
    }

    // ── 拖拽调节负载 ─────────────────────────
    _setupDrag() {
        const hit = new Konva.Rect({ x: this._coreX, y: this._coreY, width: this._coreW, height: this._coreH, fill: 'transparent', listening: true });
        hit.on('mousedown touchstart', e => {
            e.cancelBubble = true;
            this._dragStartY = e.evt.clientY ?? e.evt.touches?.[0]?.clientY ?? 0;
            this._dragStartR = this._manualLoadR;
            this._dragActive = true;
        });
        const mv = e => {
            if (!this._dragActive) return;
            const cy = e.clientY ?? e.touches?.[0]?.clientY ?? 0;
            const maxR = this.V2rated * this.V2rated / (this.ratedKVA * 1000) * 10;
            this._manualLoadR = Math.max(0, Math.min(maxR * 2, this._dragStartR + (this._dragStartY - cy) * (maxR / 100)));
        };
        const up = () => { this._dragActive = false; };
        window.addEventListener('mousemove', mv);
        window.addEventListener('touchmove', mv, { passive: true });
        window.addEventListener('mouseup', up);
        window.addEventListener('touchend', up);
        this._interactGroup.add(hit);
    }

    // ═══════════════════════════════════════════
    // 集中化 tick（由 consys._tickAll 在 20fps 调用）
    tick(dt) {
        this._tickPhysics(dt);
        this._tickFluxViz(dt);
        this._tickWindingCurrent(dt);
        this._tickWaveform(dt);
        this._tickDisplay();
        this._refreshCache();
    }
    // ── 电气计算 ──────────────────────────────
    _tickPhysics(dt) {
        this.loadR = this._manualLoadR;
        this.V1    = this.V1apply;

        const omega = 2 * Math.PI * this.frequency;
        this._time += dt;

        // 最大磁通（感应电动势公式）
        this.Phi_m = this.V1 / (4.44 * this.frequency * this.N1);

        // 副边电压（理想变压器）
        this.V2 = this.V1 * this.N2 / this.N1;

        // 励磁电流
        const V_m = this.V1;
        this.I0   = Math.sqrt((V_m / this.Rm) ** 2 + (V_m / this.Xm) ** 2);

        // 副边电流
        if (this.loadR > 0.1) {
            this.I2 = this.V2 / this.loadR;
        } else {
            this.I2 = 0;  // 空载
        }

        // 折算后的原边负载分量电流
        const I1_load = this.I2 * this.N2 / this.N1;

        // 总原边电流（励磁 + 负载，相量叠加简化）
        this.I1 = Math.sqrt(this.I0 ** 2 + I1_load ** 2 + 2 * this.I0 * I1_load * this.loadPF);

        // 功率
        const P_input  = this.V1 * this.I1 * this.loadPF;
        const P_output = this.V2 * this.I2;
        this.P_fe      = this.V1 ** 2 / this.Rm;
        this.P_cu      = this.I1 ** 2 * this.R1 + this.I2 ** 2 * this.R2;
        this.S1        = this.V1 * this.I1;
        this.S2        = P_output;
        this.eta       = P_input > 1 ? Math.min(99.9, P_output / P_input * 100) : 0;

        // 负载率
        const S_rated = this.ratedKVA * 1000;
        this.loadPct   = Math.min(100, this.S2 / S_rated * 100);

        // 负载弧
        if (this._loadArc) {
            this._loadArc.angle(Math.min(1, this.loadPct/100) * 360);
            this._loadArc.fill(this.loadPct > 100 ? '#ef5350' : this.loadPct > 80 ? '#ffa726' : '#4dd0e1');
        }

        // 磁通标注
        if (this._phiLabel) this._phiLabel.text(`${(this.Phi_m*1000).toFixed(2)} mWb`);

        // 动画相位
        this._fluxPhase += dt * omega;
        this._phase     += dt * 4;
    }

    // ── 磁通可视化 ────────────────────────────
    _tickFluxViz(dt) {
        this._fluxGroup.destroyChildren();
        this._leakGroup.destroyChildren();

        const fluxVal = this.Phi_m * Math.sin(this._fluxPhase);
        const fluxAbs = Math.abs(fluxVal);
        const fluxDir = fluxVal >= 0 ? 1 : -1;

        // ── 铁芯内主磁通（流动粒子）──
        const cx = this._coreX, cy = this._coreY, cw = this._coreW, ch = this._coreH;
        const yk = this._yoke, lw = this._legW, lh = this._legH;
        const midX = this._midLegX + lw/2;
        const leftX = cx + lw/2;
        const rightX= cx + cw - lw/2;
        const topY  = cy + yk/2;
        const botY  = cy + ch - yk/2;

        // 磁路路径点
        const fluxPath = [
            { x: midX, y: this._legY },            // 中柱顶
            { x: midX, y: topY },                   // → 上轭（向左）
            { x: leftX, y: topY },                  // 左上
            { x: leftX, y: botY },                  // 左腿底
            { x: midX, y: botY },                   // → 下轭（向右）
            { x: midX, y: this._legY + lh },        // 中柱底
        ];

        const nParticles = 6;
        const fluxIntensity = Math.min(1, fluxAbs / (this.Phi_m + 0.001));
        for (let i = 0; i < nParticles; i++) {
            const progress = ((this._fluxPhase * 0.15 + i / nParticles) % 1 + 1) % 1;
            const pathPct  = fluxDir > 0 ? progress : 1 - progress;

            // 沿磁路插值位置
            const totalSegments = fluxPath.length - 1;
            const segIdx  = Math.floor(pathPct * totalSegments);
            const segFrac = pathPct * totalSegments - segIdx;
            const p1 = fluxPath[Math.min(segIdx, fluxPath.length-1)];
            const p2 = fluxPath[Math.min(segIdx+1, fluxPath.length-1)];

            const px = p1.x + (p2.x - p1.x) * segFrac;
            const py = p1.y + (p2.y - p1.y) * segFrac;
            const pAlpha = fluxIntensity * 0.7;

            this._fluxGroup.add(new Konva.Circle({
                x: px, y: py, radius: 3,
                fill: `rgba(79,195,247,${pAlpha})`,
            }));
        }

        // ── 漏磁通（绕组附近，椭圆弧）──
        if (fluxAbs > 0.01) {
            const leakAlpha = fluxIntensity * 0.25;
            // 原边漏磁通
            for (let i = 1; i <= 3; i++) {
                this._leakGroup.add(new Konva.Ellipse({
                    x: this._w1X1 - 8, y: this._windingCY,
                    radiusX: 8 + i * 5, radiusY: this._coilH * 0.3 + i * 5,
                    fill: 'none', stroke: `rgba(255,167,38,${leakAlpha * (1 - i*0.2)})`,
                    strokeWidth: 1, dash: [3,3],
                }));
            }
            // 副边漏磁通
            for (let i = 1; i <= 3; i++) {
                this._leakGroup.add(new Konva.Ellipse({
                    x: this._w2X2 + 8, y: this._windingCY,
                    radiusX: 8 + i * 5, radiusY: this._coilH * 0.3 + i * 5,
                    fill: 'none', stroke: `rgba(66,165,245,${leakAlpha * (1 - i*0.2)})`,
                    strokeWidth: 1, dash: [3,3],
                }));
            }
        }
    }

    // ── 绕组电流可视化 ────────────────────────
    _tickWindingCurrent(dt) {
        this._priCurrentGroup.destroyChildren();
        this._secCurrentGroup.destroyChildren();

        const phase = this._fluxPhase;
        const i1Val = this.I1 * Math.sqrt(2) * Math.sin(phase);
        const i2Val = this.I2 * Math.sqrt(2) * Math.sin(phase + Math.PI); // 副边电流相位相反

        // 原绕组电流色彩
        if (this._priCoils && Math.abs(i1Val) > 0.01) {
            const i1Norm = Math.min(1, Math.abs(i1Val) / (this.I1 * Math.sqrt(2) + 0.01));
            const i1Col  = i1Val > 0 ? `rgba(255,143,0,${i1Norm * 0.8})` : `rgba(255,87,34,${i1Norm * 0.8})`;
            this._priCoils.forEach(coil => {
                // 高亮原绕组（随电流发光）
                this._priCurrentGroup.add(new Konva.Line({ ...coil.attrs, stroke: i1Col, strokeWidth: coil.strokeWidth() + i1Norm * 2, opacity: i1Norm * 0.5 }));
            });
        }

        // 副绕组电流色彩
        if (this._secCoils && Math.abs(i2Val) > 0.01 && this.loadR > 0.1) {
            const i2Norm = Math.min(1, Math.abs(i2Val) / (this.I2 * Math.sqrt(2) + 0.01));
            const i2Col  = i2Val > 0 ? `rgba(66,165,245,${i2Norm * 0.8})` : `rgba(30,136,229,${i2Norm * 0.8})`;
            this._secCoils.forEach(coil => {
                this._secCurrentGroup.add(new Konva.Line({ ...coil.attrs, stroke: i2Col, strokeWidth: coil.strokeWidth() + i2Norm * 2, opacity: i2Norm * 0.5 }));
            });
        }
    }

    // ── 波形缓冲 ─────────────────────────────
    _tickWaveform(dt) {
        if (!this._wavH4) return;
        this._wavAcc += 1.4 * dt * this._wavLen;
        const steps = Math.floor(this._wavAcc);
        this._wavAcc -= steps;

        const phase = this._fluxPhase;
        const omega  = 2 * Math.PI * this.frequency;
        const v1Inst = this.V1 * Math.sqrt(2) * Math.sin(phase);
        const v2Inst = this.V2 * Math.sqrt(2) * Math.sin(phase);
        const i1Inst = this.I1 * Math.sqrt(2) * Math.sin(phase - Math.PI * 0.05);  // 轻微滞后
        const i2Inst = this.I2 * Math.sqrt(2) * Math.sin(phase + Math.PI);          // 副边反相

        for (let i = 0; i < steps; i++) {
            this._wavV1 = new Float32Array([...this._wavV1.slice(1), v1Inst]);
            this._wavV2 = new Float32Array([...this._wavV2.slice(1), v2Inst]);
            this._wavI1 = new Float32Array([...this._wavI1.slice(1), i1Inst]);
            this._wavI2 = new Float32Array([...this._wavI2.slice(1), i2Inst]);
        }

        const wx = this._wavX+3, ww = this._wavW-6;
        const n  = this._wavLen, dx = ww / n;
        const h4 = this._wavH4;
        const [mV1, mV2, mI1, mI2] = this._wavMids;
        const maxV = this.V1 * Math.sqrt(2) + 1;
        const maxI = Math.max(0.01, this.I1 * Math.sqrt(2) * 1.1);
        const aV = h4 * 0.40, aI = h4 * 0.38;

        const v1Pts=[], v2Pts=[], i1Pts=[], i2Pts=[];
        for (let i = 0; i < n; i++) {
            const x = wx + i * dx;
            v1Pts.push(x, mV1 - (this._wavV1[i]/maxV) * aV);
            v2Pts.push(x, mV2 - (this._wavV2[i]/maxV) * aV);
            i1Pts.push(x, mI1 - (this._wavI1[i]/maxI) * aI);
            i2Pts.push(x, mI2 - (this._wavI2[i]/maxI) * aI);
        }
        if (this._wLineV1) this._wLineV1.points(v1Pts);
        if (this._wLineV2) this._wLineV2.points(v2Pts);
        if (this._wLineI1) this._wLineI1.points(i1Pts);
        if (this._wLineI2) this._wLineI2.points(i2Pts);

        if (this._wV1Lbl) this._wV1Lbl.text(`${this.V1.toFixed(1)}V`);
        if (this._wV2Lbl) this._wV2Lbl.text(`${this.V2.toFixed(1)}V`);
        if (this._wI1Lbl) this._wI1Lbl.text(`${this.I1.toFixed(3)}A`);
        if (this._wI2Lbl) this._wI2Lbl.text(`${this.I2.toFixed(3)}A`);
    }

    // ── LCD + 面板刷新 ────────────────────────
    _tickDisplay() {
        const lp = this.loadPct;
        const mc = lp > 100 ? '#ef5350' : lp > 80 ? '#ffa726' : '#4dd0e1';

        if (this._lcdBg)   this._lcdBg.fill('#020c14');
        if (this._lcdMain) { this._lcdMain.text(lp.toFixed(1)); this._lcdMain.fill(mc); }
        if (this._lcdEta)  this._lcdEta.text(`η=${this.eta.toFixed(1)}%`);
        if (this._lcdV1)   this._lcdV1.text(`V₁=${this.V1.toFixed(0)}V`);
        if (this._lcdV2)   this._lcdV2.text(`V₂=${this.V2.toFixed(1)}V`);

        if (this._panelI1) this._panelI1.text(`I₁=${this.I1.toFixed(3)}A`);
        if (this._panelI2) this._panelI2.text(`I₂=${this.I2.toFixed(3)}A`);
        if (this._panelP)  this._panelP.text(`P=${this.S2.toFixed(1)}W`);
        if (this._panelPfe) this._panelPfe.text(`Pfe=${this.P_fe.toFixed(2)}W`);
    }

    // ═══════════════════════════════════════════
    update(V1) {
        if (typeof V1 === 'number') {
            this.V1apply = Math.max(0, Math.min(this.V1rated * 1.2, V1));
        }
        this._refreshCache();
    }

    setLoad(R) {
        this._manualLoadR = Math.max(0, R);
        this._refreshCache();
    }

    getConfigFields() {
        return [
            { label: '位号/名称',          key: 'id',         type: 'text'   },
            { label: '额定容量 (kVA)',      key: 'ratedKVA',   type: 'number' },
            { label: '原边电压 V₁ (V)',    key: 'V1rated',    type: 'number' },
            { label: '副边电压 V₂ (V)',    key: 'V2rated',    type: 'number' },
            { label: '原边匝数 N₁',        key: 'N1',         type: 'number' },
            { label: '频率 (Hz)',           key: 'frequency',  type: 'number' },
            { label: '励磁电阻 Rm (Ω)',    key: 'Rm',         type: 'number' },
        ];
    }

    onConfigUpdate(cfg) {
        this.id         = cfg.id         || this.id;
        this.ratedKVA   = parseFloat(cfg.ratedKVA)   || this.ratedKVA;
        this.V1rated    = parseFloat(cfg.V1rated)    || this.V1rated;
        this.V2rated    = parseFloat(cfg.V2rated)    || this.V2rated;
        this.N1         = parseInt(cfg.N1)           || this.N1;
        this.frequency  = parseFloat(cfg.frequency)  || this.frequency;
        this.Rm         = parseFloat(cfg.Rm)         || this.Rm;
        this.k          = this.N1 / Math.round(this.N1 * this.V2rated / this.V1rated);
        this.N2         = Math.round(this.N1 / this.k);
        this.config     = { ...this.config, ...cfg };
        if (this._idText) this._idText.text(this.id);
        this._refreshCache();
    }

    destroy() {
        super.destroy?.();
    }
}