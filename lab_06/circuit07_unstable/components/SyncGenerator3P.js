import { BaseComponent } from './BaseComponent.js';

/**
 * 简单同步发电机（仿真组件 · 最小实现版）
 *
 * 概述：输出对称三相交流电压（U、V、W 三相 + 中性线 N），
 * 本质与三相交流电源一致，采用诺顿等效接入 MNA 求解器。
 * 本版本只实现最基本的电压源特性，后续可扩展励磁调节、转速、
 * 并车/逆功率等物理特性。
 *
 * 三相电压关系（平衡三相，正序 UVW）：
 *  - U 相：参考相（ϕ = 0°）
 *  - V 相：相位滞后 120°
 *  - W 相：相位滞后 240°
 *  - N 端：中性线
 *
 * 端口坐标（相对于组件左上角）：
 *  - addPort(30, 125, 'u', 'wire', 'p')
 *  - addPort(65, 125, 'v', 'wire', 'p')
 *  - addPort(100, 125, 'w', 'wire', 'p')
 *  - addPort(135, 125, 'n', 'wire')
 *
 * 可配置参数：
 *  - vRms: 相电压有效值（默认 220V，范围 0~500V）
 *  - freq: 工作频率（默认 50Hz）
 *  - isOn: 是否发电（默认 true）
 */
