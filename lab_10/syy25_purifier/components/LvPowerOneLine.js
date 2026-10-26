import { BaseComponent } from './BaseComponent.js';

/**
 * LvPowerOneLine 船舶低压电力系统单线图
 *
 * 参照图片《船舶低压电力系统单线图》与 HvPowerOneLine 组件实现：
 *   - 3 台主发电机 G1~G3 经 ACB 接入「主配电盘汇流排」(MAIN)
 *   - 主汇流排由「母线开关」分为上、下两段：G1 / G2 接上段，G3 接下段
 *   - 上段：MCB1 → 电动机 M1；岸电箱经开关接入上段；F2 支路 → 「馈电汇流排」(FDR) → 负载 / M2
 *   - 上段：重要负载1 支路直接带重要负载
 *   - 下段：MCB → 变压器 → 「照明汇流排」 → 负载；重要负载2 支路直接带重要负载
 *   - 应急发电机 EG 经 ACB 接入「应急配电板汇流排」(EMR)
 *   - 下段主汇流排经 MCB + ABTS 自动转换开关与应急汇流排互投
 *   - 应急汇流排 → 整流装置 → 「充放电板汇流排」(DC)；右侧 2 组蓄电池直接接入、2 路断路器带低压负载
 *   - 顶部按保护区域划分：发电机回路保护 / 馈电回路保护 / 电动机回路保护 / 蓄电池回路保护
 *
 * 显示：
 *   - 淡灰色不透明背景；汇流排粗线、连接导线细线
 *   - 带电时导线 / 汇流排 / 变压器 / 负载标记变红；电动机运行时绿、发电机运行绿
 *   - 岸电箱点亮（红色）表示处于供电状态
 *
 * 交互（自包含状态）：
 *   - 点击发电机 → 起动 / 停止
 *   - 点击开关   → 合闸 / 分闸（刀闸旋转）
 *   - 点击岸电箱 → 投入 / 退出岸电供电
 */

// ── 发电机 ──
const GEN_DEFS = [
    { id: 'G1', x: 55, y: 170, r: 25.5, label: 'G1' },
    { id: 'G2', x: 55, y: 238, r: 25.5, label: 'G2' },
    { id: 'G3', x: 55, y: 436, r: 25.5, label: 'G3' },
    { id: 'EG', x: 55, y: 755, r: 25.5, label: 'EG' },
];

// ── 船舶发电机主开关（与岸电开关互锁）──
const GEN_MAIN_SW = ['ACB1', 'ACB2', 'ACB3', 'EACB'];

// ── 自动模式设备（不可手动操作）──
const AUTO_DEVICES = ['ABTS', 'EACB'];   // 自动转换开关 / 应急发电机出口断路器
const AUTO_GEN = 'EG';                   // 应急发电机
const AUTO_T_EG_START = 5;               // 失电后：延时 5s 起动 EG
const AUTO_T_EACB_CLOSE = 13;            // 再延时 8s（累计 13s）闭合 EACB
const AUTO_T_ABTS_CLOSE = 2;             // 恢复后：延时 2s 恢复 ABTS
const AUTO_T_EG_STOP = 10;               // 再延时 8s（累计 10s）停 EG

// ── 默认闭合的开关 ──
const DEFAULT_CLOSED = ['BUSSW', 'SWEMC', 'SWE1', 'SWE2', 'SWRECT', 'SWBC1', 'SWBC2'];

// ── 开关（orient: 'h' 水平导线 / 'v' 竖直导线；统一为断路器形式；half 为触点半距，默认 11.5）──
const SW_DEFS = [
    { id: 'ACB1',   x: 150, y: 170, orient: 'h',  label: 'ACB1', half: 15 },
    { id: 'ACB2',   x: 150, y: 238, orient: 'h',  label: 'ACB2', half: 15 },
    { id: 'ACB3',   x: 150, y: 436, orient: 'h',  label: 'ACB3', half: 15 },
    { id: 'EACB',   x: 150, y: 755, orient: 'h',  label: 'EACB', half: 15 },
    { id: 'BUSSW',  x: 280, y: 390, orient: 'v',  label: '母线开关' },
    { id: 'MCB1',   x: 325, y: 70,  orient: 'h',  label: 'MCB' },
    { id: 'SWSHORE', x: 325, y: 120, orient: 'h', label: '岸电' },
    { id: 'SWFDR2', x: 325, y: 180, orient: 'h', label: 'F2' },
    { id: 'SWIMP1', x: 325, y: 300, orient: 'h', label: '重要负载' },
    { id: 'SWLD1',  x: 615, y: 150, orient: 'h', label: 'L1' },
    { id: 'SWLD2',  x: 615, y: 200, orient: 'h', label: 'L2' },
    { id: 'SWM2',   x: 615, y: 250, orient: 'h', label: 'M2' },
    { id: 'MCBTR',  x: 325, y: 480, orient: 'h',  label: 'MCB' },
    { id: 'SWIMP2', x: 325, y: 545, orient: 'h', label: '重要负载' },
    { id: 'SWEMC',  x: 325, y: 600, orient: 'h',  label: 'EMCB' },
    { id: 'ABTS',   x: 420, y: 600, orient: 'h', label: 'ABTS' },
    { id: 'SWLV1',  x: 660, y: 455, orient: 'h', label: 'L1' },
    { id: 'SWLV2',  x: 660, y: 505, orient: 'h', label: 'L2' },
    { id: 'SWE1',   x: 545, y: 700, orient: 'h', label: 'E1' },
    { id: 'SWE2',   x: 545, y: 750, orient: 'h', label: 'E2' },
    { id: 'SWRECT', x: 545, y: 790, orient: 'h', label: '整流装置' },
    { id: 'SWBC1',  x: 1065, y: 745, orient: 'h', label: 'QF1' },
    { id: 'SWBC2',  x: 1065, y: 810, orient: 'h', label: 'QF2' },
];

