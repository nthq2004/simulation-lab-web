import { FireToolBase } from './FireToolBase.js';

/**
 * Lighter — 消防测试专用打火机
 * 点击点燃/熄灭；火焰（多层焰心+光晕+火星）靠近感光（紫外）探测器，持续 3s 触发火警。
 * 静态名称在机身右侧（纵向 打/火/机），动态状态在下方。
 */
export class Lighter extends FireToolBase {
    static TARGET_TYPE = 'FlameDetector';
    static LABEL = '专用打火机';
    static TYPE = 'lighter';

    _recalcGeometry(_config) { this.W = 100; this.H = 150; }
    _probeLocal() { return { x: 50, y: 46 }; }
    _emitSpec() { return { dx: 0, dy: -1, dist: 64, spread: 12, color: '#ffd54a', r0: 2, r1: 5 }; }

    _initParameters(config) {
        super._initParameters(config);
        this.dwellMs = config.dwellMs || 3000;   // 延迟 3s 触发报警
    }

    _drawStaticParts() {
        const g = this._staticGroup, cx = 50;
        // 静态名称（机身右侧，纵向 打/火/机）
        g.add(new Konva.Text({
            x: cx + 20, y: 64, width: 26, text: '打\n火\n机',
            fontSize: 15, fontStyle: 'bold', fill: '#263238', align: 'center', lineHeight: 1.05,
        }));
        // 金属喷嘴
        g.add(new Konva.Rect({ x: cx - 8, y: 46, width: 16, height: 22, fill: '#9aa3a8', stroke: '#607d8b', strokeWidth: 1.5, cornerRadius: 3 }));
        // 机身
        g.add(new Konva.Rect({ x: cx - 16, y: 66, width: 32, height: 66, fill: '#c0392b', stroke: '#7f1d1d', strokeWidth: 2, cornerRadius: 6 }));
        g.add(new Konva.Rect({ x: cx - 16, y: 66, width: 32, height: 22, fill: '#e74c3c', cornerRadius: [6, 6, 0, 0], listening: false }));
        this.addClickablePart('nozzle', cx - 14, 42, 28, 28);
    }

    _createDynamicNodes() {
        super._createDynamicNodes();
        const d = this._dynamicGroup, cx = 50, baseY = 46;
        // 火焰光晕
        this._glow = new Konva.Circle({
            x: cx, y: baseY - 14, radius: 28,
            fillRadialGradientStartPoint: { x: cx, y: baseY - 14 }, fillRadialGradientStartRadius: 0,
            fillRadialGradientEndPoint: { x: cx + 28, y: baseY - 14 }, fillRadialGradientEndRadius: 28,
            fillRadialGradientColorStops: [0, 'rgba(255,170,40,0.55)', 1, 'rgba(255,170,40,0)'],
            opacity: 0, listening: false,
        });
        d.add(this._glow);
        // 三层火焰（外焰→内焰）
        const mk = (w, h, color) => {
            const n = new Konva.Line({ points: [cx, baseY, cx, baseY], closed: true, tension: 0.45, fill: color, listening: false });
            d.add(n);
            return { node: n, w, h };
        };
        this._flames = [
            mk(16, 58, 'rgba(255,80,0,0.55)'),
            mk(11, 46, 'rgba(255,160,20,0.85)'),
            mk(7, 32, 'rgba(255,240,160,0.95)'),
            mk(4, 16, 'rgba(120,180,255,0.85)'),
        ];
        this._cx2 = cx; this._baseY = baseY;
    }

    _updateEffect() {
        super._updateEffect();
        const cx = this._cx2, baseY = this._baseY, t = this._t, on = this.active;
        if (this._glow) this._glow.opacity(on ? (0.5 + Math.abs(Math.sin(t * 12)) * 0.35) : 0);
        this._flames.forEach((f, idx) => {
            if (!on) { f.node.opacity(0); return; }
            f.node.opacity(1);
            const flick = 0.82 + Math.sin(t * 13 + idx * 1.7) * 0.13 + Math.random() * 0.07;
            const w = f.w * (0.9 + flick * 0.15);
            const h = f.h * flick;
            const sway = Math.sin(t * 9 + idx) * 2.2;
            f.node.points([
                cx - w, baseY,
                cx - w * 0.55, baseY - h * 0.45,
                cx + sway, baseY - h,
                cx + w * 0.55, baseY - h * 0.45,
                cx + w, baseY,
            ]);
        });
    }
}

export default Lighter;
