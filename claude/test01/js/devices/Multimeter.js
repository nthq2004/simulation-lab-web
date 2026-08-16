/**
 * Multimeter.js — 数字万用表
 * Terminals: pos (+), neg (COM)
 * 可测量电压、电流、电阻
 */
import { BaseDevice } from './BaseDevice.js';

export class Multimeter extends BaseDevice {
  constructor(opts = {}) {
    super(opts);
    this.deviceType  = 'Multimeter';
    this.deviceLabel = '数字万用表';
    this.color       = '#0c7a55';

    this.addProp('mode',     '测量模式', opts.mode ?? 'voltage', '',  true);
    this.addProp('reading',  '读数',     0,                       '',  false);
    this.addProp('unit',     '单位',     'V',                     '',  false);

    this._displayVal = '0.000';
    this._displayUnit = 'V';
    this._mode = opts.mode ?? 'voltage'; // 'voltage' | 'current' | 'resistance'
    this._W = 110; this._H = 130;
    this.addTerminal('pos', this._W/2 - 18, this._H + 10, '+');
    this.addTerminal('neg', this._W/2 + 18, this._H + 10, 'COM');
  }

  draw() {
    const W = this._W, H = this._H;
    const g = this.group;

    // Meter body
    const body = new Konva.Rect({
      x:0, y:0, width:W, height:H,
      fill:'#0d1a12', stroke:this.color, strokeWidth:1.5, cornerRadius:10,
      name:'device-body', shadowColor:this.color, shadowBlur:0,
    });

    // Display area
    const disp = new Konva.Rect({
      x:8, y:10, width:W-16, height:48,
      fill:'#050d08', stroke:this.color, strokeWidth:1, cornerRadius:5,
      opacity:0.9,
    });

    // Display text — value
    this._dispText = new Konva.Text({
      x:10, y:18, width:W-20,
      text: this._displayVal,
      fontSize: 22, fontFamily:'Share Tech Mono,monospace',
      fill: this.color,
      align:'right', id:'mm-val',
      shadowColor: this.color, shadowBlur: 6,
    });

    // Unit text
    this._unitText = new Konva.Text({
      x:10, y:42, width:W-14,
      text: this._displayUnit,
      fontSize:10, fontFamily:'Share Tech Mono,monospace',
      fill: this.color, opacity:0.7, align:'right', id:'mm-unit',
    });

    // Mode indicator
    this._modeText = new Konva.Text({
      x:10, y:44, width:W-14,
      text: this._modeStr(),
      fontSize:9, fontFamily:'Share Tech Mono,monospace',
      fill:'rgba(12,122,85,0.5)', align:'left', id:'mm-mode',
    });

    // Mode selector buttons (DC V / AC V / A / Ω)
    const btnY = 66;
    this._modeButtons = [];
    const modes = [{l:'V=',m:'voltage'},{l:'V~',m:'acv'},{l:'A',m:'current'},{l:'Ω',m:'resistance'}];
    modes.forEach((b, i) => {
      const bx = 8 + i * ((W-16)/4);
      const bw = (W-16)/4 - 2;
      const rect = new Konva.Rect({
        x:bx, y:btnY, width:bw, height:18,
        fill: this._mode === b.m ? 'rgba(12,122,85,0.2)' : 'transparent',
        stroke: this._mode === b.m ? this.color : 'rgba(12,122,85,0.2)',
        strokeWidth: 1, cornerRadius: 3, id:`mm-btn-${b.m}`,
      });
      const txt = new Konva.Text({
        x:bx, y:btnY+3, width:bw, text:b.l,
        fontSize:9, fontFamily:'Share Tech Mono', fill:this.color, align:'center',
      });
      rect.on('click tap', () => this._setMode(b.m));
      rect.on('mouseenter', () => { rect.fill('rgba(12,122,85,0.1)'); this.layer.batchDraw(); });
      rect.on('mouseleave', () => { rect.fill(this._mode===b.m?'rgba(12,122,85,0.2)':'transparent'); this.layer.batchDraw(); });
      g.add(rect, txt);
      this._modeButtons.push({rect, mode:b.m});
    });

    // Probe wires
    const wireL = new Konva.Line({ points:[W/2-18, H, W/2-18, H+10], stroke:'#e63946', strokeWidth:2 });
    const wireR = new Konva.Line({ points:[W/2+18, H, W/2+18, H+10], stroke:'#888',    strokeWidth:2 });

    // Port labels
    const posLbl = new Konva.Text({ x:W/2-34, y:H+12, text:'+', fontSize:10, fontFamily:'Share Tech Mono', fill:'#e63946' });
    const negLbl = new Konva.Text({ x:W/2+12, y:H+12, text:'COM', fontSize:9, fontFamily:'Share Tech Mono', fill:'#888' });

    // Brand label
    const brand = new Konva.Text({
      x:0, y:H-22, width:W, text:'DM-9800',
      fontSize:9, fontFamily:'Share Tech Mono', fill:'rgba(12,122,85,0.3)', align:'center',
    });

    // Bargraph background
    const bgBar = new Konva.Rect({ x:8, y:90, width:W-16, height:5, fill:'#050d08', cornerRadius:2 });
    this._barFill = new Konva.Rect({ x:8, y:90, width:0, height:5, fill:this.color, cornerRadius:2, id:'mm-bar' });

    g.add(body, disp, this._dispText, this._unitText, this._modeText,
          bgBar, this._barFill, wireL, wireR, posLbl, negLbl, brand);

    this.drawTerminals({ radius: 5 });

    body.on('click tap', () => this.simulation?.onDeviceClick(this));
    body.on('mouseenter', () => { body.shadowBlur(12); this.layer.batchDraw(); });
    body.on('mouseleave', () => { body.shadowBlur(0);  this.layer.batchDraw(); });
  }

