import { BaseComponent } from './BaseComponent.js';

export class DCCurrent extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);
        this._initGroups();

        this.scale = 1.2;
        this.width = 145 * this.scale;
        this.height = 135 * this.scale;

        this.type = 'source';
        this.cache = 'fixed';

        this.isOn = false;
        this.isBreak = false;
        this.currentValue = config.currentValue || 0;
        this.maxValue = 1000;
        this.rOn = 10000000;
        this.range = 'mA';

        this._init();

        this.addPort(45 * this.scale, 135 * this.scale, 'n', 'wire');
        this.addPort(100 * this.scale, 135 * this.scale, 'p', 'wire', 'p');
    }

    _init() {
        this._drawChassis();
        this._drawNameplate();
        this._drawLCD();
        this._drawControls();
    }

    _drawChassis() {
        this.chassis = new Konva.Rect({
            width: this.width,
            height: this.height,
            fill: '#ecf0f1',
            stroke: '#2c3e50',
            strokeWidth: 3 * this.scale,
            cornerRadius: 5 * this.scale
        });
        this._staticGroup.add(this.chassis);
    }

    _drawNameplate() {
        const title = new Konva.Text({
            x: 10 * this.scale, y: 5 * this.scale,
            text: `DC 电流源`,
            fontSize: 12 * this.scale,
            fontStyle: 'bold'
        });
        const school = new Konva.Text({
            x: this.width - 60 * this.scale, y: 5 * this.scale,
            text: '江苏航院',
            fontSize: 11 * this.scale
        });
        this._staticGroup.add(title, school);
    }

    _drawLCD() {
        const lcdHeight = 30 * this.scale;
        const lcdBg = new Konva.Rect({
            x: 10 * this.scale, y: 18 * this.scale,
            width: this.width - 20 * this.scale,
            height: lcdHeight,
            fill: '#000',
            cornerRadius: 3 * this.scale
        });

        this.currentText = new Konva.Text({
            x: 10 * this.scale, y: 22 * this.scale,
            width: this.width - 20 * this.scale,
            text: '',
            fontSize: 22 * this.scale,
            fontFamily: 'monospace',
            fill: '#00ff00',
            align: 'center'
        });

        this._staticGroup.add(lcdBg, this.currentText);
    }

    _drawControls() {
        const ctrlY = 78 * this.scale;

        this._drawPowerButton(ctrlY);
        this._drawRangeSelector(ctrlY);
        this._drawKnob(ctrlY);
    }

    _drawPowerButton(ctrlY) {
        this.powerBtnGroup = new Konva.Group({ x: 12 * this.scale, y: ctrlY });

        this.powerBtnBase = new Konva.Rect({
            width: 33 * this.scale, height: 20 * this.scale,
            fill: '#bdc3c7',
            stroke: '#7f8c8d',
            strokeWidth: 1 * this.scale,
            shadowColor: '#000',
            shadowBlur: 5 * this.scale,
            shadowOffset: { x: 2 * this.scale, y: 2 * this.scale },
            cornerRadius: 2 * this.scale
        });

        const btnText = new Konva.Text({
            x: 0, y: 25 * this.scale,
            text: '电源键',
            fontSize: 12 * this.scale,
            fontStyle: 'bold',
            fill: '#34495e'
        });

        this.powerBtnGroup.add(this.powerBtnBase, btnText);
        this.powerBtnGroup.on('mousedown touchstart', () => {
            this.isOn = !this.isOn;
            this.update();
        });
        this.powerBtnGroup.on('dblclick', (e) => {
            e.cancelBubble = true;
        });
        this._interactGroup.add(this.powerBtnGroup);
    }

    _drawRangeSelector(ctrlY) {
        const rx = 12 * this.scale;
        const ry = ctrlY - 22 * this.scale;
        const ranges = ['uA', 'mA'];
        this._rangeTexts = [];

        this.rangeGroup = new Konva.Group({ x: rx, y: ry });
        this.rangeBg = new Konva.Rect({
            width: 52 * this.scale, height: 16 * this.scale,
            fill: '#2c3e50',
            cornerRadius: 2 * this.scale,
        });
        this.rangeGroup.add(this.rangeBg);

        ranges.forEach((label, i) => {
            const tx = 4 * this.scale + i * 26 * this.scale;
            const txt = new Konva.Text({
                x: tx, y: 2 * this.scale,
                width: 22 * this.scale,
                text: label,
                fontSize: 10 * this.scale,
                fontStyle: 'bold',
                align: 'center',
                fill: label === this.range ? '#00ff00' : '#7f8c8d',
            });
            txt.on('mousedown touchstart', (e) => {
                e.cancelBubble = true;
                this.range = label;
                this._updateRangeHighlight();
                this.update();
            });
            this.rangeGroup.add(txt);
            this._rangeTexts.push(txt);
        });
        this._interactGroup.add(this.rangeGroup);
    }

    _drawKnob(ctrlY) {
        const knobX = this.width - 50 * this.scale;
        const knobY = ctrlY + 10 * this.scale;
        this.knobGroup = new Konva.Group({ x: knobX, y: knobY });

        const scaleValues = [0, 200, 400, 600, 800, 1000];
        scaleValues.forEach(v => {
            const angle = (v / 1000) * 300 - 150;
            const rad = (angle - 90) * Math.PI / 180;
            const r = 32 * this.scale;

            const txt = new Konva.Text({
                x: r * Math.cos(rad) - 10 * this.scale,
                y: r * Math.sin(rad) - 5 * this.scale,
                text: v.toString(),
                fontSize: 10 * this.scale,
                fontStyle: 'bold',
                width: 20 * this.scale,
                align: 'center',
                fill: '#0a1314'
            });
            this.knobGroup.add(txt);
        });

        const knobCircle = new Konva.Circle({
            radius: 26 * this.scale,
            fill: '#e3e8e9',
            stroke: '#34495e',
            cursor: 'hand'
        });

        this.knobPointer = new Konva.Line({
            points: [0, 0, 0, -24 * this.scale],
            stroke: '#e74c3c',
            strokeWidth: 2 * this.scale,
            lineCap: 'round',
            rotation: 135
        });

        this.knobGroup.add(knobCircle, this.knobPointer);

        knobCircle.on('mousedown touchstart', (e) => {
            e.cancelBubble = true;
            const startY = e.evt.clientY || e.evt.touches[0].clientY;
            const startV = this.currentValue;
            const onMove = (me) => {
                const cy = me.clientY || (me.touches ? me.touches[0].clientY : me.clientY);
                this.currentValue = Math.max(0, Math.min(1000, startV + (startY - cy) * 0.5));
                this.update();
            };
            const onUp = () => {
                this.update();
                window.removeEventListener('mousemove', onMove);
                window.removeEventListener('touchmove', onMove);
                window.removeEventListener('mouseup', onUp);
                window.removeEventListener('touchend', onUp);
            };
            window.addEventListener('mousemove', onMove);
            window.addEventListener('touchmove', onMove);
            window.addEventListener('mouseup', onUp);
            window.addEventListener('touchend', onUp);
        });
        knobCircle.on('dblclick', (e) => {
            e.cancelBubble = true;
        });

        this._interactGroup.add(this.knobGroup);
    }

    _updateRangeHighlight() {
        const ranges = ['uA', 'mA'];
        ranges.forEach((label, i) => {
            this._rangeTexts[i].fill(label === this.range ? '#00ff00' : '#7f8c8d');
        });
    }

    _getCurrentInAmps() {
        if (!this.isOn || this.isBreak) return 0;
        return this.range === 'uA' ? this.currentValue * 1e-6 : this.currentValue * 1e-3;
    }

    _updateBtnStyle() {
        if (this.isOn) {
            this.powerBtnBase.setAttrs({
                shadowBlur: 0,
                shadowOffset: { x: 0, y: 0 },
                x: 1 * this.scale, y: 1 * this.scale,
                fill: '#bdc3c7'
            });
        } else {
            this.powerBtnBase.setAttrs({
                shadowBlur: 5 * this.scale,
                shadowOffset: { x: 2 * this.scale, y: 2 * this.scale },
                x: 0, y: 0,
                fill: '#bdc3c7'
            });
        }
    }

    getValue() {
        if (!this.isOn || this.isBreak) return 0;
        const currentA = this._getCurrentInAmps();
        return currentA * this.rOn;
    }

    update() {
        this.rOn = (this.isOn && !this.isBreak) ? 10000000 : 1e9;

        this._updateBtnStyle();
        const angle = (this.currentValue / 1000) * 300 - 150;
        this.knobPointer.rotation(angle);
        if (this.sys.onComponentStateChange)
            this.sys.onComponentStateChange(this);

        if (!this.isOn) {
            this.currentText.text('OFF');
            this.currentText.fill('#333');
        } else {
            const val = this.currentValue;
            let display, unit;
            if (this.range === 'uA') {
                display = val.toFixed(1);
                unit = ' uA';
            } else {
                display = val.toFixed(1);
                unit = ' mA';
            }
            this.currentText.text(display + unit);
            this.currentText.fill('#00ff00');
        }
        this._refreshCache();
    }

    destroy() {
        super.destroy?.();
    }
}
