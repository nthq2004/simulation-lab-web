import { BaseComponent } from './BaseComponent.js';

/**
 * HvPowerOneLine 船舶高压电力系统单线图
 *
 * 参照图片《船舶高压电力系统单线图》：
 *   - 4 台主发电机 DG1-DG4（6600V）+ 1 台辅助发电机 DG5（400V）
 *   - 高压母线 HBBA（左）/ HBBB（右），经 HHB TIE1 / HHB TIE2 母联
 *   - 高压母线电阻接地（接地开关 05 / 06）
 *   - 变压器：TR1 / TR2（6600/400V）、PTR1 / PTR2（6600V/2×725V）
 *   - 低压母线 MBB（400V），经 MBUS TIE1 分段
 *   - 负载经开关 01~12 接入
 *
 * 显示：
 *   - 淡灰色不透明背景
 *   - 汇流排粗线、连接导线细线
 *   - 通电时（母线/导线/变压器/负载）变为红色
 *
 * 交互（自包含状态）：
 *   - 点击开关 → 合闸/分闸
 *   - 点击发电机 → 起动/停止（运行时绿色填充）
 */
const GEN_DEFS = [
    { id: 'DG1', x: 160, y: 70, r: 24, label: 'DG1\n3360KVA 6600V' },
    { id: 'DG2', x: 390, y: 70, r: 24, label: 'DG2\n3360KVA 6600V' },
    { id: 'DG3', x: 710, y: 70, r: 24, label: 'DG3\n2360KVA 6600V' },
    { id: 'DG4', x: 940, y: 70, r: 24, label: 'DG4\n3360KVA 6600V' },
    { id: 'DG5', x: 690, y: 660, r: 20, label: 'DG5\n400KW 400V' },
];
const SW_DEFS = [
    { id: 'HACB1', x: 160, y: 150, orient: 'v' },
    { id: '01',    x: 160, y: 205, orient: 'v' },
    { id: 'HACB2', x: 390, y: 150, orient: 'v' },
    { id: '02',    x: 390, y: 205, orient: 'v' },
    { id: 'HACB3', x: 710, y: 150, orient: 'v' },
    { id: '03',    x: 710, y: 205, orient: 'v' },
    { id: 'HACB4', x: 940, y: 150, orient: 'v' },
    { id: '04',    x: 940, y: 205, orient: 'v' },
    { id: '07',    x: 495, y: 260, orient: 'h' },
    { id: 'HBUSTIE', x: 545, y: 260, orient: 'h' },
    { id: '08',    x: 595, y: 260, orient: 'h' },
    { id: 'VCB_PTR1', x: 390, y: 310, orient: 'v' },
    { id: 'VCB_TR1',  x: 275, y: 310, orient: 'v' },
    { id: 'VCB_TR2',  x: 825, y: 310, orient: 'v' },
    { id: 'VCB_PTR2', x: 710, y: 310, orient: 'v' },
    { id: '05',    x: 100, y: 320, orient: 'v' },
    { id: '06',    x: 1000, y: 320, orient: 'v' },
    { id: 'ACB_TR1', x: 275, y: 485, orient: 'v' },
    { id: 'ACB_TR2', x: 825, y: 485, orient: 'v' },
    { id: 'ACB1',  x: 690, y: 600, orient: 'v' },
    { id: 'MBUSTIE', x: 550, y: 560, orient: 'h' },
];
const TR_DEFS = [
    { id: 'PTR1', x: 390, y: 370, label: 'PTR1', r: 22, power: false },
    { id: 'TR1',  x: 275, y: 400, label: 'TR1',  r: 24, power: true },
    { id: 'TR2',  x: 825, y: 400, label: 'TR2',  r: 24, power: true },
    { id: 'PTR2', x: 710, y: 370, label: 'PTR2', r: 22, power: false },
];
// 连接导线：pts 折线路径；bus = 判定母线（busKey: 'HBBA'|'HBBB'|'MBB'|'DGx'|'MBB-side'）
const WIRE_DEFS = [
    // 发电机出口：DG → HACB → 01 → HBBA
    { id: 'w1',  pts: [160, 94, 160, 138.5], key: 'DG1' },
    { id: 'w2',  pts: [160, 161.5, 160, 193.5], key: 'DG1' },
    { id: 'w3',  pts: [160, 216.5, 160, 260], key: 'DG1' },
    { id: 'w4',  pts: [390, 94, 390, 138.5], key: 'DG2' },
    { id: 'w5',  pts: [390, 161.5, 390, 193.5], key: 'DG2' },
    { id: 'w6',  pts: [390, 216.5, 390, 260], key: 'DG2' },
    { id: 'w7',  pts: [710, 94, 710, 138.5], key: 'DG3' },
    { id: 'w8',  pts: [710, 161.5, 710, 193.5], key: 'DG3' },
    { id: 'w9',  pts: [710, 216.5, 710, 260], key: 'DG3' },
    { id: 'w10', pts: [940, 94, 940, 138.5], key: 'DG4' },
    { id: 'w11', pts: [940, 161.5, 940, 193.5], key: 'DG4' },
    { id: 'w12', pts: [940, 216.5, 940, 260], key: 'DG4' },
    // 变压器原边：母线 → 真空断路器 → 变压器
    { id: 'w13a', pts: [390, 260, 390, 298.5], key: 'HBBA' },
    { id: 'w13b', pts: [390, 321.5, 390, 348], key: 'PTR1p' },
    { id: 'w14a', pts: [275, 260, 275, 298.5], key: 'HBBA' },
    { id: 'w14b', pts: [275, 321.5, 275, 362], key: 'TR1p' },
    { id: 'w15a', pts: [825, 260, 825, 298.5], key: 'HBBB' },
    { id: 'w15b', pts: [825, 321.5, 825, 362], key: 'TR2p' },
    { id: 'w16a', pts: [710, 260, 710, 298.5], key: 'HBBB' },
    { id: 'w16b', pts: [710, 321.5, 710, 348], key: 'PTR2p' },
    // 变压器副边 → 开关 → MBB
    { id: 'w19', pts: [275, 438, 275, 473.5], key: 'TR1s' },
    { id: 'w20', pts: [275, 496.5, 275, 560], key: 'MBUSL' },
    { id: 'w21', pts: [825, 438, 825, 473.5], key: 'TR2s' },
    { id: 'w22', pts: [825, 496.5, 825, 560], key: 'MBUSR' },
    // DG5 → ACB1 → MBB
    { id: 'w28', pts: [690, 611.5, 690, 640], key: 'DG5' },
    { id: 'w29', pts: [690, 588.5, 690, 560], key: 'MBUSR' },
];

