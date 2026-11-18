import Konva from 'konva';
import { BaseComponent } from './BaseComponent.js';
import { STATIONS } from '../tools/KChiefSolver.js';

/**
 * ExtensionAlarmUnit — 延伸报警单元（值班面板 ×6）
 * ═══════════════════════════════════════════════════════════════
 *  版式参照 K-Chief 600 的延伸报警面板（Engineer's alarm panel）：
 *    6 块相同外观的值班面板，分 3 列 × 2 行：
 *      驾驶室（值班面板）/ 轮机长 / 大管轮 / 二管轮 / 三管轮 / 电机员
 *
 *  每块面板三个页面（各自独立，状态栏按钮切换，激活的按钮变绿）：
 *    · Home（主页）：驾驶台面板 On Watch（BRIDGE / ECR）+ Duty + 大号岗位名 +
 *      Call All Engineer / Call Duty Engineer；其他面板 Duty + 大号岗位名（如 4TH ENG.）；
 *      值班面板底部显示 8 个报警类别标签（有报警的标红）
 *    · Alarms（报警页）：`SAT NOV 14 11:26:55 2026 ALARM SUMMARY` + 报警列表
 *      + Up / Down / Select / Tag details
 *    · Settings（设置页）：Dimming / System test / Configuration / About
 *      + Backlight（Day / Night）+ Night Screensaver（Disable / Enable）
 *
 *  状态栏：时钟 + 扬声器（值班呼叫/报警时闪烁；按下＝应答或本面板消音）
 *          + 主页 / Alarms / Settings + 失职报警 REPEAT（仅驾驶台与轮机长面板）
 *
 *  可点击部件（工作流 subTarget / op.part）：
 *    <岗位>-buzz（扬声器）  <岗位>-soundoff / <岗位>-ack（Sound off）
 *    <岗位>-home / <岗位>-alarms / <岗位>-settings（切页）
 *    bridge-watch-bridge / bridge-watch-ecr（驾驶台 On Watch）
 *    bridge-call-all / bridge-call-duty（驾驶台呼叫按钮）
 * ═══════════════════════════════════════════════════════════════
 */

const PW = 503;        // 单块面板宽
const PH = 390;        // 单块面板高（含标题牌）
const BODY_Y = 36;     // 面板框相对面板顶部的偏移
const BODY_H = 354;    // 面板框高
const GAPX = 30, GAPY = 30;
const W = PW * 3 + GAPX * 2;   // 1569
const H = PH * 2 + GAPY;       // 810

const C_RED = '#d10f10';
const C_GREEN = '#3fbf3f';
const C_GREEN_LT = '#8ef08e';

const _rect = (o) => new Konva.Rect(Object.assign({ listening: false }, o));
const _text = (o) => new Konva.Text(Object.assign({ listening: false, fontFamily: 'Microsoft YaHei, Arial' }, o));
const _line = (o) => new Konva.Line(Object.assign({ listening: false }, o));

/** 面板岗位的英文标识（与 K-Chief 面板一致） */
const ROLE_EN = {
    bridge: 'BRIDGE',
    chief: 'CHIEF ENG.',
    first: '2ND ENG.',
    second: '3RD ENG.',
    third: '4TH ENG.',
    elec: 'ELEC. ENG.',
};

/** 底部报警类别标签：[显示名, 匹配的报警组键数组 或 'SHD'/'SLD'] */
const GROUP_TAGS = [
    ['M/E MISC', ['ME-GEN', 'ME-CFW', 'ME-PCOOL', 'ME-CSW', 'ME-LO', 'ME-FO', 'ME-EXH', 'ME-AIR']],
    ['M/E SHD', 'SHD'],
    ['M/E SLD', 'SLD'],
    ['BOILER', ['AUX-BOILER']],
    ['FIRE ALARM', ['FIRE']],
    ['MISC', ['MISC', 'TANK']],
    ['AUX ENG', ['AUX-MACH', 'DG1', 'DG2', 'DG3', 'POWER', 'IGS', 'HOUR']],
    ['BILGE', ['MISC']],
];

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const DAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

