import { BaseComponent } from './BaseComponent.js';

/**
 * 热释电红外传感器仿真组件
 * （Pyroelectric Infrared Sensor / PIR Sensor）
 *
 * ── 物理原理 ──────────────────────────────────────────────────
 *
 *  热释电效应（Pyroelectric Effect）：
 *  某些晶体（如 LiTaO₃、PZT）在温度变化时，其自发极化强度
 *  P 发生改变，在晶体两端感生束缚电荷，产生可探测电信号：
 *
 *  ┌────────────────────────────────────────────────────────┐
 *  │                                                        │
 *  │  dP/dt = p · dT/dt                                     │
 *  │                                                        │
 *  │  其中：                                                 │
 *  │    P   — 自发极化强度（C/m²）                          │
 *  │    p   — 热释电系数（C/m²·K），典型值 ~4×10⁻⁵ C/m²·K  │
 *  │    T   — 晶体温度（K）                                 │
 *  │                                                        │
 *  │  关键特性：                                             │
 *  │  · 只响应温度「变化」，对静止目标无响应（区别于测温）   │
 *  │  · 输出电荷量正比于温度变化速率 dT/dt                  │
 *  │  · 8~14 μm 长波红外波段灵敏，对应人体辐射峰值          │
 *  │                                                        │
 *  └────────────────────────────────────────────────────────┘
 *
 * ── 器件内部结构 ──────────────────────────────────────────────
 *
 *  ┌───────────────────────────────────────────────────────┐
 *  │  菲涅尔透镜（Fresnel Lens）                            │
 *  │    聚焦红外辐射 → 分割视场为多个交替灵敏/盲区带        │
 *  │    使移动目标产生交替的信号脉冲                        │
 *  │                                                        │
 *  │  ┌─────────────────────────────────────────────────┐  │
 *  │  │  探测腔（Hermetic Package，TO-5/TO-18 金属管）   │  │
 *  │  │  充氮气密封，防潮防氧化                          │  │
 *  │  │                                                  │  │
 *  │  │   ① 双元探测元（Dual-element Detector）         │  │
 *  │  │      两片 LiTaO₃ 反向串联                       │  │
 *  │  │      同相干扰（振动/温漂）相互抵消               │  │
 *  │  │      异相信号（目标移动）差分放大                │  │
 *  │  │                                                  │  │
 *  │  │   ② JFET 源极跟随器（阻抗变换）                 │  │
 *  │  │      将高阻抗（>10GΩ）转为低阻抗输出            │  │
 *  │  │      集成在金属管内                              │  │
 *  │  │                                                  │  │
 *  │  │   ③ 红外滤光窗（IR Filter Window）              │  │
 *  │  │      硅基滤光片，透过 8~14 μm                   │  │
 *  │  │      截止可见光和短波红外干扰                   │  │
 *  │  └─────────────────────────────────────────────────┘  │
 *  └───────────────────────────────────────────────────────┘
 *
 * ── 信号处理电路 ──────────────────────────────────────────────
 *
 *  探测元（双元差分）
 *    → JFET 阻抗变换（管内集成）
 *    → 带通滤波放大（0.1~10Hz，对应人体移动频率）
 *    → 双阈值比较器（正负脉冲检测）
 *    → 单稳态触发（输出保持时间 Th 可调）
 *    → 数字输出（高电平/低电平）
 *
 *  典型信号链（以 HC-SR501 为例）：
 *    Sensor → BISS0001（专用 PIR 处理 IC）→ 数字 OUT
 *
 * ── BISS0001 处理芯片参数 ────────────────────────────────────
 *
 *  Vs（工作电压）：3.3V / 5V
 *  灵敏度调节（电位器 VR1）：3~7m 探测距离
 *  时间调节（电位器 VR2）：0.5s~5min 输出保持时间
 *  触发方式（跳线 H/L）：
 *    H（重复触发）：目标持续存在时持续输出高电平
 *    L（非重复触发）：每次运动触发一个固定时长脉冲
 *  封锁时间：200ms（防止重复触发）
 *
 * ── 菲涅尔透镜视场（FOV）────────────────────────────────────
 *
 *  典型视场角：水平 ±30°~±45°，垂直 ±15°~±20°
 *  菲涅尔透镜将视场分割为数组交替的「感应窗格」
 *  目标穿越窗格边界 → 辐射量交替增减 → 产生交变信号
 *  目标静止在一个窗格内 → 无信号（AC 响应本质）
 *
 *  感应窗格仿真（俯视平面图）：
 *
 *     ╔═══════╦═══════╦═══════╦═══════╗
 *     ║盲区   ║感应   ║盲区   ║感应   ║  ← 近距层（2m）
 *     ╠═══════╬═══════╬═══════╬═══════╣
 *     ║感应   ║盲区   ║感应   ║盲区   ║  ← 中距层（4m）
 *     ╠═══════╬═══════╬═══════╬═══════╣
 *     ║盲区   ║感应   ║盲区   ║感应   ║  ← 远距层（6m）
 *     ╚═══════╩═══════╩═══════╩═══════╝
 *
 * ── 仿真特性 ──────────────────────────────────────────────────
 *
 *  1. 双元探测单元：差分结构可视化（两片晶体，反向极化）
 *  2. 信号波形：探测腔内实时模拟 AC 差分信号曲线
 *  3. 菲涅尔透镜：同心圆环结构纹理（聚焦环）
 *  4. 人体目标模拟：目标在视场内移动，穿越窗格边界触发
 *  5. BISS0001 处理流程：信号 → 滤波 → 比较 → 单稳输出
 *  6. OUT 引脚电平动画：高电平绿色发光，低电平暗灰
 *  7. 探测距离圈：同心圆弧显示当前探测范围
 *  8. 温漂补偿：模拟温度变化对输出的影响（热释电误触）
 *  9. 封锁时间：触发后 200ms 内不响应新触发（视觉反馈）
 * 10. 触发模式切换：H（重复）/ L（单次）可视化
 *
 * ── 封装说明（HC-SR501 模块）────────────────────────────────
 *
 *  白色半球形菲涅尔透镜盖（直径约 23mm）
 *  绿色 PCB 基板（32mm × 24mm）
 *  底部三引脚（VCC / OUT / GND）
 *  两个电位器（灵敏度 VR1 / 时间 VR2）
 *  跳线帽（触发模式 H/L）
 *
 * ── 端口 ─────────────────────────────────────────────────────
 *  pin_vcc  — 电源正（DC 4.5V~20V，典型 5V）
 *  pin_out  — 数字信号输出（高=3.3V/检测到；低=0V/无目标）
 *  pin_gnd  — 电源地
 */
