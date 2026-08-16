import { BaseComponent } from './BaseComponent.js';

/**
 * 力矩式自整角机接收机仿真组件
 * （Torque Synchro Receiver，TR）
 *
 * ── 与控制式接收机（CT）的核心区别 ────────────────────────────
 *
 *  ┌──────────────┬──────────────────────────┬────────────────────────────┐
 *  │              │ 控制式接收机（CT/CX-TR）  │ 力矩式接收机（TR）          │
 *  ├──────────────┼──────────────────────────┼────────────────────────────┤
 *  │ 工作原理     │ 输出误差电压→伺服放大    │ 直接产生同步转矩驱动负载   │
 *  │ 转子励磁     │ 无（转子绕组输出信号）   │ 有（R1/R2 通入励磁电压）   │
 *  │ 输出         │ 单相误差电压 e_out       │ 轴转矩 T（直接机械驱动）   │
 *  │ 负载能力     │ 极小（仅信号输出）       │ 较大（直接带动轻载指针）   │
 *  │ 精度         │ 高（伺服闭环）           │ 较低（开环，有弹性误差）   │
 *  │ 功率放大     │ 必须（外接伺服放大器）   │ 不需要（自整步）           │
 *  │ 典型应用     │ 雷达/炮兵伺服随动系统    │ 仪表板指针/罗经指示器      │
 *  └──────────────┴──────────────────────────┴────────────────────────────┘
 *
 * ── 力矩式自整角机工作原理 ────────────────────────────────────
 *
 *  力矩式系统由"力矩式发送机（TX）"+"力矩式接收机（TR）"成对工作：
 *
 *  1. 整体工作机制（自整步）：
 *     TX 转子（通励磁）→ TX 定子产生三相感应电动势
 *     → 三相导线连接 TR 定子（S1-S1，S2-S2，S3-S3）
 *     → TR 定子电流产生气隙合成磁场（方向 = θ_TX）
 *     → TR 转子（也通励磁）的磁极受气隙合成磁场吸引
 *     → 若 θ_TR ≠ θ_TX，产生同步转矩 T_sync
 *     → T_sync 使 TR 转子转动，直至 θ_TR = θ_TX（对准）
 *
 *  2. TR 转子励磁（与 TX 转子励磁相同电压/频率）：
 *     TR 转子绕组（R1/R2）通入与 TX 相同的单相励磁电压：
 *       u_R = U_m × sin(ωt)
 *     TR 转子励磁产生转子磁场 Φ_R，在气隙中与 Φ_S 相互作用
 *
 *  3. 同步转矩方程（对准力矩）：
 *     T_sync = -K_s × sin(θ_TX - θ_TR)
 *     其中 K_s 为同步力矩系数（N·m/rad），取决于：
 *       K_s = (3/2) × (M²/Z_s) × (U_m/2)² × (1/ω)
 *       M：互感（H），Z_s：定子阻抗（Ω），U_m：励磁电压峰值
 *     小角度近似（|θ_TX - θ_TR| < 30°）：
 *       T_sync ≈ -K_s × (θ_TX - θ_TR)（线性弹簧特性）
 *
 *  4. 误差角与弹性滞后（静态误差）：
 *     TR 带载时，负载转矩 T_load 与同步转矩平衡：
 *       T_load = K_s × sin(θ_err)
 *       θ_err = arcsin(T_load / K_s)（静态误差角）
 *     系统要求：K_s >> T_load（同步力矩应远大于负载转矩）
 *     过载时：T_load > K_s → 失步（步退），TR 转子停止跟随
 *
 *  5. 阻尼问题（振荡与阻尼）：
 *     无阻尼时，TR 转子到达对准位置后会产生振荡（弹簧-质量系统）
 *     自然频率：f_n = (1/2π) × √(K_s/J)
 *     阻尼方式：
 *       ① 机械阻尼器（摩擦式、流体式）
 *       ② 电磁阻尼（TR 定子阻尼绕组）
 *       ③ 阻尼变压器（DT）：附加阻尼绕组，对速度信号产生阻尼力矩
 *     阻尼比：ζ = B/(2√(K_s×J))
 *     欠阻尼（ζ<1）：振荡超调；过阻尼（ζ>1）：响应慢；临界阻尼（ζ=1）：最快无超调
 *
 *  6. 精度限制因素：
 *     ① 同步力矩系数 K_s 不足（定子电流小）
 *     ② 定子绕组不平衡（三相阻抗不一致）
 *     ③ 转子励磁不足（励磁电压偏低）
 *     ④ 磁路饱和（铁芯工作在饱和区）
 *     ⑤ 机械摩擦（集电环摩擦力矩）
 *
 *  7. 典型应用：
 *     舰船罗经重复器（Compass Repeater）
 *     飞机仪表板（油量计、燃油流量计）
 *     工业转速/位置指示器
 *     炮兵方位角指示
 *
 * ── 与发送机的区别（接线与励磁）────────────────────────────
 *  TX：R1/R2 通励磁；S1/S2/S3 输出（定子输出）
 *  TR：R1/R2 通励磁（与 TX 相同电压）；S1/S2/S3 输入（来自 TX 定子）
 *  ★ TR 是唯一同时有励磁绕组（R1/R2）和定子输入（S1/S2/S3）的自整角机
 *  ★ TR 转子靠同步转矩自驱动，无需外部伺服放大器
 *
 * ── 组件结构 ──────────────────────────────────────────────────
 *  ① TR 横截面图（定子三相输入 + 转子励磁绕组 + 气隙磁场合成 + 转子动态旋转）
 *  ② 力矩-角度特性曲线（T_sync vs Δθ，-180°~+180°，正弦曲线+线性区+失步区）
 *  ③ 定子三相合成磁场动画（Φ_S 方向随 θ_TX 变化，气隙磁力线粒子流）
 *  ④ 相量图（Φ_S 气隙合成磁场 + Φ_R 转子励磁磁场 + 合力矩方向）
 *  ⑤ 动态响应曲线（θ_TR 跟踪 θ_TX 过程：欠阻尼振荡/临界/过阻尼）
 *  ⑥ 转矩分解图（同步转矩 T_sync + 阻尼转矩 T_damp + 负载转矩 T_load）
 *  ⑦ 阻尼分析面板（阻尼比 ζ，振荡包络，稳定时间 t_s）
 *  ⑧ 失步检测（|Δθ| > arcsin(T_load/K_s) 时红色警告动画）
 *  ⑨ LCD 仪表（θ_TX/θ_TR/Δθ/T_sync/T_damp/K_s/稳态误差/振荡次数/励磁/频率）
 *  ⑩ 控制面板（θ_TX 设定/TR 阻尼系数/负载转矩/励磁电压/阶跃响应触发）
 *
 * ── 端口 ─────────────────────────────────────────────────────
 *  excit_r1   — 励磁 R1（+，与 TX 同电压）
 *  excit_r2   — 励磁 R2（-）
 *  stator_s1  — 定子输入 S1（来自 TX.S1）
 *  stator_s2  — 定子输入 S2（来自 TX.S2）
 *  stator_s3  — 定子输入 S3（来自 TX.S3）
 *  shaft      — 输出轴（驱动指针/负载）
 */
