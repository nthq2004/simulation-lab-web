import { BaseComponent } from './BaseComponent.js';

/**
 * Potentiometer — 三端电位器（分压器）组件
 *
 * 说明：
 * - 三个端子：l（左端，通常接 +10V）、r（右端，通常接 0V）、w（中间滑臂，接模拟量输入）；
 * - 内部按滑臂位置 position（0=滑臂在最左，1=在最右）把总阻值分为两段：
 *     R(l–w) = position × R_total      R(w–r) = (1 − position) × R_total
 *   故 w 端电压 = V(l) × (1 − position)（l 接 10V、r 接 0V 时）；
 * - 滑臂可水平拖动，也可点击主体左右步进；
 * - 由 DeviceStamps.stampPotentiometers 注入两段电阻，实现真实分压（替代两电阻分压电路）。
 */
export class Potentiometer extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.width  = 110;
        this.height = 30;

        this.type  = 'potentiometer';
        this.cache = 'fixed';

        this._initGroups();

        // ── 物理参数 ──
        this.totalResistance = config.value !== undefined ? parseFloat(config.value) : 10000; // 总阻值 Ω
        this.position = config.position !== undefined
            ? Math.min(1, Math.max(0, parseFloat(config.position)))
            : 0.5;
        this.stepPercent = 0.05;

        this.config = {
            id: this.id,
            totalResistance: this.totalResistance,
            position: this.position,
            stepPercent: this.stepPercent,
        };

        this._draw();
        this._bind();

        // 三端：左 / 右 / 滑臂
        this.addPort(-26, this.height / 2, 'l', 'wire');
        this.addPort(this.width + 26, this.height / 2, 'r', 'wire');
        this.addPort(this.width / 2, -42, 'w', 'wire');

        this.update();
    }

    _wiperX() { return this.position * this.width; }

    _draw() {
        const W = this.width, H = this.height;
        const g = this._interactGroup;

        // 电阻主体
        this.body = new Konva.Rect({
            x: 0, y: 0, width: W, height: H, cornerRadius: 3,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint:   { x: 0, y: H },
            fillLinearGradientColorStops: [0, '#d7d7d7', 0.5, '#fdfdfd', 1, '#b5b5b5'],
            stroke: '#555', strokeWidth: 1.5, cursor: 'pointer',
        });

        // 左右引出线
        const leadL = new Konva.Line({ points: [-26, H / 2, 0, H / 2], stroke: '#409c72', strokeWidth: 6, lineCap: 'round' });
        const leadR = new Konva.Line({ points: [W, H / 2, W + 26, H / 2], stroke: '#42c9b5', strokeWidth: 6, lineCap: 'round' });

        // 滑臂引出线（从上方固定端子折向滑臂）
        this.wiperLead = new Konva.Line({
            points: this._wiperLeadPoints(),
            stroke: '#2c3e50', strokeWidth: 3, lineJoin: 'round', lineCap: 'round',
        });

        // 滑臂（可拖动）
        this.arrow = new Konva.Group({
            x: this._wiperX(), y: -8, draggable: true,
            dragBoundFunc: (pos) => {
                const t = this.group.getAbsoluteTransform().copy();
                t.invert();
                const lp = t.point(pos);
                const nx = Math.max(0, Math.min(this.width, lp.x));
                return this.group.getAbsoluteTransform().point({ x: nx, y: -8 });
            },
        });
        this.arrow.add(new Konva.Arrow({
            points: [0, 0, 0, 18], pointerLength: 10, pointerWidth: 11,
            fill: '#2c3e50', stroke: '#2c3e50', strokeWidth: 3,
        }));
        this.valLabel = new Konva.Text({
            x: -55, y: -36, width: 110, align: 'center',
            text: '50%', fontSize: 14, fontStyle: 'bold', fill: '#e67e22',
        });
        this.arrow.add(this.valLabel);

        g.add(leadL, leadR, this.body, this.wiperLead, this.arrow);
    }

    _wiperLeadPoints() {
        const W = this.width, x = this._wiperX();
        return [W / 2, -42, W / 2, -24, x, -24, x, -6];
    }

    _bind() {
        // 拖动滑臂
        this.arrow.on('dragmove', () => {
            this.position = Math.max(0, Math.min(1, this.arrow.x() / this.width));
            this.update();
        });
        this.arrow.on('mouseenter', () => this.sys.layer.getStage().container().style.cursor = 'ew-resize');
        this.arrow.on('mouseleave', () => this.sys.layer.getStage().container().style.cursor = 'default');

        // 点击主体左右步进
        this.body.on('click tap', (e) => {
            const stage = this.sys.layer.getStage();
            const p = stage.getPointerPosition();
            const t = this.group.getAbsoluteTransform().copy();
            t.invert();
            const lx = t.point(p).x;
            const step = this.stepPercent;
            if (lx > this._wiperX()) this.position = Math.min(1, this.position + step);
            else this.position = Math.max(0, this.position - step);
            this.update();
        });
        this.body.on('dblclick', (e) => e.cancelBubble = true);
    }

    /** 刷新视图与文字 */
    update() {
        const x = this._wiperX();
        this.arrow.x(x);
        this.wiperLead.points(this._wiperLeadPoints());
        this.valLabel.text(`${Math.round(this.position * 100)}%`);
        if (this.sys && typeof this.sys.requestRedraw === 'function') this.sys.requestRedraw();
    }

    /**
     * 两段电阻（供 DeviceStamps 注入）。
     * 滑臂在最左(position=0)：l–w 近 0Ω、w–r 为全阻值；
     * 滑臂在最右(position=1)：l–w 为全阻值、w–r 近 0Ω。
     */
    getResistances() {
        const R = Math.max(this.totalResistance || 10000, 1);
        const p = Math.min(1, Math.max(0, this.position));
        return {
            rUp:   Math.max(p * R, 0.05),          // l – w
            rDown: Math.max((1 - p) * R, 0.05),    // w – r
        };
    }

    getConfigFields() {
        return [
            { label: '器件名称', key: 'id', type: 'text' },
            { label: '总阻值 (Ω)', key: 'totalResistance', type: 'number' },
            { label: '滑臂位置 (0~1)', key: 'position', type: 'number', min: 0, max: 1, step: 0.05 },
            { label: '点击步进量', key: 'stepPercent', type: 'select', options: [
                { label: '1%', value: 0.01 },
                { label: '5%', value: 0.05 },
                { label: '10%', value: 0.1 },
            ] },
        ];
    }

    onConfigUpdate(cfg) {
        if (cfg.id !== undefined) this.id = cfg.id;
        if (cfg.totalResistance !== undefined) this.totalResistance = parseFloat(cfg.totalResistance);
        if (cfg.position !== undefined) this.position = Math.min(1, Math.max(0, parseFloat(cfg.position)));
        if (cfg.stepPercent !== undefined) this.stepPercent = parseFloat(cfg.stepPercent);
        this.config = { ...this.config, ...cfg };
        this.update();
    }

    destroy() {
        super.destroy?.();
    }
}
