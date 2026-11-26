import { FireToolBase } from './FireToolBase.js';

/**
 * SmokeGenerator — 消防测试用烟雾发生器
 * 点击切换喷烟；烟雾靠近感烟探测器时触发火警。
 * 静态名称在上方，动态状态在下方。
 */
export class SmokeGenerator extends FireToolBase {
    static TARGET_TYPE = 'SmokeDetector';
    static LABEL = '烟雾发生器';
    static TYPE = 'smoke_generator';

    _recalcGeometry(_config) { this.W = 120; this.H = 150; }
    _probeLocal() { return { x: this.W / 2, y: 28 }; }
    _emitSpec() { return { dx: 0, dy: -1, dist: 78, spread: 26, color: '#b0bec5', r0: 4, r1: 13 }; }

    _initParameters(config) {
        super._initParameters(config);
        this.dwellMs = config.dwellMs || 5000;   // 延迟 5s 触发报警
    }

    _drawStaticParts() {
        const g = this._staticGroup, cx = this.W / 2;
        // 喷口
        g.add(new Konva.Rect({ x: cx - 14, y: 24, width: 28, height: 10, fill: '#607d8b', cornerRadius: 3, listening: false }));
        // 出烟管
        g.add(new Konva.Rect({ x: cx - 8, y: 28, width: 16, height: 54, fill: '#90a4ae', stroke: '#607d8b', strokeWidth: 1.5, cornerRadius: 3 }));
        // 箱体
        g.add(new Konva.Rect({ x: cx - 34, y: 80, width: 68, height: 44, fill: '#546e7a', stroke: '#37474f', strokeWidth: 2, cornerRadius: 6 }));
        // 指示灯
        g.add(new Konva.Circle({ x: cx - 22, y: 102, radius: 5, fill: '#25d425', stroke: '#0c4a0c', strokeWidth: 1, listening: false }));
        g.add(new Konva.Text({ x: cx - 12, y: 96, width: 40, text: 'SMOKE', fontSize: 9, fontStyle: 'bold', fill: '#eceff1', listening: false }));
        this.addClickablePart('nozzle', cx - 16, 20, 32, 22);
    }
}

export default SmokeGenerator;
