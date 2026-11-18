import Konva from 'konva';
import { BaseComponent } from './BaseComponent.js';

/**
 * OilPumpUnitPanel — 油泵及其控制面板
 * ═══════════════════════════════════════════════════════════════
 *  版式（293 × 307，与风机控制屏一致）：
 *    左（8 ~ 180，172 × 291）：控制面板 —— RUNNING / POWER 指示窗、START / STOP 按钮、
 *                    MAN / AUT 两档控制方式旋钮。
 *    右（182 ~ 282）：油泵符号 —— 圆形泵体 + 两个内圆（转子）+ 右侧斜线阴影，
 *                    运行时转子旋转。
 *
 *  供电：来自动力负载屏的塑壳断路器（config.tag 指定铭牌，默认 ESS-1P）。
 *        风油切断动作使断路器跳闸 → POWER 灯灭、油泵立即停转。
 *
 *  可点击部件（工作流 subTarget / op.part）：
 *    panel、run-lamp、power-lamp、btn-start、btn-stop、mode-knob、pump
 * ═══════════════════════════════════════════════════════════════
 */

const W0 = 293, H0 = 277;
const PANEL = { x: 8, y: 8, w: 172, h: 261 };
const RUN_BOX = { x: 16, y: 17, w: 76, h: 21 };
const POW_BOX = { x: 98, y: 17, w: 76, h: 21 };
const BTN_START = { cx: 52, cy: 88, r: 27 };
const BTN_STOP = { cx: 124, cy: 88, r: 27 };
const KNOB = { cx: 94, cy: 200, R: 27 };
const PUMP = { cx: 232, cy: 140, R: 50 };

const LIT = '#2eff3e';
const DARK = '#125018';
const STEEL = '#9aa0a6';
const PUMP_BODY = '#ffe066';   // 泵体黄色
const GEAR_FILL = '#66bb6a';   // 齿轮绿色
const GEAR_LINE = '#2e7d32';   // 齿轮轮廓
const GEAR_HOLE = '#c8e6c9';   // 齿轮轴孔

