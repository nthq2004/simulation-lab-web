import { BaseComponent } from './BaseComponent.js';

/**
 * 永磁同步电机仿真组件
 * （Permanent Magnet Synchronous Motor，PMSM）
 *
 * ── 与 BLDC 的核心区别 ────────────────────────────────────────
 *
 *  ┌──────────────┬─────────────────────────┬─────────────────────────┐
 *  │              │  BLDC（无刷直流电机）    │  PMSM（永磁同步电机）   │
 *  ├──────────────┼─────────────────────────┼─────────────────────────┤
 *  │ 反电动势波形 │ 梯形波                  │ 正弦波                  │
 *  │ 控制方式     │ 六步方波换向            │ FOC 磁场定向控制（矢量）│
 *  │ 电流波形     │ 方波/准方波             │ 正弦波（三相对称）      │
 *  │ 转矩脉动     │ ~15%（换向脉冲）        │ <1%（FOC 理想条件下）   │
 *  │ 转子位置     │ 霍尔传感器（离散60°）   │ 编码器/解算器（连续）   │
 *  │ 坐标变换     │ 无                     │ Clarke + Park 变换      │
 *  │ 控制带宽     │ 较低                   │ 很高（电流环 >10kHz）   │
 *  │ 弱磁扩速     │ 不支持                 │ 支持（超额定速度运行）  │
 *  │ 磁阻转矩     │ SPM 无（IPM 有）        │ IPM 有 d/q 轴磁阻分量   │
 *  └──────────────┴─────────────────────────┴─────────────────────────┘
 *
 * ── PMSM 工作原理 ─────────────────────────────────────────────
 *
 *  1. 数学模型（d-q 旋转坐标系，转子磁场定向）：
 *     d 轴：沿转子永磁体磁通方向（励磁轴）
 *     q 轴：超前 d 轴 90° 电角度（转矩轴）
 *
 *     电压方程：
 *       u_d = R_s×i_d + L_d×(di_d/dt) - ω_e×L_q×i_q
 *       u_q = R_s×i_q + L_q×(di_q/dt) + ω_e×(L_d×i_d + ψ_f)
 *     其中 ψ_f 为永磁体磁链，ω_e = p×ω_r（电角速度）
 *
 *     电磁转矩：
 *       T_e = 1.5 × p × [ψ_f×i_q + (L_d - L_q)×i_d×i_q]
 *       ├─ ψ_f×i_q：永磁转矩（主分量）
 *       └─ (L_d-L_q)×i_d×i_q：磁阻转矩（IPM 凸极效应）
 *
 *     对于表贴式 PMSM（SPM）：L_d = L_q，磁阻转矩为零
 *     对于内嵌式 PMSM（IPM）：L_d < L_q，磁阻转矩可占 20~40%
 *
 *  2. FOC 磁场定向控制（Field Oriented Control）：
 *     Clarke 变换（abc → αβ 静止坐标系）：
 *       i_α = i_a
 *       i_β = (i_a + 2×i_b) / √3
 *     Park 变换（αβ → dq 旋转坐标系，需转子位置 θ_e）：
 *       i_d =  i_α×cos(θ_e) + i_β×sin(θ_e)
 *       i_q = -i_α×sin(θ_e) + i_β×cos(θ_e)
 *
 *     控制目标：
 *       id* = 0（MTPA，最大转矩/电流比，SPM 最优）
 *            < 0（弱磁区：i_d < 0 使气隙磁通减小）
 *       iq* = T* /( 1.5×p×ψ_f )（转矩给定→电流给定）/
 
 /**
 *  3. 最大转矩电流比（MTPA，Maximum Torque Per Ampere）：
 *     SPM：id* = 0，全部电流用于产生转矩
 *     IPM：id* = [ψ_f - √(ψ_f² + 8(L_q-L_d)²×is²)] / [4(L_q-L_d)]
 *     MTPA 轨迹在 i_d-i_q 平面上为曲线
 *
 *  4. 弱磁控制（Field Weakening）：
 *     当转速超过额定（基速），逆变器输出电压达到极限：
 *       √(u_d² + u_q²) ≤ V_dc/√3（电压极限圆）
 *     需引入 i_d < 0（去磁电流）以减小 ψ_q 分量
 *     弱磁后转速可达 2~3 倍基速，但转矩相应减小
 *     电流极限圆：i_d² + i_q² ≤ I_max²
 *
 *  5. 空间矢量 PWM（SVPWM）：
 *     将 d-q 电压指令逆变换为三相 PWM 占空比
 *     逆 Park：(u_d, u_q) → (u_α, u_β)
 *     逆 Clarke：(u_α, u_β) → (u_a, u_b, u_c)
 *     六扇区调制，直流母线利用率 = 1/√3 × V_dc（相比六步提高 15.5%）
 *
 *  6. 凸极比（凸极效应）：
 *     ξ = L_q / L_d（IPM 典型值 2~4，SPM ≈ 1）
 *     磁阻转矩比例 ≈ (ξ-1) × i_d / (ψ_f/L_d)
 *
 * ── 组件结构 ──────────────────────────────────────────────────
 *  ① 电机横截面（IPM 永磁转子 + 正弦绕组 + 编码器位置指示）
 *  ② FOC 控制框图（速度环→转矩环→dq 电流环→Park 逆变换→SVPWM）
 *  ③ d-q 电流平面图（电流极限圆 + 电压极限椭圆 + MTPA 轨迹 + 工作点）
 *  ④ 相量图（ψ_f、i_d、i_q、u_d、u_q、合成电压/电流矢量）
 *  ⑤ 三相正弦电流 + 反电动势波形（动态，对比 BLDC 梯形波）
 *  ⑥ T-n 特性曲线（基速区恒转矩 + 弱磁区恒功率）
 *  ⑦ 转矩分解（永磁转矩 + 磁阻转矩 vs id，MTPA 可视化）
 *  ⑧ LCD 仪表（转速/转矩/id/iq/ud/uq/功率/效率/调制比/磁链）
 *  ⑨ 控制面板（目标转速/id给定/负载转矩/MTPA自动/弱磁使能/起停）
 *
 * ── 端口 ─────────────────────────────────────────────────────
 *  dc_pos    — 直流母线正极
 *  dc_neg    — 直流母线负极
 *  phase_u   — 三相输出 U
 *  phase_v   — 三相输出 V
 *  phase_w   — 三相输出 W
 *  enc_a     — 编码器 A 相
 *  enc_b     — 编码器 B 相
 *  enc_z     — 编码器 Z 相（零点）
 *  shaft     — 输出轴
 */

