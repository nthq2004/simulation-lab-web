import { BaseComponent } from './BaseComponent.js';

/**
 * LeakDetector - 泡沫/泄漏检测器视觉组件
 *
 * 模拟一瓶肥皂水：当检测器靠近某个带 `isLeaking` 标记且有正压的 `pipe` 端口时，
 * 在泄漏位置生成上浮泡泡粒子示意漏点。
 *
 * 遵循新组件模板：`_initGroups → _recalcGeometry → _initParameters → _init`，
 * `_init` 内 `_drawStaticParts` + `_createDynamicNodes` + `_bindInteraction`。
 * 泡泡粒子动态创建在 `sys.layer`（不缓存），静态瓶体只缓存一次。
 */
export class LeakDetector extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.type  = 'leakDetector';
        this.cache = 'fixed';

        this._initGroups();
        this._recalcGeometry(config);
        this._initParameters(config);
        this._init();

        this.bubbles = [];
        this.isEmitting = false;
        this.anim = null;

        this.config = { id: this.id, scale: this.scale, width: this.w, height: this.h };
    }

    // ═══════════════════════════════════════════════════════
    // 几何 / 参数
    // ═══════════════════════════════════════════════════════

    _recalcGeometry(config) {
        this.scale = config.scale || 1;
        this.w = (config.width ? config.width * this.scale : 60 * this.scale);
        this.h = (config.height ? config.height * this.scale : 90 * this.scale);
    }

    _initParameters(_config) { /* 无需额外参数 */ }

    _init() {
        this._drawStaticParts();
        this._createDynamicNodes();
        this._bindInteraction();
    }

    // ═══════════════════════════════════════════════════════
    // 静态部件
    // ═══════════════════════════════════════════════════════

    _drawStaticParts() {
        this.bottle = new Konva.Rect({
            width: this.w, height: this.h,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint: { x: this.w, y: 0 },
            fillLinearGradientColorStops: [0, '#a1c4fd', 0.5, '#c2e9fb', 1, '#a1c4fd'],
            stroke: '#5fa9f6', strokeWidth: 2,
            cornerRadius: [this.w * 0.1, this.w * 0.1, this.w * 0.2, this.w * 0.2],
            opacity: 0.8,
        });

        const capW = this.w * 0.5;
        const capH = Math.min(this.h * 0.12, 10);
        this.cap = new Konva.Rect({
            x: (this.w - capW) / 2, y: -capH, width: capW, height: capH,
            fill: '#4a90e2', cornerRadius: 2,
        });

        this.label = new Konva.Text({
            text: '肥皂水', fontSize: Math.max(this.w * 0.2, 10), fontStyle: 'bold',
            fill: '#2c3e50', x: 0, y: this.h * 0.3, width: this.w, align: 'center',
        });

        this._staticGroup.add(this.bottle, this.cap, this.label);

        for (let i = 0; i < 5; i++) {
            this._staticGroup.add(new Konva.Circle({
                x: Math.random() * (this.w * 0.8) + (this.w * 0.1),
                y: Math.random() * (this.h * 0.7) + (this.h * 0.1),
                radius: Math.random() * (this.w * 0.08) + 1,
                fill: 'white', opacity: 0.4,
            }));
        }

        this.addClickablePart('bottle', 0, -10, this.w, this.h + 10);
    }

    _createDynamicNodes() { /* 泡泡粒子运行时创建于 sys.layer */ }

    // ═══════════════════════════════════════════════════════
    // 交互
    // ═══════════════════════════════════════════════════════

    _bindInteraction() {
        this.group.on('dragmove', () => this.checkCollision());
        this.group.on('mouseenter', () => { if (this.sys) this.sys.container.style.cursor = 'grab'; });
        this.group.on('mouseleave', () => { if (this.sys) this.sys.container.style.cursor = 'default'; });
    }

    // ═══════════════════════════════════════════════════════
    // 检漏逻辑
    // ═══════════════════════════════════════════════════════

    getTerminals() {
        if (!this.sys || !this.sys.comps) return [];
        const result = [];
        for (const [compId, comp] of Object.entries(this.sys.comps)) {
            if (compId === this.id) continue;
            if (!Array.isArray(comp.ports)) continue;
            for (const port of comp.ports) {
                if (port.type !== 'pipe') continue;
                if (!port.node) continue;
                let absPos;
                try { absPos = port.node.getAbsolutePosition(); }
                catch (e) { absPos = comp.getAbsPortPos(port.id); }
                const isLeaking = !!port.node.getAttr('isLeaking');
                result.push({ id: port.id, node: port.node, absPos, isLeaking });
            }
        }
        return result;
    }

    checkCollision() {
        const detectorPos = this.group.getAbsolutePosition();
        const probeX = detectorPos.x + this.w / 2;
        const probeY = detectorPos.y - (this.h * 0.1);

        let foundLeak = false;
        let leakX = probeX, leakY = probeY;

        for (const term of this.getTerminals()) {
            const dist = Math.sqrt(Math.pow(probeX - term.absPos.x, 2) + Math.pow(probeY - term.absPos.y, 2));
            if (dist < this.w * 0.6 && term.isLeaking) {
                if (this.sys.pressSolver && this.sys.pressSolver.terminalPressures && this.sys.pressSolver.terminalPressures[term.id] > 0) {
                    foundLeak = true;
                }
                leakX = term.absPos.x;
                leakY = term.absPos.y;
                break;
            }
        }

        if (foundLeak) this.startEmitting(leakX, leakY);
        else this.clearAllBubbles();
    }

    startEmitting(x, y) {
        if (this.isEmitting) return;
        this.isEmitting = true;

        this.anim = new Konva.Animation((frame) => {
            if (frame.timeDiff > 0 && Math.random() > 0.8) this.createBubbleParticle(x, y);
            for (let i = this.bubbles.length - 1; i >= 0; i--) {
                const b = this.bubbles[i];
                b.setY(b.y() - 1.2);
                b.setX(b.x() + Math.sin(frame.time / 200) * 0.8);
                b.opacity(b.opacity() - 0.015);
                if (b.opacity() <= 0) { b.destroy(); this.bubbles.splice(i, 1); }
            }
        }, this.sys.layer);

        this.anim.start();
    }

    stopEmitting() {
        this.isEmitting = false;
        if (this.anim) { this.anim.stop(); this.anim = null; }
    }

    createBubbleParticle(x, y) {
        const bubble = new Konva.Circle({
            x: x + (Math.random() - 0.5) * (this.w * 0.3),
            y: y,
            radius: Math.random() * (this.w * 0.2) + 2,
            stroke: 'white', strokeWidth: 1,
            fill: 'rgba(7, 7, 233, 0.4)', opacity: 0.8, listening: false,
        });
        this.sys.layer.add(bubble);
        this.bubbles.push(bubble);
    }

    clearAllBubbles() {
        this.stopEmitting();
        this.bubbles.forEach(b => { if (b) b.destroy(); });
        this.bubbles = [];
        this._refreshIfDirty();
    }

    // ═══════════════════════════════════════════════════════
    // 配置
    // ═══════════════════════════════════════════════════════

    getConfigFields() {
        return [
            { label: '器件名称 (ID)', key: 'id', type: 'text' },
            { label: '缩放', key: 'scale', type: 'number' },
        ];
    }

    onConfigUpdate(newConfig) {
        if (newConfig.id) this.id = newConfig.id;
        if (newConfig.scale !== undefined) {
            this.scale = parseFloat(newConfig.scale) || 1;
            this._rebuildGeometry();
        }
        this.config = { ...this.config, id: this.id, scale: this.scale };
    }

    _rebuildGeometry() {
        this._recalcGeometry({ scale: this.scale, width: this.config.width, height: this.config.height });
        this._staticGroup.destroyChildren();
        this._interactGroup.destroyChildren();
        this._parts = {};
        this._drawStaticParts();
    }

    destroy() {
        this.clearAllBubbles();
        super.destroy?.();
    }
}
