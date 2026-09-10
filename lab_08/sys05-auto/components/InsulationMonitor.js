import { BaseComponent } from './BaseComponent.js';

/**
 * 绝缘监视仪组件（船舶低压电网集中绝缘监测）
 *
 * ═══ 功能 ════════════════════════════════════════════════════════
 *  集中式绝缘监视仪面板（紧凑单块）：
 *    - 左侧：圆形模拟表盘，反向对数刻度（右端 0Ω、左端 ∞），
 *            指针指示三相总绝缘的最小值（三相中绝缘最差的一相）
 *    - 右侧：单行液晶屏，实时显示指针所指阻值（MIN 三相最小值）
 *    - 表盘下方：蜂鸣器（左）与红色报警灯（右）左右对称、等大
 *    - 底部：消音 / 消闪 / 复位 三个操作按钮 + 状态文字
 *
 * ═══ 报警逻辑（锁存型）═══════════════════════════════════════════
 *   当三相最小绝缘 < 报警阈值（默认 0.1 MΩ，可配置）并持续超过
 *   防抖时间（0.3s）后触发报警并锁存：
 *    - 蜂鸣器发声（AudioContext 短鸣）+ 红灯快闪（5Hz，亮灭各 0.1s）
 *    - 消音：仅停止蜂鸣，红灯继续闪烁
 *    - 故障消失后（未消音/未消闪）：蜂鸣器自动停止，
 *      红灯由快闪转慢闪（≈1.3Hz，记忆指示"已恢复待确认"）
 *    - 消闪：无论快闪还是慢闪，消闪后红灯转为常亮（确认，锁定待人工复位）；
 *      不随故障是否消失而熄灭
 *    - 复位：仅在故障消失（min ≥ 阈值）后按下才解除锁存、熄灭报警灯；
 *      绝缘仍未恢复时按下无效
 *   三个按钮仅在报警锁存（_latched）状态下响应，平时按下无效，
 *   避免误消音/误消闪污染后续真实报警。
 *
 * ═══ 电气接线 ════════════════════════════════════════════════════
 *  与绝缘指示灯相同的纯读数模式（不参与 MNA stamp）：
 *    - 顶部 3 个相端口 l1/l2/l3 并联接母线三相（高阻读取，基本不改
 *      变母线电压；端口中心位于组件顶边 y=0）
 *    - 底部 1 个地端口 gnd 接船体地（端口中心位于组件底边 y=height）
 *  接线由工程 _autoWire 完成：三相接 bus1 的 l1_4/l2_4/l3_4 tap，
 *  地接 gnd_l_wire_gnd（与绝缘指示灯同一根地线）。
 *
 * ═══ 数据来源 ════════════════════════════════════════════════════
 *  阻值读数通过 sys.comps[insulSourceId]（默认 'insul'）读取
 *  getInsulResistance(i)（Ω，三相，已含开关闭合负载并联等效）。
 *  表盘与液晶显示取三相最小值；报警逻辑基于该最小值。
 *
 * ═══ 渲染优化 ════════════════════════════════════════════════════
 *  静态部件（面板、表盘刻度、液晶框、蜂鸣器/灯底座、按钮）init 时绘制；
 *  动态元素（指针、液晶数值、报警灯、蜂鸣波圈、状态文字）
 *  tick 中 in-place 更新；不使用 shadow。
 */
