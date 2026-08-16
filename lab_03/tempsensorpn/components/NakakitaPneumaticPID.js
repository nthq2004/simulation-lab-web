import { BaseComponent } from './BaseComponent.js';

/**
 * NAKAKITA NS-732 系列气动 PID 调节器仿真组件
 * （NAKAKITA Seisakusho Co., Ltd. Automatic Indicating Controller）
 *
 * ── 产品背景 ──────────────────────────────────────────────────
 *
 *  日本 NAKAKITA（中北製作所）NS-732 系列气动自动指示调节器，
 *  广泛应用于船舶主机夹套冷却水温度控制、滑油温度、油水分离器
 *  加热器温控等场合。结构紧凑、维护简便、适用于防爆危险环境。
 *
 *  可控工艺变量：压力、差压、温度、液位、流量、粘度等，
 *  配合膜片式调节阀（3通温控阀）使用。
 *
 * ── 技术参数（NS-TM-732 / NS-PS-732）──────────────────────────
 *
 *  气源压力（Air Supply）：1.4 kgf/cm²
 *  输出信号（Output）    ：0.2 ~ 1.0 kgf/cm²（标准气动信号）
 *  输入量程（Input）     ：
 *    温度型 NS-TM-732：0~100°C / 0~150°C / 0~200°C
 *    压力型 NS-PS-732 ：0~1 / 0~5 / 0~10 / 0~30 kgf/cm²
 *  控制动作              ：正作用（Direct）/ 反作用（Reverse）
 *  控制模式              ：P / PI / PID 可选
 *  整定参数：
 *    比例带（P Band）    ：5 ~ 500%（典型 25~30%）
 *    积分时间（Reset）   ：0.05 ~ 20 min（典型 0.5~0.6 min）
 *    微分时间（Rate）    ：0 ~ 10 min（典型 < 5 min）
 *  重量                  ：约 5 kg
 *
 * ── 内部结构 ──────────────────────────────────────────────────
 *
 *  气动 PID 调节器核心机构如下（从上至下层叠布局）：
 *
 *  1. 喷嘴-挡板放大器（Nozzle-Flapper Amplifier）
 *     - 恒节流孔（Fixed Restriction Orifice）：φ~0.2mm
 *     - 变节流喷嘴（Variable Nozzle）：φ~0.5mm
 *     - 挡板（Flapper）：由力矩臂驱动，微小位移→大压力变化
 *     - 背压（Back Pressure）：0~气源压，高增益非线性放大
 *
 *  2. 气动继动器（Air Relay / Booster Relay）
 *     - 将喷嘴背压放大为标准输出信号（0.2~1.0 kgf/cm²）
 *     - 提高输出流量驱动能力
 *
 *  3. 力矩平衡杆（Force Beam / Moment Arm）
 *     - 测量波纹管（Measurement Bellows）：受工艺变量压力作用
 *     - 设定波纹管（Set Point Bellows）  ：受 SP 压力作用
 *     - 两者产生的力矩差驱动挡板移动（偏差信号）
 *
 *  4. 比例反馈波纹管（Proportional Feedback Bellows）
 *     - 接收输出信号，对力矩杆施加负反馈
 *     - 比例带（P Band）通过调整反馈支点位置改变
 *
 *  5. 积分波纹管组（Integral / Reset Bellows）
 *     - 正反馈波纹管 + 积分节流针阀（Integral Needle Valve）
 *     - RC 延时：I₁（正反馈）经节流针阀延迟后作用，消除余差
 *     - 积分时间 Tᵢ = 节流阻力 × 波纹管容积
 *
 *  6. 微分波纹管组（Derivative / Rate Bellows）
 *     - 微分节流针阀 + 微分波纹管
 *     - 输出信号变化率 → 超前相位补偿
 *     - 微分时间 Tᵈ = 节流阻力 × 波纹管容积
 *
 *  7. 指示计（Indicating Meter）
 *     - 圆弧刻度盘，红指针（PV），绿指针（SP）
 *     - 单位：°C / kgf/cm² / % 等
 *
 * ── 视觉结构（正视图）─────────────────────────────────────────
 *
 *  ┌──────────────────────────────────────────────────┐
 *  │              标注区（型号 / 位号 / 参数）           │
 *  ├──────────────────────────────────────────────────┤
 *  │  ╔══════════════════════════════════════════╗    │
 *  │  ║   指示表盘（PV 指针 + SP 指针 + 刻度）    ║    │
 *  │  ╚══════════════════════════════════════════╝    │
 *  │  ┌────────────────────────────────────────────┐  │
 *  │  │ [P Band旋钮]  [Reset旋钮]   [Rate旋钮]      │  │
 *  │  └────────────────────────────────────────────┘  │
 *  │  ┌────────────────────────────────────────────┐  │
 *  │  │ 内部机构剖视：                               │  │
 *  │  │  [测量波纹管]──[力矩杆]──[喷嘴挡板]──[继动器]│  │
 *  │  │  [设定波纹管]   [P反馈]  [I波纹管] [D波纹管] │  │
 *  │  └────────────────────────────────────────────┘  │
 *  │  [AUTO/MAN] [直接/反向] [模式 P/PI/PID]           │
 *  ├──────────────────────────────────────────────────┤
 *  │  气路接口：AIR SUP  IN(PV)  SP  OUT  (气管接头)   │
 *  └──────────────────────────────────────────────────┘
 *
 * ── 端口 ─────────────────────────────────────────────────────
 *  port_air_supply  — 气源输入（1.4 kgf/cm²）
 *  port_pv_input    — 工艺变量输入（来自传感器/变送器）
 *  port_sp_input    — 外部设定值输入（可选，内部旋钮优先）
 *  port_output      — 控制输出（→ 调节阀气动执行器）
 */
