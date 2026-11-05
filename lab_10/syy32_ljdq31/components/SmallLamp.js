import { BaseComponent } from './BaseComponent.js';

// 点亮时的发光颜色（高饱和亮色）。白色指示灯点亮时呈亮黄色。
const COLOR_MAP = {
    'green':  { r:0,   g:255, b:0   },
    'red':    { r:255, g:0,   b:0   },
    'yellow': { r:255, g:220, b:0   },
    'blue':   { r:0,   g:150, b:255 },
    'white':  { r:255, g:220, b:0   },
};

export class SmallLamp extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);
        this.width = 60;
        this.height = 60;
        this.type = 'resistor';
        this.cache = 'fixed';
        this._initGroups();

        this.vRated = config.ratedVoltage !== undefined ? parseFloat(config.ratedVoltage) : 1.5;
        this._color = config.lampColor || 'green';
        this._burnedOut = false;
        this._brightness = 0;
        // 交流电压滑动 RMS 窗口：求解器每帧给出的是瞬时采样值，直接取绝对值会使
        // 亮度逐帧跳变（闪烁），故按窗口均方根得到稳定电压。
        this._vBuf = [];
        this._vWin = 20;
        this.currentResistance = parseFloat(config.resistance) || 0.5;
        this.config = { id: this.id, lampColor: this._color, ratedVoltage: this.vRated, resistance: this.currentResistance };

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

        // 交流电压滑动 RMS：消除瞬时采样导致的亮度闪烁
        this._vBuf.push(v * v);
        if (this._vBuf.length > this._vWin) this._vBuf.shift();
        const rmsV = Math.sqrt(this._vBuf.reduce((a, b) => a + b, 0) / Math.max(1, this._vBuf.length));

        const R = this.currentResistance;
        const currentA = R > 0.001 ? rmsV / R : 0;
        const ratedI = this.vRated / R;

        // 亮度按电压占额定电压的比例（而非电流阈值），确保 220V 指示灯串限流电阻后仍正常点亮
        let targetBrightness = 0;
        const vRatio = rmsV / this.vRated;
        if (vRatio > 0.15) {
            targetBrightness = Math.min(1, vRatio);
        }

        this._brightness += (targetBrightness - this._brightness) * 0.15;
        if (this._brightness < 0.005) this._brightness = 0;
        if (this._brightness > 0.995) this._brightness = 1;

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
        this._infoText.text(currentA.toFixed(2) + 'A');

        if (this._brightness < 0.01) {
            this._glowOverlay.opacity(0);
        } else {
            const c = COLOR_MAP[this._color] || COLOR_MAP.green;
            const t = this._brightness;
            this._glowOverlay.fill('rgb(' + c.r + ',' + c.g + ',' + c.b + ')');
            this._glowOverlay.opacity(0.25 + 0.75 * t);
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
        { label: '额定电压 (V)', key: 'ratedVoltage', type: 'number' },
        { label: '电阻 (Ω)', key: 'resistance', type: 'number' },
    ]; }

    onConfigUpdate(cfg) {
        if (cfg.lampColor !== undefined) this._color = cfg.lampColor;
        if (cfg.ratedVoltage !== undefined) this.vRated = parseFloat(cfg.ratedVoltage);
        if (cfg.resistance !== undefined) this.currentResistance = parseFloat(cfg.resistance);
        this.config = { ...this.config, ...cfg };
        this._refreshCache();
    }

    getValue() { return this.currentResistance; }
    destroy() { super.destroy?.(); }
}
