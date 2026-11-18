import { BaseComponent } from './BaseComponent.js';

/**
 * HvThreePhaseLoad 高压三相可调负载模块（三角联接，无中性点，对地绝缘）
 *
 * 面板布局与低压版三相可调负载一致：标题 + LCD 4 行 + 有功功率/功率因数/
 * 性质（容性/感性）+ 加载/卸载按钮。
 *
 * 端口：
 *  - 顶部：l1 / l2 / l3 —— 三相电源输入（接汇流排）
 *  - 无中性点 n：三相负载三角（Δ）联接，对地绝缘
 *
 * 电气模型（type='hv_load_3p'，三角联接，每相跨线电压 U_L=6600V）：
 *  - 有功支路：恒阻抗（RΔ = U_L²/(P/3)），纯线性、绝对稳定；
 *  - 无功支路：每相跨线并联电感（感性）或电容（容性）伴随模型（后向欧拉）。
 *  Δ 等效 Y：RΔ=3·RY、LΔ=3·LY、CΔ=CY/3（Y 基准相电压 3810V）。
 */
const PANEL_W = 280;
const PANEL_H = 240;
const UPH = 3810;      // 高压额定相电压 V（线电压 6600 / √3）
const ULN = 6600;      // 额定线电压 V
const F = 50;          // 额定频率 Hz

