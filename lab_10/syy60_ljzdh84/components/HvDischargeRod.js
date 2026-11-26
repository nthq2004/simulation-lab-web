import Konva from 'konva';
import { BaseComponent } from './BaseComponent.js';

/**
 * HvDischargeRod 高压放电棒（手持验电/放电工具）
 *
 * 结构（自上而下，竖立放置）：
 *   1. 末端弯钩 —— 金属钩，钩尖为电气端口 hook（l 端，碰触带电体）
 *   2. 放电电阻（包在绝缘棒中）—— 橙黄绝缘管内可见色环电阻（默认 10MΩ），
 *      从弯钩一路到连接杆顶部，构成"钩 → 电阻"通路
 *   3. 连接杆 —— 金属长杆，与放电电阻的相接处（金属箍）引出接地线
 *   4. 手柄 —— 红色绝缘手柄（握持部位）
 *   5. 弯曲金属接地线 —— 从连接杆与放电电阻连接处（端口 link = r 端）蜿蜒
 *      引出的铜色导线，末端为电气接地端口（gnd）
 *
 * 电气模型：
 *   - type = 'resistor'，由 DeviceStamps.stampResistors 在 钩端(l) 与 连接处(r)
 *     之间填充 放电电阻 导纳（currentResistance，默认 10MΩ）；
 *   - 连接处(r) 与 接地线末端(gnd) 在拓扑中内部短接（接地线零电阻，
 *     CircuitTopology 对 special='hv_discharge' 特殊处理）；
 *   - gnd 端口对外可接 Ground 组件（并入全局地）。
 *
 * 使用：钩尖碰带电母线（与外端口连线），接地端接地，即构成对地放电回路，
 * 放电电流 = 相电压 / 放电电阻，可观察到监视仪/保护装置读数变化。
 */
export class HvDischargeRod extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.width  = 250;
        this.height = 248;

        this.type  = 'resistor';
        this.special = 'hv_discharge';
        this.cache = 'fixed';
        // 放电电阻阻值（Ω），默认 10MΩ
        this.currentResistance = (config.value !== undefined) ? Math.max(parseFloat(config.value), 1) : 10e6;
        this.config = { id: this.id, value: this.currentResistance };

        this._initGroups();
        this._init();

        // 电气端口：钩尖(l) / 连接处·接地线引出(r) / 接地线末端(向右弯出 200px+, gnd)
        this.addPort(-28, -118, 'l', 'wire');
        this.addPort(18, -30, 'r', 'wire');
        this.addPort(216, -33, 'gnd', 'wire');
    }

    _init() {
        this._drawStaticParts();
    }

    _drawStaticParts() {
        const s = this._staticGroup;
        const steel = '#9aa4ad';

        // ── 1. 末端弯钩（金属钩，钩尖朝左上）──
        s.add(new Konva.Line({
            points: [0, -86, 0, -112, -24, -112, -28, -118],
            stroke: steel, strokeWidth: 4, lineCap: 'round', lineJoin: 'round',
        }));
        s.add(new Konva.Circle({ x: -28, y: -118, radius: 2.6, fill: steel }));

        // ── 2. 绝缘棒（包裹放电电阻）──
        s.add(new Konva.Rect({
            x: -13, y: -86, width: 26, height: 58,
            fill: '#d9852b', stroke: '#8a4a12', strokeWidth: 1.5, cornerRadius: 4,
        }));
        // 棒内放电电阻（色环电阻体）
        s.add(new Konva.Rect({ x: -8, y: -74, width: 16, height: 30, fill: '#a8794a', cornerRadius: 2 }));
        // 端帽
        s.add(new Konva.Rect({ x: -9, y: -75, width: 2.5, height: 32, fill: '#6b4a2a' }));
        s.add(new Konva.Rect({ x: 6.5, y: -75, width: 2.5, height: 32, fill: '#6b4a2a' }));
        // 色环：棕(1) 黑(0) 蓝(×1M) 金 —— 10MΩ
        [{ x: -5.5, c: '#8a5a2a' }, { x: -2, c: '#222222' }, { x: 3, c: '#2a4a8a' }].forEach(r =>
            s.add(new Konva.Rect({ x: r.x - 1.5, y: -74, width: 3, height: 30, fill: r.c }))
        );
        s.add(new Konva.Text({
            x: -12, y: -42, width: 24, text: '10MΩ', fontSize: 8,
            fill: '#f0e0b0', align: 'center', listening: false,
        }));

        // ── 3. 连接杆（金属长杆）──
        s.add(new Konva.Rect({ x: -5, y: -28, width: 10, height: 70, fill: '#b9c0c6', stroke: '#7a8288', strokeWidth: 1 }));
        s.add(new Konva.Rect({ x: -5, y: -28, width: 3, height: 70, fill: '#e4e8ec', opacity: 0.6 }));

        // ── 4. 连接处金属箍（连接杆 与 放电电阻棒 相接处）──
        s.add(new Konva.Rect({
            x: -12, y: -34, width: 24, height: 10,
            fill: '#b07a3a', stroke: '#6e4a1c', strokeWidth: 1, cornerRadius: 2,
        }));

        // ── 5. 手柄（红色绝缘手柄，握持横纹）──
        s.add(new Konva.Rect({
            x: -13, y: 42, width: 26, height: 64,
            fill: '#b5452f', stroke: '#7a2a1a', strokeWidth: 1.2, cornerRadius: 5,
        }));
        [60, 76, 92].forEach(y => s.add(new Konva.Line({ points: [-13, y, 13, y], stroke: '#8a3522', strokeWidth: 2 })));

        // ── 6. 弯曲金属接地线：自连接处向右弯出，蜿蜒延伸 200px+，末端为接地端口 ──
        s.add(new Konva.Line({
            points: [16, -32, 60, -44, 100, -26, 140, -40, 180, -26, 216, -33],
            stroke: '#c0812a', strokeWidth: 3, lineCap: 'round', lineJoin: 'round', tension: 0.45,
        }));

        // 名称
        s.add(new Konva.Text({
            x: -35, y: 114, width: 70, text: '高压放电棒', fontSize: 10,
            fill: '#1a252f', align: 'center', listening: false,
        }));
    }

    getConfigFields() {
        return [
            { label: '器件名称', key: 'id', type: 'text' },
            { label: '放电电阻 (Ω)', key: 'value', type: 'number', min: 1 },
        ];
    }

    onConfigUpdate(cfg) {
        if (cfg.id !== undefined) this.id = cfg.id;
        if (cfg.value !== undefined) {
            this.currentResistance = Math.max(parseFloat(cfg.value), 1);
        }
        this.config = { id: this.id, value: this.currentResistance };
        this._refreshCache();
    }

    /** 供求解器读取的阻值 */
    getValue() {
        return this.currentResistance;
    }
}