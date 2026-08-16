import { BaseComponent } from '../components/BaseComponent.js';
import { ThermalRelayDevice } from './ThermalRelayDevice.js';

/**
 * ThermalNCContact — 热继电器常闭触点（NC）
 *
 * 界面参照停止按钮（DiagramStopButton）电路符号（红色系）：
 *  左/右端子 → 左/右静触头圆点，动触刀绕右端子旋转。
 *  底部操作符号：将停止按钮的「倒山字」按钮帽替换为发热元件符号
 *  （小型折叠发热丝，铜色）。
 *
 * 工作逻辑（由 ThermalRelayDevice 驱动）：
 *  未脱扣：常闭触点闭合（刀片水平，接触左静触头）
 *  脱扣  ：常闭触点断开（刀片下倾，脱离左静触头）
 *
 * ── 端口 ─────────────────────────────────────────────────────
 *  com — 公共端（左）
 *  nc  — 常闭端（右）
 */
export class ThermalNCContact extends BaseComponent {
    static DeviceClass = ThermalRelayDevice;

    constructor(config, sys) {
        super(config, sys);

        this.width  = Math.max(80, config.width  || 100);
        this.height = Math.max(80, config.height || 80);

        this.type    = 'ThermalRelayDevice';
        this.special = 'nccontact';
        this.cache   = 'fixed';

        this._isClosed = true;
        this._curBladeAng = 5;
        this._contactR = 5;

        this._initGroups();
        this._recalcGeometry();
        this._initParameters(config);
        this._init();

        this.config = { deviceid: config.deviceid, label: this.label };

        this.addPort(2, this.height / 2 - 10, 'com', 'wire');
        this.addPort(this.width - 2, this.height / 2 - 10, 'nc', 'wire', 'p');
    }

    _recalcGeometry() {
        const W = this.width, H = this.height;
        this._cx = W / 2;
        // 左右静触点间距缩至原 2/3（端子位置不变，触点向中心收拢）
        const _gap = (W - 40) * 2 / 3;
        this._leftX = (W - _gap) / 2;
        this._rightX = (W + _gap) / 2;
        this._pivotY = H / 2 - 10;
    }

    _initParameters(config) {
        this.label = config.label || 'FR';
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

        // 左/右静触头（小圆点）
        this._staticGroup.add(new Konva.Circle({
            x: this._leftX, y: cy, radius: 4,
            fill: poleColor, stroke: '#908030', strokeWidth: 0.8,
        }));
        this._staticGroup.add(new Konva.Circle({
            x: this._rightX, y: cy, radius: 4,
            fill: poleColor, stroke: '#908030', strokeWidth: 0.8,
        }));

        // 端子圆点
        this._drawTerminal(2, cy, poleColor);
        this._drawTerminal(W - 2, cy, poleColor);

        // 底部操作符号：发热元件（替换停止按钮的倒山字帽）
        this._drawHeatCap(this._cx, H - 18, '#c89020');

        // 标签
        this._staticGroup.add(new Konva.Text({
            x: 0, y: 10, width: W,
            text: this.label, fontSize: 14, fill: '#333',fontstyle:'bold', align: 'center',
        }));
    }

    /** 发热符号：从左水平引出 → 向上 → 向右 → 向下 → 水平引出（门形） */
    _drawHeatCap(cx, y, color) {
        const w = 12, h = 12, lead = 6;
        this._staticGroup.add(new Konva.Line({
            points: [
                cx - w, y,
                cx - w + lead, y,
                cx - w + lead, y - h,
                cx + w - lead, y - h,
                cx + w - lead, y,
                cx + w, y,
            ],
            stroke: color, strokeWidth: 2.2,
            lineCap: 'round', lineJoin: 'round',
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

        // 推杆虚线（从发热元件符号顶端到旋转支点）
        this._plungerLine = new Konva.Line({
            points: [cx, this.height - 30, cx, this._pivotY ],
            stroke: '#e03030', strokeWidth: 1.5,
            dash: [4, 3],
        });
        this._dynamicGroup.add(this._plungerLine);

        // 旋转触点臂（围绕右端子旋转，NC 初始闭合）
        this._bladeGroup = new Konva.Group({
            x: this._rightX,
            y: this._pivotY,
            rotation: this._curBladeAng,
        });

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
            x: this._cx - 20, y: this.height - 40,
            width: 40, height: 40,
            fill: 'transparent',
        });
        hitArea.on('mouseenter', () => { document.body.style.cursor = 'pointer'; });
        hitArea.on('mouseleave', () => { document.body.style.cursor = 'default'; });
        this._interactGroup.add(hitArea);
    }

    _updatePlunger() {
        const cy = this._pivotY;
        const rad = this._curBladeAng * Math.PI / 180;
        const armLen = this._rightX - this._leftX;
        const tipY = cy - armLen * Math.sin(rad);
        this._plungerLine.points([this._cx, this.height - 30, this._cx, tipY + 5]);
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
            this._updatePlunger();
        }

        this._isClosed = Math.abs(this._curBladeAng - 5) < 2;

        this.markDirty();
        this._refreshIfDirty();
    }

    getConfigFields() {
        return [
            { label: '位号', key: 'label', type: 'text' },
            { label: '设备 ID (deviceid)', key: 'deviceid', type: 'text' },
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
