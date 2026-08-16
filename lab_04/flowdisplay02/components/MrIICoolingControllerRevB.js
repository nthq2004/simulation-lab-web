import { BaseComponent } from './BaseComponent.js';

/**
 * MR-II 型电动气缸冷却水温度控制系统仿真组件  ── Rev.B
 * （T802 NTC 热敏电阻 + PWM 调制器驱动继电器版本）
 *
 * ── 版本说明（Rev.B 相对 Rev.A 的变更）────────────────────────
 *
 *  1. 测温元件：Pt100 RTD  →  T802 NTC 热敏电阻
 *  2. 信号调理：惠斯通电桥 → NTC 分压网络 + Steinhart-Hart 线性化
 *  3. 执行链路：直接继电器  →  PD 输出 → PWM 调制器 → 继电器驱动
 *  4. 新增 PWM 可视化区：占空比波形 + 频率/占空比数字显示
 *
 * ── 系统组成（Rev.B 六单元）─────────────────────────────────────
 *
 *  1. T802 NTC 热敏电阻测温单元（Thermistor Sensing Unit）
 *     ─────────────────────────────────────────────────────────
 *     T802 是船舶机舱仪表中常用的 NTC（负温度系数）热敏电阻探头：
 *       - 标称阻值 R₂₅ = 10 kΩ（25°C 时）
 *       - 热敏指数  β   = 3950 K（25/50°C 量程段）
 *       - 工作范围：0 ~ 150°C（机舱冷却水应用）
 *       - 壳体：不锈钢护套，直插式，G1/2 螺纹安装
 *       - 响应时间：τ ≈ 8 s（液体中）
 *       - 相比 Pt100 的优势：
 *           ① 灵敏度更高（同温度变化下电阻变化量更大）
 *           ② 导线电阻影响可忽略（高阻抗，无需 3/4 线补偿）
 *           ③ 成本更低，机械强度好
 *       - 缺点：非线性（需 Steinhart-Hart 方程或查表线性化）
 *
 *     NTC 电阻-温度关系（Steinhart-Hart B-参数简化式）：
 *       R(T) = R₂₅ · exp[ β · (1/T - 1/T₂₅) ]
 *       T(R) = 1 / { ln(R/R₂₅)/β + 1/T₂₅ }  − 273.15
 *
 *     测量电路：恒流分压网络
 *       +Vcc(5V) ─── Rref(10kΩ固定) ─── T802(RNTC) ─── GND
 *       测量点 Vmeas = Vcc × RNTC / (Rref + RNTC)
 *       温度越高 → RNTC 越小 → Vmeas 越低（反向特性）
 *
 *  2. 测量/线性化板（MRT板）
 *     - ADC（12位）采样 Vmeas
 *     - 软件查表或 Steinhart-Hart 计算，输出线性化温度值
 *     - 零点（ZERO）旋钮：±5°C 数字偏移
 *     - 量程（SPAN）旋钮：0.8 ~ 1.2 倍增益修正
 *
 *  3. 比例微分控制器（MRV板 / PD Controller）
 *     - TU1：测量信号缓冲（低阻抗输出）
 *     - TU2：偏差计算  e(t) = SP - T_meas
 *     - TU3：PD 运算（同相加法放大器）
 *         u(t) = Kp·e(t) + Kp·Td·de(t)/dt    范围：−Umax ~ +Umax
 *     - 不灵敏区比较器：|u| < δ_threshold → 输出归零
 *     - 输出：−5V ~ +5V 模拟控制电压 → 送 PWM 调制器
 *
 *  4. PWM 调制器（PWM Modulator，新增单元）★
 *     ─────────────────────────────────────────────────────────
 *     将 PD 控制器的 −5V ~ +5V 连续模拟输出，转换为 PWM 脉冲信号
 *     来驱动继电器，实现"软化"的比例继电器动作：
 *
 *     工作原理：
 *       · 三角波发生器（载波，f_pwm = 2 Hz，周期 T = 500 ms）
 *         产生 0~5V 三角波作为比较基准
 *       · 比较器将 |u_pd| 与三角波比较，输出方波
 *         占空比 D = |u_pd| / Umax × 100%
 *       · 方波驱动对应方向（INC 或 DEC）的继电器线圈
 *
 *     等效效果：
 *       · D = 0%：继电器始终断开（死区内，阀门保持）
 *       · D = 50%：继电器通/断各 250 ms，阀门缓慢移动
 *       · D = 100%：继电器持续通电，阀门全速转动
 *       · 实现了从"位式控制"到"准比例控制"的升级
 *       · 减少阀门电机启停冲击，延长执行机构寿命
 *
 *     参数：
 *       - 载波频率 f_pwm：0.5 ~ 5 Hz（可调，面板旋钮）
 *       - 最小脉冲宽度 Tmin：50 ms（防止继电器过快颤振）
 *       - 死区（Dead Band）：D < 5% 时强制输出 0
 *
 *  5. 继电器执行电路（MRC板）
 *     - INC 继电器：PWM_INC 信号驱动 → 电动阀向冷却侧
 *     - DEC 继电器：PWM_DEC 信号驱动 → 电动阀向旁路侧
 *     - 硬件互锁：INC/DEC 继电器线圈串联对方的常闭辅助触头
 *     - 限位保护：0% / 100% 阀位强制关断对应继电器
 *
 *  6. 电动三通调节阀（Motorized 3-Way Valve）
 *     - 可逆单相电动机（220VAC）+ 蜗轮减速器
 *     - 全程行程时间：60 s（连续通电时）
 *     - PWM 等效平均速度：v_avg = v_full × D
 *     - 阀位电位器反馈：0 ~ 5V → 0 ~ 100%
 *
 * ── 控制回路信号流 ───────────────────────────────────────────
 *
 *  T802(NTC) → Vmeas → ADC → S-H线性化 → T_meas
 *                                              ↓
 *  SP_knob ─────────────────────────────→ e = SP - T_meas
 *                                              ↓
 *                              PD运算: u = Kp(e + Td·ė)
 *                                              ↓
 *                      PWM调制: D = |u|/Umax, 方向=sign(u)
 *                                              ↓
 *           D>0, u>0 → INC_PWM → 继电器INC → 阀门→冷却侧
 *           D>0, u<0 → DEC_PWM → 继电器DEC → 阀门→旁路侧
 *           D=0     → 两继电器断开 → 阀门保持
 *
 * ── 视觉结构（正视图·七区面板）────────────────────────────────
 *
 *  ┌──────────────────────────────────────────────────────┐
 *  │  铭牌：MR-II Rev.B / 位号 / T802 NTC / 0~100°C       │
 *  ├──────────────────────────────────────────────────────┤
 *  │ ╔════════════════════════════════════════════════╗   │
 *  │ ║  仪表盘（PV红色指针 + SP绿色标线）               ║   │
 *  │ ║  NTC 分压波形（Vmeas 随温度变化的曲线）           ║   │
 *  │ ╚════════════════════════════════════════════════╝   │
 *  │ ┌─────────────────────────────────────────────────┐  │
 *  │ │ [ZERO旋钮] [SPAN旋钮]  T802阻值显示  Vmeas显示   │  │
 *  │ └─────────────────────────────────────────────────┘  │
 *  │ ┌─────────────────────────────────────────────────┐  │
 *  │ │ [SP旋钮]  [P Band旋钮]  [Td旋钮]   偏差条       │  │
 *  │ └─────────────────────────────────────────────────┘  │
 *  │ ┌─────────────────────────────────────────────────┐  │ ← 新增
 *  │ │ PWM波形区：INC_PWM / DEC_PWM 占空比波形可视化    │  │
 *  │ │ 频率旋钮  占空比数显  脉冲宽度显示               │  │
 *  │ └─────────────────────────────────────────────────┘  │
 *  │ ┌─────────────────────────────────────────────────┐  │
 *  │ │ MRC：INC指示灯  阀位进度条  DEC指示灯            │  │
 *  │ └─────────────────────────────────────────────────┘  │
 *  │ ┌─────────────────────────────────────────────────┐  │
 *  │ │ PCB剖视（MRT / MRV / PWM / MRC 四块板）          │  │
 *  │ └─────────────────────────────────────────────────┘  │
 *  ├──────────────────────────────────────────────────────┤
 *  │  接线端子：NTC+  NTC-  PWR  INC  DEC  GND           │
 *  └──────────────────────────────────────────────────────┘
 *
 * ── 端口 ─────────────────────────────────────────────────────
 *  port_ntc_pos    — NTC+ 热敏电阻正端（T802 接线端）
 *  port_ntc_neg    — NTC- 热敏电阻负端
 *  port_power      — 控制电源（220VAC / 24VDC）
 *  port_output_inc — INC PWM 输出（→ 电动阀 INC 线圈）
 *  port_output_dec — DEC PWM 输出（→ 电动阀 DEC 线圈）
 *  port_gnd        — 公共地
 */
