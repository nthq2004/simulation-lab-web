import { BaseComponent } from './BaseComponent.js';

const COLOR_MAP = {
    red:    { lens: '#e74c3c', glow: '#e74c3c', highlight: '#ffcccc', label: '#e74c3c', name: '红色' },
    green:  { lens: '#2ecc71', glow: '#2ecc71', highlight: '#a8e6cf', label: '#2ecc71', name: '绿色' },
    yellow: { lens: '#f1c40f', glow: '#f1c40f', highlight: '#f9e79f', label: '#d4ac0d', name: '黄色' },
    blue:   { lens: '#3498db', glow: '#3498db', highlight: '#aed6f1', label: '#3498db', name: '蓝色' },
    white:  { lens: '#f0f0f0', glow: '#ffffff', highlight: '#ffffff', label: '#888',     name: '白色' },
    orange: { lens: '#e67e22', glow: '#e67e22', highlight: '#f5b07c', label: '#e67e22', name: '橙色' },
};

export class RealLED extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);
        this.type = 'led';
        this.cache = 'fixed';
        this._initGroups();

        this.vForward = config.vForward || 2.0;
        this.rOn = 0.5;
        this.rOff = 1e8;
        this.ledColor = config.ledColor || 'red';
        this._brightness = 0;
        this._burnedOut = false;
        this._burnOutFrames = 0;

        this.config = { id: this.id, vForward: this.vForward, ledColor: this.ledColor };

        this.initVisuals();
        this.initPorts();
    }

    initPorts() {
        this.addPort(-40, 0, 'l', 'wire', 'p');
        this.addPort(40, 0, 'r', 'wire');
    }

    get _color() {
        return COLOR_MAP[this.ledColor] || COLOR_MAP.red;
    }

    initVisuals() {
        const c = this._color;

        this._staticGroup.add(new Konva.Line({
            points: [-40, 0, -14, 0],
            stroke: '#aeb6bf', strokeWidth: 3, lineCap: 'round'
        }));
        this._staticGroup.add(new Konva.Line({
            points: [14, 0, 40, 0],
            stroke: '#aeb6bf', strokeWidth: 3, lineCap: 'round'
        }));

        this._buildDynamicParts();

        this.burnMark = new Konva.Line({
            points: [-6, -6, 6, 6],
            stroke: '#000', strokeWidth: 0, lineCap: 'round', listening: false
        });
        this._dynamicGroup.add(this.burnMark);

        this._staticGroup.add(new Konva.Rect({
            x: -14, y: -6, width: 28, height: 12,
            fill: '#888', cornerRadius: 2, stroke: '#555', strokeWidth: 0.5, listening: false
        }));
        this._staticGroup.add(new Konva.Line({
            points: [-14, -6, -14, 6],
            stroke: '#ddd', strokeWidth: 2, listening: false
        }));

        this.paramLabel = new Konva.Text({
            x: -30, y: -35, width: 60,
            text: this.vForward.toFixed(1) + 'V',
            fontSize: 10, fill: c.label, fontStyle: 'bold',
            align: 'center', listening: false
        });
        this._staticGroup.add(this.paramLabel);
    }

    _buildDynamicParts() {
        this._dynamicGroup.destroyChildren();

        const c = this._color;

        this.glowCircle = new Konva.Circle({
            x: 0, y: 0, radius: 22,
            fill: c.glow,
            opacity: 0,
            listening: false
        });

        this.ledLens = new Konva.Circle({
            x: 0, y: 0, radius: 14,
            fill: c.lens,
            stroke: '#333', strokeWidth: 1.5,
            opacity: 0.35,
            listening: false
        });

        this.lensHighlight = new Konva.Ellipse({
            x: -4, y: -5, radiusX: 6, radiusY: 4,
            fill: c.highlight, opacity: 0.15, listening: false
        });

        this._dynamicGroup.add(this.glowCircle, this.ledLens, this.lensHighlight);
    }

    getConfigFields() {
        return [
            { label: '器件名称', key: 'id', type: 'text' },
            { label: '导通压降 (V)', key: 'vForward', type: 'number' },
            {
                label: 'LED 颜色', key: 'ledColor', type: 'select',
                options: [
                    { value: 'red', label: '红色' },
                    { value: 'green', label: '绿色' },
                    { value: 'yellow', label: '黄色' },
                    { value: 'blue', label: '蓝色' },
                    { value: 'white', label: '白色' },
                    { value: 'orange', label: '橙色' },
                ]
            },
        ];
    }

    onConfigUpdate(cfg) {
        if (cfg.id !== undefined) this.id = cfg.id;
        if (cfg.vForward !== undefined) {
            this.vForward = cfg.vForward;
            this._updateLabel();
        }
        if (cfg.ledColor !== undefined && cfg.ledColor !== this.ledColor) {
            this.ledColor = cfg.ledColor;
            this._buildDynamicParts();
            this._updateLabel();
        }
        this.config = cfg;
        this._refreshCache();
    }

    tick(dt) {
        if (this._burnedOut) {
            this.glowCircle.opacity(0);
            this.ledLens.fill('#555');
            this.ledLens.opacity(0.6);
            this.lensHighlight.opacity(0);
            this.burnMark.strokeWidth(2);
            return;
        }

        const current = Math.abs(this.physCurrent || 0);

        if (current > 0.05) {
            this._burnOutFrames++;
            if (this._burnOutFrames > 10) {
                this._burnedOut = true;
                return;
            }
        } else {
            this._burnOutFrames = 0;
        }

        const targetBrightness = current < 0.001 ? 0 : Math.min(1, (current - 0.001) / 0.009);
        this._brightness += (targetBrightness - this._brightness) * 0.15;

        if (this._brightness < 0.01) {
            this.glowCircle.opacity(0);
            this.ledLens.fill(this._color.lens);
            this.ledLens.opacity(0.35);
            this.lensHighlight.opacity(0.15);
        } else {
            this.glowCircle.opacity(0.15 * this._brightness);
            this.ledLens.fill(this._color.lens);
            this.ledLens.opacity(0.35 + 0.65 * this._brightness);
            this.lensHighlight.opacity(0.15 + 0.55 * this._brightness);
        }
    }

    _updateLabel() {
        if (this.paramLabel) {
            this.paramLabel.text(this.vForward.toFixed(1) + 'V');
            this.paramLabel.fill(this._color.label);
            this.markDirty();
        }
    }

    destroy() {
        super.destroy?.();
    }
}