export class NakakitaPneumaticPID extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.width  = Math.max(240, config.width  || 280);
        this.height = Math.max(320, config.height || 360);

        this.type    = 'nakakita_pneumatic_pid';
        this.special = 'none';
        this.cache   = 'fixed';

        // ── 铭牌参数 ──────────────────────────────────────────
        this.label       = config.label       || 'TIC-101';   // 位号
        this.model       = config.model       || 'NS-TM-732'; // 型号
        this.unit        = config.unit        || '°C';        // 工程单位
        this.pvRangeMin  = config.pvRangeMin  || 0;           // 量程下限
        this.pvRangeMax  = config.pvRangeMax  || 200;         // 量程上限
        this.airSupply   = config.airSupply   || 1.4;         // 气源 kgf/cm²

        // ── PID 整定参数 ──────────────────────────────────────
        this.pBand       = Math.max(5,   Math.min(500,  config.pBand   || 100)); // 比例带 %
        this.resetTime   = Math.max(0.05,Math.min(20,   config.resetTime || 1.0)); // 积分时间 min
        this.rateTime    = Math.max(0,   Math.min(10,   config.rateTime  || 0.5)); // 微分时间 min
        this.controlMode = config.controlMode || 'PID';       // 'P' / 'PI' / 'PID'
        this.action      = config.action      || 'reverse';   // 'direct' / 'reverse'
        this.autoMode    = config.autoMode !== false;          // true=自动, false=手动

        // ── 过程信号 ──────────────────────────────────────────
        // PV：工艺变量（归一化 0~1，对应量程 pvRangeMin ~ pvRangeMax）
        this._pv      = config.initPV  !== undefined
            ? this._clamp01((config.initPV  - this.pvRangeMin) / (this.pvRangeMax - this.pvRangeMin))
            : 0.50;
        // SP：设定值（归一化 0~1）
        this._sp      = config.initSP  !== undefined
            ? this._clamp01((config.initSP  - this.pvRangeMin) / (this.pvRangeMax - this.pvRangeMin))
            : 0.60;
        // OUT：输出（归一化 0~1，对应 0.2~1.0 kgf/cm²）
        this._out     = config.initOut !== undefined ? this._clamp01(config.initOut) : 0.50;
        // 手动输出（AUTO→MAN 时保持当前值）
        this._manOut  = this._out;

        // ── PID 内部状态 ──────────────────────────────────────
        this._integral    = this._out;   // 积分器状态（Bumpless 初始化）
        this._prevErr     = 0;           // 上一拍误差（微分用）
        this._prevPV      = this._pv;    // 上一拍 PV（微分-on-PV）
        this._derivBuf    = 0;           // 微分滤波状态

        // ── 动画状态 ──────────────────────────────────────────
        this._animating   = true;
        this._simTime     = 0;           // 仿真时间 s
        this._flapAngle   = 0;           // 挡板偏转角 °（可视化用）
        this._relayPres   = 0.5;         // 继动器输出压力（归一化）
        this._bellowAnim  = 0;           // 波纹管伸缩动画相位
        this._glowPulse   = 0;           // 指针光晕脉冲
        this._lastTs      = null;
        this._animId      = null;

        // ── 旋钮拖拽状态 ──────────────────────────────────────
        this._dragging    = null;        // { knob, startY, startVal }

        // ── 几何布局 ──────────────────────────────────────────
        const W = this.width, H = this.height;

        // 外壳
        this._shell = { x: W*0.04, y: H*0.06, w: W*0.92, h: H*0.87, rx: 6 };

        // 表盘区域
        this._dialRect = {
            x: W*0.08, y: H*0.10,
            w: W*0.84, h: H*0.28,
        };
        this._dialCx = W * 0.50;
        this._dialCy = this._dialRect.y + this._dialRect.h * 0.74;
        this._dialR  = Math.min(W * 0.36, this._dialRect.h * 0.92);

        // 旋钮区
        this._knobZone = { x: W*0.08, y: H*0.40, w: W*0.84, h: H*0.13 };
        this._knobs = {
            pBand:     { x: W*0.20, y: H*0.465, r: W*0.065, val: () => this.pBand,     min:5,    max:500, key:'pBand'     },
            resetTime: { x: W*0.50, y: H*0.465, r: W*0.065, val: () => this.resetTime, min:0.05, max:20,  key:'resetTime' },
            rateTime:  { x: W*0.80, y: H*0.465, r: W*0.065, val: () => this.rateTime,  min:0,    max:10,  key:'rateTime'  },
        };

        // 内部机构剖视区
        this._mechRect = { x: W*0.08, y: H*0.56, w: W*0.84, h: H*0.22 };

        // 底部按钮区
        this._btnZone  = { x: W*0.08, y: H*0.80, w: W*0.84, h: H*0.07 };

        // 气路接口（底边）
        this._portZone = { x: W*0.08, y: H*0.89, w: W*0.84, h: H*0.04 };

        this._init();

        // ── 注册端口 ──────────────────────────────────────────
        const pz = this._portZone;
        this.addPort(pz.x + pz.w*0.12, H*0.98, 'port_air_supply', 'wire', 'AIR');
        this.addPort(pz.x + pz.w*0.37, H*0.98, 'port_pv_input',   'wire', 'PV' );
        this.addPort(pz.x + pz.w*0.63, H*0.98, 'port_sp_input',   'wire', 'SP' );
        this.addPort(pz.x + pz.w*0.88, H*0.98, 'port_output',     'wire', 'OUT');
    }

    // ═══════════════════════════════════════════════════════════
    _clamp01(v) { return Math.max(0, Math.min(1, v)); }
    _lerp(a, b, t) { return a + (b - a) * t; }

    _init() {
        this._drawShell();
        this._drawDial();
        this._drawKnobZone();
        this._drawMechSection();
        this._drawButtonRow();
        this._drawPortRow();
        this._drawLabel();
        this._buildDynamic();
        this._startAnimation();
    }

    // ── 外壳（金属机箱）─────────────────────────────────────────
    _drawShell() {
        const s = this._shell;
        const W = this.width;

        // 主体
        this.group.add(new Konva.Rect({
            x: s.x, y: s.y, width: s.w, height: s.h,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint:   { x: s.w, y: 0 },
            fillLinearGradientColorStops: [
                0,   '#3a3f4a',
                0.08,'#5a6170',
                0.50,'#4e5462',
                0.92,'#5a6170',
                1,   '#3a3f4a',
            ],
            stroke: '#2a2e38', strokeWidth: 1.5,
            cornerRadius: s.rx,
            shadowColor: '#000', shadowBlur: 8, shadowOffsetY: 4, shadowOpacity: 0.45,
        }));

        // 顶面金属高光
        this.group.add(new Konva.Rect({
            x: s.x+3, y: s.y+3, width: s.w-6, height: s.h*0.04,
            fill: 'rgba(255,255,255,0.10)', cornerRadius: [s.rx,s.rx,0,0],
        }));

        // 四角螺丝
        const screwR = W * 0.022;
        [[s.x+12, s.y+10],[s.x+s.w-12, s.y+10],
         [s.x+12, s.y+s.h-10],[s.x+s.w-12, s.y+s.h-10]].forEach(([x,y])=>{
            this.group.add(new Konva.Circle({ x, y, radius: screwR, fill:'#888', stroke:'#555', strokeWidth:0.6 }));
            this.group.add(new Konva.Line({ points:[x-screwR*0.65,y,x+screwR*0.65,y], stroke:'#444', strokeWidth:1, lineCap:'round'}));
            this.group.add(new Konva.Line({ points:[x,y-screwR*0.65,x,y+screwR*0.65], stroke:'#444', strokeWidth:1, lineCap:'round'}));
        });

        // 铭牌条（右下）
        this.group.add(new Konva.Rect({
            x: s.x+s.w-62, y: s.y+s.h-18, width: 58, height: 14,
            fill: '#c8a840', stroke: '#a08830', strokeWidth: 0.5, cornerRadius: 2,
        }));
        this.group.add(new Konva.Text({
            x: s.x+s.w-60, y: s.y+s.h-16, width: 54,
            text: 'NAKAKITA', fontSize: 6.5, fill: '#3a2a10',
            fontStyle: 'bold', align: 'center',
        }));
    }

    // ── 指示表盘 ──────────────────────────────────────────────
    _drawDial() {
        const dr  = this._dialRect;
        const cx  = this._dialCx;
        const cy  = this._dialCy;
        const R   = this._dialR;

        // 表盘底板（深色玻璃面板）
        this.group.add(new Konva.Rect({
            x: dr.x, y: dr.y, width: dr.w, height: dr.h,
            fill: '#0d0f14', stroke: '#2a3040', strokeWidth: 1.2,
            cornerRadius: 4,
        }));

        // 表盘玻璃高光
        this.group.add(new Konva.Rect({
            x: dr.x+2, y: dr.y+2, width: dr.w-4, height: dr.h*0.30,
            fill: 'rgba(255,255,255,0.035)', cornerRadius: [4,4,0,0],
        }));

        // 圆弧刻度背景
        this.group.add(new Konva.Arc({
            x: cx, y: cy,
            innerRadius: R * 0.65, outerRadius: R,
            angle: 220, rotation: -110,
            fill: '#141820',
            stroke: '#2a3040', strokeWidth: 0.5,
        }));

        // 刻度线和数字
        const startAngle = -110;  // °（从左下开始）
        const totalAngle = 220;   // 弧度范围
        const ticks      = 10;
        const minorTicks = 5;

        for (let i = 0; i <= ticks * minorTicks; i++) {
            const frac   = i / (ticks * minorTicks);
            const angleDeg = startAngle + frac * totalAngle;
            const angleRad = angleDeg * Math.PI / 180;
            const isMajor  = i % minorTicks === 0;
            const inner    = isMajor ? R * 0.68 : R * 0.73;
            const outer    = R * 0.82;

            this.group.add(new Konva.Line({
                points: [
                    cx + Math.cos(angleRad) * inner, cy + Math.sin(angleRad) * inner,
                    cx + Math.cos(angleRad) * outer, cy + Math.sin(angleRad) * outer,
                ],
                stroke: isMajor ? '#c8d0e0' : '#607080',
                strokeWidth: isMajor ? 1.2 : 0.6,
                lineCap: 'round',
            }));

            // 主刻度数字
            if (isMajor) {
                const val = this.pvRangeMin + frac * (this.pvRangeMax - this.pvRangeMin);
                const numX = cx + Math.cos(angleRad) * (R * 0.60);
                const numY = cy + Math.sin(angleRad) * (R * 0.60);
                this.group.add(new Konva.Text({
                    x: numX - 10, y: numY - 5, width: 20,
                    text: Math.round(val).toString(),
                    fontSize: 6.5, fill: '#b0bcd0', align: 'center',
                }));
            }
        }

        // 单位标注
        this.group.add(new Konva.Text({
            x: cx - 14, y: cy - R * 0.38,
            text: this.unit, fontSize: 8, fill: '#90a0b8',
            fontStyle: 'bold', width: 28, align: 'center',
        }));

        // 圆心装饰
        this.group.add(new Konva.Circle({
            x: cx, y: cy, radius: R * 0.06,
            fill: '#3a4050', stroke: '#606880', strokeWidth: 1,
        }));
    }

    // ── 旋钮区（P Band / Reset / Rate）────────────────────────
    _drawKnobZone() {
        const kz = this._knobZone;

        // 旋钮区背景
        this.group.add(new Konva.Rect({
            x: kz.x, y: kz.y, width: kz.w, height: kz.h,
            fill: '#1e2230', stroke: '#2e3448', strokeWidth: 0.8,
            cornerRadius: 3,
        }));

        // 三个旋钮静态部分
        const labels = { pBand: 'P BAND %', resetTime: 'RESET min', rateTime: 'RATE min' };
        Object.entries(this._knobs).forEach(([key, k]) => {
            // 旋钮外环凹槽
            this.group.add(new Konva.Circle({
                x: k.x, y: k.y, radius: k.r * 1.20,
                fill: '#141820', stroke: '#3a4050', strokeWidth: 1,
            }));
            // 旋钮主体（深铝色）
            this.group.add(new Konva.Circle({
                x: k.x, y: k.y, radius: k.r,
                fillRadialGradientStartPoint: { x: -k.r*0.3, y: -k.r*0.3 },
                fillRadialGradientStartRadius: 0,
                fillRadialGradientEndPoint:   { x: 0, y: 0 },
                fillRadialGradientEndRadius:  k.r,
                fillRadialGradientColorStops: [0,'#7a8090', 0.5,'#5a6070', 1,'#3a4050'],
                stroke: '#2a3040', strokeWidth: 1,
            }));
            // 旋钮标签
            this.group.add(new Konva.Text({
                x: k.x - 28, y: k.y + k.r + 3, width: 56,
                text: labels[key], fontSize: 6, fill: '#8090a8',
                align: 'center', fontStyle: 'bold',
            }));
        });
    }

    // ── 内部机构剖视区 ───────────────────────────────────────
    _drawMechSection() {
        const mr = this._mechRect;

        // 剖视背景（深蓝-黑）
        this.group.add(new Konva.Rect({
            x: mr.x, y: mr.y, width: mr.w, height: mr.h,
            fill: '#080c14', stroke: '#1e2838', strokeWidth: 0.8,
            cornerRadius: 3,
        }));

        // 标题
        this.group.add(new Konva.Text({
            x: mr.x + 4, y: mr.y + 3, width: 80,
            text: '— MECHANISM —', fontSize: 5.5,
            fill: 'rgba(160,190,220,0.40)', fontStyle: 'bold italic',
        }));

        const W  = this.width;
        const mx = mr.x, my = mr.y + 18, mw = mr.w, mh = mr.h - 22;

        // ── 气路基准线 ──
        this.group.add(new Konva.Line({
            points: [mx+4, my+mh*0.5, mx+mw-4, my+mh*0.5],
            stroke: 'rgba(80,140,200,0.15)', strokeWidth: 1, dash:[3,3],
        }));

        // ── 测量波纹管（左侧）──
        this._drawBellows(mx+10, my+mh*0.15, 22, mh*0.70, '#4a90c0', '测量\nPV');

        // ── 设定波纹管 ──
        this._drawBellows(mx+38, my+mh*0.25, 20, mh*0.50, '#60b060', 'SP');

        // ── 力矩杆（水平横梁）──
        this.group.add(new Konva.Rect({
            x: mx+24, y: my+mh*0.44, width: mw*0.36, height: 3,
            fill: '#b0a060', stroke: '#907040', strokeWidth: 0.5,
            cornerRadius: 1,
        }));
        // 支点圆
        this.group.add(new Konva.Circle({
            x: mx+mw*0.28, y: my+mh*0.455, radius: 4,
            fill: '#d0b860', stroke: '#906830', strokeWidth: 0.8,
        }));

        // ── 喷嘴（小圆管）──
        const nzX = mx + mw*0.52, nzY = my + mh*0.25;
        this.group.add(new Konva.Rect({
            x: nzX, y: nzY, width: 6, height: mh*0.30,
            fill: '#505868', stroke: '#6a7280', strokeWidth: 0.5, cornerRadius: 1,
        }));
        this.group.add(new Konva.Ellipse({
            x: nzX+3, y: nzY, radiusX: 3, radiusY: 1.5,
            fill: '#1a1a1a', stroke: '#888', strokeWidth: 0.5,
        }));
        this.group.add(new Konva.Text({
            x: nzX-4, y: nzY+mh*0.31, text: 'NZ', fontSize: 5, fill: '#607080',
        }));

        // ── 继动器（矩形框，右侧）──
        const rlX = mx+mw*0.62, rlY = my+mh*0.15;
        this.group.add(new Konva.Rect({
            x: rlX, y: rlY, width: mw*0.17, height: mh*0.70,
            fill: '#1a2030', stroke: '#3a5060', strokeWidth: 0.8, cornerRadius: 2,
        }));
        this.group.add(new Konva.Text({
            x: rlX+2, y: rlY+mh*0.25, width: mw*0.17-4,
            text: 'RELAY', fontSize: 5.5, fill: '#507090', align: 'center', fontStyle: 'bold',
        }));

        // ── 比例反馈波纹管 ──
        this._drawBellows(mx+mw*0.60, my+mh*0.50, 12, mh*0.35, '#9060a0', 'P');

        // ── 积分波纹管（I）──
        this._drawBellows(mx+mw*0.76, my+mh*0.20, 14, mh*0.35, '#c07828', 'I');
        // 积分节流针阀（小菱形）
        this.group.add(new Konva.RegularPolygon({
            x: mx+mw*0.76+7, y: my+mh*0.60, sides:4, radius:4,
            fill:'#604020', stroke:'#c08040', strokeWidth:0.6, rotation:45,
        }));

        // ── 微分波纹管（D）──
        this._drawBellows(mx+mw*0.88, my+mh*0.20, 14, mh*0.35, '#c04040', 'D');
        // 微分节流针阀
        this.group.add(new Konva.RegularPolygon({
            x: mx+mw*0.88+7, y: my+mh*0.60, sides:4, radius:4,
            fill:'#602020', stroke:'#c04040', strokeWidth:0.6, rotation:45,
        }));

        // ── 气路连接线 ──
        const lineColor = 'rgba(100,160,200,0.28)';
        // 气源→继动器
        this.group.add(new Konva.Line({
            points:[mx+mw*0.62+mw*0.085, my+mh*0.15, mx+mw*0.62+mw*0.085, my+mh*0.05],
            stroke: lineColor, strokeWidth: 1.2,
        }));
        // 继动器→I波纹管
        this.group.add(new Konva.Line({
            points:[mx+mw*0.79, my+mh*0.45, mx+mw*0.83, my+mh*0.45],
            stroke: lineColor, strokeWidth: 1, dash:[2,2],
        }));
        // 继动器→D波纹管
        this.group.add(new Konva.Line({
            points:[mx+mw*0.79, my+mh*0.40, mx+mw*0.95, my+mh*0.40],
            stroke: lineColor, strokeWidth: 1, dash:[2,2],
        }));
    }

    // 绘制单个波纹管（皱纹圆柱）
    _drawBellows(x, y, w, h, color, label) {
        const corrugations = Math.max(3, Math.floor(h / 8));
        const ch = h / corrugations;
        for (let i = 0; i < corrugations; i++) {
            const cy = y + i * ch;
            this.group.add(new Konva.Rect({
                x: x, y: cy, width: w, height: ch * 0.5,
                fill: color, stroke: 'rgba(0,0,0,0.3)', strokeWidth: 0.4,
                cornerRadius: 1,
            }));
            this.group.add(new Konva.Rect({
                x: x + w*0.05, y: cy + ch*0.5, width: w*0.90, height: ch*0.50,
                fill: this._darken(color), stroke: 'rgba(0,0,0,0.3)', strokeWidth: 0.3,
                cornerRadius: 0,
            }));
        }
        // 上下端盖
        this.group.add(new Konva.Rect({
            x: x-1, y: y-1, width: w+2, height: 3,
            fill: '#606880', stroke: '#404858', strokeWidth: 0.5, cornerRadius: 1,
        }));
        this.group.add(new Konva.Rect({
            x: x-1, y: y+h-2, width: w+2, height: 3,
            fill: '#606880', stroke: '#404858', strokeWidth: 0.5, cornerRadius: 1,
        }));
        // 标注
        this.group.add(new Konva.Text({
            x: x, y: y+h+4, width: w,
            text: label, fontSize: 5, fill: color,
            align: 'center', fontStyle: 'bold',
        }));
    }

    _darken(hex) {
        // 简单暗化：R/G/B 乘 0.6
        const c = parseInt(hex.replace('#',''), 16);
        const r = Math.floor(((c>>16)&0xff)*0.6);
        const g = Math.floor(((c>>8) &0xff)*0.6);
        const b = Math.floor((c      &0xff)*0.6);
        return `rgb(${r},${g},${b})`;
    }

    // ── 底部按钮行 ────────────────────────────────────────────
    _drawButtonRow() {
        const bz = this._btnZone;
        const btnH = bz.h * 0.80;

        // 背景
        this.group.add(new Konva.Rect({
            x: bz.x, y: bz.y, width: bz.w, height: bz.h,
            fill: '#141820', stroke: '#2a3040', strokeWidth: 0.6, cornerRadius: 2,
        }));

        // AUTO/MAN 指示
        const amX = bz.x + bz.w * 0.15;
        const amY = bz.y + bz.h * 0.10;
        this._amDot = new Konva.Circle({
            x: amX, y: amY + btnH/2,
            radius: btnH * 0.35,
            fill: this.autoMode ? '#22cc66' : '#cc4422',
            stroke: '#0a0a0a', strokeWidth: 0.6,
            shadowColor: this.autoMode ? '#22cc66' : '#cc4422',
            shadowBlur: 4, shadowOpacity: 0.8,
        });
        this.group.add(this._amDot);
        this._amText = new Konva.Text({
            x: amX + btnH*0.5, y: amY + btnH*0.1,
            text: this.autoMode ? 'AUTO' : 'MAN',
            fontSize: 6.5, fill: this.autoMode ? '#22cc66' : '#cc4422',
            fontStyle: 'bold',
        });
        this.group.add(this._amText);

        // 动作方式
        this.group.add(new Konva.Text({
            x: bz.x + bz.w*0.38, y: amY + btnH*0.10,
            text: this.action === 'reverse' ? '↔ REV' : '→ DIR',
            fontSize: 6.5, fill: '#7090b0', fontStyle: 'bold',
        }));

        // 控制模式
        this._modeText = new Konva.Text({
            x: bz.x + bz.w*0.66, y: amY + btnH*0.10,
            text: `◉ ${this.controlMode}`,
            fontSize: 6.5, fill: '#c0a830', fontStyle: 'bold',
        });
        this.group.add(this._modeText);
    }

    // ── 气路接口行 ────────────────────────────────────────────
    _drawPortRow() {
        const pz = this._portZone;

        // 接口背景
        this.group.add(new Konva.Rect({
            x: pz.x, y: pz.y, width: pz.w, height: pz.h + 6,
            fill: '#0e1218', stroke: '#1e2830', strokeWidth: 0.6,
            cornerRadius: [0, 0, 4, 4],
        }));

        const ports = [
            { frac: 0.12, label: 'AIR SUP', color: '#70a0d0' },
            { frac: 0.37, label: 'IN(PV)',  color: '#50c080' },
            { frac: 0.63, label: 'SP',      color: '#a0b040' },
            { frac: 0.88, label: 'OUT',     color: '#d07040' },
        ];
        ports.forEach(({ frac, label, color }) => {
            const px = pz.x + pz.w * frac;
            const py = pz.y + 2;
            // 气管接头（小圆柱）
            this.group.add(new Konva.Rect({
                x: px-4, y: py, width: 8, height: 5,
                fill: '#888', stroke: '#555', strokeWidth: 0.5, cornerRadius: 1,
            }));
            this.group.add(new Konva.Text({
                x: px-12, y: py + 6, width: 24,
                text: label, fontSize: 5, fill: color, align: 'center',
            }));
        });
    }

    // ── 顶部标注 ──────────────────────────────────────────────
    _drawLabel() {
        const W = this.width;
        this.group.add(new Konva.Text({
            x: 0, y: -16, width: W,
            text: `${this.label}  ${this.model}  ${this.pvRangeMin}~${this.pvRangeMax}${this.unit}`,
            fontSize: 8.5, fontStyle: 'bold', fill: '#607888', align: 'center',
        }));
    }

    // ═══════════════════════════════════════════════════════════
    // 动态图层（指针 + 旋钮刻度线 + 机构动画）
    // ═══════════════════════════════════════════════════════════
    _buildDynamic() {
        this._dynGroup = new Konva.Group();
        this.group.add(this._dynGroup);
        this._rebuildDynamic();
    }

    _rebuildDynamic() {
        this._dynGroup.destroyChildren();
        this._drawPointers();
        this._drawKnobNeedles();
        this._drawRelayPressureBar();
        this._drawFlapperAnimation();
        this._drawBellowsDynamic();
    }

    // ── 指针（PV 红色 + SP 绿色）────────────────────────────
    _drawPointers() {
        const cx = this._dialCx;
        const cy = this._dialCy;
        const R  = this._dialR;
        const startAngle = -110;
        const totalAngle = 220;

        const drawPtr = (frac, color, width, length, glowColor) => {
            const angleDeg = startAngle + frac * totalAngle;
            const angleRad = angleDeg * Math.PI / 180;
            const glow = this._glowPulse;

            // 指针光晕
            if (glowColor) {
                this._dynGroup.add(new Konva.Line({
                    points: [cx, cy, cx + Math.cos(angleRad)*R*length, cy + Math.sin(angleRad)*R*length],
                    stroke: glowColor,
                    strokeWidth: width + 4 + glow * 2,
                    opacity: 0.12 + glow * 0.08,
                    lineCap: 'round',
                }));
            }

            // 指针主体（渐变）
            this._dynGroup.add(new Konva.Arrow({
                points: [cx, cy, cx + Math.cos(angleRad)*R*length, cy + Math.sin(angleRad)*R*length],
                stroke: color, fill: color,
                strokeWidth: width, pointerLength: 5, pointerWidth: 3,
                lineCap: 'round',
            }));

            // 尾部小段（配重效果）
            this._dynGroup.add(new Konva.Line({
                points: [
                    cx, cy,
                    cx + Math.cos(angleRad + Math.PI)*R*0.12,
                    cy + Math.sin(angleRad + Math.PI)*R*0.12,
                ],
                stroke: color, strokeWidth: width * 0.7, lineCap: 'round',
            }));
        };

        // SP 指针（绿色，稍短）
        drawPtr(this._sp, '#22cc66', 1.0, 0.73, '#22cc66');
        // PV 指针（红色，稍长）
        drawPtr(this._pv, '#ff4444', 1.5, 0.83, '#ff4444');

        // 圆心盖板
        this._dynGroup.add(new Konva.Circle({
            x: cx, y: cy, radius: R * 0.055,
            fill: '#d0c870', stroke: '#907040', strokeWidth: 0.8,
        }));

        // OUT 数字显示（表盘下方）
        const outPres = (0.2 + this._out * 0.8).toFixed(2);
        this._dynGroup.add(new Konva.Text({
            x: cx - 32, y: cy - R * 0.22,
            width: 64,
            text: `OUT: ${outPres} kgf/cm²`,
            fontSize: 6.5, fill: '#c8a030', align: 'center', fontStyle: 'bold',
        }));
    }

    // ── 旋钮刻度指示线 ───────────────────────────────────────
    _drawKnobNeedles() {
        Object.entries(this._knobs).forEach(([key, k]) => {
            const val = k.val();
            const frac = (val - k.min) / (k.max - k.min);
            const angleRad = (-150 + frac * 300) * Math.PI / 180;
            const r = k.r;

            // 旋钮主体（带旋转纹路）
            this._dynGroup.add(new Konva.Circle({
                x: k.x, y: k.y, radius: r * 0.88,
                fill: '#4a5060',
                fillRadialGradientStartPoint: { x:-r*0.25, y:-r*0.25 },
                fillRadialGradientStartRadius: 0,
                fillRadialGradientEndPoint:   { x:0, y:0 },
                fillRadialGradientEndRadius:  r*0.88,
                fillRadialGradientColorStops: [0,'#6a7280', 0.6,'#4a5060', 1,'#2a3040'],
                stroke: '#2a3040', strokeWidth: 0.6,
            }));

            // 旋钮指示线
            this._dynGroup.add(new Konva.Line({
                points: [
                    k.x + Math.cos(angleRad) * r * 0.30,
                    k.y + Math.sin(angleRad) * r * 0.30,
                    k.x + Math.cos(angleRad) * r * 0.78,
                    k.y + Math.sin(angleRad) * r * 0.78,
                ],
                stroke: '#f0e080', strokeWidth: 1.5, lineCap: 'round',
            }));

            // 旋钮数值
            this._dynGroup.add(new Konva.Text({
                x: k.x - 20, y: k.y - 6, width: 40,
                text: val < 10 ? val.toFixed(2) : Math.round(val).toString(),
                fontSize: 6.5, fill: '#f0e080', align: 'center', fontStyle: 'bold',
            }));
        });
    }

    // ── 继动器输出压力条 ──────────────────────────────────────
    _drawRelayPressureBar() {
        const mr = this._mechRect;
        const rlX = mr.x + mr.w*0.62;
        const rlY = mr.y + 18 + (mr.h-22)*0.15;
        const rlW = mr.w*0.17;
        const rlH = (mr.h-22)*0.70;

        const fillH = rlH * 0.85 * this._relayPres;
        const fillY = rlY + rlH * 0.85 - fillH;

        const c = this._relayPres;
        const r = Math.floor(80 + c * 120);
        const g = Math.floor(100 + c * 80);
        const b = Math.floor(200 - c * 100);

        this._dynGroup.add(new Konva.Rect({
            x: rlX + 2, y: fillY, width: rlW - 4, height: fillH,
            fill: `rgba(${r},${g},${b},0.55)`,
            cornerRadius: 1,
        }));
    }

    // ── 挡板偏转动画 ──────────────────────────────────────────
    _drawFlapperAnimation() {
        const mr  = this._mechRect;
        const mx  = mr.x, my = mr.y + 18, mh = mr.h - 22;
        const nzX = mx + mr.w*0.52 + 3;
        const nzY = my + mh * 0.25;

        // 挡板（相对喷嘴端移动）
        const gap = this._clamp01(1 - this._out) * mh * 0.12 + 1.5;
        this._dynGroup.add(new Konva.Rect({
            x: nzX - 8, y: nzY - gap - 4,
            width: 8, height: 4,
            fill: '#b0a060', stroke: '#907040', strokeWidth: 0.4, cornerRadius: 1,
        }));

        // 喷嘴气体泄漏（导通时有气流效果）
        if (gap > 3) {
            const alpha = Math.min(1, (gap - 3) / 6) * 0.5;
            for (let i = 0; i < 2; i++) {
                const dx = (i - 0.5) * 5;
                this._dynGroup.add(new Konva.Line({
                    points: [nzX + dx, nzY, nzX + dx + (Math.random()-0.5)*3, nzY - gap * 1.5],
                    stroke: `rgba(180,200,255,${alpha})`,
                    strokeWidth: 0.8, lineCap: 'round', dash:[1,2],
                }));
            }
        }
    }

    // ── 波纹管伸缩动画 ───────────────────────────────────────
    _drawBellowsDynamic() {
        // 测量波纹管伸缩量与 PV 相关
        const mr   = this._mechRect;
        const mx   = mr.x, my = mr.y + 18, mh = mr.h - 22;
        const pvH  = mh * 0.70 * (0.6 + this._pv * 0.40);
        const pvY  = my + mh * 0.15 + (mh * 0.70 - pvH);

        // 测量波纹管高亮
        this._dynGroup.add(new Konva.Rect({
            x: mx + 9, y: pvY, width: 24, height: pvH,
            stroke: `rgba(74,144,192,${0.3 + this._pv * 0.3})`,
            strokeWidth: 0.8, cornerRadius: 1,
        }));

        // 力矩杆偏角（PV - SP 差值驱动）
        const err  = this._sp - this._pv; // 反作用：SP > PV 时关小出口
        const beamAngle = err * 12;        // °
        const bx1  = mx + 24, by1 = my + mh * 0.455;
        const bLen = mr.w * 0.36;
        const aRad = beamAngle * Math.PI / 180;

        this._dynGroup.add(new Konva.Line({
            points: [
                bx1, by1,
                bx1 + Math.cos(aRad) * bLen, by1 + Math.sin(aRad) * bLen,
            ],
            stroke: '#d0c060', strokeWidth: 2, lineCap: 'round',
        }));
    }

    // ═══════════════════════════════════════════════════════════
    // 动画循环
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
        this._simTime   += dt;
        this._glowPulse  = 0.5 + 0.5 * Math.sin(this._simTime * 3);
        this._bellowAnim = (this._bellowAnim + dt) % (2 * Math.PI);

        if (this.autoMode) {
            this._computePID(dt);
        } else {
            this._out = this._manOut;
        }

        // 继动器压力跟随输出（带 RC 滞后）
        this._relayPres += (this._out - this._relayPres) * Math.min(1, dt * 8);

        this._rebuildDynamic();
        this._updateStatus();
        this._refreshCache();
    }

    // ── 气动 PID 算法（增量式离散实现）───────────────────────
    _computePID(dt) {
        const err = this._sp - this._pv;

        // 比例增益 Kc = 100 / P_Band
        const Kc = 100 / this.pBand;

        // 积分（速度型，防饱和）
        if (this.controlMode === 'PI' || this.controlMode === 'PID') {
            const Ti = this.resetTime * 60;  // 转换为 s
            this._integral += Kc / Ti * err * dt;
            this._integral = this._clamp01(this._integral);
        }

        // 微分（微分-on-PV，带一阶滤波）
        let deriv = 0;
        if (this.controlMode === 'PID' && this.rateTime > 0) {
            const Td  = this.rateTime * 60;  // 转换为 s
            const Tf  = Td / 8;              // 微分滤波时间常数
            const raw = -(this._pv - this._prevPV) / dt; // 负号：微分-on-PV
            this._derivBuf += (raw - this._derivBuf) * Math.min(1, dt / (Tf + dt));
            deriv = Kc * Td * this._derivBuf;
        }
        this._prevPV = this._pv;
        this._prevErr = err;

        // 比例输出（以 SP 为中心，0.5 对应 50% = 0.6 kgf/cm²）
        let rawOut = 0.5 + Kc * err + this._integral - 0.5 + deriv;

        // 反作用：反转输出
        if (this.action === 'reverse') rawOut = 1 - rawOut;

        this._out = this._clamp01(rawOut);
    }

    // ── 更新状态显示 ──────────────────────────────────────────
    _updateStatus() {
        if (this._amDot) {
            this._amDot.fill(this.autoMode ? '#22cc66' : '#cc4422');
            this._amDot.shadowColor(this.autoMode ? '#22cc66' : '#cc4422');
        }
        if (this._amText) {
            this._amText.text(this.autoMode ? 'AUTO' : 'MAN');
            this._amText.fill(this.autoMode ? '#22cc66' : '#cc4422');
        }
        if (this._modeText) {
            this._modeText.text(`◉ ${this.controlMode}`);
        }
    }

    // ── 交互绑定 ──────────────────────────────────────────────
    _bindInteraction() {
        // 旋钮拖拽（纵向拖动改变参数值）
        Object.entries(this._knobs).forEach(([key, k]) => {
            const hitArea = new Konva.Circle({
                x: k.x, y: k.y, radius: k.r * 1.2,
                fill: 'transparent', listening: true,
            });
            this._dynGroup.add(hitArea);

            hitArea.on('mousedown touchstart', (e) => {
                const pos = e.evt.type === 'touchstart'
                    ? { y: e.evt.touches[0].clientY }
                    : { y: e.evt.clientY };
                this._dragging = { key, startY: pos.y, startVal: k.val() };
                e.cancelBubble = true;
            });
        });

        const onMove = (e) => {
            if (!this._dragging) return;
            const { key, startY, startVal } = this._dragging;
            const k = this._knobs[key];
            const curY = e.type === 'touchmove' ? e.touches[0].clientY : e.clientY;
            const dy   = startY - curY; // 向上拖 = 增大
            const range = k.max - k.min;
            const newVal = this._clamp(startVal + dy * range / 150, k.min, k.max);
            this[key] = parseFloat(newVal.toFixed(key === 'pBand' ? 0 : 2));
            this._refreshCache();
        };

        const onUp = () => { this._dragging = null; };

        if (typeof window !== 'undefined') {
            window.addEventListener('mousemove', onMove);
            window.addEventListener('mouseup',   onUp);
            window.addEventListener('touchmove', onMove, { passive: true });
            window.addEventListener('touchend',  onUp);
        }

        // 点击 AUTO/MAN 区域切换
        const amHit = new Konva.Rect({
            x: this._btnZone.x, y: this._btnZone.y,
            width: this._btnZone.w * 0.30, height: this._btnZone.h,
            fill: 'transparent', listening: true,
        });
        this.group.add(amHit);
        amHit.on('click tap', () => {
            this.autoMode = !this.autoMode;
            if (!this.autoMode) this._manOut = this._out;
            this._refreshCache();
        });

        // 点击模式区域循环切换 P→PI→PID
        const modeHit = new Konva.Rect({
            x: this._btnZone.x + this._btnZone.w * 0.60, y: this._btnZone.y,
            width: this._btnZone.w * 0.40, height: this._btnZone.h,
            fill: 'transparent', listening: true,
        });
        this.group.add(modeHit);
        modeHit.on('click tap', () => {
            const seq = ['P', 'PI', 'PID'];
            this.controlMode = seq[(seq.indexOf(this.controlMode) + 1) % seq.length];
            if (this.controlMode === 'P') this._integral = 0.5;
            this._refreshCache();
        });
    }

    _clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

    // ═══════════════════════════════════════════════════════════
    // 公开 API
    // ═══════════════════════════════════════════════════════════

    /** 设置工艺变量（工程量） */
    setPV(value) {
        this._pv = this._clamp01((value - this.pvRangeMin) / (this.pvRangeMax - this.pvRangeMin));
        this._refreshCache();
    }

    /** 设置设定值（工程量） */
    setSP(value) {
        this._sp = this._clamp01((value - this.pvRangeMin) / (this.pvRangeMax - this.pvRangeMin));
        this._refreshCache();
    }

    /** 手动设置输出（仅 MAN 模式有效，0~1） */
    setManualOutput(frac) {
        if (!this.autoMode) {
            this._manOut = this._clamp01(frac);
            this._out    = this._manOut;
            this._refreshCache();
        }
    }

    /** 切换 AUTO / MAN */
    setAutoMode(auto) {
        if (!auto) this._manOut = this._out;
        this.autoMode = auto;
        this._refreshCache();
    }

    /** 读取当前 PV（工程量） */
    getPV()  { return this._pv  * (this.pvRangeMax - this.pvRangeMin) + this.pvRangeMin; }

    /** 读取当前 SP（工程量） */
    getSP()  { return this._sp  * (this.pvRangeMax - this.pvRangeMin) + this.pvRangeMin; }

    /** 读取当前输出（kgf/cm²） */
    getOutputPressure() { return 0.2 + this._out * 0.8; }

    /** 读取当前输出（归一化 0~1） */
    getOutputFrac() { return this._out; }

    update(state) {
        if (typeof state === 'object' && state !== null) {
            if (state.pv  !== undefined) this.setPV(state.pv);
            if (state.sp  !== undefined) this.setSP(state.sp);
            if (state.out !== undefined && !this.autoMode) this.setManualOutput(state.out);
            if (state.auto !== undefined) this.setAutoMode(state.auto);
        }
        this._refreshCache();
    }

    getConfigFields() {
        return [
            { label: '位号',              key: 'label',       type: 'text'   },
            { label: '型号',              key: 'model',       type: 'text'   },
            { label: '工程单位',          key: 'unit',        type: 'text'   },
            { label: '量程下限',          key: 'pvRangeMin',  type: 'number' },
            { label: '量程上限',          key: 'pvRangeMax',  type: 'number' },
            { label: '比例带 P (%)',       key: 'pBand',       type: 'number' },
            { label: '积分时间 Ti (min)',  key: 'resetTime',   type: 'number' },
            { label: '微分时间 Td (min)',  key: 'rateTime',    type: 'number' },
            { label: '控制模式 P/PI/PID', key: 'controlMode', type: 'text'   },
            { label: '动作方式 direct/reverse', key: 'action', type: 'text'  },
            { label: '气源压力 (kgf/cm²)', key: 'airSupply',  type: 'number' },
            { label: '初始 PV',           key: 'initPV',      type: 'number' },
            { label: '初始 SP',           key: 'initSP',      type: 'number' },
        ];
    }

    onConfigUpdate(cfg) {
        if (cfg.label)       this.label       = cfg.label;
        if (cfg.model)       this.model       = cfg.model;
        if (cfg.unit)        this.unit        = cfg.unit;
        if (cfg.pvRangeMin !== undefined) this.pvRangeMin = parseFloat(cfg.pvRangeMin);
        if (cfg.pvRangeMax !== undefined) this.pvRangeMax = parseFloat(cfg.pvRangeMax);
        if (cfg.pBand      !== undefined) this.pBand      = parseFloat(cfg.pBand);
        if (cfg.resetTime  !== undefined) this.resetTime  = parseFloat(cfg.resetTime);
        if (cfg.rateTime   !== undefined) this.rateTime   = parseFloat(cfg.rateTime);
        if (cfg.controlMode) this.controlMode = cfg.controlMode;
        if (cfg.action)      this.action      = cfg.action;
        if (cfg.airSupply  !== undefined) this.airSupply  = parseFloat(cfg.airSupply);
        if (cfg.initPV     !== undefined) this.setPV(parseFloat(cfg.initPV));
        if (cfg.initSP     !== undefined) this.setSP(parseFloat(cfg.initSP));
        this.config = { ...this.config, ...cfg };
        this._refreshCache();
    }

    destroy() { this._stopAnimation(); super.destroy?.(); }
}