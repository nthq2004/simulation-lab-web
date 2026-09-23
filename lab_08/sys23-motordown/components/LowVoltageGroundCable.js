import Konva from 'konva';
import { BaseComponent } from './BaseComponent.js';

/**
 * LowVoltageGroundCable 低压临时接地线（三相短路接地线 / 检修接地线）
 *
 * 结构（竖向放置，上方操作端、下方接地端）：
 *   1. 三个相接线夹（横排）—— 夹持低压三相母线的金属夹，钳口朝上，
 *      每个钳口为 1 个电气端口（p1/p2/p3）
 *   2. 竖直短接连片 —— 把三个线夹在根部连成一体的铜条（三相短接结构）
 *   3. 三根弯曲金属软线 —— 自每个线夹铰链下方引出，向下弯曲，
 *      最后汇合短接在下方「接地线夹」
 *   4. 接地线夹 —— 三根软线汇合的短接夹，钳口 = 1 个电气接地端口（gnd），
 *      夹持接地母排/接地桩
 *
 * 电气模型：
 *   - type = 'lv_grounding_lead'，四个端口 p1/p2/p3/gnd 内部零电阻短接
 *     （CircuitTopology 特殊处理，等同三相短接 → 接地夹 → 大地）；
 *   - 单个接线夹挂上带电母线 → 该相经大地短路（危险特性）；
 *     停电检修时挂接 → 母线三相接地释放残余电荷（正确检修操作）。
 */
