import { BaseComponent } from './BaseComponent.js';

/**
 * 交流伺服电机带制动器仿真组件
 * （AC Servo Motor with Electromagnetic Brake）
 *
 * ── 与普通 PMSM 的核心扩展 ────────────────────────────────────
 *
 *  交流伺服电机 = 高精度 PMSM + 高分辨率编码器 + 伺服驱动器
 *  带制动器版本额外集成：
 *    ① 电磁制动器（掉电抱闸，安全保持）
 *    ② 位置/速度/转矩三环串级控制
 *    ③ 点动/回零/轮廓插补等伺服运动控制
 *
 * ── 电磁制动器工作原理 ────────────────────────────────────────
 *
 *  1. 结构组成：
 *     - 制动线圈（DC 24V 励磁）
 *     - 弹簧加压盘（默认弹力压紧摩擦片）
 *     - 摩擦片（固定在制动器壳体）
 *     - 衔铁（随轴旋转，被弹簧或电磁力压紧/松开）
 *     - 永磁辅助型（部分结构含永磁体减小励磁功耗）
 *
 *  2. 动作逻辑（失电制动型，最常见）：
 *     线圈断电（默认）→ 弹簧力 F_spring 压紧摩擦片 → 制动（抱闸）
 *     线圈通电（DC24V）→ 电磁吸力 F_em > F_spring → 衔铁释放 → 松闸
 *     此设计确保断电/故障时自动制动，安全性高（Fail-Safe）
 *
 *  3. 制动转矩：
 *     T_brake = μ × F_spring × r_eff × n_friction
 *     其中 μ 为摩擦系数（干摩擦约 0.35~0.45），
 *           r_eff 为等效摩擦半径，n_friction 为摩擦面数
 *     典型值：额定制动转矩 ≥ 电机额定转矩的 1.2 倍
 *
 *  4. 动作时间：
 *     吸合时间（通电→松闸）t_engage ≈ 10~60 ms（依线圈电感）
 *     释放时间（断电→制动）t_release ≈ 5~20 ms（弹簧响应）
 *     仿真中引入一阶延迟模拟实际动作时间
 *
 *  5. 制动摩擦热（长期制动时发热）：
 *     P_friction = T_brake × ω_slip（滑动摩擦功率）
 *     累计热量导致摩擦系数下降（热衰退）
 *
 *  6. 制动器磨损（操作次数相关）：
 *     每次制动消耗：E_wear ∝ T_brake × θ_slip
 *     寿命：设计操作次数（典型 1~3 百万次）
 *
 * ── 伺服控制系统 ──────────────────────────────────────────────
 *
 *  三环串级控制结构（由外到内）：
 *
 *  位置环（最外环，最慢）：
 *    输入：位置给定 θ* vs 编码器反馈 θ
 *    输出：速度给定 ω*
 *    控制器：P 控制（Kp_pos）或 PD 控制
 *    典型带宽：50~200 Hz
 *
 *  速度环（中间环）：
 *    输入：速度给定 ω* vs 编码器微分 ω
 *    输出：转矩给定 T*（或 iq*）
 *    控制器：PI 控制（Kp_spd + Ki_spd/s）
 *    典型带宽：200~1000 Hz
 *
 *  电流环（最内环，最快）：
 *    输入：iq* vs 实际 iq（FOC d-q 变换后）
 *    输出：d-q 轴电压 ud/uq → SVPWM
 *    控制器：PI 控制（Kp_cur + Ki_cur/s）
 *    典型带宽：1~10 kHz（开关频率 4~20 kHz）
 *
 *  前馈补偿：
 *    速度前馈（减小跟踪误差）：ω_ff = dθ* /dt
 *    加速度前馈（减小惯量误差）：T_ff = J×dω* /dt
 *
 * ── 编码器 ────────────────────────────────────────────────────
 *
 *  增量式编码器：A/B/Z 相，分辨率 2500~20000 线/转（×4 后分辨率更高）
 *  绝对式编码器：17~23 bit 单圈绝对位置，无需回零
 *  本仿真：23 bit 绝对编码器（8388608 counts/rev），模拟位置反馈噪声
 *
 * ── 运动模式 ──────────────────────────────────────────────────
 *  位置模式（PP/PT）：点到点位置控制，S 曲线/梯形速度规划
 *  速度模式（PV）：速度控制，负载转矩补偿
 *  转矩模式（TQ）：直接转矩控制（用于力控/张力控制）
 *  点动模式（JOG）：手动低速连续运动，用于调试
 *  回零模式（HOME）：寻找参考点，建立机械坐标系
 *
 * ── 组件结构 ──────────────────────────────────────────────────
 *  ① 电机+制动器纵截面图（电机本体 + 尾部制动器结构剖面）
 *  ② 制动器动作状态动画（弹簧/线圈/摩擦片/气隙变化，通断电效果）
 *  ③ 三环控制框图（位置环→速度环→电流环→SVPWM，带前馈标注）
 *  ④ 位置跟踪曲线（给定位置 θ* 与实际位置 θ，跟踪误差 e_pos）
 *  ⑤ 速度-转矩-电流实时波形（ω、T、iq、id）
 *  ⑥ S 曲线速度规划可视化（加速→匀速→减速，Jerk 限制）
 *  ⑦ 制动器状态面板（线圈电压/电流/气隙/制动转矩/温升/磨损）
 *  ⑧ LCD 仪表（位置/速度/转矩/误差/制动状态/编码器值/热状态）
 *  ⑨ 控制面板（运动模式/目标位置/速度/加速度/制动器手动控制）
 *
 * ── 端口 ─────────────────────────────────────────────────────
 *  dc_pos      — 驱动器直流母线正极
 *  dc_neg      — 驱动器直流母线负极
 *  phase_u/v/w — 三相电机绕组
 *  enc_data    — 编码器数据线（绝对式）
 *  brake_pos   — 制动器线圈正极（+24V）
 *  brake_neg   — 制动器线圈负极（0V）
 *  shaft       — 输出轴
 */
