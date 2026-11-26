import Konva from 'konva';
import { BaseComponent } from './BaseComponent.js';

/**
 * PartialLoadPanel — 部分动力负载屏（3 × 3 塑壳断路器）
 * ═══════════════════════════════════════════════════════════════
 *  版式（495 × 713）参照低压主配电板「动力负载屏」（LvSwitchPanel 的塑壳开关画法）：
 *    柜体 → 标题栏 → 3 行 × 3 列塑壳断路器（72 × 94），每个开关下方标注
 *    负荷名称与铭牌标签。
 *
 *  开关默认状态：6 路风机/油泵合闸（ON），3 路备用分闸（OFF）。
 *  分励脱扣：风油切断组件送来的 `setShuntLive({ 铭牌: true })` 使对应开关跳闸，
 *            手柄停在 TRIP 位；脱扣器带电期间合闸立即跳闸，必须先复位到 OFF 再合闸。
 *
 *  可点击部件（工作流 subTarget / op.part）：qf1 ~ qf9（对应图面左上 → 右下）
 * ═══════════════════════════════════════════════════════════════
 */

const W0 = 495, H0 = 713;
const COLS = 3, ROWS = 3;

// 负荷清单（第 1 排风机、第 2 排油泵受风油切断控制；第 3 排为一般动力负载）
// key 为风油切断分励联动用的内部位置键（同一铭牌可有多个开关）
const SWITCHES = [
    { name: '1#机舱风机', tag: 'ESS-1F', key: 'fan-0', group: 'fan', on: true },
    { name: '2#机舱风机', tag: 'ESS-1F', key: 'fan-1', group: 'fan', on: true },
    { name: '舵机房风机', tag: 'ESS-1F', key: 'fan-2', group: 'fan', on: true },
    { name: '1#滑油泵', tag: 'ESS-1P', key: 'oil-0', group: 'oil', on: true },
    { name: '1#燃油泵', tag: 'ESS-1P', key: 'oil-1', group: 'oil', on: true },
    { name: '1#增压泵', tag: 'ESS-1P', key: 'oil-2', group: 'oil', on: true },
    { name: '1#厨房变压器', tag: 'PT-1', key: '', group: '', on: true },
    { name: '1#主空压机', tag: 'HEF-1', key: '', group: '', on: true },
    { name: '1#主海水泵', tag: 'SQ4', key: '', group: '', on: true },
];

const MCCB_W = 110, MCCB_H = 159;
const GRID_TOP = 34, GRID_BOT = 10, GRID_SIDE = 10;
const GREEN = '#20a030', ORANGE = '#e08020', RED = '#c03020';

