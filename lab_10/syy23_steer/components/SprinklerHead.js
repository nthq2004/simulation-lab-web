import { BaseComponent } from './BaseComponent.js';

/**
 * SprinklerHead — 消防喷头
 *
 * 顶部管路进水（仅一个入口端口 i），喷头下垂；阀打开（isOpen）时自溅水盘向下喷洒水雾粒子。
 * 无出口端口；名称标注置于上方。复用气路求解器的截止阀分支（type='stopValve'）。
 * 遵循新组件模板，无 shadow 三件套；粒子为 in-place 动态节点。
 */
export class SprinklerHead extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.W = 120;
        this.H = 150;
        this.type = 'stopValve';
        this.special = 'sprinkler';
        this.cache = 'fixed';

        this._initGroups();
        this._recalcGeometry(config);
        this._initParameters(config);
        this._init();

        this.config = { id: this.id, label: this.label, isOpen: this.isOpen };

        // 仅保留进水口（上方）
        this.addPort(this._cx, 26, 'i', 'pipe', 'in');
    }

    _recalcGeometry(_config) {
        this._cx = this.W / 2;
    }

    _initParameters(config) {
        this.label = config.label || '消防喷头';
        this.isOpen = config.isOpen !== undefined ? config.isOpen : false;
        this.valveId = config.valveId || null;   // 关联的电磁阀 id（阀开则喷淋）
        this._drops = [];
        this._spawnAcc = 0;
    }

    _init() {
        this._drawStaticParts();
        this._createDynamicNodes();
        this._bindInteraction();
    }

    _drawStaticParts() {
        const g = this._staticGroup;
        const cx = this._cx;

        // 名称标注（上方）
        g.add(new Konva.Text({ x: 0, y: 3, width: this.W, text: this.label, fontSize: 12, fontStyle: 'bold', fill: '#263238', align: 'center' }));

        // 进水短管
        g.add(new Konva.Rect({ x: cx - 7, y: 26, width: 14, height: 22, fill: '#9aa3a8', stroke: '#7a8288', strokeWidth: 1 }));
        // 喷头本体（倒锥）
        g.add(new Konva.Line({
            points: [cx - 14, 48, cx + 14, 48, cx + 20, 70, cx - 20, 70],
            closed: true, fill: '#b0bec5', stroke: '#607d8b', strokeWidth: 2,
        }));
        // 溅水盘
        g.add(new Konva.Line({
            points: [cx - 34, 76, cx + 34, 76, cx + 26, 84, cx - 26, 84],
            closed: true, fill: '#cfd8dc', stroke: '#78909c', strokeWidth: 2,
        }));

        this.addClickablePart('body', cx - 30, 42, 60, 48);
    }

    _createDynamicNodes() {
        this._dropsGroup = new Konva.Group({ listening: false });
        this._dynamicGroup.add(this._dropsGroup);
    }

    _bindInteraction() {
        const hit = this.getClickablePartNode('body');
        if (hit) hit.on('click tap', (e) => { e.cancelBubble = true; this.setOpen(!this.isOpen); });
    }

    setOpen(on) {
        this.isOpen = !!on;
        this.config = { ...this.config, isOpen: this.isOpen };
        if (!this.isOpen) this._clearDrops();
    }

    _clearDrops() {
        this._drops.forEach(d => d.node.destroy());
        this._drops = [];
    }

    tick(dt) {
        const d = dt || 0.05;
        // 阀开启 且 入口有水（压力）才产生喷淋
        let valveOpen = true;
        if (this.valveId) {
            const v = this.sys.comps && this.sys.comps[this.valveId];
            if (v) valveOpen = !!v.isOpen;
        }
        let hasWater = false;
        try {
            const tp = this.sys.pressSolver && this.sys.pressSolver.terminalPressures;
            const pin = tp ? (tp[`${this.id}_pipe_i`] || 0) : 0;
            hasWater = pin > 1e-4;
        } catch (e) { /* ignore */ }
        this.isOpen = valveOpen && hasWater;
        if (this.isOpen) {
            this._spawnAcc += d;
            const spawnEvery = 0.05;
            while (this._spawnAcc >= spawnEvery) {
                this._spawnAcc -= spawnEvery;
                this._spawn(dt);
            }
        }
        for (let i = this._drops.length - 1; i >= 0; i--) {
            const p = this._drops[i];
            p.vy += 900 * d;
            p.node.y(p.node.y() + p.vy * d);
            p.node.x(p.node.x() + p.vx * d);
            p.life -= d;
            if (p.life <= 0 || p.node.y() > this.H + 160) {
                p.node.destroy();
                this._drops.splice(i, 1);
            }
        }
        this.markDirty();
        this._refreshIfDirty();
    }

    _spawn() {
        const cx = this._cx;
        const spread = (Math.random() - 0.5) * 70;
        const node = new Konva.Circle({
            x: cx + spread, y: 88, radius: 2 + Math.random() * 1.6,
            fill: '#42a5f5', opacity: 0.85, listening: false,
        });
        this._dropsGroup.add(node);
        this._drops.push({ node, vx: spread * 0.6, vy: 40 + Math.random() * 40, life: 1.2 + Math.random() * 0.5 });
    }

    getValue() { return this.isOpen; }
    setValue(v) { this.setOpen(v); }

    getConfigFields() {
        return [
            { label: '器件名称 (ID)', key: 'id', type: 'text' },
            { label: '标签', key: 'label', type: 'text' },
            { label: '初始状态', key: 'isOpen', type: 'select', options: [{ label: '关闭', value: false }, { label: '开启', value: true }] },
        ];
    }

    onConfigUpdate(cfg) {
        if (cfg.id) this.id = cfg.id;
        if (cfg.label !== undefined) this.label = cfg.label;
        if (cfg.isOpen !== undefined) this.setOpen(cfg.isOpen === true || cfg.isOpen === 'true');
        this.config = { ...this.config, ...cfg };
    }

    destroy() { this._clearDrops(); super.destroy?.(); }
}

export default SprinklerHead;
