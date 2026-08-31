import Konva from 'konva';
import { BaseComponent } from './BaseComponent.js';

/**
 * HvGroundingCable 高压接地线（三相短路接地线 / 检修接地线）
 *
 * 结构（横向放置，左侧操作端、右侧手持端）：
 *   1. 三个相接线夹（竖排）—— 夹持三相母线的金属夹，钳口朝左，
 *      每个钳口为 1 个电气端口（p1/p2/p3）
 *   2. 竖直短接连片 —— 把三个线夹在根部连成一体的铜条（三相短接结构）
 *   3. 三根弯曲金属软线 —— 自每个线夹铰链下方引出，向下弯曲约 200px，
 *      最后汇合短接在下方「接地夹」
 *   4. 接地夹 —— 三根软线汇合的短接夹，钳口 = 1 个电气接地端口（gnd），
 *      夹持船体接地排/接地桩
 *   5. 绝缘连接杆（100px）—— 三个线夹向右经金属过渡接至绝缘操作杆
 *   6. 绝缘手柄 —— 杆右端的红色握持手柄
 *
 * 电气模型：
 *   - type = 'hv_grounding_lead'，四个端口 p1/p2/p3/gnd 内部零电阻短接
 *     （CircuitTopology 特殊处理，等同三相短路接线夹短接到接地夹）；
 *   - 挂上带电母线 → 三相短路接地（符合实物危险特性）；
 *     停电后挂接 → 母线三相接地释放残余电荷（正确检修操作）。
 */
export class HvGroundingCable extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.width  = 250;
        this.height = 325;

        this.type  = 'hv_grounding_lead';
        this.cache = 'fixed';
        this.config = { id: this.id };

        this._initGroups();
        this._init();

        // 电气端口：三个相接线夹钳口（左）与 接地夹钳口（左下）
        this.addPort(-106, -38, 'p1', 'wire');
        this.addPort(-106, 0,   'p2', 'wire');
        this.addPort(-106, 38,  'p3', 'wire');
        this.addPort(-124, 142, 'gnd', 'wire');
    }

    _init() {
        this._drawStaticParts();
    }

    _drawStaticParts() {
        const s = this._staticGroup;
        const metal = '#b9c0c6';
        const copper = '#c0812a';
        const steel = '#9aa4ad';

        // ── 1. 三个相接线夹（竖排，钳口朝左）──
        const clampYs = [-38, 0, 38];
        clampYs.forEach((yc, i) => {
            const id = `p${i + 1}`;
            // 上钳臂 / 下钳臂
            s.add(new Konva.Line({
                points: [-78, yc, -106, yc - 7], stroke: steel, strokeWidth: 3.5,
                lineCap: 'round', name: id,
            }));
            s.add(new Konva.Line({
                points: [-78, yc, -106, yc + 7], stroke: steel, strokeWidth: 3.5,
                lineCap: 'round',
            }));
            // 铰链
            s.add(new Konva.Circle({ x: -78, y: yc, radius: 3.2, fill: metal, stroke: '#6a7278', strokeWidth: 1 }));
            // 压紧弹簧（弧形折线）
            s.add(new Konva.Line({
                points: [-88, yc - 10, -92, yc - 5, -96, yc - 10, -100, yc - 5],
                stroke: '#8a8f95', strokeWidth: 2, lineCap: 'round',
            }));
            // 钳口尖端圆点（端口视觉标识）
            s.add(new Konva.Circle({ x: -106, y: yc, radius: 2.6, fill: copper, stroke: '#6e4a1c', strokeWidth: 1 }));
        });

        // ── 2. 竖直短接连片（铜条，把三个线夹连成一体）──
        s.add(new Konva.Rect({ x: -68, y: -50, width: 8, height: 100, fill: copper, stroke: '#6e4a1c', strokeWidth: 1, cornerRadius: 2 }));
        // 线夹根部到连片的横向小段
        clampYs.forEach(yc => {
            s.add(new Konva.Line({ points: [-78, yc - 12, -72, yc - 12], stroke: metal, strokeWidth: 2.5 }));
            s.add(new Konva.Line({ points: [-78, yc + 12, -72, yc + 12], stroke: metal, strokeWidth: 2.5 }));
        });

        // ── 3. 三根弯曲金属软线（向下约 200px，汇合于接地夹）──
        const wires = [
            { pts: [-78, -18, -86, 30, -98, 80, -106, 115, -110, 135] },
            { pts: [-78, 20, -84, 58, -96, 105, -106, 125, -110, 135] },
            { pts: [-78, 58, -82, 88, -94, 120, -104, 132, -110, 135] },
        ];
        wires.forEach(w => s.add(new Konva.Line({
            points: w.pts, stroke: copper, strokeWidth: 3,
            lineCap: 'round', lineJoin: 'round', tension: 0.5,
        })));

        // ── 4. 接地夹（三线汇合处，钳口朝左下）──
        s.add(new Konva.Line({
            points: [-110, 135, -124, 143], stroke: steel, strokeWidth: 3.5, lineCap: 'round',
        }));
        s.add(new Konva.Line({
            points: [-110, 135, -124, 137], stroke: steel, strokeWidth: 3.5, lineCap: 'round',
        }));
        s.add(new Konva.Circle({ x: -110, y: 135, radius: 3.2, fill: metal, stroke: '#6a7278', strokeWidth: 1 }));
        s.add(new Konva.Circle({ x: -124, y: 140, radius: 2.6, fill: copper, stroke: '#6e4a1c', strokeWidth: 1 }));

        // ── 5. 绝缘连接杆（100px，从出线侧水平向右）──
        // 连片 → 杆 的金属过渡段
        s.add(new Konva.Rect({ x: -60, y: -6, width: 26, height: 12, fill: metal, stroke: '#6a7278', strokeWidth: 1, cornerRadius: 2 }));
        // 绝缘杆体（黄底 + 橙色警示环）
        s.add(new Konva.Rect({ x: -34, y: -10, width: 100, height: 20, fill: '#e0b84c', stroke: '#a8862a', strokeWidth: 1.2, cornerRadius: 3 }));
        [10, 34, 58].forEach(x => s.add(new Konva.Rect({ x, y: -10, width: 7, height: 20, fill: '#d98a2b' })));

        // ── 6. 绝缘手柄（红色握持手柄 + 防脱护环）──
        s.add(new Konva.Rect({ x: 66, y: -13, width: 34, height: 26, fill: '#b5452f', stroke: '#7a2a1a', strokeWidth: 1.2, cornerRadius: 6 }));
        [76, 88].forEach(x => s.add(new Konva.Line({ points: [x, -13, x, 13], stroke: '#8a3522', strokeWidth: 2 })));
        // 护环
        s.add(new Konva.Rect({ x: 61, y: -16, width: 5, height: 32, fill: '#8a8f95', stroke: '#5f666c', strokeWidth: 1, cornerRadius: 2 }));

        // 名称
        s.add(new Konva.Text({
            x: 40, y: -34, width: 90, text: '高压接地线', fontSize: 10,
            fill: '#1a252f', align: 'center', listening: false,
        }));
    }

    getConfigFields() {
        return [
            { label: '器件名称', key: 'id', type: 'text' },
        ];
    }

    onConfigUpdate(cfg) {
        if (cfg.id !== undefined) this.id = cfg.id;
        this.config = { id: this.id };
        this._refreshCache();
    }
}