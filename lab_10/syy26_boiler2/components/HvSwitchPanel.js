import { BaseComponent } from './BaseComponent.js';

/**
 * HvSwitchPanel 高压配电柜组件图
 *
 * 从左到右 8 个柜：母线接地柜、变压器馈电柜、推进馈电柜、1#发电机控制柜、
 * 2#发电机控制柜、并车柜、母联开关柜、省略号柜（右侧 3#发电机起对称省略）。
 *
 * 每柜分上/中/下三段：
 *   - 上部（1/2 高）：仪表、指示灯、操作按钮、转换开关
 *   - 中部（1/4 高）：断路器手车（含摇柄插入孔）
 *   - 下部（1/4 高）：该柜单线图（汇流排、高压断路器、接地开关，
 *     参照微机综合保护装置 F4 单线图：断路器竖直单刀、接地开关水平刀）
 */
const CAB_W = 225;
const CAB_H = 813;
const UPPER_H = 325;
const MID_H = 162;
const LOWER_H = 326;
const COLORS = ['#e03030', '#20a030', '#2050e0', '#d09000', '#8a3ab0'];

const CABINETS = [
    { id: 'ground', label: '母线接地柜', low: 'ground', gen: false },
    { id: 'tr',     label: '变压器馈电柜', low: 'tr', gen: false },
    { id: 'prop',   label: '推进馈电柜', low: 'prop', gen: false },
    { id: 'gen1',   label: '1#发电机控制柜', low: 'gen', gen: true },
    { id: 'gen2',   label: '2#发电机控制柜', low: 'gen', gen: true },
    { id: 'sync',   label: '并车柜', low: 'sync', gen: false },
    { id: 'tie',    label: '母联开关柜', low: 'tie', gen: false },
    { id: 'ellipsis', label: '…', low: 'ellipsis', gen: false },
];

