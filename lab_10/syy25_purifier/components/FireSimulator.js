import { BaseComponent } from './BaseComponent.js';

// 喷头 → 所在分区（ZONE）
const SPRINKLER_ZONE = { 'spk-main': 2, 'spk-gen': 1, 'spk-sep': 4, 'spk-boiler': 3 };
// 各分区延迟触发探测器的类型与时间（秒）
const SMOKE_DELAY = 5, FLAME_DELAY = 10, HEAT_DELAY = 15;

/**
 * FireSimulator — 火灾模拟器
 *
 * 右键点击模拟起火：先冒烟，随后火苗逐渐变大。
 * 当处于某消防喷头下方时，延迟触发该区域的探测器：
 *   5s → 感烟探测器；10s → 感光探测器；15s → 感温探测器。
 * 该区域喷头开始喷水后：10s 火苗开始减小，30s 火完全熄灭。
 */
export class FireSimulator extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);
        this.W = 160;
        this.H = 170;
        this.type = 'fire_simulator';
        this.special = 'fire_simulator';
        this.cache = 'fixed';

        this._initGroups();
        this._recalcGeometry(config);
        this._initParameters(config);
        this._init();

        this.config = { id: this.id, label: this.label, scale: this.scale };

        // 右键模拟起火（覆盖组件的默认右键菜单）
        // 注：右键会同时触发 mousedown(button=2) 与 contextmenu，用一个守卫去重避免"点火又熄灭"
        this.group.off('contextmenu');
        let rightHandled = false;
        const onRight = (e) => {
            if (e.evt && e.evt.preventDefault) e.evt.preventDefault();
            e.cancelBubble = true;
            if (rightHandled) return;
            rightHandled = true;
            setTimeout(() => { rightHandled = false; }, 400);
            this.ignite();
        };
        this.group.on('mousedown', (e) => { if (e.evt && e.evt.button === 2) onRight(e); });
        this.group.on('contextmenu', onRight);
    }

    _recalcGeometry(_config) {
        this.W = 160;
        this.H = 180;
        this._cx = this.W / 2;
        this._baseY = this.H - 56;
    }

    _initParameters(config) {
        this.label = config.label || '易燃物';
        this.active = false;
        this._t0 = 0;            // 起火时刻
        this._sprayStart = 0;    // 喷头开始喷水时刻
        this._scale = 0;         // 火苗当前大小 0~1
        this._spawnAcc = 0;
        this._fired = { smoke: false, flame: false, heat: false };
        this._triggered = [];    // 已施加激励的探测器
        this._smoke = [];
    }

    _init() {
        this._drawStaticParts();
        this._createDynamicNodes();
        this._bindInteraction();
    }

    _drawStaticParts() {
        const g = this._staticGroup, cx = this._cx;
        // 地面底座（易燃物堆）
        g.add(new Konva.Ellipse({ x: cx, y: this._baseY + 8, radiusX: 58, radiusY: 14, fill: '#3a3f44', stroke: '#26292d', strokeWidth: 2 }));
        g.add(new Konva.Ellipse({ x: cx, y: this._baseY + 4, radiusX: 50, radiusY: 11, fill: '#22262a', listening: false }));
        // 文字标注（下方）
        g.add(new Konva.Text({ x: 0, y: this.H - 34, width: this.W, text: this.label, fontSize: 14, fontStyle: 'bold', fill: '#263238', align: 'center' }));

        this.addClickablePart('body', cx - 62, 10, 124, this.H - 44);
    }

    _createDynamicNodes() {
        const d = this._dynamicGroup;
        this._smokeGroup = new Konva.Group({ listening: false });
        d.add(this._smokeGroup);
        this._flameGroup = new Konva.Group({ listening: false });
        d.add(this._flameGroup);

        // 光晕
        this._glow = new Konva.Circle({
            x: this._cx, y: this._baseY - 24, radius: 60,
            fillRadialGradientStartPoint: { x: this._cx, y: this._baseY - 24 }, fillRadialGradientStartRadius: 0,
            fillRadialGradientEndPoint: { x: this._cx + 60, y: this._baseY - 24 }, fillRadialGradientEndRadius: 60,
            fillRadialGradientColorStops: [0, 'rgba(255,150,40,0.5)', 1, 'rgba(255,150,40,0)'],
            opacity: 0, listening: false,
        });
        d.add(this._glow);

        // 多层火苗（外→内）
        const mk = (w, h, color) => {
            const n = new Konva.Line({ points: [this._cx, this._baseY, this._cx, this._baseY], closed: true, tension: 0.45, fill: color, listening: false });
            this._flameGroup.add(n);
            return { node: n, w, h };
        };
        this._flames = [
            mk(24, 74, 'rgba(255,80,0,0.55)'),
            mk(17, 58, 'rgba(255,160,20,0.85)'),
            mk(11, 42, 'rgba(255,240,160,0.95)'),
            mk(6, 24, 'rgba(140,190,255,0.9)'),
        ];
        this._flameGroup.opacity(0);

        // 状态文字（上方）
        this._stateText = new Konva.Text({ x: 0, y: 4, width: this.W, text: '', fontSize: 11, fontStyle: 'bold', fill: '#c0392b', align: 'center' });
        d.add(this._stateText);
    }

    _bindInteraction() {
        // 左键也可起火（便于点击操作）
        const hit = this.getClickablePartNode('body');
        if (hit) hit.on('click tap', (e) => { e.cancelBubble = true; this.ignite(); });
    }

    // ═══════════ 起火 / 熄灭 ═══════════
    ignite() {
        // 防止右键 mousedown + contextmenu 双触发（部分环境下两个事件都会到达）
        const _t = Date.now();
        if (this._igniteGuard && _t - this._igniteGuard < 300) return;
        this._igniteGuard = _t;
        if (this.active) { this.extinguish(); return; }   // 再次右键：熄灭复位
        this.active = true;
        this._t0 = Date.now();
        this._sprayStart = 0;
        this._scale = 0;
        this._fired = { smoke: false, flame: false, heat: false };
        this._triggered = [];
    }

    extinguish() {
        this.active = false;
        this._sprayStart = 0;
        this._scale = 0;
        this._flameGroup.opacity(0);
        this._glow.opacity(0);
        // 撤销对探测器的激励（探测器恢复正常）
        this._triggered.forEach(d => { try { d.setStimulus && d.setStimulus(false); } catch (e) { /* ignore */ } });
        this._triggered = [];
        this._clearSmoke();
    }

    _clearSmoke() {
        this._smoke.forEach(s => s.node.destroy());
        this._smoke = [];
    }

    /** 本模拟器正上方的喷头（若无则不触发任何区域） */
    _sprinklerAbove() {
        const comps = this.sys && this.sys.comps; if (!comps) return null;
        const g = this.group.getAbsolutePosition();
        const fx = g.x + this._cx, fy = g.y + this._baseY;
        let best = null, bd = Infinity;
        for (const c of Object.values(comps)) {
            if (!c || c.special !== 'sprinkler') continue;
            const cp = c.getClickablePartCenter && c.getClickablePartCenter('body');
            if (!cp) continue;
            const dx = Math.abs(cp.x - fx);
            if (cp.y < fy && dx < 150 && dx < bd) { bd = dx; best = c; }
        }
        return best;
    }

    _zoneDetectors(zone, type) {
        const comps = this.sys && this.sys.comps; if (!comps || !zone) return [];
        return Object.values(comps).filter(c => c && c.isDetector && c.zone === zone && c.type === type);
    }

    tick(dt) {
        const d = dt || 0.05;
        if (this.active) {
            const t = (Date.now() - this._t0) / 1000;

            // 火苗大小：起火后约 8s 长到最大；喷水 10s 后开始减小，30s 完全熄灭
            let scale = Math.min(1, t / 8);

            const spk = this._sprinklerAbove();
            const zone = spk ? SPRINKLER_ZONE[spk.id] : 0;
            const spraying = !!(spk && spk.isOpen);
            if (spraying && !this._sprayStart) this._sprayStart = Date.now();
            if (this._sprayStart) {
                const since = (Date.now() - this._sprayStart) / 1000;
                if (since >= 30) { this.extinguish(); this._stateText.text('已熄灭'); this.markDirty(); this._refreshIfDirty(); return; }
                if (since >= 10) scale = Math.max(0, 1 - (since - 10) / 20);
            }
            this._scale = scale;

            // 区域探测器延迟触发
            if (zone) {
                if (t >= SMOKE_DELAY && !this._fired.smoke) { this._fireDetectors(zone, 'SmokeDetector'); this._fired.smoke = true; }
                if (t >= FLAME_DELAY && !this._fired.flame) { this._fireDetectors(zone, 'FlameDetector'); this._fired.flame = true; }
                if (t >= HEAT_DELAY && !this._fired.heat) { this._fireDetectors(zone, 'HeatDetector'); this._fired.heat = true; }
            }

            // 烟雾（起火初期较浓）
            const smokeRate = (t < 4) ? 22 : 10;   // 每秒生成数
            this._spawnAcc += d * smokeRate;
            while (this._spawnAcc >= 1) { this._spawnAcc -= 1; this._spawnSmoke(scale); }

            // 火苗绘制
            this._drawFlames(scale, t);
            this._glow.opacity(0.35 + scale * 0.4);

            this._stateText.text(this._sprayStart ? (scale > 0.05 ? '喷水灭火中…' : '火势减小…') : '燃烧中');
            this._stateText.fill(this._sprayStart ? '#1565c0' : '#c0392b');
        }

        // 烟雾粒子上浮
        for (let i = this._smoke.length - 1; i >= 0; i--) {
            const s = this._smoke[i];
            s.node.y(s.node.y() - s.vy * d);
            s.node.x(s.node.x() + s.vx * d);
            s.node.opacity(s.node.opacity() - 0.22 * d);
            if (s.node.opacity() <= 0 || s.node.y() < 10) { s.node.destroy(); this._smoke.splice(i, 1); }
        }

        this.markDirty();
        this._refreshIfDirty();
    }

    _fireDetectors(zone, type) {
        this._zoneDetectors(zone, type).forEach(det => {
            try { det.setStimulus && det.setStimulus(true); } catch (e) { /* ignore */ }
            if (this._triggered.indexOf(det) < 0) this._triggered.push(det);
        });
    }

    _drawFlames(scale, t) {
        if (scale <= 0.01) { this._flameGroup.opacity(0); return; }
        this._flameGroup.opacity(1);
        const cx = this._cx, baseY = this._baseY;
        this._flames.forEach((f, idx) => {
            const flick = 0.85 + Math.sin(t * 12 + idx * 1.7) * 0.12 + Math.random() * 0.06;
            const w = f.w * scale * (0.9 + flick * 0.15);
            const h = f.h * scale * flick;
            const sway = Math.sin(t * 9 + idx) * 3 * scale;
            f.node.points([
                cx - w, baseY,
                cx - w * 0.55, baseY - h * 0.45,
                cx + sway, baseY - h,
                cx + w * 0.55, baseY - h * 0.45,
                cx + w, baseY,
            ]);
        });
    }

    _spawnSmoke(scale) {
        const cx = this._cx, baseY = this._baseY;
        const node = new Konva.Circle({
            x: cx + (Math.random() - 0.5) * 40,
            y: baseY - 10 - Math.random() * 20 * (0.5 + scale),
            radius: 10 + Math.random() * 12,
            fill: '#9aa0a4', opacity: 0.35 + Math.random() * 0.2, listening: false,
        });
        this._smokeGroup.add(node);
        this._smoke.push({ node, vx: (Math.random() - 0.5) * 26, vy: 30 + Math.random() * 24 });
        if (this._smoke.length > 80) { const old = this._smoke.shift(); old.node.destroy(); }
    }

    getConfigFields() {
        return [
            { label: '器件名称 (ID)', key: 'id', type: 'text' },
            { label: '名称', key: 'label', type: 'text' },
        ];
    }

    onConfigUpdate(cfg) {
        if (cfg.id) this.id = cfg.id;
        if (cfg.label !== undefined) this.label = cfg.label;
        this.config = { ...this.config, ...cfg };
    }

    destroy() { this._clearSmoke(); super.destroy?.(); }
}

export default FireSimulator;
