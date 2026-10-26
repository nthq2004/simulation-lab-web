import Konva from 'konva';
import { BaseComponent } from './BaseComponent.js';

/**
 * PurifierStatusPanel — 分油机运行状态仪
 * 转速、温度、压力、水分、流量、油柜液位、分离筒示意与报警列表。
 */
export class PurifierStatusPanel extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.W = Math.max(760, config.width || 1000);
        this.H = Math.max(700, config.height || 900);
        this.type = 'purifier_status_panel';
        this.special = 'purifier_panel';
        this.cache = 'fixed';

        this._initGroups();
        this._recalcGeometry();
        this._drawStaticParts();
        this._createDynamicNodes();
        this._syncVisuals();

        this.config = { id: this.id, width: this.W, height: this.H };
    }

    _solver() {
        return this.sys && this.sys.purifierSolver ? this.sys.purifierSolver : null;
    }

    _recalcGeometry() {
        const W = this.W, H = this.H;
        this._geo = {
            chassis: { x: 0, y: 0, w: W, h: H, r: 14 },
            bezel: { x: 12, y: 12, w: W - 24, h: H - 24, r: 8 },
            screen: { x: 26, y: 26, w: W - 52, h: H - 52 },
            banner: { x: 40, y: 36, w: W - 80, h: 50 },
            gauge: { cx: 210, cy: 250, r: 130 },
            kpi: { x: 420, y: 108, w: 224, h: 62, colGap: 18, rowGap: 10 },
            mimic: { x: 40, y: 410, w: 402, h: 285 },
            tanks: { x: 468, y: 410, w: 236, h: 285 },
            alarms: { x: 724, y: 410, w: 236, h: 285 },
            footer: { x: 40, y: H - 124, w: W - 80, h: 90 },
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

    _drawStaticParts() {
        const g = this._staticGroup, G = this._geo, W = this.W, H = this.H;

        g.add(new Konva.Rect({
            x: 0, y: 0, width: W, height: H, cornerRadius: G.chassis.r,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint: { x: W, y: H },
            fillLinearGradientColorStops: [0, '#656a6b', 0.5, '#474c4d', 1, '#343839'],
            stroke: '#202323', strokeWidth: 2.5,
        }));
        g.add(new Konva.Rect({
            x: G.bezel.x, y: G.bezel.y, width: G.bezel.w, height: G.bezel.h, cornerRadius: G.bezel.r,
            fill: '#c0c4c4', stroke: '#1f2222', strokeWidth: 2,
        }));
        g.add(new Konva.Rect({
            x: G.screen.x, y: G.screen.y, width: G.screen.w, height: G.screen.h, cornerRadius: 4,
            fill: '#d8dbd9', stroke: '#9a9e9c', strokeWidth: 1.5,
        }));

        // 转速表
        const gc = G.gauge;
        g.add(new Konva.Circle({ x: gc.cx, y: gc.cy, radius: gc.r, fill: '#f2f4f2', stroke: '#7c8280', strokeWidth: 2 }));
        // 绿色正常区 9000~11000
        g.add(new Konva.Arc({
            x: gc.cx, y: gc.cy, innerRadius: gc.r - 20, outerRadius: gc.r - 8,
            angle: 45, rotation: -22.5, fill: '#43a047', stroke: '#2e7d32', strokeWidth: 0.5,
        }));
        // 红色超速区 11000~12000
        g.add(new Konva.Arc({
            x: gc.cx, y: gc.cy, innerRadius: gc.r - 20, outerRadius: gc.r - 8,
            angle: 22.5, rotation: 22.5, fill: '#e53935',
        }));
        for (let v = 0; v <= 12000; v += 1000) {
            const a = (-135 + (v / 12000) * 270) * Math.PI / 180;
            const x1 = gc.cx + Math.sin(a) * (gc.r - 26);
            const y1 = gc.cy - Math.cos(a) * (gc.r - 26);
            const x2 = gc.cx + Math.sin(a) * (gc.r - 14);
            const y2 = gc.cy - Math.cos(a) * (gc.r - 14);
            g.add(new Konva.Line({ points: [x1, y1, x2, y2], stroke: '#37474f', strokeWidth: v % 2000 === 0 ? 2 : 1 }));
            if (v % 2000 === 0) {
                const lx = gc.cx + Math.sin(a) * (gc.r - 42);
                const ly = gc.cy - Math.cos(a) * (gc.r - 42);
                this._label(g, lx - 16, ly - 7, String(v / 1000), 10, '#37474f', false, 'center', 32);
            }
        }
        this._label(g, gc.cx - 60, gc.cy + 34, 'r/min ×1000', 11, '#546e7a', false, 'center', 120);
        this._label(g, gc.cx - 60, gc.cy - 76, 'BOWL SPEED', 11, '#546e7a', true, 'center', 120);

        // KPI 底板
        const K = G.kpi;
        this._kpiDefs = [
            ['TT1', '进油温度', '°C'], ['PT1', '进油压力', 'MPa'],
            ['PT4', '净油压力', 'MPa'], ['PT5', '出水压力', 'MPa'],
            ['MT', '水分', 'pF'], ['FLOW', '进油流量', 'm³/h'],
            ['RUN', '运行时间', 'h'], ['DISCH', '排渣次数', '次'],
        ];
        this._kpiDefs.forEach((d, i) => {
            const col = i % 2, row = Math.floor(i / 2);
            const x = K.x + col * (K.w + K.colGap);
            const y = K.y + row * (K.h + K.rowGap);
            g.add(new Konva.Rect({
                x, y, width: K.w, height: K.h, cornerRadius: 3,
                fill: '#eef0ee', stroke: '#9aa09d', strokeWidth: 1,
            }));
            this._label(g, x + 8, y + 5, `${d[0]}  ${d[1]}`, 12, '#546e7a', true);
            this._label(g, x + K.w - 58, y + 30, d[2], 10, '#78909c', false, 'right', 50);
        });

        // 分离筒示意底板
        const M = G.mimic;
        g.add(new Konva.Rect({
            x: M.x, y: M.y, width: M.w, height: M.h, cornerRadius: 4,
            fill: '#eef0ee', stroke: '#9aa09d', strokeWidth: 1,
        }));
        this._label(g, M.x + 10, M.y + 7, 'SEPARATOR BOWL', 13, '#455a64', true);
        this._label(g, M.x + 10, M.y + 24, 'S 型分离筒半剖示意', 12, '#78909c');

        // 油柜底板
        const T = G.tanks;
        g.add(new Konva.Rect({
            x: T.x, y: T.y, width: T.w, height: T.h, cornerRadius: 4,
            fill: '#eef0ee', stroke: '#9aa09d', strokeWidth: 1,
        }));
        this._label(g, T.x + 10, T.y + 7, 'TANK LEVELS', 13, '#455a64', true);

        // 报警底板
        const A = G.alarms;
        g.add(new Konva.Rect({
            x: A.x, y: A.y, width: A.w, height: A.h, cornerRadius: 4,
            fill: '#f7eeee', stroke: '#b71c1c', strokeWidth: 1,
        }));
        this._label(g, A.x + 10, A.y + 7, 'ALARMS', 13, '#b71c1c', true);

        // 底部
        const F = G.footer;
        g.add(new Konva.Rect({
            x: F.x, y: F.y, width: F.w, height: F.h, cornerRadius: 4,
            fill: '#eef0ee', stroke: '#9aa09d', strokeWidth: 1,
        }));
        this._label(g, F.x + 10, F.y + 7, 'OPERATION', 13, '#78909c', true);
    }

    _createDynamicNodes() {
        const d = this._dynamicGroup, G = this._geo;

        // 状态横幅
        this._bannerRect = new Konva.Rect({
            x: G.banner.x, y: G.banner.y, width: G.banner.w, height: G.banner.h,
            cornerRadius: 4, fill: '#263238', stroke: '#111', strokeWidth: 1,
        });
        this._bannerText = new Konva.Text({
            x: G.banner.x + 16, y: G.banner.y + 12, width: G.banner.w - 240, height: 34,
            text: 'STANDSTILL', fontSize: 26, fontStyle: 'bold',
            fontFamily: 'Arial, "Microsoft YaHei", sans-serif', fill: '#ffffff',
        });
        this._bannerSub = new Konva.Text({
            x: G.banner.x + G.banner.w - 300, y: G.banner.y + 16, width: 282, height: 28,
            text: '', fontSize: 14, align: 'right',
            fontFamily: 'Arial, "Microsoft YaHei", sans-serif', fill: '#cfd8dc',
        });
        d.add(this._bannerRect, this._bannerText, this._bannerSub);

        // 转速指针与数值
        const gc = G.gauge;
        this._needle = new Konva.Group({ x: gc.cx, y: gc.cy, rotation: -135 });
        this._needle.add(new Konva.Line({ points: [0, 12, 0, -gc.r + 30], stroke: '#c62828', strokeWidth: 3, lineCap: 'round' }));
        this._needle.add(new Konva.Circle({ x: 0, y: 0, radius: 7, fill: '#37474f' }));
        d.add(this._needle);
        this._speedText = new Konva.Text({
            x: gc.cx - 100, y: gc.cy + 62, width: 200, height: 40,
            text: '0', fontSize: 28, fontStyle: 'bold', align: 'center',
            fontFamily: 'Consolas, monospace', fill: '#263238',
        });
        d.add(this._speedText);
        this._speedUnit = new Konva.Text({
            x: gc.cx - 100, y: gc.cy + 100, width: 200, height: 22,
            text: 'r/min', fontSize: 12, align: 'center', fill: '#546e7a',
        });
        d.add(this._speedUnit);

        // KPI 数值
        this._kpiTexts = this._kpiDefs.map((def, i) => {
            const K = G.kpi;
            const col = i % 2, row = Math.floor(i / 2);
            const x = K.x + col * (K.w + K.colGap);
            const y = K.y + row * (K.h + K.rowGap);
            const t = new Konva.Text({
                x: x + 8, y: y + 24, width: K.w - 70, height: 36,
                text: '--', fontSize: 24, fontFamily: 'Consolas, monospace', fill: '#1b5e20',
            });
            d.add(t);
            return t;
        });

        // 分离筒示意
        const M = G.mimic;
        const cx = M.x + 250, cy = M.y + 150;
        // 外壳
        d.add(new Konva.Circle({ x: cx, y: cy, radius: 108, fill: '#d7dbd8', stroke: '#546e7a', strokeWidth: 3 }));
        d.add(new Konva.Circle({ x: cx, y: cy, radius: 96, fill: '#f7f8f6', stroke: '#90a4ae', strokeWidth: 1 }));
        // 渣层
        this._mimicSludge = new Konva.Arc({
            x: cx, y: cy, innerRadius: 74, outerRadius: 94, angle: 300, rotation: 30,
            fill: '#8d6e63', opacity: 0.85,
        });
        d.add(this._mimicSludge);
        // 水封
        this._mimicWater = new Konva.Arc({
            x: cx, y: cy, innerRadius: 62, outerRadius: 74, angle: 300, rotation: 30,
            fill: '#4fc3f7', opacity: 0.9,
        });
        d.add(this._mimicWater);
        // 分离盘组
        this._mimicDisc = new Konva.Group({ x: cx, y: cy });
        for (let i = -5; i <= 5; i++) {
            this._mimicDisc.add(new Konva.Line({
                points: [-60, i * 9, 60, i * 9], stroke: '#90a4ae', strokeWidth: 1.5,
            }));
        }
        this._mimicDisc.add(new Konva.Line({ points: [0, -70, 0, 70], stroke: '#607d8b', strokeWidth: 3 }));
        d.add(this._mimicDisc);
        // 排渣闪光
        this._mimicFlash = new Konva.Circle({
            x: cx, y: cy + 96, radius: 14, fill: '#ffb300', opacity: 0, listening: false,
        });
        d.add(this._mimicFlash);

        this._mimicState = new Konva.Text({
            x: M.x + 10, y: M.y + M.h - 50, width: M.w - 20, height: 46,
            text: '', fontSize: 12, lineHeight: 1.35, fill: '#37474f',
            fontFamily: 'Arial, "Microsoft YaHei", sans-serif',
        });
        d.add(this._mimicState);

        // 油柜
        const T = G.tanks;
        this._tankDefs = [
            ['dirty', '沉淀柜', '#c48b2c'],
            ['clean', '净油柜', '#2e7d32'],
            ['sludge', '排渣柜', '#6d4c41'],
        ];
        this._tankFills = {};
        this._tankTexts = {};
        this._tankDefs.forEach(([id, label, color], i) => {
            const x = T.x + 24 + i * 70;
            const y = T.y + 54;
            const h = 190;
            d.add(new Konva.Rect({ x, y, width: 42, height: h, fill: '#ffffff', stroke: '#78909c', strokeWidth: 1 }));
            const fill = new Konva.Rect({ x: x + 2, y: y + 2, width: 38, height: 0, fill: color });
            d.add(fill);
            this._tankFills[id] = { fill, x: x + 2, y: y + 2, h: h - 4, color };
            this._label(d, x - 10, y - 22, label, 12, '#455a64', true, 'center', 62);
            const t = new Konva.Text({
                x: x - 16, y: y + h + 6, width: 70, height: 20,
                text: '0%', fontSize: 15, align: 'center', fill: '#37474f',
                fontFamily: 'Consolas, monospace',
            });
            d.add(t);
            this._tankTexts[id] = t;
        });

        // 报警行
        const A = G.alarms;
        this._alarmLines = [];
        for (let i = 0; i < 8; i++) {
            const t = new Konva.Text({
                x: A.x + 10, y: A.y + 30 + i * 32, width: A.w - 20, height: 30,
                text: '', fontSize: 13, lineHeight: 1.2, fill: '#b71c1c',
                fontFamily: 'Arial, "Microsoft YaHei", sans-serif',
            });
            d.add(t);
            this._alarmLines.push(t);
        }

        // 底部信息
        const F = G.footer;
        this._footerText = new Konva.Text({
            x: F.x + 10, y: F.y + 25, width: F.w - 20, height: F.h - 20,
            text: '', fontSize: 15, lineHeight: 1.8, fill: '#37474f',
            fontFamily: 'Arial, "Microsoft YaHei", sans-serif',
        });
        d.add(this._footerText);
    }

    _syncVisuals() {
        const s = this._solver();
        const m = s ? s.m : null;
        if (!m) return;

        const stateMap = {
            STANDSTILL: ['STOPPED / 静止', '#37474f'],
            STARTING: ['STARTING / 升速', '#1565c0'],
            START_SEQ: ['START SEQUENCE / 起动程序', '#1565c0'],
            STANDBY: ['STANDBY / 待命', '#f9a825'],
            SEPARATION: ['SEPARATION / 正常分油', '#2e7d32'],
            DISCHARGE: ['SLUDGE DISCHARGE / 排渣', '#ef6c00'],
            STOPPING: ['STOPPING / 停机程序', '#b71c1c'],
        };
        const [stateText, color] = stateMap[m.state] || [m.state, '#37474f'];
        this._bannerText.text(stateText);
        this._bannerRect.fill(color);
        this._bannerSub.text(`S 936   ${m.local ? 'LOCAL' : 'REMOTE'}   ${m.epcPower ? 'EPC ON' : 'EPC OFF'}`);

        const rpm = m.bowl.speed;
        this._speedText.text(String(Math.round(rpm)));
        this._needle.rotation(-135 + clamp(rpm / 12000, 0, 1) * 270);
        this._speedText.fill(rpm > 11000 ? '#c62828' : (rpm > 500 ? '#1b5e20' : '#263238'));

        const vals = [
            m.feed.temp.toFixed(1), m.feed.pressure.toFixed(3),
            m.oil.outletPressure.toFixed(3), m.water.outletPressure.toFixed(3),
            m.faults.transducer ? 'NC' : m.oil.waterContent.toFixed(1),
            m.feed.flow.toFixed(2), m.counters.runTime.toFixed(1), String(m.counters.dischargeCount),
        ];
        this._kpiTexts.forEach((t, i) => { t.text(vals[i]); });

        // 分离筒示意
        const sealed = m.bowl.waterSeal;
        this._mimicWater.visible(sealed);
        this._mimicSludge.visible(rpm > 500);
        this._mimicDisc.rotation((m.bowl.discRot * 8) % 360);
        this._mimicFlash.opacity(m.bowl.discharge > 0 ? 0.9 : 0);
        const mt = m.faults.transducer ? 'NC' : `${m.oil.waterContent.toFixed(1)} pF`;
        this._mimicState.text(
            `分离筒：${m.bowl.closed ? '关闭' : '开启'}    水封：${sealed ? '已建立' : '未建立'}\n`
            + `ALCAP：${m.faults.transducer ? 'STANDBY' : (m.water.drain ? '排水' : '正常')}    MT：${mt}`
        );

        // 油柜
        this._setTank('dirty', m.oil.dirty);
        this._setTank('clean', m.oil.clean);
        this._setTank('sludge', m.sludge.tank);

        // 报警
        const list = m.alarms.filter(a => a.active).slice(0, 8);
        this._alarmLines.forEach((t, i) => {
            const a = list[i];
            t.text(a ? `${a.ack ? '  ' : '● '}${a.code} ${a.text}` : '');
            t.fill(a ? (a.ack ? '#8e6b6b' : '#b71c1c') : '#b71c1c');
        });

        // 底部
        const next = formatClock(m.sludge.nextIn);
        this._footerText.text(
            `下次排渣：${next}    排渣间隔：${m.params.dischargeInterval} min     分离温度设定：${m.params.sepTemp} °C\n`
            + `工作水：${m.water.supply.toFixed(1)} bar     控制空气：${m.water.air.toFixed(1)} bar    `
            + `振动：${m.bowl.vibration.toFixed(1)} mm/s   `
        );

        if (this.sys && this.sys.requestRedraw) this.sys.requestRedraw();
    }

    _setTank(id, pct) {
        const t = this._tankFills[id];
        if (!t) return;
        pct = clamp(pct, 0, 100);
        const h = t.h * pct / 100;
        t.fill.y(t.y + (t.h - h));
        t.fill.height(h);
        this._tankTexts[id].text(`${Math.round(pct)}%`);
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

function formatClock(sec) {
    sec = Math.max(0, Math.round(sec));
    const mm = Math.floor(sec / 60);
    const ss = sec % 60;
    return `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
}

export default PurifierStatusPanel;
