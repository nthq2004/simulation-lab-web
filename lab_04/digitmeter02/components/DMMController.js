import { BaseComponent } from './BaseComponent.js';

export class DMMController extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);
        this._initGroups();

        this.width  = config.width  || 360;
        this.height = config.height || 200;
        this.type = 'dmm_controller';
        this.cache = 'fixed';

        this.switchId = config.switchId || 'smart_switch';
        this.switchRef = null;

        this._shuntValues = [4, 0.4, 0.04];
        this._rangeNames = ['50mA', '500mA', '5A'];
        this._dividerRatios = [0.999, 0.0999, 0.0099, 0.001];
        this._rangeNamesDCV = ['200mV', '2V', '20V', '200V'];
        this._autoRangeCooldown = 0.5;

        this._drawBody();
        this._drawLCD();

        this.addPort(0, 36, 'vin_p', 'wire', 'p');
        this.addPort(0, 86, 'vin_n', 'wire');
        this.addPort(0, 140, 'a', 'wire','p');
        this.addPort(0, 190, 'b', 'wire');
    }

    _drawBody() {
        const W = this.width, H = this.height;

        this._staticGroup.add(new Konva.Rect({
            x: 0, y: 0, width: W, height: H,
            fill: '#f5f5f5', stroke: '#ccc', strokeWidth: 2, cornerRadius: 6,
        }));

        this._staticGroup.add(new Konva.Text({
            x: 120, y: 10, text: 'DMM 数字控制器', fontSize: 16,
            fill: '#333', fontStyle: 'bold',
        }));

        this._staticGroup.add(new Konva.Text({
            x: -18, y: 20, text: 'Vin+', fontSize: 11, fill: '#e74c3c',
        }));
        this._staticGroup.add(new Konva.Text({
            x: -18, y: 70, text: 'Vin-', fontSize: 11, fill: '#666',
        }));
        this._staticGroup.add(new Konva.Text({
            x: -18, y: 124, text: 'A', fontSize: 10, fill: '#1f8b4c', listening: false,
        }));
        this._staticGroup.add(new Konva.Text({
            x: -18, y: 164, text: 'B', fontSize: 10, fill: '#1f8b4c', listening: false,
        }));
    }

    _drawLCD() {
        const W = this.width, H = this.height;
        const lcdX = 18, lcdW = W - 36, lcdH = 150, lcdY = 40;

        this._staticGroup.add(new Konva.Rect({
            x: lcdX, y: lcdY, width: lcdW, height: lcdH,
            fill: '#000', stroke: '#888', strokeWidth: 1, cornerRadius: 4,
        }));

        this._funcText = new Konva.Text({
            x: lcdX + 12, y: lcdY + 10, width: lcdW - 24,
            text: 'DCA', fontSize: 22, fill: '#0f0',
            fontFamily: 'monospace', fontStyle: 'bold', align: 'center',
        });
        this._dynamicGroup.add(this._funcText);

        this._rangeText = new Konva.Text({
            x: lcdX + 12, y: lcdY + 48, width: lcdW - 24,
            text: '50mA', fontSize: 24, fill: '#0f0',
            fontFamily: 'monospace', fontStyle: 'bold', align: 'center',
        });
        this._dynamicGroup.add(this._rangeText);

        this._valueText = new Konva.Text({
            x: lcdX + 12, y: lcdY + 88, width: lcdW - 24,
            text: '0.000', fontSize: 42, fill: '#0f0',
            fontFamily: 'monospace', fontStyle: 'bold', align: 'center',
        });
        this._dynamicGroup.add(this._valueText);
    }

    _getSwitch() {
        if (!this.switchRef) {
            this.switchRef = this.sys.comps[this.switchId];
        }
        return this.switchRef;
    }

    _autoRange(voltage, pos) {
        if (pos === 1 && voltage > 0.18) {
            this._getSwitch()?.setPosition(2);
        } else if (pos === 2 && voltage > 0.18) {
            this._getSwitch()?.setPosition(3);
        } else if (pos === 3 && voltage > 0.18) {
            this._getSwitch()?.setPosition(4);
        } else if (pos === 2 && voltage < 0.012) {
            this._getSwitch()?.setPosition(1);
        } else if (pos === 3 && voltage < 0.012) {
            this._getSwitch()?.setPosition(2);
        } else if (pos === 4 && voltage < 0.012) {
            this._getSwitch()?.setPosition(3);
        }
    }

    tick(dt) {
        const sw = this._getSwitch();
        if (!sw) return;

        const func = sw.getFunction();

        const vp = this.id + '_wire_vin_p';
        const vn = this.id + '_wire_vin_n';
        let voltage = 0;
        try {
            voltage = this.sys.getVoltageBetween(vp, vn) || 0;
        } catch (e) { voltage = 0; }

        this._funcText.text(func);

        if (func === 'DCA') {
            const pos = sw.getPosition();
            const Rs = this._shuntValues[pos - 1] || this._shuntValues[0];
            const currentA = voltage / Rs;

            this._autoRangeCooldown -= dt;
            if (this._autoRangeCooldown <= 0) {
                this._autoRange(voltage, pos);
                this._autoRangeCooldown = 0.5;
            }

            const rangeName = this._rangeNames[pos - 1] || '';
            this._rangeText.text(rangeName);

            const current = Math.abs(currentA);
            let disp;
            if (current < 0.0005) {
                disp = '0.000';
            } else if (pos === 3) {
                disp = current.toFixed(3);
            } else {
                disp = (current * 1000).toFixed(2);
            }
            this._valueText.text(disp);
        } else if (func === 'DCV') {
            const pos = sw.getPosition();
            const ratio = this._dividerRatios[pos - 1] || this._dividerRatios[0];
            const V_mid = Math.abs(voltage);
            const V_src = V_mid / ratio;

            this._autoRangeCooldown -= dt;
            if (this._autoRangeCooldown <= 0) {
                this._autoRange(V_mid, pos);
                this._autoRangeCooldown = 0.5;
            }

            const rangeName = this._rangeNamesDCV[pos - 1] || '';
            this._rangeText.text(rangeName);

            let disp;
            if (V_src < 0.0001) {
                disp = '0.000';
            } else if (pos === 1) {
                disp = (V_src * 1000).toFixed(2);
            } else if (pos === 4) {
                disp = V_src.toFixed(1);
            } else {
                disp = V_src.toFixed(3);
            }
            this._valueText.text(disp);
        } else {
            this._rangeText.text('--');
            this._valueText.text('0.000');
        }

        this.markDirty();
        this._refreshIfDirty();
    }

    getConfigFields() {
        return [
            { label: '关联开关 ID', key: 'switchId', type: 'text' },
        ];
    }

    onConfigUpdate(cfg) {
        if (cfg.switchId !== undefined) {
            this.switchId = cfg.switchId;
            this.switchRef = null;
        }
    }

    destroy() {
        super.destroy?.();
    }
}
