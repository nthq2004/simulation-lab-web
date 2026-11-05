import { BaseComponent } from './BaseComponent.js';

/**
 * SafetyAlarmPanel —— 安全保护 / 报警面板（船舶中央空调 · 单压缩机）
 * 压缩机 4 路报警灯（排出压力过高 / 压缩机滑油压力低 / 滑油分离器液位高 / 淡水压力过低）
 * + 复位按钮。状态取自 AirConditioningSolver 模型。
 */
export class SafetyAlarmPanel extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);
        this.W = Math.max(380, config.width || 460);
        this.H = Math.max(240, config.height || 320);
        this.type = 'safety_alarm_panel';
        this.special = 'refrig_panel';
        this.cache = 'fixed';

        this._items = [
            { key: 'hp', name: '排出压力过高' },
            { key: 'loil', name: '压缩机滑油压力低' },
            { key: 'oilhi', name: '滑油分离器液位高' },
            { key: 'wplow', name: '淡水压力过低' },
        ];
        this.alarms = { comp1: {} };

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
        g.add(new Konva.Text({ x: 6, y: 12, width: W - 12, text: '安全保护 / 报警', fontSize: 14, fontStyle: 'bold', fill: '#222', align: 'center' }));
        g.add(new Konva.Text({ x: 20, y: 44, width: 240, text: '压缩机异常', fontSize: 13, fontStyle: 'bold', fill: '#b71c1c' }));
    }

    _createDynamicNodes() {
        const d = this._dynamicGroup;
        this._lamps = [];
        const cx = 60;
        this._items.forEach((it, i) => {
            const y = 84 + i * 46;
            this._staticGroup.add(new Konva.Circle({ x: cx, y: y + 12, radius: 14, fill: '#3a3f42', stroke: '#222', strokeWidth: 2 }));
            const lamp = new Konva.Circle({ x: cx, y: y + 12, radius: 10, fill: '#3d0b0b' });
            d.add(lamp);
            d.add(new Konva.Text({ x: cx + 26, y: y + 5, width: 220, text: it.name, fontSize: 12, fontStyle: 'bold', fill: '#37474f' }));
            this._lamps.push({ lamp, key: it.key, comp: 'comp1' });
        });
        // 复位
        this._resetBtn = new Konva.Circle({ x: this.W - 54, y: this.H - 54, radius: 28, fill: '#212121', stroke: '#000', strokeWidth: 2 });
        d.add(this._resetBtn);
        this._staticGroup.add(new Konva.Text({ x: this.W - 94, y: this.H - 18, width: 80, text: '复位', fontSize: 12, fontStyle: 'bold', fill: '#37474f', align: 'center' }));
    }

    _bindInteraction() {
        const hit = this.addClickablePart('reset', this.W - 82, this.H - 82, 56, 56, true);
        hit.on('click tap', () => { const s = this.sys && this.sys.acSolver; if (s && s.m) s.m.resetPulse = true; });

        const cx = 60;
        this._items.forEach((it, i) => {
            const y = 84 + i * 46 + 12;
            this.addClickablePart(`alarm-${it.key}-1`, cx - 14, y - 14, 28, 28);
        });
    }

    _syncVisuals() {
        this._lamps && this._lamps.forEach(l => {
            const on = !!(this.alarms[l.comp] && this.alarms[l.comp][l.key]);
            l.lamp.fill(on ? '#ff2020' : '#3d0b0b');
        });
    }

    _updateDynamic() {
        const m = this.sys && this.sys.acSolver ? this.sys.acSolver.m : null;
        if (!m) return;
        this.alarms = m.alarms || this.alarms;
        this._syncVisuals();
    }

    tick() { this._updateDynamic(); this._refreshIfDirty(); }

    getConfigFields() { return [{ label: '器件名称 (ID)', key: 'id', type: 'text' }]; }
    onConfigUpdate(cfg) { if (cfg.id) this.id = cfg.id; this.config = { ...this.config, ...cfg }; }
}

export default SafetyAlarmPanel;
