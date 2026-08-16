import { BaseComponent } from './BaseComponent.js';

/**
 * 三相变压器仿真组件
 * （Three-Phase Power Transformer）
 *
 * ── 工作原理 ──────────────────────────────────────────────────
 *
 *  三相变压器是三相电力系统中最重要的设备之一，用于变换三相电压和电流。
 *
 *  1. 铁芯结构（Core Structure）：
 *     - 芯式（Core Type）：三个铁芯柱，线圈套在铁芯柱上
 *       A/B/C 三相分别绕在三个铁芯柱上，三相磁路相互独立
 *     - 壳式（Shell Type）：铁芯包围绕组，磁路并联
 *
 *  2. 绕组接线方式（Connection）：
 *     - Y（星形）：三相绕组末端联在一起（中性点），首端接线端
 *       优点：可引出中性线，适合低压配电
 *     - D（三角形）：三相绕组首尾相连
 *       优点：无中性点，可抑制三次谐波，适合高压侧
 *     - YN（带中性线星形）：Y接法引出中性线 N
 *
 *  3. 常见接法组合（Connection Group）：
 *     - Yyn0：高压 Y 低压 yn（配电变压器标准）
 *     - Dyn11：高压 D 低压 yn，相位差 330°（11×30°）
 *     - YD11：高压 Y 低压 D，相位差 330°
 *     - YNd11：高压 YN 低压 D
 *
 *  4. 电压变换：
 *     V₂/V₁ = N₂/N₁（每柱匝数之比）
 *     Y接：相电压 = 线电压 / √3
 *     D接：相电压 = 线电压
 *
 *  5. 磁通分析：
 *     Φ_A = Φ_m × sin(ωt)
 *     Φ_B = Φ_m × sin(ωt - 120°)
 *     Φ_C = Φ_m × sin(ωt + 120°)
 *     三相磁通之和 Φ_A + Φ_B + Φ_C = 0（平衡三相）
 *
 *  6. 等效电路（T 型等效）：
 *     R₁, X₁  — 原边电阻、漏抗
 *     R₂', X₂'— 副边折算电阻、漏抗
 *     R_m, X_m — 励磁支路
 *
 *  7. 损耗：
 *     空载损耗（铁损）：P₀ = 3 × V₁_phase² / R_m
 *     短路损耗（铜损）：Pk = 3 × I_N² × (R₁ + R₂')
 *     效率：η = P₂ / (P₂ + P₀ + Pk×β²)
 *     其中 β = I₂/I₂N（负载系数）
 *
 * ── 组件结构 ──────────────────────────────────────────────────
 *  ① 三柱铁芯侧视图（A/B/C 三柱，上下轭）
 *  ② 每柱高低压绕组（高压橙色，低压蓝色，可切换 Y/D）
 *  ③ 三相磁通流动动画（铁芯内彩色粒子，相位差120°）
 *  ④ 接线方式示意（Y/D 向量图，小型矢量图）
 *  ⑤ 等效电路简图（T型，关键参数标注）
 *  ⑥ 三相电压/电流波形实时显示
 *  ⑦ 仪表 LCD（V₁线/相、V₂线/相、I₁、I₂、功率、效率、铁损、铜损）
 *  ⑧ 负载调节面板（三相平衡/不平衡负载）
 *  ⑨ 接线方式切换按钮（Yyn0 / Dyn11 / YD11）
 *  ⑩ 油温/绝缘监测指示
 *
 * ── 端口 ─────────────────────────────────────────────────────
 *  wire_1a — 高压 A 相
 *  wire_1b — 高压 B 相
 *  wire_1c — 高压 C 相
 *  wire_1n — 高压中性线 N（Y接时有效）
 *  wire_2a — 低压 a 相
 *  wire_2b — 低压 b 相
 *  wire_2c — 低压 c 相
 *  wire_2n — 低压中性线 n（yn接时有效）
 */
