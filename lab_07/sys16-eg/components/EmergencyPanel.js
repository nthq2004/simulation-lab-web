import { BaseComponent } from './BaseComponent.js';

/**
 * EmergencyPanel 应急配电板自动控制组件
 *
 * 控制应急发电机（egen1）、应急主开关（eqf1）和联络开关（tie1）的自动转电逻辑。
 * 内置 24V 控制电源，通过端口对输出 0/24V 电压驱动目标线圈。
 *
 * 端口（16 个）：
 *   上 4：tie_close_a/b / tie_open_a/b — 联络开关合/分
 *   左 2：det_a/det_b — 检测配电箱第 3 路出口电压
 *   右 4：eqf_close_a/b / eqf_open_a/b — 应急主开关合/分
 *   下 6：egen_start_a/b / egen_stop_a/b / egen_freq_p/n — 应发起动/停止/调频
 */

const PW = 240;
const PH = 340;

export class EmergencyPanel extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);
        this.width  = Math.max(220, config.width  || PW);
        this.height = Math.max(310, config.height || PH);
        this.type    = 'emergency_panel';
        this.special = 'EmergencyPanel';
        this.cache   = 'fixed';

        this._initGroups();
        this._recalcGeometry();
        this._initParameters(config);
        this._init();
        this.config = {
            id: this.id, label: this.label,
            genId: this.genId, eqfId: this.eqfId, tieId: this.tieId,
        };
        this._addPanelPorts();
    }

    // ===== 几何 =====
    _recalcGeometry() {
        // LCD
        this._lcd = { x: 8, y: 28, w: PW - 16, h: 64 };
        this._lcdRows = [32, 54, 76];

        // Row 2 — 3 个方形 LED（均匀分布）
        this._ledY = 120;
        this._ledSize = 18;
        this._leds = [
            { x: 60,  label: '主板配电有电', colorBase: '#cccccc', colorLit: '#ffffff' },
            { x: 130, label: '应急备用',     colorBase: '#b8960f', colorLit: '#ffd700' },
            { x: 200, label: '应急运行',     colorBase: '#cccccc', colorLit: '#ffffff' },
        ];

        // Row 3 — 控制模式旋转开关 + 应急合/分闸按钮
        this._row3Y = 210;
        this._modeSwitchRadius =18;
        this._modeSwitch = { x: 60, y: this._row3Y, r: this._modeSwitchRadius };
        this._eqfCloseBtn = { x: 145, y: this._row3Y, r: 18 };
        this._eqfOpenBtn  = { x: 200, y: this._row3Y, r: 18 };

        // Row 4 — 联络开关旋转开关 + 合闸/分闸指示灯
        this._row4Y = 290;
        this._tieSwitchRadius = 18;
        this._tieSwitch = { x: 60, y: this._row4Y, r: this._tieSwitchRadius };
        this._tieCloseLed = { x: 145, y: this._row4Y, r: 12 };
        this._tieOpenLed  = { x: 200, y: this._row4Y, r: 12 };

        // 端口位置
        this._topPorts = { tie_close_a: 30, tie_close_b: 70, tie_open_a: 150, tie_open_b: 190 };
        this._leftPorts  = { det_a: 150, det_b: 200 };
        this._rightPorts = { eqf_close_a: 20, eqf_close_b: 50, eqf_open_a: 90, eqf_open_b: 120 };
        this._bottomPorts = { egen_start_a: 30, egen_start_b: 70, egen_stop_a: 110, egen_stop_b: 150, egen_freq_p: 190, egen_freq_n: 220 };
    }

    // ===== 参数 =====
    _initParameters(config) {
        this.label  = config.label || '应急配电板';
        this.genId  = config.genId  || 'egen1';
        this.eqfId  = config.eqfId  || 'eqf1';
        this.tieId  = config.tieId  || 'tie1';
        this._mode   = 'auto';
        this._tiePosition = 'normal';
        this._userEqfCloseDown = false;
        this._userEqfOpenDown  = false;
        this._detPowered   = false;
        this._detPeak      = 0;
        this._detDeadCount = 0;
        this._out = {
            genStart: false, genStop: false, freqV: 0,
            eqfClose: false, eqfOpen: false,
            tieClose: false, tieOpen: false,
        };
        this._phase = 'idle';
        this._timer = 0;
        this._manualTieTimer = 0;
        this._restoreMode = 'normal'; // 恢复序列时序：'normal'=正常运行恢复(3s/5s/5s)，'test'=试验转正常(3s/3s/5s)
    }

    _init() {
        this._drawStaticParts();
        this._createDynamicNodes();
        this._bindInteraction();
    }

    // ===== 静态绘制 =====
    _drawStaticParts() {
        const s = this._staticGroup;
        // 面板底板
        s.add(new Konva.Rect({ x: 0, y: 0, width: PW, height: PH, fill: '#d6f0e8', stroke: '#1a252f', strokeWidth: 1, cornerRadius: 4 }));
        s.add(new Konva.Rect({ x: 3, y: 3, width: PW - 6, height: PH - 6, fill: '#c8eae0', cornerRadius: 3, stroke: '#5a7a70', strokeWidth: 1 }));
        // 标题
        s.add(new Konva.Text({ x: 0, y: 10, width: PW, align: 'center', text: this.label, fontSize: 14, fontStyle: 'bold', fill: '#1a252f' }));
        // LCD
        s.add(new Konva.Rect({ x: this._lcd.x, y: this._lcd.y, width: this._lcd.w, height: this._lcd.h, fill: '#0a0e12', cornerRadius: 2, stroke: '#3a4a55', strokeWidth: 1 }));

        // ── Row 2：LED 标签 ──
        this._leds.forEach(led => {
            s.add(new Konva.Rect({ x: led.x - this._ledSize / 2 - 2, y: this._ledY - this._ledSize / 2 - 2, width: this._ledSize + 4, height: this._ledSize + 4, fill: '#b0c8c0', cornerRadius: 2, stroke: '#5a7a70', strokeWidth: 1 }));
            s.add(new Konva.Text({ x: led.x - 36, y: this._ledY + this._ledSize / 2 + 4, width: 72, align: 'center', text: led.label, fontSize: 12, fontStyle: 'bold', fill: '#1a252f' }));
        });

        // ── Row 3：控制模式旋转开关（静态底板 + 位置标签）──
        const ms = this._modeSwitch;
        const knobR = this._modeSwitchRadius;
        s.add(new Konva.Text({ x: ms.x - 22, y: ms.y - knobR - 20, width: 48, align: 'center', text: '控制模式', fontSize: 12, fontStyle: 'bold', fill: '#1a252f' }));
        // 外圈底板
        s.add(new Konva.Circle({ x: ms.x, y: ms.y, radius: knobR + 4, fill: '#8a9a90', stroke: '#3a4a55', strokeWidth: 1 }));
        // 两个位置标记（小圆点）
        const arcR = knobR - 2;
        s.add(new Konva.Circle({ x: ms.x - arcR * 0.707, y: ms.y - arcR * 0.707, radius: 3, fill: '#5a7a70', stroke: '#3a4a55', strokeWidth: 0.5 }));
        s.add(new Konva.Circle({ x: ms.x + arcR * 0.707, y: ms.y - arcR * 0.707, radius: 3, fill: '#5a7a70', stroke: '#3a4a55', strokeWidth: 0.5 }));
        // 位置文字
        s.add(new Konva.Text({ x: ms.x - 50, y: ms.y - 18, width: 30, align: 'center', text: '手动', fontSize: 11, fontStyle: 'bold', fill: '#1a252f' }));
        s.add(new Konva.Text({ x: ms.x + 16, y: ms.y - 18, width: 30, align: 'center', text: '自动', fontSize: 11, fontStyle: 'bold', fill: '#1a252f' }));

        // ── Row 3：应急合/分闸按钮 ──
        [this._eqfCloseBtn, this._eqfOpenBtn].forEach(b => {
            s.add(new Konva.Circle({ x: b.x, y: b.y, radius: b.r + 3, fill: '#b0c8c0', stroke: '#5a7a70', strokeWidth: 1 }));
        });

        // ── Row 4：联络开关旋转开关（静态底板 + 位置标签）──
        const ts = this._tieSwitch;
        const tr = this._tieSwitchRadius;
        s.add(new Konva.Text({ x: ts.x - 22, y: ts.y - tr - 20, width: 48, align: 'center', text: '联络开关', fontSize: 12, fontStyle: 'bold', fill: '#1a252f' }));
        s.add(new Konva.Circle({ x: ts.x, y: ts.y, radius: tr + 4, fill: '#8a9a90', stroke: '#3a4a55', strokeWidth: 1 }));
        const tar = tr - 2;
        s.add(new Konva.Circle({ x: ts.x - tar * 0.707, y: ts.y - tar * 0.707, radius: 3, fill: '#5a7a70', stroke: '#3a4a55', strokeWidth: 0.5 }));
        s.add(new Konva.Circle({ x: ts.x + tar * 0.707, y: ts.y - tar * 0.707, radius: 3, fill: '#5a7a70', stroke: '#3a4a55', strokeWidth: 0.5 }));
        s.add(new Konva.Text({ x: ts.x - 50, y: ts.y - 18, width: 30, align: 'center', text: '试验', fontSize: 11, fontStyle: 'bold', fill: '#1a252f' }));
        s.add(new Konva.Text({ x: ts.x + 16, y: ts.y - 18, width: 30, align: 'center', text: '正常', fontSize: 11, fontStyle: 'bold', fill: '#1a252f' }));

        // ── Row 4：合闸/分闸指示灯 ──
        [this._tieCloseLed, this._tieOpenLed].forEach(l => {
            s.add(new Konva.Circle({ x: l.x, y: l.y, radius: l.r + 3, fill: '#b0c8c0', stroke: '#5a7a70', strokeWidth: 1 }));
        });
        s.add(new Konva.Text({ x: this._tieCloseLed.x - 24, y: this._tieCloseLed.y - 28, width: 48, align: 'center', text: '联络合闸', fontSize: 12, fontStyle: 'bold', fill: '#1a252f' }));
        s.add(new Konva.Text({ x: this._tieOpenLed.x - 24, y: this._tieOpenLed.y - 28, width: 48, align: 'center', text: '联络分闸', fontSize: 12, fontStyle: 'bold', fill: '#1a252f' }));

        // ── 端口区域标签 ──
        s.add(new Konva.Text({ x: 2, y: 172, text: '检测', fontSize: 11, fontStyle: 'bold', fill: '#1a252f' }));
        s.add(new Konva.Text({ x: PW - 70, y: 90, width: 60, align: 'center', text: '应急合分闸', fontSize: 11, fontStyle: 'bold', fill: '#1a252f' }));
        s.add(new Konva.Text({ x: 40, y: PH - 20, width: 160, align: 'center', text: '应急起动 / 停止 / 调频', fontSize: 11, fontStyle: 'bold', fill: '#1a252f' }));

        if (this.cache === 'fixed') {
            try { const r = this._staticGroup.getClientRect({ relativeTo: this._staticGroup }); if (r && r.width > 0 && r.height > 0) this._staticGroup.cache({ x: r.x, y: r.y, width: Math.ceil(r.width), height: Math.ceil(r.height) }); } catch (e) { /* ignore */ }
        }
    }

    // ===== 动态节点 =====
    _createDynamicNodes() {
        const d = this._dynamicGroup;
        const ui = {};

        // LCD 文字
        const mkLcd = (y) => { const t = new Konva.Text({ x: this._lcd.x + 6, y, fontSize: 13, fontFamily: 'monospace', fontStyle: 'bold', fill: '#00ff88', text: '' }); d.add(t); return t; };
        ui.lcd = this._lcdRows.map(mkLcd);

        // 方形 LED
        ui.leds = this._leds.map(led => {
            const node = new Konva.Rect({ x: led.x - this._ledSize / 2, y: this._ledY - this._ledSize / 2, width: this._ledSize, height: this._ledSize, fill: led.colorBase, cornerRadius: 2, stroke: '#222', strokeWidth: 1 });
            d.add(node); return node;
        });

        // 控制模式旋转开关（旋钮 + 指针线）
        ui.modeKnob = this._mkRotaryKnob(d, this._modeSwitch.x, this._modeSwitch.y, this._modeSwitchRadius, '#d8d8d8', '#080808');
        // 联络开关旋转开关（旋钮 + 指针线）
        ui.tieKnob = this._mkRotaryKnob(d, this._tieSwitch.x, this._tieSwitch.y, this._tieSwitchRadius, '#d8d8d8', '#0e0d0d');

        // 应急合/分闸按钮
        ui.eqfCloseBtn = this._mkRingBtn(d, this._eqfCloseBtn, '#1d8a4e', '#146a38', '#2ecc71', '合闸');
        ui.eqfOpenBtn  = this._mkRingBtn(d, this._eqfOpenBtn, '#922b21', '#7a1f18', '#e74c3c', '分闸');

        // 合闸/分闸指示灯
        ui.tieCloseLed = this._mkRoundLed(d, this._tieCloseLed, '#8a8a8a', '#2ecc71');
        ui.tieOpenLed  = this._mkRoundLed(d, this._tieOpenLed, '#8a8a8a', '#e74c3c');

        this._ui = ui;
    }

    /** 创建圆形旋转开关：底板 + 旋钮圆 + 指针线（初始朝上，即 -90°） */
    _mkRotaryKnob(d, cx, cy, r, knobFill, ptrColor) {
        const g = new Konva.Group({ x: cx, y: cy, rotation: 0 });
        // 旋钮
        const knob = new Konva.Circle({ radius: r, fill: knobFill, stroke: '#666', strokeWidth: 1.5 });
        // 中心轴
        const center = new Konva.Circle({ radius: 4, fill: '#555', stroke: '#333', strokeWidth: 1 });
        // 指针线（从圆心向上延伸）
        const ptr = new Konva.Line({ points: [0, 0, 0, -(r - 2)], stroke: ptrColor, strokeWidth: 6, lineCap: 'round' });
        g.add(knob, center, ptr);
        d.add(g);
        return g;
    }

    _mkRingBtn(d, def, base, dark, lit, label) {
        const g = new Konva.Group({ x: def.x, y: def.y });
        const ring = new Konva.Circle({ radius: def.r + 3, fill: '#e8e8e8', stroke: '#999', strokeWidth: 1 });
        const face = new Konva.Circle({ radius: def.r, fill: base, stroke: '#1a252f', strokeWidth: 1 });
        const txt = new Konva.Text({ x: -def.r, y: -def.r, width: def.r * 2, height: def.r * 2, align: 'center', verticalAlign: 'middle', text: label, fontSize: 11, fontStyle: 'bold', fill: '#fff' });
        g.add(ring, face, txt); d.add(g);
        face._base = base; face._dark = dark; face._lit = lit;
        return { g, face, ring };
    }

    _mkRoundLed(d, def, baseColor, litColor) {
        const node = new Konva.Circle({ x: def.x, y: def.y, radius: def.r, fill: baseColor, stroke: '#222', strokeWidth: 1 });
        d.add(node); node._base = baseColor; node._lit = litColor; return node;
    }

    // ===== 交互 =====
    _bindInteraction() {
        const ui = this._ui;
        if (!ui) return;
        const hold = (node, onDown, onUp) => {
            node.on('mousedown touchstart', (e) => { e.cancelBubble = true; onDown(); });
            node.on('mouseup touchend mouseleave', () => { onUp(); });
        };
        hold(ui.eqfCloseBtn.g, () => { this._userEqfCloseDown = true; }, () => { this._userEqfCloseDown = false; });
        hold(ui.eqfOpenBtn.g,  () => { this._userEqfOpenDown  = true; }, () => { this._userEqfOpenDown  = false; });
        // 旋转开关点击：旋钮和整个 Group 都可点击
        const resetState = () => { this._phase = 'idle'; this._timer = 0; this._manualTieTimer = 0; };
        const toggleMode = (e) => {
            e.cancelBubble = true;
            // 部件标记：供工作流 find 识别「模式开关」（不拦截交互）
            if (this.sys) { this.sys.lastClickedId = this.id; this.sys.lastClickedPartId = this.id + '/mode-knob'; }
            const wasAuto = this._mode === 'auto';
            this._mode = this._mode === 'auto' ? 'manual' : 'auto';
            resetState();
            if (wasAuto) {
                // 自动 → 手动 且 主电失电：联络保持断开（跳过手动 3s 延时，避免联络短暂自动闭合）
                if (!this._detPowered) this._manualTieTimer = 3;
            } else {
                // 手动 → 自动：按实际设备状态同步状态机，保持应急运行（主开关合闸 = 应急运行）
                this._syncPhaseWithDevices();
            }
        };
        const toggleTie = (e) => {
            e.cancelBubble = true;
            // 部件标记：供工作流 find 识别「联络开关模式转换开关」（不拦截交互）
            if (this.sys) { this.sys.lastClickedId = this.id; this.sys.lastClickedPartId = this.id + '/tie-knob'; }
            const wasTest = this._tiePosition === 'test';
            this._tiePosition = this._tiePosition === 'normal' ? 'test' : 'normal';
            // 试验 → 正常 且 左端口有电 且 正在应急运行：按"试验转正常"时序恢复（3s分闸→3s合联络→5s停机）
            if (wasTest && this._tiePosition === 'normal' && this._detPowered && this._phase === 'running') {
                this._restoreMode = 'test';
                this._phase = 'restore_eqf';
                this._timer = 0;
                this._manualTieTimer = 0;
            } else {
                this._restoreMode = 'normal';
                resetState();
                if (this._mode === 'auto') {
                    // 自动模式：按实际设备状态同步（应急运行保持不被打断）
                    this._syncPhaseWithDevices();
                } else {
                    // 手动模式：主电失电时切回正常位，联络保持断开（跳过手动 3s 延时）
                    if (!this._detPowered) this._manualTieTimer = 3;
                }
            }
        };
        ui.modeKnob.on('mousedown touchstart', toggleMode);
        ui.modeKnob.getChildren().forEach(c => c.on('mousedown touchstart', toggleMode));
        ui.tieKnob.on('mousedown touchstart', toggleTie);
        ui.tieKnob.getChildren().forEach(c => c.on('mousedown touchstart', toggleTie));
    }

    // ===== 端口（16 个）=====
    _addPanelPorts() {
        const tp = this._topPorts, lp = this._leftPorts, rp = this._rightPorts, bp = this._bottomPorts;
        this.addPort(tp.tie_close_a, 2, 'tie_close_a', 'wire', 'p');
        this.addPort(tp.tie_close_b, 2, 'tie_close_b', 'wire');
        this.addPort(tp.tie_open_a,  2, 'tie_open_a',  'wire', 'p');
        this.addPort(tp.tie_open_b,  2, 'tie_open_b',  'wire');
        this.addPort(2, lp.det_a, 'det_a', 'wire', 'p');
        this.addPort(2, lp.det_b, 'det_b', 'wire');
        const h = this.height - 2;
        this.addPort(PW - 2, rp.eqf_close_a, 'eqf_close_a', 'wire', 'p');
        this.addPort(PW - 2, rp.eqf_close_b, 'eqf_close_b', 'wire');
        this.addPort(PW - 2, rp.eqf_open_a,  'eqf_open_a',  'wire', 'p');
        this.addPort(PW - 2, rp.eqf_open_b,  'eqf_open_b',  'wire');
        this.addPort(bp.egen_start_a, h, 'egen_start_a', 'wire', 'p');
        this.addPort(bp.egen_start_b, h, 'egen_start_b', 'wire');
        this.addPort(bp.egen_stop_a,  h, 'egen_stop_a',  'wire', 'p');
        this.addPort(bp.egen_stop_b,  h, 'egen_stop_b',  'wire');
        this.addPort(bp.egen_freq_p,  h, 'egen_freq_p',  'wire', 'p');
        this.addPort(bp.egen_freq_n,  h, 'egen_freq_n',  'wire', 'n');
    }

    // ===== det 检测（滑窗峰值）=====
    _senseDet() {
        if (!this.sys || !this.sys.getVoltageBetween) return;
        const p1 = this.id + '_wire_det_a';
        const p2 = this.id + '_wire_det_b';
        try {
            const v = this.sys.getVoltageBetween(p1, p2);
            if (typeof v === 'number' && isFinite(v)) {
                const a = Math.abs(v);
                if (a > this._detPeak * 0.15) { this._detDeadCount = 0; }
                else { this._detDeadCount++; }
                if (a > this._detPeak) this._detPeak = a;
                if (this._detDeadCount > 8) { this._detPeak = 0; this._detDeadCount = 0; }
                this._detPowered = this._detPeak > 120;
            }
        } catch (e) { /* ignore */ }
    }

    // ===== 控制输出 =====
    _setOut(key, val) { this._out[key] = !!val; }

    _clearOutputs() {
        for (const k of Object.keys(this._out)) this._out[k] = false;
        this._out.freqV = 0;
    }

    // ===== 模式切换状态同步 =====
    /** 切换回自动模式（或试验位切回正常位）时，按实际设备状态初始化状态机，
     *  保证应急运行（应急主开关合闸 = 应急运行状态）不被打断 */
    _syncPhaseWithDevices() {
        const gen = this.sys && this.sys.comps ? this.sys.comps[this.genId] : null;
        const eqf = this.sys && this.sys.comps ? this.sys.comps[this.eqfId] : null;
        const genOn = gen && typeof gen.isOn === 'boolean' ? gen.isOn : false;
        const eqfOn = eqf && typeof eqf.getState === 'function' ? eqf.getState() === 'on' : false;
        this._timer = 0;
        if (genOn && eqfOn) {
            this._phase = 'running';   // 应急运行中（主开关合闸）→ 保持 running
        } else if (genOn) {
            this._phase = 'eqf_close'; // 机组已运行但主开关未合 → 回到合闸延时阶段
        } else {
            this._phase = 'idle';      // 机组停机 → 待机
        }
    }

    // ===== 自动状态机 =====
    _runAutoLogic(dt) {
        const gen = this.sys && this.sys.comps ? this.sys.comps[this.genId] : null;
        const genOn = gen && typeof gen.isOn === 'boolean' ? gen.isOn : false;

        // ── 试验位：联络自动断开，强制自动起动序列（忽略 det 检测）──
        if (this._tiePosition === 'test') {
            this._setOut('tieOpen', true);
            this._setOut('tieClose', false);
            if (this._phase === 'idle') { this._phase = 'gen_start'; this._timer = 0; }
            this._runAutoSequence(dt, genOn);
            return;
        }

        // ── 正常位 ──
        if (this._detPowered) {
            // 主电有电：
            //  - 应急运行中恢复 → 切入恢复序列
            //  - 恢复序列中 → 继续执行（保证停机指令发出）
            //  - 其他 → 待机：联络合闸、应急主开关分闸、机组停机
            if (this._phase === 'running') { this._restoreMode = 'normal'; this._phase = 'restore_eqf'; this._timer = 0; }
            if (this._phase === 'restore_eqf' || this._phase === 'restore_break' ||
                this._phase === 'restore_tie' || this._phase === 'restore_tie_on' ||
                this._phase === 'restore_stop' || this._phase === 'restore_stop2') {
                this._runAutoSequence(dt, genOn);
                return;
            }
            this._phase = 'idle';
            this._timer = 0;
            this._setOut('tieClose', true);
            this._setOut('tieOpen', false);
            this._setOut('eqfClose', false);
            this._setOut('eqfOpen', true);
            this._setOut('genStart', false);
            this._setOut('genStop', false);
            this._setOut('freqV', 0);
        } else {
            // 主电失电：联络立即断开，跑自动起动序列
            this._runAutoSequence(dt, genOn);
        }
    }

    _runAutoSequence(dt, genOn) {
        this._timer += dt;
        switch (this._phase) {
            case 'idle':
                // 失电：联络立即断开，进入起动延时
                this._setOut('tieClose', false);
                this._setOut('tieOpen', true);
                this._setOut('eqfClose', false);
                this._setOut('eqfOpen', false);
                this._setOut('genStart', false);
                this._setOut('genStop', false);
                this._phase = 'gen_start';
                this._timer = 0;
                break;
            case 'gen_start':
                // 延时 10s 后发出应急发电机自动起动信号
                this._setOut('tieOpen', true);
                this._setOut('tieClose', false);
                if (this._timer >= 10) { this._phase = 'gen_wait'; this._timer = 0; }
                break;
            case 'gen_wait':
                // 发出起动信号，等待机组起动成功
                this._setOut('tieOpen', true);
                this._setOut('tieClose', false);
                this._setOut('genStart', true);
                if (genOn) { this._phase = 'eqf_close'; this._timer = 0; }
                break;
            case 'eqf_close':
                // 起动成功后延时 8s 发应急主开关合闸信号
                this._setOut('tieOpen', true);
                this._setOut('tieClose', false);
                this._setOut('genStart', false);
                if (this._timer >= 8) { this._phase = 'eqf_energize'; this._timer = 0; }
                break;
            case 'eqf_energize':
                // 合闸信号持续 2s（确保开关合上）
                this._setOut('tieOpen', true);
                this._setOut('tieClose', false);
                this._setOut('eqfClose', true);
                if (this._timer >= 2) { this._setOut('eqfClose', false); this._phase = 'running'; this._timer = 0; }
                break;
            case 'running':
                // 应急运行：联络断开、应急主开关合闸、机组带载
                this._setOut('tieOpen', true);
                this._setOut('tieClose', false);
                break;
            case 'restore_eqf':
                // 主电恢复：延时 3s 后应急主开关分闸
                this._setOut('tieOpen', true);
                this._setOut('tieClose', false);
                if (this._timer >= 3) { this._phase = 'restore_break'; this._timer = 0; }
                break;
            case 'restore_break':
                // 分闸信号持续 2s（确保开关分闸）
                this._setOut('tieOpen', true);
                this._setOut('tieClose', false);
                this._setOut('eqfOpen', true);
                if (this._timer >= 2) { this._setOut('eqfOpen', false); this._phase = 'restore_tie'; this._timer = 0; }
                break;
            case 'restore_tie':
                // 分闸后延时联络开关闭合：normal 3s（分闸信号2s+3s=5s）；test转正常 1s（2s+1s=3s）
                this._setOut('tieOpen', true);
                this._setOut('tieClose', false);
                if (this._timer >= (this._restoreMode === 'test' ? 1 : 3)) { this._phase = 'restore_tie_on'; this._timer = 0; }
                break;
            case 'restore_tie_on':
                // 合闸信号持续 2s（确保开关合上）
                this._setOut('tieOpen', false);
                this._setOut('tieClose', true);
                if (this._timer >= 2) { this._phase = 'restore_stop'; this._timer = 0; }
                break;
            case 'restore_stop':
                // 合联络后延时 3s（共 5s）发出停机信号
                this._setOut('tieClose', true);
                if (this._timer >= 3) { this._phase = 'restore_stop2'; this._timer = 0; }
                break;
            case 'restore_stop2':
                // 停机信号持续 5s
                this._setOut('tieClose', true);
                this._setOut('genStop', true);
                if (this._timer >= 5) { this._setOut('genStop', false); this._phase = 'idle'; this._timer = 0; }
                break;
            default:
                this._phase = 'idle';
                this._timer = 0;
        }
    }

    // ===== 手动控制 =====
    _runManualLogic(dt) {
        // 联络开关
        if (this._tiePosition === 'test') {
            // 试验位：联络断开，可手动操作应急主开关
            this._setOut('tieOpen', true);
            this._setOut('tieClose', false);
            this._manualTieTimer = 0;
        } else if (this._detPowered) {
            // 有电：联络合闸
            this._setOut('tieClose', true);
            this._setOut('tieOpen', false);
            this._manualTieTimer = 0;
        } else {
            // 失电：延时 3s 断开联络
            this._manualTieTimer += dt;
            if (this._manualTieTimer >= 3) {
                this._setOut('tieOpen', true);
                this._setOut('tieClose', false);
            } else {
                this._setOut('tieClose', true);
                this._setOut('tieOpen', false);
            }
        }
        // 应急主开关：仅手动按钮操作
        this._setOut('eqfClose', this._userEqfCloseDown);
        this._setOut('eqfOpen',  this._userEqfOpenDown);
        // 手动模式不自动操作应急发电机
        this._setOut('genStart', false);
        this._setOut('genStop', false);
        this._setOut('freqV', 0);
    }

    // ===== tick =====
    tick(dt) {
        this._senseDet();
        this._clearOutputs();
        if (this._mode === 'auto') {
            this._runAutoLogic(dt);
        } else {
            this._runManualLogic(dt);
        }
        this._updateUI();
        this.markDirty();
        if (this.sys && typeof this.sys.requestRedraw === 'function') this.sys.requestRedraw();
    }

    // ===== UI 更新 =====
    _updateUI() {
        const ui = this._ui;
        if (!ui) return;
        const gen = this.sys && this.sys.comps ? this.sys.comps[this.genId] : null;
        const eqf = this.sys && this.sys.comps ? this.sys.comps[this.eqfId] : null;
        const tie = this.sys && this.sys.comps ? this.sys.comps[this.tieId] : null;
        const genOn = gen && typeof gen.isOn === 'boolean' ? gen.isOn : false;
        const eqfOn = eqf && typeof eqf.getState === 'function' ? eqf.getState() === 'on' : false;
        const tieOn = tie && typeof tie.getState === 'function' ? tie.getState() === 'on' : false;

        // LCD 显示
        const vDet = this._detPowered ? (this._detPeak * 0.707).toFixed(0) : '---';
        const vGen = genOn && gen._vRmsOut ? (gen._vRmsOut * 1.732).toFixed(0) : '---';
        const fGen = genOn && gen._freqOut ? gen._freqOut.toFixed(1) : '--';
        const modeStr = this._mode === 'auto' ? '自动' : '手动';
        const posStr  = this._tiePosition === 'normal' ? '正常' : '试验';
        const phaseLabels = {
            idle: '待机',
            gen_start: '起动延时', gen_wait: '起动机组', eqf_close: '合闸延时', eqf_energize: '合主开关',
            running: '应急运行', gen_running: '机组运行',
            restore_eqf: '恢复-延时', restore_break: '恢复-断开关', restore_tie: '恢复-延时', restore_tie_on: '恢复-合联络',
            restore_stop: '恢复-延时', restore_stop2: '恢复-停机',
        };
        // 手动模式不驱动状态机（_phase 恒为 idle），按实际设备状态推断显示：
        // 发电机运行 + 主开关合闸 = 应急运行
        let dispPhase = this._phase;
        if (this._mode === 'manual') {
            if (genOn && eqfOn) dispPhase = 'running';
            else if (genOn) dispPhase = 'gen_running';
            else dispPhase = 'idle';
        }
        ui.lcd[0].text('主电 ' + vDet + 'V');
        ui.lcd[1].text('应急 ' + fGen + 'Hz ' + vGen + 'V');
        ui.lcd[2].text(modeStr + '\u00b7' + posStr + ' ' + (phaseLabels[dispPhase] || ''));

        // 方形 LED
        ui.leds[0].fill(this._detPowered ? '#ffffff' : '#cccccc');
        const ready = gen && gen.mode === 'remote' && !genOn;
        ui.leds[1].fill(ready ? '#ffd700' : '#b8960f');
        ui.leds[2].fill(genOn ? '#ffffff' : '#cccccc');

        // 旋转开关指针旋转：-45° = 左（手动/试验），+45° = 右（自动/正常）
        const modeAngle = this._mode === 'manual' ? -45 : 45;
        ui.modeKnob.rotation(modeAngle);
        const tieAngle = this._tiePosition === 'test' ? -45 : 45;
        ui.tieKnob.rotation(tieAngle);

        // 应急合/分闸按钮颜色（手动/自动模式均正常指示）
        // 合闸按钮：应急主开关合闸（ON）时显示亮绿色；按下时显示深色
        ui.eqfCloseBtn.face.fill(this._userEqfCloseDown ? ui.eqfCloseBtn.face._dark : (eqfOn ? ui.eqfCloseBtn.face._lit : ui.eqfCloseBtn.face._base));
        // 分闸按钮：应急主开关分闸（OFF）时显示亮红色；按下时显示深色
        ui.eqfOpenBtn.face.fill(this._userEqfOpenDown ? ui.eqfOpenBtn.face._dark : (!eqfOn ? ui.eqfOpenBtn.face._lit : ui.eqfOpenBtn.face._base));

        // 合闸/分闸指示灯
        ui.tieCloseLed.fill(tieOn ? ui.tieCloseLed._lit : ui.tieCloseLed._base);
        ui.tieOpenLed.fill(!tieOn ? ui.tieOpenLed._lit : ui.tieOpenLed._base);
    }

    // ===== 公开 API =====
    getMode() { return this._mode; }
    getTiePos() { return this._tiePosition; }
    isDetPowered() { return this._detPowered; }
    getPhase() { return this._phase; }

    getConfigFields() {
        return [
            { label: '应急 ID', key: 'genId', type: 'text' },
            { label: '应急主开关 ID', key: 'eqfId', type: 'text' },
            { label: '联络开关 ID', key: 'tieId', type: 'text' },
        ];
    }

    onConfigUpdate(cfg) {
        if (cfg.genId !== undefined) this.genId = cfg.genId;
        if (cfg.eqfId !== undefined) this.eqfId = cfg.eqfId;
        if (cfg.tieId !== undefined) this.tieId = cfg.tieId;
        this.config = { ...this.config, genId: this.genId, eqfId: this.eqfId, tieId: this.tieId };
        this.markDirty();
    }
}
