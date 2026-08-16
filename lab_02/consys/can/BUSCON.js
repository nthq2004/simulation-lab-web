import { BaseComponent } from '../components/BaseComponent.js';

export class BUSCON extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);
        this.type = 'buscon'; // 关键标识
        this.cache = 'fixed'; // 用于静态缓存的特殊标识
        this.scale = 1.5;
        this.initVisuals();
        this.initPorts();
    }

    initPorts() {
        // GND 通常只有一个连接点
        this.addPort( 20 * this.scale,0, 'can1p', 'wire','p');
        this.addPort( 60 * this.scale,0, 'can1n', 'wire');
        this.addPort( 100 * this.scale,0, 'can2p', 'wire','p');
        this.addPort( 140 * this.scale, 0,'can2n', 'wire');                        
    }

    initVisuals() {
        // 绘制经典的倒三角形地线符号
        const stroke = '#0cc480';
        
        // 竖线
        const line = new Konva.Line({
            points: [0 , 0,160*this.scale ,0],
            stroke: stroke,
            strokeWidth: 10 * this.scale
        });

        this.group.add(line);
    }
}