import { BaseComponent } from './BaseComponent.js';

/**
 * 早期机械水表（Mechanical Water Meter）仿真组件
 *
 * ── 结构说明 ──────────────────────────────────────────────────
 *
 *  早期机械水表由以下部分组成：
 *
 *  1. 表壳（Casing）
 *     - 铸铁或黄铜外壳，圆形表盘，玻璃窗口
 *     - 进水口（In）/ 出水口（Out）接头
 *
 *  2. 叶轮式流量传感元件（Impeller / Woltmann Element）
 *     - 多叶片旋转叶轮，水流推动旋转
 *     - 转速与流量成正比：n = Q / k（k = 表常数）
 *     - 叶轮轴通过磁耦合或机械齿轮传递到计数器
 *
 *  3. 减速齿轮组（Gear Train）
 *     - 多级蜗轮蜗杆 + 直齿轮减速
 *     - 将叶轮高速转动减速为计数轮慢速转动
 *     - 传动比例：1000:1 ~ 100000:1
 *     - 各级齿轮可见旋转方向交替（相邻齿轮反转）
 *
 *  4. 十进制字轮计数器（Decimal Counter Drum，核心）
 *     - 6 位字轮，从右到左依次为：
 *       × 0.001 m³ → × 0.01 m³ → × 0.1 m³ →
 *       × 1 m³    → × 10 m³   → × 100 m³
 *     - 每个字轮圆周刻 0~9 共 10 个数字
 *     - 相邻字轮间有拨爪机构：低位轮转满一圈（0→9→0），拨动高位轮前进一格
 *     - 当前示数为 6 位数字组合，单位 m³
 *
 *  5. 拨爪进位机构（Carry / Geneva-Style Advance）
 *     - 低位字轮上有一个拨爪（Pawl）
 *     - 每当低位字轮从 9 转到 0 时，拨爪拨动高位字轮前进 1/10 圈
 *     - 模拟十进制进位：0→1→2→...→9→进位
 *
 * ── 叶轮物理模型 ──────────────────────────────────────────────
 *
 *  流量 Q（m³/h）→ 叶轮转速 ω（rad/s）：
 *    ω = Q × k_impeller    （k_impeller = 2π × 流量系数）
 *
 *  叶轮角加速度（含惯性和阻尼）：
 *    α = (τ_water − D × ω_current) / J
 *    τ_water ∝ Q（水力矩正比于流量）
 *
 *  计数器累积（m³）：
 *    ΔV = ω × dt × V_per_rad
 *    V_per_rad = 1 / (k_impeller × 3600)  （m³/rad）
 *
 * ── 字轮计数逻辑 ────────────────────────────────────────────
 *
 *  totalVolume（m³）的精确 6 位十进制分解：
 *    digits[0] = floor(totalVolume / 100)         % 10  ← 最高位（× 100 m³）
 *    digits[1] = floor(totalVolume / 10)          % 10
 *    digits[2] = floor(totalVolume / 1)           % 10
 *    digits[3] = floor(totalVolume / 0.1)         % 10
 *    digits[4] = floor(totalVolume / 0.01)        % 10
 *    digits[5] = floor(totalVolume / 0.001)       % 10  ← 最低位（× 0.001 m³）
 *
 *  字轮偏转角（连续，含小数以实现平滑滚动）：
 *    wheelAngle[i] = (totalVolume / place[i]) × (2π/10) mod 2π
 *
 * ── 传动齿轮组绘制 ──────────────────────────────────────────
 *
 *  齿轮组位于叶轮与字轮之间，从上到下排列 4 个可见齿轮：
 *    G1（大，黄铜）← 叶轮轴驱动
 *    G2（中）← 与 G1 啮合，反转
 *    G3（小）← 与 G2 啮合，同转（经过惰轮）
 *    G4（微）← 直接带动字轮最低位
 *
 *  角速度关系：ω_G(i+1) = ω_G(i) × (R_i / R_{i+1})（齿比）
 *
 * ── 动态效果 ────────────────────────────────────────────────
 *
 *  - 叶轮叶片随流量旋转，带水波纹涟漪动画
 *  - 齿轮组各齿轮实时旋转（颜色随转速变化有轻微发光）
 *  - 字轮连续平滑滚动（非跳变），进位时相邻字轮轻微扰动
 *  - 拨爪可见动作（低位满格时高亮拨爪）
 *  - 水流粒子从进水管流向叶轮（流量大时粒子多且快）
 *  - 状态栏实时显示流量（m³/h）、瞬时转速（rpm）、累计用水（m³）
 *
 * ── 端口 ─────────────────────────────────────────────────────
 *  terminal_in  — 进水口（左侧）
 *  terminal_out — 出水口（右侧）
 *
 * ── 交互 ─────────────────────────────────────────────────────
 *  flowRate 属性（0 ~ maxFlow m³/h）控制流量
 *  可通过 setFlow(q) 动态调整
 */
