import { BaseComponent } from '../components/BaseComponent.js';
import { OverCurrentDevice } from './OverCurrentDevice.js';

/**
 * OverCurrentNOContact — 过流继电器「输出触头」（常开，GLJ 触点）
 *
 * 与测量绕组（OverCurrentCoil）共享 OverCurrentDevice（同 deviceid）。
 * 过流动作 → 触头闭合；返回 → 触头断开。
 * 界面与接触器常开辅助触头（AuxNOContact）一致。
 *
 * ── 端口 ─────────────────────────────────────────────
 *  com — 公共端（左）
 *  no  — 常开端（右）
 */
export class OverCurrentNOContact extends BaseComponent {
    static DeviceClass = OverCurrentDevice;

    constructor(config, sys) {
        super(config, sys);

        this.width  = Math.max(80, config.width  || 100);
        this.height = Math.max(60, config.height || 80);

        this.type    = 'ContactorDevice';
        this.special = 'nocontact';
        this.cache   = 'fixed';

        this._isClosed = false;
        this._curBladeAng = -22.5;
        this._contactR = 5;

        this._initGroups();
        this._recalcGeometry();
        this._init();

        this.config = { deviceid: config.deviceid || 'GLJ' };

        this.addPort(2, this.height / 2 - 10, 'com', 'wire');
        this.addPort(this.width - 2, this.height / 2 - 10, 'no', 'wire', 'p');
    }

    _recalcGeometry() {
        const W = this.width, H = this.height;
        const _gap = (W - 40) * 2 / 3;
        this._leftX  = (W - _gap) / 2;
        this._rightX = (W + _gap) / 2;
        this._pivotY = H / 2 - 10;
    }

    _init() {
        this._drawStaticParts();
        this._createDynamicNodes();
    }

    _drawStaticParts() {
        const W = this.width, cy = this._pivotY;
        const color = '#888';
        const devId = this.config.deviceid || 'GLJ';

        this._staticGroup.add(new Konva.Line({
            points: [2, cy, this._leftX, cy], stroke: color, strokeWidth: 2,
        }));
        this._staticGroup.add(new Konva.Line({
            points: [this._rightX, cy, W - 2, cy], stroke: color, strokeWidth: 2,
        }));
        [this._leftX, this._rightX].forEach(x => {
            this._staticGroup.add(new Konva.Circle({
                x, y: cy, radius: 4, fill: color, stroke: '#908030', strokeWidth: 0.8,
            }));
        });
        [2, W - 2].forEach(x => {
            this._staticGroup.add(new Konva.Circle({
                x, y: cy, radius: 4,
                fillLinearGradientStartPoint: { x: -4, y: -4 },
                fillLinearGradientEndPoint:   { x: 4, y: 4 },
                fillLinearGradientColorStops: [0, '#d8c870', 0.5, '#f0e090', 1, '#b8a858'],
                stroke: '#908030', strokeWidth: 1,
            }));
        });
        this._staticGroup.add(new Konva.Text({
            x: 0, y: 10, width: W, text: devId,
            fontSize: 14, fontStyle: 'bold', fill: '#333', align: 'center',
        }));
    }

    _createDynamicNodes() {
        this._bladeGroup = new Konva.Group({
            x: this._rightX, y: this._pivotY, rotation: this._curBladeAng,
        });
        this._bladeGroup.add(new Konva.Line({
            points: [0, 0, -(this._rightX - this._leftX), 0],
            stroke: '#e03030', strokeWidth: 2.5, lineCap: 'round',
        }));
        this._bladeGroup.add(new Konva.Arc({
            x: -(this._rightX - this._leftX), y: 0,
            innerRadius: 0, outerRadius: this._contactR,
            angle: 180, rotation: 180,
            fill: '#e8c86a', stroke: '#e03030', strokeWidth: 1.5,
        }));
        this._dynamicGroup.add(this._bladeGroup);
    }

    getValue() {
        return this._isClosed ? 0.01 : 10000000;
    }

    tick() {
        const pickup = this.deviceRef ? this.deviceRef.getContactClosed() : false;
        const targetAng = pickup ? -5 : -22.5;
        if (Math.abs(this._curBladeAng - targetAng) > 0.5) {
            this._curBladeAng += (targetAng - this._curBladeAng) * 0.30;
            if (Math.abs(this._curBladeAng - targetAng) < 0.5) this._curBladeAng = targetAng;
            this._bladeGroup.rotation(this._curBladeAng);
        }
        this._isClosed = Math.abs(this._curBladeAng) - 5 < 2;

        this.markDirty();
        this._refreshIfDirty();
    }

    getConfigFields() { return []; }

    onConfigUpdate(cfg) {
        this.config = { ...this.config, ...cfg };
        this._staticGroup.destroyChildren();
        this._dynamicGroup.destroyChildren();
        this._drawStaticParts();
        this._createDynamicNodes();
        this._refreshCache?.();
    }

    destroy() { super.destroy?.(); }
}
