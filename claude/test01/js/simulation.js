/**
 * simulation.js — 仿真引擎
 * 使用修正节点分析法 (MNA - Modified Nodal Analysis) 求解电路
 * 
 * 责任:
 *  1. 维护器件实例列表
 *  2. 管理连线 (Wire)
 *  3. 构建 MNA 矩阵并求解节点电压
 *  4. 将结果分发给各器件进行 simulate()
 */

import { DCVoltageSource } from './devices/DCVoltageSource.js';
import { ACVoltageSource } from './devices/ACVoltageSource.js';
import { Resistor }        from './devices/Resistor.js';
import { Capacitor }       from './devices/Capacitor.js';
import { Diode }           from './devices/Diode.js';
import { BJT }             from './devices/BJT.js';
import { Multimeter }      from './devices/Multimeter.js';

// ── 简单矩阵运算 (不引入外部依赖) ──────────────────────────

function matMul(A, b) {
  // Solve Ax = b via Gaussian elimination with partial pivoting
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);

  for (let col = 0; col < n; col++) {
    // Find pivot
    let maxRow = col;
    for (let row = col+1; row < n; row++) {
      if (Math.abs(M[row][col]) > Math.abs(M[maxRow][col])) maxRow = row;
    }
    [M[col], M[maxRow]] = [M[maxRow], M[col]];

    if (Math.abs(M[col][col]) < 1e-14) continue;

    for (let row = col+1; row < n; row++) {
      const f = M[row][col] / M[col][col];
      for (let k = col; k <= n; k++) M[row][k] -= f * M[col][k];
    }
  }

  // Back-substitution
  const x = new Array(n).fill(0);
  for (let i = n-1; i >= 0; i--) {
    if (Math.abs(M[i][i]) < 1e-14) { x[i] = 0; continue; }
    x[i] = M[i][n];
    for (let j = i+1; j < n; j++) x[i] -= M[i][j] * x[j];
    x[i] /= M[i][i];
  }
  return x;
}

// ── Wire class ──────────────────────────────────────────────

export class Wire {
  constructor(id, fromDevId, fromTermId, toDevId, toTermId) {
    this.id         = id;
    this.fromDevId  = fromDevId;
    this.fromTermId = fromTermId;
    this.toDevId    = toDevId;
    this.toTermId   = toTermId;
    this.konvaLine  = null; // set by Renderer
    this.netId      = null; // assigned by MNA builder
  }
}

// ── Circuit context (passed to each device.simulate()) ──────

class Circuit {
  constructor() {
    // Map: `${devId}__${termId}` → netId
    this.termNetMap = {};
    // netId → voltage
    this.netVoltages = {};
    // MNA stamps collected before solve
    this.conductances   = []; // { id, G, netA, netB }
    this.currentSources = []; // { id, I, netA(+), netB(-) }
    this.voltageSources = []; // { id, V, netA(+), netB(-) }
  }

  getNodeVoltage(devId, termId) {
    const netId = this.termNetMap[`${devId}__${termId}`];
    if (netId === undefined) return null;
    return this.netVoltages[netId] ?? 0;
  }

  setConductance(id, G, termA, termB) {
    // Called by devices — resolved later by devId context
    this._pending?.push({ type:'G', id, G, termA, termB });
  }

  setCurrentSource(id, I, termA, termB) {
    this._pending?.push({ type:'I', id, I, termA, termB });
  }

  setVoltageSource(id, V, termA, termB) {
    this._pending?.push({ type:'V', id, V, termA, termB });
  }
}

// ── Main Simulation class ───────────────────────────────────

export class Simulation {
  constructor({ layer, onLog, onStatusChange, onDeviceSelected }) {
    this.layer           = layer;
    this.onLog           = onLog           || (() => {});
    this.onStatusChange  = onStatusChange  || (() => {});
    this.onDeviceSelected = onDeviceSelected || (() => {});

    this.devices  = new Map(); // id → BaseDevice instance
    this.wires    = new Map(); // id → Wire
    this.running  = false;
    this._rafId   = null;
    this._lastTime = null;
    this._dt       = 1 / 1000; // default 1ms tick
    this._time     = 0;

    // Interaction state
    this._wireMode     = true;  // true = wire mode, false = move mode
    this._pendingWire  = null;  // { fromDevId, fromTermId }
    this._selectedDev  = null;

    // Renderer helper
    this._wireLayer = null; // separate Konva layer for wires
  }

