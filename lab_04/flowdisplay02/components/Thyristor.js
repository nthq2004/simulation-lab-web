import { BaseComponent } from './BaseComponent.js';

/**
 * 晶闸管（可控硅整流器）仿真组件
 * （Thyristor / Silicon Controlled Rectifier，SCR）
 *
 * ── 结构说明 ──────────────────────────────────────────────────
 *
 *  晶闸管采用标准 TO-220 封装（常见于中小功率场合），由以下部分组成：
 *
 *  1. 散热片（Heat Sink Tab）：金属铝片，顶部用于安装散热器
 *     - 正面银色铝板，边缘有安装孔
 *  2. 塑料封装体（Plastic Body）：黑色环氧矩形体，含丝印信息
 *     - 顶部与散热片一体，底部三引脚伸出
 *  3. 阳极引脚（Anode / A）：左侧引脚，主电流正极输入端
 *  4. 阴极引脚（Cathode / K）：中间引脚，主电流负极输出端
 *  5. 门极引脚（Gate / G）：右侧引脚，触发控制端
 *     - 通常比阳极/阴极引脚细，颜色区分
 *  6. 内部 PNPN 四层结构示意（封装体背面可视化）：
 *     - P1（阳极层）→ N1 → P2（门极层）→ N2（阴极层）
 *     - 导通时四层依次高亮
 *
 * ── 工作原理 ──────────────────────────────────────────────────
 *
 *  晶闸管是四层三端半导体器件（PNPN），具有"触发导通、自保持、需过零关断"特性：
 *
 *  ① 正向阻断（Forward Blocking）：
 *     - Vak > 0，但 Ig = 0（门极无触发电流）
 *     - 器件处于高阻截止状态（J2 结反偏）
 *     - 可承受正向电压直至正向转折电压 Vbo
 *
 *  ② 门极触发导通（Gate Triggered On）：
 *     - Vak > 0，向 G 极注入触发脉冲（Ig > Igt）
 *     - 器件迅速触发进入导通状态（latching）
 *     - 导通后门极失去控制，保持导通（维持电流 Ih）
 *     - 阳极-阴极压降约 1~2V（导通管压降 Vt）
 *
 *  ③ 导通自保持（Latched On）：
 *     - 撤销门极信号后，只要阳极电流 Ia > 维持电流 Ih，持续导通
 *     - 视觉：橙红色导通辉光 + PNPN 层流动动画
 *
 *  ④ 关断（Turn Off）：
 *     - 仅能通过使阳极电流降至保持电流以下（自然换流或强迫换流）来关断
 *     - 反向偏置一段恢复时间 Tq 后方可重新触发
 *     - 仿真中：再次点击触发区关断（强迫关断模式）
 *
 * ── 四种仿真状态 ──────────────────────────────────────────────
 *
 *  BLOCKING  — 正向阻断：器件截止，灰暗静态，A-K 之间无电流
 *  TRIGGERING— 触发中：门极脉冲注入瞬间，蓝紫色触发闪光（200ms）
 *  ON        — 导通保持：橙红辉光 + PNPN 层级联导通动画（呼吸 0.9s）
 *  RECOVERY  — 恢复中：关断后反向恢复期，蓝色淡出（300ms）
 *
 * ── 动画效果 ──────────────────────────────────────────────────
 *
 *  正向阻断：静态黑色 TO-220 封装，散热片金属质感
 *  门极触发：G 极出现蓝紫色脉冲光晕，PNPN 层从 P2/N1 开始级联点亮
 *  导通保持：A-K 橙红导通光晕（呼吸），四层 PNPN 依次流光，散热片微红
 *  关断恢复：辉光渐灭，PNPN 层依次熄灭，蓝色淡出
 *
 * ── 端口 ─────────────────────────────────────────────────────
 *  anode   — 阳极 A（左引脚）
 *  cathode — 阴极 K（中引脚）
 *  gate    — 门极 G（右引脚，触发端）
 */
export class Thyristor extends BaseComponent {

    // ── 工作状态枚举 ─────────────────────────
    static STATE = {
        BLOCKING:   'blocking',    // 正向阻断
        TRIGGERING: 'triggering',  // 门极触发中
        ON:         'on',          // 导通保持
        RECOVERY:   'recovery',    // 关断恢复
    };

