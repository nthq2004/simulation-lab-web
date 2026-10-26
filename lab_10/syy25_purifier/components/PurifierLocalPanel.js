import Konva from 'konva';
import { BaseComponent } from './BaseComponent.js';

/**
 * PurifierLocalPanel — 分油机机旁控制箱
 * 主电源、机旁/遥控、起动/停止、应急停止、进油泵、加热器、工作水/空气压力、振动、报警。
 */
export class PurifierLocalPanel extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.W = Math.max(420, config.width || 500);
        this.H = Math.max(680, config.height || 820);
        this.type = 'purifier_local_panel';
        this.special = 'purifier_local';
        this.cache = 'fixed';

        this._lampTestUntil = 0;

        this._initGroups();
        this._recalcGeometry();
        this._drawStaticParts();
        this._createDynamicNodes();
        this._bindInteraction();
        this._syncVisuals();

        this.config = { id: this.id, width: this.W, height: this.H };
    }

    _solver() {
        return this.sys && this.sys.purifierSolver ? this.sys.purifierSolver : null;
    }

    _recalcGeometry() {
        const W = this.W, H = this.H;
        this._geo = {
            chassis: { x: 0, y: 0, w: W, h: H, r: 12 },
            bezel: { x: 12, y: 12, w: W - 24, h: H - 24, r: 7 },
            ammeter: { cx: 112, cy: 138, r: 62 },
            main: { x: 36, y: 226, w: 150, h: 58 },
            local: { x: 216, y: 226, w: 180, h: 58 },
            start: { x: 46, y: 314, w: 92, h: 70 },
            stop: { x: 168, y: 314, w: 92, h: 70 },
            emergency: { x: 306, y: 338, r: 42 },
            feed: { x: 46, y: 414, w: 130, h: 58 },
            heater: { x: 256, y: 414, w: 140, h: 58 },
            temp: { x: 36, y: 500, w: 202, h: 70 },
            tempInc: { x: 256, y: 506, w: 54, h: 54 },
            tempDec: { x: 322, y: 506, w: 54, h: 54 },
            waterGauge: { cx: 124, cy: 650, r: 56 },
            airGauge: { cx: 336, cy: 650, r: 56 },
            alarmLamp: { x: 42, y: 730, r: 14 },
            reset: { x: 264, y: 724, w: 132, h: 46 },
            lampTest: { x: 168, y: 724, w: 88, h: 46 },
        };
    }

    _label(g, x, y, text, size = 12, fill = '#263238', bold = false, align = 'left', width = 0) {
        const opts = {
            x, y, text, fontSize: size, fontStyle: bold ? 'bold' : 'normal',
            fill, align, fontFamily: 'Arial, "Microsoft YaHei", sans-serif',
        };
        if (width) opts.width = width;
        g.add(new Konva.Text(opts));
    }

    _drawGauge(g, cx, cy, r, max, labels, unit, color = '#37474f') {
        g.add(new Konva.Circle({ x: cx, y: cy, radius: r, fill: '#f2f4f2', stroke: '#7c8280', strokeWidth: 2 }));
        for (let i = 0; i <= 10; i++) {
            const a = (-135 + (i / 10) * 270) * Math.PI / 180;
            const x1 = cx + Math.sin(a) * (r - 18);
            const y1 = cy - Math.cos(a) * (r - 18);
            const x2 = cx + Math.sin(a) * (r - 10);
            const y2 = cy - Math.cos(a) * (r - 10);
            g.add(new Konva.Line({ points: [x1, y1, x2, y2], stroke: '#37474f', strokeWidth: i % 2 === 0 ? 2 : 1 }));
            if (i % 2 === 0) {
                const lx = cx + Math.sin(a) * (r - 32);
                const ly = cy - Math.cos(a) * (r - 32);
                this._label(g, lx - 14, ly - 7, String(Math.round(max * i / 10)), 9, '#37474f', false, 'center', 28);
            }
        }
        this._label(g, cx - 50, cy + 20, unit, 9, '#78909c', false, 'center', 100);
        this._label(g, cx - 50, cy - r - 18, labels, 10, '#455a64', true, 'center', 100);
        g.add(new Konva.Line({ points: [cx, cy, cx + Math.sin(-135 * Math.PI / 180) * (r - 20), cy - Math.cos(-135 * Math.PI / 180) * (r - 20)], stroke: color, strokeWidth: 2 }));
    }

    _drawStaticParts() {
        const g = this._staticGroup, G = this._geo, W = this.W, H = this.H;

        g.add(new Konva.Rect({
            x: 0, y: 0, width: W, height: H, cornerRadius: G.chassis.r,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint: { x: W, y: H },
            fillLinearGradientColorStops: [0, '#6e7374', 0.5, '#4a4f50', 1, '#343839'],
            stroke: '#202323', strokeWidth: 2.5,
        }));
        g.add(new Konva.Rect({
            x: G.bezel.x, y: G.bezel.y, width: G.bezel.w, height: G.bezel.h, cornerRadius: G.bezel.r,
            fill: '#c4c8c8', stroke: '#1f2222', strokeWidth: 2,
        }));
        g.add(new Konva.Rect({
            x: 24, y: 24, width: W - 48, height: H - 48, cornerRadius: 4,
            fill: '#eef0ee', stroke: '#8d9491', strokeWidth: 1.5,
        }));

        this._label(g, 34, 34, '分油机机旁控制箱', 15, '#263238', true);

        // 电流表
        const A = G.ammeter;
        g.add(new Konva.Circle({ x: A.cx, y: A.cy, radius: A.r, fill: '#f8f8f6', stroke: '#546e7a', strokeWidth: 2 }));
        for (let i = 0; i <= 6; i++) {
            const a = (-120 + (i / 6) * 240) * Math.PI / 180;
            const x1 = A.cx + Math.sin(a) * (A.r - 14);
            const y1 = A.cy - Math.cos(a) * (A.r - 14);
            const x2 = A.cx + Math.sin(a) * (A.r - 5);
            const y2 = A.cy - Math.cos(a) * (A.r - 5);
            g.add(new Konva.Line({ points: [x1, y1, x2, y2], stroke: '#37474f', strokeWidth: 1.5 }));
            const lx = A.cx + Math.sin(a) * (A.r - 28);
            const ly = A.cy - Math.cos(a) * (A.r - 28);
            this._label(g, lx - 12, ly - 6, String(i * 5), 9, '#37474f', false, 'center', 24);
        }
        this._label(g, A.cx - 50, A.cy + 26, 'A', 11, '#546e7a', false, 'center', 100);
        this._label(g, A.cx - 60, A.cy + 42, 'MOTOR CURRENT', 9, '#78909c', false, 'center', 120);

        // 指示灯标签
        this._label(g, 232, 104, 'POWER', 10, '#455a64', true);
        this._label(g, 232, 140, 'RUN', 10, '#455a64', true);
        this._label(g, 232, 176, 'TRIP', 10, '#455a64', true);

        // 主电源 / 机旁遥控 底板
        this._drawSwitchBox(g, G.main, 'MAIN POWER', '主电源');
        this._drawSwitchBox(g, G.local, 'LOCAL / REMOTE', '机旁 / 遥控');

        // 起动/停止按钮
        g.add(new Konva.Rect({ x: G.start.x, y: G.start.y, width: G.start.w, height: G.start.h, cornerRadius: 6, fill: '#1b5e20', stroke: '#0d2b12', strokeWidth: 2 }));
        g.add(new Konva.Rect({ x: G.stop.x, y: G.stop.y, width: G.stop.w, height: G.stop.h, cornerRadius: 6, fill: '#b71c1c', stroke: '#4a0a0a', strokeWidth: 2 }));
        this._label(g, G.start.x, G.start.y + 24, 'START', 14, '#ffffff', true, 'center', G.start.w);
        this._label(g, G.stop.x, G.stop.y + 24, 'STOP', 14, '#ffffff', true, 'center', G.stop.w);
        this._label(g, G.start.x, G.start.y + G.start.h + 4, '机旁起动', 9, '#455a64', false, 'center', G.start.w);
        this._label(g, G.stop.x, G.stop.y + G.stop.h + 4, '停止', 9, '#455a64', false, 'center', G.stop.w);

        // 应急停止
        g.add(new Konva.Circle({ x: G.emergency.x, y: G.emergency.y, radius: G.emergency.r, fill: '#c62828', stroke: '#5c0d0d', strokeWidth: 3 }));
        g.add(new Konva.Circle({ x: G.emergency.x, y: G.emergency.y, radius: G.emergency.r - 10, fill: '#e53935', stroke: '#7f1010', strokeWidth: 1 }));
        this._label(g, G.emergency.x - 44, G.emergency.y + G.emergency.r + 6, 'EMERGENCY STOP', 8, '#455a64', true, 'center', 88);

        // 进油泵 / 加热器
        this._drawButtonBox(g, G.feed, 'FEED PUMP', '进油泵');
        this._drawButtonBox(g, G.heater, 'HEATER', '加热器');

        // 温度控制器
        g.add(new Konva.Rect({ x: G.temp.x, y: G.temp.y, width: G.temp.w, height: G.temp.h, cornerRadius: 3, fill: '#263238', stroke: '#111', strokeWidth: 1.5 }));
        this._label(g, G.temp.x + 8, G.temp.y + 5, 'TT1  TEMPERATURE', 9, '#90a4ae', true);
        this._label(g, G.tempInc.x - 6, G.tempInc.y + 16, '+', 26, '#263238', true, 'center', 66);
        this._label(g, G.tempDec.x - 6, G.tempDec.y + 16, '−', 26, '#263238', true, 'center', 66);

        // 压力表
        this._drawGauge(g, G.waterGauge.cx, G.waterGauge.cy, G.waterGauge.r, 10, 'OPERATING WATER', 'bar');
        this._drawGauge(g, G.airGauge.cx, G.airGauge.cy, G.airGauge.r, 10, 'CONTROL AIR', 'bar');

        // 报警 / 复位 / 试灯
        g.add(new Konva.Circle({ x: G.alarmLamp.x, y: G.alarmLamp.y, radius: G.alarmLamp.r, fill: '#3a0b0b', stroke: '#111', strokeWidth: 1.5 }));
        this._label(g, G.alarmLamp.x + 22, G.alarmLamp.y - 8, 'ALARM', 10, '#b71c1c', true, 'left', 80);
        this._drawButtonBox(g, G.reset, 'ALARM RESET', '报警复位');
        this._drawButtonBox(g, G.lampTest, 'LAMP TEST', '试灯');
    }

    _drawSwitchBox(g, b, en, cn) {
        g.add(new Konva.Rect({ x: b.x, y: b.y, width: b.w, height: b.h, cornerRadius: 4, fill: '#d7dbdb', stroke: '#546e7a', strokeWidth: 1.5 }));
        this._label(g, b.x + 8, b.y + 6, en, 9, '#455a64', true);
        this._label(g, b.x + 8, b.y + b.h - 20, cn, 11, '#263238');
    }

    _drawButtonBox(g, b, en, cn) {
        g.add(new Konva.Rect({ x: b.x, y: b.y, width: b.w, height: b.h, cornerRadius: 4, fill: '#d7dbdb', stroke: '#546e7a', strokeWidth: 1.5 }));
        this._label(g, b.x + 8, b.y + 6, en, 9, '#455a64', true);
        this._label(g, b.x + 8, b.y + b.h - 22, cn, 11, '#263238');
    }

    _createDynamicNodes() {
        const d = this._dynamicGroup, G = this._geo;

        // 电流表指针
        this._ampNeedle = new Konva.Group({ x: G.ammeter.cx, y: G.ammeter.cy, rotation: -120 });
        this._ampNeedle.add(new Konva.Line({ points: [0, 8, 0, -G.ammeter.r + 18], stroke: '#c62828', strokeWidth: 2.5, lineCap: 'round' }));
        this._ampNeedle.add(new Konva.Circle({ x: 0, y: 0, radius: 5, fill: '#37474f' }));
        d.add(this._ampNeedle);
        this._ampText = new Konva.Text({
            x: G.ammeter.cx - 46, y: G.ammeter.cy + 30, width: 92, height: 24,
            text: '0.0 A', fontSize: 14, align: 'center', fill: '#263238', fontFamily: 'Consolas, monospace',
        });
        d.add(this._ampText);

        // 指示灯
        this._ledPower = new Konva.Circle({ x: 218, y: 108, radius: 6, fill: '#2b2f2f', stroke: '#111', strokeWidth: 1 });
        this._ledRun = new Konva.Circle({ x: 218, y: 144, radius: 6, fill: '#2b2f2f', stroke: '#111', strokeWidth: 1 });
        this._ledTrip = new Konva.Circle({ x: 218, y: 180, radius: 6, fill: '#2b2f2f', stroke: '#111', strokeWidth: 1 });
        d.add(this._ledPower, this._ledRun, this._ledTrip);

        // 开关位置
        this._mainKnob = new Konva.Rect({ x: G.main.x + G.main.w - 48, y: G.main.y + 14, width: 34, height: 30, cornerRadius: 3, fill: '#37474f' });
        this._localKnob = new Konva.Rect({ x: G.local.x + G.local.w - 60, y: G.local.y + 14, width: 46, height: 30, cornerRadius: 3, fill: '#37474f' });
        d.add(this._mainKnob, this._localKnob);
        this._mainText = new Konva.Text({ x: G.main.x + G.main.w - 50, y: G.main.y + 20, width: 40, height: 20, text: 'OFF', fontSize: 10, align: 'center', fill: '#fff', fontFamily: 'Arial' });
        this._localText = new Konva.Text({ x: G.local.x + G.local.w - 62, y: G.local.y + 20, width: 50, height: 20, text: 'REMOTE', fontSize: 9, align: 'center', fill: '#fff', fontFamily: 'Arial' });
        d.add(this._mainText, this._localText);

        // 按钮状态灯
        this._feedLamp = new Konva.Circle({ x: G.feed.x + G.feed.w - 20, y: G.feed.y + 20, radius: 5, fill: '#2b2f2f', stroke: '#111', strokeWidth: 1 });
        this._heaterLamp = new Konva.Circle({ x: G.heater.x + G.heater.w - 20, y: G.heater.y + 20, radius: 5, fill: '#2b2f2f', stroke: '#111', strokeWidth: 1 });
        d.add(this._feedLamp, this._heaterLamp);

        // 温度显示
        this._tempText = new Konva.Text({
            x: G.temp.x + 8, y: G.temp.y + 24, width: G.temp.w - 16, height: 38,
            text: '98 °C', fontSize: 26, fontFamily: 'Consolas, monospace', fill: '#6dff9a',
        });
        d.add(this._tempText);

        // 压力表指针与数值
        this._waterNeedle = new Konva.Group({ x: G.waterGauge.cx, y: G.waterGauge.cy, rotation: -135 });
        this._waterNeedle.add(new Konva.Line({ points: [0, 6, 0, -G.waterGauge.r + 16], stroke: '#c62828', strokeWidth: 2.5 }));
        d.add(this._waterNeedle);
        this._waterText = new Konva.Text({
            x: G.waterGauge.cx - 44, y: G.waterGauge.cy + 30, width: 88, height: 22,
            text: '0.0 bar', fontSize: 13, align: 'center', fill: '#263238', fontFamily: 'Consolas, monospace',
        });
        d.add(this._waterText);

        this._airNeedle = new Konva.Group({ x: G.airGauge.cx, y: G.airGauge.cy, rotation: -135 });
        this._airNeedle.add(new Konva.Line({ points: [0, 6, 0, -G.airGauge.r + 16], stroke: '#c62828', strokeWidth: 2.5 }));
        d.add(this._airNeedle);
        this._airText = new Konva.Text({
            x: G.airGauge.cx - 44, y: G.airGauge.cy + 30, width: 88, height: 22,
            text: '0.0 bar', fontSize: 13, align: 'center', fill: '#263238', fontFamily: 'Consolas, monospace',
        });
        d.add(this._airText);

        // 报警灯
        this._alarmLamp = new Konva.Circle({ x: G.alarmLamp.x, y: G.alarmLamp.y, radius: G.alarmLamp.r, fill: '#3a0b0b', stroke: '#111', strokeWidth: 1.5 });
        d.add(this._alarmLamp);
        this._alarmText = new Konva.Text({
            x: 34, y: 748, width: 130, height: 40,
            text: '', fontSize: 10, fill: '#b71c1c',
            fontFamily: 'Arial, "Microsoft YaHei", sans-serif',
        });
        d.add(this._alarmText);

        // 振动值
        this._vibText = new Konva.Text({
            x: 34, y: 700, width: 220, height: 24,
            text: 'VIB 0.0 mm/s', fontSize: 12, fill: '#37474f', fontFamily: 'Consolas, monospace',
        });
        d.add(this._vibText);
    }

    _bindInteraction() {
        const G = this._geo;
        this.addClickablePart('main-power', G.main.x, G.main.y, G.main.w, G.main.h, true)
            .on('click tap', () => { const s = this._solver(); if (s) s.toggleMainPower(); this._syncVisuals(); });
        this.addClickablePart('local-remote', G.local.x, G.local.y, G.local.w, G.local.h, true)
            .on('click tap', () => { const s = this._solver(); if (s) s.toggleLocal(); this._syncVisuals(); });
        this.addClickablePart('start', G.start.x, G.start.y, G.start.w, G.start.h, true)
            .on('click tap', () => { const s = this._solver(); if (s) s.localStart(); this._syncVisuals(); });
        this.addClickablePart('stop', G.stop.x, G.stop.y, G.stop.w, G.stop.h, true)
            .on('click tap', () => { const s = this._solver(); if (s) s.pressStop(); this._syncVisuals(); });
        this.addClickablePart('emergency', G.emergency.x - G.emergency.r, G.emergency.y - G.emergency.r, G.emergency.r * 2, G.emergency.r * 2, true)
            .on('click tap', () => {
                const s = this._solver(); if (!s) return;
                if (s.m.emergency) { s.resetEmergency(); } else { s.emergencyStop(); }
                this._syncVisuals();
            });
        this.addClickablePart('feed-pump', G.feed.x, G.feed.y, G.feed.w, G.feed.h, true)
            .on('click tap', () => { const s = this._solver(); if (s) s.toggleFeedPump(); this._syncVisuals(); });
        this.addClickablePart('heater', G.heater.x, G.heater.y, G.heater.w, G.heater.h, true)
            .on('click tap', () => { const s = this._solver(); if (s) s.toggleHeater(); this._syncVisuals(); });
        this.addClickablePart('temp-inc', G.tempInc.x, G.tempInc.y, G.tempInc.w, G.tempInc.h, true)
            .on('click tap', () => { const s = this._solver(); if (s) s.setParam('sepTemp', s.getParam('sepTemp') + 1); this._syncVisuals(); });
        this.addClickablePart('temp-dec', G.tempDec.x, G.tempDec.y, G.tempDec.w, G.tempDec.h, true)
            .on('click tap', () => { const s = this._solver(); if (s) s.setParam('sepTemp', s.getParam('sepTemp') - 1); this._syncVisuals(); });
        this.addClickablePart('reset', G.reset.x, G.reset.y, G.reset.w, G.reset.h, true)
            .on('click tap', () => { const s = this._solver(); if (s) s.pressAlarmReset(); this._syncVisuals(); });
        this.addClickablePart('lamp-test', G.lampTest.x, G.lampTest.y, G.lampTest.w, G.lampTest.h, true)
            .on('click tap', () => { this._lampTestUntil = (performance.now ? performance.now() : Date.now()) + 1000; this._syncVisuals(); });
    }

    _syncVisuals() {
        const s = this._solver();
        const m = s ? s.m : null;
        if (!m) return;
        const G = this._geo;

        this._ampNeedle.rotation(-120 + clamp(m.motor.current / 30, 0, 1) * 240);
        this._ampText.text(`${m.motor.current.toFixed(1)} A`);
        this._ampText.fill(m.motor.current > 18 ? '#c62828' : '#263238');
        this._ampText.fill(m.motor.current > 18 ? '#c62828' : '#263238');

        this._ledPower.fill(m.mainPower ? '#27e05a' : '#2b2f2f');
        this._ledRun.fill(m.motor.on ? '#27e05a' : '#2b2f2f');
        this._ledTrip.fill(m.motor.trip || m.emergency ? '#ff2d2d' : '#2b2f2f');

        this._mainText.text(m.mainPower ? 'ON' : 'OFF');
        this._mainKnob.fill(m.mainPower ? '#1b5e20' : '#37474f');
        this._localText.text(m.local ? 'LOCAL' : 'REMOTE');
        this._localKnob.fill(m.local ? '#f9a825' : '#37474f');

        this._feedLamp.fill(m.feed.pumpOn ? '#27e05a' : '#2b2f2f');
        this._heaterLamp.fill(m.feed.heaterOn ? '#ffb300' : '#2b2f2f');

        this._tempText.text(`${m.feed.temp.toFixed(1)} °C`);
        this._tempText.fill(m.feed.temp < 90 ? '#ff8a80' : '#6dff9a');

        this._waterNeedle.rotation(-135 + clamp(m.water.supply / 10, 0, 1) * 270);
        this._waterText.text(`${m.water.supply.toFixed(1)} bar`);
        this._waterText.fill(m.water.supply < 2 ? '#c62828' : '#263238');

        this._airNeedle.rotation(-135 + clamp(m.water.air / 10, 0, 1) * 270);
        this._airText.text(`${m.water.air.toFixed(1)} bar`);
        this._airText.fill(m.water.air < 5 ? '#c62828' : '#263238');

        this._vibText.text(`VIB ${m.bowl.vibration.toFixed(1)} mm/s`);
        this._vibText.fill(m.bowl.vibration > m.params.vibrationTrip ? '#c62828' : (m.bowl.vibration > m.params.vibrationWarn ? '#ef6c00' : '#37474f'));

        const now = performance.now ? performance.now() : Date.now();
        const test = now < this._lampTestUntil;
        const flash = Math.floor(now / 350) % 2;
        this._alarmLamp.fill(m.alarmActive ? (m.alarmAck ? '#ff2d2d' : (flash ? '#ff2d2d' : '#3a0b0b')) : '#3a0b0b');
        if (test) this._alarmLamp.fill(flash ? '#ffb300' : '#3a0b0b');
        const active = m.alarms.find(a => a.active);
        this._alarmText.text(active ? `${active.ack ? '' : '[未确认] '}${active.code} ${active.text}` : '');

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

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

export default PurifierLocalPanel;
