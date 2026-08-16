import { BaseComponent } from './BaseComponent.js';

export class ACPower3P extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);
        this.width = 160; // 稍宽一些以容纳4个接线柱
        this.height = 125;
        this.type = 'source_3p';
        this.cache = 'fixed';
        this.isOn = false;
        this.vRms = 220; // 默认有效值 220V
        this.freq = 50;  // 固定 50Hz
        this.rOn =0.1;

        this._init();

        // 4个接线柱：U, V, W, N (从左到右)
        this.addPort(30, 125, 'u', 'wire', 'p');
        this.addPort(65, 125, 'v', 'wire', 'p');
        this.addPort(100, 125, 'w', 'wire', 'p');
        this.addPort(135, 125, 'n', 'wire');
    }

    _init() {
        this._drawChassis();
        this._drawNameplate();
        this._drawLCD();
        this._drawControls();
    }

    _drawChassis() {
        this.chassis = new Konva.Rect({
            width: this.width, height: this.height,
            fill: '#e3e9ef', stroke: '#1a252f',
            strokeWidth: 3, cornerRadius: 5
        });
        this.group.add(this.chassis);
    }

    _drawNameplate() {
        const title = new Konva.Text({
            x: 10, y: 5, text: '三相电源',
            fontSize: 12, fill: '#060606', fontStyle: 'bold'
        });
        this.group.add(title);
    }

    _drawLCD() {
        const lcdBg = new Konva.Rect({
            x: 10, y: 18, width: this.width - 20, height: 40,
            fill: '#000', cornerRadius: 3
        });
        this.vText = new Konva.Text({
            x: 10, y: 22, width: this.width - 20, text: '',
            fontSize: 18, fontFamily: 'monospace', fill: '#00ff00', align: 'center'
        });
        this.fText = new Konva.Text({
            x: 10, y: 42, width: this.width - 20, text: '',
            fontSize: 11, fontFamily: 'monospace', fill: '#eef207', align: 'center'
        });
        this.group.add(lcdBg, this.vText, this.fText);
    }

    _drawControls() {
        const ctrlY = 75;

        // 电源键
        this.powerBtn = new Konva.Rect({
            x: 10, y: ctrlY+3, width: 35, height: 25,
            fill: '#95a5a6', cornerRadius: 3, cursor: 'pointer'
        });
        this.powerBtn.on('mousedown touchstart', () => {
            this.isOn = !this.isOn;
            this.update();
        });

        // 旋钮 (0-500V 调节)
        this.knob = new Konva.Circle({
            x: 110, y: ctrlY + 15, radius: 25,
            fill: '#7f8c8d', stroke: '#bdc3c7', cursor: 'pointer'
        });
        this.pointer = new Konva.Line({
            x: 110, y: ctrlY + 15, points: [0, 0, 0, -20],
            stroke: '#e74c3c', strokeWidth: 3
        });
        const angle = (this.vRms / 500) * 260 - 130;
        this.pointer.rotation(angle);
        this.knob.on('mousedown touchstart', (e) => {
            e.cancelBubble = true;
            const startY = e.evt.clientY || e.evt.touches[0].clientY;
            const startV = this.vRms;
            const onMove = (me) => {
                const cy = me.clientY || (me.touches ? me.touches[0].clientY : me.clientY);
                this.vRms = Math.max(0, Math.min(500, startV + (startY - cy) * 2));
                this.update();
            };
            const onUp = () => {
                window.removeEventListener('mousemove', onMove);
                window.removeEventListener('mouseup', onUp);
            };
            window.addEventListener('mousemove', onMove);
            window.addEventListener('mouseup', onUp);
        });

        this.group.add(this.powerBtn, this.knob, this.pointer);
    }

    /**
     * 获取指定相位的电压 (U, V, W)
     * 相位偏移: U=0, V=-120°, W=-240°
     */
    getPhaseVoltage(phase, time) {
        if (!this.isOn) return 0;
        const peak = this.vRms * Math.sqrt(2);
        const omega = 2 * Math.PI * this.freq;
        let offset = 0;
        
        if (phase === 'v') offset = -2 * Math.PI / 3;      // -120°
        else if (phase === 'w') offset = -4 * Math.PI / 3; // -240°
        
        return peak * Math.sin(omega * time + offset);
    }

    update() {
        const angle = (this.vRms / 500) * 260 - 130;
        this.pointer.rotation(angle);
        this.powerBtn.fill(this.isOn ? '#2ecc71' : '#95a5a6');
        this.vText.text(this.isOn ? `${this.vRms.toFixed(0)} V` : '');
        this.fText.text(this.isOn ? `${this.freq.toFixed(0)} Hz` : '');
        if (this.sys.onComponentStateChange) this.sys.onComponentStateChange(this);
        this._refreshCache();
    }
}