    constructor(config, sys) {
        super(config, sys);

        this.width  = Math.max(160, config.width  || 200);
        this.height = Math.max(200, config.height || 260);

        this.type    = 'thyristor';
        this.special = 'none';
        this.cache   = 'fixed';

        this._initGroups();
        // ── 额定参数 ──
        this.label       = config.label       || 'SCR';
        this.vdrm        = config.vdrm        || 600;    // V 重复峰值断态电压
        this.itRms       = config.itRms       || 25;     // A 额定通态电流（RMS）
        this.igt         = config.igt         || 5;      // mA 门极触发电流
        this.vgt         = config.vgt         || 1.5;    // V 门极触发电压
        this.vt          = config.vt          || 1.2;    // V 导通管压降
        this.tq          = config.tq          || 35;     // μs 关断时间

        // ── 状态 ──
        const initState     = config.initState || Thyristor.STATE.BLOCKING;
        this._state         = initState;
        this._prevState     = initState;
        this._animating     = false;
        this._animT         = 0;
        this._animDur       = 0.20;               // s 通用过渡时长
        this._triggerDur    = 0.20;               // s 触发闪光持续
        this._recoveryDur   = 0.30;               // s 恢复期时长
        this._breathT       = 0;
        this._breathSpeed   = 2 * Math.PI / 0.9; // rad/s
        this._flowT         = 0;                  // PNPN 流光动画相位
        this._flowSpeed     = 4.0;                // 流光速度
        this._glowIntensity = 0;                  // 主辉光强度 0~1
        this._triggerFlash  = 0;                  // 触发闪光强度 0~1
        this._layerPhase    = [0, 0, 0, 0];       // 四层 PNPN 各自亮度

        // ── 几何尺寸（TO-220 封装）──
        const W = this.width, H = this.height;

        // 散热片
        this._tabW   = W * 0.80;
        this._tabH   = H * 0.22;
        this._tabX   = W * 0.10;
        this._tabY   = H * 0.06;

        // 散热片安装孔
        this._holeR  = this._tabH * 0.25;
        this._holeCx = this._tabX + this._tabW / 2;
        this._holeCy = this._tabY + this._tabH / 2;

        // 塑料封装体
        this._pkgW   = W * 0.66;
        this._pkgH   = H * 0.34;
        this._pkgX   = W * 0.17;
        this._pkgY   = this._tabY + this._tabH - 2;

        // 封装体中心
        this._cx     = this._pkgX + this._pkgW / 2;
        this._cy     = this._pkgY + this._pkgH / 2;

        // PNPN 四层（在封装体内部水平排列）
        this._layerW = this._pkgW * 0.13;
        this._layerH = this._pkgH * 0.42;
        this._layerGap = this._pkgW * 0.025;
        const totalLayerW = 4 * this._layerW + 3 * this._layerGap;
        this._layerStartX = this._cx - totalLayerW / 2;
        this._layerCY     = this._cy + this._pkgH * 0.04;

        // 引脚几何（三脚，向下伸出）
        this._pinH   = H * 0.30;
        this._pinW   = W * 0.028;
        this._pinPitch = this._pkgW * 0.30; // 引脚间距
        this._aCX    = this._cx - this._pinPitch;   // 阳极 X
        this._kCX    = this._cx;                    // 阴极 X（中间）
        this._gCX    = this._cx + this._pinPitch;   // 门极 X
        this._pinTopY = this._pkgY + this._pkgH;

        // 电路符号区
        this._symY   = this._pkgY + this._pkgH + this._pinH + H * 0.04;


        this._init();

        // ── 端口 ──
        const portY = this._pinTopY + this._pinH + 4;
        this.addPort(this._aCX, portY, 'anode',   'wire', 'A');
        this.addPort(this._kCX, portY, 'cathode', 'wire', 'K');
        this.addPort(this._gCX, portY, 'gate',    'wire', 'G');
    }

    // ═══════════════════════════════════════════
    _init() {
        this._drawGlowLayer();         // 辉光（动态，底层）
        this._drawHeatTab();           // 散热片
        this._drawPackage();           // 塑料封装体
        this._drawPnpnLayers();        // PNPN 四层（静态底图）
        this._drawPnpnOverlay();       // PNPN 动态叠加层
        this._drawSchematicSymbol();   // 电路符号
        this._drawPins();              // 三条引脚
        this._drawPinLabels();         // 引脚标注
        this._drawLabel();             // 位号
        this._drawStatusIndicator();   // 状态指示
        
    }

    // ── 辉光层（底层，动态）─────────────────
    _drawGlowLayer() {
        this._glowGroup = new Konva.Group();
        this._staticGroup.add(this._glowGroup);
        this._rebuildGlow();
    }

