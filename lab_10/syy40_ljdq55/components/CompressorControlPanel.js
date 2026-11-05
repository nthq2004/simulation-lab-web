import { BaseComponent } from './BaseComponent.js';

/**
 * CompressorControlPanel —— 压缩机操作台（船舶中央空调 · 单压缩机）
 *
 * 界面分三行：
 *   第一行：压缩机状态指示灯、手动/自动切换开关（左=自动、上=手动）、负荷显示、
 *           带灯起动/停止按钮（运行：起动亮绿、停止暗红；停机：起动暗绿、停止亮红）；
 *   第二行：启动压力 / 压差 / 停止压力（高压保护）三项整定刻度，各带 左减 / 右增 按钮；
 *   第三行：进口压力表、出口压力表、滑油差压压力表。
 *
 * 通过 AirConditioningSolver 模型联动（单台压缩机 running / loadPct / mode）。
 */

const SCALE_DEFS = [
    { key: 'startP', min: 0, max: 8, major: 2, minor: 1, labelMin: 0, labelStep: 2, step: 0.1, dec: 1, title: '启动压力' },
    { key: 'diffP', min: 0, max: 3, major: 1, minor: 0.5, labelMin: 0, labelStep: 1, step: 0.1, dec: 1, title: '压差' },
    { key: 'hpP', min: 12, max: 25, major: 2, minor: 1, labelMin: 12, labelStep: 2, step: 1, dec: 0, title: '停止压力' },
];

const DEFAULTS = { mode: 'manual', startP: 3.5, diffP: 0.5, hpP: 18 };

// ── 布局常量（基准 455 × 415） ──
const ROW2 = { top: 198, bottom: 284 };
const UNIT_XL = [12, 159, 306];
const UNIT_W = 141;
const AXIS_DX = 96;
const BTN_Y = 176, BTN_W = 26, BTN_H = 18;
const BTN_DEC_DX = 39, BTN_INC_DX = 76;
const GAUGE_CX = [78, 227, 376];
const GAUGE_CY = 352, GAUGE_R = 40;
const GAUGE_DEFS = [
    { key: 'pe', label: '进口压力', max: 8 },
    { key: 'pc', label: '出口压力', max: 30 },
    { key: 'oilP', label: '滑油差压', max: 4 },
];

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

