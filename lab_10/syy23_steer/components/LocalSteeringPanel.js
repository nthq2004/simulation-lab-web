import { BaseComponent } from './BaseComponent.js';

/**
 * 机旁控制面板（上下两屏，1#/2# 独立）
 * 每箱：
 *   第一行：电源开关（关/开）、电源指示灯、故障跳闸指示灯
 *   第二行：备用开关（关/开，备用投入可自起动）、起动按钮、停止按钮（带灯）
 *   第三行：机旁遥控选择开关（左上机旁 / 右上遥控）、应急操舵开关（左转舵 / 右转舵，按住操舵）
 */
export class LocalSteeringPanel extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.W = Math.max(340, config.width || 360);
        this.H = Math.max(680, config.height || 740);
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

    _label(g, x, y, text, size = 12, fill = '#222', bold = false, align = 'left', width = 0) {
        return g.add(new Konva.Text({
            x, y, text, fontSize: size, fill, width: width || undefined,
            fontStyle: bold ? 'bold' : 'normal', align, fontFamily: 'Arial, "Microsoft YaHei", sans-serif',
            listening: false,
        }));
    }

    _recalcGeometry() {
        const W = this.W;
        const boxH = 336, gap = 8, top = 8;
        this._geo = {
            boxes: [
                { n: 1, x: 8, y: top, w: W - 16, h: boxH },
                { n: 2, x: 8, y: top + boxH + gap, w: W - 16, h: boxH },
            ],
            row1: (b) => b.y + 92,
            row2: (b) => b.y + 186,
            row3: (b) => b.y + 278,
            col: { sw: 62, lampA: 172, lampB: 286, sw2: 62, start: 176, stop: 290, localS: 88, emerg: 252 },
            btnR: 27,
            knobR: 22,
        };
    }

    _drawPanel(g, x, y, w, h) {
        g.add(new Konva.Rect({
            x, y, width: w, height: h, cornerRadius: 10,
            fillLinearGradientStartPoint: { x: 0, y: 0 }, fillLinearGradientEndPoint: { x: w, y: h },
            fillLinearGradientColorStops: [0, '#f0f0ec', 0.55, '#d8d9d5', 1, '#bfc1bd'],
            stroke: '#5f6463', strokeWidth: 3,
        }));
        g.add(new Konva.Rect({
            x: x + 8, y: y + 8, width: w - 16, height: h - 16,
            fill: 'transparent', stroke: '#8b908e', strokeWidth: 1.2, cornerRadius: 7,
        }));
    }

    _drawStaticParts() {
        const g = this._staticGroup, G = this._geo, C = G.col;

        G.boxes.forEach((b) => {
            this._drawPanel(g, b.x, b.y, b.w, b.h);
            g.add(new Konva.Rect({
                x: b.x + 16, y: b.y + 10, width: b.w - 32, height: 28,
                fill: '#f4f4f0', stroke: '#888d8c', strokeWidth: 1.2, cornerRadius: 4,
            }));
            this._label(g, b.x + 16, b.y + 16, `${b.n}# 舵机起动控制箱`, 14, '#263238', true, 'center', b.w - 32);

            const r1 = G.row1(b), r2 = G.row2(b), r3 = G.row3(b);

            // 第一行
            this._label(g, C.sw - 34, r1 - 48, '电源开关', 12, '#263238', true, 'center', 68);
            this._label(g, C.sw - 42, r1 - 32, '关', 12, '#b71c1c', true, 'center', 24);
            this._label(g, C.sw + 12, r1 - 32, '开', 12, '#1b5e20', true, 'center', 24);
            this._label(g, C.lampA - 34, r1 - 36, '电源', 12, '#263238', true, 'center', 68);
            this._label(g, C.lampB - 42, r1 - 36, '故障跳闸', 12, '#263238', true, 'center', 84);
            [C.lampA, C.lampB].forEach((cx) => {
                g.add(new Konva.Circle({ x: cx, y: r1, radius: 16, fill: '#c7cac6', stroke: '#777c7a', strokeWidth: 1.4 }));
            });

            // 第二行
            this._label(g, C.sw2 - 30, r2 - 52, '备用', 12, '#263238', true, 'center', 60);
            this._label(g, C.start - 30, r2 - 50, '起动', 12, '#1b5e20', true, 'center', 60);
            this._label(g, C.stop - 30, r2 - 50, '停止', 12, '#b71c1c', true, 'center', 60);
            // 第三行：机旁遥控选择（左上=机旁，右上=遥控）
            this._label(g, C.localS - 44, r3 - 36, '机旁', 12, '#6d4c41', true, 'center', 34);
            this._label(g, C.localS + 14, r3 - 36, '遥控', 12, '#1565c0', true, 'center', 34);
            this._label(g, C.localS - 48, r3 + 36, '机旁遥控选择', 12, '#546e7a', false, 'center', 96);
            // 应急操舵（复制遥控面板非随动操舵开关外观）
            this._label(g, C.emerg - 70, r3 - 32, '左转舵', 12, '#b71c1c', true, 'right', 58);
            this._label(g, C.emerg + 12, r3 - 32, '右转舵', 12, '#1b5e20', true, 'left', 58);
            this._label(g, C.emerg - 34, r3 + 36, '应急操舵', 12, '#546e7a', false, 'center', 68);
        });

    }

    _knob(cx, cy, r) {
        this._dyn.add(new Konva.Circle({ x: cx, y: cy, radius: r + 4, fill: '#d0d2cf', stroke: '#6a6f6d', strokeWidth: 1.5 }));
        this._dyn.add(new Konva.Circle({ x: cx, y: cy, radius: r, fill: '#3b3f41', stroke: '#111', strokeWidth: 1.5 }));
        const grp = new Konva.Group({ x: cx, y: cy });
        grp.add(new Konva.Rect({ x: -3, y: -r + 5, width: 6, height: r - 10, fill: '#f2f2ee', cornerRadius: 2 }));
        this._dyn.add(grp);
        return grp;
    }

    _lamp(cx, cy, r, dark) {
        const c = new Konva.Circle({ x: cx, y: cy, radius: r, fill: dark, stroke: '#333', strokeWidth: 1 });
        this._dyn.add(c);
        return c;
    }

    _litButton(cx, cy, r, lensDark) {
        this._dyn.add(new Konva.Circle({ x: cx, y: cy, radius: r + 4, fill: '#d0d2cf', stroke: '#6a6f6d', strokeWidth: 1.6 }));
        this._dyn.add(new Konva.Circle({ x: cx, y: cy, radius: r, fill: '#eceeeb', stroke: '#9aa09d', strokeWidth: 1.2 }));
        const lens = new Konva.Circle({ x: cx, y: cy, radius: r - 5, fill: lensDark, stroke: '#3b3f41', strokeWidth: 1.2 });
        this._dyn.add(lens);
        return lens;
    }

    _createDynamicNodes() {
        const G = this._geo, C = G.col;
        this._dyn = new Konva.Group({ name: 'local_dyn' });
        this._dynamicGroup.add(this._dyn);

        this._knobMain = [];
        this._knobStandby = [];
        this._standbyPlate = [];
        this._knobLocal = [];
        this._knobEmerg = [];
        this._lamps = [];
        this._lensStart = [];
        this._lensStop = [];

        G.boxes.forEach((b) => {
            const r1 = G.row1(b), r2 = G.row2(b), r3 = G.row3(b);
            this._knobMain.push(this._knob(C.sw, r1, G.knobR));
            this._lamps.push({
                power: this._lamp(C.lampA, r1, 13, '#3a0808'),
                trip: this._lamp(C.lampB, r1, 13, '#3a0808'),
            });
            this._standbyPlate.push(this._lamp(C.sw2, r2, G.knobR + 10, 'rgba(0,0,0,0)'));
            this._knobStandby.push(this._knob(C.sw2, r2, G.knobR));
            this._lensStart.push(this._litButton(C.start, r2 + 2, G.btnR, '#14501a'));
            this._lensStop.push(this._litButton(C.stop, r2 + 2, G.btnR, '#ff2d2d'));
            this._knobLocal.push(this._knob(C.localS, r3 + 4, G.knobR));
            // 应急操舵：三位旋钮（左/中/右），按住两侧热区操舵并联动旋钮转动
            this._knobEmerg.push(this._knob(C.emerg, r3 + 4, G.knobR + 2));
        });
    }

    _part(partId, x, y, w, h, onClick) {
        const hit = this.addClickablePart(partId, x, y, w, h, true);
        if (hit) {
            hit.on('mousedown touchstart', (e) => { e.cancelBubble = true; });
            hit.on('click tap', (e) => { e.cancelBubble = true; onClick(); });
        }
        return hit;
    }

    _solver() {
        return this.sys && this.sys.steerSolver ? this.sys.steerSolver : null;
    }

    _releaseManual() {
        const sv = this._solver();
        if (sv) {
            let released = false;
            [1, 2].forEach(n => {
                const p = sv.m.pump[n];
                if (p && p.emerg) { p.emerg = 0; released = true; }
            });
            // 应急操舵松手后保持当前舵角（不做随动回零）：把舵轮角度对到当前舵角
            if (released) {
                // 让刚刚操舵的那台机组继续执行“伺服回中”，回中完成后才交还给所选机组
                sv.m.returnSys = sv.m.activeSys || sv.m.sys;
                if (sv.m.mode === 'manual') {
                    sv.m.helmAngle = sv.m.rudder * 18;
                    sv.m.helm = Math.max(-1, Math.min(1, sv.m.helmAngle / 630));
                    sv.m.rudderCmd = sv.m.rudder;
                }
            }
        }
        this._syncVisuals();
    }

    _holdNfu(partId, x, y, w, h, dir, n) {
        const hit = this.addClickablePart(partId, x, y, w, h, true);
        if (!hit) return;
        hit.on('mousedown touchstart', (e) => {
            e.cancelBubble = true;
            const sv = this._solver();
            if (!sv) return;
            const p = sv.m.pump[n];
            if (!p || !p.local) return;                 // 只有本机在“机旁”位才允许应急操舵
            sv.m.emergencyHold = false;
            p.emerg = dir === 'port' ? -1 : 1;
            this._syncVisuals();
        });
        hit.on('mouseup touchend mouseleave', () => this._releaseManual());
    }

    _bindInteraction() {
        const G = this._geo, C = G.col, s = () => this._solver();

        G.boxes.forEach((b) => {
            const n = b.n;
            const r1 = G.row1(b), r2 = G.row2(b), r3 = G.row3(b);

            this._part(n === 1 ? 'main-power' : 'main-power2', C.sw - 28, r1 - 26, 56, 56, () => {
                const sv = s(); if (sv) sv.toggleUnitPower(n); this._syncVisuals();
            });
            this._part(n === 1 ? 'standby' : 'standby2', C.sw2 - 28, r2 - 26, 56, 56, () => {
                const sv = s(); if (sv) sv.toggleUnitStandby(n); this._syncVisuals();
            });
            this._part(n === 1 ? 'start' : 'start2', C.start - 32, r2 - 30, 64, 64, () => {
                const sv = s(); if (sv) sv.startPump(n); this._syncVisuals();
            });
            this._part(n === 1 ? 'stop' : 'stop2', C.stop - 32, r2 - 30, 64, 64, () => {
                const sv = s(); if (sv) sv.stopPump(n); this._syncVisuals();
            });
            this._part(`local-mode${n}`, C.localS - 26, r3 - 22, 52, 52, () => {
                const sv = s(); if (!sv) return;
                const p = sv.m.pump[n];
                sv.setUnitLocal(n, !(p && p.local));
                if (!sv.m.pump[n].local) this._releaseManual();
                this._syncVisuals();
            });
            // 应急操舵：左/右按住
            this._holdNfu(`emerg${n}-port`, C.emerg - 44, r3 - 22, 42, 52, 'port', n);
            this._holdNfu(`emerg${n}-stbd`, C.emerg + 2, r3 - 22, 42, 52, 'starboard', n);
        });

        if (this.sys && this.sys.stage) this.sys.stage.on('mouseup touchend', () => this._releaseManual());

        // 兼容旧工作流
        this._part('auto-power', 4, this.H - 40, 40, 36, () => {
            const sv = s(); if (sv) sv.toggleAutoPower(); this._syncVisuals();
        });
        this._part('auto-engage', 48, this.H - 40, 40, 36, () => {
            const sv = s(); if (sv) sv.toggleAutoEngaged(); this._syncVisuals();
        });
        this._part('sys-1', G.boxes[0].x + 16, G.boxes[0].y + 10, G.boxes[0].w - 32, 28, () => {
            const sv = s(); if (sv) sv.selectSystem(1); this._syncVisuals();
        });
        this._part('sys-2', G.boxes[1].x + 16, G.boxes[1].y + 10, G.boxes[1].w - 32, 28, () => {
            const sv = s(); if (sv) sv.selectSystem(2); this._syncVisuals();
        });
    }

    _syncVisuals() {
        const s = this._solver();
        if (!s || !this._knobMain.length) return;
        const m = s.m;

        this._knobMain.forEach((k, i) => k.rotation((m.pump[i + 1] && m.pump[i + 1].power) ? 42 : -42));
        this._knobStandby.forEach((k, i) => k.rotation((m.pump[i + 1] && m.pump[i + 1].standby) ? 42 : -42));
        this._knobLocal.forEach((k, i) => k.rotation((m.pump[i + 1] && m.pump[i + 1].local) ? -42 : 42));
        this._knobEmerg.forEach((k, i) => {
            const e = (m.pump[i + 1] && m.pump[i + 1].emerg) || 0;
            k.rotation(e > 0 ? 45 : (e < 0 ? -45 : 0));
        });

        this._lamps.forEach((L, i) => {
            const p = m.pump[i + 1] || {};
            L.power.fill(p.power ? '#25e04a' : '#3a0808');
            L.trip.fill(p.trip ? '#ff2d2d' : '#3a0808');
            const standbyReady = !!(p.power && p.standby && !p.trip && !p.running);
            this._standbyPlate[i].fill(standbyReady ? '#ffd400' : 'rgba(0,0,0,0)');
            this._lensStart[i].fill(p.running ? '#31d24b' : '#14501a');
            this._lensStop[i].fill(p.running ? '#5c1010' : '#ff2d2d');
        });

        if (this.sys && this.sys.requestRedraw) this.sys.requestRedraw();
    }

    tick() {
        this._syncVisuals();
        this._refreshIfDirty();
    }
}
