import { BaseComponent } from './BaseComponent.js';

/**
 * CompressorControlPanel —— 压缩机操作台（照右上一号/二号压缩机面板）
 * 一号/二号页签、COMP 显示与运行灯、手动/自动旋钮、负荷、启动/停止、
 * 启动压力/压差/停止压力条表、卸载/旁通、进口/出口/滑油压力圆表。
 * 通过 RefrigerationSolver 模型联动。
 */
export class CompressorControlPanel extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);
        this.W = Math.max(380, config.width || 460);
        this.H = Math.max(340, config.height || 430);
        this.type = 'compressor_control_panel';
        this.special = 'refrig_panel';
        this.cache = 'fixed';

        this.activeComp = config.activeComp || 'comp1';
        this.startP = 4.65;
        this.diffP = 2.0;
        this.stopP = 17.8;
        this.unload = false;
        this.bypass = false;
        this._load = 0;
        this._running = false;

        this._initGroups();
        this._drawStaticParts();
        this._createDynamicNodes();
        this._bindInteraction();
        this._syncVisuals();

        this.config = { id: this.id, width: this.W, height: this.H };
    }

    _drawStaticParts() {
        const g = this._staticGroup, W = this.W;
        g.add(new Konva.Rect({ x: 0, y: 0, width: W, height: this.H, fill: '#c8d0d4', stroke: '#7a858c', strokeWidth: 2, cornerRadius: 6 }));
        // 页签底板
        g.add(new Konva.Rect({ x: 6, y: 6, width: 220, height: 28, fill: '#eef1f2', stroke: '#444', strokeWidth: 1 }));
        g.add(new Konva.Text({ x: 6, y: 12, width: 110, text: '一号压缩机', fontSize: 13, fontStyle: 'bold', fill: '#222', align: 'center' }));
        g.add(new Konva.Text({ x: 116, y: 12, width: 110, text: '二号压缩机', fontSize: 13, fontStyle: 'bold', fill: '#222', align: 'center' }));

        // 标牌
        const t = (x, y, s, col, size) => g.add(new Konva.Text({ x, y, width: 80, text: s, fontSize: size || 12, fontStyle: 'bold', fill: col || '#37474f', align: 'center' }));
        t(16, 96, '自动');
        t(16, 158, '手动');
        t(300, 44, '启动', '#1b5e20', 13);
        t(384, 44, '停止', '#b71c1c', 13);
        t(120, 104, '负荷 %', '#546e7a', 10);
        t(250, 250, '卸载', '#333', 12);
        t(360, 250, '旁通', '#333', 12);
        // 条表标题
        ['启动压力', '压差', '停止压力'].forEach((s, i) => t(120 + i * 60, 140, s, '#37474f', 10));
    }

    _createDynamicNodes() {
        const d = this._dynamicGroup, W = this.W;

        // 运行灯 + COMP 文本
        this._runLight = new Konva.Circle({ x: 34, y: 60, radius: 15, fill: '#0b3d0b', stroke: '#08300b', strokeWidth: 2 });
        d.add(this._runLight);
        this._compText = new Konva.Text({ x: 54, y: 48, width: 90, text: 'COMP1', fontSize: 15, fontStyle: 'bold', fill: '#222' });
        d.add(this._compText);

        // 负荷数字
        this._loadText = new Konva.Text({ x: 120, y: 60, width: 80, text: '0', fontSize: 30, fontStyle: 'bold', fill: '#102a43', align: 'center', fontFamily: 'monospace' });
        d.add(this._loadText);

        // 手动/自动旋钮
        this._knob = new Konva.Group({ x: 56, y: 128 });
        this._knob.add(new Konva.Circle({ radius: 24, fill: '#1c1c1c', stroke: '#000', strokeWidth: 2 }));
        this._knob.add(new Konva.Rect({ x: -3, y: -20, width: 6, height: 16, fill: '#f5f5f5', cornerRadius: 2 }));
        d.add(this._knob);

        // 启停按钮
        this._startBtn = new Konva.Circle({ x: 340, y: 58, radius: 22, fill: '#2e7d32', stroke: '#000', strokeWidth: 1.5 });
        this._stopBtn = new Konva.Circle({ x: 424, y: 58, radius: 22, fill: '#c62828', stroke: '#000', strokeWidth: 1.5 });
        d.add(this._startBtn, this._stopBtn);

        // 三条条形表
        this._bars = [];
        [{ max: 16, c: '#1565c0' }, { max: 6, c: '#6a1b9a' }, { max: 20, c: '#c62828' }].forEach((s, i) => {
            const x = 108 + i * 60;
            this._staticGroup.add(new Konva.Rect({ x, y: 156, width: 16, height: 96, fill: '#eceff1', stroke: '#90a4ae', strokeWidth: 1, cornerRadius: 3 }));
            const fill = new Konva.Rect({ x, y: 156, width: 16, height: 0, fill: s.c, cornerRadius: 3 });
            d.add(fill);
            const txt = new Konva.Text({ x: x - 20, y: 254, width: 56, text: '', fontSize: 10, fontStyle: 'bold', fill: '#37474f', align: 'center', fontFamily: 'monospace' });
            d.add(txt);
            this._bars.push({ fill, txt, max: s.max, val: [this.startP, this.diffP, this.stopP][i] });
        });

        // 卸载/旁通
        this._unloadBtn = new Konva.Rect({ x: 250, y: 196, width: 84, height: 46, fill: '#43a047', stroke: '#1b5e20', strokeWidth: 1.5, cornerRadius: 4 });
        this._bypassBtn = new Konva.Rect({ x: 350, y: 196, width: 84, height: 46, fill: '#bdbdbd', stroke: '#616161', strokeWidth: 1.5, cornerRadius: 4 });
        d.add(this._unloadBtn, this._bypassBtn);

        // 圆表
        this._gauges = [];
        [
            { cx: 82, cy: 350, r: 50, label: '进口压力', unit: 'bar', max: 16, color: '#1565c0' },
            { cx: 230, cy: 350, r: 50, label: '出口压力', unit: 'bar', max: 20, color: '#c62828' },
            { cx: 378, cy: 350, r: 50, label: '滑油压力', unit: 'bar', max: 6, color: '#ef6c00' },
        ].forEach(gs => this._gauges.push(this._makeGauge(gs)));
    }

    _makeGauge(gs) {
        const g = new Konva.Group({ x: gs.cx, y: gs.cy });
        g.add(new Konva.Circle({ radius: gs.r, fill: '#fbfbfb', stroke: '#455a64', strokeWidth: 2 }));
        for (let i = 0; i <= 8; i++) {
            const a = (-225 + i * 270 / 8) * Math.PI / 180;
            g.add(new Konva.Line({ points: [Math.cos(a) * (gs.r - 9), Math.sin(a) * (gs.r - 9), Math.cos(a) * (gs.r - 2), Math.sin(a) * (gs.r - 2)], stroke: '#90a4ae', strokeWidth: 1.4 }));
        }
        const needle = new Konva.Line({ points: [0, 0, 0, -(gs.r - 12)], stroke: gs.color, strokeWidth: 3, lineCap: 'round' });
        g.add(needle, new Konva.Circle({ radius: 5, fill: '#455a64' }));
        g.add(new Konva.Text({ x: -gs.r, y: -8, width: gs.r * 2, text: gs.label, fontSize: 11, fontStyle: 'bold', fill: '#37474f', align: 'center' }));
        const valText = new Konva.Text({ x: -gs.r, y: 18, width: gs.r * 2, text: '0.0', fontSize: 15, fontStyle: 'bold', fill: '#102a43', align: 'center', fontFamily: 'monospace' });
        g.add(valText, new Konva.Text({ x: -gs.r, y: 35, width: gs.r * 2, text: gs.unit, fontSize: 9, fill: '#78909c', align: 'center' }));
        this._dynamicGroup.add(g);
        return { needle, valText, max: gs.max };
    }

    _bindInteraction() {
        this.addClickablePart('tab-comp1', 6, 6, 110, 28, true);
        this.addClickablePart('tab-comp2', 116, 6, 110, 28, true);
        this.addClickablePart('mode', 32, 104, 48, 48, true);
        this.addClickablePart('start', 318, 36, 44, 44, true);
        this.addClickablePart('stop', 402, 36, 44, 44, true);
        this.addClickablePart('unload', 250, 196, 84, 46, true);
        this.addClickablePart('bypass', 350, 196, 84, 46, true);

        const fire = (part, fn) => { const n = this.getClickablePartNode(part); if (n) n.on('click tap', fn); };
        fire('tab-comp1', () => { this.activeComp = 'comp1'; this._syncVisuals(); });
        fire('tab-comp2', () => { this.activeComp = 'comp2'; this._syncVisuals(); });
        fire('mode', () => { const m = this._model(); if (m) m.mode = (m.mode === 'auto' ? 'manual' : 'auto'); });
        fire('start', () => { const c = this._comp(); if (c) c.manualRun = true; });
        fire('stop', () => { const c = this._comp(); if (c) c.manualRun = false; });
        fire('unload', () => { this.unload = true; setTimeout(() => { this.unload = false; this._syncVisuals(); }, 1500); this._syncVisuals(); });
        fire('bypass', () => { this.bypass = !this.bypass; this._syncVisuals(); });
    }

    _model() { return this.sys && this.sys.refrigSolver ? this.sys.refrigSolver.m : null; }
    _comp() { const m = this._model(); return m && m.comps ? m.comps[this.activeComp] : null; }

    _syncVisuals() {
        const m = this._model();
        if (this._knob) this._knob.rotation(m && m.mode === 'auto' ? 45 : -45);
        if (this._unloadBtn) this._unloadBtn.fill(this.unload ? '#1b5e20' : '#43a047');
        if (this._bypassBtn) this._bypassBtn.fill(this.bypass ? '#616161' : '#bdbdbd');
        if (this._compText) this._compText.text(this.activeComp === 'comp1' ? 'COMP1' : 'COMP2');
        this._updateDynamic();
    }

    _updateDynamic() {
        const m = this._model(), c = this._comp();
        if (!m) return;
        this._running = c ? c.running : m.running;
        this._load = c ? c.loadPct : m.loadPct;
        if (this._runLight) this._runLight.fill(this._running ? '#00e83a' : '#0b3d0b');
        if (this._loadText) this._loadText.text(String(Math.round(this._load)));
        if (this._startBtn) this._startBtn.fill(this._running ? '#66bb6a' : '#2e7d32');
        // 负荷数字（借用静态 '55' 位置覆盖）
        if (this._bars) {
            this._bars.forEach((b, i) => { const v = b.val; const h = 96 * Math.max(0, Math.min(1, v / b.max)); b.fill.height(h); b.fill.y(156 + (96 - h)); b.txt.text(v.toFixed(1)); });
        }
        if (this._gauges) {
            const vals = [m.pe, m.pc, m.oilP];
            this._gauges.forEach((g, i) => { g.needle.rotation(-225 + Math.max(0, Math.min(1, vals[i] / g.max)) * 270); g.valText.text((this._running ? vals[i] : 0).toFixed(1)); });
        }
    }

    tick() { this._updateDynamic(); this._refreshIfDirty(); }

    getConfigFields() {
        return [
            { label: '器件名称 (ID)', key: 'id', type: 'text' },
            { label: '启动压力 (bar)', key: 'startP', type: 'number', step: 0.1 },
            { label: '压差 (bar)', key: 'diffP', type: 'number', step: 0.1 },
            { label: '停止压力 (bar)', key: 'stopP', type: 'number', step: 0.1 },
        ];
    }

    onConfigUpdate(cfg) {
        if (cfg.id) this.id = cfg.id;
        if (cfg.startP !== undefined) this.startP = parseFloat(cfg.startP);
        if (cfg.diffP !== undefined) this.diffP = parseFloat(cfg.diffP);
        if (cfg.stopP !== undefined) this.stopP = parseFloat(cfg.stopP);
        this.config = { ...this.config, ...cfg };
        this._syncVisuals();
    }
}

export default CompressorControlPanel;
