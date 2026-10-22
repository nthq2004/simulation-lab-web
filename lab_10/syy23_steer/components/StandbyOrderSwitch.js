import { BaseComponent } from './BaseComponent.js';

/**
 * StandbyOrderSwitch — 备用机组顺序选择开关（两位选择器）
 *
 *   · 左端子 l 接 24V 电位端子；右端子 r 接 PLC 输入（I0.3）。
 *   · 旋钮左上 45° → 顺序「1-2」（1# 主用、2# 备用）——触点断开（r 悬空）。
 *   · 旋钮右上 45° → 顺序「2-1」（2# 主用、1# 备用）——触点闭合（24V → r）。
 *
 *  电气模型：type='switch'，端口 l/r，闭合时 l-r 同簇（由 CircuitTopology 处理）。
 */
export class StandbyOrderSwitch extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.width = Math.max(140, config.width || 160);
        this.height = Math.max(120, config.height || 150);

        this.type = 'switch';
        this.special = 'standby_order';
        this.cache = 'fixed';

        this.order = config.order === '2-1' ? '2-1' : '1-2';
        this._isOn = this.order === '2-1';
        this.label = config.label || '备用顺序';

        this._initGroups();
        this._recalcGeometry();
        this._draw();
        this._bind();

        this.config = { id: this.id, order: this.order, label: this.label };

        this.addPort(14, this.height - 16, 'l', 'wire', 'p');
        this.addPort(this.width - 14, this.height - 16, 'r', 'wire');
    }

    _recalcGeometry() {
        this._kx = this.width / 2;
        this._ky = 84;
        this._kr = 30;
    }

    /** 触点状态：闭合（2-1）时 l-r 短接 */
    get isOn() { return this._isOn; }

    _draw() {
        const g = this._staticGroup;
        g.add(new Konva.Rect({
            x: 0, y: 0, width: this.width, height: this.height,
            fill: '#dfe4e8', stroke: '#6d7a84', strokeWidth: 1.8, cornerRadius: 5,
        }));
        g.add(new Konva.Text({ x: 0, y: 6, width: this.width, text: this.label, fontSize: 13, fontStyle: 'bold', fill: '#222', align: 'center' }));

        // 位置标注
        g.add(new Konva.Text({ x: this._kx - 60, y: this._ky - 46, width: 44, text: '1-2', fontSize: 12, fontStyle: 'bold', fill: '#333', align: 'center' }));
        g.add(new Konva.Text({ x: this._kx + 16, y: this._ky - 46, width: 44, text: '2-1', fontSize: 12, fontStyle: 'bold', fill: '#333', align: 'center' }));

        // 端子
        g.add(new Konva.Rect({ x: 8, y: this.height - 22, width: 10, height: 12, fill: '#c9a227', stroke: '#8a6d12', strokeWidth: 1, cornerRadius: 2 }));
        g.add(new Konva.Rect({ x: this.width - 18, y: this.height - 22, width: 10, height: 12, fill: '#c9a227', stroke: '#8a6d12', strokeWidth: 1, cornerRadius: 2 }));
        g.add(new Konva.Text({ x: 0, y: this.height - 40, width: 34, text: '24V', fontSize: 11, fill: '#333', align: 'center' }));

        // 旋钮底座
        g.add(new Konva.Circle({ x: this._kx, y: this._ky, radius: this._kr + 5, fill: '#2b2f33', stroke: '#111', strokeWidth: 1.5 }));
        this._knob = new Konva.Group({ x: this._kx, y: this._ky });
        this._knob.add(new Konva.Circle({ radius: this._kr, fill: '#3d4145', stroke: '#111', strokeWidth: 1.5 }));
        this._knob.add(new Konva.Rect({ x: -3.5, y: -this._kr, width: 7, height: this._kr * 0.72, fill: '#f5f5f5', cornerRadius: 2 }));
        this._dynamicGroup.add(this._knob);

        this._syncVisuals();
    }

    _bind() {
        this.addClickablePart('knob', this._kx - 42, this._ky - 42, 84, 84);
        const hit = this.getClickablePartNode('knob');
        if (hit) hit.on('click tap', () => this.toggle());
    }

    toggle() {
        this.order = this.order === '1-2' ? '2-1' : '1-2';
        this._isOn = this.order === '2-1';
        this.config = { ...this.config, order: this.order };
        this._syncVisuals();
    }

    _syncVisuals() {
        if (this._knob) this._knob.rotation(this.order === '2-1' ? 45 : -45);
        if (this.sys && this.sys.requestRedraw) this.sys.requestRedraw();
    }

    // ── API ──
    getOrder() { return this.order; }
    setOrder(o) {
        if (o !== '1-2' && o !== '2-1') return;
        this.order = o; this._isOn = (o === '2-1');
        this._syncVisuals();
    }

    getConfigFields() {
        return [
            { label: '器件名称 (ID)', key: 'id', type: 'text' },
            { label: '标签', key: 'label', type: 'text' },
            {
                label: '备用顺序', key: 'order', type: 'select',
                options: [
                    { label: '1-2（1# 主用）', value: '1-2' },
                    { label: '2-1（2# 主用）', value: '2-1' },
                ],
            },
        ];
    }

    onConfigUpdate(cfg) {
        if (cfg.id) this.id = cfg.id;
        if (cfg.label !== undefined) this.label = cfg.label;
        if (cfg.order !== undefined) this.setOrder(cfg.order);
        this.config = { ...this.config, id: this.id, order: this.order, label: this.label };
        this._syncVisuals();
    }

    destroy() { super.destroy?.(); }
}

export default StandbyOrderSwitch;
