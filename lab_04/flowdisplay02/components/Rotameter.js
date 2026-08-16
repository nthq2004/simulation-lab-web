import { BaseComponent } from './BaseComponent.js';

/**
 * 转子流量计（Rotameter / Variable-Area Flow Meter）仿真组件
 *
 * ── 工作原理 ──────────────────────────────────────────────────
 *
 *  转子流量计（又称浮子流量计）是一种变面积式流量计，
 *  由一根自下而上扩张的**锥形玻璃管**和其中可自由上下浮动的
 *  **转子（浮子）**组成。
 *
 *  流体自下而上流动，对转子产生向上的**流体动力**（曳力 + 浮力），
 *  与转子自身**重力**达到平衡时，转子悬停在某一高度，
 *  该高度对应的管壁刻度即为流量读数。
 *
 *  ┌─────────────────────────────────────────────┐
 *  │           力平衡方程                         │
 *  │                                              │
 *  │  F_drag + F_buoy = G_float                  │
 *  │                                              │
 *  │  F_drag  = C_D · ρ_f · v² · A_float / 2    │  曳力
 *  │  F_buoy  = ρ_f · V_float · g               │  浮力
 *  │  G_float = ρ_float · V_float · g            │  重力
 *  │                                              │
 *  │  环形流通面积（随高度 h 增大）：              │
 *  │    A_ring(h) = π[(r_tube(h))² − r_float²]  │
 *  │    r_tube(h) = r0 + h · tan(θ)             │  θ=锥半角
 *  │                                              │
 *  │  由连续方程：Q = v · A_ring                 │
 *  │  代入力平衡解出：Q ∝ A_ring(h)             │
 *  │  → h 与 Q 近似线性关系（面积线性锥管）      │
 *  └─────────────────────────────────────────────┘
 *
 *  转子自旋（Rotation）：
 *    转子棱边刻有斜槽，流体通过时产生切向分量，
 *    使转子绕轴高速自旋（数百 rpm），
 *    自旋使转子保持稳定居中，避免与管壁接触。
 *    自旋角速度 ω_spin ∝ Q（流量越大，自旋越快）
 *
 * ── 结构说明 ──────────────────────────────────────────────────
 *
 *  1. 锥形玻璃管（Conical Glass Tube）
 *     - 透明玻璃，自下而上直径逐渐增大
 *     - 锥半角 θ ≈ 1°~3°（本模型取 2°）
 *     - 管壁刻有均匀刻度线（0% ~ 100%）
 *     - 上下端有黄铜接头（法兰连接）
 *
 *  2. 转子（Float / Rotor）
 *     - 标准形：双锥形（上锥截流，下锥稳流）
 *     - 腰部有 4 条斜槽（产生自旋）
 *     - 材质：不锈钢（密度 ≈ 7900 kg/m³）
 *     - 读数基准：转子**最大截面处**（腰部）对应管壁刻度
 *
 *  3. 流量刻度（Scale）
 *     - 标注在玻璃管外壁右侧
 *     - 范围 0 ~ Qmax（单位：m³/h 或 L/h）
 *     - 近似线性分布（面积线性锥管）
 *
 *  4. 上下接头（End Fittings）
 *     - 黄铜或不锈钢法兰
 *     - 下端：进流口（IN）
 *     - 上端：出流口（OUT）
 *
 *  5. 阻尼效果
 *     - 转子上下移动有液体阻尼，不会瞬间到位
 *     - 流量突变时有合理的响应时间（~0.5s 时间常数）
 *
 * ── 动态效果 ────────────────────────────────────────────────
 *
 *  - 流体粒子（气泡/悬浮颗粒）随流量在管内向上流动
 *  - 转子垂直位置平滑响应流量变化（二阶阻尼系统）
 *  - 转子绕轴自旋，流量越大旋转越快，叶片带拖尾残影
 *  - 管壁刻度随转子位置高亮对应读数
 *  - 玻璃管内液柱颜色随流量深浅变化（水=蓝，气=无色）
 *  - 上下接头振动微粒（模拟流体冲击）
 *
 * ── 物理仿真模型 ────────────────────────────────────────────
 *
 *  转子垂直动力学（二阶 ODE）：
 *    m·ÿ = F_up(Q,y) − G_net − D·ẏ
 *
 *    F_up(Q,y)  = k_f · Q² / A_ring(y)²   （流体曳力，反比于环形面积²）
 *    G_net      = (ρ_float − ρ_fluid)·V·g （净重力，浮力已减去）
 *    D          = 阻尼系数（液体粘性）
 *
 *  稳态解：y_eq 满足 F_up(Q, y_eq) = G_net
 *    → A_ring(y_eq) = k_f · Q / sqrt(G_net)
 *    → y_eq = [A_ring_eq − π·r_float²] / (π·tan(θ)) − r_float/tan(θ) + r0/tan(θ)
 *    简化为：y_eq / H = Q / Qmax（线性近似）
 *
 *  转子自旋：
 *    ω_spin += (ω_target − ω_spin) × (1 − e^{−dt/τ_spin})
 *    ω_target = ω_max · (Q / Qmax)
 *
 * ── 端口 ─────────────────────────────────────────────────────
 *  i — 进流口（下端）
 *  o — 出流口（上端）
 *
 * ── 交互 ─────────────────────────────────────────────────────
 *  setFlow(q)  设置瞬时流量（0 ~ Qmax，单位由 unit 决定）
 *  getReading() 返回转子当前高度对应的流量读数
 */
