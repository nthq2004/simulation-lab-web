import { BaseComponent } from './BaseComponent.js';

export class ConstantCurrentSource extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);
        this._initGroups();

        this.width = 200;
        this.height = 80;
        this.type = 'cc_source';
        this.cache = 'fixed';

        this.currentValue = parseFloat(config.currentValue) || 0.001;
        this.unitLabel = config.unitLabel || 'mA';
        this.displayValue = this.currentValue * (this.unitLabel === 'mA' ? 1000 : 1000000);
        this._drawBody();
        this._drawTerminals();

        this.addPort(30, this.height, 'com', 'wire');
        this.addPort(170, this.height, 'i1', 'wire', 'p');

        this.config = { id: this.id, currentValue: this.currentValue, unitLabel: this.unitLabel };
    }

    _drawBody() {
        this._staticGroup.add(new Konva.Rect({
            x: 0, y: 0, width: this.width, height: this.height,
            fill: '#ecf0f1', stroke: '#2c3e50', strokeWidth: 2, cornerRadius: 6,
        }));

        this._staticGroup.add(new Konva.Text({
            x: 10, y: 6, text: '恒流源', fontSize: 16,
            fill: '#333', fontStyle: 'bold',
        }));

        this._valueText = new Konva.Text({
            x: 10, y: 30, text: this.displayValue.toFixed(1) + ' ' + this.unitLabel,
            fontSize: 20, fill: '#2980b9', fontStyle: 'bold', fontFamily: 'Courier New',
        });
        this._dynamicGroup.add(this._valueText);

        this._staticGroup.add(new Konva.Text({
            x: this.width - 60, y: 6, text: '江苏航院',
            fontSize: 12, fill: '#999',
        }));
    }

    _drawTerminals() {
        this._staticGroup.add(new Konva.Circle({
            x: 30, y: this.height, radius: 6,
            fill: '#bbb', stroke: '#333', strokeWidth: 1,
        }));
        this._staticGroup.add(new Konva.Circle({
            x: 30, y: this.height, radius: 2.5, fill: '#fff',
        }));
        this._staticGroup.add(new Konva.Text({
            x: 15, y: this.height - 16, width: 30, text: 'COM',
            fontSize: 10, fill: '#e74c3c', align: 'center', fontStyle: 'bold',
        }));

        this._staticGroup.add(new Konva.Circle({
            x: 170, y: this.height, radius: 6,
            fill: '#bbb', stroke: '#333', strokeWidth: 1,
        }));
        this._staticGroup.add(new Konva.Circle({
            x: 170, y: this.height, radius: 2.5, fill: '#fff',
        }));
        this._staticGroup.add(new Konva.Text({
            x: 155, y: this.height - 16, width: 30, text: 'OUT',
            fontSize: 10, fill: '#2980b9', align: 'center', fontStyle: 'bold',
        }));
    }

    tick(dt) {
        if (this._valueText) {
            this.displayValue = this.currentValue * (this.unitLabel === 'mA' ? 1000 : 1000000);
            this._valueText.text(this.displayValue.toFixed(1) + ' ' + this.unitLabel);
        }
        this.markDirty();
        this._refreshIfDirty();
    }

    getConfigFields() {
        return [
            { label: '名称', key: 'id', type: 'text' },
            { label: '电流值 (A)', key: 'currentValue', type: 'number' },
            { label: '单位', key: 'unitLabel', type: 'select',
              options: [{ label: 'mA', value: 'mA' }, { label: 'µA', value: 'µA' }] },
        ];
    }

    onConfigUpdate(cfg) {
        if (cfg.currentValue !== undefined) this.currentValue = parseFloat(cfg.currentValue);
        if (cfg.unitLabel !== undefined) this.unitLabel = cfg.unitLabel;
        this.config = { ...this.config, ...cfg };
        this._refreshCache();
    }

    getValue() { return this.currentValue; }

    destroy() { super.destroy?.(); }
}