  // ── Device registry ───────────────────────────────────────

  /** Create and add a device by type name */
  addDevice(typeName, x, y) {
    const DeviceClass = {
      DCVoltageSource, ACVoltageSource,
      Resistor, Capacitor, Diode, BJT, Multimeter,
    }[typeName];

    if (!DeviceClass) { this.log(`未知器件类型: ${typeName}`, 'error'); return null; }

    const dev = new DeviceClass({ layer: this.layer, x, y, simulation: this });
    this.devices.set(dev.id, dev);

    dev.draw();
    dev.group.x(x);
    dev.group.y(y);
    this.layer.add(dev.group);
    this.layer.batchDraw();

    this._bindDeviceInteraction(dev);
    this.log(`添加 ${dev.deviceLabel} [${dev.id.slice(-4)}]`, 'ok');
    return dev;
  }

  removeDevice(devId) {
    const dev = this.devices.get(devId);
    if (!dev) return;
    // Remove connected wires
    for (const [wid, w] of this.wires) {
      if (w.fromDevId === devId || w.toDevId === devId) {
        w.konvaLine?.destroy();
        this.wires.delete(wid);
      }
    }
    dev.destroy();
    this.devices.delete(devId);
    if (this._selectedDev?.id === devId) {
      this._selectedDev = null;
      this.onDeviceSelected(null);
    }
    this.layer.batchDraw();
    this.log(`删除 ${dev.deviceLabel}`, 'warn');
  }

  // ── Wire management ───────────────────────────────────────

  setWireLayer(konvaLayer) {
    this._wireLayer = konvaLayer;
  }

  addWire(fromDevId, fromTermId, toDevId, toTermId) {
    // Prevent duplicate
    for (const w of this.wires.values()) {
      if (w.fromDevId===fromDevId && w.fromTermId===fromTermId &&
          w.toDevId===toDevId     && w.toTermId===toTermId) return null;
      if (w.fromDevId===toDevId   && w.fromTermId===toTermId &&
          w.toDevId===fromDevId   && w.toTermId===fromTermId) return null;
    }

    const id = `w_${Date.now()}`;
    const wire = new Wire(id, fromDevId, fromTermId, toDevId, toTermId);
    this.wires.set(id, wire);

    // Draw wire on wire layer
    const L = this._wireLayer || this.layer;
    const from = this.devices.get(fromDevId)?.terminalWorldPos(fromTermId);
    const to   = this.devices.get(toDevId)?.terminalWorldPos(toTermId);
    if (from && to) {
      wire.konvaLine = this._drawWireLine(L, from, to, id);
    }

    this.log(`连线: [${fromDevId.slice(-4)}].${fromTermId} → [${toDevId.slice(-4)}].${toTermId}`, 'data');
    L.batchDraw();
    return wire;
  }

  _drawWireLine(layer, from, to, wireId) {
    // Route with right-angle segments
    const mx = (from.x + to.x) / 2;
    const line = new Konva.Line({
      points: [from.x, from.y, mx, from.y, mx, to.y, to.x, to.y],
      stroke: '#00ff88',
      strokeWidth: 2,
      lineCap: 'round',
      lineJoin: 'round',
      shadowColor: '#00ff88',
      shadowBlur: 4,
      id: wireId,
    });

    // Dot at junctions
    const dot1 = new Konva.Circle({ x:from.x, y:from.y, radius:3, fill:'#00ff88' });
    const dot2 = new Konva.Circle({ x:to.x,   y:to.y,   radius:3, fill:'#00ff88' });

    // Click to select/delete wire
    line.on('click tap', (e) => {
      e.cancelBubble = true;
      line.stroke('#e63946');
      layer.batchDraw();
      // Delete on second click
      line.once('click tap', () => {
        this.removeWire(wireId, layer);
      });
      setTimeout(() => { if(line.getParent()) { line.stroke('#00ff88'); layer.batchDraw(); } }, 2000);
    });

    layer.add(line, dot1, dot2);
    return line;
  }

