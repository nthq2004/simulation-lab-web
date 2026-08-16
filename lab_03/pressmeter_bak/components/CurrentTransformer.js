import { BaseComponent } from './BaseComponent.js';

/**
 * 电流互感器仿真组件
 * （Current Transformer，CT）
 *
 * ── 与电压互感器的核心区别 ────────────────────────────────────
 *
 *  电流互感器将大电流按固定比例变换为标准小电流（通常 5A 或 1A），
 *  供测量仪表、继电保护及自动装置使用。
 *
 *  与 VT 的本质差异：
 *  ┌──────────────┬──────────────────────┬──────────────────────┐
 *  │              │  电压互感器 VT        │  电流互感器 CT        │
 *  ├──────────────┼──────────────────────┼──────────────────────┤
 *  │ 一次侧       │ 并联于电网（近似恒压）│ 串联于主回路（近似恒流）│
 *  │ 二次侧       │ 近似开路（高阻负载） │ 近似短路（低阻负载）  │
 *  │ 铁芯工作点   │ 高磁通密度（1.0~1.5T）│ 低磁通密度（<0.1T）  │
 *  │ 危险工况     │ 二次短路             │ 二次开路（高压危险）  │
 *  │ 等效模型     │ 励磁电流为误差来源   │ 励磁电流为误差来源   │
 *  │ 匝数比       │ N1 >> N2             │ N1 << N2（通常N1=1）  │
 *  └──────────────┴──────────────────────┴──────────────────────┘
 *
 * ── 工作原理 ──────────────────────────────────────────────────
 *
 *  1. 基本变换关系：
 *     理想变比：K_i = I1 / I2 = N2 / N1
 *     实际：I1×N1 = I2×N2 + I0×N2（励磁安匝不可忽略）
 *     电流误差（比差）：f_i = (K_i×I2 - I1) / I1 × 100%
 *     相位误差（角差）：δ_i（二次电流相量与一次电流相量夹角，单位 min）
 *
 *  2. 等效电路（折算至二次侧）：
 *     一次侧电流源：I1/K_i（恒流源，几乎不受二次侧影响）
 *     励磁支路：Rm ∥ jXm（并联，消耗一部分安匝）
 *     二次侧：R2（二次绕组电阻）+ jX2（二次漏抗）+ Z_b（负载阻抗）
 *
 *     核心约束：二次侧总阻抗 Z_total = R2 + X2 + Z_b 必须极小，
 *     否则励磁电流占比增大 → 误差增大 → 甚至铁芯饱和。
 *
 *  3. 二次开路危险机制（★重点★）：
 *     正常工作：I1×N1 ≈ I2×N2，磁通很小（B < 0.1T）
 *     二次开路：I2=0，I1×N1 全部用于励磁
 *     → 磁通极大（铁芯深度饱和，B >> Bsat）
 *     → 二次侧感应出极高电动势（kV 量级）：
 *       e2 = N2 × dΦ/dt（在磁通过零时 dΦ/dt 极大）
 *     → 严重威胁人身安全和设备绝缘
 *     仿真：二次开路时显示高压警告动画，铁芯饱和指示
 *
 *  4. 误差形成机制：
 *     励磁电流 I0 在铁芯中建立磁通，是误差的根本来源：
 *     I1 = I2' + I0（相量式，折算至二次侧）
 *     比差：f_i ≈ -(I0×cosδ0) / I1 × 100%
 *       其中 δ0 = arctan(Rm/Xm)（励磁阻抗角）
 *     角差：δ_i ≈ (I0×sinδ0) / I1 × 3438（min）
 *     负载阻抗 Z_b 增大 → 二次电压升高 → 励磁电流增大 → 误差增大
 *
 *  5. 铁芯饱和与暂态特性：
 *     CT 铁芯饱和条件：ω×N2×Bsat×A_core < I1×N1/Z_total × R_total
 *     暂态饱和（直流分量）：故障电流含直流分量时，
 *       铁芯可能在几毫秒内饱和，导致保护装置误动。
 *     仿真中：当负载阻抗或一次电流超过额定时，
 *     逐渐显示铁芯饱和效果（磁通密度趋近 Bsat）。
 *
 *  6. 精度等级（IEC 61869-2）：
 *     测量用：0.1/0.2/0.5/1/3/5 级（电流误差±%）
 *     保护用：5P/10P（组合误差限值）
 *     特殊保护：PR（剩磁受限）、PX（低漏磁）
 *     额定准确限值系数 ALF（Accuracy Limit Factor）：
 *       在 ALF 倍额定电流下，综合误差 ≤ 5%（5P）或 10%（10P）
 *
 *  7. 一次绕组结构：
 *     穿心式（贯穿导体，N1=1）：大电流CT常用，结构简单
 *     多匝式（线圈，N1>1）：小电流CT，灵敏度高
 *     本仿真默认穿心式（N1=1，母线穿过铁芯窗口）
 *
 * ── 组件结构 ──────────────────────────────────────────────────
 *  ① 铁芯截面图（环形铁芯，穿心母线，二次绕组密绕）
 *  ② 二次开路危险警告动画（高压弧光 + 警告文字）
 *  ③ 铁芯饱和指示（B-H 工作区域可视化）
 *  ④ T 形等效电路图（恒流源模型，Rm/Xm/R2/X2/Zb 标注）
 *  ⑤ 相量图（I1、I2'、I0、误差相量，动态旋转）
 *  ⑥ B-H 励磁特性曲线（含工作点，饱和区标示）
 *  ⑦ 误差特性曲线（fi vs I/In，精度等级带，ALF 标注）
 *  ⑧ 波形区（I1、I2×K、I0、ΔI、二次电压 U2）
 *  ⑨ LCD 仪表（I1/I2/变比误差/角差/励磁电流/铁损/负载VA/饱和状态）
 *  ⑩ 控制面板（一次电流调节、二次负载调节、开路/短路切换、精度等级选择）
 *
 * ── 端口 ─────────────────────────────────────────────────────
 *  pri_p1    — 一次侧 P1 端（母线穿心入）
 *  pri_p2    — 一次侧 P2 端（母线穿心出）
 *  sec_s1    — 二次侧 S1 端
 *  sec_s2    — 二次侧 S2 端（接地端）
 */
