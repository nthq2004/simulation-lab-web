import { BaseComponent } from '../components/BaseComponent.js';
import { TimeRelayDevice } from './TimeRelayDevice.js';

/**
 * TimeDelayNCContact — 时间继电器常闭延时断开触头（NC, delay-off）
 *
 * 界面参照接触器常闭辅助触头（AuxNCContact）：
 *  左/右端子 → 左/右静触头圆点，动触刀绕右端子旋转。
 *  刀臂上叠加半圆弧「延时」符号（⌒），提示延时断开特性。
 *
 * 工作逻辑（由 TimeRelayDevice 驱动）：
 *  未到延时（idle/timing）：常闭触头闭合（刀片水平，接触左静触头）
 *  延时到达（output）    ：常闭触头断开（刀片下倾，脱离左静触头）
 *
 * ── 端口 ─────────────────────────────────────────────────────
 *  com — 公共端（左）
 *  nc  — 常闭端（右）
 */
export class TimeDelayNCContact extends BaseComponent {
    static DeviceClass = TimeRelayDevice;

    constructor(config, sys) {
        super(config, sys);

        this.width  = Math.max(80, config.width  || 100);
        this.height = Math.max(60, config.height || 80);

        // type 复用接触器分类，使求解器对触头端口作 MNA stamp（常闭触点电阻）；
        // DeviceClass 仍为 TimeRelayDevice，由时间继电器状态机驱动断开
        this.type    = 'ContactorDevice';
        this.special = 'nccontact';
        this.cache   = 'fixed';

        this._isClosed   = true;
        this._curBladeAng = 5;
        this._contactR   = 5;

        this._initGroups();
        this._recalcGeometry();
        this._initParameters(config);
        this._init();

        this.config = { deviceid: config.deviceid || 'KT', label: this.label };

        this.addPort(2, this.height / 2 - 10, 'com', 'wire');
        this.addPort(this.width - 2, this.height / 2 - 10, 'nc', 'wire', 'p');
    }

    _recalcGeometry() {
        const W = this.width, H = this.height;
        this._cx = W / 2;
        // 左右静触点间距缩至原 2/3（端子位置不变，触点向中心收拢）
        const _gap = (W - 40) * 2 / 3;
        this._leftX  = (W - _gap) / 2;
        this._rightX = (W + _gap) / 2;
        this._pivotY = H / 2 - 10;
    }

    _initParameters(config) {
        this.label = config.label || 'KT';
    }

    _init() {
        this._drawStaticParts();
        this._createDynamicNodes();
    }

    _drawStaticParts() {
        const W = this.width, H = this.height;
        const cy = this._pivotY;
        const color = '#888';
        const devId = this.config.deviceid || this.label || 'KT';

        // 左端子 → 左静触头
        this._staticGroup.add(new Konva.Line({
            points: [2, cy, this._leftX, cy],
            stroke: color, strokeWidth: 2,
        }));

        // 右端子 → 右静触头
        this._staticGroup.add(new Konva.Line({
            points: [this._rightX, cy, W - 2, cy],
            stroke: color, strokeWidth: 2,
        }));

        // 左/右静触头（小圆点）
        this._staticGroup.add(new Konva.Circle({
            x: this._leftX, y: cy, radius: 4,
            fill: color, stroke: '#908030', strokeWidth: 0.8,
        }));
        this._staticGroup.add(new Konva.Circle({
            x: this._rightX, y: cy, radius: 4,
            fill: color, stroke: '#908030', strokeWidth: 0.8,
        }));

        // 端子圆点
        this._drawTerminal(2, cy, color);
        this._drawTerminal(W - 2, cy, color);

        // 位号标签
        this._staticGroup.add(new Konva.Text({
            x: 0, y: 10, width: W,
            text: devId, fontSize: 14, fill: '#333', align: 'center', fontStyle: 'bold',
        }));
    }

    /** 延时符号：从触点臂中央引两根垂线连接半圆弧，随动触臂一起旋转 */
    _drawDelayMark(group, bladeLen, color) {
        const dx = 4;                                          // 间距缩 1/3（原 ±6）
        const len = Math.round((this.height - 16 - this._pivotY) * 2 / 3);   // 长度缩 1/3
        const xm = -bladeLen / 2;
        const x1 = xm - dx, x2 = xm + dx;
        const yEnd = len;

        // 两根垂线
        group.add(new Konva.Line({
            points: [x1, 0, x1, yEnd], stroke: color, strokeWidth: 3.2,
            lineCap: 'round', listening: false,
        }));
        group.add(new Konva.Line({
            points: [x2, 0, x2, yEnd], stroke: color, strokeWidth: 3.2,
            lineCap: 'round', listening: false,
        }));

        // 半圆弧（端点向外延伸更多，弧深向垂线靠拢）
        const r = dx + 6;
        const pts = [];
        for (let i = 0; i <= 20; i++) {
            const t = i / 20;
            const a = Math.PI + Math.PI * t;
            pts.push(xm - r * Math.cos(a), yEnd - r * Math.sin(a) * 0.55);
        }
        group.add(new Konva.Line({
            points: pts, stroke: color, strokeWidth: 4,
            lineCap: 'round', listening: false,
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
        // 旋转触点臂（围绕右端子旋转，NC 初始闭合）
        this._bladeGroup = new Konva.Group({
            x: this._rightX,
            y: this._pivotY,
            rotation: this._curBladeAng,
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

        // 延时符号（垂线 + 半圆弧，随动触臂一起旋转）
        this._drawDelayMark(this._bladeGroup, this._rightX - this._leftX, '#c07020');

        this._dynamicGroup.add(this._bladeGroup);
    }

    getValue() {
        return this._isClosed ? 0.01 : 10000000;
    }

    tick(dt) {
        const closed = this.deviceRef ? this.deviceRef.getNCClosed() : true;
        const targetAng = closed ? 5 : 22.5;

        if (Math.abs(this._curBladeAng - targetAng) > 0.5) {
            const diff = targetAng - this._curBladeAng;
            this._curBladeAng += diff * 0.15;
            if (Math.abs(this._curBladeAng - targetAng) < 0.5) {
                this._curBladeAng = targetAng;
            }
            this._bladeGroup.rotation(this._curBladeAng);
        }

        this._isClosed = Math.abs(this._curBladeAng - 5) < 2;

        this.markDirty();
        this._refreshIfDirty();
    }

    getConfigFields() {
        return [
            { label: '设备 ID (deviceid)', key: 'deviceid', type: 'text' },
            { label: '位号', key: 'label', type: 'text' },
        ];
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