export class ThreePhaseTransformer extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.width  = Math.max(500, config.width  || 600);
        this.height = Math.max(380, config.height || 460);

        this.type    = 'three_phase_xfmr';
        this.special = 'none';
        this.cache   = 'fixed';

        // ── 额定铭牌参数 ──
        this.ratedKVA    = config.ratedKVA    || 100;    // kVA
        this.V1rated     = config.V1rated     || 10000;  // 高压线电压 V
        this.V2rated     = config.V2rated     || 400;    // 低压线电压 V
        this.frequency   = config.frequency   || 50;     // Hz
        this.connection  = config.connection  || 'Yyn0'; // 'Yyn0'|'Dyn11'|'YD11'|'YNd11'
        this.coreType    = config.coreType    || 'core'; // 'core'|'shell'

        // 每相匝数
        this.N1 = config.N1 || 2000;
        // 副边匝数由电压比和接法确定
        this._calcN2();

        // ── 等效电路参数 ──
        this.R1   = config.R1   || 0.008;   // 高压绕组电阻（标幺）
        this.X1   = config.X1   || 0.040;   // 高压绕组漏抗（标幺）
        this.R2   = config.R2   || 0.008;   // 低压绕组电阻（折算，标幺）
        this.X2   = config.X2   || 0.040;   // 低压绕组漏抗（折算，标幺）
        this.Rm   = config.Rm   || 400;     // 励磁电阻（标幺，代表铁损）
        this.Xm   = config.Xm   || 40;      // 励磁感抗（标幺）
        this.Uk   = config.Uk   || 4.0;     // 短路电压百分比 %
        this.I0pct= config.I0pct|| 1.5;     // 空载电流百分比 %

        // ── 负载参数 ──
        this.loadR      = config.loadR   || 0;      // 低压侧负载（每相，Ω，0=空载）
        this._manualLoad= config.loadR   || 0;
        this.loadPF     = config.loadPF  || 1.0;    // 负载功率因数
        this.V1apply    = this.V1rated;              // 施加高压

        // ── 状态 ──
        this.phaseVoltages = { a:0, b:0, c:0 };     // 低压相电压
        this.lineVoltages  = { ab:0, bc:0, ca:0 };  // 低压线电压
        this.I1phase  = 0;    // 高压相电流 A
        this.I2phase  = 0;    // 低压相电流 A
        this.I0       = 0;    // 励磁电流 A
        this.P0       = 0;    // 铁损 W
        this.Pcu      = 0;    // 铜损 W
        this.Pout     = 0;    // 输出功率 W
        this.Pin      = 0;    // 输入功率 W
        this.efficiency= 0;   // 效率 %
        this.loadFactor= 0;   // 负载率（β）
        this.oilTemp  = config.oilTemp || 25;  // 油温 °C
        this.isBreak  = false;

        // ── 动画 ──
        this._time      = 0;
        this._fluxPhase = 0;
        this._phase     = 0;

        // ── 波形缓冲（六路：三相高低压）──
        this._wavLen    = 260;
        this._wavV1     = [new Float32Array(this._wavLen).fill(0), new Float32Array(this._wavLen).fill(0), new Float32Array(this._wavLen).fill(0)];
        this._wavV2     = [new Float32Array(this._wavLen).fill(0), new Float32Array(this._wavLen).fill(0), new Float32Array(this._wavLen).fill(0)];
        this._wavAcc    = 0;

        // ── 几何布局 ──
        // 铁芯+绕组（左部）
        this._coreX    = 10;
        this._coreY    = Math.round(this.height * 0.08);
        this._coreW    = Math.round(this.width  * 0.46);
        this._coreH    = Math.round(this.height * 0.60);

        // 三柱位置
        this._yokeH    = Math.round(this._coreH * 0.14);  // 轭铁厚度
        this._legW     = Math.round(this._coreW * 0.16);  // 每柱宽
        this._legH     = this._coreH - this._yokeH * 2;
        this._legY     = this._coreY + this._yokeH;
        this._legGap   = Math.round((this._coreW - this._legW * 3) / 4);  // 柱间距
        this._legXs    = [
            this._coreX + this._legGap,
            this._coreX + this._legGap * 2 + this._legW,
            this._coreX + this._legGap * 3 + this._legW * 2,
        ];
        this._legCXs   = this._legXs.map(x => x + this._legW/2);

        // 接线图区（铁芯右方）
        this._connX    = this._coreX + this._coreW + 12;
        this._connY    = this._coreY;
        this._connW    = Math.round(this.width  * 0.12);
        this._connH    = Math.round(this.height * 0.38);

        // LCD 仪表（右上）
        this._lcdX     = this._connX + this._connW + 10;
        this._lcdY     = this._coreY;
        this._lcdW     = this.width - this._lcdX - 8;
        this._lcdH     = Math.round(this.height * 0.48);

        // 负载/控制面板（右下，LCD下方）
        this._panelX   = this._connX;
        this._panelY   = this._connY + this._connH + 8;
        this._panelW   = this.width - this._connX - 8;
        this._panelH   = Math.round(this.height * 0.20);

        // 波形区（底部）
        this._wavX     = 8;
        this._wavY     = this._coreY + this._coreH + 10;
        this._wavW     = this.width - 16;
        this._wavH     = this.height - this._wavY - 6;

        this.knobs     = {};

        this.config = {
            id: this.id, ratedKVA: this.ratedKVA,
            V1rated: this.V1rated, V2rated: this.V2rated,
            frequency: this.frequency, connection: this.connection,
        };

        this._init();

        // 端口
        this.addPort(0,           this._coreY + this._coreH*0.22, '1a', 'wire', 'A');
        this.addPort(0,           this._coreY + this._coreH*0.44, '1b', 'wire', 'B');
        this.addPort(0,           this._coreY + this._coreH*0.66, '1c', 'wire', 'C');
        this.addPort(0,           this._coreY + this._coreH*0.88, '1n', 'wire', 'N1');
        this.addPort(this.width,  this._coreY + this._coreH*0.22, '2a', 'wire', 'a');
        this.addPort(this.width,  this._coreY + this._coreH*0.44, '2b', 'wire', 'b');
        this.addPort(this.width,  this._coreY + this._coreH*0.66, '2c', 'wire', 'c');
        this.addPort(this.width,  this._coreY + this._coreH*0.88, '2n', 'wire', 'n');
    }

    // ── 副边匝数计算（考虑接法）──────────────
    _calcN2() {
        const conn = this.connection;
        let k = 1; // 接法系数
        // Yyn0：  V1_phase/V2_phase = N1/N2，V1_phase=V1/√3，V2_phase=V2/√3 → N2=N1×V2/V1
        // Dyn11： V1_phase=V1，V2_phase=V2/√3 → N2=N1×V2/(V1×√3)
        // YD11：  V1_phase=V1/√3，V2_phase=V2 → N2=N1×V2×√3/V1
        if (conn === 'Yyn0' || conn === 'YNyn0') {
            this.N2 = Math.round(this.N1 * this.V2rated / this.V1rated);
        } else if (conn === 'Dyn11') {
            this.N2 = Math.round(this.N1 * this.V2rated / (this.V1rated * Math.sqrt(3)));
        } else if (conn === 'YD11') {
            this.N2 = Math.round(this.N1 * this.V2rated * Math.sqrt(3) / this.V1rated);
        } else {
            this.N2 = Math.round(this.N1 * this.V2rated / this.V1rated);
        }
        this.k = this.N1 / this.N2;
    }

    // ═══════════════════════════════════════════
    _init() {
        this._drawLabel();
        this._drawCoreYokes();
        this._drawCoreLegs();
        this._drawCoreLaminations();
        this._drawWindings();
        this._drawFluxLayer();
        this._drawLeakageLayer();
        this._drawConnectionDiagram();
        this._drawEquivCircuitSmall();
        this._drawLCDPanel();
        this._drawLoadPanel();
        this._drawWaveform();
        this._setupDrag();
        
    }

    _drawLabel() {
        const conn = this.connection;
        this.group.add(new Konva.Text({
            x: 0, y: -22, width: this.width,
            text: `三相变压器  ${this.V1rated/1000}kV/${this.V2rated}V  ${this.ratedKVA}kVA  ${conn}  ${this.frequency}Hz`,
            fontSize: 12, fontStyle: 'bold', fill: '#1a2634', align: 'center',
        }));
    }

    // ── 上下轭铁 ─────────────────────────────
    _drawCoreYokes() {
        const cx = this._coreX, cy = this._coreY, cw = this._coreW, yk = this._yokeH;

        // 上轭
        const topYoke = new Konva.Rect({ x: cx, y: cy, width: cw, height: yk, fill: '#546e7a', stroke: '#37474f', strokeWidth: 2 });
        // 下轭
        const botYoke = new Konva.Rect({ x: cx, y: cy+this._coreH-yk, width: cw, height: yk, fill: '#546e7a', stroke: '#37474f', strokeWidth: 2 });
        // 高光
        this.group.add(new Konva.Rect({ x: cx+2, y: cy+2, width: cw-4, height: 4, fill: 'rgba(255,255,255,0.12)', cornerRadius: 1 }));
        this.group.add(topYoke, botYoke);
        this.group.add(new Konva.Text({ x: cx, y: cy-18, width: cw, text: '三柱芯式铁芯  Three-Column Core', fontSize: 9, fontStyle: 'bold', fill: '#546e7a', align: 'center' }));
    }

    // ── 三柱铁芯 ─────────────────────────────
    _drawCoreLegs() {
        const cols = ['#ef5350','#66bb6a','#42a5f5'];
        const phNames = ['A', 'B', 'C'];

        this._legRects = [];
        this._legXs.forEach((lx, i) => {
            // 铁芯柱
            const leg = new Konva.Rect({ x: lx, y: this._legY, width: this._legW, height: this._legH, fill: '#607d8b', stroke: '#37474f', strokeWidth: 1.5 });
            // 铁芯内腔（绕组安装区）
            const inner = new Konva.Rect({ x: lx+3, y: this._legY+3, width: this._legW-6, height: this._legH-6, fill: '#0d1a28' });
            this._legRects.push({ leg, inner });
            this.group.add(leg, inner);
            // 相序标注（铁芯柱顶）
            this.group.add(new Konva.Text({ x: this._legCXs[i]-8, y: this._legY-18, text: phNames[i]+'相', fontSize: 9, fontStyle: 'bold', fill: cols[i] }));
        });
    }

    // ── 叠片纹理 ─────────────────────────────
    _drawCoreLaminations() {
        // 上下轭铁叠片
        const cx = this._coreX, cy = this._coreY, cw = this._coreW, yk = this._yokeH;
        for (let i = 2; i < yk-1; i += 3) {
            this.group.add(new Konva.Line({ points: [cx+2,cy+i,cx+cw-2,cy+i], stroke: 'rgba(0,0,0,0.14)', strokeWidth: 0.7 }));
        }
        for (let i = 2; i < yk-1; i += 3) {
            this.group.add(new Konva.Line({ points: [cx+2,cy+this._coreH-yk+i,cx+cw-2,cy+this._coreH-yk+i], stroke: 'rgba(0,0,0,0.14)', strokeWidth: 0.7 }));
        }
        // 柱叠片
        this._legXs.forEach(lx => {
            for (let i = 2; i < this._legH-1; i += 3) {
                this.group.add(new Konva.Line({ points: [lx+2,this._legY+i,lx+this._legW-2,this._legY+i], stroke: 'rgba(0,0,0,0.16)', strokeWidth: 0.7 }));
            }
        });
    }

    // ── 高低压绕组 ───────────────────────────
    _drawWindings() {
        const lw = this._legW, lh = this._legH, ly = this._legY;
        const windH = Math.round(lh * 0.85);
        const windY = ly + (lh - windH) / 2;

        const phColors = ['#ef5350','#66bb6a','#42a5f5'];
        const hiCoilW  = Math.round(lw * 0.55), loCoilW = Math.round(lw * 0.45);

        this._hiCoilGroups = [];
        this._loCoilGroups = [];

        this._legXs.forEach((lx, i) => {
            const cx2 = lx + lw/2;
            const col  = phColors[i];

            // ── 高压绕组（外侧，橙色系，粗线多匝）──
            const hiTurns = 14;
            const hiStep  = windH / hiTurns;
            const hiGrp   = new Konva.Group();
            for (let t = 0; t < hiTurns; t++) {
                const ty = windY + t * hiStep;
                const hiCol = t%2===0 ? '#ff8f00' : '#ffa726';
                hiGrp.add(new Konva.Line({
                    points: [lx-hiCoilW/2-2, ty, lx+lw+hiCoilW/2+2, ty,
                             lx+lw+hiCoilW/2+2, ty+hiStep*0.82,
                             lx-hiCoilW/2-2, ty+hiStep*0.82,
                             lx-hiCoilW/2-2, ty+hiStep],
                    stroke: hiCol, strokeWidth: 2.5, lineCap: 'round', lineJoin: 'round', opacity: 0.82,
                }));
            }
            // 高压绕组引线
            hiGrp.add(new Konva.Line({ points: [lx-hiCoilW/2-2, windY, lx-hiCoilW/2-2-10, windY, lx-hiCoilW/2-2-10, this._coreY+4], stroke: '#ff8f00', strokeWidth: 2, lineCap: 'round' }));
            hiGrp.add(new Konva.Line({ points: [lx-hiCoilW/2-2, windY+windH, lx-hiCoilW/2-2-10, windY+windH, lx-hiCoilW/2-2-10, this._coreY+this._coreH-4], stroke: '#ff8f00', strokeWidth: 2, lineCap: 'round' }));
            this._hiCoilGroups.push(hiGrp);

            // ── 低压绕组（内侧，蓝色系，细线少匝）──
            const loTurns = 7;
            const loStep  = windH / loTurns;
            const loGrp   = new Konva.Group();
            for (let t = 0; t < loTurns; t++) {
                const ty = windY + t * loStep;
                const loCol = t%2===0 ? '#1e88e5' : '#42a5f5';
                loGrp.add(new Konva.Line({
                    points: [lx-loCoilW/2+1, ty, lx+lw+loCoilW/2-1, ty,
                             lx+lw+loCoilW/2-1, ty+loStep*0.80,
                             lx-loCoilW/2+1, ty+loStep*0.80,
                             lx-loCoilW/2+1, ty+loStep],
                    stroke: loCol, strokeWidth: 3.5, lineCap: 'round', lineJoin: 'round', opacity: 0.80,
                }));
            }
            // 低压绕组引线
            loGrp.add(new Konva.Line({ points: [lx+lw+loCoilW/2-1, windY, lx+lw+loCoilW/2-1+10, windY, lx+lw+loCoilW/2-1+10, this._coreY+4], stroke: '#42a5f5', strokeWidth: 2, lineCap: 'round' }));
            loGrp.add(new Konva.Line({ points: [lx+lw+loCoilW/2-1, windY+windH, lx+lw+loCoilW/2-1+10, windY+windH, lx+lw+loCoilW/2-1+10, this._coreY+this._coreH-4], stroke: '#42a5f5', strokeWidth: 2, lineCap: 'round' }));
            this._loCoilGroups.push(loGrp);

            this.group.add(hiGrp, loGrp);

            // 绕组标注
            this.group.add(new Konva.Text({ x: lx-hiCoilW/2-30, y: windY+windH/2-5, text: `HV\n${i===0?'A':i===1?'B':'C'}`, fontSize: 7.5, fill: '#ff8f00', lineHeight: 1.3, align: 'center', width: 18 }));
            this.group.add(new Konva.Text({ x: lx+lw+loCoilW/2+12, y: windY+windH/2-5, text: `LV\n${i===0?'a':i===1?'b':'c'}`, fontSize: 7.5, fill: '#42a5f5', lineHeight: 1.3, align: 'center', width: 18 }));
        });

        // 绕组标注（顶部）
        const midLegX = this._legCXs[1];
        this.group.add(new Konva.Rect({ x: this._legCXs[0]-30, y: this._coreY-1, width: 24, height: 10, fill: '#1a0800', cornerRadius: 1 }));
        this.group.add(new Konva.Text({ x: this._legCXs[0]-30, y: this._coreY, text: '─ 高压绕组', fontSize: 7, fill: '#ff8f00' }));
        this.group.add(new Konva.Rect({ x: this._legCXs[0]-30, y: this._coreY+10, width: 24, height: 10, fill: '#00081a', cornerRadius: 1 }));
        this.group.add(new Konva.Text({ x: this._legCXs[0]-30, y: this._coreY+11, text: '─ 低压绕组', fontSize: 7, fill: '#42a5f5' }));
    }

    // ── 磁通流动层（三路，相位差120°）─────
    _drawFluxLayer() {
        this._fluxGroups = [new Konva.Group(), new Konva.Group(), new Konva.Group()];
        this._fluxGroups.forEach(g => this.group.add(g));
    }

    // ── 漏磁通层 ─────────────────────────────
    _drawLeakageLayer() {
        this._leakGroups = [new Konva.Group(), new Konva.Group(), new Konva.Group()];
        this._leakGroups.forEach(g => this.group.add(g));
    }

    // ── 接线方式示意图 ───────────────────────
    _drawConnectionDiagram() {
        const cx2 = this._connX, cy2 = this._connY, cw = this._connW, ch = this._connH;

        const bg = new Konva.Rect({ x: cx2, y: cy2, width: cw, height: ch, fill: '#020c14', stroke: '#1a3040', strokeWidth: 1.5, cornerRadius: 4 });
        const titleBg = new Konva.Rect({ x: cx2, y: cy2, width: cw, height: 13, fill: '#0a1a28', cornerRadius: [4,4,0,0] });
        this.group.add(new Konva.Text({ x: cx2+2, y: cy2+2, width: cw-4, text: '接线方式', fontSize: 8, fontStyle: 'bold', fill: '#80cbc4', align: 'center' }));

        this._connDiagGroup = new Konva.Group({ x: cx2, y: cy2 });
        this.group.add(bg, titleBg, this._connDiagGroup);
        this._drawConnectionDiagContent();

        // 接线切换按钮
        const btnY = cy2 + ch + 4;
        const conns = ['Yyn0','Dyn11','YD11','YNd11'];
        const btnW  = (this.width - this._connX - 12) / 2;
        this._connBtns = [];
        conns.forEach((c, i) => {
            const bx = cx2 + (i%2)*(btnW+4), by = btnY + Math.floor(i/2)*18;
            if (by + 14 > this._panelY + this._panelH) return;
            const isAct = c === this.connection;
            const btn = new Konva.Rect({ x: bx, y: by, width: btnW, height: 14, fill: isAct?'#0a1a2a':'#0d2030', stroke: isAct?'#4fc3f7':'#1a3040', strokeWidth: 1, cornerRadius: 2 });
            const lbl = new Konva.Text({ x: bx, y: by+3, width: btnW, text: c, fontSize: 8, fill: isAct?'#4fc3f7':'#37474f', align: 'center' });
            btn.on('click tap', () => {
                this.connection = c;
                this._calcN2();
                this._connBtns.forEach((b, j) => {
                    const act = conns[j] === c;
                    b.btn.fill(act?'#0a1a2a':'#0d2030'); b.btn.stroke(act?'#4fc3f7':'#1a3040');
                    b.lbl.fill(act?'#4fc3f7':'#37474f');
                });
                this._connDiagGroup.destroyChildren();
                this._drawConnectionDiagContent();
                this._refreshCache();
            });
            this._connBtns.push({ btn, lbl });
            this.group.add(btn, lbl);
        });
    }

    // ── 接线向量图内容（随接法切换）─────────
    _drawConnectionDiagContent() {
        const g = this._connDiagGroup;
        const cw = this._connW, ch = this._connH;
        const mcx = cw/2, mcy = ch/2 + 8;
        const r   = Math.min(cw, ch-20) * 0.30;
        const conn = this.connection;

        // 接法名称
        g.add(new Konva.Text({ x: 4, y: 15, width: cw-8, text: conn, fontSize: 10, fontStyle: 'bold', fill: '#ffd54f', align: 'center' }));

        // 高压侧向量图（上半）
        const hiY = mcy - r - 10;
        const hConn = conn.startsWith('Y') || conn.startsWith('y') ? 'Y' : 'D';
        this._drawSinglePhaseDiagram(g, mcx, hiY, r*0.9, hConn, '#ff8f00', '高压');

        // 低压侧向量图（下半）
        const loConn_str = conn.slice(-3); // 末3字符
        const lConn = loConn_str.toLowerCase().includes('d') ? 'D' : 'Y';
        this._drawSinglePhaseDiagram(g, mcx, mcy + r + 6, r*0.9, lConn, '#42a5f5', '低压');
    }

    _drawSinglePhaseDiagram(g, cx2, cy2, r, type, color, label) {
        g.add(new Konva.Text({ x: cx2-20, y: cy2-r-14, width: 40, text: `${label}(${type})`, fontSize: 7.5, fill: color, align: 'center' }));
        if (type === 'Y' || type === 'y') {
            // 星形向量图
            const phAngles = [-90, 30, 150]; // 度
            for (let i = 0; i < 3; i++) {
                const a = phAngles[i] * Math.PI / 180;
                g.add(new Konva.Arrow({ points: [cx2, cy2, cx2+r*Math.cos(a), cy2+r*Math.sin(a)], stroke: color, fill: color, strokeWidth: 2, pointerLength: 4, pointerWidth: 4, opacity: 0.85 }));
            }
            g.add(new Konva.Circle({ x: cx2, y: cy2, radius: 3, fill: color, opacity: 0.7 }));
        } else {
            // 三角形向量图（等边三角形）
            const pts = [0,1,2].map(i => {
                const a = (i*120 - 90) * Math.PI / 180;
                return { x: cx2 + r*Math.cos(a), y: cy2 + r*Math.sin(a) };
            });
            for (let i = 0; i < 3; i++) {
                const next = (i+1)%3;
                g.add(new Konva.Arrow({ points: [pts[i].x,pts[i].y, pts[next].x,pts[next].y], stroke: color, fill: color, strokeWidth: 2, pointerLength: 4, pointerWidth: 4, opacity: 0.85 }));
            }
        }
    }

    // ── 等效电路简图 ─────────────────────────
    _drawEquivCircuitSmall() {
        // 在铁芯图正下方绘制小型等效电路
        const ex = this._coreX + 4, ey = this._coreY + this._coreH + 4;
        const ew = this._coreW - 8, eh = Math.min(40, this._wavY - ey - 4);
        if (eh < 14) return;

        const bg = new Konva.Rect({ x: ex, y: ey, width: ew, height: eh, fill: '#020c14', stroke: '#1a3040', strokeWidth: 1, cornerRadius: 3 });
        this.group.add(new Konva.Text({ x: ex+2, y: ey+2, width: ew-4, text: `等效电路：R₁=${this.R1.toFixed(3)} X₁=${this.X1.toFixed(3)} Uk=${this.Uk}%  I₀=${this.I0pct}%  k=${this.k.toFixed(1)}`, fontSize: 7.5, fontFamily: 'Courier New, monospace', fill: '#546e7a', align: 'center' }));
        this.group.add(bg);
    }

    // ── LCD 仪表（右侧）────────────────────
    _drawLCDPanel() {
        const lx = this._lcdX, ly = this._lcdY, lw = this._lcdW, lh = this._lcdH;

        const bg = new Konva.Rect({ x: lx, y: ly, width: lw, height: lh, fill: '#020c14', stroke: '#1a3040', strokeWidth: 1.5, cornerRadius: 4 });
        const titleBg = new Konva.Rect({ x: lx, y: ly, width: lw, height: 14, fill: '#0a1a28', cornerRadius: [4,4,0,0] });
        this.group.add(new Konva.Text({ x: lx+4, y: ly+2, width: lw-8, text: '运行参数监控', fontSize: 8, fontStyle: 'bold', fill: '#80cbc4', align: 'center' }));

        // 圆形主表盘（负载率）
        const lcx = lx + lw/2, lcy = ly + 44 + Math.min(lw, lh-44) * 0.46;
        const R   = Math.min(lw*0.36, 42);
        this.group.add(new Konva.Circle({ x: lcx, y: lcy, radius: R+4, fill: '#0d1520', stroke: '#1a252f', strokeWidth: 1 }));
        const ring = new Konva.Circle({ x: lcx, y: lcy, radius: R+2, fill: '#001540', stroke: '#1a3a8a', strokeWidth: 2.5 });
        this._lcdBg  = new Konva.Circle({ x: lcx, y: lcy, radius: R, fill: '#020c14' });
        this._loadArc= new Konva.Arc({ x: lcx, y: lcy, innerRadius: R-5, outerRadius: R-3, angle: 0, fill: '#4fc3f7', rotation: -90 });
        this._lcdMain  = new Konva.Text({ x: lcx-R+4, y: lcy-R*.40, width:(R-4)*2, text:'0.0', fontSize:R*.40, fontFamily:'Courier New, monospace', fontStyle:'bold', fill:'#4fc3f7', align:'center' });
        this._lcdUnit  = new Konva.Text({ x: lcx-R+4, y: lcy+R*.10, width:(R-4)*2, text:'%', fontSize:R*.18, fill:'#001540', align:'center' });
        this._lcdEta   = new Konva.Text({ x: lcx-R+4, y: lcy+R*.28, width:(R-4)*2, text:'η=--', fontSize:R*.13, fontFamily:'Courier New, monospace', fill:'#37474f', align:'center' });
        this._lcdV1l   = new Konva.Text({ x: lcx-R+4, y: lcy-R*.62, width:(R-4)*2, text:'V1=--', fontSize:R*.12, fontFamily:'Courier New, monospace', fill:'#ff8f00', align:'center' });
        this._lcdV2l   = new Konva.Text({ x: lcx-R+4, y: lcy+R*.46, width:(R-4)*2, text:'V2=--', fontSize:R*.12, fontFamily:'Courier New, monospace', fill:'#42a5f5', align:'center' });

        this.group.add(ring, this._lcdBg, this._loadArc, this._lcdMain, this._lcdUnit, this._lcdEta, this._lcdV1l, this._lcdV2l, bg, titleBg);

        // 参数表格（LCD 上方）
        const paramY = ly + 16;
        const params = [
            { label:'V₁线',  id:'v1l',  unit:'kV',   color:'#ff8f00' },
            { label:'V₂线',  id:'v2l',  unit:'V',    color:'#42a5f5' },
            { label:'I₁',    id:'i1',   unit:'A',    color:'#ffd54f' },
            { label:'I₂',    id:'i2',   unit:'A',    color:'#80cbc4' },
            { label:'P₂',    id:'p2',   unit:'kW',   color:'#66bb6a' },
            { label:'P₀',    id:'p0',   unit:'W',    color:'#ef9a9a' },
        ];
        const cellW=(lw-8)/3, cellH=20;
        this._lcdCells={};
        params.forEach(({label,id,unit,color},i)=>{
            const col=i%3, row=Math.floor(i/3);
            const cx3=lx+4+col*(cellW+2), cy3=paramY+row*(cellH+2);
            this.group.add(new Konva.Rect({x:cx3,y:cy3,width:cellW,height:cellH,fill:'#0d1520',cornerRadius:2}));
            this.group.add(new Konva.Text({x:cx3+2,y:cy3+2,text:label,fontSize:7,fill:'#37474f'}));
            const val=new Konva.Text({x:cx3+2,y:cy3+9,width:cellW-4,text:'--',fontSize:cellH*0.42,fontFamily:'Courier New, monospace',fontStyle:'bold',fill:color,align:'right'});
            this.group.add(new Konva.Text({x:cx3+2,y:cy3+cellH-9,width:cellW-4,text:unit,fontSize:6.5,fill:'#1a252f',align:'right'}));
            this._lcdCells[id]=val;
            this.group.add(val);
        });
    }

    // ── 负载/参数面板 ────────────────────────
    _drawLoadPanel() {
        const px = this._panelX, py = this._panelY, pw = this._panelW, ph = this._panelH;

        const bg = new Konva.Rect({ x: px, y: py, width: pw, height: ph, fill: '#020c14', stroke: '#1a3040', strokeWidth: 1.5, cornerRadius: 4 });
        const titleBg = new Konva.Rect({ x: px, y: py, width: pw, height: 13, fill: '#0a1a28', cornerRadius: [4,4,0,0] });
        this.group.add(new Konva.Text({ x: px+4, y: py+2, width: pw-8, text: '负载调节', fontSize: 8, fontStyle: 'bold', fill: '#80cbc4', align: 'center' }));

        // 负载进度条
        const barX=px+5, barY=py+18, barW=pw-10, barH=12;
        this.group.add(new Konva.Rect({x:barX,y:barY,width:barW,height:barH,fill:'#0d2030',cornerRadius:3}));
        this._loadBar=new Konva.Rect({x:barX,y:barY,width:0,height:barH,fill:'#4fc3f7',cornerRadius:3});
        this.group.add(this._loadBar);

        this._loadText   = new Konva.Text({x:px+4,y:py+34,width:pw-8,text:'空载',fontSize:9,fontFamily:'Courier New, monospace',fill:'#4fc3f7',align:'center'});
        this._oilTempText= new Konva.Text({x:px+4,y:py+ph-16,width:pw-8,text:`油温: ${this.oilTemp.toFixed(0)}°C`,fontSize:8.5,fill:'#80cbc4',align:'center'});

        // 拖拽
        const hit=new Konva.Rect({x:barX,y:barY-4,width:barW,height:barH+8,fill:'transparent',listening:true});
        hit.on('mousedown touchstart', e=>{
            e.cancelBubble=true;
            this._sliderDrag=true;
            this._updateLoad(e,barX,barW);
        });
        const sm=e=>{if(!this._sliderDrag)return; this._updateLoad(e,barX,barW);};
        const su=()=>{this._sliderDrag=false;};
        window.addEventListener('mousemove',sm); window.addEventListener('touchmove',sm,{passive:true});
        window.addEventListener('mouseup',su); window.addEventListener('touchend',su);
        this.group.add(hit);

        this.group.add(bg, titleBg, this._loadText, this._oilTempText);
        this._barX=barX; this._barW=barW;
    }

    _updateLoad(e, barX, barW) {
        const stage=this.group.getStage?.();
        const pos=stage?.getPointerPosition?.()??{x:e.evt?.clientX??e.clientX??0};
        const relX=pos.x-(this.group.x?.()??0)-barX;
        const ratio=Math.max(0,Math.min(1,relX/barW));
        // 负载电阻从大（空载）到小（满载）
        const rMin=this.V2rated*this.V2rated/(this.ratedKVA*1000);
        const rMax=rMin*200;
        this._manualLoad = ratio < 0.01 ? 0 : rMax - ratio*(rMax-rMin);
    }

    // ── 波形区（六路：三相高低压）────────────
    _drawWaveform() {
        const {_wavX:wx,_wavY:wy,_wavW:ww,_wavH:wh}=this;
        if(wh<16)return;

        const bg=new Konva.Rect({x:wx,y:wy,width:ww,height:wh,fill:'#010d18',stroke:'#1a3040',strokeWidth:1.5,cornerRadius:4});
        const titleBg=new Konva.Rect({x:wx,y:wy,width:ww,height:13,fill:'#0a1a28',cornerRadius:[4,4,0,0]});
        this.group.add(new Konva.Text({x:wx+4,y:wy+2,width:ww-8,text:'高压三相电压 V1_a/b/c ── 低压三相电压 V2_a/b/c',fontSize:8,fontStyle:'bold',fill:'#80cbc4',align:'center'}));

        const h6=(wh-13)/6;
        this._wavMids=Array.from({length:6},(_,i)=>wy+13+h6*(i+0.5));
        this._wavMids.forEach(my=>this.group.add(new Konva.Line({points:[wx+2,my,wx+ww-2,my],stroke:'rgba(200,200,200,0.07)',strokeWidth:0.5,dash:[4,3]})));

        const hiCols=['#ef5350','#66bb6a','#42a5f5'];
        const loCols=['#ef9a9a','#a5d6a7','#90caf9'];
        this._wLinesV1=[]; this._wLinesV2=[];
        for(let i=0;i<3;i++){
            const wl1=new Konva.Line({points:[],stroke:hiCols[i],strokeWidth:1.6,lineJoin:'round'});
            const wl2=new Konva.Line({points:[],stroke:loCols[i],strokeWidth:1.5,lineJoin:'round'});
            this._wLinesV1.push(wl1); this._wLinesV2.push(wl2);
            const phN=['A','B','C'];
            this.group.add(new Konva.Text({x:wx+4,y:wy+13+h6*i+4,text:'V1'+phN[i],fontSize:8,fill:hiCols[i]}));
            this.group.add(new Konva.Text({x:wx+4,y:wy+13+h6*(i+3)+4,text:'V2'+phN[i],fontSize:8,fill:loCols[i]}));
        }
        this._wV1Lbl=new Konva.Text({x:wx+ww-80,y:wy+13+4,width:76,text:'--kV',fontSize:8,fontFamily:'Courier New, monospace',fill:'#ff8f00',align:'right'});
        this._wV2Lbl=new Konva.Text({x:wx+ww-80,y:wy+13+h6*3+4,width:76,text:'--V',fontSize:8,fontFamily:'Courier New, monospace',fill:'#42a5f5',align:'right'});

        this.group.add(bg,titleBg,...this._wLinesV1,...this._wLinesV2,this._wV1Lbl,this._wV2Lbl);
        this._wavH6=h6;
    }

    // ── 拖拽（铁芯区域）─────────────────────
    _setupDrag() {
        const hit=new Konva.Rect({x:this._coreX,y:this._coreY,width:this._coreW,height:this._coreH,fill:'transparent',listening:true});
        hit.on('mousedown touchstart',e=>{
            e.cancelBubble=true;
            this._dragStartY=e.evt.clientY??e.evt.touches?.[0]?.clientY??0;
            this._dragStartLoad=this._manualLoad;
            this._dragActive=true;
        });
        const mv=e=>{
            if(!this._dragActive)return;
            const cy2=e.clientY??e.touches?.[0]?.clientY??0;
            const rMin=this.V2rated*this.V2rated/(this.ratedKVA*1000);
            const rMax=rMin*200;
            const delta=(this._dragStartY-cy2)*(rMax/this._coreH);
            this._manualLoad=Math.max(0,Math.min(rMax,this._dragStartLoad+delta));
        };
        const up=()=>{this._dragActive=false;};
        window.addEventListener('mousemove',mv); window.addEventListener('touchmove',mv,{passive:true});
        window.addEventListener('mouseup',up); window.addEventListener('touchend',up);
        this.group.add(hit);
    }

    // ═══════════════════════════════════════════
    // 集中化 tick（由 consys._tickAll 在 20fps 调用）
    tick(dt) {
        this._tickPhysics(dt);
        this._tickFluxViz(dt);
        this._tickCoilCurrents(dt);
        this._tickWaveform(dt);
        this._tickDisplay();
        this._refreshCache();
    }


    // ── 电气计算 ─────────────────────────────
    _tickPhysics(dt) {
        this.loadR = this._manualLoad;
        const omega = 2*Math.PI*this.frequency;

        // 高压相电压（根据接法）
        const V1line = this.V1apply;
        const conn   = this.connection;
        const V1phase= conn.startsWith('D') ? V1line : V1line/Math.sqrt(3);

        // 副边相电压（变比计算）
        const V2phase_oc = V1phase * this.N2/this.N1;

        // 副边线电压（根据低压接法）
        const isLoD = conn.endsWith('d') || conn.endsWith('D');
        const V2line_oc = isLoD ? V2phase_oc : V2phase_oc*Math.sqrt(3);

        // 负载电流与端电压（简化：忽略内阻压降的一阶效果）
        let V2phase=V2phase_oc, I2phase=0;
        if(this.loadR>0.5){
            const Ztotal=Math.sqrt(Math.pow(this.R2+this.R1/this.k/this.k,2)+Math.pow(this.X2+this.X1/this.k/this.k,2));
            const Zload = this.loadR / (isLoD ? 1 : 3);  // 简化
            I2phase = V2phase_oc / (Zload + Ztotal*V2phase_oc/V1phase);
            V2phase = I2phase * Zload;
        }

        const V2line = isLoD ? V2phase : V2phase*Math.sqrt(3);
        const I1phase= I2phase*this.N2/this.N1;

        // 励磁电流（空载）
        this.I0 = (this.I0pct/100) * this.ratedKVA*1000/(Math.sqrt(3)*V1line);

        // 功率
        this.P0   = 3*V1phase*V1phase/this.Rm;
        this.Pcu  = 3*I1phase*I1phase*this.R1 + 3*I2phase*I2phase*this.R2;
        this.Pout = 3*V2phase*I2phase*this.loadPF;
        this.Pin  = this.Pout + this.P0 + this.Pcu;
        this.efficiency = this.Pin>10 ? Math.min(99.9,this.Pout/this.Pin*100) : 0;

        const ratedI2 = this.ratedKVA*1000/(Math.sqrt(3)*V2line_oc);
        this.loadFactor = ratedI2>0 ? Math.min(1.5, I2phase/ratedI2) : 0;

        this.I1phase   = I1phase + this.I0;
        this.I2phase   = I2phase;
        this.V1line    = V1line;
        this.V2line    = V2line;
        this.V2phase   = V2phase;
        this.V1phase   = V1phase;

        // 油温（随负载升温）
        const targetOilT = 25 + this.loadFactor*55 + this.P0*0.001;
        this.oilTemp += (targetOilT - this.oilTemp) * Math.min(1, dt*0.02);

        // 最大磁通
        this.Phi_m = V1phase/(4.44*this.frequency*this.N1);

        // 负载弧
        if(this._loadArc){
            this._loadArc.angle(Math.min(1,this.loadFactor)*360);
            this._loadArc.fill(this.loadFactor>1?'#ef5350':this.loadFactor>0.8?'#ffa726':'#4fc3f7');
        }

        this._fluxPhase += dt*omega;
        this._phase     += dt*3;
        this._time      += dt;
    }

    // ── 磁通可视化（三柱相位差120°）──────────
    _tickFluxViz(dt) {
        const phOffsets = [0, -2*Math.PI/3, 2*Math.PI/3]; // A/B/C 相位偏移
        const phColors  = ['rgba(239,83,80,', 'rgba(102,187,106,', 'rgba(66,165,245,'];

        this._fluxGroups.forEach((g, pi) => {
            g.destroyChildren();
            const fluxVal = this.Phi_m * Math.sin(this._fluxPhase + phOffsets[pi]);
            const fluxAbs = Math.abs(fluxVal);
            const fluxDir = fluxVal >= 0 ? 1 : -1;

            const lx = this._legXs[pi], cx2 = this._legCXs[pi];
            const ly = this._legY, lh = this._legH, lw = this._legW;
            const topY= this._coreY + this._yokeH/2;
            const botY= this._coreY + this._coreH - this._yokeH/2;

            if(fluxAbs < 0.0001) return;

            // 磁通路径（柱内+轭内）
            const fluxPath=[
                {x:cx2, y:ly},          // 柱顶
                {x:cx2, y:topY},         // 上轭中
                // （三相共上轭，简化为竖向流动）
                {x:cx2, y:botY},
                {x:cx2, y:ly+lh},
            ];

            const nP = 5;
            const intensity = Math.min(1, fluxAbs/this.Phi_m);
            for(let i=0;i<nP;i++){
                const progress=((this._fluxPhase*0.12+i/nP)%1+1)%1;
                const pathPct=fluxDir>0?progress:1-progress;
                const segIdx=Math.floor(pathPct*(fluxPath.length-1));
                const segFrac=pathPct*(fluxPath.length-1)-segIdx;
                const p1=fluxPath[Math.min(segIdx,fluxPath.length-1)];
                const p2=fluxPath[Math.min(segIdx+1,fluxPath.length-1)];
                const px=p1.x+(p2.x-p1.x)*segFrac;
                const py=p1.y+(p2.y-p1.y)*segFrac;
                g.add(new Konva.Circle({x:px,y:py,radius:3,fill:`${phColors[pi]}${intensity*0.65})`}));
            }
        });

        // 漏磁通
        this._leakGroups.forEach((g, pi) => {
            g.destroyChildren();
            const fluxVal = this.Phi_m * Math.sin(this._fluxPhase + [0,-2*Math.PI/3,2*Math.PI/3][pi]);
            const fA = Math.min(0.22, Math.abs(fluxVal)/this.Phi_m * 0.22) * (1+this.I2phase*0.1);
            if(fA < 0.02) return;
            const lx=this._legXs[pi], lw=this._legW, ly=this._legY, lh=this._legH;
            const windH=lh*0.85, windY=ly+(lh-lh*0.85)/2;
            for(let r=1;r<=3;r++){
                g.add(new Konva.Ellipse({x:lx+lw/2,y:windY+windH/2,radiusX:lw/2+8+r*5,radiusY:windH*0.4+r*3,fill:'none',stroke:`rgba(255,167,38,${fA*(1-r*0.25)})`,strokeWidth:1,dash:[3,3]}));
            }
        });
    }

    // ── 绕组电流可视化 ───────────────────────
    _tickCoilCurrents(dt) {
        if(!this._hiCoilGroups) return;
        const phase = this._fluxPhase;
        const iNorm1 = Math.min(1, this.I1phase/(this.ratedKVA*1000/(Math.sqrt(3)*this.V1rated)+0.01));
        const iNorm2 = Math.min(1, this.I2phase/(this.ratedKVA*1000/(Math.sqrt(3)*this.V2rated)+0.01));

        const phOffsets=[0,-2*Math.PI/3,2*Math.PI/3];
        this._hiCoilGroups.forEach((g,i)=>{
            const iInst=iNorm1*Math.abs(Math.sin(phase+phOffsets[i]));
            g.opacity(0.45+iInst*0.55);
        });
        this._loCoilGroups?.forEach((g,i)=>{
            const iInst=iNorm2*Math.abs(Math.sin(phase+phOffsets[i]+Math.PI));
            g.opacity(0.45+iInst*0.55);
        });
    }

    // ── 波形缓冲 ─────────────────────────────
    _tickWaveform(dt) {
        if(!this._wavH6) return;
        this._wavAcc+=1.4*dt*this._wavLen;
        const steps=Math.floor(this._wavAcc); this._wavAcc-=steps;

        const omega_e=2*Math.PI*this.frequency;
        const V1pk=this.V1phase*Math.sqrt(2);
        const V2pk=this.V2phase*Math.sqrt(2);
        const phOff=[0,-2*Math.PI/3,2*Math.PI/3];

        const v1Inst=phOff.map(o=>V1pk*Math.sin(this._fluxPhase+o));
        const v2Inst=phOff.map(o=>V2pk*Math.sin(this._fluxPhase+o));

        for(let i=0;i<steps;i++){
            for(let p=0;p<3;p++){
                this._wavV1[p]=new Float32Array([...this._wavV1[p].slice(1),v1Inst[p]]);
                this._wavV2[p]=new Float32Array([...this._wavV2[p].slice(1),v2Inst[p]]);
            }
        }

        const wx=this._wavX+3, ww=this._wavW-6;
        const n=this._wavLen, dx=ww/n, h6=this._wavH6;
        const maxV1=V1pk*1.1+1, maxV2=V2pk*1.1+1;
        const aH=h6*0.42, aL=h6*0.42;

        for(let p=0;p<3;p++){
            const m1=this._wavMids[p], m2=this._wavMids[p+3];
            const pts1=[], pts2=[];
            for(let i=0;i<n;i++){
                const x=wx+i*dx;
                pts1.push(x, m1-(this._wavV1[p][i]/maxV1)*aH);
                pts2.push(x, m2-(this._wavV2[p][i]/maxV2)*aL);
            }
            if(this._wLinesV1[p]) this._wLinesV1[p].points(pts1);
            if(this._wLinesV2[p]) this._wLinesV2[p].points(pts2);
        }
        if(this._wV1Lbl) this._wV1Lbl.text(`${(this.V1line/1000).toFixed(2)}kV`);
        if(this._wV2Lbl) this._wV2Lbl.text(`${this.V2line.toFixed(1)}V`);
    }

    // ── LCD 刷新 ─────────────────────────────
    _tickDisplay() {
        const lp = this.loadFactor*100;
        const mc = lp>100?'#ef5350':lp>80?'#ffa726':'#4fc3f7';

        if(this._lcdBg)   this._lcdBg.fill('#020c14');
        if(this._lcdMain){this._lcdMain.text(lp.toFixed(1)); this._lcdMain.fill(mc);}
        if(this._lcdEta)  this._lcdEta.text(`η=${this.efficiency.toFixed(1)}%`);
        if(this._lcdV1l)  this._lcdV1l.text(`V1=${(this.V1line/1000).toFixed(2)}k`);
        if(this._lcdV2l)  this._lcdV2l.text(`V2=${this.V2line.toFixed(0)}V`);

        const c=this._lcdCells;
        if(c){
            if(c.v1l) c.v1l.text((this.V1line/1000).toFixed(2));
            if(c.v2l) c.v2l.text(this.V2line.toFixed(1));
            if(c.i1)  c.i1.text(this.I1phase.toFixed(3));
            if(c.i2)  c.i2.text(this.I2phase.toFixed(3));
            if(c.p2)  c.p2.text((this.Pout/1000).toFixed(2));
            if(c.p0)  c.p0.text(this.P0.toFixed(1));
        }

        if(this._loadBar){
            const ratio=Math.min(1,this.loadFactor);
            this._loadBar.width(ratio*this._barW);
            this._loadBar.fill(ratio>1?'#ef5350':ratio>0.8?'#ffa726':'#4fc3f7');
        }
        if(this._loadText) this._loadText.text(this.loadFactor<0.01?'空载':`β=${this.loadFactor.toFixed(3)}  P₂=${(this.Pout/1000).toFixed(2)}kW`);
        if(this._oilTempText) this._oilTempText.text(`油温: ${this.oilTemp.toFixed(1)}°C${this.oilTemp>75?' ⚠':''}  铜损: ${this.Pcu.toFixed(0)}W`);
    }

    // ═══════════════════════════════════════════
    update(V1) {
        if(typeof V1==='number') this.V1apply=Math.max(0,Math.min(this.V1rated*1.1,V1));
        this._refreshCache();
    }

    setLoad(R) {
        this._manualLoad=Math.max(0,R);
        this._refreshCache();
    }

    getConfigFields() {
        return [
            {label:'位号/名称',          key:'id',           type:'text'},
            {label:'额定容量 (kVA)',      key:'ratedKVA',     type:'number'},
            {label:'高压线电压 (V)',      key:'V1rated',      type:'number'},
            {label:'低压线电压 (V)',      key:'V2rated',      type:'number'},
            {label:'高压匝数 N1',         key:'N1',           type:'number'},
            {label:'频率 (Hz)',           key:'frequency',    type:'number'},
            {label:'接线方式',            key:'connection',   type:'select',
             options:['Yyn0','Dyn11','YD11','YNd11'].map(c=>({label:c,value:c}))},
            {label:'短路电压 Uk (%)',     key:'Uk',           type:'number'},
            {label:'空载电流 I0 (%)',     key:'I0pct',        type:'number'},
        ];
    }

    onConfigUpdate(cfg) {
        this.id         = cfg.id         || this.id;
        this.ratedKVA   = parseFloat(cfg.ratedKVA)   || this.ratedKVA;
        this.V1rated    = parseFloat(cfg.V1rated)    || this.V1rated;
        this.V2rated    = parseFloat(cfg.V2rated)    || this.V2rated;
        this.N1         = parseInt(cfg.N1)           || this.N1;
        this.frequency  = parseFloat(cfg.frequency)  || this.frequency;
        this.connection = cfg.connection             || this.connection;
        this.Uk         = parseFloat(cfg.Uk)         || this.Uk;
        this.I0pct      = parseFloat(cfg.I0pct)      || this.I0pct;
        this._calcN2();
        this.config     = {...this.config,...cfg};
        this._refreshCache();
    }

    destroy() {
        super.destroy?.();
    }
}