  removeWire(wireId, layer) {
    const wire = this.wires.get(wireId);
    if (!wire) return;
    wire.konvaLine?.destroy();
    this.wires.delete(wireId);
    layer?.batchDraw();
    this.log(`删除连线`, 'warn');
  }

  /** Update all wire positions (call after device moved) */
  updateWires(devId) {
    for (const wire of this.wires.values()) {
      if (wire.fromDevId !== devId && wire.toDevId !== devId) continue;
      const from = this.devices.get(wire.fromDevId)?.terminalWorldPos(wire.fromTermId);
      const to   = this.devices.get(wire.toDevId)?.terminalWorldPos(wire.toTermId);
      if (from && to && wire.konvaLine) {
        const mx = (from.x + to.x) / 2;
        wire.konvaLine.points([from.x, from.y, mx, from.y, mx, to.y, to.x, to.y]);
        (this._wireLayer || this.layer).batchDraw();
      }
    }
  }

  // ── MNA Solver ────────────────────────────────────────────

  _buildAndSolve(dt) {
    // Step 1: Build net list — assign net IDs via union-find
    // Each terminal gets a net. Connected terminals share a net.
    const termToNet = new Map();
    let netCounter  = 0;

    // Helper: get or create net for terminal
    const getNet = (devId, termId) => {
      const key = `${devId}__${termId}`;
      if (!termToNet.has(key)) termToNet.set(key, netCounter++);
      return termToNet.get(key);
    };

    // Initialize all terminals
    for (const dev of this.devices.values()) {
      for (const t of dev.terminals) getNet(dev.id, t.id);
    }

    // Merge nets connected by wires
    const parent = Array.from({length: netCounter}, (_, i) => i);
    const find = (x) => { while(parent[x]!==x){parent[x]=parent[parent[x]]; x=parent[x];} return x; };
    const union = (a, b) => { parent[find(a)] = find(b); };

    for (const wire of this.wires.values()) {
      const nA = getNet(wire.fromDevId, wire.fromTermId);
      const nB = getNet(wire.toDevId, wire.toTermId);
      union(nA, nB);
    }

    // Compact net IDs (root → index)
    const rootToIdx = new Map();
    let nodeCount = 0;
    for (const [key, netId] of termToNet) {
      const root = find(netId);
      if (!rootToIdx.has(root)) rootToIdx.set(root, nodeCount++);
      termToNet.set(key, rootToIdx.get(root));
    }

    // Ground: node 0 (first net found or first DCSource neg terminal)
    // We pick the negative of the first DC source as ground
    let groundNet = 0;
    for (const dev of this.devices.values()) {
      if (dev.deviceType === 'DCVoltageSource' || dev.deviceType === 'ACVoltageSource') {
        groundNet = termToNet.get(`${dev.id}__neg`) ?? 0;
        break;
      }
    }

    // Build circuit context
    const circuit = new Circuit();
    circuit._pending = [];

    // Fill termNetMap
    for (const [key, netIdx] of termToNet) {
      circuit.termNetMap[key] = netIdx;
    }

    // Step 2: Collect stamps from all devices
    for (const dev of this.devices.values()) {
      dev.simulate(dt, circuit);
    }

    // Step 3: Count voltage sources for MNA extra rows
    const vsources = circuit._pending.filter(s => s.type === 'V');
    const N = nodeCount;       // node count
    const M = vsources.length; // voltage source count
    const size = N + M;

    if (size === 0) return;

    // Step 4: Build MNA matrices G (conductance) and b (RHS)
    const G_mat = Array.from({length:size}, () => new Array(size).fill(0));
    const b_vec = new Array(size).fill(0);

    // Helper to get net index from devId + termId stamp
    const netOf = (stamp_id, termId) => {
      // stamp_id may be devId or devId+'_be' etc.
      // We need to find the device that owns this terminal
      // Convention: stamp_id is the device id for regular stamps
      // For BJT sub-stamps (id+'_be'), we map manually
      const raw = circuit.termNetMap[`${stamp_id}__${termId}`];
      if (raw !== undefined) return raw;

      // Try stripping suffix for BJT sub-stamps
      const baseDev = stamp_id.replace(/_be$|_bc$/, '');
      return circuit.termNetMap[`${baseDev}__${termId}`] ?? -1;
    };

    const stamp_G = (nA, nB, G) => {
      if (nA >= 0 && nA !== groundNet) { G_mat[nA][nA] += G; }
      if (nB >= 0 && nB !== groundNet) { G_mat[nB][nB] += G; }
      if (nA >= 0 && nB >= 0 && nA !== groundNet && nB !== groundNet) {
        G_mat[nA][nB] -= G;
        G_mat[nB][nA] -= G;
      }
    };

    const stamp_I = (nA, nB, I) => {
      // I flows from nB to nA (conventional: into nA)
      if (nA >= 0 && nA !== groundNet) b_vec[nA] += I;
      if (nB >= 0 && nB !== groundNet) b_vec[nB] -= I;
    };

    // Ground row/col
    if (groundNet >= 0) {
      G_mat[groundNet][groundNet] = 1;
      b_vec[groundNet] = 0;
    }

    // Stamp conductances
    for (const s of circuit._pending) {
      if (s.type !== 'G') continue;
      const nA = netOf(s.id, s.termA);
      const nB = netOf(s.id, s.termB);
      if (nA < 0 || nB < 0) continue;
      stamp_G(nA, nB, s.G);
    }

    // Stamp current sources
    for (const s of circuit._pending) {
      if (s.type !== 'I') continue;
      const nA = netOf(s.id, s.termA);
      const nB = netOf(s.id, s.termB);
      if (nA < 0 || nB < 0) continue;
      stamp_I(nA, nB, s.I);
    }

    // Stamp voltage sources (extra rows N..N+M-1)
    vsources.forEach((s, k) => {
      const nA = netOf(s.id, s.termA); // + terminal
      const nB = netOf(s.id, s.termB); // − terminal
      const row = N + k;
      b_vec[row] = s.V;

      if (nA >= 0 && nA !== groundNet) { G_mat[row][nA] += 1; G_mat[nA][row] += 1; }
      if (nB >= 0 && nB !== groundNet) { G_mat[row][nB] -= 1; G_mat[nB][row] -= 1; }
    });

    // Step 5: Solve
    let x;
    try {
      x = matMul(G_mat, b_vec);
    } catch(e) {
      this.log('求解器错误: ' + e.message, 'error');
      return;
    }

    // Step 6: Update node voltages
    circuit.netVoltages = {};
    for (let i = 0; i < N; i++) {
      circuit.netVoltages[i] = i === groundNet ? 0 : (x[i] ?? 0);
    }

    // Step 7: Re-run simulate with solved voltages (display update only)
    for (const dev of this.devices.values()) {
      // Update node voltage display on terminals
      for (const t of dev.terminals) {
        const key = `${dev.id}__${t.id}`;
        const v   = circuit.netVoltages[circuit.termNetMap[key] ?? -1] ?? 0;
        dev.nodeVoltages[t.id] = v;
        if (t.konvaEl) {
          const color = Math.abs(v) > 0.1 ? '#ffd60a' : '#00ff88';
          t.konvaEl.stroke(color);
        }
      }
    }

    // Final: store circuit so devices can read in prop panel
    this._lastCircuit = circuit;

    return circuit;
  }

