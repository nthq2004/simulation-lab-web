import { BaseComponent } from './BaseComponent.js';

/**
 * FireToolBase — 消防测试专用工具基类
 *
 * 工具可拖拽；点击整机切换"工作/待用"。工作时在其作用点向指定方向发出效果
 * （火焰/热风/烟雾）；当作用点靠近目标类型探测器（有效距离内）时触发火警。
 * 子类通过 `_drawStaticParts` 定制外形、`_emitSpec` 定制效果、
 * `TARGET_TYPE` 指定目标探测器类型；需持续作用时间的（电吹风）覆盖 `_onTarget`。
 */
export class FireToolBase extends BaseComponent {
    static TARGET_TYPE = 'SmokeDetector';
    static LABEL = '专用工具';
    static TYPE = 'fire_tool';

    constructor(config, sys) {
        super(config, sys);

        this.type    = this.constructor.TYPE;
        this.special = 'fire_tool';
        this.cache   = 'fixed';

        this._initGroups();
        this._recalcGeometry(config);
        this._initParameters(config);
        this._init();

        this.config = { id: this.id, label: this.label, scale: this.scale, range: this.range, dwellMs: this.dwellMs };
    }

    _recalcGeometry(_config) { this.W = 110; this.H = 120; }

    _initParameters(config) {
        this.label      = config.label || this.constructor.LABEL;
        this.targetType = this.constructor.TARGET_TYPE;
        this.range      = config.range || 150;          // 有效作用距离（画布像素）
        this.dwellMs    = config.dwellMs || 0;          // 需持续作用时间（0=立即触发）
        this.active     = false;                        // 是否在工作
        this.triggered  = false;
        this._aimStart  = 0;
        this._t         = 0;
        this._target    = null;
    }

    _init() {
        this._drawStaticParts();
        this._createDynamicNodes();
        this._bindInteraction();
    }

    _drawStaticParts() { /* 子类覆盖 */ }

    _createDynamicNodes() {
        const d = this._dynamicGroup;
        this._effect = new Konva.Group({ listening: false });
        d.add(this._effect);
        const spec = this._emitSpec();
        this._emis = [];
        for (let i = 0; i < 8; i++) {
            const n = new Konva.Circle({ x: 0, y: 0, radius: 4, fill: spec.color, opacity: 0, listening: false });
            this._effect.add(n);
            this._emis.push(n);
        }
        this._statusText = new Konva.Text({
            x: 0, y: this.H - 16, width: this.W, text: '待用',
            fontSize: 11, fontStyle: 'bold', fill: '#546e7a', align: 'center',
        });
        d.add(this._statusText);
    }

    _bindInteraction() {
        // 整体（供演示箭头指示）
        this.addClickablePart('body', 0, 0, this.W, this.H);
        // 点击整机切换工作状态
        const hit = this.addClickablePart('power', 0, 0, this.W, this.H, true);
        if (hit) hit.on('click tap', (e) => { e.cancelBubble = true; this.toggle(); });
    }

    toggle() { this.active = !this.active; this._aimStart = 0; this.triggered = false; }
    setActive(on) { this.active = !!on; this._aimStart = 0; this.triggered = false; }

    // ── 作用点 / 效果（子类覆盖）──
    _probeLocal() { return { x: this.W / 2, y: 0 }; }
    _emitSpec() { return { dx: 0, dy: -1, dist: 50, spread: 14, color: '#ff9800', r0: 3, r1: 7 }; }

    _probeWorld() {
        const p = this._probeLocal();
        try { return this.group.getAbsoluteTransform().point(p); }
        catch (e) { const g = this.group.getAbsolutePosition(); return { x: g.x + p.x, y: g.y + p.y }; }
    }

