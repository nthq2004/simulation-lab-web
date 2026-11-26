import Konva from 'konva';
import { BaseComponent } from './BaseComponent.js';

/**
 * DeadmanPanel — 轮机员安全系统（Dead Man System）操作面板
 * ═══════════════════════════════════════════════════════════════
 *  三块面板同屏（1560 × 750）：
 *    · 左：机舱入口甲板上层左（绿指示灯 + 关|开 自复位旋钮 + 4 块复位按钮板）
 *    · 中：集控台操作面板（系统运行灯 / 关|开 旋钮 / 复位 / 蜂鸣器 / 时间设置）
 *    · 右：机舱入口甲板上层右（同左）
 *
 *  逻辑：
 *    · 任意一处按下旋钮右半并保持 → 指针右 45°，系统启动（计时清零开始正向计时）；
 *      松手指针回中位（自复位），系统保持运行。左半同理为停止。
 *    · 运行中计时，预警时间内按任意复位按钮 → 计时清零。
 *    · 超过预警时间 → 机舱警报（蜂鸣器闪烁），提醒复位。
 *    · 超过「预警 + 报警时间」→ 触发 K-Chief 的 DEADMAN 报警，并在驾驶室 / 轮机长
 *      值班面板上触发扬声器 + DEADMAN（只能由本系统复位按钮清除）。
 *
 *  部件 id（工作流 subTarget / op.part）：
 *    ecr-switch-left / ecr-switch-right / ecr-reset / ecr-time / ecr-buzz
 *    left-switch-left / left-switch-right / left-reset-1..4
 *    right-switch-left / right-switch-right / right-reset-1..4
 * ═══════════════════════════════════════════════════════════════
 */

const W = 1510, H = 750;

const _rect = (o) => new Konva.Rect(Object.assign({ listening: false }, o));
const _text = (o) => new Konva.Text(Object.assign({ listening: false, fontFamily: 'Microsoft YaHei, Arial' }, o));
const _line = (o) => new Konva.Line(Object.assign({ listening: false }, o));
const _circle = (o) => new Konva.Circle(Object.assign({ listening: false }, o));

const C_PLATE = '#b8bfbc';
const C_EDGE = '#6f7a78';
const C_LABEL = '#e2e7e5';
const C_GREEN = '#22d61d';
const C_GREEN_OFF = '#1d4f1a';
const C_AMBER = '#8a6a1f';
const C_AMBER_HI = '#b08a2c';
const C_FRAME = '#8fa8a6';

