import { BaseComponent } from './BaseComponent.js';

/**
 * HeavyLoadInquiry 重载询问---侧推器 模块
 * 尺寸 300×260，单面板。船舶侧推器大功率负载的重载询问控制面板。
 *
 * 面板布局：
 *  - 标题「重载询问---侧推器」
 *  - 功率显示文本框（默认 45kW，可点击后手动输入，参照 ThreePhaseLoad 功率输入）
 *  - 指示灯行：运行灯 + 请求回应灯（未回应熄灭 / 等待黄 / 允许绿）
 *  - 选择开关（左 -45° 直接起动 / 右 +45° 重载询问）+ 起动/询问按钮
 *
 * 端口：
 *  - 顶部：l1 / l2 / l3 —— 三相电源输入（接汇流排）
 *  - 底部：n —— 中性点（接地）
 *  - 左侧：heavy_a / heavy_b —— 与自动电站（ShipAutoControl）的通信接口
 *
 * 电气模型（type='load_3p'，星形联接，每相恒阻抗电阻，cosφ=1）：
 *  - 运行时（_loaded=true）向电网吸收设定功率（默认 45kW）；
 *  - 直接起动：按钮按下立即加载；
 *  - 重载询问：先向自动电站发询问指令，自动电站应答「允许」（绿灯）后再按按钮才加载；
 *    「等待」（黄灯）期间按按钮不运行。
 *
 * 与自动电站的通信：
 *  - 逻辑层通过 sys.comps.auto_ctl 方法直接交互（heavyInquiryRequest/heavyInquiryClear/getHeavyResponse），
 *  - 两个通信端口仅用于接线（与 comm1~3 同规约，视觉 + 接线完整性）。
 */
const PANEL_W = 300;
const PANEL_H = 260;
const UPH = 230;   // 额定相电压 V

