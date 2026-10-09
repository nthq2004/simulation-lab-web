import { BaseComponent } from './BaseComponent.js';
import { CanBusDevice } from '../device/CanBusDevice.js';

/**
 * BusConnector — CAN 总线连接器（复合设备的子组件 · 小型矩形）
 *
 * ═══ 功能 ═══════════════════════════════════════════════════
 *  分布式总线连接器：每个 CAN 设备（AI/AO/DI/DO/CC）下方放置一个，
 *  设备把其 CAN 收发端口接到本连接器**上方**的两个端口即可挂到总线上。
 *
 *  端口：
 *    上：canh / canl      —— 接 CAN 设备的 can1p / can1n
 *    左：canhL / canlL    —— 与相邻连接器互联（工程中无需实际接线）
 *    右：canhR / canlR    —— 与相邻连接器互联（工程中无需实际接线）
 *
 * ═══ 电气同簇 ═══════════════════════════════════════════════
 *  为减少连线，电路注入（CircuitTopology）时会把**所有** BusConnector 的
 *  canhL / canhR / canh 合并为同一簇，canlL / canlR / canl 合并为同一簇；
 *  因此任意设备接到上方两端口，即等同于挂接到整条 CAN 总线上。
 *
 * ═══ 复合设备 ═══════════════════════════════════════════════
 *  与其余 BusConnector 共享 deviceid（默认 'CANBUS'）与 CanBusDevice，
 *  代表同一条逻辑总线。
 */
export class BusConnector extends BaseComponent {
    static DeviceClass = CanBusDevice;

    constructor(config, sys) {
        super(config, sys);

        this.width  = Math.max(72, config.width  || 96);
        this.height = Math.max(40, config.height || 50);

        this.type    = 'bus_connector';
        this.special = 'bus_connector';
        this.cache   = 'fixed';

        this.deviceid = config.deviceid || 'CANBUS';
        this.label    = config.label || '总线连接器';

        this._initGroups();
        this._recalcGeometry();
        this._initParameters(config);
        this._init();

        this.config = {
            id: this.id,
            deviceid: this.deviceid,
            label: this.label,
            width: this.width,
            height: this.height,
            topGap: this._topGap,
        };

        // ── 端口注册（上 2 · 左 2 · 右 2）──
        this.addPort(this._xTopH, 0, 'canh', 'wire', 'p');
        this.addPort(this._xTopL, 0, 'canl', 'wire');
        this.addPort(0, this._yH, 'canhL', 'wire', 'p');
        this.addPort(0, this._yL, 'canlL', 'wire');
        this.addPort(this.width, this._yH, 'canhR', 'wire', 'p');
        this.addPort(this.width, this._yL, 'canlR', 'wire');
    }

    // ═══════════════════════════════════════════════════════════

    _recalcGeometry() {
        const W = this.width, H = this.height;
        this._pad    = 6;
        this._bodyX  = 2;
        this._bodyY  = 2;
        this._bodyW  = W - 4;
        this._bodyH  = H - 4;
        // 内部两条母线（H 上 / L 下）
        this._yH = Math.round(H * 0.36);
        this._yL = Math.round(H * 0.64);
    }

    _initParameters(config) {
        this._topGap = Math.max(20, Math.min(this.width - 20, config.topGap || 50));
        const cx = this.width / 2;
        this._xTopH = Math.round(cx - this._topGap / 2);
        this._xTopL = Math.round(cx + this._topGap / 2);
    }

    _init() {
        this._drawStaticParts();
    }

