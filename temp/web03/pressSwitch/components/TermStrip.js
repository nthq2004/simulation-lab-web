import { BaseComponent } from './BaseComponent.js';

export class TerminalStrip extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);
        this.type = 'terminal_strip';
        this.initVisuals();
        this.initPorts();
    }

    initPorts() {
        // 上排 4 个端点 (1-4)
        for (let i = 0; i < 4; i++) {
            this.addPort(-45 + i * 30, -20, `wire_${i}`, 'wire');
        }
        // 下排 4 个端点 (5-8)
        for (let i = 0; i < 4; i++) {
            this.addPort(-45 + i * 30, 20, `wire_${i+4}`, 'wire');
        }
    }

    initVisuals() {
        const bodyColor = '#d6e0e9';
        const screwColor = '#f1da59';

        // 绘制底座
        this.group.add(new Konva.Rect({
            x: -60, y: -25,
            width: 120, height: 50,
            fill: bodyColor,
            cornerRadius: 4
        }));

        // 绘制 8 个金属接线柱/螺丝
        for (let i = 0; i < 4; i++) {
            // 上排螺丝
            this.group.add(new Konva.Circle({ x: -45 + i * 30, y: -20, radius: 8, fill: screwColor, stroke: '#7f8c8d' }));
            // 下排螺丝
            this.group.add(new Konva.Circle({ x: -45 + i * 30, y: 20, radius: 8, fill: screwColor, stroke: '#7f8c8d' }));
        }

        // 绘制内部连接标识（虚线显示它们是通的）
        this.group.add(new Konva.Line({
            points: [-45, 0, 45, 0],
            stroke: '#de9844',
            strokeWidth: 1,
            dash: [4, 4]
        }));
    }
}