import { BaseComponent } from './BaseComponent.js';

/**
 * VariResistor — 可变电阻（滑动型）组件
 *
 * 提供可交互调整电阻值：点击步进 / 拖动滑块；支持水平或垂直布局。
 *
 * 遵循新组件模板：`_initGroups → _recalcGeometry → _initParameters → _init`，
 * `_init` 内 `_drawStaticParts` + `_createDynamicNodes` + `_bindInteraction`，最后 `addPort`。
 * 无阴影；引线/滑块/标签在 `_dynamicGroup` / `_interactGroup`，in-place 更新。
 */
export class VariResistor extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.width = 80;
        this.height = 25;
        this.type  = 'resistor';
        this.cache = 'fixed';

        this._initGroups();
        this._recalcGeometry();
        this._initParameters(config);
        this._init();

        this.config = { id: this.id, maxResistance: this.maxResistance, currentResistance: this.currentResistance, stepPercent: this.stepPercent };

        this.addPort(-24, this.height / 2, 'l', 'wire', 'p');
        this.addPort(this.width + 24, this.height / 2, 'r', 'wire');

        if (config.direction === 'vertical') this.group.rotate(90);
    }

    // ═══════════════════════════════════════════════════════
    // 几何 / 参数
    // ═══════════════════════════════════════════════════════

    _recalcGeometry() {
        this._leadLx = -24;
        this._leadRx = this.width + 24;
        this._midY = this.height / 2;
    }

    _initParameters(config) {
        this.maxResistance = config.value || 385.1;
        this.currentResistance = config.cvalue || 100;
        this.stepPercent = 0.01;
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
        // 电阻主体（无阴影）
        this.body = new Konva.Rect({
            width: this.width, height: this.height,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint: { x: 0, y: this.height },
            fillLinearGradientColorStops: [0, '#d1d1d1', 0.5, '#fdfdfd', 1, '#b5b5b5'],
            stroke: '#555', strokeWidth: 1.5, cornerRadius: 2,
        });
        this._staticGroup.add(this.body);

        // 引出线
        this._staticGroup.add(new Konva.Line({ points: [this._leadLx, this._midY, 0, this._midY], stroke: '#409c72', strokeWidth: 6 }));
        this._staticGroup.add(new Konva.Line({ points: [this.width, this._midY, this._leadRx, this._midY], stroke: '#42c9b5', strokeWidth: 6 }));

        // 可识别部件
        this.addClickablePart('slider', this.width / 2 - 20, -25, 40, 40);
        this.addClickablePart('l', this._leadLx - 8, this._midY - 12, 16, 24);
        this.addClickablePart('r', this._leadRx - 8, this._midY - 12, 16, 24);
    }

    // ═══════════════════════════════════════════════════════
    // 动态节点
    // ═══════════════════════════════════════════════════════

    _createDynamicNodes() {
        const startX = this.width * this.currentResistance / this.maxResistance;

        this.connectorLine = new Konva.Line({
            points: [this.width, this._midY, this.width + 10, this._midY, this.width + 10, -20, startX, -20, startX, 0],
            stroke: '#333', strokeWidth: 3, lineJoin: 'round', lineCap: 'round',
        });
        this._dynamicGroup.add(this.connectorLine);

        this.arrow = new Konva.Group({
            x: startX, y: -5,
            draggable: true,
            dragBoundFunc: (pos) => {
                const transform = this.group.getAbsoluteTransform().copy();
                transform.invert();
                const localPos = transform.point(pos);
                const newX = Math.max(0, Math.min(this.width, localPos.x));
                const absTransform = this.group.getAbsoluteTransform();
                return absTransform.point({ x: newX, y: -5 });
            },
        });
        this.arrow.add(new Konva.Arrow({
            points: [0, -15, 0, 10], pointerLength: 10, pointerWidth: 10,
            fill: '#2c3e50', stroke: '#2c3e50', strokeWidth: 3,
        }));
        this.valLabel = new Konva.Text({
            text: `${this.currentResistance.toFixed(2)}Ω`, fontSize: 14, fontStyle: 'bold',
            y: -35, x: -35, width: 100, align: 'center', fill: '#e67e22',
        });
        this.arrow.add(this.valLabel);
        this._interactGroup.add(this.arrow);
    }

    // ═══════════════════════════════════════════════════════
    // 交互
    // ═══════════════════════════════════════════════════════

    _bindInteraction() {
        this.body.on('click tap', (e) => {
            const stage = this.sys.layer.getStage();
            const pointerPos = stage.getPointerPosition();
            const transform = this.group.getAbsoluteTransform().copy();
            transform.invert();
            const localPos = transform.point(pointerPos);
            const currentX = this.arrow.x();
            const stepValue = this.maxResistance * this.stepPercent;
            if (localPos.x > currentX) {
                this.currentResistance = Math.min(this.maxResistance, this.currentResistance + stepValue);
            } else {
                this.currentResistance = Math.max(0, this.currentResistance - stepValue);
            }
            this.update();
        });
        this.body.on('dblclick', (e) => { e.cancelBubble = true; });

        this.arrow.on('dragmove', () => {
            this.currentResistance = (this.arrow.x() / this.width) * this.maxResistance;
            const curX = this.arrow.x();
            this.connectorLine.points([
                this.width, this._midY, this.width + 10, this._midY,
                this.width + 10, -20, curX, -20, curX, 0,
            ]);
            this.update();
        });
        this.arrow.on('mouseenter', () => this.sys.layer.getStage().container().style.cursor = 'ew-resize');
        this.arrow.on('mouseleave', () => this.sys.layer.getStage().container().style.cursor = 'default');
    }

    // ═══════════════════════════════════════════════════════
    // 动态更新
    // ═══════════════════════════════════════════════════════

    update() {
        const ratio = this.currentResistance / this.maxResistance;
        const newX = ratio * this.width;
        this.arrow.x(newX);
        this.connectorLine.points([this.width, this._midY, this.width + 10, this._midY, this.width + 10, -20, newX, -20, newX, 0]);
        this.valLabel.text(this.currentResistance.toFixed(2) + 'Ω');
        this.config = { ...this.config, currentResistance: this.currentResistance, maxResistance: this.maxResistance };
        this._refreshIfDirty();
    }

    // ═══════════════════════════════════════════════════════
    // 配置
    // ═══════════════════════════════════════════════════════

    getConfigFields() {
        return [
            { label: '器件名称', key: 'id', type: 'text' },
            { label: '阻值 (Ω)', key: 'maxResistance', type: 'number' },
            { label: '阻值 (Ω)', key: 'currentResistance', type: 'number' },
            {
                label: '点击每次步进量(%)', key: 'stepPercent', type: 'select',
                options: [
                    { label: '1% ', value: 0.01 },
                    { label: '5% ', value: 0.05 },
                    { label: '10% ', value: 0.1 },
                ],
            },
        ];
    }

    onConfigUpdate(newConfig) {
        this.config = { ...newConfig };
        this.id = newConfig.id;
        this.currentResistance = parseFloat(newConfig.currentResistance);
        this.maxResistance = parseFloat(newConfig.maxResistance);
        this.stepPercent = parseFloat(newConfig.stepPercent);
        this.update();
    }

    destroy() {
        super.destroy?.();
    }
}