export class PMSMMotor extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.width  = Math.max(580, config.width  || 720);
        this.height = Math.max(440, config.height || 580);

        this.type    = 'pmsm_motor';
        this.special = 'none';
        this.cache   = 'fixed';

        // ── 额定参数 ──
        this.ratedPower   = config.ratedPower   || 3000;   // W
        this.ratedVoltage = config.ratedVoltage || 310;    // V（直流母线，如三相380V整流后）
        this.ratedSpeed   = config.ratedSpeed   || 3000;   // rpm（基速）
        this.ratedTorque  = config.ratedTorque  || (this.ratedPower / (this.ratedSpeed*2*Math.PI/60));
        this.ratedCurrent = config.ratedCurrent || 10;     // A（峰值）
        this.polePairs    = config.polePairs    || 3;      // 极对数
        this.motorType    = config.motorType    || 'IPM';  // 'SPM' | 'IPM'

        // ── 电机电磁参数 ──
        this.Rs    = config.Rs    || 0.5;      // Ω（定子电阻）
        this.Ld    = config.Ld    || 5e-3;     // H（d 轴电感）
        this.Lq    = config.Lq    || 10e-3;    // H（q 轴电感，IPM: Lq > Ld）
        this.psiF  = config.psiF  || 0.15;     // Wb（永磁体磁链）
        this.Ke    = this.psiF * this.polePairs * Math.sqrt(1.5); // 反电动势系数

        // 凸极比
        this.saliencyRatio = this.Lq / this.Ld; // ξ = Lq/Ld（SPM≈1，IPM=2~4）

        // ── 机械参数 ──
        this.J        = config.J        || 1e-3;   // kg·m²
        this.B        = config.B        || 1e-3;   // N·m·s/rad（粘性阻尼）
        this.maxSpeed = config.maxSpeed || 9000;   // rpm（弱磁最高转速）
        this.maxTorque= config.maxTorque|| this.ratedTorque * 3.0;
        this.maxCurrent= config.maxCurrent|| this.ratedCurrent * 1.5; // A

        // 基速（额定磁链下最大转速）
        this.baseSpeed = this.ratedSpeed;

        // ── FOC 控制参数 ──
        // 电流环 PI
        this.kpId  = config.kpId  || 15.0;
        this.kiId  = config.kiId  || 800.0;
        this.kpIq  = config.kpIq  || 15.0;
        this.kiIq  = config.kiIq  || 800.0;
        // 速度环 PI
        this.kpSpd = config.kpSpd || 0.05;
        this.kiSpd = config.kiSpd || 0.8;

        // ── 运行状态 ──
        this._running      = false;
        this._thetaE       = 0;          // 电角度 rad
        this._thetaM       = 0;          // 机械角度 rad
        this._omegaR       = 0;          // 转子角速度 rad/s（机械）
        this._speed        = 0;          // rpm

        // 控制给定
        this._speedRef     = config.initSpeed || this.ratedSpeed * 0.8;
        this._idRef        = 0;          // d 轴电流给定（A）
        this._iqRef        = 0;          // q 轴电流给定（A）
        this._loadTorque   = config.initLoad || 0;
        this._mtpaEnable   = true;       // MTPA 自动
        this._fwEnable     = config.fwEnable !== false; // 弱磁使能

        // FOC 内部状态
        this._id           = 0;          // 实际 d 轴电流 A
        this._iq           = 0;          // 实际 q 轴电流 A
        this._ud           = 0;          // d 轴电压 V
        this._uq           = 0;          // q 轴电压 V
        this._intId        = 0;          // id 积分项
        this._intIq        = 0;          // iq 积分项
        this._intSpd       = 0;          // 速度积分项
        this._modRatio     = 0;          // 调制比（0~1）

        // 三相量
        this._ia = 0; this._ib = 0; this._ic = 0;
        this._ea = 0; this._eb = 0; this._ec = 0;
        this._ua = 0; this._ub = 0; this._uc = 0;

        // 输出量
        this.torqueEM      = 0;
        this.torquePM      = 0;          // 永磁转矩分量
        this.torqueRel     = 0;          // 磁阻转矩分量
        this.psiD          = 0;          // d 轴磁链
        this.psiQ          = 0;          // q 轴磁链
        this.powerIn       = 0;
        this.powerOut      = 0;
        this.efficiency    = 0;
        this.cosPhi        = 0;

        // ── 波形缓冲 ──
        this._wavLen    = 300;
        this._wavIa     = new Float32Array(this._wavLen).fill(0);
        this._wavIb     = new Float32Array(this._wavLen).fill(0);
        this._wavIc     = new Float32Array(this._wavLen).fill(0);
        this._wavEa     = new Float32Array(this._wavLen).fill(0);
        this._wavId     = new Float32Array(this._wavLen).fill(0);
        this._wavIq     = new Float32Array(this._wavLen).fill(0);
        this._wavT      = new Float32Array(this._wavLen).fill(0);
        this._wavTpm    = new Float32Array(this._wavLen).fill(0);
        this._wavTrel   = new Float32Array(this._wavLen).fill(0);

        // ── 几何布局 ──
        // 电机截面（左上）
        this._motX   = Math.round(this.width * 0.02);
        this._motY   = Math.round(this.height * 0.04);
        this._motW   = Math.round(this.width * 0.26);
        this._motH   = Math.round(this.height * 0.42);
        this._motCX  = this._motX + this._motW / 2;
        this._motCY  = this._motY + this._motH / 2;

        // FOC 控制框图（右上，横跨中右）
        this._focX   = Math.round(this.width * 0.30);
        this._focY   = this._motY;
        this._focW   = Math.round(this.width * 0.67);
        this._focH   = Math.round(this.height * 0.24);

        // d-q 电流平面（左中）
        this._dqX    = this._motX;
        this._dqY    = this._motY + this._motH + 8;
        this._dqW    = Math.round(this.width * 0.26);
        this._dqH    = Math.round(this.height * 0.26);

        // 相量图（中中）
        this._phX    = Math.round(this.width * 0.30);
        this._phY    = this._focY + this._focH + 8;
        this._phW    = Math.round(this.width * 0.22);
        this._phH    = Math.round(this.height * 0.26);

        // T-n 特性曲线（右中上）
        this._tnX    = this._phX + this._phW + 8;
        this._tnY    = this._phY;
        this._tnW    = Math.round(this.width * 0.22);
        this._tnH    = Math.round(this.height * 0.26);

        // 转矩分解图（最右中）
        this._tdX    = this._tnX + this._tnW + 8;
        this._tdY    = this._phY;
        this._tdW    = this.width - this._tdX - Math.round(this.width * 0.02);
        this._tdH    = this._tnH;

        // LCD（左下）
        this._lcdX   = this._motX;
        this._lcdY   = this._dqY + this._dqH + 8;
        this._lcdW   = this._motW;
        this._lcdH   = Math.round(this.height * 0.24);

        // 控制面板（中下）
        this._panX   = this._phX;
        this._panY   = this._phY + this._phH + 8;
        this._panW   = this.width - this._phX - Math.round(this.width * 0.02);
        this._panH   = Math.round(this.height * 0.16);

        // 波形（底部全宽）
        this._wavX   = this._motX;
        this._wavY   = Math.max(this._lcdY + this._lcdH, this._panY + this._panH) + 6;
        this._wavW   = this.width - this._motX * 2;
        this._wavH   = this.height - this._wavY - 6;

        this._phasorAngle = 0;

        this.config = {
            id: this.id,
            ratedPower: this.ratedPower,
            ratedVoltage: this.ratedVoltage,
            ratedSpeed: this.ratedSpeed,
            motorType: this.motorType,
        };

        this._init();

        // 端口
        const mL = this._motX - 6;
        this.addPort(mL, this._motCY - 20, 'dc_pos', 'wire', '+VDC');
        this.addPort(mL, this._motCY + 20, 'dc_neg', 'wire', '−VDC');
        const mR = this._motX + this._motW + 6;
        this.addPort(mR, this._motCY - 28, 'phase_u', 'wire', 'U');
        this.addPort(mR, this._motCY,       'phase_v', 'wire', 'V');
        this.addPort(mR, this._motCY + 28, 'phase_w', 'wire', 'W');
        this.addPort(mR, this._motCY + 54, 'enc_a',  'wire', 'EncA');
        this.addPort(mR, this._motCY + 68, 'enc_b',  'wire', 'EncB');
        this.addPort(mR, this._motCY + 82, 'enc_z',  'wire', 'EncZ');
        this.addPort(this._motCX, this._motY + this._motH + 6, 'shaft', 'pipe', '轴');
    }

    // ═══════════════════════════════════════════
    _init() {
        this._drawLabel();
        this._drawMotorSection();
        this._drawMagnetFluxLayer();
        this._drawRotorLayer();
        this._drawFOCDiagram();
        this._drawDQPlane();
        this._drawPhasorDiagram();
        this._drawTNCurve();
        this._drawTorqueDecomposition();
        this._drawLCDPanel();
        this._drawControlPanel();
        this._drawWaveform();
        
    }

    _drawLabel() {
        const typeStr = this.motorType === 'IPM'
            ? `IPM（内嵌永磁，Ld=${(this.Ld*1000).toFixed(1)}mH / Lq=${(this.Lq*1000).toFixed(1)}mH，ξ=${this.saliencyRatio.toFixed(1)}）`
            : `SPM（表贴永磁，Ld=Lq=${(this.Ld*1000).toFixed(1)}mH）`;
        this.group.add(new Konva.Text({
            x: 0, y: -22, width: this.width,
            text: `PMSM 永磁同步电机  ${this.ratedPower}W  ${this.ratedVoltage}V DC  ${this.ratedSpeed}rpm  ${this.polePairs*2}极  FOC 矢量控制  ${typeStr}`,
            fontSize: 10, fontStyle: 'bold', fill: '#1a2634', align: 'center',
        }));
    }

    // ── 电机横截面（IPM 转子 + 正弦分布绕组） ──
    _drawMotorSection() {
        const { _motX: ex, _motY: ey, _motW: ew, _motH: eh,
                _motCX: ecx, _motCY: ecy } = this;

        this.group.add(new Konva.Rect({
            x: ex, y: ey, width: ew, height: eh,
            fill: '#0d1a24', stroke: '#1a3040', strokeWidth: 1.5, cornerRadius: 5,
        }));
        this.group.add(new Konva.Text({
            x: ex, y: ey - 14, width: ew,
            text: `PMSM 截面（${this.polePairs*2}极，${this.motorType}）`,
            fontSize: 9, fontStyle: 'bold', fill: '#546e7a', align: 'center',
        }));

        // 机座
        const frameR = Math.round(Math.min(ew,eh)*0.46);
        this.group.add(new Konva.Circle({x:ecx,y:ecy,radius:frameR,fill:'#1c2b38',stroke:'#37474f',strokeWidth:3}));

        // 定子铁芯（叠片）
        const sOuter = Math.round(frameR*0.90);
        const sInner = Math.round(frameR*0.60);
        this.group.add(new Konva.Ring({x:ecx,y:ecy,innerRadius:sInner,outerRadius:sOuter,fill:'#455a64',stroke:'#263238',strokeWidth:1}));

        // 叠片纹
        for (let i=0;i<48;i++) {
            const a=(i/48)*Math.PI*2;
            this.group.add(new Konva.Line({
                points:[ecx+sInner*Math.cos(a),ecy+sInner*Math.sin(a),ecx+sOuter*Math.cos(a),ecy+sOuter*Math.sin(a)],
                stroke:'rgba(0,0,0,0.12)',strokeWidth:0.5,
            }));
        }

        // 定子槽（36槽）
        const slotN=36, slotD=(sOuter-sInner)*0.52;
        for (let i=0;i<slotN;i++) {
            const a=(i/slotN)*Math.PI*2-Math.PI/2;
            this.group.add(new Konva.Line({
                points:[ecx+(sInner+2)*Math.cos(a),ecy+(sInner+2)*Math.sin(a),ecx+(sInner+slotD)*Math.cos(a),ecy+(sInner+slotD)*Math.sin(a)],
                stroke:'#0d1a24',strokeWidth:3.5,
            }));
        }

        // 正弦分布三相绕组（PMSM 关键：正弦绕组，非集中绕组）
        // 每槽绕组密度按 cos 分布着色（模拟正弦分布）
        const wR = sInner + slotD*0.5;
        const phColors = ['#e53935','#43a047','#1e88e5'];
        for (let i=0;i<slotN;i++) {
            const a  = (i/slotN)*Math.PI*2 - Math.PI/2;
            // 正弦分布：三相各占 120°，密度随角度变化
            const ph = i%3;
            const density = Math.abs(Math.cos(i/slotN*Math.PI*2 - ph*2*Math.PI/3));
            const col = phColors[ph];
            this.group.add(new Konva.Circle({
                x:ecx+wR*Math.cos(a), y:ecy+wR*Math.sin(a),
                radius: 3+density*4, fill:col, opacity:0.4+density*0.5,
            }));
        }

        // 气隙
        this._airGapR = Math.round(sInner*0.97);
        this.group.add(new Konva.Circle({x:ecx,y:ecy,radius:this._airGapR,fill:'#06101a',stroke:'#1a3040',strokeWidth:0.5}));

        // 编码器符号（定子内壁右侧）
        const encR = this._airGapR-5;
        this.group.add(new Konva.Arc({x:ecx,y:ecy,innerRadius:encR-3,outerRadius:encR+3,angle:30,rotation:-15,fill:'#ffd54f',opacity:0.7}));
        this.group.add(new Konva.Text({x:ecx+encR*0.7,y:ecy-encR*0.3,text:'Enc',fontSize:7,fill:'#ffd54f'}));

        // 轴孔
        this.group.add(new Konva.Circle({x:ecx,y:ecy,radius:8,fill:'#1a252f',stroke:'#37474f',strokeWidth:1.5}));

        // 三相端子 + 编码器信号（右侧）
        const termX = ex+ew+10;
        [['U','#e53935',-28],['V','#43a047',0],['W','#1e88e5',28]].forEach(([l,c,dy])=>{
            this.group.add(new Konva.Line({points:[ecx+sOuter*0.6,ecy+dy,termX,ecy+dy],stroke:c,strokeWidth:2}));
            this.group.add(new Konva.Circle({x:termX,y:ecy+dy,radius:3.5,fill:c}));
            this.group.add(new Konva.Text({x:termX+5,y:ecy+dy-6,text:l,fontSize:9,fill:c,fontStyle:'bold'}));
        });
        [['EncA',54],['EncB',68],['EncZ',82]].forEach(([l,dy])=>{
            this.group.add(new Konva.Line({points:[ecx+encR*0.7,ecy+dy,termX,ecy+dy],stroke:'#ffd54f',strokeWidth:1.2,dash:[3,3]}));
            this.group.add(new Konva.Circle({x:termX,y:ecy+dy,radius:3,fill:'#ffd54f'}));
            this.group.add(new Konva.Text({x:termX+5,y:ecy+dy-5,text:l,fontSize:7.5,fill:'#ffd54f'}));
        });

        // 直流母线端子（左侧）
        this.group.add(new Konva.Line({points:[ex-14,ecy-20,ex+12,ecy-20],stroke:'#ef5350',strokeWidth:2}));
        this.group.add(new Konva.Line({points:[ex-14,ecy+20,ex+12,ecy+20],stroke:'#90caf9',strokeWidth:2}));
        this.group.add(new Konva.Circle({x:ex-14,y:ecy-20,radius:3,fill:'#ef5350'}));
        this.group.add(new Konva.Circle({x:ex-14,y:ecy+20,radius:3,fill:'#90caf9'}));
        this.group.add(new Konva.Text({x:ex-26,y:ecy-26,text:'+',fontSize:10,fill:'#ef5350',fontStyle:'bold'}));
        this.group.add(new Konva.Text({x:ex-26,y:ecy+16,text:'−',fontSize:10,fill:'#90caf9',fontStyle:'bold'}));

        // 输出轴
        this.group.add(new Konva.Rect({x:ecx-5,y:ey+eh,width:10,height:10,fill:'#78909c',stroke:'#546e7a',strokeWidth:1}));

        this._sInner = sInner; this._sOuter = sOuter; this._frameR = frameR;
    }

    // ── 磁通动画层 ──────────────────────────
    _drawMagnetFluxLayer() {
        this._fluxGroup = new Konva.Group();
        this.group.add(this._fluxGroup);
    }

    // ── IPM 转子（内嵌永磁，V 形磁槽） ──────
    _drawRotorLayer() {
        const ecx = this._motCX, ecy = this._motCY;
        const rotorR = Math.round(this._airGapR*0.85);

        this._rotorGroup = new Konva.Group({x:ecx,y:ecy});

        // 转子铁芯
        this._rotorGroup.add(new Konva.Circle({
            radius:rotorR, fill:'#37474f', stroke:'#263238', strokeWidth:1.5,
        }));

        const nPoles = this.polePairs*2;
        for (let i=0;i<nPoles;i++) {
            const aCenter = (i/nPoles)*Math.PI*2 - Math.PI/2;
            const isN     = (i%2===0);

            if (this.motorType==='IPM') {
                // V 形内嵌磁槽（IPM 特征）
                const magL = rotorR*0.48, magH = rotorR*0.12;
                const vAngle = Math.PI/10; // V 形张角

                [-1,1].forEach(side => {
                    const slotA = aCenter + side*vAngle;
                    const mr    = rotorR*0.60;
                    const mx    = mr*Math.cos(slotA), my = mr*Math.sin(slotA);
                    const tx    = Math.cos(slotA+Math.PI/2), ty = Math.sin(slotA+Math.PI/2);

                    // 磁槽（暗色矩形）
                    const pts = [
                        mx-tx*magL/2-ty*magH/2, my-ty*magL/2+tx*magH/2,
                        mx+tx*magL/2-ty*magH/2, my+ty*magL/2+tx*magH/2,
                        mx+tx*magL/2+ty*magH/2, my+ty*magL/2-tx*magH/2,
                        mx-tx*magL/2+ty*magH/2, my-ty*magL/2-tx*magH/2,
                    ];
                    this._rotorGroup.add(new Konva.Line({
                        points:pts, closed:true,
                        fill: isN ? '#ef9a9a' : '#90caf9',
                        stroke: isN ? '#b71c1c' : '#0d47a1', strokeWidth:0.8,
                    }));
                });
                // 极性标注
                this._rotorGroup.add(new Konva.Text({
                    x:rotorR*0.35*Math.cos(aCenter)-6, y:rotorR*0.35*Math.sin(aCenter)-6,
                    text:isN?'N':'S', fontSize:9, fontStyle:'bold',
                    fill:isN?'#ffcdd2':'#bbdefb',
                }));
            } else {
                // SPM 表贴永磁（弧形磁钢）
                const arcHalfW = Math.PI/nPoles*0.85;
                const magRad   = rotorR*0.88;
                const magThick = rotorR*0.14;
                const pts=[];
                for (let a=aCenter-arcHalfW;a<=aCenter+arcHalfW;a+=0.05)
                    pts.push((magRad+magThick/2)*Math.cos(a),(magRad+magThick/2)*Math.sin(a));
                for (let a=aCenter+arcHalfW;a>=aCenter-arcHalfW;a-=0.05)
                    pts.push((magRad-magThick/2)*Math.cos(a),(magRad-magThick/2)*Math.sin(a));
                this._rotorGroup.add(new Konva.Line({
                    points:pts, closed:true,
                    fill:isN?'#ef9a9a':'#90caf9',
                    stroke:isN?'#b71c1c':'#0d47a1', strokeWidth:0.8,
                }));
                this._rotorGroup.add(new Konva.Text({
                    x:magRad*Math.cos(aCenter)-5, y:magRad*Math.sin(aCenter)-5,
                    text:isN?'N':'S', fontSize:9, fontStyle:'bold',
                    fill:isN?'#ffcdd2':'#bbdefb',
                }));
            }
        }

        // d / q 轴标注
        this._rotorGroup.add(new Konva.Line({points:[0,-rotorR*0.95,0,rotorR*0.95],stroke:'#ffd54f',strokeWidth:1,dash:[4,3],opacity:0.6}));
        this._rotorGroup.add(new Konva.Line({points:[-rotorR*0.95,0,rotorR*0.95,0],stroke:'#80cbc4',strokeWidth:1,dash:[4,3],opacity:0.6}));
        this._rotorGroup.add(new Konva.Text({x:3,y:-rotorR*0.96,text:'d',fontSize:9,fill:'#ffd54f',opacity:0.8}));
        this._rotorGroup.add(new Konva.Text({x:rotorR*0.96+2,y:-5,text:'q',fontSize:9,fill:'#80cbc4',opacity:0.8}));

        // 轴 + 参考点
        this._rotorGroup.add(new Konva.Circle({radius:8,fill:'#1a252f',stroke:'#37474f',strokeWidth:1.5}));
        this._rotorGroup.add(new Konva.Circle({x:rotorR*0.55,y:0,radius:3,fill:'#ffd54f'}));

        this.group.add(this._rotorGroup);
        this._rotorR = rotorR;
    }

    // ── FOC 控制框图 ─────────────────────────
    _drawFOCDiagram() {
        const { _focX: fx, _focY: fy, _focW: fw, _focH: fh } = this;

        this.group.add(new Konva.Rect({x:fx,y:fy,width:fw,height:fh,fill:'#010d18',stroke:'#1a3040',strokeWidth:1.5,cornerRadius:4}));
        this.group.add(new Konva.Rect({x:fx,y:fy,width:fw,height:13,fill:'#0a1a28',cornerRadius:[4,4,0,0]}));
        this.group.add(new Konva.Text({x:fx+4,y:fy+2,width:fw-8,text:'FOC 磁场定向控制框图（速度外环→dq 电流内环→SVPWM）',fontSize:8,fontStyle:'bold',fill:'#80cbc4',align:'center'}));

        // 各模块 x 位置（均匀分布）
        const y0 = fy+fh/2+2;
        const blocks = [
            { lbl:'n*\n给定', x:fx+20,   w:30, col:'#ffd54f', bg:'#1a1a0a' },
            { lbl:'速度\nPI',  x:fx+66,   w:32, col:'#66bb6a', bg:'#0a1a0a' },
            { lbl:'MTPA\n轨迹',x:fx+116,  w:32, col:'#4fc3f7', bg:'#0a1520' },
            { lbl:'iq/id\nPI', x:fx+166,  w:32, col:'#ef9a9a', bg:'#1a0a0a' },
            { lbl:'前馈\n解耦', x:fx+216, w:32, col:'#ffa726', bg:'#1a1000' },
            { lbl:'逆Park\n变换',x:fx+266, w:32, col:'#ce93d8', bg:'#180a28' },
            { lbl:'SVPWM', x:fx+310,     w:36, col:'#80cbc4', bg:'#0a181a' },
            { lbl:'三相\n逆变器',x:fx+360,w:34, col:'#90caf9', bg:'#0a1020' },
            { lbl:'PMSM\n电机', x:fx+408, w:34, col:'#e8a0a0', bg:'#1a0a0a' },
            { lbl:'Park\n变换', x:fx+456, w:32, col:'#a5d6a7', bg:'#0a1a0a' },
            { lbl:'Clarke\n变换',x:fx+498,w:32, col:'#b0bec5', bg:'#111820' },
        ];

        // 主信号线（从左到右，从右反馈回左）
        const lineY = y0;
        this.group.add(new Konva.Line({
            points:[fx+14,lineY, fx+fw-14,lineY],
            stroke:'#1a3040',strokeWidth:1,
        }));

        blocks.forEach(({ lbl, x, w, col, bg }) => {
            this.group.add(new Konva.Rect({x,y:y0-14,width:w,height:28,fill:bg,stroke:col,strokeWidth:1,cornerRadius:3}));
            this.group.add(new Konva.Text({x,y:y0-12,width:w,text:lbl,fontSize:7,fill:col,align:'center',lineHeight:1.35}));
        });

        // 动态信号箭头（主链路）
        const arrowCols = ['#ffd54f','#66bb6a','#4fc3f7','#ef9a9a','#ffa726','#ce93d8','#80cbc4','#90caf9','#e8a0a0','#a5d6a7'];
        for (let i=0;i<blocks.length-1;i++) {
            const x1 = blocks[i].x+blocks[i].w;
            const x2 = blocks[i+1].x;
            this.group.add(new Konva.Arrow({
                points:[x1,y0,x2,y0],
                stroke:arrowCols[i%arrowCols.length],fill:arrowCols[i%arrowCols.length],
                strokeWidth:1,pointerLength:4,pointerWidth:3,
            }));
        }

        // 速度反馈线（底部弧线）
        this.group.add(new Konva.Line({
            points:[fx+fw-30,y0+14, fx+fw-30,y0+fh*0.38, fx+28,y0+fh*0.38, fx+28,y0+14],
            stroke:'#ffd54f',strokeWidth:1,dash:[4,3],opacity:0.7,
        }));
        this.group.add(new Konva.Text({x:fx+fw/2-20,y:y0+fh*0.38-10,text:'n 速度反馈',fontSize:7,fill:'#ffd54f',opacity:0.8}));

        // 电流反馈线（比速度反馈稍内侧）
        this.group.add(new Konva.Line({
            points:[fx+480,y0+14, fx+480,y0+fh*0.24, fx+168,y0+fh*0.24, fx+168,y0+14],
            stroke:'#a5d6a7',strokeWidth:1,dash:[3,3],opacity:0.6,
        }));
        this.group.add(new Konva.Text({x:fx+300,y:y0+fh*0.24-9,text:'id/iq 电流反馈',fontSize:7,fill:'#a5d6a7',opacity:0.7}));

        // θ_e 转子位置引入 Park 变换
        this.group.add(new Konva.Arrow({
            points:[fx+blocks[8].x+17,y0+14, fx+blocks[9].x+16,y0+14],
            stroke:'#ffd54f',fill:'#ffd54f',strokeWidth:1,pointerLength:3,pointerWidth:3,opacity:0.5,
        }));
        this.group.add(new Konva.Text({x:fx+blocks[9].x-16,y:y0+16,text:'θe↗',fontSize:7,fill:'#ffd54f',opacity:0.6}));

        // 动态显示标
        this._focIdLabel  = new Konva.Text({x:fx+blocks[2].x,y:fy+fh-16,width:32,text:'id*=0',fontSize:7,fill:'#4fc3f7',align:'center'});
        this._focIqLabel  = new Konva.Text({x:fx+blocks[2].x+40,y:fy+fh-16,width:40,text:'iq*=--',fontSize:7,fill:'#ef9a9a',align:'center'});
        this._focMod      = new Konva.Text({x:fx+blocks[6].x,y:fy+fh-16,width:36,text:'M=0%',fontSize:7,fill:'#80cbc4',align:'center'});
        this.group.add(this._focIdLabel, this._focIqLabel, this._focMod);
    }

    // ── d-q 电流平面（电流/电压极限 + MTPA） ──
    _drawDQPlane() {
        const { _dqX: dx, _dqY: dy, _dqW: dw, _dqH: dh } = this;

        this.group.add(new Konva.Rect({x:dx,y:dy,width:dw,height:dh,fill:'#010d18',stroke:'#1a3040',strokeWidth:1.5,cornerRadius:4}));
        this.group.add(new Konva.Rect({x:dx,y:dy,width:dw,height:13,fill:'#0a1a28',cornerRadius:[4,4,0,0]}));
        this.group.add(new Konva.Text({x:dx+4,y:dy+2,width:dw-8,text:'id-iq 电流平面（MTPA + 弱磁轨迹）',fontSize:8,fontStyle:'bold',fill:'#80cbc4',align:'center'}));

        const ocx = dx+dw*0.55, ocy = dy+dh*0.52;
        const scl = dw*0.38/this.maxCurrent;  // px/A

        // 坐标轴
        this.group.add(new Konva.Line({points:[dx+8,ocy,dx+dw-6,ocy],stroke:'#37474f',strokeWidth:0.8}));
        this.group.add(new Konva.Line({points:[ocx,dy+14,ocx,dy+dh-6],stroke:'#37474f',strokeWidth:0.8}));
        this.group.add(new Konva.Text({x:dx+dw-16,y:ocy+2,text:'id',fontSize:8,fill:'#ffd54f'}));
        this.group.add(new Konva.Text({x:ocx+3,y:dy+15,text:'iq',fontSize:8,fill:'#80cbc4'}));

        // 电流极限圆
        const iMaxPx = this.maxCurrent*scl;
        this.group.add(new Konva.Circle({x:ocx,y:ocy,radius:iMaxPx,fill:'rgba(102,187,106,0.06)',stroke:'#66bb6a',strokeWidth:1,dash:[4,3]}));
        this.group.add(new Konva.Text({x:ocx-iMaxPx-2,y:ocy-8,text:`Is_max`,fontSize:6.5,fill:'#66bb6a'}));

        // 电压极限椭圆（随转速变化，预绘基速下的椭圆）
        const Vmax   = this.ratedVoltage/Math.sqrt(3);
        const omegaN = this.baseSpeed*2*Math.PI/60*this.polePairs;
        const ellA   = Math.min(iMaxPx*1.8, (Vmax/omegaN/this.Lq)*scl);
        const ellB   = Math.min(iMaxPx*1.8, (Vmax/omegaN/this.Ld)*scl);
        const ctrX   = ocx - (this.psiF/this.Ld)*scl;
        this._voltEllipse = new Konva.Ellipse({x:ctrX,y:ocy,radiusX:ellA,radiusY:ellB,fill:'rgba(79,195,247,0.05)',stroke:'#4fc3f7',strokeWidth:1,dash:[3,3]});
        this.group.add(this._voltEllipse);
        this.group.add(new Konva.Text({x:ctrX-10,y:ocy-ellB-10,text:'Vs_lim',fontSize:6.5,fill:'#4fc3f7'}));

        // MTPA 轨迹（IPM）
        if (this.motorType==='IPM') {
            const mtpaPts=[];
            for (let is=0.1;is<=this.maxCurrent;is+=this.maxCurrent/40) {
                const {id,iq} = this._calcMTPA(is);
                const px=ocx+id*scl, py=ocy-iq*scl;
                if (px>=dx+6&&px<=dx+dw-6&&py>=dy+14&&py<=dy+dh-6) mtpaPts.push(px,py);
            }
            if (mtpaPts.length>4)
                this.group.add(new Konva.Line({points:mtpaPts,stroke:'#ffa726',strokeWidth:1.5,lineJoin:'round',opacity:0.75}));
            this.group.add(new Konva.Text({x:ocx-iMaxPx*0.5,y:ocy-iMaxPx*0.6,text:'MTPA',fontSize:7,fill:'#ffa726'}));
        }

        // id=0 线（SPM 最优线）
        this.group.add(new Konva.Line({points:[ocx,ocy,ocx,dy+14],stroke:'#ffd54f',strokeWidth:0.8,dash:[3,3],opacity:0.5}));
        this.group.add(new Konva.Text({x:ocx+3,y:dy+14,text:'id=0',fontSize:6.5,fill:'#ffd54f',opacity:0.7}));

        // 永磁体磁链点（-ψf/Ld 处）
        const psiX = ocx - (this.psiF/this.Ld)*scl;
        if (psiX>dx+6) {
            this.group.add(new Konva.Circle({x:psiX,y:ocy,radius:3.5,fill:'#ef9a9a',stroke:'#b71c1c',strokeWidth:0.8}));
            this.group.add(new Konva.Text({x:psiX-8,y:ocy+5,text:'-ψf/Ld',fontSize:6.5,fill:'#ef9a9a'}));
        }

        // 动态工作点
        this._dqPoint = new Konva.Circle({x:ocx,y:ocy-iMaxPx*0.5,radius:6,fill:'#ef5350',stroke:'#c62828',strokeWidth:1.5});
        // id/iq 投影线
        this._dqIdLine = new Konva.Line({points:[ocx,ocy,ocx,ocy],stroke:'#ffd54f',strokeWidth:1,dash:[2,2]});
        this._dqIqLine = new Konva.Line({points:[ocx,ocy,ocx,ocy],stroke:'#80cbc4',strokeWidth:1,dash:[2,2]});
        this.group.add(this._dqIdLine,this._dqIqLine,this._dqPoint);
        this._dqOCX=ocx; this._dqOCY=ocy; this._dqScl=scl;
    }

    // ── 相量图（d-q 旋转坐标系） ─────────────
    _drawPhasorDiagram() {
        const { _phX: px, _phY: py, _phW: pw, _phH: ph } = this;

        this.group.add(new Konva.Rect({x:px,y:py,width:pw,height:ph,fill:'#010d18',stroke:'#1a3040',strokeWidth:1.5,cornerRadius:4}));
        this.group.add(new Konva.Rect({x:px,y:py,width:pw,height:13,fill:'#0a1a28',cornerRadius:[4,4,0,0]}));
        this.group.add(new Konva.Text({x:px+4,y:py+2,width:pw-8,text:'相量图（d-q 旋转坐标系）',fontSize:8,fontStyle:'bold',fill:'#80cbc4',align:'center'}));

        const ocx = px+pw*0.50, ocy = py+ph*0.58;
        const R   = Math.min(pw,ph)*0.32;

        // 坐标轴
        this.group.add(new Konva.Line({points:[px+6,ocy,px+pw-6,ocy],stroke:'#1a3040',strokeWidth:0.7}));
        this.group.add(new Konva.Line({points:[ocx,py+14,ocx,py+ph-6],stroke:'#1a3040',strokeWidth:0.7}));
        this.group.add(new Konva.Text({x:px+pw-16,y:ocy+2,text:'d',fontSize:8,fill:'#ffd54f'}));
        this.group.add(new Konva.Text({x:ocx+3,y:py+14,text:'q',fontSize:8,fill:'#80cbc4'}));

        // 动态相量
        this._phaPsiF = new Konva.Arrow({points:[ocx,ocy,ocx+R*0.6,ocy],         stroke:'#ef9a9a',fill:'#ef9a9a',strokeWidth:2,  pointerLength:6,pointerWidth:5});
        this._phaId   = new Konva.Arrow({points:[ocx,ocy,ocx-R*0.1,ocy],          stroke:'#ffd54f',fill:'#ffd54f',strokeWidth:1.8,pointerLength:5,pointerWidth:4});
        this._phaIq   = new Konva.Arrow({points:[ocx,ocy,ocx,ocy-R*0.5],          stroke:'#80cbc4',fill:'#80cbc4',strokeWidth:1.8,pointerLength:5,pointerWidth:4});
        this._phaIs   = new Konva.Arrow({points:[ocx,ocy,ocx-R*0.1,ocy-R*0.5],    stroke:'#ffd54f',fill:'#ffd54f',strokeWidth:2.2,pointerLength:6,pointerWidth:5,dash:[4,2]});
        this._phaUd   = new Konva.Arrow({points:[ocx,ocy,ocx+R*0.05,ocy],         stroke:'#66bb6a',fill:'#66bb6a',strokeWidth:1.5,pointerLength:5,pointerWidth:4});
        this._phaUq   = new Konva.Arrow({points:[ocx,ocy,ocx,ocy-R*0.8],          stroke:'#4fc3f7',fill:'#4fc3f7',strokeWidth:1.5,pointerLength:5,pointerWidth:4});
        this._phaUs   = new Konva.Arrow({points:[ocx,ocy,ocx+R*0.05,ocy-R*0.8],   stroke:'#ffffff',fill:'#ffffff',strokeWidth:2,  pointerLength:6,pointerWidth:5,opacity:0.85});

        // 图例
        const lgX=px+6, lgY=py+15;
        [['#ef9a9a','ψ_f（永磁链）'],['#ffd54f','Is（定子电流）'],
         ['#80cbc4','iq（转矩分量）'],['#ffd54f','id（励磁分量）'],
         ['#ffffff','Us（定子电压）'],['#66bb6a','ud  '],['#4fc3f7','uq']].forEach(([col,lbl],i)=>{
            this.group.add(new Konva.Line({points:[lgX,lgY+i*9+3,lgX+10,lgY+i*9+3],stroke:col,strokeWidth:1.8}));
            this.group.add(new Konva.Text({x:lgX+12,y:lgY+i*9-1,text:lbl,fontSize:6.5,fill:col}));
        });

        this._phOCX=ocx; this._phOCY=ocy; this._phR=R;
        this.group.add(this._phaPsiF,this._phaId,this._phaIq,this._phaIs,this._phaUd,this._phaUq,this._phaUs);
    }

    // ── T-n 特性曲线（恒转矩区 + 弱磁恒功率区） ──
    _drawTNCurve() {
        const { _tnX: tx, _tnY: ty, _tnW: tw, _tnH: th } = this;

        this.group.add(new Konva.Rect({x:tx,y:ty,width:tw,height:th,fill:'#010d18',stroke:'#1a3040',strokeWidth:1.5,cornerRadius:4}));
        this.group.add(new Konva.Rect({x:tx,y:ty,width:tw,height:13,fill:'#0a1a28',cornerRadius:[4,4,0,0]}));
        this.group.add(new Konva.Text({x:tx+4,y:ty+2,width:tw-8,text:'T-n 特性（恒转矩+弱磁区）',fontSize:8,fontStyle:'bold',fill:'#80cbc4',align:'center'}));

        const ox=tx+16,oy=ty+th-12,aw=tw-22,ah=th-26;
        this.group.add(new Konva.Line({points:[ox,oy-ah,ox,oy,ox+aw,oy],stroke:'#37474f',strokeWidth:0.8}));
        this.group.add(new Konva.Text({x:ox-14,y:oy-ah,text:'T',fontSize:7,fill:'#80cbc4'}));
        this.group.add(new Konva.Text({x:ox+aw+2,y:oy+2,text:'n',fontSize:7,fill:'#80cbc4'}));

        // 基速线
        const nBaseX = ox+(this.baseSpeed/this.maxSpeed)*aw;
        this.group.add(new Konva.Line({points:[nBaseX,oy-ah,nBaseX,oy],stroke:'#ffa726',strokeWidth:0.8,dash:[4,3]}));
        this.group.add(new Konva.Text({x:nBaseX-3,y:oy+3,text:'nb',fontSize:6.5,fill:'#ffa726'}));

        // 恒转矩区（0 ~ nb，MTPA）
        const Trated = this.ratedTorque;
        const Tmax   = this.maxTorque;
        const ctPts=[ox,oy-(Tmax/Tmax)*(ah-4), nBaseX,oy-(Tmax/Tmax)*(ah-4)];
        const ctPts2=[ox,oy-(Trated/Tmax)*(ah-4), nBaseX,oy-(Trated/Tmax)*(ah-4)];
        this.group.add(new Konva.Line({points:ctPts, stroke:'#ef9a9a',strokeWidth:1.5,opacity:0.5}));
        this.group.add(new Konva.Line({points:ctPts2,stroke:'#66bb6a',strokeWidth:1.5,opacity:0.7}));
        this.group.add(new Konva.Rect({x:ox,y:oy-Trated/Tmax*(ah-4),width:nBaseX-ox,height:Trated/Tmax*(ah-4),fill:'rgba(102,187,106,0.08)'}));
        this.group.add(new Konva.Text({x:ox+4,y:oy-(Tmax/Tmax)*(ah-4)-10,text:'T_max（峰值）',fontSize:6.5,fill:'#ef9a9a'}));
        this.group.add(new Konva.Text({x:ox+4,y:oy-(Trated/Tmax)*(ah-4)-10,text:'T_rated',fontSize:6.5,fill:'#66bb6a'}));

        // 弱磁区（nb ~ nmax，恒功率 P=T×ω=const）
        const fwPts=[];
        for (let n=this.baseSpeed;n<=this.maxSpeed;n+=(this.maxSpeed-this.baseSpeed)/40) {
            const T=Tmax*(this.baseSpeed/n);  // 恒功率：T∝1/n
            const x=ox+(n/this.maxSpeed)*aw;
            const y=oy-(T/Tmax)*(ah-4);
            if (x<=ox+aw&&y>=ty+14) fwPts.push(x,y);
        }
        if (fwPts.length>4)
            this.group.add(new Konva.Line({points:fwPts,stroke:'#4fc3f7',strokeWidth:1.5,lineJoin:'round',opacity:0.75}));

        // 恒功率线（虚线参考）
        const pRatedPts=[];
        for (let n=this.baseSpeed;n<=this.maxSpeed;n+=50) {
            const T=(this.ratedPower)/(n*2*Math.PI/60);
            if (T>0&&T<Tmax) pRatedPts.push(ox+(n/this.maxSpeed)*aw, oy-(T/Tmax)*(ah-4));
        }
        if (pRatedPts.length>4)
            this.group.add(new Konva.Line({points:pRatedPts,stroke:'#80cbc4',strokeWidth:1,lineJoin:'round',opacity:0.4,dash:[3,3]}));

        // 区域标注
        this.group.add(new Konva.Text({x:ox+4,y:oy-ah+4,text:'↑ 恒转矩区（MTPA）',fontSize:6.5,fill:'#66bb6a'}));
        this.group.add(new Konva.Text({x:nBaseX+4,y:ty+16,text:'弱磁\n恒功率区',fontSize:6.5,fill:'#4fc3f7',lineHeight:1.3}));

        // 动态工作点
        this._tnPoint = new Konva.Circle({x:ox,y:oy,radius:5,fill:'#66bb6a',stroke:'#2e7d32',strokeWidth:1.5});
        this.group.add(this._tnPoint);
        this._tnOX=ox; this._tnOY=oy; this._tnAW=aw; this._tnAH=ah;
    }

    // ── 转矩分解图（永磁转矩 + 磁阻转矩 vs id） ──
    _drawTorqueDecomposition() {
        const { _tdX: tx, _tdY: ty, _tdW: tw, _tdH: th } = this;

        this.group.add(new Konva.Rect({x:tx,y:ty,width:tw,height:th,fill:'#010d18',stroke:'#1a3040',strokeWidth:1.5,cornerRadius:4}));
        this.group.add(new Konva.Rect({x:tx,y:ty,width:tw,height:13,fill:'#0a1a28',cornerRadius:[4,4,0,0]}));
        this.group.add(new Konva.Text({x:tx+4,y:ty+2,width:tw-8,text:'转矩分解（永磁+磁阻 vs id）',fontSize:8,fontStyle:'bold',fill:'#80cbc4',align:'center'}));

        const ox=tx+14,oy=ty+th-12,aw=tw-20,ah=th-26;
        this.group.add(new Konva.Line({points:[ox,oy-ah,ox,oy,ox+aw,oy],stroke:'#37474f',strokeWidth:0.8}));
        this.group.add(new Konva.Text({x:ox-12,y:oy-ah,text:'T',fontSize:7,fill:'#80cbc4'}));
        this.group.add(new Konva.Text({x:ox+aw+2,y:oy+2,text:'id',fontSize:7,fill:'#ffd54f'}));

        // id 范围：-Imax ~ 0
        const idMax = -this.maxCurrent;
        const iqOpt = this.ratedCurrent*0.8;
        const tPm_pts=[], tRel_pts=[], tTot_pts=[];
        for (let id=0;id>=idMax;id-=this.maxCurrent/40) {
            const x     = ox+(1-id/idMax)*aw;
            const Tpm   = 1.5*this.polePairs*this.psiF*iqOpt;
            const Trel  = 1.5*this.polePairs*(this.Ld-this.Lq)*id*iqOpt;
            const Ttot  = Tpm+Trel;
            const ypm   = oy-(Tpm/this.maxTorque)*(ah-4);
            const yrel  = oy-(Trel/this.maxTorque)*(ah-4);  // 磁阻转矩为负（IPM: Ld<Lq → 负）
            const ytot  = oy-(Ttot/this.maxTorque)*(ah-4);
            tPm_pts.push(x,ypm); tRel_pts.push(x,yrel); tTot_pts.push(x,ytot);
        }
        // 零转矩基准线
        this.group.add(new Konva.Line({points:[ox,oy,ox+aw,oy],stroke:'#37474f',strokeWidth:0.5}));

        this.group.add(new Konva.Line({points:tPm_pts, stroke:'#ef9a9a',strokeWidth:1.5,lineJoin:'round',opacity:0.75}));
        if (this.motorType==='IPM') {
            this.group.add(new Konva.Line({points:tRel_pts,stroke:'#4fc3f7',strokeWidth:1.5,lineJoin:'round',opacity:0.65,dash:[4,3]}));
            this.group.add(new Konva.Line({points:tTot_pts,stroke:'#66bb6a',strokeWidth:2,  lineJoin:'round',opacity:0.85}));
        }

        // 图例
        const lgX=tx+6, lgY=ty+14;
        [['#ef9a9a','T_永磁'],['#4fc3f7','T_磁阻（IPM）'],['#66bb6a','T_总（IPM）']].forEach(([col,lbl],i)=>{
            this.group.add(new Konva.Line({points:[lgX,lgY+i*9+3,lgX+10,lgY+i*9+3],stroke:col,strokeWidth:1.8}));
            this.group.add(new Konva.Text({x:lgX+12,y:lgY+i*9-1,text:lbl,fontSize:6.5,fill:col}));
        });

        // MTPA 最优 id 点（IPM）
        if (this.motorType==='IPM') {
            const {id:idMTPA} = this._calcMTPA(this.ratedCurrent);
            const xMTPA = ox+(1-idMTPA/idMax)*aw;
            this.group.add(new Konva.Line({points:[xMTPA,oy-ah,xMTPA,oy],stroke:'#ffa726',strokeWidth:0.9,dash:[3,3]}));
            this.group.add(new Konva.Text({x:xMTPA-4,y:oy+3,text:'MTPA',fontSize:6,fill:'#ffa726'}));
        }

        // 动态工作点
        this._tdPoint = new Konva.Circle({x:ox+aw,y:oy-ah*0.5,radius:5,fill:'#ffd54f',stroke:'#f9a825',strokeWidth:1.5});
        this.group.add(this._tdPoint);
        this._tdOX=ox; this._tdOY=oy; this._tdAW=aw; this._tdAH=ah;
        this._tdIdMax=idMax;
    }

    // ── LCD 仪表 ─────────────────────────────
    _drawLCDPanel() {
        const { _lcdX: lx, _lcdY: ly, _lcdW: lw, _lcdH: lh } = this;

        this.group.add(new Konva.Rect({x:lx,y:ly,width:lw,height:lh,fill:'#020c14',stroke:'#1a3040',strokeWidth:1.5,cornerRadius:4}));
        this.group.add(new Konva.Rect({x:lx,y:ly,width:lw,height:13,fill:'#0a1a28',cornerRadius:[4,4,0,0]}));
        this.group.add(new Konva.Text({x:lx+4,y:ly+2,width:lw-8,text:'运行仪表',fontSize:8,fontStyle:'bold',fill:'#80cbc4',align:'center'}));

        const cells=[
            {label:'转速',  id:'spd',  unit:'rpm', color:'#4fc3f7'},
            {label:'转矩',  id:'tq',   unit:'N·m', color:'#ffd54f'},
            {label:'效率',  id:'eff',  unit:'%',   color:'#66bb6a'},
            {label:'id',    id:'idd',  unit:'A',   color:'#ef9a9a'},
            {label:'iq',    id:'iqq',  unit:'A',   color:'#80cbc4'},
            {label:'Is',    id:'is',   unit:'A',   color:'#ffa726'},
            {label:'ud',    id:'udd',  unit:'V',   color:'#ffd54f'},
            {label:'uq',    id:'uqq',  unit:'V',   color:'#90caf9'},
            {label:'调制比M',id:'mod', unit:'%',   color:'#ce93d8'},
            {label:'T_磁阻', id:'trel',unit:'N·m', color:'#4fc3f7'},
            {label:'T_永磁', id:'tpm', unit:'N·m', color:'#ef9a9a'},
            {label:'弱磁状态',id:'fw', unit:'',    color:'#ff8a65'},
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
        this.group.add(new Konva.Text({x:px+4,y:py+2,width:pw-8,text:'FOC 参数控制',fontSize:8,fontStyle:'bold',fill:'#80cbc4',align:'center'}));

        // 起停按钮
        const bW=(pw-16)/4-2, bH=18, bY=py+16;
        [['▶ 起动','#1a3a1a','#2e7d32','#66bb6a',()=>this.start()],
         ['■ 停止','#3a1a1a','#c62828','#ef5350',()=>this.stop()],
        ].forEach(([lbl,fill,stroke,col,cb],i)=>{
            const bx=px+4+i*(bW+4);
            const btn=new Konva.Rect({x:bx,y:bY,width:bW,height:bH,fill,stroke,strokeWidth:1.5,cornerRadius:3});
            const t=new Konva.Text({x:bx,y:bY+4,width:bW,text:lbl,fontSize:9,fontStyle:'bold',fill:col,align:'center'});
            btn.on('click tap',cb);
            btn.on('mouseenter',()=>btn.opacity(0.75));
            btn.on('mouseleave',()=>btn.opacity(1));
            this.group.add(btn,t);
        });

        // MTPA / 弱磁 开关
        const toggleBtns=[
            {lbl:'MTPA: 开', key:'_mtpaEnable', x:px+4+2*(bW+4),  onCol:'#ffa726'},
            {lbl:'弱磁: 开', key:'_fwEnable',   x:px+4+3*(bW+4),  onCol:'#4fc3f7'},
        ];
        this._toggleBtns={};
        toggleBtns.forEach(({lbl,key,x,onCol})=>{
            const on  = this[key];
            const btn = new Konva.Rect({x,y:bY,width:bW,height:bH,fill:on?'#1a1a0a':'#0d1520',stroke:on?onCol:'#37474f',strokeWidth:1.5,cornerRadius:3});
            const t   = new Konva.Text({x,y:bY+4,width:bW,text:lbl,fontSize:9,fontStyle:'bold',fill:on?onCol:'#546e7a',align:'center'});
            btn.on('click tap',()=>{
                this[key]=!this[key];
                const nowOn=this[key];
                btn.fill(nowOn?'#1a1a0a':'#0d1520');
                btn.stroke(nowOn?onCol:'#37474f');
                t.fill(nowOn?onCol:'#546e7a');
                t.text(lbl.replace(/开|关/,nowOn?'开':'关'));
            });
            this._toggleBtns[key]={btn,t,onCol};
            this.group.add(btn,t);
        });

        // 滑块
        const sliders=[
            {label:`目标转速（基速 ${this.baseSpeed}rpm，最高 ${this.maxSpeed}rpm）`, key:'spd', color:'#4fc3f7',
             getR:()=>this._speedRef/this.maxSpeed, set:r=>{this._speedRef=r*this.maxSpeed;}, disp:()=>`${Math.round(this._speedRef)}rpm`},
            {label:`id 给定（MTPA关时有效，范围 -${this.maxCurrent.toFixed(0)}A~0A）`, key:'idr', color:'#ffd54f',
             getR:()=>1+(this._idRef/this.maxCurrent), set:r=>{this._idRef=(r-1)*this.maxCurrent;}, disp:()=>`${this._idRef.toFixed(2)}A`},
            {label:`负载转矩（额定 ${this.ratedTorque.toFixed(2)}N·m）`, key:'load', color:'#ffa726',
             getR:()=>this._loadTorque/this.maxTorque, set:r=>{this._loadTorque=r*this.maxTorque;}, disp:()=>`${this._loadTorque.toFixed(3)}N·m`},
        ];

        const slW=(pw-16)/2-32;
        this._sliderBars={};
        sliders.forEach(({label,key,color,getR,set,disp},si)=>{
            const col=si%2, row=Math.floor(si/2);
            const slX=px+4+col*(slW+50), slY=py+42+row*24;
            this.group.add(new Konva.Text({x:slX,y:slY-11,text:label,fontSize:7,fill:'#546e7a'}));
            this.group.add(new Konva.Rect({x:slX,y:slY,width:slW,height:8,fill:'#0a0a18',cornerRadius:2}));
            const bar=new Konva.Rect({x:slX,y:slY,width:0,height:8,fill:color,cornerRadius:2});
            const txt=new Konva.Text({x:slX+slW+4,y:slY-2,width:46,text:'--',fontSize:8,fontFamily:'Courier New, monospace',fill:color});
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

    // ── 波形区（三相正弦 + BEMF + id/iq + 转矩分解） ──
    _drawWaveform() {
        const { _wavX: wx, _wavY: wy, _wavW: ww, _wavH: wh } = this;
        if (wh<14) return;

        this.group.add(new Konva.Rect({x:wx,y:wy,width:ww,height:wh,fill:'#010d18',stroke:'#1a3040',strokeWidth:1.5,cornerRadius:4}));
        this.group.add(new Konva.Rect({x:wx,y:wy,width:ww,height:12,fill:'#0a1a28',cornerRadius:[4,4,0,0]}));
        this.group.add(new Konva.Text({x:wx+4,y:wy+1,width:ww-8,text:'三相电流（正弦）   BEMF（正弦，区别于BLDC梯形波）   dq电流 id/iq   转矩分解 Tpm/Trel',fontSize:8,fill:'#80cbc4',align:'center'}));

        const nCh=4, hCh=(wh-12)/nCh;
        this._wavMids=Array.from({length:nCh},(_,i)=>wy+12+hCh*(i+0.5));
        this._wavMids.forEach(my=>this.group.add(new Konva.Line({points:[wx+2,my,wx+ww-2,my],stroke:'rgba(200,200,200,0.06)',strokeWidth:0.5,dash:[4,3]})));

        this._wLIa  =new Konva.Line({points:[],stroke:'#e53935',strokeWidth:1.5,lineJoin:'round'});
        this._wLIb  =new Konva.Line({points:[],stroke:'#43a047',strokeWidth:1.5,lineJoin:'round'});
        this._wLIc  =new Konva.Line({points:[],stroke:'#1e88e5',strokeWidth:1.5,lineJoin:'round'});
        this._wLEa  =new Konva.Line({points:[],stroke:'#ef9a9a',strokeWidth:1.5,lineJoin:'round'});
        this._wLId  =new Konva.Line({points:[],stroke:'#ffd54f',strokeWidth:1.8,lineJoin:'round'});
        this._wLIq  =new Konva.Line({points:[],stroke:'#80cbc4',strokeWidth:1.8,lineJoin:'round'});
        this._wLTpm =new Konva.Line({points:[],stroke:'#ef9a9a',strokeWidth:1.5,lineJoin:'round'});
        this._wLTrel=new Konva.Line({points:[],stroke:'#4fc3f7',strokeWidth:1.5,lineJoin:'round',dash:[4,3]});
        this._wLT   =new Konva.Line({points:[],stroke:'#66bb6a',strokeWidth:2,  lineJoin:'round'});

        ['ia/ib/ic','BEMF','id/iq','T分解'].forEach((l,i)=>{
            this.group.add(new Konva.Text({x:wx+4,y:wy+12+hCh*i+3,text:l,fontSize:8,fill:['#e53935','#ef9a9a','#ffd54f','#66bb6a'][i]}));
        });
        this.group.add(this._wLIa,this._wLIb,this._wLIc,this._wLEa,this._wLId,this._wLIq,this._wLTpm,this._wLTrel,this._wLT);
        this._wavHCh=hCh;
    }

    // ═══════════════════════════════════════════
    // 集中化 tick（由 consys._tickAll 在 20fps 调用）
    tick(dt) {
        this._tickFOCPhysics(dt);
        this._tickRotorViz();
        this._tickFluxViz();
        this._tickPhasor();
        this._tickDQPoint();
        this._tickTNPoint();
        this._tickTDPoint();
        this._tickWaveform();
        this._tickDisplay();
        this._refreshCache();
    }
    // ── FOC 物理仿真核心 ─────────────────────
    _tickFOCPhysics(dt) {
        const omegaE = this._omegaR * this.polePairs;

        if (!this._running) {
            // 惯性减速
            const drag = this.B*this._omegaR + (this._omegaR>0?0.005*this.ratedTorque:0);
            this._omegaR = Math.max(0, this._omegaR - drag/this.J*dt);
            this._speed  = this._omegaR*60/(2*Math.PI);
            this._thetaE += omegaE*dt;
            this._thetaM += this._omegaR*dt;
            this.torqueEM=this.torquePM=this.torqueRel=0;
            this._id=this._iq=0;
            this._ia=this._ib=this._ic=0;
            this._ea=this._eb=this._ec=0;
            this.powerIn=this.powerOut=this.efficiency=0;
            this._updateWavBufs();
            return;
        }

        // ── 速度外环 PI ──
        const spdErr   = this._speedRef - this._speed;
        this._intSpd  += spdErr * this.kiSpd * dt;
        this._intSpd   = Math.max(-this.maxTorque, Math.min(this.maxTorque, this._intSpd));
        const tqRef    = Math.max(-this.maxTorque, Math.min(this.maxTorque, this.kpSpd*spdErr + this._intSpd));

        // ── iq 给定（由转矩给定计算） ──
        const iqRefRaw = tqRef / (1.5*this.polePairs*this.psiF + 1e-9);

        // ── MTPA 计算 id 给定 ──
        let idRefCalc = 0;
        if (this._mtpaEnable && this.motorType==='IPM') {
            const isMTPA = Math.sqrt(Math.max(0, iqRefRaw**2+this._id**2));
            const {id} = this._calcMTPA(Math.min(this.maxCurrent, isMTPA));
            idRefCalc = id;
        } else {
            idRefCalc = this._idRef;  // 手动设定
        }

        // ── 弱磁 ──
        let idRefFW = idRefCalc;
        if (this._fwEnable && this._omegaR > this.baseSpeed*2*Math.PI/60*0.95) {
            const Vmax  = this.ratedVoltage/Math.sqrt(3);
            const excess= (this._omegaR*this.polePairs*this.psiF - Vmax) / (this._omegaR*this.polePairs*this.Ld+1e-9);
            idRefFW = Math.min(0, idRefCalc - excess*0.5);
            idRefFW = Math.max(-this.maxCurrent, idRefFW);
        }
        this._idRef_actual = idRefFW;

        // ── 实际 iq 限幅（电流圆约束）──
        const iqMax   = Math.sqrt(Math.max(0, this.maxCurrent**2 - idRefFW**2));
        const iqRefClamped = Math.max(-iqMax, Math.min(iqMax, iqRefRaw));

        // ── dq 电流内环 PI ──
        const idErr  = idRefFW - this._id;
        const iqErr  = iqRefClamped - this._iq;
        this._intId += idErr * this.kiId * dt;
        this._intIq += iqErr * this.kiIq * dt;
        const Vmax   = this.ratedVoltage / Math.sqrt(3);
        this._intId  = Math.max(-Vmax, Math.min(Vmax, this._intId));
        this._intIq  = Math.max(-Vmax, Math.min(Vmax, this._intIq));

        // 前馈解耦项
        const decoupD = -omegaE * this.Lq * this._iq;
        const decoupQ =  omegaE * (this.Ld * this._id + this.psiF);

        const udCmd  = this.kpId*idErr + this._intId + decoupD;
        const uqCmd  = this.kpIq*iqErr + this._intIq + decoupQ;

        // 电压限幅（圆形限幅）
        const usMag  = Math.sqrt(udCmd**2 + uqCmd**2);
        const scale  = (usMag > Vmax) ? Vmax/usMag : 1;
        this._ud     = udCmd * scale;
        this._uq     = uqCmd * scale;
        this._modRatio = Math.sqrt(this._ud**2 + this._uq**2) / Vmax;

        // ── dq 电流动态（RL 一阶） ──
        const tauD = this.Ld / (this.Rs + 1e-9);
        const tauQ = this.Lq / (this.Rs + 1e-9);
        const idSS = (this._ud + omegaE*this.Lq*this._iq) / (this.Rs + 1e-9);
        const iqSS = (this._uq - omegaE*(this.Ld*this._id+this.psiF)) / (this.Rs + 1e-9);
        this._id  += (idSS - this._id)*(1-Math.exp(-dt/tauD));
        this._iq  += (iqSS - this._iq)*(1-Math.exp(-dt/tauQ));

        // 限幅
        const isNow = Math.sqrt(this._id**2 + this._iq**2);
        if (isNow > this.maxCurrent*1.05) {
            this._id *= this.maxCurrent/isNow;
            this._iq *= this.maxCurrent/isNow;
        }

        // ── 电磁转矩分解 ──
        this.torquePM  = 1.5*this.polePairs*this.psiF*this._iq;
        this.torqueRel = 1.5*this.polePairs*(this.Ld-this.Lq)*this._id*this._iq;
        this.torqueEM  = this.torquePM + this.torqueRel;

        // ── 机械方程 ──
        const netTq = this.torqueEM - this._loadTorque - this.B*this._omegaR;
        this._omegaR = Math.max(0, this._omegaR + netTq/this.J*dt);
        this._omegaR = Math.min(this.maxSpeed*2*Math.PI/60, this._omegaR);
        this._speed  = this._omegaR*60/(2*Math.PI);

        // 角度更新
        this._thetaE += this._omegaR*this.polePairs*dt;
        this._thetaM += this._omegaR*dt;
        this._phasorAngle += dt*1.5;

        // ── 逆 Park 变换（dq → αβ）──
        const cosT = Math.cos(this._thetaE), sinT = Math.sin(this._thetaE);
        const iAlpha = cosT*this._id - sinT*this._iq;
        const iBeta  = sinT*this._id + cosT*this._iq;
        const uAlpha = cosT*this._ud - sinT*this._uq;
        const uBeta  = sinT*this._ud + cosT*this._uq;

        // 逆 Clarke 变换（αβ → abc）
        this._ia = iAlpha;
        this._ib = (-iAlpha + Math.sqrt(3)*iBeta)/2;
        this._ic = (-iAlpha - Math.sqrt(3)*iBeta)/2;
        this._ua = uAlpha;
        this._ub = (-uAlpha + Math.sqrt(3)*uBeta)/2;
        this._uc = (-uAlpha - Math.sqrt(3)*uBeta)/2;

        // 正弦 BEMF（PMSM 区别于 BLDC 梯形波）
        const omR  = this._omegaR*this.polePairs;
        this._ea   = this.Ke*omR*Math.sin(this._thetaE);
        this._eb   = this.Ke*omR*Math.sin(this._thetaE - 2*Math.PI/3);
        this._ec   = this.Ke*omR*Math.sin(this._thetaE + 2*Math.PI/3);

        // 磁链
        this.psiD   = this.Ld*this._id + this.psiF;
        this.psiQ   = this.Lq*this._iq;

        // 功率/效率
        const pCu    = 1.5*this.Rs*(this._id**2+this._iq**2);
        this.powerOut= this.torqueEM*this._omegaR;
        this.powerIn = this.powerOut + pCu + 0.001*this.ratedPower;
        this.efficiency = this.powerIn>0.1 ? Math.min(98, this.powerOut/this.powerIn*100) : 0;
        this.cosPhi  = this.powerIn>0.1 ? this.powerOut/this.powerIn : 0;

        this._updateWavBufs();
    }

    // MTPA 计算（IPM）
    _calcMTPA(is) {
        if (this.motorType==='SPM' || Math.abs(this.Ld-this.Lq)<1e-6)
            return {id:0, iq:is};
        const dLdq = this.Lq - this.Ld;
        const disc = this.psiF**2 + 8*dLdq**2*is**2;
        const id   = (this.psiF - Math.sqrt(disc)) / (4*dLdq);
        const iq   = Math.sqrt(Math.max(0, is**2 - id**2));
        return {id:Math.max(-is,id), iq};
    }

    _updateWavBufs() {
        this._wavIa  = new Float32Array([...this._wavIa.slice(1), this._ia]);
        this._wavIb  = new Float32Array([...this._wavIb.slice(1), this._ib]);
        this._wavIc  = new Float32Array([...this._wavIc.slice(1), this._ic]);
        this._wavEa  = new Float32Array([...this._wavEa.slice(1), this._ea]);
        this._wavId  = new Float32Array([...this._wavId.slice(1), this._id]);
        this._wavIq  = new Float32Array([...this._wavIq.slice(1), this._iq]);
        this._wavT   = new Float32Array([...this._wavT.slice(1),  this.torqueEM]);
        this._wavTpm = new Float32Array([...this._wavTpm.slice(1),this.torquePM]);
        this._wavTrel= new Float32Array([...this._wavTrel.slice(1),this.torqueRel]);
    }

    // ── 转子旋转 ──────────────────────────────
    _tickRotorViz() {
        this._rotorGroup?.rotation(this._thetaM*180/Math.PI);
    }

    // ── 气隙磁通粒子（正弦分布）────────────
    _tickFluxViz() {
        this._fluxGroup.destroyChildren();
        const B = Math.sqrt(this._id**2+this._iq**2)/this.maxCurrent;
        if (B<0.02) return;
        const ecx=this._motCX, ecy=this._motCY;
        const Rmid=(this._airGapR+this._rotorR)/2;
        const nP=14;
        for (let i=0;i<nP;i++) {
            const t=((this._thetaM/(Math.PI*2)+i/nP)%1+1)%1;
            const a=t*Math.PI*2;
            // 正弦磁通密度分布（PMSM 正弦特征）
            const Bcos=Math.abs(Math.cos(t*Math.PI*2*this.polePairs));
            const alpha=Math.min(0.65,B*Bcos*0.65);
            if (alpha<0.02) continue;
            const col=Bcos>0.5?`rgba(255,213,79,${alpha})`:`rgba(144,202,249,${alpha*0.6})`;
            this._fluxGroup.add(new Konva.Circle({
                x:ecx+Rmid*Math.cos(a), y:ecy+Rmid*Math.sin(a),
                radius:2+B*3, fill:col,
            }));
        }
        // 绕组发光（随 is 强度）
        const Is=Math.sqrt(this._id**2+this._iq**2)/this.maxCurrent;
        if (this._sOuter) {
            const gAlpha=Math.min(0.3, Is*0.3);
            this._fluxGroup.add(new Konva.Ring({
                x:this._motCX, y:this._motCY,
                innerRadius:this._sInner, outerRadius:this._sOuter,
                fill:`rgba(79,195,247,${gAlpha})`,
            }));
        }
    }

    // ── 相量图更新（d-q 坐标系） ─────────────
    _tickPhasor() {
        if (!this._phaPsiF) return;
        const R=this._phR, ocx=this._phOCX, ocy=this._phOCY;
        const th=this._phasorAngle;

        // d 轴方向（参考方向随相量慢速旋转演示）
        const dCos=Math.cos(th), dSin=Math.sin(th);
        const qCos=Math.cos(th+Math.PI/2), qSin=Math.sin(th+Math.PI/2);

        const scl=R/(this.maxCurrent+1e-9)*0.8;
        const uscl=R/(this.ratedVoltage/Math.sqrt(3)+1e-9)*0.7;

        // ψ_f（d 轴方向）
        const pfM=R*0.55;
        this._phaPsiF.points([ocx,ocy, ocx+pfM*dCos,ocy-pfM*dSin]);

        // id（d 轴，负值时反向）
        const idM=this._id*scl;
        this._phaId.points([ocx,ocy, ocx+idM*dCos,ocy-idM*dSin]);

        // iq（q 轴）
        const iqM=this._iq*scl;
        this._phaIq.points([ocx,ocy, ocx+iqM*qCos,ocy-iqM*qSin]);

        // Is（合成电流矢量）
        const isX=ocx+idM*dCos+iqM*qCos, isY=ocy-idM*dSin-iqM*qSin;
        this._phaIs.points([ocx,ocy, isX,isY]);

        // ud/uq/Us
        const udM=this._ud*uscl, uqM=this._uq*uscl;
        this._phaUd.points([ocx,ocy, ocx+udM*dCos,ocy-udM*dSin]);
        this._phaUq.points([ocx,ocy, ocx+uqM*qCos,ocy-uqM*qSin]);
        const usX=ocx+udM*dCos+uqM*qCos, usY=ocy-udM*dSin-uqM*qSin;
        this._phaUs.points([ocx,ocy, usX,usY]);
    }

    // ── d-q 平面工作点 ────────────────────────
    _tickDQPoint() {
        if (!this._dqPoint) return;
        const px=this._dqOCX+this._id*this._dqScl;
        const py=this._dqOCY-this._iq*this._dqScl;
        this._dqPoint.x(px); this._dqPoint.y(py);
        this._dqIdLine.points([this._dqOCX,py,px,py]);
        this._dqIqLine.points([px,this._dqOCY,px,py]);
        // 颜色：MTPA 区域内=绿，超出电流圆=红
        const isNow=Math.sqrt(this._id**2+this._iq**2);
        this._dqPoint.fill(isNow>this.maxCurrent*1.05?'#ef5350':this._fwEnable&&this._id<-0.1?'#4fc3f7':'#66bb6a');
    }

    // ── T-n 工作点 ───────────────────────────
    _tickTNPoint() {
        if (!this._tnPoint) return;
        const nx=this._tnOX+(this._speed/this.maxSpeed)*this._tnAW;
        const ty=this._tnOY-(Math.abs(this.torqueEM)/this.maxTorque)*(this._tnAH-4);
        this._tnPoint.x(Math.max(this._tnOX,Math.min(this._tnOX+this._tnAW,nx)));
        this._tnPoint.y(Math.max(this._tnY+14,Math.min(this._tnOY,ty)));
        const inFW=this._speed>this.baseSpeed*1.02;
        this._tnPoint.fill(inFW?'#4fc3f7':this.efficiency>85?'#66bb6a':'#ffa726');
    }

    // ── 转矩分解工作点 ────────────────────────
    _tickTDPoint() {
        if (!this._tdPoint) return;
        const xNow=this._tdOX+(1-this._id/this._tdIdMax)*this._tdAW;
        const yNow=this._tdOY-(this.torqueEM/this.maxTorque)*(this._tdAH-4);
        this._tdPoint.x(Math.max(this._tdOX,Math.min(this._tdOX+this._tdAW,xNow)));
        this._tdPoint.y(Math.max(this._tdY+14,Math.min(this._tdOY,yNow)));
    }

    // ── 波形更新 ─────────────────────────────
    _tickWaveform() {
        if (!this._wavHCh||!this._wavMids) return;
        const wx=this._wavX+3, ww=this._wavW-6, n=this._wavLen;
        const dx=ww/n, hCh=this._wavHCh;
        const [mI,mE,mDQ,mT]=this._wavMids;

        const iPk =Math.max(0.01, this.maxCurrent);
        const ePk =Math.max(0.1,  this.Ke*this.maxSpeed*2*Math.PI/60*this.polePairs*Math.sqrt(2));
        const tPk =Math.max(0.01, this.maxTorque);

        const ptIa=[],ptIb=[],ptIc=[],ptEa=[],ptId=[],ptIq=[],ptTpm=[],ptTrel=[],ptT=[];
        for (let i=0;i<n;i++) {
            const x=wx+i*dx;
            ptIa.push(x,  mI  - (this._wavIa[i] /iPk)*hCh*0.38);
            ptIb.push(x,  mI  - (this._wavIb[i] /iPk)*hCh*0.38);
            ptIc.push(x,  mI  - (this._wavIc[i] /iPk)*hCh*0.38);
            ptEa.push(x,  mE  - (this._wavEa[i] /ePk)*hCh*0.38);
            ptId.push(x,  mDQ - (this._wavId[i] /iPk)*hCh*0.36);
            ptIq.push(x,  mDQ - (this._wavIq[i] /iPk)*hCh*0.36);
            ptTpm.push(x, mT  - (this._wavTpm[i]/tPk)*hCh*0.36);
            ptTrel.push(x,mT  - (this._wavTrel[i]/tPk)*hCh*0.36);
            ptT.push(x,   mT  - (this._wavT[i]  /tPk)*hCh*0.36);
        }
        this._wLIa.points(ptIa); this._wLIb.points(ptIb); this._wLIc.points(ptIc);
        this._wLEa.points(ptEa);
        this._wLId.points(ptId); this._wLIq.points(ptIq);
        this._wLTpm.points(ptTpm); this._wLTrel.points(ptTrel); this._wLT.points(ptT);
    }

    // ── 仪表显示 ─────────────────────────────
    _tickDisplay() {
        const c=this._lcdCells;
        if (!c) return;

        const inFW=this._speed>this.baseSpeed*1.02 && this._fwEnable;
        const Is=Math.sqrt(this._id**2+this._iq**2);

        if (c.spd)  c.spd.text(Math.round(this._speed).toString());
        if (c.tq) { c.tq.text(this.torqueEM.toFixed(3));
                    c.tq.fill(Math.abs(this.torqueEM)>this.ratedTorque*1.1?'#ef5350':'#ffd54f'); }
        if (c.eff) { c.eff.text(this.efficiency.toFixed(1));
                     c.eff.fill(this.efficiency>90?'#66bb6a':this.efficiency>70?'#ffa726':'#ef5350'); }
        if (c.idd)  c.idd.text(this._id.toFixed(3));
        if (c.iqq)  c.iqq.text(this._iq.toFixed(3));
        if (c.is)   c.is.text(Is.toFixed(3));
        if (c.udd)  c.udd.text(this._ud.toFixed(1));
        if (c.uqq)  c.uqq.text(this._uq.toFixed(1));
        if (c.mod) { c.mod.text((this._modRatio*100).toFixed(1));
                     c.mod.fill(this._modRatio>0.95?'#ef5350':this._modRatio>0.8?'#ffa726':'#ce93d8'); }
        if (c.trel) c.trel.text(this.torqueRel.toFixed(4));
        if (c.tpm)  c.tpm.text(this.torquePM.toFixed(3));
        if (c.fw) { c.fw.text(inFW?'弱磁运行中':'正常励磁');
                    c.fw.fill(inFW?'#4fc3f7':'#66bb6a'); }

        // FOC 框图动态标注
        if (this._focIdLabel) this._focIdLabel.text(`id*=${this._idRef_actual?.toFixed(2)||0}`);
        if (this._focIqLabel) this._focIqLabel.text(`iq*=${this._iq.toFixed(2)}`);
        if (this._focMod)     this._focMod.text(`M=${(this._modRatio*100).toFixed(0)}%`);

        if (this._sliderBars) {
            Object.values(this._sliderBars).forEach(({bar,txt,slW,getR,disp})=>{
                bar.width(Math.min(slW,Math.max(0,getR())*slW));
                txt.text(disp());
            });
        }
    }

    // ═══════════════════════════════════════════
    start() {
        if (!this._running) { this._running=true; this._intSpd=this._omegaR*this.B; }
    }
    stop()  { this._running=false; }

    setSpeed(rpm) {
        this._speedRef=Math.max(0,Math.min(this.maxSpeed,rpm));
        this._refreshCache();
    }
    setIdRef(id) {
        this._idRef=Math.max(-this.maxCurrent,Math.min(0,id));
        this._refreshCache();
    }
    setLoad(T) {
        this._loadTorque=Math.max(0,Math.min(this.maxTorque*1.2,T));
        this._refreshCache();
    }
    enableMTPA(on)       { this._mtpaEnable=!!on; this._refreshCache(); }
    enableFieldWeakening(on){ this._fwEnable=!!on; this._refreshCache(); }

    getSpeed()     { return this._speed; }
    getTorque()    { return this.torqueEM; }
    getId()        { return this._id; }
    getIq()        { return this._iq; }
    getEfficiency(){ return this.efficiency; }
    isFieldWeakening(){ return this._speed>this.baseSpeed*1.02&&this._fwEnable; }

    update(cfg={}) {
        if (cfg.speed!==undefined) this.setSpeed(cfg.speed);
        if (cfg.id   !==undefined) this.setIdRef(cfg.id);
        if (cfg.load !==undefined) this.setLoad(cfg.load);
        this._refreshCache();
    }

    getConfigFields() {
        return [
            {label:'位号/名称',            key:'id',           type:'text'},
            {label:'额定功率 (W)',          key:'ratedPower',   type:'number'},
            {label:'直流母线电压 (V)',      key:'ratedVoltage', type:'number'},
            {label:'额定转速/基速 (rpm)',   key:'ratedSpeed',   type:'number'},
            {label:'最高转速 (rpm)',        key:'maxSpeed',     type:'number'},
            {label:'额定电流 (A)',          key:'ratedCurrent', type:'number'},
            {label:'极对数',               key:'polePairs',    type:'number'},
            {label:'电机类型（SPM/IPM）',   key:'motorType',    type:'text'},
            {label:'定子电阻 Rs (Ω)',       key:'Rs',           type:'number'},
            {label:'d轴电感 Ld (mH)',       key:'Ld',           type:'number'},
            {label:'q轴电感 Lq (mH)',       key:'Lq',           type:'number'},
            {label:'永磁体磁链 ψ_f (Wb)',   key:'psiF',         type:'number'},
            {label:'转动惯量 J (kg·m²)',   key:'J',            type:'number'},
            {label:'最大转矩 (N·m)',        key:'maxTorque',    type:'number'},
        ];
    }

    onConfigUpdate(cfg) {
        this.id           = cfg.id           || this.id;
        this.ratedPower   = parseFloat(cfg.ratedPower)   || this.ratedPower;
        this.ratedVoltage = parseFloat(cfg.ratedVoltage) || this.ratedVoltage;
        this.ratedSpeed   = parseFloat(cfg.ratedSpeed)   || this.ratedSpeed;
        this.maxSpeed     = parseFloat(cfg.maxSpeed)     || this.maxSpeed;
        this.ratedCurrent = parseFloat(cfg.ratedCurrent) || this.ratedCurrent;
        this.polePairs    = parseInt(cfg.polePairs)       || this.polePairs;
        this.motorType    = cfg.motorType    || this.motorType;
        this.Rs           = parseFloat(cfg.Rs)           || this.Rs;
        this.Ld           = (parseFloat(cfg.Ld)||this.Ld*1000)*1e-3;
        this.Lq           = (parseFloat(cfg.Lq)||this.Lq*1000)*1e-3;
        this.psiF         = parseFloat(cfg.psiF)         || this.psiF;
        this.J            = parseFloat(cfg.J)            || this.J;
        this.maxTorque    = parseFloat(cfg.maxTorque)    || this.maxTorque;
        this.Ke           = this.psiF*this.polePairs*Math.sqrt(1.5);
        this.saliencyRatio= this.Lq/this.Ld;
        this.baseSpeed    = this.ratedSpeed;
        this.ratedTorque  = this.ratedPower/(this.ratedSpeed*2*Math.PI/60);
        this.config       = {...this.config,...cfg};
        this._refreshCache();
    }

    destroy() {
        super.destroy?.();
    }
}