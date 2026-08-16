/**
 * Capacitor.js — 电容器
 * Terminals: pos (+), neg (−)
 */
import { BaseDevice } from './BaseDevice.js';

export class Capacitor extends BaseDevice {
  constructor(opts = {}) {
    super(opts);
    this.deviceType  = 'Capacitor';
    this.deviceLabel = '电容';
    this.color       = '#4cc9f0';

    this.addProp('capacitance', '电容量 (F)', opts.capacitance ?? 100e-6, 'F', true, 1e-12, 1);
    this.addProp('voltage',     '两端电压',   0,   'V', false);
    this.addProp('current',     '充电电流',   0,   'A', false);

    this._Vc    = 0; // capacitor voltage
    this._W = 100; this._H = 40;
    this.addTerminal('pos', -10, this._H/2, '+');
    this.addTerminal('neg', this._W+10, this._H/2, '−');
  }

  draw() {
    const W = this._W, H = this._H;
    const g = this.group;
    const mid = H/2, cx = W/2;

    const wireL = new Konva.Line({ points:[-10,mid,cx-10,mid], stroke:this.color, strokeWidth:1.5 });
    const wireR = new Konva.Line({ points:[cx+10,mid,W+10,mid], stroke:this.color, strokeWidth:1.5 });

    // Two plates
    const plate1 = new Konva.Line({ points:[cx-10,8, cx-10,H-8], stroke:this.color, strokeWidth:3, lineCap:'round' });
    const plate2 = new Konva.Line({ points:[cx+10,8, cx+10,H-8], stroke:this.color, strokeWidth:3, lineCap:'round', name:'device-body' });

    // + sign on left
    const plus = new Konva.Text({ x:cx-22, y:mid-6, text:'+', fontSize:11, fontFamily:'Share Tech Mono', fill:this.color });

    const label = new Konva.Text({
      x:0, y:-16, width:W, text:this._formatC(this.getProp('capacitance')),
      fontSize:10, fontFamily:'Share Tech Mono,monospace', fill:this.color, align:'center', id:'c-label',
    });

    this._voltText = new Konva.Text({
      x:0, y:H+2, width:W, text:'',
      fontSize:9, fontFamily:'Share Tech Mono,monospace', fill:'rgba(76,201,240,0.5)', align:'center',
    });

    g.add(wireL, wireR, plate1, plate2, plus, label, this._voltText);
    this.drawTerminals({ radius:4 });

    plate2.on('click tap', () => this.simulation?.onDeviceClick(this));
    plate2.on('mouseenter', () => { plate1.shadowBlur(8); plate2.shadowBlur(8); this.layer.batchDraw(); });
    plate2.on('mouseleave', () => { plate1.shadowBlur(0); plate2.shadowBlur(0); this.layer.batchDraw(); });
  }

  _formatC(c) {
    if (c >= 1)     return c.toFixed(1)+'F';
    if (c >= 1e-3)  return (c*1e3).toFixed(0)+'mF';
    if (c >= 1e-6)  return (c*1e6).toFixed(0)+'µF';
    if (c >= 1e-9)  return (c*1e9).toFixed(0)+'nF';
    return (c*1e12).toFixed(0)+'pF';
  }

  onPropChange() {
    const lbl = this.group.findOne('#c-label');
    if (lbl) { lbl.text(this._formatC(this.getProp('capacitance'))); this.layer.batchDraw(); }
  }

  simulate(dt, circuit) {
    const C  = this.getProp('capacitance');
    const Va = circuit.getNodeVoltage(this.id, 'pos') ?? 0;
    const Vb = circuit.getNodeVoltage(this.id, 'neg') ?? 0;
    const Vn = Va - Vb;

    // I = C * dV/dt  (backward Euler companion model)
    const I = C * (Vn - this._Vc) / dt;
    this._Vc = Vn;

    this.setProp('voltage', +Vn.toFixed(5));
    this.setProp('current', +I.toFixed(6));

    // Companion model: current source in parallel with conductance
    const G = C / dt;
    circuit.setConductance(this.id, G, 'pos', 'neg');
    circuit.setCurrentSource(this.id, -G * this._Vc, 'pos', 'neg');

    if (this._voltText) {
      this._voltText.text(Math.abs(Vn) > 1e-6 ? `Vc=${Vn.toFixed(3)}V` : '');
      this.layer.batchDraw();
    }
  }
}
