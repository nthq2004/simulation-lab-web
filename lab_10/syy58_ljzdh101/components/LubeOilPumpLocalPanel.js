import { BaseComponent } from './BaseComponent.js';

/**
 * LubeOilPumpLocalPanel —— 滑油泵机旁控制面板（紧凑型，含真电气信号触点）
 *
 * 布局：
 *   ① 第一排 3 个圆形指示灯：白色「电源」、绿色「运行」、红色「过载」；
 *   ② 第二排：绿色「起动」按钮、红色「停止」按钮、本地/遥控转换开关；
 *   ③ 底部 4 个开关端口（sw_com / loc_o / rem_o / flt_o），带中文标注。
 *
 * 电气信号（真触点，供 CircuitUtils / DeviceStamps 读取通断）：
 *   · 「本地」运行时 sw_com↔loc_o 闭合（面板内部自锁：起动置位、停止/切遥控复位）；
 *   · 「遥控」位 sw_com↔rem_o 闭合（送 PLC 判定机旁遥控）；
 *   · 故障 sw_com↔flt_o 闭合（送 EM DI08）。
 *   电源灯/运行灯/故障灯为面板内部逻辑，不对外引线。
 */
export class LubeOilPumpLocalPanel extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.W = config.W || 210;   // 原 250 − 40
        this.H = config.H || 144;   // 原 240 × 3/5
        this.type = 'compressor_panel';   // 复用面板信号触点的电气 stamp（signalContacts）
        this.special = 'lolp';
        this.cache = 'fixed';

        this._initGroups();

        this.ownerId = config.ownerId || null;         // 被控滑油泵
        this.contactorId = config.contactorId || null; // 对应接触器 deviceid（KM1/KM2）
        this.label = config.label || '';
        this.mode = config.mode || 'local';            // 默认「本地」；local | remote
        this.signalContacts = [
            ['sw_com', 'loc_o', 'local'],
            ['sw_com', 'rem_o', 'remote'],
            ['sw_com', 'flt_o', 'fault'],
        ];
        this.protection = { fault: false };
        this._latched = false;       // 本地运行自锁
        this._running = false;
        this._powered = false;

        this._draw();
        this._bind();
        this._registerPorts();

        this.config = {
            id: this.id, ownerId: this.ownerId, contactorId: this.contactorId,
            label: this.label, mode: this.mode,
        };
        this._syncVisuals();
    }

    // ═══════════════════════════════════════════════════════
    // 绘制
    // ═══════════════════════════════════════════════════════

    _draw() {
        const g = this._staticGroup;
        g.add(new Konva.Rect({
            x: 0, y: 0, width: this.W, height: this.H,
            fill: '#e9e7e0', stroke: '#8a8f94', strokeWidth: 2, cornerRadius: 6,
        }));

        // ① 第一排指示灯
        this._labelCell(45, 16, '电源', 46);
        this._labelCell(105, 16, '运行', 46);
        this._labelCell(165, 16, '过载', 46);
        this._pwrLamp = this._roundLamp(45, 42, 11, '#9a9a9a');
        this._runLamp = this._roundLamp(105, 42, 11, '#0c4a0c');
        this._fltLamp = this._roundLamp(165, 42, 11, '#7a1414');

        // ② 第二排操作件（较上一版整体上移 6px）
        this._btnStart = this._roundButton(45, 88, 15, '#1f9d33');
        this._btnStop = this._roundButton(105, 88, 15, '#c0392b');
        this._selKnob = this._drawSelector(170, 88, 17);

        this._labelCell(45, 120, '起动', 44);
        this._labelCell(105, 120, '停止', 44);
        // 转换开关档位标签（动态，随模式变化）
        this._staticGroup.add(new Konva.Rect({ x: 170 - 28, y: 120 - 9, width: 56, height: 18, fill: '#fff', stroke: '#333', strokeWidth: 1 }));
        this._selText = new Konva.Text({
            x: 170 - 28, y: 120 - 6, width: 56,
            text: this.mode === 'local' ? '本地' : '遥控', fontSize: 12, fill: '#222', align: 'center',
        });
        this._dynamicGroup.add(this._selText);

        // 标牌
        g.add(new Konva.Text({
            x: 0, y: this.H - 14, width: this.W,
            text: this.label || '机旁滑油控制', fontSize: 11, fontStyle: 'bold',
            fill: '#555', align: 'center',
        }));
    }

    _labelCell(cx, cy, text, w = 56) {
        const g = this._staticGroup;
        g.add(new Konva.Rect({ x: cx - w / 2, y: cy - 9, width: w, height: 18, fill: '#fff', stroke: '#333', strokeWidth: 1 }));
        const t = new Konva.Text({ x: cx - w / 2, y: cy - 6, width: w, text, fontSize: 12, fill: '#222', align: 'center' });
        g.add(t);
        return t;
    }

    _roundLamp(cx, cy, r, offColor) {
        const g = this._staticGroup;
        g.add(new Konva.Circle({ x: cx, y: cy, radius: r + 3, fill: '#c9c9c9', stroke: '#777', strokeWidth: 1.2 }));
        const lamp = new Konva.Circle({ x: cx, y: cy, radius: r, fill: offColor, stroke: '#333', strokeWidth: 1.2 });
        this._dynamicGroup.add(lamp);
        return lamp;
    }

    _roundButton(cx, cy, r, color) {
        const g = this._staticGroup;
        g.add(new Konva.Circle({ x: cx, y: cy, radius: r + 4, fill: '#2a2f34', stroke: '#141618', strokeWidth: 1.5 }));
        const lamp = new Konva.Circle({ x: cx, y: cy, radius: r, fill: color, stroke: '#111', strokeWidth: 1 });
        this._dynamicGroup.add(lamp);
        return { lamp, base: color };
    }

    _drawSelector(cx, cy, r) {
        const g = this._staticGroup;
        g.add(new Konva.Circle({ x: cx, y: cy, radius: r + 4, fill: '#e6e6e6', stroke: '#999', strokeWidth: 2 }));
        const knob = new Konva.Group({ x: cx, y: cy });
        knob.add(new Konva.Circle({ radius: r, fill: '#3d4145', stroke: '#111', strokeWidth: 1.5 }));
        knob.add(new Konva.Rect({ x: -3, y: -r + 2, width: 6, height: r * 0.62, fill: '#f5f5f5', cornerRadius: 2 }));
        this._dynamicGroup.add(knob);
        return knob;
    }

    _registerPorts() {
        const portDefs = [
            { id: 'sw_com', label: '' },
            { id: 'loc_o', label: '本地' },
            { id: 'rem_o', label: '遥控' },
            { id: 'flt_o', label: '过载' },
        ];
        const n = portDefs.length;
        const x0 = 34, x1 = this.W - 34;
        portDefs.forEach((pd, i) => {
            const x = x0 + (x1 - x0) * (i / (n - 1));
            this.addPort(x, this.H, pd.id, 'wire');
            if (pd.label) {
                this._staticGroup.add(new Konva.Text({
                    x: x - 22, y: this.H + 5, width: 44, text: pd.label,
                    fontSize: 12, fontStyle: 'bold', fill: '#333', align: 'center',
                }));
            }
        });
    }

    // ═══════════════════════════════════════════════════════
    // 交互
    // ═══════════════════════════════════════════════════════

    _bind() {
        this.addClickablePart('lamp-pwr', 29, 26, 32, 32);
        this.addClickablePart('lamp-run', 89, 26, 32, 32);
        this.addClickablePart('lamp-flt', 149, 26, 32, 32);
        this.addClickablePart('btn-start', 27, 70, 36, 36);
        this.addClickablePart('btn-stop', 87, 70, 36, 36);
        this.addClickablePart('sel-lr', 150, 68, 40, 40);

        const hs = this.getClickablePartNode('btn-start');
        if (hs) hs.on('click tap', () => this.pressStart());
        const ht = this.getClickablePartNode('btn-stop');
        if (ht) ht.on('click tap', () => this.pressStop());
        const hk = this.getClickablePartNode('sel-lr');
        if (hk) hk.on('click tap', () => this.toggleMode());
    }

    /** 起动按钮（本地模式下置位运行自锁；遥控模式下无效） */
    pressStart() {
        if (this.mode !== 'local' || this.protection.fault) return;
        this._latched = true;
        this._syncVisuals();
    }
    releaseStart() { /* 按钮点动，无需处理 */ }

    /** 停止按钮（本地模式下复位运行自锁） */
    pressStop() {
        this._latched = false;
        this._syncVisuals();
    }
    releaseStop() { /* 按钮点动，无需处理 */ }

    toggleMode() { this.setMode(this.mode === 'local' ? 'remote' : 'local'); }

    setMode(m) {
        if (m !== 'local' && m !== 'remote') return;
        this.mode = m;
        if (m !== 'local') this._latched = false;
        this._syncVisuals();
    }
    getMode() { return this.mode; }

    // ═══════════════════════════════════════════════════════
    // 电气信号
    // ═══════════════════════════════════════════════════════

    getSignalResistance(key) {
        const OPEN = 1e9, CLOSE = 0.01;
        switch (key) {
            case 'local':  return (this.mode === 'local' && this._latched) ? CLOSE : OPEN; // 本地运行触点（自锁）
            case 'remote': return this.mode === 'remote' ? CLOSE : OPEN;                   // 机旁遥控触点
            case 'fault':  return this.protection.fault ? CLOSE : OPEN;                     // 故障触点
            default:       return OPEN;
        }
    }

    setProtection(key, on) {
        if (key in this.protection) {
            this.protection[key] = !!on;
            if (on) this._latched = false;
        }
    }
    clearAlarms() { this.protection = { fault: false }; }

    // ═══════════════════════════════════════════════════════
    // 视觉同步
    // ═══════════════════════════════════════════════════════

    _syncVisuals() {
        const set = (lamp, on, onC, offC) => { if (lamp) lamp.fill(on ? onC : offC); };
        set(this._pwrLamp, this._powered, '#ffffff', '#9a9a9a');
        set(this._runLamp, this._running, '#25d425', '#0c4a0c');
        set(this._fltLamp, this.protection.fault, '#ff2020', '#7a1414');
        if (this._selKnob) this._selKnob.rotation(this.mode === 'local' ? -45 : 45);
        if (this._selText) this._selText.text(this.mode === 'local' ? '本地' : '遥控');
        if (this._btnStart) this._btnStart.lamp.opacity(this.mode === 'local' ? 1 : 0.45);
        if (this.sys && this.sys.requestRedraw) this.sys.requestRedraw();
    }

    // ═══════════════════════════════════════════════════════
    // tick
    // ═══════════════════════════════════════════════════════

    tick(dt) {
        this._acc = (this._acc || 0) + dt;
        if (this._acc < 0.15) return;
        this._acc = 0;

        // 电源灯：sw_com 对地电压
        try {
            const v = this.sys.getVoltageBetween
                ? this.sys.getVoltageBetween(`${this.id}_wire_sw_com`, 'gnd0_wire_gnd') : undefined;
            if (v !== undefined && isFinite(v)) this._powered = Math.abs(v) > 5;
        } catch (e) { /* ignore */ }

        // 运行灯：接触器吸合 或 被控泵运行
        let run = false;
        if (this.contactorId && this.sys.deviceManager) {
            const km = this.sys.deviceManager.get(this.contactorId);
            if (km && typeof km.isPickup === 'function') run = km.isPickup();
        }
        if (!run && this.ownerId) {
            const p = this.sys.comps[this.ownerId];
            if (p && p.running) run = true;
        }
        this._running = run;

        this._syncVisuals();
    }

    // ═══════════════════════════════════════════════════════
    // API / 配置
    // ═══════════════════════════════════════════════════════

    getConfigFields() {
        return [
            { label: '器件名称 (ID)', key: 'id', type: 'text' },
            { label: '被控滑油泵 ID', key: 'ownerId', type: 'text' },
            { label: '接触器设备 ID', key: 'contactorId', type: 'text' },
            { label: '标签', key: 'label', type: 'text' },
        ];
    }

    onConfigUpdate(cfg) {
        if (cfg.id) this.id = cfg.id;
        if (cfg.ownerId) this.ownerId = cfg.ownerId;
        if (cfg.contactorId) this.contactorId = cfg.contactorId;
        if (cfg.label !== undefined) this.label = cfg.label;
        this.config = { ...this.config, ...cfg };
        this._syncVisuals();
    }

    destroy() { super.destroy?.(); }
}

export default LubeOilPumpLocalPanel;
