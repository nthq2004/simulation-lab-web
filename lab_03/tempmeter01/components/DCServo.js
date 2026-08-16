import { BaseComponent } from './BaseComponent.js';

/**
 * 直流伺服电机（带电磁制动器）仿真组件
 *（DC Servo Motor with Electromagnetic Brake）
 *
 * ── 直流伺服电机工作原理 ────────────────────────────────────
 *
 *  直流伺服电机 = 直流电机 + 高分辨率编码器 + 伺服驱动器
 *  特点：
 *    ① 电枢控制：电枢电压/电流控制转矩和转速
 *    ② 线性模型：转矩与电流成正比，反电动势与转速成正比
 *    ③ 响应快速：电枢电感小，电流环带宽高
 *    ④ 结构简单：无需复杂的坐标变换
 *    ⑤ 适合低惯量、高精度定位场合
 *
 * ── 直流电机数学模型 ────────────────────────────────────────
 *
 *  电压方程（电枢回路）：
 *    ua = Ra·ia + La·d(ia)/dt + E
 *    E = Ke·ω（反电动势，Ke 为反电动势常数）
 *
 *  电磁转矩方程：
 *    Te = Kt·ia（Kt 为转矩常数，单位 N·m/A）
 *    对于理想直流电机，Kt = Ke（SI 单位制下）
 *
 *  转矩平衡方程：
 *    Te = J·dω/dt + B·ω + TL
 *
 *  传递函数（电枢控制）：
 *    ω(s)/Ua(s) = Kt / ( (Ra + sLa)(Js+B) + Kt·Ke )
 *
 *  简化模型（忽略电感 La）：
 *    ω(s)/Ua(s) = 1/Ke / (τm·s + 1) ，其中 τm = J·Ra/(Kt·Ke)
 *
 * ── 伺服控制结构 ────────────────────────────────────────────
 *
 *  三环串级控制（由外到内）：
 *
 *  位置环（最外环）：
 *    输入：位置给定 θ* vs 编码器反馈 θ
 *    输出：速度给定 ω*
 *    控制器：P 控制（Kp_pos）
 *
 *  速度环（中间环）：
 *    输入：速度给定 ω* vs 速度反馈 ω
 *    输出：电流/电压给定 ia*
 *    控制器：PI 控制（Kp_spd + Ki_spd/s）
 *
 *  电流环（最内环，最快）：
 *    输入：电流给定 ia* vs 实际电流 ia
 *    输出：电枢电压 ua
 *    控制器：PI 控制（Kp_cur + Ki_cur/s）
 *    带宽：1~5 kHz（取决于电枢电感）
 *
 * ── 直流伺服与交流伺服的差异 ────────────────────────────────
 *
 *  优势：
 *    - 控制简单，无需坐标变换（Park/Clark）
 *    - 转矩/电流线性关系，控制精度高
 *    - 低速性能好，无转矩脉动
 *    - 响应速度快（电枢电感小）
 *
 *  劣势：
 *    - 有电刷磨损，需定期维护
 *    - 功率密度较低
 *    - 不适合大功率场合（电刷限制）
 *    - 高速时换向火花
 *
 * ── 电机参数（典型 400W 直流伺服）──
 *  额定功率     400 W
 *  额定电压     48 V DC
 *  额定电流     10 A
 *  额定转速     3000 rpm
 *  最大转速     5000 rpm
 *  额定转矩     1.27 N·m
 *  峰值转矩     3.8 N·m
 *  电枢电阻 Ra  0.5 Ω
 *  电枢电感 La  1.5 mH
 *  转矩常数 Kt  0.127 N·m/A
 *  反电动势常数 Ke 0.127 V/(rad/s) ≈ 0.0133 V/rpm
 *  转动惯量 J   1.2e-4 kg·m²
 *  粘滞系数 B   2e-5 N·m·s/rad
 */