export class MrIICoolingControllerRevB extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.width  = Math.max(240, config.width  || 280);
        this.height = Math.max(400, config.height || 440);

        this.type    = 'mr_ii_cooling_controller_revb';
        this.special = 'none';
        this.cache   = 'fixed';

        this._initGroups();
        // ── 铭牌 ──────────────────────────────────────────────
        this.label      = config.label      || 'TIC-201';
        this.model      = config.model      || 'MR-II Rev.B';
        this.pvRangeMin = config.pvRangeMin || 0;
        this.pvRangeMax = config.pvRangeMax || 100;
        this.supplyVolt = config.supplyVolt || 220;

        // ── T802 NTC 热敏电阻参数 ─────────────────────────────
        this.ntcR25  = config.ntcR25  || 10000;   // Ω，25°C 标称阻值
        this.ntcBeta = config.ntcBeta || 3950;    // K，热敏指数 β
        this.ntcRref = config.ntcRref || 10000;   // Ω，分压上拉电阻
        this.ntcVcc  = config.ntcVcc  || 5.0;     // V，分压电源

        // ── PD 控制参数 ──────────────────────────────────────
        this.spTemp   = this._clamp(config.spTemp  || 75, this.pvRangeMin, this.pvRangeMax);
        this.pBand    = this._clamp(config.pBand   || 80, 5, 200);
        this.tdTime   = this._clamp(config.tdTime  || 0.5, 0, 2);
        this.deadBand = this._clamp(config.deadBand || 1.0, 0.1, 5);
        this.zeroAdj  = this._clamp(config.zeroAdj || 0, -5, 5);
        this.spanAdj  = this._clamp(config.spanAdj || 1.0, 0.8, 1.2);

        // ── PWM 调制器参数 ★新增 ─────────────────────────────
        this.pwmFreq    = this._clamp(config.pwmFreq  || 2.0, 0.5, 5); // Hz
        this.pwmMinDuty = config.pwmMinDuty || 0.05;   // 最小有效占空比（死区）
        this.pwmUmax    = config.pwmUmax    || 5.0;    // V，PD 输出满量程

        // ── 过程变量 ──────────────────────────────────────────
        this._pv         = config.initPV !== undefined ? config.initPV : this.spTemp - 2;
        this._pvDisplay  = this._pv;
        this._ntcR       = this._tempToNtcR(this._pv);    // T802 实时阻值
        this._vmeas      = this._ntcRtoVmeas(this._ntcR); // 分压点电压
        this._error      = 0;
        this._prevError  = 0;
        this._pdOutput   = 0;   // −Umax ~ +Umax V

        // PWM 状态
        this._pwmDuty    = 0;   // 0~1，由 |pdOutput| 决定
        this._pwmDir     = 0;   // +1=INC, -1=DEC, 0=保持
        this._pwmPhase   = 0;   // 三角波相位 0~1
        this._pwmState   = false; // 当前 PWM 周期内继电器是否通电

        // 继电器状态（由 PWM 驱动）
        this._incActive  = false;
        this._decActive  = false;

        // 阀门
        this._valvePos   = config.initValve !== undefined ? config.initValve : 0.50;
        this._valveSpeed = config.valveSpeed !== undefined ? config.valveSpeed : 1 / 60;

        // ── 动画状态 ──────────────────────────────────────────
        this._animTime  = 0;
        this._glowPulse = 0;
        this._pcbAnim   = 0;
        this._pwmWaveHistory = new Array(60).fill(0); // PWM 波形历史（滚动）
        this._ntcWaveHistory = new Array(40).fill(0); // Vmeas 历史
        this._dragging  = null;

        // ── 几何布局 ──────────────────────────────────────────
        const W = this.width, H = this.height;

        this._shell   = { x: W*0.03, y: H*0.04, w: W*0.94, h: H*0.92, rx: 6 };

        // 表盘（含 NTC Vmeas 小波形）
        this._dialRect = { x: W*0.07, y: H*0.08, w: W*0.86, h: H*0.22 };
        this._dialCx   = W * 0.50;
        this._dialCy   = this._dialRect.y + this._dialRect.h * 0.78;
        this._dialR    = Math.min(W * 0.37, this._dialRect.h * 0.95);

        // NTC 信号区（表盘右侧内嵌小图）
        this._ntcSigRect = {
            x: W*0.70, y: this._dialRect.y + 4,
            w: W*0.22, h: this._dialRect.h * 0.45,
        };

        // 零点/量程旋钮区
        this._adjZone  = { x: W*0.07, y: H*0.32, w: W*0.86, h: H*0.085 };
        this._zeroKnob = { x: W*0.18, y: H*0.36,  r: W*0.052 };
        this._spanKnob = { x: W*0.40, y: H*0.36,  r: W*0.052 };

        // PD 参数旋钮区
        this._pdZone   = { x: W*0.07, y: H*0.415, w: W*0.86, h: H*0.085 };
        this._spKnob   = { x: W*0.18, y: H*0.455, r: W*0.052 };
        this._pKnob    = { x: W*0.50, y: H*0.455, r: W*0.052 };
        this._tdKnob   = { x: W*0.82, y: H*0.455, r: W*0.052 };

        // PWM 调制器区 ★
        this._pwmRect  = { x: W*0.07, y: H*0.51,  w: W*0.86, h: H*0.115 };
        this._freqKnob = { x: W*0.14, y: H*0.555, r: W*0.048 };

        // MRC 继电器区
        this._mrcRect  = { x: W*0.07, y: H*0.635, w: W*0.86, h: H*0.085 };

        // PCB 剖视
        this._pcbRect  = { x: W*0.07, y: H*0.73,  w: W*0.86, h: H*0.10 };

        // 接线端子
        this._tbRect   = { x: W*0.07, y: H*0.84,  w: W*0.86, h: H*0.075 };

        this._init();

        // 端口
        const tb = this._tbRect, pH = H * 0.96;
        this.addPort(tb.x + tb.w*0.08, pH, 'port_ntc_pos',    'wire', 'NTC+');
        this.addPort(tb.x + tb.w*0.24, pH, 'port_ntc_neg',    'wire', 'NTC-');
        this.addPort(tb.x + tb.w*0.45, pH, 'port_power',      'wire', 'PWR');
        this.addPort(tb.x + tb.w*0.64, pH, 'port_output_inc', 'wire', 'INC');
        this.addPort(tb.x + tb.w*0.80, pH, 'port_output_dec', 'wire', 'DEC');
        this.addPort(tb.x + tb.w*0.94, pH, 'port_gnd',        'wire', 'GND');
    }

    // ═══════════════════════════════════════════════════════════
    // 工具函数
    _clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
    _clamp01(v)        { return this._clamp(v, 0, 1); }
    _lerp(a, b, t)     { return a + (b - a) * t; }
    _norm(v)           { return (v - this.pvRangeMin) / (this.pvRangeMax - this.pvRangeMin); }

    // T802 NTC：温度(°C) → 电阻(Ω)
    _tempToNtcR(tempC) {
        const T    = tempC + 273.15;
        const T25  = 298.15;
        return this.ntcR25 * Math.exp(this.ntcBeta * (1 / T - 1 / T25));
    }

    // T802 NTC：电阻(Ω) → 温度(°C)
    _ntcRtoTemp(R) {
        const T25 = 298.15;
        return 1 / (Math.log(R / this.ntcR25) / this.ntcBeta + 1 / T25) - 273.15;
    }

    // NTC 电阻 → 分压电压
    _ntcRtoVmeas(R) {
        return this.ntcVcc * R / (this.ntcRref + R);
    }

    // ═══════════════════════════════════════════════════════════
    _init() {
        this._drawShell();
        this._drawDial();
        this._drawAdjZone();
        this._drawPDZone();
        this._drawPWMZoneStatic();
        this._drawMRCZone();
        this._drawPCBSection();
        this._drawTerminalBlock();
        this._drawTopLabel();
        this._buildDynamic();
        
    }

    // ── 外壳 ─────────────────────────────────────────────────
    _drawShell() {
        const s = this._shell, W = this.width;
        this._staticGroup.add(new Konva.Rect({
            x: s.x, y: s.y, width: s.w, height: s.h,
            fillLinearGradientStartPoint: { x:0, y:0 },
            fillLinearGradientEndPoint:   { x:s.w, y:0 },
            fillLinearGradientColorStops: [
                0,   '#1e2430', 0.10,'#363e52',
                0.50,'#404860', 0.90,'#363e52', 1,'#1e2430',
            ],
            stroke:'#14181f', strokeWidth:1.5,
            cornerRadius:s.rx,
            shadowColor:'#000', shadowBlur:10, shadowOffsetY:4, shadowOpacity:0.50,
        }));
        this._staticGroup.add(new Konva.Rect({
            x:s.x+3, y:s.y+3, width:s.w-6, height:s.h*0.025,
            fill:'rgba(255,255,255,0.08)', cornerRadius:[s.rx,s.rx,0,0],
        }));
        for (let i=1; i<=5; i++) {
            this._staticGroup.add(new Konva.Line({
                points:[s.x+s.w*i/6, s.y+6, s.x+s.w*i/6, s.y+s.h-6],
                stroke:'rgba(255,255,255,0.03)', strokeWidth:0.5,
            }));
        }
        const sR = W*0.018;
        [[s.x+12,s.y+10],[s.x+s.w-12,s.y+10],
         [s.x+12,s.y+s.h-10],[s.x+s.w-12,s.y+s.h-10]].forEach(([x,y])=>{
            this._staticGroup.add(new Konva.Circle({x,y,radius:sR,fill:'#7888a0',stroke:'#404858',strokeWidth:0.6}));
            this._staticGroup.add(new Konva.Line({points:[x-sR*0.65,y,x+sR*0.65,y],stroke:'#1e2838',strokeWidth:0.8,lineCap:'round'}));
            this._staticGroup.add(new Konva.Line({points:[x,y-sR*0.65,x,y+sR*0.65],stroke:'#1e2838',strokeWidth:0.8,lineCap:'round'}));
        });
        this._staticGroup.add(new Konva.Rect({
            x:s.x+s.w-78, y:s.y+s.h-18, width:74, height:14,
            fill:'#b0982c', stroke:'#786418', strokeWidth:0.8, cornerRadius:2,
        }));
        this._staticGroup.add(new Konva.Text({
            x:s.x+s.w-76, y:s.y+s.h-15, width:70,
            text:'MR-II Rev.B  T802 NTC', fontSize:5.5, fill:'#1e1200',
            fontStyle:'bold', align:'center',
        }));
    }

    // ── 表盘 ─────────────────────────────────────────────────
    _drawDial() {
        const dr=this._dialRect, cx=this._dialCx, cy=this._dialCy, R=this._dialR;
        this._staticGroup.add(new Konva.Rect({
            x:dr.x, y:dr.y, width:dr.w, height:dr.h,
            fill:'#06080c', stroke:'#1a2030', strokeWidth:1.2, cornerRadius:5,
        }));
        this._staticGroup.add(new Konva.Arc({
            x:cx, y:cy, innerRadius:R*0.62, outerRadius:R,
            angle:220, rotation:-110,
            fill:'#0c1018', stroke:'#1e2840', strokeWidth:0.6,
        }));
        // 高温危险区 (80~100°C)
        const hi80ang = -110 + 0.80*220;
        this._staticGroup.add(new Konva.Arc({
            x:cx, y:cy, innerRadius:R*0.62, outerRadius:R,
            angle:220*0.20, rotation:hi80ang,
            fill:'rgba(200,40,40,0.22)',
        }));
        // 刻度
        for (let i=0; i<=50; i++) {
            const f=i/50, ang=(-110+f*220)*Math.PI/180, isM=i%5===0;
            const r0=R*(isM?0.65:0.72), r1=R*0.83;
            this._staticGroup.add(new Konva.Line({
                points:[cx+Math.cos(ang)*r0,cy+Math.sin(ang)*r0,
                        cx+Math.cos(ang)*r1,cy+Math.sin(ang)*r1],
                stroke:isM?'#b8c8e0':'#445060', strokeWidth:isM?1.2:0.5, lineCap:'round',
            }));
            if (isM) {
                const val=Math.round(this.pvRangeMin+f*(this.pvRangeMax-this.pvRangeMin));
                const nr=R*0.55;
                this._staticGroup.add(new Konva.Text({
                    x:cx+Math.cos(ang)*nr-10, y:cy+Math.sin(ang)*nr-5, width:20,
                    text:val.toString(), fontSize:6, fill:'#90a8c0', align:'center',
                }));
            }
        }
        this._staticGroup.add(new Konva.Text({
            x:cx-20, y:cy-R*0.32, width:40,
            text:'°C', fontSize:9, fill:'#7888a8', fontStyle:'bold', align:'center',
        }));
        this._staticGroup.add(new Konva.Circle({
            x:cx, y:cy, radius:R*0.058,
            fill:'#303848', stroke:'#505870', strokeWidth:0.8,
        }));
        this._staticGroup.add(new Konva.Text({
            x:cx-24, y:cy-R*0.16, width:48,
            text:this.model, fontSize:7, fill:'rgba(140,160,190,0.40)',
            fontStyle:'bold', align:'center',
        }));
        // NTC 信号小窗（静态框）
        const ns=this._ntcSigRect;
        this._staticGroup.add(new Konva.Rect({
            x:ns.x, y:ns.y, width:ns.w, height:ns.h,
            fill:'#060a10', stroke:'#1e3040', strokeWidth:0.7, cornerRadius:2,
        }));
        this._staticGroup.add(new Konva.Text({
            x:ns.x+2, y:ns.y+2, text:'Vmeas', fontSize:5, fill:'rgba(100,200,150,0.45)', fontStyle:'bold',
        }));
    }

    // ── 零点/量程区（静态）───────────────────────────────────
    _drawAdjZone() {
        const az=this._adjZone;
        this._staticGroup.add(new Konva.Rect({
            x:az.x, y:az.y, width:az.w, height:az.h,
            fill:'#0c1018', stroke:'#1a2838', strokeWidth:0.7, cornerRadius:3,
        }));
        this._staticGroup.add(new Konva.Text({
            x:az.x+4, y:az.y+3, text:'— T802 NTC  MEAS ADJ —',
            fontSize:5.5, fill:'rgba(100,200,150,0.40)', fontStyle:'bold italic',
        }));
        // NTC 阻值/电压显示框（右侧）
        this._staticGroup.add(new Konva.Rect({
            x:az.x+az.w*0.56, y:az.y+4, width:az.w*0.42, height:az.h-8,
            fill:'#050810', stroke:'#1e3040', strokeWidth:0.5, cornerRadius:2,
        }));
        this._staticGroup.add(new Konva.Text({
            x:az.x+az.w*0.56+2, y:az.y+az.h-9, width:az.w*0.42-4,
            text:'R(NTC)Ω | Vmeas V',
            fontSize:5, fill:'rgba(100,200,150,0.40)', align:'center',
        }));
        ['ZERO','SPAN'].forEach((lbl,i)=>{
            const k = i===0 ? this._zeroKnob : this._spanKnob;
            this._staticGroup.add(new Konva.Circle({
                x:k.x, y:k.y, radius:k.r*1.18,
                fill:'#08090e', stroke:'#2030480', strokeWidth:0.8,
            }));
            this._staticGroup.add(new Konva.Text({
                x:k.x-20, y:az.y+az.h-9, width:40,
                text:lbl, fontSize:5.5, fill:'#607080', align:'center', fontStyle:'bold',
            }));
        });
    }

    // ── PD 旋钮区（静态）────────────────────────────────────
    _drawPDZone() {
        const pz=this._pdZone;
        this._staticGroup.add(new Konva.Rect({
            x:pz.x, y:pz.y, width:pz.w, height:pz.h,
            fill:'#0c1018', stroke:'#1a2838', strokeWidth:0.7, cornerRadius:3,
        }));
        this._staticGroup.add(new Konva.Text({
            x:pz.x+4, y:pz.y+3, text:'— PD CONTROLLER (MRV) —',
            fontSize:5.5, fill:'rgba(140,180,220,0.35)', fontStyle:'bold italic',
        }));
        const defs=[
            {k:this._spKnob,  lbl:'SET PT °C'},
            {k:this._pKnob,   lbl:'P BAND %' },
            {k:this._tdKnob,  lbl:'Td min'   },
        ];
        defs.forEach(({k,lbl})=>{
            this._staticGroup.add(new Konva.Circle({
                x:k.x, y:k.y, radius:k.r*1.18,
                fill:'#08090e', stroke:'#243040', strokeWidth:0.8,
            }));
            this._staticGroup.add(new Konva.Text({
                x:k.x-22, y:pz.y+pz.h-9, width:44,
                text:lbl, fontSize:5.5, fill:'#607090', align:'center', fontStyle:'bold',
            }));
        });

        // 偏差条（右侧）
        const bx=pz.x+pz.w*0.67, by=pz.y+4, bw=pz.w*0.30, bh=pz.h-8;
        this._staticGroup.add(new Konva.Rect({
            x:bx, y:by, width:bw, height:bh,
            fill:'#050810', stroke:'#1a2838', strokeWidth:0.5, cornerRadius:2,
        }));
        this._staticGroup.add(new Konva.Line({
            points:[bx+bw/2,by+2,bx+bw/2,by+bh-2],
            stroke:'rgba(255,255,255,0.12)', strokeWidth:0.6, dash:[2,2],
        }));
        this._staticGroup.add(new Konva.Text({
            x:bx, y:by+bh+1, width:bw, text:'ERR',
            fontSize:5, fill:'#506070', align:'center',
        }));
    }

    // ── PWM 调制器区（静态框）────────────────────────────────
    _drawPWMZoneStatic() {
        const pr=this._pwmRect;
        this._staticGroup.add(new Konva.Rect({
            x:pr.x, y:pr.y, width:pr.w, height:pr.h,
            fill:'#080c10', stroke:'#1e2c20', strokeWidth:0.8, cornerRadius:3,
        }));
        this._staticGroup.add(new Konva.Text({
            x:pr.x+4, y:pr.y+3, text:'— PWM MODULATOR ★ —',
            fontSize:5.5, fill:'rgba(80,220,120,0.45)', fontStyle:'bold italic',
        }));
        // 频率旋钮外环
        const fk=this._freqKnob;
        this._staticGroup.add(new Konva.Circle({
            x:fk.x, y:fk.y, radius:fk.r*1.18,
            fill:'#060810', stroke:'#203028', strokeWidth:0.8,
        }));
        this._staticGroup.add(new Konva.Text({
            x:fk.x-20, y:pr.y+pr.h-9, width:40,
            text:'f_PWM Hz', fontSize:5.5, fill:'#407058', align:'center', fontStyle:'bold',
        }));
        // INC/DEC 波形框
        const wh=pr.h*0.52, wy=pr.y+pr.h*0.18;
        const wx1=pr.x+pr.w*0.30, wx2=pr.x+pr.w*0.60;
        const ww=pr.w*0.26;
        [wx1,wx2].forEach((wx,i)=>{
            this._staticGroup.add(new Konva.Rect({
                x:wx, y:wy, width:ww, height:wh,
                fill:'#040610', stroke:'#1a2828', strokeWidth:0.5, cornerRadius:2,
            }));
            this._staticGroup.add(new Konva.Text({
                x:wx, y:wy+wh+1, width:ww,
                text:i===0?'INC_PWM':'DEC_PWM',
                fontSize:5, fill:i===0?'#30a850':'#a83030', align:'center',
            }));
        });
    }

    // ── MRC 继电器区（静态）──────────────────────────────────
    _drawMRCZone() {
        const mr=this._mrcRect;
        this._staticGroup.add(new Konva.Rect({
            x:mr.x, y:mr.y, width:mr.w, height:mr.h,
            fill:'#060810', stroke:'#1a2030', strokeWidth:0.7, cornerRadius:3,
        }));
        this._staticGroup.add(new Konva.Text({
            x:mr.x+4, y:mr.y+3, text:'— RELAY OUTPUT (MRC) —',
            fontSize:5.5, fill:'rgba(180,160,80,0.35)', fontStyle:'bold italic',
        }));
        // 阀位标签
        this._staticGroup.add(new Konva.Text({
            x:mr.x+mr.w*0.37, y:mr.y+mr.h-9, width:mr.w*0.25,
            text:'VALVE %', fontSize:5.5, fill:'#7080a0', align:'center',
        }));
        this._staticGroup.add(new Konva.Text({
            x:mr.x+mr.w*0.06, y:mr.y+mr.h-9, width:28,
            text:'INC▲', fontSize:5.5, fill:'#50a860', align:'center', fontStyle:'bold',
        }));
        this._staticGroup.add(new Konva.Text({
            x:mr.x+mr.w*0.72, y:mr.y+mr.h-9, width:28,
            text:'▼DEC', fontSize:5.5, fill:'#c05040', align:'center', fontStyle:'bold',
        }));
    }

    // ── PCB 剖视（四块板）────────────────────────────────────
    _drawPCBSection() {
        const pr=this._pcbRect;
        this._staticGroup.add(new Konva.Rect({
            x:pr.x, y:pr.y, width:pr.w, height:pr.h,
            fill:'#040608', stroke:'#141c20', strokeWidth:0.7, cornerRadius:3,
        }));
        this._staticGroup.add(new Konva.Text({
            x:pr.x+4, y:pr.y+2, text:'— PCB SECTION —',
            fontSize:5.5, fill:'rgba(80,180,80,0.35)', fontStyle:'bold italic',
        }));
        const boards=[
            {lbl:'MRT',color:'#1e3a1e',tc:'#50b050',x:pr.x+pr.w*0.02},
            {lbl:'MRV',color:'#1e3030',tc:'#30a0a0',x:pr.x+pr.w*0.26},
            {lbl:'PWM',color:'#1a3020',tc:'#40c070',x:pr.x+pr.w*0.52},  // ★新板
            {lbl:'MRC',color:'#2e2410',tc:'#b09018',x:pr.x+pr.w*0.76},
        ];
        const bw=pr.w*0.21, bh=pr.h*0.58, by=pr.y+pr.h*0.22;
        boards.forEach(({lbl,color,tc,x})=>{
            this._staticGroup.add(new Konva.Rect({
                x, y:by, width:bw, height:bh,
                fill:color, stroke:'rgba(0,0,0,0.3)', strokeWidth:0.5, cornerRadius:2,
            }));
            for (let r=0;r<2;r++) for (let c=0;c<4;c++) {
                this._staticGroup.add(new Konva.Rect({
                    x:x+bw*0.08+c*bw*0.22, y:by+bh*0.18+r*bh*0.35,
                    width:bw*0.12, height:bh*0.15,
                    fill:'rgba(180,160,80,0.50)', cornerRadius:0.5,
                }));
            }
            this._staticGroup.add(new Konva.Text({
                x, y:by+bh+2, width:bw,
                text:lbl, fontSize:6.5, fill:tc, align:'center', fontStyle:'bold',
            }));
        });
    }

    // ── 接线端子排 ───────────────────────────────────────────
    _drawTerminalBlock() {
        const tb=this._tbRect;
        this._staticGroup.add(new Konva.Rect({
            x:tb.x, y:tb.y, width:tb.w, height:tb.h,
            fill:'#07090f', stroke:'#181e28', strokeWidth:0.6, cornerRadius:[0,0,4,4],
        }));
        [
            {frac:0.08, lbl:'NTC+', color:'#60c080'},
            {frac:0.24, lbl:'NTC-', color:'#60c080'},
            {frac:0.45, lbl:'PWR',  color:'#d08030'},
            {frac:0.64, lbl:'INC',  color:'#50b860'},
            {frac:0.80, lbl:'DEC',  color:'#d05040'},
            {frac:0.94, lbl:'GND',  color:'#6070a0'},
        ].forEach(({frac,lbl,color})=>{
            const px=tb.x+tb.w*frac, py=tb.y+3;
            this._staticGroup.add(new Konva.Rect({
                x:px-4.5, y:py, width:9, height:7,
                fill:'#585868', stroke:'#303848', strokeWidth:0.5, cornerRadius:1,
            }));
            this._staticGroup.add(new Konva.Circle({x:px, y:py+3.5, radius:2.2, fill:'#14181e'}));
            this._staticGroup.add(new Konva.Text({
                x:px-12, y:py+8, width:24, text:lbl,
                fontSize:5, fill:color, align:'center',
            }));
        });
    }

    // ── 铭牌 ─────────────────────────────────────────────────
    _drawTopLabel() {
        const W=this.width;
        this._staticGroup.add(new Konva.Text({
            x:0, y:-16, width:W,
            text:`${this.label}  ${this.model}  T802 NTC  ${this.pvRangeMin}~${this.pvRangeMax}°C`,
            fontSize:8, fontStyle:'bold', fill:'#507080', align:'center',
        }));
    }

    // ═══════════════════════════════════════════════════════════
    // 动态图层
    _buildDynamic() {
        this._dynGroup = new Konva.Group();
        this._staticGroup.add(this._dynGroup);
        this._rebuildDynamic();
    }

    _rebuildDynamic() {
        this._dynGroup.destroyChildren();
        this._drawPointers();
        this._drawNTCSignal();
        this._drawAdjKnobs();
        this._drawPDKnobs();
        this._drawErrorBar();
        this._drawPWMZoneDynamic();   // ★
        this._drawRelayStatus();
        this._drawPCBAnimation();
    }

    // ── 指针 ─────────────────────────────────────────────────
    _drawPointers() {
        const cx=this._dialCx, cy=this._dialCy, R=this._dialR;
        const SA=-110, TA=220;
        const pvF=this._clamp01(this._norm(this._pvDisplay));
        const spF=this._clamp01(this._norm(this.spTemp));
        const glow=this._glowPulse;

        const spAng=(SA+spF*TA)*Math.PI/180;
        this._dynGroup.add(new Konva.Line({
            points:[cx+Math.cos(spAng)*R*0.64,cy+Math.sin(spAng)*R*0.64,
                    cx+Math.cos(spAng)*R*0.98,cy+Math.sin(spAng)*R*0.98],
            stroke:'#22ee66', strokeWidth:2.0, lineCap:'round',
        }));
        this._dynGroup.add(new Konva.Circle({
            x:cx+Math.cos(spAng)*R*0.94, y:cy+Math.sin(spAng)*R*0.94,
            radius:2.5, fill:'#22ee66',
            shadowColor:'#22ee66', shadowBlur:5, shadowOpacity:0.8,
        }));

        const pvAng=(SA+pvF*TA)*Math.PI/180;
        this._dynGroup.add(new Konva.Line({
            points:[cx,cy,cx+Math.cos(pvAng)*R*0.88,cy+Math.sin(pvAng)*R*0.88],
            stroke:'rgba(255,60,60,0.15)', strokeWidth:6+glow*3, lineCap:'round',
        }));
        this._dynGroup.add(new Konva.Arrow({
            points:[cx,cy,cx+Math.cos(pvAng)*R*0.88,cy+Math.sin(pvAng)*R*0.88],
            stroke:'#ff3030', fill:'#ff3030',
            strokeWidth:1.8, pointerLength:5, pointerWidth:3, lineCap:'round',
        }));
        this._dynGroup.add(new Konva.Line({
            points:[cx,cy,cx+Math.cos(pvAng+Math.PI)*R*0.11,cy+Math.sin(pvAng+Math.PI)*R*0.11],
            stroke:'#ff3030', strokeWidth:1.5, lineCap:'round',
        }));
        this._dynGroup.add(new Konva.Circle({
            x:cx, y:cy, radius:R*0.055,
            fill:'#d0c050', stroke:'#807020', strokeWidth:0.8,
        }));
        this._dynGroup.add(new Konva.Text({
            x:cx-36, y:cy-R*0.26, width:72,
            text:`PV: ${this._pvDisplay.toFixed(1)}°C`,
            fontSize:6.5, fill:'#ff8070', align:'center', fontStyle:'bold',
        }));
        this._dynGroup.add(new Konva.Text({
            x:cx-36, y:cy-R*0.13, width:72,
            text:`SP: ${this.spTemp.toFixed(1)}°C`,
            fontSize:6.5, fill:'#22ee66', align:'center', fontStyle:'bold',
        }));
    }

    // ── T802 NTC 信号显示（Vmeas 滚动波形）─────────────────
    _drawNTCSignal() {
        const ns=this._ntcSigRect;
        const pts=[];
        const hist=this._ntcWaveHistory;
        const len=hist.length;
        for (let i=0;i<len;i++) {
            const x=ns.x+2+(i/(len-1))*(ns.w-4);
            const y=ns.y+ns.h-4 - hist[i]*(ns.h-8);
            pts.push(x,y);
        }
        if (pts.length>=4) {
            this._dynGroup.add(new Konva.Line({
                points:pts, stroke:'rgba(60,220,140,0.75)',
                strokeWidth:1, lineCap:'round', lineJoin:'round',
            }));
        }
        // 当前阻值和电压数值
        const az=this._adjZone;
        const bx=az.x+az.w*0.56+4, by=az.y+8;
        const rKOhm=(this._ntcR/1000).toFixed(2);
        const vm=this._vmeas.toFixed(3);
        this._dynGroup.add(new Konva.Text({
            x:bx, y:by, width:az.w*0.40,
            text:`${rKOhm}kΩ`, fontSize:7, fill:'#50d090', fontStyle:'bold', align:'center',
        }));
        this._dynGroup.add(new Konva.Text({
            x:bx, y:by+10, width:az.w*0.40,
            text:`${vm}V`, fontSize:7, fill:'#40b080', fontStyle:'bold', align:'center',
        }));
    }

    // ── 旋钮绘制（通用）─────────────────────────────────────
    _drawKnob(k, frac, color) {
        const r=k.r;
        const ang=(-150+frac*300)*Math.PI/180;
        this._dynGroup.add(new Konva.Circle({
            x:k.x, y:k.y, radius:r,
            fillRadialGradientStartPoint:{x:-r*0.3,y:-r*0.3},
            fillRadialGradientStartRadius:0,
            fillRadialGradientEndPoint:{x:0,y:0},
            fillRadialGradientEndRadius:r,
            fillRadialGradientColorStops:[0,'#686878',0.6,'#44505c',1,'#242c38'],
            stroke:'#141c28', strokeWidth:0.8,
        }));
        for (let i=0;i<=10;i++) {
            const a=(-150+i*30)*Math.PI/180;
            const tick=i%5===0?r*0.22:r*0.12;
            this._dynGroup.add(new Konva.Line({
                points:[k.x+Math.cos(a)*(r*0.82),k.y+Math.sin(a)*(r*0.82),
                        k.x+Math.cos(a)*(r*0.82-tick),k.y+Math.sin(a)*(r*0.82-tick)],
                stroke:'rgba(150,170,200,0.32)',strokeWidth:i%5===0?0.9:0.5,
            }));
        }
        this._dynGroup.add(new Konva.Line({
            points:[k.x+Math.cos(ang)*r*0.28,k.y+Math.sin(ang)*r*0.28,
                    k.x+Math.cos(ang)*r*0.80,k.y+Math.sin(ang)*r*0.80],
            stroke:color, strokeWidth:1.8, lineCap:'round',
        }));
        this._dynGroup.add(new Konva.Circle({x:k.x,y:k.y,radius:r*0.12,fill:color,opacity:0.7}));
    }

    _drawAdjKnobs() {
        this._drawKnob(this._zeroKnob, (this.zeroAdj-(-5))/10, '#70a0c0');
        this._dynGroup.add(new Konva.Text({
            x:this._zeroKnob.x-16, y:this._zeroKnob.y-6, width:32,
            text:(this.zeroAdj>=0?'+':'')+this.zeroAdj.toFixed(1),
            fontSize:6.5, fill:'#70a0c0', align:'center', fontStyle:'bold',
        }));
        this._drawKnob(this._spanKnob, (this.spanAdj-0.8)/0.4, '#a0b070');
        this._dynGroup.add(new Konva.Text({
            x:this._spanKnob.x-16, y:this._spanKnob.y-6, width:32,
            text:'×'+this.spanAdj.toFixed(2),
            fontSize:6.5, fill:'#a0b070', align:'center', fontStyle:'bold',
        }));
    }

    _drawPDKnobs() {
        const kDefs=[
            {k:this._spKnob, val:this.spTemp, min:this.pvRangeMin, max:this.pvRangeMax, color:'#40d080'},
            {k:this._pKnob,  val:this.pBand,  min:5,  max:200, color:'#70a8d8'},
            {k:this._tdKnob, val:this.tdTime, min:0,  max:2,   color:'#c09050'},
        ];
        kDefs.forEach(({k,val,min,max,color})=>{
            const f=(val-min)/(max-min);
            this._drawKnob(k, f, color);
            const dv=max<=2?val.toFixed(2):Math.round(val).toString();
            this._dynGroup.add(new Konva.Text({
                x:k.x-16, y:k.y-6, width:32,
                text:dv, fontSize:6.5, fill:color, align:'center', fontStyle:'bold',
            }));
        });
    }

    // ── 偏差条 ───────────────────────────────────────────────
    _drawErrorBar() {
        const pz=this._pdZone;
        const bx=pz.x+pz.w*0.67, by=pz.y+4, bw=pz.w*0.30, bh=pz.h-8;
        const cx=bx+bw/2, midY=by+bh/2;
        const e=this._error, maxE=10;
        const ef=this._clamp(e/maxE,-1,1);
        if (ef>0.01) {
            this._dynGroup.add(new Konva.Rect({
                x:cx, y:midY-3, width:ef*(bw/2-2), height:6,
                fill:'#c83030', cornerRadius:1,
            }));
        } else if (ef<-0.01) {
            this._dynGroup.add(new Konva.Rect({
                x:cx+ef*(bw/2-2), y:midY-3, width:-ef*(bw/2-2), height:6,
                fill:'#3070c8', cornerRadius:1,
            }));
        }
        this._dynGroup.add(new Konva.Line({
            points:[cx,by+2,cx,by+bh-2],
            stroke:'rgba(255,240,80,0.45)', strokeWidth:0.8,
        }));
        const db=this._clamp(this.deadBand/maxE,0,0.45);
        [1,-1].forEach(d=>{
            this._dynGroup.add(new Konva.Line({
                points:[cx+d*db*(bw/2-2),by+2,cx+d*db*(bw/2-2),by+bh-2],
                stroke:'rgba(255,200,0,0.28)', strokeWidth:0.5, dash:[2,2],
            }));
        });
        this._dynGroup.add(new Konva.Text({
            x:bx, y:midY-5, width:bw,
            text:(e>=0?'+':'')+e.toFixed(1),
            fontSize:6.5,
            fill:e>this.deadBand?'#c83030':e<-this.deadBand?'#3070c8':'#90a890',
            align:'center', fontStyle:'bold',
        }));
    }

    // ── PWM 调制器动态区 ★ ──────────────────────────────────
    _drawPWMZoneDynamic() {
        const pr=this._pwmRect;

        // 频率旋钮
        const fk=this._freqKnob;
        const ff=(this.pwmFreq-0.5)/4.5;
        this._drawKnob(fk, ff, '#40c870');
        this._dynGroup.add(new Konva.Text({
            x:fk.x-16, y:fk.y-6, width:32,
            text:this.pwmFreq.toFixed(1)+'Hz',
            fontSize:6.5, fill:'#40c870', align:'center', fontStyle:'bold',
        }));

        // 占空比数字显示（中央）
        const cx=pr.x+pr.w*0.50;
        const dutyPct=Math.round(this._pwmDuty*100);
        const dirLabel=this._pwmDir>0?'INC':this._pwmDir<0?'DEC':'HOLD';
        const dirColor=this._pwmDir>0?'#40c860':this._pwmDir<0?'#c84040':'#8090a0';

        this._dynGroup.add(new Konva.Text({
            x:pr.x+pr.w*0.31, y:pr.y+pr.h*0.32, width:pr.w*0.36,
            text:`D=${dutyPct}%`, fontSize:9,
            fill:this._pwmDuty>0.05?dirColor:'#607080', align:'center', fontStyle:'bold',
        }));
        this._dynGroup.add(new Konva.Text({
            x:pr.x+pr.w*0.31, y:pr.y+pr.h*0.62, width:pr.w*0.36,
            text:dirLabel, fontSize:8, fill:dirColor, align:'center', fontStyle:'bold',
        }));

        // INC PWM 波形
        const wh=pr.h*0.52, wy=pr.y+pr.h*0.18;
        const wx1=pr.x+pr.w*0.30, wx2=pr.x+pr.w*0.60;
        const ww=pr.w*0.26;

        this._drawPWMWaveform(
            wx1, wy, ww, wh,
            this._pwmDir>0 ? this._pwmDuty : 0,
            '#30a850', this._pwmDir>0&&this._pwmState
        );
        this._drawPWMWaveform(
            wx2, wy, ww, wh,
            this._pwmDir<0 ? this._pwmDuty : 0,
            '#a83030', this._pwmDir<0&&this._pwmState
        );
    }

    // 绘制单路 PWM 波形
    _drawPWMWaveform(wx, wy, ww, wh, duty, color, activeNow) {
        const hist = this._pwmWaveHistory;
        const len  = hist.length;
        const dir  = Math.sign(this._pwmDir);
        const isInc = color.includes('a8');  // 判断是 INC 还是 DEC 通道

        // 重建此通道的历史（由共享 pwmWaveHistory 衍生）
        const pts = [];
        for (let i = 0; i < len; i++) {
            const x = wx + 1 + (i / (len - 1)) * (ww - 2);
            const val = hist[i];  // 0=低, 1=INC高, -1=DEC高
            const hi = isInc ? (val > 0.5) : (val < -0.5);
            const y  = wy + (hi ? wh * 0.15 : wh * 0.78);
            pts.push(x, y);
        }
        if (pts.length >= 4) {
            this._dynGroup.add(new Konva.Line({
                points: pts, stroke: `${color}cc`,
                strokeWidth: 1.2, lineCap: 'square', lineJoin: 'miter',
            }));
        }
        // 当前状态高亮
        if (activeNow && duty > 0.05) {
            this._dynGroup.add(new Konva.Rect({
                x: wx, y: wy, width: ww, height: wh * 0.25,
                fill: `${color}40`, cornerRadius: 1,
            }));
        }
        // 占空比占比条（底部细条）
        this._dynGroup.add(new Konva.Rect({
            x: wx+1, y: wy+wh*0.90, width: (ww-2)*duty, height: wh*0.08,
            fill: color, opacity: 0.7, cornerRadius: 1,
        }));
    }

    // ── 继电器状态 + 阀位条 ──────────────────────────────────
    _drawRelayStatus() {
        const mr=this._mrcRect, glow=this._glowPulse;
        const relY=mr.y+mr.h*0.45;

        // INC 指示灯
        const incX=mr.x+mr.w*0.12;
        this._dynGroup.add(new Konva.Circle({
            x:incX, y:relY, radius:mr.h*0.22,
            fill:this._incActive?'#22cc66':'#182e20',
            stroke:this._incActive?'#22cc66':'#283828', strokeWidth:0.8,
            shadowColor:this._incActive?'#22cc66':'transparent',
            shadowBlur:this._incActive?8+glow*4:0, shadowOpacity:0.9,
        }));
        // DEC 指示灯
        const decX=mr.x+mr.w*0.88;
        this._dynGroup.add(new Konva.Circle({
            x:decX, y:relY, radius:mr.h*0.22,
            fill:this._decActive?'#e04848':'#301818',
            stroke:this._decActive?'#e04848':'#402828', strokeWidth:0.8,
            shadowColor:this._decActive?'#e04848':'transparent',
            shadowBlur:this._decActive?8+glow*4:0, shadowOpacity:0.9,
        }));

        // 阀位进度条
        const bx=mr.x+mr.w*0.28, bw=mr.w*0.44, bh=mr.h*0.45, by=mr.y+mr.h*0.18;
        this._dynGroup.add(new Konva.Rect({x:bx,y:by,width:bw,height:bh,fill:'#060a10',stroke:'#20304080',strokeWidth:0.5,cornerRadius:2}));
        const cw=bw*this._valvePos;
        if (cw>0) this._dynGroup.add(new Konva.Rect({x:bx+bw-cw,y:by,width:cw,height:bh,fill:'rgba(50,130,220,0.60)',cornerRadius:2}));
        const pw=bw*(1-this._valvePos);
        if (pw>0) this._dynGroup.add(new Konva.Rect({x:bx,y:by,width:pw,height:bh,fill:'rgba(220,110,40,0.60)',cornerRadius:2}));
        this._dynGroup.add(new Konva.Text({
            x:bx, y:by+bh*0.18, width:bw,
            text:`${Math.round(this._valvePos*100)}%`,
            fontSize:7.5, fill:'#c8d8f0', align:'center', fontStyle:'bold',
        }));
        // PWM→继电器方向箭头
        if (this._incActive) {
            this._dynGroup.add(new Konva.Arrow({
                points:[incX+mr.h*0.26,relY,bx-2,by+bh/2],
                stroke:'#22cc66', fill:'#22cc66',
                strokeWidth:1, pointerLength:4, pointerWidth:3, dash:[3,2],
            }));
        }
        if (this._decActive) {
            this._dynGroup.add(new Konva.Arrow({
                points:[decX-mr.h*0.26,relY,bx+bw+2,by+bh/2],
                stroke:'#e04848', fill:'#e04848',
                strokeWidth:1, pointerLength:4, pointerWidth:3, dash:[3,2],
            }));
        }
    }

    // ── PCB 流动动画 ─────────────────────────────────────────
    _drawPCBAnimation() {
        const pr=this._pcbRect;
        const bw=pr.w*0.21, bh=pr.h*0.58, by=pr.y+pr.h*0.22;
        const xs=[pr.x+pr.w*0.02, pr.x+pr.w*0.26, pr.x+pr.w*0.52, pr.x+pr.w*0.76];
        const cs=['#50b050','#30a0a0','#40c070','#b09018'];
        const acts=[0.5, Math.min(1,Math.abs(this._pdOutput)/this.pwmUmax), this._pwmDuty, (this._incActive||this._decActive?1:0)];
        const phase=this._pcbAnim;

        xs.forEach((x,i)=>{
            if (i<3) {
                const x0=x+bw, y0=by+bh*0.40, x1=xs[i+1];
                this._dynGroup.add(new Konva.Line({points:[x0,y0,x1,y0],stroke:'rgba(80,110,140,0.22)',strokeWidth:1}));
                const t=((phase+i*0.25)%1.0);
                this._dynGroup.add(new Konva.Circle({
                    x:x0+t*(x1-x0), y:y0, radius:1.8,
                    fill:cs[i], opacity:Math.sin(t*Math.PI)*0.8,
                }));
            }
            if (acts[i]>0.05) {
                this._dynGroup.add(new Konva.Rect({
                    x, y:by, width:bw, height:bh,
                    stroke:cs[i], strokeWidth:0.8,
                    opacity:acts[i]*(0.3+0.3*this._glowPulse),
                    cornerRadius:2,
                }));
            }
        });
    }

    // ═══════════════════════════════════════════════════════════
    // 动画循环
    // 集中化 tick（由 consys._tickAll 在 20fps 调用）
    tick(dt) {
        this._tickAnimation(dt);
    
        this._refreshCache();
    }
    _tickAnimation(dt) {
        this._animTime  += dt;
        this._glowPulse  = 0.5 + 0.5 * Math.sin(this._animTime * 4);
        this._pcbAnim    = (this._pcbAnim + dt * 0.55) % 1.0;

        // ── 1. T802 NTC 测温信号链路 ──────────────────────────
        this._ntcR    = this._tempToNtcR(this._pv);
        this._vmeas   = this._ntcRtoVmeas(this._ntcR);
        // 经 ADC → Steinhart-Hart 反算得测量温度
        const tCalc   = this._ntcRtoTemp(this._ntcR);
        this._pvDisplay = (tCalc + this.zeroAdj) * this.spanAdj;

        // 更新 Vmeas 波形历史（滚动）
        this._ntcWaveHistory.push(this._vmeas / this.ntcVcc);
        if (this._ntcWaveHistory.length > 40) this._ntcWaveHistory.shift();

        // ── 2. PD 控制器（MRV 板）────────────────────────────
        this._error = this.spTemp - this._pvDisplay;
        const Kp    = 100 / this.pBand;
        const Td    = this.tdTime * 60;
        const dEdt  = Td > 0.001 ? (this._error - this._prevError) / dt : 0;
        this._pdOutput = Kp * (this._error + Td * dEdt);
        this._pdOutput = this._clamp(this._pdOutput, -this.pwmUmax, this.pwmUmax);
        this._prevError = this._error;

        // ── 3. PWM 调制器 ★ ──────────────────────────────────
        const rawDuty = Math.abs(this._pdOutput) / this.pwmUmax;   // 0~1
        const effDuty = rawDuty < this.pwmMinDuty ? 0 : rawDuty;   // 死区

        this._pwmDuty = effDuty;
        this._pwmDir  = effDuty > 0 ? Math.sign(this._pdOutput) : 0;

        // 三角波载波（用于产生 PWM 方波）
        const pwmPeriod = 1 / this.pwmFreq;
        this._pwmPhase = (this._pwmPhase + dt / pwmPeriod) % 1.0;

        // 比较器：三角波相位 < duty → 高电平
        this._pwmState = this._pwmPhase < effDuty;

        // 继电器跟随 PWM 状态（含方向选择）
        this._incActive = this._pwmDir > 0 && this._pwmState;
        this._decActive = this._pwmDir < 0 && this._pwmState;

        // 限位保护
        if (this._valvePos >= 1.0) this._incActive = false;
        if (this._valvePos <= 0.0) this._decActive = false;

        // PWM 波形历史（-1=DEC高, 0=断, +1=INC高）
        const wVal = this._incActive ? 1 : this._decActive ? -1 : 0;
        this._pwmWaveHistory.push(wVal);
        if (this._pwmWaveHistory.length > 60) this._pwmWaveHistory.shift();

        // ── 4. 阀门位置（PWM 等效平均速度）─────────────────
        const avgSpeed = this._valveSpeed * effDuty;
        if (this._incActive) {
            this._valvePos = this._clamp01(this._valvePos + avgSpeed * dt);
        } else if (this._decActive) {
            this._valvePos = this._clamp01(this._valvePos - avgSpeed * dt);
        }

        this._rebuildDynamic();
        this._refreshCache();
    }

    // ── 交互绑定 ──────────────────────────────────────────────
    _bindInteraction() {
        const knobDefs = [
            { k: this._zeroKnob,  key: 'zeroAdj',  min: -5,  max: 5,   scale: 0.05  },
            { k: this._spanKnob,  key: 'spanAdj',  min: 0.8, max: 1.2, scale: 0.004 },
            { k: this._spKnob,    key: 'spTemp',   min: this.pvRangeMin, max: this.pvRangeMax, scale: 0.5 },
            { k: this._pKnob,     key: 'pBand',    min: 5,   max: 200, scale: 1.0   },
            { k: this._tdKnob,    key: 'tdTime',   min: 0,   max: 2,   scale: 0.02  },
            { k: this._freqKnob,  key: 'pwmFreq',  min: 0.5, max: 5,   scale: 0.03  },
        ];
        knobDefs.forEach(({ k, key, min, max, scale }) => {
            const hit = new Konva.Circle({
                x: k.x, y: k.y, radius: k.r * 1.2,
                fill: 'transparent', listening: true,
            });
            this._dynGroup.add(hit);
            hit.on('mousedown touchstart', (e) => {
                const y = e.evt.type === 'touchstart' ? e.evt.touches[0].clientY : e.evt.clientY;
                this._dragging = { key, startY: y, startVal: this[key], min, max, scale };
                e.cancelBubble = true;
            });
        });

        const onMove = (e) => {
            if (!this._dragging) return;
            const { key, startY, startVal, min, max, scale } = this._dragging;
            const curY = e.type === 'touchmove' ? e.touches[0].clientY : e.clientY;
            const dy   = startY - curY;
            let newVal = this._clamp(startVal + dy * scale, min, max);
            if (key === 'spTemp' || key === 'pBand') newVal = Math.round(newVal * 2) / 2;
            if (key === 'pwmFreq') newVal = Math.round(newVal * 10) / 10;
            this[key] = newVal;
            this._refreshCache();
        };
        const onUp = () => { this._dragging = null; };
        if (typeof window !== 'undefined') {
            window.addEventListener('mousemove', onMove);
            window.addEventListener('mouseup',   onUp);
            window.addEventListener('touchmove', onMove, { passive: true });
            window.addEventListener('touchend',  onUp);
        }
    }

    // ═══════════════════════════════════════════════════════════
    // 公开 API

    /** 设置流体温度（°C，模拟 T802 NTC 输入） */
    setFluidTemp(temp) { this._pv = temp; this._refreshCache(); }

    /** 读取当前 T802 NTC 电阻值（Ω） */
    getNTCResistance() { return this._ntcR; }

    /** 读取分压电路电压（V） */
    getVmeas() { return this._vmeas; }

    /** 读取显示温度（经零点/量程修正） */
    getDisplayTemp() { return this._pvDisplay; }

    /** 读取当前偏差 */
    getError() { return this._error; }

    /** 读取 PD 控制器输出电压（V） */
    getPDOutput() { return this._pdOutput; }

    /** 读取 PWM 占空比（0~1） */
    getPWMDuty() { return this._pwmDuty; }

    /** 读取 PWM 方向（+1=INC, -1=DEC, 0=保持） */
    getPWMDirection() { return this._pwmDir; }

    /** 读取阀门开度（0~1） */
    getValvePosition() { return this._valvePos; }

    /** 读取 INC 继电器状态 */
    isINCActive() { return this._incActive; }

    /** 读取 DEC 继电器状态 */
    isDECActive() { return this._decActive; }

    update(state) {
        if (typeof state === 'object' && state !== null) {
            if (state.temp    !== undefined) this.setFluidTemp(parseFloat(state.temp));
            if (state.spTemp  !== undefined) this.spTemp   = this._clamp(parseFloat(state.spTemp), this.pvRangeMin, this.pvRangeMax);
            if (state.pBand   !== undefined) this.pBand    = this._clamp(parseFloat(state.pBand), 5, 200);
            if (state.tdTime  !== undefined) this.tdTime   = this._clamp(parseFloat(state.tdTime), 0, 2);
            if (state.pwmFreq !== undefined) this.pwmFreq  = this._clamp(parseFloat(state.pwmFreq), 0.5, 5);
        } else if (typeof state === 'number') {
            this.setFluidTemp(state);
        }
        this._refreshCache();
    }

    getConfigFields() {
        return [
            { label:'位号',              key:'label',       type:'text'   },
            { label:'型号',              key:'model',       type:'text'   },
            { label:'量程下限 (°C)',     key:'pvRangeMin',  type:'number' },
            { label:'量程上限 (°C)',     key:'pvRangeMax',  type:'number' },
            { label:'电源电压 (V)',      key:'supplyVolt',  type:'number' },
            { label:'T802 R25 (Ω)',     key:'ntcR25',      type:'number' },
            { label:'T802 β值 (K)',     key:'ntcBeta',     type:'number' },
            { label:'分压电阻 Rref (Ω)','key':'ntcRref',   type:'number' },
            { label:'给定温度 SP (°C)',  key:'spTemp',      type:'number' },
            { label:'比例带 P (%)',      key:'pBand',       type:'number' },
            { label:'微分时间 Td (min)', key:'tdTime',      type:'number' },
            { label:'不灵敏区 (°C)',     key:'deadBand',    type:'number' },
            { label:'零点调整 (°C)',     key:'zeroAdj',     type:'number' },
            { label:'量程调整系数',      key:'spanAdj',     type:'number' },
            { label:'PWM 频率 (Hz)',     key:'pwmFreq',     type:'number' },
            { label:'PWM 最小占空比',    key:'pwmMinDuty',  type:'number' },
            { label:'初始温度 (°C)',     key:'initPV',      type:'number' },
        ];
    }

    onConfigUpdate(cfg) {
        const n = (k, d) => cfg[k] !== undefined ? parseFloat(cfg[k]) : d;
        if (cfg.label)    this.label    = cfg.label;
        if (cfg.model)    this.model    = cfg.model;
        this.pvRangeMin = n('pvRangeMin', this.pvRangeMin);
        this.pvRangeMax = n('pvRangeMax', this.pvRangeMax);
        this.supplyVolt = n('supplyVolt', this.supplyVolt);
        this.ntcR25     = n('ntcR25',     this.ntcR25);
        this.ntcBeta    = n('ntcBeta',    this.ntcBeta);
        this.ntcRref    = n('ntcRref',    this.ntcRref);
        this.spTemp     = this._clamp(n('spTemp',    this.spTemp),   this.pvRangeMin, this.pvRangeMax);
        this.pBand      = this._clamp(n('pBand',     this.pBand),    5, 200);
        this.tdTime     = this._clamp(n('tdTime',    this.tdTime),   0, 2);
        this.deadBand   = this._clamp(n('deadBand',  this.deadBand), 0.1, 5);
        this.zeroAdj    = this._clamp(n('zeroAdj',   this.zeroAdj),  -5, 5);
        this.spanAdj    = this._clamp(n('spanAdj',   this.spanAdj),  0.8, 1.2);
        this.pwmFreq    = this._clamp(n('pwmFreq',   this.pwmFreq),  0.5, 5);
        this.pwmMinDuty = n('pwmMinDuty', this.pwmMinDuty);
        if (cfg.initPV !== undefined) this._pv = parseFloat(cfg.initPV);
        this.config = { ...this.config, ...cfg };
        this._refreshCache();
    }

    destroy() {
        super.destroy?.();
    }
}