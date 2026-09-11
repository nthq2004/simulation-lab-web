import { BaseComponent } from './BaseComponent.js';

/**
 * DistributionBox 低压三相配电箱仿真组件（尺寸 500×300）
 *
 * ═══ 渲染优化原则 ═══════════════════════════════════════════
 *  1. 动态元素（3 个塑壳开关的手柄矩形、状态指示）使用 in-place 更新
 *  2. 消除所有 shadow 属性，避免离屏阴影渲染
 *  3. 静态部件（箱体、汇流排、接线柱、铭牌）仅在 init 时缓存
 * ═══════════════════════════════════════════════════════════
 *
 * ── 结构说明（斜等测投影 3D 效果）───────────────────────────
 *  箱体：正面矩形 + 顶面/右侧面平行四边形（斜等测投影，深度向右上偏移），宽度仅比开关区略宽
 *  顶部：3 个进线接线柱 in1/in2/in3（L1/L2/L3，从主汇流排引电）
 *  中部：三相汇流排铜条（L1 红 / L2 绿 / L3 蓝）+ 3 个三相塑壳开关
 *  每个开关：白色塑壳 + 中央竖滑槽 + 小长方体手柄（槽内上下滑动）
 *  分励接口：每开关右上角一对（sw{1..3}_fla/flb，线圈电阻 200Ω）
 *  底部：9 个出线接线柱（3 路 × 3 相：sw1_t1..t3 / sw2_t1..t3 / sw3_t1..t3），
 *        接线柱到开关出线端子用对应相颜色连线
 *
 * ── 开关状态机（每个开关独立，参照实际塑壳断路器）──────────
 *  ON   → 点击面板 或 close(i)  → OFF（手柄推下）
 *  OFF  → 点击面板 或 close(i)  → ON（手柄推上）
 *  TRIP → 点击面板 或复位 → OFF（手动复位），再合闸
 *  任意 → tripSwitch(i) → TRIP（短路/过载/分励触发）
 *
 * ── 手柄（小长方体 3D 效果，中央滑槽内滑动）────────────────
 *  正面矩形（蓝色渐变）+ 顶部厚度平行四边形（深一档）+ 面板投影阴影
 *  随状态上下平移（ON 上 / OFF 下 / TRIP 中），三部件同一 group 同步移动
 *
 * ── 交互 ────────────────────────────────────────────────────
 *  开关面板区域屏蔽拖动（防止拖配电箱时误触开关）；点击面板切换开关状态
 *
 * ── 保护特性 ────────────────────────────────────────────────
 *  每相额定电流 In（默认 100A），闭合等效阻抗 0.01Ω
 *  短路：RMS ≥ 2×In  定时限 shortDelay（默认 0.2s）跳闸
 *  过载：RMS ≥ 1.2×In 反时限 t = overloadK/(I/In - 1)（默认 K=4，1.2In≈20s）
 *
 * ── 端口 ────────────────────────────────────────────────────
 *  in1/in2/in3            顶部进线（汇流排节点，即开关进线端）
 *  sw1_t1..t3 / sw2_.. / sw3_..   底部出线（9 个）
 *  sw1_fla/flb .. sw3_fla/flb     右侧分励线圈（6 个）
 */