    _rebuildGlow() {
        this._glowGroup.destroyChildren();
        const gi = this._glowIntensity;
        const tf = this._triggerFlash;

        // 导通辉光（橙红，A-K 方向）
        if (gi > 0.01) {
            this._glowGroup.add(new Konva.Ellipse({
                x: this._cx, y: this._cy + this._pkgH * 0.10,
                radiusX: this._pkgW * 0.55 * gi,
                radiusY: this._pkgH * 0.55 * gi,
                fillRadialGradientStartPoint:  { x: 0, y: 0 },
                fillRadialGradientEndPoint:    { x: 0, y: 0 },
                fillRadialGradientStartRadius: 0,
                fillRadialGradientEndRadius:   this._pkgH * 0.55,
                fillRadialGradientColorStops:  [
                    0,   this._rgba('#ff8830', 0.50 * gi),
                    0.4, this._rgba('#ff5500', 0.22 * gi),
                    1,   this._rgba('#ff4400', 0),
                ],
            }));

            // 散热片微红（导通发热）
            this._glowGroup.add(new Konva.Rect({
                x: this._tabX, y: this._tabY,
                width: this._tabW, height: this._tabH,
                fill: this._rgba('#ff4800', 0.10 * gi),
                cornerRadius: 3,
            }));
        }

        // 门极触发闪光（蓝紫色）
        if (tf > 0.01) {
            const gx = this._gCX, gy = this._cy;
            const fr = this._pkgH * 0.35 * tf;
            this._glowGroup.add(new Konva.Circle({
                x: gx, y: gy, radius: fr,
                fillRadialGradientStartPoint:  { x: 0, y: 0 },
                fillRadialGradientEndPoint:    { x: 0, y: 0 },
                fillRadialGradientStartRadius: 0,
                fillRadialGradientEndRadius:   fr,
                fillRadialGradientColorStops:  [
                    0,   this._rgba('#c080ff', 0.70 * tf),
                    0.4, this._rgba('#8040ff', 0.30 * tf),
                    1,   this._rgba('#6020ff', 0),
                ],
            }));
        }
    }

    // ── 散热片（TO-220 Metal Tab）────────────
    _drawHeatTab() {
        const tx = this._tabX, ty = this._tabY;
        const tw = this._tabW, th = this._tabH;

        // 散热片主体（铝银色渐变）
        this._staticGroup.add(new Konva.Rect({
            x: tx, y: ty, width: tw, height: th,
            fillLinearGradientStartPoint: { x: 0,  y: 0  },
            fillLinearGradientEndPoint:   { x: tw, y: th },
            fillLinearGradientColorStops: [
                0,   '#8a9098',
                0.2, '#c8ced4',
                0.45,'#e0e6ea',
                0.6, '#c0c8ce',
                0.8, '#9aa0a8',
                1,   '#7a8088',
            ],
            stroke: '#606870', strokeWidth: 1.0,
            cornerRadius: [3, 3, 0, 0],
            shadowColor: '#000', shadowBlur: 4, shadowOffsetY: 1, shadowOpacity: 0.25,
        }));

        // 散热片顶部高光
        this._staticGroup.add(new Konva.Rect({
            x: tx + 2, y: ty + 2, width: tw - 4, height: th * 0.18,
            fill: 'rgba(255,255,255,0.20)', cornerRadius: [3, 3, 0, 0],
        }));

        // 安装孔
        const hx = this._holeCx, hy = this._holeCy, hr = this._holeR;
        this._staticGroup.add(new Konva.Circle({
            x: hx, y: hy, radius: hr,
            fill: '#48505a', stroke: '#383e46', strokeWidth: 0.8,
        }));
        // 孔内环（金属质感）
        this._staticGroup.add(new Konva.Circle({
            x: hx, y: hy, radius: hr * 0.55,
            fill: '#2c3238', stroke: '#505860', strokeWidth: 0.6,
        }));
        // 孔高光
        this._staticGroup.add(new Konva.Arc({
            x: hx - hr * 0.25, y: hy - hr * 0.25,
            innerRadius: 0, outerRadius: hr * 0.20,
            angle: 180, rotation: 45,
            fill: 'rgba(255,255,255,0.25)',
        }));

        // 散热片纹理线条（模拟拉丝铝）
        for (let i = 1; i < 5; i++) {
            this._staticGroup.add(new Konva.Line({
                points: [tx + 2, ty + th * (i / 5), tx + tw - 2, ty + th * (i / 5)],
                stroke: 'rgba(255,255,255,0.06)', strokeWidth: 0.5,
            }));
        }
    }

