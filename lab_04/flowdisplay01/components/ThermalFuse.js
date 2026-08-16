import { BaseComponent } from './BaseComponent.js';

/**
 * 温度保险丝仿真组件
 * （Thermal Fuse / Temperature Fuse / Thermal Cutoff, TCO）
 *
 * ── 结构说明 ──────────────────────────────────────────────────
 *
 *  温度保险丝（TCO）是一种一次性超温保护器件，当被测点温度
 *  超过额定动作温度 Tf 时，内部低熔点合金熔断，电路永久断开。
 *  与温度继电器的本质区别：不可复位，动作后必须更换。
 *
 *  常见型号：RY 系列（轴向引线）、BW 系列（表贴）
 *  本仿真对象为轴向引线圆柱形温度保险丝，由以下部分组成：
 *
 *  1. 外壳（Shell）
 *     铝合金圆柱体，直径约 φ8~10mm，长约 16~25mm
 *     银白色金属外观，两端压接铜引线
 *
 *  2. 低熔点合金丝（Fusible Alloy Element）— 核心感温/熔断元件
 *     由铋（Bi）、铅（Pb）、锡（Sn）、铟（In）等金属按比例配制
 *     的低熔点合金丝，缠绕在陶瓷芯棒上，通过端子与引脚连通
 *     - 典型动作温度 Tf：72°C / 77°C / 84°C / 94°C / 121°C /
 *       130°C / 152°C / 169°C / 192°C / 216°C / 240°C（可配置）
 *     - 熔断后合金丝收缩断裂，两端完全分离
 *     - 分断能力：最大 10A / 250V AC
 *
 *  3. 弹簧压片（Spring Contact）
 *     预压弹簧，正常工作时将合金丝两端压紧保持导通；
 *     合金熔断后，弹簧弹开，确保断路间隙 ≥ 0.5mm，防止重新导通
 *
 *  4. 有机硅脂（Thermal Grease / Silicone）
 *     填充合金丝与外壳之间的空隙，改善热传导，
 *     加速感温元件响应速度
 *
 *  5. 引脚（Leads）：两端轴向引线（A 端 / B 端），
 *     镀锡铜芯，线径约 φ0.5mm，适合穿板直插
 *
 * ── 动作逻辑（不可逆）────────────────────────────────────────
 *
 *  正常状态（T < Tf）：
 *    合金丝完好，弹簧预压，A-B 导通，电阻 < 100 mΩ
 *
 *  临界状态（Tf - 5°C ≤ T < Tf）：
 *    合金丝开始软化，颜色由银白→橙黄，仿真显示"预警"
 *
 *  熔断动作（T ≥ Tf）：
 *    ① 合金丝迅速熔化（200ms 动画）
 *    ② 弹簧弹开，断路间隙形成
 *    ③ 熔断区域出现熔珠，两段残丝向两端收缩
 *    ④ 电路永久断开，状态指示变红"熔断"
 *    ⑤ 此后无论温度如何变化，电路保持断开（不可复位）
 *    ⑥ 管体标记色环变为黑色（表示已熔断）
 *
 *  仿真特殊处理：
 *    点击"更换"按钮（或调用 replace()）可恢复初始状态，
 *    模拟更换新保险丝的过程（500ms 动画）
 *
 * ── 视角说明 ──────────────────────────────────────────────────
 *
 *  正视图（Front View），轴向水平布局，左端 A 引线，右端 B 引线。
 *  外壳做成半剖视图：左半为金属外壳（不透明），
 *  右半为内部剖视（半透明，展示合金丝 + 弹簧结构）。
 *
 * ── 端口 ─────────────────────────────────────────────────────
 *  terminal_a — A 端（左引线末端）
 *  terminal_b — B 端（右引线末端）
 */
