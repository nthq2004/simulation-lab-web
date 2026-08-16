import { BaseComponent } from './BaseComponent.js';

/**
 * 电压互感器仿真组件
 * （Voltage Transformer / Potential Transformer，VT / PT）
 *
 * ── 工作原理 ──────────────────────────────────────────────────
 *
 *  电压互感器是一种测量用变压器，将高电压按固定比例变换为标准
 *  低电压（通常为 100V 或 100/√3 V），供测量仪表、继电保护及
 *  自动装置使用。其二次侧始终近似开路运行（负载阻抗极大）。
 *
 *  1. 基本变换关系：
 *     理想变比：K_u = U1 / U2 = N1 / N2
 *     实际变比：K_u_actual = U1 / U2（含误差）
 *     电压误差（比差）：f_u = (K_u × U2 - U1) / U1 × 100%
 *     相位误差（角差）：δ_u（二次电压相量与一次电压相量夹角，单位 min）
 *
 *  2. 等效电路（T形等效，近似为串联阻抗 + 并联励磁支路）：
 *     一次侧：R1（一次绕组电阻）+ jX1（一次漏抗）
 *     励磁支路：Rm（铁损电阻）∥ jXm（励磁感抗）
 *     二次侧折算至一次：R2'（= R2×K²）+ jX2'（= X2×K²）+ Z_L'（负载阻抗）
 *
 *     由于 VT 近似空载（Z_L 很大），励磁电流 I0 占一次电流绝大部分，
 *     误差主要来源于励磁支路的压降及铁芯损耗。
 *
 *  3. 精度等级（IEC 60044-2）：
 *     0.1 级：误差 ±0.1%，角差 ±5 min  —— 计量用
 *     0.2 级：误差 ±0.2%，角差 ±10 min —— 精密计量
 *     0.5 级：误差 ±0.5%，角差 ±20 min —— 测量用
 *     1.0 级：误差 ±1.0%，角差 ±40 min —— 一般测量
 *     3P/6P：保护用，在 5% 额定电压时有较大误差容限
 *
 *  4. 励磁特性（磁化曲线）：
 *     铁芯工作在线性区（B 约 1.0~1.5T），远低于饱和点。
 *     励磁电流 I0 = U1 / Zm，其中 Zm = Rm∥jXm
 *     铁损：P_Fe = U1² / Rm
 *     励磁功率因数：cos(φ0) = Rm / |Zm|（很小，约 0.01~0.1）
 *
 *  5. 误差形成机制：
 *     励磁电流 I0 在 R1+jX1 上产生压降 ΔU = I0×(R1+jX1)
 *     → 二次电压 U2 ≠ U1/K（幅值和相位均有偏差）
 *     负载增大（Z_L 减小）→ 二次电流 I2 增大 → 误差增大
 *     铁芯饱和 → Xm 减小 → I0 增大 → 误差增大
 *
 *  6. 接线方式：
 *     - 单相接线（V/V）：两台 VT 测三相三线制线电压
 *     - Y/Y 接线：三台 VT 测相电压及零序电压
 *     - Y/Y/Δ（三绕组）：兼顾测量与开口三角检测接地故障
 *
 *  7. 安全规范：
 *     - 二次侧必须一端接地（防止一次高压窜入）
 *     - 二次侧严禁短路（否则一次侧电流猛增，损坏绝缘）
 *     - 额定容量（VA）：在该负荷下满足精度等级要求
 *     - 最大容量（VA）：绕组热容量上限
 *
 * ── 组件结构 ──────────────────────────────────────────────────
 *  ① 铁芯截面图（叠片铁芯，B-H 磁化曲线区域，硅钢片）
 *  ② 一次/二次绕组（匝数比可视化，绕组密度对比）
 *  ③ T 形等效电路图（R1/X1/Rm/Xm/R2'/X2'，动态阻抗标注）
 *  ④ 相量图（U1、U2'、I0、压降相量，动态旋转）
 *  ⑤ 励磁特性曲线（B-H，含工作点）
 *  ⑥ 误差特性曲线（f_u vs 负载，精度等级带）
 *  ⑦ 波形区（U1、U2×K、误差电压 ΔU、I0 励磁电流）
 *  ⑧ LCD 仪表（U1、U2、变比误差、角差、励磁电流、铁损、负载VA）
 *  ⑨ 控制面板（一次电压调节、负载阻抗调节、精度等级选择）
 *
 * ── 端口 ─────────────────────────────────────────────────────
 *  pri_a     — 一次侧 A 端（高压）
 *  pri_n     — 一次侧 N 端（高压中性点 / 接地）
 *  sec_a     — 二次侧 a 端（低压）
 *  sec_n     — 二次侧 n 端（低压，接地）
 *  sec2_a    — 第三绕组 a 端（开口三角，可选）
 *  sec2_b    — 第三绕组 b 端（开口三角）
 */
