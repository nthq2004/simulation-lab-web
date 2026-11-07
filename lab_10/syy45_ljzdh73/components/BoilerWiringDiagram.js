import Konva from 'konva';
import { BaseComponent } from './BaseComponent.js';

/**
 * BoilerWiringDiagram — 辅锅炉 PLC 控制系统接线图（实时 I/O 监视）
 * ═══════════════════════════════════════════════════════════════════════════
 *  依据教材 图 6-3-19「辅锅炉燃烧时序控制的外部接线图」：
 *    左半：DC24V 电源接入 → 1M 公共端 → 各输入开关/按钮/继电器触点
 *          → 输入指示灯（兼接线柱） → PLC 输入端子（端子中心压在 PLC 本体边缘）
 *    右半：PLC 输出端子 → 输出继电器触点 → 接触器线圈 / 中间继电器线圈 / 指示灯 / 音响
 *          → 右端统一回到 220V 交流电源右端；220V 左端接 Q0.0 上方新增的接线柱
 *
 *  动态显示（与 PLC 过程映像逐帧同步，相当于一块 I/O 监视模拟屏）：
 *    · 输入：无信号时两个触点悬空（中间为空）；有信号时两点之间用绿色粗线连通，
 *            输入指示灯（兼接线柱）亮绿色。
 *    · 输出：无输出时输出触点断开；有输出时触点闭合、接触器 / 继电器线圈红色填充，
 *            指示灯高亮（故障、报警灯红色，运行指示灯绿色），音响报警有声波。
 *    · 地址与名称完全按表 6-3-1：I0.0~I2.7、Q0.0~Q2.7。
 * ═══════════════════════════════════════════════════════════════════════════
 */

// 输入行：[地址, 器件名称, 类型]  switch=开关/按钮  relay=继电器触点  spare=备用
const INPUT_ROWS = [
    ['I0.0', '1# 水泵自动', 'switch'],
    ['I0.1', '1# 水泵手动', 'switch'],
    ['I0.2', '2# 水泵自动', 'switch'],
    ['I0.3', '2# 水泵手动', 'switch'],
    ['I0.4', '水位双位控制', 'switch'],
    ['I0.5', '超高水位', 'switch'],
    ['I0.6', '危险低水位', 'switch'],
    ['I0.7', '燃烧准备', 'button'],
    ['I1.0', '燃烧停止', 'button'],
    ['I1.1', '燃烧选择·自动', 'switch'],
    ['I1.2', '燃烧选择·扫风', 'switch'],
    ['I1.3', '燃烧选择·点火', 'switch'],
    ['I1.4', '燃烧选择·小火', 'switch'],
    ['I1.5', '燃烧选择·大火', 'switch'],
    ['I1.6', '1#油泵选择', 'switch'],
    ['I1.7', '2#油泵选择', 'switch'],
    ['I2.0', '消声按钮', 'button'],
    ['I2.1', '油温继电器', 'relay'],
    ['I2.2', '风压检测开关', 'relay'],
    ['I2.3', '锅炉自动停机', 'relay'],
    ['I2.4', '火焰监视', 'relay'],
    ['I2.5', '压力双位控制', 'relay'],
    ['I2.6', '蒸汽超压', 'relay'],
];

// 输出行：[地址, 器件代号, 名称, 类型]  coil=线圈 lampR=红灯 lampG=绿灯 horn=音响 spare=备用
const OUTPUT_ROWS = [
    ['Q0.0', 'KM1', '1# 水泵接触器', 'coil'],
    ['Q0.1', 'KM2', '2# 水泵接触器', 'coil'],
    ['Q0.2', '', '超高水位报警灯', 'lampR'],
    ['Q0.3', '', '危险低水位报警灯', 'lampR'],
    ['Q0.4', 'KM3', '风机接触器', 'coil'],
    ['Q0.5', 'KM4', '1# 油泵接触器', 'coil'],
    ['Q0.6', 'KM5', '2# 油泵接触器', 'coil'],
    ['Q0.7', '', '油温过低指示灯', 'lampR'],
    ['Q1.0', '', '风压失压指示灯', 'lampR'],
    ['Q1.1', 'KA1', '点火变压器', 'coil'],
    ['Q1.2', 'KA2', '总燃油阀继电器', 'coil'],
    ['Q1.3', 'KA3', '1# 燃油阀继电器', 'coil'],
    ['Q1.4', 'KA4', '风门衔铁继电器', 'coil'],
    ['Q1.5', 'KA5', '2# 燃油阀继电器', 'coil'],
    ['Q1.6', '', '火焰信号指示灯', 'lampG'],
    ['Q1.7', '', '蒸汽超压指示灯', 'lampR'],
    ['Q2.0', '', '音响报警', 'horn'],
    ['Q2.1', '', '起动就绪灯', 'lampG'],
    ['Q2.2', '', '大火运行灯', 'lampG'],
    ['Q2.3', '', '小火运行灯', 'lampG'],
    ['Q2.4', '', '点火失败灯', 'lampR'],
    ['Q2.5', '', '故障熄火灯', 'lampR'],
];

