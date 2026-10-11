import { BaseComponent } from './BaseComponent.js';

/**
 * T568BCableBench — T568B 网线制作工位（复合组件）
 *
 * 把网线制作的完整工艺链封装在一个自包含组件内（参照 InductionMotorExploded 的
 * 「工具箱 + 顺序约束 + 摆放区」模式）：
 *
 *   剥外皮 → 解绞排线 → 剪齐 → 插入水晶头 → 压接 → 测线仪检测
 *
 * 布局（本地坐标 0..W × 0..H，左上为原点）：
 *   ① 电缆区   外皮 + 4 对双绞线；剥皮后显示 8 根彩色线芯
 *   ② 排列槽位 8 个编号槽位（1→8），点击线芯后点槽位放入
 *   ③ 水晶头   RJ45 本体 + 8 个金脚；插入后金脚显示线芯颜色
 *   ④ 工具区   剥线钳 / 剪线钳 / 网线钳 / 重新开始
 *   ⑤ 测线仪   8 个指示灯，压接后点击依次测线
 *
 * 线序（第 1~8 脚）：
 *   T568B = 白橙 橙 白绿 蓝 白蓝 绿 白棕 棕
 *   T568A = 白绿 绿 白橙 蓝 白蓝 橙 白棕 棕
 *
 * 典型故障（供故障界面注入）：
 *   'order' 线序错误（4、6 脚互换） | 'open' 断路（第 3 脚未压接） | 'short' 短路（5、6 脚搭接）
 *
 * 无电气端口（纯工艺流程演示组件）。
 */

// 8 根线芯的颜色定义
const CORE_DEFS = {
    wo:  { name: '白橙', fill: '#E8A33D', white: true,  textDark: true },
    o:   { name: '橙',   fill: '#FF7A00', white: false, textDark: false },
    wg:  { name: '白绿', fill: '#69C24A', white: true,  textDark: true },
    g:   { name: '绿',   fill: '#1E9E38', white: false, textDark: false },
    b:   { name: '蓝',   fill: '#2F6FE0', white: false, textDark: false },
    wb:  { name: '白蓝', fill: '#7FA8F0', white: true,  textDark: true },
    wbr: { name: '白棕', fill: '#A9763C', white: true,  textDark: false },
    br:  { name: '棕',   fill: '#7A4A22', white: false, textDark: false },
};

const ORDER_T568B = ['wo', 'o', 'wg', 'b', 'wb', 'g', 'wbr', 'br'];
const ORDER_T568A = ['wg', 'g', 'wo', 'b', 'wb', 'o', 'wbr', 'br'];

// 初始摆放顺序：按线对聚拢（橙对→绿对→蓝对→棕对），与 T568B 不同，需重新排列
const PALETTE_ORDER = ['wo', 'o', 'wg', 'g', 'b', 'wb', 'wbr', 'br'];

// 一个线芯彩色条的绘制（base 色 + 可选白色条纹）
function drawCoreBar(Konva, group, x, y, w, h, colorKey, radius = 3) {
    const def = CORE_DEFS[colorKey];
    const bar = new Konva.Rect({
        x, y, width: w, height: h, fill: def.fill,
        stroke: '#00000022', strokeWidth: 1, cornerRadius: radius, listening: false,
    });
    group.add(bar);
    let stripe = null;
    if (def.white) {
        stripe = new Konva.Rect({
            x: x + 4, y: y + h / 2 - Math.max(2, h * 0.12), width: Math.max(6, w - 8),
            height: Math.max(4, h * 0.24), fill: '#ffffff', opacity: 0.9,
            cornerRadius: 2, listening: false,
        });
        group.add(stripe);
    }
    return { bar, stripe };
}