    // ── 塑料封装体 ───────────────────────────
    _drawPackage() {
        const px = this._pkgX, py = this._pkgY;
        const pw = this._pkgW, ph = this._pkgH;

        // 封装主体（黑色环氧，底部圆角）
        this._staticGroup.add(new Konva.Rect({
            x: px, y: py, width: pw, height: ph,
            fillLinearGradientStartPoint: { x: 0,  y: 0  },
            fillLinearGradientEndPoint:   { x: pw, y: ph },
            fillLinearGradientColorStops: [
                0, '#282830', 0.4, '#1c1c24', 0.6, '#1c1c24', 1, '#242428',
            ],
            stroke: '#38383e', strokeWidth: 1.0,
            cornerRadius: [0, 0, 3, 3],
        }));

        // 封装顶部高光（贴近散热片处）
        this._staticGroup.add(new Konva.Rect({
            x: px + 2, y: py + 1, width: pw - 4, height: ph * 0.07,
            fill: 'rgba(255,255,255,0.06)', cornerRadius: [0, 0, 0, 0],
        }));

        // 侧面反光线
        this._staticGroup.add(new Konva.Line({
            points: [px + 2, py + 4, px + 2, py + ph - 4],
            stroke: 'rgba(255,255,255,0.08)', strokeWidth: 1.2, lineCap: 'round',
        }));
        this._staticGroup.add(new Konva.Line({
            points: [px + pw - 2, py + 4, px + pw - 2, py + ph - 4],
            stroke: 'rgba(0,0,0,0.25)', strokeWidth: 1.2, lineCap: 'round',
        }));

        // 型号丝印
        this._staticGroup.add(new Konva.Text({
            x: px, y: py + ph * 0.12,
            width: pw, text: this.label,
            fontSize: Math.max(9, pw * 0.12), fontStyle: 'bold',
            fill: '#c8d0d8', align: 'center',
        }));

        // 参数丝印
        this._staticGroup.add(new Konva.Text({
            x: px, y: py + ph * 0.30,
            width: pw,
            text: `${this.vdrm}V / ${this.itRms}A`,
            fontSize: 8, fill: '#7a8590', align: 'center',
        }));
    }

    // ── PNPN 四层结构（静态底图）────────────
    _drawPnpnLayers() {
        this._layerRects = [];
        const labels = ['P1', 'N1', 'P2', 'N2'];
        const baseFills = [
            '#6a2828',   // P1（阳极层，深红）
            '#28386a',   // N1（深蓝）
            '#6a3a20',   // P2（门极层，深橙）
            '#1e4a28',   // N2（阴极层，深绿）
        ];
        const dimColors = ['#3a1818', '#182038', '#3a2010', '#102818'];

        for (let i = 0; i < 4; i++) {
            const lx = this._layerStartX + i * (this._layerW + this._layerGap);
            const ly = this._layerCY - this._layerH / 2;

            // 层主体
            const rect = new Konva.Rect({
                x: lx, y: ly,
                width: this._layerW, height: this._layerH,
                fill: dimColors[i],
                stroke: '#404048', strokeWidth: 0.6,
                cornerRadius: 1,
            });
            this._staticGroup.add(rect);
            this._layerRects.push({ rect, baseFill: baseFills[i], dimFill: dimColors[i] });

            // 层标注
            this._staticGroup.add(new Konva.Text({
                x: lx, y: ly + this._layerH + 3,
                width: this._layerW, text: labels[i],
                fontSize: 7.5, fontStyle: 'bold',
                fill: '#546e7a', align: 'center',
            }));
        }

        // 结界面竖线（3 个 PN 结）
        for (let i = 1; i < 4; i++) {
            const jx = this._layerStartX + i * (this._layerW + this._layerGap) - this._layerGap / 2;
            this._staticGroup.add(new Konva.Line({
                points: [jx, this._layerCY - this._layerH/2 - 2, jx, this._layerCY + this._layerH/2 + 2],
                stroke: '#505860', strokeWidth: 0.8, dash: [2, 2],
            }));
        }

        // 结名称（J1, J2, J3）
        const jLabels = ['J1', 'J2', 'J3'];
        for (let i = 0; i < 3; i++) {
            const jx = this._layerStartX + (i + 1) * (this._layerW + this._layerGap) - this._layerGap / 2;
            this._staticGroup.add(new Konva.Text({
                x: jx - 7, y: this._layerCY - this._layerH / 2 - 12,
                text: jLabels[i], fontSize: 6.5, fill: '#455a64',
            }));
        }

        // PNPN 标注
        this._staticGroup.add(new Konva.Text({
            x: this._pkgX, y: this._layerCY - this._layerH / 2 - 20,
            width: this._pkgW, text: '─── PNPN ───',
            fontSize: 7, fill: '#455a64', align: 'center',
        }));
    }