export class PartialLoadPanel extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.W = W0;
        this.H = H0;
        this.width = W0;
        this.height = H0;

        this.type = 'partial_load_panel';
        this.special = 'partialload';
        this.cache = 'fixed';

        // 开关状态
        this._sw = SWITCHES.map(s => ({ ...s, trip: false }));
        if (Array.isArray(config.switches)) {
            config.switches.forEach((c, i) => { if (this._sw[i]) Object.assign(this._sw[i], c); });
        }
        this._shunt = this._sw.map(() => false);   // 分励脱扣器带电状态
        this._busLive = true;                      // 主配电板汇流排带电状态（发电机停机 → 失电）

        this._initGroups();
        this._init();
        this._refreshAll();

        this.config = { id: this.id };
    }

    _tip(msg) {
        if (this.sys && typeof this.sys.showFloatingTip === 'function') this.sys.showFloatingTip(msg, 2600);
    }

    // ═══════════════════════════════════════════════════════
    //  构建
    // ═══════════════════════════════════════════════════════
    _init() {
        this._drawStatic();
        this._createBusIndicator();
        this._bindInteraction();
    }

    /** 主配电板汇流排带电指示（发电机停机 → 全船失电时点亮红灯） */
    _createBusIndicator() {
        const d = this._dynamicGroup;
        this._busDot = new Konva.Circle({ x: 342, y: 17, radius: 5.5, fill: '#2eff3e', stroke: '#1a5a1a', strokeWidth: 1, listening: false });
        this._busTxt = new Konva.Text({ x: 352, y: 9, width: 138, text: '配电板带电', fontSize: 11.5, fontStyle: 'bold', fill: '#0a6a12', listening: false });
        d.add(this._busDot, this._busTxt);
    }

    _refreshBus() {
        if (!this._busDot) return;
        this._busDot.fill(this._busLive ? '#2eff3e' : '#ff3030');
        this._busDot.stroke(this._busLive ? '#1a5a1a' : '#7a0f0f');
        this._busTxt.text(this._busLive ? '配电板带电' : '配电板失电');
        this._busTxt.fill(this._busLive ? '#0a6a12' : '#b01818');
    }

    _cellGeom(i) {
        const r = Math.floor(i / COLS), c = i % COLS;
        const cellW = (this.W - GRID_SIDE * 2) / COLS;
        const cellH = (this.H - GRID_TOP - GRID_BOT) / ROWS;
        const x0 = GRID_SIDE + c * cellW;
        return { r, c, x0, cellW, cellH, cy: GRID_TOP + r * cellH + 91, cx: x0 + cellW / 2 };
    }

    _drawStatic() {
        const s = this._staticGroup;

        // 柜体
        s.add(new Konva.Rect({ x: 2, y: 2, width: this.W - 4, height: this.H - 4, fill: '#e8ecef', stroke: '#4a5a66', strokeWidth: 1.2, cornerRadius: 2, listening: false }));
        s.add(new Konva.Text({ x: 0, y: 8, width: this.W, text: '部分动力负载屏', fontSize: 12, fontStyle: 'bold', fill: '#006400', align: 'center', listening: false }));
        s.add(new Konva.Line({ points: [5, 28, this.W - 5, 28], stroke: '#7a8494', strokeWidth: 1, listening: false }));

        // 分格线
        const cellW = (this.W - GRID_SIDE * 2) / COLS;
        const cellH = (this.H - GRID_TOP - GRID_BOT) / ROWS;
        for (let c = 1; c < COLS; c++) {
            const x = GRID_SIDE + c * cellW;
            s.add(new Konva.Line({ points: [x, GRID_TOP - 2, x, this.H - 6], stroke: '#c2ccd4', strokeWidth: 1, dash: [5, 3], listening: false }));
        }
        for (let r = 1; r < ROWS; r++) {
            const y = GRID_TOP + r * cellH;
            s.add(new Konva.Line({ points: [6, y, this.W - 6, y], stroke: '#c2ccd4', strokeWidth: 1, dash: [5, 3], listening: false }));
        }

        // 9 个塑壳断路器
        this._sw.forEach((sw, i) => this._drawMCCB(i, sw));
    }

    /** 单个塑壳断路器（画法参照 LvSwitchPanel._drawMCB，按 72 × 94 缩放） */
    _drawMCCB(i, sw) {
        const s = this._staticGroup;
        const { cx, cy } = this._cellGeom(i);
        const w = MCCB_W, h = MCCB_H;
        const x = cx - w / 2, y = cy - h / 2;
        const inY = y + 7, outY = y + h - 10, midY = (inY + outY) / 2;

        // 壳体
        s.add(new Konva.Rect({ x, y, width: w, height: h, fill: '#f0f1f4', stroke: '#a0a8b8', strokeWidth: 1.2, cornerRadius: 2, listening: false }));
        s.add(new Konva.Rect({ x: x + 2, y: y + 2, width: w - 4, height: 5, fill: 'rgba(255,255,255,0.6)', cornerRadius: [2, 2, 0, 0], listening: false }));

        // 中央滑槽
        const barH = Math.round(h * 0.34), barW = Math.round(w * 0.26);
        const onOff = { on: -h * 0.26, trip: -h * 0.01, off: h * 0.20 };
        const slotW = barW + 9;
        const slotTop = midY + onOff.on - barH / 2 - 3;
        const slotBot = midY + onOff.off + barH / 2 + 3;
        s.add(new Konva.Rect({ x: cx - slotW / 2, y: slotTop, width: slotW, height: slotBot - slotTop, fill: '#cfd3da', stroke: '#9aa2ac', strokeWidth: 0.8, cornerRadius: 2, listening: false }));
        s.add(new Konva.Rect({ x: cx - slotW / 2 + 1, y: slotTop + 1, width: slotW - 2, height: (slotBot - slotTop) * 0.45, fill: 'rgba(0,0,0,0.10)', cornerRadius: [2, 2, 0, 0], listening: false }));

        // ON / TRIP / OFF 竖排标注
        [[onOff.on, 'ON', GREEN], [onOff.trip, 'TRIP', ORANGE], [onOff.off, 'OFF', RED]].forEach(([o, t, c]) => {
            s.add(new Konva.Text({ x: x + 4, y: midY + o - 6, text: t, fontSize: 11, fontStyle: 'bold', fill: c, listening: false }));
        });

        // 上下端子螺丝
        [inY, outY].forEach(ty => [-1, 0, 1].forEach(ph => this._drawScrew(cx + ph * (w / 3), ty)));

        // 手柄（动态）
        const handle = this._createHandle(cx, midY + onOff.off, barW, barH);
        this._dynamicGroup.add(handle);
        sw.handle = handle;
        sw.midY = midY;
        sw.pos = onOff;

        // 负荷名称（单行显示，文本框加宽到整格宽度）
        const nameY = cy + h / 2 + 6;
        s.add(new Konva.Text({
            x: cx - 82, y: nameY, width: 164, text: sw.name,
            fontSize: 12, fontStyle: 'bold', fill: '#1a252f', align: 'center', wrap: 'none', listening: false,
        }));

        // 铭牌标签（按铭牌前缀配色：ESS 红、PT 黄、SQ 绿、HEF 蓝）
        const tagY = nameY + 15 + 2;
        const tagW = Math.max(46, Math.round(sw.tag.length * 7.6) + 14);
        const st = this._tagStyle(sw.tag);
        s.add(new Konva.Rect({ x: cx - tagW / 2, y: tagY, width: tagW, height: 18, fill: st.bg, stroke: st.stroke, strokeWidth: 0.7, cornerRadius: 2, listening: false }));
        s.add(new Konva.Text({ x: cx - tagW / 2, y: tagY + 2, width: tagW, text: sw.tag, fontSize: 10.5, fontStyle: 'bold', fill: st.fg, align: 'center', listening: false }));
    }

    /** 铭牌配色：ESS 红 / PT 黄 / SQ 绿 / HEF 蓝 / 其它灰 */
    _tagStyle(tag) {
        const t = String(tag || '').toUpperCase();
        if (t.startsWith('ESS')) return { bg: '#c62828', stroke: '#7a0f0f', fg: '#ffffff' };
        if (t.startsWith('PT')) return { bg: '#f2c200', stroke: '#8a6d00', fg: '#3a3000' };
        if (t.startsWith('SQ')) return { bg: '#2e7d32', stroke: '#1a4a1d', fg: '#ffffff' };
        if (t.startsWith('HEF')) return { bg: '#1565c0', stroke: '#0b3c74', fg: '#ffffff' };
        return { bg: '#7a8494', stroke: '#4a525c', fg: '#ffffff' };
    }

    _drawScrew(x, y) {
        const r = 4.6, s = this._staticGroup;
        s.add(new Konva.Circle({
            x, y, radius: r,
            fillLinearGradientStartPoint: { x: -r, y: -r },
            fillLinearGradientEndPoint: { x: r, y: r },
            fillLinearGradientColorStops: [0, '#8a7a30', 0.4, '#c8a848', 0.7, '#d8b858', 1, '#7a6a28'],
            stroke: '#5a4a18', strokeWidth: 0.5, listening: false,
        }));
        s.add(new Konva.Line({ points: [x - r * 0.55, y, x + r * 0.55, y], stroke: '#3a2a08', strokeWidth: 0.6, listening: false }));
    }

    /** 塑壳开关手柄（小长方体 3D） */
    _createHandle(cx, cy, bw, bh) {
        const g = new Konva.Group({ x: cx, y: cy });
        g.add(new Konva.Rect({ x: -bw / 2 + 3, y: -bh / 2 + 4.5, width: bw, height: bh, fill: 'rgba(0,0,0,0.16)', cornerRadius: 3, listening: false }));
        g.add(new Konva.Line({
            points: [-bw / 2, -bh / 2, bw / 2, -bh / 2, bw / 2 + 3, -bh / 2 - 4, -bw / 2 + 3, -bh / 2 - 4],
            closed: true, fill: '#14385e', listening: false,
        }));
        g.add(new Konva.Rect({
            x: -bw / 2, y: -bh / 2, width: bw, height: bh,
            fillLinearGradientStartPoint: { x: 0, y: -bh / 2 },
            fillLinearGradientEndPoint: { x: 0, y: bh / 2 },
            fillLinearGradientColorStops: [0, '#4a9ae0', 0.35, '#2878c8', 0.7, '#1a60a8', 1, '#1848a0'],
            cornerRadius: 3, stroke: '#0f3a68', strokeWidth: 1.2, listening: false,
        }));
        g.add(new Konva.Line({ points: [-bw / 2 + 3, -bh / 2 + 3, bw / 2 - 3, -bh / 2 + 3], stroke: 'rgba(255,255,255,0.45)', strokeWidth: 1.6, listening: false }));
        return g;
    }

    _bindInteraction() {
        // 整块屏的拖动/识别热区（放在最下层：标题栏与空白处也能按住拖动整块屏）
        const board = this.addClickablePart('board', 2, 2, this.W - 4, this.H - 4, false);
        board.on('click', () => this._tip('部分动力负载屏：3 × 3 塑壳断路器；按住标题栏或空白处可拖动整块屏'));

        // 汇流排指示（点击 = 发电机组重新起动建压）
        const bus = this.addClickablePart('bus-reset', 330, 2, 160, 30, true);
        bus.on('click tap', (e) => { e.cancelBubble = true; this.resetBus(); });

        // 塑壳断路器热区：只覆盖手柄与其滑槽（点击壳体其它部位不操作开关，可用于拖动整屏）
        const barW = Math.round(MCCB_W * 0.26);
        const barH = Math.round(MCCB_H * 0.34);
        const halfW = (barW + 9) / 2 + 3;                       // 滑槽半宽 + 少量余量
        const topOff = -MCCB_H * 0.26 - barH / 2 - 3;           // 手柄 ON 位顶端
        const height = MCCB_H * 0.46 + barH + 6;                 // ON → OFF 全行程 + 手柄高度
        this._sw.forEach((sw, i) => {
            const { cx } = this._cellGeom(i);
            const midY = (sw.midY !== undefined) ? sw.midY : this._cellGeom(i).cy;
            const hit = this.addClickablePart(`qf${i + 1}`, cx - halfW, midY + topOff, halfW * 2, height, true);
            hit.on('click tap', (e) => { e.cancelBubble = true; this.toggle(i); });
        });
    }

    // ═══════════════════════════════════════════════════════
    //  状态刷新
    // ═══════════════════════════════════════════════════════
    _refreshSw(i) {
        const sw = this._sw[i];
        if (!sw || !sw.handle) return;
        const p = sw.trip ? sw.pos.trip : (sw.on ? sw.pos.on : sw.pos.off);
        sw.handle.y(sw.midY + p);
        if (this.sys && this.sys.requestRedraw) this.sys.requestRedraw();
    }

    _refreshAll() { this._sw.forEach((s, i) => this._refreshSw(i)); }

    tick(dt) {
        // 静态画面无需逐帧刷新；仅在状态变化时由操作/联锁触发 requestRedraw
    }

    // ═══════════════════════════════════════════════════════
    //  操作
    // ═══════════════════════════════════════════════════════
    toggle(i) {
        const sw = this._sw[i];
        if (!sw) return;
        if (sw.trip) {
            // 脱扣位 → 第一步复位到 OFF
            sw.trip = false;
            sw.on = false;
            this._tip(`${sw.name}：手柄复位到 OFF 位，再点一次合闸`);
        } else if (!sw.on) {
            if (this._shunt[i]) {
                sw.trip = true;
                this._tip(`${sw.name}：分励脱扣器带电，合闸即跳闸`);
            } else {
                sw.on = true;
                this._tip(`${sw.name}：合闸（ON）`);
            }
        } else {
            sw.on = false;
            this._tip(`${sw.name}：分闸（OFF）`);
        }
        this._refreshSw(i);
        if (this.sys && this.sys.redrawAll) this.sys.redrawAll();
    }

    setMCB(i, on) {
        const sw = this._sw[i];
        if (!sw) return;
        sw.trip = false;
        sw.on = !!on;
        this._refreshSw(i);
    }

    /** 外部（风油切断）送分励脱扣：map = { 位置键/key 或 铭牌: true/false } */
    setShuntLive(map) {
        if (!map) return;
        let changed = false;
        this._sw.forEach((sw, i) => {
            const live = (sw.key && map[sw.key] !== undefined) ? !!map[sw.key] : !!map[sw.tag];
            if (live && !this._shunt[i]) {
                this._shunt[i] = true;
                changed = true;
                if (sw.on) {                       // 已合闸 → 立即跳闸
                    sw.on = false;
                    sw.trip = true;
                }
            } else if (!live && this._shunt[i]) {
                this._shunt[i] = false;
                changed = true;
            }
        });
        if (changed) {
            this._refreshAll();
            if (this.sys && this.sys.redrawAll) this.sys.redrawAll();
        }
    }

    // ═══════════════════════════════════════════════════════
    //  查询 API
    // ═══════════════════════════════════════════════════════
    isOn(i) { return !!(this._sw[i] && this._sw[i].on); }
    isTripped(i) { return !!(this._sw[i] && this._sw[i].trip); }
    isShuntLive(i) { return !!this._shunt[i]; }
    getSwitchByTag(tag) {
        const sw = this._sw.find(s => s.tag === tag);
        return sw ? !!sw.on : undefined;
    }
    /** 按内部位置键查询（同一铭牌有多个开关时用于精确取电） */
    getSwitchByKey(key) {
        const sw = this._sw.find(s => s.key && s.key === key);
        return sw ? !!sw.on : undefined;
    }
    getTrippedByTag(tag) {
        const sw = this._sw.find(s => s.tag === tag);
        return sw ? !!sw.trip : undefined;
    }
    getIndexByTag(tag) { return this._sw.findIndex(s => s.tag === tag); }

    /** 主汇流排是否带电 */
    getBusLive() { return !!this._busLive; }

    /** 点击汇流排指示：发电机组重新起动建压，恢复主配电板供电 */
    resetBus() {
        if (this._busLive) { this._tip('主配电板汇流排已带电'); return; }
        this.setBusLive(true);
        this._tip('发电机组重新起动建压：主配电板恢复供电');
    }

    /** 设置主汇流排带电状态（油泵全停 → 发电机停机 → 失电） */
    setBusLive(on) {
        const v = !!on;
        if (this._busLive === v) return;
        this._busLive = v;
        this._refreshBus();
        if (this.sys && this.sys.redrawAll) this.sys.redrawAll();
    }

    /** 复位：全部开关合闸、脱扣复位、汇流排恢复带电 */
    resetAll() {
        this._shunt = this._sw.map(() => false);
        this._sw.forEach(sw => { sw.trip = false; sw.on = true; });
        this._busLive = true;
        this._refreshBus();
        this._refreshAll();
        if (this.sys && this.sys.redrawAll) this.sys.redrawAll();
    }

    getConfigFields() {
        return [{ key: 'note', label: '负荷铭牌', type: 'text', get: () => '在 project 文件的 SWITCHES 中配置' }];
    }
}
