import { BaseComponent } from './BaseComponent.js';

/**
 * GeneratorUnit - 发电机组 2D 原理图符号
 * 包含原动机 + 发电机 + 电压/频率表
 */
export class GeneratorUnit extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.type = 'generator';
        this.cache = 'fixed';

        this._initGroups();
        const W = 140;
        const H = 120;

        // 发电机主体（圆形）
        const body = new Konva.Circle({
            x: 0, y: 0, radius: 40,
            fill: '#fff3e0', stroke: '#e65100', strokeWidth: 2,
        });
        this._staticGroup.add(body);

        // 转子绕组符号（~）
        const wave = new Konva.Path({
            x: -20, y: -8,
            data: 'M0 8 Q10 -8 20 8 Q30 -8 40 8',
            stroke: '#e65100', strokeWidth: 2,
            fill: null,
        });
        this._staticGroup.add(wave);

        // "G" 标签
        const label = new Konva.Text({
            x: -10, y: 15, width: 20,
            text: 'G', fontSize: 18, fontStyle: 'bold',
            fill: '#bf360c', align: 'center',
        });
        this._staticGroup.add(label);

        // 电压表
        this.voltText = new Konva.Text({
            x: -W / 2 + 5, y: -H / 2 + 5, width: W - 10,
            text: 'V: 0 V', fontSize: 10,
            fill: '#1b5e20', align: 'left',
        });
        this._staticGroup.add(this.voltText);

        // 频率表
        this.freqText = new Konva.Text({
            x: -W / 2 + 5, y: -H / 2 + 18, width: W - 10,
            text: 'Hz: 0.0', fontSize: 10,
            fill: '#1b5e20', align: 'left',
        });
        this._staticGroup.add(this.freqText);

        // 端口：电能输出（三相）
        this.addPort(50, -15, 'L1', 'wire');
        this.addPort(50, 0, 'L2', 'wire');
        this.addPort(50, 15, 'L3', 'wire');
    }

    /** 更新仪表显示 */
    updateState(voltage, frequency) {
        this.voltText.text(`V: ${Math.round(voltage || 0)} V`);
        this.freqText.text(`Hz: ${(frequency || 0).toFixed(1)}`);
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
