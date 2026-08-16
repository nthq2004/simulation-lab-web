import { BaseComponent } from './BaseComponent.js';

/**
 * 电流互感器（Current Transformer / CT）仿真组件
 *
 * ═══ 工作原理 ════════════════════════════════════════════════════════
 *  电流互感器是一种将一次侧（原边）大电流按比例变换为二次侧（副边）
 *  小电流的测量设备，广泛用于电力系统的电流测量和保护回路。
 *
 *  ── 电磁感应原理 ──────────────────────────────────────────────────
 *    1. 原边绕组（P1-P2，匝数少，导线粗）串联于被测回路
 *    2. 原边电流 I₁ 在铁芯中产生交变磁通 Φ
 *    3. 根据法拉第电磁感应定律，副边绕组（S1-S2，匝数多，导线细）
 *       感应出电动势 E₂ = -N₂ × dΦ/dt
 *    4. 理想情况下：I₁ × N₁ = I₂ × N₂（磁动势平衡）
 *    5. 因此：I₂ = I₁ × (N₁ / N₂) = I₁ / K（K = N₂/N₁ 为匝数比）
 *
 *  ── 重要特性 ──────────────────────────────────────────────────────
 *    ① 副边严禁开路：开路时感应电压极高（可达数千伏），危及安全
 *    ② 副边通常接近短路状态（接电流表/保护装置的低阻抗输入）
 *    ③ 变比 K = N₂/N₁（默认 10，可配置）
 *    ④ 极性标注：P1/S1 为同名端，电流同时流入时磁通同向
 *
 * ═══ 仿真实现 ═════════════════════════════════════════════════════════
 *  采用 MNA 改进节点分析法注入电路求解：
 *
 *  ── 注入方法（在 DeviceStamps.stampCurrentTransformers 中实现）──
 *    ① 原边（P1-P2）：以 0V 电压源形式注入电路
 *       - 0V 电压源对电路拓扑无影响（等效为理想导线）
 *       - 求解后该电压源的电流即为 I₁（原边电流）
 *       - 对应 MNA 中：添加一个电压源方程，V(P1) - V(P2) = 0
 *
 *    ② 副边（S1-S2）：受控电流源（或限压电压源）
 *       - 目标电流：I₂ = I₁ / K（利用上轮迭代收敛后的 I₁ 值）
 *       - 通过 ctx.getEquivalentResistance 估算副边负载电阻 R_load
 *       - 若 R_load × I₂ > 1000V（即超出顺从电压），切换为电压源模式：
 *         在 S1-S2 间注入 ±1000V（极性由 I₂ 方向决定）
 *       - 否则直接注入电流源 I₂
 *       - 非线性迭代允许跨帧收敛：上轮 I₁ → 本轮 I₂ → 影响本轮 I₁
 *
 *  ── 求解流程（CircuitSolver._solve 中每帧执行）──────────────────
 *    ① 构建拓扑（并查集合并端口）
 *    ② 当前帧每个迭代轮：
 *       a. stampACAmmeters：注入 0V 电压源（原边）
 *       b. stampCurrentTransformers：利用 _prevIPrimary 计算 I₂ 并注入
 *       c. 求解 MNA 方程组
 *       d. 检查收敛
 *    ③ _updateDeviceCurrents：读取 I₁ = results[primaryIdx]
 *       存入 physCurrent / _prevIPrimary，供 tick 使用
 *    ④ tick() 从 physCurrent 读取 I₁，计算 I₂ 显示
 *
 *  ═══ 渲染结构 ═════════════════════════════════════════════════════════
 *  左侧（50%）：实物图片区
 *    ① 浅灰边框面板
 *    ② 从 ct01.jpg 加载的图片（等比缩放居中）
 *    ③ 底部标注"电流互感器实物图"
 *
 *  右侧（50%）：原理图与标准变压器符号
 *    ① 两条垂直铁芯柱 + 上下横轭
 *       - 灰色实体填充，深色描边
 *       - 中央标注"铁芯"文字
 *    ② 原边绕组（铁芯上方左右各 1 匝，粗导线铜色 #c07030）
 *       - 从 P1/P2 接线端引出导线
 *       - 半圆弧朝下开口
 *       - 标注"原边 2匝"
 *    ③ 副边绕组（铁芯下方左右各 10 匝，细导线蓝色 #3080b0）
 *       - 从 S1/S2 接线端引出导线
 *       - 半圆弧朝上开口
 *       - 标注"副边 20匝"
 *  ④ 接线端（黄铜螺柱 + 彩色引出线）
 *       - P1（红）、P2（蓝）：原边接线柱在顶部，引出线向上到顶边
 *       - S1（绿）、S2（棕）：副边接线柱在底部，引出线向下到底边
 *    ⑤ 动态显示区
 *       - 变比显示（铁芯上方）
 *       - I₁ 实时读数（红色）
 *       - I₂ 实时读数（蓝色）
 *
 * ═══ 端口 ════════════════════════════════════════════════════════════
 *  p1 — P1（原边进线端 / 同名端，在组件顶边）
 *  p2 — P2（原边出线端，在组件顶边）
 *  s1 — S1（副边出线端 / 同名端，在组件底边）
 *  s2 — S2（副边进线端，在组件底边）
 *
 * ═══ 可配置参数 ══════════════════════════════════════════════════════
 *  turnsRatio    : 匝数比 K = N₂/N₁（默认 16）
 *  primaryRated  : 原边额定电流 A（默认 100，仅用于显示）
 *  secondaryRated: 副边额定电流 A（默认 5，仅用于显示）
 *  frequency     : 频率 Hz（默认 50）
 */
