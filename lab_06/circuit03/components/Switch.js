import { BaseComponent } from './BaseComponent.js';

export class Switch extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this._initGroups();
        this.type = 'switch';
        this.cache = 'fixed';

        this._isOn = config.isOn !== undefined ? config.isOn : false;
        this._animating = false;
        this._animT = 0;
        this._animDur = 0.1;
        this._animDir = 1;
        this._switchAngle = this._isOn ? 0 : 35;

        const W = 100, H = 50;
        this.width = W;
        this.height = H;

        const armLen = 36;
        const portX = 44 * this.scale;

        const leadL = new Konva.Line({
            points: [-portX, 0, -12 * this.scale, 0],
            stroke: '#666', strokeWidth: 2 * this.scale, lineCap: 'round',
        });
        const leadR = new Konva.Line({
            points: [12 * this.scale, 0, portX, 0],
            stroke: '#666', strokeWidth: 2 * this.scale, lineCap: 'round',
        });
        this._staticGroup.add(leadL, leadR);

        const dotL = new Konva.Circle({
            x: -12 * this.scale, y: 0, radius: 4 * this.scale,
            fill: '#888', stroke: '#555', strokeWidth: 1,
        });
        const dotR = new Konva.Circle({
            x: 12 * this.scale, y: 0, radius: 4 * this.scale,
            fill: '#888', stroke: '#555', strokeWidth: 1,
        });
        this._staticGroup.add(dotL, dotR);

        this._armGroup = new Konva.Group({
            x: -12 * this.scale, y: 0,
            rotation: this._switchAngle,
        });
        this._armLine = new Konva.Line({
            points: [0, 0, 24 * this.scale, 0],
            stroke: '#c0392b', strokeWidth: 2.5 * this.scale, lineCap: 'round',
        });
        this._armGroup.add(this._armLine);
        this._staticGroup.add(this._armGroup);

        this._closedLine = new Konva.Line({
            points: [-12 * this.scale, 0, 12 * this.scale, 0],
            stroke: '#27ae60', strokeWidth: 2 * this.scale, lineCap: 'round',
            visible: this._isOn,
        });
        this._staticGroup.add(this._closedLine);

        this._label = new Konva.Text({
            x: -20 * this.scale, y: -28 * this.scale,
            text: this._isOn ? '合' : '分',
            fontSize: 12 * this.scale, fontStyle: 'bold',
            fill: this._isOn ? '#27ae60' : '#c0392b',
        });
        this._staticGroup.add(this._label);

        const hitArea = new Konva.Rect({
            x: -W / 2, y: -H / 2, width: W, height: H, fill: 'transparent',
        });
        hitArea.on('click tap', () => this.toggle());
        this._interactGroup.add(hitArea);

        this.addPort(-portX, 0, 'l', 'wire');
        this.addPort(portX, 0, 'r', 'wire');

        this.config = { id: this.id, isOn: this._isOn };
    }

    toggle() {
        if (this._animating) return;
        this._animDir = this._isOn ? -1 : 1;
        this._animT = 0;
        this._animating = true;
    }

    tick(dt) {
        if (this._animating) {
            this._animT += dt / this._animDur;
            if (this._animT >= 1) {
                this._animT = 1;
                this._animating = false;
                this._isOn = this._animDir > 0;
            }
            const ease = 0.5 - 0.5 * Math.cos(this._animT * Math.PI);
            this._switchAngle = 35 * (1 - ease);
            if (this._animDir < 0) {
                this._switchAngle = 35 * ease;
            }
            this._armGroup.rotation(this._switchAngle);
            this._closedLine.visible(this._switchAngle < 5);
            this._label.text(this._switchAngle < 5 ? '合' : '分');
            this._label.fill(this._switchAngle < 5 ? '#27ae60' : '#c0392b');
            this.markDirty();
        }
        this._refreshIfDirty();
    }

    get isOn() { return this._isOn; }
    set isOn(val) {
        this._isOn = !!val;
        this._syncVisuals();
    }

    _syncVisuals() {
        if (this._isOn) {
            this._switchAngle = 0;
            this._armGroup.rotation(0);
            this._closedLine.visible(true);
            this._label.text('合');
            this._label.fill('#27ae60');
        } else {
            this._switchAngle = 35;
            this._armGroup.rotation(35);
            this._closedLine.visible(false);
            this._label.text('分');
            this._label.fill('#c0392b');
        }
        this.markDirty();
        this._refreshIfDirty();
    }

    getValue() {
        return this._isOn ? 0 : Infinity;
    }

    getConfigFields() {
        return [
            { label: '名称', key: 'id', type: 'text' },
            { label: '初始状态（合=1）', key: 'isOn', type: 'number' },
        ];
    }

    onConfigUpdate(cfg) {
        if (cfg.isOn !== undefined) {
            const want = !!parseInt(cfg.isOn);
            if (want !== this.isOn) this.toggle();
        }
        this.config = { ...this.config, ...cfg };
    }

    destroy() {
        super.destroy?.();
    }
}
