import { BaseComponent } from './BaseComponent.js';

/**
 * Reed 振动计（Reed Vibrometer / Frahm Frequency Meter）仿真组件
 *
 * ── 工作原理 ──────────────────────────────────────────────────
 *
 *  Reed 振动计（又称芦苇振动计、弗拉姆频率计）是一种纯机械式振动频率
 *  测量仪表，广泛用于旋转机械的转速/振动频率在线测量。
 *
 *  核心原理：共振法（Resonance Method）
 *  ─────────────────────────────────────
 *  仪表内部排列一组固有频率各不相同的金属薄片（Reed / Tongue），
 *  当底座固定在被测机械上，并受到频率为 f 的振动激励时，
 *  固有频率 fn ≈ f 的那根薄片发生共振，振幅显著增大，
 *  操作人员通过观察振幅最大的薄片，即可直读振动频率。
 *
 *  固有频率方程（悬臂梁）：
 *    fn = (β²L²/2π) · √(EI / ρAL⁴)
 *       = (1.875)² / (2π·L²) · √(EI/ρA)
 *  其中：
 *    L   = 薄片有效长度（mm）
 *    E   = 弹性模量（GPa，钢：210）
 *    I   = 截面惯性矩（mm⁴）
 *    ρ   = 密度（kg/m³，钢：7800）
 *    A   = 截面积（mm²）
 *  → 通过调整各薄片长度 L，使相邻薄片固有频率相差 0.5 Hz 或 1 Hz
 *
 *  共振响应（稳态幅值）：
 *    X(f) = F₀/k · 1 / √[(1-(f/fn)²)² + (2ζ·f/fn)²]
 *  其中 ζ 为阻尼比（钢薄片典型值 0.01~0.02，极低阻尼）
 *  → 当 f = fn 时，X_max = F₀/k · 1/(2ζ)，放大倍数达 25~50 倍
 *
 * ── 结构说明 ──────────────────────────────────────────────────
 *
 *  1. 底座（Base / Mounting Block）
 *     - 厚铸铁底板，带 4 个螺孔，直接固定在被测机械表面
 *     - 底面平整，保证振动传递无衰减
 *
 *  2. 薄片阵列（Reed Array / Tongue Array）
 *     - 典型 10~20 根钢制悬臂薄片，垂直固定在底座上
 *     - 各薄片长度递增（短 → 高频，长 → 低频）
 *     - 薄片末端有小配重球（Tip Mass），精确调谐固有频率
 *     - 薄片宽度 ≈ 3~5 mm，厚度 ≈ 0.3~0.8 mm
 *
 *  3. 频率刻度板（Frequency Scale Plate）
 *     - 薄片背后或侧面印刷的频率标注板
 *     - 每根薄片对应一个频率值（Hz 或 rpm）
 *
 *  4. 观察窗（Viewing Window）
 *     - 正面保护玻璃，防止油污灰尘进入
 *     - 开口观察缝（有些型号为开放式）
 *
 *  5. 压紧夹（Clamping Bar）
 *     - 固定薄片根部的夹紧条，保证根部为理想固支边界条件
 *
 * ── 仿真视觉 ──────────────────────────────────────────────────
 *
 *  正面视图，可见：
 *  ・薄片阵列（静止时垂直，共振时弯曲振动）
 *  ・频率标注（每片下方数字）
 *  ・共振薄片的动态弯曲形态（一阶模态：悬臂梁弯曲线）
 *  ・非共振薄片的微小随机扰动
 *  ・配重小球（薄片顶端）
 *  ・底部固定底座与螺孔
 *
 * ── 物理仿真 ──────────────────────────────────────────────────
 *
 *  每根薄片独立建模为有阻尼二阶系统：
 *    ẍᵢ + 2ζωₙᵢẋᵢ + ωₙᵢ²xᵢ = F·sin(ωt)
 *  稳态解（振幅）：
 *    Xᵢ = (F/ωₙᵢ²) / √[(1-rᵢ²)² + (2ζrᵢ)²]
 *  其中 rᵢ = f/fnᵢ（频率比）
 *
 *  视觉上：薄片末端位移 dᵢ(t) = Xᵢ · sin(ωt + φᵢ)
 *  弯曲形态按一阶悬臂梁模态 ψ(s) = 1 - cos(πs/2) 分布（s=0根部，s=1末端）
 *
 * ── 端口 ─────────────────────────────────────────────────────
 *  无电气端口（纯机械仪表）
 *
 * ── 可配置参数 ────────────────────────────────────────────────
 *  label        : 位号（默认 'RV'）
 *  freqMin      : 最小测量频率 Hz（默认 10）
 *  freqMax      : 最大测量频率 Hz（默认 55）
 *  freqStep     : 相邻薄片频率间隔 Hz（默认 2.5）
 *  dampingRatio : 薄片阻尼比 ζ（默认 0.015）
 *  vibFrequency : 输入振动频率 Hz（默认 0，静止）
 *  vibAmplitude : 输入振动幅值（相对，0~1，默认 0）
 *  showRPM      : 同时显示 rpm 刻度（默认 true）
 */
