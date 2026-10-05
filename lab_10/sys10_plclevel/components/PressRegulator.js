import { BaseComponent } from './BaseComponent.js';

/**
 * 减压/稳压器组件（PressRegulator）
 *
 * 行为：输出压力 = min(输入压力, 设定压力)；手轮可微调设定压力（滚轮/触摸）。
 * 界面：输/出管道 + 机体 + 手轮 + 两个工业 LCD 数显。
 *
 * 遵循新组件模板：`_initGroups → _recalcGeometry → _initParameters → _init`，
 * `_init` 内 `_drawStaticParts` + `_createDynamicNodes` + `_bindInteraction`，最后 `addPort`。
 * LCD 数值放 `_dynamicGroup`，手轮放 `_interactGroup`，in-place 更新。
 */
export class PressRegulator extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.type  = 'regulator';
        this.cache = 'fixed';

        this._initGroups();
        this._recalcGeometry(config);
        this._initParameters(config);
        this._init();

        this.config = { id: this.id, setPressure: this.setPressure, unit: this.displayUnit };

        const reverse = this.reverse;
        const portY = this.h / 2 + 20 * this.scale;
        if (reverse) {
            this.addPort(this.w - 10 * this.scale, portY, 'o', 'pipe');
            this.addPort(10 * this.scale, portY, 'i', 'pipe', 'in');
        } else {
            this.addPort(10 * this.scale, portY, 'o', 'pipe');
            this.addPort(this.w - 10 * this.scale, portY, 'i', 'pipe', 'in');
        }
    }

    // ═══════════════════════════════════════════════════════
    // 几何 / 参数
    // ═══════════════════════════════════════════════════════

    _recalcGeometry(config) {
        this.scale = 1.2;
        this.w = 140 * this.scale;
        this.h = 100 * this.scale;
        this._viewX = this.w / 2;
        this._viewY = this.h / 2 + 20 * this.scale;
    }

    _initParameters(config) {
        this.inputPressure  = 0;
        this.setPressure    = config.setPressure || 0;
        this.outputPressure = 0;
        this.displayUnit    = config.unit || 'MPa';
        this.reverse        = config.reverse || false;
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

        const bodyW = 40, bodyH = 40, pipeW = 120, pipeH = 40;

        const pipe = new Konva.Rect({
            x: -pipeW / 2, y: -pipeH / 2, width: pipeW, height: pipeH,
            fillLinearGradientStartPoint: { x: 0, y: -pipeH / 2 },
            fillLinearGradientEndPoint: { x: 0, y: pipeH / 2 },
            fillLinearGradientColorStops: [0, '#7f8c8d', 0.5, '#bdc3c7', 1, '#7f8c8d'],
            cornerRadius: 2, stroke: '#7f8c8d', strokeWidth: 1,
        });
        const body = new Konva.Rect({
            x: -bodyW / 2, y: -bodyH + 10, width: bodyW, height: bodyH,
            fillLinearGradientStartPoint: { x: -bodyW / 2, y: 0 },
            fillLinearGradientEndPoint: { x: bodyW / 2, y: 0 },
            fillLinearGradientColorStops: [0, '#95a5a6', 0.4, '#f5f5f5', 1, '#95a5a6'],
            cornerRadius: 3, stroke: '#7f8c8d', strokeWidth: 1,
        });
        this.viewGroup.add(pipe, body);

        // LCD 外壳（静态）
        if (this.reverse) {
            this._drawLcdShell(this.viewGroup, 25, -50, 'INPUT');
            this._drawLcdShell(this.viewGroup, -70, -50, 'OUTPUT');
        } else {
            this._drawLcdShell(this.viewGroup, -70, -50, 'OUTPUT');
            this._drawLcdShell(this.viewGroup, 25, -50, 'INPUT');
        }

        // 手轮轴（静态，连接机体顶部与手轮）
        this.viewGroup.add(new Konva.Rect({
            x: -4, y: -40, width: 8, height: 12,
            fill: '#7f8c8d', stroke: '#333', strokeWidth: 0.5,
        }));

        // 可识别部件
        const wheelWy = this._viewY + (-62) * this.scale;
        this.addClickablePart('wheel', this._viewX - 30, wheelWy - 30, 60, 60);
        this.addClickablePart('i', (this.reverse ? 10 * this.scale : this.w - 10 * this.scale) - 12, this.h / 2 + 20 * this.scale - 12, 24, 24);
        this.addClickablePart('o', (this.reverse ? this.w - 10 * this.scale : 10 * this.scale) - 12, this.h / 2 + 20 * this.scale - 12, 24, 24);
    }

    _drawLcdShell(viewGroup, x, y, label) {
        const g = new Konva.Group({ x, y });
        g.add(new Konva.Rect({ width: 45, height: 30, fill: '#34495e', cornerRadius: 1 }));
        g.add(new Konva.Rect({ x: 2, y: 2, width: 41, height: 26, fill: '#1a1a1a' }));
        g.add(new Konva.Text({ text: label, fontSize: 7, fill: '#ecf0f1', y: -8, x: 0 }));
        viewGroup.add(g);
        this._lcdSlots = this._lcdSlots || {};
        this._lcdSlots[label] = { x, y };
    }

    // ═══════════════════════════════════════════════════════
    // 动态节点
    // ═══════════════════════════════════════════════════════

    _createDynamicNodes() {
        // 与静态 viewGroup 同变换的动态组
        this._dynView = new Konva.Group({ x: this._viewX, y: this._viewY, scaleX: this.scale, scaleY: this.scale });
        this._dynamicGroup.add(this._dynView);

        const make = (slot) => new Konva.Text({
            x: slot.x, y: slot.y + 4, width: 45, text: '0.0',
            fontSize: 11, fontFamily: 'Courier New', fill: '#00ff00',
            align: 'center', fontStyle: 'bold',
        });
        if (this.reverse) {
            this.rightDisplay = make(this._lcdSlots['INPUT']);
            this.leftDisplay  = make(this._lcdSlots['OUTPUT']);
        } else {
            this.leftDisplay  = make(this._lcdSlots['OUTPUT']);
            this.rightDisplay = make(this._lcdSlots['INPUT']);
        }
        this._dynView.add(this.leftDisplay, this.rightDisplay);

        // 手轮（交互，放 _interactGroup，与静态同变换）
        this._intView = new Konva.Group({ x: this._viewX, y: this._viewY, scaleX: this.scale, scaleY: this.scale });
        this._interactGroup.add(this._intView);

        const bodyH = 40;
        const wheelCenterY = (-bodyH + 10) - 32;
        this.wheelVisual = new Konva.Group({ x: 0, y: wheelCenterY });
        for (let i = 0; i < 3; i++) {
            this.wheelVisual.add(new Konva.Rect({
                x: 0, y: 0, width: 4, height: 42, fill: '#1c5982',
                offsetX: 2, offsetY: 21, rotation: i * 60,
            }));
        }
        this.wheelVisual.add(new Konva.Ring({ innerRadius: 18, outerRadius: 25, fill: '#2980b9', stroke: '#1c5982', strokeWidth: 2 }));
        this._intView.add(this.wheelVisual);
    }

    // ═══════════════════════════════════════════════════════
    // 交互
    // ═══════════════════════════════════════════════════════

    _bindInteraction() {
        this.wheelVisual.on('wheel', (e) => {
            e.cancelBubble = true;
            const delta = e.evt.deltaY > 0 ? -0.01 : 0.01;
            this.applyDelta(delta);
        });

        let lastY = null;
        this.wheelVisual.on('touchstart', (e) => {
            e.cancelBubble = true;
            lastY = e.evt.touches[0].clientY;
        });
        this.wheelVisual.on('touchmove', (e) => {
            e.cancelBubble = true;
            const y = e.evt.touches[0].clientY;
            const dy = (lastY - y) * 0.001;
            lastY = y;
            this.applyDelta(dy);
        });
    }

    applyDelta(delta) {
        this.setPressure = Math.max(0, Math.min(10, this.setPressure + delta * 0.5));
        this.wheelVisual.rotation(this.wheelVisual.rotation() + delta * 600);
        this.update();
        if (this.sys && this.sys.onConfigChange) {
            this.sys.onConfigChange(this.config.id, { setPressure: this.setPressure });
        }
    }

    // ═══════════════════════════════════════════════════════
    // 动态更新
    // ═══════════════════════════════════════════════════════

    setValue(pIn) {
        this.inputPressure = pIn; // MPa
        this.update();
    }

    update() {
        this.outputPressure = Math.min(this.inputPressure, this.setPressure);

        const formatDisplay = (val) => {
            const v = (this.displayUnit === 'BAR') ? val * 10 : val;
            return v.toFixed(this.displayUnit === 'MPa' ? 3 : 2);
        };

        if (this.rightDisplay) this.rightDisplay.text(`${formatDisplay(this.inputPressure)}\n${this.displayUnit}`);
        if (this.leftDisplay)  this.leftDisplay.text(`${formatDisplay(this.outputPressure)}\n${this.displayUnit}`);

        const ledColor = this.outputPressure >= this.setPressure ? '#f1c40f' : '#00ff00';
        if (this.leftDisplay) this.leftDisplay.fill(ledColor);

        this.config = { ...this.config, setPressure: this.setPressure, unit: this.displayUnit };
        this._refreshIfDirty();
    }

    // ═══════════════════════════════════════════════════════
    // 配置
    // ═══════════════════════════════════════════════════════

    getConfigFields() {
        return [
            { label: '器件名称 (ID)', key: 'id', type: 'text' },
            { label: '设定压力', key: 'setPressure', type: 'number' },
            {
                label: '压力单位', key: 'unit', type: 'select',
                options: [
                    { label: 'MPa (兆帕)', value: 'MPa' },
                    { label: 'BAR (公斤)', value: 'BAR' },
                ],
            },
        ];
    }

    onConfigUpdate(newConfig) {
        if (newConfig.id) this.id = newConfig.id;
        this.displayUnit = newConfig.unit || 'MPa';
        if (newConfig.setPressure !== undefined) {
            const p = parseFloat(newConfig.setPressure);
            this.setPressure = (this.displayUnit === 'BAR') ? p / 10 : p;
        }
        this.config = { ...this.config, id: this.id, setPressure: this.setPressure, unit: this.displayUnit };
        this.update();
    }

    destroy() {
        super.destroy?.();
    }
}
