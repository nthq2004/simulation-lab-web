import { BaseComponent } from './BaseComponent.js';

/**
 * 单刀双掷开关（SPDT Switch）仿真组件
 * （Single-Pole Double-Throw Switch）
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
 *    - 手柄圆盘：可拨动的旋转手柄，在"左"/"右"两档之间切换
 *    - 手柄拨杆：指示当前档位方向
 *    - 指针刻度弧：显示档位范围
 *
 *  右半区：电路原理图区（IEC/ANSI 单刀双掷图形符号）
 *    - 公共端（COM）：下方接线柱，刀片的转轴端
 *    - 触点1（T1）：左上方静触头，对应手柄"左"档
 *    - 触点2（T2）：右上方静触头，对应手柄"右"档
 *    - 可动刀片：以公共端为转轴，在 T1/T2 之间摆动
 *
 * ── 动作逻辑 ──────────────────────────────────────────────────
 *
 *  手柄拨向左 → 刀片摆向 T1（左上方静触头）→ COM-T1 导通
 *  手柄拨向右 → 刀片摆向 T2（右上方静触头）→ COM-T2 导通
 *
 *  点击手柄区域触发切换，带正弦缓动动画
 *  刀片与手柄同步运动，电弧在触点接触瞬间产生
 *
 * ── 视角说明 ──────────────────────────────────────────────────
 *
 *  组件分为左右两个面板：
 *    左侧：操作手柄（物理开关形象，含拨盘、拨杆、刻度）
 *    右侧：电路原理图（IEC 标准图形符号，含接线柱、刀片、触点）
 *  两者同步联动，直观展示手柄动作与电路状态的对应关系
 *
 * ── 方向说明 ──────────────────────────────────────────────────
 *
 *  direction = 'normal'（默认）：
 *    - COM 触点在下，T1/T2 触点在左上/右上
 *    - 手柄拨向左 → 刀片摆向 T1（左上），COM-T1 导通
 *    手柄拨向右 → 刀片摆向 T2（右上），COM-T2 导通
 *
 *  direction = 'reverse'：
 *    - COM 触点在上，T1/T2 触点在左下/右下
 *    - 手柄拨向左 → 刀片摆向 T1（左下），COM-T1 导通
 *    手柄拨向右 → 刀片摆向 T2（右下），COM-T2 导通
 *
 * ── 端口 ─────────────────────────────────────────────────────
 *  com — 公共端（COM），刀片转轴侧，居中下方
 *  t1  — 触点1（左上触头）
 *  t2  — 触点2（右上触头）
 *
 * ── 可配置参数 ────────────────────────────────────────────────
 *  label          : 位号（默认 'SA'）
 *  ratedVoltage   : 额定电压 V（默认 250）
 *  ratedCurrent   : 额定电流 A（默认 10）
 *  initPosition   : 初始档位 1=T1（左），2=T2（右）（默认 1）
 *  animDur        : 动画时长 s（默认 0.18）
 *  direction      : 方向 'normal'（COM下，T1/T2上）或 'reverse'（COM上，T1/T2下）（默认 'normal'）
 */
