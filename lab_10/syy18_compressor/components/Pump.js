import { BaseComponent } from './BaseComponent.js';

/**
 * Pump - 带有集成控制箱的水泵组件
 *
 * 视觉特征：整体外框、三叶片叶轮、控制箱内启停按钮（带灯）。
 *
 * 遵循新组件模板：
 *   构造函数 `_initGroups → _recalcGeometry → _initParameters → _init`，
 *   `_init` 内 `_drawStaticParts` + `_createDynamicNodes` + `_bindInteraction`，最后 `addPort`。
 *   · 静态外框/控制箱面板/文字入 `_staticGroup`（缓存一次）；
 *   · 泵壳、叶轮、按钮指示灯入 `_dynamicGroup`，tick 中 in-place 更新；
 *   · 启停按钮的命中区用 `addClickablePart` 注册（`_interactGroup`），并绑定真实操作；
 *   · 无 shadow 三件套。
 */
export class Pump extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.type = 'Pump';
        this.cache = 'fixed';

        this._initGroups();
        this._recalcGeometry(config);
        this._initParameters(config);
        this._init();

        this.config = { id: this.id, pumpFlow: this.pumpFlow };

        // 端口位置相对于 group 中心，确保与泵壳边缘对齐
        this.addPort(this.pumpOffX, -50, 'i', 'pipe', 'in');
        this.addPort(this.pumpOffX, 50, 'o', 'pipe');
    }

    // ═══════════════════════════════════════════════════════
    // 几何 / 参数
    // ═══════════════════════════════════════════════════════

    _recalcGeometry() {
        this.totalW = 160;   // 整体底座宽度
        this.totalH = 100;   // 整体底座高度
        this.boxW = 60;      // 左侧控制箱宽度
        this.pumpOffX = 35;  // 泵体相对于中心的偏移
    }

    _initParameters(config) {
        this.pumpOn = false;   // 泵的状态：开/关
        this.pumpFlow = config.pumpFlow !== undefined ? config.pumpFlow : 1; // 干路流量设定 0~1
        this._lastPumpState = false;
    }

    _init() {
        this._drawStaticParts();
        this._createDynamicNodes();
        this._bindInteraction();
    }

    // ═══════════════════════════════════════════════════════
    // 静态部件（底座、控制箱面板、文字标签）
    // ═══════════════════════════════════════════════════════

    _drawStaticParts() {
        const g = this._staticGroup;
        const xPos = -this.totalW / 2 + 5;
        const yPos = -this.totalH / 2 + 5;
        const boxH = this.totalH - 10;

        // 顶部文字
        g.add(new Konva.Text({ x: -this.totalW / 2 + 5, y: -this.totalH / 2 - 20, width: this.totalW, text: '高温淡水泵', fontSize: 18, align: 'center', fill: '#2c3e50', fontStyle: 'bold' }));

        // 包络矩形底座
        g.add(new Konva.Rect({
            x: -this.totalW / 2, y: -this.totalH / 2,
            width: this.totalW, height: this.totalH,
            fill: '#564b4b', stroke: '#7f8c8d', strokeWidth: 1, cornerRadius: 5,
        }));

        // 控制箱面板
        g.add(new Konva.Rect({ x: xPos, y: yPos, width: this.boxW, height: boxH, fill: '#8d949b', cornerRadius: 3 }));

        // 按钮文字（靠按钮左侧）
        const centerY = yPos + boxH / 2;
        const spacing = 25;
        g.add(new Konva.Text({ x: xPos + this.boxW / 2 + 15 - 38, y: centerY - spacing - 5, text: '启动', fontSize: 12, fill: '#ecf0f1', fontStyle: 'bold' }));
        g.add(new Konva.Text({ x: xPos + this.boxW / 2 + 15 - 38, y: centerY + spacing - 5, text: '停止', fontSize: 12, fill: '#ecf0f1', fontStyle: 'bold' }));
    }

    // ═══════════════════════════════════════════════════════
    // 动态节点（泵壳、叶轮、按钮指示灯）
    // ═══════════════════════════════════════════════════════

    _createDynamicNodes() {
        const d = this._dynamicGroup;

        // 泵壳底座
        this.shell = new Konva.Circle({
            x: this.pumpOffX, y: 0, radius: 35,
            fill: '#ecf0f1', stroke: '#34495e', strokeWidth: 3,
        });
        d.add(this.shell);

        // 三叶片叶轮
        this.impeller = new Konva.Group({ x: this.pumpOffX, y: 0 });
        for (let i = 0; i < 3; i++) {
            this.impeller.add(new Konva.Path({
                data: 'M 0,0 Q -12 -15 -4 -30 L 4 -30 Q 8 -10 0 0 Z',
                fillLinearGradientStartPoint: { x: -5, y: -30 },
                fillLinearGradientEndPoint: { x: 5, y: 0 },
                fillLinearGradientColorStops: [0, '#bdc3c7', 0.5, '#95a5a6', 1, '#7f8c8d'],
                stroke: '#2c3e50', strokeWidth: 1, rotation: i * 120, lineJoin: 'round',
            }));
        }
        this.impeller.add(new Konva.Circle({ radius: 6, fill: '#7f8c8d', stroke: '#2c3e50', strokeWidth: 1 }));
        d.add(this.impeller);

        // 启停按钮（圆体 + 中心指示灯）
        this.btnStart = this._makeButton(-30, -25, '#27ae60');
        this.btnStop = this._makeButton(-30, 25, '#e74c3c');
        d.add(this.btnStart.group, this.btnStop.group);
    }

    _makeButton(x, y, color) {
        const group = new Konva.Group({ x, y });
        const circle = new Konva.Circle({ radius: 11, fill: '#bdc3c7', stroke: '#000', strokeWidth: 1 });
        const light = new Konva.Circle({ radius: 7, fill: '#333' });
        group.add(circle, light);
        return { group, light, color };
    }

    // ═══════════════════════════════════════════════════════
    // 交互（可识别部件 + 启停操作）
    // ═══════════════════════════════════════════════════════

    _bindInteraction() {
        const startHit = this.addClickablePart('start', -42, -37, 24, 24);
        startHit.on('click tap', () => {
            const pt = this.sys.comps.pt;
            if (!pt || pt.checkPipesReady()) this.pumpOn = true;
        });

        const stopHit = this.addClickablePart('stop', -42, 13, 24, 24);
        stopHit.on('click tap', () => { this.pumpOn = false; });

        // 泵体整体（供演示箭头指示）
        this.addClickablePart('pump', 0, -35, 70, 70);
    }

    // ═══════════════════════════════════════════════════════
    // 主循环
    // ═══════════════════════════════════════════════════════

    tick(dt) {
        this.update(this.pumpOn);
        this._refreshIfDirty();
    }

    update(isOn) {
        const changed = this._lastPumpState !== isOn;
        this._lastPumpState = isOn;

        if (isOn) {
            // 叶轮旋转
            this.impeller.rotate(30);
            this.shell.stroke('#3498db');

            // 按钮灯光状态：启动亮，停止暗（in-place，无 shadow）
            this.btnStart.light.fill(this.btnStart.color);
            this.btnStop.light.fill('#333');

            const pt = this.sys.comps.pt;
            if (pt && !pt.checkPipesReady()) this.pumpOn = false;
        } else if (changed) {
            this.shell.stroke('#34495e');
            this.btnStart.light.fill('#333');
            this.btnStop.light.fill(this.btnStop.color);
        }
    }

    // ═══════════════════════════════════════════════════════
    // 配置
    // ═══════════════════════════════════════════════════════

    getConfigFields() {
        return [
            { label: 'id', key: 'id', type: 'text' },
            { label: '干路流量设定 (0~1)', key: 'pumpFlow', type: 'number' },
        ];
    }

    onConfigUpdate(newConfig) {
        if (newConfig.id) this.id = newConfig.id;
        if (newConfig.pumpFlow !== undefined) {
            this.pumpFlow = Math.max(0, Math.min(1, parseFloat(newConfig.pumpFlow)));
        }
        this.config = { ...this.config, id: this.id, pumpFlow: this.pumpFlow };
    }

    destroy() {
        super.destroy?.();
    }
}
