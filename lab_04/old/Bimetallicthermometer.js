import { BaseComponent } from '../BaseComponent.js';

/**
 * 双金属温度计仿真组件
 * （Bimetallic Thermometer / Bimetal Strip Thermometer）
 *
 * ── 工作原理 ──────────────────────────────────────────────────
 *
 *  双金属温度计利用两种线膨胀系数不同的金属（通常为殷瓦合金
 *  Invar + 黄铜 Brass）冶金结合成双金属片（Bimetal Strip）。
 *
 *  当温度变化时，两层金属膨胀量不同，双金属片产生弯曲变形：
 *
 *    ┌───────────────────────────────────────────────┐
 *    │  升温时：膨胀系数大的金属（黄铜，外层）       │
 *    │          膨胀更多 → 整体向内弯曲              │
 *    │                                               │
 *    │  T↑ → 双金属片弯曲角度增大                    │
 *    │  T↓ → 双金属片趋向平直（或反向弯曲）          │
 *    └───────────────────────────────────────────────┘
 *
 *  螺旋式双金属片（Helical Bimetal Coil）将线性弯曲转化为旋转，
 *  通过中心轴直接驱动表盘指针：
 *
 *    温度变化 → 螺旋卷展开/收紧 → 中心轴旋转 → 指针偏转
 *
 * ── 结构组成 ──────────────────────────────────────────────────
 *
 *  1. 表壳（Case）：
 *     - 圆形金属外壳（不锈钢），直径约 100mm
 *     - 正面玻璃窗（钢化玻璃），边缘压圈固定
 *     - 背部接口：保护管连接螺纹
 *
 *  2. 表盘（Dial Face）：
 *     - 白色铝制表盘，印刷刻度
 *     - 量程：-40°C ~ +60°C（标准型）/ 0~120°C（工业型）
 *     - 主刻度：每 20°C 一格长刻线
 *     - 次刻度：每 5°C 一格中刻线
 *     - 细刻度：每 1°C 一格短刻线
 *     - 双圈刻度：外圈°C，内圈°F（可选）
 *
 *  3. 指针（Pointer）：
 *     - 细长铝制指针，红色或黑色
 *     - 由中心轴直接驱动，无齿轮传动（精度高）
 *     - 平衡配重尾翼（防震）
 *     - 阻尼液腔（可选，防快速温变引起振荡）
 *
 *  4. 螺旋双金属片（Helical Bimetal Element）：
 *     - 位于表壳内部（透视可见）
 *     - 外层：黄铜（α≈18×10⁻⁶/°C），金色
 *     - 内层：殷瓦合金（α≈1.5×10⁻⁶/°C），银灰色
 *     - 螺旋圈数：约 4~8 圈
 *     - 外端固定于表壳，内端连接中心轴
 *
 *  5. 保护管（Thermowell / Stem）：
 *     - 从表壳背部伸出的金属细管（不锈钢）
 *     - 内部容纳螺旋双金属元件延伸段或传热杆
 *     - 标准插入长度：50mm / 100mm / 150mm
 *     - 连接螺纹：G1/2"（英制管螺纹）
 *     - 末端感温球（Bulb）：直接接触被测介质
 *
 *  6. 过量程保护（Over-range Stop）：
 *     - 表盘两端设有机械限位柱
 *     - 防止超量程时指针过度旋转损坏双金属片
 *
 * ── 误差模型 ──────────────────────────────────────────────────
 *
 *  基本误差：±1% FS（满量程）
 *  重复性误差：±0.5% FS
 *  热滞后：±0.5°C（升温/降温路径差异）
 *  自热：可忽略（无需电源）
 *  安装误差：±1~2°C（竖直/水平安装姿态影响）
 *  热响应时间常数 τ：约 8s（保护管材料和壁厚影响）
 *
 * ── 仿真动画 ──────────────────────────────────────────────────
 *
 *  1. 指针旋转：跟随温度平滑运动（含阻尼振荡，模拟惯性）
 *  2. 螺旋双金属片：随温度展开/收紧（可视化核心原理）
 *  3. 玻璃反光：表面高光随视角轻微移动
 *  4. 感温管热态：高温时末端出现热晕效果
 *  5. 过量程报警：超出量程时指针触碰限位柱，表壳红色闪烁
 *  6. 热响应惰性：温度突变后指针缓慢跟踪（τ=8s 一阶响应）
 *  7. 阻尼振荡：快速温变时指针轻微过冲后回稳
 *
 * ── 端口 ─────────────────────────────────────────────────────
 *  （双金属温度计为纯机械仪表，无电气端口）
 *  本仿真以 JS API 驱动温度输入，供上位机集成调用：
 *    setTemperature(T)     — 设置环境温度（°C）
 *    getReading()          — 读取当前示数（°C，含误差）
 *    getPointerAngle()     — 读取指针角度（°，-120~+120）
 */
