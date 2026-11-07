import { BaseComponent } from './BaseComponent.js';

/**
 * CompressorRemotePanel —— 空压机遥控面板（紧凑型，含真电气信号触点）
 *
 * 布局（scale=1，高度减小，三个指示灯与手动/自动开关缩小）：
 *   ① 顶部标题框；② 黄色「遥控」指示灯（遥控状态亮黄色、否则暗色）；
 *   ③ 绿色「运行」/ 红色「停止」指示灯（激活亮色、未激活暗色）；
 *   ④ 「手动 - 自动」标牌 ＋ 大号选择旋钮。
 *
 * 电气信号（真触点）：
 *   · 「自动」常开 sw_com↔auto_o，点动「起动」sw_com↔sa_o、「停止」sw_com↔sb_o。
 */
export class CompressorRemotePanel extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.W = config.W || 187;
        this.H = config.H || 267;
        this.type = 'compressor_panel';
        this.special = 'crp';
        this.cache = 'fixed';

        this._initGroups();

        this.ownerId = config.ownerId || null;
        this.contactorId = config.contactorId || null;
        this.localPanelId = config.localPanelId || null;   // 对应机旁面板（判断是否处于遥控）
        this.title = config.title || '主空压机';
        this.auto = !!config.auto;              // false = 手动, true = 自动
        this._startPressed = false;
        this._stopPressed = false;
        this._remoteActive = false;
        this._running = false;
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
            localPanelId: this.localPanelId, title: this.title, auto: this.auto,
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
            fill: '#c9d3cd', stroke: '#7d8a83', strokeWidth: 2, cornerRadius: 5,
        }));

        // ① 标题框
        g.add(new Konva.Rect({ x: 5, y: 5, width: this.W - 10, height: 28, fill: '#eef1ef', stroke: '#444', strokeWidth: 1.2 }));
        g.add(new Konva.Text({ x: 5, y: 12, width: this.W - 10, text: this.title, fontSize: 13, fontStyle: 'bold', fill: '#222', align: 'center' }));

        // ② 遥控指示灯框（激活亮黄 / 未激活暗色）
        this._remoteBox = new Konva.Rect({ x: 53, y: 38, width: 80, height: 30, fill: '#f4e04d', stroke: '#333', strokeWidth: 1.4, cornerRadius: 3 });
        this._dynamicGroup.add(this._remoteBox);
        this._remoteText = new Konva.Text({ x: 53, y: 45, width: 80, text: '遥控', fontSize: 14, fontStyle: 'bold', fill: '#333', align: 'center' });
        this._dynamicGroup.add(this._remoteText);

        // ③ 运行 / 停止
        this._runBox = new Konva.Rect({ x: 21, y: 74, width: 67, height: 42, fill: '#14330f', stroke: '#4a8a4a', strokeWidth: 1.4, cornerRadius: 3 });
        this._stopBox = new Konva.Rect({ x: 99, y: 74, width: 67, height: 42, fill: '#e53935', stroke: '#a04a4a', strokeWidth: 1.4, cornerRadius: 3 });
        this._dynamicGroup.add(this._runBox);
        this._dynamicGroup.add(this._stopBox);
        g.add(new Konva.Text({ x: 21, y: 86, width: 67, text: '运行', fontSize: 14, fontStyle: 'bold', fill: '#dff5df', align: 'center' }));
        g.add(new Konva.Text({ x: 99, y: 86, width: 67, text: '停止', fontSize: 14, fontStyle: 'bold', fill: '#ffe3e3', align: 'center' }));

        // ④ 手动-自动标牌
        g.add(new Konva.Rect({ x: 31, y: 124, width: this.W - 62, height: 32, fill: '#eef1ef', stroke: '#444', strokeWidth: 1.2 }));
        g.add(new Konva.Text({ x: 31, y: 128, width: this.W - 62, text: this.title, fontSize: 10, fill: '#222', align: 'center' }));
        g.add(new Konva.Text({ x: 31, y: 142, width: this.W - 62, text: '手动  -  自动', fontSize: 10, fill: '#222', align: 'center' }));

        // 选择旋钮
        const cx = this.W / 2, cy = 190, r = 27;
        g.add(new Konva.Circle({ x: cx, y: cy, radius: r + 4, fill: '#e6e6e6', stroke: '#999', strokeWidth: 2 }));
        this._maKnob = new Konva.Group({ x: cx, y: cy });
        this._maKnob.add(new Konva.Circle({ radius: r, fill: '#1c1c1c', stroke: '#000', strokeWidth: 2 }));
        this._maKnob.add(new Konva.Rect({ x: -3, y: -r + 3, width: 6, height: r * 0.7, fill: '#f5f5f5', cornerRadius: 2 }));
        this._dynamicGroup.add(this._maKnob);
        g.add(new Konva.Text({ x: cx - 60, y: cy + 34, width: 46, text: '手动', fontSize: 11, fontStyle: 'bold', fill: '#333', align: 'center' }));
        g.add(new Konva.Text({ x: cx + 14, y: cy + 34, width: 46, text: '自动', fontSize: 11, fontStyle: 'bold', fill: '#333', align: 'center' }));
    }

    _registerPorts() {
        const portDefs = [
            { id: 'sw_com', label: '24V' },
            { id: 'auto_o', label: '自动' },
            { id: 'sa_o', label: '起动' },
            { id: 'sb_o', label: '停止' },
        ];
        const n = portDefs.length;
        const x0 = 24, x1 = this.W - 24;
        portDefs.forEach((pd, i) => {
            const x = x0 + (x1 - x0) * (i / (n - 1));
            this.addPort(x, this.H, pd.id, 'wire');
            this._staticGroup.add(new Konva.Text({
                x: x - 18, y: this.H + 4, width: 36,
                text: pd.label, fontSize: 10, fontStyle: 'bold',
                fill: '#333', align: 'center',
            }));
        });
    }

    // ═══════════════════════════════════════════════════════
    // 交互
    // ═══════════════════════════════════════════════════════

    _bind() {
        this.addClickablePart('ind-remote', 53, 38, 80, 30);
        this.addClickablePart('btn-run', 21, 74, 67, 42);
        this.addClickablePart('btn-stop', 99, 74, 67, 42);
        this.addClickablePart('knob-ma', this.W / 2 - 40, 150, 80, 80);

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
        const hk = this.getClickablePartNode('knob-ma');
        if (hk) hk.on('click tap', () => { this.auto = !this.auto; this._syncVisuals(); });
    }

    pressStart() { this._startPressed = true; }
    releaseStart() { this._startPressed = false; }
    pressStop() { this._stopPressed = true; }
    releaseStop() { this._stopPressed = false; }

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
        if (this._maKnob) this._maKnob.rotation(this.auto ? 120 : -120);
        // 遥控灯：遥控状态亮黄色，否则暗色
        if (this._remoteBox) {
            this._remoteBox.fill(this._remoteActive ? '#f4e04d' : '#555a4e');
            this._remoteText.fill(this._remoteActive ? '#333' : '#c8ccbf');
        }
        // 运行灯：运行亮绿 / 未运行暗绿
        if (this._runBox) this._runBox.fill(this._running ? '#00e83a' : '#14330f');
        // 停止灯：停止亮红 / 运行暗红
        if (this._stopBox) this._stopBox.fill(this._running ? '#5a1616' : '#ff2020');
        if (this.sys && this.sys.requestRedraw) this.sys.requestRedraw();
    }

    // ═══════════════════════════════════════════════════════
    // tick
    // ═══════════════════════════════════════════════════════

    tick(dt) {
        this._acc = (this._acc || 0) + dt;
        if (this._acc < 0.15) return;
        this._acc = 0;

        // 遥控状态：由对应机旁面板「空压机控制」旋钮是否在「遥控」决定
        const lp = this.localPanelId && this.sys ? this.sys.comps[this.localPanelId] : null;
        if (lp) this._remoteActive = lp.ctrlMode === 'remote';
        else {
            const ac0 = this.ownerId && this.sys ? this.sys.comps[this.ownerId] : null;
            this._remoteActive = !!(ac0 && ac0.mode === 'remote');
        }

        let run = false;
        if (this.contactorId && this.sys.deviceManager) {
            const km = this.sys.deviceManager.get(this.contactorId);
            if (km && typeof km.isPickup === 'function') run = km.isPickup();
        }
        const ac = this.ownerId && this.sys ? this.sys.comps[this.ownerId] : null;
        if (!run && ac) run = !!ac.running;
        this._running = run;

        this._syncVisuals();
    }

    // ═══════════════════════════════════════════════════════
    // API / 配置
    // ═══════════════════════════════════════════════════════

    setAuto(on) { this.auto = !!on; this._syncVisuals(); }
    isAuto() { return this.auto; }

    getConfigFields() {
        return [
            { label: '器件名称 (ID)', key: 'id', type: 'text' },
            { label: '被控空压机 ID', key: 'ownerId', type: 'text' },
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

export default CompressorRemotePanel;