export class CompressorControlPanel extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);
        this.W = Math.max(400, config.width || 455);
        this.H = Math.max(360, config.height || 415);
        this.type = 'compressor_control_panel';
        this.special = 'refrig_panel';
        this.cache = 'fixed';

        this.settings = { ...DEFAULTS };
        this._running = false;

        this._initGroups();
        this._drawStaticParts();
        this._createDynamicNodes();
        this._bindInteraction();
        this._syncVisuals();

        this.config = { id: this.id, width: this.W, height: this.H };
    }

    // ── 模式接口（兼容旧接口：读写当前压缩机） ──
    get mode() { return this.settings.mode; }
    set mode(v) { this.settings.mode = v; }

    setMode(mode) { this.settings.mode = mode; this._syncVisuals(); }

    // ═══════════════════════════════════════════════════════
    // 静态绘制
    // ═══════════════════════════════════════════════════════

    _drawStaticParts() {
        const g = this._staticGroup;
        g.add(new Konva.Rect({ x: 0, y: 0, width: this.W, height: this.H, fill: '#c8d0d4', stroke: '#7a858c', strokeWidth: 2, cornerRadius: 6 }));

        // 标题栏
        g.add(new Konva.Rect({ x: 6, y: 6, width: this.W - 12, height: 28, fill: '#eef1f2', stroke: '#444', strokeWidth: 1 }));
        g.add(new Konva.Text({ x: 6, y: 12, width: this.W - 12, text: '压缩机操作台', fontSize: 14, fontStyle: 'bold', fill: '#222', align: 'center' }));

        // 手动/自动 开关框
        g.add(new Konva.Rect({ x: 116, y: 44, width: 120, height: 120, fill: '#dfe4e6', stroke: '#5f7178', strokeWidth: 1.5, cornerRadius: 4 }));
        g.add(new Konva.Text({ x: 116, y: 50, width: 120, text: '手动', fontSize: 13, fontStyle: 'bold', fill: '#222', align: 'center' }));
        g.add(new Konva.Text({ x: 122, y: 98, width: 44, text: '自动', fontSize: 13, fontStyle: 'bold', fill: '#222', align: 'left' }));

        // 负荷显示框（与启停按钮水平对齐）
        g.add(new Konva.Rect({ x: 254, y: 89, width: 52, height: 30, fill: '#f2c200', stroke: '#b58900', strokeWidth: 1.5, cornerRadius: 3 }));
        g.add(new Konva.Text({ x: 254, y: 123, width: 52, text: '负荷 %', fontSize: 10, fill: '#546e7a', align: 'center' }));

        // 起动 / 停止 按钮外圈与标注
        g.add(new Konva.Circle({ x: 345, y: 104, radius: 33, fill: '#c2cbcf', stroke: '#8a9498', strokeWidth: 1.5 }));
        g.add(new Konva.Circle({ x: 413, y: 104, radius: 33, fill: '#c2cbcf', stroke: '#8a9498', strokeWidth: 1.5 }));
        g.add(new Konva.Text({ x: 315, y: 58, width: 60, text: '启动', fontSize: 13, fontStyle: 'bold', fill: '#1b5e20', align: 'center' }));
        g.add(new Konva.Text({ x: 383, y: 58, width: 60, text: '停止', fontSize: 13, fontStyle: 'bold', fill: '#b71c1c', align: 'center' }));

        // 三项整定刻度
        SCALE_DEFS.forEach((sd, i) => this._drawScale(g, sd, UNIT_XL[i]));

        // 三个压力表
        GAUGE_DEFS.forEach((gd, i) => this._drawGaugeFace(g, GAUGE_CX[i], GAUGE_CY, GAUGE_R, gd));
    }

    _drawScale(g, sd, xL) {
        const axisX = xL + AXIS_DX;
        const mkBtn = (bx, glyph) => {
            g.add(new Konva.Rect({ x: bx, y: BTN_Y, width: BTN_W, height: BTN_H, fill: '#b0bec5', stroke: '#546e7a', strokeWidth: 1, cornerRadius: 3 }));
            g.add(new Konva.Text({ x: bx, y: BTN_Y + 3, width: BTN_W, text: glyph, fontSize: 12, fontStyle: 'bold', fill: '#263238', align: 'center' }));
        };
        mkBtn(xL + BTN_DEC_DX, '\u2212');
        mkBtn(xL + BTN_INC_DX, '+');

        g.add(new Konva.Line({ points: [axisX, ROW2.top, axisX, ROW2.bottom], stroke: '#37474f', strokeWidth: 2 }));

        const span = sd.max - sd.min;
        const n = Math.round(span / sd.minor);
        for (let i = 0; i <= n; i++) {
            const v = Math.round((sd.min + i * sd.minor) * 100) / 100;
            const y = ROW2.bottom - (v - sd.min) / span * (ROW2.bottom - ROW2.top);
            const major = Math.abs((v - sd.min) % sd.major) < 1e-6;
            const len = major ? 12 : 6;
            g.add(new Konva.Line({ points: [axisX - len, y, axisX + 2, y], stroke: '#37474f', strokeWidth: major ? 1.6 : 1 }));
            if (major && v >= sd.labelMin - 1e-6 && Math.abs((v - sd.labelMin) % sd.labelStep) < 1e-6) {
                g.add(new Konva.Text({ x: axisX - len - 34, y: y - 7, width: 30, text: String(Math.round(v)), fontSize: 10, fill: '#263238', align: 'right', fontFamily: 'monospace' }));
            }
        }

        g.add(new Konva.Text({ x: xL, y: ROW2.bottom + 6, width: UNIT_W, text: sd.title, fontSize: 11, fontStyle: 'bold', fill: '#37474f', align: 'center' }));
    }

    _drawGaugeFace(g, cx, cy, r, gd) {
        g.add(new Konva.Circle({ x: cx, y: cy, radius: r, fill: '#f7f7f2', stroke: '#37474f', strokeWidth: 2 }));
        g.add(new Konva.Circle({ x: cx, y: cy, radius: r - 4, fill: '#ffffff', stroke: '#c9d2d6', strokeWidth: 1 }));
        const N = 12;
        for (let i = 0; i <= N; i++) {
            const a = (-225 + i * 270 / N) * Math.PI / 180;
            const major = (i % 3 === 0);
            const r1 = r - 5, r2 = r - (major ? 13 : 9);
            g.add(new Konva.Line({ points: [cx + Math.cos(a) * r1, cy + Math.sin(a) * r1, cx + Math.cos(a) * r2, cy + Math.sin(a) * r2], stroke: '#546e7a', strokeWidth: major ? 1.6 : 1 }));
        }
        g.add(new Konva.Text({ x: cx - 30, y: cy - 15, width: 60, text: 'R407C', fontSize: 8, fill: '#90a4ae', align: 'center' }));
        g.add(new Konva.Text({ x: cx - 50, y: cy + r + 6, width: 100, text: gd.label, fontSize: 11, fontStyle: 'bold', fill: '#37474f', align: 'center' }));
    }

    // ═══════════════════════════════════════════════════════
    // 动态节点
    // ═══════════════════════════════════════════════════════

    _createDynamicNodes() {
        const d = this._dynamicGroup;

        // 状态指示灯
        this._lamp = new Konva.Circle({ x: 55, y: 104, radius: 38, fill: '#0e2f10', stroke: '#08300b', strokeWidth: 2 });
        this._lampText = new Konva.Text({ x: 15, y: 95, width: 80, text: 'COMP1', fontSize: 16, fontStyle: 'bold', fill: '#e8f5e9', align: 'center' });
        d.add(this._lamp, this._lampText);

        // 负荷数字
        this._loadText = new Konva.Text({ x: 254, y: 93, width: 52, text: '0', fontSize: 20, fontStyle: 'bold', fill: '#3a2a00', align: 'center', fontFamily: 'monospace' });
        d.add(this._loadText);

        // 手动/自动旋钮
        this._knob = new Konva.Group({ x: 176, y: 104 });
        this._knob.add(new Konva.Circle({ radius: 30, fill: '#3d4145', stroke: '#111', strokeWidth: 1.5 }));
        this._knob.add(new Konva.Rect({ x: -3, y: -28, width: 6, height: 20, fill: '#f5f5f5', cornerRadius: 2 }));
        d.add(this._knob);

        // 起动 / 停止 灯
        this._startLamp = new Konva.Circle({ x: 345, y: 104, radius: 30, fill: '#14532d', stroke: '#0b2e18', strokeWidth: 1.5 });
        this._stopLamp = new Konva.Circle({ x: 413, y: 104, radius: 30, fill: '#ef4444', stroke: '#3a0f0f', strokeWidth: 1.5 });
        d.add(this._startLamp, this._stopLamp);

        // 三项整定值红色标注
        this._markers = SCALE_DEFS.map((sd, i) => this._makeMarker(d, UNIT_XL[i] + AXIS_DX));

        // 压力表指针与数字
        this._gauges = GAUGE_DEFS.map((gd, i) => this._makeGaugeDynamic(d, GAUGE_CX[i], GAUGE_CY, GAUGE_R, gd));
    }

    _makeMarker(d, axisX) {
        const g = new Konva.Group();
        g.add(new Konva.Rect({ x: axisX - 16, y: -3, width: 20, height: 6, fill: '#e53935', cornerRadius: 1 }));
        g.add(new Konva.Line({ points: [axisX + 4, -7, axisX + 4, 7, axisX + 16, 0], closed: true, fill: '#e53935' }));
        d.add(g);
        return g;
    }

    _makeGaugeDynamic(d, cx, cy, r, gd) {
        const g = new Konva.Group({ x: cx, y: cy });
        const needle = new Konva.Line({ points: [0, 0, 0, -(r - 14)], stroke: '#d32f2f', strokeWidth: 2.6, lineCap: 'round' });
        g.add(needle);
        g.add(new Konva.Circle({ radius: 5, fill: '#37474f' }));
        g.add(new Konva.Rect({ x: -26, y: 12, width: 52, height: 16, fill: '#0b2b2b', stroke: '#062020', strokeWidth: 1, cornerRadius: 2 }));
        const valText = new Konva.Text({ x: -26, y: 15, width: 52, text: '0.0', fontSize: 11, fontStyle: 'bold', fill: '#39ffd0', align: 'center', fontFamily: 'monospace' });
        g.add(valText);
        d.add(g);
        return { needle, valText, max: gd.max };
    }

    // ═══════════════════════════════════════════════════════
    // 交互
    // ═══════════════════════════════════════════════════════

    _bindInteraction() {
        const fire = (part, fn) => { const n = this.getClickablePartNode(part); if (n) n.on('click tap', fn); };

        this.addClickablePart('mode', 146, 74, 60, 60, true);
        this.addClickablePart('start', 315, 74, 60, 60, true);
        this.addClickablePart('stop', 383, 74, 60, 60, true);

        fire('mode', () => this._toggleMode());
        fire('start', () => this._manualRun(true));
        fire('stop', () => this._manualRun(false));

        SCALE_DEFS.forEach((sd, i) => {
            const xL = UNIT_XL[i];
            this.addClickablePart('dec-' + sd.key, xL + BTN_DEC_DX, BTN_Y, BTN_W, BTN_H, true);
            this.addClickablePart('inc-' + sd.key, xL + BTN_INC_DX, BTN_Y, BTN_W, BTN_H, true);
            fire('dec-' + sd.key, () => this._bump(sd, -1));
            fire('inc-' + sd.key, () => this._bump(sd, +1));
        });

        GAUGE_DEFS.forEach((gd, i) => {
            this.addClickablePart('gauge-' + gd.key,
                GAUGE_CX[i] - GAUGE_R, GAUGE_CY - GAUGE_R, GAUGE_R * 2, GAUGE_R * 2, true);
        });
    }

    _toggleMode() {
        this.settings.mode = (this.settings.mode === 'auto') ? 'manual' : 'auto';
        const c = this._comp(); if (c) c.mode = this.settings.mode;
        this._syncVisuals();
    }

    _bump(sd, dir) {
        const f = Math.pow(10, sd.dec);
        let v = this.settings[sd.key] + dir * sd.step;
        v = clamp(Math.round(v * f) / f, sd.min, sd.max);
        this.settings[sd.key] = v;
        const c = this._comp(); if (c) c[sd.key] = v;
        this._syncVisuals();
    }

    _manualRun(on) {
        const c = this._comp(); if (c) { c.manualRun = on; if (on) c.mode = 'manual'; }
        if (on) { this.settings.mode = 'manual'; }
    }

    // ═══════════════════════════════════════════════════════
    // 模型 / 视觉同步
    // ═══════════════════════════════════════════════════════

    _model() { return this.sys && this.sys.acSolver ? this.sys.acSolver.m : null; }
    _comp() { const m = this._model(); return (m && m.comps) ? m.comps.comp1 : null; }

    _mode() {
        const c = this._comp();
        if (c && c.mode) return c.mode;
        return this.settings.mode;
    }

    _syncVisuals() {
        if (this._knob) this._knob.rotation(this._mode() === 'manual' ? 0 : -90);
        this._updateDynamic();
        if (this.sys && this.sys.requestRedraw) this.sys.requestRedraw();
    }

    _updateDynamic() {
        const m = this._model();
        if (!m) return;

        // 界面设置镜像到模型
        const c = this._comp();
        if (c) {
            c.startP = this.settings.startP; c.diffP = this.settings.diffP; c.hpP = this.settings.hpP;
            if (c.mode === undefined) c.mode = this.settings.mode; else this.settings.mode = c.mode;
        }

        const running = c ? !!c.running : false;
        this._running = running;
        const load = c ? (c.loadPct || 0) : 0;

        if (this._lamp) this._lamp.fill(running ? '#12c93a' : '#0e2f10');
        if (this._loadText) this._loadText.text(String(Math.round(load)));
        if (this._startLamp) this._startLamp.fill(running ? '#22c55e' : '#14532d');
        if (this._stopLamp) this._stopLamp.fill(running ? '#5c1a1a' : '#ef4444');
        if (this._knob) this._knob.rotation(this._mode() === 'manual' ? 0 : -90);

        const s = this.settings;
        if (this._markers) {
            this._markers.forEach((mg, i) => {
                const sd = SCALE_DEFS[i];
                const v = clamp(s[sd.key], sd.min, sd.max);
                mg.y(ROW2.bottom - (v - sd.min) / (sd.max - sd.min) * (ROW2.bottom - ROW2.top));
            });
        }

        if (this._gauges) {
            const pe = m.pe || 0;
            const pdis = m.pdis1 || 0;
            const oil = Math.max(0, (m.oilP || 0) - pe);
            const vals = [pe, pdis, oil];
            this._gauges.forEach((g, i) => {
                const v = running ? vals[i] : 0;
                g.needle.rotation(-135 + clamp(v / g.max, 0, 1) * 270);
                g.valText.text(v.toFixed(1));
            });
        }
    }

    tick() { this._updateDynamic(); this._refreshIfDirty(); }

    // ═══════════════════════════════════════════════════════
    // 配置
    // ═══════════════════════════════════════════════════════

    getConfigFields() {
        return [
            { label: '器件名称 (ID)', key: 'id', type: 'text' },
            { label: '启动压力 (bar)', key: 'startP', type: 'number', step: 0.1, min: 0, max: 8, get: (c) => c.settings.startP },
            { label: '压差 (bar)', key: 'diffP', type: 'number', step: 0.1, min: 0, max: 3, get: (c) => c.settings.diffP },
            { label: '停止压力 (bar)', key: 'hpP', type: 'number', step: 1, min: 12, max: 25, get: (c) => c.settings.hpP },
        ];
    }

    onConfigUpdate(cfg) {
        if (cfg.id) this.id = cfg.id;
        const s = this.settings;
        if (cfg.startP !== undefined && !Number.isNaN(cfg.startP)) s.startP = clamp(parseFloat(cfg.startP), 0, 8);
        if (cfg.diffP !== undefined && !Number.isNaN(cfg.diffP)) s.diffP = clamp(parseFloat(cfg.diffP), 0, 3);
        if (cfg.hpP !== undefined && !Number.isNaN(cfg.hpP)) s.hpP = clamp(parseFloat(cfg.hpP), 12, 25);
        this.config = { ...this.config, ...cfg };
        this._syncVisuals();
    }
}

export default CompressorControlPanel;
