import { BaseComponent } from '../BaseComponent.js';

/**
 * AirDistributor - 压缩空气分配系统 2D 组件
 * 含起动空气 + 控制空气双路输出
 */
export class AirDistributor extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.type = 'air_distributor';
        this.cache = 'fixed';

        this._initGroups();
        const W = 140;
        const H = 130;

        // 分配器主体
        const rect = new Konva.Rect({
            x: -W / 2, y: -H / 2, width: W, height: H,
            fill: '#e3f2fd', stroke: '#0d47a1', strokeWidth: 2,
            cornerRadius: 6,
        });
        this._staticGroup.add(rect);

        // 标题
        const title = new Konva.Text({
            x: -W / 2 + 5, y: -H / 2 + 5, width: W - 10,
            text: '空气分配器', fontSize: 12, fontStyle: 'bold',
            fill: '#0d47a1', align: 'center',
        });
        this._staticGroup.add(title);

        // 起动空气路
        const startLabel = new Konva.Text({
            x: -W / 2 + 10, y: -H / 2 + 35,
            text: '起动空气', fontSize: 10,
            fill: '#1565c0',
        });
        this._staticGroup.add(startLabel);

        this.startIndicator = new Konva.Rect({
            x: -W / 2 + 10, y: -H / 2 + 50,
            width: 50, height: 12,
            fill: '#bbdefb', stroke: '#64b5f6', strokeWidth: 1,
            cornerRadius: 2,
        });
        this._staticGroup.add(this.startIndicator);

        this.startText = new Konva.Text({
            x: -W / 2 + 12, y: -H / 2 + 50, width: 46,
            text: '关', fontSize: 9,
            fill: '#333', align: 'center',
        });
        this._staticGroup.add(this.startText);

        // 控制空气路
        const ctrlLabel = new Konva.Text({
            x: -W / 2 + 10, y: -H / 2 + 70,
            text: '控制空气', fontSize: 10,
            fill: '#1565c0',
        });
        this._staticGroup.add(ctrlLabel);

        this.ctrlIndicator = new Konva.Rect({
            x: -W / 2 + 10, y: -H / 2 + 85,
            width: 50, height: 12,
            fill: '#bbdefb', stroke: '#64b5f6', strokeWidth: 1,
            cornerRadius: 2,
        });
        this._staticGroup.add(this.ctrlIndicator);

        this.ctrlText = new Konva.Text({
            x: -W / 2 + 12, y: -H / 2 + 85, width: 46,
            text: '关', fontSize: 9,
            fill: '#333', align: 'center',
        });
        this._staticGroup.add(this.ctrlText);

        // 压力显示
        this.pressText = new Konva.Text({
            x: 15, y: -H / 2 + 50, width: W - 20,
            text: 'P: 0.0 MPa', fontSize: 10,
            fill: '#1b5e20', align: 'right',
        });
        this._staticGroup.add(this.pressText);

        // 端口
        this.addPort(0, -H / 2, 'supply', 'pipe');
        this.addPort(-W / 2, H / 4, 'start_out', 'pipe');
        this.addPort(W / 2, H / 4, 'ctrl_out', 'pipe');
    }

    /** 更新状态 */
    updateState(supplyPress, startAirOn, controlAirOn) {
        this.pressText.text(`P: ${(supplyPress || 0).toFixed(1)} MPa`);
        this.startIndicator.fill(startAirOn ? '#4caf50' : '#bbdefb');
        this.startText.text(startAirOn ? '开' : '关');
        this.ctrlIndicator.fill(controlAirOn ? '#4caf50' : '#bbdefb');
        this.ctrlText.text(controlAirOn ? '开' : '关');
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
