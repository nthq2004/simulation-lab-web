import { BaseComponent } from './BaseComponent.js';

/**
 * 磁电式相位差扭矩传感器 仿真组件
 * （Magnetoelectric Phase-Difference Torque Sensor）
 *
 * ═══════════════════════════════════════════════════════════════
 *
 * 结构说明（参照图片，从上到下）：
 *
 *  ┌──────────────────────────────────────────────────────┐
 *  │  [输入轴]──────────[输出轴]   （两段传动轴，中间扭转段）│
 *  │      ║                ║                              │
 *  │  [齿轮1]          [齿轮2]   （固定在轴上的两个齿圈）  │
 *  │   × □ ×            × □ ×   （磁电传感器1,2）         │
 *  │   ┌──────────────────┐                               │
 *  │   │  1:▁▔▁▔▁▔▁▔      │ 矩形波信号1（传感器1输出）   │
 *  │   │  2: ▁▔▁▔▁▔▁      │ 矩形波信号2（传感器2输出）   │
 *  │   │     ←Δφ→         │ 相位差（与扭矩正比）          │
 *  │   └──────────────────┘                               │
 *  │         ↓                                            │
 *  │   [测量电路]   [指针表头]                             │
 *  └──────────────────────────────────────────────────────┘
 *
 * ── 工作原理 ──────────────────────────────────────────────────
 *
 *  1. 两个齿轮固定在弹性扭转轴的两端（轴向间距 L）
 *  2. 安装时令扭矩=0 时两齿轮齿顶/齿槽轴向投影完全重合（初始相位差=0）
 *  3. 轴受扭矩时产生扭转角 φ：
 *        φ = T · L / (G · Ip)
 *        T  — 扭矩（N·m）
 *        L  — 两齿轮轴向间距（m）
 *        G  — 剪切弹性模量（Pa），钢材典型值 80 GPa
 *        Ip — 截面极惯性矩（m⁴），对于实心圆轴 Ip = π·d⁴/32
 *
 *  4. 扭转角 φ 引起齿轮2相对齿轮1 的角度偏移
 *  5. 磁电传感器输出矩形波，相位差 Δt = φ / (2π·n) × T_period
 *        n   — 转速（r/s）
 *        T_period — 齿轮转一圈时间
 *     等效相位角差：Δφ_elec = φ · Z（Z=齿数）
 *
 *  6. 测量电路对两路矩形波做异或（XOR）或计时，得到相位差脉冲宽度
 *  7. 扭矩读数：T = Δφ_elec · (G · Ip) / (Z · L)
 *
 * ── 仿真参数 ──────────────────────────────────────────────────
 *  轴径 d        : 30 mm（默认）
 *  两齿轮间距 L  : 200 mm
 *  齿数 Z        : 60
 *  剪切模量 G    : 80 GPa（钢）
 *  量程          : ±1000 N·m
 *  转速          : 0~3000 rpm（可配置）
 *
 * ── 仿真动画 ──────────────────────────────────────────────────
 *  • 两段轴体（输入/输出）旋转动画
 *  • 齿轮截面图随扭矩产生可见扭转错位
 *  • 磁电传感器处的脉冲闪烁（随齿轮转动）
 *  • 实时双通道矩形波，相位差随扭矩动态变化
 *  • 相位差高亮区（XOR 脉冲）
 *  • 指针表头指示扭矩值
 *  • 扭矩滑块交互调节
 *
 * ── 端口 ─────────────────────────────────────────────────────
 *  port_signal1  — 传感器1矩形波输出
 *  port_signal2  — 传感器2矩形波输出
 *  port_torque   — 测量电路模拟量输出（0~10V / 4~20mA）
 *  port_speed    — 转速信号输出（频率量）
 */