    // ── PNPN 动态叠加层 ──────────────────────
    _drawPnpnOverlay() {
        this._pnpnOverlayGroup = new Konva.Group();
        this._staticGroup.add(this._pnpnOverlayGroup);
        this._rebuildPnpnOverlay();
    }

    _rebuildPnpnOverlay() {
        this._pnpnOverlayGroup.destroyChildren();

        const gi = this._glowIntensity;
        const tf = this._triggerFlash;
        if (gi <= 0.01 && tf <= 0.01) return;

        const litColors = [
            '#ff7040',   // P1 导通色（橙红）
            '#4080ff',   // N1 导通色（蓝）
            '#ff9030',   // P2 导通色（橙，门极层）
            '#40c060',   // N2 导通色（绿，阴极层）
        ];

        // 导通保持时：四层全亮（相位差流光）
        // 触发时：从 P2/N1 开始向两侧级联
        for (let i = 0; i < 4; i++) {
            const lx = this._layerStartX + i * (this._layerW + this._layerGap);
            const ly = this._layerCY - this._layerH / 2;

            let alpha = 0;
            if (gi > 0.01) {
                // 导通：流光相位（从 A 极向 K 极传播）
                const phaseOffset = i * (Math.PI / 2);
                const wave = 0.55 + 0.45 * Math.sin(this._flowT + phaseOffset);
                alpha = wave * gi;
            } else if (tf > 0.01) {
                // 触发瞬间：P2(i=2)先亮，然后向两侧扩散
                const dist = Math.abs(i - 1.5);  // 距中心距离
                const delay = dist * 0.3;
                const adjusted = Math.max(0, tf - delay);
                alpha = adjusted * 0.80;
            }

            if (alpha > 0.02) {
                this._pnpnOverlayGroup.add(new Konva.Rect({
                    x: lx, y: ly,
                    width: this._layerW, height: this._layerH,
                    fill: this._rgba(litColors[i], Math.min(1, alpha)),
                    cornerRadius: 1,
                }));
                // 层内高光粒子
                this._pnpnOverlayGroup.add(new Konva.Ellipse({
                    x: lx + this._layerW / 2,
                    y: ly + this._layerH * 0.35,
                    radiusX: this._layerW * 0.30,
                    radiusY: this._layerH * 0.18,
                    fill: this._rgba('#ffffff', alpha * 0.35),
                }));
            }
        }
    }

    // ── 电路符号（底部参考）─────────────────
    _drawSchematicSymbol() {
        const W   = this.width;
        const sy  = this._symY;
        const cx  = this._cx;
        const r   = Math.min(W * 0.10, 18);
        const lw  = 1.3;
        const col = '#78909c';

        // 背景虚线框
        this._staticGroup.add(new Konva.Rect({
            x: W * 0.06, y: sy - r * 1.8,
            width: W * 0.88, height: r * 3.6,
            stroke: '#37474f', strokeWidth: 0.6,
            dash: [3, 3], cornerRadius: 3,
            fill: 'rgba(255,255,255,0.02)',
        }));

        // ── 二极管三角形（A → K 方向，向右）──
        // 左侧水平引线（A 端）
        this._staticGroup.add(new Konva.Line({
            points: [W * 0.08, sy, cx - r, sy],
            stroke: col, strokeWidth: lw, lineCap: 'round',
        }));
        // 三角形（箭头朝右）
        this._staticGroup.add(new Konva.Line({
            points: [cx - r, sy - r, cx - r, sy + r, cx + r * 0.5, sy, cx - r, sy - r],
            closed: true,
            fill: this._rgba('#607d8b', 0.20),
            stroke: col, strokeWidth: lw,
        }));
        // 阴极竖线
        this._staticGroup.add(new Konva.Line({
            points: [cx + r * 0.5, sy - r, cx + r * 0.5, sy + r],
            stroke: col, strokeWidth: lw + 0.5, lineCap: 'round',
        }));
        // 右侧水平引线（K 端）
        this._staticGroup.add(new Konva.Line({
            points: [cx + r * 0.5, sy, W * 0.60, sy],
            stroke: col, strokeWidth: lw, lineCap: 'round',
        }));

        // ── 门极引线（G，从三角形下顶点引出）──
        const gateSymX = cx - r + (r * 1.5) * 0.5;  // 三角形中部 X
        const gateSymY = sy + r;                      // 三角形下顶点
        this._staticGroup.add(new Konva.Line({
            points: [gateSymX, gateSymY, gateSymX, sy + r * 1.80, W * 0.78, sy + r * 1.80],
            stroke: col, strokeWidth: lw, lineCap: 'round', lineJoin: 'round',
        }));

        // ── 符号标注 A / K / G ──
        this._staticGroup.add(new Konva.Text({ x: W * 0.08, y: sy - 12,
            text: 'A', fontSize: 8, fontStyle: 'bold', fill: '#ef9a9a' }));
        this._staticGroup.add(new Konva.Text({ x: W * 0.56, y: sy - 12,
            text: 'K', fontSize: 8, fontStyle: 'bold', fill: '#90caf9' }));
        this._staticGroup.add(new Konva.Text({ x: W * 0.79, y: sy + r * 1.60,
            text: 'G', fontSize: 8, fontStyle: 'bold', fill: '#ce93d8' }));

        // 符号说明
        this._staticGroup.add(new Konva.Text({
            x: W * 0.06, y: sy + r * 2.0,
            width: W * 0.88, text: 'SCR Symbol',
            fontSize: 7, fill: '#455a64', align: 'center',
        }));

        // 参数标注
        this._staticGroup.add(new Konva.Text({
            x: W * 0.06, y: sy - r * 1.75,
            text: `Vt=${this.vt}V  Igt=${this.igt}mA  Tq=${this.tq}μs`,
            fontSize: 7, fill: '#546e7a',
        }));
    }

