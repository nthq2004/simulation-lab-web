import { BaseComponent } from './BaseComponent.js';

/**
 * 刀开关（闸刀开关）仿真组件
 * （Knife Switch / Blade Switch）
 *
 * ═══ 渲染优化原则 ═══════════════════════════════════════════
 *  阴影渲染需要额外的离屏 Canvas 绘制，开销极大。
 *  clearCache() + cache() 将动态组作为位图缓存，但每次调用
 *  都要重新绘制所有子图形到离屏 Canvas，反而更慢。
 *
 *  本组件遵循以下优化策略：
 *  1. 所有动态元素（刀片、手柄、指示灯等）使用 in‑place 更新
 *     — 通过 .rotation()、.fill()、.visible()、.text() 等
 *     轻量方法直接修改已有 Konva 节点属性，不在每帧销毁重建。
 *  2. 消除所有 shadow 属性（shadowColor/shadowBlur/shadowOpacity），
 *     避免触发离屏阴影渲染。
 *  3. 不调用 _refreshCache() / clearCache() + cache() — 静
 *     态部件（外框、立柱、底座等）仅保留 _staticGroup 的
 *     init‑time 位图缓存，运行时不再刷新。
 *  4. 瞬态特效（电弧）在独立子容器中重建，不干扰主体动态节点。
 * ═══════════════════════════════════════════════════════════
 *
 * ── 结构说明 ──────────────────────────────────────────────────
 *
 *  刀开关是最基本的手动隔离开关，由以下部分组成：
 *
 *  1. 底座（Base）：黑色绝缘底板，固定所有零件
 *  2. 静触头座（Fixed Contact Post）：两个黄铜立柱，固定在底座上
 *     - 左柱：进线端（A 端）
 *     - 右柱：出线端（B 端）
 *  3. 刀片（Blade / Contact Arm）：黄铜扁条，以左柱为转轴旋转
 *     - 合闸（Closed）：刀片插入右柱的夹口，电路导通
 *     - 分闸（Open）：刀片抬起，电路断开
 *  4. 手柄（Handle）：刀片末端的红色绝缘操作柄
 *  5. 紧固螺钉：底座固定件
 *
 * ── 动作逻辑 ──────────────────────────────────────────────────
 *
 *  分闸：刀片以左柱顶端为转轴，向上抬起约 45°（斜置状态）
 *  合闸：刀片水平落下，插入右柱夹口（水平状态）
 *
 *  动作过程带平滑动画（可配置时长，正弦缓动）
 *
 * ── 视角说明 ──────────────────────────────────────────────────
 *
 *  参考图片采用等轴测（Isometric）透视，
 *  本组件简化为正视图（Front View）二维仿真，保留所有细节特征：
 *  底座、两柱、刀片、手柄、螺钉、接线端子
 *
 * ── 端口 ─────────────────────────────────────────────────────
 *  l — l 端（进线端，左柱底部）
 *  r — r 端（出线端，右柱底部）
 *
 * ── 可配置参数 ────────────────────────────────────────────────
 *  label          : 位号（默认 'QS'）
 *  ratedVoltage   : 额定电压 V（默认 380）
 *  ratedCurrent   : 额定电流 A（默认 60）
 *  initClosed     : 初始状态是否闭合（默认 false）
 *  animDur        : 动画时长 s（默认 0.15）
 */
