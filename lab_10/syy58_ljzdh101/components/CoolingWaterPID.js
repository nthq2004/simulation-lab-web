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

const KEY_BG = '#3a4a55';
const VAL_SIZE = 34;          // PV / SV / OUT 统一字号

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/** 三级菜单：参数组定义 */
const MENU_GROUPS = [
    { name: 'P-I-D', params: ['P', 'I', 'DB'] },
    { name: 'ALARM', params: ['L', 'H', 'HH'] },
    { name: 'RANGE', params: ['SV'] },
    { name: 'SYS', params: ['MODE'] },
];

/** 参数元数据 */
const PARAM_META = {
    P: { label: 'P', unit: '', step: 0.5, min: 1, max: 30, cn: '比例带' },
    I: { label: 'I', unit: ' s', step: 5, min: 5, max: 300, cn: '积分时间' },
    DB: { label: 'DB', unit: ' ℃', step: 0.1, min: 0, max: 5, cn: '死区' },
    L: { label: 'L', unit: ' ℃', step: 1, min: 0, max: 120, cn: '温度低报警限' },
    H: { label: 'H', unit: ' ℃', step: 1, min: 0, max: 130, cn: '温度高报警限' },
    HH: { label: 'HH', unit: ' ℃', step: 1, min: 0, max: 130, cn: '温度高高报警限' },
    SV: { label: 'SV', unit: ' ℃', step: 0.5, min: 60, max: 95, cn: '温度设定值' },
    MODE: { label: 'MODE', unit: '', enum: ['AUTO', 'MANU'], cn: '控制方式' },
};

/**
 * CoolingWaterPID — 主机缸套冷却水温度 PID 调节器（面板型）
 * ═══════════════════════════════════════════════════════════════════════════
 *  参照 components/PID.js 的面板风格编写，但**只有面板、不设电气接线端口**：
 *
 *   · 测量值 PV  —— 直接读取 MIMIC 面板上 TT 温度变送器的数据（sys.coolingSolver.m.tcMeas）；
 *   · 设定值 SV  —— 温度设定值 m.setTemp（▲/▼ 修改）；
 *   · 输出 OUT   —— 直接驱动 MIMIC 面板中三通调节阀的冷却口开度 m.manip（2~98 %）；
 *   · 默认已通电（powered = true），不需要任何电源开关或 4-20 mA 接线；
 *   · AUTO：由 LDCL 的 PI 按设定值自动调节，OUT 跟随 m.manip；
 *     MANU：用 ▲/▼ 手动给定开度，直接写入三通阀。
 *
 *  按键（共 5 个）：A/M、SET、▲、▼、RESET
 *   · A/M 为普通按键（整键单击切换 AUTO ⇄ MANU），状态由 AUTO / MAN 指示灯 + 键底色指示；
 *   · 三级菜单（与 PID.js 一致）：
 *       L0 主界面：▲/▼ 改 SV（AUTO）或 OUT（MANU）
 *       长按 SET → L1 参数组（▲/▼ 选组，短按 SET 进入，长按 SET 返回）
 *       L2 参数（▲/▼ 改值，短按 SET 保存/下一项，长按 SET 返回 L0）
 *   · 20 s 无操作自动返回主界面；修改后 5 s 未确认自动放弃。
 *
 *  可点击部件（工作流 subTarget / op.part）：
 *     display（屏幕）、pv / sv / out（三个读数区）
 *     am（A/M 整键）、set（SET）、up / down（▲ / ▼）、
 *     set-plus / set-minus / key-plus / key-minus（▲/▼ 的别名）
 *     ctrl-auto / ctrl-manu（Ctrl 行 自动 / 手动）
 *     temp-auto / temp-manu（TEMP 行 自动 / 手动）
 *     alarm-reset（报警复位）
 * ═══════════════════════════════════════════════════════════════════════════
 */
