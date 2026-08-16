import { BaseComponent } from './BaseComponent.js';

/**
 * 单刀四掷开关（SP4T Switch）仿真组件
 * （Single-Pole 4-Throw Switch）
 *
 * ═══ 渲染优化原则 ═══════════════════════════════════════════
 *  遵循的优化策略：
 *  1. 动态元素（操作手柄、刀片、触点高光）使用 in-place 更新
 *  2. 消除所有 shadow 属性，避免离屏阴影渲染
 *  3. 静态部件（外框、绝缘座、接线柱等）仅在 init 时缓存
 *  4. 电弧特效在独立 _arcGroup 中重建，不干扰主体动态节点
 * ═══════════════════════════════════════════════════════════
 *
 * ── 结构说明 ──────────────────────────────────────────────────
 *
 *  左半区：操作手柄区（物理操作侧）
 *    - 手柄圆盘：可拨动的旋转手柄，在 4 个档位之间切换
 *    - 手柄拨杆：指示当前档位方向
 *    - 指针刻度弧：显示档位范围（T1~T4，从左上到右上）
 *
 *  右半区：电路原理图区（IEC 图形符号）
 *    - 公共端（COM）：下方接线柱，刀片的转轴端
 *    - 触点1~4（T1~T4）：上方从左到右分布的静触头
 *    - 可动刀片：以公共端为转轴，在 T1~T4 之间摆动
 *
 * ── 动作逻辑 ──────────────────────────────────────────────────
 *
 *  点击手柄圆盘：切换到下一档位（T1→T2→T3→T4→T1）
 *  手柄拨杆角度与刀片角度同步正弦缓动动画
 *  电弧在刀片接触目标触头瞬间产生
 *
 * ── 视角说明 ──────────────────────────────────────────────────
 *
 *  组件分为左右两个面板：
 *    左侧：操作手柄（物理开关形象，含拨盘、拨杆、刻度）
 *    右侧：电路原理图（IEC 标准图形符号，含接线柱、刀片、触点）
 *  两者同步联动，直观展示手柄动作与电路状态的对应关系
 *
 * ── 端口 ─────────────────────────────────────────────────────
 *  com — 公共端（COM），刀片转轴侧，居中下方
 *  t1  — 触点1（上方偏左）
 *  t2  — 触点2（左中）
 *  t3  — 触点3（右中）
 *  t4  — 触点4（上方偏右）
 *
 * ── 可配置参数 ────────────────────────────────────────────────
 *  label          : 位号（默认 'SA'）
 *  ratedVoltage   : 额定电压 V（默认 250）
 *  ratedCurrent   : 额定电流 A（默认 10）
 *  initPosition   : 初始档位 1~4（默认 1）
 *  animDur        : 动画时长 s（默认 0.06）
 */
