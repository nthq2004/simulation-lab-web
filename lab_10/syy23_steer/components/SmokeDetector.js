import { DetectorBase } from './DetectorBase.js';

/**
 * SmokeDetector — 感烟探测器（CAN 可寻址节点）
 * 中央绘制黑色金属网（进烟感应网）。
 */
export class SmokeDetector extends DetectorBase {
    static TYPE = 'SmokeDetector';
    static TYPE_CODE = 1;
    static LABEL = '感烟探测器';
    static ACCENT = '#546e7a';

    _drawTypeGlyph(g, cx, cy) {
        const R = 24;
        // 网框（黑色金属网）
        g.add(new Konva.Circle({ x: cx, y: cy, radius: R, fill: '#181818', stroke: '#0b0b0b', strokeWidth: 2, listening: false }));
        // 网格（横竖细线）
        for (let i = -3; i <= 3; i++) {
            const off = (i / 3) * R * 0.85;
            const half = Math.sqrt(Math.max(0, R * R - off * off));
            g.add(new Konva.Line({ points: [cx - half, cy + off, cx + half, cy + off], stroke: '#8f8f8f', strokeWidth: 1.1, listening: false }));
            g.add(new Konva.Line({ points: [cx + off, cy - half, cx + off, cy + half], stroke: '#8f8f8f', strokeWidth: 1.1, listening: false }));
        }
        // 外圈金属环
        g.add(new Konva.Circle({ x: cx, y: cy, radius: R, stroke: '#5b5b5b', strokeWidth: 2, listening: false }));
    }
}

export default SmokeDetector;