export class Rotameter extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.width  = Math.max(100, config.width  || 160);
        this.height = Math.max(320, config.height || 420);

        this.type    = 'rotameter';
        this.special = 'none';
        this.cache   = 'fixed';

     /** _initGroups()在BaseComponent中定义，    
     * 初始化三层次分组
     *   _staticGroup   — 静态视觉元素（绘制一次，可缓存）
     *   _dynamicGroup  — 动态元素（每 tick 重建）
     *   _interactGroup — 交互层（点击/悬停，不缓存）
     */
        this._initGroups();
        // 计算各个组件的几何尺寸和位置
        this._recalcGeometry();

        this._initParameters(config);

        // 用于参数显示和配置
        this.config = {'label': this.label, 'medium': this.medium, 'Qmax': this.Qmax,
             'unit': this.unit, 'DN': this.DN,'initFlow': this._flow,'damping': this._damping};

        // ── 初始化 ──
        this._init();

        this.addPort(this._termInX,  this._termInY,  'i',  'pipe', 'in');
        this.addPort(this._termOutX, this._termOutY, 'o', 'pipe', 'out');

        // 粒子池上限（预分配 60 个）
        this._particlePoolSize = 60;
    }

    // ═══════════════════════════════════════════
    // 几何尺寸计算
    // ═══════════════════════════════════════════

    _recalcGeometry() {
        // ── 几何参数 ──
        const W = this.width, H = this.height;

        // 玻璃管区域
        this._tubeX   = W * 0.46          // 管中心线 x
        this._tubeBot = H * 0.85;           // 管底 y（进流口处）
        this._tubeTop = H * 0.12;           // 管顶 y（出流口处）
        this._tubeH   = this._tubeBot - this._tubeTop;  // 管有效高度

        // 锥管半径（底部→顶部线性扩张）
        this._rBot    = W * 0.075;          // 底部内径（半）
        this._rTop    = W * 0.140;          // 顶部内径（半）
        this._wallT   = W * 0.018;          // 管壁厚

        // 转子几何
        this._rFloat  = W * 0.052;          // 转子最大半径（腰部）
        this._hFloat  = H * 0.070;          // 转子总高度

        // 接头高度
        this._fitH    = H * 0.055;
        this._fitW    = W * 0.20;

        // 底座
        this._base = { x: W*0.05, y: H*0.90, w: W*0.90, h: H*0.07, rx: 3 };

        // 端子
        this._termInX  = this._tubeX;
        this._termInY  = this._tubeBot + this._fitH + 24;
        this._termOutX = this._tubeX;
        this._termOutY = this._tubeTop - this._fitH - 24;
    }   
    
    // ═══════════════════════════════════════════
    // 物理参数
    // ═══════════════════════════════════════════
    
   _initParameters(config){
            // ── 铭牌参数 ──
        this.label    = config.label    || 'FI';
        this.medium   = config.medium   || 'water';   // 'water' | 'air'
        this.Qmax     = config.Qmax     || 1.0;       // 最大量程
        this.unit     = config.unit     || 'm³/h';
        this.DN       = config.DN       || 15;         // 公称通径 mm

        // ── 物理状态 ──
        this._flow        = 0;              // 当前目标流量（归一化 0~1）
        this._targetFlow  = 0;
        this._lastRebuildFlow = -1;
        this._floatY      = this._tubeBot - this._hFloat * 0.5;  // 转子质心 y（像素）
        this._floatVel    = 0;              // 转子垂直速度（px/s）
        this._spinAngle   = 0;              // 转子自旋角（rad）
        this._spinSpeed   = 0;              // 自旋角速度（rad/s）

        // 物理参数
        this._mass        = 1.0;            // 归一化质量
        this._netGravity  = 0.6;            // 净重力（重力−浮力，归一化）
        this._damping     = 2.8;            // 垂直阻尼
        this._spinMax     = 18.0;           // 最大自旋角速度（rad/s）

        // 流体粒子
        this._particles   = [];
        this._pTimer      = 0;
   }     
    // ══════════════════════════════════════════════════════════
    _init() {
        this._drawBackground();
        this._drawTube();
        this._drawScale();
        this._drawFittings();
        this._drawStaticLabels();

        this._initDynamicNodes();
    }

    _initDynamicNodes() {
        // 创建所有动态节点并存引用，后续仅更新属性
        const cx = this._tubeX, yBot = this._tubeBot, yTop = this._tubeTop;
        const rBot = this._rBot, rTop = this._rTop, W = this.width, H = this.height;

        // 流体柱
        this._nFluidBody = new Konva.Line({ points: [], closed: true, fill: 'transparent' });
        this._dynamicGroup.add(this._nFluidBody);

        // 流动波纹（3 条）
        this._nWaves = [];
        for (let i = 0; i < 3; i++) {
            const w = new Konva.Line({ points: [], stroke: '', strokeWidth: 1.5, lineCap: 'round' });
            this._nWaves.push(w);
            this._dynamicGroup.add(w);
        }

        // 粒子池（固定大小）
        this._nParticlePool = [];
        for (let i = 0; i < 60; i++) {
            const c = new Konva.Circle({ x: 0, y: 0, radius: 1, fill: 'transparent', visible: false });
            this._nParticlePool.push(c);
            this._dynamicGroup.add(c);
        }

        // 转子主组（始终存在，仅更新位置和旋转）
        this._nFloatGroup = new Konva.Group({ x: 0, y: 0 });
        this._dynamicGroup.add(this._nFloatGroup);

        // 转子各部件（下锥、上锥、4 条斜槽、腰环、轴）
        const fr = this._rFloat, fh = this._hFloat;
        this._nFloatLower = new Konva.Line({ points: [], closed: true, stroke: '#505058', strokeWidth: 0.8 });
        this._nFloatUpper = new Konva.Line({ points: [], closed: true, stroke: '#505058', strokeWidth: 0.8 });
        this._nFloatSlots = [];
        for (let i = 0; i < 4; i++) {
            const s = new Konva.Line({ points: [], stroke: '#303038', strokeWidth: 2.5, lineCap: 'round' });
            this._nFloatSlots.push(s);
            this._nFloatGroup.add(s);
        }
        this._nFloatRing = new Konva.Ellipse({ x: 0, y: 0, radiusX: fr, radiusY: fr * 0.25, fill: 'none', stroke: 'rgba(220,220,230,0.40)', strokeWidth: 0.8 });
        this._nFloatAxis = new Konva.Line({ points: [0, -fh * 0.55, 0, fh * 0.55], stroke: 'rgba(200,200,210,0.25)', strokeWidth: 1, lineCap: 'round', dash: [3, 3] });
        this._nFloatGroup.add(this._nFloatLower, this._nFloatUpper, this._nFloatRing, this._nFloatAxis);

        // 自旋拖尾（3 条）
        this._nTrails = [];
        for (let t = 0; t < 3; t++) {
            const tg = new Konva.Group({ x: 0, y: 0, visible: false });
            tg.add(new Konva.Ellipse({ x: 0, y: 0, radiusX: fr * 0.90, radiusY: fr * 0.22, fill: 'none', stroke: 'rgba(180,220,255,0.60)', strokeWidth: 0.8 }));
            this._nTrails.push(tg);
            this._dynamicGroup.add(tg);
        }

        // 气隙左右
        this._nGapL = new Konva.Line({ points: [], closed: true, fill: 'transparent' });
        this._nGapR = new Konva.Line({ points: [], closed: true, fill: 'transparent' });
        this._dynamicGroup.add(this._nGapL, this._nGapR);

        // 力平衡箭头
        this._nArrowUp = new Konva.Arrow({ points: [], stroke: '', fill: '', strokeWidth: 1.8, pointerLength: 5, pointerWidth: 4, visible: false });
        this._nArrowUpLabel = new Konva.Text({ text: 'F↑', fontSize: 7, fill: '', visible: false });
        this._nArrowDown = new Konva.Arrow({ points: [], stroke: '', fill: '', strokeWidth: 1.8, pointerLength: 5, pointerWidth: 4, visible: false });
        this._nArrowDownLabel = new Konva.Text({ text: 'G↓', fontSize: 7, fill: '', visible: false });
        this._dynamicGroup.add(this._nArrowUp, this._nArrowUpLabel, this._nArrowDown, this._nArrowDownLabel);

        // 首次更新
        this._updateDynamic();
    }

    // ── 背景 ─────────────────────────────────────────────────
    _drawBackground() {
        const W = this.width, H = this.height;
        const b = this._base;

        // 仪表外框
        this._staticGroup.add(new Konva.Rect({
            x: 0, y: 0, width: W, height: H * 0.92,
            fill: '#5f706e', stroke: '#2e2e34', strokeWidth: 1.5,
            cornerRadius: 6,
            shadowColor: '#611414', shadowBlur: 8, shadowOffsetY: 3, shadowOpacity: 0.4,
        }));
        // 底座
        this._staticGroup.add(new Konva.Rect({
            x: b.x, y: b.y, width: b.w, height: b.h,
            fill: '#6565a5', stroke: '#383840', strokeWidth: 1.2, cornerRadius: b.rx,
        }));
    }

    // ── 锥形玻璃管（静态外壳）────────────────────────────────
    _drawTube() {
        const cx   = this._tubeX;
        const yBot = this._tubeBot, yTop = this._tubeTop;
        const rBot = this._rBot, rTop = this._rTop;
        const wT   = this._wallT;

        // ── 管壁（梯形，左右各一条斜线形成锥形）──
        // 外轮廓（含管壁厚）
        this._staticGroup.add(new Konva.Line({
            points: [
                cx - rBot - wT, yBot,
                cx - rTop - wT, yTop,
                cx + rTop + wT, yTop,
                cx + rBot + wT, yBot,
            ],
            closed: true,
            fillLinearGradientStartPoint: { x: cx - rTop - wT, y: 0 },
            fillLinearGradientEndPoint:   { x: cx + rTop + wT, y: 0 },
            fillLinearGradientColorStops: [
                0, 'rgba(180,220,240,0.18)',
                0.12, 'rgba(200,235,255,0.55)',
                0.18, 'rgba(220,245,255,0.12)',
                0.50, 'rgba(180,220,250,0.08)',
                0.82, 'rgba(220,245,255,0.12)',
                0.88, 'rgba(200,235,255,0.55)',
                1,   'rgba(180,220,240,0.18)',
            ],
            stroke: 'rgba(180,220,250,0.30)',
            strokeWidth: 0.5,
        }));

        // 左管壁（实体，有厚度）
        this._staticGroup.add(new Konva.Line({
            points: [
                cx - rBot - wT, yBot,
                cx - rBot,      yBot,
                cx - rTop,      yTop,
                cx - rTop - wT, yTop,
            ],
            closed: true,
            fillLinearGradientStartPoint: { x: cx - rTop - wT, y: 0 },
            fillLinearGradientEndPoint:   { x: cx - rTop, y: 0 },
            fillLinearGradientColorStops: [
                0, 'rgba(160,210,240,0.80)',
                0.5,'rgba(200,235,255,0.95)',
                1,  'rgba(160,210,240,0.70)',
            ],
            stroke: 'rgba(140,200,230,0.60)', strokeWidth: 0.5,
        }));

        // 右管壁
        this._staticGroup.add(new Konva.Line({
            points: [
                cx + rBot,      yBot,
                cx + rBot + wT, yBot,
                cx + rTop + wT, yTop,
                cx + rTop,      yTop,
            ],
            closed: true,
            fillLinearGradientStartPoint: { x: cx + rTop, y: 0 },
            fillLinearGradientEndPoint:   { x: cx + rTop + wT, y: 0 },
            fillLinearGradientColorStops: [
                0, 'rgba(160,210,240,0.70)',
                0.5,'rgba(200,235,255,0.95)',
                1,  'rgba(160,210,240,0.80)',
            ],
            stroke: 'rgba(140,200,230,0.60)', strokeWidth: 0.5,
        }));

        // 管内液柱背景（静态底色，动态层叠加流体颜色）
        this._staticGroup.add(new Konva.Line({
            points: [cx-rBot, yBot, cx-rTop, yTop, cx+rTop, yTop, cx+rBot, yBot],
            closed: true,
            fill: 'rgba(40,80,120,0.10)',
        }));

        // 管口上下水平封边
        this._staticGroup.add(new Konva.Line({
            points: [cx-rTop-wT, yTop, cx+rTop+wT, yTop],
            stroke: 'rgba(180,220,250,0.70)', strokeWidth: 1.5, lineCap: 'round',
        }));
        this._staticGroup.add(new Konva.Line({
            points: [cx-rBot-wT, yBot, cx+rBot+wT, yBot],
            stroke: 'rgba(180,220,250,0.70)', strokeWidth: 1.5, lineCap: 'round',
        }));

        // 玻璃高光（左内侧竖向亮条）
        this._staticGroup.add(new Konva.Line({
            points: [
                cx - rBot * 0.68, yBot - 4,
                cx - rTop * 0.68, yTop + 4,
            ],
            stroke: 'rgba(255,255,255,0.22)', strokeWidth: 2.5, lineCap: 'round',
        }));
        this._staticGroup.add(new Konva.Line({
            points: [
                cx - rBot * 0.50, yBot - 4,
                cx - rTop * 0.50, yTop + 4,
            ],
            stroke: 'rgba(255,255,255,0.10)', strokeWidth: 1.2, lineCap: 'round',
        }));
    }

    // ── 刻度线（管外右侧）────────────────────────────────────
    _drawScale() {
        const cx   = this._tubeX;
        const yBot = this._tubeBot, yTop = this._tubeTop;
        const H_t  = this._tubeH;
        const rTop = this._rTop;
        const wT   = this._wallT;

        const scaleGroup = new Konva.Group();
        const ticks = 10;   // 10 等分

        for (let i = 0; i <= ticks; i++) {
            const frac = i / ticks;              // 0=底，1=顶
            const y    = yBot - frac * H_t;

            // 该高度对应的管内径（线性插值）
            const r    = this._rBot + frac * (this._rTop - this._rBot);
            const x0   = cx + r + wT + 2;
            const isMajor = i % 2 === 0;
            const tLen = isMajor ? 9 : 7;

            scaleGroup.add(new Konva.Line({
                points: [x0, y, x0 + tLen, y],
                stroke: isMajor ? '#e4d997' : '#f1d491',
                strokeWidth: isMajor ? 1.2 : 0.7,
            }));

            if (isMajor) {
                const qVal = (this.Qmax * frac).toFixed(
                    this.Qmax < 0.1 ? 3 : this.Qmax < 1 ? 2 : 1
                );
                scaleGroup.add(new Konva.Text({
                    x: x0 + 11, y: y - 5, width: 38,
                    text: qVal,
                    fontSize: 16, fontFamily: 'monospace',
                    fill: '#f3e491',
                }));
            }
        }

        // 单位标注
        scaleGroup.add(new Konva.Text({
            x: cx + rTop + wT + 2, y: yTop - 22, width: 50,
            text: this.unit,
            fontSize: 18, fontStyle: 'bold', fill: '#f2e8bd',
        }));

        // 当前读数指示线（动态，存引用后在 _updateScaleLine 中更新）
        this._scaleLine = new Konva.Line({
            points: [0, 0, 0, 0],
            stroke: '#e04040', strokeWidth: 2.5, dash: [4, 3],
        });
        scaleGroup.add(this._scaleLine);

        // 读数文本（右侧浮动）
        this._scaleText = new Konva.Text({
            x: 0, y: 0, text: '',
            fontSize: 16, fontStyle: 'bold', fill: '#e04040',
            shadowColor: '#611414', shadowBlur: 8, shadowOffsetY: 3, shadowOpacity: 0.4,
        });
        scaleGroup.add(this._scaleText);

        this._staticGroup.add(scaleGroup);
    }

    // ── 上下接头（法兰接头，黄铜）────────────────────────────
    _drawFittings() {
        const cx   = this._tubeX;
        const yBot = this._tubeBot, yTop = this._tubeTop;
        const fw   = this._fitW, fh = this._fitH;
        const rBot = this._rBot, rTop = this._rTop;
        const wT   = this._wallT;

        [[yTop - fh, rTop, true], [yBot, rBot, false]].forEach(
            ([y, r, isTop]) => {
                const rx = cx - fw / 2;

                // 接头本体（黄铜色梯形）
                this._staticGroup.add(new Konva.Rect({
                    x: rx, y,
                    width: fw, height: fh,
                    fillLinearGradientStartPoint: { x: 0, y: 0 },
                    fillLinearGradientEndPoint:   { x: fw, y: 0 },
                    fillLinearGradientColorStops: [
                        0, '#7a5c18', 0.25,'#c8a040', 0.55,'#e0c060',
                        0.80,'#c8a040', 1,'#7a5c18',
                    ],
                    stroke: '#5a4010', strokeWidth: 1.2, cornerRadius: 2,
                }));

                // 进出水管（短段竖管）
                const pipeLen = this.height * 0.06;
                const pipeY   = isTop ? y - pipeLen : y + fh;
                this._staticGroup.add(new Konva.Rect({
                    x: cx - r - wT, y: pipeY,
                    width: (r + wT) * 2, height: pipeLen,
                    fillLinearGradientStartPoint: { x: 0, y: 0 },
                    fillLinearGradientEndPoint:   { x: (r+wT)*2, y: 0 },
                    fillLinearGradientColorStops: [0,'#555',0.35,'#aaa',0.65,'#888',1,'#555'],
                    stroke: '#404040', strokeWidth: 0.8,
                }));
            }
        );
    }

    // ── 静态标注 ─────────────────────────────────────────────
    _drawStaticLabels() {
        const W = this.width;
        const cx = this._tubeX;

        // 位号 + 铭牌
        this._staticGroup.add(new Konva.Text({
            x: 0, y: -28, width: W,
            text: `${this.label}  转子流量计`,
            fontSize: 18, fontStyle: 'bold', fill: '#0c0c0c', align: 'center',
        }));
    }

    // ══════════════════════════════════════════════════════════
    // 动态层
    // ══════════════════════════════════════════════════════════

    _updateDynamic() {
        this._updateFluid();
        this._updateParticles();
        this._updateFloat();
        this._updateScaleIndicator();
    }

    // ── 管内流体（就地更新）─────────────────────────────────
    _updateFluid() {
        const cx   = this._tubeX;
        const yBot = this._tubeBot, yTop = this._tubeTop;
        const rBot = this._rBot, rTop = this._rTop;
        const q    = this._flow;

        if (q < 0.005) {
            this._nFluidBody.visible(false);
            this._nWaves.forEach(w => w.visible(false));
            return;
        }
        this._nFluidBody.visible(true);

        const alpha = 0.12 + q * 0.20;
        const isWater = this.medium !== 'air';
        const fluidColor = isWater
            ? `rgba(40,140,220,${alpha})`
            : `rgba(200,230,255,${alpha * 0.4})`;

        this._nFluidBody.points([cx - rBot, yBot, cx - rTop, yTop, cx + rTop, yTop, cx + rBot, yBot]);
        this._nFluidBody.fill(fluidColor);

        // 流动波纹
        const phase = (Date.now() / 300) % 1;
        for (let i = 0; i < 3; i++) {
            const f  = ((i / 3) + phase) % 1;
            const yw = yBot - f * this._tubeH;
            const rw = rBot + f * (rTop - rBot);
            const wa = Math.sin(f * Math.PI) * 0.18 * q;
            const w  = this._nWaves[i];
            w.visible(true);
            w.points([cx - rw * 0.85, yw, cx + rw * 0.85, yw]);
            w.stroke(isWater
                ? `rgba(100,200,255,${wa})`
                : `rgba(220,240,255,${wa * 0.5})`);
        }
    }

    // ── 流体粒子（对象池）───────────────────────────────────
    _updateParticles() {
        const cx   = this._tubeX;
        const rBot = this._rBot, rTop = this._rTop;
        const yBot = this._tubeBot;
        const isWater = this.medium !== 'air';

        let idx = 0;
        this._particles.forEach(p => {
            const f  = Math.max(0, Math.min(1, (yBot - p.y) / this._tubeH));
            const rw = rBot + f * (rTop - rBot);
            if (Math.abs(p.x - cx) > rw) return;

            const circle = this._nParticlePool[idx];
            if (!circle) return;
            idx++;

            circle.visible(true);
            circle.x(p.x);
            circle.y(p.y);
            circle.radius(p.r);
            const alpha = p.life * (isWater ? 0.55 : 0.30);
            circle.fill(isWater
                ? `rgba(180,230,255,${alpha})`
                : `rgba(230,240,255,${alpha * 0.6})`);
            circle.stroke(isWater
                ? `rgba(100,200,255,${alpha * 0.5})`
                : 'none');
            circle.strokeWidth(0.5);
        });

        // 隐藏池中未使用的节点
        for (let i = idx; i < this._nParticlePool.length; i++) {
            this._nParticlePool[i].visible(false);
        }
    }

    // ── 转子（就地更新）──────────────────────────────────────
    _updateFloat() {
        const cx  = this._tubeX;
        const fy  = this._floatY;
        const fh  = this._hFloat;
        const fr  = this._rFloat;
        const ang = this._spinAngle;
        const q   = this._flow;

        const hFrac = Math.max(0, Math.min(1, (this._tubeBot - fy) / this._tubeH));
        const rTube = this._rBot + hFrac * (this._rTop - this._rBot);

        // 转子组位置/旋转
        this._nFloatGroup.x(cx);
        this._nFloatGroup.y(fy);
        this._nFloatGroup.rotation(ang * 180 / Math.PI);

        // 下锥
        this._nFloatLower.points([
            -fr * 0.35, fh * 0.50,
            -fr,        0,
            -fr * 0.35, -fh * 0.08,
            fr  * 0.35, -fh * 0.08,
            fr,         0,
            fr  * 0.35, fh * 0.50,
        ]);
        this._nFloatLower.fillLinearGradientStartPoint({ x: -fr, y: 0 });
        this._nFloatLower.fillLinearGradientEndPoint({ x:  fr, y: 0 });
        this._nFloatLower.fillLinearGradientColorStops([
            0, '#3a3a40', 0.3,'#909098', 0.5,'#c0c0c8', 0.7,'#909098', 1,'#3a3a40',
        ]);

        // 上锥
        this._nFloatUpper.points([
            -fr * 0.35, -fh * 0.08,
            -fr,        0,
            -fr * 0.30, -fh * 0.50,
            fr  * 0.30, -fh * 0.50,
            fr,         0,
            fr  * 0.35, -fh * 0.08,
        ]);
        this._nFloatUpper.fillLinearGradientStartPoint({ x: -fr, y: 0 });
        this._nFloatUpper.fillLinearGradientEndPoint({ x:  fr, y: 0 });
        this._nFloatUpper.fillLinearGradientColorStops([
            0, '#484850', 0.3,'#a0a0a8', 0.5,'#d0d0d8', 0.7,'#a0a0a8', 1,'#484850',
        ]);

        // 4 条斜槽（用旋转组时槽的位置是局部的，需计算角度）
        const slotN = 4;
        for (let i = 0; i < slotN; i++) {
            const a0  = (i / slotN) * Math.PI * 2;
            const a1  = a0 + Math.PI / (slotN * 1.4);
            const sr0 = fr * 0.75, sr1 = fr * 0.98;
            this._nFloatSlots[i].points([
                sr0 * Math.cos(a0), sr0 * Math.sin(a0) * 0.25,
                sr1 * Math.cos(a1), sr1 * Math.sin(a1) * 0.25,
            ]);
        }

        // 腰环（半径不变）
        this._nFloatRing.radiusX(fr);
        this._nFloatRing.radiusY(fr * 0.25);

        // 轴（长度不变）

        // 自旋拖尾
        const spinNorm = Math.min(1, Math.abs(this._spinSpeed) / this._spinMax);
        for (let t = 0; t < 3; t++) {
            const trail = this._nTrails[t];
            if (spinNorm > 0.08) {
                const tAng = ang - (this._spinSpeed > 0 ? 1 : -1) * (t + 1) * 0.18 * spinNorm;
                const ta   = spinNorm * (0.25 - (t + 1) * 0.06);
                trail.visible(true);
                trail.x(cx);
                trail.y(fy);
                trail.rotation(tAng * 180 / Math.PI);
                trail.opacity(ta);
            } else {
                trail.visible(false);
            }
        }

        // 气隙
        const gapW = rTube - fr;
        if (gapW > 1) {
            const gapAlpha = Math.min(0.35, q * 0.5);
            this._nGapL.visible(true);
            this._nGapL.points([cx - rTube, fy - fh*0.08, cx - fr - 1, fy - fh*0.08,
                cx - fr - 1, fy + fh*0.06, cx - rTube, fy + fh*0.06]);
            this._nGapL.fill(`rgba(80,180,255,${gapAlpha})`);
            this._nGapR.visible(true);
            this._nGapR.points([cx + fr + 1, fy - fh*0.08, cx + rTube, fy - fh*0.08,
                cx + rTube, fy + fh*0.06, cx + fr + 1, fy + fh*0.06]);
            this._nGapR.fill(`rgba(80,180,255,${gapAlpha})`);
        } else {
            this._nGapL.visible(false);
            this._nGapR.visible(false);
        }

        // 力平衡箭头
        const showArrows = q > 0.05 && Math.abs(this._floatVel) < 8;
        if (showArrows) {
            const arrowAlpha = Math.min(0.70, 0.30 + q * 0.5);
            const fLen = Math.min(fh * 0.55, q * fh * 1.1);
            this._nArrowUp.visible(true);
            this._nArrowUp.points([cx - fr - 14, fy + fh*0.3, cx - fr - 14, fy + fh*0.3 - fLen]);
            this._nArrowUp.stroke(`rgba(80,160,255,${arrowAlpha})`);
            this._nArrowUp.fill(`rgba(80,160,255,${arrowAlpha})`);
            this._nArrowUpLabel.visible(true);
            this._nArrowUpLabel.x(cx - fr - 36);
            this._nArrowUpLabel.y(fy + fh*0.3 - fLen - 4);
            this._nArrowUpLabel.fill(`rgba(80,160,255,${arrowAlpha})`);

            const gLen = this._netGravity * fh * 0.65;
            this._nArrowDown.visible(true);
            this._nArrowDown.points([cx - fr - 14, fy - fh*0.3, cx - fr - 14, fy - fh*0.3 + gLen]);
            this._nArrowDown.stroke(`rgba(220,80,80,${arrowAlpha * 0.85})`);
            this._nArrowDown.fill(`rgba(220,80,80,${arrowAlpha * 0.85})`);
            this._nArrowDownLabel.visible(true);
            this._nArrowDownLabel.x(cx - fr - 30);
            this._nArrowDownLabel.y(fy - fh*0.3 - 12);
            this._nArrowDownLabel.fill(`rgba(220,80,80,${arrowAlpha * 0.85})`);
        } else {
            this._nArrowUp.visible(false);
            this._nArrowUpLabel.visible(false);
            this._nArrowDown.visible(false);
            this._nArrowDownLabel.visible(false);
        }
    }

    // ── 刻度指示线（动态更新） ───────────────────────────────
    _updateScaleIndicator() {
        const cx  = this._tubeX;
        const fy  = this._floatY;
        const hFrac = Math.max(0, Math.min(1, (this._tubeBot - fy) / this._tubeH));
        const rw  = this._rBot + hFrac * (this._rTop - this._rBot);
        const wT  = this._wallT;
        const xR  = cx + rw + wT + 2;
        const qReading = hFrac * this.Qmax;

        if (this._scaleLine) {
            this._scaleLine.points([cx - rw - wT - 2, fy, xR + 60, fy]);
        }
        if (this._scaleText) {
            this._scaleText.x(xR + 70);
            this._scaleText.y(fy - 10);
            this._scaleText.text(
                this._flow > 0.01
                    ? qReading.toFixed(this.Qmax < 0.1 ? 4 : this.Qmax < 1 ? 3 : 2)
                    : ''
            );
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
        // 流量平滑跟随（一阶惯性，时间常数 0.15s）
        this._flow += (this._targetFlow - this._flow) * Math.min(1, dt / 0.15);

        // ── 转子垂直动力学 ──
        // 平衡位置：y_eq 与 Q 线性对应（h_eq = Q/Qmax × H_tube）
        const hEq    = this._flow * this._tubeH;  // 平衡高度（px，从底部算）
        const yEq    = this._tubeBot - this._hFloat * 0.5 - hEq;

        // 净力 = 弹性项（趋向平衡）+ 阻尼
        const dispForce = -3.5 * (this._floatY - yEq);
        const dampForce = -this._damping * this._floatVel;
        const acc = (dispForce + dampForce) / this._mass;

        this._floatVel += acc * dt;
        this._floatY   += this._floatVel * dt;

        // 限位：转子不能超出管端
        const yMin = this._tubeTop + this._hFloat * 0.6;
        const yMax = this._tubeBot - this._hFloat * 0.55;
        if (this._floatY < yMin) { this._floatY = yMin; this._floatVel *= -0.15; }
        if (this._floatY > yMax) { this._floatY = yMax; this._floatVel *= -0.15; }

        // ── 转子自旋 ──
        const omegaTarget = this._spinMax * this._flow;
        this._spinSpeed += (omegaTarget - this._spinSpeed) * Math.min(1, dt / 0.25);
        this._spinAngle += this._spinSpeed * dt;

        // ── 粒子系统 ──
        this._updateParticles(dt);

        // 就地更新动态节点（属性更新，无创建/销毁开销）
        this._updateDynamic();
        this.markDirty();
    }

    _updateParticles(dt) {
        const cx     = this._tubeX;
        const rBot   = this._rBot, rTop = this._rTop;
        const yBot   = this._tubeBot, tubeH = this._tubeH;
        const vy     = -(40 + this._flow * 120);    // 向上速度（px/s）

        // 更新
        this._particles = this._particles.filter(p => {
            p.y  += vy * dt + (Math.random() - 0.5) * 4 * dt;
            p.x  += (Math.random() - 0.5) * 2 * dt;
            p.life -= dt * (0.8 + this._flow * 0.6);
            return p.life > 0 && p.y > this._tubeTop;
        });

        // 生成新粒子（从底部流入）
        this._pTimer += dt;
        const rate   = this._flow * 18;
        const inter  = rate > 0 ? 1 / rate : 999;
        while (this._pTimer > inter && this._flow > 0.01) {
            const f   = 0;  // 底部
            const rw  = rBot;
            const xOff= (Math.random() - 0.5) * rw * 1.5;
            this._particles.push({
                x: cx + xOff,
                y: yBot - 5,
                r: 1.0 + Math.random() * 1.8,
                life: 0.5 + Math.random() * 0.6,
            });
            this._pTimer -= inter;
        }
        if (rate === 0) this._pTimer = 0;
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
     * 获取转子当前高度对应的流量读数
     * @returns {number}  流量（与 unit 一致）
     */
    getReading() {
        const hFrac = Math.max(0, Math.min(1,
            (this._tubeBot - this._floatY - this._hFloat * 0.5) / this._tubeH
        ));
        return hFrac * this.Qmax;
    }

    /** 获取转子位置百分比（0%=底，100%=顶） */
    getPositionPct() {
        return Math.round(
            Math.max(0, Math.min(100,
                (this._tubeBot - this._floatY - this._hFloat * 0.5) / this._tubeH * 100
            ))
        );
    }

    /** 获取转子自旋转速（rpm） */
    getSpinRpm() {
        return Math.abs(this._spinSpeed) * 60 / (2 * Math.PI);
    }

    update(state) {
        if (typeof state === 'number') this.setFlow(state);
        this._refreshCache();
    }

    getConfigFields() {
        return [
            { label: '位号/名称',           key: 'label',   type: 'text'   },
            { label: '介质 (water/air)',     key: 'medium',  type: 'text'   },
            { label: '最大量程 Qmax',        key: 'Qmax',    type: 'number' },
            { label: '流量单位',             key: 'unit',    type: 'text'   },
            { label: '公称通径 DN (mm)',      key: 'DN',      type: 'number' },
            { label: '初始流量',             key: 'initFlow',type: 'number' },
            { label: '阻尼系数',             key: 'damping', type: 'number' },
        ];
    }

    onConfigUpdate(cfg) {
        if (cfg.label)   this.label   = cfg.label;
        if (cfg.medium)  this.medium  = cfg.medium;
        if (cfg.Qmax)    this.Qmax    = parseFloat(cfg.Qmax);
        if (cfg.unit)    this.unit    = cfg.unit;
        if (cfg.DN)      this.DN      = parseInt(cfg.DN);
        if (cfg.damping) this._damping= parseFloat(cfg.damping);
        if (cfg.initFlow !== undefined) this.setFlow(parseFloat(cfg.initFlow));
        this.config = cfg;
        this._refreshCache();
    }

    destroy() {
        this._particles = [];
        super.destroy?.();
    }
}