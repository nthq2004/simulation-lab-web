import { BaseComponent } from './BaseComponent.js';

/**
 * Switchboard - 主配电板 2D 原理图组件
 * 包含母线、断路器、电压/电流/频率表
 */
export class Switchboard extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.type = 'switchboard';
        this.cache = 'fixed';

        const W = 160;
        const H = 140;

        // 配电柜体
        const cabinet = new Konva.Rect({
            x: -W / 2, y: -H / 2, width: W, height: H,
            fill: '#f5f5f5', stroke: '#37474f', strokeWidth: 2,
            cornerRadius: 3,
        });
        this.group.add(cabinet);

        // 标题
        const title = new Konva.Text({
            x: -W / 2 + 5, y: -H / 2 + 5, width: W - 10,
            text: '主配电板', fontSize: 12, fontStyle: 'bold',
            fill: '#263238', align: 'center',
        });
        this.group.add(title);

        // 母线（三条水平线）
        for (let i = 0; i < 3; i++) {
            const bus = new Konva.Line({
                points: [-W / 2 + 15, -H / 2 + 35 + i * 15, W / 2 - 15, -H / 2 + 35 + i * 15],
                stroke: '#f57f17', strokeWidth: 3,
            });
            this.group.add(bus);
        }

        // 母线标签
        const busLabel = new Konva.Text({
            x: -W / 2 + 5, y: -H / 2 + 32,
            text: 'L1 L2 L3', fontSize: 8,
            fill: '#e65100', align: 'center',
        });
        this.group.add(busLabel);

        // 断路器（方形符号）
        for (let i = 0; i < 3; i++) {
            const breaker = new Konva.Rect({
                x: -15 + i * 20, y: -H / 2 + 60,
                width: 12, height: 16,
                fill: '#fff', stroke: '#c62828', strokeWidth: 1.5,
            });
            this.group.add(breaker);
        }

        // 电压表
        this.voltText = new Konva.Text({
            x: -W / 2 + 5, y: -H / 2 + 85, width: W - 10,
            text: 'V: 0 V', fontSize: 10,
            fill: '#1565c0', align: 'left',
        });
        this.group.add(this.voltText);

        // 电流表
        this.ampText = new Konva.Text({
            x: -W / 2 + 5, y: -H / 2 + 100, width: W - 10,
            text: 'A: 0 A', fontSize: 10,
            fill: '#1565c0', align: 'left',
        });
        this.group.add(this.ampText);

        // 频率表
        this.hzText = new Konva.Text({
            x: -W / 2 + 5, y: -H / 2 + 115, width: W - 10,
            text: 'Hz: 0.0', fontSize: 10,
            fill: '#1565c0', align: 'left',
        });
        this.group.add(this.hzText);

        // 端口：发电机进线
        this.addPort(-W / 2, -H / 4, 'gen_in', 'wire');
        // 端口：负载出线
        this.addPort(W / 2, -H / 4, 'load_out', 'wire');
        // 端口：控制信号
        this.addPort(0, H / 2, 'ctrl', 'wire');
    }

    /** 更新仪表显示 */
    updateState(voltage, current, frequency) {
        this.voltText.text(`V: ${Math.round(voltage || 0)} V`);
        this.ampText.text(`A: ${Math.round(current || 0)} A`);
        this.hzText.text(`Hz: ${(frequency || 0).toFixed(1)}`);
        this._refreshCache();
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