export class CurrentTransformer extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.width  = Math.max(560, config.width  || 660);
        this.height = Math.max(420, config.height || 520);

        this.type    = 'current_transformer';
        this.special = 'none';
        this.cache   = 'fixed';

        // ── 额定参数 ──
        this.ratedI1     = config.ratedI1     || 200;    // A（一次额定电流）
        this.ratedI2     = config.ratedI2     || 5;      // A（二次额定电流）
        this.ratedVA     = config.ratedVA     || 15;     // VA（额定负荷）
        this.frequency   = config.frequency   || 50;     // Hz
        this.accuracy    = config.accuracy    || '0.5';  // 精度等级
        this.ALF         = config.ALF         || 10;     // 准确限值系数（Accuracy Limit Factor）
        this.turnsN1     = config.turnsN1     || 1;      // 一次匝数（穿心式=1）
        this.turnsN2     = config.turnsN2     || Math.round(this.ratedI1 / this.ratedI2); // 二次匝数

        // 额定变比
        this.ratioK  = this.ratedI1 / this.ratedI2;     // = N2/N1

        // ── 等效电路参数（折算至二次侧） ──
        this.R2      = config.R2   || 0.5;    // Ω（二次绕组电阻）
        this.X2      = config.X2   || 0.3;    // Ω（二次漏抗）
        this.Rm      = config.Rm   || 800;    // Ω（励磁铁损电阻，折算至二次）
        this.Xm      = config.Xm   || 600;    // Ω（励磁感抗，折算至二次）

        // 励磁阻抗（并联）
        this.Zm      = Math.sqrt(this.Rm**2 * this.Xm**2 / (this.Rm**2 + this.Xm**2));
        this.phi0    = Math.atan(this.Rm / this.Xm);   // 励磁阻抗角（rad）

        // 额定负荷阻抗（额定 VA 下）
        this.Zb_rated= this.ratedVA / this.ratedI2**2; // Ω

        // ── 铁芯参数 ──
        this.coreArea    = config.coreArea   || 20e-4;  // m²（铁芯截面积，20cm²）
        this.coreMeanLen = config.coreMeanLen|| 0.6;    // m（磁路平均长度）
        this.Brated      = config.Brated     || 0.08;   // T（额定磁通密度，CT很低）
        this.Bsat        = config.Bsat       || 1.6;    // T（饱和磁通密度）
        this.mu0         = 4 * Math.PI * 1e-7;

        // ── 精度等级误差限（IEC 61869-2） ──
        this._accuracyLimits = {
            '0.1': { fi: 0.1,  delta: 5,   composite: null },
            '0.2': { fi: 0.2,  delta: 10,  composite: null },
            '0.5': { fi: 0.5,  delta: 20,  composite: null },
            '1':   { fi: 1.0,  delta: 40,  composite: null },
            '3':   { fi: 3.0,  delta: 120, composite: null },
            '5':   { fi: 5.0,  delta: 240, composite: null },
            '5P':  { fi: 1.0,  delta: 60,  composite: 5   },
            '10P': { fi: 3.0,  delta: 120, composite: 10  },
        };

        // ── 运行状态 ──
        this._wavePhase   = 0;
        this._i1Set       = this.ratedI1;        // 设定一次电流 A
        this._zbSet       = this.Zb_rated;       // 设定二次负载阻抗 Ω
        this._secOpen     = false;               // 二次侧是否开路（危险状态）
        this._openWarnPh  = 0;                   // 开路警告动画相位
        this._satLevel    = 0;                   // 饱和程度 0~1
        this._phasorAngle = 0;

        // 电气量（有效值）
        this.i1Rms        = 0;
        this.i2Rms        = 0;
        this.i0Rms        = 0;
        this.u2Rms        = 0;        // 二次端电压
        this.fluxDensity  = 0;        // T（瞬时磁通密度）
        this.fluxPeak     = 0;        // T（峰值磁通密度）
        this.errorFi      = 0;        // 比差 %
        this.errorDelta   = 0;        // 角差 min
        this.ironLoss     = 0;        // W
        this.loadVA       = 0;        // VA

        // ── 波形缓冲 ──
        this._wavLen   = 240;
        this._wavI1    = new Float32Array(this._wavLen).fill(0);
        this._wavI2k   = new Float32Array(this._wavLen).fill(0); // I2×K（折算至一次）
        this._wavI0    = new Float32Array(this._wavLen).fill(0);
        this._wavDI    = new Float32Array(this._wavLen).fill(0); // 误差电流 ΔI
        this._wavU2    = new Float32Array(this._wavLen).fill(0); // 二次端电压
        this._wavB     = new Float32Array(this._wavLen).fill(0); // 磁通密度

        // ── 几何布局 ──
        // 铁芯截面 + 绕组（左上，环形铁芯）
        this._coreX  = Math.round(this.width * 0.03);
        this._coreY  = Math.round(this.height * 0.04);
        this._coreW  = Math.round(this.width * 0.30);
        this._coreH  = Math.round(this.height * 0.48);
        this._coreCX = this._coreX + this._coreW / 2;
        this._coreCY = this._coreY + this._coreH / 2;

        // T 形等效电路（右上）
        this._eqX    = Math.round(this.width * 0.36);
        this._eqY    = this._coreY;
        this._eqW    = Math.round(this.width * 0.60);
        this._eqH    = Math.round(this.height * 0.24);

        // 相量图（左中）
        this._phX    = this._coreX;
        this._phY    = this._coreY + this._coreH + 8;
        this._phW    = this._coreW;
        this._phH    = Math.round(this.height * 0.20);

        // B-H 曲线（中）
        this._bhX    = Math.round(this.width * 0.36);
        this._bhY    = this._eqY + this._eqH + 8;
        this._bhW    = Math.round(this.width * 0.28);
        this._bhH    = Math.round(this.height * 0.26);

        // 误差特性曲线（右中）
        this._errX   = this._bhX + this._bhW + 8;
        this._errY   = this._bhY;
        this._errW   = this.width - this._errX - Math.round(this.width * 0.03);
        this._errH   = this._bhH;

        // LCD（左下）
        this._lcdX   = this._coreX;
        this._lcdY   = this._phY + this._phH + 8;
        this._lcdW   = this._coreW;
        this._lcdH   = Math.round(this.height * 0.22);

        // 控制面板（中下）
        this._panX   = this._bhX;
        this._panY   = this._bhY + this._bhH + 8;
        this._panW   = this.width - this._bhX - Math.round(this.width * 0.03);
        this._panH   = Math.round(this.height * 0.16);

        // 波形（底部全宽）
        this._wavX   = this._coreX;
        this._wavY   = Math.max(this._lcdY + this._lcdH, this._panY + this._panH) + 6;
        this._wavW   = this.width - this._coreX * 2;
        this._wavH   = this.height - this._wavY - 6;


        this.config = {
            id: this.id,
            ratedI1: this.ratedI1,
            ratedI2: this.ratedI2,
            ratedVA: this.ratedVA,
            accuracy: this.accuracy,
            ALF: this.ALF,
        };

        this._init();

        // 端口
        this.addPort(this._coreCX - 20, this._coreY - 8, 'pri_p1', 'wire', 'P1');
        this.addPort(this._coreCX + 20, this._coreY - 8, 'pri_p2', 'wire', 'P2');
        const secX = this._coreX + this._coreW + 6;
        this.addPort(secX, this._coreCY - 16, 'sec_s1', 'wire', 'S1');
        this.addPort(secX, this._coreCY + 16, 'sec_s2', 'wire', 'S2(⏚)');
    }

    // ═══════════════════════════════════════════
    _init() {
        this._drawLabel();
        this._drawCoreAndWindings();
        this._drawFluxLayer();
        this._drawOpenCircuitWarningLayer();
        this._drawEquivCircuit();
        this._drawPhasorDiagram();
        this._drawBHCurve();
        this._drawErrorCurve();
        this._drawLCDPanel();
        this._drawControlPanel();
        this._drawWaveform();
        
    }

    _drawLabel() {
        this.group.add(new Konva.Text({
            x: 0, y: -22, width: this.width,
            text: `电流互感器（CT）  ${this.ratedI1}A / ${this.ratedI2}A  变比 ${this.ratioK}:1  ${this.ratedVA}VA  精度 ${this.accuracy} 级  ALF=${this.ALF}`,
            fontSize: 11, fontStyle: 'bold', fill: '#1a2634', align: 'center',
        }));
    }

    // ── 铁芯截面（环形）+ 穿心母线 + 二次绕组 ──
    _drawCoreAndWindings() {
        const { _coreX: ex, _coreY: ey, _coreW: ew, _coreH: eh,
                _coreCX: ecx, _coreCY: ecy } = this;

        // 背板
        this.group.add(new Konva.Rect({
            x: ex, y: ey, width: ew, height: eh,
            fill: '#0d1a24', stroke: '#1a3040', strokeWidth: 1.5, cornerRadius: 5,
        }));
        this.group.add(new Konva.Text({
            x: ex, y: ey - 14, width: ew,
            text: '铁芯截面图（环形，穿心式）', fontSize: 9, fontStyle: 'bold',
            fill: '#546e7a', align: 'center',
        }));

        // ── 环形铁芯（叠片硅钢） ──
        const coreOuter = Math.round(Math.min(ew, eh) * 0.44);
        const coreInner = Math.round(coreOuter * 0.52);
        const coreCol   = '#455a64', coreEdge = '#263238';

        // 外圆
        this.group.add(new Konva.Circle({
            x: ecx, y: ecy, radius: coreOuter,
            fill: coreCol, stroke: coreEdge, strokeWidth: 2,
        }));
        // 叠片纹（环形，径向线）
        const nLamination = 24;
        for (let i = 0; i < nLamination; i++) {
            const a = (i / nLamination) * Math.PI * 2;
            this.group.add(new Konva.Line({
                points: [
                    ecx + coreInner * Math.cos(a), ecy + coreInner * Math.sin(a),
                    ecx + coreOuter * Math.cos(a), ecy + coreOuter * Math.sin(a),
                ],
                stroke: 'rgba(0,0,0,0.18)', strokeWidth: 0.7,
            }));
        }
        // 内孔（窗口，穿母线用）
        this.group.add(new Konva.Circle({
            x: ecx, y: ecy, radius: coreInner,
            fill: '#08111a', stroke: coreEdge, strokeWidth: 1,
        }));

        // 铁芯高光
        this.group.add(new Konva.Arc({
            x: ecx - coreOuter * 0.18, y: ecy - coreOuter * 0.18,
            innerRadius: coreOuter * 0.80, outerRadius: coreOuter,
            angle: 60, rotation: -150,
            fill: 'rgba(255,255,255,0.06)',
        }));

        this.group.add(new Konva.Text({
            x: ecx - 28, y: ecy + coreInner * 0.3,
            text: '铁芯窗口', fontSize: 7.5, fill: '#37474f',
        }));

        // ── 穿心一次母线（横穿铁芯窗口） ──
        const busW  = Math.round(coreInner * 1.3);
        const busH  = 10;
        const busY  = ecy - busH / 2;

        // 一次母线绝缘层
        this.group.add(new Konva.Rect({
            x: ecx - busW / 2 - 4, y: busY - 3, width: busW + 8, height: busH + 6,
            fill: '#1a2a1a', stroke: '#2a4a2a', strokeWidth: 0.8, cornerRadius: 2,
        }));
        // 铜导体
        this._busBar = new Konva.Rect({
            x: ecx - busW / 2, y: busY, width: busW, height: busH,
            fill: '#b8860b', stroke: '#8b6914', strokeWidth: 0.8, cornerRadius: 1,
        });
        this.group.add(this._busBar);

        // 母线延伸至外侧（P1/P2 端子）
        this.group.add(new Konva.Rect({
            x: ex + 6, y: busY, width: ecx - busW/2 - ex - 6, height: busH,
            fill: '#b8860b', stroke: '#8b6914', strokeWidth: 0.8,
        }));
        this.group.add(new Konva.Rect({
            x: ecx + busW/2, y: busY, width: ex + ew - ecx - busW/2 - 6, height: busH,
            fill: '#b8860b', stroke: '#8b6914', strokeWidth: 0.8,
        }));

        // P1/P2 端子圆点
        this.group.add(new Konva.Circle({ x: ex + 14, y: ecy, radius: 5, fill: '#b8860b', stroke: '#8b6914', strokeWidth: 1 }));
        this.group.add(new Konva.Circle({ x: ex + ew - 14, y: ecy, radius: 5, fill: '#b8860b', stroke: '#8b6914', strokeWidth: 1 }));
        this.group.add(new Konva.Text({ x: ex + 6, y: ecy - 15, text: 'P1', fontSize: 8, fill: '#ffd54f', fontStyle: 'bold' }));
        this.group.add(new Konva.Text({ x: ex + ew - 22, y: ecy - 15, text: 'P2', fontSize: 8, fill: '#ffd54f', fontStyle: 'bold' }));
        this.group.add(new Konva.Arrow({
            points: [ex + 20, ecy - 18, ex + ew - 20, ecy - 18],
            stroke: '#ffd54f', fill: '#ffd54f', strokeWidth: 1,
            pointerLength: 5, pointerWidth: 4,
        }));
        this.group.add(new Konva.Text({
            x: ecx - 16, y: ecy - 26,
            text: `I₁=${this.ratedI1}A`, fontSize: 7.5, fill: '#ffd54f',
        }));

        // N1 匝数标注
        this.group.add(new Konva.Text({
            x: ecx - 14, y: ecy + busH/2 + 4,
            text: `N₁=${this.turnsN1}（穿心）`, fontSize: 7, fill: '#ffd54f',
        }));

        // ── 二次绕组（密绕在环形铁芯上） ──
        const turnN2vis = Math.min(30, this.turnsN2);
        const w2Colors  = ['#1565c0', '#1976d2', '#42a5f5'];
        this._w2Group   = new Konva.Group();
        for (let i = 0; i < turnN2vis; i++) {
            const a   = (i / turnN2vis) * Math.PI * 2 - Math.PI / 2;
            const mid = (coreOuter + coreInner) / 2;
            const rx  = ecx + mid * Math.cos(a);
            const ry  = ecy + mid * Math.sin(a);
            const tang= a + Math.PI / 2;
            const col = w2Colors[i % 3];
            this._w2Group.add(new Konva.Line({
                points: [
                    rx + 3 * Math.cos(tang), ry + 3 * Math.sin(tang),
                    rx - 3 * Math.cos(tang), ry - 3 * Math.sin(tang),
                ],
                stroke: col, strokeWidth: 2.5, lineCap: 'round', opacity: 0.85,
            }));
        }
        this.group.add(this._w2Group);

        // 二次绕组出线端（S1/S2）
        const secTermX = ex + ew + 10;
        this.group.add(new Konva.Line({
            points: [ecx + coreOuter * 0.7, ecy - 16, secTermX, ecy - 16],
            stroke: '#1565c0', strokeWidth: 2, lineCap: 'round',
        }));
        this.group.add(new Konva.Line({
            points: [ecx + coreOuter * 0.7, ecy + 16, secTermX, ecy + 16],
            stroke: '#1976d2', strokeWidth: 2, lineCap: 'round',
        }));
        this.group.add(new Konva.Circle({ x: secTermX, y: ecy - 16, radius: 3.5, fill: '#1565c0', stroke: '#0d47a1', strokeWidth: 0.8 }));
        this.group.add(new Konva.Circle({ x: secTermX, y: ecy + 16, radius: 3.5, fill: '#1976d2', stroke: '#0d47a1', strokeWidth: 0.8 }));

        // 接地符号（S2 端）
        [0, 1, 2].forEach(i => this.group.add(new Konva.Line({
            points: [secTermX - (i+1)*3, ecy+22+(i*4), secTermX + (i+1)*3, ecy+22+(i*4)],
            stroke: '#4caf50', strokeWidth: 1.5 - i * 0.4,
        })));

        this.group.add(new Konva.Text({ x: secTermX + 4, y: ecy - 22, text: 'S1', fontSize: 8, fill: '#90caf9', fontStyle: 'bold' }));
        this.group.add(new Konva.Text({ x: secTermX + 4, y: ecy + 12, text: 'S2\n(⏚)', fontSize: 8, fill: '#90caf9', lineHeight: 1.3 }));
        this.group.add(new Konva.Text({
            x: ecx + coreOuter * 0.4, y: ecy + coreOuter * 0.6,
            text: `N₂=${this.turnsN2}匝`, fontSize: 8, fill: '#90caf9',
        }));

        // 绕组发光层
        this._w2Glow = new Konva.Ring({
            x: ecx, y: ecy,
            innerRadius: coreInner, outerRadius: coreOuter,
            fill: 'rgba(21,101,192,0)',
        });
        this.group.add(this._w2Glow);

        // 保存几何参数
        this._coreOuter = coreOuter;
        this._coreInner = coreInner;
        this._busY      = busY;
        this._busH      = busH;
        this._secTermX  = secTermX;
    }

    // ── 磁通粒子层 ──────────────────────────
    _drawFluxLayer() {
        this._fluxGroup = new Konva.Group();
        this.group.add(this._fluxGroup);
    }

    // ── 二次开路高压警告层 ───────────────────
    _drawOpenCircuitWarningLayer() {
        this._warnGroup = new Konva.Group({ opacity: 0 });

        // 高压警告框
        this._warnBg = new Konva.Rect({
            x: this._coreX + 4, y: this._coreY + this._coreH * 0.08,
            width: this._coreW - 8, height: this._coreH * 0.35,
            fill: 'rgba(198,40,40,0.85)', stroke: '#ef5350', strokeWidth: 2,
            cornerRadius: 6,
        });
        this._warnText1 = new Konva.Text({
            x: this._coreX + 4, y: this._coreY + this._coreH * 0.12,
            width: this._coreW - 8,
            text: '⚡ 危险 ⚡', fontSize: 14, fontStyle: 'bold',
            fill: '#ffeb3b', align: 'center',
        });
        this._warnText2 = new Konva.Text({
            x: this._coreX + 4, y: this._coreY + this._coreH * 0.22,
            width: this._coreW - 8,
            text: '二次侧开路！\n铁芯饱和\n二次电压 >> kV\n威胁人身安全！',
            fontSize: 9, fontStyle: 'bold',
            fill: '#ffffff', align: 'center', lineHeight: 1.5,
        });

        // 高压电弧动画粒子（二次端子旁）
        this._warnArcs = [];
        for (let i = 0; i < 4; i++) {
            const arc = new Konva.Line({
                points: [], stroke: '#ffeb3b', strokeWidth: 1.5, lineJoin: 'round',
            });
            this._warnArcs.push(arc);
            this._warnGroup.add(arc);
        }

        this._warnGroup.add(this._warnBg, this._warnText1, this._warnText2);
        this.group.add(this._warnGroup);
    }

    // ── T 形等效电路（CT 版，恒流源模型） ──
    _drawEquivCircuit() {
        const { _eqX: ex, _eqY: ey, _eqW: ew, _eqH: eh } = this;

        this.group.add(new Konva.Rect({ x: ex, y: ey, width: ew, height: eh, fill: '#010d18', stroke: '#1a3040', strokeWidth: 1.5, cornerRadius: 4 }));
        this.group.add(new Konva.Rect({ x: ex, y: ey, width: ew, height: 13, fill: '#0a1a28', cornerRadius: [4,4,0,0] }));
        this.group.add(new Konva.Text({ x: ex+4, y: ey+2, width: ew-8, text: 'T 形等效电路（折算至二次侧，恒流源模型）', fontSize: 8, fontStyle: 'bold', fill: '#80cbc4', align: 'center' }));

        const y0   = ey + eh * 0.38;  // 上导线
        const y1   = ey + eh * 0.88;  // 下导线（公共线）
        const x0   = ex + 14;         // 左（恒流源端）
        const xm   = ex + ew * 0.38;  // 励磁支路节点
        const x1   = ex + ew - 14;    // 右（负载端）
        const vH   = y1 - y0;

        // 导线
        this.group.add(new Konva.Line({ points: [x0, y0, x1, y0], stroke: '#546e7a', strokeWidth: 1.5 }));
        this.group.add(new Konva.Line({ points: [x0, y1, x1, y1], stroke: '#546e7a', strokeWidth: 1.5 }));
        this.group.add(new Konva.Line({ points: [x0, y0, x0, y1], stroke: '#ffd54f', strokeWidth: 1.2 }));
        this.group.add(new Konva.Line({ points: [x1, y0, x1, y1], stroke: '#90caf9', strokeWidth: 1.2 }));

        // 恒流源符号（左侧，圆圈+箭头）
        const csR = vH * 0.22;
        const csCX= x0, csCY = (y0 + y1) / 2;
        this.group.add(new Konva.Circle({ x: csCX, y: csCY, radius: csR, fill: '#0d1a28', stroke: '#ffd54f', strokeWidth: 1.5 }));
        this.group.add(new Konva.Arrow({
            points: [csCX, csCY + csR * 0.5, csCX, csCY - csR * 0.5],
            stroke: '#ffd54f', fill: '#ffd54f', strokeWidth: 1.5, pointerLength: 4, pointerWidth: 3,
        }));
        this.group.add(new Konva.Text({ x: csCX - 18, y: ey + 14, text: "I₁'=I₁/K", fontSize: 7.5, fill: '#ffd54f' }));

        // 励磁支路节点
        this.group.add(new Konva.Circle({ x: xm, y: y0, radius: 3, fill: '#80cbc4' }));
        this.group.add(new Konva.Line({ points: [xm, y0, xm, y0 + 6], stroke: '#546e7a', strokeWidth: 1 }));

        // Rm（竖向）
        const rmY0 = y0 + 6, rmH = vH * 0.40;
        this._drawResistor(xm - 14, rmY0, rmH, 7, '#66bb6a', true);
        this.group.add(new Konva.Text({ x: xm - 32, y: rmY0 + rmH * 0.3, text: `Rm\n${this.Rm}Ω`, fontSize: 7, fill: '#66bb6a', lineHeight: 1.3 }));
        this.group.add(new Konva.Line({ points: [xm-14, rmY0+rmH, xm-14, y1, xm+14, y1, xm+14, rmY0+rmH], stroke: '#546e7a', strokeWidth: 1 }));

        // jXm（竖向）
        this._drawInductor(xm + 6, rmY0, rmH, 6, '#ef9a9a', true);
        this.group.add(new Konva.Text({ x: xm + 18, y: rmY0 + rmH * 0.3, text: `jXm\n${this.Xm}Ω`, fontSize: 7, fill: '#ef9a9a', lineHeight: 1.3 }));

        // 励磁电流箭头
        this._i0ArrowEq = new Konva.Arrow({
            points: [xm, y0 + 8, xm, y0 + 20],
            stroke: '#66bb6a', fill: '#66bb6a', strokeWidth: 1.5, pointerLength: 4, pointerWidth: 3,
        });
        this.group.add(this._i0ArrowEq);
        this.group.add(new Konva.Text({ x: xm + 5, y: y0 + 10, text: 'I₀', fontSize: 7.5, fill: '#66bb6a' }));

        // R2（水平）
        const r2X = xm + 40, r2W = 28;
        this._drawResistor(r2X, y0, r2W, 8, '#90caf9');
        this.group.add(new Konva.Text({ x: r2X, y: y0-14, text: `R₂\n${this.R2}Ω`, fontSize: 7, fill: '#90caf9', align: 'center', width: r2W, lineHeight: 1.3 }));

        // jX2（水平）
        const x2X = r2X + r2W + 6, x2W = 28;
        this._drawInductor(x2X, y0, x2W, 6, '#80cbc4');
        this.group.add(new Konva.Text({ x: x2X, y: y0-14, text: `jX₂\n${this.X2}Ω`, fontSize: 7, fill: '#80cbc4', align: 'center', width: x2W, lineHeight: 1.3 }));

        // Zb 负载（竖向，右侧）
        const zbY0 = y0 + 6, zbH = vH * 0.78;
        this._drawResistor(x1 - 4, zbY0, zbH, 7, '#ffa726', true);
        this.group.add(new Konva.Line({ points: [x1, y0, x1, zbY0], stroke: '#546e7a', strokeWidth: 1 }));
        this.group.add(new Konva.Line({ points: [x1, zbY0 + zbH, x1, y1], stroke: '#546e7a', strokeWidth: 1 }));
        this.group.add(new Konva.Text({ x: x1 + 5, y: zbY0 + zbH * 0.25, text: `Zb\n(负载\n${this.Zb_rated.toFixed(1)}Ω)`, fontSize: 7, fill: '#ffa726', lineHeight: 1.35 }));

        // ★ 开路/短路状态动态标注
        this._zbLabel = new Konva.Text({ x: x1 + 5, y: zbY0 + zbH * 0.6, text: '正常', fontSize: 7.5, fill: '#66bb6a', fontStyle: 'bold' });
        this.group.add(this._zbLabel);

        // 电流方向
        this.group.add(new Konva.Arrow({ points: [xm+4, y0-8, xm+22, y0-8], stroke: '#90caf9', fill: '#90caf9', strokeWidth: 1, pointerLength: 4, pointerWidth: 3 }));
        this.group.add(new Konva.Text({ x: xm+6, y: y0-18, text: 'I₂', fontSize: 7.5, fill: '#90caf9' }));

        // 二次端电压标注
        this._u2Label = new Konva.Text({ x: x1 - 10, y: ey + 14, text: 'U₂', fontSize: 9, fill: '#ffa726', fontStyle: 'bold' });
        this.group.add(this._u2Label);

        // ★ 开路警告（等效电路中高亮 Zb 为断开）
        this._zbOpenMark = new Konva.Line({
            points: [x1-6, zbY0, x1+6, zbY0+12],
            stroke: '#ef5350', strokeWidth: 2.5, opacity: 0, lineCap: 'round',
        });
        this.group.add(this._zbOpenMark);
    }

    // 电阻符号（复用 VT 方法）
    _drawResistor(x, y, len, h, color, vertical = false) {
        const n = 6, seg = len / n;
        const pts = [];
        if (!vertical) {
            pts.push(x, y);
            for (let i = 0; i < n; i++) { pts.push(x+seg*(i+0.25), y-h/2); pts.push(x+seg*(i+0.75), y+h/2); }
            pts.push(x+len, y);
        } else {
            pts.push(x, y);
            for (let i = 0; i < n; i++) { pts.push(x-h/2, y+seg*(i+0.25)); pts.push(x+h/2, y+seg*(i+0.75)); }
            pts.push(x, y+len);
        }
        this.group.add(new Konva.Line({ points: pts, stroke: color, strokeWidth: 1.5, lineJoin: 'round' }));
    }

    // 电感符号（复用 VT 方法）
    _drawInductor(x, y, len, r, color, vertical = false) {
        const n = 4, seg = len / n;
        const pts = [];
        if (!vertical) {
            for (let i = 0; i < n; i++) {
                const cx = x + seg * (i + 0.5);
                for (let a = Math.PI; a >= 0; a -= 0.2) pts.push(cx + r*Math.cos(a), y - r*Math.sin(a));
            }
        } else {
            for (let i = 0; i < n; i++) {
                const cy = y + seg * (i + 0.5);
                for (let a = Math.PI/2; a <= 3*Math.PI/2; a += 0.2) pts.push(x - r*Math.cos(a), cy + r*Math.sin(a) - r);
            }
        }
        this.group.add(new Konva.Line({ points: pts, stroke: color, strokeWidth: 1.5, lineJoin: 'round' }));
        if (!vertical) {
            this.group.add(new Konva.Line({ points: [x,y,x+2,y], stroke:color, strokeWidth:1.5 }));
            this.group.add(new Konva.Line({ points: [x+len-2,y,x+len,y], stroke:color, strokeWidth:1.5 }));
        } else {
            this.group.add(new Konva.Line({ points: [x,y,x,y+2], stroke:color, strokeWidth:1.5 }));
            this.group.add(new Konva.Line({ points: [x,y+len-2,x,y+len], stroke:color, strokeWidth:1.5 }));
        }
    }

    // ── 相量图（CT 版：以 I1 为参考，I2 超前 I1 角差 δ） ──
    _drawPhasorDiagram() {
        const { _phX: px, _phY: py, _phW: pw, _phH: ph } = this;

        this.group.add(new Konva.Rect({ x: px, y: py, width: pw, height: ph, fill: '#010d18', stroke: '#1a3040', strokeWidth: 1.5, cornerRadius: 4 }));
        this.group.add(new Konva.Rect({ x: px, y: py, width: pw, height: 13, fill: '#0a1a28', cornerRadius: [4,4,0,0] }));
        this.group.add(new Konva.Text({ x: px+4, y: py+2, width: pw-8, text: '相量图（动态）', fontSize: 8, fontStyle: 'bold', fill: '#80cbc4', align: 'center' }));

        const ocx = px + pw * 0.42, ocy = py + ph * 0.60;
        const R   = Math.min(pw, ph) * 0.30;

        // 坐标轴
        this.group.add(new Konva.Line({ points: [px+6, ocy, px+pw-6, ocy], stroke: '#1a3040', strokeWidth: 0.7 }));
        this.group.add(new Konva.Line({ points: [ocx, py+16, ocx, py+ph-4], stroke: '#1a3040', strokeWidth: 0.7 }));

        // 相量
        this._phaI1  = new Konva.Arrow({ points: [ocx,ocy, ocx+R, ocy],      stroke: '#ffd54f', fill: '#ffd54f', strokeWidth: 2,   pointerLength: 6, pointerWidth: 5 });
        this._phaI2  = new Konva.Arrow({ points: [ocx,ocy, ocx+R, ocy-2],    stroke: '#90caf9', fill: '#90caf9', strokeWidth: 2,   pointerLength: 6, pointerWidth: 5 });
        this._phaI0  = new Konva.Arrow({ points: [ocx,ocy, ocx, ocy-R*0.1],  stroke: '#66bb6a', fill: '#66bb6a', strokeWidth: 1.5, pointerLength: 5, pointerWidth: 4 });
        this._phaDI  = new Konva.Arrow({ points: [ocx+R, ocy-2, ocx+R, ocy], stroke: '#ef9a9a', fill: '#ef9a9a', strokeWidth: 1.2, pointerLength: 4, pointerWidth: 3, dash: [3,2] });

        // 图例
        const lgX = px + pw * 0.62;
        [['#ffd54f','I₁（一次电流）'],
         ['#90caf9','I₂（二次，折算）'],
         ['#66bb6a','I₀（励磁电流）'],
         ['#ef9a9a','ΔI（误差电流）']].forEach(([col, lbl], i) => {
            this.group.add(new Konva.Line({ points: [lgX, py+18+i*10, lgX+12, py+18+i*10], stroke: col, strokeWidth: 2 }));
            this.group.add(new Konva.Text({ x: lgX+14, y: py+14+i*10, text: lbl, fontSize: 7, fill: col }));
        });

        this._phOCX = ocx; this._phOCY = ocy; this._phR = R;
        this.group.add(this._phaI1, this._phaI2, this._phaI0, this._phaDI);
    }

    // ── B-H 励磁特性曲线（CT 工作点在线性区极左端） ──
    _drawBHCurve() {
        const { _bhX: bx, _bhY: by, _bhW: bw, _bhH: bh } = this;

        this.group.add(new Konva.Rect({ x: bx, y: by, width: bw, height: bh, fill: '#010d18', stroke: '#1a3040', strokeWidth: 1.5, cornerRadius: 4 }));
        this.group.add(new Konva.Rect({ x: bx, y: by, width: bw, height: 13, fill: '#0a1a28', cornerRadius: [4,4,0,0] }));
        this.group.add(new Konva.Text({ x: bx+4, y: by+2, width: bw-8, text: 'B-H 励磁特性（CT 工作在线性区极低端）', fontSize: 8, fontStyle: 'bold', fill: '#80cbc4', align: 'center' }));

        const ox = bx+20, oy = by+bh-12, aw = bw-26, ah = bh-26;
        this.group.add(new Konva.Line({ points: [ox, oy-ah, ox, oy, ox+aw, oy], stroke: '#37474f', strokeWidth: 0.8 }));
        this.group.add(new Konva.Text({ x: ox-18, y: oy-ah, text: 'B(T)', fontSize: 7, fill: '#80cbc4' }));
        this.group.add(new Konva.Text({ x: ox+aw+2, y: oy+2, text: 'H', fontSize: 7, fill: '#80cbc4' }));

        // B-H 曲线（含饱和区）
        const hMax  = 8000;
        const bhFn  = h => this.Bsat * (1 - Math.exp(-h / 600)) + this.Bsat * 0.05 * Math.tanh(h / 5000);
        const bhPts = [];
        for (let h = 0; h <= hMax; h += 80) {
            const B = bhFn(h);
            bhPts.push(ox + (h/hMax)*aw, oy - Math.min(ah-2, (B/(this.Bsat*1.08))*(ah-2)));
        }
        this.group.add(new Konva.Line({ points: bhPts, stroke: '#4fc3f7', strokeWidth: 2, lineJoin: 'round', opacity: 0.75 }));

        // 饱和区填色
        const BsatY = oy - (this.Bsat/(this.Bsat*1.08))*(ah-2);
        this.group.add(new Konva.Rect({ x: ox, y: oy-ah, width: aw, height: oy-ah-BsatY, fill: 'rgba(239,83,80,0.08)' }));
        this.group.add(new Konva.Line({ points: [ox, BsatY, ox+aw, BsatY], stroke: '#ef5350', strokeWidth: 0.9, dash: [4,3] }));
        this.group.add(new Konva.Text({ x: ox+2, y: BsatY-10, text: `饱和 Bsat=${this.Bsat}T`, fontSize: 6.5, fill: '#ef5350' }));

        // CT 额定工作点（极低磁通密度）
        const Hrated  = (this.ratedI1 * this.turnsN1 - this.ratedI2 * this.turnsN2 * 0.001) / (this.coreMeanLen || 0.6);
        const HratedX = ox + (Math.min(Hrated, hMax) / hMax) * aw;
        const BratedY = oy - (this.Brated / (this.Bsat*1.08)) * (ah-2);
        this.group.add(new Konva.Line({ points: [HratedX, oy, HratedX, BratedY], stroke: '#66bb6a', strokeWidth: 0.9, dash: [3,3] }));
        this.group.add(new Konva.Line({ points: [ox, BratedY, HratedX, BratedY], stroke: '#66bb6a', strokeWidth: 0.9, dash: [3,3] }));
        this.group.add(new Konva.Text({ x: ox+2, y: BratedY-10, text: `额定 Brated=${this.Brated}T`, fontSize: 6.5, fill: '#66bb6a' }));

        // 放大框（线性区局部放大示意）
        const zoomX = ox + aw * 0.50, zoomY = oy - ah * 0.20;
        const zoomW = aw * 0.46, zoomH = ah * 0.18;
        this.group.add(new Konva.Rect({ x: zoomX, y: zoomY, width: zoomW, height: zoomH, fill: '#0a1520', stroke: '#37474f', strokeWidth: 0.8, dash: [3,3] }));
        this.group.add(new Konva.Text({ x: zoomX+2, y: zoomY+2, text: '← CT 工作区\n   （线性区极低端）', fontSize: 6.5, fill: '#66bb6a', lineHeight: 1.4 }));

        // 动态工作点
        this._bhPoint = new Konva.Circle({ x: HratedX, y: BratedY, radius: 4, fill: '#ffd54f', stroke: '#f9a825', strokeWidth: 1.5 });
        this.group.add(this._bhPoint);
        this._bhOX = ox; this._bhOY = oy; this._bhAW = aw; this._bhAH = ah;
        this._bhFn = bhFn; this._bhHMax = hMax;
    }

    // ── 误差特性曲线（fi vs I/In） ──────────
    _drawErrorCurve() {
        const { _errX: ex, _errY: ey, _errW: ew, _errH: eh } = this;

        this.group.add(new Konva.Rect({ x: ex, y: ey, width: ew, height: eh, fill: '#010d18', stroke: '#1a3040', strokeWidth: 1.5, cornerRadius: 4 }));
        this.group.add(new Konva.Rect({ x: ex, y: ey, width: ew, height: 13, fill: '#0a1a28', cornerRadius: [4,4,0,0] }));
        this.group.add(new Konva.Text({ x: ex+4, y: ey+2, width: ew-8, text: `误差特性（${this.accuracy}级  ALF=${this.ALF}）`, fontSize: 8, fontStyle: 'bold', fill: '#80cbc4', align: 'center' }));

        const ox = ex+16, oy = ey+eh/2+2, aw = ew-22, ah = (eh-22)/2-4;
        this.group.add(new Konva.Line({ points: [ox, ey+14, ox, ey+eh-10, ox+aw, ey+eh-10], stroke: '#37474f', strokeWidth: 0.8 }));
        this.group.add(new Konva.Line({ points: [ox, oy, ox+aw, oy], stroke: '#37474f', strokeWidth: 0.6, dash: [3,3] }));
        this.group.add(new Konva.Text({ x: ox+aw+2, y: ey+eh-12, text: 'I/In', fontSize: 6.5, fill: '#37474f' }));
        this.group.add(new Konva.Text({ x: ox-14, y: oy-4, text: '0', fontSize: 6.5, fill: '#37474f' }));

        // 精度等级误差带
        const lim  = this._accuracyLimits[this.accuracy] || { fi: 0.5, delta: 20 };
        const fiY0 = oy - (lim.fi / 6.0) * ah;
        const fiY1 = oy + (lim.fi / 6.0) * ah;
        this.group.add(new Konva.Rect({ x: ox, y: fiY0, width: aw, height: fiY1-fiY0, fill: 'rgba(102,187,106,0.10)', stroke: '#66bb6a', strokeWidth: 0.8, dash: [4,3] }));
        this.group.add(new Konva.Text({ x: ox+2, y: fiY0-10, text: `+${lim.fi}%`, fontSize: 6.5, fill: '#66bb6a' }));
        this.group.add(new Konva.Text({ x: ox+2, y: fiY1+2,  text: `-${lim.fi}%`, fontSize: 6.5, fill: '#66bb6a' }));

        // 典型比差曲线（小电流时误差大，额定时最小，过载接近 ALF 时迅速增大）
        const errFn = iRatio => {
            if (iRatio <= 0) return -lim.fi * 3;
            const base = -(1/iRatio - 1 + iRatio * 0.05) * lim.fi * 0.25;
            const sat  = iRatio > this.ALF * 0.8 ? (iRatio - this.ALF * 0.8) / (this.ALF * 0.2) * lim.fi * 4 : 0;
            return base - sat;
        };
        const errPts = [];
        for (let ir = 0.05; ir <= this.ALF * 1.1; ir += 0.05) {
            const x   = ox + (ir / (this.ALF * 1.2)) * aw;
            const err = Math.max(-6, Math.min(6, errFn(ir)));
            errPts.push(x, oy - (err / 6.0) * ah);
        }
        this.group.add(new Konva.Line({ points: errPts, stroke: '#ef9a9a', strokeWidth: 1.5, lineJoin: 'round', opacity: 0.75 }));

        // ALF 竖线
        const alfX = ox + (this.ALF / (this.ALF * 1.2)) * aw;
        this.group.add(new Konva.Line({ points: [alfX, ey+14, alfX, ey+eh-10], stroke: '#ffa726', strokeWidth: 0.8, dash: [4,3] }));
        this.group.add(new Konva.Text({ x: alfX-6, y: ey+eh-10, text: `ALF\n=${this.ALF}`, fontSize: 6, fill: '#ffa726', lineHeight: 1.3 }));

        // 额定工作点（I/In=1）
        const inX = ox + (1.0 / (this.ALF * 1.2)) * aw;
        this.group.add(new Konva.Line({ points: [inX, ey+14, inX, ey+eh-10], stroke: '#ffd54f', strokeWidth: 0.7, dash: [3,3] }));
        this.group.add(new Konva.Text({ x: inX-6, y: ey+eh-10, text: 'In', fontSize: 6.5, fill: '#ffd54f' }));

        // 动态工作点
        this._errPoint = new Konva.Circle({ x: inX, y: oy, radius: 4, fill: '#ef5350', stroke: '#c62828', strokeWidth: 1.5 });
        this.group.add(this._errPoint);
        this._errOX = ox; this._errOY = oy; this._errAW = aw; this._errAH = ah;
        this._errFn = errFn;
    }

    // ── LCD 仪表 ─────────────────────────────
    _drawLCDPanel() {
        const { _lcdX: lx, _lcdY: ly, _lcdW: lw, _lcdH: lh } = this;

        this.group.add(new Konva.Rect({ x: lx, y: ly, width: lw, height: lh, fill: '#020c14', stroke: '#1a3040', strokeWidth: 1.5, cornerRadius: 4 }));
        this.group.add(new Konva.Rect({ x: lx, y: ly, width: lw, height: 13, fill: '#0a1a28', cornerRadius: [4,4,0,0] }));
        this.group.add(new Konva.Text({ x: lx+4, y: ly+2, width: lw-8, text: '测量仪表', fontSize: 8, fontStyle: 'bold', fill: '#80cbc4', align: 'center' }));

        const cells = [
            { label: 'I₁',       id: 'i1',    unit: 'A',   color: '#ffd54f' },
            { label: 'I₂',       id: 'i2',    unit: 'A',   color: '#90caf9' },
            { label: 'K_实',     id: 'kr',    unit: '',    color: '#4fc3f7' },
            { label: '比差 fi',  id: 'fi',    unit: '%',   color: '#66bb6a' },
            { label: '角差 δ',   id: 'delta', unit: 'min', color: '#80cbc4' },
            { label: 'I₀',       id: 'i0',    unit: 'mA',  color: '#ef9a9a' },
            { label: 'U₂',       id: 'u2',    unit: 'V',   color: '#ffa726' },
            { label: '负载',     id: 'sload', unit: 'VA',  color: '#ff8a65' },
            { label: '饱和状态', id: 'sat',   unit: '',    color: '#ce93d8' },
        ];

        const cellW = (lw-8)/3, cellH = 22, gap = 2;
        this._lcdCells = {};
        cells.forEach(({ label, id, unit, color }, i) => {
            const col = i%3, row = Math.floor(i/3);
            const cx3 = lx+4+col*(cellW+gap), cy3 = ly+16+row*(cellH+gap);
            this.group.add(new Konva.Rect({ x: cx3, y: cy3, width: cellW, height: cellH, fill: '#0d1520', cornerRadius: 2 }));
            this.group.add(new Konva.Text({ x: cx3+2, y: cy3+2, text: label, fontSize: 6.5, fill: '#37474f' }));
            const val = new Konva.Text({ x: cx3+2, y: cy3+9, width: cellW-4, text: '--', fontSize: 9, fontFamily: 'Courier New, monospace', fontStyle: 'bold', fill: color, align: 'right' });
            this.group.add(new Konva.Text({ x: cx3+2, y: cy3+14, width: cellW-4, text: unit, fontSize: 6, fill: '#1a252f', align: 'right' }));
            this._lcdCells[id] = val;
            this.group.add(val);
        });
    }

    // ── 控制面板 ─────────────────────────────
    _drawControlPanel() {
        const { _panX: px, _panY: py, _panW: pw, _panH: ph } = this;

        this.group.add(new Konva.Rect({ x: px, y: py, width: pw, height: ph, fill: '#0d1520', stroke: '#1a3040', strokeWidth: 1.5, cornerRadius: 4 }));
        this.group.add(new Konva.Rect({ x: px, y: py, width: pw, height: 13, fill: '#0a1a28', cornerRadius: [4,4,0,0] }));
        this.group.add(new Konva.Text({ x: px+4, y: py+2, width: pw-8, text: '参数调节', fontSize: 8, fontStyle: 'bold', fill: '#80cbc4', align: 'center' }));

        // 滑块：一次电流
        const slW = (pw - 16) / 2 - 30;
        const sliders = [
            { label: `一次电流 I₁（额定 ${this.ratedI1}A）`, key: 'i1', color: '#ffd54f',
              getR: () => this._i1Set / (this.ratedI1 * this.ALF * 1.1),
              set: r => { this._i1Set = r * this.ratedI1 * this.ALF * 1.1; },
              disp: () => `${this._i1Set.toFixed(1)}A` },
            { label: `二次负载 Zb（额定 ${this.Zb_rated.toFixed(1)}Ω）`, key: 'zb', color: '#ffa726',
              getR: () => this._zbSet / (this.Zb_rated * 4),
              set: r => { this._zbSet = r * this.Zb_rated * 4; },
              disp: () => `${this._zbSet.toFixed(2)}Ω` },
        ];

        this._sliderBars = {};
        sliders.forEach(({ label, key, color, getR, set, disp }, si) => {
            const slX = px + 4 + si * (slW + 56);
            const slY = py + 36;
            this.group.add(new Konva.Text({ x: slX, y: slY-12, text: label, fontSize: 7.5, fill: '#546e7a' }));
            this.group.add(new Konva.Rect({ x: slX, y: slY, width: slW, height: 8, fill: '#0a0a18', cornerRadius: 2 }));
            const bar = new Konva.Rect({ x: slX, y: slY, width: 0, height: 8, fill: color, cornerRadius: 2 });
            const txt = new Konva.Text({ x: slX+slW+4, y: slY-2, width: 52, text: '--', fontSize: 8, fontFamily: 'Courier New, monospace', fill: color });
            const hit = new Konva.Rect({ x: slX, y: slY-2, width: slW, height: 12, fill: 'transparent' });
            hit.on('click tap mousedown', e => {
                const stage = this.group.getStage?.();
                const pos   = stage?.getPointerPosition?.() ?? { x: e.evt?.clientX ?? 0 };
                set(Math.max(0.01, Math.min(1, (pos.x - (this.group.x?.()??0) - slX) / slW)));
            });
            this.group.add(bar, txt, hit);
            this._sliderBars[key] = { bar, txt, slW, getR, disp };
        });

        // 开路/闭合切换按钮
        const bY = py + 60, bW = (pw - 16) / 3 - 4;
        [['正常运行', false, '#1a3a1a', '#2e7d32', '#66bb6a'],
         ['二次开路⚡', true, '#4a1a1a', '#c62828', '#ef5350']].forEach(([lbl, open, fill, stroke, col], i) => {
            const bx  = px + 4 + i * (bW + 6);
            const btn = new Konva.Rect({ x: bx, y: bY, width: bW, height: 18, fill, stroke, strokeWidth: 1.5, cornerRadius: 3 });
            const t   = new Konva.Text({ x: bx, y: bY+4, width: bW, text: lbl, fontSize: 9, fontStyle: 'bold', fill: col, align: 'center' });
            btn.on('click tap', () => { this._secOpen = open; });
            btn.on('mouseenter', () => btn.opacity(0.75));
            btn.on('mouseleave', () => btn.opacity(1));
            this.group.add(btn, t);
        });

        // 精度等级按钮
        const accLevels = ['0.1','0.2','0.5','1','3','5P','10P'];
        const abW = (pw - 12) / accLevels.length - 2;
        const abY = py + ph - 22;
        this.group.add(new Konva.Text({ x: px+4, y: abY-10, text: '精度等级：', fontSize: 8, fill: '#546e7a' }));
        this._accBtns = {};
        accLevels.forEach((lvl, i) => {
            const bx  = px+4+i*(abW+2);
            const btn = new Konva.Rect({ x: bx, y: abY, width: abW, height: 16, fill: lvl===this.accuracy?'#1a3a1a':'#0d1520', stroke: lvl===this.accuracy?'#66bb6a':'#1a3040', strokeWidth: 1, cornerRadius: 2 });
            const t   = new Konva.Text({ x: bx, y: abY+3, width: abW, text: lvl, fontSize: 8, fill: lvl===this.accuracy?'#66bb6a':'#37474f', align: 'center' });
            btn.on('click tap', () => {
                this.accuracy = lvl;
                Object.entries(this._accBtns).forEach(([k,{btn:b,txt:t2}]) => {
                    const on = k===lvl;
                    b.fill(on?'#1a3a1a':'#0d1520'); b.stroke(on?'#66bb6a':'#1a3040');
                    t2.fill(on?'#66bb6a':'#37474f');
                });
            });
            this._accBtns[lvl] = { btn, txt: t };
            this.group.add(btn, t);
        });
    }

    // ── 波形区（6通道） ──────────────────────
    _drawWaveform() {
        const { _wavX: wx, _wavY: wy, _wavW: ww, _wavH: wh } = this;
        if (wh < 14) return;

        this.group.add(new Konva.Rect({ x: wx, y: wy, width: ww, height: wh, fill: '#010d18', stroke: '#1a3040', strokeWidth: 1.5, cornerRadius: 4 }));
        this.group.add(new Konva.Rect({ x: wx, y: wy, width: ww, height: 12, fill: '#0a1a28', cornerRadius: [4,4,0,0] }));
        this.group.add(new Konva.Text({ x: wx+4, y: wy+1, width: ww-8, text: 'I₁ 一次电流   I₂×K 折算二次电流   I₀ 励磁电流   ΔI 误差电流   U₂ 二次端电压   B 磁通密度', fontSize: 8, fill: '#80cbc4', align: 'center' }));

        const h6 = (wh-12)/6;
        this._wavMids = Array.from({length:6},(_,i)=>wy+12+h6*(i+0.5));
        this._wavMids.forEach(my=>this.group.add(new Konva.Line({points:[wx+2,my,wx+ww-2,my],stroke:'rgba(200,200,200,0.06)',strokeWidth:0.5,dash:[4,3]})));

        this._wLI1   = new Konva.Line({ points:[], stroke:'#ffd54f', strokeWidth:1.5, lineJoin:'round' });
        this._wLI2k  = new Konva.Line({ points:[], stroke:'#90caf9', strokeWidth:1.5, lineJoin:'round' });
        this._wLI0   = new Konva.Line({ points:[], stroke:'#66bb6a', strokeWidth:1.5, lineJoin:'round' });
        this._wLDI   = new Konva.Line({ points:[], stroke:'#ef9a9a', strokeWidth:1.2, lineJoin:'round' });
        this._wLU2   = new Konva.Line({ points:[], stroke:'#ffa726', strokeWidth:1.5, lineJoin:'round' });
        this._wLB    = new Konva.Line({ points:[], stroke:'#4fc3f7', strokeWidth:1.5, lineJoin:'round' });

        ['I₁','I₂×K','I₀','ΔI','U₂','B'].forEach((l,i)=>{
            this.group.add(new Konva.Text({x:wx+4,y:wy+12+h6*i+3,text:l,fontSize:8,fill:['#ffd54f','#90caf9','#66bb6a','#ef9a9a','#ffa726','#4fc3f7'][i]}));
        });
        this.group.add(this._wLI1, this._wLI2k, this._wLI0, this._wLDI, this._wLU2, this._wLB);
        this._wavH6 = h6;
    }

    // ═══════════════════════════════════════════
    // 集中化 tick（由 consys._tickAll 在 20fps 调用）
    tick(dt) {
        this._tickPhysics(dt);
        this._tickFluxViz(dt);
        this._tickOpenCircuitViz(dt);
        this._tickPhasor();
        this._tickBHPoint();
        this._tickErrPoint();
        this._tickWaveform();
        this._tickDisplay();
        this._refreshCache();
    }
    // ── 物理量计算 ───────────────────────────
    _tickPhysics(dt) {
        const omega = 2 * Math.PI * this.frequency;
        this._wavePhase += omega * dt;

        this.i1Rms = this._i1Set;

        if (this._secOpen) {
            // ── 二次开路：全部安匝用于励磁，铁芯饱和 ──
            this.i0Rms       = this.i1Rms * this.turnsN1 / (this.turnsN2 || 1);
            this.i2Rms       = 0;
            // 深度饱和时二次感应电压（峰值在磁通过零时极大）
            this.fluxPeak    = Math.min(this.Bsat * 1.2, this.i0Rms * this.turnsN2 * this.mu0 / (this.coreMeanLen + 1e-10));
            this.u2Rms       = this.turnsN2 * omega * this.fluxPeak * this.coreArea * 0.707;
            this.u2Rms       = Math.min(99999, this.u2Rms);
            this.errorFi     = -100;
            this.errorDelta  = 0;
            this.ironLoss    = this.u2Rms > 1 ? this.u2Rms**2 / this.Rm : 0;
            this.loadVA      = 0;
            this._satLevel   = Math.min(1, this.fluxPeak / (this.Bsat || 1));
        } else {
            // ── 正常工作：二次侧近似短路 ──
            // 二次总阻抗
            const Ztot2 = Math.sqrt((this.R2 + this._zbSet)**2 + this.X2**2);
            // 二次侧总安匝（折算后等于一次安匝减励磁安匝）
            // 简化模型：励磁电流由二次端电压驱动励磁支路
            // 迭代一次：先估算 U2，再求 I0
            const i2Est  = this.i1Rms / this.ratioK;  // 理想变比下二次电流
            const u2Est  = i2Est * Ztot2;             // 估算二次端电压
            const i0Est  = u2Est / this.Zm;            // 励磁电流

            // 精确二次电流（一次安匝 = 二次安匝 + 励磁安匝，折算至二次）
            const i1prim = this.i1Rms * this.turnsN1 / this.turnsN2;  // 折算至二次
            this.i0Rms   = Math.min(i1prim * 0.3, i0Est);             // 励磁电流（有上限）
            this.i2Rms   = Math.max(0, i1prim - this.i0Rms * Math.cos(this.phi0));

            this.u2Rms   = this.i2Rms * Ztot2;
            this.loadVA  = this.i2Rms**2 * this._zbSet;
            this.ironLoss= this.i0Rms**2 * this.Rm;

            // 误差计算
            const kActual= (this.i2Rms > 1e-9) ? this.i1Rms / (this.i2Rms * this.turnsN2 / this.turnsN1) : this.ratioK;
            this.errorFi = ((kActual - this.ratioK) / this.ratioK) * 100;
            // 角差（励磁电流在电感分量方向引起的相位偏移）
            const sinPhi0    = Math.sin(this.phi0);
            this.errorDelta  = (this.i1Rms > 0) ? (this.i0Rms * sinPhi0 / this.i1Rms) * 3438 : 0;  // min

            // 磁通密度
            const NI_exc  = this.i0Rms * this.turnsN2;
            const Rgap    = this.coreMeanLen / (this.mu0 * (this.ironRelPerm || 5000) * this.coreArea + 1e-12);
            this.fluxPeak = NI_exc / (Rgap * this.turnsN2 * this.coreArea + 1e-12);
            this.fluxPeak = Math.min(this.Bsat * 0.95, Math.max(0, NI_exc * this.mu0 * (this.ironRelPerm||5000) / (this.coreMeanLen + 1e-10)));
            this._satLevel = Math.min(1, this.fluxPeak / (this.Bsat || 1));
        }

        // 瞬时值（用于波形）
        const i1Inst  = this.i1Rms * Math.sqrt(2) * Math.sin(this._wavePhase);
        const dlt     = this.errorDelta * Math.PI / (180 * 60);
        const i2kInst = this.i2Rms * this.ratioK * Math.sqrt(2) * Math.sin(this._wavePhase + dlt);
        const i0Inst  = this.i0Rms * Math.sqrt(2) * Math.sin(this._wavePhase - Math.PI/2 + this.phi0);
        const diInst  = i1Inst - i2kInst;
        const u2Inst  = (this._secOpen ? this.u2Rms * Math.sqrt(2) * Math.cos(this._wavePhase) : this.u2Rms * Math.sqrt(2) * Math.sin(this._wavePhase));
        const bInst   = this.fluxPeak * (this._secOpen ? Math.sin(this._wavePhase) * (1 + 0.5*Math.sin(2*this._wavePhase)) : Math.cos(this._wavePhase));

        this._wavI1  = new Float32Array([...this._wavI1.slice(1),  i1Inst]);
        this._wavI2k = new Float32Array([...this._wavI2k.slice(1), i2kInst]);
        this._wavI0  = new Float32Array([...this._wavI0.slice(1),  i0Inst]);
        this._wavDI  = new Float32Array([...this._wavDI.slice(1),  diInst]);
        this._wavU2  = new Float32Array([...this._wavU2.slice(1),  u2Inst]);
        this._wavB   = new Float32Array([...this._wavB.slice(1),   bInst]);

        this._phasorAngle += dt * 2;
        this._fluxPhase    = ((this._fluxPhase || 0) + dt * 0.6) % 1;
    }

    get ironRelPerm() { return 5000; }

    // ── 磁通粒子动画（环形铁芯） ─────────────
    _tickFluxViz(dt) {
        this._fluxGroup.destroyChildren();
        const B     = Math.abs(this.fluxPeak);
        const alpha = Math.min(0.85, B / (this.Bsat || 1) * 0.85);
        if (alpha < 0.01) return;

        const ecx = this._coreCX, ecy = this._coreCY;
        const Rmid = (this._coreOuter + this._coreInner) / 2;
        const nP   = 12;
        for (let i = 0; i < nP; i++) {
            const t  = ((this._fluxPhase + i/nP) % 1 + 1) % 1;
            const a  = t * Math.PI * 2 - Math.PI / 2;
            const col = this._secOpen
                ? `rgba(239,83,80,${alpha})`        // 开路时红色（饱和警告）
                : `rgba(79,195,247,${alpha * 0.8})`;// 正常时蓝色
            this._fluxGroup.add(new Konva.Circle({
                x: ecx + Rmid * Math.cos(a),
                y: ecy + Rmid * Math.sin(a),
                radius: 2.2 + this._satLevel * 2.5,
                fill: col,
            }));
        }

        // 绕组发光（随磁通变化）
        const gNorm = Math.min(1, B / (this.Brated || 0.08));
        if (this._w2Glow) {
            this._w2Glow.fill(this._secOpen
                ? `rgba(239,83,80,${Math.min(0.45, gNorm * 0.45)})`
                : `rgba(21,101,192,${Math.min(0.25, gNorm * 0.25)})`);
        }
        // 母线电流发光（随一次电流）
        const iNorm = Math.min(1, this.i1Rms / (this.ratedI1 || 1));
        if (this._busBar) this._busBar.fill(iNorm > 0.05 ? `rgba(255,${Math.round(134+iNorm*60)},11,1)` : '#b8860b');
    }

    // ── 开路高压警告动画 ─────────────────────
    _tickOpenCircuitViz(dt) {
        if (!this._secOpen) { this._warnGroup.opacity(0); return; }
        this._openWarnPh = ((this._openWarnPh || 0) + dt * 6) % (Math.PI * 2);
        this._warnGroup.opacity(0.85 + 0.15 * Math.sin(this._openWarnPh * 3));

        // 高压弧线（在 S1/S2 端子旁随机抖动）
        const sx = this._secTermX, sy1 = this._coreCY - 16, sy2 = this._coreCY + 16;
        this._warnArcs.forEach((arc, i) => {
            const amp = 6 + 4 * Math.sin(this._openWarnPh + i);
            arc.points([
                sx + 2,    sy1 + i*6,
                sx + amp,  sy1 + (sy2-sy1)*0.3 + i*4,
                sx - amp,  sy1 + (sy2-sy1)*0.6 + i*3,
                sx + 2,    sy2 - i*5,
            ]);
            arc.stroke(`rgba(255,${200-i*30},50,${0.7+0.3*Math.sin(this._openWarnPh*4+i)})`);
        });

        // 等效电路中开路标记
        if (this._zbOpenMark) this._zbOpenMark.opacity(0.9);
        if (this._zbLabel)    this._zbLabel.text('⚡开路！').fill('#ef5350');
        if (this._u2Label)    this._u2Label.fill('#ef5350');
    }

    // ── 相量图更新（CT：以 I1 为参考） ──────
    _tickPhasor() {
        if (!this._phaI1) return;
        const R   = this._phR, ocx = this._phOCX, ocy = this._phOCY;
        const th  = this._phasorAngle;
        const dlt = this.errorDelta * Math.PI / (180 * 60);

        // I1（参考相量）
        const i1X = ocx + R * Math.cos(th), i1Y = ocy - R * Math.sin(th);
        this._phaI1.points([ocx, ocy, i1X, i1Y]);

        if (this._secOpen) {
            // 开路：I2=0，I0=I1
            this._phaI2.points([ocx, ocy, ocx, ocy]);
            const i0Mag = R;
            this._phaI0.points([ocx, ocy, ocx+i0Mag*Math.cos(th-Math.PI/2+this.phi0), ocy-i0Mag*Math.sin(th-Math.PI/2+this.phi0)]);
            this._phaDI.points([i1X, i1Y, i1X, i1Y]);
        } else {
            // 正常：I2 与 I1 近似同相（超前角差 δ）
            const i2Mag = R * Math.min(0.99, this.i2Rms * this.ratioK / (this.i1Rms || 1));
            const i2X   = ocx + i2Mag * Math.cos(th + dlt);
            const i2Y   = ocy - i2Mag * Math.sin(th + dlt);
            this._phaI2.points([ocx, ocy, i2X, i2Y]);

            const i0Mag = R * Math.min(0.2, this.i0Rms / (this.i1Rms || 1) * 5);
            const i0X   = ocx + i0Mag * Math.cos(th - Math.PI/2 + this.phi0);
            const i0Y   = ocy - i0Mag * Math.sin(th - Math.PI/2 + this.phi0);
            this._phaI0.points([ocx, ocy, i0X, i0Y]);
            this._phaDI.points([i2X, i2Y, i1X, i1Y]);
        }
    }

    // ── B-H 工作点 ───────────────────────────
    _tickBHPoint() {
        if (!this._bhPoint) return;
        const H_now = this.i0Rms * this.turnsN2 / (this.coreMeanLen || 0.6);
        const B_now = Math.abs(this.fluxPeak);
        const bx = Math.max(this._bhOX, Math.min(this._bhOX+this._bhAW, this._bhOX+(Math.min(H_now,this._bhHMax)/this._bhHMax)*this._bhAW));
        const by = Math.max(this._bhOY-this._bhAH+2, this._bhOY-(B_now/(this.Bsat*1.08))*(this._bhAH-2));
        this._bhPoint.x(bx); this._bhPoint.y(by);
        this._bhPoint.fill(this._satLevel > 0.9 ? '#ef5350' : this._satLevel > 0.6 ? '#ffa726' : '#ffd54f');
        this._bhPoint.radius(3.5 + this._satLevel * 3);
    }

    // ── 误差特性工作点 ────────────────────────
    _tickErrPoint() {
        if (!this._errPoint) return;
        const iRatio = (this.ratedI1 > 0) ? this.i1Rms / this.ratedI1 : 1;
        const ex     = Math.max(this._errOX, Math.min(this._errOX+this._errAW, this._errOX+(iRatio/(this.ALF*1.2))*this._errAW));
        const err    = this._secOpen ? -6 : (this._errFn ? this._errFn(iRatio) : 0);
        const ey     = this._errOY - (Math.max(-6,Math.min(6,err))/6.0)*this._errAH;
        this._errPoint.x(ex); this._errPoint.y(ey);
        const lim    = this._accuracyLimits[this.accuracy] || { fi: 0.5 };
        this._errPoint.fill(Math.abs(this.errorFi) <= lim.fi && !this._secOpen ? '#66bb6a' : '#ef5350');
    }

    // ── 波形更新 ─────────────────────────────
    _tickWaveform() {
        if (!this._wavH6 || !this._wavMids) return;
        const wx = this._wavX+3, ww = this._wavW-6, n = this._wavLen;
        const dx = ww/n, h6 = this._wavH6;
        const [mI1, mI2k, mI0, mDI, mU2, mB] = this._wavMids;

        const i1pk = Math.max(0.001, this.i1Rms * Math.sqrt(2));
        const i0pk = Math.max(1e-6,  this.i0Rms * Math.sqrt(2));
        const u2pk = Math.max(0.01,  this._secOpen ? Math.min(99999, this.u2Rms*Math.sqrt(2)) : this.u2Rms*Math.sqrt(2));
        const bpk  = Math.max(0.001, Math.abs(this.fluxPeak));

        const ptI1=[], ptI2k=[], ptI0=[], ptDI=[], ptU2=[], ptB=[];
        for (let i = 0; i < n; i++) {
            const x = wx+i*dx;
            ptI1.push(x,  mI1  - (this._wavI1[i]  / i1pk)                 * h6*0.40);
            ptI2k.push(x, mI2k - (this._wavI2k[i] / i1pk)                 * h6*0.40);
            ptI0.push(x,  mI0  - (this._wavI0[i]  / Math.max(i0pk,1e-6))  * h6*0.38);
            ptDI.push(x,  mDI  - (this._wavDI[i]  / (i1pk*0.1+1e-10))     * h6*0.36);
            ptU2.push(x,  mU2  - (Math.max(-1,Math.min(1,this._wavU2[i]/u2pk))) * h6*0.38);
            ptB.push(x,   mB   - (this._wavB[i]   / bpk)                   * h6*0.38);
        }
        this._wLI1.points(ptI1);  this._wLI2k.points(ptI2k);
        this._wLI0.points(ptI0);  this._wLDI.points(ptDI);
        this._wLU2.points(ptU2);  this._wLB.points(ptB);
    }

    // ── 仪表显示 ─────────────────────────────
    _tickDisplay() {
        const c = this._lcdCells;
        if (!c) return;

        const lim    = this._accuracyLimits[this.accuracy] || { fi: 0.5, delta: 20 };
        const fiOK   = !this._secOpen && Math.abs(this.errorFi) <= lim.fi;
        const dltOK  = !this._secOpen && Math.abs(this.errorDelta) <= lim.delta;

        if (c.i1)    c.i1.text(this.i1Rms.toFixed(1));
        if (c.i2)    c.i2.text(this.i2Rms.toFixed(3));
        if (c.kr)    c.kr.text(this.i2Rms > 1e-4 ? (this.i1Rms/this.i2Rms).toFixed(2) : '∞');
        if (c.fi)  { c.fi.text(this._secOpen ? '开路!' : this.errorFi.toFixed(3));   c.fi.fill(fiOK?'#66bb6a':'#ef5350'); }
        if (c.delta) { c.delta.text(this._secOpen ? '--' : this.errorDelta.toFixed(1)); c.delta.fill(dltOK?'#66bb6a':'#ef5350'); }
        if (c.i0)    c.i0.text((this.i0Rms*1000).toFixed(2));
        if (c.u2)  { c.u2.text(this._secOpen ? `${(this.u2Rms/1000).toFixed(1)}kV` : this.u2Rms.toFixed(3)); c.u2.fill(this._secOpen?'#ef5350':'#ffa726'); }
        if (c.sload) c.sload.text(this.loadVA.toFixed(3));
        if (c.sat) {
            const satPct = (this._satLevel*100).toFixed(0);
            c.sat.text(this._secOpen ? `⚡饱和${satPct}%` : `${satPct}%`);
            c.sat.fill(this._satLevel>0.9?'#ef5350':this._satLevel>0.5?'#ffa726':'#66bb6a');
        }

        // 等效电路标注更新
        if (!this._secOpen) {
            if (this._zbOpenMark) this._zbOpenMark.opacity(0);
            if (this._zbLabel)    this._zbLabel.text('正常').fill('#66bb6a');
            if (this._u2Label)    this._u2Label.fill('#ffa726');
        }

        // 滑块同步
        if (this._sliderBars) {
            const i1B = this._sliderBars['i1'];
            if (i1B) { i1B.bar.width(Math.min(i1B.slW, i1B.getR()*i1B.slW)); i1B.txt.text(i1B.disp()); }
            const zbB = this._sliderBars['zb'];
            if (zbB) { zbB.bar.width(Math.min(zbB.slW, zbB.getR()*zbB.slW)); zbB.txt.text(zbB.disp()); }
        }
    }

    // ═══════════════════════════════════════════
    /** 设置一次电流 */
    setPrimaryCurrent(i) {
        this._i1Set = Math.max(0, Math.min(this.ratedI1 * this.ALF * 1.5, i));
        this._refreshCache();
    }

    /** 设置二次负载阻抗 */
    setLoadImpedance(z) {
        this._zbSet = Math.max(0, Math.min(this.Zb_rated * 5, z));
        this._refreshCache();
    }

    /** 模拟二次开路（危险操作） */
    openSecondary()  { this._secOpen = true;  this._refreshCache(); }

    /** 恢复二次侧正常连接 */
    closeSecondary() { this._secOpen = false; this._refreshCache(); }

    /** 查询当前是否满足精度要求 */
    isWithinAccuracy() {
        if (this._secOpen) return false;
        const lim = this._accuracyLimits[this.accuracy] || { fi: 0.5, delta: 20 };
        return Math.abs(this.errorFi) <= lim.fi && Math.abs(this.errorDelta) <= lim.delta;
    }

    getSecondaryVoltage() { return this.u2Rms; }
    getSecondaryCurrent() { return this.i2Rms; }
    getErrorFi()          { return this.errorFi; }
    getErrorDelta()       { return this.errorDelta; }

    update(cfg = {}) {
        if (cfg.i1 !== undefined) this.setPrimaryCurrent(cfg.i1);
        if (cfg.zb !== undefined) this.setLoadImpedance(cfg.zb);
        if (cfg.secOpen !== undefined) this._secOpen = !!cfg.secOpen;
        this._refreshCache();
    }

    getConfigFields() {
        return [
            { label: '位号/名称',              key: 'id',           type: 'text'   },
            { label: '一次额定电流 (A)',        key: 'ratedI1',      type: 'number' },
            { label: '二次额定电流 (A)',        key: 'ratedI2',      type: 'number' },
            { label: '额定负荷 (VA)',           key: 'ratedVA',      type: 'number' },
            { label: '精度等级',               key: 'accuracy',     type: 'text'   },
            { label: '准确限值系数 ALF',        key: 'ALF',          type: 'number' },
            { label: '一次匝数 N1',            key: 'turnsN1',      type: 'number' },
            { label: '二次绕组电阻 R2 (Ω)',    key: 'R2',           type: 'number' },
            { label: '励磁铁损电阻 Rm (Ω)',    key: 'Rm',           type: 'number' },
            { label: '励磁感抗 Xm (Ω)',        key: 'Xm',           type: 'number' },
            { label: '铁芯截面积 (cm²)',        key: 'coreArea',     type: 'number' },
            { label: '额定磁通密度 Brated (T)', key: 'Brated',       type: 'number' },
            { label: '饱和磁通密度 Bsat (T)',   key: 'Bsat',         type: 'number' },
            { label: '频率 (Hz)',              key: 'frequency',    type: 'number' },
        ];
    }

    onConfigUpdate(cfg) {
        this.id        = cfg.id        || this.id;
        this.ratedI1   = parseFloat(cfg.ratedI1)   || this.ratedI1;
        this.ratedI2   = parseFloat(cfg.ratedI2)   || this.ratedI2;
        this.ratedVA   = parseFloat(cfg.ratedVA)   || this.ratedVA;
        this.accuracy  = cfg.accuracy  || this.accuracy;
        this.ALF       = parseFloat(cfg.ALF)       || this.ALF;
        this.turnsN1   = parseInt(cfg.turnsN1)     || this.turnsN1;
        this.R2        = parseFloat(cfg.R2)        || this.R2;
        this.Rm        = parseFloat(cfg.Rm)        || this.Rm;
        this.Xm        = parseFloat(cfg.Xm)        || this.Xm;
        this.coreArea  = (parseFloat(cfg.coreArea) || (this.coreArea*1e4)) * 1e-4;
        this.Brated    = parseFloat(cfg.Brated)    || this.Brated;
        this.Bsat      = parseFloat(cfg.Bsat)      || this.Bsat;
        this.frequency = parseFloat(cfg.frequency) || this.frequency;
        this.ratioK    = this.ratedI1 / this.ratedI2;
        this.turnsN2   = Math.round(this.ratedI1 / this.ratedI2 * this.turnsN1);
        this.Zb_rated  = this.ratedVA / this.ratedI2**2;
        this.Zm        = Math.sqrt(this.Rm**2 * this.Xm**2 / (this.Rm**2 + this.Xm**2));
        this.phi0      = Math.atan(this.Rm / this.Xm);
        this.config    = { ...this.config, ...cfg };
        this._refreshCache();
    }

    destroy() {
        super.destroy?.();
    }
}