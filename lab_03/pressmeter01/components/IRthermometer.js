import { BaseComponent } from './BaseComponent.js';

/**
 * 手持式红外测温仪仿真组件
 * （Handheld Infrared Thermometer / IR Pyrometer）
 *
 * ── 测量原理 ──────────────────────────────────────────────────
 *
 *  一切温度高于绝对零度（-273.15°C）的物体都向外辐射电磁波，
 *  其辐射功率由斯特藩-玻尔兹曼定律描述：
 *
 *  ┌─────────────────────────────────────────────────────────┐
 *  │  全辐射：  W = ε · σ · T⁴                              │
 *  │  实际探测：仪器只接收 8~14μm 红外波段能量               │
 *  │                                                         │
 *  │  其中：                                                 │
 *  │    ε  — 目标发射率（0~1，设置值）                       │
 *  │    σ  — 斯特藩-玻尔兹曼常数 5.67×10⁻⁸ W/(m²·K⁴)       │
 *  │    T  — 目标绝对温度（K）                               │
 *  │                                                         │
 *  │  测量公式：                                             │
 *  │    T_measured = ⁴√(W_detected / (ε · σ)) − 273.15     │
 *  │                                                         │
 *  │  D:S比（距离:光斑）= 测量距离 / 光斑直径                │
 *  │    D:S=12:1 → 距离1m时光斑直径约83mm                   │
 *  └─────────────────────────────────────────────────────────┘
 *
 * ── 光学系统 ──────────────────────────────────────────────────
 *
 *  红外光学镜头（ZnSe / Germanium 锗镜头）
 *  → 滤光片（8~14μm 带通）
 *  → 热释电探测器（Pyroelectric Detector，LiTaO₃ 晶体）
 *     或 热电堆（Thermopile Array，多结热电偶串联）
 *  → 前置放大器（低噪声运放）
 *  → ADC → MCU（数字信号处理、发射率补偿、环境温度补偿）
 *  → LCD 显示
 *
 * ── 激光瞄准系统 ──────────────────────────────────────────────
 *
 *  双激光（Dual Laser）或单激光（Single Laser）瞄准
 *  功率：< 1mW（Class II 安全等级）
 *  波长：635~670nm（红色可见光）
 *  作用：指示测量光斑中心位置（非测温用途）
 *
 * ── 器件结构（正视图）────────────────────────────────────────
 *
 *  ┌───────────────────────────────────────────────────┐
 *  │                                                   │
 *  │  ┌─────────────────────────────────────────────┐ │
 *  │  │        LCD 数字显示屏                        │ │
 *  │  │  ┌──────────────────────────────────────┐   │ │
 *  │  │  │  38.5°C   ε=0.95   D:S=12           │   │ │
 *  │  │  │  MAX:42.1  MIN:36.8  ALM:⚠           │   │ │
 *  │  │  └──────────────────────────────────────┘   │ │
 *  │  └─────────────────────────────────────────────┘ │
 *  │                                                   │
 *  │  ○ 激光孔（双激光）  ◎ 镜头（IR 探测窗口）        │
 *  │                                                   │
 *  │  [MODE] [SET] [MAX] [°C/°F]  ← 功能按键区         │
 *  │                                                   │
 *  │  ┌──────────────────────────────────────────┐    │
 *  │  │              手柄区域                    │    │
 *  │  │         ▓ 扳机（Trigger）▓               │    │
 *  │  └──────────────────────────────────────────┘    │
 *  │                                                   │
 *  └───────────────────────────────────────────────────┘
 *
 * ── 各部件详解 ────────────────────────────────────────────────
 *
 *  1. 机身外壳（Housing）
 *     - ABS + 橡胶包覆，防跌落设计
 *     - 前部：测量头（IR 窗口 + 激光孔）
 *     - 后部：LCD 显示屏 + 按键区
 *     - 下部：手柄 + 扳机结构
 *     - 电池仓（9V 叠层电池）
 *
 *  2. IR 探测窗口（Detection Window）
 *     - 外径约 18mm 的锗晶体（Ge）或聚乙烯（PE）窗口
 *     - 透过 8~14μm 波段，阻断可见光
 *     - 外观为深色（红外材料通常为黑色/深灰）
 *
 *  3. 激光瞄准孔（Laser Apertures）
 *     - 双激光：左右各一孔，直径约 3mm
 *     - 发射时可见红色激光点（CLASS II）
 *
 *  4. LCD 显示屏（Display）
 *     - 分辨率：0.1°C
 *     - 显示内容：主温度（大字）、发射率、D:S比、
 *                MAX/MIN 温度、报警指示、电量
 *
 *  5. 按键组（Keypad）
 *     - TRIGGER：扳机，按下开始测量，松开保持显示
 *     - MODE：切换单点/扫描模式
 *     - SET：设置发射率 ε（0.10~1.00 步进 0.01）
 *     - °C/°F：切换温度单位
 *     - MAX/MIN：显示最大/最小温度
 *
 *  6. 扳机（Trigger）
 *     - 微动开关结构
 *     - 按下：激光开启 + 开始采样
 *     - 松开：激光关闭 + 数据保持（Hold）
 *
 * ── 测量误差模型 ──────────────────────────────────────────────
 *
 *  基本精度：±1.5°C 或 ±1.5%（取大值）—— 常温范围
 *  重复性：  ±0.5°C
 *  发射率误差：|ε_actual - ε_set| × T 造成系统偏差
 *  环境温度补偿：仪器内部温度传感器（NTC）实时修正
 *  响应时间：< 500ms（单次采样）
 *
 * ── 仿真动画 ──────────────────────────────────────────────────
 *
 *  1. 扳机按下/松开：弹簧动画，同步开关激光
 *  2. 激光射线：从双激光孔射出的红色细光束（含光晕）
 *  3. 测量光斑：目标面上的圆形热辐射区域（橙红渐变）
 *  4. LCD 显示刷新：数字跳变动画（含小数点闪烁）
 *  5. IR 探测窗口：测量时内部蓝紫光闪烁（探测器工作）
 *  6. 报警闪烁：超过报警阈值时 LCD 红色闪烁
 *  7. 扫描模式：连续刷新，温度跟踪实时变化
 *  8. Hold 保持：松开扳机后显示冻结，指示灯常亮
 *
 * ── 端口 ─────────────────────────────────────────────────────
 *  pin_signal — 模拟信号输出（0~5V 对应量程）
 *  pin_alarm  — 报警数字输出（0V 正常 / 5V 报警）
 *  pin_vcc    — 电源正（9V）
 *  pin_gnd    — 电源地
 *
 * ── 公开 API ─────────────────────────────────────────────────
 *  setTargetTemp(T, ε)  — 设置目标温度和发射率
 *  pressTrigger()       — 按下扳机（开始测量）
 *  releaseTrigger()     — 松开扳机（保持读数）
 *  setEmissivity(ε)     — 设置发射率 0.10~1.00
 *  setAlarmThreshold(T) — 设置报警温度
 *  setUnit(unit)        — 'C' 或 'F'
 *  getReading()         — 读取当前示数
 *  isAlarming()         — 是否报警
 */
