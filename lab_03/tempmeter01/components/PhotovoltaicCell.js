import { BaseComponent } from './BaseComponent.js';

/**
 * 光电池仿真组件
 * （Photovoltaic Cell / Solar Cell）
 *
 * ── 结构说明 ──────────────────────────────────────────────────
 *
 *  光电池（太阳能电池）是利用光生伏特效应（Photovoltaic Effect）
 *  将光能直接转换为电能的半导体器件，由以下部分组成：
 *
 *  1. 上电极栅线（Front Electrode Grid）：
 *     银浆印刷的细栅线（Finger）+ 主栅（Bus Bar），
 *     覆盖受光面积约 5~8%，兼顾导电与透光
 *  2. 减反射膜（Anti-Reflection Coating, ARC）：
 *     氮化硅（Si₃N₄）薄膜，呈深蓝/紫蓝色，
 *     将硅表面反射率从 35% 降至 < 3%，同时钝化表面缺陷
 *  3. N 型发射极层（N-type Emitter）：磷扩散形成，厚约 0.3 μm
 *  4. P-N 结（P-N Junction）：内建电场区域，分离光生载流子
 *  5. P 型基底（P-type Base）：硼掺杂单晶/多晶硅，厚约 180 μm
 *  6. 背面电场（Back Surface Field, BSF）：P⁺层，反射少子，减少复合
 *  7. 背电极（Back Electrode）：铝浆全面积印刷，导出空穴电流
 *  8. 引脚（Lead）：正极（+）从背电极引出，负极（−）从栅线引出
 *
 * ── 工作原理（光生伏特效应）──────────────────────────────────
 *
 *  ① 光子入射 → 被硅吸收 → 激发电子-空穴对（EHP）
 *  ② P-N 结内建电场（约 0.6 V）将电子扫向 N 区，空穴扫向 P 区
 *  ③ N 区电子经栅线→外电路→背电极 → 形成电流（光生电流 Iph）
 *  ④ 开路电压：Voc ≈ 0.55 ~ 0.65 V（单晶硅，STC 下）
 *  ⑤ 短路电流：Isc ∝ 照度（Ev）
 *
 *  等效电路（单二极管模型）：
 *    I = Iph − I₀ × [exp(q(V+I·Rs)/(n·kT)) − 1] − (V+I·Rs)/Rsh
 *    其中 Iph ≈ Isc = Isc_STC × (Ev / 1000)
 *         Voc ≈ Voc_STC + (n·kT/q) × ln(Ev / 1000)
 *         FF（填充因子）≈ 0.75~0.82
 *         Pmax = Isc × Voc × FF
 *
 * ── 仿真动画 ──────────────────────────────────────────────────
 *
 *  拖动"光照强度"滑块（或调用 setIlluminance()）：
 *  1. 减反射膜颜色随照度从深蓝（低照）→ 亮紫蓝（高照）
 *  2. 光子粒子从顶部射入，穿透 ARC → P-N 结附近激发 EHP
 *  3. 电子（蓝色点）向栅线运动，空穴（橙色点）向背电极运动
 *  4. 电流箭头沿外电路流动（+极 → 负载 → −极，照度 > 阈值时）
 *  5. 电气读数：Isc、Voc、Pmax 随照度实时更新
 *  6. 状态指示灯：暗态灰→弱光蓝→中光青→强光金黄
 *
 * ── 几何说明 ──────────────────────────────────────────────────
 *
 *  正视图 + 剖面叠加：
 *    上半部：电池正面（减反射膜 + 栅线图案），从上方受光
 *    下半部：侧剖面示意（N层/P层/背电极分层色块），展示内部结构
 *    左右两侧：引脚从封装边缘引出
 *
 * ── 端口 ─────────────────────────────────────────────────────
 *  terminal_p — 正极（+），背电极侧，左引脚底部
 *  terminal_n — 负极（−），栅线侧，右引脚底部
 */