export class WaterMeter extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.width  = Math.max(340, config.width  || 420);
        this.height = Math.max(300, config.height || 380);

        this.type    = 'water_meter';
        this.special = 'none';
        this.cache   = 'fixed';

        this._initGroups();
        // ── 铭牌参数 ──
        this.label        = config.label        || 'WM-1';
        this.nominalFlow  = config.nominalFlow  || 1.5;    // m³/h（额定流量）
        this.maxFlow      = config.maxFlow      || 3.0;    // m³/h（最大流量）
        this.meterConst   = config.meterConst   || 1000;   // L/rev（表常数）

        // ── 状态 ──
        this._flowRate      = config.initFlow || 0;        // m³/h（当前目标流量）
        this._targetFlow    = this._flowRate;
        this._impellerSpeed = 0;                           // rad/s（叶轮角速度）
        this._impellerAngle = 0;                           // rad（叶轮累积角度）

        // 齿轮角度数组（4 个可见齿轮，从大到小）
        this._gearAngles    = [0, 0, 0, 0];
        // 齿轮比（相对于 G1）
        this._gearRatios    = [1, -3.5, 12, -42];         // 负数=反转

        // 总用水量（m³，精确浮点）
        this._totalVolume   = config.initVolume || 0;

        // 每 rad 叶轮转动对应的出水量（m³）
        // 1 rev = 2π rad，表常数 = 1000 L/rev → 1 rev = 1 m³ / meterConst × 1000
        // V_per_rad = 1 / (meterConst * 2π) m³/rad  （meterConst 单位 rev/m³）
        // 这里 meterConst 为 L/rev，转换：V_per_rad = 1e-3 / (2π)  m³/rad（当 meterConst=1000）
        this._volumePerRad  = (1 / this.meterConst) * 1e-3 / (2 * Math.PI);

        // 水流粒子
        this._particles     = [];
        this._particleTimer = 0;

        // 物理参数
        this._inertia       = 0.08;    // 叶轮转动惯量
        this._drag          = 0.65;    // 水阻尼

        // ── 几何布局 ──
        const W = this.width, H = this.height;

        // 表盘中心（字轮和齿轮区居中）
        this._dialCX = W * 0.52;
        this._dialCY = H * 0.44;

        // 表壳外径
        this._caseR  = Math.min(W, H) * 0.42;

        // 叶轮区（左侧下方）
        this._impCX  = W * 0.18;
        this._impCY  = H * 0.62;
        this._impR   = W * 0.10;

        // 齿轮组区域（表盘左半侧）
        this._gearCX    = W * 0.32;
        this._gearCY    = H * 0.44;
        this._gearSizes = [W*0.075, W*0.055, W*0.038, W*0.025];  // 各齿轮半径

        // 字轮区域（表盘中央）
        this._wheelX    = W * 0.28;   // 6 个字轮起始 x
        this._wheelY    = H * 0.38;
        this._wheelW    = W * 0.075;  // 单个字轮宽
        this._wheelH    = H * 0.145;  // 字轮可见高度
        this._wheelGap  = W * 0.007;  // 字轮间间距

        // 进出水管
        this._pipeInX   = 0;
        this._pipeInY   = H * 0.62;
        this._pipeOutX  = W;
        this._pipeOutY  = H * 0.62;
        this._pipeR     = H * 0.06;

        // 底座
        this._base = { x: W*0.03, y: H*0.88, w: W*0.94, h: H*0.09, rx: 4 };

        // 端子位置
        this._termInX  = W * 0.03;
        this._termOutX = W * 0.97;
        this._termY    = H * 0.62;

        this._init();

        this.addPort(this._termInX,  this._termY, 'terminal_in',  'pipe', '进');
        this.addPort(this._termOutX, this._termY, 'terminal_out', 'pipe', '出');
    }

    // ═══════════════════════════════════════════════════════════
    _init() {
        this._drawCasing();
        this._drawDial();
        this._drawPipes();
        this._drawWheelFrame();
        this._drawStaticLabels();
        this._drawStatusBar();
        this._rebuildDynamic();
    }

    // ── 表壳 ─────────────────────────────────────────────────
    _drawCasing() {
        const W = this.width, H = this.height;
        const cx = this._dialCX, cy = this._dialCY;
        const R  = this._caseR;

        // 外壳（铸铁深灰）
        this._staticGroup.add(new Konva.Ellipse({
            x: cx, y: cy, radiusX: R, radiusY: R * 0.92,
            fill: '#2e2e2e', stroke: '#484848', strokeWidth: 3,
            shadowColor: '#000', shadowBlur: 10, shadowOffsetY: 4, shadowOpacity: 0.5,
        }));
        // 内圈（黄铜边框）
        this._staticGroup.add(new Konva.Ellipse({
            x: cx, y: cy, radiusX: R - 6, radiusY: (R - 6) * 0.92,
            fill: '#b8903a', stroke: '#d4aa50', strokeWidth: 2,
        }));
        // 玻璃表面（乳白）
        this._staticGroup.add(new Konva.Ellipse({
            x: cx, y: cy, radiusX: R - 10, radiusY: (R - 10) * 0.92,
            fill: '#f5f2e8', stroke: '#c8c090', strokeWidth: 1,
        }));
        // 玻璃高光
        this._staticGroup.add(new Konva.Ellipse({
            x: cx - R * 0.18, y: cy - R * 0.22,
            radiusX: R * 0.22, radiusY: R * 0.12,
            fill: 'rgba(255,255,255,0.28)', rotation: -20,
        }));

        // 底座
        const b = this._base;
        this._staticGroup.add(new Konva.Rect({
            x: b.x, y: b.y, width: b.w, height: b.h,
            fill: '#2a2a2e', stroke: '#3a3a42', strokeWidth: 1.2, cornerRadius: b.rx,
        }));
        // 底座螺钉
        [0.12, 0.50, 0.88].forEach(fx => {
            const sx = b.x + b.w * fx, sy = b.y + b.h/2, sr = this.width * 0.016;
            this._staticGroup.add(new Konva.Circle({ x:sx, y:sy, radius:sr, fill:'#888', stroke:'#555', strokeWidth:0.7 }));
            this._staticGroup.add(new Konva.Line({ points:[sx-sr*0.6,sy,sx+sr*0.6,sy], stroke:'#444', strokeWidth:1, lineCap:'round' }));
            this._staticGroup.add(new Konva.Line({ points:[sx,sy-sr*0.6,sx,sy+sr*0.6], stroke:'#444', strokeWidth:1, lineCap:'round' }));
        });
    }

    // ── 表盘装饰刻度 ─────────────────────────────────────────
    _drawDial() {
        const cx = this._dialCX, cy = this._dialCY;
        const R  = this._caseR - 14;
        const g  = new Konva.Group();

        // 60 格刻度（模拟秒表风格装饰）
        for (let i = 0; i < 60; i++) {
            const isMajor = i % 5 === 0;
            const ang = (i / 60) * Math.PI * 2 - Math.PI / 2;
            const tL  = isMajor ? 8 : 4;
            g.add(new Konva.Line({
                points: [
                    cx + R * Math.cos(ang), cy + R * Math.sin(ang),
                    cx + (R-tL) * Math.cos(ang), cy + (R-tL) * Math.sin(ang),
                ],
                stroke: isMajor ? '#8a7030' : '#c0b068',
                strokeWidth: isMajor ? 1.4 : 0.7,
            }));
        }

        // 品牌铭文区
        g.add(new Konva.Text({
            x: cx - 34, y: cy - R + 14,
            text: 'WATER METER', fontSize: 7, fontStyle: 'bold',
            fill: '#8a7030', letterSpacing: 1.5,
        }));

        // 量程标注（m³/h）
        g.add(new Konva.Text({
            x: cx - 28, y: cy + R - 26, width: 56,
            text: `Qn=${this.nominalFlow} m³/h`,
            fontSize: 7, fill: '#8a7030', align: 'center',
        }));

        this._staticGroup.add(g);
    }

    // ── 进出水管 ─────────────────────────────────────────────
    _drawPipes() {
        const W  = this.width;
        const cy = this._pipeInY;
        const r  = this._pipeR;
        const cx = this._dialCX;
        const cR = this._caseR;

        // 左进水管
        this._staticGroup.add(new Konva.Rect({
            x: 0, y: cy - r, width: cx - cR * 0.72, height: r * 2,
            fillLinearGradientStartPoint: { x:0, y:0 },
            fillLinearGradientEndPoint:   { x:0, y:r*2 },
            fillLinearGradientColorStops: [0,'#666',0.3,'#aaa',0.6,'#888',1,'#555'],
            stroke: '#444', strokeWidth: 1,
        }));
        // 左法兰
        this._staticGroup.add(new Konva.Ellipse({
            x: 0, y: cy, radiusX: 4, radiusY: r * 1.35,
            fill: '#888', stroke: '#666', strokeWidth: 1.2,
        }));

        // 右出水管
        this._staticGroup.add(new Konva.Rect({
            x: cx + cR * 0.72, y: cy - r, width: W - (cx + cR*0.72), height: r * 2,
            fillLinearGradientStartPoint: { x:0, y:0 },
            fillLinearGradientEndPoint:   { x:0, y:r*2 },
            fillLinearGradientColorStops: [0,'#666',0.3,'#aaa',0.6,'#888',1,'#555'],
            stroke: '#444', strokeWidth: 1,
        }));
        this._staticGroup.add(new Konva.Ellipse({
            x: W, y: cy, radiusX: 4, radiusY: r * 1.35,
            fill: '#888', stroke: '#666', strokeWidth: 1.2,
        }));

        // 叶轮腔体（圆柱截面）
        this._staticGroup.add(new Konva.Circle({
            x: this._impCX, y: this._impCY, radius: this._impR + 6,
            fill: '#3a3a40', stroke: '#606068', strokeWidth: 1.5,
        }));
        this._staticGroup.add(new Konva.Circle({
            x: this._impCX, y: this._impCY, radius: this._impR + 2,
            fill: '#4a4a50', stroke: '#808088', strokeWidth: 0.8,
        }));

        // 管道内部（水蓝色）
        this._staticGroup.add(new Konva.Rect({
            x: 2, y: cy - r + 2,
            width: cx - cR * 0.72 - 2, height: r * 2 - 4,
            fill: 'rgba(80,160,220,0.25)',
        }));
        this._staticGroup.add(new Konva.Rect({
            x: cx + cR * 0.72, y: cy - r + 2,
            width: W - (cx + cR*0.72) - 2, height: r * 2 - 4,
            fill: 'rgba(80,160,220,0.25)',
        }));
    }

    // ── 字轮窗框（静态外框，字轮本体在动态层）────────────
    _drawWheelFrame() {
        const N   = 6;
        const wx  = this._wheelX, wy = this._wheelY;
        const ww  = this._wheelW, wh = this._wheelH;
        const gap = this._wheelGap;
        const totalW = N * ww + (N-1) * gap;

        // 字轮总外框
        this._staticGroup.add(new Konva.Rect({
            x: wx - 4, y: wy - 4, width: totalW + 8, height: wh + 8,
            fill: '#1a1a1a', stroke: '#606060', strokeWidth: 2, cornerRadius: 4,
            shadowColor: '#000', shadowBlur: 6, shadowOpacity: 0.5,
        }));

        // 各字轮窗口（黑色背景）
        for (let i = 0; i < N; i++) {
            const x = wx + i * (ww + gap);
            this._staticGroup.add(new Konva.Rect({
                x, y: wy, width: ww, height: wh,
                fill: '#0a0a0a', stroke: '#404040', strokeWidth: 0.8,
            }));
        }

        // 中央读数线（红色横线）
        this._staticGroup.add(new Konva.Rect({
            x: wx - 4, y: wy + wh/2 - 1.5, width: totalW + 8, height: 3,
            fill: 'rgba(220,50,50,0.50)',
        }));

        // 小数点（第 3 位后面）—— 前 3 位为整数 m³，后 3 位为小数
        const dotX = wx + 3 * (ww + gap) - gap/2 - 2;
        this._staticGroup.add(new Konva.Circle({
            x: dotX, y: wy + wh + 6, radius: 2.5,
            fill: '#e0e0e0',
        }));

        // 位权标注（在窗口下方）
        const units = ['×100', '×10 ', '×1  ', '×0.1', '×.01', '×.001'];
        const colors= ['#ef9a9a','#ef9a9a','#ef9a9a','#90caf9','#90caf9','#90caf9'];
        for (let i = 0; i < N; i++) {
            const x = wx + i * (ww + gap);
            this._staticGroup.add(new Konva.Text({
                x, y: wy + wh + 3, width: ww,
                text: units[i], fontSize: 6, fill: colors[i], align: 'center',
            }));
        }

        // 单位 "m³"
        this._staticGroup.add(new Konva.Text({
            x: wx, y: wy - 16, width: totalW,
            text: '累计用水量  (m³)',
            fontSize: 8, fontStyle: 'bold', fill: '#8a7030', align: 'center',
        }));
    }

    // ── 静态标注 ─────────────────────────────────────────────
    _drawStaticLabels() {
        const W = this.width;

        this._staticGroup.add(new Konva.Text({
            x: 0, y: -16, width: W,
            text: `${this.label}  机械水表  DN15  ${this.ratedVoltage || ''}`,
            fontSize: 9, fontStyle: 'bold', fill: '#546e7a', align: 'center',
        }));

        // 进出水标注
        this._staticGroup.add(new Konva.Text({
            x: 2, y: this._pipeInY - this._pipeR - 16,
            text: '进水', fontSize: 8, fontStyle: 'bold', fill: '#90caf9',
        }));
        this._staticGroup.add(new Konva.Text({
            x: this.width - 26, y: this._pipeInY - this._pipeR - 16,
            text: '出水', fontSize: 8, fontStyle: 'bold', fill: '#80cbc4',
        }));

        // 叶轮标注
        this._staticGroup.add(new Konva.Text({
            x: this._impCX - 16, y: this._impCY + this._impR + 8,
            text: '叶轮', fontSize: 7, fill: '#888',
        }));

        // 齿轮组标注
        this._staticGroup.add(new Konva.Text({
            x: this._gearCX - 20, y: this._gearCY - this._caseR * 0.52 + 2,
            text: '减速齿轮组', fontSize: 7, fill: '#888',
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
        this._statusFlow = new Konva.Text({
            x: b.x + 22, y: b.y + b.h/2 - 5, width: 90,
            text: '流量: 0.00 m³/h', fontSize: 8, fontStyle: 'bold', fill: '#90caf9',
        });
        this._statusRpm = new Konva.Text({
            x: b.x + 115, y: b.y + b.h/2 - 5, width: 80,
            text: '转速: 0 rpm', fontSize: 8, fill: '#a5d6a7',
        });
        this._statusVol = new Konva.Text({
            x: b.x + 200, y: b.y + b.h/2 - 5, width: 110,
            text: '累计: 0.000 m³', fontSize: 8, fill: '#ffcc80',
        });
        this._staticGroup.add(this._statusDot, this._statusFlow, this._statusRpm, this._statusVol);
    }

    // ═══════════════════════════════════════════════════════════
    // 动态层
    // ═══════════════════════════════════════════════════════════

    _rebuildDynamic() {
        this._dynamicGroup.destroyChildren();
        this._drawWaterParticles();
        this._drawImpeller();
        this._drawGearTrain();
        this._drawWheels();
        this._drawCarryPawls();
    }

    // ── 水流粒子 ─────────────────────────────────────────────
    _drawWaterParticles() {
        const cy  = this._pipeInY;
        const r   = this._pipeR;
        const cx  = this._dialCX;
        const cR  = this._caseR;
        const pipeEnd = cx - cR * 0.72;

        this._particles.forEach(p => {
            if (p.x > pipeEnd) return;
            const alpha = p.life * 0.7;
            this._dynamicGroup.add(new Konva.Circle({
                x: p.x, y: p.y,
                radius: p.r,
                fill: `rgba(100,180,240,${alpha})`,
            }));
        });
    }

    // ── 叶轮 ─────────────────────────────────────────────────
    _drawImpeller() {
        const cx  = this._impCX, cy = this._impCY;
        const R   = this._impR;
        const ang = this._impellerAngle;
        const spd = Math.abs(this._impellerSpeed);
        const glow = Math.min(1, spd / 8);

        // 叶轮腔内水（随流量变色）
        if (this._flowRate > 0.01) {
            this._dynamicGroup.add(new Konva.Circle({
                x: cx, y: cy, radius: R,
                fill: `rgba(60,140,210,${0.15 + glow * 0.25})`,
            }));
        }

        const g = new Konva.Group({ x: cx, y: cy, rotation: ang * 180 / Math.PI });

        // 叶片（8 片，两种长度交替）
        const BLADES = 8;
        for (let i = 0; i < BLADES; i++) {
            const a   = (i / BLADES) * Math.PI * 2;
            const isL = i % 2 === 0;
            const bl  = isL ? R * 0.92 : R * 0.72;
            const bw  = R * 0.14;

            // 叶片（梯形，有弯曲感）
            const cosA = Math.cos(a), sinA = Math.sin(a);
            g.add(new Konva.Line({
                points: [
                    cosA * R * 0.18 - sinA * bw * 0.4, sinA * R * 0.18 + cosA * bw * 0.4,
                    cosA * R * 0.18 + sinA * bw * 0.4, sinA * R * 0.18 - cosA * bw * 0.4,
                    cosA * bl + sinA * bw * 0.18, sinA * bl - cosA * bw * 0.18,
                    cosA * bl - sinA * bw * 0.18, sinA * bl + cosA * bw * 0.18,
                ],
                closed: true,
                fillLinearGradientStartPoint: { x: 0, y: 0 },
                fillLinearGradientEndPoint:   { x: cosA*bl, y: sinA*bl },
                fillLinearGradientColorStops: [
                    0, '#b8903a',
                    0.5, '#e0b850',
                    1, glow > 0.3 ? `rgba(220,200,100,${0.5+glow*0.5})` : '#a07828',
                ],
                stroke: '#7a5c18', strokeWidth: 0.7,
            }));
        }

        // 叶轮中心轴
        g.add(new Konva.Circle({
            x: 0, y: 0, radius: R * 0.20,
            fillRadialGradientStartPoint: { x:-2, y:-2 },
            fillRadialGradientEndPoint:   { x:0, y:0 },
            fillRadialGradientStartRadius: 2,
            fillRadialGradientEndRadius:   R * 0.20,
            fillRadialGradientColorStops:  [0,'#e0e0e0',1,'#888'],
            stroke: '#666', strokeWidth: 0.8,
        }));
        // 轴十字槽
        g.add(new Konva.Line({ points:[-R*0.12,0,R*0.12,0], stroke:'#555', strokeWidth:1.2 }));
        g.add(new Konva.Line({ points:[0,-R*0.12,0,R*0.12], stroke:'#555', strokeWidth:1.2 }));

        this._dynamicGroup.add(g);

        // 叶轮轴连接到齿轮组的传动轴（水平连线）
        this._dynamicGroup.add(new Konva.Line({
            points: [cx + R + 4, cy, this._gearCX - this._gearSizes[0] - 2, this._gearCY + this._gearSizes[0] * 0.6],
            stroke: '#666', strokeWidth: 2.5, lineCap: 'round',
        }));
    }

    // ── 减速齿轮组 ───────────────────────────────────────────
    _drawGearTrain() {
        // 4 个齿轮，竖向排列，从大到小
        const baseX = this._gearCX;
        const sizes = this._gearSizes;

        // 齿轮中心坐标
        const gears = [
            { x: baseX,            y: this._gearCY + sizes[0] * 0.5,  r: sizes[0] },
            { x: baseX + sizes[0] * 0.4, y: this._gearCY - sizes[1] * 0.2, r: sizes[1] },
            { x: baseX - sizes[1] * 0.3, y: this._gearCY - sizes[0] - sizes[2] * 0.8, r: sizes[2] },
            { x: baseX + sizes[2] * 0.8, y: this._gearCY - sizes[0] - sizes[2] * 0.8 - sizes[2] - sizes[3], r: sizes[3] },
        ];

        // 齿轮间连接轴线
        for (let i = 0; i < gears.length - 1; i++) {
            const g1 = gears[i], g2 = gears[i+1];
            this._dynamicGroup.add(new Konva.Line({
                points: [g1.x, g1.y, g2.x, g2.y],
                stroke: 'rgba(100,100,100,0.4)', strokeWidth: 1, dash: [3,3],
            }));
        }

        gears.forEach((gc, idx) => {
            this._drawGear(gc.x, gc.y, gc.r, this._gearAngles[idx], idx);
        });

        // 最后一级齿轮连接到字轮的轴
        const lastG = gears[gears.length-1];
        const wheelEnd = this._wheelX + 5 * (this._wheelW + this._wheelGap) + this._wheelW / 2;
        this._dynamicGroup.add(new Konva.Line({
            points: [lastG.x, lastG.y, wheelEnd, this._wheelY + this._wheelH / 2],
            stroke: '#666', strokeWidth: 1.5, dash: [4,3], lineCap: 'round',
        }));
    }

    _drawGear(cx, cy, R, angle, idx) {
        const TEETH  = Math.max(8, Math.round(R * 1.5));
        const spd    = Math.abs(this._impellerSpeed * Math.abs(this._gearRatios[idx]));
        const glow   = Math.min(1, spd / 20);
        const colors = ['#c89030','#b07828','#a06820','#906010'];
        const base   = colors[idx] || '#888';

        // 齿轮齿（绕圆周生成）
        const outerR = R;
        const innerR = R * 0.78;
        const toothW = (2 * Math.PI / TEETH) * 0.42;

        const pts = [];
        for (let i = 0; i < TEETH; i++) {
            const a0 = angle + (i / TEETH) * Math.PI * 2;
            const a1 = a0 + toothW * 0.5;
            const a2 = a0 + toothW;
            const a3 = a0 + (2 * Math.PI / TEETH) - toothW * 0.15;
            pts.push(
                cx + innerR * Math.cos(a0), cy + innerR * Math.sin(a0),
                cx + outerR * Math.cos(a1), cy + outerR * Math.sin(a1),
                cx + outerR * Math.cos(a2), cy + outerR * Math.sin(a2),
                cx + innerR * Math.cos(a3), cy + innerR * Math.sin(a3),
            );
        }
        this._dynamicGroup.add(new Konva.Line({
            points: pts, closed: true,
            fill: glow > 0.2 ? `rgba(220,180,60,${0.7+glow*0.3})` : base,
            stroke: '#5a3c08', strokeWidth: 0.8,
        }));

        // 轮毂圆
        this._dynamicGroup.add(new Konva.Circle({
            x: cx, y: cy, radius: innerR * 0.45,
            fill: '#7a5818', stroke: '#5a3c08', strokeWidth: 0.7,
        }));
        // 辐条（3 根）
        for (let s = 0; s < 3; s++) {
            const sa = angle + s * Math.PI * 2 / 3;
            this._dynamicGroup.add(new Konva.Line({
                points: [cx, cy, cx + innerR * 0.42 * Math.cos(sa), cy + innerR * 0.42 * Math.sin(sa)],
                stroke: '#7a5818', strokeWidth: R * 0.14,
                lineCap: 'round',
            }));
        }
        // 轴心
        this._dynamicGroup.add(new Konva.Circle({
            x: cx, y: cy, radius: innerR * 0.18,
            fill: '#d0d0d0', stroke: '#aaa', strokeWidth: 0.6,
        }));
    }

    // ── 十进制字轮 ───────────────────────────────────────────
    _drawWheels() {
        const N   = 6;
        // 各位权值（从高到低）
        const places = [100, 10, 1, 0.1, 0.01, 0.001];

        for (let i = 0; i < N; i++) {
            const x    = this._wheelX + i * (this._wheelW + this._wheelGap);
            const y    = this._wheelY;
            const ww   = this._wheelW;
            const wh   = this._wheelH;
            const place= places[i];

            // 字轮连续角度（每一圈 = 字轮转动 2π → 数值增加 10 个单位 × place）
            const wheelRot = (this._totalVolume / place) * (2 * Math.PI / 10);

            this._drawSingleWheel(x, y, ww, wh, wheelRot, i);
        }
    }

    _drawSingleWheel(x, y, ww, wh, rotation, idx) {
        // 字轮为圆柱面展开：正面可见 3 个数字（上、中、下）
        // 当前数字在中央，上方是上一个，下方是下一个
        const digitH = wh / 3;

        // 裁剪区（只显示字轮窗口内）
        const clipG = new Konva.Group({ clip: { x, y, width: ww, height: wh } });

        // 字轮背景（圆柱感：中央略亮，上下略暗）
        const bgGrd = new Konva.Rect({
            x, y, width: ww, height: wh,
            fillLinearGradientStartPoint: { x:0, y:0 },
            fillLinearGradientEndPoint:   { x:0, y:wh },
            fillLinearGradientColorStops: [0,'#1a1a1a',0.3,'#2a2a2a',0.5,'#222',0.7,'#2a2a2a',1,'#1a1a1a'],
        });
        clipG.add(bgGrd);

        // 计算当前显示的小数位置（rotation / (2π/10) = 当前十进制计数位）
        const floatDigit = (rotation / (2 * Math.PI / 10)) % 10;
        // floatDigit 的整数部分 = 中央显示的数字
        // 小数部分 = 滚动偏移（0=静止，0.5=滚动一半）
        const frac     = floatDigit % 1;        // 0~1，当前滚动进度
        const centerDig= Math.floor(floatDigit) % 10;
        const prevDig  = (centerDig + 1) % 10;  // 上方（将到来）
        const nextDig  = (centerDig - 1 + 10) % 10; // 下方（刚离开）

        // 绘制 3 个数字格（上、中、下），根据 frac 平移
        // frac=0: 中央显示 centerDig，frac→1: 向上滚动，prevDig 进入中央
        const offset = frac * digitH;

        [
            { digit: nextDig,  dy: -digitH + offset },   // 下方（已过）
            { digit: centerDig,dy: offset },              // 中央（当前）
            { digit: prevDig,  dy: digitH + offset },     // 上方（将来）
            { digit: (prevDig+1)%10, dy: digitH*2 + offset }, // 备用
        ].forEach(({ digit, dy }) => {
            const ty = y + wh/2 - digitH/2 - dy;
            if (ty < y - digitH || ty > y + wh) return;   // 裁剪外不绘

            // 数字背景
            const isCenter = Math.abs(dy - offset) < digitH * 0.5;
            clipG.add(new Konva.Rect({
                x: x + 1, y: ty + 0.5, width: ww - 2, height: digitH - 1,
                fill: isCenter ? (idx >= 3 ? '#001a30' : '#1a0000') : 'transparent',
                cornerRadius: 1,
            }));

            // 数字文字
            const isRed = idx < 3;   // 整数位红色，小数位蓝色
            clipG.add(new Konva.Text({
                x: x, y: ty, width: ww, height: digitH,
                text: String(digit),
                fontSize: Math.round(digitH * 0.68),
                fontFamily: 'monospace',
                fontStyle: 'bold',
                fill: isCenter
                    ? (isRed ? '#ff6060' : '#60c0ff')
                    : (isRed ? 'rgba(200,80,80,0.45)' : 'rgba(60,140,220,0.40)'),
                align: 'center',
                verticalAlign: 'middle',
            }));
        });

        this._dynamicGroup.add(clipG);

        // 字轮上下边缘阴影（增强立体感）
        this._dynamicGroup.add(new Konva.Rect({
            x, y, width: ww, height: wh * 0.12,
            fillLinearGradientStartPoint: {x:0,y:0},
            fillLinearGradientEndPoint:   {x:0,y:wh*0.12},
            fillLinearGradientColorStops: [0,'rgba(0,0,0,0.7)',1,'rgba(0,0,0,0)'],
        }));
        this._dynamicGroup.add(new Konva.Rect({
            x, y: y+wh*(1-0.12), width: ww, height: wh*0.12,
            fillLinearGradientStartPoint: {x:0,y:0},
            fillLinearGradientEndPoint:   {x:0,y:wh*0.12},
            fillLinearGradientColorStops: [0,'rgba(0,0,0,0)' ,1,'rgba(0,0,0,0.7)'],
        }));
    }

    // ── 拨爪进位可视化 ───────────────────────────────────────
    _drawCarryPawls() {
        const N      = 6;
        const places = [100, 10, 1, 0.1, 0.01, 0.001];
        const gap    = this._wheelGap;

        // 当低位字轮 9→0 进位时（即 frac > 0.85），高亮拨爪
        for (let i = N - 1; i >= 1; i--) {
            const x     = this._wheelX + i * (this._wheelW + gap);
            const y     = this._wheelY;
            const wh    = this._wheelH;
            const place = places[i];

            const floatD = (this._totalVolume / place) * (2 * Math.PI / 10) / (2 * Math.PI / 10) % 10;
            const frac   = floatD % 1;

            // 当 frac 接近 1（即将进位）时显示拨爪
            if (frac > 0.82) {
                const alpha = (frac - 0.82) / 0.18;
                // 拨爪箭头（指向高位字轮）
                this._dynamicGroup.add(new Konva.Arrow({
                    points: [x - gap - 2, y + wh/2 + 2, x - gap - this._wheelW * 0.5, y + wh/2 + 2],
                    stroke: `rgba(255,200,50,${alpha * 0.9})`,
                    fill:   `rgba(255,200,50,${alpha * 0.9})`,
                    strokeWidth: 1.5, pointerLength: 5, pointerWidth: 4,
                }));
                // 进位高亮框
                this._dynamicGroup.add(new Konva.Rect({
                    x: x - gap - this._wheelW - 2, y: y - 2,
                    width: this._wheelW + 4, height: this._wheelH + 4,
                    fill: 'none',
                    stroke: `rgba(255,200,50,${alpha * 0.6})`,
                    strokeWidth: 1.5, cornerRadius: 2,
                }));
            }
        }
    }

    // ═══════════════════════════════════════════════════════════
    // 物理仿真
    // ═══════════════════════════════════════════════════════════

    tick(dt) {
        this._tickSimulation(dt);
    
        this._refreshCache();
    }

    _tickSimulation(dt) {
        // 流量平滑跟随
        this._flowRate += (this._targetFlow - this._flowRate) * Math.min(1, dt * 3);

        // 叶轮物理（水力矩 − 阻尼）
        const torqueWater = this._flowRate * 4.5;                      // 水力矩（正比于流量）
        const torqueDrag  = -this._drag * this._impellerSpeed;         // 粘性阻尼
        const acc         = (torqueWater + torqueDrag) / this._inertia;
        this._impellerSpeed += acc * dt;
        this._impellerSpeed  = Math.max(0, this._impellerSpeed);       // 单向旋转
        this._impellerAngle += this._impellerSpeed * dt;

        // 齿轮角度更新
        for (let i = 0; i < this._gearAngles.length; i++) {
            this._gearAngles[i] += this._impellerSpeed * this._gearRatios[i] * dt;
        }

        // 用水量累积（叶轮旋转角 × 每 rad 对应体积）
        const dV = this._impellerSpeed * dt * this._volumePerRad;
        this._totalVolume += dV;

        // 水流粒子更新
        this._updateParticles(dt);

        this._rebuildDynamic();
        this._updateStatusBar();
        this._refreshCache();
    }

    _updateParticles(dt) {
        const cy     = this._pipeInY;
        const r      = this._pipeR;
        const pipeEnd= this._dialCX - this._caseR * 0.72;
        const vx     = 20 + this._flowRate * 60;  // 粒子水平速度

        // 更新现有粒子
        this._particles = this._particles.filter(p => {
            p.x    += vx * dt;
            p.y    += p.vy * dt;
            p.life -= dt * 1.5;
            return p.life > 0 && p.x < pipeEnd;
        });

        // 生成新粒子
        this._particleTimer += dt;
        const rate  = this._flowRate * 12;   // 粒子生成频率
        const inter = rate > 0 ? 1 / rate : 999;
        while (this._particleTimer > inter && this._flowRate > 0.01) {
            this._particles.push({
                x:  4,
                y:  cy + (Math.random() - 0.5) * r * 1.4,
                vy: (Math.random() - 0.5) * 4,
                r:  1.2 + Math.random() * 2,
                life: 0.6 + Math.random() * 0.4,
            });
            this._particleTimer -= inter;
        }
        if (rate === 0) this._particleTimer = 0;
    }

    _updateStatusBar() {
        const Q    = this._flowRate;
        const rpm  = this._impellerSpeed * 60 / (2 * Math.PI);
        const V    = this._totalVolume;
        const active = Q > 0.01;

        if (this._statusDot) {
            this._statusDot.fill(active ? '#29b6f6' : '#ef5350');
            this._statusDot.stroke(active ? '#0277bd' : '#c62828');
            this._statusDot.shadowColor(active ? '#29b6f6' : '#ef5350');
            this._statusDot.shadowBlur(active ? 6 : 2);
        }
        if (this._statusFlow) this._statusFlow.text(`流量: ${Q.toFixed(2)} m³/h`);
        if (this._statusRpm)  this._statusRpm.text(`转速: ${rpm.toFixed(0)} rpm`);
        if (this._statusVol)  this._statusVol.text(`累计: ${V.toFixed(3)} m³`);
    }

    // ═══════════════════════════════════════════════════════════
    // 公开 API
    // ═══════════════════════════════════════════════════════════

    /**
     * 设置瞬时流量
     * @param {number} qm3h  流量（m³/h），0 ~ maxFlow
     */
    setFlow(qm3h) {
        this._targetFlow = Math.max(0, Math.min(this.maxFlow, qm3h));
        this._refreshCache();
    }

    /**
     * 强制设置累计用水量（m³）
     * @param {number} v  体积（m³）
     */
    setVolume(v) {
        this._totalVolume = Math.max(0, v);
        this._refreshCache();
    }

    /** 清零计数器 */
    resetCounter() {
        this._totalVolume = 0;
        this._refreshCache();
    }

    /** 获取当前流量（m³/h） */
    getFlow()    { return this._flowRate; }

    /** 获取叶轮转速（rpm） */
    getRpm()     { return this._impellerSpeed * 60 / (2 * Math.PI); }

    /** 获取累计用水量（m³） */
    getVolume()  { return this._totalVolume; }

    /** 获取 6 位字轮读数数组 [d0...d5]（从高位到低位） */
    getDigits() {
        const places = [100, 10, 1, 0.1, 0.01, 0.001];
        return places.map(p => Math.floor(this._totalVolume / p) % 10);
    }

    update(state) {
        if (typeof state === 'number') this.setFlow(state);
        this._refreshCache();
    }

    getConfigFields() {
        return [
            { label: '位号/名称',          key: 'label',        type: 'text'   },
            { label: '额定流量 Qn (m³/h)', key: 'nominalFlow',  type: 'number' },
            { label: '最大流量 (m³/h)',    key: 'maxFlow',      type: 'number' },
            { label: '表常数 (L/rev)',      key: 'meterConst',   type: 'number' },
            { label: '初始累计量 (m³)',     key: 'initVolume',   type: 'number' },
            { label: '初始流量 (m³/h)',     key: 'initFlow',     type: 'number' },
            { label: '叶轮阻尼系数',        key: 'drag',         type: 'number' },
        ];
    }

    onConfigUpdate(cfg) {
        if (cfg.label)       this.label       = cfg.label;
        if (cfg.nominalFlow) this.nominalFlow  = parseFloat(cfg.nominalFlow);
        if (cfg.maxFlow)     this.maxFlow      = parseFloat(cfg.maxFlow);
        if (cfg.meterConst) {
            this.meterConst    = parseFloat(cfg.meterConst);
            this._volumePerRad = (1 / this.meterConst) * 1e-3 / (2 * Math.PI);
        }
        if (cfg.initVolume !== undefined) this.setVolume(parseFloat(cfg.initVolume));
        if (cfg.initFlow   !== undefined) this.setFlow(parseFloat(cfg.initFlow));
        if (cfg.drag)        this._drag       = parseFloat(cfg.drag);
        this.config = { ...this.config, ...cfg };
        this._refreshCache();
    }

    destroy() {
        this._particles = [];
        super.destroy?.();
    }
}