export class MagnetoTorqueSensor extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.width  = Math.max(520, config.width  || 620);
        this.height = Math.max(420, config.height || 520);

        this.type    = 'magneto_torque_sensor';
        this.special = 'none';
        this.cache   = 'fixed';

        this._initGroups();
        this.label   = config.label || 'TRQ-01';
        this.model   = config.model || 'MTE-60';

        // ── 物理参数 ──
        this.shaftD  = (config.shaftD  || 30)   / 1000;    // m，轴径
        this.gearL   = (config.gearL   || 200)  / 1000;    // m，两齿轮轴向间距
        this.gearZ   = config.gearZ    || 60;               // 齿数
        this.G       = (config.G       || 80e9);            // Pa，剪切弹性模量
        this.rangeMax = config.rangeMax || 1000;            // N·m，量程

        // 截面极惯性矩（实心圆轴）
        this._Ip = Math.PI * Math.pow(this.shaftD, 4) / 32;

        // ── 运行状态 ──
        this._torque    = config.initTorque || 0;   // N·m，当前扭矩
        this._torqueTgt = this._torque;              // 目标扭矩（惯性跟踪）
        this._rpm       = config.initRPM   || 600;  // rpm，转速
        this._rpmTgt    = this._rpm;
        this._powered   = config.powered !== false;

        // ── 扭转角计算 ──
        this._twistAngle = 0;   // rad，当前扭转角
        this._gearAngle1 = 0;   // rad，齿轮1旋转角（累计）
        this._gearAngle2 = 0;   // rad，齿轮2旋转角（累计，含扭转）

        // ── 相位差 ──
        this._phaseDiff  = 0;   // rad（电气相位差，已乘齿数）
        this._phaseDiffDeg = 0; // 度

        // ── 矩形波历史（示波器）──
        this._waveLen    = 80;
        this._wave1      = new Array(this._waveLen).fill(0);
        this._wave2      = new Array(this._waveLen).fill(0);
        this._waveIdx    = 0;
        this._waveTimer  = 0;
        this._waveInterval = 0.025; // s，采样间隔

        this._blinkPhase = 0;

        // ── 传感器触发状态 ──
        this._sens1Triggered = false;
        this._sens2Triggered = false;

        this._computeLayout();
        this._init();
        this._addPorts();
    }

    // ═══════════════════════════════════════════
    _computeLayout() {
        const W = this.width, H = this.height;
        const pad = 8;

        this._titleH = H * 0.06;

        // ── 上半部分：结构示意图 ──
        const structY = this._titleH + pad;
        const structH = H * 0.52;

        // 整体居中区
        this._structX = pad;
        this._structY = structY;
        this._structW = W * 0.65;
        this._structH = structH;

        // 轴（横向，居中）
        const axCY = structY + structH * 0.22;
        this._axisY  = axCY;
        this._axisX1 = W * 0.03;               // 输入轴左端
        this._axisX2 = W * 0.62;               // 输出轴右端
        this._axisR  = structH * 0.085;         // 轴半径（截面视图中用高度）

        // 两个齿轮的轴向位置（X）
        this._gear1X = W * 0.18;
        this._gear2X = W * 0.45;
        this._gearR  = structH * 0.16;          // 齿轮显示半径（侧视）
        this._gearW  = W * 0.05;               // 齿轮宽度（轴向厚度）

        // 磁电传感器位置（在齿轮正上方）
        this._sens1X = this._gear1X + this._gearW * 0.3;
        this._sens2X = this._gear2X + this._gearW * 0.3;
        this._sensY  = axCY - this._gearR - structH * 0.12;
        this._sensW  = this._gearW * 1.8;
        this._sensH  = structH * 0.10;

        // ── 下半部分：波形和测量电路 ──
        const botY = structY + structH + pad;
        const botH = H - botY - pad;

        // 波形区（左侧大块）
        this._waveX = pad;
        this._waveY = botY;
        this._waveW = W * 0.62;
        this._waveH = botH;

        // 测量电路+表头（右侧）
        this._meterX = W * 0.66;
        this._meterY = structY;
        this._meterW = W * 0.32;
        this._meterH = H - structY - pad;

        // 扭矩滑块
        this._sliderX = W * 0.66;
        this._sliderY = botY + botH * 0.48;
        this._sliderW = W * 0.32;
        this._sliderH = botH * 0.52;
    }

    // ── 全量初始化 ────────────────────────────
    _init() {
        this._drawBackground();
        this._drawTitle();
        this._drawShaftAssembly();
        this._drawSensors();
        this._drawWaveArea();
        this._drawMeasureCircuit();
        this._drawTorqueSlider();
        
    }

    // ── 背景 ─────────────────────────────────
    _drawBackground() {
        const W = this.width, H = this.height;
        this._staticGroup.add(new Konva.Rect({
            x: 3, y: 3, width: W, height: H,
            fill: 'rgba(0,0,0,0.30)', cornerRadius: 5,
        }));
        this._staticGroup.add(new Konva.Rect({
            x: 0, y: 0, width: W, height: H,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint:   { x: W, y: H },
            fillLinearGradientColorStops: [0, '#1a2030', 0.5, '#161c28', 1, '#101420'],
            stroke: '#0a1020', strokeWidth: 2, cornerRadius: 4,
        }));
    }

    // ── 标题 ─────────────────────────────────
    _drawTitle() {
        const W = this.width;
        this._staticGroup.add(new Konva.Rect({
            x: 0, y: 0, width: W, height: this._titleH,
            fill: 'rgba(80,140,255,0.08)', cornerRadius: [4, 4, 0, 0],
        }));
        this._staticGroup.add(new Konva.Text({
            x: 0, y: 3, width: W * 0.55,
            text: '磁电式相位差扭矩传感器',
            fontSize: 11, fontStyle: 'bold',
            fontFamily: 'SimHei, Arial', fill: '#70b0ff', align: 'center',
        }));
        this._staticGroup.add(new Konva.Text({
            x: W * 0.55, y: 3, width: W * 0.23,
            text: this.model, fontSize: 9,
            fontFamily: 'Arial', fill: '#4070a0', align: 'center',
        }));
        this._staticGroup.add(new Konva.Text({
            x: W * 0.78, y: 3, width: W * 0.20,
            text: this.label, fontSize: 9, fontStyle: 'bold',
            fontFamily: 'Arial', fill: '#40c0a0', align: 'center',
        }));
    }

    // ── 轴系结构示意图 ───────────────────────
    _drawShaftAssembly() {
        const ay   = this._axisY;
        const ar   = this._axisR;
        const g1x  = this._gear1X;
        const g2x  = this._gear2X;
        const gw   = this._gearW;
        const gr   = this._gearR;

        // ── 轴体（侧视，矩形代表圆轴横截面顶视轮廓）──

        // 输入轴（左段，从最左到齿轮1左侧）
        this._staticGroup.add(new Konva.Rect({
            x: this._axisX1, y: ay - ar,
            width: g1x - this._axisX1, height: ar * 2,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint:   { x: 0, y: ar * 2 },
            fillLinearGradientColorStops: [0, '#6a7888', 0.3, '#c8d0d8', 0.7, '#8090a0', 1, '#3a4858'],
            stroke: '#2a3848', strokeWidth: 1,
        }));

        // 扭转段（齿轮1右侧到齿轮2左侧，中间弹性段，轻微细一点体现柔性）
        const torsionX = g1x + gw;
        const torsionW = g2x - torsionX;
        const torsionAr = ar * 0.88; // 略细，体现弹性扭转段
        this._torsionBar = new Konva.Rect({
            x: torsionX, y: ay - torsionAr,
            width: torsionW, height: torsionAr * 2,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint:   { x: 0, y: torsionAr * 2 },
            fillLinearGradientColorStops: [0, '#5a6878', 0.3, '#a8b8c8', 0.7, '#6878a0', 1, '#2a3858'],
            stroke: '#4a70a0', strokeWidth: 1, dash: [3, 1],
        });
        this._staticGroup.add(this._torsionBar);

        // 输出轴（右段，从齿轮2右侧到最右）
        this._staticGroup.add(new Konva.Rect({
            x: g2x + gw, y: ay - ar,
            width: this._axisX2 - g2x - gw, height: ar * 2,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint:   { x: 0, y: ar * 2 },
            fillLinearGradientColorStops: [0, '#6a7888', 0.3, '#c8d0d8', 0.7, '#8090a0', 1, '#3a4858'],
            stroke: '#2a3848', strokeWidth: 1,
        }));

        // 轴端斜线纹（输出轴末端），仿图片右侧斜纹
        for (let i = 0; i < 4; i++) {
            const hx = this._axisX2 - 12 + i * 4;
            this._staticGroup.add(new Konva.Line({
                points: [hx, ay - ar, hx + 8, ay + ar],
                stroke: '#3a5060', strokeWidth: 1,
            }));
        }

        // ── 轴端圆盘（联轴器/法兰，图片中方形块）──
        [[this._axisX1, '输入'], [this._axisX2 - 10, '输出']].forEach(([fx, lbl]) => {
            const fw = 14, fh = ar * 3.2;
            this._staticGroup.add(new Konva.Rect({
                x: fx, y: ay - fh / 2, width: fw, height: fh,
                fillLinearGradientStartPoint: { x: 0, y: 0 },
                fillLinearGradientEndPoint:   { x: fw, y: 0 },
                fillLinearGradientColorStops: [0, '#5a6878', 0.4, '#d0d8e0', 0.8, '#8090a0', 1, '#3a4858'],
                stroke: '#2a3848', strokeWidth: 1.2,
            }));
            this._staticGroup.add(new Konva.Text({
                x: fx - 4, y: ay + fh / 2 + 3, width: fw + 12,
                text: lbl + '轴', fontSize: 7, fill: '#5090c0',
                fontFamily: 'SimHei, Arial', align: 'center',
            }));
        });

        // ── 齿轮1（左）──
        this._drawGearSideView(g1x, ay, gw, gr, 1);

        // ── 齿轮2（右）──
        this._drawGearSideView(g2x, ay, gw, gr, 2);

        // ── 扭转变形可视化（弦线，扭矩大时弯曲）──
        this._twistLine = new Konva.Line({
            points: [torsionX, ay, torsionX + torsionW, ay],
            stroke: '#ff8020', strokeWidth: 1.5,
            dash: [4, 2], opacity: 0,
        });
        this._staticGroup.add(this._twistLine);

        // ── 扭矩箭头（施力方向，输入端）──
        this._torqueArrowIn  = this._drawTorqueArrow(g1x - 18, ay, -1); // 顺时针
        this._torqueArrowOut = this._drawTorqueArrow(g2x + gw + 18, ay, 1);  // 阻力矩

        // ── 连线框（包围齿轮和传感器区域）──
        this._staticGroup.add(new Konva.Rect({
            x: this._structX + 2, y: this._structY + 4,
            width: this._structW - 4, height: this._structH - 4,
            fill: 'transparent', stroke: '#2a4060', strokeWidth: 1,
            cornerRadius: 3, dash: [4, 3],
        }));

        // ── 参数标注 ──
        this._staticGroup.add(new Konva.Line({
            points: [g1x + gw * 0.5, ay + gr + 8, g2x + gw * 0.5, ay + gr + 8],
            stroke: '#4a7090', strokeWidth: 0.8,
        }));
        [[g1x + gw * 0.5, '←'], [g2x + gw * 0.5, '→']].forEach(([lx, arr]) => {
            this._staticGroup.add(new Konva.Line({
                points: [lx, ay + gr + 4, lx, ay + gr + 12],
                stroke: '#4a7090', strokeWidth: 0.8,
            }));
        });
        this._staticGroup.add(new Konva.Text({
            x: g1x + gw * 0.5, y: ay + gr + 10,
            width: g2x - g1x,
            text: `L = ${this.gearL * 1000} mm`,
            fontSize: 7, fill: '#4a90b0',
            fontFamily: 'Arial', align: 'center',
        }));
    }

    // ── 齿轮侧视图（矩形体+齿顶线）────────
    _drawGearSideView(gx, ay, gw, gr, idx) {
        // 齿根圆（外壳矩形）
        this._staticGroup.add(new Konva.Rect({
            x: gx, y: ay - gr * 0.75,
            width: gw, height: gr * 1.50,
            fill: '#2a3848', stroke: '#4a6888', strokeWidth: 1,
        }));

        // 齿顶（上下交替矩形齿，仿图片 × □ × 样式）
        // 用齿形轮廓替代：在矩形两端加半圆弧齿
        const toothW = gw / 5;
        const toothH = gr * 0.25;
        for (let side = 0; side < 2; side++) {
            const baseY = side === 0 ? ay - gr * 0.75 - toothH : ay + gr * 0.75;
            for (let t = 0; t < 5; t++) {
                const tx = gx + t * toothW;
                const isTooth = t % 2 === 0;
                this._staticGroup.add(new Konva.Rect({
                    x: tx, y: baseY,
                    width: toothW, height: toothH,
                    fill: isTooth ? '#4a6888' : '#1a2838',
                    stroke: '#3a5870', strokeWidth: 0.6,
                }));
            }
        }

        // 磁感线图标（× = 磁场进入，参照图片）
        const crossSize = gw * 0.22;
        for (let t = 0; t < 3; t += 2) {
            const tx = gx + (t + 0.5) * (gw / 3);
            // × 符号
            this._staticGroup.add(new Konva.Line({
                points: [
                    tx - crossSize, ay - crossSize * 0.5,
                    tx + crossSize, ay + crossSize * 0.5,
                ],
                stroke: '#6090c0', strokeWidth: 0.9,
            }));
            this._staticGroup.add(new Konva.Line({
                points: [
                    tx + crossSize, ay - crossSize * 0.5,
                    tx - crossSize, ay + crossSize * 0.5,
                ],
                stroke: '#6090c0', strokeWidth: 0.9,
            }));
        }
        // □ 中间矩形槽
        this._staticGroup.add(new Konva.Rect({
            x: gx + gw * 0.36, y: ay - gr * 0.28,
            width: gw * 0.28, height: gr * 0.56,
            fill: '#141e2c', stroke: '#3a5878', strokeWidth: 0.8,
        }));

        // 齿轮编号标注
        this._staticGroup.add(new Konva.Text({
            x: gx - 2, y: this._sensY - 14,
            text: `${idx}`, fontSize: 9, fontStyle: 'bold',
            fill: '#70a0d0', fontFamily: 'Arial',
        }));
    }

    // ── 扭矩弯曲箭头（圆弧箭头）────────────
    _drawTorqueArrow(cx, cy, dir) {
        const r  = this._axisR * 1.8;
        const group = new Konva.Group({ opacity: 0 });

        // 圆弧（用折线近似）
        const pts = [];
        const startA = dir > 0 ? -120 : -60;
        const endA   = dir > 0 ?   60 : 240;
        for (let a = startA; a <= endA; a += 10) {
            const rad = a * Math.PI / 180;
            pts.push(cx + Math.cos(rad) * r, cy + Math.sin(rad) * r);
        }
        group.add(new Konva.Line({
            points: pts, stroke: '#ff8020', strokeWidth: 1.8,
            lineCap: 'round', lineJoin: 'round',
        }));

        // 箭头头
        const tipA = (dir > 0 ? 60 : 240) * Math.PI / 180;
        const tx = cx + Math.cos(tipA) * r;
        const ty = cy + Math.sin(tipA) * r;
        const perpA = tipA + (dir > 0 ? -Math.PI / 2 : Math.PI / 2);
        group.add(new Konva.Line({
            points: [
                tx + Math.cos(perpA - 0.4) * 7, ty + Math.sin(perpA - 0.4) * 7,
                tx, ty,
                tx + Math.cos(perpA + 0.4) * 7, ty + Math.sin(perpA + 0.4) * 7,
            ],
            stroke: '#ff8020', strokeWidth: 1.8, lineJoin: 'round',
        }));

        this._staticGroup.add(group);
        return group;
    }

    // ── 磁电传感器（探头）────────────────────
    _drawSensors() {
        const sy = this._sensY;
        const sh = this._sensH;
        const sw = this._sensW;

        [[this._sens1X, '1', 'sens1'], [this._sens2X, '2', 'sens2']].forEach(([sx, lbl, id]) => {

            // 传感器外壳
            this._staticGroup.add(new Konva.Rect({
                x: sx - sw / 2, y: sy,
                width: sw, height: sh,
                fill: '#2a3848', stroke: '#4a7090', strokeWidth: 1.2,
                cornerRadius: 2,
            }));
            this._staticGroup.add(new Konva.Text({
                x: sx - sw / 2, y: sy + sh * 0.20,
                width: sw, text: lbl,
                fontSize: 8, fontStyle: 'bold', fill: '#70b0d0',
                fontFamily: 'Arial', align: 'center',
            }));

            // 发光窗口（感应齿轮时亮起）
            const winW = sw * 0.5, winH = sh * 0.35;
            const win = new Konva.Rect({
                x: sx - winW / 2, y: sy + sh * 0.50,
                width: winW, height: winH,
                fill: '#101820', stroke: '#3a6080', strokeWidth: 0.8,
                cornerRadius: 1,
                shadowColor: 'transparent', shadowBlur: 0,
            });
            this._staticGroup.add(win);

            // 连接线（传感器 → 下方连线框）
            this._staticGroup.add(new Konva.Line({
                points: [sx, sy + sh, sx, this._structY + this._structH - 4],
                stroke: '#3a7090', strokeWidth: 1, dash: [2, 2],
            }));

            if (id === 'sens1') this._sens1Window = win;
            else                this._sens2Window = win;
        }); 

        // 整体连线框（图片中方框内 ×□× 区域外的矩形连线）
        const boxX = Math.min(this._sens1X, this._sens2X) - this._sensW;
        const boxW = Math.abs(this._sens2X - this._sens1X) + this._sensW * 2;
        this._staticGroup.add(new Konva.Rect({
            x: boxX, y: this._sensY - 2,
            width: boxW, height: this._structH * 0.28,
            fill: 'transparent',
            stroke: '#3a6080', strokeWidth: 1,
        }));
    }

    // ── 矩形波显示区 ─────────────────────────
    _drawWaveArea() {
        const wx = this._waveX, wy = this._waveY;
        const ww = this._waveW, wh = this._waveH;

        // 背景
        this._staticGroup.add(new Konva.Rect({
            x: wx, y: wy, width: ww, height: wh,
            fill: '#080e18', stroke: '#1a3858', strokeWidth: 1,
            cornerRadius: 2,
        }));
        this._staticGroup.add(new Konva.Text({
            x: wx + 4, y: wy + 2,
            text: '矩形波相位差监测',
            fontSize: 8, fontStyle: 'bold',
            fontFamily: 'SimHei, Arial', fill: '#4080c0',
        }));

        // 格线
        for (let i = 1; i < 4; i++) {
            this._staticGroup.add(new Konva.Line({
                points: [wx + ww * i / 4, wy + 12, wx + ww * i / 4, wy + wh - 4],
                stroke: '#0e1e30', strokeWidth: 0.7,
            }));
        }
        this._staticGroup.add(new Konva.Line({
            points: [wx + 4, wy + wh / 2, wx + ww - 4, wy + wh / 2],
            stroke: '#0e1e30', strokeWidth: 0.7,
        }));

        // 通道标签
        this._staticGroup.add(new Konva.Text({
            x: wx + 4, y: wy + wh * 0.18,
            text: '1', fontSize: 8, fontStyle: 'bold', fill: '#4090ff', fontFamily: 'Arial',
        }));
        this._staticGroup.add(new Konva.Text({
            x: wx + 4, y: wy + wh * 0.63,
            text: '2', fontSize: 8, fontStyle: 'bold', fill: '#40ff90', fontFamily: 'Arial',
        }));

        // 相位差区域高亮（动态）
        this._phaseHighlight = new Konva.Rect({
            x: wx + 14, y: wy + 12,
            width: 0, height: wh - 16,
            fill: 'rgba(255,180,40,0.12)',
        });
        this._staticGroup.add(this._phaseHighlight);

        // 波形线（动态）
        this._wave1Line = new Konva.Line({
            points: [wx + 14, wy + wh * 0.28, wx + ww - 4, wy + wh * 0.28],
            stroke: '#4090ff', strokeWidth: 1.5, listening: false,
        });
        this._wave2Line = new Konva.Line({
            points: [wx + 14, wy + wh * 0.72, wx + ww - 4, wy + wh * 0.72],
            stroke: '#40ff90', strokeWidth: 1.5, listening: false,
        });
        this._staticGroup.add(this._wave1Line);
        this._staticGroup.add(this._wave2Line);

        // 相位差标注文字
        this._phaseDiffText = new Konva.Text({
            x: wx, y: wy + wh - 14, width: ww,
            text: `Δφ = 0.0°   扭矩 = 0 N·m`,
            fontSize: 8, fontStyle: 'bold',
            fontFamily: 'Arial, SimHei', fill: '#ffaa30', align: 'center',
        });
        this._staticGroup.add(this._phaseDiffText);
    }

    // ── 测量电路 + 指针表头 ──────────────────
    _drawMeasureCircuit() {
        const mx = this._meterX, my = this._meterY;
        const mw = this._meterW, mh = this._meterH * 0.48;

        // 测量电路框
        this._staticGroup.add(new Konva.Rect({
            x: mx, y: my, width: mw, height: mh,
            fill: '#1a2838', stroke: '#3a6080', strokeWidth: 1.2,
            cornerRadius: 3,
        }));
        this._staticGroup.add(new Konva.Text({
            x: mx, y: my + mh * 0.25, width: mw,
            text: '测量电路', fontSize: 10, fontStyle: 'bold',
            fontFamily: 'SimHei, Arial', fill: '#60b0e0', align: 'center',
        }));

        // 内部：XOR 逻辑符号
        const xorCX = mx + mw * 0.50, xorCY = my + mh * 0.65;
        const xorW  = mw * 0.28, xorH = mh * 0.25;
        this._staticGroup.add(new Konva.Line({
            points: [xorCX - xorW / 2, xorCY - xorH / 2,
                     xorCX + xorW / 2, xorCY - xorH / 2,
                     xorCX + xorW / 2, xorCY + xorH / 2,
                     xorCX - xorW / 2, xorCY + xorH / 2,
                     xorCX - xorW / 2, xorCY - xorH / 2],
            stroke: '#4a8090', strokeWidth: 0.8,
        }));
        this._staticGroup.add(new Konva.Text({
            x: xorCX - xorW / 2, y: xorCY - 5, width: xorW,
            text: 'XOR\nΔt', fontSize: 7,
            fontFamily: 'Arial', fill: '#60d0c0', align: 'center',
        }));

        // 输入引线（1和2）
        this._staticGroup.add(new Konva.Line({
            points: [mx + mw * 0.10, xorCY - 3, xorCX - xorW / 2, xorCY - 3],
            stroke: '#4090ff', strokeWidth: 0.8,
        }));
        this._staticGroup.add(new Konva.Line({
            points: [mx + mw * 0.10, xorCY + 3, xorCX - xorW / 2, xorCY + 3],
            stroke: '#40ff90', strokeWidth: 0.8,
        }));
        this._staticGroup.add(new Konva.Text({ x: mx + 2, y: xorCY - 10, text: '1', fontSize: 7, fill: '#4090ff', fontFamily: 'Arial' }));
        this._staticGroup.add(new Konva.Text({ x: mx + 2, y: xorCY + 2,  text: '2', fontSize: 7, fill: '#40ff90', fontFamily: 'Arial' }));

        // 输出线 → 表头
        this._staticGroup.add(new Konva.Line({
            points: [xorCX + xorW / 2, xorCY, mx + mw - 4, xorCY],
            stroke: '#ffaa30', strokeWidth: 0.8,
        }));

        // 连接线到波形区（从测量电路左侧向左）
        this._staticGroup.add(new Konva.Line({
            points: [mx, my + mh * 0.50, this._waveX + this._waveW, my + mh * 0.50],
            stroke: '#2a4060', strokeWidth: 0.8, dash: [3, 2],
        }));
        this._staticGroup.add(new Konva.Line({
            points: [mx, my + mh * 0.65, this._waveX + this._waveW, my + mh * 0.65],
            stroke: '#2a4060', strokeWidth: 0.8, dash: [3, 2],
        }));

        // ── 指针表头（参照图片右下角圆形表头）──
        this._drawNeedle(mx, my + mh + 6, mw, mh * 0.90);
    }

    // ── 指针表头 ─────────────────────────────
    _drawNeedle(x, y, w, h) {
        const r   = Math.min(w, h) * 0.42;
        const cx  = x + w / 2;
        const cy  = y + r + 8;

        // 表壳
        this._staticGroup.add(new Konva.Circle({
            x: cx, y: cy, radius: r + 4,
            fill: '#1a2838', stroke: '#3a6080', strokeWidth: 1.5,
        }));
        // 表盘（浅色）
        this._staticGroup.add(new Konva.Circle({
            x: cx, y: cy, radius: r,
            fill: '#f0f4f0',
        }));

        // 刻度线（11格，-1000~+1000 N·m，对应角度 -150°~+150°）
        for (let i = 0; i <= 10; i++) {
            const a   = (-150 + i * 30) * Math.PI / 180;
            const isMaj = i % 2 === 0;
            const r1  = r * (isMaj ? 0.75 : 0.82);
            const r2  = r * 0.96;
            this._staticGroup.add(new Konva.Line({
                points: [cx + Math.cos(a) * r1, cy + Math.sin(a) * r1,
                         cx + Math.cos(a) * r2, cy + Math.sin(a) * r2],
                stroke: '#283838', strokeWidth: isMaj ? 1.2 : 0.7,
            }));
            if (isMaj) {
                const val = -1000 + i * 200;
                this._staticGroup.add(new Konva.Text({
                    x: cx + Math.cos(a) * r * 0.60 - 8, y: cy + Math.sin(a) * r * 0.60 - 4,
                    width: 16, text: val === 0 ? '0' : String(Math.abs(val) >= 1000 ? `${val/1000}k` : val),
                    fontSize: 6, fill: '#1a2828', fontFamily: 'Arial', align: 'center',
                }));
            }
        }

        // 量程标注
        this._staticGroup.add(new Konva.Text({
            x: cx - r * 0.5, y: cy - r * 0.08,
            width: r, text: 'N·m', fontSize: 7,
            fill: '#2a4840', fontFamily: 'Arial', align: 'center',
        }));

        // 零线（垂直标记）
        this._staticGroup.add(new Konva.Line({
            points: [cx, cy - r * 0.60, cx, cy - r * 0.78],
            stroke: '#2a4840', strokeWidth: 1,
        }));

        // 中心轴圆
        this._staticGroup.add(new Konva.Circle({
            x: cx, y: cy, radius: r * 0.06,
            fill: '#1a2828',
        }));

        // 指针（动态）
        const initAng = -90; // 0 N·m 时指向正上方
        this._needleCX = cx; this._needleCY = cy; this._needleR = r;
        this._needleShape = new Konva.Line({
            points: this._needlePts(-90, cx, cy, r),
            stroke: '#cc2010', strokeWidth: 2, lineCap: 'round',
        });
        this._staticGroup.add(this._needleShape);

        this._staticGroup.add(new Konva.Circle({
            x: cx, y: cy, radius: r * 0.05,
            fill: '#cc2010',
        }));

        // 表头标题
        this._staticGroup.add(new Konva.Text({
            x: x, y: y + r * 2.1 + 8, width: w,
            text: '扭矩指示', fontSize: 7.5, fontStyle: 'bold',
            fontFamily: 'SimHei, Arial', fill: '#4090b0', align: 'center',
        }));
    }

    _needlePts(angleDeg, cx, cy, r) {
        const a = angleDeg * Math.PI / 180;
        return [
            cx - Math.cos(a) * r * 0.15, cy - Math.sin(a) * r * 0.15,
            cx + Math.cos(a) * r * 0.88, cy + Math.sin(a) * r * 0.88,
        ];
    }

    // 扭矩值 → 指针角度（-150° ~ +150° 对应 -rangeMax ~ +rangeMax）
    _torqueToAngle(T) {
        const frac = Math.max(-1, Math.min(1, T / this.rangeMax));
        return -90 + frac * 150; // -90 为中点（0 N·m）
    }

    // ── 扭矩/转速调节滑块 ───────────────────
    _drawTorqueSlider() {
        const sx = this._sliderX, sy = this._sliderY;
        const sw = this._sliderW, sh = this._sliderH;

        this._staticGroup.add(new Konva.Rect({
            x: sx, y: sy, width: sw, height: sh,
            fill: '#0e1828', stroke: '#1a3858', strokeWidth: 1,
            cornerRadius: 2,
        }));
        this._staticGroup.add(new Konva.Text({
            x: sx, y: sy + 3, width: sw,
            text: '参数调节', fontSize: 8, fontStyle: 'bold',
            fontFamily: 'SimHei, Arial', fill: '#e09030', align: 'center',
        }));

        // ── 扭矩滑块（竖向，中央=0，上=+，下=-）──
        const trkX  = sx + sw * 0.22;
        const trkY1 = sy + sh * 0.12;
        const trkY2 = sy + sh * 0.85;
        const trkH  = trkY2 - trkY1;
        const trkMid = trkY1 + trkH / 2;

        this._staticGroup.add(new Konva.Rect({
            x: trkX - 3, y: trkY1, width: 6, height: trkH,
            fill: '#1a3050', stroke: '#2a5070', strokeWidth: 0.8, cornerRadius: 3,
        }));
        // 零刻度线
        this._staticGroup.add(new Konva.Line({
            points: [trkX - 6, trkMid, trkX + 8, trkMid],
            stroke: '#ffaa30', strokeWidth: 0.8,
        }));
        // 量程标注
        [[-this.rangeMax, trkY2], [0, trkMid], [this.rangeMax, trkY1]].forEach(([v, ky]) => {
            this._staticGroup.add(new Konva.Text({
                x: trkX + 9, y: ky - 4,
                text: `${v}`, fontSize: 6.5,
                fill: '#3a7090', fontFamily: 'Arial',
            }));
        });

        // 扭矩滑块
        const initKY = trkMid - trkH / 2 * (this._torque / this.rangeMax);
        this._torqueKnob = new Konva.Rect({
            x: trkX - 8, y: initKY - 5,
            width: 16, height: 10,
            fill: '#e09030', stroke: '#c07020', strokeWidth: 1,
            cornerRadius: 2, draggable: true,
            dragBoundFunc: pos => ({
                x: trkX - 8,
                y: Math.max(trkY1 - 5, Math.min(trkY2 - 5, pos.y)),
            }),
        });
        this._torqueKnob.on('dragmove', () => {
            const ky  = this._torqueKnob.y() + 5;
            const pct = (trkMid - ky) / (trkH / 2);
            this._torqueTgt = Math.max(-this.rangeMax, Math.min(this.rangeMax, pct * this.rangeMax));
            this._refreshCache();
        });
        this._staticGroup.add(this._torqueKnob);

        this._trqSliderMid = trkMid;
        this._trqSliderH2  = trkH / 2;
        this._trqSliderX   = trkX;

        this._staticGroup.add(new Konva.Text({
            x: sx, y: sy + sh * 0.06, width: sw * 0.55,
            text: 'T (N·m)', fontSize: 7, fill: '#e09030',
            fontFamily: 'SimHei, Arial', align: 'center',
        }));

        // ── 转速滑块（横向，下方）──
        const rpmY   = sy + sh * 0.88;
        const rpmX1  = sx + sw * 0.06;
        const rpmX2  = sx + sw * 0.88;
        const rpmW   = rpmX2 - rpmX1;

        this._staticGroup.add(new Konva.Rect({
            x: rpmX1, y: rpmY - 3, width: rpmW, height: 6,
            fill: '#1a3050', stroke: '#2a5070', strokeWidth: 0.8, cornerRadius: 3,
        }));
        this._staticGroup.add(new Konva.Text({
            x: sx, y: rpmY - 14, width: sw,
            text: 'n (rpm)', fontSize: 7, fill: '#50c0a0',
            fontFamily: 'SimHei, Arial', align: 'center',
        }));

        const initRpmX = rpmX1 + rpmW * (this._rpm / 3000);
        this._rpmKnob = new Konva.Rect({
            x: initRpmX - 5, y: rpmY - 6,
            width: 10, height: 12,
            fill: '#30c090', stroke: '#20a070', strokeWidth: 1,
            cornerRadius: 2, draggable: true,
            dragBoundFunc: pos => ({
                x: Math.max(rpmX1 - 5, Math.min(rpmX2 - 5, pos.x)),
                y: rpmY - 6,
            }),
        });
        this._rpmKnob.on('dragmove', () => {
            const kx = this._rpmKnob.x() + 5;
            this._rpmTgt = Math.max(0, Math.min(3000, ((kx - rpmX1) / rpmW) * 3000));
            this._refreshCache();
        });
        this._staticGroup.add(this._rpmKnob);

        this._rpmSliderX1 = rpmX1;
        this._rpmSliderW  = rpmW;

        // 数值文字
        this._torqueValueText = new Konva.Text({
            x: sx, y: sy + sh * 0.47, width: sw,
            text: `T: ${this._torque.toFixed(1)} N·m`,
            fontSize: 9, fontStyle: 'bold',
            fontFamily: 'SimHei, Arial', fill: '#e09030', align: 'center',
        });
        this._staticGroup.add(this._torqueValueText);

        this._rpmValueText = new Konva.Text({
            x: sx, y: rpmY + 8, width: sw,
            text: `n: ${this._rpm.toFixed(0)} rpm`,
            fontSize: 8, fontFamily: 'SimHei, Arial',
            fill: '#30c090', align: 'center',
        });
        this._staticGroup.add(this._rpmValueText);
    }

    // ═══════════════════════════════════════════
    // 动画主循环
    // ═══════════════════════════════════════════
    // 集中化 tick（由 consys._tickAll 在 20fps 调用）
    tick(dt) {
        this._simulate(dt);
        this._refreshDisplay();
    
        this._refreshCache();
    }
    // ── 物理仿真 ─────────────────────────────
    _simulate(dt) {
        // 惯性跟踪目标值
        this._torque += ((this._torqueTgt - this._torque) / 4) * dt;
        this._rpm    += ((this._rpmTgt    - this._rpm)    / 3) * dt;

        const rps = this._rpm / 60; // 转/秒

        // 齿轮旋转角累计
        this._gearAngle1 += 2 * Math.PI * rps * dt;

        // 扭转角：φ = T·L / (G·Ip)
        this._twistAngle  = this._torque * this.gearL / (this.G * this._Ip);

        // 齿轮2角度 = 齿轮1角度 + 扭转角
        this._gearAngle2  = this._gearAngle1 + this._twistAngle;

        // 电气相位差（乘以齿数）：每过一个齿对应 2π/Z 弧度
        // 电气相位差 = 扭转角 × Z（齿数放大）
        this._phaseDiff    = this._twistAngle * this.gearZ;  // rad
        this._phaseDiffDeg = this._phaseDiff * 180 / Math.PI;

        // 磁电传感器触发：当齿顶经过传感器时输出高电平
        // 归一化到 0~1 之间的齿轮旋转相位（0~2π → 0~Z 个齿周期）
        const toothPhase1 = ((this._gearAngle1 % (2 * Math.PI)) / (2 * Math.PI)) * this.gearZ;
        const toothPhase2 = ((this._gearAngle2 % (2 * Math.PI)) / (2 * Math.PI)) * this.gearZ;
        // 每个齿 50% 占空比矩形波（齿顶=高，齿槽=低）
        this._sens1Triggered = (toothPhase1 % 1) < 0.5;
        this._sens2Triggered = (toothPhase2 % 1) < 0.5;

        // 波形历史采样
        this._waveTimer += dt;
        if (this._waveTimer >= this._waveInterval) {
            this._waveTimer = 0;
            this._wave1[this._waveIdx] = this._sens1Triggered ? 1 : 0;
            this._wave2[this._waveIdx] = this._sens2Triggered ? 1 : 0;
            this._waveIdx = (this._waveIdx + 1) % this._waveLen;
        }

        this._blinkPhase += dt;
    }

    // ── 刷新全部显示 ─────────────────────────
    _refreshDisplay() {
        this._updateSensorWindows();
        this._updateTwistVisual();
        this._updateWaveforms();
        this._updateNeedle();
        this._updateSliderPositions();
        this._updateTexts();
        this._refreshCache();
    }

    // 传感器感应窗口（闪烁）
    _updateSensorWindows() {
        if (!this._sens1Window || !this._sens2Window) return;
        const s1on = this._sens1Triggered && this._rpm > 10;
        const s2on = this._sens2Triggered && this._rpm > 10;
        this._sens1Window.fill(s1on ? '#40aaff' : '#101820');
        this._sens1Window.shadowColor(s1on ? '#40aaff' : 'transparent');
        this._sens1Window.shadowBlur(s1on ? 6 : 0);
        this._sens2Window.fill(s2on ? '#40ffaa' : '#101820');
        this._sens2Window.shadowColor(s2on ? '#40ffaa' : 'transparent');
        this._sens2Window.shadowBlur(s2on ? 6 : 0);
    }

    // 扭转段可视变形（扭矩越大，中线弯曲越明显）
    _updateTwistVisual() {
        if (!this._torsionBar || !this._twistLine) return;
        const torsionX = this._gear1X + this._gearW;
        const torsionW = this._gear2X - torsionX;
        const ay = this._axisY;
        const maxBend = this._axisR * 1.8;
        const bend = (this._torque / this.rangeMax) * maxBend;

        // 扭转段颜色随扭矩变化
        const stress = Math.abs(this._torque) / this.rangeMax;
        const r = Math.round(42 + 200 * stress);
        const g = Math.round(104 + (80 - 104) * stress);
        this._torsionBar.fillLinearGradientColorStops([
            0,   `rgb(${Math.round(r*0.8)},${g},100)`,
            0.5, `rgb(${r},${Math.round(g*1.3)},180)`,
            1,   `rgb(${Math.round(r*0.6)},${g},80)`,
        ]);

        // 扭转线（夸张显示弯曲，仅作示意）
        const twistOpacity = Math.min(0.8, stress * 2);
        this._twistLine.opacity(twistOpacity);
        this._twistLine.points([
            torsionX, ay + bend * 0.3,
            torsionX + torsionW * 0.3, ay + bend,
            torsionX + torsionW * 0.7, ay - bend,
            torsionX + torsionW, ay - bend * 0.3,
        ]);

        // 扭矩箭头透明度
        if (this._torqueArrowIn)  this._torqueArrowIn.opacity(stress * 0.9);
        if (this._torqueArrowOut) this._torqueArrowOut.opacity(stress * 0.9);
    }

    // 矩形波波形
    _updateWaveforms() {
        if (!this._wave1Line || !this._wave2Line) return;

        const wx  = this._waveX + 14;
        const ww  = this._waveW - 18;
        const wy1 = this._waveY + this._waveH * 0.24;  // 通道1中心
        const wy2 = this._waveY + this._waveH * 0.70;  // 通道2中心
        const amp = this._waveH * 0.14;
        const n   = this._waveLen;

        const pts1 = [], pts2 = [];
        for (let i = 0; i < n; i++) {
            const idx = (this._waveIdx + i) % n;
            const x = wx + (i / n) * ww;
            // 矩形波：直角阶跃
            const v1 = this._wave1[idx];
            const v2 = this._wave2[idx];
            // 添加阶跃（前一点相同X，不同Y）
            if (i > 0) {
                const pIdx = (this._waveIdx + i - 1) % n;
                if (this._wave1[pIdx] !== v1) pts1.push(x, wy1 - (this._wave1[pIdx] ? amp : -amp));
                if (this._wave2[pIdx] !== v2) pts2.push(x, wy2 - (this._wave2[pIdx] ? amp : -amp));
            }
            pts1.push(x, wy1 - (v1 ? amp : -amp));
            pts2.push(x, wy2 - (v2 ? amp : -amp));
        }

        this._wave1Line.points(pts1.length >= 4 ? pts1 : [wx, wy1, wx + ww, wy1]);
        this._wave2Line.points(pts2.length >= 4 ? pts2 : [wx, wy2, wx + ww, wy2]);

        // 相位差高亮宽度（与相位差成正比）
        if (this._phaseHighlight) {
            const phaseRatio = Math.abs(this._phaseDiff) / (2 * Math.PI); // 相对于一个完整周期
            const highlightW = Math.min(ww * 0.3, phaseRatio * ww * this.gearZ * 0.5);
            this._phaseHighlight.width(Math.max(0, highlightW));
        }
    }

    // 指针更新
    _updateNeedle() {
        if (!this._needleShape) return;
        const ang = this._torqueToAngle(this._torque);
        this._needleShape.points(this._needlePts(ang, this._needleCX, this._needleCY, this._needleR));
    }

    // 滑块位置同步
    _updateSliderPositions() {
        if (this._torqueKnob && this._trqSliderMid !== undefined) {
            const ky = this._trqSliderMid - this._trqSliderH2 * (this._torque / this.rangeMax);
            this._torqueKnob.y(ky - 5);
        }
        if (this._rpmKnob && this._rpmSliderX1 !== undefined) {
            const kx = this._rpmSliderX1 + this._rpmSliderW * (this._rpm / 3000);
            this._rpmKnob.x(kx - 5);
        }
    }

    // 文字更新
    _updateTexts() {
        if (this._torqueValueText) {
            this._torqueValueText.text(`T: ${this._torque.toFixed(1)} N·m`);
        }
        if (this._rpmValueText) {
            this._rpmValueText.text(`n: ${this._rpm.toFixed(0)} rpm`);
        }
        if (this._phaseDiffText) {
            const twistDeg = this._twistAngle * 180 / Math.PI;
            this._phaseDiffText.text(
                `Δφ = ${this._phaseDiffDeg.toFixed(2)}°   ` +
                `φ轴 = ${twistDeg.toFixed(4)}°   ` +
                `T = ${this._torque.toFixed(1)} N·m`
            );
        }
    }

    // ═══════════════════════════════════════════
    // 端口
    // ═══════════════════════════════════════════
    _addPorts() {
        const W = this.width, H = this.height;
        this.addPort(W * 0.20, H, 'port_signal1', 'wire', 'SIG1');
        this.addPort(W * 0.35, H, 'port_signal2', 'wire', 'SIG2');
        this.addPort(W * 0.55, H, 'port_torque',  'wire', 'TRQ');
        this.addPort(W * 0.72, H, 'port_speed',   'wire', 'SPD');
    }

    // ═══════════════════════════════════════════
    // 公共 API
    // ═══════════════════════════════════════════
    getTorque()       { return this._torque;         }
    getRPM()          { return this._rpm;             }
    getTwistAngle()   { return this._twistAngle;      }
    getPhaseDiff()    { return this._phaseDiffDeg;    }

    setTorque(T)      { this._torqueTgt = Math.max(-this.rangeMax, Math.min(this.rangeMax, T)); }
    setRPM(n)         { this._rpmTgt    = Math.max(0, Math.min(3000, n)); }

    update(state) {
        if (!state) return;
        if (state.torque !== undefined) this.setTorque(state.torque);
        if (state.rpm    !== undefined) this.setRPM(state.rpm);
        this._refreshCache();
    }

    getConfigFields() {
        return [
            { label: '位号',               key: 'label',     type: 'text'   },
            { label: '型号',               key: 'model',     type: 'text'   },
            { label: '轴径 (mm)',          key: 'shaftD',    type: 'number' },
            { label: '两齿轮间距 (mm)',    key: 'gearL',     type: 'number' },
            { label: '齿数 Z',             key: 'gearZ',     type: 'number' },
            { label: '量程 (N·m)',         key: 'rangeMax',  type: 'number' },
            { label: '初始扭矩 (N·m)',     key: 'initTorque',type: 'number' },
            { label: '初始转速 (rpm)',     key: 'initRPM',   type: 'number' },
        ];
    }

    onConfigUpdate(cfg) {
        if (cfg.label    ) this.label    = cfg.label;
        if (cfg.model    ) this.model    = cfg.model;
        if (cfg.shaftD   !== undefined) { this.shaftD   = parseFloat(cfg.shaftD)   / 1000; this._Ip = Math.PI * Math.pow(this.shaftD,4) / 32; }
        if (cfg.gearL    !== undefined) this.gearL    = parseFloat(cfg.gearL)   / 1000;
        if (cfg.gearZ    !== undefined) this.gearZ    = parseInt(cfg.gearZ)    || this.gearZ;
        if (cfg.rangeMax !== undefined) this.rangeMax = parseFloat(cfg.rangeMax) || this.rangeMax;
        if (cfg.initTorque !== undefined) this.setTorque(parseFloat(cfg.initTorque));
        if (cfg.initRPM    !== undefined) this.setRPM(parseFloat(cfg.initRPM));
        this.config = { ...this.config, ...cfg };
        this._refreshCache();
    }

    destroy() {
        super.destroy?.();
    }
}