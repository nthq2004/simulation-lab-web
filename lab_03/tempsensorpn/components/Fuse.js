import { BaseComponent } from './BaseComponent.js';

/**
 * 熔断器仿真组件
 * （Fuse / Cartridge Fuse / HRC Fuse）
 *
 * ── 器件原理 ──────────────────────────────────────────────────
 *
 *  熔断器是利用金属导体在过电流条件下产生焦耳热而熔断的
 *  最简单的一次性过电流保护元件：
 *
 *  ┌─────────────────────────────────────────────────────────┐
 *  │  熔断原理（焦耳定律）：                                  │
 *  │                                                         │
 *  │    Q = I² · R · t                                       │
 *  │                                                         │
 *  │  熔断条件：Q ≥ Q_melt（达到熔丝熔化热量阈值）           │
 *  │                                                         │
 *  │  反时限特性（I²t 特性）：                                │
 *  │    I² · t = K（常数，称为"熔化系数"）                   │
 *  │    电流越大 → 熔断时间越短（反时限）                    │
 *  │    I < 1.1In → 长期不熔断                               │
 *  │    I = 1.5In → 约 1h 熔断                               │
 *  │    I = 2In   → 约 10min 熔断                            │
 *  │    I = 6In   → < 1s 熔断                                │
 *  │    I = 10In  → < 0.1s 熔断（短路保护）                  │
 *  └─────────────────────────────────────────────────────────┘
 *
 * ── 内部结构（瓷管型 RT14/RT18 有填料密封熔断器）─────────────
 *
 *  ┌───────────────────────────────────────────────────────────┐
 *  │                                                           │
 *  │   ┌──────┐  ╔═══════════════════════════╗  ┌──────┐     │
 *  │   │铜端帽│  ║    石英砂填料（灭弧介质） ║  │铜端帽│     │
 *  │   │(Cap) │  ║  ┌─────────────────────┐  ║  │(Cap) │     │
 *  │   │      │  ║  │   熔丝（Fuse Wire） │  ║  │      │     │
 *  │   │  A   │  ║  │  银/铜合金细丝      │  ║  │  B   │     │
 *  │   │      │  ║  │  收缩颈（弱点设计） │  ║  │      │     │
 *  │   └──────┘  ║  └─────────────────────┘  ║  └──────┘     │
 *  │             ║    陶瓷管体（隔热绝缘）    ║               │
 *  │             ╚═══════════════════════════╝               │
 *  │                                                           │
 *  └───────────────────────────────────────────────────────────┘
 *
 * ── 各部件详解 ────────────────────────────────────────────────
 *
 *  1. 熔体（Fuse Element / Fuse Wire）
 *     - 材质：纯银（高精度）/ 铜银合金（一般用途）/ 锌（低压）
 *     - 截面形状：圆形细丝 / 薄片冲孔（宽频保护）
 *     - 收缩颈：在细丝中段设计更细的"弱点"，保证在此处熔断
 *     - 多段并联：高额定电流时多根细丝并联
 *     - 熔断后：金属液化汽化，被石英砂冷却固化
 *
 *  2. 填料（Arc-quenching Filler）
 *     - 石英砂（SiO₂）：纯度 99.5% 以上
 *     - 导热系数高：迅速吸收熔断时的弧能量
 *     - 绝缘强度高：熔断后防止弧道复燃
 *     - 在熔断后与金属蒸汽反应形成固态熔渣
 *
 *  3. 管体（Body / Cartridge）
 *     - 材质：高铝陶瓷（氧化铝，Al₂O₃ > 95%）
 *     - 耐温 > 1000°C，承受熔断时的内压
 *     - 外径标准化（RT14：φ10.3mm，RT18：φ14mm）
 *
 *  4. 端帽（End Cap / Terminal）
 *     - 材质：铜或黄铜（镀锡防氧化）
 *     - 通过压接固定在陶瓷管两端
 *     - 提供接触面和接线端子
 *
 *  5. 指示器（Indicator / Fuse Blown Indicator）
 *     - 部分规格带有弹出式指示针（红色小弹片）
 *     - 熔断时弹出，可视化判断是否熔断
 *     - 不影响主电路，仅作指示用
 *
 *  6. 熔断器座（Fuse Holder）
 *     - 本组件含熔断器座，配合熔芯（可更换）
 *     - 螺旋式（NH 型）/ 插入式（RT 型）
 *     - 安全防护：只有断电后才能取出熔芯
 *
 * ── RT14/RT18 系列规格 ────────────────────────────────────────
 *
 *  RT14（10×38mm）：2A / 4A / 6A / 10A / 16A / 20A / 25A / 32A
 *  RT18（14×51mm）：6A / 10A / 16A / 20A / 25A / 32A / 40A / 50A / 63A
 *  分断能力：100kA（有填料型，远高于空气开关的 6~10kA）
 *
 * ── 仿真动画 ──────────────────────────────────────────────────
 *
 *  1. 正常态：熔丝银白色细线，通过电流时发橙黄辉光
 *  2. 过载预热：熔丝随 I²t 积累逐渐由白→橙→红→白热
 *  3. 临界态：熔丝中段收缩颈发强白光（最热点），颤动效果
 *  4. 熔断动画：
 *     a. 收缩颈处产生弧光（蓝白闪光，< 20ms）
 *     b. 熔丝断裂（断口可见，中段消失）
 *     c. 石英砂填充效果（断口变暗）
 *     d. 指示针弹出（侧面红色小凸起）
 *  5. 已熔断态：熔丝中段缺失，断口氧化发黑，指示灯亮红
 *  6. 更换熔芯：调用 replace() 动画复位
 *  7. 端子发热：大电流时端帽发橙红辉光
 *  8. 剩余寿命条：可视化 I²t 积累进度（0→熔断）
 *  9. 透视效果：管体半透明，可见内部熔丝状态
 *
 * ── 端口 ─────────────────────────────────────────────────────
 *  terminal_a — A 端（进线端，左端帽）
 *  terminal_b — B 端（出线端，右端帽）
 */
