import { BaseComponent } from './BaseComponent.js';

export class ConstantCurrentSource extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);
        this._initGroups();

        this.width = 300;
        this.height = 80;
        this.type = 'cc_source';
        this.cache = 'fixed';

        this._drawBody();
        this._drawTerminals();

        const portY = this.height;
        this.addPort(30, portY, 'com', 'wire');
        this.addPort(90, portY, 'i1', 'wire', 'p');
        this.addPort(150, portY, 'i2', 'wire', 'p');
        this.addPort(210, portY, 'i3', 'wire', 'p');
        this.addPort(270, portY, 'i4', 'wire', 'p');
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

        this._staticGroup.add(new Konva.Text({
            x: this.width - 70, y: 6, text: '江苏航院',
            fontSize: 14, fill: '#999',
        }));

        const labels = ['COM', '1mA', '100µA', '10µA', '1µA'];
        const xs = [30, 90, 150, 210, 270];
        const ty = 55;
        labels.forEach((lbl, i) => {
            this._staticGroup.add(new Konva.Text({
                x: xs[i] - 20, y: ty,
                width: 40, text: lbl, fontSize: 14,
                fill: i === 0 ? '#e74c3c' : '#2980b9',
                align: 'center', fontStyle: 'bold',
            }));
        });
    }

    _drawTerminals() {
        const xs = [30, 90, 150, 210, 270];
        const portY = this.height;
        xs.forEach(x => {
            this._staticGroup.add(new Konva.Circle({
                x, y: portY, radius: 6,
                fill: '#bbb', stroke: '#333', strokeWidth: 1,
            }));
            this._staticGroup.add(new Konva.Circle({
                x, y: portY, radius: 2.5, fill: '#fff',
            }));
        });
    }

    destroy() {
        super.destroy?.();
    }
}
