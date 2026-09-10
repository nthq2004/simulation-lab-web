// 断路器保护特性测试仪
//
// 用于测试船用主开关（MarineMainsSwitch）的保护特性：
//   · 一次电流测试：向上边 out1/out2/out3 注入三相大电流，经主开关主触头由 r1/r2/r3 回流，
//     一次电流经电流互感器（CT 原边）采样送入电子脱扣器 → 脱扣器动作 → 主开关跳闸。
//   · 二次电流测试：iout1/iout2 输出可调幅值/相位的模拟二次电流，vout1/vout2 输出可调线电压，
//     直接接入电子脱扣器（或经 PT）→ 结合相位差产生正/逆功率 → 脱扣器动作 → 主开关跳闸。
//
// 电气模型（由 DeviceStamps.stampBreakerTesters 实现）：
//   · 一次电流：三相理想电流源（诺顿等效，并联 1Ω 防开路奇异），幅值 = √2·primaryI，50Hz。
//   · 二次电流：单相理想电流源，幅值 = √2·secondaryI，相位 = secondaryPhase。
//   · 线电压  ：单相诺顿电压源（内阻 0.1Ω），幅值 = √2·lineV，相位 0（与二次电流相位差即功率方向）。
//   · 24V 供电：读 p24_p/p24_n 电压判断是否工作。
//   · 主开关常开触点输入：接 qf1 no1/no2，通过端口同簇判断主开关合/分。

import { BaseComponent } from './BaseComponent.js';