    /** 有效距离内最近的目标类型探测器 */
    _nearestTarget() {
        const comps = this.sys && this.sys.comps; if (!comps) return null;
        const p = this._probeWorld();
        let best = null, bd = Infinity;
        for (const c of Object.values(comps)) {
            if (!c || c.type !== this.targetType) continue;
            let cp = null;
            try { cp = c.getClickablePartCenter && c.getClickablePartCenter('body'); } catch (e) { /* ignore */ }
            if (!cp) { const g = c.group.getAbsolutePosition(); cp = { x: g.x + (c.W || 60) / 2, y: g.y + (c.H || 60) / 2 }; }
            const dist = Math.hypot(cp.x - p.x, cp.y - p.y);
            if (dist <= this.range && dist < bd) { bd = dist; best = c; }
        }
        return best;
    }

    tick(dt) {
        const d = dt || 0.05;
        this._t += d;
        const prev = this._target;
        this._target = this.active ? this._nearestTarget() : null;
        // 离开目标或停止工作：撤销对该探测器的激励（探测器随即自动恢复正常）
        if (prev && prev !== this._target) {
            try { if (prev.setStimulus) prev.setStimulus(false); } catch (e) { /* ignore */ }
        }
        if (this.active && this._target) this._onTarget(this._target, d);
        else { this._aimStart = 0; }
        this._updateEffect();
        this._updateStatus();
        this.markDirty();
        this._refreshIfDirty();
    }

    /**
     * 命中目标后的作用：持续对准 dwellMs 后施加激励（探测器随即报警）；
     * 离开目标或停止工作时由 tick 撤销激励，探测器自动恢复正常。
     */
    _onTarget(target, _dt) {
        if (!target) { this._aimStart = 0; this.triggered = false; return; }
        if (!this._aimStart) this._aimStart = Date.now();
        if (Date.now() - this._aimStart >= this.dwellMs) {
            if (target.setStimulus) target.setStimulus(true);
            this.triggered = true;
        }
    }

    _updateEffect() {
        const spec = this._emitSpec();
        const tip = this._probeLocal();
        for (let i = 0; i < this._emis.length; i++) {
            const n = this._emis[i];
            if (!this.active) { n.opacity(0); continue; }
            const ph = ((this._t * 0.9 + i / this._emis.length) % 1);
            const wob = Math.sin(this._t * 8 + i) * spec.spread * 0.4;
            const px = (spec.dx === 0) ? wob : spec.dx * spec.dist * ph + wob * 0.25;
            const py = (spec.dy === 0) ? wob : spec.dy * spec.dist * ph + wob * 0.25;
            n.x(tip.x + px);
            n.y(tip.y + py);
            n.radius(spec.r0 + (spec.r1 - spec.r0) * ph);
            n.opacity(0.85 * (1 - ph));
        }
    }

    _updateStatus() {
        if (!this._statusText) return;
        if (!this.active) { this._statusText.text('待用'); this._statusText.fill('#546e7a'); return; }
        if (this._target) {
            if (this.dwellMs > 0) {
                const pct = this._aimStart ? Math.min(100, Math.round((Date.now() - this._aimStart) / this.dwellMs * 100)) : 0;
                this._statusText.text(`作用中 ${pct}%${this.triggered ? ' ✓' : ''}`);
            } else {
                this._statusText.text(`作用中${this.triggered ? ' ✓' : ''}`);
            }
            this._statusText.fill('#1b7f1b');
        } else {
            this._statusText.text('工作中（未对准探头）');
            this._statusText.fill('#c0392b');
        }
    }

    // ── 配置 ──
    getConfigFields() {
        return [
            { label: '器件名称 (ID)', key: 'id', type: 'text' },
            { label: '名称', key: 'label', type: 'text' },
            { label: '有效距离 (px)', key: 'range', type: 'number' },
            { label: '持续作用时间 (ms)', key: 'dwellMs', type: 'number' },
        ];
    }

    onConfigUpdate(cfg) {
        if (cfg.id) this.id = cfg.id;
        if (cfg.label !== undefined) this.label = cfg.label;
        if (cfg.range !== undefined) this.range = parseFloat(cfg.range) || 150;
        if (cfg.dwellMs !== undefined) this.dwellMs = parseFloat(cfg.dwellMs) || 0;
        this.config = { ...this.config, ...cfg };
    }

    destroy() { super.destroy?.(); }
}

export default FireToolBase;