// ── 岸电箱（可交互：点亮 = 供电状态）──
const SHORE_BOX = { x: 830, y: 102, w: 76, h: 36, cx: 868, cy: 120 };

// ── 连接导线（key 对应 _computeLive 生成的带电信号）──
const WIRE_DEFS = [
    // 发电机出口 → ACB → 主汇流排（G1/G2 → 上段，G3 → 下段）
    { id: 'g1a', pts: [80.5, 170, 135, 170], key: 'g1' },
    { id: 'g1b', pts: [165, 170, 280, 170], key: 'g1' },
    { id: 'g2a', pts: [80.5, 238, 135, 238], key: 'g2' },
    { id: 'g2b', pts: [165, 238, 280, 238], key: 'g2' },
    { id: 'g3a', pts: [80.5, 436, 135, 436], key: 'g3' },
    { id: 'g3b', pts: [165, 436, 280, 436], key: 'g3' },
    { id: 'ega', pts: [80.5, 755, 135, 755], key: 'eg' },
    { id: 'egb', pts: [165, 755, 445, 755], key: 'eg' },
    // 上段主汇流排馈电
    { id: 'mcb1a',  pts: [280, 70, 313.5, 70],   key: 'mainUp' },
    { id: 'mcb1b',  pts: [336.5, 70, 843, 70],   key: 'mcb1' },
    { id: 'shorea', pts: [280, 120, 313.5, 120], key: 'mainUp' },
    { id: 'shoreb', pts: [336.5, 120, 830, 120], key: 'shoreWire' },
    { id: 'fdr2a',  pts: [280, 180, 313.5, 180], key: 'mainUp' },
    { id: 'fdr2b',  pts: [336.5, 180, 530, 180], key: 'fdr2' },
    { id: 'imp1a',  pts: [280, 300, 313.5, 300], key: 'mainUp' },
    { id: 'imp1b',  pts: [336.5, 300, 700, 300], key: 'imp1' },
    // 馈电汇流排出线（仅由 F2 支路供电；L3 已删除，M2 上移至原 L3 位置）
    { id: 'ld1a', pts: [530, 150, 603.5, 150], key: 'fdr' },
    { id: 'ld1b', pts: [626.5, 150, 700, 150], key: 'ld1' },
    { id: 'ld2a', pts: [530, 200, 603.5, 200], key: 'fdr' },
    { id: 'ld2b', pts: [626.5, 200, 700, 200], key: 'ld2' },
    { id: 'm2a',  pts: [530, 250, 603.5, 250], key: 'fdr' },
    { id: 'm2b',  pts: [626.5, 250, 843, 250], key: 'm2' },
    // 下段主汇流排 → 变压器 → 照明汇流排
    { id: 'tra',   pts: [280, 480, 313.5, 480], key: 'mainLow' },
    { id: 'trb',   pts: [336.5, 480, 421, 480], key: 'trFeed' },
    { id: 'trc',   pts: [479, 480, 575, 480],   key: 'lvd' },
    { id: 'imp2a', pts: [280, 545, 313.5, 545], key: 'mainLow' },
    { id: 'imp2b', pts: [336.5, 545, 700, 545], key: 'imp2' },
    // 下段主汇流排 → MCB → ABTS → 应急汇流排
    { id: 'emca',  pts: [280, 600, 313.5, 600], key: 'mainLow' },
    { id: 'emcb',  pts: [336.5, 600, 408.5, 600], key: 'emc' },
    { id: 'abtsb', pts: [431.5, 600, 445, 600], key: 'abts' },
    { id: 'abtsd', pts: [445, 600, 445, 640],   key: 'abts' },
    // 照明汇流排出线（L3 已删除）
    { id: 'lv1a', pts: [575, 455, 648.5, 455], key: 'lvd' },
    { id: 'lv1b', pts: [671.5, 455, 745, 455], key: 'lv1' },
    { id: 'lv2a', pts: [575, 505, 648.5, 505], key: 'lvd' },
    { id: 'lv2b', pts: [671.5, 505, 745, 505], key: 'lv2' },
    // 应急汇流排出线
    { id: 'e1a', pts: [445, 700, 533.5, 700], key: 'emr' },
    { id: 'e1b', pts: [556.5, 700, 630, 700], key: 'e1' },
    { id: 'e2a', pts: [445, 750, 533.5, 750], key: 'emr' },
    { id: 'e2b', pts: [556.5, 750, 630, 750], key: 'e2' },
    // 应急汇流排 → 整流装置 → 充放电板汇流排（竖直）
    { id: 'r1', pts: [445, 790, 533.5, 790],  key: 'emr' },
    { id: 'r2', pts: [556.5, 790, 682, 790],  key: 'rectFeed' },
    { id: 'r3', pts: [718, 790, 1000, 790],   key: 'rectOut' },
    // 充放电板汇流排右侧 4 条支路（对称分布）：2 组蓄电池直接接入 + 2 路断路器接低压负载
    { id: 'bt1a', pts: [1000, 615, 1048, 615], key: 'batt' },
    { id: 'bt1b', pts: [1057, 615, 1090, 615], key: 'batt' },
    { id: 'bt2a', pts: [1000, 680, 1048, 680], key: 'batt' },
    { id: 'bt2b', pts: [1057, 680, 1090, 680], key: 'batt' },
    { id: 'lc1a', pts: [1000, 745, 1053.5, 745], key: 'batt' },
    { id: 'lc1b', pts: [1076.5, 745, 1130, 745], key: 'bld1' },
    { id: 'lc2a', pts: [1000, 810, 1053.5, 810], key: 'batt' },
    { id: 'lc2b', pts: [1076.5, 810, 1130, 810], key: 'bld2' },
];

