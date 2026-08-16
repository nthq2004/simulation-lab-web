import { BaseComponent } from './BaseComponent.js';

/**
 * ThreePhaseLoad 三相可调负载模块
 * 尺寸 280×240，单面板。可设置三相有功功率、功率因数、感性/容性，并可加载/卸载。
 *
 * 面板布局：
 *  - 标题 + LCD 4 行（有功/功率因数、视在/无功、线电流/性质、加载状态）
 *  - 有功功率 (kW)、功率因数：文本框（点击后输入）
 *  - 性质：选择框（点击切换 容性/感性）
 *  - 加载 / 卸载 按钮
 *
 * 端口：
 *  - 左侧：l1 / l2 / l3 —— 三相电源输入（接汇流排）
 *  - 右侧：n —— 中性点（接地）
 *
 * 电气模型（type='load_3p'，星形联接，每相到中性点）：
 *  - 有功支路：恒阻抗（R = Uph²/(P/3)），纯线性、绝对稳定；母线电压接近额定
 *    时实际吸收有功接近设定值（电压偏低时按平方比例略低，符合真实负载特性）。
 *  - 无功支路：每相并联电感（感性）或电容（容性）的伴随模型（后向欧拉）
 */
const PANEL_W = 280;
const PANEL_H = 240;
const UPH = 230;   // 额定相电压 V
const F = 50;      // 额定频率 Hz