export class DeadmanPanel extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.width = W;
        this.height = H;
        this.type = 'deadman_panel';
        this.cache = 'fixed';

        this.dead = {
            running: false,
            t: 0,               // 已计时（s）
            preWarn: 27,        // 预警时间（min）
            alarmTime: 3,       // 报警时间（min）
            engineAlarm: false, // 超过预警时间（机舱警报）
            deadman: false,     // 超过报警时间（DEADMAN）
            angle: { ecr: 0, left: 0, right: 0 },
        };

        this._initGroups();
        this._init();
        this.config = { id: this.id };
    }

    _tip() { /* 不弹提示 */ }

    _init() {
        this._drawStatic();
        this._createDynamic();
        this._bindInteraction();
        this._addDragPlate();
    }

    _addDragPlate() {
        const plate = new Konva.Rect({ x: 0, y: 0, width: W, height: H, fill: 'rgba(0,0,0,0.001)', listening: true });
        this._interactGroup.add(plate);
        plate.moveToBottom();
        this.group.draggable(true);
    }

    // ═══════════════════════════════════════════════════════
    //  静态图形
    // ═══════════════════════════════════════════════════════

    _screw(s, x, y, r = 8) {
        s.add(_circle({ x, y, radius: r, fill: '#8f9a96', stroke: '#5d6663', strokeWidth: 1.4 }));
        s.add(_line({ points: [x - r * 0.55, y, x + r * 0.55, y], stroke: '#5d6663', strokeWidth: 1.4 }));
        s.add(_line({ points: [x, y - r * 0.55, x, y + r * 0.55], stroke: '#5d6663', strokeWidth: 1.4 }));
    }

    _labelBox(s, x, y, w, h, lines, fs = 15) {
        s.add(_rect({ x, y, width: w, height: h, fill: C_LABEL, stroke: '#8d9693', strokeWidth: 1 }));
        s.add(_text({
            x, y: y + (h - lines.length * (fs + 2)) / 2, width: w, align: 'center',
            fontSize: fs, lineHeight: 1.2, fill: '#111111', text: lines.join('\n'),
        }));
    }

    _knobBase(s, cx, cy, R) {
        s.add(_circle({ x: cx, y: cy, radius: R, fill: '#b9bfbc', stroke: '#6e7673', strokeWidth: 3 }));
        s.add(_circle({ x: cx, y: cy, radius: R - 8, fill: '#141414', stroke: '#000000', strokeWidth: 1 }));
    }

    /** 机舱入口面板（左 / 右） */
    _entrance(s, x0, side) {
        const titles = side === 'left'
            ? ['机舱入口甲板上层左', '机舱2层平台左', '机舱3层平台左', '机舱底层平台左', '泵舱顶层平台左']
            : ['机舱入口甲板上层右', '机舱2层平台右', '机舱3层平台右', '机舱底层平台右', '机舱3层平台右'];

        // 顶部主板
        s.add(_rect({ x: x0, y: 14, width: 480, height: 280, fill: C_PLATE, stroke: C_EDGE, strokeWidth: 2 }));
        [[22, 36], [458, 36], [22, 258], [458, 258]].forEach(([dx, dy]) => this._screw(s, x0 + dx, dy));
        s.add(_text({ x: x0 + 20, y: 20, width: 440, align: 'center', fontSize: 18, fontStyle: 'bold', fill: '#111111', text: titles[0] }));

        this._labelBox(s, x0 + 70, 56, 120, 82, ['轮机员安全系统', '', '开']);
        this._labelBox(s, x0 + 270, 56, 120, 82, ['轮机员安全系统', '', '关 | 开']);

        // 绿色圆指示灯底座 / 旋钮底座
        s.add(_circle({ x: x0 + 130, y: 200, radius: 36, fill: '#3d4642', stroke: '#2a322f', strokeWidth: 5 }));
        this._knobBase(s, x0 + 330, 200, 43);

        // 4 块复位按钮板
        const pos = [[x0 + 6, 312], [x0 + 246, 312], [x0 + 6, 526], [x0 + 246, 526]];
        pos.forEach(([px, py], i) => {
            s.add(_rect({ x: px, y: py, width: 228, height: 198, fill: C_PLATE, stroke: C_EDGE, strokeWidth: 2 }));
            [[16, 20], [212, 20], [16, 178], [212, 178]].forEach(([dx, dy]) => this._screw(s, px + dx, py + dy, 7));
            s.add(_text({ x: px + 6, y: py + 10, width: 216, align: 'center', fontSize: 15, fontStyle: 'bold', fill: '#111111', text: titles[i + 1] }));
            this._labelBox(s, px + 49, py + 42, 130, 56, ['轮机员安全系统',  '复位'], 14.5);
            s.add(_circle({ x: px + 114, y: py + 150, radius: 38, fill: '#6b6f6c', stroke: '#3f4543', strokeWidth: 3 }));
        });
    }

    /** 集控台操作面板 */
    _ecr(s) {
        s.add(_rect({ x: 530, y: 14, width: 450, height: 722, fill: C_FRAME, stroke: '#2b3230', strokeWidth: 5, cornerRadius: 38 }));

        // 标题
        s.add(_rect({ x: 560, y: 34, width: 390, height: 44, fill: C_LABEL, stroke: '#4a5250', strokeWidth: 2 }));
        s.add(_text({ x: 560, y: 41, width: 390, align: 'center', fontSize: 20, fill: '#111111', text: '集控台轮机员安全面板' }));

        const box = (x, y, w, txt) => {
            s.add(_rect({ x, y, width: w, height: 38, fill: C_LABEL, stroke: '#4a5250', strokeWidth: 2 }));
            s.add(_text({ x, y: y + 7, width: w, align: 'center', fontSize: 18, fill: '#111111', text: txt }));
        };
        box(565, 110, 170, '系统运行');
        box(775, 110, 170, '关   |   开');
        box(565, 300, 170, '复位');
        box(775, 300, 170, '蜂鸣器');

        // 系统运行灯（圆形，同机舱入口面板）
        s.add(_circle({ x: 650, y: 220, radius: 36, fill: '#3d4642', stroke: '#2a322f', strokeWidth: 3 }));
        // 旋钮（同入口面板尺寸）
        this._knobBase(s, 860, 220, 43);
        // 复位按钮（圆形，同入口面板）
        s.add(_circle({ x: 650, y: 400, radius: 38, fill: '#6b6f6c', stroke: '#3f4543', strokeWidth: 3 }));

        // 蜂鸣器（无底色方块，与「蜂鸣器」标签居中）
        s.add(_line({
            points: [805, 390, 821, 390, 839, 374, 839, 426, 821, 410, 805, 410],
            closed: true, fill: '#ffffff', stroke: '#5a605e', strokeWidth: 2,
        }));

        // 时间设置按钮（上移，下方留出时间设置面板的位置）
        s.add(_rect({ x: 685, y: 450, width: 140, height: 36, fill: C_LABEL, stroke: '#4a5250', strokeWidth: 2, cornerRadius: 2 }));
        s.add(_text({ x: 685, y: 457, width: 140, align: 'center', fontSize: 17, fill: '#111111', text: '时间设置' }));
    }

    _drawStatic() {
        const s = this._staticGroup;
        s.add(_rect({ x: 0, y: 0, width: W, height: H, fill: '#f2f4f3', stroke: '#c3c9c6', strokeWidth: 1 }));
        this._entrance(s, 14, 'left');
        this._ecr(s);
        this._entrance(s, 1016, 'right');
    }

    // ═══════════════════════════════════════════════════════
    //  动态图形
    // ═══════════════════════════════════════════════════════

    _mkKnob(cx, cy, R) {
        const g = new Konva.Group({ x: cx, y: cy, listening: false });
        g.add(new Konva.Rect({
            x: -4, y: -(R - 12), width: 8, height: (R - 12) * 2,
            cornerRadius: 4, fill: 'rgba(0,0,0,0)', stroke: '#ffffff', strokeWidth: 3,
        }));
        g.add(new Konva.Rect({ x: -3, y: -(R - 10), width: 6, height: 18, cornerRadius: 2, fill: '#ffffff' }));
        this._dynamicGroup.add(g);
        return g;
    }

    _createDynamic() {
        const d = this._dynamicGroup;

        // 集控台
        this._ecrLamp = _circle({ x: 650, y: 220, radius: 33, fill: C_GREEN_OFF, stroke: '#0b2d09', strokeWidth: 2 });
        d.add(this._ecrLamp);
        this._ecrKnob = this._mkKnob(860, 220, 43);
        this._ecrBtn = _circle({ x: 650, y: 400, radius: 32, fill: C_AMBER, stroke: C_AMBER_HI, strokeWidth: 4 });
        d.add(this._ecrBtn);

        // 蜂鸣器声波（无底色）
        this._buzz = new Konva.Group({ x: 0, y: 0, listening: false, visible: false });
        [[847, 400, 12], [863, 400, 22], [879, 400, 32]].forEach(([cx, cy, r]) => {
            this._buzz.add(new Konva.Arc({
                x: cx, y: cy, innerRadius: r, outerRadius: r + 4, angle: 70, rotation: -35,
                fill: 'rgba(0,0,0,0)', stroke: '#2f3634', strokeWidth: 4, listening: false,
            }));
        });
        d.add(this._buzz);

        // 左右入口面板
        this._lamp = {}; this._knob = {}; this._btn = {};
        ['left', 'right'].forEach((side) => {
            const x0 = side === 'left' ? 14 : 1016;
            this._lamp[side] = _circle({ x: x0 + 130, y: 200, radius: 33, fill: C_GREEN_OFF, stroke: '#0b2d09', strokeWidth: 2 });
            d.add(this._lamp[side]);
            this._knob[side] = this._mkKnob(x0 + 330, 200, 43);

            const pos = [[x0 + 6, 312], [x0 + 246, 312], [x0 + 6, 526], [x0 + 246, 526]];
            this._btn[side] = pos.map(([px, py]) => {
                const c = _circle({ x: px + 114, y: py + 150, radius: 32, fill: C_AMBER, stroke: C_AMBER_HI, strokeWidth: 4 });
                d.add(c);
                return c;
            });
        });
    }

    // ═══════════════════════════════════════════════════════
    //  状态机
    // ═══════════════════════════════════════════════════════

    get preWarnSec() { return Math.max(1, this.dead.preWarn) * 60; }
    get alarmSec() { return Math.max(0, this.dead.alarmTime) * 60; }

    start() {
        if (this.dead.running) return;
        this.dead.running = true;
        this.dead.t = 0;
        this.dead.engineAlarm = false;
        this.dead.deadman = false;
        this._syncKChief();
    }

    stop() {
        this.dead.running = false;
        this.dead.t = 0;
        this.dead.engineAlarm = false;
        this.dead.deadman = false;
        this._syncKChief();
    }

    /** 任意复位按钮：计时清零，消除机舱警报与 DEADMAN */
    reset() {
        this.dead.t = 0;
        this.dead.engineAlarm = false;
        this.dead.deadman = false;
        this._syncKChief();
    }

    /** 按下旋钮某半并保持：右=开、左=关 */
    pressSwitch(panel, dir) {
        this.dead.angle[panel] = dir > 0 ? 45 : -45;
        if (dir > 0) this.start(); else this.stop();
        this._applyKnobs();
        this._redraw();
    }

    releaseSwitches() {
        this.dead.angle.ecr = 0;
        this.dead.angle.left = 0;
        this.dead.angle.right = 0;
        this._applyKnobs();
        this._redraw();
    }

    _applyKnobs() {
        const a = this.dead.angle;
        if (this._ecrKnob) this._ecrKnob.rotation(a.ecr);
        if (this._knob) {
            this._knob.left.rotation(a.left);
            this._knob.right.rotation(a.right);
        }
    }

    _syncKChief() {
        const M = this.sys && this.sys.kchief;
        if (!M || typeof M.setDeadman !== 'function') return;
        if (this._lastDeadman === this.dead.deadman) return;
        this._lastDeadman = this.dead.deadman;
        M.setDeadman(this.dead.deadman);
    }

    _redraw() {
        if (this.sys && typeof this.sys.requestRedraw === 'function') this.sys.requestRedraw();
    }

    // ═══════════════════════════════════════════════════════
    //  交互
    // ═══════════════════════════════════════════════════════

    _bindInteraction() {
        const mk = (id, x, y, w, h, onDown, onClick) => {
            const hit = this.addClickablePart(id, x, y, w, h);
            if (onDown) hit.on('mousedown', (e) => { e.cancelBubble = true; onDown(); });
            if (onClick) hit.on('click tap', (e) => { e.cancelBubble = true; onClick(); });
            return hit;
        };

        // 集控台旋钮：左半 / 右半
        mk('ecr-switch-left', 808, 168, 52, 104, () => this.pressSwitch('ecr', -1));
        mk('ecr-switch-right', 860, 168, 52, 104, () => this.pressSwitch('ecr', 1));
        // 集控台复位 / 时间设置 / 蜂鸣器
        mk('ecr-reset', 612, 362, 76, 76, null, () => this.reset());
        mk('ecr-time', 675, 442, 160, 52, () => this._showTimeDialog(), () => this._showTimeDialog());
        mk('ecr-buzz', 805, 372, 112, 56, null);

        ['left', 'right'].forEach((side) => {
            const x0 = side === 'left' ? 14 : 1016;
            mk(`${side}-switch-left`, x0 + 278, 148, 52, 104, () => this.pressSwitch(side, -1));
            mk(`${side}-switch-right`, x0 + 330, 148, 52, 104, () => this.pressSwitch(side, 1));

            const pos = [[x0 + 6, 312], [x0 + 246, 312], [x0 + 6, 526], [x0 + 246, 526]];
            pos.forEach(([px, py], i) => {
                mk(`${side}-reset-${i + 1}`, px + 82, py + 118, 64, 64, null, () => this.reset());
            });
        });

        // 松开即复位（自复位旋钮）
        const stage = this.sys && this.sys.stage;
        if (stage) {
            stage.on('mouseup.deadman', () => this.releaseSwitches());
            stage.on('touchend.deadman', () => this.releaseSwitches());
        }
    }

    // ═══════════════════════════════════════════════════════
    //  时间设置对话框（非模态，必须点右上角关闭）
    // ═══════════════════════════════════════════════════════

    _showTimeDialog() {
        let dlg = document.getElementById('deadman_time_dlg');
        if (!dlg) {
            dlg = document.createElement('div');
            dlg.id = 'deadman_time_dlg';
            dlg.style.cssText = [
                'position:fixed', 'left:50%', 'top:50%', 'transform:translate(-50%,-50%)',
                'width:250px', 'padding:16px 16px 12px', 'background:#cfd4d1',
                'border:2px solid #4a5250', 'border-radius:4px', 'z-index:9999',
                "font-family:'Microsoft YaHei',Arial", 'font-size:16px', 'color:#111',
                'box-shadow:0 6px 22px rgba(0,0,0,.35)', 'user-select:none',
            ].join(';');

            const row = (label, id, min) => `
                <div style="display:flex;align-items:center;margin-bottom:16px;">
                  <span style="width:74px;">${label}</span>
                  <input id="${id}" type="number" step="0.5" min="${min}"
                         style="width:86px;height:28px;font-size:17px;text-align:center;border:1px solid #7a8280;background:#fff;">
                  <span style="display:flex;flex-direction:column;margin-left:3px;">
                    <button data-spin="${id}:0.5" style="width:26px;height:14px;font-size:10px;line-height:1;cursor:pointer;">▲</button>
                    <button data-spin="${id}:-0.5" style="width:26px;height:14px;font-size:10px;line-height:1;cursor:pointer;">▼</button>
                  </span>
                  <span style="margin-left:8px;font-size:14px;color:#333;">最小</span>
                </div>`;

            dlg.innerHTML = `
                <button id="dm-close" style="position:absolute;right:6px;top:4px;width:24px;height:24px;
                        border:1px solid #6b7370;background:#e9ecee;cursor:pointer;font-size:15px;line-height:1;">×</button>
                <div style="height:10px;"></div>
                ${row('预警时间', 'dm-pre', 1)}
                ${row('报警时间', 'dm-alarm', 0)}
                <div id="dm-disp" style="margin-top:4px;height:64px;background:#4a4f4d;border:2px solid #333;
                        display:flex;align-items:center;justify-content:center;
                        font-family:'Consolas','Courier New',monospace;font-size:44px;color:#38ff38;letter-spacing:4px;">00:00</div>`;
            document.body.appendChild(dlg);

            const pre = dlg.querySelector('#dm-pre');
            const alm = dlg.querySelector('#dm-alarm');
            pre.value = this.dead.preWarn.toFixed(1);
            alm.value = this.dead.alarmTime.toFixed(1);

            const apply = () => {
                const p = parseFloat(pre.value);
                const a = parseFloat(alm.value);
                if (Number.isFinite(p)) this.dead.preWarn = Math.max(1, Math.round(p * 10) / 10);
                if (Number.isFinite(a)) this.dead.alarmTime = Math.max(0, Math.round(a * 10) / 10);
                pre.value = this.dead.preWarn.toFixed(1);
                alm.value = this.dead.alarmTime.toFixed(1);
            };
            pre.addEventListener('change', apply);
            alm.addEventListener('change', apply);
            dlg.querySelectorAll('button[data-spin]').forEach((b) => {
                b.addEventListener('click', () => {
                    const [id, d] = b.dataset.spin.split(':');
                    const el = dlg.querySelector('#' + id);
                    el.value = (parseFloat(el.value || '0') + parseFloat(d)).toFixed(1);
                    apply();
                });
            });
            dlg.querySelector('#dm-close').addEventListener('click', () => { dlg.style.display = 'none'; });
        }
        dlg.querySelector('#dm-pre').value = this.dead.preWarn.toFixed(1);
        dlg.querySelector('#dm-alarm').value = this.dead.alarmTime.toFixed(1);
        dlg.style.display = 'block';
        this._placeDialog(dlg);
        this._updateDialog();
    }

    /** 把对话框锚定到「时间设置」按钮正下方，水平居中（画布坐标 → 屏幕坐标） */
    _placeDialog(dlg) {
        try {
            this._placeDialogAt(dlg);
        } catch (e) {
            const w = dlg.offsetWidth || 286, h = dlg.offsetHeight || 210;
            dlg.style.left = Math.round((window.innerWidth - w) / 2) + 'px';
            dlg.style.top = Math.round((window.innerHeight - h) / 2) + 'px';
            dlg.style.transform = 'none';
        }
    }

    _placeDialogAt(dlg) {
        const stage = this.sys && this.sys.stage;
        if (!stage || !stage.container) throw new Error('no stage');
        const box = stage.container().getBoundingClientRect();
        // 按钮：x 710~850、y 560~596 → 正下方中点 (780, 602)
        const p = this.group.getAbsoluteTransform().point({ x: 755, y: 527 });
        const sx = stage.width() ? box.width / stage.width() : 1;
        const sy = stage.height() ? box.height / stage.height() : 1;
        const w = dlg.offsetWidth || 286;
        const h = dlg.offsetHeight || 210;
        let left = box.left + p.x * sx - w / 2;
        let top = box.top + p.y * sy;
        left = Math.max(4, Math.min(left, window.innerWidth - w - 4));
        top = Math.max(4, Math.min(top, window.innerHeight - h - 4));
        dlg.style.left = Math.round(left) + 'px';
        dlg.style.top = Math.round(top) + 'px';
        dlg.style.transform = 'none';
    }

    /** 正向计时：显示已运行时间 mm:ss */
    _timeText() {
        const sec = this.dead.running ? this.dead.t : 0;
        const m = Math.floor(sec / 60), ss = Math.floor(sec % 60);
        return String(m).padStart(2, '0') + ':' + String(ss).padStart(2, '0');
    }

    _updateDialog() {
        const el = document.getElementById('dm-disp');
        if (!el) return;
        const dlg = document.getElementById('deadman_time_dlg');
        if (!dlg || dlg.style.display === 'none') return;
        el.textContent = this._timeText();
    }

    // ═══════════════════════════════════════════════════════
    //  每帧刷新
    // ═══════════════════════════════════════════════════════

    tick(dt) {
        const d = this.dead;
        if (d.running) {
            d.t += dt;
            const pre = this.preWarnSec, al = this.alarmSec;
            const eng = d.t >= pre;
            const dm = al > 0 ? d.t >= pre + al : eng;
            if (eng !== d.engineAlarm) { d.engineAlarm = eng; }
            if (dm !== d.deadman) { d.deadman = dm; this._syncKChief(); }
        }

        const on = Math.floor(Date.now() / 500) % 2 === 0;

        // 运行指示灯
        const lampOn = d.running ? C_GREEN : C_GREEN_OFF;
        if (this._ecrLamp) this._ecrLamp.fill(lampOn);
        if (this._lamp) {
            this._lamp.left.fill(lampOn);
            this._lamp.right.fill(lampOn);
        }

        // 复位按钮（运行中轻微高亮）
        if (this._ecrBtn) this._ecrBtn.fill(C_AMBER);

        // 蜂鸣器：超过预警时间后闪烁
        if (this._buzz) this._buzz.visible(!!d.engineAlarm && on);

        this._updateDialog();

        // 页面隐藏时收起对话框
        if (this.group && !this.group.visible()) {
            const dlg = document.getElementById('deadman_time_dlg');
            if (dlg) dlg.style.display = 'none';
        }
    }
}
