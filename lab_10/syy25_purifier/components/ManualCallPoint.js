import { DetectorBase } from './DetectorBase.js';

/**
 * ManualCallPoint — 手动报警按钮（CAN 可寻址节点）
 *
 * 视觉：红色壁挂方盒 + 中央可按压面板（按下即产生火警）；
 * CAN 总线接口置于上方（向上与总线连接器引出端口相接）。
 * 尺寸略小于探测器（155×170）。
 */
export class ManualCallPoint extends DetectorBase {
    static TYPE = 'ManualCallPoint';
    static TYPE_CODE = 4;
    static LABEL = '手动报警按钮';
    static ACCENT = '#d32f2f';

    /** 手动报警按钮独立尺寸（略小于探测器 180×195） */
    _recalcGeometry(_config) {
        this.W = 155;
        this.H = 170;
        this._cx = this.W / 2;
        this._cy = 85;
        this._R = 50;
    }

    _drawStaticParts() {
        const g = this._staticGroup;
        const cx = this._cx;
        const bw = 100, bh = 112, bx = cx - bw / 2, by = 18;

        // 顶部总线接口引出短管
        g.add(new Konva.Rect({ x: cx - 9, y: 0, width: 18, height: by, fill: '#e3e7e9', stroke: '#b0bec5', strokeWidth: 1.5, cornerRadius: 3 }));

        // 红色外盒
        g.add(new Konva.Rect({
            x: bx, y: by, width: bw, height: bh,
            fill: '#c62828', stroke: '#7f1d1d', strokeWidth: 2.5, cornerRadius: 9,
        }));
        // 中央可按压面板
        g.add(new Konva.Rect({
            x: bx + 16, y: by + 16, width: bw - 32, height: bh - 40,
            fill: '#e53935', stroke: '#ffffff', strokeWidth: 2, cornerRadius: 6,
        }));
        // 中心按压区（白色圆 + 红色点）
        g.add(new Konva.Circle({ x: cx, y: by + bh / 2 - 6, radius: 18, fill: 'rgba(255,255,255,0.9)', stroke: '#b71c1c', strokeWidth: 1.5, listening: false }));
        g.add(new Konva.Circle({ x: cx, y: by + bh / 2 - 6, radius: 7, fill: '#c62828', listening: false }));
        g.add(new Konva.Text({ x: bx, y: by + bh - 20, width: bw, text: 'PRESS', fontSize: 11, fontStyle: 'bold', fill: '#ffffff', align: 'center', listening: false }));

        // 名称 / 回路防区
        g.add(new Konva.Text({ x: 0, y: this.H - 26, width: this.W, text: this.label, fontSize: 13, fontStyle: 'bold', fill: '#263238', align: 'center' }));
        g.add(new Konva.Text({ x: 0, y: this.H - 10, width: this.W, text: `LOOP${this.loop} · ZONE${this.zone} · #${this.nodeAddress}`, fontSize: 10, fill: '#78909c', align: 'center' }));
    }

    _drawTypeGlyph() { /* 已由 _drawStaticParts 覆盖 */ }

    /** 整块按压面板可点击，按下即报警（再按复位） */
    _bindInteraction() {
        // 整体（供演示箭头指示）
        this.addClickablePart('body', this.W / 2 - 50, 18, 100, 112);
        // 中央按压面板：整块命中并触发报警/复位
        const hit = this.addClickablePart('test', this.W / 2 - 34, 34, 68, 68, true);
        if (hit) hit.on('click tap', (e) => { e.cancelBubble = true; this.toggle(); });
    }

    _createDynamicNodes() {
        const d = this._dynamicGroup;
        this._led = new Konva.Circle({
            x: this.W / 2 + 42, y: 116, radius: 7,
            fill: '#37474f', stroke: '#263238', strokeWidth: 1,
        });
        d.add(this._led);
        this._stateText = new Konva.Text({
            x: 0, y: 134, width: this.W, text: '', fontSize: 11, fontStyle: 'bold', fill: '#455a64', align: 'center',
        });
        d.add(this._stateText);
        this._ledOn = false;
    }
}

export default ManualCallPoint;
