import { BaseComponent } from './BaseComponent.js';

/**
 * 直流无刷电机仿真组件
 * （Brushless DC Motor，BLDC）
 *
 * ── 与有刷直流电机的核心区别 ──────────────────────────────────
 *
 *  有刷直流电机：机械换向（电刷+换向器），结构简单，维护困难
 *  无刷直流电机：电子换向（霍尔传感器 + 功率逆变器），无机械磨损
 *
 *  ┌──────────────┬────────────────────────┬────────────────────────┐
 *  │              │  有刷直流电机           │  无刷直流电机（BLDC）  │
 *  ├──────────────┼────────────────────────┼────────────────────────┤
 *  │ 换向方式     │ 机械（电刷+换向器）    │ 电子（逆变器+霍尔）    │
 *  │ 转子结构     │ 电枢绕组在转子         │ 永磁体在转子           │
 *  │ 定子结构     │ 永磁体或绕组在定子     │ 三相绕组在定子         │
 *  │ 反电动势波形 │ 直流（经换向）         │ 梯形波（BLDC特征）     │
 *  │ 驱动方式     │ 直流直接驱动           │ 三相逆变器 PWM 驱动    │
 *  │ 转矩脉动     │ 较大                  │ 较小（6步换向约15%）   │
 *  │ 寿命/可靠性  │ 电刷磨损，寿命短       │ 无磨损，寿命长         │
 *  │ 效率         │ 较低（电刷损耗）       │ 较高（85~95%）         │
 *  └──────────────┴────────────────────────┴────────────────────────┘
 *
 * ── BLDC 工作原理 ─────────────────────────────────────────────
 *
 *  1. 转子永磁体结构：
 *     表贴式永磁体（SPM）：磁体贴于转子表面，气隙均匀，反电动势梯形波
 *     内嵌式永磁体（IPM）：磁体埋入转子铁芯，有磁阻转矩分量
 *     本仿真默认表贴式，2极对数（4极）
 *
 *  2. 六步换向（Six-Step Commutation）：
 *     霍尔传感器（H1/H2/H3）检测转子位置，每60°电角度换向一次
 *     一个电周期分6个换向步骤，每步120°导通两相，第三相悬空
 *     换向表（标准六步，正转）：
 *       步骤 1（Hall=101）：A+, C-  （绕组 AC 通电）
 *       步骤 2（Hall=100）：A+, B-  （绕组 AB 通电）
 *       步骤 3（Hall=110）：C+, B-  （绕组 CB 通电）
 *       步骤 4（Hall=010）：C+, A-  （绕组 CA 通电）
 *       步骤 5（Hall=011）：B+, A-  （绕组 BA 通电）
 *       步骤 6（Hall=001）：B+, C-  （绕组 BC 通电）
 *
 *  3. 反电动势（Back EMF，BEMF）：
 *     BLDC 特征波形为梯形波（区别于 PMSM 的正弦波）：
 *       e_k = K_e × ω × f_trap(θ_e - (k-1)×2π/3)
 *       其中 f_trap 为梯形波函数，平顶宽度约 120° 电角度
 *       K_e：反电动势系数（V·s/rad）
 *     稳态：V_dc = E_back + I×R + L×dI/dt
 *
 *  4. 转矩产生：
 *     T_em = (e_a×i_a + e_b×i_b + e_c×i_c) / ω
 *     理想六步换向（两相导通）：T_em = K_t × I_dc
 *       其中 K_t = K_e（SI 单位下，K_t = K_e）
 *     转矩脉动来源：换向重叠、电流纹波、BEMF 非理想性
 *
 *  5. 霍尔传感器与位置检测：
 *     三个霍尔传感器 H1/H2/H3，互差 120° 电角度安装
 *     输出数字信号（0/1），编码转子磁极位置
 *     霍尔状态：6个有效状态（001/010/011/100/101/110），
 *     2个无效状态（000/111）→ 故障检测
 *
 *  6. PWM 调速：
 *     调节 PWM 占空比（Duty Cycle）控制相电压有效值
 *     V_phase_eff = V_dc × D（D = 占空比）
 *     转速与占空比近似线性（忽略损耗）：
 *       n ≈ (V_dc × D - I × R) / K_e
 *
 *  7. 电流控制（FOC 简化）：
 *     PI 电流环：调节 PWM 占空比使电流跟随给定
 *     速度环（外环）→ 电流环（内环）→ PWM 调制
 *
 *  8. 关键参数：
 *     Kv（KV 值）：每伏反电动势对应转速 rpm/V
 *     K_e = 1/(Kv × 2π/60)（V·s/rad）
 *     K_t = K_e（SI 单位，N·m/A）
 *     时间常数：τ_e = L/R（电气），τ_m = J/(K_t×K_e/R)（机械）
 *
 * ── 组件结构 ──────────────────────────────────────────────────
 *  ① 电机横截面图（永磁转子 + 三相定子绕组 + 霍尔传感器位置）
 *  ② 六步换向逻辑图（霍尔状态 → 功率管导通状态，动态高亮）
 *  ③ 三相逆变器拓扑（六个 MOSFET，动态开关状态）
 *  ④ 梯形波反电动势 + 三相电流波形（动态，含换向脉冲）
 *  ⑤ 转矩-转速特性曲线（T-n，含工作点）
 *  ⑥ 效率 MAP（η vs n vs T，等效率曲线）
 *  ⑦ 霍尔传感器信号时序图（H1/H2/H3 数字波形）
 *  ⑧ LCD 仪表（转速/转矩/功率/效率/电流/电压/占空比/换向步骤）
 *  ⑨ 控制面板（目标转速/负载转矩/PWM占空比/正反转/起动停止）
 *
 * ── 端口 ─────────────────────────────────────────────────────
 *  dc_pos    — 直流母线正极（+）
 *  dc_neg    — 直流母线负极（-）
 *  phase_u   — 三相输出 U
 *  phase_v   — 三相输出 V
 *  phase_w   — 三相输出 W
 *  hall_h1   — 霍尔传感器 H1
 *  hall_h2   — 霍尔传感器 H2
 *  hall_h3   — 霍尔传感器 H3
 *  shaft     — 输出轴
 */