export class HvSwitchPanel extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);
        this.width  = CAB_W * CABINETS.length;
        this.height = CAB_H;
        this.type  = 'hv_switch_panel';
        this.cache = 'fixed';
        this._initGroups();
        this._init();
        // 母联柜交互状态
        this._tieClosed = false;      // 母联开关：默认断开
        this._leftLive  = false;      // 左母线带电（外部可设置）
        this._rightLive = false;      // 右母线带电（左母线带电 && 母联合闸）
        this._cabGround = { ground: false, tr: false, prop: false, gen1: false, gen2: false };  // 各柜接地开关独立
        this._cbState = { tr: false, prop: false, gen1: false, gen2: false };   // 各柜真空断路器状态（默认分闸）
        this._cbRun = { gen1: false, gen2: false };   // 发电机运行状态（默认停止）
        this._ledTestT = 0;           // 带电显示测试倒计时 s
        this._autoSyncT = { gen1: 0, gen2: 0 };   // 自动并车 3s 延时计时
        this._autoSyncLed = { gen1: false, gen2: false };   // 自动并车灯（亮绿）
        this._autoSplitLed = { gen1: false, gen2: false };  // 自动解列灯（亮红）
        this._syncAngle = 0;          // 同步表指针角度（0°=12 点，顺时针）
        this._autoFlow = null;        // 自动模式并车流程 {stage:'start'|'cb', t, target}
        this._unloadFlow = null;      // 空载自动卸载流程 {stage:'split'|'stop', t, target}
    }

    /** 外部设置左母线带电状态 */
    setLeftBusLive(v) { this._leftLive = !!v; }

    _init() {
        CABINETS.forEach((cab, i) => this._drawCabinet(cab, i));
        this._bindTieButtons();
        this._bindSyncSwitches();
    }

    // ── 单个柜 ──
    _drawCabinet(cab, idx) {
        const s = this._staticGroup;
        const x0 = idx * CAB_W;

        // 柜体
        s.add(new Konva.Rect({
            x: x0 + 2, y: 2, width: CAB_W - 4, height: CAB_H - 4,
            fill: '#e8ecef', stroke: '#4a5a66', strokeWidth: 1.5, cornerRadius: 2,
        }));
        // 柜标签
        s.add(new Konva.Text({
            x: x0, y: 14, width: CAB_W, align: 'center',
            text: cab.label, fontSize: 16, fontStyle: 'bold', fill: '#006400', listening: false,
        }));

        // 段分隔线
        s.add(new Konva.Line({ points: [x0 + 4, UPPER_H, x0 + CAB_W - 4, UPPER_H], stroke: '#7a8494', strokeWidth: 1 }));
        s.add(new Konva.Line({ points: [x0 + 4, UPPER_H + MID_H, x0 + CAB_W - 4, UPPER_H + MID_H], stroke: '#7a8494', strokeWidth: 1 }));

        // 柜间分隔（粗线）
        if (idx > 0) {
            s.add(new Konva.Line({ points: [x0, 2, x0, CAB_H - 2], stroke: '#2c3a45', strokeWidth: 3 }));
        }

        this._drawUpper(cab, x0);
        this._drawMid(cab, x0);
        this._drawLow(cab, x0);
    }

    // ── 上部：仪表 / 指示灯 / 按钮 / 转换开关 ──
    _drawUpper(cab, x0) {
        const s = this._staticGroup;
        // ── 第 1 排（最上）：仪表（整体下移 40px）──
        const meters = cab.gen ? ['V', 'A', 'Hz'] : ['V', 'A'];
        meters.forEach((m, i) => {
            const mx = x0 + 42 + i * 58;
            const cy = 82;
            s.add(new Konva.Circle({ x: mx, y: cy, radius: 22, fill: '#f4f6f8', stroke: '#2c3a45', strokeWidth: 1.5 }));
            s.add(new Konva.Line({ points: [mx, cy, mx + 12 * Math.cos(-2), cy + 12 * Math.sin(-2)], stroke: '#d03030', strokeWidth: 2, lineCap: 'round' }));
            // 文字从圆中心下移 10px（原 cy-8 → cy+4）
            s.add(new Konva.Text({ x: mx - 10, y: cy + 4, width: 20, text: m, fontSize: 12, fontStyle: 'bold', fill: '#1a252f', align: 'center', listening: false }));
        });
        // ── 第 2 排：方形指示灯（下移 40px）──
        const d2 = this._dynamicGroup;
        if (cab.id === 'ground') {
            // 母线接地柜：高压带电显示器（3 圆形灯 r=29，A黄/B绿/C红）+ 测试按钮 + 接地合/开圆灯
            this._tieLeds = [];
            const ledColors = ['#ffcc00', '#2eff3e', '#ff3344'];
            ['A', 'B', 'C'].forEach((ph, i) => {
                const cx = x0 + 30 + i * 34;
                const led = new Konva.Circle({ x: cx, y: 140, radius: 12, fill: '#3a3a3a', stroke: '#1a252f', strokeWidth: 1.5 });
                const txt = new Konva.Text({ x: cx - 12, y: 154, width: 24, text: ph, fontSize: 9, fontStyle: 'bold', fill: '#999', align: 'center', listening: false });
                d2.add(led, txt);
                this._tieLeds.push({ led, txt, color: ledColors[i] });
            });
            // 测试按钮：与带电灯同一排（y=140），r=15，绿色，左移 10px
            this._tieTestBtn = new Konva.Circle({ x: x0 + 155, y: 140, radius: 15, fill: '#2e7d32', stroke: '#1a252f', strokeWidth: 1.5 });
            d2.add(this._tieTestBtn);
            s.add(new Konva.Text({ x: x0 + 139, y: 158, width: 32, text: '测试', fontSize: 9, fill: '#333', align: 'center', listening: false }));
            // 接地圆灯（接地合/接地开）：与其它屏起动/停止按钮对齐（y=208），r=15
            this._groundLedG = new Konva.Circle({ x: x0 + 45, y: 208, radius: 15, fill: '#3a3a3a', stroke: '#1a252f', strokeWidth: 1.5 });
            this._groundLedR = new Konva.Circle({ x: x0 + 155, y: 208, radius: 15, fill: '#3a3a3a', stroke: '#1a252f', strokeWidth: 1.5 });
            d2.add(this._groundLedG, this._groundLedR);
            s.add(new Konva.Text({ x: x0 + 20, y: 226, width: 50, text: '接地合', fontSize: 9, fill: '#333', align: 'center', listening: false }));
            s.add(new Konva.Text({ x: x0 + 130, y: 226, width: 50, text: '接地开', fontSize: 9, fill: '#333', align: 'center', listening: false }));
        } else if (cab.id === 'tie' || cab.id === 'tr' || cab.id === 'prop') {
            // 母联/变压器/推进柜：绿（闭合）/红（断开）方形灯
            const ledG = new Konva.Rect({ x: x0 + 28, y: 138, width: 22, height: 22, fill: '#2eff3e', stroke: '#1a252f', strokeWidth: 1, cornerRadius: 2 });
            const ledR = new Konva.Rect({ x: x0 + 62, y: 138, width: 22, height: 22, fill: '#ff3344', stroke: '#1a252f', strokeWidth: 1, cornerRadius: 2 });
            d2.add(ledG, ledR);
            if (cab.id === 'tie') { this._tieLedG = ledG; this._tieLedR = ledR; }
            else {
                if (!this._cbLed) this._cbLed = {};
                this._cbLed[cab.id] = { g: ledG, r: ledR };
            }
        } else if (cab.low === 'gen') {
            // 发电机控制柜：白（运行）/绿（合闸）/红（分闸）方形灯 22×22
            const ledRun = new Konva.Rect({ x: x0 + 14, y: 138, width: 22, height: 22, fill: '#ffffff', stroke: '#1a252f', strokeWidth: 1, cornerRadius: 2 });
            const ledG = new Konva.Rect({ x: x0 + 50, y: 138, width: 22, height: 22, fill: '#2eff3e', stroke: '#1a252f', strokeWidth: 1, cornerRadius: 2 });
            const ledR = new Konva.Rect({ x: x0 + 86, y: 138, width: 22, height: 22, fill: '#ff3344', stroke: '#1a252f', strokeWidth: 1, cornerRadius: 2 });
            d2.add(ledRun, ledG, ledR);
            if (!this._cbLed) this._cbLed = {};
            this._cbLed[cab.id] = { run: ledRun, g: ledG, r: ledR };
            s.add(new Konva.Text({ x: x0 + 8, y: 164, width: 34, text: '运行', fontSize: 8, fill: '#333', align: 'center', listening: false }));
            s.add(new Konva.Text({ x: x0 + 44, y: 164, width: 34, text: '合闸', fontSize: 8, fill: '#333', align: 'center', listening: false }));
            s.add(new Konva.Text({ x: x0 + 80, y: 164, width: 34, text: '分闸', fontSize: 8, fill: '#333', align: 'center', listening: false }));
        } else {
            const ledColors = ['#2e8b2e', '#d09000', '#d03030'];
            ledColors.forEach((c, i) => {
                s.add(new Konva.Rect({ x: x0 + 26 + i * 20, y: 140, width: 11, height: 11, fill: c, stroke: '#1a252f', strokeWidth: 1, cornerRadius: 1 }));
            });
        }
        // ── 第 3 排：按钮（下移 40px）──
        if (cab.id === 'tie' || cab.id === 'tr' || cab.id === 'prop') {
            // 母联/变压器/推进柜：合闸 / 分闸按钮（半径 15，文字 11px）
            s.add(new Konva.Circle({ x: x0 + 35, y: 208, radius: 15, fill: '#2e7d32', stroke: '#1a252f', strokeWidth: 1.5 }));
            s.add(new Konva.Text({ x: x0 + 17, y: 226, width: 36, text: '合闸', fontSize: 11, fontStyle: 'bold', fill: '#1a252f', align: 'center', listening: false }));
            s.add(new Konva.Circle({ x: x0 + 85, y: 208, radius: 15, fill: '#b71c1c', stroke: '#1a252f', strokeWidth: 1.5 }));
            s.add(new Konva.Text({ x: x0 + 67, y: 226, width: 36, text: '分闸', fontSize: 11, fontStyle: 'bold', fill: '#1a252f', align: 'center', listening: false }));
        } else if (cab.id === 'sync') {
            // 并车柜：三个选择开关（模式 / 备用顺序 / 同步表选择），半径 22，可交互
            const R = 22;
            const d = this._dynamicGroup;
            this._syncKnobs = {};
            const mkKnob = (cx, cy, ang) => {
                const g = new Konva.Group({ x: cx, y: cy, rotation: ang });
                g.add(new Konva.Circle({ x: 0, y: 0, radius: R, fill: '#cfd8df', stroke: '#2c3a45', strokeWidth: 1.5 }));
                g.add(new Konva.Line({ points: [0, 0, 0, -20], stroke: '#38404f', strokeWidth: 3, lineCap: 'round' }));   // 手柄长 20
                d.add(g);
                return g;
            };
            // ── 第 2 排右侧：同步表选择开关（与指示灯同排对齐）──
            const sy = 140;
            this._syncKnobs.sync = mkKnob(x0 + 138, sy, -90);
            this._syncLabels = this._syncLabels || {};
            this._syncLabels.sync = [
                { ang: -90, node: this.__mkSyncText(s, { x: x0 + 88, y: sy + 2, width: 32, text: 'OFF', fontSize: 10, fill: '#333', align: 'center', listening: false }) },
                { ang: -45, node: this.__mkSyncText(s, { x: x0 + 96, y: sy - 23, width: 32, text: '1#', fontSize: 10, fill: '#333', align: 'center', listening: false }) },
                { ang: 0,   node: this.__mkSyncText(s, { x: x0 + 120, y: sy - 34, width: 32, text: '2#', fontSize: 10, fill: '#333', align: 'center', listening: false }) },
                { ang: 45,  node: this.__mkSyncText(s, { x: x0 + 146, y: sy - 23, width: 32, text: '3#', fontSize: 10, fill: '#333', align: 'center', listening: false }) },
                { ang: 90,  node: this.__mkSyncText(s, { x: x0 + 150, y: sy + 2, width: 32, text: '4#', fontSize: 10, fill: '#333', align: 'center', listening: false }) },
            ];
            // ── 第 3 排：模式开关（左）+ 备用顺序开关（右）──
            const swY = 218;
            this._syncKnobs.mode = mkKnob(x0 + 50, swY, 0);
            this._syncLabels.mode = [
                { ang: -90, node: this.__mkSyncText(s, { x: x0 + 10, y: swY + 20, width: 40, text: '半自动', fontSize: 10, fill: '#333', align: 'center', listening: false }) },
                { ang: 0,   node: this.__mkSyncText(s, { x: x0 + 38, y: swY - 34, width: 24, text: '手动', fontSize: 10, fill: '#333', align: 'center', listening: false }) },
                { ang: 90,  node: this.__mkSyncText(s, { x: x0 + 48, y: swY + 20, width: 40, text: '自动', fontSize: 10, fill: '#333', align: 'center', listening: false }) },
            ];
            this._syncKnobs.seq = mkKnob(x0 + 138, swY, -90);
            this._syncLabels.seq = [
                { ang: -90, node: this.__mkSyncText(s, { x: x0 + 90, y: swY + 20, width: 46, text: '1-2-3-4', fontSize: 10, fill: '#333', align: 'center', listening: false }) },
                { ang: 0,   node: this.__mkSyncText(s, { x: x0 + 116, y: swY - 32, width: 46, text: '2-1-4-3', fontSize: 10, fill: '#333', align: 'center', listening: false }) },
                { ang: 90,  node: this.__mkSyncText(s, { x: x0 + 140, y: swY + 20, width: 46, text: '3-4-1-2', fontSize: 10, fill: '#333', align: 'center', listening: false }) },
            ];
        } else if (cab.low === 'gen') {
            // 发电机控制柜：4 按钮（起动/停止/合闸/分闸，r=15）对称分布 + 下方 2 带灯按钮（自动并车/自动解列）
            const bY = 208, R = 15;
            const bxs = [52.5, 92.5, 132.5, 172.5];   // 相对柜中心(112.5)对称
            const bcol = ['#2e7d32', '#b71c1c', '#2e7d32', '#b71c1c'];
            const blbl = ['起动', '停止', '合闸', '分闸'];
            bxs.forEach((bx, i) => {
                s.add(new Konva.Circle({ x: x0 + bx, y: bY, radius: R, fill: bcol[i], stroke: '#1a252f', strokeWidth: 1.5 }));
                s.add(new Konva.Text({ x: x0 + bx - 20, y: 226, width: 40, text: blbl[i], fontSize: 9, fontStyle: 'bold', fill: '#1a252f', align: 'center', listening: false }));
            });
            // 带灯按钮：自动并车（绿）/ 自动解列（红），按钮下方一排对称
            const ay = bY + 57, ar = 13;
            const d2 = this._dynamicGroup;
            if (!this._autoSyncLeds) this._autoSyncLeds = {};
            if (!this._autoSplitLeds) this._autoSplitLeds = {};
            s.add(new Konva.Circle({ x: x0 + 72.5, y: ay, radius: ar, fill: '#2e7d32', stroke: '#1a252f', strokeWidth: 1.5 }));
            this._autoSyncLeds[cab.id] = new Konva.Circle({ x: x0 + 72.5, y: ay, radius: 5, fill: '#3a3a3a', stroke: '#1a252f', strokeWidth: 1 });
            d2.add(this._autoSyncLeds[cab.id]);
            s.add(new Konva.Text({ x: x0 + 42.5, y: ay + 17, width: 60, text: '自动并车', fontSize: 9, fontStyle: 'bold', fill: '#1a252f', align: 'center', listening: false }));
            s.add(new Konva.Circle({ x: x0 + 152.5, y: ay, radius: ar, fill: '#b71c1c', stroke: '#1a252f', strokeWidth: 1.5 }));
            this._autoSplitLeds[cab.id] = new Konva.Circle({ x: x0 + 152.5, y: ay, radius: 5, fill: '#3a3a3a', stroke: '#1a252f', strokeWidth: 1 });
            d2.add(this._autoSplitLeds[cab.id]);
            s.add(new Konva.Text({ x: x0 + 122.5, y: ay + 17, width: 60, text: '自动解列', fontSize: 9, fontStyle: 'bold', fill: '#1a252f', align: 'center', listening: false }));
        } else {
            // 起动/停止/转换（母线接地柜、省略号柜不画）
            if (cab.id !== 'ground' && cab.id !== 'ellipsis') {
                s.add(new Konva.Circle({ x: x0 + 40, y: 208, radius: 9, fill: '#2e7d32', stroke: '#1a252f', strokeWidth: 1.5 }));
                s.add(new Konva.Text({ x: x0 + 24, y: 222, width: 32, text: '起动', fontSize: 8, fill: '#333', align: 'center', listening: false }));
                s.add(new Konva.Circle({ x: x0 + 74, y: 208, radius: 9, fill: '#b71c1c', stroke: '#1a252f', strokeWidth: 1.5 }));
                s.add(new Konva.Text({ x: x0 + 58, y: 222, width: 32, text: '停止', fontSize: 8, fill: '#333', align: 'center', listening: false }));
                // 转换开关（旋钮，右侧）
                s.add(new Konva.Circle({ x: x0 + 130, y: 208, radius: 12, fill: '#cfd8df', stroke: '#2c3a45', strokeWidth: 1.5 }));
                s.add(new Konva.Line({ points: [x0 + 130, 208, x0 + 130, 198], stroke: '#38404f', strokeWidth: 3, lineCap: 'round' }));
                s.add(new Konva.Text({ x: x0 + 112, y: 224, width: 36, text: '转换', fontSize: 8, fill: '#333', align: 'center', listening: false }));
            }
        }
        // （手车位置指示标注已删除）
    }

    // ── 中部：断路器手车（含摇柄插入孔）──
    _drawMid(cab, x0) {
        const s = this._staticGroup;
        if (cab.id === 'ellipsis') {
            s.add(new Konva.Text({ x: x0, y: UPPER_H + MID_H / 2 - 20, width: CAB_W, text: '省略号柜\n（3#发电机控制柜起对称）', fontSize: 12, fill: '#666', align: 'center', lineHeight: 1.4, listening: false }));
            return;
        }
        const my = UPPER_H + 10;
        const hasBreaker = cab.low !== 'ground' && cab.low !== 'sync';   // 接地柜/并车柜无真空断路器
        // 手车外框
        s.add(new Konva.Rect({
            x: x0 + 20, y: my, width: CAB_W - 40, height: MID_H - 24,
            fill: '#dfe3e7', stroke: '#2c3a45', strokeWidth: 1.5, cornerRadius: 3,
        }));
        if (!hasBreaker) {
            // 无真空断路器：显示"无断路器"
            s.add(new Konva.Text({ x: x0 + 20, y: my + MID_H / 2 - 18, width: CAB_W - 40, text: '无真空断路器', fontSize: 10, fill: '#888', align: 'center', listening: false }));
            return;
        }
        // 手车内断路器符号（竖直单刀）
        const cx = x0 + CAB_W / 2;
        const cy = my + (MID_H - 24) / 2;
        s.add(new Konva.Line({ points: [cx, cy - 18, cx, cy + 18], stroke: '#1a252f', strokeWidth: 3, lineCap: 'round' }));
        s.add(new Konva.Circle({ x: cx, y: cy - 18, radius: 3, fill: '#c8a24a', stroke: '#7a6028', strokeWidth: 1 }));
        s.add(new Konva.Circle({ x: cx, y: cy + 18, radius: 3, fill: '#c8a24a', stroke: '#7a6028', strokeWidth: 1 }));
        // 摇柄插入孔（断路器开关正下方，上移 30px）
        s.add(new Konva.Circle({ x: cx, y: UPPER_H + MID_H - 40, radius: 7, fill: '#1a1a1a', stroke: '#3a3a3a', strokeWidth: 1.5 }));
        s.add(new Konva.Circle({ x: cx, y: UPPER_H + MID_H - 38, radius: 3, fill: '#5a5a5a' }));
        s.add(new Konva.Text({ x: cx - 25, y: UPPER_H + MID_H - 22, width: 50, text: '摇柄孔', fontSize: 9, fill: '#555', align: 'center', listening: false }));
    }

    // ── 下部：该柜单线图 ──
    _drawLow(cab, x0) {
        const s = this._staticGroup;
        const ly = UPPER_H + MID_H;   // 下部顶部
        // 右上角：遥控操作孔（上移 30px）
        s.add(new Konva.Circle({ x: x0 + CAB_W - 20, y: ly + 14, radius: 7, fill: '#1a1a1a', stroke: '#3a3a3a', strokeWidth: 1.5 }));
        s.add(new Konva.Circle({ x: x0 + CAB_W - 20, y: ly + 14, radius: 2.5, fill: '#5a5a5a' }));
        s.add(new Konva.Text({ x: x0 + CAB_W - 40, y: ly + 24, width: 40, text: '接口孔', fontSize: 8, fill: '#555', align: 'center', listening: false }));
        const busY = ly + 26;
        const cx = x0 + CAB_W / 2;
        const busL = cx - 40, busR = cx + 40;   // 母线长度减半（居中 80px）

        // 汇流排（参照 F4：横粗线）；母联柜固有 6600V 母线删除（用下方母联母线）
        const d = this._dynamicGroup;
        if (cab.low !== 'tie') {
            const busLine = new Konva.Line({ points: [busL, busY, busR, busY], stroke: '#2c3a45', strokeWidth: 4, lineCap: 'round' });
            d.add(busLine);
            s.add(new Konva.Text({ x: busL, y: busY - 16, text: '6600V', fontSize: 9, fill: '#1a252f', listening: false }));
            if (!this._busLine) this._busLine = {};
            this._busLine[cab.id] = busLine;
            if (cab.low === 'ellipsis') this._ellipsisBus = busLine;   // 省略号柜公共母线（随右母线变红）
        }

        if (cab.low === 'ground') {
            // 母线接地柜：参照单线图隔离开关接地（可点击切换合/断）
            const gx = cx;
            const h = 19.6, sin35 = 0.574, cos35 = 0.819;   // 动触臂 ×1.4
            // 母线 → 上静触点
            if (!this._liveWires) this._liveWires = [];
            if (!this._busWires) this._busWires = [];
            const gwire = new Konva.Line({ points: [gx, busY, gx, busY + 36], stroke: '#1a252f', strokeWidth: 2, lineCap: 'round' });
            d.add(gwire);
            this._busWires.push(gwire);
            d.add(gwire);
            this._liveWires.push(gwire);
            // 上静触点（隔离开关样式）：横向短粗深红段
            s.add(new Konva.Line({ points: [gx - 5, busY + 36, gx + 5, busY + 36], stroke: '#8b0000', strokeWidth: 3.5, lineCap: 'round' }));
            // 下静触点（固定端）：金点
            s.add(new Konva.Circle({ x: gx, y: busY + 78, radius: 3, fill: '#c8a24a', stroke: '#7a6028', strokeWidth: 1 }));
            // 动触臂（动态：合闸接通 / 分闸偏左上 35°）
            this._tieGroundBlade = new Konva.Line({ points: [gx, busY + 78, gx - 2 * h * sin35, busY + 78 - 2 * h * cos35], stroke: '#1a252f', strokeWidth: 3, lineCap: 'round' });
            d.add(this._tieGroundBlade);
            this._tieGroundGeom = { gx, by: busY, h };
            // 接地导线 + 接地符号
            s.add(new Konva.Line({ points: [gx, busY + 78, gx, busY + 99], stroke: '#1a252f', strokeWidth: 2 }));
            [busY + 105, busY + 114, busY + 123].forEach((gy, i) => {
                const w = 12 - i * 4;
                s.add(new Konva.Line({ points: [gx - w, gy, gx + w, gy], stroke: '#1a252f', strokeWidth: 2 }));
            });
            s.add(new Konva.Text({ x: cx - 22, y: busY + 132, width: 44, text: '接地', fontSize: 9, fill: '#333', align: 'center', listening: false }));
        } else if (cab.low === 'tr' || cab.low === 'prop') {
            // 变压器/推进馈电柜：汇流排 + 高压断路器（竖直刀，断开偏左 35°）+ 设备
            const dx = cx;
            if (!this._busWires) this._busWires = [];
            const bw = new Konva.Line({ points: [dx, busY, dx, busY + 36], stroke: '#1a252f', strokeWidth: 2, lineCap: 'round' });
            d.add(bw);
            this._busWires.push(bw);
            const h = 19.6, sin35 = 0.574, cos35 = 0.819;   // 动触臂 ×1.4
            // 上静触点（动触点接触处）：× 符号（深绿，参照单线图断路器）
            const X4 = 4;
            s.add(new Konva.Line({ points: [dx - X4, busY + 36 - X4, dx + X4, busY + 36 + X4], stroke: '#006400', strokeWidth: 2.5, lineCap: 'round' }));
            s.add(new Konva.Line({ points: [dx - X4, busY + 36 + X4, dx + X4, busY + 36 - X4], stroke: '#006400', strokeWidth: 2.5, lineCap: 'round' }));
            // 动触臂（动态，受合闸/分闸按钮控制）
            if (!this._cbBlades) this._cbBlades = {};
            if (!this._cbGeom) this._cbGeom = {};
            this._cbBlades[cab.id] = new Konva.Line({ points: [dx, busY + 78, dx - 2 * h * sin35, busY + 78 - 2 * h * cos35], stroke: '#1a252f', strokeWidth: 3, lineCap: 'round' });
            d.add(this._cbBlades[cab.id]);
            this._cbGeom[cab.id] = { dx, by: busY, h };
            s.add(new Konva.Circle({ x: dx, y: busY + 78, radius: 3, fill: '#c8a24a', stroke: '#7a6028', strokeWidth: 1 }));
            this._mkCableGround(s, d, dx, busY, cab.id);   // 水平接地开关 + 接地符号（独立，可交互）
            if (!this._liveWires) this._liveWires = [];
            if (cab.low === 'tr') {
                // 引线连到变压器顶（135，带电引线）
                const lw = new Konva.Line({ points: [dx, busY + 78, dx, busY + 135], stroke: '#1a252f', strokeWidth: 2 });
                d.add(lw);
                if (!this._loadWires) this._loadWires = {};
                if (!this._loadWires[cab.id]) this._loadWires[cab.id] = [];
                this._loadWires[cab.id].push(lw);
                // 变压器（双圆相交，下移）
                s.add(new Konva.Circle({ x: dx, y: busY + 147, radius: 12, fill: 'rgba(200,205,210,0.55)', stroke: '#2c3a45', strokeWidth: 1.5 }));
                s.add(new Konva.Circle({ x: dx, y: busY + 165, radius: 12, fill: 'rgba(200,205,210,0.55)', stroke: '#2c3a45', strokeWidth: 1.5 }));
                s.add(new Konva.Text({ x: dx - 12, y: busY + 153, width: 24, text: 'TR', fontSize: 8, fill: '#333', align: 'center', listening: false }));
            } else {
                // 引线连到电机顶（153，带电引线）
                const lw = new Konva.Line({ points: [dx, busY + 78, dx, busY + 153], stroke: '#1a252f', strokeWidth: 2 });
                d.add(lw);
                if (!this._loadWires) this._loadWires = {};
                if (!this._loadWires[cab.id]) this._loadWires[cab.id] = [];
                this._loadWires[cab.id].push(lw);
                // 推进电机（圆 + M，下移）
                s.add(new Konva.Circle({ x: dx, y: busY + 168, radius: 15, fill: '#9aa1a8', stroke: '#2c3a45', strokeWidth: 1.5 }));
                s.add(new Konva.Text({ x: dx - 8, y: busY + 159, width: 16, text: 'M', fontSize: 12, fontStyle: 'bold', fill: '#1a252f', align: 'center', listening: false }));
            }
        } else if (cab.low === 'gen') {
            // 发电机控制柜：母线中心 → 断路器开关 → 发电机（参照推进馈电柜）
            const dx = cx;
            if (!this._busWires) this._busWires = [];
            const bw = new Konva.Line({ points: [dx, busY, dx, busY + 36], stroke: '#1a252f', strokeWidth: 2, lineCap: 'round' });
            d.add(bw);
            this._busWires.push(bw);
            const h = 19.6, sin35 = 0.574, cos35 = 0.819;   // 动触臂 ×1.4
            // 上静触点（动触点接触处）：× 符号（深绿，参照单线图断路器）
            const X4 = 4;
            s.add(new Konva.Line({ points: [dx - X4, busY + 36 - X4, dx + X4, busY + 36 + X4], stroke: '#006400', strokeWidth: 2.5, lineCap: 'round' }));
            s.add(new Konva.Line({ points: [dx - X4, busY + 36 + X4, dx + X4, busY + 36 - X4], stroke: '#006400', strokeWidth: 2.5, lineCap: 'round' }));
            // 动触臂（动态，受合闸/分闸按钮控制）
            if (!this._cbBlades) this._cbBlades = {};
            if (!this._cbGeom) this._cbGeom = {};
            this._cbBlades[cab.id] = new Konva.Line({ points: [dx, busY + 78, dx - 2 * h * sin35, busY + 78 - 2 * h * cos35], stroke: '#1a252f', strokeWidth: 3, lineCap: 'round' });
            d.add(this._cbBlades[cab.id]);
            this._cbGeom[cab.id] = { dx, by: busY, h };
            s.add(new Konva.Circle({ x: dx, y: busY + 78, radius: 3, fill: '#c8a24a', stroke: '#7a6028', strokeWidth: 1 }));
            if (!this._liveWires) this._liveWires = [];
            const lw = new Konva.Line({ points: [dx, busY + 78, dx, busY + 148], stroke: '#1a252f', strokeWidth: 2 });   // 引线连到发电机顶
            d.add(lw);
            if (!this._loadWires) this._loadWires = {};
            if (!this._loadWires[cab.id]) this._loadWires[cab.id] = [];
            this._loadWires[cab.id].push(lw);
            this._mkCableGround(s, d, dx, busY, cab.id);   // 水平接地开关 + 接地符号（独立，可交互）
            // 发电机（动态，运行亮绿/停止灰）
            if (!this._genCircle) this._genCircle = {};
            this._genCircle[cab.id] = new Konva.Circle({ x: dx, y: busY + 168, radius: 20, fill: '#8a8f96', stroke: '#2c3a45', strokeWidth: 2 });
            d.add(this._genCircle[cab.id]);
            s.add(new Konva.Text({ x: dx - 10, y: busY + 159, width: 20, text: 'G', fontSize: 14, fontStyle: 'bold', fill: '#1a252f', align: 'center', listening: false }));
            s.add(new Konva.Text({ x: dx - 30, y: busY + 201, width: 60, text: cab.id === 'gen1' ? '1#G' : '2#G', fontSize: 10, fill: '#333', align: 'center', listening: false }));
        } else if (cab.low === 'sync') {
            // 并车柜：同步表（动态指针，12 点起始，顺时针旋转）
            s.add(new Konva.Circle({ x: cx, y: busY + 93, radius: 36, fill: '#f4f6f8', stroke: '#2c3a45', strokeWidth: 2 }));
            for (let a = 0; a < 360; a += 30) {
                const rad = a * Math.PI / 180;
                s.add(new Konva.Line({ points: [cx + 29 * Math.cos(rad), busY + 93 + 29 * Math.sin(rad), cx + 33 * Math.cos(rad), busY + 93 + 33 * Math.sin(rad)], stroke: '#2c3a45', strokeWidth: 1.2 }));
            }
            const needleG = new Konva.Group({ x: cx, y: busY + 93, rotation: 0 });
            needleG.add(new Konva.Line({ points: [0, 0, 0, -22], stroke: '#d03030', strokeWidth: 2.5, lineCap: 'round' }));
            d.add(needleG);
            this._synNeedle = needleG;
            s.add(new Konva.Text({ x: cx - 40, y: busY + 4, width: 80, text: '同步表', fontSize: 15, fontStyle: 'bold', fill: '#006400', align: 'center', listening: false }));
        } else if (cab.low === 'tie') {
            // 母联开关柜（参照电力系统单线图）：左粗母线 + 水平母联断路器 + 右粗母线
            const by = busY + 90;
            const half = 20;
            // 左右 20px 细导线引线（母联开关 ↔ 母线）
            s.add(new Konva.Line({ points: [cx - half - 20, by, cx - half, by], stroke: '#7a8494', strokeWidth: 1.6 }));
            s.add(new Konva.Line({ points: [cx + half, by, cx + half + 20, by], stroke: '#7a8494', strokeWidth: 1.6 }));
            // 左右母线（动态，带电变红）
            const tieL = new Konva.Line({ points: [x0 + 16, by, cx - half - 20, by], stroke: '#2c3a45', strokeWidth: 4, lineCap: 'round' });
            const tieR = new Konva.Line({ points: [cx + half + 20, by, x0 + CAB_W - 16, by], stroke: '#2c3a45', strokeWidth: 4, lineCap: 'round' });
            d.add(tieL, tieR);
            this._tieLeftBus = tieL;
            this._tieRightBus = tieR;
            // 母联断路器（水平，参照单线图：固定端右金点、动触点端左 ×，断开偏左上 35°）
            const h = 16, sin35 = 0.574, cos35 = 0.819;
            // 左静触点（× 符号）
            s.add(new Konva.Line({ points: [cx - half - 4, by - 4, cx - half + 4, by + 4], stroke: '#006400', strokeWidth: 2.5, lineCap: 'round' }));
            s.add(new Konva.Line({ points: [cx - half - 4, by + 4, cx - half + 4, by - 4], stroke: '#006400', strokeWidth: 2.5, lineCap: 'round' }));
            // 右静触点（金点）
            s.add(new Konva.Circle({ x: cx + half, y: by, radius: 3, fill: '#c8a24a', stroke: '#7a6028', strokeWidth: 1 }));
            // 刀闸（动态：合闸接通 / 分闸偏左上 35°）
            this._tieBlade = new Konva.Line({ points: [cx + half, by, cx + half - 2 * h * cos35, by - 2 * h * sin35], stroke: '#1a252f', strokeWidth: 3, lineCap: 'round' });
            d.add(this._tieBlade);
            this._tieGeom = { cx, by, half, h };
            s.add(new Konva.Text({ x: cx - 24, y: by + 20, width: 48, text: '母联', fontSize: 9, fill: '#333', align: 'center', listening: false }));
        } else {
            // 省略号柜
            s.add(new Konva.Text({ x: x0, y: busY + 20, width: CAB_W, text: '…3#发电机控制柜…\n（对称省略）', fontSize: 12, fill: '#888', align: 'center', lineHeight: 1.4, listening: false }));
        }
    }

    // ── 并车柜三个选择开关交互：点击切换档位（手柄旋转）──
    _bindSyncSwitches() {
        const d = this._dynamicGroup;
        const idx = CABINETS.findIndex(c => c.id === 'sync');
        if (idx < 0) return;
        const x0 = idx * CAB_W;
        const defs = {
            mode: { x: x0 + 50, y: 218, angs: [-90, 0, 90], initI: 1 },       // 半自动/手动/自动，默认手动(0°)
            seq:  { x: x0 + 138, y: 218, angs: [-90, 0, 90], initI: 0 },      // 1-2-3-4/1-3-2-4/3-4-1-2
            sync: { x: x0 + 138, y: 140, angs: [-90, -45, 0, 45, 90], initI: 0 }, // OFF/1#/2#/3#/4#（与备用顺序同列）
        };
        this._syncPos = {};
        Object.entries(defs).forEach(([key, def]) => {
            this._syncPos[key] = { i: def.initI || 0, angs: def.angs };
            const hit = new Konva.Rect({ x: def.x - 30, y: def.y - 30, width: 60, height: 60, fill: 'rgba(255,255,255,0.01)', listening: true, cursor: 'pointer' });
            d.add(hit);
            hit.on('click tap', (e) => {
                e.cancelBubble = true;
                const p = this._syncPos[key];
                p.i = (p.i + 1) % p.angs.length;
                if (this._syncKnobs && this._syncKnobs[key]) this._syncKnobs[key].rotation(p.angs[p.i]);
                this._highlightSync(key);
                if (this.sys && typeof this.sys.requestRedraw === 'function') this.sys.requestRedraw();
            });
        });
        // 初始化：默认档位（i=0）即高亮
        Object.keys(defs).forEach(key => this._highlightSync(key));
    }

    /** 从引线中间往右画水平接地开关 + 接地符号（参照单线图隔离开关；刀闸动态，可交互） */
    _mkCableGround(s, d, dx, busY, key) {
        const gy = busY + 100;   // 引线中间
        const h2 = 12, s35 = 0.574, c35 = 0.819;   // 刀闸增大（12）
        const toX = dx + 25, fx = toX + 22;        // 左引线 25px；开关本体增大（22）
        // 引线中点 → 左静触点：水平线（25px）
        s.add(new Konva.Line({ points: [dx, gy, toX, gy], stroke: '#7a8494', strokeWidth: 1.6 }));
        // 左静触点：竖向短粗深红段（隔离开关样式）
        s.add(new Konva.Line({ points: [toX, gy - 5, toX, gy + 5], stroke: '#8b0000', strokeWidth: 3.5, lineCap: 'round' }));
        // 右固定端金点
        s.add(new Konva.Circle({ x: fx, y: gy, radius: 3, fill: '#c8a24a', stroke: '#7a6028', strokeWidth: 1 }));
        // 刀闸（动态）：固定端右、动触点左，断开偏左上 35°
        const blade = new Konva.Line({ points: [fx, gy, fx - 2 * h2 * c35, gy - 2 * h2 * s35], stroke: '#1a252f', strokeWidth: 3, lineCap: 'round' });
        d.add(blade);
        if (!this._groundBlades) this._groundBlades = [];
        this._groundBlades.push({ blade, fx, fy: gy, toX, toY: gy, key });
        // 右引线（25px）+ 接地符号（右移）
        const gx2 = fx + 40;
        s.add(new Konva.Line({ points: [fx, gy, gx2, gy], stroke: '#7a8494', strokeWidth: 1.6 }));
        s.add(new Konva.Line({ points: [gx2, gy, gx2, gy + 10], stroke: '#1a252f', strokeWidth: 2 }));
        [gy + 13, gy + 18, gy + 23].forEach((yy, i) => {
            const w = 10 - i * 3.3;
            s.add(new Konva.Line({ points: [gx2 - w, yy, gx2 + w, yy], stroke: '#1a252f', strokeWidth: 2 }));
        });
    }

    /** 创建并添加同步表档位标签（返回 Text 节点）；放动态组（避免静态缓存不刷新） */
    __mkSyncText(s, cfg) {
        const t = new Konva.Text(cfg);
        this._dynamicGroup.add(t);
        return t;
    }

    /** 当前档位标签高亮：粗体、字号 +2、深红；其余普通 */
    _highlightSync(key) {
        const pos = this._syncPos && this._syncPos[key];
        if (!pos) return;
        const ang = pos.angs[pos.i];
        (this._syncLabels && this._syncLabels[key] || []).forEach(l => {
            const active = l.ang === ang;
            l.node.fontStyle(active ? 'bold' : 'normal');
            l.node.fontSize(active ? 12 : 10);
            l.node.fill(active ? '#8b0000' : '#333');
        });
    }

    // ── 母联柜合闸/分闸按钮交互 ──
    _bindTieButtons() {
        const d = this._dynamicGroup;
        const tieIdx = CABINETS.findIndex(c => c.low === 'tie');
        if (tieIdx < 0) return;
        const x0 = tieIdx * CAB_W;
        const mkBtn = (x, y, fn) => {
            const hit = new Konva.Rect({ x: x - 14, y: y - 14, width: 28, height: 28, fill: 'rgba(255,255,255,0.01)', listening: true, cursor: 'pointer' });
            d.add(hit);
            hit.on('click tap', (e) => { e.cancelBubble = true; fn(); });
        };
        mkBtn(x0 + 35, 208, () => { this._tieClosed = true; this._refreshTie(); });
        mkBtn(x0 + 85, 208, () => { this._tieClosed = false; this._refreshTie(); });
        // tr/prop 柜：合闸/分闸按钮控制各自断路器
        ['tr', 'prop'].forEach(id => {
            const ci = CABINETS.findIndex(c => c.id === id);
            if (ci < 0) return;
            const cx0 = ci * CAB_W;
            mkBtn(cx0 + 35, 208, () => { this._cbState[id] = true; this._refreshTie(); });
            mkBtn(cx0 + 85, 208, () => { this._cbState[id] = false; this._refreshTie(); });
        });
        // 发电机柜：起动/停止（运行灯）+ 合闸/分闸（断路器，含手动并车同步检测）+ 自动并车/自动解列
        ['gen1', 'gen2'].forEach(id => {
            const ci = CABINETS.findIndex(c => c.id === id);
            if (ci < 0) return;
            const cx0 = ci * CAB_W;
            // 自动模式下：起动/停止/合闸/分闸 全部失效（自动流程接管）
            const autoGuard = (fn) => () => {
                if (this._syncMode() === 'auto') return;
                fn();
            };
            mkBtn(cx0 + 52.5, 208, autoGuard(() => { this._cbRun[id] = true; this._refreshTie(); }));
            mkBtn(cx0 + 92.5, 208, autoGuard(() => { this._cbRun[id] = false; this._refreshTie(); }));
            mkBtn(cx0 + 132.5, 208, autoGuard(() => { this._closeGenCB(id); }));
            mkBtn(cx0 + 172.5, 208, autoGuard(() => { this._cbState[id] = false; this._refreshTie(); }));
            mkBtn(cx0 + 72.5, 265, () => { this._onAutoSync(id); });
            mkBtn(cx0 + 152.5, 265, () => { this._onAutoSplit(id); });
        });
        // 母线接地柜：测试按钮（3 灯亮 3s）+ 接地开关（点击单线图切换）
        const gIdx = CABINETS.findIndex(c => c.low === 'ground');
        if (gIdx >= 0) {
            const gx0 = gIdx * CAB_W;
            mkBtn(gx0 + 155, 140, () => {
                this._ledTestT = 3;
                this._refreshTie();
            });
            mkBtn(gx0 + 100, UPPER_H + MID_H + 78, () => {
                this._cabGround.ground = !this._cabGround.ground;
                this._refreshTie();
            });
        }
        // 变压器/推进/发电机柜的引线接地开关：点击切换（各柜独立）
        CABINETS.forEach(c => {
            if (['tr', 'prop', 'gen'].includes(c.low)) {
                const ci = CABINETS.indexOf(c);
                const cx0 = ci * CAB_W + CAB_W / 2;
                mkBtn(cx0 + 25, UPPER_H + MID_H + 26 + 100, () => {
                    this._cabGround[c.id] = !this._cabGround[c.id];
                    this._refreshTie();
                });
            }
        });
    }

    // ── 发电机合闸 / 自动并车 / 自动解列 逻辑 ──
    /** 并车柜模式：semi(半自动)/manual(手动)/auto(自动) */
    _syncMode() {
        const p = this._syncPos && this._syncPos.mode;
        if (!p) return 'manual';
        const a = p.angs[p.i];
        return a === -90 ? 'semi' : (a === 90 ? 'auto' : 'manual');
    }
    /** 同步表选择档位：off / gen1 / gen2 */
    _syncSelect() {
        const p = this._syncPos && this._syncPos.sync;
        if (!p) return 'off';
        const a = p.angs[p.i];
        if (a === -45) return 'gen1';
        if (a === 0) return 'gen2';
        return 'off';
    }
    /** 备用机组顺序（按备用顺序选择开关）：1-2-3-4 → 1#优先；2-1-4-3 → 2#优先；3-4-1-2 → 1#优先（3#未实现） */
    _spareSeq() {
        const p = this._syncPos && this._syncPos.seq;
        const a = p ? p.angs[p.i] : -90;
        if (a === 0) return ['gen2', 'gen1'];   // 2-1-4-3：2#优先
        return ['gen1', 'gen2'];                // 1-2-3-4 / 3-4-1-2：1#优先
    }
    /** 电网有电（本机合闸前由其它电源供电） */
    _gridLive() {
        return (this._cbRun.gen1 && this._cbState.gen1) || (this._cbRun.gen2 && this._cbState.gen2);
    }
    /** 合闸：手动 + 电网有电需同步表本机位 + 10~12 点才成功，范围外所有发电机断路器同时跳闸 */
    _closeGenCB(key) {
        if (!this._cbRun[key]) return;              // 未起动不能合闸
        const mode = this._syncMode();
        if (mode === 'manual' && this._gridLive()) {
            if (this._syncSelect() !== key) return;  // 同步表未打本机位，不允许合闸
            const ang = this._syncAngle;
            if (ang >= 270 || ang === 0) {
                this._cbState[key] = true;            // 9~12 点内（-90°~0°，即 270°~360°）：合闸成功
            } else {
                this._cbState.gen1 = false;           // 范围外：所有发电机断路器同时跳闸
                this._cbState.gen2 = false;
            }
        } else {
            this._cbState[key] = true;                // 电网无电 / 半自动 / 自动：直接合闸
        }
        this._refreshTie();
    }
    /** 自动并车：半自动模式延时 3s 并入/无电直接合闸；自动模式 5s 起动备用→3s 合闸 */
    _onAutoSync(key) {
        const mode = this._syncMode();
        if (mode === 'auto') {
            // 自动模式：本机未运行才操作；电网有电需单机运行且变压器/推进断路器都闭合
            if (this._cbRun[key]) return;
            if (this._gridLive()) {
                const other = key === 'gen1' ? 'gen2' : 'gen1';
                if (!this._cbRun[other] || !this._cbState.tr || !this._cbState.prop) return;
            }
            this._autoFlow = { stage: 'start', t: 5, target: key };   // 5s 起动 → 3s 合闸
            this._autoSyncLed[key] = true;
            this._refreshTie();
            return;
        }
        if (mode !== 'semi') return;      // 仅半自动/自动
        if (!this._cbRun[key]) return;    // 半自动：本机已起动
        if (this._gridLive()) {
            this._autoSyncLed[key] = true;            // 亮绿
            this._autoSyncT[key] = 3;                 // 3s 后自动合闸
            this._refreshTie();
        } else {
            this._cbState[key] = true;                // 电网无电：直接合闸
            this._refreshTie();
        }
    }
    /** 自动解列：本机分闸（灯亮 0.8s） */
    _onAutoSplit(key) {
        this._cbState[key] = false;
        this._autoSplitLed[key] = true;
        this._refreshTie();
        setTimeout(() => { this._autoSplitLed[key] = false; this._refreshTie(); }, 800);
    }

    _refreshTie() {
        // 左系统带电：任一发电机运行 && 其断路器闭合 → 左汇流排有电
        const leftLive = (this._cbRun.gen1 && this._cbState.gen1) || (this._cbRun.gen2 && this._cbState.gen2);
        if (!this._tieBlade || !this._tieGeom) return;
        const g = this._tieGeom, sin35 = 0.574, cos35 = 0.819;
        if (this._tieClosed) {
            // 合闸：刀闸水平接通（左右触点相连）
            this._tieBlade.points([g.cx + g.half, g.by, g.cx - g.half, g.by]);
        } else {
            // 分闸：左端动触点偏左上 35°
            this._tieBlade.points([g.cx + g.half, g.by, g.cx + g.half - 2 * g.h * cos35, g.by - 2 * g.h * sin35]);
        }
        // 母联柜指示灯：闭合绿亮（红暗），断开红亮（绿暗）
        if (this._tieLedG && this._tieLedR) {
            this._tieLedG.fill(this._tieClosed ? '#2eff3e' : '#3a3a3a');
            this._tieLedR.fill(this._tieClosed ? '#3a3a3a' : '#ff3344');
        }
        // 母线接地柜圆灯：接地开关合 → 绿亮；断 → 红亮
        if (this._groundLedG && this._groundLedR) {
            const gc = this._cabGround.ground;
            this._groundLedG.fill(gc ? '#2eff3e' : '#3a3a3a');
            this._groundLedR.fill(gc ? '#3a3a3a' : '#ff3344');
        }
        // 高压带电显示器（母线接地柜）：母线带电或测试中 → 3 灯亮（黄）
        const liveNow = leftLive || this._rightLive || this._ledTestT > 0;
        (this._tieLeds || []).forEach(({ led, txt, color }) => {
            led.fill(liveNow ? color : '#3a3a3a');
            txt.fill(liveNow ? '#333' : '#999');
        });
        if (this._ledTestT > 0) this._ledTestT -= 0.05;
        // （接地圆灯状态已并入上方统一逻辑）
        // 接地刀闸：合闸接通（刀绕固定端向上搭到上触点） / 分闸偏左上 35°
        if (this._tieGroundBlade && this._tieGroundGeom) {
            const gg = this._tieGroundGeom, gs35 = 0.574, gc35 = 0.819;
            const gc = this._cabGround.ground;
            if (gc) {
                this._tieGroundBlade.points([gg.gx, gg.by + 78, gg.gx, gg.by + 36]);
            } else {
                this._tieGroundBlade.points([gg.gx, gg.by + 78, gg.gx - 2 * gg.h * gs35, gg.by + 78 - 2 * gg.h * gc35]);
            }
        }
        // 发电机圆：运行亮绿 / 停止灰
        ['gen1', 'gen2'].forEach(k => {
            if (this._genCircle && this._genCircle[k]) this._genCircle[k].fill(this._cbRun[k] ? '#2eff3e' : '#8a8f96');
        });
        // gen1/gen2 真空断路器：合闸竖直接通 / 分闸偏左上 35° + 指示灯（白运行/绿合闸/红分闸）
        ['gen1', 'gen2'].forEach(k => {
            const blade = this._cbBlades && this._cbBlades[k];
            const geom = this._cbGeom && this._cbGeom[k];
            if (blade && geom) {
                const gs = 0.574, gc = 0.819;
                if (this._cbState[k]) {
                    blade.points([geom.dx, geom.by + 78, geom.dx, geom.by + 36]);
                } else {
                    blade.points([geom.dx, geom.by + 78, geom.dx - 2 * geom.h * gs, geom.by + 78 - 2 * geom.h * gc]);
                }
            }
            const led = this._cbLed && this._cbLed[k];
            if (led) {
                led.run.fill(this._cbRun[k] ? '#ffffff' : '#3a3a3a');
                led.g.fill(this._cbState[k] ? '#2eff3e' : '#3a3a3a');
                led.r.fill(this._cbState[k] ? '#3a3a3a' : '#ff3344');
            }
        });
        // tr/prop 真空断路器：合闸竖直接通 / 分闸偏左上 35° + 指示灯
        ['tr', 'prop'].forEach(k => {
            const blade = this._cbBlades && this._cbBlades[k];
            const geom = this._cbGeom && this._cbGeom[k];
            if (blade && geom) {
                const gs = 0.574, gc = 0.819;
                if (this._cbState[k]) {
                    blade.points([geom.dx, geom.by + 78, geom.dx, geom.by + 36]);
                } else {
                    blade.points([geom.dx, geom.by + 78, geom.dx - 2 * geom.h * gs, geom.by + 78 - 2 * geom.h * gc]);
                }
            }
            const led = this._cbLed && this._cbLed[k];
            if (led) {
                led.g.fill(this._cbState[k] ? '#2eff3e' : '#3a3a3a');
                led.r.fill(this._cbState[k] ? '#3a3a3a' : '#ff3344');
            }
        });
        // 引线水平接地开关：各柜独立
        (this._groundBlades || []).forEach(gb => {
            const gc = this._cabGround[gb.key];
            if (gc) gb.blade.points([gb.fx, gb.fy, gb.toX, gb.toY]);
            else gb.blade.points([gb.fx, gb.fy, gb.fx - 2 * 9 * 0.819, gb.fy - 2 * 9 * 0.574]);
        });
        // 左母线（各柜）+ 母联左母线 变红
        const RED = '#d02020', OFF = '#2c3a45';
        // 与母线直接相连的导线：母线带电即红（隔了开关的线不变红）
        (this._busWires || []).forEach(w => w.stroke(leftLive ? RED : '#1a252f'));
        Object.keys(this._busLine || {}).forEach(k => {
            if (k !== 'ellipsis') this._busLine[k].stroke(leftLive ? RED : OFF);
        });
        if (this._tieLeftBus) this._tieLeftBus.stroke(leftLive ? RED : OFF);
        // 右母线 = 左带电 && 母联合
        this._rightLive = leftLive && this._tieClosed;
        if (this._tieRightBus) this._tieRightBus.stroke(this._rightLive ? RED : OFF);
        if (this._ellipsisBus) this._ellipsisBus.stroke(this._rightLive ? RED : OFF);   // 省略号柜公共母线
        this.markDirty();
        if (this.sys && typeof this.sys.requestRedraw === 'function') this.sys.requestRedraw();
    }

    // ── 仿真主循环：刷新母联/接地状态 ──
    tick(dt) {
        // 同步表旋转：手动 + 电网有电 + 选择开关指向待并机组（该机已起动且未合闸）→ 5s 一圈
        // 其它情况（含并车成功后）指针指回 12 点
        const mode = this._syncMode();
        const sel = this._syncSelect();
        const spinning = mode === 'manual' && this._gridLive() && sel !== 'off' && this._cbRun[sel] && !this._cbState[sel];
        if (spinning && this._synNeedle) {
            this._syncAngle = (this._syncAngle + dt * 72) % 360;    // 72°/s → 5s 一圈
            this._synNeedle.rotation(this._syncAngle);
        } else if (this._synNeedle && this._synNeedle.rotation() !== 0) {
            this._syncAngle = 0;
            this._synNeedle.rotation(0);                            // 指 12 点
        }
        // 自动模式自动起动备用机组：电网无电 → 按备用顺序；电网有电 + 单机运行 + 负载全通 → 自动并入备用机组
        if (mode === 'auto' && !this._autoFlow && !this._unloadFlow) {
            const gridLive = this._gridLive();
            let spare = null;
            if (!gridLive) {
                // 电网无电：按备用顺序选择开关
                spare = this._spareSeq().find(id => !this._cbRun[id]);
            } else {
                // 电网有电：单机运行（恰一台合闸）且变压器/推进断路器都闭合 → 备用机组自动并入
                const g1on = this._cbRun.gen1 && this._cbState.gen1;
                const g2on = this._cbRun.gen2 && this._cbState.gen2;
                if ((g1on ^ g2on) && this._cbState.tr && this._cbState.prop) {
                    spare = g1on ? 'gen2' : 'gen1';
                }
            }
            if (spare) {
                if (this._cbRun[spare]) {
                    this._autoFlow = { stage: 'cb', t: 3, target: spare };   // 已起动：3s 后合闸
                } else {
                    this._autoFlow = { stage: 'start', t: 5, target: spare };  // 未起动：5s 起动 → 3s 合闸
                }
                this._autoSyncLed[spare] = true;
            }
        }
        // 自动模式并车流程：5s 起动备用机组 → 3s 自动合闸
        if (this._autoFlow) {
            this._autoFlow.t -= dt;
            if (this._autoFlow.t <= 0) {
                const f = this._autoFlow;
                if (f.stage === 'start') {
                    this._cbRun[f.target] = true;    // 起动备用机组
                    f.stage = 'cb';
                    f.t = 3;
                } else if (f.stage === 'cb') {
                    this._cbState[f.target] = true;  // 自动合闸并入
                    this._autoSyncLed[f.target] = false;
                    this._autoFlow = null;
                }
            }
        }
        // 自动模式：双机运行 && 两个负载（变压器/推进）断路器都断开 → 10s 自动解列 1 台机组 → 再 5s 自动停机
        if (mode === 'auto' && !this._cbState.tr && !this._cbState.prop) {
            const bothGenOn = (this._cbRun.gen1 && this._cbState.gen1) && (this._cbRun.gen2 && this._cbState.gen2);
            if (bothGenOn && !this._unloadFlow) {
                this._unloadFlow = { stage: 'split', t: 10, target: (this._cbRun.gen2 && this._cbState.gen2) ? 'gen2' : 'gen1' };
            }
        }
        if (this._unloadFlow) {
            this._unloadFlow.t -= dt;
            if (this._unloadFlow.t <= 0) {
                const f = this._unloadFlow;
                if (f.stage === 'split') {
                    this._cbState[f.target] = false; // 解列
                    f.stage = 'stop';
                    f.t = 5;
                } else if (f.stage === 'stop') {
                    this._cbRun[f.target] = false;   // 停机
                    this._unloadFlow = null;
                }
            }
        }
        // 自动并车 3s 延时：到点灯灭 + 自动合闸
        ['gen1', 'gen2'].forEach(k => {
            if (this._autoSyncT[k] > 0) {
                this._autoSyncT[k] -= dt;
                if (this._autoSyncT[k] <= 0) {
                    this._autoSyncT[k] = 0;
                    this._autoSyncLed[k] = false;
                    this._cbState[k] = true;
                }
            }
        });
        // 带灯按钮灯刷新（自动并车绿 / 自动解列红）
        ['gen1', 'gen2'].forEach(k => {
            const al = this._autoSyncLeds && this._autoSyncLeds[k];
            if (al) al.fill(this._autoSyncLed[k] ? '#2eff3e' : '#3a3a3a');
            const sl = this._autoSplitLeds && this._autoSplitLeds[k];
            if (sl) sl.fill(this._autoSplitLed[k] ? '#ff3344' : '#3a3a3a');
        });
        this._refreshTie();
        if (this.sys && typeof this.sys.requestRedraw === 'function') this.sys.requestRedraw();
    }

    destroy() { super.destroy?.(); }
}