export class Fuse extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.width  = Math.max(160, config.width  || 220);
        this.height = Math.max(100, config.height || 140);

        this.type    = 'fuse';
        this.special = 'none';
        this.cache   = 'fixed';

        // ── 额定参数 ──
        this.label        = config.label        || 'FU';
        this.ratedVoltage = config.ratedVoltage || 380;   // V
        this.ratedCurrent = config.ratedCurrent || 10;    // A
        // 型号：'RT14'(10×38mm) / 'RT18'(14×51mm) / 'NH'(刀形)
        this.fuseType     = config.fuseType     || 'RT14';
        // 熔丝材质：'silver'=银 / 'copper'=铜银合金
        this.wireMatl     = config.wireMatl     || 'silver';

        // ── 运行状态 ──
        this._intact      = config.initIntact !== false; // 默认完好
        this._loadCurrent = config.initCurrent || 0;     // A 当前负载电流
        // I²t 积累（0~1，达到1时熔断）
        this._i2tLevel    = 0;
        // 熔断动画状态：'normal'/'heating'/'critical'/'blowing'/'blown'
        this._fuseState   = this._intact ? 'normal' : 'blown';
        // 指示针状态
        this._indicatorOut = !this._intact;
        // 更换动画
        this._replacing   = false;
        this._replaceT    = 0;

        // ── 动画 ──
        this._glowPhase   = 0;    // 辉光动画相位
        this._arcFlash    = 0;    // 熔断弧光强度
        this._blowT       = 0;    // 熔断动画进度 0~1
        this._blowing     = false;
        this._wireBreak   = 0;    // 断口宽度（0=完整，1=完全断开）
        this._wireTremor  = 0;    // 临界颤动幅度

        this._lastTs = null;
        this._animId = null;

        // ── 几何布局 ──
        const W = this.width, H = this.height;

        // 熔断器座（底座，含两个夹座）
        this._base = {
            x: W * 0.04, y: H * 0.72,
            w: W * 0.92, h: H * 0.18,
            rx: 3,
        };

        // 左夹座（进线端）
        this._clipL = {
            cx: W * 0.175,
            y:  H * 0.28,
            w:  W * 0.12,
            h:  H * 0.44,
        };

        // 右夹座（出线端）
        this._clipR = {
            cx: W * 0.825,
            y:  H * 0.28,
            w:  W * 0.12,
            h:  H * 0.44,
        };

        // 熔芯管体（陶瓷圆管）
        this._tube = {
            x:  W * 0.175,
            cx: W * 0.500,
            y:  H * 0.30,
            w:  W * 0.650,
            h:  H * 0.40,
            rx: H * 0.20,
        };

        // 端帽（两端铜帽）
        const capW = W * 0.10;
        this._capL = { x: W * 0.175, y: H * 0.30, w: capW, h: H * 0.40, rx: H * 0.08 };
        this._capR = { x: W * 0.825 - capW, y: H * 0.30, w: capW, h: H * 0.40, rx: H * 0.08 };

        // 熔丝区域（端帽之间）
        this._wire = {
            x1: this._capL.x + capW,
            x2: this._capR.x,
            cy: H * 0.50,
            y:  H * 0.30,
            h:  H * 0.40,
        };

        // 指示针（管体顶部中央）
        this._indicator = {
            cx: W * 0.500,
            y:  H * 0.30,
        };

        this._init();

        // 端口
        this.addPort(
            this._clipL.cx,
            this._base.y + this._base.h + 4,
            'terminal_a', 'wire', 'A'
        );
        this.addPort(
            this._clipR.cx,
            this._base.y + this._base.h + 4,
            'terminal_b', 'wire', 'B'
        );
    }

    // ═══════════════════════════════════════════
    _init() {
        this._drawBase();
        this._drawClips();
        this._drawTubeShell();   // 陶瓷管外壳静态骨架

        // 动态层（Z 序从下到上）
        this._wireGroup  = new Konva.Group();  // 熔丝 + 内部效果
        this._arcGroup   = new Konva.Group();  // 弧光
        this._indicGroup = new Konva.Group();  // 指示针
        this._glowGroup  = new Konva.Group();  // 端帽辉光

        this.group.add(this._wireGroup);
        this.group.add(this._arcGroup);
        this.group.add(this._indicGroup);
        this.group.add(this._glowGroup);

        this._drawLabel();
        this._drawStatusIndicator();

        this._rebuildAll();
        this._bindInteraction();
        this._startAnimation();
    }

    // ── 熔断器座（底座）──────────────────────
    _drawBase() {
        const b = this._base, W = this.width;

        // 座体（深灰绝缘塑料）
        this.group.add(new Konva.Rect({
            x: b.x, y: b.y, width: b.w, height: b.h,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint:   { x: 0, y: b.h },
            fillLinearGradientColorStops: [
                0, '#3a3e46', 0.35, '#42464e', 1, '#2e323a',
            ],
            stroke: '#22262e', strokeWidth: 1.2,
            cornerRadius: b.rx,
            shadowColor: '#000', shadowBlur: 5,
            shadowOffsetY: 2, shadowOpacity: 0.35,
        }));
        // 座面高光
        this.group.add(new Konva.Rect({
            x: b.x + 2, y: b.y + 1,
            width: b.w - 4, height: b.h * 0.22,
            fill: 'rgba(255,255,255,0.06)',
            cornerRadius: [b.rx, b.rx, 0, 0],
        }));
        // 安装导轨孔（DIN 轨道安装孔）
        this.group.add(new Konva.Rect({
            x: b.x + b.w * 0.40, y: b.y + b.h * 0.55,
            width: b.w * 0.20, height: b.h * 0.30,
            fill: '#1a1e26', stroke: '#0e1218', strokeWidth: 0.6,
            cornerRadius: 1,
        }));
    }

    // ── 夹座（弹簧夹，固定熔芯端帽）─────────
    _drawClips() {
        const W = this.width, H = this.height;
        [this._clipL, this._clipR].forEach((cl, idx) => {
            const cx = cl.cx;

            // 夹座主体（黄铜，弹片结构）
            this.group.add(new Konva.Rect({
                x: cx - cl.w / 2, y: cl.y,
                width: cl.w, height: cl.h,
                fillLinearGradientStartPoint: { x: 0, y: 0 },
                fillLinearGradientEndPoint:   { x: cl.w, y: 0 },
                fillLinearGradientColorStops: [
                    0,   '#7a6a28',
                    0.28,'#c8a840',
                    0.55,'#e0c050',
                    0.82,'#b09030',
                    1,   '#7a6a28',
                ],
                stroke: '#5a4a18', strokeWidth: 0.8,
                cornerRadius: 2,
            }));

            // 夹口上槽（容纳端帽的凹槽）
            this.group.add(new Konva.Rect({
                x: cx - cl.w * 0.45, y: cl.y + 1,
                width: cl.w * 0.90, height: H * 0.12,
                fill: '#181a1e', stroke: '#404040', strokeWidth: 0.4,
                cornerRadius: 1,
            }));
            // 弹片（V 形弹簧线）
            this.group.add(new Konva.Line({
                points: [
                    cx - cl.w * 0.30, cl.y + H * 0.04,
                    cx,               cl.y + H * 0.09,
                    cx + cl.w * 0.30, cl.y + H * 0.04,
                ],
                stroke: '#d4a030', strokeWidth: 1.2,
                lineCap: 'round', lineJoin: 'round',
            }));

            // 接线端子（螺钉）
            const termY = cl.y + cl.h - H * 0.05;
            this.group.add(new Konva.Rect({
                x: cx - cl.w * 0.45, y: termY,
                width: cl.w * 0.90, height: H * 0.08,
                fill: '#b89030', stroke: '#8a6820', strokeWidth: 0.6, cornerRadius: 1,
            }));
            this.group.add(new Konva.Circle({
                x: cx, y: termY + H * 0.04,
                radius: cl.w * 0.22,
                fill: '#888', stroke: '#555', strokeWidth: 0.5,
            }));
            this.group.add(new Konva.Line({
                points: [cx - cl.w * 0.16, termY + H * 0.04,
                         cx + cl.w * 0.16, termY + H * 0.04],
                stroke: '#444', strokeWidth: 0.8,
            }));

            // 端子标注
            this.group.add(new Konva.Text({
                x: cx - 6, y: cl.y + cl.h + 4,
                text: idx === 0 ? 'A' : 'B',
                fontSize: 8, fill: idx === 0 ? '#ef9a9a' : '#90caf9',
                fontStyle: 'bold',
            }));
        });
    }

    // ── 陶瓷管体外壳（静态骨架）──────────────
    _drawTubeShell() {
        const t  = this._tube;
        const cL = this._capL, cR = this._capR;
        const W  = this.width, H = this.height;

        // 陶瓷管主体（乳白/米色，略透明）
        this.group.add(new Konva.Rect({
            x: t.x, y: t.y,
            width: t.w, height: t.h,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint:   { x: 0, y: t.h },
            fillLinearGradientColorStops: [
                0,   '#d8d4cc',
                0.30,'#e8e4dc',
                0.65,'#d0ccc4',
                1,   '#b8b4ac',
            ],
            stroke: '#a0a09090', strokeWidth: 0.6,
            cornerRadius: t.rx,
        }));
        // 管面高光（顶部弧面反光）
        this.group.add(new Konva.Shape({
            sceneFunc(ctx, shape) {
                ctx.beginPath();
                ctx.arc(t.x + t.w * 0.40, t.y + t.h * 0.20,
                    t.w * 0.28, Math.PI * 1.20, Math.PI * 1.80);
                ctx.strokeStyle = shape.stroke();
                ctx.lineWidth   = t.h * 0.16;
                ctx.globalAlpha = 0.22;
                ctx.stroke();
                ctx.globalAlpha = 1;
            },
            stroke: '#ffffff',
        }));
        // 管体分色带（生产日期 / 规格色标）
        [0.25, 0.75].forEach(fx => {
            this.group.add(new Konva.Line({
                points: [t.x + t.w * fx, t.y + 3,
                         t.x + t.w * fx, t.y + t.h - 3],
                stroke: 'rgba(100,90,80,0.18)', strokeWidth: 1,
            }));
        });

        // 左端帽（铜帽）
        this._drawCap(cL, 'left');
        // 右端帽（铜帽）
        this._drawCap(cR, 'right');

        // 规格印字
        this.group.add(new Konva.Text({
            x: t.x + t.w * 0.18, y: t.y + t.h * 0.58,
            width: t.w * 0.64,
            text: `${this.ratedCurrent}A  ${this.ratedVoltage}V`,
            fontSize: Math.max(6, this.width * 0.048),
            fill: '#5a5050',
            align: 'center',
            fontFamily: 'Courier New, monospace',
            fontStyle: 'bold',
        }));
        this.group.add(new Konva.Text({
            x: t.x + t.w * 0.22, y: t.y + t.h * 0.78,
            width: t.w * 0.56,
            text: this.fuseType,
            fontSize: Math.max(5, this.width * 0.038),
            fill: '#806858',
            align: 'center',
            fontFamily: 'Courier New',
        }));
    }

    _drawCap(cap, side) {
        const W = this.width;

        // 铜帽主体
        this.group.add(new Konva.Rect({
            x: cap.x, y: cap.y,
            width: cap.w, height: cap.h,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint:   { x: cap.w, y: 0 },
            fillLinearGradientColorStops: side === 'left'
                ? [0,'#5a4818',0.25,'#a87828',0.55,'#c8982a',0.80,'#9a7020',1,'#7a5818']
                : [0,'#7a5818',0.20,'#9a7020',0.45,'#c8982a',0.75,'#a87828',1,'#5a4818'],
            stroke: '#4a3810', strokeWidth: 0.8,
            cornerRadius: side === 'left'
                ? [cap.rx, 0, 0, cap.rx]
                : [0, cap.rx, cap.rx, 0],
        }));
        // 帽面高光
        this.group.add(new Konva.Rect({
            x: cap.x + 1, y: cap.y + 1,
            width: cap.w - 2, height: cap.h * 0.25,
            fill: 'rgba(255,255,255,0.12)',
            cornerRadius: side === 'left'
                ? [cap.rx, 0, 0, 0]
                : [0, cap.rx, 0, 0],
        }));
        // 帽边压圈线
        const px = side === 'left' ? cap.x + cap.w - 3 : cap.x + 3;
        this.group.add(new Konva.Line({
            points: [px, cap.y + 2, px, cap.y + cap.h - 2],
            stroke: 'rgba(0,0,0,0.20)', strokeWidth: 1.5,
        }));
    }

    // ══════════════════════════════════════════
    // ── 动态重绘 ──────────────────────────────

    _rebuildAll() {
        this._rebuildWire();
        this._rebuildArc();
        this._rebuildIndicator();
        this._rebuildCapGlow();
        this._updateStatusIndicator();
    }

    // ── 熔丝（核心动画）──────────────────────
    _rebuildWire() {
        this._wireGroup.destroyChildren();
        const wz   = this._wire;
        const W    = this.width, H = this.height;
        const lv   = this._i2tLevel;       // 0~1
        const st   = this._fuseState;
        const bk   = this._wireBreak;      // 0~1 断口进度
        const tr   = this._wireTremor;     // 临界颤动
        const ph   = this._glowPhase;

        // 透明石英砂填料层（管内背景）
        const fillAlpha = st === 'blown' ? 0.55 : 0.22 + lv * 0.15;
        this._wireGroup.add(new Konva.Rect({
            x: wz.x1, y: wz.y,
            width: wz.x2 - wz.x1, height: wz.h,
            fill: `rgba(210,195,160,${fillAlpha})`,
        }));

        // 已熔断：显示熔断痕迹（焦黑的碎屑）
        if (st === 'blown') {
            this._drawBlownWire(wz, H, ph);
            return;
        }

        // 熔丝颜色（温度映射）
        const wireColor = this._getWireColor(lv, st);

        // 熔丝线（含收缩颈设计——中段略细）
        const totalLen = wz.x2 - wz.x1;
        const segCount = 3;     // 三段：左平段 + 中段（收缩颈）+ 右平段

        // 正常/预热态：完整熔丝
        if (bk < 0.05) {
            this._drawCompletWire(wz, totalLen, lv, wireColor, tr, ph, H);
        } else {
            // 熔断动画中：断口扩大
            this._drawBreakingWire(wz, totalLen, bk, lv, wireColor, ph, H);
        }
    }

    _drawCompletWire(wz, totalLen, lv, wireColor, tr, ph, H) {
        // 熔丝主体（多股近似：3条略有偏移的线）
        const wireDiam = Math.max(1.5, H * 0.022 - lv * H * 0.008);
        const cy = wz.cy;

        // 辉光（过热时）
        if (lv > 0.15) {
            const glowW = wireDiam * (3 + lv * 4);
            this._wireGroup.add(new Konva.Rect({
                x: wz.x1, y: cy - glowW / 2,
                width: wz.x2 - wz.x1, height: glowW,
                fillLinearGradientStartPoint: { x: 0, y: 0 },
                fillLinearGradientEndPoint:   { x: wz.x2 - wz.x1, y: 0 },
                fillLinearGradientColorStops: [
                    0, 'rgba(255,120,20,0)',
                    0.35, `rgba(255,${Math.round(140 - lv * 120)},20,${lv * 0.40})`,
                    0.5,  `rgba(255,${Math.round(160 - lv * 140)},30,${lv * 0.55})`,
                    0.65, `rgba(255,${Math.round(140 - lv * 120)},20,${lv * 0.40})`,
                    1, 'rgba(255,120,20,0)',
                ],
            }));
        }

        // 收缩颈位置（中段 40%~60%）
        const neckX0 = wz.x1 + totalLen * 0.38;
        const neckX1 = wz.x1 + totalLen * 0.62;
        const neckDiam = wireDiam * (0.55 - lv * 0.10);  // 收缩颈更细

        // 主熔丝（左段到收缩颈起点）
        this._wireGroup.add(new Konva.Line({
            points: [wz.x1, cy, neckX0, cy + tr * 1.5],
            stroke: wireColor,
            strokeWidth: wireDiam,
            lineCap: 'round',
        }));
        // 收缩颈段（最热，最亮）
        const neckColor = this._getNeckColor(lv);
        this._wireGroup.add(new Konva.Line({
            points: [neckX0, cy + tr * 1.5, neckX1, cy - tr * 1.5],
            stroke: neckColor,
            strokeWidth: neckDiam,
            lineCap: 'round',
        }));
        // 收缩颈辉光（超热时）
        if (lv > 0.60) {
            const nGlowR = neckDiam * (4 + lv * 6);
            this._wireGroup.add(new Konva.Line({
                points: [neckX0, cy + tr * 1.5, neckX1, cy - tr * 1.5],
                stroke: `rgba(255,255,${Math.round(200 - lv * 180)},${lv * 0.75})`,
                strokeWidth: nGlowR,
                lineCap: 'round',
            }));
        }
        // 主熔丝（收缩颈结束到右段）
        this._wireGroup.add(new Konva.Line({
            points: [neckX1, cy - tr * 1.5, wz.x2, cy],
            stroke: wireColor,
            strokeWidth: wireDiam,
            lineCap: 'round',
        }));

        // 收缩颈顶点（小亮点）
        if (lv > 0.30) {
            const neckCX = (neckX0 + neckX1) / 2;
            const neckCY = cy + tr * 0.5 * Math.sin(ph * 4) * 0.3;
            this._wireGroup.add(new Konva.Circle({
                x: neckCX, y: neckCY,
                radius: neckDiam * (0.8 + lv * 0.6),
                fill: neckColor,
                shadowColor: neckColor,
                shadowBlur: 4 * lv,
                shadowOpacity: lv * 0.9,
            }));
        }
    }

    _drawBreakingWire(wz, totalLen, bk, lv, wireColor, ph, H) {
        // 熔断动画：断口从中段向两侧扩展
        const cy = wz.cy;
        const wireDiam = Math.max(1.0, H * 0.018);
        const neckCX = wz.x1 + totalLen * 0.50;
        const breakW  = totalLen * 0.25 * bk;   // 断口宽度

        const leftEnd  = neckCX - breakW;
        const rightEnd = neckCX + breakW;

        // 左侧残留丝
        if (leftEnd > wz.x1 + 2) {
            this._wireGroup.add(new Konva.Line({
                points: [wz.x1, cy, leftEnd, cy + (Math.random() - 0.5) * 2],
                stroke: wireColor,
                strokeWidth: wireDiam,
                lineCap: 'round',
            }));
        }
        // 右侧残留丝
        if (rightEnd < wz.x2 - 2) {
            this._wireGroup.add(new Konva.Line({
                points: [rightEnd, cy + (Math.random() - 0.5) * 2, wz.x2, cy],
                stroke: wireColor,
                strokeWidth: wireDiam,
                lineCap: 'round',
            }));
        }

        // 断口处弧光（熔断瞬间）
        if (bk < 0.6 && this._arcFlash > 0.1) {
            for (let k = 0; k < 4; k++) {
                this._wireGroup.add(new Konva.Line({
                    points: [
                        leftEnd,  cy + (Math.random() - 0.5) * H * 0.08,
                        neckCX + (Math.random() - 0.5) * breakW,
                        cy + (Math.random() - 0.5) * H * 0.12,
                        rightEnd, cy + (Math.random() - 0.5) * H * 0.08,
                    ],
                    stroke: `rgba(255,${Math.round(220 + Math.random() * 35)},80,${this._arcFlash * 0.88})`,
                    strokeWidth: 1.5 + Math.random() * 1.2,
                    tension: 0.5,
                    lineCap: 'round',
                }));
            }
        }
    }

    _drawBlownWire(wz, H, ph) {
        // 已熔断：两段焦黑残留丝 + 熔渣
        const cy   = wz.cy;
        const totalLen = wz.x2 - wz.x1;
        const neckCX   = wz.x1 + totalLen * 0.50;
        const gapW     = totalLen * 0.30;   // 最终断口宽度

        const leftEnd  = neckCX - gapW / 2;
        const rightEnd = neckCX + gapW / 2;

        // 左侧焦黑残留丝
        this._wireGroup.add(new Konva.Line({
            points: [wz.x1, cy, leftEnd, cy + 1.5],
            stroke: '#3a3030',
            strokeWidth: Math.max(1.2, H * 0.016),
            lineCap: 'round',
        }));
        // 右侧焦黑残留丝
        this._wireGroup.add(new Konva.Line({
            points: [rightEnd, cy - 1.5, wz.x2, cy],
            stroke: '#3a3030',
            strokeWidth: Math.max(1.2, H * 0.016),
            lineCap: 'round',
        }));

        // 断口处熔渣团（黑色小球）
        for (let k = 0; k < 3; k++) {
            this._wireGroup.add(new Konva.Circle({
                x: neckCX + (k - 1) * gapW * 0.18,
                y: cy + (Math.random() > 0.5 ? 2 : -2),
                radius: Math.max(1.5, H * 0.014),
                fill: '#2a2020',
                stroke: '#1a1010', strokeWidth: 0.4,
            }));
        }
        // 断口背景（石英砂暗化区）
        this._wireGroup.add(new Konva.Rect({
            x: leftEnd - 2, y: wz.y + wz.h * 0.20,
            width: gapW + 4, height: wz.h * 0.60,
            fill: 'rgba(30,20,20,0.45)',
            cornerRadius: 2,
        }));
    }

    // ── 弧光层 ───────────────────────────────
    _rebuildArc() {
        this._arcGroup.destroyChildren();
        if (this._arcFlash < 0.05) return;

        const wz  = this._wire;
        const af  = this._arcFlash;
        const nCX = wz.x1 + (wz.x2 - wz.x1) * 0.50;
        const cy  = wz.cy;
        const H   = this.height;

        // 蓝白主弧
        for (let k = 0; k < 5; k++) {
            this._arcGroup.add(new Konva.Circle({
                x: nCX + (Math.random() - 0.5) * (wz.x2 - wz.x1) * 0.12,
                y: cy + (Math.random() - 0.5) * H * 0.12,
                radius: H * 0.04 * (0.5 + Math.random() * af),
                fill: k < 2
                    ? `rgba(255,255,200,${af * 0.80})`
                    : `rgba(150,180,255,${af * 0.55})`,
            }));
        }

        // 整管闪光（极强弧光时）
        if (af > 0.65) {
            const t  = this._tube;
            this._arcGroup.add(new Konva.Rect({
                x: t.x, y: t.y,
                width: t.w, height: t.h,
                fill: `rgba(255,250,220,${(af - 0.65) * 0.55})`,
                cornerRadius: t.rx,
            }));
        }
    }

    // ── 指示针（熔断后弹出）──────────────────
    _rebuildIndicator() {
        this._indicGroup.destroyChildren();
        const ind = this._indicator;
        const W   = this.width, H = this.height;

        // 小凸起座（管顶正中）
        this._indicGroup.add(new Konva.Circle({
            x: ind.cx, y: ind.y,
            radius: W * 0.018,
            fill: '#505860', stroke: '#2a3040', strokeWidth: 0.6,
        }));

        // 指示针（熔断后弹出）
        const out = this._indicatorOut;
        const pinH = H * 0.055;
        const pinY = out ? ind.y - pinH - 2 : ind.y - pinH * 0.3;

        this._indicGroup.add(new Konva.Rect({
            x: ind.cx - W * 0.012, y: pinY,
            width: W * 0.024, height: pinH * (out ? 1.0 : 0.3),
            fill: out ? '#ef5350' : '#404858',
            stroke: out ? '#c62828' : '#202830',
            strokeWidth: 0.6,
            cornerRadius: [W * 0.012, W * 0.012, 0, 0],
            shadowColor: out ? 'rgba(255,50,30,0.70)' : 'transparent',
            shadowBlur:  out ? 6 : 0,
            shadowOpacity: 0.8,
        }));
    }

    // ── 端帽辉光（大电流时）──────────────────
    _rebuildCapGlow() {
        this._glowGroup.destroyChildren();
        const I    = this._loadCurrent;
        const In   = this.ratedCurrent;
        const hot  = Math.min(1, Math.max(0, I / In - 0.5) * 2);
        if (hot < 0.05) return;

        const lv   = this._i2tLevel;
        const ph   = this._glowPhase;
        const ga   = hot * 0.35 + lv * 0.20 + Math.sin(ph * 3) * 0.04;

        [this._capL, this._capR].forEach(cap => {
            this._glowGroup.add(new Konva.Rect({
                x: cap.x - 4, y: cap.y - 2,
                width: cap.w + 8, height: cap.h + 4,
                fillLinearGradientStartPoint: { x: 0, y: 0 },
                fillLinearGradientEndPoint:   { x: cap.w + 8, y: 0 },
                fillLinearGradientColorStops: [
                    0, `rgba(255,${Math.round(120 - lv * 100)},20,${ga * 0.8})`,
                    0.5, `rgba(255,${Math.round(140 - lv * 120)},30,${ga})`,
                    1, `rgba(255,${Math.round(120 - lv * 100)},20,${ga * 0.8})`,
                ],
                cornerRadius: cap.rx + 2,
            }));
        });
    }

    // ── 标注 ─────────────────────────────────
    _drawLabel() {
        const W = this.width;
        this.group.add(new Konva.Text({
            x: 0, y: -18, width: W,
            text: `${this.label}  熔断器`,
            fontSize: 9, fontStyle: 'bold', fill: '#546e7a',
            align: 'center', fontFamily: 'Arial, sans-serif',
        }));
        this.group.add(new Konva.Text({
            x: 0, y: -7, width: W,
            text: `${this.fuseType}  ${this.ratedCurrent}A  ${this.ratedVoltage}V  I²t特性`,
            fontSize: 7, fill: '#3a5a7a',
            align: 'center', fontFamily: 'Courier New',
        }));
    }

    // ── 状态指示（底座右侧小灯）─────────────
    _drawStatusIndicator() {
        const b  = this._base;
        const ix = b.x + b.w - 10;
        const iy = b.y + b.h / 2;

        this._statusDot = new Konva.Circle({
            x: ix, y: iy, radius: 4,
            fill:   this._intact ? '#66bb6a' : '#ef5350',
            stroke: this._intact ? '#2e7d32' : '#c62828',
            strokeWidth: 0.8,
            shadowColor: this._intact ? '#66bb6a' : '#ef5350',
            shadowBlur: this._intact ? 5 : 2,
            shadowOpacity: 0.8,
        });
        this._statusText = new Konva.Text({
            x: ix - 30, y: iy - 5,
            width: 28, text: this._intact ? '完好' : '熔断',
            fontSize: 7, fontStyle: 'bold',
            fill: this._intact ? '#66bb6a' : '#ef5350',
            align: 'right',
        });
        this.group.add(this._statusDot, this._statusText);
    }

    _updateStatusIndicator() {
        const ok = this._intact;
        if (this._statusDot) {
            this._statusDot.fill(ok ? '#66bb6a' : '#ef5350');
            this._statusDot.stroke(ok ? '#2e7d32' : '#c62828');
            this._statusDot.shadowColor(ok ? '#66bb6a' : '#ef5350');
            this._statusDot.shadowBlur(ok ? 5 : 2);
        }
        if (this._statusText) {
            this._statusText.text(ok ? '完好' : '熔断');
            this._statusText.fill(ok ? '#66bb6a' : '#ef5350');
        }
    }

    // ── 颜色辅助 ─────────────────────────────

    _getWireColor(lv, state) {
        // 白银 → 橙 → 红 → 白热
        if (this.wireMatl === 'silver') {
            if (lv < 0.30) return `rgba(${Math.round(200 + lv * 40)},${Math.round(200 + lv * 30)},${Math.round(215 - lv * 40)},0.95)`;
            if (lv < 0.60) return `rgba(255,${Math.round(200 - (lv-0.3)*3*130)},${Math.round(80 - (lv-0.3)*200)},0.97)`;
            if (lv < 0.85) return `rgba(255,${Math.round(50 - (lv-0.6)*2*50)},10,0.98)`;
            return `rgba(255,255,${Math.round(200*(lv-0.85)/0.15)},1.0)`;  // 白热
        } else {
            if (lv < 0.40) return `rgba(${Math.round(185 + lv * 50)},${Math.round(165 + lv * 40)},${Math.round(120 - lv * 80)},0.95)`;
            if (lv < 0.75) return `rgba(255,${Math.round(150 - (lv-0.4)*2.8*120)},30,0.97)`;
            return `rgba(255,${Math.round(30-(lv-0.75)*4*30)},10,0.99)`;
        }
    }

    _getNeckColor(lv) {
        // 收缩颈始终比主丝更热更亮
        const boosted = Math.min(1, lv * 1.25);
        return this._getWireColor(boosted, 'critical');
    }

    // ═══════════════════════════════════════════
    // ── 物理模型 ─────────────────────────────

    /**
     * I²t 积累模型（反时限特性）
     * dE/dt = (I/In)² - 1  （正值=加热，负值=冷却）
     * 时间常数近似：τ ≈ 3600s（In 时不熔断的安全余量）
     * 超过 In 时：dE/dt > 0，积累到 1 时熔断
     */
    _updateI2t(dt) {
        if (!this._intact || this._blowing) return;

        const I  = this._loadCurrent;
        const In = this.ratedCurrent;
        const r  = I / In;

        // 简化反时限：时间常数 τ（额定电流下约 3600s）
        const tau = 3600;
        const rate = (r * r - 1) / tau;
        this._i2tLevel = Math.max(0, Math.min(1.05, this._i2tLevel + rate * dt));

        // 状态机
        if (this._i2tLevel < 0.25) {
            this._fuseState = 'normal';
            this._wireTremor = 0;
        } else if (this._i2tLevel < 0.65) {
            this._fuseState = 'heating';
            this._wireTremor = 0;
        } else if (this._i2tLevel < 0.95) {
            this._fuseState = 'critical';
            this._wireTremor = (this._i2tLevel - 0.65) * 3 * 2;
        } else if (this._i2tLevel >= 1.0) {
            this._triggerBlow();
        }
    }

    _triggerBlow() {
        if (this._blowing || !this._intact) return;
        this._blowing   = true;
        this._arcFlash  = 1.0;
        this._fuseState = 'blowing';
    }

    _updateBlowAnimation(dt) {
        if (!this._blowing) return;

        this._blowT += dt / 0.08;  // 80ms 熔断动画

        if (this._blowT >= 1) {
            this._blowT    = 1;
            this._blowing  = false;
            this._intact   = false;
            this._fuseState      = 'blown';
            this._wireBreak      = 1;
            this._indicatorOut   = true;
            this._arcFlash       = 0;
        } else {
            // 弧光随进度衰减（先强后弱）
            const t = this._blowT;
            this._arcFlash  = t < 0.3 ? 1.0 : 1.0 - (t - 0.3) / 0.7;
            this._wireBreak = Math.min(1, t * 1.5);
        }
    }

    // ═══════════════════════════════════════════
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
        this._updateI2t(dt);
        this._updateBlowAnimation(dt);

        // 弧光衰减
        if (!this._blowing) {
            this._arcFlash = Math.max(0, this._arcFlash - dt * 5);
        }

        // 动画相位
        this._glowPhase += dt * 2.5;
        // 临界颤动
        if (this._fuseState === 'critical') {
            this._wireTremor = (this._i2tLevel - 0.65) * 3 * 2
                * (0.7 + Math.sin(ts * 0.025) * 0.3);
        }

        this._rebuildAll();
        this._refreshCache();
    }

    _bindInteraction() {
        // 点击管体可触发更换（仅在熔断状态）
        const hitRect = new Konva.Rect({
            x: this._tube.x, y: this._tube.y,
            width: this._tube.w, height: this._tube.h,
            fill: 'transparent',
        });
        this.group.add(hitRect);
        hitRect.on('click tap', () => {
            if (!this._intact) this.replace();
        });
    }

    // ═══════════════════════════════════════════
    // ── 公开 API ─────────────────────────────

    /** 设置负载电流（A） */
    setCurrent(I) {
        this._loadCurrent = Math.max(0, I);
    }

    /** 更换熔芯（熔断后复位） */
    replace() {
        if (this._intact) return;
        this._intact       = true;
        this._i2tLevel     = 0;
        this._fuseState    = 'normal';
        this._wireBreak    = 0;
        this._wireTremor   = 0;
        this._arcFlash     = 0;
        this._blowing      = false;
        this._blowT        = 0;
        this._indicatorOut = false;
        this._refreshCache();
    }

    /** 强制熔断（测试用） */
    blow() {
        if (!this._intact) return;
        this._i2tLevel = 1.0;
        this._triggerBlow();
    }

    /** 查询状态 */
    isIntact()       { return this._intact; }
    isBlown()        { return !this._intact; }
    getI2tLevel()    { return this._i2tLevel; }
    getFuseState()   { return this._fuseState; }

    update(state) {
        if (typeof state === 'number') {
            this.setCurrent(state);
        } else if (state && typeof state === 'object') {
            if (state.current !== undefined) this.setCurrent(state.current);
            if (state.replace === true)      this.replace();
            if (state.blow    === true)      this.blow();
        }
        this._refreshCache();
    }

    getConfigFields() {
        return [
            { label: '位号/名称',          key: 'label',        type: 'text'   },
            { label: '额定电压 (V)',        key: 'ratedVoltage', type: 'number' },
            { label: '额定电流 (A)',        key: 'ratedCurrent', type: 'number' },
            { label: '型号(RT14/RT18)',     key: 'fuseType',     type: 'text'   },
            { label: '熔丝材质(silver/copper)', key: 'wireMatl', type: 'text'   },
            { label: '初始电流 (A)',        key: 'initCurrent',  type: 'number' },
            { label: '初始完好(1=完好)',    key: 'initIntact',   type: 'number' },
        ];
    }

    onConfigUpdate(cfg) {
        if (cfg.label        !== undefined) this.label        = cfg.label;
        if (cfg.ratedVoltage !== undefined) this.ratedVoltage = parseFloat(cfg.ratedVoltage);
        if (cfg.ratedCurrent !== undefined) this.ratedCurrent = parseFloat(cfg.ratedCurrent);
        if (cfg.fuseType     !== undefined) this.fuseType     = cfg.fuseType;
        if (cfg.wireMatl     !== undefined) this.wireMatl     = cfg.wireMatl;
        if (cfg.initCurrent  !== undefined) this.setCurrent(parseFloat(cfg.initCurrent));
        if (cfg.initIntact   !== undefined && !parseInt(cfg.initIntact)) this.blow();
        this.config = { ...this.config, ...cfg };
        this._refreshCache();
    }

    destroy() { this._stopAnimation(); super.destroy?.(); }
}