// ── 负载终端标记 ──
const LOAD_DEFS = [
    { id: 'ld1', x: 700, y: 150, key: 'ld1' },
    { id: 'ld2', x: 700, y: 200, key: 'ld2' },
    { id: 'imp1', x: 700, y: 300, key: 'imp1' },
    { id: 'lv1', x: 745, y: 455, key: 'lv1', bulb: true },
    { id: 'lv2', x: 745, y: 505, key: 'lv2', bulb: true },
    { id: 'imp2', x: 700, y: 545, key: 'imp2' },
    { id: 'e1', x: 630, y: 700, key: 'e1' },
    { id: 'e2', x: 630, y: 750, key: 'e2' },
    { id: 'bld1', x: 1130, y: 745, key: 'bld1' },
    { id: 'bld2', x: 1130, y: 810, key: 'bld2' },
];

// ── 电动机 ──
const MOTOR_DEFS = [
    { id: 'M1', x: 860, y: 70, key: 'mcb1' },
    { id: 'M2', x: 860, y: 250, key: 'm2' },
];

// ── 保护区域 ──
const ZONE_DEFS = [
    { label: '发电机回路保护', x1: 10,  x2: 232 },
    { label: '馈电回路保护',   x1: 232, x2: 713 },
    { label: '电动机回路保护', x1: 713, x2: 986 },
    { label: '蓄电池回路保护', x1: 986, x2: 1160 },
];
const DIVIDER_X = [232, 713, 986, 1160];

const RED = '#d02020';
const OFF = '#7a8494';
const BUS_OFF = '#2c3a45';
const FLOAT_BLUE = '#1e90ff';   // 浮充状态（充放电板左侧带电）下的蓄电池颜色
const GEN_RUN = '#22dd22';      // 发电机运行时的亮绿色

