import { BaseComponent } from './BaseComponent.js';

/**
 * 差压式本地流量显示仪表（DP Local Flow Indicator）仿真组件
 *
 * ── 工作原理 ──────────────────────────────────────────────────
 *
 *  差压式流量计利用流体流过节流元件时在其上下游产生的**静压差**
 *  来测量流量，是工业上最经典、应用最广泛的流量测量原理。
 *
 *  ┌──────────────────────────────────────────────────────────┐
 *  │                  伯努利方程推导                           │
 *  │                                                          │
 *  │  连续方程：  A₁·v₁ = A₂·v₂                              │
 *  │  伯努利方程：P₁ + ½ρv₁² = P₂ + ½ρv₂²                  │
 *  │                                                          │
 *  │  联立解得流量方程（孔板/文丘里管）：                     │
 *  │                                                          │
 *  │         Q = α · A₂ · √(2·ΔP / ρ)                       │
 *  │                                                          │
 *  │  其中：                                                  │
 *  │    α  = 流量系数（含流速系数与渐近速度系数）            │
 *  │    A₂ = 节流孔截面积                                     │
 *  │    ΔP = P₁ - P₂（上下游差压）                           │
 *  │    ρ  = 流体密度                                         │
 *  │                                                          │
 *  │  反推：ΔP = ρ·Q² / (2·α²·A₂²)  →  ΔP ∝ Q²（平方关系）│
 *  └──────────────────────────────────────────────────────────┘
 *
 * ── 结构组成 ──────────────────────────────────────────────────
 *
 *  本仪表为**孔板 + 法兰取压 + 本地差压指示计**的一体化组合：
 *
 *  1. 节流元件：标准孔板（Orifice Plate）
 *     - 安装于管道法兰之间的薄圆板，中央开孔
 *     - 开孔比 β = d/D（孔径 / 管内径），典型值 0.4~0.7
 *     - 孔口入口侧锐利边缘，出口侧斜切 45°
 *     - 流体通过时在孔口收缩形成**射流束（Vena Contracta）**
 *     - 上游取压口（P₁，高压侧）/ 下游取压口（P₂，低压侧）
 *       位于孔板上下游各 1D 处（法兰取压方式）
 *
 *  2. 差压导管（Impulse Lines / DP Legs）
 *     - 上游高压导管（正压管，+，红色）
 *     - 下游低压导管（负压管，-，蓝色）
 *     - 两根导管连至差压计
 *
 *  3. 差压计本体（DP Meter Body）
 *     - 内含 U 形压差管 / 隔膜式差压室
 *     - 差压推动浮子或膜片产生机械位移
 *     - 机械位移经连杆传递到指示指针
 *
 *  4. 浮子腔（Float Chamber）— U 管差压计模型
 *     - 两侧液柱高度差 Δh ∝ ΔP：  Δh = ΔP / (ρ_float · g)
 *     - 高压侧液面低，低压侧液面高
 *     - 浮子（Float）在低压侧随液面上升，驱动连杆
 *
 *  5. 连杆放大机构（Linkage Amplifier）
 *     - 浮子的小位移经杠杆放大为指针的大偏角
 *     - 传动比 k_link，决定满量程时的偏转角
 *
 *  6. 扇形指示表盘（Indicator Dial）
 *     - 扇形角 120°，刻度 0~Qmax
 *     - 刻度非线性（因 Q ∝ √ΔP，ΔP ∝ 液柱高度，刻度根号分布）
 *     - 实际仪表通过线性化凸轮修正，本仿真展示带凸轮修正的线性刻度
 *     - 指针：细长金属指针，轴心在表盘中央
 *
 *  7. 平衡阀 / 三阀组（3-Valve Manifold）
 *     - 高压截止阀（HV，正压侧隔离）
 *     - 低压截止阀（LV，负压侧隔离）
 *     - 平衡阀（EV，短路高低压导管，投运前平衡用）
 *     - 本仿真将三阀组简化为管道符号
 *
 * ── 动态仿真层次 ────────────────────────────────────────────
 *
 *  层1：管道内流体（粒子流动，流速与流量正比）
 *  层2：孔板射流束（孔口下游收缩再扩展，流量越大束越细）
 *  层3：上下游压力场（颜色标注高低压区域）
 *  层4：差压导管液柱（U 管两侧液面高度随 ΔP 变化）
 *  层5：浮子（跟随低压侧液面垂直位移）
 *  层6：连杆（将浮子位移转换为指针偏角）
 *  层7：指针平滑偏转（二阶阻尼系统响应）
 *  层8：孔板边缘紊流涡旋（流量越大，涡旋越强）
 *
 * ── 孔板物理仿真 ─────────────────────────────────────────────
 *
 *  给定归一化流量 q ∈ [0,1]：
 *    ΔP_norm = q²                            （平方关系）
 *    Δh_norm = ΔP_norm                       （U管液柱正比于ΔP）
 *    float_pos = Δh_norm                      （浮子位置）
 *    ptr_target = √(ΔP_norm) = q             （开方后恢复线性）
 *
 *  指针动力学（二阶弹簧-阻尼，模拟连杆惯量）：
 *    J·α̈ = k_drive·(ptr_target - α) - D·α̇
 *
 * ── 端口 ─────────────────────────────────────────────────────
 *  terminal_in   — 上游高压取压侧（管道进流端，左）
 *  terminal_out  — 下游低压取压侧（管道出流端，右）
 *  terminal_hp   — 高压导管引出口（+ 正压管）
 *  terminal_lp   — 低压导管引出口（- 负压管）
 *
 * ── 交互 ─────────────────────────────────────────────────────
 *  setFlow(q)    设置瞬时流量（0 ~ Qmax）
 *  getReading()  返回指针示数（经线性化后的流量值）
 *  getDeltaP()   返回当前差压值（单位：kPa）
 */
