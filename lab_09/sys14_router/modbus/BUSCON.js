/**
 * BUSCON.js — RS485 总线连接器（T 型端子排）
 * 船舶机舱监测报警系统 · Modbus 通信架构
 *
 * 纯视觉组件，用于示意 RS485 总线拓扑连接
 */

import { BaseComponent } from '../components/BaseComponent.js';

export class ModbusBUSCON extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.width = 40;
        this.height = 100;
        this.type = 'modbus_buscon';
        this.cache = 'fixed';

        this._drawVisuals();
        this._addPorts();
    }

    _addPorts() {
        // 左侧 A+/B-
        this.addPort(0, 25, 'la', 'wire', 'p');
        this.addPort(0, 75, 'lb', 'wire');

        // 右侧 A+/B-
        this.addPort(this.width, 25, 'ra', 'wire', 'p');
        this.addPort(this.width, 75, 'rb', 'wire');
    }

    _drawVisuals() {
        // T 型端子排外壳
        this.group.add(new Konva.Rect({
            x: 0, y: 0, width: this.width, height: this.height,
            fill: '#f1f2f6', stroke: '#747d8c', strokeWidth: 1.5, cornerRadius: 3,
        }));

        // 标签
        this.group.add(new Konva.Text({
            x: 2, y: 2, text: 'RS485', fontSize: 9,
            fill: '#2c3e50', fontStyle: 'bold',
        }));

        // A+ 端子
        this.group.add(new Konva.Circle({ x: 20, y: 20, radius: 6, fill: '#ff0000' }));
        this.group.add(new Konva.Text({ x: 27, y: 16, text: 'A+', fontSize: 10, fill: '#ff0000', fontStyle: 'bold' }));

        // B- 端子
        this.group.add(new Konva.Circle({ x: 20, y: 80, radius: 6, fill: '#130901' }));
        this.group.add(new Konva.Text({ x: 27, y: 76, text: 'B-', fontSize: 10, fill: '#130901', fontStyle: 'bold' }));

        // 总线干线示意线
        this.group.add(new Konva.Line({
            points: [20, 30, 20, 70],
            stroke: '#747d8c', strokeWidth: 2, dash: [4, 2],
        }));
    }
}
