import { BaseComponent } from './BaseComponent.js';

/**
 * LubeOilPump — 滑油泵仿真组件
 *
 * 设计参照空压机（AirCompressor）：
 *  - 顶部引出「遥控接口」两个电气端口 l / r，两个端口接通（同一电气簇）则泵运转；
 *  - 中部符号改为三叶片旋转叶轮（参照水位控制系统的 Pump）；
 *  - 流体端口：左侧吸入 i、右侧排出 o（水平布置，供滑油循环管路连线）。
 *
 * 求解器：type='Pump'，暴露 pumpOn / pumpFlow，供 PneumaticSolver 的流量区模型使用；
 *         pumpOn 由 l / r 遥控接口是否接通决定（可由外部 setRemoteCmd 覆盖）。
 *
 * 遵循组件模板：构造函数 `_initGroups → _recalcGeometry → _initParameters → _init`，
 * `_init` 内 `_drawStaticParts` + `_createDynamicNodes` + `_bindInteraction`，最后 addPort。
 * 动态节点在 _dynamicGroup 中 in-place 更新；不使用 shadow 三件套。
 */
export class LubeOilPump extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.W = Math.max(120, config.width || 133);   // 原 200 × 2/3
        this.H = Math.max(90, config.height || 120);    // 原 180 × 2/3

        this.type = 'Pump';                 // 复用气路流量求解器的泵分支
        this.special = 'lubepump';
        this.cache = 'fixed';

        this._initGroups();
        this._recalcGeometry();
        this._initParameters(config);
        this._init();

        this.config = {
            id: this.id,
            label: this.label,
            pumpFlow: this.pumpFlow,
            inPressure: this.inPressure,
            boost: this.boost,
        };

        // 电气端口（顶部遥控接口）与流体端口（左侧吸入 i、右下角排出 o）
        this.addPort(this._lX, 0, 'l', 'wire', 'p');
        this.addPort(this._rX, 0, 'r', 'wire');
        this.addPort(0, this._centY, 'i', 'pipe', 'in');
        this.addPort(this._oX, this._oY, 'o', 'pipe');
    }

    // ═══════════════════════════════════════════════════════
    // 几何 / 参数
    // ═══════════════════════════════════════════════════════

    _recalcGeometry() {
        this._centX = this.W / 2;
        this._centY = this.H / 2;
        this._casingR = Math.min(this.W, this.H) * 0.30;
        this._lX = this.W / 2 - 26;
        this._rX = this.W / 2 + 26;
        // 排出端口位于右侧中部
        this._oX = this.W;
        this._oY = this._centY;
    }

    _initParameters(config) {
        this.label = config.label || '滑油泵';
        this.running = false;              // 运行状态（遥控接口接通即运转）
        this.power = 0;                    // 实际转速 0-1
        this.pumpOn = false;               // 供气路求解器读取
        this.pumpFlow = config.pumpFlow !== undefined ? parseFloat(config.pumpFlow) : 1; // 0~1
        this.inPressure = config.inPressure !== undefined ? parseFloat(config.inPressure) : -0.1; // 入口压力 MPa
        this.boost = config.boost !== undefined ? parseFloat(config.boost) : 0.6;                 // 加压 MPa
        this._lowOut = false;              // 出口压力低（泵压不足）故障标志
        this.lowOutPressure = config.lowOutPressure !== undefined ? parseFloat(config.lowOutPressure) : 0.1; // 故障时出口压力 MPa
        this._remoteCmd = null;            // null = 由 l/r 遥控接口决定；true/false = 外部强制
        this._bladeAngle = 0;
    }

    /** 排出压力 (MPa)：运行时 = 入口压力 + 加压量；停止时 = 0；泵压不足故障时 = lowOutPressure */
    getOutPressure() {
        if (!this.running) return 0;
        if (this._lowOut) return Math.max(0, Math.min(this.lowOutPressure, this.inPressure + this.boost));
        return Math.max(0, this.inPressure + this.boost);
    }

    _init() {
        this._drawStaticParts();
        this._createDynamicNodes();
        this._bindInteraction();
    }

    // ═══════════════════════════════════════════════════════
    // 静态部件
    // ═══════════════════════════════════════════════════════

    _drawStaticParts() {
        const g = this._staticGroup;
        const cx = this._centX, cy = this._centY;

        // 底座
        g.add(new Konva.Rect({
            x: 0, y: 0, width: this.W, height: this.H,
            fill: '#d1d1d1', stroke: '#444', strokeWidth: 2, cornerRadius: 5,
        }));

        // 左侧吸入接管
        g.add(new Konva.Rect({ x: 0, y: cy - 9, width: cx - this._casingR, height: 18, fill: '#9aa3a8', stroke: '#7a8288', strokeWidth: 1 }));
        // 右侧排出接管
        g.add(new Konva.Rect({ x: cx + this._casingR - 4, y: cy - 9, width: this.W - (cx + this._casingR - 4), height: 18, fill: '#9aa3a8', stroke: '#7a8288', strokeWidth: 1 }));

        // 泵壳底（叶轮之上再覆盖外圈做出泵壳感）
        g.add(new Konva.Circle({ x: cx, y: cy, radius: this._casingR + 6, fill: '#ecf0f1', stroke: '#34495e', strokeWidth: 3 }));

        // 遥控接口标注
        g.add(new Konva.Text({
            x: cx - 60, y: 4, width: 120, text: '遥控接口', fontSize: 11, fontStyle: 'bold',
            fill: '#1a3a6b', align: 'center', listening: false,
        }));

        // 名称
        g.add(new Konva.Text({
            x: 0, y: this.H - 20, width: this.W, text: this.label, fontSize: 15, fontStyle: 'bold',
            fill: '#2c3e50', align: 'center', listening: false,
        }));
    }

    // ═══════════════════════════════════════════════════════
    // 动态节点（叶轮 + 运行灯）
    // ═══════════════════════════════════════════════════════

    _createDynamicNodes() {
        const d = this._dynamicGroup;
        const cx = this._centX, cy = this._centY;

        // 三叶片叶轮
        this.impeller = new Konva.Group({ x: cx, y: cy });
        for (let i = 0; i < 3; i++) {
            this.impeller.add(new Konva.Path({
                data: 'M 0,0 Q -12 -15 -4 -30 L 4 -30 Q 8 -10 0 0 Z',
                fillLinearGradientStartPoint: { x: -5, y: -30 },
                fillLinearGradientEndPoint: { x: 5, y: 0 },
                fillLinearGradientColorStops: [0, '#bdc3c7', 0.5, '#95a5a6', 1, '#7f8c8d'],
                stroke: '#2c3e50', strokeWidth: 1, rotation: i * 120, lineJoin: 'round',
                listening: false,
            }));
        }
        this.impeller.add(new Konva.Circle({ radius: 6, fill: '#7f8c8d', stroke: '#2c3e50', strokeWidth: 1, listening: false }));
        this.impeller.scale({ x: this._casingR / 34, y: this._casingR / 34 });
        d.add(this.impeller);

        // 叶轮外圈（运行时变蓝）
        this.ring = new Konva.Circle({ x: cx, y: cy, radius: this._casingR, stroke: '#34495e', strokeWidth: 3, listening: false });
        d.add(this.ring);
    }

    // ═══════════════════════════════════════════════════════
    // 交互（无手动按钮；可识别部件供演示箭头定位）
    // ═══════════════════════════════════════════════════════

    _bindInteraction() {
        this.addClickablePart('body', this._centX - this._casingR - 10, this._centY - this._casingR - 10,
            (this._casingR + 10) * 2, (this._casingR + 10) * 2);
        this.addClickablePart('impeller', this._centX - this._casingR, this._centY - this._casingR,
            this._casingR * 2, this._casingR * 2);
    }

    // ═══════════════════════════════════════════════════════
    // tick
    // ═══════════════════════════════════════════════════════

    tick(dt) {
        let controlClosed;
        if (this._remoteCmd === true || this._remoteCmd === false) {
            controlClosed = this._remoteCmd;
        } else {
            controlClosed = this.sys.isPortConnected(`${this.id}_wire_l`, `${this.id}_wire_r`) === true;
        }
        this.running = controlClosed === true;
        this.pumpOn = this.running;

        const target = this.running ? 1 : 0;
        const lerp = target > this.power ? 0.25 : 0.12;
        this.power += (target - this.power) * lerp * 0.2;
        if (this.power < 0.01) this.power = 0;

        this._bladeAngle += this.power * 200 * 0.2;
        this.impeller.rotation(this._bladeAngle);
        this.ring.stroke(this.running ? '#3498db' : '#34495e');

        this.sys.requestRedraw();
    }

    // ═══════════════════════════════════════════════════════
    // 公开 API
    // ═══════════════════════════════════════════════════════

    isRunning() { return this.running; }

    /**
     * 下达/清除遥控起停指令（供遥控面板/PLC 手工操作）。
     * @param {boolean|null} v  true=起动，false=停止，null=交由 l/r 遥控接口决定
     */
    setRemoteCmd(v) {
        this._remoteCmd = (v === true || v === false) ? v : null;
    }
    getRemoteCmd() { return this._remoteCmd; }

    /** 局部坐标 → 舞台绝对坐标 */
    _toAbs(x, y) {
        try { return this.group.getAbsoluteTransform().point({ x, y }); }
        catch (e) { return { x: this.group.x() + x, y: this.group.y() + y }; }
    }

    /** 返回部件中心的世界坐标（供工作流箭头定位） */
    getClickablePartCenter(partId) {
        switch (partId) {
            case 'body':
            case 'impeller': return this._toAbs(this._centX, this._centY);
            case 'l':        return this._toAbs(this._lX, 0);
            case 'r':        return this._toAbs(this._rX, 0);
            case 'i':        return this._toAbs(0, this._centY);
            case 'o':        return this._toAbs(this._oX, this._oY);
            default:         return null;
        }
    }

    getConfigFields() {
        return [
            { label: '器件名称 (ID)', key: 'id', type: 'text' },
            { label: '位号/名称', key: 'label', type: 'text' },
            { label: '干路流量设定 (0~1)', key: 'pumpFlow', type: 'number' },
            { label: '入口压力 (MPa)', key: 'inPressure', type: 'number' },
            { label: '加压量 (MPa)', key: 'boost', type: 'number' },
        ];
    }

    onConfigUpdate(cfg) {
        if (cfg.id) this.id = cfg.id;
        if (cfg.label !== undefined) this.label = cfg.label;
        if (cfg.pumpFlow !== undefined) this.pumpFlow = Math.max(0, Math.min(1, parseFloat(cfg.pumpFlow)));
        if (cfg.inPressure !== undefined) this.inPressure = parseFloat(cfg.inPressure);
        if (cfg.boost !== undefined) this.boost = parseFloat(cfg.boost);
        this.config = { ...this.config, id: this.id, label: this.label, pumpFlow: this.pumpFlow,
            inPressure: this.inPressure, boost: this.boost };
    }

    destroy() {
        super.destroy?.();
    }
}

export default LubeOilPump;
