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

        // 用户自定义标签：位号 + 闭合/断开时的功能显示文字
        this.label    = config.label    || '';
        this.onLabel  = config.onLabel  || '合';
        this.offLabel = config.offLabel || '分';

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
            x: -30 * this.scale, y: -30 * this.scale, width: 60 * this.scale,
            text: this._isOn ? this.onLabel : this.offLabel,
            fontSize: 13 * this.scale, fontStyle: 'bold', align: 'center',
            fill: this._isOn ? '#27ae60' : '#c0392b',
        });
        this._staticGroup.add(this._label);

        // 位号/名称标签（位于状态文字上方）
        this._nameLabel = new Konva.Text({
            x: -40 * this.scale, y: -48 * this.scale, width: 80 * this.scale,
            text: this.label, fontSize: 11 * this.scale, align: 'center',
            fill: '#333',
        });
        this._staticGroup.add(this._nameLabel);

        const hitArea = new Konva.Rect({
            x: -W / 2, y: -H / 2, width: W, height: H, fill: 'transparent',
        });
        hitArea.on('click tap', () => this.toggle());
        this._interactGroup.add(hitArea);

        this.addPort(-portX, 0, 'l', 'wire');
        this.addPort(portX, 0, 'r', 'wire');

        this.config = { id: this.id, label: this.label, onLabel: this.onLabel, offLabel: this.offLabel, isOn: this._isOn };
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
            this._label.text(this._switchAngle < 5 ? this.onLabel : this.offLabel);
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
        this._nameLabel.text(this.label);
        if (this._isOn) {
            this._switchAngle = 0;
            this._armGroup.rotation(0);
            this._closedLine.visible(true);
            this._label.text(this.onLabel);
            this._label.fill('#27ae60');
        } else {
            this._switchAngle = 35;
            this._armGroup.rotation(35);
            this._closedLine.visible(false);
            this._label.text(this.offLabel);
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
            { label: '位号/名称标签', key: 'label', type: 'text' },
            { label: '闭合时显示', key: 'onLabel', type: 'text' },
            { label: '断开时显示', key: 'offLabel', type: 'text' },
            { label: '初始状态（合=1）', key: 'isOn', type: 'number' },
        ];
    }

    onConfigUpdate(cfg) {
        if (cfg.label !== undefined) this.label = cfg.label;
        if (cfg.onLabel !== undefined) this.onLabel = cfg.onLabel;
        if (cfg.offLabel !== undefined) this.offLabel = cfg.offLabel;
        if (cfg.isOn !== undefined) {
            const want = !!parseInt(cfg.isOn);
            if (want !== this.isOn) this.toggle();
        }
        this.config = { ...this.config, ...cfg };
        this._syncVisuals();
    }

    destroy() {
        super.destroy?.();
    }
}
