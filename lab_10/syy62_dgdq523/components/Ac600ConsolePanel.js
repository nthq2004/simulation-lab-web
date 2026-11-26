import Konva from 'konva';
import { BaseComponent } from './BaseComponent.js';
import { ac600Of, CONTROL_POS, TELEGRAPH, posToRpm } from '../tools/AC600Solver.js';

/**
 * Ac600ConsolePanel — 主机遥控系统 AC 600 操作面板（驾控台 / 集控台）
 * ═══════════════════════════════════════════════════════════════
 *  同一套版式两种变体：
 *    variant='bridge' → 页 1「驾控台面板」（Bridge）
 *    variant='ecr'    → 页 2「集控台面板」（ECR）
 *
 *  左侧：AC 600 操作站
 *    · 状态条：At Sea | Economy Mode | ECR | Eng. Ready | System Ready
 *    · M/E RPM 半圆表（-120…120，0 在正上方）、START AIR PRESSURE 表（0…40 bar，0~10 红区）
 *    · M/E LOAD 表（0…100 %）、SETP / LEVER 立式柱状指示
 *    · ME Run Hour / Rev 文本
 *    · 按钮排：Alarms / Limiters / Control Pos. / Misc Menu / Safety System /
 *              Engine State / B&W Modes / Param. Change / Home
 *    · 左侧圆钮：Cancel SHD / Cancel SLD / Cancel Limits
 *    · 底部：消音按钮（圆环 + 静音符号）、方形位置标注牌（BRIDGE / ECR）、ACK 确认
 *  右侧：车钟单元
 *    · NAVIGATION FULL 车钟刻度板（NAV FULL … EM'CY ASTERN 共 11 档）
 *    · RPM CMD 数字 + 上/下箭头；Bridge / ECR / Local 位置灯；At Sea / Standby / FWE 工况灯
 *    · 底部警报器 + EM.STOP 应急停车按钮
 *
 *  部件 id（工作流 subTarget / op.part）：
 *    cancel-shd cancel-sld cancel-limits
 *    btn-alarms btn-limiters btn-cpos btn-misc btn-safety btn-estate btn-bwm btn-param btn-home
 *    ack silence alarm-bell
 *    pos-bridge pos-ecr pos-local   mode-sea mode-standby mode-fwe
 *    lever-up lever-down  em-stop-cover em-stop（自锁，需先开玻璃盖）  tel-0 … tel-10
 * ═══════════════════════════════════════════════════════════════
 */

const W = 1518, H = 800;   // 右缘与车钟机柜外框右缘严格对齐，无多余空白

const _rect = (o) => new Konva.Rect(Object.assign({ listening: false }, o));
const _text = (o) => new Konva.Text(Object.assign({ listening: false, fontFamily: 'Arial, Microsoft YaHei' }, o));
const _line = (o) => new Konva.Line(Object.assign({ listening: false }, o));
const _circle = (o) => new Konva.Circle(Object.assign({ listening: false }, o));

const C_BLUE = '#0b0b96';
const C_GREEN = '#00a019';
const C_RED = '#c40000';
const SAFETY_DELAY_ROWS = [
    { key: 'shd-thrust', kind: 'SHD', label: 'THRUST PAD HIGH-HIGH TEMP' },
    { key: 'shd-tclo',  kind: 'SHD', label: 'T/C LUB.OIL LOW-LOW PRESS' },
    { key: 'shd-jcw',   kind: 'SHD', label: 'J.C.F.W. INLET LOW PRESS' },
    { key: 'sld-lo-t',  kind: 'SLD', label: 'MAIN L.O.INLET TEMP HIGH' },
    { key: 'sld-cw-t',  kind: 'SLD', label: 'JACKET C.F.W. OUTLET TEMP HIGH' },
    { key: 'sld-mist',  kind: 'SLD', label: 'OIL MIST HIGH IN CRANKCASE' },
];

const C_YELLOW = '#ffee00';
const C_CYAN = '#6fd8ff';
const C_GREY_PLATE = '#c9ccce';

/** 统一布局（静态与动态共用，避免错位） */
const L = {
    body: { x: 16, y: 8, w: 1144, h: 784 },
    bezel: { x: 112, y: 22, w: 1048, h: 656 },
    blue: { x: 126, y: 36, w: 1020, h: 464 },
    segH: 34,
    rpm: { cx: 320, cy: 290, R: 138 },
    air: { cx: 680, cy: 222, R: 84 },
    load: { cx: 680, cy: 424, R: 84 },
    setp: { x: 930, y: 122, w: 56, h: 286 },
    lev: { x: 1046, y: 122, w: 56, h: 286 },
    alarmBox: { x: 126, y: 504, w: 1020, h: 78 },
    btns: { bandY: 586, bandH: 103, y1: 591, y2: 640, h: 43, w: 118, pad: 24, x: [150, 292, 434, 576, 718, 860, 1002] },
    tel: { x: 1172, y: 8, w: 340, h: 344, rowTop: 70, rowGap: 24 },
    dark: { x: 1172, y: 356, w: 340, h: 344 },
    cancelBtn: { x: 30, w: 74, y: [442, 532, 622] },   // 最下一个圆底距底板底部 20px，间距 90 不变
    bottomY: 740,
    emStop: { x: 1372 },
    buzzCol: 78,        // 蜂鸣器中心（相对 dark.x）
    arrowCol: 265,     // At Sea 灯列（相对 dark.x，与 EM.STOP 按钮中心对齐）
    arrowUpY: 44,
    arrowDownY: 100,
};

const TEL_ROWS = ['NAVIGATION FULL', 'FULL', 'HALF', 'SLOW', 'DEAD SLOW', 'STOP',
    'DEAD SLOW', 'SLOW', 'HALF', 'FULL', "EM'CY ASTERN"];

