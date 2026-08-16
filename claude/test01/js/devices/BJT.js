/**
 * BJT.js — NPN 双极型晶体管 (Ebers-Moll 模型简化版)
 * Terminals: base (B), collector (C), emitter (E)
 */
import { BaseDevice } from './BaseDevice.js';

const VT = 0.02585;

export class BJT extends BaseDevice {
  constructor(opts = {}) {
    super(opts);
    this.deviceType  = 'BJT';
    this.deviceLabel = 'NPN三极管';
    this.color       = '#0c7a55';

    this.addProp('beta',   '电流增益 β',    opts.beta    ?? 100,   '',  true,  1, 1000);
    this.addProp('Is',     '饱和电流 Is',   opts.Is      ?? 1e-14, 'A', true,  1e-18, 1e-6);
    this.addProp('Vce_sat','饱和压降 Vce_sat', opts.Vce_sat ?? 0.2, 'V', true,  0, 2);
    this.addProp('Ic',     '集电极电流 Ic', 0,                      'A', false);
    this.addProp('Ib',     '基极电流 Ib',   0,                      'A', false);
    this.addProp('Vbe',    'Vbe',           0,                      'V', false);
    this.addProp('state',  '工作区',        '截止',                 '',  false);

    this._W = 80; this._H = 80;
    // B: left-center, C: right-top, E: right-bottom
    this.addTerminal('base',      -10, this._H/2,      'B');
    this.addTerminal('collector',  this._W+10, 10,     'C');
    this.addTerminal('emitter',    this._W+10, this._H-10, 'E');
  }

  draw() {
    const W = this._W, H = this._H;
    const g = this.group;
    const cx = W * 0.45, cy = H / 2;

    // Vertical base line
    const baseLine = new Konva.Line({ points:[cx,12, cx,H-12], stroke:this.color, strokeWidth:2.5, lineCap:'round' });

    // Base wire lead
    const wireB = new Konva.Line({ points:[-10,cy, cx,cy], stroke:this.color, strokeWidth:1.5 });

    // Collector line (slant up)
    const wireC = new Konva.Line({ points:[cx,cy-14, W+10,10], stroke:this.color, strokeWidth:1.5 });
    // Emitter line (slant down, with arrow)
    const wireE = new Konva.Line({ points:[cx,cy+14, W+10,H-10], stroke:this.color, strokeWidth:1.5 });

    // Arrow on emitter (NPN: arrow out)
    const arrowPts = this._arrowPts(cx+20, cy+16, W+8, H-12);
    const arrow = new Konva.Line({ points:arrowPts, stroke:this.color, strokeWidth:1.5, closed:true, fill:this.color });

    // Body circle
    const body = new Konva.Circle({
      x:cx, y:cy, radius:28,
      fill:'rgba(12,122,85,0.04)', stroke:this.color, strokeWidth:1.5,
      name:'device-body', shadowColor:this.color, shadowBlur:0,
    });

    // Labels
    const lblB = new Konva.Text({ x:-12, y:cy-14, text:'B', fontSize:9, fontFamily:'Share Tech Mono', fill:this.color });
    const lblC = new Konva.Text({ x:W+12, y:2,    text:'C', fontSize:9, fontFamily:'Share Tech Mono', fill:this.color });
    const lblE = new Konva.Text({ x:W+12, y:H-14, text:'E', fontSize:9, fontFamily:'Share Tech Mono', fill:this.color });

    const label = new Konva.Text({
      x:0, y:-18, width:W, text:'NPN BJT',
      fontSize:10, fontFamily:'Share Tech Mono,monospace', fill:this.color, align:'center',
    });

    this._stateText = new Konva.Text({
      x:0, y:H+4, width:W, text:'截止',
      fontSize:9, fontFamily:'Share Tech Mono,monospace', fill:'rgba(12,122,85,0.5)', align:'center',
    });

    g.add(baseLine, wireB, wireC, wireE, arrow, body, lblB, lblC, lblE, label, this._stateText);
    this.drawTerminals({ radius:4 });

    body.on('click tap', () => this.simulation?.onDeviceClick(this));
    body.on('mouseenter', () => { body.shadowBlur(14); this.layer.batchDraw(); });
    body.on('mouseleave', () => { body.shadowBlur(0);  this.layer.batchDraw(); });
  }

  _arrowPts(x1,y1,x2,y2) {
    const len = Math.sqrt((x2-x1)**2+(y2-y1)**2);
    const dx=(x2-x1)/len, dy=(y2-y1)/len;
    const ax = x2-dx*8, ay = y2-dy*8;
    const px = -dy*4, py = dx*4;
    return [x2,y2, ax+px,ay+py, ax-px,ay-py];
  }

  simulate(dt, circuit) {
    const beta = this.getProp('beta');
    const Is   = this.getProp('Is');
    const n    = 1;

    const Vb = circuit.getNodeVoltage(this.id, 'base')      ?? 0;
    const Vc = circuit.getNodeVoltage(this.id, 'collector') ?? 0;
    const Ve = circuit.getNodeVoltage(this.id, 'emitter')   ?? 0;

    const Vbe = Vb - Ve;
    const Vbc = Vb - Vc;

    // Forward / reverse saturation currents
    const Ies = Is;
    const Ics = Is * beta;

    // Ebers-Moll (simplified)
    const If = Ies * (Math.exp(Math.min(Vbe/(n*VT), 20)) - 1);
    const Ir = Ics * (Math.exp(Math.min(Vbc/(n*VT), 20)) - 1);

    const Ic = If * (beta/(beta+1)) - Ir;
    const Ie = -(If - Ir/(beta+1));
    const Ib = -(Ic + Ie);

    // Conductances for MNA stamp (linearized)
    const GF = (Ies/(n*VT)) * Math.exp(Math.min(Vbe/(n*VT), 20));
    const GR = (Ics/(n*VT)) * Math.exp(Math.min(Vbc/(n*VT), 20));

    // BE junction
    circuit.setConductance(this.id+'_be', GF, 'base', 'emitter');
    circuit.setCurrentSource(this.id+'_be', -(If - GF*Vbe), 'base', 'emitter');

    // BC junction (reverse)
    circuit.setConductance(this.id+'_bc', GR, 'base', 'collector');
    circuit.setCurrentSource(this.id+'_bc', -(Ir - GR*Vbc), 'base', 'collector');

    // Update props
    this.setProp('Ic',  +Ic.toFixed(6));
    this.setProp('Ib',  +Ib.toFixed(6));
    this.setProp('Vbe', +Vbe.toFixed(4));

    let state = '截止';
    if (Vbe > 0.5 && Vbc > 0.4) state = '饱和';
    else if (Vbe > 0.5)          state = '放大';
    this.setProp('state', state);

    if (this._stateText) {
      const colors = { '截止':'rgba(12,122,85,0.3)', '放大':'#0c7a55', '饱和':'#ffd60a' };
      this._stateText.text(state + (Ic>1e-6?` Ic=${(Ic*1000).toFixed(2)}mA`:''));
      this._stateText.fill(colors[state] || '#00ff88');
      this.layer.batchDraw();
    }
  }
}