export class PIRSensor extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.width  = Math.max(160, config.width  || 200);
        this.height = Math.max(220, config.height || 270);

        this.type    = 'pir_sensor';
        this.special = 'sensor';
        this.cache   = 'fixed';

        // ── 器件参数 ──
        this.label         = config.label         || 'PIR';
        this.vcc           = config.vcc           || 5.0;      // V
        this.detectRange   = config.detectRange   || 5.0;      // m 探测距离
        this.holdTime      = config.holdTime      || 2.0;      // s 输出保持时间
        this.triggerMode   = config.triggerMode   || 'H';      // 'H'=重复 / 'L'=单次
        this.sensitivity   = config.sensitivity   || 0.75;     // 0~1 灵敏度
        this.blockTime     = config.blockTime     || 0.20;     // s 封锁时间

        // ── 探测状态 ──
        this._detected     = false;      // 是否检测到目标
        this._outHigh      = false;      // OUT 引脚当前电平
        this._holdTimer    = 0;          // 输出保持计时
        this._blockTimer   = 0;          // 封锁计时（封锁时间内不响应）
        this._inBlock      = false;      // 是否处于封锁状态

        // ── 模拟信号 ──
        this._rawSignal    = 0;          // 探测元原始输出 (-1~+1)
        this._filtSignal   = 0;          // 滤波后信号
        this._filtVel      = 0;          // 信号速度（二阶滤波）
        this._signalHistory = Array(80).fill(0); // 波形历史缓冲
        this._signalTimer  = 0;

        // ── 目标仿真 ──
        // 模拟一个在视场内移动的热源目标
        this._target = {
            active:   false,   // 目标是否在视场内
            angle:    0,       // 当前角度（水平，°，相对中轴）
            dist:     3.0,     // 距离（m）
            speed:    0,       // 移动角速度（°/s）
            zoneIdx:  0,       // 当前所在菲涅尔窗格序号
        };

        // ── 菲涅尔窗格 ──
        // 视场角 ±30°，分 8 个交替窗格（角度分界）
        this._fresnelZones = [-30, -22, -14, -6, 6, 14, 22, 30];

        // ── 动画 ──
        this._irGlow       = 0;          // 探测窗发光
        this._outGlow      = 0;          // OUT 引脚发光
        this._lensPhase    = 0;          // 透镜旋转动画相位
        this._crystalPhase = 0;          // 晶体极化动画
        this._envTemp      = config.envTemp || 22; // 环境温度（影响热噪声）
        this._thermalNoise = 0;          // 热噪声项

        this._lastTs = null;
        this._animId = null;

        // ── 几何布局 ──
        const W = this.width, H = this.height;

        // PCB 基板
        this._pcb = {
            x: W * 0.05,  y: H * 0.44,
            w: W * 0.90,  h: H * 0.43,
            rx: 3,
        };

        // 菲涅尔透镜（白色半球盖）
        this._lens = {
            cx: W * 0.50,
            cy: H * 0.24,
            r:  Math.min(W * 0.38, H * 0.19),
        };

        // 探测腔（透镜内部，可透视）
        this._cavity = {
            cx: W * 0.50,
            cy: H * 0.24,
            r:  this._lens.r * 0.42,
        };

        // BISS0001 IC（PCB 中心）
        this._biss = {
            x: W * 0.28, y: H * 0.50,
            w: W * 0.22, h: H * 0.13,
            rx: 1,
        };

        // 两个电位器
        this._pots = [
            { cx: W * 0.70, cy: H * 0.555, r: W * 0.065, label: 'VR1\nSens', angle: -0.8 + this.sensitivity * 2.4 },
            { cx: W * 0.70, cy: H * 0.720, r: W * 0.065, label: 'VR2\nTime', angle: -0.8 + (this.holdTime/10) * 2.4 },
        ];

        // 跳线帽
        this._jumper = {
            x: W * 0.14, y: H * 0.545,
            w: W * 0.10, h: H * 0.058,
        };

        // 三个引脚
        const pinY   = this._pcb.y + this._pcb.h + 4;
        const pinSpX = W * 0.22;
        this._pins = [
            { id: 'pin_vcc', label: 'VCC', x: W * 0.28, y: pinY },
            { id: 'pin_out', label: 'OUT', x: W * 0.50, y: pinY },
            { id: 'pin_gnd', label: 'GND', x: W * 0.72, y: pinY },
        ];

        this._init();

        // 注册端口
        this._pins.forEach(p => {
            this.addPort(p.x, p.y + 14, p.id, 'wire', p.label);
        });
    }

    // ═══════════════════════════════════════════
    _init() {
        this._drawPCB();             // PCB 基板（静态）
        this._drawLensShell();       // 菲涅尔透镜外壳（静态骨架）
        this._drawBISS0001();        // BISS0001 IC（静态）
        this._drawPotentiometers();  // 电位器（静态骨架）
        this._drawJumper();          // 跳线帽（静态）
        this._drawPins();            // 引脚金属（静态）
        this._drawPCBTracks();       // PCB 走线（静态）

        // 动态层（按 Z 序从下到上）
        this._lensInnerGroup  = new Konva.Group();  // 透镜内部细节
        this._crystalGroup    = new Konva.Group();  // 双元晶体
        this._fresnelGroup    = new Konva.Group();  // 菲涅尔环纹
        this._signalGroup     = new Konva.Group();  // 波形显示
        this._outLedGroup     = new Konva.Group();  // OUT 状态灯
        this._fovGroup        = new Konva.Group();  // 视场扇形
        this._glassCapGroup   = new Konva.Group();  // 透镜玻璃盖高光

        this.group.add(this._fovGroup);
        this.group.add(this._lensInnerGroup);
        this.group.add(this._crystalGroup);
        this.group.add(this._fresnelGroup);
        this.group.add(this._signalGroup);
        this.group.add(this._outLedGroup);
        this.group.add(this._glassCapGroup);

        this._drawLabel();
        this._drawStatusPanel();

        // 初始动态绘制
        this._rebuildLensInner();
        this._rebuildFresnel();
        this._rebuildCrystals();
        this._rebuildSignalWave();
        this._rebuildOutLED();
        this._rebuildFOV();
        this._rebuildGlassCap();

        this._bindInteraction();
        this._startAnimation();
    }

    // ══════════════════════════════════════════
    // ── 静态绘制层 ────────────────────────────

    _drawPCB() {
        const p = this._pcb, W = this.width;

        // PCB 主体（绿色玻纤板）
        this.group.add(new Konva.Rect({
            x: p.x, y: p.y, width: p.w, height: p.h,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint:   { x: p.w, y: p.h },
            fillLinearGradientColorStops: [
                0,   '#1a3a1a',
                0.3, '#1e4020',
                0.6, '#1c3a1c',
                1,   '#163016',
            ],
            stroke: '#0e2010', strokeWidth: 1,
            cornerRadius: p.rx,
            shadowColor: '#000', shadowBlur: 8,
            shadowOffsetY: 3, shadowOpacity: 0.40,
        }));
        // PCB 顶面哑光层
        this.group.add(new Konva.Rect({
            x: p.x + 1, y: p.y + 1, width: p.w - 2, height: p.h * 0.12,
            fill: 'rgba(60,140,40,0.06)',
            cornerRadius: [p.rx, p.rx, 0, 0],
        }));
        // 板边白色丝印框
        this.group.add(new Konva.Rect({
            x: p.x + 2, y: p.y + 2, width: p.w - 4, height: p.h - 4,
            fill: 'transparent',
            stroke: 'rgba(255,255,255,0.07)', strokeWidth: 0.6,
            cornerRadius: p.rx,
        }));
    }

    _drawLensShell() {
        const l = this._lens, c = this._cavity, W = this.width;

        // 透镜座圈（PCB 上的焊盘环）
        this.group.add(new Konva.Circle({
            x: l.cx, y: l.cy, radius: l.r + 6,
            fillRadialGradientStartPoint:  { x: 0, y: 0 },
            fillRadialGradientEndPoint:    { x: 0, y: 0 },
            fillRadialGradientStartRadius: l.r - 2,
            fillRadialGradientEndRadius:   l.r + 6,
            fillRadialGradientColorStops: [
                0,   '#c0a030',
                0.4, '#a88828',
                0.8, '#806820',
                1,   '#604c10',
            ],
            stroke: '#403008', strokeWidth: 0.8,
        }));
        // 透镜外壳（乳白半球）——静态底色
        this.group.add(new Konva.Circle({
            x: l.cx, y: l.cy, radius: l.r,
            fill: '#e8e6e0',
            stroke: '#c0beb8', strokeWidth: 0.8,
        }));
    }

    _drawBISS0001() {
        const b = this._biss, W = this.width;

        // IC 封装（黑色 DIP/SOP）
        this.group.add(new Konva.Rect({
            x: b.x, y: b.y, width: b.w, height: b.h,
            fill: '#101010',
            stroke: '#282828', strokeWidth: 0.8,
            cornerRadius: b.rx,
            shadowColor: '#000', shadowBlur: 3, shadowOffsetY: 1, shadowOpacity: 0.5,
        }));
        // IC 顶面标识点
        this.group.add(new Konva.Circle({
            x: b.x + 4, y: b.y + 4, radius: 1.8,
            fill: '#404040',
        }));
        // 丝印文字
        this.group.add(new Konva.Text({
            x: b.x + 2, y: b.y + b.h * 0.18,
            width: b.w - 4, text: 'BISS0001',
            fontSize: Math.max(4.5, W * 0.040),
            fill: 'rgba(200,200,180,0.65)',
            align: 'center',
            fontFamily: 'Courier New, monospace',
            fontStyle: 'bold',
        }));
        this.group.add(new Konva.Text({
            x: b.x + 2, y: b.y + b.h * 0.60,
            width: b.w - 4, text: 'PIR PROC',
            fontSize: Math.max(4, W * 0.034),
            fill: 'rgba(160,160,140,0.45)',
            align: 'center',
            fontFamily: 'Courier New',
        }));
        // IC 引脚（两侧小矩形）
        const pinW = b.w * 0.06, pinH = b.h * 0.22;
        [0.15, 0.38, 0.62, 0.85].forEach(fx => {
            // 上侧引脚
            this.group.add(new Konva.Rect({
                x: b.x + b.w * fx - pinW / 2, y: b.y - pinH,
                width: pinW, height: pinH,
                fill: '#a8a090', stroke: '#888070', strokeWidth: 0.4, cornerRadius: 0.5,
            }));
            // 下侧引脚
            this.group.add(new Konva.Rect({
                x: b.x + b.w * fx - pinW / 2, y: b.y + b.h,
                width: pinW, height: pinH,
                fill: '#a8a090', stroke: '#888070', strokeWidth: 0.4, cornerRadius: 0.5,
            }));
        });
    }

    _drawPotentiometers() {
        this._pots.forEach((pt, idx) => {
            // 电位器外圈（蓝色）
            this.group.add(new Konva.Circle({
                x: pt.cx, y: pt.cy, radius: pt.r + 2,
                fill: '#1a1a8a', stroke: '#101060', strokeWidth: 0.8,
                shadowColor: '#000', shadowBlur: 3, shadowOffsetY: 1, shadowOpacity: 0.4,
            }));
            // 电位器主体（灰黑旋钮）
            this.group.add(new Konva.Circle({
                x: pt.cx, y: pt.cy, radius: pt.r,
                fillRadialGradientStartPoint:  { x: -pt.r * 0.3, y: -pt.r * 0.3 },
                fillRadialGradientEndPoint:    { x: 0, y: 0 },
                fillRadialGradientStartRadius: 0,
                fillRadialGradientEndRadius:   pt.r,
                fillRadialGradientColorStops: [
                    0, '#4a4a52', 0.6, '#2a2a32', 1, '#1a1a20',
                ],
                stroke: '#141418', strokeWidth: 0.6,
            }));
            // 旋钮刻线（指针）
            const ang = pt.angle;
            this.group.add(new Konva.Line({
                points: [
                    pt.cx + Math.cos(ang) * pt.r * 0.22,
                    pt.cy + Math.sin(ang) * pt.r * 0.22,
                    pt.cx + Math.cos(ang) * pt.r * 0.82,
                    pt.cy + Math.sin(ang) * pt.r * 0.82,
                ],
                stroke: '#d0c880', strokeWidth: 1.4, lineCap: 'round',
            }));
            // 电位器标注
            const lbLines = pt.label.split('\n');
            lbLines.forEach((ln, li) => {
                this.group.add(new Konva.Text({
                    x: pt.cx - pt.r * 1.4, y: pt.cy + pt.r + 3 + li * 8,
                    width: pt.r * 2.8, text: ln,
                    fontSize: Math.max(5, this.width * 0.040),
                    fill: 'rgba(160,200,120,0.55)',
                    align: 'center', fontFamily: 'Courier New',
                }));
            });
        });
    }

    _drawJumper() {
        const j = this._jumper, W = this.width;
        const mode = this.triggerMode;

        // 跳线插针（两根）
        const pinW = j.w * 0.22;
        ['H', 'L'].forEach((lbl, i) => {
            const px = j.x + j.w * (i === 0 ? 0.22 : 0.78) - pinW / 2;
            this.group.add(new Konva.Rect({
                x: px, y: j.y - j.h * 0.8,
                width: pinW, height: j.h * 1.8,
                fill: '#c0b880', stroke: '#a09860', strokeWidth: 0.4, cornerRadius: 0.5,
            }));
        });
        // 跳线帽（覆盖选中的两根针）
        this.group.add(new Konva.Rect({
            x: j.x, y: j.y, width: j.w, height: j.h,
            fill: '#e04020',
            stroke: '#a02818', strokeWidth: 0.8,
            cornerRadius: 2,
            shadowColor: '#000', shadowBlur: 2, shadowOffsetY: 1, shadowOpacity: 0.4,
        }));
        // 跳线帽高光
        this.group.add(new Konva.Rect({
            x: j.x + 1, y: j.y + 1,
            width: j.w - 2, height: j.h * 0.35,
            fill: 'rgba(255,255,255,0.12)',
            cornerRadius: [2, 2, 0, 0],
        }));
        // 触发模式标注
        this.group.add(new Konva.Text({
            x: j.x - j.w * 0.6, y: j.y + j.h + 3,
            width: j.w * 2.2, text: mode === 'H' ? 'H:重复' : 'L:单次',
            fontSize: Math.max(5, W * 0.040),
            fill: 'rgba(220,160,80,0.65)',
            align: 'center', fontFamily: 'Courier New',
        }));
    }

    _drawPins() {
        this._pins.forEach((p, i) => {
            const pinLen = this.height * 0.055;
            const pinW   = this.width  * 0.025;
            const y0     = this._pcb.y + this._pcb.h;

            // 引脚金属杆
            this.group.add(new Konva.Rect({
                x: p.x - pinW / 2, y: y0,
                width: pinW, height: pinLen,
                fillLinearGradientStartPoint: { x: -pinW/2, y: 0 },
                fillLinearGradientEndPoint:   { x:  pinW/2, y: 0 },
                fillLinearGradientColorStops: [
                    0, '#606870', 0.3, '#b8c0c8', 0.6, '#d0d8e0', 0.85, '#a0a8b0', 1, '#606870',
                ],
                strokeWidth: 0,
            }));
            // 引脚标注
            this.group.add(new Konva.Text({
                x: p.x - 12, y: y0 + pinLen + 2,
                width: 24, text: p.label,
                fontSize: Math.max(6, this.width * 0.050),
                fill: i === 0 ? '#ef5350' : i === 1 ? '#66bb6a' : '#78909c',
                align: 'center', fontStyle: 'bold',
                fontFamily: 'Arial, sans-serif',
            }));
        });
    }

    _drawPCBTracks() {
        const W = this.width, H = this.height;
        const trackStyle = { stroke: '#c8a030', strokeWidth: 0.8, opacity: 0.50 };

        // BISS0001 → 引脚 OUT
        this.group.add(new Konva.Line({
            points: [
                this._biss.x + this._biss.w * 0.5, this._biss.y + this._biss.h,
                this._biss.x + this._biss.w * 0.5, this._pcb.y + this._pcb.h * 0.85,
                this._pins[1].x, this._pcb.y + this._pcb.h * 0.85,
                this._pins[1].x, this._pcb.y + this._pcb.h,
            ],
            ...trackStyle,
        }));
        // VCC 走线
        this.group.add(new Konva.Line({
            points: [
                this._pins[0].x, this._pcb.y + this._pcb.h,
                this._pins[0].x, this._pcb.y + this._pcb.h * 0.78,
                this._biss.x + this._biss.w * 0.1, this._pcb.y + this._pcb.h * 0.78,
                this._biss.x + this._biss.w * 0.1, this._biss.y + this._biss.h,
            ],
            ...trackStyle, stroke: '#e05030',
        }));
        // GND 走线
        this.group.add(new Konva.Line({
            points: [
                this._pins[2].x, this._pcb.y + this._pcb.h,
                this._pins[2].x, this._pcb.y + this._pcb.h * 0.92,
                this._pcb.x + this._pcb.w * 0.92, this._pcb.y + this._pcb.h * 0.92,
            ],
            ...trackStyle, stroke: '#4060c0',
        }));
        // 探测腔 → BISS（差分信号线对）
        const cav = this._cavity;
        [0.28, 0.34].forEach((fx, i) => {
            this.group.add(new Konva.Line({
                points: [
                    cav.cx - cav.r * 0.3 + i * cav.r * 0.6, cav.cy + cav.r * 0.95,
                    cav.cx - cav.r * 0.3 + i * cav.r * 0.6, this._pcb.y + this._pcb.h * 0.25,
                    this._biss.x + this._biss.w * fx, this._pcb.y + this._pcb.h * 0.25,
                    this._biss.x + this._biss.w * fx, this._biss.y,
                ],
                ...trackStyle, stroke: i === 0 ? '#c8c040' : '#80c060',
            }));
        });
    }

    // ══════════════════════════════════════════
    // ── 动态绘制层 ────────────────────────────

    /** 透镜内部细节（不含菲涅尔环纹） */
    _rebuildLensInner() {
        this._lensInnerGroup.destroyChildren();
        const l = this._lens, c = this._cavity;

        // 透镜内部半透明层（乳白）
        this._lensInnerGroup.add(new Konva.Circle({
            x: l.cx, y: l.cy, radius: l.r,
            fillRadialGradientStartPoint:  { x: -l.r * 0.2, y: -l.r * 0.3 },
            fillRadialGradientEndPoint:    { x: 0, y: 0 },
            fillRadialGradientStartRadius: 0,
            fillRadialGradientEndRadius:   l.r,
            fillRadialGradientColorStops: [
                0,   'rgba(245,242,238,0.92)',
                0.5, 'rgba(235,232,228,0.85)',
                0.85,'rgba(215,210,204,0.75)',
                1,   'rgba(190,185,178,0.60)',
            ],
            strokeWidth: 0,
        }));

        // 探测腔外圈（深色金属环）
        this._lensInnerGroup.add(new Konva.Circle({
            x: c.cx, y: c.cy, radius: c.r + 3,
            fillRadialGradientStartPoint:  { x: -(c.r+3)*0.3, y: -(c.r+3)*0.3 },
            fillRadialGradientEndPoint:    { x: 0, y: 0 },
            fillRadialGradientStartRadius: c.r * 0.5,
            fillRadialGradientEndRadius:   c.r + 3,
            fillRadialGradientColorStops: [
                0, '#707878', 0.5,'#505858', 0.85,'#383e3e', 1,'#1e2424',
            ],
            stroke: '#141a1a', strokeWidth: 0.8,
        }));

        // 探测腔窗口（硅滤光片，深紫色/黑色）
        const irGlow = this._irGlow;
        this._lensInnerGroup.add(new Konva.Circle({
            x: c.cx, y: c.cy, radius: c.r,
            fillRadialGradientStartPoint:  { x: -c.r * 0.25, y: -c.r * 0.25 },
            fillRadialGradientEndPoint:    { x: 0, y: 0 },
            fillRadialGradientStartRadius: 0,
            fillRadialGradientEndRadius:   c.r,
            fillRadialGradientColorStops: [
                0,   `rgba(${Math.round(60+irGlow*80)},${Math.round(30+irGlow*40)},${Math.round(80+irGlow*100)},1)`,
                0.55,`rgba(20,15,35,1)`,
                1,   `rgba(8,6,12,1)`,
            ],
            shadowColor: `rgba(120,60,220,${irGlow * 0.70})`,
            shadowBlur:  irGlow * 10,
            shadowOpacity: 1,
            stroke: '#0a0810', strokeWidth: 0.5,
        }));

        // 腔内高光
        this._lensInnerGroup.add(new Konva.Ellipse({
            x: c.cx - c.r * 0.28, y: c.cy - c.r * 0.30,
            radiusX: c.r * 0.24, radiusY: c.r * 0.14,
            fill: `rgba(180,160,220,${0.12 + irGlow * 0.22})`,
            rotation: -30,
        }));
    }

    /** 菲涅尔透镜同心环纹 */
    _rebuildFresnel() {
        this._fresnelGroup.destroyChildren();
        const l    = this._lens;
        const rings = 11;
        const phase = this._lensPhase;

        for (let i = 1; i <= rings; i++) {
            const r   = l.r * (i / rings);
            const w   = l.r / rings * 0.55;
            const opc = 0.04 + (1 - i / rings) * 0.09;

            this._fresnelGroup.add(new Konva.Circle({
                x: l.cx, y: l.cy, radius: r,
                fill: 'transparent',
                stroke: `rgba(160,155,145,${opc})`,
                strokeWidth: w,
            }));
        }

        // 透镜表面光泽（随 phase 轻微漂移，模拟光学涂层）
        const hx = l.cx - l.r * (0.22 + Math.sin(phase * 0.4) * 0.04);
        const hy = l.cy - l.r * (0.28 + Math.cos(phase * 0.3) * 0.03);
        this._fresnelGroup.add(new Konva.Ellipse({
            x: hx, y: hy,
            radiusX: l.r * 0.30, radiusY: l.r * 0.16,
            fill: `rgba(255,255,255,${0.10 + Math.sin(phase * 0.5) * 0.02})`,
            rotation: -25,
        }));
        this._fresnelGroup.add(new Konva.Ellipse({
            x: l.cx + l.r * 0.28, y: l.cy + l.r * 0.22,
            radiusX: l.r * 0.10, radiusY: l.r * 0.06,
            fill: 'rgba(255,255,255,0.05)',
            rotation: 20,
        }));
    }

    /** 双元 LiTaO₃ 热释电晶体 */
    _rebuildCrystals() {
        this._crystalGroup.destroyChildren();
        const c   = this._cavity;
        const sig = this._filtSignal;
        const ph  = this._crystalPhase;

        // 两片晶体（上下排列，反向极化）
        const cW  = c.r * 0.65, cH = c.r * 0.45;

        [[-1, 1], [1, -1]].forEach(([polarity, yDir], idx) => {
            const cy = c.cy + yDir * c.r * 0.26;

            // 晶体基底
            const cBright = 0.50 + sig * polarity * 0.28;
            const rr = Math.min(255, Math.round(140 * cBright + 60));
            const rg = Math.min(255, Math.round(80  * cBright + 30));
            const rb = Math.min(255, Math.round(160 * cBright + 60));

            this._crystalGroup.add(new Konva.Rect({
                x: c.cx - cW / 2, y: cy - cH / 2,
                width: cW, height: cH,
                fillLinearGradientStartPoint: { x: 0, y: 0 },
                fillLinearGradientEndPoint:   { x: cW, y: 0 },
                fillLinearGradientColorStops: [
                    0,   `rgba(${Math.round(rr*0.55)},${Math.round(rg*0.55)},${Math.round(rb*0.55)},0.90)`,
                    0.35,`rgba(${rr},${rg},${rb},0.95)`,
                    0.65,`rgba(${Math.round(rr*1.15)},${Math.round(rg*1.10)},${Math.round(rb*1.20)},0.95)`,
                    1,   `rgba(${Math.round(rr*0.65)},${Math.round(rg*0.65)},${Math.round(rb*0.70)},0.90)`,
                ],
                stroke: `rgba(${Math.round(rr*0.4)},${Math.round(rg*0.4)},${Math.round(rb*0.4)},0.60)`,
                strokeWidth: 0.6,
                cornerRadius: 1,
            }));

            // 极化方向箭头（±号指示）
            const arrowX = c.cx - cW / 2 - 5;
            const arrowY = cy;
            const arrowChar = polarity > 0 ? '+' : '−';
            const arrowCol  = polarity > 0
                ? `rgba(255,100,80,${0.55 + Math.abs(sig) * 0.35})`
                : `rgba(80,160,255,${0.55 + Math.abs(sig) * 0.35})`;
            this._crystalGroup.add(new Konva.Text({
                x: arrowX - 4, y: arrowY - 5,
                width: 10, height: 10,
                text: arrowChar,
                fontSize: 9, fill: arrowCol,
                align: 'center', fontStyle: 'bold',
                fontFamily: 'Arial',
            }));

            // 晶体极化波纹（交变信号时闪烁）
            const wave = Math.sin(ph * (idx % 2 === 0 ? 1 : -1) + idx * Math.PI);
            const wAlpha = Math.abs(sig) * 0.35 * (0.6 + wave * 0.4);
            if (wAlpha > 0.02) {
                this._crystalGroup.add(new Konva.Rect({
                    x: c.cx - cW / 2, y: cy - cH / 2,
                    width: cW, height: cH,
                    fill: polarity > 0
                        ? `rgba(255,120,60,${wAlpha})`
                        : `rgba(60,120,255,${wAlpha})`,
                    cornerRadius: 1,
                }));
            }
        });

        // 晶体间分隔线
        this._crystalGroup.add(new Konva.Line({
            points: [c.cx - c.r * 0.50, c.cy, c.cx + c.r * 0.50, c.cy],
            stroke: 'rgba(0,0,0,0.40)', strokeWidth: 0.7, lineCap: 'round',
        }));

        // JFET 符号（晶体下方）
        const jx = c.cx + c.r * 0.28, jy = c.cy;
        this._crystalGroup.add(new Konva.Text({
            x: jx - 8, y: jy - 5,
            width: 16, height: 10,
            text: 'J', fontSize: 7,
            fill: 'rgba(180,220,140,0.60)',
            align: 'center', fontFamily: 'Courier New', fontStyle: 'bold',
        }));
    }

    /** 模拟信号波形 */
    _rebuildSignalWave() {
        this._signalGroup.destroyChildren();
        const W  = this.width, p = this._pcb;

        // 波形显示区域（PCB 右下角小屏）
        const wx  = p.x + p.w * 0.03;
        const wy  = p.y + p.h * 0.38;
        const ww  = p.w * 0.52;
        const wh  = p.h * 0.26;

        // 背景
        this._signalGroup.add(new Konva.Rect({
            x: wx, y: wy, width: ww, height: wh,
            fill: '#060e0a', stroke: '#0a1e0e', strokeWidth: 0.8, cornerRadius: 2,
        }));
        // 网格线
        for (let i = 1; i <= 3; i++) {
            this._signalGroup.add(new Konva.Line({
                points: [wx, wy + wh * (i / 4), wx + ww, wy + wh * (i / 4)],
                stroke: 'rgba(0,80,30,0.35)', strokeWidth: 0.4,
            }));
        }
        // 0 基线
        this._signalGroup.add(new Konva.Line({
            points: [wx + 2, wy + wh / 2, wx + ww - 2, wy + wh / 2],
            stroke: 'rgba(0,140,60,0.30)', strokeWidth: 0.6,
        }));

        // 波形折线
        const hist  = this._signalHistory;
        const len   = hist.length;
        const pts   = [];
        for (let i = 0; i < len; i++) {
            const x = wx + 2 + (i / (len - 1)) * (ww - 4);
            const y = wy + wh / 2 - hist[i] * (wh * 0.42);
            pts.push(x, y);
        }
        if (pts.length >= 4) {
            this._signalGroup.add(new Konva.Line({
                points: pts,
                stroke: this._outHigh ? '#40ff80' : '#20c050',
                strokeWidth: 1.1,
                tension: 0.25,
                lineCap: 'round',
            }));
        }

        // 标注
        this._signalGroup.add(new Konva.Text({
            x: wx + 2, y: wy + 1,
            text: 'SIG', fontSize: 5,
            fill: 'rgba(50,180,80,0.55)',
            fontFamily: 'Courier New',
        }));
        this._signalGroup.add(new Konva.Text({
            x: wx + ww - 18, y: wy + 1,
            width: 18, text: this._filtSignal.toFixed(2),
            fontSize: 5, fill: 'rgba(50,200,80,0.55)',
            fontFamily: 'Courier New', align: 'right',
        }));
    }

    /** OUT 引脚状态 LED */
    _rebuildOutLED() {
        this._outLedGroup.destroyChildren();
        const outPin = this._pins[1];
        const W      = this.width;
        const p      = this._pcb;

        // LED 圆点（靠近 OUT 引脚）
        const ledX = outPin.x;
        const ledY = p.y + p.h * 0.10;
        const ledR = W * 0.040;

        const on = this._outHigh;
        const col = on ? '#40ff60' : '#1a2a1a';

        this._outLedGroup.add(new Konva.Circle({
            x: ledX, y: ledY, radius: ledR,
            fill: col,
            stroke: on ? '#20c040' : '#0e1a0e',
            strokeWidth: 0.8,
            shadowColor: on ? '#40ff60' : 'transparent',
            shadowBlur: on ? 10 : 0,
            shadowOpacity: 0.85,
        }));
        // LED 高光
        this._outLedGroup.add(new Konva.Ellipse({
            x: ledX - ledR * 0.28, y: ledY - ledR * 0.28,
            radiusX: ledR * 0.30, radiusY: ledR * 0.20,
            fill: `rgba(255,255,255,${on ? 0.45 : 0.10})`,
            rotation: -35,
        }));
        // 标注文字
        this._outLedGroup.add(new Konva.Text({
            x: ledX - 12, y: ledY + ledR + 2,
            width: 24,
            text: on ? `OUT\n${this.vcc.toFixed(1)}V` : 'OUT\n0V',
            fontSize: Math.max(5, W * 0.042),
            fill: on ? '#40ff60' : '#2a3a2a',
            align: 'center', fontFamily: 'Courier New', fontStyle: 'bold',
        }));

        // 封锁状态提示
        if (this._inBlock) {
            this._outLedGroup.add(new Konva.Text({
                x: ledX - 16, y: ledY - ledR - 12,
                width: 32, text: 'LOCK',
                fontSize: Math.max(5, W * 0.040),
                fill: 'rgba(255,160,30,0.80)',
                align: 'center', fontFamily: 'Courier New', fontStyle: 'bold',
            }));
        }
    }

    /** 视场（FOV）扇形与探测窗格 */
    _rebuildFOV() {
        this._fovGroup.destroyChildren();
        const l   = this._lens;
        const W   = this.width;

        // FOV 区域（透镜正上方，模拟俯视平面投影）
        // 以透镜中心为原点，向上绘制扇形
        const fovR   = l.r * 0.82;
        const zones  = this._fresnelZones;
        const nZones = zones.length - 1;

        for (let i = 0; i < nZones; i++) {
            const a0 = (zones[i]   - 90) * Math.PI / 180;  // 从正上方开始
            const a1 = (zones[i+1] - 90) * Math.PI / 180;
            const isSensitive = i % 2 === 0;     // 交替感应/盲区
            const isActive = this._target.active
                && Math.abs(this._target.angle) >= Math.min(Math.abs(zones[i]), Math.abs(zones[i+1]))
                && Math.abs(this._target.angle) <= Math.max(Math.abs(zones[i]), Math.abs(zones[i+1]));

            // 扇区颜色
            let fillColor;
            if (isSensitive) {
                fillColor = isActive && this._outHigh
                    ? 'rgba(60,255,80,0.18)'
                    : 'rgba(40,160,60,0.08)';
            } else {
                fillColor = 'rgba(20,30,25,0.04)';
            }

            this._fovGroup.add(new Konva.Shape({
                sceneFunc(ctx, shape) {
                    ctx.beginPath();
                    ctx.moveTo(l.cx, l.cy);
                    ctx.arc(l.cx, l.cy, fovR, a0, a1);
                    ctx.closePath();
                    ctx.fillStyle = fillColor;
                    ctx.fill();
                    if (isSensitive) {
                        ctx.strokeStyle = 'rgba(40,160,60,0.12)';
                        ctx.lineWidth   = 0.5;
                        ctx.stroke();
                    }
                },
            }));
        }

        // 目标指示点
        if (this._target.active) {
            const tAng = (this._target.angle - 90) * Math.PI / 180;
            const tR   = fovR * Math.min(0.95, this._target.dist / this.detectRange);
            const tx   = l.cx + Math.cos(tAng) * tR;
            const ty   = l.cy + Math.sin(tAng) * tR;

            this._fovGroup.add(new Konva.Circle({
                x: tx, y: ty,
                radius: W * 0.030,
                fill: `rgba(255,140,30,${0.55 + Math.abs(this._filtSignal) * 0.35})`,
                shadowColor: 'rgba(255,100,20,1)',
                shadowBlur: 6 * (0.4 + Math.abs(this._filtSignal) * 0.6),
                shadowOpacity: 0.8,
                stroke: 'rgba(255,160,50,0.70)', strokeWidth: 0.8,
            }));
            // 目标移动轨迹箭头
            if (Math.abs(this._target.speed) > 0.5) {
                const dir = this._target.speed > 0 ? 1 : -1;
                const ax  = tx + Math.cos(Math.PI / 2 + dir * 0.6) * W * 0.040;
                const ay  = ty + Math.sin(Math.PI / 2 + dir * 0.6) * W * 0.040;
                this._fovGroup.add(new Konva.Arrow({
                    points: [tx, ty, ax, ay],
                    pointerLength: 4, pointerWidth: 4,
                    fill: 'rgba(255,160,50,0.60)',
                    stroke: 'rgba(255,160,50,0.60)',
                    strokeWidth: 1,
                }));
            }
        }
    }

    /** 玻璃盖高光（最顶层） */
    _rebuildGlassCap() {
        this._glassCapGroup.destroyChildren();
        const l = this._lens;
        const p = this._lensPhase;

        // 透镜边缘
        this._glassCapGroup.add(new Konva.Circle({
            x: l.cx, y: l.cy, radius: l.r,
            fill: 'transparent',
            stroke: 'rgba(180,175,168,0.45)', strokeWidth: 0.8,
        }));
        // 主高光弧（顶部左侧）
        this._glassCapGroup.add(new Konva.Shape({
            sceneFunc(ctx, shape) {
                ctx.save();
                ctx.beginPath();
                ctx.arc(l.cx - l.r * 0.14, l.cy - l.r * 0.18, l.r * 0.62, Math.PI * 1.12, Math.PI * 1.72);
                ctx.strokeStyle = `rgba(255,255,255,${0.12 + Math.sin(p * 0.4) * 0.02})`;
                ctx.lineWidth   = l.r * 0.20;
                ctx.globalAlpha = 0.90;
                ctx.stroke();
                ctx.restore();
            },
        }));
    }

    _drawLabel() {
        const W = this.width;
        this.group.add(new Konva.Text({
            x: 0, y: -22, width: W,
            text: `${this.label}  热释电红外传感器`,
            fontSize: 9, fontStyle: 'bold', fill: '#546e7a',
            align: 'center', fontFamily: 'Arial, sans-serif',
        }));
        this.group.add(new Konva.Text({
            x: 0, y: -11, width: W,
            text: `HC-SR501  D:${this.detectRange}m  ${this.holdTime}s  [${this.triggerMode}]`,
            fontSize: 7, fill: '#3a5a7a',
            align: 'center', fontFamily: 'Courier New',
        }));
    }

    _drawStatusPanel() {
        const W   = this.width;
        const pinBottom = this._pins[0].y + this.height * 0.055 + 18;
        const panY = pinBottom + 4;

        this._statusGroup = new Konva.Group({ x: 0, y: panY });
        this.group.add(this._statusGroup);

        this._statusGroup.add(new Konva.Rect({
            x: 4, y: 0, width: W - 8, height: 52,
            fill: '#080e08', stroke: '#102010',
            strokeWidth: 0.8, cornerRadius: 4,
        }));

        this._statusDot = new Konva.Circle({
            x: 12, y: 11, radius: 3.2,
            fill: '#1a2a1a', stroke: '#102010', strokeWidth: 0.8,
        });
        this._statusGroup.add(this._statusDot);

        this._statLines = [];
        ['状态: 待机', 'OUT: 低电平 0V', '距离: -- m'].forEach((t, i) => {
            const n = new Konva.Text({
                x: 22, y: 4 + i * 15,
                width: W - 28, text: t,
                fontSize: 7.5, fill: '#2a4a2a',
                fontFamily: 'Courier New',
            });
            this._statusGroup.add(n);
            this._statLines.push(n);
        });
    }

    _updateStatusPanel() {
        if (!this._statLines) return;
        const on  = this._outHigh;
        const col = on ? '#40ff60' : '#2a4a2a';

        this._statLines[0].text(
            this._inBlock ? '状态: 封锁中'
            : on          ? '状态: 检测到目标!'
            : this._target.active ? '状态: 目标在视场'
            : '状态: 待机'
        );
        this._statLines[0].fill(on ? '#40ff80' : this._inBlock ? '#ffa030' : '#2a6a3a');
        this._statLines[1].text(`OUT: ${on ? `高电平 ${this.vcc.toFixed(1)}V` : '低电平 0V'}`);
        this._statLines[1].fill(col);
        this._statLines[2].text(`信号: ${this._filtSignal.toFixed(3)}  [${this.triggerMode}]`);

        this._statusDot.fill(on ? '#40ff60' : this._inBlock ? '#ffa030' : '#1a2a1a');
        this._statusDot.stroke(on ? '#20c040' : '#102010');
        this._statusDot.shadowColor(on ? '#40ff60' : 'transparent');
        this._statusDot.shadowBlur(on ? 6 : 0);
    }

    // ══════════════════════════════════════════
    // ── 物理/信号模型 ─────────────────────────

    /**
     * 菲涅尔窗格穿越检测
     * 目标移动时，其角度穿过窗格边界产生信号脉冲
     */
    _updateTargetSignal(dt) {
        const t = this._target;
        if (!t.active) {
            // 无目标：信号衰减至 0
            this._rawSignal *= Math.exp(-dt * 8);
            return;
        }

        // 目标移动（角度更新）
        const prevAngle = t.angle;
        t.angle += t.speed * dt;

        // 超出 FOV（±30°）则目标离开视场
        if (Math.abs(t.angle) > 32) {
            t.active = false;
            t.speed  = 0;
        }

        // 检测窗格穿越
        const prevZone = this._angleToZone(prevAngle);
        const currZone = this._angleToZone(t.angle);

        if (currZone !== prevZone) {
            // 穿越窗格边界：产生交变脉冲（±polarity 取决于窗格类型）
            const prevSens = prevZone % 2 === 0;
            const currSens = currZone % 2 === 0;
            if (prevSens !== currSens) {
                // 进入/离开灵敏区，产生信号脉冲
                const dir = (t.speed > 0) ? 1 : -1;
                const enterSens = currSens;
                this._rawSignal = dir * (enterSens ? 0.90 : -0.90)
                    * this.sensitivity
                    * Math.min(1, 1 - Math.abs(t.angle) / 32);
            }
        } else {
            // 在同一窗格内，信号指数衰减
            this._rawSignal *= Math.exp(-dt * 4.5);
        }

        // 热噪声叠加
        this._thermalNoise = (Math.random() - 0.5) * 0.015
            * (1 + Math.max(0, this._envTemp - 25) * 0.02);
        this._rawSignal += this._thermalNoise;
    }

    _angleToZone(angle) {
        const zones = this._fresnelZones;
        for (let i = 0; i < zones.length - 1; i++) {
            if (angle >= zones[i] && angle < zones[i + 1]) return i;
        }
        return angle < zones[0] ? -1 : zones.length - 1;
    }

    /**
     * 带通滤波（0.1~10 Hz 二阶模拟）
     * 模拟 BISS0001 内部滤波电路
     */
    _updateFilter(dt) {
        // 简化二阶带通：高通（去除 DC）+ 低通（去除高频）
        const omega  = 2 * Math.PI * 2.0;   // 中心频率 2Hz
        const zeta   = 0.65;
        const error  = this._rawSignal - this._filtSignal;
        const spring = omega * omega * error;
        const damp   = 2 * zeta * omega * this._filtVel;
        this._filtVel    += (spring - damp) * dt;
        this._filtSignal += this._filtVel * dt;
        // 信号幅值钳位
        this._filtSignal  = Math.max(-1.0, Math.min(1.0, this._filtSignal));
    }

    /**
     * 双阈值比较器 + 单稳输出（BISS0001 逻辑）
     */
    _updateOutput(dt) {
        const threshold = 0.25 * (1.1 - this.sensitivity * 0.8);

        // 封锁计时
        if (this._inBlock) {
            this._blockTimer += dt;
            if (this._blockTimer >= this.blockTime) {
                this._inBlock    = false;
                this._blockTimer = 0;
            }
        }

        // 检测触发条件（未处于封锁期）
        const triggered = !this._inBlock && Math.abs(this._filtSignal) > threshold;

        if (triggered && !this._outHigh) {
            // 上升沿触发
            this._outHigh  = true;
            this._holdTimer = 0;
        }

        if (this._outHigh) {
            if (this.triggerMode === 'H') {
                // 重复触发模式：持续有信号则保持
                if (triggered) this._holdTimer = 0;
                else           this._holdTimer += dt;
            } else {
                // 单次触发模式：固定保持时间
                this._holdTimer += dt;
            }

            if (this._holdTimer >= this.holdTime) {
                // 输出拉低，进入封锁期
                this._outHigh  = false;
                this._inBlock  = true;
                this._blockTimer = 0;
            }
        }
    }

    /** 更新信号历史缓冲（用于波形显示） */
    _updateSignalHistory(dt) {
        this._signalTimer += dt;
        if (this._signalTimer >= 0.04) {   // 25fps 波形刷新
            this._signalTimer = 0;
            this._signalHistory.shift();
            this._signalHistory.push(this._filtSignal);
        }
    }

    // ══════════════════════════════════════════
    _startAnimation() {
        const tick = ts => {
            if (this._lastTs !== null) {
                const dt = Math.min((ts - this._lastTs) / 1000, 0.05);
                this._tickAnimation(dt, ts);
            }
            this._lastTs = ts;
            this._animId = requestAnimationFrame(tick);
        };
        this._animId = requestAnimationFrame(tick);
    }

    _stopAnimation() {
        if (this._animId) { cancelAnimationFrame(this._animId); this._animId = null; }
    }

    _tickAnimation(dt, ts) {
        // 信号处理链
        this._updateTargetSignal(dt);
        this._updateFilter(dt);
        this._updateOutput(dt);
        this._updateSignalHistory(dt);

        // 探测腔辉光（正比于|信号|）
        const targetGlow = Math.abs(this._filtSignal) * 0.80
            + (this._outHigh ? 0.20 : 0);
        this._irGlow += (targetGlow - this._irGlow) * Math.min(1, dt * 6);

        // OUT LED 辉光
        const targetOutGlow = this._outHigh ? 1 : 0;
        this._outGlow += (targetOutGlow - this._outGlow) * Math.min(1, dt * 10);

        // 动画相位
        this._lensPhase    += dt * 0.8;
        this._crystalPhase += dt * Math.PI * (2 + Math.abs(this._filtSignal) * 4);

        // 动态重绘
        this._rebuildLensInner();
        this._rebuildFresnel();
        this._rebuildCrystals();
        this._rebuildSignalWave();
        this._rebuildOutLED();
        this._rebuildFOV();
        this._rebuildGlassCap();
        this._updateStatusPanel();
        this._refreshCache();
    }

    // ── 交互绑定（点击透镜模拟人体进入）────
    _bindInteraction() {
        const hitCircle = new Konva.Circle({
            x: this._lens.cx, y: this._lens.cy,
            radius: this._lens.r,
            fill: 'transparent',
        });
        this.group.add(hitCircle);
        hitCircle.on('click tap', () => this.simulateTarget());
    }

    // ══════════════════════════════════════════
    // ── 公开 API ─────────────────────────────

    /** 模拟目标进入视场（随机角度和速度） */
    simulateTarget(options = {}) {
        const side  = Math.random() > 0.5 ? 1 : -1;
        this._target.active = true;
        this._target.angle  = options.angle !== undefined ? options.angle : side * 28;
        this._target.dist   = options.dist  !== undefined ? options.dist  : 1.5 + Math.random() * (this.detectRange - 1.5);
        this._target.speed  = options.speed !== undefined ? options.speed : -side * (8 + Math.random() * 18);
    }

    /** 清除当前目标 */
    clearTarget() {
        this._target.active = false;
        this._target.speed  = 0;
    }

    /** 设置探测距离（m） */
    setDetectRange(d) {
        this.detectRange = Math.max(1, Math.min(10, d));
        this._pots[0].angle = -0.8 + (d / 10) * 2.4;
    }

    /** 设置输出保持时间（s） */
    setHoldTime(t) {
        this.holdTime = Math.max(0.5, Math.min(300, t));
        this._pots[1].angle = -0.8 + Math.min(1, t / 30) * 2.4;
    }

    /** 设置触发模式 */
    setTriggerMode(mode) {
        this.triggerMode = (mode === 'H') ? 'H' : 'L';
    }

    /** 设置灵敏度（0~1） */
    setSensitivity(s) {
        this.sensitivity = Math.max(0.1, Math.min(1.0, s));
    }

    /** 设置环境温度 */
    setEnvTemp(T) {
        this._envTemp = T;
    }

    /** 读取 OUT 引脚电平 */
    getOutput()   { return this._outHigh; }
    isDetected()  { return this._outHigh; }

    update(state) {
        if (typeof state === 'boolean' && state) {
            this.simulateTarget();
        } else if (state && typeof state === 'object') {
            if (state.target    === true)  this.simulateTarget(state);
            if (state.target    === false) this.clearTarget();
            if (state.range     !== undefined) this.setDetectRange(state.range);
            if (state.holdTime  !== undefined) this.setHoldTime(state.holdTime);
            if (state.mode      !== undefined) this.setTriggerMode(state.mode);
            if (state.sensitivity !== undefined) this.setSensitivity(state.sensitivity);
            if (state.envTemp   !== undefined) this.setEnvTemp(state.envTemp);
        }
        this._refreshCache();
    }

    getConfigFields() {
        return [
            { label: '位号/名称',           key: 'label',       type: 'text'   },
            { label: '电源电压 VCC (V)',     key: 'vcc',         type: 'number' },
            { label: '探测距离 (m)',         key: 'detectRange', type: 'number' },
            { label: '输出保持时间 (s)',     key: 'holdTime',    type: 'number' },
            { label: '触发模式 (H/L)',       key: 'triggerMode', type: 'text'   },
            { label: '灵敏度 (0.1~1.0)',     key: 'sensitivity', type: 'number' },
            { label: '封锁时间 (s)',         key: 'blockTime',   type: 'number' },
            { label: '环境温度 (°C)',        key: 'envTemp',     type: 'number' },
        ];
    }

    onConfigUpdate(cfg) {
        if (cfg.label       !== undefined) this.label       = cfg.label;
        if (cfg.vcc         !== undefined) this.vcc         = parseFloat(cfg.vcc);
        if (cfg.detectRange !== undefined) this.setDetectRange(parseFloat(cfg.detectRange));
        if (cfg.holdTime    !== undefined) this.setHoldTime(parseFloat(cfg.holdTime));
        if (cfg.triggerMode !== undefined) this.setTriggerMode(cfg.triggerMode);
        if (cfg.sensitivity !== undefined) this.setSensitivity(parseFloat(cfg.sensitivity));
        if (cfg.blockTime   !== undefined) this.blockTime   = parseFloat(cfg.blockTime);
        if (cfg.envTemp     !== undefined) this.setEnvTemp(parseFloat(cfg.envTemp));
        this.config = { ...this.config, ...cfg };
        this._refreshCache();
    }

    destroy() { this._stopAnimation(); super.destroy?.(); }
}