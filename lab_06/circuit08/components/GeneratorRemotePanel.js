import { BaseComponent } from './BaseComponent.js';

/**
 * GeneratorRemotePanel 发电机组遥控面板
 * 尺寸 205×288，单面板。
 * 自上而下：
 *  - 3 行 LCD（线电压/频率、电流/有功功率、功率因数）
 *  - 主开关遥控圆形带灯按钮（CLOSE 合闸 / OPEN 分闸，灯占整个圆面）
 *  - 发电机操作：START/STOP 圆钮 + RUNNING 运行灯 + 调速旋钮
 *
 * 端口：
 *  - 上侧：open_a/open_b（分闸指令）、close_a/close_b（合闸指令）
 *  - 左侧：start_a/start_b（遥控起动）、stop_a/stop_b（遥控停止）、spd_p/spd_n（调速输出）
 *  - 下侧：p24_p/p24_n（24V 电源输入）
 *
 * 求解器类型 gen_remote_panel：
 *  - START/STOP 按住时内部短接 start/stop 端口对（拓扑 union）
 *  - 面板通电（p24 电压 >1V 连续 3 帧）后：
 *      调速电压源 spd_p→spd_n = -1/0/+1V（旋钮减速/中立/加速）
 *      合闸按下时 close_a→close_b 输出 24V；分闸按下时 open_a→open_b 输出 24V
 *  - LCD 直接读取 gen 组件（sys.comps[genId]）状态
 */

const PANEL_W = 210;   // 面板宽
const PANEL_H = 240;   // 组件高

