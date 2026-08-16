import { BaseComponent } from '../components/BaseComponent.js';
import { ContactorDevice } from './ContactorDevice.js';

export class ContactorCoil extends BaseComponent {
    static DeviceClass = ContactorDevice;

    constructor(config, sys) {
        super(config, sys);

        this.width  = Math.max(50, config.width  || 60);
        this.height = Math.max(40, config.height || 50);

        this.type  = 'ContactorDevice';
        this.special = 'contactcoil';
        this.cache = 'fixed';

        this._coilResistance = config.coilResistance || 1000;
        this._coilInductance = config.coilInductance || 0.5;
        this._energized = false;
        this._animT = 0;
        this._animDur = 0.12;
        this._animating = false;

        this._vBuf = new Array(20).fill(0);
        this._vBufIdx = 0;
        this._vBufSum = 0;
        this._vBufCount = 0;

        this._initGroups();
        this._drawStatic();
        this._createDynamic();
        this._init();

        this.config = {
            deviceid: config.deviceid,
            coilResistance: this._coilResistance,
            coilInductance: this._coilInductance,
        };

        const cy = this.height / 2;
        this.addPort(0, cy, 'a1', 'wire');
        this.addPort(this.width, cy, 'a2', 'wire', 'p');
    }

    _drawStatic() {
        const W = this.width, H = this.height;
        const cx = W / 2, cy = H / 2;

        this._staticFrame = new Konva.Rect({
            x: 0, y: 0, width: W, height: H,
            stroke: '#555', strokeWidth: 1.5, cornerRadius: 3,
            fill: '#f5f5f0',
        });
        this._staticGroup.add(this._staticFrame);

        this._staticGroup.add(new Konva.Text({
            x: 0, y: cy - 10, width: W,
            text: this.config.deviceid || 'KM',
            fontSize: 16, fontStyle: 'bold', fill: '#333', align: 'center',
        }));

        this._staticGroup.add(new Konva.Line({
            points: [0, cy, -8, cy],
            stroke: '#555', strokeWidth: 1.5, listening: false,
        }));
        this._staticGroup.add(new Konva.Line({
            points: [W, cy, W + 8, cy],
            stroke: '#555', strokeWidth: 1.5, listening: false,
        }));
    }

    _createDynamic() {
        const W = this.width, H = this.height;

        this._activeFrame = new Konva.Rect({
            x: -3, y: -3, width: W + 6, height: H + 6,
            stroke: '#e03030', strokeWidth: 3, cornerRadius: 5,
            visible: false,
        });
        this._dynamicGroup.add(this._activeFrame);
    }

    _init() {}

    getValue() {
        return this._coilResistance;
    }

    tick(dt) {
        if (this.deviceRef && this.sys.getVoltageBetween) {
            const vRaw = this.sys.getVoltageBetween(`${this.id}_wire_a1`, `${this.id}_wire_a2`);
            if (vRaw !== undefined && isFinite(vRaw)) {
                const v2 = vRaw * vRaw;
                const old = this._vBuf[this._vBufIdx];
                this._vBuf[this._vBufIdx] = v2;
                this._vBufSum = this._vBufSum - old + v2;
                this._vBufIdx = (this._vBufIdx + 1) % 20;
                if (this._vBufCount < 20) this._vBufCount++;

                if (this._vBufCount >= 20) {
                    const vRms = Math.sqrt(this._vBufSum / 20);
                    this.deviceRef.setVoltage(vRms);
                }
            }
        }

        const pickup = this.deviceRef ? this.deviceRef.isPickup() : false;
        this._activeFrame.visible(pickup);
        this._staticFrame.visible(!pickup);

        this.markDirty();
        this._refreshIfDirty();
    }

    getConfigFields() {
        return [
            { label: '线圈电阻 (Ω)', key: 'coilResistance', type: 'number' },
            { label: '线圈电感 (H)', key: 'coilInductance', type: 'number' },
        ];
    }

    onConfigUpdate(cfg) {
        if (cfg.coilResistance !== undefined) this._coilResistance = parseFloat(cfg.coilResistance);
        if (cfg.coilInductance !== undefined) this._coilInductance = parseFloat(cfg.coilInductance);
        this.config = { ...this.config, ...cfg };
    }

    destroy() { super.destroy?.(); }
}