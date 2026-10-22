import { BaseComponent } from './BaseComponent.js';

/**
 * LubeOilTank — 滑油循环柜（Lube Oil Circulating Tank）
 *
 * 视觉：带油位的矩形循环柜，顶部入口（柴油机回油）＋右侧出口（去第 1 三通接头）。
 * 无源被动组件：仅显示油位与名称，油位由外部 update(level) 或静态保持。
 *
 * 端口：i 顶部进口（来自柴油机出口）、o 右侧出口（去滑油泵吸入总管）。
 */
export class LubeOilTank extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.W = Math.max(140, config.width || 180);
        this.H = Math.max(180, config.height || 220);

        this.type = 'oilTank';
        this.cache = 'fixed';

        this._initGroups();
        this._recalcGeometry();
        this._initParameters(config);
        this._init();

        this.config = { id: this.id, label: this.label, initLevel: this.initLevel };

        // 顶部进口、右侧出口（出口位于右侧靠下位置）
        this.addPort(this.W / 2, 0, 'i', 'pipe', 'in');
        this.addPort(this.W, this._oY, 'o', 'pipe');
    }

    _recalcGeometry() {
        this._bx = 8;
        this._by = 30;
        this._bw = this.W - 16;
        this._bh = this.H - 40;
        this._oY = this.H - 40;   // 右侧出口：靠下
    }

    _initParameters(config) {
        this.label = config.label || '滑油循环柜';
        this.capacity = config.capacity || 100;
        this.initLevel = config.initLevel !== undefined ? config.initLevel : 60;
        this._level = this.initLevel;
        this._display = this.initLevel;
    }

    _init() {
        this._drawStaticParts();
        this._createDynamicNodes();
        this.update();
    }

    _drawStaticParts() {
        const g = this._staticGroup;

        // 标题
        g.add(new Konva.Text({
            x: 0, y: 4, width: this.W, text: this.label, fontSize: 13, fontStyle: 'bold',
            fill: '#1a3a5c', align: 'center', listening: false,
        }));

        // 柜体
        g.add(new Konva.Rect({
            x: this._bx, y: this._by, width: this._bw, height: this._bh,
            fill: '#e8edf2', stroke: '#455a64', strokeWidth: 2, cornerRadius: 4,
        }));
        // 入口/出口接管
        g.add(new Konva.Rect({ x: this.W / 2 - 8, y: 0, width: 16, height: 32, fill: '#9aa3a8', stroke: '#7a8288', strokeWidth: 1 }));
        g.add(new Konva.Rect({ x: this.W - 10, y: this._oY - 8, width: 10, height: 16, fill: '#9aa3a8', stroke: '#7a8288', strokeWidth: 1 }));

        // 液位刻度
        for (let i = 0; i <= 4; i++) {
            const y = this._by + this._bh - (this._bh / 4) * i;
            g.add(new Konva.Line({ points: [this._bx + 2, y, this._bx + 12, y], stroke: '#90a4ae', strokeWidth: 1, listening: false }));
        }
    }

    _createDynamicNodes() {
        const d = this._dynamicGroup;
        this._oil = new Konva.Rect({
            x: this._bx + 3, y: this._by + this._bh, width: this._bw - 6, height: 0,
            fill: '#d4a12a', opacity: 0.8, listening: false,
        });
        d.add(this._oil);

        this._lvlText = new Konva.Text({
            x: this._bx, y: this._by + this._bh - 18, width: this._bw,
            text: '', fontSize: 11, fontFamily: 'Courier New', fontStyle: 'bold',
            fill: '#3a2a00', align: 'center', listening: false,
        });
        d.add(this._lvlText);
    }

    tick(dt) {
        this._display += (this._level - this._display) * Math.min(1, (dt || 0.05) * 5);
        this._updateDynamic();
        this.sys.requestRedraw();
    }

    _updateDynamic() {
        const ch = this._bh - 6;
        const h = Math.max(0, Math.min(1, this._display / 100)) * ch;
        this._oil.y(this._by + 3 + ch - h);
        this._oil.height(h);
        if (this._lvlText) this._lvlText.text(this._display.toFixed(0) + ' %');
    }

    update(level) {
        if (typeof level === 'number') this._level = Math.max(0, Math.min(100, level));
        this._updateDynamic();
    }

    getValue() { return this._level; }

    _toAbs(x, y) {
        try { return this.group.getAbsoluteTransform().point({ x, y }); }
        catch (e) { return { x: this.group.x() + x, y: this.group.y() + y }; }
    }

    getClickablePartCenter(partId) {
        switch (partId) {
            case 'body': return this._toAbs(this.W / 2, this.H / 2);
            case 'i':    return this._toAbs(this.W / 2, 0);
            case 'o':    return this._toAbs(this.W, this._oY);
            default:     return null;
        }
    }

    getConfigFields() {
        return [
            { label: '器件名称 (ID)', key: 'id', type: 'text' },
            { label: '位号/名称', key: 'label', type: 'text' },
            { label: '初始液位 (%)', key: 'initLevel', type: 'number' },
        ];
    }

    onConfigUpdate(cfg) {
        if (cfg.id) this.id = cfg.id;
        if (cfg.label !== undefined) this.label = cfg.label;
        if (cfg.initLevel !== undefined) { this.initLevel = parseFloat(cfg.initLevel); this._level = this.initLevel; }
        this.config = { ...this.config, ...cfg };
        this._updateDynamic();
    }

    destroy() { super.destroy?.(); }
}

export default LubeOilTank;
