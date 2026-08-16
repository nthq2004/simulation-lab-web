import { BaseComponent } from './BaseComponent.js';

export class DiagramStopButton extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.width  = Math.max(80, config.width  || 100);
        this.height = Math.max(80, config.height || 80);

        this.type    = 'PUSHBUTTON';
        this.special = 'STOP-BTN';
        this.cache   = 'fixed';

        this._isPressed = false;
        this._curBladeAng = 2;
        this._contactR = 5;

        this._initGroups();
        this._recalcGeometry();
        this._initParameters(config);
        this._init();

        this.config = { id: this.id, label: this.label };

        this.addPort(2, this.height / 2 - 10, 'nc3', 'wire');
        this.addPort(this.width - 2, this.height / 2 - 10, 'nc4', 'wire', 'p');
    }

    _recalcGeometry() {
        const W = this.width, H = this.height;
        this._cx = W / 2;
        // 左右静触点间距缩至原 2/3（端子位置不变，触点向中心收拢）
        const _gap = (W - 40) * 2 / 3;
        this._leftX = (W - _gap) / 2;
        this._rightX = (W + _gap) / 2;
        this._pivotY = H / 2 - 10;
        this._contactInY = this._pivotY - 20;
    }

    _initParameters(config) {
        this.label = config.label || 'SB';
    }

    _init() {
        this._drawStaticParts();
        this._createDynamicNodes();
        this._bindInteraction();
    }

    _drawStaticParts() {
        const W = this.width, H = this.height;
        const cy = this._pivotY;
        const poleColor = '#e03030';

        // 左端子 → 左静触头
        this._staticGroup.add(new Konva.Line({
            points: [2, cy, this._leftX, cy],
            stroke: poleColor, strokeWidth: 2,
        }));

        // 右端子 → 右静触头
        this._staticGroup.add(new Konva.Line({
            points: [this._rightX, cy, W - 2, cy],
            stroke: poleColor, strokeWidth: 2,
        }));

        // 左静触头（小圆点）
        this._staticGroup.add(new Konva.Circle({
            x: this._leftX, y: cy, radius: 4,
            fill: poleColor, stroke: '#908030', strokeWidth: 0.8,
        }));

        // 右静触头（小圆点）
        this._staticGroup.add(new Konva.Circle({
            x: this._rightX, y: cy, radius: 4,
            fill: poleColor, stroke: '#908030', strokeWidth: 0.8,
        }));

        // 端子圆点
        this._drawTerminal(2, cy, poleColor);
        this._drawTerminal(W - 2, cy, poleColor);

        // 倒山字按钮帽（底部，红色）
        this._drawButtonCap(this._cx, H - 20, poleColor);

        // 标签
        this._staticGroup.add(new Konva.Text({
            x: 0, y: 10, width: W,
            text: this.label, fontSize: 14, fill: '#333', align: 'center',fontStyle:'bold',
        }));
    }

    _drawButtonCap(cx, y, color) {
        const hatH = 13;
        const sideH = 11;

        // 底部横线
        this._staticGroup.add(new Konva.Line({
            points: [cx - 14, y, cx + 14, y],
            stroke: color, strokeWidth: 2.5,
        }));
        // 左竖线（高）
        this._staticGroup.add(new Konva.Line({
            points: [cx - 14, y, cx - 14, y - sideH],
            stroke: color, strokeWidth: 2,
        }));
        // 中竖线（高）
        this._staticGroup.add(new Konva.Line({
            points: [cx, y, cx, y - hatH],
            stroke: color, strokeWidth: 2,
        }));
        // 右竖线（高）
        this._staticGroup.add(new Konva.Line({
            points: [cx + 14, y, cx + 14, y - sideH],
            stroke: color, strokeWidth: 2,
        }));
    }

    _drawTerminal(x, y, color) {
        this._staticGroup.add(new Konva.Circle({
            x, y, radius: 4,
            fillLinearGradientStartPoint: { x: -4, y: -4 },
            fillLinearGradientEndPoint:   { x: 4, y: 4 },
            fillLinearGradientColorStops: [0, '#d8c870', 0.5, '#f0e090', 1, '#b8a858'],
            stroke: '#908030', strokeWidth: 1,
        }));
    }

    _createDynamicNodes() {
        const cx = this._cx;

        // 推杆虚线（从按钮帽到旋转点）
        this._plungerLine = new Konva.Line({
            points: [cx, this.height - 30, cx, this._pivotY-2 ],
            stroke: '#e03030', strokeWidth: 1.5,
            dash: [4, 3],
        });
        this._dynamicGroup.add(this._plungerLine);

        // 旋转触点臂（围绕右端子旋转，NC初始闭合）
        this._bladeGroup = new Konva.Group({
            x: this._rightX,
            y: this._pivotY,
            rotation: 5,
        });

        // 刀片线
        this._bladeGroup.add(new Konva.Line({
            points: [0, 0, -(this._rightX - this._leftX), 0],
            stroke: '#e03030', strokeWidth: 2.5, lineCap: 'round',
        }));

        // 动触点小半圆（面向左侧静触点）
        this._bladeGroup.add(new Konva.Arc({
            x: -(this._rightX - this._leftX), y: 0,
            innerRadius: 0, outerRadius: this._contactR,
            angle: 180, rotation: 0,
            fill: '#e8c86a', stroke: '#e03030', strokeWidth: 1.5,
        }));

        this._dynamicGroup.add(this._bladeGroup);
    }

    _bindInteraction() {
        const hitArea = new Konva.Rect({
            x: this._cx - 20, y: this.height - 35,
            width: 40, height: 30,
            fill: 'transparent',
        });
        hitArea.on('mousedown touchstart', (e) => {
            e.cancelBubble = true;
            this._isPressed = true;
            this._curBladeAng = 22.5;
            this._bladeGroup.rotation(22.5);
            this._updatePlunger();
        });
        hitArea.on('mouseup touchend', (e) => {
            e.cancelBubble = true;
            this._isPressed = false;
            this._curBladeAng = 5;
            this._bladeGroup.rotation(5);
            this._updatePlunger();
        });
        hitArea.on('mouseenter', () => { document.body.style.cursor = 'pointer'; });
        hitArea.on('mouseleave', () => {
            document.body.style.cursor = 'default';
            if (this._isPressed) {
                this._isPressed = false;
                this._curBladeAng = 5;
                this._bladeGroup.rotation(5);
                this._updatePlunger();
            }
        });
        this._interactGroup.add(hitArea);
    }

    _updatePlunger() {
        const cy = this._pivotY;
        const rad = this._curBladeAng * Math.PI / 180;
        const armLen = this._rightX - this._leftX;
        const tipY = cy - armLen * Math.sin(rad);
        this._plungerLine.points([this._cx, this.height - 25, this._cx, tipY+5]);
    }

    getValue() {
        return this._isPressed ? 10000000 : 0.01;
    }

    tick(dt) {}

    getConfigFields() {
        return [{ label: '位号', key: 'label', type: 'text' }];
    }

    onConfigUpdate(cfg) {
        if (cfg.label !== undefined) this.label = cfg.label;
        this.config = { ...this.config, ...cfg };
        this._staticGroup.destroyChildren();
        this._dynamicGroup.destroyChildren();
        this._drawStaticParts();
        this._createDynamicNodes();
        this._refreshCache?.();
    }

    destroy() { super.destroy?.(); }
}
