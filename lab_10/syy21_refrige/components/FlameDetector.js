import { DetectorBase } from './DetectorBase.js';

/**
 * FlameDetector — 感光（紫外火焰）探测器（CAN 可寻址节点）
 * 中央绘制横向的紫外线管。
 */
export class FlameDetector extends DetectorBase {
    static TYPE = 'FlameDetector';
    static TYPE_CODE = 2;
    static LABEL = '感光探测器';
    static ACCENT = '#7e57c2';

    _drawTypeGlyph(g, cx, cy) {
        const w = 50, h = 13;
        // 玻璃管
        g.add(new Konva.Rect({
            x: cx - w / 2, y: cy - h / 2, width: w, height: h,
            fill: '#c9b6f0', stroke: '#5e35b1', strokeWidth: 1.5, cornerRadius: h / 2, listening: false,
        }));
        // 两端电极
        g.add(new Konva.Rect({ x: cx - w / 2, y: cy - h / 2 + 1.5, width: 6, height: h - 3, fill: '#4527a0', cornerRadius: 2, listening: false }));
        g.add(new Konva.Rect({ x: cx + w / 2 - 6, y: cy - h / 2 + 1.5, width: 6, height: h - 3, fill: '#4527a0', cornerRadius: 2, listening: false }));
        // 管内紫外辉光
        g.add(new Konva.Line({ points: [cx - w / 2 + 9, cy, cx + w / 2 - 9, cy], stroke: '#7e57c2', strokeWidth: 4, lineCap: 'round', listening: false }));
        // 两侧引线
        g.add(new Konva.Line({ points: [cx - w / 2 - 8, cy, cx - w / 2, cy], stroke: '#4527a0', strokeWidth: 2, listening: false }));
        g.add(new Konva.Line({ points: [cx + w / 2, cy, cx + w / 2 + 8, cy], stroke: '#4527a0', strokeWidth: 2, listening: false }));
    }
}

export default FlameDetector;
