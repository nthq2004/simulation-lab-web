import { BaseComponent } from './BaseComponent.js';

/**
 * HeatExchanger - 板式换热器 2D 原理图符号
 * 用于冷却水系统原理图
 */
export class HeatExchanger extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.type = 'heat_exchanger';
        this.cache = 'fixed';

        const W = this.width || 80;
        const H = this.height || 100;

        // 矩形主体
        const rect = new Konva.Rect({
            x: -W / 2, y: -H / 2, width: W, height: H,
            fill: '#e8f5e9', stroke: '#2e7d32', strokeWidth: 2,
            cornerRadius: 4,
        });
        this.group.add(rect);

        // 波纹板片示意（竖线）
        for (let i = 0; i < 5; i++) {
            const line = new Konva.Line({
                points: [
                    -W / 2 + 8 + i * (W - 16) / 4, -H / 2 + 10,
                    -W / 2 + 8 + i * (W - 16) / 4,  H / 2 - 10,
                ],
                stroke: '#a5d6a7', strokeWidth: 1.5,
            });
            this.group.add(line);
        }

        // "HX" 标签
        const label = new Konva.Text({
            x: -15, y: -8, width: 30,
            text: 'HX', fontSize: 14, fontStyle: 'bold',
            fill: '#2e7d32', align: 'center',
        });
        this.group.add(label);

        // 四个接口端口
        this.addPort(-W / 2, -H / 4, 'sw_in', 'wire');
        this.addPort(-W / 2,  H / 4, 'fw_in', 'wire');
        this.addPort(W / 2,  -H / 4, 'sw_out', 'wire');
        this.addPort(W / 2,   H / 4, 'fw_out', 'wire');

        // 温度标签文字
        const tempHot = new Konva.Text({
            x: -W / 2 - 30, y: -H / 4 - 10,
            text: 'T↓', fontSize: 10, fill: '#e53935',
        });
        this.group.add(tempHot);

        const tempCold = new Konva.Text({
            x: -W / 2 - 30, y: H / 4 - 5,
            text: 'T↑', fontSize: 10, fill: '#1e88e5',
        });
        this.group.add(tempCold);
    }

    getConfigFields() {
        return [
            { label: '位号', key: 'label', type: 'text' },
        ];
    }

    onConfigUpdate(newConfig) {
        this.label = newConfig.label;
    }
}
