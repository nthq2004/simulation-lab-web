import { BaseComponent } from './BaseComponent.js';

/**
 * OilSeparator - 分油机 2D 原理图符号
 * 用于燃油/滑油净化系统
 */
export class OilSeparator extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.type = 'oil_separator';
        this.cache = 'fixed';

        const R = 35;

        // 分离筒（圆形）
        const bowl = new Konva.Circle({
            x: 0, y: 0, radius: R,
            fill: '#e8f5e9', stroke: '#2e7d32', strokeWidth: 2,
        });
        this.group.add(bowl);

        // 同心圆（象征离心分离）
        for (let i = 1; i <= 3; i++) {
            const ring = new Konva.Circle({
                x: 0, y: 0, radius: R * i / 4,
                stroke: '#a5d6a7', strokeWidth: 1,
                fill: null,
            });
            this.group.add(ring);
        }

        // 标签
        const label = new Konva.Text({
            x: -15, y: -8, width: 30,
            text: 'sep', fontSize: 10, fontStyle: 'bold',
            fill: '#1b5e20', align: 'center',
        });
        this.group.add(label);

        // 运行指示灯
        this.runLight = new Konva.Circle({
            x: R - 8, y: -R + 8, radius: 4,
            fill: '#9e9e9e',
        });
        this.group.add(this.runLight);

        // 端口
        this.addPort(0, -R, 'inlet', 'pipe');
        this.addPort(-R / 2, R, 'oil_out', 'pipe');
        this.addPort(R / 2, R, 'water_out', 'pipe');
    }

    /** 更新状态 */
    updateState(running) {
        this.runLight.fill(running ? '#4caf50' : '#9e9e9e');
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