export class ThreePhaseLoad extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.width  = Math.max(220, config.width  || PANEL_W);
        this.height = Math.max(200, config.height || PANEL_H);

        this.type    = 'load_3p';
        this.cache   = 'fixed';

        this._initGroups();
        this._initParameters(config);
        this._recalcGeometry();
        this._init();

        this.config = {
            id: this.id,
            label:    this.label,
            powerKw:  this.powerKw,
            cosPhi:   this.cosPhi,
            reactive: this.reactive,
            loaded:   this._loaded,
        };

        this._addPorts();
    }

    // ═══════════════════════════════════════════
    // 几何
    // ═══════════════════════════════════════════

    _recalcGeometry() {
        this._lcd = { x: 5, y: 22, w: PANEL_W - 10, h: 80 };
        this._lcdRows = [28, 48, 68, 88];
        // 三相接线柱：面板顶部（l1/l2/l3）
        this._portTop = [PANEL_W / 4, PANEL_W / 2, (PANEL_W * 3) / 4];
        // 中性点接线柱：面板底部居中（n）
        this._portN = PANEL_W / 2;
    }

    // ═══════════════════════════════════════════
    // 参数
    // ═══════════════════════════════════════════

    _initParameters(config) {
        this.label    = config.label || '三相可调负载';
        this.function = '三相可调负载';
        this.powerKw  = parseFloat(config.powerKw)  || 350;
        // 默认负载性质为感性（电机类负载），功率因数 0.8
        this.cosPhi   = parseFloat(config.cosPhi)   || 0.8;
        this.reactive = config.reactive === 'cap' ? 'cap' : 'ind';   // 'ind' 感性(默认) / 'cap' 容性
        this._loaded  = config.loaded === true || config.loaded === 'true';

        this._vLast = [0, 0, 0];
        this._iLast = [0, 0, 0];
        this._sample = { p: 0, q: 0, s: 0, i: 0 };

        this._recalcLoad();
    }

    _recalcLoad() {
        const P = Math.max(this.powerKw, 0.01) * 1000;   // 三相总有功 W
        this._Pph = P / 3;                                // 每相 W
        this._Rph = UPH * UPH / this._Pph;                // 每相恒阻抗电阻 Ω
        const cos = Math.min(1, Math.max(0.1, this.cosPhi));
        const tan = Math.sqrt(Math.max(0, 1 - cos * cos)) / cos;
        this._Qph = this._Pph * tan;                      // 每相无功 var
        const w = 2 * Math.PI * F;
        if (this.reactive === 'ind') {
            this._Lph = UPH * UPH / (w * this._Qph);      // 每相电感 H
            this._Cph = 0;
        } else {
            this._Lph = 0;
            this._Cph = this._Qph / (w * UPH * UPH);      // 每相电容 F
        }
    }

    // ═══════════════════════════════════════════
    // 初始化
    // ═══════════════════════════════════════════

    _init() {
        this._drawStaticParts();
        this._createDynamicNodes();
        this._bindInteraction();
    }

    _drawStaticParts() {
        const s = this._staticGroup;
        // 面板
        s.add(new Konva.Rect({ x: 0, y: 0, width: PANEL_W, height: this.height, fill: '#eef2f5', stroke: '#1a252f', strokeWidth: 1, cornerRadius: 3 }));
        s.add(new Konva.Rect({ x: 3, y: 3, width: PANEL_W - 6, height: this.height - 6, fill: '#e4eaef', cornerRadius: 2, stroke: '#5a6a75', strokeWidth: 1 }));
        // 标题
        s.add(new Konva.Text({ x: 0, y: 4, width: PANEL_W, align: 'center', text: '三相可调负载', fontSize: 16, fontStyle: 'bold', fill: '#1a252f' }));
        // LCD 黑底
        s.add(new Konva.Rect({ x: this._lcd.x, y: this._lcd.y, width: this._lcd.w, height: this._lcd.h, fill: '#0a0e12', cornerRadius: 2, stroke: '#3a4a55', strokeWidth: 1 }));

        // 参数标签
        const lp = { fontSize: 13, fill: '#333' };
        s.add(new Konva.Text({ x: 10, y: 118, text: '有功功率(kW)', ...lp }));
        s.add(new Konva.Text({ x: 10, y: 144, text: '功率因数', ...lp }));
        s.add(new Konva.Text({ x: 10, y: 170, text: '性质', ...lp }));
        // 输入框底
        const ib = { fill: '#ffffff', stroke: '#5a6a75', strokeWidth: 1, cornerRadius: 2 };
        s.add(new Konva.Rect({ x: 100, y: 115, width: 72, height: 20, ...ib }));
        s.add(new Konva.Rect({ x: 100, y: 141, width: 72, height: 20, ...ib }));
        s.add(new Konva.Rect({ x: 100, y: 167, width: 72, height: 20, ...ib }));

        // 端口标注（顶部 L1/L2/L3，底部 N）
        const plp = { fontSize: 11, fontStyle: 'bold', fill: '#1a252f', width: 26, align: 'center' };
        s.add(new Konva.Text({ x: this._portTop[0] - 13, y: 0, text: 'L1', ...plp }));
        s.add(new Konva.Text({ x: this._portTop[1] - 13, y: 0, text: 'L2', ...plp }));
        s.add(new Konva.Text({ x: this._portTop[2] - 13, y: 0, text: 'L3', ...plp }));
        s.add(new Konva.Text({ x: this._portN - 13, y: this.height - 16, text: 'N', ...plp }));
        // 顶部与底部接线柱
        const pl = { stroke: '#1a252f', strokeWidth: 2 };
        this._portTop.forEach(x => {
            s.add(new Konva.Line({ points: [x, 0, x, 6], ...pl }));
        });
        s.add(new Konva.Line({ points: [this._portN, this.height - 6, this._portN, this.height], ...pl }));
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

        // 按钮
        const mkBtn = (x, label, base) => {
            const g = new Konva.Group({ x, y: 188 });
            const rect = new Konva.Rect({ width: 100, height: 26, fill: base, cornerRadius: 3, stroke: '#5a6a75', strokeWidth: 1 });
            // listening:false —— 文字不拦截点击，事件穿透到按钮（Group）上的命中区域，
            // 否则点击"加载/卸载"文字部分时命中文字而无反应。
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
        }, 1, 2000);

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

    /**
     * 文本框内联编辑：点击文本后在原位置创建 HTML 输入框直接编辑，
     * Enter 确认、Esc 取消、失焦确认，完成后自动移除输入框。
     */
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
        requestAnimationFrame(() => {
            input.focus();
            input.select();
        });
    }

    _touchDirty() {
        this.markDirty();
        if (this.sys && typeof this.sys.requestRedraw === 'function') this.sys.requestRedraw();
    }

    // ═══════════════════════════════════════════
    // 端口
    // ═══════════════════════════════════════════

    _addPorts() {
        this.addPort(this._portTop[0], 0, 'l1', 'wire', 'p');
        this.addPort(this._portTop[1], 0, 'l2', 'wire');
        this.addPort(this._portTop[2], 0, 'l3', 'wire');
        this.addPort(this._portN, this.height, 'n', 'wire');
    }

    // ═══════════════════════════════════════════
    // 仿真主循环
    // ═══════════════════════════════════════════

    tick(dt) {
        // 感性/容性支路为伴随模型，历史量必须按 solver 的仿真步长(deltaTime)推进，
        // 而非组件 tick 步长(dt)：solver 每物理 tick 只推进 deltaTime(0.5ms)，
        // 用 dt(0.05s) 累积会把电感电流放大 100 倍导致支路短路、负载失效。
        const solver = this.sys && this.sys.voltageSolver;
        const sDt = (solver && solver.deltaTime) || dt;
        if (this._loaded && this.sys && typeof this.sys.getVoltageBetween === 'function') {
            // 更新无功支路伴随模型历史（电容记电压、电感积分电流）
            for (let i = 0; i < 3; i++) {
                const v = this.sys.getVoltageBetween(`${this.id}_wire_l${i + 1}`, `${this.id}_wire_n`) || 0;
                if (this.reactive === 'ind' && this._Lph > 0) {
                    const gEq = sDt / this._Lph;
                    this._iLast[i] = gEq * v + this._iLast[i];
                } else if (this._Cph > 0) {
                    const gEq = this._Cph / sDt;
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

        // 显示数据（按设定值计算视在/无功/线电流）
        const P = this._loaded ? this.powerKw : 0;
        const cos = Math.min(1, Math.max(0.1, this.cosPhi));
        const S = this._loaded ? P / cos : 0;
        const Q = Math.sqrt(Math.max(0, S * S - P * P));
        const I = S > 0 ? (S * 1000) / (Math.sqrt(3) * 400) : 0;
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

    // ═══════════════════════════════════════════
    // 公开 API
    // ═══════════════════════════════════════════

    isLoaded()   { return this._loaded; }
    getPowerKw() { return this.powerKw; }
    getCosPhi()  { return this.cosPhi; }
    getReactive(){ return this.reactive; }

    getConfigFields() {
        return [
            { label: '三相有功功率 (kW)', key: 'powerKw', type: 'number', step: 10, min: 1, max: 2000 },
            { label: '功率因数', key: 'cosPhi', type: 'number', step: 0.05, min: 0.1, max: 1 },
            { label: '无功性质', key: 'reactive', type: 'select', options: [
                { label: '容性', value: 'cap' },
                { label: '感性', value: 'ind' },
            ]},
            { label: '初始状态', key: 'loaded', type: 'select', options: [
                { label: '卸载', value: 'false' },
                { label: '加载', value: 'true' },
            ]},
        ];
    }

    onConfigUpdate(cfg) {
        if (cfg.powerKw !== undefined)  this.powerKw  = parseFloat(cfg.powerKw)  || 350;
        if (cfg.cosPhi !== undefined)   this.cosPhi   = parseFloat(cfg.cosPhi)   || 0.8;
        if (cfg.reactive !== undefined) this.reactive = cfg.reactive === 'cap' ? 'cap' : 'ind';
        if (cfg.loaded !== undefined)   this._loaded  = String(cfg.loaded) === 'true';
        this._recalcLoad();
        if (this._ui) {
            this._ui.power.text(this.powerKw.toFixed(0));
            this._ui.cos.text(this.cosPhi.toFixed(2));
            this._ui.reactive.text(this.reactive === 'cap' ? '容性' : '感性');
        }
        this.config = { ...this.config, ...cfg };
        this._refresh();
    }
}
