import { BaseComponent } from './BaseComponent.js';

/**
 * DiagramSPDT 单刀双掷开关（原理图风格）仿真组件
 *
 * ═══ 渲染优化原则 ═══════════════════════════════════════════
 *  1. 动态元素（刀片、触点高光）使用 in-place 更新
 *  2. 消除所有 shadow 属性
 *  3. 静态部件（引线、静触点、标注）仅在 init 时缓存
 * ═══════════════════════════════════════════════════════════
 *
 * ── 结构说明 ──────────────────────────────────────────────────
 *  纯原理图风格（参照 DiagramStartButton / DiagramStopButton）：
 *    - 公共端 COM：引线至组件边界端口
 *    - 静触点 T1/T2：小圆点 + 引线至边界端口
 *    - 动刀片：以 COM 为转轴，在 T1/T2 之间摆动
 *
 * ── 动作逻辑 ──────────────────────────────────────────────────
 *  点击组件切换档位 → 刀片摆向另一侧 → COM 与对应端子导通
 *
 * ── 方向说明 ──────────────────────────────────────────────────
 *  direction = 'normal'：COM 在下，T1/T2 在上
 *  direction = 'reverse'：COM 在上，T1/T2 在下（与 SPDTSwitch 一致）
 *
 * ── 端口 ─────────────────────────────────────────────────────
 *  com — 公共端（COM）
 *  t1  — 触点1
 *  t2  — 触点2
 *
 * ── 可配置参数 ────────────────────────────────────────────────
 *  label        : 位号（默认 'SA'）
 *  ratedVoltage : 额定电压 V（默认 250）
 *  ratedCurrent : 额定电流 A（默认 10）
 *  initPosition : 初始档位 1=T1，2=T2（默认 1）
 *  animDur      : 动画时长 s（默认 0.06）
 *  direction    : 方向 'normal' / 'reverse'（默认 'normal'）
 */