    _drawStaticParts() {
        const W = this.width, H = this.height;
        const sg = this._staticGroup;

        // 外壳
        sg.add(new Konva.Rect({
            x: this._bodyX, y: this._bodyY, width: this._bodyW, height: this._bodyH,
            fill: '#123b2e', stroke: '#0a2018', strokeWidth: 1.5, cornerRadius: 4,
        }));
        // 顶部高光
        sg.add(new Konva.Rect({
            x: this._bodyX + 2, y: this._bodyY + 2, width: this._bodyW - 4, height: 4,
            fill: 'rgba(255,255,255,0.10)', cornerRadius: [3, 3, 0, 0],
        }));

        // 内部母线：H（红） / L（黑）
        const lineX1 = this._pad, lineX2 = W - this._pad;
        sg.add(new Konva.Line({
            points: [lineX1, this._yH, lineX2, this._yH],
            stroke: '#e74c3c', strokeWidth: 3, lineCap: 'round',
        }));
        sg.add(new Konva.Line({
            points: [lineX1, this._yL, lineX2, this._yL],
            stroke: '#cfd8dc', strokeWidth: 3, lineCap: 'round',
        }));

        // 上方端口到母线的 T 形引入线
        sg.add(new Konva.Line({ points: [this._xTopH, 0, this._xTopH, this._yH], stroke: '#e74c3c', strokeWidth: 2 }));
        sg.add(new Konva.Line({ points: [this._xTopL, 0, this._xTopL, this._yL], stroke: '#cfd8dc', strokeWidth: 2 }));

        // 左右端口引出线
        sg.add(new Konva.Line({ points: [0, this._yH, lineX1, this._yH], stroke: '#e74c3c', strokeWidth: 2 }));
        sg.add(new Konva.Line({ points: [lineX2, this._yH, W, this._yH], stroke: '#e74c3c', strokeWidth: 2 }));
        sg.add(new Konva.Line({ points: [0, this._yL, lineX1, this._yL], stroke: '#cfd8dc', strokeWidth: 2 }));
        sg.add(new Konva.Line({ points: [lineX2, this._yL, W, this._yL], stroke: '#cfd8dc', strokeWidth: 2 }));

        // 标签
        sg.add(new Konva.Text({
            x: this._bodyX, y: this._bodyY + this._bodyH - 13, width: this._bodyW,
            text: 'CAN BUS', fontSize: 8, fontStyle: 'bold',
            fill: '#7fd8b0', align: 'center',
        }));
        sg.add(new Konva.Text({
            x: this._bodyX + 3, y: this._yH - 13, width: 30,
            text: 'H', fontSize: 8, fontStyle: 'bold', fill: '#ff8a80',
        }));
        sg.add(new Konva.Text({
            x: this._bodyX + 3, y: this._yL + 4, width: 30,
            text: 'L', fontSize: 8, fontStyle: 'bold', fill: '#cfd8dc',
        }));
    }

    // ═══════════════════════════════════════════════════════════
    //  配置
    // ═══════════════════════════════════════════════════════════

    getConfigFields() {
        return [
            { label: '器件名称 (ID)', key: 'id', type: 'text' },
            { label: '总线设备 ID (deviceid)', key: 'deviceid', type: 'text' },
            { label: '标签', key: 'label', type: 'text' },
            { label: '顶部端口间距 (px)', key: 'topGap', type: 'number', min: 20, step: 2 },
        ];
    }

    onConfigUpdate(cfg) {
        if (cfg.id) this.id = cfg.id;
        if (cfg.deviceid !== undefined) this.deviceid = cfg.deviceid;
        if (cfg.label !== undefined) this.label = cfg.label;
        if (cfg.topGap !== undefined) {
            this._topGap = Math.max(20, Math.min(this.width - 20, parseFloat(cfg.topGap) || 50));
            const cx = this.width / 2;
            this._xTopH = Math.round(cx - this._topGap / 2);
            this._xTopL = Math.round(cx + this._topGap / 2);
        }
        this.config = { ...this.config, id: this.id, deviceid: this.deviceid, label: this.label, topGap: this._topGap };
        this.markDirty();
        this._refreshIfDirty(true);
    }

    destroy() {
        super.destroy?.();
    }
}

export default BusConnector;
