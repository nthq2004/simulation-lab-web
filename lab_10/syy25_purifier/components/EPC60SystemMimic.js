import Konva from 'konva';
import { BaseComponent } from './BaseComponent.js';

/**
 * EPC60SystemMimic — EPC-60 系统模拟图（P&ID 风格）
 *
 * 按实船 EPC-60 系统图绘制：管线、阀门、传感器、分油机、加热器、
 * 温度控制器、冷却水回路。当前以监视为主；调试模式预留全部阀门/电机接口。
 */
export class EPC60SystemMimic extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.W = Math.max(900, config.width || 1060);
        this.H = Math.max(800, config.height || 1000);
        this.type = 'epc60_system_mimic';
        this.special = 'purifier_mimic';
        this.cache = 'fixed';

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
            sep: { cx: W - 250, cy: 470, r: 112 },
            heater: { x: W - 550, y: 735, w: 120, h: 92 },
            tempCtrl: { x: W - 400, y: 690, w: 150, h: 86 },
            valves: {
                sv4: { x: 150, y: 170, w: 64, h: 54 },
                sv1: { x: 590, y: 330, w: 64, h: 54 },
                sv5: { x: 620, y: 430, w: 64, h: 54 },
                sv10: { x: 730, y: 100, w: 58, h: 48 },
                sv15: { x: 810, y: 100, w: 58, h: 48 },
                sv16: { x: 890, y: 100, w: 58, h: 48 },
            },
            pump: { x: 230, y: 865, w: 76, h: 64 },
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

    _tag(g, x, y, text, color = '#1b5e20') {
        g.add(new Konva.Rect({ x, y, width: 42, height: 24, fill: color, cornerRadius: 2 }));
        this._label(g, x, y + 4, text, 13, '#ffffff', true, 'center', 42);
    }

    _pipe(g, points, color = '#8d3b2f', width = 5) {
        g.add(new Konva.Line({ points, stroke: color, strokeWidth: width, lineCap: 'round', lineJoin: 'round' }));
    }

    _drawValve(g, b, label, id, actuated = true) {
        const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
        g.add(new Konva.Line({ points: [cx - 20, cy - 12, cx - 20, cy + 12, cx, cy], closed: true, fill: '#ffffff', stroke: '#4a4a4a', strokeWidth: 2 }));
        g.add(new Konva.Line({ points: [cx + 20, cy - 12, cx + 20, cy + 12, cx, cy], closed: true, fill: '#ffffff', stroke: '#4a4a4a', strokeWidth: 2 }));
        g.add(new Konva.Line({ points: [cx, cy - 12, cx, cy - 26], stroke: '#4a4a4a', strokeWidth: 2 }));
        if (actuated) {
            g.add(new Konva.Rect({ x: cx + 8, y: cy - 30, width: 20, height: 20, fill: '#e0e0e0', stroke: '#333', strokeWidth: 1 }));
            this._label(g, cx + 8, cy - 27, 'M', 12, '#111', true, 'center', 20);
        }
        this._label(g, b.x, b.y - 17, label, 10, '#263238', true, 'center', b.w);
    }

    _sensor(g, x, y, label, value, unit) {
        g.add(new Konva.Circle({ x, y, radius: 16, fill: '#ffffff', stroke: '#37474f', strokeWidth: 2 }));
        this._label(g, x - 16, y - 8, label, 9, '#263238', true, 'center', 32);
        const t = new Konva.Text({ x: x - 40, y: y + 20, width: 80, height: 18, text: value, fontSize: 11, align: 'center', fill: '#263238', fontFamily: 'Consolas, monospace' });
        this._dynamicGroup.add(t);
        return t;
    }

    _drawStaticParts() {
        const g = this._staticGroup, G = this._geo, W = this.W, H = this.H;

        g.add(new Konva.Rect({ x: 0, y: 0, width: W, height: H, cornerRadius: G.chassis.r, fill: '#eef2f0', stroke: '#9aa19d', strokeWidth: 2 }));
        this._label(g, 18, 10, 'EPC-60 SYSTEM MIMIC', 14, '#263238', true);
        this._label(g, 18, 30, '分油机系统模拟图（监视 / 调试接口预留）', 10, '#78909c');

        // 绿色线号
        this._tag(g, 160, 18, '04');
        this._label(g, 208, 22, 'P 7.20', 10, '#37474f', true);
        this._tag(g, 820, 18, '35');
        this._label(g, 868, 22, 'P 5.02', 10, '#37474f', true);
        this._tag(g, 28, 348, '13');
        this._tag(g, 28, 440, '13');
        this._tag(g, 28, 900, '13');
        this._tag(g, 850, 760, '43', '#00897b');
        this._label(g, 900, 764, 'g 28.59', 10, '#00897b', true);
        this._tag(g, 850, 810, '43', '#00897b');

        // 管线
        this._pipe(g, [160, 60, 160, 150], '#7a7a7a', 5);
        this._pipe(g, [160, 224, 160, 360, 250, 360], '#8d3b2f', 6);
        this._pipe(g, [28, 360, 140, 360], '#8d3b2f', 6);
        this._pipe(g, [250, 360, 430, 360], '#8d3b2f', 6);
        this._pipe(g, [430, 360, 560, 360, 590, 360], '#8d3b2f', 6);
        this._pipe(g, [654, 360, 720, 360, 720, 430], '#8d3b2f', 6);
        this._pipe(g, [28, 452, 620, 452], '#8d3b2f', 5);
        this._pipe(g, [720, 510, 620, 510, 620, 452], '#8d3b2f', 4);
        this._pipe(g, [820, 60, 820, 124], '#1e88e5', 5);
        this._pipe(g, [759, 124, 919, 124], '#1e88e5', 5);
        this._pipe(g, [820, 148, 820, 560, 720, 560], '#1e88e5', 5);
        this._pipe(g, [28, 900, 230, 900], '#8d3b2f', 6);
        this._pipe(g, [306, 900, 430, 900, 430, 780, 520, 780], '#8d3b2f', 6);
        this._pipe(g, [640, 780, 720, 780, 720, 560], '#8d3b2f', 5);
        this._pipe(g, [640, 790, 850, 790], '#00897b', 4);
        this._pipe(g, [640, 820, 850, 820], '#00897b', 4);

        // 阀门
        this._drawValve(g, G.valves.sv4, 'SV4', 'sv4');
        this._drawValve(g, G.valves.sv1, 'SV1', 'sv1');
        this._drawValve(g, G.valves.sv5, 'SV5', 'sv5');
        this._drawValve(g, G.valves.sv10, 'SV10', 'sv10');
        this._drawValve(g, G.valves.sv15, 'SV15', 'sv15');
        this._drawValve(g, G.valves.sv16, 'SV16', 'sv16');

        // 手动阀 / 过滤器 / 泵
        this._label(g, 92, 340, '手动阀', 9, '#546e7a', false, 'center', 60);
        g.add(new Konva.Rect({ x: 250, y: 340, width: 46, height: 40, fill: '#ffffff', stroke: '#37474f', strokeWidth: 2 }));
        for (let i = 0; i < 3; i++) g.add(new Konva.Line({ points: [254, 348 + i * 10, 292, 348 + i * 10], stroke: '#78909c', strokeWidth: 1 }));
        this._label(g, 250, 322, '滤器', 9, '#546e7a', false, 'center', 46);

        g.add(new Konva.Rect({ x: G.pump.x, y: G.pump.y, width: G.pump.w, height: G.pump.h, cornerRadius: 6, fill: '#cfd8dc', stroke: '#37474f', strokeWidth: 2 }));
        g.add(new Konva.Circle({ x: G.pump.x + G.pump.w / 2, y: G.pump.y + G.pump.h / 2, radius: 24, fill: '#eceff1', stroke: '#37474f', strokeWidth: 2 }));
        this._label(g, G.pump.x, G.pump.y + G.pump.h + 4, '进油泵', 9, '#546e7a', false, 'center', G.pump.w);

        // 加热器
        const Ht = G.heater;
        g.add(new Konva.Rect({ x: Ht.x, y: Ht.y, width: Ht.w, height: Ht.h, cornerRadius: 4, fill: '#d7ccc8', stroke: '#6d4c41', strokeWidth: 2 }));
        for (let i = 0; i < 7; i++) g.add(new Konva.Line({ points: [Ht.x + 14 + i * 13, Ht.y + 12, Ht.x + 14 + i * 13, Ht.y + Ht.h - 12], stroke: '#8d6e63', strokeWidth: 2 }));
        this._label(g, Ht.x, Ht.y - 18, '加热器', 10, '#4e342e', true, 'center', Ht.w);
        this._label(g, Ht.x - 30, Ht.y + Ht.h + 10, 'T 75.04', 10, '#4e342e', false, 'center', 80);

        // 温度控制器
        const T = G.tempCtrl;
        g.add(new Konva.Rect({ x: T.x, y: T.y, width: T.w, height: T.h, cornerRadius: 3, fill: '#e8f5e9', stroke: '#2e7d32', strokeWidth: 2 }));
        this._label(g, T.x + 8, T.y + 6, 'TEMP', 10, '#1b5e20', true);
        this._label(g, T.x + 8, T.y + 20, 'CTRL', 10, '#1b5e20', true);
        g.add(new Konva.Rect({ x: T.x + 50, y: T.y + 6, width: 42, height: 20, fill: '#43a047' }));
        this._label(g, T.x + 50, T.y + 9, 'AUTO', 9, '#fff', true, 'center', 42);
        g.add(new Konva.Rect({ x: T.x + 94, y: T.y + 6, width: 46, height: 20, fill: '#9e9e9e' }));
        this._label(g, T.x + 94, T.y + 9, 'MANU', 9, '#fff', true, 'center', 46);
        this._label(g, T.x + 52, T.y + 34, '98.00', 13, '#1b5e20', true, 'center', 60);
        this._label(g, T.x + 52, T.y + 68, 'OUT', 9, '#607d8b', false, 'center', 60);
        g.add(new Konva.Line({ points: [T.x + T.w, T.y + 64, Ht.x + Ht.w, T.y + 64, Ht.x + Ht.w, Ht.y + 20], stroke: '#78909c', strokeWidth: 1.2, dash: [4, 3] }));

        // 分油机图标
        this._drawSeparatorStatic(g);

        // 传感器
        this._valNodes = {};
        this._valNodes.pt1 = this._sensor(g, 450, 278, 'PT1', '0.00', 'MPa');
        this._valNodes.tt1 = this._sensor(g, 500, 278, 'TT1', '0.0', '°C');
        this._valNodes.tt2 = this._sensor(g, 550, 278, 'TT2', '0.0', '°C');
        this._valNodes.pt4 = this._sensor(g, 460, 405, 'PT4', '0.00', 'MPa');
        this._valNodes.mt = this._sensor(g, 400, 405, 'MT', '0.0', 'pF');
        this._valNodes.pt5 = this._sensor(g, 660, 520, 'PT5', '0.00', 'MPa');
        this._valNodes.st = this._sensor(g, G.sep.cx + 155, G.sep.cy + 5, 'ST', '0', 'r/min');

        // 线号值
        this._lineTexts = {};
        const lineDefs = [
            ['g632', 120, 316, 'G 6.32'],
            ['g000', 120, 424, 'G 0.00'],
            ['p000a', 662, 338, 'P 0.00'],
            ['p000b', 700, 400, 'P 0.00'],
            ['p200', 380, 880, 'P 2.00'],
            ['g632b', 470, 880, 'G 6.32'],
            ['t9809', 390, 700, 'T 98.09'],
        ];
        lineDefs.forEach(([id, x, y, txt]) => {
            const t = new Konva.Text({ x, y, text: txt, fontSize: 11, fill: '#37474f', fontFamily: 'Consolas, monospace' });
            this._dynamicGroup.add(t);
            this._lineTexts[id] = t;
        });

        // 图例
        this._label(g, 18, H - 30, '红：燃油    蓝：工作水    青：冷却水    灰：控制空气/回流    绿色框：管线号', 9, '#78909c');
    }

    _drawSeparatorStatic(g) {
        const G = this._geo, S = G.sep, cx = S.cx, cy = S.cy;
        // 机架
        g.add(new Konva.Rect({ x: cx - 110, y: cy + 88, width: 220, height: 24, rx: 3, fill: '#607d8b', stroke: '#37474f', strokeWidth: 2 }));
        // 分离筒
        g.add(new Konva.Line({ points: [cx - 60, cy - 18, cx - 44, cy - 104, cx + 44, cy - 104, cx + 60, cy - 18, cx + 60, cy + 62, cx - 60, cy + 62], closed: true, fill: '#f5f5f5', stroke: '#455a64', strokeWidth: 2.5 }));
        g.add(new Konva.Arc({ x: cx, y: cy - 104, innerRadius: 0, outerRadius: 44, angle: 180, rotation: 180, fill: '#e0e0e0', stroke: '#455a64', strokeWidth: 2 }));
        // 电机
        g.add(new Konva.Rect({ x: cx + 58, y: cy - 10, width: 78, height: 62, cornerRadius: 8, fill: '#3949ab', stroke: '#1a237e', strokeWidth: 2 }));
        g.add(new Konva.Circle({ x: cx + 97, y: cy + 21, radius: 20, fill: '#5c6bc0', stroke: '#1a237e', strokeWidth: 2 }));
        // 排渣
        g.add(new Konva.Line({ points: [cx - 30, cy + 112, cx - 30, cy + 160], stroke: '#795548', strokeWidth: 8 }));
        g.add(new Konva.Line({ points: [cx - 30, cy + 160, cx - 50, cy + 142, cx - 10, cy + 142], closed: true, fill: '#795548' }));
        this._label(g, cx - 20, cy + 170, 'G 0.00', 11, '#4e342e', true, 'center', 90);
        this._label(g, cx - 80, cy + 124, 'SEPARATOR', 11, '#263238', true, 'center', 160);
        this._label(g, cx - 80, cy + 140, 'S 936', 9, '#78909c', false, 'center', 160);
    }

    _createDynamicNodes() {
        const d = this._dynamicGroup, G = this._geo;
        const S = G.sep;

        // 分离筒盘组旋转
        this._disc = new Konva.Group({ x: S.cx, y: S.cy - 10 });
        for (let i = -4; i <= 4; i++) this._disc.add(new Konva.Line({ points: [-48, i * 9, 48, i * 9], stroke: '#90a4ae', strokeWidth: 1.4 }));
        d.add(this._disc);

        // 加热器发光
        this._heaterGlow = new Konva.Rect({ x: G.heater.x + 8, y: G.heater.y + 8, width: G.heater.w - 16, height: G.heater.h - 16, fill: '#ff9800', opacity: 0, cornerRadius: 3 });
        d.add(this._heaterGlow);

        // 阀门动态手柄/颜色
        this._valveDyn = {};
        ['sv4', 'sv1', 'sv5', 'sv10', 'sv15', 'sv16'].forEach(id => {
            const b = G.valves[id];
            const grp = new Konva.Group({ x: b.x + b.w / 2, y: b.y + b.h / 2 });
            grp.add(new Konva.Line({ points: [0, -12, 0, -28], stroke: '#263238', strokeWidth: 3, lineCap: 'round' }));
            d.add(grp);
            this._valveDyn[id] = grp;
        });

        // 流动线
        const mkFlow = (points, color, width = 3) => {
            const line = new Konva.Line({ points, stroke: color, strokeWidth: width, dash: [8, 12], dashOffset: 0, opacity: 0 });
            d.add(line);
            return line;
        };
        this._oilFlow = mkFlow([28, 360, 140, 360, 250, 360, 430, 360, 590, 360, 654, 360, 720, 360, 720, 430], '#ffb300', 3);
        this._returnFlow = mkFlow([720, 510, 620, 510, 620, 452, 28, 452], '#c48b2c', 3);
        this._waterFlow = mkFlow([820, 60, 820, 100, 820, 148, 820, 560, 720, 560], '#29b6f6', 3);
        this._coolFlow = mkFlow([640, 790, 850, 790], '#00acc1', 3);
        this._sludgeFlow = mkFlow([S.cx - 30, S.cy + 112, S.cx - 30, S.cy + 160], '#8d6e63', 4);
        this._bottomFlow = mkFlow([28, 900, 230, 900, 306, 900, 430, 900, 430, 780, 520, 780, 640, 780, 720, 780, 720, 560], '#c48b2c', 3);

        // 电流表式数值已由传感器文本承担
        this._tempModeText = new Konva.Text({ x: G.tempCtrl.x + 50, y: G.tempCtrl.y + 9, width: 42, height: 18, text: 'AUTO', fontSize: 9, align: 'center', fill: '#fff', fontFamily: 'Arial' });
        d.add(this._tempModeText);
        this._tempOutText = new Konva.Text({ x: G.tempCtrl.x + 24, y: G.tempCtrl.y + 52, width: 90, height: 22, text: '17.02', fontSize: 12, align: 'center', fill: '#37474f', fontFamily: 'Consolas, monospace' });
        d.add(this._tempOutText);
    }

    _bindInteraction() {
        const G = this._geo;
        const bind = (id, x, y, w, h) => this.addClickablePart(id, x, y, w, h, true)
            .on('click tap', () => this._control(id));
        Object.entries(G.valves).forEach(([id, b]) => bind(id, b.x - 8, b.y - 26, b.w + 16, b.h + 34));
        bind('pump', G.pump.x, G.pump.y, G.pump.w, G.pump.h);
        bind('heater', G.heater.x, G.heater.y, G.heater.w, G.heater.h);
        bind('separator', G.sep.cx - 110, G.sep.cy - 80, 240, 220);
        bind('temp-auto', G.tempCtrl.x + 50, G.tempCtrl.y + 6, 42, 20);
        bind('temp-manu', G.tempCtrl.x + 94, G.tempCtrl.y + 6, 46, 20);
        ['pt1', 'tt1', 'tt2', 'pt4', 'mt', 'pt5', 'st'].forEach(id => {
            const node = this._valNodes[id];
            if (node) {
                // 传感器是动态文本，取上方圆圈中心附近
                const x = node.x() + node.width() / 2 - 18;
                const y = node.y() - 36;
                bind(id, x, y, 36, 36);
            }
        });
    }

    _control(id) {
        const s = this._solver();
        if (!s) return;
        const debug = !!s.m.debugMode;
        if (!debug) {
            if (this.sys && this.sys._tipPurifier) {
                this.sys._tipPurifier('当前为监视模式；调试模式后续开放，届时可操作电磁阀、电机与截止阀');
            }
            return;
        }
        if (id === 'pump') s.toggleFeedPump();
        else if (id === 'heater') s.toggleHeater();
        else if (id === 'sv1') s.toggleValve('v1');
        else if (id === 'sv5') s.toggleValve('v5');
        else if (id === 'sv4') s.setValve('sv4', !s.m.feed.sv4);
        else if (['sv10', 'sv15', 'sv16'].includes(id)) s.toggleValve(id);
        else if (id === 'temp-auto' || id === 'temp-manu') {
            s.m.tempCtrl.mode = id === 'temp-auto' ? 'AUTO' : 'MANU';
        }
    }

    _syncVisuals() {
        const s = this._solver();
        const m = s ? s.m : null;
        if (!m) return;
        const G = this._geo;

        const setVal = (node, text) => { if (node) node.text(text); };
        setVal(this._valNodes.pt1, m.feed.pressure.toFixed(2));
        setVal(this._valNodes.tt1, m.feed.temp.toFixed(1));
        setVal(this._valNodes.tt2, (m.oil.outletTemp || m.feed.temp).toFixed(1));
        setVal(this._valNodes.pt4, m.oil.outletPressure.toFixed(2));
        setVal(this._valNodes.mt, m.faults.transducer ? 'NC' : m.oil.waterContent.toFixed(1));
        setVal(this._valNodes.pt5, m.water.outletPressure.toFixed(2));
        setVal(this._valNodes.st, String(Math.round(m.bowl.speed)));

        if (this._lineTexts.g632) this._lineTexts.g632.text(`G ${m.feed.flow.toFixed(2)}`);
        if (this._lineTexts.g000) this._lineTexts.g000.text(`G ${(m.feed.flow * 0.02).toFixed(2)}`);
        if (this._lineTexts.p000a) this._lineTexts.p000a.text(`P ${m.feed.pressure.toFixed(2)}`);
        if (this._lineTexts.p000b) this._lineTexts.p000b.text(`P ${m.oil.outletPressure.toFixed(2)}`);
        if (this._lineTexts.p200) this._lineTexts.p200.text(`P ${(m.feed.pressure * 0.5).toFixed(2)}`);
        if (this._lineTexts.g632b) this._lineTexts.g632b.text(`G ${m.feed.flow.toFixed(2)}`);
        if (this._lineTexts.t9809) this._lineTexts.t9809.text(`T ${m.feed.temp.toFixed(2)}`);

        const open = {
            sv4: !!m.feed.sv4,
            sv1: !!m.feed.valveOpen,
            sv5: !!m.water.drain,
            sv10: !!m.water.sv10,
            sv15: !!m.water.sv15,
            sv16: !!m.water.sv16,
        };
        Object.keys(this._valveDyn).forEach(id => {
            this._valveDyn[id].rotation(open[id] ? 90 : 0);
            this._valveDyn[id].children[0].stroke(open[id] ? '#2e7d32' : '#263238');
        });

        this._disc.rotation((m.bowl.discRot * 12) % 360);
        this._heaterGlow.opacity(m.feed.heaterOn ? 0.35 + 0.25 * Math.sin((performance.now ? performance.now() : Date.now()) / 300) : 0);
        this._tempModeText.text(m.tempCtrl ? m.tempCtrl.mode : 'AUTO');
        this._tempOutText.text(`${(m.tempCtrl ? m.tempCtrl.output : 0).toFixed(2)}`);

        const oilOn = m.feed.flow > 0.02;
        this._oilFlow.opacity(oilOn ? 0.9 : 0);
        this._returnFlow.opacity(oilOn ? 0.7 : 0);
        this._bottomFlow.opacity(oilOn ? 0.8 : 0);
        this._waterFlow.opacity((m.water.sv10 || m.water.sv15 || m.water.sv16) ? 0.9 : 0);
        this._coolFlow.opacity(m.feed.heaterOn ? 0.8 : 0);
        this._sludgeFlow.opacity(m.bowl.discharge > 0 ? 0.9 : 0);
        const off = (m.bowl.discRot * 16) % 20;
        [this._oilFlow, this._returnFlow, this._bottomFlow, this._waterFlow, this._coolFlow, this._sludgeFlow].forEach(l => l.dashOffset(-off));

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

export default EPC60SystemMimic;
