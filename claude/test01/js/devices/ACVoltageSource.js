/**
 * ACVoltageSource.js — 交流电压源
 * Terminals: pos, neg
 */
import { BaseDevice } from './BaseDevice.js';

export class ACVoltageSource extends BaseDevice {
  constructor(opts = {}) {
    super(opts);
    this.deviceType  = 'ACVoltageSource';
    this.deviceLabel = '交流电压源';
    this.color       = '#ffd60a';

    this.addProp('amplitude', '峰值电压 (V)', opts.amplitude ?? 220, 'V', true, 0, 1000);
    this.addProp('frequency', '频率 (Hz)',    opts.frequency ?? 50,  'Hz', true, 0.1, 100000);
    this.addProp('phase',     '初相位 (°)',   opts.phase     ?? 0,   '°',  true, -360, 360);

    this._time = 0;
    this._currentV = 0;

    const W = 70, H = 90;
    this.addTerminal('pos', W/2, -10, '+');
    this.addTerminal('neg', W/2, H+10, '−');
    this._W = W; this._H = H;
  }

  draw() {
    const W = this._W, H = this._H;
    const g = this.group;

    const body = new Konva.Rect({
      x:0, y:0, width:W, height:H,
      fill:'#100e00', stroke:this.color, strokeWidth:1.5, cornerRadius:10,
      name:'device-body', shadowColor:this.color, shadowBlur:0,
    });

    // Sine wave symbol
    const cx = W/2, cy = H/2;
    const pts = [];
    for (let i=0; i<=40; i++) {
      pts.push(cx - 22 + i*1.1);
      pts.push(cy + Math.sin((i/40)*Math.PI*2)*10);
    }
    const wave = new Konva.Line({ points:pts, stroke:this.color, strokeWidth:2, tension:0.4, lineCap:'round' });

    const wireTop = new Konva.Line({ points:[cx,0,cx,-10],  stroke:this.color, strokeWidth:1.5 });
    const wireBot = new Konva.Line({ points:[cx,H,cx,H+10], stroke:this.color, strokeWidth:1.5 });

    const label = new Konva.Text({
      x:0, y:H+14, width:W,
      text:`AC ${this.getProp('amplitude')}V ${this.getProp('frequency')}Hz`,
      fontSize:9, fontFamily:'Share Tech Mono,monospace', fill:this.color, align:'center', id:'ac-label',
    });

    const idLbl = new Konva.Text({
      x:0, y:-20, width:W, text: this.id.slice(-4),
      fontSize:9, fontFamily:'Share Tech Mono,monospace', fill:'rgba(255,214,10,0.4)', align:'center',
    });

    g.add(body, wave, wireTop, wireBot, label, idLbl);

    this.drawTerminals();

    body.on('click tap', () => this.simulation?.onDeviceClick(this));
    body.on('mouseenter', () => { body.shadowBlur(12); this.layer.batchDraw(); });
    body.on('mouseleave', () => { body.shadowBlur(0);  this.layer.batchDraw(); });
  }

  onPropChange() {
    const lbl = this.group.findOne('#ac-label');
    if (lbl) {
      lbl.text(`AC ${this.getProp('amplitude')}V ${this.getProp('frequency')}Hz`);
      this.layer.batchDraw();
    }
  }

  simulate(dt, circuit) {
    this._time += dt;
    const A = this.getProp('amplitude');
    const f = this.getProp('frequency');
    const ph = (this.getProp('phase') * Math.PI) / 180;
    this._currentV = A * Math.sin(2 * Math.PI * f * this._time + ph);
    circuit.setVoltageSource(this.id, this._currentV, 'pos', 'neg');
  }

  getCurrentVoltage() { return this._currentV; }
}