export class SPDTSwitch extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.width  = Math.max(170, config.width  || 200);
        this.height = Math.max(75,  config.height || 85);

        this.type    = 'SPNT';
        this.special = 'SPDT';
        this.cache   = 'fixed';

        /** _initGroups() 在 BaseComponent 中定义，初始化三层分组
         *   _staticGroup   — 静态视觉元素（绘制一次，可缓存）
         *   _dynamicGroup  — 动态元素（每 tick in-place 更新）
         *   _interactGroup — 交互层（点击/悬停，不缓存）
         */
        this._initGroups();
        this._direction = config.direction === 'reverse' ? 'reverse' : 'normal';
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
            direction:    this._direction,
        };

        // ── 端口 ──────────────────────────────
        this.addPort(this._portCOM.x, this._portCOM.y, 'com', 'wire', 'p');
        this.addPort(this._portT1.x,  this._portT1.y,  't1',  'wire');
        this.addPort(this._portT2.x,  this._portT2.y,  't2',  'wire');
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
        // 档位角度：左档（T1）= 225°，右档（T2）= 315°（Konva 坐标系，0°=右，逆时针）
        this._angleT1 = 225;  // 左上
        this._angleT2 = 315;  // 右上

        // 刻度弧半径（略大于外圆）
        this._arcR = this._knobR * 1.20;

        // ── 右侧电路原理图区几何 ───────────────────
        const rLeft = this._divX + W * 0.03;  // 原理图区左边界
        const rW    = W - rLeft - W * 0.04;   // 原理图区宽度
        const rH    = H * 0.65;               // 原理图区垂直范围
        const rTop  = H * 0.15;               // 顶部 Y

        const isRev = this._direction === 'reverse';

        if (isRev) {
            this._schemCOM = {
                x: rLeft + rW * 0.50,
                y: rTop - 10,
            };
            this._schemT1 = {
                x: rLeft + rW * 0.20,
                y: rTop + rH * 0.85,
            };
            this._schemT2 = {
                x: rLeft + rW * 0.80,
                y: rTop + rH * 0.85,
            };
        } else {
            this._schemCOM = {
                x: rLeft + rW * 0.50,
                y: rTop + rH * 0.85,
            };
            this._schemT1 = {
                x: rLeft + rW * 0.20,
                y: rTop-10,
            };
            this._schemT2 = {
                x: rLeft + rW * 0.80,
                y: rTop-10,
            };
        }

        // 接线柱半径
        this._termR = Math.max(5, W * 0.022);

        // 刀片长度（从 COM 到触头的距离 * 系数）
        const dx = this._schemT1.x - this._schemCOM.x;
        const dyT1 = this._schemT1.y - this._schemCOM.y;
        this._bladeLen = Math.sqrt(dx * dx + dyT1 * dyT1) * 0.95;

        // 刀片到 T1 的角度（度）—— 转轴在 COM，刀片末端朝向触头
        this._bladeAngleT1 = Math.atan2(
            this._schemT1.y - this._schemCOM.y,
            this._schemT1.x - this._schemCOM.x
        ) * 180 / Math.PI;

        // 刀片到 T2 的角度（度）
        this._bladeAngleT2 = Math.atan2(
            this._schemT2.y - this._schemCOM.y,
            this._schemT2.x - this._schemCOM.x
        ) * 180 / Math.PI;

        // 刀片厚度
        this._bladeW = Math.max(6, H * 0.028);

        // ── 端口位置（组件外部接线用）──────────────
        if (isRev) {
            this._portCOM = { x: this._schemCOM.x, y: 2 };
            this._portT1  = { x: this._schemT1.x,  y: H - 2 };
            this._portT2  = { x: this._schemT2.x,  y: H - 2 };
        } else {
            this._portCOM = { x: this._schemCOM.x, y: H - 2 };
            this._portT1  = { x: this._schemT1.x,  y: 2 };
            this._portT2  = { x: this._schemT2.x,  y: 2 };
        }

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
        this.function = config.function != undefined?config.function:'单刀双掷';
        this.T1Label = config.T1Label || 'T1';
        this.T2Label = config.T2Label || 'T2';

        this._direction = config.direction === 'reverse' ? 'reverse' : 'normal';

        // 档位：1=T1（左），2=T2（右）
        this._position    = (config.initPosition === 2) ? 2 : 1;
        this._animating   = false;
        this._animT       = 0;
        this._animDir     = 1;  // +1 = 向T1，-1 = 向T2

        // 当前刀片角度（度）：插值在 bladeAngleT1 ~ bladeAngleT2 之间
        this._curBladeAngle = (this._position === 1)
            ? this._bladeAngleT1
            : this._bladeAngleT2;

        // 当前手柄拨杆角度（度，相对水平向右）
        this._curLeverAngle = (this._position === 1)
            ? this._angleT1
            : this._angleT2;

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
    // 静态部件（只绘制一次）
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
        // 主框体
        this._staticGroup.add(new Konva.Rect({
            x: f.x, y: f.y, width: f.w, height: f.h,
            fill: '#dee0eb',
            stroke: '#b0a698',
            strokeWidth: 1.5,
            cornerRadius: f.rx,
        }));
        // 顶部高光
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
        // 左侧区域标注
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

        // 外圆背板（浅色面板）
        this._staticGroup.add(new Konva.Circle({
            x: cx, y: cy, radius: R,
            fill: '#6d706d',
            stroke: '#9a8e80',
            strokeWidth: 1.5,
        }));

        // 外圆装饰环（金属感）
        this._staticGroup.add(new Konva.Ring({
            x: cx, y: cy,
            innerRadius: R - 4,
            outerRadius: R,
            fill: '#fae5bd',
        }));

    }

    /** 手柄区刻度弧（T1~T2 范围的扇形弧线） */
    _drawKnobArc() {
        const cx  = this._knobCenter.x, cy = this._knobCenter.y;
        const R   = this._arcR;
        const a1  = this._angleT1 * Math.PI / 180;
        const a2  = this._angleT2 * Math.PI / 180;

        // 生成弧线点集
        const pts = [];
        const steps = 20;
        for (let i = 0; i <= steps; i++) {
            const a = a1 + (a2 - a1) * (i / steps);
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

        // 弧线端点小竖线（刻度线）
        [a1, a2].forEach(a => {
            const tx0 = cx + (R - 5) * Math.cos(a);
            const ty0 = cy + (R - 5) * Math.sin(a);
            const tx1 = cx + (R + 5) * Math.cos(a);
            const ty1 = cy + (R + 5) * Math.sin(a);
            this._staticGroup.add(new Konva.Line({
                points: [tx0, ty0, tx1, ty1],
                stroke: '#8a7a68',
                strokeWidth: 1.2,
                lineCap: 'round',
            }));
        });

        // 档位标注
        const labelR = R + 12;
        const labelsInfo = [
            { deg: this._angleT1, text: this.T1Label },
            { deg: this._angleT2, text: this.T2Label },
        ];
        labelsInfo.forEach(({ deg, text }) => {
            const rad = deg * Math.PI / 180;
            this._staticGroup.add(new Konva.Text({
                x: cx + labelR * Math.cos(rad) - 8,
                y: cy + labelR * Math.sin(rad) - 6,
                text,
                fontSize: Math.max(12, this.width * 0.034),
                fontStyle: 'bold',
                fill: '#090909',
            }));
        });
    }

    /** 原理图区静态元素：接线柱、固定连接线、端子底座 */
    _drawSchematicStatic() {
        this._drawTerminalPost(this._schemCOM, 'COM');
        this._drawTerminalPost(this._schemT1,  'T1');
        this._drawTerminalPost(this._schemT2,  'T2');

        // COM 至底边、T1/T2 至顶边的引出线（垂直端口连线）
        const comX = this._schemCOM.x;
        const t1X  = this._schemT1.x;
        const t2X  = this._schemT2.x;
        const R    = this._termR;

        const isRev = this._direction === 'reverse';

        // COM 引出线
        this._staticGroup.add(new Konva.Line({
            points: isRev
                ? [comX, this._schemCOM.y - R, comX, 2]
                : [comX, this._schemCOM.y + R, comX, this.height - 2],
            stroke: '#097aeb', strokeWidth: 3,
        }));
        // T1 引出线
        this._staticGroup.add(new Konva.Line({
            points: isRev
                ? [t1X, this._schemT1.y + R, t1X, this.height - 2]
                : [t1X, this._schemT1.y - R, t1X, 2],
            stroke: '#097aeb', strokeWidth: 3,
        }));
        // T2 引出线
        this._staticGroup.add(new Konva.Line({
            points: isRev
                ? [t2X, this._schemT2.y + R, t2X, this.height - 2]
                : [t2X, this._schemT2.y - R, t2X, 2],
            stroke: '#1185f9', strokeWidth: 3 ,
        }));
    }

    /** 绘制单个接线柱（圆柱 + 螺纹装饰） */
    _drawTerminalPost(pos, name) {
        const R = this._termR;
        const { x, y } = pos;

        // 外圈（黄铜色）
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
        // 中心孔
        this._staticGroup.add(new Konva.Circle({
            x, y, radius: R * 0.40,
            fill: '#2a1a08',
            stroke: '#5a4a20', strokeWidth: 0.6,
        }));
        // 一字槽
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
        const isRev = this._direction === 'reverse';

        this._staticGroup.add(new Konva.Text({
            x: this._schemCOM.x - this._termR - 22,
            y: isRev ? this._schemCOM.y - fs - 2 : this._schemCOM.y + 4,
            text: 'COM', fontSize: fs, fontStyle: 'bold', fill: '#fa0703',
        }));
        this._staticGroup.add(new Konva.Text({
            x: this._schemT1.x - this._termR - 22,
            y: isRev ? this._schemT1.y + 4 : this._schemT1.y - fs / 2 - 1,
            text: 'T1', fontSize: fs, fontStyle: 'bold', fill: '#037207',
        }));
        this._staticGroup.add(new Konva.Text({
            x: this._schemT2.x + this._termR + 4,
            y: isRev ? this._schemT2.y + 4 : this._schemT2.y - fs / 2 - 1,
            text: 'T2', fontSize: fs, fontStyle: 'bold', fill: '#0a1af7',
        }));
    }

    // ═══════════════════════════════════════════
    // 动态层（一次性创建，每帧 in-place 更新）
    // ═══════════════════════════════════════════

    _createDynamicNodes() {
        // 1) 手柄拨杆组（仅角度变化）
        this._createLeverGroup();

        // 2) 刀片组（仅角度变化）
        this._createBladeGroup();

        // 3) 触点高光（T1 / T2）
        this._createContactGlows();

        // 4) 电弧容器
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

        // 拨杆主体（黑色绝缘棒）
        this._leverGroup.add(new Konva.Rect({
            x: Ri * 0.20, y: -this._bladeW * 0.5,
            width: this._leverLen - Ri * 0.20,
            height: this._bladeW,
            fill: '#faf6f6',
            stroke: '#a02018', strokeWidth: 1.2,
            cornerRadius: [0, 4, 4, 0],
        }));

        // 拨杆高光
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

        // 刀片主体（黄铜色）
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

        // 刀片高光
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
        const R = this._termR;
        const onT1 = this._position === 1;

        this._glowT1 = new Konva.Circle({
            x: this._schemT1.x, y: this._schemT1.y,
            radius: R * 1.5,
            fill: 'rgba(255,160,30,0.28)',
            visible: onT1,
            listening: false,
        });

        this._glowT2 = new Konva.Circle({
            x: this._schemT2.x, y: this._schemT2.y,
            radius: R * 1.5,
            fill: 'rgba(255,160,30,0.28)',
            visible: !onT1,
            listening: false,
        });

        this._dynamicGroup.add(this._glowT1);
        this._dynamicGroup.add(this._glowT2);
    }

    // ═══════════════════════════════════════════
    // 动态更新（每帧 in-place）
    // ═══════════════════════════════════════════

    _updateDynamic() {
        const onT1 = this._isOnT1();

        // 1) 手柄拨杆旋转（跟随当前插值角度）
        this._leverGroup.rotation(this._curLeverAngle);

        // 2) 刀片旋转
        this._bladeGroup.rotation(this._curBladeAngle);

        // 3) 触点高光：仅在完全到达（非动画中）时显示
        const fullyOnT1 = !this._animating && this._position === 1;
        const fullyOnT2 = !this._animating && this._position === 2;
        this._glowT1.visible(fullyOnT1);
        this._glowT2.visible(fullyOnT2);

        // 4) 电弧（瞬态）
        this._arcGroup.destroyChildren();
        if (this._arcFrames > 0) {
            this._drawArcInGroup(this._arcGroup);
        }
    }

    /** 电弧效果（在到达触头瞬间绘制） */
    _drawArcInGroup(group) {
        // 当前目标触头位置
        const target = (this._animDir > 0) ? this._schemT1 : this._schemT2;
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

        // 手柄圆盘点击区域
        const hitArea = new Konva.Circle({
            x: cx, y: cy,
            radius: R + 10,
            fill: 'transparent',
        });

        hitArea.on('click tap', () => this.toggle());
        hitArea.on('mouseenter', () => {
            document.body.style.cursor = 'pointer';
        });
        hitArea.on('mouseleave', () => {
            document.body.style.cursor = 'default';
        });

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
            this._position    = (this._animDir > 0) ? 1 : 2;
        }

        // 正弦缓动（ease in-out）
        const ease = 0.5 - 0.5 * Math.cos(this._animT * Math.PI);

        if (this._animDir > 0) {
            // T2 → T1
            this._curBladeAngle = this._bladeAngleT2 + (this._bladeAngleT1 - this._bladeAngleT2) * ease;
            this._curLeverAngle = this._angleT2       + (this._angleT1       - this._angleT2)      * ease;
            // 接触瞬间（progress > 0.85）产生电弧
            if (this._animT > 0.85 && this._arcFrames === 0) {
                this._arcFrames = 3;
            }
        } else {
            // T1 → T2
            this._curBladeAngle = this._bladeAngleT1 + (this._bladeAngleT2 - this._bladeAngleT1) * ease;
            this._curLeverAngle = this._angleT1       + (this._angleT2       - this._angleT1)      * ease;
            if (this._animT > 0.85 && this._arcFrames === 0) {
                this._arcFrames = 3;
            }
        }
    }

    /** 判断当前（或动画末态）是否在 T1 侧 */
    _isOnT1() {
        if (this._animating) {
            return this._animDir > 0;
        }
        return this._position === 1;
    }

    // ═══════════════════════════════════════════
    // 公开 API
    // ═══════════════════════════════════════════

    /** 切换到另一档位 */
    toggle() {
        if (this._animating) return;
        // 当前在 T1 → 切换到 T2（animDir=-1），反之亦然
        this._animDir = (this._position === 1) ? -1 : 1;
        this._animT   = 0;
        this._animating = true;
        this.opsCount++;
    }

    /** 切换到 T1 档位 */
    switchToT1() {
        if (this._position === 1 || this._animating) return;
        this._animDir   = 1;
        this._animT     = 0;
        this._animating = true;
        this.opsCount++;
    }

    /** 切换到 T2 档位 */
    switchToT2() {
        if (this._position === 2 || this._animating) return;
        this._animDir   = -1;
        this._animT     = 0;
        this._animating = true;
        this.opsCount++;
    }

    /** 查询当前档位（1=T1，2=T2） */
    getPosition()    { return this._position; }
    isOnT1()         { return this._position === 1; }
    isOnT2()         { return this._position === 2; }
    isAnimating()    { return this._animating; }
    getOpsCount()    { return this.opsCount; }

    update(state) {
        if (state === 1 || state === true)  this.switchToT1();
        if (state === 2 || state === false) this.switchToT2();
    }

    getConfigFields() {
        return [
            { label: '位号/名称',         key: 'label',        type: 'text'   },
            { label: '额定电压 (V)',       key: 'ratedVoltage', type: 'number' },
            { label: '额定电流 (A)',       key: 'ratedCurrent', type: 'number' },
            { label: '初始档位（1=T1，2=T2）', key: 'initPosition', type: 'number' },
            { label: '动作时间 (s)',       key: 'animDur',      type: 'number' },
            { label: '方向（normal/reverse）', key: 'direction',   type: 'text'   },
        ];
    }

    onConfigUpdate(cfg) {
        if (cfg.label        !== undefined) this.label        = cfg.label;
        if (cfg.ratedVoltage !== undefined) this.ratedVoltage = parseFloat(cfg.ratedVoltage);
        if (cfg.ratedCurrent !== undefined) this.ratedCurrent = parseFloat(cfg.ratedCurrent);
        if (cfg.animDur      !== undefined) this._animDur     = parseFloat(cfg.animDur);
        if (cfg.direction    !== undefined) this._direction   = cfg.direction === 'reverse' ? 'reverse' : 'normal';

        if (cfg.initPosition !== undefined) {
            const want = parseInt(cfg.initPosition);
            if (want === 1 && this._position !== 1) this.switchToT1();
            if (want === 2 && this._position !== 2) this.switchToT2();
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
