import { BaseComponent } from './BaseComponent.js';

export class DiagramACPower3P extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.width  = 160;
        this.height = 25;

        this.type  = 'source_3p';
        this.cache = 'fixed';

        this._initGroups();

        this.isOn     = config.isOn     !== undefined ? config.isOn     : true;
        this.vRms     = config.vRms     !== undefined ? config.vRms     : 220;
        this.freq     = config.freq     !== undefined ? config.freq     : 50;
        this.phaseSeq = config.phaseSeq || 'pos';
        this.rOn      = 0.01;

        this._init();

        this.addPort(30,  25, 'u', 'wire', 'p');
        this.addPort(65,  25, 'v', 'wire', 'p');
        this.addPort(100, 25, 'w', 'wire', 'p');
        this.addPort(135, 25, 'n', 'wire');

        this.config = {
            vRms: this.vRms,
            freq: this.freq,
            phaseSeq: this.phaseSeq,
            isOn: this.isOn,
        };

        this.update();
    }

    _init() {
        this._drawFrame();
        this._drawTerminals();
        this._drawDisplay();
    }

    _drawFrame() {
        this._staticGroup.add(new Konva.Rect({
            width: this.width, height: this.height,
            fill: '#f8f9fa',
            stroke: '#1a252f',
            strokeWidth: 1.5,
            dash: [6, 4],
            cornerRadius: 4,
        }));
    }

    _drawTerminals() {
        const pts = [
            { x: 30,  label: 'U' },
            { x: 65,  label: 'V' },
            { x: 100, label: 'W' },
            { x: 135, label: 'N' },
        ];
        const ty = this.height - 18;

        pts.forEach(p => {
            this._staticGroup.add(new Konva.Text({
                x: p.x - 5, y: ty-2 ,
                text: p.label,
                fontSize: 12, fontStyle: 'bold', fill: '#222',
            }));
        });
    }

    _drawDisplay() {
        this._vText = new Konva.Text({
            x: 0, y: -20,
            width: this.width,
            text: '',
            fontSize: 18,
            fontFamily: 'monospace',
            fill: '#e03030',
            align: 'center',
        });
        this._staticGroup.add(this._vText);
    }

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
        const lineV = this.isOn ? this.vRms * Math.sqrt(3) : 0;
        this._vText.text(this.isOn ? `${lineV.toFixed(0)} V` : '');

        if (this.sys && this.sys.onComponentStateChange) this.sys.onComponentStateChange(this);
        this._refreshCache();
    }

    getConfigFields() {
        return [
            { label: '相电压有效值 (V)', key: 'vRms', type: 'number' },
            { label: '频率 (Hz)', key: 'freq', type: 'number' },
            { label: '相序', key: 'phaseSeq', type: 'select', options: [
                { label: '正序 (UVW)', value: 'pos' },
                { label: '负序 (UWV)', value: 'neg' },
            ]},
            { label: '电源开关', key: 'isOn', type: 'select', options: [
                { label: '关闭', value: false },
                { label: '开启', value: true },
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
