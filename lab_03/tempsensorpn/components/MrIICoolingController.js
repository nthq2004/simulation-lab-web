import { BaseComponent } from './BaseComponent.js';

/**
 * MR-II 型电动气缸冷却水温度自动控制系统仿真组件
 *
 * ── 产品背景 ──────────────────────────────────────────────────
 *
 *  MR-II 型（Marine Regulator II）是船舶轮机自动化领域的经典
 *  电动气缸冷却水温度控制系统，是中国航海院校《轮机自动化》课程
 *  的标准教学案例（第五章第二节），被广泛装备于中小型货船柴油机
 *  夹套冷却水温度自动控制场合。
 *
 * ── 系统组成 ──────────────────────────────────────────────────
 *
 *  系统由以下五大单元构成（见面板布局）：
 *
 *  1. 测温单元（Sensing Unit）
 *     - 铂电阻温度传感器 Pt100（RTD）插在气缸冷却水出口管道中
 *     - 温度变化 → 电阻变化 → 不平衡电桥输出毫伏级差压信号
 *     - 量程：0 ~ 100°C（标准型），对应电桥输出约 0 ~ 400 mV
 *
 *  2. 测量/显示单元（MRT板 / Measurement & Display）
 *     - 电桥放大电路将 RTD 信号放大为标准 0 ~ 5V 测量电压
 *     - 驱动面板正面的圆弧指针式温度计（0 ~ 100°C 刻度）
 *     - 零点（ZERO）旋钮：±5°C 偏移校正
 *     - 量程（SPAN）旋钮：量程增益修正
 *
 *  3. 比例微分控制器（MRV板 / PD Controller）
 *     - 运算放大器 TU1：测量信号缓冲
 *     - 运算放大器 TU2：给定值（SP）叠加求差，输出偏差电压 e(t)
 *     - 运算放大器 TU3：同相输入加法放大，实现 PD（比例+微分）运算：
 *         u(t) = Kp·e(t) + Kp·Td·de(t)/dt
 *     - 不灵敏区（Dead Band）电路：|e| 小于阈值时不输出，防止频繁动作
 *     - 给定值（SP）旋钮：0 ~ 100°C 设定，对应 0 ~ 5V 基准电压
 *     - 比例带（P Band）旋钮：5 ~ 200%
 *     - 微分时间（Td）旋钮：0 ~ 2 min
 *
 *  4. 继电器执行电路（MRC板 / Relay Output Circuit）
 *     - 由"增加（INC）"和"减少（DEC）"两个输出继电器驱动电动执行机构
 *     - INC 继电器通电：电动三通阀向"增加冷却"方向转动
 *     - DEC 继电器通电：电动三通阀向"减少冷却"方向转动
 *     - 互锁电路：MRC 板中各串一个中间继电器常闭触头，防止 INC/DEC
 *       同时通电（防止电动机堵转）
 *     - 限位开关：阀门到达 0% / 100% 极限位时强制切断相应继电器
 *
 *  5. 电动三通调节阀（Motorized 3-Way Valve）
 *     - 调节型电动执行机构：可逆单相电动机 + 蜗轮蜗杆减速器
 *     - 阀位反馈电位器（4 ~ 20mA 或 0 ~ 5V 位置反馈信号）
 *     - 阀门开度 0 ~ 100%（旁路全开 → 冷却器全开）
 *     - 典型动作速度：60 s / 全程
 *
 * ── 控制原理 ──────────────────────────────────────────────────
 *
 *  被控量：气缸冷却水出口温度 T（°C）
 *  给定值：SP（操作员面板旋钮设定）
 *  偏差：  e = SP - T
 *
 *  PD 控制律（离散化）：
 *    u(k) = Kp · [e(k) + Td/Ts · (e(k) - e(k-1))]
 *
 *  执行逻辑（继电器型分段输出）：
 *    |e| ≤ δ（不灵敏区）：INC、DEC 均断电，阀门保持
 *    e > +δ（水温偏高）  ：DEC 断电，INC 通电 → 阀门向冷却侧转动
 *    e < -δ（水温偏低）  ：INC 断电，DEC 通电 → 阀门向旁路侧转动
 *
 *  调节过程：
 *    水温升高 → e > 0 → INC 通电 → 三通阀冷却器侧开度↑ →
 *    更多冷却水过冷却器 → 水温下降 → e 减小 → 趋于平衡
 *
 * ── 视觉结构（正视图·控制器面板）────────────────────────────────
 *
 *  ┌─────────────────────────────────────────────────────────┐
 *  │   铭牌区（MR-II / 位号 / 量程）                          │
 *  ├─────────────────────────────────────────────────────────┤
 *  │  ╔═══════════════════════════════════════════════════╗  │
 *  │  ║  温度指示表盘（0~100°C 圆弧刻度）                  ║  │
 *  │  ║  红色 PV 指针 + 绿色 SP 标记线                    ║  │
 *  │  ╚═══════════════════════════════════════════════════╝  │
 *  │  ┌──────────────┬──────────────┬──────────────────────┐ │
 *  │  │ [ZERO旋钮]   │ [SPAN旋钮]   │  偏差显示条（±）      │ │
 *  │  └──────────────┴──────────────┴──────────────────────┘ │
 *  │  ┌──────────────┬──────────────┬──────────────────────┐ │
 *  │  │ [SP旋钮]     │ [P Band旋钮] │  [Td旋钮]            │ │
 *  │  └──────────────┴──────────────┴──────────────────────┘ │
 *  │  ┌─────────────────────────────────────────────────────┐ │
 *  │  │ MRC状态区：[INC继电器指示] [阀位条] [DEC继电器指示]  │ │
 *  │  └─────────────────────────────────────────────────────┘ │
 *  │  ┌─────────────────────────────────────────────────────┐ │
 *  │  │ 电路板剖视（MRT / MRV / MRC 三块PCB板横向排列）      │ │
 *  │  └─────────────────────────────────────────────────────┘ │
 *  ├─────────────────────────────────────────────────────────┤
 *  │  接线端子排：RTD+  RTD-  POWER  INC  DEC  GND          │
 *  └─────────────────────────────────────────────────────────┘
 *
 * ── 端口 ─────────────────────────────────────────────────────
 *  port_rtd_pos   — RTD+ 传感器正端（Pt100 输入）
 *  port_rtd_neg   — RTD- 传感器负端
 *  port_power     — 控制电源输入（220VAC / 24VDC）
 *  port_output_inc — 增加输出（→ 电动阀 INC 线圈）
 *  port_output_dec — 减少输出（→ 电动阀 DEC 线圈）
 *  port_gnd       — 公共地
 */
