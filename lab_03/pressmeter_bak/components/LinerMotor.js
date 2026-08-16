import { BaseComponent } from './BaseComponent.js';

/**
 * 直线电机仿真组件
 * （Linear Motor / Linear Induction Motor，LIM / PMLM）
 *
 * ── 与旋转电机的关系（展开变换）────────────────────────────
 *
 *  直线电机可理解为将旋转电机"展开"成直线形式：
 *
 *  ┌──────────────┬──────────────────────────┬────────────────────────────┐
 *  │  旋转电机    │  旋转量                  │  直线电机对应量            │
 *  ├──────────────┼──────────────────────────┼────────────────────────────┤
 *  │ 定子         │ 圆形定子铁芯 + 绕组      │ 初级（Primary）：直线铁芯  │
 *  │ 转子         │ 旋转转子                 │ 次级（Secondary）：导轨    │
 *  │ 旋转角速度 ω │ rad/s                    │ 直线速度 v（m/s）          │
 *  │ 转矩 T       │ N·m                      │ 推力 F（N）                │
 *  │ 极距 τ       │ πD/2p（弧长）            │ τ（直线极距，m）           │
 *  │ 同步转速 n_s │ 60f/p（rpm）             │ 同步速度 v_s = 2τf（m/s） │
 *  │ 转差率 s     │ (n_s-n)/n_s              │ s = (v_s-v)/v_s            │
 *  └──────────────┴──────────────────────────┴────────────────────────────┘
 *
 * ── 直线电机类型 ──────────────────────────────────────────────
 *
 *  按初级类型：
 *    短初级（Short Primary）：初级短，在次级上移动——工厂输送线
 *    长初级（Long Primary）：初级长，次级短——磁悬浮列车
 *
 *  按励磁方式（本仿真同时支持两种）：
 *    ① 直线感应电机（LIM，Linear Induction Motor）：
 *       次级为铝/铜板（导体），感应电流产生推力
 *       原理同异步电机：行波磁场在次级感应电流，产生安培力
 *       F = 3×I₂'²×R₂'/s / v_s
 *
 *    ② 永磁直线同步电机（PMLM / PMLSM）：
 *       次级为永磁体阵列，初级通三相交流驱动
 *       原理同 PMSM：行波磁场与次级永磁体相互作用产生推力
 *       F = (3π/2τ) × ψ_f × i_q（FOC 控制）
 *       端部效应（End Effect）：初级两端磁场不对称，产生附加阻力
 *
 * ── 直线感应电机（LIM）工作原理 ──────────────────────────────
 *
 *  1. 行波磁场（Traveling Magnetic Field）：
 *     三相交流绕组产生沿初级方向传播的行波磁场：
 *       B(x,t) = B_m × cos(πx/τ - ωt)
 *     行波速度（同步速度）：v_s = 2τf（m/s）
 *
 *  2. 次级感应：
 *     次级导体切割行波磁场，感应电动势：
 *       e₂ = B_m × l_eff × (v_s - v) = B_m × l_eff × s×v_s
 *     产生次级电流 i₂，与磁场相互作用产生推力。
 *
 *  3. 推力方程（等效电路分析）：
 *     F = 3I₂'² × R₂'/(s) × (1/v_s)
 *     最大推力（临界转差率 s_m）：
 *       s_m = R₂' / √(R₁² + (X₁+X₂')²)
 *       F_max = 3U₁² / [2v_s × (R₁ + √(R₁²+(X₁+X₂')²))]
 *
 *  4. 端部效应（LIM 特有）：
 *     初级有限长度导致行波磁场在入口端突然建立、出口端消失
 *     产生制动力（负推力分量）：F_end ≈ K_e × v × f(L_p)
 *     高速时端部效应系数 K_e 增大，推力特性变差
 *
 * ── 永磁直线同步电机（PMLM）工作原理 ────────────────────────
 *
 *  1. 次级永磁体阵列（N-S 交替排列，极距 τ）：
 *     在初级绕组中感应正弦反电动势：
 *       e = K_e × v × sin(πx/τ)
 *
 *  2. FOC 控制（与旋转 PMSM 类似，坐标轴为 x 代替 θ）：
 *     d-q 变换基于次级位置 x（或位移 xτ = x×π/τ）
 *     推力：F = (3π/2τ) × [ψ_f×i_q + (L_d-L_q)×i_d×i_q]
 *     法向力（吸引力）：F_n = ψ_f²/(2μ₀×A_gap) ≈ 常数（悬浮时需平衡）
 *
 *  3. 法向力与悬浮：
 *     永磁直线电机产生强烈法向吸引力 >> 推力（约 5~10 倍）
 *     需要导轨结构平衡法向力（C 形或 U 形磁路）
 *
 * ── 组件结构 ──────────────────────────────────────────────────
 *  ① 直线电机纵剖面图（初级铁芯+绕组 / 次级导板或永磁阵列，动态滑动）
 *  ② 行波磁场动画（三相行波在初级气隙中传播，彩色磁力线粒子流）
 *  ③ 推力-速度特性曲线（F-v，LIM/PMLM，含端部效应，工作点）
 *  ④ 推力-转差率特性（F-s，LIM：类异步机 T-s 曲线）
 *  ⑤ 位移-时间与速度-时间动态响应曲线（x-t，v-t，含加速/匀速/减速）
 *  ⑥ 三相电流与推力波形（i_U/i_V/i_W，F_em，LIM 方波 / PMLM 正弦）
 *  ⑦ d-q 电流平面（PMLM 模式：MTPA 轨迹 + 工作点）
 *  ⑧ LCD 仪表（位移/速度/推力/效率/转差率/相电流/行程/端部效应系数）
 *  ⑨ 控制面板（电机类型/目标速度/负载力/PWM占空比/起停/LIM/PMLM切换）
 *
 * ── 端口 ─────────────────────────────────────────────────────
 *  phase_u   — U 相输入
 *  phase_v   — V 相输入
 *  phase_w   — W 相输入
 *  dc_pos    — 直流母线正极（逆变器供电）
 *  dc_neg    — 直流母线负极
 *  pos_fb    — 位移传感器反馈
 *  thrust_out— 推力输出端（机械连接）
 */