  _modeStr() {
    return { voltage:'DC VOLT', acv:'AC VOLT', current:'DC AMP', resistance:'OHM' }[this._mode] || 'DC VOLT';
  }

  _setMode(m) {
    this._mode = m;
    this.setProp('mode', m);
    const modeMap = { voltage:'V', acv:'V', current:'A', resistance:'Ω' };
    this._displayUnit = modeMap[m];
    if (this._modeText) { this._modeText.text(this._modeStr()); }
    // Update button highlights
    this._modeButtons?.forEach(b => {
      const active = b.mode === m;
      b.rect.fill(active ? 'rgba(12,122,85,0.2)' : 'transparent');
      b.rect.stroke(active ? this.color : 'rgba(12,122,85,0.2)');
    });
    this.layer.batchDraw();
  }

  _updateDisplay(value, unit) {
    this._displayVal = value;
    this._displayUnit = unit || this._displayUnit;
    if (this._dispText) { this._dispText.text(value); }
    if (this._unitText) { this._unitText.text(this._displayUnit); }
    this.layer.batchDraw();
  }

  simulate(dt, circuit) {
    const Va = circuit.getNodeVoltage(this.id, 'pos') ?? 0;
    const Vb = circuit.getNodeVoltage(this.id, 'neg') ?? 0;
    const Vdiff = Va - Vb;

    let reading = 0;
    let unit = 'V';
    let displayStr = '';

    switch (this._mode) {
      case 'voltage':
      case 'acv': {
        reading = Vdiff;
        unit = 'V';
        displayStr = this._fmtDisplay(Math.abs(reading), 'V');
        // Multimeter has very high input impedance (ideal voltmeter: huge R)
        circuit.setConductance(this.id, 1e-9, 'pos', 'neg'); // 1GΩ input impedance
        break;
      }
      case 'current': {
        // Ammeter: very low resistance (ideal: short)
        const Rshunt = 0.001; // 1mΩ shunt
        circuit.setConductance(this.id, 1/Rshunt, 'pos', 'neg');
        reading = Vdiff / Rshunt;
        unit = 'A';
        displayStr = this._fmtDisplay(Math.abs(reading), 'A');
        break;
      }
      case 'resistance': {
        // Ohmmeter: inject small test voltage / measure ratio
        circuit.setConductance(this.id, 1e-9, 'pos', 'neg');
        reading = Math.abs(Vdiff) > 1e-6 ? 1 / (1e-9) : Infinity;
        unit = 'Ω';
        displayStr = isFinite(reading) ? this._fmtDisplay(reading, 'Ω') : 'OL';
        break;
      }
    }

    this.setProp('reading', reading);
    this.setProp('unit', unit);
    this._updateDisplay(displayStr, unit);

    // Bargraph (0-100%)
    if (this._barFill) {
      const maxV = { voltage:1000, acv:1000, current:10, resistance:1e6 }[this._mode];
      const pct  = Math.min(1, Math.abs(reading) / maxV);
      const barW = (this._W - 16) * pct;
      this._barFill.width(barW);
      this._barFill.fill(pct > 0.9 ? '#e63946' : this.color);
      this.layer.batchDraw();
    }
  }

  _fmtDisplay(v, u) {
    if (!isFinite(v)) return 'OL';
    if (u === 'V') {
      if (v >= 100)  return v.toFixed(1);
      if (v >= 10)   return v.toFixed(2);
      return v.toFixed(3);
    }
    if (u === 'A') {
      if (v >= 1)    return v.toFixed(3);
      if (v >= 1e-3) return (v*1e3).toFixed(2)+'m';
      return (v*1e6).toFixed(0)+'µ';
    }
    if (u === 'Ω') {
      if (v >= 1e6)  return (v/1e6).toFixed(2)+'M';
      if (v >= 1e3)  return (v/1e3).toFixed(1)+'k';
      return v.toFixed(0);
    }
    return v.toFixed(3);
  }
}