export class LowVoltageGroundCable extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.width  = 220;
        this.height = 260;

        this.type  = 'lv_grounding_lead';
        this.cache = 'fixed';
        this.config = { id: this.id, label: this.label || '低压临时接地线' };

        this._initGroups();
        this._init();

        // 电气端口：三个相接线夹钳口（上）与 接地夹钳口（下）
        this.addPort(-62, -104, 'p1', 'wire');
        this.addPort(0,   -104, 'p2', 'wire');
        this.addPort(62,  -104, 'p3', 'wire');
        this.addPort(0,   128,  'gnd', 'wire');
    }

    _init() {
        this._drawStaticParts();
        this._addHitArea();
        this._addClickableParts();
    }

    /**
     * 透明命中层：本组件无自定义 interaction 需求，机身各绘制节点保持默认
     * listening 已可拖动；额外放置透明命中矩形兜底，确保大面积可点。
     */
    _addHitArea() {
        if (this._hitRect) return;
        this._hitRect = new Konva.Rect({
            x: -this.width / 2, y: -this.height / 2,
            width: this.width, height: this.height,
            fill: '#ffffff', opacity: 0.002, listening: true,
        });
        this.group.add(this._hitRect);
        this._hitRect.moveToBottom();
    }

    // ═══════════════════════════════════════════
    // 可点击部件（供工作流 find 步骤识别）
    // ═══════════════════════════════════════════

    _addClickableParts() {
        const clampXs = [-62, 0, 62];
        // 三个相接线夹（钳口朝上）
        clampXs.forEach((xc, i) => {
            this.addClickablePart(`clamp-p${i + 1}`, xc - 14, -110, 28, 40);
        });
        // 接地线夹（底部三线汇合夹）
        this.addClickablePart('ground-clamp', -16, 100, 32, 32);
        // 绝缘操作手柄（红色标识区）
        this.addClickablePart('handle', -34, 148, 68, 26);
        // 三根铜软线（整体识别区）
        this.addClickablePart('soft-wires', -92, -70, 184, 180);
    }

    getClickablePartCenter(partId) {
        const gx = this.group ? this.group.x() : 0;
        const gy = this.group ? this.group.y() : 0;
        const lit = /^clamp-p(\d)$/.exec(partId);
        if (lit) {
            const xc = [-62, 0, 62][parseInt(lit[1]) - 1];
            return { x: gx + xc, y: gy - 98 };
        }
        const rel = {
            'ground-clamp': { x: 0, y: 114 },
            'handle': { x: 0, y: 160 },
            'soft-wires': { x: 0, y: 10 },
        };
        const p = rel[partId];
        return p ? { x: gx + p.x, y: gy + p.y } : null;
    }

    _drawStaticParts() {
        const s = this._staticGroup;
        const metal   = '#b9c0c6';
        const copper  = '#c0812a';
        const steel   = '#9aa4ad';
        const insul   = '#d98a2b';   // 绝缘软管（黄/橙）

        // ── 1. 三个相接线夹（横排，钳口朝上）──
        const clampXs = [-62, 0, 62];
        clampXs.forEach((xc, i) => {
            const id = `p${i + 1}`;
            // 左钳臂 / 右钳臂（V 形钳口，朝上）
            s.add(new Konva.Line({
                points: [xc, -76, xc - 7, -104], stroke: steel, strokeWidth: 3.5,
                lineCap: 'round', name: id,
            }));
            s.add(new Konva.Line({
                points: [xc, -76, xc + 7, -104], stroke: steel, strokeWidth: 3.5,
                lineCap: 'round',
            }));
            // 铰链
            s.add(new Konva.Circle({ x: xc, y: -76, radius: 3.2, fill: metal, stroke: '#6a7278', strokeWidth: 1 }));
            // 压紧弹簧（弧形折线）
            s.add(new Konva.Line({
                points: [xc - 10, -86, xc - 5, -90, xc - 10, -94, xc - 5, -98],
                stroke: '#8a8f95', strokeWidth: 2, lineCap: 'round',
            }));
            // 钳口尖端圆点（端口视觉标识）
            s.add(new Konva.Circle({ x: xc, y: -104, radius: 2.8, fill: copper, stroke: '#6e4a1c', strokeWidth: 1 }));
        });

        // ── 2. 竖直短接连片（铜条，把三个线夹连成一体）──
 
        // 线夹根部到连片的横向小段
        clampXs.forEach(xc => {
            s.add(new Konva.Line({ points: [xc - 12, -70, xc - 12, -76], stroke: metal, strokeWidth: 2.5 }));
            s.add(new Konva.Line({ points: [xc + 12, -70, xc + 12, -76], stroke: metal, strokeWidth: 2.5 }));
        });

        // ── 3. 三根弯曲金属软线（向下约 170px，汇合于接地线夹）──
        const wires = [
            { pts: [-62, -76, -70, -10, -82, 30, -88, 70, -30, 108] },
            { pts: [0,   -76, -4,  -8, -6,  32, -6,  72,  0,  118] },
            { pts: [62,  -76, 70,  -10, 82,  30, 88,  70,  30, 108] },
        ];
        wires.forEach(w => s.add(new Konva.Line({
            points: w.pts, stroke: copper, strokeWidth: 3,
            lineCap: 'round', lineJoin: 'round', tension: 0.5,
        })));

        // ── 4. 接地线夹（三线汇合处，钳口朝下/左）──
        s.add(new Konva.Line({
            points: [-30, 108, 0, 118], stroke: steel, strokeWidth: 3.5, lineCap: 'round',
        }));
        s.add(new Konva.Line({
            points: [30, 108, 0, 118], stroke: steel, strokeWidth: 3.5, lineCap: 'round',
        }));
        s.add(new Konva.Circle({ x: 0, y: 118, radius: 3.2, fill: metal, stroke: '#6a7278', strokeWidth: 1 }));
        s.add(new Konva.Circle({ x: 0, y: 128, radius: 2.8, fill: copper, stroke: '#6e4a1c', strokeWidth: 1 }));

        // ── 5. 标识／把手（低压操作手柄）──

        // 名称
        s.add(new Konva.Text({
            x: -64, y: 140, width: 128, text: '低压临时接地线',
            fontSize: 15, fontStyle: 'bold', fill: '#1a252f',
            align: 'center', listening: false,
        }));
    }

    getConfigFields() {
        return [
            { label: '器件名称', key: 'label', type: 'text' },
        ];
    }

    onConfigUpdate(cfg) {
        if (cfg.label !== undefined) this.label = cfg.label;
        this.config = { id: this.id, label: this.label };
        this._refreshCache();
    }
}