export class LinearMotor extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.width  = Math.max(580, config.width  || 720);
        this.height = Math.max(440, config.height || 560);

        this.type    = 'linear_motor';
        this.special = 'none';
        this.cache   = 'fixed';

        // ── 电机类型 ──
        this.motorType   = config.motorType   || 'LIM';  // 'LIM' | 'PMLM'

        // ── 公共额定参数 ──
        this.ratedVoltage = config.ratedVoltage || 380;   // V（线电压）
        this.ratedFreq    = config.ratedFreq    || 50;    // Hz
        this.ratedCurrent = config.ratedCurrent || 12;    // A（相电流）
        this.polePairs    = config.polePairs    || 3;     // 极对数
        this.polePitch    = config.polePitch    || 0.12;  // m（极距 τ）

        // 同步速度
        this.syncSpeed = 2 * this.polePitch * this.ratedFreq; // m/s

        // ── LIM 专用参数 ──
        this.LIM_R1    = config.LIM_R1    || 0.8;    // Ω（初级每相电阻）
        this.LIM_X1    = config.LIM_X1    || 1.2;    // Ω（初级漏抗）
        this.LIM_R2    = config.LIM_R2    || 0.6;    // Ω（次级折算电阻）
        this.LIM_X2    = config.LIM_X2    || 0.8;    // Ω（次级折算漏抗）
        this.LIM_Xm    = config.LIM_Xm    || 18;     // Ω（激磁电抗）
        this.LIM_Kend  = config.LIM_Kend  || 0.15;   // 端部效应系数（速度相关）
        this.LIM_primaryLen = config.LIM_primaryLen || 0.72; // m（初级长度 = 2p×τ）

        // ── PMLM 专用参数 ──
        this.PMLM_Rs   = config.PMLM_Rs   || 0.5;    // Ω（初级相电阻）
        this.PMLM_Ld   = config.PMLM_Ld   || 8e-3;   // H（d 轴电感）
        this.PMLM_Lq   = config.PMLM_Lq   || 12e-3;  // H（q 轴电感，内嵌式 Lq>Ld）
        this.PMLM_psiF = config.PMLM_psiF || 0.18;   // Wb（永磁体磁链）
        this.PMLM_Fn   = config.PMLM_Fn   || 800;    // N（法向吸引力，固定）
        this.PMLM_Ke   = this.PMLM_psiF * this.polePairs * Math.sqrt(1.5) / this.polePitch;

        // ── 机械参数 ──
        this.mass       = config.mass       || 15;    // kg（动子质量）
        this.B_friction = config.B_friction || 20;    // N·s/m（粘性摩擦）
        this.F_cogging  = config.F_cogging  || 5;     // N（齿槽力幅值）
        this.maxStroke  = config.maxStroke  || 1.0;   // m（最大行程）
        this.maxSpeed   = config.maxSpeed   || this.syncSpeed * 0.95;

        // ── 额定推力 ──
        this.ratedForce = config.ratedForce || (this.ratedVoltage * this.ratedCurrent * 0.85 / this.syncSpeed);
        this.peakForce  = config.peakForce  || this.ratedForce * 2.5;

        // ── 控制参数（PMLM FOC）──
        this.Kp_pos   = config.Kp_pos   || 80;
        this.Kp_vel   = config.Kp_vel   || 0.15;
        this.Ki_vel   = config.Ki_vel   || 2.5;
        this.Kp_cur   = config.Kp_cur   || 18;
        this.Ki_cur   = config.Ki_cur   || 1200;

        // ── 运行状态 ──
        this._running    = false;
        this._wavePhase  = 0;    // 行波相位（rad）
        this._animPhase  = 0;

        // 机械状态
        this._position   = 0;    // m（动子位移）
        this._velocity   = 0;    // m/s
        this._accel      = 0;    // m/s²

        // 控制给定
        this._velRef     = config.initVel   || this.maxSpeed * 0.6;   // m/s
        this._posRef     = config.initPos   || 0.5;                   // m
        this._dutyCycle  = config.initDuty  || 0.8;
        this._loadForce  = config.initLoad  || 0;                     // N
        this._ctrlMode   = 'velocity';  // 'velocity' | 'position' | 'force'
        this._direction  = 1;           // +1 / -1

        // LIM 状态
        this._slip       = 1.0;         // 转差率
        this._I2         = 0;           // 次级折算电流
        this._endEffect  = 0;           // 端部效应力

        // PMLM FOC 状态
        this._id         = 0;  this._iq = 0;
        this._ud         = 0;  this._uq = 0;
        this._intId      = 0;  this._intIq = 0;
        this._intVel     = 0;
        this._posElec    = 0;  // 电角度位移（rad）

        // 三相电流（瞬时）
        this._iU = 0; this._iV = 0; this._iW = 0;

        // 推力
        this.forceEM     = 0;
        this.forceTotal  = 0;

        // 功率/效率
        this.powerIn     = 0;
        this.powerOut    = 0;
        this.efficiency  = 0;

        // 运动到位标志
        this._atTarget   = false;

        // ── 波形缓冲 ──
        this._wavLen    = 300;
        this._wavIU     = new Float32Array(this._wavLen).fill(0);
        this._wavIV     = new Float32Array(this._wavLen).fill(0);
        this._wavIW     = new Float32Array(this._wavLen).fill(0);
        this._wavF      = new Float32Array(this._wavLen).fill(0);
        this._wavV      = new Float32Array(this._wavLen).fill(0);
        this._wavX      = new Float32Array(this._wavLen).fill(0);

        // ── 几何布局 ──
        // 直线电机纵剖面（顶部，全宽横向）
        this._lmX  = Math.round(this.width * 0.02);
        this._lmY  = Math.round(this.height * 0.04);
        this._lmW  = this.width - Math.round(this.width * 0.04);
        this._lmH  = Math.round(this.height * 0.26);

        // 推力-速度曲线（左中）
        this._fvX  = this._lmX;
        this._fvY  = this._lmY + this._lmH + 8;
        this._fvW  = Math.round(this.width * 0.28);
        this._fvH  = Math.round(this.height * 0.22);

        // 推力-转差率曲线（中中）
        this._fsX  = this._fvX + this._fvW + 8;
        this._fsY  = this._fvY;
        this._fsW  = Math.round(this.width * 0.22);
        this._fsH  = this._fvH;

        // d-q 电流平面（右中）
        this._dqX  = this._fsX + this._fsW + 8;
        this._dqY  = this._fvY;
        this._dqW  = Math.round(this.width * 0.20);
        this._dqH  = this._fvH;

        // 动态响应曲线（最右中）
        this._dynX = this._dqX + this._dqW + 8;
        this._dynY = this._fvY;
        this._dynW = this.width - this._dynX - Math.round(this.width * 0.02);
        this._dynH = this._fvH;

        // LCD（左下）
        this._lcdX = this._lmX;
        this._lcdY = this._fvY + this._fvH + 8;
        this._lcdW = Math.round(this.width * 0.28);
        this._lcdH = Math.round(this.height * 0.24);

        // 控制面板（中下）
        this._panX = this._lcdX + this._lcdW + 8;
        this._panY = this._lcdY;
        this._panW = this.width - this._panX - Math.round(this.width * 0.02);
        this._panH = this._lcdH;

        // 波形（底部全宽）
        this._wavXp = this._lmX;
        this._wavYp = this._lcdY + this._lcdH + 6;
        this._wavWp = this._lmW;
        this._wavHp = this.height - this._wavYp - 6;


        // 动子可视化位置（像素）
        this._primaryPxX    = 0;   // 初级左边缘 x（像素）
        this._secondaryLen  = 0;   // 次级长度（像素）
        this._primaryLen    = 0;   // 初级长度（像素）

        this.config = {
            id: this.id, motorType: this.motorType,
            ratedVoltage: this.ratedVoltage, ratedFreq: this.ratedFreq,
            ratedForce: this.ratedForce, polePitch: this.polePitch,
        };

        this._init();

        // 端口
        const pT = this._lmY - 6;
        const pB = this._lmY + this._lmH + 6;
        this.addPort(this._lmX + this._lmW * 0.15, pT, 'dc_pos',  'wire', '+VDC');
        this.addPort(this._lmX + this._lmW * 0.25, pT, 'dc_neg',  'wire', '−VDC');
        this.addPort(this._lmX + this._lmW * 0.40, pT, 'phase_u', 'wire', 'U');
        this.addPort(this._lmX + this._lmW * 0.50, pT, 'phase_v', 'wire', 'V');
        this.addPort(this._lmX + this._lmW * 0.60, pT, 'phase_w', 'wire', 'W');
        this.addPort(this._lmX + this._lmW * 0.75, pT, 'pos_fb',  'wire', '位移FB');
        this.addPort(this._lmX + this._lmW * 0.90, pB, 'thrust_out','pipe','推力输出');
    }

    // ═══════════════════════════════════════════
    _init() {
        this._drawLabel();
        this._drawLinearMotorSection();
        this._drawTravelingFieldLayer();
        this._drawPrimaryMoverLayer();
        this._drawFVCurve();
        this._drawFSCurve();
        this._drawDQPlane();
        this._drawDynamicResponse();
        this._drawLCDPanel();
        this._drawControlPanel();
        this._drawWaveform();
        
    }

    _drawLabel() {
        const typeStr = this.motorType === 'LIM'
            ? `直线感应电机（LIM）  τ=${this.polePitch}m  v_s=${this.syncSpeed.toFixed(2)}m/s`
            : `永磁直线同步电机（PMLM）  FOC矢量控制  τ=${this.polePitch}m`;
        this.group.add(new Konva.Text({
            x: 0, y: -22, width: this.width,
            text: `直线电机  ${this.ratedVoltage}V  ${this.ratedFreq}Hz  ${this.ratedForce.toFixed(0)}N  ` + typeStr,
            fontSize: 10, fontStyle: 'bold', fill: '#1a2634', align: 'center',
        }));
    }

    // ── 直线电机纵剖面图 ─────────────────────
    _drawLinearMotorSection() {
        const { _lmX: lx, _lmY: ly, _lmW: lw, _lmH: lh } = this;

        this.group.add(new Konva.Rect({
            x: lx, y: ly, width: lw, height: lh,
            fill: '#0d1a24', stroke: '#1a3040', strokeWidth: 1.5, cornerRadius: 5,
        }));
        this.group.add(new Konva.Text({
            x: lx, y: ly - 14, width: lw,
            text: this.motorType === 'LIM'
                ? '直线感应电机纵剖面（初级铁芯+绕组 / 次级铝板，行波磁场驱动）'
                : '永磁直线同步电机纵剖面（初级绕组 / 次级永磁阵列，FOC推力控制）',
            fontSize: 9, fontStyle: 'bold', fill: '#546e7a', align: 'center',
        }));

        // ── 导轨/机架（固定部分）──
        const railY = ly + lh * 0.72;
        const railH = lh * 0.12;
        this.group.add(new Konva.Rect({ x: lx+4, y: railY, width: lw-8, height: railH, fill: '#263238', stroke: '#37474f', strokeWidth: 1.5, cornerRadius: 2 }));
        // 导轨纹（工字钢截面示意）
        for (let i = 0; i < 12; i++) {
            const x2 = lx + 8 + i * (lw-16) / 12;
            this.group.add(new Konva.Line({ points:[x2, railY, x2, railY+railH], stroke:'rgba(255,255,255,0.08)', strokeWidth:0.8 }));
        }
        this.group.add(new Konva.Text({ x: lx+6, y: railY+railH/3, text: '导轨 / 机座', fontSize: 8, fill: '#546e7a' }));

        // ── 次级（铝板 or 永磁阵列，固定在导轨上）──
        const secY = ly + lh * 0.54;
        const secH = lh * 0.17;
        if (this.motorType === 'LIM') {
            // 铝板（LIM 次级）
            this.group.add(new Konva.Rect({ x: lx+4, y: secY, width: lw-8, height: secH, fill: '#5d7a8a', stroke: '#78909c', strokeWidth: 1, cornerRadius: 1 }));
            // 涡流图案（示意）
            for (let i = 0; i < 8; i++) {
                const cx2 = lx + 20 + i*(lw-40)/8;
                this._drawEdgyCurrent(cx2, secY + secH/2, secH*0.35);
            }
            this.group.add(new Konva.Text({ x: lx+6, y: secY+secH*0.3, text: '次级铝板（感应涡流产生推力）', fontSize: 8, fill: '#b0bec5' }));
        } else {
            // 永磁阵列（PMLM 次级）
            const nPoles = Math.round(lw / (this.polePitch * lw / 1.0)) * 2;
            const poleW  = (lw - 8) / nPoles;
            for (let i = 0; i < nPoles; i++) {
                const col   = i % 2 === 0 ? '#ef9a9a' : '#90caf9';
                const label = i % 2 === 0 ? 'N' : 'S';
                this.group.add(new Konva.Rect({
                    x: lx+4 + i*poleW, y: secY, width: poleW-1, height: secH,
                    fill: col, stroke: '#263238', strokeWidth: 0.5,
                    opacity: 0.80,
                }));
                if (poleW > 16)
                    this.group.add(new Konva.Text({ x: lx+4+i*poleW+poleW/2-4, y: secY+secH*0.3, text: label, fontSize: 9, fill: '#1a252f', fontStyle: 'bold' }));
            }
            this.group.add(new Konva.Text({ x: lx+6, y: secY-12, text: '次级永磁阵列（N-S 交替，极距 τ）', fontSize: 8, fill: '#ef9a9a' }));
        }
        this._secY = secY; this._secH = secH;

        // ── 气隙区域 ──
        const gapY = ly + lh * 0.45;
        const gapH = lh * 0.09;
        this.group.add(new Konva.Rect({ x: lx+4, y: gapY, width: lw-8, height: gapH, fill: '#06101a', opacity: 0.9 }));
        this.group.add(new Konva.Text({ x: lx+lw/2-12, y: gapY+1, text: '← 气隙 δ →', fontSize: 7, fill: '#37474f' }));
        this._gapY = gapY; this._gapH = gapH;

        // ── 初级铁芯（静态轮廓，可视化为叠片铁芯）──
        const priH = lh * 0.38;
        const priY = ly + lh * 0.06;
        // 初级可视宽度 = 初级物理长度 / 最大行程 × 显示宽度
        const priVisW = Math.round((this.LIM_primaryLen / this.maxStroke) * (lw - 16));
        this._priVisW    = Math.min(lw - 16, Math.max(60, priVisW));
        this._priVisH    = priH;
        this._priVisYTop = priY;
        this._lmLX       = lx + 4;  // 可移动区域左边界
        this._lmRX       = lx + lw - 4; // 右边界

        // 初级铁芯（Konva.Group，动态移动）
        this._primaryGroup = new Konva.Group({ x: lx + 4, y: 0 });

        // 铁芯主体
        this._primaryGroup.add(new Konva.Rect({
            x: 0, y: priY, width: this._priVisW, height: priH,
            fill: '#455a64', stroke: '#37474f', strokeWidth: 1.5, cornerRadius: 2,
        }));
        // 叠片纹
        for (let i = 2; i < priH; i += 3)
            this._primaryGroup.add(new Konva.Line({ points:[1, priY+i, this._priVisW-1, priY+i], stroke:'rgba(0,0,0,0.12)', strokeWidth:0.6 }));

        // 绕组槽（三相，等间距）
        const slotN   = this.polePairs * 2 * 3; // 总槽数 = 2p × 3相
        const slotStep= this._priVisW / slotN;
        const slotColors = ['#e53935', '#43a047', '#1e88e5'];
        this._slotGroups = [];
        for (let i = 0; i < slotN; i++) {
            const ph  = i % 3;
            const col = slotColors[ph];
            const sx  = i * slotStep;
            const sy  = priY + priH * 0.18;
            const sh  = priH * 0.64;
            const sw  = slotStep * 0.55;
            // 槽口
            this._primaryGroup.add(new Konva.Rect({ x: sx, y: priY, width: slotStep*0.7, height: priH*0.12, fill: '#0d1a24' }));
            // 绕组
            const wr = new Konva.Rect({ x: sx+1, y: sy, width: sw-2, height: sh, fill: col, opacity: 0.70, cornerRadius: 1 });
            this._primaryGroup.add(wr);
            this._slotGroups.push({ rect: wr, phase: ph });
        }
        // 初级标注
        this._primaryGroup.add(new Konva.Text({ x: this._priVisW/2-20, y: priY+priH*0.42, text: '初级（动子）', fontSize: 8, fill: '#78909c' }));

        // 位移传感器（右端箭头）
        this._posArrow = new Konva.Arrow({ points:[lx+4,ly+lh*0.90,lx+4,ly+lh*0.90], stroke:'#66bb6a',fill:'#66bb6a',strokeWidth:2,pointerLength:5,pointerWidth:4 });
        this._posLabel = new Konva.Text({ x: lx+4, y: ly+lh*0.90+4, text: 'x=0.00m', fontSize: 8, fill: '#66bb6a', fontFamily: 'Courier New, monospace' });

        // 速度箭头（动子顶部）
        this._velArrow = new Konva.Arrow({ points:[lx+4+this._priVisW/2,priY-6, lx+4+this._priVisW/2,priY-6], stroke:'#4fc3f7',fill:'#4fc3f7',strokeWidth:2,pointerLength:5,pointerWidth:4 });
        this._velLabel = new Konva.Text({ x: lx+4, y: priY-18, text: 'v=0.00m/s', fontSize: 8, fill: '#4fc3f7', fontFamily: 'Courier New, monospace' });

        this.group.add(this._primaryGroup, this._posArrow, this._posLabel, this._velArrow, this._velLabel);

        // ── 行程尺（底部刻度）──
        const scaleY = ly + lh - 10;
        this.group.add(new Konva.Line({ points:[lx+4,scaleY,lx+lw-4,scaleY], stroke:'#37474f', strokeWidth:0.8 }));
        for (let i = 0; i <= 10; i++) {
            const sx = lx+4 + (i/10)*(lw-8);
            this.group.add(new Konva.Line({ points:[sx,scaleY,sx,scaleY+(i%5===0?5:3)], stroke:'#37474f', strokeWidth:0.7 }));
            if (i%5===0)
                this.group.add(new Konva.Text({ x:sx-8,y:scaleY+6, text:`${(i/10*this.maxStroke).toFixed(1)}m`, fontSize:6, fill:'#37474f' }));
        }
        // 目标位置指示线
        this._targetLine = new Konva.Line({ points:[lx+4,priY-2,lx+4,scaleY+8], stroke:'#ffd54f',strokeWidth:1,dash:[4,3],opacity:0.7 });
        this.group.add(this._targetLine);
    }

    // 涡流图案（LIM 次级感应电流示意）
    _drawEdgyCurrent(cx, cy, r) {
        const pts = [];
        for (let i = 0; i <= 12; i++) {
            const a = (i/12)*Math.PI*2 - Math.PI/2;
            pts.push(cx + r*Math.cos(a)*0.7, cy + r*Math.sin(a)*0.5);
        }
        this.group.add(new Konva.Line({ points:pts, stroke:'rgba(200,220,255,0.18)', strokeWidth:1.2, lineJoin:'round', closed:true }));
    }

    // ── 行波磁场动画层 ──────────────────────
    _drawTravelingFieldLayer() {
        this._fieldGroup = new Konva.Group();
        this.group.add(this._fieldGroup);
    }

    // ── 初级动子特效层 ──────────────────────
    _drawPrimaryMoverLayer() {
        this._moverEffectGroup = new Konva.Group();
        this.group.add(this._moverEffectGroup);
    }

    // ── 推力-速度特性曲线（F-v）─────────────
    _drawFVCurve() {
        const { _fvX: fx, _fvY: fy, _fvW: fw, _fvH: fh } = this;

        this.group.add(new Konva.Rect({ x:fx,y:fy,width:fw,height:fh,fill:'#010d18',stroke:'#1a3040',strokeWidth:1.5,cornerRadius:4 }));
        this.group.add(new Konva.Rect({ x:fx,y:fy,width:fw,height:13,fill:'#0a1a28',cornerRadius:[4,4,0,0] }));
        this.group.add(new Konva.Text({ x:fx+4,y:fy+2,width:fw-8, text:'F-v 推力-速度特性', fontSize:8,fontStyle:'bold',fill:'#80cbc4',align:'center' }));

        const ox=fx+14, oy=fy+fh-12, aw=fw-20, ah=fh-26;
        this.group.add(new Konva.Line({ points:[ox,oy-ah,ox,oy,ox+aw,oy],stroke:'#37474f',strokeWidth:0.8 }));
        this.group.add(new Konva.Text({ x:ox-12,y:oy-ah,text:'F(N)',fontSize:7,fill:'#80cbc4' }));
        this.group.add(new Konva.Text({ x:ox+aw+2,y:oy+2,text:'v(m/s)',fontSize:7,fill:'#80cbc4' }));

        // v_s 同步速度线
        const vsX = ox + (this.syncSpeed/this.maxSpeed)*aw;
        this.group.add(new Konva.Line({ points:[vsX,oy-ah,vsX,oy],stroke:'#ffd54f',strokeWidth:0.7,dash:[3,3] }));
        this.group.add(new Konva.Text({ x:vsX-4,y:oy+3,text:'v_s',fontSize:6.5,fill:'#ffd54f' }));

        // LIM F-v 曲线（含端部效应衰减）
        const limPts=[], limEndPts=[];
        for (let v=0; v<=this.maxSpeed; v+=this.maxSpeed/60) {
            const s = Math.max(1e-4, (this.syncSpeed-v)/this.syncSpeed);
            const F = this._calcLIMForce(s);
            const Fend = F * (1 - this.LIM_Kend * v / this.syncSpeed);
            const x2 = ox+(v/this.maxSpeed)*aw;
            const y1 = oy-Math.min(ah-2,(F/this.peakForce)*(ah-2));
            const y2 = oy-Math.min(ah-2,(Math.max(0,Fend)/this.peakForce)*(ah-2));
            limPts.push(x2,y1); limEndPts.push(x2,y2);
        }
        this.group.add(new Konva.Line({ points:limPts,    stroke:'#ef9a9a',strokeWidth:1.5,lineJoin:'round',opacity:0.65,dash:[4,3] }));
        this.group.add(new Konva.Line({ points:limEndPts, stroke:'#66bb6a',strokeWidth:1.8,lineJoin:'round',opacity:0.75 }));

        // 图例
        this.group.add(new Konva.Line({ points:[fx+6,fy+14,fx+16,fy+14],stroke:'#ef9a9a',strokeWidth:1.5,dash:[4,3] }));
        this.group.add(new Konva.Text({ x:fx+18,y:fy+10,text:'无端部效应',fontSize:6.5,fill:'#ef9a9a' }));
        this.group.add(new Konva.Line({ points:[fx+6,fy+23,fx+16,fy+23],stroke:'#66bb6a',strokeWidth:1.5 }));
        this.group.add(new Konva.Text({ x:fx+18,y:fy+19,text:'含端部效应',fontSize:6.5,fill:'#66bb6a' }));

        this._fvWorkPt = new Konva.Circle({ x:ox,y:oy,radius:5,fill:'#ffd54f',stroke:'#f9a825',strokeWidth:1.5 });
        this.group.add(this._fvWorkPt);
        this._fvOX=ox; this._fvOY=oy; this._fvAW=aw; this._fvAH=ah;
    }

    // ── 推力-转差率曲线（F-s，LIM）──────────
    _drawFSCurve() {
        const { _fsX: fx, _fsY: fy, _fsW: fw, _fsH: fh } = this;

        this.group.add(new Konva.Rect({ x:fx,y:fy,width:fw,height:fh,fill:'#010d18',stroke:'#1a3040',strokeWidth:1.5,cornerRadius:4 }));
        this.group.add(new Konva.Rect({ x:fx,y:fy,width:fw,height:13,fill:'#0a1a28',cornerRadius:[4,4,0,0] }));
        this.group.add(new Konva.Text({ x:fx+4,y:fy+2,width:fw-8,text:'F-s 推力-转差率',fontSize:8,fontStyle:'bold',fill:'#80cbc4',align:'center' }));

        const ox=fx+14, oy=fy+fh-12, aw=fw-20, ah=fh-26;
        this.group.add(new Konva.Line({ points:[ox,oy-ah,ox,oy,ox+aw,oy],stroke:'#37474f',strokeWidth:0.8 }));
        this.group.add(new Konva.Text({ x:ox-12,y:oy-ah,text:'F(N)',fontSize:7,fill:'#80cbc4' }));
        this.group.add(new Konva.Text({ x:ox+aw+2,y:oy+2,text:'s',fontSize:7,fill:'#80cbc4' }));

        // F-s 曲线
        const fsPts = [];
        for (let s=0.01; s<=1.0; s+=0.01) {
            const F = this._calcLIMForce(s);
            const x2 = ox+(1-s)*aw;
            fsPts.push(x2, oy-Math.min(ah-2,(F/this.peakForce)*(ah-2)));
        }
        this.group.add(new Konva.Line({ points:fsPts,stroke:'#4fc3f7',strokeWidth:2,lineJoin:'round',opacity:0.75 }));

        // 临界转差率标注
        const sm = this.LIM_R2 / Math.sqrt(this.LIM_R1**2+(this.LIM_X1+this.LIM_X2)**2);
        const smX = ox+(1-sm)*aw;
        this.group.add(new Konva.Line({ points:[smX,oy-ah,smX,oy],stroke:'#ffa726',strokeWidth:0.8,dash:[3,3] }));
        this.group.add(new Konva.Text({ x:smX-4,y:oy+3,text:'s_m',fontSize:6.5,fill:'#ffa726' }));

        this._fsWorkPt = new Konva.Circle({ x:ox,y:oy,radius:5,fill:'#66bb6a',stroke:'#2e7d32',strokeWidth:1.5 });
        this.group.add(this._fsWorkPt);
        this._fsOX=ox; this._fsOY=oy; this._fsAW=aw; this._fsAH=ah;
    }

    // ── d-q 电流平面（PMLM 用）──────────────
    _drawDQPlane() {
        const { _dqX: dx, _dqY: dy, _dqW: dw, _dqH: dh } = this;

        this.group.add(new Konva.Rect({ x:dx,y:dy,width:dw,height:dh,fill:'#010d18',stroke:'#1a3040',strokeWidth:1.5,cornerRadius:4 }));
        this.group.add(new Konva.Rect({ x:dx,y:dy,width:dw,height:13,fill:'#0a1a28',cornerRadius:[4,4,0,0] }));
        this.group.add(new Konva.Text({ x:dx+4,y:dy+2,width:dw-8,text:'d-q 电流平面（PMLM）',fontSize:8,fontStyle:'bold',fill:'#80cbc4',align:'center' }));

        const ocx=dx+dw*0.55, ocy=dy+dh*0.55;
        const R=Math.min(dw,dh)*0.32;

        this.group.add(new Konva.Line({ points:[dx+6,ocy,dx+dw-6,ocy],stroke:'#37474f',strokeWidth:0.7 }));
        this.group.add(new Konva.Line({ points:[ocx,dy+14,ocx,dy+dh-6],stroke:'#37474f',strokeWidth:0.7 }));
        this.group.add(new Konva.Text({ x:dx+dw-12,y:ocy+3,text:'id',fontSize:8,fill:'#ffd54f' }));
        this.group.add(new Konva.Text({ x:ocx+3,y:dy+14,text:'iq',fontSize:8,fill:'#80cbc4' }));

        // 电流极限圆
        const iMaxPx = this.ratedCurrent*1.5 * (R/(this.ratedCurrent*1.5));
        this.group.add(new Konva.Circle({ x:ocx,y:ocy,radius:R,fill:'rgba(102,187,106,0.05)',stroke:'#66bb6a',strokeWidth:0.8,dash:[4,3] }));

        // MTPA 轨迹（PMLM IPM 型）
        if (this.PMLM_Ld !== this.PMLM_Lq) {
            const mtpaPts=[];
            for (let is=0.1; is<=this.ratedCurrent*1.5; is+=0.2) {
                const dLdq=this.PMLM_Lq-this.PMLM_Ld;
                const disc=this.PMLM_psiF**2+8*dLdq**2*is**2;
                const id=(this.PMLM_psiF-Math.sqrt(disc))/(4*dLdq);
                const iq=Math.sqrt(Math.max(0,is**2-id**2));
                const scl=R/(this.ratedCurrent*1.5);
                const px2=ocx+id*scl, py2=ocy-iq*scl;
                if (px2>dx+6&&px2<dx+dw-6&&py2>dy+14&&py2<dy+dh-6) mtpaPts.push(px2,py2);
            }
            if (mtpaPts.length>4)
                this.group.add(new Konva.Line({ points:mtpaPts,stroke:'#ffa726',strokeWidth:1.5,lineJoin:'round',opacity:0.7 }));
        }
        // id=0 线
        this.group.add(new Konva.Line({ points:[ocx,ocy,ocx,dy+14],stroke:'#ffd54f',strokeWidth:0.7,dash:[3,3],opacity:0.5 }));

        this._dqWorkPt = new Konva.Circle({ x:ocx,y:ocy-R*0.4,radius:5,fill:'#ef5350',stroke:'#c62828',strokeWidth:1.5 });
        this._dqIdLine = new Konva.Line({ points:[],stroke:'#ffd54f',strokeWidth:0.8,dash:[2,2] });
        this._dqIqLine = new Konva.Line({ points:[],stroke:'#80cbc4',strokeWidth:0.8,dash:[2,2] });
        this.group.add(this._dqIdLine,this._dqIqLine,this._dqWorkPt);
        this._dqOCX=ocx; this._dqOCY=ocy; this._dqR=R;
        this._dqScl=R/(this.ratedCurrent*1.5);
    }

    // ── 动态响应曲线（x-t / v-t）────────────
    _drawDynamicResponse() {
        const { _dynX: dx, _dynY: dy, _dynW: dw, _dynH: dh } = this;

        this.group.add(new Konva.Rect({ x:dx,y:dy,width:dw,height:dh,fill:'#010d18',stroke:'#1a3040',strokeWidth:1.5,cornerRadius:4 }));
        this.group.add(new Konva.Rect({ x:dx,y:dy,width:dw,height:13,fill:'#0a1a28',cornerRadius:[4,4,0,0] }));
        this.group.add(new Konva.Text({ x:dx+4,y:dy+2,width:dw-8,text:'位移 x(t) / 速度 v(t)',fontSize:8,fontStyle:'bold',fill:'#80cbc4',align:'center' }));

        const ox=dx+12, oy=dy+dh-12, aw=dw-18, ah=dh-26;
        this.group.add(new Konva.Line({ points:[ox,oy-ah,ox,oy,ox+aw,oy],stroke:'#37474f',strokeWidth:0.8 }));
        this.group.add(new Konva.Text({ x:ox-10,y:oy-ah,text:'x/v',fontSize:7,fill:'#80cbc4' }));
        this.group.add(new Konva.Text({ x:ox+aw+2,y:oy+2,text:'t',fontSize:7,fill:'#80cbc4' }));

        this._dynXLine = new Konva.Line({ points:[],stroke:'#ffd54f',strokeWidth:1.8,lineJoin:'round' });
        this._dynVLine = new Konva.Line({ points:[],stroke:'#4fc3f7',strokeWidth:1.5,lineJoin:'round',dash:[4,2] });
        this._dynFLine = new Konva.Line({ points:[],stroke:'#66bb6a',strokeWidth:1.2,lineJoin:'round' });

        const lgX=dx+6,lgY=dy+14;
        [['#ffd54f','位移 x(m)'],['#4fc3f7','速度 v(m/s)'],['#66bb6a','推力 F(N)']].forEach(([col,lbl],i)=>{
            this.group.add(new Konva.Line({ points:[lgX,lgY+i*9+3,lgX+10,lgY+i*9+3],stroke:col,strokeWidth:1.8 }));
            this.group.add(new Konva.Text({ x:lgX+12,y:lgY+i*9-1,text:lbl,fontSize:7,fill:col }));
        });
        this.group.add(this._dynXLine,this._dynVLine,this._dynFLine);
        this._dynOX=ox; this._dynOY=oy; this._dynAW=aw; this._dynAH=ah;
    }

    // ── LCD 仪表 ─────────────────────────────
    _drawLCDPanel() {
        const { _lcdX: lx, _lcdY: ly, _lcdW: lw, _lcdH: lh } = this;

        this.group.add(new Konva.Rect({ x:lx,y:ly,width:lw,height:lh,fill:'#020c14',stroke:'#1a3040',strokeWidth:1.5,cornerRadius:4 }));
        this.group.add(new Konva.Rect({ x:lx,y:ly,width:lw,height:13,fill:'#0a1a28',cornerRadius:[4,4,0,0] }));
        this.group.add(new Konva.Text({ x:lx+4,y:ly+2,width:lw-8,text:'运行仪表',fontSize:8,fontStyle:'bold',fill:'#80cbc4',align:'center' }));

        const cells=[
            {label:'位移 x',  id:'pos',   unit:'m',   color:'#ffd54f'},
            {label:'速度 v',  id:'vel',   unit:'m/s', color:'#4fc3f7'},
            {label:'推力 F',  id:'force', unit:'N',   color:'#66bb6a'},
            {label:'转差率 s',id:'slip',  unit:'',    color:'#ffa726'},
            {label:'同步速度',id:'vsync', unit:'m/s', color:'#80cbc4'},
            {label:'iq',      id:'iq',    unit:'A',   color:'#ef9a9a'},
            {label:'id',      id:'iid',   unit:'A',   color:'#90caf9'},
            {label:'端部效应',id:'end',   unit:'N',   color:'#ff8a65'},
            {label:'输入功率',id:'pin',   unit:'W',   color:'#ce93d8'},
            {label:'输出功率',id:'pout',  unit:'W',   color:'#90caf9'},
            {label:'效率',    id:'eff',   unit:'%',   color:'#66bb6a'},
            {label:'电机类型',id:'type',  unit:'',    color:'#ffd54f'},
        ];

        const cellW=(lw-8)/3, cellH=22, gap=2;
        this._lcdCells={};
        cells.forEach(({ label, id, unit, color }, i)=>{
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
        this.group.add(new Konva.Text({ x:px+4,y:py+2,width:pw-8,text:'控制操作',fontSize:8,fontStyle:'bold',fill:'#80cbc4',align:'center' }));

        const bW=(pw-16)/5, bH=18, bY=py+16;
        [['▶ 起动',  '#1a3a1a','#2e7d32','#66bb6a',()=>this.start()],
         ['■ 停止',  '#3a1a1a','#c62828','#ef5350',()=>this.stop()],
         ['↔ 反向',  '#1a0a3a','#6a1b9a','#ce93d8',()=>this.reverse()],
         ['LIM/PMLM','#1a1a0a','#f57f17','#ffd54f',()=>this.toggleType()],
         ['复位归零', '#0a1a3a','#1565c0','#64b5f6',()=>this.resetPos()],
        ].forEach(([lbl,fill,stroke,col,cb],i)=>{
            const bx=px+4+i*(bW+2);
            const btn=new Konva.Rect({ x:bx,y:bY,width:bW,height:bH,fill,stroke,strokeWidth:1.5,cornerRadius:3 });
            const t  =new Konva.Text({ x:bx,y:bY+4,width:bW,text:lbl,fontSize:8,fontStyle:'bold',fill:col,align:'center' });
            btn.on('click tap',cb);
            btn.on('mouseenter',()=>btn.opacity(0.75));
            btn.on('mouseleave',()=>btn.opacity(1));
            this.group.add(btn,t);
        });

        // 控制模式切换
        const modeBY=bY+bH+8;
        this.group.add(new Konva.Text({ x:px+4,y:modeBY-2,text:'控制模式:',fontSize:7.5,fill:'#546e7a' }));
        this._modeBtns={};
        [['速度模式','velocity'],['位置模式','position'],['推力模式','force']].forEach(([lbl,m],i)=>{
            const bx=px+56+i*68;
            const active=this._ctrlMode===m;
            const btn=new Konva.Rect({ x:bx,y:modeBY,width:64,height:15,fill:active?'#1a3a1a':'#0d1520',stroke:active?'#66bb6a':'#1a3040',strokeWidth:1,cornerRadius:3 });
            const t  =new Konva.Text({ x:bx,y:modeBY+3,width:64,text:lbl,fontSize:7.5,fill:active?'#66bb6a':'#37474f',align:'center' });
            btn.on('click tap',()=>this.setCtrlMode(m));
            this._modeBtns[m]={btn,t};
            this.group.add(btn,t);
        });

        const sliders=[
            { label:`目标速度（max ${this.maxSpeed.toFixed(2)}m/s）`, key:'vel', color:'#4fc3f7',
              getR:()=>this._velRef/this.maxSpeed, set:r=>{ this._velRef=r*this.maxSpeed; }, disp:()=>`${this._velRef.toFixed(2)}m/s` },
            { label:`目标位置（0~${this.maxStroke}m）`, key:'pos', color:'#ffd54f',
              getR:()=>this._posRef/this.maxStroke, set:r=>{ this._posRef=r*this.maxStroke; }, disp:()=>`${this._posRef.toFixed(3)}m` },
            { label:`负载力（max ${this.ratedForce.toFixed(0)}N）`, key:'load', color:'#ffa726',
              getR:()=>this._loadForce/this.ratedForce, set:r=>{ this._loadForce=r*this.ratedForce; }, disp:()=>`${this._loadForce.toFixed(1)}N` },
        ];

        const slW=(pw-16)/2-32;
        this._sliderBars={};
        sliders.forEach(({ label, key, color, getR, set, disp }, si)=>{
            const col=si%2, row=Math.floor(si/2);
            const slX=px+4+col*(slW+42), slY=py+56+row*26;
            this.group.add(new Konva.Text({ x:slX,y:slY-11,text:label,fontSize:7,fill:'#546e7a' }));
            this.group.add(new Konva.Rect({ x:slX,y:slY,width:slW,height:8,fill:'#0a0a18',cornerRadius:2 }));
            const bar=new Konva.Rect({ x:slX,y:slY,width:0,height:8,fill:color,cornerRadius:2 });
            const txt=new Konva.Text({ x:slX+slW+4,y:slY-2,width:44,text:'--',fontSize:8,fontFamily:'Courier New, monospace',fill:color });
            const hit=new Konva.Rect({ x:slX,y:slY-2,width:slW,height:12,fill:'transparent' });
            hit.on('click tap mousedown',e=>{
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
        const { _wavXp: wx, _wavYp: wy, _wavWp: ww, _wavHp: wh } = this;
        if (wh<14) return;

        this.group.add(new Konva.Rect({ x:wx,y:wy,width:ww,height:wh,fill:'#010d18',stroke:'#1a3040',strokeWidth:1.5,cornerRadius:4 }));
        this.group.add(new Konva.Rect({ x:wx,y:wy,width:ww,height:12,fill:'#0a1a28',cornerRadius:[4,4,0,0] }));
        this.group.add(new Konva.Text({ x:wx+4,y:wy+1,width:ww-8,text:'三相电流 iU/iV/iW   电磁推力 F_em   速度 v   位移 x',fontSize:8,fill:'#80cbc4',align:'center' }));

        const nCh=4, hCh=(wh-12)/nCh;
        this._wavMids=Array.from({length:nCh},(_,i)=>wy+12+hCh*(i+0.5));
        this._wavMids.forEach(my=>this.group.add(new Konva.Line({ points:[wx+2,my,wx+ww-2,my],stroke:'rgba(200,200,200,0.06)',strokeWidth:0.5,dash:[4,3] })));

        this._wLIU =new Konva.Line({ points:[],stroke:'#e53935',strokeWidth:1.5,lineJoin:'round' });
        this._wLIV =new Konva.Line({ points:[],stroke:'#43a047',strokeWidth:1.5,lineJoin:'round' });
        this._wLIW =new Konva.Line({ points:[],stroke:'#1e88e5',strokeWidth:1.5,lineJoin:'round' });
        this._wLF  =new Konva.Line({ points:[],stroke:'#66bb6a',strokeWidth:1.8,lineJoin:'round' });
        this._wLV  =new Konva.Line({ points:[],stroke:'#4fc3f7',strokeWidth:1.5,lineJoin:'round' });
        this._wLX  =new Konva.Line({ points:[],stroke:'#ffd54f',strokeWidth:1.5,lineJoin:'round' });

        ['iU/iV/iW','F_em','v(m/s)','x(m)'].forEach((l,i)=>{
            this.group.add(new Konva.Text({ x:wx+4,y:wy+12+hCh*i+3,text:l,fontSize:8,fill:['#e53935','#66bb6a','#4fc3f7','#ffd54f'][i] }));
        });
        this.group.add(this._wLIU,this._wLIV,this._wLIW,this._wLF,this._wLV,this._wLX);
        this._wavHCh=hCh;
    }

    // ═══════════════════════════════════════════
    // 集中化 tick（由 consys._tickAll 在 20fps 调用）
    tick(dt) {
        this._tickPhysics(dt);
        this._tickPrimaryMover();
        this._tickTravelingField(dt);
        this._tickFVPoint();
        this._tickFSPoint();
        this._tickDQPoint();
        this._tickDynResponse();
        this._tickWaveform();
        this._tickDisplay();
        this._refreshCache();
    }

    // ── 物理仿真 ─────────────────────────────
    _tickPhysics(dt) {
        const omega = 2*Math.PI*this.ratedFreq;
        this._wavePhase += omega*dt;
        this._animPhase += dt*3;

        if (!this._running) {
            // 惯性减速 + 摩擦
            const F_fric = this.B_friction*this._velocity + Math.sign(this._velocity)*this.F_cogging;
            this._velocity -= (F_fric/this.mass)*dt;
            if (Math.abs(this._velocity) < 0.001) this._velocity = 0;
            this._position += this._velocity*dt;
            this._position  = Math.max(0, Math.min(this.maxStroke, this._position));
            this._slip       = 1.0;
            this.forceEM     = 0;
            this._iU=this._iV=this._iW=0;
            this._id=this._iq=0;
            this._updateWavBufs();
            return;
        }

        if (this.motorType === 'LIM') {
            this._tickLIM(dt);
        } else {
            this._tickPMLM(dt);
        }

        // ── 机械运动方程 ──
        const F_fric  = this.B_friction * this._velocity;
        const F_cog   = this.F_cogging * Math.sin(this._position * 2*Math.PI / this.polePitch);
        const netForce= this.forceEM - F_fric - F_cog - this._loadForce * Math.sign(this._velocity||1);
        this._accel   = netForce / this.mass;
        this._velocity += this._accel * dt;
        this._velocity  = Math.max(-this.maxSpeed, Math.min(this.maxSpeed, this._velocity));

        // 行程限位（弹性碰壁）
        this._position += this._velocity * dt;
        if (this._position <= 0)            { this._position=0;            this._velocity=Math.max(0,this._velocity); }
        if (this._position >= this.maxStroke){ this._position=this.maxStroke; this._velocity=Math.min(0,this._velocity); }

        // 位置电角度（PMLM）
        this._posElec = this._position * Math.PI / this.polePitch;

        // 功率/效率
        this.powerOut = this.forceEM * Math.abs(this._velocity);
        const R_loss  = this.motorType==='LIM' ? 3*this.ratedCurrent**2*this.LIM_R1 : 1.5*this.PMLM_Rs*(this._id**2+this._iq**2);
        this.powerIn  = this.powerOut + R_loss + 0.01*this.ratedForce*this.syncSpeed;
        this.efficiency= this.powerIn>0.1 ? Math.min(98, this.powerOut/this.powerIn*100) : 0;

        // 到位判断
        if (this._ctrlMode==='position')
            this._atTarget = Math.abs(this._position - this._posRef) < 0.005;

        this._updateWavBufs();
    }

    // ── LIM 仿真 ─────────────────────────────
    _tickLIM(dt) {
        // 速度/位置控制（PI）
        let vCmd;
        if (this._ctrlMode === 'position') {
            const posErr = (this._posRef - this._position) * this._direction;
            vCmd = Math.max(-this.maxSpeed, Math.min(this.maxSpeed, posErr * this.Kp_pos));
        } else if (this._ctrlMode === 'force') {
            // 推力模式：直接给定转差率
            const sCmd = this._loadForce / (this.ratedForce + 1e-9);
            this._slip = Math.max(0.01, Math.min(0.99, sCmd));
            vCmd = this.syncSpeed * (1 - this._slip) * this._direction;
        } else {
            vCmd = this._velRef * this._direction;
        }

        // 转差率计算
        const vTarget = Math.max(-this.maxSpeed, Math.min(this.maxSpeed, vCmd));
        this._slip    = Math.max(1e-4, Math.min(1.0, (this.syncSpeed - Math.abs(this._velocity)) / this.syncSpeed));

        // 电磁推力
        const excitRatio = this._dutyCycle;
        const F_raw      = this._calcLIMForce(this._slip) * excitRatio**2;
        // 端部效应修正
        this._endEffect  = F_raw * this.LIM_Kend * Math.abs(this._velocity) / (this.syncSpeed + 1e-9);
        this.forceEM     = Math.max(0, F_raw - this._endEffect) * Math.sign(vTarget || this._direction);

        // 三相电流（方波近似）
        const omega_e = 2*Math.PI*this.ratedFreq * (1 - this._slip);
        const I_mag   = this.ratedCurrent * excitRatio * Math.sqrt(1-this._slip*0.5);
        this._iU = I_mag * Math.sign(Math.sin(this._wavePhase));
        this._iV = I_mag * Math.sign(Math.sin(this._wavePhase - 2*Math.PI/3));
        this._iW = I_mag * Math.sign(Math.sin(this._wavePhase + 2*Math.PI/3));
        this._iq = I_mag; this._id = 0;
    }

    // ── PMLM FOC 仿真 ─────────────────────────
    _tickPMLM(dt) {
        const Vmax = this.ratedVoltage / Math.sqrt(3);
        const omega_e = Math.abs(this._velocity) * Math.PI / this.polePitch;  // 电角速度（空间频率）

        // 速度外环
        let velErr;
        if (this._ctrlMode === 'position') {
            const posErr  = this._posRef - this._position;
            const velCmd2 = Math.max(-this.maxSpeed, Math.min(this.maxSpeed, posErr * this.Kp_pos));
            velErr = velCmd2 - this._velocity;
        } else {
            velErr = this._velRef * this._direction - this._velocity;
        }
        this._intVel += velErr * this.Ki_vel * dt;
        this._intVel  = Math.max(-this.peakForce, Math.min(this.peakForce, this._intVel));
        const fCmd    = this.Kp_vel*velErr + this._intVel;
        const iqRef   = fCmd / (1.5*(Math.PI/this.polePitch)*this.PMLM_psiF + 1e-9);
        const iqClamped=Math.max(-this.ratedCurrent*1.5, Math.min(this.ratedCurrent*1.5, iqRef));

        // MTPA d 轴
        const dLdq=this.PMLM_Lq-this.PMLM_Ld;
        const disc=this.PMLM_psiF**2+8*dLdq**2*iqClamped**2;
        const idRef=Math.abs(dLdq)>1e-6?(this.PMLM_psiF-Math.sqrt(Math.max(0,disc)))/(4*dLdq):0;
        const iqMax=Math.sqrt(Math.max(0,(this.ratedCurrent*1.5)**2-idRef**2));
        const iqRef2=Math.max(-iqMax,Math.min(iqMax,iqClamped));

        // 电流环
        const idErr=idRef-this._id, iqErr=iqRef2-this._iq;
        this._intId+=idErr*this.Ki_cur*dt; this._intIq+=iqErr*this.Ki_cur*dt;
        this._intId=Math.max(-Vmax,Math.min(Vmax,this._intId));
        this._intIq=Math.max(-Vmax,Math.min(Vmax,this._intIq));
        const decD=-omega_e*this.PMLM_Lq*this._iq;
        const decQ=omega_e*(this.PMLM_Ld*this._id+this.PMLM_psiF);
        const udCmd=this.Kp_cur*idErr+this._intId+decD;
        const uqCmd=this.Kp_cur*iqErr+this._intIq+decQ;
        const uMag=Math.sqrt(udCmd**2+uqCmd**2);
        const sc=uMag>Vmax?Vmax/uMag:1;
        this._ud=udCmd*sc; this._uq=uqCmd*sc;

        // 电流动态
        const tauD=this.PMLM_Ld/(this.PMLM_Rs+1e-9);
        const tauQ=this.PMLM_Lq/(this.PMLM_Rs+1e-9);
        const idSS=(this._ud+omega_e*this.PMLM_Lq*this._iq)/(this.PMLM_Rs+1e-9);
        const iqSS=(this._uq-omega_e*(this.PMLM_Ld*this._id+this.PMLM_psiF))/(this.PMLM_Rs+1e-9);
        this._id+=(idSS-this._id)*(1-Math.exp(-dt/tauD));
        this._iq+=(iqSS-this._iq)*(1-Math.exp(-dt/tauQ));
        const isNow=Math.sqrt(this._id**2+this._iq**2);
        if (isNow>this.ratedCurrent*1.5){this._id*=this.ratedCurrent*1.5/isNow; this._iq*=this.ratedCurrent*1.5/isNow;}

        // 推力（PMLM）
        const Tpitch = Math.PI / this.polePitch;
        this.forceEM = 1.5*Tpitch*(this.PMLM_psiF*this._iq+(this.PMLM_Ld-this.PMLM_Lq)*this._id*this._iq);
        this._slip   = 0;
        this._endEffect = 0;

        // 逆变换→三相电流
        const theta_e = this._posElec * this._direction;
        const cosT=Math.cos(theta_e), sinT=Math.sin(theta_e);
        const iAlpha=cosT*this._id-sinT*this._iq;
        const iBeta =sinT*this._id+cosT*this._iq;
        this._iU = iAlpha;
        this._iV = (-iAlpha+Math.sqrt(3)*iBeta)/2;
        this._iW = (-iAlpha-Math.sqrt(3)*iBeta)/2;
    }

    // ── 推力计算（LIM，等效电路）─────────────
    _calcLIMForce(s) {
        if (s<=0) return 0;
        const U1  = this.ratedVoltage / Math.sqrt(3);
        const R2s = this.LIM_R2 / s;
        const Ztot= Math.sqrt((this.LIM_R1+R2s)**2+(this.LIM_X1+this.LIM_X2)**2);
        const I2  = U1 / Ztot;
        const F   = 3 * I2**2 * R2s / this.syncSpeed;
        return Math.min(this.peakForce, F);
    }

    _updateWavBufs() {
        this._wavIU  = new Float32Array([...this._wavIU.slice(1),  this._iU]);
        this._wavIV  = new Float32Array([...this._wavIV.slice(1),  this._iV]);
        this._wavIW  = new Float32Array([...this._wavIW.slice(1),  this._iW]);
        this._wavF   = new Float32Array([...this._wavF.slice(1),   this.forceEM]);
        this._wavV   = new Float32Array([...this._wavV.slice(1),   this._velocity]);
        this._wavX   = new Float32Array([...this._wavX.slice(1),   this._position]);
    }

    // ── 初级动子可视化更新 ───────────────────
    _tickPrimaryMover() {
        const lx = this._lmX + 4;
        const lw = this._lmW - 8;
        const posNorm = this._position / this.maxStroke;
        const priX = lx + posNorm * (lw - this._priVisW);

        if (this._primaryGroup) this._primaryGroup.x(priX - lx);

        // 目标位置线
        if (this._targetLine) {
            const tNorm = this._posRef / this.maxStroke;
            const tPx   = this._lmX + 4 + tNorm * (lw - this._priVisW) + this._priVisW/2;
            this._targetLine.points([tPx, this._priVisYTop-2, tPx, this._lmY+this._lmH-14]);
        }

        // 位置标注
        if (this._posLabel) {
            const labelX = Math.min(this._lmX+this._lmW-80, priX);
            this._posLabel.text(`x=${this._position.toFixed(3)}m`);
            this._posLabel.x(labelX);
        }
        // 速度箭头
        if (this._velArrow && this._velLabel) {
            const midX = priX + this._priVisW/2;
            const arrowLen = Math.min(60, Math.abs(this._velocity/this.maxSpeed)*60);
            const arrowDir = Math.sign(this._velocity||1);
            this._velArrow.points([midX, this._priVisYTop-6, midX+arrowLen*arrowDir, this._priVisYTop-6]);
            this._velLabel.text(`v=${this._velocity.toFixed(3)}m/s`);
            this._velLabel.x(priX);
        }

        // 绕组颜色随相电流变化
        if (this._slotGroups) {
            const iVals = [this._iU, this._iV, this._iW];
            const iPk   = Math.max(0.01, this.ratedCurrent*1.5);
            this._slotGroups.forEach(({ rect, phase }) => {
                const alpha = 0.3 + 0.65*Math.abs(iVals[phase])/(iPk);
                rect.opacity(Math.min(0.95, alpha));
            });
        }

        // 失步/过载特效
        this._moverEffectGroup.destroyChildren();
        if (this._running && Math.abs(this.forceEM) > this.peakForce * 0.9) {
            for (let i = 0; i < 5; i++) {
                const ex = priX + Math.random()*this._priVisW;
                const ey = this._priVisYTop + Math.random()*this._priVisH;
                this._moverEffectGroup.add(new Konva.Line({
                    points:[ex,ey,ex+(Math.random()-0.5)*10,ey+(Math.random()-0.5)*10],
                    stroke:`rgba(255,220,60,${0.4+Math.random()*0.4})`,strokeWidth:1.5,lineCap:'round',
                }));
            }
        }
    }

    // ── 行波磁场粒子动画 ─────────────────────
    _tickTravelingField(dt) {
        this._fieldGroup.destroyChildren();
        if (!this._running) return;

        const lx = this._lmX + 4;
        const lw = this._lmW - 8;
        const posNorm = this._position / this.maxStroke;
        const priLeft = lx + posNorm*(lw-this._priVisW);
        const priRight= priLeft + this._priVisW;
        const gapMidY = this._gapY + this._gapH/2;

        const nPart  = 20;
        const travelV= this.syncSpeed / this.maxStroke * lw;  // px/s 行波速度
        const phColors = ['rgba(229,57,53,', 'rgba(67,160,71,', 'rgba(30,136,229,'];

        for (let i = 0; i < nPart; i++) {
            // 行波相位（随时间推进，从左到右）
            const t   = ((this._animPhase * travelV * 0.0008 * this._direction + i/nPart) % 1 + 1) % 1;
            const px  = priLeft + t * this._priVisW;
            if (px < priLeft || px > priRight) continue;

            // 三相磁场叠加颜色（正弦分布）
            const phase_offset = (px - priLeft) / this._priVisW * Math.PI * 2 * this.polePairs;
            const BA = Math.sin(phase_offset);
            const BB = Math.sin(phase_offset - 2*Math.PI/3);
            const BC = Math.sin(phase_offset + 2*Math.PI/3);
            const Btot = (Math.abs(BA) + Math.abs(BB) + Math.abs(BC)) / 1.5;
            const alpha = Math.min(0.7, Btot * 0.55);
            if (alpha < 0.04) continue;

            // 磁力线粒子（气隙内垂直流动）
            const phaseIdx = Math.round(((px-priLeft)/this._priVisW*this.polePairs*3)%3);
            const col = phColors[phaseIdx % 3];
            this._fieldGroup.add(new Konva.Ellipse({
                x: px, y: gapMidY,
                radiusX: 3, radiusY: this._gapH*0.35,
                fill: `${col}${alpha})`,
            }));
        }
    }

    // ── F-v 工作点 ───────────────────────────
    _tickFVPoint() {
        if (!this._fvWorkPt) return;
        const vAbs  = Math.abs(this._velocity);
        const fAbs  = Math.abs(this.forceEM);
        const px    = this._fvOX + (vAbs/this.maxSpeed)*this._fvAW;
        const py    = this._fvOY - Math.min(this._fvAH-2,(fAbs/this.peakForce)*(this._fvAH-2));
        this._fvWorkPt.x(Math.max(this._fvOX,Math.min(this._fvOX+this._fvAW,px)));
        this._fvWorkPt.y(Math.max(this._fvY+14,Math.min(this._fvOY,py)));
        this._fvWorkPt.fill(fAbs>this.ratedForce*1.1?'#ef5350':fAbs>this.ratedForce*0.5?'#ffa726':'#ffd54f');
    }

    // ── F-s 工作点 ───────────────────────────
    _tickFSPoint() {
        if (!this._fsWorkPt) return;
        const s = Math.max(0,Math.min(1,this._slip));
        const F = Math.abs(this.forceEM);
        const px= this._fsOX+(1-s)*this._fsAW;
        const py= this._fsOY-Math.min(this._fsAH-2,(F/this.peakForce)*(this._fsAH-2));
        this._fsWorkPt.x(Math.max(this._fsOX,Math.min(this._fsOX+this._fsAW,px)));
        this._fsWorkPt.y(Math.max(this._fsY+14,Math.min(this._fsOY,py)));
        this._fsWorkPt.fill(this.motorType==='LIM'?'#66bb6a':'#37474f');
    }

    // ── d-q 工作点 ───────────────────────────
    _tickDQPoint() {
        if (!this._dqWorkPt) return;
        const ocx=this._dqOCX, ocy=this._dqOCY, scl=this._dqScl;
        const px=ocx+this._id*scl, py=ocy-this._iq*scl;
        this._dqWorkPt.x(Math.max(this._dqX+4,Math.min(this._dqX+this._dqW-4,px)));
        this._dqWorkPt.y(Math.max(this._dqY+14,Math.min(this._dqY+this._dqH-4,py)));
        this._dqIdLine.points([ocx,py,px,py]);
        this._dqIqLine.points([px,ocy,px,py]);
        this._dqWorkPt.fill(this.motorType==='PMLM'?'#66bb6a':'#37474f');
    }

    // ── 动态响应曲线 ─────────────────────────
    _tickDynResponse() {
        if (!this._dynXLine) return;
        const n=this._wavLen, aw=this._dynAW, ah=this._dynAH;
        const ox=this._dynOX, oy=this._dynOY;
        const dx2=aw/n;
        const ptX=[], ptV=[], ptF=[];
        for (let i=0;i<n;i++) {
            const x=ox+i*dx2;
            ptX.push(x, oy-(this._wavX[i]/this.maxStroke)*(ah-4));
            ptV.push(x, oy-(this._wavV[i]/this.maxSpeed)*(ah-4)*0.5);
            ptF.push(x, oy-(this._wavF[i]/this.peakForce)*(ah-4)*0.3);
        }
        this._dynXLine.points(ptX);
        this._dynVLine.points(ptV);
        this._dynFLine.points(ptF);
    }

    // ── 波形更新 ─────────────────────────────
    _tickWaveform() {
        if (!this._wavHCh||!this._wavMids) return;
        const wx=this._wavXp+3, ww=this._wavWp-6, n=this._wavLen;
        const dx=ww/n, hCh=this._wavHCh;
        const [mI,mF,mV,mX]=this._wavMids;
        const iPk=Math.max(0.01,this.ratedCurrent*1.5);
        const fPk=Math.max(0.01,this.peakForce);

        const ptIU=[],ptIV=[],ptIW=[],ptF=[],ptV=[],ptX=[];
        for (let i=0;i<n;i++) {
            const x2=wx+i*dx;
            ptIU.push(x2,mI-(this._wavIU[i]/iPk)*hCh*0.36);
            ptIV.push(x2,mI-(this._wavIV[i]/iPk)*hCh*0.36);
            ptIW.push(x2,mI-(this._wavIW[i]/iPk)*hCh*0.36);
            ptF.push(x2, mF-(this._wavF[i]/fPk)*hCh*0.38);
            ptV.push(x2, mV-(this._wavV[i]/this.maxSpeed)*hCh*0.38);
            ptX.push(x2, mX-(this._wavX[i]/this.maxStroke)*hCh*0.36);
        }
        this._wLIU.points(ptIU); this._wLIV.points(ptIV); this._wLIW.points(ptIW);
        this._wLF.points(ptF);   this._wLV.points(ptV);   this._wLX.points(ptX);
    }

    // ── 仪表更新 ─────────────────────────────
    _tickDisplay() {
        const c=this._lcdCells;
        if (!c) return;

        if (c.pos)    c.pos.text(this._position.toFixed(4));
        if (c.vel)    c.vel.text(this._velocity.toFixed(4));
        if (c.force) {
            c.force.text(this.forceEM.toFixed(2));
            c.force.fill(Math.abs(this.forceEM)>this.peakForce*0.85?'#ef5350':Math.abs(this.forceEM)>this.ratedForce?'#ffa726':'#66bb6a');
        }
        if (c.slip)   c.slip.text(this.motorType==='LIM'?this._slip.toFixed(4):'N/A（同步）');
        if (c.vsync)  c.vsync.text(this.syncSpeed.toFixed(3));
        if (c.iq)     c.iq.text(this._iq.toFixed(3));
        if (c.iid)    c.iid.text(this._id.toFixed(3));
        if (c.end)    c.end.text(this._endEffect.toFixed(2));
        if (c.pin)    c.pin.text(this.powerIn.toFixed(1));
        if (c.pout)   c.pout.text(Math.max(0,this.powerOut).toFixed(1));
        if (c.eff) {
            c.eff.text(this.efficiency.toFixed(1));
            c.eff.fill(this.efficiency>85?'#66bb6a':this.efficiency>60?'#ffa726':'#ef5350');
        }
        if (c.type)   c.type.text(this.motorType);

        if (this._sliderBars) {
            Object.values(this._sliderBars).forEach(({ bar, txt, slW, getR, disp })=>{
                bar.width(Math.min(slW,Math.max(0,getR())*slW));
                txt.text(disp());
            });
        }
    }

    // ═══════════════════════════════════════════
    start() {
        this._running = true;
        this._intVel  = 0;
        this._intId   = this._intIq = 0;
        this._refreshCache();
    }

    stop() {
        this._running = false;
        this._intVel  = 0;
        this._intId   = this._intIq = 0;
        this._refreshCache();
    }

    reverse() {
        this._direction *= -1;
        this._refreshCache();
    }

    resetPos() {
        this._position  = 0;
        this._velocity  = 0;
        this._posElec   = 0;
        this._id = this._iq = 0;
        this._refreshCache();
    }

    toggleType() {
        this.motorType = this.motorType === 'LIM' ? 'PMLM' : 'LIM';
        this._refreshCache();
    }

    setCtrlMode(mode) {
        this._ctrlMode = mode;
        this._intVel   = 0;
        Object.entries(this._modeBtns||{}).forEach(([m,{btn,t}])=>{
            const on=m===mode;
            btn.fill(on?'#1a3a1a':'#0d1520');
            btn.stroke(on?'#66bb6a':'#1a3040');
            t.fill(on?'#66bb6a':'#37474f');
        });
        this._refreshCache();
    }

    setVelocity(v)  { this._velRef   = Math.max(-this.maxSpeed, Math.min(this.maxSpeed, v)); this._refreshCache(); }
    setPosition(x)  { this._posRef   = Math.max(0, Math.min(this.maxStroke, x));             this._refreshCache(); }
    setLoad(F)      { this._loadForce= Math.max(0, Math.min(this.ratedForce*1.5, F));        this._refreshCache(); }

    getPosition()   { return this._position; }
    getVelocity()   { return this._velocity; }
    getForce()      { return this.forceEM; }
    isAtTarget()    { return this._atTarget; }
    isRunning()     { return this._running; }

    update(cfg={}) {
        if (cfg.vel  !== undefined) this.setVelocity(cfg.vel);
        if (cfg.pos  !== undefined) this.setPosition(cfg.pos);
        if (cfg.load !== undefined) this.setLoad(cfg.load);
        this._refreshCache();
    }

    getConfigFields() {
        return [
            { label:'位号/名称',              key:'id',            type:'text'   },
            { label:'电机类型（LIM/PMLM）',   key:'motorType',     type:'text'   },
            { label:'额定线电压 (V)',          key:'ratedVoltage',  type:'number' },
            { label:'额定频率 (Hz)',           key:'ratedFreq',     type:'number' },
            { label:'极距 τ (m)',             key:'polePitch',     type:'number' },
            { label:'极对数 p',               key:'polePairs',     type:'number' },
            { label:'额定推力 (N)',           key:'ratedForce',    type:'number' },
            { label:'峰值推力 (N)',           key:'peakForce',     type:'number' },
            { label:'动子质量 (kg)',          key:'mass',          type:'number' },
            { label:'最大行程 (m)',           key:'maxStroke',     type:'number' },
            { label:'LIM 端部效应系数',       key:'LIM_Kend',      type:'number' },
            { label:'PMLM 永磁磁链 ψ_f (Wb)',key:'PMLM_psiF',     type:'number' },
            { label:'PMLM d轴电感 (mH)',      key:'PMLM_Ld',       type:'number' },
            { label:'PMLM q轴电感 (mH)',      key:'PMLM_Lq',       type:'number' },
        ];
    }

    onConfigUpdate(cfg) {
        this.id           = cfg.id            || this.id;
        if (cfg.motorType)   this.motorType    = cfg.motorType;
        if (cfg.ratedVoltage)this.ratedVoltage = parseFloat(cfg.ratedVoltage);
        if (cfg.ratedFreq)   this.ratedFreq    = parseFloat(cfg.ratedFreq);
        if (cfg.polePitch)   this.polePitch    = parseFloat(cfg.polePitch);
        if (cfg.polePairs)   this.polePairs    = parseInt(cfg.polePairs);
        if (cfg.ratedForce)  this.ratedForce   = parseFloat(cfg.ratedForce);
        if (cfg.peakForce)   this.peakForce    = parseFloat(cfg.peakForce);
        if (cfg.mass)        this.mass         = parseFloat(cfg.mass);
        if (cfg.maxStroke)   this.maxStroke    = parseFloat(cfg.maxStroke);
        if (cfg.LIM_Kend)    this.LIM_Kend     = parseFloat(cfg.LIM_Kend);
        if (cfg.PMLM_psiF)   this.PMLM_psiF   = parseFloat(cfg.PMLM_psiF);
        if (cfg.PMLM_Ld)     this.PMLM_Ld     = parseFloat(cfg.PMLM_Ld)*1e-3;
        if (cfg.PMLM_Lq)     this.PMLM_Lq     = parseFloat(cfg.PMLM_Lq)*1e-3;
        this.syncSpeed    = 2 * this.polePitch * this.ratedFreq;
        this.maxSpeed     = this.syncSpeed * 0.95;
        this.PMLM_Ke      = this.PMLM_psiF * this.polePairs * Math.sqrt(1.5) / this.polePitch;
        this.config       = { ...this.config, ...cfg };
        this._refreshCache();
    }

    destroy() {
        super.destroy?.();
    }
}