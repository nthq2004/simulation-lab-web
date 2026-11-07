import { BaseComponent } from './BaseComponent.js';

/**
 * TempSettingPanel —— 冷库温度设定面板（照右中）
 * 干货库/粮库/菜库/鱼库/肉库 页签；设置启动温度 / 设置停止温度（上下调节）；
 * 蒸发压力表（R407C）与室温表。通过 RefrigerationSolver 模型联动。
 */
export class TempSettingPanel extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);
        this.W = Math.max(380, config.width || 460);
        this.H = Math.max(260, config.height || 300);
        this.type = 'temp_setting_panel';
        this.special = 'refrig_panel';
        this.cache = 'fixed';

        this.roomKeys = config.roomKeys || ['dry', 'grain', 'veg', 'fish', 'meat'];
        this.roomNames = config.roomNames || { dry: '干货库', grain: '粮库', veg: '菜库', fish: '鱼库', meat: '肉库' };
        this.active = 0;

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
        g.add(new Konva.Rect({ x: 6, y: 6, width: W - 12, height: 28, fill: '#eef1f2', stroke: '#444', strokeWidth: 1 }));
        g.add(new Konva.Text({ x: 6, y: 12, width: W - 12, text: '冷库温度设定', fontSize: 14, fontStyle: 'bold', fill: '#222', align: 'center' }));
        g.add(new Konva.Text({ x: 20, y: 92, width: 150, text: '设置启动温度 ℃', fontSize: 13, fontStyle: 'bold', fill: '#1b5e20', align: 'center' }));
        g.add(new Konva.Text({ x: 20, y: 200, width: 150, text: '设置停止温度 ℃', fontSize: 13, fontStyle: 'bold', fill: '#b71c1c', align: 'center' }));
    }

    _createDynamicNodes() {
        const d = this._dynamicGroup;

        // 5 个库房页签
        this._tabs = [];
        const tw = 86, gap = 4, x0 = 8;
        this.roomKeys.forEach((k, i) => {
            const x = x0 + i * (tw + gap);
            const rect = new Konva.Rect({ x, y: 40, width: tw, height: 26, fill: i === this.active ? '#1f6f8b' : '#9fb3bb', stroke: '#48606a', strokeWidth: 1, cornerRadius: 3 });
            const txt = new Konva.Text({ x, y: 45, width: tw, text: this.roomNames[k] || k, fontSize: 12, fontStyle: 'bold', fill: '#fff', align: 'center' });
            d.add(rect, txt);
            this._tabs.push({ rect, txt });
        });

        // 温度数值
        this._startVal = new Konva.Text({ x: 20, y: 119, width: 150, text: '6', fontSize: 34, fontStyle: 'bold', fill: '#102a43', align: 'center', fontFamily: 'monospace' });
        this._stopVal = new Konva.Text({ x: 20, y: 227, width: 150, text: '1', fontSize: 34, fontStyle: 'bold', fill: '#102a43', align: 'center', fontFamily: 'monospace' });
        d.add(this._startVal, this._stopVal);

        // 增加 / 减少箭头（置于设定值右侧，增在上、减在下）
        const arrow = (x, y, up) => {
            const grp = new Konva.Group({ x, y });
            grp.add(new Konva.Rect({ width: 24, height: 20, fill: '#b0bec5', stroke: '#607d8b', strokeWidth: 1, cornerRadius: 3 }));
            grp.add(new Konva.Line({ points: up ? [6, 14, 12, 6, 18, 14] : [6, 6, 12, 14, 18, 6], stroke: '#263238', strokeWidth: 2 }));
            d.add(grp);
            return grp;
        };
        this._upStart = arrow(131, 116, true);
        this._dnStart = arrow(131, 144, false);
        this._upStop = arrow(131, 224, true);
        this._dnStop = arrow(131, 252, false);

        // 蒸发压力表 / 室温表（同尺寸、水平对齐）
        this._evap = this._makeGauge(258, 140, 54, '蒸发压力', 'bar', 16, '#00838f');
        this._roomGauge = this._makeGauge(390, 140, 54, '室温', '℃', 40, '#ef6c00');
        this._digital = new Konva.Text({ x: 224, y: 234, width: 200, text: '0.0', fontSize: 26, fontStyle: 'bold', fill: '#39ff39', align: 'center', fontFamily: 'monospace' });
        d.add(this._digital);
        this._staticGroup.add(new Konva.Rect({ x: 224, y: 230, width: 200, height: 34, fill: '#12321f', stroke: '#0a2013', strokeWidth: 2, cornerRadius: 4 }));
    }

    _makeGauge(cx, cy, r, label, unit, max, color) {
        const g = new Konva.Group({ x: cx, y: cy });
        g.add(new Konva.Circle({ radius: r, fill: '#fbfbfb', stroke: '#455a64', strokeWidth: 2 }));
        for (let i = 0; i <= 8; i++) {
            const a = (-225 + i * 270 / 8) * Math.PI / 180;
            g.add(new Konva.Line({ points: [Math.cos(a) * (r - 8), Math.sin(a) * (r - 8), Math.cos(a) * (r - 2), Math.sin(a) * (r - 2)], stroke: '#90a4ae', strokeWidth: 1.3 }));
        }
        const needle = new Konva.Line({ points: [0, 0, 0, -(r - 12)], stroke: color, strokeWidth: 3, lineCap: 'round' });
        g.add(needle, new Konva.Circle({ radius: 5, fill: '#455a64' }));
        g.add(new Konva.Text({ x: -r, y: 12, width: r * 2, text: label, fontSize: 10, fontStyle: 'bold', fill: '#37474f', align: 'center' }));
        const valText = new Konva.Text({ x: -r, y: 26, width: r * 2, text: '0.0', fontSize: 14, fontStyle: 'bold', fill: '#102a43', align: 'center', fontFamily: 'monospace' });
        g.add(valText, new Konva.Text({ x: -r, y: 40, width: r * 2, text: unit, fontSize: 9, fill: '#78909c', align: 'center' }));
        this._dynamicGroup.add(g);
        return { needle, valText, max };
    }

    _bindInteraction() {
        const tw = 86, gap = 4, x0 = 8;
        this.roomKeys.forEach((k, i) => {
            const hit = this.addClickablePart('tab-' + k, x0 + i * (tw + gap), 40, tw, 26, true);
            hit.on('click tap', () => { this.active = i; this._syncVisuals(); });
        });
        const u1 = this.addClickablePart('up-start', 131, 116, 24, 20, true);
        const d1 = this.addClickablePart('down-start', 131, 144, 24, 20, true);
        const u2 = this.addClickablePart('up-stop', 131, 224, 24, 20, true);
        const d2 = this.addClickablePart('down-stop', 131, 252, 24, 20, true);
        u1.on('click tap', () => this._bump('setStart', +1));
        d1.on('click tap', () => this._bump('setStart', -1));
        u2.on('click tap', () => this._bump('setStop', +1));
        d2.on('click tap', () => this._bump('setStop', -1));
    }

    _model() { return this.sys && this.sys.refrigSolver ? this.sys.refrigSolver.m : null; }
    _room() { const m = this._model(); return m && m.rooms ? m.rooms[this.roomKeys[this.active]] : null; }

    _bump(field, d) { const r = this._room(); if (!r) return; r[field] = Math.round((r[field] + d) * 10) / 10; this._syncVisuals(); }

    _syncVisuals() {
        this._tabs && this._tabs.forEach((t, i) => { if (t.rect) t.rect.fill(i === this.active ? '#1f6f8b' : '#9fb3bb'); });
        this._updateDynamic();
    }

    _updateDynamic() {
        const m = this._model(); if (!m) return;
        const r = this._room();
        if (r) {
            if (this._startVal) this._startVal.text(String(Math.round(r.setStart)));
            if (this._stopVal) this._stopVal.text(String(Math.round(r.setStop)));
            if (this._digital) this._digital.text(r.temp.toFixed(1));
            if (this._roomGauge) { this._roomGauge.needle.rotation(-135 + Math.max(0, Math.min(1, Math.max(0, r.temp) / this._roomGauge.max)) * 270); this._roomGauge.valText.text(r.temp.toFixed(1)); }
        }
        if (this._evap) { this._evap.needle.rotation(-135 + Math.max(0, Math.min(1, m.pe / this._evap.max)) * 270); this._evap.valText.text(m.pe.toFixed(2)); }
    }

    tick() { this._updateDynamic(); this._refreshIfDirty(); }

    getConfigFields() { return [{ label: '器件名称 (ID)', key: 'id', type: 'text' }]; }
    onConfigUpdate(cfg) { if (cfg.id) this.id = cfg.id; this.config = { ...this.config, ...cfg }; }
}

export default TempSettingPanel;
