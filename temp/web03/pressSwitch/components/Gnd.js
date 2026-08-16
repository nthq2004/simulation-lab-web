import { BaseComponent } from './BaseComponent.js';

export class Ground extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);
        this.type = 'gnd'; // 关键标识
        this.initVisuals();
        this.initPorts();
    }

    initPorts() {
        // GND 通常只有一个连接点
        this.addPort(0, -20, 'gnd', 'wire');
    }

    initVisuals() {
        // 绘制经典的倒三角形地线符号
        const stroke = '#000000';
        
        // 竖线
        const line = new Konva.Line({
            points: [0, -20, 0, 0],
            stroke: stroke,
            strokeWidth: 2
        });

        // 三条横线（由长到短）
        const h1 = new Konva.Line({ points: [-15, 0, 15, 0], stroke, strokeWidth: 4 });
        const h2 = new Konva.Line({ points: [-10, 5, 10, 5], stroke, strokeWidth: 4 });
        const h3 = new Konva.Line({ points: [-5, 10, 5, 10], stroke, strokeWidth: 4 });

        this.group.add(line, h1, h2, h3);
    }
}