  // ── Run loop ──────────────────────────────────────────────

  start() {
    if (this.running) return;
    if (this.devices.size === 0) { this.log('没有器件可仿真', 'warn'); return; }

    this.running  = true;
    this._lastTime = performance.now();
    this._time     = 0;

    this.onStatusChange('running');
    this.log('▶ 仿真开始', 'ok');

    const tick = (now) => {
      if (!this.running) return;
      const dt = Math.min((now - this._lastTime) / 1000, 0.05);
      this._lastTime = now;
      this._time    += dt;

      try {
        this._buildAndSolve(dt || 0.001);
      } catch(e) {
        this.log('仿真错误: '+e.message, 'error');
        this.stop();
        return;
      }

      this._rafId = requestAnimationFrame(tick);
    };

    this._rafId = requestAnimationFrame(tick);
  }

  stop() {
    this.running = false;
    if (this._rafId) cancelAnimationFrame(this._rafId);
    this.onStatusChange('idle');
    this.log('■ 仿真停止', 'warn');
  }

  reset() {
    this.stop();
    // Remove all devices and wires
    for (const dev of this.devices.values()) dev.destroy();
    for (const wire of this.wires.values()) wire.konvaLine?.destroy();
    this.devices.clear();
    this.wires.clear();
    this._selectedDev = null;
    this.onDeviceSelected(null);
    this.layer.batchDraw();
    if (this._wireLayer) this._wireLayer.batchDraw();
    this.log('↺ 电路已重置', 'info');
  }