export class CoolingWaterPID extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.W = Math.max(300, config.width || 330);
        this.H = Math.max(260, config.height || 290);
        this.type = 'cooling_water_pid';
        this.special = 'cooling_pid';
        this.cache = 'fixed';

        this.powered = true;      // 默认已通电
        this._blink = 0;

        // 三级菜单状态
        this._mnu = { level: 0, gi: 0, pi: 0, pending: null, modified: false, lastAct: 0 };
        this._longTimer = null;
        this._longFired = false;

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
            screen: { x: 12, y: 36, w: W - 24, h: 168 },
            // 按键排（5 个）
            am: { x: 14, y: 214, w: 60, h: 38 },
            set: { x: 80, y: 214, w: 60, h: 38 },
            up: { x: 146, y: 214, w: 42, h: 38 },
            down: { x: 194, y: 214, w: 42, h: 38 },
            reset: { x: 242, y: 214, w: 74, h: 38 },
            // 屏幕三行（PV / SV / OUT 同格式）
            pv: { x: 20, y: 40, w: 170, h: 42 },
            sv: { x: 20, y: 86, w: 170, h: 42 },
            out: { x: 20, y: 132, w: 170, h: 42 },
            bar: { x: 176, y: 146, w: 128, h: 10 },
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

        // 液晶屏
        g.add(new Konva.Rect({ x: G.screen.x, y: G.screen.y, width: G.screen.w, height: G.screen.h, cornerRadius: 4, fill: LCD_BG, stroke: LCD_EDGE, strokeWidth: 1.5 }));

        // 屏内固定标签（三行同格式：标签 + 数值 + 单位）
        this._label(g, 22, 54, 'PV', 10, C_PV, true);
        this._label(g, 22, 100, 'SV', 10, C_SV, true);
        this._label(g, 22, 146, 'OUT', 10, C_OUT, true);
        this._label(g, 152, 50, '℃', 14, C_PV, true);
        this._label(g, 152, 96, '℃', 14, C_SV, true);
        this._label(g, 152, 142, '%', 14, C_OUT, true);

        // 输出条形框
        g.add(new Konva.Rect({ x: G.bar.x, y: G.bar.y, width: G.bar.w, height: G.bar.h, cornerRadius: 2, fill: '#0d1a12', stroke: '#1f5c3a', strokeWidth: 1 }));

        // 按键底板（A/M 键的底色由动态层按状态着色）
        const keyBg = (r, fill, txt, size = 12, txtColor = '#ffffff') => {
            g.add(new Konva.Rect({ x: r.x, y: r.y, width: r.w, height: r.h, cornerRadius: 4, fill, stroke: '#101315', strokeWidth: 1.5 }));
            if (txt) this._label(g, r.x, r.y + r.h / 2 - size * 0.65, txt, size, txtColor, true, 'center', r.w);
        };
        keyBg(G.am, '#1b1f22', '');
        keyBg(G.set, KEY_BG, 'SET', 11);
        keyBg(G.up, KEY_BG, '▲', 15);
        keyBg(G.down, KEY_BG, '▼', 15);
        keyBg(G.reset, '#5a2b2b', 'RESET', 10);

        // 指示灯文字：AUTO / MAN / ALARM
        this._label(g, 30, 261, 'AUTO', 9, C_DIM, true);
        this._label(g, 100, 261, 'MAN', 9, C_DIM, true);
        this._label(g, 164, 261, 'ALARM', 9, C_DIM, true);
    }

    _createDynamicNodes() {
        const d = this._dynamicGroup, G = this._geo;
        const num = (x, y, color) => new Konva.Text({
            x, y, text: '--.-', fontSize: VAL_SIZE, fontStyle: 'bold', fill: color,
            fontFamily: 'Consolas, "Courier New", monospace',
        });

        // PV / SV / OUT 数值（统一字号与格式）
        this._pvTxt = num(58, 40, C_PV);
        this._svTxt = num(58, 86, C_SV);
        this._outTxt = num(58, 132, C_OUT);
        this._bar = new Konva.Rect({ x: G.bar.x + 1, y: G.bar.y + 1, width: 0, height: G.bar.h - 2, cornerRadius: 1, fill: C_OUT });

        // A/M 按键：底色指示状态 + 文字
        this._amBg = new Konva.Rect({ x: G.am.x + 1, y: G.am.y + 1, width: G.am.w - 2, height: G.am.h - 2, cornerRadius: 3, fill: '#242a2e', stroke: '#0b0d0e', strokeWidth: 1 });
        this._amTxt = new Konva.Text({ x: G.am.x, y: G.am.y + 11, width: G.am.w, align: 'center', text: 'A/M', fontSize: 14, fontStyle: 'bold', fill: '#ffffff', fontFamily: 'Arial' });

        // 报警信息行
        if (this._alarmLine) {
            const act = m && m.alarms ? m.alarms.filter(a => a.active) : [];
            this._alarmLine.text(act.map(a => `${a.code} ${a.text}`).join('   '));
        }

        // 指示灯：AUTO / MAN / ALARM
        const lamp = (x, y) => new Konva.Circle({ x, y, radius: 6, fill: '#1c2226', stroke: '#0b0d0e', strokeWidth: 1.5 });
        this._lampAuto = lamp(18, 268);
        this._lampMan = lamp(88, 268);
        this._lampAlarm = lamp(152, 268);

        // 菜单覆盖层（仅菜单态显示）
        this._menuBg = new Konva.Rect({ x: G.screen.x + 1, y: G.screen.y + 1, width: G.screen.w - 2, height: G.screen.h - 2, cornerRadius: 3, fill: '#06120c', visible: false });
        this._menuTitle = new Konva.Text({ x: 24, y: 48, text: '', fontSize: 20, fontStyle: 'bold', fill: '#8fd0ff', fontFamily: 'Consolas, "Courier New", monospace', visible: false });
        this._menuValue = new Konva.Text({ x: 24, y: 84, text: '', fontSize: VAL_SIZE, fontStyle: 'bold', fill: C_OUT, fontFamily: 'Consolas, "Courier New", monospace', visible: false });
        this._menuHint = new Konva.Text({ x: 24, y: 150, width: G.screen.w - 40, text: '▲▼ 修改　SET 保存/下一项　长按 SET 返回', fontSize: 9, fill: '#6f9c83', fontFamily: 'Arial, "Microsoft YaHei", sans-serif', visible: false });
        this._menuEditDot = new Konva.Circle({ x: 0, y: 0, radius: 3, fill: C_OUT, visible: false });

        // 液晶屏底部：报警信息行（只显示报警编码与名称，亮绿色）
        this._alarmLine = new Konva.Text({
            x: 20, y: 181, width: G.screen.w - 34, text: '', fontSize: 13, fontStyle: 'bold',
            fill: '#3cff7a', fontFamily: 'Arial, "Microsoft YaHei", sans-serif',
        });

        d.add(this._pvTxt, this._svTxt, this._outTxt, this._bar, this._alarmLine,
            this._amBg, this._amTxt, this._lampAuto, this._lampMan, this._lampAlarm,
            this._menuBg, this._menuTitle, this._menuValue, this._menuHint, this._menuEditDot);
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
        add('pv', G.pv.x, G.pv.y, G.pv.w, G.pv.h, () => s._tipAll());
        add('temp-auto', G.pv.x, G.pv.y, G.pv.w, G.pv.h, () => s._setMode('AUTO'));
        add('sv', G.sv.x, G.sv.y, G.sv.w, G.sv.h, () => s._tipAll());
        add('temp-manu', G.sv.x, G.sv.y, G.sv.w, G.sv.h, () => s._setMode('MANU'));
        add('out', G.out.x, G.out.y, G.out.w, G.out.h, () => s._tipAll());

        // A/M：与其它按键一样，整键单击切换
        add('am', G.am.x, G.am.y, G.am.w, G.am.h, () => s._toggleMode());

        // SET（短按 = 进入/保存/下一项；长按 = 进入菜单 / 返回主界面）
        const setHit = add('set', G.set.x, G.set.y, G.set.w, G.set.h, () => { if (!s._longFired) s._pressSET(false); s._longFired = false; });
        setHit.on('mousedown', () => {
            s._longFired = false;
            if (s._longTimer) clearTimeout(s._longTimer);
            s._longTimer = setTimeout(() => {
                s._longTimer = null;
                s._longFired = true;
                s._pressSET(true);
                s._sync();
            }, 800);
        });
        const clearLong = () => { if (s._longTimer) { clearTimeout(s._longTimer); s._longTimer = null; } };
        setHit.on('mouseup mouseleave', clearLong);

        // ▲ / ▼ 及其别名
        add('set-plus', G.up.x, G.up.y, G.up.w, G.up.h, () => s._key(+1));
        add('set-minus', G.down.x, G.down.y, G.down.w, G.down.h, () => s._key(-1));
        add('key-plus', G.up.x, G.up.y, G.up.w, G.up.h, () => s._key(+1));
        add('key-minus', G.down.x, G.down.y, G.down.w, G.down.h, () => s._key(-1));
        add('up', G.up.x, G.up.y, G.up.w, G.up.h, () => s._key(+1));
        add('down', G.down.x, G.down.y, G.down.w, G.down.h, () => s._key(-1));

        // Ctrl 行 自动 / 手动（输出条左右半区）
        add('ctrl-manu', G.bar.x, G.bar.y - 8, G.bar.w / 2, G.bar.h + 16, () => s._setCtrl(false));
        add('ctrl-auto', G.bar.x + G.bar.w / 2, G.bar.y - 8, G.bar.w / 2, G.bar.h + 16, () => s._setCtrl(true));

        add('alarm-reset', G.reset.x, G.reset.y, G.reset.w, G.reset.h, () => { const sv = s._solver(); if (sv) sv.pressAlarmReset(); });
    }

    // ── 基本操作 ──
    _setMode(mode) {
        const sv = this._solver();
        if (!sv) return;
        sv.setMode(mode);
        this._mnu.level = 0;
    }

    _toggleMode() {
        const sv = this._solver();
        if (!sv) return;
        sv.setMode(sv.m.mode === 'AUTO' ? 'MANU' : 'AUTO');
        this._mnu.level = 0;
    }

    _setCtrl(auto) {
        const sv = this._solver();
        if (!sv) return;
        if (auto) sv.autoTakeover(); else sv.manualTakeover();
    }

    _key(dir) {
        if (this._mnu.level > 0) this._menuStep(dir);
        else this._level0(dir);
    }

    /** L0：AUTO 改设定值，MANU 改输出 */
    _level0(dir) {
        const sv = this._solver();
        if (!sv) return;
        const m = sv.m;
        if (m.mode === 'AUTO') sv.setSetpoint(clamp(m.setTemp + dir * 0.5, 60, 95));   // 每次 0.5 ℃
        else sv.stepManip(dir);
    }

    // ── 三级菜单 ──
    _meta(p) { return PARAM_META[p] || { label: p, unit: '', step: 1, min: -1e9, max: 1e9 }; }

    _getParam(p) {
        const sv = this._solver();
        if (!sv) return 0;
        const m = sv.m;
        if (p === 'P') return m.bandP;
        if (p === 'I') return m.ti;
        if (p === 'DB') return m.deadband;
        if (p === 'SV') return m.setTemp;
        if (p === 'L' || p === 'H' || p === 'HH') return (m.alarmLim || {})[p];
        if (p === 'MODE') return m.mode === 'AUTO' ? 'AUTO' : 'MANU';
        return 0;
    }

    _setParam(p, v) {
        const sv = this._solver();
        if (!sv) return;
        const m = sv.m;
        if (p === 'P') m.bandP = clamp(+v, 1, 30);
        else if (p === 'I') m.ti = clamp(+v, 5, 300);
        else if (p === 'DB') m.deadband = clamp(+v, 0, 5);
        else if (p === 'SV') sv.setSetpoint(clamp(+v, 60, 95));
        else if (p === 'L' || p === 'H' || p === 'HH') {
            if (!m.alarmLim) m.alarmLim = { HH: 98, H: 95, L: 55 };
            m.alarmLim[p] = Math.round(clamp(+v, 0, 130));
        }
        else if (p === 'MODE') sv.setMode(v === 'AUTO' ? 'AUTO' : 'MANU');
    }

    _menuStep(dir) {
        const M = this._mnu;
        M.lastAct = Date.now();
        if (M.level === 1) {
            M.gi = (M.gi + (dir > 0 ? 1 : -1) + MENU_GROUPS.length) % MENU_GROUPS.length;
            return;
        }
        if (M.level !== 2) return;
        const p = MENU_GROUPS[M.gi].params[M.pi];
        const meta = this._meta(p);
        if (!M.modified) { M.pending = this._getParam(p); M.modified = true; }
        if (meta.enum) {
            const i = meta.enum.indexOf(M.pending);
            M.pending = meta.enum[(i + (dir > 0 ? 1 : -1) + meta.enum.length) % meta.enum.length];
        } else {
            M.pending = Math.round(((+M.pending || 0) + dir * meta.step) * 100) / 100;
            M.pending = clamp(M.pending, meta.min, meta.max);
        }
    }

    _pressSET(long) {
        const M = this._mnu;
        M.lastAct = Date.now();
        // L2 已修改时短按 = 保存
        if (M.level === 2 && !long && M.modified) {
            const p = MENU_GROUPS[M.gi].params[M.pi];
            this._setParam(p, M.pending);
            M.modified = false;
            M.pending = null;
            this._tip(`参数已保存：${this._meta(p).cn} ${p}`);
            return;
        }
        if (M.level === 0) {
            if (long) { M.level = 1; M.gi = 0; }
            else this._tip('长按 SET 进入参数菜单');
        } else if (M.level === 1) {
            if (long) M.level = 0;                     // 长按从参数组直接返回主界面
            else { M.level = 2; M.pi = 0; M.modified = false; M.pending = null; }
        } else if (M.level === 2) {
            if (long) { M.level = 0; M.modified = false; M.pending = null; }
            else {
                M.pi = (M.pi + 1) % MENU_GROUPS[M.gi].params.length;
                M.modified = false; M.pending = null;
            }
        }
    }

    _menuView() {
        const M = this._mnu;
        if (M.level === 0) return null;
        if (M.level === 1) {
            return { title: `参数组 ${M.gi + 1}/${MENU_GROUPS.length}`, value: MENU_GROUPS[M.gi].name, editing: false };
        }
        const p = MENU_GROUPS[M.gi].params[M.pi];
        // 记录"已经进入并查看过"的参数（供教学流程的完成判据使用，演练时由人工操作同样生效）
        this._seenParams = this._seenParams || {};
        this._seenParams[p] = true;
        const meta = this._meta(p);
        const raw = M.modified ? M.pending : this._getParam(p);
        const val = meta.enum ? String(raw) : (typeof raw === 'number' ? raw.toFixed(1) : String(raw));
        return { title: `${p}  ${meta.cn}`, value: `${val}${meta.unit || ''}`, editing: M.modified };
    }

    _tipAll() {
        const sv = this._solver();
        if (!sv) { this._tip('PID 调节器：未接入冷却水系统'); return; }
        const m = sv.m;
        const st = sv.autoActive() ? 'AUTO（按设定值自动调节）' : 'MANU（手动给定开度）';
        this._tip(`冷却水温度 PID：PV ${m.faults.tt ? '***' : m.tcMeas.toFixed(2)} ℃ / SV ${m.setTemp.toFixed(1)} ℃ / OUT ${(m.outCmd != null ? m.outCmd : m.manip).toFixed(1)} %${m.faults.valve ? '（阀卡涩，实际阀位 ' + m.manip.toFixed(1) + ' %）' : ''} · ${st}`
            + `　｜　P ${m.bandP.toFixed(1)} / I ${m.ti.toFixed(0)} s / DB ${m.deadband.toFixed(1)} ℃`
            + `　｜　报警限 L ${(m.alarmLim || {}).L} / H ${(m.alarmLim || {}).H} / HH ${(m.alarmLim || {}).HH} ℃`);
    }

    // ═══════════════════════════════════════════════════════════
    //  显示同步
    // ═══════════════════════════════════════════════════════════
    _sync() {
        const sv = this._solver();
        const m = sv ? sv.m : null;
        const G = this._geo;

        // 菜单超时处理
        const M = this._mnu;
        const now = Date.now();
        if (M.level > 0 && now - M.lastAct > 20000) { M.level = 0; M.modified = false; M.pending = null; }
        if (M.modified && now - M.lastAct > 5000) { M.modified = false; M.pending = null; }

        const pv = m ? (m.faults.tt ? NaN : m.tcMeas) : NaN;
        const svv = m ? m.setTemp : NaN;
        const out = m ? (m.outCmd != null ? m.outCmd : m.manip) : 0;   // 显示调节器输出（指令值）

        this._pvTxt.text(Number.isFinite(pv) ? pv.toFixed(1) : '***');
        this._svTxt.text(Number.isFinite(svv) ? svv.toFixed(1) : '--.-');
        this._outTxt.text(Number.isFinite(out) ? out.toFixed(1) : '--.-');

        this._bar.width(Math.max(0, (G.bar.w - 2) * clamp(out, 0, 100) / 100));
        this._bar.fill(out > 70 ? '#ff8a3d' : (out < 30 ? '#63c8ff' : C_OUT));

        // 报警信息行
        if (this._alarmLine) {
            const act = m && m.alarms ? m.alarms.filter(a => a.active) : [];
            this._alarmLine.text(act.map(a => `${a.code} ${a.text}`).join('   '));
        }

        // 指示灯：AUTO / MAN / ALARM
        const auto = !!(m && m.mode === 'AUTO');
        this._lampAuto.fill(auto ? GREEN : '#1c2226');
        this._lampMan.fill(m && !auto ? AMBER : '#1c2226');
        this._lampAlarm.fill(m && m.alarms.some(a => a.active) ? RED : '#1c2226');

        // A/M 按键底色
        this._amBg.fill(auto ? '#1a7a35' : '#7a5a12');
        this._amBg.stroke(auto ? GREEN : AMBER);

        // 正常读数 / 菜单覆盖层
        const view = this._menuView();
        [this._pvTxt, this._svTxt, this._outTxt, this._bar].forEach(n => n.visible(!view));
        this._menuBg.visible(!!view);
        this._menuTitle.visible(!!view);
        this._menuValue.visible(!!view);
        this._menuHint.visible(!!view);
        if (view) {
            this._menuTitle.text(view.title);
            this._menuValue.text(view.value);
            this._blink = (this._blink + 1) % 10;
            const dotOn = view.editing && this._blink < 6;
            this._menuEditDot.visible(dotOn);
            this._menuEditDot.position({ x: 16, y: 88 });
            this._menuValue.fill(view.editing ? '#ff9f3d' : C_OUT);
        } else {
            this._menuEditDot.visible(false);
        }

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