export class CurrentTransformer extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        // 组件尺寸，允许通过 config 覆盖
        this.width  = Math.max(340, config.width  || 460);
        this.height = Math.max(200, config.height || 260);

        // type：供 CircuitSolver._buildDeviceCache() 设备分组过滤
        // special：供 stamp 方法识别此组件类型
        this.type    = 'current_transformer';
        this.special = 'CURRENT_TRANSFORMER';

        // cache = 'fixed' 启用 Konva 静态 Canvas 缓存，静态层只绘制一次，
        // 减少每帧重绘开销（仅动态组更新时刷新）
        this.cache   = 'fixed';

        // 初始化三层分组：_staticGroup（静态，可缓存）、_dynamicGroup（动态）、_interactGroup（交互）
        this._initGroups();

        // 根据当前尺寸重新计算所有几何位置
        this._recalcGeometry();

        // 加载用户配置参数（匝数比、额定电流等）
        this._initParameters(config);

        // 绘制静态视觉元素 + 创建动态节点
        this._init();

        // 保存当前配置供 ConfigDialog 使用
        this.config = {
            turnsRatio:   this._turnsRatio,
            primaryRated: this._primaryRated,
            secondaryRated: this._secondaryRated,
        };

        // 创建 4 个电气连接端口：S1/S2 副边在顶边，P1/P2 原边在底边
        // 参数：x, y, id, type='wire'(电气)或'pipe'(管路), polarity='p'(正)或'n'(负)
        this.addPort(this._portS1.x, this._portS1.y, 's1', 'wire', 'p');
        this.addPort(this._portS2.x, this._portS2.y, 's2', 'wire', 'n');
        this.addPort(this._portP1.x, this._portP1.y, 'p1', 'wire', 'p');
        this.addPort(this._portP2.x, this._portP2.y, 'p2', 'wire', 'n');

        // 异步加载左侧实物图片
        this._loadImage();
    }

    // ═══════════════════════════════════════════════════
    // 几何尺寸计算
    // ═══════════════════════════════════════════════════

    /**
     * 根据当前 width/height 重新计算所有子元素的坐标位置。
     * 在构造时和 onConfigUpdate 触发重建时调用。
     * 所有坐标基于组件本地坐标系（相对 group 原点）。
     */
    _recalcGeometry() {
        const W = this.width, H = this.height;

        // 左右分界线：50% 位置
        this._divX  = W * 0.50;

        // 最外层面板边框
        this._frame = { x: 2, y: 2, w: W - 4, h: H - 4, rx: 6 };

        const rLeft = this._divX;
        const rW    = W - rLeft;  // 右侧面板宽度

        // ── 左侧图片区域 ──────────────────────────────
        this._imgRect = { x: 6, y: 6, w: rLeft - 10, h: H - 12 };

        // ── 右侧原理图 ────────────────────────────────
        const schCx = rLeft + rW * 0.50;  // 右侧区域水平中心

        // 铁芯尺寸与位置（整体矩形，占右半区中部）
        const coreW = rW * 0.50;
        const coreH = H * 0.50;
        this._core = { cx: schCx, cy: H * 0.48, w: coreW, h: coreH };

        // ── 副边接线端子（顶部） ─────────────────────
        const sp  = rW * 0.22;
        const tY = 34;
        this._termS1 = { x: schCx - sp * 0.5, y: tY };
        this._termS2 = { x: schCx + sp * 0.5, y: tY };

        // ── 原边接线端子（底部） ─────────────────────
        const bY = H - 34;
        this._termP1 = { x: schCx - sp * 0.5, y: bY };
        this._termP2 = { x: schCx + sp * 0.5, y: bY };

        // 电气连接端口（S1/S2 在顶边，P1/P2 在底边）
        this._portS1 = { x: this._termS1.x, y: 4 };
        this._portS2 = { x: this._termS2.x, y: 4 };
        this._portP1 = { x: this._termP1.x, y: H - 4 };
        this._portP2 = { x: this._termP2.x, y: H - 4 };
    }

    // ═══════════════════════════════════════════════════
    // 参数初始化
    // ═══════════════════════════════════════════════════

    /**
     * 从 config 对象加载或设置默认参数。
     * 所有参数可通过配置对话框修改。
     *
     * @param {Object} config - 用户传入的配置项
     */
    _initParameters(config) {
        // 匝数比 K = N₂/N₁，默认 10（即原边 2 匝、副边 20 匝 → 变比 10:1）
        // 注意：这里的 turnsRatio 指副边匝数 / 原边匝数
        // 电流变换关系：I₂ = I₁ / turnsRatio
        this._turnsRatio    = config.turnsRatio    !== undefined ? parseFloat(config.turnsRatio)    : 10;

        // 额定电流（仅用于显示标注，不影响电路求解）
        this._primaryRated  = config.primaryRated  !== undefined ? parseFloat(config.primaryRated)  : 100;
        this._secondaryRated = config.secondaryRated !== undefined ? parseFloat(config.secondaryRated) : 5;

        // 原边电流值，由求解器每帧更新
        // _prevIPrimary：上一轮迭代的原边电流（供 stamp 计算副边电流）
        // physCurrent：由 _updateDeviceCurrents 设置
        this._prevIPrimary  = 0;
        this.I_primary      = 0;
        this.I_secondary    = 0;

        // 频率与交流相位（用于动画相位跟踪，当前版本未使用动画效果，预留）
        this._freq          = config.frequency !== undefined ? parseFloat(config.frequency) : 50;
        this._acPhase       = 0;
    }

    // ═══════════════════════════════════════════════════
    // 主初始化
    // ═══════════════════════════════════════════════════

    /**
     * 绘制所有静态图形元素 + 创建动态文本节点。
     * 静态元素写入 _staticGroup（可被 Konva cache 缓存），
     * 动态元素写入 _dynamicGroup（每帧 tick 更新）。
     */
    _init() {
        this._drawFrame();
        this._drawImagePanel();
        this._drawSchematicStatic();
        this._createDynamicNodes();
    }

    // ═══════════════════════════════════════════════════
    // 图片加载
    // ═══════════════════════════════════════════════════

    /**
     * 异步加载左侧实物图片（ct01.jpg）。
     * 使用 HTML Image 对象，加载完成后等比缩放至图片区域居中显示。
     * 若图片尚未加载完成，Konva.Image 节点会先以空白占位，
     * 加载完成后自动更新尺寸并触发缓存刷新。
     */
    _loadImage() {
        const img = new window.Image();
        img.onload = () => {
            this._ctImage = img;
            if (this._imgNode) {
                const r = this._imgRect;
                // 等比缩放，使图片完全填充图片区域
                const scale = Math.min(r.w / img.width, r.h / img.height);
                const iw = img.width * scale;
                const ih = img.height * scale;
                this._imgNode.image(img);
                this._imgNode.width(iw);
                this._imgNode.height(ih);
                this._imgNode.x(r.x + (r.w - iw) / 2);
                this._imgNode.y(r.y + (r.h - ih) / 2);
                // 强制刷新 Konva cache 以显示新图片
                this._forceCacheFlush();
            }
        };
        // 图片路径相对于 index.html（项目根目录）
        img.src = './images/ct01.jpg';
    }

    // ═══════════════════════════════════════════════════
    // 静态部件绘制
    // ══════════════════════════════════════════════════

    /**
     * 最外层面板边框 — 浅灰色圆角矩形
     */
    _drawFrame() {
        const f = this._frame;
        this._staticGroup.add(new Konva.Rect({
            x: f.x, y: f.y, width: f.w, height: f.h,
            fill: '#e8eaec',
            stroke: '#b0b4b8', strokeWidth: 1.5,
            cornerRadius: f.rx,
        }));
    }

    /**
     * 左侧图片面板：白色底 + 图片 + 底部文字
     */
    _drawImagePanel() {
        const r = this._imgRect;

        // 图片背景框
        this._staticGroup.add(new Konva.Rect({
            x: r.x, y: r.y, width: r.w, height: r.h,
            fill: '#f4f4f0',
            stroke: '#c8ccd0', strokeWidth: 1,
            cornerRadius: 4,
        }));

        // 图片节点（初始用占位尺寸，加载完成后调整）
        const img = this._ctImage;
        this._imgNode = new Konva.Image({
            x: r.x, y: r.y,
            width: r.w, height: r.h,
            image: img || undefined,
        });
        if (img) {
            const scale = Math.min(r.w / img.width, r.h / img.height);
            const iw = img.width * scale;
            const ih = img.height * scale;
            this._imgNode.width(iw);
            this._imgNode.height(ih);
            this._imgNode.x(r.x + (r.w - iw) / 2);
            this._imgNode.y(r.y + (r.h - ih) / 2);
        }
        this._staticGroup.add(this._imgNode);

        // 底部说明文字
        this._staticGroup.add(new Konva.Text({
            x: r.x, y: r.y + r.h - 22,
            text: '电流互感器实物图',
            fontSize: 12, fontFamily: 'Arial',
            fill: '#888', width: r.w, align: 'center',
        }));
    }

    /**
     * 右侧原理图面板入口：绘制浅灰背景 + 铁芯 + 绕组 + 端子 + 标注
     */
    _drawSchematicStatic() {
        const W = this.width, H = this.height;
        const f = this._frame;
        const rLeft = this._divX;

        // 右侧面板背景
        this._staticGroup.add(new Konva.Rect({
            x: rLeft + 1, y: f.y + 2,
            width: W - rLeft - f.x - 2, height: f.h - 4,
            fill: '#f0f2f4',
            cornerRadius: [0, f.rx - 1, f.rx - 1, 0],
        }));

        // 标题
        this._staticGroup.add(new Konva.Text({
            x: rLeft + 8, y: 10,
            text: '原理图',
            fontSize: 13, fontFamily: 'Arial', fontStyle: 'bold',
            fill: '#555',
        }));

        // 依次绘制各子部件
        this._drawCore();
        this._drawPrimaryWinding();
        this._drawSecondaryWinding();
        this._drawTerminals();
        this._drawConnectionLabels();
    }

    /**
     * 方形铁芯（硅钢片叠装结构）
     *
     * 绘制层次：
     *  ① 外层深灰矩形边框（模拟铁芯外壳）
     *  ② 内层浅灰矩形（模拟铁芯截面）
     *  ③ 多条竖直细条纹（模拟硅钢片叠片纹理）
     *  ④ 中央 "铁芯" 标签（白色文字）
     */
    _drawCore() {
        const { cx, cy, w, h } = this._core;
        const halfW = w * 0.5, halfH = h * 0.5;
        const barW = w * 0.18;

        // 空心框铁芯：左右两条垂直柱 + 上下水平轭
        // 上轭
        this._staticGroup.add(new Konva.Rect({
            x: cx - halfW, y: cy - halfH,
            width: w, height: barW,
            fill: '#8898a8',
            stroke: '#485060', strokeWidth: 1.5,
        }));
        // 下轭
        this._staticGroup.add(new Konva.Rect({
            x: cx - halfW, y: cy + halfH - barW,
            width: w, height: barW,
            fill: '#8898a8',
            stroke: '#485060', strokeWidth: 1.5,
        }));
        // 左柱
        this._staticGroup.add(new Konva.Rect({
            x: cx - halfW, y: cy - halfH,
            width: barW, height: h,
            fill: '#8898a8',
            stroke: '#485060', strokeWidth: 1.5,
        }));
        // 右柱
        this._staticGroup.add(new Konva.Rect({
            x: cx + halfW - barW, y: cy - halfH,
            width: barW, height: h,
            fill: '#8898a8',
            stroke: '#485060', strokeWidth: 1.5,
        }));

        // 铁芯标注
        this._staticGroup.add(new Konva.Text({
            x: cx - 25, y: cy - 8,
            text: '铁芯',
            fontSize: 13, fontFamily: 'Arial', fontStyle: 'bold',
            fill: '#e8eef0',
            width: 50, align: 'center',
        }));
    }

    /**
     * 原边绕组（2 匝螺旋线圈，绕在上轭上）
     *
     * 画法：在上轭表面绘制连续的螺旋线圈（弹簧状），
     * 每匝是一个朝上鼓起的半圆弧，左右两端连接到轭面。
     */
    _drawPrimaryWinding() {
        const { cx, cy, w, h } = this._core;
        const halfW = w * 0.5, halfH = h * 0.5;
        const barW = w * 0.18;
        const nTurns = 2;
        const wireW = 3;

        // 下轭中心 y
        const barY = cy + halfH - barW * 0.5;
        // 螺旋线圈在轭面下方鼓起的高度
        const coilR = barW * 0.7;
        // 每匝宽度
        const turnW = w * 0.35 / nTurns;
        // 起始 x（居中排列）
        const x0 = cx - (nTurns * turnW) / 2;

        // 画每一匝（下半圆）
        for (let t = 0; t < nTurns; t++) {
            const ox = x0 + t * turnW + turnW * 0.5;
            this._staticGroup.add(new Konva.Arc({
                x: ox, y: barY,
                innerRadius: coilR * 0.5,
                outerRadius: coilR,
                angle: 180,
                rotation: 0,
                fill: '#c07030',
                stroke: '#a05820',
                strokeWidth: 0.8,
            }));
        }

        // 引线：P1 → 第一匝左侧，P2 → 最后一匝右侧
        this._staticGroup.add(new Konva.Line({
            points: [this._termP1.x, this._termP1.y, x0, barY],
            stroke: '#c07030', strokeWidth: wireW, lineCap: 'round',
        }));
        this._staticGroup.add(new Konva.Line({
            points: [this._termP2.x, this._termP2.y, x0 + nTurns * turnW, barY],
            stroke: '#c07030', strokeWidth: wireW, lineCap: 'round',
        }));
    }

    /**
     * 副边绕组（20 匝螺旋线圈，绕在下轭上）
     *
     * 画法：在下轭表面绘制连续的螺旋线圈（弹簧状），
     * 每匝是一个朝下鼓起的半圆弧，左右两端连接到轭面。
     */
    _drawSecondaryWinding() {
        const { cx, cy, w, h } = this._core;
        const halfW = w * 0.5, halfH = h * 0.5;
        const barW = w * 0.18;
        const nTurns = 20;
        const wireW = 2;

        // 上轭中心 y
        const barY = cy - halfH + barW * 0.5;
        // 螺旋线圈在轭面上方鼓起的高度
        const coilR = barW * 0.7;
        // 每匝宽度
        const turnW = w * 0.55 / nTurns;
        // 起始 x（居中排列）
        const x0 = cx - (nTurns * turnW) / 2;

        // 画每一匝（上半圆）
        for (let t = 0; t < nTurns; t++) {
            const ox = x0 + t * turnW + turnW * 0.5;
            this._staticGroup.add(new Konva.Arc({
                x: ox, y: barY,
                innerRadius: coilR * 0.4,
                outerRadius: coilR,
                angle: 180,
                rotation: 180,
                fill: '#3080b0',
                stroke: '#206090',
                strokeWidth: 0.3,
            }));
        }

        // 引线：S1 → 第一匝左侧，S2 → 最后一匝右侧
        this._staticGroup.add(new Konva.Line({
            points: [this._termS1.x, this._termS1.y, x0, barY],
            stroke: '#3080b0', strokeWidth: wireW, lineCap: 'round',
        }));
        this._staticGroup.add(new Konva.Line({
            points: [this._termS2.x, this._termS2.y, x0 + nTurns * turnW, barY],
            stroke: '#3080b0', strokeWidth: wireW, lineCap: 'round',
        }));
    }

    /**
     * 黄铜接线端子（底部 4 个）
     *
     * 每个端子由外圈（金色渐变金属质感）、内芯（深色）和
     * 彩色引出线组成。颜色区分：
     *  - P1：红色（原边+）
     *  - P2：蓝色（原边-）
     *  - S1：绿色（副边+）
     *  - S2：棕色（副边-）
     */
    _drawTerminals() {
        const tR = Math.max(5, this.width * 0.017);
        const termDefs = [
            { pos: this._termP1, label: 'P1', color: '#c83020', top: false },
            { pos: this._termP2, label: 'P2', color: '#3068c0', top: false },
            { pos: this._termS1, label: 'S1', color: '#20a060', top: true },
            { pos: this._termS2, label: 'S2', color: '#806020', top: true },
        ];
        termDefs.forEach(td => {
            // 外圈：金色渐变
            this._staticGroup.add(new Konva.Circle({
                x: td.pos.x, y: td.pos.y, radius: tR,
                fillLinearGradientStartPoint: { x: -tR, y: -tR },
                fillLinearGradientEndPoint:   { x:  tR, y:  tR },
                fillLinearGradientColorStops: [0, '#d8c870', 0.5, '#f0e090', 1, '#b8a858'],
                stroke: '#908030', strokeWidth: 1,
            }));
            // 内芯：深色圆点
            this._staticGroup.add(new Konva.Circle({
                x: td.pos.x, y: td.pos.y, radius: tR * 0.40, fill: '#383028',
            }));
            // 彩色引出线：原边向上延伸到顶边，副边向下延伸到底边
            const extY = td.top ? 2 : this.height - 2;
            this._staticGroup.add(new Konva.Line({
                points: [td.pos.x, td.pos.y + (td.top ? -tR : tR), td.pos.x, extY],
                stroke: td.color, strokeWidth: 2,
            }));
        });
    }

    /**
     * 底部端口标注文字（P1、P2、S1、S2）
     * 在端子正下方显示，便于识别。
     */
    _drawConnectionLabels() {
        const labels = [
            { x: this._termS1.x, y: this._termS1.y - 18, label: 'S1' },
            { x: this._termS2.x, y: this._termS2.y - 18, label: 'S2' },
            { x: this._termP1.x, y: this._termP1.y + 4,  label: 'P1' },
            { x: this._termP2.x, y: this._termP2.y + 4,  label: 'P2' },
        ];
        labels.forEach(l => {
            this._staticGroup.add(new Konva.Text({
                x: l.x - 12, y: l.y,
                text: l.label,
                fontSize: 10, fontFamily: 'Arial', fontStyle: 'bold',
                fill: '#444',
                width: 24, align: 'center',
            }));
        });
    }

    // ═══════════════════════════════════════════════════
    // 动态节点创建
    // ═══════════════════════════════════════════════════

    /**
     * 创建所有需要在每帧 tick 中更新内容的动态文本节点。
     */
    _createDynamicNodes() {
        this._createCurrentDisplay();
        this._createRatioDisplay();
    }

    /**
     * 原边/副边电流实时读数显示
     * 位于右侧原理图下方，tick() 中每帧更新。
     */
    _createCurrentDisplay() {
        const rLeft = this._divX;
        const fs = 12;
        const baseY = this._core.cy + this._core.h * 0.5 + 20;
        this._primaryText = new Konva.Text({
            x: rLeft + 10, y: baseY,
            text: 'I₁ = 0.00 A',
            fontSize: fs, fontFamily: 'Courier New', fontStyle: 'bold',
            fill: '#c83020',
            width: this.width - rLeft - 20, align: 'left',
        });
        this._dynamicGroup.add(this._primaryText);

        this._secondaryText = new Konva.Text({
            x: rLeft + 10, y: baseY + 16,
            text: 'I₂ = 0.00 A',
            fontSize: fs, fontFamily: 'Courier New', fontStyle: 'bold',
            fill: '#206090',
            width: this.width - rLeft - 20, align: 'left',
        });
        this._dynamicGroup.add(this._secondaryText);
    }

    /**
     * 变比显示（铁芯上方）
     * 显示当前配置的匝数比 K。
     */
    _createRatioDisplay() {
        const c = this._core;
        this._ratioText = new Konva.Text({
            x: c.cx - c.w * 0.3, y: c.cy - 8,
            text: `变比 ${this._turnsRatio}:1`,
            fontSize: 12, fontFamily: 'Arial', fontStyle: 'bold',
            fill: '#666',
            width: c.w * 0.6, align: 'center',
        });
        this._dynamicGroup.add(this._ratioText);
    }

    // ═══════════════════════════════════════════════════
    // 动态更新
    // ═══════════════════════════════════════════════════

    /**
     * 每帧更新显示内容：
     *  ① I₁ 数值（红色）— 原边电流
     *  ② I₂ 数值（蓝色）— 副边电流
     *  ③ 变比显示
     *  ④ 当电流接近零时，文字变灰
     */
    _updateDynamic() {
        const i1 = this.I_primary;
        const i2 = this.I_secondary;

        // 更新电流数值（保留 3 位小数）
        this._primaryText.text(`I₁ = ${i1.toFixed(2)} A`);
        this._secondaryText.text(`I₂ = ${i2.toFixed(2)} A`);

        // 更新变比（可能用户通过配置对话框修改）
        this._ratioText.text(`变比 ${this._turnsRatio}:1`);

        // 无电流时文字变灰以示区别
        const active = Math.abs(i1) > 0.001;
        this._primaryText.fill(active ? '#c83020' : '#999');
        this._secondaryText.fill(active ? '#206090' : '#999');
    }

    // ═══════════════════════════════════════════════════
    // tick 主循环（20fps，由 ControlSystem._tickAll 驱动）
    // ═══════════════════════════════════════════════════

    /**
     * 每帧（约 50ms）由 ControlSystem 统一调用的更新入口。
     *
     * 执行顺序（在 System._updatePhysics 中）：
     *  ① CircuitSolver.update()  →  求解电路
     *     → _updateDeviceCurrents 设置 this.physCurrent = I₁
     *  ② ...其他求解器...
     *  ③ _tickAll()  →  遍历所有组件调用 tick(dt)
     *
     * 因此 tick() 执行时 physCurrent 已经是当前帧的求解结果。
     *
     * @param {number} dt - 帧时间间隔（秒），固定为 1/20
     */
    tick(dt) {
        // 从求解器读取原边电流（由 _updateDeviceCurrents 设置）
        if (this.physCurrent !== undefined) {
            this._prevIPrimary = this.physCurrent;
            this.I_primary = this.physCurrent;
            // 根据变比计算副边电流（供显示）
            this.I_secondary = this.physCurrent / this._turnsRatio;
        }

        // 交流相位更新（预留动画用）
        this._acPhase = (this._acPhase + dt * 2 * Math.PI * this._freq) % (2 * Math.PI);

        // 更新显示文本
        this._updateDynamic();

        // 标记脏状态 → 下一帧重绘
        this.markDirty();
        this._refreshIfDirty();
    }

    // ═══════════════════════════════════════════════════
    // 公开 API
    // ═══════════════════════════════════════════════════

    /**
     * 设置匝数比（外部调用接口）
     * @param {number|string} ratio - 匝数比 K = N₂/N₁
     */
    setTurnsRatio(ratio) {
        this._turnsRatio = Math.max(1, parseFloat(ratio) || 16);
    }

    /**
     * 外部状态更新接口（由 WorkflowManager 等调用）
     * @param {Object|number} state - 配置对象或直接赋值
     */
    update(state) {
        if (typeof state === 'object' && state !== null) {
            if (state.turnsRatio !== undefined) this.setTurnsRatio(state.turnsRatio);
            if (state.primaryRated !== undefined) this._primaryRated = parseFloat(state.primaryRated) || 100;
            if (state.secondaryRated !== undefined) this._secondaryRated = parseFloat(state.secondaryRated) || 5;
        }
    }

    // ═══════════════════════════════════════════════════
    // 配置界面
    // ═══════════════════════════════════════════════════

    /**
     * 返回可配置参数列表（右键菜单 → "参数设置" → 配置对话框）。
     * 每个字段定义：label（中文显示名）、key（属性名）、type（输入类型）
     *
     * @returns {Array<{label:string, key:string, type:string}>}
     */
    getConfigFields() {
        return [
            { label: '匝数比（原边:副边）',  key: 'turnsRatio',    type: 'number' },
            { label: '原边额定电流 A',       key: 'primaryRated',  type: 'number' },
            { label: '副边额定电流 A',       key: 'secondaryRated', type: 'number' },
        ];
    }

    /**
     * 配置保存回调（用户点击"保存"后触发）。
     * 更新参数 → 重新计算几何 → 重建所有静态/动态节点 → 刷新缓存。
     *
     * @param {Object} cfg - 用户修改后的配置对象
     */
    onConfigUpdate(cfg) {
        if (cfg.turnsRatio     !== undefined) this._turnsRatio     = Math.max(1, parseFloat(cfg.turnsRatio) || 16);
        if (cfg.primaryRated   !== undefined) this._primaryRated   = parseFloat(cfg.primaryRated)   || 100;
        if (cfg.secondaryRated !== undefined) this._secondaryRated = parseFloat(cfg.secondaryRated) || 5;

        this.config = { ...this.config, ...cfg };

        // 完全重建：销毁现有子节点 → 重新绘制
        this._recalcGeometry();
        this._staticGroup.destroyChildren();
        this._dynamicGroup.destroyChildren();
        this._drawFrame();
        this._drawImagePanel();
        this._drawSchematicStatic();
        this._createDynamicNodes();
        this._loadImage();
        this._refreshCache?.();
    }

    /**
     * 组件销毁时清理资源
     */
    destroy() {
        super.destroy?.();
    }
}
