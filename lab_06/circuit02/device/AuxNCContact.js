import { BaseComponent } from '../components/BaseComponent.js';
import { ContactorDevice } from './ContactorDevice.js';

export class AuxNCContact extends BaseComponent {
    static DeviceClass = ContactorDevice;

    constructor(config, sys) {
        super(config, sys);

        this.width  = Math.max(40, config.width  || 60);
        this.height = Math.max(60, config.height || 80);

        this.type  = 'ContactorDevice';
        this.special = 'nccontact';
        this.cache = 'fixed';

        this._isClosed = true;
        this._bridgeOff = 0;

        this._initGroups();
        this._drawStatic();
        this._createDynamic();
        this._init();

        this.config = {};

        this.addPort(0, 8, 'com', 'wire');
        this.addPort(0, this.height - 8, 'nc', 'wire', 'p');
    }

    _drawStatic() {
        const W = this.width, H = this.height;
        const cx = W / 2;

        const frame = new Konva.Rect({
            x: 0, y: 0, width: W, height: H,
            stroke: '#888', strokeWidth: 1.5, cornerRadius: 3,
            fill: '#fafaf5',
        });
        this._staticGroup.add(frame);

        this._label = new Konva.Text({
            x: 0, y: 2, width: W,
            text: (this.config.deviceid || 'KM') + '\nNC', fontSize: 10,
            fill: '#333', align: 'center',
        });
        this._staticGroup.add(this._label);

        const topY = 20, botY = H - 20;

        this._staticGroup.add(new Konva.Line({
            points: [cx, 8 + 3, cx, topY],
            stroke: '#555', strokeWidth: 2, lineCap: 'round',
        }));
        this._staticGroup.add(new Konva.Line({
            points: [cx, botY, cx, H - 8 - 3],
            stroke: '#555', strokeWidth: 2, lineCap: 'round',
        }));

        const dotR = 5;
        this._staticGroup.add(new Konva.Arc({
            x: cx, y: topY, innerRadius: 0, outerRadius: dotR,
            angle: 180, rotation: -90,
            fill: '#209030', stroke: '#6a5a28', strokeWidth: 0.8,
        }));
        this._staticGroup.add(new Konva.Arc({
            x: cx, y: botY, innerRadius: 0, outerRadius: dotR,
            angle: 180, rotation: -90,
            fill: '#209030', stroke: '#6a5a28', strokeWidth: 0.8,
        }));

        this._staticGroup.add(new Konva.Text({
            x: cx - 12, y: topY - 14, text: 'COM', fontSize: 8, fill: '#555',
        }));
        this._staticGroup.add(new Konva.Text({
            x: cx - 10, y: H - 14, text: 'NC', fontSize: 8, fill: '#209030', fontStyle: 'bold',
        }));
    }

    _createDynamic() {
        const cx = this.width / 2;

        this._bridgeGroup = new Konva.Group({ listening: false });

        this._bridgeLine = new Konva.Line({
            points: [cx - 10, 0, cx + 10, 0],
            stroke: '#d4a848', strokeWidth: 3, lineCap: 'round',
        });
        this._bridgeGroup.add(this._bridgeLine);

        const r = 4;
        this._bridgeDotL = new Konva.Circle({
            x: cx - 10, y: 0, radius: r,
            fill: '#f0c860', stroke: '#7a6028', strokeWidth: 0.8,
        });
        this._bridgeGroup.add(this._bridgeDotL);

        this._bridgeDotR = new Konva.Circle({
            x: cx + 10, y: 0, radius: r,
            fill: '#f0c860', stroke: '#7a6028', strokeWidth: 0.8,
        });
        this._bridgeGroup.add(this._bridgeDotR);

        this._bridgeGroup.y(this.height / 2 + this._bridgeOff);
        this._dynamicGroup.add(this._bridgeGroup);
    }

    _init() {}

    getValue() {
        return this._isClosed ? 0.01 : 10000000;
    }

    tick(dt) {
        const pickup = this.deviceRef ? this.deviceRef.getContactClosed() : false;
        const targetOff = pickup ? 18 : 0;

        if (Math.abs(this._bridgeOff - targetOff) > 0.5) {
            const diff = targetOff - this._bridgeOff;
            this._bridgeOff += diff * 0.15;
            if (Math.abs(this._bridgeOff - targetOff) < 0.5) {
                this._bridgeOff = targetOff;
            }
        }

        this._isClosed = Math.abs(this._bridgeOff) < 2;
        this._bridgeGroup.y(this.height / 2 + this._bridgeOff);

        const fillClr = this._isClosed ? '#f0c860' : '#a09080';
        this._bridgeDotL.fill(fillClr);
        this._bridgeDotR.fill(fillClr);

        this.markDirty();
        this._refreshIfDirty();
    }

    getConfigFields() { return []; }

    onConfigUpdate(cfg) {
        this.config = { ...this.config, ...cfg };
    }

    destroy() { super.destroy?.(); }
}