export class DiagramSPDT extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.width  = Math.max(110, config.width  || 120);
        this.height = Math.max(80,  config.height || 100);

        this.type    = 'SPNT';
        this.special = 'SPDT';
        this.cache   = 'fixed';

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
        const isRev = this._direction === 'reverse';

        // 触头位置：COM 居中，T1 左，T2 右
        const comY = isRev ? H * 0.26 : H * 0.74;
        const tY   = isRev ? H * 0.74 : H * 0.26;

        this._schemCOM = { x: W * 0.50, y: comY };
        this._schemT1  = { x: W * 0.24, y: tY };
        this._schemT2  = { x: W * 0.76, y: tY };

        // 接线柱半径
        this._termR = Math.max(5, W * 0.026);

        // 刀片长度与角度（转轴在 COM，末端朝向触头）
        const dxT1 = this._schemT1.x - this._schemCOM.x;
        const dyT1 = this._schemT1.y - this._schemCOM.y;
        this._bladeLen = Math.sqrt(dxT1 * dxT1 + dyT1 * dyT1) * 0.86;
        this._bladeAngleT1 = Math.atan2(dyT1, dxT1) * 180 / Math.PI;
        this._bladeAngleT2 = Math.atan2(
            this._schemT2.y - this._schemCOM.y,
            this._schemT2.x - this._schemCOM.x
        ) * 180 / Math.PI;

        // 刀片厚度
        this._bladeW = Math.max(5, H * 0.028);

        // 端口位置（组件边界）
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
        this.function     = config.function     || '单刀双掷';

        // 档位：1=T1（左），2=T2（右）
        this._position    = (config.initPosition === 2) ? 2 : 1;
        this._animating   = false;
        this._animT       = 0;
        this._animDir     = 1;  // +1 = 向T1，-1 = 向T2

        // 当前刀片角度（度）：插值在 bladeAngleT1 ~ bladeAngleT2 之间
        this._curBladeAngle = (this._position === 1)
            ? this._bladeAngleT1
            : this._bladeAngleT2;

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
        this._drawSchematicStatic();
        this._drawLabel();
        this._drawTerminalLabels();
    }

    /** 原理图区静态元素：接线、静触点、端子 */
    _drawSchematicStatic() {
        const isRev = this._direction === 'reverse';
        const R     = this._termR;

        const comColor = '#1a252f';
        const t1Color  = '#1a7a30';
        const t2Color  = '#2050e0';

        // ── 引线：触点 → 边界端口 ──
        // COM
        this._staticGroup.add(new Konva.Line({
            points: isRev
                ? [this._schemCOM.x, this._schemCOM.y - R, this._schemCOM.x, 2]
                : [this._schemCOM.x, this._schemCOM.y + R, this._schemCOM.x, this.height - 2],
            stroke: comColor, strokeWidth: 2.5,
            lineCap: 'round',
        }));
        // T1
        this._staticGroup.add(new Konva.Line({
            points: isRev
                ? [this._schemT1.x, this._schemT1.y + R, this._schemT1.x, this.height - 2]
                : [this._schemT1.x, this._schemT1.y - R, this._schemT1.x, 2],
            stroke: t1Color, strokeWidth: 2.5,
            lineCap: 'round',
        }));
        // T2
        this._staticGroup.add(new Konva.Line({
            points: isRev
                ? [this._schemT2.x, this._schemT2.y + R, this._schemT2.x, this.height - 2]
                : [this._schemT2.x, this._schemT2.y - R, this._schemT2.x, 2],
            stroke: t2Color, strokeWidth: 2.5,
            lineCap: 'round',
        }));

        // ── 静触点（小圆点）──
        this._drawContact(this._schemCOM, comColor);
        this._drawContact(this._schemT1,  t1Color);
        this._drawContact(this._schemT2,  t2Color);
    }

    /** 绘制单个静触点（圆点 + 金色填充） */
    _drawContact(pos, color) {
        const R = this._termR;
        this._staticGroup.add(new Konva.Circle({
            x: pos.x, y: pos.y,
            radius: R,
            fill: '#e8c86a',
            stroke: color, strokeWidth: 1.8,
        }));
        this._staticGroup.add(new Konva.Circle({
            x: pos.x, y: pos.y,
            radius: R * 0.4,
            fill: '#8a6a20',
        }));
    }

    /** 位号铭牌 */
    _drawLabel() {
        const fs = Math.max(13, this.width * 0.045);
        this._staticGroup.add(new Konva.Text({
            x: -20, y: 0, width: this.width,
            text: this.label,
            fontSize: fs, fontStyle: 'bold', fill: '#333',
            align: 'center',
        }));
    }

    /** 端子档位标注 */
    _drawTerminalLabels() {
        const fs = Math.max(12, this.width * 0.040);
        const isRev = this._direction === 'reverse';

        this._staticGroup.add(new Konva.Text({
            x: this._schemT1.x - 24,
            y: isRev ? this._schemT1.y - fs - 4 : this._schemT1.y + 4,
            text: 'T1', fontSize: fs, fontStyle: 'bold', fill: '#1a7a30',
        }));
        this._staticGroup.add(new Konva.Text({
            x: this._schemT2.x + 6,
            y: isRev ? this._schemT2.y - fs - 4 : this._schemT2.y + 4,
            text: 'T2', fontSize: fs, fontStyle: 'bold', fill: '#2050e0',
        }));
    }

    // ═══════════════════════════════════════════
    // 动态层（一次性创建，每帧 in-place 更新）
    // ═══════════════════════════════════════════

    _createDynamicNodes() {
        // 1) 刀片组（仅角度变化）
        this._createBladeGroup();

        // 2) 触点高光（T1 / T2）
        this._createContactGlows();
    }

    /** 刀片组（绕 COM 触点旋转） */
    _createBladeGroup() {
        const px = this._schemCOM.x;
        const py = this._schemCOM.y;
        const bLen = this._bladeLen;
        const bW   = this._bladeW;
        const R    = this._termR;

        this._bladeGroup = new Konva.Group({
            x: px, y: py,
            rotation: this._curBladeAngle,
        });

        // 刀片线（从 COM 指向触头）
        this._bladeGroup.add(new Konva.Line({
            points: [R * 0.8, 0, bLen - R * 0.4, 0],
            stroke: '#e03030', strokeWidth: bW,
            lineCap: 'round',
        }));

        // 刀片高光
        this._bladeGroup.add(new Konva.Line({
            points: [R * 0.8 + 3, -bW * 0.22, bLen - R * 0.4 - 4, -bW * 0.22],
            stroke: 'rgba(255,255,255,0.35)',
            strokeWidth: 1,
            lineCap: 'round',
        }));

        // 动触点（刀片端部小圆）
        this._bladeGroup.add(new Konva.Circle({
            x: bLen - R * 0.4, y: 0,
            radius: R * 1.1,
            fill: '#f0cc68',
            stroke: '#e03030', strokeWidth: 1.5,
        }));

        this._dynamicGroup.add(this._bladeGroup);
    }

    /** 触点高光（仅在接通的触头上显示橙色发光） */
    _createContactGlows() {
        const R = this._termR;
        const onT1 = this._position === 1;

        this._glowT1 = new Konva.Circle({
            x: this._schemT1.x, y: this._schemT1.y,
            radius: R * 1.6,
            fill: 'rgba(255,160,30,0.30)',
            visible: onT1,
            listening: false,
        });

        this._glowT2 = new Konva.Circle({
            x: this._schemT2.x, y: this._schemT2.y,
            radius: R * 1.6,
            fill: 'rgba(255,160,30,0.30)',
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
        // 1) 刀片旋转
        this._bladeGroup.rotation(this._curBladeAngle);

        // 2) 触点高光：仅在完全到达（非动画中）时显示
        const fullyOnT1 = !this._animating && this._position === 1;
        const fullyOnT2 = !this._animating && this._position === 2;
        this._glowT1.visible(fullyOnT1);
        this._glowT2.visible(fullyOnT2);
    }

    // ═══════════════════════════════════════════
    // 交互绑定
    // ═══════════════════════════════════════════

    _bindInteraction() {
        const W = this.width, H = this.height;

        // 整个组件区域为点击热区
        const hitArea = new Konva.Rect({
            x: 0, y: 0,
            width: W, height: H,
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

        if (this._animating || this._animJustEnded) {
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
            this._animT         = 1;
            this._animating     = false;
            this._animJustEnded = true;
            this._position      = (this._animDir > 0) ? 1 : 2;
        }

        // 正弦缓动（ease in-out）
        const ease = 0.5 - 0.5 * Math.cos(this._animT * Math.PI);

        if (this._animDir > 0) {
            // T2 → T1
            this._curBladeAngle = this._bladeAngleT2 + (this._bladeAngleT1 - this._bladeAngleT2) * ease;
        } else {
            // T1 → T2
            this._curBladeAngle = this._bladeAngleT1 + (this._bladeAngleT2 - this._bladeAngleT1) * ease;
        }
    }

    // ═══════════════════════════════════════════
    // 公开 API
    // ═══════════════════════════════════════════

    /** 切换到另一档位 */
    toggle() {
        if (this._animating) return;
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
