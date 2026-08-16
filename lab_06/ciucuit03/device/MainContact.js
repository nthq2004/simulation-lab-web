import { BaseComponent } from '../components/BaseComponent.js';
import { ContactorDevice } from './ContactorDevice.js';

export class MainContact extends BaseComponent {
    static DeviceClass = ContactorDevice;

    constructor(config, sys) {
        super(config, sys);

        this.width  = Math.max(120, config.width  || 160);
        this.height = Math.max(80, config.height || 120);

        this.type  = 'ContactorDevice';
        this.special = 'maincontacts';
        this.cache = 'fixed';

        this._isClosed = false;
        this._animT = 0;
        this._animDur = 0.12;
        this._animating = false;
        this._bridgeOffset = 0;

        this._contactR = 6;
        // 上下静触点间距缩至原 2/3（对称分布于组件中心）
        this._bladeLen = Math.floor((this.height / 2 - 8) * 2 / 3);
        this._contactInY = (this.height - this._bladeLen) / 2;
        this._contactOutY = (this.height + this._bladeLen) / 2;
        this._curBladeAng = -40;

        this._initGroups();
        this._recalcSlots();
        this._drawStatic();
        this._createDynamic();
        this._init();

        this.config = { deviceid: config.deviceid };

        this.addPort(this._slots[0].cx, 2, 'l1', 'wire');
        this.addPort(this._slots[1].cx, 2, 'l2', 'wire');
        this.addPort(this._slots[2].cx, 2, 'l3', 'wire');
        this.addPort(this._slots[0].cx, this.height - 2, 't1', 'wire', 'p');
        this.addPort(this._slots[1].cx, this.height - 2, 't2', 'wire', 'p');
        this.addPort(this._slots[2].cx, this.height - 2, 't3', 'wire', 'p');
    }

    _recalcSlots() {
        const W = this.width, H = this.height;
        const margin = 15;
        const slotW = (W - margin * 2) / 3;
        this._slots = [];
        for (let i = 0; i < 3; i++) {
            this._slots.push({
                cx: 10+(i + 0.5) * slotW,
                color: ['#e03030', '#20a030', '#2050e0'][i],
                topLabel: ['L1', 'L2', 'L3'][i],
                botLabel: ['T1', 'T2', 'T3'][i],
            });
        }
        this._shaftY = H / 2;
        this._bridgeLen = W - margin * 2 - 10;
        this._bridgeOpen = 18;
    }

    _drawStatic() {
        const W = this.width, H = this.height;

        const frame = new Konva.Rect({
            x: 0, y: 0, width: W, height: H,
            stroke: '#888', strokeWidth: 1.5, cornerRadius: 4,
            fill: '#fafaf5',
        });
        this._staticGroup.add(frame);

        this._label = new Konva.Text({
            x: W - 36, y: H / 2 - 10,
            text: this.config.deviceid || 'KM', fontSize: 16, fontStyle: 'bold',
            fill: '#333',
        });
        this._staticGroup.add(this._label);

        const topY = this._contactInY;
        const botY = this._contactOutY;

        this._slots.forEach((slot, i) => {
            const cx = slot.cx;

            this._staticGroup.add(new Konva.Line({
                points: [cx, 2, cx, topY - this._contactR],
                stroke: slot.color, strokeWidth: 2, lineCap: 'round',
            }));
            this._staticGroup.add(new Konva.Line({
                points: [cx, botY, cx, H - 2],
                stroke: slot.color, strokeWidth: 2, lineCap: 'round',
            }));

            this._staticGroup.add(new Konva.Arc({
                x: cx, y: topY,
                innerRadius: 0, outerRadius: this._contactR,
                angle: 180, rotation: 90,
                fill: '#e8c86a', stroke: slot.color, strokeWidth: 1.5,
            }));

            this._staticGroup.add(new Konva.Text({
                x: cx + 6, y: 16,
                text: slot.topLabel, fontSize: 12, fontStyle: 'bold', fill: slot.color,
            }));

            this._staticGroup.add(new Konva.Text({
                x: cx + 6, y: H - 36,
                text: slot.botLabel, fontSize: 12, fontStyle: 'bold', fill: slot.color,
            }));
        });
    }

    _createDynamic() {
        this._bladeGroups = this._slots.map((slot, i) => {
            const color = slot.color;
            const g = new Konva.Group({
                x: slot.cx,
                y: this._contactOutY,
                rotation: this._curBladeAng,
            });

            g.add(new Konva.Line({
                points: [0, 0, 0, -this._bladeLen],
                stroke: color, strokeWidth: 2.5,
                lineCap: 'round',
                listening: false,
            }));

            g.add(new Konva.Arc({
                x: 0, y: -this._bladeLen,
                innerRadius: 0, outerRadius: this._contactR,
                angle: 180, rotation: -90,
                fill: '#e8c86a', stroke: color, strokeWidth: 1.5,
                listening: false,
            }));

            this._dynamicGroup.add(g);
            return g;
        });

        this._bridgeOff = this._bridgeOpen;
    }

    _init() {
        const hitArea = new Konva.Rect({
            x: 0, y: 0, width: this.width, height: this.height,
            fill: 'transparent',
        });
        hitArea.on('click tap', (e) => {
            if (e.evt?.button === 2) return;  // 右键仅弹出右键菜单
            e.cancelBubble = true;
            if (this.deviceRef) {
                this.deviceRef.setManualOverride(!this.deviceRef.getManualOverride());
            }
        });
        hitArea.on('mouseenter', () => { document.body.style.cursor = 'pointer'; });
        hitArea.on('mouseleave', () => { document.body.style.cursor = 'default'; });
        this._interactGroup.add(hitArea);
    }

    getValue() {
        return this._isClosed ? 0.001 : 10000000;
    }

    tick(dt) {
        const pickup = this.deviceRef ? this.deviceRef.getContactClosed() : false;
        const CLOSED_ANG = 9;
        const targetAng = pickup ? -CLOSED_ANG : -40;

        if (Math.abs(this._curBladeAng - targetAng) > 0.5) {
            const diff = targetAng - this._curBladeAng;
            this._curBladeAng += diff * 0.30;
            if (Math.abs(this._curBladeAng - targetAng) < 0.5) {
                this._curBladeAng = targetAng;
            }
        }

        this._isClosed = Math.abs(this._curBladeAng - (-CLOSED_ANG)) < 2;

        this._bladeGroups.forEach(g => {
            g.rotation(this._curBladeAng);
        });

        this.markDirty();
        this._refreshIfDirty();
    }

    getConfigFields() {
        return [];
    }

    onConfigUpdate(cfg) {
        this.config = { ...this.config, ...cfg };
    }

    destroy() { super.destroy?.(); }
}