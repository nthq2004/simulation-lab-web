import { BaseComponent } from './BaseComponent.js';

/**
 * Governor - 调速器 2D 原理图组件
 * 转速设定、实际转速显示、油门输出
 */
export class Governor extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.type = 'governor';
        this.cache = 'fixed';

        this._initGroups();
        const W = 120;
        const H = 140;

        // 主体矩形
        const rect = new Konva.Rect({
            x: -W / 2, y: -H / 2, width: W, height: H,
            fill: '#e3f2fd', stroke: '#1565c0', strokeWidth: 2,
            cornerRadius: 6,
        });
        this._staticGroup.add(rect);

        // 标题
        const title = new Konva.Text({
            x: -W / 2 + 5, y: -H / 2 + 5, width: W - 10,
            text: '调速器', fontSize: 13, fontStyle: 'bold',
            fill: '#0d47a1', align: 'center',
        });
        this._staticGroup.add(title);

        // 转速表盘
        const dial = new Konva.Arc({
            x: 0, y: -H / 2 + 40,
            innerRadius: 20, outerRadius: 30,
            angle: 180, fill: '#bbdefb',
            stroke: '#1565c0', strokeWidth: 1,
            rotation: 180,
        });
        this._staticGroup.add(dial);

        // 指针
        this.needle = new Konva.Line({
            points: [0, 0, 0, -25],
            x: 0, y: -H / 2 + 40,
            stroke: '#e53935', strokeWidth: 2,
            lineCap: 'round',
        });
        this._staticGroup.add(this.needle);

        // 转速数字显示
        this.rpmText = new Konva.Text({
            x: -25, y: -H / 2 + 45, width: 50,
            text: '0 rpm', fontSize: 9,
            fill: '#333', align: 'center',
        });
        this._staticGroup.add(this.rpmText);

        // 油门输出指示
        this.fuelText = new Konva.Text({
            x: -W / 2 + 5, y: H / 2 - 30, width: W - 10,
            text: '油门: 0%', fontSize: 10,
            fill: '#2e7d32', align: 'center',
        });
        this._staticGroup.add(this.fuelText);

        // 端口：控制输入
        this.addPort(-W / 2, 0, 'ctrl', 'wire');
        // 端口：油门输出
        this.addPort(W / 2, 0, 'fuel_out', 'wire');
    }

    /** 更新调速器显示 */
    updateState(rpm, fuelCommand) {
        const displayRpm = Math.round(rpm || 0);
        const displayFuel = Math.round((fuelCommand || 0) * 100);
        this.rpmText.text(`${displayRpm} rpm`);
        this.fuelText.text(`油门: ${displayFuel}%`);

        // 指针角度: 0rpm=-90deg, 180rpm=90deg
        const angle = -90 + (rpm || 0) * 180 / 180;
        this.needle.rotation(Math.max(-90, Math.min(90, angle)));

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


    destroy() {
        super.destroy?.();
    }
}
