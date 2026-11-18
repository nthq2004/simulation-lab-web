import Konva from 'konva';
import { BaseComponent } from './BaseComponent.js';

/**
 * WindFuelCutoffDemo — 风油切断操作与原理演示组件
 * ═══════════════════════════════════════════════════════════════
 *  版式（525 × 758）：
 *    上半（y 6 ~ 346）：两块完全相同的控制屏（各 253 × 340）
 *      左：消防控制室风油切断控制屏   右：驾驶台风油切断控制屏
 *      每屏 4 个自锁式方形按钮（按下自锁 / 再按弹出）+ 每路状态灯：
 *        机舱风机 ESS-1F / 机舱油泵 ESS-1P / 住舱风机 ESS-1F / 泵房风机 ESS-1F
 *    下半（y 352 ~ 752）：风油切断工作原理 MIMIC 图，两个结构相同的 24V 直流回路（各 513 × 186）
 *      风机切断电路：消防控制室、驾驶台两条并联按钮支路 → 中间继电器 KA1
 *                    → 三副常开辅助触头 → 1#机舱风机 / 2#机舱风机 / 舵机房风机 分励脱扣器（同铭牌 ESS-1F）
 *      油泵切断电路：同上（KA2）→ 1#滑油泵 / 1#燃油泵 / 1#增压泵 分励脱扣器（同铭牌 ESS-1P）
 *
 *  动作逻辑：
 *    任一地点按下任一应急切断按钮（自锁）→ 该回路中间继电器得电 → 辅助常开触头闭合
 *    → 对应分励脱扣器带电 → 动力负载屏对应塑壳断路器跳闸（停在 TRIP 位）→ 风机/油泵停转。
 *    再按一次按钮使其弹出 → 脱扣回路失电，塑壳断路器需先复位到 OFF 再合闸。
 *
 *  可点击部件（工作流 subTarget / op.part）：
 *    panel-fire / panel-bridge、btn-fire-0~3 / btn-bridge-0~3、
 *    mimic-fan / mimic-oil、ka-fan / ka-oil
 * ═══════════════════════════════════════════════════════════════
 */

const W0 = 585, H0 = 788;

const PW = 285, PGAP = 5, PTOP = 6, PH = 355;

const LOCS = [
    { key: 'fire', short: '消防控制室', title: '消防控制室风油切断控制屏' },
    { key: 'bridge', short: '驾驶台', title: '驾驶台风油切断控制屏' },
];

const BUTTONS = [
    { label: '机舱风机', sub: '应急切断', tag: 'ESS-1F', group: 'fan' },
    { label: '机舱油泵', sub: '应急切断', tag: 'ESS-1P', group: 'oil' },
    { label: '住舱风机', sub: '应急切断', tag: 'ESS-2F', group: 'fan' },
    { label: '泵房风机', sub: '应急切断', tag: 'ESS-2F', group: 'fan' },
];

const ROW_Y = [83, 160, 237, 314];

// 两路切断回路的负载（分励脱扣器）：同一排的开关铭牌相同，
// 联动用内部位置键（fan-0/1/2、oil-0/1/2）逐路判定
const FAN_KEYS = ['fan-0', 'fan-1', 'fan-2'];
const OIL_KEYS = ['oil-0', 'oil-1', 'oil-2'];

const CIRC_H = 186;

const CIRC = {
    fan: {
        y: 399, title: '风机切断电路', ka: 'KA1',
        labels: ['消防控制室', '驾驶台'],
        loads: [
            { t: '1#机舱风机', tag: 'ESS-1F' },
            { t: '2#机舱风机', tag: 'ESS-1F' },
            { t: '舵机房风机', tag: 'ESS-1F' },
        ],
    },
    oil: {
        y: 595, title: '油泵切断电路', ka: 'KA2',
        labels: ['消防控制室', '驾驶台'],
        loads: [
            { t: '1#滑油泵', tag: 'ESS-1P' },
            { t: '1#燃油泵', tag: 'ESS-1P' },
            { t: '1#增压泵', tag: 'ESS-1P' },
        ],
    },
};

const HOT = '#e02020';
const COLD = '#9aa6a0';

