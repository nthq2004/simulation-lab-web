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

        this._initGroups();
        this._init();

        // 菜单按钮排层（主/二级菜单按钮动态绘制，覆盖静态底板；按钮 listening=false 不挡热区）
        this._bandGroup = new Konva.Group({ name: '_bandGroup' });
        this.group.add(this._bandGroup);

        // 菜单页面层（覆盖蓝色显示区，位于动态层之上）
        this._menuGroup = new Konva.Group({ name: '_menuGroup', visible: false });
        this.group.add(this._menuGroup);

        this._renderBand();

        this.config = { id: this.id, variant: this.variant };
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
            this._telSlider.y(minY + ratio * (maxY - minY));
            const rpm = posToRpm(ratio * 10);          // 拖到某档行 → 正好该档转速
            // 各位置车钟独立：本面板车钟始终可自由拖动；仅控制位置的车钟会改变主机给定
            this.model.setLeverContinuous(rpm, this.posKey);
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
                this.group.draggable(true);
                this._telSnap();
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
            const fill = new Konva.Arc({
                x, y, innerRadius: 0, outerRadius: 26, angle: 180, rotation: 0,
                fill: o.off, listening: false,
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

    _bindInteraction() {
        const M = this.model;
        const mk = (id, x, y, w, h, onClick) => {
            const hit = this.addClickablePart(id, x, y, w, h);
            if (onClick) hit.on('click tap', (e) => { e.cancelBubble = true; onClick(); this._redraw(); });
            return hit;
        };

        // Cancel 越控
        // 三个按钮均为切换型：按一次越控（灯亮），再按一次复位（灯灭）
        mk('cancel-shd', L.cancelBtn.x, L.cancelBtn.y[0] - 37, L.cancelBtn.w, L.cancelBtn.w, () => M.toggleSafety('SHD'));
        mk('cancel-sld', L.cancelBtn.x, L.cancelBtn.y[1] - 37, L.cancelBtn.w, L.cancelBtn.w, () => M.toggleSafety('SLD'));
        mk('cancel-limits', L.cancelBtn.x, L.cancelBtn.y[2] - 37, L.cancelBtn.w, L.cancelBtn.w, () => M.toggleSafety('LIM'));

        // 按钮排
        const btnAt = (ci, ri) => [L.btns.x[ci], ri === 0 ? L.btns.y1 : L.btns.y2];
        // 菜单按钮由 _renderBand() 动态绘制并登记热区（主菜单 / 二级菜单共用网格）
        this._bandHitIds = [];
        this._subPage = null;
        this._alarmViewMode = 'all';

        // 扬声器 / 报警铃 / ACK
        mk('silence', 492, L.bottomY - 34, 68, 68, () => { M.silence(); });
        mk('alarm-bell', 578, L.bottomY - 25, 116, 50, () => { M.silence(); });
        mk('ack', 712, L.bottomY - 34, 68, 68, () => { M.ack(); });

        // RPM CMD 上 / 下
        mk('lever-up', L.dark.x + L.arrowCol - 17, L.dark.y + L.arrowUpY - 17, 34, 34, () => { M.stepRpmCmd(2); });
        mk('lever-down', L.dark.x + L.arrowCol - 17, L.dark.y + L.arrowDownY - 17, 34, 34, () => { M.stepRpmCmd(-2); });

        // 控制位置
        mk('pos-bridge', L.dark.x + L.buzzCol - 31, L.dark.y + 139, 62, 62, () => this._setPos(CONTROL_POS.BRIDGE));
        mk('pos-ecr', L.dark.x + L.buzzCol - 31, L.dark.y + 203, 62, 62, () => this._setPos(CONTROL_POS.ECR));
        mk('pos-local', L.dark.x + L.buzzCol - 31, L.dark.y + 267, 62, 62, () => this._setPos(CONTROL_POS.LOCAL));

        // 工况
        mk('mode-sea', L.dark.x + L.arrowCol - 31, L.dark.y + 139, 62, 62, () => { M.engineMode = 'SEA'; this._tip('工况：At Sea 海上航行'); });
        mk('mode-standby', L.dark.x + L.arrowCol - 31, L.dark.y + 203, 62, 62, () => { M.engineMode = 'STANDBY'; this._tip('工况：Standby 备车'); });
        mk('mode-fwe', L.dark.x + L.arrowCol - 31, L.dark.y + 267, 62, 62, () => { M.engineMode = 'FWE'; this._tip('工况：FWE 完车'); });

        // 应急停车：玻璃盖（按一次上翻、再按一次遮住）+ 自锁按钮（开盖后可操作）
        mk('em-stop-cover', L.emStop.x - 2, 692, 134, 82, () => {
            const open = M.toggleEmStopCover();
            if (!open && M.emStopLatched) { M.pressEmStop(); }   // 合盖时若按钮仍在按下状态则弹出
        });
        mk('em-stop', L.emStop.x, 706, 130, 62, () => {
            if (!M.emStopCoverOpen) { M.toggleEmStopCover(); return; }  // 未开盖：先开盖
            M.pressEmStop();
        });
    }

    _setPos(pos) {
        const M = this.model;
        const ok = M.setControlPos(pos);
        const name = { BRIDGE: '驾驶台', ECR: '集控室', LOCAL: '机旁' }[pos];
        this._tip(ok ? `控制位置切到${name}` : `控制位置已在${name}`);
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
            'btn-safety': [['Safety alarms', 'safety-alarms', 0, 0], ['Emergency stop', 'emstop', 1, 0],
                ['Slow down / Shut down', 'sld-shd', 2, 0]],
            'btn-bwm': [['Engine modes', 'modes', 0, 0], ['Running mode', 'running', 1, 0],
                ['Slow turning', 'slow-turning', 2, 0], ['Cyl. lubrication', 'prelub', 3, 0]],
            'btn-param': [['Start / Stop', 'p0', 0, 0], ['Reversing', 'p1', 1, 0],
                ['Crash astern', 'p2', 2, 0], ['Governor (DGU PID)', 'p3', 3, 0]],
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
        if (key === 'home') {
            this._menuPage = null;
            this._subPage = null;
            this._directPage = null;
            this._renderBand();
            this._renderMenu();
            return;
        }
        const ALARM_KINDS = ['sys-crit', 'sys-nonc', 'comerr-c', 'comerr-n', 'io-fail'];
        this._listOffset = 0;
        if (ALARM_KINDS.includes(key)) {
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
            g.add(_rect({ x: xD, y: ry, width: 1006, height: rowH, fill: it.alarm ? '#4d0f0f' : ((off + i) % 2 ? '#2b2b2b' : '#323232') }));
            const col = it.alarm ? '#ff4040' : '#00c000';
            g.add(_text({ x: xD + 6, y: ry + 4, width: wD - 8, fontSize: 14, fill: col, text: it.desc }));
            g.add(_text({ x: xV + 6, y: ry + 4, width: wV - 8, fontSize: 14, fill: col, text: it.value }));
            g.add(_text({ x: xA + 6, y: ry + 4, width: wA - 8, fontSize: 14, fill: col, text: it.alarm ? 'ALARM' : '' }));
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
        const esPressed = (p) => (M.emStopLatched && p === pos);
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
                N('ESU MAIN POWER FAILURE', 'NORMAL', M.shutDown && !M.cancelSHD),
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
                N('SUDDEN STOP', 'NORMAL', M.shutDown && !M.cancelSHD),
                N('START FAIL/BLOCK', 'NORMAL', M.startBlocked || M.startFail),
                N('START FAILED', 'NORMAL', M.startFail),
                N('START AIR PRESSURE LOW', 'NORMAL', M.startAir < 15),
                N('WRONG WAY', 'NORMAL', M.wrongWay),
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
            N('EICU A SHUTDOWN NON-CANCELLABLE', 'NORMAL', M.shutDown && !M.cancelSHD),
            N('EICU A SHUTDOWN CANCELLABLE', 'NORMAL', M.shutDown && !M.cancelSHD),
            N('EICU B SHUTDOWN NON-CANCELLABLE', 'NORMAL', M.shutDown && !M.cancelSHD),
            N('EICU B SHUTDOWN CANCELLABLE', 'NORMAL', M.shutDown && !M.cancelSHD),
            // ── 第 3 页 ──
            N('SHUTDOWN ACTIVE ACTION A', 'OPEN', false),
            N('SHUTDOWN ACTIVE ACTION B', 'OPEN', false),
            N('AXIAL VIBRATION HIGH', 'NORMAL', false),
            N('OIL MIST HIGH IN CRANKCASE', 'NORMAL', false),
            N('EICU A SLOWDOWN', 'NORMAL', M.slowDown && !M.cancelSLD),
            N('EICU B SLOWDOWN', 'NORMAL', M.slowDown && !M.cancelSLD),
        ];
    }

    /** 依据当前主菜单 / 二级菜单重绘液晶区页面；
     *  页面内所有文字（标题 / 表头 / 选项行 / 软键）统一在绘制后放大 2px */
    _renderMenu() {
        this._renderMenuRaw();
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
            let items = this._alarmItems(sub);
            if (this._alarmViewMode === 'active') items = items.filter((it) => it.alarm);
            this._pgListTable(items, 70, { showHeader: true });
            return;
        }
        if (sub === 'history') {
            this._menuGroup.add(_rect({ x: 126, y: 70, width: 1020, height: 430, fill: '#2b2b2b' }));
            const y = 70;
            const hist = M.alarmHistory || [];
            const g = this._menuGroup;
            const cols = [[126, 90, 'Nack'], [216, 190, 'Date/Time'], [406, 470, 'Description'], [876, 130, 'Event'], [1006, 120, 'Value']];
            g.add(_rect({ x: 126, y, width: 1006, height: 26, fill: '#eceef0', stroke: '#8d9498', strokeWidth: 1 }));
            cols.forEach(([x, w, t]) => g.add(_text({ x: x + 6, y: y + 4, width: w, fontSize: 14.5, fill: '#101010', text: t })));
            hist.forEach((h, i) => {
                const ry = y + 26 + i * 24.5;
                g.add(_rect({ x: 126, y: ry, width: 1006, height: 24.5, fill: i % 2 ? '#2b2b2b' : '#323232' }));
                g.add(_text({ x: 132, y: ry + 4, width: 84, fontSize: 13.5, fill: '#00c000', text: 'ACK' }));
                g.add(_text({ x: 222, y: ry + 4, width: 184, fontSize: 13.5, fill: '#00c000', text: h.time || '--:--' }));
                g.add(_text({ x: 412, y: ry + 4, width: 464, fontSize: 13.5, fill: '#00c000', text: h.text }));
                g.add(_text({ x: 882, y: ry + 4, width: 124, fontSize: 13.5, fill: '#00c000', text: 'RTN' }));
                g.add(_text({ x: 1012, y: ry + 4, width: 114, fontSize: 13.5, fill: '#00c000', text: '—' }));
            });
            if (!hist.length) {
                g.add(_text({ x: 126, y: y + 60, width: 1006, align: 'center', fontSize: 15, fill: '#9fd3ff', text: '（当前无历史故障）' }));
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
            const y = this._pgBase('SAFETY SYSTEM');
            if (sub === 'safety-alarms') {
                const list = [];
                if (M.shutDown) list.push([M.cancelSHD ? 'SHUT DOWN (CANCELLED)' : 'SHUT DOWN', !!M.cancelSHD]);
                if (M.slowDown) list.push([M.cancelSLD ? 'SLOW DOWN (CANCELLED)' : 'SLOW DOWN', !!M.cancelSLD]);
                if (M.emStopLatched) list.push(['EMERGENCY STOP', false]);
                if (!list.length) list.push(['SAFETY SYSTEM NORMAL', false]);
                list.forEach(([n, ok], i) => {
                    this._pgRow(136, y + 6 + i * 26, 1000, [{ w: 700, text: n, bold: true }, { w: 280, text: ok ? 'CANCELLED' : 'ACTIVE', color: ok ? '#9fe0a0' : '#ff8a8a' }], { bg: i % 2 ? '#2b2b2b' : '#323232' });
                });
                this._menuGroup.add(_text({ x: 136, y: y + 130, width: 940, fontSize: 13, fill: '#9fd3ff', text: '可用 Cancel SHD / Cancel SLD 越控可取消的安保动作。' }));
            } else if (sub === 'emstop') {
                [['BRIDGE', M.emStopLatched && M.controlPos === 'BRIDGE'], ['ECR', M.emStopLatched && M.controlPos === 'ECR'],
                    ['LOCAL', M.emStopLatched && M.controlPos === 'LOCAL'], ['PORT WING', false], ['STB. WING', false]].forEach(([label, on], i) => {
                    const bx = 150 + i * 190, by = y + 10;
                    this._menuGroup.add(_rect({ x: bx, y: by, width: 170, height: 54, fill: on ? '#c40000' : '#3a3a3a', stroke: '#e8ebec', strokeWidth: 2, cornerRadius: 4 }));
                    this._menuGroup.add(_text({ x: bx, y: by + 8, width: 170, align: 'center', fontSize: 13.5, fill: '#ffffff', text: label }));
                    this._menuGroup.add(_text({ x: bx, y: by + 28, width: 170, align: 'center', fontSize: 12.5, fill: on ? '#ffffff' : '#9fd3ff', text: on ? 'PRESSED' : 'NORMAL' }));
                });
                this._menuGroup.add(_text({ x: 150, y: y + 78, width: 940, fontSize: 14, fontStyle: 'bold', fill: M.emStopLatched ? '#ff8a8a' : '#9fe0a0',
                    text: M.emStopLatched ? 'ENGINE TRIPPED — 应急停车已动作，需全部急停开关复位后方可重新起动' : 'ALL EMERGENCY STOP SWITCHES NORMAL' }));
                this._menuGroup.add(_text({ x: 150, y: y + 112, width: 940, fontSize: 13, fill: '#9fd3ff', text: '急停开关硬线接至主机安全系统（ESU），动作后燃油给定清零。' }));
            } else {
                [['SLOW DOWN', M.slowDown ? (M.cancelSLD ? 'CANCELLED' : 'ACTIVE') : 'INACTIVE', '40 rpm'],
                    ['SHUT DOWN', M.shutDown ? (M.cancelSHD ? 'CANCELLED' : 'ACTIVE') : 'INACTIVE', '0 rpm'],
                    ['Cancel SHD', M.cancelSHD ? 'ON' : 'OFF', '—'],
                    ['Cancel SLD', M.cancelSLD ? 'ON' : 'OFF', '—'],
                    ['Cancel limits', M.cancelLimits ? 'ON' : 'OFF', '—']].forEach((r, i) => {
                    this._pgRow(136, y + 6 + i * 26, 1000, [
                        { w: 500, text: r[0] }, { w: 300, text: r[1], color: (r[1] === 'ACTIVE' || r[1] === 'ON') ? '#ffb0b0' : '#9fe0a0' }, { w: 200, text: r[2] },
                    ], { bg: i % 2 ? '#2b2b2b' : '#323232' });
                });
            }
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
                ['ENGINE TRIPPED', M.emStopLatched], ['START AIR VALVE BLOCKED', !M.mainStartValveOk],
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
                accel: { rpm: 60, rate: 8 },
                decel: { rpm: 45, rate: -10 },
                loadUp: { from: 25, to: 68, time: 30 },
                loadDown: { from: 68, to: 25, time: 30 },
                slowTurn: { stopMin: 30, durS: 45 },
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

    /** Show Limiters：LIMITER / STATUS / LEVEL（LIMITER 列宽减半，加宽到 LEVEL） */
    _paintShowLimiters(y) {
        const M = this.model;
        const L1 = this._limState();
        const fmt3p = (a, b) => `${a}-${b}`;
        const scavTxt = `${fmt3p(L1.scav.p1 + ' bar', L1.scav.f1 + ' %')}；${fmt3p(L1.scav.p2 + ' bar', L1.scav.f2 + ' %')}；${fmt3p(L1.scav.p3 + ' bar', L1.scav.f3 + ' %')}`;
        const torqTxt = `${fmt3p(L1.torque.r1 + ' rpm', L1.torque.f1 + ' %')}；${fmt3p(L1.torque.r2 + ' rpm', L1.torque.f2 + ' %')}；${fmt3p(L1.torque.r3 + ' rpm', L1.torque.f3 + ' %')}`;

        const COLS = [{ w: 310 }, { w: 180 }, { w: 510 }];
        this._pgRow(136, y + 6, 1000, [
            { w: COLS[0].w, text: 'LIMITER' }, { w: COLS[1].w, text: 'STATUS' }, { w: COLS[2].w, text: 'LEVEL' },
        ], { bg: '#454545' });

        const rows = [
            ['Scavenge air pressure limiter', 'ACTIVE', scavTxt],
            ['Torque limiter', 'ACTIVE', torqTxt],
            ['Fuel index limiter', (M.loadLimit && !M.cancelLimits) ? 'LIMITING' : 'INACTIVE', `${L1.fuelIndex.level} %`],
            ['Slow-down limiter', (M.slowDown && !M.cancelSLD) ? 'ACTIVE' : 'INACTIVE', `${L1.slowDown.level} rpm`],
            ['Minimum stable running speed', 'ACTIVE', `${L1.steady.rpm} rpm`],
            ['Manual RPM limiter (Chief)', M.cancelLimits ? 'CANCELLED' : 'ACTIVE', `${L1.chiefRpm.ahead} / ${L1.chiefRpm.astern} rpm`],
            ['Acceleration rate limiter', 'ACTIVE', `${L1.accel.rpm} rpm, ${L1.accel.rate} rpm/s`],
            ['Deceleration rate limiter', 'ACTIVE', `${L1.decel.rpm} rpm, ${L1.decel.rate} rpm/s`],
            ['Load Up program limiter', 'INACTIVE', `${L1.loadUp.from}~${L1.loadUp.to} rpm, ${L1.loadUp.time} min`],
            ['Load Down program limiter', 'INACTIVE', `${L1.loadDown.from}~${L1.loadDown.to} rpm, ${L1.loadDown.time} min`],
            ['Slow turning program', 'ACTIVE', `${L1.slowTurn.stopMin} min, ${L1.slowTurn.durS} s`],
            ['Critical speed limiter', 'ACTIVE', `${L1.critical.lo.toFixed(1)}~${L1.critical.hi.toFixed(1)} rpm`],
        ];
        rows.forEach((r, i) => {
            this._pgRow(136, y + 36 + i * 26, 1000, [
                { w: COLS[0].w, text: r[0] },
                { w: COLS[1].w, text: r[1], color: (r[1] === 'ACTIVE' || r[1] === 'LIMITING') ? '#ffb0b0' : '#9fe0a0' },
                { w: COLS[2].w, text: r[2] },
            ], { bg: i % 2 ? '#2b2b2b' : '#323232' });
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
                    ['Runing', !!M.running && Math.abs(M.rpm) > 50, 'ok'],
                    ['Stopping', (Math.abs(M.rpmCmd) < 0.5 || (M.shutDown && !M.cancelSHD)) && Math.abs(M.rpm) > 25, 'warn'],
                    ['Engine Tripped', !!M.emStopLatched, 'alarm'],
                ],
            },
            {
                x: 428, y: 88, w: 316, h: 392, title: 'START FAIL/BLOCK',
                items: [
                    ['Start failed', !!M.startFail, 'alarm'],
                    ['Start air pressure low', M.startAir < 15, 'alarm'],
                    ['Engine tripped', !!(M.emStopLatched || (M.shutDown && !M.cancelSHD)), 'alarm'],
                    ['Start Blocked', !!(M.startBlocked || !M.turningGearOut || !M.mainStartValveOk || !M.airDistributorOk || M.startAir < 15), 'alarm'],
                    ['Engine Blocked', !(M.mainStartValveOk && M.airDistributorOk), 'alarm'],
                    ['Sudden Stop', !!(M.shutDown && !M.cancelSHD), 'alarm'],
                ],
            },
            {
                x: 760, y: 88, w: 372, h: 392, title: 'ENGINE NOT READY',
                items: [
                    ['Start air distributor blocked', !M.airDistributorOk, 'alarm'],
                    ['Main start valve blocked', !M.mainStartValveOk, 'alarm'],
                    ['Turning gear engaged', !M.turningGearOut, 'alarm'],
                    ['Control air vented', M.controlAir < 5, 'alarm'],
                    ['Engine not ready ECS', !M.engineReady, 'alarm'],
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
        const faults = {
            alarms: !!M.alarm, limiters: !!(M.loadLimit && !M.cancelLimits),
            misc: !!(M.slowDown && !M.cancelSLD), safety: !!(M.shutDown || M.emStopLatched),
            estate: !!(M.startBlocked || M.startFail || !M.engineReady),
        };
        this._bandLamps.forEach(({ ci, ri, node }) => {
            const cell = cells.find((c) => c.ci === ci && c.ri === ri);
            if (!cell) { node.visible(false); return; }
            let has;
            if (!this._menuPage) {
                // 主菜单：按菜单类别判断
                has = !!faults[cell.key];
            } else if (this._menuPage === 'btn-alarms') {
                // 二级按钮：该子页内是否存在未复位（报警）项
                const kinds = ['sys-crit', 'sys-nonc', 'comerr-c', 'comerr-n', 'io-fail'];
                has = kinds.includes(cell.key) && this._alarmItems(cell.key).some((it) => it.alarm);
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

    tick() {
        const M = this.model;
        if (!M) return;

        // 状态条
        const segOn = [M.engineMode === 'SEA', M.engineMode === 'SEA', M.controlPos === CONTROL_POS.ECR, M.running, M.engineReady];
        segOn.forEach((on, i) => {
            if (i === 2) {
                this._segHi[i].fill(on ? C_YELLOW : '#101080');
                this._segHi[i].opacity(on ? 1 : 0);
                this._segText[i].fill(on ? '#101010' : '#ffffff');
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
        const reason = M.shutDown
            ? (M.cancelSHD ? 'Emergency Stop (Overridden)' : 'Emergency Stop')
            : (M.slowDown ? (M.cancelSLD ? 'Slow Down (Overridden)' : 'Slow Down') : '');
        g.rpm.reason.text(reason);
        g.rpm.reason.visible(!!reason);
        g.air.needle.rotation(this._angleFor(M.startAir, 0, 40));
        g.air.value.text(`${M.startAir.toFixed(1)} bar`);
        g.load.needle.rotation(this._angleFor(M.load, 0, 100));
        g.load.value.text(`${M.load.toFixed(1)} %`);

        // SETP / LEVER
        const barY = (v) => L.setp.y + L.setp.h * (1 - (Math.max(-120, Math.min(120, v)) + 120) / 240);
        this._setpTri.y(barY(M.rpmCmd));
        const myLever = (M.leverRpm && M.leverRpm[this.posKey] !== undefined) ? M.leverRpm[this.posKey] : M.rpm;
        this._leverTri.y(barY(myLever));
        this._setpVal.text(`${M.rpmCmd.toFixed(1)} RPM`);
        this._leverVal.text(`${myLever.toFixed(1)} RPM`);

        this._runHour.text(`ME Run Hour:${M.runHours.toFixed(1)}`);
        this._rev.text(`Rev: ${Math.round(M.rev)}`);

        // 越控灯
        this._cancelLamp.shd.fill(M.cancelSHD ? '#e01717' : '#ffffff');
        this._cancelLamp.sld.fill(M.cancelSLD ? '#e01717' : '#ffffff');
        this._cancelLamp.lim.fill(M.cancelLimits ? '#e01717' : '#ffffff');

        // 报警铃
        this._bellRing.opacity((M.alarm && !M.silenced && M.blink) ? 0.5 : 0);

        // 菜单页面：打开时按 500 ms 节流刷新（数据实时变化；含 Estate 直接页面）
        if ((this._menuPage && this._subPage) || this._directPage) {
            const now = Date.now();
            if (!this._menuNextRefresh || now >= this._menuNextRefresh) {
                this._menuNextRefresh = now + 500;
                this._renderMenu();
            }
        }
        this._updateBandLamps();

        // ── 菜单流程指示灯 + 报警信息栏 ──
        const msgs = (M.messages && M.messages.length) ? M.messages : (M.alarmText ? [M.alarmText] : []);
        const faults = {
            'btn-alarms': M.alarm ? msgs : [],
            'btn-limiters': (M.loadLimit && !M.cancelLimits) ? ['LOAD LIMIT, ACTIVE'] : [],
            'btn-misc': (M.slowDown && !M.cancelSLD) ? ['SLOW DOWN, ACTIVE'] : [],
            'btn-safety': ((M.shutDown && !M.cancelSHD) || M.emStopLatched) ? ['SHUT DOWN, ACTIVE'] : [],
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
        const focusId = (this._menuFocus && (faults[this._menuFocus] || []).length) ? this._menuFocus : null;
        const lines = focusId ? faults[focusId].slice(0, 2) : (M.alarm ? msgs.slice(0, 2) : []);
        if (this._alarmFill) this._alarmFill.visible(lines.length > 0);
        (this._alarmLines || []).forEach((t, i) => {
            t.text(lines[i] || '');
            t.opacity(1);              // 常亮，不闪烁
        });

        // 车钟：本面板车钟位置驱动滑条；只有落在整档上才绿色高亮
        const myPos = (M.leverPosAt ? M.leverPosAt(this.posKey) : (M.leverPos || 0));
        const near = Math.max(0, Math.min(10, Math.round(myPos)));
        const onDetent = Math.abs(myPos - near) <= 0.02;      // 正好在整档
        (this._telText || []).forEach((t, i) => {
            const on = onDetent && i === near;
            t.fill(on ? '#00e000' : '#b9c0c6');
            t.fontStyle(on ? 'bold' : '');
        });
        if (this._telSlider && !this._telManualDrag) {
            this._telSlider.y(L.tel.rowTop + myPos * L.tel.rowGap);
        }

        // RPM CMD
        this._rpmCmdText.text(String(Math.round(M.rpmCmd)));

        // 蜂鸣器：报警时闪
        if (this._buzzGlow) this._buzzGlow.opacity((M.alarm && !M.silenced && M.blink) ? 0.35 : 0);

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
            lamp.fill.fill(on ? lamp.on : lamp.off);
            lamp.ring.stroke(lamp.stroke);
        });
        ['SEA', 'STANDBY', 'FWE'].forEach((k) => {
            const lamp = this._modeLamp[k];
            if (!lamp) return;
            const on = M.engineMode === k;
            lamp.fill.fill(on ? lamp.on : lamp.off);
            lamp.ring.stroke(lamp.stroke);
        });

        // 无操纵权时车钟请求被拒：面板轻微闪示
        this.group.opacity(M.refuseFlash > 0 ? 0.97 : 1);

        this.markDirty();
        this._refreshIfDirty();
        this._redraw();
    }
}