  // ── Interaction callbacks ─────────────────────────────────

  onDeviceClick(dev) {
    if (this._selectedDev && this._selectedDev !== dev) {
      this._selectedDev.setSelected(false);
    }
    dev.setSelected(true);
    this._selectedDev = dev;
    this.onDeviceSelected(dev);
  }

  onTerminalClick(devId, termId) {
    if (!this._wireMode) return;

    if (!this._pendingWire) {
      // Start wire
      this._pendingWire = { fromDevId: devId, fromTermId: termId };
      this.log(`连线起点: [${devId.slice(-4)}].${termId}`, 'info');
      this._highlightTerminal(devId, termId, true);
    } else {
      // Complete wire
      const { fromDevId, fromTermId } = this._pendingWire;
      if (fromDevId === devId && fromTermId === termId) {
        // Cancel
        this._pendingWire = null;
        this._highlightTerminal(fromDevId, fromTermId, false);
        return;
      }
      this.addWire(fromDevId, fromTermId, devId, termId);
      this._highlightTerminal(fromDevId, fromTermId, false);
      this._pendingWire = null;
    }
  }

  _highlightTerminal(devId, termId, on) {
    const dev = this.devices.get(devId);
    const t   = dev?.getTerminal(termId);
    if (t?.konvaEl) {
      t.konvaEl.fill(on ? '#ffd60a' : '#0a0a0f');
      t.konvaEl.radius(on ? 7 : 5);
      this.layer.batchDraw();
    }
  }

  setMode(mode) {
    this._wireMode = mode === 'wire';
    if (mode === 'move') {
      for (const dev of this.devices.values()) {
        dev.enableDrag((movedDev) => this.updateWires(movedDev.id));
      }
    } else {
      for (const dev of this.devices.values()) dev.disableDrag();
    }
    if (mode !== 'wire' && this._pendingWire) {
      const { fromDevId, fromTermId } = this._pendingWire;
      this._highlightTerminal(fromDevId, fromTermId, false);
      this._pendingWire = null;
    }
  }

  // ── Bind terminal click events ────────────────────────────

  _bindDeviceInteraction(dev) {
    for (const t of dev.terminals) {
      if (t.konvaEl) {
        t.konvaEl.on('click tap', (e) => {
          e.cancelBubble = true;
          this.onTerminalClick(dev.id, t.id);
        });
      }
    }
  }

  // ── Logging ───────────────────────────────────────────────

  log(msg, type='info') {
    this.onLog(msg, type);
  }

  // ── Demo circuit builder ──────────────────────────────────

  buildDemoCircuit() {
    this.reset();

    // Place devices
    const src = this.addDevice('DCVoltageSource', 80,  180);
    const r1  = this.addDevice('Resistor',        260, 130);
    const d1  = this.addDevice('Diode',           260, 280);
    const mm  = this.addDevice('Multimeter',      440, 160);

    if (!src || !r1 || !d1 || !mm) return;

    // Set values
    src.setProp('voltage', 9);
    r1.setProp('resistance', 1000);

    // Wire connections
    // src.pos → r1.a
    this.addWire(src.id, 'pos', r1.id, 'a');
    // r1.b → d1.anode
    this.addWire(r1.id, 'b', d1.id, 'anode');
    // d1.cathode → mm.pos
    this.addWire(d1.id, 'cathode', mm.id, 'pos');
    // mm.neg → src.neg (ground)
    this.addWire(mm.id, 'neg', src.id, 'neg');

    this.log('✓ 演示电路已加载: DC→R→D→Meter', 'ok');
  }
}
