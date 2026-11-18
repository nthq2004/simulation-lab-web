import { BaseComponent } from './BaseComponent.js';

/**
 * ACControlPanel —— 中央空调控制器（照图 2）
 *
 * 组成：
 *   · 顶部横幅「中央空调控制器」（与压缩机操作台一致）；
 *   · 左旋钮：关 / 制冷 / 制热（工况选择）；
 *   · 右旋钮：手动 / 自动 / 负荷（压缩机运行方式）；
 *   · 设置启动温度 ℃（▲▼）、设置停止温度 ℃（▲▼）；
 *   · 室温竖条表（0~100）。
 *
 * 两个选择旋钮在面板上左右对称分布。
 * 通过 AirConditioningSolver 模型联动。所有操作均模拟点击循环切换 / 步进。
 */

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// 工况：关 / 制冷 / 制热
const MODES = [
    { key: 'off', label: '关', angle: 0 },
    { key: 'cool', label: '制冷', angle: -90 },
    { key: 'heat', label: '制热', angle: 90 },
];
// 运行方式（加载/卸载）：手动 / 自动负荷（仅指示，不参与控制）
const LOADMODES = [
    { key: 'manual', label: '手动', angle: 0 },
    { key: 'auto', label: '自动负荷', angle: -90 },
];

// ── 选择旋钮框尺寸（在 112×122 基础上宽高各减 15px）──
const SEL_W = 97, SEL_H = 107, SEL_R = 22;

