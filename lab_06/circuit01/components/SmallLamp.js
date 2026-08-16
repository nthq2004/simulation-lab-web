import { BaseComponent } from './BaseComponent.js';

const COLOR_MAP = {
    'green':  { r:100, g:255, b:100 },
    'red':    { r:255, g:80,  b:80  },
    'yellow': { r:255, g:255, b:80  },
    'blue':   { r:80,  g:160, b:255 },
    'white':  { r:255, g:245, b:230 },
};

export class SmallLamp extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);
        this.width = 60;
        this.height = 60;
        this.type = 'resistor';
        this.cache = 'fixed';
        this._initGroups();

        this.vRated = 1.5;
        this._color = config.lampColor || 'green';
        this._burnedOut = false;
        this._brightness = 0;
        this.currentResistance = parseFloat(config.resistance) || 0.5;
        this.config = { id: this.id, lampColor: this._color, resistance: this.currentResistance };

        this._drawStaticParts();
        this._init();

        this.addPort(-30, 0, 'l', 'wire');
        this.addPort(30, 0, 'r', 'wire');
    }

    _drawStaticParts() {
        this._staticGroup.add(new Konva.Line({ points:[-30,0,-14,0], stroke:'#666', strokeWidth:2 }));
        this._staticGroup.add(new Konva.Line({ points:[14,0,30,0], stroke:'#666', strokeWidth:2 }));

        this._staticGroup.add(new Konva.Circle({ x:0, y:0, radius:14, fill:'#e8f0f8', stroke:'#888', strokeWidth:1.5 }));

        this._staticGroup.add(new Konva.Line({ points:[-8,0,-4,-6,0,0,4,-6,8,0], stroke:'#aaa', strokeWidth:1.2, tension:0.3, listening:false }));
        this._staticGroup.add(new Konva.Line({ points:[-6,0,-6,-10], stroke:'#888', strokeWidth:0.8, listening:false }));
        this._staticGroup.add(new Konva.Line({ points:[6,0,6,-10], stroke:'#888', strokeWidth:0.8, listening:false }));
    }

    _init() {
        this._glowOverlay = new Konva.Circle({ x:0, y:0, radius:16, fill:'#000000', opacity:0, listening:false });
        this._dynamicGroup.add(this._glowOverlay);

        this._infoText = new Konva.Text({ x:-30, y:18, text:'', fontSize:10, fontFamily:'Courier New', fill:'#2c3e50', width:60, align:'center', fontStyle:'bold' });
        this._dynamicGroup.add(this._infoText);
    }

    tick(dt) {
        const v = this.sys.getVoltageBetween(this.id + '_wire_l', this.id + '_wire_r') || 0;
        const absV = Math.abs(v);
        const R = this.currentResistance;

        const currentA = R > 0.001 ? absV / R : 0;
        const ratedI = this.vRated / R;

        let targetBrightness = 0;
        if (currentA > 0.01) {
            targetBrightness = Math.min(1, currentA / ratedI);
        }

        this._brightness += (targetBrightness - this._brightness) * 0.15;

        if (currentA > ratedI * 2) {
            this._burnedOut = true;
        }

        if (this._burnedOut) {
            this.currentResistance = 1e9;
            this._glowOverlay.opacity(0);
            this._infoText.text('烧毁');
            return;
        }

        this.currentResistance = R;
        const displayA = currentA;
        this._infoText.text(displayA.toFixed(2) + 'A');

        if (this._brightness < 0.01) {
            this._glowOverlay.opacity(0);
        } else {
            const c = COLOR_MAP[this._color] || COLOR_MAP.green;
            const t = this._brightness;
            const r = Math.round(c.r * t);
            const g = Math.round(c.g * t);
            const b = Math.round(c.b * t);
            this._glowOverlay.fill('rgb(' + r + ',' + g + ',' + b + ')');
            this._glowOverlay.opacity(0.2 + 0.8 * t);
        }
        this.markDirty();
        this._refreshIfDirty();
    }

    getConfigFields() { return [
        { label: '名称', key: 'id', type: 'text' },
        { label: '颜色', key: 'lampColor', type: 'select',
          options: [
              { label: '绿色', value: 'green' },
              { label: '红色', value: 'red' },
              { label: '黄色', value: 'yellow' },
              { label: '蓝色', value: 'blue' },
              { label: '白色', value: 'white' },
          ]},
        { label: '电阻 (Ω)', key: 'resistance', type: 'number' },
    ]; }

    onConfigUpdate(cfg) {
        if (cfg.lampColor !== undefined) this._color = cfg.lampColor;
        if (cfg.resistance !== undefined) this.currentResistance = parseFloat(cfg.resistance);
        this.config = { ...this.config, ...cfg };
        this._refreshCache();
    }

    getValue() { return this.currentResistance; }
    destroy() { super.destroy?.(); }
}
