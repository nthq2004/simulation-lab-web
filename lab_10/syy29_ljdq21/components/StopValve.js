import { BaseComponent } from './BaseComponent.js';

/**
 * StopValve — 截止阀可视化组件
 *
 * 行为：有开/关状态的被动管件，提供 `isOpen` 与端口；点击手柄切换。
 * 遵循新组件模板：`_initGroups → _recalcGeometry → _initParameters → _init`，
 * `_init` 内 `_drawStaticParts` + `_createDynamicNodes` + `_bindInteraction`，最后 `addPort`。
 * 手柄（可交互/可旋转）放 `_interactGroup`，in-place 更新。
 */
export class StopValve extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.type  = 'stopValve';
        this.cache = 'fixed';

        this._initGroups();
        this._recalcGeometry(config);
        this._initParameters(config);
        this._init();

        this.config = { id: this.id, isOpen: this.isOpen, reverse: this.reverse };

        this._setupPorts();
    }

    // ═══════════════════════════════════════════════════════
    // 几何 / 参数
    // ═══════════════════════════════════════════════════════

    _recalcGeometry(config) {
        this.scale = (config.scale || 1) * (config.internalScale || 1.35);
        this.w = 120 * this.scale;
        this.h = 100 * this.scale;
        this._viewX = this.w / 2;
        this._viewY = this.h / 2;
        this._portY = this.h / 2;
    }

    _initParameters(config) {
        this.isOpen  = config.isOpen || false; // 默认关闭
        this.reverse = config.reverse || false;
    }

    _setupPorts() {
        if (this.reverse) {
            this.addPort(10 * this.scale, this._portY, 'i', 'pipe', 'in');
            this.addPort(this.w - 10 * this.scale, this._portY, 'o', 'pipe');
        } else {
            this.addPort(10 * this.scale, this._portY, 'o', 'pipe');
            this.addPort(this.w - 10 * this.scale, this._portY, 'i', 'pipe', 'in');
        }
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
        this.viewGroup = new Konva.Group({ x: this._viewX, y: this._viewY, scaleX: this.scale, scaleY: this.scale });
        this._staticGroup.add(this.viewGroup);

        const pipeW = 100, pipeH = 16;
        this.viewGroup.add(new Konva.Rect({
            x: -pipeW / 2, y: -pipeH / 2, width: pipeW, height: pipeH,
            fillLinearGradientStartPoint: { x: 0, y: -pipeH / 2 },
            fillLinearGradientEndPoint: { x: 0, y: pipeH / 2 },
            fillLinearGradientColorStops: [0, '#bbf3f7', 0.5, '#bdc3c7', 1, '#abf0f5'],
            cornerRadius: 2, stroke: '#87b574', strokeWidth: 1,
        }));
        this.viewGroup.add(new Konva.Circle({
            radius: 22,
            fillRadialGradientStartPoint: { x: -6, y: -6 },
            fillRadialGradientEndPoint: { x: 0, y: 0 },
            fillRadialGradientStartRadius: 0,
            fillRadialGradientEndRadius: 22,
            fillRadialGradientColorStops: [0, '#f5f5f5', 1, '#768187'],
            stroke: '#949696', strokeWidth: 2,
        }));

        // 可识别部件（手柄在 createDynamicNodes 中叠加于其上，保持可点击）
        this.addClickablePart('handle', this._viewX - 30, this._viewY - 80, 60, 70);
        this.addClickablePart('i', (this.reverse ? 10 * this.scale : this.w - 10 * this.scale) - 12, this._portY - 12, 24, 24);
        this.addClickablePart('o', (this.reverse ? this.w - 10 * this.scale : 10 * this.scale) - 12, this._portY - 12, 24, 24);
    }

    // ═══════════════════════════════════════════════════════
    // 动态节点（手柄）
    // ═══════════════════════════════════════════════════════

    _createDynamicNodes() {
        this._intView = new Konva.Group({ x: this._viewX, y: this._viewY, scaleX: this.scale, scaleY: this.scale });
        this._interactGroup.add(this._intView);

        this.handleGroup = new Konva.Group({ x: 0, y: 0, rotation: 0 });

        const handleBar = new Konva.Rect({
            x: -4, y: -35, width: 8, height: 30,
            fill: '#3b3f43', stroke: '#110101', strokeWidth: 1, cornerRadius: 1,
        });
        this._knob = new Konva.Circle({
            x: 0, y: -35, radius: 8,
            fill: '#e74c3c', stroke: '#c0392b', strokeWidth: 1,
        });
        const coreIndicator = new Konva.Rect({
            x: -5, y: -20, width: 10, height: 40, fill: '#454848', opacity: 1.0,
        });
        this.handleGroup.add(handleBar, this._knob, coreIndicator);
        this._intView.add(this.handleGroup);
    }

    // ═══════════════════════════════════════════════════════
    // 交互
    // ═══════════════════════════════════════════════════════

    _bindInteraction() {
        this.handleGroup.on('click tap', (e) => {
            e.cancelBubble = true;
            this.toggle();
        });
        this.handleGroup.on('mouseenter', () => (document.body.style.cursor = 'pointer'));
        this.handleGroup.on('mouseleave', () => (document.body.style.cursor = 'default'));
    }

    toggle() {
        this.isOpen = !this.isOpen;
        this.update();
    }

    // ═══════════════════════════════════════════════════════
    // 动态更新
    // ═══════════════════════════════════════════════════════

    update() {
        this.handleGroup.rotation(this.isOpen ? 90 : 0);
        if (this._knob) {
            this._knob.fill(this.isOpen ? '#4caf50' : '#e74c3c');
            this._knob.stroke(this.isOpen ? '#388e3c' : '#c0392b');
        }
        this.config = { ...this.config, isOpen: this.isOpen };
        this._refreshIfDirty();
    }

    getValue() {
        return this.isOpen;
    }

    setValue(val) {
        if (typeof val === 'boolean' && this.isOpen !== val) {
            this.isOpen = val;
            this.update();
        }
    }

    // ═══════════════════════════════════════════════════════
    // 配置
    // ═══════════════════════════════════════════════════════

    getConfigFields() {
        return [
            { label: '器件名称 (ID)', key: 'id', type: 'text' },
            {
                label: '初始状态', key: 'isOpen', type: 'select',
                options: [
                    { label: '关闭 (截断)', value: false },
                    { label: '开启 (连通)', value: true },
                ],
            },
            {
                label: '方向', key: 'reverse', type: 'select',
                options: [
                    { label: '右边入口', value: false },
                    { label: '左边入口', value: true },
                ],
            },
        ];
    }

    onConfigUpdate(newConfig) {
        if (newConfig.id) this.id = newConfig.id;
        if (newConfig.isOpen !== undefined) {
            this.isOpen = (newConfig.isOpen === 'true' || newConfig.isOpen === true);
        }
        this.config = { ...newConfig };
        this.update();
    }

    destroy() {
        super.destroy?.();
    }
}