export class ACServoWithBrake extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.width  = Math.max(600, config.width  || 740);
        this.height = Math.max(460, config.height || 600);

        this.type    = 'ac_servo_pmsm';
        this.special = 'none';
        this.cache   = 'fixed';

        // ── 电机额定参数 ──
        this.ratedPower    = config.ratedPower    || 750;    // W
        this.ratedVoltage  = config.ratedVoltage  || 310;    // V（DC 母线）
        this.ratedSpeed    = config.ratedSpeed    || 3000;   // rpm
        this.maxSpeed      = config.maxSpeed      || 5000;   // rpm
        this.ratedTorque   = config.ratedTorque   || (this.ratedPower/(this.ratedSpeed*2*Math.PI/60));
        this.peakTorque    = config.peakTorque    || this.ratedTorque * 3.0;
        this.ratedCurrent  = config.ratedCurrent  || 5.0;   // A（有效值）
        this.peakCurrent   = config.peakCurrent   || this.ratedCurrent * 3.0;
        this.polePairs     = config.polePairs     || 3;

        // ── 电机电磁参数（PMSM）──
        this.Rs    = config.Rs    || 1.2;     // Ω
        this.Ld    = config.Ld    || 6e-3;    // H
        this.Lq    = config.Lq    || 9e-3;    // H（IPM）
        this.psiF  = config.psiF  || 0.10;    // Wb
        this.Ke    = this.psiF * this.polePairs * Math.sqrt(1.5);

        // ── 机械参数 ──
        this.J      = config.J      || 3e-4;   // kg·m²（电机+负载）
        this.B      = config.B      || 5e-4;   // N·m·s/rad
        this.maxOmega = this.maxSpeed * 2*Math.PI/60;

        // ── 编码器参数（23 bit 绝对式）──
        this.encoderBits = config.encoderBits || 23;
        this.encoderCPR  = Math.pow(2, this.encoderBits); // counts/rev = 8388608
        this.encNoise    = config.encNoise    || 1;       // counts（噪声幅度）

        // ── 制动器参数 ──
        this.brakeVoltage   = config.brakeVoltage   || 24;   // V（线圈额定电压）
        this.brakeR         = config.brakeR         || 26;   // Ω（线圈电阻）
        this.brakeL         = config.brakeL         || 0.28; // H（线圈电感）
        this.brakeTorque    = config.brakeTorque    || this.ratedTorque * 1.5; // N·m（额定制动转矩）
        this.brakeSpring    = config.brakeSpring    || 180;  // N（弹簧力）
        this.brakeAirGap    = config.brakeAirGap    || 0.25e-3; // m（额定工作气隙）
        this.brakeEngageT   = config.brakeEngageT   || 0.05; // s（吸合时间常数）
        this.brakeReleaseT  = config.brakeReleaseT  || 0.02; // s（释放时间常数）
        this.brakeMassWear  = config.brakeMassWear  || 1e6;  // 额定磨损寿命（次）
        this.brakeThermalR  = config.brakeThermalR  || 2.5;  // °C/W（热阻）
        this.brakeThermalC  = config.brakeThermalC  || 150;  // J/°C（热容）

        // ── 控制参数（三环 PI）──
        // 位置环
        this.Kp_pos  = config.Kp_pos  || 80;    // rad/s/rad
        this.Kd_pos  = config.Kd_pos  || 0.002; // 微分（可选）
        // 速度环
        this.Kp_spd  = config.Kp_spd  || 0.08;
        this.Ki_spd  = config.Ki_spd  || 1.2;
        // 电流环
        this.Kp_cur  = config.Kp_cur  || 20.0;
        this.Ki_cur  = config.Ki_cur  || 1500.0;
        // 前馈
        this.Kff_spd = config.Kff_spd || 0.85;
        this.Kff_acc = config.Kff_acc || 0.5;

        // ── 运动规划参数 ──
        this.profileMaxSpd = config.profileMaxSpd || this.ratedSpeed * 0.8; // rpm
        this.profileMaxAcc = config.profileMaxAcc || 5000;  // rpm/s
        this.profileMaxJerk= config.profileMaxJerk|| 50000; // rpm/s²（S 曲线 Jerk 限制）

        // ── 运行状态 ──
        this._mode         = 'position'; // 'position'|'speed'|'torque'|'jog'|'home'
        this._running      = false;
        this._homed        = false;

        // 机械状态
        this._thetaM       = 0;      // 机械角度（rad）
        this._omegaR       = 0;      // 角速度（rad/s）
        this._thetaE       = 0;      // 电角度（rad）

        // 编码器
        this._encCounts    = 0;      // 编码器计数值
        this._encCountsRef = 0;      // 目标位置计数值

        // FOC 内部状态
        this._id           = 0;
        this._iq           = 0;
        this._ud           = 0;
        this._uq           = 0;
        this._intId        = 0;
        this._intIq        = 0;
        this._intSpd       = 0;
        this._modRatio     = 0;

        // 三环给定值
        this._posRef       = 0;      // 位置给定（rad）
        this._spdRef       = 0;      // 速度给定（rad/s）
        this._tqRef        = 0;      // 转矩给定（N·m）
        this._posErr       = 0;      // 位置误差（rad）
        this._posErrPrev   = 0;

        // S 曲线规划器
        this._profile      = { active: false, phase: 0, t: 0,
                               v0: 0, v1: 0, vmax: 0, amax: 0, jmax: 0,
                               phase_t: [0,0,0,0,0,0,0], theta_start: 0, theta_end: 0 };

        // 制动器状态
        this._brakeEnergized = false; // 线圈是否通电（true=松闸，false=制动）
        this._brakeCoilI     = 0;     // 线圈电流 A
        this._brakeGap       = 0;     // 当前气隙（0=制动，brakeAirGap=松开）
        this._brakeGapNorm   = 0;     // 归一化气隙（0~1）
        this._brakeTorqueAct = this.brakeTorque; // 实际制动转矩
        this._brakeTemp      = 25;    // 制动器温度 °C
        this._brakeWear      = 0;     // 磨损累计（次等效）
        this._brakeSlipE     = 0;     // 滑动能量（J）
        this._brakeSlipping  = false; // 制动器是否在滑动摩擦

        // 输出量
        this.torqueEM      = 0;
        this.torquePM      = 0;
        this.torqueRel     = 0;
        this.powerIn       = 0;
        this.powerOut      = 0;
        this.efficiency    = 0;
        this._loadTorque   = config.initLoad || 0;
        this._targetPosDeg = config.initPosDeg || 360; // 目标位置（deg）

        // ── 波形缓冲 ──
        this._wavLen    = 300;
        this._wavPos    = new Float32Array(this._wavLen).fill(0);  // 实际位置
        this._wavPosRef = new Float32Array(this._wavLen).fill(0);  // 给定位置
        this._wavSpd    = new Float32Array(this._wavLen).fill(0);
        this._wavTq     = new Float32Array(this._wavLen).fill(0);
        this._wavIq     = new Float32Array(this._wavLen).fill(0);
        this._wavId     = new Float32Array(this._wavLen).fill(0);
        this._wavBrakeG = new Float32Array(this._wavLen).fill(0);  // 制动器气隙

        // ── 几何布局 ──
        // 电机+制动器纵截面（左上，较宽）
        this._csX  = Math.round(this.width * 0.02);
        this._csY  = Math.round(this.height * 0.04);
        this._csW  = Math.round(this.width * 0.30);
        this._csH  = Math.round(this.height * 0.42);
        this._csCX = this._csX + this._csW / 2;
        this._csCY = this._csY + this._csH / 2;

        // 三环控制框图（右上）
        this._ctrlX = Math.round(this.width * 0.34);
        this._ctrlY = this._csY;
        this._ctrlW = Math.round(this.width * 0.63);
        this._ctrlH = Math.round(this.height * 0.22);

        // 位置跟踪曲线（中左）
        this._traceX = Math.round(this.width * 0.34);
        this._traceY = this._ctrlY + this._ctrlH + 8;
        this._traceW = Math.round(this.width * 0.30);
        this._traceH = Math.round(this.height * 0.24);

        // S 曲线速度规划（中右）
        this._scrvX  = this._traceX + this._traceW + 8;
        this._scrvY  = this._traceY;
        this._scrvW  = Math.round(this.width * 0.28);
        this._scrvH  = this._traceH;

        // 制动器状态面板（最右）
        this._brkX   = this._scrvX + this._scrvW + 8;
        this._brkY   = this._traceY;
        this._brkW   = this.width - this._brkX - Math.round(this.width * 0.02);
        this._brkH   = this._traceH;

        // LCD（左下）
        this._lcdX   = this._csX;
        this._lcdY   = this._csY + this._csH + 8;
        this._lcdW   = this._csW;
        this._lcdH   = Math.round(this.height * 0.26);

        // 控制面板（中下）
        this._panX   = this._traceX;
        this._panY   = this._traceY + this._traceH + 8;
        this._panW   = this.width - this._traceX - Math.round(this.width * 0.02);
        this._panH   = Math.round(this.height * 0.16);

        // 波形（底部全宽）
        this._wavX   = this._csX;
        this._wavY   = Math.max(this._lcdY + this._lcdH, this._panY + this._panH) + 6;
        this._wavW   = this.width - this._csX * 2;
        this._wavH   = this.height - this._wavY - 6;


        this.config = {
            id: this.id, ratedPower: this.ratedPower,
            ratedVoltage: this.ratedVoltage, ratedSpeed: this.ratedSpeed,
            brakeTorque: this.brakeTorque,
        };

        this._init();

        // 端口
        const cL = this._csX - 6;
        this.addPort(cL, this._csCY - 22, 'dc_pos', 'wire', '+VDC');
        this.addPort(cL, this._csCY + 22, 'dc_neg', 'wire', '−VDC');
        const cR = this._csX + this._csW + 6;
        this.addPort(cR, this._csCY - 30, 'phase_u', 'wire', 'U');
        this.addPort(cR, this._csCY,       'phase_v', 'wire', 'V');
        this.addPort(cR, this._csCY + 30,  'phase_w', 'wire', 'W');
        this.addPort(cR, this._csCY + 56,  'enc_data','wire', 'Enc');
        this.addPort(cR, this._csCY + 80,  'brake_pos','wire', '+BRK');
        this.addPort(cR, this._csCY + 96,  'brake_neg','wire', '−BRK');
        this.addPort(this._csCX, this._csY + this._csH + 6, 'shaft', 'pipe', '轴');
    }

    // ═══════════════════════════════════════════
    _init() {
        this._drawLabel();
        this._drawCrossSection();
        this._drawBrakeSection();
        this._drawBrakeAnimLayer();
        this._drawRotorLayer();
        this._drawControlBlock();
        this._drawTraceChart();
        this._drawSCurveChart();
        this._drawBrakePanel();
        this._drawLCDPanel();
        this._drawControlPanel();
        this._drawWaveform();
        
    }

    _drawLabel() {
        this.group.add(new Konva.Text({
            x: 0, y: -22, width: this.width,
            text: `交流伺服电机（带制动器）  ${this.ratedPower}W  ${this.ratedVoltage}V DC  ${this.ratedSpeed}/${this.maxSpeed}rpm  ` +
                  `制动器 ${this.brakeTorque.toFixed(1)}N·m  23bit 绝对编码器  三环 FOC`,
            fontSize: 10, fontStyle: 'bold', fill: '#1a2634', align: 'center',
        }));
    }

    // ── 电机本体横截面（左半部分） ──────────
    _drawCrossSection() {
        const { _csX: ex, _csY: ey, _csW: ew, _csH: eh, _csCX: ecx, _csCY: ecy } = this;

        this.group.add(new Konva.Rect({
            x: ex, y: ey, width: ew, height: eh,
            fill: '#0d1a24', stroke: '#1a3040', strokeWidth: 1.5, cornerRadius: 5,
        }));
        this.group.add(new Konva.Text({
            x: ex, y: ey - 14, width: ew,
            text: '伺服电机 + 制动器 纵截面图', fontSize: 9, fontStyle: 'bold',
            fill: '#546e7a', align: 'center',
        }));

        // ── 电机壳体（纵截面，矩形轮廓） ──
        const mLeft  = ex + Math.round(ew * 0.08);
        const mRight = ex + Math.round(ew * 0.58); // 电机占左 2/3，制动器占右 1/3
        const mTop   = ey + Math.round(eh * 0.10);
        const mBot   = ey + Math.round(eh * 0.90);
        const mW     = mRight - mLeft;
        const mH     = mBot - mTop;
        const mCX    = (mLeft + mRight) / 2;
        const mCY    = (mTop + mBot) / 2;

        // 外壳
        this.group.add(new Konva.Rect({ x: mLeft, y: mTop, width: mW, height: mH, fill: '#1c2b38', stroke: '#37474f', strokeWidth: 2, cornerRadius: 3 }));
        // 前后端盖
        this.group.add(new Konva.Rect({ x: mLeft, y: mTop, width: 10, height: mH, fill: '#263238', stroke: '#37474f', strokeWidth: 1 }));
        this.group.add(new Konva.Rect({ x: mRight-10, y: mTop, width: 10, height: mH, fill: '#263238', stroke: '#37474f', strokeWidth: 1 }));

        // 定子铁芯（叠片，示意）
        const stW = Math.round(mW * 0.75), stH = Math.round(mH * 0.72);
        const stL = mCX - stW/2, stT = mCY - stH/2;
        this.group.add(new Konva.Rect({ x: stL, y: stT, width: stW, height: stH, fill: '#455a64', stroke: '#263238', strokeWidth: 1 }));
        for (let i = 2; i < stH; i += 3)
            this.group.add(new Konva.Line({ points: [stL+1, stT+i, stL+stW-1, stT+i], stroke: 'rgba(0,0,0,0.12)', strokeWidth: 0.6 }));

        // 定子绕组（三相着色截面）
        const wR = stH*0.36, wCY = mCY;
        [['#e53935',0],['#43a047',2*Math.PI/3],['#1e88e5',4*Math.PI/3]].forEach(([col,aOff]) => {
            for (let i = -1; i <= 1; i++) {
                const a = aOff + i*Math.PI/5;
                this.group.add(new Konva.Ellipse({
                    x: mCX + wR*Math.cos(a), y: wCY + wR*Math.sin(a)*0.28,
                    radiusX: 5, radiusY: 3, fill: col, opacity: 0.75,
                }));
            }
        });

        // 气隙区域（椭圆形，模拟纵截面）
        const rR = Math.round(stH * 0.32);
        this.group.add(new Konva.Ellipse({ x: mCX, y: mCY, radiusX: rR*0.96, radiusY: rR*0.28, fill: '#06101a', stroke: '#1a3040', strokeWidth: 0.5 }));

        // 散热片（外壳两侧）
        const finCount = 6;
        for (let i = 0; i < finCount; i++) {
            const fy = mTop + mH*0.15 + i*(mH*0.70/finCount);
            this.group.add(new Konva.Line({ points: [mLeft-6, fy, mLeft, fy], stroke: '#37474f', strokeWidth: 3 }));
            this.group.add(new Konva.Line({ points: [mRight, fy, mRight+6, fy], stroke: '#37474f', strokeWidth: 3 }));
        }

        // 出线端子（上侧）
        const termY = mTop - 2;
        const termX = mLeft + mW * 0.3;
        this.group.add(new Konva.Rect({ x: termX, y: termY-8, width: 30, height: 10, fill: '#263238', stroke: '#37474f', strokeWidth: 1, cornerRadius: 2 }));
        [['U','#e53935',0],['V','#43a047',10],['W','#1e88e5',20]].forEach(([l,c,dx]) => {
            this.group.add(new Konva.Circle({ x: termX+5+dx, y: termY-3, radius: 3, fill: c }));
        });
        this.group.add(new Konva.Text({ x: termX, y: termY-18, text: 'UVW 出线', fontSize: 7, fill: '#546e7a' }));

        // 编码器（右端盖后方，圆形）
        const encX = mRight + 5, encY = mCY;
        const encR = Math.round(mH*0.22);
        this.group.add(new Konva.Circle({ x: encX+encR, y: encY, radius: encR, fill: '#0d1a24', stroke: '#ffd54f', strokeWidth: 1.5 }));
        // 编码器码盘（示意扇形）
        for (let i = 0; i < 16; i++) {
            const a = (i/16)*Math.PI*2;
            const col = (i%2===0) ? '#ffd54f' : '#1a252f';
            this.group.add(new Konva.Arc({ x: encX+encR, y: encY, innerRadius: encR*0.4, outerRadius: encR*0.85, angle: 360/16-1, rotation: i*360/16-90, fill: col, opacity: 0.7 }));
        }
        this.group.add(new Konva.Text({ x: encX, y: encY+encR+3, width: encR*2, text: '编码器\n23bit', fontSize: 7, fill: '#ffd54f', align: 'center', lineHeight: 1.3 }));

        // 编码器信号线
        const termR = ex + ew + 10;
        this.group.add(new Konva.Line({ points: [encX+encR*2, encY, termR, ecy+56], stroke: '#ffd54f', strokeWidth: 1.5, dash: [3,3] }));
        this.group.add(new Konva.Circle({ x: termR, y: ecy+56, radius: 3.5, fill: '#ffd54f' }));
        this.group.add(new Konva.Text({ x: termR+4, y: ecy+50, text: 'Enc', fontSize: 8, fill: '#ffd54f' }));

        // UVW 端子连线
        [['U','#e53935',-30,0],['V','#43a047',0,1],['W','#1e88e5',30,2]].forEach(([l,c,dy]) => {
            this.group.add(new Konva.Line({ points: [mLeft+mW*0.42, mTop-2, termR, ecy+dy], stroke: c, strokeWidth: 1.5, dash: [3,3] }));
            this.group.add(new Konva.Circle({ x: termR, y: ecy+dy, radius: 3.5, fill: c }));
            this.group.add(new Konva.Text({ x: termR+4, y: ecy+dy-5, text: l, fontSize: 9, fill: c, fontStyle: 'bold' }));
        });

        // 直流母线（左侧）
        this.group.add(new Konva.Line({ points: [ex-14, ecy-22, mLeft+4, ecy-22], stroke: '#ef5350', strokeWidth: 2 }));
        this.group.add(new Konva.Line({ points: [ex-14, ecy+22, mLeft+4, ecy+22], stroke: '#90caf9', strokeWidth: 2 }));
        this.group.add(new Konva.Circle({ x: ex-14, y: ecy-22, radius: 3, fill: '#ef5350' }));
        this.group.add(new Konva.Circle({ x: ex-14, y: ecy+22, radius: 3, fill: '#90caf9' }));
        this.group.add(new Konva.Text({ x: ex-27, y: ecy-28, text: '+', fontSize: 10, fill: '#ef5350', fontStyle: 'bold' }));
        this.group.add(new Konva.Text({ x: ex-27, y: ecy+18, text: '−', fontSize: 10, fill: '#90caf9', fontStyle: 'bold' }));

        // 输出轴（底部穿出）
        this.group.add(new Konva.Rect({ x: mCX-4, y: mBot, width: 8, height: 12, fill: '#78909c', stroke: '#546e7a', strokeWidth: 1 }));

        this._mLeft=mLeft; this._mRight=mRight; this._mTop=mTop; this._mBot=mBot;
        this._mCX=mCX; this._mCY=mCY; this._encX=encX+encR; this._encY=encY;
        this._rR=rR;
    }

    // ── 制动器截面（右 1/3，带弹簧/线圈/摩擦片） ──
    _drawBrakeSection() {
        const { _csX: ex, _csY: ey, _csW: ew, _csH: eh } = this;
        const bLeft  = Math.round(ex + ew * 0.62);
        const bRight = ex + ew - 8;
        const bTop   = ey + Math.round(eh * 0.08);
        const bBot   = ey + Math.round(eh * 0.92);
        const bW     = bRight - bLeft;
        const bH     = bBot - bTop;
        const bCX    = (bLeft+bRight)/2;
        const bCY    = (bTop+bBot)/2;

        // 制动器外壳
        this.group.add(new Konva.Rect({ x: bLeft, y: bTop, width: bW, height: bH, fill: '#1c2020', stroke: '#37474f', strokeWidth: 1.5, cornerRadius: 3 }));
        this.group.add(new Konva.Text({ x: bLeft, y: bTop-12, width: bW, text: '制动器', fontSize: 8, fontStyle: 'bold', fill: '#ffa726', align: 'center' }));

        // 线圈（励磁线圈，绕组截面）
        const coilY = bTop + bH*0.18;
        const coilH = bH*0.28;
        this.group.add(new Konva.Rect({ x: bLeft+4, y: coilY, width: bW-8, height: coilH, fill: '#1a1000', stroke: '#ffa726', strokeWidth: 1, cornerRadius: 2 }));
        const coilTurns = 8;
        for (let i = 0; i < coilTurns; i++) {
            const ty = coilY + 2 + i*(coilH-4)/coilTurns;
            this.group.add(new Konva.Line({ points: [bLeft+6,ty, bRight-6,ty, bRight-6,ty+(coilH-4)/coilTurns*0.85, bLeft+6,ty+(coilH-4)/coilTurns*0.85], stroke: ['#c87832','#e09040'][i%2], strokeWidth: 1.5, lineJoin: 'round' }));
        }
        this.group.add(new Konva.Text({ x: bLeft+2, y: coilY+coilH*0.35, width: bW-4, text: '励磁\n线圈', fontSize: 7.5, fill: '#ffa726', align: 'center', lineHeight: 1.3 }));

        // 弹簧示意（右侧竖向弹簧）
        const spX   = bRight - 10, spTop = coilY + coilH + 4, spBot = bTop + bH*0.75;
        const spH   = spBot - spTop;
        const spPts = [spX, spTop];
        const spN   = 8;
        for (let i = 0; i < spN; i++) {
            const sy = spTop + i*(spH/spN);
            spPts.push(spX + (i%2===0?-5:5), sy + spH/spN*0.5);
            spPts.push(spX, sy + spH/spN);
        }
        spPts.push(spX, spBot);
        this.group.add(new Konva.Line({ points: spPts, stroke: '#80cbc4', strokeWidth: 1.5, lineJoin: 'round' }));
        this.group.add(new Konva.Text({ x: bLeft+4, y: spTop + spH*0.3, text: '弹簧\n(预压)', fontSize: 7, fill: '#80cbc4', lineHeight: 1.3 }));

        // 衔铁（动盘，随气隙移动）
        this._brakeArmatureRect = new Konva.Rect({
            x: bLeft+4, y: spTop, width: bW-14, height: 10,
            fill: '#546e7a', stroke: '#263238', strokeWidth: 1, cornerRadius: 1,
        });
        this.group.add(this._brakeArmatureRect);
        this._brakeArmatureY0 = spTop;   // 松开位置
        this._brakeArmatureY1 = spTop - 6; // 制动位置（弹簧压下）

        // 摩擦片（固定在壳体）
        const frY = spBot + 4;
        this.group.add(new Konva.Rect({ x: bLeft+4, y: frY, width: bW-8, height: 8, fill: '#3e2723', stroke: '#795548', strokeWidth: 1, cornerRadius: 1 }));
        this.group.add(new Konva.Text({ x: bLeft+2, y: frY-10, width: bW-4, text: '摩擦片', fontSize: 7, fill: '#a1887f', align: 'center' }));

        // 气隙指示
        this._brakeGapLine = new Konva.Line({ points: [bLeft+4, spTop+10, bLeft+4, frY], stroke: '#66bb6a', strokeWidth: 1, dash: [2,2] });
        this._brakeGapLabel= new Konva.Text({ x: bLeft+6, y: (spTop+10+frY)/2-5, text: '气隙δ', fontSize: 7, fill: '#66bb6a' });
        this.group.add(this._brakeGapLine, this._brakeGapLabel);

        // 线圈接线端子
        const brkTermX = ex + ew + 10;
        [['#ef9a9a',80,'+BRK'],['#90caf9',96,'−BRK']].forEach(([col,dy,lbl]) => {
            this.group.add(new Konva.Line({ points: [bCX, bTop+coilH*0.5, brkTermX, this._csCY+dy], stroke: col, strokeWidth: 1.5, dash: [3,3] }));
            this.group.add(new Konva.Circle({ x: brkTermX, y: this._csCY+dy, radius: 3.5, fill: col }));
            this.group.add(new Konva.Text({ x: brkTermX+4, y: this._csCY+dy-5, text: lbl, fontSize: 7.5, fill: col }));
        });

        // 线圈发光背景
        this._brakeCoilGlow = new Konva.Rect({ x: bLeft+3, y: coilY-1, width: bW-6, height: coilH+2, fill: 'rgba(255,167,38,0)', cornerRadius: 2 });
        this.group.add(this._brakeCoilGlow);

        this._brakeSectionBLeft = bLeft; this._brakeSectionCoilY = coilY;
        this._brakeSectionSpTop = spTop; this._brakeSectionFrY = frY;
        this._brakeSectionBH    = bH;    this._brakeSectionBTop = bTop;
    }

    // ── 制动器动画层（气隙/衔铁移动） ────────
    _drawBrakeAnimLayer() {
        this._brakeAnimGroup = new Konva.Group();
        this.group.add(this._brakeAnimGroup);
    }

    // ── 转子（简化纵截面，圆柱状永磁体）────
    _drawRotorLayer() {
        const { _mCX: mCX, _mCY: mCY, _rR: rR } = this;
        // 转子显示为椭圆（纵截面俯视投影）
        this._rotorEllipse = new Konva.Ellipse({
            x: mCX, y: mCY,
            radiusX: rR*0.92, radiusY: rR*0.25,
            fill: '#37474f', stroke: '#263238', strokeWidth: 1.2,
        });
        // 永磁体着色（N/S 交替）
        this._rotorMagGroups = [];
        const nPoles = this.polePairs * 2;
        for (let i = 0; i < nPoles; i++) {
            const a    = (i/nPoles)*Math.PI*2;
            const isN  = (i%2===0);
            const mag  = new Konva.Ellipse({
                x: mCX + rR*0.75*Math.cos(a)*0.95,
                y: mCY + rR*0.75*Math.sin(a)*0.25,
                radiusX: rR*0.22, radiusY: rR*0.08,
                fill: isN ? '#ef9a9a' : '#90caf9', opacity: 0.75,
                rotation: a*180/Math.PI,
            });
            this._rotorMagGroups.push(mag);
            this.group.add(mag);
        }
        this.group.add(this._rotorEllipse);
        // 参考点（旋转指示）
        this._rotorRef = new Konva.Circle({ x: mCX + rR*0.80, y: mCY, radius: 3, fill: '#ffd54f' });
        this.group.add(this._rotorRef);
    }

    // ── 三环控制框图 ─────────────────────────
    _drawControlBlock() {
        const { _ctrlX: cx, _ctrlY: cy, _ctrlW: cw, _ctrlH: ch } = this;

        this.group.add(new Konva.Rect({ x:cx, y:cy, width:cw, height:ch, fill:'#010d18', stroke:'#1a3040', strokeWidth:1.5, cornerRadius:4 }));
        this.group.add(new Konva.Rect({ x:cx, y:cy, width:cw, height:13, fill:'#0a1a28', cornerRadius:[4,4,0,0] }));
        this.group.add(new Konva.Text({ x:cx+4, y:cy+2, width:cw-8, text:'三环串级 FOC 控制框图（位置环→速度环→电流环→SVPWM）', fontSize:8, fontStyle:'bold', fill:'#80cbc4', align:'center' }));

        const y0 = cy + ch*0.44;
        const mainBlocks = [
            {lbl:'θ*\n位置给定', x:cx+14,   w:30, col:'#ffd54f', bg:'#1a1a0a'},
            {lbl:'位置环\nP控制',  x:cx+56,   w:36, col:'#66bb6a', bg:'#0a1a0a'},
            {lbl:'速度前馈\n+加速前馈',x:cx+100, w:38, col:'#ffa726', bg:'#1a1000'},
            {lbl:'速度环\nPI',     x:cx+146,  w:36, col:'#4fc3f7', bg:'#0a1520'},
            {lbl:'MTPA\niq*→id*', x:cx+190,  w:36, col:'#ce93d8', bg:'#180a28'},
            {lbl:'d轴\n电流PI',   x:cx+234,  w:36, col:'#ef9a9a', bg:'#1a0a0a'},
            {lbl:'q轴\n电流PI',   x:cx+234,  w:36, col:'#80cbc4', bg:'#0a1a18', yOff:26},
            {lbl:'前馈\n解耦',    x:cx+278,  w:32, col:'#ffd54f', bg:'#1a1a0a'},
            {lbl:'逆Park\n+SVPWM',x:cx+318,  w:38, col:'#90caf9', bg:'#0a1020'},
            {lbl:'三相\n逆变器',  x:cx+364,  w:34, col:'#e8a0a0', bg:'#1a0a0a'},
            {lbl:'PMSM\n+制动器', x:cx+406,  w:40, col:'#66bb6a', bg:'#0a1a0a'},
        ];

        mainBlocks.forEach(({ lbl, x, w, col, bg, yOff=0 }) => {
            this.group.add(new Konva.Rect({ x, y:y0-13+yOff, width:w, height:26, fill:bg, stroke:col, strokeWidth:1, cornerRadius:3 }));
            this.group.add(new Konva.Text({ x, y:y0-11+yOff, width:w, text:lbl, fontSize:6.5, fill:col, align:'center', lineHeight:1.35 }));
        });

        // 主信号线（前向通路）
        [[cx+44,cx+56],[cx+92,cx+100],[cx+138,cx+146],[cx+182,cx+190],
         [cx+226,cx+234],[cx+270,cx+278],[cx+310,cx+318],[cx+356,cx+364],[cx+398,cx+406]].forEach(([x1,x2])=>{
            this.group.add(new Konva.Arrow({ points:[x1,y0,x2,y0], stroke:'#4fc3f7', fill:'#4fc3f7', strokeWidth:1, pointerLength:4, pointerWidth:3 }));
        });

        // 位置反馈线（底部）
        const fbY1 = y0 + ch*0.40;
        this.group.add(new Konva.Line({ points:[cx+cw-18,y0+13, cx+cw-18,fbY1, cx+58,fbY1, cx+58,y0+13], stroke:'#ffd54f', strokeWidth:1, dash:[4,3], opacity:0.8 }));
        this.group.add(new Konva.Text({ x:cx+cw/2-25, y:fbY1-9, text:'θ 位置反馈（编码器）', fontSize:7, fill:'#ffd54f', opacity:0.9 }));

        // 速度反馈线
        const fbY2 = y0 + ch*0.25;
        this.group.add(new Konva.Line({ points:[cx+cw-18,y0+13, cx+cw-18,fbY2, cx+148,fbY2, cx+148,y0+13], stroke:'#4fc3f7', strokeWidth:1, dash:[3,3], opacity:0.65 }));
        this.group.add(new Konva.Text({ x:cx+cw*0.65, y:fbY2-9, text:'ω 速度反馈', fontSize:6.5, fill:'#4fc3f7', opacity:0.7 }));

        // 电流反馈线（最内层，仅到电流 PI）
        this.group.add(new Konva.Line({ points:[cx+320,y0-13, cx+320,y0-ch*0.18, cx+236,y0-ch*0.18, cx+236,y0-13], stroke:'#ef9a9a', strokeWidth:1, dash:[3,3], opacity:0.6 }));
        this.group.add(new Konva.Text({ x:cx+270, y:y0-ch*0.18-9, text:'id/iq 电流反馈', fontSize:6.5, fill:'#ef9a9a', opacity:0.65 }));

        // θ_e 路径（到 Park 变换）
        this.group.add(new Konva.Line({ points:[cx+cw-18,y0, cx+cw-18,y0-14, cx+320,y0-14], stroke:'#ffd54f', strokeWidth:0.8, dash:[3,3], opacity:0.5 }));
        this.group.add(new Konva.Text({ x:cx+cw*0.72, y:y0-22, text:'θe（转子位置）', fontSize:6, fill:'#ffd54f', opacity:0.6 }));

        // 制动器联锁线（到 PMSM 模块）
        this.group.add(new Konva.Line({ points:[cx+406+20,y0, cx+406+20,y0+ch*0.42, cx+cx+10,y0+ch*0.42], stroke:'#ffa726', strokeWidth:0.8, dash:[4,4], opacity:0.45 }));
        this.group.add(new Konva.Text({ x:cx+cw*0.5, y:y0+ch*0.42-9, text:'BRK 制动器联锁', fontSize:6.5, fill:'#ffa726', opacity:0.55 }));

        // 动态标注
        this._ctrlErrLabel = new Konva.Text({ x:cx+56, y:cy+ch-14, text:'e_pos=0', fontSize:7, fill:'#ffd54f' });
        this._ctrlSpdLabel = new Konva.Text({ x:cx+190, y:cy+ch-14, text:'ω*=0', fontSize:7, fill:'#4fc3f7' });
        this._ctrlModLabel = new Konva.Text({ x:cx+318, y:cy+ch-14, text:'M=0%', fontSize:7, fill:'#90caf9' });
        this.group.add(this._ctrlErrLabel, this._ctrlSpdLabel, this._ctrlModLabel);
    }

    // ── 位置跟踪曲线 ─────────────────────────
    _drawTraceChart() {
        const { _traceX: tx, _traceY: ty, _traceW: tw, _traceH: th } = this;

        this.group.add(new Konva.Rect({ x:tx, y:ty, width:tw, height:th, fill:'#010d18', stroke:'#1a3040', strokeWidth:1.5, cornerRadius:4 }));
        this.group.add(new Konva.Rect({ x:tx, y:ty, width:tw, height:13, fill:'#0a1a28', cornerRadius:[4,4,0,0] }));
        this.group.add(new Konva.Text({ x:tx+4, y:ty+2, width:tw-8, text:'位置跟踪曲线（给定 θ* vs 实际 θ）', fontSize:8, fontStyle:'bold', fill:'#80cbc4', align:'center' }));

        const ox=tx+12, oy=ty+th-10, aw=tw-18, ah=th-24;
        this.group.add(new Konva.Line({ points:[ox,oy-ah,ox,oy,ox+aw,oy], stroke:'#37474f', strokeWidth:0.8 }));
        this.group.add(new Konva.Text({ x:ox-10, y:oy-ah, text:'θ', fontSize:7, fill:'#80cbc4' }));
        this.group.add(new Konva.Text({ x:ox+aw+2, y:oy+2, text:'t', fontSize:7, fill:'#80cbc4' }));

        this._tracePosRefLine = new Konva.Line({ points:[], stroke:'#ffd54f', strokeWidth:1.5, lineJoin:'round', dash:[4,3] });
        this._tracePosLine    = new Konva.Line({ points:[], stroke:'#66bb6a', strokeWidth:1.8, lineJoin:'round' });
        this._traceErrLine    = new Konva.Line({ points:[], stroke:'#ef5350', strokeWidth:1.2, lineJoin:'round' });

        const lgX=tx+6, lgY=ty+14;
        [['#ffd54f','θ*（给定）'],['#66bb6a','θ（实际）'],['#ef5350','e（误差）']].forEach(([col,lbl],i)=>{
            this.group.add(new Konva.Line({ points:[lgX,lgY+i*9+3,lgX+10,lgY+i*9+3], stroke:col, strokeWidth:1.8 }));
            this.group.add(new Konva.Text({ x:lgX+12, y:lgY+i*9-1, text:lbl, fontSize:7, fill:col }));
        });
        this.group.add(this._tracePosRefLine, this._tracePosLine, this._traceErrLine);
        this._traceOX=ox; this._traceOY=oy; this._traceAW=aw; this._traceAH=ah;
    }

    // ── S 曲线速度规划可视化 ─────────────────
    _drawSCurveChart() {
        const { _scrvX: sx, _scrvY: sy, _scrvW: sw, _scrvH: sh } = this;

        this.group.add(new Konva.Rect({ x:sx, y:sy, width:sw, height:sh, fill:'#010d18', stroke:'#1a3040', strokeWidth:1.5, cornerRadius:4 }));
        this.group.add(new Konva.Rect({ x:sx, y:sy, width:sw, height:13, fill:'#0a1a28', cornerRadius:[4,4,0,0] }));
        this.group.add(new Konva.Text({ x:sx+4, y:sy+2, width:sw-8, text:'S 曲线速度规划（Jerk 限制）', fontSize:8, fontStyle:'bold', fill:'#80cbc4', align:'center' }));

        const ox=sx+12, oy=sy+sh-10, aw=sw-18, ah=sh-26;
        this.group.add(new Konva.Line({ points:[ox,oy-ah,ox,oy,ox+aw,oy], stroke:'#37474f', strokeWidth:0.8 }));
        this.group.add(new Konva.Text({ x:ox-10, y:oy-ah, text:'v', fontSize:7, fill:'#80cbc4' }));
        this.group.add(new Konva.Text({ x:ox+aw+2, y:oy+2, text:'t', fontSize:7, fill:'#80cbc4' }));

        // S 曲线形状（静态示意，7段）
        const pts=[];
        const T=1.0, Vm=1.0, Jm=1.0;
        const t1=0.15, t2=0.35, t3=0.50, t4=0.65, t5=0.80, t6=0.90;
        for (let i=0; i<=80; i++) {
            const t=i/80;
            let v=0;
            if      (t<t1) v=Jm*t*t/2;
            else if (t<t2) v=Jm*t1*t1/2+Jm*t1*(t-t1);
            else if (t<t3) v=Jm*t1*t1/2+Jm*t1*(t2-t1)-Jm*(t-t2)*(t-t2)/2+Jm*t1*(t-t2);
            else if (t<t4) v=Vm*0.9;
            else if (t<t5) v=Vm*0.9-Jm*(t-t4)*(t-t4)/2;
            else if (t<t6) v=Vm*0.9-Jm*t1*t1/2-Jm*t1*(t-t5);
            else           v=Vm*0.9-Jm*t1*t1/2-Jm*t1*(t6-t5)-Jm*(t-t6)*(t-t6+2*t1)/2;
            pts.push(ox+t*aw, oy-Math.max(0,v)*(ah-4));
        }
        this.group.add(new Konva.Line({ points:pts, stroke:'#4fc3f7', strokeWidth:1.8, lineJoin:'round', opacity:0.6 }));

        // 七段标注
        const segXs=[t1,t2,t3,t4,t5,t6].map(t=>ox+t*aw);
        segXs.forEach(x=>this.group.add(new Konva.Line({points:[x,sy+14,x,oy],stroke:'#37474f',strokeWidth:0.6,dash:[3,3]})));
        ['Jerk↑','匀加速','Jerk↓','匀速','Jerk↓','匀减速','Jerk↑'].forEach((lbl,i)=>{
            const xl=ox+(([0,t1,t2,t3,t4,t5,t6][i]+[t1,t2,t3,t4,t5,t6,1][i])/2)*aw;
            this.group.add(new Konva.Text({x:xl-10,y:sy+14,width:20,text:lbl,fontSize:5.5,fill:'#546e7a',align:'center'}));
        });
        this.group.add(new Konva.Text({x:ox+aw*0.5,y:sy+sh-22,text:`Jmax=${this.profileMaxJerk}rpm/s²`,fontSize:7,fill:'#4fc3f7',align:'center',width:sw-14}));

        // 动态指示点（当前规划速度）
        this._scrvPoint = new Konva.Circle({ x:ox, y:oy, radius:5, fill:'#66bb6a', stroke:'#2e7d32', strokeWidth:1.5 });
        this.group.add(this._scrvPoint);
        this._scrvOX=ox; this._scrvOY=oy; this._scrvAW=aw; this._scrvAH=ah;
    }

    // ── 制动器状态面板 ────────────────────────
    _drawBrakePanel() {
        const { _brkX: bx, _brkY: by, _brkW: bw, _brkH: bh } = this;

        this.group.add(new Konva.Rect({ x:bx, y:by, width:bw, height:bh, fill:'#100a00', stroke:'#ffa726', strokeWidth:1.5, cornerRadius:4 }));
        this.group.add(new Konva.Rect({ x:bx, y:by, width:bw, height:13, fill:'#1a1000', cornerRadius:[4,4,0,0] }));
        this.group.add(new Konva.Text({ x:bx+4, y:by+2, width:bw-8, text:'制动器状态', fontSize:8, fontStyle:'bold', fill:'#ffa726', align:'center' }));

        // 制动器大状态图标
        const iconCX=bx+bw/2, iconCY=by+bh*0.35;
        const iconR=Math.round(Math.min(bw,bh)*0.20);
        this._brakeIconBg  = new Konva.Circle({ x:iconCX, y:iconCY, radius:iconR, fill:'#c62828', stroke:'#ef5350', strokeWidth:2 });
        this._brakeIconText= new Konva.Text({ x:iconCX-iconR, y:iconCY-14, width:iconR*2, text:'🔒\n制动', fontSize:11, fill:'#ffcdd2', align:'center', lineHeight:1.2 });
        this.group.add(this._brakeIconBg, this._brakeIconText);

        // 参数列
        const cells=[
            {lbl:'线圈 I',  id:'brkI',  unit:'A',   color:'#ffa726'},
            {lbl:'线圈 U',  id:'brkU',  unit:'V',   color:'#ffd54f'},
            {lbl:'气隙 δ',  id:'brkGap',unit:'mm',  color:'#80cbc4'},
            {lbl:'制动力矩',id:'brkTq', unit:'N·m', color:'#ef9a9a'},
            {lbl:'温升ΔT',  id:'brkT',  unit:'°C',  color:'#ff7043'},
            {lbl:'磨损',    id:'brkWear',unit:'%',  color:'#ce93d8'},
        ];
        const cellW=(bw-8)/2, cellH=20, gap=2;
        this._brkCells={};
        cells.forEach(({lbl,id,unit,color},i)=>{
            const col=i%2, row=Math.floor(i/2);
            const cx3=bx+4+col*(cellW+gap), cy3=by+bh*0.58+row*(cellH+gap);
            this.group.add(new Konva.Rect({x:cx3,y:cy3,width:cellW,height:cellH,fill:'#1a1000',cornerRadius:2,stroke:'#2a1500',strokeWidth:0.5}));
            this.group.add(new Konva.Text({x:cx3+2,y:cy3+2,text:lbl,fontSize:6.5,fill:'#5d4037'}));
            const val=new Konva.Text({x:cx3+2,y:cy3+9,width:cellW-4,text:'--',fontSize:9,fontFamily:'Courier New, monospace',fontStyle:'bold',fill:color,align:'right'});
            this.group.add(new Konva.Text({x:cx3+2,y:cy3+13,width:cellW-4,text:unit,fontSize:6,fill:'#1a0a00',align:'right'}));
            this._brkCells[id]=val;
            this.group.add(val);
        });
    }

    // ── LCD 仪表 ─────────────────────────────
    _drawLCDPanel() {
        const { _lcdX: lx, _lcdY: ly, _lcdW: lw, _lcdH: lh } = this;

        this.group.add(new Konva.Rect({x:lx,y:ly,width:lw,height:lh,fill:'#020c14',stroke:'#1a3040',strokeWidth:1.5,cornerRadius:4}));
        this.group.add(new Konva.Rect({x:lx,y:ly,width:lw,height:13,fill:'#0a1a28',cornerRadius:[4,4,0,0]}));
        this.group.add(new Konva.Text({x:lx+4,y:ly+2,width:lw-8,text:'伺服运行仪表',fontSize:8,fontStyle:'bold',fill:'#80cbc4',align:'center'}));

        const cells=[
            {label:'位置θ',   id:'pos',   unit:'deg',  color:'#ffd54f'},
            {label:'速度ω',   id:'spd',   unit:'rpm',  color:'#4fc3f7'},
            {label:'转矩T',   id:'tq',    unit:'N·m',  color:'#66bb6a'},
            {label:'位置误差',id:'perr',  unit:'deg',  color:'#ef5350'},
            {label:'iq',      id:'iq',    unit:'A',    color:'#80cbc4'},
            {label:'id',      id:'iid',   unit:'A',    color:'#ef9a9a'},
            {label:'编码器',  id:'enc',   unit:'cnt',  color:'#ffd54f'},
            {label:'模式',    id:'mode',  unit:'',     color:'#ce93d8'},
            {label:'制动器',  id:'brake', unit:'',     color:'#ffa726'},
            {label:'效率',    id:'eff',   unit:'%',    color:'#66bb6a'},
            {label:'输出P',   id:'pout',  unit:'W',    color:'#90caf9'},
            {label:'热警告',  id:'heat',  unit:'',     color:'#ff7043'},
        ];

        const cellW=(lw-8)/3, cellH=22, gap=2;
        this._lcdCells={};
        cells.forEach(({label,id,unit,color},i)=>{
            const col=i%3, row=Math.floor(i/3);
            const cx3=lx+4+col*(cellW+gap), cy3=ly+16+row*(cellH+gap);
            this.group.add(new Konva.Rect({x:cx3,y:cy3,width:cellW,height:cellH,fill:'#0d1520',cornerRadius:2}));
            this.group.add(new Konva.Text({x:cx3+2,y:cy3+2,text:label,fontSize:6.5,fill:'#37474f'}));
            const val=new Konva.Text({x:cx3+2,y:cy3+9,width:cellW-4,text:'--',fontSize:9,fontFamily:'Courier New, monospace',fontStyle:'bold',fill:color,align:'right'});
            this.group.add(new Konva.Text({x:cx3+2,y:cy3+14,width:cellW-4,text:unit,fontSize:6,fill:'#1a252f',align:'right'}));
            this._lcdCells[id]=val;
            this.group.add(val);
        });
    }

    // ── 控制面板 ─────────────────────────────
    _drawControlPanel() {
        const { _panX: px, _panY: py, _panW: pw, _panH: ph } = this;

        this.group.add(new Konva.Rect({x:px,y:py,width:pw,height:ph,fill:'#0d1520',stroke:'#1a3040',strokeWidth:1.5,cornerRadius:4}));
        this.group.add(new Konva.Rect({x:px,y:py,width:pw,height:13,fill:'#0a1a28',cornerRadius:[4,4,0,0]}));
        this.group.add(new Konva.Text({x:px+4,y:py+2,width:pw-8,text:'运动控制操作',fontSize:8,fontStyle:'bold',fill:'#80cbc4',align:'center'}));

        const bW=(pw-20)/6, bH=18, bY=py+16;
        // 运动控制按钮组
        [['▶ 使能','#1a3a1a','#2e7d32','#66bb6a',()=>this.servoOn()],
         ['■ 禁能','#3a1a1a','#c62828','#ef5350',()=>this.servoOff()],
         ['↗ 点动+','#0a1a3a','#1565c0','#64b5f6',()=>this.jog(1)],
         ['↙ 点动-','#1a0a3a','#6a1b9a','#ce93d8',()=>this.jog(-1)],
         ['⌂ 回零', '#1a1a0a','#f57f17','#ffd54f',()=>this.home()],
         ['▷▷ 运行','#0a2a1a','#2e7d32','#a5d6a7',()=>this.moveToTarget()],
        ].forEach(([lbl,fill,stroke,col,cb],i)=>{
            const bx=px+4+i*(bW+2);
            const btn=new Konva.Rect({x:bx,y:bY,width:bW,height:bH,fill,stroke,strokeWidth:1.5,cornerRadius:3});
            const t=new Konva.Text({x:bx,y:bY+4,width:bW,text:lbl,fontSize:8,fontStyle:'bold',fill:col,align:'center'});
            btn.on('click tap',cb);
            btn.on('mouseenter',()=>btn.opacity(0.75));
            btn.on('mouseleave',()=>btn.opacity(1));
            this.group.add(btn,t);
        });

        // 制动器手动控制
        const brkBY=bY, brkBX=px+pw-66;
        const brkBtn=new Konva.Rect({x:brkBX,y:brkBY,width:60,height:bH,fill:'#1a1000',stroke:'#ffa726',strokeWidth:1.5,cornerRadius:3});
        this._brkBtnText=new Konva.Text({x:brkBX,y:brkBY+4,width:60,text:'制动器：OFF',fontSize:8,fontStyle:'bold',fill:'#ffa726',align:'center'});
        brkBtn.on('click tap',()=>this.toggleBrake());
        this.group.add(brkBtn, this._brkBtnText);

        // 滑块
        const sliders=[
            {label:`目标位置（deg）`, key:'tpos', color:'#ffd54f',
             getR:()=>((this._targetPosDeg%3600)+3600)%3600/3600,
             set:r=>{this._targetPosDeg=r*3600-1800;}, disp:()=>`${this._targetPosDeg.toFixed(0)}°`},
            {label:`最高速度（${this.profileMaxSpd}rpm）`, key:'spd', color:'#4fc3f7',
             getR:()=>this.profileMaxSpd/this.maxSpeed,
             set:r=>{this.profileMaxSpd=r*this.maxSpeed;}, disp:()=>`${Math.round(this.profileMaxSpd)}rpm`},
            {label:`负载转矩（${this.ratedTorque.toFixed(2)}N·m rated）`, key:'load', color:'#ffa726',
             getR:()=>this._loadTorque/this.peakTorque,
             set:r=>{this._loadTorque=r*this.peakTorque;}, disp:()=>`${this._loadTorque.toFixed(3)}N·m`},
        ];

        const slW=(pw-20)/3-24;
        this._sliderBars={};
        sliders.forEach(({label,key,color,getR,set,disp},si)=>{
            const slX=px+4+si*(slW+30), slY=py+42;
            this.group.add(new Konva.Text({x:slX,y:slY-11,text:label,fontSize:7,fill:'#546e7a'}));
            this.group.add(new Konva.Rect({x:slX,y:slY,width:slW,height:8,fill:'#0a0a18',cornerRadius:2}));
            const bar=new Konva.Rect({x:slX,y:slY,width:0,height:8,fill:color,cornerRadius:2});
            const txt=new Konva.Text({x:slX+slW+4,y:slY-2,width:28,text:'--',fontSize:8,fontFamily:'Courier New, monospace',fill:color});
            const hit=new Konva.Rect({x:slX,y:slY-2,width:slW,height:12,fill:'transparent'});
            hit.on('click tap mousedown',e=>{
                const stage=this.group.getStage?.();
                const pos=stage?.getPointerPosition?.()??{x:e.evt?.clientX??0};
                set(Math.max(0,Math.min(1,(pos.x-(this.group.x?.()??0)-slX)/slW)));
            });
            this.group.add(bar,txt,hit);
            this._sliderBars[key]={bar,txt,slW,getR,disp};
        });
    }

    // ── 波形区 ─────────────────────────────
    _drawWaveform() {
        const { _wavX: wx, _wavY: wy, _wavW: ww, _wavH: wh } = this;
        if (wh<14) return;

        this.group.add(new Konva.Rect({x:wx,y:wy,width:ww,height:wh,fill:'#010d18',stroke:'#1a3040',strokeWidth:1.5,cornerRadius:4}));
        this.group.add(new Konva.Rect({x:wx,y:wy,width:ww,height:12,fill:'#0a1a28',cornerRadius:[4,4,0,0]}));
        this.group.add(new Konva.Text({x:wx+4,y:wy+1,width:ww-8,text:'速度 ω   转矩 T   q轴电流 iq   d轴电流 id   制动器气隙 δ',fontSize:8,fill:'#80cbc4',align:'center'}));

        const nCh=4, hCh=(wh-12)/nCh;
        this._wavMids=Array.from({length:nCh},(_,i)=>wy+12+hCh*(i+0.5));
        this._wavMids.forEach(my=>this.group.add(new Konva.Line({points:[wx+2,my,wx+ww-2,my],stroke:'rgba(200,200,200,0.06)',strokeWidth:0.5,dash:[4,3]})));

        this._wLSpd  =new Konva.Line({points:[],stroke:'#4fc3f7',strokeWidth:1.5,lineJoin:'round'});
        this._wLTq   =new Konva.Line({points:[],stroke:'#ffd54f',strokeWidth:1.5,lineJoin:'round'});
        this._wLIq   =new Konva.Line({points:[],stroke:'#80cbc4',strokeWidth:1.5,lineJoin:'round'});
        this._wLId   =new Konva.Line({points:[],stroke:'#ef9a9a',strokeWidth:1.5,lineJoin:'round'});
        this._wLBrkG =new Konva.Line({points:[],stroke:'#ffa726',strokeWidth:2,lineJoin:'round'});

        ['ω(rpm)','T(N·m)','iq(A)','δ制动'].forEach((l,i)=>{
            this.group.add(new Konva.Text({x:wx+4,y:wy+12+hCh*i+3,text:l,fontSize:8,fill:['#4fc3f7','#ffd54f','#80cbc4','#ffa726'][i]}));
        });
        this.group.add(this._wLSpd,this._wLTq,this._wLIq,this._wLId,this._wLBrkG);
        this._wavHCh=hCh;
    }

    // ═══════════════════════════════════════════
    // 集中化 tick（由 consys._tickAll 在 20fps 调用）
    tick(dt) {
        this._tickBrakePhysics(dt);
        this._tickServoPhysics(dt);
        this._tickRotorViz();
        this._tickBrakeViz();
        this._tickTraceChart();
        this._tickSCrvPoint();
        this._tickWaveform();
        this._tickDisplay();
        this._refreshCache();
    }

    // ── 制动器物理仿真 ────────────────────────
    _tickBrakePhysics(dt) {
        // 线圈电流（RL 一阶）
        const tauBrk = this.brakeL / (this.brakeR+1e-9);
        const iTarget= this._brakeEnergized ? this.brakeVoltage/this.brakeR : 0;
        this._brakeCoilI += (iTarget - this._brakeCoilI)*(1-Math.exp(-dt/tauBrk));
        this._brakeCoilI  = Math.max(0, this._brakeCoilI);

        // 电磁吸力（F∝I²，简化）
        const I_rated = this.brakeVoltage/this.brakeR;
        const F_em    = this.brakeSpring * (this._brakeCoilI/I_rated)**2 * 1.1;

        // 气隙（0=抱闸，1=松开）
        const engaged = F_em > this.brakeSpring * 0.85;
        const tauGap  = engaged ? this.brakeEngageT : this.brakeReleaseT;
        const gapTarget= engaged ? 1.0 : 0.0;
        this._brakeGapNorm += (gapTarget - this._brakeGapNorm)*(1-Math.exp(-dt/tauGap));
        this._brakeGap      = this._brakeGapNorm * this.brakeAirGap;

        // 实际制动转矩（气隙越小，制动力越大；考虑热衰退）
        const tempFactor = Math.max(0.5, 1-(this._brakeTemp-25)*0.003);
        const wearFactor = Math.max(0.6, 1-this._brakeWear/this.brakeMassWear*0.4);
        this._brakeTorqueAct = this.brakeTorque * (1-this._brakeGapNorm) * tempFactor * wearFactor;

        // 制动器滑动（电机在运动且制动器抱闸）
        this._brakeSlipping = this._brakeTorqueAct > 0.05 && Math.abs(this._omegaR) > 0.1;
        if (this._brakeSlipping) {
            const slipPower  = this._brakeTorqueAct * Math.abs(this._omegaR);
            // 热模型（一阶热平衡）
            const dT  = (slipPower * this.brakeThermalR - (this._brakeTemp-25)) * dt / this.brakeThermalC * 10;
            this._brakeTemp = Math.max(25, this._brakeTemp + dT);
            // 磨损累计（简化：按滑动能量）
            this._brakeSlipE += slipPower * dt;
            if (this._brakeSlipE > 100) { this._brakeWear++; this._brakeSlipE = 0; }
        } else {
            // 冷却
            this._brakeTemp += (25 - this._brakeTemp) * dt * 0.05;
        }
    }

    // ── 伺服物理仿真（FOC + 三环控制） ───────
    _tickServoPhysics(dt) {
        // 制动器未完全松开时，增加摩擦转矩
        const brakeFriction = this._brakeTorqueAct;

        if (!this._running) {
            const drag = this.B*this._omegaR;
            const bDrag= brakeFriction * Math.sign(this._omegaR);
            this._omegaR = Math.max(0, this._omegaR - (drag+Math.abs(bDrag))/this.J*dt);
            this._omegaR = this._omegaR > 0.01 ? this._omegaR : 0;
            this._thetaM += this._omegaR*dt;
            this._thetaE  = this._thetaM*this.polePairs;
            this.torqueEM  = 0;
            this._id=this._iq=0;
            this._updateWavBufs();
            return;
        }

        // S 曲线规划器更新
        this._updateProfiler(dt);

        // ── 位置外环（P 控制）──
        this._posErr   = this._posRef - this._thetaM;
        const dPosErr  = (this._posErr - this._posErrPrev) / (dt+1e-9);
        this._posErrPrev = this._posErr;
        const spdCmdPos= this.Kp_pos * this._posErr + this.Kd_pos * dPosErr;

        // 前馈：速度前馈 + 加速度前馈
        const spdFF   = this.Kff_spd * this._spdRef;
        const accFF_T = this.Kff_acc * this.J * (this._spdRef - this._omegaR) / (dt+1e-9);

        const spdCmd  = spdCmdPos + spdFF;
        const spdClamped = Math.max(-this.maxOmega, Math.min(this.maxOmega, spdCmd));

        // ── 速度环（PI 控制）──
        const spdErr   = spdClamped - this._omegaR;
        this._intSpd  += spdErr * this.Ki_spd * dt;
        this._intSpd   = Math.max(-this.peakTorque, Math.min(this.peakTorque, this._intSpd));
        const tqCmd    = this.Kp_spd*spdErr + this._intSpd + accFF_T;
        const tqClamped= Math.max(-this.peakTorque, Math.min(this.peakTorque, tqCmd));

        // ── MTPA → iq/id 给定 ──
        const iqRef_raw= tqClamped / (1.5*this.polePairs*this.psiF+1e-9);
        const {id:idMTPA} = this._calcMTPA(Math.min(this.peakCurrent, Math.abs(iqRef_raw)));
        const iqMax    = Math.sqrt(Math.max(0, this.peakCurrent**2 - idMTPA**2));
        const iqRef    = Math.max(-iqMax, Math.min(iqMax, iqRef_raw));
        const idRef    = idMTPA;

        // 弱磁
        let idRefFW = idRef;
        const omegaE = this._omegaR * this.polePairs;
        const Vmax   = this.ratedVoltage / Math.sqrt(3);
        if (this._omegaR > this.ratedSpeed*2*Math.PI/60*this.polePairs*0.95) {
            const excess = (omegaE*this.psiF - Vmax) / (omegaE*this.Ld+1e-9);
            idRefFW = Math.min(0, idRef - excess*0.5);
            idRefFW = Math.max(-this.peakCurrent, idRefFW);
        }

        // ── 电流环（PI，含解耦）──
        const idErr  = idRefFW - this._id;
        const iqErr  = iqRef   - this._iq;
        this._intId += idErr * this.Ki_cur * dt;
        this._intIq += iqErr * this.Ki_cur * dt;
        this._intId  = Math.max(-Vmax, Math.min(Vmax, this._intId));
        this._intIq  = Math.max(-Vmax, Math.min(Vmax, this._intIq));

        const decoupD = -omegaE * this.Lq * this._iq;
        const decoupQ =  omegaE * (this.Ld*this._id + this.psiF);
        const udCmd   = this.Kp_cur*idErr + this._intId + decoupD;
        const uqCmd   = this.Kp_cur*iqErr + this._intIq + decoupQ;

        const usMag   = Math.sqrt(udCmd**2+uqCmd**2);
        const scale   = usMag>Vmax ? Vmax/usMag : 1;
        this._ud      = udCmd*scale; this._uq=uqCmd*scale;
        this._modRatio= Math.sqrt(this._ud**2+this._uq**2)/Vmax;

        // 电流动态
        const tauD = this.Ld/(this.Rs+1e-9), tauQ=this.Lq/(this.Rs+1e-9);
        const idSS = (this._ud + omegaE*this.Lq*this._iq) / (this.Rs+1e-9);
        const iqSS = (this._uq - omegaE*(this.Ld*this._id+this.psiF)) / (this.Rs+1e-9);
        this._id  += (idSS-this._id)*(1-Math.exp(-dt/tauD));
        this._iq  += (iqSS-this._iq)*(1-Math.exp(-dt/tauQ));
        const isNow=Math.sqrt(this._id**2+this._iq**2);
        if (isNow>this.peakCurrent*1.05) { this._id*=this.peakCurrent/isNow; this._iq*=this.peakCurrent/isNow; }

        // 电磁转矩
        this.torquePM  = 1.5*this.polePairs*this.psiF*this._iq;
        this.torqueRel = 1.5*this.polePairs*(this.Ld-this.Lq)*this._id*this._iq;
        this.torqueEM  = this.torquePM + this.torqueRel;

        // 机械方程（含制动器摩擦）
        const frSign = Math.sign(this._omegaR) || Math.sign(this.torqueEM);
        const netTq  = this.torqueEM - this._loadTorque - this.B*this._omegaR - brakeFriction*frSign;
        this._omegaR += netTq/this.J*dt;
        this._omegaR  = Math.max(-this.maxOmega, Math.min(this.maxOmega, this._omegaR));

        this._thetaM += this._omegaR*dt;
        this._thetaE  = this._thetaM*this.polePairs;

        // 编码器
        this._encCounts = Math.round(this._thetaM/(2*Math.PI)*this.encoderCPR)
                        + Math.round((Math.random()-0.5)*this.encNoise*2);

        // 功率/效率
        const pCu    = 1.5*this.Rs*(this._id**2+this._iq**2);
        this.powerOut= this.torqueEM*this._omegaR;
        this.powerIn = this.powerOut+pCu+0.002*this.ratedPower;
        this.efficiency = this.powerIn>0.5 ? Math.min(98, this.powerOut/this.powerIn*100) : 0;

        this._updateWavBufs();
    }

    // S 曲线规划器（7段梯形速度规划）
    _updateProfiler(dt) {
        const prof = this._profile;
        if (!prof.active) return;

        prof.t += dt;
        const tArr  = prof.phase_t;
        const tSum  = tArr.reduce((s,v)=>s+v,0);

        if (prof.t >= tSum) {
            this._thetaM = prof.theta_end;
            this._posRef = prof.theta_end;
            this._spdRef = 0;
            prof.active  = false;
            return;
        }

        // 7段梯形速度（简化：3段加减速+匀速）
        let t=prof.t, v=0, pos=prof.theta_start;
        const Vm=prof.vmax, Am=prof.amax, Jm=prof.jmax;
        const [t1,t2,t3,t4,t5,t6,t7]=tArr;
        const c1=t1, c2=c1+t2, c3=c2+t3, c4=c3+t4, c5=c4+t5, c6=c5+t6;

        if      (t<=c1) { v=Jm*t*t/2; }
        else if (t<=c2) { const dt2=t-c1; v=Jm*t1*t1/2+Am*dt2; }
        else if (t<=c3) { const dt3=t-c2; v=Jm*t1*t1/2+Am*t2+Jm*t1*dt3-Jm*dt3*dt3/2; }
        else if (t<=c4) { v=Vm; }
        else if (t<=c5) { const dt5=t-c4; v=Vm-Jm*dt5*dt5/2; }
        else if (t<=c6) { const dt6=t-c5; v=Vm-Jm*t1*t1/2-Am*dt6; }
        else            { const dt7=t-c6; v=Vm-Jm*t1*t1/2-Am*t6-Jm*t1*dt7+Jm*dt7*dt7/2; }

        v = Math.max(0, v) * Math.sign(prof.theta_end - prof.theta_start);
        this._spdRef = v;
        this._posRef += v*dt;
    }

    _calcMTPA(is) {
        if (Math.abs(this.Ld-this.Lq)<1e-6) return {id:0,iq:is};
        const dLdq = this.Lq - this.Ld;
        const disc = this.psiF**2 + 8*dLdq**2*is**2;
        const id   = (this.psiF - Math.sqrt(disc))/(4*dLdq);
        const iq   = Math.sqrt(Math.max(0, is**2 - id**2));
        return {id:Math.max(-is,id), iq};
    }

    _updateWavBufs() {
        const spd=this._omegaR*60/(2*Math.PI);
        this._wavPos    = new Float32Array([...this._wavPos.slice(1),    this._thetaM*180/Math.PI]);
        this._wavPosRef = new Float32Array([...this._wavPosRef.slice(1), this._posRef*180/Math.PI]);
        this._wavSpd    = new Float32Array([...this._wavSpd.slice(1),    spd]);
        this._wavTq     = new Float32Array([...this._wavTq.slice(1),     this.torqueEM]);
        this._wavIq     = new Float32Array([...this._wavIq.slice(1),     this._iq]);
        this._wavId     = new Float32Array([...this._wavId.slice(1),     this._id]);
        this._wavBrakeG = new Float32Array([...this._wavBrakeG.slice(1), this._brakeGapNorm]);
    }

    // ── 转子旋转动画 ─────────────────────────
    _tickRotorViz() {
        // 纵截面：旋转通过改变颜色饱和度和参考点位置模拟
        const th = this._thetaM;
        if (this._rotorRef) {
            const rR=this._rR;
            this._rotorRef.x(this._mCX + rR*0.80*Math.cos(th)*0.95);
            this._rotorRef.y(this._mCY + rR*0.80*Math.sin(th)*0.26);
        }
        // 磁极颜色（旋转感）
        this._rotorMagGroups?.forEach((mag,i)=>{
            const a=(i/this._rotorMagGroups.length)*Math.PI*2+th;
            const alpha=0.4+0.35*Math.abs(Math.cos(a));
            mag.opacity(alpha);
        });
    }

    // ── 制动器动画 ────────────────────────────
    _tickBrakeViz() {
        this._brakeAnimGroup.destroyChildren();

        // 衔铁位置（在抱闸位置和松开位置之间插值）
        const yArmature = this._brakeArmatureY1 + this._brakeGapNorm*(this._brakeArmatureY0 - this._brakeArmatureY1);
        if (this._brakeArmatureRect) this._brakeArmatureRect.y(yArmature);

        // 线圈发光（随电流）
        const glowAlpha = Math.min(0.4, this._brakeCoilI/(this.brakeVoltage/this.brakeR)*0.4);
        if (this._brakeCoilGlow) this._brakeCoilGlow.fill(`rgba(255,167,38,${glowAlpha})`);

        // 气隙标注（动态）
        const gapMM = (this._brakeGap*1000).toFixed(3);
        if (this._brakeGapLabel) this._brakeGapLabel.text(`δ=${gapMM}mm`);
        if (this._brakeGapLine) {
            this._brakeGapLine.points([
                this._brakeSectionBLeft+4, yArmature+10,
                this._brakeSectionBLeft+4, this._brakeSectionFrY,
            ]);
        }

        // 制动器滑动摩擦（火花/热效果）
        if (this._brakeSlipping && this._brakeTorqueAct>0.1) {
            const bCX=(this._brakeSectionBLeft+this._csX+this._csW)/2;
            const bCY=this._brakeSectionFrY+4;
            for (let i=0;i<4;i++) {
                const a=Math.random()*Math.PI*2;
                const r=3+Math.random()*8;
                this._brakeAnimGroup.add(new Konva.Line({
                    points:[bCX,bCY,bCX+r*Math.cos(a),bCY+r*Math.sin(a)],
                    stroke:`rgba(255,${Math.round(200+Math.random()*55)},50,${0.5+Math.random()*0.4})`,
                    strokeWidth:1.5,lineCap:'round',
                }));
            }
        }
    }

    // ── 位置跟踪曲线 ─────────────────────────
    _tickTraceChart() {
        const n=this._wavLen, aw=this._traceAW, ah=this._traceAH;
        const ox=this._traceOX, oy=this._traceOY;
        const wx=ox+1, dx=aw/n;

        const posMax = Math.max(1, Math.abs(this._targetPosDeg)*1.2, 360);
        const errMax = Math.max(0.1, this.ratedTorque*5);

        const ptRef=[], ptPos=[], ptErr=[];
        for (let i=0;i<n;i++) {
            const x=wx+i*dx;
            ptRef.push(x, oy-(this._wavPosRef[i]/posMax)*(ah-4));
            ptPos.push(x, oy-(this._wavPos[i]   /posMax)*(ah-4));
            const err=this._wavPosRef[i]-this._wavPos[i];
            ptErr.push(x, oy-(err/posMax)*(ah-4)*0.4);
        }
        this._tracePosRefLine.points(ptRef);
        this._tracePosLine.points(ptPos);
        this._traceErrLine.points(ptErr);
    }

    // ── S 曲线当前点 ──────────────────────────
    _tickSCrvPoint() {
        if (!this._scrvPoint) return;
        const vNorm = Math.abs(this._omegaR) / this.maxOmega;
        const tNorm = this._profile.active ? (this._profile.t / (this._profile.phase_t.reduce((s,v)=>s+v,0)+1e-9)) : 0;
        const px    = Math.max(this._scrvOX, Math.min(this._scrvOX+this._scrvAW, this._scrvOX+tNorm*this._scrvAW));
        const py    = Math.max(this._scrvOY-this._scrvAH+2, Math.min(this._scrvOY, this._scrvOY-vNorm*(this._scrvAH-4)));
        this._scrvPoint.x(px); this._scrvPoint.y(py);
        this._scrvPoint.fill(this._profile.active ? '#66bb6a' : '#37474f');
    }

    // ── 波形更新 ─────────────────────────────
    _tickWaveform() {
        if (!this._wavHCh||!this._wavMids) return;
        const wx=this._wavX+3, ww=this._wavW-6, n=this._wavLen;
        const dx=ww/n, hCh=this._wavHCh;
        const [mS,mT,mI,mG]=this._wavMids;

        const spdMax=Math.max(1,this.maxSpeed);
        const tqMax =Math.max(0.01,this.peakTorque);
        const iPk   =Math.max(0.01,this.peakCurrent);

        const ptS=[],ptT=[],ptIq=[],ptId=[],ptG=[];
        for (let i=0;i<n;i++) {
            const x=wx+i*dx;
            ptS.push(x,  mS-(this._wavSpd[i]/spdMax)*hCh*0.38);
            ptT.push(x,  mT-(this._wavTq[i] /tqMax) *hCh*0.38);
            ptIq.push(x, mI-(this._wavIq[i] /iPk)   *hCh*0.38);
            ptId.push(x, mI-(this._wavId[i] /iPk)   *hCh*0.36);
            ptG.push(x,  mG-(this._wavBrakeG[i])     *hCh*0.38);
        }
        this._wLSpd.points(ptS); this._wLTq.points(ptT);
        this._wLIq.points(ptIq); this._wLId.points(ptId);
        this._wLBrkG.points(ptG);
    }

    // ── 仪表显示 ─────────────────────────────
    _tickDisplay() {
        const c=this._lcdCells, bc=this._brkCells;
        const spd=this._omegaR*60/(2*Math.PI);
        const posD=this._thetaM*180/Math.PI;
        const errD=this._posErr*180/Math.PI;
        const brakeState=this._brakeGapNorm<0.1?'🔒制动':(this._brakeGapNorm>0.9?'🔓松开':'过渡');

        if (c){
            if (c.pos)   c.pos.text(posD.toFixed(2));
            if (c.spd)   c.spd.text(Math.abs(spd).toFixed(0));
            if (c.tq) {  c.tq.text(this.torqueEM.toFixed(3));
                         c.tq.fill(Math.abs(this.torqueEM)>this.ratedTorque*1.1?'#ef5350':'#66bb6a'); }
            if (c.perr){ c.perr.text(errD.toFixed(3));
                         c.perr.fill(Math.abs(errD)>0.5?'#ef5350':Math.abs(errD)>0.1?'#ffa726':'#66bb6a'); }
            if (c.iq)    c.iq.text(this._iq.toFixed(3));
            if (c.iid)   c.iid.text(this._id.toFixed(3));
            if (c.enc)   c.enc.text(((this._encCounts%this.encoderCPR+this.encoderCPR)%this.encoderCPR).toString());
            if (c.mode)  c.mode.text(this._mode);
            if (c.brake){ c.brake.text(brakeState);
                          c.brake.fill(this._brakeGapNorm<0.1?'#ffa726':'#66bb6a'); }
            if (c.eff) { c.eff.text(this.efficiency.toFixed(1));
                         c.eff.fill(this.efficiency>90?'#66bb6a':this.efficiency>70?'#ffa726':'#ef5350'); }
            if (c.pout)  c.pout.text(Math.max(0,this.powerOut).toFixed(0));
            if (c.heat){ c.heat.text(this._brakeTemp>80?`⚠${this._brakeTemp.toFixed(0)}°C`:'正常');
                         c.heat.fill(this._brakeTemp>80?'#ef5350':'#66bb6a'); }
        }

        if (bc){
            if (bc.brkI)   bc.brkI.text(this._brakeCoilI.toFixed(3));
            if (bc.brkU)   bc.brkU.text((this._brakeEnergized?this.brakeVoltage:0).toFixed(0));
            if (bc.brkGap) bc.brkGap.text((this._brakeGap*1000).toFixed(4));
            if (bc.brkTq)  bc.brkTq.text(this._brakeTorqueAct.toFixed(3));
            if (bc.brkT) { bc.brkT.text((this._brakeTemp-25).toFixed(1));
                           bc.brkT.fill(this._brakeTemp>80?'#ef5350':this._brakeTemp>60?'#ffa726':'#ff7043'); }
            if (bc.brkWear)bc.brkWear.text((this._brakeWear/this.brakeMassWear*100).toFixed(4));
        }

        // 制动器图标
        if (this._brakeIconBg) {
            const released=this._brakeGapNorm>0.85;
            this._brakeIconBg.fill(released?'#1b5e20':'#c62828');
            this._brakeIconBg.stroke(released?'#66bb6a':'#ef5350');
        }
        if (this._brakeIconText) {
            const released=this._brakeGapNorm>0.85;
            this._brakeIconText.text(released?'🔓\n松开':'🔒\n制动');
            this._brakeIconText.fill(released?'#c8e6c9':'#ffcdd2');
        }
        if (this._brkBtnText) this._brkBtnText.text(`制动器:${this._brakeEnergized?'通电(松)':'断电(制)'}`);

        // 三环框图动态标注
        if (this._ctrlErrLabel) this._ctrlErrLabel.text(`e=${errD.toFixed(2)}°`);
        if (this._ctrlSpdLabel) this._ctrlSpdLabel.text(`ω*=${(this._spdRef*60/(2*Math.PI)).toFixed(0)}rpm`);
        if (this._ctrlModLabel) this._ctrlModLabel.text(`M=${(this._modRatio*100).toFixed(0)}%`);

        // 滑块同步
        Object.values(this._sliderBars||{}).forEach(({bar,txt,slW,getR,disp})=>{
            bar.width(Math.min(slW,Math.max(0,getR())*slW));
            txt.text(disp());
        });
    }

    // ═══════════════════════════════════════════
    servoOn() {
        if (!this._running) {
            this._brakeEnergized = true;   // 先松开制动器
            setTimeout(()=>{ this._running=true; }, this.brakeEngageT*1000+20);
        }
    }

    servoOff() {
        this._running        = false;
        this._brakeEnergized = false;  // 伺服禁能后立即制动
        this._intSpd=this._intId=this._intIq=0;
    }

    toggleBrake() {
        this._brakeEnergized = !this._brakeEnergized;
    }

    setBrake(energize) {
        this._brakeEnergized = !!energize;
    }

    moveToTarget() {
        if (!this._running) return;
        const targetRad = this._targetPosDeg * Math.PI / 180;
        const dist      = targetRad - this._thetaM;
        const vmax      = this.profileMaxSpd * 2*Math.PI/60;
        const amax      = this.profileMaxAcc * 2*Math.PI/60;
        const jmax      = this.profileMaxJerk * 2*Math.PI/60;

        // S 曲线时间段计算（7段）
        const t1 = amax/jmax;
        const t2 = Math.max(0, vmax/amax - t1);
        const t3 = t1;
        const Vp = jmax*t1*t1/2 + amax*t2 + jmax*t1*t3 - jmax*t3*t3/2;
        const dAcc = jmax*t1**3/6 + amax*t2**2/2 + (jmax*t1*t3**2)/2 - jmax*t3**3/6;
        const tConst = Math.max(0, (Math.abs(dist) - 2*dAcc) / (Vp+1e-9));

        this._profile = {
            active: true, t: 0, phase: 0,
            v0: 0, v1: 0, vmax: Vp, amax, jmax,
            phase_t: [t1,t2,t3,tConst,t3,t2,t1],
            theta_start: this._thetaM, theta_end: targetRad,
        };
        this._posRef = this._thetaM;
    }

    jog(dir) {
        if (!this._running) return;
        this._mode   = 'jog';
        this._spdRef = dir * this.ratedSpeed * 0.1 * 2*Math.PI/60;
        this._posRef = this._thetaM + dir * Math.PI * 0.5;
    }

    home() {
        if (!this._running) return;
        this._mode     = 'home';
        this._posRef   = 0;
        this._spdRef   = -this.ratedSpeed * 0.2 * 2*Math.PI/60;
        this._homed    = false;
        this._profile  = { active: false, phase_t: [0,0,0,0,0,0,0] };
    }

    setPosition(deg) {
        this._targetPosDeg = deg;
        this.moveToTarget();
    }

    setLoad(T) {
        this._loadTorque = Math.max(0, Math.min(this.peakTorque, T));
        this._refreshCache();
    }

    getPosition()  { return this._thetaM * 180/Math.PI; }
    getSpeed()     { return this._omegaR * 60/(2*Math.PI); }
    getTorque()    { return this.torqueEM; }
    isBrakeOn()    { return this._brakeGapNorm < 0.1; }
    isPosReached(tol=0.1) { return Math.abs(this._posErr*180/Math.PI) < tol; }

    update(cfg={}) {
        if (cfg.pos   !== undefined) this.setPosition(cfg.pos);
        if (cfg.load  !== undefined) this.setLoad(cfg.load);
        if (cfg.brake !== undefined) this.setBrake(cfg.brake);
        this._refreshCache();
    }

    getConfigFields() {
        return [
            {label:'位号/名称',              key:'id',              type:'text'},
            {label:'额定功率 (W)',            key:'ratedPower',      type:'number'},
            {label:'直流母线电压 (V)',        key:'ratedVoltage',    type:'number'},
            {label:'额定转速 (rpm)',          key:'ratedSpeed',      type:'number'},
            {label:'最高转速 (rpm)',          key:'maxSpeed',        type:'number'},
            {label:'额定转矩 (N·m)',          key:'ratedTorque',     type:'number'},
            {label:'峰值转矩 (N·m)',          key:'peakTorque',      type:'number'},
            {label:'额定电流 (A)',            key:'ratedCurrent',    type:'number'},
            {label:'极对数',                 key:'polePairs',       type:'number'},
            {label:'定子电阻 Rs (Ω)',         key:'Rs',              type:'number'},
            {label:'d轴电感 Ld (mH)',         key:'Ld',              type:'number'},
            {label:'q轴电感 Lq (mH)',         key:'Lq',              type:'number'},
            {label:'永磁体磁链 ψ_f (Wb)',     key:'psiF',            type:'number'},
            {label:'转动惯量 J (kg·m²)',      key:'J',               type:'number'},
            {label:'制动器额定转矩 (N·m)',    key:'brakeTorque',     type:'number'},
            {label:'制动器电压 (V)',          key:'brakeVoltage',    type:'number'},
            {label:'制动器线圈电阻 (Ω)',      key:'brakeR',          type:'number'},
            {label:'制动器磨损寿命 (次)',     key:'brakeMassWear',   type:'number'},
            {label:'位置环增益 Kp_pos',       key:'Kp_pos',          type:'number'},
            {label:'速度环增益 Kp_spd',       key:'Kp_spd',          type:'number'},
            {label:'编码器分辨率 (bit)',       key:'encoderBits',     type:'number'},
        ];
    }

    onConfigUpdate(cfg) {
        const n = k => parseFloat(cfg[k]);
        this.id           = cfg.id           || this.id;
        if (cfg.ratedPower)    this.ratedPower   = n('ratedPower');
        if (cfg.ratedVoltage)  this.ratedVoltage = n('ratedVoltage');
        if (cfg.ratedSpeed)    this.ratedSpeed   = n('ratedSpeed');
        if (cfg.maxSpeed)      this.maxSpeed     = n('maxSpeed');
        if (cfg.ratedTorque)   this.ratedTorque  = n('ratedTorque');
        if (cfg.peakTorque)    this.peakTorque   = n('peakTorque');
        if (cfg.ratedCurrent)  this.ratedCurrent = n('ratedCurrent');
        if (cfg.polePairs)     this.polePairs    = parseInt(cfg.polePairs);
        if (cfg.Rs)            this.Rs           = n('Rs');
        if (cfg.Ld)            this.Ld           = n('Ld')*1e-3;
        if (cfg.Lq)            this.Lq           = n('Lq')*1e-3;
        if (cfg.psiF)          this.psiF         = n('psiF');
        if (cfg.J)             this.J            = n('J');
        if (cfg.brakeTorque)   this.brakeTorque  = n('brakeTorque');
        if (cfg.brakeVoltage)  this.brakeVoltage = n('brakeVoltage');
        if (cfg.brakeR)        this.brakeR       = n('brakeR');
        if (cfg.brakeMassWear) this.brakeMassWear= n('brakeMassWear');
        if (cfg.Kp_pos)        this.Kp_pos       = n('Kp_pos');
        if (cfg.Kp_spd)        this.Kp_spd       = n('Kp_spd');
        if (cfg.encoderBits)   this.encoderBits  = parseInt(cfg.encoderBits);
        this.Ke        = this.psiF*this.polePairs*Math.sqrt(1.5);
        this.maxOmega  = this.maxSpeed*2*Math.PI/60;
        this.encoderCPR= Math.pow(2,this.encoderBits);
        this.config    = {...this.config,...cfg};
        this._refreshCache();
    }

    destroy() {
        super.destroy?.();
    }
}