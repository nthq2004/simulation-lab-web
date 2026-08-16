import { BaseComponent } from './BaseComponent.js';

/**
 * 热继电器仿真组件
 * （Thermal Overload Relay / Bimetallic Thermal Relay）
 *
 * ── 器件原理 ──────────────────────────────────────────────────
 *
 *  热继电器是利用双金属片热效应原理实现电动机过载保护的
 *  电气元件。其工作原理与双金属温度计相同，但被激励方式
 *  不同——通过电流加热元件（热元件）间接加热双金属片：
 *
 *  ┌─────────────────────────────────────────────────────────┐
 *  │  过载保护原理：                                          │
 *  │                                                         │
 *  │    I²·R·t = 焦耳热 → 双金属片温度升高 → 弯曲变形      │
 *  │    变形量超过临界值 → 推动脱扣机构 → 触点断开          │
 *  │                                                         │
 *  │  时间-电流特性（反时限特性）：                           │
 *  │    过载倍数越大，动作时间越短                            │
 *  │    t ≈ K / (I/In)² - 1）                               │
 *  │    其中 K 为热时间常数（s），In 为整定电流              │
 *  │                                                         │
 *  │  典型参数（JR36 系列）：                                 │
 *  │    整定范围：0.25A ~ 160A（分多档）                     │
 *  │    热时间常数：约 20min（额定电流下不动作）              │
 *  │    1.2In 时：不动作                                     │
 *  │    1.5In 时：< 2min 动作（冷态）                        │
 *  │    6In 时：< 5s 动作                                    │
 *  └─────────────────────────────────────────────────────────┘
 *
 * ── 内部结构 ──────────────────────────────────────────────────
 *
 *  热继电器由以下核心部件组成：
 *
 *  1. 热元件（Heating Element）
 *     - 绕在双金属片上的电阻丝（镍铬合金）
 *     - 通过焦耳热加热双金属片
 *     - 三相型有三组（每相一组）
 *     - 串联在主电路中
 *
 *  2. 双金属片（Bimetal Strip）
 *     - 上层：膨胀系数大的金属（黄铜/铁镍）
 *     - 下层：膨胀系数小的殷瓦合金
 *     - 过热时向上弯曲，推动脱扣杠杆
 *
 *  3. 脱扣机构（Trip Mechanism）
 *     - 杠杆系统，由弯曲的双金属片触发
 *     - 一旦触发，弹簧辅助快速动作（弹跳）
 *     - 防止在临界状态下反复动作
 *
 *  4. 触点系统（Contact System）
 *     - 常闭触点（95-96）：正常 → 闭合，过载 → 断开
 *     - 常开触点（97-98）：正常 → 断开，过载 → 闭合
 *     - 控制接触器线圈，实现电动机保护
 *
 *  5. 复位机构（Reset Mechanism）
 *     - 手动复位按钮（红色）：需手动按下复位
 *     - 自动复位模式：冷却后自动复位（可切换）
 *     - 复位条件：双金属片冷却至初始弯曲量以下
 *
 *  6. 整定电流调节旋钮（Current Setting Knob）
 *     - 旋转改变双金属片与脱扣机构的初始间距
 *     - 可在额定电流 ±20% 范围内调节
 *
 *  7. 差动机构（Differential Mechanism，三相型）
 *     - 检测三相电流不平衡（断相保护）
 *     - 任一相断相时，差动片倾斜触发脱扣
 *
 * ── 仿真动画 ──────────────────────────────────────────────────
 *
 *  1. 热元件发热：电流越大颜色越红，含线圈螺旋发热纹理
 *  2. 双金属片弯曲：随累积热量实时弯曲变形（含黄铜/殷瓦双色）
 *  3. 脱扣动作：双金属片达到临界点时，杠杆弹跳动画（<50ms）
 *  4. 触点切换：NC→断开/NO→闭合，切换瞬间电弧闪光
 *  5. 复位按钮：点击手动复位，弹簧弹出动画
 *  6. 整定旋钮：可拖动旋转，调节整定电流
 *  7. 热量积累进度条：可视化当前热量状态
 *  8. 反时限特性曲线：实时显示当前工作点
 *  9. 冷却余热：过载动作后慢慢冷却恢复
 * 10. 过电流发光：主回路接线端过电流时发红光
 *
 * ── 端口 ─────────────────────────────────────────────────────
 *  L1, L2, L3       — 三相主回路进线端（热元件串联）
 *  T1, T2, T3       — 三相主回路出线端（接电动机）
 *  terminal_95      — 常闭触点（NC）公共端
 *  terminal_96      — 常闭触点（NC）输出端
 *  terminal_97      — 常开触点（NO）公共端
 *  terminal_98      — 常开触点（NO）输出端
 */
