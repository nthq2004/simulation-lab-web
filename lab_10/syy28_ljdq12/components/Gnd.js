import { BaseComponent } from './BaseComponent.js';

/**
 * Ground - 接地符号组件
 *
 * 说明：
 * - 绘制经典接地（地线）符号：一条竖线 + 三条由长到短的横线，表示设备接地点；
 * - 端口：仅提供 `gnd` 一个接线端口，上层把其与系统地线/参考节点相连；
 * - 遵循新组件规范：`_initGroups → _recalcGeometry → _initParameters → _init`；
 *   静态图形入 `_staticGroup` 缓存一次，无阴影、无动态刷新。
 */
export class Ground extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.type = 'gnd';
        this.cache = 'fixed';

        this._initGroups();
        this._recalcGeometry();
        this._initParameters(config);
        this._init();

        this.config = { id: this.id };

        // 接地只有一个端口，向上引出以便与系统地相连
        this.addPort(0, -20, 'gnd', 'wire');
    }

    _recalcGeometry() {
        this.scale = 1;
    }

    _initParameters() { /* 地线无参数 */ }

    _init() {
        this._drawStaticParts();
    }

    _drawStaticParts() {
        const stroke = '#000000';
        const s = this.scale;

        // 竖线
        this._staticGroup.add(new Konva.Line({
            points: [0, -20 * s, 0, 0], stroke, strokeWidth: 2 * s,
        }));
        // 三条横线（由长到短）
        this._staticGroup.add(new Konva.Line({ points: [-15 * s, 0, 15 * s, 0], stroke, strokeWidth: 4 * s }));
        this._staticGroup.add(new Konva.Line({ points: [-10 * s, 5 * s, 10 * s, 5 * s], stroke, strokeWidth: 4 * s }));
        this._staticGroup.add(new Konva.Line({ points: [-5 * s, 10 * s, 5 * s, 10 * s], stroke, strokeWidth: 4 * s }));
    }

    getConfigFields() {
        return [{ label: '器件名称 (ID)', key: 'id', type: 'text' }];
    }

    onConfigUpdate(cfg) {
        if (cfg.id) this.id = cfg.id;
        this.config = { ...this.config, id: this.id };
    }

    destroy() {
        super.destroy?.();
    }
}

export default Ground;