export class HvThreePhaseLoad extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);
        this.width  = Math.max(220, config.width  || PANEL_W);
        this.height = Math.max(200, config.height || PANEL_H);
        this.type    = 'hv_load_3p';
        this.cache   = 'fixed';
        this._initGroups();
        this._initParameters(config);
        this._recalcGeometry();
        this._init();
        this.config = {
            id: this.id, label: this.label, powerKw: this.powerKw,
            cosPhi: this.cosPhi, reactive: this.reactive,
            loaded: this._loaded, noBusUnload: this.noBusUnload,
        };
        this._addPorts();
    }

    _recalcGeometry() {
        this._lcd = { x: 5, y: 22, w: PANEL_W - 10, h: 80 };
        this._lcdRows = [28, 48, 68, 88];
        this._portTop = [PANEL_W / 4, PANEL_W / 2, (PANEL_W * 3) / 4];
    }

    _initParameters(config) {
        this.label    = config.label || '高压三相可调负载';
        this.function = '高压三相可调负载';
        this.powerKw  = parseFloat(config.powerKw)  || 500;
        this.cosPhi   = parseFloat(config.cosPhi)   || 0.8;
        this.reactive = config.reactive === 'cap' ? 'cap' : 'ind';
        this._loaded  = config.loaded === true || config.loaded === 'true';
        this.noBusUnload = config.noBusUnload !== false;
        this._vLast = [0, 0, 0];
        this._iLast = [0, 0, 0];
        this._sample = { p: 0, q: 0, s: 0, i: 0 };
        this._recalcLoad();
    }

    /** Δ 联接参数：由 Y 基准（相电压 3810V）换算 RΔ=3RY、LΔ=3LY、CΔ=CY/3 */
    _recalcLoad() {
        const P = Math.max(this.powerKw, 0.01) * 1000;   // 三相总有功 W
        this._Pph = P / 3;
        this._RY = UPH * UPH / this._Pph;                // Y 每相电阻 Ω
        this._Rd = 3 * this._RY;                         // Δ 每相电阻 Ω
        const cos = Math.min(1, Math.max(0.1, this.cosPhi));
        const tan = Math.sqrt(Math.max(0, 1 - cos * cos)) / cos;
        this._Qph = this._Pph * tan;
        const w = 2 * Math.PI * F;
        if (this.reactive === 'ind') {
            this._LY = UPH * UPH / (w * this._Qph);
            this._Ld = 3 * this._LY;
            this._Cd = 0;
        } else {
            this._LY = 0;
            this._CY = this._Qph / (w * UPH * UPH);
            this._Cd = this._CY / 3;
            this._Ld = 0;
        }
    }

    _init() {
        this._drawStaticParts();
        this._createDynamicNodes();
        this._bindInteraction();
    }

    _drawStaticParts() {
        const s = this._staticGroup;
        s.add(new Konva.Rect({ x: 0, y: 0, width: PANEL_W, height: this.height, fill: '#eef2f5', stroke: '#1a252f', strokeWidth: 1, cornerRadius: 3 }));
        s.add(new Konva.Rect({ x: 3, y: 3, width: PANEL_W - 6, height: this.height - 6, fill: '#e4eaef', cornerRadius: 2, stroke: '#5a6a75', strokeWidth: 1 }));
        s.add(new Konva.Text({ x: 0, y: 4, width: PANEL_W, align: 'center', text: '高压三相可调负载', fontSize: 16, fontStyle: 'bold', fill: '#1a252f' }));
        s.add(new Konva.Rect({ x: this._lcd.x, y: this._lcd.y, width: this._lcd.w, height: this._lcd.h, fill: '#0a0e12', cornerRadius: 2, stroke: '#3a4a55', strokeWidth: 1 }));
        const lp = { fontSize: 13, fill: '#333' };
        s.add(new Konva.Text({ x: 10, y: 118, text: '有功功率(kW)', ...lp }));
        s.add(new Konva.Text({ x: 10, y: 144, text: '功率因数', ...lp }));
        s.add(new Konva.Text({ x: 10, y: 170, text: '性质', ...lp }));
        const ib = { fill: '#ffffff', stroke: '#5a6a75', strokeWidth: 1, cornerRadius: 2 };
        s.add(new Konva.Rect({ x: 100, y: 115, width: 72, height: 20, ...ib }));
        s.add(new Konva.Rect({ x: 100, y: 141, width: 72, height: 20, ...ib }));
        s.add(new Konva.Rect({ x: 100, y: 167, width: 72, height: 20, ...ib }));
        // 顶部三相接线柱 L1/L2/L3（无中性点，对地绝缘）
        const plp = { fontSize: 11, fontStyle: 'bold', fill: '#1a252f', width: 26, align: 'center' };
        this._portTop.forEach((x, i) => {
            s.add(new Konva.Text({ x: x - 13, y: 0, text: 'L' + (i + 1), ...plp }));
            s.add(new Konva.Line({ points: [x, 0, x, 6], stroke: '#1a252f', strokeWidth: 2 }));
        });
    }

    _createDynamicNodes() {
        const d = this._dynamicGroup;
        const ui = {};
        ui.lcd = this._lcdRows.map(y => {
            const t = new Konva.Text({ x: this._lcd.x + 4, y: y - 2, fontSize: 14, fontFamily: 'monospace', fontStyle: 'bold', fill: '#00ff88', text: '' });
            d.add(t);
            return t;
        });
        ui.power    = new Konva.Text({ x: 100, y: 118, width: 72, align: 'center', text: this.powerKw.toFixed(0), fontSize: 16, fill: '#1a252f' });
        ui.cos      = new Konva.Text({ x: 100, y: 143, width: 72, align: 'center', text: this.cosPhi.toFixed(2), fontSize: 16, fill: '#1a252f' });
        ui.reactive = new Konva.Text({ x: 100, y: 170, width: 72, align: 'center', text: this.reactive === 'cap' ? '容性' : '感性', fontSize: 15, fill: '#1a252f' });
        d.add(ui.power, ui.cos, ui.reactive);
        const mkBtn = (x, label, base) => {
            const g = new Konva.Group({ x, y: 188 });
            const rect = new Konva.Rect({ width: 100, height: 26, fill: base, cornerRadius: 3, stroke: '#5a6a75', strokeWidth: 1 });
            const txt = new Konva.Text({ width: 100, y: 5, align: 'center', text: label, fontSize: 13, fontStyle: 'bold', fill: '#ffffff', listening: false });
            g.add(rect, txt);
            d.add(g);
            return { g, rect, txt };
        };
        ui.btnLoad   = mkBtn(18, '加载', '#2e7d32');
        ui.btnUnload = mkBtn(164, '卸载', '#8a6a14');
        this._ui = ui;
    }

    _bindInteraction() {
        const mkInput = (textNode, getVal, setVal, min, max) => {
            textNode.on('click tap', (e) => {
                e.cancelBubble = true;
                this._startInlineEdit(textNode, getVal, setVal, min, max);
            });
        };
        mkInput(this._ui.power, () => this.powerKw, (v) => {
            this.powerKw = v;
            this._recalcLoad();
            this._ui.power.text(v.toFixed(0));
            this.config.powerKw = v;
            this._touchDirty();
        }, 1, 5000);
        mkInput(this._ui.cos, () => this.cosPhi, (v) => {
            this.cosPhi = v;
            this._recalcLoad();
            this._ui.cos.text(v.toFixed(2));
            this.config.cosPhi = v;
            this._touchDirty();
        }, 0.1, 1);
        this._ui.reactive.on('click tap', (e) => {
            e.cancelBubble = true;
            this.reactive = this.reactive === 'cap' ? 'ind' : 'cap';
            this._ui.reactive.text(this.reactive === 'cap' ? '容性' : '感性');
            this.config.reactive = this.reactive;
            this._recalcLoad();
            this._touchDirty();
        });
        this._ui.btnLoad.g.on('click tap', (e) => {
            e.cancelBubble = true;
            this._loaded = true;
            this.config.loaded = true;
            this._refresh();
        });
        this._ui.btnUnload.g.on('click tap', (e) => {
            e.cancelBubble = true;
            this._loaded = false;
            this.config.loaded = false;
            this._vLast = [0, 0, 0];
            this._iLast = [0, 0, 0];
            this._refresh();
        });
    }

    _refresh() {
        this._updateLCD();
        this._touchDirty();
    }

    _startInlineEdit(textNode, getVal, setVal, min, max) {
        if (!this.sys || !this.sys.container) return;
        const box = textNode.getClientRect({ relativeTo: this.sys.stage });
        const input = document.createElement('input');
        input.type = 'number';
        input.step = 'any';
        input.value = String(getVal());
        input.style.position = 'absolute';
        input.style.left = box.x + 'px';
        input.style.top = box.y - 2 + 'px';
        input.style.width = box.width + 4 + 'px';
        input.style.height = box.height + 4 + 'px';
        input.style.zIndex = '9999';
        input.style.boxSizing = 'border-box';
        input.style.textAlign = 'center';
        input.style.fontSize = '15px';
        input.style.fontFamily = 'sans-serif';
        input.style.border = '2px solid #1395eb';
        input.style.borderRadius = '2px';
        input.style.outline = 'none';
        input.style.background = '#ffffff';
        input.style.padding = '0 2px';
        let finished = false;
        const done = (commit) => {
            if (finished) return;
            finished = true;
            if (input.parentNode) input.parentNode.removeChild(input);
            if (!commit) return;
            const v = parseFloat(input.value);
            if (isNaN(v)) return;
            setVal(Math.min(max, Math.max(min, v)));
        };
        input.addEventListener('keydown', (e) => {
            e.stopPropagation();
            if (e.key === 'Enter') { e.preventDefault(); done(true); }
            else if (e.key === 'Escape') { e.preventDefault(); done(false); }
        });
        input.addEventListener('blur', () => done(true));
        input.addEventListener('mousedown', (e) => e.stopPropagation());
        input.addEventListener('click', (e) => e.stopPropagation());
        this.sys.container.appendChild(input);
        requestAnimationFrame(() => { input.focus(); input.select(); });
    }

    _touchDirty() {
        this.markDirty();
        if (this.sys && typeof this.sys.requestRedraw === 'function') this.sys.requestRedraw();
    }

    // ═══════════════════════════════════════
    // 端口：仅 L1/L2/L3（三角联接，无中性点）
    // ═══════════════════════════════════════
    _addPorts() {
        this.addPort(this._portTop[0], 0, 'l1', 'wire', 'p');
        this.addPort(this._portTop[1], 0, 'l2', 'wire');
        this.addPort(this._portTop[2], 0, 'l3', 'wire');
    }

    // ═══════════════════════════════════════
    // 仿真主循环（Δ 联接：每相跨线电压 l1-l2 / l2-l3 / l3-l1）
    // ═══════════════════════════════════════
    tick(dt) {
        const solver = this.sys && this.sys.voltageSolver;
        const sDt = (solver && solver.deltaTime) || dt;

        // 电网失电自动卸载：任一线电压消失 → 自动断开负载
        if (this._loaded && this.noBusUnload && this.sys && typeof this.sys.getVoltageBetween === 'function') {
            let busLost = true;
            const pairs = [['l1', 'l2'], ['l2', 'l3'], ['l3', 'l1']];
            for (const [a, b] of pairs) {
                const v = Math.abs(this.sys.getVoltageBetween(`${this.id}_wire_${a}`, `${this.id}_wire_${b}`) || 0);
                if (v > 30) { busLost = false; break; }
            }
            if (busLost) this._loaded = false;
        }

        if (this._loaded && this.sys && typeof this.sys.getVoltageBetween === 'function') {
            // 伴随模型历史：线电压采样，电感积分电流 / 电容记录电压
            const pairs = [['l1', 'l2'], ['l2', 'l3'], ['l3', 'l1']];
            for (let i = 0; i < 3; i++) {
                const v = this.sys.getVoltageBetween(`${this.id}_wire_${pairs[i][0]}`, `${this.id}_wire_${pairs[i][1]}`) || 0;
                if (this.reactive === 'ind' && this._Ld > 0) {
                    const gEq = sDt / this._Ld;
                    this._iLast[i] = gEq * v + this._iLast[i];
                } else if (this._Cd > 0) {
                    const gEq = this._Cd / sDt;
                    this._vLast[i] = v;
                    this._iLast[i] = gEq * v;
                } else {
                    this._vLast[i] = v;
                    this._iLast[i] = 0;
                }
            }
        } else {
            this._vLast = [0, 0, 0];
            this._iLast = [0, 0, 0];
        }

        // 显示数据（按设定值，线电压 6600V 基准）
        const P = this._loaded ? this.powerKw : 0;
        const cos = Math.min(1, Math.max(0.1, this.cosPhi));
        const S = this._loaded ? P / cos : 0;
        const Q = Math.sqrt(Math.max(0, S * S - P * P));
        const I = S > 0 ? (S * 1000) / (Math.sqrt(3) * ULN) : 0;
        this._sample = { p: P, s: S, q: Q, i: I };
        this._updateLCD();
    }

    _updateLCD() {
        if (!this._ui) return;
        const s = this._sample;
        const lines = [
            `P ${s.p.toFixed(1)}kW  cosφ${this.cosPhi.toFixed(2)}`,
            `S ${s.s.toFixed(1)}kVA  Q ${s.q.toFixed(1)}kvar`,
            `I ${s.i.toFixed(0)}A  ${this.reactive === 'cap' ? '容性' : '感性'}`,
            this._loaded ? '状态: 加载中' : '状态: 已卸载',
        ];
        this._ui.lcd.forEach((t, i) => t.text(lines[i]));
    }

    // ═══════════════════════════════════════
    // 公开 API
    // ═══════════════════════════════════════
    isLoaded()   { return this._loaded; }
    getPowerKw() { return this.powerKw; }
    getCosPhi()  { return this.cosPhi; }
    getReactive(){ return this.reactive; }

    getConfigFields() {
        return [
            { label: '三相有功功率 (kW)', key: 'powerKw', type: 'number', step: 50, min: 1, max: 5000 },
            { label: '功率因数', key: 'cosPhi', type: 'number', step: 0.05, min: 0.1, max: 1 },
            { label: '无功性质', key: 'reactive', type: 'select', options: [
                { label: '容性', value: 'cap' },
                { label: '感性', value: 'ind' },
            ]},
            { label: '初始状态', key: 'loaded', type: 'select', options: [
                { label: '卸载', value: 'false' },
                { label: '加载', value: 'true' },
            ]},
            { label: '失电自动卸载', key: 'noBusUnload', type: 'select', options: [
                { label: '关闭', value: 'false' },
                { label: '开启', value: 'true' },
            ]},
        ];
    }

    onConfigUpdate(cfg) {
        if (cfg.powerKw !== undefined)  this.powerKw  = parseFloat(cfg.powerKw)  || 500;
        if (cfg.cosPhi !== undefined)   this.cosPhi   = parseFloat(cfg.cosPhi)   || 0.8;
        if (cfg.reactive !== undefined) this.reactive = cfg.reactive === 'cap' ? 'cap' : 'ind';
        if (cfg.loaded !== undefined)   this._loaded  = String(cfg.loaded) === 'true';
        if (cfg.noBusUnload !== undefined) this.noBusUnload = String(cfg.noBusUnload) !== 'false';
        this._recalcLoad();
        if (this._ui) {
            this._ui.power.text(this.powerKw.toFixed(0));
            this._ui.cos.text(this.cosPhi.toFixed(2));
            this._ui.reactive.text(this.reactive === 'cap' ? '容性' : '感性');
        }
        this.config = { ...this.config, ...cfg };
        this._refresh();
    }

    destroy() { super.destroy?.(); }
}
