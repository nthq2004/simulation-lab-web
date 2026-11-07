import { DetectorBase } from './DetectorBase.js';

/**
 * HeatDetector — 感温探测器（CAN 可寻址节点）
 * 中央绘制温度计符号。
 */
export class HeatDetector extends DetectorBase {
    static TYPE = 'HeatDetector';
    static TYPE_CODE = 3;
    static LABEL = '感温探测器';
    static ACCENT = '#f9a825';

    _drawTypeGlyph(g, cx, cy) {
        const tw = 9, th = 36;
        // 管身
        g.add(new Konva.Rect({
            x: cx - tw / 2, y: cy - th / 2 - 6, width: tw, height: th,
            fill: '#ffffff', stroke: '#607d8b', strokeWidth: 1.5, cornerRadius: tw / 2, listening: false,
        }));
        // 感温球
        g.add(new Konva.Circle({ x: cx, y: cy + th / 2 - 3, radius: 8, fill: '#e53935', stroke: '#b71c1c', strokeWidth: 1.5, listening: false }));
        // 汞柱
        g.add(new Konva.Rect({ x: cx - 2, y: cy - 2, width: 4, height: th / 2 + 3, fill: '#e53935', listening: false }));
        // 刻度
        for (let i = 0; i < 4; i++) {
            const y = cy - th / 2 - 2 + i * 7;
            g.add(new Konva.Line({ points: [cx + 7, y, cx + 12, y], stroke: '#90a4ae', strokeWidth: 1, listening: false }));
        }
    }
}

export default HeatDetector;