export class HeavyLoadInquiry extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.width  = Math.max(240, config.width  || PANEL_W);
        this.height = Math.max(220, config.height || PANEL_H);

        this.type  = 'load_3p';
        this.cache = 'fixed';

        this._initGroups();
        this._initParameters(config);
        this._recalcGeometry();
        this._init();

        this.config = {
            id: this.id,
            label:     this.label,
            powerKw:   this.powerKw,
            mode:      this._mode,       // 'direct' | 'inquiry'
            loaded:    this._loaded,
        };

        this._addPorts();
    }

    // ═══════════════════════════════════════════
    // 几何
    // ═══════════════════════════════════════════

    _recalcGeometry() {
        this._portTop = [PANEL_W / 4, PANEL_W / 2, (PANEL_W * 3) / 4];
        // 左侧通信口
        this._portLeft = { heavy_a: 90, heavy_b: 165 };
        // 底部中性点
        this._portN = PANEL_W / 2;
        // 指示灯
        this._ledRun = { x: 82,  y: 102, r: 7 };
        this._ledResp = { x: 210, y: 102, r: 7 };
        // 选择开关旋钮
        this._knobMode = { x: 82, y: 192, r: 23 };
        // 按钮：起动/询问（上）、停止（下）
        this._btnRect  = { x: 155, y: 166, w: 132, h: 30 };
        this._btnStop  = { x: 155, y: 210, w: 132, h: 24 };
        this._btnStopTxt = '停    止';
    }

    // ═══════════════════════════════════════════
    // 参数
    // ═══════════════════════════════════════════

    _initParameters(config) {
        this.label    = config.label || '重载询问---侧推器';
        this.function = '重载询问---侧推器';
        this.powerKw  = parseFloat(config.powerKw) || 45;
        // 模式：'direct' 直接起动 / 'inquiry' 重载询问
        this._mode    = config.mode === 'inquiry' ? 'inquiry' : 'direct';
        this._loaded  = config.loaded === true || config.loaded === 'true';

        // 负载状态
        this._running   = false;      // 侧推器实际运行（加载）
        this._inquirying = false;     // 已发出询问指令、等待允许
        this._resp      = '';         // 自动电站应答：'' | 'waiting' | 'allow'

        this._vLast = [0, 0, 0];
        this._iLast = [0, 0, 0];
        this._sample = { p: 0, i: 0 };

        this._recalcLoad();
    }

    _recalcLoad() {
        const P = Math.max(this.powerKw, 0.01) * 1000;
        this._Pph = P / 3;                          // 每相 W
        this._Rph = (UPH * UPH) / this._Pph;        // 每相恒阻抗电阻 Ω
        this._Lph = 0;                              // 纯阻性，无无功支路
        this._Cph = 0;
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

        s.add(new Konva.Rect({ x: 0, y: 0, width: PANEL_W, height: this.height, fill: '#eef2f5', stroke: '#1a252f', strokeWidth: 1, cornerRadius: 3 }));
        s.add(new Konva.Rect({ x: 3, y: 3, width: PANEL_W - 6, height: this.height - 6, fill: '#e4eaef', cornerRadius: 2, stroke: '#5a6a75', strokeWidth: 1 }));
        // 标题
        s.add(new Konva.Text({ x: 0, y: 18, width: PANEL_W, align: 'center', text: '重载询问---侧推器', fontSize: 16, fontStyle: 'bold', fill: '#1a252f' }));

        // 功率标签 + 输入框底
        s.add(new Konva.Text({ x: 10, y: 50, text: '功率(kW)', fontSize: 13, fill: '#333' }));
        s.add(new Konva.Rect({ x: 90, y: 46, width: 90, height: 22, fill: '#ffffff', stroke: '#5a6a75', strokeWidth: 1, cornerRadius: 2 }));

        // 指示灯底盘 + 标签
        const ledLp = { fontSize: 12, align: 'center', width: 56, fill: '#333' };
        s.add(new Konva.Circle({ x: this._ledRun.x,  y: this._ledRun.y,  radius: 10, fill: '#cdd8e0', stroke: '#5a6a75', strokeWidth: 1 }));
        s.add(new Konva.Circle({ x: this._ledResp.x, y: this._ledResp.y, radius: 10, fill: '#cdd8e0', stroke: '#5a6a75', strokeWidth: 1 }));
        s.add(new Konva.Text({ x: this._ledRun.x - 28,  y: this._ledRun.y + 14,  text: '运行', ...ledLp }));
        s.add(new Konva.Text({ x: this._ledResp.x - 28, y: this._ledResp.y + 14, text: '回应', ...ledLp }));

        // 选择开关底盘 + 45° 档位标注（左上=直接起动，右上=重载询问）
        s.add(new Konva.Circle({ x: this._knobMode.x, y: this._knobMode.y, radius: this._knobMode.r + 3, fill: '#cfd8df', stroke: '#5a6a75', strokeWidth: 1 }));
        const _d45 = 52 * Math.SQRT1_2;   // 距旋钮中心沿 45° 方向的距离 ≈ 36.8
        const _lbl45 = { width: 60, align: 'center', fontSize: 12, fontStyle: 'bold', fill: '#1a252f' };
        s.add(new Konva.Text({ ..._lbl45, x: this._knobMode.x - _d45, y: this._knobMode.y - _d45, offsetX: 30, offsetY: 7, text: '直接起动' }));
        s.add(new Konva.Text({ ..._lbl45, x: this._knobMode.x + _d45, y: this._knobMode.y - _d45, offsetX: 30, offsetY: 7, text: '重载询问' }));

        // 端口标注
        const plp = { fontSize: 11, fontStyle: 'bold', fill: '#1a252f', width: 26, align: 'center' };
        s.add(new Konva.Text({ x: this._portTop[0] - 18, y: 5, text: 'L1', ...plp }));
        s.add(new Konva.Text({ x: this._portTop[1] - 18, y: 5, text: 'L2', ...plp }));
        s.add(new Konva.Text({ x: this._portTop[2] - 18, y: 5, text: 'L3', ...plp }));
        s.add(new Konva.Text({ x: this._portN - 13, y: this.height - 16, text: 'N', ...plp }));

        // 顶部/底部接线柱
        const pl = { stroke: '#1a252f', strokeWidth: 2 };
        this._portTop.forEach(x => s.add(new Konva.Line({ points: [x, 0, x, 6], ...pl })));
        s.add(new Konva.Line({ points: [this._portN, this.height - 6, this._portN, this.height], ...pl }));
    }

    _createDynamicNodes() {
        const d = this._dynamicGroup;
        const ui = {};

        // 功率显示文本（内联可编辑，动态节点以便更新）
        ui.power = new Konva.Text({ x: 90, y: 49, width: 90, align: 'center', text: this.powerKw.toFixed(0), fontSize: 16, fill: '#1a252f' });
        d.add(ui.power);

        // 运行灯 / 请求回应灯
        ui.ledRun  = new Konva.Circle({ x: this._ledRun.x,  y: this._ledRun.y,  radius: this._ledRun.r,  fill: '#8a8a8a', stroke: '#222', strokeWidth: 1 });
        ui.ledResp = new Konva.Circle({ x: this._ledResp.x, y: this._ledResp.y, radius: this._ledResp.r, fill: '#8a8a8a', stroke: '#222', strokeWidth: 1 });
        d.add(ui.ledRun, ui.ledResp);

        // 选择开关旋钮
        const g = new Konva.Group({ x: this._knobMode.x, y: this._knobMode.y });
        const disk = new Konva.Circle({ radius: this._knobMode.r, fill: '#7f8c8d', stroke: '#4a5a63', strokeWidth: 2 });
        const ptr = new Konva.Line({ points: [0, 0, 0, -(this._knobMode.r - 3)], stroke: '#ffffff', strokeWidth: 3, lineCap: 'round' });
        ptr.rotation(this._mode === 'inquiry' ? 45 : -45);
        g.add(disk, ptr);
        d.add(g);
        ui.knob = { g, disk, ptr };

        // 按钮
        const bg = new Konva.Group({ x: this._btnRect.x, y: this._btnRect.y });
        const rect = new Konva.Rect({ width: this._btnRect.w, height: this._btnRect.h, fill: '#2e7d32', cornerRadius: 3, stroke: '#5a6a75', strokeWidth: 1 });
        const txt = new Konva.Text({ width: this._btnRect.w, y: 7, align: 'center', text: '起动 / 询问', fontSize: 14, fontStyle: 'bold', fill: '#ffffff', listening: false });
        bg.add(rect, txt);
        d.add(bg);
        ui.btn = { g: bg, rect, txt };

        // 停止按钮（询问按钮下方，用于停掉负载）
        const bgStop = new Konva.Group({ x: this._btnStop.x, y: this._btnStop.y });
        const rectStop = new Konva.Rect({ width: this._btnStop.w, height: this._btnStop.h, fill: '#c62828', cornerRadius: 3, stroke: '#5a6a75', strokeWidth: 1 });
        const txtStop = new Konva.Text({ width: this._btnStop.w, y: 6, align: 'center', text: this._btnStopTxt, fontSize: 14, fontStyle: 'bold', fill: '#ffffff', listening: false });
        bgStop.add(rectStop, txtStop);
        d.add(bgStop);
        ui.btnStop = { g: bgStop, rect: rectStop, txt: txtStop };

        this._ui = ui;
    }

    _bindInteraction() {
        // 功率文本：点击内联编辑
        this._ui.power.on('click tap', (e) => {
            e.cancelBubble = true;
            this._startInlineEdit(this._ui.power, () => this.powerKw, (v) => {
                this.powerKw = v;
                this._recalcLoad();
                this._ui.power.text(v.toFixed(0));
                this.config.powerKw = v;
                this._touchDirty();
            }, 1, 500);
        });

        // 选择开关：点击切换 直接起动 <-> 重载询问
        this._ui.knob.disk.on('click tap', (e) => {
            e.cancelBubble = true;
            this._toggleMode();
        });

        // 按钮：按工作模式执行
        this._ui.btn.g.on('click tap', (e) => {
            e.cancelBubble = true;
            this._onBtnPressed();
        });

        // 停止按钮：停掉负载
        this._ui.btnStop.g.on('click tap', (e) => {
            e.cancelBubble = true;
            this._onStopPressed();
        });
    }

    // 停止按钮：停掉负载并清除询问状态
    _onStopPressed() {
        const ac = this._autoCtl();
        if (this._inquirying) {
            this._inquirying = false;
            this._resp = '';
            if (ac && typeof ac.heavyInquiryClear === 'function') ac.heavyInquiryClear();
        }
        this._stopLoad();
    }

    _toggleMode() {
        // 切换模式前若在运行，先卸载（避免负载悬置）
        if (this._running) this._stopLoad();
        this._mode = this._mode === 'inquiry' ? 'direct' : 'inquiry';
        this._inquirying = false;
        this._resp = '';
        this.config.mode = this._mode;
        const angle = this._mode === 'inquiry' ? 45 : -45;
        if (this._ui && this._ui.knob.ptr) {
            if (this._ui.knob.ptr._tw) this._ui.knob.ptr._tw.destroy();
            this._ui.knob.ptr._tw = new Konva.Tween({ node: this._ui.knob.ptr, rotation: angle, duration: 0.15 });
            this._ui.knob.ptr._tw.play();
        }
        this._touchDirty();
    }

    _autoCtl() {
        return (this.sys && this.sys.comps) ? this.sys.comps['auto_ctl'] : null;
    }

    _onBtnPressed() {
        const ac = this._autoCtl();
        if (this._running) {
            // 运行中：按按钮停止侧推器
            this._stopLoad();
            return;
        }
        if (this._mode === 'inquiry') {
            if (!this._inquirying) {
                // 第 1 次按：只有通信端口已连接自动电站才能发出询问指令
                if (!this._commConnected()) return;
                this._inquirying = true;
                this._resp = '';
                if (ac && typeof ac.heavyInquiryRequest === 'function') ac.heavyInquiryRequest();
                // 并联运行直接应答允许 → 立即刷新
                this._pullResponse();
            } else if (this._resp === 'waiting') {
                // 等待期间按 → 不运行
                return;
            } else if (this._resp === 'allow') {
                // 已允许 → 再按 → 负载运行
                this._startLoad();
                if (ac && typeof ac.heavyInquiryClear === 'function') ac.heavyInquiryClear();
                return;
            }
        } else {
            // 直接起动：按按钮立即加载
            this._startLoad();
        }
    }

    _startLoad() {
        this._running = true;
        this._loaded  = true;      // 求解器 stampLoad3p 以 _loaded 判定恒阻抗注入
        this._inquirying = false;
        this._resp = '';
        this.config.loaded = true;
        this._touchDirty();
    }

    _stopLoad() {
        this._running = false;
        this._loaded  = false;     // 同步卸载，恢复 1e9Ω 断路
        this._inquirying = false;
        this._resp = '';
        this._vLast = [0, 0, 0];
        this._iLast = [0, 0, 0];
        this.config.loaded = false;
        this._touchDirty();
    }

    // 从自动电站读取当前应答状态（'' | 'waiting' | 'allow'）
    // 只有通信端口（heavy_a / heavy_b）已连接自动电站才能收到回应；
    // 通信断开时保持原应答状态不变，避免在无连接的情况下误判“允许”。
    _pullResponse() {
        if (!this._inquirying) return;
        const ac = this._autoCtl();
        if (ac && typeof ac.getHeavyResponse === 'function' && this._commConnected()) {
            const r = ac.getHeavyResponse();
            if (r !== undefined && r !== null) this._resp = r;
        }
    }

    // 通信端口是否已与自动电站（auto_ctl）相连：两条通信线 heavy_a / heavy_b 均需连通
    _commConnected() {
        if (!this.sys || !this.sys.conns) return false;
        const need = [
            ['auto_ctl_wire_heavy_a', `${this.id}_wire_heavy_a`],
            ['auto_ctl_wire_heavy_b', `${this.id}_wire_heavy_b`],
        ];
        return need.every(([a, b]) =>
            this.sys.conns.some(c => c.type === 'wire' &&
                ((c.from === a && c.to === b) || (c.from === b && c.to === a)))
        );
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
        this.addPort(0, this._portLeft.heavy_a, 'heavy_a', 'wire', 'p');
        this.addPort(0, this._portLeft.heavy_b, 'heavy_b', 'wire');
    }

    // ═══════════════════════════════════════════
    // 仿真主循环
    // ═══════════════════════════════════════════

    tick(dt) {
        this._pullResponse();

        // 电网失电自动卸载：汇流排无电时停止侧推器（防止恢复时冲击）
        if (this._running && this.sys && typeof this.sys.getVoltageBetween === 'function') {
            let busLost = true;
            for (let i = 0; i < 3; i++) {
                const v = Math.abs(this.sys.getVoltageBetween(`${this.id}_wire_l${i + 1}`, `${this.id}_wire_n`) || 0);
                if (v > 10) { busLost = false; break; }
            }
            if (busLost) this._stopLoad();
        }

        // 显示数据
        const P = this._running ? this.powerKw : 0;
        const I = P > 0 ? (P * 1000) / (Math.sqrt(3) * 400) : 0;
        this._sample = { p: P, i: I };
        this._updateLeds();
        this.markDirty();
        if (this.sys && typeof this.sys.requestRedraw === 'function') this.sys.requestRedraw();
    }

    _updateLeds() {
        const ui = this._ui;
        if (!ui) return;
        // 运行灯
        ui.ledRun.fill(this._running ? '#39c639' : '#8a8a8a');
        // 请求回应灯：未回应熄灭 / 等待黄 / 允许绿
        if (!this._inquirying) {
            ui.ledResp.fill('#8a8a8a');
        } else if (this._resp === 'allow') {
            ui.ledResp.fill('#39c639');
        } else if (this._resp === 'waiting') {
            ui.ledResp.fill('#e6b800');
        } else {
            ui.ledResp.fill('#8a8a8a');
        }
    }

    // ═══════════════════════════════════════════
    // 文本框内联编辑（参照 ThreePhaseLoad）
    // ═══════════════════════════════════════════

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

    // ═══════════════════════════════════════════
    // 公开 API
    // ═══════════════════════════════════════════

    isRunning()  { return this._running; }
    isModeDirect() { return this._mode === 'direct'; }
    isInquirying() { return this._inquirying; }
    getResponse()  { return this._resp; }
    getPowerKw()   { return this.powerKw; }

    getConfigFields() {
        return [
            { label: '侧推功率 (kW)', key: 'powerKw', type: 'number', step: 5, min: 1, max: 500 },
            { label: '工作模式', key: 'mode', type: 'select', get: c => this._mode, options: [
                { label: '直接起动', value: 'direct' },
                { label: '重载询问', value: 'inquiry' },
            ]},
            { label: '初始加载', key: 'loaded', type: 'select', options: [
                { label: '卸载', value: 'false' },
                { label: '加载', value: 'true' },
            ]},
        ];
    }

    onConfigUpdate(cfg) {
        if (cfg.powerKw !== undefined) this.powerKw = parseFloat(cfg.powerKw) || 45;
        if (cfg.mode !== undefined) {
            this._mode = String(cfg.mode) === 'inquiry' ? 'inquiry' : 'direct';
            if (this._ui && this._ui.knob.ptr) this._ui.knob.ptr.rotation(this._mode === 'inquiry' ? 45 : -45);
        }
        if (cfg.loaded !== undefined) {
            this._running = String(cfg.loaded) === 'true';
            this._loaded = this._running;
            this.config.loaded = this._running;
        }
        this._recalcLoad();
        if (this._ui) this._ui.power.text(this.powerKw.toFixed(0));
        this.config = { ...this.config, ...cfg };
        this._touchDirty();
    }
}