export class PhotovoltaicCell extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.width  = Math.max(160, config.width  || 200);
        this.height = Math.max(180, config.height || 230);

        this.type    = 'photovoltaic_cell';
        this.special = 'none';
        this.cache   = 'fixed';

        // ── 器件参数（STC：AM1.5，1000 W/m²，25°C）──
        this.label      = config.label    || 'BT';      // 位号
        this.material   = config.material || 'c-Si';    // 材料（c-Si / poly-Si / a-Si）
        this.isc_stc    = config.iscStc   || 8.0;       // A，STC 短路电流（单片约 8A）
        this.voc_stc    = config.vocStc   || 0.62;      // V，STC 开路电压
        this.ff         = config.ff       || 0.78;      // 填充因子（Fill Factor）
        this.area       = config.area     || 156;       // mm，电池片边长（156×156 mm 标准片）

        // ── 光照状态 ──
        this._illuminance = config.initEv || 0;         // W/m²，辐照度（仿真单位）
        this._evMax       = config.evMax  || 1000;      // W/m²，标准测试条件（STC）
        this._isc         = 0;                          // A，当前短路电流
        this._voc         = 0;                          // V，当前开路电压
        this._pmax        = 0;                          // W，当前最大功率

        // ── 动画状态 ──
        this._animating   = false;
        this._animT       = 0;
        this._animDur     = config.animDur || 0.6;      // s
        this._evFrom      = 0;
        this._evTo        = 0;

        // 光子粒子（入射光子，{ x, y, vy, alpha, color }）
        this._photons     = [];
        this._photonTimer = 0;

        // 载流子粒子（电子蓝色/空穴橙色，{ x, y, vx, vy, alpha, type }）
        this._carriers    = [];
        this._carrierTimer= 0;

        // 操作计数
        this.opsCount     = config.initOps || 0;


        // ── 几何尺寸（相对 width/height）──
        const W = this.width, H = this.height;

        // ── 电池正面区域（受光面，上半部分）──
        this._faceX = W * 0.08;
        this._faceY = H * 0.06;
        this._faceW = W * 0.84;
        this._faceH = H * 0.48;

        // ── 剖面区域（侧剖示意，下半部分）──
        this._secX  = this._faceX;
        this._secY  = this._faceY + this._faceH;
        this._secW  = this._faceW;
        this._secH  = H * 0.28;

        // 剖面各层高度比例（从上到下）
        this._lyN   = this._secH * 0.10;  // N型发射极（薄）
        this._lyJ   = this._secH * 0.06;  // P-N结
        this._lyP   = this._secH * 0.55;  // P型基底（厚）
        this._lyBSF = this._secH * 0.10;  // 背面电场
        this._lyAl  = this._secH * 0.19;  // 背电极铝层

        // P-N 结 y 坐标（用于载流子分离动画）
        this._junctionY = this._secY + this._lyN + this._lyJ / 2;

        // ── 引脚 ──
        this._pinPX  = W * 0.22;           // 正极（+），左侧
        this._pinNX  = W * 0.78;           // 负极（−），右侧
        this._pinTopY= this._secY + this._secH;
        this._pinBotY= H * 0.97;
        this._pinW   = W * 0.038;

        // ── 栅线布局（正面，4根细栅 + 2根主栅）──
        this._gridLines   = 7;             // 细栅数
        this._busBars     = 2;             // 主栅数

        // 初始化电气量
        this._updateElectrical(this._illuminance);

        this._init();

        // 端口
        this.addPort(this._pinPX, this._pinBotY + 2, 'terminal_p', 'wire', '+');
        this.addPort(this._pinNX, this._pinBotY + 2, 'terminal_n', 'wire', '−');
    }

    // ═══════════════════════════════════════════
    _init() {
        this._drawFaceBackground();     // 静态：正面 ARC 底色 + 外框
        this._drawGridLines();          // 静态：栅线图案（覆盖在 ARC 上）
        this._drawCrossSection();       // 静态：剖面各层色块 + 标注
        this._drawPins();               // 静态：引脚
        this._drawLightLayer();         // 动态层①：光子 + ARC 光晕
        this._drawCarrierLayer();       // 动态层②：载流子运动 + 电流箭头
        this._drawFaceFront();          // 静态前景：正面边框 + 高光（覆盖动态层）
        this._drawLabel();
        this._drawStatusIndicator();
        
    }

    // ── 正面背景（减反射膜底色）──────────────────────────────
    _drawFaceBackground() {
        const x = this._faceX, y = this._faceY;
        const w = this._faceW, h = this._faceH;

        // 外框阴影
        this.group.add(new Konva.Rect({
            x: x + 2, y: y + 3, width: w, height: h,
            fill: 'rgba(0,0,0,0.35)', cornerRadius: 3,
        }));
        // ARC 底色（深蓝/紫蓝，氮化硅减反射膜特征色）
        // 暗态时为深墨蓝，受光后逐渐变亮显现蓝紫色
        this._arcRect = new Konva.Rect({
            x, y, width: w, height: h,
            fill: '#1a2a48',
            stroke: '#2a3a58', strokeWidth: 1.2,
            cornerRadius: 2,
        });
        this.group.add(this._arcRect);

        // 多晶硅晶粒纹理（浅色不规则多边形，模拟晶界）
        if (this.material !== 'c-Si') {
            this._drawGrainTexture(x, y, w, h);
        }
    }

    // 多晶硅晶粒纹理（随机多边形网格）
    _drawGrainTexture(x, y, w, h) {
        const seed = [0.12,0.38,0.61,0.27,0.85,0.44,0.73,0.19,0.56,0.90,
                      0.33,0.67,0.08,0.49,0.78,0.22,0.95,0.41,0.64,0.82];
        const cols = 5, rows = 4;
        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                const idx  = (r * cols + c) % seed.length;
                const cx   = x + (c + 0.5 + (seed[idx] - 0.5) * 0.4) * w / cols;
                const cy   = y + (r + 0.5 + (seed[(idx + 3) % seed.length] - 0.5) * 0.4) * h / rows;
                const rx   = w / cols * (0.38 + seed[(idx + 1) % seed.length] * 0.18);
                const ry   = h / rows * (0.38 + seed[(idx + 2) % seed.length] * 0.18);
                this.group.add(new Konva.Ellipse({
                    x: cx, y: cy, radiusX: rx, radiusY: ry,
                    fill: 'transparent',
                    stroke: 'rgba(80,100,160,0.18)', strokeWidth: 0.6,
                }));
            }
        }
    }

    // ── 栅线图案（银浆印刷，静态）────────────────────────────
    _drawGridLines() {
        const x = this._faceX, y = this._faceY;
        const w = this._faceW, h = this._faceH;

        // 细栅线（横向，均匀分布）
        const gridGap = h / (this._gridLines + 1);
        for (let i = 1; i <= this._gridLines; i++) {
            const gy = y + gridGap * i;
            this.group.add(new Konva.Line({
                points: [x + 4, gy, x + w - 4, gy],
                stroke: 'rgba(210,200,180,0.55)', strokeWidth: 0.8, lineCap: 'round',
            }));
        }

        // 主栅（Bus Bar，纵向，2根）
        const bbGap = w / (this._busBars + 1);
        for (let i = 1; i <= this._busBars; i++) {
            const bx = x + bbGap * i;
            this.group.add(new Konva.Line({
                points: [bx, y + 3, bx, y + h - 3],
                stroke: 'rgba(200,190,160,0.70)', strokeWidth: 2.2, lineCap: 'round',
            }));
            // 主栅高光
            this.group.add(new Konva.Line({
                points: [bx - 0.5, y + 5, bx - 0.5, y + h - 5],
                stroke: 'rgba(255,255,240,0.18)', strokeWidth: 0.8, lineCap: 'round',
            }));
        }
    }

    // ── 剖面各层色块（静态）──────────────────────────────────
    _drawCrossSection() {
        const x  = this._secX, w = this._secW;
        let   cy = this._secY;

        // ─ N 型发射极（浅蓝灰）─
        this.group.add(new Konva.Rect({
            x, y: cy, width: w, height: this._lyN,
            fill: '#3a4a68', stroke: '#4a5a78', strokeWidth: 0.5,
        }));
        this._drawLayerLabel(x, cy, this._lyN, 'N⁺', '#8aaccc');
        cy += this._lyN;

        // ─ P-N 结（渐变过渡带，内建电场区）─
        this.group.add(new Konva.Rect({
            x, y: cy, width: w, height: this._lyJ,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint:   { x: 0, y: this._lyJ },
            fillLinearGradientColorStops: [
                0, '#3a4a68',
                1, '#5a3a60',
            ],
            stroke: 'none',
        }));
        // 内建电场箭头（向右，表示 N→P 方向）
        const jMidY = cy + this._lyJ / 2;
        for (let i = 0; i < 4; i++) {
            const ax = x + w * (0.15 + i * 0.22);
            this.group.add(new Konva.Line({
                points: [ax - 8, jMidY, ax + 8, jMidY],
                stroke: 'rgba(180,160,220,0.55)', strokeWidth: 1, lineCap: 'round',
            }));
            this.group.add(new Konva.Line({
                points: [ax + 4, jMidY - 3, ax + 8, jMidY, ax + 4, jMidY + 3],
                stroke: 'rgba(180,160,220,0.55)', strokeWidth: 1, lineCap: 'round', lineJoin: 'round',
            }));
        }
        this._drawLayerLabel(x, cy, this._lyJ, 'P-N结', '#c0a0d8');
        cy += this._lyJ;

        // ─ P 型基底（深紫蓝，最厚）─
        this.group.add(new Konva.Rect({
            x, y: cy, width: w, height: this._lyP,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint:   { x: 0, y: this._lyP },
            fillLinearGradientColorStops: [
                0,   '#5a3a60',
                0.5, '#4a2e52',
                1,   '#3e2646',
            ],
            stroke: '#4a3050', strokeWidth: 0.5,
        }));
        this._drawLayerLabel(x, cy, this._lyP, 'P-Si 基底', '#b090c8');
        cy += this._lyP;

        // ─ 背面电场 BSF（P⁺，深紫）─
        this.group.add(new Konva.Rect({
            x, y: cy, width: w, height: this._lyBSF,
            fill: '#2e1e38', stroke: '#3e2848', strokeWidth: 0.5,
        }));
        this._drawLayerLabel(x, cy, this._lyBSF, 'BSF', '#907898');
        cy += this._lyBSF;

        // ─ 铝背电极（金属银灰）─
        this.group.add(new Konva.Rect({
            x, y: cy, width: w, height: this._lyAl,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint:   { x: w, y: 0 },
            fillLinearGradientColorStops: [
                0,   '#5a5a62',
                0.3, '#9090a0',
                0.6, '#a8a8b8',
                0.8, '#8a8a98',
                1,   '#5a5a62',
            ],
            stroke: '#4a4a52', strokeWidth: 0.8,
        }));
        this._drawLayerLabel(x, cy, this._lyAl, 'Al 背电极', '#b8b8c8');

        // 剖面整体外框
        this.group.add(new Konva.Rect({
            x, y: this._secY, width: w, height: this._secH,
            fill: 'transparent', stroke: '#3a3a48', strokeWidth: 1,
        }));
    }

    // 辅助：在剖面层右侧绘制标注文字
    _drawLayerLabel(x, y, h, text, color) {
        if (h < 8) return;
        this.group.add(new Konva.Text({
            x: x + this._secW + 4,
            y: y + h / 2 - 5,
            text, fontSize: 7, fill: color,
        }));
    }

    // ── 引脚（正负两根）──────────────────────────────────────
    _drawPins() {
        const topY = this._pinTopY, botY = this._pinBotY;
        const pW   = this._pinW;

        const pins = [
            { x: this._pinPX, label: '+', col: '#ef9a9a' },
            { x: this._pinNX, label: '−', col: '#90caf9' },
        ];
        pins.forEach(({ x: px, label, col }) => {
            // 引脚主体（镀锡铜，银灰渐变）
            this.group.add(new Konva.Rect({
                x: px - pW / 2, y: topY,
                width: pW, height: botY - topY,
                fillLinearGradientStartPoint: { x: 0, y: 0 },
                fillLinearGradientEndPoint:   { x: pW, y: 0 },
                fillLinearGradientColorStops: [
                    0,   '#6a6a70',
                    0.3, '#b0b0b8',
                    0.6, '#c8c8d0',
                    1,   '#6a6a70',
                ],
                stroke: '#505058', strokeWidth: 0.5,
            }));
            // 引脚顶部焊点
            this.group.add(new Konva.Rect({
                x: px - pW * 1.2, y: topY - 2,
                width: pW * 2.4, height: 5,
                fill: '#909098', stroke: '#686870', strokeWidth: 0.5, cornerRadius: 1,
            }));
            // 端子标注
            this.group.add(new Konva.Text({
                x: px - 6, y: botY + 3,
                text: label, fontSize: 10, fontStyle: 'bold', fill: col,
            }));
        });
    }

    // ── 动态层①：光子入射 + ARC 光晕 ──────────────────────
    _drawLightLayer() {
        this._lightGroup = new Konva.Group();
        this.group.add(this._lightGroup);
        this._rebuildLightLayer();
    }

    _rebuildLightLayer() {
        this._lightGroup.destroyChildren();
        const frac = this._evFrac();

        // ARC 颜色随照度变化（深蓝→亮蓝紫）
        const rARC = Math.round(26  + frac * 30);
        const gARC = Math.round(42  + frac * 30);
        const bARC = Math.round(72  + frac * 80);
        if (this._arcRect) {
            this._arcRect.fill(`rgb(${rARC},${gARC},${bARC})`);
        }

        if (frac < 0.01) return;

        const x = this._faceX, y = this._faceY;
        const w = this._faceW, h = this._faceH;
        const alpha = frac * 0.40;

        // 正面受光漫反射光晕（均匀覆盖受光面）
        this._lightGroup.add(new Konva.Rect({
            x, y, width: w, height: h,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint:   { x: 0, y: h },
            fillLinearGradientColorStops: [
                0,   `rgba(160,190,255,${alpha})`,
                0.5, `rgba(120,160,240,${alpha * 0.6})`,
                1,   `rgba(80,120,200,${alpha * 0.2})`,
            ],
            cornerRadius: 2,
        }));

        // 强光时叠加亮白核心（正面中央）
        if (frac > 0.50) {
            const cAlpha = (frac - 0.50) / 0.50 * 0.28;
            this._lightGroup.add(new Konva.Ellipse({
                x: x + w / 2, y: y + h * 0.38,
                radiusX: w * 0.35, radiusY: h * 0.28,
                fill: `rgba(220,230,255,${cAlpha})`,
            }));
        }

        // 光子粒子（竖向射入受光面，穿透 ARC 进入半导体）
        this._photons.forEach(ph => {
            const r = Math.round(180 + ph.alpha * 70);
            const g = Math.round(200 + ph.alpha * 50);
            this._lightGroup.add(new Konva.Line({
                points: [ph.x, ph.y - ph.len * 0.5, ph.x, ph.y + ph.len * 0.5],
                stroke: `rgba(${r},${g},255,${ph.alpha * frac})`,
                strokeWidth: 0.8, lineCap: 'round',
            }));
            // 光子箭头尖端
            this._lightGroup.add(new Konva.Line({
                points: [
                    ph.x - 2, ph.y - 3,
                    ph.x,     ph.y + 2,
                    ph.x + 2, ph.y - 3,
                ],
                stroke: `rgba(${r},${g},255,${ph.alpha * frac * 0.7})`,
                strokeWidth: 0.8, lineCap: 'round', lineJoin: 'round',
            }));
        });
    }

    // ── 动态层②：载流子运动 + 外电路电流箭头 ────────────────
    _drawCarrierLayer() {
        this._carrierGroup = new Konva.Group();
        this.group.add(this._carrierGroup);
        this._rebuildCarrierLayer();
    }

    _rebuildCarrierLayer() {
        this._carrierGroup.destroyChildren();
        const frac = this._evFrac();
        if (frac < 0.05) return;

        // ── 载流子粒子 ──
        this._carriers.forEach(c => {
            const isElectron = (c.type === 'e');
            const col = isElectron
                ? `rgba(100,160,255,${c.alpha})`   // 电子：蓝
                : `rgba(255,140,60,${c.alpha})`;   // 空穴：橙
            this._carrierGroup.add(new Konva.Circle({
                x: c.x, y: c.y, radius: 2.2,
                fill: col,
                shadowColor: col, shadowBlur: 3, shadowOpacity: 0.6,
            }));
        });

        // ── 外电路电流箭头（照度 > 20% 时显示）──
        if (frac > 0.20) {
            this._drawExternalCircuit(frac);
        }
    }

    // 外电路电流指示（从正极 → 外部 → 负极 的虚线箭头）
    _drawExternalCircuit(frac) {
        const pX  = this._pinPX;
        const nX  = this._pinNX;
        const botY= this._pinBotY + 12;
        const alpha = Math.min(1, (frac - 0.20) / 0.30) * 0.70;

        // 外电路线（底部 U 形）
        const col = `rgba(255,200,80,${alpha})`;
        this._carrierGroup.add(new Konva.Line({
            points: [pX, this._pinBotY - 5, pX, botY, nX, botY, nX, this._pinBotY - 5],
            stroke: col, strokeWidth: 1.5, lineCap: 'round', lineJoin: 'round',
        }));

        // 电流方向箭头（正极流出，沿外电路到负极）
        // 箭头1：正极向下
        this._carrierGroup.add(new Konva.Line({
            points: [pX - 3, botY - 6, pX, botY - 1, pX + 3, botY - 6],
            stroke: col, strokeWidth: 1.2, lineCap: 'round', lineJoin: 'round',
        }));
        // 箭头2：底部向右（中点）
        const midX = (pX + nX) / 2;
        this._carrierGroup.add(new Konva.Line({
            points: [midX - 5, botY - 3, midX, botY, midX - 5, botY + 3],
            stroke: col, strokeWidth: 1.2, lineCap: 'round', lineJoin: 'round',
        }));
        // 箭头3：负极向上
        this._carrierGroup.add(new Konva.Line({
            points: [nX - 3, botY - 1, nX, botY - 6, nX + 3, botY - 1],
            stroke: col, strokeWidth: 1.2, lineCap: 'round', lineJoin: 'round',
        }));

        // 电流标注
        this._carrierGroup.add(new Konva.Text({
            x: midX - 20, y: botY + 4,
            width: 40, text: `${this._isc.toFixed(2)} A`,
            fontSize: 7, fill: `rgba(255,200,80,${alpha})`, align: 'center',
        }));
    }

    // ── 正面前景（边框 + 高光，覆盖动态层）──────────────────
    _drawFaceFront() {
        const x = this._faceX, y = this._faceY;
        const w = this._faceW, h = this._faceH;

        // 外框轮廓
        this.group.add(new Konva.Rect({
            x, y, width: w, height: h,
            fill: 'transparent', stroke: '#4a5a7a', strokeWidth: 1.2, cornerRadius: 2,
        }));
        // 左上角高光（模拟受光面镜面反射）
        this.group.add(new Konva.Line({
            points: [x + 4, y + 4, x + w * 0.22, y + 4],
            stroke: 'rgba(200,220,255,0.25)', strokeWidth: 1.5, lineCap: 'round',
        }));
        this.group.add(new Konva.Line({
            points: [x + 4, y + 4, x + 4, y + h * 0.18],
            stroke: 'rgba(200,220,255,0.18)', strokeWidth: 1.2, lineCap: 'round',
        }));
        // 正面与剖面之间的分隔标注
        this.group.add(new Konva.Line({
            points: [x - 2, this._secY, x + w + 2, this._secY],
            stroke: '#3a3a48', strokeWidth: 1,
        }));
        this.group.add(new Konva.Text({
            x: x - 2, y: this._secY - 10,
            text: '受光面', fontSize: 7, fill: '#607080',
        }));
        this.group.add(new Konva.Text({
            x: x - 2, y: this._secY + 2,
            text: '剖面', fontSize: 7, fill: '#607080',
        }));
    }

    // ── 位号 + 参数标注 ────────────────────────────────────
    _drawLabel() {
        const W = this.width;
        this.group.add(new Konva.Text({
            x: 0, y: -16, width: W,
            text: `${this.label}  ${this.material}  ${this.area}×${this.area}mm`,
            fontSize: 9, fontStyle: 'bold', fill: '#546e7a', align: 'center',
        }));
        // STC 参数标注（Isc / Voc）
        this.group.add(new Konva.Text({
            x: 0, y: -5, width: W,
            text: `Isc=${this.isc_stc}A  Voc=${this.voc_stc}V  FF=${this.ff}`,
            fontSize: 7, fill: '#5a7a8a', align: 'center',
        }));
    }

    // ── 状态指示（正面左下角 + 电气读数）──────────────────
    _drawStatusIndicator() {
        const W  = this.width;
        const ix = this._faceX + 6;
        const iy = this._faceY + this._faceH - 14;
        const frac = this._evFrac();

        this._statusDot = new Konva.Circle({
            x: ix, y: iy, radius: 3.5,
            fill:   this._ledColor(frac),
            stroke: this._ledStroke(frac),
            strokeWidth: 0.7,
            shadowColor:   this._ledColor(frac),
            shadowBlur:    frac > 0.05 ? 5 : 1,
            shadowOpacity: 0.8,
        });
        this._statusText = new Konva.Text({
            x: ix + 6, y: iy - 5,
            text: this._evLabel(frac),
            fontSize: 7, fontStyle: 'bold', fill: this._ledColor(frac),
        });
        this.group.add(this._statusDot, this._statusText);

        // 电气量读数（三行：Isc / Voc / Pmax）
        this._readoutIsc = new Konva.Text({
            x: this._faceX, y: iy - 4,
            width: this._faceW, align: 'center',
            text: `Isc=${this._isc.toFixed(3)} A`,
            fontSize: 8, fontStyle: 'bold', fill: this._ledColor(frac),
        });
        this._readoutVoc = new Konva.Text({
            x: this._faceX, y: iy + 6,
            width: this._faceW, align: 'center',
            text: `Voc=${this._voc.toFixed(3)} V   Pmax=${this._pmax.toFixed(2)} W`,
            fontSize: 7, fill: this._ledColor(frac),
        });
        this.group.add(this._readoutIsc, this._readoutVoc);
    }

    // ── 点击切换预设照度 ──────────────────────────────────────
    _bindInteraction() {
        this.group.on('click tap', () => this.stepIlluminance());
        this.group.listening(true);
    }

    // ═══════════════════════════════════════════
    // 集中化 tick（由 consys._tickAll 在 20fps 调用）
    tick(dt) {
        this._tickAnimation(dt);
    }
    _tickAnimation(dt) {
        let needRefresh = false;

        // ── 照度变化动画（正弦缓动）──
        if (this._animating) {
            this._animT += dt / this._animDur;
            if (this._animT >= 1) {
                this._animT       = 1;
                this._animating   = false;
                this._illuminance = this._evTo;
            }
            const ease         = 0.5 - 0.5 * Math.cos(this._animT * Math.PI);
            this._illuminance  = this._evFrom + (this._evTo - this._evFrom) * ease;
            this._updateElectrical(this._illuminance);
            needRefresh = true;
        }

        const frac = this._evFrac();

        // ── 光子粒子（照度 > 5% 时生成）──
        if (frac > 0.05) {
            this._photonTimer += dt;
            const spawnInterval = 0.05 + (1 - frac) * 0.08;
            if (this._photonTimer > spawnInterval) {
                this._photonTimer = 0;
                const spawnX = this._faceX + Math.random() * this._faceW;
                this._photons.push({
                    x:     spawnX,
                    y:     this._faceY + 2,
                    vy:    30 + Math.random() * 25,    // px/s
                    len:   6 + Math.random() * 6,
                    alpha: 0.5 + Math.random() * 0.5,
                });
            }
            this._photons = this._photons.filter(ph => {
                ph.y    += ph.vy * dt;
                ph.alpha-= dt * 1.5;
                return ph.alpha > 0 && ph.y < this._secY + this._lyN + this._lyJ;
            });
            needRefresh = true;
        } else {
            if (this._photons.length) { this._photons = []; needRefresh = true; }
        }

        // ── 载流子粒子（照度 > 10% 时生成，在 P-N 结附近激发）──
        if (frac > 0.10) {
            this._carrierTimer += dt;
            const spawnInterval = 0.08 + (1 - frac) * 0.10;
            if (this._carrierTimer > spawnInterval) {
                this._carrierTimer = 0;
                const jx = this._faceX + Math.random() * this._faceW;
                const jy = this._junctionY + (Math.random() - 0.5) * this._lyJ;
                // 电子：向上（N区，栅线）
                this._carriers.push({
                    x: jx, y: jy,
                    vx: (Math.random() - 0.5) * 12,
                    vy: -(20 + Math.random() * 20),
                    alpha: 0.8, type: 'e',
                });
                // 空穴：向下（P区，背电极）
                this._carriers.push({
                    x: jx, y: jy,
                    vx: (Math.random() - 0.5) * 12,
                    vy: +(20 + Math.random() * 20),
                    alpha: 0.8, type: 'h',
                });
            }
            this._carriers = this._carriers.filter(c => {
                c.x     += c.vx * dt;
                c.y     += c.vy * dt;
                c.alpha -= dt * 1.2;
                return c.alpha > 0
                    && c.x > this._faceX && c.x < this._faceX + this._faceW
                    && c.y > this._faceY && c.y < this._secY + this._secH;
            });
            needRefresh = true;
        } else {
            if (this._carriers.length) { this._carriers = []; needRefresh = true; }
        }

        if (needRefresh) {
            this._rebuildLightLayer();
            this._rebuildCarrierLayer();
            this._updateStatus();
            this._refreshCache();
        }
    }

    _updateStatus() {
        const frac = this._evFrac();
        const col  = this._ledColor(frac);
        const sc   = this._ledStroke(frac);

        if (this._statusDot) {
            this._statusDot.fill(col);
            this._statusDot.stroke(sc);
            this._statusDot.shadowColor(col);
            this._statusDot.shadowBlur(frac > 0.05 ? 5 : 1);
        }
        if (this._statusText) {
            this._statusText.text(this._evLabel(frac));
            this._statusText.fill(col);
        }
        if (this._readoutIsc) {
            this._readoutIsc.text(`Isc=${this._isc.toFixed(3)} A`);
            this._readoutIsc.fill(col);
        }
        if (this._readoutVoc) {
            this._readoutVoc.text(`Voc=${this._voc.toFixed(3)} V   Pmax=${this._pmax.toFixed(2)} W`);
            this._readoutVoc.fill(col);
        }
    }

    // ── 辅助：更新电气量（单二极管模型简化）────────────────
    _updateElectrical(ev) {
        const frac   = Math.max(0, Math.min(1, ev / this._evMax));
        this._isc    = this.isc_stc * frac;
        // Voc 随照度对数上升（kT/q × ln(Ev/Ev0)），仿真近似
        this._voc    = frac > 0.001
            ? this.voc_stc * (1 + 0.08 * Math.log(frac + 1e-6) / Math.log(10))
            : 0;
        this._voc    = Math.max(0, this._voc);
        this._pmax   = this._isc * this._voc * this.ff;
    }

    // ── 辅助 ─────────────────────────────────────────────────
    _evFrac()          { return Math.max(0, Math.min(1, this._illuminance / this._evMax)); }

    _ledColor(frac) {
        if (frac >= 0.70) return '#ffd740';
        if (frac >= 0.30) return '#80cbc4';
        if (frac >= 0.05) return '#90caf9';
        return '#546e7a';
    }
    _ledStroke(frac) {
        if (frac >= 0.70) return '#f9a825';
        if (frac >= 0.30) return '#00897b';
        if (frac >= 0.05) return '#1565c0';
        return '#2e454f';
    }
    _evLabel(frac) {
        if (frac >= 0.70) return '强光';
        if (frac >= 0.30) return '中光';
        if (frac >= 0.05) return '弱光';
        return '暗态';
    }

    // ═══════════════════════════════════════════
    /**
     * 设置目标辐照度（W/m²），带动画过渡
     * @param {number} ev  目标辐照度（0 ~ evMax）
     */
    setIlluminance(ev) {
        const target = Math.max(0, Math.min(this._evMax, ev));
        if (Math.abs(target - this._illuminance) < 0.1) return;
        this._evFrom    = this._illuminance;
        this._evTo      = target;
        this._animT     = 0;
        this._animating = true;
        this.opsCount++;
        this._refreshCache();
    }

    /**
     * 点击切换预设辐照度档位
     * 档位循环：0 → 200 → 400 → 700 → 1000 → 0 W/m²
     */
    stepIlluminance() {
        if (this._animating) return;
        const steps = [0, 200, 400, 700, 1000];
        const next  = steps.find(s => s > this._illuminance + 1) ?? 0;
        this.setIlluminance(next);
    }

    /** 设置为暗态 */
    dark()   { this.setIlluminance(0); }

    /** 设置为 STC 标准辐照度（1000 W/m²）*/
    stc()    { this.setIlluminance(1000); }

    /** 当前辐照度（W/m²）*/
    getIlluminance() { return this._illuminance; }

    /** 当前短路电流（A）*/
    getIsc()   { return this._isc; }

    /** 当前开路电压（V）*/
    getVoc()   { return this._voc; }

    /** 当前最大功率（W）*/
    getPmax()  { return this._pmax; }

    isAnimating()  { return this._animating; }
    getOpsCount()  { return this.opsCount; }

    update(state) {
        if (typeof state === 'number') {
            this.setIlluminance(state);
        }
        this._refreshCache();
    }

    getConfigFields() {
        return [
            { label: '位号/名称',          key: 'label',    type: 'text'   },
            { label: '材料（c-Si/poly）',   key: 'material', type: 'text'   },
            { label: 'STC短路电流 (A)',     key: 'iscStc',   type: 'number' },
            { label: 'STC开路电压 (V)',     key: 'vocStc',   type: 'number' },
            { label: '填充因子 FF',         key: 'ff',       type: 'number' },
            { label: '电池片边长 (mm)',     key: 'area',     type: 'number' },
            { label: '最大辐照度 (W/m²)',   key: 'evMax',    type: 'number' },
            { label: '初始辐照度 (W/m²)',   key: 'initEv',   type: 'number' },
            { label: '动作时间 (s)',        key: 'animDur',  type: 'number' },
        ];
    }

    onConfigUpdate(cfg) {
        if (cfg.label    !== undefined) this.label     = cfg.label;
        if (cfg.material !== undefined) this.material  = cfg.material;
        if (cfg.iscStc   !== undefined) this.isc_stc   = parseFloat(cfg.iscStc)  || this.isc_stc;
        if (cfg.vocStc   !== undefined) this.voc_stc   = parseFloat(cfg.vocStc)  || this.voc_stc;
        if (cfg.ff       !== undefined) this.ff        = parseFloat(cfg.ff)      || this.ff;
        if (cfg.area     !== undefined) this.area      = parseFloat(cfg.area)    || this.area;
        if (cfg.evMax    !== undefined) this._evMax    = parseFloat(cfg.evMax)   || this._evMax;
        if (cfg.animDur  !== undefined) this._animDur  = parseFloat(cfg.animDur) || this._animDur;
        if (cfg.initEv   !== undefined) {
            const ev = parseFloat(cfg.initEv);
            if (!isNaN(ev)) this.setIlluminance(ev);
        }
        this.config = { ...this.config, ...cfg };
        this.group.destroyChildren();
        this._statusDot   = null;
        this._statusText  = null;
        this._readoutIsc  = null;
        this._readoutVoc  = null;
        this._arcRect     = null;
        this._init();
        this._refreshCache();
    }

    destroy() {
        super.destroy?.();
    }
}