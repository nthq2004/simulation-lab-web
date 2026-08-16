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
 *  terminal_in  — 进流口（下端）
 *  terminal_out — 出流口（上端）
 *
 * ── 交互 ─────────────────────────────────────────────────────
 *  setFlow(q)  设置瞬时流量（0 ~ Qmax，单位由 unit 决定）
 *  getReading() 返回转子当前高度对应的流量读数
 */
export class Rotameter extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.width  = Math.max(160, config.width  || 200);
        this.height = Math.max(320, config.height || 420);

        this.type    = 'rotameter';
        this.special = 'none';
        this.cache   = 'fixed';

        this._initGroups();
        // ── 铭牌参数 ──
        this.label    = config.label    || 'FI';
        this.medium   = config.medium   || 'water';   // 'water' | 'air'
        this.Qmax     = config.Qmax     || 1.0;       // 最大量程
        this.unit     = config.unit     || 'm³/h';
        this.DN       = config.DN       || 15;         // 公称通径 mm

        // ── 几何参数 ──
        const W = this.width, H = this.height;

        // 玻璃管区域
        this._tubeX   = W * 0.32;          // 管中心线 x
        this._tubeBot = H * 0.82;           // 管底 y（进流口处）
        this._tubeTop = H * 0.12;           // 管顶 y（出流口处）
        this._tubeH   = this._tubeBot - this._tubeTop;  // 管有效高度

        // 锥管半径（底部→顶部线性扩张）
        this._rBot    = W * 0.055;          // 底部内径（半）
        this._rTop    = W * 0.120;          // 顶部内径（半）
        this._wallT   = W * 0.018;          // 管壁厚

        // 转子几何
        this._rFloat  = W * 0.042;          // 转子最大半径（腰部）
        this._hFloat  = H * 0.070;          // 转子总高度

        // 接头高度
        this._fitH    = H * 0.055;
        this._fitW    = W * 0.20;

        // 底座
        this._base = { x: W*0.05, y: H*0.90, w: W*0.90, h: H*0.07, rx: 3 };

        // 端子
        this._termInX  = this._tubeX;
        this._termInY  = this._tubeBot + this._fitH + 4;
        this._termOutX = this._tubeX;
        this._termOutY = this._tubeTop - this._fitH - 4;

        // ── 物理状态 ──
        this._flow        = 0;              // 当前目标流量（归一化 0~1）
        this._targetFlow  = 0;
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

        // ── 初始化 ──
        this._init();

        this.addPort(this._termInX,  this._termInY,  'terminal_in',  'pipe', 'IN');
        this.addPort(this._termOutX, this._termOutY, 'terminal_out', 'pipe', 'OUT');
    }

    // ══════════════════════════════════════════════════════════
    _init() {
        this._drawBackground();
        this._drawTube();
        this._drawScale();
        this._drawFittings();
        this._drawStaticLabels();
        this._drawStatusBar();
        this._rebuildDynamic();
    }

    // ── 背景 ─────────────────────────────────────────────────
    _drawBackground() {
        const W = this.width, H = this.height;
        const b = this._base;

        // 仪表外框
        this._staticGroup.add(new Konva.Rect({
            x: 0, y: 0, width: W, height: H * 0.92,
            fill: '#1e1e22', stroke: '#2e2e34', strokeWidth: 1.5,
            cornerRadius: 6,
            shadowColor: '#000', shadowBlur: 8, shadowOffsetY: 3, shadowOpacity: 0.4,
        }));
        // 底座
        this._staticGroup.add(new Konva.Rect({
            x: b.x, y: b.y, width: b.w, height: b.h,
            fill: '#28282e', stroke: '#383840', strokeWidth: 1.2, cornerRadius: b.rx,
        }));
        // 底座螺钉
        [0.15, 0.85].forEach(fx => {
            const sx = b.x + b.w * fx, sy = b.y + b.h / 2;
            const sr = this.width * 0.018;
            this._staticGroup.add(new Konva.Circle({ x:sx, y:sy, radius:sr, fill:'#888', stroke:'#555', strokeWidth:0.7 }));
            this._staticGroup.add(new Konva.Line({ points:[sx-sr*0.6,sy,sx+sr*0.6,sy], stroke:'#444', strokeWidth:1, lineCap:'round' }));
            this._staticGroup.add(new Konva.Line({ points:[sx,sy-sr*0.6,sx,sy+sr*0.6], stroke:'#444', strokeWidth:1, lineCap:'round' }));
        });
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
            const tLen = isMajor ? 9 : 5;

            scaleGroup.add(new Konva.Line({
                points: [x0, y, x0 + tLen, y],
                stroke: isMajor ? '#c8b860' : '#907840',
                strokeWidth: isMajor ? 1.2 : 0.7,
            }));

            if (isMajor) {
                const qVal = (this.Qmax * frac).toFixed(
                    this.Qmax < 0.1 ? 3 : this.Qmax < 1 ? 2 : 1
                );
                scaleGroup.add(new Konva.Text({
                    x: x0 + 11, y: y - 5, width: 38,
                    text: qVal,
                    fontSize: 8, fontFamily: 'monospace',
                    fill: '#c8b860',
                }));
            }
        }

        // 单位标注
        scaleGroup.add(new Konva.Text({
            x: cx + rTop + wT + 2, y: yTop - 18, width: 50,
            text: this.unit,
            fontSize: 7, fontStyle: 'bold', fill: '#a09048',
        }));

        // 当前读数指示线（动态，存引用后在 _updateScaleLine 中更新）
        this._scaleLine = new Konva.Line({
            points: [0, 0, 0, 0],
            stroke: '#e04040', strokeWidth: 1.5, dash: [4, 3],
        });
        scaleGroup.add(this._scaleLine);

        // 读数文本（右侧浮动）
        this._scaleText = new Konva.Text({
            x: 0, y: 0, text: '',
            fontSize: 9, fontStyle: 'bold', fill: '#e04040',
            shadowColor: '#000', shadowBlur: 2, shadowOpacity: 0.5,
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

        [[yTop - fh, rTop, '出', 'OUT', true], [yBot, rBot, '进', 'IN', false]].forEach(
            ([y, r, labelCN, labelEN, isTop]) => {
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

                // 法兰螺栓（4 个）
                [0.15, 0.35, 0.65, 0.85].forEach(fx => {
                    const bx = rx + fw * fx;
                    const by = y + fh / 2;
                    const br = this.width * 0.014;
                    this._staticGroup.add(new Konva.Circle({ x:bx, y:by, radius:br, fill:'#8a8a8a', stroke:'#606060', strokeWidth:0.7 }));
                    this._staticGroup.add(new Konva.Line({ points:[bx-br*0.6,by,bx+br*0.6,by], stroke:'#505050', strokeWidth:0.9, lineCap:'round' }));
                });

                // 内径孔（圆，对应管径）
                this._staticGroup.add(new Konva.Circle({
                    x: cx, y: isTop ? y + fh : y,
                    radius: r + wT,
                    fill: '#1a1a1a', stroke: '#404040', strokeWidth: 0.8,
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

                // 标注
                this._staticGroup.add(new Konva.Text({
                    x: cx - fw/2, y: isTop ? y - 14 : y + fh + 3,
                    width: fw,
                    text: `${labelEN} (${labelCN})`,
                    fontSize: 7, fontStyle: 'bold',
                    fill: isTop ? '#80cbc4' : '#90caf9',
                    align: 'center',
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
            x: 0, y: -16, width: W,
            text: `${this.label}  转子流量计  DN${this.DN}`,
            fontSize: 9, fontStyle: 'bold', fill: '#8ab4f8', align: 'center',
        }));

        // 左侧注释：结构标注
        const lx = cx - this._rTop - this._wallT - 54;
        const annotations = [
            { y: this._tubeTop  + this._tubeH * 0.08, text: '出流口' },
            { y: this._tubeTop  + this._tubeH * 0.30, text: '锥管' },
            { y: this._tubeTop  + this._tubeH * 0.55, text: '转子' },
            { y: this._tubeTop  + this._tubeH * 0.78, text: '进流口' },
        ];
        annotations.forEach(({ y, text }) => {
            // 引线
            const r = this._rBot + (1 - (y - this._tubeTop) / this._tubeH) * (this._rTop - this._rBot);
            this._staticGroup.add(new Konva.Line({
                points: [lx + 36, y, cx - r - this._wallT - 2, y],
                stroke: 'rgba(150,150,150,0.35)', strokeWidth: 0.8, dash: [3,3],
            }));
            this._staticGroup.add(new Konva.Text({
                x: lx, y: y - 5, width: 34, text,
                fontSize: 7, fill: '#808080', align: 'right',
            }));
        });

        // 原理说明（底部）
        this._staticGroup.add(new Konva.Text({
            x: W * 0.02, y: this._base.y - 26, width: W * 0.96,
            text: '力平衡: F曳 + F浮 = G重  →  h ∝ Q',
            fontSize: 7, fill: 'rgba(160,160,120,0.60)', align: 'center',
            fontStyle: 'italic',
        }));
    }

    // ── 状态栏 ───────────────────────────────────────────────
    _drawStatusBar() {
        const b = this._base;

        this._statusDot = new Konva.Circle({
            x: b.x + 10, y: b.y + b.h/2, radius: 4,
            fill: '#ef5350', stroke: '#c62828', strokeWidth: 0.8,
            shadowColor: '#ef5350', shadowBlur: 2, shadowOpacity: 0.6,
        });
        this._statusQ = new Konva.Text({
            x: b.x + 22, y: b.y + b.h/2 - 5, width: 100,
            text: `Q: 0.00 ${this.unit}`,
            fontSize: 8, fontStyle: 'bold', fill: '#2979b8',
        });
        this._statusH = new Konva.Text({
            x: b.x + 128, y: b.y + b.h/2 - 5, width: 70,
            text: '位置: 0%',
            fontSize: 8, fill: '#43a047',
        });
        this._statusRpm = new Konva.Text({
            x: b.x + 200, y: b.y + b.h/2 - 5, width: 70,
            text: '自旋: 0 rpm',
            fontSize: 8, fill: '#e6a840',
        });
        this._staticGroup.add(this._statusDot, this._statusQ, this._statusH, this._statusRpm);
    }

    // ══════════════════════════════════════════════════════════
    // 动态层
    // ══════════════════════════════════════════════════════════

    _rebuildDynamic() {
        this._dynamicGroup.destroyChildren();
        this._drawFluid();
        this._drawParticles();
        this._drawFloat();
        this._updateScaleIndicator();
    }

    // ── 管内流体（液柱，随流量变色）──────────────────────────
    _drawFluid() {
        const cx   = this._tubeX;
        const yBot = this._tubeBot, yTop = this._tubeTop;
        const rBot = this._rBot, rTop = this._rTop;
        const q    = this._flow;  // 0~1

        if (q < 0.005) return;

        const alpha = 0.12 + q * 0.20;
        const isWater = this.medium !== 'air';
        const fluidColor = isWater
            ? `rgba(40,140,220,${alpha})`
            : `rgba(200,230,255,${alpha * 0.4})`;

        // 整管液柱（从底到顶）
        this._dynamicGroup.add(new Konva.Line({
            points: [cx-rBot, yBot, cx-rTop, yTop, cx+rTop, yTop, cx+rBot, yBot],
            closed: true,
            fill: fluidColor,
        }));

        // 流动波纹（3 条水平透明波纹，向上位移）
        const phase = (Date.now() / 300) % 1;
        for (let i = 0; i < 3; i++) {
            const f   = ((i / 3) + phase) % 1;      // 0~1（高度比例）
            const yw  = yBot - f * this._tubeH;
            const rw  = rBot + f * (rTop - rBot);
            const wa  = Math.sin(f * Math.PI) * 0.18 * q;

            this._dynamicGroup.add(new Konva.Line({
                points: [cx - rw * 0.85, yw, cx + rw * 0.85, yw],
                stroke: isWater
                    ? `rgba(100,200,255,${wa})`
                    : `rgba(220,240,255,${wa * 0.5})`,
                strokeWidth: 1.5, lineCap: 'round',
            }));
        }
    }

    // ── 流体粒子（气泡 / 悬浮颗粒）──────────────────────────
    _drawParticles() {
        const cx   = this._tubeX;
        const rBot = this._rBot, rTop = this._rTop;
        const yBot = this._tubeBot, yTop = this._tubeTop;
        const isWater = this.medium !== 'air';

        this._particles.forEach(p => {
            // 该高度的管内径
            const f  = Math.max(0, Math.min(1, (yBot - p.y) / this._tubeH));
            const rw = rBot + f * (rTop - rBot);
            if (Math.abs(p.x - cx) > rw) return;  // 超出管壁则不绘

            const alpha = p.life * (isWater ? 0.55 : 0.30);
            this._dynamicGroup.add(new Konva.Circle({
                x: p.x, y: p.y,
                radius: p.r,
                fill: isWater
                    ? `rgba(180,230,255,${alpha})`
                    : `rgba(230,240,255,${alpha * 0.6})`,
                stroke: isWater
                    ? `rgba(100,200,255,${alpha * 0.5})`
                    : 'none',
                strokeWidth: 0.5,
            }));
        });
    }

    // ── 转子（浮子）──────────────────────────────────────────
    _drawFloat() {
        const cx  = this._tubeX;
        const fy  = this._floatY;                  // 转子质心 y
        const fh  = this._hFloat;
        const fr  = this._rFloat;
        const ang = this._spinAngle;
        const q   = this._flow;

        // 转子高度对应的管内径
        const hFrac = Math.max(0, Math.min(1, (this._tubeBot - fy) / this._tubeH));
        const rTube = this._rBot + hFrac * (this._rTop - this._rBot);

        // 转子轮廓（双锥形：上锥 + 腰 + 下锥）
        // 绕 cx,fy 旋转绘制（自旋）
        const g = new Konva.Group({ x: cx, y: fy, rotation: ang * 180 / Math.PI });

        // ── 下锥（导流锥）
        g.add(new Konva.Line({
            points: [
                -fr * 0.35, fh * 0.50,
                -fr,        0,
                -fr * 0.35, -fh * 0.08,
                fr  * 0.35, -fh * 0.08,
                fr,         0,
                fr  * 0.35, fh * 0.50,
            ],
            closed: true,
            fillLinearGradientStartPoint: { x: -fr, y: 0 },
            fillLinearGradientEndPoint:   { x:  fr, y: 0 },
            fillLinearGradientColorStops: [
                0, '#3a3a40', 0.3,'#909098', 0.5,'#c0c0c8', 0.7,'#909098', 1,'#3a3a40',
            ],
            stroke: '#505058', strokeWidth: 0.8,
        }));

        // ── 上锥（截流锥）
        g.add(new Konva.Line({
            points: [
                -fr * 0.35, -fh * 0.08,
                -fr,        0,
                -fr * 0.30, -fh * 0.50,
                fr  * 0.30, -fh * 0.50,
                fr,         0,
                fr  * 0.35, -fh * 0.08,
            ],
            closed: true,
            fillLinearGradientStartPoint: { x: -fr, y: 0 },
            fillLinearGradientEndPoint:   { x:  fr, y: 0 },
            fillLinearGradientColorStops: [
                0, '#484850', 0.3,'#a0a0a8', 0.5,'#d0d0d8', 0.7,'#a0a0a8', 1,'#484850',
            ],
            stroke: '#505058', strokeWidth: 0.8,
        }));

        // ── 腰部（最大截面，4 条斜槽）
        // 斜槽产生自旋力
        const slotN = 4;
        for (let i = 0; i < slotN; i++) {
            const a0  = (i / slotN) * Math.PI * 2;
            const a1  = a0 + Math.PI / (slotN * 1.4);
            const sr0 = fr * 0.75, sr1 = fr * 0.98;
            g.add(new Konva.Line({
                points: [
                    sr0 * Math.cos(a0), sr0 * Math.sin(a0) * 0.25,
                    sr1 * Math.cos(a1), sr1 * Math.sin(a1) * 0.25,
                ],
                stroke: '#303038', strokeWidth: 2.5, lineCap: 'round',
            }));
        }

        // 腰部高光圆环
        g.add(new Konva.Ellipse({
            x: 0, y: 0, radiusX: fr, radiusY: fr * 0.25,
            fill: 'none',
            stroke: 'rgba(220,220,230,0.40)', strokeWidth: 0.8,
        }));

        // 中心轴线（模拟旋转轴）
        g.add(new Konva.Line({
            points: [0, -fh * 0.55, 0, fh * 0.55],
            stroke: 'rgba(200,200,210,0.25)', strokeWidth: 1,
            lineCap: 'round', dash: [3, 3],
        }));

        this._dynamicGroup.add(g);

        // ── 自旋拖尾（速度越快，拖尾越明显）
        const spinNorm = Math.min(1, Math.abs(this._spinSpeed) / this._spinMax);
        if (spinNorm > 0.08) {
            for (let t = 1; t <= 3; t++) {
                const tAng = ang - (this._spinSpeed > 0 ? 1 : -1) * t * 0.18 * spinNorm;
                const ta   = spinNorm * (0.25 - t * 0.06);
                const tg   = new Konva.Group({ x: cx, y: fy, rotation: tAng * 180 / Math.PI, opacity: ta });
                tg.add(new Konva.Ellipse({
                    x: 0, y: 0, radiusX: fr * 0.90, radiusY: fr * 0.22,
                    fill: 'none',
                    stroke: 'rgba(180,220,255,0.60)', strokeWidth: 0.8,
                }));
                this._dynamicGroup.add(tg);
            }
        }

        // ── 环形气隙可视化（转子与管壁之间的通流面积）
        const gapW = rTube - fr;
        if (gapW > 1) {
            const gapAlpha = Math.min(0.35, q * 0.5);
            // 左侧气隙
            this._dynamicGroup.add(new Konva.Line({
                points: [cx - rTube, fy - fh*0.08, cx - fr - 1, fy - fh*0.08,
                         cx - fr - 1, fy + fh*0.06, cx - rTube, fy + fh*0.06],
                closed: true,
                fill: `rgba(80,180,255,${gapAlpha})`,
            }));
            // 右侧气隙
            this._dynamicGroup.add(new Konva.Line({
                points: [cx + fr + 1, fy - fh*0.08, cx + rTube, fy - fh*0.08,
                         cx + rTube, fy + fh*0.06, cx + fr + 1, fy + fh*0.06],
                closed: true,
                fill: `rgba(80,180,255,${gapAlpha})`,
            }));
            // 气隙宽度标注（流量 > 10% 时显示）
            if (q > 0.10) {
                this._dynamicGroup.add(new Konva.Line({
                    points: [cx + fr + 1, fy, cx + rTube - 1, fy],
                    stroke: 'rgba(80,200,255,0.55)', strokeWidth: 1,
                    dash: [2, 2],
                }));
                this._dynamicGroup.add(new Konva.Text({
                    x: cx + rTube + 2, y: fy - 5, width: 28,
                    text: 'A环',
                    fontSize: 6, fill: 'rgba(80,200,255,0.60)',
                }));
            }
        }

        // ── 力平衡箭头（低速时显示，直观说明原理）
        if (q > 0.05 && Math.abs(this._floatVel) < 8) {
            const arrowAlpha = Math.min(0.70, 0.30 + q * 0.5);

            // ↑ 流体曳力（蓝色）
            const fLen = Math.min(fh * 0.55, q * fh * 1.1);
            this._dynamicGroup.add(new Konva.Arrow({
                points: [cx - fr - 14, fy + fh*0.3, cx - fr - 14, fy + fh*0.3 - fLen],
                stroke: `rgba(80,160,255,${arrowAlpha})`,
                fill:   `rgba(80,160,255,${arrowAlpha})`,
                strokeWidth: 1.8, pointerLength: 5, pointerWidth: 4,
            }));
            this._dynamicGroup.add(new Konva.Text({
                x: cx - fr - 36, y: fy + fh*0.3 - fLen - 4,
                text: 'F↑', fontSize: 7, fill: `rgba(80,160,255,${arrowAlpha})`,
            }));

            // ↓ 重力（红色）
            const gLen = this._netGravity * fh * 0.65;
            this._dynamicGroup.add(new Konva.Arrow({
                points: [cx - fr - 14, fy - fh*0.3, cx - fr - 14, fy - fh*0.3 + gLen],
                stroke: `rgba(220,80,80,${arrowAlpha * 0.85})`,
                fill:   `rgba(220,80,80,${arrowAlpha * 0.85})`,
                strokeWidth: 1.8, pointerLength: 5, pointerWidth: 4,
            }));
            this._dynamicGroup.add(new Konva.Text({
                x: cx - fr - 30, y: fy - fh*0.3 - 12,
                text: 'G↓', fontSize: 7, fill: `rgba(220,80,80,${arrowAlpha * 0.85})`,
            }));
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
            this._scaleLine.points([cx - rw - wT - 2, fy, xR + 46, fy]);
        }
        if (this._scaleText) {
            this._scaleText.x(xR + 48);
            this._scaleText.y(fy - 5);
            this._scaleText.text(
                this._flow > 0.01
                    ? qReading.toFixed(this.Qmax < 0.1 ? 3 : this.Qmax < 1 ? 2 : 1)
                    : ''
            );
        }
    }

    // ══════════════════════════════════════════════════════════
    // 物理仿真
    // ══════════════════════════════════════════════════════════

    tick(dt) {
        this._tickSimulation(dt);
    
        this._refreshCache();
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

        // ── 重绘 ──
        this._rebuildDynamic();
        this._updateStatusBar();
        this._refreshCache();
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

    _updateStatusBar() {
        const q    = this._flow * this.Qmax;
        const hPct = Math.round(
            Math.max(0, Math.min(100, (this._tubeBot - this._floatY - this._hFloat*0.5) / this._tubeH * 100))
        );
        const rpm  = Math.round(Math.abs(this._spinSpeed) * 60 / (2 * Math.PI));
        const active = this._flow > 0.01;

        if (this._statusDot) {
            this._statusDot.fill(active ? '#29b6f6' : '#ef5350');
            this._statusDot.stroke(active ? '#0277bd' : '#c62828');
            this._statusDot.shadowColor(active ? '#29b6f6' : '#ef5350');
            this._statusDot.shadowBlur(active ? 6 : 2);
        }
        if (this._statusQ)   this._statusQ.text(`Q: ${q.toFixed(2)} ${this.unit}`);
        if (this._statusH)   this._statusH.text(`位置: ${hPct}%`);
        if (this._statusRpm) this._statusRpm.text(`自旋: ${rpm} rpm`);
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
        this.config = { ...this.config, ...cfg };
        this._refreshCache();
    }

    destroy() {
        this._particles = [];
        super.destroy?.();
    }
}