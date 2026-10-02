import { BaseComponent } from './BaseComponent.js';

/**
 * ElecValve - 三通电动执行机构（三通调节阀）
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  视觉：三段弧构成的阀体腔体（三个 pipe 口）+ 旋转扇形阀板（Wedge）
 *        + 电机图标 + 手轮 + LCD 开度显示 + REMOTE/MANUAL 模式开关。
 *
 *  控制模型：
 *    - 控制模式 controlMode：'REMOTE'（远程，由 l/r 端子电压/电流换算）或
 *      'MANUAL'（手动，由手轮点击微调 manualPos）。
 *    - 组件维护 currentPos（实际开度 0~1），tick 中按 200ms 节奏平滑逼近目标值。
 *    - 电气接口：右侧 l/r 两个 wire 端子；底部/侧面 r/u/l 三个 pipe 流体接口。
 *
 *  数据来源：REMOTE 模式下读取 l/r 端子间电压，除以内部电阻 currentResistance
 *      估算回路电流，再按 4~20mA 线性映射为开度 0~100%（教学近似）。
 *
 *  对外接口（供上层调用）：
 *    - getOpeningPercent()  当前开度百分数 0~100
 *    - setTarget(p)         设置目标开度 0~1（自动写入 manual/remote）
 *    - setControlMode(mode) 切换 REMOTE / MANUAL
 *    - update()             按当前状态刷新视觉（无参）
 *    - currentPos / controlMode / manualPos / remotePos 仍为公开字段
 *
 *  组件模式遵循规范：_initGroups → _recalcGeometry → _initParameters → _init，
 *  静态部件入 _staticGroup（init 时一次缓存），动态节点入 _dynamicGroup（in-place 更新）。
 * ═══════════════════════════════════════════════════════════════════════════
 */
