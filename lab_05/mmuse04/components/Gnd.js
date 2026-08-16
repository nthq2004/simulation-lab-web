import { BaseComponent } from './BaseComponent.js';

/**
 * Ground - 接地符号组件
 *
 * 说明：
 * - 本组件绘制经典的接地（地线）符号：一条竖线和三条由长到短的横线，表示设备接地点。
 * - 端口：通常仅提供一个接线端口（`gnd`），上层电气网络将该端口与系统地线或参考节点相连。
 * - 缓存：此组件为静态图形，设置 `cache='fixed'` 以减少重绘开销。
 *
 * 使用建议：将此组件放置在需要标记系统接地点的位置，或用于演示电路中的公共参考节点。
 */

export class Ground extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);
        // 初始化图层组（BaseComponent 提供 _staticGroup/_dynamicGroup/_interactGroup）
        this._initGroups();

        // 标识与缓存设置
        this.type = 'gnd'; // 组件类型标识
        this.cache = 'fixed'; // 静态组件，启用固定缓存以提速

        // 绘制视觉元素与添加端口
        this.initVisuals();
        this.initPorts();
    }

    /**
     * 添加端口：接地通常只有一个端口，用于连线到系统地
     */
    initPorts() {
        // 端口位置相对于组件中心，上移一定像素以对齐竖线顶端
        this.addPort(0, -20 * this.scale, 'gnd', 'wire');
    }

    /**
     * 绘制接地符号（竖线 + 三条横线，由长到短）
     */
    initVisuals() {
        const stroke = '#000000';

        // 1) 竖线：从上方向下连接到三条横线的开端
        const line = new Konva.Line({
            points: [0, -20 * this.scale, 0, 0],
            stroke: stroke,
            strokeWidth: 2 * this.scale
        });

        // 2) 三条横线（由长到短）用于表示接地符号
        const h1 = new Konva.Line({ points: [-15 * this.scale, 0, 15 * this.scale, 0], stroke, strokeWidth: 4 * this.scale });
        const h2 = new Konva.Line({ points: [-10 * this.scale, 5 * this.scale, 10 * this.scale, 5 * this.scale], stroke, strokeWidth: 4 * this.scale });
        const h3 = new Konva.Line({ points: [-5 * this.scale, 10 * this.scale, 5 * this.scale, 10 * this.scale], stroke, strokeWidth: 4 * this.scale });

        // 将静态元素添加到静态图层组中
        this._staticGroup.add(line, h1, h2, h3);
    }

    destroy() {
        super.destroy?.();
    }
}