export class OilPumpUnitPanel extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.W = W0;
        this.H = H0;
        this.width = W0;
        this.height = H0;

        this.type = 'oilpump_unit';
        this.special = 'oilpumpunit';
        this.cache = 'fixed';

        this.label = config.label || '1# 机舱油泵';
        this.tag = config.tag || 'ESS-1P';
        this.loadId = config.loadId || 'load';
        this.switchKey = config.switchKey || '';   // 负载屏内部位置键（同一铭牌多路时精确定位）

        this.mode = config.mode || 'MAN';
        this.running = false;
        this.speed = 0;
        this.angle = 0;

        this._initGroups();
        this._init();
        this._syncVis();

        this.config = { id: this.id, label: this.label, tag: this.tag, switchKey: this.switchKey, loadId: this.loadId, mode: this.mode };
    }

    _tip(msg) {
        if (this.sys && typeof this.sys.showFloatingTip === 'function') this.sys.showFloatingTip(msg, 2600);
    }

    _init() {
        this._drawStatic();
        this._createDynamic();
        this._bindInteraction();
    }

    _drawStatic() {
        const s = this._staticGroup;

        s.add(new Konva.Rect({ x: 3, y: 3, width: this.W - 6, height: this.H - 6, fill: '#eff2f4', stroke: '#5a6a75', strokeWidth: 1.2, cornerRadius: 3, listening: false }));
        s.add(new Konva.Rect({ x: PANEL.x, y: PANEL.y, width: PANEL.w, height: PANEL.h, fill: '#fbfcfd', stroke: '#b8c0c6', strokeWidth: 1, cornerRadius: 2, listening: false }));

        [RUN_BOX, POW_BOX].forEach(b => {
            s.add(new Konva.Rect({ x: b.x - 1.5, y: b.y - 1.5, width: b.w + 3, height: b.h + 3, fill: '#dfe4e8', stroke: '#6a747c', strokeWidth: 0.8, cornerRadius: 2, listening: false }));
        });

        [BTN_START, BTN_STOP].forEach(b => {
            s.add(new Konva.Circle({ x: b.cx, y: b.cy, radius: b.r, fill: '#d8dee2', stroke: '#8a929c', strokeWidth: 1.6, listening: false }));
            s.add(new Konva.Circle({ x: b.cx, y: b.cy, radius: b.r - 3, fill: '#c3cbd1', stroke: '#9aa4ad', strokeWidth: 0.8, listening: false }));
        });
        s.add(new Konva.Text({ x: BTN_START.cx - 24, y: BTN_START.cy + 31, width: 48, text: 'START', fontSize: 9, fontStyle: 'bold', fill: '#1a252f', align: 'center', listening: false }));
        s.add(new Konva.Text({ x: BTN_STOP.cx - 24, y: BTN_STOP.cy + 31, width: 48, text: 'STOP', fontSize: 9, fontStyle: 'bold', fill: '#1a252f', align: 'center', listening: false }));

        s.add(new Konva.Circle({ x: KNOB.cx, y: KNOB.cy, radius: KNOB.R + 4, fill: '#e6eaee', stroke: '#b8c0c6', strokeWidth: 0.8, listening: false }));
        s.add(new Konva.Text({ x: KNOB.cx - 48, y: KNOB.cy - 46, width: 44, text: 'MAN', fontSize: 8.5, fontStyle: 'bold', fill: '#1a252f', align: 'center', listening: false }));
        s.add(new Konva.Text({ x: KNOB.cx + 4, y: KNOB.cy - 46, width: 44, text: 'AUT', fontSize: 8.5, fontStyle: 'bold', fill: '#1a252f', align: 'center', listening: false }));
        s.add(new Konva.Text({ x: KNOB.cx - 37, y: KNOB.cy + 32, width: 74, text: '控制方式', fontSize: 8, fill: '#5a6a75', align: 'center', listening: false }));

        // 油泵泵体（黄色填充，灰色轮廓）
        s.add(new Konva.Circle({ x: PUMP.cx, y: PUMP.cy, radius: PUMP.R, fill: PUMP_BODY, stroke: STEEL, strokeWidth: 2.2, listening: false }));

        s.add(new Konva.Text({ x: 176, y: 200, width: 112, text: this.label, fontSize: 10, fontStyle: 'bold', fill: '#1a252f', align: 'center', listening: false }));
        s.add(new Konva.Text({ x: 176, y: 216, width: 112, text: this.tag, fontSize: 8.5, fill: '#5a6a75', align: 'center', listening: false }));
    }

    _createDynamic() {
        const d = this._dynamicGroup;

        this._runBox = new Konva.Rect({ x: RUN_BOX.x, y: RUN_BOX.y, width: RUN_BOX.w, height: RUN_BOX.h, fill: DARK, stroke: '#0a3410', strokeWidth: 0.8, cornerRadius: 1.5, listening: false });
        this._runTxt = new Konva.Text({ x: RUN_BOX.x, y: RUN_BOX.y + 5, width: RUN_BOX.w, text: 'RUNNING', fontSize: 9, fontStyle: 'bold', fill: '#ffffff', align: 'center', listening: false });
        this._powBox = new Konva.Rect({ x: POW_BOX.x, y: POW_BOX.y, width: POW_BOX.w, height: POW_BOX.h, fill: '#ffffff', stroke: '#1a1a1a', strokeWidth: 0.8, cornerRadius: 1.5, listening: false });
        this._powTxt = new Konva.Text({ x: POW_BOX.x, y: POW_BOX.y + 5, width: POW_BOX.w, text: 'POWER', fontSize: 9, fontStyle: 'bold', fill: '#1a1a1a', align: 'center', listening: false });
        d.add(this._runBox, this._runTxt, this._powBox, this._powTxt);

        this._startCap = new Konva.Circle({ x: BTN_START.cx, y: BTN_START.cy, radius: BTN_START.r - 7, fill: '#1f9e1f', stroke: '#0d5c0d', strokeWidth: 1.6, listening: false });
        this._stopCap = new Konva.Circle({ x: BTN_STOP.cx, y: BTN_STOP.cy, radius: BTN_STOP.r - 7, fill: '#c02020', stroke: '#6a0d0d', strokeWidth: 1.6, listening: false });
        d.add(this._startCap, this._stopCap);

        // 控制方式旋钮
        this._knob = new Konva.Group({ x: KNOB.cx, y: KNOB.cy, rotation: this.mode === 'AUT' ? 45 : -45 });
        this._knob.add(new Konva.Circle({ radius: KNOB.R, fill: '#ffffff', stroke: '#9aa0a0', strokeWidth: 1, listening: false }));
        this._knob.add(new Konva.Circle({ radius: KNOB.R - 5, fill: '#141414', stroke: '#000000', strokeWidth: 0.8, listening: false }));
        this._knob.add(new Konva.Rect({
            x: -3, y: -(KNOB.R - 5), width: 6, height: (KNOB.R - 5) * 2,
            cornerRadius: 2.5, fill: 'rgba(0,0,0,0)', stroke: '#ffffff', strokeWidth: 1.5, listening: false,
        }));
        this._knob.add(new Konva.Rect({ x: -2, y: -(KNOB.R - 10), width: 4, height: 8, cornerRadius: 1, fill: '#ffffff', listening: false }));
        d.add(this._knob);

        // 油泵转子：两个啮合齿轮（位于圆心与边缘之间，运行时反向同步转动）
        const teeth = 10;                  // 齿数
        const gr = PUMP.R * 0.44;          // 齿轮分度圆半径（不含齿）
        const toothH = PUMP.R * 0.10;      // 齿高
        const off = PUMP.R * 0.5;          // 齿轮中心距圆心的距离（上下各一个）
        this._gearPhase = 180 / teeth;     // 两齿轮错开半个齿距，视觉上互相咬合
        this._gearA = this._makeGear(PUMP.cx, PUMP.cy - off, gr, teeth, toothH);
        this._gearB = this._makeGear(PUMP.cx, PUMP.cy + off, gr, teeth, toothH);
        this._gearB.rotation(this._gearPhase);
        d.add(this._gearA, this._gearB);
    }

    /** 齿轮（带齿外轮廓 + 中心轴孔），rotation 绕自身中心 */
    _makeGear(x, y, radius, teeth = 12, toothH = 3.5) {
        const g = new Konva.Group({ x, y });
        // 齿形轮廓用 Path data 生成（避免自定义 sceneFunc 的兼容问题）
        const step = Math.PI * 2 / (teeth * 2);
        let d = '';
        for (let i = 0; i < teeth * 2; i++) {
            const ang = i * step;
            const rr = (i % 2 === 0) ? radius + toothH : radius;
            d += (i === 0 ? 'M' : 'L') + (Math.cos(ang) * rr).toFixed(2) + ' ' + (Math.sin(ang) * rr).toFixed(2) + ' ';
        }
        g.add(new Konva.Path({ x: 0, y: 0, data: d + 'Z', fill: GEAR_FILL, stroke: GEAR_LINE, strokeWidth: 1.8, listening: false }));
        g.add(new Konva.Circle({ radius: radius * 0.30, fill: GEAR_HOLE, stroke: GEAR_LINE, strokeWidth: 1.2, listening: false }));
        return g;
    }

    _bindInteraction() {
        const panel = this.addClickablePart('panel', PANEL.x, PANEL.y, PANEL.w, PANEL.h, false);
        panel.on('click', () => this._tip('油泵控制面板：RUNNING / POWER 指示窗、START / STOP 按钮、MAN / AUT 控制方式旋钮'));

        const run = this.addClickablePart('run-lamp', RUN_BOX.x, RUN_BOX.y, RUN_BOX.w, RUN_BOX.h, true);
        run.on('click', () => this._tip(this.running ? 'RUNNING 灯亮：油泵正在运行' : 'RUNNING 灯灭：油泵停止'));

        const pow = this.addClickablePart('power-lamp', POW_BOX.x, POW_BOX.y, POW_BOX.w, POW_BOX.h, true);
        pow.on('click', () => this._tip(this._supply() ? 'POWER 灯亮：塑壳断路器合闸，控制回路已送电' : 'POWER 灯灭：塑壳断路器跳闸/分闸，油泵失电'));

        const st = this.addClickablePart('btn-start', BTN_START.cx - BTN_START.r, BTN_START.cy - BTN_START.r, BTN_START.r * 2, BTN_START.r * 2, true);
        st.on('click tap', (e) => { e.cancelBubble = true; this.start(); });

        const sp = this.addClickablePart('btn-stop', BTN_STOP.cx - BTN_STOP.r, BTN_STOP.cy - BTN_STOP.r, BTN_STOP.r * 2, BTN_STOP.r * 2, true);
        sp.on('click tap', (e) => { e.cancelBubble = true; this.stop(); });

        const kn = this.addClickablePart('mode-knob', KNOB.cx - KNOB.R, KNOB.cy - KNOB.R, KNOB.R * 2, KNOB.R * 2, true);
        kn.on('click tap', (e) => { e.cancelBubble = true; this.toggleMode(); });

        const pump = this.addClickablePart('pump', PUMP.cx - PUMP.R, PUMP.cy - PUMP.R, PUMP.R * 2, PUMP.R * 2, true);
        pump.on('click', () => this._tip(this.running ? '油泵运行中：转子旋转，向主机输送燃油' : '油泵已停转'));
    }

    // ═══════════════════════════════════════════════════════
    //  运行逻辑
    // ═══════════════════════════════════════════════════════
    /** 供电状态：ok 有电 / bus 配电板失电 / mccb 塑壳断路器未合闸 */
    _supplyInfo() {
        const load = this.sys && this.sys.comps ? this.sys.comps[this.loadId] : null;
        if (!load) return { on: true, why: 'ok' };
        if (typeof load.getBusLive === 'function' && !load.getBusLive()) return { on: false, why: 'bus' };
        if (this.switchKey && typeof load.getSwitchByKey === 'function') {
            const vk = load.getSwitchByKey(this.switchKey);
            if (vk !== undefined) return { on: !!vk, why: vk ? 'ok' : 'mccb' };
        }
        if (typeof load.getSwitchByTag === 'function') {
            const v = load.getSwitchByTag(this.tag);
            if (v !== undefined) return { on: !!v, why: v ? 'ok' : 'mccb' };
        }
        return { on: true, why: 'ok' };
    }

    _supply() { return this._supplyInfo().on; }

    start() {
        const info = this._supplyInfo();
        if (!info.on) {
            this._tip(info.why === 'bus'
                ? '油泵失电：燃油泵全停致发电机停机、主配电板失电，需恢复供电后才能起动'
                : '油泵失电：请先合上动力负载屏对应塑壳断路器');
            return;
        }
        if (this.mode === 'AUT') { this._tip('控制方式在 AUT：起动由供电自动决定'); return; }
        this.running = true;
        this._tip('按下 START：油泵起动运行');
    }

    stop() {
        if (this.mode === 'AUT') { this._tip('控制方式在 AUT：请先切到 MAN 再手动停机'); return; }
        this.running = false;
        this._tip('按下 STOP：油泵停止');
    }

    toggleMode() {
        this.mode = this.mode === 'MAN' ? 'AUT' : 'MAN';
        this._knob.rotation(this.mode === 'AUT' ? 45 : -45);
        this._tip(`控制方式：${this.mode === 'MAN' ? 'MAN 手动起停' : 'AUT 供电自动运行'}`);
    }

    setMode(m) {
        this.mode = (m === 'AUT') ? 'AUT' : 'MAN';
        this._knob.rotation(this.mode === 'AUT' ? 45 : -45);
    }

    getRunning() { return !!this.running; }
    getMode() { return this.mode; }
    hasPower() { return this._supply(); }

    _syncVis() {
        const supply = this._supply();
        const run = this.running && supply;
        this._runBox.fill(run ? LIT : DARK);
        this._runTxt.fill(run ? '#08300a' : '#ffffff');
        this._powBox.fill(supply ? LIT : '#ffffff');
        this._powTxt.fill(supply ? '#08300a' : '#1a1a1a');
    }

    tick(dt) {
        const supply = this._supply();

        if (this.mode === 'AUT') this.running = supply;
        if (!supply) this.running = false;

        const target = (this.running && supply) ? 1 : 0;
        this.speed += (target - this.speed) * Math.min(1, dt * 3);
        if (this.speed < 0.01) this.speed = 0;

        this.angle = (this.angle + this.speed * 200 * dt) % 360;
        if (this._gearA) this._gearA.rotation(this.angle);
        if (this._gearB) this._gearB.rotation(this._gearPhase - this.angle);   // 反向同步转动

        this._syncVis();
        this.markDirty();
        this._refreshIfDirty();
    }

    getConfigFields() {
        return [
            { key: 'label', label: '油泵名称' },
            { key: 'tag', label: '对应塑壳断路器铭牌' },
        ];
    }

    onConfigUpdate(cfg) {
        if (!cfg) return;
        if (cfg.label) this.label = cfg.label;
        if (cfg.tag) this.tag = cfg.tag;
        this.config = { ...(this.config || {}), ...(cfg || {}) };
    }
}