export class KnifeSwitch extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.width = Math.max(160, config.width || 200);
        this.height = Math.max(120, config.height || 160);

        this.type = 'switch';
        this.special = 'none';
        this.cache = 'fixed';   // 

        /** _initGroups()在BaseComponent中定义，    
        * 初始化三层次分组
        *   _staticGroup   — 静态视觉元素（绘制一次，可缓存）
        *   _dynamicGroup  — 动态元素（每 tick 重建）
        *   _interactGroup — 交互层（点击/悬停，不缓存）
        */
        this._initGroups();
        // 计算各个组件的几何尺寸和位置
        this._recalcGeometry();

        this._initParameters(config);

        this._init();

        this.config ={ id: this.id,'label': this.label, 'ratedVoltage': this.ratedVoltage, 'ratedCurrent': this.ratedCurrent, 'initClosed': this._closed, 'animDur': this._animDur};

        // 端口
        this.addPort(
            this._portA.x, this._portA.y,
            'l', 'wire', 'p'
        );
        this.addPort(
            this._portB.x, this._portB.y,
            'r', 'wire'
        );
    }

    // ═══════════════════════════════════════════
    // 几何尺寸计算
    // ═══════════════════════════════════════════

    _recalcGeometry() {
        const W = this.width, H = this.height;

        // 底座
        this._base = {
            x: W * 0.05, y: H * 0.68,
            w: W * 0.90, h: H * 0.20,
            rx: Math.max(2, W * 0.015),
        };

        // 左柱（转轴柱，进线端）
        this._postL = {
            x: W * 0.20, y: H * 0.30,
            w: W * 0.14, h: H * 0.38,
        };

        // 右柱（夹口柱，出线端）
        this._postR = {
            x: W * 0.66, y: H * 0.30,
            w: W * 0.14, h: H * 0.38,
        };

        // 刀片转轴点（左柱顶端中心）
        this._pivot = {
            x: this._postL.x + this._postL.w / 2,
            y: this._postL.y + 2,
        };

        // 刀片长度（从转轴到手柄末端）
        this._bladeLen = (this._postR.x + this._postR.w / 2 - this._pivot.x) * 1.40;
        this._bladeW = H * 0.065;  // 刀片厚度

        // 手柄长度（占刀片末端 30%）
        this._handleLen = this._bladeLen * 0.28;
        this._handleW = this._bladeW * 1.6;

        // 夹口槽位置
        this._clampSlotPos = {
            x: this._postR.x + this._postR.w * 0.15,
            y: this._postR.y + 2,
            w: this._postR.w * 0.70,
            h: this._postR.h * 0.18,
        };

        // 端口位置
        this._portA = {
            x: this._postL.x + this._postL.w / 2,
            y: this._base.y + this._base.h + 4,
        };
        this._portB = {
            x: this._postR.x + this._postR.w / 2,
            y: this._base.y + this._base.h + 4,
        };

        // 螺钉位置
        this._screwPositions = [
            { x: this._postL.x + this._postL.w / 2, y: this._base.y + this._base.h * 0.50 },
            { x: this._postR.x + this._postR.w / 2, y: this._base.y + this._base.h * 0.50 },
        ];
    }


    _initParameters(config) {
        // ── 额定参数 ──
        this.ratedVoltage = config.ratedVoltage || 380;   // V
        this.ratedCurrent = config.ratedCurrent || 60;    // A
        this.label        = config.label        || 'QS';  // 位号

        // ── 状态 ──
        this._closed      = config.initClosed !== undefined ? config.initClosed : false; // 默认断开
        this._animating   = false;
        this._animT       = 0;        // 动画进度 0~1
        this._animDir     = 1;        // +1 = 闭合方向，-1 = 断开方向
        this._bladeAngle  = this._closed ? 0 : 45; // °（0=水平=合闸，45=斜置=分闸）
        this._arcFrames   = 0;        // 电弧持续帧数

        // 操作计数
        this.opsCount     = config.initOps || 0;

        // 动画参数
        this._animDur = config.animDur !== undefined ? config.animDur : 0.15; //
        this._animJustEnded = false;        
    }

    // ═══════════════════════════════════════════
    // 初始化
    // ═══════════════════════════════════════════

    _init() {
        this._drawStaticParts();
        this._bindInteraction();
        this._createDynamicNodes();
    }

    // ═══════════════════════════════════════════
    // 静态部件（只绘制一次）
    // ═══════════════════════════════════════════

    _drawStaticParts() {
        this._drawBase();
        this._drawBaseShadows();
        this._drawScrews();
        this._drawPostLeft();
        this._drawPostRight();
        this._drawClampSlotBase();
        this._drawLabel();
        this._drawTerminalLabels();
        this._drawStatusIndicatorBase();
    }

    // 底座主体
    _drawBase() {
        const b = this._base;
        this._staticGroup.add(new Konva.Rect({
            x: b.x, y: b.y, width: b.w, height: b.h,
            fill: '#d5cec5', stroke: '#b0a698', strokeWidth: 1.5,
            cornerRadius: b.rx,
        }));
    }

    // 底座立体感阴影
    _drawBaseShadows() {
        const b = this._base;
        // 底座顶面高光
        this._staticGroup.add(new Konva.Rect({
            x: b.x + 2, y: b.y + 2, width: b.w - 4, height: b.h * 0.25,
            fill: 'rgba(255,255,255,0.20)',
            cornerRadius: [b.rx, b.rx, 0, 0],
        }));
        // 底座侧边阴影
        this._staticGroup.add(new Konva.Rect({
            x: b.x, y: b.y + b.h * 0.75, width: b.w, height: b.h * 0.25,
            fill: 'rgba(0,0,0,0.12)',
            cornerRadius: [0, 0, b.rx, b.rx],
        }));
    }

    // 固定螺钉
    _drawScrews() {
        this._screwPositions.forEach(({ x, y }) => {
            const r = this.width * 0.030;
            // 螺钉外圈
            this._staticGroup.add(new Konva.Circle({
                x, y, radius: r,
                fill: '#9a8e80', stroke: '#7a6a58', strokeWidth: 0.8,
            }));
            // 一字槽（十字交叉）
            this._staticGroup.add(new Konva.Line({
                points: [x - r * 0.6, y, x + r * 0.6, y],
                stroke: '#7a6a58', strokeWidth: 1.2, lineCap: 'round',
            }));
            this._staticGroup.add(new Konva.Line({
                points: [x, y - r * 0.6, x, y + r * 0.6],
                stroke: '#7a6a58', strokeWidth: 1.2, lineCap: 'round',
            }));
        });
    }

    // 左柱（转轴柱）
    _drawPostLeft() {
        this._drawPost(this._postL, true);
    }

    // 右柱（夹口柱）
    _drawPostRight() {
        this._drawPost(this._postR, false);
    }

    // 通用立柱绘制
    _drawPost(p, isLeft) {
        // 立柱主体（黄铜色渐变）
        this._staticGroup.add(new Konva.Rect({
            x: p.x, y: p.y, width: p.w, height: p.h,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint: { x: p.w, y: 0 },
            fillLinearGradientColorStops: [
                0, '#7a6a30',
                0.25, '#c8a84b',
                0.55, '#e8c86a',
                0.80, '#b89040',
                1, '#7a6a30',
            ],
            stroke: '#6a5a28', strokeWidth: 1,
            cornerRadius: 2,
        }));

        // 立柱顶部横档（绕线固定台）
        this._staticGroup.add(new Konva.Rect({
            x: p.x - p.w * 0.15, y: p.y,
            width: p.w * 1.30, height: p.h * 0.14,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint: { x: p.w * 1.30, y: 0 },
            fillLinearGradientColorStops: [0, '#8a7030', 0.5, '#d4aa52', 1, '#8a7030'],
            stroke: '#6a5a28', strokeWidth: 0.8, cornerRadius: 2,
        }));

        // 接线螺柱（柱底）
        const termY = p.y + p.h - p.h * 0.04;
        this._staticGroup.add(new Konva.Rect({
            x: p.x + p.w * 0.10, y: termY,
            width: p.w * 0.80, height: p.h * 0.10,
            fill: '#b8982a', stroke: '#8a7020', strokeWidth: 0.8, cornerRadius: 1,
        }));

        // 立柱高光
        this._staticGroup.add(new Konva.Line({
            points: [p.x + p.w * 0.30, p.y + 4, p.x + p.w * 0.30, p.y + p.h - 8],
            stroke: 'rgba(255,255,255,0.18)', strokeWidth: 2, lineCap: 'round',
        }));
    }

    // 夹口槽底座（静态部分）
    _drawClampSlotBase() {
        const s = this._clampSlotPos;
        this._staticGroup.add(new Konva.Rect({
            x: s.x, y: s.y, width: s.w, height: s.h,
            fill: '#b8b0a0', stroke: '#7a6a58', strokeWidth: 0.5,
            cornerRadius: 1,
        }));
    }

    // 位号与铭牌
    _drawLabel() {
        this._staticGroup.add(new Konva.Text({
            x: 0, y: -16, width: this.width,
            text: `${this.label}  ${this.ratedVoltage}V / ${this.ratedCurrent}A`,
            fontSize: Math.max(7, this.width * 0.045),
            fontStyle: 'bold', fill: '#5a6a7a', align: 'center',
        }));
    }

    // 端子标注
    _drawTerminalLabels() {
        this._staticGroup.add(new Konva.Text({
            x: this._postL.x - 2, y: this._base.y + this._base.h + 5,
            text: 'A', fontSize: Math.max(6, this.width * 0.04),
            fill: '#ef9a9a', fontStyle: 'bold',
        }));
        this._staticGroup.add(new Konva.Text({
            x: this._postR.x + this._postR.w - 8, y: this._base.y + this._base.h + 5,
            text: 'B', fontSize: Math.max(6, this.width * 0.04),
            fill: '#90caf9', fontStyle: 'bold',
        }));
    }

    // 状态指示灯底座
    _drawStatusIndicatorBase() {
        const ix = this._base.x + 8;
        const iy = this._base.y + this._base.h / 2;
        const dotR = Math.max(3, this.width * 0.020);

        // 指示灯背景（暗圈）
        this._staticGroup.add(new Konva.Circle({
            x: ix, y: iy, radius: dotR + 2,
            fill: '#c8c0b8', stroke: '#a89888', strokeWidth: 0.5,
        }));
    }

    // ═══════════════════════════════════════════
    // 动态层（一次性创建，每帧 in‑place 更新）
    // ═══════════════════════════════════════════

    /** 创建所有动态节点（只调用一次） */
    _createDynamicNodes() {
        // 刀片 + 手柄组（仅旋转角度变化）
        this._createBladeHandleGroup();

        // 夹口槽高光
        this._clampSlotGlow = new Konva.Rect({
            x: this._clampSlotPos.x, y: this._clampSlotPos.y,
            width: this._clampSlotPos.w, height: this._clampSlotPos.h,
            fill: 'rgba(255,160,30,0.28)',
            cornerRadius: 2,
            visible: this._bladeAngle < 5,
        });
        this._dynamicGroup.add(this._clampSlotGlow);

        // 状态指示灯圆点 + 文字
        const ix = this._base.x + 8;
        const iy = this._base.y + this._base.h / 2;
        const dotR = Math.max(3, this.width * 0.020);
        const closed = this._isEffectivelyClosed();
        this._statusDot = new Konva.Circle({
            x: ix, y: iy, radius: dotR,
            fill: closed ? '#66bb6a' : '#ef5350',
            stroke: closed ? '#388e3c' : '#d32f2f',
            strokeWidth: 0.8,
        });
        this._statusLabel = new Konva.Text({
            x: ix + dotR + 3, y: iy - dotR,
            text: closed ? '合' : '分',
            fontSize: Math.max(6, this.width * 0.040),
            fontStyle: 'bold',
            fill: closed ? '#66bb6a' : '#ef5350',
        });
        this._dynamicGroup.add(this._statusDot);
        this._dynamicGroup.add(this._statusLabel);

        // 电弧容器（仅在合/分闸瞬间重建内容）
        this._arcGroup = new Konva.Group();
        this._dynamicGroup.add(this._arcGroup);
    }

    /** 刀片 + 手柄旋转组（一次性创建，仅 rotation 变化） */
    _createBladeHandleGroup() {
        const px = this._pivot.x, py = this._pivot.y;
        const bLen = this._bladeLen;
        const bW = this._bladeW;
        const hLen = this._handleLen;
        const hW = this._handleW;

        this._bladeHandleGroup = new Konva.Group({
            x: px, y: py,
            rotation: this._bladeAngle * (-1),
        });

        // 刀片（黄铜扁条）
        this._bladeHandleGroup.add(new Konva.Rect({
            x: 0, y: -bW / 2,
            width: bLen - hLen, height: bW,
            fillLinearGradientStartPoint: { x: 0, y: -bW / 2 },
            fillLinearGradientEndPoint: { x: 0, y: bW / 2 },
            fillLinearGradientColorStops: [
                0, '#8a7530',
                0.3, '#d4b050',
                0.55, '#f0cc68',
                0.75, '#c4a040',
                1, '#8a7530',
            ],
            stroke: '#7a6528', strokeWidth: 0.8,
            cornerRadius: [2, 0, 0, 2],
        }));

        // 手柄（红色绝缘柄）
        this._bladeHandleGroup.add(new Konva.Rect({
            x: bLen - hLen, y: -hW / 2,
            width: hLen, height: hW,
            fill: '#c83020',
            stroke: '#a02018', strokeWidth: 0.8,
            cornerRadius: [0, 6, 6, 0],
        }));

        // 手柄高光
        this._bladeHandleGroup.add(new Konva.Rect({
            x: bLen - hLen + 4, y: -hW / 2 + 2,
            width: hLen - 8, height: hW * 0.30,
            fill: 'rgba(255,255,255,0.18)',
            cornerRadius: [0, 4, 0, 0],
        }));

        // 手柄末端圆帽
        this._bladeHandleGroup.add(new Konva.Circle({
            x: bLen - hLen / 8, y: 0,
            radius: hW * 0.52,
            fill: '#c82818', stroke: '#a02010', strokeWidth: 0.8,
        }));

        // 根部固定块
        this._bladeHandleGroup.add(new Konva.Rect({
            x: -bW * 0.3, y: -bW * 0.9,
            width: bW * 1.6, height: bW * 1.8,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint: { x: bW * 1.6, y: 0 },
            fillLinearGradientColorStops: [0, '#7a6528', 0.5, '#d4b050', 1, '#7a6528'],
            stroke: '#6a5520', strokeWidth: 0.8, cornerRadius: 2,
        }));

        // 导通发光（合闸时刀片周围橙光）
        if (this._bladeAngle < 5) {
            this._bladeHandleGroup.add(new Konva.Rect({
                x: -2, y: -bW / 2 - 3,
                width: bLen - hLen + 4, height: bW + 6,
                fill: 'rgba(255,160,30,0.18)',
                cornerRadius: 3,
            }));
        }

        this._dynamicGroup.add(this._bladeHandleGroup);
    }

    /** 每帧 in‑place 更新动态节点属性 */
    _updateDynamic() {
        const closed = this._bladeAngle < 5;
        const effectivelyClosed = this._isEffectivelyClosed();

        // 1) 刀片旋转
        this._bladeHandleGroup.rotation(this._bladeAngle * (-1));

        // 2) 夹口槽高光可见性
        this._clampSlotGlow.visible(closed);

        // 3) 状态指示灯颜色
        this._statusDot.fill(effectivelyClosed ? '#66bb6a' : '#ef5350');
        this._statusDot.stroke(effectivelyClosed ? '#388e3c' : '#d32f2f');
        this._statusLabel.text(effectivelyClosed ? '合' : '分');
        this._statusLabel.fill(effectivelyClosed ? '#66bb6a' : '#ef5350');

        // 4) 电弧（瞬态，在子容器中重建）
        this._arcGroup.destroyChildren();
        if (this._arcFrames > 0) {
            this._drawArcInGroup(this._arcGroup);
        }
    }

    /** 电弧效果（在指定容器中绘制，仅在合/分闸瞬间调用） */
    _drawArcInGroup(group) {
        const px = this._pivot.x;
        const py = this._pivot.y;
        const bLen = this._bladeLen;
        const bW = this._bladeW;

        for (let i = 0; i < 4; i++) {
            const spread = (Math.random() - 0.5) * bW * 3;
            group.add(new Konva.Line({
                points: [
                    px + 4, py + spread * 0.3,
                    px + bLen * 0.30 + Math.random() * 8, py + spread,
                    px + bLen * 0.45, py + spread * 0.5,
                ],
                stroke: `rgba(255,${180 + Math.round(Math.random() * 75)},60,${0.5 + Math.random() * 0.4})`,
                strokeWidth: 1 + Math.random() * 0.8,
                lineJoin: 'round', lineCap: 'round',
                listening: false,
            }));
        }
    }

    // ═══════════════════════════════════════════
    // 交互绑定
    // ═══════════════════════════════════════════

    _bindInteraction() {
        // 创建一个透明的点击区域覆盖刀片区域
        const hitArea = new Konva.Rect({
            x: this._pivot.x - 10,
            y: this._pivot.y - this._bladeLen,
            width: this._bladeLen + 20,
            height: this._bladeLen + 20,
            fill: 'transparent',
        });

        hitArea.on('click tap', () => this.toggle());
        this._interactGroup.add(hitArea);
    }

    // ═══════════════════════════════════════════
    // tick（20fps）
    // ═══════════════════════════════════════════

    tick(dt) {
        this._tickAnimation(dt);

        if (this._arcFrames > 0) {
            this._arcFrames--;
        }

        // 动态更新：仅当有变化时才修改节点属性，不触发阴影/离屏缓存
        if (this._animating || this._arcFrames > 0 || this._animJustEnded) {
            this._animJustEnded = false;
            this._updateDynamic();
            this.markDirty();
        }

        this._refreshIfDirty();
    }

    // 动画更新
    _tickAnimation(dt) {
        if (!this._animating) return;

        this._animT += dt / this._animDur;
        if (this._animT >= 1) {
            this._animT = 1;
            this._animating = false;
            this._animJustEnded = true; // 通知 tick 做最后一次重建
            this._closed = this._animDir > 0;
        }

        // 正弦缓动（ease in-out）
        const ease = 0.5 - 0.5 * Math.cos(this._animT * Math.PI);

        // 角度：分闸=45°，合闸=0°
        if (this._animDir > 0) {
            // 合闸：45° → 0°
            const prevAngle = this._bladeAngle;
            this._bladeAngle = 45 * (1 - ease);
            // 检测合闸瞬间（角度经过 10° 时产生电弧）
            if (prevAngle > 10 && this._bladeAngle <= 10) {
                this._arcFrames = 3;
            }
        } else {
            // 分闸：0° → 45°
            const prevAngle = this._bladeAngle;
            this._bladeAngle = 45 * ease;
            // 检测分闸瞬间（角度经过 10° 时产生电弧）
            if (prevAngle < 10 && this._bladeAngle >= 10) {
                this._arcFrames = 3;
            }
        }
    }

    // 判断是否有效闭合（考虑动画中间状态）
    _isEffectivelyClosed() {
        // 动画中如果正在向闭合方向运动且角度小于15°，视为有效闭合
        if (this._animating && this._animDir > 0 && this._bladeAngle < 15) {
            return true;
        }
        return this._closed;
    }

    // ═══════════════════════════════════════════
    // 公开 API
    // ═══════════════════════════════════════════

    /** 切换开关状态 */
    toggle() {
        if (this._animating) return;
        this._animDir = this._closed ? -1 : 1;
        this._animT = 0;
        this._animating = true;
        this.opsCount++;
    }

    /** 合闸 */
    close() {
        if (this._closed || this._animating) return;
        this._animDir = 1;
        this._animT = 0;
        this._animating = true;
        this.opsCount++;
    }

    /** 分闸 */
    open() {
        if (!this._closed || this._animating) return;
        this._animDir = -1;
        this._animT = 0;
        this._animating = true;
        this.opsCount++;
    }

    /** 查询当前状态 */
    isClosed() { return this._closed; }
    isAnimating() { return this._animating; }
    getOpsCount() { return this.opsCount; }

    update(state) {
        if (typeof state === 'boolean') {
            state ? this.close() : this.open();
        }
    }

    getConfigFields() {
        return [
            { label: '位号/名称', key: 'label', type: 'text' },
            { label: '额定电压 (V)', key: 'ratedVoltage', type: 'number' },
            { label: '额定电流 (A)', key: 'ratedCurrent', type: 'number' },
            { label: '初始状态（合=1）', key: 'initClosed', type: 'number' },
            { label: '动作时间 (s)', key: 'animDur', type: 'number' },
        ];
    }

    onConfigUpdate(cfg) {
        if (cfg.label !== undefined) this.label = cfg.label;
        if (cfg.ratedVoltage !== undefined) this.ratedVoltage = parseFloat(cfg.ratedVoltage);
        if (cfg.ratedCurrent !== undefined) this.ratedCurrent = parseFloat(cfg.ratedCurrent);
        if (cfg.animDur !== undefined) this._animDur = parseFloat(cfg.animDur);

        if (cfg.initClosed !== undefined) {
            const wantClosed = !!parseInt(cfg.initClosed);
            if (wantClosed !== this._closed) {
                this.toggle();
            }
        }

        this.config = { ...this.config, ...cfg };
        this._recalcGeometry();
        this._dynamicGroup.destroyChildren();
        this._createDynamicNodes();
        this._refreshCache();
    }

    destroy() {
        super.destroy?.();
    }
}