export class HvPowerOneLine extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);
        this.width  = 1080;
        this.height = 780;
        this.type  = 'hv_one_line';
        this.cache = 'fixed';
        this._initGroups();
        this._initState();
        this._init();
    }

    _initState() {
        this._gens = { DG1: false, DG2: false, DG3: false, DG4: false, DG5: false };
        this._sw = {};
        SW_DEFS.forEach(s => { this._sw[s.id] = false; });   // 所有开关默认断开
    }

    _init() {
        this._drawBackground();
        this._drawBuses();
        this._drawWires();
        this._drawGens();
        this._drawSwitches();
        this._drawTransformers();
        this._bindHits();
    }

    // ── 淡灰不透明背景 ──
    _drawBackground() {
        this._staticGroup.add(new Konva.Rect({
            x: 0, y: 0, width: this.width, height: this.height,
            fill: '#e8e8e8', stroke: '#a0a0a0', strokeWidth: 1, cornerRadius: 4,
        }));
        this._staticGroup.add(new Konva.Text({
            x: 0, y: 4, width: this.width, align: 'center',
            text: '船舶高压电力系统单线图', fontSize: 13, fontStyle: 'bold', fill: '#333', listening: false,
        }));
    }

    // ── 汇流排（粗线）──
    _drawBuses() {
        const d = this._dynamicGroup;
        const bus = (x1, x2, y, label) => {
            const line = new Konva.Line({ points: [x1, y, x2, y], stroke: '#2c3a45', strokeWidth: 6, lineCap: 'round' });
            d.add(line);
            d.add(new Konva.Text({ x: x1, y: y - 20, text: label, fontSize: 15, fontStyle: 'bold', fill: '#006400', listening: false }));
            return line;
        };
        this._busNodes = {
            HBBA: bus(90, 453.5, 260, 'HBBA 6600V'),
            HBBB: bus(636.5, 1010, 260, 'HBBB 6600V'),
            MBUSL: bus(90, 508.5, 560, 'MBBA 400V'),
            MBUSR: bus(591.5, 1010, 560, 'MBBB 400V'),
        };
    }

    // ── 连接导线（细线）──
    _drawWires() {
        const d = this._dynamicGroup;
        this._wireNodes = {};
        WIRE_DEFS.forEach(w => {
            const line = new Konva.Line({ points: w.pts, stroke: '#7a8494', strokeWidth: 1.6, lineCap: 'round' });
            d.add(line);
            this._wireNodes[w.id] = line;
        });
        // 母联 TIE1/TIE2 段（HBBA↔HBBB 之间的导线）
        const tie1 = new Konva.Line({ points: [453.5, 260, 483.5, 260], stroke: '#7a8494', strokeWidth: 1.6 });
        const tie2 = new Konva.Line({ points: [506.5, 260, 533.5, 260], stroke: '#7a8494', strokeWidth: 1.6 });
        const tie3 = new Konva.Line({ points: [556.5, 260, 583.5, 260], stroke: '#7a8494', strokeWidth: 1.6 });
        const tie4 = new Konva.Line({ points: [606.5, 260, 636.5, 260], stroke: '#7a8494', strokeWidth: 1.6 });
        d.add(tie1, tie2, tie3, tie4);
        this._wireNodes.tie1 = tie1;
        this._wireNodes.tie2 = tie2;
        this._wireNodes.tie3 = tie3;
        this._wireNodes.tie4 = tie4;
        // MBUSTIE 两端 20px 引线（连接 MBB 母线分段）
        const mTie1 = new Konva.Line({ points: [508.5, 560, 538.5, 560], stroke: '#7a8494', strokeWidth: 1.6 });
        const mTie2 = new Konva.Line({ points: [561.5, 560, 591.5, 560], stroke: '#7a8494', strokeWidth: 1.6 });
        d.add(mTie1, mTie2);
        this._wireNodes.mTie1 = mTie1;
        this._wireNodes.mTie2 = mTie2;
        // 接地导线（05/06 → 母线），端点接到开关上静触点（311）
        const g1 = new Konva.Line({ points: [100, 260, 100, 308.5], stroke: '#7a8494', strokeWidth: 1.6 });
        const g2 = new Konva.Line({ points: [1000, 260, 1000, 308.5], stroke: '#7a8494', strokeWidth: 1.6 });
        d.add(g1, g2);
        this._wireNodes.g1 = g1;
        this._wireNodes.g2 = g2;
        // 接地符号：05/06 下静触点（329）→ 接地线 + 三横接地符号
        const groundSym = (x) => {
            const v = new Konva.Line({ points: [x, 331.5, x, 345], stroke: '#5a6a75', strokeWidth: 1.6 });
            const h1 = new Konva.Line({ points: [x - 11, 345, x + 11, 345], stroke: '#5a6a75', strokeWidth: 2 });
            const h2 = new Konva.Line({ points: [x - 7, 351, x + 7, 351], stroke: '#5a6a75', strokeWidth: 2 });
            const h3 = new Konva.Line({ points: [x - 3, 357, x + 3, 357], stroke: '#5a6a75', strokeWidth: 2 });
            d.add(v, h1, h2, h3);
        };
        groundSym(100);
        groundSym(1000);
    }

    _drawGens() {
        const d = this._dynamicGroup;
        this._genNodes = {};
        GEN_DEFS.forEach(g => {
            const grp = new Konva.Group({ x: g.x, y: g.y });
            grp.add(new Konva.Circle({ x: 0, y: 0, radius: g.r, fill: '#8a8f96', stroke: '#2c3a45', strokeWidth: 2 }));
            grp.add(new Konva.Text({ x: -g.r, y: -g.r - 12, width: g.r * 2, text: g.id, fontSize: 15, fontStyle: 'bold', fill: '#006400', align: 'center', listening: false }));
            d.add(grp);
            this._genNodes[g.id] = { grp, circle: grp.getChildren()[0], r: g.r };
        });
    }

    _drawSwitches() {
        const d = this._dynamicGroup;
        this._swNodes = {};
        SW_DEFS.forEach(s => {
            const grp = new Konva.Group({ x: s.x, y: s.y });
            const half = 11.5;
            const p1 = s.orient === 'v' ? { x: 0, y: -half } : { x: -half, y: 0 };
            const p2 = s.orient === 'v' ? { x: 0, y: half } : { x: half, y: 0 };
            const isIso = ['01', '02', '03', '04', '05', '06', '07', '08'].includes(s.id);
            if (isIso && s.orient === 'v') {
                // 隔离开关（竖直）：上方静触点用横向短粗线段
                grp.add(new Konva.Line({ points: [-5, -half, 5, -half], stroke: '#8b0000', strokeWidth: 3.5, lineCap: 'round' }));
            } else if (isIso && s.orient === 'h') {
                // 隔离开关（水平）：左边静触点用竖向短粗线段
                grp.add(new Konva.Line({ points: [-half, -5, -half, 5], stroke: '#8b0000', strokeWidth: 3.5, lineCap: 'round' }));
            } else {
                // 断路器：与动触点接触的静触点用 × 符号
                const X = 4;
                grp.add(new Konva.Line({ points: [p1.x - X, p1.y - X, p1.x + X, p1.y + X], stroke: '#006400', strokeWidth: 2.5, lineCap: 'round' }));
                grp.add(new Konva.Line({ points: [p1.x - X, p1.y + X, p1.x + X, p1.y - X], stroke: '#006400', strokeWidth: 2.5, lineCap: 'round' }));
            }
            grp.add(new Konva.Circle({ x: p2.x, y: p2.y, radius: 2.5, fill: '#c8a24a', stroke: '#7a6028', strokeWidth: 0.8 }));
            // 初始刀闸用断开态（动触点偏左上 35°），避免静触点间显示连线
            const blade = new Konva.Line({
                points: s.orient === 'v'
                    ? [0, half, -2 * half * 0.574, half - 2 * half * 0.819]
                    : [half, 0, half - 2 * half * 0.819, -2 * half * 0.574],
                stroke: '#1a252f', strokeWidth: 3, lineCap: 'round',
            });
            grp.add(blade);
            // 开关标号：竖直开关标右侧，水平开关标下方
            const lbl = s.orient === 'v'
                ? new Konva.Text({ x: 5, y: -5, width: 64, text: s.id, fontSize: 12, fontStyle: 'bold', fill: '#00008b', listening: false })
                : new Konva.Text({ x: -32, y: 12, width: 64, text: s.id, fontSize: 12, fontStyle: 'bold', fill: '#00008b', align: 'center', listening: false });
            grp.add(lbl);
            d.add(grp);
            this._swNodes[s.id] = { grp, blade, orient: s.orient, half };
        });
    }

    _drawTransformers() {
        const d = this._dynamicGroup;
        this._trNodes = {};
        TR_DEFS.forEach(t => {
            const grp = new Konva.Group({ x: t.x, y: t.y });
            let c1, c2;
            if (t.power) {
                // 电力变压器：上下两个相交圆（上原边、下副边），半透明填充（相交处可见）
                c1 = new Konva.Circle({ x: 0, y: -t.r * 0.6, radius: t.r, fill: 'rgba(200,205,210,0.55)', stroke: '#2c3a45', strokeWidth: 1.5 });
                c2 = new Konva.Circle({ x: 0, y: t.r * 0.6, radius: t.r, fill: 'rgba(200,205,210,0.55)', stroke: '#2c3a45', strokeWidth: 1.5 });
            } else {
                // 测量/保护变压器：单圆
                c1 = new Konva.Circle({ x: 0, y: 0, radius: t.r, fill: '#c8cdd2', stroke: '#2c3a45', strokeWidth: 1.5 });
                c2 = new Konva.Circle({ x: 0, y: 0, radius: t.r * 0.7, fill: 'rgba(255,255,255,0.3)', stroke: '#5a6a75', strokeWidth: 1 });
            }
            grp.add(c1, c2);
            grp.add(new Konva.Text({ x: -t.r, y: -t.r - 12, width: t.r * 2, text: t.label, fontSize: 15, fontStyle: 'bold', fill: '#006400', align: 'center', listening: false }));
            d.add(grp);
            this._trNodes[t.id] = { grp, c1, c2, r: t.r, power: t.power };
        });
    }

    _bindHits() {
        const mkHit = (x, y, w, h, fn) => {
            const hit = new Konva.Rect({ x: x - w / 2, y: y - h / 2, width: w, height: h, fill: 'rgba(255,255,255,0.01)', listening: true, cursor: 'pointer' });
            this._dynamicGroup.add(hit);
            hit.on('click tap', (e) => { e.cancelBubble = true; fn(); });
        };
        SW_DEFS.forEach(s => mkHit(s.x, s.y, 26, 30, () => this.toggleSwitch(s.id)));
        GEN_DEFS.forEach(g => mkHit(g.x, g.y, g.r * 2 + 10, g.r * 2 + 10, () => this.toggleGen(g.id)));
    }

    toggleSwitch(id) {
        if (this._sw[id] === undefined) return;
        this._sw[id] = !this._sw[id];
        this._refresh();
    }

    toggleGen(id) {
        this._gens[id] = !this._gens[id];
        this._refresh();
    }

    getSwitchState(id) { return !!this._sw[id]; }
    getGenState(id)    { return !!this._gens[id]; }

    // ── 母线带电计算（固定点迭代）──
    _computeBusLive() {
        const S = this._sw, G = this._gens;
        const localHBBA = (G.DG1 && S.HACB1 && S['01']) || (G.DG2 && S.HACB2 && S['02']);
        const localHBBB = (G.DG3 && S.HACB3 && S['03']) || (G.DG4 && S.HACB4 && S['04']);
        const tie = S['07'] && S.HBUSTIE && S['08'];
        let h1 = localHBBA, h2 = localHBBB;
        if (tie) { if (h2) h1 = true; if (h1) h2 = true; }
        let mL = (h1 && S.VCB_TR1 && S.ACB_TR1);
        let mR = (h2 && S.VCB_TR2 && S.ACB_TR2) || (G.DG5 && S.ACB1);
        if (S.MBUSTIE) { if (mR) mL = true; if (mL) mR = true; }
        this._bus = { HBBA: h1, HBBB: h2, MBUSL: mL, MBUSR: mR };
    }

    _busLive(bus) { return this._bus ? !!this._bus[bus] : false; }

    // ── 导线通电判定 ──
    _wireLive(key) {
        const S = this._sw, G = this._gens;
        switch (key) {
            case 'HBBA':  return this._busLive('HBBA');
            case 'HBBB':  return this._busLive('HBBB');
            case 'MBUSL': return this._busLive('MBUSL');
            case 'MBUSR': return this._busLive('MBUSR');
            case 'MBUSTIE': return this._busLive('MBUSL') || this._busLive('MBUSR');
            case 'DG1':   return !!(G.DG1 && S.HACB1 && S['01']);
            case 'DG2':   return !!(G.DG2 && S.HACB2 && S['02']);
            case 'DG3':   return !!(G.DG3 && S.HACB3 && S['03']);
            case 'DG4':   return !!(G.DG4 && S.HACB4 && S['04']);
            case 'DG5':   return !!(G.DG5 && S.ACB1);
            case 'PTR1p': return this._busLive('HBBA') && S.VCB_PTR1;
            case 'TR1p':  return this._busLive('HBBA') && S.VCB_TR1;
            case 'TR2p':  return this._busLive('HBBB') && S.VCB_TR2;
            case 'PTR2p': return this._busLive('HBBB') && S.VCB_PTR2;
            case 'TR1s':  return this._busLive('HBBA') && S.VCB_TR1 && S.ACB_TR1;
            case 'TR2s':  return this._busLive('HBBB') && S.VCB_TR2 && S.ACB_TR2;
            default:      return false;
        }
    }

    // ── 仿真主循环 ──
    tick(dt) {
        this._computeBusLive();
        this._refresh();
        if (this.sys && typeof this.sys.requestRedraw === 'function') this.sys.requestRedraw();
    }

    _refresh() {
        const RED = '#d02020', OFF = '#7a8494';
        // 导线：通电红 / 断电灰
        WIRE_DEFS.forEach(w => {
            const n = this._wireNodes[w.id];
            if (n) n.stroke(this._wireLive(w.key) ? RED : OFF);
        });
        // 母联导线
        const tieLive = this._busLive('HBBA') || this._busLive('HBBB');
        ['tie1', 'tie2', 'tie3', 'tie4'].forEach(k => { if (this._wireNodes[k]) this._wireNodes[k].stroke(tieLive ? RED : OFF); });
        const mTieLive = this._wireLive('MBUSTIE');
        ['mTie1', 'mTie2'].forEach(k => { if (this._wireNodes[k]) this._wireNodes[k].stroke(mTieLive ? RED : OFF); });
        // 接地导线（保持灰，不红）
        // 汇流排：带电红 / 断电黑
        if (this._busNodes) {
            this._busNodes.HBBA.stroke(this._busLive('HBBA') ? RED : '#2c3a45');
            this._busNodes.HBBB.stroke(this._busLive('HBBB') ? RED : '#2c3a45');
            this._busNodes.MBUSL.stroke(this._busLive('MBUSL') ? RED : '#2c3a45');
            this._busNodes.MBUSR.stroke(this._busLive('MBUSR') ? RED : '#2c3a45');
        }
        // 发电机：运行绿 / 停机灰
        GEN_DEFS.forEach(g => {
            const n = this._genNodes[g.id];
            if (n) n.circle.fill(this._gens[g.id] ? '#2e8b2e' : '#8a8f96');
        });
        // 开关刀闸：动触点在上方；断开时偏左上 35°，合闸时顺时针转回接通
        const SIN35 = 0.574, COS35 = 0.819;
        SW_DEFS.forEach(s => {
            const n = this._swNodes[s.id];
            if (!n) return;
            const h = n.half;
            if (this._sw[s.id]) {
                // 合闸：接通（顺时针从断开位转回）
                n.blade.visible(true);
                n.blade.points(n.orient === 'v' ? [0, -h, 0, h] : [-h, 0, h, 0]);
            } else {
                // 断开：动触点（上方）偏左上 35°（统一所有开关）
                n.blade.visible(true);
                n.blade.points(n.orient === 'v'
                    ? [0, h, -2 * h * SIN35, h - 2 * h * COS35]
                    : [h, 0, h - 2 * h * COS35, -2 * h * SIN35]);
            }
        });
        // 变压器：原边带电红；原边+副边带载蓝
        const trColor = (trId, pBus, outSw, vcbId) => {
            const n = this._trNodes[trId];
            if (!n) return;
            const pLive = this._busLive(pBus) && this._sw[vcbId];
            const secLoad = pLive && outSw && this._sw[outSw];
            if (n.power) {
                // 电力变压器双圆（半透明相交）：上圆（原边）红、下圆（副边）蓝
                n.c1.fill(pLive ? 'rgba(192,48,48,0.55)' : 'rgba(200,205,210,0.55)');
                n.c2.fill(secLoad ? 'rgba(31,95,196,0.55)' : (pLive ? 'rgba(232,160,160,0.55)' : 'rgba(200,205,210,0.55)'));
            } else {
                if (secLoad) n.c1.fill('#1f5fc4');
                else if (pLive) n.c1.fill('#c03030');
                else n.c1.fill('#c8cdd2');
            }
        };
        // PTR1/PTR2 为测量保护变压器：原边通电（母线带电 && 真空断路器合）显示红色
        const ptrColor = (trId, pBus, vcbId) => {
            const n = this._trNodes[trId];
            if (!n) return;
            n.c1.fill((this._busLive(pBus) && this._sw[vcbId]) ? '#c03030' : '#c8cdd2');
            n.c2.fill('rgba(255,255,255,0.3)');
        };
        // 电力变压器：原边通电红 / 副边带载蓝（均需原边断路器合闸）
        trColor('TR1', 'HBBA', 'ACB_TR1', 'VCB_TR1');
        trColor('TR2', 'HBBB', 'ACB_TR2', 'VCB_TR2');
        ptrColor('PTR1', 'HBBA', 'VCB_PTR1');
        ptrColor('PTR2', 'HBBB', 'VCB_PTR2');
        this.markDirty();
    }

    destroy() { super.destroy?.(); }
}