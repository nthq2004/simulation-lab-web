import { BaseComponent } from './BaseComponent.js';

/**
 * LubeOilPumpRemotePanel —— 滑油泵遥控面板（含真电气信号触点）
 *
 * 版式参照低压配电板「组合起动屏」上的滑油泵栏：
 *   ① 上排 4 个指示灯：电源 / 备用 / 运行 / 故障；
 *   ② 中排：加热器（关/开）转换开关、模式（手/自）转换开关；
 *   ③ 下排：绿色「启动」按钮、红色「停/复位」按钮。
 *
 * 电气信号（真触点）：
 *   · 「自动」常开 sw_com↔auto_o；
 *   · 点动「启动」sw_com↔sa_o、「停止」sw_com↔sb_o；
 *   · flt_i 为故障灯驱动输入（接 PLC 故障输出）。
 *   · 「加热器」为带灯开关：打到「加热」且滑油泵停机时，开关指示灯亮蓝色。
 */
export class LubeOilPumpRemotePanel extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.W = config.W || 210;
        this.H = config.H || 220;   // 原 300 − 60 − 20
        this.type = 'compressor_panel';   // 复用面板信号触点的电气 stamp（signalContacts）
        this.special = 'lorp';
        this.cache = 'fixed';

        this._initGroups();

        this.ownerId = config.ownerId || null;
        this.contactorId = config.contactorId || null;
        this.localPanelId = config.localPanelId || null;   // 对应机旁面板（判断是否处于遥控）
        this.title = config.title || '滑油泵遥控';
        this.auto = !!config.auto;                          // false = 手动, true = 自动
        this.heat = !!config.heat;
        this._startPressed = false;
        this._stopPressed = false;
        this._remoteActive = false;
        this._running = false;
        this._powered = false;
        this._faultNow = false;      // 当前故障信号（来自故障灯驱动输入 flt_i，由 PLC 锁存输出）
        this.protection = { fault: false };
        this.signalContacts = [
            ['sw_com', 'auto_o', 'auto'],
            ['sw_com', 'sa_o', 'start'],
            ['sw_com', 'sb_o', 'stop'],
        ];

        this._draw();
        this._bind();
        this._registerPorts();

        this.config = {
            id: this.id, ownerId: this.ownerId, contactorId: this.contactorId,
            localPanelId: this.localPanelId, title: this.title, auto: this.auto, heat: this.heat,
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
            fill: '#c9d3cd', stroke: '#7d8a83', strokeWidth: 2, cornerRadius: 5,
        }));

        // 标题栏
        g.add(new Konva.Rect({ x: 5, y: 5, width: this.W - 10, height: 28, fill: '#eef1ef', stroke: '#444', strokeWidth: 1.2 }));
        g.add(new Konva.Text({ x: 5, y: 12, width: this.W - 10, text: this.title, fontSize: 13, fontStyle: 'bold', fill: '#222', align: 'center' }));

        // ① 上排 4 灯
        const lx = [42, 90, 138, 186];
        const lbl = ['电源', '备用', '运行', '故障'];
        const base = ['#9a9a9a', '#7a5a00', '#0c4a0c', '#7a1414'];
        this._lamps = [];
        lx.forEach((x, i) => {
            g.add(new Konva.Text({ x: x - 22, y: 36, width: 44, text: lbl[i], fontSize: 11, fontStyle: 'bold', fill: '#1a252f', align: 'center' }));
            const lamp = this._roundLamp(x, 64, 11, base[i]);
            this._lamps.push(lamp);
        });

        // ② 中排：加热器 / 模式 转换开关
        g.add(new Konva.Text({ x: 26, y: 76, width: 70, text: '加热器', fontSize: 11, fontStyle: 'bold', fill: '#1a252f', align: 'center' }));
        this._heatKnob = this._drawSelector(61, 112, 17);
        // 加热带灯开关的指示灯（停机 + 加热时亮蓝色）
        this._heatLight = new Konva.Circle({ x: 61, y: 112, radius: 7, fill: '#2a2f34', stroke: '#111', strokeWidth: 1, listening: false });
        this._dynamicGroup.add(this._heatLight);
        g.add(new Konva.Text({ x: 26, y: 134, width: 34, text: '关', fontSize: 10, fill: '#333', align: 'center' }));
        g.add(new Konva.Text({ x: 62, y: 134, width: 34, text: '开', fontSize: 10, fill: '#333', align: 'center' }));

        g.add(new Konva.Text({ x: 114, y: 76, width: 70, text: '模式', fontSize: 11, fontStyle: 'bold', fill: '#1a252f', align: 'center' }));
        this._modeKnob = this._drawSelector(149, 112, 17);
        g.add(new Konva.Text({ x: 114, y: 134, width: 34, text: '手', fontSize: 10, fill: '#333', align: 'center' }));
        g.add(new Konva.Text({ x: 150, y: 134, width: 34, text: '自', fontSize: 10, fill: '#333', align: 'center' }));

        // ③ 下排：启动 / 停-复位
        this._btnStart = this._roundButton(61, 168, 16, '#1f9d33');
        this._btnStop = this._roundButton(149, 168, 16, '#c0392b');
        g.add(new Konva.Text({ x: 61 - 27, y: 192, width: 54, text: '启动', fontSize: 11, fontStyle: 'bold', fill: '#1a252f', align: 'center' }));
        g.add(new Konva.Text({ x: 149 - 27, y: 192, width: 54, text: '停/复位', fontSize: 11, fontStyle: 'bold', fill: '#1a252f', align: 'center' }));
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
            { id: 'sw_com', label: '24V' },
            { id: 'auto_o', label: '自动' },
            { id: 'sa_o', label: '启动' },
            { id: 'sb_o', label: '停止' },
            { id: 'flt_i', label: '故障' },
        ];
        const n = portDefs.length;
        const x0 = 18, x1 = this.W - 18;
        portDefs.forEach((pd, i) => {
            const x = x0 + (x1 - x0) * (i / (n - 1));
            this.addPort(x, this.H, pd.id, 'wire');
            this._staticGroup.add(new Konva.Text({
                x: x - 16, y: this.H + 4, width: 32, text: pd.label,
                fontSize: 10, fontStyle: 'bold', fill: '#333', align: 'center',
            }));
        });
    }

    // ═══════════════════════════════════════════════════════
    // 交互
    // ═══════════════════════════════════════════════════════

    _bind() {
        this.addClickablePart('lamps', 20, 48, 174, 24);
        this.addClickablePart('sel-heat', 41, 94, 40, 40);
        this.addClickablePart('sel-auto', 129, 94, 40, 40);
        this.addClickablePart('btn-run', 43, 150, 36, 36);
        this.addClickablePart('btn-stop', 131, 150, 36, 36);

        const hk = this.getClickablePartNode('sel-auto');
        if (hk) hk.on('click tap', () => { this.auto = !this.auto; this._syncVisuals(); });
        const hh = this.getClickablePartNode('sel-heat');
        if (hh) hh.on('click tap', () => { this.heat = !this.heat; this._syncVisuals(); });

        const hr = this.getClickablePartNode('btn-run');
        if (hr) {
            hr.on('mousedown touchstart', () => { this._startPressed = true; });
            hr.on('mouseup mouseleave touchend', () => { this._startPressed = false; });
        }
        const hs = this.getClickablePartNode('btn-stop');
        if (hs) {
            hs.on('mousedown touchstart', () => { this._stopPressed = true; });
            hs.on('mouseup mouseleave touchend', () => { this._stopPressed = false; });
        }
    }

    /** 启动按钮（起动信号输出；故障锁存由 PLC 程序禁止） */
    pressStart() { this._startPressed = true; }
    releaseStart() { this._startPressed = false; }
    /** 停/复位按钮（停止信号；同时作为故障锁存的复位输入送 PLC） */
    pressStop() { this._stopPressed = true; }
    releaseStop() { this._stopPressed = false; }

    setAuto(on) { this.auto = !!on; this._syncVisuals(); }
    isAuto() { return this.auto; }

    // ═══════════════════════════════════════════════════════
    // 电气信号
    // ═══════════════════════════════════════════════════════

    getSignalResistance(key) {
        const OPEN = 1e9, CLOSE = 0.01;
        switch (key) {
            case 'auto':  return this.auto ? CLOSE : OPEN;
            case 'start': return this._startPressed ? CLOSE : OPEN;
            case 'stop':  return this._stopPressed ? CLOSE : OPEN;
            default:      return OPEN;
        }
    }

    // ═══════════════════════════════════════════════════════
    // 视觉同步
    // ═══════════════════════════════════════════════════════

    _syncVisuals() {
        const set = (lamp, on, onC, offC) => { if (lamp) lamp.fill(on ? onC : offC); };
        set(this._lamps && this._lamps[0], this._powered, '#ffffff', '#9a9a9a');           // 电源
        set(this._lamps && this._lamps[1], this._remoteActive && this.auto && !this._running, '#f4c430', '#7a5a00'); // 备用
        set(this._lamps && this._lamps[2], this._running, '#25d425', '#0c4a0c');             // 运行
        set(this._lamps && this._lamps[3], this._faultLamp(), '#ff2020', '#7a1414');          // 故障
        if (this._heatKnob) this._heatKnob.rotation(this.heat ? 45 : -45);
        if (this._modeKnob) this._modeKnob.rotation(this.auto ? 45 : -45);
        // 加热带灯开关：打到「加热」且滑油泵停机时显示亮蓝色
        if (this._heatLight) this._heatLight.fill((this.heat && !this._running) ? '#00b0ff' : '#2a2f34');
        if (this.sys && this.sys.requestRedraw) this.sys.requestRedraw();
    }

    /** 故障灯：跟随故障灯驱动输入 flt_i（由 PLC 输出锁存故障信号） */
    _faultLamp() { return !!(this._faultNow || this.protection.fault); }

    // ═══════════════════════════════════════════════════════
    // tick
    // ═══════════════════════════════════════════════════════

    tick(dt) {
        this._acc = (this._acc || 0) + dt;
        if (this._acc < 0.15) return;
        this._acc = 0;

        // 遥控状态：由对应机旁面板是否在「遥控」决定
        const lp = this.localPanelId && this.sys ? this.sys.comps[this.localPanelId] : null;
        if (lp) this._remoteActive = lp.mode === 'remote';
        else {
            const p0 = this.ownerId && this.sys ? this.sys.comps[this.ownerId] : null;
            this._remoteActive = !!(p0 && p0.mode === 'remote');
        }

        // 运行状态：接触器吸合 或 被控泵运行
        let run = false;
        if (this.contactorId && this.sys.deviceManager) {
            const km = this.sys.deviceManager.get(this.contactorId);
            if (km && typeof km.isPickup === 'function') run = km.isPickup();
        }
        const p = this.ownerId && this.sys ? this.sys.comps[this.ownerId] : null;
        if (!run && p) run = !!p.running;
        this._running = run;

        // 电源灯 / 故障灯驱动信号
        try {
            if (this.sys.getVoltageBetween) {
                const vp = this.sys.getVoltageBetween(`${this.id}_wire_sw_com`, 'gnd0_wire_gnd');
                if (vp !== undefined && isFinite(vp)) this._powered = Math.abs(vp) > 5;
                const vf = this.sys.getVoltageBetween(`${this.id}_wire_flt_i`, 'gnd0_wire_gnd');
                if (vf !== undefined && isFinite(vf)) this._fltSignal = Math.abs(vf) > 5;
            }
        } catch (e) { /* ignore */ }

        // 故障信号：故障灯驱动输入 或 面板内部保护（锁存由 PLC 程序完成）
        this._faultNow = !!(this._fltSignal || this.protection.fault);

        this._syncVisuals();
    }

    // ═══════════════════════════════════════════════════════
    // API / 配置
    // ═══════════════════════════════════════════════════════

    getConfigFields() {
        return [
            { label: '器件名称 (ID)', key: 'id', type: 'text' },
            { label: '被控滑油泵 ID', key: 'ownerId', type: 'text' },
            { label: '对应机旁面板 ID', key: 'localPanelId', type: 'text' },
            { label: '接触器设备 ID', key: 'contactorId', type: 'text' },
            { label: '标题', key: 'title', type: 'text' },
            {
                label: '控制方式', key: 'auto', type: 'select',
                options: [
                    { label: '手动', value: false },
                    { label: '自动', value: true },
                ],
            },
        ];
    }

    onConfigUpdate(cfg) {
        if (cfg.id) this.id = cfg.id;
        if (cfg.ownerId) this.ownerId = cfg.ownerId;
        if (cfg.localPanelId) this.localPanelId = cfg.localPanelId;
        if (cfg.contactorId) this.contactorId = cfg.contactorId;
        if (cfg.title !== undefined) this.title = cfg.title;
        if (cfg.auto !== undefined) this.auto = (cfg.auto === 'true' || cfg.auto === true);
        this.config = { ...this.config, ...cfg };
        this._syncVisuals();
    }

    destroy() { super.destroy?.(); }
}

export default LubeOilPumpRemotePanel;
