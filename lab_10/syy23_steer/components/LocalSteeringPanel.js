import { BaseComponent } from './BaseComponent.js';

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

export class LocalSteeringPanel extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.W = Math.max(480, config.width || 540);
        this.H = Math.max(720, config.height || 860);
        this.type = 'local_steering_panel';
        this.special = 'steering_panel';
        this.cache = 'fixed';

        this._initGroups();
        this._recalcGeometry();
        this._drawStaticParts();
        this._createDynamicNodes();
        this._bindInteraction();
        this._syncVisuals();

        this.config = { id: this.id, width: this.W, height: this.H };
    }

    _recalcGeometry() {
        const W = this.W, H = this.H;
        this._geo = {
            main: { x: 0, y: 0, w: 360, h: 660, r: 10 },
            mainInner: { x: 10, y: 10, w: 340, h: 640, r: 7 },
            title: { x: 44, y: 16, w: 272, h: 40, textY: 25 },
            ammeter: { cx: 103, cy: 172, r: 68 },
            mainPower: {
                cx: 256, cy: 162, r: 46, innerR: 38,
                labelX: 225, labelY: 88, offX: 235, offY: 110, onX: 235, onY: 206,
                part: { x: 214, y: 120, w: 84, h: 86 },
            },
            lamps: {
                y: 292, r: 19, innerR: 14,
                items: [
                    { x: 72, labelX: 36, labelY: 258, labelW: 72, text: '电源' },
                    { x: 182, labelX: 146, labelY: 258, labelW: 72, text: '运行' },
                    { x: 292, labelX: 252, labelY: 258, labelW: 88, text: '故障跳闸' },
                ],
            },
            switches: {
                standby: { cx: 75, cy: 392, r: 27, color: '#d4a017', top: '备用', bottom: '关  开', part: { x: 44, y: 354, w: 62, h: 76 } },
                heater: { cx: 200, cy: 392, r: 27, color: '#1e5b9a', top: '空间加热器', bottom: '关  开', part: { x: 169, y: 354, w: 62, h: 76 } },
            },
            buttons: {
                labels: {
                    start: { x: 62, y: 470, w: 80, text: '起动' },
                    stop: { x: 216, y: 470, w: 80, text: '停止' },
                },
                start: { cx: 102, cy: 530, r: 42, innerR: 32, part: { x: 60, y: 488, w: 84, h: 84 } },
                stop: { cx: 256, cy: 530, r: 42, innerR: 32, part: { x: 214, y: 488, w: 84, h: 84 } },
            },
            system: {
                box: { x: 130, y: 586, w: 200, h: 58, r: 4 },
                title: { x: 130, y: 590, w: 200 },
                no1: { x: 142, y: 622, w: 44 },
                no2: { x: 276, y: 622, w: 44 },
                knob: { cx: 230, cy: 608, r: 23, innerR: 18 },
                parts: {
                    one: { x: 134, y: 602, w: 88, h: 38 },
                    two: { x: 238, y: 602, w: 88, h: 38 },
                },
            },
            auto: {
                panel: { x: 378, y: 90, w: 160, h: 272, r: 8 },
                inner: { x: 386, y: 98, w: 144, h: 256, r: 6 },
                title: { x: 396, y: 104, w: 124, h: 30, textY: 111 },
                powerLabel: { x: 390, y: 158 },
                engageLabel: { x: 390, y: 236 },
                offLabels: [
                    { x: 500, y: 146, text: '关' }, { x: 526, y: 146, text: '开' },
                    { x: 500, y: 224, text: '脱出' }, { x: 526, y: 224, text: '投入' },
                ],
                powerLamp: { cx: 414, cy: 178, r: 12 },
                engageLamp: { cx: 414, cy: 256, r: 12 },
                powerKnob: { cx: 516, cy: 180, r: 27, innerR: 21 },
                engageKnob: { cx: 516, cy: 258, r: 27, innerR: 21 },
                powerPart: { x: 486, y: 146, w: 60, h: 64 },
                engagePart: { x: 486, y: 224, w: 60, h: 64 },
                footer: { x: 378, y: 376, w: 160 },
            },
            footer: { x: 0, y: 676, w: 360 },
            status: { x: 12, y: 700, w: 516 },
        };
    }

    _label(g, x, y, text, size = 12, fill = '#222', bold = false, align = 'left', width = 0) {
        const opts = {
            x, y, text, fontSize: size,
            fontStyle: bold ? 'bold' : 'normal', fill,
            align, fontFamily: 'Arial, sans-serif',
        };
        if (width) opts.width = width;
        g.add(new Konva.Text(opts));
    }

    _drawAmmeter(g, cx, cy, r) {
        g.add(new Konva.Circle({ x: cx, y: cy, radius: r + 8, fill: '#f6f6f2', stroke: '#37474f', strokeWidth: 2 }));
        g.add(new Konva.Circle({ x: cx, y: cy, radius: r, fill: '#ffffff', stroke: '#546e7a', strokeWidth: 1.2 }));
        for (let i = 0; i <= 30; i++) {
            const a = (-135 + i * 270 / 30) * Math.PI / 180;
            const major = i % 5 === 0;
            g.add(new Konva.Line({
                points: [cx + Math.sin(a) * (r - 4), cy - Math.cos(a) * (r - 4),
                    cx + Math.sin(a) * (major ? r - 19 : r - 12), cy - Math.cos(a) * (major ? r - 19 : r - 12)],
                stroke: '#263238', strokeWidth: major ? 1.4 : 0.8,
            }));
            if (major) {
                this._label(g, cx + Math.sin(a) * (r - 32) - 12, cy - Math.cos(a) * (r - 32) - 6,
                    String(i * 10), 7.5, '#263238', false, 'center', 24);
            }
        }
        this._label(g, cx - 22, cy + 25, 'A', 14, '#263238', true, 'center', 44);
    }

    _drawRoundSwitch(g, cx, cy, r, labelTop, labelBottom, color) {
        g.add(new Konva.Circle({ x: cx, y: cy, radius: r + 6, fill: '#d9dbd8', stroke: '#6d7271', strokeWidth: 1.6 }));
        g.add(new Konva.Circle({ x: cx, y: cy, radius: r, fill: '#3b3f41', stroke: '#111', strokeWidth: 1.8 }));
        g.add(new Konva.Circle({ x: cx, y: cy, radius: r * 0.52, fill: color }));
        if (labelTop) this._label(g, cx - 28, cy - r - 20, labelTop, 10, '#263238', true, 'center', 56);
        if (labelBottom) this._label(g, cx - 28, cy + r + 7, labelBottom, 10, '#263238', true, 'center', 56);
    }

    _drawStaticParts() {
        const g = this._staticGroup, G = this._geo;

        g.add(new Konva.Rect({
            x: G.main.x, y: G.main.y, width: G.main.w, height: G.main.h, cornerRadius: G.main.r,
            fillLinearGradientStartPoint: { x: 0, y: 0 }, fillLinearGradientEndPoint: { x: G.main.w, y: G.main.h },
            fillLinearGradientColorStops: [0, '#f0f0ec', 0.55, '#d8d9d5', 1, '#bfc1bd'],
            stroke: '#5f6463', strokeWidth: 3,
        }));
        g.add(new Konva.Rect({
            x: G.mainInner.x, y: G.mainInner.y, width: G.mainInner.w, height: G.mainInner.h,
            fill: 'transparent', stroke: '#8b908e', strokeWidth: 1.2, cornerRadius: G.mainInner.r,
        }));

        g.add(new Konva.Rect({
            x: G.title.x, y: G.title.y, width: G.title.w, height: G.title.h,
            fill: '#f4f4f0', stroke: '#888d8c', strokeWidth: 1.2, cornerRadius: 4,
        }));
        this._label(g, G.title.x, G.title.textY, '1号起动控制', 19, '#263238', true, 'center', G.title.w);

        this._drawAmmeter(g, G.ammeter.cx, G.ammeter.cy, G.ammeter.r);
        const MP = G.mainPower;
        this._label(g, MP.labelX, MP.labelY, '主电源', 12, '#263238', true, 'center', 100);
        this._label(g, MP.onX, MP.onY, 'ON', 11, '#1b5e20', true, 'center', 24);
        this._label(g, MP.offX, MP.offY, 'OFF', 11, '#b71c1c', true, 'center', 30);
        g.add(new Konva.Circle({ x: MP.cx, y: MP.cy, radius: MP.r, fill: '#d9dbd8', stroke: '#6d7271', strokeWidth: 2 }));
        g.add(new Konva.Circle({ x: MP.cx, y: MP.cy, radius: MP.innerR, fill: '#2b2f33', stroke: '#111', strokeWidth: 2 }));

        const L = G.lamps;
        L.items.forEach(it => {
            this._label(g, it.labelX, it.labelY, it.text, 11, '#263238', true, 'center', it.labelW);
            g.add(new Konva.Circle({ x: it.x, y: L.y, radius: L.r, fill: '#c7cac6', stroke: '#777c7a', strokeWidth: 1.4 }));
        });

        const SW = G.switches;
        this._drawRoundSwitch(g, SW.standby.cx, SW.standby.cy, SW.standby.r, SW.standby.top, SW.standby.bottom, SW.standby.color);
        this._drawRoundSwitch(g, SW.heater.cx, SW.heater.cy, SW.heater.r, SW.heater.top, SW.heater.bottom, SW.heater.color);

        const BT = G.buttons;
        this._label(g, BT.labels.start.x, BT.labels.start.y, BT.labels.start.text, 12, '#1b5e20', true, 'center', BT.labels.start.w);
        this._label(g, BT.labels.stop.x, BT.labels.stop.y, BT.labels.stop.text, 12, '#b71c1c', true, 'center', BT.labels.stop.w);
        g.add(new Konva.Circle({ x: BT.start.cx, y: BT.start.cy, radius: BT.start.r, fill: '#2e7d32', stroke: '#1b5e20', strokeWidth: 3 }));
        g.add(new Konva.Circle({ x: BT.start.cx, y: BT.start.cy, radius: BT.start.innerR, fill: '#43a047' }));
        g.add(new Konva.Circle({ x: BT.stop.cx, y: BT.stop.cy, radius: BT.stop.r, fill: '#b71c1c', stroke: '#7f0f0f', strokeWidth: 3 }));
        g.add(new Konva.Circle({ x: BT.stop.cx, y: BT.stop.cy, radius: BT.stop.innerR, fill: '#d32f2f' }));

        const S = G.system;
        g.add(new Konva.Rect({
            x: S.box.x, y: S.box.y, width: S.box.w, height: S.box.h,
            fill: '#e4e5e1', stroke: '#7b807e', strokeWidth: 1.2, cornerRadius: S.box.r,
        }));
        this._label(g, S.title.x, S.title.y, '系统选择', 10, '#263238', true, 'center', S.title.w);
        this._label(g, S.no1.x, S.no1.y, '1号', 11, '#263238', true, 'center', S.no1.w);
        this._label(g, S.no2.x, S.no2.y, '2号', 11, '#263238', true, 'center', S.no2.w);
        g.add(new Konva.Circle({ x: S.knob.cx, y: S.knob.cy, radius: S.knob.r, fill: '#d9dbd8', stroke: '#6d7271', strokeWidth: 1.4 }));
        g.add(new Konva.Circle({ x: S.knob.cx, y: S.knob.cy, radius: S.knob.innerR, fill: '#2b2f33', stroke: '#111', strokeWidth: 1.4 }));

        const A = G.auto;
        g.add(new Konva.Rect({
            x: A.panel.x, y: A.panel.y, width: A.panel.w, height: A.panel.h,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint: { x: A.panel.w, y: A.panel.h },
            fillLinearGradientColorStops: [0, '#ecece8', 1, '#c8cac6'],
            stroke: '#5f6463', strokeWidth: 3, cornerRadius: A.panel.r,
        }));
        g.add(new Konva.Rect({
            x: A.inner.x, y: A.inner.y, width: A.inner.w, height: A.inner.h,
            fill: 'transparent', stroke: '#8b908e', strokeWidth: 1.1, cornerRadius: A.inner.r,
        }));
        g.add(new Konva.Rect({
            x: A.title.x, y: A.title.y, width: A.title.w, height: A.title.h,
            fill: '#f4f4f0', stroke: '#888d8c', strokeWidth: 1, cornerRadius: 3,
        }));
        this._label(g, A.title.x, A.title.textY, '自动舵机', 13, '#263238', true, 'center', A.title.w);
        this._label(g, A.powerLabel.x, A.powerLabel.y, '电源', 11, '#263238', true);
        this._label(g, A.engageLabel.x, A.engageLabel.y, '脱出', 11, '#263238', true);
        A.offLabels.forEach(l => this._label(g, l.x, l.y, l.text, 9, '#37474f'));
        g.add(new Konva.Circle({ x: A.powerKnob.cx, y: A.powerKnob.cy, radius: A.powerKnob.r, fill: '#d9dbd8', stroke: '#6d7271', strokeWidth: 1.6 }));
        g.add(new Konva.Circle({ x: A.powerKnob.cx, y: A.powerKnob.cy, radius: A.powerKnob.innerR, fill: '#2b2f33', stroke: '#111', strokeWidth: 1.6 }));
        g.add(new Konva.Circle({ x: A.engageKnob.cx, y: A.engageKnob.cy, radius: A.engageKnob.r, fill: '#d9dbd8', stroke: '#6d7271', strokeWidth: 1.6 }));
        g.add(new Konva.Circle({ x: A.engageKnob.cx, y: A.engageKnob.cy, radius: A.engageKnob.innerR, fill: '#2b2f33', stroke: '#111', strokeWidth: 1.6 }));

        this._label(g, G.footer.x, G.footer.y, '机旁控制面板', 12, '#546e7a', true, 'center', G.footer.w);
        this._label(g, A.footer.x, A.footer.y, '自动舵电源与投入控制', 10, '#546e7a', false, 'center', A.footer.w);
    }

    _createDynamicNodes() {
        const d = this._dynamicGroup, G = this._geo;

        this._title = new Konva.Text({
            x: G.title.x, y: G.title.textY, width: G.title.w,
            text: '1号起动控制', fontSize: 19, fontStyle: 'bold', fill: '#263238', align: 'center',
        });
        d.add(this._title);

        this._ammeterNeedle = new Konva.Group({ x: G.ammeter.cx, y: G.ammeter.cy });
        this._ammeterNeedle.add(new Konva.Line({ points: [0, 7, 0, -54], stroke: '#c62828', strokeWidth: 3, lineCap: 'round' }));
        this._ammeterNeedle.add(new Konva.Circle({ radius: 5, fill: '#263238' }));
        d.add(this._ammeterNeedle);

        this._mainKnob = new Konva.Group({ x: G.mainPower.cx, y: G.mainPower.cy });
        this._mainKnob.add(new Konva.Rect({ x: -5, y: -32, width: 10, height: 27, fill: '#f1f1ed', cornerRadius: 2 }));
        d.add(this._mainKnob);

        this._lamps = {};
        const L = G.lamps;
        this._lamps.power = new Konva.Circle({ x: L.items[0].x, y: L.y, radius: L.innerR, fill: '#2b2b2b', stroke: '#333', strokeWidth: 1 });
        this._lamps.run = new Konva.Circle({ x: L.items[1].x, y: L.y, radius: L.innerR, fill: '#0a2f0a', stroke: '#333', strokeWidth: 1 });
        this._lamps.fault = new Konva.Circle({ x: L.items[2].x, y: L.y, radius: L.innerR, fill: '#3b0d0d', stroke: '#333', strokeWidth: 1 });
        d.add(this._lamps.power, this._lamps.run, this._lamps.fault);

        this._standbyKnob = new Konva.Group({ x: G.switches.standby.cx, y: G.switches.standby.cy });
        this._standbyKnob.add(new Konva.Rect({ x: -4, y: -24, width: 8, height: 20, fill: '#f1f1ed', cornerRadius: 2 }));
        d.add(this._standbyKnob);

        this._heaterKnob = new Konva.Group({ x: G.switches.heater.cx, y: G.switches.heater.cy });
        this._heaterKnob.add(new Konva.Rect({ x: -4, y: -24, width: 8, height: 20, fill: '#f1f1ed', cornerRadius: 2 }));
        d.add(this._heaterKnob);

        this._startBtn = new Konva.Circle({ x: G.buttons.start.cx, y: G.buttons.start.cy, radius: G.buttons.start.innerR, fill: '#43a047', stroke: '#2e7d32', strokeWidth: 1 });
        this._stopBtn = new Konva.Circle({ x: G.buttons.stop.cx, y: G.buttons.stop.cy, radius: G.buttons.stop.innerR, fill: '#d32f2f', stroke: '#b71c1c', strokeWidth: 1 });
        d.add(this._startBtn, this._stopBtn);

        this._sysKnob = new Konva.Group({ x: G.system.knob.cx, y: G.system.knob.cy });
        this._sysKnob.add(new Konva.Rect({ x: -4, y: -18, width: 8, height: 15, fill: '#202324', cornerRadius: 2 }));
        d.add(this._sysKnob);

        const A = G.auto;
        this._autoPowerLamp = new Konva.Circle({ x: A.powerLamp.cx, y: A.powerLamp.cy, radius: A.powerLamp.r, fill: '#0a2f0a', stroke: '#333', strokeWidth: 1 });
        this._autoEngageLamp = new Konva.Circle({ x: A.engageLamp.cx, y: A.engageLamp.cy, radius: A.engageLamp.r, fill: '#4a3b05', stroke: '#333', strokeWidth: 1 });
        d.add(this._autoPowerLamp, this._autoEngageLamp);

        this._autoPowerKnob = new Konva.Group({ x: A.powerKnob.cx, y: A.powerKnob.cy });
        this._autoPowerKnob.add(new Konva.Rect({ x: -4, y: -24, width: 8, height: 20, fill: '#f1f1ed', cornerRadius: 2 }));
        d.add(this._autoPowerKnob);

        this._autoEngageKnob = new Konva.Group({ x: A.engageKnob.cx, y: A.engageKnob.cy });
        this._autoEngageKnob.add(new Konva.Rect({ x: -4, y: -24, width: 8, height: 20, fill: '#f1f1ed', cornerRadius: 2 }));
        d.add(this._autoEngageKnob);

        this._status = new Konva.Text({
            x: G.status.x, y: G.status.y, width: G.status.w,
            text: '', fontSize: 11, fill: '#455a64', fontFamily: 'Arial, sans-serif',
        });
        d.add(this._status);
    }

    _bindInteraction() {
        const G = this._geo;
        const mk = (id, p, fn) => {
            const n = this.addClickablePart(id, p.x, p.y, p.w, p.h, true);
            if (n) n.on('click tap', fn);
        };

        mk('main-power', G.mainPower.part, () => {
            const s = this._solver();
            if (s) s.toggleMainPower();
            this._syncVisuals();
        });
        mk('start', G.buttons.start.part, () => {
            const s = this._solver();
            if (s) s.startPump(s.m.sys);
            this._syncVisuals();
        });
        mk('stop', G.buttons.stop.part, () => {
            const s = this._solver();
            if (s) s.stopPump(s.m.sys);
            this._syncVisuals();
        });
        mk('sys-1', G.system.parts.one, () => {
            const s = this._solver();
            if (s) s.selectSystem(1);
            this._syncVisuals();
        });
        mk('sys-2', G.system.parts.two, () => {
            const s = this._solver();
            if (s) s.selectSystem(2);
            this._syncVisuals();
        });
        mk('standby', G.switches.standby.part, () => {
            const s = this._solver();
            if (s) s.toggleStandby();
            this._syncVisuals();
        });
        mk('heater', G.switches.heater.part, () => {
            const s = this._solver();
            if (s) s.toggleHeater();
            this._syncVisuals();
        });
        mk('auto-power', G.auto.powerPart, () => {
            const s = this._solver();
            if (s) s.toggleAutoPower();
            this._syncVisuals();
        });
        mk('auto-engage', G.auto.engagePart, () => {
            const s = this._solver();
            if (s) s.toggleAutoEngaged();
            this._syncVisuals();
        });
    }

    _solver() {
        return this.sys && this.sys.steerSolver ? this.sys.steerSolver : null;
    }

    _syncVisuals() {
        const s = this._solver();
        if (!s) return;
        const m = s.m;
        const p = m.pump[m.sys];

        this._title.text(`${m.sys}号起动控制`);
        this._ammeterNeedle.rotation(clamp(p.current / 300, 0, 1) * 270 - 135);
        this._mainKnob.rotation(m.mainPower ? 42 : -42);
        this._sysKnob.rotation(m.sys === 1 ? -90 : 90);

        this._lamps.power.fill(m.mainPower ? '#f5f5f5' : '#2b2b2b');
        this._lamps.run.fill(p.running ? '#25e04a' : '#0a2f0a');
        this._lamps.fault.fill(p.trip ? '#ff2020' : '#3b0d0d');

        this._standbyKnob.rotation(m.standby ? 42 : -42);
        this._heaterKnob.rotation(m.heater ? 42 : -42);
        this._startBtn.opacity(p.running ? 0.55 : 1);
        this._stopBtn.opacity(p.running ? 1 : 0.55);

        this._autoPowerLamp.fill(m.autoPower ? '#25e04a' : '#0a2f0a');
        this._autoEngageLamp.fill(m.autoEngaged ? '#0b3d0b' : '#ffd23f');
        this._autoPowerKnob.rotation(m.autoPower ? 42 : -42);
        this._autoEngageKnob.rotation(m.autoEngaged ? 42 : -42);

        const st = p.trip ? '故障跳闸' : (p.running ? '运行' : '停止');
        this._status.text(`系统 ${m.sys}# · 液压泵${st} · 电流 ${p.current.toFixed(1)} A · 压力 ${p.pressure.toFixed(1)} MPa${m.alarmText ? ' · ' + m.alarmText : ''}`);

        if (this.sys && this.sys.requestRedraw) this.sys.requestRedraw();
    }

    tick() {
        this._syncVisuals();
        this._refreshIfDirty();
    }

    getConfigFields() {
        return [
            { label: '器件名称 (ID)', key: 'id', type: 'text' },
            { label: '宽度', key: 'width', type: 'number' },
            { label: '高度', key: 'height', type: 'number' },
        ];
    }

    onConfigUpdate(cfg) {
        if (cfg.id) this.id = cfg.id;
        this.config = { ...this.config, ...cfg };
        if (this.sys && this.sys.requestRedraw) this.sys.requestRedraw();
    }
}

export default LocalSteeringPanel;