export class TorqueSynchroReceiver extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.width  = Math.max(580, config.width  || 740);
        this.height = Math.max(440, config.height || 580);

        this.type    = 'torque_synchro_receiver';
        this.special = 'none';
        this.cache   = 'fixed';

        // ── 额定参数 ──
        this.ratedVoltage  = config.ratedVoltage  || 115;    // V（励磁电压）
        this.ratedFreq     = config.ratedFreq     || 400;    // Hz
        this.ratedCurrent  = config.ratedCurrent  || 0.15;   // A（励磁额定电流）
        this.voltageRatio  = config.voltageRatio  || 0.78;   // 变压比

        // ── 电气参数 ──
        this.R_rotor  = config.R_rotor  || 180;    // Ω（转子电阻）
        this.L_rotor  = config.L_rotor  || 0.45;   // H（转子电感）
        this.R_stator = config.R_stator || 220;    // Ω（每相定子电阻）
        this.L_stator = config.L_stator || 0.32;   // H（每相定子电感）
        this.Lm       = config.Lm       || 2.4;    // H（互感）

        this.Z_rotor  = Math.sqrt(this.R_rotor**2 + (2*Math.PI*this.ratedFreq*this.L_rotor)**2);
        this.cosPhi_r = this.R_rotor / this.Z_rotor;

        // ── 力矩参数 ──
        // 同步力矩系数 K_s（N·m/rad）
        this.Ks         = config.Ks         || 0.12;   // N·m/rad
        // 最大同步转矩（Δθ=90°时）
        this.T_max      = config.T_max      || this.Ks; // N·m
        // 阻尼系数 B（N·m·s/rad）
        this.B_damp     = config.B_damp     || 0.008;  // N·m·s/rad
        // 转动惯量（转子+指针）
        this.J          = config.J          || 4e-5;   // kg·m²
        // 集电环摩擦力矩
        this.T_friction = config.T_friction || 0.002;  // N·m

        // 自然角频率与阻尼比
        this.omega_n    = Math.sqrt(this.Ks / this.J);              // rad/s
        this.zeta       = this.B_damp / (2 * Math.sqrt(this.Ks * this.J)); // 阻尼比
        this.freq_n     = this.omega_n / (2 * Math.PI);             // Hz

        // ── 运行状态 ──
        this._wavePhase   = 0;
        this._animPhase   = 0;

        // 发送机角度（输入）
        this._txAngle     = config.initTxAngle || 60.0;
        this._txAngleRad  = this._txAngle * Math.PI / 180;
        this._txAutoRotate= false;
        this._txAutoOmega = 15 * Math.PI / 180;  // rad/s

        // 接收机转子（状态变量）
        this._trAngle     = config.initTrAngle || 0.0;   // °
        this._trAngleRad  = this._trAngle * Math.PI / 180;
        this._trOmega     = 0;    // rad/s（TR 转子角速度）
        this._trAlpha     = 0;    // rad/s²（TR 转子角加速度）

        // 励磁设定
        this._excitVolt   = this.ratedVoltage;

        // 负载转矩
        this._loadTorque  = config.initLoad || 0.005; // N·m

        // 实时力矩
        this.T_sync    = 0;   // 同步转矩
        this.T_damp    = 0;   // 阻尼转矩
        this.T_net     = 0;   // 合力矩
        this.deltaTheta= 0;   // 角差（°）

        // 励磁量
        this.u_R       = 0;   // 励磁瞬时电压
        this.i_R       = 0;   // 励磁瞬时电流
        this.phi_m     = 0;   // 主磁通（标幺）

        // 失步状态
        this._outOfStep   = false;
        this._outOfStepCnt= 0;

        // 振荡计数（用于分析）
        this._oscillations= 0;
        this._lastOmegaSign= 0;
        this._settleTime   = 0;
        this._settled      = false;

        // 阶跃响应记录
        this._stepActive  = false;
        this._stepStartT  = 0;
        this._stepTheta   = 0;

        // ── 波形/跟踪缓冲 ──
        this._wavLen    = 320;
        this._wavUR     = new Float32Array(this._wavLen).fill(0);
        this._wavSync   = new Float32Array(this._wavLen).fill(0);
        this._wavDamp   = new Float32Array(this._wavLen).fill(0);
        this._wavDelta  = new Float32Array(this._wavLen).fill(0);

        this._trackLen  = 400;
        this._trackTX   = new Float32Array(this._trackLen).fill(0);
        this._trackTR   = new Float32Array(this._trackLen).fill(0);
        this._trackOmega= new Float32Array(this._trackLen).fill(0);
        this._trackT    = new Float32Array(this._trackLen).fill(0);

        // ── 几何布局 ──
        // TR 截面（左上）
        this._synX  = Math.round(this.width * 0.02);
        this._synY  = Math.round(this.height * 0.04);
        this._synW  = Math.round(this.width * 0.26);
        this._synH  = Math.round(this.height * 0.46);
        this._synCX = this._synX + this._synW / 2;
        this._synCY = this._synY + this._synH / 2;

        // 力矩-角度特性（中上左）
        this._taCX  = Math.round(this.width * 0.30);
        this._taCY  = this._synY;
        this._taCW  = Math.round(this.width * 0.22);
        this._taCH  = Math.round(this.height * 0.24);

        // 阻尼分析（中上右）
        this._dampX = this._taCX + this._taCW + 8;
        this._dampY = this._synY;
        this._dampW = Math.round(this.width * 0.22);
        this._dampH = this._taCH;

        // 相量图（右上）
        this._phX   = this._dampX + this._dampW + 8;
        this._phY   = this._synY;
        this._phW   = this.width - this._phX - Math.round(this.width * 0.02);
        this._phH   = this._taCH;

        // 动态响应曲线（中中，宽幅）
        this._dynX  = this._taCX;
        this._dynY  = this._taCY + this._taCH + 8;
        this._dynW  = this._taCW + this._dampW + 8;
        this._dynH  = Math.round(this.height * 0.26);

        // 转矩分解（右中）
        this._tdX   = this._phX;
        this._tdY   = this._dynY;
        this._tdW   = this._phW;
        this._tdH   = this._dynH;

        // LCD（左下）
        this._lcdX  = this._synX;
        this._lcdY  = this._synY + this._synH + 8;
        this._lcdW  = this._synW;
        this._lcdH  = Math.round(this.height * 0.24);

        // 控制面板（中下）
        this._panX  = this._taCX;
        this._panY  = this._dynY + this._dynH + 8;
        this._panW  = this.width - this._taCX - Math.round(this.width * 0.02);
        this._panH  = Math.round(this.height * 0.14);

        // 波形（底部全宽）
        this._wavX  = this._synX;
        this._wavY  = Math.max(this._lcdY + this._lcdH, this._panY + this._panH) + 6;
        this._wavW  = this.width - this._synX * 2;
        this._wavH  = this.height - this._wavY - 6;


        this.config = {
            id: this.id,
            ratedVoltage: this.ratedVoltage,
            ratedFreq: this.ratedFreq,
            Ks: this.Ks,
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
        this.addPort(this._synCX, this._synY + this._synH + 6, 'shaft', 'pipe', '指针轴');
    }

    // ═══════════════════════════════════════════
    _init() {
        this._drawLabel();
        this._drawTRSection();
        this._drawFieldLayer();
        this._drawRotorLayer();
        this._drawTorqueAngleCurve();
        this._drawDampingPanel();
        this._drawPhasorDiagram();
        this._drawDynamicResponse();
        this._drawTorqueDecomp();
        this._drawLCDPanel();
        this._drawControlPanel();
        this._drawWaveform();
        
    }

    _drawLabel() {
        this.group.add(new Konva.Text({
            x: 0, y: -22, width: this.width,
            text: `力矩式自整角机接收机（TR）  励磁 ${this.ratedVoltage}V/${this.ratedFreq}Hz  ` +
                  `K_s=${this.Ks}N·m/rad  ζ=${this.zeta.toFixed(3)}  f_n=${this.freq_n.toFixed(1)}Hz  直接力矩驱动`,
            fontSize: 10, fontStyle: 'bold', fill: '#1a2634', align: 'center',
        }));
    }

    // ── TR 横截面 ────────────────────────────
    _drawTRSection() {
        const { _synX: ex, _synY: ey, _synW: ew, _synH: eh,
                _synCX: ecx, _synCY: ecy } = this;

        this.group.add(new Konva.Rect({
            x: ex, y: ey, width: ew, height: eh,
            fill: '#0d1a24', stroke: '#1a3040', strokeWidth: 1.5, cornerRadius: 5,
        }));
        this.group.add(new Konva.Text({
            x: ex, y: ey - 14, width: ew,
            text: `TR 力矩式接收机截面（转子通励磁）`, fontSize: 9, fontStyle: 'bold',
            fill: '#546e7a', align: 'center',
        }));

        // ── 机座 ──
        const frameR = Math.round(Math.min(ew, eh) * 0.46);
        this.group.add(new Konva.Circle({ x: ecx, y: ecy, radius: frameR, fill: '#1c2b38', stroke: '#37474f', strokeWidth: 3 }));

        // ── 定子铁芯（叠片环）──
        const sOuter = Math.round(frameR * 0.90);
        const sInner = Math.round(frameR * 0.56);
        this.group.add(new Konva.Ring({ x: ecx, y: ecy, innerRadius: sInner, outerRadius: sOuter, fill: '#455a64', stroke: '#263238', strokeWidth: 1 }));
        for (let i = 0; i < 36; i++) {
            const a = (i / 36) * Math.PI * 2;
            this.group.add(new Konva.Line({
                points: [ecx+sInner*Math.cos(a), ecy+sInner*Math.sin(a),
                         ecx+sOuter*Math.cos(a), ecy+sOuter*Math.sin(a)],
                stroke: 'rgba(0,0,0,0.12)', strokeWidth: 0.5,
            }));
        }

        // ── 定子三相输入绕组（S1/S2/S3，与 CX-TR 相同） ──
        const statorAxes  = [Math.PI/2, Math.PI/2 + 2*Math.PI/3, Math.PI/2 + 4*Math.PI/3];
        const statorColors= ['#e53935', '#43a047', '#1e88e5'];
        const wR = sInner + (sOuter - sInner) * 0.45;
        const wW = 5;
        this._statorDots = [];
        statorAxes.forEach((a, i) => {
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
            this._statorDots.push({ dot, dotB });
            this.group.add(dot, dotB);
            this.group.add(new Konva.Text({
                x: ecx+(sInner+(sOuter-sInner)*0.72)*Math.cos(a)-6,
                y: ecy+(sInner+(sOuter-sInner)*0.72)*Math.sin(a)-6,
                text: ['S1','S2','S3'][i], fontSize: 8, fill: statorColors[i], fontStyle: 'bold',
            }));
        });

        // ── 气隙 ──
        this._airGapR = Math.round(sInner * 0.97);
        this.group.add(new Konva.Circle({ x: ecx, y: ecy, radius: this._airGapR, fill: '#05101a', stroke: '#1a3040', strokeWidth: 0.5 }));

        // ── 转子（凸极，含励磁绕组+极靴）──
        const rotorR = Math.round(this._airGapR * 0.82);
        this.group.add(new Konva.Circle({ x: ecx, y: ecy, radius: rotorR, fill: '#2e3f4f', stroke: '#37474f', strokeWidth: 1.2 }));
        for (let p = 0; p < 2; p++) {
            this.group.add(new Konva.Arc({ x: ecx, y: ecy, innerRadius: rotorR*0.72, outerRadius: rotorR*0.95, angle: 90, rotation: p*180-45, fill: '#455a64', stroke: '#263238', strokeWidth: 1 }));
        }
        this._rotorR  = rotorR;
        this._sInner  = sInner;
        this._sOuter  = sOuter;
        this._frameR  = frameR;

        // 转子励磁绕组（橙铜色线圈，★TR 区别于 CT 的关键结构）
        this._rotorGroup = new Konva.Group({ x: ecx, y: ecy });
        for (let i = 0; i < 10; i++) {
            const a  = (i / 10) * Math.PI * 2;
            const ri = rotorR * 0.35, ro = rotorR * 0.65;
            this._rotorGroup.add(new Konva.Line({
                points: [ri*Math.cos(a), ri*Math.sin(a), ro*Math.cos(a), ro*Math.sin(a)],
                stroke: ['#c87832','#e09040','#d08838'][i%3], strokeWidth: 2, lineCap: 'round', opacity: 0.85,
            }));
        }
        this._rotorGroup.add(new Konva.Circle({ radius: 7, fill: '#1a252f', stroke: '#37474f', strokeWidth: 1.5 }));
        this._rotorRef = new Konva.Circle({ x: rotorR*0.60, y: 0, radius: 3.5, fill: '#ffd54f' });
        this._rotorGroup.add(this._rotorRef);
        // d 轴（极轴）
        this._rotorGroup.add(new Konva.Line({ points: [-rotorR*0.92,0,rotorR*0.92,0], stroke:'#ffd54f',strokeWidth:1,dash:[4,3],opacity:0.55 }));
        this._rotorGroup.add(new Konva.Text({ x: rotorR*0.92+2, y: -5, text: 'd', fontSize: 7, fill: '#ffd54f', opacity: 0.7 }));
        this.group.add(this._rotorGroup);

        // 集电环（TR 需要集电环引入转子励磁）
        this.group.add(new Konva.Ring({ x: ecx, y: ecy, innerRadius: rotorR*0.26, outerRadius: rotorR*0.37, fill: 'rgba(200,120,50,0.28)', stroke: '#a06020', strokeWidth: 0.8 }));
        this.group.add(new Konva.Text({ x: ecx - 18, y: ecy - rotorR*0.37 - 12, text: '集电环（励磁引入）', fontSize: 7, fill: '#c87832' }));

        // ── 端子 ──
        // 励磁端子（左侧，R1/R2）
        const excX = ex - 10;
        [['R1','#ef9a9a',-20],['R2','#90caf9',20]].forEach(([l,c,dy]) => {
            this.group.add(new Konva.Line({ points:[excX,ecy+dy,ex+8,ecy+dy], stroke:c, strokeWidth:2 }));
            this.group.add(new Konva.Circle({ x:excX, y:ecy+dy, radius:3.5, fill:c }));
            this.group.add(new Konva.Text({ x:ex-26, y:ecy+dy-5, text:l, fontSize:8, fill:c, fontStyle:'bold' }));
        });
        // 励磁标注（★ 力矩式 TR 特征）
        this.group.add(new Konva.Text({ x:ex-28, y:ecy+32, width:24, text:'励磁↑\n同TX', fontSize:6.5, fill:'#c87832', lineHeight:1.3, align:'center' }));

        // 定子输入端子（右侧，S1/S2/S3）
        const inX = ex + ew + 10;
        [['S1','#e53935',-28],['S2','#43a047',0],['S3','#1e88e5',28]].forEach(([l,c,dy]) => {
            this.group.add(new Konva.Line({ points:[ecx+sOuter*0.65,ecy+dy,inX,ecy+dy], stroke:c, strokeWidth:2 }));
            this.group.add(new Konva.Circle({ x:inX, y:ecy+dy, radius:3.5, fill:c }));
            this.group.add(new Konva.Text({ x:inX+5, y:ecy+dy-6, text:l, fontSize:9, fill:c, fontStyle:'bold' }));
        });

        // 输出轴（底部，驱动指针）
        this.group.add(new Konva.Rect({ x:ecx-6, y:ey+eh, width:12, height:14, fill:'#66bb6a', stroke:'#2e7d32', strokeWidth:1.5 }));
        this.group.add(new Konva.Text({ x:ecx-18, y:ey+eh+15, text:'指针/负载', fontSize:7, fill:'#66bb6a' }));

        // 失步警告层（覆盖，初始隐藏）
        this._outOfStepOverlay = new Konva.Rect({ x:ex+2, y:ey+2, width:ew-4, height:eh-4, fill:'rgba(198,40,40,0)', cornerRadius:4 });
        this._outOfStepLabel   = new Konva.Text({ x:ex, y:ey+eh*0.35, width:ew, text:'', fontSize:14, fontStyle:'bold', fill:'#ffeb3b', align:'center' });
        this.group.add(this._outOfStepOverlay, this._outOfStepLabel);

        // 接线说明
        this.group.add(new Konva.Rect({ x:ex+3, y:ey+eh-30, width:ew-6, height:26, fill:'#0a1520', stroke:'#1a3040', strokeWidth:0.8, cornerRadius:2 }));
        this.group.add(new Konva.Text({ x:ex+5, y:ey+eh-28, text:'★ TR 特征：R1/R2 通励磁\n定子 S1/S2/S3 接 TX 输出', fontSize:7, fill:'#ffa726', lineHeight:1.4 }));
    }

    // ── 气隙磁场动画层 ──────────────────────
    _drawFieldLayer() {
        this._fieldGroup = new Konva.Group();
        // 气隙合成磁场方向箭头（Φ_S，随 θ_TX 旋转）
        this._fieldArrow = new Konva.Arrow({
            points: [this._synCX, this._synCY, this._synCX + this._airGapR*0.82, this._synCY],
            stroke: '#ffa726', fill: '#ffa726', strokeWidth: 2.5, pointerLength: 8, pointerWidth: 7, opacity: 0.75,
        });
        this.group.add(this._fieldGroup, this._fieldArrow);
    }

    // ── 转子励磁磁场指示（Φ_R，随 θ_TR 旋转）──
    _drawRotorLayer() {
        this._rotorFieldArrow = new Konva.Arrow({
            points: [this._synCX, this._synCY, this._synCX + this._airGapR*0.62, this._synCY],
            stroke: '#80cbc4', fill: '#80cbc4', strokeWidth: 2, pointerLength: 6, pointerWidth: 5, opacity: 0.7,
        });
        this.group.add(this._rotorFieldArrow);
    }

    // ── 力矩-角度特性曲线 ───────────────────
    _drawTorqueAngleCurve() {
        const { _taCX: tx, _taCY: ty, _taCW: tw, _taCH: th } = this;

        this.group.add(new Konva.Rect({ x:tx,y:ty,width:tw,height:th,fill:'#010d18',stroke:'#1a3040',strokeWidth:1.5,cornerRadius:4 }));
        this.group.add(new Konva.Rect({ x:tx,y:ty,width:tw,height:13,fill:'#0a1a28',cornerRadius:[4,4,0,0] }));
        this.group.add(new Konva.Text({ x:tx+4,y:ty+2,width:tw-8,text:'力矩-角度特性 T = Ks·sin(Δθ)',fontSize:8,fontStyle:'bold',fill:'#80cbc4',align:'center' }));

        const ox=tx+14, oy=ty+th*0.56, aw=tw-20, ah=th*0.38;
        this.group.add(new Konva.Line({ points:[ox,oy-ah,ox,oy+ah*0.6,ox,oy,ox+aw,oy], stroke:'#37474f', strokeWidth:0.8 }));
        this.group.add(new Konva.Text({ x:ox-13,y:oy-ah,text:'T(N·m)',fontSize:6.5,fill:'#80cbc4' }));
        this.group.add(new Konva.Text({ x:ox+aw+2,y:oy+2,text:'Δθ',fontSize:6.5,fill:'#80cbc4' }));

        // 刻度
        [[-180,-1],[-90,-0.5],[0,0],[90,0.5],[180,1]].forEach(([d,xr]) => {
            const x2=ox+(d+180)/360*aw;
            this.group.add(new Konva.Line({ points:[x2,oy-3,x2,oy+3],stroke:'#37474f',strokeWidth:0.7 }));
            this.group.add(new Konva.Text({ x:x2-8,y:oy+5,text:`${d}°`,fontSize:5.5,fill:'#37474f',width:16,align:'center' }));
        });

        // T = Ks×sin(Δθ) 正弦曲线
        const sinPts = [];
        for (let d = -180; d <= 180; d += 2) {
            sinPts.push(ox+(d+180)/360*aw, oy - Math.sin(d*Math.PI/180)*(ah-3));
        }
        this.group.add(new Konva.Line({ points:sinPts, stroke:'#66bb6a', strokeWidth:2, lineJoin:'round', opacity:0.8 }));

        // ±90° 稳定极限竖线
        [90,-90].forEach(d => {
            const x2=ox+(d+180)/360*aw;
            this.group.add(new Konva.Line({ points:[x2,ty+14,x2,oy+ah*0.4],stroke:'#ef5350',strokeWidth:0.8,dash:[3,3] }));
            this.group.add(new Konva.Text({ x:x2-4,y:oy+ah*0.4+2,text:`${d>0?'+':''}${d}°`,fontSize:6,fill:'#ef5350' }));
        });

        // 失步区（|Δθ|>90°）填色
        const x90p=ox+(90+180)/360*aw, x90n=ox+(-90+180)/360*aw;
        this.group.add(new Konva.Rect({ x:x90p,y:oy-ah,width:ox+aw-x90p,height:ah*2,fill:'rgba(239,83,80,0.08)' }));
        this.group.add(new Konva.Rect({ x:ox,y:oy-ah,width:x90n-ox,height:ah*2,fill:'rgba(239,83,80,0.08)' }));
        this.group.add(new Konva.Text({ x:x90p+2,y:ty+16,text:'失步\n区',fontSize:6.5,fill:'#ef5350',lineHeight:1.3 }));

        // 线性区（±30°，蓝色标注）
        const x30p=ox+(30+180)/360*aw, x30n=ox+(-30+180)/360*aw;
        this.group.add(new Konva.Rect({ x:x30n,y:oy-ah,width:x30p-x30n,height:ah*2,fill:'rgba(102,187,106,0.07)' }));
        this.group.add(new Konva.Text({ x:x30n+2,y:ty+16,text:'线性\n工作区',fontSize:5.5,fill:'#66bb6a',lineHeight:1.3 }));

        // 负载线（水平虚线）
        this._taLoadLine   = new Konva.Line({ points:[ox,oy,ox+aw,oy], stroke:'#ffa726', strokeWidth:1, dash:[4,3], opacity:0.7 });
        this._taWorkPoint  = new Konva.Circle({ x:ox+(180)/360*aw, y:oy, radius:5, fill:'#ffd54f', stroke:'#f9a825', strokeWidth:1.5 });
        // 静态误差角标注
        this._taErrLabel   = new Konva.Text({ x:ox+(180)/360*aw+6, y:oy-16, text:'θ_err=0°', fontSize:7.5, fill:'#ffa726' });
        this.group.add(this._taLoadLine, this._taWorkPoint, this._taErrLabel);
        this._taOX=ox; this._taOY=oy; this._taAW=aw; this._taAH=ah;
    }

    // ── 阻尼分析面板 ─────────────────────────
    _drawDampingPanel() {
        const { _dampX: dx, _dampY: dy, _dampW: dw, _dampH: dh } = this;

        this.group.add(new Konva.Rect({ x:dx,y:dy,width:dw,height:dh,fill:'#010d18',stroke:'#1a3040',strokeWidth:1.5,cornerRadius:4 }));
        this.group.add(new Konva.Rect({ x:dx,y:dy,width:dw,height:13,fill:'#0a1a28',cornerRadius:[4,4,0,0] }));
        this.group.add(new Konva.Text({ x:dx+4,y:dy+2,width:dw-8,text:'阻尼特性分析',fontSize:8,fontStyle:'bold',fill:'#80cbc4',align:'center' }));

        // 阻尼比量表（半圆）
        const gcx=dx+dw*0.38, gcy=dy+dh*0.58;
        const gR =Math.round(Math.min(dw,dh)*0.23);
        // 颜色区域：欠阻尼/临界/过阻尼
        this.group.add(new Konva.Arc({ x:gcx,y:gcy,innerRadius:gR-6,outerRadius:gR+6,angle:90,rotation:-180,fill:'rgba(79,195,247,0.20)',stroke:'#4fc3f7',strokeWidth:0.7 }));
        this.group.add(new Konva.Arc({ x:gcx,y:gcy,innerRadius:gR-6,outerRadius:gR+6,angle:30,rotation:-90,fill:'rgba(102,187,106,0.25)',stroke:'#66bb6a',strokeWidth:0.7 }));
        this.group.add(new Konva.Arc({ x:gcx,y:gcy,innerRadius:gR-6,outerRadius:gR+6,angle:60,rotation:-60,fill:'rgba(255,167,38,0.20)',stroke:'#ffa726',strokeWidth:0.7 }));
        // 标注
        this.group.add(new Konva.Text({ x:gcx-gR-10,y:gcy-4,text:'欠阻尼\nζ<1',fontSize:6,fill:'#4fc3f7',lineHeight:1.3 }));
        this.group.add(new Konva.Text({ x:gcx+gR+3, y:gcy-4,text:'过阻尼\nζ>1',fontSize:6,fill:'#ffa726',lineHeight:1.3 }));
        this.group.add(new Konva.Text({ x:gcx-6,    y:gcy-gR-12,text:'ζ=1\n临界',fontSize:6,fill:'#66bb6a',lineHeight:1.3 }));

        // 阻尼比指针
        this._dampNeedle = new Konva.Line({ points:[gcx,gcy,gcx-gR*0.85,gcy], stroke:'#ffd54f', strokeWidth:2, lineCap:'round' });
        this._dampZetaLabel = new Konva.Text({ x:gcx-12,y:gcy+gR+4,text:'ζ=0.00',fontSize:9,fontStyle:'bold',fill:'#ffd54f',width:24,align:'center' });
        this.group.add(this._dampNeedle, this._dampZetaLabel);
        this._dampGCX=gcx; this._dampGCY=gcy; this._dampGR=gR;

        // 参数表格
        const tX=dx+dw*0.60, tY=dy+18;
        const params=[
            {lbl:'f_n',val:`${this.freq_n.toFixed(1)}Hz`,col:'#4fc3f7'},
            {lbl:'T_n',val:`${(1/this.freq_n).toFixed(3)}s`,col:'#80cbc4'},
            {lbl:'K_s',val:`${this.Ks}`,col:'#66bb6a'},
            {lbl:'J',  val:`${(this.J*1e5).toFixed(1)}×10⁻⁵`,col:'#ffa726'},
        ];
        this._dampParamLabels={};
        params.forEach(({ lbl, val, col }, i) => {
            this.group.add(new Konva.Text({ x:tX,y:tY+i*18+2,text:lbl+':',fontSize:7.5,fill:'#546e7a' }));
            const v=new Konva.Text({ x:tX+22,y:tY+i*18+2,text:val,fontSize:7.5,fill:col,fontFamily:'Courier New, monospace' });
            this._dampParamLabels[lbl]=v;
            this.group.add(v);
        });

        // 稳定时间 t_s
        this._dampTsLabel= new Konva.Text({ x:dx+6,y:dy+dh-20,text:'t_s=--  振荡: --次',fontSize:8,fill:'#80cbc4',fontFamily:'Courier New, monospace' });
        this.group.add(this._dampTsLabel);
    }

    // ── 相量图 ───────────────────────────────
    _drawPhasorDiagram() {
        const { _phX: px, _phY: py, _phW: pw, _phH: ph } = this;

        this.group.add(new Konva.Rect({ x:px,y:py,width:pw,height:ph,fill:'#010d18',stroke:'#1a3040',strokeWidth:1.5,cornerRadius:4 }));
        this.group.add(new Konva.Rect({ x:px,y:py,width:pw,height:13,fill:'#0a1a28',cornerRadius:[4,4,0,0] }));
        this.group.add(new Konva.Text({ x:px+4,y:py+2,width:pw-8,text:'相量图（Φ_S × Φ_R = 力矩）',fontSize:8,fontStyle:'bold',fill:'#80cbc4',align:'center' }));

        const ocx=px+pw*0.50, ocy=py+ph*0.60;
        const R  =Math.min(pw,ph)*0.30;

        this.group.add(new Konva.Line({ points:[px+6,ocy,px+pw-6,ocy],stroke:'#1a3040',strokeWidth:0.7 }));
        this.group.add(new Konva.Line({ points:[ocx,py+14,ocx,py+ph-6],stroke:'#1a3040',strokeWidth:0.7 }));
        this.group.add(new Konva.Circle({ x:ocx,y:ocy,radius:R,fill:'rgba(0,0,0,0)',stroke:'#1a3040',strokeWidth:0.6,dash:[3,3] }));

        // Φ_S（定子合成磁场 = θ_TX 方向，橙色）
        this._phiS = new Konva.Arrow({ points:[ocx,ocy,ocx+R,ocy], stroke:'#ffa726',fill:'#ffa726',strokeWidth:2.5,pointerLength:7,pointerWidth:6 });
        // Φ_R（转子励磁磁场 = θ_TR 方向，青色）
        this._phiR = new Konva.Arrow({ points:[ocx,ocy,ocx,ocy-R], stroke:'#80cbc4',fill:'#80cbc4',strokeWidth:2,pointerLength:6,pointerWidth:5 });
        // 力矩方向指示（Φ_S × Φ_R 叉积方向，绿色弧形）
        this._torqueArc = new Konva.Arc({ x:ocx,y:ocy,innerRadius:R*0.22,outerRadius:R*0.26,angle:0,rotation:0,fill:'#66bb6a',opacity:0.85 });
        // 角差弧
        this._deltaArc  = new Konva.Arc({ x:ocx,y:ocy,innerRadius:R*0.35,outerRadius:R*0.38,angle:0,rotation:0,fill:'#ffd54f',opacity:0.75 });
        this._deltaLabel= new Konva.Text({ x:ocx+R*0.42,y:ocy-14,text:'Δθ=0°',fontSize:8,fontStyle:'bold',fill:'#ffd54f' });

        const lgX=px+6,lgY=py+14;
        [['#ffa726','Φ_S（θ_TX，定子合成磁场）'],
         ['#80cbc4','Φ_R（θ_TR，转子励磁磁场）'],
         ['#66bb6a','T_sync 方向（Φ_S×Φ_R）']].forEach(([col,lbl],i) => {
            this.group.add(new Konva.Line({ points:[lgX,lgY+i*9+3,lgX+10,lgY+i*9+3],stroke:col,strokeWidth:1.8 }));
            this.group.add(new Konva.Text({ x:lgX+12,y:lgY+i*9-1,text:lbl,fontSize:7,fill:col }));
        });

        this._phOCX=ocx; this._phOCY=ocy; this._phR=R;
        this.group.add(this._torqueArc,this._deltaArc,this._phiS,this._phiR,this._deltaLabel);
    }

    // ── 动态响应曲线 ─────────────────────────
    _drawDynamicResponse() {
        const { _dynX: dx, _dynY: dy, _dynW: dw, _dynH: dh } = this;

        this.group.add(new Konva.Rect({ x:dx,y:dy,width:dw,height:dh,fill:'#010d18',stroke:'#1a3040',strokeWidth:1.5,cornerRadius:4 }));
        this.group.add(new Konva.Rect({ x:dx,y:dy,width:dw,height:13,fill:'#0a1a28',cornerRadius:[4,4,0,0] }));
        this.group.add(new Konva.Text({ x:dx+4,y:dy+2,width:dw-8,text:'动态跟踪响应曲线（角度 + 角速度）',fontSize:8,fontStyle:'bold',fill:'#80cbc4',align:'center' }));

        const ox=dx+12, oy=dy+dh-12, aw=dw-18, ah=dh-26;
        this.group.add(new Konva.Line({ points:[ox,oy-ah,ox,oy,ox+aw,oy],stroke:'#37474f',strokeWidth:0.8 }));
        this.group.add(new Konva.Text({ x:ox-12,y:oy-ah,text:'θ(°)',fontSize:7,fill:'#80cbc4' }));
        this.group.add(new Konva.Text({ x:ox+aw+2,y:oy+2,text:'t',fontSize:7,fill:'#80cbc4' }));

        // 零线
        this.group.add(new Konva.Line({ points:[ox,oy-ah/2,ox+aw,oy-ah/2],stroke:'#37474f',strokeWidth:0.5,dash:[2,4] }));

        this._dynTXLine = new Konva.Line({ points:[],stroke:'#ffd54f',strokeWidth:1.5,lineJoin:'round',dash:[4,3] });
        this._dynTRLine = new Konva.Line({ points:[],stroke:'#4fc3f7',strokeWidth:1.8,lineJoin:'round' });
        this._dynOmLine = new Konva.Line({ points:[],stroke:'#66bb6a',strokeWidth:1.2,lineJoin:'round',dash:[3,2] });

        const lgX=dx+6,lgY=dy+14;
        [['#ffd54f','θ_TX（给定）'],['#4fc3f7','θ_TR（响应）'],['#66bb6a','ω_TR（角速度）']].forEach(([col,lbl],i) => {
            this.group.add(new Konva.Line({ points:[lgX,lgY+i*9+3,lgX+10,lgY+i*9+3],stroke:col,strokeWidth:1.8 }));
            this.group.add(new Konva.Text({ x:lgX+12,y:lgY+i*9-1,text:lbl,fontSize:7,fill:col }));
        });
        this.group.add(this._dynTXLine,this._dynTRLine,this._dynOmLine);
        this._dynOX=ox; this._dynOY=oy; this._dynAW=aw; this._dynAH=ah;
    }

    // ── 转矩分解图 ───────────────────────────
    _drawTorqueDecomp() {
        const { _tdX: tx, _tdY: ty, _tdW: tw, _tdH: th } = this;

        this.group.add(new Konva.Rect({ x:tx,y:ty,width:tw,height:th,fill:'#010d18',stroke:'#1a3040',strokeWidth:1.5,cornerRadius:4 }));
        this.group.add(new Konva.Rect({ x:tx,y:ty,width:tw,height:13,fill:'#0a1a28',cornerRadius:[4,4,0,0] }));
        this.group.add(new Konva.Text({ x:tx+4,y:ty+2,width:tw-8,text:'实时转矩分解（T_sync + T_damp + T_load）',fontSize:8,fontStyle:'bold',fill:'#80cbc4',align:'center' }));

        const ox=tx+12, oy=ty+th*0.55, aw=tw-18, ah=th*0.38;
        this.group.add(new Konva.Line({ points:[ox,oy-ah,ox,oy+ah*0.5,ox,oy,ox+aw,oy],stroke:'#37474f',strokeWidth:0.8 }));
        this.group.add(new Konva.Text({ x:ox-13,y:oy-ah,text:'T(N·m)',fontSize:6.5,fill:'#80cbc4' }));
        this.group.add(new Konva.Text({ x:ox+aw+2,y:oy+2,text:'t',fontSize:6.5,fill:'#80cbc4' }));

        this._tdSyncLine = new Konva.Line({ points:[],stroke:'#66bb6a',strokeWidth:1.8,lineJoin:'round' });
        this._tdDampLine = new Konva.Line({ points:[],stroke:'#4fc3f7',strokeWidth:1.5,lineJoin:'round',dash:[4,2] });
        this._tdLoadLine = new Konva.Line({ points:[ox,oy,ox+aw,oy],stroke:'#ef5350',strokeWidth:1.2,dash:[3,3],opacity:0.6 });
        this._tdNetLine  = new Konva.Line({ points:[],stroke:'#ffd54f',strokeWidth:2,lineJoin:'round' });

        const lgX=tx+6,lgY=ty+14;
        [['#66bb6a','T_sync'],['#4fc3f7','T_damp'],['#ef5350','T_load'],['#ffd54f','T_net']].forEach(([col,lbl],i) => {
            this.group.add(new Konva.Line({ points:[lgX,lgY+i*9+3,lgX+10,lgY+i*9+3],stroke:col,strokeWidth:1.8 }));
            this.group.add(new Konva.Text({ x:lgX+12,y:lgY+i*9-1,text:lbl,fontSize:7,fill:col }));
        });
        this.group.add(this._tdSyncLine,this._tdDampLine,this._tdLoadLine,this._tdNetLine);
        this._tdOX=ox; this._tdOY=oy; this._tdAW=aw; this._tdAH=ah;
    }

    // ── LCD 仪表 ─────────────────────────────
    _drawLCDPanel() {
        const { _lcdX: lx, _lcdY: ly, _lcdW: lw, _lcdH: lh } = this;

        this.group.add(new Konva.Rect({ x:lx,y:ly,width:lw,height:lh,fill:'#020c14',stroke:'#1a3040',strokeWidth:1.5,cornerRadius:4 }));
        this.group.add(new Konva.Rect({ x:lx,y:ly,width:lw,height:13,fill:'#0a1a28',cornerRadius:[4,4,0,0] }));
        this.group.add(new Konva.Text({ x:lx+4,y:ly+2,width:lw-8,text:'运行仪表',fontSize:8,fontStyle:'bold',fill:'#80cbc4',align:'center' }));

        const cells=[
            { label:'θ_TX（给定）', id:'theta_tx', unit:'°',      color:'#ffd54f' },
            { label:'θ_TR（实际）', id:'theta_tr', unit:'°',      color:'#4fc3f7' },
            { label:'Δθ=TX-TR',    id:'delta',    unit:'°',      color:'#ef5350' },
            { label:'T_sync',      id:'tsync',    unit:'N·m',    color:'#66bb6a' },
            { label:'T_damp',      id:'tdamp',    unit:'N·m',    color:'#80cbc4' },
            { label:'T_net',       id:'tnet',     unit:'N·m',    color:'#ffd54f' },
            { label:'ω_TR',        id:'omega',    unit:'°/s',    color:'#4fc3f7' },
            { label:'K_s',         id:'ks',       unit:'N·m/rad',color:'#66bb6a' },
            { label:'阻尼比 ζ',   id:'zeta',     unit:'',       color:'#ffa726' },
            { label:'静态误差',    id:'sterr',    unit:'°',      color:'#ef9a9a' },
            { label:'失步状态',    id:'oos',      unit:'',       color:'#ef5350' },
            { label:'励磁电压',    id:'excit',    unit:'V',      color:'#ef9a9a' },
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
        this.group.add(new Konva.Text({ x:px+4,y:py+2,width:pw-8,text:'系统参数控制',fontSize:8,fontStyle:'bold',fill:'#80cbc4',align:'center' }));

        const bW=(pw-16)/4, bH=18, bY=py+16;
        [['↺ TX自动', '#0a1a3a','#1565c0','#64b5f6',()=>this.toggleTxAuto()],
         ['→|阶跃响应','#1a1a0a','#f57f17','#ffd54f',()=>this.triggerStep()],
         ['◉ TR复位', '#1a3a1a','#2e7d32','#66bb6a',()=>this.resetTR()],
         ['⚡ 励磁切换','#1a0a3a','#6a1b9a','#ce93d8',()=>this.toggleExcit()],
        ].forEach(([lbl,fill,stroke,col,cb],i) => {
            const bx=px+4+i*(bW+3);
            const btn=new Konva.Rect({ x:bx,y:bY,width:bW,height:bH,fill,stroke,strokeWidth:1.5,cornerRadius:3 });
            const t  =new Konva.Text({ x:bx,y:bY+4,width:bW,text:lbl,fontSize:8,fontStyle:'bold',fill:col,align:'center' });
            btn.on('click tap',cb);
            btn.on('mouseenter',()=>btn.opacity(0.75));
            btn.on('mouseleave',()=>btn.opacity(1));
            this.group.add(btn,t);
        });

        const sliders=[
            { label:`θ_TX 发送机角度（0°~360°）`, key:'tx', color:'#ffd54f',
              getR:()=>this._txAngle/360,
              set:r=>{ this._txAngle=r*360; this._txAngleRad=this._txAngle*Math.PI/180; },
              disp:()=>`${this._txAngle.toFixed(1)}°` },
            { label:`阻尼系数 B（当前 ${this.B_damp.toFixed(4)}N·m·s/r）`, key:'damp', color:'#4fc3f7',
              getR:()=>this.B_damp/0.08,
              set:r=>{ this.B_damp=r*0.08; this._updateZeta(); },
              disp:()=>`${this.B_damp.toFixed(5)}` },
            { label:`负载转矩 T_load（最大 ${this.Ks.toFixed(3)}N·m）`, key:'load', color:'#ef5350',
              getR:()=>this._loadTorque/this.Ks,
              set:r=>{ this._loadTorque=r*this.Ks; },
              disp:()=>`${this._loadTorque.toFixed(4)}N·m` },
            { label:`同步力矩系数 K_s（N·m/rad）`, key:'ks', color:'#66bb6a',
              getR:()=>this.Ks/0.5,
              set:r=>{ this.Ks=Math.max(0.01,r*0.5); this.T_max=this.Ks; this._updateZeta(); },
              disp:()=>`${this.Ks.toFixed(3)}` },
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
                const pos=stage?.getPointerPosition?.()??{x:e.evt?.clientX??0};
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
        this.group.add(new Konva.Text({ x:wx+4,y:wy+1,width:ww-8,text:'励磁 u_R   同步转矩 T_sync   阻尼转矩 T_damp   角差 Δθ（失步阈值±90°）',fontSize:8,fill:'#80cbc4',align:'center' }));

        const nCh=4, hCh=(wh-12)/nCh;
        this._wavMids=Array.from({length:nCh},(_,i)=>wy+12+hCh*(i+0.5));
        this._wavMids.forEach(my=>this.group.add(new Konva.Line({ points:[wx+2,my,wx+ww-2,my],stroke:'rgba(200,200,200,0.06)',strokeWidth:0.5,dash:[4,3] })));

        this._wLUR    =new Konva.Line({ points:[],stroke:'#ef9a9a',strokeWidth:1.5,lineJoin:'round' });
        this._wLSync  =new Konva.Line({ points:[],stroke:'#66bb6a',strokeWidth:1.8,lineJoin:'round' });
        this._wLDamp  =new Konva.Line({ points:[],stroke:'#4fc3f7',strokeWidth:1.5,lineJoin:'round',dash:[4,2] });
        this._wLDelta =new Konva.Line({ points:[],stroke:'#ffd54f',strokeWidth:1.5,lineJoin:'round' });

        ['励磁 u_R','T_sync','T_damp','Δθ（°）'].forEach((l,i) => {
            this.group.add(new Konva.Text({ x:wx+4,y:wy+12+hCh*i+3,text:l,fontSize:8,fill:['#ef9a9a','#66bb6a','#4fc3f7','#ffd54f'][i] }));
        });
        this.group.add(this._wLUR,this._wLSync,this._wLDamp,this._wLDelta);
        this._wavHCh=hCh;
    }

    // ═══════════════════════════════════════════
    // 集中化 tick（由 consys._tickAll 在 20fps 调用）
    tick(dt) {
        this._tickPhysics(dt);
        this._tickRotorViz();
        this._tickFieldViz(dt);
        this._tickPhasor();
        this._tickTorqueAnglePt();
        this._tickDampingPanel();
        this._tickDynamicTrace();
        this._tickTorqueDecomp();
        this._tickWaveform();
        this._tickDisplay();
        this._refreshCache();
    }

    // ── 物理仿真（同步转矩 + 阻尼 + 机械运动）──
    _tickPhysics(dt) {
        const omega_e = 2*Math.PI*this.ratedFreq;
        this._wavePhase += omega_e*dt;
        this._animPhase += dt*3;

        // TX 自动旋转
        if (this._txAutoRotate) {
            this._txAngle += this._txAutoOmega*dt*180/Math.PI;
            this._txAngle  = ((this._txAngle%360)+360)%360;
            this._txAngleRad = this._txAngle*Math.PI/180;
        }

        // 励磁电压（单相交流，TR 转子通励磁）
        const U_m  = this._excitVolt*Math.sqrt(2);
        const phiR = Math.atan2(2*Math.PI*this.ratedFreq*this.L_rotor, this.R_rotor);
        this.u_R   = U_m * Math.sin(this._wavePhase);
        this.i_R   = (U_m/this.Z_rotor)*Math.sin(this._wavePhase - phiR);
        this.phi_m = Math.sin(this._wavePhase - phiR); // 主磁通（标幺）

        // ── 同步力矩方程 ──
        const dTheta = this._txAngleRad - this._trAngleRad; // Δθ = θ_TX - θ_TR
        // 励磁幅值影响（励磁电压偏离额定时力矩按比例变化）
        const excitRatio = this._excitVolt / this.ratedVoltage;
        this.T_sync = this.Ks * Math.sin(dTheta) * excitRatio**2;

        // 阻尼转矩（反比于角速度）
        this.T_damp = -this.B_damp * this._trOmega;

        // 集电环摩擦（库仑摩擦，反比于速度方向）
        const T_fric = -Math.sign(this._trOmega) * this.T_friction;

        // 净转矩
        this.T_net = this.T_sync + this.T_damp + T_fric - this._loadTorque * Math.sign(dTheta);

        // 转子运动方程
        this._trAlpha = this.T_net / this.J;
        this._trOmega += this._trAlpha * dt;
        // 速度限制
        const omegaMax = 20*Math.PI; // rad/s（约 600 rpm）
        this._trOmega = Math.max(-omegaMax, Math.min(omegaMax, this._trOmega));
        this._trAngleRad += this._trOmega * dt;
        this._trAngle  = this._trAngleRad * 180/Math.PI;
        this._trAngle  = ((this._trAngle%360)+360)%360;
        this._trAngleRad = this._trAngle * Math.PI/180;

        // 角差（归一化至 -180°~+180°）
        let dDeg = (this._txAngle - this._trAngle + 540) % 360 - 180;
        this.deltaTheta = dDeg;

        // 失步检测（|Δθ| > arcsin(T_load/K_s)，保守取 90°）
        const pulloutAngle = Math.asin(Math.min(1, this._loadTorque / (this.Ks*excitRatio**2+1e-9))) * 180/Math.PI;
        this._outOfStep = Math.abs(dDeg) > 88;

        // 振荡计数（速度换向时计一次振荡半周期）
        const omegaSign = Math.sign(this._trOmega);
        if (omegaSign !== 0 && omegaSign !== this._lastOmegaSign && this._lastOmegaSign !== 0) {
            this._oscillations++;
        }
        this._lastOmegaSign = omegaSign;

        // 稳定检测（|Δθ| < 0.5° 且 |ω| < 0.01 rad/s 持续 0.5s）
        if (Math.abs(dDeg) < 0.5 && Math.abs(this._trOmega) < 0.01) {
            if (!this._settled) {
                this._settleTime += dt;
                if (this._settleTime > 0.5) this._settled = true;
            }
        } else {
            this._settled = false;
            this._settleTime = 0;
        }

        // 波形缓冲
        this._wavUR   = new Float32Array([...this._wavUR.slice(1),   this.u_R]);
        this._wavSync = new Float32Array([...this._wavSync.slice(1), this.T_sync]);
        this._wavDamp = new Float32Array([...this._wavDamp.slice(1), this.T_damp]);
        this._wavDelta= new Float32Array([...this._wavDelta.slice(1),this.deltaTheta]);

        // 跟踪曲线缓冲
        this._trackTX   = new Float32Array([...this._trackTX.slice(1),   this._txAngle]);
        this._trackTR   = new Float32Array([...this._trackTR.slice(1),   this._trAngle]);
        this._trackOmega= new Float32Array([...this._trackOmega.slice(1),this._trOmega*180/Math.PI]);
        this._trackT    = new Float32Array([...this._trackT.slice(1),    this.T_sync]);
    }

    // ── 转子旋转动画 ─────────────────────────
    _tickRotorViz() {
        if (this._rotorGroup) {
            this._rotorGroup.rotation(this._trAngleRad*180/Math.PI);
        }
        // Φ_S（气隙合成磁场方向 = θ_TX）
        if (this._fieldArrow) {
            const ecx=this._synCX, ecy=this._synCY;
            const R=this._airGapR*0.82;
            const a=Math.PI/2 - this._txAngleRad;
            this._fieldArrow.points([ecx,ecy, ecx+R*Math.cos(a), ecy-R*Math.sin(a)]);
        }
        // Φ_R（转子励磁磁场方向 = θ_TR）
        if (this._rotorFieldArrow) {
            const ecx=this._synCX, ecy=this._synCY;
            const R=this._airGapR*0.63;
            const a=Math.PI/2 - this._trAngleRad;
            this._rotorFieldArrow.points([ecx,ecy, ecx+R*Math.cos(a), ecy-R*Math.sin(a)]);
        }
        // 定子绕组亮度（随定子电流）
        this._statorDots?.forEach(({ dot, dotB }, i) => {
            const K=this.voltageRatio, U_m=this._excitVolt*Math.sqrt(2);
            const eVals=[K*U_m*Math.abs(Math.cos(this._txAngleRad)),
                         K*U_m*Math.abs(Math.cos(this._txAngleRad-2*Math.PI/3)),
                         K*U_m*Math.abs(Math.cos(this._txAngleRad+2*Math.PI/3))];
            const alpha=Math.max(0.1,Math.min(0.95,0.35+0.55*eVals[i]/(U_m*K+1e-9)));
            dot.opacity(alpha);
            dotB.opacity(alpha*0.4);
        });
        // 失步警告
        if (this._outOfStepOverlay) {
            this._outOfStepOverlay.fill(this._outOfStep?'rgba(198,40,40,0.18)':'rgba(198,40,40,0)');
        }
        if (this._outOfStepLabel) {
            this._outOfStepLabel.text(this._outOfStep?'⚡ 失步！':'');
        }
    }

    // ── 气隙磁场粒子（定子合成磁场）────────
    _tickFieldViz(dt) {
        this._fieldGroup.destroyChildren();
        const mag = Math.abs(this.phi_m) * (this._excitVolt/this.ratedVoltage);
        if (mag < 0.02) return;

        const ecx=this._synCX, ecy=this._synCY;
        const r0=this._rotorR*0.88, r1=this._sInner*0.95;
        const fieldA = Math.PI/2 - this._txAngleRad;

        for (let i = -3; i <= 3; i++) {
            const spread=i/3*Math.PI*0.28;
            const a=fieldA+spread;
            const alpha=Math.max(0.03,(0.38-Math.abs(spread)*0.45)*mag);
            this._fieldGroup.add(new Konva.Line({
                points:[ecx+r0*Math.cos(a),ecy+r0*Math.sin(a),ecx+r1*Math.cos(a),ecy+r1*Math.sin(a)],
                stroke:spread<0?`rgba(255,167,38,${alpha})`:`rgba(100,181,246,${alpha})`,
                strokeWidth:1.5, lineCap:'round',
            }));
        }
        for (let i = 0; i < 8; i++) {
            const t=((this._animPhase*0.05+i/8)%1+1)%1;
            const r=r0+t*(r1-r0);
            this._fieldGroup.add(new Konva.Circle({
                x:ecx+r*Math.cos(fieldA+(Math.random()-0.5)*0.22),
                y:ecy+r*Math.sin(fieldA+(Math.random()-0.5)*0.22),
                radius:2+mag*2,
                fill:`rgba(255,213,79,${0.18+mag*0.32})`,
            }));
        }
    }

    // ── 相量图更新 ────────────────────────────
    _tickPhasor() {
        if (!this._phiS) return;
        const R=this._phR, ocx=this._phOCX, ocy=this._phOCY;
        // Φ_S 方向 = θ_TX
        const aS = Math.PI/2 - this._txAngleRad;
        this._phiS.points([ocx,ocy, ocx+R*Math.cos(aS), ocy-R*Math.sin(aS)]);
        // Φ_R 方向 = θ_TR
        const aR = Math.PI/2 - this._trAngleRad;
        this._phiR.points([ocx,ocy, ocx+R*0.75*Math.cos(aR), ocy-R*0.75*Math.sin(aR)]);

        // 功角弧（从 Φ_R 到 Φ_S）
        const dTheta=this._txAngleRad-this._trAngleRad;
        if (this._deltaArc) {
            const arcStart=-aR*180/Math.PI-90;
            this._deltaArc.rotation(arcStart);
            this._deltaArc.angle(Math.abs(dTheta)*180/Math.PI);
        }
        // 力矩方向弧（顺/逆时针，用于指示 T_sync 方向）
        if (this._torqueArc) {
            const torqueDir = dTheta > 0 ? 1 : -1;
            const arcStart2 = -aR*180/Math.PI - 90;
            this._torqueArc.rotation(arcStart2);
            this._torqueArc.angle(Math.min(90, Math.abs(dTheta)*180/Math.PI*0.8));
            this._torqueArc.fill(dTheta>0?'#66bb6a':'#ef5350');
        }
        if (this._deltaLabel) {
            const dDeg=dTheta*180/Math.PI;
            this._deltaLabel.text(`Δθ=${dDeg.toFixed(1)}°`);
            this._deltaLabel.fill(Math.abs(dDeg)>60?'#ffa726':'#ffd54f');
        }
    }

    // ── T-θ 特性工作点 ───────────────────────
    _tickTorqueAnglePt() {
        if (!this._taWorkPoint) return;
        const dDeg=this.deltaTheta;
        const x=this._taOX+(dDeg+180)/360*this._taAW;
        const y=this._taOY - Math.sin(dDeg*Math.PI/180)*(this._taAH-3);
        this._taWorkPoint.x(Math.max(this._taOX,Math.min(this._taOX+this._taAW,x)));
        this._taWorkPoint.y(Math.max(this._taOY-this._taAH+2,Math.min(this._taOY+this._taAH-2,y)));
        this._taWorkPoint.fill(this._outOfStep?'#ef5350':Math.abs(dDeg)>60?'#ffa726':'#66bb6a');

        // 负载线（水平）
        const TloadNorm=this._loadTorque/(this.Ks+1e-9);
        const loadY=this._taOY - TloadNorm*(this._taAH-3);
        this._taLoadLine?.points([this._taOX,loadY, this._taOX+this._taAW,loadY]);

        // 静态误差角
        const thetaErr=Math.asin(Math.min(1,this._loadTorque/(this.Ks+1e-9)))*180/Math.PI;
        this._taErrLabel?.text(`θ_err=${thetaErr.toFixed(1)}°`);
    }

    // ── 阻尼分析面板更新 ─────────────────────
    _tickDampingPanel() {
        // 阻尼比指针
        if (this._dampNeedle) {
            const z=Math.min(2,this.zeta);
            const a=Math.PI - (z/2)*Math.PI; // 0→右端(ζ=0)，π→左端(ζ=2)
            const R=this._dampGR;
            this._dampNeedle.points([
                this._dampGCX, this._dampGCY,
                this._dampGCX + R*0.85*Math.cos(a),
                this._dampGCY - R*0.85*Math.sin(a),
            ]);
        }
        if (this._dampZetaLabel) {
            this._dampZetaLabel.text(`ζ=${this.zeta.toFixed(3)}`);
            this._dampZetaLabel.fill(this.zeta<0.3?'#4fc3f7':this.zeta<1.2?'#66bb6a':'#ffa726');
        }
        // t_s 与振荡次数
        if (this._dampTsLabel) {
            const ts=this._settled ? '稳定' : '--';
            this._dampTsLabel.text(`ζ=${this.zeta.toFixed(3)}  振荡: ${this._oscillations}次  ${ts}`);
        }
        // 动态更新参数标签
        if (this._dampParamLabels) {
            if (this._dampParamLabels['f_n']) {
                const fn=Math.sqrt(this.Ks/this.J)/(2*Math.PI);
                this._dampParamLabels['f_n'].text(`${fn.toFixed(1)}Hz`);
            }
            if (this._dampParamLabels['K_s']) this._dampParamLabels['K_s'].text(`${this.Ks.toFixed(3)}`);
        }
    }

    // ── 动态响应曲线 ─────────────────────────
    _tickDynamicTrace() {
        if (!this._dynTXLine) return;
        const n=this._trackLen, aw=this._dynAW, ah=this._dynAH;
        const ox=this._dynOX, oy=this._dynOY;
        const dx=aw/n;
        const maxAng=360, maxOm=180;

        const ptTX=[], ptTR=[], ptOm=[];
        for (let i=0;i<n;i++) {
            const x=ox+i*dx;
            ptTX.push(x, oy-(this._trackTX[i]/maxAng)*(ah-4));
            ptTR.push(x, oy-(this._trackTR[i]/maxAng)*(ah-4));
            // 角速度（映射到图下半部分）
            const omNorm=Math.max(-maxOm,Math.min(maxOm,this._trackOmega[i]))/maxOm;
            ptOm.push(x, oy-(omNorm)*(ah/3));
        }
        this._dynTXLine.points(ptTX);
        this._dynTRLine.points(ptTR);
        this._dynOmLine.points(ptOm);
    }

    // ── 转矩分解图 ───────────────────────────
    _tickTorqueDecomp() {
        if (!this._tdSyncLine) return;
        const n=this._trackLen, aw=this._tdAW, ah=this._tdAH;
        const ox=this._tdOX, oy=this._tdOY;
        const dx=aw/n;
        const tMax=Math.max(0.001,this.Ks*1.1);

        const ptSync=[], ptDamp=[], ptNet=[];
        for (let i=0;i<n;i++) {
            const x=ox+i*dx;
            ptSync.push(x, oy-(this._trackT[i]/tMax)*(ah-3));
            // 阻尼转矩（对应角速度处）
            const damp=-this.B_damp*this._trackOmega[i]*Math.PI/180;
            ptDamp.push(x, oy-(damp/tMax)*(ah-3));
            ptNet.push(x, oy-((this._trackT[i]+damp)/tMax)*(ah-3));
        }
        this._tdSyncLine.points(ptSync);
        this._tdDampLine.points(ptDamp);
        this._tdNetLine.points(ptNet);

        // 负载线（水平）
        const loadNorm=this._loadTorque/tMax;
        const loadY=oy-loadNorm*(ah-3);
        this._tdLoadLine.points([ox,loadY, ox+aw,loadY]);
    }

    // ── 波形更新 ─────────────────────────────
    _tickWaveform() {
        if (!this._wavHCh||!this._wavMids) return;
        const wx=this._wavX+3, ww=this._wavW-6, n=this._wavLen;
        const dx=ww/n, hCh=this._wavHCh;
        const [mUR,mSync,mDamp,mDelta]=this._wavMids;

        const uPk  = this._excitVolt*Math.sqrt(2);
        const tMax = Math.max(0.001,this.Ks*1.1);
        const dMax = 180;

        const ptUR=[], ptSync=[], ptDamp=[], ptDelta=[];
        for (let i=0;i<n;i++) {
            const x=wx+i*dx;
            ptUR.push(x,    mUR   -(this._wavUR[i]   /uPk)*hCh*0.38);
            ptSync.push(x,  mSync -(this._wavSync[i]  /tMax)*hCh*0.38);
            ptDamp.push(x,  mDamp -(this._wavDamp[i]  /tMax)*hCh*0.38);
            ptDelta.push(x, mDelta-(Math.max(-dMax,Math.min(dMax,this._wavDelta[i]))/dMax)*hCh*0.36);
        }
        this._wLUR.points(ptUR);
        this._wLSync.points(ptSync);
        this._wLDamp.points(ptDamp);
        this._wLDelta.points(ptDelta);
    }

    // ── 仪表更新 ─────────────────────────────
    _tickDisplay() {
        const c=this._lcdCells;
        if (!c) return;

        const thetaErr=Math.asin(Math.min(1,this._loadTorque/(this.Ks+1e-9)))*180/Math.PI;

        if (c.theta_tx)  c.theta_tx.text(this._txAngle.toFixed(2));
        if (c.theta_tr)  c.theta_tr.text(this._trAngle.toFixed(2));
        if (c.delta) {
            c.delta.text(this.deltaTheta.toFixed(2));
            c.delta.fill(Math.abs(this.deltaTheta)>60?'#ffa726':Math.abs(this.deltaTheta)>20?'#ef9a9a':'#66bb6a');
        }
        if (c.tsync)     c.tsync.text(this.T_sync.toFixed(5));
        if (c.tdamp)     c.tdamp.text(this.T_damp.toFixed(5));
        if (c.tnet)  {
            c.tnet.text(this.T_net.toFixed(5));
            c.tnet.fill(Math.abs(this.T_net)>this.Ks*0.8?'#ef5350':'#ffd54f');
        }
        if (c.omega)     c.omega.text((this._trOmega*180/Math.PI).toFixed(2));
        if (c.ks)        c.ks.text(this.Ks.toFixed(4));
        if (c.zeta) {
            c.zeta.text(this.zeta.toFixed(3));
            c.zeta.fill(this.zeta<0.3?'#4fc3f7':this.zeta<1.2?'#66bb6a':'#ffa726');
        }
        if (c.sterr)     c.sterr.text(thetaErr.toFixed(3));
        if (c.oos) {
            c.oos.text(this._outOfStep?'⚡ 失步！':'✓ 同步中');
            c.oos.fill(this._outOfStep?'#ef5350':'#66bb6a');
        }
        if (c.excit)     c.excit.text(this._excitVolt.toFixed(0));

        if (this._sliderBars) {
            Object.values(this._sliderBars).forEach(({ bar, txt, slW, getR, disp }) => {
                bar.width(Math.min(slW,Math.max(0,getR())*slW));
                txt.text(disp());
            });
        }
    }

    // ── 内部辅助方法 ─────────────────────────
    _updateZeta() {
        this.omega_n = Math.sqrt(this.Ks / this.J);
        this.zeta    = this.B_damp / (2*Math.sqrt(this.Ks*this.J));
        this.freq_n  = this.omega_n / (2*Math.PI);
        this._refreshCache();
    }

    // ═══════════════════════════════════════════
    setTxAngle(deg) {
        this._txAngle    = ((deg%360)+360)%360;
        this._txAngleRad = this._txAngle*Math.PI/180;
        this._refreshCache();
    }

    setDamping(B) {
        this.B_damp = Math.max(0, B);
        this._updateZeta();
    }

    setLoad(T) {
        this._loadTorque = Math.max(0, Math.min(this.Ks*0.99, T));
        this._refreshCache();
    }

    setSyncTorqueCoeff(Ks) {
        this.Ks   = Math.max(0.01, Ks);
        this.T_max= this.Ks;
        this._updateZeta();
    }

    setExcitVoltage(v) {
        this._excitVolt = Math.max(0, Math.min(this.ratedVoltage*1.2, v));
        this._refreshCache();
    }

    toggleTxAuto() {
        this._txAutoRotate = !this._txAutoRotate;
        this._refreshCache();
    }

    triggerStep() {
        // 阶跃响应：将 θ_TX 突变 45°，观察 TR 响应
        this._txAngle    = (this._trAngle + 45 + 360) % 360;
        this._txAngleRad = this._txAngle*Math.PI/180;
        this._oscillations = 0;
        this._settled = false;
        this._settleTime = 0;
        this._refreshCache();
    }

    resetTR() {
        this._trAngle    = this._txAngle;
        this._trAngleRad = this._trAngle*Math.PI/180;
        this._trOmega    = 0;
        this._oscillations= 0;
        this._settled    = false;
        this._settleTime = 0;
        this._refreshCache();
    }

    toggleExcit() {
        this._excitVolt = this._excitVolt > 0 ? 0 : this.ratedVoltage;
        this._refreshCache();
    }

    isInSync()    { return !this._outOfStep; }
    isSettled()   { return this._settled; }
    getAngle()    { return this._trAngle; }
    getError()    { return this.deltaTheta; }
    getTorque()   { return this.T_sync; }

    update(cfg={}) {
        if (cfg.txAngle !== undefined) this.setTxAngle(cfg.txAngle);
        if (cfg.damp    !== undefined) this.setDamping(cfg.damp);
        if (cfg.load    !== undefined) this.setLoad(cfg.load);
        if (cfg.Ks      !== undefined) this.setSyncTorqueCoeff(cfg.Ks);
        this._refreshCache();
    }

    getConfigFields() {
        return [
            { label:'位号/名称',              key:'id',              type:'text'   },
            { label:'励磁额定电压 (V)',        key:'ratedVoltage',    type:'number' },
            { label:'额定频率 (Hz)',           key:'ratedFreq',       type:'number' },
            { label:'转子绕组电阻 R (Ω)',      key:'R_rotor',         type:'number' },
            { label:'转子绕组电感 L (H)',      key:'L_rotor',         type:'number' },
            { label:'同步力矩系数 K_s (N·m/rad)',key:'Ks',            type:'number' },
            { label:'阻尼系数 B (N·m·s/rad)', key:'B_damp',          type:'number' },
            { label:'转动惯量 J (kg·m²)',      key:'J',               type:'number' },
            { label:'集电环摩擦转矩 (N·m)',   key:'T_friction',      type:'number' },
            { label:'初始 θ_TX (°)',           key:'initTxAngle',     type:'number' },
            { label:'初始 θ_TR (°)',           key:'initTrAngle',     type:'number' },
            { label:'初始负载转矩 (N·m)',      key:'initLoad',        type:'number' },
        ];
    }

    onConfigUpdate(cfg) {
        const n = k => parseFloat(cfg[k]);
        this.id            = cfg.id            || this.id;
        if (cfg.ratedVoltage) this.ratedVoltage= n('ratedVoltage');
        if (cfg.ratedFreq)    this.ratedFreq   = n('ratedFreq');
        if (cfg.R_rotor)      this.R_rotor     = n('R_rotor');
        if (cfg.L_rotor)      this.L_rotor     = n('L_rotor');
        if (cfg.Ks)           this.Ks          = n('Ks');
        if (cfg.B_damp)       this.B_damp      = n('B_damp');
        if (cfg.J)            this.J           = n('J');
        if (cfg.T_friction)   this.T_friction  = n('T_friction');
        if (cfg.initTxAngle !== undefined) this.setTxAngle(n('initTxAngle'));
        if (cfg.initTrAngle !== undefined) { this._trAngle=n('initTrAngle'); this._trAngleRad=this._trAngle*Math.PI/180; }
        if (cfg.initLoad !== undefined)   this._loadTorque=n('initLoad');
        this.T_max  = this.Ks;
        this.Z_rotor= Math.sqrt(this.R_rotor**2+(2*Math.PI*this.ratedFreq*this.L_rotor)**2);
        this._updateZeta();
        this.config = { ...this.config, ...cfg };
        this._refreshCache();
    }

    destroy() {
        super.destroy?.();
    }
}