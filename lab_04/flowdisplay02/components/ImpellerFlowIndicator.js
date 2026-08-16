import { BaseComponent } from './BaseComponent.js';

/**
 * 机械式叶轮流量指示器（Mechanical Impeller Flow Indicator）仿真组件
 *
 * ── 工作原理 ──────────────────────────────────────────────────
 *
 *  机械式叶轮流量指示器是一种纯机械、无需外部电源的就地流量
 *  显示仪表，广泛用于化工、给排水、暖通管道。
 *
 *  流体进入仪表后冲击**叶轮叶片**，叶轮旋转，转速与流量成正比：
 *
 *    n = Q / k_meter     （k_meter = 仪表系数，单位 m³/rev）
 *
 *  叶轮轴通过**磁耦合**（非接触穿越表壳）将转动传递给表盘内
 *  的**扇形流量指针**。指针偏转角对应当前**瞬时流量**。
 *
 *  ┌──────────────────────────────────────────────┐
 *  │         力矩平衡（扇形指针侧）               │
 *  │                                              │
 *  │  T_drive = k1 · n = k1 · Q / k_meter        │  驱动力矩（磁耦合）
 *  │  T_spring = k2 · α                           │  游丝反力矩（线性弹簧）
 *  │                                              │
 *  │  平衡时：k1·Q/k_meter = k2·α                │
 *  │   → α = (k1 / k2·k_meter) · Q              │
 *  │   → α ∝ Q（指针偏角正比于流量）             │
 *  └──────────────────────────────────────────────┘
 *
 * ── 结构组成 ──────────────────────────────────────────────────
 *
 *  1. 表体（Body）
 *     - 黄铜或不锈钢铸造，内置叶轮腔
 *     - 进口（IN）/ 出口（OUT）螺纹或法兰接头
 *     - 前表面：圆形玻璃观察窗
 *
 *  2. 叶轮（Impeller）
 *     - 位于管道横截面，轴线垂直于流向
 *     - 4~8 片叶片，绕水平轴旋转（正视图可见叶片轮廓）
 *     - 叶轮转速 n ∝ Q
 *     - 叶轮轴通过密封磁力耦合穿过表壳
 *
 *  3. 磁力耦合（Magnetic Coupling）
 *     - 内磁铁：随叶轮同步旋转（在流道侧）
 *     - 外磁铁：隔着不锈钢隔板，与内磁铁磁力耦合
 *     - 外磁铁驱动指示机构，实现无泄漏传动
 *
 *  4. 扇形刻度盘 + 指针（Scale Dial & Pointer）
 *     - 扇形刻度盘范围：0 ~ 120°（对应 0 ~ Qmax）
 *     - 刻度均匀分布（线性），附百分比或工程量标注
 *     - 指针：细长金属针，受游丝复位，平衡时指向当前流量刻度
 *     - 游丝（Hairspring）：将指针复位，断流时指针归零
 *
 *  5. 叶轮可视窗（Impeller View Window，侧视）
 *     - 部分型号设有透明观察窗，可直接看到叶轮旋转
 *     - 本仿真将叶轮旋转动画呈现在表体下半部分
 *
 *  6. 流量指示（Flow Indication）
 *     - 方式一：指针式（本仿真主要展示）
 *     - 方式二：旗帜/标志式（flag indicator，叶轮驱动彩色旗片翻转，
 *               仅做有/无流量判断，无定量）
 *
 * ── 叶轮物理仿真 ────────────────────────────────────────────
 *
 *  叶轮旋转动力学（一阶惯性 + 阻尼）：
 *    J · dω/dt = τ_fluid − D · ω
 *    τ_fluid = k_tau · Q    （水力矩正比于流量）
 *    稳态：ω_ss = k_tau · Q / D
 *
 *  指针偏转（二阶弹簧-阻尼，游丝驱动）：
 *    J_ptr · α̈ = k_mag · ω − k_spring · α − D_ptr · α̇
 *    k_mag · ω = 磁耦合传递的驱动力矩
 *    k_spring · α = 游丝复位力矩
 *    平衡：α_eq = k_mag · ω_ss / k_spring ∝ Q
 *
 * ── 视图说明 ────────────────────────────────────────────────
 *
 *  组件正视图，纵向布局：
 *
 *  ┌─────────────────────┐
 *  │    扇形指针表盘      │  ← 上半部分：指针式流量显示
 *  │   （玻璃观察窗）    │
 *  ├─────────────────────┤
 *  │    表体 + 叶轮腔    │  ← 下半部分：流道截面 + 叶轮旋转
 *  │   ←进水  出水→     │
 *  └─────────────────────┘
 *
 * ── 动态效果 ────────────────────────────────────────────────
 *
 *  - 叶轮叶片实时旋转（流量越大转速越快），带透视变形（椭圆投影）
 *  - 磁耦合磁力线（弧线）随旋转闪烁，体现磁耦合传动
 *  - 指针平滑偏转到对应流量刻度，有游丝振荡阻尼效果
 *  - 流体粒子在管道横截面随流量流动（穿过叶轮区）
 *  - 管道内流体颜色深浅反映流速
 *  - 状态栏实时显示：流量值、叶轮转速（rpm）、指针角度
 *
 * ── 端口 ─────────────────────────────────────────────────────
 *  terminal_in  — 进流口（左侧水平管道）
 *  terminal_out — 出流口（右侧水平管道）
 *
 * ── 交互 ─────────────────────────────────────────────────────
 *  setFlow(q)   设置瞬时流量（0 ~ Qmax）
 *  getReading() 返回指针当前指示流量值
 */