export class T568BCableBench extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.width = Math.max(900, config.width || 1000);
        this.height = Math.max(580, config.height || 680);

        this.type = 't568b_bench';
        this.cache = 'fixed';

        this._initGroups();
        this._recalcGeometry();
        this._initParameters(config);
        this._init();

        this.config = {
            id: this.id,
            label: this.label,
            standard: this.standard,
            stripLength: this.stripLength,
        };
    }

    // ═══════════════════════════════════════════
    // 参数与几何
    // ═══════════════════════════════════════════

    _recalcGeometry() {
        this._panel = {
            cable: { x: 16, y: 74, w: 276, h: 516 },
            slots: { x: 304, y: 74, w: 352, h: 516 },
            rj45:  { x: 668, y: 74, w: 156, h: 516 },
            tools: { x: 836, y: 74, w: 148, h: 516 },
            bar:   { x: 16, y: 596, w: 968, h: 68 },
        };

        // ① 电缆
        this._cable = {
            jacket: { x: 40, y: 150, w: 110, h: 42 },
            stripX: 152,
            pairX1: 162, pairX2: 272, pairY: 158,
        };
        // 剥皮后的线芯调色板
        this._palette = { x: 40, y: 220, w: 228, h: 32, step: 40 };

        // ② 槽位
        this._slot = { x0: 322, y: 140, w: 30, h: 250, step: 42 };

        // ③ 水晶头
        this._rj = {
            x: 692, y: 150, w: 108, h: 150,
            pinX0: 696, pinStep: 13, pinW: 9, pinH: 28, pinY: 156,
        };

        // ④ 工具行
        this._toolRows = [
            { key: 'tool-stripper', name: '剥线钳', desc: '剥外皮' },
            { key: 'tool-cutter',   name: '剪线钳', desc: '剪齐线芯' },
            { key: 'tool-crimper',  name: '网线钳', desc: '压接水晶头' },
            { key: 'reset',         name: '重新开始', desc: '复位重做' },
        ];
        this._toolRowX = 844; this._toolRowW = 132; this._toolRowY0 = 108; this._toolRowStep = 68; this._toolRowH = 54;

        // ⑤ 测线仪
        this._bar = { bodyX: 150, bodyY: 604, bodyW: 680, bodyH: 52, ledX0: 250, ledStep: 70, ledY: 630, r: 11 };
    }

    _slotCenterX(i) { return this._slot.x0 + i * this._slot.step + this._slot.w / 2; }

    _initParameters(config) {
        this.label = (config && config.label) || 'T568B 网线制作工位';
        this.standard = (config && config.standard) || 'T568B';
        this.stripLength = (config && config.stripLength !== undefined) ? config.stripLength : 20;

        this._stage = 'idle';            // idle→stripped→arranged→trimmed→inserted→crimped→tested
        this._selectedCore = null;
        this._slotColors = new Array(8).fill(null);
        this._fault = null;              // 'order' | 'open' | 'short'
        this._openPins = [];
        this._shortPins = [];
        this._testResult = null;
        this._ledTimers = [];
    }

    _targetOrder() {
        return (this.standard === 'T568A' ? ORDER_T568A : ORDER_T568B).slice();
    }

    // ═══════════════════════════════════════════
    // 绘制
    // ═══════════════════════════════════════════

    _init() {
        this._drawStaticParts();
        this._createDynamicNodes();
        this._bindInteraction();
        this._addHitArea();
        this._refreshDynamic();
    }

    _addHitArea() {
        if (this._hitRect) return;
        this._hitRect = new Konva.Rect({
            x: 0, y: 0, width: this.width, height: this.height,
            fill: '#ffffff', opacity: 0.002, listening: true,
        });
        this.group.add(this._hitRect);
        this._hitRect.moveToBottom();
    }

    _drawStaticParts() {
        const s = this._staticGroup;
        const P = this._panel;

        // 底板
        s.add(new Konva.Rect({
            x: 0, y: 0, width: this.width, height: this.height,
            fill: '#f7f9fc', stroke: '#d8e0ea', strokeWidth: 1.5, cornerRadius: 10, listening: false,
        }));

        // 标题
        s.add(new Konva.Text({
            x: 24, y: 16, text: this.label, fontSize: 20, fontStyle: 'bold',
            fill: '#1f3a5f', listening: false,
        }));
        s.add(new Konva.Text({
            x: 24, y: 44, text: '剥外皮 → 排线 → 剪齐 → 插水晶头 → 压接 → 测线仪检测',
            fontSize: 12, fill: '#64748b', listening: false,
        }));

        // 各区域面板
        const panel = (area, title) => {
            s.add(new Konva.Rect({
                x: area.x, y: area.y, width: area.w, height: area.h,
                fill: '#ffffff', stroke: '#e2e8f0', strokeWidth: 1.2, cornerRadius: 8, listening: false,
            }));
            s.add(new Konva.Text({
                x: area.x + 12, y: area.y + 10, text: title, fontSize: 13, fontStyle: 'bold',
                fill: '#334155', listening: false,
            }));
        };
        panel(P.cable, '① 电缆');
        panel(P.slots, '② 排列槽位（1→8）');
        panel(P.rj45, '③ 水晶头');
        panel(P.tools, '④ 工具');
        panel(P.bar, '⑤ 测线仪（点击检测）');

        // ── 槽位（静态通道 + 编号）──
        for (let i = 0; i < 8; i++) {
            const cx = this._slotCenterX(i);
            s.add(new Konva.Text({
                x: cx - 15, y: 116, width: 30, align: 'center',
                text: String(i + 1), fontSize: 14, fontStyle: 'bold', fill: '#334155', listening: false,
            }));
            s.add(new Konva.Rect({
                x: cx - this._slot.w / 2, y: this._slot.y, width: this._slot.w, height: this._slot.h,
                fill: '#f8fafc', stroke: '#cbd5e1', strokeWidth: 1, dash: [5, 4],
                cornerRadius: 5, listening: false,
            }));
            s.add(new Konva.Rect({
                x: cx - this._slot.w / 2 + 4, y: this._slot.y + this._slot.h - 6, width: this._slot.w - 8,
                height: 3, fill: '#e2e8f0', listening: false,
            }));
        }
        s.add(new Konva.Text({
            x: 316, y: 100, text: '按 T568B 线序，把左侧线芯依次放入 1~8 号槽位',
            fontSize: 11, fill: '#94a3b8', listening: false,
        }));

        // ── 水晶头（静态外壳 + 金脚本体）──
        const rj = this._rj;
        s.add(new Konva.Rect({
            x: rj.x, y: rj.y, width: rj.w, height: rj.h,
            fill: 'rgba(180,210,240,0.35)', stroke: '#7aa7d0', strokeWidth: 1.5, cornerRadius: 6, listening: false,
        }));
        s.add(new Konva.Rect({
            x: rj.x + 42, y: rj.y - 18, width: 24, height: 18,
            fill: '#cfe0f0', stroke: '#7aa7d0', strokeWidth: 1.2, cornerRadius: 4, listening: false,
        }));
        for (let i = 0; i < 8; i++) {
            s.add(new Konva.Rect({
                x: rj.pinX0 + i * rj.pinStep, y: rj.pinY, width: rj.pinW, height: rj.pinH,
                fill: '#c9a227', stroke: '#8a6d13', strokeWidth: 1, cornerRadius: 1.5, listening: false,
            }));
            s.add(new Konva.Text({
                x: rj.pinX0 + i * rj.pinStep - 4, y: rj.y + rj.h + 8, width: 16, align: 'center',
                text: String(i + 1), fontSize: 9, fill: '#64748b', listening: false,
            }));
        }
        // 电缆入口
        s.add(new Konva.Rect({
            x: rj.x + 12, y: rj.y + rj.h, width: rj.w - 24, height: 12,
            fill: '#e2e8f0', stroke: '#cbd5e1', strokeWidth: 1, cornerRadius: 2, listening: false,
        }));
        s.add(new Konva.Text({
            x: rj.x - 4, y: rj.y + rj.h + 34, width: rj.w + 8, align: 'center',
            text: 'RJ45 8P8C 水晶头', fontSize: 11, fill: '#94a3b8', listening: false,
        }));

        // ── 工具行（静态图标与标签）──
        this._toolRows.forEach((t, i) => {
            const y = this._toolRowY0 + i * this._toolRowStep;
            s.add(new Konva.Rect({
                x: this._toolRowX, y, width: this._toolRowW, height: this._toolRowH,
                fill: '#ffffff', stroke: '#dbe4f0', strokeWidth: 1, cornerRadius: 6, listening: false,
            }));
            this._drawToolIcon(s, t.key, this._toolRowX + 12, y + 12);
            s.add(new Konva.Text({
                x: this._toolRowX + 50, y: y + 10, text: t.name, fontSize: 13, fill: '#334155', listening: false,
            }));
            s.add(new Konva.Text({
                x: this._toolRowX + 50, y: y + 30, text: t.desc, fontSize: 10, fill: '#94a3b8', listening: false,
            }));
        });

        // ── 测线仪机身 ──
        const b = this._bar;
        s.add(new Konva.Rect({
            x: b.bodyX, y: b.bodyY, width: b.bodyW, height: b.bodyH,
            fill: '#eef2f7', stroke: '#cbd5e1', strokeWidth: 1.2, cornerRadius: 6, listening: false,
        }));
        s.add(new Konva.Text({
            x: b.bodyX + 12, y: b.bodyY + 18, text: '主/远端', fontSize: 11, fill: '#64748b', listening: false,
        }));
        for (let i = 0; i < 8; i++) {
            const cx = b.ledX0 + i * b.ledStep;
            s.add(new Konva.Text({
                x: cx - 10, y: b.bodyY + b.bodyH - 14, width: 20, align: 'center',
                text: String(i + 1), fontSize: 9, fill: '#64748b', listening: false,
            }));
        }
    }

    _drawToolIcon(s, key, x, y) {
        const add = (node) => { node.listening(false); s.add(node); };
        switch (key) {
            case 'tool-stripper': // 剥线钳：两片刀口 + 手柄
                add(new Konva.Line({ points: [x, y + 22, x + 14, y + 4], stroke: '#64748b', strokeWidth: 3, lineCap: 'round' }));
                add(new Konva.Line({ points: [x + 26, y + 22, x + 12, y + 4], stroke: '#64748b', strokeWidth: 3, lineCap: 'round' }));
                add(new Konva.Circle({ x: x + 13, y: y + 10, radius: 3, fill: '#334155' }));
                add(new Konva.Rect({ x: x, y: y + 22, width: 10, height: 12, fill: '#dc2626', cornerRadius: 3 }));
                add(new Konva.Rect({ x: x + 16, y: y + 22, width: 10, height: 12, fill: '#dc2626', cornerRadius: 3 }));
                break;
            case 'tool-cutter': // 剪线钳：两片斜口
                add(new Konva.Line({ points: [x + 2, y + 4, x + 24, y + 22], stroke: '#64748b', strokeWidth: 3, lineCap: 'round' }));
                add(new Konva.Line({ points: [x + 24, y + 4, x + 2, y + 22], stroke: '#94a3b8', strokeWidth: 3, lineCap: 'round' }));
                add(new Konva.Circle({ x: x + 13, y: y + 22, radius: 3, fill: '#334155' }));
                add(new Konva.Rect({ x: x + 2, y: y + 22, width: 22, height: 8, fill: '#2563eb', cornerRadius: 3 }));
                break;
            case 'tool-crimper': // 网线钳：钳头 + 棘轮齿
                add(new Konva.Rect({ x: x, y: y + 6, width: 26, height: 10, fill: '#475569', cornerRadius: 2 }));
                add(new Konva.Rect({ x: x + 2, y: y + 18, width: 22, height: 10, fill: '#64748b', cornerRadius: 2 }));
                for (let k = 0; k < 5; k++) add(new Konva.Line({ points: [x + 4 + k * 4, y + 8, x + 4 + k * 4, y + 14], stroke: '#cbd5e1', strokeWidth: 1 }));
                break;
            case 'reset': // 环形箭头
                add(new Konva.Arc({ x: x + 13, y: y + 13, innerRadius: 7, outerRadius: 10, angle: 300, rotation: 30, fill: '#0ea5e9' }));
                add(new Konva.Line({ points: [x + 20, y + 3, x + 25, y + 8, x + 18, y + 9], closed: true, fill: '#0ea5e9' }));
                break;
        }
    }

    _createDynamicNodes() {
        const d = this._dynamicGroup;

        // ── 外皮 + 双绞线（idle 时显示）──
        this._jacketGroup = new Konva.Group({ listening: false });
        const jk = this._cable.jacket;
        d.add(this._jacketGroup);
        this._jacketGroup.add(new Konva.Rect({
            x: jk.x, y: jk.y, width: jk.w, height: jk.h,
            fill: '#3f4a5a', stroke: '#2b333f', strokeWidth: 1.5, cornerRadius: 6,
        }));
        this._jacketGroup.add(new Konva.Text({
            x: jk.x, y: jk.y + jk.h + 6, width: jk.w, align: 'center',
            text: '外皮／护套', fontSize: 11, fill: '#64748b',
        }));
        this._jacketGroup.add(new Konva.Line({
            points: [this._cable.stripX, jk.y - 8, this._cable.stripX, jk.y + jk.h + 8],
            stroke: '#ef4444', strokeWidth: 1.5, dash: [4, 3],
        }));
        this._jacketGroup.add(new Konva.Text({
            x: this._cable.stripX - 6, y: jk.y - 26, width: 80, align: 'center',
            text: '剥皮处', fontSize: 10, fill: '#ef4444',
        }));

        this._pairsGroup = new Konva.Group({ listening: false });
        d.add(this._pairsGroup);
        const pairColors = [['#E8A33D', '#FF7A00'], ['#69C24A', '#1E9E38'], ['#2F6FE0', '#7FA8F0'], ['#A9763C', '#7A4A22']];
        for (let p = 0; p < 4; p++) {
            const baseY = this._cable.pairY + p * 9;
            const pts1 = [], pts2 = [];
            for (let x = this._cable.pairX1; x <= this._cable.pairX2; x += 8) {
                const ph = (x - this._cable.pairX1) / 8 * 0.95;
                pts1.push(x, baseY + 3.6 * Math.sin(ph));
                pts2.push(x, baseY - 3.6 * Math.sin(ph));
            }
            this._pairsGroup.add(new Konva.Line({ points: pts1, stroke: pairColors[p][0], strokeWidth: 2.6, lineCap: 'round' }));
            this._pairsGroup.add(new Konva.Line({ points: pts2, stroke: pairColors[p][1], strokeWidth: 2.6, lineCap: 'round' }));
        }
        this._pairsGroup.add(new Konva.Text({
            x: this._cable.pairX1, y: this._cable.pairY + 46, width: 120, align: 'center',
            text: '4 对双绞线', fontSize: 11, fill: '#64748b',
        }));

        // ── 线芯调色板（剥皮后显示）──
        this._paletteGroup = new Konva.Group({ visible: false, listening: false });
        d.add(this._paletteGroup);
        this._paletteGroup.add(new Konva.Text({
            x: this._palette.x, y: this._palette.y - 22, width: this._palette.w,
            text: '点击线芯选择，再点右侧槽位放入', fontSize: 11, fill: '#94a3b8',
        }));
        this._coreNodes = {};
        PALETTE_ORDER.forEach((c, i) => {
            const y = this._palette.y + i * this._palette.step;
            const g = new Konva.Group({ listening: false });
            const { bar, stripe } = drawCoreBar(Konva, g, this._palette.x, y, this._palette.w, this._palette.h, c, 4);
            const def = CORE_DEFS[c];
            g.add(new Konva.Text({
                x: this._palette.x + 10, y: y + 8, width: this._palette.w - 20,
                text: def.name, fontSize: 13, fontStyle: 'bold',
                fill: def.textDark ? '#3a2c12' : '#ffffff',
            }));
            const sel = new Konva.Rect({
                x: this._palette.x - 3, y: y - 3, width: this._palette.w + 6, height: this._palette.h + 6,
                stroke: '#0ea5e9', strokeWidth: 2.5, cornerRadius: 5, visible: false,
            });
            g.add(sel);
            this._paletteGroup.add(g);
            this._coreNodes[c] = { group: g, bar, stripe, sel };
        });

        // ── 槽位中的线芯 ──
        this._placedNodes = [];
        for (let i = 0; i < 8; i++) {
            const cx = this._slotCenterX(i);
            const g = new Konva.Group({ visible: false, listening: false });
            const bar = new Konva.Rect({
                x: cx - 8, y: this._slot.y + 10, width: 16, height: this._slot.h - 22,
                fill: '#cccccc', stroke: '#00000022', strokeWidth: 1, cornerRadius: 4,
            });
            const stripe = new Konva.Rect({
                x: cx - 8 + 3, y: this._slot.y + 10, width: 5, height: this._slot.h - 22,
                fill: '#ffffff', opacity: 0.9, visible: false, cornerRadius: 2,
            });
            const name = new Konva.Text({
                x: cx - 22, y: this._slot.y + this._slot.h + 6, width: 44, align: 'center',
                text: '', fontSize: 10, fill: '#475569',
            });
            g.add(bar, stripe, name);
            d.add(g);
            this._placedNodes.push({ group: g, bar, stripe, name });
        }

        // ── 水晶头金脚动态着色 ──
        this._pinDyn = [];
        for (let i = 0; i < 8; i++) {
            const n = new Konva.Rect({
                x: this._rj.pinX0 + i * this._rj.pinStep, y: this._rj.pinY,
                width: this._rj.pinW, height: this._rj.pinH,
                fill: '#cccccc', stroke: '#00000033', strokeWidth: 1, cornerRadius: 1.5,
                visible: false, listening: false,
            });
            d.add(n);
            this._pinDyn.push(n);
        }
        // 压接标记
        this._crimpMark = new Konva.Group({ visible: false, listening: false });
        this._crimpMark.add(new Konva.Rect({
            x: this._rj.x + 12, y: this._rj.y + this._rj.h - 2, width: this._rj.w - 24, height: 16,
            fill: 'none', stroke: '#16a34a', strokeWidth: 2, cornerRadius: 3,
        }));
        this._crimpMark.add(new Konva.Text({
            x: this._rj.x, y: this._rj.y + this._rj.h + 18, width: this._rj.w, align: 'center',
            text: '已压接', fontSize: 11, fill: '#16a34a',
        }));
        d.add(this._crimpMark);

        // ── 状态栏 ──
        this._statusText = new Konva.Text({
            x: 24, y: 626, text: '', fontSize: 14, fontStyle: 'bold', fill: '#1f3a5f', listening: false,
        });
        d.add(this._statusText);

        // ── 测线仪提示 ──
        this._testerHint = new Konva.Text({
            x: 850, y: 620, width: 130, text: '', fontSize: 11, fill: '#64748b', listening: false,
        });
        d.add(this._testerHint);

        // ── 测线仪指示灯 ──
        this._ledNodes = [];
        for (let i = 0; i < 8; i++) {
            const cx = this._bar.ledX0 + i * this._bar.ledStep;
            const n = new Konva.Circle({
                x: cx, y: this._bar.ledY, radius: this._bar.r,
                fill: '#d7dee8', stroke: '#94a3b8', strokeWidth: 1.2, listening: false,
            });
            d.add(n);
            this._ledNodes.push(n);
        }
    }

    _bindInteraction() {
        // 电缆
        this.addClickablePart('jacket', this._cable.jacket.x - 4, this._cable.jacket.y - 4, this._cable.jacket.w + 8, this._cable.jacket.h + 8);
        this.addClickablePart('pairs', this._cable.pairX1 - 6, this._cable.pairY - 10, this._cable.pairX2 - this._cable.pairX1 + 12, 52);

        // 线芯（命中区随调色板显示/隐藏，避免 idle 时残留淡色热区）
        this._corePartGroups = {};
        PALETTE_ORDER.forEach((c, i) => {
            const y = this._palette.y + i * this._palette.step;
            const hit = this.addClickablePart('core-' + c, this._palette.x, y, this._palette.w, this._palette.h);
            hit.on('click tap', () => this.selectCore(c));
            this._corePartGroups[c] = hit.getParent();
        });

        // 槽位
        for (let i = 0; i < 8; i++) {
            const cx = this._slotCenterX(i);
            this.addClickablePart('slot-' + (i + 1), cx - this._slot.w / 2, this._slot.y, this._slot.w, this._slot.h)
                .on('click tap', () => this._onSlotClick(i));
        }

        // 工具
        this._toolRows.forEach((t, i) => {
            const y = this._toolRowY0 + i * this._toolRowStep;
            const hit = this.addClickablePart(t.key, this._toolRowX, y, this._toolRowW, this._toolRowH);
            hit.on('click tap', () => {
                if (t.key === 'tool-stripper') this.stripJacket();
                else if (t.key === 'tool-cutter') this.trimCores();
                else if (t.key === 'tool-crimper') this.crimp();
                else if (t.key === 'reset') this.reset();
            });
        });

        // 水晶头与金脚
        this.addClickablePart('rj45', this._rj.x - 4, this._rj.y - 20, this._rj.w + 8, this._rj.h + 40)
            .on('click tap', () => this.insertIntoRj45());
        for (let i = 0; i < 8; i++) {
            this.addClickablePart('pin-' + (i + 1),
                this._rj.pinX0 + i * this._rj.pinStep - 2, this._rj.pinY, this._rj.pinStep, this._rj.pinH);
        }

        // 测线仪
        this.addClickablePart('tester', this._bar.bodyX, this._bar.bodyY, this._bar.bodyW, this._bar.bodyH)
            .on('click tap', () => this.runTest());
        for (let i = 0; i < 8; i++) {
            const cx = this._bar.ledX0 + i * this._bar.ledStep;
            this.addClickablePart('led-' + (i + 1), cx - this._bar.r - 2, this._bar.ledY - this._bar.r + 8, this._bar.r * 2 + 4, this._bar.r * 2 + 4);
        }
    }

    // ═══════════════════════════════════════════
    // 动态刷新与渲染
    // ═══════════════════════════════════════════

    _render() {
        if (!this.sys) return;
        if (this.sys.layer) {
            try { this.sys.layer.draw(); }
            catch (e) { if (typeof this.sys.layer.batchDraw === 'function') this.sys.layer.batchDraw(); }
        }
        if (typeof this.sys.requestRedraw === 'function') this.sys.requestRedraw();
    }

    _tip(msg) {
        if (this.sys && typeof this.sys.showFloatingTip === 'function') this.sys.showFloatingTip(msg, 2800);
    }

    _refreshDynamic() {
        if (!this._paletteGroup) return;
        const idle = this._stage === 'idle';

        this._jacketGroup.visible(idle);
        this._pairsGroup.visible(idle);
        this._paletteGroup.visible(!idle);

        // 调色板线芯：已放入槽位的隐藏
        PALETTE_ORDER.forEach(c => {
            const n = this._coreNodes[c];
            if (!n) return;
            const placed = this._slotColors.includes(c);
            n.group.visible(!placed);
            n.sel.visible(this._selectedCore === c);
            if (this._corePartGroups && this._corePartGroups[c]) {
                this._corePartGroups[c].visible(!idle && !placed);
            }
        });

        // 槽位
        this._slotColors.forEach((c, i) => {
            const n = this._placedNodes[i];
            if (!n) return;
            if (c) {
                const def = CORE_DEFS[c];
                n.group.visible(true);
                n.bar.fill(def.fill);
                n.stripe.visible(!!def.white);
                n.name.text(def.name);
            } else {
                n.group.visible(false);
            }
        });

        // 金脚
        const showPins = this._stage === 'inserted' || this._stage === 'crimped' || this._stage === 'tested';
        this._pinDyn.forEach((n, i) => {
            const c = this._slotColors[i];
            if (showPins && c) { n.visible(true); n.fill(CORE_DEFS[c].fill); }
            else n.visible(false);
        });

        // 压接标记
        if (this._crimpMark) this._crimpMark.visible(this._stage === 'crimped' || this._stage === 'tested');

        // 状态
        if (this._statusText) this._statusText.text('状态：' + this.getStatusText());
        if (this._testerHint) {
            if (this._stage === 'tested' && this._testResult) {
                this._testerHint.text(this._testResult.pass ? '检测结果：合格' : `检测结果：不合格（${this._faultSummary()}）`);
                this._testerHint.fill(this._testResult.pass ? '#16a34a' : '#dc2626');
            } else {
                this._testerHint.text('压接后点击机身检测');
                this._testerHint.fill('#64748b');
            }
        }
    }

    // ═══════════════════════════════════════════
    // 工艺动作
    // ═══════════════════════════════════════════

    stripJacket() {
        if (this._stage !== 'idle') { this._tip('外皮已剥去'); return false; }
        this._stage = 'stripped';
        this._refreshDynamic();
        this._render();
        this._tip(`已剥去约 ${this.stripLength}mm 外皮，露出 4 对共 8 根线芯`);
        return true;
    }

    selectCore(color) {
        if (this._stage === 'idle') { this._tip('请先用剥线钳剥去外皮'); return false; }
        if (this._slotColors.includes(color)) { this._tip(`${CORE_DEFS[color].name}线芯已放入槽位`); return false; }
        this._selectedCore = (this._selectedCore === color) ? null : color;
        this._refreshDynamic();
        this._render();
        if (this._selectedCore) this._tip(`已选择${CORE_DEFS[color].name}线芯，请点击右侧槽位`);
        return true;
    }

    _onSlotClick(slotIdx) {
        if (!this._selectedCore) { this._tip('请先在左侧点击一根线芯'); return; }
        this.placeCore(slotIdx + 1);
    }

    placeCore(slotIndex, color) {
        const c = color || this._selectedCore;
        if (!c) { this._tip('请先点击左侧线芯'); return false; }
        if (slotIndex < 1 || slotIndex > 8) return false;
        if (this._slotColors[slotIndex - 1]) { this._tip(`第 ${slotIndex} 号槽位已有线芯`); return false; }
        if (this._slotColors.includes(c)) { this._tip(`${CORE_DEFS[c].name}线芯已放入槽位`); return false; }
        this._slotColors[slotIndex - 1] = c;
        this._selectedCore = null;
        if (this._slotColors.every(Boolean)) this._stage = 'arranged';
        this._refreshDynamic();
        this._render();
        return true;
    }

    trimCores() {
        if (this._stage === 'idle') { this._tip('请先剥去外皮并排列线序'); return false; }
        if (this._stage === 'stripped') { this._tip('请先把 8 根线芯放入槽位完成排列'); return false; }
        if (this._stage !== 'arranged') { this._tip('线芯已剪齐'); return false; }
        this._stage = 'trimmed';
        this._refreshDynamic();
        this._render();
        this._tip('已把线芯剪齐（保留约 12mm），准备插入水晶头');
        return true;
    }

    insertIntoRj45() {
        if (this._stage !== 'trimmed') { this._tip('请先完成排线并剪齐线芯'); return false; }
        this._stage = 'inserted';
        this._refreshDynamic();
        this._render();
        this._tip('线芯已插入水晶头，确认外皮压在卡扣内');
        return true;
    }

    crimp() {
        if (this._stage !== 'inserted') { this._tip('请先把线芯插入水晶头'); return false; }
        this._stage = 'crimped';
        this._refreshDynamic();
        this._render();
        this._tip('已用网线钳压接水晶头');
        return true;
    }

    /** 测线：比对槽位线序与目标线序（含故障），返回 { pass, faults } */
    runTest() {
        if (this._stage !== 'crimped' && this._stage !== 'tested') {
            this._tip('请先完成压接，再测线'); return null;
        }
        const expect = this._targetOrder();
        const faults = [];
        for (let i = 0; i < 8; i++) {
            const pin = i + 1;
            let actualC = this._slotColors[i];
            if (this._openPins.includes(pin)) actualC = null;
            if (this._shortPins.includes(pin)) actualC = this._slotColors[this._shortPins[0] - 1];
            const ok = actualC !== null && actualC === expect[i];
            faults.push({ pin, expect: expect[i], actual: actualC, ok });
        }
        const pass = faults.every(f => f.ok);
        this._testResult = { pass, faults };
        this._stage = 'tested';

        // 指示灯依次点亮
        this._clearLedTimers();
        this._ledNodes.forEach(n => n.fill('#d7dee8'));
        this._render();
        faults.forEach((f, k) => {
            const color = f.actual === null ? '#9aa4b0' : (f.ok ? '#22c55e' : '#ef4444');
            this._ledTimers.push(setTimeout(() => {
                if (this._ledNodes[k]) this._ledNodes[k].fill(color);
                this._render();
            }, 300 * (k + 1)));
        });

        this._refreshDynamic();
        this._render();
        return this._testResult;
    }

    // ═══════════════════════════════════════════
    // 故障 / 复位
    // ═══════════════════════════════════════════

    setFault(type) {
        // 先还原上一次的故障
        if (this._fault === 'order' && this._slotColors.every(Boolean)) {
            const t = this._slotColors[3]; this._slotColors[3] = this._slotColors[5]; this._slotColors[5] = t;
        }
        this._openPins = [];
        this._shortPins = [];
        this._fault = null;

        if (type === 'order') {
            if (this._slotColors.every(Boolean)) {
                const t = this._slotColors[3]; this._slotColors[3] = this._slotColors[5]; this._slotColors[5] = t;
                this._fault = 'order';
            }
        } else if (type === 'open') {
            this._openPins = [3];
            this._fault = 'open';
        } else if (type === 'short') {
            this._shortPins = [5, 6];
            this._fault = 'short';
        }
        this._refreshDynamic();
        this._render();
        return this._fault;
    }

    getFault() { return this._fault; }

    /** 一键制备一根合格网线（复位并按目标线序直接压接完成），供故障流程做前置准备 */
    autoBuild() {
        this.reset(true);
        if (this._stage === 'idle') this._stage = 'stripped';
        this._slotColors = this._targetOrder();
        this._stage = 'crimped';
        this._refreshDynamic();
        this._render();
        return true;
    }

    reset(silent = false) {
        this._clearLedTimers();
        this._ledNodes && this._ledNodes.forEach(n => n.fill('#d7dee8'));
        this._stage = 'idle';
        this._selectedCore = null;
        this._slotColors = new Array(8).fill(null);
        this._fault = null;
        this._openPins = [];
        this._shortPins = [];
        this._testResult = null;
        this._refreshDynamic();
        this._render();
        if (!silent) this._tip('已复位，可重新开始制作');
        return true;
    }

    _clearLedTimers() {
        if (!this._ledTimers) return;
        this._ledTimers.forEach(t => clearTimeout(t));
        this._ledTimers = [];
    }

    // ═══════════════════════════════════════════
    // 查询接口（供工作流 check()）
    // ═══════════════════════════════════════════

    getStage() { return this._stage; }
    getSlots() { return this._slotColors.slice(); }
    getTestResult() { return this._testResult; }
    isArranged() { return this._stage === 'arranged' || this._stage === 'trimmed' || this._stage === 'inserted' || this._stage === 'crimped' || this._stage === 'tested'; }
    isPass() { return !!(this._testResult && this._testResult.pass); }

    getStatusText() {
        switch (this._stage) {
            case 'idle': return '待剥外皮';
            case 'stripped': return '已剥皮 · 待排列线序';
            case 'arranged': return '线序已排好 · 待剪齐';
            case 'trimmed': return '已剪齐 · 待插入水晶头';
            case 'inserted': return '已插入水晶头 · 待压接';
            case 'crimped': return '已压接 · 待测线';
            case 'tested': return (this._testResult && this._testResult.pass) ? '测线合格 ✓' : '测线不合格 ✗';
            default: return '';
        }
    }

    _faultSummary() {
        if (!this._testResult) return '';
        const bad = this._testResult.faults.filter(f => !f.ok);
        if (!bad.length) return '通过';
        if (this._fault === 'open') return `第 ${bad.map(f => f.pin).join('、')} 脚断路`;
        if (this._fault === 'short') return `第 ${bad.map(f => f.pin).join('、')} 脚短路`;
        return `第 ${bad.map(f => f.pin).join('、')} 脚线序错误`;
    }

    /** 覆盖：用绝对变换换算，供工作流箭头精确指向部件（含旋转/缩放） */
    getClickablePartCenter(partId) {
        const p = this._parts && this._parts[partId];
        if (!p) return null;
        const local = { x: p.x + p.w / 2, y: p.y + p.h / 2 };
        try {
            if (this.group && this.group.getAbsoluteTransform) {
                const pt = this.group.getAbsoluteTransform().point(local);
                return { x: pt.x, y: pt.y };
            }
        } catch (e) { /* fallthrough */ }
        const abs = this.group && this.group.getAbsolutePosition ? this.group.getAbsolutePosition() : { x: 0, y: 0 };
        return { x: abs.x + local.x, y: abs.y + local.y };
    }

    getConfigFields() {
        return [
            { label: '线序标准', key: 'standard', type: 'select', options: [
                { value: 'T568B', label: 'T568B（直通线，常用）' },
                { value: 'T568A', label: 'T568A' },
            ] },
            { label: '剥皮长度 (mm)', key: 'stripLength', type: 'number', min: 10, max: 40, step: 1 },
            { label: '器件名称', key: 'label', type: 'text' },
        ];
    }

    onConfigUpdate(cfg) {
        if (cfg.label !== undefined) this.label = cfg.label;
        if (cfg.standard) this.standard = cfg.standard;
        if (cfg.stripLength !== undefined) this.stripLength = cfg.stripLength;
        this.config = { id: this.id, label: this.label, standard: this.standard, stripLength: this.stripLength };
        this._refreshDynamic();
        this._render();
    }
}