export class ReedVibrometer extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.width  = Math.max(200, config.width  || 260);
        this.height = Math.max(260, config.height || 340);

        this.type    = 'reed_vibrometer';
        this.special = 'none';
        this.cache   = 'fixed';

        this._initGroups();
        this._recalcGeometry();
        this._initParameters(config);
        this._buildReedArray();
        this._init();

        this.config = {
            label        : this.label,
            freqMin      : this.freqMin,
            freqMax      : this.freqMax,
            freqStep     : this.freqStep,
            dampingRatio : this.dampingRatio,
            vibFrequency : this.vibFrequency,
            vibAmplitude : this.vibAmplitude,
            showRPM      : this.showRPM,
        };
    }

    // ═══════════════════════════════════════════
    // 几何尺寸
    // ═══════════════════════════════════════════

    _recalcGeometry() {
        const W = this.width, H = this.height;

        // 外壳
        this._shell = {
            x: W * 0.03, y: H * 0.02,
            w: W * 0.94, h: H * 0.95,
            rx: W * 0.035,
        };

        // 铭牌区（顶部）
        this._nameplate = {
            x: W * 0.12, y: H * 0.035,
            w: W * 0.76, h: H * 0.052,
        };

        // 观察视窗区域（薄片显示区）
        this._window = {
            x: W * 0.08, y: H * 0.100,
            w: W * 0.84, h: H * 0.670,
        };

        // 底座区域（底部安装板）
        this._base = {
            x: W * 0.05, y: H * 0.820,
            w: W * 0.90, h: H * 0.120,
            rx: W * 0.02,
        };

        // 压紧夹条（薄片根部固定）
        this._clampBar = {
            x: W * 0.08, y: H * 0.735,
            w: W * 0.84, h: H * 0.028,
        };

        // 频率刻度板（薄片背景板）
        this._scalePlate = {
            x: W * 0.08, y: H * 0.100,
            w: W * 0.84, h: H * 0.640,
        };

        // 底座螺孔
        this._screws = [
            { x: W * 0.12, y: H * 0.880 },
            { x: W * 0.88, y: H * 0.880 },
        ];

        // 位号标签
        this._labelPos = { x: W * 0.50, y: H * 0.958 };
    }

    // ═══════════════════════════════════════════
    // 参数初始化
    // ═══════════════════════════════════════════

    _initParameters(config) {
        this.label        = config.label        || 'RV';
        this.freqMin      = config.freqMin      !== undefined ? config.freqMin      : 10;
        this.freqMax      = config.freqMax      !== undefined ? config.freqMax      : 55;
        this.freqStep     = config.freqStep     !== undefined ? config.freqStep     : 2.5;
        this.dampingRatio = config.dampingRatio !== undefined ? config.dampingRatio : 0.015;
        this.vibFrequency = config.vibFrequency !== undefined ? config.vibFrequency : 0;
        this.vibAmplitude = config.vibAmplitude !== undefined ? config.vibAmplitude : 0;
        this.showRPM      = config.showRPM      !== undefined ? config.showRPM      : true;

        // 内部物理状态
        this._time        = 0;
        this._reedStates  = [];   // 每根薄片状态（由 _buildReedArray 填充）
        this._lastReedKey = '';
    }

    // ═══════════════════════════════════════════
    // 薄片阵列构建
    // ═══════════════════════════════════════════

    _buildReedArray() {
        this._reedStates = [];

        const W = this.width, H = this.height;
        const win = this._window;

        // 计算薄片数量
        const count = Math.round((this.freqMax - this.freqMin) / this.freqStep) + 1;
        const n     = Math.max(3, Math.min(count, 30));

        // 薄片排列（左→右，频率从低→高）
        const margin  = win.w * 0.04;
        const spacing = (win.w - margin * 2) / (n - 1 || 1);

        // 薄片长度：频率越低，薄片越长（悬臂梁 fn ∝ 1/L²）
        const lenMin = win.h * 0.30;   // 最短（高频）
        const lenMax = win.h * 0.82;   // 最长（低频）

        // 薄片根部 Y 坐标（固定在夹紧条上）
        const rootY = this._clampBar.y + this._clampBar.h * 0.5;

        for (let i = 0; i < n; i++) {
            const freq = this.freqMin + i * this.freqStep;
            const t    = i / (n - 1 || 1);          // 0(低频) → 1(高频)

            // 长度按 1/freq 比例插值（悬臂梁理论：L ∝ 1/√fn，简化为线性）
            const lenFrac = 1 - t;                   // 低频=长，高频=短
            const reedLen = lenMin + (lenMax - lenMin) * lenFrac;

            // X 位置
            const cx = win.x + margin + spacing * i;

            // 薄片宽度（细条）
            const reedW = Math.max(2.5, W * 0.011);

            // 配重小球半径
            const ballR = Math.max(3.0, W * 0.018);

            this._reedStates.push({
                idx     : i,
                freq    : freq,
                cx      : cx,
                rootY   : rootY,
                tipY    : rootY - reedLen,    // 静止时顶端 Y
                reedLen : reedLen,
                reedW   : reedW,
                ballR   : ballR,
                // 物理状态
                disp    : 0,      // 末端横向位移（像素）
                vel     : 0,      // 末端速度（像素/s）
                phase   : 0,      // 初始相位（随机错开，模拟真实初始条件）
            });
        }

        // 随机初始相位
        this._reedStates.forEach(r => {
            r.phase = Math.random() * 2 * Math.PI;
        });
    }

    // ═══════════════════════════════════════════
    // 初始化
    // ═══════════════════════════════════════════

    _init() {
        this._drawStaticParts();
        this._bindInteraction();
        this._rebuildDynamic();
    }

    // ═══════════════════════════════════════════
    // 静态层
    // ═══════════════════════════════════════════

    _drawStaticParts() {
        this._drawShellBack();
        this._drawNameplate();
        this._drawScalePlate();
        this._drawFrequencyLabels();
        this._drawClampBar();
        this._drawMountBase();
        this._drawLabel();
    }

    // 外壳背景
    _drawShellBack() {
        const s = this._shell;

        // 主壳体
        this._staticGroup.add(new Konva.Rect({
            x: s.x, y: s.y, width: s.w, height: s.h,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint:   { x: s.w, y: s.h },
            fillLinearGradientColorStops: [
                0,   '#e2e2e6',
                0.3, '#d6d6da',
                1,   '#cacace',
            ],
            stroke: '#a0a4a8', strokeWidth: 1.8,
            cornerRadius: s.rx,
            shadowColor: '#000', shadowBlur: 5,
            shadowOffsetY: 2, shadowOpacity: 0.3,
        }));

        // 顶面阴影条
        this._staticGroup.add(new Konva.Rect({
            x: s.x + 2, y: s.y + 2,
            width: s.w - 4, height: s.h * 0.06,
            fill: 'rgba(0,0,0,0.04)',
            cornerRadius: [s.rx, s.rx, 0, 0],
        }));

        // 侧边立体阴影（右侧）
        this._staticGroup.add(new Konva.Rect({
            x: s.x + s.w - s.rx, y: s.y + s.rx,
            width: s.rx * 0.6, height: s.h - s.rx * 2,
            fill: 'rgba(0,0,0,0.08)',
            cornerRadius: [0, s.rx * 0.3, s.rx * 0.3, 0],
        }));
    }

    // 铭牌
    _drawNameplate() {
        const n = this._nameplate;
        const W = this.width;

        this._staticGroup.add(new Konva.Rect({
            x: n.x, y: n.y, width: n.w, height: n.h,
            fill: '#e0e0e4',
            stroke: '#a0a4a8', strokeWidth: 0.8,
            cornerRadius: 3,
        }));

        // 品牌 + 型号
        this._staticGroup.add(new Konva.Text({
            x: n.x, y: n.y + n.h * 0.10,
            width: n.w * 0.55, height: n.h * 0.80,
            text: 'REED VIBROMETER',
            fontSize: Math.max(6, W * 0.034),
            fontFamily: 'Arial',
            fontStyle: 'bold',
            fill: '#c8a040',
            align: 'center',
        }));

        // 量程标注
        this._staticGroup.add(new Konva.Text({
            x: n.x + n.w * 0.56, y: n.y + n.h * 0.12,
            width: n.w * 0.42, height: n.h * 0.78,
            text: `${this.freqMin}~${this.freqMax} Hz`,
            fontSize: Math.max(6, W * 0.032),
            fontFamily: 'Arial',
            fill: '#2a4058',
            align: 'center',
        }));

        // 型号标注线
        this._staticGroup.add(new Konva.Line({
            points: [n.x + n.w * 0.54, n.y + 3, n.x + n.w * 0.54, n.y + n.h - 3],
            stroke: '#909098', strokeWidth: 0.8,
        }));
    }

    // 刻度板（薄片背景）
    _drawScalePlate() {
        const sp = this._scalePlate;

        // 背景板（浅色，让薄片颜色对比鲜明）
        this._staticGroup.add(new Konva.Rect({
            x: sp.x, y: sp.y, width: sp.w, height: sp.h,
            fill: '#eef0f2',
            stroke: '#c0c4c8', strokeWidth: 1,
            cornerRadius: [3, 3, 0, 0],
        }));

        // 格线（水平辅助线）
        const lineCount = 8;
        for (let i = 1; i < lineCount; i++) {
            const ly = sp.y + sp.h * (i / lineCount);
            this._staticGroup.add(new Konva.Line({
                points: [sp.x + 2, ly, sp.x + sp.w - 2, ly],
                stroke: 'rgba(120,124,140,0.30)',
                strokeWidth: 0.5,
                dash: [4, 4],
                listening: false,
            }));
        }

        // 玻璃高光（左上角椭圆反光）
        this._staticGroup.add(new Konva.Ellipse({
            x: sp.x + sp.w * 0.22,
            y: sp.y + sp.h * 0.12,
            radiusX: sp.w * 0.16,
            radiusY: sp.h * 0.06,
            fill: 'rgba(200,210,230,0.15)',
            rotation: -10,
            listening: false,
        }));
    }

    // 频率刻度标注（每根薄片对应的频率数字）
    _drawFrequencyLabels() {
        const W   = this.width;
        const win = this._window;
        const sp  = this._scalePlate;

        this._reedStates.forEach((reed, i) => {
            const shouldLabel = this._reedStates.length <= 12 ||
                                (i % 2 === 0) ||
                                (i === this._reedStates.length - 1);

            if (!shouldLabel) return;

            const freq = reed.freq;
            const cx   = reed.cx;

            // 薄片底部频率数字（Hz）
            const labelY = sp.y + sp.h + 2;
            this._staticGroup.add(new Konva.Text({
                x: cx - 14, y: labelY,
                width: 28, height: 14,
                text: `${freq}`,
                fontSize: Math.max(5.5, W * 0.028),
                fontFamily: 'Arial',
                fill: '#304040',
                align: 'center',
            }));

            // rpm 刻度（下方，小字）
            if (this.showRPM) {
                const rpm = Math.round(freq * 60);
                this._staticGroup.add(new Konva.Text({
                    x: cx - 16, y: labelY + 12,
                    width: 32, height: 11,
                    text: `${rpm}`,
                    fontSize: Math.max(4.5, W * 0.023),
                    fontFamily: 'Arial',
                    fill: '#303848',
                    align: 'center',
                }));
            }

            // 刻度竖线
            this._staticGroup.add(new Konva.Line({
                points: [cx, sp.y + sp.h, cx, sp.y + sp.h + 3],
                stroke: '#303848', strokeWidth: 0.8,
            }));
        });

        // 单位标注
        const unitY = sp.y + sp.h + (this.showRPM ? 2 : 2);
        this._staticGroup.add(new Konva.Text({
            x: this._scalePlate.x, y: unitY,
            width: this._scalePlate.w * 0.10,
            text: 'Hz',
            fontSize: Math.max(5, W * 0.026),
            fontFamily: 'Arial',
            fill: '#303848',
        }));

        if (this.showRPM) {
            this._staticGroup.add(new Konva.Text({
                x: this._scalePlate.x, y: unitY + 12,
                width: this._scalePlate.w * 0.12,
                text: 'rpm',
                fontSize: Math.max(4, W * 0.022),
                fontFamily: 'Arial',
                fill: '#283038',
            }));
        }
    }

    // 压紧夹条（根部固定）
    _drawClampBar() {
        const c = this._clampBar;

        // 主夹条
        this._staticGroup.add(new Konva.Rect({
            x: c.x, y: c.y, width: c.w, height: c.h,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint:   { x: 0, y: c.h },
            fillLinearGradientColorStops: [
                0,   '#909090',
                0.3, '#c0c0c0',
                0.7, '#a0a0a0',
                1,   '#707070',
            ],
            stroke: '#808080', strokeWidth: 1,
            cornerRadius: 2,
        }));

        // 夹紧螺钉（均布）
        const screwCount = Math.min(6, Math.max(3, Math.floor(c.w / 30)));
        for (let i = 0; i < screwCount; i++) {
            const sx = c.x + c.w * (i + 0.5) / screwCount;
            const sy = c.y + c.h / 2;
            const sr = Math.max(2.5, this.width * 0.013);

            this._staticGroup.add(new Konva.Circle({
                x: sx, y: sy, radius: sr,
                fill: '#999', stroke: '#777', strokeWidth: 0.6,
            }));
            // 一字螺纹
            this._staticGroup.add(new Konva.Line({
                points: [sx - sr * 0.6, sy, sx + sr * 0.6, sy],
                stroke: '#666', strokeWidth: 0.8,
            }));
        }
    }

    // 安装底座
    _drawMountBase() {
        const b = this._base;

        this._staticGroup.add(new Konva.Rect({
            x: b.x, y: b.y, width: b.w, height: b.h,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint:   { x: 0, y: b.h },
            fillLinearGradientColorStops: [
                0,   '#b8b8c0',
                0.4, '#acacb4',
                1,   '#a0a0a8',
            ],
            stroke: '#909098', strokeWidth: 1.2,
            cornerRadius: b.rx,
        }));

        // 顶面高光
        this._staticGroup.add(new Konva.Rect({
            x: b.x + 2, y: b.y + 1,
            width: b.w - 4, height: b.h * 0.18,
            fill: 'rgba(0,0,0,0.04)',
            cornerRadius: [b.rx, b.rx, 0, 0],
        }));

        // 螺孔
        this._screws.forEach(({ x, y }) => {
            const r = this.width * 0.028;
            this._staticGroup.add(new Konva.Circle({
                x, y, radius: r,
                fill: '#c8c8cc',
                stroke: '#a8a8ac', strokeWidth: 0.8,
            }));
            // 内孔
            this._staticGroup.add(new Konva.Circle({
                x, y, radius: r * 0.42,
                fill: '#a8a8ac',
            }));
            // 十字槽
            [0, 90].forEach(deg => {
                const rad = deg * Math.PI / 180;
                this._staticGroup.add(new Konva.Line({
                    points: [
                        x + Math.cos(rad) * r * 0.35, y + Math.sin(rad) * r * 0.35,
                        x - Math.cos(rad) * r * 0.35, y - Math.sin(rad) * r * 0.35,
                    ],
                    stroke: '#606068', strokeWidth: 0.8,
                }));
            });
        });

        // 底部接触面齿纹
        const gCount = 10;
        for (let i = 1; i < gCount; i++) {
            const gx = b.x + b.w * (i / gCount);
            this._staticGroup.add(new Konva.Line({
                points: [gx, b.y + b.h * 0.72, gx, b.y + b.h - 2],
                stroke: '#888890', strokeWidth: 0.7,
            }));
        }

        // 型号铭牌条
        this._staticGroup.add(new Konva.Rect({
            x: b.x + b.w * 0.25, y: b.y + b.h * 0.18,
            width: b.w * 0.50, height: b.h * 0.35,
            fill: '#c8a840',
            cornerRadius: 1,
        }));
        this._staticGroup.add(new Konva.Text({
            x: b.x + b.w * 0.25, y: b.y + b.h * 0.22,
            width: b.w * 0.50, height: b.h * 0.28,
            text: `FRAHM  ${this.freqMin}~${this.freqMax}Hz`,
            fontSize: Math.max(5, this.width * 0.026),
            fontFamily: 'Arial',
            fontStyle: 'bold',
            fill: '#2a1800',
            align: 'center',
        }));
    }

    // 位号标签
    _drawLabel() {
        this._staticGroup.add(new Konva.Text({
            x: this._labelPos.x - 40,
            y: this._labelPos.y - 10,
            width: 80, height: 14,
            text: this.label,
            fontSize: Math.max(9, this.width * 0.046),
            fontFamily: 'Arial',
            fontStyle: 'bold',
            fill: '#c0a060',
            align: 'center',
        }));
    }

    // ═══════════════════════════════════════════
    // 动态层
    // ═══════════════════════════════════════════

    _rebuildDynamic() {
        this._dynamicGroup.destroyChildren();

        // 绘制所有薄片（从后到前，中间共振薄片最后绘制保证可见）
        // 先绘制非共振薄片
        const resonantIdx = this._findResonantIndex();
        this._reedStates.forEach((reed, i) => {
            if (i !== resonantIdx) this._drawReed(reed, false);
        });
        // 再绘制共振薄片（最亮，在最上层）
        if (resonantIdx >= 0) {
            this._drawReed(this._reedStates[resonantIdx], true);
        }

        // 刻度板前景（薄片遮挡效果边框）
        this._drawWindowOverlay();

        // 动态读数
        this._drawFreqReadout();

        this._saveDynamicRefs();
    }

    // 绘制单根薄片
    _drawReed(reed, isResonant) {
        const { cx, rootY, reedLen, reedW, ballR, disp } = reed;

        // 末端位移（像素）
        const d = disp;

        // 一阶悬臂梁弯曲形态：ψ(s) = 1 - cos(πs/2)
        // 将薄片分段绘制（折线逼近弯曲曲线）
        const segments = 10;
        const pts = [];

        for (let j = 0; j <= segments; j++) {
            const s   = j / segments;                        // 0(根部) → 1(末端)
            const psi = 1 - Math.cos(Math.PI * s / 2);     // 一阶模态形状
            const px  = cx + d * psi;
            const py  = rootY - reedLen * s;
            pts.push(px, py);
        }

        // 薄片颜色
        const baseColor   = isResonant ? '#f0c040' : '#506070';
        const glowColor   = isResonant ? 'rgba(255,200,50,0.35)' : 'rgba(120,140,180,0.12)';
        const strokeW     = isResonant ? reedW * 1.2 : reedW;

        // 共振薄片发光外圈
        this._dynamicGroup.add(new Konva.Line({
            points: isResonant && Math.abs(d) > 0.5 ? pts : [0,0,0,0],
            stroke: glowColor,
            strokeWidth: strokeW * 3.5,
            lineCap: 'round', lineJoin: 'round',
            listening: false,
            visible: isResonant && Math.abs(d) > 0.5,
            name: 'reed_glow',
        }));

        // 薄片主体
        this._dynamicGroup.add(new Konva.Line({
            points: pts,
            stroke: baseColor,
            strokeWidth: strokeW,
            lineCap: 'round', lineJoin: 'round',
            listening: false,
            name: 'reed_line',
        }));

        // 薄片高光线（左侧）
        this._dynamicGroup.add(new Konva.Line({
            points: (() => {
                if (segments < 4) return [0,0,0,0];
                const hlPts = [];
                for (let j = 0; j <= segments; j++) {
                    const s   = j / segments;
                    const psi = 1 - Math.cos(Math.PI * s / 2);
                    const px  = cx + d * psi - strokeW * 0.25;
                    const py  = rootY - reedLen * s;
                    hlPts.push(px, py);
                }
                return hlPts;
            })(),
            stroke: isResonant ? 'rgba(255,240,180,0.50)' : 'rgba(255,255,255,0.40)',
            strokeWidth: strokeW * 0.30,
            lineCap: 'round', lineJoin: 'round',
            listening: false,
            name: 'reed_highlight',
        }));

        // 末端配重球
        const tipX = cx + d;
        const tipY = rootY - reedLen;

        // 配重球阴影
        this._dynamicGroup.add(new Konva.Circle({
            x: tipX + 1, y: tipY + 1,
            radius: ballR,
            fill: 'rgba(0,0,0,0.30)',
            listening: false,
        }));

        // 配重球主体
        this._dynamicGroup.add(new Konva.Circle({
            x: tipX, y: tipY,
            radius: ballR,
            fillRadialGradientStartPoint:  { x: -ballR * 0.3, y: -ballR * 0.3 },
            fillRadialGradientEndPoint:    { x: 0, y: 0 },
            fillRadialGradientStartRadius: 0,
            fillRadialGradientEndRadius:   ballR,
            fillRadialGradientColorStops: isResonant
                ? [0, '#fff8d0', 0.4, '#f0c040', 0.8, '#c09020', 1, '#806010']
                : [0, '#d0d8e8', 0.4, '#9098b0', 0.8, '#606878', 1, '#404858'],
            stroke: isResonant ? '#c09020' : '#484858',
            strokeWidth: 0.6,
            listening: false,
            name: 'reed_ball',
        }));
    }

    // 视窗叠加（边框遮罩，强化窗口感）
    _drawWindowOverlay() {
        const win = this._window;
        // 窗口边框
        this._dynamicGroup.add(new Konva.Rect({
            x: win.x, y: win.y,
            width: win.w, height: win.h,
            fill: 'transparent',
            stroke: '#9098a0',
            strokeWidth: 1.2,
            cornerRadius: [3, 3, 0, 0],
            listening: false,
        }));
    }

    // 频率读数显示
    _drawFreqReadout() {
        const W = this.width, H = this.height;
        const resonant = this._findResonantIndex();

        // 读数窗（底座上方）
        const rx = W * 0.30, ry = H * 0.775;
        const rw = W * 0.40, rh = H * 0.042;

        this._dynamicGroup.add(new Konva.Rect({
            x: rx, y: ry, width: rw, height: rh,
            fill: '#e8eaec',
            stroke: '#b0b4b8', strokeWidth: 0.8,
            cornerRadius: 3,
        }));

        let readText = '---';
        let readColor = '#203818';

        if (this.vibAmplitude > 0.05 && resonant >= 0) {
            const rf = this._reedStates[resonant].freq;
            readText = `${rf.toFixed(1)} Hz`;
            readColor = '#207010';
        }

        this._dynamicGroup.add(new Konva.Text({
            x: rx + 2, y: ry + rh * 0.10,
            width: rw - 4, height: rh * 0.82,
            text: readText,
            fontSize: Math.max(8, W * 0.050),
            fontFamily: 'Courier New',
            fontStyle: 'bold',
            fill: readColor,
            align: 'center',
            name: 'reed_readout',
        }));

        // rpm 读数（有效时）
        if (this.vibAmplitude > 0.05 && resonant >= 0) {
            const rf  = this._reedStates[resonant].freq;
            const rpm = Math.round(rf * 60);
            this._dynamicGroup.add(new Konva.Text({
                x: rx, y: ry + rh + 1,
                width: rw,
                text: `${rpm} rpm`,
                fontSize: Math.max(5.5, W * 0.028),
                fontFamily: 'Arial',
                fill: '#203818',
                align: 'center',
                name: 'reed_readout_rpm',
            }));
        }
    }

    // ═══════════════════════════════════════════
    // 交互绑定
    // ═══════════════════════════════════════════

    _bindInteraction() {
        const hitArea = new Konva.Rect({
            x: this._shell.x, y: this._shell.y,
            width: this._shell.w, height: this._shell.h,
            fill: 'transparent',
        });

        hitArea.on('click tap', () => {
            // 点击循环切换演示频率
            const steps = [0, ...this._reedStates.map(r => r.freq)];
            let idx = steps.findIndex(v => Math.abs(v - this.vibFrequency) < 0.1);
            idx = (idx + 1) % steps.length;
            this.vibFrequency = steps[idx];
            this.vibAmplitude = idx === 0 ? 0 : 0.8;
            // 重置所有薄片速度，避免瞬变
            this._reedStates.forEach(r => { r.disp = 0; r.vel = 0; });
        });

        this._interactGroup.add(hitArea);
    }

    // ═══════════════════════════════════════════
    // 物理计算
    // ═══════════════════════════════════════════

    /**
     * 在 _rebuildDynamic 后缓存所有动态图形引用
     */
    _saveDynamicRefs() {
        this._reedLines      = this._dynamicGroup.find('.reed_line');
        this._reedGlows      = this._dynamicGroup.find('.reed_glow');
        this._reedHighlights = this._dynamicGroup.find('.reed_highlight');
        this._reedBalls      = this._dynamicGroup.find('.reed_ball');
        this._reedReadout    = this._dynamicGroup.findOne('.reed_readout');
        this._reedReadoutRPM = this._dynamicGroup.findOne('.reed_readout_rpm');
    }

    /**
     * 每帧原地更新薄片位置（替代 _rebuildDynamic 全量重建）
     */
    _updateDynamic() {
        const resonantIdx = this._findResonantIndex();
        const rootY = this._clampBar.y + this._clampBar.h * 0.5;

        this._reedStates.forEach((reed, i) => {
            const d = reed.disp;
            const isResonant = (i === resonantIdx);
            const cx = reed.cx;
            const reedLen = reed.reedLen;
            const segments = 10;

            // 主线条
            const linePts = [];
            for (let j = 0; j <= segments; j++) {
                const s   = j / segments;
                const psi = 1 - Math.cos(Math.PI * s / 2);
                const px  = cx + d * psi;
                const py  = rootY - reedLen * s;
                linePts.push(px, py);
            }

            const line = this._reedLines[i];
            if (line) {
                line.points(linePts);
                line.stroke(isResonant ? '#f0c040' : '#506070');
                line.strokeWidth(isResonant ? reed.reedW * 1.2 : reed.reedW);
            }

            // 共振发光层
            const glow = this._reedGlows[i];
            if (glow) {
                if (isResonant && Math.abs(d) > 0.5) {
                    glow.points(linePts);
                    glow.visible(true);
                } else {
                    glow.visible(false);
                }
            }

            // 高光线
            const hl = this._reedHighlights[i];
            if (hl) {
                const hlPts = [];
                for (let j = 0; j <= segments; j++) {
                    const s   = j / segments;
                    const psi = 1 - Math.cos(Math.PI * s / 2);
                    const px  = cx + d * psi - line.strokeWidth() * 0.25;
                    const py  = rootY - reedLen * s;
                    hlPts.push(px, py);
                }
                hl.points(hlPts);
            }

            // 配重球
            const ball = this._reedBalls[i];
            if (ball) {
                const tipX = cx + d;
                const tipY = rootY - reedLen;
                ball.x(tipX);
                ball.y(tipY);
            }
        });

        // 读数
        if (this._reedReadout) {
            if (this.vibAmplitude > 0.05 && resonantIdx >= 0) {
                const rf = this._reedStates[resonantIdx].freq;
                this._reedReadout.text(`${rf.toFixed(1)} Hz`);
                this._reedReadout.fill('#207010');
                if (this._reedReadoutRPM) {
                    this._reedReadoutRPM.text(`${Math.round(rf * 60)} rpm`);
                }
            } else {
                this._reedReadout.text('---');
                this._reedReadout.fill('#203818');
            }
        }
    }

    /**
     * 找出当前共振薄片索引（最接近激励频率的那根）
     */
    _findResonantIndex() {
        if (this.vibAmplitude <= 0.01 || this.vibFrequency <= 0) return -1;
        let best = -1, bestDelta = Infinity;
        this._reedStates.forEach((r, i) => {
            const delta = Math.abs(r.freq - this.vibFrequency);
            if (delta < bestDelta) { bestDelta = delta; best = i; }
        });
        return best;
    }

    /**
     * 计算单根薄片的稳态振幅（像素）
     * 基于频率响应函数，乘以可视化比例因子
     */
    _calcReedAmplitude(reedFreq) {
        if (this.vibAmplitude <= 0.01 || this.vibFrequency <= 0) return 0;

        const r   = this.vibFrequency / reedFreq;   // 频率比
        const z   = this.dampingRatio;
        const r2  = r * r;
        const denom = Math.sqrt(Math.pow(1 - r2, 2) + Math.pow(2 * z * r, 2));
        const mag = 1 / denom;      // 频响函数幅值

        // 归一化：共振峰幅值 = 1/(2ζ)，将其映射到可视最大位移（像素）
        const peakMag     = 1 / (2 * z);
        const maxPixelDisp = this.width * 0.12;      // 最大视觉位移
        return (mag / peakMag) * maxPixelDisp * this.vibAmplitude;
    }

    // ═══════════════════════════════════════════
    // tick（物理循环）
    // ═══════════════════════════════════════════

    tick(dt) {
        this._time += dt;
        const wf = 2 * Math.PI * (this.vibFrequency || 0);

        this._reedStates.forEach(reed => {
            const targetAmp = this._calcReedAmplitude(reed.freq);
            const wn   = 2 * Math.PI * reed.freq;
            const z    = this.dampingRatio;

            if (this.vibAmplitude <= 0.01 || this.vibFrequency <= 0) {
                // 无激励：自由衰减
                const acc = -2 * z * wn * reed.vel - wn * wn * reed.disp;
                reed.vel  += acc * dt;
                reed.disp += reed.vel * dt;
                // 快速阻尼（视觉效果）
                reed.disp *= Math.pow(0.98, dt * 60);
                reed.vel  *= Math.pow(0.98, dt * 60);
            } else {
                // 有激励：稳态正弦响应
                // 使用解析稳态解直接驱动（避免积分不稳定）
                const r      = this.vibFrequency / reed.freq;
                const r2     = r * r;
                const denom2 = Math.pow(1 - r2, 2) + Math.pow(2 * z * r, 2);
                // 相位角 φ
                const phi = Math.atan2(2 * z * r, 1 - r2);
                // 稳态位移
                const steadyDisp = targetAmp * Math.sin(wf * this._time + reed.phase - phi);

                // 混合：从当前状态平滑过渡到稳态（软跟踪）
                const alpha = Math.min(1, dt * 8);   // 跟踪速度
                reed.disp = reed.disp * (1 - alpha) + steadyDisp * alpha;
            }

            // 限幅
            const maxD = this.width * 0.14;
            reed.disp = Math.max(-maxD, Math.min(maxD, reed.disp));
        });

        this._updateDynamic();
        this._refreshIfDirty();
    }

    // ═══════════════════════════════════════════
    // 公开 API
    // ═══════════════════════════════════════════

    /** 设置激励频率和幅值 */
    setVibration(frequencyHz, amplitude) {
        this.vibFrequency = frequencyHz;
        if (amplitude !== undefined) this.vibAmplitude = amplitude;
    }

    /** 获取当前读数频率（Hz） */
    getMeasuredFreq() {
        const idx = this._findResonantIndex();
        return idx >= 0 ? this._reedStates[idx].freq : null;
    }

    /** 获取当前读数 rpm */
    getMeasuredRPM() {
        const f = this.getMeasuredFreq();
        return f !== null ? Math.round(f * 60) : null;
    }

    update(state) {
        if (typeof state === 'object' && state !== null) {
            if (state.frequency !== undefined) this.vibFrequency = state.frequency;
            if (state.amplitude !== undefined) this.vibAmplitude = state.amplitude;
        }
        this._refreshCache();
    }

    getConfigFields() {
        return [
            { label: '位号/名称',         key: 'label',        type: 'text'   },
            { label: '最小频率 (Hz)',      key: 'freqMin',      type: 'number' },
            { label: '最大频率 (Hz)',      key: 'freqMax',      type: 'number' },
            { label: '薄片频率间隔 (Hz)', key: 'freqStep',     type: 'number' },
            { label: '阻尼比 ζ',          key: 'dampingRatio', type: 'number' },
            { label: '输入频率 (Hz)',      key: 'vibFrequency', type: 'number' },
            { label: '输入幅值 (0~1)',     key: 'vibAmplitude', type: 'number' },
            { label: '显示rpm刻度 (1/0)', key: 'showRPM',      type: 'number' },
        ];
    }

    onConfigUpdate(cfg) {
        if (cfg.label        !== undefined) this.label        = cfg.label;
        if (cfg.dampingRatio !== undefined) this.dampingRatio = parseFloat(cfg.dampingRatio);
        if (cfg.vibFrequency !== undefined) this.vibFrequency = parseFloat(cfg.vibFrequency);
        if (cfg.vibAmplitude !== undefined) this.vibAmplitude = parseFloat(cfg.vibAmplitude);
        if (cfg.showRPM      !== undefined) this.showRPM      = !!parseInt(cfg.showRPM);

        // 频率范围变化需重建薄片阵列
        const needRebuildArray =
            (cfg.freqMin  !== undefined && parseFloat(cfg.freqMin)  !== this.freqMin)  ||
            (cfg.freqMax  !== undefined && parseFloat(cfg.freqMax)  !== this.freqMax)  ||
            (cfg.freqStep !== undefined && parseFloat(cfg.freqStep) !== this.freqStep);

        if (cfg.freqMin  !== undefined) this.freqMin  = parseFloat(cfg.freqMin);
        if (cfg.freqMax  !== undefined) this.freqMax  = parseFloat(cfg.freqMax);
        if (cfg.freqStep !== undefined) this.freqStep = parseFloat(cfg.freqStep);

        if (needRebuildArray) {
            this._buildReedArray();
            this._staticGroup.destroyChildren();
            this._drawStaticParts();
        }

        this.config = { ...this.config, ...cfg };
        this._recalcGeometry();
        this._rebuildDynamic();
        this._refreshCache();
    }

    destroy() {
        super.destroy?.();
    }
}
