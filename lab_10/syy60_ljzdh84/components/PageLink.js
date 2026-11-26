import { BaseComponent } from './BaseComponent.js';
import { PageLinkDevice } from '../device/PageLinkDevice.js';

/**
 * PageLink — 跨页端口连接器（复合设备的子组件）
 *
 * ═══ 功能 ═══════════════════════════════════════════════════
 *  多页面画布下，连线只在"两端组件同页"时显示；跨页信号无法直接拉线。
 *  本连接器提供一组跨页端子：在不同页面放置**同一个 deviceid** 的 PageLink，
 *  其相同通道号的端口在电路拓扑中全局同簇 → 页 1 的端子与页 2 的端子
 *  等价连通，实现"跨页端口互连"，画面上各页只在本地接线。
 *
 *  端口（每对 2 端，共 pairs 对）：
 *    上排 a1..aN —— 通道信号/端子 A
 *    下排 b1..bN —— 通道信号/端子 B
 *
 *  config.deviceid 相同即互通；pairs 默认 12（共 24 端子）。
 */
export class PageLink extends BaseComponent {
    static DeviceClass = PageLinkDevice;

    constructor(config, sys) {
        super(config, sys);

        this.width  = Math.max(240, config.width  || 420);
        this.height = Math.max(60,  config.height || 75);

        this.type    = 'page_link';
        this.special = 'page_link';
        this.cache   = 'fixed';

        this.deviceid = config.deviceid || 'XPL';
        this.label    = config.label || '跨页连接器';
        this._pairs   = Math.max(1, Math.min(24, config.pairs || 12));

        this._initGroups();
        this._recalcGeometry();
        this._init();
        this._registerPorts();

        this.config = {
            id: this.id,
            deviceid: this.deviceid,
            label: this.label,
            pairs: this._pairs,
            width: this.width,
            height: this.height,
        };
    }

    _recalcGeometry() {
        this._padX = 18;
        this._span = this.width - this._padX * 2;
        this._step = this._span / this._pairs;
    }

    _init() {
        this._drawStaticParts();
    }

    _drawStaticParts() {
        const W = this.width, H = this.height, sg = this._staticGroup;

        // 外壳
        sg.add(new Konva.Rect({
            x: 1, y: 1, width: W - 2, height: H - 2,
            fill: '#1f2a38', stroke: '#0e1620', strokeWidth: 1.5, cornerRadius: 5,
        }));
        // 顶部高光
        sg.add(new Konva.Rect({
            x: 3, y: 3, width: W - 6, height: 4,
            fill: 'rgba(255,255,255,0.10)', cornerRadius: [3, 3, 0, 0],
        }));

        // 单排端口：端子块 + 编号（字号 12 = 原 9 + 3）
        for (let i = 0; i < this._pairs; i++) {
            const x = this._padX + this._step * (i + 0.5);
            const num = String(i + 1);
            sg.add(new Konva.Rect({ x: x - 6, y: 5, width: 12, height: 10, fill: '#4a6070', stroke: '#2a3a46', strokeWidth: 1, cornerRadius: 2 }));
            sg.add(new Konva.Text({ x: x - 14, y: 17, width: 28, text: num, fontSize: 12, fill: '#cfe3f0', align: 'center' }));
        }

        // 标题
        sg.add(new Konva.Text({
            x: 0, y: H - 20, width: W,
            text: `${this.label}  [${this.deviceid}]`,
            fontSize: 12, fontStyle: 'bold', fill: '#8fd0ff', align: 'center',
        }));
    }

    _registerPorts() {
        // 只保留上面一排端口 a1..aN
        for (let i = 1; i <= this._pairs; i++) {
            const x = this._padX + this._step * (i - 0.5);
            this.addPort(x, 0, `a${i}`, 'wire');
        }
    }

    getConfigFields() {
        return [
            { label: '器件名称 (ID)', key: 'id', type: 'text' },
            { label: '跨页设备 ID (deviceid)', key: 'deviceid', type: 'text' },
            { label: '标签', key: 'label', type: 'text' },
            { label: '通道对数 (pairs)', key: 'pairs', type: 'number', min: 1, max: 24, step: 1 },
        ];
    }

    onConfigUpdate(cfg) {
        if (cfg.id) this.id = cfg.id;
        if (cfg.deviceid !== undefined) this.deviceid = cfg.deviceid;
        if (cfg.label !== undefined) this.label = cfg.label;
        if (cfg.pairs !== undefined) this._pairs = Math.max(1, Math.min(24, parseInt(cfg.pairs) || 12));
        this.config = { ...this.config, id: this.id, deviceid: this.deviceid, label: this.label, pairs: this._pairs };
        // 重建可视化与端口
        this._staticGroup.destroyChildren();
        this.ports.length = 0;
        this._recalcGeometry();
        this._drawStaticParts();
        this._registerPorts();
        this._refreshCache?.();
        if (this.sys && this.sys.requestRedraw) this.sys.requestRedraw();
    }

    destroy() { super.destroy?.(); }
}

export default PageLink;