export class IRThermometer extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.width  = Math.max(200, config.width  || 260);
        this.height = Math.max(300, config.height || 380);

        this.type    = 'ir_thermometer';
        this.special = 'sensor';
        this.cache   = 'fixed';

        // ── 仪器参数 ──
        this.label         = config.label         || 'TIR';
        this.dsRatio       = config.dsRatio        || 12;     // D:S 比
        this.emissivity    = config.emissivity     || 0.95;   // 发射率 ε
        this.alarmHigh     = config.alarmHigh      || 50;     // 高温报警阈值 °C
        this.alarmLow      = config.alarmLow       || -10;    // 低温报警阈值 °C
        this.unit          = config.unit           || 'C';    // 'C' / 'F'
        this.responseMs    = config.responseMs     || 500;    // 响应时间 ms
        this.accuracy      = config.accuracy       || 1.5;    // °C 基本精度

        // ── 测量状态 ──
        const initT            = config.initTemp !== undefined ? config.initTemp : 25;
        this._targetTemp       = initT;        // 目标物体真实温度
        this._targetEmissivity = this.emissivity;  // 目标实际发射率
        this._ambientTemp      = config.ambient !== undefined ? config.ambient : 22;

        this._measuring        = false;        // 是否正在测量（扳机按下）
        this._holdTemp         = null;         // Hold 模式保持的温度
        this._measuredTemp     = initT;        // 当前测量结果（含误差）
        this._displayTemp      = initT;        // LCD 显示温度（含刷新惯性）
        this._maxTemp          = initT;        // 最高值记录
        this._minTemp          = initT;        // 最低值记录
        this._sampleTimer      = 0;            // 采样计时
        this._sampleInterval   = this.responseMs / 1000;

        // ── 按键/触发状态 ──
        this._triggerDown      = false;        // 扳机物理按下
        this._triggerAnim      = 0;            // 扳机动画进度 0~1（0=松，1=按下）
        this._laserOn          = false;        // 激光状态
        this._laserIntensity   = 0;            // 激光强度（含渐入渐出）

        // ── 报警状态 ──
        this._alarming         = false;
        this._alarmFlash       = 0;

        // ── 显示动画 ──
        this._lcdFlash         = 0;            // LCD 更新闪烁相位
        this._irGlow           = 0;            // 探测窗口内部辉光
        this._dotBlink         = 0;            // 小数点闪烁相位
        this._scanLine         = 0;            // LCD 扫描线位置

        // ── 几何布局 ──
        const W = this.width, H = this.height;

        // 机身主体（枪形，上部为测量头，下部为手柄）
        // 上部矩形区域（测量头 + 显示屏）
        this._body = {
            headX:  W * 0.06,
            headY:  H * 0.03,
            headW:  W * 0.88,
            headH:  H * 0.50,
            rx:     W * 0.05,
        };

        // 手柄区域
        this._handle = {
            x:  W * 0.24,
            y:  this._body.headY + this._body.headH - 2,
            w:  W * 0.52,
            h:  H * 0.40,
            rx: W * 0.06,
        };

        // LCD 屏幕区域
        this._lcd = {
            x:  W * 0.12,
            y:  H * 0.06,
            w:  W * 0.76,
            h:  H * 0.30,
            rx: W * 0.025,
        };

        // 前端测量头（左侧，IR 镜头 + 激光孔）
        this._head = {
            cx: W * 0.12,
            cy: H * 0.12,
        };

        // IR 探测窗口
        this._irWindow = {
            cx: W * 0.12,
            cy: this._body.headY + this._body.headH * 0.72,
            r:  W * 0.075,
        };

        // 双激光孔
        this._laser = [
            { cx: W * 0.065, cy: this._body.headY + this._body.headH * 0.55 },
            { cx: W * 0.175, cy: this._body.headY + this._body.headH * 0.55 },
        ];

        // 扳机
        this._trigger = {
            x:  W * 0.32,
            y:  this._handle.y + this._handle.h * 0.12,
            w:  W * 0.16,
            h:  H * 0.14,
            rx: W * 0.025,
        };

        // 功能按键区
        this._buttons = [
            { label: 'MODE',   x: W*0.14, y: this._body.headY + this._body.headH * 0.26 },
            { label: 'SET ε',  x: W*0.36, y: this._body.headY + this._body.headH * 0.26 },
            { label: 'MAX',    x: W*0.58, y: this._body.headY + this._body.headH * 0.26 },
            { label: '°C/°F', x: W*0.78, y: this._body.headY + this._body.headH * 0.26 },
        ];

        // 端口（信号输出端子，位于底部）
        this._portSignal = {
            x: W * 0.6,
            y: this._handle.y + this._handle.h ,
        };
        this._portGND    = { x: W * 0.4, y: this._handle.y + this._handle.h  };

        // （rAF 循环已迁移至 consys._tickAll）

        this._init();

        // 端口注册
        this.addPort(this._portSignal.x, this._portSignal.y, 'l', 'wire', 'p');
        this.addPort(this._portGND.x,    this._portGND.y,    'r',    'wire', 'n');
    }

    // ═══════════════════════════════════════════
    _init() {
        this._drawBody();          // 机身外壳（静态）
        this._drawIRWindow();      // IR 探测窗口（静态骨架）
        this._drawButtons();       // 功能按键（静态）
        this._drawScrewDetails();  // 螺钉/缝隙细节
        this._drawLabel();

        // 动态层（从底到顶）
        this._laserGroup   = new Konva.Group();  // 激光射线（最底层，在机身之下）
        this._bodyTopGroup = new Konva.Group();  // 机身高光（中层）
        this._lcdGroup     = new Konva.Group();  // LCD 内容（中层）
        this._triggerGroup = new Konva.Group();  // 扳机（最顶层）
        this._irGlowGroup  = new Konva.Group();  // IR 窗口辉光

        this.group.add(this._laserGroup);
        this.group.add(this._bodyTopGroup);
        this.group.add(this._lcdGroup);
        this.group.add(this._irGlowGroup);
        this.group.add(this._triggerGroup);

        this._drawBodyHighlights();
        this._rebuildTrigger();
        this._rebuildLCD();
        this._rebuildLaser();
        this._rebuildIRGlow();

        this._bindInteraction();
    }

    // ── 机身外壳（静态基础层）────────────────
    _drawBody() {
        const b = this._body, hd = this._handle, W = this.width;

        // ── 手柄 ──
        const gHandle = new Konva.Rect({
            x: hd.x, y: hd.y,
            width: hd.w, height: hd.h,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint:   { x: hd.w, y: 0 },
            fillLinearGradientColorStops: [
                0,   '#1a1e26',
                0.15,'#2a3040',
                0.5, '#323848',
                0.85,'#2a3040',
                1,   '#1a1e26',
            ],
            cornerRadius: [0, 0, hd.rx, hd.rx],
            stroke: '#141820', strokeWidth: 1,
            shadowColor: '#000', shadowBlur: 10, shadowOffsetY: 4, shadowOpacity: 0.5,
        });
        this.group.add(gHandle);

        // 手柄橡胶防滑纹（细横纹）
        for (let i = 0; i < 10; i++) {
            const ry = hd.y + hd.h * 0.20 + i * (hd.h * 0.60 / 10);
            this.group.add(new Konva.Line({
                points: [hd.x + 4, ry, hd.x + hd.w - 4, ry],
                stroke: 'rgba(0,0,0,0.22)', strokeWidth: 0.8,
            }));
        }

        // ── 机身上部（测量头区域）──
        this.group.add(new Konva.Rect({
            x: b.headX, y: b.headY,
            width: b.headW, height: b.headH,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint:   { x: b.headW, y: b.headH },
            fillLinearGradientColorStops: [
                0,   '#242830',
                0.3, '#2e3440',
                0.7, '#2a3038',
                1,   '#1e2228',
            ],
            cornerRadius: b.rx,
            stroke: '#12161e', strokeWidth: 1.2,
        }));

        // 机身左侧斜切面（测量前端造型）
        this.group.add(new Konva.Shape({
            sceneFunc(ctx, shape) {
                ctx.beginPath();
                ctx.moveTo(b.headX, b.headY + b.headH * 0.38);
                ctx.lineTo(b.headX + b.headW * 0.08, b.headY + b.headH * 0.05);
                ctx.lineTo(b.headX + b.headW * 0.18, b.headY);
                ctx.lineTo(b.headX, b.headY);
                ctx.closePath();
                ctx.fillStrokeShape(shape);
            },
            fill: '#92450a',
            stroke: '#12161e', strokeWidth: 0.8,
        }));

        // 机身与手柄连接处圆弧（枪形造型）
        this.group.add(new Konva.Shape({
            sceneFunc(ctx, shape) {
                const jx = hd.x, jy = hd.y;
                const ex = b.headX + b.headW * 0.28;
                ctx.beginPath();
                ctx.moveTo(jx, jy);
                ctx.quadraticCurveTo(jx - W * 0.06, jy - b.headH * 0.12, ex, jy - b.headH * 0.04);
                ctx.lineTo(b.headX + b.headW, jy - b.headH * 0.04);
                ctx.lineTo(b.headX + b.headW, jy);
                ctx.lineTo(hd.x + hd.w, jy);
                ctx.closePath();
                ctx.fillStrokeShape(shape);
            },
            fill: '#1e8509',
            stroke: '#141820', strokeWidth: 0.8,
        }));

        // 电池仓盖（手柄背面矩形）
        const batW = hd.w * 0.70, batH = hd.h * 0.30;
        const batX = hd.x + (hd.w - batW)/2;
        const batY = hd.y + hd.h * 0.60;
        this.group.add(new Konva.Rect({
            x: batX, y: batY, width: batW, height: batH,
            fill: '#2265eb', stroke: '#0e1216', strokeWidth: 0.8,
            cornerRadius: 3,
        }));
        // 电池仓标识
        this.group.add(new Konva.Text({
            x: batX, y: batY + batH * 0.25,
            width: batW, text: '9V ⬡',
            fontSize: 7, fill: 'rgba(255,255,255,0.12)',
            align: 'center', fontFamily: 'Courier New',
        }));
        // 电池仓螺钉
        [0.25, 0.75].forEach(fx => {
            this.group.add(new Konva.Circle({
                x: batX + batW * fx, y: batY + batH * 0.50,
                radius: 2.5, fill: '#28467b', stroke: '#0a0e14', strokeWidth: 0.6,
            }));
            this.group.add(new Konva.Line({
                points: [batX + batW*fx - 1.5, batY + batH*0.50,
                         batX + batW*fx + 1.5, batY + batH*0.50],
                stroke: '#1a2030', strokeWidth: 0.7,
            }));
        });

        // 品牌铭牌（机身上部右侧）
        const pY = b.headY + b.headH * 0.80;
        this.group.add(new Konva.Rect({
            x: b.headX + b.headW * 0.36, y: pY,
            width: b.headW * 0.55, height: b.headH * 0.14,
            fill: '#1a2030', stroke: '#0e1620', strokeWidth: 0.5,
            cornerRadius: 2,
        }));
        this.group.add(new Konva.Text({
            x: b.headX + b.headW * 0.36, y: pY + 2,
            width: b.headW * 0.55,
            text: `IR-${this.dsRatio}:1  ε=${this.emissivity.toFixed(2)}`,
            fontSize: 12, fill: 'rgba(2, 118, 234, 0.6)',
            align: 'center', fontFamily: 'Courier New',
        }));
    }

    // ── 机身高光与材质细节 ───────────────────
    _drawBodyHighlights() {
        const b = this._body, W = this.width;

        // 机身顶部高光弧
        this._bodyTopGroup.add(new Konva.Rect({
            x: b.headX + 2, y: b.headY + 2,
            width: b.headW - 4, height: b.headH * 0.08,
            fill: 'rgba(255,255,255,0.05)',
            cornerRadius: [b.rx, b.rx, 0, 0],
        }));

        // 左侧边缘高光线
        this._bodyTopGroup.add(new Konva.Line({
            points: [b.headX + 1.5, b.headY + b.rx,
                     b.headX + 1.5, b.headY + b.headH * 0.85],
            stroke: 'rgba(255,255,255,0.07)', strokeWidth: 1.5, lineCap: 'round',
        }));
    }

    // ── IR 探测窗口（静态骨架）────────────────
    _drawIRWindow() {
        const iw = this._irWindow, W = this.width;

        // 外圈金属环（不锈钢）
        this.group.add(new Konva.Circle({
            x: iw.cx, y: iw.cy, radius: iw.r + 4,
            fillRadialGradientStartPoint:  { x: -iw.r*0.3, y: -iw.r*0.3 },
            fillRadialGradientEndPoint:    { x: 0, y: 0 },
            fillRadialGradientStartRadius: iw.r * 0.6,
            fillRadialGradientEndRadius:   iw.r + 4,
            fillRadialGradientColorStops: [
                0,   '#8090a0',
                0.4, '#607080',
                0.7, '#4a5a6a',
                1,   '#2a3a48',
            ],
            stroke: '#1a2830', strokeWidth: 0.8,
        }));

        // 外圈刻线（光学仪器风格）
        for (let i = 0; i < 8; i++) {
            const ang = (i / 8) * Math.PI * 2;
            this.group.add(new Konva.Line({
                points: [
                    iw.cx + Math.cos(ang) * (iw.r + 1),
                    iw.cy + Math.sin(ang) * (iw.r + 1),
                    iw.cx + Math.cos(ang) * (iw.r + 3.5),
                    iw.cy + Math.sin(ang) * (iw.r + 3.5),
                ],
                stroke: 'rgba(100,140,180,0.40)', strokeWidth: 0.6,
            }));
        }

        // 锗晶体窗口（深色）
        this.group.add(new Konva.Circle({
            x: iw.cx, y: iw.cy, radius: iw.r,
            fillRadialGradientStartPoint:  { x: -iw.r*0.25, y: -iw.r*0.25 },
            fillRadialGradientEndPoint:    { x: 0, y: 0 },
            fillRadialGradientStartRadius: 0,
            fillRadialGradientEndRadius:   iw.r,
            fillRadialGradientColorStops: [
                0,   '#1a2230',
                0.5, '#101820',
                0.85,'#0a1018',
                1,   '#050c12',
            ],
            stroke: '#0a1420', strokeWidth: 0.5,
        }));

        // 镜头反光环（金属镀膜效果）
        this.group.add(new Konva.Circle({
            x: iw.cx, y: iw.cy, radius: iw.r * 0.70,
            fill: 'transparent',
            stroke: 'rgba(80,120,160,0.25)', strokeWidth: 1.2,
        }));
        this.group.add(new Konva.Circle({
            x: iw.cx, y: iw.cy, radius: iw.r * 0.42,
            fill: 'transparent',
            stroke: 'rgba(60,100,140,0.18)', strokeWidth: 0.8,
        }));

        // 镜头高光（左上反射点）
        this.group.add(new Konva.Ellipse({
            x: iw.cx - iw.r * 0.32, y: iw.cy - iw.r * 0.30,
            radiusX: iw.r * 0.20, radiusY: iw.r * 0.13,
            fill: 'rgba(180,210,240,0.18)',
            rotation: -35,
        }));

        // 双激光孔
        this._laser.forEach(lp => {
            this.group.add(new Konva.Circle({
                x: lp.cx, y: lp.cy, radius: W * 0.022,
                fill: '#0a0e14',
                stroke: 'rgba(80,100,120,0.50)', strokeWidth: 0.8,
            }));
            // 激光孔内圈
            this.group.add(new Konva.Circle({
                x: lp.cx, y: lp.cy, radius: W * 0.012,
                fill: '#060a10',
                stroke: 'rgba(60,80,100,0.35)', strokeWidth: 0.5,
            }));
        });
    }

    // ── 功能按键（静态）─────────────────────
    _drawButtons() {
        const W = this.width;
        const btnW = W * 0.120, btnH = this.height * 0.040;

        this._buttons.forEach((btn, i) => {
            const bx = btn.x - btnW / 2;
            const by = btn.y - btnH / 2;

            // 按键主体
            this.group.add(new Konva.Rect({
                x: bx, y: by, width: btnW, height: btnH,
                fillLinearGradientStartPoint: { x: 0, y: 0 },
                fillLinearGradientEndPoint:   { x: 0, y: btnH },
                fillLinearGradientColorStops: [
                    0,   '#3a4254',
                    0.4, '#2e3848',
                    1,   '#222a38',
                ],
                stroke: '#141a26', strokeWidth: 0.8,
                cornerRadius: 3,
                shadowColor: '#000', shadowBlur: 3, shadowOffsetY: 1, shadowOpacity: 0.5,
            }));
            // 按键高光
            this.group.add(new Konva.Rect({
                x: bx + 1, y: by + 1, width: btnW - 2, height: 2,
                fill: 'rgba(255,255,255,0.08)',
                cornerRadius: [3, 3, 0, 0],
            }));
            // 按键文字
            this.group.add(new Konva.Text({
                x: bx, y: by + btnH * 0.18,
                width: btnW, height: btnH,
                text: btn.label,
                fontSize: Math.max(10, W * 0.042),
                fill: 'rgba(170,195,225,0.75)',
                align: 'center',
                fontFamily: 'Arial, sans-serif',
                fontStyle: 'bold',
            }));
        });
    }

    // ── 螺钉与缝隙细节 ───────────────────────
    _drawScrewDetails() {
        const b = this._body, hd = this._handle, W = this.width;

        // 机身螺钉（4角）
        [
            [b.headX + 8,           b.headY + 8],
            [b.headX + b.headW - 8, b.headY + 8],
            [b.headX + 8,           b.headY + b.headH - 8],
            [b.headX + b.headW - 8, b.headY + b.headH - 8],
        ].forEach(([sx, sy]) => {
            this.group.add(new Konva.Circle({
                x: sx, y: sy, radius: 2.8,
                fill: '#1a2030', stroke: '#0e1420', strokeWidth: 0.6,
            }));
            this.group.add(new Konva.Line({
                points: [sx - 1.8, sy - 1.8, sx + 1.8, sy + 1.8],
                stroke: '#283040', strokeWidth: 0.7, lineCap: 'round',
            }));
        });

        // 机身顶部分模线
        this.group.add(new Konva.Line({
            points: [
                b.headX + b.rx, b.headY + b.headH * 0.50,
                b.headX + b.headW - b.rx, b.headY + b.headH * 0.50,
            ],
            stroke: 'rgba(0,0,0,0.25)', strokeWidth: 0.8,
        }));

        // 手柄侧面分模线
        this.group.add(new Konva.Line({
            points: [
                hd.x + hd.w * 0.50, hd.y + 4,
                hd.x + hd.w * 0.50, hd.y + hd.h - 4,
            ],
            stroke: 'rgba(0,0,0,0.20)', strokeWidth: 0.6,
        }));

        // 腕带孔（手柄底部）
        this.group.add(new Konva.Ellipse({
            x: hd.x + hd.w * 0.82, y: hd.y + hd.h * 0.88,
            radiusX: W * 0.03, radiusY: W * 0.018,
            fill: '#12161e', stroke: '#0a0e16', strokeWidth: 0.8,
        }));
    }

    // ── 扳机（动态重绘）─────────────────────
    _rebuildTrigger() {
        this._triggerGroup.destroyChildren();
        const tr  = this._trigger, W = this.width;
        const dp  = this._triggerAnim * W * 0.018;    // 按下时的位移

        // 扳机主体（向内按下时 y 增大）
        this._triggerGroup.add(new Konva.Rect({
            x: tr.x + dp * 0.5, y: tr.y + dp,
            width: tr.w, height: tr.h,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint:   { x: tr.w, y: tr.h },
            fillLinearGradientColorStops: [
                0,   '#e84020',
                0.3, '#c83018',
                0.7, '#a02510',
                1,   '#7a1c0c',
            ],
            cornerRadius: tr.rx,
            stroke: '#5a1008', strokeWidth: 1,
            shadowColor: '#000', shadowBlur: this._triggerDown ? 2 : 6,
            shadowOffsetY: this._triggerDown ? 1 : 3,
            shadowOpacity: 0.5,
        }));

        // 扳机表面纹理
        for (let i = 0; i < 4; i++) {
            const gy = tr.y + dp + tr.h * 0.20 + i * (tr.h * 0.55 / 4);
            this._triggerGroup.add(new Konva.Line({
                points: [tr.x + dp*0.5 + 3, gy, tr.x + dp*0.5 + tr.w - 3, gy],
                stroke: 'rgba(0,0,0,0.20)', strokeWidth: 0.8, lineCap: 'round',
            }));
        }

        // 扳机高光
        this._triggerGroup.add(new Konva.Rect({
            x: tr.x + dp*0.5 + 2, y: tr.y + dp + 2,
            width: tr.w - 4, height: tr.h * 0.20,
            fill: 'rgba(255,180,100,0.15)',
            cornerRadius: [tr.rx, tr.rx, 0, 0],
        }));

        // 扳机状态指示（激活时微发光）
        if (this._triggerDown) {
            this._triggerGroup.add(new Konva.Rect({
                x: tr.x - 2, y: tr.y - 2,
                width: tr.w + 4, height: tr.h + 4,
                fill: 'transparent',
                stroke: 'rgba(255,100,30,0.40)',
                strokeWidth: 2,
                cornerRadius: tr.rx + 2,
            }));
        }
    }

    // ── LCD 显示（动态重绘）──────────────────
    _rebuildLCD() {
        this._lcdGroup.destroyChildren();
        const lcd = this._lcd, W = this.width;

        // LCD 背板（深绿/深蓝背景）
        this._lcdGroup.add(new Konva.Rect({
            x: lcd.x, y: lcd.y, width: lcd.w, height: lcd.h,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint:   { x: lcd.w, y: lcd.h },
            fillLinearGradientColorStops: [
                0,   '#0a1820',
                0.5, '#0c1e2a',
                1,   '#081418',
            ],
            stroke: '#060e14', strokeWidth: 1,
            cornerRadius: lcd.rx,
        }));

        // LCD 扫描线效果（每帧向下移动的半透明条）
        const scanY = lcd.y + (this._scanLine % 1) * lcd.h;
        this._lcdGroup.add(new Konva.Rect({
            x: lcd.x + 2, y: scanY,
            width: lcd.w - 4, height: lcd.h * 0.06,
            fill: 'rgba(0,220,180,0.025)',
            cornerRadius: 1,
        }));

        // LCD 玻璃反光（顶部高光）
        this._lcdGroup.add(new Konva.Rect({
            x: lcd.x + 2, y: lcd.y + 2,
            width: lcd.w - 4, height: lcd.h * 0.14,
            fill: 'rgba(100,200,220,0.06)',
            cornerRadius: [lcd.rx, lcd.rx, 0, 0],
        }));

        const T     = this._measuring ? this._measuredTemp
                    : (this._holdTemp !== null ? this._holdTemp : this._measuredTemp);
        const Tshow = this.unit === 'F' ? (T * 9/5 + 32) : T;
        const unit  = this.unit === 'F' ? '°F' : '°C';

        // ── 报警闪烁控制 ──
        const alarmFlash = this._alarming
            ? Math.abs(Math.sin(this._alarmFlash * Math.PI * 3.5)) > 0.5
            : false;

        if (!alarmFlash) {
            // ── 主温度数字（大字）──
            const mainTxt = isFinite(Tshow) ? Tshow.toFixed(1) : '---';
            this._lcdGroup.add(new Konva.Text({
                x: lcd.x + 4, y: lcd.y + lcd.h * 0.06,
                width: lcd.w * 0.72, height: lcd.h * 0.50,
                text: mainTxt,
                fontSize: lcd.h * 0.44,
                fill: this._alarming ? '#ff6040' : '#00e8c0',
                align: 'right',
                fontFamily: 'Courier New, monospace',
                fontStyle: 'bold',
            }));

            // 单位
            this._lcdGroup.add(new Konva.Text({
                x: lcd.x + lcd.w * 0.74, y: lcd.y + lcd.h * 0.08,
                width: lcd.w * 0.22, height: lcd.h * 0.35,
                text: unit,
                fontSize: lcd.h * 0.22,
                fill: '#00c8aa',
                align: 'left',
                fontFamily: 'Arial, sans-serif',
            }));
        } else {
            // 报警时整行红色闪烁
            this._lcdGroup.add(new Konva.Rect({
                x: lcd.x + 4, y: lcd.y + lcd.h * 0.06,
                width: lcd.w - 8, height: lcd.h * 0.50,
                fill: 'rgba(255,60,30,0.15)',
                cornerRadius: 2,
            }));
            this._lcdGroup.add(new Konva.Text({
                x: lcd.x + 4, y: lcd.y + lcd.h * 0.10,
                width: lcd.w - 8,
                text: '⚠ ALARM',
                fontSize: lcd.h * 0.28,
                fill: '#ff4020',
                align: 'center',
                fontFamily: 'Arial, sans-serif',
                fontStyle: 'bold',
            }));
        }

        // ── 副显示行：ε、D:S、HOLD ──
        const subY = lcd.y + lcd.h * 0.58;
        const subFontSize = Math.max(6, lcd.h * 0.115);


        // HOLD / 测量中 状态
        const holdActive = !this._measuring && this._holdTemp !== null;
        this._lcdGroup.add(new Konva.Text({
            x: lcd.x + lcd.w * 0.40, y: subY,
            text: holdActive ? 'HOLD' : (this._measuring ? '●REC' : '   '),
            fontSize: subFontSize,
            fill: holdActive ? '#ffa040' : '#40e080',
            fontFamily: 'Courier New',
            fontStyle: 'bold',
        }));

        // ── MAX / MIN 行 ──
        const mmY = lcd.y + lcd.h * 0.75;
        const mmFontSize = Math.max(5.5, lcd.h * 0.100);

        const maxTshow = this.unit === 'F' ? (this._maxTemp*9/5+32) : this._maxTemp;
        const minTshow = this.unit === 'F' ? (this._minTemp*9/5+32) : this._minTemp;

        this._lcdGroup.add(new Konva.Text({
            x: lcd.x + 6, y: mmY,
            text: `MAX ${maxTshow.toFixed(1)}${unit}`,
            fontSize: mmFontSize, fill: '#ff8060',
            fontFamily: 'Courier New',
        }));
        this._lcdGroup.add(new Konva.Text({
            x: lcd.x + lcd.w * 0.50, y: mmY,
            text: `MIN ${minTshow.toFixed(1)}${unit}`,
            fontSize: mmFontSize, fill: '#60c0ff',
            fontFamily: 'Courier New',
        }));

        // ── 电量指示（右上角）──
        const batX = lcd.x + lcd.w - 22, batY2 = lcd.y + 5;
        this._lcdGroup.add(new Konva.Rect({
            x: batX, y: batY2, width: 16, height: 8,
            fill: 'transparent', stroke: '#00c8aa', strokeWidth: 0.8, cornerRadius: 1,
        }));
        this._lcdGroup.add(new Konva.Rect({
            x: batX + 16, y: batY2 + 2, width: 2, height: 4,
            fill: '#00c8aa',
        }));
        // 电量条（模拟80%）
        this._lcdGroup.add(new Konva.Rect({
            x: batX + 1, y: batY2 + 1, width: 11, height: 6,
            fill: '#00c8aa', cornerRadius: 0.5,
        }));

        // LCD 边框（轻微内发光）
        this._lcdGroup.add(new Konva.Rect({
            x: lcd.x, y: lcd.y, width: lcd.w, height: lcd.h,
            fill: 'transparent',
            stroke: 'rgba(0,200,180,0.20)',
            strokeWidth: 1, cornerRadius: lcd.rx,
        }));
    }

    // ── 激光射线（动态重绘）──────────────────
    _rebuildLaser() {
        this._laserGroup.destroyChildren();
        if (this._laserIntensity < 0.02) return;

        const li   = this._laserIntensity;
        const W    = this.width;
        const rayL = W * 2.8;   // 激光射程（画面外）

        this._laser.forEach((lp, idx) => {
            // 激光光束（细长矩形渐变）
            this._laserGroup.add(new Konva.Shape({
                sceneFunc(ctx, shape) {
                    ctx.save();
                    // 向左射出（仪器正对左侧目标）
                    const x0 = lp.cx - W * 0.06;
                    const x1 = lp.cx - rayL;

                    // 光束渐变（近端亮，远端散）
                    const grd = ctx.createLinearGradient(x0, 0, x1, 0);
                    grd.addColorStop(0,   `rgba(255,30,20,${li * 0.90})`);
                    grd.addColorStop(0.15,`rgba(255,60,20,${li * 0.75})`);
                    grd.addColorStop(0.5, `rgba(255,80,30,${li * 0.35})`);
                    grd.addColorStop(1,   `rgba(255,100,40,0)`);

                    ctx.beginPath();
                    ctx.moveTo(x0, lp.cy - 0.6);
                    ctx.lineTo(x1, lp.cy - 1.8);
                    ctx.lineTo(x1, lp.cy + 1.8);
                    ctx.lineTo(x0, lp.cy + 0.6);
                    ctx.closePath();
                    ctx.fillStyle = grd;
                    ctx.fill();
                    ctx.restore();
                },
            }));

            // 激光点（出口处辉光）
            this._laserGroup.add(new Konva.Circle({
                x: lp.cx - W * 0.04, y: lp.cy,
                radius: W * 0.012 * li,
                fill: `rgba(255,40,20,${li * 0.95})`,
                shadowColor: 'rgba(255,30,10,1)',
                shadowBlur: 6 * li,
                shadowOpacity: li * 0.9,
            }));
        });

        // 激光汇聚点（测量光斑，在射线左端）
        if (li > 0.3) {
            const spX = this._laser[0].cx - rayL * 0.55;
            const spY = (this._laser[0].cy + this._laser[1].cy) / 2;
            const spR = W * 0.05 + W * 0.04 * li;

            // 光斑热辐射效果（温度越高颜色越深）
            const hotFrac = Math.max(0, Math.min(1,
                (this._measuredTemp - 20) / 60));
            const rr = Math.round(255), rg = Math.round(80 - hotFrac*60), rb = 20;

            this._laserGroup.add(new Konva.Circle({
                x: spX, y: spY, radius: spR * 2.5,
                fillRadialGradientStartPoint:  { x: 0, y: 0 },
                fillRadialGradientEndPoint:    { x: 0, y: 0 },
                fillRadialGradientStartRadius: 0,
                fillRadialGradientEndRadius:   spR * 2.5,
                fillRadialGradientColorStops: [
                    0,   `rgba(${rr},${rg},${rb},${li * 0.20})`,
                    0.5, `rgba(${rr},${rg},${rb},${li * 0.08})`,
                    1,   `rgba(${rr},${rg},${rb},0)`,
                ],
            }));
            // 激光瞄准点核心
            this._laserGroup.add(new Konva.Circle({
                x: spX, y: spY, radius: spR,
                fill: `rgba(255,40,10,${li * 0.35})`,
                stroke: `rgba(255,60,20,${li * 0.60})`,
                strokeWidth: 1,
            }));
            this._laserGroup.add(new Konva.Line({
                points: [spX - spR*1.4, spY, spX - spR*0.6, spY],
                stroke: `rgba(255,50,20,${li * 0.70})`, strokeWidth: 0.8,
            }));
            this._laserGroup.add(new Konva.Line({
                points: [spX + spR*0.6, spY, spX + spR*1.4, spY],
                stroke: `rgba(255,50,20,${li * 0.70})`, strokeWidth: 0.8,
            }));
            this._laserGroup.add(new Konva.Line({
                points: [spX, spY - spR*1.4, spX, spY - spR*0.6],
                stroke: `rgba(255,50,20,${li * 0.70})`, strokeWidth: 0.8,
            }));
            this._laserGroup.add(new Konva.Line({
                points: [spX, spY + spR*0.6, spX, spY + spR*1.4],
                stroke: `rgba(255,50,20,${li * 0.70})`, strokeWidth: 0.8,
            }));
        }
    }

    // ── IR 探测窗口辉光（动态）──────────────
    _rebuildIRGlow() {
        this._irGlowGroup.destroyChildren();
        const iw = this._irWindow;
        const g  = this._irGlow;
        if (g < 0.02) return;

        // 探测器工作辉光（蓝紫色，红外探测器感应色）
        this._irGlowGroup.add(new Konva.Circle({
            x: iw.cx, y: iw.cy, radius: iw.r * 0.75,
            fillRadialGradientStartPoint:  { x: 0, y: 0 },
            fillRadialGradientEndPoint:    { x: 0, y: 0 },
            fillRadialGradientStartRadius: 0,
            fillRadialGradientEndRadius:   iw.r * 0.75,
            fillRadialGradientColorStops: [
                0,   `rgba(80,120,255,${g * 0.50})`,
                0.5, `rgba(60,80,200,${g * 0.25})`,
                1,   `rgba(40,60,160,0)`,
            ],
            shadowColor: `rgba(80,120,255,${g * 0.80})`,
            shadowBlur: 8 * g,
            shadowOpacity: 0.9,
        }));

        // 探测器中心亮点
        this._irGlowGroup.add(new Konva.Circle({
            x: iw.cx, y: iw.cy, radius: iw.r * 0.18,
            fill: `rgba(140,180,255,${g * 0.70})`,
        }));
    }

    // ── 标注 ─────────────────────────────────
    _drawLabel() {
        const W = this.width;
        this.group.add(new Konva.Text({
            x: 0, y: -20, width: W,
            text: `${this.label}  手持红外测温仪`,
            fontSize: 12, fontStyle: 'bold', fill: '#546e7a',
            align: 'center', fontFamily: 'Arial, sans-serif',
        }));
        this.group.add(new Konva.Text({
            x: 0, y: -6, width: W,
            text: `D:S=${this.dsRatio}:1  ε=${this.emissivity.toFixed(2)}  ±${this.accuracy}°C`,
            fontSize: 12, fill: '#3a5a7a',
            align: 'center', fontFamily: 'Courier New',
        }));
    }

    // ── 交互绑定 ─────────────────────────────
    _bindInteraction() {
        // 点击扳机区域触发测量
        const hitRect = new Konva.Rect({
            x:  this._trigger.x - 4,
            y:  this._trigger.y - 4,
            width:  this._trigger.w + 8,
            height: this._trigger.h + 8,
            fill: 'transparent',
        });
        this.group.add(hitRect);

        hitRect.on('mousedown touchstart', () => this.pressTrigger());
        hitRect.on('mouseup touchend',     () => this.releaseTrigger());
        hitRect.on('mouseleave',           () => {
            if (this._triggerDown) this.releaseTrigger();
        });
    }

    // ═══════════════════════════════════════════
    // ── 物理/测量模型 ────────────────────────

    /**
     * 红外测量误差模型
     * 发射率偏差 → 温度误差
     * W_measured = ε_set · σ · T_target⁴  （实际目标发射率≠设置值时有误差）
     * 还原温度 T_meas = ⁴√(W_actual / (ε_set·σ))
     */
    _calcMeasuredTemp() {
        const T_K    = this._targetTemp + 273.15;
        const e_act  = this._targetEmissivity;  // 目标真实发射率
        const e_set  = this.emissivity;          // 仪器设置发射率
        const sigma  = 5.67e-8;

        // 探测器接收到的辐射功率（含环境背景辐射补偿简化）
        const T_amb_K = this._ambientTemp + 273.15;
        const W_act   = e_act * sigma * (Math.pow(T_K, 4) - Math.pow(T_amb_K, 4) * 0.05);
        // 用设置的发射率还原温度
        const T_meas_K = Math.pow(W_act / (e_set * sigma) + Math.pow(T_amb_K, 4) * 0.05, 0.25);
        let T_meas     = T_meas_K - 273.15;

        // 叠加仪器基本误差（±accuracy°C 随机）
        const noise = (Math.random() * 2 - 1) * this.accuracy * 0.35;
        T_meas += noise;

        return Math.round(T_meas * 10) / 10;
    }

    // ═══════════════════════════════════════════
    // 集中化 tick（由 consys._tickAll 在 20fps 调用）
    tick(dt) {
        this._animTime = (this._animTime || 0) + dt;
        const ts = this._animTime * 1000;

        // 扳机动画（弹簧缓动）
        const targetTrig = this._triggerDown ? 1 : 0;
        this._triggerAnim += (targetTrig - this._triggerAnim) * Math.min(1, dt * 18);

        // 激光强度渐入渐出
        const targetLaser = this._triggerDown ? 1 : 0;
        this._laserIntensity += (targetLaser - this._laserIntensity) * Math.min(1, dt * 12);

        // 测量采样（按下扳机时）
        if (this._measuring) {
            this._sampleTimer += dt;
            if (this._sampleTimer >= this._sampleInterval) {
                this._sampleTimer = 0;
                this._measuredTemp = this._calcMeasuredTemp();
                this._maxTemp = Math.max(this._maxTemp, this._measuredTemp);
                this._minTemp = Math.min(this._minTemp, this._measuredTemp);
            }
            // 显示温度平滑跟踪
            this._displayTemp += (this._measuredTemp - this._displayTemp) * Math.min(1, dt * 4);
        }

        // IR 探测窗口辉光
        const targetGlow = this._measuring ? 0.55 + Math.sin(ts * 0.008) * 0.25 : 0;
        this._irGlow += (targetGlow - this._irGlow) * Math.min(1, dt * 8);

        // 报警检测
        this._alarming = this._measuredTemp > this.alarmHigh || this._measuredTemp < this.alarmLow;
        if (this._alarming) this._alarmFlash += dt;
        else this._alarmFlash = 0;

        // LCD 扫描线
        this._scanLine = (this._scanLine + dt * 0.45) % 1;

        // ── 帧节流：连续动画每 4 帧（~5fps）重建一次图形 ──
        this._frameCount = (this._frameCount || 0) + 1;
        if (this._frameCount % 4 === 0) {
            this._rebuildTrigger();
            this._rebuildLCD();
            this._rebuildLaser();
            this._rebuildIRGlow();
            this._refreshCache();
        }
    }

    // ═══════════════════════════════════════════
    // ── 公开 API ─────────────────────────────

    /** 设置目标温度和（可选）目标发射率 */
    setTargetTemp(T, emissivity) {
        this._targetTemp = T;
        if (emissivity !== undefined) {
            this._targetEmissivity = Math.max(0.01, Math.min(1.0, emissivity));
        }
    }

    /** 按下扳机（开始测量 + 激光开启） */
    pressTrigger() {
        if (this._triggerDown) return;
        this._triggerDown = true;
        this._measuring   = true;
        this._holdTemp    = null;
        this._sampleTimer = this._sampleInterval; // 立即首次采样
    }

    /** 松开扳机（停止测量，保持读数） */
    releaseTrigger() {
        if (!this._triggerDown) return;
        this._triggerDown = false;
        this._measuring   = false;
        this._holdTemp    = this._measuredTemp;
    }

    /** 设置仪器发射率（0.10 ~ 1.00） */
    setEmissivity(e) {
        this.emissivity = Math.max(0.10, Math.min(1.00, e));
    }

    /** 设置环境温度（用于背景辐射补偿） */
    setAmbientTemp(T) {
        this._ambientTemp = T;
    }

    /** 设置报警阈值 */
    setAlarmThreshold(high, low) {
        if (high !== undefined) this.alarmHigh = high;
        if (low  !== undefined) this.alarmLow  = low;
    }

    /** 切换单位 */
    setUnit(unit) {
        this.unit = (unit === 'F') ? 'F' : 'C';
    }

    /** 清除 MAX/MIN 记录 */
    clearMaxMin() {
        this._maxTemp = this._measuredTemp;
        this._minTemp = this._measuredTemp;
    }

    /** 读取当前示数（°C） */
    getReading() {
        return this._holdTemp !== null ? this._holdTemp : this._measuredTemp;
    }

    /** 是否报警 */
    isAlarming() { return this._alarming; }

    /** 是否正在测量 */
    isMeasuring() { return this._measuring; }

    update(state) {
        if (typeof state === 'number') {
            this.setTargetTemp(state);
        } else if (state && typeof state === 'object') {
            if (state.temp       !== undefined) this.setTargetTemp(state.temp, state.emissivity);
            if (state.emissivity !== undefined) this.setEmissivity(state.emissivity);
            if (state.unit       !== undefined) this.setUnit(state.unit);
            if (state.ambient    !== undefined) this.setAmbientTemp(state.ambient);
            if (state.measuring  === true)      this.pressTrigger();
            if (state.measuring  === false)     this.releaseTrigger();
        }
        this._refreshCache();
    }

    getConfigFields() {
        return [
            { label: '位号/名称',           key: 'label',       type: 'text'   },
            { label: 'D:S 距离比',           key: 'dsRatio',     type: 'number' },
            { label: '发射率 ε (0.10~1.00)', key: 'emissivity',  type: 'number' },
            { label: '初始目标温度 (°C)',     key: 'initTemp',    type: 'number' },
            { label: '环境温度 (°C)',         key: 'ambient',     type: 'number' },
            { label: '高温报警阈值 (°C)',     key: 'alarmHigh',   type: 'number' },
            { label: '低温报警阈值 (°C)',     key: 'alarmLow',    type: 'number' },
            { label: '响应时间 (ms)',         key: 'responseMs',  type: 'number' },
            { label: '基本精度 (°C)',         key: 'accuracy',    type: 'number' },
            { label: '单位 (C/F)',            key: 'unit',        type: 'text'   },
        ];
    }

    onConfigUpdate(cfg) {
        if (cfg.label      !== undefined) this.label      = cfg.label;
        if (cfg.dsRatio    !== undefined) this.dsRatio    = parseFloat(cfg.dsRatio);
        if (cfg.emissivity !== undefined) this.setEmissivity(parseFloat(cfg.emissivity));
        if (cfg.alarmHigh  !== undefined) this.alarmHigh  = parseFloat(cfg.alarmHigh);
        if (cfg.alarmLow   !== undefined) this.alarmLow   = parseFloat(cfg.alarmLow);
        if (cfg.responseMs !== undefined) {
            this.responseMs      = parseFloat(cfg.responseMs);
            this._sampleInterval = this.responseMs / 1000;
        }
        if (cfg.accuracy   !== undefined) this.accuracy   = parseFloat(cfg.accuracy);
        if (cfg.unit       !== undefined) this.setUnit(cfg.unit);
        if (cfg.ambient    !== undefined) this.setAmbientTemp(parseFloat(cfg.ambient));
        if (cfg.initTemp   !== undefined) this.setTargetTemp(parseFloat(cfg.initTemp));
        this.config = { ...this.config, ...cfg };
        this._refreshCache();
    }

    destroy() { super.destroy?.(); }
}