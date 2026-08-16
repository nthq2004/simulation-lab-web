import { BaseComponent } from './BaseComponent.js';

/**
 * 刀开关（闸刀开关）仿真组件
 * （Knife Switch / Blade Switch）
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

        this.width  = Math.max(160, config.width  || 200);
        this.height = Math.max(120, config.height || 160);

        this.type    = 'knife_switch';
        this.special = 'none';
        this.cache   = 'fixed';   // 

        // ── 额定参数 ──
        this.ratedVoltage = config.ratedVoltage || 380;   // V
        this.ratedCurrent = config.ratedCurrent || 60;    // A
        this.label        = config.label        || 'QS';  // 位号

        // ── 状态 ──f
        this._closed      = config.initClosed !== undefined ? conig.initClosed : false; // 默认断开
        this._animating   = false;
        this._animT       = 0;        // 动画进度 0~1
        this._animDir     = 1;        // +1 = 闭合方向，-1 = 断开方向 s
        this._bladeAngle  = this._closed ? 0 : 45; // °（0=水平=合闸，45=斜置=分闸）
        this._arcFrames   = 0;        // 电弧持续帧数

        // 操作计数
        this.opsCount     = config.initOps || 0;

        this._recalcGeometry();
        this._init();
        this._animDur     = config.animDur !== undefined ? config.animDur : 0.15; //

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
        this._bladeW   = H * 0.065;  // 刀片厚度

        // 手柄长度（占刀片末端 30%）
        this._handleLen = this._bladeLen * 0.28;
        this._handleW   = this._bladeW * 1.6;

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

    // ═══════════════════════════════════════════
    // 初始化
    // ═══════════════════════════════════════════

    _init() {
        // 静态层
        this._staticGroup = new Konva.Group();
        this.group.add(this._staticGroup);
        this._drawStaticParts();

        // 动态层
        this._dynamicGroup = new Konva.Group();
        this.group.add(this._dynamicGroup);

        // 交互层
        this._interactGroup = new Konva.Group();
        this.group.add(this._interactGroup);
        this._bindInteraction();

        this._rebuildDynamic();
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
            fill: '#2a2a2e', stroke: '#3a3a40', strokeWidth: 1.5,
            cornerRadius: b.rx,
            shadowColor: '#000', shadowBlur: 4,
            shadowOffsetY: 2, shadowOpacity: 0.3,
        }));
    }

    // 底座立体感阴影
    _drawBaseShadows() {
        const b = this._base;
        // 底座顶面高光
        this._staticGroup.add(new Konva.Rect({
            x: b.x + 2, y: b.y + 2, width: b.w - 4, height: b.h * 0.25,
            fill: 'rgba(255,255,255,0.06)',
            cornerRadius: [b.rx, b.rx, 0, 0],
        }));
        // 底座侧边阴影
        this._staticGroup.add(new Konva.Rect({
            x: b.x, y: b.y + b.h * 0.75, width: b.w, height: b.h * 0.25,
            fill: 'rgba(0,0,0,0.25)',
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
                fill: '#888', stroke: '#555', strokeWidth: 0.8,
            }));
            // 一字槽（十字交叉）
            this._staticGroup.add(new Konva.Line({
                points: [x - r * 0.6, y, x + r * 0.6, y],
                stroke: '#444', strokeWidth: 1.2, lineCap: 'round',
            }));
            this._staticGroup.add(new Konva.Line({
                points: [x, y - r * 0.6, x, y + r * 0.6],
                stroke: '#444', strokeWidth: 1.2, lineCap: 'round',
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
            fillLinearGradientEndPoint:   { x: p.w, y: 0 },
            fillLinearGradientColorStops: [
                0,   '#7a6a30',
                0.25,'#c8a84b',
                0.55,'#e8c86a',
                0.80,'#b89040',
                1,   '#7a6a30',
            ],
            stroke: '#6a5a28', strokeWidth: 1,
            cornerRadius: 2,
        }));

        // 立柱顶部横档（绕线固定台）
        this._staticGroup.add(new Konva.Rect({
            x: p.x - p.w * 0.15, y: p.y,
            width: p.w * 1.30, height: p.h * 0.14,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint:   { x: p.w * 1.30, y: 0 },
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
            fill: '#1a1a1a', stroke: '#555', strokeWidth: 0.5,
            cornerRadius: 1,
        }));
    }

    // 位号与铭牌
    _drawLabel() {
        this._staticGroup.add(new Konva.Text({
            x: 0, y: -16, width: this.width,
            text: `${this.label}  ${this.ratedVoltage}V / ${this.ratedCurrent}A`,
            fontSize: Math.max(7, this.width * 0.045),
            fontStyle: 'bold', fill: '#546e7a', align: 'center',
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
            fill: '#1a1a1e', stroke: '#3a3a40', strokeWidth: 0.5,
        }));
    }

    // ═══════════════════════════════════════════
    // 动态层重建（每 tick 调用）
    // ═══════════════════════════════════════════

    _rebuildDynamic() {
        this._dynamicGroup.destroyChildren();

        this._drawBladeAndHandle();
        this._drawClampSlotGlow();
        this._drawArcEffect();
        this._drawStatusIndicator();
    }

    // 刀片 + 手柄（动态旋转）
    _drawBladeAndHandle() {
        const angle  = this._bladeAngle;  // °，0=水平，45=抬起
        const px     = this._pivot.x;
        const py     = this._pivot.y;
        const bLen   = this._bladeLen;
        const bW     = this._bladeW;
        const hLen   = this._handleLen;
        const hW     = this._handleW;
        const closed = angle < 5;

        // 创建旋转组
        const bladeGroup = new Konva.Group({
            x: px, y: py,
            rotation: angle * (-1),  // 负号：向上为负角
        });

        // ── 刀片（黄铜扁条）──
        const blade = new Konva.Rect({
            x: 0, y: -bW / 2,
            width: bLen - hLen, height: bW,
            fillLinearGradientStartPoint: { x: 0, y: -bW / 2 },
            fillLinearGradientEndPoint:   { x: 0, y: bW / 2 },
            fillLinearGradientColorStops: [
                0,   '#8a7530',
                0.3, '#d4b050',
                0.55,'#f0cc68',
                0.75,'#c4a040',
                1,   '#8a7530',
            ],
            stroke: '#7a6528', strokeWidth: 0.8,
            cornerRadius: [2, 0, 0, 2],
        });

        // ── 手柄（红色绝缘柄）──
        const handle = new Konva.Rect({
            x: bLen - hLen, y: -hW / 2,
            width: hLen, height: hW,
            fill: '#c8220a',
            stroke: '#8a1506', strokeWidth: 0.8,
            cornerRadius: [0, 6, 6, 0],
            shadowColor: '#600', shadowBlur: 3, shadowOpacity: 0.4,
        });

        // 手柄高光
        const handleHL = new Konva.Rect({
            x: bLen - hLen + 4, y: -hW / 2 + 2,
            width: hLen - 8, height: hW * 0.30,
            fill: 'rgba(255,255,255,0.15)',
            cornerRadius: [0, 4, 0, 0],
        });

        // 手柄末端圆帽
        const endCap = new Konva.Circle({
            x: bLen - hLen / 8, y: 0,
            radius: hW * 0.52,
            fill: '#b01a06', stroke: '#8a1506', strokeWidth: 0.8,
        });

        // ── 刀片根部固定块（与左柱连接）──
        const rootBlock = new Konva.Rect({
            x: -bW * 0.3, y: -bW * 0.9,
            width: bW * 1.6, height: bW * 1.8,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint:   { x: bW * 1.6, y: 0 },
            fillLinearGradientColorStops: [0, '#7a6528', 0.5, '#d4b050', 1, '#7a6528'],
            stroke: '#6a5520', strokeWidth: 0.8, cornerRadius: 2,
        });

        // ── 导通状态发光（合闸时刀片发橙光）──
        if (closed) {
            bladeGroup.add(new Konva.Rect({
                x: -2, y: -bW / 2 - 3,
                width: bLen - hLen + 4, height: bW + 6,
                fill: 'rgba(255,160,30,0.18)',
                cornerRadius: 3,
            }));
        }

        bladeGroup.add(blade, handle, handleHL, endCap, rootBlock);
        this._dynamicGroup.add(bladeGroup);
    }

    // 夹口槽合闸高光
    _drawClampSlotGlow() {
        const closed = this._bladeAngle < 5;
        if (closed) {
            const s = this._clampSlotPos;
            this._dynamicGroup.add(new Konva.Rect({
                x: s.x, y: s.y, width: s.w, height: s.h,
                fill: 'rgba(255,160,30,0.28)',
                cornerRadius: 2,
            }));
        }
    }

    // 电弧效果（分合闸瞬间）
    _drawArcEffect() {
        if (this._arcFrames <= 0) return;

        const px = this._pivot.x;
        const py = this._pivot.y;
        const bLen = this._bladeLen;
        const bW = this._bladeW;

        for (let i = 0; i < 4; i++) {
            const spread = (Math.random() - 0.5) * bW * 3;
            this._dynamicGroup.add(new Konva.Line({
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

    // 状态指示灯（动态更新）
    _drawStatusIndicator() {
        const ix = this._base.x + 8;
        const iy = this._base.y + this._base.h / 2;
        const dotR = Math.max(3, this.width * 0.020);
        const isClosed = this._isEffectivelyClosed();

        // 指示灯
        this._dynamicGroup.add(new Konva.Circle({
            x: ix, y: iy, radius: dotR,
            fill: isClosed ? '#66bb6a' : '#ef5350',
            stroke: isClosed ? '#2e7d32' : '#c62828',
            strokeWidth: 0.8,
            shadowColor: isClosed ? '#66bb6a' : '#ef5350',
            shadowBlur: isClosed ? 5 : 2,
            shadowOpacity: 0.8,
        }));

        // 状态文字
        this._dynamicGroup.add(new Konva.Text({
            x: ix + dotR + 3, y: iy - dotR,
            text: isClosed ? '合' : '分',
            fontSize: Math.max(6, this.width * 0.040),
            fontStyle: 'bold',
            fill: isClosed ? '#66bb6a' : '#ef5350',
        }));
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

        this._rebuildDynamic();
        this._refreshCache();
    }

    // 动画更新
    _tickAnimation(dt) {
        if (!this._animating) return;

        this._animT += dt / this._animDur;
        if (this._animT >= 1) {
            this._animT = 1;
            this._animating = false;
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
    // 辅助函数
    // ═══════════════════════════════════════════

    _syncPorts() {
        const portA = this.ports?.find(p => p.id === 'l');
        const portB = this.ports?.find(p => p.id === 'r');
        if (portA) {
            portA.x = this._portA.x;
            portA.y = this._portA.y;
        }
        if (portB) {
            portB.x = this._portB.x;
            portB.y = this._portB.y;
        }
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
        this._refreshCache();
    }

    /** 合闸 */
    close() {
        if (this._closed || this._animating) return;
        this._animDir = 1;
        this._animT = 0;
        this._animating = true;
        this.opsCount++;
        this._refreshCache();
    }

    /** 分闸 */
    open() {
        if (!this._closed || this._animating) return;
        this._animDir = -1;
        this._animT = 0;
        this._animating = true;
        this.opsCount++;
        this._refreshCache();
    }

    /** 查询当前状态 */
    isClosed()    { return this._closed; }
    isAnimating() { return this._animating; }
    getOpsCount() { return this.opsCount; }

    update(state) {
        if (typeof state === 'boolean') {
            state ? this.close() : this.open();
        }
        this._refreshCache();
    }

    getConfigFields() {
        return [
            { label: '位号/名称',       key: 'label',         type: 'text'   },
            { label: '额定电压 (V)',     key: 'ratedVoltage',  type: 'number' },
            { label: '额定电流 (A)',     key: 'ratedCurrent',  type: 'number' },
            { label: '初始状态（合=1）', key: 'initClosed',    type: 'number' },
            { label: '动作时间 (s)',     key: 'animDur',       type: 'number' },
        ];
    }

    onConfigUpdate(cfg) {
        if (cfg.label !== undefined)        this.label = cfg.label;
        if (cfg.ratedVoltage !== undefined) this.ratedVoltage = parseFloat(cfg.ratedVoltage);
        if (cfg.ratedCurrent !== undefined) this.ratedCurrent = parseFloat(cfg.ratedCurrent);
        if (cfg.animDur !== undefined)      this._animDur = parseFloat(cfg.animDur);

        if (cfg.initClosed !== undefined) {
            const wantClosed = !!parseInt(cfg.initClosed);
            if (wantClosed !== this._closed) {
                this.toggle();
            }
        }

        this.config = { ...this.config, ...cfg };
        this._recalcGeometry();
        this._refreshCache();
    }

    destroy() {
        super.destroy?.();
    }
}