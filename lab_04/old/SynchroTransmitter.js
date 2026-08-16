import { BaseComponent } from './BaseComponent.js';

/**
 * 控制式自整角机发送机仿真组件
 * （Control Synchro Transmitter，CX / CT-TX）
 *
 * ── 自整角机系统概述 ──────────────────────────────────────────
 *
 *  自整角机（Synchro）是一种模拟式角度传感器/传输装置，
 *  广泛用于军事、航空、船舶、工业的角度远程传输与随动系统。
 *
 *  系统由"发送机（TX）"+"接收机（TR/CX）"成对使用：
 *  ┌──────────────┬──────────────────────────────────────────────┐
 *  │  类型        │  用途                                        │
 *  ├──────────────┼──────────────────────────────────────────────┤
 *  │ 力矩式（TT） │ 直接传递转矩，驱动轻载指针，无放大           │
 *  │ 控制式（CX） │ 输出电压信号（误差信号），驱动伺服放大器     │
 *  └──────────────┴──────────────────────────────────────────────┘
 *
 *  本组件：控制式自整角机发送机（CX-TX），
 *  输出三相定子电压 e_S1、e_S2、e_S3，供控制变压器（CT/CX-TR）接收。
 *
 * ── 工作原理 ──────────────────────────────────────────────────
 *
 *  1. 结构：
 *     转子（励磁绕组 R1-R2）：单相，通入交流励磁电压 U_R = U_m × sin(ωt)
 *     定子（输出绕组 S1/S2/S3）：三相，互差 120°，输出感应电压
 *
 *  2. 转子励磁产生磁通：
 *     Φ(t) = Φ_m × sin(ωt)
 *     其中 Φ_m 正比于励磁电压幅值，ω = 2πf（通常 50Hz 或 400Hz 航空）
 *
 *  3. 定子感应电压（角度编码）：
 *     转子转至角度 θ 时，三相定子感应电压为：
 *       e_S1(t,θ) = K × U_m × cos(θ) × sin(ωt + φ_S1)
 *       e_S2(t,θ) = K × U_m × cos(θ - 120°) × sin(ωt + φ_S2)
 *       e_S3(t,θ) = K × U_m × cos(θ + 120°) × sin(ωt + φ_S3)
 *     其中：
 *       K：变压比（电压比），典型值 0.5~1.0
 *       φ_Si：各相相位（理想情况相同，实际含相位误差）
 *       三相电压幅值（包络）携带角度信息，相位（载波）携带频率信息
 *
 *  4. 角度信息解码（在接收侧）：
 *     角度 θ 编码于三相幅值比中：
 *       arctan(√3 × (e_S3 - e_S2) / (2×e_S1 - e_S2 - e_S3)) = θ
 *     或通过 Scott-T 变压器变换为正交双相信号：
 *       e_α = K × sin(θ) × U_m × sin(ωt)
 *       e_β = K × cos(θ) × U_m × sin(ωt)
 *
 *  5. 误差电压（与控制变压器CT配合）：
 *     当发送机角度 θ_TX ≠ 接收机轴角 θ_RX 时，
 *     CT 输出误差信号：
 *       e_error = K × U_m × sin(θ_TX - θ_RX) × sin(ωt)
 *     小角度近似（θ_TX - θ_RX << 1rad）：
 *       e_error ≈ K × U_m × (θ_TX - θ_RX) × sin(ωt)
 *     此误差电压驱动伺服放大器→伺服电机→使 θ_RX → θ_TX（随动系统）
 *
 *  6. 精度指标：
 *     电气误差（Electrical Error）：实际输出角度与理想的偏差，典型 ±10'~±20'
 *     零位误差（Null Voltage）：θ=0 时残余电压，典型 < 5mV
 *     相位误差：输出电压与励磁电压的相位偏差，典型 < 3°
 *
 *  7. 典型应用：
 *     舰炮/雷达天线方位角远程传输
 *     飞机姿态角（俯仰/滚转/偏航）传感
 *     工业阀门/旋转机械位置反馈
 *     航海罗经角度传输
 *
 * ── 组件结构 ──────────────────────────────────────────────────
 *  ① 自整角机横截面图（转子励磁绕组 + 三相定子绕组，动态旋转）
 *  ② 励磁回路图（R1-R2 励磁端子，U_R 正弦电压，阻抗特性）
 *  ③ 三相定子输出波形（e_S1/e_S2/e_S3，调幅波，携带角度信息）
 *  ④ 角度-幅值特性曲线（三相输出幅值 vs 转子角度 θ）
 *  ⑤ 相量图（定子三相电压相量，随角度旋转；励磁磁通相量）
 *  ⑥ Scott-T 变换可视化（三相→正交双相，sin/cos 分量）
 *  ⑦ 极坐标显示（合成电压矢量幅值与方向，直观显示编码角度）
 *  ⑧ 误差电压波形（模拟与接收机 CT 的误差信号，含小角度近似）
 *  ⑨ LCD 仪表（转子角度/励磁电压/三相输出电压/误差/变压比/频率）
 *  ⑩ 控制面板（转子角度调节/励磁电压/频率/误差角度给定/精度配置）
 *
 * ── 端口 ─────────────────────────────────────────────────────
 *  excit_r1  — 励磁端子 R1（+）
 *  excit_r2  — 励磁端子 R2（-）
 *  stator_s1 — 定子输出 S1
 *  stator_s2 — 定子输出 S2
 *  stator_s3 — 定子输出 S3
 *  shaft     — 转子轴（角度输入）
 */