export class Ac600ConsolePanel extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.W = W;
        this.H = H;
        this.width = W;
        this.height = H;
        this.type = 'ac600_console';
        this.cache = 'fixed';

        this.variant = config.variant === 'bridge' ? 'bridge' : 'ecr';
        this.posKey = this.variant === 'bridge' ? CONTROL_POS.BRIDGE : CONTROL_POS.ECR;

        this.model = ac600Of(sys);
        this._gauges = {};

        this._menuPage = null;      // 当前打开的主菜单页（null = 主页）
        this._menuTab = 0;          // 二级页（软键）
        this._directPage = null;    // 无子菜单的直接页面（如 estate）
        this._menuHitIds = [];      // 页面软键热区 id
        this._safCancelled = {};    // Safety 页逐项越控标记（'shd:os' / 'sld:eicu-a' …）
        this._almState = {};        // 报警状态机：key → { seen, on, acked }
        this._cancel = { shd: false, sld: false, lim: false };   // 本面板三个 Cancel 按钮（各面板独立，不同步）
        this._safetyViewMode = 'all';  // Safety 页两种显示状态：全部 / 仅故障项

        this._initGroups();
        this._init();

        // 菜单按钮排层（主/二级菜单按钮动态绘制，覆盖静态底板；按钮 listening=false 不挡热区）
        this._bandGroup = new Konva.Group({ name: '_bandGroup' });
        this.group.add(this._bandGroup);

        // 菜单页面层（覆盖蓝色显示区，位于动态层之上）
        this._menuGroup = new Konva.Group({ name: '_menuGroup', visible: false });
        this.group.add(this._menuGroup);

        // 慢降预报警弹窗层（延时未到的"可取消"提示，覆盖液晶区）
        this._popupGroup = new Konva.Group({ name: '_popupGroup', visible: false });
        this.group.add(this._popupGroup);
        this._buildSldPopup();

        this._renderBand();

        this.config = { id: this.id, variant: this.variant };
    }

    /** 慢降预报警弹窗（照真机：红标题 SLOW DOWN ACTIVE + 灰底三行说明） */
    _buildSldPopup() {
        const g = this._popupGroup;
        const x = 296, y = 196, w = 566, h = 212, hh = 54;
        g.add(_rect({ x, y, width: w, height: h, fill: '#c9ccce', stroke: '#5f6669', strokeWidth: 2 }));
        g.add(_rect({ x, y, width: w, height: hh, fill: '#e01717', stroke: '#5f6669', strokeWidth: 2 }));
        g.add(_text({
            x, y: y + 13, width: w, align: 'center', fontSize: 24, fontStyle: 'bold',
            fill: '#ffffff', text: 'SLOW DOWN ACTIVE',
        }));
        g.add(_text({ x, y: y + hh + 12, width: w, align: 'center', fontSize: 22, fill: '#1b1f21', text: 'SLOWDOWN ALARM' }));
        g.add(_text({ x, y: y + hh + 46, width: w, align: 'center', fontSize: 22, fill: '#1b1f21', text: 'CANCELLABLE' }));
        g.add(_text({ x, y: y + h - 44, width: w, align: 'center', fontSize: 20, fill: '#1b1f21', text: 'Engine load will be reduced' }));
    }

    /** 本面板所有按钮按下均不弹提示文字（只靠指示灯与面板状态反馈） */
    _tip() { /* 面板式操作：不弹浮动提示 */ }

    _redraw() {
        if (this.sys && this.sys.requestRedraw) this.sys.requestRedraw();
    }

    _init() {
        this._drawStatic();
        this._createDynamic();
        this._bindInteraction();
        this._addDragPlate();
    }

    _addDragPlate() {
        // 整块拖动热区：避开右上角车钟区域（车钟手柄改为可拖动，不再拖动整块面板）
        const telL = L.tel.x - 14, telR = L.tel.x + L.tel.w + 8;
        const plateL = new Konva.Rect({ x: 0, y: 0, width: telL, height: H, fill: 'rgba(0,0,0,0.001)', listening: true });
        const plateR = new Konva.Rect({ x: telR, y: 0, width: Math.max(0, W - telR), height: H, fill: 'rgba(0,0,0,0.001)', listening: true });
        this._interactGroup.add(plateL);
        this._interactGroup.add(plateR);
        plateL.moveToBottom();
        plateR.moveToBottom();
    }

    // ═══════════════════════════════════════════════════════
    //  静态图形
    // ═══════════════════════════════════════════════════════

    _staticGauge(s, o) {
        const { cx, cy, R, lo, hi, title, unit, labels = 5, redFrom = null, redTo = null } = o;
        s.add(_text({
            x: cx - 170, y: cy - R - 56, width: 340, align: 'center',
            fontSize: o.titleSize || 22, fontStyle: 'bold', fill: '#ffffff', text: title,
        }));

        const arc = (rot, ang, ri, ro, fill) => new Konva.Arc({
            x: cx, y: cy, innerRadius: ri, outerRadius: ro, angle: ang, rotation: rot, fill, listening: false,
        });
        const pctOf = (v) => (v - lo) / (hi - lo);

        s.add(arc(180, 180, R - 16, R, '#d7d7d7'));
        if (redFrom != null && redTo != null) {
            s.add(arc(180 + pctOf(redFrom) * 180, (pctOf(redTo) - pctOf(redFrom)) * 180, R - 16, R, C_RED));
        }
        const gFrom = o.greenFrom != null ? o.greenFrom : lo;
        const gTo = o.greenTo != null ? o.greenTo : hi;
        s.add(arc(180 + pctOf(gFrom) * 180, (pctOf(gTo) - pctOf(gFrom)) * 180, R - 16, R, C_GREEN));

        for (let i = 0; i <= 30; i++) {
            const a = Math.PI + (i / 30) * Math.PI;
            const major = i % 5 === 0;
            const r1 = R - 16 - (major ? 10 : 5);
            s.add(_line({
                points: [cx + Math.cos(a) * r1, cy + Math.sin(a) * r1, cx + Math.cos(a) * (R - 17), cy + Math.sin(a) * (R - 17)],
                stroke: '#ffffff', strokeWidth: major ? 1.6 : 1,
            }));
        }
        for (let i = 0; i < labels; i++) {
            const t = labels === 1 ? 0 : i / (labels - 1);
            const a = Math.PI + t * Math.PI;
            const rr = R + 14;
            const v = lo + (hi - lo) * t;
            s.add(_text({
                x: cx + Math.cos(a) * rr - 30, y: cy + Math.sin(a) * rr - 8, width: 60, align: 'center',
                fontSize: v === undefined ? 20 : (Math.abs(hi - lo) > 50 ? 20 : 18), fill: '#ffffff', text: `${Math.round(v)}`,
            }));
        }
        void unit;
    }

    _staticBar(s, b, title) {
        s.add(_text({ x: b.x - 20, y: b.y - 30, width: b.w + 40, align: 'center', fontSize: 17, fontStyle: 'bold', fill: '#ffffff', text: title }));
        s.add(_rect({ x: b.x, y: b.y, width: b.w, height: b.h * 0.5, fill: C_GREEN, stroke: '#ffffff', strokeWidth: 1 }));
        s.add(_rect({ x: b.x, y: b.y + b.h * 0.5, width: b.w, height: b.h * 0.5, fill: '#ffffff', stroke: '#ffffff', strokeWidth: 1 }));
        for (let i = 1; i < 10; i++) {
            const yy = b.y + (b.h / 10) * i;
            s.add(_line({ points: [b.x, yy, b.x + b.w, yy], stroke: C_BLUE, strokeWidth: 1.4 }));
        }
    }

    _buttonRow(s, x, y, w, h, label) {
        s.add(_rect({ x, y, width: w, height: h, fill: '#fdfdfd', stroke: '#8a9095', strokeWidth: 1.6, cornerRadius: 3 }));
        s.add(_rect({ x: x + 2, y: y + 2, width: w - 4, height: h - 5, fill: '#ffffff', stroke: '#c2c7ca', strokeWidth: 1, cornerRadius: 2 }));
        if (label) s.add(_text({ x, y: y + (h - 18) / 2 + 1, width: w, align: 'center', fontSize: 15.5, fill: '#1b1f21', text: label }));
    }

    _circleBtn(s, cx, cy, r, label, fs = 15) {
        // 外框更亮（白色）+ 线径 3（原 2 → +1）
        s.add(_circle({ x: cx, y: cy, radius: r, fill: '#3b3f42', stroke: '#ffffff', strokeWidth: 3 }));
        s.add(_circle({ x: cx, y: cy, radius: r - 5, fill: '#24282b', stroke: '#8d9498', strokeWidth: 1 }));
        s.add(_text({
            x: cx - r, y: cy - (label.split('\n').length * fs) / 2 - 1, width: r * 2, align: 'center',
            fontSize: fs, fontStyle: 'bold', lineHeight: 1.1, fill: '#f2f5f6', text: label,
        }));
    }

    _drawStatic() {
        const s = this._staticGroup;

        // ── 机身 / 屏框 ──
        s.add(_rect({ x: 0, y: 0, width: W, height: H, fill: '#eff0f1' }));
        s.add(_rect({ x: L.body.x, y: L.body.y, width: L.body.w, height: L.body.h, fill: '#4b4f53', stroke: '#2b2e31', strokeWidth: 2, cornerRadius: 10 }));
        // 三个越控按钮的黑色底板：与屏框（液晶面板外框）上下边界对齐，右缘贴屏框左边
        s.add(_rect({ x: 22, y: L.bezel.y, width: L.bezel.x - 22, height: L.bezel.h, fill: '#2c2f32', stroke: '#1c1f21', strokeWidth: 1.5, cornerRadius: 4 }));
        s.add(_rect({ x: L.bezel.x, y: L.bezel.y, width: L.bezel.w, height: L.bezel.h, fill: '#0a0a0a', stroke: '#000000', strokeWidth: 2, cornerRadius: 3 }));
        s.add(_rect({ x: L.blue.x, y: L.blue.y, width: L.blue.w, height: L.blue.h, fill: C_BLUE }));

        // ── 状态条 ──
        const segW = L.blue.w / 5;
        ['At Sea', 'Economy Mode', 'ECR', 'Eng. Ready', 'System Ready'].forEach((t, i) => {
            s.add(_rect({
                x: L.blue.x + i * segW, y: L.blue.y, width: segW, height: L.segH,
                fill: i === 2 ? '#101080' : '#0a6b16', stroke: '#0a0a66', strokeWidth: 1,
            }));
        });

        // ── 仪表 ──
        this._staticGauge(s, { cx: L.rpm.cx, cy: L.rpm.cy, R: L.rpm.R, lo: -120, hi: 120, title: 'M/E RPM', labels: 5, greenFrom: 0, greenTo: 120, titleSize: 24 });
        this._staticGauge(s, { cx: L.air.cx, cy: L.air.cy, R: L.air.R, lo: 0, hi: 40, title: 'START AIR PRESSURE', labels: 5, redFrom: 0, redTo: 10, greenFrom: 10, greenTo: 40, titleSize: 20 });
        this._staticGauge(s, { cx: L.load.cx, cy: L.load.cy, R: L.load.R, lo: 0, hi: 100, title: 'M/E LOAD', labels: 5, greenFrom: 0, greenTo: 100, titleSize: 20 });

        // ── SETP / LEVER 柱 ──
        this._staticBar(s, L.setp, 'SETP');
        this._staticBar(s, L.lev, 'LEVER');
        // 两柱之间的刻度数字：居中于 SETP 与 LEVER 之间，按 10 等分与档位分格线严格对齐
        const numX = L.setp.x + L.setp.w;                  // 数字区左缘 = SETP 柱右缘
        const numW = L.lev.x - numX;                       // 数字区宽 = 两柱间距
        ['120', '96', '72', '48', '24', '0', '-24', '-48', '-72', '-96', '-120'].forEach((t, i) => {
            const f = i / 10;                              // 11 个刻度对应 10 格
            s.add(_text({
                x: numX, y: L.setp.y + L.setp.h * f - 9.5, width: numW, align: 'center',
                fontSize: 15.5, fill: '#ffffff', text: t,
            }));
        });

        // ── 灰色报警信息框（ME Run Hour 下方：显示主机遥控系统报警信息）──
        const ab = L.alarmBox;
        s.add(_rect({ x: ab.x, y: ab.y, width: ab.w, height: ab.h, fill: '#a9a8a4', stroke: '#6f6e6a', strokeWidth: 1.5 }));
        s.add(_rect({ x: ab.x + 6, y: ab.y + 6, width: ab.w - 12, height: ab.h - 12, fill: '#b6b5b1', stroke: '#87867f', strokeWidth: 1 }));

        // ── 按钮排底板（7 列 × 2 行；按钮本体由 _renderBand() 动态绘制，主/二级菜单共用同一网格） ──
        s.add(_rect({ x: L.blue.x, y: L.btns.bandY, width: L.blue.w, height: L.btns.bandH, fill: '#eceef0', stroke: '#8d9498', strokeWidth: 1 }));

        // ── 左侧 Cancel 圆钮 ──
        this._circleBtn(s, 65, L.cancelBtn.y[0], 36, 'Cancel\nSHD');
        this._circleBtn(s, 65, L.cancelBtn.y[1], 36, 'Cancel\nSLD');
        this._circleBtn(s, 65, L.cancelBtn.y[2], 36, 'Cancel\nLimits');

        // ── 底部：消音（左）／方形位置标注牌（中）／ACK（右），y = L.bottomY ──
        const by = L.bottomY;
        const ink = '#f2f5f6';

        // 左：消音按钮 —— 白色圆环 + 空心喇叭 + 斜杠（静音符号）
        s.add(_circle({ x: 526, y: by, radius: 34, fill: 'rgba(0,0,0,0)', stroke: ink, strokeWidth: 3 }));
        s.add(_line({
            points: [508, by - 7, 518, by - 7, 529, by - 17, 529, by + 17, 518, by + 7, 508, by + 7],
            closed: true, fill: 'rgba(0,0,0,0)', stroke: ink, strokeWidth: 2.2, lineJoin: 'round',
        }));
        s.add(new Konva.Arc({ x: 530, y: by, innerRadius: 9, outerRadius: 12, angle: 70, rotation: -35, fill: 'rgba(0,0,0,0)', stroke: ink, strokeWidth: 2, listening: false }));
        s.add(new Konva.Arc({ x: 530, y: by, innerRadius: 15, outerRadius: 18, angle: 70, rotation: -35, fill: 'rgba(0,0,0,0)', stroke: ink, strokeWidth: 2, listening: false }));
        s.add(_line({ points: [505, by - 21, 547, by + 21], stroke: ink, strokeWidth: 3, lineCap: 'round' }));

        // 中：方形标注牌（驾控台固定 BRIDGE、集控室固定 ECR）
        s.add(_rect({
            x: 578, y: by - 25, width: 116, height: 50, fill: '#161819',
            stroke: ink, strokeWidth: 2, cornerRadius: 4,
        }));
        s.add(_rect({ x: 582, y: by - 21, width: 108, height: 42, fill: 'rgba(0,0,0,0)', stroke: '#5c6366', strokeWidth: 1, cornerRadius: 3 }));
        s.add(_text({
            x: 578, y: by - 13, width: 116, align: 'center', fontSize: 24, fontStyle: 'bold',
            letterSpacing: 2, fill: '#ffe14d', text: this.variant === 'bridge' ? 'BRIDGE' : 'ECR',
        }));

        // 右：ACK —— 白色圆环 + 文字
        s.add(_circle({ x: 746, y: by, radius: 34, fill: 'rgba(0,0,0,0)', stroke: ink, strokeWidth: 3 }));
        s.add(_text({ x: 706, y: by - 10, width: 80, align: 'center', fontSize: 20, fill: '#ffffff', text: 'ACK' }));

        // ── 右侧车钟机柜 ──
        s.add(_rect({ x: L.tel.x - 6, y: 4, width: L.tel.w + 12, height: 792, fill: '#808184', stroke: '#4a4a4d', strokeWidth: 2, cornerRadius: 6 }));
        // ── 车钟面板（抽屉式：金属外框 + 左右导轨 + 11 档刻度）──
        const tx = L.tel.x, ty = L.tel.y, tw = L.tel.w, th = L.tel.h;
        const px0 = tx + 16, px1 = tx + tw - 16;              // 面板内缘
        s.add(_rect({ x: px0, y: ty, width: px1 - px0, height: th, fill: '#2a2c30', stroke: '#101214', strokeWidth: 2, cornerRadius: 8 }));
        // 内部暗色刻度板（上亮下暗的渐变用两块叠加模拟）
        const inX = px0 + 26, inW = (px1 - px0) - 52;
        s.add(_rect({ x: inX, y: ty + 8, width: inW, height: th - 16, fill: '#3b3f45', stroke: '#1a1c1f', strokeWidth: 1 }));
        s.add(_rect({ x: inX, y: ty + 8, width: inW, height: (th - 16) * 0.45, fill: '#4a4f56', opacity: 0.55 }));
        // 左右金属导轨
        s.add(_rect({ x: px0 + 4, y: ty + 6, width: 22, height: th - 12, fill: '#8b9096', stroke: '#5a6066', strokeWidth: 1.2, cornerRadius: 3 }));
        s.add(_rect({ x: px1 - 26, y: ty + 6, width: 22, height: th - 12, fill: '#8b9096', stroke: '#5a6066', strokeWidth: 1.2, cornerRadius: 3 }));
        // 顶部金属罩（滑条滑到顶时在此位置）
        s.add(_rect({ x: px0 - 4, y: ty - 6, width: (px1 - px0) + 8, height: 22, fill: '#9aa0a6', stroke: '#5a6066', strokeWidth: 1.5, cornerRadius: 4 }));
        s.add(_rect({ x: px0 - 4, y: ty + 4, width: (px1 - px0) + 8, height: 12, fill: '#c3c8cc', opacity: 0.6, cornerRadius: 3 }));

        // 11 行刻度线（左右短横线）
        TEL_ROWS.forEach((t, i) => {
            const y = L.tel.rowTop + i * L.tel.rowGap;
            s.add(_line({ points: [inX + 14, y, inX + 46, y], stroke: '#9aa1a8', strokeWidth: 2 }));
            s.add(_line({ points: [inX + inW - 46, y, inX + inW - 14, y], stroke: '#9aa1a8', strokeWidth: 2 }));
        });

        // 主操纵面板（深色）
        s.add(_rect({ x: L.dark.x, y: L.dark.y, width: L.dark.w, height: L.dark.h, fill: '#23262a', stroke: '#101214', strokeWidth: 2 }));

        // ── 底部左：蜂鸣器（红色警报蜂鸣器）──
        const bx = L.dark.x + 78, byy = 738;
        s.add(_circle({ x: bx, y: byy, radius: 34, fill: '#5e070d', stroke: '#3a0307', strokeWidth: 2 }));
        s.add(_circle({ x: bx, y: byy, radius: 28, fill: '#b3131f', stroke: '#6d060d', strokeWidth: 2 }));
        // 同心环（蜂鸣器振膜）
        [23, 18, 13].forEach((r) => {
            s.add(_circle({ x: bx, y: byy, radius: r, fill: 'rgba(0,0,0,0)', stroke: '#7a0a11', strokeWidth: 1.6 }));
        });
        // 辐射细纹
        for (let i = 0; i < 20; i++) {
            const a = (i / 20) * Math.PI * 2;
            s.add(_line({
                points: [bx + Math.cos(a) * 9, byy + Math.sin(a) * 9, bx + Math.cos(a) * 22, byy + Math.sin(a) * 22],
                stroke: '#7a0a11', strokeWidth: 1,
            }));
        }
        s.add(_circle({ x: bx, y: byy, radius: 6, fill: '#3a0307' }));

        // ── 底部右：EM.STOP 按钮（自锁）+ 玻璃盖 ──
        const ex = L.emStop.x, ey = 706;
        s.add(_rect({ x: ex, y: ey, width: 130, height: 62, fill: '#b9bdc0', stroke: '#6d7478', strokeWidth: 2, cornerRadius: 3 }));
        s.add(_rect({ x: ex + 8, y: ey + 8, width: 114, height: 46, fill: '#dba7ab', stroke: '#8d3a41', strokeWidth: 1.5, cornerRadius: 2 }));
        s.add(_text({ x: ex + 8, y: ey + 20, width: 114, align: 'center', fontSize: 17, fontStyle: 'bold', fill: '#7a1a22', text: 'EM.STOP' }));
        // 玻璃盖铰链底座（上沿）
        s.add(_rect({ x: ex + 4, y: ey - 12, width: 122, height: 8, fill: '#8d9498', stroke: '#5b6266', strokeWidth: 1 }));
    }

    // ═══════════════════════════════════════════════════════
    //  动态图形
    // ═══════════════════════════════════════════════════════

    _mkNeedle(cx, cy, R, w) {
        const g = new Konva.Group({ x: cx, y: cy, rotation: 180, listening: false });
        g.add(new Konva.Line({ points: [0, 0, R, 0], stroke: '#4a3c00', strokeWidth: w + 3, lineCap: 'round', listening: false }));
        g.add(new Konva.Line({ points: [0, 0, R, 0], stroke: C_YELLOW, strokeWidth: w, lineCap: 'round', listening: false }));
        g.add(new Konva.Circle({ x: 0, y: 0, radius: w * 0.85, fill: '#20242a', stroke: '#d8dcdd', strokeWidth: 1.2, listening: false }));
        this._dynamicGroup.add(g);
        return g;
    }

    _createDynamic() {
        const d = this._dynamicGroup;

        // 状态条高亮 + 文字
        this._segHi = [];
        this._segText = [];
        const segW = L.blue.w / 5;
        ['At Sea', 'Economy Mode', 'ECR', 'Eng. Ready', 'System Ready'].forEach((t, i) => {
            const hi = _rect({ x: L.blue.x + i * segW, y: L.blue.y, width: segW, height: L.segH, fill: '#28c72a', opacity: 0 });
            d.add(hi);
            this._segHi.push(hi);
            const txt = _text({ x: L.blue.x + i * segW, y: L.blue.y + 5, width: segW, align: 'center', fontSize: 17, fill: '#ffffff', text: t });
            d.add(txt);
            this._segText.push(txt);
        });

        // 仪表
        this._gauges.rpm = {
            needle: this._mkNeedle(L.rpm.cx, L.rpm.cy, L.rpm.R - 16, 8),
            value: _text({ x: L.rpm.cx - 170, y: L.rpm.cy + 22, width: 340, align: 'center', fontSize: 26, fill: C_YELLOW, text: '68.0 RPM' }),
            state: _text({ x: L.rpm.cx - 170, y: L.rpm.cy + 62, width: 340, align: 'center', fontSize: 28, fontStyle: 'bold', fill: C_YELLOW, text: 'Running' }),
            reason: _text({ x: L.rpm.cx - 170, y: L.rpm.cy + 100, width: 340, align: 'center', fontSize: 26, fontStyle: 'bold', fill: '#f03c3c', text: '' }),
        };
        d.add(this._gauges.rpm.value, this._gauges.rpm.state, this._gauges.rpm.reason);

        this._gauges.air = {
            needle: this._mkNeedle(L.air.cx, L.air.cy, L.air.R - 14, 6),
            value: _text({ x: L.air.cx - 100, y: L.air.cy + 14, width: 200, align: 'center', fontSize: 21, fill: C_YELLOW, text: '28.3 bar' }),
        };
        d.add(this._gauges.air.value);

        this._gauges.load = {
            needle: this._mkNeedle(L.load.cx, L.load.cy, L.load.R - 14, 6),
            value: _text({ x: L.load.cx - 100, y: L.load.cy + 34, width: 200, align: 'center', fontSize: 21, fill: C_YELLOW, text: '83.5 %' }),
        };
        d.add(this._gauges.load.value);

        // SETP / LEVER 三角指针
        // 黄色档位指示：尖端朝左，宽度与 SETP 柱等宽
        const mkTri = (x, w) => {
            const tri = new Konva.Line({
                points: [w, -10, w, 10, 0, 0], closed: true,
                fill: C_YELLOW, stroke: '#8a7d00', strokeWidth: 1, listening: false,
            });
            tri.x(x);
            d.add(tri);
            return tri;
        };
        this._setpTri = mkTri(L.setp.x, L.setp.w);
        this._leverTri = mkTri(L.lev.x, L.lev.w);
        this._setpVal = _text({ x: L.setp.x - 25, y: L.setp.y + L.setp.h + 22, width: 100, align: 'center', fontSize: 16, fill: C_YELLOW, text: '68.0 RPM' });
        // 正在执行的限制（SETP/LEVER 柱下方，居中原点）
        this._limiterTxt = _text({
            x: L.setp.x - 60, y: L.setp.y + L.setp.h + 52, width: 280, align: 'center',
            fontSize: 20, fill: C_YELLOW, text: '',
        });
        d.add(this._limiterTxt);
        this._leverVal = _text({ x: L.lev.x - 25, y: L.lev.y + L.lev.h + 22, width: 100, align: 'center', fontSize: 16, fill: C_YELLOW, text: '68.0 RPM' });
        d.add(this._setpVal, this._leverVal);

        this._runHour = _text({ x: 140, y: 468, width: 300, fontSize: 18, fill: C_YELLOW, text: 'ME Run Hour:1.4' });
        this._rev = _text({ x: 400, y: 468, width: 230, align: 'left', fontSize: 18, fill: C_YELLOW, text: 'Rev: 5306' });
        d.add(this._runHour, this._rev);

        // Cancel 越控灯
        this._cancelLamp = {
            shd: _circle({ x: 65 - 25, y: L.cancelBtn.y[0] - 25, radius: 7, fill: '#ffffff', stroke: '#8d9498', strokeWidth: 1 }),
            sld: _circle({ x: 65 - 25, y: L.cancelBtn.y[1] - 25, radius: 7, fill: '#ffffff', stroke: '#8d9498', strokeWidth: 1 }),
            lim: _circle({ x: 65 - 25, y: L.cancelBtn.y[2] - 25, radius: 7, fill: '#ffffff', stroke: '#8d9498', strokeWidth: 1 }),
        };
        Object.values(this._cancelLamp).forEach(c => d.add(c));

        // 报警铃闪烁环
        this._bellRing = _rect({ x: 572, y: L.bottomY - 31, width: 128, height: 62, stroke: '#ff4d4d', strokeWidth: 4, fill: 'rgba(0,0,0,0)', cornerRadius: 6, opacity: 0 });
        d.add(this._bellRing);

        // ── 车钟档位高亮 / 手柄 ──
        // ── 车钟动态：11 档文字（当前档绿色）+ 横贯滑条 + 左右紫色手柄 ──
        const tx2 = L.tel.x, ty2 = L.tel.y, tw2 = L.tel.w, th2 = L.tel.h;
        const px0b = tx2 + 16, px1b = tx2 + tw2 - 16;
        const inX2 = px0b + 26, inW2 = (px1b - px0b) - 52;

        this._telText = TEL_ROWS.map((t, i) => {
            const y = L.tel.rowTop + i * L.tel.rowGap;
            const txt = _text({
                x: inX2, y: y - 9, width: inW2, align: 'center',
                fontSize: 13.5, fill: '#b9c0c6', text: t,
            });
            d.add(txt);
            return txt;
        });

        // 滑条（横贯整个面板，含左右手柄）
        this._telSlider = new Konva.Group({ x: 0, y: L.tel.rowTop, listening: false });
        // 半透明横向带
        this._telSlider.add(new Konva.Rect({
            x: px0b - 10, y: -15, width: (px1b - px0b) + 20, height: 30,
            fill: 'rgba(120,130,140,0.35)', stroke: '#c8ced4', strokeWidth: 1.5, cornerRadius: 3,
        }));
        // 滑条上的黄色短横线（文字两侧）
        // 黄线中心与左右档位刻度线中心（inX+30 / inX+inW-30）对齐
        this._telSlider.add(new Konva.Line({ points: [inX2 + 6, 0, inX2 + 54, 0], stroke: '#e8f000', strokeWidth: 3 }));
        this._telSlider.add(new Konva.Line({ points: [inX2 + inW2 - 54, 0, inX2 + inW2 - 6, 0], stroke: '#e8f000', strokeWidth: 3 }));
        // 左右紫色手柄（骑在导轨上）
        [px0b + 15, px1b - 15].forEach((hx) => {
            this._telSlider.add(new Konva.Rect({
                x: hx - 11, y: -18, width: 22, height: 36,
                fill: '#b9a6c8', stroke: '#6d5b7d', strokeWidth: 1.6, cornerRadius: 3,
            }));
            this._telSlider.add(new Konva.Rect({ x: hx - 6, y: -12, width: 12, height: 24, fill: '#cdbcdd', stroke: '#8a789b', strokeWidth: 1 }));
        });
        // 车钟：滑条纯视觉；交互用 stage 级指针事件手动处理（最可靠，不受命中/拖动阈值影响）
        this._telSlider.listening(false);
        this._telSlider.getChildren().forEach((n) => n.listening(false));

        if (!this._telGroup) {
            this._telGroup = new Konva.Group({ name: '_telGroup' });
            this.group.add(this._telGroup);
        }
        this._telGroup.add(this._telSlider);

        const minY = L.tel.rowTop, maxY = L.tel.rowTop + 10 * L.tel.rowGap;
        const topRpm = 68, bottomRpm = -55;
        this._telMinY = minY;
        this._telMaxY = maxY;

        // 指针位置 → 车钟局部坐标
        const toLocal = () => {
            const stage = this.sys && this.sys.stage;
            const ptr = stage && stage.getPointerPosition && stage.getPointerPosition();
            if (!ptr) return null;
            return this.group.getAbsoluteTransform().copy().invert().point({ x: ptr.x, y: ptr.y });
        };
        const inTelArea = (lo) => lo && lo.x >= L.tel.x - 6 && lo.x <= L.tel.x + L.tel.w + 6
            && lo.y >= L.tel.y - 6 && lo.y <= L.tel.y + L.tel.h + 6;

        /** 依据指针 y 设定车钟（连续）并移动滑条 */
        this._telApplyPointer = (localY) => {
            const ratio = Math.max(0, Math.min(1, (localY - minY) / (maxY - minY)));
            const rpm = posToRpm(ratio * 10);          // 拖到某档行 → 正好该档转速
            // 车钟手柄各位置都能自由拖动；只有控制位置的车钟会改变主机给定（LEVER）
            this.model.setLeverContinuous(rpm, this.posKey);
            this._telSlider.y(minY + ratio * (maxY - minY));
            this._redraw();
        };

        /** 松手：只有当车令值与最近档位的差 ≤ 1 rpm 时才吸附到该档，否则保持连续值 */
        this._telSnap = () => {
            // 与本面板车钟最近档位相差 ≤1 rpm 才吸附，否则保持连续值
            this.model.snapLeverAt(this.posKey);
            const myPos = this.model.leverPosAt ? this.model.leverPosAt(this.posKey) : 0;
            this._telSlider.y(minY + myPos * L.tel.rowGap);
            this._redraw();
        };

        this._telManualDrag = false;
        const stage = this.sys && this.sys.stage;
        if (stage && !this._telBound) {
            this._telBound = true;
            const down = () => {
                if (!this.group.visible()) return;
                const lo = toLocal();
                if (!inTelArea(lo)) return;
                this._telManualDrag = true;
                this._telDragFrom = this.model.leverRpm[this.posKey];   // 记录拖动起点（判断急倒车）
                this.group.draggable(false);        // 锁住整块面板拖动
                this._telApplyPointer(lo.y);        // 点哪儿 → 手柄立即到位
                if (typeof window !== 'undefined') window.__telDebug = { id: this.id, phase: 'down', localY: Math.round(lo.y) };
            };
            const move = () => {
                if (!this._telManualDrag) return;
                const lo = toLocal();
                if (lo) this._telApplyPointer(lo.y);
            };
            const up = () => {
                if (!this._telManualDrag) return;
                this._telManualDrag = false;
                this.group.draggable(!((this._menuPage && this._subPage) || this._directPage));
                this._telSnap();
                // 一次拖动内从 NAV FULL(68) 直接拉到 EM'CY ASTERN(-55) → 应急操作（Cancel Limits 自动生效）
                // 只有**拥有控制权**的面板车钟才触发（无控制权拖动只动手柄，不触发任何动作）
                const to = this.model.leverRpm[this.posKey];
                const inControl = this.model.controlPos === this.posKey;
                if (inControl && typeof this._telDragFrom === 'number'
                    && this._telDragFrom >= 67.5 && to <= -50.5) {
                    this.model.crashAstern();
                }
                if (typeof window !== 'undefined') window.__telDebug = { id: this.id, phase: 'up', leverPos: this.model.leverPos, cmd: this.model.rpmCmd };
            };
            stage.on('mousedown.tel', down);
            stage.on('touchstart.tel', down);
            stage.on('mousemove.tel', move);
            stage.on('touchmove.tel', move);
            stage.on('mouseup.tel touchend.tel', up);
            stage.on('mouseleave.tel', up);
        }
        // 手柄可拖动 → 允许命中（原来整组 listening:false）
        this._telSlider.listening(true);
        this._telSlider.getChildren().forEach((n) => n.listening(true));

        // ── 右侧深色面板动态 ──
        // RPM CMD：数字在上、标签在下
        this._rpmCmdText = _text({ x: L.dark.x + 20, y: L.dark.y + 47, width: 120, align: 'center', fontSize: 42, fontStyle: 'bold', fill: C_YELLOW, text: '68' });
        d.add(this._rpmCmdText);
        d.add(_text({ x: L.dark.x + 20, y: L.dark.y + 99, width: 120, align: 'center', fontSize: 14, fill: '#e0d24a', text: 'RPM CMD' }));

        // 上 / 下箭头（半径 17，与 At Sea 灯同列 arrowCol）
        const ax = L.dark.x + L.arrowCol, auy = L.dark.y + L.arrowUpY, ady = L.dark.y + L.arrowDownY;
        d.add(_circle({ x: ax, y: auy, radius: 17, fill: '#0a0a0a', stroke: '#e8e8e8', strokeWidth: 2 }));
        d.add(_line({ points: [ax, auy + 8, ax, auy - 3], stroke: '#e8e8e8', strokeWidth: 2, lineCap: 'round' }));
        d.add(_line({ points: [ax - 6, auy - 1, ax, auy - 10, ax + 6, auy - 1], closed: true, fill: '#e8e8e8', stroke: '#e8e8e8', strokeWidth: 1 }));
        d.add(_circle({ x: ax, y: ady, radius: 17, fill: '#0a0a0a', stroke: '#e8e8e8', strokeWidth: 2 }));
        d.add(_line({ points: [ax, ady - 8, ax, ady + 3], stroke: '#e8e8e8', strokeWidth: 2, lineCap: 'round' }));
        d.add(_line({ points: [ax - 6, ady + 1, ax, ady + 10, ax + 6, ady + 1], closed: true, fill: '#e8e8e8', stroke: '#e8e8e8', strokeWidth: 1 }));

        // Bridge / ECR / Local 与 At Sea / Standby / FWE
        // 圆形指示灯：上半圆为绿色填充亮起（选中），文字颜色固定（照参考图）
        const mkRoundLamp = (label, x, y, textColor, opt) => {
            const o = Object.assign(
                { on: '#0aaa20', off: 'rgba(0,0,0,0)', stroke: '#e8ebec', strokeWidth: 2.5 },
                opt || {});
            // 指示灯填充「下半圆」（rotation 0 → 0°~180° 覆盖下半部）
            // 填充为「弓形」：底部高度 = 直径的 1/3，顶面是水平弦（平顶）
            const fill = new Konva.Shape({
                x, y, listening: false, fill: o.off,
                sceneFunc(ctx, shape) {
                    const R = 26, h = (2 * R) / 3;          // h = 直径 × 1/3
                    const yTop = R - h;                     // 弦相对圆心的 y（圆心为 0，底部 +R）
                    const dx = Math.sqrt(Math.max(0, R * R - yTop * yTop));
                    ctx.beginPath();
                    ctx.moveTo(-dx, yTop);
                    ctx.lineTo(dx, yTop);                                   // 平顶
                    ctx.arc(0, 0, R, Math.atan2(yTop, dx), Math.atan2(yTop, -dx), false);
                    ctx.closePath();
                    ctx.fillStrokeShape(shape);
                },
            });
            d.add(fill);
            const ring = _circle({ x, y, radius: 28, fill: 'rgba(0,0,0,0)', stroke: o.stroke, strokeWidth: o.strokeWidth });
            d.add(ring);
            const txt = _text({ x: x - 27, y: y - 8, width: 54, align: 'center', fontSize: 13.5, fill: textColor, text: label });
            d.add(txt);
            return { fill, ring, txt, on: o.on, off: o.off, stroke: o.stroke };
        };

        this._posLamp = {};
        this._posLamp[CONTROL_POS.BRIDGE] = mkRoundLamp('Bridge', L.dark.x + L.buzzCol, L.dark.y + 170, '#ffffff');
        this._posLamp[CONTROL_POS.ECR] = mkRoundLamp('ECR', L.dark.x + L.buzzCol, L.dark.y + 234, '#e8d84a');
        this._posLamp[CONTROL_POS.LOCAL] = mkRoundLamp('Local', L.dark.x + L.buzzCol, L.dark.y + 298, '#e2703a');

        this._modeLamp = {};
        this._modeLamp['SEA'] = mkRoundLamp('At Sea', L.dark.x + L.arrowCol, L.dark.y + 170, '#ffffff');
        this._modeLamp['STANDBY'] = mkRoundLamp('Standby', L.dark.x + L.arrowCol, L.dark.y + 234, '#e8d84a');
        this._modeLamp['FWE'] = mkRoundLamp('FWE', L.dark.x + L.arrowCol, L.dark.y + 298, '#e2703a');

        // 报警信息栏：正常时空白；有故障时红底、显示最新两条报警信息
        const ab = L.alarmBox;
        this._alarmFill = _rect({ x: ab.x + 2, y: ab.y + 2, width: ab.w - 4, height: ab.h - 4, fill: '#e00d0d', visible: false });
        d.add(this._alarmFill);
        this._alarmLines = [0, 1].map((i) => {
            const t = _text({
                x: ab.x + 10, y: ab.y + 9 + i * 34, width: ab.w - 20, fontSize: 24,
                fontStyle: 'bold', fill: '#101010', text: '',
            });
            d.add(t);
            return t;
        });

        // 菜单流程指示灯：固定铺满 7×2 网格（每格左侧空隙正中），随当前菜单层级显示/隐藏
        this._bandLamps = [];
        for (let ri = 0; ri < 2; ri++) {
            for (let ci = 0; ci < 7; ci++) {
                const off = ci === 0 ? L.btns.pad / 2 : 12;
                const lamp = _circle({
                    x: L.btns.x[ci] - off, y: (ri === 0 ? L.btns.y1 : L.btns.y2) + L.btns.h / 2,
                    radius: 8, fill: '#e01717', visible: false,
                });
                d.add(lamp);
                this._bandLamps.push({ ci, ri, node: lamp });
            }
        }
        this._menuFaults = {};
        this._menuFocus = null;

        // 蜂鸣器闪烁罩（报警时闪）
        this._buzzGlow = _circle({ x: L.dark.x + 78, y: 738, radius: 36, fill: '#ff3b48', opacity: 0 });
        d.add(this._buzzGlow);

        // 玻璃盖（两种姿态：合上遮住按钮 / 上翻露出按钮）
        this._cover = new Konva.Group({ x: L.emStop.x + 4, y: 694, listening: false });
        this._coverClosed = new Konva.Group({ listening: false });
        this._coverClosed.add(new Konva.Rect({ x: 0, y: 0, width: 122, height: 74, fill: 'rgba(210,225,235,0.55)', stroke: '#9fb6c4', strokeWidth: 2, cornerRadius: 2 }));
        this._coverClosed.add(new Konva.Line({ points: [0, 24, 122, 0], stroke: 'rgba(255,255,255,0.5)', strokeWidth: 3 }));
        // 斜纹把手
        for (let i = 0; i < 9; i++) {
            this._coverClosed.add(new Konva.Line({ points: [10 + i * 13, 34, 18 + i * 13, 26], stroke: '#7d8488', strokeWidth: 2 }));
        }
        this._cover.add(this._coverClosed);

        this._coverOpen = new Konva.Group({ listening: false, visible: false });
        this._coverOpen.add(new Konva.Rect({ x: 0, y: 2, width: 122, height: 16, fill: '#c9d3dc', stroke: '#7d8488', strokeWidth: 2, cornerRadius: 2 }));
        for (let i = 0; i < 9; i++) {
            this._coverOpen.add(new Konva.Line({ points: [10 + i * 13, 14, 18 + i * 13, 4], stroke: '#7d8488', strokeWidth: 2 }));
        }
                this._cover.add(this._coverOpen);
        d.add(this._cover);

        this._emHi = _rect({ x: L.emStop.x + 8, y: 714, width: 114, height: 46, fill: '#ff3b48', opacity: 0 });
        d.add(this._emHi);
    }

    // ═══════════════════════════════════════════════════════
    //  交互
    // ═══════════════════════════════════════════════════════

    /**
     * 画一段分段彩色的文字（同一行内不同颜色）。
     * 各段按「最终字号 15.5」量宽后顺序排布，绘制时用 13.5 —— _renderMenu 统一 +2 后正好吻合。
     */
    _pgRichText(x, y, segs) {
        const g = this._menuGroup;
        let cx = x;
        segs.forEach(([t, color]) => {
            if (!t) return;
            g.add(_text({ x: cx, y, width: 520, fontSize: 13.5, fill: color || '#e6ecf2', text: t }));
            const n = new Konva.Text({ text: t, fontSize: 15.5 });
            cx += n.width();
            n.destroy();
        });
    }

    _bindInteraction() {
        const M = this.model;
        const mk = (id, x, y, w, h, onClick) => {
            const hit = this.addClickablePart(id, x, y, w, h);
            if (onClick) hit.on('click tap', (e) => { e.cancelBubble = true; onClick(); this._redraw(); });
            return hit;
        };

        // Cancel 越控
        // 三个按钮均为切换型：按一次越控（灯亮），再按一次复位（灯灭）
        // 越控（各面板独立，互不同步）：本面板总有反应（指示灯 / 本站点逐项越控 / 本站点报警），
        // **但只有拥有控制权时才作用于主机**（无控制权时完全不改模型状态）
        mk('cancel-shd', L.cancelBtn.x, L.cancelBtn.y[0] - 37, L.cancelBtn.w, L.cancelBtn.w, () => {
            const on = !this._cancel.shd;
            this._cancel.shd = on;
            M.setCancel('SHD', on, this.posKey);       // 报警与动作系统同步（与是否拥有控制权无关）
            this._safCancelAll('shd', on);
            M.setCancelAlarm('shd', M.cancelSHD);
            this._almPollAt = 0; this._pollAlarms();     // 立即记录报警状态（保证 RTN 能保留）
            this._renderMenu();
        });
        mk('cancel-sld', L.cancelBtn.x, L.cancelBtn.y[1] - 37, L.cancelBtn.w, L.cancelBtn.w, () => {
            const on = !this._cancel.sld;
            this._cancel.sld = on;
            M.setCancel('SLD', on, this.posKey);
            this._safCancelAll('sld', on);
            M.setCancelAlarm('sld', M.cancelSLD);
            this._almPollAt = 0; this._pollAlarms();
            this._renderMenu();
        });
        mk('cancel-limits', L.cancelBtn.x, L.cancelBtn.y[2] - 37, L.cancelBtn.w, L.cancelBtn.w, () => {
            const on = !this._cancel.lim;
            this._cancel.lim = on;
            M.autoCancelLimits = false;                // 人工按下后由按钮状态接管
            M.setCancel('LIM', on, this.posKey);
            M.setCancelAlarm('lim', M.cancelLimits);
            this._almPollAt = 0; this._pollAlarms();
            this._renderMenu();          // Show Limiters 页的 STATUS / LEVEL 立即随动
        });

        // 按钮排
        const btnAt = (ci, ri) => [L.btns.x[ci], ri === 0 ? L.btns.y1 : L.btns.y2];
        // 菜单按钮由 _renderBand() 动态绘制并登记热区（主菜单 / 二级菜单共用网格）
        this._bandHitIds = [];
        this._subPage = null;
        this._alarmViewMode = 'all';

        // 报警信息栏（仅供演示箭头定位，本身无点击动作）
        mk('alarm-bar', L.alarmBox.x, L.alarmBox.y, L.alarmBox.w, L.alarmBox.h, null);
        // 车钟整列（箭头指向手柄位置，见 getClickablePartCenter 的 overrides）
        mk('telegraph', L.tel.x, L.tel.y, L.tel.w, L.tel.h, null);

        // 扬声器 / 报警铃 / ACK
        mk('silence', 492, L.bottomY - 34, 68, 68, () => { M.silence(); });
        mk('alarm-bell', 578, L.bottomY - 25, 116, 50, () => { M.silence(); });
        mk('ack', 712, L.bottomY - 34, 68, 68, () => { M.ack(); this._ackAlarms(); });

        // RPM CMD 上 / 下
        const stepLocal = (d) => {
            const cur = (M.leverRpm && M.leverRpm[this.posKey] !== undefined) ? M.leverRpm[this.posKey] : M.rpmCmd;
            M.setLeverAt(cur + d, this.posKey);      // 只改本面板车钟；有控制权时才改主机给定
        };
        mk('lever-up', L.dark.x + L.arrowCol - 17, L.dark.y + L.arrowUpY - 17, 34, 34, () => { stepLocal(2); });
        mk('lever-down', L.dark.x + L.arrowCol - 17, L.dark.y + L.arrowDownY - 17, 34, 34, () => { stepLocal(-2); });

        // 控制位置
        mk('pos-bridge', L.dark.x + L.buzzCol - 31, L.dark.y + 139, 62, 62, () => this._setPos(CONTROL_POS.BRIDGE));
        mk('pos-ecr', L.dark.x + L.buzzCol - 31, L.dark.y + 203, 62, 62, () => this._setPos(CONTROL_POS.ECR));
        mk('pos-local', L.dark.x + L.buzzCol - 31, L.dark.y + 267, 62, 62, () => this._setPos(CONTROL_POS.LOCAL));

        // 工况
        // 副车钟（工况）：驾驶台 ↔ 集控室两步回令，机旁只显示
        const modeBtn = (id, mode, name, condTip) => mk(id, L.dark.x + L.arrowCol - 31, L.dark.y + (mode === 'SEA' ? 139 : (mode === 'STANDBY' ? 203 : 267)), 62, 62, () => {
            const r = M.requestEngineMode(mode, this.posKey);
            if (r === 'ok') this._tip(`副车钟：${name} 已生效（集控室回令）`);
            else if (r === 'req') this._tip(`副车钟请求：切到 ${name}（等待对方回令）`);
            else if (r === 'cancel') this._tip(`副车钟请求已取消（${name}）`);
            else if (r === 'blocked') this._tip(`不能切到 ${name}：${condTip}`);
            else this._tip(`副车钟当前：${name}`);
        });
        modeBtn('mode-sea', 'SEA', 'At Sea', '驾驶台车钟需先在 NAV FULL');
        modeBtn('mode-standby', 'STANDBY', 'Stand By', '主机需先停车');
        modeBtn('mode-fwe', 'FWE', 'FWE', '需先关闭主起动阀与空气分配器');

        // 应急停车：玻璃盖（按一次上翻、再按一次遮住）+ 自锁按钮（开盖后可操作）
        mk('em-stop-cover', L.emStop.x - 2, 692, 134, 82, () => {
            const open = M.toggleEmStopCover();
            if (!open && M.emStopLatched) { M.pressEmStop(); }   // 合盖时若按钮仍在按下状态则弹出
        });
        mk('em-stop', L.emStop.x, 706, 130, 62, () => {
            if (!M.emStopCoverOpen) { M.toggleEmStopCover(); return; }  // 未开盖：先开盖
            M.pressEmStop(this.variant === 'ecr' ? 'ECR' : 'BRIDGE');
        });
    }

    _setPos(pos) {
        const M = this.model;
        const name = { BRIDGE: '驾驶台', ECR: '集控室', LOCAL: '机旁' }[pos];
        const cur = { BRIDGE: '驾驶台', ECR: '集控室', LOCAL: '机旁' }[M.controlPos] || M.controlPos;
        const r = M.pressPosButton(this.posKey, pos);
        if (r === 'give') this._tip(`请求把控制位置交给${name}（车钟一致后在${name}按同位置键确认）`);
        else if (r === 'take') this._tip(`请求从${cur}接管控制位置（车钟一致后由${cur}按同位置键确认交出）`);
        else if (r === 'ok') this._tip(`控制位置已转到${name}`);
        else if (r === 'mismatch') this._tip(`车钟不一致：先把${name}与${cur}的车钟拉一致再确认`);
        else if (r === 'cancel') this._tip('已取消控制位置转移');
        else if (r === 'blocked') this._tip(`控制权在${cur}：只能由${cur}按键交出控制权，本位置不能直接接管`);
        else this._tip(`当前控制位置：${cur}`);
    }


    // ═══════════════════════════════════════════════════════
    //  菜单系统（照 AutoChief 600 ACP 真机结构）
    //    第 1 级：主菜单 9 项（Alarms·Limiters·Control Pos.·Misc Menu /
    //             Safety System·Engine State·B&W Modes·Param. Change·Home）
    //    点主菜单项 → 菜单区（按钮排）切换成该项的二级按钮组（液晶区不变，仍是主页图形）
    //    点二级按钮 → 液晶区显示对应页面
    //      · Alarms 的 Sys. Critical / Sys. Non-Crit. / ComErr Crit. / ComErr Non-Crit. / I/O Fail
    //        为「两种状态」：首次点击显示全部参数；再点只显示未复位（报警）项；再点又回全部
    //      · Alarm History 显示全部历史故障
    //    Home（主菜单与二级菜单都有）→ 回主菜单 + 主页图形
    // ═══════════════════════════════════════════════════════

    /** 第 1 级主菜单（网格位置固定） */
    _mainMenuCells() {
        return [
            { id: 'btn-alarms', label: 'Alarms', ci: 0, ri: 0, key: 'alarms' },
            { id: 'btn-limiters', label: 'Limiters', ci: 1, ri: 0, key: 'limiters' },
            { id: 'btn-cpos', label: 'Control Pos.', ci: 2, ri: 0, key: 'cpos' },
            { id: 'btn-misc', label: 'Misc Menu', ci: 3, ri: 0, key: 'misc' },
            { id: 'btn-safety', label: 'Safety System', ci: 0, ri: 1, key: 'safety' },
            { id: 'btn-estate', label: 'Engine State', ci: 1, ri: 1, key: 'estate' },
            { id: 'btn-bwm', label: 'B&W Modes', ci: 2, ri: 1, key: 'bwm' },
            { id: 'btn-param', label: 'Param. Change', ci: 4, ri: 1, key: 'param' },
            { id: 'btn-home', label: 'Home', ci: 6, ri: 1, key: 'home' },
        ];
    }

    /** 第 2 级：按当前主菜单返回二级按钮（Home 固定在第 2 行第 7 列） */
    _subMenuCells() {
        const table = {
            'btn-alarms': [
                ['Sys. Critical', 'sys-crit', 0, 0], ['Sys. Non-Crit.', 'sys-nonc', 1, 0],
                ['ComErr Crit.', 'comerr-c', 2, 0], ['ComErr Non-Crit.', 'comerr-n', 3, 0],
                ['I/O Fail', 'io-fail', 0, 1], ['Alarm History', 'history', 1, 1],
            ],
            'btn-limiters': [['Set Limiters', 'set', 0, 0], ['Show Limiters', 'show', 1, 0]],
            'btn-cpos': [['Overview', 'overview', 0, 0], ['Transfer', 'transfer', 1, 0]],
            'btn-misc': [['Counters', 'counters', 0, 0],
                ['Order Printer', 'printer', 1, 0], ['Service (LTU)', 'service', 2, 0]],
            'btn-safety': [['Shut Down', 'shd', 0, 0], ['Slow Down', 'sld', 1, 0],
                ['RESET SLD', 'reset-sld', 3, 0],
                ['Emg. Stop', 'emstop', 0, 1], ['RPM Detector', 'detector', 1, 1]],
            'btn-bwm': [['Engine modes', 'modes', 0, 0], ['Running mode', 'running', 1, 0],
                ['Slow turning', 'slow-turning', 2, 0], ['Cyl. lubrication', 'prelub', 3, 0]],
            'btn-param': [['Start / Stop', 'p0', 0, 0], ['Reversing', 'p1', 1, 0],
                ['Crash astern', 'p2', 2, 0], ['Governor (DGU PID)', 'p3', 3, 0],
                ['Safety', 'psafety', 4, 0]],
        };
        const rows = table[this._menuPage] || [];
        const cells = rows.map(([label, key, ci, ri]) => ({ id: `sub-${key}`, label, key, ci, ri }));
        cells.push({ id: 'sub-home', label: 'Home', key: 'home', ci: 6, ri: 1 });
        return cells;
    }

    _clearBandHits() {
        (this._bandHitIds || []).forEach((id) => {
            const p = this._parts && this._parts[id];
            if (p && p.node && p.node.getParent && p.node.getParent()) p.node.getParent().destroy();
            if (this._parts) delete this._parts[id];
        });
        this._bandHitIds = [];
    }

    /** 重绘菜单按钮排（主菜单 / 二级菜单） */
    _renderBand() {
        if (!this._bandGroup) return;
        this._clearBandHits();
        this._bandGroup.destroyChildren();
        const cells = this._menuPage ? this._subMenuCells() : this._mainMenuCells();
        this._bandCells = cells;
        // 7 × 2 全网格：空位也画空白矩形占位（照真机菜单区）
        for (let ri = 0; ri < 2; ri++) {
            for (let ci = 0; ci < 7; ci++) {
                const x = L.btns.x[ci], y = (ri === 0 ? L.btns.y1 : L.btns.y2);
                const cell = cells.find((c) => c.ci === ci && c.ri === ri);
                this._buttonRow(this._bandGroup, x, y, L.btns.w, L.btns.h, cell ? cell.label : '');
                if (!cell) continue;
                const hit = this.addClickablePart(cell.id, x, y, L.btns.w, L.btns.h);
                hit.on('click tap', (e) => {
                    e.cancelBubble = true;
                    if (!this._menuPage) this._openMenu(cell.key);
                    else this._openSub(cell.key);
                });
                this._bandHitIds.push(cell.id);
            }
        }
        this._redraw();
    }

    /** 点主菜单项 */
    _openMenu(key) {
        if (key === 'home') {
            this._menuPage = null;
            this._subPage = null;
            this._directPage = null;
            this._renderBand();
            this._renderMenu();
            return;
        }
        // Engine State 没有子菜单：点一下直接在液晶区显示状态画面，菜单区保持主菜单
        if (key === 'estate') {
            this._directPage = this._directPage === 'estate' ? null : 'estate';
            this._menuPage = null;
            this._subPage = null;
            this._renderBand();
            this._renderMenu();
            return;
        }
        this._directPage = null;
        const id = `btn-${key}`;
        if (this._menuPage === id) {
            // 再点同一主菜单 → 回主菜单栏
            this._menuPage = null;
            this._subPage = null;
        } else {
            this._menuPage = id;
            this._subPage = null;
        }
        this._menuFocus = this._menuPage;
        this._renderBand();
        this._renderMenu();
    }

    /** 点二级按钮 */
    _openSub(key) {
        // RESET SLD：本仿真中该软键不起作用（按下无任何动作，与真机一致）
        if (key === 'reset-sld') return;
        if (key === 'home') {
            this._menuPage = null;
            this._subPage = null;
            this._directPage = null;
            this._renderBand();
            this._renderMenu();
            return;
        }
        const ALARM_KINDS = ['sys-crit', 'sys-nonc', 'comerr-c', 'comerr-n', 'io-fail'];
        const SAFETY_KINDS = ['shd', 'sld', 'emstop'];
        this._listOffset = 0;
        if (this._subPage !== key) this._safSel = null;
        if (SAFETY_KINDS.includes(key)) {
            // 首次点击显示全部项目；再次点击只显示故障项
            if (this._subPage === key) {
                this._safetyViewMode = this._safetyViewMode === 'all' ? 'active' : 'all';
            } else {
                this._subPage = key;
                this._safetyViewMode = 'all';
            }
        } else if (ALARM_KINDS.includes(key)) {
            // 两种状态：同一项再点 → 在「全部 / 仅未复位」间切换
            if (this._subPage === key) {
                this._alarmViewMode = this._alarmViewMode === 'all' ? 'active' : 'all';
            } else {
                this._subPage = key;
                this._alarmViewMode = 'all';
            }
        } else {
            this._subPage = key;
        }
        this._renderMenu();
    }

    // ── 页面绘制基元 ──
    _clearMenuHits() {
        (this._menuHitIds || []).forEach((id) => {
            const p = this._parts && this._parts[id];
            if (p && p.node && p.node.getParent && p.node.getParent()) p.node.getParent().destroy();
            if (this._parts) delete this._parts[id];
        });
        this._menuHitIds = [];
    }

    _mkMenuBtn(id, x, y, w, h, onDown) {
        const hit = this.addClickablePart(id, x, y, w, h);
        hit.on('click tap', (e) => {
            e.cancelBubble = true;
            onDown();
            this._renderMenu(true);
        });
        this._menuHitIds.push(id);
        return hit;
    }

    /** 液晶区页面头（标题 + HOME 提示） */
    _pgBase(title) {
        const g = this._menuGroup;
        g.add(_rect({ x: 126, y: 70, width: 1020, height: 430, fill: '#2b2b2b' }));
        g.add(_rect({ x: 126, y: 70, width: 1020, height: 26, fill: '#101080', stroke: '#3d3dc0', strokeWidth: 1 }));
        g.add(_text({ x: 134, y: 74, width: 700, fontSize: 15.5, fontStyle: 'bold', fill: '#ffffff', text: title }));
        g.add(_text({ x: 1000, y: 75, width: 136, align: 'right', fontSize: 12.5, fill: '#9fd3ff', text: 'HOME = 主页' }));
        return 100;
    }

    /** 三列表格式报警/参数页（照 ACP 截图：白表头 + 深灰行 + 绿色正常值 + 滚动条） */
    _pgListTable(items, y0, opts) {
        const o = opts || {};
        const g = this._menuGroup;
        const xD = 126, wD = 470, xV = 596, wV = 264, xA = 860, wA = 262;
        // 表头（白底黑字）
        g.add(_rect({ x: xD, y: y0, width: 1020, height: 26, fill: '#eceef0', stroke: '#8d9498', strokeWidth: 1 }));
        g.add(_text({ x: xD + 6, y: y0 + 4, width: wD, fontSize: 14.5, fill: '#101010', text: 'Description' }));
        g.add(_text({ x: xV + 6, y: y0 + 4, width: wV, fontSize: 14.5, fill: '#101010', text: 'Value' }));
        g.add(_text({ x: xA + 6, y: y0 + 4, width: wA, fontSize: 14.5, fill: '#101010', text: 'Alarms' }));
        g.add(_line({ points: [xV, y0, xV, y0 + 26], stroke: '#8d9498', strokeWidth: 1 }));
        g.add(_line({ points: [xA, y0, xA, y0 + 26], stroke: '#8d9498', strokeWidth: 1 }));

        const rowH = 24.5;
        const bodyY = o.showHeader === false ? y0 : y0 + 26;
        const maxRows = Math.floor((500 - bodyY) / rowH);
        const total = items.length;
        const maxOff = Math.max(0, total - maxRows);
        let off = Math.min(Math.max(0, this._listOffset || 0), maxOff);
        this._listOffset = off;
        items.slice(off, off + maxRows).forEach((it, i) => {
            const ry = bodyY + i * rowH;
            const st = it.st || (it.alarm ? 'unack' : 'none');
            const on = st === 'unack' || st === 'acked';
            g.add(_rect({ x: xD, y: ry, width: 1006, height: rowH, fill: st === 'unack' ? '#4d0f0f' : ((off + i) % 2 ? '#2b2b2b' : '#323232') }));
            const col = st === 'acked' ? '#f0d040' : ((st === 'unack' || st === 'rtn') ? '#ff4040' : '#00c000');
            g.add(_text({ x: xD + 6, y: ry + 4, width: wD - 8, fontSize: 14, fill: col, text: it.desc }));
            g.add(_text({ x: xV + 6, y: ry + 4, width: wV - 8, fontSize: 14, fill: col, text: st === 'rtn' ? 'NORMAL' : it.value }));
            g.add(_text({ x: xA + 6, y: ry + 4, width: wA - 8, fontSize: 14, fill: col, text: on ? 'AL. CLOSE' : '' }));
        });
        if (!items.length) {
            g.add(_text({ x: xD, y: bodyY + 30, width: 1000, align: 'center', fontSize: 15, fill: '#9fd3ff', text: 'NO ITEMS' }));
        }
        // 滚动条：上/下三角可点击翻页，中间滑块示意位置
        const barTop = y0, barBot = 500;
        g.add(_rect({ x: 1132, y: barTop, width: 14, height: barBot - barTop, fill: '#c9ccce', stroke: '#8d9498', strokeWidth: 1 }));
        g.add(_line({ points: [1139, barTop + 6, 1145, barTop + 13, 1133, barTop + 13], closed: true, fill: off > 0 ? '#3a3f42' : '#9aa1a5', stroke: '#3a3f42', strokeWidth: 1 }));
        g.add(_line({ points: [1139, barBot - 6, 1145, barBot - 13, 1133, barBot - 13], closed: true, fill: off < maxOff ? '#3a3f42' : '#9aa1a5', stroke: '#3a3f42', strokeWidth: 1 }));
        if (maxOff > 0) {
            const trackH = barBot - barTop - 32;
            const thumbH = Math.max(24, trackH * (maxRows / total));
            const thumbY = barTop + 16 + (trackH - thumbH) * (off / maxOff);
            g.add(_rect({ x: 1134, y: thumbY, width: 10, height: thumbH, fill: '#8d9498', stroke: '#5c6366', strokeWidth: 1, cornerRadius: 2 }));
        }
        const pageRows = Math.max(1, maxRows - 1);   // 整页滚动（留 1 行重叠便于对照）
        this._mkMenuBtn('menu-scroll-up', 1128, barTop + 2, 20, 20, () => {
            this._listOffset = Math.max(0, off - pageRows);
        });
        this._mkMenuBtn('menu-scroll-down', 1128, barBot - 22, 20, 20, () => {
            this._listOffset = Math.min(maxOff, off + pageRows);
        });
        return bodyY + Math.min(maxRows, total) * rowH;
    }

    _pgRow(x, y, w, cols, opts) {
        const o = opts || {};
        const g = this._menuGroup;
        if (o.bg) g.add(_rect({ x, y, width: w, height: 26, fill: o.bg }));
        let cx = x + 8;
        cols.forEach((c) => {
            g.add(_text({
                x: cx, y: y + 4, width: c.w, align: c.align || 'left',
                fontSize: c.fs || 13.5, fontStyle: c.bold ? 'bold' : '', fill: c.color || '#e6ecf2', text: String(c.text),
            }));
            cx += c.w;
        });
    }

    _pgSoftKey(x, y, w, h, label, id, onDown) {
        const g = this._menuGroup;
        g.add(_rect({ x, y, width: w, height: h, fill: '#d8dde2', stroke: '#8a9095', strokeWidth: 1.6, cornerRadius: 3 }));
        g.add(_text({ x, y: y + (h - 16) / 2, width: w, align: 'center', fontSize: 14, fontStyle: 'bold', fill: '#101010', text: label }));
        this._mkMenuBtn(id, x, y, w, h, onDown);
    }

    // ── Alarms 各类参数清单（照 ACP 截图项目名；值/报警随模型变化）──
    _alarmItems(kind) {
        const M = this.model;
        const pos = M.controlPos;
        const esPressed = (p) => (M.emStopLatched && M.emStopBy === p);   // 按住才亮：弹出即复位
        const rpmTxt = `${M.rpm.toFixed(1)}RPM`;
        const pot = (v) => `${v.toFixed(1)}%`;
        const N = (desc, value, alarm) => ({ desc, value, alarm: !!alarm });

        if (kind === 'sys-crit') {
            return [
                N('ACP600 ECR', 'NORMAL', false),
                N('BR PANEL COMMUNICATION', 'NORMAL', false),
                N('DGU RPM SYSTEM', 'NORMAL', false),
                N('ECR PANEL COMMUNICATION', 'NORMAL', false),
                N('ESU BACKUP POWER FAILURE', 'NORMAL', false),
                N('ESU MAIN POWER FAILURE', 'NORMAL', false),   // 紧急停车不触发 Sys. Critical
                N('GOVERNOR SYS FAILURE', 'NORMAL', false),
                N('PBW POT.METER', pot(0), false),
                N('REMOTE CONTROL SYS FAILURE', 'NORMAL', false),
                N('ENGINE CRITICAL SPEED', 'NORMAL', false),
                N('RPM DETECTOR FAIL', 'NORMAL', false),
                N('SBW POT. METER', pot(0), false),
                N('ACP600 BRIDGE', 'NORMAL', false),
                N('DPU 1920 ESU E10', 'NORMAL', false),
                N('DPU 1921 RPME E20', 'NORMAL', false),
                N('DPU 1922 RPME E21', 'NORMAL', false),
                N('DPU 1925 LTU11 BRIDGE', 'NORMAL', false),
                N('DPU 1926 BPU11 BRIDGE', 'NORMAL', false),
                N('DPU 1927 LTU11 ECR', 'NORMAL', false),
                N('DPU 1928 BPU11 ECR', 'NORMAL', false),
                N('DPU 1931 PBT E25', 'NORMAL', false),
                N('TELEGRAPH SYS FAILURE', 'NORMAL', false),
            ];
        }
        if (kind === 'sys-nonc') {
            return [
                N('POWER FAILURE URE 1X10 ECR', 'NORMAL', false),
                N('POWER FAILURE URE 2X10 ECR', 'NORMAL', false),
                N('ABE 11 FAILURE ECR', 'NORMAL', false),
                N('ALARM TEST RCS', 'NORMAL', M.lampTest),
                N('ABE 11 FAILURE BRIDGE', 'NORMAL', false),
                N('AUX BLOWER FAILURE', 'NORMAL', M.auxBlowerAlarm),
                N('BR SERVO FAILURE', 'NORMAL', false),
                N('ECR FORCED CMD TKOVER', M.forceTake ? 'OPEN' : 'NORMAL', M.forceTake),
                N('ECR SERVO FAILURE', 'NORMAL', false),
                N('LIMITS CANCEL FROM ACP', M.cancelLimits ? 'ACTIVE' : 'NORMAL', M.cancelLimits),
                N('LIMITTATION INCREASED', 'NORMAL', M.loadLimitUp),
                N('LOCAL FORCED CMD TKOVR', M.forceTake ? 'OPEN' : 'NORMAL', M.forceTake),
                N('LOAD PROG CANCEL FROM ACP', 'NORMAL', false),
                N('POWER FAILURE 1X10 BRIDGE', 'NORMAL', false),
                N('POWER FAILURE 2X10 BRIDGE', 'NORMAL', false),
                N('SG DISCONNECTION FAILED', 'OPEN', false),
                N('SHUTDOWN CANCELLED', M.cancelSHD ? 'ACTIVE' : 'NORMAL', M.cancelSHD),
                N('SLOWDOWN CANCELLED', M.cancelSLD ? 'ACTIVE' : 'NORMAL', M.cancelSLD),
                N('SUDDEN STOP', 'NORMAL', false),
                N('START FAIL/BLOCK', (M.startBlocked || M.startFail) ? 'ACTIVE' : 'NORMAL', M.startBlocked || M.startFail),
                N('START FAILED', 'NORMAL', M.startFail),
                N('START AIR PRESSURE LOW', 'NORMAL', M.startAir < 15),
                N('WRONG WAY', 'NORMAL', false),
            ];
        }
        if (kind === 'comerr-c') {
            return [
                N('COMM ERROR DPSC-ME', 'NORMAL', false),
                N('COMM ERR BETW. ACP-ECR&SCU', 'NORMAL', false),
                N('COMM ERR BETW. ACP-ECR&ESU', 'NORMAL', false),
                N('COMM ERR BETW. ACP-ECR&RPMU 1', 'NORMAL', false),
                N('COMM ERR BETW. ACP-ECR&RPMU 2', 'NORMAL', false),
                N('COMM ERR BETW. ACP-ECR&ME1_XL', 'NORMAL', false),
                N('COMM ERR BETW. ACP-ECR&RPMU 4', 'NORMAL', false),
                N('COMM ERR BETW. ACP-ECR&DGU/ME', 'NORMAL', false),
                N('COMM ERR BETW. ACP-ECR&LTU11 B', 'NORMAL', false),
                N('COMM ERR BETW. ACP-ECR&BPU11 B', 'NORMAL', false),
                N('COMM ERR BETW. ACP-ECR&LTU11 E', 'NORMAL', false),
                N('COMM ERR BETW. ACP-ECR&BPU11 E', 'NORMAL', false),
                N('COMM ERR BETW. ACP-ECR&PBT', 'NORMAL', false),
                N('COMM ERR BETW. ACP-ECR&C2', 'NORMAL', false),
                N('COMM ERR BETW. ACP-ECR&TAO 8', 'NORMAL', false),
                N('COMM ERR BETW. ACP-ECR&ACP BR', 'NORMAL', false),
                N('COMM ERR BETW. ACP-ECR&ACP EC', 'NORMAL', false),
            ];
        }
        if (kind === 'comerr-n') {
            return [
                N('COMM ERR MAN B&W SIO LIN 1X7', 'NORMAL', false),
                N('COMM ERR MAN B&W SIO LIN 2X7', 'NORMAL', false),
                N('COMM ERR PORT BRIDGE WING', 'NORMAL', false),
                N('COMM ERR STBD BRIDGE WING', 'NORMAL', false),
                N('COMM ERR BETW. ACP-ECR&SCU', 'NORMAL', false),
                N('COMM ERR BETW. ACP-ECR&ESU', 'NORMAL', false),
                N('COMM ERR BETW. ACP-ECR&RPMU 1', 'NORMAL', false),
                N('COMM ERR BETW. ACP-ECR&RPMU 2', 'NORMAL', false),
                N('COMM ERR BETW. ACP-ECR&ME1_XL', 'NORMAL', false),
                N('COMM ERR BETW. ACP-ECR&RPMU 4', 'NORMAL', false),
                N('COMM ERR BETW. ACP-ECR&DGU/ME', 'NORMAL', false),
                N('COMM ERR BETW. ACP-ECR&LTU11 B', 'NORMAL', false),
                N('COMM ERR BETW. ACP-ECR&BPU11 B', 'NORMAL', false),
            ];
        }
        // io-fail
        return [
            N('BRIDGE POT. METER 1', pot(0.2), false),
            N('BRIDGE POT. METER 2', pot(0), false),
            N('ECR POT. METER 1', pot(-0.5), false),
            N('ECR POT. METER 2', pot(0), false),
            N('EMERGENCY STOP SWITCH BRIDGE', 'NORMAL', esPressed('BRIDGE')),
            N('EMERGENCY STOP SWITCH LOCAL', 'NORMAL', esPressed('LOCAL')),
            N('EMERGENCY STOP SWITCH PORT WING', 'NORMAL', false),
            N('EMERGENCY STOP SWITCH STBD WING', 'NORMAL', false),
            N('EMERGENCY STOP SWITCH ECR', 'NORMAL', esPressed('ECR')),
            N('OVERSPEED FROM RPM UNIT', 'NORMAL', false),
            N('PBW POT. METER', pot(0), false),
            N('RPM PICKUP 1.1', rpmTxt, false),
            N('RPM PICKUP 1.2', rpmTxt, false),
            // ── 第 2 页 ──
            N('RPM PICKUP 2.1', rpmTxt, false),
            N('RPM PICKUP 2.2', rpmTxt, false),
            N('SHUTDOWN RESET FROM ECU A', 'OPEN', false),
            N('SHUTDOWN RESET FROM ECU B', 'OPEN', false),
            N('SBW POT. METER', pot(0), false),
            N('MAIN L.O. LOW-LOW PRESS', 'NORMAL', false),
            N('THRUST PAD HIGH-HIGH TEMP', 'NORMAL', false),
            N('T/C LUB.OIL LOW-LOW PRESS', 'NORMAL', false),
            N('J.C.F.W. INLET LOW PRESS', 'NORMAL', false),
            N('EICU A SHUTDOWN NON-CANCELLABLE', 'NORMAL', M.shutDown && !M.cancelSHD && !M.overspeedTripped),
            N('EICU A SHUTDOWN CANCELLABLE', 'NORMAL', M.shutDown && !M.cancelSHD && !M.overspeedTripped),
            N('EICU B SHUTDOWN NON-CANCELLABLE', 'NORMAL', M.shutDown && !M.cancelSHD && !M.overspeedTripped),
            N('EICU B SHUTDOWN CANCELLABLE', 'NORMAL', M.shutDown && !M.cancelSHD && !M.overspeedTripped),
            // ── 第 3 页 ──
            N('SHUTDOWN ACTIVE ACTION A', 'OPEN', false),
            N('SHUTDOWN ACTIVE ACTION B', 'OPEN', false),
            N('AXIAL VIBRATION HIGH', 'NORMAL', false),
            N('OIL MIST HIGH IN CRANKCASE', 'NORMAL', false),
            N('EICU A SLOWDOWN', 'NORMAL', false),
            N('EICU B SLOWDOWN', 'NORMAL', false),
        ];
    }

    /** 依据当前主菜单 / 二级菜单重绘液晶区页面；
     *  页面内所有文字（标题 / 表头 / 选项行 / 软键）统一在绘制后放大 2px */
    _renderMenu() {
        this._renderMenuRaw();
        // 液晶屏显示页面时，整块面板不再可拖动（避免选行/点按钮时误拖面板）
        if (this.group) this.group.draggable(!((this._menuPage && this._subPage) || this._directPage));
        try {
            (this._menuGroup.find('Text') || []).forEach((t) => {
                const fs = typeof t.fontSize === 'function' ? t.fontSize() : 12;
                t.fontSize((fs || 12) + 2);
            });
        } catch (e) { /* ignore */ }
    }

    /** 页面绘制本体（字号按原始值，由 _renderMenu 统一 +2） */
    _renderMenuRaw() {
        if (!this._menuGroup) return;
        this._clearMenuHits();
        this._menuGroup.destroyChildren();
        if (this._directPage === 'estate') {
            this._menuGroup.visible(true);
            this._paintEngineState();
            return;
        }
        if (!this._menuPage || !this._subPage) {
            this._menuGroup.visible(false);
            return;
        }
        this._menuGroup.visible(true);
        const M = this.model;
        const sub = this._subPage;
        const ALARM_KINDS = ['sys-crit', 'sys-nonc', 'comerr-c', 'comerr-n', 'io-fail'];

        // ── Alarms：真机样式，表头紧贴状态条，无标题行 ──
        if (ALARM_KINDS.includes(sub)) {
            this._menuGroup.add(_rect({ x: 126, y: 70, width: 1020, height: 430, fill: '#2b2b2b' }));
            let items = this._alarmItems(sub)
                .map((it) => ({ ...it, st: this._alm(`alm:${sub}-${it.desc}`, it.alarm) }));
            if (this._alarmViewMode === 'active') items = items.filter((it) => it.st !== 'none');
            this._pgListTable(items, 70, { showHeader: true });
            return;
        }
        if (sub === 'psafety') {
            const g = this._menuGroup;
            g.add(_rect({ x: 126, y: 70, width: 1020, height: 430, fill: '#2b2b2b' }));
            const y0 = 70, rowH = 34;
            const cols = [[126, 150, 'Action'], [276, 560, 'Item'], [836, 180, 'Delay (s)']];
            g.add(_rect({ x: 126, y: y0, width: 890, height: 26, fill: '#eceef0', stroke: '#8d9498', strokeWidth: 1 }));
            cols.forEach(([x, w, t]) => g.add(_text({ x: x + 8, y: y0 + 4, width: w, fontSize: 14.5, fill: '#101010', text: t })));
            SAFETY_DELAY_ROWS.forEach((row, i) => {
                const ry = y0 + 26 + i * rowH;
                const d = M.getSafetyDelay ? M.getSafetyDelay(row.key, 6) : 6;
                g.add(_rect({ x: 126, y: ry, width: 890, height: rowH, fill: i % 2 ? '#2b2b2b' : '#323232' }));
                g.add(_rect({ x: 126, y: ry, width: 6, height: rowH, fill: row.kind === 'SHD' ? '#e01717' : '#ffd400' }));
                g.add(_text({ x: 146, y: ry + 9, width: 120, fontSize: 15, fontStyle: 'bold', fill: row.kind === 'SHD' ? '#ff6b6b' : '#ffd400', text: row.kind }));
                g.add(_text({ x: 284, y: ry + 9, width: 540, fontSize: 15, fill: '#ffffff', text: row.label }));
                g.add(_text({ x: 844, y: ry + 9, width: 60, align: 'center', fontSize: 15, fontStyle: 'bold', fill: '#7ef08a', text: String(d) }));
                // 双击该行 → 弹出输入框改延时（热区 id 必须登记，页面重建时才会被 _clearMenuHits 销毁，
                // 否则每重建一次就多叠一层 3% 绿底，多次进出页面后液晶区会发绿）
                const id = `sdel-${row.key}`;
                const hit = this.addClickablePart(id, 126, ry, 890, rowH, null);
                if (hit) {
                    this._menuHitIds.push(id);
                    hit.on('dblclick', (e) => {
                        if (e) e.cancelBubble = true;
                        this._beginSafetyDelayEdit(row.key, 844, ry + 5, 60, 24);
                    });
                }
            });
            g.add(_text({ x: 126, y: y0 + 26 + 6 * rowH + 12, width: 890, align: 'center', fontSize: 14, fill: '#9fd3ff', text: '双击「Delay (s)」数值可修改（0~120 s，回车确认）' }));
            return;
        }
        if (sub === 'history') {
            this._menuGroup.add(_rect({ x: 126, y: 70, width: 1020, height: 430, fill: '#2b2b2b' }));
            const y = 70;
            const g = this._menuGroup;
            const cols = [[126, 90, 'Nack'], [216, 190, 'Date/Time'], [406, 470, 'Description'], [876, 130, 'Event'], [1006, 120, 'Value']];
            g.add(_rect({ x: 126, y, width: 1006, height: 26, fill: '#eceef0', stroke: '#8d9498', strokeWidth: 1 }));
            cols.forEach(([x, w, t]) => g.add(_text({ x: x + 6, y: y + 4, width: w, fontSize: 14.5, fill: '#101010', text: t })));

            const pad = (n) => String(n).padStart(2, '0');
            const fmt = (ts) => {
                const d = new Date(ts || Date.now());
                return `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
            };
            const rows = (this._histRows || []).slice().sort((a, b) => b.t0 - a.t0);
            const acked = !!M.acked;
            rows.forEach((r, i) => {
                const ry = y + 26 + i * 24.5;
                const active = r.state === 'active';
                const color = active ? (acked ? '#ffd400' : '#ff3b30') : '#00c000';
                g.add(_rect({ x: 126, y: ry, width: 1006, height: 24.5, fill: i % 2 ? '#2b2b2b' : '#323232' }));
                g.add(_circle({
                    x: 150, y: ry + 12.2, radius: 6.5,
                    fill: (active && !acked) ? '#ff3b30' : '#ffffff', stroke: '#8d9498', strokeWidth: 1,
                }));
                g.add(_text({ x: 222, y: ry + 4, width: 184, fontSize: 13.5, fill: color, text: fmt(r.t0) }));
                g.add(_text({ x: 412, y: ry + 4, width: 464, fontSize: 13.5, fill: color, text: r.desc }));
                g.add(_text({ x: 1012, y: ry + 4, width: 114, fontSize: 13.5, fill: color, text: r.value }));
            });
            if (!rows.length) {
                g.add(_text({ x: 126, y: y + 60, width: 1006, align: 'center', fontSize: 15, fill: '#9fd3ff', text: '（当前无报警记录）' }));
            }
            return;
        }

        // ── 其它主菜单页面 ──
        if (this._menuPage === 'btn-limiters') {
            const y = this._pgBase('LIMITERS');
            if (sub === 'show') this._paintShowLimiters(y);
            else this._paintSetLimiters(y);
            return;
        }

        if (this._menuPage === 'btn-cpos') {
            const y = this._pgBase('CONTROL POSITION');
            const pos = M.controlPos;
            if (sub === 'overview') {
                [['PORT WING', pos === 'BRIDGE'], ['BRIDGE', pos === 'BRIDGE'], ['STB. WING', pos === 'BRIDGE'],
                    ['ECR', pos === 'ECR'], ['LOCAL', pos === 'LOCAL']].forEach(([label, on], i) => {
                    const bx = 150 + i * 190, by = y + 14;
                    this._menuGroup.add(_rect({ x: bx, y: by, width: 170, height: 62, fill: on ? '#0aaa20' : '#3a3a3a', stroke: '#9fb6c4', strokeWidth: 2, cornerRadius: 4 }));
                    this._menuGroup.add(_text({ x: bx, y: by + 12, width: 170, align: 'center', fontSize: 15, fontStyle: 'bold', fill: '#ffffff', text: label }));
                    this._menuGroup.add(_text({ x: bx, y: by + 34, width: 170, align: 'center', fontSize: 12.5, fill: on ? '#0a2408' : '#9fd3ff', text: on ? 'IN COMMAND' : 'STANDBY' }));
                });
                this._menuGroup.add(_text({ x: 150, y: y + 96, width: 900, fontSize: 15, fill: '#e6ecf2', text: `LEVER  BRIDGE  ${M.lever.rpm.toFixed(1)} rpm      ECR  ${M.rpmCmd.toFixed(1)} rpm` }));
                this._menuGroup.add(_text({ x: 150, y: y + 128, width: 940, fontSize: 13, fill: '#9fd3ff', text: '提示：转移控制位置时先把手柄位置调至一致（bump-less transfer）。' }));
            } else {
                this._menuGroup.add(_text({ x: 150, y: y + 10, width: 900, fontSize: 15, fill: '#e6ecf2', text: `当前控制位置：${pos === 'BRIDGE' ? 'BRIDGE 驾驶台' : (pos === 'ECR' ? 'ECR 集控室' : 'LOCAL 机旁')}` }));
                [['BRIDGE', 'BRIDGE'], ['ECR', 'ECR'], ['LOCAL', 'LOCAL']].forEach(([label], i) => {
                    this._pgSoftKey(150 + i * 240, y + 46, 200, 34, `请求 ${label}`, `menu-cpos-${label}`, () => this.model.setControlPos(label));
                });
                this._menuGroup.add(_text({ x: 150, y: y + 96, width: 940, fontSize: 13, fill: '#9fd3ff', text: 'Transfer：request from new position → ack from old position → new position takes command.' }));
            }
            return;
        }

        if (this._menuPage === 'btn-misc') {
            const y = this._pgBase('MISC MENU');
            if (sub === 'counters') {
                this._menuGroup.add(_text({ x: 136, y: y + 16, width: 500, fontSize: 15, fill: '#e6ecf2', text: `ME Run Hour：${M.runHours.toFixed(1)} h` }));
                this._menuGroup.add(_text({ x: 136, y: y + 52, width: 500, fontSize: 15, fill: '#e6ecf2', text: `Revolutions：${Math.round(M.rev)}` }));
                this._pgSoftKey(700, y + 10, 180, 32, 'RESET counters', 'menu-reset-counters', () => { this.model.runHours = 0; this.model.rev = 0; });
                this._menuGroup.add(_text({ x: 136, y: y + 100, width: 940, fontSize: 13, fill: '#9fd3ff', text: '小时计与转数计可由软键复位（Reset）。' }));
            } else if (sub === 'printer') {
                this._menuGroup.add(_text({ x: 136, y: y + 14, width: 940, fontSize: 15, fill: '#e6ecf2', text: 'Order Printer：命令车钟与状态日志打印（Bridge 命令打印机）' }));
                this._menuGroup.add(_text({ x: 136, y: y + 46, width: 940, fontSize: 14, fill: '#cfd8ff', text: 'Scheduled status logs：06:00 / 10:00 / 14:00 / 18:00 / 22:00 / 02:00' }));
                this._menuGroup.add(_text({ x: 136, y: y + 74, width: 940, fontSize: 14, fill: '#cfd8ff', text: 'Paper：OK（正常）；余量不足时给出 Low on paper 提示' }));
                this._pgSoftKey(700, y + 12, 180, 32, 'PRINT NOW', 'menu-print-now', () => this.model.pushMessage('STATUS LOG PRINTED'));
            } else {
                const items = ['Calibrate lever', 'Set node ID', 'Adjust lever parameters', 'System test',
                    'Buzzer enabled / disabled', 'System status', 'View version'];
                items.forEach((t, i) => {
                    this._pgRow(136, y + 6 + i * 26, 1000, [{ w: 700, text: t }, { w: 280, text: i === 4 ? (M.silenced ? 'DISABLED' : 'ENABLED') : '—' }], { bg: i % 2 ? '#2b2b2b' : '#323232' });
                });
                this._menuGroup.add(_text({ x: 136, y: y + 196, width: 940, fontSize: 13, fill: '#9fd3ff', text: '进入 LTU service page 需输入调试口令（commissioning password）。' }));
            }
            return;
        }

        if (this._menuPage === 'btn-safety') {
            if (sub === 'shd') { this._paintSafetyTable(this._shdItems()); return; }
            if (sub === 'sld') {
                const resetNote = (this._resetSldDone && Date.now() - this._resetSldDone < 3000)
                    ? 'SLOW DOWN RESET — DONE' : '';
                this._paintSafetyTable(this._sldItems(), { note: resetNote });
                return;
            }
            if (sub === 'emstop') { this._paintSafetyTable(this._emItems()); return; }

            // RPM Detector：专用面板（Rpm Detector System 1/2 + 计数器/转速/模拟等）
            this._paintRpmDetector();
            return;
        }

        if (this._menuPage === 'btn-estate') {
            const y = this._pgBase('ENGINE STATE');
            const conds = [
                ['ENGINE NOT READY', !M.engineReady], ['START INTERLOCK', !!M.startBlocked],
                ['3 START FAILURES', !!M.startFail], ['SLOW TURNING OVER-SPEED', false],
                ['START TIME LIMIT', false], ['START AIR PRESSURE LOW', M.startAir < 15],
                ['RPM DETECTOR FAILURE', false], ['BRAKE TIME LIMIT', false],
                ['SAFETY STOP', M.shutDown && !M.cancelSHD], ['ALL AUX. BLOWER FAILURE', M.auxBlowerAlarm],
                ['ENGINE TRIPPED', !!(M.emStopped || M.emStopLatched)], ['START AIR VALVE BLOCKED', !M.mainStartValveOk],
                ['TURNING GEAR ENGAGED', !M.turningGearOut], ['SAFETY SYSTEM OFF', false],
                ['COMM. ERROR DGU-UNIC', false],
            ];
            if (sub === 'interlock') {
                const blocked = conds.filter(([, on]) => on);
                this._menuGroup.add(_text({ x: 136, y: y + 10, width: 940, fontSize: 15, fill: '#e6ecf2', text: '起动联锁（Start interlock）— 下列项目必须先消除才允许起动：' }));
                if (!blocked.length) {
                    this._menuGroup.add(_text({ x: 136, y: y + 46, width: 940, fontSize: 16, fill: '#9fe0a0', text: 'NO INTERLOCK ACTIVE — 可以起动' }));
                } else {
                    blocked.forEach(([n], i) => this._pgRow(136, y + 46 + i * 26, 900, [{ w: 760, text: n, color: '#ff8a8a' }], { bg: i % 2 ? '#2b2b2b' : '#323232' }));
                }
            } else {
                const half = Math.ceil(conds.length / 2);
                conds.forEach(([name, on], i) => {
                    const col = i < half ? 0 : 1, row = i < half ? i : i - half;
                    const x = 136 + col * 510, ry = y + 6 + row * 26;
                    this._menuGroup.add(_rect({ x, y: ry, width: 500, height: 24, fill: row % 2 ? '#2b2b2b' : '#323232' }));
                    this._menuGroup.add(_text({ x: x + 8, y: ry + 4, width: 380, fontSize: 13, fill: '#e6ecf2', text: name }));
                    this._menuGroup.add(_text({ x: x + 396, y: ry + 4, width: 96, align: 'right', fontSize: 13, fontStyle: 'bold', fill: on ? '#ff8a8a' : '#9fe0a0', text: on ? 'ACTIVE' : 'OK' }));
                });
            }
            return;
        }

        if (this._menuPage === 'btn-bwm') {
            if (sub === 'running') { this._paintRunningMode(); return; }
            const y = this._pgBase('B&W MODES');
            if (sub === 'modes') {
                [['Constant fuel mode', 'OFF（燃油量锁定，用于测取示功图）'],
                    ['Shaft generator control mode', 'OFF（轴带发电机恒频控制）'],
                    ['Rough sea mode', 'OFF（PI 调速器粗海况参数组）'],
                    ['Fuel set-point control', 'OFF（按手柄直接给定燃油量）']].forEach(([n, s2], i) => {
                    this._pgRow(136, y + 6 + i * 30, 1000, [{ w: 460, text: n }, { w: 520, text: s2, color: '#cfd8ff' }], { bg: i % 2 ? '#2b2b2b' : '#323232' });
                });
                this._menuGroup.add(_text({ x: 136, y: y + 140, width: 940, fontSize: 13, fill: '#9fd3ff', text: '上述模式由船东/机厂按需配置，部分模式在 Bridge 与 ECR 上不可用。' }));
            } else if (sub === 'slow-turning') {
                this._menuGroup.add(_text({ x: 136, y: y + 14, width: 940, fontSize: 15, fill: '#e6ecf2', text: '慢转起动（Slow turning）：停车超过设定时间后首次起动自动慢转一圈；也可手动按下列软键。' }));
                this._pgSoftKey(136, y + 52, 220, 36, 'SLOW TURNING', 'menu-slow-turn', () => this.model.startEngine(true));
                this._menuGroup.add(_text({ x: 380, y: y + 60, width: 700, fontSize: 14, fill: '#cfd8ff', text: '状态：' + (this.model.slowTurning ? 'RUNNING' : 'STANDBY') }));
            } else {
                this._menuGroup.add(_text({ x: 136, y: y + 14, width: 940, fontSize: 15, fill: '#e6ecf2', text: '气缸预润滑（Cylinder pre/post lubrication）：由十字头轴承滑油驱动预润滑油泵，约 30 s。' }));
                this._pgSoftKey(136, y + 52, 220, 36, 'PRE-LUBRICATION', 'menu-prelub', () => this.model.pushMessage('CYL. PRE-LUBRICATION, RUNNING'));
                this._menuGroup.add(_text({ x: 380, y: y + 60, width: 700, fontSize: 14, fill: '#cfd8ff', text: '可与慢转起动联锁自动执行，也可在 ECR 手动触发。' }));
            }
            return;
        }

        if (this._menuPage === 'btn-param') {
            const y = this._pgBase('PARAM. CHANGE');
            const sets = {
                p0: [['Start air change level', '12 rpm'], ['Start time limit', '15 s'], ['Stop speed order', '0 rpm'],
                    ['Fuel index at start', '2.5 %'], ['Start attempts (repeated start)', '3']],
                p1: [['Brake air level', '45 rpm'], ['Brake time limit', '20 s'], ['Reversing fuel index', '3.0 %'], ['Brake air ON delay', '0.5 s']],
                p2: [['Crash astern lever position', "EM'CY ASTERN"], ['Brake air level', '45 rpm'],
                    ['Fuel/start air change level', '10 rpm'], ['Heavy start limiter', 'ON']],
                p3: [['DGU Kp', '1.20'], ['DGU Ti', '2.50 s'], ['DGU Kd', '0.10'],
                    ['Upper RPM deviation', '8 rpm'], ['Lower RPM deviation', '8 rpm']],
            };
            (sets[sub] || []).forEach(([n, v], i) => {
                const ry = y + 8 + i * 42;
                this._menuGroup.add(_text({ x: 136, y: ry + 8, width: 620, fontSize: 14, fill: '#e6ecf2', text: n }));
                this._menuGroup.add(_rect({ x: 760, y: ry, width: 170, height: 30, fill: '#ffffff', stroke: '#8a9095', strokeWidth: 1.5 }));
                this._menuGroup.add(_text({ x: 766, y: ry + 7, width: 158, align: 'center', fontSize: 14, fontStyle: 'bold', fill: '#101010', text: v }));
            });
            this._menuGroup.add(_text({ x: 136, y: 470, width: 940, fontSize: 12.5, fill: '#9fd3ff', text: '上表为可检视参数（白框内为可调值）。' }));
            return;
        }
    }

    // ── 限制器参数（可调）与显示 ─────────────────────────────

    /** 限制器定义：key / 名称 / 字段（[字段key, 标签, 单位]） */
    _limDefs() {
        return [
            {
                key: 'scav', name: 'Scavenge air pressure limiter',
                fields: [['p1', 'P1', 'bar'], ['f1', 'F1', '%fuel'], ['p2', 'P2', 'bar'],
                    ['f2', 'F2', '%fuel'], ['p3', 'P3', 'bar'], ['f3', 'F3', '%fuel']],
            },
            {
                key: 'torque', name: 'Torque limiter',
                fields: [['r1', 'R1', 'rpm'], ['f1', 'F1', '%fuel'], ['r2', 'R2', 'rpm'],
                    ['f2', 'F2', '%fuel'], ['r3', 'R3', 'rpm'], ['f3', 'F3', '%fuel']],
            },
            {
                key: 'fuelIndex', name: 'Fuel index limiter',
                fields: [['level', 'Level', '%fuel']],
            },
            {
                key: 'slowDown', name: 'Slow-down limiter',
                fields: [['level', 'Level', 'rpm']],
            },
            {
                key: 'steady', name: 'Minimum stable running speed',
                fields: [['rpm', 'MSRS', 'rpm']],
            },
            {
                key: 'chiefRpm', name: 'Manual RPM limiter (Chief)',
                fields: [['ahead', 'FWD', 'rpm'], ['astern', 'AFT', 'rpm']],
            },
            {
                key: 'accel', name: 'Acceleration rate limiter',
                fields: [['rpm', 'END', 'rpm'], ['rate', 'RATE', 'rpm/s']],
            },
            {
                key: 'decel', name: 'Deceleration rate limiter',
                fields: [['rpm', 'STRT', 'rpm'], ['rate', 'RATE', 'rpm/s']],
            },
            {
                key: 'loadUp', name: 'Load Up program limiter',
                fields: [['from', 'FROM', 'rpm'], ['to', 'TO', 'rpm'], ['time', 'TIME', 'min']],
            },
            {
                key: 'loadDown', name: 'Load Down program limiter',
                fields: [['from', 'FROM', 'rpm'], ['to', 'TO', 'rpm'], ['time', 'TIME', 'min']],
            },
            {
                key: 'slowTurn', name: 'Slow turning program',
                fields: [['stopMin', 'STOP', 'min'], ['durS', 'DUR', 's']],
            },
            {
                key: 'critical', name: 'Critical speed limiter',
                fields: [['lo', 'LOW', 'rpm'], ['hi', 'HIGH', 'rpm']],
            },
        ];
    }

    _limState() {
        if (!this._lim) {
            this._lim = {
                scav: { p1: 0, f1: 50, p2: 1.15, f2: 80, p3: 2.3, f3: 100 },
                torque: { r1: 0, f1: 50, r2: 65, f2: 90, r3: 72, f3: 110 },
                fuelIndex: { level: 105 },
                slowDown: { level: 40 },
                steady: { rpm: 21 },
                chiefRpm: { ahead: 68, astern: 55 },
                accel: { rpm: 57, rate: 2 },
                decel: { rpm: 57, rate: -3 },
                loadUp: { from: 57, to: 68, time: 3 },
                loadDown: { from: 57, to: 68, time: 2 },
                slowTurn: { stopMin: 20, durS: 10 },
                critical: { lo: 30, hi: 37 },
            };
            this._limEdit = {};
            Object.keys(this._lim).forEach((k) => { this._limEdit[k] = { ...this._lim[k] }; });
        }
        return this._lim;
    }

    _limDirty(key) {
        const a = this._lim[key] || {}, b = this._limEdit[key] || {};
        return Object.keys(a).some((f) => Number(a[f]) !== Number(b[f]));
    }

    /** 双击文本框 → DOM 输入框编辑 */
    _beginLimEdit(key, field, x, y, w, h) {
        const abs = this.group.getAbsolutePosition();
        const rect = this.sys.stage.container().getBoundingClientRect();
        const inp = document.createElement('input');
        inp.type = 'text';
        inp.value = String(this._limEdit[key][field]);
        Object.assign(inp.style, {
            position: 'fixed', left: `${rect.left + abs.x + x}px`, top: `${rect.top + abs.y + y}px`,
            width: `${w}px`, height: `${h}px`, fontSize: '14px', textAlign: 'center',
            boxSizing: 'border-box', zIndex: '9999', border: '2px solid #1395eb',
        });
        document.body.appendChild(inp);
        this._limEditing = true;
        let closed = false;
        const done = (commit) => {
            if (closed) return;
            closed = true;
            if (commit) {
                const v = parseFloat(inp.value);
                if (Number.isFinite(v)) this._limEdit[key][field] = v;
            }
            inp.remove();
            this._limEditing = false;
            this._renderMenu();
            this._redraw();
        };
        inp.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') done(true);
            else if (e.key === 'Escape') done(false);
        });
        inp.addEventListener('blur', () => done(true));
        setTimeout(() => { inp.focus(); inp.select(); }, 0);
    }

    /** RPM Detector 页状态（保存在模型里，两块面板共享：编辑值 + 两个试验开关） */
    _detState() {
        const M = this.model;
        if (!M.overspeedTest) {
            M.overspeedTest = {
                simOn: false, simRpm: 65.0, osTestOn: false, osTestRpm: 78.0, osLevel: 78.0,
                msg: '', msgUntil: 0,
            };
        }
        return M.overspeedTest;
    }

    /** 双击 RPM Detector 可编辑框 → DOM 输入框（仅 ECR） */
    /** Param. Change → Safety：双击延时数值弹出输入框（回车确认） */
    _beginSafetyDelayEdit(key, x, y, w, h) {
        const M = this.model;
        if (!M || !M.setSafetyDelay) return;
        const abs = this.group.getAbsolutePosition();
        const rect = this.sys.stage.container().getBoundingClientRect();
        const inp = document.createElement('input');
        inp.id = `ac600_delay_${key}`;
        inp.type = 'text';
        inp.value = String(M.getSafetyDelay(key, 6));
        Object.assign(inp.style, {
            position: 'fixed', left: `${rect.left + abs.x + x}px`, top: `${rect.top + abs.y + y}px`,
            width: `${w}px`, height: `${h}px`, fontSize: '14px', textAlign: 'center',
            boxSizing: 'border-box', zIndex: '9999', border: '2px solid #1395eb',
        });
        document.body.appendChild(inp);
        this._limEditing = true;                  // 编辑期间暂停页面自动重建
        let closed = false;
        const done = (commit) => {
            if (closed) return;
            closed = true;
            if (commit) {
                const v = parseFloat(inp.value);
                if (Number.isFinite(v)) M.setSafetyDelay(key, v);
            }
            inp.remove();
            this._limEditing = false;
            this._renderMenu();
            this._redraw();
        };
        inp.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') done(true);
            else if (e.key === 'Escape') done(false);
        });
        inp.addEventListener('blur', () => done(true));
        setTimeout(() => { inp.focus(); inp.select(); }, 0);
    }

    _beginDetEdit(field, x, y, w, h) {
        if (this.variant !== 'ecr') return;
        const D = this._detState();
        const abs = this.group.getAbsolutePosition();
        const rect = this.sys.stage.container().getBoundingClientRect();
        const inp = document.createElement('input');
        inp.type = 'text';
        inp.value = String(D[field]);
        Object.assign(inp.style, {
            position: 'fixed', left: `${rect.left + abs.x + x}px`, top: `${rect.top + abs.y + y}px`,
            width: `${w}px`, height: `${h}px`, fontSize: '14px', textAlign: 'center',
            boxSizing: 'border-box', zIndex: '9999', border: '2px solid #1395eb',
        });
        document.body.appendChild(inp);
        this._detEditing = true;
        let closed = false;
        const done = (commit) => {
            if (closed) return;
            closed = true;
            if (commit) {
                const v = parseFloat(inp.value);
                if (Number.isFinite(v)) D[field] = v;
            }
            inp.remove();
            this._detEditing = false;
            this._renderMenu();
            this._redraw();
        };
        inp.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') done(true);
            else if (e.key === 'Escape') done(false);
        });
        inp.addEventListener('blur', () => done(true));
        setTimeout(() => { inp.focus(); inp.select(); }, 0);
    }

    /**
     * RPM Detector 页（照真机版式）：
     *   白底文本框 = 可编辑（Overspeed Level / Rpm Simulate / Overspeed Test Level）
     *   灰底文本框 = 只读（Pickup1/2、Engine Rpm、Revolution Counter、Running Hours）
     *   仅 ECR 面板可操作（Reset 清零、OFF⇄ON 切换、双击白框改值）；BRIDGE 面板本页不可操作
     */
    _paintRpmDetector() {
        const M = this.model;
        const D = this._detState();
        const canOp = this.variant === 'ecr';
        const g = this._menuGroup;
        g.add(_rect({ x: 126, y: 70, width: 1020, height: 430, fill: '#b9bdc0' }));

        const C_RO = '#bfc4c8';                 // 只读（灰底）
        const C_RW = '#ffffff';                 // 可编辑（白底）

        const lab = (x, y, t, w = 220, fs = 13.5) =>
            g.add(_text({ x, y, width: w, fontSize: fs, fill: '#101010', text: t }));

        /** 文本框：editable=true 用白底；field 非空且 ECR 时注册双击编辑热区 */
        const tbox = (x, y, w, h, val, field, editable) => {
            g.add(_rect({
                x, y, width: w, height: h,
                fill: editable ? C_RW : C_RO, stroke: '#202020', strokeWidth: 1.6,
            }));
            g.add(_text({
                x, y: y + (h - 18) / 2, width: w, align: 'center',
                fontSize: 14, fill: '#101010', text: val,
            }));
            if (!editable || !field || !canOp) return;
            const id = `det-edit-${field}`;
            const hit = this.addClickablePart(id, x, y, w, h);
            hit.on('click tap', (e) => {
                e.cancelBubble = true;
                const now = Date.now(), last = this._detLastClick;
                if (last && last.field === field && now - last.t < 450) {
                    this._detLastClick = null;
                    this._beginDetEdit(field, x, y, w, h);
                } else {
                    this._detLastClick = { field, t: now };
                }
            });
            this._menuHitIds.push(id);
        };

        /** 按钮：BRIDGE 只画不响应（不注册热区）；enabled=false 时灰显（仍可点，用于给出拒绝提示） */
        const btn = (x, y, w, h, t, id, onDown, enabled = true) => {
            g.add(_rect({
                x, y, width: w, height: h,
                fill: enabled ? '#cfd3d6' : '#bdc2c6', stroke: '#5f6669', strokeWidth: 1.6, cornerRadius: 2,
            }));
            g.add(_text({
                x, y: y + (h - 18) / 2, width: w, align: 'center', fontSize: 14,
                fill: enabled ? '#1a3fa0' : '#7b838a', text: t,
            }));
            if (!canOp) return;
            const hit = this.addClickablePart(id, x, y, w, h);
            hit.on('click tap', (e) => { e.cancelBubble = true; onDown(); this._renderMenu(); this._redraw(); });
            this._menuHitIds.push(id);
        };

        const lamp = (cx, cy, on, color) => {
            g.add(_circle({
                x: cx, y: cy, radius: 11,
                fill: on ? color : '#f4f6f7', stroke: on ? '#3a7a12' : '#a9aeb2', strokeWidth: 1.6,
            }));
            if (on) g.add(_circle({ x: cx - 4, y: cy - 5, radius: 3.6, fill: 'rgba(255,255,255,0.7)' }));
        };

        /** 系统框（legend 标题压在上边框） */
        const sysBox = (x, y, w, h, title) => {
            g.add(_rect({ x, y, width: w, height: h, fill: 'rgba(0,0,0,0)', stroke: '#101010', strokeWidth: 2 }));
            const tw = Math.max(150, title.length * 8.2 + 20);
            g.add(_rect({ x: x + 18, y: y - 11, width: tw, height: 22, fill: '#b9bdc0' }));
            g.add(_text({ x: x + 26, y: y - 10, width: tw, fontSize: 15, fill: '#101010', text: title }));
        };

        const stopped = !!M.isStopped;                     // 停机状态才允许做超速保护试验
        const shownRpm = M.rpm;                            // 探头/Engine Rpm 显示主机实际转速（模拟值只做超速试验）
        const rpmTxt = `${shownRpm.toFixed(1)} rpm`;
        const ahead = shownRpm > 0.05;
        const astern = shownRpm < -0.05;
        const dirLabel = ahead ? 'Ahead' : 'Astern';

        // ── 两个测速系统（Pickup 值为只读灰框） ──
        [['Rpm Detector System 1', 150], ['Rpm Detector System 2', 650]].forEach(([title, bx]) => {
            sysBox(bx, 100, 450, 176, title);
            ['Pickup1', 'Pickup2'].forEach((pname, pi) => {
                const px = bx + 18 + pi * 216;
                lab(px, 112, pname, 176, 14);
                tbox(px, 132, 176, 32, rpmTxt, null, false);
                lab(px, 178, dirLabel, 176, 14);
                lamp(px + 120, 188, ahead || astern, '#35e01b');   // 检出转向才亮绿
                lab(px, 212, 'Fail', 176, 14);
                lamp(px + 120, 222, false, '#e01818');
            });
        });

        // ── 两排（灯 / OFF 按钮 / 值框三列对齐） ──
        const R1 = 310, R2 = 388, BH = 32;
        // 第 1 排
        lab(160, 284, 'Revolution Counter');
        tbox(160, R1, 170, BH, String(Math.round(M.rev)), null, false);
        btn(344, R1, 78, BH, 'Reset', 'det-reset-rev', () => { this.model.rev = 0; });

        lab(480, 284, 'Engine Rpm');
        tbox(480, R1, 170, BH, rpmTxt, null, false);

        lab(700, 284, 'Rpm Simulate', 200);
        lamp(712, R1 + BH / 2, !!D.simOn, '#35e01b');
        btn(730, R1, 84, BH, D.simOn ? 'ON' : 'OFF', 'det-sim-toggle',
            () => { this.model.toggleOverspeedTest('sim'); }, D.simOn || stopped);
        tbox(826, R1, 168, BH, `${D.simRpm.toFixed(1)} rpm`, 'simRpm', true);

        // 第 2 排（与第 1 排同列、同 y 基准）
        lab(160, 362, 'Running Hours');
        tbox(160, R2, 170, BH, M.runHours.toFixed(1), null, false);
        btn(344, R2, 78, BH, 'Reset', 'det-reset-hours', () => { this.model.runHours = 0; });

        lab(480, 362, 'Overspeed Level');
        tbox(480, R2, 170, BH, `${D.osLevel.toFixed(1)} rpm`, 'osLevel', true);

        lab(700, 362, 'Overspeed Test Level', 200);
        lamp(712, R2 + BH / 2, !!D.osTestOn, '#35e01b');
        btn(730, R2, 84, BH, D.osTestOn ? 'ON' : 'OFF', 'det-os-toggle',
            () => { this.model.toggleOverspeedTest('os'); }, D.osTestOn || stopped);
        tbox(826, R2, 168, BH, `${D.osTestRpm.toFixed(1)} rpm`, 'osTestRpm', true);

        // 底部提示（超速动作 / 拒绝操作 / 停机互锁 / BRIDGE 只读）
        const tripped = !!(M.overspeedTripped && M.shutDown && !M.cancelSHD);
        const msgOn = !!(D.msg && Date.now() < D.msgUntil);
        let hint = '白底数值框可双击编辑；Reset 清零计数/运行时间；两个开关都打到 ON 后，把模拟转速调过超速试验值即触发超速停车。';
        let hintColor = '#4a5155';
        if (tripped) {
            hint = 'OVERSPEED SHUT DOWN — 超速保护已动作：燃油切断、主机停车';
            hintColor = '#c40000';
        } else if (msgOn) {
            hint = D.msg;
            hintColor = '#c40000';
        } else if (!canOp) {
            hint = '本面板（BRIDGE）该页仅作显示，操作请在集控台（ECR）进行。';
        } else if (!stopped) {
            hint = '主机运行中：超速保护试验只能在停机状态进行，两个 OFF 不能切到 ON。';
            hintColor = '#a05a00';
        }
        g.add(_text({ x: 160, y: 444, width: 940, fontSize: 12, fill: hintColor, text: hint }));
    }

    /**
     * 单条报警的状态机：
     *   'unack' 未应答（红色，动作中）
     *   'acked' 已应答但故障仍在（黄色）
     *   'rtn'   故障已恢复但未应答（红色，Value 显示 NORMAL，等 ACK）
     *   'none'  正常 / 已应答且已恢复（消失）
     */
    _alm(key, active) {
        if (!this._almState) this._almState = {};
        let st = this._almState[key];
        if (!st) st = this._almState[key] = { seen: false, on: false, acked: false };
        // 故障"新出现"时：若当前这批报警已被整体确认（M.acked），该项也按已确认处理（一次确认全部变黄）
        if (active && !st.on) st.acked = !!this.model.acked;
        if (active) { st.seen = true; st.on = true; } else st.on = false;
        if (st.on) return st.acked ? 'acked' : 'unack';
        if (!st.seen) return 'none';
        return st.acked ? 'none' : 'rtn';
    }

    /** 应答：故障仍在的项目转为"已确认"（黄）；已恢复的项目确认后消失 */
    _ackAlarms() {
        const S = this._almState || {};
        Object.keys(S).forEach((k) => {
            const st = S[k];
            if (st.on) st.acked = true;
            else delete S[k];
        });
    }

    /** 每帧轮询报警状态（即使页面没打开也要更新，供菜单灯与本页着色使用） */
    _pollAlarms() {
        const M = this.model;
        const now = Date.now();
        if (this._almPollAt && now < this._almPollAt) return;
        this._almPollAt = now + 200;
        const live = !!(M.emStopped || (M.shutDown && !M.cancelSHD));
        const os = !!M.overspeedTripped;
        // 慢降复位（车钟拉到 40 rpm 以下）→ Slow Down 页的报警项一并恢复正常（不需要再按 ACK）
        const sldNow = !!(M.slowDown && !M.cancelSLD);
        if (this._sldPrev === true && !sldNow) {
            Object.keys(this._almState || {}).forEach((k) => { if (k.startsWith('sld:')) delete this._almState[k]; });
        }
        this._sldPrev = sldNow;
        this._alm('shd:trip', live);
        this._alm('shd:os', os);
        this._alm('shd:os-sw1', os);
        this._alm('shd:os-sw2', os);
        // Shut Down 页 EICU 四项（页面未打开也要登记，确认后才不会残留未确认状态）
        const eicuP = live && !os && !M.loLowLowShd && !M.jcwLowShd;
        const eicuCanP = eicuP && !!M.shutDown && !M.cancelSHD;
        this._alm('shd:eicu-a-nc', eicuP);
        this._alm('shd:eicu-b-nc', eicuP);
        this._alm('shd:eicu-a-c', eicuCanP);
        this._alm('shd:eicu-b-c', eicuCanP);
        this._alm('alm:sys-nonc-START FAIL/BLOCK', !!(M.startBlocked || M.startFail));
        // Emg. Stop 页：燃油切断 + 按下位置的那一个急停开关（未确认红 / 已确认黄）
        const emLive = !!(M.emStopped || M.emStopLatched);
        const emBy = M.emStopBy || M.controlPos;
        this._alm('em:fuel', emLive);
        ['bridge', 'ecr', 'local'].forEach((k) => {
            this._alm(`em:${k}`, emLive && emBy === k.toUpperCase());
        });
        this._alm('em:stbd', false);
        this._alm('em:port', false);
        // 三个 Cancel 产生的报警（与超速同一套状态机）
        this._alm('alm:sys-nonc-SHUTDOWN CANCELLED', !!this._cancel.shd);
        this._alm('alm:sys-nonc-SLOWDOWN CANCELLED', !!this._cancel.sld);
        this._alm('alm:sys-nonc-LIMITS CANCEL FROM ACP', !!this._cancel.lim);
        // Alarm History：跟踪本次出现过的报警项（报警栏每一条）
        {
            const msgs = M.messages || [];
            if (!this._histRows) this._histRows = [];
            const cur = new Set(msgs);
            this._histRows.forEach((r) => {
                if (r.state === 'active' && !cur.has(`${r.desc}, ${r.value}`)) {
                    r.state = 'normal';          // 已恢复 → 绿色记忆
                    r.value = 'NORMAL';
                }
            });
            msgs.forEach((m) => {
                const i = m.lastIndexOf(', ');
                const desc = i > 0 ? m.slice(0, i) : m;
                const val = i > 0 ? m.slice(i + 2) : 'ACTIVE';
                if (!this._histRows.some((r) => r.desc === desc && r.state === 'active')) {
                    this._histRows.push({ desc, value: val, state: 'active', t0: Date.now() });
                }
            });
        }
        // Safety 菜单指示灯：任一停车项未消除（动作中或已恢复未应答）都算
        this._shdAlarmLive = ['shd:trip', 'shd:os', 'shd:os-sw1', 'shd:os-sw2'].some((k) => {
            const st = this._almState[k];
            return st && (st.on || (st.seen && !st.acked));
        });
    }

    /** 某项是否已被逐项越控（页 + key） */
    _safIsCancelled(page, key) { return !!(this._safCancelled && this._safCancelled[`${page}:${key}`]); }

    /** 标记某项已越控 */
    _safMarkCancelled(page, key) {
        if (!this._safCancelled) this._safCancelled = {};
        this._safCancelled[`${page}:${key}`] = true;
    }

    /** 清除某页的全部逐项越控标记 */
    _clearSafCancelled(page) {
        if (!this._safCancelled) return;
        Object.keys(this._safCancelled).forEach((k) => { if (k.startsWith(page + ':')) delete this._safCancelled[k]; });
    }

    /**
     * Shut Down 页条目（照真机 13 行，各行指示灯按真机分布）：
     *   ENGINE TRIPPED〔A〕/ FUEL CUT-OUT SOL. V/V〔无灯〕/ OVERSPEED FROM RPM UNIT〔A+L〕/
     *   MAIN L.O. LOW-LOW PRESS〔A〕/ THRUST PAD·T/C LUB.OIL·J.C.F.W.〔A+C+L〕/
     *   EICU A/B NON-CANCELLABLE〔A+L〕/ EICU A/B CANCELLABLE〔A+C+L〕/ OVERSPEED SYS.1·2〔A〕
     * 带 Cancelled 灯的项目动作时行尾出现「Cancel SHD」，可逐项越控。
     */
    _shdItems() {
        const M = this.model;
        const live = !!(M.emStopped || (M.shutDown && !M.cancelSHD));   // 紧急停车也算停车动作中
        // 停车动作由「有」变「无」时才清逐项越控（避免刚点 Cancel SHD 就被下一次重绘清掉）
        const nowOn = !!(M.shutDown || M.overspeedTripped || M.emStopped);
        if (this._safPrevShd && !nowOn) this._clearSafCancelled('shd');
        this._safPrevShd = nowOn;
        const C = (k) => this._safIsCancelled('shd', k);
        const mk = (key, desc, opt = {}) => ({
            key, desc,
            value: opt.value || (opt.active ? 'ACTIVE' : 'NORMAL'),
            active: !!opt.active,
            st: this._alm(`shd:${key}`, !!opt.active),
            cancelled: C(key),
            hasA: opt.hasA !== false,
            hasC: !!opt.hasC,
            hasL: !!opt.hasL,
            loopfail: !!opt.loopfail,
            btn: opt.hasC ? 'Cancel SHD' : '',
            onCancel: () => { this._safMarkCancelled('shd', key); if (opt.after) opt.after(); this._safRecheckShd(); },
        });
        const os = !!M.overspeedTripped;
        const eicuLive = live && !os && !M.loLowLowShd && !M.jcwLowShd;   // 有明确原因时 EICU 组不亮
        // 紧急停车属"不可越控"停车：只亮 NON-CANCELLABLE 两行；CANCELLABLE 两行仅安保停车时出现
        const eicuCan = eicuLive && !!M.shutDown && !M.cancelSHD;
        return [
            mk('trip', 'ENGINE TRIPPED', { active: live }),
            mk('fuel', 'FUEL CUT-OUT SOL. V/V', { value: live ? 'OPEN' : 'CLOSED', active: false, hasA: false }),
            mk('os', 'OVERSPEED FROM RPM UNIT', {
                active: os, value: os ? 'SHUTDN' : 'NORMAL', hasL: true,
                after: () => { M.overspeedTripped = false; },
            }),
            mk('lo', 'MAIN L.O. LOW-LOW PRESS', {
                active: !!M.loLowLowShd, value: M.loLowLowShd ? 'SHUTDN' : 'NORMAL',
            }),
            mk('thrust', 'THRUST PAD HIGH-HIGH TEMP', { active: false, hasC: true, hasL: true }),
            mk('tc', 'T/C LUB.OIL LOW-LOW PRESS', { active: false, hasC: true, hasL: true }),
            mk('jcw', 'J.C.F.W. INLET LOW PRESS', {
                active: !!M.jcwLowShd, value: M.jcwLowShd ? 'SHUTDN' : 'NORMAL', hasC: true, hasL: true,
            }),
            mk('eicu-a-nc', 'EICU A SHUTDOWN NON-CANCELLABLE', { active: eicuLive, value: 'NORMAL', hasL: true }),
            mk('eicu-a-c', 'EICU A SHUTDOWN CANCELLABLE', { active: eicuCan, hasC: true, hasL: true }),
            mk('eicu-b-nc', 'EICU B SHUTDOWN NON-CANCELLABLE', { active: eicuLive, value: 'NORMAL', hasL: true }),
            mk('eicu-b-c', 'EICU B SHUTDOWN CANCELLABLE', { active: eicuCan, hasC: true, hasL: true }),
            mk('os-sw1', 'OVERSPEED SYS.1 - SW BACKUP', { active: os, value: os ? 'SHUTDN' : 'NORMAL' }),
            mk('os-sw2', 'OVERSPEED SYS.2 - SW BACKUP', { active: os, value: os ? 'SHUTDN' : 'NORMAL' }),
        ];
    }

    /** Slow Down 页条目：所有项目都有 Active + Cancelled 灯，仅 4 个回路（AXIAL VIB / OIL MIST / EICU A·B）带 Loop fail 灯 */
    _sldItems() {
        const M = this.model;
        const live = !!M.slowDown;                    // 已触发的减速不受 Cancel SLD 影响
        // 有明确减速原因（滑油温度高 / 缸套水出口温度高等）时，EICU 组不再跟着点亮
        const eicuLive = live && !Object.keys(M.sldCauses || {}).length && !M.sldAwaitReset;
        // 降速动作由「有」变「无」时才清逐项越控
        if (this._safPrevSld && !M.slowDown) this._clearSafCancelled('sld');
        this._safPrevSld = !!M.slowDown;
        const C = (k) => this._safIsCancelled('sld', k);
        // hasL 只在 4 个回路为真
        const mk = (key, desc, opt = {}) => ({
            key, desc,
            value: opt.value || (opt.active ? 'ACTIVE' : 'NORMAL'),
            active: !!opt.active,
            st: this._alm(`sld:${key}`, !!opt.active),
            cancelled: C(key),
            hasA: true,
            hasC: true,
            hasL: !!opt.hasL,
            loopfail: !!opt.loopfail,
            btn: 'Cancel SLD',
            onCancel: () => { this._safMarkCancelled('sld', key); this._safRecheckSld(); },
        });
        return [
            mk('sld', 'SLOWDOWN ACTIVE', { active: live }),
            mk('lo-p', 'MAIN L.O. INLET PRESS LOW'),
            mk('lo-t', 'MAIN L.O.INLET TEMP HIGH', {
                active: !!(M.sldCauses && M.sldCauses['ME-LO-T']),
                value: (M.sldCauses && M.sldCauses['ME-LO-T']) ? 'SLOWDN' : 'NORMAL',
            }),
            mk('pco-nf', 'P.C.O. COOLING OIL NON FLOW'),
            mk('pco-t', 'P.C.O. OUTLET TEMP HIGH'),
            mk('thrust', 'THRUST PAD TEMP HIGH'),
            mk('mbrg', 'MAIN BEARING TEMP & DEV. HIGH'),
            mk('hps', 'HPS BEARING TEMP HIGH'),
            mk('jcw-p', 'JACKET C.F.W. INLET PRESS LOW'),
            mk('jcw-t', 'JACKET C.F.W. OUTLET TEMP HIGH', {
                active: !!(M.sldCauses && M.sldCauses['CW-T']),
                value: (M.sldCauses && M.sldCauses['CW-T']) ? 'SLOWDN' : 'NORMAL',
            }),
            mk('scav', 'SCAV. AIR TEMP HIGH'),
            mk('exh-t', 'EXH. GAS OUTLET TEMP HIGH'),
            mk('exh-d', 'EXH. GAS OUTLET TEMP DEV. HIGH'),
            mk('vib', 'AXIAL VIBRATION HIGH', { hasL: true }),
            mk('mist', 'OIL MIST HIGH IN CRANKCASE', {
                hasL: true,
                active: !!(M.sldCauses && M.sldCauses['ME-MIST']),
                value: (M.sldCauses && M.sldCauses['ME-MIST']) ? 'SLOWDN' : 'NORMAL',
            }),
            mk('wear', 'BEARING WEAR SLOWDOWN'),
            mk('eicu-a', 'EICU A SLOWDOWN', { active: eicuLive, hasL: true }),
            mk('eicu-b', 'EICU B SLOWDOWN', { active: eicuLive, hasL: true }),
            mk('cyl', 'CYL. COVER C.W. OUTLET TEMP HIGH'),
            mk('stern', 'STERN TUBE BEARING (AFT) T.H.'),
            mk('thr-r', 'THRUST RADIAL BEARING TEMP HIGH'),
            mk('jcw-l', 'M/E JCW ACROSS CYL. LINE DPL'),
            mk('jcw-c', 'M/E JCW ACROSS CYL. COV/EXH VV DPL'),
        ];
    }

    /** Emg. Stop 页条目：仅第一行（FUEL CUT-OUT SOL. V/V）无灯；急停开关为 Active + Loop fail（不可越控，无 Cancelled 灯） */
    _emItems() {
        const M = this.model;
        const em = !!(M.emStopped || M.emStopLatched);
        const by = M.emStopBy || M.controlPos;
        const mk = (key, desc, active) => ({
            key, desc, value: active ? 'PRESSED' : 'NORMAL', active,
            st: this._alm(`em:${key}`, active),                 // 未确认=红 / 已确认=黄
            cancelled: false, hasA: true, hasC: false, hasL: true, loopfail: false, btn: '',
        });
        return [
            { key: 'fuel', desc: 'FUEL CUT-OUT SOL. V/V', value: em ? 'OPEN' : 'CLOSED', active: em, cancelled: false, hasA: false, hasC: false, hasL: false, btn: '',
              st: this._alm('em:fuel', em) },
            mk('bridge', 'EMERGENCY STOP SWITCH BRIDGE', em && by === 'BRIDGE'),
            mk('ecr', 'EMERGENCY STOP SWITCH ECR', em && by === 'ECR'),
            mk('local', 'EMERGENCY STOP SWITCH LOCAL', em && by === 'LOCAL'),
            mk('stbd', 'EMERGENCY STOP SWITCH STBD WING', false),
            mk('port', 'EMERGENCY STOP SWITCH PORT WING', false),
        ];
    }

    /** 总越控：把某页所有「带 Cancelled 灯」的项目一次性越控（on=true）/ 恢复（on=false） */
    _safCancelAll(page, on) {
        if (!this._safCancelled) this._safCancelled = {};
        const items = page === 'shd' ? this._shdItems() : this._sldItems();
        items.forEach((it) => {
            if (!it.hasC) return;
            const k = `${page}:${it.key}`;
            if (on) this._safCancelled[k] = true; else delete this._safCancelled[k];
        });
        this._renderMenu();
        this._redraw();
    }

    /** 切换某项的越控状态（点一次取消该故障的自动停车/自动减速，再点一次还原） */
    _safToggle(page, key) {
        if (!this._safCancelled) this._safCancelled = {};
        const k = `${page}:${key}`;
        if (this._safCancelled[k]) delete this._safCancelled[k];
        else this._safCancelled[k] = true;
        if (page === 'shd') this._safRecheckShd();
        else if (page === 'sld') this._safRecheckSld();
        this._renderMenu();
        this._redraw();
    }

    /** 本页所有「可越控且动作中」的项目都越控 → 解除自动停车；有任一项还原 → 恢复自动停车 */
    _safRecheckShd() {
        const canc = this._shdItems().filter((it) => it.active && it.btn);
        if (canc.length) {
            const all = canc.every((it) => it.cancelled);
            this.model.cancelSHD = all;
            this._safAutoShd = all;
        } else if (this._safAutoShd) {
            this.model.cancelSHD = false;
            this._safAutoShd = false;
        }
    }

    /** 同上（自动减速） */
    _safRecheckSld() {
        const canc = this._sldItems().filter((it) => it.active && it.btn);
        if (canc.length) {
            const all = canc.every((it) => it.cancelled);
            this.model.cancelSLD = all;
            this._safAutoSld = all;
        } else if (this._safAutoSld) {
            this.model.cancelSLD = false;
            this._safAutoSld = false;
        }
    }

    /**
     * Safety 表格（照真机版式）：
     *   Active | Cancelled | Loop fail | Description | Value | Alarms    ← 之后为空白区
     * · 每行只画该项自身具备的指示灯（hasA / hasC / hasL）；
     * · **点击某一行 → 该行选中**（底色变亮）；若该行有 Cancelled 灯，其右侧空白区出现
     *   `Cancel SHD` / `Cancel SLD` 按钮；点一次取消该故障的自动停车/自动减速（Cancelled 灯变红），
     *   再点一次还原；
     * · `_safetyViewMode = 'active'` 时只显示故障项（再点该子菜单切换）。
     */
    _paintSafetyTable(items, opt) {
        const g = this._menuGroup;
        const o = opt || {};
        const x0 = 126, W = 1020, rowW = W - 14;
        const colA = { x: x0, w: 76 }, colC = { x: x0 + 76, w: 82 }, colL = { x: x0 + 158, w: 92 };
        const colD = { x: x0 + 250, w: 404 }, colV = { x: x0 + 654, w: 140 };
        const colAl = { x: x0 + 794, w: 106 };
        const blankX = colAl.x + colAl.w;        // Alarms 之后的空白区（不放任何列表内容）

        g.add(_rect({ x: x0, y: 70, width: W, height: 430, fill: '#2b2b2b' }));

        // 表头（白底黑字）
        const hy = 70, hh = 26;
        g.add(_rect({ x: x0, y: hy, width: W, height: hh, fill: '#eceef0', stroke: '#8d9498', strokeWidth: 1 }));
        [[colA.x + 4, colA.w, 'Active'], [colC.x + 4, colC.w, 'Cancelled'], [colL.x + 4, colL.w, 'Loop fail'],
            [colD.x + 6, colD.w, 'Description'], [colV.x + 6, colV.w, 'Value'], [colAl.x + 6, colAl.w, 'Alarms']]
            .forEach(([x, w, t]) => g.add(_text({ x, y: hy + 4, width: w, fontSize: 13.5, fill: '#101010', text: t })));
        [colC.x, colL.x, colD.x, colV.x, colAl.x].forEach((x) => {
            g.add(_line({ points: [x, hy, x, hy + hh], stroke: '#8d9498', strokeWidth: 1 }));
        });

        // 两种显示状态：全部 / 仅故障项
        const mode = this._safetyViewMode || 'all';
        const list = mode === 'active'
            ? items.filter((it) => (it.st || (it.active ? 'unack' : 'none')) !== 'none')
            : items;

        const rowH = 23.5, bodyTop = hy + hh;
        const maxRows = Math.floor((500 - bodyTop) / rowH);
        const total = list.length;
        const maxOff = Math.max(0, total - maxRows);
        const off = Math.min(Math.max(0, this._listOffset || 0), maxOff);
        this._listOffset = off;

        const selKey = (this._safSel && this._safSel.page === this._subPage) ? this._safSel.key : null;
        const btnLabel = this._subPage === 'sld' ? 'Cancel SLD' : 'Cancel SHD';

        list.slice(off, off + maxRows).forEach((it, i) => {
            const ry = bodyTop + i * rowH;
            const st = it.st || (it.active ? 'unack' : 'none');
            const cancelled = !!it.cancelled;
            const act = st === 'unack' || st === 'acked';       // 动作中（含已确认仍在）
            const isSel = it.key === selKey;
            let fill = st === 'unack' ? '#4d0f0f' : ((off + i) % 2 ? '#2b2b2b' : '#323232');
            if (isSel) fill = st === 'unack' ? '#6d1414' : '#414141';       // 选中行底色变亮
            g.add(_rect({ x: x0, y: ry, width: rowW, height: rowH, fill }));

            // 指示灯（只画该项具备的那几列；Cancelled 越控后变红）
            const lamp = (cx, on, color) => {
                g.add(_circle({
                    x: cx, y: ry + rowH / 2, radius: 6.5,
                    fill: on ? color : '#e9edf0',
                    stroke: on ? '#5a5f63' : '#9aa1a5', strokeWidth: 1.2,
                }));
            };
            if (it.hasA !== false) lamp(colA.x + colA.w / 2, act, '#e01818');
            if (it.hasC) lamp(colC.x + colC.w / 2, cancelled, '#e01818');
            if (it.hasL) lamp(colL.x + colL.w / 2, !!it.loopfail, '#e8d000');

            const color = cancelled ? '#f0a000'
                : (st === 'acked' ? '#f0d040' : (act || st === 'rtn' ? '#ff4040' : '#00c000'));
            g.add(_text({ x: colD.x + 6, y: ry + 4, width: colD.w - 10, fontSize: 13, fill: color, text: it.desc }));
            g.add(_text({
                x: colV.x + 6, y: ry + 4, width: colV.w - 10, fontSize: 13,
                fill: color, text: st === 'rtn' ? 'NORMAL' : (it.value || ''),
            }));
            g.add(_text({
                x: colAl.x + 6, y: ry + 4, width: colAl.w - 10, fontSize: 13,
                fill: st === 'acked' ? '#f0d040' : '#ff6060',
                text: act ? 'AL. CLOSE' : '',
            }));

            // 整行点击 → 选中/取消选中
            const rid = `saf-row-${it.key || i}`;
            const rhit = this.addClickablePart(rid, x0, ry, rowW, rowH);
            rhit.on('click tap', (e) => {
                e.cancelBubble = true;
                this._safSel = (selKey === it.key) ? null : { page: this._subPage, key: it.key };
                this._renderMenu();
                this._redraw();
            });
            this._menuHitIds.push(rid);
        });

        // 选中行有 Cancelled 灯 → 其右侧空白区出现逐项越控按钮
        const selRow = list.find((it) => it.key === selKey);
        if (selRow && selRow.hasC) {
            const si = list.indexOf(selRow);
            if (si >= off && si < off + maxRows) {
                const ry = bodyTop + (si - off) * rowH;
                const bx = blankX + 4, by = ry + 2, bw = 1128 - bx, bh = rowH - 4;
                g.add(_rect({
                    x: bx, y: by, width: bw, height: bh, cornerRadius: 3,
                    fill: '#2f5ea8', stroke: '#9fd3ff', strokeWidth: 1.2,
                }));
                g.add(_text({
                    x: bx, y: by + 1, width: bw, align: 'center',
                    fontSize: 10.5, fontStyle: 'bold', fill: '#ffffff', text: btnLabel,
                }));
                const id = `saf-cancel-${selRow.key}`;
                const hit = this.addClickablePart(id, bx, by, bw, bh);
                hit.on('click tap', (e) => {
                    e.cancelBubble = true;
                    this._safToggle(this._subPage, selRow.key);
                });
                this._menuHitIds.push(id);
            }
        }

        if (!total) {
            g.add(_text({
                x: x0, y: bodyTop + 30, width: W, align: 'center', fontSize: 15, fill: '#9fd3ff',
                text: mode === 'active' ? 'NO ACTIVE ALARMS' : 'NO ITEMS',
            }));
        }

        // 滚动条（长列表翻页）
        g.add(_rect({ x: 1132, y: hy, width: 14, height: 500 - hy, fill: '#c9ccce', stroke: '#8d9498', strokeWidth: 1 }));
        g.add(_line({ points: [1139, hy + 6, 1145, hy + 13, 1133, hy + 13], closed: true, fill: off > 0 ? '#3a3f42' : '#9aa1a5', stroke: '#3a3f42', strokeWidth: 1 }));
        g.add(_line({ points: [1139, 494, 1145, 487, 1133, 487], closed: true, fill: off < maxOff ? '#3a3f42' : '#9aa1a5', stroke: '#3a3f42', strokeWidth: 1 }));
        if (maxOff > 0) {
            const trackH = 500 - hy - 32;
            const thumbH = Math.max(24, trackH * (maxRows / total));
            const thumbY = hy + 16 + (trackH - thumbH) * (off / maxOff);
            g.add(_rect({ x: 1134, y: thumbY, width: 10, height: thumbH, fill: '#8d9498', stroke: '#5c6366', strokeWidth: 1, cornerRadius: 2 }));
        }
        const pageRows = Math.max(1, maxRows - 1);
        this._mkMenuBtn('saf-scroll-up', 1128, hy + 2, 20, 20, () => { this._listOffset = Math.max(0, off - pageRows); });
        this._mkMenuBtn('saf-scroll-down', 1128, 478, 20, 20, () => { this._listOffset = Math.min(maxOff, off + pageRows); });

        if (o.note) {
            g.add(_text({ x: x0 + 6, y: 500 + 2, width: W, fontSize: 13, fill: '#ffd24d', text: o.note }));
        }
    }

    /**
     * Show Limiters：LIMITER / STATUS / LEVEL
     * · **Cancel Limits 激活**时：除「最低稳定转速」「临界转速」「扫气压力限制」「转矩限制」外，
     *   其余各项 STATUS 一律显示 `CANCELLED`（限制功能已越控）；
     * · 同时**扫气压力 / 转矩限制**每一项的燃油开度（油门）**+10 %**，LEVEL 里的数字**标红**；
     *   不激活时恢复初始值、数字恢复常规颜色。
     */
    _paintShowLimiters(y) {
        const M = this.model;
        const L1 = this._limState();
        const cancel = !!M.cancelLimits;
        const boost = cancel ? 10 : 0;                     // 扫气/转矩每点燃油开度 +10 %
        const numColor = cancel ? '#ff4040' : '#e6ecf2';   // 数字标红
        const scavPts = [
            [L1.scav.p1 + ' bar', L1.scav.f1 + boost],
            [L1.scav.p2 + ' bar', L1.scav.f2 + boost],
            [L1.scav.p3 + ' bar', L1.scav.f3 + boost],
        ];
        const torqPts = [
            [L1.torque.r1 + ' rpm', L1.torque.f1 + boost],
            [L1.torque.r2 + ' rpm', L1.torque.f2 + boost],
            [L1.torque.r3 + ' rpm', L1.torque.f3 + boost],
        ];
        /** 分段彩色文字：压力/转速常规色，燃油开度数字按 numColor */
        const segsOf = (pts) => {
            const segs = [];
            pts.forEach(([a, b], i) => {
                if (i) segs.push(['；', '#e6ecf2']);
                segs.push([`${a}-`, '#e6ecf2']);
                segs.push([`${b} %`, numColor]);
            });
            return segs;
        };

        const COLS = [{ w: 310 }, { w: 180 }, { w: 510 }];
        this._pgRow(136, y + 6, 1000, [
            { w: COLS[0].w, text: 'LIMITER' }, { w: COLS[1].w, text: 'STATUS' }, { w: COLS[2].w, text: 'LEVEL' },
        ], { bg: '#454545' });

        // ── 各限制器是否"激活"（按车钟给定与实际转速实时判定）──
        const cmd = M.rpmCmd, act = M.rpm;
        const accelerating = (cmd - act) > 1;
        const decelerating = (cmd - act) < -1;
        const inRange = (v, a, b) => v >= Math.min(a, b) && v <= Math.max(a, b);
        const maxRpmLimit = cmd >= 0 ? L1.chiefRpm.ahead : L1.chiefRpm.astern;
        const slowTurnOn = (M.stoppedTime || 0) >= L1.slowTurn.stopMin * 60;
        const critOn = inRange(cmd, L1.critical.lo, L1.critical.hi);
        const maxRpmOn = Math.abs(cmd) > Math.abs(maxRpmLimit);
        // 最低稳定转速：车钟不在 STOP、且给定转速绝对值低于该值时才激活
        const steadyOn = Math.abs(cmd) > 0.5 && Math.abs(cmd) < L1.steady.rpm;
        const loadUpOn = accelerating && inRange(act, L1.loadUp.from, L1.loadUp.to);
        const loadDownOn = decelerating && inRange(act, L1.loadDown.from, L1.loadDown.to);
        const A = (v) => (v ? 'ACTIVE' : 'INACTIVE');
        /** Cancel Limits 越控后统一显示 CANCELLED（exempt=true 的项目不受影响） */
        const S = (txt, exempt) => ((cancel && !exempt) ? 'CANCELLED' : txt);

        // 3 点折线插值：给定 x 求允许的最大燃油输出（Cancel Limits 时曲线整体 +10 %）
        const interp3 = (x, xs, ys) => {
            const px = [xs[0], xs[1], xs[2]], py = [ys[0], ys[1], ys[2]];
            for (let i = 0; i < 2; i++) {
                const a = px[i], b = px[i + 1];
                if ((x >= a && x <= b) || (x <= a && x >= b)) {
                    const span = b - a;
                    return span === 0 ? py[i] : py[i] + (py[i + 1] - py[i]) * ((x - a) / span);
                }
            }
            return x < Math.min(px[0], px[2]) ? py[0] : py[2];
        };
        const fuel = M.fuelIndex;
        const scavAllow = interp3(M.scavAir, [L1.scav.p1, L1.scav.p2, L1.scav.p3], scavPts.map((p2) => p2[1]));
        const torqAllow = interp3(M.rpm, [L1.torque.r1, L1.torque.r2, L1.torque.r3], torqPts.map((p2) => p2[1]));
        const scavOn = fuel > scavAllow;
        const torqOn = fuel > torqAllow;

        const rows = [
            { name: 'Scavenge air pressure limiter', stat: A(scavOn), rich: true, segs: segsOf(scavPts) },
            { name: 'Torque limiter', stat: A(torqOn), rich: true, segs: segsOf(torqPts) },
            { name: 'Fuel index limiter', stat: S((M.loadLimit && !M.cancelLimits) ? 'LIMITING' : 'INACTIVE'), lvl: `${L1.fuelIndex.level} %` },
            { name: 'Slow-down limiter', stat: S((M.slowDown && !M.cancelSLD) ? 'ACTIVE' : 'INACTIVE'), lvl: `${L1.slowDown.level} rpm` },
            { name: 'Minimum stable running speed', stat: S(A(steadyOn), true), lvl: `${L1.steady.rpm} rpm` },
            { name: 'Manual RPM limiter (Chief)', stat: S(A(maxRpmOn)), lvl: `${L1.chiefRpm.ahead} / ${L1.chiefRpm.astern} rpm` },
            { name: 'Acceleration rate limiter', stat: S(A(accelerating)), lvl: `${L1.accel.rpm} rpm, ${L1.accel.rate} rpm/s` },
            { name: 'Deceleration rate limiter', stat: S(A(decelerating)), lvl: `${L1.decel.rpm} rpm, ${L1.decel.rate} rpm/s` },
            { name: 'Load Up program limiter', stat: S(A(loadUpOn)), lvl: `${L1.loadUp.from}~${L1.loadUp.to} rpm, ${L1.loadUp.time} min` },
            { name: 'Load Down program limiter', stat: S(A(loadDownOn)), lvl: `${L1.loadDown.from}~${L1.loadDown.to} rpm, ${L1.loadDown.time} min` },
            { name: 'Slow turning program', stat: S(A(slowTurnOn)), lvl: `${L1.slowTurn.stopMin} min, ${L1.slowTurn.durS} s` },
            { name: 'Critical speed limiter', stat: S(A(critOn), true), lvl: `${L1.critical.lo.toFixed(1)}~${L1.critical.hi.toFixed(1)} rpm` },
        ];
        rows.forEach((r, i) => {
            const ry = y + 36 + i * 26;
            const bg = i % 2 ? '#2b2b2b' : '#323232';
            const statusColor = (r.stat === 'ACTIVE' || r.stat === 'LIMITING') ? '#ffb0b0'
                : (r.stat === 'CANCELLED' ? '#ff6060' : '#9fe0a0');
            if (r.rich) {
                // 前两项：LEVEL 用分段彩色文字（燃油开度数字标红）
                this._pgRow(136, ry, 1000, [
                    { w: COLS[0].w, text: r.name },
                    { w: COLS[1].w, text: r.stat, color: statusColor },
                ], { bg });
                this._pgRichText(136 + 8 + COLS[0].w + COLS[1].w, ry + 4, r.segs);
            } else {
                this._pgRow(136, ry, 1000, [
                    { w: COLS[0].w, text: r.name },
                    { w: COLS[1].w, text: r.stat, color: statusColor },
                    { w: COLS[2].w, text: r.lvl },
                ], { bg });
            }
        });
    }

    /** Set Limiters：每行参数横向等间距文本框 + 行尾 SAVE / CANCEL；双击文本框可编辑 */
    _paintSetLimiters(y) {
        this._limState();
        const g = this._menuGroup;
        const defs = this._limDefs();

        g.add(_text({ x: 136, y: y + 2, width: 940, fontSize: 12.5, fill: '#9fd3ff', text: '双击文本框修改参数；每行末尾 SAVE 保存、CANCEL 还原（未修改时 SAVE 不可用）' }));

        const rowH = 33, top = y + 22;
        const nameW = 210, boxW = 65, boxH = 24;   // 框宽 −5 → 框间间距相应增大
        const areaX = 136 + nameW + 8;        // 文本框区起点
        const saveX = 952, cancelX = 1034;

        defs.forEach((d, ri) => {
            const ry = top + ri * rowH;
            // 行背景
            g.add(_rect({ x: 136, y: ry, width: 1000, height: rowH - 4, fill: ri % 2 ? '#2b2b2b' : '#323232' }));
            // 名称
            g.add(_text({ x: 144, y: ry + 7, width: nameW - 8, fontSize: 12.5, fill: '#e6ecf2', text: d.name }));

            // 固定 6 槽等间距文本框（各行文本框左右对齐）
            const SLOTS = 6;
            const span = (saveX - 14) - areaX;
            const step = span / SLOTS;
            d.fields.forEach(([f, label, unit], fi) => {
                const bx = Math.round(areaX + fi * step + (step - boxW) / 2);
                const by = ry + 4;
                g.add(_rect({ x: bx, y: by, width: boxW, height: boxH, fill: '#ffffff', stroke: '#8a9095', strokeWidth: 1.2 }));
                g.add(_text({
                    x: bx + 2, y: by + 4, width: boxW - 4, align: 'center', fontSize: 12.5,
                    fontStyle: 'bold', fill: '#101010', text: String(this._limEdit[d.key][f]),
                }));
                // 参数名 / 单位（框右侧小字）
                g.add(_text({ x: bx + boxW + 3, y: by + 6, width: 34, fontSize: 9, fill: '#9fd3ff', text: label }));
                // 双击编辑热区
                const hit = this.addClickablePart(`lim-${d.key}-${f}`, bx, by, boxW, boxH);
                hit.on('click tap', (e) => {
                    e.cancelBubble = true;
                    const now = Date.now();
                    const last = this._limLastClick;
                    if (last && last.key === d.key && last.field === f && now - last.t < 450) {
                        this._limLastClick = null;
                        this._beginLimEdit(d.key, f, bx, by, boxW, boxH);
                    } else {
                        this._limLastClick = { key: d.key, field: f, t: now };
                    }
                });
                this._menuHitIds.push(`lim-${d.key}-${f}`);
            });

            // SAVE / CANCEL（每行独立；dirty 时 SAVE 才可用）
            const dirty = this._limDirty(d.key);
            const mkBtn = (bx, label, enabled, onClick, id) => {
                g.add(_rect({
                    x: bx, y: ry + 4, width: 74, height: 22, cornerRadius: 3,
                    fill: enabled ? '#d8dde2' : '#7b8186', stroke: '#5f6669', strokeWidth: 1.4,
                }));
                g.add(_text({
                    x: bx, y: ry + 7, width: 74, align: 'center', fontSize: 12, fontStyle: 'bold',
                    fill: enabled ? '#101010' : '#c8ccd0', text: label,
                }));
                if (enabled) {
                    const hit = this.addClickablePart(id, bx, ry + 4, 74, 22);
                    hit.on('click tap', (e) => { e.cancelBubble = true; onClick(); this._renderMenu(); this._redraw(); });
                    this._menuHitIds.push(id);
                }
            };
            mkBtn(saveX, 'SAVE', dirty, () => {
                this._lim[d.key] = { ...this._limEdit[d.key] };
                // 慢转参数影响自动起动行为 → 同步到模型
                const M = this.model;
                M.limits = M.limits || {};
                const LL = M.limits;
                if (d.key === 'slowTurn') {
                    M.slowTurnStopMin = this._lim.slowTurn.stopMin;
                    M.slowTurnDurS = this._lim.slowTurn.durS;
                } else if (d.key === 'accel') {
                    LL.accelRate = this._lim.accel.rate;
                } else if (d.key === 'decel') {
                    LL.decelRate = Math.abs(this._lim.decel.rate);
                } else if (d.key === 'loadUp') {
                    LL.loadUpFrom = this._lim.loadUp.from;
                    LL.loadUpTo = this._lim.loadUp.to;
                    LL.loadUpTime = this._lim.loadUp.time;
                } else if (d.key === 'loadDown') {
                    LL.loadDownFrom = this._lim.loadDown.from;
                    LL.loadDownTo = this._lim.loadDown.to;
                    LL.loadDownTime = this._lim.loadDown.time;
                } else if (d.key === 'critical') {
                    LL.critLo = this._lim.critical.lo;
                    LL.critHi = this._lim.critical.hi;
                    LL.critRiseSp = this._lim.critical.hi;      // 升速避下限 = 上限
                    LL.critFallSp = this._lim.critical.hi + 13; // 降速避上限 = 上限上方 13 rpm（默认 50）
                } else if (d.key === 'chiefRpm') {
                    LL.maxAhead = this._lim.chiefRpm.ahead;
                    LL.maxAstern = this._lim.chiefRpm.astern;
                } else if (d.key === 'steady') {
                    LL.steadyMin = this._lim.steady.rpm;
                }
            }, `lim-save-${d.key}`);
            mkBtn(cancelX, 'CANCEL', dirty, () => {
                this._limEdit[d.key] = { ...this._lim[d.key] };
            }, `lim-cancel-${d.key}`);
        });
    }

    /** Engine Running Mode 页面：两个按钮切换，选中项高亮（简洁版式） */
    _paintRunningMode() {
        const M = this.model;
        const g = this._menuGroup;
        g.add(_rect({ x: 126, y: 70, width: 1020, height: 430, fill: '#1414a8' }));

        // 标题
        g.add(_text({
            x: 126, y: 92, width: 1020, align: 'center',
            fontSize: 22, fontStyle: 'bold', fill: '#ffe000', text: 'Engine Running Mode',
        }));

        // 两个并排切换按钮（选中：绿底白字亮边；未选：浅灰底深色字）
        const bw = 320, bh = 112, gap = 64;
        const totalW = bw * 2 + gap;
        const x0 = 126 + (1020 - totalW) / 2;
        const by = 218;
        [['ECONOMY', 'Economy mode'], ['EMISSION', 'Emission mode']].forEach(([key, label], i) => {
            const on = (M.runMode || 'ECONOMY') === key;
            const bx = x0 + i * (bw + gap);
            g.add(_rect({
                x: bx, y: by, width: bw, height: bh,
                fill: on ? '#12a81a' : '#e2e6e9',
                stroke: on ? '#0a6b16' : '#8a9095', strokeWidth: on ? 4 : 2, cornerRadius: 8,
            }));
            g.add(_text({
                x: bx, y: by + 42, width: bw, align: 'center',
                fontSize: 22, fontStyle: 'bold', fill: on ? '#ffffff' : '#1b1f21', text: label,
            }));
            this._mkMenuBtn(`menu-runmode-${key.toLowerCase()}`, bx, by, bw, bh, () => {
                this.model.runMode = key;
            });
        });
    }

    /** Engine State 页面：三个白边圆角框 + 指示灯列表（照 AutoChief 600 真机版式） */
    _paintEngineState() {
        const M = this.model;
        const g = this._menuGroup;
        g.add(_rect({ x: 126, y: 70, width: 1020, height: 430, fill: '#1414a8' }));

        const boxes = [
            {
                x: 140, y: 88, w: 272, h: 392, title: 'STATE',
                items: [
                    ['Start Blocked', !!(M.startBlocked || !M.turningGearOut || !M.mainStartValveOk || !M.airDistributorOk || M.startAir < 15), 'alarm'],
                    ['Ready for Start', !!M.engineReady && !M.running && !M.starting
                        && Math.abs(M.rpmCmd) < 0.5 && Math.abs(M.rpm) <= 25, 'warn'],
                    ['Delayed Start', false, 'warn'],
                    ['Preparing Start', !!M.starting && !M.mainStartValveOpen, 'warn'],
                    ['Starting', !!M.starting && !!M.mainStartValveOpen, 'warn'],
                    ['Repeated Start', !!M.startFail, 'alarm'],
                    ['Runing', !!M.running, 'ok'],
                    ['Stopping', (Math.abs(M.rpmCmd) < 0.5 || (M.shutDown && !M.cancelSHD)) && Math.abs(M.rpm) > 25, 'warn'],
                    ['Engine Tripped', !!(M.emStopped || M.emStopLatched || (M.shutDown && !M.cancelSHD) || M.overspeedTripped), 'alarm'],
                ],
            },
            {
                x: 428, y: 88, w: 316, h: 392, title: 'START FAIL/BLOCK',
                items: [
                    ['Start failed', !!M.startFail, 'alarm'],
                    ['Start air pressure low', M.startAir < 15, 'alarm'],
                    ['Engine tripped', !!(M.emStopped || M.emStopLatched || (M.shutDown && !M.cancelSHD)), 'alarm'],
                    ['Start Blocked', !!(M.startBlocked || !M.turningGearOut || !M.mainStartValveOk || !M.airDistributorOk || M.startAir < 15), 'alarm'],
                    ['Engine Blocked', !(M.mainStartValveOk && M.airDistributorOk) || !!M.controlAirVented, 'alarm'],
                    // 突然停车 = 无人为指令、无安保动作，主机自行停转（应急停车是人为指令，不触发本故障）
                    ['Sudden Stop', !!(Math.abs(M.rpm) < 1 && !M.running && !M.starting && !M.startFail
                        && Math.abs(M.rpmCmd) > 0.5 && !M.shutDown && !M.emStopped && !M.overspeedTripped), 'alarm'],
                ],
            },
            {
                x: 760, y: 88, w: 372, h: 392, title: 'ENGINE NOT READY',
                items: [
                    ['Start air distributor blocked', !M.airDistributorOk, 'alarm'],
                    ['Main start valve blocked', !M.mainStartValveOk, 'alarm'],
                    ['Turning gear engaged', !M.turningGearOut, 'alarm'],
                    ['Control air vented', !!M.controlAirVented || M.controlAir < 5, 'alarm'],
                    ['Engine not ready ECS', !M.engineReady && !M.startBlocked, 'alarm'],
                ],
            },
        ];

        boxes.forEach((b) => {
            g.add(_rect({ x: b.x, y: b.y, width: b.w, height: b.h, stroke: '#ffffff', strokeWidth: 3, cornerRadius: 16 }));
            g.add(_text({
                x: b.x + 8, y: b.y + 12, width: b.w - 16, align: 'center',
                fontSize: 21, fontStyle: 'bold', fill: '#ffe000', text: b.title,
            }));
            b.items.forEach(([label, on, tone], i) => {
                const cx = b.x + 30, cy = b.y + 66 + i * 35;
                // 指示灯三色：白（未激活）/ 橙（准备·进行中）/ 绿（运行）/ 红（故障）
                const col = !on ? '#f2f2f2'
                    : (tone === 'ok' ? '#00c000' : (tone === 'warn' ? '#f0a000' : '#e01818'));
                const stk = !on ? '#b9bcbe'
                    : (tone === 'ok' ? '#007a00' : (tone === 'warn' ? '#a06a00' : '#8f0f0f'));
                g.add(_circle({ x: cx, y: cy, radius: 13, fill: col, stroke: stk, strokeWidth: 1.5 }));
                g.add(_text({
                    x: cx + 20, y: cy - 10, width: b.w - 58, fontSize: 18,
                    fill: on ? '#ffffff' : '#e8ecf2', text: label,
                }));
            });
        });
    }

    /** 菜单按钮左侧流程灯：主菜单常态隐藏（仅故障亮红）；二级菜单常态白色（故障红） */
    _updateBandLamps() {
        const M = this.model;
        const cells = this._bandCells || this._mainMenuCells();
        const sub = !this._menuPage;
        // Alarms 菜单灯只在报警列表里确有触发项时亮；慢降只亮 Safety System（不再点亮 Misc Menu）
        const hasAlarmItem = ['sys-crit', 'sys-nonc', 'comerr-c', 'comerr-n', 'io-fail']
            .some((k) => this._alarmItems(k).some((it) => this._alm(`alm:${k}-${it.desc}`, it.alarm) !== 'none'));
        const faults = {
            alarms: hasAlarmItem, limiters: !!(M.loadLimit && !M.cancelLimits),
            misc: false,
            safety: !!(M.shutDown || M.emStopped || M.emStopLatched || M.slowDown),
            estate: !!(M.startBlocked || M.startFail || !M.engineReady),
        };
        this._bandLamps.forEach(({ ci, ri, node }) => {
            const cell = cells.find((c) => c.ci === ci && c.ri === ri);
            if (!cell) { node.visible(false); return; }
            let has;
            if (!this._menuPage) {
                // 主菜单：按菜单类别判断
                has = !!faults[cell.key];
            } else if (this._menuPage === 'btn-safety') {
                // Safety 二级按钮：只有与该故障相关的那一项亮灯（超速停车只亮 Shut Down）
                const map = {
                    shd: !!this._shdAlarmLive || !!(M.emStopped || M.emStopLatched),
                    sld: !!M.slowDown,
                    'reset-sld': false,
                    emstop: !!(M.emStopped || M.emStopLatched),
                    detector: false,
                    home: false,
                };
                has = !!map[cell.key];
            } else if (this._menuPage === 'btn-alarms') {
                // 二级按钮：该子页内是否存在未复位（报警）项
                const kinds = ['sys-crit', 'sys-nonc', 'comerr-c', 'comerr-n', 'io-fail'];
                has = kinds.includes(cell.key)
                    && this._alarmItems(cell.key).some((it) => this._alm(`alm:${cell.key}-${it.desc}`, it.alarm) !== 'none');
            } else {
                const keyMap = { 'btn-safety': 'safety', 'btn-estate': 'estate', 'btn-limiters': 'limiters', 'btn-misc': 'misc' };
                has = !!faults[keyMap[this._menuPage] || 'misc'];
            }
            node.visible(has);              // 常态不显示
            node.fill('#e01717');
            node.stroke('#8f0f0f');
        });
    }

    // ═══════════════════════════════════════════════════════
    //  每帧刷新
    // ═══════════════════════════════════════════════════════

    _angleFor(v, lo, hi) {
        const pct = Math.max(0, Math.min(1, (v - lo) / ((hi - lo) || 1)));
        return 180 + pct * 180;
    }

    /** 车钟部件：箭头应指向手柄当前位置，而不是整列中心 */
    getClickablePartCenter(partId) {
        if (partId === 'telegraph' && this._telSlider) {
            const abs = this.group.getAbsoluteTransform().point({
                x: L.tel.x + L.tel.w / 2,
                y: this._telSlider.y(),
            });
            if (abs) return abs;
        }
        return super.getClickablePartCenter(partId);
    }

    tick() {
        const M = this.model;
        if (!M) return;
        this._pollAlarms();

        // 状态条
        const segOn = [M.engineMode === 'SEA', M.engineMode === 'SEA', M.controlPos === CONTROL_POS.ECR, M.running, M.engineReady];
        segOn.forEach((on, i) => {
            if (i === 2) {
                // 控制位置：转移中显示 Control Transfer（黄底黑字）；否则 Bridge（绿）/ ECR（黄）/ Local（红）
                const pos = M.controlPos;
                if (M.transferReq) {
                    this._segText[i].text('Control Transfer');
                    this._segHi[i].fill(C_YELLOW);
                    this._segHi[i].opacity(1);
                    this._segText[i].fill('#101010');
                    return;
                }
                const isBridge = pos === CONTROL_POS.BRIDGE;
                const isLocal = pos === CONTROL_POS.LOCAL;
                this._segText[i].text(isBridge ? 'Bridge' : (isLocal ? 'Local' : 'ECR'));
                this._segHi[i].fill(isBridge ? '#0aaa20' : (isLocal ? '#d81e1e' : C_YELLOW));
                this._segHi[i].opacity(1);
                this._segText[i].fill(isBridge || isLocal ? '#ffffff' : '#101010');
            } else if (i === 3) {
                // 主机备车状态：Eng. Ready（绿）/ Eng. Not Ready（红）
                const ready = !!M.engineReady;
                this._segHi[i].fill(ready ? '#28c72a' : '#d81e1e');
                this._segHi[i].opacity(ready ? 0.22 : 1);
                this._segText[i].text(ready ? 'Eng. Ready' : 'Eng. Not Ready');
                this._segText[i].fill(ready ? '#ffffff' : '#ffffff');
            } else if (i === 1) {
                // Engine Running Mode：经济模式（绿）/ 排放模式（红）
                const emission = M.runMode === 'EMISSION';
                this._segText[i].text(emission ? 'Emission Mode' : 'Economy Mode');
                this._segHi[i].fill(emission ? '#d81e1e' : '#28c72a');
                this._segHi[i].opacity(emission ? 1 : (on ? 0.22 : 0));
                this._segText[i].fill(emission ? '#ffffff' : (on ? '#ffffff' : '#93c393'));
            } else {
                this._segHi[i].fill('#28c72a');
                this._segHi[i].opacity(on ? 0.22 : 0);
                this._segText[i].fill(on ? '#ffffff' : '#93c393');
            }
        });

        // 仪表
        const g = this._gauges;
        g.rpm.needle.rotation(this._angleFor(M.rpm, -120, 120));
        g.rpm.value.text(`${M.rpm.toFixed(1)} RPM`);
        g.rpm.state.text(M.stateText);
        // 第二行红色原因：应急停车 / 停车 / 慢降
        const reason = M.overspeedTripped
            ? 'Overspeed'
            : ((M.loLowLowShd || M.jcwLowShd) ? 'Safety Shut Down'
            : (M.shutDown
                ? (M.cancelSHD ? 'Emergency Stop (Overridden)' : 'Emergency Stop')
                : (M.slowDown ? 'Slow Down' : '')));
        g.rpm.reason.text(reason);
        g.rpm.reason.visible(!!reason);
        g.air.needle.rotation(this._angleFor(M.startAir, 0, 40));
        g.air.value.text(`${M.startAir.toFixed(1)} bar`);
        g.load.needle.rotation(this._angleFor(M.load, 0, 100));
        g.load.value.text(`${M.load.toFixed(1)} %`);

        // SETP / LEVER
        const barY = (v) => L.setp.y + L.setp.h * (1 - (Math.max(-120, Math.min(120, v)) + 120) / 240);
        const sp = (typeof M.setp === 'number') ? M.setp : M.rpmCmd;
        this._setpTri.y(barY(sp));
        // LEVER 显示主机给定：只有拥有控制权的面板车钟能改变它（无控制权时拖动车钟只动手柄）
        const myLever = (typeof M.rpmCmd === 'number') ? M.rpmCmd : M.rpm;
        this._leverTri.y(barY(myLever));
        this._setpVal.text(`${sp.toFixed(1)} RPM`);
        if (this._limiterTxt) {
            const lim = M.activeLimiter || '';
            this._limiterTxt.text(lim);
            this._limiterTxt.visible(!!lim);
        }
        this._leverVal.text(`${myLever.toFixed(1)} RPM`);

        this._runHour.text(`ME Run Hour:${M.runHours.toFixed(1)}`);
        this._rev.text(`Rev: ${Math.round(M.rev)}`);

        // 越控灯
        this._cancelLamp.shd.fill(this._cancel.shd ? '#e01717' : '#ffffff');
        this._cancelLamp.sld.fill(this._cancel.sld ? '#e01717' : '#ffffff');
        this._cancelLamp.lim.fill(this._cancel.lim ? '#e01717' : '#ffffff');

        // 报警铃
        // 紧急停车（按下/未复位）期间：报警铃与蜂鸣器都不响
        const emSilent = !!(M.emStopped || M.emStopLatched);
        this._bellRing.opacity((!emSilent && M.alarm && !M.silenced && M.blink) ? 0.5 : 0);

        // 菜单页面：打开时按 500 ms 节流刷新（数据实时变化；含 Estate 直接页面）
        if (((this._menuPage && this._subPage) || this._directPage) && !this._detEditing && !this._limEditing) {
            const now = Date.now();
            if (!this._menuNextRefresh || now >= this._menuNextRefresh) {
                this._menuNextRefresh = now + 500;
                this._renderMenu();
            }
        }
        // 越控只有在拥有控制权时作用于主机：切到本面板后把本面板已按下的状态同步过去
        // 系统自动越控（应急倒车）→ 只点亮控制权面板的 Cancel Limits 指示灯（按钮灯不跨面板同步）
        if (M.autoCancelLimits && M.controlPos === this.posKey && !this._cancel.lim) {
            this._cancel.lim = true;
            M.setCancel('LIM', true, this.posKey);
            M.autoCancelLimits = false;
        }

        // 慢降预报警弹窗：温度越限、延时未到且未越控时显示
        if (this._popupGroup) {
            const show = !!M.sldPre && !M.cancelSLD;
            if (this._popupGroup.visible() !== show) this._popupGroup.visible(show);
        }

        this._updateBandLamps();

        // ── 菜单流程指示灯 + 报警信息栏 ──
        const msgs = (M.messages && M.messages.length) ? M.messages : (M.alarmText ? [M.alarmText] : []);
        const faults = {
            'btn-alarms': ['sys-crit', 'sys-nonc', 'comerr-c', 'comerr-n', 'io-fail']
                .some((k) => this._alarmItems(k).some((it) => this._alm(`alm:${k}-${it.desc}`, it.alarm) !== 'none'))
                ? (msgs.length ? msgs : ['ALARM, ACTIVE']) : [],
            'btn-limiters': (M.loadLimit && !M.cancelLimits) ? ['LOAD LIMIT, ACTIVE'] : [],
            'btn-misc': [],
            'btn-safety': ((M.shutDown && !M.cancelSHD) || M.emStopped || M.emStopLatched)
                ? ['SHUT DOWN, ACTIVE']
                : (M.slowDown ? ['SLOW DOWN, ACTIVE'] : []),
            'btn-estate': M.startBlocked ? ['START BLOCK, ACTIVE']
                : (M.startFail ? ['START FAILURE, ACTIVE']
                    : (!M.engineReady ? ['ENGINE NOT READY, ACTIVE'] : [])),
            'btn-cpos': [], 'btn-bwm': [], 'btn-param': [], 'btn-home': [],
        };
        this._menuFaults = faults;
        Object.entries(this._menuLamps || {}).forEach(([id, lamp]) => {
            const has = (faults[id] || []).length > 0;
            lamp.visible(has);
            if (has) lamp.fill('#e01717');   // 常亮，不闪烁
        });

        // 报警栏：点开某菜单时显示该菜单的具体故障，否则显示最新两条报警信息；正常时空白
        // 报警栏始终显示最新两条报警信息（与真机一致；不随打开的菜单切换）
        const lines = M.alarm ? msgs.slice(0, 2) : [];
        if (this._alarmFill) this._alarmFill.visible(lines.length > 0);
        (this._alarmLines || []).forEach((t, i) => {
            t.text(lines[i] || '');
            t.opacity(1);              // 常亮，不闪烁
        });

        // 车钟：本面板车钟位置驱动滑条；只有落在整档上才绿色高亮
        const myPos = (M.leverPosAt ? M.leverPosAt(this.posKey) : (M.leverPos || 0));
        const near = Math.max(0, Math.min(10, Math.round(myPos)));
        const onDetent = Math.abs(myPos - near) <= 0.02;      // 正好在整档
        // 驾驶台：机旁车令与本车钟不一致时，对应档位灯**闪烁**（提示机旁请求的车令）
        const locRpm = M.leverRpm ? M.leverRpm.LOCAL : null;
        // 只在机旁手柄确实给出车令（不在 STOP）时提示；机旁手柄停在 STOP 不算"请求"
        const locActive = locRpm != null && Math.abs(locRpm) > 0.5;
        // ⚠ 还要**机旁确实参与操纵**才提示：控制权在机旁，或正在与机旁做控制权转移。
        //    控制权在驾驶台时机旁手柄只是"预置"（起动系统工况下三处车钟都在 NAV FULL），
        //    若也闪烁会与"本档高亮"混淆 —— 驾驶台一动档，NAV FULL 就一直闪
        const locRelevant = M.controlPos === CONTROL_POS.LOCAL
            || !!(M.transferReq && (M.transferReq.to === CONTROL_POS.LOCAL
                || M.transferReq.from === CONTROL_POS.LOCAL));
        const showLocalReq = this.posKey === CONTROL_POS.BRIDGE && locActive && locRelevant
            && Math.abs(locRpm - myLever) > 1;
        const locNear = showLocalReq ? Math.round(M.leverPosAt ? M.leverPosAt(CONTROL_POS.LOCAL) : 0) : -1;
        (this._telText || []).forEach((t, i) => {
            const on = onDetent && i === near;
            const req = i === locNear;
            t.fill(req ? (M.blink ? '#00e000' : '#b9c0c6') : (on ? '#00e000' : '#b9c0c6'));
            t.fontStyle((on || req) ? 'bold' : '');
        });
        if (this._telSlider && !this._telManualDrag) {
            this._telSlider.y(L.tel.rowTop + myPos * L.tel.rowGap);
        }

        // RPM CMD
        // RPM CMD = 本面板车钟的实际车令（无控制权时为手柄位置，仅作显示）
        this._rpmCmdText.text(String(Math.round(
            (M.leverRpm && M.leverRpm[this.posKey] !== undefined) ? M.leverRpm[this.posKey] : M.rpmCmd)));

        // 蜂鸣器：报警时闪
        if (this._buzzGlow) {
            // 蜂鸣器只由『车钟操作 / 控制权转换 / 副车钟操作』触发（M.buzzerOn），其它报警一律不鸣响
            const buzzOn = M.buzzerOn;
            this._buzzGlow.opacity((buzzOn && M.blink) ? 0.35 : 0);
        }

        // 玻璃盖：合上遮住按钮 / 上翻露出按钮；按钮按下时红罩亮起
        if (this._cover) {
            const open = !!M.emStopCoverOpen;
            this._coverClosed.visible(!open);
            this._coverOpen.visible(open);
        }
        if (this._emHi) this._emHi.opacity(M.emStopLatched ? 0.55 : 0);

        // 位置灯 / 工况灯
        ['BRIDGE', 'ECR', 'LOCAL'].forEach((k) => {
            const lamp = this._posLamp[k];
            if (!lamp) return;
            const on = M.controlPos === k;
            // 转移目标：填充闪烁（一会儿填充、一会儿不填充）
            const flashing = !!(M.transferReq && M.transferReq.to === k);
            const lit = flashing ? M.blink : on;
            lamp.fill.fill(lit ? lamp.on : lamp.off);
            lamp.ring.stroke(lamp.stroke);
        });
        ['SEA', 'STANDBY', 'FWE'].forEach((k) => {
            const lamp = this._modeLamp[k];
            if (!lamp) return;
            const on = M.engineMode === k;
            const reqTo = !!(M.modeReq && M.modeReq.to === k);
            lamp.fill.fill(on ? lamp.on : (reqTo && M.blink ? lamp.on : lamp.off));
            lamp.ring.stroke(lamp.stroke);
        });

        // 无操纵权时车钟请求被拒：面板轻微闪示
        this.group.opacity(M.refuseFlash > 0 ? 0.97 : 1);

        this.markDirty();
        this._refreshIfDirty();
        this._redraw();
    }
}