export class ThermalFuse extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.width  = Math.max(180, config.width  || 220);
        this.height = Math.max(110, config.height || 140);

        this.type    = 'thermal_fuse';
        this.special = 'none';
        this.cache   = 'fixed';

        this._initGroups();
        // ── 额定参数 ──
        this.label      = config.label    || 'FU';   // 位号
        this.tf         = config.tf       || 121;    // °C，额定动作温度
        this.ratedV     = config.ratedV   || 250;    // V
        this.ratedI     = config.ratedI   || 10;     // A

        // ── 状态 ──
        // _intact: true=合金丝完好，false=已熔断（不可复位）
        this._intact    = config.initIntact !== false; // 默认完好
        this._blown     = !this._intact;               // 已熔断标记

        // 当前仿真温度
        this._temp      = config.initTemp || 25;       // °C

        // 熔断动画
        this._animating = false;
        this._animT     = 0;
        this._animDir   = 1;     // +1=熔断过程，-1=更换恢复过程
        this._animDur   = 0.20;  // s，熔断动画时长

        // 温度平滑过渡
        this._tempAnimating = false;
        this._tempFrom      = this._temp;
        this._tempTo        = this._temp;
        this._tempAnimT     = 0;
        this._tempAnimDur   = 0.55;  // s

        // 熔断视觉进度（0=完好，1=完全熔断）
        this._blowFrac  = this._blown ? 1 : 0;

        // 熔珠粒子（{ x, y, r, alpha, vx, vy }）
        this._droplets  = [];
        this._dropTimer = 0;

        // 操作计数
        this.opsCount   = config.initOps || 0;


        // ── 几何尺寸（相对 width/height）──
        const W = this.width, H = this.height;

        // 金属外壳（水平圆柱体，居中）
        this._bodyX  = W * 0.20;
        this._bodyY  = H * 0.22;
        this._bodyW  = W * 0.60;
        this._bodyH  = H * 0.42;
        this._bodyCy = this._bodyY + this._bodyH / 2;

        // 引线参数
        this._leadLen = W * 0.19;           // 引线长度（两侧各一段）
        this._leadW   = H * 0.040;          // 引线直径（像素）
        this._leadAX  = this._bodyX;        // A 端引线右端（接外壳）
        this._leadBX  = this._bodyX + this._bodyW; // B 端引线左端

        // 引线末端（端口位置）
        this._pinAX   = this._bodyX - this._leadLen;
        this._pinBX   = this._bodyX + this._bodyW + this._leadLen;
        this._pinY    = this._bodyCy;

        // 外壳内腔（剖视区域，右半部分）
        this._sectX   = this._bodyX + this._bodyW * 0.48;
        this._sectW   = this._bodyW * 0.50;

        // 合金丝路径（水平，外壳内轴线位置）
        this._wireY   = this._bodyCy;
        this._wireX0  = this._bodyX + this._bodyW * 0.06;   // 合金丝左锚点
        this._wireX1  = this._bodyX + this._bodyW * 0.94;   // 合金丝右锚点
        this._wireMidX= (this._wireX0 + this._wireX1) / 2;  // 熔断中心

        // 弹簧（位于合金丝两侧）
        this._springLX= this._wireX0;
        this._springRX= this._wireX1;
        this._springH = this._bodyH * 0.28;

        // 色环（外壳上，标识动作温度）
        this._ringX1  = this._bodyX + this._bodyW * 0.20;
        this._ringX2  = this._bodyX + this._bodyW * 0.28;
        this._ringX3  = this._bodyX + this._bodyW * 0.36;

        this._init();

        // 端口
        this.addPort(this._pinAX, this._pinY + this._bodyH / 2 + 4, 'terminal_a', 'wire', 'A');
        this.addPort(this._pinBX, this._pinY + this._bodyH / 2 + 4, 'terminal_b', 'wire', 'B');
    }

    // ═══════════════════════════════════════════
    _init() {
        this._drawLeads();              // 静态：两端引线
        this._drawShellBody();          // 静态：金属外壳（不透明主体）
        this._drawSectionBackground();  // 静态：剖视内腔背景
        this._drawSpring();             // 静态：弹簧压片（两侧）
        this._drawColorRings();         // 静态：色环（温度标识）
        this._drawFuseLayer();          // 动态层：合金丝 + 熔断动画 + 熔珠
        this._drawShellFront();         // 静态前景：外壳高光 + 端盖（覆盖动态层）
        this._drawReplaceButton();      // 静态：更换按钮
        this._drawLabel();
        this._drawStatusIndicator();
        
    }

    // ── 两端引线（镀锡铜丝）─────────────────────────────────
    _drawLeads() {
        const cy  = this._bodyCy;
        const lW  = this._leadW;

        // A 端引线（左侧）
        this._staticGroup.add(new Konva.Rect({
            x: this._pinAX, y: cy - lW / 2,
            width: this._leadLen, height: lW,
            fillLinearGradientStartPoint: { x: 0,             y: 0 },
            fillLinearGradientEndPoint:   { x: this._leadLen, y: 0 },
            fillLinearGradientColorStops: [
                0,   '#6a6a72',
                0.4, '#b8b8c2',
                0.6, '#cacad4',
                1,   '#8a8a94',
            ],
            stroke: '#505058', strokeWidth: 0.5,
        }));
        // B 端引线（右侧）
        this._staticGroup.add(new Konva.Rect({
            x: this._leadBX, y: cy - lW / 2,
            width: this._leadLen, height: lW,
            fillLinearGradientStartPoint: { x: 0,             y: 0 },
            fillLinearGradientEndPoint:   { x: this._leadLen, y: 0 },
            fillLinearGradientColorStops: [
                0,   '#8a8a94',
                0.4, '#cacad4',
                0.6, '#b8b8c2',
                1,   '#6a6a72',
            ],
            stroke: '#505058', strokeWidth: 0.5,
        }));
        // 引线末端圆头（剪切痕迹）
        [this._pinAX, this._pinBX].forEach(px => {
            this._staticGroup.add(new Konva.Circle({
                x: px, y: cy,
                radius: lW * 0.65,
                fill: '#7a7a84', stroke: '#505058', strokeWidth: 0.5,
            }));
        });
        // 端子标注
        this._staticGroup.add(new Konva.Text({
            x: this._pinAX - 5, y: cy + lW / 2 + 4,
            text: 'A', fontSize: 8, fontStyle: 'bold', fill: '#ef9a9a',
        }));
        this._staticGroup.add(new Konva.Text({
            x: this._pinBX + 1, y: cy + lW / 2 + 4,
            text: 'B', fontSize: 8, fontStyle: 'bold', fill: '#90caf9',
        }));
    }

    // ── 金属外壳主体（铝合金圆柱）──────────────────────────
    _drawShellBody() {
        const x = this._bodyX, y = this._bodyY;
        const w = this._bodyW, h = this._bodyH;

        // 阴影
        this._staticGroup.add(new Konva.Rect({
            x: x + 2, y: y + 4,
            width: w, height: h,
            fill: 'rgba(0,0,0,0.28)', cornerRadius: h * 0.28,
        }));
        // 外壳主体（铝合金银白渐变）
        this._staticGroup.add(new Konva.Rect({
            x, y, width: w, height: h,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint:   { x: 0, y: h },
            fillLinearGradientColorStops: [
                0,    'rgba(210,215,225,0.95)',
                0.15, 'rgba(235,240,248,0.95)',
                0.40, 'rgba(195,200,215,0.90)',
                0.60, 'rgba(175,180,198,0.88)',
                0.82, 'rgba(155,160,178,0.92)',
                1,    'rgba(120,125,145,0.95)',
            ],
            stroke: '#8a8fa8', strokeWidth: 1,
            cornerRadius: h * 0.28,
        }));
    }

    // ── 剖视内腔背景（右半部分深色底）──────────────────────
    _drawSectionBackground() {
        const x = this._sectX, y = this._bodyY + 2;
        const w = this._sectW, h = this._bodyH - 4;

        this._staticGroup.add(new Konva.Rect({
            x, y, width: w, height: h,
            fill: '#16181e',
            stroke: 'none',
            cornerRadius: [0, h * 0.26, h * 0.26, 0],
        }));
        // 剖视截面线（左侧分界）
        this._staticGroup.add(new Konva.Line({
            points: [x, y, x, y + h],
            stroke: '#3a3a48', strokeWidth: 0.8, dash: [4, 3],
        }));
        // 有机硅脂（淡黄色半透明填充，代表内部灌封）
        this._staticGroup.add(new Konva.Rect({
            x: x + 2, y: y + 2, width: w - 4, height: h - 4,
            fill: 'rgba(200,190,120,0.06)',
            cornerRadius: [0, h * 0.24, h * 0.24, 0],
        }));
        // 陶瓷芯棒（轴线附近细矩形）
        const coreH = h * 0.12;
        this._staticGroup.add(new Konva.Rect({
            x, y: this._bodyCy - coreH / 2,
            width: w, height: coreH,
            fill: 'rgba(200,190,170,0.22)',
            stroke: 'rgba(180,170,150,0.18)', strokeWidth: 0.5,
        }));
    }

    // ── 弹簧压片（两侧各一组，V 形弹片）───────────────────
    _drawSpring() {
        const cy = this._bodyCy;
        const sh = this._springH;

        // 左侧弹片（A 端内侧）
        this._drawOneSpring(this._springLX + this._bodyW * 0.04, cy, sh, true);
        // 右侧弹片（B 端内侧）
        this._drawOneSpring(this._springRX - this._bodyW * 0.04, cy, sh, false);
    }

    _drawOneSpring(cx, cy, sh, isLeft) {
        const w = this._bodyW * 0.06;
        const dir = isLeft ? 1 : -1;
        // 弹片本体（V 形折弯片簧）
        const pts = isLeft
            ? [cx, cy - sh / 2,  cx + w, cy,  cx, cy + sh / 2]
            : [cx, cy - sh / 2,  cx - w, cy,  cx, cy + sh / 2];
        this._staticGroup.add(new Konva.Line({
            points: pts,
            stroke: '#9a9aaa', strokeWidth: 1.5,
            lineCap: 'round', lineJoin: 'round',
        }));
        // 弹片端部小圆（接触点）
        [cy - sh / 2, cy + sh / 2].forEach(py => {
            this._staticGroup.add(new Konva.Circle({
                x: cx, y: py, radius: 1.5,
                fill: '#b0b0c0', stroke: '#808090', strokeWidth: 0.5,
            }));
        });
    }

    // ── 色环（标识额定动作温度）────────────────────────────
    _drawColorRings() {
        // 根据 tf 值取颜色编码（EIA 标准近似）
        const ringColors = this._tfToColors(this.tf);
        const y = this._bodyY + 1;
        const h = this._bodyH - 2;
        const rw = this._bodyW * 0.055;

        [this._ringX1, this._ringX2, this._ringX3].forEach((rx, i) => {
            this._staticGroup.add(new Konva.Rect({
                x: rx - rw / 2, y,
                width: rw, height: h,
                fill: ringColors[i] || '#888',
                opacity: 0.82,
            }));
        });
    }

    // 根据动作温度返回三条色环颜色（十位/个位/倍率，近似）
    _tfToColors(tf) {
        const colorMap = [
            '#1a1a1a', // 0 黑
            '#8B4513', // 1 棕
            '#c8382a', // 2 红
            '#e07020', // 3 橙
            '#d4c000', // 4 黄
            '#3a8a3a', // 5 绿
            '#2060c0', // 6 蓝
            '#8040a0', // 7 紫
            '#808080', // 8 灰
            '#e8e8e8', // 9 白
        ];
        const v   = Math.round(tf);
        const d1  = Math.floor(v / 10) % 10;
        const d2  = v % 10;
        const mul = v >= 100 ? 2 : 1;  // 倍率环：×10 红 / ×1 棕
        return [colorMap[d1], colorMap[d2], colorMap[mul]];
    }

    // ── 动态层：合金丝 + 熔断过程 + 熔珠 ───────────────────
    _drawFuseLayer() {
        this._fuseGroup = new Konva.Group();
        this._staticGroup.add(this._fuseGroup);
        this._rebuildFuse();
    }

    _rebuildFuse() {
        this._fuseGroup.destroyChildren();

        const bf   = this._blowFrac;    // 0=完好，1=已熔断
        const x0   = this._wireX0;
        const x1   = this._wireX1;
        const mx   = this._wireMidX;
        const wy   = this._wireY;
        const wH   = this._leadW * 0.70; // 合金丝线径（比引线细）

        // ── 温度预警色（低熔点合金：冷=银白，临界=橙黄，熔断=暗褐）
        const tempFrac = Math.max(0, Math.min(1, (this._temp - 20) / (this.tf - 20)));
        const wR = Math.round(200 + tempFrac * 30);
        const wG = Math.round(200 - tempFrac * 90);
        const wB = Math.round(210 - tempFrac * 180);
        const wireCol = bf > 0
            ? `rgba(${Math.round(wR*0.5)},${Math.round(wG*0.4)},${Math.round(wB*0.3)},${1 - bf * 0.7})`
            : `rgb(${wR},${wG},${wB})`;

        // ── 导通时电流流过的橙色光晕 ──
        if (bf < 0.05 && tempFrac > 0.05) {
            this._fuseGroup.add(new Konva.Rect({
                x: x0, y: wy - wH * 2,
                width: x1 - x0, height: wH * 4,
                fill: `rgba(255,160,40,${tempFrac * 0.14})`,
                cornerRadius: wH * 2,
            }));
        }

        if (bf < 0.98) {
            // ── 左半段合金丝（未熔断部分向左，熔断后向左收缩）──
            const leftEnd = mx - bf * (mx - x0) * 0.85;
            this._fuseGroup.add(new Konva.Rect({
                x: x0, y: wy - wH / 2,
                width: Math.max(0, leftEnd - x0), height: wH,
                fill: wireCol, stroke: 'none', cornerRadius: wH * 0.5,
            }));
            // ── 右半段合金丝 ──
            const rightStart = mx + bf * (x1 - mx) * 0.85;
            this._fuseGroup.add(new Konva.Rect({
                x: rightStart, y: wy - wH / 2,
                width: Math.max(0, x1 - rightStart), height: wH,
                fill: wireCol, stroke: 'none', cornerRadius: wH * 0.5,
            }));
        }

        // ── 熔断区域（中心断口）──
        if (bf > 0.05) {
            const gapHalf = (x1 - x0) * 0.12 * bf;
            // 断口两侧残丝收球（熔珠残留）
            [mx - gapHalf * 0.6, mx + gapHalf * 0.6].forEach(bx => {
                const br = wH * (0.8 + bf * 0.8);
                this._fuseGroup.add(new Konva.Circle({
                    x: bx, y: wy, radius: br,
                    fill: `rgba(${wR},${Math.round(wG*0.7)},${Math.round(wB*0.5)},${0.6 + bf * 0.4})`,
                    stroke: `rgba(${Math.round(wR*0.6)},${Math.round(wG*0.4)},0,0.5)`,
                    strokeWidth: 0.5,
                }));
            });
            // 断口间隙（发橙光，熔断瞬间）
            if (bf < 0.9) {
                const glowAlpha = (1 - bf) * 0.65;
                this._fuseGroup.add(new Konva.Ellipse({
                    x: mx, y: wy,
                    radiusX: gapHalf * 1.6, radiusY: wH * 2.5,
                    fill: `rgba(255,180,40,${glowAlpha})`,
                    shadowColor: 'rgba(255,120,0,0.9)',
                    shadowBlur: 6, shadowOpacity: glowAlpha,
                }));
            }
        }

        // ── 熔珠溅落粒子（熔断动画过程中）──
        if (this._animating && this._animDir > 0) {
            this._droplets.forEach(d => {
                this._fuseGroup.add(new Konva.Circle({
                    x: d.x, y: d.y, radius: d.r,
                    fill: `rgba(255,${Math.round(150 + d.alpha * 80)},30,${d.alpha})`,
                    shadowColor: 'rgba(255,100,0,0.7)',
                    shadowBlur: d.r * 2, shadowOpacity: d.alpha * 0.8,
                }));
            });
        }

        // ── 弹簧弹开位移动画（bf > 0.5 后弹开）──
        if (bf > 0.50) {
            const springOpen = (bf - 0.50) / 0.50;  // 0~1
            const openDist   = this._bodyW * 0.06 * springOpen;
            const cy = this._bodyCy;
            const sh = this._springH;
            // 左弹片向左弹开
            const lx = this._springLX + this._bodyW * 0.04 - openDist;
            this._fuseGroup.add(new Konva.Line({
                points: [lx, cy - sh/2, lx + this._bodyW*0.04, cy, lx, cy + sh/2],
                stroke: '#9a9aaa', strokeWidth: 1.5, lineCap: 'round', lineJoin: 'round',
            }));
            // 右弹片向右弹开
            const rx = this._springRX - this._bodyW * 0.04 + openDist;
            this._fuseGroup.add(new Konva.Line({
                points: [rx, cy - sh/2, rx - this._bodyW*0.04, cy, rx, cy + sh/2],
                stroke: '#9a9aaa', strokeWidth: 1.5, lineCap: 'round', lineJoin: 'round',
            }));
        }
    }

    // ── 外壳前景（高光 + 端盖，覆盖动态层）────────────────
    _drawShellFront() {
        const x = this._bodyX, y = this._bodyY;
        const w = this._bodyW, h = this._bodyH;
        const r = h * 0.28;

        // 外壳顶部高光条（圆柱镜面）
        this._staticGroup.add(new Konva.Rect({
            x: x + r * 0.6, y: y + h * 0.06,
            width: w - r * 1.2, height: h * 0.14,
            fill: 'rgba(255,255,255,0.28)', cornerRadius: h * 0.07,
        }));
        // 外壳底部暗条（圆柱阴影）
        this._staticGroup.add(new Konva.Rect({
            x: x + r * 0.6, y: y + h * 0.80,
            width: w - r * 1.2, height: h * 0.14,
            fill: 'rgba(0,0,10,0.18)', cornerRadius: h * 0.07,
        }));
        // 外壳轮廓（整体描边，确保形态清晰）
        this._staticGroup.add(new Konva.Rect({
            x, y, width: w, height: h,
            fill: 'transparent', stroke: '#8a8fa8', strokeWidth: 1,
            cornerRadius: r,
        }));
        // 左端盖（压接帽）
        this._staticGroup.add(new Konva.Ellipse({
            x: x, y: this._bodyCy,
            radiusX: h * 0.08, radiusY: h / 2,
            fillLinearGradientStartPoint: { x: 0, y: -h/2 },
            fillLinearGradientEndPoint:   { x: 0, y:  h/2 },
            fillLinearGradientColorStops: [
                0, '#c0c5d5', 0.5, '#e0e5f0', 1, '#a0a5b8',
            ],
            stroke: '#7a8098', strokeWidth: 0.8,
        }));
        // 右端盖
        this._staticGroup.add(new Konva.Ellipse({
            x: x + w, y: this._bodyCy,
            radiusX: h * 0.08, radiusY: h / 2,
            fillLinearGradientStartPoint: { x: 0, y: -h/2 },
            fillLinearGradientEndPoint:   { x: 0, y:  h/2 },
            fillLinearGradientColorStops: [
                0, '#c0c5d5', 0.5, '#e0e5f0', 1, '#a0a5b8',
            ],
            stroke: '#7a8098', strokeWidth: 0.8,
        }));
    }

    // ── "更换保险丝"按钮（已熔断时显示）──────────────────
    _drawReplaceButton() {
        // 仅占位：在 _updateStatus 中实时显示/隐藏
        const W = this.width;
        this._replaceBtn = new Konva.Text({
            x: 0, y: this._bodyY + this._bodyH + 10,
            width: W, text: '▶ 更换保险丝',
            fontSize: 9, fontStyle: 'bold',
            fill: '#7a8a94', align: 'center',
            visible: this._blown,
        });
        this._staticGroup.add(this._replaceBtn);
    }

    // ── 位号 + 参数标注 ─────────────────────────────────────
    _drawLabel() {
        const W = this.width;
        this._staticGroup.add(new Konva.Text({
            x: 0, y: -16, width: W,
            text: `${this.label}  Tf=${this.tf}°C  ${this.ratedV}V/${this.ratedI}A`,
            fontSize: 9, fontStyle: 'bold', fill: '#546e7a', align: 'center',
        }));
    }

    // ── 状态指示（外壳下方）─────────────────────────────────
    _drawStatusIndicator() {
        const W  = this.width;
        const iy = this._bodyY + this._bodyH / 2;

        // 左下角指示点
        const ix = this._bodyX + 10;
        const on = !this._blown;
        this._statusDot = new Konva.Circle({
            x: ix, y: iy, radius: 4,
            fill:  on ? '#66bb6a' : '#ef5350',
            stroke:on ? '#2e7d32' : '#c62828',
            strokeWidth: 0.8,
            shadowColor: on ? '#66bb6a' : '#ef5350',
            shadowBlur:  on ? 5 : 7, shadowOpacity: 0.85,
        });
        this._statusText = new Konva.Text({
            x: ix + 7, y: iy - 5,
            text: on ? '完好' : '熔断',
            fontSize: 8, fontStyle: 'bold',
            fill: on ? '#66bb6a' : '#ef5350',
        });
        // 温度读数（外壳右下角）
        const tempFrac = Math.max(0, Math.min(1, (this._temp - 20) / (this.tf - 20)));
        const tR = Math.round(80  + tempFrac * 175);
        const tG = Math.round(180 - tempFrac * 120);
        const tB = Math.round(220 - tempFrac * 180);
        this._readout = new Konva.Text({
            x: 0, y: iy - 5,
            width: W, align: 'center',
            text: `${this._temp.toFixed(1)} °C`,
            fontSize: 9, fontStyle: 'bold',
            fill: `rgb(${tR},${tG},${tB})`,
        });
        this._staticGroup.add(this._statusDot, this._statusText, this._readout);
    }

    // ── 点击交互：升温步进 / 已熔断时更换 ──────────────────
    _bindInteraction() {
        this.group.on('click tap', (e) => {
            e.cancelBubble = true;
            if (this._blown) {
                this.replace();
            } else {
                this.stepTemperature();
            }
        });
        this.group.listening(true);
    }

    // ═══════════════════════════════════════════
    // 集中化 tick（由 consys._tickAll 在 20fps 调用）
    tick(dt) {
        this._tickAnimation(dt);
    
        this._refreshCache();
    }
    _tickAnimation(dt) {
        let needRefresh = false;

        // ── 温度平滑过渡 ──
        if (this._tempAnimating) {
            this._tempAnimT += dt / this._tempAnimDur;
            if (this._tempAnimT >= 1) {
                this._tempAnimT     = 1;
                this._tempAnimating = false;
                this._temp          = this._tempTo;
            }
            const ease  = 0.5 - 0.5 * Math.cos(this._tempAnimT * Math.PI);
            this._temp  = this._tempFrom + (this._tempTo - this._tempFrom) * ease;
            needRefresh = true;

            // 到达动作温度 → 触发熔断（不可逆）
            if (!this._blown && this._temp >= this.tf) {
                this._triggerBlow();
            }
        }

        // ── 熔断 / 更换动画 ──
        if (this._animating) {
            this._animT += dt / this._animDur;
            if (this._animT >= 1) {
                this._animT     = 1;
                this._animating = false;
                if (this._animDir > 0) {
                    this._blown    = true;
                    this._blowFrac = 1;
                } else {
                    this._blown    = false;
                    this._blowFrac = 0;
                    this._droplets = [];
                }
            }
            // 正弦缓动
            const ease      = 0.5 - 0.5 * Math.cos(this._animT * Math.PI);
            this._blowFrac  = this._animDir > 0 ? ease : 1 - ease;
            needRefresh = true;

            // 熔断过程中生成熔珠粒子
            if (this._animDir > 0 && this._animT < 0.7) {
                this._dropTimer += dt;
                if (this._dropTimer > 0.025) {
                    this._dropTimer = 0;
                    this._droplets.push({
                        x:     this._wireMidX + (Math.random() - 0.5) * this._bodyW * 0.10,
                        y:     this._wireY,
                        vx:    (Math.random() - 0.5) * 35,
                        vy:    -(15 + Math.random() * 20),
                        r:     1.2 + Math.random() * 1.8,
                        alpha: 0.8 + Math.random() * 0.2,
                    });
                }
                // 更新熔珠物理（重力）
                this._droplets = this._droplets.filter(d => {
                    d.x     += d.vx * dt;
                    d.y     += d.vy * dt;
                    d.vy    += 80 * dt;   // 重力加速
                    d.alpha -= dt * 2.0;
                    return d.alpha > 0
                        && d.y < this._bodyY + this._bodyH + 8;
                });
            }
        }

        // 静止时若已熔断，确保 blowFrac = 1
        if (!this._animating && !this._tempAnimating) {
            const target = this._blown ? 1 : 0;
            if (Math.abs(this._blowFrac - target) > 0.001) {
                this._blowFrac = target;
                needRefresh    = true;
            }
        }

        if (needRefresh) {
            this._rebuildFuse();
            this._updateStatus();
            this._refreshCache();
        }
    }

    _triggerBlow() {
        if (this._blown || this._animating) return;
        this._animDir   = 1;
        this._animT     = 0;
        this._animating = true;
        this._dropTimer = 0;
        this.opsCount++;
    }

    _updateStatus() {
        const on  = !this._blown && this._blowFrac < 0.5;
        const col  = on ? '#66bb6a' : '#ef5350';
        const scol = on ? '#2e7d32' : '#c62828';

        if (this._statusDot) {
            this._statusDot.fill(col);
            this._statusDot.stroke(scol);
            this._statusDot.shadowColor(col);
            this._statusDot.shadowBlur(on ? 5 : 7);
        }
        if (this._statusText) {
            this._statusText.text(on ? '完好' : '熔断');
            this._statusText.fill(col);
        }
        if (this._replaceBtn) {
            this._replaceBtn.visible(this._blown && !this._animating);
            this._replaceBtn.fill(this._blown ? '#90caf9' : '#7a8a94');
        }

        // 温度读数颜色
        if (this._readout) {
            const tempFrac = Math.max(0, Math.min(1, (this._temp - 20) / (this.tf - 20)));
            const tR = Math.round(80  + tempFrac * 175);
            const tG = Math.round(180 - tempFrac * 120);
            const tB = Math.round(220 - tempFrac * 180);
            this._readout.text(`${this._temp.toFixed(1)} °C`);
            this._readout.fill(`rgb(${tR},${tG},${tB})`);
        }
    }

    // ═══════════════════════════════════════════
    /**
     * 设置目标温度（°C），带平滑动画
     * 若 t ≥ tf 且保险丝完好，将自动触发熔断
     * @param {number} t  目标温度（°C）
     */
    setTemperature(t) {
        const target = Math.max(0, Math.min(300, t));
        if (Math.abs(target - this._temp) < 0.05) return;
        this._tempFrom      = this._temp;
        this._tempTo        = target;
        this._tempAnimT     = 0;
        this._tempAnimating = true;
        this._refreshCache();
    }

    /**
     * 温度步进（点击时调用，循环升降）
     * 循环：25 → Tf×0.5 → Tf×0.8 → Tf-3 → Tf+5 → 25
     */
    stepTemperature() {
        if (this._tempAnimating || this._animating || this._blown) return;
        const steps = [
            25,
            Math.round(this.tf * 0.50),
            Math.round(this.tf * 0.80),
            Math.round(this.tf * 0.96),
            this.tf + 5,
        ];
        const next = steps.find(s => s > this._temp + 0.5) ?? 25;
        this.setTemperature(next);
    }

    /**
     * 更换保险丝（已熔断后模拟更换新件）
     * 带 500ms 恢复动画，完成后恢复初始完好状态
     */
    replace() {
        if (!this._blown || this._animating) return;
        this._animDir   = -1;
        this._animT     = 0;
        this._animDur   = 0.50;   // 更换过程动画较慢
        this._animating = true;
        this._temp      = 25;     // 换新后温度归常温
        this._tempAnimating = false;
        this.opsCount++;
        this._refreshCache();
    }

    /** 强制熔断（不管温度，直接触发，用于测试） */
    blow() {
        if (this._blown || this._animating) return;
        this._triggerBlow();
        this._refreshCache();
    }

    /** 当前温度（°C） */
    getTemperature()  { return this._temp; }

    /** 是否已熔断（不可逆，需调用 replace() 恢复） */
    isBlown()         { return this._blown; }

    /** 是否导通（完好且未在熔断过程中） */
    isConducting()    { return !this._blown && this._blowFrac < 0.5; }

    isAnimating()     { return this._animating || this._tempAnimating; }
    getOpsCount()     { return this.opsCount; }

    update(state) {
        if (typeof state === 'number') {
            this.setTemperature(state);
        } else if (state === 'replace') {
            this.replace();
        } else if (state === 'blow') {
            this.blow();
        }
        this._refreshCache();
    }

    getConfigFields() {
        return [
            { label: '位号/名称',           key: 'label',      type: 'text'   },
            { label: '动作温度 Tf (°C)',     key: 'tf',         type: 'number' },
            { label: '额定电压 (V)',         key: 'ratedV',     type: 'number' },
            { label: '额定电流 (A)',         key: 'ratedI',     type: 'number' },
            { label: '初始温度 (°C)',        key: 'initTemp',   type: 'number' },
            { label: '初始状态（1=完好）',   key: 'initIntact', type: 'number' },
            { label: '熔断动画时间 (s)',     key: 'animDur',    type: 'number' },
        ];
    }

    onConfigUpdate(cfg) {
        if (cfg.label     !== undefined) this.label   = cfg.label;
        if (cfg.tf        !== undefined) this.tf      = parseFloat(cfg.tf)      || this.tf;
        if (cfg.ratedV    !== undefined) this.ratedV  = parseFloat(cfg.ratedV)  || this.ratedV;
        if (cfg.ratedI    !== undefined) this.ratedI  = parseFloat(cfg.ratedI)  || this.ratedI;
        if (cfg.animDur   !== undefined) this._animDur= parseFloat(cfg.animDur) || this._animDur;
        if (cfg.initTemp  !== undefined) {
            const t = parseFloat(cfg.initTemp);
            if (!isNaN(t)) { this._temp = t; this._tempAnimating = false; }
        }
        if (cfg.initIntact !== undefined) {
            const intact = !!parseInt(cfg.initIntact);
            if (intact) {
                this._blown    = false;
                this._blowFrac = 0;
                this._droplets = [];
            }
        }
        this.config = { ...this.config, ...cfg };
        // 重建所有静态层（Tf / 色环等变化需完整重绘）
        this.group.destroyChildren();
        this._statusDot  = null;
        this._statusText = null;
        this._readout    = null;
        this._replaceBtn = null;
        this._init();
        this._refreshCache();
    }

    destroy() {
        super.destroy?.();
    }
}