export class LvPowerOneLine extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);
        this.width = 1180;
        this.height = 870;
        this.type = 'lv_one_line';
        this.cache = 'fixed';
        this._initGroups();
        this._initState();
        this._init();
    }

    _initState() {
        this._gens = { G1: false, G2: false, G3: false, EG: false };
        this._sw = {};
        SW_DEFS.forEach(s => { this._sw[s.id] = false; });           // 所有开关默认断开
        DEFAULT_CLOSED.forEach(id => { if (id in this._sw) this._sw[id] = true; });  // 部分开关默认闭合
        this._shore = false;                                 // 岸电箱默认退出供电
        // 工作模式：follow 跟随模式（默认）/ standalone 独立模式（可由工程配置或参数设置指定）
        this._workMode = (this.config && this.config.workMode === 'standalone') ? 'standalone' : 'follow';
        this._autoPhase = null;                              // EG/EACB/ABTS 自动控制相位
        this._autoT = 0;                                     // 当前相位计时（s）
        this._live = {};
    }

    _init() {
        this._drawBackground();
        this._drawZones();
        this._drawBuses();
        this._drawWires();
        this._drawTransformer();
        this._drawDcBoard();
        this._drawShoreBox();
        this._drawGens();
        this._drawMotors();
        this._drawLoads();
        this._drawSwitches();
        this._addClickableParts();
        this._computeLive();
        this._refresh();
    }

    // ── 背景与标题 ──
    _drawBackground() {
        const s = this._staticGroup;
        s.add(new Konva.Rect({
            x: 0, y: 0, width: this.width, height: this.height,
            fill: '#e8e8e8', stroke: '#a0a0a0', strokeWidth: 1, cornerRadius: 4,
        }));
        s.add(new Konva.Text({
            x: 0, y: 3, width: this.width, align: 'center',
            text: '船舶低压电力系统单线图', fontSize: 15, fontStyle: 'bold', fill: '#333', listening: false,
        }));
        s.add(new Konva.Text({
            x: 0, y: 852, width: this.width, align: 'center',
            text: '点击发电机启停 · 点击开关分/合闸 · 点击岸电箱投入/退出岸电（EG / EACB / ABTS 为自动模式）',
            fontSize: 13, fill: '#070707', listening: false,
        }));
    }

    // ── 保护区域标注（顶部文字 + 括号 + 竖向虚线分隔）──
    _drawZones() {
        const s = this._staticGroup;
        ZONE_DEFS.forEach(z => {
            const cx = (z.x1 + z.x2) / 2;
            s.add(new Konva.Text({
                x: cx - 80, y: 22, width: 160, align: 'center',
                text: z.label, fontSize: 15, fontStyle: 'bold', fill: '#333', listening: false,
            }));
            s.add(new Konva.Line({
                points: [z.x1, 42, z.x1, 38, z.x2, 38, z.x2, 42],
                stroke: '#555', strokeWidth: 1.2, listening: false,
            }));
        });
        DIVIDER_X.forEach(x => {
            s.add(new Konva.Line({
                points: [x, 46, x, 846], stroke: '#666', strokeWidth: 1.2,
                dash: [7, 5], listening: false,
            }));
        });
    }

    // ── 汇流排（粗线）──
    _drawBuses() {
        const d = this._dynamicGroup;
        const vbus = (x, y1, y2) => {
            const line = new Konva.Line({ points: [x, y1, x, y2], stroke: BUS_OFF, strokeWidth: 5, lineCap: 'round' });
            d.add(line);
            return line;
        };
        // 主汇流排被母线开关（y=390）分为上、下两段；下方截断至 y=650
        this._busNodes = {
            mainUp:  vbus(280, 70, 378.5),
            mainLow: vbus(280, 401.5, 650),
            fdr:  vbus(530, 150, 250),
            lvd:  vbus(575, 440, 515),      // 照明汇流排（原低压配电板汇流排）
            emr:  vbus(445, 640, 790),
        };
        // 汇流排名称
        d.add(new Konva.Text({ x: 260, y: 622, width: 150, rotation: -90, text: '主配电盘汇流排', fontSize: 15, fontStyle: 'bold', fill: '#006400', align: 'center', listening: false }));
        d.add(new Konva.Text({ x: 425, y: 800, width: 150, rotation: -90, text: '应急配电板汇流排', fontSize: 15, fontStyle: 'bold', fill: '#006400', align: 'center', listening: false }));
        d.add(new Konva.Text({ x: 540, y: 258, width: 100, align: 'center', text: '馈电汇流排', fontSize: 15, fontStyle: 'bold', fill: '#006400', listening: false }));
        d.add(new Konva.Text({ x: 525, y: 522, width: 100, align: 'center', text: '照明汇流排', fontSize: 15, fontStyle: 'bold', fill: '#006400', listening: false }));
    }

    // ── 连接导线（细线）──
    _drawWires() {
        const d = this._dynamicGroup;
        this._wireNodes = {};
        WIRE_DEFS.forEach(w => {
            const line = new Konva.Line({ points: w.pts, stroke: OFF, strokeWidth: 1.8, lineCap: 'round' });
            d.add(line);
            this._wireNodes[w.id] = line;
        });
    }

    // ── 变压器（左右两个相交圆）──
    _drawTransformer() {
        const d = this._dynamicGroup;
        const grp = new Konva.Group({ x: 450, y: 480 });
        const c1 = new Konva.Circle({ x: -11, y: 0, radius: 18, fill: 'rgba(200,205,210,0.55)', stroke: '#2c3a45', strokeWidth: 1.5 });
        const c2 = new Konva.Circle({ x: 11, y: 0, radius: 18, fill: 'rgba(200,205,210,0.55)', stroke: '#2c3a45', strokeWidth: 1.5 });
        grp.add(c1, c2);
        grp.add(new Konva.Text({ x: -30, y: -34, width: 60, align: 'center', text: '变压器', fontSize: 12, fontStyle: 'bold', fill: '#006400', listening: false }));
        d.add(grp);
        this._trNode = { c1, c2 };
    }

    // ── 充放电板汇流排（竖直汇流排；右侧 2 组蓄电池 + 2 路断路器带低压负载）──
    _drawDcBoard() {
        const d = this._dynamicGroup;
        // 竖直汇流排（在原位置上移 50px，向下增长 100px，共 255px）
        const bus = new Konva.Line({ points: [1000, 585, 1000, 840], stroke: BUS_OFF, strokeWidth: 5, lineCap: 'round' });
        d.add(bus);
        this._dcBus = bus;
        // 汇流排名称（竖排）
        d.add(new Konva.Text({
            x: 986, y: 787, width: 150, rotation: -90, text: '充放电板汇流排',
            fontSize: 13, fontStyle: 'bold', fill: '#006400', align: 'center', listening: false,
        }));
        // 两组蓄电池（直流直接接入，对称分布在汇流排上）
        this._dcBattNodes = [];
        this._dcBattLabels = [];
        [615, 680].forEach(y => {
            const long = new Konva.Line({ points: [1048, y - 11, 1048, y + 11], stroke: '#2c3a45', strokeWidth: 2 });
            const short = new Konva.Line({ points: [1057, y - 6, 1057, y + 6], stroke: '#2c3a45', strokeWidth: 4, lineCap: 'round' });
            d.add(long, short);
            this._dcBattNodes.push(long, short);
            const label = new Konva.Text({
                x: 1038, y: y - 36, width: 70, align: 'center', text: '蓄电池',
                fontSize: 13, fontStyle: 'bold', fill: '#006400', listening: false,
            });
            d.add(label);
            this._dcBattLabels.push(label);
        });
    }

    // ── 岸电箱（矩形框，可点击；点亮红色表示供电）──
    _drawShoreBox() {
        const d = this._dynamicGroup;
        const b = SHORE_BOX;
        const grp = new Konva.Group({ x: b.x, y: b.y });
        const rect = new Konva.Rect({
            x: 0, y: 0, width: b.w, height: b.h,
            fill: '#d8dde2', stroke: '#2c3a45', strokeWidth: 1.5, cornerRadius: 3,
        });
        const label = new Konva.Text({
            x: 0, y: b.h / 2 - 8, width: b.w, align: 'center',
            text: '岸电箱', fontSize: 13, fontStyle: 'bold', fill: '#333', listening: false,
        });
        grp.add(rect, label);
        d.add(grp);
        this._shoreBox = { grp, rect, label };
    }

    // ── 发电机 ──
    _drawGens() {
        const d = this._dynamicGroup;
        this._genNodes = {};
        GEN_DEFS.forEach(g => {
            const grp = new Konva.Group({ x: g.x, y: g.y });
            const circle = new Konva.Circle({ x: 0, y: 0, radius: g.r, fill: '#8a8f96', stroke: '#2c3a45', strokeWidth: 2 });
            grp.add(circle);
            grp.add(new Konva.Text({ x: -g.r, y: -6, width: g.r * 2, align: 'center', text: g.label, fontSize: 11, fontStyle: 'bold', fill: '#fff', listening: false }));
            d.add(grp);
            this._genNodes[g.id] = { grp, circle, r: g.r };
        });
    }

    // ── 电动机 ──
    _drawMotors() {
        const d = this._dynamicGroup;
        this._motorNodes = {};
        MOTOR_DEFS.forEach(m => {
            const grp = new Konva.Group({ x: m.x, y: m.y });
            const circle = new Konva.Circle({ x: 0, y: 0, radius: 17, fill: '#c8cdd2', stroke: '#2c3a45', strokeWidth: 2 });
            grp.add(circle);
            grp.add(new Konva.Text({ x: -17, y: -8, width: 34, align: 'center', text: 'M', fontSize: 15, fontStyle: 'bold', fill: '#111', listening: false }));
            d.add(grp);
            this._motorNodes[m.id] = { circle, key: m.key };
        });
    }

    // ── 负载终端标记 / 照明灯泡 ──
    _drawLoads() {
        const d = this._dynamicGroup;
        this._loadNodes = {};
        this._bulbNodes = {};
        LOAD_DEFS.forEach(l => {
            if (l.bulb) {
                // 灯泡：玻璃泡 + 灯丝（有电时点亮）
                const grp = new Konva.Group({ x: l.x, y: l.y });
                const circle = new Konva.Circle({ x: 0, y: 0, radius: 11, fill: '#e8eef2', stroke: '#5a6a75', strokeWidth: 1.5 });
                const f1 = new Konva.Line({ points: [-5, -5, 0, 2, 5, -5], stroke: '#8a8f96', strokeWidth: 1.5, lineCap: 'round', lineJoin: 'round' });
                const f2 = new Konva.Line({ points: [-4, 6, 4, 6], stroke: '#8a8f96', strokeWidth: 1.5, lineCap: 'round' });
                grp.add(circle, f1, f2);
                d.add(grp);
                this._bulbNodes[l.id] = { circle, f1, f2, key: l.key };
            } else {
                const bar = new Konva.Line({ points: [l.x, l.y - 8, l.x, l.y + 8], stroke: OFF, strokeWidth: 3.5, lineCap: 'round' });
                d.add(bar);
                this._loadNodes[l.id] = { node: bar, key: l.key };
            }
        });
        d.add(new Konva.Text({ x: 706, y: 192, text: '负载', fontSize: 15, fill: '#333', listening: false }));
        d.add(new Konva.Text({ x: 706, y: 292, text: '重要负载', fontSize: 15, fill: '#333', listening: false }));
        d.add(new Konva.Text({ x: 766, y: 478, text: '照明', fontSize: 15, fill: '#333', listening: false }));
        d.add(new Konva.Text({ x: 706, y: 537, text: '重要负载', fontSize: 15, fill: '#333', listening: false }));
        d.add(new Konva.Text({ x: 636, y: 717, text: '负载', fontSize: 15, fill: '#333', listening: false }));
        d.add(new Konva.Text({ x: 1090, y: 753, width: 80, align: 'center', text: '低压负载', fontSize: 13, fill: '#333', listening: false }));
        d.add(new Konva.Text({ x: 1090, y: 818, width: 80, align: 'center', text: '低压负载', fontSize: 13, fill: '#333', listening: false }));
        // 整流装置符号：三角形 + 竖杠
        d.add(new Konva.Line({ points: [682, 778, 682, 802, 718, 790], closed: true, fill: '#c8cdd2', stroke: '#2c3a45', strokeWidth: 1.5 }));
        d.add(new Konva.Line({ points: [718, 778, 718, 802], stroke: '#2c3a45', strokeWidth: 2 }));
    }

    // ── 开关 ──
    _drawSwitches() {
        const d = this._dynamicGroup;
        this._swNodes = {};
        const SIN35 = 0.574, COS35 = 0.819;
        SW_DEFS.forEach(s => {
            const half = s.half || 11.5;
            const isV = s.orient === 'v';
            const grp = new Konva.Group({ x: s.x, y: s.y });
            const p1 = isV ? { x: 0, y: -half } : { x: -half, y: 0 };
            const p2 = isV ? { x: 0, y: half } : { x: half, y: 0 };
            // 所有开关统一画成断路器形式：静触点 + 动刀闸
            const X = 4;
            grp.add(new Konva.Line({ points: [p1.x - X, p1.y - X, p1.x + X, p1.y + X], stroke: '#006400', strokeWidth: 2.5, lineCap: 'round' }));
            grp.add(new Konva.Line({ points: [p1.x - X, p1.y + X, p1.x + X, p1.y - X], stroke: '#006400', strokeWidth: 2.5, lineCap: 'round' }));
            grp.add(new Konva.Circle({ x: p2.x, y: p2.y, radius: 2.5, fill: '#c8a24a', stroke: '#7a6028', strokeWidth: 0.8 }));
            const blade = new Konva.Line({
                points: isV
                    ? [0, half, -2 * half * SIN35, half - 2 * half * COS35]
                    : [half, 0, half - 2 * half * COS35, -2 * half * SIN35],
                stroke: '#1a252f', strokeWidth: 3, lineCap: 'round',
            });
            grp.add(blade);
            // 文字标注统一上移 6px、字号 12
            const lblText = s.label || s.id;
            grp.add(isV
                ? new Konva.Text({ x: 6, y: -12, width: 100, text: lblText, fontSize: 12, fontStyle: 'bold', fill: '#00008b', listening: false })
                : new Konva.Text({ x: -60, y: -25, width: 120, text: lblText, fontSize: 12, fontStyle: 'bold', fill: '#00008b', align: 'center', listening: false }));
            d.add(grp);
            this._swNodes[s.id] = { grp, blade, orient: s.orient || 'h', half };
        });
    }

    // ── 可点击部件（供工作流 find 步骤识别，并绑定点击交互）──
    _addClickableParts() {
        GEN_DEFS.forEach(g => {
            const hit = this.addClickablePart(
                `gen-${g.id}`, g.x - g.r - 5, g.y - g.r - 5, (g.r + 5) * 2, (g.r + 5) * 2);
            hit.on('click tap', () => this.toggleGen(g.id));
        });
        SW_DEFS.forEach(s => {
            const hw = (s.half || 11.5) + 4;
            const hit = this.addClickablePart(`sw-${s.id}`, s.x - hw, s.y - hw, hw * 2, hw * 2);
            hit.on('click tap', () => this.toggleSwitch(s.id));
        });
        const b = SHORE_BOX;
        const hit = this.addClickablePart('shorebox', b.x, b.y, b.w, b.h);
        hit.on('click tap', () => this.toggleShore());
    }

    getClickablePartCenter(partId) {
        const gx = this.group ? this.group.x() : 0;
        const gy = this.group ? this.group.y() : 0;
        if (partId === 'shorebox') return { x: gx + SHORE_BOX.cx, y: gy + SHORE_BOX.cy };
        let m = /^sw-(.+)$/.exec(partId);
        if (m) {
            const s = SW_DEFS.find(d => d.id === m[1]);
            if (s) return { x: gx + s.x, y: gy + s.y };
        }
        m = /^gen-(.+)$/.exec(partId);
        if (m) {
            const g = GEN_DEFS.find(d => d.id === m[1]);
            if (g) return { x: gx + g.x, y: gy + g.y };
        }
        return null;
    }

    // ── 交互 API ──
    // 岸电开关约束：
    //   1) 失压保护：只有岸电箱有电（this._shore）时才能合闸；运行中失压则自动跳闸
    //   2) 与 4 台发电机主开关互锁：任一主开关合闸时岸电无法合闸；岸电合闸时主开关无法合闸
    _interlockBlock(id, closing) {
        if (!closing) return null;                       // 分闸不受限制
        const isGen = GEN_MAIN_SW.indexOf(id) !== -1;
        // ACB1~ACB3 失压保护：对应发电机未运行 → 无法合闸
        if (/^ACB[123]$/.test(id) && !this._gens['G' + id.slice(3)]) {
            return `发电机 G${id.slice(3)} 未运行（失压）：${id} 无法合闸`;
        }
        if (id === 'SWSHORE') {
            if (!this._shore) return '岸电箱失压，岸电开关无法合闸';
            if (GEN_MAIN_SW.some(g => this._sw[g])) {
                return '与发电机主开关互锁：请先分断全部发电机主开关，再合岸电';
            }
        }
        if (isGen && this._sw.SWSHORE) {
            return '与岸电开关互锁：请先分断岸电开关，再合发电机主开关';
        }
        return null;
    }

    // 失压保护跳闸：ACB1~ACB3 对应发电机未运行（失压）时自动分断（独立模式）
    _enforceAcbUv() {
        if (this._isFollow()) return false;
        let tripped = false;
        ['1', '2', '3'].forEach(n => {
            if (this._sw['ACB' + n] && !this._gens['G' + n]) {
                this._sw['ACB' + n] = false;
                this._tip(`ACB${n} 失压保护：发电机 G${n} 未运行，主开关自动跳闸`);
                tripped = true;
            }
        });
        return tripped;
    }

    // 失压保护跳闸：岸电箱失电时，运行中的岸电开关自动分断
    _enforceShoreUv() {
        if (!this._shore && this._sw.SWSHORE) {
            this._sw.SWSHORE = false;
            this._tip('岸电箱失压，岸电开关失压跳闸');
            return true;
        }
        return false;
    }

    _tip(msg) {
        if (this.sys && typeof this.sys.showFloatingTip === 'function') {
            this.sys.showFloatingTip(msg, 2600);
        }
    }

    // ── 工作模式 ──
    /** 是否跟随模式（默认） */
    _isFollow() { return this._workMode !== 'standalone'; }
    _lv() { return (this.sys && this.sys.comps) ? this.sys.comps.lv_switch_panel : null; }
    _ip() { return (this.sys && this.sys.comps) ? this.sys.comps.important_panel : null; }
    /** 跟随模式下不可手动操作的设备清单 */
    _FOLLOW_LOCKED() {
        return ['G1', 'G2', 'G3', 'ACB1', 'ACB2', 'ACB3', 'SWSHORE', 'SWEMC', 'EG', 'EACB', 'ABTS'];
    }
    _followBlocked(id) {
        if (!this._isFollow()) return false;
        if (this._FOLLOW_LOCKED().indexOf(id) === -1) return false;
        this._tip('跟随模式：该设备不可手动操作，自动跟随主配电板 / 重要配电装置状态');
        return true;
    }
    /** 跟随模式：把主配电板与重要配电装置的状态同步到单线图 */
    _applyFollow() {
        if (!this._isFollow()) return;
        const lv = this._lv(), ip = this._ip();
        if (lv) {
            if (typeof lv.getGenState === 'function') {
                ['G1', 'G2', 'G3'].forEach((sid, i) => {
                    const st = lv.getGenState('gen' + (i + 1));      // gen1 ↔ G1、gen2 ↔ G2、gen3 ↔ G3
                    if (!st) return;
                    this._gens[sid] = !!st.run;                      // G1~G3 跟随对应机组运行状态
                    this._sw['ACB' + (i + 1)] = !!st.cb;             // ACB1~ACB3 跟随对应机组主开关
                });
            }
            if (typeof lv.getMCBState === 'function') {
                this._sw.SWSHORE = !!lv.getMCBState('ld-loadR-4-1'); // 岸电（开关）
                this._sw.SWEMC = !!lv.getMCBState('ld-loadR-4-0');   // EMCB
            }
            const sh = (typeof lv.getShoreLive === 'function') ? lv.getShoreLive() : 0;
            this._shore = sh !== 0;                                  // 主配电板岸电开关下端有电 → 岸电箱激活
        }
        if (ip) {
            if (typeof ip.getEmergencyGen === 'function') this._gens.EG = !!ip.getEmergencyGen();   // EG
            if (typeof ip.isEGenClosed === 'function') this._sw.EACB = !!ip.isEGenClosed();          // EACB
            if (typeof ip.isTieClosed === 'function') this._sw.ABTS = !!ip.isTieClosed();            // ABTS
        }
    }
    /** 工作模式配置项 */
    getConfigFields() {
        return [{
            label: '工作模式', key: 'workMode', type: 'select',
            options: [{ value: 'follow', label: '跟随模式' }, { value: 'standalone', label: '独立模式' }],
            get: c => c._workMode,
        }];
    }
    onConfigUpdate(cfg) {
        if (cfg && cfg.workMode) this._workMode = (cfg.workMode === 'standalone') ? 'standalone' : 'follow';
        this.config = { ...(this.config || {}), ...(cfg || {}) };
        this._refresh();
        if (this.sys && this.sys.requestRedraw) this.sys.requestRedraw();
    }

    toggleSwitch(id) {
        if (this._sw[id] === undefined) return;
        if (this._followBlocked(id)) return;             // 跟随模式：受跟随设备不可手动操作
        if (AUTO_DEVICES.indexOf(id) !== -1) {
            this._tip((id === 'ABTS' ? 'ABTS 自动转换开关' : '应急发电机出口断路器 EACB') + ' 为自动模式，不可手动操作');
            return;
        }
        const closing = !this._sw[id];
        const blocked = this._interlockBlock(id, closing);
        if (blocked) { this._tip(blocked); return; }
        this._sw[id] = closing;
        this._refresh();
    }

    setSwitch(id, on) {
        if (this._sw[id] === undefined) return;
        if (this._followBlocked(id)) return;
        if (AUTO_DEVICES.indexOf(id) !== -1) return;     // 自动设备不接受手动设置
        const closing = !!on;
        if (this._interlockBlock(id, closing)) return;   // 互锁：拒绝该合闸操作
        this._sw[id] = closing;
        this._refresh();
    }

    toggleGen(id) {
        if (this._gens[id] === undefined) return;
        if (this._followBlocked(id)) return;
        if (id === AUTO_GEN) { this._tip('应急发电机 EG 为自动模式，不可手动操作'); return; }
        this._gens[id] = !this._gens[id];
        this._refresh();
    }

    setGen(id, on) {
        if (this._gens[id] === undefined) return;
        if (this._followBlocked(id)) return;
        if (id === AUTO_GEN) return;                     // 应急发电机不接受手动设置
        this._gens[id] = !!on;
        this._refresh();
    }

    toggleShore() {
        if (this._followBlocked('shorebox')) return;
        this._shore = !this._shore;
        this._enforceShoreUv();
        this._refresh();
    }

    setShore(on) {
        if (this._followBlocked('shorebox')) return;
        this._shore = !!on;
        this._enforceShoreUv();
        this._refresh();
    }

    getSwitchState(id) { return !!this._sw[id]; }
    getGenState(id) { return !!this._gens[id]; }
    getShoreState() { return !!this._shore; }

    // ── 带电计算 ──
    _computeLive() {
        this._enforceShoreUv();                      // 岸电箱失压 → 岸电开关自动跳闸
        this._enforceAcbUv();                        // 独立模式：ACB1~ACB3 失压自动跳闸
        const S = this._sw, G = this._gens;
        const g1 = G.G1 && S.ACB1;
        const g2 = G.G2 && S.ACB2;
        const g3 = G.G3 && S.ACB3;
        const eg = G.EG && S.EACB;
        const shore = this._shore && S.SWSHORE;      // 岸电箱供电且岸电开关合闸
        const srcUp = g1 || g2 || shore;             // 上段电源
        const srcLow = g3;                           // 下段电源
        const busTie = S.BUSSW;                      // 母线开关
        const mainUp = srcUp || (srcLow && busTie);
        const mainLow = srcLow || (srcUp && busTie);

        const mcb1 = mainUp && S.MCB1;               // 上段：电动机 M1
        const imp1 = mainUp && S.SWIMP1;             // 上段：重要负载1
        const fdr2 = mainUp && S.SWFDR2;             // 上段 → 馈电汇流排（仅 F2 供电）
        const fdr = fdr2;

        const trFeed = mainLow && S.MCBTR;           // 下段：变压器
        const imp2 = mainLow && S.SWIMP2;            // 下段：重要负载2（直接带负载）
        const lvd = trFeed;                          // 照明汇流排：仅由变压器供电

        const emc = mainLow && S.SWEMC;              // 下段 → ABTS → 应急汇流排
        const abts = emc && S.ABTS;
        const emr = abts || eg;

        const rectFeed = emr && S.SWRECT;            // 整流装置工作（充电）
        const rectOut = rectFeed;                    // 整流装置输出
        const batt = true;                           // 蓄电池直接接入充放电板汇流排 → 直流母线始终带电
        const bld1 = batt && S.SWBC1;                // 低压负载断路器 1
        const bld2 = batt && S.SWBC2;                // 低压负载断路器 2

        this._live = {
            mainUp, mainLow, fdr, lvd, emr, batt, busTie,
            g1, g2, g3, eg,
            shore, shoreBox: this._shore,
            shoreWire: this._shore,                  // 岸电箱激活 → 岸电箱左侧连线带电（红）
            mcb1, fdr2, imp1,
            ld1: fdr && S.SWLD1, ld2: fdr && S.SWLD2,
            m2: fdr && S.SWM2,
            trFeed, imp2, emc, abts, abtsLeft: emc,
            lv1: lvd && S.SWLV1, lv2: lvd && S.SWLV2,
            e1: emr && S.SWE1, e2: emr && S.SWE2,
            rectFeed, rectOut, bld1, bld2,
        };
    }

    _wireLive(key) { return !!this._live[key]; }

    // ── EG / EACB / ABTS 自动控制状态机 ──
    //   输入：ABTS 左侧是否有电（下段主汇流排带电 且 应急 MCB 合闸）
    //   相位：
    //     normal  — 左侧有电：ABTS 合、EACB 分、EG 停
    //     loss    — 左侧失电：ABTS 立即分 → 5s 后 EG 起动 → 再 8s EACB 合
    //     restore — EACB 合闸期间左侧恢复：EACB 立即分 → 2s 后 ABTS 合 → 再 8s EG 停
    //   ABTS 与 EACB 天然互锁（互斥），不会同时闭合。
    _autoTick(dt) {
        const S = this._sw;
        const left = !!(this._live.mainLow && S.SWEMC);
        if (this._autoPhase === null) {
            this._autoPhase = left ? 'normal' : 'loss';
            this._autoT = 0;
        }
        this._autoT += dt;

        if (this._autoPhase === 'normal') {
            S.ABTS = true;
            S.EACB = false;
            this._gens.EG = false;
            if (!left) {
                this._autoPhase = 'loss';
                this._autoT = 0;
                S.ABTS = false;                      // 左侧失电：ABTS 立即分断
            }
        } else if (this._autoPhase === 'loss') {
            S.ABTS = false;                          // 互锁：ABTS 保持分断
            if (this._autoT < AUTO_T_EG_START) this._gens.EG = false;   // 5s 到达前保持停机
            if (left) {
                if (S.EACB) {                        // EACB 已合 → 立即分断，进入恢复相位
                    S.EACB = false;
                    this._autoPhase = 'restore';
                    this._autoT = 0;
                } else {                             // 尚未合闸 → 取消起动，回到正常
                    this._gens.EG = false;
                    this._autoPhase = 'normal';
                    this._autoT = 0;
                }
            } else {
                if (this._autoT >= AUTO_T_EG_START) this._gens.EG = true;            // 5s 起动 EG
                if (this._autoT >= AUTO_T_EACB_CLOSE && !S.SWSHORE) S.EACB = true;   // 再 8s 合 EACB（受岸电互锁限制）
            }
        } else { // restore
            S.EACB = false;                          // 互锁：EACB 保持分断
            if (!left) {
                this._autoPhase = 'loss';
                this._autoT = 0;
                S.ABTS = false;
            } else {
                if (this._autoT >= AUTO_T_ABTS_CLOSE) S.ABTS = true;                 // 2s 恢复 ABTS
                if (this._autoT >= AUTO_T_EG_STOP) this._gens.EG = false;            // 再 8s 停 EG
            }
        }
    }

    getAutoState() {
        return {
            phase: this._autoPhase, t: this._autoT,
            abts: !!this._sw.ABTS, eacb: !!this._sw.EACB, eg: !!this._gens.EG,
        };
    }

    // ── 仿真主循环 ──
    tick(dt) {
        this._computeLive();
        if (this._isFollow()) this._applyFollow();   // 跟随模式：跟随主配电板 / 重要配电装置
        else this._autoTick(dt);                     // 独立模式：自动投切 EG / EACB / ABTS
        this._computeLive();         // 自动动作后重算带电状态
        this._refresh();
        if (this.sys && typeof this.sys.requestRedraw === 'function') this.sys.requestRedraw();
    }

    _refresh() {
        // 导线
        WIRE_DEFS.forEach(w => {
            const n = this._wireNodes[w.id];
            if (n) n.stroke(this._live[w.key] ? RED : OFF);
        });
        // 汇流排（主汇流排分上、下两段）
        if (this._busNodes) {
            this._busNodes.mainUp.stroke(this._live.mainUp ? RED : BUS_OFF);
            this._busNodes.mainLow.stroke(this._live.mainLow ? RED : BUS_OFF);
            this._busNodes.fdr.stroke(this._live.fdr ? RED : BUS_OFF);
            this._busNodes.lvd.stroke(this._live.lvd ? RED : BUS_OFF);
            this._busNodes.emr.stroke(this._live.emr ? RED : BUS_OFF);
        }
        // 岸电箱：点亮红色 = 供电状态
        if (this._shoreBox) {
            const on = !!this._shore;
            this._shoreBox.rect.fill(on ? 'rgba(208,32,32,0.20)' : '#d8dde2');
            this._shoreBox.rect.stroke(on ? RED : '#2c3a45');
            this._shoreBox.label.fill(on ? RED : '#333');
        }
        // 发电机
        GEN_DEFS.forEach(g => {
            const n = this._genNodes[g.id];
            if (n) n.circle.fill(this._gens[g.id] ? GEN_RUN : '#8a8f96');
        });
        // 开关刀闸
        const SIN35 = 0.574, COS35 = 0.819;
        SW_DEFS.forEach(s => {
            const n = this._swNodes[s.id];
            if (!n) return;
            const h = n.half;
            if (this._sw[s.id]) {
                n.blade.points(n.orient === 'v' ? [0, -h, 0, h] : [-h, 0, h, 0]);
            } else {
                n.blade.points(n.orient === 'v'
                    ? [0, h, -2 * h * SIN35, h - 2 * h * COS35]
                    : [h, 0, h - 2 * h * COS35, -2 * h * SIN35]);
            }
        });
        // 变压器
        if (this._trNode) {
            const pLive = this._live.trFeed;
            const sLoad = this._live.lvd;
            this._trNode.c1.fill(pLive ? 'rgba(192,48,48,0.55)' : 'rgba(200,205,210,0.55)');
            this._trNode.c2.fill(sLoad ? 'rgba(31,95,196,0.55)' : (pLive ? 'rgba(232,160,160,0.55)' : 'rgba(200,205,210,0.55)'));
        }
        // 电动机
        Object.keys(this._motorNodes).forEach(k => {
            const m = this._motorNodes[k];
            m.circle.fill(this._live[m.key] ? '#2e8b2e' : '#c8cdd2');
        });
        // 负载标记
        Object.keys(this._loadNodes).forEach(k => {
            const l = this._loadNodes[k];
            l.node.stroke(this._live[l.key] ? RED : OFF);
        });
        // 照明灯泡：有电时点亮
        Object.keys(this._bulbNodes).forEach(k => {
            const b = this._bulbNodes[k];
            const on = !!this._live[b.key];
            b.circle.fill(on ? '#ffe066' : '#e8eef2');
            b.circle.stroke(on ? '#e0a020' : '#5a6a75');
            b.f1.stroke(on ? '#ff9d00' : '#8a8f96');
            b.f2.stroke(on ? '#ff9d00' : '#8a8f96');
        });
        // 充放电板汇流排 + 蓄电池
        if (this._dcBus) this._dcBus.stroke(this._live.batt ? RED : BUS_OFF);
        // 左侧带电（整流装置输出）即为浮充状态：两组蓄电池（含文字）显示亮蓝色
        const floating = !!this._live.rectOut;
        const battColor = floating ? FLOAT_BLUE : (this._live.batt ? RED : BUS_OFF);
        if (this._dcBattNodes) this._dcBattNodes.forEach(n => n.stroke(battColor));
        if (this._dcBattLabels) this._dcBattLabels.forEach(t => t.fill(floating ? FLOAT_BLUE : '#006400'));

        this.markDirty();
    }

    destroy() { super.destroy?.(); }
}