export class MrIICoolingController extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.width  = Math.max(240, config.width  || 280);
        this.height = Math.max(340, config.height || 380);

        this.type    = 'mr_ii_cooling_controller';
        this.special = 'none';
        this.cache   = 'fixed';

        // ── 铭牌参数 ──────────────────────────────────────────
        this.label       = config.label       || 'TIC-201';    // 位号
        this.model       = config.model       || 'MR-II';      // 型号
        this.pvRangeMin  = config.pvRangeMin  || 0;            // 量程下限 °C
        this.pvRangeMax  = config.pvRangeMax  || 100;          // 量程上限 °C
        this.supplyVolt  = config.supplyVolt  || 220;          // 电源电压

        // ── PD 控制参数 ──────────────────────────────────────
        this.spTemp      = Math.max(this.pvRangeMin, Math.min(this.pvRangeMax, config.spTemp || 75)); // 给定温度 °C
        this.pBand       = Math.max(5,   Math.min(200, config.pBand   || 80));  // 比例带 %
        this.tdTime      = Math.max(0,   Math.min(2,   config.tdTime  || 0.5)); // 微分时间 min
        this.deadBand    = Math.max(0.1, Math.min(5,   config.deadBand || 1.0)); // 不灵敏区 °C
        this.zeroAdj     = Math.max(-5,  Math.min(5,   config.zeroAdj || 0));   // 零点调整
        this.spanAdj     = Math.max(0.8, Math.min(1.2, config.spanAdj || 1.0)); // 量程调整

        // ── 过程变量 ──────────────────────────────────────────
        this._pv         = config.initPV !== undefined ? config.initPV : this.spTemp - 2; // 当前温度
        this._pvDisplay  = this._pv;          // 显示温度（经零点/量程修正）
        this._error      = 0;                 // 偏差 e = SP - PV
        this._prevError  = 0;                 // 上一拍偏差（微分用）
        this._valvePos   = config.initValve !== undefined ? config.initValve : 0.50; // 阀位 0~1
        this._incActive  = false;             // INC 继电器状态
        this._decActive  = false;             // DEC 继电器状态
        this._pdOutput   = 0;                 // PD 控制器输出（归一化 -1~+1）

        // 阀门运动参数
        this._valveSpeed = config.valveSpeed !== undefined ? config.valveSpeed : 1/60; // /s（60s全程）

        // ── 动画状态 ──────────────────────────────────────────
        this._animTime   = 0;
        this._glowPulse  = 0;          // 继电器光晕脉冲
        this._pcbAnim    = 0;          // PCB 电路流动动画相位
        this._lastTs     = null;
        this._animId     = null;
        this._dragging   = null;       // 旋钮拖拽状态

        // ── 几何布局 ──────────────────────────────────────────
        const W = this.width, H = this.height;

        // 外壳
        this._shell = { x: W*0.03, y: H*0.05, w: W*0.94, h: H*0.89, rx: 6 };

        // 表盘区域
        this._dialRect = { x: W*0.07, y: H*0.09, w: W*0.86, h: H*0.26 };
        this._dialCx   = W * 0.50;
        this._dialCy   = this._dialRect.y + this._dialRect.h * 0.78;
        this._dialR    = Math.min(W * 0.37, this._dialRect.h * 0.95);

        // 零点/量程旋钮区
        this._adjZone  = { x: W*0.07, y: H*0.37, w: W*0.86, h: H*0.09 };
        this._zeroKnob = { x: W*0.18, y: H*0.415, r: W*0.055 };
        this._spanKnob = { x: W*0.42, y: H*0.415, r: W*0.055 };

        // PD 参数旋钮区
        this._pdZone   = { x: W*0.07, y: H*0.48, w: W*0.86, h: H*0.09 };
        this._spKnob   = { x: W*0.18, y: H*0.525, r: W*0.055 };
        this._pKnob    = { x: W*0.50, y: H*0.525, r: W*0.055 };
        this._tdKnob   = { x: W*0.82, y: H*0.525, r: W*0.055 };

        // MRC 继电器状态区
        this._mrcRect  = { x: W*0.07, y: H*0.59, w: W*0.86, h: H*0.09 };

        // PCB 剖视区
        this._pcbRect  = { x: W*0.07, y: H*0.70, w: W*0.86, h: H*0.11 };

        // 接线端子排
        this._tbRect   = { x: W*0.07, y: H*0.83, w: W*0.86, h: H*0.08 };

        this._init();

        // ── 注册端口 ──────────────────────────────────────────
        const tb = this._tbRect, pH = H * 0.96;
        this.addPort(tb.x + tb.w*0.08, pH, 'port_rtd_pos',    'wire', 'T+');
        this.addPort(tb.x + tb.w*0.24, pH, 'port_rtd_neg',    'wire', 'T-');
        this.addPort(tb.x + tb.w*0.45, pH, 'port_power',      'wire', 'PWR');
        this.addPort(tb.x + tb.w*0.64, pH, 'port_output_inc', 'wire', 'INC');
        this.addPort(tb.x + tb.w*0.80, pH, 'port_output_dec', 'wire', 'DEC');
        this.addPort(tb.x + tb.w*0.94, pH, 'port_gnd',        'wire', 'GND');
    }

    // ═══════════════════════════════════════════════════════════
    _clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
    _clamp01(v)        { return this._clamp(v, 0, 1); }
    _lerp(a, b, t)     { return a + (b - a) * t; }
    _norm(v)           { return (v - this.pvRangeMin) / (this.pvRangeMax - this.pvRangeMin); }

    _init() {
        this._drawShell();
        this._drawDial();
        this._drawAdjZone();
        this._drawPDZone();
        this._drawMRCZone();
        this._drawPCBSection();
        this._drawTerminalBlock();
        this._drawTopLabel();
        this._buildDynamic();
        this._startAnimation();
    }

    // ── 外壳（金属立式控制箱）────────────────────────────────
    _drawShell() {
        const s = this._shell, W = this.width;

        // 主壳体
        this.group.add(new Konva.Rect({
            x: s.x, y: s.y, width: s.w, height: s.h,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint:   { x: s.w, y: 0 },
            fillLinearGradientColorStops: [
                0,   '#242830',
                0.10,'#3e4455',
                0.50,'#464d60',
                0.90,'#3e4455',
                1,   '#242830',
            ],
            stroke: '#181c26', strokeWidth: 1.5,
            cornerRadius: s.rx,
            shadowColor: '#000', shadowBlur: 10, shadowOffsetY: 4, shadowOpacity: 0.50,
        }));

        // 顶面高光
        this.group.add(new Konva.Rect({
            x: s.x+3, y: s.y+3, width: s.w-6, height: s.h*0.03,
            fill: 'rgba(255,255,255,0.08)', cornerRadius: [s.rx, s.rx, 0, 0],
        }));

        // 竖向纹理线（仿金属拉丝）
        for (let i = 1; i <= 5; i++) {
            this.group.add(new Konva.Line({
                points: [s.x + s.w*i/6, s.y+8, s.x + s.w*i/6, s.y+s.h-8],
                stroke: 'rgba(255,255,255,0.04)', strokeWidth: 0.5,
            }));
        }

        // 四角螺丝
        const sR = W * 0.020;
        [[s.x+14, s.y+12], [s.x+s.w-14, s.y+12],
         [s.x+14, s.y+s.h-12], [s.x+s.w-14, s.y+s.h-12]].forEach(([x, y]) => {
            this.group.add(new Konva.Circle({ x, y, radius: sR, fill:'#8090a8', stroke:'#4a5468', strokeWidth:0.6 }));
            this.group.add(new Konva.Line({ points:[x-sR*0.65,y,x+sR*0.65,y], stroke:'#2a3040', strokeWidth:0.9, lineCap:'round' }));
            this.group.add(new Konva.Line({ points:[x,y-sR*0.65,x,y+sR*0.65], stroke:'#2a3040', strokeWidth:0.9, lineCap:'round' }));
        });

        // 铭牌（右下角金色）
        this.group.add(new Konva.Rect({
            x: s.x+s.w-70, y: s.y+s.h-18, width: 66, height: 14,
            fill: '#b8a030', stroke: '#806820', strokeWidth: 0.8, cornerRadius: 2,
        }));
        this.group.add(new Konva.Text({
            x: s.x+s.w-68, y: s.y+s.h-15, width: 62,
            text: 'MR-II  MARINE', fontSize: 6, fill: '#2a1800',
            fontStyle: 'bold', align: 'center',
        }));
    }

    // ── 温度指示表盘 ──────────────────────────────────────────
    _drawDial() {
        const dr  = this._dialRect;
        const cx  = this._dialCx, cy = this._dialCy, R = this._dialR;

        // 表盘底板（深色）
        this.group.add(new Konva.Rect({
            x: dr.x, y: dr.y, width: dr.w, height: dr.h,
            fill: '#08090e', stroke: '#1e2438', strokeWidth: 1.2,
            cornerRadius: 5,
        }));

        // 圆弧仪表底色
        this.group.add(new Konva.Arc({
            x: cx, y: cy,
            innerRadius: R*0.62, outerRadius: R,
            angle: 220, rotation: -110,
            fill: '#101420', stroke: '#1e2840', strokeWidth: 0.6,
        }));

        // 危险区（高温段 80~100°C 红色弧）
        const hi80 = 0.80, hiAng = -110 + hi80*220;
        this.group.add(new Konva.Arc({
            x: cx, y: cy,
            innerRadius: R*0.62, outerRadius: R,
            angle: 220*(1-hi80), rotation: hiAng,
            fill: 'rgba(200,40,40,0.25)',
        }));

        // 刻度线 + 数字
        const startAngle = -110, totalAngle = 220;
        const majTicks = 10, minDiv = 5;
        for (let i = 0; i <= majTicks * minDiv; i++) {
            const frac = i / (majTicks * minDiv);
            const ang  = (startAngle + frac * totalAngle) * Math.PI / 180;
            const isM  = i % minDiv === 0;
            const r0   = R * (isM ? 0.66 : 0.72);
            const r1   = R * 0.83;
            this.group.add(new Konva.Line({
                points: [cx+Math.cos(ang)*r0, cy+Math.sin(ang)*r0,
                         cx+Math.cos(ang)*r1, cy+Math.sin(ang)*r1],
                stroke: isM ? '#c0cce0' : '#506070', strokeWidth: isM ? 1.2 : 0.5, lineCap:'round',
            }));
            if (isM) {
                const val = Math.round(this.pvRangeMin + frac*(this.pvRangeMax-this.pvRangeMin));
                const nr  = R * 0.56;
                this.group.add(new Konva.Text({
                    x: cx+Math.cos(ang)*nr-10, y: cy+Math.sin(ang)*nr-5, width: 20,
                    text: val.toString(), fontSize: 6.5, fill:'#a0b0c8', align:'center',
                }));
            }
        }

        // 单位与型号标注
        this.group.add(new Konva.Text({
            x: cx-20, y: cy-R*0.35, width: 40,
            text: '°C', fontSize: 9, fill:'#8090b0', fontStyle:'bold', align:'center',
        }));

        // 圆心
        this.group.add(new Konva.Circle({
            x: cx, y: cy, radius: R*0.06,
            fill: '#3a4058', stroke: '#5a6080', strokeWidth: 0.8,
        }));

        // 型号文字
        this.group.add(new Konva.Text({
            x: cx-28, y: cy-R*0.18, width: 56,
            text: this.model, fontSize: 8, fill:'rgba(160,170,200,0.50)',
            fontStyle:'bold', align:'center',
        }));
    }

    // ── 零点/量程调整旋钮区（静态）─────────────────────────
    _drawAdjZone() {
        const az = this._adjZone;
        this.group.add(new Konva.Rect({
            x: az.x, y: az.y, width: az.w, height: az.h,
            fill: '#0e1220', stroke: '#1e2838', strokeWidth: 0.7, cornerRadius: 3,
        }));

        // 偏差显示条背景（右侧）
        const bx = az.x + az.w*0.65, by = az.y+4, bw = az.w*0.32, bh = az.h-8;
        this.group.add(new Konva.Rect({
            x: bx, y: by, width: bw, height: bh,
            fill: '#060810', stroke: '#1e2838', strokeWidth: 0.5, cornerRadius: 2,
        }));
        this.group.add(new Konva.Text({
            x: bx, y: by+bh+1, width: bw, text: 'ERROR',
            fontSize: 5.5, fill:'#607080', align:'center',
        }));

        // 中心零线
        this.group.add(new Konva.Line({
            points: [bx+bw/2, by+2, bx+bw/2, by+bh-2],
            stroke:'rgba(255,255,255,0.15)', strokeWidth:0.6, dash:[2,2],
        }));

        // 旋钮标签
        this.group.add(new Konva.Text({
            x: this._zeroKnob.x-20, y: az.y+az.h-9, width: 40,
            text: 'ZERO', fontSize: 5.5, fill:'#7080a0', align:'center', fontStyle:'bold',
        }));
        this.group.add(new Konva.Text({
            x: this._spanKnob.x-20, y: az.y+az.h-9, width: 40,
            text: 'SPAN', fontSize: 5.5, fill:'#7080a0', align:'center', fontStyle:'bold',
        }));
        this.group.add(new Konva.Text({
            x: az.x+4, y: az.y+3, text:'— MEAS ADJ —',
            fontSize: 5.5, fill:'rgba(150,160,200,0.35)', fontStyle:'bold italic',
        }));
    }

    // ── PD 控制参数旋钮区（静态）────────────────────────────
    _drawPDZone() {
        const pz = this._pdZone;
        this.group.add(new Konva.Rect({
            x: pz.x, y: pz.y, width: pz.w, height: pz.h,
            fill: '#0e1220', stroke: '#1e2838', strokeWidth: 0.7, cornerRadius: 3,
        }));

        const knobLabels = [
            { k: this._spKnob,  label: 'SET PT °C' },
            { k: this._pKnob,   label: 'P BAND %'  },
            { k: this._tdKnob,  label: 'Td min'    },
        ];
        knobLabels.forEach(({ k, label }) => {
            // 外环凹槽
            this.group.add(new Konva.Circle({
                x: k.x, y: k.y, radius: k.r*1.18,
                fill: '#0a0c14', stroke: '#2a3448', strokeWidth: 0.8,
            }));
            this.group.add(new Konva.Text({
                x: k.x-22, y: pz.y+pz.h-9, width: 44,
                text: label, fontSize: 5.5, fill:'#6878a0', align:'center', fontStyle:'bold',
            }));
        });
        this.group.add(new Konva.Text({
            x: pz.x+4, y: pz.y+3, text:'— PD CONTROLLER (MRV) —',
            fontSize: 5.5, fill:'rgba(150,180,200,0.35)', fontStyle:'bold italic',
        }));
    }

    // ── MRC 继电器输出状态区（静态框）──────────────────────
    _drawMRCZone() {
        const mr = this._mrcRect;
        this.group.add(new Konva.Rect({
            x: mr.x, y: mr.y, width: mr.w, height: mr.h,
            fill: '#080c14', stroke: '#1e2838', strokeWidth: 0.7, cornerRadius: 3,
        }));
        this.group.add(new Konva.Text({
            x: mr.x+4, y: mr.y+3, text:'— RELAY OUTPUT (MRC) —',
            fontSize: 5.5, fill:'rgba(180,160,100,0.35)', fontStyle:'bold italic',
        }));

        // 阀位条标签
        this.group.add(new Konva.Text({
            x: mr.x + mr.w*0.37, y: mr.y+mr.h-9, width: mr.w*0.25,
            text: 'VALVE %', fontSize: 5.5, fill:'#8090b0', align:'center',
        }));

        // INC / DEC 标签
        this.group.add(new Konva.Text({
            x: mr.x+mr.w*0.06, y: mr.y+mr.h-9, width: 28,
            text: 'INC▲', fontSize: 5.5, fill:'#60b870', align:'center', fontStyle:'bold',
        }));
        this.group.add(new Konva.Text({
            x: mr.x+mr.w*0.72, y: mr.y+mr.h-9, width: 28,
            text: '▼DEC', fontSize: 5.5, fill:'#e06050', align:'center', fontStyle:'bold',
        }));
    }

    // ── PCB 板剖视区（三块板：MRT / MRV / MRC）─────────────
    _drawPCBSection() {
        const pr = this._pcbRect;
        this.group.add(new Konva.Rect({
            x: pr.x, y: pr.y, width: pr.w, height: pr.h,
            fill: '#050810', stroke: '#1a2030', strokeWidth: 0.7, cornerRadius: 3,
        }));
        this.group.add(new Konva.Text({
            x: pr.x+4, y: pr.y+3, text:'— PCB SECTION —',
            fontSize: 5.5, fill:'rgba(100,180,100,0.35)', fontStyle:'bold italic',
        }));

        const boards = [
            { label:'MRT', color:'#284a28', textColor:'#60c060', x: pr.x+pr.w*0.04 },
            { label:'MRV', color:'#284440', textColor:'#40b0b0', x: pr.x+pr.w*0.37 },
            { label:'MRC', color:'#3a3010', textColor:'#c0a020', x: pr.x+pr.w*0.70 },
        ];
        const bw = pr.w*0.27, bh = pr.h*0.62, by = pr.y+pr.h*0.20;
        boards.forEach(({ label, color, textColor, x }) => {
            // PCB 绿色基板
            this.group.add(new Konva.Rect({
                x, y: by, width: bw, height: bh,
                fill: color, stroke:'rgba(0,0,0,0.4)', strokeWidth:0.5, cornerRadius:2,
            }));
            // PCB 焊盘行（芯片/元件）
            for (let row = 0; row < 3; row++) {
                for (let col = 0; col < 5; col++) {
                    this.group.add(new Konva.Rect({
                        x: x+bw*0.08+col*bw*0.17, y: by+bh*0.15+row*bh*0.25,
                        width: bw*0.10, height: bh*0.12,
                        fill:'rgba(180,160,80,0.55)', cornerRadius:0.5,
                    }));
                }
            }
            // 标签
            this.group.add(new Konva.Text({
                x, y: by+bh+2, width: bw,
                text: label, fontSize: 7, fill: textColor,
                align:'center', fontStyle:'bold',
            }));
        });
    }

    // ── 接线端子排 ───────────────────────────────────────────
    _drawTerminalBlock() {
        const tb = this._tbRect;
        this.group.add(new Konva.Rect({
            x: tb.x, y: tb.y, width: tb.w, height: tb.h,
            fill: '#0a0c14', stroke: '#1e2030', strokeWidth: 0.6, cornerRadius:[0,0,4,4],
        }));

        const terms = [
            { frac:0.08, label:'T+',  color:'#70b060' },
            { frac:0.24, label:'T-',  color:'#70b060' },
            { frac:0.45, label:'PWR', color:'#e08830' },
            { frac:0.64, label:'INC', color:'#60b870' },
            { frac:0.80, label:'DEC', color:'#e06050' },
            { frac:0.94, label:'GND', color:'#7080a0' },
        ];
        terms.forEach(({ frac, label, color }) => {
            const px = tb.x + tb.w * frac, py = tb.y + 3;
            // 端子座（矩形+孔）
            this.group.add(new Konva.Rect({
                x: px-4.5, y: py, width: 9, height: 7,
                fill:'#606878', stroke:'#3a4050', strokeWidth:0.5, cornerRadius:1,
            }));
            this.group.add(new Konva.Circle({ x: px, y: py+3.5, radius: 2.2, fill:'#1a1e28' }));
            this.group.add(new Konva.Text({
                x: px-10, y: py+8, width: 20,
                text: label, fontSize: 5, fill: color, align:'center',
            }));
        });
    }

    // ── 顶部铭牌标注 ─────────────────────────────────────────
    _drawTopLabel() {
        const W = this.width;
        this.group.add(new Konva.Text({
            x: 0, y: -16, width: W,
            text: `${this.label}  ${this.model}  ${this.pvRangeMin}~${this.pvRangeMax}°C  ${this.supplyVolt}VAC`,
            fontSize: 8.5, fontStyle:'bold', fill:'#607888', align:'center',
        }));
    }

    // ═══════════════════════════════════════════════════════════
    // 动态图层
    // ═══════════════════════════════════════════════════════════
    _buildDynamic() {
        this._dynGroup = new Konva.Group();
        this.group.add(this._dynGroup);
        this._rebuildDynamic();
    }

    _rebuildDynamic() {
        this._dynGroup.destroyChildren();
        this._drawPointers();
        this._drawErrorBar();
        this._drawKnobs();
        this._drawRelayStatus();
        this._drawPCBAnimation();
    }

    // ── 指针（PV 红色 + SP 绿色标线）────────────────────────
    _drawPointers() {
        const cx = this._dialCx, cy = this._dialCy, R = this._dialR;
        const startAngle = -110, totalAngle = 220;

        const pvFrac = this._clamp01(this._norm(this._pvDisplay));
        const spFrac = this._clamp01(this._norm(this.spTemp));
        const glow   = this._glowPulse;

        // SP 绿色细标记线（不随时间动，只随设定值移动）
        const spAng  = (startAngle + spFrac * totalAngle) * Math.PI / 180;
        this._dynGroup.add(new Konva.Line({
            points: [
                cx+Math.cos(spAng)*R*0.64, cy+Math.sin(spAng)*R*0.64,
                cx+Math.cos(spAng)*R*0.98, cy+Math.sin(spAng)*R*0.98,
            ],
            stroke:'#22ee66', strokeWidth:2.0, lineCap:'round',
        }));
        // SP 端部小圆点
        this._dynGroup.add(new Konva.Circle({
            x: cx+Math.cos(spAng)*R*0.94, y: cy+Math.sin(spAng)*R*0.94,
            radius: 2.5, fill:'#22ee66',
            shadowColor:'#22ee66', shadowBlur:5, shadowOpacity:0.8,
        }));

        // PV 红色主指针（带光晕）
        const pvAng  = (startAngle + pvFrac * totalAngle) * Math.PI / 180;
        // 光晕
        this._dynGroup.add(new Konva.Line({
            points: [cx, cy, cx+Math.cos(pvAng)*R*0.88, cy+Math.sin(pvAng)*R*0.88],
            stroke:'rgba(255,80,80,0.15)', strokeWidth: 6+glow*3, lineCap:'round',
        }));
        // 主体
        this._dynGroup.add(new Konva.Arrow({
            points: [cx, cy, cx+Math.cos(pvAng)*R*0.88, cy+Math.sin(pvAng)*R*0.88],
            stroke:'#ff3030', fill:'#ff3030',
            strokeWidth: 1.8, pointerLength:5, pointerWidth:3, lineCap:'round',
        }));
        // 尾段
        this._dynGroup.add(new Konva.Line({
            points: [cx, cy, cx+Math.cos(pvAng+Math.PI)*R*0.12, cy+Math.sin(pvAng+Math.PI)*R*0.12],
            stroke:'#ff3030', strokeWidth:1.5, lineCap:'round',
        }));

        // 圆心盖板
        this._dynGroup.add(new Konva.Circle({
            x: cx, y: cy, radius: R*0.055,
            fill:'#d8c860', stroke:'#887030', strokeWidth:0.8,
        }));

        // 数字显示（表盘内下方）
        this._dynGroup.add(new Konva.Text({
            x: cx-36, y: cy - R*0.25, width: 72,
            text: `PV: ${this._pvDisplay.toFixed(1)}°C`,
            fontSize: 7, fill:'#ff8080', align:'center', fontStyle:'bold',
        }));
        this._dynGroup.add(new Konva.Text({
            x: cx-36, y: cy - R*0.12, width: 72,
            text: `SP: ${this.spTemp.toFixed(1)}°C`,
            fontSize: 7, fill:'#22ee66', align:'center', fontStyle:'bold',
        }));
    }

    // ── 偏差显示条 ───────────────────────────────────────────
    _drawErrorBar() {
        const az = this._adjZone;
        const bx = az.x + az.w*0.65, by = az.y+4, bw = az.w*0.32, bh = az.h-8;
        const cx = bx + bw/2, midY = by + bh/2;

        const e   = this._error;   // °C
        const maxE = 10;           // 最大显示偏差 ±10°C
        const eFrac = this._clamp(e / maxE, -1, 1);

        if (eFrac > 0.01) {
            // 正偏差（水温偏高）→ 红色条，向右
            this._dynGroup.add(new Konva.Rect({
                x: cx, y: midY-3, width: eFrac*(bw/2-2), height: 6,
                fill:'#e04040', cornerRadius:1,
            }));
        } else if (eFrac < -0.01) {
            // 负偏差（水温偏低）→ 蓝色条，向左
            this._dynGroup.add(new Konva.Rect({
                x: cx + eFrac*(bw/2-2), y: midY-3, width: -eFrac*(bw/2-2), height: 6,
                fill:'#4080e0', cornerRadius:1,
            }));
        }

        // 中心零刻度线（高亮）
        this._dynGroup.add(new Konva.Line({
            points: [cx, by+2, cx, by+bh-2],
            stroke:'rgba(255,255,100,0.50)', strokeWidth:0.8,
        }));

        // 不灵敏区两侧标线
        const db = this._clamp(this.deadBand / maxE, 0, 0.4);
        this._dynGroup.add(new Konva.Line({
            points: [cx + db*(bw/2-2), by+2, cx + db*(bw/2-2), by+bh-2],
            stroke:'rgba(255,200,0,0.30)', strokeWidth:0.5, dash:[2,2],
        }));
        this._dynGroup.add(new Konva.Line({
            points: [cx - db*(bw/2-2), by+2, cx - db*(bw/2-2), by+bh-2],
            stroke:'rgba(255,200,0,0.30)', strokeWidth:0.5, dash:[2,2],
        }));

        // 偏差数值
        this._dynGroup.add(new Konva.Text({
            x: bx, y: midY-5, width: bw,
            text: (e >= 0 ? '+' : '') + e.toFixed(1),
            fontSize: 6.5, fill: e > this.deadBand ? '#e04040' : e < -this.deadBand ? '#4080e0' : '#a0b0a0',
            align:'center', fontStyle:'bold',
        }));
    }

    // ── 三个旋钮组动态渲染 ──────────────────────────────────
    _drawKnobs() {
        const knobDefs = [
            // 零点/量程调整区
            { k: this._zeroKnob, val: this.zeroAdj,  min:-5,  max:5,   color:'#8090c0' },
            { k: this._spanKnob, val: this.spanAdj,  min:0.8, max:1.2, color:'#8090c0' },
            // PD 参数区
            { k: this._spKnob,   val: this.spTemp,   min: this.pvRangeMin, max: this.pvRangeMax, color:'#60d090' },
            { k: this._pKnob,    val: this.pBand,    min:5,   max:200, color:'#80b0e0' },
            { k: this._tdKnob,   val: this.tdTime,   min:0,   max:2,   color:'#c09060' },
        ];

        knobDefs.forEach(({ k, val, min, max, color }) => {
            const frac    = (val - min) / (max - min);
            const ang     = (-150 + frac * 300) * Math.PI / 180;
            const r       = k.r;

            // 旋钮主体
            this._dynGroup.add(new Konva.Circle({
                x: k.x, y: k.y, radius: r,
                fillRadialGradientStartPoint: { x:-r*0.3, y:-r*0.3 },
                fillRadialGradientStartRadius: 0,
                fillRadialGradientEndPoint:   { x:0, y:0 },
                fillRadialGradientEndRadius:  r,
                fillRadialGradientColorStops: [0,'#707888', 0.6,'#4a5060', 1,'#282e3a'],
                stroke:'#1a2030', strokeWidth:0.8,
            }));

            // 刻度圈
            for (let i = 0; i <= 10; i++) {
                const a = (-150 + i*30) * Math.PI / 180;
                const tick = i%5===0 ? r*0.22 : r*0.12;
                this._dynGroup.add(new Konva.Line({
                    points: [
                        k.x+Math.cos(a)*(r*0.82), k.y+Math.sin(a)*(r*0.82),
                        k.x+Math.cos(a)*(r*0.82-tick), k.y+Math.sin(a)*(r*0.82-tick),
                    ],
                    stroke:`rgba(160,180,220,0.35)`, strokeWidth: i%5===0?0.9:0.5,
                }));
            }

            // 指针线
            this._dynGroup.add(new Konva.Line({
                points: [
                    k.x+Math.cos(ang)*r*0.28, k.y+Math.sin(ang)*r*0.28,
                    k.x+Math.cos(ang)*r*0.80, k.y+Math.sin(ang)*r*0.80,
                ],
                stroke: color, strokeWidth: 1.8, lineCap:'round',
            }));

            // 中心点
            this._dynGroup.add(new Konva.Circle({
                x: k.x, y: k.y, radius: r*0.12,
                fill: color, opacity:0.7,
            }));

            // 数值标注
            const dispVal = max <= 2 ? val.toFixed(2) : Math.round(val).toString();
            this._dynGroup.add(new Konva.Text({
                x: k.x-18, y: k.y-6, width: 36,
                text: dispVal, fontSize: 6.5, fill: color, align:'center', fontStyle:'bold',
            }));
        });
    }

    // ── MRC 继电器状态 + 阀位条 ─────────────────────────────
    _drawRelayStatus() {
        const mr   = this._mrcRect;
        const glow = this._glowPulse;

        // INC 继电器指示灯（左侧）
        const incX = mr.x + mr.w*0.12, relY = mr.y + mr.h*0.45;
        const incC = this._incActive ? '#22cc66' : '#1a3020';
        const incS = this._incActive ? '#22cc66' : '#2a4030';
        this._dynGroup.add(new Konva.Circle({
            x: incX, y: relY, radius: mr.h*0.22,
            fill: incC, stroke: incS, strokeWidth:0.8,
            shadowColor: this._incActive ? '#22cc66' : 'transparent',
            shadowBlur:  this._incActive ? 8+glow*4 : 0,
            shadowOpacity: 0.9,
        }));
        this._dynGroup.add(new Konva.Text({
            x: incX-10, y: relY+mr.h*0.26, width:20,
            text:'INC', fontSize:5.5, fill: this._incActive ? '#22cc66' : '#3a5040',
            align:'center', fontStyle:'bold',
        }));

        // DEC 继电器指示灯（右侧）
        const decX = mr.x + mr.w*0.88;
        const decC = this._decActive ? '#e04848' : '#301a1a';
        const decS = this._decActive ? '#e04848' : '#402a2a';
        this._dynGroup.add(new Konva.Circle({
            x: decX, y: relY, radius: mr.h*0.22,
            fill: decC, stroke: decS, strokeWidth:0.8,
            shadowColor: this._decActive ? '#e04848' : 'transparent',
            shadowBlur:  this._decActive ? 8+glow*4 : 0,
            shadowOpacity: 0.9,
        }));
        this._dynGroup.add(new Konva.Text({
            x: decX-10, y: relY+mr.h*0.26, width:20,
            text:'DEC', fontSize:5.5, fill: this._decActive ? '#e04848' : '#503030',
            align:'center', fontStyle:'bold',
        }));

        // 阀位进度条（中间）
        const bx = mr.x+mr.w*0.28, bw = mr.w*0.44, bh = mr.h*0.45, by = mr.y+mr.h*0.18;
        this._dynGroup.add(new Konva.Rect({
            x: bx, y: by, width: bw, height: bh,
            fill:'#080c14', stroke:'#2a3448', strokeWidth:0.5, cornerRadius:2,
        }));

        // 冷却侧（蓝色，从右）
        const coolerW = bw * this._valvePos;
        if (coolerW > 0) {
            this._dynGroup.add(new Konva.Rect({
                x: bx+bw-coolerW, y: by, width: coolerW, height: bh,
                fill:'rgba(60,140,220,0.60)', cornerRadius:2,
            }));
        }
        // 旁路侧（橙色，从左）
        const bypassW = bw * (1 - this._valvePos);
        if (bypassW > 0) {
            this._dynGroup.add(new Konva.Rect({
                x: bx, y: by, width: bypassW, height: bh,
                fill:'rgba(220,120,40,0.60)', cornerRadius:2,
            }));
        }

        // 阀位百分比标注
        this._dynGroup.add(new Konva.Text({
            x: bx, y: by+bh*0.20, width: bw,
            text: `${Math.round(this._valvePos*100)}%`,
            fontSize: 7.5, fill:'#d0e0f0', align:'center', fontStyle:'bold',
        }));

        // 阀位条两端标注
        this._dynGroup.add(new Konva.Text({
            x: bx-18, y: by+2, width:16, text:'BYP', fontSize:4.5, fill:'#e08030', align:'center',
        }));
        this._dynGroup.add(new Konva.Text({
            x: bx+bw+2, y: by+2, width:16, text:'COO', fontSize:4.5, fill:'#3090e0', align:'center',
        }));

        // 动作方向箭头（继电器激活时显示）
        if (this._incActive) {
            this._dynGroup.add(new Konva.Arrow({
                points:[incX+mr.h*0.28, relY, bx-2, by+bh/2],
                stroke:'#22cc66', fill:'#22cc66',
                strokeWidth:1, pointerLength:4, pointerWidth:3, dash:[3,2],
            }));
        }
        if (this._decActive) {
            this._dynGroup.add(new Konva.Arrow({
                points:[decX-mr.h*0.28, relY, bx+bw+2, by+bh/2],
                stroke:'#e04848', fill:'#e04848',
                strokeWidth:1, pointerLength:4, pointerWidth:3, dash:[3,2],
            }));
        }
    }

    // ── PCB 流动动画（信号传播效果）────────────────────────
    _drawPCBAnimation() {
        const pr = this._pcbRect;
        const bw = pr.w*0.27, bh = pr.h*0.62, by = pr.y+pr.h*0.20;
        const xs = [pr.x+pr.w*0.04, pr.x+pr.w*0.37, pr.x+pr.w*0.70];
        const colors = ['#60c060','#40b0b0','#c0a020'];
        const phase  = this._pcbAnim;

        // 板间信号线（MRT→MRV→MRC）
        xs.forEach((x, i) => {
            if (i < 2) {
                const x0 = x+bw, y0 = by+bh*0.40;
                const x1 = xs[i+1], y1 = y0;
                // 底线
                this._dynGroup.add(new Konva.Line({
                    points:[x0, y0, x1, y1],
                    stroke:'rgba(100,120,160,0.25)', strokeWidth:1,
                }));
                // 流动点
                const t = (phase + i*0.33) % 1.0;
                const px = x0 + t*(x1-x0);
                this._dynGroup.add(new Konva.Circle({
                    x: px, y: y0, radius:2,
                    fill: colors[i], opacity: Math.sin(t*Math.PI)*0.8,
                }));
            }
        });

        // 各板内部元件活动闪烁（随信号流动）
        xs.forEach((x, i) => {
            const activity = i === 0 ? 0.5 : (i === 1 ? Math.abs(this._pdOutput) : (this._incActive||this._decActive?1:0));
            if (activity > 0.05) {
                // 活跃板发光边框
                this._dynGroup.add(new Konva.Rect({
                    x, y: by, width: bw, height: bh,
                    stroke: colors[i],
                    strokeWidth: 0.8,
                    opacity: activity * (0.3 + 0.3*this._glowPulse),
                    cornerRadius:2,
                }));
            }
        });
    }

    // ═══════════════════════════════════════════════════════════
    // 动画 & 控制循环
    // ═══════════════════════════════════════════════════════════
    _startAnimation() {
        this._bindInteraction();
        const tick = ts => {
            if (this._lastTs !== null) {
                const dt = Math.min((ts - this._lastTs) / 1000, 0.05);
                this._tickAnimation(dt);
            }
            this._lastTs = ts;
            this._animId = requestAnimationFrame(tick);
        };
        this._animId = requestAnimationFrame(tick);
    }

    _stopAnimation() {
        if (this._animId) { cancelAnimationFrame(this._animId); this._animId = null; }
    }

    _tickAnimation(dt) {
        this._animTime  += dt;
        this._glowPulse  = 0.5 + 0.5 * Math.sin(this._animTime * 4);
        this._pcbAnim    = (this._pcbAnim + dt * 0.6) % 1.0;

        // ── 测量值修正（零点+量程）──────────────────────────
        this._pvDisplay  = (this._pv + this.zeroAdj) * this.spanAdj;

        // ── 偏差计算 ──────────────────────────────────────────
        this._error      = this.spTemp - this._pvDisplay;

        // ── PD 控制器（MRV板）────────────────────────────────
        const Kp  = 100 / this.pBand;
        const Td  = this.tdTime * 60;     // 转换为 s
        const dEdt = Td > 0.001 ? (this._error - this._prevError) / dt : 0;
        this._pdOutput = Kp * (this._error + Td * dEdt);
        this._prevError = this._error;

        // ── 继电器执行逻辑（MRC板）───────────────────────────
        const db = this.deadBand;
        if (this._pdOutput > db * Kp) {
            // 温度偏高 → 增加冷却
            this._incActive = true;
            this._decActive = false;
        } else if (this._pdOutput < -db * Kp) {
            // 温度偏低 → 减少冷却
            this._incActive = false;
            this._decActive = true;
        } else {
            // 在不灵敏区内，保持阀位
            this._incActive = false;
            this._decActive = false;
        }

        // 限位开关
        if (this._valvePos >= 1.0 && this._incActive) this._incActive = false;
        if (this._valvePos <= 0.0 && this._decActive) this._decActive = false;

        // ── 阀门位置更新 ──────────────────────────────────────
        if (this._incActive) {
            this._valvePos = this._clamp01(this._valvePos + this._valveSpeed * dt);
        } else if (this._decActive) {
            this._valvePos = this._clamp01(this._valvePos - this._valveSpeed * dt);
        }

        this._rebuildDynamic();
        this._refreshCache();
    }

    // ── 交互绑定 ──────────────────────────────────────────────
    _bindInteraction() {
        const knobConfigs = [
            { k: this._zeroKnob, key: 'zeroAdj',  min:-5,  max:5,   scale:0.05 },
            { k: this._spanKnob, key: 'spanAdj',  min:0.8, max:1.2, scale:0.004 },
            { k: this._spKnob,   key: 'spTemp',   min: this.pvRangeMin, max: this.pvRangeMax, scale:0.5 },
            { k: this._pKnob,    key: 'pBand',    min:5,   max:200, scale:1.0  },
            { k: this._tdKnob,   key: 'tdTime',   min:0,   max:2,   scale:0.02 },
        ];

        knobConfigs.forEach(({ k, key, min, max, scale }) => {
            const hit = new Konva.Circle({
                x: k.x, y: k.y, radius: k.r * 1.2,
                fill:'transparent', listening:true,
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
            this[key]  = this._clamp(startVal + dy * scale, min, max);
            if (key === 'spTemp' || key === 'pBand') this[key] = Math.round(this[key] * 2) / 2;
            this._refreshCache();
        };
        const onUp = () => { this._dragging = null; };
        if (typeof window !== 'undefined') {
            window.addEventListener('mousemove', onMove);
            window.addEventListener('mouseup',   onUp);
            window.addEventListener('touchmove', onMove, { passive:true });
            window.addEventListener('touchend',  onUp);
        }
    }

    // ═══════════════════════════════════════════════════════════
    // 公开 API
    // ═══════════════════════════════════════════════════════════

    /** 设置当前流体温度（°C，模拟 RTD 输入） */
    setFluidTemp(temp) {
        this._pv = temp;
        this._refreshCache();
    }

    /** 读取当前显示温度（经零点/量程修正） */
    getDisplayTemp() { return this._pvDisplay; }

    /** 读取当前偏差 e = SP - PV */
    getError() { return this._error; }

    /** 读取阀门开度（0=全旁路，1=全冷却器） */
    getValvePosition() { return this._valvePos; }

    /** 读取 INC 继电器状态 */
    isINCActive() { return this._incActive; }

    /** 读取 DEC 继电器状态 */
    isDECActive() { return this._decActive; }

    /** 读取 PD 控制器输出（归一化） */
    getPDOutput() { return this._pdOutput; }

    update(state) {
        if (typeof state === 'object' && state !== null) {
            if (state.temp    !== undefined) this.setFluidTemp(parseFloat(state.temp));
            if (state.spTemp  !== undefined) this.spTemp  = this._clamp(parseFloat(state.spTemp), this.pvRangeMin, this.pvRangeMax);
            if (state.pBand   !== undefined) this.pBand   = this._clamp(parseFloat(state.pBand), 5, 200);
            if (state.tdTime  !== undefined) this.tdTime  = this._clamp(parseFloat(state.tdTime), 0, 2);
        } else if (typeof state === 'number') {
            this.setFluidTemp(state);
        }
        this._refreshCache();
    }

    getConfigFields() {
        return [
            { label:'位号',              key:'label',      type:'text'   },
            { label:'型号',              key:'model',      type:'text'   },
            { label:'量程下限 (°C)',     key:'pvRangeMin', type:'number' },
            { label:'量程上限 (°C)',     key:'pvRangeMax', type:'number' },
            { label:'电源电压 (V)',      key:'supplyVolt', type:'number' },
            { label:'给定温度 (°C)',     key:'spTemp',     type:'number' },
            { label:'比例带 P (%)',      key:'pBand',      type:'number' },
            { label:'微分时间 Td (min)', key:'tdTime',     type:'number' },
            { label:'不灵敏区 (°C)',     key:'deadBand',   type:'number' },
            { label:'零点调整 (°C)',     key:'zeroAdj',    type:'number' },
            { label:'量程调整系数',      key:'spanAdj',    type:'number' },
            { label:'初始水温 (°C)',     key:'initPV',     type:'number' },
            { label:'阀门速度 (/s)',     key:'valveSpeed', type:'number' },
        ];
    }

    onConfigUpdate(cfg) {
        const n = (k, d) => cfg[k] !== undefined ? parseFloat(cfg[k]) : d;
        if (cfg.label)      this.label      = cfg.label;
        if (cfg.model)      this.model      = cfg.model;
        this.pvRangeMin = n('pvRangeMin', this.pvRangeMin);
        this.pvRangeMax = n('pvRangeMax', this.pvRangeMax);
        this.supplyVolt = n('supplyVolt', this.supplyVolt);
        this.spTemp     = this._clamp(n('spTemp',    this.spTemp),   this.pvRangeMin, this.pvRangeMax);
        this.pBand      = this._clamp(n('pBand',     this.pBand),    5,   200);
        this.tdTime     = this._clamp(n('tdTime',    this.tdTime),   0,   2);
        this.deadBand   = this._clamp(n('deadBand',  this.deadBand), 0.1, 5);
        this.zeroAdj    = this._clamp(n('zeroAdj',   this.zeroAdj),  -5,  5);
        this.spanAdj    = this._clamp(n('spanAdj',   this.spanAdj),  0.8, 1.2);
        if (cfg.initPV  !== undefined) this._pv         = parseFloat(cfg.initPV);
        if (cfg.valveSpeed !== undefined) this._valveSpeed = parseFloat(cfg.valveSpeed);
        this.config = { ...this.config, ...cfg };
        this._refreshCache();
    }

    destroy() { this._stopAnimation(); super.destroy?.(); }
}