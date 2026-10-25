import { BaseComponent } from './BaseComponent.js';

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/**
 * 舵机控制遥控面板
 * 第一行：1# 舵机泵 起动(带灯) / 停止(带灯)、1# 泵故障灯、1# 油位极低灯
 * 第二行：2# 舵机泵 起动(带灯) / 停止(带灯)、2# 泵故障灯、2# 油位极低灯
 * 第三行：1#/2# 隔离阀动作指示灯（方形）、试灯按钮、复位按钮
 */
export class GearRemotePanel extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.W = Math.max(520, config.width || 560);
        this.H = Math.max(280, config.height || 310);
        this.type = 'gear_remote_panel';
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

    _label(g, x, y, text, size = 12, fill = '#222', bold = false, align = 'left', width = 0) {
        return g.add(new Konva.Text({
            x, y, text, fontSize: size, fill, width: width || undefined,
            fontStyle: bold ? 'bold' : 'normal', align, fontFamily: 'Arial, "Microsoft YaHei", sans-serif',
            listening: false,
        }));
    }

    _recalcGeometry() {
        const W = this.W, H = this.H;
        const rowY = [92, 168, 244];
        this._geo = {
            main: { x: 0, y: 0, w: W, h: H, r: 10 },
            inner: { x: 8, y: 8, w: W - 16, h: H - 16, r: 7 },
            title: { x: 26, y: 12, w: W - 52, h: 34 },
            rows: rowY,
            pumpLabelX: 24,
            btnStart: { cx: 152, r: 22 },
            btnStop: { cx: 232, r: 22 },
            tripLamp: { cx: 330, r: 15 },
            oilLamp: { cx: 440, r: 15 },
            iso1: { x: 136, y: rowY[2] - 20, s: 30 },
            iso2: { x: 220, y: rowY[2] - 20, s: 30 },
            testBtn: { cx: 332, cy: rowY[2], r: 21 },
            resetBtn: { cx: 440, cy: rowY[2], r: 21 },
            footer: { x: 26, y: H - 25, w: W - 52 },
        };
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
            x: G.inner.x, y: G.inner.y, width: G.inner.w, height: G.inner.h,
            fill: 'transparent', stroke: '#8b908e', strokeWidth: 1.2, cornerRadius: G.inner.r,
        }));
        g.add(new Konva.Rect({
            x: G.title.x, y: G.title.y, width: G.title.w, height: G.title.h,
            fill: '#f4f4f0', stroke: '#888d8c', strokeWidth: 1.2, cornerRadius: 4,
        }));
        this._label(g, G.title.x, G.title.y + 8, '舵机控制遥控面板', 17, '#263238', true, 'center', G.title.w);

        // 金属环形按钮底座（示意为图例样式）
        G.rows.slice(0, 2).forEach((y, i) => {
            const n = i + 1;
            this._label(g, G.pumpLabelX, y - 8, `${n}# 舵机`, 13, '#263238', true);
            this._label(g, G.btnStart.cx - 32, y - G.btnStart.r - 19, '起动', 12, '#1b5e20', true, 'center', 60);
            this._label(g, G.btnStop.cx - 32, y - G.btnStop.r - 19, '停止', 12, '#8e1414', true, 'center', 60);
            this._label(g, G.tripLamp.cx - 43, y + G.tripLamp.r + 6, '泵故障', 12, '#37474f', true, 'center', 80);
            this._label(g, G.oilLamp.cx - 43, y + G.oilLamp.r + 6, '油位极低', 12, '#37474f', true, 'center', 80);
            g.add(new Konva.Circle({ x: G.tripLamp.cx, y, radius: G.tripLamp.r + 3, fill: '#c7cac6', stroke: '#777c7a', strokeWidth: 1.2 }));
            g.add(new Konva.Circle({ x: G.oilLamp.cx, y, radius: G.oilLamp.r + 3, fill: '#c7cac6', stroke: '#777c7a', strokeWidth: 1.2 }));
        });

        // 第三行标签
        this._label(g, G.iso1.x - 16, G.iso1.y + G.iso1.s + 5, '1#隔离阀', 12, '#37474f', true, 'center', 66);
        this._label(g, G.iso2.x - 16, G.iso2.y + G.iso2.s + 5, '2#隔离阀', 12, '#37474f', true, 'center', 66);

        this._label(g, G.footer.x, G.footer.y, '起动灯绿色=泵运行；停止灯红色=泵停止  ·  试灯：按住点亮全部指示灯', 10, '#546e7a', false, 'left', G.footer.w);
    }

    _metalButton(cx, cy, r, lensDark) {
        const g = this._dyn;
        g.add(new Konva.Circle({ x: cx, y: cy, radius: r + 4, fill: '#d0d2cf', stroke: '#6a6f6d', strokeWidth: 1.6 }));
        g.add(new Konva.Circle({ x: cx, y: cy, radius: r, fill: '#eceeeb', stroke: '#9aa09d', strokeWidth: 1.2 }));
        const lens = new Konva.Circle({ x: cx, y: cy, radius: r - 5, fill: lensDark, stroke: '#3b3f41', strokeWidth: 1.2 });
        g.add(lens);
        return lens;
    }

    _createDynamicNodes() {
        const G = this._geo;
        const d = this._dynamicGroup;
        this._dyn = new Konva.Group({ name: 'gear_remote_dyn' });
        d.add(this._dyn);

        this._lensStart = [this._metalButton(G.btnStart.cx, G.rows[0], G.btnStart.r, '#1b5e20'),
            this._metalButton(G.btnStart.cx, G.rows[1], G.btnStart.r, '#1b5e20')];
        this._lensStop = [this._metalButton(G.btnStop.cx, G.rows[0], G.btnStop.r, '#5c1010'),
            this._metalButton(G.btnStop.cx, G.rows[1], G.btnStop.r, '#5c1010')];

        const keep = (node) => { this._dyn.add(node); return node; };
        this._tripLamps = G.rows.slice(0, 2).map((y) => keep(new Konva.Circle({
            x: G.tripLamp.cx, y, radius: G.tripLamp.r, fill: '#3a0808', stroke: '#333', strokeWidth: 1,
        })));
        this._oilLamps = G.rows.slice(0, 2).map((y) => keep(new Konva.Circle({
            x: G.oilLamp.cx, y, radius: G.oilLamp.r, fill: '#3a2a05', stroke: '#333', strokeWidth: 1,
        })));

        this._isoLamps = [
            keep(new Konva.Rect({ x: G.iso1.x, y: G.iso1.y, width: G.iso1.s, height: G.iso1.s, fill: '#5a1010', stroke: '#2b2b2b', strokeWidth: 1.4, cornerRadius: 3 })),
            keep(new Konva.Rect({ x: G.iso2.x, y: G.iso2.y, width: G.iso2.s, height: G.iso2.s, fill: '#5a1010', stroke: '#2b2b2b', strokeWidth: 1.4, cornerRadius: 3 })),
        ];

        this._testBtn = keep(new Konva.Circle({
            x: G.testBtn.cx, y: G.testBtn.cy, radius: G.testBtn.r, fill: '#d9dbd8', stroke: '#6d7271', strokeWidth: 1.6,
        }));
        this._resetBtn = keep(new Konva.Circle({
            x: G.resetBtn.cx, y: G.resetBtn.cy, radius: G.resetBtn.r, fill: '#d9dbd8', stroke: '#6d7271', strokeWidth: 1.6,
        }));
        this._label(this._dyn, G.testBtn.cx - 16, G.testBtn.cy - 7, '试灯', 11, '#263238', true, 'center', 32);
        this._label(this._dyn, G.resetBtn.cx - 16, G.resetBtn.cy - 7, '复位', 11, '#263238', true, 'center', 32);
    }

    _part(partId, x, y, w, h, onClick) {
        const hit = this.addClickablePart(partId, x, y, w, h, true);
        if (hit) {
            hit.on('mousedown touchstart', (e) => { e.cancelBubble = true; });
            hit.on('click tap', (e) => { e.cancelBubble = true; onClick(); });
        }
        return hit;
    }

    _bindInteraction() {
        const G = this._geo, s = () => this._solver();
        // 起停按钮
        G.rows.slice(0, 2).forEach((y, i) => {
            const n = i + 1;
            this._part(`start${n}`, G.btnStart.cx - G.btnStart.r - 4, y - G.btnStart.r - 4, (G.btnStart.r + 4) * 2, (G.btnStart.r + 4) * 2,
                () => { const sv = s(); if (sv) sv.startPump(n); this._syncVisuals(); });
            this._part(`stop${n}`, G.btnStop.cx - G.btnStop.r - 4, y - G.btnStop.r - 4, (G.btnStop.r + 4) * 2, (G.btnStop.r + 4) * 2,
                () => { const sv = s(); if (sv) sv.stopPump(n); this._syncVisuals(); });
        });
        // 试灯（按住）
        const test = this._part('lamp-test', G.testBtn.cx - G.testBtn.r - 3, G.testBtn.cy - G.testBtn.r - 3,
            (G.testBtn.r + 3) * 2, (G.testBtn.r + 3) * 2, () => { this._lampTest = true; this._testUntil = performance.now() + 2200; this._syncVisuals(); });
        if (test) test.on('mouseup touchend', () => { this._lampTest = false; this._syncVisuals(); });
        // 复位
        this._part('lamp-reset', G.resetBtn.cx - G.resetBtn.r - 3, G.resetBtn.cy - G.resetBtn.r - 3,
            (G.resetBtn.r + 3) * 2, (G.resetBtn.r + 3) * 2, () => {
                const sv = s();
                if (sv) { sv.resetPump(1); sv.resetPump(2); }
                this._lampTest = false;
                this._syncVisuals();
            });
    }

    _solver() {
        return this.sys && this.sys.steerSolver ? this.sys.steerSolver : null;
    }

    _isoStates() {
        const hyd = this.sys && this.sys.comps ? this.sys.comps.hyd : null;
        const out = [false, false];
        if (hyd && hyd._unitDyn) {
            hyd._unitDyn.forEach((d, i) => {
                if (i < 2 && d.isoState) out[i] = !!(d.isoState.pressed || d.isoState.coil);
            });
        }
        return out;
    }

    _syncVisuals() {
        const sv = this._solver();
        if (!sv || !this._lensStart) return;
        const m = sv.m;
        if (this._lampTest && this._testUntil && performance.now() > this._testUntil) this._lampTest = false;
        const test = !!this._lampTest;

        [1, 2].forEach((n, i) => {
            const p = m.pump[n] || {};
            const runLit = (!!p.running && !p.local) || test;   // 机旁位的舵机遥控指示灯不亮
            const stopLit = !p.running || test;
            // 起动按钮：泵运行亮绿
            this._lensStart[i].fill(runLit ? '#31d24b' : '#14501a');
            // 停止指示灯：舵机不运行时亮红（与泵故障灯同色），运行中暗红
            this._lensStop[i].fill(stopLit ? '#ff2d2d' : '#5c1010');
            // 泵故障
            const trip = !!p.trip;
            this._tripLamps[i].fill((trip || test) ? '#ff2d2d' : '#3a0808');
            // 油位极低（<18%）
            const lowOil = (p.oil !== undefined) && p.oil < 18;
            this._oilLamps[i].fill((lowOil || test) ? '#ffb300' : '#3a2a05');
        });

        const iso = this._isoStates();
        this._isoLamps.forEach((lamp, i) => {
            lamp.fill((iso[i] || test) ? '#ff2d2d' : '#5a1010');
        });

        if (this.sys && this.sys.requestRedraw) this.sys.requestRedraw();
    }

    tick() {
        this._syncVisuals();
        this._refreshIfDirty();
    }
}