export class ElecValve extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.width = Math.max(180, config.width || 190);
        this.height = Math.max(160, config.height || 150);

        // 电气/求解器标识：作为 250Ω 采样电阻（4~20mA → 1~5V）参与电路求解
        this.type = 'resistor';
        this.special = 'actuator';
        this.cache = 'fixed';

        this._initGroups();
        this._recalcGeometry();
        this._initParameters(config);
        this._init();

        this.config = {
            id: this.id,
            label: this.label,
            controlMode: this.controlMode,
            currentResistance: this.currentResistance,
        };

        // ── 端口定义 ──
        // 三通流体端口（位置与腔体对应）
        const g = this._geo;
        this.addPort(g.pipeR.x, g.pipeR.y, 'r', 'pipe');            // 上口
        this.addPort(g.pipeU.x, g.pipeU.y, 'u', 'pipe', 'in');      // 左口
        this.addPort(g.pipeL.x, g.pipeL.y, 'l', 'pipe', 'in');      // 下口
        // 电气端口：从系统读取电压/电流以驱动电机（教学近似）
        this.addPort(g.termL.x, g.termL.y, 'l', 'wire', 'p');       // 电机正极
        this.addPort(g.termR.x, g.termR.y, 'r', 'wire');            // 电机负极
    }

    // ═══════════════════════════════════════════════════════════════
    // 几何（集中定义；保持原视觉坐标不变）
    // ═══════════════════════════════════════════════════════════════
    _recalcGeometry() {
        this.radius = 60;   // 阀体腔体主半径
        const cx = 60, cy = 60;

        this._geo = {
            center: { x: cx, y: cy },
            motorBox: { x: 115, y: 20, w: 60, h: 80 },
            motorCircle: { x: 145, y: 60, r: 20 },
            label: { x: 100, y: 118 },
            lcd: { x: 35, y: 15, w: 50, h: 22 },
            modeSw: { x: 127, y: 0, w: 40, h: 20, r: 8 },
            // 流体端口（与腔体开口对应）
            pipeR: { x: 60, y: -10 },
            pipeU: { x: -10, y: 60 },
            pipeL: { x: 60, y: 130 },
            // 电气端子
            termL: { x: 175, y: 40 },
            termR: { x: 175, y: 80 },
        };
    }

    _initParameters(config) {
        this.label = config.label || '三通调节阀';

        // 控制模式与位置
        this.controlMode = config.controlMode || 'REMOTE';
        this.manualPos = 0;    // 手动模式下由手轮/外部设定
        this.remotePos = 0;    // 远程模式下由电压/电流换算
        this.currentPos = 0;   // 实际当前开度，tick 中平滑逼近目标
        this.isStuck = false;  // 卡死故障标志，true 时拒绝位置更新

        // 电气参数（把电压映射为电流，再计算目标开度）
        this.currentResistance = config.currentResistance || 250;

        this._tickAcc = 0;
    }

    _init() {
        this._drawStaticParts();
        this._createDynamicNodes();
        this._bindInteraction();
    }

    // ═══════════════════════════════════════════════════════════════
    // 静态部件（init 时一次缓存）
    // ═══════════════════════════════════════════════════════════════
    _drawStaticParts() {
        this._drawValveChamber();
        this._drawActuator();
        this._drawLcdBase();
        this._drawHandwheel();
        this._drawModeSwitchBase();
    }

    /** 三段弧组成的腔体 + 三个管道接口 */
    _drawValveChamber() {
        const c = this._geo.center, R = this.radius;
        const arcStroke = '#2c3e50', strokeW = 15;
        const g = new Konva.Group({ x: c.x, y: c.y });

        // 腔体三段弧
        g.add(new Konva.Arc({ innerRadius: R, outerRadius: R, angle: 140, rotation: -70, stroke: arcStroke, strokeWidth: strokeW }));
        g.add(new Konva.Arc({ innerRadius: R, outerRadius: R, angle: 50, rotation: 200, stroke: arcStroke, strokeWidth: strokeW }));
        g.add(new Konva.Arc({ innerRadius: R, outerRadius: R, angle: 50, rotation: 110, stroke: arcStroke, strokeWidth: strokeW }));

        // 管道接口（上/左/下开口，双层描边）
        const pipeArc = (rotation) => {
            g.add(new Konva.Arc({ innerRadius: R, outerRadius: R, angle: 40, rotation, stroke: '#f1c7c7', strokeWidth: strokeW + 6 }));
            g.add(new Konva.Arc({ innerRadius: R, outerRadius: R, angle: 40, rotation, stroke: '#bdc2cb', strokeWidth: strokeW - 4 }));
        };
        pipeArc(-110);  // 上口
        pipeArc(160);   // 左口
        pipeArc(70);    // 下口

        this._staticGroup.add(g);
    }

    /** 电机驱动机构（方框 + 圆圈 M + 标签） */
    _drawActuator() {
        const b = this._geo.motorBox, m = this._geo.motorCircle, lb = this._geo.label;

        this._staticGroup.add(new Konva.Rect({
            x: b.x, y: b.y, width: b.w, height: b.h,
            fill: '#34495e', stroke: '#000', cornerRadius: 5,
        }));
        this._staticGroup.add(new Konva.Circle({
            x: m.x, y: m.y, radius: m.r, fill: '#ecf0f1', stroke: '#2c3e50',
        }));
        this._staticGroup.add(new Konva.Text({
            x: m.x - 7, y: m.y - 6, text: 'M', fontSize: 18, fontStyle: 'bold',
        }));
        this._staticGroup.add(new Konva.Text({
            x: lb.x, y: lb.y, text: '三通调节阀', fontSize: 18, fontStyle: 'bold',
        }));
    }

    /** LCD 屏底色（数字文本为动态节点） */
    _drawLcdBase() {
        const l = this._geo.lcd;
        this._staticGroup.add(new Konva.Rect({
            x: l.x, y: l.y, width: l.w, height: l.h,
            fill: '#1a1a1a', stroke: '#7f8c8d', strokeWidth: 1, cornerRadius: 2,
        }));
    }

    /** 手轮轮辋/辐条/旋钮（整体入动态组以便随开度旋转） */
    _drawHandwheel() {
        const c = this._geo.center;
        const wheelGroup = new Konva.Group({ x: c.x, y: c.y });
        wheelGroup.add(new Konva.Circle({ radius: 25, stroke: '#95a5a6', strokeWidth: 5, fill: '#bdc3c7' }));
        wheelGroup.add(new Konva.Line({ points: [0, -20, 0, 20], stroke: '#7f8c8d', strokeWidth: 3 }));
        wheelGroup.add(new Konva.Line({ points: [-20, 0, 20, 0], stroke: '#7f8c8d', strokeWidth: 3 }));
        wheelGroup.add(new Konva.Circle({ x: 18, y: 0, radius: 3, fill: '#e74c3c' }));
        this._wheelGroup = wheelGroup;
    }

    /** 模式开关底座 */
    _drawModeSwitchBase() {
        const s = this._geo.modeSw;
        this._staticGroup.add(new Konva.Rect({
            x: s.x, y: s.y, width: s.w, height: s.h,
            fill: '#2c3e50', cornerRadius: 10, listening: false,
        }));
    }

    // ═══════════════════════════════════════════════════════════════
    // 动态节点（in-place 更新）
    // ═══════════════════════════════════════════════════════════════
    _createDynamicNodes() {
        const d = this._dynamicGroup;
        const c = this._geo.center, R = this.radius, l = this._geo.lcd, s = this._geo.modeSw;

        // 旋转扇形阀板（围绕腔体中心）——动态节点
        this._vaneGroup = new Konva.Group({ x: c.x, y: c.y });
        this._vane = new Konva.Wedge({
            x: 0, y: 0, radius: R - 10, angle: 90,
            fill: '#06a844', stroke: '#d35400', strokeWidth: 1, rotation: 100,
        });
        this._vaneGroup.add(this._vane);
        this._vaneGroup.add(new Konva.Circle({ radius: 8, fill: '#7f8c8d', stroke: '#000' }));
        d.add(this._vaneGroup);

        // 手轮（随开度旋转）——动态节点
        d.add(this._wheelGroup);

        // LCD 数字文本——动态节点（无 shadow 三件套）
        this.lcdText = new Konva.Text({
            x: l.x, y: l.y + 4, width: l.w, text: '0%',
            fontSize: 14, fontFamily: 'Courier New', fontStyle: 'bold',
            fill: '#00ff00', align: 'center', listening: false,
        });
        d.add(this.lcdText);

        // 模式开关手柄 + 标签
        this._toggleHandle = new Konva.Circle({ x: this.controlMode === 'MANUAL' ? s.x - 17 : s.x + 3, y: s.y + 10, radius: s.r, fill: '#0bf555', listening: false });
        this._modeLabel = new Konva.Text({ x: s.x - 5, y: s.y - 14, text: this.controlMode, fontSize: 10, fontStyle: 'bold', width: 50, align: 'center', fill: '#2d09f8', listening: false });
        d.add(this._toggleHandle, this._modeLabel);

        // 电机图标命中层（双击清卡死）——静止，入动态组顶端以接收事件
        this._motorIcon = new Konva.Circle({
            x: this._geo.motorCircle.x, y: this._geo.motorCircle.y, radius: this._geo.motorCircle.r,
            fill: 'rgba(0,0,0,0)', listening: true,
        });
        d.add(this._motorIcon);
    }

    // ═══════════════════════════════════════════════════════════════
    // 交互
    // ═══════════════════════════════════════════════════════════════
    _bindInteraction() {
        const s = this._geo.modeSw;

        // 电机双击清除卡死
        this._motorIcon.on('dblclick dbltap', (e) => { e.cancelBubble = true; this.isStuck = false; });

        // 手轮点击：上半区开度增大、下半区减小（仅手动模式）
        const wheelHit = this.addClickablePart('wheel', this._geo.center.x - 25, this._geo.center.y - 25, 50, 50);
        if (wheelHit) wheelHit.on('click tap', (e) => {
            if (this.controlMode !== 'MANUAL') return;
            const p = this._wheelGroup.getRelativePointerPosition();
            if (!p) return;
            if (p.y < 0) this.manualPos = Math.min(1.0, this.manualPos + 0.05);
            else this.manualPos = Math.max(0.0, this.manualPos - 0.05);
            this.update();
        });

        // 模式开关：REMOTE ⇄ MANUAL
        const swHit = this.addClickablePart('mode-sw', s.x, s.y, s.w, s.h);
        if (swHit) swHit.on('click tap', () => this.toggleControlMode());
    }

    getClickablePartCenter(partId) {
        const rel = {
            'wheel': { x: this._geo.center.x - 25, y: this._geo.center.y - 25, w: 50, h: 50 },
            'mode-sw': this._geo.modeSw,
            'motor': { x: this._geo.motorCircle.x - 20, y: this._geo.motorCircle.y - 20, w: 40, h: 40 },
        }[partId];
        if (!rel) return super.getClickablePartCenter(partId);
        const g = this.group.getAbsolutePosition();
        return { x: g.x + rel.x + rel.w / 2, y: g.y + rel.y + rel.h / 2 };
    }

    // ═══════════════════════════════════════════════════════════════
    // 控制 API
    // ═══════════════════════════════════════════════════════════════
    /** 当前开度百分数（0~100） */
    getOpeningPercent() { return Math.round(Math.max(0, Math.min(1, this.currentPos)) * 100); }

    /** 当前开度（0~1） */
    getOpening() { return Math.max(0, Math.min(1, this.currentPos)); }

    /**
     * 设置目标开度（0~1）
     * 自动写入当前模式对应值；REMOTE 下作为远程目标，MANUAL 下作为手动目标。
     */
    setTarget(p) {
        const v = Math.max(0, Math.min(1, Number(p) || 0));
        if (this.controlMode === 'MANUAL') this.manualPos = v;
        else this.remotePos = v;
        this.update();
        if (this.sys && typeof this.sys.requestRedraw === 'function') this.sys.requestRedraw();
    }

    /** 切换控制模式 REMOTE ⇄ MANUAL */
    setControlMode(mode) {
        const m = (mode === 'MANUAL') ? 'MANUAL' : 'REMOTE';
        if (m === this.controlMode) return;
        if (m === 'MANUAL') this.manualPos = this.remotePos;
        else this.remotePos = this.manualPos;
        this.controlMode = m;
        this._updateModeVisual();
        this.update();
        if (this.sys && typeof this.sys.requestRedraw === 'function') this.sys.requestRedraw();
    }

    toggleControlMode() {
        this.setControlMode(this.controlMode === 'REMOTE' ? 'MANUAL' : 'REMOTE');
    }

    _updateModeVisual() {
        const s = this._geo.modeSw;
        const manual = this.controlMode === 'MANUAL';
        this._toggleHandle.x(manual ? s.x - 17 : s.x + 3);
        this._toggleHandle.fill(manual ? '#f1c40f' : '#0dfd49');
        this._modeLabel.text(this.controlMode);
        this.markDirty();
    }

    // ═══════════════════════════════════════════════════════════════
    // 主循环：200ms 节奏平滑逼近目标
    // ═══════════════════════════════════════════════════════════════
    tick(dt) {
        this._tickAcc = (this._tickAcc || 0) + (dt || 0);
        if (this._tickAcc < 0.2) { this._refreshIfDirty(); return; }
        this._tickAcc = 0;

        // 1. 由 l/r 端子电压换算目标开度
        let targetPos;
        const voltage = (this.sys && typeof this.sys.getVoltageBetween === 'function')
            ? (this.sys.getVoltageBetween(`${this.id}_wire_l`, `${this.id}_wire_r`) || 0) : 0;
        if (voltage > 0.1) {
            const current = Math.max(0.004, Math.min(0.02, voltage / this.currentResistance));
            targetPos = (1000 * current - 4) / 16;
        } else {
            targetPos = (this.controlMode === 'MANUAL') ? this.manualPos : this.remotePos;
        }
        targetPos = Math.max(0, Math.min(1, targetPos));

        // 2. 平滑逼近（每 200ms 最多移动 5% 行程）
        const maxStep = 0.05;
        const diff = targetPos - this.currentPos;
        if (Math.abs(diff) <= maxStep) this.currentPos = targetPos;
        else this.currentPos += diff > 0 ? maxStep : -maxStep;

        // 3. in-place 更新视觉
        this.update();
        this.markDirty();
        this._refreshIfDirty();
    }

    /**
     * 按当前状态刷新视觉（无参）。
     * 阀板与手轮同步旋转、LCD 显示开度、颜色反馈。
     */
    update() {
        // 卡死：LCD 闪烁、拒绝更新
        if (this.isStuck) {
            this.lcdText.fill(Math.floor(Date.now() / 500) % 2 ? '#ff0000' : '#7f8c8d');
            this.markDirty();
            this._refreshIfDirty();
            return;
        }

        const safePos = Math.max(0, Math.min(1, this.currentPos));
        const percent = Math.round(safePos * 100);

        // 阀板与手轮同步旋转
        const startRotation = 110, endRotation = 70;
        const currentRotation = endRotation + safePos * (startRotation - endRotation);
        this._vane.rotation(currentRotation);
        this._wheelGroup.rotation(currentRotation * 5.5);

        // LCD 与颜色反馈
        this.lcdText.text(percent + '%');
        this.lcdText.fill(percent > 10 ? '#00ff00' : '#ff3300');
        this._vane.fill(safePos > 0.1 ? '#11ed65' : '#fa3b25');

        this.markDirty();
        this._refreshIfDirty();
    }

    // ═══════════════════════════════════════════════════════════════
    // 配置
    // ═══════════════════════════════════════════════════════════════
    getConfigFields() {
        return [
            { label: '位号/名称', key: 'label', type: 'text', get: c => c.label },
            { label: '控制模式', key: 'controlMode', type: 'select',
              get: c => c.controlMode,
              options: [
                  { label: 'REMOTE（远程 4~20mA）', value: 'REMOTE' },
                  { label: 'MANUAL（手动手轮）', value: 'MANUAL' },
              ] },
            { label: '内部电阻 (Ω)', key: 'currentResistance', type: 'number', get: c => c.currentResistance },
        ];
    }

    onConfigUpdate(cfg = {}) {
        if (cfg.label !== undefined) this.label = cfg.label;
        if (cfg.currentResistance !== undefined) this.currentResistance = parseFloat(cfg.currentResistance) || 250;
        if (cfg.controlMode !== undefined) this.setControlMode(cfg.controlMode);
        this.config = Object.assign({}, this.config, cfg);
        this.update();
    }

    destroy() { super.destroy?.(); }
}

export default ElecValve;