export class InsulationMonitor extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.width  = Math.max(300, config.width  || 360);
        this.height = Math.max(200, config.height || 230);

        this.type  = 'insulmon';
        this.cache = 'fixed';

        this._initGroups();
        this._recalcGeometry();
        this._initParameters(config);
        this._init();

        this.config = {
            id:            this.id,
            label:         this.label,
            alarmThreshold: this._threshold / 1e6,   // MΩ
            insulSourceId: this._insulSourceId,
        };

        // —— 电气端口（同绝缘指示灯：纯读数高阻，基本不改变母线电压）——
        // 顶部 3 个相端口（接母线，端口中心位于组件顶边）
        for (let i = 0; i < 3; i++) {
            this.addPort(this._portX[i], 0, `l${i + 1}`, 'wire', 'p');
        }
        // 底部 1 个地端口（接船体地，端口中心位于组件底边）
        this.addPort(this._cx, this.height, 'gnd', 'wire', 'p');
    }

    // ═══════════════════════════════════
    // 几何
    // ═══════════════════════════════════
    _recalcGeometry() {
        const W = this.width, H = this.height;

        this._frame = { x: 2, y: 2, w: W - 4, h: H - 4, rx: 8 };

        // 顶部三相端口 x（与汇流排相接，端口中心落在顶边）与底部地端口 x
        this._portX = [W * 0.20, W * 0.50, W * 0.80];
        this._cx    = W / 2;

        // ── 模拟表盘（左上大表盘，半径按纵向最大）──
        const fCx = W * 0.36;                       // 表盘圆心：偏左
        // 圆心尽量上移兼顾上限：
        //   上限① 报警区标注不压按钮：fCy ≤ H-83
        //   上限② 顶弧不低于标题：fR = fCy-26（顶弧 y≈19）
        const fCy = Math.min(H * 0.57, H - 83);     // 比原来 .62 上移
        const fR  = fCy - 26;
        this._face = { cx: fCx, cy: fCy, r: fR };

        // 指针角度（Konva：0°=右，顺时针正）；反向刻度：右 0Ω、左 ∞
        this._angleZero  = 355;
        this._angleInf   = 185;
        this._angleSweep = 170;

        // ── 液晶屏（右侧，拉宽；下移使中心与表盘中心对齐）──
        const lcdH = H * 0.16;
        this._lcd = {
            x: W * 0.70,
            y: 0.25 * H,
            w: W * 0.24,
            h: lcdH,
        };

        // ── 报警区：报警灯紧贴表圈（半圆底边）下沿，蜂鸣器与其左右对称、等大 ──
        this._alarmY = fCy + 24;
        this._lamR   = Math.max(6, Math.min(W * 0.03, 11));   // 报警灯半径（减半）
        // 蜂鸣器（左）与报警灯（右）以表盘圆心为轴左右对称、等大
        this._buzzCx = fCx - W * 0.17;
        this._lamCx  = fCx + W * 0.17;

        // ── 底部三按钮 ─────────────────────────
        const btnW = Math.floor((W - 60) / 3);
        const btnH = 30;
        const btnY = H - btnH - 16;
        this._btns = {
            mute:  { x: 20,         y: btnY, w: btnW, h: btnH, key: 'mute' },
            flash: { x: 20 + btnW + 10, y: btnY, w: btnW, h: btnH, key: 'flash' },
            reset: { x: 20 + (btnW + 10) * 2, y: btnY, w: btnW, h: btnH, key: 'reset' },
        };

        // 状态文字（右侧窄条 LCD 正下方）
        this._statusRect = {
            x: this._lcd.x, y: this._lcd.y + this._lcd.h + 18, w: this._lcd.w,
        };
    }

    _initParameters(config) {
        this.label = config.label || '绝缘监视仪';

        this._insulSourceId = config.insulSourceId || 'insul';

        // 报警阈值（MΩ → Ω），默认 0.1 MΩ
        const th = config.alarmThreshold !== undefined ? parseFloat(config.alarmThreshold) : 0.1;
        this._threshold = Math.max(1e-6, th) * 1e6;

        // 防抖时间（s），避免瞬时抖动误报
        this._alarmDelay = 0.3;

        // 状态机
        this._latched   = false;   // 报警锁存
        this._muted     = false;   // 消音（停蜂鸣，灯继续）
        this._flashOff  = false;   // 消闪（灯转常亮）
        this._badTime   = 0;       // 连续低于阈值时长
        this._flashT    = 0;       // 频闪计时
        this._beepT     = 0;       // 蜂鸣计时

        // 运行数据
        this._R = [1e9, 1e9, 1e9];
        this._minR = 1e9;
        this._needleAngle = this._angleInf;

        this._audioCtx = null;
    }

    // ═══════════════════════════════════
    // 主初始化
    // ═══════════════════════════════════
    _init() {
        this._drawStaticParts();
        this._createDynamicNodes();
        this._bindInteraction();
    }

    // ═══════════════════════════════════
    // 静态部件
    // ═══════════════════════════════════
    _drawStaticParts() {
        this._drawFrame();
        this._drawFaceStatic();
        this._drawLcdFrame();
        this._drawAlarmArea();
        this._drawButtons();
    }

    _drawFrame() {
        const f = this._frame;
        // 深灰金属面板
        this._staticGroup.add(new Konva.Rect({
            x: f.x, y: f.y, width: f.w, height: f.h,
            fill: '#3a4150', stroke: '#242a36', strokeWidth: 2, cornerRadius: f.rx,
        }));
        // 顶部高光
        this._staticGroup.add(new Konva.Rect({
            x: f.x + 2, y: f.y + 2, width: f.w - 4, height: 6,
            fill: 'rgba(255,255,255,0.08)', cornerRadius: [f.rx, f.rx, 0, 0],
        }));
        // 标题（左上角左对齐，避开表盘顶弧）
        this._staticGroup.add(new Konva.Text({
            x: 10, y: 5, width: this.width - 20,
            text: `⚡ ${this.label}`,
            fontSize: 12, fontFamily: 'Arial', fontStyle: 'bold',
            fill: '#e8ecf2', align: 'left',
        }));
    }

    // ─────────────────────────────────
    // 模拟表盘
    // ─────────────────────────────────
    /** 绝缘电阻（Ω）→ 指针角度（反向对数刻度，右 0Ω → 左 ∞） */
    _rToAngle(rOhm) {
        const r = rOhm / 1e6;   // → MΩ
        if (!isFinite(r) || r >= 1000) return this._angleInf;
        if (r <= 0) return this._angleZero;
        const s = 2.4;
        const scale = 1 + 1000 * s;
        const frac = Math.log10(1 + s * r) / Math.log10(scale);
        const clampedFrac = Math.max(0, Math.min(1, frac));
        return this._angleZero - clampedFrac * this._angleSweep;
    }

    _drawFaceStatic() {
        const { cx, cy, r } = this._face;
        const f = this._frame;

        // 表盘基板
        this._staticGroup.add(new Konva.Rect({
            x: f.x + 2, y: f.y + 2, width: f.w - 4, height: f.h - 4,
            fill: '#2c3240', cornerRadius: f.rx - 1,
        }));

        // 金属外环（上半圆）
        this._staticGroup.add(new Konva.Shape({
            x: cx, y: cy,
            fillLinearGradientStartPoint: { x: -(r + 7), y: -(r + 7) },
            fillLinearGradientEndPoint:   { x:  (r + 7), y:  (r + 7) },
            fillLinearGradientColorStops: [0, '#707870', 0.5, '#d0d8d0', 1, '#606860'],
            sceneFunc: (ctx, shape) => {
                ctx.beginPath();
                ctx.arc(0, 0, r + 7, Math.PI, Math.PI * 2, false);
                ctx.arc(0, 0, r,     Math.PI * 2, Math.PI, true);
                ctx.closePath();
                ctx.fillStrokeShape(shape);
            },
            listening: false,
        }));

        // 表盘面（奶白半圆）
        this._staticGroup.add(new Konva.Shape({
            x: cx, y: cy,
            fill: '#f4f0e4', stroke: '#c8c4b0', strokeWidth: 1,
            sceneFunc: (ctx, shape) => {
                ctx.beginPath();
                ctx.arc(0, 0, r, Math.PI, Math.PI * 2, false);
                ctx.closePath();
                ctx.fillStrokeShape(shape);
            },
            listening: false,
        }));

        // ── 刻度 ──
        const majorVals = [0, 1, 2, 5, 10, 20, 50, 100, 200, 500, Infinity];
        const majorLabels = ['0', '1', '2', '5', '10', '20', '50', '100', '200', '500', '∞'];
        const outerR = r * 0.94;
        const fs = Math.max(6, r * 0.11);

        majorVals.forEach((v, i) => {
            const angDeg = this._rToAngle(v * 1e6);
            const angRad = angDeg * Math.PI / 180;
            const innerR = r * 0.76;
            this._staticGroup.add(new Konva.Line({
                points: [
                    cx + outerR * Math.cos(angRad), cy + outerR * Math.sin(angRad),
                    cx + innerR * Math.cos(angRad), cy + innerR * Math.sin(angRad),
                ],
                stroke: '#202020', strokeWidth: 1.4, lineCap: 'round',
            }));
            const labelR = r * 0.72;
            this._staticGroup.add(new Konva.Text({
                x: cx + labelR * Math.cos(angRad) - fs * 1.1,
                y: cy + labelR * Math.sin(angRad) - fs * 0.3,
                text: majorLabels[i],
                fontSize: fs, fontFamily: 'Arial',
                fill: '#1a1a1a', align: 'center', width: fs * 2.2,
            }));
        });

        // 辅助刻度
        const minorVals = [0.5, 3, 4, 7, 8, 9, 15, 30, 40, 70, 80, 90, 150, 300, 400, 700, 800];
        minorVals.forEach(v => {
            const angDeg = this._rToAngle(v * 1e6);
            const angRad = angDeg * Math.PI / 180;
            this._staticGroup.add(new Konva.Line({
                points: [
                    cx + outerR * Math.cos(angRad), cy + outerR * Math.sin(angRad),
                    cx + r * 0.84 * Math.cos(angRad), cy + r * 0.84 * Math.sin(angRad),
                ],
                stroke: '#606060', strokeWidth: 0.8, lineCap: 'round',
            }));
        });

        // 量程单位
        this._staticGroup.add(new Konva.Text({
            x: cx - r * 0.75, y: cy - r * 0.30,
            text: 'MΩ',
            fontSize: Math.max(8, r * 0.16), fontFamily: 'Arial', fontStyle: 'bold',
            fill: '#cc2010', width: r * 1.5, align: 'center',
        }));

        // 中心轴底座
        this._staticGroup.add(new Konva.Circle({
            x: cx, y: cy, radius: r * 0.055,
            fill: '#b0a880', stroke: '#807860', strokeWidth: 1,
        }));
    }

    // ─────────────────────────────────
    // 液晶屏（单行）
    // ─────────────────────────────────
    _drawLcdFrame() {
        const { x, y, w, h } = this._lcd;

        // 液晶外框
        this._staticGroup.add(new Konva.Rect({
            x: x - 8, y: y - 6, width: w + 16, height: h + 12,
            fill: '#232833', stroke: '#4a5265', strokeWidth: 1.5, cornerRadius: 4,
        }));
        // 液晶屏底
        this._staticGroup.add(new Konva.Rect({
            x: x, y: y, width: w, height: h,
            fill: '#0a1608', stroke: '#1e4a1a', strokeWidth: 1, cornerRadius: 2,
        }));
    }

    // ─────────────────────────────────
    // 报警区（蜂鸣器 + 红灯，左右对称等大）
    // ─────────────────────────────────
    _drawAlarmArea() {
        const ay = this._alarmY;

        // ── 蜂鸣器（扬声器造型，与报警灯等大）──
        const bx = this._buzzCx;
        const br = this._lamR;
        // 壳体
        this._staticGroup.add(new Konva.Circle({
            x: bx, y: ay, radius: br + 5,
            fill: '#2a303c', stroke: '#4cd40d', strokeWidth: 1.5,
        }));
        // 音膜
        this._staticGroup.add(new Konva.Circle({
            x: bx, y: ay, radius: br,
            fill: '#14181f', stroke: '#503f3a', strokeWidth: 1,
        }));
        // 弧线（模拟扬声器波纹，小尺寸只画两条）
        [0.45, 0.8].forEach(k => {
            this._staticGroup.add(new Konva.Circle({
                x: bx, y: ay, radius: br * k,
                stroke: '#586278', strokeWidth: 1, fill: null,
            }));
        });
        // 标注
        this._staticGroup.add(new Konva.Text({
            x: bx - 24, y: ay + br + 6,
            text: '蜂鸣器', fontSize: 12, fontFamily: 'Arial',
            fill: '#f6f7f8', width: 48, align: 'center',
        }));

        // ── 红色报警灯（与蜂鸣器等大）──
        const lx = this._lamCx;
        const lr = this._lamR;
        this._staticGroup.add(new Konva.Circle({
            x: lx, y: ay, radius: lr + 5,
            fill: '#2a303c', stroke: '#f74702', strokeWidth: 1.5,
        }));
        this._staticGroup.add(new Konva.Circle({
            x: lx, y: ay, radius: lr,
            fill: '#3a2020', stroke: '#552525', strokeWidth: 1,
        }));
        this._staticGroup.add(new Konva.Text({
            x: lx - 24, y: ay + lr + 6,
            text: '报警灯', fontSize: 12, fontFamily: 'Arial',
            fill: '#f6f7f8', width: 48, align: 'center',
        }));
    }

    // ─────────────────────────────────
    // 底部三按钮
    // ─────────────────────────────────
    _drawButtons() {
        const defs = [
            { key: 'mute',  label: '消音', color: '#3a6ea5' },
            { key: 'flash', label: '消闪', color: '#8a7a2a' },
            { key: 'reset', label: '复位', color: '#8a3a3a' },
        ];
        defs.forEach(d => {
            const b = this._btns[d.key];
            this._staticGroup.add(new Konva.Rect({
                x: b.x, y: b.y, width: b.w, height: b.h,
                fill: d.color, stroke: '#141a22', strokeWidth: 1.5, cornerRadius: 5,
            }));
            this._staticGroup.add(new Konva.Text({
                x: b.x, y: b.y + b.h * 0.22,
                text: d.label, fontSize: 14, fontFamily: 'Arial', fontStyle: 'bold',
                fill: '#f0f4fa', width: b.w, align: 'center',
            }));
        });
    }

    // ═══════════════════════════════════
    // 动态节点
    // ═══════════════════════════════════
    _createDynamicNodes() {
        this._createNeedle();
        this._createLcdValue();
        this._createAlarmLamp();
        this._createBeepRing();
        this._createStatusText();
    }

    /** 红指针（表盘） */
    _createNeedle() {
        const { cx, cy, r } = this._face;
        const needleLen = r * 0.80;
        const tailLen   = r * 0.12;

        this._needleGroup = new Konva.Group({ x: cx, y: cy, rotation: this._needleAngle });
        this._needleGroup.add(new Konva.Line({
            points: [-tailLen, 0, needleLen * 0.88, 0],
            stroke: '#dd1808', strokeWidth: 2.2, lineCap: 'round',
        }));
        this._needleGroup.add(new Konva.Line({
            points: [needleLen * 0.68, -1.8, needleLen * 0.88, 0, needleLen * 0.68, 1.8],
            closed: true, fill: '#dd1808', stroke: '#dd1808', strokeWidth: 0.5,
        }));
        this._dynamicGroup.add(this._needleGroup);
    }

    /** 液晶屏数值（单行：指针所指阻值 MIN） */
    _createLcdValue() {
        const { x, y, w, h } = this._lcd;
        // 标签占左 26px，数值占剩余空间右对齐垂直居中
        this._lcdValue = new Konva.Text({
            x: x + 30, y: y + (h - 20) / 2,
            text: '∞',
            fontSize: 16, fontFamily: 'Courier New', fontStyle: 'bold',
            fill: '#3aff5a', width: w - 36, align: 'right',
        });
        this._dynamicGroup.add(this._lcdValue);
    }

    /** 红色报警灯（动态点亮，紧贴表盘下） */
    _createAlarmLamp() {
        const lx = this._lamCx, lr = this._lamR;
        this._lampLight = new Konva.Circle({
            x: lx, y: this._alarmY, radius: lr - 3,
            fill: '#ff3020', opacity: 0,
            listening: false,
        });
        // 外层光晕（随频闪同步）
        this._lampGlow = new Konva.Circle({
            x: lx, y: this._alarmY, radius: lr + 10,
            fill: 'rgba(255,60,20,0.18)', opacity: 0,
            listening: false,
        });
        this._dynamicGroup.add(this._lampGlow, this._lampLight);
    }

    /** 蜂鸣声波圈（报警时脉动） */
    _createBeepRing() {
        this._beepRing = new Konva.Circle({
            x: this._buzzCx, y: this._alarmY,
            radius: 2, stroke: '#7ae0ff', strokeWidth: 1.5,
            opacity: 0, listening: false,
        });
        this._dynamicGroup.add(this._beepRing);
    }

    /** 状态文字（按钮上方，报警时变红） */
    _createStatusText() {
        const s = this._statusRect;
        this._statusText = new Konva.Text({
            x: s.x, y: s.y,
            text: '正常',
            fontSize: 14, fontFamily: 'Arial', fontStyle: 'bold',
            fill: '#07f326',
            width: s.w, align: 'center',
        });
        this._dynamicGroup.add(this._statusText);
    }

    // ═══════════════════════════════════
    // 交互绑定
    // ═══════════════════════════════════
    /**
     * 按钮交互采用"复用 addClickablePart 热区"模式（参考 ReversePowerRelay）：
     * addClickablePart 创建的透明 hit 层已在 _interactGroup 中且可命中，
     * 自定义再叠一层矩形会因 Konva 命中检测只取最上层而拦截掉按钮事件，
     * 因此直接取用 addClickablePart 的最末热区绑定按钮动作。
     */
    _bindInteraction() {
        ['mute', 'flash', 'reset'].forEach(key => {
            const b = this._btns[key];
            this.addClickablePart(`btn-${key}`, b.x, b.y, b.w, b.h);
            const children = this._interactGroup.getChildren();
            const group = children[children.length - 1];
            const hit = group.getChildren()[1];   // [0]=底色, [1]=命中层
            hit.on('click tap', () => this._pressButton(key));
        });
    }

    /** 按钮按下处理器（仅在报警锁存时响应，防误消音污染） */
    _pressButton(key) {
        if (!this._latched) return;   // 未报警时所有按键无效
        if (key === 'mute') {
            this._muted = true;
        } else if (key === 'flash') {
            this._flashOff = true;
        } else if (key === 'reset') {
            // 仅当绝缘已恢复正常（min ≥ 阈值）才解除锁存
            if (this._minR >= this._threshold && this._minR < 1e12) {
                this._latched  = false;
                this._muted    = false;
                this._flashOff = false;
                this._badTime  = 0;
            }
        }
        this.markDirty();
        this._refreshIfDirty();
    }

    // ═══════════════════════════════════
    // 蜂鸣（AudioContext 短鸣）
    // ═══════════════════════════════════
    _beep() {
        try {
            if (!this._audioCtx)
                this._audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            if (this._audioCtx.state === 'suspended') {
                const p = this._audioCtx.resume();
                if (p && typeof p.catch === 'function') p.catch(() => {});
            }
            const osc = this._audioCtx.createOscillator();
            const gain = this._audioCtx.createGain();
            osc.frequency.setValueAtTime(1000, this._audioCtx.currentTime);
            gain.gain.setValueAtTime(0.05, this._audioCtx.currentTime);
            osc.connect(gain);
            gain.connect(this._audioCtx.destination);
            osc.start();
            osc.stop(this._audioCtx.currentTime + 0.08);
        } catch (_) { /* 忽略音频失败 */ }
    }

    // ═══════════════════════════════════
    // 动态更新
    // ═══════════════════════════════════
    /** 绝缘阻值格式化（Ω → 中文单位） */
    _fmtR(ohm) {
        if (!isFinite(ohm) || ohm >= 1e9) return '∞';
        if (ohm >= 1e6) return (ohm / 1e6).toFixed(1) + 'MΩ';
        if (ohm >= 1e3) return (ohm / 1e3).toFixed(1) + 'kΩ';
        return ohm.toFixed(0) + 'Ω';
    }

    _updateDynamic(dt) {
        // 1. 读取三相绝缘（Ω）
        const src = this.sys && this.sys.comps ? this.sys.comps[this._insulSourceId] : null;
        if (src && typeof src.getInsulResistance === 'function') {
            for (let i = 0; i < 3; i++) {
                const v = src.getInsulResistance(i);
                this._R[i] = (isFinite(v) && v >= 0) ? v : 1e9;
            }
        }
        this._minR = Math.min(this._R[0], this._R[1], this._R[2]);

        // 2. 报警判定（防抖后锁存）
        const bad = this._minR < this._threshold;
        this._badTime = bad ? this._badTime + dt : 0;
        if (this._badTime >= this._alarmDelay) this._latched = true;

        const badNow = this._badTime >= this._alarmDelay;   // 故障是否仍持续

        // 3. 红灯：
        //    故障中未消闪 → 快闪；故障消失未消闪 → 慢闪（记忆指示）；
        //    消闪（无论快/慢闪）→ 常亮（确认，锁定待人工复位）；
        //    只有故障消失后按【复位】才熄灭并解除报警锁存
        this._flashT += dt;
        let lampOn = false, flashOn = false;
        if (this._latched) {
            if (!this._flashOff) {
                const rate = badNow ? 10 : 1.3;             // 快闪 5Hz（亮灭各 0.1s）/ 慢闪 ≈1.3Hz
                lampOn = true;
                flashOn = (Math.floor(this._flashT * rate) % 2 === 0);
            } else {
                lampOn = true; flashOn = true;              // 已消闪：常亮（等待复位）
            }
        }
        const lampLit = lampOn && flashOn;
        this._lampLight.fill('#ff3020');
        this._lampLight.opacity(lampLit ? 0.95 : 0);
        this._lampGlow.opacity(lampLit ? 0.8 : 0);

        // 4. 蜂鸣（仅故障仍持续且未消音时，随频闪发声）
        //    注意：beepT 在 flashOn=false 期间【不】清零，否则快闪亮周期内
        //    累计量受浮点影响达不到阈值，蜂鸣器会永远不响。
        if (lampOn && !this._muted && badNow && flashOn) {
            this._beepT += dt;
            if (this._beepT >= 0.2) { this._beep(); this._beepT = 0; }
        } else if (!badNow || this._muted || !lampOn) {
            this._beepT = 0;
        }

        // 蜂鸣波圈脉动（仅故障持续时）
        if (badNow) {
            const k = (this._flashT % 1);
            this._beepRing.radius(2 + k * (this._lamR + 3));
            this._beepRing.opacity(badNow && flashOn ? (1 - k) * 0.9 : 0);
        } else {
            this._beepRing.opacity(0);
        }

        // 5. 指针（平滑跟随最小值对应角度）
        const target = this._rToAngle(this._minR);
        let diff = target - this._needleAngle;
        if (diff > 180) diff -= 360;
        else if (diff < -180) diff += 360;
        this._needleAngle += diff * (1 - Math.exp(-dt / 0.6));
        this._needleGroup.rotation(this._needleAngle);

        // 6. 液晶数值（单行：指针所指阻值）
        this._lcdValue.text(this._fmtR(this._minR));

        // 7. 状态文字（报警中 / 故障消失待消闪 / 已消闪待复位 / 正常）
        if (this._latched) {
            if (badNow) {
                this._statusText.text('报警');
                this._statusText.fill('#ff3020');
            } else if (this._flashOff) {
                this._statusText.text('已恢复待复位');
                this._statusText.fill('#ff9800');
            } else {
                this._statusText.text('已恢复待消闪');
                this._statusText.fill('#ff9800');
            }
        } else {
            this._statusText.text('正常');
            this._statusText.fill('#06f326');
        }
    }

    // ═══════════════════════════════════
    // tick 主循环
    // ═══════════════════════════════════
    tick(dt) {
        this._updateDynamic(dt);
        this.markDirty();
        this._refreshIfDirty();
    }

    // ═══════════════════════════════════
    // 公开 API
    // ═══════════════════════════════════
    isAlarming()     { return this._latched; }
    isMuted()        { return this._muted; }
    isFlashOff()     { return this._flashOff; }
    getMinResistance() { return this._minR; }
    getPhaseResistances() { return this._R.slice(); }

    // ═══════════════════════════════════
    // 配置界面
    // ═══════════════════════════════════
    getConfigFields() {
        return [
            { label: '仪表标识',                key: 'label',          type: 'text'   },
            { label: '报警阈值 MΩ（默认 0.1）',  key: 'alarmThreshold', type: 'number' },
            { label: '绝缘指示灯组件 ID',        key: 'insulSourceId',  type: 'text'   },
        ];
    }

    onConfigUpdate(cfg) {
        if (cfg.label !== undefined) this.label = cfg.label;
        if (cfg.alarmThreshold !== undefined) {
            const th = parseFloat(cfg.alarmThreshold);
            if (isFinite(th)) this._threshold = Math.max(1e-6, th) * 1e6;
        }
        if (cfg.insulSourceId !== undefined) this._insulSourceId = cfg.insulSourceId;

        this.config = { ...this.config, ...cfg };

        this._recalcGeometry();
        this._staticGroup.destroyChildren();
        this._dynamicGroup.destroyChildren();
        this._interactGroup.destroyChildren();
        this._drawStaticParts();
        this._createDynamicNodes();
        this._bindInteraction();
        this._refreshCache?.();
    }

    destroy() {
        if (this._audioCtx) {
            try { this._audioCtx.close(); } catch (_) { /* ignore */ }
            this._audioCtx = null;
        }
        super.destroy?.();
    }
}