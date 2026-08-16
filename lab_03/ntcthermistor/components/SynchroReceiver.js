import { BaseComponent } from './BaseComponent.js';

/**
 * 控制式自整角机接收机仿真组件
 * （Control Synchro Receiver / Control Transformer，CR / CT / CX-TR）
 *
 * ── 与发送机（CX-TX）的核心区别 ──────────────────────────────
 *
 *  控制式自整角机发送机（CX-TX）：
 *    → 输入：机械角度 θ_TX（通过转子轴）
 *    → 输出：三相定子电压 e_S1/e_S2/e_S3（携带角度信息）
 *
 *  控制式自整角机接收机（CT / CX-TR）：
 *    → 输入：来自发送机的三相定子电压 e_S1/e_S2/e_S3
 *    → 输出：误差信号电压 e_out（从转子绕组引出）
 *    → e_out = K × U_m × sin(θ_TX - θ_CT) × sin(ωt)
 *
 *  关键差异：
 *  ┌──────────────┬────────────────────────────┬────────────────────────────┐
 *  │              │  发送机 CX-TX              │  接收机 CT / CX-TR         │
 *  ├──────────────┼────────────────────────────┼────────────────────────────┤
 *  │ 励磁方式     │ 转子通励磁电压（单相交流） │ 定子接收三相信号电压       │
 *  │ 输出         │ 三相定子电压               │ 转子单相误差电压           │
 *  │ 转子作用     │ 调制（角度→幅值编码）      │ 解调（相差→误差电压）      │
 *  │ 用途         │ 角度编码传输               │ 误差检测（相敏解调）       │
 *  │ 接线         │ R1/R2 励磁；S1/S2/S3 输出  │ S1/S2/S3 输入；R1/R2 输出  │
 *  └──────────────┴────────────────────────────┴────────────────────────────┘
 *
 * ── 控制式接收机工作原理 ──────────────────────────────────────
 *
 *  1. 信号输入：
 *     三相定子绕组（S1/S2/S3）接收来自发送机的三相电压：
 *       e_Si = K × U_m × cos(θ_TX - ψ_i) × sin(ωt + φ_Si)
 *     其中 ψ_i 为各相轴向角（0°/120°/240°），θ_TX 为发送机角度
 *
 *  2. 定子气隙磁场：
 *     三相定子电流在气隙中产生合成磁场，其方向与 θ_TX 对应：
 *       Φ_S(θ_TX) = Φ_m × cos(θ_TX - ψ) × sin(ωt)
 *     合成磁场空间方向 = 发送机转子角度 θ_TX
 *
 *  3. 转子输出电压（误差信号）：
 *     转子绕组（R1/R2）与气隙磁场的耦合：
 *       e_out = K × U_m × sin(θ_TX - θ_CT) × sin(ωt)
 *     其中 θ_CT 为接收机自身转子轴角度
 *
 *     ★ 零位（null position）：θ_TX = θ_CT 时 e_out = 0
 *       → 此时转子绕组轴线与气隙合成磁场垂直（正交零位）
 *       → 转子正交于磁场方向，感应电压最小（理论为零）
 *
 *  4. 相位特性：
 *     θ_TX > θ_CT（正偏差）：e_out 与励磁同相
 *     θ_TX < θ_CT（负偏差）：e_out 与励磁反相（相差 180°）
 *     |θ_TX - θ_CT| = 90°：e_out 最大 = K × U_m
 *     这一特性使得相敏解调器可判断偏差方向，驱动伺服电机正转或反转
 *
 *  5. 随动系统工作过程：
 *     θ_TX ≠ θ_CT
 *     → e_out ≠ 0（误差信号）
 *     → 相敏解调器（PSD）输出直流误差电压（含方向信息）
 *     → 伺服放大器放大
 *     → 伺服电机驱动接收机转子转动
 *     → θ_CT → θ_TX（趋近零位）
 *     → e_out → 0（系统稳定）
 *
 *  6. 精度分析：
 *     静态误差：e_static ≈ e_null_voltage / (K_sys × K_amp)
 *     动态误差：由系统带宽决定
 *     线性范围：|θ_TX - θ_CT| < 5°~10° 时 sin ≈ Δθ，误差信号线性
 *     小角度近似：e_out ≈ K × U_m × (θ_TX - θ_CT) × sin(ωt)
 *
 *  7. 相敏解调（Phase-Sensitive Demodulation，PSD）：
 *     将调幅误差信号解调为直流：
 *       V_DC = e_out × sin(ωt) 的低频分量
 *            = (K × U_m / 2) × sin(θ_TX - θ_CT)
 *     解调后含方向信息：V_DC > 0 → 正偏差；V_DC < 0 → 负偏差
 *
 *  8. 接线方式（重要）：
 *     CT 型：定子直接接 TX 发送机定子（S1→S1，S2→S2，S3→S3）
 *     旋转方向：CT 转子轴旋转方向 = TX 发送机转子轴旋转方向（同向追踪）
 *     注意：S 线对接时方向需正确，否则旋转方向相反（接 S1→S1，S2→S3，S3→S2 则反向）
 *
 * ── 组件结构 ──────────────────────────────────────────────────
 *  ① 自整角机接收机横截面图（三相定子接收绕组 + 转子输出绕组 + 转子可旋转）
 *  ② 定子磁场合成动画（三相输入电压→气隙合成磁场方向，随 θ_TX 旋转）
 *  ③ 误差信号输出回路（转子 R1/R2，含阻抗与相位特性）
 *  ④ 误差信号特性曲线（e_out vs Δθ，-180°~+180°，正弦曲线+线性近似区）
 *  ⑤ 相敏解调器（PSD）可视化（调幅信号→相乘→低通→直流误差电压）
 *  ⑥ 相量图（气隙合成磁场 Φ_S，转子磁轴方向，误差电压相量）
 *  ⑦ 随动系统闭环框图（TX→CT→PSD→Amp→ServoMotor→θ_CT 反馈）
 *  ⑧ 动态响应曲线（θ_CT 跟踪 θ_TX 过程，含超调/振荡/稳定）
 *  ⑨ LCD 仪表（θ_TX/θ_CT/Δθ/e_out/V_DC/误差相位/跟踪状态）
 *  ⑩ 控制面板（θ_TX 输入/θ_CT 手动/随动使能/系统增益/阻尼系数）
 *
 * ── 端口 ─────────────────────────────────────────────────────
 *  stator_s1  — 定子输入 S1（来自发送机）
 *  stator_s2  — 定子输入 S2
 *  stator_s3  — 定子输入 S3
 *  rotor_r1   — 转子输出 R1（误差信号+）
 *  rotor_r2   — 转子输出 R2（误差信号-）
 *  psd_out    — 相敏解调输出（直流误差电压）
 *  shaft      — 转子轴（由随动电机驱动）
 */