export class ImpellerFlowIndicator extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.width  = Math.max(200, config.width  || 260);
        this.height = Math.max(300, config.height || 360);

        this.type    = 'impeller_flow_indicator';
        this.special = 'none';
        this.cache   = 'fixed';

        this._initGroups();
        // ── 铭牌参数 ──
        this.label      = config.label      || 'FI';
        this.Qmax       = config.Qmax       || 10.0;    // 最大量程
        this.unit       = config.unit       || 'm³/h';
        this.DN         = config.DN         || 25;       // 公称通径 mm
        this.medium     = config.medium     || 'water';

        // ── 几何布局 ──
        const W = this.width, H = this.height;

        // 扇形表盘区（上半）
        this._dialCX    = W * 0.50;
        this._dialCY    = H * 0.35;
        this._dialR     = Math.min(W, H * 0.55) * 0.40;  // 表盘外径
        this._dialAngle = 120;     // 扇形总角度（°），对应 0~Qmax

        // 表体区（下半）
        this._bodyX     = W * 0.12;
        this._bodyY     = H * 0.58;
        this._bodyW     = W * 0.76;
        this._bodyH     = H * 0.26;

        // 叶轮腔（表体中央）
        this._impCX     = W * 0.50;
        this._impCY     = this._bodyY + this._bodyH * 0.50;
        this._impR      = Math.min(this._bodyW, this._bodyH) * 0.34;

        // 管道（水平，穿过叶轮腔）
        this._pipeR     = this._impR * 0.70;

        // 底座
        this._base = { x: W*0.04, y: H*0.87, w: W*0.92, h: H*0.09, rx: 3 };

        // 端子（左右水平管道端口）
        this._termInX  = 0;
        this._termInY  = this._impCY;
        this._termOutX = W;
        this._termOutY = this._impCY;

        // ── 物理状态 ──
        this._flow         = 0;           // 当前流量（归一化 0~1）
        this._targetFlow   = 0;
        this._lastRebuildFlow = -1;        // 上次视觉重建时的流量值
        this._impellerOmega= 0;           // 叶轮角速度（rad/s）
        this._impellerAngle= 0;           // 叶轮累积角度（rad）
        this._ptrAngle     = 0;           // 指针偏转角（rad）
        this._ptrVel       = 0;           // 指针角速度（rad/s）

        // 物理参数
        this._impJ         = 0.06;        // 叶轮转动惯量
        this._impDrag      = 1.20;        // 叶轮液体阻尼
        this._impTauK      = 2.80;        // 流体力矩系数
        this._ptrJ         = 0.08;        // 指针惯量
        this._ptrSpring    = 2.20;        // 游丝刚度
        this._ptrDamp      = 0.90;        // 指针阻尼
        this._magCoupling  = 1.60;        // 磁耦合系数

        // 叶轮片数及形态
        this._bladeN       = config.bladeN || 6;

        // 流体粒子
        this._particles    = [];
        this._pTimer       = 0;

        // 磁耦合相位
        this._magPhase     = 0;

        // ── 初始化 ──
        this._init();

        this.addPort(this._termInX,  this._termInY,  'terminal_in',  'pipe', 'IN');
        this.addPort(this._termOutX, this._termOutY, 'terminal_out', 'pipe', 'OUT');
    }

    // ══════════════════════════════════════════════════════════
    _init() {
        this._drawBackground();
        this._drawDialFrame();
        this._drawScaleTicks();
        this._drawBodyFrame();
        this._drawPipes();
        this._drawMagCouplingHousing();
        this._drawStaticLabels();
        this._drawStatusBar();
        this._initDynamicNodes();
    }

    // ── 背景 / 外壳 ──────────────────────────────────────────
    _drawBackground() {
        const W = this.width, H = this.height;
        const b = this._base;

        this._staticGroup.add(new Konva.Rect({
            x: 0, y: 0, width: W, height: H * 0.90,
            fill: '#1e1e22', stroke: '#2e2e36', strokeWidth: 1.5,
            cornerRadius: 7,
            shadowColor: '#000', shadowBlur: 10, shadowOffsetY: 4, shadowOpacity: 0.45,
        }));
        this._staticGroup.add(new Konva.Rect({
            x: b.x, y: b.y, width: b.w, height: b.h,
            fill: '#27272d', stroke: '#373740', strokeWidth: 1.2, cornerRadius: b.rx,
        }));
        [0.12, 0.50, 0.88].forEach(fx => {
            const sx = b.x + b.w * fx, sy = b.y + b.h / 2;
            const sr = this.width * 0.018;
            this._staticGroup.add(new Konva.Circle({ x: sx, y: sy, radius: sr, fill: '#888', stroke: '#555', strokeWidth: 0.7 }));
            this._staticGroup.add(new Konva.Line({ points: [sx-sr*0.6, sy, sx+sr*0.6, sy], stroke: '#444', strokeWidth: 1, lineCap: 'round' }));
            this._staticGroup.add(new Konva.Line({ points: [sx, sy-sr*0.6, sx, sy+sr*0.6], stroke: '#444', strokeWidth: 1, lineCap: 'round' }));
        });
    }

    // ── 扇形表盘外框（黄铜圈 + 玻璃面）──────────────────────
    _drawDialFrame() {
        const cx = this._dialCX, cy = this._dialCY;
        const R  = this._dialR;

        // 外黄铜圈
        this._staticGroup.add(new Konva.Circle({
            x: cx, y: cy, radius: R + 10,
            fillRadialGradientStartPoint:  { x: -R*0.3, y: -R*0.3 },
            fillRadialGradientEndPoint:    { x: 0, y: 0 },
            fillRadialGradientStartRadius: R * 0.2,
            fillRadialGradientEndRadius:   R + 10,
            fillRadialGradientColorStops:  [
                0, '#e0c060', 0.4, '#c8a030', 0.7, '#a07818', 1, '#786010',
            ],
            stroke: '#5a4008', strokeWidth: 1.5,
        }));

        // 玻璃表盘面
        this._staticGroup.add(new Konva.Circle({
            x: cx, y: cy, radius: R + 4,
            fill: '#f2f0e6', stroke: '#c8c090', strokeWidth: 1,
        }));

        // 扇形刻度盘背景（浅弧形区域）
        const startDeg = 180 + (180 - this._dialAngle) / 2;
        this._staticGroup.add(new Konva.Arc({
            x: cx, y: cy,
            innerRadius: R * 0.30, outerRadius: R * 0.96,
            angle: this._dialAngle,
            rotation: startDeg,
            fill: '#e8e4d6', stroke: '#c0b870', strokeWidth: 0.5,
        }));

        // 玻璃高光
        this._staticGroup.add(new Konva.Ellipse({
            x: cx - R * 0.22, y: cy - R * 0.28,
            radiusX: R * 0.28, radiusY: R * 0.14,
            fill: 'rgba(255,255,255,0.22)', rotation: -30,
        }));
    }

    // ── 扇形刻度（均匀线性）──────────────────────────────────
    _drawScaleTicks() {
        const cx  = this._dialCX, cy = this._dialCY;
        const R   = this._dialR;
        const totalDeg = this._dialAngle;

        // 起始角度：扇形以正下方为对称轴，向左右展开
        // 0 刻度在左侧 startDeg，Qmax 在右侧
        const startDeg = 180 + (180 - totalDeg) / 2;  // 指针零位（度）
        this._ptrStartRad = startDeg * Math.PI / 180;  // 缓存供绘制指针用

        const scaleG = new Konva.Group();
        const nMajor = 6;   // 0,20,40,60,80,100%（即 0, Qmax/5, … Qmax）
        const nMinor = 4;   // 每格之间 4 个小刻度

        const totalTicks = nMajor * nMinor;

        for (let i = 0; i <= totalTicks; i++) {
            const frac = i / totalTicks;
            const deg  = startDeg + frac * totalDeg;
            const rad  = deg * Math.PI / 180;
            const isMajor = i % nMinor === 0;
            const tLen = isMajor ? 11 : 5;

            const x1 = cx + R * 0.82 * Math.cos(rad);
            const y1 = cy + R * 0.82 * Math.sin(rad);
            const x2 = cx + (R * 0.82 + tLen) * Math.cos(rad);
            const y2 = cy + (R * 0.82 + tLen) * Math.sin(rad);

            scaleG.add(new Konva.Line({
                points: [x1, y1, x2, y2],
                stroke: isMajor ? '#444' : '#888',
                strokeWidth: isMajor ? 1.4 : 0.7,
            }));

            if (isMajor) {
                const qVal = (this.Qmax * frac).toFixed(this.Qmax < 1 ? 2 : 1);
                const lx = cx + (R * 0.82 + 19) * Math.cos(rad);
                const ly = cy + (R * 0.82 + 19) * Math.sin(rad);
                scaleG.add(new Konva.Text({
                    x: lx - 14, y: ly - 6, width: 28, height: 12,
                    text: qVal, fontSize: 8, fontFamily: 'monospace',
                    fill: '#555', align: 'center', verticalAlign: 'middle',
                }));
            }
        }

        // 量程单位
        scaleG.add(new Konva.Text({
            x: cx - 20, y: cy - R * 0.22,
            width: 40,
            text: this.unit, fontSize: 7, fontStyle: 'bold',
            fill: '#7a6020', align: 'center',
        }));

        // 红色警戒区（后 20% 刻度区域加红色弧）
        const warnStart = startDeg + totalDeg * 0.80;
        scaleG.add(new Konva.Arc({
            x: cx, y: cy,
            innerRadius: R * 0.76, outerRadius: R * 0.92,
            angle: totalDeg * 0.20,
            rotation: warnStart,
            fill: 'rgba(220,60,60,0.18)',
            stroke: 'rgba(200,40,40,0.25)', strokeWidth: 0.5,
        }));

        this._staticGroup.add(scaleG);
    }

    // ── 表体外壳（叶轮腔）────────────────────────────────────
    _drawBodyFrame() {
        const bx = this._bodyX, by = this._bodyY;
        const bw = this._bodyW, bh = this._bodyH;
        const cx = this._impCX, cy = this._impCY;
        const R  = this._impR;

        // 表体主体（黄铜渐变矩形）
        this._staticGroup.add(new Konva.Rect({
            x: bx, y: by, width: bw, height: bh,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint:   { x: 0, y: bh },
            fillLinearGradientColorStops: [
                0, '#9a7c28', 0.25, '#c8a840', 0.50, '#e0c060',
                0.75, '#c8a840', 1, '#8a6c20',
            ],
            stroke: '#5a4008', strokeWidth: 1.5, cornerRadius: 4,
            shadowColor: '#000', shadowBlur: 5, shadowOffsetY: 2, shadowOpacity: 0.35,
        }));

        // 叶轮腔圆孔（透视窗，内有液体背景）
        this._staticGroup.add(new Konva.Circle({
            x: cx, y: cy, radius: R + 6,
            fill: '#3a3a40', stroke: '#606068', strokeWidth: 2,
        }));
        this._staticGroup.add(new Konva.Circle({
            x: cx, y: cy, radius: R + 2,
            fill: '#2a3a50',
        }));

        // 腔体内侧高光
        this._staticGroup.add(new Konva.Circle({
            x: cx, y: cy, radius: R + 2,
            fill: 'none',
            stroke: 'rgba(120,180,240,0.18)', strokeWidth: 4,
        }));

        // 腔体玻璃观察窗口边框
        this._staticGroup.add(new Konva.Circle({
            x: cx, y: cy, radius: R + 6,
            fill: 'none',
            stroke: 'rgba(220,200,130,0.55)', strokeWidth: 1,
        }));

        // 表体安装螺栓（4角）
        [
            [bx + 8,      by + 8],
            [bx + bw - 8, by + 8],
            [bx + 8,      by + bh - 8],
            [bx + bw - 8, by + bh - 8],
        ].forEach(([sx, sy]) => {
            const sr = this.width * 0.018;
            this._staticGroup.add(new Konva.Circle({ x:sx, y:sy, radius:sr, fill:'#8a8a8a', stroke:'#606060', strokeWidth:0.8 }));
            this._staticGroup.add(new Konva.Line({ points:[sx-sr*0.6,sy,sx+sr*0.6,sy], stroke:'#505050', strokeWidth:0.9, lineCap:'round' }));
            this._staticGroup.add(new Konva.Line({ points:[sx,sy-sr*0.6,sx,sy+sr*0.6], stroke:'#505050', strokeWidth:0.9, lineCap:'round' }));
        });
    }

    // ── 进出水管（水平）──────────────────────────────────────
    _drawPipes() {
        const W  = this.width;
        const cy = this._impCY;
        const r  = this._pipeR;
        const bx = this._bodyX, bxR = this._bodyX + this._bodyW;

        // 左进水管
        this._staticGroup.add(new Konva.Rect({
            x: 0, y: cy - r, width: bx, height: r * 2,
            fillLinearGradientStartPoint: { x:0, y:0 },
            fillLinearGradientEndPoint:   { x:0, y:r*2 },
            fillLinearGradientColorStops: [0,'#555',0.35,'#aaa',0.65,'#888',1,'#555'],
            stroke: '#404040', strokeWidth: 1,
        }));
        // 右出水管
        this._staticGroup.add(new Konva.Rect({
            x: bxR, y: cy - r, width: W - bxR, height: r * 2,
            fillLinearGradientStartPoint: { x:0, y:0 },
            fillLinearGradientEndPoint:   { x:0, y:r*2 },
            fillLinearGradientColorStops: [0,'#555',0.35,'#aaa',0.65,'#888',1,'#555'],
            stroke: '#404040', strokeWidth: 1,
        }));
        // 端部法兰
        this._staticGroup.add(new Konva.Ellipse({ x:0, y:cy, radiusX:4, radiusY:r*1.35, fill:'#888', stroke:'#666', strokeWidth:1.2 }));
        this._staticGroup.add(new Konva.Ellipse({ x:W, y:cy, radiusX:4, radiusY:r*1.35, fill:'#888', stroke:'#666', strokeWidth:1.2 }));

        // 管内液体
        this._staticGroup.add(new Konva.Rect({
            x: 2, y: cy - r + 2, width: bx - 2, height: r * 2 - 4,
            fill: 'rgba(40,120,200,0.18)',
        }));
        this._staticGroup.add(new Konva.Rect({
            x: bxR, y: cy - r + 2, width: W - bxR - 2, height: r * 2 - 4,
            fill: 'rgba(40,120,200,0.18)',
        }));
    }

    // ── 磁耦合外壳（表体上方突起）────────────────────────────
    _drawMagCouplingHousing() {
        const cx = this._impCX, cy = this._impCY;
        const hw = this.width * 0.12;
        const hh = this._bodyY - this._dialCY - this._dialR * 0.18;

        // 磁耦合筒体（连接叶轮腔与表盘的传动筒）
        this._staticGroup.add(new Konva.Rect({
            x: cx - hw/2, y: this._dialCY + this._dialR * 0.14,
            width: hw, height: hh + this._bodyY - (this._dialCY + this._dialR*0.14),
            fillLinearGradientStartPoint: { x:0, y:0 },
            fillLinearGradientEndPoint:   { x:hw, y:0 },
            fillLinearGradientColorStops: [0,'#5a5058',0.35,'#909098',0.65,'#a0a0a8',1,'#5a5058'],
            stroke: '#404048', strokeWidth: 0.8,
        }));

        // 磁耦合标注
        this._staticGroup.add(new Konva.Text({
            x: cx - 22, y: this._bodyY - 14,
            text: '磁力耦合', fontSize: 6.5,
            fill: 'rgba(160,160,180,0.70)',
            fontStyle: 'italic',
        }));
    }

    // ── 静态标注 ─────────────────────────────────────────────
    _drawStaticLabels() {
        const W = this.width;
        const cx = this._impCX;

        // 铭牌
        this._staticGroup.add(new Konva.Text({
            x: 0, y: -16, width: W,
            text: `${this.label}  叶轮流量指示器  DN${this.DN}`,
            fontSize: 9, fontStyle: 'bold', fill: '#8ab4f8', align: 'center',
        }));

        // 进出水标注
        this._staticGroup.add(new Konva.Text({ x:2, y:this._impCY - this._pipeR - 14, text:'IN', fontSize:8, fontStyle:'bold', fill:'#90caf9' }));
        this._staticGroup.add(new Konva.Text({ x:W - 22, y:this._impCY - this._pipeR - 14, text:'OUT', fontSize:8, fontStyle:'bold', fill:'#80cbc4' }));

        // 叶轮注释
        this._staticGroup.add(new Konva.Text({
            x: this._bodyX, y: this._impCY + this._impR + 7, width: this._bodyW,
            text: '叶轮腔（透视窗）', fontSize: 7, fill: '#808080', align: 'center',
        }));

        // 结构标注引线
        const annoX = this._dialCX + this._dialR + 12;
        [
            { y: this._dialCY - this._dialR * 0.1,  text: '指针' },
            { y: this._dialCY + this._dialR * 0.55, text: '游丝' },
            { y: this._bodyY  + this._bodyH * 0.25, text: '磁耦合' },
            { y: this._impCY,                        text: '叶轮' },
        ].forEach(({ y, text }) => {
            this._staticGroup.add(new Konva.Line({
                points: [annoX - 20, y, annoX - 4, y],
                stroke: 'rgba(150,150,150,0.30)', strokeWidth: 0.8, dash: [3,3],
            }));
            this._staticGroup.add(new Konva.Text({
                x: annoX, y: y - 5, text,
                fontSize: 7, fill: '#808080',
            }));
        });

        // 原理公式
        this._staticGroup.add(new Konva.Text({
            x: W * 0.02, y: this._base.y - 22, width: W * 0.96,
            text: 'α ∝ Q  |  n ∝ Q  |  磁力耦合传动',
            fontSize: 6.5, fill: 'rgba(160,155,100,0.55)',
            align: 'center', fontStyle: 'italic',
        }));
    }

    // ── 状态栏 ───────────────────────────────────────────────
    _drawStatusBar() {
        const b = this._base;

        this._sDot = new Konva.Circle({
            x: b.x + 10, y: b.y + b.h/2, radius: 4,
            fill: '#ef5350', stroke: '#c62828', strokeWidth: 0.8,
            shadowColor: '#ef5350', shadowBlur: 2, shadowOpacity: 0.6,
        });
        this._sQ = new Konva.Text({
            x: b.x + 22, y: b.y + b.h/2 - 5, width: 90,
            text: `Q: 0.0 ${this.unit}`, fontSize: 8, fontStyle: 'bold', fill: '#90caf9',
        });
        this._sRpm = new Konva.Text({
            x: b.x + 118, y: b.y + b.h/2 - 5, width: 75,
            text: '叶轮: 0 rpm', fontSize: 8, fill: '#a5d6a7',
        });
        this._sAngle = new Konva.Text({
            x: b.x + 198, y: b.y + b.h/2 - 5, width: 75,
            text: '指针: 0.0°', fontSize: 8, fill: '#ffcc80',
        });
        this._staticGroup.add(this._sDot, this._sQ, this._sRpm, this._sAngle);
    }

    // ══════════════════════════════════════════════════════════
    // 动态层（就地更新，无创建/销毁）
    // ══════════════════════════════════════════════════════════

    _initDynamicNodes() {
        const cx = this._impCX, cy = this._impCY, R = this._impR;
        const dcx = this._dialCX, dcy = this._dialCY, dr = this._dialR;

        // ── 腔内流体 ──
        this._nCavity = new Konva.Circle({ x: cx, y: cy, radius: R });
        this._nArcs = [];
        for (let i = 0; i < 3; i++) {
            this._nArcs.push(new Konva.Arc({ x: cx, y: cy, innerRadius:0, outerRadius:0, angle:0, rotation:0, visible:false }));
        }

        // ── 磁力线 ──
        this._nMagLines = [];
        for (let i = 0; i < 5; i++) {
            this._nMagLines.push(new Konva.Line({ points:[], stroke:'', strokeWidth:1.2, tension:0.5, dash:[3,4], lineCap:'round', visible:false }));
        }
        this._nMagGlow = new Konva.Circle({ x:0, y:0, radius:0, visible:false });

        // ── 叶轮组 ──
        this._nImpellerG = new Konva.Group({ x: cx, y: cy });
        this._nImpHub = new Konva.Ellipse({ x:0, y:0, radiusX:R*0.22, radiusY:R*0.22*0.42, fillRadialGradientStartPoint:{x:-R*0.08,y:-R*0.05}, fillRadialGradientEndPoint:{x:0,y:0}, fillRadialGradientStartRadius:R*0.04, fillRadialGradientEndRadius:R*0.22, fillRadialGradientColorStops:[0,'#d8d8e0',0.5,'#a0a0aa',1,'#484850'], stroke:'#404048', strokeWidth:0.8 });
        this._nImpBlades = [];
        for (let i = 0; i < this._bladeN; i++) {
            const b = new Konva.Line({ points:[], closed:true, stroke:'rgba(80,65,15,0.60)', strokeWidth:0.6 });
            this._nImpBlades.push(b);
            this._nImpellerG.add(b);
        }
        this._nImpHighlights = [];
        for (let i = 0; i < this._bladeN; i++) {
            const h = new Konva.Line({ points:[], stroke:'', strokeWidth:0.8, lineCap:'round', visible:false });
            this._nImpHighlights.push(h);
            this._nImpellerG.add(h);
        }
        this._nImpCenter = new Konva.Ellipse({ x:0, y:0, radiusX:R*0.08, radiusY:R*0.08*0.42, fill:'#d0d0d8', stroke:'#a0a0aa', strokeWidth:0.6 });
        this._nImpTrail = new Konva.Ellipse({ x:cx, y:cy, radiusX:0, radiusY:0, fill:'none', visible:false });
        this._nImpellerG.add(this._nImpHub, ...this._nImpBlades, ...this._nImpHighlights, this._nImpCenter);

        // ── 游丝 ──
        this._nSpring = new Konva.Line({ points:[], stroke:'', strokeWidth:1.2, lineCap:'round', lineJoin:'round' });

        // ── 指针 ──
        this._nPtrBody = new Konva.Line({ points:[], stroke:'#1a1a22', strokeWidth:2.0, lineCap:'round' });
        this._nPtrTip = new Konva.Line({ points:[], stroke:'#e03020', strokeWidth:2.0, lineCap:'round' });
        this._nPtrTail = new Konva.Line({ points:[], stroke:'#2a60b0', strokeWidth:3.0, lineCap:'round' });
        this._nPtrCtr = new Konva.Circle({ x:dcx, y:dcy, radius:dr*0.065, fillRadialGradientStartPoint:{x:-dr*0.02,y:-dr*0.02}, fillRadialGradientEndPoint:{x:0,y:0}, fillRadialGradientStartRadius:dr*0.01, fillRadialGradientEndRadius:dr*0.065, fillRadialGradientColorStops:[0,'#e8c860',0.5,'#c8a030',1,'#7a5808'], stroke:'#5a3e08', strokeWidth:0.8 });
        this._nPtrText = new Konva.Text({ x:0, y:0, width:36, text:'', fontSize:8, fontFamily:'monospace', fontStyle:'bold', fill:'#e03020', align:'center', shadowColor:'#fff', shadowBlur:2, shadowOpacity:0.7 });

        // ── 粒子池 ──
        this._nParticlePool = [];
        for (let i = 0; i < 30; i++) {
            this._nParticlePool.push(new Konva.Circle({ x:0, y:0, radius:1, fill:'transparent', visible:false }));
        }

        const allNodes = [
            this._nCavity, ...this._nArcs,
            ...this._nMagLines, this._nMagGlow,
            this._nImpellerG, this._nImpTrail,
            this._nSpring,
            this._nPtrBody, this._nPtrTip, this._nPtrTail, this._nPtrCtr, this._nPtrText,
            ...this._nParticlePool,
        ];
        allNodes.forEach(n => this._dynamicGroup.add(n));

        this._updateDynamic();
    }

    _updateDynamic() {
        this._updateFluidInCavity();
        this._updateMagCoupling();
        this._updateImpellerBlades();
        this._updateHairspring();
        this._updatePointer();
        this._updateParticles();
    }

    _updateFluidInCavity() {
        const cx = this._impCX, cy = this._impCY, R = this._impR;
        const q = this._flow;
        if (q < 0.005) {
            this._nCavity.visible(false);
            this._nArcs.forEach(a => a.visible(false));
            return;
        }
        this._nCavity.visible(true);
        const alpha = 0.10 + q * 0.22;
        this._nCavity.fill(`rgba(50,140,220,${alpha})`);

        for (let i = 0; i < 3; i++) {
            const phase = this._impellerAngle * 0.5 + (i+1) * Math.PI * 0.6;
            const arcR  = R * (0.25 + (i+1) * 0.20);
            const a0    = phase, a1 = phase + Math.PI * (0.6 + q * 0.6);
            this._nArcs[i].visible(true);
            this._nArcs[i].innerRadius(arcR - 1.5);
            this._nArcs[i].outerRadius(arcR + 1.5);
            this._nArcs[i].angle((a1 - a0) * 180 / Math.PI);
            this._nArcs[i].rotation(a0 * 180 / Math.PI);
            this._nArcs[i].fill(`rgba(100,200,255,${0.06 + q * 0.10})`);
        }
    }

    _updateMagCoupling() {
        const cx = this._impCX;
        const y0 = this._impCY - this._impR * 0.6;
        const y1 = this._bodyY;
        const spd = Math.abs(this._impellerOmega);

        if (spd < 0.3) {
            this._nMagLines.forEach(l => l.visible(false));
            this._nMagGlow.visible(false);
            return;
        }
        this._nMagGlow.visible(true);

        const alpha = Math.min(0.55, spd / 10 * 0.55);
        const phase = this._magPhase;
        for (let i = 0; i < 5; i++) {
            const t = i / 5;
            const x = cx + (Math.sin(phase + t * Math.PI * 2) * this.width * 0.04);
            const a = 0.12 + Math.abs(Math.sin(phase + t * Math.PI * 2)) * alpha;
            this._nMagLines[i].visible(true);
            this._nMagLines[i].points([x, y0, cx + (x - cx) * 0.4, (y0 + y1) / 2, cx, y1]);
            this._nMagLines[i].stroke(`rgba(180,130,255,${a})`);
        }

        this._nMagGlow.x(cx);
        this._nMagGlow.y((y0 + y1) / 2);
        this._nMagGlow.radius(this.width * 0.05);
        this._nMagGlow.fill(`rgba(180,100,255,${alpha * 0.12})`);
    }

    _updateImpellerBlades() {
        const cx = this._impCX, cy = this._impCY, R = this._impR;
        const N = this._bladeN;
        const ang = this._impellerAngle;
        const spd = Math.abs(this._impellerOmega);
        const glow = Math.min(1, spd / 8);
        const perspY = 0.42;

        this._nImpellerG.x(cx);
        this._nImpellerG.y(cy);

        this._nImpHub.radiusX(R * 0.22);
        this._nImpHub.radiusY(R * 0.22 * perspY);

        for (let i = 0; i < N; i++) {
            const bladeAng = ang + (i / N) * Math.PI * 2;
            const cosA = Math.cos(bladeAng);
            const sinA = Math.sin(bladeAng);
            const projY = sinA * perspY;
            const bLen = R * 0.85;
            const bw = R * 0.16 * Math.abs(cosA);
            const bladeAlpha = 0.55 + Math.abs(cosA) * 0.35;

            if (bw > 0.5) {
                this._nImpBlades[i].visible(true);
                this._nImpBlades[i].points([
                    -bw * 0.5, -projY * R * 0.22,
                     bw * 0.5, -projY * R * 0.22,
                     bw * 0.3,  projY * bLen,
                    -bw * 0.3,  projY * bLen,
                ]);
                this._nImpBlades[i].fillLinearGradientStartPoint({ x: 0, y: -projY*R*0.22 });
                this._nImpBlades[i].fillLinearGradientEndPoint({ x: 0, y: projY*bLen });
                this._nImpBlades[i].fillLinearGradientColorStops([
                    0, glow > 0.3 ? `rgba(220,195,90,${bladeAlpha})` : `rgba(175,150,55,${bladeAlpha})`,
                    0.5, `rgba(210,185,80,${bladeAlpha * 0.85})`,
                    1, `rgba(130,105,30,${bladeAlpha * 0.70})`,
                ]);
            } else {
                this._nImpBlades[i].visible(false);
            }

            // 高光
            if (Math.abs(cosA) > 0.5) {
                this._nImpHighlights[i].visible(true);
                this._nImpHighlights[i].points([0, -projY * R * 0.22, bw * 0.08, projY * bLen * 0.5]);
                this._nImpHighlights[i].stroke(`rgba(255,240,180,${0.15 + glow * 0.15})`);
            } else {
                this._nImpHighlights[i].visible(false);
            }
        }

        this._nImpCenter.radiusX(R * 0.08);
        this._nImpCenter.radiusY(R * 0.08 * perspY);

        // 拖尾
        if (glow > 0.3) {
            const trailAlpha = glow * 0.18;
            this._nImpTrail.visible(true);
            this._nImpTrail.radiusX(R * 0.72);
            this._nImpTrail.radiusY(R * 0.72 * perspY);
            this._nImpTrail.stroke(`rgba(200,180,80,${trailAlpha})`);
            this._nImpTrail.strokeWidth(R * 0.26);
        } else {
            this._nImpTrail.visible(false);
        }
    }

    _updateHairspring() {
        const cx = this._dialCX, cy = this._dialCY;
        const R = this._dialR * 0.24;
        const ang = this._ptrAngle;
        const nTurns = 3;
        const tension = ang / (this._dialAngle * Math.PI / 180);
        const color = tension > 0.80 ? '#d06010' : '#22a868';
        const pts = [];
        for (let i = 0; i <= nTurns * 48; i++) {
            const t = i / (nTurns * 48);
            const r = R * (0.30 + 0.70 * t);
            const a = -Math.PI * 0.8 + t * nTurns * Math.PI * 2 + ang * 0.45;
            pts.push(cx + r * Math.cos(a), cy + r * Math.sin(a));
        }
        this._nSpring.points(pts);
        this._nSpring.stroke(color);
        this._nSpring.opacity(0.35 + tension * 0.45);
    }

    _updatePointer() {
        const cx = this._dialCX, cy = this._dialCY;
        const R = this._dialR;
        const PL = R * 0.82;
        const PTL = R * 0.22;
        const rad = this._ptrStartRad + this._ptrAngle;
        const cosR = Math.cos(rad), sinR = Math.sin(rad);

        this._nPtrBody.points([cx - PTL * cosR, cy - PTL * sinR, cx + PL * cosR, cy + PL * sinR]);
        this._nPtrTip.points([cx + (PL - R * 0.18) * cosR, cy + (PL - R * 0.18) * sinR, cx + PL * cosR, cy + PL * sinR]);
        this._nPtrTail.points([cx - R * 0.06 * cosR, cy - R * 0.06 * sinR, cx - PTL * cosR, cy - PTL * sinR]);
        this._nPtrCtr.x(cx);
        this._nPtrCtr.y(cy);

        const qRead = this.getReading();
        this._nPtrText.x(cx + (PL + 10) * cosR - 18);
        this._nPtrText.y(cy + (PL + 10) * sinR - 6);
        this._nPtrText.text(qRead.toFixed(this.Qmax < 1 ? 2 : 1));
    }

    _updateParticles() {
        const cy = this._impCY;
        let idx = 0;
        this._particles.forEach(p => {
            if (p.x < 0 || p.x > this.width) return;
            const circle = this._nParticlePool[idx];
            if (!circle) return;
            idx++;
            const inCavity = Math.abs(p.x - this._impCX) < this._impR && Math.abs(p.y - this._impCY) < this._impR;
            const alpha = p.life * (inCavity ? 0.35 : 0.55);
            circle.visible(true);
            circle.x(p.x);
            circle.y(p.y);
            circle.radius(p.r);
            circle.fill(`rgba(130,200,255,${alpha})`);
        });
        for (let i = idx; i < this._nParticlePool.length; i++) {
            this._nParticlePool[i].visible(false);
        }
    }

    // ══════════════════════════════════════════════════════════
    // 物理仿真
    // ══════════════════════════════════════════════════════════

    tick(dt) {
        this._tickSimulation(dt);

        this._refreshIfDirty();
    }

    _tickSimulation(dt) {
        // 流量平滑跟随
        this._flow += (this._targetFlow - this._flow) * Math.min(1, dt / 0.12);

        // ── 叶轮旋转（一阶惯性 + 阻尼）──
        const tauFluid = this._impTauK * this._flow;
        const tauDrag  = -this._impDrag * this._impellerOmega;
        const impAcc   = (tauFluid + tauDrag) / this._impJ;
        this._impellerOmega += impAcc * dt;
        this._impellerOmega  = Math.max(0, this._impellerOmega);
        this._impellerAngle += this._impellerOmega * dt;

        // ── 磁耦合相位 ──
        this._magPhase += this._impellerOmega * dt * 2.5;

        // ── 指针（磁耦合驱动 + 游丝复位 + 阻尼）──
        const tDrive  = this._magCoupling * this._impellerOmega;
        const tSpring = -this._ptrSpring  * this._ptrAngle;
        const tDamp   = -this._ptrDamp    * this._ptrVel;
        const ptrAcc  = (tDrive + tSpring + tDamp) / this._ptrJ;
        this._ptrVel   += ptrAcc * dt;
        this._ptrAngle += this._ptrVel * dt;

        // 指针限位（0 ~ 扇形总角度）
        const ptrMax = this._dialAngle * Math.PI / 180;
        if (this._ptrAngle < 0)       { this._ptrAngle = 0;       this._ptrVel *= -0.12; }
        if (this._ptrAngle > ptrMax)  { this._ptrAngle = ptrMax;  this._ptrVel *= -0.12; }

        // ── 粒子系统 ──
        this._updateParticles(dt);

        // 就地更新动态节点（属性更新，无创建/销毁开销）
        this._updateDynamic();
        this.markDirty();

        this._updateStatusBar();
    }

    _updateParticles(dt) {
        const cy  = this._impCY;
        const vx  = 30 + this._flow * 100;   // 向右速度（px/s）

        this._particles = this._particles.filter(p => {
            p.x   += vx * dt;
            p.y   += (Math.random() - 0.5) * 3 * dt;
            p.life -= dt * (0.8 + this._flow * 0.5);
            return p.life > 0 && p.x < this.width + 5;
        });

        this._pTimer += dt;
        const rate  = this._flow * 16;
        const inter = rate > 0 ? 1 / rate : 999;
        const pr    = this._pipeR;

        while (this._pTimer > inter && this._flow > 0.01) {
            this._particles.push({
                x: 0,
                y: cy + (Math.random() - 0.5) * pr * 1.4,
                r: 1.0 + Math.random() * 1.8,
                life: 0.55 + Math.random() * 0.5,
            });
            this._pTimer -= inter;
        }
        if (rate === 0) this._pTimer = 0;
    }

    _updateStatusBar() {
        const q    = this._flow * this.Qmax;
        const rpm  = Math.round(this._impellerOmega * 60 / (2 * Math.PI));
        const deg  = (this._ptrAngle * 180 / Math.PI).toFixed(1);
        const act  = this._flow > 0.01;

        if (this._sDot) {
            this._sDot.fill(act ? '#29b6f6' : '#ef5350');
            this._sDot.stroke(act ? '#0277bd' : '#c62828');
            this._sDot.shadowColor(act ? '#29b6f6' : '#ef5350');
            this._sDot.shadowBlur(act ? 6 : 2);
        }
        if (this._sQ)     this._sQ.text(`Q: ${q.toFixed(1)} ${this.unit}`);
        if (this._sRpm)   this._sRpm.text(`叶轮: ${rpm} rpm`);
        if (this._sAngle) this._sAngle.text(`指针: ${deg}°`);
    }

    // ══════════════════════════════════════════════════════════
    // 公开 API
    // ══════════════════════════════════════════════════════════

    /**
     * 设置流量
     * @param {number} q  流量值（单位与 unit 一致），0 ~ Qmax
     */
    setFlow(q) {
        this._targetFlow = Math.max(0, Math.min(1, q / this.Qmax));
        this._tickSimulation(1.0);
        this._refreshCache();
    }

    /**
     * 获取指针当前指示的流量读数
     * @returns {number}  流量（与 unit 一致）
     */
    getReading() {
        const frac = this._ptrAngle / (this._dialAngle * Math.PI / 180);
        return Math.max(0, Math.min(1, frac)) * this.Qmax;
    }

    /** 获取叶轮当前转速（rpm） */
    getImpellerRpm() {
        return this._impellerOmega * 60 / (2 * Math.PI);
    }

    /** 获取指针偏角（°） */
    getPointerDeg() {
        return this._ptrAngle * 180 / Math.PI;
    }

    update(state) {
        if (typeof state === 'number') this.setFlow(state);
        this._refreshCache();
    }

    getConfigFields() {
        return [
            { label: '位号/名称',          key: 'label',    type: 'text'   },
            { label: '最大量程 Qmax',       key: 'Qmax',     type: 'number' },
            { label: '流量单位',            key: 'unit',     type: 'text'   },
            { label: '公称通径 DN (mm)',     key: 'DN',       type: 'number' },
            { label: '介质 (water/air)',    key: 'medium',   type: 'text'   },
            { label: '叶片数量',            key: 'bladeN',   type: 'number' },
            { label: '初始流量',            key: 'initFlow', type: 'number' },
            { label: '叶轮阻尼系数',        key: 'impDrag',  type: 'number' },
            { label: '游丝刚度',            key: 'ptrSpring',type: 'number' },
        ];
    }

    onConfigUpdate(cfg) {
        if (cfg.label)      this.label          = cfg.label;
        if (cfg.Qmax)       this.Qmax           = parseFloat(cfg.Qmax);
        if (cfg.unit)       this.unit           = cfg.unit;
        if (cfg.DN)         this.DN             = parseInt(cfg.DN);
        if (cfg.medium)     this.medium         = cfg.medium;
        if (cfg.bladeN)     this._bladeN        = parseInt(cfg.bladeN);
        if (cfg.impDrag)    this._impDrag       = parseFloat(cfg.impDrag);
        if (cfg.ptrSpring)  this._ptrSpring     = parseFloat(cfg.ptrSpring);
        if (cfg.initFlow !== undefined) this.setFlow(parseFloat(cfg.initFlow));
        this.config = { ...this.config, ...cfg };
        this._refreshCache();
    }

    destroy() {
        this._particles = [];
        super.destroy?.();
    }
}