export class BimetallicThermometer extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.width  = Math.max(200, config.width  || 240);
        this.height = Math.max(280, config.height || 320);

        this.type    = 'bimetallic_thermometer';
        this.special = 'sensor';
        this.cache   = 'fixed';

        this._initGroups();
        // ── 量程与标定 ──
        this.label    = config.label    || 'TI';
        this.tempMin  = config.tempMin  !== undefined ? config.tempMin  : -40;   // °C
        this.tempMax  = config.tempMax  !== undefined ? config.tempMax  :  60;   // °C
        this.showF    = config.showF    !== false;        // 显示华氏刻度
        this.stemLen  = config.stemLen  || 100;           // mm（保护管长度，影响绘制比例）
        this.accuracy = config.accuracy || 1.0;           // % FS 基本误差

        // ── 物理模型参数 ──
        this.tauSec   = config.tauSec   || 8.0;   // 热响应时间常数（s）
        this.dampRatio= config.dampRatio|| 0.55;   // 阻尼比（0~1，<1 欠阻尼有振荡）
        this.hysteresis= config.hysteresis|| 0.5;  // 热滞后（°C）

        // ── 温度状态 ──
        const initT = config.initTemp !== undefined ? config.initTemp : 20;
        this._tempTarget  = initT;    // 目标温度（被测介质）
        this._tempSensor  = initT;    // 传感元件温度（热惯性后）
        this._tempVelocity= 0;        // 热响应速度（用于阻尼振荡模型）
        this._tempDisplay = initT;    // 最终示数（含滞后/误差）
        this._tempPrev    = initT;    // 上一帧，用于检测变化方向（滞后计算）
        this._overRange   = false;    // 是否过量程
        this._overRangeFlash = 0;     // 过量程闪烁计时

        // ── 指针状态 ──
        // 角度：-120°（量程最小值）到 +120°（量程最大值），0°=正上方 12点
        this._pointerAngle    = this._tempToAngle(initT);   // 当前角度（°）
        this._pointerTargetAngle = this._pointerAngle;
        this._pointerVelocity = 0;   // 指针角速度（°/s，用于阻尼模型）

        // ── 螺旋双金属片动画 ──
        this._coilAngle = this._tempToCoilExpand(initT);  // 展开量 0~1

        // ── 反光动画 ──
        this._glassPhase = 0;

        // ── 动画循环（已迁移至 consys._tickAll）──

        // ── 几何布局 ──
        const W = this.width, H = this.height;

        // 表盘中心
        this._dialCX = W * 0.50;
        this._dialCY = H * 0.38;
        this._dialR  = Math.min(W * 0.42, H * 0.30);

        // 保护管（从表壳底部向下伸出）
        const stemScale   = Math.min(1.0, this.stemLen / 100);
        this._stem = {
            x:    W * 0.50,
            y1:   this._dialCY + this._dialR * 1.08,
            y2:   this._dialCY + this._dialR * 1.08 + H * 0.28 * stemScale,
            w:    W * 0.040,
        };
        // 感温球
        this._bulb = {
            cx: this._stem.x,
            cy: this._stem.y2 + this._stem.w * 0.7,
            r:  this._stem.w * 0.9,
        };

        this._init();
    }

    // ═══════════════════════════════════════════
    _init() {
        // 绘制顺序（底层→顶层）
        this._drawStem();           // 保护管（底层，被表壳遮住部分）
        this._drawCaseBack();       // 表壳背面/侧面
        this._drawDialFace();       // 表盘（白底+刻度+数字）
        this._drawScaleMarks();     // 刻度线
        this._drawScaleNumbers();   // 刻度数字

        // 内部螺旋元件（透视层，在表盘上叠加）
        this._coilGroup = new Konva.Group();
        this._staticGroup.add(this._coilGroup);

        // 指针动态层
        this._pointerGroup = new Konva.Group();
        this._staticGroup.add(this._pointerGroup);

        // 玻璃层（最顶层）
        this._drawGlass();
        this._drawCaseFront();      // 表壳正面压圈

        // 铭牌
        this._drawNameplate();

        // 状态面板
        this._drawStatusPanel();

        // 标注
        this._drawLabel();

        // 初始绘制动态内容
        this._rebuildCoil();
        this._rebuildPointer();

    }

    // ── 保护管 ───────────────────────────────
    _drawStem() {
        const s = this._stem, b = this._bulb;

        // 螺纹连接座（表壳底部）
        const nutW = s.w * 2.8, nutH = s.w * 1.4;
        const nutX = s.x - nutW / 2;
        const nutY = s.y1 - nutH * 0.2;
        this._staticGroup.add(new Konva.Rect({
            x: nutX, y: nutY, width: nutW, height: nutH,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint:   { x: nutW, y: 0 },
            fillLinearGradientColorStops: [
                0,   '#5a5e62',
                0.2, '#9aa0a6',
                0.5, '#c0c6cc',
                0.8, '#9aa0a6',
                1,   '#5a5e62',
            ],
            stroke: '#3a3e42', strokeWidth: 1,
            cornerRadius: 2,
        }));
        // 螺纹纹路（横线）
        for (let i = 1; i <= 4; i++) {
            this._staticGroup.add(new Konva.Line({
                points: [nutX + 2, nutY + nutH * (i / 5), nutX + nutW - 2, nutY + nutH * (i / 5)],
                stroke: 'rgba(0,0,0,0.18)', strokeWidth: 0.6,
            }));
        }

        // 保护管主体
        this._staticGroup.add(new Konva.Rect({
            x: s.x - s.w / 2, y: s.y1,
            width: s.w, height: s.y2 - s.y1,
            fillLinearGradientStartPoint: { x: -s.w/2, y: 0 },
            fillLinearGradientEndPoint:   { x:  s.w/2, y: 0 },
            fillLinearGradientColorStops: [
                0,   '#4a5058',
                0.25,'#8a9098',
                0.55,'#aab4bc',
                0.80,'#8a9098',
                1,   '#4a5058',
            ],
            strokeWidth: 0,
        }));
        // 管壁高光线
        this._staticGroup.add(new Konva.Line({
            points: [s.x - s.w * 0.18, s.y1, s.x - s.w * 0.18, s.y2],
            stroke: 'rgba(255,255,255,0.22)', strokeWidth: 1.2, lineCap: 'round',
        }));
        // 管壁阴影线
        this._staticGroup.add(new Konva.Line({
            points: [s.x + s.w * 0.35, s.y1, s.x + s.w * 0.35, s.y2],
            stroke: 'rgba(0,0,0,0.15)', strokeWidth: 1.0,
        }));

        // 感温球（末端半球）
        this._bulbNode = new Konva.Circle({
            x: b.cx, y: b.cy, radius: b.r,
            fillRadialGradientStartPoint:  { x: -b.r * 0.3, y: -b.r * 0.3 },
            fillRadialGradientEndPoint:    { x: 0, y: 0 },
            fillRadialGradientStartRadius: 0,
            fillRadialGradientEndRadius:   b.r,
            fillRadialGradientColorStops:  [0, '#d0d8e0', 0.6, '#909aa4', 1, '#505860'],
            stroke: '#3a4048', strokeWidth: 1,
        });
        this._staticGroup.add(this._bulbNode);
    }

    // ── 表壳背面/侧边 ────────────────────────
    _drawCaseBack() {
        const cx = this._dialCX, cy = this._dialCY, r = this._dialR;

        // 外圈（不锈钢壳体侧面，产生立体感）
        this._staticGroup.add(new Konva.Circle({
            x: cx, y: cy, radius: r + 8,
            fillRadialGradientStartPoint:  { x: -r * 0.3, y: -r * 0.3 },
            fillRadialGradientEndPoint:    { x:  r * 0.2, y:  r * 0.2 },
            fillRadialGradientStartRadius: r * 0.5,
            fillRadialGradientEndRadius:   r + 8,
            fillRadialGradientColorStops: [
                0,   '#8a9098',
                0.5, '#6a7078',
                0.8, '#4a5058',
                1,   '#2a3038',
            ],
            stroke: '#20282e', strokeWidth: 1.5,
            shadowColor: '#000', shadowBlur: 14, shadowOffsetY: 4, shadowOpacity: 0.45,
        }));

        // 表壳外缘纹理（金属拉丝感，细圆弧虚线）
        for (let i = 0; i < 12; i++) {
            const a0 = (i / 12) * Math.PI * 2;
            const a1 = a0 + Math.PI / 14;
            this._staticGroup.add(new Konva.Arc({
                x: cx, y: cy,
                innerRadius: r + 3,
                outerRadius: r + 7,
                angle: (a1 - a0) * 180 / Math.PI,
                rotation: a0 * 180 / Math.PI,
                fill: 'rgba(255,255,255,0.06)',
                strokeWidth: 0,
            }));
        }
    }

    // ── 表盘面板 ────────────────────────────
    _drawDialFace() {
        const cx = this._dialCX, cy = this._dialCY, r = this._dialR;

        // 表盘底色（乳白色）
        this._staticGroup.add(new Konva.Circle({
            x: cx, y: cy, radius: r,
            fillRadialGradientStartPoint:  { x: -r*0.1, y: -r*0.2 },
            fillRadialGradientEndPoint:    { x: 0, y: 0 },
            fillRadialGradientStartRadius: 0,
            fillRadialGradientEndRadius:   r,
            fillRadialGradientColorStops: [
                0,   '#f8f8f6',
                0.7, '#f0f0ee',
                0.95,'#e4e4e0',
                1,   '#d0d0cc',
            ],
            strokeWidth: 0,
        }));

        // 表盘轻微阴影圆弧（边缘立体感）
        this._staticGroup.add(new Konva.Circle({
            x: cx, y: cy, radius: r - 1,
            fill: 'transparent',
            stroke: 'rgba(0,0,0,0.08)', strokeWidth: 3,
        }));
    }

    // ── 刻度线 ───────────────────────────────
    _drawScaleMarks() {
        const cx  = this._dialCX, cy = this._dialCY, r = this._dialR;
        const span = this.tempMax - this.tempMin;            // 量程
        const totalAngleDeg = 240;                           // 总角度跨度（°）
        const startAngleDeg = 150;                           // 起始角（从竖直向上=270°开始，顺时针）

        // 过量程限位柱
        [-1, 1].forEach(side => {
            const stopAngle = (startAngleDeg + (side === -1 ? 0 : totalAngleDeg)) * Math.PI / 180;
            const stopR = r * 0.82;
            this._staticGroup.add(new Konva.Circle({
                x: cx + Math.cos(stopAngle) * stopR,
                y: cy + Math.sin(stopAngle) * stopR,
                radius: 2.8,
                fill: '#c0392b', stroke: '#8e1a10', strokeWidth: 0.8,
            }));
        });

        const step1C  = 1;   // 细刻度步长 °C
        const step5C  = 5;
        const step20C = 20;
        const totalSteps = span / step1C;

        for (let i = 0; i <= totalSteps; i++) {
            const tempVal   = this.tempMin + i * step1C;
            const fraction  = i / totalSteps;
            const angleDeg  = startAngleDeg + fraction * totalAngleDeg;
            const angleRad  = angleDeg * Math.PI / 180;

            const cos = Math.cos(angleRad), sin = Math.sin(angleRad);

            let tickLen, tickW, tickColor;
            const isMajor  = tempVal % step20C === 0;
            const isMedium = tempVal % step5C  === 0;

            if (isMajor) {
                tickLen = r * 0.18; tickW = 1.4; tickColor = '#1a1a1a';
            } else if (isMedium) {
                tickLen = r * 0.12; tickW = 1.0; tickColor = '#2a2a2a';
            } else {
                tickLen = r * 0.07; tickW = 0.6; tickColor = '#555';
            }

            const outerR = r * 0.94;
            const innerR = outerR - tickLen;

            this._staticGroup.add(new Konva.Line({
                points: [
                    cx + cos * outerR, cy + sin * outerR,
                    cx + cos * innerR, cy + sin * innerR,
                ],
                stroke: tickColor, strokeWidth: tickW, lineCap: 'round',
            }));
        }
    }

    // ── 刻度数字 ─────────────────────────────
    _drawScaleNumbers() {
        const cx = this._dialCX, cy = this._dialCY, r = this._dialR;
        const span          = this.tempMax - this.tempMin;
        const totalAngleDeg = 240;
        const startAngleDeg = 150;
        const step          = 20;

        for (let T = this.tempMin; T <= this.tempMax; T += step) {
            const fraction  = (T - this.tempMin) / span;
            const angleDeg  = startAngleDeg + fraction * totalAngleDeg;
            const angleRad  = angleDeg * Math.PI / 180;
            const numR      = r * 0.72;

            const nx = cx + Math.cos(angleRad) * numR;
            const ny = cy + Math.sin(angleRad) * numR;

            // °C 数字
            this._staticGroup.add(new Konva.Text({
                x: nx - 16, y: ny - 6,
                width: 32, height: 12,
                text: String(T),
                fontSize: r * 0.115,
                fill: '#1a1a1a',
                align: 'center',
                fontStyle: 'bold',
                fontFamily: 'Arial, sans-serif',
            }));
        }

        // °C 单位标注
        this._staticGroup.add(new Konva.Text({
            x: cx - 20, y: cy + r * 0.45,
            width: 40,
            text: '°C',
            fontSize: r * 0.15,
            fill: '#333',
            align: 'center',
            fontStyle: 'bold',
            fontFamily: 'Arial, sans-serif',
        }));

        // 量程标注（弧形路径近似：在中心偏上显示）
        this._staticGroup.add(new Konva.Text({
            x: cx - r * 0.5, y: cy - r * 0.30,
            width: r,
            text: `${this.tempMin}~${this.tempMax}`,
            fontSize: r * 0.085,
            fill: '#e30606',
            align: 'center',
            fontFamily: 'Courier New, monospace',
        }));
    }

    // ── 玻璃层 ───────────────────────────────
    _drawGlass() {
        const cx = this._dialCX, cy = this._dialCY, r = this._dialR;

        // 玻璃整体（轻透明蓝灰）
        this._glassNode = new Konva.Circle({
            x: cx, y: cy, radius: r,
            fill: 'rgba(200,215,230,0.07)',
            strokeWidth: 0,
            listening: false,
        });
        this._staticGroup.add(this._glassNode);

        // 主高光（左上弧面反光）
        this._glassHighlight1 = new Konva.Shape({
            sceneFunc(ctx, shape) {
                ctx.beginPath();
                ctx.arc(cx - r * 0.18, cy - r * 0.20, r * 0.55, Math.PI * 1.10, Math.PI * 1.70);
                ctx.strokeStyle = shape.stroke();
                ctx.lineWidth   = r * 0.22;
                ctx.globalAlpha = 0.11;
                ctx.stroke();
                ctx.globalAlpha = 1;
            },
            stroke: '#ffffff',
        });
        this._staticGroup.add(this._glassHighlight1);

        // 副高光（右侧小弧）
        this._staticGroup.add(new Konva.Arc({
            x: cx + r * 0.40, y: cy - r * 0.10,
            innerRadius: r * 0.12, outerRadius: r * 0.12,
            angle: 60, rotation: 200,
            stroke: 'rgba(255,255,255,0.14)', strokeWidth: r * 0.07,
            listening: false,
        }));
    }

    // ── 表壳正面压圈 ─────────────────────────
    _drawCaseFront() {
        const cx = this._dialCX, cy = this._dialCY, r = this._dialR;

        // 压圈（不锈钢环）
        this._staticGroup.add(new Konva.Ring({
            x: cx, y: cy,
            innerRadius: r,
            outerRadius: r + 8,
            fillRadialGradientStartPoint:  { x: 0, y: 0 },
            fillRadialGradientEndPoint:    { x: 0, y: 0 },
            fillRadialGradientStartRadius: r,
            fillRadialGradientEndRadius:   r + 8,
            fillRadialGradientColorStops: [
                0,   '#6a7278',
                0.3, '#9aa2a8',
                0.6, '#b8c0c6',
                0.85,'#8a9298',
                1,   '#4a5258',
            ],
            stroke: '#20282e', strokeWidth: 1.0,
        }));
        // 压圈高光（顶部弧）
        this._staticGroup.add(new Konva.Arc({
            x: cx, y: cy,
            innerRadius: r + 1,
            outerRadius: r + 7,
            angle: 100, rotation: 210,
            fill: 'rgba(255,255,255,0.13)',
            strokeWidth: 0,
        }));
        // 压圈固定小螺钉（3个，均匀分布）
        [0, 120, 240].forEach(a => {
            const ar = (a + 60) * Math.PI / 180;
            const sx = cx + Math.cos(ar) * (r + 4.5);
            const sy = cy + Math.sin(ar) * (r + 4.5);
            this._staticGroup.add(new Konva.Circle({
                x: sx, y: sy, radius: 1.8,
                fill: '#7a8288', stroke: '#555', strokeWidth: 0.5,
            }));
            this._staticGroup.add(new Konva.Line({
                points: [sx - 1.2, sy, sx + 1.2, sy],
                stroke: '#444', strokeWidth: 0.6, lineCap: 'round',
            }));
        });
    }

    // ── 铭牌 ─────────────────────────────────
    _drawNameplate() {
        const cx = this._dialCX, cy = this._dialCY, r = this._dialR;

        // 铭牌底框
        const nw = r * 0.88, nh = r * 0.18;
        const nx = cx - nw / 2, ny = cy + r * 0.14;
        this._staticGroup.add(new Konva.Rect({
            x: nx, y: ny, width: nw, height: nh,
            fill: 'rgba(0,0,0,0.04)', cornerRadius: 2, strokeWidth: 0,
        }));

        // 品牌名（仿工业铭牌字体）
        this._staticGroup.add(new Konva.Text({
            x: nx, y: ny + 1,
            width: nw, height: nh,
            text: 'BIMETAL',
            fontSize: r * 0.12,
            fill: '#1a3a6a',
            align: 'center',
            fontStyle: 'bold',
            fontFamily: 'Arial Narrow, Arial, sans-serif',
            letterSpacing: 2,
        }));
    }

    // ── 螺旋双金属片（动态重绘）────────────
    _rebuildCoil() {
        this._coilGroup.destroyChildren();

        const cx = this._dialCX, cy = this._dialCY, r = this._dialR;
        const expand = this._coilAngle;   // 0(冷)~1(热)，展开程度

        // 螺旋线参数
        const turns    = 5.5;           // 圈数
        const rMin     = r * 0.1;      // 最内圈半径
        const rMax     = r * 0.42;      // 最外圈半径
        const coilCX   = cx;
        const coilCY   = cy - r * 0.04;

        // 根据温度决定展开角（热→展开，外圈间距增大）
        // expand=0: 紧密螺旋；expand=1: 展开约30°旋转
        const rotationOffset = (expand - 0.5) * Math.PI * 0.55;

        // 绘制双金属片截面（两层颜色）
        const segments = Math.floor(turns * 36);  // 每圈36段

        const ptsOuter = [], ptsInner = [];
        const layerThick = r * 0.018;

        for (let i = 0; i <= segments; i++) {
            const t     = i / segments;
            const angle = t * turns * Math.PI * 2 + rotationOffset;
            // 阿基米德螺旋：r = rMin + (rMax-rMin)*t
            const radius = rMin + (rMax - rMin) * t;
            const bx = coilCX + Math.cos(angle) * radius;
            const by = coilCY + Math.sin(angle) * radius;
            // 法向量（指向圆心方向垂直于螺旋切线方向偏移）
            const nx = Math.cos(angle), ny = Math.sin(angle);
            ptsOuter.push(bx + nx * layerThick, by + ny * layerThick);
            ptsInner.push(bx - nx * layerThick, by - ny * layerThick);
        }

        // 外层：黄铜（高膨胀系数）
        this._coilGroup.add(new Konva.Line({
            points: ptsOuter,
            stroke: '#c8a040',
            strokeWidth: layerThick * 1.6,
            lineCap: 'round',
            opacity: 0.82,
        }));

        // 内层：殷瓦合金（低膨胀系数）
        this._coilGroup.add(new Konva.Line({
            points: ptsInner,
            stroke: '#909aa8',
            strokeWidth: layerThick * 1.4,
            lineCap: 'round',
            opacity: 0.78,
        }));

        // 中心轴
        this._coilGroup.add(new Konva.Circle({
            x: coilCX, y: coilCY, radius: r * 0.045,
            fillLinearGradientStartPoint: { x: -r*0.045, y: -r*0.045 },
            fillLinearGradientEndPoint:   { x:  r*0.045, y:  r*0.045 },
            fillLinearGradientColorStops: [0,'#c8d0d8', 0.5,'#e8f0f8', 1,'#8a9298'],
            stroke: '#556070', strokeWidth: 0.8,
        }));

        // 图例标注（小）
        this._coilGroup.add(new Konva.Text({
            x: coilCX - r*0.46, y: coilCY + r*0.42,
            width: r*0.30, text: '黄铜',
            fontSize: 8.5, fill: '#b89030',
            fontFamily: 'Courier New',
        }));
        this._coilGroup.add(new Konva.Circle({
            x: coilCX - r*0.50, y: coilCY + r*0.39,
            radius: 2.5, fill: '#c8a040',
        }));
        this._coilGroup.add(new Konva.Text({
            x: coilCX + r*0.18, y: coilCY + r*0.42,
            width: r*0.40, text: '殷瓦',
            fontSize: 8.5, fill: '#0bbf1a',
            fontFamily: 'Courier New',
        }));
        this._coilGroup.add(new Konva.Circle({
            x: coilCX + r*0.15, y: coilCY + r*0.39,
            radius: 2.5, fill: '#909aa8',
        }));
    }

    // ── 指针（动态重绘）─────────────────────
    _rebuildPointer() {
        this._pointerGroup.destroyChildren();

        const cx  = this._dialCX, cy = this._dialCY, r = this._dialR;
        const ang = this._pointerAngle * Math.PI / 180;  // 转弧度

        // 过量程检测
        const span     = this.tempMax - this.tempMin;
        const totalDeg = 240;
        const clampMin = 150 * Math.PI / 180;
        const clampMax = (150 + totalDeg) * Math.PI / 180;
        const angClamped = Math.max(clampMin, Math.min(clampMax, ang));

        // 指针针尖方向向量
        const pCos = Math.cos(angClamped), pSin = Math.sin(angClamped);

        const pLen    = r * 0.82;   // 针尖到圆心
        const pBack   = r * 0.18;   // 尾翼到圆心
        const pW      = r * 0.022;  // 针身宽度

        // 垂直于指针方向的法向量
        const normCos = -pSin, normSin = pCos;

        // 指针主体（细长梯形，朝向量程方向）
        const tipX  = cx + pCos * pLen,        tipY  = cy + pSin * pLen;
        const midX  = cx + pCos * pLen * 0.15, midY  = cy + pSin * pLen * 0.15;
        const tailX = cx - pCos * pBack,       tailY = cy - pSin * pBack;

        // 指针形状（菱形截面）
        const pts = [
            tipX, tipY,
            midX + normCos * pW * 2.5, midY + normSin * pW * 2.5,
            tailX + normCos * pW * 1.2, tailY + normSin * pW * 1.2,
            tailX - normCos * pW * 1.2, tailY - normSin * pW * 1.2,
            midX - normCos * pW * 2.5, midY - normSin * pW * 2.5,
        ];

        this._pointerGroup.add(new Konva.Line({
            points: pts,
            closed: true,
            fillLinearGradientStartPoint: { x: cx, y: cy },
            fillLinearGradientEndPoint:   { x: tipX, y: tipY },
            fillLinearGradientColorStops: [0,'#e53935', 0.3,'#ef5350', 0.7,'#c62828', 1,'#8b1a1a'],
            stroke: '#8b1a1a', strokeWidth: 0.5,
            shadowColor: 'rgba(0,0,0,0.25)', shadowBlur: 3, shadowOffsetY: 1,
        }));

        // 配重尾翼（尾部加宽小块）
        const tW = pW * 3.5, tH = pBack * 0.55;
        this._pointerGroup.add(new Konva.Rect({
            x: tailX - tW / 2,
            y: tailY - tH / 2,
            width: tW, height: tH,
            fill: '#c62828', cornerRadius: 1.5,
            rotation: this._pointerAngle,
            offsetX: 0, offsetY: 0,
        }));

        // 中心轴帽（压住指针根部的金属圆盖）
        this._pointerGroup.add(new Konva.Circle({
            x: cx, y: cy, radius: r * 0.055,
            fillRadialGradientStartPoint:  { x: -r*0.02, y: -r*0.02 },
            fillRadialGradientEndPoint:    { x: 0, y: 0 },
            fillRadialGradientStartRadius: 0,
            fillRadialGradientEndRadius:   r * 0.055,
            fillRadialGradientColorStops:  [0,'#e8e8e8', 0.6,'#b0b0b0', 1,'#787878'],
            stroke: '#404040', strokeWidth: 0.8,
        }));

        // 过量程时：指针发红光警示
        if (this._overRange) {
            const flash = Math.abs(Math.sin(this._overRangeFlash * Math.PI * 6));
            this._pointerGroup.add(new Konva.Circle({
                x: cx, y: cy, radius: r * 0.80,
                fill: 'transparent',
                stroke: `rgba(255,50,30,${flash * 0.35})`,
                strokeWidth: r * 0.06,
            }));
        }
    }

    // ── 状态面板 ─────────────────────────────
    _drawStatusPanel() {
        const W  = this.width;
        const panY = this._stem.y2 + this._bulb.r * 2 + 10;

        this._statusPanelGroup = new Konva.Group({ x: 0, y: panY });
        this._staticGroup.add(this._statusPanelGroup);

        this._statusPanelGroup.add(new Konva.Rect({
            x: 8, y: 0, width: W - 24, height: 54,
            fill: '#e2e5ed', stroke: '#1a2430',
            strokeWidth: 0.8, cornerRadius: 4,
        }));

        this._statusDot = new Konva.Circle({
            x: 18, y: 10, radius: 3.5,
            fill: '#66bb6a', stroke: '#2e7d32', strokeWidth: 0.8,
            shadowColor: '#66bb6a', shadowBlur: 5, shadowOpacity: 0.8,
        });
        this._statusPanelGroup.add(this._statusDot);

        this._statLines = [];
        ['示数: -- °C', '目标: -- °C', '误差: ±0.00 °C'].forEach((txt, i) => {
            const t = new Konva.Text({
                x: 28, y: 4 + i * 16,
                width: W - 40, text: txt,
                fontSize: 12, fill: '#7aaad0',
                fontFamily: 'Courier New, monospace',
            });
            this._statusPanelGroup.add(t);
            this._statLines.push(t);
        });
    }

    _updateStatusPanel() {
        if (!this._statLines) return;
        const T    = this._tempDisplay;
        const tgt  = this._tempTarget;
        const err  = T - tgt;
        const Tnorm = Math.max(0, Math.min(1, (T - this.tempMin) / (this.tempMax - this.tempMin)));

        this._statLines[0].text(`示数: ${T.toFixed(2)} °C`);
        this._statLines[0].fill(this._getTempColor(T));
        this._statLines[1].text(`目标: ${tgt.toFixed(2)} °C`);
        this._statLines[2].text(`误差: ${err >= 0 ? '+' : ''}${err.toFixed(2)} °C`);

        const dotCol = this._overRange ? '#ef5350'
            : T > this.tempMax * 0.85 ? '#ffa726'
            : '#66bb6a';
        this._statusDot.fill(dotCol);
        this._statusDot.stroke(dotCol);
        this._statusDot.shadowColor(dotCol);

        // 感温球热态着色
        const hotAlpha = Math.max(0, (T - 40) / (this.tempMax - 40)) * 0.6;
        if (this._bulbNode && hotAlpha > 0) {
            this._bulbNode.fillRadialGradientColorStops([
                0, `rgba(255,${Math.round(160 - hotAlpha*80)},${Math.round(100 - hotAlpha*80)},1)`,
                0.6, `rgba(${Math.round(140+hotAlpha*80)},${Math.round(80)},${Math.round(70)},1)`,
                1, `rgba(${Math.round(80+hotAlpha*40)},30,30,1)`,
            ]);
        }
    }

    // ── 标注 ─────────────────────────────────
    _drawLabel() {
        this._staticGroup.add(new Konva.Text({
            x: 0, y: -18,
            width: this.width,
            text: `${this.label}  双金属温度计`,
            fontSize: 12, fontStyle: 'bold',
            fill: '#546e7a', align: 'center',
            fontFamily: 'Arial, sans-serif',
        }));
        this._staticGroup.add(new Konva.Text({
            x: 0, y: -2,
            width: this.width,
            text: `${this.tempMin}~${this.tempMax} °C  精度 ±${this.accuracy}% FS`,
            fontSize: 12, fill: '#3a5a7a', align: 'center',
            fontFamily: 'Courier New, monospace',
        }));
    }

    // ═══════════════════════════════════════════
    // ── 物理模型 ─────────────────────────────

    /**
     * 摄氏温度 → 指针角度（°）
     * 量程最小 → 150°（约7点半位置），最大 → 390°（约4点半位置）
     * 即：顺时针 240° 对应全量程
     */
    _tempToAngle(T) {
        const span     = this.tempMax - this.tempMin;
        const fraction = (T - this.tempMin) / span;
        return 150 + fraction * 240;  // °
    }

    /**
     * 温度 → 螺旋展开量（0~1）
     */
    _tempToCoilExpand(T) {
        const span = this.tempMax - this.tempMin;
        return Math.max(0, Math.min(1, (T - this.tempMin) / span));
    }

    /**
     * 二阶阻尼弹簧模型（模拟指针惯性 + 阻尼）
     * ω₀ = 2π/τ（固有频率），ζ = dampRatio（阻尼比）
     */
    _updatePointerDamped(dt) {
        const target  = this._tempToAngle(this._tempSensor);
        const omega0  = (2 * Math.PI) / Math.max(0.5, this.tauSec * 0.4);
        const zeta    = this.dampRatio;
        const error   = target - this._pointerAngle;
        const spring  = omega0 * omega0 * error;
        const damping = 2 * zeta * omega0 * this._pointerVelocity;
        const acc     = spring - damping;
        this._pointerVelocity += acc * dt;
        this._pointerAngle    += this._pointerVelocity * dt;
    }

    /**
     * 一阶热响应（含迟滞）
     */
    _updateThermal(dt) {
        const tau   = this.tauSec;
        const alpha = 1 - Math.exp(-dt / tau);

        // 迟滞：升温时读数略低，降温时略高
        const rising    = this._tempTarget > this._tempSensor;
        const hysteresis = rising ? -this.hysteresis * 0.5 : this.hysteresis * 0.5;

        this._tempSensor += alpha * (this._tempTarget - this._tempSensor);

        // 误差模型（±accuracy% FS + 随机噪声）
        const fsRange  = this.tempMax - this.tempMin;
        const errBias  = (this.accuracy / 100) * fsRange * 0.4; // 系统误差
        this._tempDisplay = this._tempSensor + hysteresis + errBias * 0.1;

        // 过量程检测
        this._overRange = (this._tempDisplay < this.tempMin - fsRange * 0.02)
                       || (this._tempDisplay > this.tempMax + fsRange * 0.02);
        if (this._overRange) {
            this._overRangeFlash += dt;
        } else {
            this._overRangeFlash = 0;
        }
    }

    // ═══════════════════════════════════════════
    // 集中化 tick（由 consys._tickAll 在 20fps 调用）
    tick(dt) {
        this._updateThermal(dt);
        this._updatePointerDamped(dt);
        this._coilAngle = this._tempToCoilExpand(this._tempSensor);

        // 玻璃反光轻微漂移
        this._glassPhase += dt * 0.3;

        // ── 惰性重建：只有显示值变化时才重绘图形 ──
        // 避免每帧销毁/创建 Konva 节点 + 重建缓存
        if (this._lastRebuildDisplay === undefined || Math.abs(this._tempDisplay - this._lastRebuildDisplay) > 0.005) {
            this._lastRebuildDisplay = this._tempDisplay;
            this._rebuildCoil();
            this._rebuildPointer();
            this._updateStatusPanel();
            this._refreshCache();
        }
    }

    // ── 颜色辅助 ─────────────────────────────
    _getTempColor(T) {
        if (T > this.tempMax * 0.9) return '#ef5350';
        if (T > this.tempMax * 0.7) return '#ffa726';
        if (T < this.tempMin + (this.tempMax - this.tempMin) * 0.1) return '#5c6bc0';
        return '#66bb6a';
    }

    // ═══════════════════════════════════════════
    // ── 公开 API ─────────────────────────────

    /** 设置被测介质温度（°C） */
    setTemperature(tempC) {
        this._tempTarget = Math.max(
            this.tempMin - 10,
            Math.min(this.tempMax + 10, tempC)
        );
    }

    /** 立即跳变（不经过热响应过程） */
    setTemperatureImmediate(tempC) {
        this._tempTarget  = tempC;
        this._tempSensor  = tempC;
        this._tempDisplay = tempC;
        this._pointerAngle = this._tempToAngle(tempC);
        this._pointerVelocity = 0;
    }

    /** 读取当前示数（°C，含热惯性和误差） */
    getReading()      { return this._tempDisplay; }

    /** 读取指针角度（°，150~390） */
    getPointerAngle() { return this._pointerAngle; }

    /** 是否过量程 */
    isOverRange()     { return this._overRange; }

    update(state) {
        if (typeof state === 'number')             this.setTemperature(state);
        else if (state && typeof state.temp === 'number') this.setTemperature(state.temp);
        this._refreshCache();
    }

    getConfigFields() {
        return [
            { label: '位号/名称',           key: 'label',       type: 'text'   },
            { label: '量程下限 (°C)',        key: 'tempMin',     type: 'number' },
            { label: '量程上限 (°C)',        key: 'tempMax',     type: 'number' },
            { label: '初始温度 (°C)',        key: 'initTemp',    type: 'number' },
            { label: '热响应时间常数 τ (s)', key: 'tauSec',      type: 'number' },
            { label: '阻尼比 (0~1)',         key: 'dampRatio',   type: 'number' },
            { label: '热滞后 (°C)',          key: 'hysteresis',  type: 'number' },
            { label: '基本误差 (% FS)',      key: 'accuracy',    type: 'number' },
            { label: '保护管长度 (mm)',      key: 'stemLen',     type: 'number' },
        ];
    }

    onConfigUpdate(cfg) {
        if (cfg.label    !== undefined) this.label     = cfg.label;
        if (cfg.tempMin  !== undefined) this.tempMin   = parseFloat(cfg.tempMin);
        if (cfg.tempMax  !== undefined) this.tempMax   = parseFloat(cfg.tempMax);
        if (cfg.tauSec   !== undefined) this.tauSec    = parseFloat(cfg.tauSec);
        if (cfg.dampRatio!== undefined) this.dampRatio = parseFloat(cfg.dampRatio);
        if (cfg.hysteresis!==undefined) this.hysteresis= parseFloat(cfg.hysteresis);
        if (cfg.accuracy !== undefined) this.accuracy  = parseFloat(cfg.accuracy);
        if (cfg.stemLen  !== undefined) this.stemLen   = parseFloat(cfg.stemLen);
        if (cfg.initTemp !== undefined) this.setTemperature(parseFloat(cfg.initTemp));
        this.config = { ...this.config, ...cfg };
        this._refreshCache();
    }

    destroy() {
        super.destroy?.();
    }
}