export class WindFuelCutoffDemo extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.W = W0;
        this.H = H0;
        this.width = W0;
        this.height = H0;

        this.type = 'wind_fuel_cutoff';
        this.special = 'windfuelcutoff';
        this.cache = 'fixed';

        this._loadId = config.loadId || 'load';

        // 各地点各路按钮的自锁状态
        this._latch = LOCS.map(() => BUTTONS.map(() => false));

        // 故障：① 中间继电器线圈断线（两路共用）② 某一路分励脱扣器线圈断线（位掩码）
        this._faultKA = false;
        this._faultShunt = 0;

        this._initGroups();
        this._init();
        this._syncVisuals();

        this.config = { id: this.id, loadId: this._loadId };
    }

    _tip(msg) {
        if (this.sys && typeof this.sys.showFloatingTip === 'function') this.sys.showFloatingTip(msg, 2600);
    }

    // ═══════════════════════════════════════════════════════
    //  构建
    // ═══════════════════════════════════════════════════════
    _init() {
        this._drawStatic();
        this._createDynamic();
        this._bindInteraction();
    }

    _drawStatic() {
        const s = this._staticGroup;

        // ── 上半：两块控制屏 ──
        LOCS.forEach((loc, li) => {
            const px = 5 + li * (PW + PGAP);
            s.add(new Konva.Rect({
                x: px, y: PTOP, width: PW, height: PH,
                fill: '#f4f8f2', stroke: '#5a7a5a', strokeWidth: 1.2, cornerRadius: 2, listening: false,
            }));
            s.add(new Konva.Text({
                x: px, y: PTOP + 8, width: PW, text: loc.title,
                fontSize: 15.5, fontStyle: 'bold', fill: '#0b6a14', align: 'center', listening: false,
            }));
            s.add(new Konva.Text({
                x: px, y: PTOP + 32, width: PW, text: '按下自锁 / 再按弹出',
                fontSize: 11.5, fill: '#0c0c0c', align: 'center', listening: false,
            }));

            BUTTONS.forEach((b, i) => {
                const cy = ROW_Y[i];
                s.add(new Konva.Text({ x: px + 10, y: cy - 20, width: 92, text: b.label, fontSize: 14, fontStyle: 'bold', fill: '#1a252f', align: 'center', listening: false }));
                s.add(new Konva.Text({ x: px + 10, y: cy - 3, width: 92, text: b.sub, fontSize: 12, fontStyle: 'bold', fill: '#c03020', align: 'center', listening: false }));
                s.add(new Konva.Text({ x: px + 10, y: cy + 12, width: 92, text: b.tag, fontSize:10 , fill: '#5a6a75', align: 'center', listening: false }));
                // 方形底座（深灰） + 内凹面
                s.add(new Konva.Rect({ x: px + 110, y: cy - 23, width: 66, height: 46, fill: '#3a4249', stroke: '#1a252f', strokeWidth: 1.2, cornerRadius: 3, listening: false }));
                s.add(new Konva.Rect({ x: px + 115, y: cy - 19, width: 56, height: 38, fill: '#232a30', stroke: '#151a1f', strokeWidth: 0.8, cornerRadius: 2, listening: false }));
                // 指示灯底座
                s.add(new Konva.Circle({ x: px + 232, y: cy, radius: 8, fill: '#eef1f3', stroke: '#8a929c', strokeWidth: 0.8, listening: false }));
            });
        });

        // ── 分隔线 + 原理图标题 ──
        s.add(new Konva.Line({ points: [6, 367, this.W - 6, 367], stroke: '#7a8494', strokeWidth: 1, listening: false }));
        s.add(new Konva.Text({
            x: 6, y: 371, width: this.W - 12, text: '风油切断工作原理图',
            fontSize: 15, fontStyle: 'bold', fill: '#1a252f', align: 'center', listening: false,
        }));

        // ── 下半：两个原理电路 ──
        this._drawCircuitStatic(CIRC.fan);
        this._drawCircuitStatic(CIRC.oil);
    }

    _drawCircuitStatic(cfg) {
        const s = this._staticGroup, y0 = cfg.y;

        s.add(new Konva.Rect({
            x: 6, y: y0, width: this.W - 12, height: CIRC_H,
            fill: '#fbfcf7', stroke: '#8a9a8a', strokeWidth: 1, cornerRadius: 2, listening: false,
        }));
        s.add(new Konva.Text({ x: 14, y: y0 + 4, width: 116, text: cfg.title, fontSize: 13.5, fontStyle: 'bold', fill: '#1a252f', listening: false }));

        // 24V 电源端子与控制电源标注（＋、− 分别接在并联支路中点与公共 0V 线上）
        s.add(new Konva.Text({ x: 20, y: y0 + 48, width: 18, text: '+', fontSize: 16, fontStyle: 'bold', fill: '#c0392b', align: 'center', listening: false }));
        s.add(new Konva.Text({ x: 16, y: y0 + 98, width: 38, text: '24V', fontSize: 12.5, fill: '#5a6a75', align: 'center', listening: false }));
        s.add(new Konva.Text({ x: 20, y: y0 + 146, width: 20, text: '−', fontSize: 16, fontStyle: 'bold', fill: '#2c3e50', align: 'center', listening: false }));
        [72, 138].forEach(dy => s.add(new Konva.Circle({
            x: 30, y: y0 + dy, radius: 4, fill: '#ffffff', stroke: '#2c3e50', strokeWidth: 1.1, listening: false,
        })));

        // 两条并联按钮支路的文字标注（上：消防控制室　下：驾驶台）
        s.add(new Konva.Text({ x: 26, y: y0 + 32, width: 180, text: cfg.labels[0], fontSize: 11.5, fill: '#1a252f', align: 'center', listening: false }));
        s.add(new Konva.Text({ x: 26, y: y0 + 100, width: 180, text: cfg.labels[1], fontSize: 11.5, fill: '#1a252f', align: 'center', listening: false }));

        // 中间继电器标注（线圈上方）
        s.add(new Konva.Text({ x: 208, y: y0 + 32, width: 96, text: '中间继电器', fontSize: 12, fill: '#5a6a75', align: 'center', listening: false }));

        // 右侧 24V 母线 + 三路分励脱扣回路（三路线圈下端共接本回路的 0V 线）
        s.add(new Konva.Text({ x: 524, y: y0 + 16, width: 48, text: '24V +', fontSize: 11.5, fontStyle: 'bold', fill: '#c0392b', listening: false }));
        s.add(new Konva.Text({ x: 524, y: y0 + 126, width: 32, text: '0V −', fontSize: 11.5, fontStyle: 'bold', fill: '#2c3e50', listening: false }));

        cfg.loads.forEach((L, i) => {
            const cx = 366 + i * 70;
            s.add(new Konva.Text({ x: cx + 5, y: y0 + 56, width: 46, text: cfg.ka, fontSize: 13.5, fill: '#070707', listening: false }));
            s.add(new Konva.Text({ x: cx - 32, y: y0 + 144, width: 64, text: L.t, fontSize: 11.5, fill: '#1a252f', align: 'center', listening: false }));
            s.add(new Konva.Text({ x: cx - 32, y: y0 + 162, width: 64, text: L.tag, fontSize: 10.5, fill: '#fb0202', align: 'center', listening: false }));
        });
    }

    _createDynamic() {
        const d = this._dynamicGroup;

        // ── 按钮帽 + 状态灯 ──
        this._caps = [];
        this._lamps = [];
        LOCS.forEach((loc, li) => {
            const px = 5 + li * (PW + PGAP);
            const caps = [], lamps = [];
            BUTTONS.forEach((b, i) => {
                const cy = ROW_Y[i];
                const cap = new Konva.Rect({
                    x: px + 117, y: cy - 17, width: 52, height: 34, cornerRadius: 2,
                    fill: '#c02020', stroke: '#5a0000', strokeWidth: 1.2, listening: false,
                });
                const lamp = new Konva.Circle({
                    x: px + 232, y: cy, radius: 6.5, fill: '#2a2f34', stroke: '#1a252f', strokeWidth: 0.8, listening: false,
                });
                d.add(cap, lamp);
                caps.push(cap); lamps.push(lamp);
            });
            this._caps.push(caps);
            this._lamps.push(lamps);
        });

        // ── 两个原理电路的可变化节点 ──
        this._cir = {
            fan: this._mkCircuitNodes(CIRC.fan),
            oil: this._mkCircuitNodes(CIRC.oil),
        };
    }

    /** 生成一个切断回路的动态节点（导线、触头、线圈） */
    _mkCircuitNodes(cfg) {
        const d = this._dynamicGroup, y0 = cfg.y;
        const wires = [], levers = [], auxLevers = [], shunts = [];

        const wire = (pts) => {
            const n = new Konva.Line({ points: pts, stroke: COLD, strokeWidth: 1.6, lineCap: 'round', lineJoin: 'round', listening: false });
            d.add(n); wires.push(n); return n;
        };

        const yA = y0 + 52, yB = y0 + 92, yM = (yA + yB) / 2;

        // ＋24V → 两条并联支路左侧竖线中点（左右两边均从中间引出）
        wire([30, yM, 98, yM]);
        wire([98, yA, 98, yB]);
        // 上支路（消防控制室按钮）
        wire([98, yA, 124, yA]);
        wire([159, yA, 186, yA]);
        // 下支路（驾驶台按钮）
        wire([98, yB, 124, yB]);
        wire([159, yB, 186, yB]);
        // 右侧竖线中点 → 中间继电器线圈
        wire([186, yA, 186, yB]);
        wire([186, yM, 232, yM]);
        // 线圈右侧引出 → 中间继电器自身的 0V 回线（接到 − 端子，与右侧分励回路分开）
        wire([280, yM, 298, yM]);
        wire([298, yM, 298, y0 + 138]);
        wire([298, y0 + 138, 30, y0 + 138]);
        // 三路分励脱扣器共用的 0V 线（与上方 24V 母线同跨度，与左侧 KA 回线不相连）
        wire([332, y0 + 138, 542, y0 + 138]);

        // 两个常开按钮触头（水平杠杆，按下闭合；上位=消防控制室，下位=驾驶台）
        [[124, yA], [124, yB]].forEach(([x, y]) => {
            const g = new Konva.Group({ x, y, rotation: -16 });
            g.add(new Konva.Line({ points: [0, 0, 35, 0], stroke: '#2c3e50', strokeWidth: 2.4, lineCap: 'round', listening: false }));
            g.add(new Konva.Circle({ x: 0, y: 0, radius: 2.4, fill: '#2c3e50', listening: false }));
            g.add(new Konva.Circle({ x: 35, y: 0, radius: 2.4, fill: '#2c3e50', listening: false }));
            d.add(g); levers.push(g);
        });

        // 中间继电器线圈
        const coil = new Konva.Rect({
            x: 232, y: y0 + 53, width: 48, height: 38, cornerRadius: 2,
            fill: '#ffffff', stroke: '#8a5a2a', strokeWidth: 1.6, listening: false,
        });
        d.add(coil);
        d.add(new Konva.Text({ x: 232, y: y0 + 64, width: 48, text: cfg.ka, fontSize: 14, fontStyle: 'bold', fill: '#8a3a10', align: 'center', listening: false }));

        // 右侧 24V 母线
        wire([332, y0 + 30, 542, y0 + 30]);

        cfg.loads.forEach((L, i) => {
            const cx = 366 + i * 70;
            // 支路竖直导线（下端共接 0V 线）
            wire([cx, y0 + 30, cx, y0 + 48]);
            wire([cx, y0 + 74, cx, y0 + 88]);
            wire([cx, y0 + 120, cx, y0 + 138]);
            // 常开辅助触头（竖直杠杆，继电器吸合时闭合）
            const g = new Konva.Group({ x: cx, y: y0 + 48, rotation: 22 });
            g.add(new Konva.Line({ points: [0, 0, 0, 26], stroke: '#2c3e50', strokeWidth: 2.4, lineCap: 'round', listening: false }));
            g.add(new Konva.Circle({ x: 0, y: 0, radius: 2.4, fill: '#2c3e50', listening: false }));
            g.add(new Konva.Circle({ x: 0, y: 26, radius: 2.4, fill: '#2c3e50', listening: false }));
            d.add(g); auxLevers.push(g);
            // 分励脱扣器线圈
            const sh = new Konva.Rect({
                x: cx - 13, y: y0 + 88, width: 26, height: 32, cornerRadius: 2,
                fill: '#ffffff', stroke: '#8a5a2a', strokeWidth: 1.6, listening: false,
            });
            d.add(sh); shunts.push(sh);
            d.add(new Konva.Text({ x: cx - 17, y: y0 + 96, width: 34, text: 'SR', fontSize: 12, fontStyle: 'bold', fill: '#8a3a10', align: 'center', listening: false }));
        });

        return { wires, levers, auxLevers, coil, shunts };
    }

    _bindInteraction() {
        // 整屏（供 find 识别整块控制屏）
        LOCS.forEach((loc, li) => {
            const px = 5 + li * (PW + PGAP);
            const pane = this.addClickablePart(`panel-${loc.key}`, px, PTOP, PW, PH, false);
            pane.on('click', () => this._tip(`${loc.title}：4 路应急切断按钮，按下自锁、再按弹出`));
            BUTTONS.forEach((b, i) => {
                const cy = ROW_Y[i];
                const hit = this.addClickablePart(`btn-${loc.key}-${i}`, px + 109, cy - 26, 68, 52, true);
                hit.on('click tap', (e) => { e.cancelBubble = true; this.toggle(loc.key, i); });
            });
        });

        // 原理图区域
        const f = this.addClickablePart('mimic-fan', 6, CIRC.fan.y, this.W - 12, CIRC_H, false);
        f.on('click', () => this._tip('风机切断电路：按钮闭合 → KA1 得电 → 三副辅助触头闭合 → 三路分励脱扣器动作'));
        const o = this.addClickablePart('mimic-oil', 6, CIRC.oil.y, this.W - 12, CIRC_H, false);
        o.on('click', () => this._tip('油泵切断电路：与风机回路结构相同，由 KA2 带动三路油泵分励脱扣器'));

        const kf = this.addClickablePart('ka-fan', 208, CIRC.fan.y + 36, 96, 72, true);
        kf.on('click', () => this._tip('中间继电器 KA1：串在两条并联的切断按钮支路中，任一按钮按下即得电吸合'));
        const ko = this.addClickablePart('ka-oil', 208, CIRC.oil.y + 36, 96, 72, true);
        ko.on('click', () => this._tip('中间继电器 KA2：油泵切断回路的中间继电器'));
    }

    // ═══════════════════════════════════════════════════════
    //  状态与联动
    // ═══════════════════════════════════════════════════════
    /** 某回路是否有按钮已自锁（两个地点任一） */
    _closed(key) {
        return this._latch.some(row => row.some((v, i) => v && BUTTONS[i].group === key));
    }

    /** 指定地点的某回路按钮是否有按下（决定原理图中该地点的按钮触头是否闭合） */
    _locClosed(locKey, key) {
        const li = LOCS.findIndex(l => l.key === locKey);
        if (li < 0) return false;
        return this._latch[li].some((v, i) => v && BUTTONS[i].group === key);
    }

    /** 分励脱扣器带电状态表：{ 位置键: true/false, 铭牌: true/false }，供动力负载屏跳闸 */
    _shuntMap() {
        const fanOn = this._closed('fan') && !this._faultKA;
        const oilOn = this._closed('oil') && !this._faultKA;
        const map = {};
        FAN_KEYS.forEach((k, i) => { map[k] = fanOn && !(this._faultShunt & (1 << i)); });
        OIL_KEYS.forEach((k, i) => { map[k] = oilOn && !(this._faultShunt & (1 << (3 + i))); });
        // 兼容按铭牌查询（同一铭牌的多路开关只用于显示/问询）
        map['ESS-1F'] = fanOn;
        map['ESS-1P'] = oilOn;
        return map;
    }

    _pushLoad() {
        const load = this.sys && this.sys.comps ? this.sys.comps[this._loadId] : null;
        if (load && typeof load.setShuntLive === 'function') load.setShuntLive(this._shuntMap());
    }

    /**
     * 燃油泵全停 → 主机/发电机断油停机 → 主配电板失电 的联锁
     *   油泵切断回路动作（KA2 带电、三路油泵分励跳闸）→ 配电板立即失电（各负载无电、不能起动）
     *   切断按钮全部弹出后延时约 3 s，模拟发电机重新起动建压、配电板恢复供电
     */
    _syncPower() {
        const load = this.sys && this.sys.comps ? this.sys.comps[this._loadId] : null;
        if (!load || typeof load.getBusLive !== 'function' || typeof load.setBusLive !== 'function') return;

        const cut = this.isOilCut() && !this._faultKA;   // 燃油泵切断回路已动作
        const live = load.getBusLive();
        const now = Date.now();

        if (cut) {
            if (live) {
                load.setBusLive(false);
                this._tip('燃油泵全停 → 发电机断油停机 → 主配电板失电：各负载无电，合闸也不能起动');
            }
        }
        // 恢复供电需人工重新起动发电机组（点击负载屏上的汇流排指示），不作定时自动恢复
    }

    _syncVisuals() {
        // 面板按钮帽与状态灯
        LOCS.forEach((loc, li) => {
            BUTTONS.forEach((b, i) => {
                const on = this._latch[li][i];
                const cap = this._caps[li][i], lamp = this._lamps[li][i];
                if (cap) {
                    cap.fill(on ? '#7a1010' : '#c02020');
                    cap.y(ROW_Y[i] - 17 + (on ? 4 : 0));
                }
                if (lamp) lamp.fill(on ? '#2eff3e' : '#2a2f34');
            });
        });

        // 两个原理回路
        ['fan', 'oil'].forEach(k => {
            const c = this._cir[k];
            if (!c) return;
            const closed = this._closed(k);
            const energized = closed && !this._faultKA;

            c.wires.forEach(w => w.stroke(energized ? HOT : COLD));
            // 两个按钮触头按各自地点分别闭合：上位 = 消防控制室，下位 = 驾驶台
            c.levers.forEach((l, i) => {
                const locKey = (LOCS[i] || LOCS[0]).key;
                l.rotation(this._locClosed(locKey, k) ? 0 : -16);
            });
            c.auxLevers.forEach(l => l.rotation(energized ? 0 : 22));
            c.coil.fill(energized ? '#ffd7a8' : '#ffffff');
            c.coil.stroke(energized ? HOT : '#8a5a2a');
            c.shunts.forEach((r, i) => {
                const bit = (k === 'fan' ? i : 3 + i);
                const hot = energized && !(this._faultShunt & (1 << bit));
                r.fill(hot ? '#ffb3b3' : '#ffffff');
                r.stroke(hot ? HOT : '#8a5a2a');
            });
        });
    }

    tick(dt) {
        this._pushLoad();
        this._syncPower();
        this._syncVisuals();
        this.markDirty();
        this._refreshIfDirty();
    }

    // ═══════════════════════════════════════════════════════
    //  公开 API（供工作流 / 故障配置使用）
    // ═══════════════════════════════════════════════════════
    /** 按下/弹出某地点的某个应急切断按钮 */
    toggle(locKey, idx) {
        const li = LOCS.findIndex(l => l.key === locKey);
        if (li < 0 || idx < 0 || idx >= BUTTONS.length) return;
        this._latch[li][idx] = !this._latch[li][idx];
        const b = BUTTONS[idx], on = this._latch[li][idx];
        const route = b.group === 'fan' ? '风机' : '油泵';
        this._tip(on
            ? `${LOCS[li].short}「${b.label}${b.sub}」按下自锁：${b.tag} 送电，${route}切断回路动作`
            : `${LOCS[li].short}「${b.label}${b.sub}」弹出复位：${b.tag} 脱扣回路失电`);
        this._syncVisuals();
        this._pushLoad();
        if (this.sys && this.sys.redrawAll) this.sys.redrawAll();
    }

    /** 直接置位某按钮（不再重复点击时用） */
    setButton(locKey, idx, on) {
        const li = LOCS.findIndex(l => l.key === locKey);
        if (li < 0 || idx < 0 || idx >= BUTTONS.length) return;
        this._latch[li][idx] = !!on;
        this._syncVisuals();
        this._pushLoad();
    }

    getButton(locKey, idx) {
        const li = LOCS.findIndex(l => l.key === locKey);
        if (li < 0) return false;
        return !!this._latch[li][idx];
    }

    /** 全部按钮弹出复位 */
    resetAll() {
        this._busBackAt = 0;
        this._latch = LOCS.map(() => BUTTONS.map(() => false));
        this._syncVisuals();
        this._pushLoad();
        if (this.sys && this.sys.redrawAll) this.sys.redrawAll();
    }

    /** 风机切断回路是否已动作（有按钮自锁） */
    isFanCut() { return this._closed('fan'); }
    /** 油泵切断回路是否已动作 */
    isOilCut() { return this._closed('oil'); }
    /** 风机回路中间继电器是否已吸合 */
    isKaFanEnergized() { return this._closed('fan') && !this._faultKA; }
    isKaOilEnergized() { return this._closed('oil') && !this._faultKA; }
    /** 某铭牌的分励脱扣器是否带电 */
    isShuntHot(tag) { const m = this._shuntMap(); return !!m[tag]; }

    // 故障注入
    setFaultKA(on) {
        this._faultKA = !!on;
        this._syncVisuals();
        this._pushLoad();
    }
    hasFaultKA() { return !!this._faultKA; }

    /** bit：0~2 风机三路，3~5 油泵三路 */
    setFaultShunt(bit, on) {
        if (bit < 0 || bit > 5) return;
        if (on) this._faultShunt |= (1 << bit);
        else this._faultShunt &= ~(1 << bit);
        this._syncVisuals();
        this._pushLoad();
    }
    hasFaultShunt(bit) { return !!(this._faultShunt & (1 << bit)); }

    getConfigFields() {
        return [
            { key: 'loadId', label: '关联的动力负载屏组件 id', type: 'text' },
        ];
    }

    onConfigUpdate(cfg) {
        if (cfg && cfg.loadId) this._loadId = cfg.loadId;
        this.config = { ...(this.config || {}), ...(cfg || {}) };
    }
}