export class ThermalRelay extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.width  = Math.max(200, config.width  || 260);
        this.height = Math.max(280, config.height || 360);

        this.type    = 'thermal_relay';
        this.special = 'none';
        this.cache   = 'fixed';

        // ── 额定参数 ──
        this.label        = config.label        || 'FR';
        this.ratedCurrent = config.ratedCurrent || 10;    // A 额定整定电流 In
        this.phases       = config.phases       || 3;     // 相数（1 或 3）
        // 热时间常数（s）：In 电流下不动作，1.5In 约需此时间的 0.14
        this.thermalConst = config.thermalConst || 120;   // s（JR36 典型约 2min）
        this.resetMode    = config.resetMode    || 'manual'; // 'manual'/'auto'

        // ── 运行状态 ──
        this._loadCurrent  = config.initCurrent || 0;    // A 当前负载电流
        this._thermalLevel = 0;       // 0~1 热量积累（1=临界动作）
        this._thermalVel   = 0;       // 热量变化速率
        this._tripped      = false;   // 是否已脱扣
        this._tripAnim     = 0;       // 脱扣动画进度 0~1
        this._tripAnimDir  = 0;       // 1=动作中，-1=复位中
        this._bimetal      = [0, 0, 0]; // 三相双金属片弯曲量 0~1
        this._arcFlash     = 0;       // 电弧闪光强度

        // 冷却余热（脱扣后仍有余热）
        this._cooldown     = 0;       // 冷却计时 s

        // ── 整定旋钮 ──
        this._settingKnob  = config.settingPos || 0.5;   // 0~1（调节范围 ±20%In）
        this._settingCurrent = this.ratedCurrent * (0.8 + this._settingKnob * 0.4);

        // ── 触点状态 ──
        // NC(95-96): 正常=闭合，脱扣=断开
        // NO(97-98): 正常=断开，脱扣=闭合
        this._ncClosed = true;   // NC 触点状态
        this._noClosed = false;  // NO 触点状态

        // ── 动画 ──
        this._glowPhase    = 0;

        // ── 几何布局 ──
        const W = this.width, H = this.height;

        // 外壳主体
        this._body = {
            x: W * 0.04, y: H * 0.03,
            w: W * 0.92, h: H * 0.86,
            rx: 4,
        };

        // 三相热元件区（上部，三列）
        this._heaters = Array.from({ length: this.phases }, (_, i) => ({
            cx: W * (0.22 + i * 0.28),
            y1: H * 0.06,
            y2: H * 0.44,
            w:  W * 0.14,
        }));

        // 双金属片区（热元件下方）
        this._bimetals = Array.from({ length: this.phases }, (_, i) => ({
            cx: W * (0.22 + i * 0.28),
            y:  H * 0.30,
            w:  W * 0.10,
            h:  H * 0.16,
        }));

        // 脱扣杠杆（中部）
        this._lever = {
            pivotX: W * 0.50,
            pivotY: H * 0.50,
            len:    W * 0.28,
        };

        // 触点区（下部）
        this._contacts = {
            nc: { x: W * 0.12, y: H * 0.58, w: W * 0.30, h: H * 0.10 },
            no: { x: W * 0.58, y: H * 0.58, w: W * 0.30, h: H * 0.10 },
        };

        // 整定旋钮
        this._knob = {
            cx: W * 0.82, cy: H * 0.72,
            r:  W * 0.10,
        };

        // 复位按钮
        this._resetBtn = {
            cx: W * 0.50, cy: H * 0.77,
            r:  W * 0.075,
        };

        // 热量进度条
        this._thermBar = {
            x: W * 0.06, y: H * 0.88,
            w: W * 0.88, h: H * 0.04,
            rx: 2,
        };

        // 主回路端子（上）
        this._mainPorts = Array.from({ length: this.phases }, (_, i) => ({
            label: `L${i + 1}`,
            x: W * (0.22 + i * 0.28),
            y: H * 0.03 - 4,
        }));
        this._outPorts = Array.from({ length: this.phases }, (_, i) => ({
            label: `T${i + 1}`,
            x: W * (0.22 + i * 0.28),
            y: H * 0.03 + H * 0.86 + 4,
        }));

        // 控制端子（下）
        this._ctrlPorts = [
            { id: 'terminal_95', label: '95', x: W * 0.18, y: H * 0.03 + H * 0.86 + 4 },
            { id: 'terminal_96', label: '96', x: W * 0.32, y: H * 0.03 + H * 0.86 + 4 },
            { id: 'terminal_97', label: '97', x: W * 0.62, y: H * 0.03 + H * 0.86 + 4 },
            { id: 'terminal_98', label: '98', x: W * 0.78, y: H * 0.03 + H * 0.86 + 4 },
        ];

        this._init();

        // 注册端口
        this._mainPorts.forEach((p, i) => {
            this.addPort(p.x, H * 0.03 - 8, `L${i + 1}`, 'wire', p.label);
        });
        this._outPorts.forEach((p, i) => {
            this.addPort(p.x, H * 0.03 + H * 0.86 + 8, `T${i + 1}`, 'wire', p.label);
        });
        this._ctrlPorts.forEach(p => {
            this.addPort(p.x, H * 0.03 + H * 0.86 + 8, p.id, 'wire', p.label);
        });
    }

    // ═══════════════════════════════════════════
    _init() {
        this._drawBody();           // 外壳（静态）
        this._drawMainTerminals();  // 主回路端子（静态）
        this._drawCtrlTerminals();  // 控制端子（静态）
        this._drawKnob();           // 整定旋钮（静态骨架）

        // 动态层
        this._heaterGroup  = new Konva.Group();
        this._bimetalGroup = new Konva.Group();
        this._leverGroup   = new Konva.Group();
        this._contactGroup = new Konva.Group();
        this._resetGroup   = new Konva.Group();
        this._barGroup     = new Konva.Group();
        this._glowGroup    = new Konva.Group();

        this.group.add(this._glowGroup);
        this.group.add(this._heaterGroup);
        this.group.add(this._bimetalGroup);
        this.group.add(this._leverGroup);
        this.group.add(this._contactGroup);
        this.group.add(this._resetGroup);
        this.group.add(this._barGroup);

        this._drawLabel();
        this._drawStatusPanel();

        this._rebuildAll();
        
    }

    // ── 外壳 ─────────────────────────────────
    _drawBody() {
        const b = this._body, W = this.width;

        // 主体外壳（工业灰色）
        this.group.add(new Konva.Rect({
            x: b.x, y: b.y, width: b.w, height: b.h,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint:   { x: b.w, y: b.h },
            fillLinearGradientColorStops: [
                0,   '#3a3e48',
                0.3, '#44484e',
                0.7, '#3e4248',
                1,   '#30343c',
            ],
            stroke: '#22262e', strokeWidth: 1.5,
            cornerRadius: b.rx,
            shadowColor: '#000', shadowBlur: 12,
            shadowOffsetY: 4, shadowOpacity: 0.45,
        }));

        // 顶面高光
        this.group.add(new Konva.Rect({
            x: b.x + 2, y: b.y + 2,
            width: b.w - 4, height: b.h * 0.05,
            fill: 'rgba(255,255,255,0.07)',
            cornerRadius: [b.rx, b.rx, 0, 0],
        }));

        // 内腔凹槽（热元件区域背景）
        this.group.add(new Konva.Rect({
            x: b.x + W * 0.04, y: b.y + H * 0.04,
            width: b.w - W * 0.08, height: this.height * 0.45,
            fill: '#282c34',
            stroke: '#1a1e26', strokeWidth: 0.8,
            cornerRadius: 2,
        }));

        // 外壳分模线（中部横线）
        this.group.add(new Konva.Line({
            points: [b.x + b.rx, b.y + b.h * 0.52,
                     b.x + b.w - b.rx, b.y + b.h * 0.52],
            stroke: 'rgba(0,0,0,0.30)', strokeWidth: 1,
        }));

        // 铭牌区（外壳上部）
        const npY = b.y + b.h * 0.005;
        this.group.add(new Konva.Rect({
            x: b.x + b.w * 0.30, y: npY + 2,
            width: b.w * 0.40, height: this.height * 0.025,
            fill: '#1e2028', stroke: '#141820', strokeWidth: 0.5,
            cornerRadius: 1,
        }));
        this.group.add(new Konva.Text({
            x: b.x + b.w * 0.30, y: npY + 3,
            width: b.w * 0.40,
            text: `JR36  ${this.ratedCurrent}A`,
            fontSize: 7, fill: 'rgba(180,200,220,0.55)',
            align: 'center', fontFamily: 'Courier New',
        }));

        // 外壳四角螺钉
        [[b.x + 8, b.y + 8], [b.x + b.w - 8, b.y + 8],
         [b.x + 8, b.y + b.h - 8], [b.x + b.w - 8, b.y + b.h - 8]
        ].forEach(([sx, sy]) => {
            this.group.add(new Konva.Circle({
                x: sx, y: sy, radius: 3,
                fill: '#505866', stroke: '#30343c', strokeWidth: 0.6,
            }));
            this.group.add(new Konva.Line({
                points: [sx - 1.8, sy - 1.8, sx + 1.8, sy + 1.8],
                stroke: '#3a3e48', strokeWidth: 0.7,
            }));
        });
    }

    // ── 主回路端子 ───────────────────────────
    _drawMainTerminals() {
        const W = this.width, H = this.height;
        const b = this._body;
        const termH = H * 0.038, termW = W * 0.12;

        // 上端（进线 L1/L2/L3）
        this._heaters.forEach((h, i) => {
            const tx = h.cx - termW / 2;
            const ty = b.y;

            // 端子块
            this.group.add(new Konva.Rect({
                x: tx, y: ty - termH,
                width: termW, height: termH,
                fillLinearGradientStartPoint: { x: 0, y: 0 },
                fillLinearGradientEndPoint:   { x: termW, y: 0 },
                fillLinearGradientColorStops: [
                    0, '#606870', 0.3, '#9aa0a8', 0.6, '#c0c8d0', 0.85, '#8a9298', 1, '#606870',
                ],
                stroke: '#404850', strokeWidth: 0.8, cornerRadius: 2,
            }));
            // 端子螺钉
            this.group.add(new Konva.Circle({
                x: h.cx, y: ty - termH / 2, radius: termW * 0.22,
                fill: '#888', stroke: '#555', strokeWidth: 0.6,
            }));
            this.group.add(new Konva.Line({
                points: [h.cx - termW * 0.15, ty - termH / 2,
                         h.cx + termW * 0.15, ty - termH / 2],
                stroke: '#444', strokeWidth: 0.8,
            }));
            // 标注
            this.group.add(new Konva.Text({
                x: h.cx - 8, y: ty - termH - 12,
                width: 16, text: `L${i + 1}`,
                fontSize: 8, fill: '#ef9a9a',
                align: 'center', fontStyle: 'bold',
            }));

            // 下端（出线 T1/T2/T3）
            const by2 = b.y + b.h;
            this.group.add(new Konva.Rect({
                x: tx, y: by2,
                width: termW, height: termH,
                fillLinearGradientStartPoint: { x: 0, y: 0 },
                fillLinearGradientEndPoint:   { x: termW, y: 0 },
                fillLinearGradientColorStops: [
                    0, '#606870', 0.3, '#9aa0a8', 0.6, '#c0c8d0', 0.85, '#8a9298', 1, '#606870',
                ],
                stroke: '#404850', strokeWidth: 0.8, cornerRadius: 2,
            }));
            this.group.add(new Konva.Circle({
                x: h.cx, y: by2 + termH / 2, radius: termW * 0.22,
                fill: '#888', stroke: '#555', strokeWidth: 0.6,
            }));
            this.group.add(new Konva.Line({
                points: [h.cx - termW * 0.15, by2 + termH / 2,
                         h.cx + termW * 0.15, by2 + termH / 2],
                stroke: '#444', strokeWidth: 0.8,
            }));
            this.group.add(new Konva.Text({
                x: h.cx - 8, y: by2 + termH + 2,
                width: 16, text: `T${i + 1}`,
                fontSize: 8, fill: '#90caf9',
                align: 'center', fontStyle: 'bold',
            }));
        });
    }

    // ── 控制触点端子 ─────────────────────────
    _drawCtrlTerminals() {
        const W = this.width, H = this.height;
        const b = this._body;
        const termH = H * 0.032, termW = W * 0.10;
        const by2   = b.y + b.h;

        // 四个控制端子（95/96/97/98）
        this._ctrlPorts.forEach((p, i) => {
            const tx = p.x - termW / 2;
            this.group.add(new Konva.Rect({
                x: tx, y: by2,
                width: termW, height: termH,
                fill: '#5a6070', stroke: '#3a4050', strokeWidth: 0.8, cornerRadius: 2,
            }));
            this.group.add(new Konva.Circle({
                x: p.x, y: by2 + termH / 2, radius: termW * 0.22,
                fill: '#808898', stroke: '#505868', strokeWidth: 0.5,
            }));
            this.group.add(new Konva.Text({
                x: p.x - 8, y: by2 + termH + 2,
                width: 16, text: p.label,
                fontSize: 7.5, fill: i < 2 ? '#ffcc80' : '#80deea',
                align: 'center', fontStyle: 'bold',
                fontFamily: 'Courier New',
            }));
        });

        // NC/NO 标注
        const labelY = by2 + termH + 12;
        this.group.add(new Konva.Text({
            x: this._ctrlPorts[0].x - 20, y: labelY,
            width: 60, text: 'NC（常闭）',
            fontSize: 6.5, fill: '#ffcc80', align: 'center',
            fontFamily: 'Courier New',
        }));
        this.group.add(new Konva.Text({
            x: this._ctrlPorts[2].x - 20, y: labelY,
            width: 60, text: 'NO（常开）',
            fontSize: 6.5, fill: '#80deea', align: 'center',
            fontFamily: 'Courier New',
        }));
    }

    // ── 整定旋钮（静态骨架）──────────────────
    _drawKnob() {
        const k = this._knob, W = this.width;

        // 外圈刻度盘
        this.group.add(new Konva.Circle({
            x: k.cx, y: k.cy, radius: k.r + 4,
            fill: '#1e2228', stroke: '#2a3038', strokeWidth: 0.8,
        }));
        // 刻度线（±20% 范围）
        for (let i = 0; i <= 10; i++) {
            const ang  = (-150 + i * 30) * Math.PI / 180;
            const r0   = k.r + 1, r1 = k.r + (i % 5 === 0 ? 4 : 2.5);
            this.group.add(new Konva.Line({
                points: [
                    k.cx + Math.cos(ang) * r0, k.cy + Math.sin(ang) * r0,
                    k.cx + Math.cos(ang) * r1, k.cy + Math.sin(ang) * r1,
                ],
                stroke: i % 5 === 0 ? '#90a0b0' : '#505860',
                strokeWidth: i % 5 === 0 ? 1.0 : 0.6,
            }));
        }
        // 电流刻度标注
        ['-20%', 'In', '+20%'].forEach((lbl, i) => {
            const ang = (-150 + i * 150) * Math.PI / 180;
            const nr  = k.r + 8;
            this.group.add(new Konva.Text({
                x: k.cx + Math.cos(ang) * nr - 10,
                y: k.cy + Math.sin(ang) * nr - 4,
                width: 20, text: lbl,
                fontSize: 5.5, fill: '#607080', align: 'center',
                fontFamily: 'Courier New',
            }));
        });
        // 标注文字
        this.group.add(new Konva.Text({
            x: k.cx - k.r * 1.4, y: k.cy + k.r + 5,
            width: k.r * 2.8, text: '整定电流',
            fontSize: 6.5, fill: '#506070',
            align: 'center', fontFamily: 'Courier New',
        }));
        this.group.add(new Konva.Text({
            x: k.cx - k.r * 1.4, y: k.cy + k.r + 13,
            width: k.r * 2.8,
            text: `${this._settingCurrent.toFixed(1)} A`,
            fontSize: 7, fill: '#70a0c0', fontStyle: 'bold',
            align: 'center', fontFamily: 'Courier New',
        }));
    }

    // ══════════════════════════════════════════
    // ── 动态重绘 ──────────────────────────────

    _rebuildAll() {
        this._rebuildGlow();
        this._rebuildHeaters();
        this._rebuildBimetals();
        this._rebuildLever();
        this._rebuildContacts();
        this._rebuildResetBtn();
        this._rebuildThermBar();
        this._rebuildKnobPointer();
        this._updateStatusPanel();
    }

    // ── 热元件发热（动态）────────────────────
    _rebuildHeaters() {
        this._heaterGroup.destroyChildren();
        const W = this.width, H = this.height;

        const overFrac = Math.max(0, Math.min(1,
            this._loadCurrent / this._settingCurrent - 1));
        const heatFrac = Math.min(1, this._thermalLevel);
        const gPhase   = this._glowPhase;

        this._heaters.forEach((h, i) => {
            const cx = h.cx;
            const y1 = h.y1 + H * 0.045;
            const y2 = h.y2 - H * 0.05;
            const hw = h.w;

            // 热元件外管（镍铬合金线圈外壳）
            this._heaterGroup.add(new Konva.Rect({
                x: cx - hw * 0.45, y: y1,
                width: hw * 0.90, height: y2 - y1,
                fill: '#1e2028',
                stroke: 'rgba(80,100,120,0.40)', strokeWidth: 0.6,
                cornerRadius: 2,
            }));

            // 螺旋加热丝（正弦波近似）
            const turns = 8;
            const segPts = [];
            for (let j = 0; j <= turns * 16; j++) {
                const t   = j / (turns * 16);
                const y   = y1 + 4 + t * (y2 - y1 - 8);
                const xOf = Math.sin(t * turns * Math.PI * 2) * hw * 0.25;
                segPts.push(cx + xOf, y);
            }

            // 加热丝颜色（温度→红橙渐变）
            const hR = Math.round(180 + heatFrac * 60);
            const hG = Math.round(80  - heatFrac * 60);
            const hB = Math.round(30);
            const heaterAlpha = 0.60 + heatFrac * 0.35 + overFrac * 0.05;

            this._heaterGroup.add(new Konva.Line({
                points: segPts,
                stroke: `rgba(${hR},${hG},${hB},${heaterAlpha})`,
                strokeWidth: hw * 0.12,
                tension: 0.4, lineCap: 'round',
            }));

            // 发热辉光（过载时）
            if (heatFrac > 0.2) {
                const gAlpha = heatFrac * 0.28 + Math.sin(gPhase * 3 + i) * 0.04;
                this._heaterGroup.add(new Konva.Rect({
                    x: cx - hw * 0.55, y: y1,
                    width: hw * 1.10, height: y2 - y1,
                    fillLinearGradientStartPoint: { x: 0, y: 0 },
                    fillLinearGradientEndPoint:   { x: hw * 1.1, y: 0 },
                    fillLinearGradientColorStops: [
                        0, 'rgba(255,100,20,0)',
                        0.5, `rgba(255,${Math.round(120-heatFrac*80)},20,${gAlpha})`,
                        1, 'rgba(255,100,20,0)',
                    ],
                    cornerRadius: 2,
                }));
            }

            // 端子连线
            [[y1, h.y1], [y2, h.y2]].forEach(([py, ty]) => {
                this._heaterGroup.add(new Konva.Line({
                    points: [cx, ty, cx, py],
                    stroke: '#8090a0', strokeWidth: 2,
                    lineCap: 'round',
                }));
            });
        });
    }

    // ── 双金属片（动态）──────────────────────
    _rebuildBimetals() {
        this._bimetalGroup.destroyChildren();
        const H = this.height;

        this._heaters.forEach((h, i) => {
            const cx   = h.cx;
            const bm   = this._bimetals[i];
            const bend = this._bimetal[i]; // 0~1 弯曲量

            const y1   = bm.y;
            const y2   = bm.y + bm.h;
            const hw   = bm.w;

            // 弯曲偏移量（向右弯曲→触发脱扣杠杆）
            const maxBend = hw * 1.8;
            const bendOff = bend * maxBend;

            // 黄铜层（外层，膨胀系数大）
            const pts1 = [
                cx - hw * 0.1,           y1,
                cx + bendOff - hw * 0.1, y2,
            ];
            this._bimetalGroup.add(new Konva.Line({
                points: pts1,
                stroke: '#c8a040',
                strokeWidth: hw * 0.55,
                lineCap: 'round',
            }));

            // 殷瓦层（内层，膨胀系数小）
            const pts2 = [
                cx + hw * 0.1,           y1,
                cx + bendOff + hw * 0.1, y2,
            ];
            this._bimetalGroup.add(new Konva.Line({
                points: pts2,
                stroke: '#909aa8',
                strokeWidth: hw * 0.45,
                lineCap: 'round',
            }));

            // 弯曲量指示（细红虚线，三相最大弯曲量）
            if (i === 1) {  // 中相显示指示
                const maxY = bm.y + bm.h;
                const curX = cx + bendOff;
                this._bimetalGroup.add(new Konva.Line({
                    points: [curX - hw, maxY, curX + hw * 2, maxY],
                    stroke: `rgba(255,80,40,${bend * 0.60})`,
                    strokeWidth: 0.7, dash: [3, 2],
                }));
            }
        });
    }

    // ── 脱扣杠杆（动态）──────────────────────
    _rebuildLever() {
        this._leverGroup.destroyChildren();
        const W = this.width, H = this.height;
        const lev = this._lever;

        // 脱扣动画角度（0=正常，1=脱扣）
        const tripAngle = this._tripped ? 25 : this._tripAnim * 25;
        const angRad    = tripAngle * Math.PI / 180;

        // 杠杆主体（以转轴为中心旋转）
        const lvGroup = new Konva.Group({
            x: lev.pivotX, y: lev.pivotY,
            rotation: tripAngle,
        });

        // 杠杆臂
        lvGroup.add(new Konva.Rect({
            x: -lev.len * 0.45, y: -W * 0.02,
            width: lev.len * 0.90, height: W * 0.04,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint:   { x: lev.len * 0.90, y: 0 },
            fillLinearGradientColorStops: [
                0, '#606870', 0.3, '#9aa2a8', 0.7, '#8a9298', 1, '#505860',
            ],
            cornerRadius: 2,
            stroke: '#3a4048', strokeWidth: 0.8,
        }));

        // 转轴圆销
        lvGroup.add(new Konva.Circle({
            x: 0, y: 0, radius: W * 0.025,
            fillRadialGradientStartPoint:  { x: -W * 0.01, y: -W * 0.01 },
            fillRadialGradientEndPoint:    { x: 0, y: 0 },
            fillRadialGradientStartRadius: 0,
            fillRadialGradientEndRadius:   W * 0.025,
            fillRadialGradientColorStops:  [0, '#c0c8d0', 0.6, '#909aa0', 1, '#505860'],
            stroke: '#303840', strokeWidth: 0.8,
        }));

        // 左端推杆（与双金属片接触）
        lvGroup.add(new Konva.Rect({
            x: -lev.len * 0.45 - W * 0.02, y: -W * 0.015,
            width: W * 0.04, height: W * 0.03,
            fill: '#a08830', stroke: '#806820', strokeWidth: 0.6,
            cornerRadius: 1,
        }));

        // 右端（触点连杆）
        lvGroup.add(new Konva.Rect({
            x: lev.len * 0.40, y: -W * 0.035,
            width: W * 0.03, height: W * 0.07,
            fill: '#505870',
            stroke: '#303850', strokeWidth: 0.6, cornerRadius: 1,
        }));

        this._leverGroup.add(lvGroup);

        // 脱扣弹簧（压缩弹簧，脱扣时释放）
        const springX  = lev.pivotX + lev.len * 0.30;
        const springY0 = lev.pivotY - W * 0.03;
        const springY1 = lev.pivotY + W * 0.025 + tripAngle * 0.4;
        const springPts = [];
        const coils = 5;
        for (let j = 0; j <= coils * 6; j++) {
            const t  = j / (coils * 6);
            const y  = springY0 + t * (springY1 - springY0);
            const xo = Math.sin(t * coils * Math.PI * 2) * W * 0.018;
            springPts.push(springX + xo, y);
        }
        this._leverGroup.add(new Konva.Line({
            points: springPts,
            stroke: '#607080', strokeWidth: 1.4,
            tension: 0.3, lineCap: 'round',
        }));
    }

    // ── 触点（动态）──────────────────────────
    _rebuildContacts() {
        this._contactGroup.destroyChildren();
        const W = this.width, H = this.height;

        // ── NC 触点（95-96）──
        this._drawContact(
            this._contacts.nc,
            this._ncClosed,
            '95', '96', '#ffcc80', '常闭 NC'
        );

        // ── NO 触点（97-98）──
        this._drawContact(
            this._contacts.no,
            this._noClosed,
            '97', '98', '#80deea', '常开 NO'
        );
    }

    _drawContact(rect, closed, lbl1, lbl2, color, typeLbl) {
        const g   = this._contactGroup;
        const W   = this.width;
        const x   = rect.x, y = rect.y, w = rect.w, h = rect.h;

        // 底座
        g.add(new Konva.Rect({
            x, y, width: w, height: h * 2.4,
            fill: '#202428', stroke: '#303438', strokeWidth: 0.8, cornerRadius: 3,
        }));

        // 静触头（固定）
        const staticY = y + h * 0.5;
        [[x + w * 0.12, staticY], [x + w * 0.88, staticY]].forEach((pt, i) => {
            g.add(new Konva.Rect({
                x: pt[0] - W * 0.02, y: pt[1] - H * 0.006,
                width: W * 0.04, height: H * 0.012,
                fill: '#c0c8d0', stroke: '#909aa0', strokeWidth: 0.5,
                cornerRadius: 1,
            }));
        });

        // 动触桥（随状态移动）
        const bridgeY = closed
            ? staticY + H * 0.003
            : staticY + H * 0.026;

        const bridgeColor = closed ? '#d8e0e8' : '#606870';
        g.add(new Konva.Rect({
            x: x + w * 0.10, y: bridgeY - H * 0.007,
            width: w * 0.80, height: H * 0.014,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint:   { x: w * 0.80, y: 0 },
            fillLinearGradientColorStops: [
                0,   closed ? '#9aa0a8' : '#404850',
                0.3, closed ? '#d8e0e8' : '#606870',
                0.7, closed ? '#d0d8e0' : '#585e68',
                1,   closed ? '#909aa0' : '#3a4048',
            ],
            cornerRadius: 1,
            stroke: closed ? '#7a8288' : '#303840', strokeWidth: 0.5,
        }));

        // 接触点发光（闭合时）
        if (closed) {
            g.add(new Konva.Circle({
                x: x + w * 0.12, y: staticY, radius: W * 0.015,
                fill: `rgba(200,220,255,0.45)`,
                shadowColor: 'rgba(200,220,255,1)',
                shadowBlur: 4, shadowOpacity: 0.6,
            }));
            g.add(new Konva.Circle({
                x: x + w * 0.88, y: staticY, radius: W * 0.015,
                fill: `rgba(200,220,255,0.45)`,
                shadowColor: 'rgba(200,220,255,1)',
                shadowBlur: 4, shadowOpacity: 0.6,
            }));
        }

        // 电弧效果（切换瞬间）
        if (this._arcFlash > 0.1) {
            const af = this._arcFlash;
            g.add(new Konva.Line({
                points: [
                    x + w * 0.12, staticY,
                    x + w * 0.12 + (Math.random() - 0.5) * W * 0.04, staticY + H * 0.012,
                    x + w * 0.12, bridgeY,
                ],
                stroke: `rgba(255,220,80,${af * 0.9})`,
                strokeWidth: 1 + Math.random(),
                tension: 0.5,
            }));
        }

        // 弹簧（触点复位弹簧示意）
        const sprX  = x + w * 0.50;
        const sprY0 = y + h * 0.50;
        const sprY1 = bridgeY + H * 0.007;
        for (let i = 0; i <= 6; i++) {
            const t = i / 6;
            const cy2 = sprY0 + t * (sprY1 - sprY0);
            const xo = Math.sin(t * 3 * Math.PI) * W * 0.025;
            if (i < 6) {
                const t2 = (i + 1) / 6;
                const cy3 = sprY0 + t2 * (sprY1 - sprY0);
                const xo2 = Math.sin(t2 * 3 * Math.PI) * W * 0.025;
                g.add(new Konva.Line({
                    points: [sprX + xo, cy2, sprX + xo2, cy3],
                    stroke: '#505860', strokeWidth: 0.8,
                }));
            }
        }

        // 标注
        g.add(new Konva.Text({
            x: x, y: y + h * 2.0,
            width: w, text: `${typeLbl}  ${closed ? '●闭合' : '○断开'}`,
            fontSize: 6.5, fill: closed ? color : '#3a4a5a',
            align: 'center', fontFamily: 'Courier New', fontStyle: 'bold',
        }));
    }

    // ── 复位按钮（动态）──────────────────────
    _rebuildResetBtn() {
        this._resetGroup.destroyChildren();
        const rb = this._resetBtn, W = this.width;

        // 按钮底座环
        this._resetGroup.add(new Konva.Circle({
            x: rb.cx, y: rb.cy, radius: rb.r + 3,
            fill: '#282c34', stroke: '#1e2228', strokeWidth: 0.8,
        }));

        // 按钮主体（脱扣时凸出，正常时凹下）
        const pushed = !this._tripped;
        const btnY   = rb.cy + (pushed ? 0 : -rb.r * 0.15);

        this._resetGroup.add(new Konva.Circle({
            x: rb.cx, y: btnY, radius: rb.r,
            fillRadialGradientStartPoint:  { x: -rb.r * 0.3, y: -rb.r * 0.4 },
            fillRadialGradientEndPoint:    { x: 0, y: 0 },
            fillRadialGradientStartRadius: 0,
            fillRadialGradientEndRadius:   rb.r,
            fillRadialGradientColorStops: this._tripped
                ? [0, '#e84040', 0.5, '#c02828', 0.85, '#8a1818', 1, '#601010']
                : [0, '#a83030', 0.5, '#883020', 0.85, '#602818', 1, '#401810'],
            stroke: this._tripped ? '#601010' : '#401810',
            strokeWidth: 0.8,
            shadowColor: this._tripped ? 'rgba(255,60,40,0.6)' : 'transparent',
            shadowBlur:  this._tripped ? 8 : 0,
            shadowOpacity: 0.7,
        }));

        // 按钮高光
        this._resetGroup.add(new Konva.Ellipse({
            x: rb.cx - rb.r * 0.25, y: btnY - rb.r * 0.28,
            radiusX: rb.r * 0.30, radiusY: rb.r * 0.20,
            fill: `rgba(255,255,255,${this._tripped ? 0.25 : 0.10})`,
            rotation: -30,
        }));

        // 标注
        this._resetGroup.add(new Konva.Text({
            x: rb.cx - rb.r * 1.2, y: rb.cy + rb.r + 4,
            width: rb.r * 2.4,
            text: this._tripped ? '点击复位' : '正常运行',
            fontSize: 7, fill: this._tripped ? '#ff8080' : '#406050',
            align: 'center', fontFamily: 'Courier New',
        }));

        // RESET 文字
        this._resetGroup.add(new Konva.Text({
            x: rb.cx - rb.r * 0.9, y: btnY - 4,
            width: rb.r * 1.8, text: 'RESET',
            fontSize: 6, fill: `rgba(255,255,255,${this._tripped ? 0.55 : 0.20})`,
            align: 'center', fontFamily: 'Courier New', fontStyle: 'bold',
        }));

        // 交互区域
        const hitCircle = new Konva.Circle({
            x: rb.cx, y: rb.cy, radius: rb.r + 4,
            fill: 'transparent',
        });
        this._resetGroup.add(hitCircle);
        hitCircle.on('click tap', () => this.reset());
    }

    // ── 热量进度条（动态）────────────────────
    _rebuildThermBar() {
        this._barGroup.destroyChildren();
        const tb = this._thermBar, W = this.width;
        const lv = Math.max(0, Math.min(1, this._thermalLevel));

        // 背景槽
        this._barGroup.add(new Konva.Rect({
            x: tb.x, y: tb.y, width: tb.w, height: tb.h,
            fill: '#1a1e24', stroke: '#2a2e36', strokeWidth: 0.8,
            cornerRadius: tb.rx,
        }));

        // 热量条（颜色从绿→黄→红）
        const barW = lv * (tb.w - 2);
        const r    = Math.round(lv < 0.5 ? lv * 2 * 255 : 255);
        const g    = Math.round(lv < 0.5 ? 255 : (1 - lv) * 2 * 255);
        if (barW > 0) {
            this._barGroup.add(new Konva.Rect({
                x: tb.x + 1, y: tb.y + 1,
                width: barW, height: tb.h - 2,
                fillLinearGradientStartPoint: { x: 0, y: 0 },
                fillLinearGradientEndPoint:   { x: barW, y: 0 },
                fillLinearGradientColorStops: [
                    0,   `rgba(40,200,80,0.90)`,
                    0.55,`rgba(${r},${g},20,0.90)`,
                    1,   `rgba(${r},${g},20,0.95)`,
                ],
                cornerRadius: tb.rx,
                shadowColor: `rgba(${r},${g},20,0.60)`,
                shadowBlur: lv > 0.7 ? 4 : 0, shadowOpacity: 0.8,
            }));
        }

        // 临界线（设定电流对应的热量临界）
        const critX = tb.x + 1 + (tb.w - 2) * 0.98;
        this._barGroup.add(new Konva.Line({
            points: [critX, tb.y - 2, critX, tb.y + tb.h + 2],
            stroke: 'rgba(255,80,40,0.55)', strokeWidth: 1,
            dash: [2, 2],
        }));

        // 百分比文字
        this._barGroup.add(new Konva.Text({
            x: tb.x, y: tb.y - 12,
            width: tb.w * 0.5,
            text: `热量: ${(lv * 100).toFixed(0)}%`,
            fontSize: 7, fill: lv > 0.75 ? '#ff8060' : '#60a080',
            fontFamily: 'Courier New',
        }));
        this._barGroup.add(new Konva.Text({
            x: tb.x + tb.w * 0.5, y: tb.y - 12,
            width: tb.w * 0.5,
            text: `I=${this._loadCurrent.toFixed(1)}A / In=${this._settingCurrent.toFixed(1)}A`,
            fontSize: 7, fill: '#508090',
            fontFamily: 'Courier New', align: 'right',
        }));
    }

    // ── 整定旋钮指针（动态）──────────────────
    _rebuildKnobPointer() {
        // 若有旧指针先移除
        if (this._knobPointer) { this._knobPointer.destroy(); }
        const k   = this._knob;
        const ang = (-150 + this._settingKnob * 300) * Math.PI / 180;

        // 旋钮主体
        const g = new Konva.Group();
        g.add(new Konva.Circle({
            x: k.cx, y: k.cy, radius: k.r,
            fillRadialGradientStartPoint:  { x: -k.r * 0.3, y: -k.r * 0.3 },
            fillRadialGradientEndPoint:    { x: 0, y: 0 },
            fillRadialGradientStartRadius: 0,
            fillRadialGradientEndRadius:   k.r,
            fillRadialGradientColorStops:  [0,'#484c58',0.6,'#303440',1,'#20242e'],
            stroke: '#1e2228', strokeWidth: 0.8,
        }));
        // 指针线
        g.add(new Konva.Line({
            points: [
                k.cx + Math.cos(ang) * k.r * 0.20,
                k.cy + Math.sin(ang) * k.r * 0.20,
                k.cx + Math.cos(ang) * k.r * 0.82,
                k.cy + Math.sin(ang) * k.r * 0.82,
            ],
            stroke: '#d0e040', strokeWidth: 1.8, lineCap: 'round',
        }));
        // 中心轴
        g.add(new Konva.Circle({
            x: k.cx, y: k.cy, radius: k.r * 0.15,
            fill: '#909aa0', stroke: '#607080', strokeWidth: 0.6,
        }));

        this.group.add(g);
        this._knobPointer = g;
    }

    // ── 整体发光效果（过电流时）──────────────
    _rebuildGlow() {
        this._glowGroup.destroyChildren();
        const overFrac = Math.max(0, Math.min(1,
            this._loadCurrent / this._settingCurrent - 1));
        if (overFrac < 0.05) return;

        const b  = this._body;
        const ga = overFrac * 0.20;
        this._glowGroup.add(new Konva.Rect({
            x: b.x, y: b.y, width: b.w, height: b.h * 0.48,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint:   { x: 0, y: b.h * 0.48 },
            fillLinearGradientColorStops: [
                0, `rgba(255,${Math.round(100-overFrac*80)},20,${ga * 0.8})`,
                1, 'rgba(255,80,20,0)',
            ],
            cornerRadius: this._body.rx,
        }));
    }

    // ── 标注 ─────────────────────────────────
    _drawLabel() {
        const W = this.width;
        this.group.add(new Konva.Text({
            x: 0, y: -20, width: W,
            text: `${this.label}  热继电器`,
            fontSize: 9, fontStyle: 'bold', fill: '#546e7a',
            align: 'center', fontFamily: 'Arial, sans-serif',
        }));
        this.group.add(new Konva.Text({
            x: 0, y: -9, width: W,
            text: `JR36  In=${this.ratedCurrent}A  τ=${this.thermalConst}s  [${this.resetMode}]`,
            fontSize: 7, fill: '#3a5a7a',
            align: 'center', fontFamily: 'Courier New',
        }));
    }

    // ── 状态面板 ─────────────────────────────
    _drawStatusPanel() {
        const W   = this.width, H = this.height;
        const b   = this._body;
        const panY = b.y + b.h + H * 0.05 + 28;

        this._statusGroup = new Konva.Group({ x: 0, y: panY });
        this.group.add(this._statusGroup);

        this._statusGroup.add(new Konva.Rect({
            x: 4, y: 0, width: W - 8, height: 52,
            fill: '#080e0c', stroke: '#102018',
            strokeWidth: 0.8, cornerRadius: 4,
        }));

        this._statusDot = new Konva.Circle({
            x: 12, y: 11, radius: 3.5,
            fill: '#30e060', stroke: '#18a038', strokeWidth: 0.8,
            shadowColor: '#30e060', shadowBlur: 5, shadowOpacity: 0.8,
        });
        this._statusGroup.add(this._statusDot);

        this._statLines = [];
        ['状态: 正常', '触点: NC闭/NO开', '过载: -- ×In'].forEach((t, i) => {
            const n = new Konva.Text({
                x: 22, y: 4 + i * 15,
                width: W - 28, text: t,
                fontSize: 7.5, fill: '#2a5a3a',
                fontFamily: 'Courier New',
            });
            this._statusGroup.add(n);
            this._statLines.push(n);
        });
    }

    _updateStatusPanel() {
        if (!this._statLines) return;
        const tripped = this._tripped;
        const col     = tripped ? '#ef5350' : '#30e060';
        const ratio   = this._loadCurrent / this._settingCurrent;

        this._statLines[0].text(
            tripped ? '⚠ 过载脱扣！'
            : this._thermalLevel > 0.80 ? '⚠ 热量警告'
            : '状态: 正常运行'
        );
        this._statLines[0].fill(tripped ? '#ff6040' : this._thermalLevel > 0.80 ? '#ffaa30' : '#30e060');
        this._statLines[1].text(`触点: NC${this._ncClosed?'●闭':'○开'} / NO${this._noClosed?'●闭':'○开'}`);
        this._statLines[2].text(`过载: ${ratio.toFixed(2)}×In  热: ${(this._thermalLevel*100).toFixed(0)}%`);
        this._statLines[2].fill(ratio > 1.5 ? '#ff8060' : ratio > 1.2 ? '#ffaa30' : '#50a080');

        this._statusDot.fill(col);
        this._statusDot.stroke(tripped ? '#a02020' : '#18a038');
        this._statusDot.shadowColor(col);
        this._statusDot.shadowBlur(tripped ? 8 : 5);
    }

    // ══════════════════════════════════════════
    // ── 物理模型 ─────────────────────────────

    /**
     * 热量积累模型（一阶积分 + 反时限特性）
     * dΘ/dt = (I²/In² - 1) / τ    （加热项，过载时 >0）
     * dΘ/dt = -Θ / τ_cool          （冷却项）
     */
    _updateThermal(dt) {
        if (this._tripped) {
            // 脱扣后冷却
            this._cooldown += dt;
            const coolTau  = this.thermalConst * 2;  // 冷却更慢
            this._thermalLevel *= Math.exp(-dt / coolTau);
            // 三相双金属片逐渐回弹
            this._bimetal = this._bimetal.map(b => b * Math.exp(-dt / (coolTau * 0.5)));

            // 自动复位条件
            if (this.resetMode === 'auto' && this._thermalLevel < 0.15 && this._cooldown > 30) {
                this.reset();
            }
            return;
        }

        const I  = this._loadCurrent;
        const In = this._settingCurrent;
        const overRatio = (I / In);

        // 加热率（过载时正，欠载时负即冷却）
        const heatRate = (overRatio * overRatio - 1) / this.thermalConst;
        this._thermalLevel = Math.max(0, Math.min(1.05,
            this._thermalLevel + heatRate * dt));

        // 三相双金属片弯曲（均匀加热）
        this._bimetal = this._bimetal.map(() =>
            Math.max(0, Math.min(1, this._thermalLevel)));

        // 脱扣判断
        if (this._thermalLevel >= 1.0 && !this._tripped) {
            this._triggerTrip();
        }
    }

    _triggerTrip() {
        this._tripped  = true;
        this._ncClosed = false;   // NC 断开
        this._noClosed = true;    // NO 闭合
        this._arcFlash = 1.0;     // 电弧闪光
        this._cooldown = 0;

        // 触发脱扣动画
        this._tripAnim = 0;
        this._tripAnimDir = 1;
    }

    // ══════════════════════════════════════════
    // 集中化 tick（由 consys._tickAll 在 20fps 调用）
    tick(dt) {
        this._tickAnimation(dt, ts);
    }
    _tickAnimation(dt, ts) {
        // 热物理模型
        this._updateThermal(dt);

        // 脱扣动画
        if (this._tripAnimDir === 1) {
            this._tripAnim = Math.min(1, this._tripAnim + dt / 0.08);
        } else if (this._tripAnimDir === -1) {
            this._tripAnim = Math.max(0, this._tripAnim - dt / 0.12);
            if (this._tripAnim === 0) this._tripAnimDir = 0;
        }

        // 电弧衰减
        this._arcFlash = Math.max(0, this._arcFlash - dt * 8);

        // 动画相位
        this._glowPhase += dt * 2.0;

        this._rebuildAll();
        this._refreshCache();
    }

    _bindInteraction() {
        // 复位按钮在 _rebuildResetBtn 中绑定
    }

    // ══════════════════════════════════════════
    // ── 公开 API ─────────────────────────────

    /** 设置负载电流（A） */
    setCurrent(I) {
        this._loadCurrent = Math.max(0, I);
    }

    /** 设置整定电流（旋钮位置 0~1 对应 -20%~+20% In） */
    setSettingKnob(pos) {
        this._settingKnob     = Math.max(0, Math.min(1, pos));
        this._settingCurrent  = this.ratedCurrent * (0.80 + this._settingKnob * 0.40);
    }

    /** 手动复位（按下复位按钮） */
    reset() {
        if (!this._tripped) return;
        if (this._thermalLevel > 0.30 && this.resetMode === 'manual') return; // 未充分冷却
        this._tripped      = false;
        this._ncClosed     = true;
        this._noClosed     = false;
        this._tripAnimDir  = -1;
        this._arcFlash     = 0.3;
        this._cooldown     = 0;
    }

    /** 强制手动脱扣（测试用） */
    trip() {
        if (!this._tripped) this._triggerTrip();
    }

    /** 查询 NC 触点状态 */
    isNCClosed() { return this._ncClosed; }

    /** 查询 NO 触点状态 */
    isNOClosed() { return this._noClosed; }

    /** 查询是否脱扣 */
    isTripped()  { return this._tripped; }

    /** 读取热量积累（0~1） */
    getThermalLevel() { return this._thermalLevel; }

    update(state) {
        if (typeof state === 'number') {
            this.setCurrent(state);
        } else if (state && typeof state === 'object') {
            if (state.current !== undefined) this.setCurrent(state.current);
            if (state.setting !== undefined) this.setSettingKnob(state.setting);
            if (state.reset   === true)      this.reset();
            if (state.trip    === true)      this.trip();
        }
        this._refreshCache();
    }

    getConfigFields() {
        return [
            { label: '位号/名称',           key: 'label',        type: 'text'   },
            { label: '额定电流 In (A)',      key: 'ratedCurrent', type: 'number' },
            { label: '热时间常数 τ (s)',      key: 'thermalConst', type: 'number' },
            { label: '初始负载电流 (A)',      key: 'initCurrent',  type: 'number' },
            { label: '整定位置 (0~1)',        key: 'settingPos',   type: 'number' },
            { label: '复位方式(manual/auto)', key: 'resetMode',    type: 'text'   },
            { label: '相数 (1/3)',            key: 'phases',       type: 'number' },
        ];
    }

    onConfigUpdate(cfg) {
        if (cfg.label        !== undefined) this.label        = cfg.label;
        if (cfg.ratedCurrent !== undefined) {
            this.ratedCurrent = parseFloat(cfg.ratedCurrent);
            this._settingCurrent = this.ratedCurrent * (0.80 + this._settingKnob * 0.40);
        }
        if (cfg.thermalConst !== undefined) this.thermalConst = parseFloat(cfg.thermalConst);
        if (cfg.initCurrent  !== undefined) this.setCurrent(parseFloat(cfg.initCurrent));
        if (cfg.settingPos   !== undefined) this.setSettingKnob(parseFloat(cfg.settingPos));
        if (cfg.resetMode    !== undefined) this.resetMode    = cfg.resetMode;
        if (cfg.phases       !== undefined) this.phases       = parseInt(cfg.phases);
        this.config = { ...this.config, ...cfg };
        this._refreshCache();
    }

    destroy() {
        super.destroy?.();
    }
}