export class DistributionBox extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.width  = Math.max(380, config.width  || 420);
        this.height = Math.max(280, config.height || 300);

        this.type    = 'PDB';
        this.special = '3P-PDB';
        this.cache   = 'fixed';

        this._initGroups();
        this._recalcGeometry();
        this._initParameters(config);
        this._init();

        this.config = {
            id: this.id,
            label:        this.label,
            ratedCurrent: this.ratedCurrent,
            shortDelay:   this.shortDelay,
            overloadK:    this.overloadK,
            tripCoilR:    this._tripCoilR,
            initStates:   this._swStates.slice(),
            animDur:      this._animDur,
            tripFail:     this._tripFail.slice(),
        };

        // ── 端口 ──────────────────────────────────────
        // 顶部进线（L1/L2/L3）
        this.addPort(this._inPorts[0].x, this._inPorts[0].y, 'in1', 'wire');
        this.addPort(this._inPorts[1].x, this._inPorts[1].y, 'in2', 'wire');
        this.addPort(this._inPorts[2].x, this._inPorts[2].y, 'in3', 'wire');
        // 底部出线（3 开关 × 3 相）
        for (let s = 1; s <= 3; s++) {
            for (let ph = 1; ph <= 3; ph++) {
                const p = this._outPorts[s - 1][ph - 1];
                this.addPort(p.x, p.y, `sw${s}_t${ph}`, 'wire', 'p');
            }
        }
        // 分励线圈接口（3 对，fla 极性 'p'）
        for (let s = 1; s <= 3; s++) {
            const fl = this._flPorts[s - 1];
            this.addPort(fl.a.x, fl.a.y, `sw${s}_fla`, 'wire', 'p');
            this.addPort(fl.b.x, fl.b.y, `sw${s}_flb`, 'wire');
        }
    }

    // ═══════════════════════════════════════════
    // 几何尺寸计算
    // ═══════════════════════════════════════════

    _recalcGeometry() {
        const W = this.width, H = this.height;

        // 斜等测投影深度（顶面/侧面偏移，向右上）
        this._depth = Math.min(14, Math.round(W * 0.028));
        this._dx    = this._depth;
        this._dy    = -this._depth;

        // 箱体正面
        this._frame = { x: 2, y: 2, w: W - 4, h: H - 4, rx: 4 };

        // 三个开关的列中心 x（均匀分布，箱体只比开关区略宽）
        const leftPad  = W * 0.10;
        const rightPad = W * 0.14;
        this._swCX = [0, 1, 2].map(i => leftPad + (W - leftPad - rightPad) * (i + 0.5) / 3);

        // 进线接线柱（顶部边缘，与各开关对齐）
        this._inPorts = this._swCX.map(cx => ({ x: cx, y: 2 }));

        // 三相汇流排铜条 y（L1 上 / L2 中 / L3 下）
        const barTop = H * 0.15;
        this._barGap = 7;
        this._barYs = [barTop, barTop + this._barGap, barTop + 2 * this._barGap];

        // 开关面板区域
        this._swTop  = H * 0.24;
        this._swH    = H * 0.52;
        this._swW    = Math.min(96, W * 0.20);
        this._swInY  = this._swTop + 6;                 // 顶部进线端子行
        this._swOutY = this._swTop + this._swH - 8;     // 底部出线端子行
        this._swMidY = (this._swInY + this._swOutY) / 2;// 手柄中心

        // 出线接线柱（底部边缘）
        this._outPorts = [];
        for (let s = 0; s < 3; s++) {
            const cx = this._swCX[s];
            const row = [];
            for (let ph = 0; ph < 3; ph++) {
                row.push({ x: cx + (ph - 1) * (this._swW / 3), y: H - 2 });
            }
            this._outPorts.push(row);
        }

        // 分励线圈接口（每个开关右边缘，上下两端口，间距较大）
        this._flPorts = [];
        for (let s = 0; s < 3; s++) {
            const cx = this._swCX[s];
            const fx = cx + this._swW / 2;          // 端口中心位于开关右边缘
            this._flPorts.push({
                a: { x: fx, y: this._swTop + 6 },
                b: { x: fx, y: this._swTop + 40 },   // 两端口间距增大
            });
        }

        // 手柄（小长方体，竖直长方形，在中央竖滑槽内上下滑动）
        this._handleBarH = Math.min(this._swH * 0.34, Math.round(H * 0.20)); // 手柄高度（竖长）
        this._handleBarW = Math.max(18, Math.min(26, Math.round(this._swW * 0.30))); // 手柄宽度（窄）
        this._handleOffsets = {
            on:  -this._swH * 0.22,   // 合闸（推上）
            off:  this._swH * 0.16,   // 分闸（推下）
            trip: 0,                  // 跳闸（居中弹出）
        };

        // 中央竖滑槽（竖直窄条，比手柄略宽）
        this._slotW = this._handleBarW + 10;
        this._slotTop = this._swMidY + this._handleOffsets.on - this._handleBarH / 2 - 4;
        this._slotBot = this._swMidY + this._handleOffsets.off + this._handleBarH / 2 + 4;
    }

    // ═══════════════════════════════════════════
    // 参数初始化
    // ═══════════════════════════════════════════

    _initParameters(config) {
        this.label        = config.label        || '配电箱';
        this.function     = '低压三相配电箱';
        this.ratedCurrent = config.ratedCurrent !== undefined ? config.ratedCurrent : 100;
        this.shortDelay   = config.shortDelay   !== undefined ? config.shortDelay   : 0.2;
        this.overloadK    = config.overloadK    !== undefined ? config.overloadK    : 4;
        this._tripCoilR   = config.tripCoilR    !== undefined ? config.tripCoilR    : 200;
        this._animDur     = config.animDur      !== undefined ? config.animDur      : 0.10;

        // 三个开关状态
        const init = Array.isArray(config.initStates)
            ? config.initStates.map(v => String(v).toLowerCase())
            : ['off', 'off', 'off'];
        this._swStates = init.map(v => ['on', 'off', 'trip'].includes(v) ? v : 'off');

        this._anim = this._swStates.map(st => ({
            animating: false, t: 0,
            fromY: this._handleOffsets[st],
            toY:   this._handleOffsets[st],
            dur:   this._animDur,
        }));
        this._curHandleY = this._swStates.map(st => this._handleOffsets[st]);

        // 三相 RMS 缓冲（3 开关 × 3 相 × 40 点）
        this._iBuf = [[], [], []];
        this._iBufSum = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
        for (let s = 0; s < 3; s++) {
            for (let ph = 0; ph < 3; ph++) this._iBuf[s].push(new Array(40).fill(0));
        }
        this._iBufIdx = 0;
        this._iBufCount = 0;
        this._iRms = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];

        // 保护计时
        this._shortT = [0, 0, 0];
        this._ovAcc  = [0, 0, 0];

        // 固有故障：某开关过载/短路脱扣失效（true=保护不动作）。
        // 默认第 3 个塑壳开关（sw3）保护失效：即使过载/短路也不会自动脱扣。
        const tripFail = Array.isArray(config.tripFail)
            ? config.tripFail.map(Boolean)
            : [false, false, true];
        this._tripFail = tripFail.length >= 3 ? tripFail.slice(0, 3) : [false, false, true];

        this._phaseCurrents = { sw1: { l1: 0, l2: 0, l3: 0 }, sw2: { l1: 0, l2: 0, l3: 0 }, sw3: { l1: 0, l2: 0, l3: 0 } };
    }

    // ═══════════════════════════════════════════
    // 主初始化入口
    // ═══════════════════════════════════════════

    _init() {
        this._drawStaticParts();
        this._createDynamicNodes();
        this._bindInteraction();
    }

    // ═══════════════════════════════════════════
    // 静态部件
    // ═══════════════════════════════════════════

    _drawStaticParts() {
        this._drawBox3D();
        this._drawBusbar();
        this._drawSwitches();
        this._drawTerminals();
        this._drawTitle();
    }

    /** 箱体（斜等测投影 3D） */
    _drawBox3D() {
        const f = this._frame;
        const dx = this._dx, dy = this._dy;

        // 右侧面（平行四边形，最暗）
        this._staticGroup.add(new Konva.Line({
            points: [
                f.x + f.w, f.y,
                f.x + f.w + dx, f.y + dy,
                f.x + f.w + dx, f.y + f.h + dy,
                f.x + f.w, f.y + f.h,
            ],
            closed: true, fill: '#9aa2ac', stroke: '#6e7680', strokeWidth: 1,
            listening: false,
        }));

        // 顶面（平行四边形，稍亮）
        this._staticGroup.add(new Konva.Line({
            points: [
                f.x, f.y,
                f.x + dx, f.y + dy,
                f.x + f.w + dx, f.y + dy,
                f.x + f.w, f.y,
            ],
            closed: true, fill: '#e3e7ec', stroke: '#c0c6ce', strokeWidth: 1,
            listening: false,
        }));

        // 正面箱体面板
        this._staticGroup.add(new Konva.Rect({
            x: f.x, y: f.y, width: f.w, height: f.h,
            fill: '#d7dbe0',
            stroke: '#8a929c', strokeWidth: 2,
            cornerRadius: f.rx,
        }));

        // 面板顶部装饰条
        this._staticGroup.add(new Konva.Rect({
            x: f.x + 3, y: f.y + 3,             width: f.w - 6, height: Math.max(20, Math.round(this.height * 0.05)),
            fill: 'rgba(90,120,200,0.16)',
            cornerRadius: [f.rx, f.rx, 0, 0],
        }));

        // 箱体侧棱高光（左侧竖线，受光面）
        this._staticGroup.add(new Konva.Line({
            points: [f.x + 1, f.y + 4, f.x + 1, f.y + f.h - 4],
            stroke: 'rgba(255,255,255,0.35)', strokeWidth: 2, listening: false,
        }));
    }

    /** 三相汇流排铜条（L1 红 / L2 绿 / L3 蓝）+ 从进线柱到铜条、铜条到各开关进线端的引线 */
    _drawBusbar() {
        const barColors = [
            { fill: '#e03030', stroke: '#8a1818' },
            { fill: '#20a030', stroke: '#0f5e1c' },
            { fill: '#2050e0', stroke: '#102a80' },
        ];
        const barH = 4;
        const barLeft = this._frame.x + 8;
        const barRight = this._frame.x + this._frame.w - 6;   // 延伸到箱体右侧

        // 汇流排铜条
        this._barRects = [];
        for (let ph = 0; ph < 3; ph++) {
            const cy = this._barYs[ph];
            const c = barColors[ph];
            const bar = new Konva.Rect({
                x: barLeft, y: cy - barH / 2, width: barRight - barLeft, height: barH,
                fill: c.fill, stroke: c.stroke, strokeWidth: 1, cornerRadius: 1,
                listening: false,
            });
            this._staticGroup.add(bar);
            this._barRects.push(bar);

            // 相位标签
            this._staticGroup.add(new Konva.Text({
                x: barLeft + 6, y: cy - 6,
                text: ['L1', 'L2', 'L3'][ph],
                fontSize: 9, fontStyle: 'bold', fill: c.fill, listening: false,
            }));
        }

        // 进线柱 → 对应汇流排
        for (let ph = 0; ph < 3; ph++) {
            const p = this._inPorts[ph];
            this._staticGroup.add(new Konva.Line({
                points: [p.x, p.y + 4, p.x, this._barYs[ph]],
                stroke: barColors[ph].fill, strokeWidth: 1.6, listening: false,
            }));
        }

        // 汇流排 → 各开关进线端
        for (let s = 0; s < 3; s++) {
            const cx = this._swCX[s];
            for (let ph = 0; ph < 3; ph++) {
                const tx = cx + (ph - 1) * (this._swW / 3);
                this._staticGroup.add(new Konva.Line({
                    points: [tx, this._barYs[ph] + barH / 2, tx, this._swInY - 4],
                    stroke: barColors[ph].fill, strokeWidth: 1.2, listening: false,
                }));
            }
        }

        // 各开关出线端子 → 底部出线接线柱（对应相颜色连线）
        for (let s = 0; s < 3; s++) {
            const cx = this._swCX[s];
            for (let ph = 0; ph < 3; ph++) {
                const tx = cx + (ph - 1) * (this._swW / 3);
                const bot = this._outPorts[s][ph];
                this._staticGroup.add(new Konva.Line({
                    points: [tx, this._swOutY + 3.5, bot.x, bot.y - 5],
                    stroke: barColors[ph].fill, strokeWidth: 1.4, listening: false,
                }));
            }
        }
    }

    /** 三个塑壳开关面板（白色壳体 + 状态标签 + 端子螺丝） */
    _drawSwitches() {
        this._switchRects = [];
        for (let s = 0; s < 3; s++) {
            const cx = this._swCX[s];
            const x = cx - this._swW / 2, y = this._swTop;
            const w = this._swW, h = this._swH;

            // 白色塑壳壳体
            this._staticGroup.add(new Konva.Rect({
                x, y, width: w, height: h,
                fill: '#f0f1f4',
                stroke: '#a0a8b8', strokeWidth: 1.5,
                cornerRadius: 3,
            }));
            // 壳体顶部高光
            this._staticGroup.add(new Konva.Rect({
                x: x + 2, y: y + 2, width: w - 4, height: h * 0.05,
                fill: 'rgba(255,255,255,0.55)', cornerRadius: [3, 3, 0, 0],
                listening: false,
            }));
            // 壳体侧边厚度（立体感）
            this._staticGroup.add(new Konva.Rect({
                x: x, y: y, width: 2.5, height: h,
                fill: '#c8ccd4', cornerRadius: [3, 0, 0, 3], listening: false,
            }));

            // 中央竖滑槽（供手柄上下滑动）
            const slotX = cx - this._slotW / 2;
            this._staticGroup.add(new Konva.Rect({
                x: slotX, y: this._slotTop,
                width: this._slotW, height: this._slotBot - this._slotTop,
                fill: '#cfd3da',
                stroke: '#9aa2ac', strokeWidth: 1,
                cornerRadius: 2, listening: false,
            }));
            // 滑槽内壁阴影（上暗下亮，模拟凹槽）
            this._staticGroup.add(new Konva.Rect({
                x: slotX + 1, y: this._slotTop + 1,
                width: this._slotW - 2, height: (this._slotBot - this._slotTop) * 0.5,
                fill: 'rgba(0,0,0,0.10)', cornerRadius: [2, 2, 0, 0], listening: false,
            }));
            this._staticGroup.add(new Konva.Rect({
                x: slotX + 1, y: this._slotBot - (this._slotBot - this._slotTop) * 0.4,
                width: this._slotW - 2, height: (this._slotBot - this._slotTop) * 0.4 - 1,
                fill: 'rgba(255,255,255,0.35)', cornerRadius: [0, 0, 2, 2], listening: false,
            }));

            // 状态标签（ON/TRIP/OFF，左侧竖排）
            const lblX = x + 3;
            const marks = [
                { off: this._handleOffsets.on,   text: 'ON',   color: '#20a030' },
                { off: this._handleOffsets.trip, text: 'TRIP', color: '#e08020' },
                { off: this._handleOffsets.off,  text: 'OFF',  color: '#c03020' },
            ];
            marks.forEach(m => {
                this._staticGroup.add(new Konva.Text({
                    x: lblX, y: this._swMidY + m.off - 5,
                    text: m.text, fontSize: 8, fontStyle: 'bold', fill: m.color,
                    listening: false,
                }));
            });

            // 顶部/底部端子螺丝（L1..L3 / T1..T3）
            const termYs = [this._swInY, this._swOutY];
            for (let ti = 0; ti < 2; ti++) {
                for (let ph = 0; ph < 3; ph++) {
                    this._drawScrew(cx + (ph - 1) * (w / 3), termYs[ti]);
                }
            }

            // 位号标签
            this._staticGroup.add(new Konva.Text({
                x: cx - w / 2, y: y + h + 2, width: w,
                text: `QF${s + 1}`,
                fontSize: 10, fontStyle: 'bold', fill: '#3a3e44',
                align: 'center', listening: false,
            }));
        }
    }

    /** 接线端子螺丝（铜色十字螺丝） */
    _drawScrew(x, y) {
        const r = 3.5;
        this._staticGroup.add(new Konva.Circle({
            x, y, radius: r,
            fillLinearGradientStartPoint: { x: -r, y: -r },
            fillLinearGradientEndPoint:   { x:  r, y:  r },
            fillLinearGradientColorStops: [
                0, '#8a7a30', 0.4, '#c8a848', 0.7, '#d8b858', 1, '#7a6a28',
            ],
            stroke: '#5a4a18', strokeWidth: 0.6, listening: false,
        }));
        this._staticGroup.add(new Konva.Line({
            points: [x - r * 0.55, y, x + r * 0.55, y],
            stroke: '#3a2a08', strokeWidth: 0.7, listening: false,
        }));
        this._staticGroup.add(new Konva.Line({
            points: [x, y - r * 0.55, x, y + r * 0.55],
            stroke: '#3a2a08', strokeWidth: 0.7, listening: false,
        }));
    }

    /** 进线/出线/分励接线柱（铜色圆） + 标注 */
    _drawTerminals() {
        const phColors = ['#e03030', '#20a030', '#2050e0'];
        // 进线（顶部）
        this._inPorts.forEach((p, i) => {
            this._drawTerminal(p.x, p.y, ['L1', 'L2', 'L3'][i], phColors[i], true);
        });
        // 出线（底部，9 个）
        for (let s = 0; s < 3; s++) {
            for (let ph = 0; ph < 3; ph++) {
                const p = this._outPorts[s][ph];
                this._drawTerminal(p.x, p.y, `T${ph + 1}`, phColors[ph], false);
            }
        }
        // 分励（每个开关右上角，6 个）
        for (let s = 0; s < 3; s++) {
            const fl = this._flPorts[s];
            this._drawTerminal(fl.a.x, fl.a.y, `F${s + 1}A`, '#6a5a28', true);
            this._drawTerminal(fl.b.x, fl.b.y, `F${s + 1}B`, '#6a5a28', true);
        }
    }

    /** 单个接线柱 */
    _drawTerminal(x, y, name, color, labelRight) {
        const R = 5;
        this._staticGroup.add(new Konva.Circle({
            x, y, radius: R,
            fillLinearGradientStartPoint: { x: -R, y: -R },
            fillLinearGradientEndPoint:   { x:  R, y:  R },
            fillLinearGradientColorStops: [
                0, '#7a6a30', 0.4, '#d4aa52', 0.7, '#e8c86a', 1, '#8a7030',
            ],
            stroke: '#6a5a28', strokeWidth: 1, listening: false,
        }));
        this._staticGroup.add(new Konva.Circle({
            x, y, radius: R * 0.38, fill: '#2a1a08', stroke: '#5a4a20', strokeWidth: 0.6, listening: false,
        }));
        this._staticGroup.add(new Konva.Text({
            x: labelRight ? x + 8 : x - 8,
            y: y - 5,
            text: name, fontSize: 8, fontStyle: 'bold', fill: color,
            align: labelRight ? 'left' : 'right',
            listening: false,
        }));
    }

    /** 标题 */
    _drawTitle() {
        this._staticGroup.add(new Konva.Text({
            x: this._frame.x + 6, y: this._frame.y + 6,
            text: this.label,
            fontSize: 13, fontStyle: 'bold', fill: '#3a4a6a',
            listening: false,
        }));
        this._staticGroup.add(new Konva.Text({
            x: this._frame.x + 6, y: this._frame.y + 22,
            text: `In=${this.ratedCurrent}A  分励线圈${this._tripCoilR}Ω`,
            fontSize: 9, fill: '#5a6a7a', listening: false,
        }));
    }

    // ═══════════════════════════════════════════
    // 动态层（每个开关：手柄小长方体 + 状态指示）
    // ═══════════════════════════════════════════

    _createDynamicNodes() {
        this._handleGroups = [];
        for (let s = 0; s < 3; s++) {
            this._handleGroups.push(this._createHandle(s));
        }
    }

    /**
     * 塑壳开关手柄（小长方体 3D 效果）：
     *  正面矩形（蓝渐变）+ 顶部厚度平行四边形 + 面板投影阴影，同一 group 同步移动
     */
    _createHandle(s) {
        const cx = this._swCX[s];
        const bw = this._handleBarW, bh = this._handleBarH;
        const th = 3; // 长方体厚度投影

        const g = new Konva.Group({ x: cx, y: this._swMidY + this._curHandleY[s] });

        // 面板投影阴影（衬托凸起）
        g.add(new Konva.Rect({
            x: -bw / 2 + 2, y: -bh / 2 + 3,
            width: bw, height: bh,
            fill: 'rgba(0,0,0,0.16)', cornerRadius: 3, listening: false,
        }));

        // 顶部厚度面（平行四边形，深色，斜等测方向）
        g.add(new Konva.Line({
            points: [
                -bw / 2, -bh / 2,
                bw / 2, -bh / 2,
                bw / 2 + this._dx * 0.22, -bh / 2 + this._dy * 0.22,
                -bw / 2 + this._dx * 0.22, -bh / 2 + this._dy * 0.22,
            ],
            closed: true, fill: '#14385e', listening: false,
        }));

        // 正面矩形（蓝色渐变主体）
        g.add(new Konva.Rect({
            x: -bw / 2, y: -bh / 2,
            width: bw, height: bh,
            fillLinearGradientStartPoint: { x: 0, y: -bh / 2 },
            fillLinearGradientEndPoint:   { x: 0, y:  bh / 2 },
            fillLinearGradientColorStops: [
                0, '#3890e0', 0.3, '#2878c8', 0.7, '#1a60a8', 1, '#1848a0',
            ],
            stroke: '#1040a0', strokeWidth: 1, cornerRadius: 3,
        }));

        // 正面高光条（顶部受光）
        g.add(new Konva.Rect({
            x: -bw / 2 + 3, y: -bh / 2 + 1,
            width: bw - 6, height: bh * 0.24,
            fill: 'rgba(255,255,255,0.32)', cornerRadius: [2, 2, 0, 0], listening: false,
        }));

        // 正面下缘暗线（背光）
        g.add(new Konva.Line({
            points: [-bw / 2 + 2, bh / 2 - 1, bw / 2 - 2, bh / 2 - 1],
            stroke: 'rgba(0,0,0,0.25)', strokeWidth: 1, listening: false,
        }));

        // 手柄中央横向凸起（手使力处，3D 凸起）
        const gripW = bw - 6;
        const gripH = Math.max(11, Math.round(bh * 0.24));
        const gripY = -gripH / 2;

        // 凸起底面投影（下方暗影，衬托凸起）
        g.add(new Konva.Rect({
            x: -gripW / 2, y: gripY + 2,
            width: gripW, height: gripH,
            fill: 'rgba(0,0,0,0.28)', cornerRadius: 2, listening: false,
        }));

        // 凸起主体（横向渐变：上亮下暗 → 圆柱凸起感）
        g.add(new Konva.Rect({
            x: -gripW / 2, y: gripY,
            width: gripW, height: gripH,
            fillLinearGradientStartPoint: { x: 0, y: gripY },
            fillLinearGradientEndPoint:   { x: 0, y: gripY + gripH },
            fillLinearGradientColorStops: [
                0, '#5aa0ec', 0.35, '#3890e0', 0.65, '#2a70b8', 1, '#18508e',
            ],
            stroke: '#1040a0', strokeWidth: 0.8, cornerRadius: 3, listening: false,
        }));

        // 凸起顶部高光线（受光面，3D 凸起关键）
        g.add(new Konva.Rect({
            x: -gripW / 2 + 2, y: gripY + 1,
            width: gripW - 4, height: 2,
            fill: 'rgba(255,255,255,0.50)', cornerRadius: 1, listening: false,
        }));

        // 防滑横纹（指示施力位置）
        for (let i = 0; i < 2; i++) {
            const ly = gripY + gripH * 0.30 + i * 4;
            g.add(new Konva.Line({
                points: [-gripW * 0.34, ly, gripW * 0.34, ly],
                stroke: 'rgba(0,0,0,0.20)', strokeWidth: 1, listening: false,
            }));
        }

        this._dynamicGroup.add(g);
        return g;
    }

    // ═══════════════════════════════════════════
    // 交互绑定
    // ═══════════════════════════════════════════

    _bindInteraction() {
        // 箱体其余区域可拖动（透明 hit 放在最底层，开关面板 hit 在上层覆盖）
        const f = this._frame;
        const boxDragHit = new Konva.Rect({
            x: f.x, y: f.y, width: f.w, height: f.h,
            fill: 'transparent',
        });
        this._interactGroup.add(boxDragHit);

        // 双保险：即使拖动已启动，若起点落在开关面板内也立即取消拖动
        this.group.off('dragstart');
        this.group.on('dragstart', (e) => {
            const stage = this.group.getStage();
            if (!stage) return;
            const pointer = stage.getPointerPosition();
            if (!pointer) return;
            const tr = this.group.getTransform().copy();
            tr.invert();
            const local = tr.point(pointer);
            for (let s = 0; s < 3; s++) {
                const x0 = this._swCX[s] - this._swW / 2;
                const y0 = this._swTop;
                if (local.x >= x0 && local.x <= x0 + this._swW &&
                    local.y >= y0 && local.y <= y0 + this._swH) {
                    e.cancelBubble = true;
                    if (typeof this.group.stopDrag === 'function') this.group.stopDrag();
                    return;
                }
            }
        });

        // 每个开关面板：独立透明 hit（fill:'transparent' 才参与 Konva 命中）承担点击切换
        // 同时模拟 addClickablePart 的 lastClickedPartId，供工作流 find 识别部件
        for (let s = 0; s < 3; s++) {
            const cx = this._swCX[s];
            const x = cx - this._swW / 2, y = this._swTop, w = this._swW, h = this._swH;
            const idx = s;
            const partId = `sw${s + 1}`;

            const hit = new Konva.Rect({ x, y, width: w, height: h, fill: 'transparent' });
            hit.on('click tap', (e) => {
                e.cancelBubble = true;
                this.sys.lastClickedId = this.id;
                this.sys.lastClickedPartId = `${this.id}/${partId}`;
                if (this._anim[idx].animating) return;
                const st = this._swStates[idx];
                if (st === 'off') this.close(idx);
                else if (st === 'on') this.open(idx);
                else if (st === 'trip') this._resetToOff(idx);
            });
            hit.on('mouseenter', () => { document.body.style.cursor = 'pointer'; });
            hit.on('mouseleave', () => { document.body.style.cursor = 'default'; });
            this._interactGroup.add(hit);
        }
    }

    // ═══════════════════════════════════════════
    // tick（20fps）
    // ═══════════════════════════════════════════

    tick(dt) {
        this._tickAnimation(dt);
        this._updateRMS();
        this._checkProtection(dt);
        this._checkShuntTrip();

        if (this._anim.some(a => a.animating) || this._animJustEnded) {
            this._animJustEnded = false;
            this._updateDynamic();
            this.markDirty();
        }
        this._refreshIfDirty();
    }

    /**
     * 分励脱扣检测：某开关分励线圈（fla↔flb）得电（压差 / 线圈电阻 产生的电流
     * 超过阈值）即触发该开关脱扣。参照 MarineMainsSwitch 分励线圈动作电流判定。
     */
    _checkShuntTrip() {
        if (!this.sys || typeof this.sys.getVoltageBetween !== 'function') return;
        const R = this._tripCoilR || 200;
        const pickup = 24 / R * 0.85;   // 额定 24V 线圈电流的 85% 视为得电动作
        for (let s = 0; s < 3; s++) {
            if (this._swStates[s] === 'trip') continue;
            const v = this.sys.getVoltageBetween(`${this.id}_wire_sw${s + 1}_fla`, `${this.id}_wire_sw${s + 1}_flb`) || 0;
            const iCoil = Math.abs(v) / R;
            if (iCoil >= pickup && Math.abs(v) > 1) {
                this.tripSwitch(s);
            }
        }
    }

    _updateDynamic() {
        for (let s = 0; s < 3; s++) {
            this._handleGroups[s].y(this._swMidY + this._curHandleY[s]);
        }
    }

    /** 三个开关动画插值 */
    _tickAnimation(dt) {
        for (let s = 0; s < 3; s++) {
            const a = this._anim[s];
            if (!a.animating) continue;
            a.t += dt / a.dur;
            if (a.t >= 1) {
                a.t = 1;
                a.animating = false;
                this._animJustEnded = true;
                this._curHandleY[s] = a.toY;
            }
            const ease = 0.5 - 0.5 * Math.cos(a.t * Math.PI);
            this._curHandleY[s] = a.fromY + (a.toY - a.fromY) * ease;
        }
    }

    /** 三相 RMS 更新（3 开关 × 3 相，40 点滑动窗口） */
    _updateRMS() {
        const pc = this.phaseCurrents;
        if (!pc) return;
        for (let s = 0; s < 3; s++) {
            const sw = pc[`sw${s + 1}`];
            if (!sw) continue;
            const inst = [sw.l1 || 0, sw.l2 || 0, sw.l3 || 0];
            for (let ph = 0; ph < 3; ph++) {
                const i2 = inst[ph] * inst[ph];
                const old = this._iBuf[s][ph][this._iBufIdx];
                this._iBuf[s][ph][this._iBufIdx] = i2;
                this._iBufSum[s][ph] = this._iBufSum[s][ph] - old + i2;
            }
        }
        this._iBufIdx = (this._iBufIdx + 1) % 40;
        if (this._iBufCount < 40) this._iBufCount++;
        if (this._iBufCount >= 40) {
            for (let s = 0; s < 3; s++) {
                for (let ph = 0; ph < 3; ph++) {
                    this._iRms[s][ph] = Math.sqrt(this._iBufSum[s][ph] / 40);
                }
            }
        }
    }

    /**
     * 保护检测：
     *  短路：任一相 RMS ≥ 2×In 持续 shortDelay 秒（定时限）
     *  过载：任一相 RMS ≥ 1.2×In 反时限 t = overloadK/(I/In - 1)
     */
    _checkProtection(dt) {
        if (this._iBufCount < 40) return;
        const In = this.ratedCurrent;
        for (let s = 0; s < 3; s++) {
            // 固有故障：过载/短路脱扣失效的开关不参与保护判定
            if (this._tripFail[s]) continue;
            if (this._swStates[s] !== 'on') {
                this._shortT[s] = 0;
                this._ovAcc[s] = 0;
                continue;
            }
            const maxI = Math.max(this._iRms[s][0], this._iRms[s][1], this._iRms[s][2]);
            if (maxI >= 2 * In) {
                this._shortT[s] += dt;
                this._ovAcc[s] = 0;
                if (this._shortT[s] >= this.shortDelay) {
                    this._shortT[s] = 0;
                    this.tripSwitch(s);
                }
            } else if (maxI >= 1.2 * In) {
                this._shortT[s] = 0;
                const tI = this.overloadK / (maxI / In - 1);
                this._ovAcc[s] += dt / tI;
                if (this._ovAcc[s] >= 1) {
                    this._ovAcc[s] = 0;
                    this.tripSwitch(s);
                }
            } else {
                this._shortT[s] = 0;
                // 散热衰减
                this._ovAcc[s] *= 0.96;
            }
        }
    }

    // ═══════════════════════════════════════════
    // 公开 API
    // ═══════════════════════════════════════════

    _startAnim(s, toState) {
        const a = this._anim[s];
        a.fromY = this._curHandleY[s];
        a.toY   = this._handleOffsets[toState];
        a.t     = 0;
        a.animating = true;
        a.dur       = toState === 'trip' ? 0.06 : this._animDur;
        this._swStates[s] = toState;
    }

    _resetToOff(s) {
        this._anim[s].dur = 0.15;
        this._startAnim(s, 'off');
    }

    /** 合闸（OFF → ON） */
    close(s) {
        if (this._anim[s].animating || this._swStates[s] !== 'off') return;
        this._anim[s].dur = this._animDur;
        this._startAnim(s, 'on');
    }

    /** 分闸（ON → OFF） */
    open(s) {
        if (this._anim[s].animating || this._swStates[s] !== 'on') return;
        this._anim[s].dur = this._animDur;
        this._startAnim(s, 'off');
    }

    /** 脱扣（任意 → TRIP，短路/过载/分励触发） */
    tripSwitch(s) {
        if (this._swStates[s] === 'trip') return;
        this._anim[s].dur = 0.06;
        this._startAnim(s, 'trip');
    }

    getSwState(s)  { return this._swStates[s]; }
    getStates()    { return this._swStates.slice(); }
    isClosed(s)    { return this._swStates[s] === 'on'; }
    isTripped(s)   { return this._swStates[s] === 'trip'; }
    isAnimating()  { return this._anim.some(a => a.animating); }
    getTripCoilR() { return this._tripCoilR; }

    /** 固有故障状态：某开关过载/短路脱扣是否失效 */
    isTripFail(s)   { return !!this._tripFail[s]; }
    getTripFail()   { return this._tripFail.slice(); }
    setTripFail(s, v) { if (s >= 0 && s < 3) this._tripFail[s] = !!v; }

    /** 外部状态驱动（s: 0/1/2） */
    update(s, state) {
        const st = String(state).toLowerCase();
        if (st === 'on'   || st === '1')   this.close(s);
        if (st === 'off'  || st === '0')   this.open(s);
        if (st === 'trip')                  this.tripSwitch(s);
    }

    getConfigFields() {
        return [
            { label: '位号/名称',        key: 'label',        type: 'text'   },
            { label: '额定电流 (A)',      key: 'ratedCurrent', type: 'number' },
            { label: '短路延时 (s)',      key: 'shortDelay',   type: 'number' },
            { label: '过载系数 K',        key: 'overloadK',    type: 'number' },
            { label: '分励线圈电阻 (Ω)',  key: 'tripCoilR',    type: 'number' },
            { label: '动作时间 (s)',       key: 'animDur',      type: 'number' },
        ];
    }

    onConfigUpdate(cfg) {
        if (cfg.label        !== undefined) this.label        = cfg.label;
        if (cfg.ratedCurrent !== undefined) this.ratedCurrent = parseFloat(cfg.ratedCurrent);
        if (cfg.shortDelay   !== undefined) this.shortDelay   = parseFloat(cfg.shortDelay);
        if (cfg.overloadK    !== undefined) this.overloadK    = parseFloat(cfg.overloadK);
        if (cfg.tripCoilR    !== undefined) this._tripCoilR   = parseFloat(cfg.tripCoilR);
        if (cfg.animDur      !== undefined) this._animDur     = parseFloat(cfg.animDur);

        this.config = { ...this.config, ...cfg };
        this._recalcGeometry();
        this._staticGroup.destroyChildren();
        this._dynamicGroup.destroyChildren();
        this._drawStaticParts();
        this._createDynamicNodes();
        this._refreshCache();
    }

    destroy() {
        super.destroy?.();
    }
}