    // ── 三条引脚 ─────────────────────────────
    _drawPins() {
        const topY   = this._pinTopY;
        const pinH   = this._pinH;
        const pW     = this._pinW;
        const pinBotY = topY + pinH;

        const pinDefs = [
            { x: this._aCX, color: '#d4785a', name: 'A' },  // 阳极（橙红）
            { x: this._kCX, color: '#90a4ae', name: 'K' },  // 阴极（银白）
            { x: this._gCX, color: '#ba80d0', name: 'G' },  // 门极（紫，细）
        ];

        pinDefs.forEach(({ x, color }, idx) => {
            const w = idx === 2 ? pW * 0.75 : pW;  // 门极引脚稍细

            this._staticGroup.add(new Konva.Rect({
                x: x - w/2, y: topY,
                width: w, height: pinH,
                fillLinearGradientStartPoint: { x: -w, y: 0 },
                fillLinearGradientEndPoint:   { x:  w, y: 0 },
                fillLinearGradientColorStops: [
                    0, this._darken(color, 0.3),
                    0.5, this._lighten(color, 0.2),
                    1, this._darken(color, 0.3),
                ],
                stroke: this._darken(color, 0.2), strokeWidth: 0.4,
            }));

            // 引脚末端焊点
            this._staticGroup.add(new Konva.Circle({
                x, y: pinBotY + 2,
                radius: w * 1.3,
                fill: '#b8bcc0', stroke: '#8a8e92', strokeWidth: 0.5,
            }));
        });

        // 封装体与引脚间的矩形过渡块（斜肩）
        this._staticGroup.add(new Konva.Line({
            points: [
                this._pkgX + this._pkgW * 0.10, topY,
                this._aCX - pW, topY,
                this._aCX - pW, topY + 8,
                this._pkgX + this._pkgW * 0.10, topY + 8,
            ],
            closed: true,
            fill: '#1e1e26', stroke: '#38383e', strokeWidth: 0.6,
        }));
        this._staticGroup.add(new Konva.Line({
            points: [
                this._gCX + pW, topY,
                this._pkgX + this._pkgW * 0.90, topY,
                this._pkgX + this._pkgW * 0.90, topY + 8,
                this._gCX + pW, topY + 8,
            ],
            closed: true,
            fill: '#1e1e26', stroke: '#38383e', strokeWidth: 0.6,
        }));
    }

    // ── 引脚标注 ─────────────────────────────
    _drawPinLabels() {
        const botY = this._pinTopY + this._pinH + 6;
        [
            { x: this._aCX, text: 'A', color: '#ef9a9a' },
            { x: this._kCX, text: 'K', color: '#90caf9' },
            { x: this._gCX, text: 'G', color: '#ce93d8' },
        ].forEach(({ x, text, color }) => {
            this._staticGroup.add(new Konva.Text({
                x: x - 6, y: botY,
                text, fontSize: 9, fontStyle: 'bold', fill: color,
            }));
        });
    }

