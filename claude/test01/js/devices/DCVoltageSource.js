/**
 * DCVoltageSource.js — 直流电压源
 * Terminals: pos (+), neg (-)
 */
import { BaseDevice } from './BaseDevice.js';

export class DCVoltageSource extends BaseDevice {
  constructor(opts = {}) {
    super(opts);
    this.deviceType  = 'DCVoltageSource';
    this.deviceLabel = '直流电压源';
    this.color       = '#ffd60a';

    this.addProp('voltage', '电压 (V)', opts.voltage ?? 12, 'V', true, 0, 1000);

    // W=70, H=90
    this.addTerminal('pos', 35, -10, '+');
    this.addTerminal('neg', 35, 90+10, '−');
  }

  draw() {
    const W = 70, H = 90;
    const g = this.group;

    // Shadow glow
    const glow = new Konva.Ellipse({
      x: W/2, y: H/2, radiusX: 36, radiusY: 50,
      fill: 'rgba(255,214,10,0.05)',
      listening: false,
    });

    // Body
    const body = new Konva.Rect({
      x: 0, y: 0, width: W, height: H,
      fill: '#100e00',
      stroke: this.color,
      strokeWidth: 1.5,
      cornerRadius: 10,
      name: 'device-body',
      shadowColor: this.color,
      shadowBlur: 0,
    });

    // Symbol lines (battery) — in center
    const cy = H / 2;
    // Long line (positive plate)
    const plate1 = new Konva.Line({ points:[14, cy-8, W-14, cy-8], stroke: this.color, strokeWidth:2, lineCap:'round' });
    // Short line (negative plate)
    const plate2 = new Konva.Line({ points:[20, cy+4, W-20, cy+4], stroke: this.color, strokeWidth: 2.5, lineCap:'round' });
    // + and − text
    const plus  = new Konva.Text({ x:W/2-4, y:cy-24, text:'+', fontSize:11, fontFamily:'Share Tech Mono,monospace', fill:this.color });
    const minus = new Konva.Text({ x:W/2-4, y:cy+8,  text:'−', fontSize:11, fontFamily:'Share Tech Mono,monospace', fill:this.color });

    // Wire stubs to terminals
    const wireTop = new Konva.Line({ points:[W/2, 0, W/2, -10], stroke: this.color, strokeWidth:1.5 });
    const wireBot = new Konva.Line({ points:[W/2, H, W/2, H+10], stroke: this.color, strokeWidth:1.5 });

    // Label
    const label = new Konva.Text({
      x: 0, y: H+14, width: W, text: `DC ${this.getProp('voltage')}V`,
      fontSize: 10, fontFamily:'Share Tech Mono,monospace', fill: this.color,
      align:'center', id:'dc-label',
    });

    // ID label
    const idLbl = new Konva.Text({
      x:0, y:-20, width:W, text: this.id.slice(-4),
      fontSize:9, fontFamily:'Share Tech Mono,monospace', fill:'rgba(255,214,10,0.4)',
      align:'center',
    });

    g.add(glow, body, plate1, plate2, plus, minus, wireTop, wireBot, label, idLbl);

    // Move terminal to center-x
    this.terminals.find(t=>t.id==='pos').localX = W/2;
    this.terminals.find(t=>t.id==='neg').localX = W/2;

    this.drawTerminals();

    // Click to select
    body.on('click tap', () => this.simulation?.onDeviceClick(this));
    body.on('mouseenter', () => { body.shadowBlur(12); this.layer.batchDraw(); });
    body.on('mouseleave', () => { body.shadowBlur(0); this.layer.batchDraw(); });
  }

  onPropChange(key) {
    if (key === 'voltage') {
      const lbl = this.group.findOne('#dc-label');
      if (lbl) { lbl.text(`DC ${this.getProp('voltage')}V`); this.layer.batchDraw(); }
    }
  }

  simulate(dt, circuit) {
    const v = this.getProp('voltage');
    // Ideal voltage source: set potential difference
    circuit.setVoltageSource(this.id, v, 'pos', 'neg');
  }
}
