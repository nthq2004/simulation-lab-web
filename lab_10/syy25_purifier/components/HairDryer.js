import { FireToolBase } from './FireToolBase.js';

/**
 * HairDryer — 消防测试用电吹风
 * 点击切换热风；热风对着感温探测器持续吹 30s 触发火警。
 * 静态名称在上方，动态状态在下方。
 */
export class HairDryer extends FireToolBase {
    static TARGET_TYPE = 'HeatDetector';
    static LABEL = '电吹风';
    static TYPE = 'hair_dryer';

    _recalcGeometry(_config) { this.W = 150; this.H = 145; }
    _probeLocal() { return { x: 8, y: 70 }; }
    _emitSpec() { return { dx: -1, dy: 0, dist: 88, spread: 20, color: '#ffd27f', r0: 3, r1: 9 }; }

    _initParameters(config) {
        super._initParameters(config);
        this.dwellMs = config.dwellMs || 8000;   // 需持续吹风 8s
    }

    _drawStaticParts() {
        const g = this._staticGroup, cx = this.W / 2, cy = 70;
        // 静态名称（下移靠近风筒）
        g.add(new Konva.Text({ x: 0, y: 34, width: this.W, text: this.label, fontSize: 13, fontStyle: 'bold', fill: '#263238', align: 'center' }));
        // 风筒
        g.add(new Konva.Rect({ x: 22, y: cy - 18, width: 98, height: 36, fill: '#4a90e2', stroke: '#2c5f9e', strokeWidth: 2, cornerRadius: 14 }));
        for (let i = 0; i < 4; i++) g.add(new Konva.Line({ points: [108 + i * 6, cy - 12, 108 + i * 6, cy + 12], stroke: '#2c5f9e', strokeWidth: 2, listening: false }));
        // 出风嘴
        g.add(new Konva.Line({ points: [22, cy - 18, 8, cy - 12, 8, cy + 12, 22, cy + 18], closed: true, fill: '#9aa3a8', stroke: '#607d8b', strokeWidth: 1.5, listening: false }));
        // 手柄
        g.add(new Konva.Rect({ x: cx + 4, y: cy + 16, width: 24, height: 36, fill: '#4a90e2', stroke: '#2c5f9e', strokeWidth: 2, cornerRadius: 6 }));
        g.add(new Konva.Circle({ x: cx + 16, y: cy + 26, radius: 5, fill: '#e74c3c', stroke: '#7f1d1d', strokeWidth: 1, listening: false }));
        this.addClickablePart('nozzle', 4, cy - 16, 26, 34);
    }
}

export default HairDryer;
