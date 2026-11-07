import { BaseComponent } from './BaseComponent.js';

/**
 * CompressorLocalPanel —— 空压机机旁控制面板（紧凑型，含真电气信号触点）
 *
 * 布局（scale=1，高度压缩、宽度约 2/3，取消电流表与小时计，指示灯/旋钮缩小）：
 *   ① 过电流 / 温度 / 油压 三个红色报警指示灯（面板内部逻辑，随保护信号点亮）；
 *   ② 运行（绿） / 电机加热（蓝）指示灯；
 *   ③ 「空压机控制」旋钮（手动 / 关 / 遥控）＋「电机加热」旋钮（开 / 关）；
 *   ④ 底部 6 个开关端口（sw_com / man_o / rem_o / poc_o / ptp_o / pop_o），带中文标注。
 *
 * 电气信号（真触点，供 CircuitUtils / DeviceStamps 读取通断）：
 *   · 「手动」常开 sw_com↔man_o（接触器线圈驱动触点）
 *   · 「遥控」常开 sw_com↔rem_o，保护触头 sw_com↔poc_o/ptp_o/pop_o（接 PLC 输入）
 *   报警灯、电机加热开关/灯、运行灯均为面板内部逻辑，不对外引线。
 */
export class CompressorLocalPanel extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.W = config.W || 250;
        this.H = config.H || 240;
        this.type = 'compressor_panel';
        this.special = 'clp';
        this.cache = 'fixed';

        this._initGroups();

        this.ownerId = config.ownerId || null;        // 被控空压机
        this.contactorId = config.contactorId || null; // 对应接触器设备 id（KM1/KM2）
        this.label = config.label || '';
        this.ctrlMode = config.ctrlMode || 'off';       // manual | off | remote
        this.heaterOn = !!config.heaterOn;
        this.signalContacts = [
            ['sw_com', 'man_o', 'manual'],
            ['sw_com', 'rem_o', 'remote'],
            ['sw_com', 'poc_o', 'poc'],
            ['sw_com', 'ptp_o', 'ptp'],
            ['sw_com', 'pop_o', 'pop'],
        ];
        this.protection = { oc: false, temp: false, op: false };
        this.alarms = { oc: false, temp: false, op: false };
        this._running = false;

        this._draw();
        this._bind();
        this._registerPorts();

        this.config = {
            id: this.id, ownerId: this.ownerId, contactorId: this.contactorId,
            label: this.label, ctrlMode: this.ctrlMode, heaterOn: this.heaterOn,
        };
        this._syncVisuals();
    }

    // ═══════════════════════════════════════════════════════
    // 绘制（紧凑布局）
    // ═══════════════════════════════════════════════════════

    _draw() {
        const g = this._staticGroup;
        g.add(new Konva.Rect({
            x: 0, y: 0, width: this.W, height: this.H,
            fill: '#e9e7e0', stroke: '#8a8f94', strokeWidth: 2, cornerRadius: 6,
        }));

        // ① 报警指示灯
        this._alarmLamps = {};
        [
            { key: 'oc', label: '过电流', x: 45 },
            { key: 'temp', label: '温度', x: 125 },
            { key: 'op', label: '油压', x: 205 },
        ].forEach(col => {
            this._labelBox(col.x, 16, col.label, 54, 20);
            this._alarmLamps[col.key] = this._roundLamp(col.x, 42, 10, '#7a1414');
        });

        // ② 运行 / 电机加热
        this._labelBox(82, 68, '运行', 58, 20);
        this._labelBox(168, 68, '电机加热', 62, 20);
        this._runLamp = this._roundLamp(82, 94, 10, '#0c4a0c');
        this._heatLamp = this._roundLamp(168, 94, 10, '#0b3f7a');

        // ③ 旋钮（紧跟指示灯，去掉按钮上方空白；整体下移 10px）
        this._knobBox(8, 110, 116, 110, '空压机控制');
        this._knobBox(128, 110, 114, 110, '电机加热');
        this._ctrlCenter = { x: 66, y: 178 };
        this._heatCenter = { x: 185, y: 178 };
        this._ctrlKnob = this._drawKnob(66, 178, 24, ['手动', '关', '遥控']);
        this._heatKnob = this._drawKnob(185, 178, 24, ['开', '关']);

        // 标牌（已取消 103 标签）
        g.add(new Konva.Text({
            x: 0, y: this.H - 14, width: this.W,
            text: this.label || '机旁控制面板', fontSize: 11, fontStyle: 'bold',
            fill: '#555', align: 'center',
        }));
    }

    _labelBox(cx, cy, text, w = 58, h = 22) {
        const g = this._staticGroup;
        g.add(new Konva.Rect({ x: cx - w / 2, y: cy - h / 2, width: w, height: h, fill: '#fff', stroke: '#333', strokeWidth: 1.2 }));
        g.add(new Konva.Text({ x: cx - w / 2, y: cy - 7, width: w, text, fontSize: 12, fill: '#222', align: 'center' }));
    }

    _roundLamp(cx, cy, r, offColor) {
        const g = this._staticGroup;
        g.add(new Konva.Circle({ x: cx, y: cy, radius: r + 3, fill: '#c9c9c9', stroke: '#777', strokeWidth: 1.2 }));
        const lamp = new Konva.Circle({ x: cx, y: cy, radius: r, fill: offColor, stroke: '#333', strokeWidth: 1.2 });
        this._dynamicGroup.add(lamp);
        return lamp;
    }

    _knobBox(x, y, w, h, title) {
        const g = this._staticGroup;
        g.add(new Konva.Rect({ x, y, width: w, height: h, fill: '#fff', stroke: '#333', strokeWidth: 1.2 }));
        g.add(new Konva.Text({ x, y: y + 4, width: w, text: title, fontSize: 12, fill: '#222', align: 'center' }));
    }

    _drawKnob(cx, cy, r, positions) {
        const g = this._staticGroup;
        const angles = positions.length === 3 ? [-120, 0, 120] : [-90, 0];
        positions.forEach((txt, i) => {
            const a = angles[i] * Math.PI / 180;
            const lx = cx + Math.sin(a) * (r + 20);
            const ly = cy - Math.cos(a) * (r + 20);
            g.add(new Konva.Text({ x: lx - 20, y: ly - 6, width: 40, text: txt, fontSize: 11, fontStyle: 'bold', fill: '#222', align: 'center' }));
        });
        g.add(new Konva.Circle({ x: cx, y: cy, radius: r + 4, fill: '#2b2f33', stroke: '#111', strokeWidth: 1.5 }));
        const knob = new Konva.Group({ x: cx, y: cy });
        knob.add(new Konva.Circle({ radius: r, fill: '#3d4145', stroke: '#111', strokeWidth: 1.5 }));
        knob.add(new Konva.Rect({ x: -3, y: -r, width: 6, height: r * 0.66, fill: '#f5f5f5', cornerRadius: 2 }));
        this._dynamicGroup.add(knob);
        return knob;
    }

    _registerPorts() {
        const portDefs = [
            { id: 'sw_com', label: '' },        // 去掉 24V 端子标签
            { id: 'man_o', label: '起停' },
            { id: 'rem_o', label: '遥控' },
            { id: 'poc_o', label: '过流' },
            { id: 'ptp_o', label: '温度' },
            { id: 'pop_o', label: '油压' },
        ];
        const n = portDefs.length;
        const x0 = 28, x1 = this.W - 28;
        portDefs.forEach((pd, i) => {
            const x = x0 + (x1 - x0) * (i / (n - 1));
            this.addPort(x, this.H, pd.id, 'wire');
            if (pd.label) {
                this._staticGroup.add(new Konva.Text({
                    x: x - 22, y: this.H + 5, width: 44,
                    text: pd.label, fontSize: 12, fontStyle: 'bold',
                    fill: '#333', align: 'center',
                }));
            }
        });
    }

    // ═══════════════════════════════════════════════════════
    // 交互
    // ═══════════════════════════════════════════════════════

    _bind() {
        this.addClickablePart('knob-ctrl', 32, 144, 68, 68);
        this.addClickablePart('knob-heater', 151, 144, 68, 68);
        this.addClickablePart('lamp-oc', 29, 26, 32, 32);
        this.addClickablePart('lamp-temp', 109, 26, 32, 32);
        this.addClickablePart('lamp-op', 189, 26, 32, 32);
        this.addClickablePart('lamp-run', 66, 78, 32, 32);
        this.addClickablePart('lamp-heat', 152, 78, 32, 32);

        const hk = this.getClickablePartNode('knob-ctrl');
        if (hk) hk.on('click tap', (e) => this._onKnobClick(e, 'ctrl'));
        const hh = this.getClickablePartNode('knob-heater');
        if (hh) hh.on('click tap', (e) => this._onKnobClick(e, 'heater'));
    }

    /** 依据点击落在旋钮左/右半区决定逆/顺时针切换档位 */
    _onKnobClick(e, which) {
        let dir = 1;   // 默认顺时针（合成点击无真实指针时）
        if (e && e.evt && typeof e.evt.clientX === 'number') {
            try {
                const ptr = this.sys.stage.getPointerPosition();
                const cLocal = which === 'ctrl' ? this._ctrlCenter : this._heatCenter;
                const c = this.group.getAbsoluteTransform().point(cLocal);
                if (ptr && c) dir = (ptr.x < c.x) ? -1 : 1;   // 左半=逆时针，右半=顺时针
            } catch (err) { dir = 1; }
        }
        if (which === 'ctrl') this.rotateCtrl(dir);
        else this.rotateHeater(dir);
    }

    /** dir=+1 顺时针（下一档）；dir=-1 逆时针（上一档） */
    rotateCtrl(dir) {
        const order = ['manual', 'off', 'remote'];
        let i = order.indexOf(this.ctrlMode);
        i = (i + (dir >= 0 ? 1 : -1) + order.length) % order.length;
        this.ctrlMode = order[i];
        this._syncVisuals();
    }

    rotateHeater(dir) {
        // 两档开关：任意方向点击均切换
        this.heaterOn = !this.heaterOn;
        this._syncVisuals();
    }

    cycleCtrlMode() {
        const order = ['manual', 'off', 'remote'];
        const i = order.indexOf(this.ctrlMode);
        this.ctrlMode = order[(i + 1) % order.length];
        this._syncVisuals();
    }

    toggleHeater() {
        this.heaterOn = !this.heaterOn;
        this._syncVisuals();
    }

    // ═══════════════════════════════════════════════════════
    // 电气信号
    // ═══════════════════════════════════════════════════════

    getSignalResistance(key) {
        const OPEN = 1e9, CLOSE = 0.01;
        switch (key) {
            case 'manual': return this.ctrlMode === 'manual' ? CLOSE : OPEN;   // 常开
            case 'remote': return this.ctrlMode === 'remote' ? CLOSE : OPEN;   // 常开
            case 'poc':    return this.protection.oc ? CLOSE : OPEN;
            case 'ptp':    return this.protection.temp ? CLOSE : OPEN;
            case 'pop':    return this.protection.op ? CLOSE : OPEN;
            default:       return OPEN;
        }
    }

    setProtection(key, on) {
        if (key in this.protection) { this.protection[key] = !!on; }
    }

    // ═══════════════════════════════════════════════════════
    // 视觉同步
    // ═══════════════════════════════════════════════════════

    _ctrlAngle() {
        return this.ctrlMode === 'manual' ? -120 : (this.ctrlMode === 'off' ? 0 : 120);
    }

    _syncVisuals() {
        if (this._ctrlKnob) this._ctrlKnob.rotation(this._ctrlAngle());
        if (this._heatKnob) this._heatKnob.rotation(this.heaterOn ? 0 : -90);
        const set = (lamp, on, onC, offC) => { if (lamp) lamp.fill(on ? onC : offC); };
        set(this._runLamp, this._running, '#25d425', '#0c4a0c');
        // 电机加热灯：仅在加热开关打开且空压机未运行时点亮（运行时空压机机身发热，加热器停用）
        set(this._heatLamp, this.heaterOn && !this._running, '#2196f3', '#0b3f7a');
        set(this._alarmLamps && this._alarmLamps.oc, this.alarms.oc, '#ff2020', '#7a1414');
        set(this._alarmLamps && this._alarmLamps.temp, this.alarms.temp, '#ff2020', '#7a1414');
        set(this._alarmLamps && this._alarmLamps.op, this.alarms.op, '#ff2020', '#7a1414');
        if (this.sys && this.sys.requestRedraw) this.sys.requestRedraw();
    }

    // ═══════════════════════════════════════════════════════
    // tick
    // ═══════════════════════════════════════════════════════

    tick(dt) {
        this._acc = (this._acc || 0) + dt;
        if (this._acc < 0.15) return;
        this._acc = 0;

        let run = false;
        if (this.contactorId && this.sys.deviceManager) {
            const km = this.sys.deviceManager.get(this.contactorId);
            if (km && typeof km.isPickup === 'function') run = km.isPickup();
        }
        if (!run) {
            const ac = this.ownerId && this.sys.comps[this.ownerId];
            if (ac && !this.contactorId) run = !!ac.running;
        }
        this._running = run;

        // 报警灯：内部逻辑（保护信号置位即点亮，与保护触头输入 PLC 同步）
        this.alarms.oc = !!this.protection.oc;
        this.alarms.temp = !!this.protection.temp;
        this.alarms.op = !!this.protection.op;

        this._syncVisuals();
    }

    // ═══════════════════════════════════════════════════════
    // API / 配置
    // ═══════════════════════════════════════════════════════

    setCtrlMode(m) { if (['manual', 'off', 'remote'].includes(m)) { this.ctrlMode = m; this._syncVisuals(); } }
    getCtrlMode() { return this.ctrlMode; }
    setHeater(on) { this.heaterOn = !!on; this._syncVisuals(); }
    isHeaterOn() { return this.heaterOn; }
    clearAlarms() { this.protection = { oc: false, temp: false, op: false }; }

    getConfigFields() {
        return [
            { label: '器件名称 (ID)', key: 'id', type: 'text' },
            { label: '被控空压机 ID', key: 'ownerId', type: 'text' },
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

export default CompressorLocalPanel;