export class ExtensionAlarmUnit extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.W = W;
        this.H = H;
        this.width = W;
        this.height = H;

        this.type = 'extension_alarm_unit';
        this.cache = 'fixed';

        if (!sys.kchief) {
            const { KChiefSolver } = sys.kchiefModule || {};
            if (KChiefSolver) sys.kchief = new KChiefSolver(sys);
        }
        this.model = sys.kchief;

        this._volume = 1;                       // 音量档位 0 低 / 1 中 / 2 高
        this._page = {};                        // 各面板当前页面：home / alarms / settings
        STATIONS.forEach(st => { this._page[st.id] = 'home'; });

        this._initGroups();
        this._init();
        this.config = { id: this.id };
    }

    /** 按钮点击提示（按用户要求不弹出任何提示） */
    _tip() { /* 不显示提示 */ }

    _pos(i) {
        const c = i % 3, r = Math.floor(i / 3);
        return { x: c * (PW + GAPX), y: r * (PH + GAPY) };
    }

    // ═══════════════════════════════════════════════════════
    //  构建
    // ═══════════════════════════════════════════════════════
    _init() {
        this._drawStatic();
        this._createDynamic();
        this._addDragPlate();
        this._bindInteraction();
        this._updateDynamic();
    }

    /** 整块面板拖动热区（静态图形均 listening:false，需专用热区才能拖动整块） */
    _addDragPlate() {
        const plate = new Konva.Rect({
            x: 0, y: 0, width: this.W, height: this.H,
            fill: 'rgba(0,0,0,0.001)', listening: true,
        });
        this._interactGroup.add(plate);
        plate.moveToBottom();
        this.group.draggable(true);
    }

    /** 通用按钮（静态层）：白底渐变 + 居中文字 */
    _btn(layer, partId, x, y, w, h, label, onClick, opts = {}) {
        layer.add(_rect({
            x, y, width: w, height: h,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint: { x: 0, y: h },
            fillLinearGradientColorStops: [0, '#fdfdfd', 1, '#dfe2e4'],
            stroke: opts.stroke || '#8b9195',
            strokeWidth: 1, cornerRadius: 2,
        }));
        layer.add(_text({
            x, y: y + Math.max(1, (h - (opts.fontSize || 11)) / 2 - 2),
            width: w, align: 'center', text: label,
            fontSize: opts.fontSize || 11, fill: opts.color || '#1d1d1d',
        }));
        if (partId) {
            const hit = this.addClickablePart(partId, x, y, w, h);
            if (onClick && hit) hit.on('click', () => onClick());
        }
    }

    _drawStatic() {
        const s = this._staticGroup;

        STATIONS.forEach((st, i) => {
            const { x: px, y: py } = this._pos(i);

            // 标题牌（岗位名）
            s.add(_rect({ x: px + 130, y: py, width: 260, height: 34, fill: '#e6e6e6', stroke: '#333333', strokeWidth: 1 }));
            s.add(_text({ x: px + 130, y: py + 2, width: 260, align: 'center', fontSize: 14, fontStyle: 'bold', fill: '#1d1d1d', text: st.title }));
            s.add(_text({ x: px + 130, y: py + 19, width: 260, align: 'center', fontSize: 12, fill: '#444444', text: st.sub }));

            // 面板框
            s.add(_rect({
                x: px, y: py + BODY_Y, width: PW, height: BODY_H,
                fill: '#ededed', stroke: '#111111', strokeWidth: 1.6, cornerRadius: 4,
            }));

            // 状态栏（灰渐变）
            s.add(_rect({
                x: px + 2, y: py + BODY_Y + 2, width: PW - 4, height: 26,
                fillLinearGradientStartPoint: { x: 0, y: 0 },
                fillLinearGradientEndPoint: { x: 0, y: 26 },
                fillLinearGradientColorStops: [0, '#4f4f4f', 1, '#9c9c9c'],
            }));
        });
    }

    /** 动态层：状态栏按钮、各页面内容 */
    _createDynamic() {
        const d = this._dynamicGroup;
        this._st = {};

        STATIONS.forEach((st, i) => {
            const { x: px, y: py } = this._pos(i);
            const by = py + BODY_Y;
            const rec = { px, py, by };
            const g = new Konva.Group();
            d.add(g);
            rec.g = g;

            // 时钟
            rec.clock = _text({ x: px + 8, y: by + 6, fontSize: 13, fontStyle: 'bold', fill: '#ffffff', text: '11:27:09' });
            g.add(rec.clock);

            // 状态栏三个按钮（动态着色：当前页按钮变绿）
            rec.tabBtns = [
                { id: 'home', label: '主页', x: px + 313, w: 62 },
                { id: 'alarms', label: 'Alarms', x: px + 377, w: 62 },
                { id: 'settings', label: 'Settings', x: px + 441, w: 58 },
            ].map(t => {
                const bg = _rect({ x: t.x, y: by + 4, width: t.w, height: 22, fill: '#e9ecee', stroke: '#7a8288', strokeWidth: 1, cornerRadius: 2 });
                const tx = _text({ x: t.x, y: by + 8, width: t.w, align: 'center', fontSize: 10.5, fill: '#1d1d1d', text: t.label });
                g.add(bg, tx);
                return { ...t, bg, tx };
            });

            // 扬声器（呼叫 / 报警响铃时闪烁）
            rec.buzzBg = _rect({ x: px + 96, y: by + 4, width: 32, height: 22, fill: C_GREEN, stroke: '#2f8f2f', strokeWidth: 1, cornerRadius: 2, visible: false });
            rec.buzzIcon = new Konva.Group({ x: px + 100, y: by + 8, visible: false, listening: false });
            rec.buzzIcon.add(new Konva.Line({ points: [2, 5, 8, 5, 8, 2, 14, 0, 14, 10, 8, 8, 8, 5], closed: true, fill: '#ffffff', stroke: '#ffffff', strokeWidth: 1 }));
            rec.buzzIcon.add(_line({ points: [16, 3, 19, 5], stroke: '#ffffff', strokeWidth: 1.6 }));
            rec.buzzIcon.add(_line({ points: [0, 0, 20, 11], stroke: '#e01b1b', strokeWidth: 2 }));
            g.add(rec.buzzBg, rec.buzzIcon);

            // REPEAT（失职报警，仅驾驶台 / 轮机长）
            rec.repeatBg = _rect({ x: px + 140, y: by + 4, width: 92, height: 22, fill: C_RED, stroke: '#7a0f0f', strokeWidth: 1, visible: false });
            rec.repeatText = _text({ x: px + 140, y: by + 7, width: 92, align: 'center', fontSize: 12, fontStyle: 'bold', fill: '#ffffff', text: 'REPEAT', visible: false });
            g.add(rec.repeatBg, rec.repeatText);

            // ── Home 页 ──
            rec.home = new Konva.Group();
            g.add(rec.home);
            // 驾驶台面板：On Watch（BRIDGE / ECR）
            rec.onWatchTitle = _text({ x: px + 14, y: by + 38, fontSize: 12.5, fill: '#4a4a4a', text: 'On Watch' });
            rec.onWatchLine = _line({ points: [px + 14, by + 56, px + PW - 14, by + 56], stroke: '#b8b8b8', strokeWidth: 1 });
            rec.watchBgs = {};
            rec.watchTexts = {};
            [['BRIDGE', px + 22, 190], ['ECR', px + 232, 190]].forEach(([pos, wx, ww]) => {
                rec.watchBgs[pos] = _rect({ x: wx, y: by + 66, width: ww, height: 42, fill: '#ffffff', stroke: '#7f7f7f', strokeWidth: 1 });
                rec.watchTexts[pos] = _text({ x: wx, y: by + 78, width: ww, align: 'center', fontSize: 15, fontStyle: 'bold', fill: '#1d1d1d', text: pos });
                rec.home.add(rec.watchBgs[pos], rec.watchTexts[pos]);
            });
            rec.home.add(rec.onWatchTitle, rec.onWatchLine);

            // Duty 行 + 大号岗位名
            rec.dutyTitle = _text({ x: px + 14, y: by + 122, fontSize: 12.5, fill: '#4a4a4a', text: 'Duty' });
            rec.dutyLine = _line({ points: [px + 14, by + 140, px + PW - 14, by + 140], stroke: '#b8b8b8', strokeWidth: 1 });
            rec.roleText = _text({
                x: px + 10, y: by + 150, width: PW - 20, align: 'center',
                fontSize: 34, fontStyle: 'bold', fill: '#111111', text: ROLE_EN[st.id] || '',
            });
            rec.home.add(rec.dutyTitle, rec.dutyLine, rec.roleText);

            // 驾驶台：呼叫按钮
            rec.callAllBg = _rect({ x: px + 192, y: by + 216, width: 208, height: 34, fill: '#f7f8f9', stroke: '#8b9195', strokeWidth: 1, cornerRadius: 2 });
            rec.callAllTx = _text({ x: px + 192, y: by + 225, width: 208, align: 'center', fontSize: 15.5, fontStyle: 'bold', fill: '#1d1d1d', text: 'Call All Engineer' });
            rec.callDutyBg = _rect({ x: px + 192, y: by + 256, width: 208, height: 34, fill: '#f7f8f9', stroke: '#8b9195', strokeWidth: 1, cornerRadius: 2 });
            rec.callDutyTx = _text({ x: px + 192, y: by + 265, width: 208, align: 'center', fontSize: 15.5, fontStyle: 'bold', fill: '#1d1d1d', text: 'Call Duty Engineer' });
            rec.home.add(rec.callAllBg, rec.callAllTx, rec.callDutyBg, rec.callDutyTx);

            // 报警响铃时的红色报警区 + Sound off
            rec.alarmBg = _rect({ x: px + 10, y: by + 32, width: PW - 20, height: 148, fill: C_RED, stroke: '#8a0b0b', strokeWidth: 1, visible: false });
            rec.alarmLines = [];
            for (let k = 0; k < 4; k++) {
                const t = _text({ x: px + 16, y: by + 42 + k * 32, width: PW - 32, align: 'center', fontSize: 19, fontStyle: 'bold', fill: '#ffffff', text: '', visible: false });
                rec.alarmLines.push(t);
                rec.home.add(t);
            }
            rec.home.add(rec.alarmBg);
            rec.alarmBg.moveToBottom();
            rec.soundBg = _rect({
                x: px + 60, y: by + 192, width: 400, height: 50,
                fillLinearGradientStartPoint: { x: 0, y: 0 },
                fillLinearGradientEndPoint: { x: 0, y: 50 },
                fillLinearGradientColorStops: [0, '#8ce85a', 1, '#3fa81f'],
                stroke: '#2f7f18', strokeWidth: 1, visible: false,
            });
            rec.soundText = _text({ x: px + 60, y: by + 206, width: 400, align: 'center', fontSize: 24, fontStyle: 'bold', fill: '#ffffff', text: 'Sound off', visible: false });
            rec.home.add(rec.soundBg, rec.soundText);

            // ── Alarms 页 ──
            rec.alarms = new Konva.Group({ visible: false });
            g.add(rec.alarms);
            rec.sumTitle = _text({ x: px + 14, y: by + 36, width: PW - 28, fontSize: 11.5, fontStyle: 'bold', fill: '#1d1d1d', text: '' });
            rec.alarms.add(rec.sumTitle);
            rec.alarmRows = [];
            for (let k = 0; k < 4; k++) {
                const ry = by + 58 + k * 26;
                const bg = _rect({ x: px + 14, y: ry, width: PW - 28, height: 24, fill: k % 2 ? '#f7f8f9' : '#ffffff', stroke: '#dfe3e5', strokeWidth: 0.6 });
                const tx = _text({ x: px + 20, y: ry + 5, width: PW - 140, fontSize: 11.5, fill: '#1d1d1d', text: '' });
                const stx = _text({ x: px + PW - 120, y: ry + 5, width: 100, align: 'right', fontSize: 11.5, fill: '#5a6167', text: '' });
                rec.alarms.add(bg, tx, stx);
                rec.alarmRows.push({ bg, tx, stx });
            }
            rec.aBtn = {};
            [['up', 'Up', px + 20, 88], ['down', 'Down', px + 114, 88], ['select', 'Select', px + 208, 118], ['tag', 'Tag details', px + 332, 130]].forEach(([key, label, bx, bw]) => {
                rec.aBtn[key] = { bg: _rect({ x: bx, y: by + 176, width: bw, height: 40, fillLinearGradientStartPoint: { x: 0, y: 0 }, fillLinearGradientEndPoint: { x: 0, y: 40 }, fillLinearGradientColorStops: [0, '#fdfdfd', 1, '#dfe2e4'], stroke: '#8b9195', strokeWidth: 1, cornerRadius: 2 }),
                    tx: _text({ x: bx, y: by + 188, width: bw, align: 'center', fontSize: 13, fill: '#1d1d1d', text: label }) };
                rec.alarms.add(rec.aBtn[key].bg, rec.aBtn[key].tx);
            });

            // ── Settings 页 ──
            rec.settings = new Konva.Group({ visible: false });
            g.add(rec.settings);
            rec.sBtn = {};
            [['dim', 'Dimming', by + 36], ['test', 'System test', by + 76], ['config', 'Configuration', by + 116], ['about', 'About', by + 156]].forEach(([key, label, sy]) => {
                rec.sBtn[key] = { bg: _rect({ x: px + 14, y: sy, width: 170, height: 34, fillLinearGradientStartPoint: { x: 0, y: 0 }, fillLinearGradientEndPoint: { x: 0, y: 34 }, fillLinearGradientColorStops: [0, '#fdfdfd', 1, '#dfe2e4'], stroke: '#8b9195', strokeWidth: 1, cornerRadius: 2 }),
                    tx: _text({ x: px + 14, y: sy + 9, width: 170, align: 'center', fontSize: 12.5, fill: '#1d1d1d', text: label }) };
                rec.settings.add(rec.sBtn[key].bg, rec.sBtn[key].tx);
            });
            rec.backlightTitle = _text({ x: px + 250, y: by + 40, width: 240, align: 'center', fontSize: 15, fill: '#1d1d1d', text: 'Backlight' });
            rec.blBar = _rect({ x: px + 210, y: by + 68, width: 290, height: 6, fill: '#dfe3e5', stroke: '#c0c6c9', strokeWidth: 1 });
            rec.blKnob = _rect({ x: px + 222, y: by + 62, width: 8, height: 18, fill: '#ffffff', stroke: '#7a8288', strokeWidth: 1 });
            rec.dayBg = _rect({ x: px + 230, y: by + 88, width: 110, height: 34, fillLinearGradientStartPoint: { x: 0, y: 0 }, fillLinearGradientEndPoint: { x: 0, y: 34 }, fillLinearGradientColorStops: [0, '#fdfdfd', 1, '#dfe2e4'], stroke: '#8b9195', strokeWidth: 1, cornerRadius: 2 });
            rec.dayTx = _text({ x: px + 230, y: by + 97, width: 110, align: 'center', fontSize: 13, fill: '#1d1d1d', text: 'Day' });
            rec.nightBg = _rect({ x: px + 360, y: by + 88, width: 110, height: 34, fillLinearGradientStartPoint: { x: 0, y: 0 }, fillLinearGradientEndPoint: { x: 0, y: 34 }, fillLinearGradientColorStops: [0, '#fdfdfd', 1, '#dfe2e4'], stroke: '#8b9195', strokeWidth: 1, cornerRadius: 2 });
            rec.nightTx = _text({ x: px + 360, y: by + 97, width: 110, align: 'center', fontSize: 13, fill: '#1d1d1d', text: 'Night' });
            rec.ssBg = _rect({ x: px + 230, y: by + 138, width: 240, height: 34, fillLinearGradientStartPoint: { x: 0, y: 0 }, fillLinearGradientEndPoint: { x: 0, y: 34 }, fillLinearGradientColorStops: [0, '#fdfdfd', 1, '#dfe2e4'], stroke: '#8b9195', strokeWidth: 1, cornerRadius: 2 });
            rec.ssTx = _text({ x: px + 230, y: by + 147, width: 240, align: 'center', fontSize: 12.5, fill: '#1d1d1d', text: 'Night Screensaver' });
            rec.disBg = _rect({ x: px + 230, y: by + 178, width: 110, height: 34, fillLinearGradientStartPoint: { x: 0, y: 0 }, fillLinearGradientEndPoint: { x: 0, y: 34 }, fillLinearGradientColorStops: [0, '#fdfdfd', 1, '#dfe2e4'], stroke: '#8b9195', strokeWidth: 1, cornerRadius: 2 });
            rec.disTx = _text({ x: px + 230, y: by + 187, width: 110, align: 'center', fontSize: 13, fill: '#1d1d1d', text: 'Disable' });
            rec.enBg = _rect({ x: px + 360, y: by + 178, width: 110, height: 34, fillLinearGradientStartPoint: { x: 0, y: 0 }, fillLinearGradientEndPoint: { x: 0, y: 34 }, fillLinearGradientColorStops: [0, '#fdfdfd', 1, '#dfe2e4'], stroke: '#8b9195', strokeWidth: 1, cornerRadius: 2 });
            rec.enTx = _text({ x: px + 360, y: by + 187, width: 110, align: 'center', fontSize: 13, fill: '#1d1d1d', text: 'Enable' });
            rec.settings.add(rec.backlightTitle, rec.blBar, rec.blKnob, rec.dayBg, rec.dayTx, rec.nightBg, rec.nightTx, rec.ssBg, rec.ssTx, rec.disBg, rec.disTx, rec.enBg, rec.enTx);

            // ── 底部报警类别标签（值班面板）──
            rec.groupLabels = [];
            rec.groupBgs = [];
            GROUP_TAGS.forEach(([name], gi) => {
                const gx = px + 4 + gi * 62;
                const bg = _rect({ x: gx, y: by + 318, width: 61, height: 34, fill: '#f2f3f4', stroke: '#a8aeb2', strokeWidth: 1, visible: false });
                const tx = _text({ x: gx, y: by + 328, width: 61, align: 'center', fontSize: 10.5, fontStyle: 'bold', fill: '#333333', text: name, visible: false });
                g.add(bg, tx);
                rec.groupBgs.push(bg);
                rec.groupLabels.push(tx);
            });

            this._st[st.id] = rec;
        });
    }

    _bindInteraction() {
        STATIONS.forEach((st, i) => {
            const { x: px, y: py } = this._pos(i);
            const by = py + BODY_Y;

            // 状态栏：主页 / Alarms / Settings
            const tabs = [
                ['home', px + 313, 62],
                ['alarms', px + 377, 62],
                ['settings', px + 441, 58],
            ];
            tabs.forEach(([page, tx, tw]) => {
                const hit = this.addClickablePart(`${st.id}-${page}`, tx, by + 4, tw, 22);
                hit.on('click', () => { this._page[st.id] = page; this._updateDynamic(); });
            });

            // Home 页专属热区（切到 Alarms / Settings 时整组隐藏，避免热区悬停块与本页部件不重合）
            const rec = this._st[st.id];
            const homeHits = [];

            // 扬声器：呼叫中＝应答；报警中＝本面板消音
            const buzzHit = this.addClickablePart(`${st.id}-buzz`, px + 96, by + 4, 32, 22);
            buzzHit.on('click', () => this._pressBuzz(st.id));
            rec.buzzHit = buzzHit.getParent();
            homeHits.push(rec.buzzHit);

            // Sound off（Home 页）与别名 <岗位>-ack
            const sHit = this.addClickablePart(`${st.id}-soundoff`, px + 60, by + 192, 400, 50);
            sHit.on('click', () => this._soundOff(st.id));
            if (!this._parts) this._parts = {};
            this._parts[`${st.id}-ack`] = this._parts[`${st.id}-soundoff`];
            rec.soundHit = sHit.getParent();
            homeHits.push(rec.soundHit);

            // 中部不再设大热区（值班交接统一在值班呼叫对话框完成）

            // 驾驶台：On Watch（BRIDGE / ECR）与呼叫按钮
            if (st.bridge) {
                const hb = this.addClickablePart('bridge-watch-bridge', px + 22, by + 66, 190, 42);
                hb.on('click', () => { this.model.setWatch('BRIDGE'); this._updateDynamic(); });
                const he = this.addClickablePart('bridge-watch-ecr', px + 232, by + 66, 190, 42);
                he.on('click', () => { this.model.setWatch('ECR'); this._updateDynamic(); });
                const ca = this.addClickablePart('bridge-call-all', px + 192, by + 216, 208, 34);
                ca.on('click', () => this.model.callAll());
                const cd = this.addClickablePart('bridge-call-duty', px + 192, by + 256, 208, 34);
                cd.on('click', () => this.model.callDuty());
                rec.watchHits = [hb.getParent(), he.getParent()];
                rec.callHits = [ca.getParent(), cd.getParent()];
                homeHits.push(hb.getParent(), he.getParent(), ca.getParent(), cd.getParent());
            }

            rec.homeHits = homeHits;

            // Alarms 页的 Up / Down / Select / Tag details 与 Settings 页一样，
            // 只做静态显示，不设可点击热区（按用户要求删除这些无明确用途的小热区）
        });
    }

    // ═══════════════════════════════════════════════════════
    //  操作
    // ═══════════════════════════════════════════════════════
    _pressBuzz(stationId) {
        const state = this.model.stationState(stationId);
        if (state.calling) this.model.acceptCall();
        else this.model.extAck(stationId);
        this._updateDynamic();
    }

    _soundOff(stationId) {
        this.model.extAck(stationId);
        this._updateDynamic();
    }

    _cycleVolume() { this._volume = (this._volume + 1) % 3; }

    // ═══════════════════════════════════════════════════════
    //  每帧刷新
    // ═══════════════════════════════════════════════════════
    tick(dt) {
        this._updateDynamic();
        this.markDirty();
        this._refreshIfDirty();
    }

    /** 本面板需要显示的报警类别（最多 4 行） */
    _alarmGroupNames() {
        const M = this.model;
        const has = (gks) => M.alarms.some(a => gks.includes(a.group));
        const hasSafety = (type) => M.alarms.some(a => ((M.tag(a.tagId) || {}).safety === type));
        const out = [];
        if (hasSafety('SLD')) out.push('M/E SLD');
        if (hasSafety('SHD')) out.push('M/E SHD');
        if (has(['FIRE'])) out.push('FIRE ALARMS');
        if (has(['MISC'])) out.push('BILGE');
        if (has(['AUX-BOILER'])) out.push('AUX BOILERS');
        if (has(['ME-GEN', 'ME-CFW', 'ME-PCOOL', 'ME-CSW', 'ME-LO', 'ME-FO', 'ME-EXH', 'ME-AIR'])) out.push('M/E MISC');
        if (has(['DG1', 'DG2', 'DG3', 'POWER', 'AUX-MACH', 'IGS', 'HOUR', 'TANK'])) out.push('MISCELLANEOUS');
        return out.slice(0, 4);
    }

    _updateDynamic() {
        const M = this.model;
        if (!M) return;
        const now = new Date();
        const hhmmss = [now.getHours(), now.getMinutes(), now.getSeconds()]
            .map(n => String(n).padStart(2, '0')).join(':');
        const blink = Math.floor(M.t * 2) % 2 === 0;
        const stamp = `${DAYS[now.getDay()]} ${MONTHS[now.getMonth()]} ${now.getDate()} ${hhmmss} ${now.getFullYear()}`;

        STATIONS.forEach((st) => {
            const rec = this._st[st.id];
            if (!rec) return;
            const state = M.stationState(st.id);
            const page = this._page[st.id] || 'home';

            rec.clock.text(hhmmss);

            // 状态栏按钮：当前页变绿
            rec.tabBtns.forEach(t => {
                const on = t.id === page;
                t.bg.fill(on ? C_GREEN : '#e9ecee');
                t.bg.stroke(on ? '#2f8f2f' : '#7a8288');
                t.tx.fill(on ? '#ffffff' : '#1d1d1d');
                t.tx.fontStyle(on ? 'bold' : 'normal');
            });

            // 扬声器：呼叫中或报警响铃时闪烁；静音后消失
            // 失职（REPEAT）报警：驾驶台与轮机长面板的扬声器与 REPEAT 一起闪烁；
            // 按下扬声器＝消声（扬声器消失，REPEAT 仍保留到主站 ACK 才消失）
            const repeatBuzz = state.repeat && (st.id === 'bridge' || st.id === 'chief');
            const ring = state.calling || state.buzz || repeatBuzz;
            const showBuzz = ring && !state.muted;
            rec.buzzBg.visible(showBuzz);
            rec.buzzIcon.visible(showBuzz);
            if (showBuzz) rec.buzzBg.fill(blink ? C_GREEN : C_GREEN_LT);

            // REPEAT（驾驶台 / 轮机长）：常显，底色在红 / 亮红之间闪烁（与扬声器同一相位）
            // DEADMAN（轮机员安全系统）：驾驶台 / 轮机长面板无条件显示，只能由安全系统复位按钮清除
            const showDead = !!state.deadman && (st.id === 'bridge' || st.id === 'chief');
            const showRepeat = (state.repeat || showDead) && (st.id === 'bridge' || st.id === 'chief');
            rec.repeatBg.visible(showRepeat);
            rec.repeatText.visible(showRepeat);
            if (showRepeat) {
                rec.repeatText.text(showDead ? 'DEADMAN' : 'REPEAT');
                rec.repeatBg.fill(blink ? C_RED : '#ff5a5a');
            }

            // 页面显隐（图形与热区一起切换，保证热区只覆盖本页部件）
            rec.home.visible(page === 'home');
            rec.alarms.visible(page === 'alarms');
            rec.settings.visible(page === 'settings');
            if (rec.homeHits) rec.homeHits.forEach(n => n && n.visible(page === 'home'));
            // 热区与部件严格重合：部件隐藏时热区一并隐藏
            if (rec.buzzHit) rec.buzzHit.visible(page === 'home' && showBuzz);
            if (rec.soundHit) rec.soundHit.visible(page === 'home' && rec.soundBg.visible());
            if (rec.watchHits) rec.watchHits.forEach(n => n && n.visible(page === 'home' && rec.onWatchTitle.visible()));
            if (rec.callHits) rec.callHits.forEach(n => n && n.visible(page === 'home' && rec.callAllBg.visible()));

            // ── Home 页 ──
            if (page === 'home') {
                const names = this._alarmGroupNames();
                // 红色报警区 + Sound off 只出现在"值班轮机员"面板上（驾驶台面板永远不出现）
                const ringing = state.unack.length > 0 && !state.muted;
                const showAlarmArea = !st.bridge && state.duty && ringing && names.length > 0;

                rec.alarmBg.visible(showAlarmArea);
                rec.alarmLines.forEach((t, k) => {
                    const txt = showAlarmArea ? (names[k] || '') : '';
                    t.text(txt);
                    t.visible(!!txt);
                });
                rec.soundBg.visible(showAlarmArea);
                rec.soundText.visible(showAlarmArea);

                const showRole = !showAlarmArea;
                rec.dutyTitle.visible(showRole);
                rec.dutyLine.visible(showRole);
                rec.roleText.visible(showRole);
                // 值班岗位名：只显示"当班轮机员"；未指定值班时整块留空
                // Duty 标题/线位置：驾驶台在 On Watch 之下（by+122），其他面板与 On Watch 对齐（by+38）
                const dutyY = st.bridge ? 122 : 38;
                rec.dutyTitle.y(rec.by + dutyY);
                rec.dutyLine.points([rec.px + 14, rec.by + dutyY + 18, rec.px + PW - 14, rec.by + dutyY + 18]);

                // 交接中（待接班者已应答）同时显示两个人：原值班者 / 接班者
                const dutyNames = [];
                if (M.dutyPanel) dutyNames.push(ROLE_EN[M.dutyPanel] || '');
                if (M.pendingDuty && M.pendingDuty !== M.dutyPanel) dutyNames.push(ROLE_EN[M.pendingDuty] || '');
                // 两个人值班时上下两行显示（原值班者在上、接班者在下）
                const dutyName = dutyNames.join('\n');
                const two = dutyNames.length > 1;
                rec.roleText.text(dutyName);
                rec.roleText.lineHeight(two ? 1.15 : 1);
                rec.roleText.visible(showRole && !!dutyName);
                if (st.bridge) {
                    // 驾驶台：岗位名左对齐、与呼叫按钮同行
                    rec.roleText.x(rec.px + 14);
                    rec.roleText.y(rec.by + (two ? 150 : 152));
                    rec.roleText.width(210);
                    rec.roleText.fontSize(two ? 22 : 26);
                    rec.roleText.align('left');
                } else {
                    rec.roleText.x(rec.px + 10);
                    rec.roleText.y(rec.by + (two ? 142 : 150));
                    rec.roleText.width(PW - 20);
                    rec.roleText.fontSize(two ? 30 : 34);
                    rec.roleText.align('center');
                }

                // On Watch 与 Call Engineer 只有驾驶台面板才有；
                // 轮机长 / 大管轮 / 二管轮 / 三管轮 / 电机员面板只有 Duty
                if (st.bridge) {
                    rec.onWatchTitle.visible(showRole);
                    rec.onWatchLine.visible(showRole);
                    ['BRIDGE', 'ECR'].forEach(pos => {
                        const on = M.watch === pos;
                        rec.watchBgs[pos].visible(showRole);
                        rec.watchTexts[pos].visible(showRole);
                        rec.watchBgs[pos].fill(on ? C_GREEN : '#ffffff');
                        rec.watchBgs[pos].stroke(on ? '#2f8f2f' : '#7f7f7f');
                        rec.watchTexts[pos].fill(on ? '#ffffff' : '#1d1d1d');
                    });
                    rec.callAllBg.visible(showRole);
                    rec.callAllTx.visible(showRole);
                    rec.callDutyBg.visible(showRole);
                    rec.callDutyTx.visible(showRole);
                } else {
                    rec.onWatchTitle.visible(false);
                    rec.onWatchLine.visible(false);
                    ['BRIDGE', 'ECR'].forEach(pos => {
                        rec.watchBgs[pos].visible(false);
                        rec.watchTexts[pos].visible(false);
                    });
                    rec.callAllBg.visible(false);
                    rec.callAllTx.visible(false);
                    rec.callDutyBg.visible(false);
                    rec.callDutyTx.visible(false);
                }
            }

            // ── Alarms 页 ──
            if (page === 'alarms') {
                rec.sumTitle.text(`${stamp} ALARM SUMMARY`);
                const list = M.alarms.slice().sort((a, b) => b.seq - a.seq).slice(0, 4);
                rec.alarmRows.forEach((row, k) => {
                    const al = list[k];
                    if (!al) {
                        row.bg.visible(false); row.tx.visible(false); row.stx.visible(false);
                        return;
                    }
                    row.bg.visible(true);
                    row.tx.visible(true);
                    row.stx.visible(true);
                    row.tx.text(`${String(new Date(al.ts).getDate()).padStart(2, '0')} ${al.t}  ${al.en || al.name}`);
                    row.stx.text(al.state === 'UNACK' ? 'ALARM' : (al.state === 'RTN' ? 'RETURNED' : 'ACK'));
                });
            }

            // ── Settings 页：固定显示（Dimming 绿，其余白；不响应任何点击） ──
            if (page === 'settings') {
                rec.sBtn.dim.bg.fill(C_GREEN);
                rec.sBtn.dim.bg.stroke('#2f8f2f');
                rec.sBtn.dim.tx.fill('#ffffff');
                ['day', 'night'].forEach(k => {
                    rec[k + 'Bg'].fill('#fdfdfd');
                    rec[k + 'Tx'].fill('#1d1d1d');
                });
                rec.disBg.fill('#fdfdfd');
                rec.disTx.fill('#1d1d1d');
                rec.enBg.fill('#fdfdfd');
                rec.enTx.fill('#1d1d1d');
                rec.blKnob.x(rec.px + 222);
            }

            // ── 底部报警类别标签：Home 页只有值班轮机员面板显示；Alarms 页所有面板都显示 ──
            const showGroups = (page === 'home' && state.duty) || (page === 'alarms');
            const matchPred = (match) => (a) => {
                if (match === 'SHD') return ((M.tag(a.tagId) || {}).safety === 'SHD');
                if (match === 'SLD') return ((M.tag(a.tagId) || {}).safety === 'SLD');
                return match.includes(a.group);
            };
            GROUP_TAGS.forEach(([, match], gi) => {
                const pred = matchPred(match);
                const on = M.alarms.some(pred);                                            // 该类有报警
                const unack = M.alarms.some(a => pred(a) && (a.state === 'UNACK' || a.state === 'RTN')); // 其中未确认
                rec.groupBgs[gi].visible(showGroups);
                rec.groupLabels[gi].visible(showGroups);
                if (showGroups) {
                    // 未确认 → 红色 / 亮红闪烁；已确认 → 红色常亮；无报警 → 灰
                    rec.groupBgs[gi].fill(on ? (unack ? (blink ? C_RED : '#ff5a5a') : C_RED) : '#f2f3f4');
                    rec.groupBgs[gi].stroke(on ? '#8a0b0b' : '#a8aeb2');
                    rec.groupLabels[gi].fill(on ? '#ffffff' : '#333333');
                }
            });
        });
    }
}