export class SynchroTransmitter extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.width  = Math.max(580, config.width  || 720);
        this.height = Math.max(440, config.height || 560);

        this.type    = 'synchro_transmitter';
        this.special = 'none';
        this.cache   = 'fixed';

        this._initGroups();
        // ── 额定参数 ──
        this.ratedVoltage = config.ratedVoltage || 115;    // V（励磁额定电压，航空标准）
        this.ratedFreq    = config.ratedFreq    || 400;    // Hz（航空 400Hz，也可 50Hz）
        this.ratedCurrent = config.ratedCurrent || 0.18;   // A（励磁额定电流）
        this.outputVoltage= config.outputVoltage|| 90;     // V（定子额定线电压）
        this.voltageRatio = config.voltageRatio || (this.outputVoltage / this.ratedVoltage); // 变压比 K

        // ── 电气参数 ──
        this.R_rotor  = config.R_rotor  || 180;     // Ω（转子绕组电阻）
        this.L_rotor  = config.L_rotor  || 0.45;    // H（转子绕组电感）
        this.R_stator = config.R_stator || 220;     // Ω（每相定子绕组电阻）
        this.L_stator = config.L_stator || 0.32;    // H（每相定子绕组电感）
        this.Lm       = config.Lm       || 2.5;     // H（互感）

        // 转子阻抗
        this.Z_rotor  = Math.sqrt(this.R_rotor**2 + (2*Math.PI*this.ratedFreq*this.L_rotor)**2);
        this.cosPhi_r = this.R_rotor / this.Z_rotor;  // 励磁功率因数

        // 精度参数
        this.electricalError = config.electricalError || 10;   // 角分（arcmin）
        this.nullVoltage      = config.nullVoltage     || 3e-3; // V（零位残压）
        this.phaseError       = config.phaseError      || 2.0;  // °（相位误差）
        this.harmonicDistort  = config.harmonicDistort || 0.003;// 谐波失真比

        // ── 运行状态 ──
        this._wavePhase   = 0;      // 载波相位（rad）
        this._rotorAngle  = config.initAngle || 30; // 转子角度（°）
        this._rotorAngleRad = this._rotorAngle * Math.PI / 180;
        this._rotorOmega  = 0;      // 转子角速度（rad/s，可手动或自动旋转）
        this._autoRotate  = false;  // 自动旋转标志
        this._autoOmega   = 10 * Math.PI / 180; // 自动旋转速度（rad/s，约 1°/0.1s）

        // 励磁设定
        this._excitVoltSet= this.ratedVoltage;
        this._freqSet     = this.ratedFreq;

        // 接收端模拟（用于误差信号计算）
        this._rxAngle     = config.initRxAngle || 0;  // 接收机轴角（°）
        this._rxAngleRad  = this._rxAngle * Math.PI / 180;

        // 实时电气量
        this.u_R         = 0;   // 励磁瞬时电压 V
        this.i_R         = 0;   // 励磁瞬时电流 A
        this.phi_m       = 0;   // 主磁通瞬时值（标幺）
        this.e_S1        = 0;   this.e_S2 = 0; this.e_S3 = 0;   // 三相瞬时电压 V
        this.E_S1_rms    = 0;   this.E_S2_rms = 0; this.E_S3_rms = 0; // 三相有效值 V
        this.e_error     = 0;   // 误差信号瞬时电压 V
        this.e_alpha     = 0;   // Scott-T α 分量
        this.e_beta      = 0;   // Scott-T β 分量
        this.decodedAngle= 0;   // 解码角度（°）

        // ── 波形缓冲 ──
        this._wavLen    = 320;
        this._wavUR     = new Float32Array(this._wavLen).fill(0); // 励磁电压
        this._wavES1    = new Float32Array(this._wavLen).fill(0); // S1 定子电压
        this._wavES2    = new Float32Array(this._wavLen).fill(0); // S2 定子电压
        this._wavES3    = new Float32Array(this._wavLen).fill(0); // S3 定子电压
        this._wavEerr   = new Float32Array(this._wavLen).fill(0); // 误差信号
        this._wavTheta  = new Float32Array(this._wavLen).fill(0); // 转子角度（°）

        // ── 几何布局 ──
        // 电机截面（左上）
        this._synX   = Math.round(this.width * 0.02);
        this._synY   = Math.round(this.height * 0.04);
        this._synW   = Math.round(this.width * 0.26);
        this._synH   = Math.round(this.height * 0.46);
        this._synCX  = this._synX + this._synW / 2;
        this._synCY  = this._synY + this._synH / 2;

        // 励磁回路图（中上左）
        this._excX   = Math.round(this.width * 0.30);
        this._excY   = this._synY;
        this._excW   = Math.round(this.width * 0.20);
        this._excH   = Math.round(this.height * 0.22);

        // 角度-幅值特性曲线（中上右）
        this._ampX   = this._excX + this._excW + 8;
        this._ampY   = this._synY;
        this._ampW   = Math.round(this.width * 0.22);
        this._ampH   = this._excH;

        // 极坐标显示（右上）
        this._polX   = this._ampX + this._ampW + 8;
        this._polY   = this._synY;
        this._polW   = this.width - this._polX - Math.round(this.width * 0.02);
        this._polH   = this._excH;

        // 相量图（中中左）
        this._phX    = this._excX;
        this._phY    = this._excY + this._excH + 8;
        this._phW    = this._excW;
        this._phH    = Math.round(this.height * 0.26);

        // Scott-T 变换（中中右）
        this._scX    = this._phX + this._phW + 8;
        this._scY    = this._phY;
        this._scW    = this._ampW;
        this._scH    = this._phH;

        // 误差分析（右中）
        this._errX   = this._scX + this._scW + 8;
        this._errY   = this._phY;
        this._errW   = this._polW;
        this._errH   = this._phH;

        // LCD（左下）
        this._lcdX   = this._synX;
        this._lcdY   = this._synY + this._synH + 8;
        this._lcdW   = this._synW;
        this._lcdH   = Math.round(this.height * 0.24);

        // 控制面板（中下）
        this._panX   = this._excX;
        this._panY   = this._phY + this._phH + 8;
        this._panW   = this.width - this._excX - Math.round(this.width * 0.02);
        this._panH   = Math.round(this.height * 0.16);

        // 波形（底部全宽）
        this._wavX   = this._synX;
        this._wavY   = Math.max(this._lcdY + this._lcdH, this._panY + this._panH) + 6;
        this._wavW   = this.width - this._synX * 2;
        this._wavH   = this.height - this._wavY - 6;

        this._animPhase = 0;

        this.config = {
            id: this.id,
            ratedVoltage: this.ratedVoltage,
            ratedFreq: this.ratedFreq,
            outputVoltage: this.outputVoltage,
        };

        this._init();

        // 端口
        const sL = this._synX - 6;
        this.addPort(sL, this._synCY - 20, 'excit_r1', 'wire', 'R1(+)');
        this.addPort(sL, this._synCY + 20, 'excit_r2', 'wire', 'R2(-)');
        const sR = this._synX + this._synW + 6;
        this.addPort(sR, this._synCY - 28, 'stator_s1', 'wire', 'S1');
        this.addPort(sR, this._synCY,       'stator_s2', 'wire', 'S2');
        this.addPort(sR, this._synCY + 28,  'stator_s3', 'wire', 'S3');
        this.addPort(this._synCX, this._synY + this._synH + 6, 'shaft', 'pipe', '转子轴');
    }

    // ═══════════════════════════════════════════
    _init() {
        this._drawLabel();
        this._drawSynchroSection();
        this._drawFluxLayer();
        this._drawRotorLayer();
        this._drawExcitCircuit();
        this._drawAmplitudeCurve();
        this._drawPolarDisplay();
        this._drawPhasorDiagram();
        this._drawScottT();
        this._drawErrorAnalysis();
        this._drawLCDPanel();
        this._drawControlPanel();
        this._drawWaveform();
        
    }

    _drawLabel() {
        this._staticGroup.add(new Konva.Text({
            x: 0, y: -22, width: this.width,
            text: `控制式自整角机发送机（CX-TX）  励磁 ${this.ratedVoltage}V/${this.ratedFreq}Hz  ` +
                  `输出 ${this.outputVoltage}V  变压比 K=${this.voltageRatio.toFixed(3)}  精度 ±${this.electricalError}'`,
            fontSize: 10, fontStyle: 'bold', fill: '#1a2634', align: 'center',
        }));
    }

    // ── 自整角机横截面 ────────────────────────
    _drawSynchroSection() {
        const { _synX: ex, _synY: ey, _synW: ew, _synH: eh,
                _synCX: ecx, _synCY: ecy } = this;

        this._staticGroup.add(new Konva.Rect({
            x: ex, y: ey, width: ew, height: eh,
            fill: '#0d1a24', stroke: '#1a3040', strokeWidth: 1.5, cornerRadius: 5,
        }));
        this._staticGroup.add(new Konva.Text({
            x: ex, y: ey - 14, width: ew,
            text: `自整角机截面（CX型，${this.ratedFreq}Hz）`,
            fontSize: 9, fontStyle: 'bold', fill: '#546e7a', align: 'center',
        }));

        // ── 外壳 ──
        const frameR = Math.round(Math.min(ew, eh) * 0.46);
        this._staticGroup.add(new Konva.Circle({ x: ecx, y: ecy, radius: frameR, fill: '#1c2b38', stroke: '#37474f', strokeWidth: 3 }));

        // ── 定子铁芯（叠片） ──
        const sOuter = Math.round(frameR * 0.90);
        const sInner = Math.round(frameR * 0.56);
        this._staticGroup.add(new Konva.Ring({ x: ecx, y: ecy, innerRadius: sInner, outerRadius: sOuter, fill: '#455a64', stroke: '#263238', strokeWidth: 1 }));

        // 叠片纹（定子）
        for (let i = 0; i < 36; i++) {
            const a = (i / 36) * Math.PI * 2;
            this._staticGroup.add(new Konva.Line({
                points: [ecx + sInner*Math.cos(a), ecy + sInner*Math.sin(a),
                         ecx + sOuter*Math.cos(a), ecy + sOuter*Math.sin(a)],
                stroke: 'rgba(0,0,0,0.12)', strokeWidth: 0.5,
            }));
        }

        // ── 定子三相绕组（互差 120°） ──
        // S1 轴：90°（垂直上），S2 轴：210°，S3 轴：330°
        const statorAxes = [Math.PI/2, Math.PI/2 + 2*Math.PI/3, Math.PI/2 + 4*Math.PI/3];
        const statorColors = ['#e53935', '#43a047', '#1e88e5'];
        const statorNames  = ['S1', 'S2', 'S3'];
        const wR  = sInner + (sOuter-sInner)*0.45;
        const wW  = 5;

        this._statorWindings = [];
        statorAxes.forEach((a, i) => {
            // 正向侧（绕组去侧）
            for (let t = -1; t <= 1; t++) {
                const ta = a + t * Math.PI / 8;
                const r0 = sInner * 1.02, r1 = r0 + (sOuter-sInner)*0.55;
                this._staticGroup.add(new Konva.Line({
                    points: [ecx+r0*Math.cos(ta), ecy+r0*Math.sin(ta),
                             ecx+r1*Math.cos(ta), ecy+r1*Math.sin(ta)],
                    stroke: '#0d1a24', strokeWidth: 4.5, lineCap: 'square',
                }));
            }
            // 绕组导线（着色椭圆，代表线圈）
            const wx2 = ecx + wR*Math.cos(a), wy2 = ecy + wR*Math.sin(a);
            const wDot = new Konva.Circle({ x: wx2, y: wy2, radius: wW, fill: statorColors[i], opacity: 0.75 });
            const wx2b = ecx + wR*Math.cos(a+Math.PI), wy2b = ecy + wR*Math.sin(a+Math.PI);
            const wDotB = new Konva.Circle({ x: wx2b, y: wy2b, radius: wW, fill: statorColors[i], opacity: 0.30 });
            this._statorWindings.push({ dot: wDot, dotB: wDotB, angle: a, col: statorColors[i] });

            // 轴标注
            this._staticGroup.add(new Konva.Text({
                x: ecx + (sInner+(sOuter-sInner)*0.7)*Math.cos(a)-6,
                y: ecy + (sInner+(sOuter-sInner)*0.7)*Math.sin(a)-6,
                text: statorNames[i], fontSize: 8, fill: statorColors[i], fontStyle: 'bold',
            }));
            this._staticGroup.add(wDot, wDotB);
        });
        this._statorAxes  = statorAxes;
        this._statorColors= statorColors;

        // ── 气隙 ──
        this._airGapR = Math.round(sInner * 0.97);
        this._staticGroup.add(new Konva.Circle({ x: ecx, y: ecy, radius: this._airGapR, fill: '#05101a', stroke: '#1a3040', strokeWidth: 0.5 }));

        // ── 转子铁芯（凸极，2极）──
        const rotorR = Math.round(this._airGapR * 0.82);
        this._staticGroup.add(new Konva.Circle({ x: ecx, y: ecy, radius: rotorR, fill: '#2e3f4f', stroke: '#37474f', strokeWidth: 1.2 }));
        this._rotorR  = rotorR;
        this._sInner  = sInner;
        this._sOuter  = sOuter;
        this._frameR  = frameR;

        // 转子极靴（凸极形状）
        for (let p = 0; p < 2; p++) {
            const pa = p * Math.PI;
            this._staticGroup.add(new Konva.Arc({
                x: ecx, y: ecy,
                innerRadius: rotorR*0.72, outerRadius: rotorR*0.95,
                angle: 90, rotation: pa*180/Math.PI - 45,
                fill: '#455a64', stroke: '#263238', strokeWidth: 1,
            }));
        }

        // ── 转子励磁绕组（R1-R2，红色，单相）──
        this._rotorCoilGroup = new Konva.Group({ x: ecx, y: ecy });
        const nTurns = 10;
        for (let i = 0; i < nTurns; i++) {
            const a   = (i/nTurns) * Math.PI * 2;
            const ri  = rotorR * 0.35, ro = rotorR * 0.65;
            const col = ['#c87832','#e09040','#d08838'][i%3];
            this._rotorCoilGroup.add(new Konva.Line({
                points: [ri*Math.cos(a), ri*Math.sin(a), ro*Math.cos(a), ro*Math.sin(a)],
                stroke: col, strokeWidth: 2, lineCap: 'round', opacity: 0.8,
            }));
        }
        // 轴
        this._rotorCoilGroup.add(new Konva.Circle({ radius: 7, fill: '#1a252f', stroke: '#37474f', strokeWidth: 1.5 }));
        // 参考标记点
        this._rotorRef = new Konva.Circle({ x: rotorR*0.60, y: 0, radius: 3, fill: '#ffd54f' });
        this._rotorCoilGroup.add(this._rotorRef);
        // d 轴标注（红色虚线）
        this._rotorCoilGroup.add(new Konva.Line({ points: [-rotorR*0.90, 0, rotorR*0.90, 0], stroke: '#ffd54f', strokeWidth: 0.8, dash: [4,3], opacity: 0.6 }));
        this._rotorCoilGroup.add(new Konva.Text({ x: rotorR*0.90+2, y: -5, text: 'd', fontSize: 8, fill: '#ffd54f', opacity: 0.7 }));
        this._staticGroup.add(this._rotorCoilGroup);

        // ── 集电环（滑环，励磁引入）──
        const slipR1 = rotorR * 0.28, slipR2 = rotorR * 0.38;
        this._staticGroup.add(new Konva.Ring({ x: ecx, y: ecy, innerRadius: slipR1, outerRadius: slipR2, fill: 'rgba(200,120,50,0.3)', stroke: '#a06020', strokeWidth: 0.8 }));
        this._staticGroup.add(new Konva.Text({ x: ecx-20, y: ecy-slipR2-12, text: '集电环', fontSize: 7, fill: '#c87832' }));

        // 励磁引线（左侧端子）
        const termX = ex - 10;
        [['R1','#ef9a9a',-20],['R2','#90caf9',20]].forEach(([l,c,dy]) => {
            this._staticGroup.add(new Konva.Line({ points: [termX, ecy+dy, ex+8, ecy+dy], stroke: c, strokeWidth: 2, dash: [3,3] }));
            this._staticGroup.add(new Konva.Circle({ x: termX, y: ecy+dy, radius: 3.5, fill: c }));
            this._staticGroup.add(new Konva.Text({ x: ex-25, y: ecy+dy-5, text: l, fontSize: 8, fill: c, fontStyle: 'bold' }));
        });

        // 定子输出端子（右侧）
        const outX = ex + ew + 10;
        [['S1','#e53935',-28],['S2','#43a047',0],['S3','#1e88e5',28]].forEach(([l,c,dy]) => {
            this._staticGroup.add(new Konva.Line({ points: [ecx+sOuter*0.65, ecy+dy, outX, ecy+dy], stroke: c, strokeWidth: 2 }));
            this._staticGroup.add(new Konva.Circle({ x: outX, y: ecy+dy, radius: 3.5, fill: c }));
            this._staticGroup.add(new Konva.Text({ x: outX+5, y: ecy+dy-6, text: l, fontSize: 9, fill: c, fontStyle: 'bold' }));
        });

        // 轴标注（底部）
        this._staticGroup.add(new Konva.Rect({ x: ecx-5, y: ey+eh, width: 10, height: 10, fill: '#78909c', stroke: '#546e7a', strokeWidth: 1 }));
        this._staticGroup.add(new Konva.Text({ x: ecx-16, y: ey+eh+12, text: '角度输入轴', fontSize: 7, fill: '#546e7a' }));
    }

    // ── 磁通动画层 ──────────────────────────
    _drawFluxLayer() {
        this._fluxGroup = new Konva.Group();
        this._staticGroup.add(this._fluxGroup);
    }

    // ── 转子旋转层（已在 section 中创建 _rotorCoilGroup）──
    _drawRotorLayer() {
        // 转子已在 _drawSynchroSection 中完成
        // 此处添加静态转子角度指示线
        this._rotorAngleLine = new Konva.Line({
            points: [this._synCX, this._synCY,
                     this._synCX + this._rotorR*0.75, this._synCY],
            stroke: '#ffd54f', strokeWidth: 1.5, dash: [4,3], opacity: 0.7,
        });
        this._staticGroup.add(this._rotorAngleLine);
    }

    // ── 励磁回路图 ──────────────────────────
    _drawExcitCircuit() {
        const { _excX: ex, _excY: ey, _excW: ew, _excH: eh } = this;

        this._staticGroup.add(new Konva.Rect({ x:ex, y:ey, width:ew, height:eh, fill:'#010d18', stroke:'#1a3040', strokeWidth:1.5, cornerRadius:4 }));
        this._staticGroup.add(new Konva.Rect({ x:ex, y:ey, width:ew, height:13, fill:'#0a1a28', cornerRadius:[4,4,0,0] }));
        this._staticGroup.add(new Konva.Text({ x:ex+4, y:ey+2, width:ew-8, text:'励磁回路（R1-R2）', fontSize:8, fontStyle:'bold', fill:'#80cbc4', align:'center' }));

        // 励磁电路示意（电压源 → R → L → 线圈）
        const y0 = ey+eh*0.35, y1 = ey+eh*0.85;
        const x0 = ex+12, x1 = ex+ew-12;
        const xm  = (x0+x1)/2;

        // 上下导线
        this._staticGroup.add(new Konva.Line({ points:[x0,y0,x1,y0], stroke:'#ef9a9a', strokeWidth:1.5 }));
        this._staticGroup.add(new Konva.Line({ points:[x0,y1,x1,y1], stroke:'#90caf9', strokeWidth:1.5 }));
        // 左侧竖线（电压源）
        this._staticGroup.add(new Konva.Line({ points:[x0,y0,x0,y1], stroke:'#37474f', strokeWidth:1 }));
        // 电压源符号（正弦波）
        const srcPts = [];
        for (let i = 0; i <= 20; i++) {
            const t = i/20 * Math.PI * 2;
            srcPts.push(x0 + 5 + 5*Math.cos(t)*0, (y0+y1)/2 + (y1-y0)*0.3*Math.sin(t));
        }
        this._staticGroup.add(new Konva.Circle({ x:x0, y:(y0+y1)/2, radius:(y1-y0)*0.30, fill:'#0a1a28', stroke:'#ef9a9a', strokeWidth:1.5 }));
        this._staticGroup.add(new Konva.Line({
            points: Array.from({length:30},(_,i)=>{
                const t=i/29*Math.PI*2;
                return [i%2===0?x0+(y1-y0)*0.18*Math.cos(t):(y0+y1)/2+(y1-y0)*0.20*Math.sin(t)];
            }).flat(),
            stroke:'#ef9a9a', strokeWidth:1, lineJoin:'round', opacity:0.7,
        }));
        this._staticGroup.add(new Konva.Text({ x:x0-(y1-y0)*0.32, y:(y0+y1)/2-6, text:'~\nU_R', fontSize:8, fill:'#ef9a9a', align:'center', lineHeight:1.2 }));

        // 电阻 R（锯齿）
        const rX1=xm-20, rX2=xm;
        this._drawResistorH(rX1, y0, rX2-rX1, 6, '#ffa726');
        this._staticGroup.add(new Konva.Text({ x:rX1, y:y0-14, width:rX2-rX1, text:`R\n${this.R_rotor}Ω`, fontSize:7, fill:'#ffa726', align:'center', lineHeight:1.3 }));

        // 电感 L（线圈）
        const lX1=rX2+4, lX2=x1-4;
        this._drawInductorH(lX1, y0, lX2-lX1, 5, '#ffd54f');
        this._staticGroup.add(new Konva.Text({ x:lX1, y:y0-14, width:lX2-lX1, text:`L\n${this.L_rotor}H`, fontSize:7, fill:'#ffd54f', align:'center', lineHeight:1.3 }));

        // 右侧线圈（自整角机转子绕组）
        this._staticGroup.add(new Konva.Line({ points:[x1,y0,x1,y1], stroke:'#37474f', strokeWidth:1 }));
        this._staticGroup.add(new Konva.Rect({ x:x1-16, y:(y0+y1)/2-(y1-y0)*0.30, width:12, height:(y1-y0)*0.60, fill:'#1a1000', stroke:'#c87832', strokeWidth:1, cornerRadius:2 }));
        this._staticGroup.add(new Konva.Text({ x:x1-22, y:(y0+y1)/2-8, text:'励磁\n绕组', fontSize:6.5, fill:'#c87832', lineHeight:1.3 }));

        // 动态显示（励磁电压/电流）
        this._excVLabel = new Konva.Text({ x:ex+6, y:ey+eh-28, text:`U_R=0V`, fontSize:7.5, fill:'#ef9a9a', fontFamily:'Courier New, monospace' });
        this._excILabel = new Konva.Text({ x:ex+6, y:ey+eh-16, text:`I_R=0A`, fontSize:7.5, fill:'#ffd54f', fontFamily:'Courier New, monospace' });
        this._excCosPhi = new Konva.Text({ x:ex+ew/2, y:ey+eh-28, width:ew/2-8, text:`cosφ=${this.cosPhi_r.toFixed(3)}`, fontSize:7, fill:'#80cbc4', align:'right' });
        this._staticGroup.add(this._excVLabel, this._excILabel, this._excCosPhi);
    }

    // 电阻符号（水平锯齿）
    _drawResistorH(x, y, len, h, color) {
        const n = 6, seg = len/n;
        const pts = [x, y];
        for (let i = 0; i < n; i++) {
            pts.push(x+seg*(i+0.25), y-h/2);
            pts.push(x+seg*(i+0.75), y+h/2);
        }
        pts.push(x+len, y);
        this._staticGroup.add(new Konva.Line({ points:pts, stroke:color, strokeWidth:1.5, lineJoin:'round' }));
    }

    // 电感符号（水平线圈弧）
    _drawInductorH(x, y, len, r, color) {
        const n = 4, seg = len/n;
        const pts = [];
        for (let i = 0; i < n; i++) {
            const cx2 = x + seg*(i+0.5);
            for (let a = Math.PI; a >= 0; a -= 0.15) pts.push(cx2+r*Math.cos(a), y-r*Math.sin(a));
        }
        this._staticGroup.add(new Konva.Line({ points:pts, stroke:color, strokeWidth:1.5, lineJoin:'round' }));
        this._staticGroup.add(new Konva.Line({ points:[x,y,x+2,y], stroke:color, strokeWidth:1.5 }));
        this._staticGroup.add(new Konva.Line({ points:[x+len-2,y,x+len,y], stroke:color, strokeWidth:1.5 }));
    }

    // ── 角度-幅值特性曲线 ───────────────────
    _drawAmplitudeCurve() {
        const { _ampX: ax, _ampY: ay, _ampW: aw, _ampH: ah } = this;

        this._staticGroup.add(new Konva.Rect({ x:ax, y:ay, width:aw, height:ah, fill:'#010d18', stroke:'#1a3040', strokeWidth:1.5, cornerRadius:4 }));
        this._staticGroup.add(new Konva.Rect({ x:ax, y:ay, width:aw, height:13, fill:'#0a1a28', cornerRadius:[4,4,0,0] }));
        this._staticGroup.add(new Konva.Text({ x:ax+4, y:ay+2, width:aw-8, text:'角度-幅值特性（E_Si vs θ）', fontSize:8, fontStyle:'bold', fill:'#80cbc4', align:'center' }));

        const ox=ax+14, oy=ay+ah-12, aw2=aw-20, ah2=ah-26;
        // 坐标轴
        this._staticGroup.add(new Konva.Line({ points:[ox,oy-ah2,ox,oy,ox+aw2,oy], stroke:'#37474f', strokeWidth:0.8 }));
        this._staticGroup.add(new Konva.Text({ x:ox-13, y:oy-ah2, text:'E(V)', fontSize:7, fill:'#80cbc4' }));
        this._staticGroup.add(new Konva.Text({ x:ox+aw2+2, y:oy+2, text:'θ(°)', fontSize:7, fill:'#80cbc4' }));

        // 0°/90°/180°/270°/360° 刻度
        [0,90,180,270,360].forEach(deg => {
            const x2=ox+(deg/360)*aw2;
            this._staticGroup.add(new Konva.Line({ points:[x2,oy,x2,oy+3], stroke:'#37474f', strokeWidth:0.7 }));
            this._staticGroup.add(new Konva.Text({ x:x2-8, y:oy+4, text:`${deg}°`, fontSize:6, fill:'#37474f', width:16, align:'center' }));
        });

        // 三相幅值曲线（cos/cos(θ-120°)/cos(θ+120°)）
        const Emax = this.voltageRatio * this.ratedVoltage / Math.sqrt(2);
        const cols = ['#e53935','#43a047','#1e88e5'];
        const offsets = [0, -2*Math.PI/3, 2*Math.PI/3]; // S1/S2/S3 轴偏移
        const zero_line = oy - (0/Emax)*(ah2-4);
        this._staticGroup.add(new Konva.Line({ points:[ox,zero_line,ox+aw2,zero_line], stroke:'#37474f', strokeWidth:0.5, dash:[3,3] }));

        offsets.forEach((off, i) => {
            const pts = [];
            for (let d = 0; d <= 360; d += 2) {
                const theta = d * Math.PI / 180;
                const E = Emax * Math.cos(theta + off);
                const x2 = ox + (d/360)*aw2;
                const y2 = oy - (E/Emax)*(ah2/2-2);
                pts.push(x2, y2);
            }
            this._staticGroup.add(new Konva.Line({ points:pts, stroke:cols[i], strokeWidth:1.5, lineJoin:'round', opacity:0.7 }));
        });

        // 零位线
        this._staticGroup.add(new Konva.Line({ points:[ox,oy-ah2/2,ox+aw2,oy-ah2/2], stroke:'#37474f', strokeWidth:0.5, dash:[2,4] }));
        this._staticGroup.add(new Konva.Text({ x:ox+2, y:oy-ah2/2-8, text:'0', fontSize:6.5, fill:'#546e7a' }));

        // 图例
        [['S1','#e53935'],['S2','#43a047'],['S3','#1e88e5']].forEach(([l,c],i) => {
            this._staticGroup.add(new Konva.Line({ points:[ax+6, ay+14+i*9+3, ax+16, ay+14+i*9+3], stroke:c, strokeWidth:1.8 }));
            this._staticGroup.add(new Konva.Text({ x:ax+18, y:ay+14+i*9-1, text:l, fontSize:7, fill:c }));
        });

        // 动态工作点（三相各一个点）
        this._ampPoints = cols.map((c, i) => {
            const pt = new Konva.Circle({ x:ox, y:oy, radius:5, fill:c, stroke:'rgba(0,0,0,0.5)', strokeWidth:1 });
            this._staticGroup.add(pt);
            return pt;
        });
        this._ampOX=ox; this._ampOY=oy; this._ampAW=aw2; this._ampAH=ah2;
        this._ampEmax=Emax; this._ampOffsets=offsets;
    }

    // ── 极坐标显示 ───────────────────────────
    _drawPolarDisplay() {
        const { _polX: px, _polY: py, _polW: pw, _polH: ph } = this;

        this._staticGroup.add(new Konva.Rect({ x:px, y:py, width:pw, height:ph, fill:'#010d18', stroke:'#1a3040', strokeWidth:1.5, cornerRadius:4 }));
        this._staticGroup.add(new Konva.Rect({ x:px, y:py, width:pw, height:13, fill:'#0a1a28', cornerRadius:[4,4,0,0] }));
        this._staticGroup.add(new Konva.Text({ x:px+4, y:py+2, width:pw-8, text:'极坐标（角度编码可视化）', fontSize:8, fontStyle:'bold', fill:'#80cbc4', align:'center' }));

        const ocx=px+pw*0.50, ocy=py+ph*0.60;
        const R  =Math.min(pw,ph)*0.33;

        // 极坐标网格
        [0.25,0.5,0.75,1.0].forEach(r => {
            this._staticGroup.add(new Konva.Circle({ x:ocx, y:ocy, radius:R*r, fill:'rgba(0,0,0,0)', stroke:'#1a3040', strokeWidth:0.6 }));
        });
        for (let i = 0; i < 12; i++) {
            const a = (i/12)*Math.PI*2;
            this._staticGroup.add(new Konva.Line({ points:[ocx,ocy,ocx+R*Math.cos(a),ocy+R*Math.sin(a)], stroke:'#1a3040', strokeWidth:0.5 }));
        }
        // 角度标注
        [0,90,180,270].forEach(d => {
            const a = (d-90)*Math.PI/180;
            this._staticGroup.add(new Konva.Text({ x:ocx+(R+6)*Math.cos(a)-6, y:ocy+(R+6)*Math.sin(a)-6, text:`${d}°`, fontSize:6.5, fill:'#37474f' }));
        });
        this._staticGroup.add(new Konva.Text({ x:ocx-8, y:py+ph-14, text:'θ 编码方向（顺时针）', fontSize:7, fill:'#546e7a' }));

        // 动态合成矢量
        this._polVector = new Konva.Arrow({ points:[ocx,ocy,ocx+R,ocy], stroke:'#ffd54f', fill:'#ffd54f', strokeWidth:2.5, pointerLength:7, pointerWidth:6 });
        // 解码角度指针（虚线）
        this._polDecoded= new Konva.Line({ points:[ocx,ocy,ocx+R,ocy], stroke:'#66bb6a', strokeWidth:1.5, dash:[4,3], opacity:0.8 });
        // 当前角度文字
        this._polAngleText = new Konva.Text({ x:px+6, y:py+14, text:'θ=0.0°', fontSize:9, fontStyle:'bold', fill:'#ffd54f' });
        this._polDecodedText = new Konva.Text({ x:px+6, y:py+26, text:'解码=0.0°', fontSize:8, fill:'#66bb6a' });

        this._staticGroup.add(this._polDecoded, this._polVector, this._polAngleText, this._polDecodedText);
        this._polOCX=ocx; this._polOCY=ocy; this._polR=R;
    }

    // ── 相量图（三相定子电压）──────────────
    _drawPhasorDiagram() {
        const { _phX: px, _phY: py, _phW: pw, _phH: ph } = this;

        this._staticGroup.add(new Konva.Rect({ x:px, y:py, width:pw, height:ph, fill:'#010d18', stroke:'#1a3040', strokeWidth:1.5, cornerRadius:4 }));
        this._staticGroup.add(new Konva.Rect({ x:px, y:py, width:pw, height:13, fill:'#0a1a28', cornerRadius:[4,4,0,0] }));
        this._staticGroup.add(new Konva.Text({ x:px+4, y:py+2, width:pw-8, text:'三相电压相量图', fontSize:8, fontStyle:'bold', fill:'#80cbc4', align:'center' }));

        const ocx=px+pw*0.50, ocy=py+ph*0.58;
        const R  =Math.min(pw,ph)*0.30;

        // 坐标轴
        this._staticGroup.add(new Konva.Line({ points:[px+6,ocy,px+pw-6,ocy], stroke:'#1a3040', strokeWidth:0.7 }));
        this._staticGroup.add(new Konva.Line({ points:[ocx,py+14,ocx,py+ph-6], stroke:'#1a3040', strokeWidth:0.7 }));

        // 定子轴方向（S1/S2/S3，静止标注）
        const axes=[Math.PI/2, Math.PI/2+2*Math.PI/3, Math.PI/2+4*Math.PI/3];
        const acols=['#e53935','#43a047','#1e88e5'];
        axes.forEach((a,i) => {
            this._staticGroup.add(new Konva.Line({
                points:[ocx,ocy, ocx+R*Math.cos(-a+Math.PI/2)*0.95, ocy-R*Math.sin(-a+Math.PI/2)*0.95],
                stroke:acols[i], strokeWidth:0.6, dash:[3,3], opacity:0.3,
            }));
        });

        // 励磁磁通相量（参考方向，随转子角旋转）
        this._phaPhi = new Konva.Arrow({ points:[ocx,ocy,ocx+R*0.55,ocy], stroke:'#ffa726',fill:'#ffa726',strokeWidth:1.8,pointerLength:5,pointerWidth:4 });

        // 三相电压相量
        this._phaS1 = new Konva.Arrow({ points:[ocx,ocy,ocx+R,ocy],     stroke:'#e53935',fill:'#e53935',strokeWidth:2,pointerLength:6,pointerWidth:5 });
        this._phaS2 = new Konva.Arrow({ points:[ocx,ocy,ocx,ocy-R],     stroke:'#43a047',fill:'#43a047',strokeWidth:2,pointerLength:6,pointerWidth:5 });
        this._phaS3 = new Konva.Arrow({ points:[ocx,ocy,ocx-R,ocy],     stroke:'#1e88e5',fill:'#1e88e5',strokeWidth:2,pointerLength:6,pointerWidth:5 });

        // 图例
        const lgX=px+6, lgY=py+14;
        [['#ffa726','Φ（励磁磁通）'],['#e53935','E_S1'],['#43a047','E_S2'],['#1e88e5','E_S3']].forEach(([col,lbl],i) => {
            this._staticGroup.add(new Konva.Line({ points:[lgX,lgY+i*9+3,lgX+10,lgY+i*9+3], stroke:col, strokeWidth:1.8 }));
            this._staticGroup.add(new Konva.Text({ x:lgX+12, y:lgY+i*9-1, text:lbl, fontSize:7, fill:col }));
        });

        this._phOCX=ocx; this._phOCY=ocy; this._phR=R;
        this._staticGroup.add(this._phaPhi, this._phaS1, this._phaS2, this._phaS3);
    }

    // ── Scott-T 变换可视化 ───────────────────
    _drawScottT() {
        const { _scX: sx, _scY: sy, _scW: sw, _scH: sh } = this;

        this._staticGroup.add(new Konva.Rect({ x:sx, y:sy, width:sw, height:sh, fill:'#010d18', stroke:'#1a3040', strokeWidth:1.5, cornerRadius:4 }));
        this._staticGroup.add(new Konva.Rect({ x:sx, y:sy, width:sw, height:13, fill:'#0a1a28', cornerRadius:[4,4,0,0] }));
        this._staticGroup.add(new Konva.Text({ x:sx+4, y:sy+2, width:sw-8, text:'Scott-T 变换（三相→正交双相）', fontSize:8, fontStyle:'bold', fill:'#80cbc4', align:'center' }));

        const ocx=sx+sw*0.50, ocy=sy+sh*0.58;
        const R  =Math.min(sw,sh)*0.28;

        // α-β 坐标轴（正交）
        this._staticGroup.add(new Konva.Line({ points:[sx+6,ocy,sx+sw-6,ocy], stroke:'#37474f', strokeWidth:0.8 }));
        this._staticGroup.add(new Konva.Line({ points:[ocx,sy+14,ocx,sy+sh-6], stroke:'#37474f', strokeWidth:0.8 }));
        this._staticGroup.add(new Konva.Text({ x:sx+sw-14, y:ocy+3, text:'α', fontSize:8, fill:'#ef9a9a' }));
        this._staticGroup.add(new Konva.Text({ x:ocx+3, y:sy+14, text:'β', fontSize:8, fill:'#90caf9' }));

        // 单位圆
        this._staticGroup.add(new Konva.Circle({ x:ocx, y:ocy, radius:R, fill:'rgba(0,0,0,0)', stroke:'#1a3040', strokeWidth:0.6, dash:[3,3] }));

        // 动态双相矢量
        this._scAlpha = new Konva.Arrow({ points:[ocx,ocy,ocx+R,ocy],  stroke:'#ef9a9a',fill:'#ef9a9a',strokeWidth:2,pointerLength:6,pointerWidth:5 });
        this._scBeta  = new Konva.Arrow({ points:[ocx,ocy,ocx,ocy-R],  stroke:'#90caf9',fill:'#90caf9',strokeWidth:2,pointerLength:6,pointerWidth:5 });
        this._scIs    = new Konva.Arrow({ points:[ocx,ocy,ocx+R,ocy-R],stroke:'#ffd54f',fill:'#ffd54f',strokeWidth:2.5,pointerLength:7,pointerWidth:6 });
        // 投影辅助线
        this._scAlphaProj = new Konva.Line({ points:[], stroke:'#ef9a9a', strokeWidth:0.8, dash:[2,3], opacity:0.5 });
        this._scBetaProj  = new Konva.Line({ points:[], stroke:'#90caf9', strokeWidth:0.8, dash:[2,3], opacity:0.5 });

        // 变换公式标注
        this._staticGroup.add(new Konva.Text({ x:sx+4, y:sy+sh-30, text:'α = K·sin(θ)·U_m·sin(ωt)', fontSize:7, fill:'#ef9a9a' }));
        this._staticGroup.add(new Konva.Text({ x:sx+4, y:sy+sh-20, text:'β = K·cos(θ)·U_m·sin(ωt)', fontSize:7, fill:'#90caf9' }));

        // 图例
        const lgX=sx+6, lgY=sy+14;
        [['#ef9a9a','e_α（sin分量）'],['#90caf9','e_β（cos分量）'],['#ffd54f','合成矢量']].forEach(([col,lbl],i) => {
            this._staticGroup.add(new Konva.Line({ points:[lgX,lgY+i*9+3,lgX+10,lgY+i*9+3], stroke:col, strokeWidth:1.8 }));
            this._staticGroup.add(new Konva.Text({ x:lgX+12, y:lgY+i*9-1, text:lbl, fontSize:7, fill:col }));
        });

        this._scOCX=ocx; this._scOCY=ocy; this._scR=R;
        this._staticGroup.add(this._scAlphaProj, this._scBetaProj, this._scAlpha, this._scBeta, this._scIs);
    }

    // ── 误差信号分析 ────────────────────────
    _drawErrorAnalysis() {
        const { _errX: ex, _errY: ey, _errW: ew, _errH: eh } = this;

        this._staticGroup.add(new Konva.Rect({ x:ex, y:ey, width:ew, height:eh, fill:'#010d18', stroke:'#1a3040', strokeWidth:1.5, cornerRadius:4 }));
        this._staticGroup.add(new Konva.Rect({ x:ex, y:ey, width:ew, height:13, fill:'#0a1a28', cornerRadius:[4,4,0,0] }));
        this._staticGroup.add(new Konva.Text({ x:ex+4, y:ey+2, width:ew-8, text:'误差信号（CX→CT 随动系统）', fontSize:8, fontStyle:'bold', fill:'#80cbc4', align:'center' }));

        // 误差电压波形区
        const ox=ex+12, oy=ey+eh*0.55, aw=ew-18, ah=eh*0.30;
        this._staticGroup.add(new Konva.Line({ points:[ox,oy-ah,ox,oy+ah*0.3,ox+aw,oy+ah*0.3], stroke:'#37474f', strokeWidth:0.8 }));
        this._staticGroup.add(new Konva.Text({ x:ox-12, y:oy-ah, text:'e', fontSize:7, fill:'#80cbc4' }));
        this._staticGroup.add(new Konva.Text({ x:ox+aw+2, y:oy+ah*0.3+2, text:'t', fontSize:7, fill:'#80cbc4' }));

        this._errWaveLine = new Konva.Line({ points:[], stroke:'#ef5350', strokeWidth:1.8, lineJoin:'round' });
        this._staticGroup.add(this._errWaveLine);
        this._errOX=ox; this._errOY=oy+ah*0.3; this._errAW=aw; this._errAH=ah;

        // 误差角度 + 线性近似说明
        this._errAngleText= new Konva.Text({ x:ex+6, y:ey+14, text:'Δθ=θ_TX-θ_RX=0°', fontSize:8, fontStyle:'bold', fill:'#ef5350' });
        this._errAmplText = new Konva.Text({ x:ex+6, y:ey+26, text:'|e_err|=0.00V', fontSize:8, fill:'#ffa726', fontFamily:'Courier New, monospace' });
        this._errLinearText=new Konva.Text({ x:ex+6, y:ey+eh-28,  text:'线性区（|Δθ|<30°）：e≈K·U_m·Δθ', fontSize:7, fill:'#80cbc4' });
        this._errRxLabel   =new Konva.Text({ x:ex+6, y:ey+eh-16, text:`θ_RX=${this._rxAngle.toFixed(1)}°（模拟接收机）`, fontSize:7, fill:'#90caf9' });
        this._staticGroup.add(this._errAngleText, this._errAmplText, this._errLinearText, this._errRxLabel);
    }

    // ── LCD 仪表 ─────────────────────────────
    _drawLCDPanel() {
        const { _lcdX: lx, _lcdY: ly, _lcdW: lw, _lcdH: lh } = this;

        this._staticGroup.add(new Konva.Rect({x:lx,y:ly,width:lw,height:lh,fill:'#020c14',stroke:'#1a3040',strokeWidth:1.5,cornerRadius:4}));
        this._staticGroup.add(new Konva.Rect({x:lx,y:ly,width:lw,height:13,fill:'#0a1a28',cornerRadius:[4,4,0,0]}));
        this._staticGroup.add(new Konva.Text({x:lx+4,y:ly+2,width:lw-8,text:'运行仪表',fontSize:8,fontStyle:'bold',fill:'#80cbc4',align:'center'}));

        const cells=[
            {label:'转子角 θ',   id:'theta',   unit:'°',   color:'#ffd54f'},
            {label:'励磁电压',   id:'ur',      unit:'V',   color:'#ef9a9a'},
            {label:'励磁电流',   id:'ir',      unit:'A',   color:'#ffa726'},
            {label:'E_S1',       id:'es1',     unit:'V',   color:'#e53935'},
            {label:'E_S2',       id:'es2',     unit:'V',   color:'#43a047'},
            {label:'E_S3',       id:'es3',     unit:'V',   color:'#1e88e5'},
            {label:'e_α',        id:'ealpha',  unit:'V',   color:'#ef9a9a'},
            {label:'e_β',        id:'ebeta',   unit:'V',   color:'#90caf9'},
            {label:'解码角度',   id:'decoded', unit:'°',   color:'#66bb6a'},
            {label:'误差 Δθ',   id:'derr',    unit:'°',   color:'#ef5350'},
            {label:'误差电压',   id:'eerr',    unit:'V',   color:'#ffa726'},
            {label:'频率',       id:'freq',    unit:'Hz',  color:'#80cbc4'},
        ];

        const cellW=(lw-8)/3, cellH=22, gap=2;
        this._lcdCells={};
        cells.forEach(({label,id,unit,color},i) => {
            const col=i%3, row=Math.floor(i/3);
            const cx3=lx+4+col*(cellW+gap), cy3=ly+16+row*(cellH+gap);
            this._staticGroup.add(new Konva.Rect({x:cx3,y:cy3,width:cellW,height:cellH,fill:'#0d1520',cornerRadius:2}));
            this._staticGroup.add(new Konva.Text({x:cx3+2,y:cy3+2,text:label,fontSize:6.5,fill:'#37474f'}));
            const val=new Konva.Text({x:cx3+2,y:cy3+9,width:cellW-4,text:'--',fontSize:9,fontFamily:'Courier New, monospace',fontStyle:'bold',fill:color,align:'right'});
            this._staticGroup.add(new Konva.Text({x:cx3+2,y:cy3+14,width:cellW-4,text:unit,fontSize:6,fill:'#1a252f',align:'right'}));
            this._lcdCells[id]=val;
            this._staticGroup.add(val);
        });
    }

    // ── 控制面板 ─────────────────────────────
    _drawControlPanel() {
        const { _panX: px, _panY: py, _panW: pw, _panH: ph } = this;

        this._staticGroup.add(new Konva.Rect({x:px,y:py,width:pw,height:ph,fill:'#0d1520',stroke:'#1a3040',strokeWidth:1.5,cornerRadius:4}));
        this._staticGroup.add(new Konva.Rect({x:px,y:py,width:pw,height:13,fill:'#0a1a28',cornerRadius:[4,4,0,0]}));
        this._staticGroup.add(new Konva.Text({x:px+4,y:py+2,width:pw-8,text:'参数控制',fontSize:8,fontStyle:'bold',fill:'#80cbc4',align:'center'}));

        // 按钮行
        const bW=(pw-16)/4, bH=18, bY=py+16;
        [['↺ 自动旋转','#1a3a1a','#2e7d32','#66bb6a',()=>this.toggleAutoRotate()],
         ['◉ 复位零位', '#1a1a0a','#f57f17','#ffd54f',()=>this.resetAngle()],
        ].forEach(([lbl,fill,stroke,col,cb],i) => {
            const bx=px+4+i*(bW+4);
            const btn=new Konva.Rect({x:bx,y:bY,width:bW,height:bH,fill,stroke,strokeWidth:1.5,cornerRadius:3});
            const t=new Konva.Text({x:bx,y:bY+4,width:bW,text:lbl,fontSize:9,fontStyle:'bold',fill:col,align:'center'});
            btn.on('click tap',cb);
            btn.on('mouseenter',()=>btn.opacity(0.75));
            btn.on('mouseleave',()=>btn.opacity(1));
            this._interactGroup.add(btn,t);
        });

        // 频率选择按钮
        const freqs=[50,60,400];
        const fBW=40, fBY=bY;
        const fLX=px+4+2*(bW+4)+8;
        this._staticGroup.add(new Konva.Text({x:fLX,y:fBY-2,text:'频率:',fontSize:7.5,fill:'#546e7a'}));
        this._freqBtns={};
        freqs.forEach((f,i) => {
            const bx=fLX+36+i*46;
            const active=this._freqSet===f;
            const btn=new Konva.Rect({x:bx,y:fBY,width:42,height:bH,fill:active?'#1a1a0a':'#0d1520',stroke:active?'#ffa726':'#1a3040',strokeWidth:1.5,cornerRadius:3});
            const t=new Konva.Text({x:bx,y:fBY+4,width:42,text:`${f}Hz`,fontSize:9,fill:active?'#ffa726':'#37474f',align:'center'});
            btn.on('click tap',()=>this.setFrequency(f));
            this._freqBtns[f]={btn,t};
            this._interactGroup.add(btn,t);
        });

        // 滑块
        const sliders=[
            {label:`转子角度 θ（0°~360°）`,      key:'theta',  color:'#ffd54f',
             getR:()=>this._rotorAngle/360,
             set:r=>{this._rotorAngle=r*360; this._rotorAngleRad=this._rotorAngle*Math.PI/180;},
             disp:()=>`${this._rotorAngle.toFixed(1)}°`},
            {label:`励磁电压（额定 ${this.ratedVoltage}V）`, key:'excit', color:'#ef9a9a',
             getR:()=>this._excitVoltSet/this.ratedVoltage,
             set:r=>{this._excitVoltSet=r*this.ratedVoltage;},
             disp:()=>`${this._excitVoltSet.toFixed(0)}V`},
            {label:`接收机模拟角度 θ_RX`,          key:'rxang',  color:'#90caf9',
             getR:()=>this._rxAngle/360,
             set:r=>{this._rxAngle=r*360; this._rxAngleRad=this._rxAngle*Math.PI/180;},
             disp:()=>`${this._rxAngle.toFixed(1)}°`},
        ];

        const slW=(pw-16)/2-32;
        this._sliderBars={};
        sliders.forEach(({label,key,color,getR,set,disp},si) => {
            const col=si%2===0?0:1, row=Math.floor(si/2);
            const slX=px+4+col*(slW+50), slY=py+42+row*26;
            this._staticGroup.add(new Konva.Text({x:slX,y:slY-11,text:label,fontSize:7,fill:'#546e7a'}));
            this._staticGroup.add(new Konva.Rect({x:slX,y:slY,width:slW,height:8,fill:'#0a0a18',cornerRadius:2}));
            const bar=new Konva.Rect({x:slX,y:slY,width:0,height:8,fill:color,cornerRadius:2});
            const txt=new Konva.Text({x:slX+slW+4,y:slY-2,width:44,text:'--',fontSize:8,fontFamily:'Courier New, monospace',fill:color});
            const hit=new Konva.Rect({x:slX,y:slY-2,width:slW,height:12,fill:'transparent'});
            hit.on('click tap mousedown',e => {
                const stage=this.group.getStage?.();
                const pos=stage?.getPointerPosition?.()??{x:e.evt?.clientX??0};
                set(Math.max(0,Math.min(1,(pos.x-(this.group.x?.()??0)-slX)/slW)));
            });
            this._interactGroup.add(bar,txt,hit);
            this._sliderBars[key]={bar,txt,slW,getR,disp};
        });
    }

    // ── 波形区 ─────────────────────────────
    _drawWaveform() {
        const { _wavX: wx, _wavY: wy, _wavW: ww, _wavH: wh } = this;
        if (wh<14) return;

        this._staticGroup.add(new Konva.Rect({x:wx,y:wy,width:ww,height:wh,fill:'#010d18',stroke:'#1a3040',strokeWidth:1.5,cornerRadius:4}));
        this._staticGroup.add(new Konva.Rect({x:wx,y:wy,width:ww,height:12,fill:'#0a1a28',cornerRadius:[4,4,0,0]}));
        this._staticGroup.add(new Konva.Text({x:wx+4,y:wy+1,width:ww-8,text:'励磁 U_R   定子 e_S1/e_S2/e_S3（调幅波，幅值携带角度）   误差信号 e_error',fontSize:8,fill:'#80cbc4',align:'center'}));

        const nCh=4, hCh=(wh-12)/nCh;
        this._wavMids=Array.from({length:nCh},(_,i)=>wy+12+hCh*(i+0.5));
        this._wavMids.forEach(my=>this._staticGroup.add(new Konva.Line({points:[wx+2,my,wx+ww-2,my],stroke:'rgba(200,200,200,0.06)',strokeWidth:0.5,dash:[4,3]})));

        this._wLUR  =new Konva.Line({points:[],stroke:'#ffa726',strokeWidth:1.5,lineJoin:'round'});
        this._wLES1 =new Konva.Line({points:[],stroke:'#e53935',strokeWidth:1.5,lineJoin:'round'});
        this._wLES2 =new Konva.Line({points:[],stroke:'#43a047',strokeWidth:1.5,lineJoin:'round'});
        this._wLES3 =new Konva.Line({points:[],stroke:'#1e88e5',strokeWidth:1.5,lineJoin:'round'});
        this._wLErr =new Konva.Line({points:[],stroke:'#ef5350',strokeWidth:1.8,lineJoin:'round'});

        ['U_R','e_S1/S2/S3','（S1红/S2绿/S3蓝）','e_error'].forEach((l,i)=>{
            this._staticGroup.add(new Konva.Text({x:wx+4,y:wy+12+hCh*i+3,text:l,fontSize:8,fill:['#ffa726','#e53935','#80cbc4','#ef5350'][i]}));
        });
        this._staticGroup.add(this._wLUR, this._wLES1, this._wLES2, this._wLES3, this._wLErr);
        this._wavHCh=hCh;
    }

    // ═══════════════════════════════════════════
    // 集中化 tick（由 consys._tickAll 在 20fps 调用）
    tick(dt) {
        this._tickPhysics(dt);
        this._tickRotorViz();
        this._tickFluxViz(dt);
        this._tickAmplitudePoints();
        this._tickPolarDisplay();
        this._tickPhasorDiagram();
        this._tickScottT();
        this._tickErrorAnalysis();
        this._tickWaveform();
        this._tickDisplay();
        this._refreshCache();
    }

    // ── 物理量计算 ────────────────────────────
    _tickPhysics(dt) {
        const omega = 2*Math.PI*this._freqSet;
        this._wavePhase += omega*dt;
        this._animPhase += dt*3;

        // 自动旋转
        if (this._autoRotate) {
            this._rotorAngle += this._autoOmega * dt * 180/Math.PI;
            this._rotorAngle  = ((this._rotorAngle % 360) + 360) % 360;
            this._rotorAngleRad = this._rotorAngle * Math.PI/180;
        }

        // 励磁电压（单相交流）
        const U_m  = this._excitVoltSet * Math.sqrt(2);
        this.u_R   = U_m * Math.sin(this._wavePhase);
        const phiR = Math.atan2(2*Math.PI*this._freqSet*this.L_rotor, this.R_rotor);
        this.i_R   = (U_m/this.Z_rotor) * Math.sin(this._wavePhase - phiR);

        // 主磁通（与励磁电流同相位的磁通，滞后励磁电压）
        this.phi_m  = Math.sin(this._wavePhase - phiR); // 标幺

        // 三相定子感应电压（调幅波：幅值=cos函数的角度信息 × 载波）
        const theta  = this._rotorAngleRad;
        const K      = this.voltageRatio;
        const ampFactor = Math.sin(this._wavePhase - phiR); // 载波（与磁通同相）

        // 加入电气误差（随机微小偏差）
        const errRad = this.electricalError * Math.PI / (180*60); // arcmin → rad
        const harmonic = this.harmonicDistort * Math.sin(this._wavePhase*3); // 三次谐波

        this.e_S1 = K*U_m * Math.cos(theta)           * ampFactor + this.nullVoltage*Math.sin(this._wavePhase*2) + harmonic*U_m;
        this.e_S2 = K*U_m * Math.cos(theta - 2*Math.PI/3) * ampFactor + this.nullVoltage*Math.sin(this._wavePhase*2 + 1.2) + harmonic*U_m*0.7;
        this.e_S3 = K*U_m * Math.cos(theta + 2*Math.PI/3) * ampFactor + this.nullVoltage*Math.sin(this._wavePhase*2 + 2.4) + harmonic*U_m*0.5;

        // 三相有效值（幅值包络）
        this.E_S1_rms = K * this._excitVoltSet / Math.sqrt(2) * Math.abs(Math.cos(theta));
        this.E_S2_rms = K * this._excitVoltSet / Math.sqrt(2) * Math.abs(Math.cos(theta - 2*Math.PI/3));
        this.E_S3_rms = K * this._excitVoltSet / Math.sqrt(2) * Math.abs(Math.cos(theta + 2*Math.PI/3));

        // Scott-T 变换（三相→正交双相）
        // e_α = (2/3)×e_S1 - (1/3)×e_S2 - (1/3)×e_S3  （或 = e_S1 - (e_S2+e_S3)/2）
        // e_β = (1/√3)×(e_S3 - e_S2)
        this.e_alpha = this.e_S1 - (this.e_S2 + this.e_S3)/2;
        this.e_beta  = (this.e_S3 - this.e_S2) * Math.sqrt(3)/2;

        // 解码角度（arctan2 解码）
        // 包络近似：alpha_rms ∝ sin(θ)，beta_rms ∝ cos(θ)
        const alphaEnv = K * this._excitVoltSet / Math.sqrt(2) * Math.sin(theta);
        const betaEnv  = K * this._excitVoltSet / Math.sqrt(2) * Math.cos(theta);
        this.decodedAngle = Math.atan2(alphaEnv, betaEnv) * 180/Math.PI;
        if (this.decodedAngle < 0) this.decodedAngle += 360;

        // 误差信号（与接收机CT配合）
        // e_error = K × U_m × sin(θ_TX - θ_RX) × sin(ωt)
        const deltaTheta = this._rotorAngleRad - this._rxAngleRad;
        this.e_error = K * U_m * Math.sin(deltaTheta) * ampFactor;

        // 波形缓冲
        this._wavUR  = new Float32Array([...this._wavUR.slice(1),  this.u_R]);
        this._wavES1 = new Float32Array([...this._wavES1.slice(1), this.e_S1]);
        this._wavES2 = new Float32Array([...this._wavES2.slice(1), this.e_S2]);
        this._wavES3 = new Float32Array([...this._wavES3.slice(1), this.e_S3]);
        this._wavEerr= new Float32Array([...this._wavEerr.slice(1),this.e_error]);
        this._wavTheta=new Float32Array([...this._wavTheta.slice(1),this._rotorAngle]);
    }

    // ── 转子旋转动画 ─────────────────────────
    _tickRotorViz() {
        const theta = this._rotorAngleRad;
        if (this._rotorCoilGroup) {
            this._rotorCoilGroup.rotation(theta * 180/Math.PI);
        }
        // 转子角度指示线（随转子旋转）
        if (this._rotorAngleLine) {
            const ecx=this._synCX, ecy=this._synCY;
            const R=this._rotorR*0.75;
            this._rotorAngleLine.points([
                ecx, ecy,
                ecx + R*Math.cos(theta - Math.PI/2), // S1 轴从上方开始，需修正
                ecy + R*Math.sin(theta - Math.PI/2),
            ]);
        }
        // 定子绕组亮度（随电流幅值变化）
        this._statorWindings?.forEach(({ dot, dotB, angle }, i) => {
            const eVals = [this.e_S1, this.e_S2, this.e_S3];
            const ePk   = this.voltageRatio * this._excitVoltSet * Math.sqrt(2);
            const alpha = Math.max(0.1, Math.min(0.95, 0.4 + 0.55*Math.abs(eVals[i]) / (ePk+1e-9)));
            dot.opacity(alpha);
            dotB.opacity(alpha*0.4);
        });
    }

    // ── 磁通粒子动画 ─────────────────────────
    _tickFluxViz(dt) {
        this._fluxGroup.destroyChildren();
        const iMag = Math.abs(this.phi_m);
        if (iMag < 0.02) return;

        const ecx=this._synCX, ecy=this._synCY;
        const theta=this._rotorAngleRad;
        const r0=this._rotorR*0.88, r1=this._sInner*0.95;

        // 沿转子磁极方向的磁力线
        const nLines=8;
        for (let i=0;i<nLines;i++) {
            const spread=(i-nLines/2+0.5)/nLines*Math.PI*0.6;
            const a=theta+spread-Math.PI/2;
            const alpha=Math.max(0.04,0.4*(1-Math.abs(spread)*1.8/Math.PI)*iMag);
            const col=spread<0?`rgba(239,154,154,${alpha})`:`rgba(144,202,249,${alpha})`;
            this._fluxGroup.add(new Konva.Line({
                points:[ecx+r0*Math.cos(a),ecy+r0*Math.sin(a),ecx+r1*Math.cos(a),ecy+r1*Math.sin(a)],
                stroke:col, strokeWidth:1.5, lineCap:'round',
            }));
        }

        // 磁通粒子
        const nPart=10;
        for (let i=0;i<nPart;i++) {
            const t=((this._animPhase*0.05+i/nPart)%1+1)%1;
            const r=r0+t*(r1-r0);
            const aOff=(Math.random()-0.5)*0.3;
            this._fluxGroup.add(new Konva.Circle({
                x:ecx+r*Math.cos(theta-Math.PI/2+aOff),
                y:ecy+r*Math.sin(theta-Math.PI/2+aOff),
                radius:2+iMag*2,
                fill:`rgba(255,213,79,${0.25+iMag*0.35})`,
            }));
        }
    }

    // ── 角度-幅值特性工作点 ──────────────────
    _tickAmplitudePoints() {
        if (!this._ampPoints) return;
        const theta  = this._rotorAngleRad;
        const Emax   = this._ampEmax;
        const ox     = this._ampOX, oy=this._ampOY, aw=this._ampAW, ah=this._ampAH;
        const offsets= this._ampOffsets;

        this._ampPoints.forEach((pt, i) => {
            const x = ox + (this._rotorAngle/360)*aw;
            const E = Emax * Math.cos(theta + offsets[i]);
            const y = oy - (E/Emax)*(ah/2-2);
            pt.x(Math.max(ox,Math.min(ox+aw,x)));
            pt.y(Math.max(oy-ah+2,Math.min(oy,y)));
        });
    }

    // ── 极坐标显示更新 ───────────────────────
    _tickPolarDisplay() {
        if (!this._polVector) return;
        const theta  = this._rotorAngleRad;
        const R      = this._polR;
        const ocx    = this._polOCX, ocy=this._polOCY;
        // 合成矢量方向 = 转子角度方向（从零位出发，按编码角度旋转）
        const vecAngle = Math.PI/2 - theta; // 极坐标规定：θ=0 → 正上方（90°方向）
        const vecMag   = R * (this._excitVoltSet/this.ratedVoltage);
        this._polVector.points([ocx,ocy, ocx+vecMag*Math.cos(vecAngle), ocy-vecMag*Math.sin(vecAngle)]);

        // 解码角度指针
        const decRad = this.decodedAngle * Math.PI/180;
        const decAngle = Math.PI/2 - decRad;
        this._polDecoded?.points([ocx,ocy, ocx+R*0.88*Math.cos(decAngle), ocy-R*0.88*Math.sin(decAngle)]);

        this._polAngleText?.text(`θ=${this._rotorAngle.toFixed(1)}°`);
        this._polDecodedText?.text(`解码=${this.decodedAngle.toFixed(1)}°`);
    }

    // ── 相量图更新 ────────────────────────────
    _tickPhasorDiagram() {
        if (!this._phaS1) return;
        const R    = this._phR;
        const ocx  = this._phOCX, ocy=this._phOCY;
        const theta= this._rotorAngleRad;
        const K    = this.voltageRatio;
        const scl  = R / (K*this.ratedVoltage/Math.sqrt(2)+1e-9);

        // 励磁磁通方向（= 转子角度方向）
        const phiAngle = Math.PI/2 - theta;
        const phiR=R*0.55;
        this._phaPhi?.points([ocx,ocy, ocx+phiR*Math.cos(phiAngle), ocy-phiR*Math.sin(phiAngle)]);

        // 三相定子电压相量（幅值 = cos(θ-轴偏角)，方向 = 各轴方向）
        const statorAxes=[Math.PI/2, Math.PI/2+2*Math.PI/3, Math.PI/2+4*Math.PI/3];
        const phas=[this._phaS1,this._phaS2,this._phaS3];
        statorAxes.forEach((a,i) => {
            const E    = this.voltageRatio*this._excitVoltSet/Math.sqrt(2)*Math.cos(theta+[0,-2*Math.PI/3,2*Math.PI/3][i]);
            const Escl = E * scl;
            const ax   = Math.PI/2 - a;
            phas[i].points([ocx,ocy, ocx+Escl*Math.cos(ax), ocy-Escl*Math.sin(ax)]);
        });
    }

    // ── Scott-T 更新 ─────────────────────────
    _tickScottT() {
        if (!this._scAlpha) return;
        const R  = this._scR;
        const ocx= this._scOCX, ocy=this._scOCY;
        const K  = this.voltageRatio;
        const Emax= K*this._excitVoltSet/Math.sqrt(2);
        const scl= R/(Emax+1e-9);
        const theta=this._rotorAngleRad;

        const alphaVal = Emax * Math.sin(theta);
        const betaVal  = Emax * Math.cos(theta);
        const ax=alphaVal*scl, ay=betaVal*scl;

        this._scAlpha?.points([ocx,ocy, ocx+ax, ocy]);
        this._scBeta?.points([ocx,ocy, ocx, ocy-ay]);
        this._scIs?.points([ocx,ocy, ocx+ax, ocy-ay]);
        this._scAlphaProj?.points([ocx+ax,ocy, ocx+ax,ocy-ay]);
        this._scBetaProj?.points([ocx,ocy-ay, ocx+ax,ocy-ay]);
    }

    // ── 误差分析更新 ─────────────────────────
    _tickErrorAnalysis() {
        // 误差波形（最近 N 点）
        if (this._errWaveLine) {
            const n=Math.min(this._wavLen, 80);
            const dx=this._errAW/n;
            const pts=[];
            const ePk=this.voltageRatio*this._excitVoltSet*Math.sqrt(2);
            for (let i=0;i<n;i++) {
                const idx=this._wavLen-n+i;
                const x=this._errOX+i*dx;
                const y=this._errOY-(this._wavEerr[idx]/(ePk+1e-9))*this._errAH*0.85;
                pts.push(x,y);
            }
            this._errWaveLine.points(pts);
        }

        const deltaDeg = (this._rotorAngle - this._rxAngle + 360) % 360;
        const deltaAdj = deltaDeg > 180 ? deltaDeg-360 : deltaDeg;
        const errVpk   = this.voltageRatio*this._excitVoltSet*Math.sqrt(2)*Math.abs(Math.sin(deltaAdj*Math.PI/180));

        this._errAngleText?.text(`Δθ=θ_TX−θ_RX=${deltaAdj.toFixed(1)}°`);
        this._errAngleText?.fill(Math.abs(deltaAdj)>30?'#ffa726':Math.abs(deltaAdj)>5?'#ef9a9a':'#66bb6a');
        this._errAmplText?.text(`|e_err|=${errVpk.toFixed(2)}V`);
        this._errRxLabel?.text(`θ_RX=${this._rxAngle.toFixed(1)}°（模拟接收机）`);
    }

    // ── 波形更新 ─────────────────────────────
    _tickWaveform() {
        if (!this._wavHCh||!this._wavMids) return;
        const wx=this._wavX+3, ww=this._wavW-6, n=this._wavLen;
        const dx=ww/n, hCh=this._wavHCh;
        const [mUR,mES,_,mErr]=this._wavMids;

        const uPk  = this._excitVoltSet*Math.sqrt(2);
        const ePk  = this.voltageRatio*this._excitVoltSet*Math.sqrt(2);
        const errPk= ePk;

        const ptUR=[], ptS1=[], ptS2=[], ptS3=[], ptErr=[];
        for (let i=0;i<n;i++) {
            const x=wx+i*dx;
            ptUR.push(x, mUR-(this._wavUR[i]/uPk)*hCh*0.38);
            ptS1.push(x, mES-(this._wavES1[i]/ePk)*hCh*0.38);
            ptS2.push(x, mES-(this._wavES2[i]/ePk)*hCh*0.38);
            ptS3.push(x, mES-(this._wavES3[i]/ePk)*hCh*0.38);
            ptErr.push(x, this._wavMids[3]-(this._wavEerr[i]/(errPk+1e-9))*hCh*0.38);
        }
        this._wLUR.points(ptUR);
        this._wLES1.points(ptS1); this._wLES2.points(ptS2); this._wLES3.points(ptS3);
        this._wLErr.points(ptErr);
    }

    // ── 仪表更新 ─────────────────────────────
    _tickDisplay() {
        const c=this._lcdCells;
        if (!c) return;

        const U_rms  = this._excitVoltSet;
        const I_rms  = U_rms / this.Z_rotor;
        const deltaDeg=(this._rotorAngle-this._rxAngle+360)%360;
        const deltaAdj=deltaDeg>180?deltaDeg-360:deltaDeg;
        const errVpk = this.voltageRatio*U_rms*Math.sqrt(2)*Math.abs(Math.sin(deltaAdj*Math.PI/180));

        if (c.theta)   c.theta.text(this._rotorAngle.toFixed(2));
        if (c.ur)      c.ur.text(U_rms.toFixed(1));
        if (c.ir)      c.ir.text(I_rms.toFixed(4));
        if (c.es1)   { c.es1.text(this.E_S1_rms.toFixed(3));
                       c.es1.fill(Math.abs(Math.cos(this._rotorAngleRad))<0.05?'#546e7a':'#e53935'); }
        if (c.es2)     c.es2.text(this.E_S2_rms.toFixed(3));
        if (c.es3)     c.es3.text(this.E_S3_rms.toFixed(3));
        if (c.ealpha)  c.ealpha.text((this.voltageRatio*U_rms/Math.sqrt(2)*Math.sin(this._rotorAngleRad)).toFixed(3));
        if (c.ebeta)   c.ebeta.text((this.voltageRatio*U_rms/Math.sqrt(2)*Math.cos(this._rotorAngleRad)).toFixed(3));
        if (c.decoded) c.decoded.text(this.decodedAngle.toFixed(2));
        if (c.derr)  { c.derr.text(deltaAdj.toFixed(2));
                       c.derr.fill(Math.abs(deltaAdj)>30?'#ffa726':Math.abs(deltaAdj)>5?'#ef9a9a':'#66bb6a'); }
        if (c.eerr)    c.eerr.text(errVpk.toFixed(3));
        if (c.freq)    c.freq.text(this._freqSet.toString());

        // 励磁回路标注
        if (this._excVLabel) this._excVLabel.text(`U_R=${U_rms.toFixed(0)}V`);
        if (this._excILabel) this._excILabel.text(`I_R=${I_rms.toFixed(4)}A`);

        if (this._sliderBars) {
            Object.values(this._sliderBars).forEach(({bar,txt,slW,getR,disp})=>{
                bar.width(Math.min(slW,Math.max(0,getR())*slW));
                txt.text(disp());
            });
        }
    }

    // ═══════════════════════════════════════════
    setAngle(deg) {
        this._rotorAngle    = ((deg % 360) + 360) % 360;
        this._rotorAngleRad = this._rotorAngle * Math.PI/180;
        this._refreshCache();
    }

    setRxAngle(deg) {
        this._rxAngle    = ((deg % 360) + 360) % 360;
        this._rxAngleRad = this._rxAngle * Math.PI/180;
        this._refreshCache();
    }

    setExcitVoltage(v) {
        this._excitVoltSet = Math.max(0, Math.min(this.ratedVoltage*1.2, v));
        this._refreshCache();
    }

    setFrequency(f) {
        this._freqSet = f;
        this.Z_rotor  = Math.sqrt(this.R_rotor**2+(2*Math.PI*f*this.L_rotor)**2);
        this.cosPhi_r = this.R_rotor/this.Z_rotor;
        // 更新频率按钮样式
        Object.entries(this._freqBtns||{}).forEach(([freq,{btn,t}])=>{
            const on=parseInt(freq)===f;
            btn.fill(on?'#1a1a0a':'#0d1520');
            btn.stroke(on?'#ffa726':'#1a3040');
            t.fill(on?'#ffa726':'#37474f');
        });
        this._refreshCache();
    }

    toggleAutoRotate() {
        this._autoRotate = !this._autoRotate;
        this._refreshCache();
    }

    resetAngle() {
        this.setAngle(0);
    }

    getAngle()        { return this._rotorAngle; }
    getDecodedAngle() { return this.decodedAngle; }
    getErrorAngle()   { return this._rotorAngle - this._rxAngle; }
    getS1Voltage()    { return this.E_S1_rms; }
    getS2Voltage()    { return this.E_S2_rms; }
    getS3Voltage()    { return this.E_S3_rms; }

    update(cfg={}) {
        if (cfg.angle !== undefined) this.setAngle(cfg.angle);
        if (cfg.rxAngle!==undefined) this.setRxAngle(cfg.rxAngle);
        if (cfg.excit !== undefined) this.setExcitVoltage(cfg.excit);
        if (cfg.freq  !== undefined) this.setFrequency(cfg.freq);
        this._refreshCache();
    }

    getConfigFields() {
        return [
            {label:'位号/名称',           key:'id',             type:'text'},
            {label:'励磁额定电压 (V)',    key:'ratedVoltage',   type:'number'},
            {label:'额定频率 (Hz)',       key:'ratedFreq',      type:'number'},
            {label:'额定输出电压 (V)',    key:'outputVoltage',  type:'number'},
            {label:'转子绕组电阻 (Ω)',   key:'R_rotor',        type:'number'},
            {label:'转子绕组电感 (H)',    key:'L_rotor',        type:'number'},
            {label:'定子绕组电阻 (Ω)',   key:'R_stator',       type:'number'},
            {label:'电气误差 (arcmin)',   key:'electricalError',type:'number'},
            {label:'零位残压 (mV)',       key:'nullVoltage',    type:'number'},
            {label:'相位误差 (°)',        key:'phaseError',     type:'number'},
            {label:'初始转子角 (°)',      key:'initAngle',      type:'number'},
            {label:'初始接收机角 (°)',    key:'initRxAngle',    type:'number'},
        ];
    }

    onConfigUpdate(cfg) {
        this.id             = cfg.id             || this.id;
        this.ratedVoltage   = parseFloat(cfg.ratedVoltage)   || this.ratedVoltage;
        this.ratedFreq      = parseFloat(cfg.ratedFreq)      || this.ratedFreq;
        this.outputVoltage  = parseFloat(cfg.outputVoltage)  || this.outputVoltage;
        this.R_rotor        = parseFloat(cfg.R_rotor)        || this.R_rotor;
        this.L_rotor        = parseFloat(cfg.L_rotor)        || this.L_rotor;
        this.R_stator       = parseFloat(cfg.R_stator)       || this.R_stator;
        this.electricalError= parseFloat(cfg.electricalError)||this.electricalError;
        this.nullVoltage    = (parseFloat(cfg.nullVoltage)||this.nullVoltage*1000)*1e-3;
        this.phaseError     = parseFloat(cfg.phaseError)     || this.phaseError;
        if (cfg.initAngle  !== undefined) this.setAngle(parseFloat(cfg.initAngle));
        if (cfg.initRxAngle!== undefined) this.setRxAngle(parseFloat(cfg.initRxAngle));
        this.voltageRatio   = this.outputVoltage / this.ratedVoltage;
        this.Z_rotor        = Math.sqrt(this.R_rotor**2+(2*Math.PI*this.ratedFreq*this.L_rotor)**2);
        this.cosPhi_r       = this.R_rotor/this.Z_rotor;
        this._freqSet       = this.ratedFreq;
        this.config         = {...this.config,...cfg};
        this._refreshCache();
    }

    destroy() {
        super.destroy?.();
    }
}