export class SyncGenerator3P extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.width  = 170;
        this.height = 125;

        this.type  = 'gen_3p';
        this.cache = 'fixed';

        this._initGroups();

        this.isOn    = config.isOn !== undefined ? config.isOn : true;
        this.vRms    = config.vRms !== undefined ? config.vRms : 220;
        this.freq    = config.freq !== undefined ? config.freq : 50;
        this.phaseSeq = config.phaseSeq || 'pos';
        this.rOn     = 0.01;

        this._init();

        this.addPort(30, 125, 'u', 'wire', 'p');
        this.addPort(65, 125, 'v', 'wire', 'p');
        this.addPort(100, 125, 'w', 'wire', 'p');
        this.addPort(135, 125, 'n', 'wire');
        this.update();
    }

    _init() {
        this._drawChassis();
        this._drawGeneratorSymbol();
        this._drawNameplate();
        this._drawLCD();
        this._drawPowerButton();
    }

    _drawChassis() {
        this.chassis = new Konva.Rect({
            width: this.width, height: this.height,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint: { x: this.width, y: this.height },
            fillLinearGradientColorStops: [0, '#dde6ee', 0.5, '#c3d0dc', 1, '#aebfd0'],
            stroke: '#1a252f', strokeWidth: 3, cornerRadius: 5,
        });
        this._staticGroup.add(this.chassis);
    }

    _drawGeneratorSymbol() {
        // 定子圆环（左侧装饰，突出"发电机"属性）
        const gx = 28, gy = 62;
        this._staticGroup.add(new Konva.Circle({
            x: gx, y: gy, radius: 22,
            fill: 'none', stroke: '#4a6a8a', strokeWidth: 2,
        }));
        this._staticGroup.add(new Konva.Circle({
            x: gx, y: gy, radius: 12,
            fill: '#4a6a8a',
        }));
        this._staticGroup.add(new Konva.Text({
            x: gx - 7, y: gy - 7, text: 'G', fontSize: 13,
            fontStyle: 'bold', fill: '#ffffff',
        }));
        // 旋转方向箭头（装饰）
        this._staticGroup.add(new Konva.Text({
            x: gx + 10, y: gy - 30, text: '⟳', fontSize: 16, fill: '#2a6a4a',
        }));
    }

    _drawNameplate() {
        const title = new Konva.Text({
            x: 10, y: 5, text: '同步发电机',
            fontSize: 13, fill: '#060606', fontStyle: 'bold',
        });
        this._staticGroup.add(title);
        const sub = new Konva.Text({
            x: 92, y: 8, text: '3P·AC',
            fontSize: 10, fill: '#38506a',
        });
        this._staticGroup.add(sub);
    }

    _drawLCD() {
        const lcdBg = new Konva.Rect({
            x: 56, y: 22, width: this.width - 68, height: 40,
            fill: '#000', cornerRadius: 3,
        });
        this.vText = new Konva.Text({
            x: 56, y: 25, width: this.width - 68, text: '',
            fontSize: 15, fontFamily: 'monospace', fill: '#00ff00', align: 'center',
        });
        this.fText = new Konva.Text({
            x: 56, y: 44, width: this.width - 68, text: '',
            fontSize: 10, fontFamily: 'monospace', fill: '#eef207', align: 'center',
        });
        this._staticGroup.add(lcdBg, this.vText, this.fText);
    }

    _drawPowerButton() {
        this.powerBtn = new Konva.Rect({
            x: 140, y: 92, width: 24, height: 18,
            fill: this.isOn ? '#2ecc71' : '#95a5a6',
            cornerRadius: 3, cursor: 'pointer',
        });
        this._powerLabel = new Konva.Text({
            x: 112, y: 93, text: '发电', fontSize: 10, fill: '#203040',
        });
        this.powerBtn.on('mousedown touchstart', (e) => {
            e.cancelBubble = true;
            this.isOn = !this.isOn;
            this.update();
        });
        this._interactGroup.add(this.powerBtn, this._powerLabel);
    }

    /**
     * 获取指定相位的瞬时电压值（供 MNA 求解器调用）
     * U 相参考 0°，V/W 相依次滞后 120°/240°。
     */
    getPhaseVoltage(phase, time) {
        if (!this.isOn) return 0;

        const peak = this.vRms * Math.sqrt(2);
        const omega = 2 * Math.PI * this.freq;

        let offset = 0;
        if (phase === 'v') {
            offset = this.phaseSeq === 'pos' ? -4 * Math.PI / 3 : -2 * Math.PI / 3;
        } else if (phase === 'w') {
            offset = this.phaseSeq === 'pos' ? -2 * Math.PI / 3 : -4 * Math.PI / 3;
        }

        return peak * Math.sin(omega * time + offset);
    }

    update() {
        this.powerBtn.fill(this.isOn ? '#2ecc71' : '#95a5a6');
        this.vText.text(this.isOn ? `${this.vRms.toFixed(0)} V` : '');
        const seqLabel = this.phaseSeq === 'pos' ? '正序' : '负序';
        this.fText.text(this.isOn ? `${this.freq.toFixed(0)} Hz  ${seqLabel}` : '');
        if (this.sys.onComponentStateChange) this.sys.onComponentStateChange(this);
        this._refreshCache();
    }

    getConfigFields() {
        return [
            { label: '相电压有效值 (V)', key: 'vRms', type: 'number', min: 0, max: 500, step: 1 },
            { label: '频率 (Hz)', key: 'freq', type: 'number', min: 0, max: 400, step: 1 },
            { label: '相序', key: 'phaseSeq', type: 'select', options: [
                { label: '正序 (UVW)', value: 'pos' },
                { label: '负序 (UWV)', value: 'neg' },
            ]},
            { label: '发电开关', key: 'isOn', type: 'select', options: [
                { label: '停发', value: false },
                { label: '发电', value: true },
            ]},
        ];
    }

    onConfigUpdate(cfg) {
        if (cfg.vRms !== undefined) this.vRms = parseFloat(cfg.vRms) || 220;
        if (cfg.freq !== undefined) this.freq = parseFloat(cfg.freq) || 50;
        if (cfg.phaseSeq !== undefined) this.phaseSeq = cfg.phaseSeq;
        if (cfg.isOn !== undefined) this.isOn = cfg.isOn === true || cfg.isOn === 'true';
        this.config = { ...this.config, ...cfg };
        this.update();
        this._refreshCache();
    }

    destroy() {
        super.destroy?.();
    }
}
