import { BaseComponent } from './BaseComponent.js';

export class Ground extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);
        this.type = 'gnd'; // 关键标识
        this.cache = 'fixed'; // 用于静态缓存的特殊标识
        this.initVisuals();
        this.initPorts();
    }

    initPorts() {
        // GND 通常只有一个连接点
        this.addPort(0, -20 * this.scale, 'gnd', 'wire');
    }

    initVisuals() {
        // 绘制经典的倒三角形地线符号
        const stroke = '#000000';
        
        // 竖线
        const line = new Konva.Line({
            points: [0, -20 * this.scale, 0, 0],
            stroke: stroke,
            strokeWidth: 2 * this.scale
        });

        // 三条横线（由长到短）
        const h1 = new Konva.Line({ points: [-15 * this.scale, 0, 15 * this.scale, 0], stroke, strokeWidth: 4 * this.scale });
        const h2 = new Konva.Line({ points: [-10 * this.scale, 5 * this.scale, 10 * this.scale, 5 * this.scale], stroke, strokeWidth: 4 * this.scale });
        const h3 = new Konva.Line({ points: [-5 * this.scale, 10 * this.scale, 5 * this.scale, 10 * this.scale], stroke, strokeWidth: 4 * this.scale });

        this.group.add(line, h1, h2, h3);
    }
}