export class SynchroReceiver extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.width  = Math.max(580, config.width  || 740);
        this.height = Math.max(440, config.height || 580);

        this.type    = 'synchro_receiver';
        this.special = 'none';
        this.cache   = 'fixed';

        // ── 额定参数（与发送机匹配）──
        this.ratedVoltage  = config.ratedVoltage  || 115;    // V（系统励磁电压）
        this.ratedFreq     = config.ratedFreq     || 400;    // Hz
        this.inputVoltage  = config.inputVoltage  || 90;     // V（定子输入线电压额定值）
        this.voltageRatio  = config.voltageRatio  || (this.inputVoltage / this.ratedVoltage);
        this.outputVoltage = config.outputVoltage || 90;     // V（转子输出额定线电压，Δθ=90°时）

        // ── 电气参数 ──
        this.R_stator  = config.R_stator  || 220;     // Ω（每相定子绕组电阻）
        this.L_stator  = config.L_stator  || 0.32;    // H（每相定子电感）
        this.R_rotor   = config.R_rotor   || 180;     // Ω（转子绕组电阻）
        this.L_rotor   = config.L_rotor   || 0.45;    // H（转子绕组电感）
        this.Lm        = config.Lm        || 2.5;     // H（互感）

        // 转子输出阻抗
        this.Z_rotor  = Math.sqrt(this.R_rotor**2 + (2*Math.PI*this.ratedFreq*this.L_rotor)**2);

        // 精度参数
        this.electricalError  = config.electricalError  || 12;    // 角分
        this.nullVoltage      = config.nullVoltage       || 4e-3;  // V（零位残压）
        this.phaseShift       = config.phaseShift        || 2.5;   // °（输出相位误差）

        // ── 随动系统参数 ──
        this.servoGain   = config.servoGain   || 1.5;    // 系统开环增益（rad/s/rad）
        this.servoDamp   = config.servoDamp   || 0.7;    // 阻尼系数 ζ
        this.J_servo     = config.J_servo     || 1e-3;   // kg·m²（随动电机+CT转子等效惯量）
        this.B_servo     = config.B_servo     || 0.01;   // N·m·s/rad（粘性阻尼）
        this.Kamp        = config.Kamp        || 5.0;    // 放大器增益（A/V）
        this.Kt_servo    = config.Kt_servo    || 0.08;   // N·m/A（随动电机转矩系数）

        // ── 运行状态 ──
        this._wavePhase   = 0;      // 载波相位
        this._animPhase   = 0;

        // 发送机角度（输入）
        this._txAngle     = config.initTxAngle || 45.0;  // °
        this._txAngleRad  = this._txAngle * Math.PI / 180;

        // 接收机转子角度（状态变量）
        this._ctAngle     = config.initCtAngle || 0.0;   // °
        this._ctAngleRad  = this._ctAngle * Math.PI / 180;
        this._ctOmega     = 0;   // rad/s（CT 转子角速度）

        // 随动模式
        this._servoEnabled= false;
        this._manualMode  = true;  // 手动模式（直接设定 θ_CT）

        // 实时电气量
        // 定子输入电压
        this._eS1in  = 0; this._eS2in = 0; this._eS3in = 0;
        // 定子电流（产生气隙磁场）
        this._iS1    = 0; this._iS2   = 0; this._iS3   = 0;
        // 气隙合成磁场
        this._phiSx  = 0; this._phiSy = 0; // x/y 分量（静止坐标系）
        this._phiAngle=0; // 合成磁场方向（rad）= θ_TX

        // 转子输出
        this.e_out   = 0;   // 误差信号瞬时电压 V
        this.e_outRMS= 0;   // 误差信号有效值 V
        this.v_DC    = 0;   // PSD 直流输出 V
        this.deltaTheta=0;  // 角差 θ_TX - θ_CT（°）

        // PI 补偿器（随动系统内环）
        this._piIntg = 0;

        // ── 动态响应记录（用于跟踪曲线）──
        this._trackLen  = 300;
        this._trackTX   = new Float32Array(this._trackLen).fill(0);
        this._trackCT   = new Float32Array(this._trackLen).fill(0);
        this._trackErr  = new Float32Array(this._trackLen).fill(0);
        this._trackVDC  = new Float32Array(this._trackLen).fill(0);

        // ── 波形缓冲 ──
        this._wavLen   = 320;
        this._wavES1   = new Float32Array(this._wavLen).fill(0);
        this._wavEout  = new Float32Array(this._wavLen).fill(0);
        this._wavVDC   = new Float32Array(this._wavLen).fill(0);
        this._wavDelta = new Float32Array(this._wavLen).fill(0);

        // ── 几何布局 ──
        // 接收机截面（左上）
        this._synX  = Math.round(this.width * 0.02);
        this._synY  = Math.round(this.height * 0.04);
        this._synW  = Math.round(this.width * 0.26);
        this._synH  = Math.round(this.height * 0.46);
        this._synCX = this._synX + this._synW / 2;
        this._synCY = this._synY + this._synH / 2;

        // 误差信号特性曲线（中上左）
        this._errCX = Math.round(this.width * 0.30);
        this._errCY = this._synY;
        this._errCW = Math.round(this.width * 0.22);
        this._errCH = Math.round(this.height * 0.24);

        // 随动系统框图（中上右 + 右上）
        this._blkX  = this._errCX + this._errCW + 8;
        this._blkY  = this._synY;
        this._blkW  = this.width - this._blkX - Math.round(this.width * 0.02);
        this._blkH  = this._errCH;

        // 相量图（中中左）
        this._phX   = this._errCX;
        this._phY   = this._errCY + this._errCH + 8;
        this._phW   = Math.round(this.width * 0.20);
        this._phH   = Math.round(this.height * 0.26);

        // PSD 可视化（中中）
        this._psdX  = this._phX + this._phW + 8;
        this._psdY  = this._phY;
        this._psdW  = Math.round(this.width * 0.24);
        this._psdH  = this._phH;

        // 动态跟踪曲线（右中）
        this._dynX  = this._psdX + this._psdW + 8;
        this._dynY  = this._phY;
        this._dynW  = this.width - this._dynX - Math.round(this.width * 0.02);
        this._dynH  = this._phH;

        // LCD（左下）
        this._lcdX  = this._synX;
        this._lcdY  = this._synY + this._synH + 8;
        this._lcdW  = this._synW;
        this._lcdH  = Math.round(this.height * 0.24);

        // 控制面板（中下）
        this._panX  = this._errCX;
        this._panY  = this._phY + this._phH + 8;
        this._panW  = this.width - this._errCX - Math.round(this.width * 0.02);
        this._panH  = Math.round(this.height * 0.16);

        // 波形（底部全宽）
        this._wavX  = this._synX;
        this._wavY  = Math.max(this._lcdY + this._lcdH, this._panY + this._panH) + 6;
        this._wavW  = this.width - this._synX * 2;
        this._wavH  = this.height - this._wavY - 6;

        this._lastTs = null;
        this._animId = null;

        this.config = {
            id: this.id,
            ratedVoltage: this.ratedVoltage,
            ratedFreq: this.ratedFreq,
            outputVoltage: this.outputVoltage,
            servoGain: this.servoGain,
        };

        this._init();

        // 端口
        const sR = this._synX + this._synW + 6;
        this.addPort(sR, this._synCY - 28, 'stator_s1', 'wire', 'S1');
        this.addPort(sR, this._synCY,       'stator_s2', 'wire', 'S2');
        this.addPort(sR, this._synCY + 28,  'stator_s3', 'wire', 'S3');
        const sL = this._synX - 6;
        this.addPort(sL, this._synCY - 20,  'rotor_r1',  'wire', 'R1');
        this.addPort(sL, this._synCY + 20,  'rotor_r2',  'wire', 'R2');
        this.addPort(sL, this._synCY + 58,  'psd_out',   'wire', 'PSD');
        this.addPort(this._synCX, this._synY + this._synH + 6, 'shaft', 'pipe', '随动轴');
    }

    // ═══════════════════════════════════════════
    _init() {
        this._drawLabel();
        this._drawReceiverSection();
        this._drawFieldLayer();
        this._drawRotorLayer();
        this._drawErrorCurve();
        this._drawSystemBlock();
        this._drawPhasorDiagram();
        this._drawPSDPanel();
        this._drawDynamicTrace();
        this._drawLCDPanel();
        this._drawControlPanel();
        this._drawWaveform();
        this._startAnimation();
    }

    _drawLabel() {
        this.group.add(new Konva.Text({
            x: 0, y: -22, width: this.width,
            text: `控制式自整角机接收机（CT / CX-TR）  ` +
                  `输入 ${this.inputVoltage}V三相  输出误差信号 ${this.outputVoltage}V  ` +
                  `${this.ratedFreq}Hz  增益 K=${this.servoGain}  ζ=${this.servoDamp}`,
            fontSize: 10, fontStyle: 'bold', fill: '#1a2634', align: 'center',
        }));
    }

    // ── 接收机横截面 ────────────────────────
    _drawReceiverSection() {
        const { _synX: ex, _synY: ey, _synW: ew, _synH: eh,
                _synCX: ecx, _synCY: ecy } = this;

        this.group.add(new Konva.Rect({
            x: ex, y: ey, width: ew, height: eh,
            fill: '#0d1a24', stroke: '#1a3040', strokeWidth: 1.5, cornerRadius: 5,
        }));
        this.group.add(new Konva.Text({
            x: ex, y: ey - 14, width: ew,
            text: `CT 接收机截面（${this.ratedFreq}Hz，控制式）`,
            fontSize: 9, fontStyle: 'bold', fill: '#546e7a', align: 'center',
        }));

        // 机座
        const frameR = Math.round(Math.min(ew, eh) * 0.46);
        this.group.add(new Konva.Circle({ x: ecx, y: ecy, radius: frameR, fill: '#1c2b38', stroke: '#37474f', strokeWidth: 3 }));

        // 定子铁芯（叠片）
        const sOuter = Math.round(frameR * 0.90);
        const sInner = Math.round(frameR * 0.56);
        this.group.add(new Konva.Ring({ x: ecx, y: ecy, innerRadius: sInner, outerRadius: sOuter, fill: '#455a64', stroke: '#263238', strokeWidth: 1 }));

        // 叠片纹
        for (let i = 0; i < 36; i++) {
            const a = (i / 36) * Math.PI * 2;
            this.group.add(new Konva.Line({
                points: [ecx + sInner*Math.cos(a), ecy + sInner*Math.sin(a),
                         ecx + sOuter*Math.cos(a), ecy + sOuter*Math.sin(a)],
                stroke: 'rgba(0,0,0,0.12)', strokeWidth: 0.5,
            }));
        }

        // 定子三相输入绕组（S1/S2/S3，与发送机对应接线）
        const statorAxes = [Math.PI/2, Math.PI/2 + 2*Math.PI/3, Math.PI/2 + 4*Math.PI/3];
        const statorColors= ['#e53935', '#43a047', '#1e88e5'];
        const wR   = sInner + (sOuter - sInner) * 0.45;
        const wW   = 5;

        this._statorDots = [];
        statorAxes.forEach((a, i) => {
            // 槽口
            for (let t = -1; t <= 1; t++) {
                const ta = a + t * Math.PI / 8;
                this.group.add(new Konva.Line({
                    points: [ecx+sInner*1.02*Math.cos(ta), ecy+sInner*1.02*Math.sin(ta),
                             ecx+(sInner+(sOuter-sInner)*0.55)*Math.cos(ta),
                             ecy+(sInner+(sOuter-sInner)*0.55)*Math.sin(ta)],
                    stroke: '#0d1a24', strokeWidth: 4.5, lineCap: 'square',
                }));
            }
            const dot  = new Konva.Circle({ x: ecx+wR*Math.cos(a), y: ecy+wR*Math.sin(a), radius: wW, fill: statorColors[i], opacity: 0.75 });
            const dotB = new Konva.Circle({ x: ecx+wR*Math.cos(a+Math.PI), y: ecy+wR*Math.sin(a+Math.PI), radius: wW, fill: statorColors[i], opacity: 0.28 });
            this._statorDots.push({ dot, dotB, angle: a });
            this.group.add(dot, dotB);
            // 轴标注
            this.group.add(new Konva.Text({
                x: ecx+(sInner+(sOuter-sInner)*0.72)*Math.cos(a)-6,
                y: ecy+(sInner+(sOuter-sInner)*0.72)*Math.sin(a)-6,
                text: ['S1','S2','S3'][i], fontSize: 8, fill: statorColors[i], fontStyle: 'bold',
            }));
        });
        this._statorAxes  = statorAxes;
        this._statorColors= statorColors;

        // 气隙
        this._airGapR = Math.round(sInner * 0.97);
        this.group.add(new Konva.Circle({ x: ecx, y: ecy, radius: this._airGapR, fill: '#05101a', stroke: '#1a3040', strokeWidth: 0.5 }));

        // 转子（凸极，输出绕组 R1/R2）
        const rotorR = Math.round(this._airGapR * 0.82);
        this.group.add(new Konva.Circle({ x: ecx, y: ecy, radius: rotorR, fill: '#2e3f4f', stroke: '#37474f', strokeWidth: 1.2 }));
        this._rotorR  = rotorR;
        this._sInner  = sInner;
        this._sOuter  = sOuter;

        // 转子极靴（凸极）
        for (let p = 0; p < 2; p++) {
            this.group.add(new Konva.Arc({
                x: ecx, y: ecy,
                innerRadius: rotorR*0.72, outerRadius: rotorR*0.95,
                angle: 90, rotation: p*180 - 45,
                fill: '#455a64', stroke: '#263238', strokeWidth: 1,
            }));
        }

        // 转子输出绕组线圈（R1/R2，橙铜色）
        this._rotorGroup = new Konva.Group({ x: ecx, y: ecy });
        for (let i = 0; i < 10; i++) {
            const a  = (i/10)*Math.PI*2;
            const ri = rotorR*0.35, ro = rotorR*0.65;
            this._rotorGroup.add(new Konva.Line({
                points: [ri*Math.cos(a), ri*Math.sin(a), ro*Math.cos(a), ro*Math.sin(a)],
                stroke: ['#c87832','#e09040','#d08838'][i%3], strokeWidth: 2, lineCap: 'round', opacity: 0.8,
            }));
        }
        // 轴
        this._rotorGroup.add(new Konva.Circle({ radius: 7, fill: '#1a252f', stroke: '#37474f', strokeWidth: 1.5 }));
        // 参考点
        this._rotorRef = new Konva.Circle({ x: rotorR*0.60, y: 0, radius: 3, fill: '#ffd54f' });
        this._rotorGroup.add(this._rotorRef);
        // 零位方向（转子绕组轴线，应垂直于气隙磁场时 e_out=0）
        this._rotorGroup.add(new Konva.Line({ points: [0,-rotorR*0.90,0,rotorR*0.90], stroke: '#80cbc4', strokeWidth: 1, dash:[4,3], opacity: 0.6 }));
        this._rotorGroup.add(new Konva.Text({ x: 3, y:-rotorR*0.90, text:'R轴', fontSize:7, fill:'#80cbc4', opacity:0.7 }));
        this.group.add(this._rotorGroup);

        // 集电环（转子输出引出）
        this.group.add(new Konva.Ring({ x: ecx, y: ecy, innerRadius: rotorR*0.28, outerRadius: rotorR*0.38, fill: 'rgba(200,120,50,0.25)', stroke: '#a06020', strokeWidth: 0.8 }));

        // ── 端子接线 ──
        // 定子输入端子（右侧，来自发送机）
        const inX = ex + ew + 10;
        [['S1','#e53935',-28],['S2','#43a047',0],['S3','#1e88e5',28]].forEach(([l,c,dy]) => {
            this.group.add(new Konva.Line({ points:[ecx+sOuter*0.65,ecy+dy,inX,ecy+dy], stroke:c, strokeWidth:2 }));
            this.group.add(new Konva.Circle({ x:inX, y:ecy+dy, radius:3.5, fill:c }));
            this.group.add(new Konva.Text({ x:inX+5, y:ecy+dy-6, text:l, fontSize:9, fill:c, fontStyle:'bold' }));
        });

        // 转子输出端子（左侧，误差信号输出）
        const outX = ex - 10;
        [['R1','#ef9a9a',-20],['R2','#90caf9',20]].forEach(([l,c,dy]) => {
            this.group.add(new Konva.Line({ points:[outX,ecy+dy,ex+8,ecy+dy], stroke:c, strokeWidth:2 }));
            this.group.add(new Konva.Circle({ x:outX, y:ecy+dy, radius:3.5, fill:c }));
            this.group.add(new Konva.Text({ x:ex-26, y:ecy+dy-5, text:l, fontSize:8, fill:c, fontStyle:'bold' }));
        });

        // PSD 输出端子（左侧，直流）
        this.group.add(new Konva.Line({ points:[outX,ecy+58,ex+8,ecy+58], stroke:'#ffd54f', strokeWidth:2, dash:[3,3] }));
        this.group.add(new Konva.Circle({ x:outX, y:ecy+58, radius:3.5, fill:'#ffd54f' }));
        this.group.add(new Konva.Text({ x:ex-30, y:ecy+53, text:'PSD\n出', fontSize:7, fill:'#ffd54f', lineHeight:1.2 }));

        // 随动轴（底部）
        this.group.add(new Konva.Rect({ x:ecx-5, y:ey+eh, width:10, height:10, fill:'#66bb6a', stroke:'#2e7d32', strokeWidth:1 }));
        this.group.add(new Konva.Text({ x:ecx-18, y:ey+eh+12, text:'随动电机驱动', fontSize:7, fill:'#66bb6a' }));

        // 接线说明（右下）
        this.group.add(new Konva.Rect({ x:ex+4, y:ey+eh-30, width:ew-8, height:26, fill:'#0a1520', stroke:'#1a3040', strokeWidth:0.8, cornerRadius:2 }));
        this.group.add(new Konva.Text({ x:ex+6, y:ey+eh-28, text:'接线：TX.S1→CT.S1\nTX.S2→CT.S2  TX.S3→CT.S3', fontSize:7, fill:'#546e7a', lineHeight:1.4 }));
    }

    // ── 气隙磁场动画层 ──────────────────────
    _drawFieldLayer() {
        this._fieldGroup = new Konva.Group();
        this.group.add(this._fieldGroup);
    }

    // ── 转子层（已在截面中创建，此处添加合成磁场指示）──
    _drawRotorLayer() {
        // 气隙合成磁场方向箭头（动态，表示发送机角度 θ_TX）
        this._fieldArrow = new Konva.Arrow({
            points: [this._synCX, this._synCY,
                     this._synCX + this._airGapR*0.85, this._synCY],
            stroke: '#ffa726', fill: '#ffa726', strokeWidth: 2.5,
            pointerLength: 8, pointerWidth: 7, opacity: 0.75,
        });
        this.group.add(this._fieldArrow);
        this.group.add(new Konva.Text({
            x: this._synCX + this._airGapR*0.55,
            y: this._synCY - 14,
            text: 'Φ_S\n(θ_TX)',
            fontSize: 7.5, fill: '#ffa726', lineHeight: 1.3,
        }));
    }

    // ── 误差信号特性曲线（e_out vs Δθ）──────
    _drawErrorCurve() {
        const { _errCX: ex, _errCY: ey, _errCW: ew, _errCH: eh } = this;

        this.group.add(new Konva.Rect({ x:ex, y:ey, width:ew, height:eh, fill:'#010d18', stroke:'#1a3040', strokeWidth:1.5, cornerRadius:4 }));
        this.group.add(new Konva.Rect({ x:ex, y:ey, width:ew, height:13, fill:'#0a1a28', cornerRadius:[4,4,0,0] }));
        this.group.add(new Konva.Text({ x:ex+4, y:ey+2, width:ew-8, text:'误差特性 e_out = K·U·sin(Δθ)', fontSize:8, fontStyle:'bold', fill:'#80cbc4', align:'center' }));

        const ox=ex+14, oy=ey+eh*0.54, aw=ew-20, ah=eh*0.38;
        this.group.add(new Konva.Line({ points:[ox,oy-ah,ox,oy+ah,ox,oy,ox+aw,oy], stroke:'#37474f', strokeWidth:0.8 }));
        this.group.add(new Konva.Text({ x:ox-13,y:oy-ah,text:'e_out', fontSize:6.5, fill:'#80cbc4' }));
        this.group.add(new Konva.Text({ x:ox+aw+2,y:oy+2,text:'Δθ', fontSize:6.5, fill:'#80cbc4' }));

        // -180°/0°/+180° 标注
        [[-180,-1],[0,0],[90,0.5],[180,1]].forEach(([d,xr]) => {
            const x2 = ox + (d+180)/360*aw;
            this.group.add(new Konva.Line({ points:[x2,oy-3,x2,oy+3], stroke:'#37474f', strokeWidth:0.7 }));
            this.group.add(new Konva.Text({ x:x2-8,y:oy+5, text:`${d}°`, fontSize:5.5, fill:'#37474f', width:16, align:'center' }));
        });

        // e_out = sin(Δθ) 曲线
        const sinPts = [];
        for (let d = -180; d <= 180; d += 2) {
            const x2 = ox + (d+180)/360*aw;
            const y2 = oy - Math.sin(d*Math.PI/180) * (ah-3);
            sinPts.push(x2, y2);
        }
        this.group.add(new Konva.Line({ points:sinPts, stroke:'#ef5350', strokeWidth:2, lineJoin:'round', opacity:0.8 }));

        // 线性近似区（±30°，蓝色高亮段）
        const linPts = [];
        for (let d = -30; d <= 30; d += 2) {
            const x2 = ox + (d+180)/360*aw;
            const y2 = oy - (d*Math.PI/180) * (ah-3);
            linPts.push(x2, y2);
        }
        this.group.add(new Konva.Line({ points:linPts, stroke:'#4fc3f7', strokeWidth:1.5, lineJoin:'round', opacity:0.7, dash:[5,3] }));
        this.group.add(new Konva.Text({ x:ox+aw*0.55,y:oy-ah*0.7,text:'实际', fontSize:6.5, fill:'#ef5350' }));
        this.group.add(new Konva.Text({ x:ox+aw*0.55,y:oy-ah*0.55,text:'线性近似', fontSize:6.5, fill:'#4fc3f7' }));

        // 零位 ± 区域（绿色）
        const nullX = ox + (0+180)/360*aw;
        this.group.add(new Konva.Rect({ x:nullX-aw*0.08, y:oy-ah, width:aw*0.16, height:ah*2, fill:'rgba(102,187,106,0.08)', stroke:'#66bb6a', strokeWidth:0.6, dash:[3,3] }));
        this.group.add(new Konva.Text({ x:nullX-12, y:oy-ah+2, text:'线性区', fontSize:6, fill:'#66bb6a' }));

        // 动态工作点
        this._errCrvPoint = new Konva.Circle({ x:nullX, y:oy, radius:5, fill:'#ffd54f', stroke:'#f9a825', strokeWidth:1.5 });
        this.group.add(this._errCrvPoint);
        this._errCOX=ox; this._errCOY=oy; this._errCAW=aw; this._errCAH=ah;
    }

    // ── 随动系统闭环框图 ────────────────────
    _drawSystemBlock() {
        const { _blkX: bx, _blkY: by, _blkW: bw, _blkH: bh } = this;

        this.group.add(new Konva.Rect({ x:bx, y:by, width:bw, height:bh, fill:'#010d18', stroke:'#1a3040', strokeWidth:1.5, cornerRadius:4 }));
        this.group.add(new Konva.Rect({ x:bx, y:by, width:bw, height:13, fill:'#0a1a28', cornerRadius:[4,4,0,0] }));
        this.group.add(new Konva.Text({ x:bx+4, y:by+2, width:bw-8, text:'随动系统闭环结构（CX-TX → CT → PSD → Amp → 随动电机）', fontSize:8, fontStyle:'bold', fill:'#80cbc4', align:'center' }));

        const y0 = by+bh*0.44;
        const blocks = [
            { lbl:'θ_TX\n给定', x:bx+12,  w:30, col:'#ffd54f', bg:'#1a1a0a' },
            { lbl:'CX-TX\n发送机', x:bx+52, w:38, col:'#ef9a9a', bg:'#1a0a0a' },
            { lbl:'CT\n接收机', x:bx+98,  w:36, col:'#80cbc4', bg:'#0a1a18' },
            { lbl:'PSD\n相敏解调', x:bx+142,w:38, col:'#ffa726', bg:'#1a1000' },
            { lbl:'伺服\n放大器', x:bx+188, w:36, col:'#66bb6a', bg:'#0a1a0a' },
            { lbl:'随动\n电机', x:bx+232,  w:34, col:'#ce93d8', bg:'#180a28' },
            { lbl:'θ_CT\n当前角', x:bx+274, w:34, col:'#4fc3f7', bg:'#0a1520' },
        ];
        blocks.forEach(({ lbl, x, w, col, bg }) => {
            this.group.add(new Konva.Rect({ x, y:y0-13, width:w, height:26, fill:bg, stroke:col, strokeWidth:1, cornerRadius:3 }));
            this.group.add(new Konva.Text({ x, y:y0-11, width:w, text:lbl, fontSize:6.5, fill:col, align:'center', lineHeight:1.35 }));
        });

        // 前向通路箭头
        for (let i = 0; i < blocks.length-1; i++) {
            const x1=blocks[i].x+blocks[i].w, x2=blocks[i+1].x;
            const arrowColors=['#ffd54f','#ef9a9a','#80cbc4','#ffa726','#66bb6a','#ce93d8'];
            this.group.add(new Konva.Arrow({ points:[x1,y0,x2,y0], stroke:arrowColors[i], fill:arrowColors[i], strokeWidth:1, pointerLength:4, pointerWidth:3 }));
        }

        // 反馈线（θ_CT → CT 输入）
        const fbY = y0 + bh*0.38;
        this.group.add(new Konva.Line({
            points:[blocks[6].x+17, y0+13, blocks[6].x+17, fbY, bx+116, fbY, bx+116, y0+13],
            stroke:'#4fc3f7', strokeWidth:1, dash:[4,3], opacity:0.8,
        }));
        this.group.add(new Konva.Text({ x:bx+bw*0.55, y:fbY-9, text:'θ_CT 反馈（机械轴）', fontSize:7, fill:'#4fc3f7', opacity:0.9 }));

        // 误差信号标注
        this._blkErrLabel = new Konva.Text({ x:bx+142, y:by+bh-18, text:'e_out=0V  V_DC=0V', fontSize:7.5, fill:'#ffa726', fontFamily:'Courier New, monospace' });
        // 状态标注
        this._blkStateLabel = new Konva.Text({ x:bx+240, y:by+bh-18, text:'状态：未使能', fontSize:7.5, fill:'#546e7a' });
        this.group.add(this._blkErrLabel, this._blkStateLabel);
    }

    // ── 相量图（气隙磁场 Φ_S + 转子轴 + 误差相量）──
    _drawPhasorDiagram() {
        const { _phX: px, _phY: py, _phW: pw, _phH: ph } = this;

        this.group.add(new Konva.Rect({ x:px, y:py, width:pw, height:ph, fill:'#010d18', stroke:'#1a3040', strokeWidth:1.5, cornerRadius:4 }));
        this.group.add(new Konva.Rect({ x:px, y:py, width:pw, height:13, fill:'#0a1a28', cornerRadius:[4,4,0,0] }));
        this.group.add(new Konva.Text({ x:px+4, y:py+2, width:pw-8, text:'磁场与转子相量', fontSize:8, fontStyle:'bold', fill:'#80cbc4', align:'center' }));

        const ocx=px+pw*0.50, ocy=py+ph*0.58;
        const R  =Math.min(pw,ph)*0.30;

        this.group.add(new Konva.Line({ points:[px+6,ocy,px+pw-6,ocy], stroke:'#1a3040', strokeWidth:0.7 }));
        this.group.add(new Konva.Line({ points:[ocx,py+14,ocx,py+ph-6], stroke:'#1a3040', strokeWidth:0.7 }));
        this.group.add(new Konva.Circle({ x:ocx,y:ocy,radius:R, fill:'rgba(0,0,0,0)',stroke:'#1a3040',strokeWidth:0.6,dash:[3,3] }));

        // Φ_S：气隙合成磁场（方向=θ_TX，橙色粗箭头）
        this._phaPhi_S = new Konva.Arrow({ points:[ocx,ocy,ocx+R,ocy], stroke:'#ffa726',fill:'#ffa726',strokeWidth:2.5,pointerLength:7,pointerWidth:6 });
        // R轴：转子绕组轴线（方向=θ_CT+90°，cyan，零位时垂直于Φ_S）
        this._phaR_axis= new Konva.Arrow({ points:[ocx,ocy,ocx,ocy-R], stroke:'#80cbc4',fill:'#80cbc4',strokeWidth:2,pointerLength:6,pointerWidth:5 });
        // e_out 相量（垂直分量：Φ_S 在转子轴线上的投影）
        this._phaEout  = new Konva.Arrow({ points:[ocx,ocy,ocx,ocy], stroke:'#ef5350',fill:'#ef5350',strokeWidth:2,pointerLength:6,pointerWidth:5,dash:[4,2] });
        // 角差弧
        this._phaArc   = new Konva.Arc({ x:ocx,y:ocy,innerRadius:R*0.25,outerRadius:R*0.28,angle:0,rotation:0,fill:'#ffd54f',opacity:0.8 });
        // Δθ 标注
        this._phaAngleLabel = new Konva.Text({ x:ocx+R*0.32,y:ocy-14, text:'Δθ=0°', fontSize:8, fontStyle:'bold', fill:'#ffd54f' });

        const lgX=px+6, lgY=py+14;
        [['#ffa726','Φ_S（气隙磁场=θ_TX）'],
         ['#80cbc4','R轴（转子=θ_CT+90°）'],
         ['#ef5350','e_out（误差电压）']].forEach(([col,lbl],i) => {
            this.group.add(new Konva.Line({ points:[lgX,lgY+i*9+3,lgX+10,lgY+i*9+3], stroke:col, strokeWidth:1.8 }));
            this.group.add(new Konva.Text({ x:lgX+12,y:lgY+i*9-1,text:lbl,fontSize:7,fill:col }));
        });

        this._phOCX=ocx; this._phOCY=ocy; this._phR=R;
        this.group.add(this._phaArc,this._phaPhi_S,this._phaR_axis,this._phaEout,this._phaAngleLabel);
    }

    // ── PSD 相敏解调可视化 ───────────────────
    _drawPSDPanel() {
        const { _psdX: px, _psdY: py, _psdW: pw, _psdH: ph } = this;

        this.group.add(new Konva.Rect({ x:px, y:py, width:pw, height:ph, fill:'#010d18', stroke:'#1a3040', strokeWidth:1.5, cornerRadius:4 }));
        this.group.add(new Konva.Rect({ x:px, y:py, width:pw, height:13, fill:'#0a1a28', cornerRadius:[4,4,0,0] }));
        this.group.add(new Konva.Text({ x:px+4, y:py+2, width:pw-8, text:'相敏解调器（PSD）原理', fontSize:8, fontStyle:'bold', fill:'#80cbc4', align:'center' }));

        // PSD 流程框图（三个子框）
        const boxH=20, gap=4;
        const boxes=[
            { lbl:'e_out\n(调幅波)',   x:px+8,          col:'#ef5350', bg:'#1a0a0a' },
            { lbl:'× sin(ωt)\n相乘',   x:px+pw*0.38,    col:'#ffa726', bg:'#1a1000' },
            { lbl:'低通滤波\n→ V_DC',  x:px+pw*0.68,    col:'#ffd54f', bg:'#1a1a0a' },
        ];
        const boxW=(pw-16)/3-gap;
        const boxY=py+20;
        boxes.forEach(({ lbl, x, col, bg }, i) => {
            this.group.add(new Konva.Rect({ x, y:boxY, width:boxW, height:boxH, fill:bg, stroke:col, strokeWidth:1, cornerRadius:3 }));
            this.group.add(new Konva.Text({ x, y:boxY+2, width:boxW, text:lbl, fontSize:6.5, fill:col, align:'center', lineHeight:1.3 }));
            if (i < boxes.length-1)
                this.group.add(new Konva.Arrow({ points:[x+boxW+1,boxY+boxH/2,x+boxW+gap,boxY+boxH/2], stroke:col, fill:col, strokeWidth:1, pointerLength:4, pointerWidth:3 }));
        });

        // 解调波形示意区（调幅波 → 整流 → 直流）
        const wY0=boxY+boxH+8, wH=(ph-wY0-py-10)/2;
        const wx=px+6, ww=pw-12;

        // 调幅波（上半）
        this.group.add(new Konva.Text({ x:wx, y:wY0-2, text:'e_out（调幅）', fontSize:6.5, fill:'#ef5350' }));
        const amPts=[];
        for (let i=0;i<60;i++) {
            const t=i/59; const x2=wx+t*ww;
            const env=Math.abs(Math.sin(t*Math.PI*1.2));
            const y2=wY0+wH/2-env*Math.sin(t*Math.PI*8)*(wH*0.40);
            amPts.push(x2,y2);
        }
        this.group.add(new Konva.Line({ points:amPts, stroke:'#ef5350', strokeWidth:1.5, lineJoin:'round', opacity:0.65 }));
        this.group.add(new Konva.Line({ points:[wx,wY0+wH/2,wx+ww,wY0+wH/2], stroke:'#37474f', strokeWidth:0.5 }));

        // 解调后直流（下半）
        const dcY=wY0+wH+6;
        this.group.add(new Konva.Text({ x:wx, y:dcY-2, text:'V_DC（解调）', fontSize:6.5, fill:'#ffd54f' }));
        this._psdDCLine = new Konva.Line({ points:[wx,dcY+wH/2,wx+ww,dcY+wH/2], stroke:'#ffd54f', strokeWidth:2, lineCap:'round' });
        this._psdDCLabel= new Konva.Text({ x:wx+ww*0.6, y:dcY+4, text:'V_DC=0.00V', fontSize:7.5, fill:'#ffd54f', fontFamily:'Courier New, monospace' });
        this.group.add(new Konva.Line({ points:[wx,dcY,wx,dcY+wH+4,wx+ww,dcY+wH+4,wx+ww,dcY], stroke:'#37474f', strokeWidth:0.5 }));
        this.group.add(new Konva.Line({ points:[wx,dcY+wH/2,wx+ww,dcY+wH/2], stroke:'#37474f', strokeWidth:0.4, dash:[3,3] }));
        this.group.add(this._psdDCLine, this._psdDCLabel);

        this._psdWX=wx; this._psdWH=wH; this._psdDCY=dcY; this._psdWW=ww;
    }

    // ── 动态响应跟踪曲线 ────────────────────
    _drawDynamicTrace() {
        const { _dynX: dx, _dynY: dy, _dynW: dw, _dynH: dh } = this;

        this.group.add(new Konva.Rect({ x:dx, y:dy, width:dw, height:dh, fill:'#010d18', stroke:'#1a3040', strokeWidth:1.5, cornerRadius:4 }));
        this.group.add(new Konva.Rect({ x:dx, y:dy, width:dw, height:13, fill:'#0a1a28', cornerRadius:[4,4,0,0] }));
        this.group.add(new Konva.Text({ x:dx+4, y:dy+2, width:dw-8, text:'动态跟踪响应曲线', fontSize:8, fontStyle:'bold', fill:'#80cbc4', align:'center' }));

        const ox=dx+12, oy=dy+dh-12, aw=dw-18, ah=dh-26;
        this.group.add(new Konva.Line({ points:[ox,oy-ah,ox,oy,ox+aw,oy], stroke:'#37474f', strokeWidth:0.8 }));
        this.group.add(new Konva.Text({ x:ox-10, y:oy-ah, text:'θ(°)', fontSize:7, fill:'#80cbc4' }));
        this.group.add(new Konva.Text({ x:ox+aw+2, y:oy+2, text:'t', fontSize:7, fill:'#80cbc4' }));

        this._dynTXLine  = new Konva.Line({ points:[], stroke:'#ffd54f', strokeWidth:1.5, lineJoin:'round', dash:[4,3] });
        this._dynCTLine  = new Konva.Line({ points:[], stroke:'#4fc3f7', strokeWidth:1.8, lineJoin:'round' });
        this._dynErrLine = new Konva.Line({ points:[], stroke:'#ef5350', strokeWidth:1.2, lineJoin:'round' });

        const lgX=dx+6, lgY=dy+14;
        [['#ffd54f','θ_TX（给定）'],['#4fc3f7','θ_CT（实际）'],['#ef5350','Δθ（误差）']].forEach(([col,lbl],i) => {
            this.group.add(new Konva.Line({ points:[lgX,lgY+i*9+3,lgX+10,lgY+i*9+3], stroke:col, strokeWidth:1.8 }));
            this.group.add(new Konva.Text({ x:lgX+12,y:lgY+i*9-1,text:lbl,fontSize:7,fill:col }));
        });
        this.group.add(this._dynTXLine, this._dynCTLine, this._dynErrLine);
        this._dynOX=ox; this._dynOY=oy; this._dynAW=aw; this._dynAH=ah;
    }

    // ── LCD 仪表 ─────────────────────────────
    _drawLCDPanel() {
        const { _lcdX: lx, _lcdY: ly, _lcdW: lw, _lcdH: lh } = this;

        this.group.add(new Konva.Rect({ x:lx,y:ly,width:lw,height:lh,fill:'#020c14',stroke:'#1a3040',strokeWidth:1.5,cornerRadius:4 }));
        this.group.add(new Konva.Rect({ x:lx,y:ly,width:lw,height:13,fill:'#0a1a28',cornerRadius:[4,4,0,0] }));
        this.group.add(new Konva.Text({ x:lx+4,y:ly+2,width:lw-8,text:'运行仪表',fontSize:8,fontStyle:'bold',fill:'#80cbc4',align:'center' }));

        const cells=[
            { label:'θ_TX（给定）', id:'theta_tx', unit:'°',  color:'#ffd54f' },
            { label:'θ_CT（实际）', id:'theta_ct', unit:'°',  color:'#4fc3f7' },
            { label:'Δθ=TX-CT',    id:'delta',    unit:'°',  color:'#ef5350' },
            { label:'e_out（峰值）',id:'eout',     unit:'V',  color:'#ef9a9a' },
            { label:'e_out（有效）',id:'eoutrms',  unit:'V',  color:'#ffa726' },
            { label:'V_DC（PSD）', id:'vdc',      unit:'V',  color:'#ffd54f' },
            { label:'误差相位',    id:'ephase',   unit:'',   color:'#80cbc4' },
            { label:'CT角速度',   id:'omega',    unit:'°/s',color:'#66bb6a' },
            { label:'随动状态',   id:'state',    unit:'',   color:'#ce93d8' },
            { label:'系统增益',   id:'gain',     unit:'',   color:'#4fc3f7' },
            { label:'阻尼系数',   id:'damp',     unit:'',   color:'#80cbc4' },
            { label:'频率',       id:'freq',     unit:'Hz', color:'#546e7a' },
        ];

        const cellW=(lw-8)/3, cellH=22, gap=2;
        this._lcdCells={};
        cells.forEach(({ label, id, unit, color }, i) => {
            const col=i%3, row=Math.floor(i/3);
            const cx3=lx+4+col*(cellW+gap), cy3=ly+16+row*(cellH+gap);
            this.group.add(new Konva.Rect({ x:cx3,y:cy3,width:cellW,height:cellH,fill:'#0d1520',cornerRadius:2 }));
            this.group.add(new Konva.Text({ x:cx3+2,y:cy3+2,text:label,fontSize:6.5,fill:'#37474f' }));
            const val=new Konva.Text({ x:cx3+2,y:cy3+9,width:cellW-4,text:'--',fontSize:9,fontFamily:'Courier New, monospace',fontStyle:'bold',fill:color,align:'right' });
            this.group.add(new Konva.Text({ x:cx3+2,y:cy3+14,width:cellW-4,text:unit,fontSize:6,fill:'#1a252f',align:'right' }));
            this._lcdCells[id]=val;
            this.group.add(val);
        });
    }

    // ── 控制面板 ─────────────────────────────
    _drawControlPanel() {
        const { _panX: px, _panY: py, _panW: pw, _panH: ph } = this;

        this.group.add(new Konva.Rect({ x:px,y:py,width:pw,height:ph,fill:'#0d1520',stroke:'#1a3040',strokeWidth:1.5,cornerRadius:4 }));
        this.group.add(new Konva.Rect({ x:px,y:py,width:pw,height:13,fill:'#0a1a28',cornerRadius:[4,4,0,0] }));
        this.group.add(new Konva.Text({ x:px+4,y:py+2,width:pw-8,text:'随动系统控制',fontSize:8,fontStyle:'bold',fill:'#80cbc4',align:'center' }));

        const bW=(pw-16)/4, bH=18, bY=py+16;
        [['▶ 随动使能','#1a3a1a','#2e7d32','#66bb6a',()=>this.enableServo()],
         ['■ 随动禁能','#3a1a1a','#c62828','#ef5350',()=>this.disableServo()],
         ['◎ 复位CT', '#1a1a0a','#f57f17','#ffd54f',()=>this.resetCT()],
         ['↺ TX自动', '#0a1a3a','#1565c0','#64b5f6',()=>this.toggleTxAuto()],
        ].forEach(([lbl,fill,stroke,col,cb],i) => {
            const bx=px+4+i*(bW+3);
            const btn=new Konva.Rect({ x:bx,y:bY,width:bW,height:bH,fill,stroke,strokeWidth:1.5,cornerRadius:3 });
            const t  =new Konva.Text({ x:bx,y:bY+4,width:bW,text:lbl,fontSize:9,fontStyle:'bold',fill:col,align:'center' });
            btn.on('click tap',cb);
            btn.on('mouseenter',()=>btn.opacity(0.75));
            btn.on('mouseleave',()=>btn.opacity(1));
            this.group.add(btn,t);
        });

        const sliders=[
            { label:`发送机角度 θ_TX（0°~360°）`, key:'tx',   color:'#ffd54f',
              getR:()=>this._txAngle/360,
              set:r=>{ this._txAngle=r*360; this._txAngleRad=this._txAngle*Math.PI/180; },
              disp:()=>`${this._txAngle.toFixed(1)}°` },
            { label:`CT手动角度 θ_CT（随动禁能时有效）`, key:'ct', color:'#4fc3f7',
              getR:()=>this._ctAngle/360,
              set:r=>{ if (!this._servoEnabled){ this._ctAngle=r*360; this._ctAngleRad=this._ctAngle*Math.PI/180; } },
              disp:()=>`${this._ctAngle.toFixed(1)}°` },
            { label:`系统增益 K（当前 ${this.servoGain}）`, key:'gain', color:'#66bb6a',
              getR:()=>this.servoGain/10,
              set:r=>{ this.servoGain=r*10; },
              disp:()=>`${this.servoGain.toFixed(2)}` },
            { label:`阻尼系数 ζ（当前 ${this.servoDamp}）`, key:'damp', color:'#80cbc4',
              getR:()=>this.servoDamp/2,
              set:r=>{ this.servoDamp=r*2; },
              disp:()=>`${this.servoDamp.toFixed(2)}` },
        ];

        const slW=(pw-16)/2-32;
        this._sliderBars={};
        sliders.forEach(({ label, key, color, getR, set, disp }, si) => {
            const col=si%2, row=Math.floor(si/2);
            const slX=px+4+col*(slW+46), slY=py+42+row*26;
            this.group.add(new Konva.Text({ x:slX,y:slY-11,text:label,fontSize:7,fill:'#546e7a' }));
            this.group.add(new Konva.Rect({ x:slX,y:slY,width:slW,height:8,fill:'#0a0a18',cornerRadius:2 }));
            const bar=new Konva.Rect({ x:slX,y:slY,width:0,height:8,fill:color,cornerRadius:2 });
            const txt=new Konva.Text({ x:slX+slW+4,y:slY-2,width:44,text:'--',fontSize:8,fontFamily:'Courier New, monospace',fill:color });
            const hit=new Konva.Rect({ x:slX,y:slY-2,width:slW,height:12,fill:'transparent' });
            hit.on('click tap mousedown', e => {
                const stage=this.group.getStage?.();
                const pos=stage?.getPointerPosition?.()??{ x:e.evt?.clientX??0 };
                set(Math.max(0,Math.min(1,(pos.x-(this.group.x?.()??0)-slX)/slW)));
            });
            this.group.add(bar,txt,hit);
            this._sliderBars[key]={ bar, txt, slW, getR, disp };
        });
    }

    // ── 波形区 ─────────────────────────────
    _drawWaveform() {
        const { _wavX: wx, _wavY: wy, _wavW: ww, _wavH: wh } = this;
        if (wh<14) return;

        this.group.add(new Konva.Rect({ x:wx,y:wy,width:ww,height:wh,fill:'#010d18',stroke:'#1a3040',strokeWidth:1.5,cornerRadius:4 }));
        this.group.add(new Konva.Rect({ x:wx,y:wy,width:ww,height:12,fill:'#0a1a28',cornerRadius:[4,4,0,0] }));
        this.group.add(new Konva.Text({ x:wx+4,y:wy+1,width:ww-8,text:'定子输入 e_S1   误差输出 e_out（调幅波）   PSD直流 V_DC   角差 Δθ',fontSize:8,fill:'#80cbc4',align:'center' }));

        const nCh=4, hCh=(wh-12)/nCh;
        this._wavMids=Array.from({length:nCh},(_,i)=>wy+12+hCh*(i+0.5));
        this._wavMids.forEach(my=>this.group.add(new Konva.Line({ points:[wx+2,my,wx+ww-2,my],stroke:'rgba(200,200,200,0.06)',strokeWidth:0.5,dash:[4,3] })));

        this._wLES1 =new Konva.Line({ points:[],stroke:'#e53935',strokeWidth:1.5,lineJoin:'round' });
        this._wLEout=new Konva.Line({ points:[],stroke:'#ef9a9a',strokeWidth:1.8,lineJoin:'round' });
        this._wLVDC =new Konva.Line({ points:[],stroke:'#ffd54f',strokeWidth:1.8,lineJoin:'round' });
        this._wLDelta=new Konva.Line({ points:[],stroke:'#4fc3f7',strokeWidth:1.5,lineJoin:'round' });

        ['e_S1（定子输入）','e_out（误差调幅波）','V_DC（PSD解调）','Δθ（角差）'].forEach((l,i) => {
            this.group.add(new Konva.Text({ x:wx+4,y:wy+12+hCh*i+3,text:l,fontSize:8,fill:['#e53935','#ef9a9a','#ffd54f','#4fc3f7'][i] }));
        });
        this.group.add(this._wLES1,this._wLEout,this._wLVDC,this._wLDelta);
        this._wavHCh=hCh;
    }

    // ═══════════════════════════════════════════
    _startAnimation() {
        const tick=ts=>{
            if (this._lastTs!==null){
                const dt=Math.min((ts-this._lastTs)/1000, 0.04);
                this._tickPhysics(dt);
                this._tickRotorViz();
                this._tickFieldViz(dt);
                this._tickPhasor();
                this._tickErrCurvePoint();
                this._tickPSD();
                this._tickDynamicTrace();
                this._tickWaveform();
                this._tickDisplay();
            }
            this._lastTs=ts;
            this._refreshCache();
            this._animId=requestAnimationFrame(tick);
        };
        this._animId=requestAnimationFrame(tick);
    }
    _stopAnimation(){ if(this._animId){ cancelAnimationFrame(this._animId); this._animId=null; } }

    // ── 物理量计算 ────────────────────────────
    _tickPhysics(dt) {
        const omega = 2*Math.PI*this.ratedFreq;
        this._wavePhase += omega*dt;
        this._animPhase += dt*3;

        // TX 自动旋转
        if (this._txAutoRotate) {
            this._txAngle += this._txAutoOmega * dt * 180/Math.PI;
            this._txAngle  = ((this._txAngle % 360)+360) % 360;
            this._txAngleRad = this._txAngle * Math.PI/180;
        }

        // ── 定子输入（来自发送机的三相电压）──
        const U_m     = this.ratedVoltage * Math.sqrt(2);
        const K       = this.voltageRatio;
        const phiR    = Math.atan2(2*Math.PI*this.ratedFreq*this.L_stator, this.R_stator);
        const ampFact = Math.sin(this._wavePhase - phiR);  // 载波

        const theta_TX = this._txAngleRad;
        this._eS1in = K*U_m * Math.cos(theta_TX)              * ampFact;
        this._eS2in = K*U_m * Math.cos(theta_TX - 2*Math.PI/3)* ampFact;
        this._eS3in = K*U_m * Math.cos(theta_TX + 2*Math.PI/3)* ampFact;

        // ── 气隙合成磁场 ──
        // 由三相定子电流产生，方向 = θ_TX，幅值 ∝ 励磁幅值
        this._phiAngle = theta_TX - Math.PI/2;  // 磁场相对于 S1 轴的偏角（S1轴朝上=π/2）
        const phiMag   = K * Math.abs(ampFact);
        this._phiSx    = phiMag * Math.cos(theta_TX);
        this._phiSy    = phiMag * Math.sin(theta_TX);

        // ── 随动系统（使能时） ──
        if (this._servoEnabled) {
            // 误差角度 Δθ = θ_TX - θ_CT
            const dTheta = theta_TX - this._ctAngleRad;
            // 误差信号有效值
            const eOutPeak = K * this.ratedVoltage * Math.abs(Math.sin(dTheta));
            // PSD 直流输出（含方向信息）
            const v_DC_raw = K * this.ratedVoltage / Math.sqrt(2) * Math.sin(dTheta);

            // 随动电机驱动（二阶系统仿真）
            // 控制器：比例 + 积分（PID 简化）
            const Kp = this.servoGain * 2 * this.servoDamp;
            const Ki = this.servoGain * this.servoGain;
            this._piIntg  += v_DC_raw * Ki * dt;
            this._piIntg   = Math.max(-50, Math.min(50, this._piIntg));
            const ctrlOut  = Kp * v_DC_raw + this._piIntg;

            // 电机力矩 → 角加速度
            const torque   = this.Kt_servo * this.Kamp * ctrlOut;
            const alpha    = (torque - this.B_servo*this._ctOmega) / this.J_servo;
            this._ctOmega += alpha * dt;
            this._ctOmega  = Math.max(-50, Math.min(50, this._ctOmega));  // 限速
            this._ctAngleRad += this._ctOmega * dt;
            this._ctAngle  = this._ctAngleRad * 180/Math.PI;
            this._ctAngle  = ((this._ctAngle % 360)+360) % 360;
            this._ctAngleRad = this._ctAngle * Math.PI/180;
        } else {
            this._ctOmega = 0;
        }

        // ── 转子输出电压（误差信号）──
        const dTheta   = this._txAngleRad - this._ctAngleRad;
        const eOutPk   = K * U_m * Math.sin(dTheta);
        // 误差信号：幅值 = K×U_m×sin(Δθ)，载波 = sin(ωt)，含相位误差
        const phShift  = this.phaseShift * Math.PI/180;
        this.e_out     = eOutPk * Math.sin(this._wavePhase - phiR + phShift)
                       + this.nullVoltage * Math.sin(this._wavePhase*2);
        this.e_outRMS  = Math.abs(K * this.ratedVoltage / Math.sqrt(2) * Math.sin(dTheta));
        this.v_DC      = K * this.ratedVoltage / Math.sqrt(2) * Math.sin(dTheta) * 0.90; // PSD 效率约 90%
        this.deltaTheta= dTheta * 180/Math.PI;

        // ── 波形缓冲 ──
        this._wavES1   = new Float32Array([...this._wavES1.slice(1),  this._eS1in]);
        this._wavEout  = new Float32Array([...this._wavEout.slice(1), this.e_out]);
        this._wavVDC   = new Float32Array([...this._wavVDC.slice(1),  this.v_DC]);
        this._wavDelta = new Float32Array([...this._wavDelta.slice(1),this.deltaTheta]);

        // ── 跟踪曲线缓冲 ──
        this._trackTX  = new Float32Array([...this._trackTX.slice(1), this._txAngle]);
        this._trackCT  = new Float32Array([...this._trackCT.slice(1), this._ctAngle]);
        this._trackErr = new Float32Array([...this._trackErr.slice(1),
                          ((this._txAngle-this._ctAngle+540)%360-180)]);
        this._trackVDC = new Float32Array([...this._trackVDC.slice(1), this.v_DC]);
    }

    // ── 转子旋转动画 ─────────────────────────
    _tickRotorViz() {
        // 接收机转子旋转（θ_CT）
        if (this._rotorGroup) {
            this._rotorGroup.rotation(this._ctAngleRad * 180/Math.PI);
        }
        // 气隙磁场方向箭头随 θ_TX 更新
        if (this._fieldArrow) {
            const ecx=this._synCX, ecy=this._synCY;
            const R  =this._airGapR*0.82;
            const a  = Math.PI/2 - this._txAngleRad; // 与 S1 轴（上方）的夹角
            this._fieldArrow.points([ecx,ecy, ecx+R*Math.cos(a), ecy-R*Math.sin(a)]);
        }
        // 定子绕组亮度（随定子电流变化）
        this._statorDots?.forEach(({ dot, dotB }, i) => {
            const eVals = [this._eS1in, this._eS2in, this._eS3in];
            const ePk   = this.voltageRatio * this.ratedVoltage * Math.sqrt(2);
            const alpha = Math.max(0.1, Math.min(0.95, 0.4 + 0.55*Math.abs(eVals[i])/(ePk+1e-9)));
            dot.opacity(alpha);
            dotB.opacity(alpha*0.4);
        });
    }

    // ── 气隙磁场粒子动画 ─────────────────────
    _tickFieldViz(dt) {
        this._fieldGroup.destroyChildren();
        const mag = Math.abs(Math.sin(this._wavePhase));
        if (mag < 0.02) return;

        const ecx=this._synCX, ecy=this._synCY;
        const r0=this._rotorR*0.88, r1=this._sInner*0.95;
        const fieldA = Math.PI/2 - this._txAngleRad; // 磁场方向（S1轴朝上）

        // 磁力线（随气隙磁场方向，橙色）
        for (let i = -3; i <= 3; i++) {
            const spread = i/3 * Math.PI*0.30;
            const a = fieldA + spread;
            const alpha = Math.max(0.04, (0.40-Math.abs(spread)*0.5)*mag);
            const col = spread<0?`rgba(255,167,38,${alpha})`:`rgba(100,181,246,${alpha})`;
            this._fieldGroup.add(new Konva.Line({
                points:[ecx+r0*Math.cos(a),ecy+r0*Math.sin(a),
                        ecx+r1*Math.cos(a),ecy+r1*Math.sin(a)],
                stroke:col, strokeWidth:1.5, lineCap:'round',
            }));
        }

        // 磁通粒子
        for (let i = 0; i < 8; i++) {
            const t = ((this._animPhase*0.05+i/8) % 1+1) % 1;
            const r = r0 + t*(r1-r0);
            const aOff = (Math.random()-0.5)*0.25;
            this._fieldGroup.add(new Konva.Circle({
                x: ecx+r*Math.cos(fieldA+aOff),
                y: ecy+r*Math.sin(fieldA+aOff),
                radius: 2+mag*2,
                fill: `rgba(255,213,79,${0.2+mag*0.35})`,
            }));
        }
    }

    // ── 相量图更新 ────────────────────────────
    _tickPhasor() {
        if (!this._phaPhi_S) return;
        const R=this._phR, ocx=this._phOCX, ocy=this._phOCY;
        const K=this.voltageRatio;

        // Φ_S 方向（= θ_TX，从零轴顺时针）
        const phiAngle = Math.PI/2 - this._txAngleRad;
        this._phaPhi_S.points([ocx,ocy, ocx+R*Math.cos(phiAngle), ocy-R*Math.sin(phiAngle)]);

        // 转子轴线（R轴）方向 = θ_CT + 90°（零位时垂直于Φ_S）
        const rAxisAngle = Math.PI/2 - (this._ctAngleRad + Math.PI/2);
        this._phaR_axis.points([ocx,ocy, ocx+R*Math.cos(rAxisAngle), ocy-R*Math.sin(rAxisAngle)]);

        // e_out 相量（Φ_S 在 R 轴上的投影，乘以 sin(Δθ)）
        const dTheta = this._txAngleRad - this._ctAngleRad;
        const eOutMag = R * Math.abs(Math.sin(dTheta));
        const eOutDir = rAxisAngle + (Math.sin(dTheta) >= 0 ? 0 : Math.PI);
        this._phaEout.points([ocx,ocy, ocx+eOutMag*Math.cos(eOutDir), ocy-eOutMag*Math.sin(eOutDir)]);

        // 功角弧
        if (this._phaArc) {
            const arcStart = -(phiAngle)*180/Math.PI - 90;
            this._phaArc.rotation(arcStart);
            this._phaArc.angle(Math.abs(dTheta)*180/Math.PI);
        }
        if (this._phaAngleLabel) {
            const dDeg=dTheta*180/Math.PI;
            this._phaAngleLabel.text(`Δθ=${dDeg.toFixed(1)}°`);
            this._phaAngleLabel.fill(Math.abs(dDeg)>30?'#ffa726':'#ffd54f');
        }
    }

    // ── 误差曲线工作点 ───────────────────────
    _tickErrCurvePoint() {
        if (!this._errCrvPoint) return;
        const dDeg = ((this._txAngle - this._ctAngle + 540) % 360) - 180;
        const x = this._errCOX + (dDeg+180)/360*this._errCAW;
        const y = this._errCOY - Math.sin(dDeg*Math.PI/180)*(this._errCAH-3);
        this._errCrvPoint.x(Math.max(this._errCOX,Math.min(this._errCOX+this._errCAW,x)));
        this._errCrvPoint.y(Math.max(this._errCOY-this._errCAH+2,Math.min(this._errCOY+this._errCAH-2,y)));
        this._errCrvPoint.fill(Math.abs(dDeg)>30?'#ffa726':Math.abs(dDeg)>5?'#ef9a9a':'#66bb6a');
    }

    // ── PSD 直流输出显示 ─────────────────────
    _tickPSD() {
        if (!this._psdDCLine) return;
        const wx=this._psdWX, ww=this._psdWW, wh=this._psdWH;
        const vMax = this.voltageRatio * this.ratedVoltage / Math.sqrt(2);
        const dcY  = this._psdDCY + wh/2 - (this.v_DC/vMax)*wh*0.40;
        this._psdDCLine.points([wx, dcY, wx+ww, dcY]);
        this._psdDCLine.stroke(this.v_DC>=0?'#ffd54f':'#90caf9');
        this._psdDCLabel?.text(`V_DC=${this.v_DC.toFixed(3)}V`);
        this._psdDCLabel?.fill(this.v_DC>=0?'#ffd54f':'#90caf9');
    }

    // ── 动态跟踪曲线 ─────────────────────────
    _tickDynamicTrace() {
        if (!this._dynTXLine) return;
        const n=this._trackLen, aw=this._dynAW, ah=this._dynAH;
        const ox=this._dynOX, oy=this._dynOY;
        const dx=aw/n;

        const maxAng = 360;
        const ptTX=[], ptCT=[], ptErr=[];
        for (let i=0;i<n;i++) {
            const x=ox+i*dx;
            ptTX.push(x, oy-(this._trackTX[i]/maxAng)*(ah-4));
            ptCT.push(x, oy-(this._trackCT[i]/maxAng)*(ah-4));
            const err=Math.max(-180,Math.min(180,this._trackErr[i]));
            ptErr.push(x, oy-(err/180)*(ah/2-2));
        }
        this._dynTXLine.points(ptTX);
        this._dynCTLine.points(ptCT);
        this._dynErrLine.points(ptErr);
    }

    // ── 波形更新 ─────────────────────────────
    _tickWaveform() {
        if (!this._wavHCh||!this._wavMids) return;
        const wx=this._wavX+3, ww=this._wavW-6, n=this._wavLen;
        const dx=ww/n, hCh=this._wavHCh;
        const [mS1,mEout,mVDC,mDelta]=this._wavMids;

        const ePk  = this.voltageRatio*this.ratedVoltage*Math.sqrt(2);
        const vMax = this.voltageRatio*this.ratedVoltage/Math.sqrt(2);
        const dMax = 180;

        const ptS1=[], ptEout=[], ptVDC=[], ptDelta=[];
        for (let i=0;i<n;i++) {
            const x=wx+i*dx;
            ptS1.push(x,   mS1   -(this._wavES1[i]  /ePk)*hCh*0.38);
            ptEout.push(x, mEout -(this._wavEout[i]  /ePk)*hCh*0.38);
            ptVDC.push(x,  mVDC  -(this._wavVDC[i]  /(vMax+1e-9))*hCh*0.38);
            ptDelta.push(x,mDelta-(Math.max(-dMax,Math.min(dMax,this._wavDelta[i]))/dMax)*hCh*0.36);
        }
        this._wLES1.points(ptS1);
        this._wLEout.points(ptEout);
        this._wLVDC.points(ptVDC);
        this._wLDelta.points(ptDelta);
    }

    // ── 仪表更新 ─────────────────────────────
    _tickDisplay() {
        const c=this._lcdCells;
        if (!c) return;

        const dDeg = ((this._txAngle-this._ctAngle+540)%360)-180;
        const errPhase = this.v_DC >= 0 ? '同相（正偏差）' : '反相（负偏差）';
        const ctOmegaDeg = this._ctOmega * 180/Math.PI;

        if (c.theta_tx) c.theta_tx.text(this._txAngle.toFixed(2));
        if (c.theta_ct) c.theta_ct.text(this._ctAngle.toFixed(2));
        if (c.delta) {
            c.delta.text(dDeg.toFixed(2));
            c.delta.fill(Math.abs(dDeg)>30?'#ffa726':Math.abs(dDeg)>5?'#ef5350':'#66bb6a');
        }
        if (c.eout)    c.eout.text((this.voltageRatio*this.ratedVoltage*Math.sqrt(2)*Math.abs(Math.sin(dDeg*Math.PI/180))).toFixed(3));
        if (c.eoutrms) c.eoutrms.text(this.e_outRMS.toFixed(3));
        if (c.vdc) {
            c.vdc.text(this.v_DC.toFixed(3));
            c.vdc.fill(Math.abs(this.v_DC)<0.01?'#66bb6a':this.v_DC>0?'#ffd54f':'#90caf9');
        }
        if (c.ephase)  c.ephase.text(errPhase);
        if (c.omega)   c.omega.text(ctOmegaDeg.toFixed(1));
        if (c.state) {
            const atNull = Math.abs(dDeg)<0.5;
            c.state.text(this._servoEnabled?(atNull?'✓ 已锁定':'追踪中…'):'手动模式');
            c.state.fill(this._servoEnabled?(atNull?'#66bb6a':'#ffa726'):'#546e7a');
        }
        if (c.gain)    c.gain.text(this.servoGain.toFixed(2));
        if (c.damp)    c.damp.text(this.servoDamp.toFixed(2));
        if (c.freq)    c.freq.text(this.ratedFreq.toString());

        // 框图动态标注
        const eOutPkDisp=(this.voltageRatio*this.ratedVoltage*Math.sqrt(2)*Math.abs(Math.sin(dDeg*Math.PI/180))).toFixed(2);
        this._blkErrLabel?.text(`e_out=${eOutPkDisp}V  V_DC=${this.v_DC.toFixed(3)}V`);
        const stateStr=this._servoEnabled?`追踪中 Δθ=${dDeg.toFixed(1)}°`:'随动禁能';
        this._blkStateLabel?.text(`状态：${stateStr}`);
        this._blkStateLabel?.fill(this._servoEnabled?(Math.abs(dDeg)<0.5?'#66bb6a':'#ffa726'):'#546e7a');

        if (this._sliderBars) {
            Object.values(this._sliderBars).forEach(({ bar, txt, slW, getR, disp }) => {
                bar.width(Math.min(slW,Math.max(0,getR())*slW));
                txt.text(disp());
            });
        }
    }

    // ═══════════════════════════════════════════
    enableServo() {
        this._servoEnabled = true;
        this._piIntg = 0;
        this._refreshCache();
    }

    disableServo() {
        this._servoEnabled = false;
        this._ctOmega      = 0;
        this._refreshCache();
    }

    resetCT() {
        this.disableServo();
        this._ctAngle    = 0;
        this._ctAngleRad = 0;
        this._ctOmega    = 0;
        this._piIntg     = 0;
        this._refreshCache();
    }

    toggleTxAuto() {
        this._txAutoRotate = !this._txAutoRotate;
        if (!this._txAutoOmega) this._txAutoOmega = 10 * Math.PI/180; // 10°/s
        this._refreshCache();
    }

    setTxAngle(deg) {
        this._txAngle    = ((deg%360)+360)%360;
        this._txAngleRad = this._txAngle * Math.PI/180;
        this._refreshCache();
    }

    setCtAngle(deg) {
        if (!this._servoEnabled) {
            this._ctAngle    = ((deg%360)+360)%360;
            this._ctAngleRad = this._ctAngle * Math.PI/180;
        }
        this._refreshCache();
    }

    setServoGain(k)  { this.servoGain  = Math.max(0.1, k); this._refreshCache(); }
    setServoDamp(z)  { this.servoDamp  = Math.max(0.1, Math.min(2, z)); this._refreshCache(); }

    getTxAngle()     { return this._txAngle; }
    getCtAngle()     { return this._ctAngle; }
    getError()       { return this.deltaTheta; }
    getVDC()         { return this.v_DC; }
    isLocked()       { return Math.abs(this.deltaTheta) < 0.5; }

    update(cfg={}) {
        if (cfg.txAngle !== undefined) this.setTxAngle(cfg.txAngle);
        if (cfg.ctAngle !== undefined) this.setCtAngle(cfg.ctAngle);
        if (cfg.gain    !== undefined) this.setServoGain(cfg.gain);
        if (cfg.damp    !== undefined) this.setServoDamp(cfg.damp);
        this._refreshCache();
    }

    getConfigFields() {
        return [
            { label:'位号/名称',            key:'id',              type:'text'   },
            { label:'系统励磁电压 (V)',      key:'ratedVoltage',    type:'number' },
            { label:'额定频率 (Hz)',         key:'ratedFreq',       type:'number' },
            { label:'定子输入电压 (V)',      key:'inputVoltage',    type:'number' },
            { label:'转子输出电压 (V)',      key:'outputVoltage',   type:'number' },
            { label:'定子绕组电阻 (Ω)',     key:'R_stator',        type:'number' },
            { label:'转子绕组电阻 (Ω)',     key:'R_rotor',         type:'number' },
            { label:'电气误差 (arcmin)',     key:'electricalError', type:'number' },
            { label:'零位残压 (mV)',         key:'nullVoltage',     type:'number' },
            { label:'随动系统增益',         key:'servoGain',       type:'number' },
            { label:'阻尼系数 ζ',           key:'servoDamp',       type:'number' },
            { label:'随动电机 Kt (N·m/A)',  key:'Kt_servo',        type:'number' },
            { label:'初始 θ_TX (°)',        key:'initTxAngle',     type:'number' },
            { label:'初始 θ_CT (°)',        key:'initCtAngle',     type:'number' },
        ];
    }

    onConfigUpdate(cfg) {
        const n = k => parseFloat(cfg[k]);
        this.id              = cfg.id              || this.id;
        if (cfg.ratedVoltage)   this.ratedVoltage  = n('ratedVoltage');
        if (cfg.ratedFreq)      this.ratedFreq     = n('ratedFreq');
        if (cfg.inputVoltage)   this.inputVoltage  = n('inputVoltage');
        if (cfg.outputVoltage)  this.outputVoltage = n('outputVoltage');
        if (cfg.R_stator)       this.R_stator      = n('R_stator');
        if (cfg.R_rotor)        this.R_rotor       = n('R_rotor');
        if (cfg.electricalError)this.electricalError=n('electricalError');
        if (cfg.nullVoltage)    this.nullVoltage   = n('nullVoltage')*1e-3;
        if (cfg.servoGain)      this.servoGain     = n('servoGain');
        if (cfg.servoDamp)      this.servoDamp     = n('servoDamp');
        if (cfg.Kt_servo)       this.Kt_servo      = n('Kt_servo');
        if (cfg.initTxAngle !== undefined) this.setTxAngle(n('initTxAngle'));
        if (cfg.initCtAngle !== undefined) this.setCtAngle(n('initCtAngle'));
        this.voltageRatio    = this.inputVoltage / this.ratedVoltage;
        this.Z_rotor         = Math.sqrt(this.R_rotor**2+(2*Math.PI*this.ratedFreq*this.L_rotor)**2);
        this.config          = { ...this.config, ...cfg };
        this._refreshCache();
    }

    destroy() { this._stopAnimation(); super.destroy?.(); }
}