    // ── 位号标注 ─────────────────────────────
    _drawLabel() {
        this._staticGroup.add(new Konva.Text({
            x: 0, y: -16, width: this.width,
            text: `${this.label}  ${this.vdrm}V / ${this.itRms}A`,
            fontSize: 9, fontStyle: 'bold', fill: '#546e7a', align: 'center',
        }));
    }

    // ── 状态指示 ─────────────────────────────
    _drawStatusIndicator() {
        const ix = this._pkgX + this._pkgW * 0.68;
        const iy = this._pkgY + this._pkgH * 0.72;
        const style = this._getStatusStyle();

        this._statusDot = new Konva.Circle({
            x: ix, y: iy, radius: 4,
            fill: style.dotFill, stroke: style.dotStroke, strokeWidth: 0.8,
            shadowColor: style.shadow, shadowBlur: style.blur, shadowOpacity: 0.9,
        });
        this._statusText = new Konva.Text({
            x: ix - 26, y: iy + 6,
            text: style.label, fontSize: 7.5, fontStyle: 'bold',
            fill: style.dotFill, align: 'right', width: 24,
        });
        this._staticGroup.add(this._statusDot, this._statusText);
    }

    _getStatusStyle() {
        switch (this._state) {
            case Thyristor.STATE.ON:
                return { dotFill:'#ff8030', dotStroke:'#cc5010',
                         shadow:'#ff8030', blur:7, label:'导通' };
            case Thyristor.STATE.TRIGGERING:
                return { dotFill:'#b060ff', dotStroke:'#7030cc',
                         shadow:'#b060ff', blur:8, label:'触发' };
            case Thyristor.STATE.RECOVERY:
                return { dotFill:'#4090ff', dotStroke:'#2060cc',
                         shadow:'#4090ff', blur:5, label:'恢复' };
            default:
                return { dotFill:'#546e7a', dotStroke:'#37474f',
                         shadow:'transparent', blur:0, label:'阻断' };
        }
    }

    // ── 点击交互 ─────────────────────────────
    _bindInteraction() {
        // 点击封装体触发 / 关断
        this.group.getChildren().forEach(node => {
            if (node instanceof Konva.Rect &&
                Math.abs(node.width()  - this._pkgW) < 2 &&
                Math.abs(node.height() - this._pkgH) < 2) {
                node.on('click tap', () => {
                    if (this._state === Thyristor.STATE.BLOCKING) {
                        this.trigger();
                    } else if (this._state === Thyristor.STATE.ON) {
                        this.turnOff();
                    }
                });
                node.listening(true);
            }
        });
    }

    // ═══════════════════════════════════════════
    // 集中化 tick（由 consys._tickAll 在 20fps 调用）
    tick(dt) {
        this._tickAnimation(dt);
    
        this._refreshCache();
    }
    _tickAnimation(dt) {
        let dirty = false;

        // ── 触发状态（TRIGGERING → ON）──
        if (this._state === Thyristor.STATE.TRIGGERING) {
            this._animT += dt / this._triggerDur;
            const ease  = 0.5 - 0.5 * Math.cos(Math.min(1, this._animT) * Math.PI);
            this._triggerFlash  = ease;
            this._glowIntensity = ease * 0.5;
            if (this._animT >= 1) {
                this._animT       = 0;
                this._triggerFlash = 0;
                this._state        = Thyristor.STATE.ON;
                this._glowIntensity = 1.0;
                this._breathT      = 0;
            }
            dirty = true;
        }

        // ── 导通保持（ON）──
        if (this._state === Thyristor.STATE.ON) {
            this._breathT += dt * this._breathSpeed;
            if (this._breathT > 2 * Math.PI) this._breathT -= 2 * Math.PI;
            this._glowIntensity = 0.70 + 0.30 * Math.sin(this._breathT);

            this._flowT += dt * this._flowSpeed;
            if (this._flowT > 2 * Math.PI) this._flowT -= 2 * Math.PI;
            dirty = true;
        }

        // ── 恢复（RECOVERY → BLOCKING）──
        if (this._state === Thyristor.STATE.RECOVERY) {
            this._animT += dt / this._recoveryDur;
            const fade = 1 - Math.min(1, this._animT);
            const ease = 0.5 - 0.5 * Math.cos(Math.min(1, this._animT) * Math.PI);
            this._glowIntensity = (1 - ease) * 0.6;
            this._triggerFlash  = ease * 0.3;

            if (this._animT >= 1) {
                this._state         = Thyristor.STATE.BLOCKING;
                this._glowIntensity = 0;
                this._triggerFlash  = 0;
                this._animT         = 0;
            }
            dirty = true;
        }

        // ── 阻断（BLOCKING）确保归零 ──
        if (this._state === Thyristor.STATE.BLOCKING) {
            if (this._glowIntensity > 0 || this._triggerFlash > 0) {
                this._glowIntensity = 0;
                this._triggerFlash  = 0;
                dirty = true;
            }
        }

        if (dirty) {
            this._rebuildGlow();
            this._rebuildPnpnOverlay();
            this._updateStatus();
            this._refreshCache();
        }
    }

