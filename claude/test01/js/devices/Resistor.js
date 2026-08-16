/**
 * Resistor.js — 电阻器
 * Terminals: a (左), b (右)
 */
import { BaseDevice } from './BaseDevice.js';

export class Resistor extends BaseDevice {
  constructor(opts = {}) {
    super(opts);
    this.deviceType  = 'Resistor';
    this.deviceLabel = '电阻';
    this.color       = '#4cc9f0';

    this.addProp('resistance', '阻值 (Ω)', opts.resistance ?? 1000, 'Ω', true, 0.001, 1e9);
    this.addProp('power',      '功率 (W)', 0,                        'W', false);
    this.addProp('current',    '电流 (A)', 0,                        'A', false);
    this.addProp('voltage',    '两端电压', 0,                        'V', false);

    this._W = 100; this._H = 40;
    this.addTerminal('a', -10, this._H/2, 'a');
    this.addTerminal('b', this._W+10, this._H/2, 'b');
  }

  draw() {
    const W = this._W, H = this._H;
    const g = this.group;

    // Wire leads
    const wireL = new Konva.Line({ points:[-10, H/2, 14, H/2], stroke:this.color, strokeWidth:1.5 });
    const wireR = new Konva.Line({ points:[W-14, H/2, W+10, H/2], stroke:this.color, strokeWidth:1.5 });

    // Body rect (IEC standard)
    const body = new Konva.Rect({
      x:14, y:8, width:W-28, height:H-16,
      fill:'#030a10', stroke:this.color, strokeWidth:1.5, cornerRadius:3,
      name:'device-body', shadowColor:this.color, shadowBlur:0,
    });

    // Zigzag pattern inside
    const bx = 14, bw = W-28;
    const segs = 5, segW = bw/segs;
    const mid = H/2;
    const zigPts = [bx, mid];
    for (let i=0; i<segs; i++) {
      zigPts.push(bx + (i+0.3)*segW, mid - 7);
      zigPts.push(bx + (i+0.7)*segW, mid + 7);
    }
    zigPts.push(bx+bw, mid);
    const zig = new Konva.Line({ points:zigPts, stroke:this.color, strokeWidth:1.2, opacity:0.5, lineCap:'round', lineJoin:'round' });

    // Value label
    const label = new Konva.Text({
      x:0, y:-16, width:W, text: this._formatR(this.getProp('resistance')),
      fontSize:10, fontFamily:'Share Tech Mono,monospace', fill:this.color, align:'center', id:'r-label',
    });

    // Power/current display (bottom)
    this._powerText = new Konva.Text({
      x:0, y:H+2, width:W, text:'',
      fontSize:9, fontFamily:'Share Tech Mono,monospace', fill:'rgba(76,201,240,0.5)', align:'center', id:'r-power',
    });

    g.add(wireL, wireR, body, zig, label, this._powerText);
    this.drawTerminals({ radius: 4 });

    body.on('click tap', () => this.simulation?.onDeviceClick(this));
    body.on('mouseenter', () => { body.shadowBlur(10); this.layer.batchDraw(); });
    body.on('mouseleave', () => { body.shadowBlur(0); this.layer.batchDraw(); });
  }

  _formatR(r) {
    if (r >= 1e6)  return (r/1e6).toFixed(2) + ' MΩ';
    if (r >= 1e3)  return (r/1e3).toFixed(1)  + ' kΩ';
    return r.toFixed(0) + ' Ω';
  }

  onPropChange(key) {
    if (key === 'resistance') {
      const lbl = this.group.findOne('#r-label');
      if (lbl) { lbl.text(this._formatR(this.getProp('resistance'))); this.layer.batchDraw(); }
    }
  }

  simulate(dt, circuit) {
    const R   = this.getProp('resistance');
    const Va  = circuit.getNodeVoltage(this.id, 'a') ?? 0;
    const Vb  = circuit.getNodeVoltage(this.id, 'b') ?? 0;
    const Vab = Va - Vb;
    const I   = Vab / R;
    const P   = Vab * I;

    this.setProp('voltage',  +Vab.toFixed(5));
    this.setProp('current',  +I.toFixed(6));
    this.setProp('power',    +P.toFixed(6));

    circuit.setConductance(this.id, 1/R, 'a', 'b');

    const pt = this.group.findOne('#r-power');
    if (pt && Math.abs(I) > 1e-9) {
      pt.text(`I=${this._fmtSI(Math.abs(I),'A')}  P=${this._fmtSI(Math.abs(P),'W')}`);
      this.layer.batchDraw();
    }
  }

  _fmtSI(v, u) {
    if (v >= 1)    return v.toFixed(2)+u;
    if (v >= 1e-3) return (v*1e3).toFixed(1)+'m'+u;
    if (v >= 1e-6) return (v*1e6).toFixed(1)+'µ'+u;
    return (v*1e9).toFixed(0)+'n'+u;
  }
}
