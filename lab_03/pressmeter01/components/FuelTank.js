import { BaseComponent } from './BaseComponent.js';

/**
 * FuelTank - 燃油舱/日用柜 2D 原理图组件
 * 带液位指示和温度显示
 */
export class FuelTank extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.type = 'fuel_tank';
        this.cache = 'fixed';

        const W = 80;
        const H = 120;

        // 柜体（圆角矩形，象征油柜）
        const tank = new Konva.Rect({
            x: -W / 2, y: -H / 2, width: W, height: H,
            fill: '#fce4ec', stroke: '#b71c1c', strokeWidth: 2,
            cornerRadius: 4,
        });
        this.group.add(tank);

        // 液位指示条
        this.levelBar = new Konva.Rect({
            x: -W / 2 + 10, y: -H / 2 + 10,
            width: W - 20, height: H - 20,
            fill: '#ffcdd2', stroke: '#ef9a9a', strokeWidth: 1,
        });
        this.group.add(this.levelBar);

        // 液位填充
        this.levelFill = new Konva.Rect({
            x: -W / 2 + 12, y: -H / 2 + 12,
            width: W - 24, height: 0,
            fill: '#c62828',
            cornerRadius: 2,
        });
        this.group.add(this.levelFill);

        // 液位文字
        this.levelText = new Konva.Text({
            x: -W / 2 + 5, y: H / 2 - 30, width: W - 10,
            text: '0%', fontSize: 11,
            fill: '#fff', align: 'center',
            fontStyle: 'bold',
        });
        this.group.add(this.levelText);

        // 温度显示
        this.tempText = new Konva.Text({
            x: -W / 2 + 5, y: H / 2 - 16, width: W - 10,
            text: '25°C', fontSize: 9,
            fill: '#c62828', align: 'center',
        });
        this.group.add(this.tempText);

        // 端口
        this.addPort(0, -H / 2, 'inlet', 'pipe');
        this.addPort(0, H / 2, 'outlet', 'pipe');
    }

    /** 更新液位显示 */
    updateState(level, temperature) {
        const H = this.height || 120;
        const pct = Math.max(0, Math.min(1, (level || 0) / 100));
        const fillH = (H - 24) * pct;
        this.levelFill.height(fillH);
        this.levelFill.y(-H / 2 + 12 + (H - 24 - fillH));
        this.levelText.text(`${Math.round(level || 0)}%`);
        this.tempText.text(`${Math.round(temperature || 25)}°C`);
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