    _updateStatus() {
        const style = this._getStatusStyle();
        if (this._statusDot) {
            this._statusDot.fill(style.dotFill);
            this._statusDot.stroke(style.dotStroke);
            this._statusDot.shadowColor(style.shadow);
            this._statusDot.shadowBlur(style.blur);
        }
        if (this._statusText) {
            this._statusText.text(style.label);
            this._statusText.fill(style.dotFill);
        }
    }

    // ═══════════════════════════════════════════
    /** 门极触发（正向阻断 → 触发 → 导通） */
    trigger() {
        if (this._state !== Thyristor.STATE.BLOCKING) return;
        this._state  = Thyristor.STATE.TRIGGERING;
        this._animT  = 0;
        this._flowT  = 0;
        this._refreshCache();
    }

    /** 强迫关断（导通 → 恢复 → 阻断） */
    turnOff() {
        if (this._state !== Thyristor.STATE.ON) return;
        this._state  = Thyristor.STATE.RECOVERY;
        this._animT  = 0;
        this._refreshCache();
    }

    /** 直接置为阻断状态（仿真复位） */
    reset() {
        this._state         = Thyristor.STATE.BLOCKING;
        this._glowIntensity = 0;
        this._triggerFlash  = 0;
        this._animT         = 0;
        this._refreshCache();
    }

    isOn()          { return this._state === Thyristor.STATE.ON;         }
    isBlocking()    { return this._state === Thyristor.STATE.BLOCKING;   }
    isTriggering()  { return this._state === Thyristor.STATE.TRIGGERING; }
    isRecovering()  { return this._state === Thyristor.STATE.RECOVERY;   }
    getState()      { return this._state; }

    update(state) {
        if (typeof state === 'boolean') {
            state ? this.trigger() : this.turnOff();
        } else if (typeof state === 'string') {
            if (state === 'trigger') this.trigger();
            else if (state === 'off') this.turnOff();
            else if (state === 'reset') this.reset();
        }
        this._refreshCache();
    }

    getConfigFields() {
        return [
            { label: '型号/位号',           key: 'label',     type: 'text'   },
            { label: '断态重复峰值电压 (V)', key: 'vdrm',     type: 'number' },
            { label: '通态电流 RMS (A)',     key: 'itRms',    type: 'number' },
            { label: '门极触发电流 (mA)',    key: 'igt',      type: 'number' },
            { label: '门极触发电压 (V)',     key: 'vgt',      type: 'number' },
            { label: '导通管压降 (V)',       key: 'vt',       type: 'number' },
            { label: '关断时间 (μs)',        key: 'tq',       type: 'number' },
        ];
    }

    onConfigUpdate(cfg) {
        this.label  = cfg.label  || this.label;
        this.vdrm   = parseFloat(cfg.vdrm)  || this.vdrm;
        this.itRms  = parseFloat(cfg.itRms) || this.itRms;
        this.igt    = parseFloat(cfg.igt)   || this.igt;
        this.vgt    = parseFloat(cfg.vgt)   || this.vgt;
        this.vt     = parseFloat(cfg.vt)    || this.vt;
        this.tq     = parseFloat(cfg.tq)    || this.tq;
        this.config = { ...this.config, ...cfg };
        this._refreshCache();
    }

    destroy() {
        super.destroy?.();
    }

    // ── 颜色工具 ─────────────────────────────
    _rgba(hex, alpha) {
        const h = hex.replace('#', '');
        const r = parseInt(h.substring(0, 2), 16);
        const g = parseInt(h.substring(2, 4), 16);
        const b = parseInt(h.substring(4, 6), 16);
        return `rgba(${r},${g},${b},${(+alpha).toFixed(3)})`;
    }
    _lighten(hex, a) { return this._adjustBrightness(hex,  a); }
    _darken (hex, a) { return this._adjustBrightness(hex, -a); }
    _adjustBrightness(hex, a) {
        const h = hex.replace('#', '');
        return '#' + [0, 2, 4].map(i => {
            const v = Math.min(255, Math.max(0, Math.round(parseInt(h.substring(i, i+2), 16) + 255*a)));
            return v.toString(16).padStart(2, '0');
        }).join('');
    }
}