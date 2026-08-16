/**
 * BaseDevice.js — 所有器件的基类
 * 提供 Konva 绘制基础、接线柱管理、属性系统
 */

export class BaseDevice {
  /**
   * @param {object} opts
   * @param {Konva.Layer} opts.layer      — 所在 Konva 层
   * @param {number}  opts.x             — 初始 X 坐标
   * @param {number}  opts.y             — 初始 Y 坐标
   * @param {string}  opts.id            — 唯一 ID
   * @param {object}  opts.simulation    — 仿真引擎引用
   */
  constructor(opts = {}) {
    this.id         = opts.id   || `dev_${Date.now()}_${Math.random().toString(36).slice(2,6)}`;
    this.layer      = opts.layer;
    this.simulation = opts.simulation || null;
    this.x          = opts.x ?? 100;
    this.y          = opts.y ?? 100;

    // Device metadata — subclasses override
    this.deviceType   = 'BaseDevice';
    this.deviceLabel  = '器件';
    this.color        = '#4cc9f0';

    // Properties dictionary { key: { label, value, unit, editable, min, max } }
    this.properties = {};

    // Terminal nodes: array of { id, localX, localY, nodeId, konvaCircle }
    // localX/Y = offset relative to device origin
    this.terminals = [];

    // Konva group containing all visuals
    this.group = new Konva.Group({
      x: this.x,
      y: this.y,
      draggable: false,
      id: this.id,
    });

    // Whether device is selected
    this.selected = false;

    // Simulation node voltages (filled by sim engine)
    this.nodeVoltages = {};

    // Device is active (part of connected circuit)
    this.active = false;
  }

  // ── Subclass must implement ─────────────────────────────

  /** Draw Konva shapes into this.group */
  draw() { throw new Error(`${this.deviceType}.draw() not implemented`); }

  /**
   * Called each simulation tick.
   * @param {number} dt — time step (seconds)
   * @param {object} circuit — circuit state
   */
  // eslint-disable-next-line no-unused-vars
  simulate(dt, circuit) {}

  // ── Terminal management ─────────────────────────────────

  /**
   * Register a terminal (接线柱).
   * @param {string} id      — terminal id, e.g. 'pos', 'neg', 'base'
   * @param {number} lx      — local X offset from device origin
   * @param {number} ly      — local Y offset
   * @param {string} [label] — optional label
   */
  addTerminal(id, lx, ly, label = '') {
    const terminal = { id, localX: lx, localY: ly, label, nodeId: null, konvaEl: null };
    this.terminals.push(terminal);
    return terminal;
  }

  getTerminal(id) {
    return this.terminals.find(t => t.id === id);
  }

  /** World coordinates of a terminal */
  terminalWorldPos(id) {
    const t = this.getTerminal(id);
    if (!t) return null;
    return {
      x: this.group.x() + t.localX,
      y: this.group.y() + t.localY,
    };
  }

  // ── Terminal Konva visuals ──────────────────────────────

  drawTerminals(opts = {}) {
    const radius = opts.radius ?? 5;
    this.terminals.forEach(t => {
      // Outer glow ring (clickable area)
      const hitCircle = new Konva.Circle({
        x: t.localX, y: t.localY,
        radius: radius + 4,
        fill: 'transparent',
      });

      const circle = new Konva.Circle({
        x: t.localX, y: t.localY,
        radius,
        fill: '#0a0a0f',
        stroke: this.color,
        strokeWidth: 1.5,
        shadowColor: this.color,
        shadowBlur: 0,
        name: 'terminal',
        id: `${this.id}__${t.id}`,
      });

      // Label
      if (t.label) {
        const lbl = new Konva.Text({
          x: t.localX + (t.localX > 0 ? radius + 2 : -(radius + 14)),
          y: t.localY - 6,
          text: t.label,
          fontSize: 9,
          fontFamily: 'Share Tech Mono, monospace',
          fill: this.color,
          opacity: 0.7,
        });
        this.group.add(lbl);
      }

      t.konvaEl = circle;
      this.group.add(hitCircle);
      this.group.add(circle);

      // Mouse hover
      hitCircle.on('mouseenter', () => {
        circle.setAttrs({ strokeWidth: 2.5, shadowBlur: 8 });
        document.body.style.cursor = 'crosshair';
        this.layer.batchDraw();
      });
      hitCircle.on('mouseleave', () => {
        circle.setAttrs({ strokeWidth: 1.5, shadowBlur: 0 });
        document.body.style.cursor = 'default';
        this.layer.batchDraw();
      });
    });
  }

  // ── Selection ───────────────────────────────────────────

  setSelected(v) {
    this.selected = v;
    this.onSelectionChange(v);
  }

  onSelectionChange(selected) {
    // Subclasses can override for visual feedback
    const body = this.group.findOne('.device-body');
    if (body) {
      body.strokeWidth(selected ? 2 : 1);
      body.stroke(selected ? '#ffffff' : this.color);
    }
    this.layer.batchDraw();
  }

  // ── Move ────────────────────────────────────────────────

  moveTo(x, y) {
    this.x = x;
    this.y = y;
    this.group.position({ x, y });
    this.layer.batchDraw();
  }

  enableDrag(onDragMove) {
    this.group.draggable(true);
    this.group.on('dragmove', () => {
      this.x = this.group.x();
      this.y = this.group.y();
      if (onDragMove) onDragMove(this);
    });
  }

  disableDrag() {
    this.group.draggable(false);
  }

  // ── Properties UI ───────────────────────────────────────

  addProp(key, label, value, unit = '', editable = true, min = null, max = null) {
    this.properties[key] = { label, value, unit, editable, min, max };
  }

  getProp(key) {
    return this.properties[key]?.value;
  }

  setProp(key, value) {
    if (!this.properties[key]) return;
    const p = this.properties[key];
    if (p.min !== null) value = Math.max(p.min, value);
    if (p.max !== null) value = Math.min(p.max, value);
    p.value = value;
    this.onPropChange(key, value);
  }

  // eslint-disable-next-line no-unused-vars
  onPropChange(key, value) {
    // Subclasses override
  }

  /** Render property panel HTML */
  renderPropPanel() {
    let rows = `
      <div class="prop-device-name">${this.deviceLabel}</div>
      <div class="prop-device-type">${this.deviceType} · ${this.id.slice(-6)}</div>
    `;
    for (const [key, p] of Object.entries(this.properties)) {
      if (p.editable) {
        rows += `
          <div class="prop-row">
            <span class="prop-key">${p.label}</span>
            <input class="prop-input" type="number"
              data-key="${key}" value="${p.value}"
              ${p.min !== null ? `min="${p.min}"` : ''}
              ${p.max !== null ? `max="${p.max}"` : ''}
              step="any" />
          </div>
        `;
      } else {
        rows += `
          <div class="prop-row">
            <span class="prop-key">${p.label}</span>
            <span class="prop-val">${p.value}${p.unit ? ' '+p.unit : ''}</span>
          </div>
        `;
      }
    }
    return rows;
  }

  // ── Destroy ─────────────────────────────────────────────

  destroy() {
    this.group.destroy();
    this.layer.batchDraw();
  }
}