export class VoltageTransformer extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.width  = Math.max(560, config.width  || 660);
        this.height = Math.max(420, config.height || 520);

        this.type    = 'voltage_transformer';
        this.special = 'none';
        this.cache   = 'fixed';

        // ── 额定参数 ──
        this.ratedU1    = config.ratedU1    || 10000;  // V（一次额定电压，如 10kV）
        this.ratedU2    = config.ratedU2    || 100;    // V（二次额定电压，如 100V）
        this.ratedVA    = config.ratedVA    || 50;     // VA（额定容量）
        this.maxVA      = config.maxVA      || 200;    // VA（最大容量）
        this.frequency  = config.frequency  || 50;     // Hz
        this.accuracy   = config.accuracy   || '0.5';  // 精度等级
        this.wiring     = config.wiring     || 'single';// 'single'/'VV'/'YY'/'YYD'

        // ── 变比 ──
        this.ratioK     = this.ratedU1 / this.ratedU2; // 额定变比（如 100）
        this.ratedTurns1= config.ratedTurns1 || 2000;  // 一次匝数（示意）
        this.ratedTurns2= Math.round(this.ratedTurns1 / this.ratioK); // 二次匝数

        // ── 等效电路参数（折算至一次侧） ──
        this.R1  = config.R1  || 80;        // Ω（一次绕组电阻）
        this.X1  = config.X1  || 120;       // Ω（一次漏抗）
        this.Rm  = config.Rm  || 1.2e6;     // Ω（铁损电阻，很大）
        this.Xm  = config.Xm  || 8e5;       // Ω（励磁感抗，很大）
        this.R2p = config.R2p || 60;        // Ω（二次绕组电阻折算至一次）
        this.X2p = config.X2p || 100;       // Ω（二次漏抗折算至一次）

        // 励磁阻抗模
        this.Zm   = Math.sqrt(this.Rm**2 * this.Xm**2 / (this.Rm**2 + this.Xm**2));
        // 励磁功率因数角
        this.phi0 = Math.atan(this.Rm / this.Xm);  // rad（近似 π/2，励磁电流超前铁损电流）

        // ── 铁芯参数 ──
        this.coreArea   = config.coreArea   || 40e-4;  // m²（铁芯截面积 40cm²）
        this.coreLenth  = config.coreLength || 0.8;    // m（磁路平均长度）
        this.Brated     = config.Brated     || 1.2;    // T（额定磁通密度）
        this.Bsat       = config.Bsat       || 1.8;    // T（饱和磁通密度）
        this.Hrated     = config.Hrated     || 300;    // A/m（额定磁场强度）

        // ── 精度等级误差限 ──
        this._accuracyLimits = {
            '0.1': { fu: 0.1,  delta: 5   },
            '0.2': { fu: 0.2,  delta: 10  },
            '0.5': { fu: 0.5,  delta: 20  },
            '1':   { fu: 1.0,  delta: 40  },
            '3P':  { fu: 3.0,  delta: 120 },
            '6P':  { fu: 6.0,  delta: 240 },
        };

        // ── 运行状态 ──
        this._wavePhase  = 0;          // 工频相位 rad
        this._u1Set      = this.ratedU1;  // 设定一次电压 V
        this._zLoadSet   = 2000 * this.ratioK**2; // 负载阻抗（折算至一次）Ω，初始轻载
        this._zLoadOhm   = 2000;       // 二次侧实际负载阻抗 Ω

        // 电气量（瞬时/有效值）
        this.u1Rms       = 0;          // 一次电压有效值
        this.u2Rms       = 0;          // 二次电压有效值
        this.i0Rms       = 0;          // 励磁电流有效值
        this.i2Rms       = 0;          // 二次电流有效值
        this.errorFu     = 0;          // 电压误差 %
        this.errorDelta  = 0;          // 角差 min
        this.ironLoss    = 0;          // 铁损 W
        this.loadVA      = 0;          // 负载容量 VA
        this.fluxDensity = 0;          // 磁通密度 T（瞬时）
        this.fluxPeak    = 0;          // 磁通密度峰值 T

        // 相量（用于相量图）
        this._phasorAngle = 0;         // 旋转相位

        // ── 波形缓冲 ──
        this._wavLen   = 240;
        this._wavU1    = new Float32Array(this._wavLen).fill(0);
        this._wavU2k   = new Float32Array(this._wavLen).fill(0); // U2×K（折算后）
        this._wavErr   = new Float32Array(this._wavLen).fill(0); // 误差电压
        this._wavI0    = new Float32Array(this._wavLen).fill(0); // 励磁电流
        this._wavB     = new Float32Array(this._wavLen).fill(0); // 磁通密度

        // ── 几何布局 ──
        // 铁芯截面 + 绕组（左上）
        this._coreX  = Math.round(this.width * 0.03);
        this._coreY  = Math.round(this.height * 0.04);
        this._coreW  = Math.round(this.width * 0.30);
        this._coreH  = Math.round(this.height * 0.50);
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
        this._phH    = Math.round(this.height * 0.22);

        // B-H 励磁特性曲线（中）
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
        this._panH   = Math.round(this.height * 0.14);

        // 波形（底部全宽）
        this._wavX   = this._coreX;
        this._wavY   = Math.max(this._lcdY + this._lcdH, this._panY + this._panH) + 6;
        this._wavW   = this.width - this._coreX * 2;
        this._wavH   = this.height - this._wavY - 6;

        this._lastTs  = null;
        this._animId  = null;

        this.config = {
            id: this.id,
            ratedU1: this.ratedU1,
            ratedU2: this.ratedU2,
            ratedVA: this.ratedVA,
            accuracy: this.accuracy,
        };

        this._init();

        // 端口
        const cL = this._coreX - 6;
        const cR = this._coreX + this._coreW + 6;
        this.addPort(cL, this._coreCY - 28, 'pri_a', 'wire', 'A（高压）');
        this.addPort(cL, this._coreCY + 28, 'pri_n', 'wire', 'N（高压）');
        this.addPort(cR, this._coreCY - 28, 'sec_a', 'wire', 'a（低压）');
        this.addPort(cR, this._coreCY + 28, 'sec_n', 'wire', 'n（接地）');
        this.addPort(cR, this._coreCY + 64,  'sec2_a', 'wire', 'da');
        this.addPort(cR, this._coreCY + 96,  'sec2_b', 'wire', 'dn');
    }

    // ═══════════════════════════════════════════
    _init() {
        this._drawLabel();
        this._drawCoreAndWindings();
        this._drawFluxLayer();
        this._drawEquivCircuit();
        this._drawPhasorDiagram();
        this._drawBHCurve();
        this._drawErrorCurve();
        this._drawLCDPanel();
        this._drawControlPanel();
        this._drawWaveform();
        this._startAnimation();
    }

    _drawLabel() {
        this.group.add(new Konva.Text({
            x: 0, y: -22, width: this.width,
            text: `电压互感器（VT/PT）  ${this.ratedU1}V / ${this.ratedU2}V  变比 ${this.ratioK}:1  ${this.ratedVA}VA  精度 ${this.accuracy} 级`,
            fontSize: 11, fontStyle: 'bold', fill: '#1a2634', align: 'center',
        }));
    }

    // ── 铁芯截面 + 绕组 ─────────────────────
    _drawCoreAndWindings() {
        const { _coreX: ex, _coreY: ey, _coreW: ew, _coreH: eh, _coreCX: ecx, _coreCY: ecy } = this;

        // 外框
        this.group.add(new Konva.Rect({ x: ex, y: ey, width: ew, height: eh, fill: '#0d1a24', stroke: '#1a3040', strokeWidth: 1.5, cornerRadius: 5 }));
        this.group.add(new Konva.Text({ x: ex, y: ey - 14, width: ew, text: '铁芯与绕组截面（叠片硅钢）', fontSize: 9, fontStyle: 'bold', fill: '#546e7a', align: 'center' }));

        // ── 叠片铁芯（环形或口字形，简化为矩形回路） ──
        const coreCol  = '#455a64', coreEdge = '#263238';
        const frameW   = Math.round(ew * 0.78);
        const frameH   = Math.round(eh * 0.80);
        const frameX   = ecx - frameW / 2;
        const frameY   = ecy - frameH / 2;
        const limb     = Math.round(ew * 0.18);  // 铁芯柱宽度

        // 顶轭
        this.group.add(new Konva.Rect({ x: frameX, y: frameY, width: frameW, height: limb, fill: coreCol, stroke: coreEdge, strokeWidth: 1.5 }));
        // 底轭
        this.group.add(new Konva.Rect({ x: frameX, y: frameY + frameH - limb, width: frameW, height: limb, fill: coreCol, stroke: coreEdge, strokeWidth: 1.5 }));
        // 左柱
        this.group.add(new Konva.Rect({ x: frameX, y: frameY, width: limb, height: frameH, fill: '#546e7a', stroke: coreEdge, strokeWidth: 1.5 }));
        // 右柱（中柱——绕组所在）
        const midLimbX = frameX + frameW - limb;
        this.group.add(new Konva.Rect({ x: midLimbX, y: frameY, width: limb, height: frameH, fill: '#546e7a', stroke: coreEdge, strokeWidth: 1.5 }));

        // 叠片纹（硅钢片，间距 3px）
        [[frameX, frameY, frameW, limb],
         [frameX, frameY+frameH-limb, frameW, limb],
         [frameX, frameY, limb, frameH],
         [midLimbX, frameY, limb, frameH]].forEach(([rx, ry, rw, rh]) => {
            for (let i = 2; i < rh; i += 3) {
                this.group.add(new Konva.Line({ points: [rx+1, ry+i, rx+rw-1, ry+i], stroke: 'rgba(0,0,0,0.14)', strokeWidth: 0.6 }));
            }
        });

        // 铁芯窗口（左右两个窗口）
        this.group.add(new Konva.Rect({ x: frameX+limb, y: frameY+limb, width: frameW-limb*2, height: frameH-limb*2, fill: '#08111a' }));

        // 标注极性（铁芯窗口内）
        this.group.add(new Konva.Text({ x: frameX+limb+2, y: frameY+limb+2, width: frameW-limb*2-4, text: 'Φ', fontSize: 13, fontStyle: 'bold', fill: '#ffd54f', align: 'center' }));
        this.group.add(new Konva.Text({ x: frameX, y: frameY+frameH*0.45, width: frameW, text: '硅钢叠片铁芯', fontSize: 8, fill: '#78909c', align: 'center' }));

        // ── 一次绕组（高压，左侧，匝数多） ──
        const w1X1    = ex + 6;
        const w1X2    = frameX - 2;
        const w1Y1    = frameY + limb + 4;
        const w1Y2    = frameY + frameH - limb - 4;
        const w1H     = w1Y2 - w1Y1;
        const turn1N  = 16;  // 显示匝数（代表高匝数）
        const t1Step  = w1H / turn1N;
        const w1Colors= ['#e53935', '#ef5350', '#e57373'];  // 红色（高压侧）

        this._w1Group = new Konva.Group();
        for (let i = 0; i < turn1N; i++) {
            const ty  = w1Y1 + i * t1Step;
            const col = w1Colors[i % 3];
            this._w1Group.add(new Konva.Line({
                points: [w1X1, ty, w1X2, ty, w1X2, ty+t1Step*0.88, w1X1, ty+t1Step*0.88, w1X1, ty+t1Step],
                stroke: col, strokeWidth: 1.8, lineCap: 'round', lineJoin: 'round', opacity: 0.85,
            }));
        }
        // 一次接线端
        const pri_termX = ex - 10;
        this.group.add(new Konva.Line({ points: [w1X1, w1Y1+4,  pri_termX, w1Y1+4,  pri_termX, ecy-28], stroke: '#e53935', strokeWidth: 2, lineCap: 'round' }));
        this.group.add(new Konva.Line({ points: [w1X1, w1Y2-4,  pri_termX, w1Y2-4,  pri_termX, ecy+28], stroke: '#e53935', strokeWidth: 2, lineCap: 'round' }));
        this.group.add(new Konva.Circle({ x: pri_termX, y: ecy-28, radius: 3.5, fill: '#e53935', stroke: '#b71c1c', strokeWidth: 0.8 }));
        this.group.add(new Konva.Circle({ x: pri_termX, y: ecy+28, radius: 3.5, fill: '#e53935', stroke: '#b71c1c', strokeWidth: 0.8 }));
        this.group.add(new Konva.Text({ x: pri_termX-20, y: ecy-34, text: 'A\n(HV)', fontSize: 7.5, fill: '#ef9a9a', lineHeight: 1.3, align: 'right' }));
        this.group.add(new Konva.Text({ x: pri_termX-20, y: ecy+24, text: 'N\n(HV)', fontSize: 7.5, fill: '#ef9a9a', lineHeight: 1.3, align: 'right' }));
        this.group.add(new Konva.Text({ x: w1X1+2, y: w1Y1+w1H*0.38, text: `N₁\n≈${this.ratedTurns1}\n匝`, fontSize: 8, fill: '#ef9a9a', lineHeight: 1.4 }));

        // 一次绕组发光（随励磁电流变化）
        this._w1Glow = new Konva.Rect({ x: w1X1-2, y: w1Y1-2, width: w1X2-w1X1+4, height: w1H+4, fill: 'rgba(229,57,53,0)', cornerRadius: 2 });
        this.group.add(this._w1Glow);
        this.group.add(this._w1Group);

        // ── 二次绕组（低压，右侧，匝数少） ──
        const w2X1    = midLimbX + limb + 2;
        const w2X2    = ex + ew - 6;
        const w2Y1    = frameY + limb + Math.round(frameH * 0.12);
        const w2Y2    = frameY + frameH - limb - Math.round(frameH * 0.12);
        const w2H     = w2Y2 - w2Y1;
        const turn2N  = Math.max(3, Math.round(turn1N / this.ratioK * 10));
        const t2Step  = w2H / Math.max(1, turn2N);
        const w2Colors= ['#1565c0', '#1976d2', '#42a5f5'];  // 蓝色（低压侧）

        this._w2Group = new Konva.Group();
        for (let i = 0; i < turn2N; i++) {
            const ty  = w2Y1 + i * t2Step;
            const col = w2Colors[i % 3];
            this._w2Group.add(new Konva.Line({
                points: [w2X1, ty, w2X2, ty, w2X2, ty+t2Step*0.88, w2X1, ty+t2Step*0.88, w2X1, ty+t2Step],
                stroke: col, strokeWidth: 1.8, lineCap: 'round', lineJoin: 'round', opacity: 0.85,
            }));
        }
        // 二次接线端
        const sec_termX = ex + ew + 10;
        this.group.add(new Konva.Line({ points: [w2X2, w2Y1+4,  sec_termX, w2Y1+4,  sec_termX, ecy-28], stroke: '#1565c0', strokeWidth: 2, lineCap: 'round' }));
        this.group.add(new Konva.Line({ points: [w2X2, w2Y2-4,  sec_termX, w2Y2-4,  sec_termX, ecy+28], stroke: '#1976d2', strokeWidth: 2, lineCap: 'round' }));
        this.group.add(new Konva.Circle({ x: sec_termX, y: ecy-28, radius: 3.5, fill: '#1565c0', stroke: '#0d47a1', strokeWidth: 0.8 }));
        this.group.add(new Konva.Circle({ x: sec_termX, y: ecy+28, radius: 3.5, fill: '#1976d2', stroke: '#0d47a1', strokeWidth: 0.8 }));
        // 接地符号（二次侧 n 端接地）
        [0,1,2].forEach(i => this.group.add(new Konva.Line({ points: [sec_termX-(i+1)*3, ecy+34+(i*4), sec_termX+(i+1)*3, ecy+34+(i*4)], stroke: '#4caf50', strokeWidth: 1.5-i*0.4 })));
        this.group.add(new Konva.Text({ x: sec_termX+6, y: ecy-34, text: 'a\n(LV)', fontSize: 7.5, fill: '#90caf9', lineHeight: 1.3 }));
        this.group.add(new Konva.Text({ x: sec_termX+6, y: ecy+24, text: 'n\n(⏚)', fontSize: 7.5, fill: '#90caf9', lineHeight: 1.3 }));
        this.group.add(new Konva.Text({ x: w2X1+1, y: w2Y1+w2H*0.38, text: `N₂\n≈${this.ratedTurns2}\n匝`, fontSize: 8, fill: '#90caf9', lineHeight: 1.4 }));

        // 第三绕组（开口三角，示意）
        const w3Y1 = ecy + 52;
        this.group.add(new Konva.Line({ points: [w2X2, w3Y1, sec_termX, w3Y1, sec_termX, ecy+64], stroke: '#ff8a65', strokeWidth: 1.5, lineCap: 'round', dash: [4,3] }));
        this.group.add(new Konva.Line({ points: [w2X2, w3Y1+14, sec_termX, w3Y1+14, sec_termX, ecy+96], stroke: '#ff8a65', strokeWidth: 1.5, lineCap: 'round', dash: [4,3] }));
        this.group.add(new Konva.Text({ x: w2X1+1, y: w3Y1+2, text: '开口△\n(可选)', fontSize: 7, fill: '#ff8a65', lineHeight: 1.3 }));

        // 绕组发光
        this._w2Glow = new Konva.Rect({ x: w2X1-2, y: w2Y1-2, width: w2X2-w2X1+4, height: w2H+4, fill: 'rgba(21,101,192,0)', cornerRadius: 2 });
        this.group.add(this._w2Glow);
        this.group.add(this._w2Group);

        // 匝数比标注
        this.group.add(new Konva.Text({ x: ex+4, y: ey+eh-14, width: ew-8, text: `K=${this.ratioK}:1  N₁:N₂≈${this.ratedTurns1}:${this.ratedTurns2}`, fontSize: 8, fill: '#4fc3f7', align: 'center' }));

        // 保存几何参数
        this._frameX   = frameX;
        this._frameY   = frameY;
        this._frameW   = frameW;
        this._frameH   = frameH;
        this._coreLimb = limb;
        this._w1Y1     = w1Y1;
        this._w1Y2     = w1Y2;
    }

    // ── 动态磁通流动层 ──────────────────────
    _drawFluxLayer() {
        this._fluxGroup = new Konva.Group();
        this.group.add(this._fluxGroup);
    }

    // ── T 形等效电路图 ──────────────────────
    _drawEquivCircuit() {
        const { _eqX: ex, _eqY: ey, _eqW: ew, _eqH: eh } = this;

        this.group.add(new Konva.Rect({ x: ex, y: ey, width: ew, height: eh, fill: '#010d18', stroke: '#1a3040', strokeWidth: 1.5, cornerRadius: 4 }));
        this.group.add(new Konva.Rect({ x: ex, y: ey, width: ew, height: 13, fill: '#0a1a28', cornerRadius: [4,4,0,0] }));
        this.group.add(new Konva.Text({ x: ex+4, y: ey+2, width: ew-8, text: 'T 形等效电路（折算至一次侧）', fontSize: 8, fontStyle: 'bold', fill: '#80cbc4', align: 'center' }));

        // 主干线
        const y0 = ey + eh * 0.42;  // 上导线 Y
        const y1 = ey + eh * 0.88;  // 下导线 Y（公共 N 线）
        const x0 = ex + 14;         // 左起点（A 端）
        const xm = ex + ew * 0.42;  // 励磁支路节点
        const x1 = ex + ew - 14;    // 右终点（a' 端）

        // 上导线
        this.group.add(new Konva.Line({ points: [x0, y0, x1, y0], stroke: '#546e7a', strokeWidth: 1.5 }));
        // 下导线（公共中线 N）
        this.group.add(new Konva.Line({ points: [x0, y1, x1, y1], stroke: '#546e7a', strokeWidth: 1.5 }));
        // 左侧竖线（U1 端）
        this.group.add(new Konva.Line({ points: [x0, y0, x0, y1], stroke: '#ef9a9a', strokeWidth: 1.2 }));
        // 右侧竖线（U2' 端）
        this.group.add(new Konva.Line({ points: [x1, y0, x1, y1], stroke: '#90caf9', strokeWidth: 1.2 }));

        // ── R1（矩形锯齿）──
        const r1X = x0 + 12, r1W = 28;
        this._drawResistor(r1X, y0, r1W, 8, '#ef9a9a');
        this.group.add(new Konva.Text({ x: r1X, y: y0-14, text: `R₁\n${this.R1}Ω`, fontSize: 7, fill: '#ef9a9a', align: 'center', width: r1W, lineHeight: 1.3 }));

        // ── X1（电感线圈）──
        const x1X = r1X + r1W + 6, x1W = 28;
        this._drawInductor(x1X, y0, x1W, 7, '#ffd54f');
        this.group.add(new Konva.Text({ x: x1X, y: y0-14, text: `jX₁\n${this.X1}Ω`, fontSize: 7, fill: '#ffd54f', align: 'center', width: x1W, lineHeight: 1.3 }));

        // ── 励磁支路节点 ──
        this.group.add(new Konva.Circle({ x: xm, y: y0, radius: 3, fill: '#80cbc4' }));

        // Rm（竖向，并联）
        const rmY0 = y0 + 6, rmH = (y1 - y0) * 0.42;
        this._drawResistor(xm - 14, rmY0, rmH, 8, '#66bb6a', true);
        this.group.add(new Konva.Text({ x: xm - 28, y: rmY0 + rmH * 0.3, text: `Rm\n${(this.Rm/1e3).toFixed(0)}kΩ`, fontSize: 7, fill: '#66bb6a', lineHeight: 1.3 }));
        this.group.add(new Konva.Line({ points: [xm-14, rmY0+rmH, xm-14, y1, xm+14, y1, xm+14, rmY0+rmH], stroke: '#546e7a', strokeWidth: 1 }));

        // jXm（竖向，并联）
        const xmY0 = y0 + 6;
        this._drawInductor(xm + 6, xmY0, rmH, 7, '#ef9a9a', true);
        this.group.add(new Konva.Text({ x: xm + 18, y: xmY0 + rmH * 0.3, text: `jXm\n${(this.Xm/1e3).toFixed(0)}kΩ`, fontSize: 7, fill: '#ef9a9a', lineHeight: 1.3 }));
        this.group.add(new Konva.Line({ points: [xm, y0, xm, rmY0], stroke: '#546e7a', strokeWidth: 1 }));

        // ── R2'（折算）──
        const r2X = xm + 40, r2W = 28;
        this._drawResistor(r2X, y0, r2W, 8, '#90caf9');
        this.group.add(new Konva.Text({ x: r2X, y: y0-14, text: `R₂'\n${this.R2p}Ω`, fontSize: 7, fill: '#90caf9', align: 'center', width: r2W, lineHeight: 1.3 }));

        // ── X2'（折算）──
        const x2X = r2X + r2W + 6, x2W = 28;
        this._drawInductor(x2X, y0, x2W, 7, '#80cbc4');
        this.group.add(new Konva.Text({ x: x2X, y: y0-14, text: `jX₂'\n${this.X2p}Ω`, fontSize: 7, fill: '#80cbc4', align: 'center', width: x2W, lineHeight: 1.3 }));

        // ── 负载 ZL'（右侧，竖向）──
        const zlY0 = y0 + 6, zlH = (y1 - y0) * 0.78;
        this._drawResistor(x1 - 4, zlY0, zlH, 7, '#ffa726', true);
        this.group.add(new Konva.Text({ x: x1 + 4, y: zlY0 + zlH * 0.3, text: `Z_L'\n(负载)`, fontSize: 7, fill: '#ffa726', lineHeight: 1.3 }));
        this.group.add(new Konva.Line({ points: [x1, y0, x1, zlY0], stroke: '#546e7a', strokeWidth: 1 }));
        this.group.add(new Konva.Line({ points: [x1, zlY0+zlH, x1, y1], stroke: '#546e7a', strokeWidth: 1 }));

        // 端口标注
        this.group.add(new Konva.Text({ x: x0-10, y: ey+14, text: 'U₁', fontSize: 9, fill: '#ef9a9a', fontStyle: 'bold' }));
        this.group.add(new Konva.Text({ x: x1-12, y: ey+14, text: "U₂'", fontSize: 9, fill: '#90caf9', fontStyle: 'bold' }));

        // 电流方向箭头
        this.group.add(new Konva.Arrow({ points: [x0+4, y0-8, x0+20, y0-8], stroke: '#ef9a9a', fill: '#ef9a9a', strokeWidth: 1, pointerLength: 4, pointerWidth: 3 }));
        this.group.add(new Konva.Text({ x: x0+6, y: y0-18, text: 'I₁', fontSize: 7.5, fill: '#ef9a9a' }));
        this.group.add(new Konva.Arrow({ points: [x2X+x2W+4, y0-8, x2X+x2W+20, y0-8], stroke: '#90caf9', fill: '#90caf9', strokeWidth: 1, pointerLength: 4, pointerWidth: 3 }));
        this.group.add(new Konva.Text({ x: x2X+x2W+6, y: y0-18, text: "I₂'", fontSize: 7.5, fill: '#90caf9' }));

        // 励磁电流（竖向箭头）
        this._i0Arrow = new Konva.Arrow({ points: [xm, y0+6, xm, y0+18], stroke: '#66bb6a', fill: '#66bb6a', strokeWidth: 1.5, pointerLength: 4, pointerWidth: 3 });
        this.group.add(this._i0Arrow);
        this.group.add(new Konva.Text({ x: xm+5, y: y0+8, text: 'I₀', fontSize: 7.5, fill: '#66bb6a' }));
    }

    // 电阻符号（锯齿矩形）
    _drawResistor(x, y, len, h, color, vertical = false) {
        const n = 6, seg = len / n;
        const pts = [];
        if (!vertical) {
            pts.push(x, y);
            for (let i = 0; i < n; i++) {
                pts.push(x + seg*(i+0.25), y - h/2);
                pts.push(x + seg*(i+0.75), y + h/2);
            }
            pts.push(x + len, y);
        } else {
            pts.push(x, y);
            for (let i = 0; i < n; i++) {
                pts.push(x - h/2, y + seg*(i+0.25));
                pts.push(x + h/2, y + seg*(i+0.75));
            }
            pts.push(x, y + len);
        }
        this.group.add(new Konva.Line({ points: pts, stroke: color, strokeWidth: 1.5, lineJoin: 'round' }));
    }

    // 电感符号（弧形线圈）
    _drawInductor(x, y, len, r, color, vertical = false) {
        const n = 4, seg = len / n;
        const pts = [];
        if (!vertical) {
            for (let i = 0; i < n; i++) {
                const cx = x + seg * (i + 0.5);
                for (let a = Math.PI; a >= 0; a -= 0.2) {
                    pts.push(cx + r * Math.cos(a), y - r * Math.sin(a));
                }
            }
        } else {
            for (let i = 0; i < n; i++) {
                const cy = y + seg * (i + 0.5);
                for (let a = Math.PI/2; a <= 3*Math.PI/2; a += 0.2) {
                    pts.push(x - r * Math.cos(a), cy + r * Math.sin(a) - r);
                }
            }
        }
        this.group.add(new Konva.Line({ points: pts, stroke: color, strokeWidth: 1.5, lineJoin: 'round' }));
        // 连接线
        if (!vertical) {
            this.group.add(new Konva.Line({ points: [x, y, x + 2, y], stroke: color, strokeWidth: 1.5 }));
            this.group.add(new Konva.Line({ points: [x + len - 2, y, x + len, y], stroke: color, strokeWidth: 1.5 }));
        } else {
            this.group.add(new Konva.Line({ points: [x, y, x, y + 2], stroke: color, strokeWidth: 1.5 }));
            this.group.add(new Konva.Line({ points: [x, y + len - 2, x, y + len], stroke: color, strokeWidth: 1.5 }));
        }
    }

    // ── 相量图 ─────────────────────────────
    _drawPhasorDiagram() {
        const { _phX: px, _phY: py, _phW: pw, _phH: ph } = this;

        this.group.add(new Konva.Rect({ x: px, y: py, width: pw, height: ph, fill: '#010d18', stroke: '#1a3040', strokeWidth: 1.5, cornerRadius: 4 }));
        this.group.add(new Konva.Rect({ x: px, y: py, width: pw, height: 13, fill: '#0a1a28', cornerRadius: [4,4,0,0] }));
        this.group.add(new Konva.Text({ x: px+4, y: py+2, width: pw-8, text: '相量图（动态）', fontSize: 8, fontStyle: 'bold', fill: '#80cbc4', align: 'center' }));

        const ocx = px + pw * 0.44, ocy = py + ph * 0.56;
        const R   = Math.min(pw, ph) * 0.32;

        // 坐标轴
        this.group.add(new Konva.Line({ points: [px+6, ocy, px+pw-6, ocy], stroke: '#1a3040', strokeWidth: 0.7 }));
        this.group.add(new Konva.Line({ points: [ocx, py+16, ocx, py+ph-6], stroke: '#1a3040', strokeWidth: 0.7 }));
        this.group.add(new Konva.Text({ x: ocx+4, y: py+16, text: '+jQ', fontSize: 7, fill: '#37474f' }));
        this.group.add(new Konva.Text({ x: px+pw-14, y: ocy+3, text: '+P', fontSize: 7, fill: '#37474f' }));

        // 动态相量箭头（由 _tickPhasor 更新）
        this._phaU1   = new Konva.Arrow({ points: [ocx, ocy, ocx+R, ocy],         stroke: '#ef9a9a', fill: '#ef9a9a', strokeWidth: 2, pointerLength: 6, pointerWidth: 5 });
        this._phaU2k  = new Konva.Arrow({ points: [ocx, ocy, ocx+R*0.998, ocy-2], stroke: '#90caf9', fill: '#90caf9', strokeWidth: 2, pointerLength: 6, pointerWidth: 5 });
        this._phaI0   = new Konva.Arrow({ points: [ocx, ocy, ocx, ocy-R*0.08],    stroke: '#66bb6a', fill: '#66bb6a', strokeWidth: 1.5, pointerLength: 5, pointerWidth: 4 });
        this._phaDU   = new Konva.Arrow({ points: [ocx+R*0.998, ocy-2, ocx+R, ocy], stroke: '#ffd54f', fill: '#ffd54f', strokeWidth: 1.2, pointerLength: 4, pointerWidth: 3, dash: [3,2] });

        // 图例
        [[ocx+R*0.3, ocy-ph*0.28, '#ef9a9a','U₁'],
         [ocx+R*0.3, ocy-ph*0.20, '#90caf9',"U₂'（折算）"],
         [ocx+R*0.3, ocy-ph*0.12, '#66bb6a','I₀（励磁）'],
         [ocx+R*0.3, ocy-ph*0.04, '#ffd54f','ΔU（误差）']].forEach(([lx,ly,col,lbl]) => {
            this.group.add(new Konva.Line({ points: [lx, ly, lx+12, ly], stroke: col, strokeWidth: 2 }));
            this.group.add(new Konva.Text({ x: lx+14, y: ly-4, text: lbl, fontSize: 7, fill: col }));
        });

        this._phOCX = ocx; this._phOCY = ocy; this._phR = R;
        this.group.add(this._phaU1, this._phaU2k, this._phaI0, this._phaDU);
    }

    // ── B-H 励磁特性曲线 ────────────────────
    _drawBHCurve() {
        const { _bhX: bx, _bhY: by, _bhW: bw, _bhH: bh } = this;

        this.group.add(new Konva.Rect({ x: bx, y: by, width: bw, height: bh, fill: '#010d18', stroke: '#1a3040', strokeWidth: 1.5, cornerRadius: 4 }));
        this.group.add(new Konva.Rect({ x: bx, y: by, width: bw, height: 13, fill: '#0a1a28', cornerRadius: [4,4,0,0] }));
        this.group.add(new Konva.Text({ x: bx+4, y: by+2, width: bw-8, text: 'B-H 励磁特性（硅钢片）', fontSize: 8, fontStyle: 'bold', fill: '#80cbc4', align: 'center' }));

        const ox = bx+20, oy = by+bh-12, aw = bw-26, ah = bh-26;
        this.group.add(new Konva.Line({ points: [ox, oy-ah, ox, oy, ox+aw, oy], stroke: '#37474f', strokeWidth: 0.8 }));
        this.group.add(new Konva.Text({ x: ox-18, y: oy-ah, text: 'B(T)', fontSize: 7, fill: '#80cbc4' }));
        this.group.add(new Konva.Text({ x: ox+aw+2, y: oy+2, text: 'H', fontSize: 7, fill: '#80cbc4' }));

        // B-H 曲线（分段非线性，模拟硅钢片）
        const bhPts = [];
        const hMax  = 5000;  // A/m（横轴最大）
        const bhFn  = h => this.Bsat * (1 - Math.exp(-h / 800)) + this.Bsat * 0.08 * Math.tanh(h / 4000);
        for (let h = 0; h <= hMax; h += 50) {
            const B = bhFn(h);
            const x = ox + (h / hMax) * aw;
            const y = oy - Math.min(ah-2, (B / (this.Bsat * 1.1)) * (ah-2));
            bhPts.push(x, y);
        }
        this.group.add(new Konva.Line({ points: bhPts, stroke: '#4fc3f7', strokeWidth: 2, lineJoin: 'round', opacity: 0.75 }));

        // 饱和点虚线
        const BsatY = oy - (this.Bsat / (this.Bsat * 1.1)) * (ah-2);
        this.group.add(new Konva.Line({ points: [ox, BsatY, ox+aw, BsatY], stroke: '#ef5350', strokeWidth: 0.8, dash: [4,3] }));
        this.group.add(new Konva.Text({ x: ox+2, y: BsatY-10, text: `Bsat=${this.Bsat}T`, fontSize: 6.5, fill: '#ef5350' }));

        // 额定工作点虚线
        const HratedX = ox + (this.Hrated / hMax) * aw;
        const BratedY = oy - (this.Brated / (this.Bsat * 1.1)) * (ah-2);
        this.group.add(new Konva.Line({ points: [HratedX, oy, HratedX, BratedY], stroke: '#ffd54f', strokeWidth: 0.8, dash: [3,3] }));
        this.group.add(new Konva.Line({ points: [ox, BratedY, HratedX, BratedY], stroke: '#ffd54f', strokeWidth: 0.8, dash: [3,3] }));

        // 动态工作点
        this._bhPoint  = new Konva.Circle({ x: HratedX, y: BratedY, radius: 4, fill: '#ffd54f', stroke: '#f9a825', strokeWidth: 1.5 });
        this.group.add(this._bhPoint);
        this._bhOX = ox; this._bhOY = oy; this._bhAW = aw; this._bhAH = ah;
        this._bhFn = bhFn; this._bhHMax = hMax;
    }

    // ── 误差特性曲线 ────────────────────────
    _drawErrorCurve() {
        const { _errX: ex, _errY: ey, _errW: ew, _errH: eh } = this;

        this.group.add(new Konva.Rect({ x: ex, y: ey, width: ew, height: eh, fill: '#010d18', stroke: '#1a3040', strokeWidth: 1.5, cornerRadius: 4 }));
        this.group.add(new Konva.Rect({ x: ex, y: ey, width: ew, height: 13, fill: '#0a1a28', cornerRadius: [4,4,0,0] }));
        this.group.add(new Konva.Text({ x: ex+4, y: ey+2, width: ew-8, text: `误差特性（${this.accuracy}级）`, fontSize: 8, fontStyle: 'bold', fill: '#80cbc4', align: 'center' }));

        const ox = ex+14, oy = ey+eh/2+4, aw = ew-20, ah = (eh-22)/2-4;
        this.group.add(new Konva.Line({ points: [ox, ey+14, ox, ey+eh-10, ox+aw, ey+eh-10], stroke: '#37474f', strokeWidth: 0.8 }));
        this.group.add(new Konva.Text({ x: ox+aw+2, y: ey+eh-12, text: 'S(VA)', fontSize: 6.5, fill: '#37474f' }));
        this.group.add(new Konva.Line({ points: [ox, oy, ox+aw, oy], stroke: '#37474f', strokeWidth: 0.6, dash: [3,3] }));
        this.group.add(new Konva.Text({ x: ox-12, y: oy-4, text: '0%', fontSize: 6.5, fill: '#37474f' }));

        // 精度等级误差带（±fu%）
        const lim  = this._accuracyLimits[this.accuracy] || { fu: 0.5, delta: 20 };
        const fuY0 = oy - (lim.fu / 3.0) * ah;  // +fu%
        const fuY1 = oy + (lim.fu / 3.0) * ah;  // -fu%
        this.group.add(new Konva.Rect({ x: ox, y: fuY0, width: aw, height: fuY1-fuY0, fill: 'rgba(102,187,106,0.12)', stroke: '#66bb6a', strokeWidth: 0.8, dash: [4,3] }));
        this.group.add(new Konva.Text({ x: ox+2, y: fuY0-10, text: `+${lim.fu}%（${this.accuracy}级限）`, fontSize: 6.5, fill: '#66bb6a' }));
        this.group.add(new Konva.Text({ x: ox+2, y: fuY1+2, text: `-${lim.fu}%`, fontSize: 6.5, fill: '#66bb6a' }));

        // 典型误差曲线（轻载时误差大，额定附近最小，过载再增大）
        const errFn = (va) => {
            const ratio = va / this.ratedVA;
            return (1/ratio - 1 + ratio * 0.2) * lim.fu * 0.3;
        };
        const errPts = [];
        for (let va = this.ratedVA * 0.1; va <= this.ratedVA * 1.5; va += this.ratedVA * 0.05) {
            const x   = ox + (va / (this.ratedVA * 1.5)) * aw;
            const err = Math.max(-2.5, Math.min(2.5, errFn(va)));
            const y   = oy - (err / 3.0) * ah;
            errPts.push(x, y);
        }
        this.group.add(new Konva.Line({ points: errPts, stroke: '#ef9a9a', strokeWidth: 1.5, lineJoin: 'round', opacity: 0.7 }));

        // 额定点
        const nRX = ox + (this.ratedVA / (this.ratedVA * 1.5)) * aw;
        this.group.add(new Konva.Line({ points: [nRX, ey+14, nRX, ey+eh-10], stroke: '#ffd54f', strokeWidth: 0.7, dash: [3,3] }));
        this.group.add(new Konva.Text({ x: nRX-8, y: ey+eh-10, text: 'Sn', fontSize: 6.5, fill: '#ffd54f' }));

        // 动态工作点
        this._errPoint = new Konva.Circle({ x: nRX, y: oy, radius: 4, fill: '#ef5350', stroke: '#c62828', strokeWidth: 1.5 });
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
            { label: 'U₁',     id: 'u1',    unit: 'V',    color: '#ef9a9a' },
            { label: 'U₂',     id: 'u2',    unit: 'V',    color: '#90caf9' },
            { label: 'K_实',   id: 'kr',    unit: '',     color: '#ffd54f' },
            { label: '比差 fu', id: 'fu',   unit: '%',    color: '#66bb6a' },
            { label: '角差 δ', id: 'delta', unit: "min",  color: '#4fc3f7' },
            { label: 'I₀',     id: 'i0',    unit: 'mA',   color: '#80cbc4' },
            { label: 'P_Fe',   id: 'pfe',   unit: 'W',    color: '#ff8a65' },
            { label: '负载',   id: 'sload', unit: 'VA',   color: '#ffa726' },
            { label: '精度级', id: 'acc',   unit: '',     color: '#ce93d8' },
        ];

        const cellW = (lw - 8) / 3, cellH = 22, gap = 2;
        this._lcdCells = {};
        cells.forEach(({ label, id, unit, color }, i) => {
            const col = i % 3, row = Math.floor(i / 3);
            const cx3 = lx + 4 + col * (cellW + gap);
            const cy3 = ly + 16 + row * (cellH + gap);
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

        const sliders = [
            { label: `一次电压 U₁（额定 ${this.ratedU1}V）`, key: 'u1', color: '#ef9a9a',
              get: () => this._u1Set, set: v => { this._u1Set = v * this.ratedU1 * 1.2; },
              display: () => `${this._u1Set.toFixed(0)}V` },
            { label: `负载阻抗 Z_L（额定 ${this.ratedVA}VA时）`, key: 'zl', color: '#ffa726',
              get: () => this._zLoadOhm / (this.ratedVA > 0 ? this.ratedU2**2 / this.ratedVA * 10 : 1),
              set: v => { this._zLoadOhm = v * this.ratedU2**2 / this.ratedVA * 10;
                          this._zLoadSet = this._zLoadOhm * this.ratioK**2; },
              display: () => `${this._zLoadOhm.toFixed(0)}Ω` },
        ];

        const slW = (pw - 12) / 2 - 6;
        sliders.forEach(({ label, key, color, get, set, display }, si) => {
            const slX  = px + 4 + si * (slW + 14);
            const slY  = py + 38;
            this.group.add(new Konva.Text({ x: slX, y: slY - 12, text: label, fontSize: 7.5, fill: '#546e7a' }));
            this.group.add(new Konva.Rect({ x: slX, y: slY, width: slW, height: 8, fill: '#0a0a18', cornerRadius: 2 }));
            const bar = new Konva.Rect({ x: slX, y: slY, width: 0, height: 8, fill: color, cornerRadius: 2 });
            const txt = new Konva.Text({ x: slX + slW + 4, y: slY - 2, width: 52, text: '--', fontSize: 8, fontFamily: 'Courier New, monospace', fill: color });
            const hit = new Konva.Rect({ x: slX, y: slY-2, width: slW, height: 12, fill: 'transparent' });
            hit.on('click tap mousedown', e => {
                const stage = this.group.getStage?.();
                const pos   = stage?.getPointerPosition?.() ?? { x: e.evt?.clientX ?? 0 };
                const ratio = Math.max(0.02, Math.min(1, (pos.x - (this.group.x?.() ?? 0) - slX) / slW));
                set(ratio);
            });
            this.group.add(bar, txt, hit);
            // 保存引用供 _tickDisplay 更新
            if (!this._sliderBars) this._sliderBars = {};
            this._sliderBars[key] = { bar, txt, slW, get, display };
        });

        // 精度等级选择按钮
        const accLevels = ['0.1', '0.2', '0.5', '1', '3P', '6P'];
        const btnW = (pw - 12) / accLevels.length - 2;
        const btnY = py + ph - 22;
        this.group.add(new Konva.Text({ x: px+4, y: btnY - 10, text: '精度等级：', fontSize: 8, fill: '#546e7a' }));
        this._accBtns = {};
        accLevels.forEach((lvl, i) => {
            const bx  = px + 4 + i * (btnW + 2);
            const btn = new Konva.Rect({ x: bx, y: btnY, width: btnW, height: 16, fill: lvl === this.accuracy ? '#1a3a1a' : '#0d1520', stroke: lvl === this.accuracy ? '#66bb6a' : '#1a3040', strokeWidth: 1, cornerRadius: 2 });
            const t   = new Konva.Text({ x: bx, y: btnY+3, width: btnW, text: lvl, fontSize: 8, fill: lvl === this.accuracy ? '#66bb6a' : '#37474f', align: 'center' });
            btn.on('click tap', () => {
                this.accuracy = lvl;
                Object.entries(this._accBtns).forEach(([k, { btn: b, txt: t2 }]) => {
                    const active = k === lvl;
                    b.fill(active ? '#1a3a1a' : '#0d1520');
                    b.stroke(active ? '#66bb6a' : '#1a3040');
                    t2.fill(active ? '#66bb6a' : '#37474f');
                });
            });
            this._accBtns[lvl] = { btn, txt: t };
            this.group.add(btn, t);
        });
    }

    // ── 波形区 ─────────────────────────────
    _drawWaveform() {
        const { _wavX: wx, _wavY: wy, _wavW: ww, _wavH: wh } = this;
        if (wh < 14) return;

        this.group.add(new Konva.Rect({ x: wx, y: wy, width: ww, height: wh, fill: '#010d18', stroke: '#1a3040', strokeWidth: 1.5, cornerRadius: 4 }));
        this.group.add(new Konva.Rect({ x: wx, y: wy, width: ww, height: 12, fill: '#0a1a28', cornerRadius: [4,4,0,0] }));
        this.group.add(new Konva.Text({ x: wx+4, y: wy+1, width: ww-8, text: 'U₁ 一次电压   U₂×K 折算二次电压   ΔU 误差电压   I₀ 励磁电流   B 磁通密度', fontSize: 8, fill: '#80cbc4', align: 'center' }));

        const h5 = (wh - 12) / 5;
        this._wavMids = Array.from({ length: 5 }, (_, i) => wy + 12 + h5 * (i + 0.5));
        this._wavMids.forEach(my => this.group.add(new Konva.Line({ points: [wx+2, my, wx+ww-2, my], stroke: 'rgba(200,200,200,0.06)', strokeWidth: 0.5, dash: [4,3] })));

        this._wLU1   = new Konva.Line({ points: [], stroke: '#ef9a9a', strokeWidth: 1.5, lineJoin: 'round' });
        this._wLU2k  = new Konva.Line({ points: [], stroke: '#90caf9', strokeWidth: 1.5, lineJoin: 'round' });
        this._wLErr  = new Konva.Line({ points: [], stroke: '#ffd54f', strokeWidth: 1.2, lineJoin: 'round' });
        this._wLI0   = new Konva.Line({ points: [], stroke: '#66bb6a', strokeWidth: 1.5, lineJoin: 'round' });
        this._wLB    = new Konva.Line({ points: [], stroke: '#4fc3f7', strokeWidth: 1.5, lineJoin: 'round' });

        ['U₁', 'U₂×K', 'ΔU', 'I₀', 'B'].forEach((l, i) => {
            this.group.add(new Konva.Text({ x: wx+4, y: wy+12+h5*i+3, text: l, fontSize: 8, fill: ['#ef9a9a','#90caf9','#ffd54f','#66bb6a','#4fc3f7'][i] }));
        });
        this.group.add(this._wLU1, this._wLU2k, this._wLErr, this._wLI0, this._wLB);
        this._wavH5 = h5;
    }

    // ═══════════════════════════════════════════
    _startAnimation() {
        const tick = ts => {
            if (this._lastTs !== null) {
                const dt = Math.min((ts - this._lastTs) / 1000, 0.05);
                this._tickPhysics(dt);
                this._tickFluxViz(dt);
                this._tickPhasor(dt);
                this._tickBHPoint();
                this._tickErrPoint();
                this._tickWaveform();
                this._tickDisplay();
            }
            this._lastTs = ts;
            this._refreshCache();
            this._animId = requestAnimationFrame(tick);
        };
        this._animId = requestAnimationFrame(tick);
    }

    _stopAnimation() {
        if (this._animId) { cancelAnimationFrame(this._animId); this._animId = null; }
    }

    // ── 物理量计算 ───────────────────────────
    _tickPhysics(dt) {
        const omega = 2 * Math.PI * this.frequency;
        this._wavePhase += omega * dt;

        // 一次侧电压（有效值）
        this.u1Rms = this._u1Set;
        const u1Inst = this.u1Rms * Math.sqrt(2) * Math.sin(this._wavePhase);

        // 励磁支路（并联 Rm∥jXm）
        const Zm2  = (this.Rm**2 * this.Xm**2) / (this.Rm**2 + this.Xm**2);
        this.i0Rms = this.u1Rms / Math.sqrt(Zm2);  // A（很小）

        // 二次电流（近似空载，仅考虑负载阻抗折算至一次）
        const ZL   = this._zLoadSet;
        const Ztot = Math.sqrt((this.R1 + this.R2p + ZL)**2 + (this.X1 + this.X2p)**2);
        this.i2Rms = (ZL > 0 && Ztot > 0) ? this.u1Rms / Ztot : 0;  // 折算至一次的二次电流

        // 负载容量（二次侧实际）
        const i2sec    = this.i2Rms / this.ratioK;
        this.loadVA    = i2sec * this.ratedU2;

        // 误差计算
        // 压降 ΔU ≈ I0×(R1+jX1)（励磁电流在一次漏阻上的压降）
        const du_mag   = this.i0Rms * Math.sqrt(this.R1**2 + this.X1**2);
        // 角差（相位误差）：Δδ ≈ I0×X1 / U1（小角近似，转为 min）
        const deltaRad = (this.u1Rms > 0) ? (this.i0Rms * this.X1) / this.u1Rms : 0;
        this.errorDelta= deltaRad * (180 / Math.PI) * 60;  // 转为 min

        // 二次电压（折算回一次）
        const u2prime  = Math.max(0, this.u1Rms - du_mag);
        this.u2Rms     = u2prime / this.ratioK;
        const kActual  = (this.u2Rms > 0) ? this.u1Rms / this.u2Rms : this.ratioK;
        this.errorFu   = ((kActual - this.ratioK) / this.ratioK) * 100;  // %

        // 铁损
        this.ironLoss  = this.u1Rms**2 / this.Rm;

        // 磁通密度（与 U1 成正比，90° 相位超前）
        this.fluxPeak  = (this.u1Rms * Math.sqrt(2)) / (this.coilTurns1 * omega * this.coreArea + 1e-10);
        this.fluxDensity = this.fluxPeak * Math.cos(this._wavePhase);  // Φ 超前 U1 90°

        // 更新瞬时值用于波形
        const i0Inst   = this.i0Rms * Math.sqrt(2) * Math.sin(this._wavePhase - Math.PI/2 + this.phi0);
        const u2kInst  = u2prime * Math.sqrt(2) * Math.sin(this._wavePhase);
        const errInst  = u1Inst - u2kInst;

        this._wavU1  = new Float32Array([...this._wavU1.slice(1),  u1Inst]);
        this._wavU2k = new Float32Array([...this._wavU2k.slice(1), u2kInst]);
        this._wavErr = new Float32Array([...this._wavErr.slice(1), errInst]);
        this._wavI0  = new Float32Array([...this._wavI0.slice(1),  i0Inst]);
        this._wavB   = new Float32Array([...this._wavB.slice(1),   this.fluxDensity]);

        // 相量旋转（慢速演示）
        this._phasorAngle += dt * 2;  // rad/s（慢速旋转，约 0.3Hz，可视化效果）
    }

    get coilTurns1() { return this.ratedTurns1; }

    // ── 磁通粒子动画 ─────────────────────────
    _tickFluxViz(dt) {
        this._fluxGroup.destroyChildren();
        const B     = Math.abs(this.fluxDensity);
        const alpha = Math.min(0.75, B / (this.Brated || 1) * 0.75);
        if (alpha < 0.02) return;

        // 磁通绕铁芯环路循环（口字形路径）
        const { _frameX: fx, _frameY: fy, _frameW: fw, _frameH: fh, _coreLimb: limb } = this;
        const cx    = fx + limb / 2;
        const mx    = fx + fw - limb / 2;
        const ty    = fy + limb / 2;
        const by2   = fy + fh - limb / 2;
        const dir   = this.fluxDensity >= 0 ? 1 : -1;

        // 四段路径节点
        const path  = [[cx, ty], [mx, ty], [mx, by2], [cx, by2]];
        const nPart = 10;
        for (let i = 0; i < nPart; i++) {
            const t   = ((this._wavePhase * 0.025 * dir + i / nPart) % 1 + 1) % 1;
            const seg = Math.floor(t * 4);
            const frac= (t * 4) % 1;
            const p0  = path[seg % 4];
            const p1  = path[(seg + 1) % 4];
            this._fluxGroup.add(new Konva.Circle({
                x: p0[0] + (p1[0]-p0[0]) * frac,
                y: p0[1] + (p1[1]-p0[1]) * frac,
                radius: 2.5 + B * 0.8, fill: `rgba(255,213,79,${alpha})`,
            }));
        }

        // 绕组发光
        const gNorm = Math.min(1, B / (this.Brated || 1));
        if (this._w1Glow) this._w1Glow.fill(`rgba(229,57,53,${gNorm * 0.25})`);
        if (this._w2Glow) this._w2Glow.fill(`rgba(21,101,192,${gNorm * 0.20})`);
        if (this._w1Group) this._w1Group.opacity(0.4 + gNorm * 0.6);
        if (this._w2Group) this._w2Group.opacity(0.4 + gNorm * 0.6);
    }

    // ── 相量图动画 ──────────────────────────
    _tickPhasor(dt) {
        if (!this._phaU1) return;
        const R     = this._phR;
        const ocx   = this._phOCX, ocy = this._phOCY;
        const theta = this._phasorAngle;

        // U1 相量（以 theta 为旋转角）
        const u1X = ocx + R * Math.cos(theta);
        const u1Y = ocy - R * Math.sin(theta);
        this._phaU1.points([ocx, ocy, u1X, u1Y]);

        // 误差角（相位误差 δ，小角度）
        const dlt   = this.errorDelta * Math.PI / (180 * 60);  // rad
        // U2' 相量（幅值略小，相位超前 δ）
        const u2Mag = R * (1 - Math.min(0.05, Math.abs(this.errorFu) / 100));
        const u2X   = ocx + u2Mag * Math.cos(theta + dlt);
        const u2Y   = ocy - u2Mag * Math.sin(theta + dlt);
        this._phaU2k.points([ocx, ocy, u2X, u2Y]);

        // I0 相量（励磁电流，落后 U1 约 (90°-phi0)）
        const i0Mag  = R * Math.min(0.12, this.i0Rms / (this.u1Rms / this.Xm + 1e-10) * 0.12);
        const i0Angle= theta - Math.PI / 2 + this.phi0;
        const i0X    = ocx + i0Mag * Math.cos(i0Angle);
        const i0Y    = ocy - i0Mag * Math.sin(i0Angle);
        this._phaI0.points([ocx, ocy, i0X, i0Y]);

        // ΔU 相量（误差电压，从 U2' 端到 U1 端）
        this._phaDU.points([u2X, u2Y, u1X, u1Y]);
    }

    // ── B-H 工作点 ───────────────────────────
    _tickBHPoint() {
        if (!this._bhPoint || !this._bhFn) return;
        // 工作磁场强度（由励磁电流估算）
        const H_now = Math.abs(this.i0Rms) * this.ratedTurns1 / (this.coreLenth || 0.8);
        const B_now = Math.abs(this.fluxDensity);
        const bx    = Math.max(this._bhOX, Math.min(this._bhOX + this._bhAW, this._bhOX + (H_now / this._bhHMax) * this._bhAW));
        const by    = Math.max(this._bhOY - this._bhAH + 2, this._bhOY - (B_now / (this.Bsat * 1.1)) * (this._bhAH - 2));
        this._bhPoint.x(bx);
        this._bhPoint.y(by);
    }

    // ── 误差特性工作点 ────────────────────────
    _tickErrPoint() {
        if (!this._errPoint) return;
        const va   = Math.max(this.ratedVA * 0.01, Math.min(this.ratedVA * 1.5, this.loadVA));
        const ex   = this._errOX + (va / (this.ratedVA * 1.5)) * this._errAW;
        const lim  = this._accuracyLimits[this.accuracy] || { fu: 0.5 };
        const err  = (this._errFn ? this._errFn(va) : 0);
        const ey   = this._errOY - (err / 3.0) * this._errAH;
        this._errPoint.x(Math.max(this._errOX, Math.min(this._errOX + this._errAW, ex)));
        this._errPoint.y(ey);
        // 工作点颜色（在精度带内=绿，否则=红）
        this._errPoint.fill(Math.abs(this.errorFu) <= lim.fu ? '#66bb6a' : '#ef5350');
    }

    // ── 波形更新 ─────────────────────────────
    _tickWaveform() {
        if (!this._wavH5 || !this._wavMids) return;
        const wx = this._wavX + 3, ww = this._wavW - 6, n = this._wavLen;
        const dx = ww / n, h5 = this._wavH5;
        const [mU1, mU2k, mErr, mI0, mB] = this._wavMids;

        const u1pk = this.u1Rms * Math.sqrt(2) || 1;
        const i0pk = Math.max(1e-6, this.i0Rms * Math.sqrt(2));
        const bpk  = Math.max(0.01, Math.abs(this.fluxPeak));

        const ptU1=[], ptU2k=[], ptErr=[], ptI0=[], ptB=[];
        for (let i = 0; i < n; i++) {
            const x = wx + i * dx;
            ptU1.push(x,  mU1  - (this._wavU1[i]  / u1pk)      * h5 * 0.40);
            ptU2k.push(x, mU2k - (this._wavU2k[i] / u1pk)      * h5 * 0.40);
            ptErr.push(x, mErr - (this._wavErr[i]  / (u1pk*0.05+1e-10)) * h5 * 0.38);
            ptI0.push(x,  mI0  - (this._wavI0[i]  / i0pk)      * h5 * 0.38);
            ptB.push(x,   mB   - (this._wavB[i]   / bpk)       * h5 * 0.38);
        }
        if (this._wLU1)  this._wLU1.points(ptU1);
        if (this._wLU2k) this._wLU2k.points(ptU2k);
        if (this._wLErr) this._wLErr.points(ptErr);
        if (this._wLI0)  this._wLI0.points(ptI0);
        if (this._wLB)   this._wLB.points(ptB);
    }

    // ── 仪表显示 ─────────────────────────────
    _tickDisplay() {
        const c = this._lcdCells;
        if (!c) return;

        const lim      = this._accuracyLimits[this.accuracy] || { fu: 0.5, delta: 20 };
        const fuOK     = Math.abs(this.errorFu)    <= lim.fu;
        const deltaOK  = Math.abs(this.errorDelta) <= lim.delta;
        const accOK    = fuOK && deltaOK;

        if (c.u1)    c.u1.text(this.u1Rms.toFixed(0));
        if (c.u2)    c.u2.text(this.u2Rms.toFixed(2));
        if (c.kr)    c.kr.text((this.u1Rms / (this.u2Rms || 1)).toFixed(2));
        if (c.fu)  { c.fu.text(this.errorFu.toFixed(3));  c.fu.fill(fuOK    ? '#66bb6a' : '#ef5350'); }
        if (c.delta) { c.delta.text(this.errorDelta.toFixed(1)); c.delta.fill(deltaOK ? '#66bb6a' : '#ef5350'); }
        if (c.i0)    c.i0.text((this.i0Rms * 1000).toFixed(2));
        if (c.pfe)   c.pfe.text(this.ironLoss.toFixed(2));
        if (c.sload) c.sload.text(this.loadVA.toFixed(2));
        if (c.acc)  { c.acc.text(accOK ? `${this.accuracy}级 ✓` : `${this.accuracy}级 ✗`); c.acc.fill(accOK ? '#66bb6a' : '#ef5350'); }

        // 滑块同步
        if (this._sliderBars) {
            const u1Bar = this._sliderBars['u1'];
            if (u1Bar) {
                u1Bar.bar.width(Math.min(u1Bar.slW, (this._u1Set / (this.ratedU1 * 1.2)) * u1Bar.slW));
                u1Bar.txt.text(u1Bar.display());
            }
            const zlBar = this._sliderBars['zl'];
            if (zlBar) {
                const maxZ = this.ratedU2**2 / this.ratedVA * 10;
                zlBar.bar.width(Math.min(zlBar.slW, (this._zLoadOhm / maxZ) * zlBar.slW));
                zlBar.txt.text(zlBar.display());
            }
        }
    }

    // ═══════════════════════════════════════════
    setPrimaryVoltage(u) {
        this._u1Set = Math.max(0, Math.min(this.ratedU1 * 1.5, u));
        this._refreshCache();
    }

    setLoadImpedance(zOhm) {
        this._zLoadOhm = Math.max(10, zOhm);
        this._zLoadSet = this._zLoadOhm * this.ratioK**2;
        this._refreshCache();
    }

    getSecondaryVoltage() { return this.u2Rms; }
    getErrorFu()          { return this.errorFu; }
    getErrorDelta()       { return this.errorDelta; }
    isWithinAccuracy()    {
        const lim = this._accuracyLimits[this.accuracy] || { fu: 0.5, delta: 20 };
        return Math.abs(this.errorFu) <= lim.fu && Math.abs(this.errorDelta) <= lim.delta;
    }

    update(cfg = {}) {
        if (cfg.u1 !== undefined) this.setPrimaryVoltage(cfg.u1);
        if (cfg.zl !== undefined) this.setLoadImpedance(cfg.zl);
        this._refreshCache();
    }

    getConfigFields() {
        return [
            { label: '位号/名称',           key: 'id',           type: 'text'   },
            { label: '一次额定电压 (V)',     key: 'ratedU1',      type: 'number' },
            { label: '二次额定电压 (V)',     key: 'ratedU2',      type: 'number' },
            { label: '额定容量 (VA)',        key: 'ratedVA',      type: 'number' },
            { label: '最大容量 (VA)',        key: 'maxVA',        type: 'number' },
            { label: '精度等级',            key: 'accuracy',     type: 'text'   },
            { label: '频率 (Hz)',           key: 'frequency',    type: 'number' },
            { label: '一次绕组电阻 R1 (Ω)', key: 'R1',           type: 'number' },
            { label: '一次漏抗 X1 (Ω)',     key: 'X1',           type: 'number' },
            { label: '铁损电阻 Rm (kΩ)',    key: 'Rm',           type: 'number' },
            { label: '励磁感抗 Xm (kΩ)',    key: 'Xm',           type: 'number' },
            { label: '额定磁通密度 (T)',     key: 'Brated',       type: 'number' },
            { label: '饱和磁通密度 (T)',     key: 'Bsat',         type: 'number' },
            { label: '接线方式',            key: 'wiring',       type: 'text'   },
        ];
    }

    onConfigUpdate(cfg) {
        this.id         = cfg.id       || this.id;
        this.ratedU1    = parseFloat(cfg.ratedU1)    || this.ratedU1;
        this.ratedU2    = parseFloat(cfg.ratedU2)    || this.ratedU2;
        this.ratedVA    = parseFloat(cfg.ratedVA)    || this.ratedVA;
        this.maxVA      = parseFloat(cfg.maxVA)      || this.maxVA;
        this.accuracy   = cfg.accuracy || this.accuracy;
        this.frequency  = parseFloat(cfg.frequency)  || this.frequency;
        this.R1         = parseFloat(cfg.R1)  || this.R1;
        this.X1         = parseFloat(cfg.X1)  || this.X1;
        this.Rm         = parseFloat(cfg.Rm)  * 1e3 || this.Rm;
        this.Xm         = parseFloat(cfg.Xm)  * 1e3 || this.Xm;
        this.Brated     = parseFloat(cfg.Brated) || this.Brated;
        this.Bsat       = parseFloat(cfg.Bsat)   || this.Bsat;
        this.wiring     = cfg.wiring || this.wiring;
        this.ratioK     = this.ratedU1 / this.ratedU2;
        this.ratedTurns2= Math.round(this.ratedTurns1 / this.ratioK);
        this.coilIss    = this.ratedU1 / this.Rm;
        this.config     = { ...this.config, ...cfg };
        this._refreshCache();
    }

    destroy() { this._stopAnimation(); super.destroy?.(); }
}