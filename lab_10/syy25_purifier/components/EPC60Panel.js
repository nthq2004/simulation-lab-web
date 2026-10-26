import Konva from 'konva';
import { BaseComponent } from './BaseComponent.js';

/**
 * EPC60Panel — Alfa Laval EPC-60 分油机控制器面板（按实船面板重绘）
 *
 * 外观：浅蓝色外壳 + 灰色 EPC 面板 + 绿色 LCD + 数字键盘 + 功能图标键；
 * 下方：电源开关、应急停止、电流表。
 *
 * 保留对工作流公开的 part id：
 *  separation / stop / discharge / alarm-reset / info / enter / plus / minus / power
 * 新增：key-0~9、key-dot、key-back、cip、system、emergency
 */
export class EPC60Panel extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.W = Math.max(700, config.width || 780);
        this.H = Math.max(860, config.height || 1000);
        this.type = 'epc60_panel';
        this.special = 'epc60';
        this.cache = 'fixed';

        this._ui = {
            page: 'main', menu: 0, param: 0, editing: false,
            editKey: null, editVal: 0, editStr: '', alarm: 0, info: 0,
        };

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
            chassis: { x: 0, y: 0, w: W, h: H, r: 18 },
            panel: { x: 30, y: 30, w: W - 60, h: 620, r: 12 },
            logo: { cx: W / 2, cy: 66 },
            title: { x: 86, y: 126 },
            lcd: { x: 86, y: 164, w: 382, h: 128 },
            keys: { x: 502, y: 88, s: 54, gap: 7 },
            start: { x: 58, y: 318, w: 56, h: 82 },
            stop: { x: 58, y: 410, w: 56, h: 82 },
            icons: { x0: 136, y0: 318, w: 78, h: 78, gapX: 82, gapY: 92 },
            emergency: { cx: W - 150, cy: 690, r: 50 },
            power: { x: 78, y: 760, w: 164, h: 180 },
            ammeter: { x: W - 330, y: 750, w: 280, h: 200 },
            pageNo: { x: 40, y: H - 54 },
        };
    }

    _label(g, x, y, text, size = 13, fill = '#263238', bold = false, align = 'left', width = 0) {
        const opts = {
            x, y, text, fontSize: size,
            fontStyle: bold ? 'bold' : 'normal',
            fill, align, fontFamily: 'Arial, "Microsoft YaHei", sans-serif',
        };
        if (width) opts.width = width;
        g.add(new Konva.Text(opts));
    }

    _iconBowl(g, x, y, s = 44, stroke = '#333') {
        g.add(new Konva.Arc({ x, y, innerRadius: s * 0.18, outerRadius: s * 0.48, angle: 180, rotation: 180, fill: '#f5f5f5', stroke, strokeWidth: 2 }));
        g.add(new Konva.Line({ points: [x - s * 0.42, y, x + s * 0.42, y], stroke, strokeWidth: 2 }));
        g.add(new Konva.Line({ points: [x - s * 0.22, y - s * 0.18, x - s * 0.22, y + s * 0.18], stroke, strokeWidth: 1.5 }));
        g.add(new Konva.Line({ points: [x + s * 0.22, y - s * 0.18, x + s * 0.22, y + s * 0.18], stroke, strokeWidth: 1.5 }));
    }

    _iconDischarge(g, x, y, s = 40, stroke = '#333') {
        g.add(new Konva.Line({ points: [x - s * 0.4, y - s * 0.25, x + s * 0.4, y - s * 0.25, x, y + s * 0.45], closed: true, fill: '#f5f5f5', stroke, strokeWidth: 2 }));
    }

    _iconWater(g, x, y, s = 40, stroke = '#333') {
        g.add(new Konva.Line({ points: [x, y - s * 0.45, x - s * 0.32, y + s * 0.1, x - s * 0.2, y + s * 0.38, x + s * 0.2, y + s * 0.38, x + s * 0.32, y + s * 0.1], closed: true, fill: '#f5f5f5', stroke, strokeWidth: 2, tension: 0.3 }));
    }

    _iconGlobe(g, x, y, s = 40, stroke = '#333') {
        g.add(new Konva.Circle({ x, y, radius: s * 0.4, fill: '#f5f5f5', stroke, strokeWidth: 2 }));
        g.add(new Konva.Ellipse({ x, y, radiusX: s * 0.18, radiusY: s * 0.4, stroke, strokeWidth: 1.2 }));
        g.add(new Konva.Line({ points: [x - s * 0.4, y, x + s * 0.4, y], stroke, strokeWidth: 1.2 }));
    }

    _drawStaticParts() {
        const g = this._staticGroup, G = this._geo, W = this.W, H = this.H;

        // 浅蓝色外壳
        g.add(new Konva.Rect({
            x: 0, y: 0, width: W, height: H, cornerRadius: G.chassis.r,
            fill: '#a9cadb', stroke: '#5f8fa6', strokeWidth: 2,
        }));
        // 灰色 EPC 面板
        g.add(new Konva.Rect({
            x: G.panel.x, y: G.panel.y, width: G.panel.w, height: G.panel.h, cornerRadius: G.panel.r,
            fill: '#9a9a9a', stroke: '#7f7f7f', strokeWidth: 2,
        }));

        // ALFA LAVAL 手写体 logo（文字 + 波浪线）
        this._label(g, G.logo.cx - 92, G.logo.cy - 16, 'ALFA LAVAL', 26, '#2b2bb5', true, 'center', 184);
        g.add(new Konva.Line({ points: [G.logo.cx - 96, G.logo.cy - 30, G.logo.cx - 60, G.logo.cy - 22, G.logo.cx - 20, G.logo.cy - 32, G.logo.cx + 22, G.logo.cy - 22, G.logo.cx + 62, G.logo.cy - 30, G.logo.cx + 96, G.logo.cy - 22], stroke: '#2b2bb5', strokeWidth: 2.5, tension: 0.35 }));
        g.add(new Konva.Line({ points: [G.logo.cx - 96, G.logo.cy + 14, G.logo.cx - 60, G.logo.cy + 22, G.logo.cx - 20, G.logo.cy + 12, G.logo.cx + 22, G.logo.cy + 22, G.logo.cx + 62, G.logo.cy + 14, G.logo.cx + 96, G.logo.cy + 22], stroke: '#2b2bb5', strokeWidth: 2.5, tension: 0.35 }));

        this._label(g, G.title.x, G.title.y, 'EPC 60', 22, '#f7f7f7', true);

        // LCD 外框
        g.add(new Konva.Rect({
            x: G.lcd.x - 6, y: G.lcd.y - 6, width: G.lcd.w + 12, height: G.lcd.h + 12,
            cornerRadius: 5, fill: '#3f3f3f', stroke: '#222', strokeWidth: 2,
        }));

        // 数字键盘
        const K = G.keys;
        const numLabels = ['7', '8', '9', '4', '5', '6', '1', '2', '3', '.', '0', '↵'];
        const keyDefs = [];
        numLabels.forEach((label, i) => {
            const col = i % 3;
            const row = Math.floor(i / 3);
            keyDefs.push({ id: label === '↵' ? 'enter' : (label === '.' ? 'key-dot' : `key-${label}`), label, col, row });
        });
        keyDefs.push({ id: 'plus', label: '▲', col: 3, row: 0 });
        keyDefs.push({ id: 'minus', label: '▼', col: 3, row: 1 });
        keyDefs.push({ id: 'back', label: '⌫', col: 3, row: 2 });
        keyDefs.push({ id: 'info', label: 'i', col: 3, row: 3 });

        this._keyList = keyDefs.map(k => {
            const x = K.x + k.col * (K.s + K.gap);
            const y = K.y + k.row * (K.s + K.gap);
            g.add(new Konva.Rect({ x, y, width: K.s, height: K.s, cornerRadius: 4, fill: '#f5f5f5', stroke: '#555', strokeWidth: 1.5 }));
            this._label(g, x, y + 14, k.label, k.label.length > 1 ? 16 : 22, '#1b1b1b', true, 'center', K.s);
            return { id: k.id, x, y, w: K.s, h: K.s };
        });

        // 起动/停止
        const S = G.start, P = G.stop;
        g.add(new Konva.Rect({ x: S.x, y: S.y, width: S.w, height: S.h, cornerRadius: 6, fill: '#2f6b1f', stroke: '#1b2f12', strokeWidth: 2 }));
        g.add(new Konva.Rect({ x: P.x, y: P.y, width: P.w, height: P.h, cornerRadius: 6, fill: '#7f1d1d', stroke: '#3a0b0b', strokeWidth: 2 }));
        this._label(g, S.x, S.y + 26, 'I', 30, '#fff', true, 'center', S.w);
        this._label(g, P.x, P.y + 26, 'O', 30, '#fff', true, 'center', P.w);
        this._label(g, S.x - 14, S.y + S.h + 2, 'START', 9, '#333', true, 'center', S.w + 28);
        this._label(g, P.x - 14, P.y + P.h + 2, 'STOP', 9, '#333', true, 'center', P.w + 28);

        // 图标功能键
        const I = G.icons;
        this._iconDefs = [
            ['sep-icon', 'bowl', 0, 0], ['discharge', 'discharge', 1, 0], ['water-icon', 'water', 2, 0], ['system', 'globe', 3, 0],
            ['bowl-icon', 'bowl', 0, 1], ['alarm-reset', 'alarm', 1, 1], ['cip', 'cip', 2, 1], ['info-icon', 'info', 3, 1],
        ];
        this._iconRects = [];
        this._iconDefs.forEach(([id, kind, col, row]) => {
            const x = I.x0 + col * I.gapX;
            const y = I.y0 + row * I.gapY;
            g.add(new Konva.Rect({ x, y, width: I.w, height: I.h, cornerRadius: 4, fill: '#f5f5f5', stroke: '#555', strokeWidth: 1.5 }));
            const cx = x + I.w / 2, cy = y + I.h / 2;
            if (kind === 'bowl') this._iconBowl(g, cx, cy);
            else if (kind === 'discharge') this._iconDischarge(g, cx, cy);
            else if (kind === 'water') this._iconWater(g, cx, cy);
            else if (kind === 'globe') this._iconGlobe(g, cx, cy);
            else if (kind === 'alarm') {
                g.add(new Konva.Line({ points: [cx, cy - 22, cx - 24, cy + 20, cx + 24, cy + 20], closed: true, fill: '#f5f5f5', stroke: '#b71c1c', strokeWidth: 2.5 }));
                this._label(g, cx - 10, cy - 2, '!', 20, '#b71c1c', true, 'center', 20);
            } else if (kind === 'cip') {
                this._label(g, x, y + 20, 'CIP', 14, '#263238', true, 'center', I.w);
            } else if (kind === 'info') {
                this._label(g, x, y + 18, 'i', 26, '#263238', true, 'center', I.w);
            }
            this._iconRects.push({ id, x, y, w: I.w, h: I.h });
        });

        // 下方电源开关底板
        const PW = G.power;
        g.add(new Konva.Rect({ x: PW.x, y: PW.y, width: PW.w, height: PW.h, cornerRadius: 4, fill: '#4a4a4a', stroke: '#222', strokeWidth: 2 }));
        g.add(new Konva.Rect({ x: PW.x + 8, y: PW.y + 12, width: 48, height: 22, fill: '#1e1e1e' }));
        this._label(g, PW.x + 12, PW.y + 16, 'ON', 10, '#d9ffd9', true);
        this._label(g, PW.x + 12, PW.y + PW.h - 34, 'OFF', 11, '#ffd9d9', true);
        g.add(new Konva.Circle({ x: PW.x + PW.w / 2, y: PW.y + PW.h / 2 + 8, radius: 42, fill: '#1e1e1e', stroke: '#111', strokeWidth: 2 }));
        this._label(g, PW.x, PW.y - 18, '电源开关', 13, '#263238', true, 'center', PW.w);

        // 应急停止底板
        const Em = G.emergency;
        g.add(new Konva.Circle({ x: Em.cx, y: Em.cy, radius: Em.r + 10, fill: '#f2c200', stroke: '#b58e00', strokeWidth: 2 }));
        g.add(new Konva.Circle({ x: Em.cx, y: Em.cy, radius: Em.r, fill: '#c62828', stroke: '#7f1010', strokeWidth: 3 }));
        g.add(new Konva.Circle({ x: Em.cx, y: Em.cy, radius: Em.r - 14, fill: '#e53935', stroke: '#8e1515', strokeWidth: 2 }));
        this._label(g, Em.cx - 70, Em.cy - Em.r - 26, '应急停止', 13, '#263238', true, 'center', 140);

        // 电流表
        const A = G.ammeter;
        g.add(new Konva.Rect({ x: A.x, y: A.y, width: A.w, height: A.h, cornerRadius: 4, fill: '#3a3a3a', stroke: '#222', strokeWidth: 2 }));
        g.add(new Konva.Rect({ x: A.x + 10, y: A.y + 10, width: A.w - 20, height: A.h - 20, fill: '#f7f7f2', stroke: '#111', strokeWidth: 2 }));
        this._label(g, A.x + 18, A.y + 18, 'A', 18, '#111', true);
        // 刻度弧
        const acx = A.x + A.w / 2, acy = A.y + A.h - 46;
        g.add(new Konva.Arc({ x: acx, y: acy, innerRadius: 76, outerRadius: 80, angle: 120, rotation: 210, fill: 'none', stroke: '#111', strokeWidth: 2 }));
        for (let i = 0; i <= 10; i++) {
            const ang = (210 + i * 12) * Math.PI / 180;
            const x1 = acx + Math.cos(ang) * 66, y1 = acy + Math.sin(ang) * 66;
            const x2 = acx + Math.cos(ang) * 76, y2 = acy + Math.sin(ang) * 76;
            g.add(new Konva.Line({ points: [x1, y1, x2, y2], stroke: '#111', strokeWidth: i % 2 === 0 ? 2 : 1 }));
            if (i % 2 === 0) {
                const tx = acx + Math.cos(ang) * 54, ty = acy + Math.sin(ang) * 54;
                this._label(g, tx - 10, ty - 6, String(i * 10), 8, '#111', false, 'center', 20);
            }
        }
        // 红色过载区
        g.add(new Konva.Arc({ x: acx, y: acy, innerRadius: 62, outerRadius: 76, angle: 36, rotation: 294, fill: '#e53935' }));
        this._label(g, A.x + A.w - 60, A.y + A.h - 76, '8', 14, '#111', true, 'center', 50);
        this._label(g, A.x + 20, A.y + A.h - 30, 'MOTOR CURRENT', 8, '#555', false, 'left', 200);

        // 页码
        g.add(new Konva.Rect({ x: G.pageNo.x, y: G.pageNo.y, width: 34, height: 24, fill: '#f2b300', cornerRadius: 2 }));
        this._label(g, G.pageNo.x, G.pageNo.y + 4, '54', 12, '#3a2a00', true, 'center', 34);
    }

    _createDynamicNodes() {
        const d = this._dynamicGroup, G = this._geo;

        // LCD 背景
        this._lcdBg = new Konva.Rect({
            x: G.lcd.x, y: G.lcd.y, width: G.lcd.w, height: G.lcd.h, cornerRadius: 3,
            fill: '#b7d96a', stroke: '#0b0d0c', strokeWidth: 2,
        });
        d.add(this._lcdBg);
        this._lcdTexts = [];
        for (let i = 0; i < 4; i++) {
            const t = new Konva.Text({
                x: G.lcd.x + 10, y: G.lcd.y + 8 + i * 28,
                width: G.lcd.w - 20, height: 26,
                text: '', fontSize: 15, lineHeight: 1.2,
                fontFamily: 'Consolas, "Courier New", monospace',
                fill: '#1b2a0a', listening: false,
            });
            d.add(t);
            this._lcdTexts.push(t);
        }

        // 电源旋钮
        this._powerKnob = new Konva.Rect({
            x: G.power.x + G.power.w / 2 - 6, y: G.power.y + G.power.h / 2 - 22,
            width: 12, height: 44, fill: '#f0f0f0', cornerRadius: 3, stroke: '#111', strokeWidth: 1,
        });
        d.add(this._powerKnob);

        // 功能键 LED 与起动/停止状态
        this._leds = {};
        this._iconDefs.forEach(([id], i) => {
            const r = this._iconRects[i];
            const c = new Konva.Circle({ x: r.x + 8, y: r.y + 8, radius: 5, fill: '#2b2f2f', stroke: '#111', strokeWidth: 1 });
            d.add(c);
            this._leds[id] = c;
        });
        this._startFill = new Konva.Rect({
            x: G.start.x, y: G.start.y, width: G.start.w, height: G.start.h, cornerRadius: 6,
            fill: '#2f6b1f', opacity: 0.35, listening: false,
        });
        this._stopFill = new Konva.Rect({
            x: G.stop.x, y: G.stop.y, width: G.stop.w, height: G.stop.h, cornerRadius: 6,
            fill: '#7f1d1d', opacity: 0.35, listening: false,
        });
        d.add(this._startFill, this._stopFill);

        // 电流表指针与数值
        const A = G.ammeter;
        const acx = A.x + A.w / 2, acy = A.y + A.h - 46;
        this._ampNeedle = new Konva.Group({ x: acx, y: acy, rotation: 210 });
        this._ampNeedle.add(new Konva.Line({ points: [0, 0, 0, -70], stroke: '#c62828', strokeWidth: 3, lineCap: 'round' }));
        this._ampNeedle.add(new Konva.Circle({ x: 0, y: 0, radius: 5, fill: '#111' }));
        d.add(this._ampNeedle);
        this._ampText = new Konva.Text({
            x: A.x + A.w - 76, y: A.y + A.h - 40, width: 60, height: 24,
            text: '0', fontSize: 16, align: 'center', fontFamily: 'Consolas, monospace', fill: '#111',
        });
        d.add(this._ampText);
    }

    _bindInteraction() {
        const G = this._geo;
        this._keyList.forEach(k => {
            const hit = this.addClickablePart(k.id, k.x, k.y, k.w, k.h, true);
            hit.on('click tap', () => this._onKey(k.id));
        });
        this._iconRects.forEach(r => {
            const hit = this.addClickablePart(r.id, r.x, r.y, r.w, r.h, true);
            hit.on('click tap', () => this._onKey(r.id));
        });
        const S = G.start;
        this.addClickablePart('separation', S.x, S.y, S.w, S.h, true).on('click tap', () => this._onKey('separation'));
        const P = G.stop;
        this.addClickablePart('stop', P.x, P.y, P.w, P.h, true).on('click tap', () => this._onKey('stop'));
        const PW = G.power;
        this.addClickablePart('power', PW.x, PW.y, PW.w, PW.h, true).on('click tap', () => this._onKey('power'));
        const Em = G.emergency;
        this.addClickablePart('emergency', Em.cx - Em.r, Em.cy - Em.r, Em.r * 2, Em.r * 2, true)
            .on('click tap', () => this._onKey('emergency'));
        // 兼容旧 part：enter 已注册在键盘上；plus/minus/info 也已注册
    }

    _onKey(id) {
        const s = this._solver();
        if (!s) return;
        const m = s.m;

        if (id === 'power') {
            s.toggleEpcPower();
        } else if (id === 'emergency') {
            if (m.emergency) s.resetEmergency(); else s.emergencyStop();
        } else if (id === 'separation') {
            if (m.epcPower) s.pressSeparation();
        } else if (id === 'stop') {
            if (m.epcPower) s.pressStop();
        } else if (id === 'discharge') {
            if (m.epcPower) s.pressDischarge();
        } else if (id === 'alarm-reset') {
            if (m.epcPower) s.pressAlarmReset();
        } else if (id === 'info' || id === 'info-icon') {
            this._onInfo();
        } else if (id === 'enter') {
            this._onEnter();
        } else if (id === 'plus') {
            this._onAdjust(1);
        } else if (id === 'minus') {
            this._onAdjust(-1);
        } else if (id === 'back') {
            if (this._ui.editing) {
                this._ui.editStr = this._ui.editStr.slice(0, -1);
            } else {
                this._ui.page = 'main';
                this._ui.editing = false;
            }
        } else if (id === 'cip') {
            s.m.cip = !s.m.cip;
            if (this.sys && this.sys._tipPurifier) this.sys._tipPurifier(s.m.cip ? 'CIP 清洗功能已选择（演示接口）' : 'CIP 清洗功能已取消');
        } else if (id === 'system') {
            if (this.sys && this.sys.pageMgr) this.sys.pageMgr.navigateTo(2);
        } else if (id.startsWith('key-')) {
            this._onNumeric(id === 'key-dot' ? '.' : id.slice(4));
        }
        this._syncVisuals();
    }

    _onNumeric(ch) {
        const u = this._ui;
        if (!u.editing) return;
        if (u.editStr.length > 7) return;
        if (ch === '.' && u.editStr.includes('.')) return;
        u.editStr = (u.editStr === '0' && ch !== '.') ? ch : (u.editStr + ch);
        u.editVal = parseFloat(u.editStr) || 0;
    }

    _onInfo() {
        const u = this._ui;
        if (u.page === 'main') u.page = 'info';
        else u.page = 'main';
        u.editing = false;
    }

    _onEnter() {
        const u = this._ui, s = this._solver();
        if (!s) return;
        if (!s.m.epcPower) return;
        if (u.page === 'main') u.page = 'menu';
        else if (u.page === 'menu') {
            u.page = ['params', 'time', 'alarms', 'info'][u.menu] || 'main';
            if (u.page === 'params') u.param = 0;
        } else if (u.page === 'params') {
            if (u.editing) {
                const val = parseFloat(u.editStr);
                if (Number.isFinite(val)) s.setParam(u.editKey, val);
                u.editing = false;
            } else {
                const item = this._paramItems()[u.param];
                if (item) {
                    u.editing = true;
                    u.editKey = item[0];
                    u.editVal = s.getParam(item[0]);
                    u.editStr = String(u.editVal);
                }
            }
        } else {
            u.page = 'menu';
        }
    }

    _onAdjust(dir) {
        const u = this._ui, s = this._solver();
        if (!s) return;
        if (u.page === 'menu') {
            u.menu = Math.max(0, Math.min(3, u.menu + dir));
        } else if (u.page === 'params') {
            const items = this._paramItems();
            if (u.editing) {
                const item = items[u.param];
                if (!item) return;
                const step = item[3];
                const dec = item[4] || 0;
                u.editVal = Number((u.editVal + dir * step).toFixed(dec));
                u.editStr = String(u.editVal);
            } else {
                u.param = Math.max(0, Math.min(items.length - 1, u.param + dir));
            }
        } else if (u.page === 'alarms') {
            const n = s.m.alarms.length;
            u.alarm = Math.max(0, Math.min(Math.max(0, n - 1), u.alarm + dir));
        } else if (u.page === 'info') {
            u.info = Math.max(0, Math.min(5, u.info + dir));
        }
    }

    _paramItems() {
        return [
            ['dischargeInterval', '排渣间隔', 'min', 1, 0],
            ['minInterval', '最短排渣间隔', 'min', 1, 0],
            ['sepTemp', '分离温度', '°C', 1, 0],
            ['flow', '进油流量', 'm³/h', 0.1, 1],
            ['sealTime', '水封时间', 's', 1, 0],
            ['displacementTime', '置换水时间', 's', 1, 0],
            ['drainTime', '排水阀时间', 's', 1, 0],
            ['waterTrigger', '水分触发值', 'pF', 1, 0],
            ['timeScale', '仿真时间倍率', '×', 1, 0],
        ];
    }

    _stateText(m) {
        const map = {
            STANDSTILL: 'STANDSTILL', STARTING: 'START', START_SEQ: 'START SEQ',
            STANDBY: 'STANDBY', SEPARATION: 'SEPARATION', DISCHARGE: 'DISCHARGE', STOPPING: 'STOP',
        };
        return map[m.state] || m.state;
    }

    _fmtClock(sec) {
        sec = Math.max(0, Math.round(sec));
        const mm = Math.floor(sec / 60);
        const ss = sec % 60;
        return `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
    }

    _lcdLines(m) {
        const u = this._ui;
        const st = this._stateText(m);
        if (!m.epcPower) {
            return ['EPC 60', '', '  POWER OFF', '请合上电源开关'];
        }

        if (u.page === 'menu') {
            const items = ['参数设置', '时间设置', '报警记录', '操作信息'];
            const lines = ['MAIN MENU   ▲▼ 选择'];
            const start = Math.max(0, Math.min(1, u.menu - 1));
            for (let i = 0; i < 3; i++) {
                const real = start + i;
                if (real > 3) { lines.push(''); continue; }
                lines.push(`${real === u.menu ? '>' : ' '} ${items[real]}`);
            }
            return lines;
        }

        if (u.page === 'params') {
            const items = this._paramItems();
            const lines = [`参数设置 ${u.param + 1}/${items.length}  ${u.editing ? '数字输入' : '↵=修改'}`];
            let win;
            if (u.param <= 0) win = [0, 1, 2];
            else if (u.param >= items.length - 1) win = [items.length - 3, items.length - 2, items.length - 1];
            else win = [u.param - 1, u.param, u.param + 1];
            win.forEach(i => {
                const item = items[i];
                if (!item) { lines.push(''); return; }
                const cur = u.editing && i === u.param
                    ? (u.editStr || '0')
                    : Number(m.params[item[0]]).toFixed(item[4] || 0);
                lines.push(`${i === u.param ? '>' : ' '} ${item[1]}  ${cur} ${item[2]}`);
            });
            return lines;
        }

        if (u.page === 'time') {
            return [
                '时间设置',
                `到下次排渣  ${this._fmtClock(m.sludge.nextIn)}`,
                `运行时间    ${m.counters.runTime.toFixed(1)} h`,
                `排渣次数    ${m.counters.dischargeCount}`,
            ];
        }

        if (u.page === 'alarms') {
            const list = m.alarms.filter(a => a.active);
            const lines = [`报警记录 ${list.length} 条  ALARM RESET`];
            if (!list.length) {
                lines.push('  NO ACTIVE ALARM', '', '');
            } else {
                for (let i = 0; i < 3; i++) {
                    const a = list[Math.min(list.length - 1, u.alarm + i)];
                    if (!a) { lines.push(''); continue; }
                    lines.push(`${a.ack ? ' ' : '*'} ${a.code} ${a.text.slice(0, 22)}`);
                }
            }
            return lines;
        }

        if (u.page === 'info') {
            const pages = [
                ['运行信息', `TT1 ${m.feed.temp.toFixed(1)} °C`, `PT1 ${m.feed.pressure.toFixed(3)} MPa`, `PT4 ${m.oil.outletPressure.toFixed(3)} MPa`],
                ['运行信息', `PT5 ${m.water.outletPressure.toFixed(3)} MPa`, `MT  ${m.faults.transducer ? 'NC' : m.oil.waterContent.toFixed(1) + ' pF'}`, `FLOW ${m.feed.flow.toFixed(2)} m³/h`],
                ['运行信息', `RPM ${Math.round(m.bowl.speed)} r/min`, `VIB ${m.bowl.vibration.toFixed(1)} mm/s`, `RUN ${m.counters.runTime.toFixed(1)} h`],
                ['运行信息', `排渣次数 ${m.counters.dischargeCount}`, `起动次数 ${m.counters.startCount}`, `时间倍率 ${m.timeScale}×`],
                ['操作信息', 'S 型分油机  S 936', 'EPC-60 控制单元', '仿真教学版'],
                ['操作信息', 'I=起动  O=停止', 'CIP=清洗', '↵/i 返回'],
            ];
            return pages[u.info % pages.length];
        }

        // 主界面（参照实船 LCD 排版）
        const mt = m.faults.transducer ? 'NC' : `${m.oil.waterContent.toFixed(1)} pF`;
        const running = m.state === 'SEPARATION';
        const line0 = running ? '_ _ _ SEPARATION _ _ _' : '_ _ _ RECIRCULATION _ _ _';
        const line1 = running ? 'Separation running' : 'To start separation';
        const line2 = running ? `RPM ${String(Math.round(m.bowl.speed)).padStart(5)}  TT1 ${m.feed.temp.toFixed(1)}C` : 'press start button';
        const line3 = `Temp = ${m.feed.temp.toFixed(1)}C      ${this._fmtClock(m.sludge.nextIn)}`;
        return [line0, line1, line2, line3];
    }

    _syncVisuals() {
        const s = this._solver();
        const m = s ? s.m : null;
        if (!m) return;
        const lines = this._lcdLines(m);
        this._lcdTexts.forEach((t, i) => {
            t.text(lines[i] || '');
            t.fill(m.epcPower ? '#1b2a0a' : '#6f7f58');
        });
        this._lcdBg.fill(m.epcPower ? '#b7d96a' : '#7b8f5a');

        this._setLed('discharge', m.state === 'DISCHARGE', '#f4b400');
        this._setLed('alarm-reset', m.alarmActive, '#ff2d2d');
        this._setLed('water-icon', m.water.sv10 || m.water.sv15 || m.water.sv16, '#29b6f6');
        this._setLed('sep-icon', m.state === 'SEPARATION' || m.state === 'STANDBY', '#28e05a');
        this._setLed('system', true, '#28e05a');
        this._setLed('cip', !!m.cip, '#28e05a');
        this._startFill.opacity(m.epcPower ? 0.0 : 0.0);
        this._stopFill.opacity(m.state === 'STOPPING' ? 0.55 : 0.0);

        this._powerKnob.rotation(m.epcPower ? 42 : -42);
        this._ampNeedle.rotation(210 + Math.min(1, m.motor.current / 100) * 120);
        this._ampText.text(String(Math.round(m.motor.current)));

        if (this.sys && this.sys.requestRedraw) this.sys.requestRedraw();
    }

    _setLed(id, on, color = '#28e05a') {
        const c = this._leds[id];
        if (!c) return;
        c.fill(on ? color : '#2b2f2f');
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

export default EPC60Panel;