export class BreakerProtectionTester extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.width  = Math.max(340, config.width  || 380);
        this.height = Math.max(240, config.height || 260);

        this.type  = 'breaker_tester';
        this.cache = 'fixed';

        this._initGroups();
        this._recalcGeometry();
        this._initParameters(config);
        this._init();

        this.config = {
            id: this.id,
            label: this.label,
            primaryI: this.primaryI,
            secondaryI: this.secondaryI,
            secondaryPhase: this.secondaryPhase,
            lineV: this.lineV,
        };

        // ── 上边 6 口：左 3 相电流回流口，右 3 相电流输出口 ──
        const tp = this._geo.topPorts;
        this.addPort(tp.r1, 0, 'r1', 'wire');
        this.addPort(tp.r2, 0, 'r2', 'wire');
        this.addPort(tp.r3, 0, 'r3', 'wire');
        this.addPort(tp.out1, 0, 'out1', 'wire', 'p');
        this.addPort(tp.out2, 0, 'out2', 'wire');
        this.addPort(tp.out3, 0, 'out3', 'wire');

        // ── 右边 8 口：常开触点输入 / 二次电流输出 / 线电压输出 / 24V 电源 ──
        const rp = this._geo.rightPorts;
        this.addPort(this.width, rp.no_in1, 'no_in1', 'wire');
        this.addPort(this.width, rp.no_in2, 'no_in2', 'wire');
        this.addPort(this.width, rp.iout1, 'iout1', 'wire', 'p');
        this.addPort(this.width, rp.iout2, 'iout2', 'wire', 'n');
        this.addPort(this.width, rp.vout1, 'vout1', 'wire', 'p');
        this.addPort(this.width, rp.vout2, 'vout2', 'wire', 'n');
        this.addPort(this.width, rp.p24_p, 'p24_p', 'wire', 'p');
        this.addPort(this.width, rp.p24_n, 'p24_n', 'wire', 'n');
    }

    // ═══════════════════════════════════════════
    // 几何与参数
    // ═══════════════════════════════════════════

    _recalcGeometry() {
        const W = this.width, H = this.height;
        this._geo = {
            topPorts:   { r1: 70, r2: 105, r3: 140, out1: 230, out2: 265, out3: 300 },
            rightPorts: { no_in1: 30, no_in2: 58, iout1: 88, iout2: 116, vout1: 146, vout2: 174, p24_p: 204, p24_n: 232 },
            knobs: [
                { x: 48,  y: 66, key: 'primaryI' },
                { x: 126, y: 66, key: 'secondaryI' },
                { x: 204, y: 66, key: 'secondaryPhase' },
                { x: 282, y: 66, key: 'lineV' },
            ],
            knobR: 18,
            btnPrimary:   { start: { x: 15,  y: 116 }, stop: { x: 90,  y: 116 } },
            btnSecondary: { start: { x: 170, y: 116 }, stop: { x: 243, y: 116 } },
            btnW: 68, btnH: 24,
            lcd: { x: 20, y: 150, w: 250, h: 88 },
        };
    }

    _initParameters(config) {
        this.label = config.label || '断路器保护特性测试仪';
        this.function = this.label;

        // 4 个旋钮：连续步进（min/max/step）
        this._knobDefs = {
            primaryI:       { label: '一次电流', unit: 'A', min: 0, max: 2000, step: 20,  def: 0,   digits: 0 },
            secondaryI:     { label: '二次电流', unit: 'A', min: 0, max: 10,   step: 0.5, def: 0,   digits: 1 },
            secondaryPhase: { label: '电流相位', unit: '°', min: 0, max: 350,  step: 10,  def: 0,   digits: 0 },
            lineV:          { label: '线电压',   unit: 'V', min: 0, max: 450,  step: 20,  def: 400, digits: 0 },
        };
        ['primaryI', 'secondaryI', 'secondaryPhase', 'lineV'].forEach(key => {
            this[key] = this._snap(key, config[key] !== undefined ? config[key] : this._knobDefs[key].def);
        });

        // 按钮状态
        this._primaryOn   = false;
        this._secondaryOn = false;

        // 供电与主开关状态
        this._powered  = false;
        this._noClosed = false;

        // 输出使能（供求解器读取）
        this._primaryOutput   = false;
        this._secondaryOutput = false;
        // 本次一次测试是否真正输出过电流（供流程 check 判定，防止误用上一步遗留的跳闸时间）
        this._pOutputSeen = false;

        // 计时
        this._pElapsed = 0; this._pTripTime = null; this._pTiming = false;
        this._sElapsed = 0; this._sTripTime = null; this._sTiming = false;
        // 电压（欠压保护）自动计时：每次调整线电压旋钮触发
        this._vElapsed = 0; this._vTripTime = null; this._vTiming = false; this._vArmed = false;
    }

    // ═══════════════════════════════════════════
    // 绘制
    // ═══════════════════════════════════════════

    _init() {
        this._drawStaticParts();
        this._createDynamicNodes();
        this._bindInteraction();
    }

    _drawStaticParts() {
        const s = this._staticGroup;
        const W = this.width;
        // 面板
        s.add(new Konva.Rect({ x: 0, y: 0, width: W, height: this.height, fill: '#eef2f5', stroke: '#1a252f', strokeWidth: 1, cornerRadius: 4 }));
        s.add(new Konva.Rect({ x: 3, y: 3, width: W - 6, height: this.height - 6, fill: '#e4eaef', cornerRadius: 3, stroke: '#5a6a75', strokeWidth: 1 }));
        // 标题
        s.add(new Konva.Text({ x: 0, y: 10, width: W, align: 'center', text: this.label, fontSize: 16, fontStyle: 'bold', fill: '#1a252f' }));

        // LCD 黑底
        const lcd = this._geo.lcd;
        s.add(new Konva.Rect({ x: lcd.x, y: lcd.y, width: lcd.w, height: lcd.h, fill: '#0a0e12', cornerRadius: 3, stroke: '#3a4a55', strokeWidth: 1 }));

        // 旋钮标签
        this._geo.knobs.forEach((k, i) => {
            const def = this._knobDefs[k.key];
            s.add(new Konva.Text({ x: k.x - 42, y: k.y - 36, width: 84, align: 'center', text: def.label, fontSize: 12, fill: '#333' }));
        });

        const rp = this._geo.rightPorts;
        const plp = { fontSize: 10, fill: '#777' };
        const rlabel = (y, txt) => s.add(new Konva.Text({ x: W - 66, y: y - 6, width: 60, align: 'right', text: txt, ...plp }));
        rlabel(rp.no_in1 + 16, '常开触点');
        rlabel(rp.iout1 + 16, '二次电流');
        rlabel(rp.vout1 + 16, '线电压');
        rlabel(rp.p24_p + 16, '24V 电源');
    }

    _createDynamicNodes() {
        const d = this._dynamicGroup;

        // LCD 两行
        const lcd = this._geo.lcd;
        this._lcdLine1 = new Konva.Text({ x: lcd.x + 8, y: lcd.y + 10, text: '', fontSize: 16, fontFamily: 'monospace', fontStyle: 'bold', fill: '#00ff88' });
        this._lcdLine2 = new Konva.Text({ x: lcd.x + 8, y: lcd.y + 38, text: '', fontSize: 16, fontFamily: 'monospace', fontStyle: 'bold', fill: '#ffd24a' });
        d.add(this._lcdLine1, this._lcdLine2);

        // 旋钮（圆 + 指针 + 值）
        this._knobNodes = this._geo.knobs.map(k => {
            const g = new Konva.Group({ x: k.x, y: k.y });
            const circle = new Konva.Circle({ radius: this._geo.knobR, fill: '#dfe6ea', stroke: '#5a6a75', strokeWidth: 2 });
            const pointer = new Konva.Line({ points: [0, 0, 0, -(this._geo.knobR - 5)], stroke: '#c0392b', strokeWidth: 3, lineCap: 'round' });
            const val = new Konva.Text({ x: -44, y: this._geo.knobR + 4, width: 88, align: 'center', text: '', fontSize: 12, fontStyle: 'bold', fill: '#1a252f' });
            g.add(circle, pointer, val);
            d.add(g);
            return { group: g, circle, pointer, val, key: k.key };
        });

        // 按钮
        this._mkButton = (pos, label, color, key) => {
            const g = new Konva.Group({ x: pos.x, y: pos.y });
            const rect = new Konva.Rect({ width: this._geo.btnW, height: this._geo.btnH, fill: color, cornerRadius: 4, stroke: '#5a6a75', strokeWidth: 1 });
            const txt = new Konva.Text({ width: this._geo.btnW, y: 6, align: 'center', text: label, fontSize: 13, fontStyle: 'bold', fill: '#fff', listening: false });
            g.add(rect, txt);
            d.add(g);
            return { group: g, rect, txt, key };
        };
        this._btnPrimaryStart   = this._mkButton(this._geo.btnPrimary.start,   '一次 起动', '#2e7d32', 'p-start');
        this._btnPrimaryStop    = this._mkButton(this._geo.btnPrimary.stop,    '一次 停止', '#8a3a14', 'p-stop');
        this._btnSecondaryStart = this._mkButton(this._geo.btnSecondary.start, '二次 起动', '#2e7d32', 's-start');
        this._btnSecondaryStop  = this._mkButton(this._geo.btnSecondary.stop,  '二次 停止', '#8a3a14', 's-stop');

        this._updateKnobs();
        this._updateLcd();
    }

    _bindInteraction() {
        // 旋钮：左半点击减一档，右半点击加一档
        this._knobNodes.forEach(n => {
            const hitL = new Konva.Circle({ x: -this._geo.knobR / 2, radius: this._geo.knobR, fill: 'transparent' });
            const hitR = new Konva.Circle({ x:  this._geo.knobR / 2, radius: this._geo.knobR, fill: 'transparent' });
            hitL.on('mousedown touchstart', (e) => { e.cancelBubble = true; this._stepKnob(n.key, -1); });
            hitR.on('mousedown touchstart', (e) => { e.cancelBubble = true; this._stepKnob(n.key, +1); });
            n.group.add(hitL, hitR);
        });

        // 按钮
        this._btnPrimaryStart.group.on('click tap', (e) => { e.cancelBubble = true; this._startPrimary(); });
        this._btnPrimaryStop.group.on('click tap',  (e) => { e.cancelBubble = true; this._stopPrimary(); });
        this._btnSecondaryStart.group.on('click tap', (e) => { e.cancelBubble = true; this._startSecondary(); });
        this._btnSecondaryStop.group.on('click tap',  (e) => { e.cancelBubble = true; this._stopSecondary(); });
    }

    // 将输入值对齐到 min/step 网格并限幅
    _snap(key, v) {
        const d = this._knobDefs[key];
        let x = parseFloat(v);
        if (!Number.isFinite(x)) x = d.def;
        x = Math.round((x - d.min) / d.step) * d.step + d.min;
        return Math.min(d.max, Math.max(d.min, parseFloat(x.toFixed(6))));
    }

    _stepKnob(key, dir) {
        this[key] = this._snap(key, this[key] + dir * this._knobDefs[key].step);
        this.config[key] = this[key];
        // 每次调整线电压，自动开始一次欠压保护时间测量
        if (key === 'lineV') this._beginVoltageTest();
        this._updateKnobs();
        this._updateLcd();
    }

    // 重置并启动欠压保护时间自动测量（主开关闭合后计时，跳闸断开后停表）
    _beginVoltageTest() {
        this._vElapsed = 0;
        this._vTripTime = null;
        this._vTiming = true;
        this._vArmed = false;
    }

    _updateKnobs() {
        if (!this._knobNodes) return;
        const n = this._knobDefs;
        this._knobNodes.forEach(node => {
            const key = node.key;
            const d = n[key];
            // 值在量程中的比例 → 角度 -135° ~ +135°
            const t = Math.min(1, Math.max(0, (this[key] - d.min) / (d.max - d.min)));
            node.pointer.rotation(-135 + 270 * t);
            node.val.text(`${this[key].toFixed(d.digits)} ${d.unit}`);
        });
    }

    _touchDirty() {
        this.markDirty();
        this._refreshIfDirty();
    }

    _startPrimary() {
        this._primaryOn = true;
        this._pElapsed = 0; this._pTripTime = null; this._pTiming = false;
        this._pOutputSeen = false;
        this._touchDirty();
    }
    _stopPrimary() {
        this._primaryOn = false;
        this._primaryOutput = false;
        this._pTiming = false;
        this._touchDirty();
    }
    _startSecondary() {
        this._secondaryOn = true;
        this._sElapsed = 0; this._sTripTime = null; this._sTiming = false;
        this._touchDirty();
    }
    _stopSecondary() {
        this._secondaryOn = false;
        this._secondaryOutput = false;
        this._sTiming = false;
        this._touchDirty();
    }

    // ═══════════════════════════════════════════
    // 仿真循环
    // ═══════════════════════════════════════════

    tick(dt) {
        const vs = this.sys && this.sys.voltageSolver;

        // 24V 供电检测
        if (vs && typeof vs.getPD === 'function') {
            const v = Math.abs(vs.getPD(`${this.id}_wire_p24_p`, `${this.id}_wire_p24_n`) || 0);
            this._powered = v > 1;
        } else {
            this._powered = false;
        }

        // 主开关常开触点：两输入端口同簇表示主开关合闸
        this._noClosed = this._readNoContact();

        // ── 一次电流测试 ──
        if (this._powered && this._primaryOn) {
            if (this._noClosed) {
                this._primaryOutput = true;
                this._pOutputSeen = true;
                if (this._pTripTime === null) { this._pTiming = true; this._pElapsed += dt; }
            } else {
                // 主开关断开 → 停止输出并记录跳闸时间
                this._primaryOutput = false;
                if (this._pTiming && this._pTripTime === null) {
                    this._pTripTime = this._pElapsed;
                    this._pTiming = false;
                }
            }
        } else {
            this._primaryOutput = false;
        }

        // ── 二次电流 / 线电压测试 ──
        if (this._powered && this._secondaryOn) {
            this._secondaryOutput = true;
            if (this._noClosed) {
                if (this._sTripTime === null) { this._sTiming = true; this._sElapsed += dt; }
            } else if (this._sTiming && this._sTripTime === null) {
                this._sTripTime = this._sElapsed;
                this._sTiming = false;
            }
        } else {
            this._secondaryOutput = false;
        }

        // ── 电压调整触发的欠压保护时间自动测量 ──
        if (this._vTiming) {
            if (this._noClosed) {
                this._vArmed = true;
                this._vElapsed += dt;                 // 主开关闭合期间计时
            } else if (this._vArmed) {
                this._vTripTime = this._vElapsed;     // 主开关断开（脱扣器动作）→ 停表
                this._vTiming = false;
                this._vArmed = false;
            }
        }

        this._updateLcd();
        this.markDirty();
        this._refreshIfDirty();
    }

    _readNoContact() {
        const vs = this.sys && this.sys.voltageSolver;
        if (!vs || !vs.portToCluster) return false;
        const c1 = vs.portToCluster.get(`${this.id}_wire_no_in1`);
        const c2 = vs.portToCluster.get(`${this.id}_wire_no_in2`);
        return c1 !== undefined && c2 !== undefined && c1 === c2;
    }

    _updateLcd() {
        if (!this._lcdLine1) return;

        if (!this._powered) {
            this._lcdLine1.text('请接通 24V 电源');
            this._lcdLine2.text('');
            return;
        }

        // 一次测试优先显示
        if (this._primaryOn) {
            this._lcdLine1.text(`一次电流 I = ${this.primaryI.toFixed(0)} A`);
            this._lcdLine2.text(this._pTripTime !== null
                ? `跳闸时间 t = ${this._pTripTime.toFixed(2)} s`
                : (this._primaryOutput ? '计时中…' : '等待主开关合闸'));
            return;
        }

        // 电压调整自动测量：欠压保护时间（优先于二次显示）
        if (this._vTiming || this._vTripTime !== null) {
            this._lcdLine1.text(`线电压 U = ${this.lineV.toFixed(0)} V`);
            this._lcdLine2.text(this._vTripTime !== null
                ? `跳闸时间 t = ${this._vTripTime.toFixed(2)} s`
                : (this._noClosed ? '计时中…' : '等待主开关合闸'));
            return;
        }

        if (this._secondaryOn) {
            const U = this.lineV;
            const I = this.secondaryI;
            const ph = this.secondaryPhase * Math.PI / 180;
            const P = U * I * Math.cos(ph) / 1000;   // kW（正=正功率，负=逆功率）
            this._lcdLine1.text(`U=${U.toFixed(0)}V I=${I.toFixed(1)}A P=${P.toFixed(2)}kW`);
            this._lcdLine2.text(this._sTripTime !== null
                ? `跳闸时间 t = ${this._sTripTime.toFixed(2)} s`
                : (this._sTiming ? '计时中…' : '等待主开关合闸'));
            return;
        }

        this._lcdLine1.text('就绪');
        this._lcdLine2.text('');
    }

    // ═══════════════════════════════════════════
    // 配置
    // ═══════════════════════════════════════════

    getConfigFields() {
        return [
            { label: '位号/名称', key: 'label', type: 'text' },
            { label: '一次电流 (A)', key: 'primaryI', type: 'number' },
            { label: '二次电流 (A)', key: 'secondaryI', type: 'number' },
            { label: '二次电流相位 (°)', key: 'secondaryPhase', type: 'number' },
            { label: '线电压 (V)', key: 'lineV', type: 'number' },
        ];
    }

    onConfigUpdate(cfg) {
        if (cfg.label !== undefined) this.label = cfg.label;
        ['primaryI', 'secondaryI', 'secondaryPhase', 'lineV'].forEach(key => {
            if (cfg[key] === undefined) return;
            this[key] = this._snap(key, cfg[key]);
        });
        this.config = { ...this.config, ...cfg };
        this._updateKnobs();
        this._updateLcd();
        this._touchDirty();
    }

    getClickablePartCenter(partId) {
        const gx = this.group ? this.group.x() : 0;
        const gy = this.group ? this.group.y() : 0;
        const idx = { primaryI: 0, secondaryI: 1, secondaryPhase: 2, lineV: 3 };
        if (partId in idx) { const k = this._geo.knobs[idx[partId]]; return { x: gx + k.x, y: gy + k.y }; }
        const btn = (p) => ({ x: gx + p.x + this._geo.btnW / 2, y: gy + p.y + this._geo.btnH / 2 });
        if (partId === 'btn-p-start') return btn(this._geo.btnPrimary.start);
        if (partId === 'btn-p-stop')  return btn(this._geo.btnPrimary.stop);
        if (partId === 'btn-s-start') return btn(this._geo.btnSecondary.start);
        if (partId === 'btn-s-stop')  return btn(this._geo.btnSecondary.stop);
        if (partId === 'lcd') { const l = this._geo.lcd; return { x: gx + l.x + l.w / 2, y: gy + l.y + l.h / 2 }; }
        return { x: gx + this.width / 2, y: gy + this.height / 2 };
    }
}

// 供 export.js 聚合（可选）
export default BreakerProtectionTester;