export class DpFlowIndicator extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.width  = Math.max(320, config.width  || 420);
        this.height = Math.max(320, config.height || 420);

        this.type    = 'dp_flow_indicator';
        this.special = 'none';
        this.cache   = 'fixed';

        this._initGroups();
        // ── 铭牌参数 ──
        this.label       = config.label       || 'FI';
        this.Qmax        = config.Qmax        || 20.0;      // 最大量程（m³/h）
        this.unit        = config.unit        || 'm³/h';
        this.DN          = config.DN          || 50;         // 公称通径 mm
        this.beta        = config.beta        || 0.55;       // 孔板开孔比 d/D
        this.dpMax       = config.dpMax       || 40.0;       // 满量程差压（kPa）
        this.medium      = config.medium      || 'water';

        // ── 几何布局 ──
        const W = this.width, H = this.height;

        // 管道区（水平，下半部分）
        this._pipeY      = H * 0.70;          // 管道中心线 y
        this._pipeR      = H * 0.068;         // 管道半径
        this._pipeX0     = W * 0.02;          // 管道起点 x
        this._pipeX1     = W * 0.98;          // 管道终点 x

        // 孔板位置（管道中央）
        this._orX        = W * 0.50;          // 孔板中心 x
        this._orW        = W * 0.022;         // 孔板厚度
        this._orHole     = this._pipeR * this.beta;  // 孔口半径

        // 上游取压口（孔板左侧 1D）
        this._tapHX      = this._orX - this._pipeR * 2.2;
        // 下游取压口（孔板右侧 1D）
        this._tapLX      = this._orX + this._pipeR * 2.2;

        // 差压导管（从取压口向上引出）
        this._impulseY0  = this._pipeY - this._pipeR;   // 导管起始 y（管道顶部）
        this._impulseY1  = H * 0.22;                    // 导管终止 y（差压计下方）

        // U 管差压计腔（仪表中上部）
        this._uCX        = W * 0.50;          // U 管中心 x
        this._uCY        = H * 0.28;          // U 管中心 y
        this._uW         = W * 0.28;          // U 管总宽（两管间距）
        this._uH         = H * 0.20;          // U 管液柱最大高度
        this._uTubeR     = W * 0.025;         // 单管内径

        // 连杆 + 扇形表盘（右侧）
        this._dialCX     = W * 0.76;
        this._dialCY     = H * 0.26;
        this._dialR      = Math.min(W, H) * 0.175;
        this._dialAngle  = 120;               // 扇形角（°）

        // 底座
        this._base = { x:W*0.03, y:H*0.90, w:W*0.94, h:H*0.08, rx:3 };

        // 端口
        this._termInX    = this._pipeX0;
        this._termOutX   = this._pipeX1;
        this._termHPX    = this._tapHX;
        this._termLPX    = this._tapLX;
        this._termPipeY  = H * 0.80;

        // ── 物理状态 ──
        this._flow       = 0;                 // 当前流量（归一化 0~1）
        this._targetFlow = 0;
        this._lastRebuildFlow = -1;            // 上次视觉重建时的流量值
        this._dpNorm     = 0;                 // 当前差压（归一化 0~1），= flow²
        this._uLevelH    = 0;                 // 高压侧液面高度（0~1，0=顶，下降）
        this._uLevelL    = 0;                 // 低压侧液面高度（0~1，上升）
        this._floatPos   = 0;                 // 浮子归一化位置（0=底，1=顶）
        this._ptrAngle   = 0;                 // 指针偏角（rad）
        this._ptrVel     = 0;                 // 指针角速度（rad/s）

        // 物理参数
        this._ptrJ       = 0.10;
        this._ptrSpring  = 3.50;
        this._ptrDamp    = 1.20;

        // 流体粒子
        this._particles  = [];
        this._pTimer     = 0;

        // 孔板涡旋
        this._vortices   = [];
        this._vTimer     = 0;

        // ── 初始化 ──
        this._init();

        this.addPort(this._termInX,  this._pipeY, 'terminal_in',  'pipe', 'IN');
        this.addPort(this._termOutX, this._pipeY, 'terminal_out', 'pipe', 'OUT');
        this.addPort(this._termHPX,  this._termPipeY, 'terminal_hp', 'pipe', 'H+');
        this.addPort(this._termLPX,  this._termPipeY, 'terminal_lp', 'pipe', 'L-');
    }

    // ══════════════════════════════════════════════════════════
    _init() {
        this._drawBackground();
        this._drawPipeBody();
        this._drawOrificeplate();
        this._drawTappings();
        this._drawImpulseLines();
        this._drawUTubeBody();
        this._drawManifoldValves();
        this._drawDialFrame();
        this._drawScaleTicks();
        this._drawStaticLabels();
        this._drawStatusBar();
        this._initDynamicNodes();
    }

    // ── 背景 / 外壳 ──────────────────────────────────────────
    _drawBackground() {
        const W = this.width, H = this.height;
        const b = this._base;

        this._staticGroup.add(new Konva.Rect({
            x: 0, y: 0, width: W, height: H * 0.92,
            fill: '#1c1c20', stroke: '#2c2c34', strokeWidth: 1.5,
            cornerRadius: 7,
            shadowColor: '#000', shadowBlur: 10, shadowOffsetY: 4, shadowOpacity: 0.45,
        }));
        this._staticGroup.add(new Konva.Rect({
            x: b.x, y: b.y, width: b.w, height: b.h,
            fill: '#26262c', stroke: '#36363e', strokeWidth: 1.2, cornerRadius: b.rx,
        }));
        [0.12, 0.50, 0.88].forEach(fx => {
            const sx = b.x + b.w * fx, sy = b.y + b.h / 2, sr = this.width * 0.016;
            this._staticGroup.add(new Konva.Circle({ x:sx, y:sy, radius:sr, fill:'#888', stroke:'#555', strokeWidth:0.7 }));
            this._staticGroup.add(new Konva.Line({ points:[sx-sr*0.6,sy,sx+sr*0.6,sy], stroke:'#444', strokeWidth:1, lineCap:'round' }));
            this._staticGroup.add(new Konva.Line({ points:[sx,sy-sr*0.6,sx,sy+sr*0.6], stroke:'#444', strokeWidth:1, lineCap:'round' }));
        });
    }

    // ── 管道本体 ─────────────────────────────────────────────
    _drawPipeBody() {
        const y  = this._pipeY, r = this._pipeR;
        const x0 = this._pipeX0, x1 = this._pipeX1;
        const orX = this._orX, orW = this._orW;

        // 管道外壁（分左右两段，孔板处断开）
        const segments = [
            [x0, orX - orW / 2],
            [orX + orW / 2, x1],
        ];
        segments.forEach(([sx, ex]) => {
            // 上壁
            this._staticGroup.add(new Konva.Rect({
                x: sx, y: y - r - 4, width: ex - sx, height: 4,
                fillLinearGradientStartPoint: { x:0, y:0 },
                fillLinearGradientEndPoint:   { x:0, y:4 },
                fillLinearGradientColorStops: [0,'#888',1,'#606060'],
                stroke: '#404040', strokeWidth: 0.5,
            }));
            // 下壁
            this._staticGroup.add(new Konva.Rect({
                x: sx, y: y + r, width: ex - sx, height: 4,
                fillLinearGradientStartPoint: { x:0, y:0 },
                fillLinearGradientEndPoint:   { x:0, y:4 },
                fillLinearGradientColorStops: [0,'#606060',1,'#888'],
                stroke: '#404040', strokeWidth: 0.5,
            }));
            // 管内壁（深色，流体背景）
            this._staticGroup.add(new Konva.Rect({
                x: sx, y: y - r, width: ex - sx, height: r * 2,
                fill: '#1e2e3a',
            }));
        });

        // 管道端部法兰
        [x0, x1].forEach(fx => {
            this._staticGroup.add(new Konva.Rect({
                x: fx === x0 ? fx - 5 : fx + 1,
                y: y - r - 6, width: 5, height: r * 2 + 12,
                fillLinearGradientStartPoint: { x:0, y:0 },
                fillLinearGradientEndPoint:   { x:5, y:0 },
                fillLinearGradientColorStops: [0,'#7a6a30',0.4,'#c8a848',0.7,'#e0c060',1,'#7a6a30'],
                stroke: '#5a4808', strokeWidth: 0.8, cornerRadius: 1,
            }));
        });
    }

    // ── 孔板（截面图，正视） ─────────────────────────────────
    _drawOrificeplate() {
        const y  = this._pipeY, r = this._pipeR;
        const orX = this._orX, orW = this._orW;
        const oh  = this._orHole;

        // 孔板主体（深色钢板，上下实体部分）
        // 上实体
        this._staticGroup.add(new Konva.Rect({
            x: orX - orW / 2, y: y - r - 1,
            width: orW, height: r - oh + 1,
            fillLinearGradientStartPoint: { x:0, y:0 },
            fillLinearGradientEndPoint:   { x:orW, y:0 },
            fillLinearGradientColorStops: [0,'#383838',0.3,'#606060',0.6,'#707070',1,'#383838'],
            stroke: '#505050', strokeWidth: 0.5,
        }));
        // 下实体
        this._staticGroup.add(new Konva.Rect({
            x: orX - orW / 2, y: y + oh,
            width: orW, height: r - oh + 1,
            fillLinearGradientStartPoint: { x:0, y:0 },
            fillLinearGradientEndPoint:   { x:orW, y:0 },
            fillLinearGradientColorStops: [0,'#383838',0.3,'#606060',0.6,'#707070',1,'#383838'],
            stroke: '#505050', strokeWidth: 0.5,
        }));

        // 孔口（中央开口区域）
        this._staticGroup.add(new Konva.Rect({
            x: orX - orW / 2 - 1, y: y - oh,
            width: orW + 2, height: oh * 2,
            fill: '#0e1e2e',
        }));

        // 孔板边缘轮廓线（强调）
        this._staticGroup.add(new Konva.Line({
            points: [orX - orW/2, y - r, orX - orW/2, y - oh,
                     orX + orW/2, y - oh, orX + orW/2, y - r],
            stroke: '#909090', strokeWidth: 1.5, lineCap: 'round', lineJoin: 'round',
        }));
        this._staticGroup.add(new Konva.Line({
            points: [orX - orW/2, y + r, orX - orW/2, y + oh,
                     orX + orW/2, y + oh, orX + orW/2, y + r],
            stroke: '#909090', strokeWidth: 1.5, lineCap: 'round', lineJoin: 'round',
        }));

        // 孔口锐利边缘（上游侧高亮）
        this._staticGroup.add(new Konva.Line({
            points: [orX - orW/2, y - oh, orX - orW/2, y + oh],
            stroke: '#b0b0b8', strokeWidth: 1.2, lineCap: 'round',
        }));
        this._staticGroup.add(new Konva.Line({
            points: [orX - orW/2, y - oh - 1, orX - orW/2, y + oh + 1],
            stroke: 'rgba(255,255,255,0.25)', strokeWidth: 0.5,
        }));

        // 孔板中心标注
        this._staticGroup.add(new Konva.Text({
            x: orX - 18, y: y - r - 18, width: 36,
            text: `β=${this.beta}`, fontSize: 7, fill: '#888', align: 'center',
        }));
    }

    // ── 取压口（法兰开孔） ────────────────────────────────────
    _drawTappings() {
        const y  = this._pipeY, r = this._pipeR;

        [[this._tapHX, '#ef9a9a', 'P₁', '+'], [this._tapLX, '#90caf9', 'P₂', '−']].forEach(
            ([x, col, label, sign]) => {
                // 取压接头（管道顶部小突起）
                this._staticGroup.add(new Konva.Rect({
                    x: x - 3.5, y: y - r - 10,
                    width: 7, height: 10,
                    fillLinearGradientStartPoint: { x:0, y:0 },
                    fillLinearGradientEndPoint:   { x:7, y:0 },
                    fillLinearGradientColorStops: [0,'#5a5060',0.5,'#908898',1,'#5a5060'],
                    stroke: '#999', strokeWidth: 0.7, cornerRadius: 1,
                }));
                // 取压孔（小圆）
                this._staticGroup.add(new Konva.Circle({
                    x: x, y: y - r - 10,
                    radius: 2.5, fill: '#1a1a20', stroke: col, strokeWidth: 0.8,
                }));
                // 标注（上游/下游）
                this._staticGroup.add(new Konva.Text({
                    x: x - 14, y: y - r - 28, width: 28,
                    text: `${label}`, fontSize: 8, fontStyle: 'bold',
                    fill: col, align: 'center',
                }));
            }
        );

        // 距离标注（1D）
        const arrowCol = 'rgba(150,150,130,0.45)';
        this._staticGroup.add(new Konva.Line({
            points: [this._tapHX, this._pipeY + this._pipeR + 12,
                     this._orX,   this._pipeY + this._pipeR + 12],
            stroke: arrowCol, strokeWidth: 0.8, dash: [3,3],
        }));
        this._staticGroup.add(new Konva.Text({
            x: (this._tapHX + this._orX) / 2 - 8,
            y: this._pipeY + this._pipeR + 14, width: 16,
            text: '1D', fontSize: 6.5, fill: 'rgba(160,155,100,0.55)', align: 'center',
        }));
    }

    // ── 差压导管（取压口到差压计的引压管） ───────────────────
    _drawImpulseLines() {
        const y0 = this._pipeY - this._pipeR - 10;
        const y1 = this._impulseY1;
        const ucX = this._uCX, uW = this._uW;
        const hpX = this._tapHX, lpX = this._tapLX;
        const hpOut = ucX - uW / 2;   // 差压计高压侧 x
        const lpOut = ucX + uW / 2;   // 差压计低压侧 x

        // 高压导管（红色，从上游取压口到差压计左侧）
        this._staticGroup.add(new Konva.Line({
            points: [hpX, y0, hpX, y1 + 20, hpOut, y1 + 20, hpOut, y1],
            stroke: 'rgba(200,100,100,0.70)', strokeWidth: 2.2,
            lineCap: 'round', lineJoin: 'round', tension: 0.2,
        }));
        // 低压导管（蓝色，从下游取压口到差压计右侧）
        this._staticGroup.add(new Konva.Line({
            points: [lpX, y0, lpX, y1 + 20, lpOut, y1 + 20, lpOut, y1],
            stroke: 'rgba(80,130,200,0.70)', strokeWidth: 2.2,
            lineCap: 'round', lineJoin: 'round', tension: 0.2,
        }));

        // 导管标注
        this._staticGroup.add(new Konva.Text({
            x: hpX - 22, y: (y0 + y1) / 2 - 5, width: 20,
            text: '+\n正压', fontSize: 6.5, fill: 'rgba(200,100,100,0.70)',
            align: 'center', lineHeight: 1.4,
        }));
        this._staticGroup.add(new Konva.Text({
            x: lpX + 4, y: (y0 + y1) / 2 - 5, width: 20,
            text: '−\n负压', fontSize: 6.5, fill: 'rgba(80,130,200,0.70)',
            align: 'center', lineHeight: 1.4,
        }));
    }

    // ── U 管差压计外壳 ────────────────────────────────────────
    _drawUTubeBody() {
        const cx = this._uCX, cy = this._uCY;
        const uw = this._uW, uh = this._uH;
        const tr = this._uTubeR;
        const hpX = cx - uw / 2, lpX = cx + uw / 2;

        // 差压计壳体（矩形外框）
        this._staticGroup.add(new Konva.Rect({
            x: hpX - tr - 8, y: cy - uh - 12,
            width: uw + tr * 2 + 16, height: uh + 24,
            fill: '#28282e', stroke: '#484850', strokeWidth: 1.5,
            cornerRadius: 4,
            shadowColor: '#000', shadowBlur: 5, shadowOpacity: 0.4,
        }));
        // 壳体顶部铭牌条
        this._staticGroup.add(new Konva.Rect({
            x: hpX - tr - 8, y: cy - uh - 12,
            width: uw + tr * 2 + 16, height: 10,
            fill: '#3a3840', cornerRadius: [4,4,0,0],
        }));
        this._staticGroup.add(new Konva.Text({
            x: hpX - tr, y: cy - uh - 11, width: uw + tr * 2,
            text: 'ΔP', fontSize: 7, fontStyle: 'bold', fill: '#a09880', align: 'center',
        }));

        // 左管（高压侧）外壁
        this._staticGroup.add(new Konva.Rect({
            x: hpX - tr - 3, y: cy - uh - 2,
            width: (tr + 3) * 2, height: uh,
            fill: '#333338', stroke: '#585860', strokeWidth: 0.8, cornerRadius: 2,
        }));
        // 右管（低压侧）外壁
        this._staticGroup.add(new Konva.Rect({
            x: lpX - tr - 3, y: cy - uh - 2,
            width: (tr + 3) * 2, height: uh,
            fill: '#333338', stroke: '#585860', strokeWidth: 0.8, cornerRadius: 2,
        }));

        // U 形底部连通管
        this._staticGroup.add(new Konva.Line({
            points: [
                hpX, cy + 2,
                hpX, cy + 14,
                lpX, cy + 14,
                lpX, cy + 2,
            ],
            stroke: '#404048', strokeWidth: (tr + 3) * 2, lineCap: 'round', lineJoin: 'round',
        }));
        this._staticGroup.add(new Konva.Line({
            points: [hpX, cy + 2, hpX, cy + 14, lpX, cy + 14, lpX, cy + 2],
            stroke: '#1a1a20', strokeWidth: tr * 2,
            lineCap: 'round', lineJoin: 'round',
        }));

        // 液位刻度线（左管）
        for (let i = 0; i <= 4; i++) {
            const ly = cy - i * uh / 4;
            this._staticGroup.add(new Konva.Line({
                points: [hpX - tr - 3, ly, hpX - tr - 9, ly],
                stroke: i % 2 === 0 ? '#707060' : '#504e40',
                strokeWidth: i % 2 === 0 ? 1.0 : 0.6,
            }));
        }

        // 浮子腔注释
        this._staticGroup.add(new Konva.Text({
            x: cx - 20, y: cy + 18, width: 40,
            text: 'U管腔', fontSize: 6.5, fill: '#888', align: 'center',
        }));
    }

    // ── 三阀组（简化符号） ────────────────────────────────────
    _drawManifoldValves() {
        const cx = this._uCX, cy = this._uCY;
        const uw = this._uW;
        const y  = cy - this._uH - 14;

        // 高压截止阀（简化为小矩形）
        this._drawValveSymbol(cx - uw/2, y, 'HV', '#ef9a9a');
        // 低压截止阀
        this._drawValveSymbol(cx + uw/2, y, 'LV', '#90caf9');
        // 平衡阀（水平连接线）
        this._staticGroup.add(new Konva.Line({
            points: [cx - uw/2, y - 4, cx + uw/2, y - 4],
            stroke: 'rgba(160,150,100,0.40)', strokeWidth: 1.2, dash: [4,4],
        }));
        this._staticGroup.add(new Konva.Text({
            x: cx - 14, y: y - 14, width: 28,
            text: 'EV', fontSize: 7, fill: 'rgba(160,150,80,0.55)', align: 'center',
        }));
    }

    _drawValveSymbol(x, y, label, col) {
        this._staticGroup.add(new Konva.Line({
            points: [x-6, y-5, x+6, y+5, x+6, y-5, x-6, y+5],
            stroke: col, strokeWidth: 1.2, lineCap: 'round',
        }));
        this._staticGroup.add(new Konva.Text({
            x: x - 10, y: y - 14, width: 20,
            text: label, fontSize: 6.5, fill: col, align: 'center',
        }));
    }

    // ── 指示表盘外框 ──────────────────────────────────────────
    _drawDialFrame() {
        const cx = this._dialCX, cy = this._dialCY;
        const R  = this._dialR;

        // 黄铜外圈
        this._staticGroup.add(new Konva.Circle({
            x: cx, y: cy, radius: R + 9,
            fillRadialGradientStartPoint:  { x: -R*0.3, y: -R*0.3 },
            fillRadialGradientEndPoint:    { x: 0, y: 0 },
            fillRadialGradientStartRadius: R * 0.2,
            fillRadialGradientEndRadius:   R + 9,
            fillRadialGradientColorStops:  [0,'#e0c060',0.4,'#c8a030',0.7,'#a07818',1,'#786010'],
            stroke: '#5a4008', strokeWidth: 1.5,
        }));
        // 玻璃面
        this._staticGroup.add(new Konva.Circle({
            x: cx, y: cy, radius: R + 3,
            fill: '#f0ede2', stroke: '#c4be88', strokeWidth: 1,
        }));
        // 扇形背景
        const startDeg = 180 + (180 - this._dialAngle) / 2;
        this._staticGroup.add(new Konva.Arc({
            x: cx, y: cy,
            innerRadius: R * 0.25, outerRadius: R * 0.95,
            angle: this._dialAngle, rotation: startDeg,
            fill: '#e8e4d2', stroke: '#c0b870', strokeWidth: 0.5,
        }));
        // 高光
        this._staticGroup.add(new Konva.Ellipse({
            x: cx - R*0.22, y: cy - R*0.28,
            radiusX: R*0.28, radiusY: R*0.14,
            fill: 'rgba(255,255,255,0.22)', rotation: -30,
        }));
    }

    // ── 刻度（开方非线性 → 线性化刻度均匀分布）─────────────
    _drawScaleTicks() {
        const cx = this._dialCX, cy = this._dialCY, R = this._dialR;
        const totalDeg = this._dialAngle;
        const startDeg = 180 + (180 - totalDeg) / 2;
        this._ptrStartRad = startDeg * Math.PI / 180;

        const scaleG = new Konva.Group();
        const nMajor = 5, nMinor = 4;
        const total  = nMajor * nMinor;

        for (let i = 0; i <= total; i++) {
            const frac   = i / total;
            const deg    = startDeg + frac * totalDeg;
            const rad    = deg * Math.PI / 180;
            const isMaj  = i % nMinor === 0;
            const tLen   = isMaj ? 11 : 5;
            const r0     = R * 0.80;

            const x1 = cx + r0 * Math.cos(rad),               y1 = cy + r0 * Math.sin(rad);
            const x2 = cx + (r0 + tLen) * Math.cos(rad),      y2 = cy + (r0 + tLen) * Math.sin(rad);

            scaleG.add(new Konva.Line({
                points: [x1, y1, x2, y2],
                stroke: isMaj ? '#404040' : '#888888', strokeWidth: isMaj ? 1.4 : 0.7,
            }));

            if (isMaj) {
                const qV  = (this.Qmax * frac).toFixed(this.Qmax < 2 ? 1 : 0);
                const lx  = cx + (r0 + 20) * Math.cos(rad);
                const ly  = cy + (r0 + 20) * Math.sin(rad);
                scaleG.add(new Konva.Text({
                    x: lx - 14, y: ly - 6, width: 28, height: 12,
                    text: qV, fontSize: 8, fontFamily: 'monospace',
                    fill: '#444', align: 'center', verticalAlign: 'middle',
                }));
            }
        }

        // 量程单位
        scaleG.add(new Konva.Text({
            x: cx - 20, y: cy - R * 0.18, width: 40,
            text: this.unit, fontSize: 7, fontStyle: 'bold', fill: '#7a6020', align: 'center',
        }));

        // 满量程警戒弧（后 15%）
        const warnStart = startDeg + totalDeg * 0.85;
        scaleG.add(new Konva.Arc({
            x: cx, y: cy, innerRadius: R*0.76, outerRadius: R*0.92,
            angle: totalDeg * 0.15, rotation: warnStart,
            fill: 'rgba(220,60,60,0.16)', stroke: 'rgba(200,40,40,0.22)', strokeWidth: 0.5,
        }));

        this._staticGroup.add(scaleG);
    }

    // ── 静态标注 ─────────────────────────────────────────────
    _drawStaticLabels() {
        const W = this.width;

        // 铭牌
        this._staticGroup.add(new Konva.Text({
            x: 0, y: -16, width: W,
            text: `${this.label}  差压式流量计  DN${this.DN}  ΔPmax=${this.dpMax}kPa`,
            fontSize: 9, fontStyle: 'bold', fill: '#8ab4f8', align: 'center',
        }));

        // 管道标注
        this._staticGroup.add(new Konva.Text({ x:2, y:this._pipeY-this._pipeR-12, text:'← 高压侧 P₁', fontSize:7, fill:'#ef9a9a' }));
        this._staticGroup.add(new Konva.Text({ x:this.width-68, y:this._pipeY-this._pipeR-12, text:'低压侧 P₂ →', fontSize:7, fill:'#90caf9' }));

        // 孔板结构标注
        this._staticGroup.add(new Konva.Text({
            x: this._orX - 18, y: this._pipeY + this._pipeR + 8, width: 36,
            text: '孔板', fontSize: 7, fill: '#888', align: 'center',
        }));

        // 差压公式
        this._staticGroup.add(new Konva.Text({
            x: this._dialCX - this._dialR - 10, y: this._dialCY + this._dialR * 0.60, width: 90,
            text: 'Q = α·A·√(2ΔP/ρ)',
            fontSize: 7, fill: 'rgba(160,155,90,0.60)', fontStyle: 'italic',
        }));

        // 连杆标注
        this._staticGroup.add(new Konva.Text({
            x: this._uCX + this._uW / 2 + 10,
            y: (this._uCY + this._dialCY) / 2 - 5, width: 40,
            text: '连杆\n放大', fontSize: 7, fill: '#888', lineHeight: 1.4,
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
            x: b.x + 22, y: b.y + b.h/2 - 5, width: 105,
            text: `Q: 0.0 ${this.unit}`, fontSize: 8, fontStyle: 'bold', fill: '#90caf9',
        });
        this._sDP = new Konva.Text({
            x: b.x + 132, y: b.y + b.h/2 - 5, width: 90,
            text: 'ΔP: 0.00 kPa', fontSize: 8, fill: '#a5d6a7',
        });
        this._sPtr = new Konva.Text({
            x: b.x + 228, y: b.y + b.h/2 - 5, width: 80,
            text: '指针: 0.0°', fontSize: 8, fill: '#ffcc80',
        });
        this._staticGroup.add(this._sDot, this._sQ, this._sDP, this._sPtr);
    }

    // ══════════════════════════════════════════════════════════
    // 动态层（就地更新，无创建/销毁）
    // ══════════════════════════════════════════════════════════

    _initDynamicNodes() {
        const W = this.width, H = this.height;
        const y = this._pipeY, r = this._pipeR;
        const cx = this._uCX, cy = this._uCY;
        const R = this._dialR;

        // ── 流体 ──
        this._nUpstream = new Konva.Rect({ x:0, y:0, width:0, height:0 });
        this._nDownstream = new Konva.Rect({ x:0, y:0, width:0, height:0 });
        this._nWaves = [];
        for (let i = 0; i < 4; i++) {
            const w = new Konva.Line({ points:[], stroke:'', strokeWidth:1.8, lineCap:'round' });
            this._nWaves.push(w);
            this._dynamicGroup.add(w);
        }

        // ── 射流 ──
        this._nJetTop = new Konva.Line({ points:[], stroke:'', strokeWidth:1.5, lineCap:'round', lineJoin:'round', tension:0.5 });
        this._nJetBot = new Konva.Line({ points:[], stroke:'', strokeWidth:1.5, lineCap:'round', lineJoin:'round', tension:0.5 });
        this._nJetCore = new Konva.Line({ points:[], stroke:'', strokeWidth:0, lineCap:'round' });
        this._nJetVCLine = new Konva.Line({ points:[], stroke:'', strokeWidth:0.8, dash:[2,3], visible:false });
        this._nJetVCText = new Konva.Text({ x:0, y:0, width:32, text:'', fontSize:6.5, align:'center', visible:false });

        // ── 压力区 ──
        this._nPressH = new Konva.Rect({ x:0, y:0, width:0, height:0 });
        this._nPressL = new Konva.Rect({ x:0, y:0, width:0, height:0 });

        // ── 涡旋池 ──
        this._nVortexPool = [];
        for (let i = 0; i < 20; i++) {
            const a = new Konva.Arc({ x:0, y:0, innerRadius:0, outerRadius:0, angle:270, rotation:0, stroke:'', strokeWidth:1, visible:false });
            this._nVortexPool.push(a);
        }

        // ── U 管 ──
        const tr = this._uTubeR;
        this._nUHpFill = new Konva.Rect({ x:0, y:0, width:0, height:0 });
        this._nUHpLine = new Konva.Line({ points:[], stroke:'', strokeWidth:1.5, lineCap:'round' });
        this._nUHpWave = new Konva.Line({ points:[], stroke:'', strokeWidth:2, lineCap:'round', visible:false });
        this._nULpFill = new Konva.Rect({ x:0, y:0, width:0, height:0 });
        this._nULpLine = new Konva.Line({ points:[], stroke:'', strokeWidth:1.5, lineCap:'round' });
        this._nULpWave = new Konva.Line({ points:[], stroke:'', strokeWidth:2, lineCap:'round', visible:false });
        this._nUBottom = new Konva.Line({ points:[], stroke:'', strokeWidth:tr*2, lineCap:'round', lineJoin:'round' });
        this._nUDh = new Konva.Line({ points:[], stroke:'rgba(200,180,80,0.45)', strokeWidth:1, dash:[3,3], visible:false });
        this._nUDhArrow1 = new Konva.Line({ points:[], stroke:'rgba(200,180,80,0.45)', strokeWidth:1, lineCap:'round', lineJoin:'round', visible:false });
        this._nUDhArrow2 = new Konva.Line({ points:[], stroke:'rgba(200,180,80,0.45)', strokeWidth:1, lineCap:'round', lineJoin:'round', visible:false });
        this._nUDhText = new Konva.Text({ x:0, y:0, width:24, text:'', fontSize:7, fill:'rgba(200,180,60,0.55)', visible:false });

        // ── 连杆 ──
        this._nFloat = new Konva.Rect({ x:0, y:0, width:0, height:0, fill:'#c0a030', stroke:'#907818', strokeWidth:0.8, cornerRadius:1 });
        this._nLinkage = new Konva.Line({ points:[], stroke:'rgba(160,150,80,0.55)', strokeWidth:1.8, lineCap:'round', lineJoin:'round', tension:0.35 });
        this._nJoint1 = new Konva.Circle({ x:0, y:0, radius:2.5, fill:'#b09020', stroke:'#808010', strokeWidth:0.7 });
        this._nJoint2 = new Konva.Circle({ x:0, y:0, radius:2.5, fill:'#b09020', stroke:'#808010', strokeWidth:0.7 });

        // ── 指针 ──
        this._nPtrBody = new Konva.Line({ points:[], stroke:'#181820', strokeWidth:2.0, lineCap:'round' });
        this._nPtrTip = new Konva.Line({ points:[], stroke:'#e03020', strokeWidth:2.0, lineCap:'round' });
        this._nPtrTail = new Konva.Line({ points:[], stroke:'#2060b0', strokeWidth:3.0, lineCap:'round' });
        this._nPtrCenter = new Konva.Circle({ x:0, y:0, radius:R*0.062, fillRadialGradientStartPoint:{x:-R*0.02,y:-R*0.02}, fillRadialGradientEndPoint:{x:0,y:0}, fillRadialGradientStartRadius:R*0.01, fillRadialGradientEndRadius:R*0.062, fillRadialGradientColorStops:[0,'#e8c860',0.5,'#c8a030',1,'#7a5808'], stroke:'#5a3e08', strokeWidth:0.8 });
        this._nPtrText = new Konva.Text({ x:0, y:0, width:36, text:'', fontSize:8, fontFamily:'monospace', fontStyle:'bold', fill:'#d03020', align:'center', shadowColor:'#fff', shadowBlur:2, shadowOpacity:0.7 });

        // ── 粒子池 ──
        this._nParticlePool = [];
        for (let i = 0; i < 40; i++) {
            const c = new Konva.Circle({ x:0, y:0, radius:1, fill:'transparent', visible:false });
            this._nParticlePool.push(c);
        }

        // 添加到 dynamicGroup 并初始化
        const allNodes = [
            this._nUpstream, this._nDownstream, ...this._nWaves,
            this._nJetTop, this._nJetBot, this._nJetCore, this._nJetVCLine, this._nJetVCText,
            this._nPressH, this._nPressL, ...this._nVortexPool,
            this._nUHpFill, this._nUHpLine, this._nUHpWave,
            this._nULpFill, this._nULpLine, this._nULpWave,
            this._nUBottom, this._nUDh, this._nUDhArrow1, this._nUDhArrow2, this._nUDhText,
            this._nFloat, this._nLinkage, this._nJoint1, this._nJoint2,
            this._nPtrBody, this._nPtrTip, this._nPtrTail, this._nPtrCenter, this._nPtrText,
            ...this._nParticlePool,
        ];
        allNodes.forEach(n => this._dynamicGroup.add(n));

        this._updateDynamic();
    }

    _updateDynamic() {
        // ── 流体 ──
        this._updateFluidFlow();
        // ── 射流 ──
        this._updateOrificeJet();
        // ── 压力区 ──
        this._updatePressureZones();
        // ── 涡旋 ──
        this._updateVortices();
        // ── U 管 ──
        this._updateUTubeLevels();
        // ── 连杆 ──
        this._updateFloatLinkage();
        // ── 指针 ──
        this._updatePointer();
        // ── 粒子 ──
        this._updateParticles();
    }

    _updateFluidFlow() {
        const y = this._pipeY, r = this._pipeR;
        const orX = this._orX, orW = this._orW;
        const q = this._flow;

        if (q < 0.01) {
            this._nUpstream.visible(false);
            this._nDownstream.visible(false);
            this._nWaves.forEach(w => w.visible(false));
            return;
        }
        this._nUpstream.visible(true);
        this._nDownstream.visible(true);

        const baseAlpha = 0.12 + q * 0.20;
        const col = this.medium === 'air' ? `rgba(200,230,255,${baseAlpha*0.4})` : `rgba(30,120,200,${baseAlpha})`;

        this._nUpstream.x(this._pipeX0);
        this._nUpstream.y(y - r);
        this._nUpstream.width(orX - orW/2 - this._pipeX0);
        this._nUpstream.height(r * 2);
        this._nUpstream.fill(this.medium === 'air' ? `rgba(200,230,255,${baseAlpha*0.35})` : `rgba(20,100,180,${baseAlpha})`);

        this._nDownstream.x(orX + orW/2);
        this._nDownstream.y(y - r);
        this._nDownstream.width(this._pipeX1 - (orX + orW/2));
        this._nDownstream.height(r * 2);
        this._nDownstream.fill(col);

        const phase = (Date.now() / 280) % 1;
        for (let i = 0; i < 4; i++) {
            const f  = ((i / 4) + phase) % 1;
            const wx = this._pipeX0 + f * (orX - orW/2 - this._pipeX0 - 8);
            const wa = Math.sin(f * Math.PI) * 0.15 * q;
            this._nWaves[i].visible(true);
            this._nWaves[i].points([wx, y - r*0.5, wx, y + r*0.5]);
            this._nWaves[i].stroke(`rgba(100,190,255,${wa})`);
        }
    }

    _updateOrificeJet() {
        const y = this._pipeY, r = this._pipeR;
        const orX = this._orX, orW = this._orW;
        const oh = this._orHole;
        const q = this._flow;

        if (q < 0.02) {
            [this._nJetTop, this._nJetBot, this._nJetCore, this._nJetVCLine, this._nJetVCText].forEach(n => n.visible(false));
            return;
        }
        [this._nJetTop, this._nJetBot, this._nJetCore].forEach(n => n.visible(true));

        const vcX = orX + orW/2 + this._pipeR * 1.2;
        const vcOh = oh * (0.60 + q * 0.08);
        const jetAlpha = 0.18 + q * 0.28;

        this._nJetTop.points([orX + orW/2, y - oh, vcX, y - vcOh, orX + orW/2 + this._pipeR * 3.5, y - r * 0.60]);
        this._nJetTop.stroke(`rgba(80,180,255,${jetAlpha})`);
        this._nJetBot.points([orX + orW/2, y + oh, vcX, y + vcOh, orX + orW/2 + this._pipeR * 3.5, y + r * 0.60]);
        this._nJetBot.stroke(`rgba(80,180,255,${jetAlpha})`);
        this._nJetCore.points([orX + orW/2, y, vcX + this._pipeR * 0.4, y]);
        this._nJetCore.stroke(`rgba(160,220,255,${jetAlpha * 1.2})`);
        this._nJetCore.strokeWidth(vcOh * 1.2);

        // Vena Contracta 标注
        if (q > 0.15) {
            const vcAlpha = Math.min(0.55, q * 0.8);
            this._nJetVCLine.visible(true);
            this._nJetVCLine.points([vcX, y + vcOh + 2, vcX, y + r - 2]);
            this._nJetVCLine.stroke(`rgba(100,200,255,${vcAlpha * 0.5})`);
            this._nJetVCText.visible(true);
            this._nJetVCText.x(vcX - 16);
            this._nJetVCText.y(y + r + 4);
            this._nJetVCText.text('VC');
            this._nJetVCText.fill(`rgba(100,200,255,${vcAlpha})`);
        } else {
            this._nJetVCLine.visible(false);
            this._nJetVCText.visible(false);
        }
    }

    _updatePressureZones() {
        const y = this._pipeY, r = this._pipeR;
        const q = this._flow;

        if (q < 0.05) {
            this._nPressH.visible(false);
            this._nPressL.visible(false);
            return;
        }
        this._nPressH.visible(true);
        this._nPressL.visible(true);

        const pAlpha = q * 0.10;
        this._nPressH.x(this._tapHX - this._pipeR);
        this._nPressH.y(y - r + 1);
        this._nPressH.width(this._pipeR * 2);
        this._nPressH.height(r * 2 - 2);
        this._nPressH.fill(`rgba(220,80,60,${pAlpha})`);

        this._nPressL.x(this._tapLX - this._pipeR);
        this._nPressL.y(y - r + 1);
        this._nPressL.width(this._pipeR * 2);
        this._nPressL.height(r * 2 - 2);
        this._nPressL.fill(`rgba(40,100,220,${pAlpha})`);
    }

    _updateVortices() {
        let idx = 0;
        this._vortices.forEach(v => {
            const arc = this._nVortexPool[idx];
            if (!arc) return;
            idx++;
            const alpha = v.life * 0.35;
            arc.visible(true);
            arc.x(v.x);
            arc.y(v.y);
            arc.innerRadius(v.r * 0.5);
            arc.outerRadius(v.r);
            arc.rotation(v.angle);
            arc.stroke(`rgba(100,180,255,${alpha})`);
        });
        for (let i = idx; i < this._nVortexPool.length; i++) {
            this._nVortexPool[i].visible(false);
        }
    }

    _updateUTubeLevels() {
        const cx = this._uCX, cy = this._uCY;
        const uh = this._uH, tr = this._uTubeR;
        const hpX = cx - this._uW / 2, lpX = cx + this._uW / 2;
        const isWater = this.medium !== 'air';
        const fluidFill = isWater ? 'rgba(30,100,200,0.70)' : 'rgba(180,220,255,0.40)';
        const fluidStroke = isWater ? 'rgba(80,180,255,0.60)' : 'rgba(200,230,255,0.50)';

        const hLevel = this._uLevelH;
        const lLevel = this._uLevelL;
        const hFillH = (1 - hLevel) * uh;
        const lFillH = lLevel * uh;

        if (hFillH > 2) {
            this._nUHpFill.visible(true);
            this._nUHpFill.x(hpX - tr);
            this._nUHpFill.y(cy - hFillH);
            this._nUHpFill.width(tr * 2);
            this._nUHpFill.height(hFillH);
            this._nUHpFill.fill(fluidFill);
            this._nUHpLine.visible(true);
            this._nUHpLine.points([hpX - tr, cy - hFillH, hpX + tr, cy - hFillH]);
            this._nUHpLine.stroke(fluidStroke);
            if (this._flow > 0.05) {
                const wPhase = (Date.now() / 400) % (Math.PI * 2);
                this._nUHpWave.visible(true);
                this._nUHpWave.points([hpX - tr + 1, cy - hFillH, hpX + tr - 1, cy - hFillH]);
                this._nUHpWave.stroke(`rgba(120,200,255,${0.15 + Math.abs(Math.sin(wPhase)) * 0.20})`);
            } else {
                this._nUHpWave.visible(false);
            }
        } else {
            [this._nUHpFill, this._nUHpLine, this._nUHpWave].forEach(n => n.visible(false));
        }

        if (lFillH > 2) {
            this._nULpFill.visible(true);
            this._nULpFill.x(lpX - tr);
            this._nULpFill.y(cy - lFillH);
            this._nULpFill.width(tr * 2);
            this._nULpFill.height(lFillH);
            this._nULpFill.fill(fluidFill);
            this._nULpLine.visible(true);
            this._nULpLine.points([lpX - tr, cy - lFillH, lpX + tr, cy - lFillH]);
            this._nULpLine.stroke(fluidStroke);
            if (this._flow > 0.05) {
                const wPhase = (Date.now() / 400 + Math.PI) % (Math.PI * 2);
                this._nULpWave.visible(true);
                this._nULpWave.points([lpX - tr + 1, cy - lFillH, lpX + tr - 1, cy - lFillH]);
                this._nULpWave.stroke(`rgba(120,200,255,${0.15 + Math.abs(Math.sin(wPhase)) * 0.20})`);
            } else {
                this._nULpWave.visible(false);
            }
        } else {
            [this._nULpFill, this._nULpLine, this._nULpWave].forEach(n => n.visible(false));
        }

        this._nUBottom.visible(true);
        this._nUBottom.points([hpX, cy + 2, hpX, cy + 14, lpX, cy + 14, lpX, cy + 2]);
        this._nUBottom.stroke(fluidFill);

        // Δh
        const deltaH = (lLevel - (1 - hLevel)) * uh;
        if (Math.abs(deltaH) > 4) {
            const y1 = cy - hFillH, y2 = cy - lFillH;
            const midX = (hpX + lpX) / 2;
            this._nUDh.visible(true);
            this._nUDh.points([midX, y1, midX, y2]);
            this._nUDhArrow1.visible(true);
            this._nUDhArrow1.points([midX - 4, y1 + 5, midX, y1, midX + 4, y1 + 5]);
            this._nUDhArrow2.visible(true);
            this._nUDhArrow2.points([midX - 4, y2 - 5, midX, y2, midX + 4, y2 - 5]);
            this._nUDhText.visible(true);
            this._nUDhText.x(midX + 4);
            this._nUDhText.y((y1 + y2) / 2 - 5);
            this._nUDhText.text('Δh');
        } else {
            [this._nUDh, this._nUDhArrow1, this._nUDhArrow2, this._nUDhText].forEach(n => n.visible(false));
        }
    }

    _updateFloatLinkage() {
        const cx = this._uCX, cy = this._uCY;
        const lpX = cx + this._uW / 2;
        const tr = this._uTubeR;
        const uh = this._uH;
        const lLevel = this._uLevelL;
        const floatY = cy - lLevel * uh - 4;

        this._nFloat.visible(true);
        this._nFloat.x(lpX - tr * 0.8);
        this._nFloat.y(floatY - 5);
        this._nFloat.width(tr * 1.6);
        this._nFloat.height(8);

        const dialCX = this._dialCX, dialCY = this._dialCY;
        const pivX = dialCX - this._dialR * 0.05;
        const pivY = dialCY;

        this._nLinkage.visible(true);
        this._nLinkage.points([lpX, floatY, lpX + 18, floatY, pivX - 10, pivY + 8, pivX, pivY]);

        this._nJoint1.visible(true);
        this._nJoint1.x(lpX + 18);
        this._nJoint1.y(floatY);
        this._nJoint2.visible(true);
        this._nJoint2.x(pivX - 10);
        this._nJoint2.y(pivY + 8);
    }

    _updatePointer() {
        const cx = this._dialCX, cy = this._dialCY;
        const R = this._dialR;
        const PL = R * 0.80;
        const PTL = R * 0.22;
        const rad = this._ptrStartRad + this._ptrAngle;
        const cosR = Math.cos(rad), sinR = Math.sin(rad);

        this._nPtrBody.points([cx - PTL * cosR, cy - PTL * sinR, cx + PL * cosR, cy + PL * sinR]);
        this._nPtrTip.points([cx + (PL - R*0.16)*cosR, cy + (PL - R*0.16)*sinR, cx + PL*cosR, cy + PL*sinR]);
        this._nPtrTail.points([cx - R*0.05*cosR, cy - R*0.05*sinR, cx - PTL*cosR, cy - PTL*sinR]);
        this._nPtrCenter.x(cx);
        this._nPtrCenter.y(cy);

        const qRead = this.getReading().toFixed(this.Qmax < 2 ? 1 : 0);
        this._nPtrText.x(cx + (PL + 10) * cosR - 18);
        this._nPtrText.y(cy + (PL + 10) * sinR - 6);
        this._nPtrText.text(qRead);
    }

    _updateParticles() {
        const y = this._pipeY, r = this._pipeR;
        const orX = this._orX;
        let idx = 0;

        this._particles.forEach(p => {
            if (p.x < this._pipeX0 || p.x > this._pipeX1) return;
            const circle = this._nParticlePool[idx];
            if (!circle) return;
            idx++;
            const inJet = p.x > orX && Math.abs(p.y - y) < this._orHole * 1.5;
            const alpha = p.life * (inJet ? 0.70 : 0.45);
            circle.visible(true);
            circle.x(p.x);
            circle.y(p.y);
            circle.radius(p.r);
            circle.fill(`rgba(${inJet ? '160,220,255' : '80,160,220'},${alpha})`);
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
        this._flow += (this._targetFlow - this._flow) * Math.min(1, dt / 0.10);

        // 差压（平方关系）
        const dpTarget = this._flow * this._flow;
        this._dpNorm += (dpTarget - this._dpNorm) * Math.min(1, dt / 0.08);

        // U 管液面（高压侧下降，低压侧上升）
        const dp = this._dpNorm;
        const hTarget = 0.50 + dp * 0.46;    // 高压侧液面归一化（偏低=压下）
        const lTarget = 0.50 + dp * 0.46;    // 低压侧液面归一化（偏高=抬起）
        this._uLevelH += (hTarget - this._uLevelH) * Math.min(1, dt / 0.18);
        this._uLevelL += (lTarget - this._uLevelL) * Math.min(1, dt / 0.18);
        this._floatPos = this._uLevelL;

        // 指针动力学（浮子位移 → 磁连杆 → 指针）
        // ptr_target ∝ √(ΔP) = flow（经线性化凸轮修正）
        const ptrTarget   = this._flow * (this._dialAngle * Math.PI / 180);
        const tDrive      = this._ptrSpring * (ptrTarget - this._ptrAngle);
        const tDamp       = -this._ptrDamp * this._ptrVel;
        const ptrAcc      = (tDrive + tDamp) / this._ptrJ;
        this._ptrVel     += ptrAcc * dt;
        this._ptrAngle   += this._ptrVel * dt;

        // 限位
        const ptrMax = this._dialAngle * Math.PI / 180;
        if (this._ptrAngle < 0)      { this._ptrAngle = 0;       this._ptrVel *= -0.10; }
        if (this._ptrAngle > ptrMax) { this._ptrAngle = ptrMax;  this._ptrVel *= -0.10; }

        // 粒子 + 涡旋更新
        this._updateParticles(dt);
        this._updateVortices(dt);

        // 就地更新动态节点（属性更新，无创建/销毁开销）
        this._updateDynamic();
        this.markDirty();

        this._updateStatusBar();
    }

    _updateParticles(dt) {
        const y   = this._pipeY, r = this._pipeR;
        const orX = this._orX, orW = this._orW;
        const oh  = this._orHole;

        this._particles = this._particles.filter(p => {
            // 孔板处判断粒子是否穿过孔口
            if (p.x >= orX - orW/2 - 2 && p.x <= orX + orW/2 + 2) {
                if (Math.abs(p.y - y) > oh * 1.1) { p.life = 0; return false; }
                p.vx *= 1.8;   // 孔口加速
            }
            p.x   += p.vx * dt;
            p.y   += (Math.random() - 0.5) * 3 * dt;
            p.life -= dt * (0.7 + this._flow * 0.5);
            return p.life > 0 && p.x < this._pipeX1 + 5;
        });

        this._pTimer += dt;
        const rate  = this._flow * 20;
        const inter = rate > 0 ? 1 / rate : 999;

        while (this._pTimer > inter && this._flow > 0.01) {
            this._particles.push({
                x:  this._pipeX0 + 4,
                y:  y + (Math.random() - 0.5) * r * 1.4,
                vx: 30 + this._flow * 80,
                r:  1.0 + Math.random() * 1.8,
                life: 0.55 + Math.random() * 0.5,
            });
            this._pTimer -= inter;
        }
        if (rate === 0) this._pTimer = 0;
    }

    _updateVortices(dt) {
        this._vortices = this._vortices.filter(v => {
            v.angle += v.omega * dt;
            v.r     += dt * 3;
            v.life  -= dt * (0.8 + this._flow * 0.3);
            return v.life > 0 && v.r < this._pipeR * 0.9;
        });

        this._vTimer += dt;
        const vRate  = this._flow * 5;
        const vInter = vRate > 0 ? 1 / vRate : 999;

        while (this._vTimer > vInter && this._flow > 0.08) {
            const side = Math.random() > 0.5 ? 1 : -1;
            const vx   = this._orX + this._orW/2 + this._pipeR * (0.5 + Math.random() * 0.8);
            const vy   = this._pipeY + side * this._pipeR * (0.2 + Math.random() * 0.4);
            this._vortices.push({
                x: vx, y: vy, r: 3 + Math.random() * 4,
                omega: (side > 0 ? 2 : -2) + Math.random() * 2,
                angle: Math.random() * Math.PI * 2,
                life: 0.4 + Math.random() * 0.4,
            });
            this._vTimer -= vInter;
        }
        if (vRate === 0) this._vTimer = 0;
    }

    _updateStatusBar() {
        const q   = this._flow * this.Qmax;
        const dp  = this._dpNorm * this.dpMax;
        const deg = (this._ptrAngle * 180 / Math.PI).toFixed(1);
        const act = this._flow > 0.01;

        if (this._sDot) {
            this._sDot.fill(act ? '#29b6f6' : '#ef5350');
            this._sDot.stroke(act ? '#0277bd' : '#c62828');
            this._sDot.shadowColor(act ? '#29b6f6' : '#ef5350');
            this._sDot.shadowBlur(act ? 6 : 2);
        }
        if (this._sQ)   this._sQ.text(`Q: ${q.toFixed(1)} ${this.unit}`);
        if (this._sDP)  this._sDP.text(`ΔP: ${dp.toFixed(2)} kPa`);
        if (this._sPtr) this._sPtr.text(`指针: ${deg}°`);
    }

    // ══════════════════════════════════════════════════════════
    // 公开 API
    // ══════════════════════════════════════════════════════════

    /**
     * 设置流量
     * @param {number} q  流量（单位与 unit 一致），0 ~ Qmax
     */
    setFlow(q) {
        this._targetFlow = Math.max(0, Math.min(1, q / this.Qmax));
        this._tickSimulation(1.0);
        this._refreshCache();
    }

    /**
     * 获取当前指针示数（流量，经线性化后）
     * @returns {number}
     */
    getReading() {
        const frac = this._ptrAngle / (this._dialAngle * Math.PI / 180);
        return Math.max(0, Math.min(1, frac)) * this.Qmax;
    }

    /**
     * 获取当前差压值（kPa）
     * @returns {number}
     */
    getDeltaP() {
        return this._dpNorm * this.dpMax;
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
            { label: '孔板开孔比 β',        key: 'beta',     type: 'number' },
            { label: '满量程差压 (kPa)',     key: 'dpMax',    type: 'number' },
            { label: '介质 (water/air)',    key: 'medium',   type: 'text'   },
            { label: '初始流量',            key: 'initFlow', type: 'number' },
            { label: '指针阻尼系数',        key: 'ptrDamp',  type: 'number' },
        ];
    }

    onConfigUpdate(cfg) {
        if (cfg.label)   this.label        = cfg.label;
        if (cfg.Qmax)    this.Qmax         = parseFloat(cfg.Qmax);
        if (cfg.unit)    this.unit         = cfg.unit;
        if (cfg.DN)      this.DN           = parseInt(cfg.DN);
        if (cfg.beta)  { this.beta         = parseFloat(cfg.beta);
                         this._orHole     = this._pipeR * this.beta; }
        if (cfg.dpMax)   this.dpMax        = parseFloat(cfg.dpMax);
        if (cfg.medium)  this.medium       = cfg.medium;
        if (cfg.ptrDamp) this._ptrDamp     = parseFloat(cfg.ptrDamp);
        if (cfg.initFlow !== undefined) this.setFlow(parseFloat(cfg.initFlow));
        this.config = { ...this.config, ...cfg };
        this._refreshCache();
    }

    destroy() {
        this._particles = [];
        this._vortices  = [];
        super.destroy?.();
    }
}