export class SP4TSwitch extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.width  = Math.max(220, config.width  || 280);
        this.height = Math.max(75,  config.height || 110);

        this.type    = 'SPNT';
        this.special = 'SP4T';
        this.cache   = 'fixed';

        this._initGroups();
        this._recalcGeometry();
        this._initParameters(config);
        this._init();

        this.config = {
            id: this.id,
            label:        this.label,
            ratedVoltage: this.ratedVoltage,
            ratedCurrent: this.ratedCurrent,
            initPosition: this._position,
            animDur:      this._animDur,
        };

        // ── 端口 ──────────────────────────────
        // COM 端（公共端，刀片转轴侧，下方居中）
        this.addPort(this._portCOM.x, this._portCOM.y, 'com', 'wire', 'p');
        // T1 端（左上触头）
        this.addPort(this._portT1.x,  this._portT1.y,  't1',  'wire');
        // T2 端（左中上触头）
        this.addPort(this._portT2.x,  this._portT2.y,  't2',  'wire');
        // T3 端（右中上触头）
        this.addPort(this._portT3.x,  this._portT3.y,  't3',  'wire');
        // T4 端（右上触头）
        this.addPort(this._portT4.x,  this._portT4.y,  't4',  'wire');
    }

    // ═══════════════════════════════════════════
    // 几何尺寸计算
    // ═══════════════════════════════════════════

    _recalcGeometry() {
        const W = this.width, H = this.height;

        // 分割线：左半为手柄区，右半为原理图区
        this._divX = W * 0.48;

        // ── 外框 ──
        this._frame = { x: 2, y: 2, w: W - 4, h: H - 4, rx: 6 };

        // ── 左侧手柄区几何 ──────────────────────────
        // 手柄圆盘中心
        this._knobCenter = { x: W * 0.22, y: H * 0.60 };
        this._knobR      = Math.min(W * 0.20, H * 0.35);  // 外圆半径
        this._knobInnerR = this._knobR * 0.45;             // 内圆半径

        // 手柄拨杆长度（从圆心到端点）
        this._leverLen = this._knobR * 0.85;

        // 4个档位角度（Konva 坐标系，0°=右，逆时针）
        // 从左上到右上均匀分布
        this._leverAngles = [180, 240, 300, 360];

        // 刻度弧半径（略大于外圆）
        this._arcR = this._knobR * 1.20;

        // ── 右侧电路原理图区几何 ───────────────────
        const rLeft = this._divX + W * 0.03;  // 原理图区左边界
        const rW    = W - rLeft - W * 0.04;   // 原理图区宽度
        const rH    = H * 0.65;               // 原理图区垂直范围
        const rTop  = H * 0.15;               // 顶部 Y

        // 公共端接线柱（下方居中，刀片转轴）
        this._schemCOM = {
            x: rLeft + rW * 0.50,
            y: rTop + rH * 0.85,
        };

        // 4个触头接线柱（上方从左到右）
        const tPositions = [
            { frac: 0.08 },   // T1 (最左)
            { frac: 0.38 },   // T2 (左中)
            { frac: 0.68 },   // T3 (右中)
            { frac: 0.98 },   // T4 (最右)
        ];

        this._schemT = tPositions.map(p => ({
            x: rLeft + rW * p.frac,
            y: rTop - 10,
        }));

        // 接线柱半径
        this._termR = Math.max(5, W * 0.022);

        // 刀片长度（从 COM 到触头的平均距离 * 系数）
        const dx = this._schemT[0].x - this._schemCOM.x;
        const dy = this._schemT[0].y - this._schemCOM.y;
        this._bladeLen = Math.sqrt(dx * dx + dy * dy) * 0.95;

        // 刀片角度（由几何计算）
        this._bladeAngles = this._schemT.map(t =>
            Math.atan2(
                t.y - this._schemCOM.y,
                t.x - this._schemCOM.x
            ) * 180 / Math.PI
        );

        // 刀片厚度
        this._bladeW = Math.max(6, H * 0.028);

        // ── 端口位置（组件外部接线用）──────────────
        this._portCOM = { x: this._schemCOM.x, y: H - 2 };
        this._schemT.forEach((t, i) => {
            this[`_portT${i + 1}`] = { x: t.x, y: 2 };
        });

        // 标签位置
        this._labelPos = { x: 0, y: -16, w: W };
    }

    // ═══════════════════════════════════════════
    // 参数初始化
    // ═══════════════════════════════════════════

    _initParameters(config) {
        this.ratedVoltage = config.ratedVoltage !== undefined ? config.ratedVoltage : 250;
        this.ratedCurrent = config.ratedCurrent !== undefined ? config.ratedCurrent : 10;
        this.label        = config.label        || 'SA';
        this.function = config.function != undefined?config.function:'单刀四掷';
        this.labelNames = config.labelNames || ['T1', 'T2', 'T3', 'T4'];

        // 档位：1~4
        const initPos = parseInt(config.initPosition) || 1;
        this._position = Math.max(1, Math.min(4, initPos));

        this._animating   = false;
        this._animT       = 0;
        this._animFromPos = this._position;
        this._animToPos   = this._position;

        // 当前刀片角度（度）
        this._curBladeAngle = this._bladeAngles[this._position - 1];
        // 当前手柄拨杆角度（度）
        this._curLeverAngle = this._leverAngles[this._position - 1];

        this._arcFrames     = 0;
        this._animDur       = config.animDur !== undefined ? config.animDur : 0.06;
        this._animJustEnded = false;

        // 操作计数
        this.opsCount = config.initOps || 0;
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
        this._drawFrame();
        this._drawDivider();
        this._drawKnobBase();
        this._drawKnobArc();
        this._drawSchematicStatic();
        this._drawLabel();
        this._drawTerminalLabels();
    }

    /** 外框 */
    _drawFrame() {
        const f = this._frame;
        this._staticGroup.add(new Konva.Rect({
            x: f.x, y: f.y, width: f.w, height: f.h,
            fill: '#dee0eb',
            stroke: '#b0a698',
            strokeWidth: 1.5,
            cornerRadius: f.rx,
        }));
        this._staticGroup.add(new Konva.Rect({
            x: f.x + 2, y: f.y + 2, width: f.w - 4, height: f.h * 0.12,
            fill: 'rgba(132, 164, 246, 0.2)',
            cornerRadius: [f.rx, f.rx, 0, 0],
        }));
    }

    /** 左右区域分隔线 */
    _drawDivider() {
        this._staticGroup.add(new Konva.Line({
            points: [this._divX, this._frame.y + 8, this._divX, this._frame.y + this._frame.h - 8],
            stroke: '#b0a698',
            strokeWidth: 1,
            dash: [4, 4],
        }));
        this._staticGroup.add(new Konva.Text({
            x: this._frame.x + 4,
            y: this._frame.y - 14,
            text: this.function,
            fontSize: Math.max(12, this.width * 0.030),
            fill: '#5a6a7a',
        }));
    }

    /** 手柄圆盘底座（静态同心圆） */
    _drawKnobBase() {
        const cx = this._knobCenter.x, cy = this._knobCenter.y;
        const R  = this._knobR;

        this._staticGroup.add(new Konva.Circle({
            x: cx, y: cy, radius: R,
            fill: '#6d706d',
            stroke: '#9a8e80',
            strokeWidth: 1.5,
        }));

        this._staticGroup.add(new Konva.Ring({
            x: cx, y: cy,
            innerRadius: R - 4,
            outerRadius: R,
            fill: '#fae5bd',
        }));
    }

    /** 手柄区刻度弧（T1~T4 范围的扇形弧线） */
    _drawKnobArc() {
        const cx  = this._knobCenter.x, cy = this._knobCenter.y;
        const R   = this._arcR;
        const a1  = this._leverAngles[0] * Math.PI / 180;
        const a4  = this._leverAngles[3] * Math.PI / 180;

        const pts = [];
        const steps = 30;
        for (let i = 0; i <= steps; i++) {
            const a = a1 + (a4 - a1) * (i / steps);
            pts.push(cx + R * Math.cos(a), cy + R * Math.sin(a));
        }

        this._staticGroup.add(new Konva.Line({
            points: pts,
            stroke: '#9a8e80',
            strokeWidth: 1.5,
            lineCap: 'round',
            lineJoin: 'round',
            listening: false,
        }));

        // 刻度线 + 档位标注
        const labelNames = this.labelNames;
        const labelR = R + 12;
        this._leverAngles.forEach((deg, i) => {
            const rad = deg * Math.PI / 180;
            this._staticGroup.add(new Konva.Line({
                points: [
                    cx + (R - 5) * Math.cos(rad), cy + (R - 5) * Math.sin(rad),
                    cx + (R + 5) * Math.cos(rad), cy + (R + 5) * Math.sin(rad),
                ],
                stroke: '#8a7a68', strokeWidth: 1.2, lineCap: 'round',
            }));
            this._staticGroup.add(new Konva.Text({
                x: cx + labelR * Math.cos(rad) - 8,
                y: cy + labelR * Math.sin(rad) - 6,
                text: labelNames[i],
                fontSize: Math.max(12, this.width * 0.034),
                fontStyle: 'bold',
                fill: '#090909',
            }));
        });
    }

    /** 原理图区静态元素：接线柱、固定连接线 */
    _drawSchematicStatic() {
        this._drawTerminalPost(this._schemCOM, 'COM');
        this._schemT.forEach((t, i) => this._drawTerminalPost(t, `T${i + 1}`));

        const comX = this._schemCOM.x;
        const R    = this._termR;

        // COM 向下引出（到底边端口）
        this._staticGroup.add(new Konva.Line({
            points: [comX, this._schemCOM.y + R, comX, this.height - 2],
            stroke: '#097aeb', strokeWidth: 3,
        }));

        // T1~T4 向上引出（到顶边端口）
        this._schemT.forEach(t => {
            this._staticGroup.add(new Konva.Line({
                points: [t.x, t.y - R, t.x, 2],
                stroke: '#097aeb', strokeWidth: 3,
            }));
        });
    }

    /** 绘制单个接线柱（圆柱 + 螺纹装饰） */
    _drawTerminalPost(pos, name) {
        const R = this._termR;
        const { x, y } = pos;

        this._staticGroup.add(new Konva.Circle({
            x, y, radius: R,
            fillLinearGradientStartPoint: { x: -R, y: -R },
            fillLinearGradientEndPoint:   { x:  R, y:  R },
            fillLinearGradientColorStops: [
                0,    '#7a6a30',
                0.4,  '#d4aa52',
                0.7,  '#e8c86a',
                1,    '#8a7030',
            ],
            stroke: '#6a5a28', strokeWidth: 1,
        }));
        this._staticGroup.add(new Konva.Circle({
            x, y, radius: R * 0.40,
            fill: '#2a1a08',
            stroke: '#5a4a20', strokeWidth: 0.6,
        }));
        this._staticGroup.add(new Konva.Line({
            points: [x - R * 0.55, y, x + R * 0.55, y],
            stroke: '#3a2a10', strokeWidth: 1, lineCap: 'round',
        }));
    }

    /** 位号铭牌 */
    _drawLabel() {
    }

    /** 端子字母标注 */
    _drawTerminalLabels() {
        const fs = Math.max(12, this.width * 0.038);
        const names = ['T1', 'T2', 'T3', 'T4'];
        const colors = ['#fa0703', '#037207', '#037207', '#0a1af7'];

        // COM 标注（下方，接线柱旁）
        this._staticGroup.add(new Konva.Text({
            x: this._schemCOM.x - this._termR - 22,
            y: this._schemCOM.y + 4,
            text: 'COM', fontSize: fs, fontStyle: 'bold', fill: '#fa0703',
        }));

        // T1~T4 标注
        this._schemT.forEach((t, i) => {
            const dx = i < 2 ? -this._termR - 22 : this._termR + 4;
            this._staticGroup.add(new Konva.Text({
                x: t.x + dx,
                y: t.y - fs / 2 - 1,
                text: names[i], fontSize: fs, fontStyle: 'bold', fill: colors[i],
            }));
        });
    }

    // ═══════════════════════════════════════════
    // 动态层（一次性创建，每帧 in-place 更新）
    // ═══════════════════════════════════════════

    _createDynamicNodes() {
        this._createLeverGroup();
        this._createBladeGroup();
        this._createContactGlows();
        this._arcGroup = new Konva.Group({ listening: false });
        this._dynamicGroup.add(this._arcGroup);
    }

    /** 手柄拨杆组（绕手柄中心旋转） */
    _createLeverGroup() {
        const cx  = this._knobCenter.x, cy = this._knobCenter.y;
        const R   = this._knobR;
        const Ri  = this._knobInnerR;

        this._leverGroup = new Konva.Group({
            x: cx, y: cy,
            rotation: this._curLeverAngle,
        });

        this._leverGroup.add(new Konva.Rect({
            x: Ri * 0.20, y: -this._bladeW * 0.5,
            width: this._leverLen - Ri * 0.20,
            height: this._bladeW,
            fill: '#faf6f6',
            stroke: '#a02018', strokeWidth: 1.2,
            cornerRadius: [0, 4, 4, 0],
        }));

        this._leverGroup.add(new Konva.Rect({
            x: Ri * 0.20 + 2, y: -this._bladeW * 0.5 + 1,
            width: this._leverLen - Ri * 0.20 - 8,
            height: this._bladeW * 0.30,
            fill: 'rgba(255,255,255,0.18)',
            cornerRadius: [0, 3, 0, 0],
        }));

        this._dynamicGroup.add(this._leverGroup);
    }

    /** 刀片组（绕 COM 接线柱中心旋转） */
    _createBladeGroup() {
        const px = this._schemCOM.x;
        const py = this._schemCOM.y;
        const bLen = this._bladeLen;
        const bW   = this._bladeW;

        this._bladeGroup = new Konva.Group({
            x: px, y: py,
            rotation: this._curBladeAngle,
        });

        this._bladeGroup.add(new Konva.Rect({
            x: this._termR * 0.8, y: -bW / 2,
            width: bLen - this._termR * 0.8,
            height: bW,
            fillLinearGradientStartPoint: { x: 0, y: -bW / 2 },
            fillLinearGradientEndPoint:   { x: 0, y:  bW / 2 },
            fillLinearGradientColorStops: [
                0,    '#8a7530',
                0.3,  '#d4b050',
                0.55, '#f0cc68',
                0.75, '#c4a040',
                1,    '#8a7530',
            ],
            stroke: '#7a6528', strokeWidth: 0.8,
            cornerRadius: [0, 3, 3, 0],
        }));

        this._bladeGroup.add(new Konva.Line({
            points: [
                this._termR * 0.8 + 4, -bW * 0.25,
                bLen - 6,             -bW * 0.25,
            ],
            stroke: 'rgba(255,255,255,0.18)',
            strokeWidth: 1,
            lineCap: 'round',
        }));

        this._dynamicGroup.add(this._bladeGroup);
    }

    /** 触点高光（仅在接通的触头上显示橙色发光） */
    _createContactGlows() {
        const R    = this._termR;
        const pos  = this._position - 1;

        this._glows = this._schemT.map((t, i) => {
            const g = new Konva.Circle({
                x: t.x, y: t.y,
                radius: R * 1.5,
                fill: 'rgba(255,160,30,0.28)',
                visible: (!this._animating && i === pos),
                listening: false,
            });
            this._dynamicGroup.add(g);
            return g;
        });
    }

    // ═══════════════════════════════════════════
    // 动态更新（每帧 in-place）
    // ═══════════════════════════════════════════

    _updateDynamic() {
        // 1) 手柄拨杆旋转
        this._leverGroup.rotation(((this._curLeverAngle % 360) + 360) % 360);

        // 2) 刀片旋转
        this._bladeGroup.rotation(((this._curBladeAngle % 360) + 360) % 360);

        // 3) 触点高光：仅在完全到达（非动画中）时显示
        const posIdx = this._position - 1;
        this._glows.forEach((g, i) => {
            g.visible(!this._animating && i === posIdx);
        });

        // 4) 电弧（瞬态）
        this._arcGroup.destroyChildren();
        if (this._arcFrames > 0) {
            this._drawArcInGroup(this._arcGroup);
        }
    }

    /** 电弧效果（在到达触头瞬间绘制） */
    _drawArcInGroup(group) {
        const target = this._schemT[this._animToPos - 1];
        const px = target.x, py = target.y;
        const bLen = this._bladeLen;

        for (let i = 0; i < 4; i++) {
            const spread = (Math.random() - 0.5) * this._termR * 4;
            group.add(new Konva.Line({
                points: [
                    px - bLen * 0.08 + Math.random() * 4, py + spread * 0.3,
                    px - bLen * 0.04 + Math.random() * 8, py + spread,
                    px, py + spread * 0.2,
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
        const cx  = this._knobCenter.x, cy = this._knobCenter.y;
        const R   = this._knobR;

        const hitArea = new Konva.Circle({
            x: cx, y: cy,
            radius: R + 10,
            fill: 'transparent',
        });

        hitArea.on('click tap', (e) => {
            if (this._animating) return;
            const stage = this.group.getStage();
            if (!stage) return;
            const pointer = stage.getPointerPosition();
            if (!pointer) return;

            const tr = this.group.getTransform().copy();
            tr.invert();
            const local = tr.point(pointer);
            const dx = local.x - cx, dy = local.y - cy;
            const clickAngle = ((Math.atan2(dy, dx) * 180 / Math.PI) + 360) % 360;

            const curAngle = this._leverAngles[this._position - 1];
            let diff = clickAngle - curAngle;
            if (diff > 180) diff -= 360;
            else if (diff < -180) diff += 360;

            if (diff > 0) this.toggleNext();
            else          this.togglePrev();
        });
        hitArea.on('mouseenter', () => { document.body.style.cursor = 'pointer'; });
        hitArea.on('mouseleave', () => { document.body.style.cursor = 'default'; });

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

        if (this._animating || this._arcFrames > 0 || this._animJustEnded) {
            this._animJustEnded = false;
            this._updateDynamic();
            this.markDirty();
        }

        this._refreshIfDirty();
    }

    /** 动画插值更新 */
    _tickAnimation(dt) {
        if (!this._animating) return;

        this._animT += dt / this._animDur;
        if (this._animT >= 1) {
            this._animT       = 1;
            this._animating   = false;
            this._animJustEnded = true;
            this._position    = this._animToPos;
            // 将角度归一化到 0~360
            this._curBladeAngle = ((this._curBladeAngle % 360) + 360) % 360;
            this._curLeverAngle = ((this._curLeverAngle % 360) + 360) % 360;
        }

        const ease = 0.5 - 0.5 * Math.cos(this._animT * Math.PI);

        const fromBlade = this._bladeAngles[this._animFromPos - 1];
        const toBlade   = this._bladeAngles[this._animToPos  - 1];
        const fromLever = this._leverAngles[this._animFromPos - 1];
        const toLever   = this._leverAngles[this._animToPos  - 1];

        // 环绕处理：当直接插值跨越中间档位时（角度差 >= 180°），
        // 加/减 360° 使拨杆走另一侧路径，避免扫过中间档位
        let toBladeAdj = toBlade;
        let toLeverAdj = toLever;
        const diff = toLever - fromLever;
        if (diff >= 180) {
            toLeverAdj -= 360;
            toBladeAdj -= 360;
        } else if (diff <= -180) {
            toLeverAdj += 360;
            toBladeAdj += 360;
        }

        this._curBladeAngle = fromBlade + (toBladeAdj - fromBlade) * ease;
        this._curLeverAngle = fromLever + (toLeverAdj - fromLever) * ease;

        if (this._animT > 0.85 && this._arcFrames === 0) {
            this._arcFrames = 3;
        }
    }

    // ═══════════════════════════════════════════
    // 公开 API
    // ═══════════════════════════════════════════

    /** 循环切换到下一档位（T1→T2→T3→T4→T1） */
    toggleNext() {
        if (this._animating) return;
        const next = (this._position % 4) + 1;
        this._startSwitch(next);
    }

    /** 循环切换到上一档位（T1→T4→T3→T2→T1） */
    togglePrev() {
        if (this._animating) return;
        const prev = ((this._position - 2 + 4) % 4) + 1;
        this._startSwitch(prev);
    }

    /** 直接切换到指定档位（1~4） */
    switchTo(pos) {
        pos = Math.max(1, Math.min(4, parseInt(pos)));
        if (this._animating || pos === this._position) return;
        this._startSwitch(pos);
    }

    _startSwitch(toPos) {
        this._animFromPos = this._position;
        this._animToPos   = toPos;
        this._animT       = 0;
        this._animating   = true;
        this.opsCount++;
    }

    /** 查询当前档位（1~4） */
    getPosition()  { return this._position; }
    isAnimating()  { return this._animating; }
    getOpsCount()  { return this.opsCount; }

    update(state) {
        const pos = parseInt(state);
        if (pos >= 1 && pos <= 4) this.switchTo(pos);
    }

    getConfigFields() {
        return [
            { label: '位号/名称',         key: 'label',        type: 'text'   },
            { label: '额定电压 (V)',       key: 'ratedVoltage', type: 'number' },
            { label: '额定电流 (A)',       key: 'ratedCurrent', type: 'number' },
            { label: '初始档位（1~4）',    key: 'initPosition', type: 'number' },
            { label: '动作时间 (s)',       key: 'animDur',      type: 'number' },
        ];
    }

    onConfigUpdate(cfg) {
        if (cfg.label        !== undefined) this.label        = cfg.label;
        if (cfg.ratedVoltage !== undefined) this.ratedVoltage = parseFloat(cfg.ratedVoltage);
        if (cfg.ratedCurrent !== undefined) this.ratedCurrent = parseFloat(cfg.ratedCurrent);
        if (cfg.animDur      !== undefined) this._animDur     = parseFloat(cfg.animDur);

        if (cfg.initPosition !== undefined) {
            const want = Math.max(1, Math.min(4, parseInt(cfg.initPosition)));
            if (want !== this._position) this.switchTo(want);
        }

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