export class GeneratorRemotePanel extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.width  = Math.max(180, config.width  || PANEL_W);
        this.height = Math.max(180, config.height || PANEL_H);

        this.type    = 'gen_remote_panel';
        this.special = 'RemoteGenPanel';
        this.cache   = 'fixed';

        this._initGroups();
        this._recalcGeometry();
        this._initParameters(config);
        this._init();

        this.config = {
            label: this.label,
            genId: this.genId,
            qfId:  this.qfId,
        };

        this._addPanelPorts();
    }

    // ═══════════════════════════════════════════
    // 几何计算
    // ═══════════════════════════════════════════

    _recalcGeometry() {
        // LCD：y=16 起，3 行
        this._lcd = { x: 8, y: 30, w: PANEL_W - 16, h: 58 };
        this._lcdRows = [34, 52, 70];

        // 三排控件中心：排1 合闸/分闸，排2 起动/停止，排3 运行灯/调速旋钮
        this._btnClose = { x: 58,  y: 112,  r: 17 };
        this._btnOpen  = { x: 152, y: 112,  r: 17 };
        this._btnStart = { x: 58,  y: 155, r: 17 };
        this._btnStop  = { x: 152, y: 155, r: 17 };
        this._runLed   = { x: 58,  y: 199, r: 17 };   // 运行灯与起动按钮同大
        this._knob     = { x: 152, y: 199, r: 17 };

        // 端口坐标（顶部 close 端口位于合闸按钮上方，open 端口位于分闸按钮上方）
        this._topPorts = { close_a: 30, close_b: 70, open_a: 115, open_b: 155 };
        // 左端口三组分别对齐三排按钮
        this._leftPorts = { start_a: 100, start_b: 120, stop_a: 150, stop_b: 170, spd_p: 200, spd_n: 220 };
        // 底部电源端口居中
        this._bottomPorts = { p24_p: 85, p24_n: 125 };
    }

    // ═══════════════════════════════════════════
    // 参数初始化
    // ═══════════════════════════════════════════

    _initParameters(config) {
        this.label    = config.label || '发电机组遥控面板';
        this.function = '发电机组遥控面板';

        this.genId = config.genId !== undefined ? config.genId : '';
        this.qfId  = config.qfId  !== undefined ? config.qfId  : '';

        // 供电状态：p24 电压 >1V 连续 3 帧才认为有电
        this._powered = false;
        this._powerTimer = 0;

        // 操作状态
        this._startPressed  = false;
        this._stopPressed   = false;
        this._closePressed  = false;
        this._openPressed   = false;
        this._spdVolt       = 0;

        // LCD 采样（求解迭代变化时才刷新）
        this._lastSolverIter = undefined;
        this._sample = null;   // { on, lineV, freq, I, P, cos, qfOn }
    }

    // ═══════════════════════════════════════════
    // 初始化
    // ═══════════════════════════════════════════

    _init() {
        this._drawStaticParts();
        this._createDynamicNodes();
        this._bindInteraction();
    }

    // ═══════════════════════════════════════════
    // 静态部件
    // ═══════════════════════════════════════════

    _drawStaticParts() {
        const s = this._staticGroup;

        // 面板（浅灰蓝底 + 深描边）
        s.add(new Konva.Rect({
            x: 0, y: 0, width: PANEL_W, height: this.height,
            fill: '#e8eef4', stroke: '#1a252f', strokeWidth: 1, cornerRadius: 3,
        }));
        s.add(new Konva.Rect({
            x: 3, y: 3, width: PANEL_W - 6, height: this.height - 6,
            fill: '#dfe7ee', cornerRadius: 2, stroke: '#5a6a75', strokeWidth: 1,
        }));
        // 标题
        s.add(new Konva.Text({
            x: 0, y: 12, width: PANEL_W, align: 'center',
            text: '发电机组遥控面板', fontSize: 16, fontStyle: 'bold', fill: '#1a252f',
        }));
        // LCD 黑底
        s.add(new Konva.Rect({
            x: this._lcd.x, y: this._lcd.y,
            width: this._lcd.w, height: this._lcd.h,
            fill: '#0a0e12', cornerRadius: 2, stroke: '#3a4a55', strokeWidth: 1,
        }));
        // 合闸/分闸 圆形按钮底盘
        [this._btnClose, this._btnOpen].forEach(b => {
            s.add(new Konva.Circle({ x: b.x, y: b.y, radius: b.r + 3, fill: '#cdd8e0', stroke: '#5a6a75', strokeWidth: 1 }));
        });
        // START / STOP 圆钮底盘
        [this._btnStart, this._btnStop].forEach(b => {
            s.add(new Konva.Circle({ x: b.x, y: b.y, radius: b.r + 3, fill: '#cdd8e0', stroke: '#5a6a75', strokeWidth: 1 }));
        });
        // RUNNING 运行灯底盘
        s.add(new Konva.Circle({ x: this._runLed.x, y: this._runLed.y, radius: this._runLed.r + 4, fill: '#cdd8e0', stroke: '#5a6a75', strokeWidth: 1 }));
        s.add(new Konva.Text({ x: this._runLed.x - 26, y: this._runLed.y + this._runLed.r + 4, width: 52, align: 'center', text: '运行', fontSize: 11, fontStyle: 'bold', fill: '#1a252f' }));
        // 调速旋钮底盘
        s.add(new Konva.Circle({ x: this._knob.x, y: this._knob.y, radius: this._knob.r + 3, fill: '#cfd8df', stroke: '#5a6a75', strokeWidth: 1 }));
        s.add(new Konva.Text({ x: this._knob.x - 26, y: this._knob.y + this._knob.r + 4, width: 52, align: 'center', text: '调速', fontSize: 11, fill: '#333' }));
        // 顶部端口标注（面板外上方，合闸/分闸端口对各自居中）
        s.add(new Konva.Text({ x: 41, y: -10, width: 24, align: 'center', text: '合闸', fontSize: 11, fontStyle: 'bold', fill: '#1a252f' }));
        s.add(new Konva.Text({ x: 126, y: -10, width: 24, align: 'center', text: '分闸', fontSize: 11, fontStyle: 'bold', fill: '#1a252f' }));
        // 左侧端口标签
        s.add(new Konva.Text({ x: 10, y: this._leftPorts.start_a + 4, text: '起动', fontSize: 11, fill: '#5a6a75' }));
        s.add(new Konva.Text({ x: 10, y: this._leftPorts.stop_a+ 4, text: '停止', fontSize: 11, fill: '#5a6a75' }));
        s.add(new Konva.Text({ x: 10, y: this._leftPorts.spd_p + 4, text: '调速', fontSize: 12, fill: '#5a6a75' }));
        // 底部电源标签（居中于两个电源端口之间）
        s.add(new Konva.Text({ x: 94, y: this.height - 16, text: '电源', fontSize: 11, fill: '#5a6a75' }));
        if (this.cache === 'fixed') {
            try {
                const r = this._staticGroup.getClientRect({ relativeTo: this._staticGroup });
                if (r && r.width > 0 && r.height > 0) {
                    this._staticGroup.cache({
                        x: r.x, y: r.y, width: Math.ceil(r.width), height: Math.ceil(r.height),
                    });
                }
            } catch (e) { /* ignore */ }
        }
    }

    // ═══════════════════════════════════════════
    // 动态节点
    // ═══════════════════════════════════════════

    _createDynamicNodes() {
        this._ui = this._createUI();
    }

    _createUI() {
        const d = this._dynamicGroup;
        const ui = {};

        // LCD 3 行文字
        const mkLcd = (y) => {
            const t = new Konva.Text({
                x: this._lcd.x + 6, y, fontSize: 14,
                fontFamily: 'monospace', fontStyle: 'bold',
                fill: '#00ff88', text: '',
            });
            d.add(t);
            return t;
        };
        ui.lcd = this._lcdRows.map(mkLcd);

        // CLOSE / OPEN 圆形带灯按钮（灯 = 整圆）
        ui.closeFace = this._mkCircleBtn(d, this._btnClose, '合闸', '#1d8a4e', '#166a3a', '#2ecc71');
        ui.openFace  = this._mkCircleBtn(d, this._btnOpen, '分闸', '#922b21', '#7a1f18', '#e74c3c');

        // START / STOP 圆钮
        ui.startFace = this._mkCircleBtn(d, this._btnStart, '起动', '#2e7d32', '#1d5f26');
        ui.stopFace  = this._mkCircleBtn(d, this._btnStop, '停止', '#922b21', '#7a1f18');

        // RUNNING 运行灯（初始灰色，点亮后白色）
        const runLed = new Konva.Circle({ x: this._runLed.x, y: this._runLed.y, radius: this._runLed.r, fill: '#8a8a8a', stroke: '#222', strokeWidth: 1 });
        d.add(runLed);
        ui.runLed = runLed;

        // 调速旋钮（瞬时偏转回弹）
        const knobG = new Konva.Group({ x: this._knob.x, y: this._knob.y });
        const knobDisk = new Konva.Circle({ radius: this._knob.r, fill: '#7f8c8d', stroke: '#4a5a63', strokeWidth: 2 });
        const knobPtr = new Konva.Line({
            points: [0, 0, 0, -(this._knob.r - 3)], stroke: '#ffffff', strokeWidth: 2.5, lineCap: 'round',
        });
        knobG.add(knobDisk, knobPtr);
        d.add(knobG);
        ui.knobPtr = knobPtr;
        ui.knobDisk = knobDisk;

        // 交互绑定
        const hold = (node, onDown, onUp) => {
            node.on('mousedown touchstart', (e) => { e.cancelBubble = true; onDown(); });
            node.on('mouseup touchend mouseleave', () => { onUp(); });
        };
        hold(ui.closeFace.g, () => { this._closePressed = true; },  () => { this._closePressed = false; });
        hold(ui.openFace.g,  () => { this._openPressed = true; },   () => { this._openPressed = false; });
        hold(ui.startFace.g, () => { this._startPressed = true; },  () => { this._startPressed = false; });
        hold(ui.stopFace.g,  () => { this._stopPressed = true; },   () => { this._stopPressed = false; });

        ui.knobDisk.on('mousedown touchstart', (e) => {
            e.cancelBubble = true;
            const pos = this.sys.stage.getPointerPosition();
            const abs = knobG.getAbsolutePosition();
            const dir = (pos && pos.x > abs.x) ? 1 : -1;
            this._spdVolt = dir;
            const onUp = () => {
                this._spdVolt = 0;
                window.removeEventListener('mouseup', onUp);
                window.removeEventListener('touchend', onUp);
            };
            window.addEventListener('mouseup', onUp);
            window.addEventListener('touchend', onUp);
        });

        return ui;
    }

    _mkCircleBtn(d, def, label, base, dark, lit) {
        const g = new Konva.Group({ x: def.x, y: def.y });
        const face = new Konva.Circle({
            radius: def.r, fill: base, stroke: '#1a252f', strokeWidth: 1,
        });
        const txt = new Konva.Text({
            x: -def.r, y: -def.r, width: def.r * 2, height: def.r * 2,
            align: 'center', verticalAlign: 'middle',
            text: label, fontSize: 12, fontStyle: 'bold', fill: '#ffffff',
        });
        g.add(face, txt);
        d.add(g);
        face._base = base;
        face._dark = dark;
        face._lit  = lit || base;
        return { g, face, txt, dark, lit: lit || base };
    }

    _bindInteraction() { /* 交互已在 _createUI 绑定 */ }

    _touchDirty() {
        this.markDirty();
        if (this.sys && typeof this.sys.requestRedraw === 'function') this.sys.requestRedraw();
    }

    // ═══════════════════════════════════════════
    // 端口
    // ═══════════════════════════════════════════

    _addPanelPorts() {
        const tp = this._topPorts, lp = this._leftPorts, bp = this._bottomPorts;
        const h = this.height - 2;
        this.addPort(tp.open_a, 2, 'open_a',  'wire', 'p');
        this.addPort(tp.open_b, 2, 'open_b',  'wire');
        this.addPort(tp.close_a, 2, 'close_a', 'wire', 'p');
        this.addPort(tp.close_b, 2, 'close_b', 'wire');
        this.addPort(2, lp.start_a, 'start_a', 'wire');
        this.addPort(2, lp.start_b, 'start_b', 'wire');
        this.addPort(2, lp.stop_a, 'stop_a', 'wire');
        this.addPort(2, lp.stop_b, 'stop_b', 'wire');
        this.addPort(2, lp.spd_p, 'spd_p', 'wire', 'p');
        this.addPort(2, lp.spd_n, 'spd_n', 'wire', 'n');
        this.addPort(bp.p24_p, h, 'p24_p', 'wire', 'p');
        this.addPort(bp.p24_n, h, 'p24_n', 'wire');
    }

    // ═══════════════════════════════════════════
    // 仿真主循环
    // ═══════════════════════════════════════════

    tick(dt) {
        this._sensePower();
        this._sampleGen();
        this._updateLCD();
        this._updateButtons();
        this._updateKnobs();
        this.markDirty();
        if (this.sys && typeof this.sys.requestRedraw === 'function') this.sys.requestRedraw();
    }

    _sensePower() {
        const solver = this.sys && this.sys.voltageSolver;
        if (!solver) return;
        const v = this.sys.getVoltageBetween(`${this.id}_wire_p24_p`, `${this.id}_wire_p24_n`);
        if (v !== undefined && isFinite(v) && v > 1) {
            this._powerTimer = Math.min(3, this._powerTimer + 1);
        } else {
            this._powerTimer = 0;
        }
        this._powered = this._powerTimer >= 3;
    }

    _sampleGen() {
        const solver = this.sys && this.sys.voltageSolver;
        if (!solver || solver.globalIterCount === this._lastSolverIter) return;
        this._lastSolverIter = solver.globalIterCount;
        this._sample = this._snapshot(this.genId, this.qfId);
    }

    _snapshot(genId, qfId) {
        const gen = genId && this.sys.comps[genId] ? this.sys.comps[genId] : null;
        if (!gen) return null;
        const s = { on: !!gen.isOn, qfOn: null };
        const qf = qfId && this.sys.comps[qfId] ? this.sys.comps[qfId] : null;
        if (qf && typeof qf._state === 'string') s.qfOn = qf._state === 'on';
        if (s.on) {
            const lv = gen.getLineVoltage ? gen.getLineVoltage() : 0;
            s.lineV = lv;
            s.freq  = (gen._freqOut ?? gen.freq) || 0;
            s.I = gen._rmsI || 0;
            s.P = gen._pwr || 0;
            s.cos = s.I > 0 ? Math.min(1, Math.max(-1, (s.P * 1000) / (Math.sqrt(3) * s.lineV * s.I))) : 0;
        }
        return s;
    }

    _lcdLines(s) {
        if (!s) return ['--', '--', '--'];
        if (!s.on) return ['V--  F--', 'I--  P--', 'COS--'];
        return [
            `V ${s.lineV.toFixed(1)}V  F ${s.freq.toFixed(1)}Hz`,
            `I ${s.I > 100 ? s.I.toFixed(0) : s.I.toFixed(1)}A  P ${s.P > 100 ? s.P.toFixed(0) : s.P.toFixed(1)}kW`,
            `COSφ ${s.cos.toFixed(2)}`,
        ];
    }

    _updateLCD() {
        if (!this._ui) return;
        const lines = this._powered ? this._lcdLines(this._sample) : ['--', '--', '--'];
        this._ui.lcd.forEach((t, i) => t.text(lines[i]));
    }

    _updateButtons() {
        const ui = this._ui;
        if (!ui) return;
        const s = this._sample;
        const qfOn = s ? s.qfOn : null;
        // 合闸：未合闸暗绿，合闸亮绿（按下更暗）
        ui.closeFace.face.fill(this._closePressed ? ui.closeFace.face._dark : (qfOn ? ui.closeFace.face._lit : ui.closeFace.face._base));
        // 分闸：已运行未合闸亮红，其它情况暗红
        ui.openFace.face.fill(this._openPressed ? ui.openFace.face._dark : (s && s.on && qfOn === false ? ui.openFace.face._lit : ui.openFace.face._base));
        // 起动/停止：按下变暗
        ui.startFace.face.fill(this._startPressed ? ui.startFace.face._dark : ui.startFace.face._base);
        ui.stopFace.face.fill(this._stopPressed ? ui.stopFace.face._dark : ui.stopFace.face._base);
        // 运行灯：初始灰色，点亮后白色
        ui.runLed.fill(s && s.on ? '#ffffff' : '#8a8a8a');
    }

    _updateKnobs() {
        if (!this._ui || !this._ui.knobPtr) return;
        const ptr = this._ui.knobPtr;
        const target = this._spdVolt * 45;
        if (ptr._tw) ptr._tw.destroy();
        ptr._tw = new Konva.Tween({ node: ptr, rotation: target, duration: 0.12 });
        ptr._tw.play();
    }

    // ═══════════════════════════════════════════
    // 公开 API
    // ═══════════════════════════════════════════

    isPowered() { return this._powered; }
    getSpdVolt() { return this._spdVolt; }
    isStartPressed() { return this._startPressed; }
    isStopPressed()  { return this._stopPressed; }
    isClosePressed() { return this._closePressed; }
    isOpenPressed()  { return this._openPressed; }

    getConfigFields() {
        return [
            { label: '发电机 ID', key: 'genId', type: 'text' },
            { label: '主开关 ID', key: 'qfId', type: 'text' },
        ];
    }

    onConfigUpdate(cfg) {
        if (cfg.genId !== undefined) this.genId = cfg.genId;
        if (cfg.qfId  !== undefined) this.qfId  = cfg.qfId;
        this.config.genId = this.genId;
        this.config.qfId  = this.qfId;
        this.markDirty();
    }
}