export class ACControlPanel extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);
        this.W = Math.max(400, config.width || 455);
        this.H = Math.max(260, config.height || 310);
        this.type = 'ac_control_panel';
        this.special = 'refrig_panel';
        this.cache = 'fixed';

        this._selCenters = {};
        this._loadMode = 'manual';   // 负荷选择开关状态（手动 / 自动负荷），仅指示

        this._initGroups();
        this._drawStaticParts();
        this._createDynamicNodes();
        this._bindInteraction();
        this._syncVisuals();

        this.config = { id: this.id, width: this.W, height: this.H };
    }

    // ═══════════════════════════════════════════════════════
    // 静态绘制
    // ═══════════════════════════════════════════════════════

    _drawStaticParts() {
        const g = this._staticGroup, W = this.W;
        g.add(new Konva.Rect({ x: 0, y: 0, width: W, height: this.H, fill: '#c8d0d4', stroke: '#7a858c', strokeWidth: 2, cornerRadius: 6 }));

        // 顶部横幅（与压缩机操作台一致）
        g.add(new Konva.Rect({ x: 6, y: 6, width: W - 12, height: 28, fill: '#eef1f2', stroke: '#444', strokeWidth: 1 }));
        g.add(new Konva.Text({ x: 6, y: 12, width: W - 12, text: '中央空调控制器', fontSize: 14, fontStyle: 'bold', fill: '#222', align: 'center' }));

        // 两个选择旋钮框：左右对称分布（间距 = 两侧边距）
        const by = 44;
        const gap = 29;
        const contentW = SEL_W * 2 + gap;
        const margin = (W - contentW) / 2;
        const b1x = margin, b2x = margin + SEL_W + gap;
        // 左：关 / 制冷 / 制热
        this._drawSelectorBox(b1x, by, { top: '关', left: '制冷', right: '制热' });
        // 右：手动 / 自动负荷（两档）
        this._drawSelectorBox(b2x, by, { top: '手动', left: '自动负荷' });

        // ── 底部三组，左右均衡分布：设置启动温度 / 设置停止温度 / 室温表 ──
        // 设置启动温度
        g.add(new Konva.Text({ x: 34, y: 192, width: 120, text: '设置启动温度 ℃', fontSize: 12, fontStyle: 'bold', fill: '#1b5e20' }));
        g.add(new Konva.Rect({ x: 34, y: 212, width: 80, height: 48, fill: '#e8f5e9', stroke: '#2e7d32', strokeWidth: 1.5, cornerRadius: 3 }));
        this._drawArrowBtn(g, 116, 210, true);
        this._drawArrowBtn(g, 116, 240, false);

        // 设置停止温度
        g.add(new Konva.Text({ x: 180, y: 192, width: 120, text: '设置停止温度 ℃', fontSize: 12, fontStyle: 'bold', fill: '#b71c1c' }));
        g.add(new Konva.Rect({ x: 180, y: 212, width: 80, height: 48, fill: '#fdecea', stroke: '#c62828', strokeWidth: 1.5, cornerRadius: 3 }));
        this._drawArrowBtn(g, 262, 210, true);
        this._drawArrowBtn(g, 262, 240, false);

        // 室温表（竖条 + 刻度 0~100）：标签在上、读数在下
        g.add(new Konva.Text({ x: 327, y: 158, width: 80, text: '室温', fontSize: 11, fontStyle: 'bold', fill: '#37474f', align: 'center' }));
        g.add(new Konva.Rect({ x: 352, y: 176, width: 30, height: 104, fill: '#fbfbfb', stroke: '#455a64', strokeWidth: 2, cornerRadius: 4 }));
        for (let v = 0; v <= 100; v += 10) {
            const y = 278 - v * 1.02;
            const major = (v % 20 === 0);
            g.add(new Konva.Line({ points: [386, y, 386 + (major ? 9 : 5), y], stroke: '#546e7a', strokeWidth: 1 }));
            if (major) g.add(new Konva.Text({ x: 397, y: y - 6, text: String(v), fontSize: 9, fill: '#37474f', fontFamily: 'monospace' }));
        }
    }

    /** 选择旋钮框（返回旋钮中心坐标） */
    _drawSelectorBox(x, y, labels) {
        const g = this._staticGroup, w = SEL_W, h = SEL_H, r = SEL_R;
        const kx = x + w / 2, ky = y + h / 2;
        g.add(new Konva.Rect({ x, y, width: w, height: h, fill: '#dfe4e6', stroke: '#5f7178', strokeWidth: 1.5, cornerRadius: 4 }));
        // 旋钮
        g.add(new Konva.Circle({ x: kx, y: ky, radius: r, fill: '#2b2f33', stroke: '#111', strokeWidth: 1.5 }));
        // 档位标注（right 缺省时该框为两档：仅 顶档 + 左档）
        g.add(new Konva.Text({ x, y: y + 2, width: w, text: labels.top, fontSize: 12, fontStyle: 'bold', fill: '#222', align: 'center' }));
        g.add(new Konva.Text({ x: x + 3, y: y + h - 20, width: w / 2 - 4, text: labels.left, fontSize: 11, fontStyle: 'bold', fill: '#222', align: 'left' }));
        // 档位指示点
        g.add(new Konva.Circle({ x: kx, y: ky - r - 8, radius: 4, fill: '#78909c' }));
        g.add(new Konva.Circle({ x: kx - r - 11, y: ky + 8, radius: 4, fill: '#78909c' }));
        if (labels.right) {
            g.add(new Konva.Text({ x: x + w / 2 + 2, y: y + h - 20, width: w / 2 - 5, text: labels.right, fontSize: 11, fontStyle: 'bold', fill: '#222', align: 'right' }));
            g.add(new Konva.Circle({ x: kx + r + 11, y: ky + 8, radius: 4, fill: '#78909c' }));
        }
        return { kx, ky };
    }

    _drawArrowBtn(g, x, y, up) {
        g.add(new Konva.Rect({ x, y, width: 26, height: 22, fill: '#b0bec5', stroke: '#607d8b', strokeWidth: 1, cornerRadius: 3 }));
        g.add(new Konva.Line({ points: up ? [x + 7, y + 16, x + 13, y + 6, x + 19, y + 16] : [x + 7, y + 6, x + 13, y + 16, x + 19, y + 6], stroke: '#263238', strokeWidth: 2 }));
    }

    // ═══════════════════════════════════════════════════════
    // 动态节点
    // ═══════════════════════════════════════════════════════

    _createDynamicNodes() {
        const d = this._dynamicGroup;
        const W = this.W;

        // 两个选择旋钮指针（位置与静态框一致）
        const gap = 29, contentW = SEL_W * 2 + gap, margin = (W - contentW) / 2;
        const c1 = { x: margin + SEL_W / 2, y: 44 + SEL_H / 2 };
        const c2 = { x: margin + SEL_W + gap + SEL_W / 2, y: 44 + SEL_H / 2 };

        this._modeKnob = new Konva.Group({ x: c1.x, y: c1.y });
        this._modeKnob.add(new Konva.Rect({ x: -3, y: -18, width: 6, height: 16, fill: '#f5f5f5', cornerRadius: 2 }));
        d.add(this._modeKnob);

        this._loadKnob = new Konva.Group({ x: c2.x, y: c2.y });
        this._loadKnob.add(new Konva.Rect({ x: -3, y: -18, width: 6, height: 16, fill: '#f5f5f5', cornerRadius: 2 }));
        d.add(this._loadKnob);

        // 设定值数字
        this._startVal = new Konva.Text({ x: 34, y: 220, width: 80, text: '24', fontSize: 24, fontStyle: 'bold', fill: '#102a43', align: 'center', fontFamily: 'monospace' });
        this._stopVal = new Konva.Text({ x: 180, y: 220, width: 80, text: '22', fontSize: 24, fontStyle: 'bold', fill: '#102a43', align: 'center', fontFamily: 'monospace' });
        d.add(this._startVal, this._stopVal);

        // 室温竖条（在刻度框内自底向上填充）
        this._roomBar = new Konva.Rect({ x: 355, y: 179, width: 24, height: 98, fill: '#ef6c00', cornerRadius: 3 });
        d.add(this._roomBar);
        this._roomText = new Konva.Text({ x: 327, y: 286, width: 80, text: '26.0℃', fontSize: 12, fontStyle: 'bold', fill: '#ef6c00', align: 'center', fontFamily: 'monospace' });
        d.add(this._roomText);
    }

    // ═══════════════════════════════════════════════════════
    // 交互
    // ═══════════════════════════════════════════════════════

    _bindInteraction() {
        const W = this.W;
        const gap = 29, contentW = SEL_W * 2 + gap, margin = (W - contentW) / 2;
        const b1x = margin, b2x = margin + SEL_W + gap;

        const mk = (id, x, y, w, h, fn) => { const n = this.addClickablePart(id, x, y, w, h, true); if (n) n.on('click tap', fn); };

        // 工况三档
        mk('mode-off', b1x, 46, SEL_W, 22, () => this._setMode('off'));
        mk('mode-cool', b1x, 100, (SEL_W - 4) / 2, 30, () => this._setMode('cool'));
        mk('mode-heat', b1x + SEL_W / 2 + 2, 100, (SEL_W - 4) / 2, 30, () => this._setMode('heat'));

        // 运行方式两档：向上=手动，向左=自动负荷
        mk('load-manual', b2x, 46, SEL_W, 22, () => this._setLoadMode('manual'));
        mk('load-auto', b2x, 100, SEL_W / 2, 30, () => this._setLoadMode('auto'));

        // 温度设定
        mk('up-start', 116, 210, 26, 22, () => this._bump('setStart', +1));
        mk('down-start', 116, 240, 26, 22, () => this._bump('setStart', -1));
        mk('up-stop', 262, 210, 26, 22, () => this._bump('setStop', +1));
        mk('down-stop', 262, 240, 26, 22, () => this._bump('setStop', -1));
    }

    // ── 操作 ──
    _solver() { return this.sys && this.sys.acSolver ? this.sys.acSolver : null; }
    _model() { const s = this._solver(); return s ? s.m : null; }

    _setMode(k) {
        const m = this._model(); if (!m) return;
        m.mode = k;
        this._syncVisuals();
    }

    _setLoadMode(k) {
        // 负荷选择开关（向上=手动 / 向左=自动负荷）：仅指示空压机加载 / 卸载方式，
        // 不参与任何控制（压缩机的起停由压缩机操作台控制）。
        this._loadMode = k;
        const m = this._model();
        if (m) m.loadMode = k;   // 仅作指示镜像
        this._syncVisuals();
    }

    _bump(field, d) {
        const m = this._model(); if (!m || !m.cabin) return;
        m.cabin[field] = Math.round((m.cabin[field] + d) * 10) / 10;
        this._syncVisuals();
    }

    // ═══════════════════════════════════════════════════════
    // 视觉同步
    // ═══════════════════════════════════════════════════════

    _syncVisuals() {
        const m = this._model();

        const mode = (m && m.mode) || 'off';
        const mi = MODES.findIndex(x => x.key === mode);
        if (this._modeKnob) this._modeKnob.rotation(mi >= 0 ? MODES[mi].angle : 0);

        const lm = this._loadMode || (m && m.loadMode) || 'manual';
        const li = LOADMODES.findIndex(x => x.key === lm);
        if (this._loadKnob) this._loadKnob.rotation(li >= 0 ? LOADMODES[li].angle : 0);

        if (m && m.cabin) {
            if (this._startVal) this._startVal.text(String(Math.round(m.cabin.setStart)));
            if (this._stopVal) this._stopVal.text(String(Math.round(m.cabin.setStop)));
            if (this._roomBar) {
                const t = clamp(m.cabin.temp, 0, 100);
                const h = 98 * (t / 100);
                this._roomBar.height(Math.max(2, h));
                this._roomBar.y(277 - Math.max(2, h));
            }
            if (this._roomText) this._roomText.text(m.cabin.temp.toFixed(1) + '℃');
        }

        if (this.sys && this.sys.requestRedraw) this.sys.requestRedraw();
    }

    tick() { this._syncVisuals(); this._refreshIfDirty(); }

    getConfigFields() { return [{ label: '器件名称 (ID)', key: 'id', type: 'text' }]; }
    onConfigUpdate(cfg) { if (cfg.id) this.id = cfg.id; this.config = { ...this.config, ...cfg }; }
}

export default ACControlPanel;