export class BLDCMotor extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.width  = Math.max(580, config.width  || 700);
        this.height = Math.max(440, config.height || 560);

        this.type    = 'bldc_motor';
        this.special = 'none';
        this.cache   = 'fixed';

        this._initGroups();
        // ── 额定参数 ──
        this.ratedPower    = config.ratedPower    || 500;    // W
        this.ratedVoltage  = config.ratedVoltage  || 48;     // V（直流母线）
        this.ratedSpeed    = config.ratedSpeed    || 3000;   // rpm
        this.ratedTorque   = config.ratedTorque   || (this.ratedPower / (this.ratedSpeed * 2*Math.PI/60)); // N·m
        this.ratedCurrent  = config.ratedCurrent  || (this.ratedPower / this.ratedVoltage / 0.9); // A
        this.polePairs     = config.polePairs     || 2;      // 极对数（4极=2对）
        this.Kv            = config.Kv            || 650;    // rpm/V（KV 值）

        // ── 电机电磁参数 ──
        this.Ke    = 1 / (this.Kv * 2*Math.PI/60);          // V·s/rad（反电动势系数）
        this.Kt    = this.Ke;                                // N·m/A（转矩系数，SI单位 Kt=Ke）
        this.R     = config.R     || 0.15;  // Ω（相电阻，线-线）
        this.L     = config.L     || 0.12e-3; // H（相电感，线-线）
        this.tauE  = this.L / this.R;        // 电气时间常数

        // ── 机械参数 ──
        this.J       = config.J       || 5e-5;    // kg·m²（转子转动惯量）
        this.B       = config.B       || 2e-4;    // N·m·s/rad（粘性阻尼）
        this.maxSpeed= config.maxSpeed|| Math.round(this.ratedVoltage * this.Kv * 1.05); // rpm
        this.maxTorque=config.maxTorque|| this.ratedTorque * 2.5;

        // ── 换向表（六步，正转） ──
        // [霍尔状态(二进制)] -> {步骤, 高侧MOSFET(相), 低侧MOSFET(相), 颜色}
        // 相序：U=0, V=1, W=2
        this._commTable = {
            0b101: { step: 1, hi: 0, lo: 2, label: 'A+C-' },
            0b100: { step: 2, hi: 0, lo: 1, label: 'A+B-' },
            0b110: { step: 3, hi: 2, lo: 1, label: 'C+B-' },
            0b010: { step: 4, hi: 2, lo: 0, label: 'C+A-' },
            0b011: { step: 5, hi: 1, lo: 0, label: 'B+A-' },
            0b001: { step: 6, hi: 1, lo: 2, label: 'B+C-' },
        };
        this._stepColors = ['#ef5350','#ff8a65','#ffd54f','#66bb6a','#4fc3f7','#ce93d8'];

        // ── 运行状态 ──
        this._running     = false;
        this._direction   = 1;           // +1=正转，-1=反转
        this._thetaE      = 0;           // 电角度 rad
        this._thetaM      = 0;           // 机械角度 rad
        this._omega       = 0;           // 角速度 rad/s
        this._speed       = 0;           // rpm
        this._phaseTimer  = 0;

        // 控制量
        this._dutySet     = config.initDuty  || 0.7;  // PWM 占空比
        this._loadTq      = config.initLoad  || 0;    // 负载转矩 N·m
        this._targetSpeed = config.initSpeed || this.ratedSpeed * 0.8; // rpm 目标转速（速度模式）
        this._ctrlMode    = 'speed';    // 'speed' | 'duty'

        // PI 速度控制器
        this._piKp = 0.002; this._piKi = 0.0005; this._piIntg = 0;

        // 实时电气量
        this.iU        = 0; this.iV = 0; this.iW = 0;   // 三相电流 A
        this.eU        = 0; this.eV = 0; this.eW = 0;   // 三相 BEMF V
        this.uU        = 0; this.uV = 0; this.uW = 0;   // 三相相电压 V
        this.iDC       = 0;   // 直流母线电流 A
        this.torqueEM  = 0;   // 电磁转矩 N·m
        this.torqueRipple = 0;// 转矩脉动
        this.power_in  = 0;   // 输入功率 W
        this.power_out = 0;   // 输出功率 W
        this.efficiency= 0;   // 效率 %
        this.hallState = 0b101;// 霍尔状态
        this.commStep  = 1;   // 当前换向步骤 1~6
        this._duty     = 0;   // 实际占空比

        // 换向事件（用于脉冲动画）
        this._commEvent   = false;
        this._commEventTimer = 0;

        // ── 波形缓冲 ──
        this._wavLen  = 300;
        this._wavEU   = new Float32Array(this._wavLen).fill(0);
        this._wavEV   = new Float32Array(this._wavLen).fill(0);
        this._wavEW   = new Float32Array(this._wavLen).fill(0);
        this._wavIU   = new Float32Array(this._wavLen).fill(0);
        this._wavIV   = new Float32Array(this._wavLen).fill(0);
        this._wavIW   = new Float32Array(this._wavLen).fill(0);
        this._wavT    = new Float32Array(this._wavLen).fill(0);
        this._wavH1   = new Float32Array(this._wavLen).fill(0);
        this._wavH2   = new Float32Array(this._wavLen).fill(0);
        this._wavH3   = new Float32Array(this._wavLen).fill(0);

        // ── 几何布局 ──
        // 电机截面（左上）
        this._motX  = Math.round(this.width * 0.02);
        this._motY  = Math.round(this.height * 0.04);
        this._motW  = Math.round(this.width * 0.28);
        this._motH  = Math.round(this.height * 0.44);
        this._motCX = this._motX + this._motW / 2;
        this._motCY = this._motY + this._motH / 2;

        // 三相逆变器拓扑（中上）
        this._invX  = Math.round(this.width * 0.32);
        this._invY  = this._motY;
        this._invW  = Math.round(this.width * 0.28);
        this._invH  = Math.round(this.height * 0.28);

        // 换向逻辑表（右上）
        this._commX = Math.round(this.width * 0.62);
        this._commY = this._motY;
        this._commW = this.width - this._commX - Math.round(this.width * 0.02);
        this._commH = Math.round(this.height * 0.28);

        // T-n 特性（中中）
        this._tnX   = this._invX;
        this._tnY   = this._invY + this._invH + 8;
        this._tnW   = Math.round(this.width * 0.27);
        this._tnH   = Math.round(this.height * 0.24);

        // 效率 MAP（右中）
        this._mapX  = this._tnX + this._tnW + 6;
        this._mapY  = this._tnY;
        this._mapW  = this._commX + this._commW - this._mapX;
        this._mapH  = this._tnH;

        // LCD（左下）
        this._lcdX  = this._motX;
        this._lcdY  = this._motY + this._motH + 8;
        this._lcdW  = this._motW;
        this._lcdH  = Math.round(this.height * 0.26);

        // 控制面板（中下）
        this._panX  = this._invX;
        this._panY  = this._tnY + this._tnH + 8;
        this._panW  = this._commX + this._commW - this._invX;
        this._panH  = Math.round(this.height * 0.14);

        // 波形（底部全宽）
        this._wavX  = this._motX;
        this._wavY  = Math.max(this._lcdY + this._lcdH, this._panY + this._panH) + 6;
        this._wavW  = this.width - this._motX * 2;
        this._wavH  = this.height - this._wavY - 6;


        this.config = {
            id: this.id,
            ratedPower: this.ratedPower,
            ratedVoltage: this.ratedVoltage,
            ratedSpeed: this.ratedSpeed,
            Kv: this.Kv,
        };

        this._init();

        // 端口
        const mL = this._motX - 6;
        this.addPort(mL, this._motCY - 20, 'dc_pos', 'wire', '+VDC');
        this.addPort(mL, this._motCY + 20, 'dc_neg', 'wire', '−VDC');
        const mR = this._motX + this._motW + 6;
        this.addPort(mR, this._motCY - 24, 'phase_u', 'wire', 'U');
        this.addPort(mR, this._motCY,       'phase_v', 'wire', 'V');
        this.addPort(mR, this._motCY + 24, 'phase_w', 'wire', 'W');
        this.addPort(mR, this._motCY + 52, 'hall_h1', 'wire', 'H1');
        this.addPort(mR, this._motCY + 66, 'hall_h2', 'wire', 'H2');
        this.addPort(mR, this._motCY + 80, 'hall_h3', 'wire', 'H3');
        this.addPort(this._motCX, this._motY + this._motH + 6, 'shaft', 'pipe', '轴');
    }

    // ═══════════════════════════════════════════
    _init() {
        this._drawLabel();
        this._drawMotorSection();
        this._drawMagnetLayer();
        this._drawRotorLayer();
        this._drawInverterTopology();
        this._drawCommutationTable();
        this._drawTNCurve();
        this._drawEfficiencyMap();
        this._drawLCDPanel();
        this._drawControlPanel();
        this._drawWaveform();
        
    }

    _drawLabel() {
        this._staticGroup.add(new Konva.Text({
            x: 0, y: -22, width: this.width,
            text: `BLDC 无刷直流电机  ${this.ratedPower}W  ${this.ratedVoltage}V DC  ${this.ratedSpeed}rpm  Kv=${this.Kv}rpm/V  ${this.polePairs*2}极  六步换向`,
            fontSize: 11, fontStyle: 'bold', fill: '#1a2634', align: 'center',
        }));
    }

    // ── 电机横截面（定子绕组 + 霍尔传感器） ──
    _drawMotorSection() {
        const { _motX: ex, _motY: ey, _motW: ew, _motH: eh,
                _motCX: ecx, _motCY: ecy } = this;

        this._staticGroup.add(new Konva.Rect({
            x: ex, y: ey, width: ew, height: eh,
            fill: '#0d1a24', stroke: '#1a3040', strokeWidth: 1.5, cornerRadius: 5,
        }));
        this._staticGroup.add(new Konva.Text({
            x: ex, y: ey - 14, width: ew,
            text: `BLDC 横截面（${this.polePairs*2}极，表贴永磁）`,
            fontSize: 9, fontStyle: 'bold', fill: '#546e7a', align: 'center',
        }));

        // 机座
        const frameR = Math.round(Math.min(ew, eh) * 0.46);
        this._staticGroup.add(new Konva.Circle({ x: ecx, y: ecy, radius: frameR, fill: '#1c2b38', stroke: '#37474f', strokeWidth: 3 }));

        // 定子铁芯（叠片环）
        const sOuter = Math.round(frameR * 0.90);
        const sInner = Math.round(frameR * 0.62);
        this._staticGroup.add(new Konva.Ring({ x: ecx, y: ecy, innerRadius: sInner, outerRadius: sOuter, fill: '#455a64', stroke: '#263238', strokeWidth: 1 }));

        // 定子叠片纹
        for (let i = 0; i < 36; i++) {
            const a = (i/36)*Math.PI*2;
            this._staticGroup.add(new Konva.Line({
                points: [ecx+sInner*Math.cos(a), ecy+sInner*Math.sin(a), ecx+sOuter*Math.cos(a), ecy+sOuter*Math.sin(a)],
                stroke: 'rgba(0,0,0,0.15)', strokeWidth: 0.6,
            }));
        }

        // 定子槽（12槽，3相×4极）
        const slotN  = 12;
        const slotD  = (sOuter - sInner) * 0.50;
        const slotW  = 4;
        this._slotAngles = [];
        for (let i = 0; i < slotN; i++) {
            const a = (i/slotN)*Math.PI*2 - Math.PI/2;
            this._slotAngles.push(a);
            // 槽口
            this._staticGroup.add(new Konva.Line({
                points: [ecx+(sInner+2)*Math.cos(a), ecy+(sInner+2)*Math.sin(a),
                         ecx+(sInner+slotD)*Math.cos(a), ecy+(sInner+slotD)*Math.sin(a)],
                stroke: '#0d1a24', strokeWidth: slotW,
            }));
        }

        // 三相绕组着色（每槽着色）
        const wR   = sInner + slotD * 0.5;
        const phColors = ['#e53935','#43a047','#1e88e5'];
        // 每相4槽，交错排列 UVW UVW...
        for (let i = 0; i < slotN; i++) {
            const a   = this._slotAngles[i];
            const ph  = i % 3;
            const col = phColors[ph];
            const dot = new Konva.Circle({
                x: ecx + wR*Math.cos(a), y: ecy + wR*Math.sin(a),
                radius: 5, fill: col, opacity: 0.80,
            });
            // 对侧返回边（稍暗）
            const a2  = a + Math.PI;
            const dot2= new Konva.Circle({
                x: ecx + wR*Math.cos(a2), y: ecy + wR*Math.sin(a2),
                radius: 5, fill: col, opacity: 0.30,
            });
            this._staticGroup.add(dot, dot2);
        }

        // 气隙
        this._airGapR = Math.round(sInner * 0.97);
        this._staticGroup.add(new Konva.Circle({ x: ecx, y: ecy, radius: this._airGapR, fill: '#06101a', stroke: '#1a3040', strokeWidth: 0.5 }));

        // 霍尔传感器（3个，互差 120°，安装在定子内壁）
        const hallR    = this._airGapR - 5;
        const hallAngles = [-Math.PI/2, -Math.PI/2 + 2*Math.PI/3, -Math.PI/2 + 4*Math.PI/3];
        this._hallDots = [];
        hallAngles.forEach((a, i) => {
            const dot = new Konva.Circle({
                x: ecx + hallR*Math.cos(a), y: ecy + hallR*Math.sin(a),
                radius: 4, fill: '#37474f', stroke: '#ffd54f', strokeWidth: 1.2,
            });
            const lbl = new Konva.Text({ x: ecx + (hallR+8)*Math.cos(a)-6, y: ecy + (hallR+8)*Math.sin(a)-5, text: `H${i+1}`, fontSize: 7, fill: '#ffd54f' });
            this._hallDots.push(dot);
            this._staticGroup.add(dot, lbl);
        });
        this._hallAngles = hallAngles;

        // 轴孔
        this._staticGroup.add(new Konva.Circle({ x: ecx, y: ecy, radius: 8, fill: '#1a252f', stroke: '#37474f', strokeWidth: 1.5 }));

        // 三相出线 + 霍尔信号线（右侧端子）
        const termX = ex + ew + 10;
        [['U','#e53935',-24],['V','#43a047',0],['W','#1e88e5',24]].forEach(([l,c,dy]) => {
            this._staticGroup.add(new Konva.Line({ points: [ecx+sOuter*0.65,ecy+dy,termX,ecy+dy], stroke:c, strokeWidth:2 }));
            this._staticGroup.add(new Konva.Circle({ x:termX, y:ecy+dy, radius:3.5, fill:c }));
            this._staticGroup.add(new Konva.Text({ x:termX+5, y:ecy+dy-6, text:l, fontSize:9, fill:c, fontStyle:'bold' }));
        });
        [['H1',52],['H2',66],['H3',80]].forEach(([l,dy]) => {
            this._staticGroup.add(new Konva.Line({ points: [ecx+sOuter*0.5,ecy+dy,termX,ecy+dy], stroke:'#ffd54f', strokeWidth:1.5, dash:[3,3] }));
            this._staticGroup.add(new Konva.Circle({ x:termX, y:ecy+dy, radius:3, fill:'#ffd54f' }));
            this._staticGroup.add(new Konva.Text({ x:termX+5, y:ecy+dy-5, text:l, fontSize:8, fill:'#ffd54f' }));
        });

        // 直流母线（左侧）
        this._staticGroup.add(new Konva.Line({ points:[ex-14,ecy-20,ex+12,ecy-20], stroke:'#ef5350', strokeWidth:2 }));
        this._staticGroup.add(new Konva.Line({ points:[ex-14,ecy+20,ex+12,ecy+20], stroke:'#90caf9', strokeWidth:2 }));
        this._staticGroup.add(new Konva.Circle({ x:ex-14, y:ecy-20, radius:3, fill:'#ef5350' }));
        this._staticGroup.add(new Konva.Circle({ x:ex-14, y:ecy+20, radius:3, fill:'#90caf9' }));
        this._staticGroup.add(new Konva.Text({ x:ex-28, y:ecy-26, text:'+', fontSize:10, fill:'#ef5350', fontStyle:'bold' }));
        this._staticGroup.add(new Konva.Text({ x:ex-28, y:ecy+16, text:'−', fontSize:10, fill:'#90caf9', fontStyle:'bold' }));

        // 输出轴（底部）
        this._staticGroup.add(new Konva.Rect({ x:ecx-5, y:ey+eh, width:10, height:10, fill:'#78909c', stroke:'#546e7a', strokeWidth:1 }));

        this._sInner = sInner; this._sOuter = sOuter; this._frameR = frameR;
    }

    // ── 永磁体磁场层（随转子旋转） ──────────
    _drawMagnetLayer() {
        this._magnetGroup = new Konva.Group();
        this._staticGroup.add(this._magnetGroup);
    }

    // ── 转子层（永磁体，表贴式） ─────────────
    _drawRotorLayer() {
        const ecx = this._motCX, ecy = this._motCY;
        const rotorR  = Math.round(this._airGapR * 0.86);
        const magW    = Math.round(rotorR * 0.22);  // 磁钢弧宽
        const magH    = Math.round(rotorR * 0.15);  // 磁钢厚度

        this._rotorGroup = new Konva.Group({ x: ecx, y: ecy });

        // 转子铁芯（圆柱）
        this._rotorGroup.add(new Konva.Circle({ radius: rotorR, fill: '#37474f', stroke: '#263238', strokeWidth: 1.5 }));

        // 永磁体（表贴式，2p=4极，交替 N/S）
        const nPoles = this.polePairs * 2;
        for (let i = 0; i < nPoles; i++) {
            const a    = (i / nPoles) * Math.PI * 2 - Math.PI/2;
            const isN  = (i % 2 === 0);
            const magR = rotorR - magH / 2;
            const poly = this._arcRectPoints(0, 0, magR, magW, magH, a);
            this._rotorGroup.add(new Konva.Line({
                points: poly, closed: true,
                fill: isN ? '#ef9a9a' : '#90caf9',
                stroke: isN ? '#b71c1c' : '#0d47a1', strokeWidth: 0.8,
            }));
            // 极性标注
            this._rotorGroup.add(new Konva.Text({
                x: magR*Math.cos(a) - 5, y: magR*Math.sin(a) - 5,
                text: isN ? 'N' : 'S', fontSize: 9, fontStyle: 'bold',
                fill: isN ? '#ffcdd2' : '#bbdefb',
            }));
        }
        // 轴
        this._rotorGroup.add(new Konva.Circle({ radius: 8, fill: '#1a252f', stroke: '#37474f', strokeWidth: 1.5 }));
        // 参考点（观察旋转）
        this._rotorGroup.add(new Konva.Circle({ x: rotorR*0.55, y: 0, radius: 3, fill: '#ffd54f' }));

        this._staticGroup.add(this._rotorGroup);
        this._rotorR = rotorR;
    }

    // 弧形矩形顶点计算（用于磁钢可视化）
    _arcRectPoints(cx, cy, r, arcW, thick, angle) {
        const halfW = arcW / (2 * r);
        const pts   = [];
        // 外弧
        for (let a = angle - halfW; a <= angle + halfW; a += 0.05)
            pts.push(cx+(r+thick/2)*Math.cos(a), cy+(r+thick/2)*Math.sin(a));
        // 内弧（反向）
        for (let a = angle + halfW; a >= angle - halfW; a -= 0.05)
            pts.push(cx+(r-thick/2)*Math.cos(a), cy+(r-thick/2)*Math.sin(a));
        return pts;
    }

    // ── 三相逆变器拓扑（六开关桥） ──────────
    _drawInverterTopology() {
        const { _invX: ix, _invY: iy, _invW: iw, _invH: ih } = this;

        this._staticGroup.add(new Konva.Rect({ x:ix, y:iy, width:iw, height:ih, fill:'#010d18', stroke:'#1a3040', strokeWidth:1.5, cornerRadius:4 }));
        this._staticGroup.add(new Konva.Rect({ x:ix, y:iy, width:iw, height:13, fill:'#0a1a28', cornerRadius:[4,4,0,0] }));
        this._staticGroup.add(new Konva.Text({ x:ix+4, y:iy+2, width:iw-8, text:'三相逆变器（六步PWM换向）', fontSize:8, fontStyle:'bold', fill:'#80cbc4', align:'center' }));

        // 直流母线
        const busY_p = iy + 20, busY_n = iy + ih - 14;
        this._staticGroup.add(new Konva.Line({ points:[ix+8,busY_p,ix+iw-8,busY_p], stroke:'#ef5350', strokeWidth:2.5 }));
        this._staticGroup.add(new Konva.Line({ points:[ix+8,busY_n,ix+iw-8,busY_n], stroke:'#90caf9', strokeWidth:2.5 }));
        this._staticGroup.add(new Konva.Text({ x:ix+8, y:busY_p-10, text:`+${this.ratedVoltage}V`, fontSize:8, fill:'#ef5350' }));
        this._staticGroup.add(new Konva.Text({ x:ix+8, y:busY_n+3,  text:'GND', fontSize:8, fill:'#90caf9' }));

        // 三相桥（U/V/W），每相两个 MOSFET
        const phColors = ['#e53935','#43a047','#1e88e5'];
        const phLabels = ['U','V','W'];
        const colStep  = (iw - 24) / 3;
        this._mosfetGroups = [];

        for (let ph = 0; ph < 3; ph++) {
            const cx3 = ix + 12 + ph * colStep + colStep/2;
            const midY = (busY_p + busY_n) / 2;
            const col  = phColors[ph];

            // 相线（母线中点引出）
            this._staticGroup.add(new Konva.Line({ points:[cx3,busY_p+4,cx3,busY_n-4], stroke:'#546e7a', strokeWidth:1 }));
            // 相输出线
            this._staticGroup.add(new Konva.Line({ points:[cx3,midY,ix+iw+4,midY-24+ph*24], stroke:col, strokeWidth:1.5, dash:[3,3] }));

            // 高侧 MOSFET（上管）
            const hiY = (busY_p + midY) / 2;
            // 低侧 MOSFET（下管）
            const loY = (midY + busY_n) / 2;

            const mHi = this._drawMosfet(cx3, hiY, col, `${phLabels[ph]}H`);
            const mLo = this._drawMosfet(cx3, loY, col, `${phLabels[ph]}L`);
            this._mosfetGroups.push({ hi: mHi, lo: mLo, cx: cx3, midY, col });

            // 相标注
            this._staticGroup.add(new Konva.Text({ x:cx3-6, y:midY-6, text:phLabels[ph], fontSize:10, fill:col, fontStyle:'bold' }));
        }

        // PWM 占空比指示条
        const barY = iy + ih - 28;
        this._staticGroup.add(new Konva.Text({ x:ix+8, y:barY-10, text:'PWM 占空比:', fontSize:7.5, fill:'#546e7a' }));
        this._staticGroup.add(new Konva.Rect({ x:ix+8, y:barY, width:iw-16, height:8, fill:'#0a0a18', cornerRadius:2 }));
        this._pwmBar    = new Konva.Rect({ x:ix+8, y:barY, width:0, height:8, fill:'#ffa726', cornerRadius:2 });
        this._pwmBarW   = iw - 16;
        this._pwmTxt    = new Konva.Text({ x:ix+iw-52, y:barY-10, width:44, text:'0%', fontSize:8, fontFamily:'Courier New, monospace', fill:'#ffa726', align:'right' });
        this._staticGroup.add(this._pwmBar, this._pwmTxt);
    }

    // 绘制 MOSFET 符号（矩形 + 箭头）
    _drawMosfet(cx, cy, col, label) {
        const bg = new Konva.Rect({ x:cx-10, y:cy-8, width:20, height:16, fill:'#0d1a28', stroke:col, strokeWidth:1, cornerRadius:2 });
        const t  = new Konva.Text({ x:cx-10, y:cy-5, width:20, text:label, fontSize:6.5, fill:col, align:'center' });
        this._interactGroup.add(bg, t);
        return { bg, t, cx, cy, col };
    }

    // ── 六步换向逻辑表 ──────────────────────
    _drawCommutationTable() {
        const { _commX: cx, _commY: cy, _commW: cw, _commH: ch } = this;

        this._staticGroup.add(new Konva.Rect({ x:cx, y:cy, width:cw, height:ch, fill:'#010d18', stroke:'#1a3040', strokeWidth:1.5, cornerRadius:4 }));
        this._staticGroup.add(new Konva.Rect({ x:cx, y:cy, width:cw, height:13, fill:'#0a1a28', cornerRadius:[4,4,0,0] }));
        this._staticGroup.add(new Konva.Text({ x:cx+4, y:cy+2, width:cw-8, text:'六步换向表（霍尔状态→导通相）', fontSize:8, fontStyle:'bold', fill:'#80cbc4', align:'center' }));

        const steps = [
            { hall:'101', step:1, hi:'U+', lo:'W-', color:'#ef5350' },
            { hall:'100', step:2, hi:'U+', lo:'V-', color:'#ff8a65' },
            { hall:'110', step:3, hi:'W+', lo:'V-', color:'#ffd54f' },
            { hall:'010', step:4, hi:'W+', lo:'U-', color:'#66bb6a' },
            { hall:'011', step:5, hi:'V+', lo:'U-', color:'#4fc3f7' },
            { hall:'001', step:6, hi:'V+', lo:'W-', color:'#ce93d8' },
        ];

        const rowH = (ch - 28) / steps.length;
        // 表头
        const hY = cy + 15;
        [['步骤',0.06],['Hall',0.22],['高侧',0.42],['低侧',0.62],['状态',0.80]].forEach(([h,xr]) => {
            this._staticGroup.add(new Konva.Text({ x:cx+cw*xr, y:hY, text:h, fontSize:7.5, fill:'#546e7a', fontStyle:'bold' }));
        });
        this._staticGroup.add(new Konva.Line({ points:[cx+4, hY+10, cx+cw-4, hY+10], stroke:'#1a3040', strokeWidth:0.8 }));

        this._commRows = [];
        steps.forEach(({ hall, step, hi, lo, color }, i) => {
            const ry   = cy + 28 + i * rowH;
            const rowBg= new Konva.Rect({ x:cx+4, y:ry, width:cw-8, height:rowH-1, fill:'rgba(0,0,0,0)', cornerRadius:2 });
            this._staticGroup.add(rowBg);
            this._staticGroup.add(new Konva.Text({ x:cx+cw*0.06, y:ry+2, text:`${step}`, fontSize:9, fontStyle:'bold', fill:color }));
            this._staticGroup.add(new Konva.Text({ x:cx+cw*0.18, y:ry+2, text:hall,    fontSize:8, fill:'#ffd54f', fontFamily:'Courier New, monospace' }));
            this._staticGroup.add(new Konva.Text({ x:cx+cw*0.40, y:ry+2, text:hi,      fontSize:9, fontStyle:'bold', fill:'#ef9a9a' }));
            this._staticGroup.add(new Konva.Text({ x:cx+cw*0.60, y:ry+2, text:lo,      fontSize:9, fontStyle:'bold', fill:'#90caf9' }));
            const stDot= new Konva.Circle({ x:cx+cw*0.85, y:ry+rowH/2-1, radius:5, fill:'#263238', stroke:color, strokeWidth:1 });
            this._staticGroup.add(stDot);
            this._commRows.push({ bg: rowBg, dot: stDot, color });
        });

        // 当前换向步骤指针
        this._commPointer = new Konva.Text({ x:cx+4, y:cy+28, text:'▶', fontSize:10, fill:'#ffd54f' });
        this._staticGroup.add(this._commPointer);
        this._commRowH = rowH;
        this._commSteps = steps;
    }

    // ── T-n 特性曲线 ─────────────────────────
    _drawTNCurve() {
        const { _tnX: tx, _tnY: ty, _tnW: tw, _tnH: th } = this;

        this._staticGroup.add(new Konva.Rect({ x:tx, y:ty, width:tw, height:th, fill:'#010d18', stroke:'#1a3040', strokeWidth:1.5, cornerRadius:4 }));
        this._staticGroup.add(new Konva.Rect({ x:tx, y:ty, width:tw, height:13, fill:'#0a1a28', cornerRadius:[4,4,0,0] }));
        this._staticGroup.add(new Konva.Text({ x:tx+4, y:ty+2, width:tw-8, text:'T-n 特性曲线', fontSize:8, fontStyle:'bold', fill:'#80cbc4', align:'center' }));

        const ox = tx+14, oy = ty+th-12, aw = tw-20, ah = th-26;
        this._staticGroup.add(new Konva.Line({ points:[ox,oy-ah,ox,oy,ox+aw,oy], stroke:'#37474f', strokeWidth:0.8 }));
        this._staticGroup.add(new Konva.Text({ x:ox-12, y:oy-ah, text:'T', fontSize:7, fill:'#80cbc4' }));
        this._staticGroup.add(new Konva.Text({ x:ox+aw+2, y:oy+2, text:'n', fontSize:7, fill:'#80cbc4' }));

        // 不同占空比下的 T-n 曲线（BLDC 线性特性）
        const duties = [1.0, 0.75, 0.5, 0.25];
        const dColors= ['#ef9a9a','#ffa726','#ffd54f','#90caf9'];
        duties.forEach((D, di) => {
            const pts = [];
            const noLoadSpeed = D * this.ratedVoltage * this.Kv * 2*Math.PI/60; // rad/s
            const stallTorque = D * this.ratedVoltage / (this.R * 2) * this.Kt;
            for (let T = 0; T <= stallTorque; T += stallTorque/40) {
                const n = noLoadSpeed - T * this.R / (this.Kt**2);
                if (n < 0) break;
                const nx = ox + (n/this.syncOmegaMax)*aw;
                const ty2= oy - (T/this.maxTorque)*(ah-4);
                if (nx >= ox && nx <= ox+aw && ty2 >= ty+14 && ty2 <= oy) pts.push(nx, ty2);
            }
            if (pts.length > 4)
                this._staticGroup.add(new Konva.Line({ points:pts, stroke:dColors[di], strokeWidth:1.2, lineJoin:'round', opacity:0.65 }));
        });
        this._staticGroup.add(new Konva.Text({ x:ox+aw*0.6, y:ty+14, text:'D=100%', fontSize:6.5, fill:'#ef9a9a' }));
        this._staticGroup.add(new Konva.Text({ x:ox+aw*0.6, y:ty+23, text:'D=25%',  fontSize:6.5, fill:'#90caf9' }));

        // 额定工作点
        const rNX = ox + (this.ratedSpeed*2*Math.PI/60 / this.syncOmegaMax)*aw;
        const rTY = oy - (this.ratedTorque/this.maxTorque)*(ah-4);
        this._staticGroup.add(new Konva.Circle({ x:rNX, y:rTY, radius:3, fill:'#ffd54f', stroke:'#f9a825', strokeWidth:1 }));
        this._staticGroup.add(new Konva.Text({ x:rNX+3, y:rTY-9, text:'N', fontSize:6.5, fill:'#ffd54f' }));

        // 动态工作点
        this._tnPoint = new Konva.Circle({ x:ox, y:oy, radius:5, fill:'#66bb6a', stroke:'#2e7d32', strokeWidth:1.5 });
        this._staticGroup.add(this._tnPoint);
        this._tnOX = ox; this._tnOY = oy; this._tnAW = aw; this._tnAH = ah;
    }

    get syncOmegaMax() { return this.maxSpeed * 2*Math.PI/60; }

    // ── 效率 MAP（等高线简化版） ─────────────
    _drawEfficiencyMap() {
        const { _mapX: mx, _mapY: my, _mapW: mw, _mapH: mh } = this;

        this._staticGroup.add(new Konva.Rect({ x:mx, y:my, width:mw, height:mh, fill:'#010d18', stroke:'#1a3040', strokeWidth:1.5, cornerRadius:4 }));
        this._staticGroup.add(new Konva.Rect({ x:mx, y:my, width:mw, height:13, fill:'#0a1a28', cornerRadius:[4,4,0,0] }));
        this._staticGroup.add(new Konva.Text({ x:mx+4, y:my+2, width:mw-8, text:'效率 MAP（η%）', fontSize:8, fontStyle:'bold', fill:'#80cbc4', align:'center' }));

        const ox = mx+12, oy = my+mh-12, aw = mw-18, ah = mh-26;
        this._staticGroup.add(new Konva.Line({ points:[ox,oy-ah,ox,oy,ox+aw,oy], stroke:'#37474f', strokeWidth:0.8 }));
        this._staticGroup.add(new Konva.Text({ x:ox-10, y:oy-ah, text:'T', fontSize:7, fill:'#80cbc4' }));
        this._staticGroup.add(new Konva.Text({ x:ox+aw+2, y:oy+2, text:'n', fontSize:7, fill:'#80cbc4' }));

        // 绘制效率等高线（离散网格填色）
        const nRows = 12, nCols = 16;
        const cellW = aw / nCols, cellH = ah / nRows;
        for (let r = 0; r < nRows; r++) {
            for (let c = 0; c < nCols; c++) {
                const npu  = (c+0.5)/nCols;
                const tpu  = (r+0.5)/nRows;
                const eta  = this._calcEfficiency(npu, tpu);
                const col  = this._etaColor(eta);
                this._staticGroup.add(new Konva.Rect({
                    x: ox + c*cellW, y: oy - (r+1)*cellH,
                    width: cellW+0.5, height: cellH+0.5, fill: col, opacity: 0.7,
                }));
            }
        }
        // 效率等值线标注
        [[0.60,'#ef5350'],[0.75,'#ffa726'],[0.85,'#ffd54f'],[0.92,'#66bb6a'],[0.95,'#4fc3f7']].forEach(([eta, col]) => {
            const pts = this._calcContour(ox, oy, aw, ah, eta, nRows, nCols, cellW, cellH);
            if (pts.length > 4) {
                this._staticGroup.add(new Konva.Line({ points:pts, stroke:col, strokeWidth:1, lineJoin:'round', opacity:0.5 }));
                if (pts.length >= 4)
                    this._staticGroup.add(new Konva.Text({ x:pts[0]+2, y:pts[1]-8, text:`${(eta*100).toFixed(0)}%`, fontSize:6.5, fill:col }));
            }
        });

        // 动态工作点
        this._mapPoint = new Konva.Circle({ x:ox+aw*0.5, y:oy-ah*0.5, radius:5, fill:'#fff', stroke:'#000', strokeWidth:1.5 });
        this._staticGroup.add(this._mapPoint);
        this._mapOX = ox; this._mapOY = oy; this._mapAW = aw; this._mapAH = ah;
    }

    // 效率计算（简化模型）
    _calcEfficiency(npu, tpu) {
        const n   = npu * this.maxSpeed;
        const T   = tpu * this.maxTorque;
        const omega_r = n * 2*Math.PI/60;
        if (n < 10 || T < 0.001) return 0;
        const Pout = T * omega_r;
        const Veff = Math.min(this.ratedVoltage, omega_r/this.Kv/(2*Math.PI/60)*1.05 + T/this.Kt*this.R);
        const I_dc = Pout / (Veff + 1e-9);
        const Pcu  = I_dc**2 * this.R;
        const Pfric= 0.002 * this.maxTorque * omega_r;
        const Pin  = Pout + Pcu + Pfric;
        return Math.min(0.98, Math.max(0, Pout / (Pin+1e-9)));
    }

    // 效率颜色映射
    _etaColor(eta) {
        if (eta < 0.5)  return 'rgba(30,20,20,0.8)';
        if (eta < 0.70) return `rgba(${Math.round(80+eta*100)},20,20,0.7)`;
        if (eta < 0.85) return `rgba(${Math.round(200)},${Math.round((eta-0.70)*400)},20,0.7)`;
        if (eta < 0.92) return `rgba(${Math.round(255-(eta-0.85)*800)},${Math.round(200)},20,0.7)`;
        return `rgba(20,${Math.round(180+(eta-0.92)*800)},${Math.round(100+(eta-0.92)*1200)},0.7)`;
    }

    // 效率等值线（简化：找每列中 eta 阈值行）
    _calcContour(ox, oy, aw, ah, etaTarget, nR, nC, cW, cH) {
        const pts = [];
        for (let c = 0; c < nC-1; c++) {
            for (let r = 0; r < nR-1; r++) {
                const e00 = this._calcEfficiency((c+0.5)/nC, (r+0.5)/nR);
                const e10 = this._calcEfficiency((c+1.5)/nC, (r+0.5)/nR);
                if ((e00 < etaTarget) !== (e10 < etaTarget)) {
                    pts.push(ox + (c+1)*cW, oy - (r+0.5)*cH);
                }
            }
        }
        return pts;
    }

    // ── LCD 仪表 ─────────────────────────────
    _drawLCDPanel() {
        const { _lcdX: lx, _lcdY: ly, _lcdW: lw, _lcdH: lh } = this;

        this._staticGroup.add(new Konva.Rect({ x:lx, y:ly, width:lw, height:lh, fill:'#020c14', stroke:'#1a3040', strokeWidth:1.5, cornerRadius:4 }));
        this._staticGroup.add(new Konva.Rect({ x:lx, y:ly, width:lw, height:13, fill:'#0a1a28', cornerRadius:[4,4,0,0] }));
        this._staticGroup.add(new Konva.Text({ x:lx+4, y:ly+2, width:lw-8, text:'运行仪表', fontSize:8, fontStyle:'bold', fill:'#80cbc4', align:'center' }));

        const cells = [
            { label:'转速',    id:'spd',  unit:'rpm',  color:'#4fc3f7' },
            { label:'转矩',    id:'tq',   unit:'N·m',  color:'#ffd54f' },
            { label:'效率',    id:'eff',  unit:'%',    color:'#66bb6a' },
            { label:'输入P',   id:'pin',  unit:'W',    color:'#ef9a9a' },
            { label:'输出P',   id:'pout', unit:'W',    color:'#90caf9' },
            { label:'I_DC',    id:'idc',  unit:'A',    color:'#ffa726' },
            { label:'V_DC',    id:'vdc',  unit:'V',    color:'#80cbc4' },
            { label:'占空比',  id:'duty', unit:'%',    color:'#ffa726' },
            { label:'换向步',  id:'step', unit:'/6',   color:'#ce93d8' },
            { label:'Hall',    id:'hall', unit:'',     color:'#ffd54f' },
            { label:'脉动Trp', id:'trp',  unit:'%',    color:'#ff8a65' },
            { label:'方向',    id:'dir',  unit:'',     color:'#66bb6a' },
        ];

        const cellW = (lw-8)/3, cellH = 22, gap = 2;
        this._lcdCells = {};
        cells.forEach(({ label, id, unit, color }, i) => {
            const col = i%3, row = Math.floor(i/3);
            const cx3 = lx+4+col*(cellW+gap), cy3 = ly+16+row*(cellH+gap);
            this._staticGroup.add(new Konva.Rect({ x:cx3, y:cy3, width:cellW, height:cellH, fill:'#0d1520', cornerRadius:2 }));
            this._staticGroup.add(new Konva.Text({ x:cx3+2, y:cy3+2, text:label, fontSize:6.5, fill:'#37474f' }));
            const val = new Konva.Text({ x:cx3+2, y:cy3+9, width:cellW-4, text:'--', fontSize:9, fontFamily:'Courier New, monospace', fontStyle:'bold', fill:color, align:'right' });
            this._staticGroup.add(new Konva.Text({ x:cx3+2, y:cy3+14, width:cellW-4, text:unit, fontSize:6, fill:'#1a252f', align:'right' }));
            this._lcdCells[id] = val;
            this._staticGroup.add(val);
        });
    }

    // ── 控制面板 ─────────────────────────────
    _drawControlPanel() {
        const { _panX: px, _panY: py, _panW: pw, _panH: ph } = this;

        this._staticGroup.add(new Konva.Rect({ x:px, y:py, width:pw, height:ph, fill:'#0d1520', stroke:'#1a3040', strokeWidth:1.5, cornerRadius:4 }));
        this._staticGroup.add(new Konva.Rect({ x:px, y:py, width:pw, height:13, fill:'#0a1a28', cornerRadius:[4,4,0,0] }));
        this._staticGroup.add(new Konva.Text({ x:px+4, y:py+2, width:pw-8, text:'控制操作', fontSize:8, fontStyle:'bold', fill:'#80cbc4', align:'center' }));

        // 起动/停止
        const bW = (pw-16)/4-2, bH = 18, bY = py+16;
        [['▶ 起动','#1a3a1a','#2e7d32','#66bb6a',()=>this.start()],
         ['■ 停止','#3a1a1a','#c62828','#ef5350',()=>this.stop()],
         ['↺ 正转','#1a2a3a','#1565c0','#64b5f6',()=>{ this._direction=1; }],
         ['↻ 反转','#2a1a3a','#6a1b9a','#ce93d8',()=>{ this._direction=-1; }],
        ].forEach(([lbl,fill,stroke,col,cb],i) => {
            const bx = px+4+i*(bW+3);
            const btn= new Konva.Rect({ x:bx, y:bY, width:bW, height:bH, fill, stroke, strokeWidth:1.5, cornerRadius:3 });
            const t  = new Konva.Text({ x:bx, y:bY+4, width:bW, text:lbl, fontSize:9, fontStyle:'bold', fill:col, align:'center' });
            btn.on('click tap', cb);
            btn.on('mouseenter',()=>btn.opacity(0.75));
            btn.on('mouseleave',()=>btn.opacity(1));
            this._interactGroup.add(btn, t);
        });

        // 控制模式切换（速度模式/占空比模式）
        const modeX = px + pw - 90, modeY = py + 42;
        this._modeBtn = new Konva.Rect({ x:modeX, y:modeY, width:84, height:16, fill:'#1a3040', stroke:'#4fc3f7', strokeWidth:1, cornerRadius:3 });
        this._modeTxt = new Konva.Text({ x:modeX, y:modeY+3, width:84, text:'模式：速度控制', fontSize:8, fill:'#4fc3f7', align:'center' });
        this._modeBtn.on('click tap', () => {
            this._ctrlMode = this._ctrlMode === 'speed' ? 'duty' : 'speed';
            this._modeTxt.text(`模式：${this._ctrlMode==='speed'?'速度控制':'占空比'}`);
        });
        this._staticGroup.add(this._modeBtn, this._modeTxt);

        // 滑块
        const sliders = [
            { label:`目标转速（额定 ${this.ratedSpeed}rpm）`,   key:'spd', color:'#4fc3f7',
              getR:()=>this._targetSpeed/this.maxSpeed,
              set: r=>{ this._targetSpeed=r*this.maxSpeed; }, disp:()=>`${Math.round(this._targetSpeed)}rpm` },
            { label:`PWM 占空比 D（${(this._dutySet*100).toFixed(0)}%）`, key:'duty', color:'#ffa726',
              getR:()=>this._dutySet,
              set: r=>{ this._dutySet=r; }, disp:()=>`${(this._dutySet*100).toFixed(0)}%` },
            { label:`负载转矩（额定 ${this.ratedTorque.toFixed(2)}N·m）`, key:'load', color:'#ffd54f',
              getR:()=>this._loadTq/this.maxTorque,
              set: r=>{ this._loadTq=r*this.maxTorque; }, disp:()=>`${this._loadTq.toFixed(3)}N·m` },
        ];

        const slW = (pw - 16) / 2 - 32;
        this._sliderBars = {};
        sliders.forEach(({ label, key, color, getR, set, disp }, si) => {
            const col = si % 2, row = Math.floor(si / 2);
            const slX = px + 4 + col*(slW+46);
            const slY = py + 42 + row*26;
            this._staticGroup.add(new Konva.Text({ x:slX, y:slY-11, text:label, fontSize:7, fill:'#546e7a' }));
            this._staticGroup.add(new Konva.Rect({ x:slX, y:slY, width:slW, height:8, fill:'#0a0a18', cornerRadius:2 }));
            const bar = new Konva.Rect({ x:slX, y:slY, width:0, height:8, fill:color, cornerRadius:2 });
            const txt = new Konva.Text({ x:slX+slW+4, y:slY-2, width:44, text:'--', fontSize:8, fontFamily:'Courier New, monospace', fill:color });
            const hit = new Konva.Rect({ x:slX, y:slY-2, width:slW, height:12, fill:'transparent' });
            hit.on('click tap mousedown', e => {
                const stage = this.group.getStage?.();
                const pos   = stage?.getPointerPosition?.() ?? { x:e.evt?.clientX??0 };
                set(Math.max(0, Math.min(1, (pos.x-(this.group.x?.()??0)-slX)/slW)));
            });
            this._interactGroup.add(bar, txt, hit);
            this._sliderBars[key] = { bar, txt, slW, getR, disp };
        });
    }

    // ── 波形区（BEMF + 电流 + 霍尔信号） ────
    _drawWaveform() {
        const { _wavX: wx, _wavY: wy, _wavW: ww, _wavH: wh } = this;
        if (wh < 14) return;

        this._staticGroup.add(new Konva.Rect({ x:wx, y:wy, width:ww, height:wh, fill:'#010d18', stroke:'#1a3040', strokeWidth:1.5, cornerRadius:4 }));
        this._staticGroup.add(new Konva.Rect({ x:wx, y:wy, width:ww, height:12, fill:'#0a1a28', cornerRadius:[4,4,0,0] }));
        this._staticGroup.add(new Konva.Text({ x:wx+4, y:wy+1, width:ww-8, text:'反电动势（U/V/W 梯形波）   三相电流（U/V/W）   电磁转矩 T   霍尔信号 H1/H2/H3', fontSize:8, fill:'#80cbc4', align:'center' }));

        const nCh  = 4;
        const hCh  = (wh-12)/nCh;
        this._wavMids = Array.from({length:nCh}, (_,i) => wy+12+hCh*(i+0.5));
        this._wavMids.forEach(my => this._staticGroup.add(new Konva.Line({ points:[wx+2,my,wx+ww-2,my], stroke:'rgba(200,200,200,0.06)', strokeWidth:0.5, dash:[4,3] })));

        this._wLEU = new Konva.Line({ points:[], stroke:'#e53935', strokeWidth:1.5, lineJoin:'round' });
        this._wLEV = new Konva.Line({ points:[], stroke:'#43a047', strokeWidth:1.5, lineJoin:'round' });
        this._wLEW = new Konva.Line({ points:[], stroke:'#1e88e5', strokeWidth:1.5, lineJoin:'round' });
        this._wLIU = new Konva.Line({ points:[], stroke:'#ef9a9a', strokeWidth:1.5, lineJoin:'round' });
        this._wLIV = new Konva.Line({ points:[], stroke:'#a5d6a7', strokeWidth:1.5, lineJoin:'round' });
        this._wLIW = new Konva.Line({ points:[], stroke:'#90caf9', strokeWidth:1.5, lineJoin:'round' });
        this._wLT  = new Konva.Line({ points:[], stroke:'#ffd54f', strokeWidth:1.8, lineJoin:'round' });
        this._wLH1 = new Konva.Line({ points:[], stroke:'#ffd54f', strokeWidth:1.5, lineJoin:'round' });
        this._wLH2 = new Konva.Line({ points:[], stroke:'#ffa726', strokeWidth:1.5, lineJoin:'round' });
        this._wLH3 = new Konva.Line({ points:[], stroke:'#ff7043', strokeWidth:1.5, lineJoin:'round' });

        ['BEMF', 'I(uvw)', 'T_em', 'Hall'].forEach((l, i) => {
            this._staticGroup.add(new Konva.Text({ x:wx+4, y:wy+12+hCh*i+3, text:l, fontSize:8, fill:['#e53935','#ef9a9a','#ffd54f','#ffd54f'][i] }));
        });
        this._staticGroup.add(this._wLEU, this._wLEV, this._wLEW, this._wLIU, this._wLIV, this._wLIW, this._wLT, this._wLH1, this._wLH2, this._wLH3);
        this._wavHCh = hCh;
    }

    // ═══════════════════════════════════════════
    // 集中化 tick（由 consys._tickAll 在 20fps 调用）
    tick(dt) {
        this._tickPhysics(dt);
        this._tickRotorViz();
        this._tickMagnetViz();
        this._tickInverterViz();
        this._tickCommTableViz();
        this._tickTNPoint();
        this._tickMapPoint();
        this._tickWaveform(dt);
        this._tickDisplay();
        this._refreshCache();
    }
    // ── 物理仿真核心 ─────────────────────────
    _tickPhysics(dt) {
        if (!this._running) {
            // 停止时惯性减速
            const drag  = this.B * this._omega + (this._omega > 0 ? 0.01*this.ratedTorque : 0);
            this._omega = Math.max(0, this._omega - drag/this.J * dt);
            this._speed = this._omega * 60 / (2*Math.PI);
            this._updateAngles(dt);
            this.torqueEM   = 0;
            this.iU = this.iV = this.iW = 0;
            this.iDC = 0;
            this.power_in = this.power_out = this.efficiency = 0;
            this._updateWavBufs(dt);
            return;
        }

        // ── 速度 PI 控制器 ──
        if (this._ctrlMode === 'speed') {
            const err        = this._targetSpeed - this._speed;
            this._piIntg    += err * this._piKi * dt;
            this._piIntg     = Math.max(0, Math.min(1, this._piIntg));
            this._duty       = Math.max(0, Math.min(1, this._piKp * err + this._piIntg));
        } else {
            this._duty = this._dutySet;
        }

        // ── 霍尔传感器位置解码 ──
        const prevHall = this.hallState;
        this.hallState = this._calcHallState(this._thetaE);
        if (this.hallState !== prevHall) {
            this._commEvent = true;
            this._commEventTimer = 0.04;
        }
        if (this._commEventTimer > 0) this._commEventTimer -= dt;
        else this._commEvent = false;

        const comm = this._commTable[this.hallState] || this._commTable[0b101];
        this.commStep = comm.step;

        // ── 相电压（六步方波） ──
        const Vbus  = this.ratedVoltage * this._duty;
        const phV   = [0, 0, 0];
        phV[comm.hi] = +Vbus / 2;
        phV[comm.lo] = -Vbus / 2;
        [this.uU, this.uV, this.uW] = phV;

        // ── 反电动势（梯形波） ──
        const dir = this._direction;
        const aE  = this._thetaE * dir;
        this.eU   = this.Ke * this._omega * this._trapEMF(aE);
        this.eV   = this.Ke * this._omega * this._trapEMF(aE - 2*Math.PI/3);
        this.eW   = this.Ke * this._omega * this._trapEMF(aE + 2*Math.PI/3);

        // ── 相电流（RL 一阶，简化：稳态 i=(V-e)/R） ──
        const iRated = this.ratedCurrent;
        const iU_ss  = (this.uU - this.eU) / (this.R + 1e-9);
        const iV_ss  = (this.uV - this.eV) / (this.R + 1e-9);
        const iW_ss  = (this.uW - this.eW) / (this.R + 1e-9);
        const tauE   = this.tauE;
        this.iU += (iU_ss - this.iU) * (1 - Math.exp(-dt/tauE));
        this.iV += (iV_ss - this.iV) * (1 - Math.exp(-dt/tauE));
        this.iW += (iW_ss - this.iW) * (1 - Math.exp(-dt/tauE));

        // ── 电磁转矩 ──
        const omega_r = Math.max(1e-3, this._omega);
        this.torqueEM = (this.eU*this.iU + this.eV*this.iV + this.eW*this.iW) / omega_r;

        // 转矩脉动（换向时约 15%）
        const rippleBase = 0.05 + (this._commEvent ? 0.12 : 0);
        this.torqueRipple = rippleBase * 100;

        // ── 机械运动方程 ──
        const friction = this.B * this._omega;
        const netTorque= this.torqueEM * dir - this._loadTq - friction;
        this._omega   += (netTorque / this.J) * dt;
        this._omega    = Math.max(0, Math.min(this.syncOmegaMax, this._omega));
        this._speed    = this._omega * 60 / (2*Math.PI);

        // ── 功率/效率 ──
        this.iDC       = Math.abs(this.iU*(this.uU>0?1:0) + this.iV*(this.uV>0?1:0) + this.iW*(this.uW>0?1:0));
        this.power_in  = this.ratedVoltage * this._duty * this.iDC;
        this.power_out = this.torqueEM * this._omega;
        this.efficiency= this.power_in > 0.1 ? Math.min(98, this.power_out/this.power_in*100) : 0;

        this._updateAngles(dt);
        this._updateWavBufs(dt);
    }

    // 梯形波反电动势函数（[-1,1]，平顶宽 120°）
    _trapEMF(theta) {
        const t = ((theta % (Math.PI*2)) + Math.PI*2) % (Math.PI*2);
        const deg = t * 180 / Math.PI;
        if (deg < 60)          return deg / 60;
        if (deg < 120)         return 1.0;
        if (deg < 180)         return (180 - deg) / 60;
        if (deg < 240)         return -(deg - 180) / 60;
        if (deg < 300)         return -1.0;
        return -(360 - deg) / 60;
    }

    // 霍尔传感器状态计算（基于电角度）
    _calcHallState(thetaE) {
        const t   = ((thetaE % (Math.PI*2)) + Math.PI*2) % (Math.PI*2);
        const seg = Math.floor(t / (Math.PI/3));
        // 标准六步：101,100,110,010,011,001
        const hallSeq = [0b101, 0b100, 0b110, 0b010, 0b011, 0b001];
        return hallSeq[seg % 6];
    }

    _updateAngles(dt) {
        this._thetaE  += this._omega * this.polePairs * dt * this._direction;
        this._thetaM  += this._omega * dt * this._direction;
        this._thetaE   = ((this._thetaE % (Math.PI*2)) + Math.PI*2) % (Math.PI*2);
    }

    _updateWavBufs(dt) {
        const ePk  = Math.max(0.01, this.Ke * this._omega);
        const iPk  = Math.max(0.01, this.ratedCurrent);
        const hall = this.hallState;

        this._wavEU  = new Float32Array([...this._wavEU.slice(1),  this.eU]);
        this._wavEV  = new Float32Array([...this._wavEV.slice(1),  this.eV]);
        this._wavEW  = new Float32Array([...this._wavEW.slice(1),  this.eW]);
        this._wavIU  = new Float32Array([...this._wavIU.slice(1),  this.iU]);
        this._wavIV  = new Float32Array([...this._wavIV.slice(1),  this.iV]);
        this._wavIW  = new Float32Array([...this._wavIW.slice(1),  this.iW]);
        this._wavT   = new Float32Array([...this._wavT.slice(1),   this.torqueEM]);
        this._wavH1  = new Float32Array([...this._wavH1.slice(1),  (hall>>2)&1]);
        this._wavH2  = new Float32Array([...this._wavH2.slice(1),  (hall>>1)&1]);
        this._wavH3  = new Float32Array([...this._wavH3.slice(1),   hall&1]);
    }

    // ── 转子旋转动画 ─────────────────────────
    _tickRotorViz() {
        if (this._rotorGroup) {
            this._rotorGroup.rotation(this._thetaM * 180 / Math.PI);
        }
    }

    // ── 气隙磁场（永磁体磁力线随转子转） ────
    _tickMagnetViz() {
        this._magnetGroup.destroyChildren();
        const ecx = this._motCX, ecy = this._motCY;
        const r0  = this._rotorR * 0.90;
        const r1  = this._sInner * 0.94;
        const nPoles = this.polePairs * 2;
        for (let i = 0; i < nPoles; i++) {
            const aBase = this._thetaM + (i / nPoles) * Math.PI * 2;
            const isN   = (i % 2 === 0);
            const alpha = Math.min(0.55, 0.55 * Math.abs(this._omega / this.syncOmegaMax));
            if (alpha < 0.02) continue;
            for (let j = -1; j <= 1; j++) {
                const a = aBase + j * Math.PI / (nPoles * 2);
                const col = isN ? `rgba(239,154,154,${alpha*(1-Math.abs(j)*0.4)})` : `rgba(144,202,249,${alpha*(1-Math.abs(j)*0.4)})`;
                this._magnetGroup.add(new Konva.Line({
                    points: [ecx+r0*Math.cos(a), ecy+r0*Math.sin(a), ecx+r1*Math.cos(a), ecy+r1*Math.sin(a)],
                    stroke: col, strokeWidth: 1.5 - Math.abs(j)*0.5, lineCap: 'round',
                }));
            }
        }

        // 霍尔传感器状态更新（高亮当前触发的传感器）
        const hall = this.hallState;
        this._hallDots?.forEach((dot, i) => {
            const active = (hall >> (2 - i)) & 1;
            dot.fill(active ? '#ffd54f' : '#37474f');
            dot.radius(active ? 5.5 : 4);
        });
    }

    // ── 逆变器开关状态高亮 ───────────────────
    _tickInverterViz() {
        if (!this._mosfetGroups) return;
        const comm = this._commTable[this.hallState] || this._commTable[0b101];
        this._mosfetGroups.forEach((mg, ph) => {
            const hiOn = (ph === comm.hi);
            const loOn = (ph === comm.lo);
            mg.hi.bg.fill(hiOn ? '#1a3a1a' : '#0d1a28');
            mg.hi.bg.stroke(hiOn ? '#66bb6a' : mg.hi.col);
            mg.lo.bg.fill(loOn ? '#3a1a1a' : '#0d1a28');
            mg.lo.bg.stroke(loOn ? '#ef5350' : mg.lo.col);
        });
        // PWM 条
        if (this._pwmBar) this._pwmBar.width(this._duty * this._pwmBarW);
        if (this._pwmTxt) this._pwmTxt.text(`${(this._duty*100).toFixed(0)}%`);
    }

    // ── 换向表当前步骤高亮 ───────────────────
    _tickCommTableViz() {
        if (!this._commRows) return;
        const step = this.commStep - 1;  // 0~5
        this._commRows.forEach((row, i) => {
            const active = (i === step);
            row.bg.fill(active ? `rgba(${this._stepColors[i].slice(1).match(/../g).map(h=>parseInt(h,16)).join(',')},0.15)` : 'rgba(0,0,0,0)');
            row.dot.fill(active ? this._stepColors[i] : '#263238');
            row.dot.radius(active ? 6.5 : 5);
        });
        if (this._commPointer) {
            this._commPointer.y(this._commY + 28 + step * this._commRowH + 2);
        }
    }

    // ── T-n 工作点 ───────────────────────────
    _tickTNPoint() {
        if (!this._tnPoint) return;
        const nx = this._tnOX + (this._omega / this.syncOmegaMax) * this._tnAW;
        const ty = this._tnOY - (Math.abs(this.torqueEM) / this.maxTorque) * (this._tnAH-4);
        this._tnPoint.x(Math.max(this._tnOX, Math.min(this._tnOX+this._tnAW, nx)));
        this._tnPoint.y(Math.max(this._tnY+14, Math.min(this._tnOY, ty)));
        this._tnPoint.fill(this.efficiency>85?'#66bb6a':this.efficiency>60?'#ffa726':'#ef5350');
    }

    // ── 效率 MAP 工作点 ──────────────────────
    _tickMapPoint() {
        if (!this._mapPoint) return;
        const npu = this._omega / this.syncOmegaMax;
        const tpu = Math.abs(this.torqueEM) / this.maxTorque;
        const mx  = Math.max(this._mapOX, Math.min(this._mapOX+this._mapAW, this._mapOX + npu*this._mapAW));
        const my  = Math.max(this._mapOY-this._mapAH+2, Math.min(this._mapOY, this._mapOY - tpu*this._mapAH));
        this._mapPoint.x(mx); this._mapPoint.y(my);
    }

    // ── 波形更新 ─────────────────────────────
    _tickWaveform() {
        if (!this._wavHCh || !this._wavMids) return;
        const wx = this._wavX+3, ww = this._wavW-6, n = this._wavLen;
        const dx = ww/n, hCh = this._wavHCh;
        const [mE, mI, mT, mH] = this._wavMids;

        const ePk = Math.max(0.1, this.Ke * this.syncOmegaMax);
        const iPk = Math.max(0.1, this.ratedCurrent * 1.5);
        const tPk = Math.max(0.01, this.maxTorque);
        const hH  = hCh * 0.36;

        const ptEU=[], ptEV=[], ptEW=[], ptIU=[], ptIV=[], ptIW=[], ptT=[], ptH1=[], ptH2=[], ptH3=[];
        for (let i = 0; i < n; i++) {
            const x = wx+i*dx;
            ptEU.push(x, mE - (this._wavEU[i]/ePk)*hCh*0.36);
            ptEV.push(x, mE - (this._wavEV[i]/ePk)*hCh*0.36);
            ptEW.push(x, mE - (this._wavEW[i]/ePk)*hCh*0.36);
            ptIU.push(x, mI - (this._wavIU[i]/iPk)*hCh*0.36);
            ptIV.push(x, mI - (this._wavIV[i]/iPk)*hCh*0.36);
            ptIW.push(x, mI - (this._wavIW[i]/iPk)*hCh*0.36);
            ptT.push(x,  mT - (this._wavT[i] /tPk)*hCh*0.38);
            ptH1.push(x, mH - (this._wavH1[i] > 0.5 ? hH*0.7 : -hH*0.1));
            ptH2.push(x, mH - (this._wavH2[i] > 0.5 ? hH*0.4 : -hH*0.1) - hCh*0.1);
            ptH3.push(x, mH - (this._wavH3[i] > 0.5 ? hH*0.7 : -hH*0.1) - hCh*0.2);
        }
        this._wLEU.points(ptEU); this._wLEV.points(ptEV); this._wLEW.points(ptEW);
        this._wLIU.points(ptIU); this._wLIV.points(ptIV); this._wLIW.points(ptIW);
        this._wLT.points(ptT);
        this._wLH1.points(ptH1); this._wLH2.points(ptH2); this._wLH3.points(ptH3);
    }

    // ── 仪表显示 ─────────────────────────────
    _tickDisplay() {
        const c = this._lcdCells;
        if (!c) return;

        const hallBin = this.hallState.toString(2).padStart(3,'0');
        if (c.spd)  c.spd.text(Math.round(this._speed).toString());
        if (c.tq) { c.tq.text(Math.abs(this.torqueEM).toFixed(3));
                    c.tq.fill(Math.abs(this.torqueEM)>this.ratedTorque*1.1?'#ef5350':'#ffd54f'); }
        if (c.eff) { c.eff.text(this.efficiency.toFixed(1));
                     c.eff.fill(this.efficiency>85?'#66bb6a':this.efficiency>60?'#ffa726':'#ef5350'); }
        if (c.pin)   c.pin.text(this.power_in.toFixed(0));
        if (c.pout)  c.pout.text(this.power_out.toFixed(0));
        if (c.idc)   c.idc.text(this.iDC.toFixed(2));
        if (c.vdc)   c.vdc.text((this.ratedVoltage * this._duty).toFixed(1));
        if (c.duty)  c.duty.text((this._duty*100).toFixed(0));
        if (c.step) { c.step.text(`${this.commStep}`);
                      c.step.fill(this._stepColors[(this.commStep-1)%6]); }
        if (c.hall)  c.hall.text(hallBin);
        if (c.trp) { c.trp.text(this.torqueRipple.toFixed(0));
                     c.trp.fill(this.torqueRipple>12?'#ef5350':'#66bb6a'); }
        if (c.dir)  { c.dir.text(this._direction>0?'↺正转':'↻反转');
                      c.dir.fill(this._direction>0?'#66bb6a':'#ce93d8'); }

        if (this._sliderBars) {
            Object.values(this._sliderBars).forEach(({ bar, txt, slW, getR, disp }) => {
                bar.width(Math.min(slW, Math.max(0, getR())*slW));
                txt.text(disp());
            });
        }
    }

    // ═══════════════════════════════════════════
    start() {
        if (!this._running) {
            this._running  = true;
            this._piIntg   = this._duty;
        }
    }

    stop() {
        this._running = false;
    }

    setSpeed(rpm) {
        this._targetSpeed = Math.max(0, Math.min(this.maxSpeed, rpm));
        this._ctrlMode    = 'speed';
        this._refreshCache();
    }

    setDuty(d) {
        this._dutySet  = Math.max(0, Math.min(1, d));
        this._ctrlMode = 'duty';
        this._refreshCache();
    }

    setLoad(T) {
        this._loadTq = Math.max(0, Math.min(this.maxTorque * 1.2, T));
        this._refreshCache();
    }

    setDirection(dir) {
        this._direction = dir >= 0 ? 1 : -1;
        this._refreshCache();
    }

    getSpeed()    { return this._speed; }
    getTorque()   { return this.torqueEM; }
    getEfficiency(){ return this.efficiency; }
    isRunning()   { return this._running; }

    update(cfg = {}) {
        if (cfg.speed !== undefined) this.setSpeed(cfg.speed);
        if (cfg.duty  !== undefined) this.setDuty(cfg.duty);
        if (cfg.load  !== undefined) this.setLoad(cfg.load);
        if (cfg.dir   !== undefined) this.setDirection(cfg.dir);
        this._refreshCache();
    }

    getConfigFields() {
        return [
            { label: '位号/名称',              key: 'id',           type: 'text'   },
            { label: '额定功率 (W)',            key: 'ratedPower',   type: 'number' },
            { label: '直流母线电压 (V)',        key: 'ratedVoltage', type: 'number' },
            { label: '额定转速 (rpm)',          key: 'ratedSpeed',   type: 'number' },
            { label: 'KV 值 (rpm/V)',           key: 'Kv',           type: 'number' },
            { label: '极对数',                 key: 'polePairs',    type: 'number' },
            { label: '相电阻 R (Ω)',           key: 'R',            type: 'number' },
            { label: '相电感 L (mH)',           key: 'L',            type: 'number' },
            { label: '转动惯量 J (kg·m²)',     key: 'J',            type: 'number' },
            { label: '最大转矩 (N·m)',          key: 'maxTorque',    type: 'number' },
            { label: '初始占空比 D',            key: 'initDuty',     type: 'number' },
        ];
    }

    onConfigUpdate(cfg) {
        this.id           = cfg.id           || this.id;
        this.ratedPower   = parseFloat(cfg.ratedPower)   || this.ratedPower;
        this.ratedVoltage = parseFloat(cfg.ratedVoltage) || this.ratedVoltage;
        this.ratedSpeed   = parseFloat(cfg.ratedSpeed)   || this.ratedSpeed;
        this.Kv           = parseFloat(cfg.Kv)           || this.Kv;
        this.polePairs    = parseInt(cfg.polePairs)       || this.polePairs;
        this.R            = parseFloat(cfg.R)            || this.R;
        this.L            = parseFloat(cfg.L) * 1e-3     || this.L;
        this.J            = parseFloat(cfg.J)            || this.J;
        this.maxTorque    = parseFloat(cfg.maxTorque)    || this.maxTorque;
        this.Ke           = 1 / (this.Kv * 2*Math.PI/60);
        this.Kt           = this.Ke;
        this.tauE         = this.L / this.R;
        this.ratedTorque  = this.ratedPower / (this.ratedSpeed * 2*Math.PI/60);
        this.ratedCurrent = this.ratedPower / this.ratedVoltage / 0.9;
        this.config       = { ...this.config, ...cfg };
        this._refreshCache();
    }

    destroy() {
        super.destroy?.();
    }
}