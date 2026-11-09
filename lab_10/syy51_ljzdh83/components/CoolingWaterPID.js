import Konva from 'konva';
import { BaseComponent } from './BaseComponent.js';

const BODY = '#2b2f33';
const BODY_EDGE = '#141719';
const LCD_BG = '#06120c';
const LCD_EDGE = '#0d3a24';
const C_PV = '#ff6a3d';
const C_SV = '#6ee7ff';
const C_OUT = '#ffd24d';
const C_TXT = '#dfe6ea';
const C_DIM = '#8b979e';
const GREEN = '#27e05a';
const AMBER = '#ffb327';
const RED = '#ff3b30';

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/**
 * CoolingWaterPID — 主机缸套冷却水温度 PID 调节器（面板型）
 * ═══════════════════════════════════════════════════════════════════════════
 *  参照 components/PID.js 的面板风格编写，但**只有面板、不设电气接线端口**：
 *
 *   · 测量值 PV  —— 直接读取 MIMIC 面板上 TC 温度变送器的数据（sys.coolingSolver.m.tcMeas）；
 *   · 设定值 SV  —— 温度设定值 m.setTemp（SET + ▲/▼ 修改）；
 *   · 输出 OUT   —— 直接驱动 MIMIC 面板中三通调节阀的开度 m.manip（0~100 %，
 *                   0 % 全经高温淡水冷却器 / 100 % 全旁通）；
 *   · 默认已通电（powered = true），不需要任何电源开关或 4-20 mA 接线；
 *   · AUTO：由 LDCL 的 PI 按设定值自动调节，OUT 跟随 m.manip；
 *     MANU：用 ▲/▼ 手动给定开度，直接写入三通阀。
 *
 *  可点击部件（工作流 subTarget / op.part）：
 *     display（屏幕）、pv / sv / out（三个读数区）
 *     am（A/M 切换，左半 mode-knob-ccw = Manual，右半 mode-knob = Automatic）
 *     set（设定键）、up / down（▲ / ▼）
 *     set-plus / set-minus（设定值增减，等效 ▲/▼ 在 SET 状态）、
 *     key-plus / key-minus（输出增减，等效 ▲/▼ 在 MANU 状态）
 *     ctrl-auto / ctrl-manu（Ctrl 行 自动 / 手动）
 *     temp-auto / temp-manu（TEMP 行 自动 / 手动）
 *     ldcl-state（状态行）、alarm-reset（报警复位）
 * ═══════════════════════════════════════════════════════════════════════════
 */