export class DCServoWithBrake extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.width  = Math.max(600, config.width  || 740);
        this.height = Math.max(460, config.height || 600);

        this.type    = 'dc_servo_with_brake';
        this.special = 'none';
        this.cache   = 'fixed';

        // ── 电机额定参数 ──
        this.ratedPower    = config.ratedPower    || 400;      // W
        this.ratedVoltage  = config.ratedVoltage  || 48;       // V（电枢额定电压）
        this.ratedSpeed    = config.ratedSpeed    || 3000;     // rpm
        this.maxSpeed      = config.maxSpeed      || 5000;     // rpm
        this.ratedTorque   = config.ratedTorque   || (this.ratedPower/(this.ratedSpeed*2*Math.PI/60));
        this.peakTorque    = config.peakTorque    || this.ratedTorque * 3.0;
        this.ratedCurrent  = config.ratedCurrent  || 10.0;     // A
        this.peakCurrent   = config.peakCurrent   || this.ratedCurrent * 3.0;

        // ── 直流电机电气参数 ──
        this.Ra    = config.Ra    || 0.5;      // Ω 电枢电阻
        this.La    = config.La    || 1.5e-3;   // H 电枢电感
        this.Kt    = config.Kt    || (this.ratedTorque / this.ratedCurrent);  // N·m/A 转矩常数
        this.Ke    = config.Ke    || this.Kt;  // V/(rad/s) 反电动势常数（理想相等）
        
        // 电气时间常数
        this.tauE  = this.La / this.Ra;        // s

        // ── 机械参数 ──
        this.J      = config.J      || 1.2e-4;   // kg·m²
        this.B      = config.B      || 2e-5;     // N·m·s/rad
        this.maxOmega = this.maxSpeed * 2*Math.PI/60;

        // ── 编码器（高分辨率绝对式/增量式）──
        this.encoderCPR   = config.encoderCPR   || 5000;      // 线数/转（×4后20000）
        this.encNoise     = config.encNoise     || 1;         // counts

        // ── 制动器参数 ──
        this.brakeVoltage   = config.brakeVoltage   || 24;
        this.brakeR         = config.brakeR         || 26;
        this.brakeL         = config.brakeL         || 0.28;
        this.brakeTorque    = config.brakeTorque    || this.ratedTorque * 1.5;
        this.brakeSpring    = config.brakeSpring    || 180;
        this.brakeAirGap    = config.brakeAirGap    || 0.25e-3;
        this.brakeEngageT   = config.brakeEngageT   || 0.05;
        this.brakeReleaseT  = config.brakeReleaseT  || 0.02;
        this.brakeMassWear  = config.brakeMassWear  || 1e6;
        this.brakeThermalR  = config.brakeThermalR  || 2.5;
        this.brakeThermalC  = config.brakeThermalC  || 150;

        // ── 控制参数（三环 PI）──
        // 位置环
        this.Kp_pos  = config.Kp_pos  || 100;    // rad/s/rad
        this.Kd_pos  = config.Kd_pos  || 0.001;
        // 速度环
        this.Kp_spd  = config.Kp_spd  || 0.15;
        this.Ki_spd  = config.Ki_spd  || 2.5;
        // 电流环
        this.Kp_cur  = config.Kp_cur  || 20.0;
        this.Ki_cur  = config.Ki_cur  || 800;
        // 前馈
        this.Kff_spd = config.Kff_spd || 0.9;
        this.Kff_acc = config.Kff_acc || 0.6;

        // ── 运动规划参数 ──
        this.profileMaxSpd = config.profileMaxSpd || this.ratedSpeed * 0.8;
        this.profileMaxAcc = config.profileMaxAcc || 6000;
        this.profileMaxJerk= config.profileMaxJerk|| 60000;

        // ── 运行状态 ──
        this._mode         = 'position';
        this._running      = false;
        this._homed        = false;

        // 机械状态
        this._thetaM       = 0;      // 机械角度（rad）
        this._omegaR       = 0;      // 角速度（rad/s）

        // 电气状态
        this._ia           = 0;      // 电枢电流（A）
        this._ua           = 0;      // 电枢电压（V）
        this._emf          = 0;      // 反电动势（V）
        this._intCur       = 0;      // 电流环积分
        this._intSpd       = 0;      // 速度环积分

        // 三环给定值
        this._posRef       = 0;
        this._spdRef       = 0;
        this._iaRef        = 0;      // 电流给定（A）
        this._posErr       = 0;
        this._posErrPrev   = 0;

        // S 曲线规划器
        this._profile      = { active: false, phase: 0, t: 0,
                               v0: 0, v1: 0, vmax: 0, amax: 0, jmax: 0,
                               phase_t: [0,0,0,0,0,0,0], theta_start: 0, theta_end: 0 };

        // 制动器状态
        this._brakeEnergized = false;
        this._brakeCoilI     = 0;
        this._brakeGap       = 0;
        this._brakeGapNorm   = 0;
        this._brakeTorqueAct = this.brakeTorque;
        this._brakeTemp      = 25;
        this._brakeWear      = 0;
        this._brakeSlipE     = 0;
        this._brakeSlipping  = false;

        // 输出量
        this.torqueEM      = 0;
        this.powerIn       = 0;
        this.powerOut      = 0;
        this.efficiency    = 0;
        this._loadTorque   = config.initLoad || 0;
        this._targetPosDeg = config.initPosDeg || 360;

        // ── 波形缓冲 ──
        this._wavLen    = 300;
        this._wavPos    = new Float32Array(this._wavLen).fill(0);
        this._wavPosRef = new Float32Array(this._wavLen).fill(0);
        this._wavSpd    = new Float32Array(this._wavLen).fill(0);
        this._wavTq     = new Float32Array(this._wavLen).fill(0);
        this._wavIa     = new Float32Array(this._wavLen).fill(0);
        this._wavUa     = new Float32Array(this._wavLen).fill(0);
        this._wavBrakeG = new Float32Array(this._wavLen).fill(0);

        // ── 几何布局 ──
        this._csX  = Math.round(this.width * 0.02);
        this._csY  = Math.round(this.height * 0.04);
        this._csW  = Math.round(this.width * 0.30);
        this._csH  = Math.round(this.height * 0.42);
        this._csCX = this._csX + this._csW / 2;
        this._csCY = this._csY + this._csH / 2;

        this._ctrlX = Math.round(this.width * 0.34);
        this._ctrlY = this._csY;
        this._ctrlW = Math.round(this.width * 0.63);
        this._ctrlH = Math.round(this.height * 0.22);

        this._traceX = Math.round(this.width * 0.34);
        this._traceY = this._ctrlY + this._ctrlH + 8;
        this._traceW = Math.round(this.width * 0.30);
        this._traceH = Math.round(this.height * 0.24);

        this._scrvX  = this._traceX + this._traceW + 8;
        this._scrvY  = this._traceY;
        this._scrvW  = Math.round(this.width * 0.28);
        this._scrvH  = this._traceH;

        this._brkX   = this._scrvX + this._scrvW + 8;
        this._brkY   = this._traceY;
        this._brkW   = this.width - this._brkX - Math.round(this.width * 0.02);
        this._brkH   = this._traceH;

        this._lcdX   = this._csX;
        this._lcdY   = this._csY + this._csH + 8;
        this._lcdW   = this._csW;
        this._lcdH   = Math.round(this.height * 0.26);

        this._panX   = this._traceX;
        this._panY   = this._traceY + this._traceH + 8;
        this._panW   = this.width - this._traceX - Math.round(this.width * 0.02);
        this._panH   = Math.round(this.height * 0.16);

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
        this.addPort(cL, this._csCY - 22, 'arm_pos', 'wire', '+ARM');
        this.addPort(cL, this._csCY + 22, 'arm_neg', 'wire', '−ARM');
        const cR = this._csX + this._csW + 6;
        this.addPort(cR, this._csCY,       'enc_data','wire', 'Enc');
        this.addPort(cR, this._csCY + 30,  'brake_pos','wire', '+BRK');
        this.addPort(cR, this._csCY + 46,  'brake_neg','wire', '−BRK');
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
            text: `直流伺服电机（带制动器）  ${this.ratedPower}W  ${this.ratedVoltage}V  ${this.ratedSpeed}/${this.maxSpeed}rpm  ` +
                  `Kt=${this.Kt.toFixed(3)}N·m/A  Ra=${this.Ra}Ω  La=${(this.La*1000).toFixed(1)}mH  编码器${this.encoderCPR}线`,
            fontSize: 10, fontStyle: 'bold', fill: '#1a2634', align: 'center',
        }));
    }

    // ── 电机横截面（直流电机结构：电枢绕组+换向器）──
    _drawCrossSection() {
        const { _csX: ex, _csY: ey, _csW: ew, _csH: eh, _csCX: ecx, _csCY: ecy } = this;

        this.group.add(new Konva.Rect({
            x: ex, y: ey, width: ew, height: eh,
            fill: '#0d1a24', stroke: '#1a3040', strokeWidth: 1.5, cornerRadius: 5,
        }));
        this.group.add(new Konva.Text({
            x: ex, y: ey - 14, width: ew,
            text: '直流伺服电机 纵截面图（电枢+换向器）', fontSize: 9, fontStyle: 'bold',
            fill: '#546e7a', align: 'center',
        }));

        // 电机壳体
        const mLeft  = ex + Math.round(ew * 0.08);
        const mRight = ex + Math.round(ew * 0.58);
        const mTop   = ey + Math.round(eh * 0.10);
        const mBot   = ey + Math.round(eh * 0.90);
        const mW     = mRight - mLeft;
        const mH     = mBot - mTop;
        const mCX    = (mLeft + mRight) / 2;
        const mCY    = (mTop + mBot) / 2;

        // 外壳（圆筒形）
        this.group.add(new Konva.Rect({ x: mLeft, y: mTop, width: mW, height: mH, fill: '#1c2b38', stroke: '#37474f', strokeWidth: 2, cornerRadius: 3 }));
        
        // 前后端盖（带轴承示意）
        this.group.add(new Konva.Rect({ x: mLeft, y: mTop, width: 8, height: mH, fill: '#263238', stroke: '#37474f', strokeWidth: 1 }));
        this.group.add(new Konva.Rect({ x: mRight-8, y: mTop, width: 8, height: mH, fill: '#263238', stroke: '#37474f', strokeWidth: 1 }));

        // 定子磁极（永磁体或励磁绕组）
        const poleW = 12, poleH = mH * 0.65;
        const poleY = mCY - poleH/2;
        // N 极（红）
        this.group.add(new Konva.Rect({ x: mLeft+8, y: poleY, width: poleW, height: poleH, fill: '#e53935', stroke: '#b71c1c', strokeWidth: 1, opacity: 0.8 }));
        this.group.add(new Konva.Text({ x: mLeft+8, y: poleY+poleH/2-5, width: poleW, text: 'N', fontSize: 10, fill: '#fff', align: 'center', fontStyle: 'bold' }));
        // S 极（蓝）
        this.group.add(new Konva.Rect({ x: mRight-20, y: poleY, width: poleW, height: poleH, fill: '#1e88e5', stroke: '#0d47a1', strokeWidth: 1, opacity: 0.8 }));
        this.group.add(new Konva.Text({ x: mRight-20, y: poleY+poleH/2-5, width: poleW, text: 'S', fontSize: 10, fill: '#fff', align: 'center', fontStyle: 'bold' }));

        // 电枢铁芯（转子）
        const rR = Math.round(mH * 0.32);
        this._rotorR = rR;
        this.group.add(new Konva.Ellipse({ x: mCX, y: mCY, radiusX: rR*0.95, radiusY: rR*0.28, fill: '#607d8b', stroke: '#37474f', strokeWidth: 1 }));
        
        // 电枢绕组（铜线环绕示意）
        for (let i = 0; i < 12; i++) {
            const angle = (i / 12) * Math.PI * 2;
            const wx = mCX + (rR * 0.7) * Math.cos(angle);
            const wy = mCY + (rR * 0.7) * Math.sin(angle) * 0.28;
            this.group.add(new Konva.Circle({ x: wx, y: wy, radius: 4, fill: '#ffb74d', stroke: '#e65100', strokeWidth: 0.5 }));
        }
        
        // 换向器（后端部，铜片环）
        const commY = mBot - 12;
        const commW = 20;
        this.group.add(new Konva.Rect({ x: mCX-commW/2, y: commY-4, width: commW, height: 8, fill: '#d4a017', stroke: '#8d6e63', strokeWidth: 1, cornerRadius: 1 }));
        for (let i = 0; i < 10; i++) {
            const segW = commW / 10;
            this.group.add(new Konva.Line({ points: [mCX-commW/2 + i*segW, commY-4, mCX-commW/2 + i*segW, commY+4], stroke: '#5d4037', strokeWidth: 0.5 }));
        }
        this.group.add(new Konva.Text({ x: mCX-8, y: commY-12, text: '换向器', fontSize: 6, fill: '#d4a017', width: 16, align: 'center' }));

        // 电刷（碳刷，两侧）
        this.group.add(new Konva.Rect({ x: mCX-commW/2-8, y: commY-2, width: 8, height: 4, fill: '#3e2723', stroke: '#1b0f0a', strokeWidth: 0.8 }));
        this.group.add(new Konva.Rect({ x: mCX+commW/2, y: commY-2, width: 8, height: 4, fill: '#3e2723', stroke: '#1b0f0a', strokeWidth: 0.8 }));
        this.group.add(new Konva.Text({ x: mCX-commW/2-10, y: commY-8, text: '电刷', fontSize: 6, fill: '#5d4037' }));

        // 气隙
        this.group.add(new Konva.Ellipse({ x: mCX, y: mCY, radiusX: rR*0.96, radiusY: rR*0.28, fill: '#06101a', stroke: '#1a3040', strokeWidth: 0.5 }));

        // 散热孔
        for (let i = 0; i < 4; i++) {
            const hy = mTop + mH*0.2 + i*(mH*0.6/3);
            this.group.add(new Konva.Rect({ x: mLeft-3, y: hy, width: 3, height: 6, fill: '#37474f', cornerRadius: 1 }));
            this.group.add(new Konva.Rect({ x: mRight, y: hy, width: 3, height: 6, fill: '#37474f', cornerRadius: 1 }));
        }

        // 电枢接线端子（正负极）
        const termX = mLeft + 15;
        const termY = mTop - 6;
        this.group.add(new Konva.Rect({ x: termX, y: termY-6, width: 24, height: 12, fill: '#263238', stroke: '#37474f', strokeWidth: 1, cornerRadius: 2 }));
        this.group.add(new Konva.Circle({ x: termX+6, y: termY, radius: 4, fill: '#ef5350' }));
        this.group.add(new Konva.Text({ x: termX+2, y: termY-4, text: '+', fontSize: 8, fill: '#fff', fontStyle: 'bold' }));
        this.group.add(new Konva.Circle({ x: termX+18, y: termY, radius: 4, fill: '#90caf9' }));
        this.group.add(new Konva.Text({ x: termX+14, y: termY-4, text: '−', fontSize: 8, fill: '#fff', fontStyle: 'bold' }));

        // 编码器（后部）
        const encX = mRight + 5, encY = mCY;
        const encR = Math.round(mH*0.20);
        this.group.add(new Konva.Circle({ x: encX+encR, y: encY, radius: encR, fill: '#0d1a24', stroke: '#ffd54f', strokeWidth: 1.5 }));
        this.group.add(new Konva.Text({ x: encX, y: encY+encR+3, width: encR*2, text: `编码器\n${this.encoderCPR}线`, fontSize: 7, fill: '#ffd54f', align: 'center', lineHeight: 1.2 }));

        // 信号线
        const termR = ex + ew + 10;
        this.group.add(new Konva.Line({ points: [encX+encR*2, encY, termR, ecy], stroke: '#ffd54f', strokeWidth: 1.5, dash: [3,3] }));
        this.group.add(new Konva.Circle({ x: termR, y: ecy, radius: 3.5, fill: '#ffd54f' }));
        this.group.add(new Konva.Text({ x: termR+4, y: ecy-5, text: 'Enc', fontSize: 8, fill: '#ffd54f' }));

        // 电枢电源线
        const armPosTerm = ex - 8;
        const armNegTerm = ex - 8;
        this.group.add(new Konva.Line({ points: [termX+6, termY-6, armPosTerm, ecy-22], stroke: '#ef5350', strokeWidth: 1.5, dash: [3,3] }));
        this.group.add(new Konva.Line({ points: [termX+18, termY-6, armNegTerm, ecy+22], stroke: '#90caf9', strokeWidth: 1.5, dash: [3,3] }));
        this.group.add(new Konva.Circle({ x: armPosTerm, y: ecy-22, radius: 3.5, fill: '#ef5350' }));
        this.group.add(new Konva.Circle({ x: armNegTerm, y: ecy+22, radius: 3.5, fill: '#90caf9' }));
        this.group.add(new Konva.Text({ x: armPosTerm-8, y: ecy-28, text: '+', fontSize: 9, fill: '#ef5350', fontStyle: 'bold' }));
        this.group.add(new Konva.Text({ x: armNegTerm-8, y: ecy+18, text: '−', fontSize: 9, fill: '#90caf9', fontStyle: 'bold' }));

        // 输出轴
        this.group.add(new Konva.Rect({ x: mCX-4, y: mBot, width: 8, height: 12, fill: '#78909c', stroke: '#546e7a', strokeWidth: 1 }));

        this._mCX=mCX; this._mCY=mCY; this._mLeft=mLeft; this._mRight=mRight;
        this._mTop=mTop; this._mBot=mBot; this._rR=rR;
        this._encX=encX+encR; this._encY=encY;
    }

    // ── 制动器截面（同前）──
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

        this.group.add(new Konva.Rect({ x: bLeft, y: bTop, width: bW, height: bH, fill: '#1c2020', stroke: '#37474f', strokeWidth: 1.5, cornerRadius: 3 }));
        this.group.add(new Konva.Text({ x: bLeft, y: bTop-12, width: bW, text: '制动器', fontSize: 8, fontStyle: 'bold', fill: '#ffa726', align: 'center' }));

        // 线圈
        const coilY = bTop + bH*0.18;
        const coilH = bH*0.28;
        this.group.add(new Konva.Rect({ x: bLeft+4, y: coilY, width: bW-8, height: coilH, fill: '#1a1000', stroke: '#ffa726', strokeWidth: 1, cornerRadius: 2 }));
        for (let i = 0; i < 8; i++) {
            const ty = coilY + 2 + i*(coilH-4)/8;
            this.group.add(new Konva.Line({ points: [bLeft+6,ty, bRight-6,ty, bRight-6,ty+(coilH-4)/8*0.85, bLeft+6,ty+(coilH-4)/8*0.85], stroke: ['#c87832','#e09040'][i%2], strokeWidth: 1.5, lineJoin: 'round' }));
        }
        this.group.add(new Konva.Text({ x: bLeft+2, y: coilY+coilH*0.35, width: bW-4, text: '励磁\n线圈', fontSize: 7.5, fill: '#ffa726', align: 'center', lineHeight: 1.3 }));

        // 弹簧
        const spX   = bRight - 10, spTop = coilY + coilH + 4, spBot = bTop + bH*0.75;
        const spH   = spBot - spTop;
        const spPts = [spX, spTop];
        for (let i = 0; i < 8; i++) {
            const sy = spTop + i*(spH/8);
            spPts.push(spX + (i%2===0?-5:5), sy + spH/8*0.5);
            spPts.push(spX, sy + spH/8);
        }
        spPts.push(spX, spBot);
        this.group.add(new Konva.Line({ points: spPts, stroke: '#80cbc4', strokeWidth: 1.5, lineJoin: 'round' }));
        this.group.add(new Konva.Text({ x: bLeft+4, y: spTop + spH*0.3, text: '弹簧\n(预压)', fontSize: 7, fill: '#80cbc4', lineHeight: 1.3 }));

        // 衔铁
        this._brakeArmatureRect = new Konva.Rect({
            x: bLeft+4, y: spTop, width: bW-14, height: 10,
            fill: '#546e7a', stroke: '#263238', strokeWidth: 1, cornerRadius: 1,
        });
        this.group.add(this._brakeArmatureRect);
        this._brakeArmatureY0 = spTop;
        this._brakeArmatureY1 = spTop - 6;

        // 摩擦片
        const frY = spBot + 4;
        this.group.add(new Konva.Rect({ x: bLeft+4, y: frY, width: bW-8, height: 8, fill: '#3e2723', stroke: '#795548', strokeWidth: 1, cornerRadius: 1 }));
        this.group.add(new Konva.Text({ x: bLeft+2, y: frY-10, width: bW-4, text: '摩擦片', fontSize: 7, fill: '#a1887f', align: 'center' }));

        // 气隙指示
        this._brakeGapLine = new Konva.Line({ points: [bLeft+4, spTop+10, bLeft+4, frY], stroke: '#66bb6a', strokeWidth: 1, dash: [2,2] });
        this._brakeGapLabel= new Konva.Text({ x: bLeft+6, y: (spTop+10+frY)/2-5, text: '气隙δ', fontSize: 7, fill: '#66bb6a' });
        this.group.add(this._brakeGapLine, this._brakeGapLabel);

        // 制动器接线
        const brkTermX = ex + ew + 10;
        [['#ef9a9a',80,'+BRK'],['#90caf9',96,'−BRK']].forEach(([col,dy,lbl]) => {
            this.group.add(new Konva.Line({ points: [bCX, bTop+coilH*0.5, brkTermX, this._csCY+dy], stroke: col, strokeWidth: 1.5, dash: [3,3] }));
            this.group.add(new Konva.Circle({ x: brkTermX, y: this._csCY+dy, radius: 3.5, fill: col }));
            this.group.add(new Konva.Text({ x: brkTermX+4, y: this._csCY+dy-5, text: lbl, fontSize: 7.5, fill: col }));
        });

        this._brakeCoilGlow = new Konva.Rect({ x: bLeft+3, y: coilY-1, width: bW-6, height: coilH+2, fill: 'rgba(255,167,38,0)', cornerRadius: 2 });
        this.group.add(this._brakeCoilGlow);

        this._brakeSectionBLeft = bLeft; this._brakeSectionFrY = frY;
        this._brakeSectionSpTop = spTop;
    }

    _drawBrakeAnimLayer() {
        this._brakeAnimGroup = new Konva.Group();
        this.group.add(this._brakeAnimGroup);
    }

    // ── 转子动画（电枢绕组旋转）──
    _drawRotorLayer() {
        this._rotorWindings = [];
        const barCount = 12;
        const rR = this._rR || 45;
        for (let i = 0; i < barCount; i++) {
            const wdg = new Konva.Circle({
                x: this._mCX, y: this._mCY,
                radius: 4,
                fill: '#ffb74d', stroke: '#e65100', strokeWidth: 0.8,
                offsetX: rR * 0.68, offsetY: 0,
                rotation: (i / barCount) * 360,
            });
            this._rotorWindings.push(wdg);
            this.group.add(wdg);
        }
        // 换向器旋转示意
        this._commutatorRing = new Konva.Ellipse({
            x: this._mCX, y: this._mBot - 8,
            radiusX: 12, radiusY: 4,
            fill: 'rgba(212,160,23,0.3)', stroke: '#d4a017', strokeWidth: 1,
        });
        this.group.add(this._commutatorRing);
        this._rotorRef = new Konva.Circle({ x: this._mCX + rR*0.75, y: this._mCY, radius: 3, fill: '#ffd54f' });
        this.group.add(this._rotorRef);
    }

    // ── 控制框图（直流伺服三环）──
    _drawControlBlock() {
        const { _ctrlX: cx, _ctrlY: cy, _ctrlW: cw, _ctrlH: ch } = this;

        this.group.add(new Konva.Rect({ x:cx, y:cy, width:cw, height:ch, fill:'#010d18', stroke:'#1a3040', strokeWidth:1.5, cornerRadius:4 }));
        this.group.add(new Konva.Rect({ x:cx, y:cy, width:cw, height:13, fill:'#0a1a28', cornerRadius:[4,4,0,0] }));
        this.group.add(new Konva.Text({ x:cx+4, y:cy+2, width:cw-8, text:'直流伺服三环控制（位置环→速度环→电流环→PWM）', fontSize:8, fontStyle:'bold', fill:'#80cbc4', align:'center' }));

        const y0 = cy + ch*0.44;
        const mainBlocks = [
            {lbl:'θ*\n位置给定', x:cx+12,   w:30, col:'#ffd54f'},
            {lbl:'位置环\nP控制', x:cx+50,   w:34, col:'#66bb6a'},
            {lbl:'速度环\nPI',    x:cx+92,   w:34, col:'#4fc3f7'},
            {lbl:'电流环\nPI',    x:cx+134,  w:34, col:'#ef9a9a'},
            {lbl:'PWM\n调制',     x:cx+176,  w:34, col:'#90caf9'},
            {lbl:'H桥\n逆变器',   x:cx+218,  w:34, col:'#e8a0a0'},
            {lbl:'直流\n电机',    x:cx+260,  w:34, col:'#66bb6a'},
        ];

        mainBlocks.forEach(({ lbl, x, w, col }) => {
            this.group.add(new Konva.Rect({ x, y:y0-12, width:w, height:24, fill:'#0a1020', stroke:col, strokeWidth:1, cornerRadius:3 }));
            this.group.add(new Konva.Text({ x, y:y0-10, width:w, text:lbl, fontSize:6.5, fill:col, align:'center', lineHeight:1.3 }));
        });

        // 前向链路
        [[cx+42,cx+50],[cx+84,cx+92],[cx+126,cx+134],[cx+168,cx+176],[cx+210,cx+218],[cx+252,cx+260]].forEach(([x1,x2])=>{
            this.group.add(new Konva.Arrow({ points:[x1,y0,x2,y0], stroke:'#4fc3f7', fill:'#4fc3f7', strokeWidth:1, pointerLength:4, pointerWidth:3 }));
        });

        // 位置反馈
        const fbY1 = y0 + ch*0.40;
        this.group.add(new Konva.Line({ points:[cx+cw-18,y0+12, cx+cw-18,fbY1, cx+52,fbY1, cx+52,y0+12], stroke:'#ffd54f', strokeWidth:1, dash:[4,3], opacity:0.8 }));
        this.group.add(new Konva.Text({ x:cx+cw/2-35, y:fbY1-9, text:'θ 位置反馈（编码器）', fontSize:6.5, fill:'#ffd54f', opacity:0.9 }));

        // 速度反馈
        const fbY2 = y0 + ch*0.25;
        this.group.add(new Konva.Line({ points:[cx+cw-18,y0+12, cx+cw-18,fbY2, cx+94,fbY2, cx+94,y0+12], stroke:'#4fc3f7', strokeWidth:1, dash:[3,3], opacity:0.7 }));
        this.group.add(new Konva.Text({ x:cx+cw*0.55, y:fbY2-9, text:'ω 速度反馈', fontSize:6.5, fill:'#4fc3f7', opacity:0.7 }));

        // 电流反馈
        this.group.add(new Konva.Line({ points:[cx+260,y0, cx+260,y0+12, cx+136,y0+12, cx+136,y0], stroke:'#ef9a9a', strokeWidth:1, dash:[3,3], opacity:0.6 }));
        this.group.add(new Konva.Text({ x:cx+190, y:y0+14, text:'ia 电流反馈', fontSize:6.5, fill:'#ef9a9a', opacity:0.65 }));

        // 动态标注
        this._ctrlErrLabel = new Konva.Text({ x:cx+52, y:cy+ch-14, text:'e=0°', fontSize:7, fill:'#ffd54f' });
        this._ctrlSpdLabel = new Konva.Text({ x:cx+92, y:cy+ch-14, text:'ω*=0', fontSize:7, fill:'#4fc3f7' });
        this._ctrlCurLabel = new Konva.Text({ x:cx+134, y:cy+ch-14, text:'ia*=0', fontSize:7, fill:'#ef9a9a' });
        this.group.add(this._ctrlErrLabel, this._ctrlSpdLabel, this._ctrlCurLabel);
    }

    // ── 位置跟踪曲线 ──
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
        [['#ffd54f','θ*（给定）'],['#66bb6a','θ（实际）'],['#ef5350','e（误差×5）']].forEach(([col,lbl],i)=>{
            this.group.add(new Konva.Line({ points:[lgX,lgY+i*9+3,lgX+10,lgY+i*9+3], stroke:col, strokeWidth:1.8 }));
            this.group.add(new Konva.Text({ x:lgX+12, y:lgY+i*9-1, text:lbl, fontSize:7, fill:col }));
        });
        this.group.add(this._tracePosRefLine, this._tracePosLine, this._traceErrLine);
        this._traceOX=ox; this._traceOY=oy; this._traceAW=aw; this._traceAH=ah;
    }

    // ── S 曲线速度规划 ──
    _drawSCurveChart() {
        const { _scrvX: sx, _scrvY: sy, _scrvW: sw, _scrvH: sh } = this;

        this.group.add(new Konva.Rect({ x:sx, y:sy, width:sw, height:sh, fill:'#010d18', stroke:'#1a3040', strokeWidth:1.5, cornerRadius:4 }));
        this.group.add(new Konva.Rect({ x:sx, y:sy, width:sw, height:13, fill:'#0a1a28', cornerRadius:[4,4,0,0] }));
        this.group.add(new Konva.Text({ x:sx+4, y:sy+2, width:sw-8, text:'S 曲线速度规划（Jerk 限制）', fontSize:8, fontStyle:'bold', fill:'#80cbc4', align:'center' }));

        const ox=sx+12, oy=sy+sh-10, aw=sw-18, ah=sh-26;
        this.group.add(new Konva.Line({ points:[ox,oy-ah,ox,oy,ox+aw,oy], stroke:'#37474f', strokeWidth:0.8 }));
        this.group.add(new Konva.Text({ x:ox-10, y:oy-ah, text:'v', fontSize:7, fill:'#80cbc4' }));
        this.group.add(new Konva.Text({ x:ox+aw+2, y:oy+2, text:'t', fontSize:7, fill:'#80cbc4' }));

        // S 曲线静态示意
        const pts=[];
        for (let i=0; i<=80; i++) {
            const t=i/80;
            let v=0;
            if (t<0.15) v=0.5*(t/0.15)**2;
            else if (t<0.35) v=0.5 + 0.8*(t-0.15)/0.2;
            else if (t<0.5) v=1.3 - 0.8*((t-0.35)/0.15)**2;
            else if (t<0.7) v=0.5;
            else if (t<0.85) v=0.5 - 0.5*((t-0.7)/0.15)**2;
            else v=0;
            v = Math.max(0, Math.min(1, v));
            pts.push(ox+t*aw, oy-Math.max(0,v)*(ah-4));
        }
        this.group.add(new Konva.Line({ points:pts, stroke:'#4fc3f7', strokeWidth:1.8, lineJoin:'round', opacity:0.6 }));

        this.group.add(new Konva.Text({ x:ox+aw*0.5, y:sy+sh-22, text:`Jmax=${this.profileMaxJerk}rpm/s²  Amax=${this.profileMaxAcc}rpm/s`, fontSize:6.5, fill:'#4fc3f7', align:'center', width:sw-14 }));

        this._scrvPoint = new Konva.Circle({ x:ox, y:oy, radius:5, fill:'#66bb6a', stroke:'#2e7d32', strokeWidth:1.5 });
        this.group.add(this._scrvPoint);
        this._scrvOX=ox; this._scrvOY=oy; this._scrvAW=aw; this._scrvAH=ah;
    }

    // ── 制动器状态面板（同前）──
    _drawBrakePanel() {
        const { _brkX: bx, _brkY: by, _brkW: bw, _brkH: bh } = this;

        this.group.add(new Konva.Rect({ x:bx, y:by, width:bw, height:bh, fill:'#100a00', stroke:'#ffa726', strokeWidth:1.5, cornerRadius:4 }));
        this.group.add(new Konva.Rect({ x:bx, y:by, width:bw, height:13, fill:'#1a1000', cornerRadius:[4,4,0,0] }));
        this.group.add(new Konva.Text({ x:bx+4, y:by+2, width:bw-8, text:'制动器状态', fontSize:8, fontStyle:'bold', fill:'#ffa726', align:'center' }));

        const iconCX=bx+bw/2, iconCY=by+bh*0.35;
        const iconR=Math.round(Math.min(bw,bh)*0.20);
        this._brakeIconBg  = new Konva.Circle({ x:iconCX, y:iconCY, radius:iconR, fill:'#c62828', stroke:'#ef5350', strokeWidth:2 });
        this._brakeIconText= new Konva.Text({ x:iconCX-iconR, y:iconCY-14, width:iconR*2, text:'🔒\n制动', fontSize:11, fill:'#ffcdd2', align:'center', lineHeight:1.2 });
        this.group.add(this._brakeIconBg, this._brakeIconText);

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

    // ── LCD 仪表 ──
    _drawLCDPanel() {
        const { _lcdX: lx, _lcdY: ly, _lcdW: lw, _lcdH: lh } = this;

        this.group.add(new Konva.Rect({x:lx,y:ly,width:lw,height:lh,fill:'#020c14',stroke:'#1a3040',strokeWidth:1.5,cornerRadius:4}));
        this.group.add(new Konva.Rect({x:lx,y:ly,width:lw,height:13,fill:'#0a1a28',cornerRadius:[4,4,0,0]}));
        this.group.add(new Konva.Text({x:lx+4,y:ly+2,width:lw-8,text:'直流伺服运行仪表',fontSize:8,fontStyle:'bold',fill:'#80cbc4',align:'center'}));

        const cells=[
            {label:'位置θ',   id:'pos',   unit:'deg',  color:'#ffd54f'},
            {label:'速度ω',   id:'spd',   unit:'rpm',  color:'#4fc3f7'},
            {label:'转矩T',   id:'tq',    unit:'N·m',  color:'#66bb6a'},
            {label:'位置误差',id:'perr',  unit:'deg',  color:'#ef5350'},
            {label:'电枢I',   id:'ia',    unit:'A',    color:'#80cbc4'},
            {label:'电枢U',   id:'ua',    unit:'V',    color:'#ef9a9a'},
            {label:'反电动势',id:'emf',   unit:'V',    color:'#ce93d8'},
            {label:'Iq_ref',  id:'iref',  unit:'A',    color:'#ffa726'},
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

    // ── 控制面板 ──
    _drawControlPanel() {
        const { _panX: px, _panY: py, _panW: pw, _panH: ph } = this;

        this.group.add(new Konva.Rect({x:px,y:py,width:pw,height:ph,fill:'#0d1520',stroke:'#1a3040',strokeWidth:1.5,cornerRadius:4}));
        this.group.add(new Konva.Rect({x:px,y:py,width:pw,height:13,fill:'#0a1a28',cornerRadius:[4,4,0,0]}));
        this.group.add(new Konva.Text({x:px+4,y:py+2,width:pw-8,text:'运动控制操作',fontSize:8,fontStyle:'bold',fill:'#80cbc4',align:'center'}));

        const bW=(pw-20)/6, bH=18, bY=py+16;
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

    // ── 波形区 ──
    _drawWaveform() {
        const { _wavX: wx, _wavY: wy, _wavW: ww, _wavH: wh } = this;
        if (wh<14) return;

        this.group.add(new Konva.Rect({x:wx,y:wy,width:ww,height:wh,fill:'#010d18',stroke:'#1a3040',strokeWidth:1.5,cornerRadius:4}));
        this.group.add(new Konva.Rect({x:wx,y:wy,width:ww,height:12,fill:'#0a1a28',cornerRadius:[4,4,0,0]}));
        this.group.add(new Konva.Text({x:wx+4,y:wy+1,width:ww-8,text:'速度 ω   转矩 T   电枢电流 ia   电枢电压 ua   制动器气隙 δ',fontSize:7.5,fill:'#80cbc4',align:'center'}));

        const nCh=4, hCh=(wh-12)/nCh;
        this._wavMids=Array.from({length:nCh},(_,i)=>wy+12+hCh*(i+0.5));
        this._wavMids.forEach(my=>this.group.add(new Konva.Line({points:[wx+2,my,wx+ww-2,my],stroke:'rgba(200,200,200,0.06)',strokeWidth:0.5,dash:[4,3]})));

        this._wLSpd  =new Konva.Line({points:[],stroke:'#4fc3f7',strokeWidth:1.5,lineJoin:'round'});
        this._wLTq   =new Konva.Line({points:[],stroke:'#ffd54f',strokeWidth:1.5,lineJoin:'round'});
        this._wLIa   =new Konva.Line({points:[],stroke:'#80cbc4',strokeWidth:1.5,lineJoin:'round'});
        this._wLUa   =new Konva.Line({points:[],stroke:'#ef9a9a',strokeWidth:1.5,lineJoin:'round'});
        this._wLBrkG =new Konva.Line({points:[],stroke:'#ffa726',strokeWidth:2,lineJoin:'round'});

        ['ω(rpm)','T(N·m)','ia(A)','ua(V)','δ制动'].forEach((l,i)=>{
            const colors=['#4fc3f7','#ffd54f','#80cbc4','#ef9a9a','#ffa726'];
            this.group.add(new Konva.Text({x:wx+4,y:wy+12+hCh*i+3,text:l,fontSize:7,fill:colors[i]}));
        });
        this.group.add(this._wLSpd,this._wLTq,this._wLIa,this._wLUa,this._wLBrkG);
        this._wavHCh=hCh;
    }

    // ═══════════════════════════════════════════ 动画和仿真
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


    // ── 制动器物理仿真 ──
    _tickBrakePhysics(dt) {
        const tauBrk = this.brakeL / (this.brakeR+1e-9);
        const iTarget= this._brakeEnergized ? this.brakeVoltage/this.brakeR : 0;
        this._brakeCoilI += (iTarget - this._brakeCoilI)*(1-Math.exp(-dt/tauBrk));
        this._brakeCoilI  = Math.max(0, this._brakeCoilI);

        const I_rated = this.brakeVoltage/this.brakeR;
        const F_em    = this.brakeSpring * (this._brakeCoilI/I_rated)**2 * 1.1;
        const engaged = F_em > this.brakeSpring * 0.85;
        const tauGap  = engaged ? this.brakeEngageT : this.brakeReleaseT;
        const gapTarget= engaged ? 1.0 : 0.0;
        this._brakeGapNorm += (gapTarget - this._brakeGapNorm)*(1-Math.exp(-dt/tauGap));
        this._brakeGap      = this._brakeGapNorm * this.brakeAirGap;

        const tempFactor = Math.max(0.5, 1-(this._brakeTemp-25)*0.003);
        const wearFactor = Math.max(0.6, 1-this._brakeWear/this.brakeMassWear*0.4);
        this._brakeTorqueAct = this.brakeTorque * (1-this._brakeGapNorm) * tempFactor * wearFactor;

        this._brakeSlipping = this._brakeTorqueAct > 0.05 && Math.abs(this._omegaR) > 0.1;
        if (this._brakeSlipping) {
            const slipPower  = this._brakeTorqueAct * Math.abs(this._omegaR);
            const dT  = (slipPower * this.brakeThermalR - (this._brakeTemp-25)) * dt / this.brakeThermalC * 10;
            this._brakeTemp = Math.max(25, this._brakeTemp + dT);
            this._brakeSlipE += slipPower * dt;
            if (this._brakeSlipE > 100) { this._brakeWear++; this._brakeSlipE = 0; }
        } else {
            this._brakeTemp += (25 - this._brakeTemp) * dt * 0.05;
        }
    }

    // ── 伺服物理仿真（直流电机模型）──
    _tickServoPhysics(dt) {
        const brakeFriction = this._brakeTorqueAct;

        if (!this._running) {
            const drag = this.B*this._omegaR;
            const bDrag= brakeFriction * Math.sign(this._omegaR);
            this._omegaR = Math.max(0, this._omegaR - (drag+Math.abs(bDrag))/this.J*dt);
            this._omegaR = this._omegaR > 0.01 ? this._omegaR : 0;
            this._thetaM += this._omegaR*dt;
            this.torqueEM = 0;
            this._ia = 0;
            this._emf = 0;
            this._updateWavBufs();
            return;
        }

        this._updateProfiler(dt);

        // ── 位置环 ──
        this._posErr   = this._posRef - this._thetaM;
        const dPosErr  = (this._posErr - this._posErrPrev) / (dt+1e-9);
        this._posErrPrev = this._posErr;
        const spdCmdPos= this.Kp_pos * this._posErr + this.Kd_pos * dPosErr;
        const spdFF   = this.Kff_spd * this._spdRef;
        const spdCmd  = spdCmdPos + spdFF;
        const spdClamped = Math.max(-this.maxOmega, Math.min(this.maxOmega, spdCmd));

        // ── 速度环（PI）输出电流给定 ──
        const spdErr   = spdClamped - this._omegaR;
        this._intSpd  += spdErr * this.Ki_spd * dt;
        this._intSpd   = Math.max(-this.peakCurrent, Math.min(this.peakCurrent, this._intSpd));
        const iaRef_raw= this.Kp_spd*spdErr + this._intSpd;
        
        // 加速度前馈（转换为电流）
        const accFF_ia = this.Kff_acc * this.J / this.Kt * (this._spdRef - this._omegaR) / (dt+1e-9);
        const iaRef    = Math.max(-this.peakCurrent, Math.min(this.peakCurrent, iaRef_raw + accFF_ia));
        this._iaRef    = iaRef;

        // ── 电流环（PI）输出电枢电压 ──
        const curErr   = iaRef - this._ia;
        this._intCur  += curErr * this.Ki_cur * dt;
        this._intCur   = Math.max(-this.ratedVoltage, Math.min(this.ratedVoltage, this._intCur));
        let uaCmd      = this.Kp_cur*curErr + this._intCur;
        
        // 反电动势前馈补偿
        uaCmd += this._emf;
        this._ua       = Math.max(-this.ratedVoltage*1.2, Math.min(this.ratedVoltage*1.2, uaCmd));

        // ── 直流电机电气动态 ──
        // 反电动势
        this._emf = this.Ke * this._omegaR;
        
        // 电枢电流微分方程：ua = Ra·ia + La·d(ia)/dt + E
        const dia_dt = (this._ua - this.Ra*this._ia - this._emf) / (this.La + 1e-9);
        this._ia += dia_dt * dt;
        this._ia = Math.max(-this.peakCurrent*1.2, Math.min(this.peakCurrent*1.2, this._ia));

        // 电磁转矩
        this.torqueEM = this.Kt * this._ia;

        // ── 机械方程 ──
        const frSign = Math.sign(this._omegaR) || Math.sign(this.torqueEM);
        const netTq  = this.torqueEM - this._loadTorque - this.B*this._omegaR - brakeFriction*frSign;
        this._omegaR += netTq/this.J*dt;
        this._omegaR  = Math.max(-this.maxOmega, Math.min(this.maxOmega, this._omegaR));
        this._thetaM += this._omegaR*dt;

        // 编码器
        this._encCounts = Math.round(this._thetaM/(2*Math.PI)*this.encoderCPR*4)
                        + Math.round((Math.random()-0.5)*this.encNoise*2);

        // 功率/效率
        const pCu = this.Ra * this._ia**2;
        this.powerOut = this.torqueEM * this._omegaR;
        this.powerIn = this._ua * this._ia;
        this.efficiency = this.powerIn>0.5 ? Math.min(90, Math.abs(this.powerOut/this.powerIn)*100) : 0;

        this._updateWavBufs();
    }

    // ── S 曲线规划器 ──
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

        let t=prof.t, v=0;
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

    _updateWavBufs() {
        const spd=this._omegaR*60/(2*Math.PI);
        this._wavPos    = new Float32Array([...this._wavPos.slice(1),    this._thetaM*180/Math.PI]);
        this._wavPosRef = new Float32Array([...this._wavPosRef.slice(1), this._posRef*180/Math.PI]);
        this._wavSpd    = new Float32Array([...this._wavSpd.slice(1),    spd]);
        this._wavTq     = new Float32Array([...this._wavTq.slice(1),     this.torqueEM]);
        this._wavIa     = new Float32Array([...this._wavIa.slice(1),     this._ia]);
        this._wavUa     = new Float32Array([...this._wavUa.slice(1),     this._ua]);
        this._wavBrakeG = new Float32Array([...this._wavBrakeG.slice(1), this._brakeGapNorm]);
    }

    // ── 转子动画 ──
    _tickRotorViz() {
        const th = this._thetaM;
        if (this._rotorWindings) {
            const wdgCount = this._rotorWindings.length;
            this._rotorWindings.forEach((wdg, idx) => {
                const angle = (idx / wdgCount) * 360 + th * 180/Math.PI;
                wdg.rotation(angle);
            });
        }
        if (this._commutatorRing) {
            this._commutatorRing.rotation(th * 180/Math.PI);
        }
        if (this._rotorRef) {
            const rR = this._rR || 45;
            this._rotorRef.x(this._mCX + rR*0.75*Math.cos(th));
            this._rotorRef.y(this._mCY + rR*0.75*Math.sin(th)*0.28);
        }
    }

    // ── 制动器动画 ──
    _tickBrakeViz() {
        this._brakeAnimGroup.destroyChildren();

        const yArmature = this._brakeArmatureY1 + this._brakeGapNorm*(this._brakeArmatureY0 - this._brakeArmatureY1);
        if (this._brakeArmatureRect) this._brakeArmatureRect.y(yArmature);

        const glowAlpha = Math.min(0.4, this._brakeCoilI/(this.brakeVoltage/this.brakeR)*0.4);
        if (this._brakeCoilGlow) this._brakeCoilGlow.fill(`rgba(255,167,38,${glowAlpha})`);

        const gapMM = (this._brakeGap*1000).toFixed(3);
        if (this._brakeGapLabel) this._brakeGapLabel.text(`δ=${gapMM}mm`);
        if (this._brakeGapLine && this._brakeSectionBLeft) {
            this._brakeGapLine.points([
                this._brakeSectionBLeft+4, yArmature+10,
                this._brakeSectionBLeft+4, this._brakeSectionFrY,
            ]);
        }

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

    // ── 位置跟踪曲线更新 ──
    _tickTraceChart() {
        const n=this._wavLen, aw=this._traceAW, ah=this._traceAH;
        const ox=this._traceOX, oy=this._traceOY;
        const wx=ox+1, dx=aw/n;

        const posMax = Math.max(1, Math.abs(this._targetPosDeg)*1.2, 360);
        const ptRef=[], ptPos=[], ptErr=[];
        for (let i=0;i<n;i++) {
            const x=wx+i*dx;
            ptRef.push(x, oy-(this._wavPosRef[i]/posMax)*(ah-4));
            ptPos.push(x, oy-(this._wavPos[i]   /posMax)*(ah-4));
            const err=Math.abs(this._wavPosRef[i]-this._wavPos[i]);
            ptErr.push(x, oy-(err/posMax)*(ah-4)*0.3);
        }
        this._tracePosRefLine.points(ptRef);
        this._tracePosLine.points(ptPos);
        this._traceErrLine.points(ptErr);
    }

    // ── S 曲线当前点 ──
    _tickSCrvPoint() {
        if (!this._scrvPoint) return;
        const vNorm = Math.abs(this._omegaR) / this.maxOmega;
        const tNorm = this._profile.active ? (this._profile.t / (this._profile.phase_t.reduce((s,v)=>s+v,0)+1e-9)) : 0;
        const px    = Math.max(this._scrvOX, Math.min(this._scrvOX+this._scrvAW, this._scrvOX+tNorm*this._scrvAW));
        const py    = Math.max(this._scrvOY-this._scrvAH+2, Math.min(this._scrvOY, this._scrvOY-vNorm*(this._scrvAH-4)));
        this._scrvPoint.x(px); this._scrvPoint.y(py);
        this._scrvPoint.fill(this._profile.active ? '#66bb6a' : '#37474f');
    }

    // ── 波形更新 ──
    _tickWaveform() {
        if (!this._wavHCh||!this._wavMids) return;
        const wx=this._wavX+3, ww=this._wavW-6, n=this._wavLen;
        const dx=ww/n, hCh=this._wavHCh;
        const [mS,mT,mIa,mUa,mBrk]=this._wavMids;

        const spdMax=Math.max(1,this.maxSpeed);
        const tqMax =Math.max(0.01,this.peakTorque);
        const iMax  =Math.max(0.01,this.peakCurrent);
        const uMax  =Math.max(0.01,this.ratedVoltage*1.2);

        const ptS=[],ptT=[],ptIa=[],ptUa=[],ptG=[];
        for (let i=0;i<n;i++) {
            const x=wx+i*dx;
            ptS.push(x, mS-(this._wavSpd[i]/spdMax)*hCh*0.38);
            ptT.push(x, mT-(this._wavTq[i] /tqMax) *hCh*0.38);
            ptIa.push(x, mIa-(Math.abs(this._wavIa[i])/iMax)*hCh*0.38);
            ptUa.push(x, mUa-(Math.abs(this._wavUa[i])/uMax)*hCh*0.38);
            ptG.push(x, mBrk-(this._wavBrakeG[i])*hCh*0.38);
        }
        this._wLSpd.points(ptS); this._wLTq.points(ptT);
        this._wLIa.points(ptIa); this._wLUa.points(ptUa);
        this._wLBrkG.points(ptG);
    }

    // ── 仪表显示 ──
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
            if (c.ia)    c.ia.text(this._ia.toFixed(2));
            if (c.ua)    c.ua.text(this._ua.toFixed(1));
            if (c.emf)   c.emf.text(this._emf.toFixed(1));
            if (c.iref)  c.iref.text(this._iaRef.toFixed(2));
            if (c.brake){ c.brake.text(brakeState);
                          c.brake.fill(this._brakeGapNorm<0.1?'#ffa726':'#66bb6a'); }
            if (c.eff) { c.eff.text(this.efficiency.toFixed(1));
                         c.eff.fill(this.efficiency>85?'#66bb6a':this.efficiency>70?'#ffa726':'#ef5350'); }
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

        if (this._ctrlErrLabel) this._ctrlErrLabel.text(`e=${errD.toFixed(2)}°`);
        if (this._ctrlSpdLabel) this._ctrlSpdLabel.text(`ω*=${(this._spdRef*60/(2*Math.PI)).toFixed(0)}rpm`);
        if (this._ctrlCurLabel) this._ctrlCurLabel.text(`ia*=${this._iaRef.toFixed(2)}A`);

        Object.values(this._sliderBars||{}).forEach(({bar,txt,slW,getR,disp})=>{
            bar.width(Math.min(slW,Math.max(0,getR())*slW));
            txt.text(disp());
        });
    }

    // ═══════════════════════════════════════════ 公共接口
    servoOn() {
        if (!this._running) {
            this._brakeEnergized = true;
            setTimeout(()=>{ this._running=true; }, this.brakeEngageT*1000+20);
        }
    }

    servoOff() {
        this._running        = false;
        this._brakeEnergized = false;
        this._intSpd=this._intCur=0;
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
    getCurrent()   { return this._ia; }
    getVoltage()   { return this._ua; }
    getEMF()       { return this._emf; }
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
            {label:'额定电压 (V)',            key:'ratedVoltage',    type:'number'},
            {label:'额定转速 (rpm)',          key:'ratedSpeed',      type:'number'},
            {label:'最高转速 (rpm)',          key:'maxSpeed',        type:'number'},
            {label:'额定转矩 (N·m)',          key:'ratedTorque',     type:'number'},
            {label:'峰值转矩 (N·m)',          key:'peakTorque',      type:'number'},
            {label:'额定电流 (A)',            key:'ratedCurrent',    type:'number'},
            {label:'电枢电阻 Ra (Ω)',         key:'Ra',              type:'number'},
            {label:'电枢电感 La (mH)',        key:'La',              type:'number'},
            {label:'转矩常数 Kt (N·m/A)',     key:'Kt',              type:'number'},
            {label:'反电动势常数 Ke (V/(rad/s))', key:'Ke',          type:'number'},
            {label:'转动惯量 J (kg·m²)',      key:'J',               type:'number'},
            {label:'制动器额定转矩 (N·m)',    key:'brakeTorque',     type:'number'},
            {label:'制动器电压 (V)',          key:'brakeVoltage',    type:'number'},
            {label:'编码器线数 (线/转)',       key:'encoderCPR',      type:'number'},
            {label:'位置环增益 Kp_pos',       key:'Kp_pos',          type:'number'},
            {label:'速度环增益 Kp_spd',       key:'Kp_spd',          type:'number'},
            {label:'速度环积分 Ki_spd',       key:'Ki_spd',          type:'number'},
            {label:'电流环增益 Kp_cur',       key:'Kp_cur',          type:'number'},
            {label:'电流环积分 Ki_cur',       key:'Ki_cur',          type:'number'},
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
        if (cfg.Ra)            this.Ra           = n('Ra');
        if (cfg.La)            this.La           = n('La')*1e-3;
        if (cfg.Kt)            this.Kt           = n('Kt');
        if (cfg.Ke)            this.Ke           = n('Ke');
        if (cfg.J)             this.J            = n('J');
        if (cfg.brakeTorque)   this.brakeTorque  = n('brakeTorque');
        if (cfg.brakeVoltage)  this.brakeVoltage = n('brakeVoltage');
        if (cfg.encoderCPR)    this.encoderCPR   = parseInt(cfg.encoderCPR);
        if (cfg.Kp_pos)        this.Kp_pos       = n('Kp_pos');
        if (cfg.Kp_spd)        this.Kp_spd       = n('Kp_spd');
        if (cfg.Ki_spd)        this.Ki_spd       = n('Ki_spd');
        if (cfg.Kp_cur)        this.Kp_cur       = n('Kp_cur');
        if (cfg.Ki_cur)        this.Ki_cur       = n('Ki_cur');

        this.maxOmega = this.maxSpeed*2*Math.PI/60;
        this.tauE = this.La / (this.Ra+1e-9);
        this.config    = {...this.config,...cfg};
        this._refreshCache();
    }

    destroy() {
        super.destroy?.();
    }
}