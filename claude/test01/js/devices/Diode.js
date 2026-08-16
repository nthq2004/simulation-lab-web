/**
 * Diode.js — 硅二极管 (Si PN Junction)
 * Terminals: anode (A), cathode (K)
 * 使用 Shockley 方程仿真: I = Is*(exp(V/(n*Vt))-1)
 */
import { BaseDevice } from './BaseDevice.js';

const VT = 0.02585; // 热电压 25°C

export class Diode extends BaseDevice {
  constructor(opts = {}) {
    super(opts);
    this.deviceType  = 'Diode';
    this.deviceLabel = '二极管';
    this.color       = '#0c7a55';

    this.addProp('Is',      '饱和电流 Is', opts.Is    ?? 1e-12,  'A', true, 1e-18, 1e-3);
    this.addProp('n',       '理想因子 n',  opts.n     ?? 1.7,    '',  true, 1, 2);
    this.addProp('Vf',      '正向导通压降', 0,                   'V', false);
    this.addProp('current', '正向电流',     0,                   'A', false);
    this.addProp('state',   '状态',        '截止',               '',  false);

    this._W = 80; this._H = 40;
    this.addTerminal('anode',   -10, this._H/2, 'A');
    this.addTerminal('cathode', this._W+10, this._H/2, 'K');
  }

  draw() {
    const W = this._W, H = this._H;
    const g = this.group;
    const mid = H/2, cx = W/2;

    const wireL = new Konva.Line({ points:[-10,mid,cx-16,mid], stroke:this.color, strokeWidth:1.5 });
    const wireR = new Konva.Line({ points:[cx+16,mid,W+10,mid], stroke:this.color, strokeWidth:1.5 });

    // Triangle (anode pointing right)
    const tri = new Konva.Line({
      points:[cx-16,mid-14, cx-16,mid+14, cx+16,mid],
      closed:true, fill:'rgba(12,122,85,0.12)', stroke:this.color, strokeWidth:1.8,
      name:'device-body', shadowColor:this.color, shadowBlur:0,
    });

    // Cathode bar
    const bar = new Konva.Line({ points:[cx+16,mid-14, cx+16,mid+14], stroke:this.color, strokeWidth:2.5, lineCap:'round' });

    // A / K labels
    const la = new Konva.Text({ x:-10, y:mid-18, text:'A', fontSize:9, fontFamily:'Share Tech Mono', fill:this.color });
    const lk = new Konva.Text({ x:W+2, y:mid-18, text:'K', fontSize:9, fontFamily:'Share Tech Mono', fill:this.color });

    const label = new Konva.Text({
      x:0, y:-16, width:W, text:'Si Diode',
      fontSize:10, fontFamily:'Share Tech Mono,monospace', fill:this.color, align:'center',
    });

    this._stateText = new Konva.Text({
      x:0, y:H+2, width:W, text:'截止',
      fontSize:9, fontFamily:'Share Tech Mono,monospace', fill:'rgba(12,122,85,0.5)', align:'center',
    });

    g.add(wireL, wireR, tri, bar, la, lk, label, this._stateText);
    this.drawTerminals({ radius:4 });

    tri.on('click tap', () => this.simulation?.onDeviceClick(this));
    tri.on('mouseenter', () => { tri.shadowBlur(12); this.layer.batchDraw(); });
    tri.on('mouseleave', () => { tri.shadowBlur(0); this.layer.batchDraw(); });
  }

  simulate(dt, circuit) {
    const Is = this.getProp('Is');
    const n  = this.getProp('n');
    const Va = circuit.getNodeVoltage(this.id, 'anode')   ?? 0;
    const Vk = circuit.getNodeVoltage(this.id, 'cathode') ?? 0;
    const Vd = Va - Vk;

    // Clamp to avoid overflow
    const Vdmax = n * VT * Math.log(1e6 / Is + 1);
    const Vcl   = Math.min(Vd, Vdmax);

    // Shockley: I = Is*(exp(V/nVt)-1)
    const expV = Math.exp(Vcl / (n * VT));
    const Id   = Is * (expV - 1);

    // Linearized conductance (NR step)
    const Gd   = (Is / (n * VT)) * expV;
    const Ieq  = Id - Gd * Vcl;

    circuit.setConductance(this.id, Gd, 'anode', 'cathode');
    circuit.setCurrentSource(this.id, -Ieq, 'anode', 'cathode');

    const conducting = Id > 1e-6;
    this.setProp('Vf',      +Vd.toFixed(4));
    this.setProp('current', +Id.toFixed(6));
    this.setProp('state',   conducting ? '导通' : '截止');

    if (this._stateText) {
      this._stateText.text(conducting ? `导通 ${Vd.toFixed(2)}V` : '截止');
      this._stateText.fill(conducting ? '#0c7a55' : 'rgba(12,122,85,0.4)');
      this.layer.batchDraw();
    }
  }
}