export class CoolingWaterPID extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.W = Math.max(300, config.width || 330);
        this.H = Math.max(280, config.height || 330);
        this.type = 'cooling_water_pid';
        this.special = 'cooling_pid';
        this.cache = 'fixed';

        this.powered = true;      // 默认已通电
        this.editSV = false;      // SET 编辑设定值状态
        this._blink = 0;

        this._initGroups();
        this._recalcGeometry();
        this._init();
        this._sync();

        this.config = { id: this.id, width: this.W, height: this.H };
    }

    _solver() {
        return this.sys && this.sys.coolingSolver ? this.sys.coolingSolver : null;
    }

    _tip(msg) {
        if (this.sys && typeof this.sys._tipPurifier === 'function') this.sys._tipPurifier(msg);
    }

    // ═══════════════════════════════════════════════════════════
    //  几何
    // ═══════════════════════════════════════════════════════════
    _recalcGeometry() {
        const W = this.W, H = this.H;
        this._geo = {
            body: { x: 0, y: 0, w: W, h: H },
            screen: { x: 12, y: 36, w: W - 24, h: 158 },
            // 按键排
            am: { x: 14, y: 206, w: 86, h: 36 },
            set: { x: 108, y: 206, w: 46, h: 36 },
            up: { x: 160, y: 206, w: 42, h: 36 },
            down: { x: 208, y: 206, w: 42, h: 36 },
            reset: { x: 256, y: 206, w: 62, h: 36 },
            // 屏幕分区
            pv: { x: 20, y: 44, w: 150, h: 62 },
            sv: { x: 20, y: 96, w: 150, h: 28 },
            out: { x: 20, y: 124, w: 150, h: 26 },
            bar: { x: 150, y: 130, w: 160, h: 12 },
        };
    }

    // ═══════════════════════════════════════════════════════════
    //  绘制
    // ═══════════════════════════════════════════════════════════
    _label(g, x, y, text, size = 11, fill = C_TXT, bold = false, align = 'left', width = 0, family = 'Arial, "Microsoft YaHei", sans-serif') {
        const o = { x, y, text, fontSize: size, fontStyle: bold ? 'bold' : 'normal', fill, align, fontFamily: family };
        if (width) o.width = width;
        g.add(new Konva.Text(o));
    }

    _init() {
        this._drawStaticParts();
        this._createDynamicNodes();
        this._bindInteraction();
    }

    _drawStaticParts() {
        const g = this._staticGroup, G = this._geo, W = this.W, H = this.H;

        // 机箱
        g.add(new Konva.Rect({
            x: 0, y: 0, width: W, height: H, cornerRadius: 10,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint: { x: 0, y: H },
            fillLinearGradientColorStops: [0, '#3a4046', 0.45, BODY, 1, '#22262a'],
            stroke: BODY_EDGE, strokeWidth: 2,
        }));
        g.add(new Konva.Rect({ x: 6, y: 6, width: W - 12, height: H - 12, cornerRadius: 7, stroke: '#4b5257', strokeWidth: 1 }));
        this._label(g, 14, 10, '冷却水温度 PID 调节器', 12, C_TXT, true);
        this._label(g, 14, 24, 'MAIN ENGINE JACKET COOLING WATER', 7.5, '#7d8a92', false, 'left', 240);

        // 液晶屏
        g.add(new Konva.Rect({ x: G.screen.x, y: G.screen.y, width: G.screen.w, height: G.screen.h, cornerRadius: 4, fill: LCD_BG, stroke: LCD_EDGE, strokeWidth: 1.5 }));

        // 屏内固定标签
        this._label(g, 22, 44, 'PV', 10, C_PV, true);
        this._label(g, 106, 66, '℃', 14, C_PV, true);
        this._label(g, 22, 100, 'SV', 10, C_SV, true);
        this._label(g, 110, 102, '℃', 11, C_SV, true);
        this._label(g, 22, 126, 'OUT', 10, C_OUT, true);
        this._label(g, 116, 126, '%', 11, C_OUT, true);

        // 输出条形框
        g.add(new Konva.Rect({ x: G.bar.x, y: G.bar.y, width: G.bar.w, height: G.bar.h, cornerRadius: 2, fill: '#0d1a12', stroke: '#1f5c3a', strokeWidth: 1 }));

        // 按键底板
        const keyBg = (r, fill, txt, size = 12, txtColor = '#ffffff') => {
            g.add(new Konva.Rect({ x: r.x, y: r.y, width: r.w, height: r.h, cornerRadius: 4, fill, stroke: '#101315', strokeWidth: 1.5 }));
            this._label(g, r.x, r.y + r.h / 2 - size * 0.65, txt, size, txtColor, true, 'center', r.w);
        };
        // A / M 两位切换开关
        g.add(new Konva.Rect({ x: G.am.x, y: G.am.y, width: G.am.w, height: G.am.h, cornerRadius: 4, fill: '#1b1f22', stroke: '#101315', strokeWidth: 1.5 }));

        keyBg(G.set, '#3a4a55', 'SET', 11);
        keyBg(G.up, '#3a4a55', '▲', 14);
        keyBg(G.down, '#3a4a55', '▼', 14);
        keyBg(G.reset, '#5a2b2b', 'RESET', 10);

        // 指示灯文字
        this._label(g, 22, 256, 'AUTO', 9, C_DIM, true);
        this._label(g, 78, 256, 'MAN', 9, C_DIM, true);
        this._label(g, 132, 256, 'ALARM', 9, C_DIM, true);

        // 底部说明
        g.add(new Konva.Rect({ x: 12, y: 276, width: W - 24, height: 1, fill: '#3f474c' }));
        this._label(g, 14, 282, 'PV 取自 MIMIC 的 TC 温度变送器；OUT 直接驱动三通调节阀开度', 8, '#7d8a92', false, 'left', W - 28);
        this._label(g, 14, 294, '0 % = 全经高温淡水冷却器（最冷）　100 % = 全旁通（最热）', 8, '#7d8a92', false, 'left', W - 28);
        this._label(g, 14, 306, '默认已通电 · 无需外部接线', 8, '#5f6b72', false, 'left', W - 28);
    }

    _createDynamicNodes() {
        const d = this._dynamicGroup, G = this._geo;

        // PV / SV / OUT 数值
        this._pvTxt = new Konva.Text({
            x: 20, y: 54, text: '--.-', fontSize: 34, fontStyle: 'bold', fill: C_PV,
            fontFamily: 'Consolas, "Courier New", monospace',
        });
        this._svTxt = new Konva.Text({
            x: 60, y: 96, text: '--.-', fontSize: 20, fontStyle: 'bold', fill: C_SV,
            fontFamily: 'Consolas, "Courier New", monospace',
        });
        this._outTxt = new Konva.Text({
            x: 60, y: 122, text: '--.-', fontSize: 18, fontStyle: 'bold', fill: C_OUT,
            fontFamily: 'Consolas, "Courier New", monospace',
        });
        // 输出条
        this._bar = new Konva.Rect({ x: G.bar.x + 1, y: G.bar.y + 1, width: 0, height: G.bar.h - 2, cornerRadius: 1, fill: C_OUT });

        // 状态行（AUTO / MANU · 设定值）
        this._stateTxt = new Konva.Text({
            x: 20, y: 158, width: G.screen.w - 16, text: '', fontSize: 10, fill: '#9fe8bb',
            fontFamily: 'Arial, "Microsoft YaHei", sans-serif',
        });

        // 指示灯
        const lamp = (x, color) => new Konva.Circle({ x, y: 250, radius: 6, fill: '#1c2226', stroke: '#0b0d0e', strokeWidth: 1.5 });
        this._lamps = { auto: lamp(14, GREEN), man: lamp(70, AMBER), alarm: lamp(124, RED) };

        // A/M 开关指示块
        this._amHi = new Konva.Rect({ x: G.am.x + 2, y: G.am.y + 2, width: G.am.w / 2 - 4, height: G.am.h - 4, cornerRadius: 3, fill: GREEN });

        // A / M 文字（放在高亮块之上）
        this._amTxtM = new Konva.Text({ x: G.am.x, y: G.am.y + 11, width: G.am.w / 2, align: 'center', text: 'M', fontSize: 13, fontStyle: 'bold', fill: '#ffffff', fontFamily: 'Arial' });
        this._amTxtA = new Konva.Text({ x: G.am.x + G.am.w / 2, y: G.am.y + 11, width: G.am.w / 2, align: 'center', text: 'A', fontSize: 13, fontStyle: 'bold', fill: '#ffffff', fontFamily: 'Arial' });
        d.add(this._pvTxt, this._svTxt, this._outTxt, this._bar, this._stateTxt,
            this._amHi, this._lamps.auto, this._lamps.man, this._lamps.alarm, this._amTxtM, this._amTxtA);
    }

    // ═══════════════════════════════════════════════════════════
    //  交互
    // ═══════════════════════════════════════════════════════════
    _bindInteraction() {
        const G = this._geo, s = this;
        const clearBg = (hit) => {
            try {
                const bg = hit.getParent().getChildren()[0];
                if (bg && bg.fill) bg.fill('rgba(0,0,0,0)');
            } catch (e) { /* ignore */ }
        };
        const add = (id, x, y, w, h, fn) => {
            const hit = this.addClickablePart(id, x, y, w, h, true);
            hit.on('click tap', () => { if (fn) fn(); s._sync(); });
            clearBg(hit);
            return hit;
        };

        add('display', G.screen.x, G.screen.y, G.screen.w, G.screen.h, () => s._tipAll());
        add('temp-auto', G.pv.x, G.pv.y, G.pv.w, G.pv.h, () => s._setSV(true));
        add('temp-manu', G.sv.x, G.sv.y, G.sv.w, G.sv.h, () => s._setSV(false));
        add('out', G.out.x, G.out.y, G.out.w, G.out.h, () => s._tipAll());

        // A/M 两位开关（左 M / 右 A）
        add('mode-knob-ccw', G.am.x, G.am.y, G.am.w / 2, G.am.h, () => s._setMode('MANU'));
        add('mode-knob', G.am.x + G.am.w / 2, G.am.y, G.am.w / 2, G.am.h, () => s._setMode('AUTO'));
        add('am', G.am.x, G.am.y, G.am.w, G.am.h, () => s._tipAll());

        // SET
        add('set', G.set.x, G.set.y, G.set.w, G.set.h, () => s._toggleEdit());

        // 设定值增减（别名，供工作流 set-plus / set-minus）
        add('set-plus', G.up.x, G.up.y, G.up.w, G.up.h, () => s._stepSV(+1));
        add('set-minus', G.down.x, G.down.y, G.down.w, G.down.h, () => s._stepSV(-1));
        // 输出增减（别名，key-plus / key-minus）
        add('key-plus', G.up.x, G.up.y, G.up.w, G.up.h, () => s._stepOut(+1));
        add('key-minus', G.down.x, G.down.y, G.down.w, G.down.h, () => s._stepOut(-1));
        // 实体 ▲ / ▼（最后登记 → 鼠标点击优先落在实体键上）
        add('up', G.up.x, G.up.y, G.up.w, G.up.h, () => s._key(+1));
        add('down', G.down.x, G.down.y, G.down.w, G.down.h, () => s._key(-1));

        // Ctrl 行 自动 / 手动（输出条左右半区）
        add('ctrl-manu', G.bar.x, G.bar.y - 6, G.bar.w / 2, G.bar.h + 12, () => s._setCtrl(false));
        add('ctrl-auto', G.bar.x + G.bar.w / 2, G.bar.y - 6, G.bar.w / 2, G.bar.h + 12, () => s._setCtrl(true));

        add('ldcl-state', 20, 156, 190, 16, () => s._tipAll());
        add('alarm-reset', G.reset.x, G.reset.y, G.reset.w, G.reset.h, () => { const sv = s._solver(); if (sv) sv.pressAlarmReset(); });
    }

    // ── 操作 ──
    _setMode(mode) {
        const sv = this._solver();
        if (!sv) return;
        sv.setMode(mode);
    }

    _setCtrl(auto) {
        const sv = this._solver();
        if (!sv) return;
        if (auto) sv.autoTakeover(); else sv.manualTakeover();
    }

    _toggleEdit() {
        this.editSV = !this.editSV;
        this._tip(this.editSV ? 'SET：▲/▼ 修改温度设定值 SV' : 'SET：退出设定值修改');
    }

    _setSV(which) {
        const sv = this._solver();
        if (!sv) return;
        if (which) sv.setMode('AUTO'); else sv.setMode('MANU');
    }

    _stepSV(dir) {
        const sv = this._solver();
        if (!sv) return;
        sv.setSetpoint(clamp(sv.m.setTemp + dir * 0.1, 60, 95));
        this.editSV = true;
    }

    _stepOut(dir) {
        const sv = this._solver();
        if (!sv) return;
        if (sv.autoActive()) sv.manualTakeover();
        sv.stepManip(dir);
    }

    _key(dir) {
        if (this.editSV) this._stepSV(dir);
        else {
            const sv = this._solver();
            if (sv && !sv.autoActive()) this._stepOut(dir);
            else this._stepSV(dir);
        }
    }

    _tipAll() {
        const sv = this._solver();
        if (!sv) { this._tip('PID 调节器：未接入冷却水系统'); return; }
        const m = sv.m;
        const st = sv.autoActive() ? 'AUTO（按设定值自动调节）' : 'MANU（手动给定开度）';
        this._tip(`冷却水温度 PID：PV ${m.faults.tt ? '***' : m.tcMeas.toFixed(2)} ℃ / SV ${m.setTemp.toFixed(1)} ℃ / OUT ${m.manip.toFixed(1)} % · ${st}`);
    }

    // ═══════════════════════════════════════════════════════════
    //  显示同步
    // ═══════════════════════════════════════════════════════════
    _sync() {
        const sv = this._solver();
        const m = sv ? sv.m : null;
        const G = this._geo;

        const pv = m ? (m.faults.tt ? NaN : m.tcMeas) : NaN;
        const svv = m ? m.setTemp : NaN;
        const out = m ? m.manip : 0;

        this._pvTxt.text(Number.isFinite(pv) ? pv.toFixed(1) : '***');
        this._svTxt.text(Number.isFinite(svv) ? svv.toFixed(1) : '--.-');
        this._outTxt.text(Number.isFinite(out) ? out.toFixed(1) : '--.-');

        // SET 编辑时 SV 闪烁
        this._blink = (this._blink + 1) % 10;
        this._svTxt.visible(!this.editSV || this._blink < 6);

        this._bar.width(Math.max(0, (G.bar.w - 2) * clamp(out, 0, 100) / 100));
        this._bar.fill(out > 70 ? '#ff8a3d' : (out < 30 ? '#63c8ff' : C_OUT));

        const auto = !!(m && sv.autoActive());
        this._stateTxt.text(m
            ? `${auto ? 'AUTOMATIC' : 'MANUAL'}　SV ${m.setTemp.toFixed(1)} ℃　${this.editSV ? '（SET 修改中）' : ''}`
            : '未接入');
        this._lamps.auto.fill(auto ? GREEN : '#1c2226');
        this._lamps.man.fill(m && !auto ? AMBER : '#1c2226');
        this._lamps.alarm.fill(m && m.alarms.some(a => a.active) ? RED : '#1c2226');

        // A/M 开关高亮块
        const onAuto = m ? m.mode === 'AUTO' : true;
        this._amHi.x(onAuto ? G.am.x + G.am.w / 2 + 1 : G.am.x + 2);
        this._amHi.fill(onAuto ? GREEN : AMBER);

        if (this.sys && this.sys.requestRedraw) this.sys.requestRedraw();
    }

    tick() {
        this._sync();
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

export default CoolingWaterPID;