const GREEN = '#00c853';
const RED = '#e53935';
const WIRE = '#455a64';
const AC = '#c62828';
const R_DOT = 4;          // 触点圆半径（导线接在圆的边缘，而非圆心）

export class BoilerWiringDiagram extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.W = Math.max(560, config.width || 630);
        this.H = Math.max(600, config.height || 820);
        this.type = 'boiler_wiring';
        this.special = 'boiler_wiring';
        this.cache = 'fixed';

        this._initGroups();
        this._recalcGeometry();
        this._drawStaticParts();
        this._createDynamicNodes();
        this._bindInteraction();
        this._sync();

        this.config = { id: this.id, width: this.W, height: this.H };
    }

    _plc() { return (this.sys && this.sys.comps) ? this.sys.comps['plc-1'] : null; }

    // ═══════════════════════════════════════════════════════════
    //  几何（760 × 770）
    // ═══════════════════════════════════════════════════════════
    _recalcGeometry() {
        const rowY = (i) => 96 + i * 31.2;   // 末行（I2.6）距本体下边缘约 10px
        this._geo = {
            frame: { x: 0, y: 0, w: this.W, h: this.H, r: 8 },
            // 输入侧
            nameX: 8, nameW: 104,
            railX: 124,
            inC1: 142, inC2: 166,
            inLamp: 200,               // 输入指示灯位于线路中间
            // PLC 本体（端子中心压在左右边缘上）
            band: { x: 250, y: 46, w: 120, h: 746 },
            inAddrX: 258,
            // 输出侧
            outC1: 394, outC2: 418,
            coil: { x: 440, w: 38, h: 18 },
            lamp: { cx: 459, r: 7.5 },
            returnRailX: 494,          // 220V 右端公共回流母线
            labelX: 504,
            outAddrX: 364,
            // 电源接入（端子中心在本体边缘上）
            p24: { x: 250, y: 65 },    // DC24V 接入（I0.0 上方）
            p220: { x: 370, y: 65 },   // 220V 接入（Q0.0 上方）
            acC: { cx: 432, r: 16 },   // 220V 交流电源（圆形 + 正弦波）
            rowY,
            rowCount: Math.max(INPUT_ROWS.length, OUTPUT_ROWS.length),
        };
    }

    _label(g, x, y, text, size = 15, fill = '#263238', bold = false, align = 'left', width = 0, font) {
        const o = {
            x, y, text, fontSize: size, fill, align,
            fontStyle: bold ? 'bold' : 'normal',
            fontFamily: font || 'Arial, "Microsoft YaHei", sans-serif',
        };
        if (width) o.width = width;
        g.add(new Konva.Text(o));
        return o;
    }

    // ═══════════════════════════════════════════════════════════
    //  静态图
    // ═══════════════════════════════════════════════════════════
    _drawStaticParts() {
        const g = this._staticGroup, G = this._geo, B = G.band;
        // 两侧行数不同（输入 23 行、输出 22 行）：母线各接到本侧最后一行的中心，不留多余线段
        const lastIn = G.rowY(INPUT_ROWS.length - 1);
        const lastOut = G.rowY(OUTPUT_ROWS.length - 1);

        g.add(new Konva.Rect({
            x: 0, y: 0, width: this.W, height: this.H, cornerRadius: G.frame.r,
            fill: '#ffffff', stroke: '#90a4ae', strokeWidth: 2,
        }));

        this._label(g, 14, 6, 'PLC 控制系统接线图（实时 I/O 监视）', 18, '#1b3a4b', true);

        // ── PLC 本体（端子排）──
        g.add(new Konva.Rect({ x: B.x, y: B.y, width: B.w, height: B.h, fill: '#eceff1', stroke: '#455a64', strokeWidth: 2 }));
        this._label(g, B.x, B.y + 5, 'PLC  CPU SR40', 13, '#263238', true, 'center', B.w);

        // ══ 输入侧：DC24V 电源接入（I0.0 上方，端子中心压在 PLC 本体左边缘）══
        this._label(g, 18, 58, 'DC 24V电源', 15, AC, true);
        // ── 电池符号（长线＝正极，短线＝负极；负极接 PLC 接线柱）──
        const batX = 187;
        g.add(new Konva.Line({ points: [G.railX, G.p24.y, batX - 7, G.p24.y], stroke: WIRE, strokeWidth: 1.8 }));
        g.add(new Konva.Line({ points: [batX - 7, G.p24.y - 12, batX - 7, G.p24.y + 12], stroke: WIRE, strokeWidth: 2 }));   // 正极（长板）
        g.add(new Konva.Line({ points: [batX + 3, G.p24.y - 6, batX + 3, G.p24.y + 6], stroke: WIRE, strokeWidth: 4.5 }));  // 负极（短板）
        g.add(new Konva.Line({ points: [batX + 3, G.p24.y, G.p24.x - 4.6, G.p24.y], stroke: WIRE, strokeWidth: 1.8 }));
        g.add(new Konva.Circle({ x: G.p24.x, y: G.p24.y, radius: 4.6, fill: '#ffffff', stroke: WIRE, strokeWidth: 1.6 }));

        // 1M 公共端母线（接各输入开关的一端）
        g.add(new Konva.Line({ points: [G.railX, G.p24.y, G.railX, lastIn], stroke: WIRE, strokeWidth: 1.6 }));

        // ── 左：输入行 ──
        INPUT_ROWS.forEach(([addr, name, kind], i) => {
            const y = G.rowY(i);
            this._label(g, G.nameX+10, y - 9, name, 15, kind === 'spare' ? '#b0bec5' : '#263238', false, 'left', G.nameW);
            if (kind === 'spare') {
                this._label(g, G.inC1 - 8, y - 9, '—', 15, '#b0bec5', false, 'center', 44);
                return;
            }
            // 公共端 → 第一个触点的左边缘
            g.add(new Konva.Line({ points: [G.railX, y, G.inC1 - R_DOT, y], stroke: WIRE, strokeWidth: 1.4 }));
            // 两个触点：未接通时中间为空（只有两个圆点）
            [G.inC1, G.inC2].forEach((cx) => {
                g.add(new Konva.Circle({ x: cx, y, radius: R_DOT, fill: '#ffffff', stroke: WIRE, strokeWidth: 1.4 }));
            });
            // 第二个触点的右边缘 → 指示灯（兼接线柱）
            g.add(new Konva.Line({ points: [G.inC2 + R_DOT, y, G.inLamp - 8, y], stroke: WIRE, strokeWidth: 1.4 }));
            // 指示灯 → PLC 输入端子（端子中心在 PLC 本体左边缘，导线接到端子左边缘）
            g.add(new Konva.Line({ points: [G.inLamp + 8, y, G.p24.x - 4.6, y], stroke: WIRE, strokeWidth: 1.4 }));
            g.add(new Konva.Circle({ x: G.p24.x, y, radius: 4.6, fill: '#ffffff', stroke: WIRE, strokeWidth: 1.6 }));
            // 地址
            this._label(g, G.inAddrX, y - 8, addr, 14.5, '#0d47a1', true, 'left', 52, 'Consolas, monospace');
        });

        // ══ 输出侧：220V AC 电源接入（圆形 + 中心正弦波，Q0.0 上方）══
        const ACX = G.acC.cx, ACY = G.p220.y, ACR = G.acC.r;
        g.add(new Konva.Circle({ x: ACX, y: ACY, radius: ACR, fill: '#fff5f5', stroke: AC, strokeWidth: 1.8 }));
        // 中心波浪（正弦波）代表交流
        {
            const pts = [];
            for (let i = 0; i <= 24; i++) {
                const t = i / 24;
                pts.push(ACX - 9 + t * 18, ACY - Math.sin(t * Math.PI * 2) * 5.5);
            }
            g.add(new Konva.Line({ points: pts, stroke: AC, strokeWidth: 1.8, lineCap: 'round' }));
        }
        this._label(g, ACX+55 , ACY-5, '220V AC', 15, AC, true, 'center', 90);
        // 交流电源左端 → 新增接线柱（Q0.0 上方，落在本体右边缘）
        g.add(new Konva.Line({ points: [ACX - ACR, ACY, G.p220.x + 4.6, ACY], stroke: WIRE, strokeWidth: 1.8 }));
        g.add(new Konva.Circle({ x: G.p220.x, y: G.p220.y, radius: 4.6, fill: '#ffffff', stroke: WIRE, strokeWidth: 1.6 }));
        // 右端 → 竖直回流母线（所有输出右端汇于此）
        g.add(new Konva.Line({ points: [ACX + ACR, ACY, G.returnRailX, ACY], stroke: WIRE, strokeWidth: 1.8 }));
        g.add(new Konva.Line({ points: [G.returnRailX, ACY, G.returnRailX, lastOut], stroke: WIRE, strokeWidth: 1.8 }));

        // ── 右：输出行 ──
        OUTPUT_ROWS.forEach(([addr, code, name, kind], i) => {
            const y = G.rowY(i);
            this._label(g, G.outAddrX - 55, y - 8, addr, 14.5, kind === 'spare' ? '#b0bec5' : '#0d47a1', true, 'right', 52, 'Consolas, monospace');

            if (kind === 'spare') {
                this._label(g, G.outC1 - 12, y - 9, '—', 15, '#b0bec5', false, 'center', 50);
                this._label(g, G.labelX, y - 9, name, 15, '#b0bec5', false, 'left', this.W - G.labelX - 8);
                return;
            }
            // PLC 输出端子（端子中心在 PLC 本体右边缘）
            g.add(new Konva.Circle({ x: G.p220.x, y, radius: 4.6, fill: '#ffffff', stroke: WIRE, strokeWidth: 1.6 }));
            // 输出接线柱的右边缘 → 输出触点的左边缘
            g.add(new Konva.Line({ points: [G.p220.x + 4.6, y, G.outC1 - R_DOT, y], stroke: WIRE, strokeWidth: 1.4 }));
            // 输出触点（常开，无输出时中间为空）
            [G.outC1, G.outC2].forEach((cx) => {
                g.add(new Konva.Circle({ x: cx, y, radius: R_DOT, fill: '#ffffff', stroke: WIRE, strokeWidth: 1.4 }));
            });
            // 第二个触点的右边缘 → 负载（按负载类型接到其左边缘）
            const loadLeft = (kind === 'coil') ? G.coil.x
                : (kind === 'lampR' || kind === 'lampG') ? (G.lamp.cx - G.lamp.r)
                : (G.lamp.cx - 10);
            g.add(new Konva.Line({ points: [G.outC2 + R_DOT, y, loadLeft, y], stroke: WIRE, strokeWidth: 1.4 }));

            let loadRight = G.coil.x + G.coil.w;
            if (kind === 'coil') {
                g.add(new Konva.Rect({
                    x: G.coil.x, y: y - G.coil.h / 2, width: G.coil.w, height: G.coil.h,
                    fill: '#ffffff', stroke: WIRE, strokeWidth: 1.4, cornerRadius: 1,
                }));
                this._label(g, G.coil.x, y - 8, code, 15, '#37474f', true, 'center', G.coil.w, 'Consolas, monospace');
            } else if (kind === 'lampR' || kind === 'lampG') {
                g.add(new Konva.Circle({ x: G.lamp.cx, y, radius: G.lamp.r, fill: '#ffffff', stroke: WIRE, strokeWidth: 1.4 }));
                g.add(new Konva.Line({ points: [G.lamp.cx - 5.5, y - 5.5, G.lamp.cx + 5.5, y + 5.5], stroke: WIRE, strokeWidth: 1.2 }));
                g.add(new Konva.Line({ points: [G.lamp.cx - 5.5, y + 5.5, G.lamp.cx + 5.5, y - 5.5], stroke: WIRE, strokeWidth: 1.2 }));
                loadRight = G.lamp.cx + G.lamp.r;
            } else if (kind === 'horn') {
                const hx = G.lamp.cx;
                g.add(new Konva.Line({
                    points: [hx - 10, y - 5.5, hx - 4, y - 5.5, hx + 3, y - 11, hx + 3, y + 11, hx - 4, y + 5.5, hx - 10, y + 5.5],
                    closed: true, fill: '#ffffff', stroke: WIRE, strokeWidth: 1.4,
                }));
                loadRight = hx + 3;
            }

            // 负载右端 → 220V 右端公共母线
            g.add(new Konva.Line({ points: [loadRight, y, G.returnRailX, y], stroke: WIRE, strokeWidth: 1.4 }));

            // 名称
            this._label(g, G.labelX, y - 9, name, 15, code ? '#263238' : '#37474f', !!code, 'left', this.W - G.labelX );
        });
    }

    // ═══════════════════════════════════════════════════════════
    //  动态图
    // ═══════════════════════════════════════════════════════════
    _createDynamicNodes() {
        const d = this._dynamicGroup, G = this._geo;

        this._inClose = [];
        this._inLamp = [];
        this._outClose = [];
        this._outLoad = [];

        // 输入：触点间绿色粗线 + 指示灯
        INPUT_ROWS.forEach(([addr, , kind], i) => {
            const y = G.rowY(i);
            const line = new Konva.Line({
                points: [G.inC1 + R_DOT, y, G.inC2 - R_DOT, y],
                stroke: GREEN, strokeWidth: 5, lineCap: 'round', visible: false, listening: false,
            });
            d.add(line);
            this._inClose.push(line);

            const lamp = new Konva.Circle({
                x: G.inLamp, y, radius: 7.5,
                fill: kind === 'spare' ? 'rgba(0,0,0,0)' : '#ffffff',
                stroke: WIRE, strokeWidth: 1.4,
            });
            d.add(lamp);
            this._inLamp.push({ node: lamp, kind });
        });

        // 输出：触点间绿色粗线 + 线圈/指示灯/喇叭
        OUTPUT_ROWS.forEach(([addr, code, name, kind], i) => {
            const y = G.rowY(i);
            const line = new Konva.Line({
                points: [G.outC1 + R_DOT, y, G.outC2 - R_DOT, y],
                stroke: GREEN, strokeWidth: 5, lineCap: 'round', visible: false, listening: false,
            });
            d.add(line);
            this._outClose.push(line);

            if (kind === 'coil') {
                const rect = new Konva.Rect({
                    x: G.coil.x, y: y - G.coil.h / 2, width: G.coil.w, height: G.coil.h,
                    fill: '#ffffff', stroke: WIRE, strokeWidth: 1.4, cornerRadius: 1, listening: false,
                });
                d.add(rect);
                const txt = new Konva.Text({
                    x: G.coil.x, y: y - 8, width: G.coil.w, text: code, fontSize: 13, align: 'center',
                    fill: '#37474f', fontStyle: 'bold', fontFamily: 'Consolas, monospace', listening: false,
                });
                d.add(txt);
                this._outLoad.push({ kind, shape: rect, text: txt });
            } else if (kind === 'lampR' || kind === 'lampG') {
                const c = new Konva.Circle({
                    x: G.lamp.cx, y, radius: G.lamp.r - 1.6, fill: '#ffffff', listening: false,
                });
                d.add(c);
                this._outLoad.push({ kind, shape: c });
            } else if (kind === 'horn') {
                const hx = G.lamp.cx;
                // 喇叭本体（动态层）：报警时红色填充
                const poly = new Konva.Line({
                    points: [hx - 10, y - 5.5, hx - 4, y - 5.5, hx + 3, y - 11, hx + 3, y + 11, hx - 4, y + 5.5, hx - 10, y + 5.5],
                    closed: true, fill: RED, stroke: '#8e0000', strokeWidth: 1.4, opacity: 0, listening: false,
                });
                d.add(poly);
                const waves = [];
                for (let k = 0; k < 3; k++) {
                    const w = new Konva.Line({
                        points: [hx + 7 + k * 4.5, y - 3.5, hx + 11 + k * 5.5, y, hx + 7 + k * 4.5, y + 3.5],
                        stroke: RED, strokeWidth: 1.8, opacity: 0, lineCap: 'round', listening: false,
                    });
                    d.add(w);
                    waves.push(w);
                }
                this._outLoad.push({ kind, waves, poly });
            } else {
                this._outLoad.push({ kind });
            }
        });
    }

    _bindInteraction() {
        const G = this._geo;
        INPUT_ROWS.forEach(([addr], i) => {
            const y = G.rowY(i);
            this.addClickablePart('in-' + addr, G.inC1 - 14, y - 12, G.inLamp - G.inC1 + 34, 24);
        });
        OUTPUT_ROWS.forEach(([addr], i) => {
            const y = G.rowY(i);
            this.addClickablePart('out-' + addr, G.p220.x - 12, y - 12, G.coil.x + G.coil.w - G.p220.x + 20, 24);
        });
    }

    // ═══════════════════════════════════════════════════════════
    //  每帧同步 PLC 过程映像
    // ═══════════════════════════════════════════════════════════
    _bits() {
        const sol = this.sys && this.sys.s7200Solver;
        if (sol && typeof sol.getProcessImage === 'function') {
            const img = sol.getProcessImage('plc-1');
            if (img) return { I: img.I, Q: img.Q };
        }
        const plc = this._plc();
        if (plc && plc._display) return { I: plc._display.di || [], Q: plc._display.dq || [] };
        return null;
    }

    _sync() {
        const bits = this._bits();
        if (!bits) return;
        const now = performance.now ? performance.now() : Date.now();

        INPUT_ROWS.forEach(([addr, , kind], i) => {
            if (kind === 'spare') return;
            const [byte, bit] = addr.slice(1).split('.').map(Number);
            const on = !!bits.I[byte * 8 + bit];
            const line = this._inClose[i];
            if (line) line.visible(on);
            const lamp = this._inLamp[i];
            if (!lamp) return;
            lamp.node.fill(on ? GREEN : '#ffffff');
            lamp.node.stroke(on ? '#00701a' : WIRE);
        });

        OUTPUT_ROWS.forEach(([addr, , , kind], i) => {
            if (kind === 'spare') return;
            const [byte, bit] = addr.slice(1).split('.').map(Number);
            const on = !!bits.Q[byte * 8 + bit];
            const line = this._outClose[i];
            if (line) line.visible(on);
            const load = this._outLoad[i];
            if (!load) return;

            if (load.kind === 'coil') {
                load.shape.fill(on ? RED : '#ffffff');
                load.shape.stroke(on ? '#8e0000' : WIRE);
                load.text.fill(on ? '#ffffff' : '#37474f');
            } else if (load.kind === 'lampR' || load.kind === 'lampG') {
                const isRed = load.kind === 'lampR';
                load.shape.fill(on ? (isRed ? RED : GREEN) : '#ffffff');
                load.shape.stroke(on ? (isRed ? '#8e0000' : '#00701a') : '#b0bec5');
            } else if (load.kind === 'horn') {
                // 报警时喇叭红色填充 + 声波闪烁
                if (load.poly) load.poly.opacity(on ? 1 : 0);
                load.waves.forEach((w, k) => {
                    w.opacity(on ? ((Math.floor(now / 300 + k) % 3 === 0) ? 0.95 : 0.15) : 0);
                });
            }
        });
    }

    tick() { this._sync(); this._refreshIfDirty(); }

    getConfigFields() {
        return [
            { label: '器件名称 (ID)', key: 'id', type: 'text', get: c => c.id },
            { label: '宽度', key: 'width', type: 'number', get: c => c.W },
            { label: '高度', key: 'height', type: 'number', get: c => c.H },
        ];
    }

    onConfigUpdate(cfg) {
        this.config = { ...this.config, ...cfg };
        if (this.sys && this.sys.requestRedraw) this.sys.requestRedraw();
    }
}

export default BoilerWiringDiagram;
