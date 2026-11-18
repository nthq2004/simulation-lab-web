import Konva from 'konva';
import { BaseComponent } from './BaseComponent.js';
import {
    KChiefSolver, ALARM_GROUPS, PRIORITIES, SETTABLE_GROUPS, dateTimeText,
} from '../tools/KChiefSolver.js';

/**
 * KChiefConsole — Kongsberg K-Chief 600 机舱监视报警系统·操作站主界面
 * ═══════════════════════════════════════════════════════════════
 *  版式参照 K-Chief 600 操作站（ROS）的 Home 主菜单（1920×1080 基准，本组件 1860×950）：
 *    ① 窗体标题栏：终端型号 / 版本
 *    ② 工具栏：ROS 节点与时钟、Command control、值班状态框（ECR watch / BRIDGE watch + At sea）、
 *       未确认报警计数、报警图标、工具按钮（故障清单 / 主页 / 确认 ACK / 消音 / 蜂鸣器 / 打印）、
 *       右侧 View·Operate·Alarms / Tools·System 分组
 *    ③ 左列 Dock 报警组计数器（各组未确认报警数）
 *    ④ 船舶剪影（船名 COSRICH LAKE）
 *    ⑤ 表格视图（Tabular views）：当前报警 Active alarms、报警历史 Alarm history、
 *       标签一览 Tag summary、事件历史 Event history、被越控标签、日志、被闭锁标签、
 *       计数器列表、标签恢复初值
 *    ⑥ 工艺流程图入口（Process mimics）、趋势（Trends）、自定义视图（Custom views）
 *
 *  可点击部件（工作流 subTarget / op.part）：
 *    工具栏：tb-home tb-ack tb-silence tb-print tb-counter（未确认报警数按钮）
 *    表格视图：tab-active tab-history tab-tags tab-events tab-override
 *              tab-log tab-inhibit tab-counters tab-recover
 *    工艺流程图：mimic-me（主机概览）
 *    Dock 计数器：dock-ME dock-AUX dock-BILGE
 *    报警列表行：row-0 … row-11（打开该测点的参数设置界面）
 *    参数设置界面：p-dir-low p-dir-high p-sp-minus p-sp-plus p-delay-minus p-delay-plus
 *                  p-db-minus p-db-plus p-prio-minus p-prio-plus p-group-minus p-group-plus
 *                  p-inhibit p-save p-cancel
 * ═══════════════════════════════════════════════════════════════
 */

// ── 版面常量（组件内部坐标 = 画布真实尺寸，不使用 group.scale）──
const W = 1620, H = 850;
const TITLE_H = 24;                  // 窗体标题栏
const BAR_Y = TITLE_H, BAR_H = 56;   // 工具栏
const GROUPS_W = 186;                // 左列 UnDock 报警组列表宽度
const GROUP_ROW_H = 36;              // 每个报警组行高
const GROUP_TOP = 112;               // 报警组列表起始 y
const CX = 192, CW = 1418;           // 内容区左边界与宽度

// 各分区纵向位置
const Y_SHIP = 90,  H_SHIP = 166;
const Y_TAB = 266,  H_TAB = 96;
const Y_MIMIC = 380, H_MIMIC = 300;
const Y_TREND = 696, H_TREND = 60;
const Y_CUSTOM = 776, H_CUSTOM = 60;

// 配色（贴近 K-Chief 600 的浅灰界面）
const C_FRAME = '#e9ebec';
const C_LINE = '#a8aeb2';
const C_TEXT = '#222222';
const C_SUB = '#555a5e';
const C_RED = '#e01b1b';
const C_GREEN = '#3fbf3f';
const C_AMBER = '#e08a00';

// ── 小工具 ──
/** 测点显示辅助（模拟量 / 开关量） */
/** 完整时间戳：2026.11.13 18:47:32（当前报警列表用） */
const fullTime = (ts) => {
    if (!ts) return '';
    const d = new Date(ts);
    const p2 = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}.${p2(d.getMonth() + 1)}.${p2(d.getDate())} `
        + `${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`;
};

const dirText = (tg) => (tg.digital ? '开关量' : (tg.dir === 'low' ? '低限' : '高限'));
const limitText = (tg) => (tg.digital ? '动作即报警' : `${fmt(tg.limit)} ${tg.unit}`);
const dbText = (tg) => (tg.digital ? '—' : `${fmt(tg.deadband)} ${tg.unit}`);
const valText = (tg) => (tg.digital ? (tg.display >= 0.5 ? '动作' : '正常') : `${fmt(tg.display)} ${tg.unit}`);

const _rect = (o) => new Konva.Rect(Object.assign({ listening: false }, o));
const _text = (o) => new Konva.Text(Object.assign({ listening: false, fontFamily: 'Microsoft YaHei, Arial' }, o));
const _line = (o) => new Konva.Line(Object.assign({ listening: false }, o));

/** 数值格式化：<10 两位小数，<100 一位，其余取整 */
function fmt(v) {
    if (!isFinite(v)) return '—';
    if (Math.abs(v) >= 100) return v.toFixed(0);
    if (Math.abs(v) >= 10) return v.toFixed(1);
    return v.toFixed(2);
}

export class KChiefConsole extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.W = W;
        this.H = H;
        this.width = W;
        this.height = H;

        this.type = 'kchief_console';
        this.cache = 'fixed';

        // 与延伸报警单元共享同一套报警模型
        if (!sys.kchief) sys.kchief = new KChiefSolver(sys);
        this.model = sys.kchief;

        // 当前显示页：null = Home（船图 + 表格视图 + 工艺流程图 + 趋势 + 自定义视图）
        //   'alarms' | 'history' | 'tags' | 'inhibit' | 'events' | 'log' | 'counters'
        //   | 'override' | 'mimic'（以上为整页切换，Home 隐藏）| 'param'（参数对话框，浮层）
        this._overlay = null;
        this._paramTagId = null;     // 参数设置界面的测点 id
        this._paramBack = null;      // 参数对话框关闭后回到的页面
        this._edit = null;           // 参数设置的工作副本
        this._groupFilter = null;    // 当前报警列表的分组过滤
        this._pagePartIds = [];      // 页面内登记的可点击部件（回 Home 时清除）
        this._dialogPartIds = [];    // 对话框内登记的可点击部件（关对话框时清除）
        this._menuPartIds = [];      // 下拉菜单项登记的可点击部件（关菜单时清除）
        this._menuOpen = null;       // 当前展开的菜单：'view' | 'operate' | 'tools' | 'system' | null
        this._watchCallOpen = false; // 是否打开「值班呼叫 Watch calling」对话框
        this._wcPartIds = [];        // 值班呼叫对话框登记的可点击部件
        this._rowOffset = 0;         // 列表页翻页偏移（前进 / 后退按钮）
        this._lastOverlayRefresh = 0;
        this._unDock = true;         // 左列状态：true = UnDock（显示各报警组）；false = Dock（仅计数条）

        this._initGroups();

        // Home 内容层（船图 / 表格视图 / 工艺流程图 / 趋势 / 自定义视图）：切页时整层隐藏
        this._homeStatic = new Konva.Group({ name: '_homeStatic' });
        this._pageGroup = new Konva.Group({ name: '_pageGroup', visible: false });
        this.group.add(this._homeStatic, this._pageGroup);
        // 层级：static(0) → dynamic(1) → homeStatic(2) → interact(3) → pageGroup(4)
        //        → homeInteract(5) → menu(6) → overlay(7)
        // 注意：pageGroup 必须在 interact 之上，否则整块拖动热区（覆盖全组件）会吞掉
        //       列表页里的行点击 / 双击，导致双击行无法打开报警参数界面。
        this._homeStatic.zIndex(2);
        this._pageGroup.zIndex(4);

        // Home 内容的热区层（与 Home 内容一起显隐，避免隐藏后仍能点到）
        this._homeInteract = new Konva.Group({ name: '_homeInteract' });
        this.group.add(this._homeInteract);

        // 下拉菜单层（在 Home 热区之上、参数对话框之下）
        this._menuGroup = new Konva.Group({ name: '_menuGroup' });
        this.group.add(this._menuGroup);

        // 值班呼叫对话框层（在菜单之上、参数对话框之下）
        this._wcGroup = new Konva.Group({ name: '_watchCallGroup' });
        this.group.add(this._wcGroup);

        // 参数对话框专用组（置于最上层）
        this._overlayGroup = new Konva.Group({ name: '_overlayGroup' });
        this.group.add(this._overlayGroup);

        this._init();

        this.config = { id: this.id, repeatDelay: this.model.repeatDelay };
    }

    /** 右键菜单「参数设置」字段（失职报警延时在此设置） */
    getConfigFields() {
        return [
            { label: '器件名称 (ID)', key: 'id', type: 'text' },
            {
                label: '失职报警延时 Repeat delay (s)', key: 'repeatDelay', type: 'number',
                min: 10, max: 600, step: 1,
                get: (c) => (c.model ? c.model.repeatDelay : 180),
            },
        ];
    }

    onConfigUpdate(cfg) {
        this.id = cfg.id;
        if (cfg.repeatDelay !== undefined && this.model) {
            const v = Math.min(600, Math.max(10, Math.round(Number(cfg.repeatDelay) || 180)));
            this.model.repeatDelay = v;
            this.model._log(`参数修改：失职报警延时 = ${v} s`);
        }
    }

    // ═══════════════════════════════════════════════════════
    //  对外只读属性（工作流 check() 用）
    // ═══════════════════════════════════════════════════════
    get overlayKind() { return this._overlay; }
    get paramTagId() { return this._paramTagId; }
    get editValue() { return this._edit ? this._edit.limit : null; }

    /**
     * 按钮 / 菜单点击提示。
     * 按用户要求：点击按钮和菜单不再弹出任何提示信息，故此处为空实现
     * （保留方法签名，便于以后需要时恢复为 showFloatingTip）。
     */
    _tip() { /* 不显示提示 */ }

    // ═══════════════════════════════════════════════════════
    //  构建
    // ═══════════════════════════════════════════════════════
    _init() {
        this._drawStatic();
        this._createDynamic();
        this._initTrend();          // 趋势数据自起动即开始缓存（打开趋势页即可见完整曲线）
        this._initCustom();
        this._addDragPlate();
        this._bindInteraction();
        this._updateDynamic();
    }

    /**
     * 整块面板拖动热区：本组件所有静态图形均 listening:false，
     * 若不加此热区，面板空白处按下无法拖动整块操作站面板。
     * 该热区置于交互层最底层，不影响各按钮/部件热区的点击。
     */
    _addDragPlate() {
        const plate = new Konva.Rect({
            x: 0, y: 0, width: this.W, height: this.H,
            fill: 'rgba(0,0,0,0.001)', listening: true,
        });
        this._interactGroup.add(plate);
        plate.moveToBottom();
        this.group.draggable(true);
    }

    /** 通用按钮：浅灰渐变底 + 细边框 + 居中文字；partId 非空时注册为可点击部件 */
    _btn(layer, partId, x, y, w, h, label, onClick, opts = {}) {
        layer.add(_rect({
            x, y, width: w, height: h,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint: { x: 0, y: h },
            fillLinearGradientColorStops: opts.dark
                ? [0, '#d8dcde', 1, '#b9bfc2']
                : [0, '#fdfdfd', 1, '#dfe2e4'],
            stroke: opts.stroke || '#9aa0a4',
            strokeWidth: 1,
            cornerRadius: 2,
        }));
        layer.add(_text({
            x, y: y + Math.max(1, (h - (opts.fontSize || 12)) / 2 - 2),
            width: w, align: 'center',
            text: label, fontSize: opts.fontSize || 12,
            fontStyle: opts.bold ? 'bold' : 'normal',
            fill: opts.color || C_TEXT,
        }));
        if (partId) {
            const hit = this.addClickablePart(partId, x, y, w, h);
            if (onClick && hit) hit.on('click', () => onClick());
            // Home 内容里的部件：整个热区组（含悬停底色）随 Home 一起显隐
            if (hit && opts.home && this._homeInteract) {
                const partGroup = hit.getParent ? hit.getParent() : null;
                (partGroup || hit).moveTo(this._homeInteract);
            }
        }
        return null;
    }

    /** 分区框：浅灰底 + 白底标题牌（参照 K-Chief 分组框） */
    _section(layer, x, y, w, h, title) {
        layer.add(_rect({ x, y, width: w, height: h, fill: C_FRAME, stroke: C_LINE, strokeWidth: 1 }));
        const tw = Math.max(60, title.length * 10.5+15 );
        layer.add(_rect({ x: x + 10, y: y - 9, width: tw, height: 24, fill: '#ffffff', stroke: C_LINE, strokeWidth: 1, cornerRadius: 2 }));
        layer.add(_text({ x: x + 16, y: y - 6, text: title, fontSize: 16, fill: '#2f3538', fontStyle: 'bold' }));
    }

    _drawStatic() {
        const s = this._staticGroup;
        const M = this.model;

        // ── ① 窗体 ──
        s.add(_rect({ x: 0, y: 0, width: W, height: H, fill: '#f2f3f4', stroke: '#7f878c', strokeWidth: 1.4, cornerRadius: 3 }));
        s.add(_rect({ x: 0, y: 0, width: W, height: TITLE_H, fill: '#e6e8e9', stroke: '#b6bcbf', strokeWidth: 1 }));
        s.add(_rect({ x: 7, y: 5, width: 14, height: 14, fill: '#2f7fc1', cornerRadius: 2 }));
        s.add(_text({ x: 28, y: 2, fontSize: 16, fill: '#333333', text: 'JSSC 船舶监视报警系统 V1.0' }));
        // 窗体控件（最小化 / 最大化 / 关闭）：紧凑排布，紧贴窗体右边缘（不留右侧空白）
        ['—', '▢', '✕'].forEach((g, i) => {
            const bx = W - 8 - (3 * 22 + 2 * 2) + i * 24;   // 1760 → 1682 / 1706 / 1730
            s.add(_rect({ x: bx, y: 5, width: 22, height: 14, fill: '#f0f0f0', stroke: '#b6bcbf', strokeWidth: 1, cornerRadius: 2 }));
            s.add(_text({ x: bx, y: 5, width: 22, align: 'center', fontSize: 11, fill: '#444444', text: g }));
        });

        // ── ② 工具栏 ──
        s.add(_rect({ x: 0, y: BAR_Y, width: W, height: BAR_H, fill: '#eceff1', stroke: '#b6bcbf', strokeWidth: 1 }));
        // ROS 节点徽标
        s.add(new Konva.Circle({ x: 36, y: 52, radius: 20, fill: '#dfe4e7', stroke: '#8a9298', strokeWidth: 1.2, listening: false }));
        s.add(new Konva.Circle({ x: 36, y: 52, radius: 13, fill: '#eef1f3', stroke: '#a8aeb2', strokeWidth: 1, listening: false }));
        s.add(_text({ x: 16, y: 45, width: 40, align: 'center', fontSize: 11, fontStyle: 'bold', fill: '#3a4145', text: 'ROS1' }));
        s.add(_text({ x: 62, y: 32, fontSize: 12.5, fontStyle: 'bold', fill: '#222222', text: 'ROS1 Chief' }));
        // Command control 标签（上排，宽度与下方"值班状态 + 船况"两块合计对齐）
        s.add(_rect({ x: 238, y: 30, width: 186, height: 22, fill: '#e6e8ea', stroke: '#b0b7bb', cornerRadius: 2 }));
        s.add(_text({ x: 238, y: 34.5, width: 186, align: 'center', fontSize: 11.5, fill: '#333333', text: 'Command control' }));

        // ── 最新警报横幅（两行，位于 Command control 右侧）──
        //    列：优先级块 | 方向 HIGH/LOW | 时间 | 报警组 | 报警描述
        s.add(_rect({ x: 430, y: 28, width: 520, height: 44, fill: '#f4f5f6', stroke: '#b0b7bb', strokeWidth: 1 }));
        s.add(_line({ points: [430, 50, 950, 50], stroke: '#c2c8cb', strokeWidth: 1 }));
        // 未确认报警数按钮（红色块，显示最新未确认数 + ▼）
        s.add(_rect({ x: 954, y: 28, width: 40, height: 44, fill: '#d8dcde', stroke: '#9aa0a4', strokeWidth: 1, cornerRadius: 2 }));
        // 工具按钮组（主页 / 确认 / 消音 / ← / → / 打印）——整体左移，主页靠近报警计数
        const tb = [
            ['tb-home', 1004, 54, '主页', () => { this._backHome(); this._tip('返回操作站 Home 主菜单'); }],
            ['tb-ack', 1064, 74, '确认 ACK', () => this._ack()],
            ['tb-silence', 1144, 54, '消音', () => { this.model.silence(); this._tip('蜂鸣器消音：报警灯仍闪烁，直到报警被确认'); }],
        ];
        tb.forEach(([id, x, w, label, cb]) => {
            this._btn(s, id, x, 39, w, 26, label, cb, { fontSize: 13.5 });
        });
        // 前进 / 后退（列表页翻页）：按钮底 + 带尾部的实心箭头
        this._btn(s, 'tb-prev', 1208, 39, 28, 26, '', () => this._pagePrev());
        s.add(_line({
            points: [1214, 52, 1220, 45, 1220, 48.5, 1230, 48.5, 1230, 55.5, 1220, 55.5, 1220, 59],
            closed: true, fill: '#3c4348', stroke: '#3c4348', strokeWidth: 1,
        }));
        this._btn(s, 'tb-next', 1240, 39, 28, 26, '', () => this._pageNext());
        s.add(_line({
            points: [1262, 52, 1256, 45, 1256, 48.5, 1246, 48.5, 1246, 55.5, 1256, 55.5, 1256, 59],
            closed: true, fill: '#3c4348', stroke: '#3c4348', strokeWidth: 1,
        }));
        // 打印
        this._btn(s, 'tb-print', 1280, 39, 54, 26, '打印', () => this._tip('报警记录打印（本仿真未连接打印机）'), { fontSize: 13.5 });

        // 右侧菜单按钮：View / Operate / Tools / System（点击展开子菜单）
        const menus = [
            ['menu-view', 1352, 'View'],
            ['menu-operate', 1418, 'Operate'],
            ['menu-tools', 1484, 'Tools'],
            ['menu-system', 1550, 'System'],
        ];
        menus.forEach(([id, x, label]) => {
            this._btn(s, id, x, 40, 62, 24, label, () => this._toggleMenu(id.replace('menu-', '')), { fontSize: 14.5 });
        });

        // ── ③ 左列：UnDock 报警组列表（组名 + 各组未确认报警数）──
        s.add(_rect({ x: 0, y: BAR_Y + BAR_H, width: GROUPS_W, height: H - BAR_Y - BAR_H, fill: '#e7e9ea', stroke: '#b6bcbf', strokeWidth: 1 }));
        // UnDock 状态按钮（静态外框，文字与状态在动态层）
        s.add(_rect({ x: 4, y: 84, width: GROUPS_W - 8, height: 22, fill: '#f6f7f8', stroke: '#8b9195', strokeWidth: 1, cornerRadius: 2 }));

        // ── ④~⑦ Home 内容层（船图 / 表格视图 / 工艺流程图 / 趋势 / 自定义视图）──
        //    进入列表页（当前报警、报警历史…）时整层隐藏，返回 Home 时恢复
        const hs = this._homeStatic;

        // ④ 船舶剪影
        this._drawShip(hs);

        // ⑤ 表格视图
        this._section(hs, CX, Y_TAB, CW, H_TAB-5, '表格视图 (Tabular views)');
        const tabBtns = [
            ['tab-active', '当前报警 Active alarms', () => this._openList('alarms')],
            ['tab-history', '报警历史 Alarm history', () => this._openList('history')],
            ['tab-tags', '标签一览 Tag summary', () => this._openList('tags')],
            ['tab-events', '事件历史 Event history', () => this._openList('events')],
            ['tab-override', '被越控标签 Overridden tags', () => this._openList('override')],
            ['tab-log', '日志查看 Log viewer', () => this._openList('log')],
            ['tab-inhibit', '被闭锁标签 Inhibit tags', () => this._openList('inhibit')],
            ['tab-counters', '计数器列表 Counters list', () => this._openList('counters')],
            ['tab-recover', '标签恢复初值 Tags Recovery', () => this._recover()],
        ];
        const bw = 269, gap = 10;
        tabBtns.forEach((b, i) => {
            const r = Math.floor(i / 5), c = i % 5;
            this._btn(hs, b[0], CX + 16 + c * (bw + gap), Y_TAB + 20 + r * 30, bw, 26, b[1], b[2], { fontSize: 14.5, home: true });
        });

        // ── ⑥ 工艺流程图（Process mimics）──
        this._section(hs, CX, Y_MIMIC, CW, H_MIMIC-5, '工艺流程图 (Process mimics)');
        const gW = 267, gGap = 12;
        const gx = (c) => CX + 16 + c * (gW + gGap);
        const groups = [
            { c: 0, r: 0, title: '主机遥控系统 Main Engine RCS', btns: ['主机操纵系统 M/E Manoeuvring', '主机遥控 ECR', '主机遥控 BRIDGE'] },
            { c: 1, r: 0, title: '主机 Main Engine', btns: ['主机概览 Main engine overview', '增压器 Turbocharger', '主轴承 Bearings'], parts: ['mimic-me'] },
            { c: 2, r: 0, title: '发电机组 GE System', btns: ['1# 发电机组 NO.1 GE', '2# 发电机组 NO.2 GE', '3# 发电机组 NO.3 GE'], parts: ['gen-1', 'gen-2', 'gen-3'] },
            { c: 3, r: 0, title: '燃油系统 Fuel Oil System', btns: ['主机燃油 ME FO', '机组燃油 GE FO', '燃油驳运与加装 FO transfer'] },
            { c: 4, r: 0, title: '滑油系统 Lub. Oil System', btns: ['主机滑油与气缸油 ME LO', '滑油驳运与加装 LO transfer', '滑油分油机 LO Purifying'], parts: ['page-5'] },
            { c: 0, r: 1, title: '冷却水系统 Cooling Water', btns: ['海水冷却系统', '高温淡水冷却', '低温淡水冷却'] },
            { c: 1, r: 1, title: '泵组 Pumps', btns: ['服务泵计数器 Service pumps counters'] },
            { c: 2, r: 1, title: '电站管理 PMS', btns: ['电力管理系统 Power management'] },
            { c: 3, r: 1, title: '锅炉与蒸汽 Boiler & Steam', btns: ['锅炉燃油系统', '锅炉给水系统', '锅炉蒸汽系统'] },
            { c: 4, r: 1, title: '其他 Miscellaneous', btns: ['压缩空气系统', '空气分配系统', '速闭阀控制系统'] },
        ];
        const rowY = [Y_MIMIC + 18, Y_MIMIC + 168];
        const rowH = [132, 122];
        groups.forEach((g) => {
            const x = gx(g.c), y = rowY[g.r], h = rowH[g.r];
            hs.add(_rect({ x, y, width: gW, height: h, fill: '#f4f5f6', stroke: '#9aa0a4', strokeWidth: 1 }));
            hs.add(_text({ x, y: y + 6, width: gW, align: 'center', fontSize: 14.5, fontStyle: 'bold', fill: '#2b3134', text: g.title }));
            g.btns.forEach((label, i) => {
                const partId = g.parts ? g.parts[i] : '';
                const by = y + 28 + i * 27;
                const handler = !partId ? () => this._tip('该工艺流程图在本仿真中未建模')
                    : (partId.indexOf('gen-') === 0
                        ? () => this._openGen(parseInt(partId.slice(4), 10))
                        : (partId.indexOf('page-') === 0
                            ? () => { const n = parseInt(partId.slice(5), 10); if (this.sys.pageMgr) this.sys.pageMgr.navigateTo(n); }
                            : () => this._openMimic()));
                this._btn(hs, partId || '', x + 8, by, gW - 16, 22, label, handler, { fontSize: 13.5, home: true });
            });
        });

        // ── 趋势 ──
        this._section(hs, CX, Y_TREND, CW, H_TREND, '趋势 (Trends)');
        for (let i = 0; i < 5; i++) {
            this._btn(hs, `trend-${i + 1}`, CX + 16 + i * (bw + gap), Y_TREND + 22, bw, 24,
                `趋势 ${i + 1} Trend view ${i + 1}`,
                i === 0 ? () => this._openTrend() : () => this._tip('该趋势视图在本仿真中未建模'),
                { fontSize: 14.5, home: true });
        }

        // ── 自定义视图 ──
        this._section(hs, CX, Y_CUSTOM, CW, H_CUSTOM, '自定义视图 (Custom views)');
        for (let i = 0; i < 5; i++) {
            this._btn(hs, `custom-${i + 1}`, CX + 16 + i * (bw + gap), Y_CUSTOM + 22, bw, 24,
                `自定义视图 ${i + 1} Custom view ${i + 1}`,
                i === 0 ? () => this._openCustom() : () => this._tip('该自定义视图在本仿真中未建模'),
                { fontSize: 14.5, home: true });
        }
    }

    /** 船舶剪影（静态装饰，船名 COSRICH LAKE）——上下不留空隙，紧贴分区框 */
    _drawShip(s) {
        const x0 = CX, y0 = Y_SHIP;
        s.add(_rect({ x: x0, y: y0, width: CW, height: H_SHIP-10, fill: '#f7f8f8', stroke: C_LINE, strokeWidth: 1 }));

        // 船体（干舷深灰）+ 水下红色
        s.add(_line({
            points: [x0 + 176, y0 + 78, x0 + 1300, y0 + 78, x0 + 1390, y0 + 94,
                x0 + 1345, y0 + 134, x0 + 196, y0 + 134, x0 + 132, y0 + 104],
            closed: true, fill: '#232323', stroke: '#111111', strokeWidth: 1,
        }));
        s.add(_line({
            points: [x0 + 182, y0 + 100, x0 + 1386, y0 + 100, x0 + 1345, y0 + 134, x0 + 196, y0 + 134],
            closed: true, fill: '#c8161d', stroke: '#a01015', strokeWidth: 1,
        }));
        // 吃水线
        s.add(_line({ points: [x0 + 168, y0 + 100, x0 + 1390, y0 + 100], stroke: '#ffffff', strokeWidth: 2 }));
        // 船名
        s.add(_text({ x: x0 + 950, y: y0 + 78, width: 400, align: 'center', fontSize: 20, fontStyle: 'bold', fill: '#ffffff', letterSpacing: 1, text: '江苏航院' }));
        // 舷侧白点
        for (let i = 0; i < 5; i++) {
            s.add(new Konva.Circle({ x: x0 + 340 + i * 175, y: y0 + 90, radius: 2.6, fill: '#ffffff', listening: false }));
        }
        // 艉部上层建筑
        s.add(_rect({ x: x0 + 208, y: y0 + 54, width: 176, height: 24, fill: '#f2f2f2', stroke: '#7c8288', strokeWidth: 1 }));
        s.add(_rect({ x: x0 + 244, y: y0 + 32, width: 116, height: 24, fill: '#f7f7f7', stroke: '#7c8288', strokeWidth: 1 }));
        s.add(_rect({ x: x0 + 276, y: y0 + 10, width: 62, height: 24, fill: '#ffffff', stroke: '#7c8288', strokeWidth: 1 }));
        // 窗
        for (let i = 0; i < 9; i++) {
            s.add(_rect({ x: x0 + 220 + i * 18, y: y0 + 60, width: 10, height: 8, fill: '#2b3a44' }));
        }
        for (let i = 0; i < 6; i++) {
            s.add(_rect({ x: x0 + 254 + i * 18, y: y0 + 38, width: 10, height: 8, fill: '#2b3a44' }));
        }
        // 桅杆与吊机（简化的线框）
        s.add(_line({ points: [x0 + 690, y0 + 78, x0 + 690, y0 + 26, x0 + 726, y0 + 26], stroke: '#5f676c', strokeWidth: 2 }));
        s.add(_line({ points: [x0 + 630, y0 + 78, x0 + 630, y0 + 46], stroke: '#5f676c', strokeWidth: 2 }));
        s.add(_rect({ x: x0 + 830, y: y0 + 56, width: 74, height: 22, fill: '#c9cdd0', stroke: '#5f676c', strokeWidth: 1 }));
    }

    /** 动态层：时钟、值班状态、报警计数、Dock 计数器、报警图标、蜂鸣器按钮 */
    _createDynamic() {
        const d = this._dynamicGroup;
        const M = this.model;

        // 时钟
        this._clockText = _text({ x: 62, y: 56, fontSize: 12.5, fill: '#4a5155',fontStyle:'bold', text: dateTimeText() });
        d.add(this._clockText);

        // 值班状态（左：ECR watch / BRIDGE watch，绿色）+ 船况（右：At sea，灰色）——下排并排
        this._watchRect = _rect({ x: 238, y: 56, width: 122, height: 20, fill: C_GREEN, stroke: '#2f9e2f', strokeWidth: 1, cornerRadius: 2 });
        this._watchText = _text({ x: 238, y: 59, width: 122, align: 'center', fontSize: 11.5, fontStyle: 'bold', fill: '#ffffff', text: 'ECR watch' });
        this._seaRect = _rect({ x: 364, y: 56, width: 60, height: 20, fill: '#eceeef', stroke: '#b8bec2', strokeWidth: 1, cornerRadius: 2 });
        this._seaText = _text({ x: 364, y: 59.5, width: 60, align: 'center', fontSize: 10.5, fill: '#444444', text: 'At sea' });
        d.add(this._watchRect, this._watchText, this._seaRect, this._seaText);

        // 最新警报横幅：两行（第 1 行最新）
        this._bannerRows = [];
        for (let i = 0; i < 2; i++) {
            const ry = 29 + i * 22;            // 行顶
            const rec = {
                y: ry,
                prioRect: _rect({ x: 434, y: ry + 2, width: 32, height: 18, fill: '#c9cccd', stroke: '#8b9195', strokeWidth: 1 }),
                prioText: _text({ x: 434, y: ry + 4, width: 32, align: 'center', fontSize: 11.5, fontStyle: 'bold', fill: '#ffffff', text: '' }),
                levelText: _text({ x: 472, y: ry + 4, width: 46, fontSize: 10.5, fill: '#222222', text: '' }),
                timeText: _text({ x: 520, y: ry + 4, width: 62, fontSize: 10.5, fill: '#222222', text: '' }),
                groupText: _text({ x: 586, y: ry + 4, width: 136, fontSize: 10.5, fill: '#222222', text: '' }),
                descText: _text({ x: 726, y: ry + 4, width: 220, fontSize: 10.5, fill: '#222222', text: '' }),
            };
            d.add(rec.prioRect, rec.prioText, rec.levelText, rec.timeText, rec.groupText, rec.descText);
            this._bannerRows.push(rec);
        }

        // 未确认报警数按钮（红块 + 数字 + ▼）
        this._cntBg = _rect({ x: 954, y: 28, width: 40, height: 44, fill: '#d8dcde', stroke: '#9aa0a4', strokeWidth: 1, cornerRadius: 2 });
        this._cntText = _text({ x: 954, y: 32, width: 40, align: 'center', fontSize: 16, fontStyle: 'bold', fill: '#444444', text: '0' });
        this._cntArrow = _text({ x: 954, y: 52, width: 40, align: 'center', fontSize: 11, fill: '#444444', text: '▼' });
        d.add(this._cntBg, this._cntText, this._cntArrow);



        // UnDock 状态按钮文字
        this._unDockText = _text({
            x: 4, y: 88, width: GROUPS_W - 8, align: 'center',
            fontSize: 15, fontStyle: 'bold', fill: '#22303a', text: 'UnDock',
        });
        d.add(this._unDockText);

        // 左列报警组列表（UnDock 状态：逐组显示未确认报警数）
        this._groupRows = [];
        Object.keys(ALARM_GROUPS).forEach((gk, i) => {
            const y = GROUP_TOP + i * GROUP_ROW_H;
            const rowBg = _rect({ x: 3, y, width: GROUPS_W - 6, height: GROUP_ROW_H - 2, fill: '#f6f7f8', stroke: '#b9bfc3', strokeWidth: 1, cornerRadius: 2 });
            const cntBg = _rect({ x: 6, y: y + 4, width: 30, height: GROUP_ROW_H - 10, fill: '#ffffff', stroke: '#b9bfc3', strokeWidth: 1 });
            const cntText = _text({ x: 6, y: y + 8, width: 30, align: 'center', fontSize: 14.5, fontStyle: 'bold', fill: '#333333', text: '0' });
            const nameText = _text({ x: 40, y: y + 8, width: GROUPS_W - 48, fontSize: 12.5, fontStyle: 'bold', fill: '#2b3134', text: ALARM_GROUPS[gk].name });
            d.add(rowBg, cntBg, cntText, nameText);
            this._groupRows.push({ key: gk, y, rowBg, cntBg, cntText, nameText });
        });
    }

    /** 主界面所有可点击部件（含浮层打开时的关闭兜底） */
    _bindInteraction() {
        // Command control（控制命令：车钟 / 舵令等操纵命令的输入与显示）
        const cmdHit = this.addClickablePart('cmd-control', 238, 30, 186, 22);
        cmdHit.on('click', () => this._tip('Command control：车钟、舵令等操纵命令的输入与显示区'));

        // 值班状态 + 船况（识别用：显示当前值班位置与船况）
        const wbHit = this.addClickablePart('watch-box', 238, 56, 122, 20);
        wbHit.on('click', () => this.openWatchCall());

        // UnDock / Dock 状态切换（Dock：左列只留计数条；UnDock：逐组显示报警组）
        const unDockHit = this.addClickablePart('undock-toggle', 4, 84, GROUPS_W - 8, 22);
        unDockHit.on('click', () => {
            this._unDock = !this._unDock;
            this._tip(this._unDock
                ? 'UnDock：左列展开显示各报警组及未确认报警数'
                : 'Dock：左列收为停靠状态，仅显示未确认报警计数');
        });

        // 报警组行：点击打开该组的当前报警
        Object.keys(ALARM_GROUPS).forEach((g, i) => {
            const y = GROUP_TOP + i * GROUP_ROW_H;
            const hit = this.addClickablePart(`dock-${g}`, 3, y, GROUPS_W - 6, GROUP_ROW_H - 2);
            hit.on('click', () => this._openList('group', g));
        });

        // 报警图标按钮：打开当前报警列表
        // 未确认报警数按钮：点击查看未确认报警
        const cntHit = this.addClickablePart('tb-counter', 954, 28, 40, 44);
        cntHit.on('click', () => this._openList('alarms'));
    }

    // ═══════════════════════════════════════════════════════
    //  主界面操作
    // ═══════════════════════════════════════════════════════
    _ack() {
        const n = this.model.ackAll();
        this._tip(n ? `已确认 ${n} 条报警（ACK）` : '当前没有未确认的报警');
    }

    _recover() {
        this.model.recoverAll();
        this._tip('全部标签参数已恢复初值（Tags Recovery to Initial）');
    }

    _openFaultTip() {
        this._tip('故障清单（FES）：请在工具栏「故障设置」中勾选故障后应用');
    }

    // ═══════════════════════════════════════════════════════
    //  值班呼叫 Watch calling（点击 ECR watch 或 Operate→Watch call 弹出）
    // ═══════════════════════════════════════════════════════
    openWatchCall() {
        this._closeMenu();
        this._watchCallOpen = true;
        this._renderWatchCall();
    }

    closeWatchCall() {
        if (!this._watchCallOpen) return;
        this._watchCallOpen = false;
        this._wcGroup.destroyChildren();
        this._clearWcParts();
        this.sys.requestRedraw && this.sys.requestRedraw();
    }

    _clearWcParts() {
        if (this._parts) this._wcPartIds.forEach(id => { delete this._parts[id]; });
        this._wcPartIds = [];
    }

    /** 对话框内按钮（登记到 _wcGroup，供自动演示点击） */
    _wcBtn(g, id, x, y, w, h, label, onClick, opts = {}) {
        const fill = opts.fill || null;
        g.add(_rect({
            x, y, width: w, height: h,
            fill: fill || '#fbfcfc',
            fillLinearGradientStartPoint: fill ? undefined : { x: 0, y: 0 },
            fillLinearGradientEndPoint: fill ? undefined : { x: 0, y: h },
            fillLinearGradientColorStops: fill ? undefined : [0, '#fdfdfd', 1, '#dfe2e4'],
            stroke: opts.stroke || '#8b9195', strokeWidth: 1, cornerRadius: 2,
        }));
        g.add(_text({
            x, y: y + Math.max(1, (h - (opts.fontSize || 12.5)) / 2 - 2), width: w, align: 'center',
            fontSize: opts.fontSize || 12.5, fontStyle: opts.bold ? 'bold' : 'normal',
            fill: opts.color || '#1d1d1d', text: label,
        }));
        const hit = new Konva.Rect({ x, y, width: w, height: h, fill: 'rgba(0,0,0,0)', listening: true, cursor: 'pointer' });
        hit.on('click tap', (e) => {
            e.cancelBubble = true;
            if (this.sys) { this.sys.lastClickedId = this.id; this.sys.lastClickedPartId = `${this.id}/${id}`; }
            onClick && onClick();
        });
        g.add(hit);
        if (!this._parts) this._parts = {};
        this._parts[id] = { x, y, w, h, node: hit };
        this._wcPartIds.push(id);
    }

    _renderWatchCall() {
        const g = this._wcGroup;
        g.destroyChildren();
        this._clearWcParts();
        if (!this._watchCallOpen) { this.sys.requestRedraw && this.sys.requestRedraw(); return; }

        const M = this.model;
        const blink = Math.floor(M.t * 2) % 2 === 0;      // 呼叫闪烁（绿 / 亮绿）
        const GREEN = '#3fbf3f';
        const GREEN_LT = '#8ef08e';

        const pw = 300, ph = 620;
        const px = W - pw - 20, py = 30;

        // 窗体
        g.add(_rect({ x: px, y: py, width: pw, height: ph, fill: '#e9ecee', stroke: '#5a6167', strokeWidth: 1.3 }));
        // 标题栏
        g.add(_rect({ x: px, y: py, width: pw, height: 30, fill: '#dfe3e5', stroke: '#a8b0b5', strokeWidth: 1 }));
        g.add(_text({ x: px + 10, y: py + 8, width: pw - 50, fontSize: 13.5, fontStyle: 'bold', fill: '#1d1d1d', text: 'Watch calling' }));
        this._wcBtn(g, 'wc-close', px + pw - 34, py + 4, 26, 22, '✕', () => this.closeWatchCall(), { fontSize: 12 });
        this._wcBtn(g, 'wc-collapse', px + pw - 34, py + 32, 26, 22, '»', () => { /* 折叠（本仿真不做） */ }, { fontSize: 13 });

        // ── Engine duty：5 位轮机员（呼叫中闪绿，当班常绿）──
        g.add(_text({ x: px + 10, y: py + 66, width: pw - 20, fontSize: 12.5, fill: '#1d1d1d', text: 'Engine duty' }));
        const dutyBtns = [
            ['chief', 'CHIEF ENG.'],
            ['first', '2ND ENG.'],
            ['second', '3RD ENG.'],
            ['third', '4TH ENG.'],
            ['elec', 'ELEC. ENG.'],
        ];
        dutyBtns.forEach(([id, label], i) => {
            const by = py + 88 + i * 44;
            const calling = M.callTarget === id;      // 正在呼叫（闪烁）
            const onDuty = M.dutyPanel === id;        // 当前值班者（常绿）
            const pending = M.pendingDuty === id;     // 已应答、等待原值班者交班（常绿）
            const fill = calling ? (blink ? GREEN : GREEN_LT) : ((onDuty || pending) ? GREEN : null);
            this._wcBtn(g, `wc-duty-${id}`, px + 10, by, pw - 20, 36, label, () => {
                if (M.dutyPanel === id) {
                    // 值班者再按一次＝解除自己的值班（若有待接班者则完成交接）
                    M.releaseDuty(id);
                } else if (M.pendingDuty === id) {
                    M.pendingDuty = null;             // 取消接班
                } else {
                    M.callEngineer(id);               // 发起 / 取消呼叫
                }
                this._renderWatchCall();
            }, { fill, color: (calling || onDuty || pending) ? '#ffffff' : '#1d1d1d', bold: calling || onDuty || pending });
        });

        // ── Engine watch：ECR / BRIDGE ──
        g.add(_text({ x: px + 10, y: py + 320, width: pw - 20, fontSize: 12.5, fill: '#1d1d1d', text: 'Engine watch' }));
        [['ECR', 'ECR'], ['BRIDGE', 'BRIDGE']].forEach(([pos, label], i) => {
            const by = py + 342 + i * 44;
            const active = (M.watch === pos);
            this._wcBtn(g, `wc-watch-${pos.toLowerCase()}`, px + 10, by, pw - 20, 36, label, () => {
                M.setWatch(pos);
                this._renderWatchCall();
            }, { fill: active ? GREEN : null, color: active ? '#ffffff' : '#1d1d1d', bold: active });
        });

        // ── Call engine duty ──
        g.add(_text({ x: px + 10, y: py + 432, width: pw - 20, fontSize: 12.5, fill: '#1d1d1d', text: 'Call engine duty' }));
        this._wcBtn(g, 'wc-call-all', px + 10, py + 454, pw - 20, 36, 'Call all engineer', () => {
            this._wcPress = { id: 'wc-call-all', t: Date.now() };       // 点击特效
            M.callAll();
            this._renderWatchCall();
        });
        this._wcBtn(g, 'wc-call-duty', px + 10, py + 496, pw - 20, 36, 'Call duty engineer', () => {
            this._wcPress = { id: 'wc-call-duty', t: Date.now() };      // 点击特效
            M.callDuty();
            this._renderWatchCall();
        });

        // ── 两个 Call Engineer 按钮的点击动态特效（按下变深 + 双向扩散波纹）──
        if (this._wcPress && Date.now() - this._wcPress.t < 620) {
            const pid = this._wcPress.id;
            const dt = Date.now() - this._wcPress.t;
            const bx = px + 10, bw = pw - 20, bh = 36;
            const by = pid === 'wc-call-all' ? py + 454 : py + 496;
            if (dt < 170) {
                g.add(_rect({ x: bx, y: by, width: bw, height: bh, fill: 'rgba(28,111,178,0.38)', stroke: '#14567f', strokeWidth: 1.6, cornerRadius: 2 }));
            }
            [0, 190].forEach((delay) => {
                const t2 = dt - delay;
                if (t2 < 0 || t2 > 400) return;
                const p2 = t2 / 400;
                const e = 3 + p2 * 12;
                g.add(new Konva.Rect({
                    x: bx - e, y: by - e, width: bw + e * 2, height: bh + e * 2,
                    stroke: '#2f9de0', strokeWidth: 3 * (1 - p2), opacity: 0.9 * (1 - p2),
                    cornerRadius: 3 + e, listening: false,
                }));
            });
        }
        this._wcBtn(g, 'wc-accept', px + 10, py + 538, 136, 34, 'Accept', () => {
            M.acceptCall();
            this._renderWatchCall();
        }, { bold: true });
        this._wcBtn(g, 'wc-reject', px + 154, py + 538, 136, 34, 'Reject', () => {
            M.rejectCall();
            this._renderWatchCall();
        });

        // ── Repeated alarm 指示灯 ──
        g.add(_text({ x: px + 10, y: py + 588, width: pw - 40, fontSize: 12.5, fill: '#1d1d1d', text: 'Repeated alarm' }));
        const hasUnack = M.unackCount() > 0;
        g.add(new Konva.Circle({
            x: px + pw - 26, y: py + 596, radius: 8,
            fill: hasUnack ? (blink ? '#e01b1b' : '#ffb3b3') : '#d0d4d6',
            stroke: '#8b9195', strokeWidth: 1, listening: false,
        }));

        this.sys.requestRedraw && this.sys.requestRedraw();
    }

    /**
     * 安保越控（Cancel SHD / Cancel SLD）：
     * AHH / ALL 报警会在延时后触发主机自动停车 / 自动减速；在延时到之前按下
     * Cancel Shut Down / Cancel Slow Down 即越控该安保信号，并记入 Overridden tags。
     */
    _cancelSafety(type) {
        const n = this.model.cancelSafety(type);
        if (!n) {
            this._tip(type === 'SHD'
                ? '当前没有待执行的主机自动停车信号（AHH/ALL 报警延时内才可越控）'
                : '当前没有待执行的主机自动减速信号（AHH/ALL 报警延时内才可越控）');
        }
    }

    /** 值班状态提示（面板 ECR watch 区域 / Operate→Watch call 共用） */
    _watchInfo() {
        this._tip(`当前值班位置：${this.model.watch === 'BRIDGE' ? 'BRIDGE 驾驶台' : 'ECR 集控室'}；船况：At sea`);
    }

    // ═══════════════════════════════════════════════════════
    //  下拉菜单：View / Operate / Tools / System
    // ═══════════════════════════════════════════════════════
    /** 菜单项定义（name → { x, w, items: [[label, act], …] }） */
    _menuSpec(name) {
        const M = this.model;
        if (name === 'view') {
            return {
                x: 1402, w: 210,
                items: [
                    ['Active alarms', () => this._openList('alarms')],
                    ['Alarm history', () => this._openList('history')],
                    ['Tag summary', () => this._openList('tags')],
                    ['Event history', () => this._openList('events')],
                    ['Overridden tags', () => this._openList('override')],
                    ['Log viewer', () => this._openList('log')],
                    ['Inhibit tags', () => this._openList('inhibit')],
                    ['Counters list', () => this._openList('counters')],
                ],
            };
        }
        if (name === 'operate') {
            return {
                x: 1402, w: 240,
                items: [
                    ['Watch call', () => this.openWatchCall()],
                    ['Acknowledgement', () => this._ack()],
                    ['Sound off', () => { M.silence(); this._tip('消音（Sound off）：蜂鸣器停止，报警灯仍闪烁直到确认'); }],
                    ['Cancel Shut Down', () => this._cancelSafety('SHD')],
                    ['Cancel Slow Down', () => this._cancelSafety('SLD')],
                ],
            };
        }
        if (name === 'tools') {
            return {
                x: 1402, w: 210,
                items: [
                    ['DPU replacement', () => this._tip('DPU 更换：须在断电后进行，更换后由系统自动下载配置（本仿真未建模）')],
                    ['Trim and list controls', () => this._tip('横倾与吃水控制（Trim and list）：调整压载水修正横倾与吃水差（本仿真未建模）')],
                ],
            };
        }
        return {
            x: 1402, w: 210,
            items: [
                ['Print', () => this._tip('打印当前视图（本仿真未连接打印机）')],
                ['Scheduled print', () => this._tip('定时打印：按设定间隔自动打印报警记录（本仿真未建模）')],
                ['Date and time', () => this._tip(`系统日期时间：${dateTimeText()}`)],
                ['Help', () => this._tip('帮助：报警页 / 操作页 / 工具页 / 系统页的说明')],
                ['About', () => this._tip('DMS-2024A-2D　ERS 2D TERMINAL　K-Chief 600 仿真教学版')],
            ],
        };
    }

    _toggleMenu(name) {
        this._menuOpen = (this._menuOpen === name) ? null : name;
        this._renderMenu();
    }

    _closeMenu() {
        if (!this._menuOpen) return;
        this._menuOpen = null;
        this._renderMenu();
    }

    _clearMenuParts() {
        if (this._parts) this._menuPartIds.forEach(id => { delete this._parts[id]; });
        this._menuPartIds = [];
    }

    /** 绘制下拉菜单（点击菜单外区域关闭） */
    _renderMenu() {
        const g = this._menuGroup;
        g.destroyChildren();
        this._clearMenuParts();
        if (!this._menuOpen) { this.sys.requestRedraw && this.sys.requestRedraw(); return; }

        const spec = this._menuSpec(this._menuOpen);
        const top = 70, itemH = 24, pad = 5;
        const h = spec.items.length * itemH + pad * 2;

        // 透明遮罩：点菜单外关闭
        const shield = new Konva.Rect({ x: 0, y: 0, width: W, height: H, fill: 'rgba(0,0,0,0.001)', listening: true });
        shield.on('click tap', (e) => { e.cancelBubble = true; this._closeMenu(); });
        g.add(shield);

        g.add(_rect({ x: spec.x, y: top, width: spec.w, height: h, fill: '#f7f8f9', stroke: '#6a7176', strokeWidth: 1.2, cornerRadius: 2 }));
        spec.items.forEach(([label, act], i) => {
            const iy = top + pad + i * itemH;
            const hl = _rect({ x: spec.x + 1, y: iy, width: spec.w - 2, height: itemH, fill: '#3f9de0', visible: false });
            const txt = _text({ x: spec.x + 12, y: iy + 5, width: spec.w - 24, fontSize: 12, fill: '#22303a', text: label });
            const hit = new Konva.Rect({ x: spec.x + 1, y: iy, width: spec.w - 2, height: itemH, fill: 'rgba(0,0,0,0)', listening: true, cursor: 'pointer' });
            hit.on('mouseenter', () => { hl.visible(true); this.sys.requestRedraw && this.sys.requestRedraw(); });
            hit.on('mouseleave', () => { hl.visible(false); this.sys.requestRedraw && this.sys.requestRedraw(); });
            hit.on('click tap', (e) => {
                e.cancelBubble = true;
                if (this.sys) { this.sys.lastClickedId = this.id; this.sys.lastClickedPartId = `${this.id}/menu-${this._menuOpen}-${i}`; }
                this._closeMenu();
                act && act();
            });
            g.add(hl, txt, hit);
            const pid = `menu-${this._menuOpen}-${i}`;
            if (!this._parts) this._parts = {};
            this._parts[pid] = { x: spec.x + 1, y: iy, w: spec.w - 2, h: itemH, node: hit };
            this._menuPartIds.push(pid);
        });
        this.sys.requestRedraw && this.sys.requestRedraw();
    }

    // ═══════════════════════════════════════════════════════
    //  列表页前进 / 后退（翻页）
    // ═══════════════════════════════════════════════════════
    get _pageRows() { return 21; }

    _pagePrev() {
        if (!this._overlay || this._overlay === 'param' || this._overlay === 'trend' || this._overlay === 'custom' || this._overlay === 'gen') { this._tip('前进 / 后退：仅在报警列表页可用'); return; }
        if (this._rowOffset <= 0) { this._tip('已到列表首页'); return; }
        this._rowOffset = Math.max(0, this._rowOffset - this._pageRows);
        this._renderPage();
    }

    _pageNext() {
        if (!this._overlay || this._overlay === 'param' || this._overlay === 'trend' || this._overlay === 'custom' || this._overlay === 'gen') { this._tip('前进 / 后退：仅在报警列表页可用'); return; }
        const total = this._tableSpec().rows.length;
        const max = Math.max(0, total - this._pageRows);
        if (this._rowOffset >= max) { this._tip('已到列表末页'); return; }
        this._rowOffset = Math.min(max, this._rowOffset + this._pageRows);
        this._renderPage();
    }

    /** 进入整页（Home 隐藏）：kind 为列表页类型；groupFilter 为报警组过滤 */
    _showPage(kind, groupFilter = null) {
        this._groupFilter = groupFilter;
        this._rowOffset = 0;          // 每次进入页面从第一页开始
        this._overlay = kind;
        this._homeStatic.visible(false);
        this._homeInteract.visible(false);
        this._pageGroup.visible(true);
        this._renderPage();
    }

    _openList(kind, groupFilter = null) { this._showPage(kind, groupFilter); }

    _openMimic() { this._showPage('mimic'); }

    /** 趋势 1：默认参数趋势页（滑油进机压力 / 温度） */
    _openTrend() { this._showPage('trend'); }

    /** 返回 Home（恢复船图 / 表格视图 / 工艺流程图 / 趋势 / 自定义视图） */
    _backHome() {
        this._closeMenu();
        this.closeWatchCall();
        this._overlay = null;
        this._paramTagId = null;
        this._paramBack = null;
        this._edit = null;
        this._overlayGroup.destroyChildren();
        this._clearDialogParts();
        this._pageGroup.destroyChildren();
        this._clearPageParts();
        this._pageGroup.visible(false);
        this._homeStatic.visible(true);
        this._homeInteract.visible(true);
        this.sys.requestRedraw && this.sys.requestRedraw();
    }

    /** 兼容旧调用：等同于返回 Home */
    _closeOverlay() { this._backHome(); }

    /** 打开某测点的报警参数界面（双击列表条目触发；工作副本 _edit，点「保存」才生效） */
    openParam(tagId) {
        const tag = this.model.tag(tagId);
        if (!tag) return;
        // 已经打开同一测点的参数界面（双击时 click 判定与 dblclick 可能同时触发）→ 直接返回
        if (this._overlay === 'param' && this._paramTagId === tagId) return;
        this.closeWatchCall();     // 打开参数界面时关闭值班呼叫对话框，避免两层对话框重叠
        this._endEdit();
        this._paramTagId = tagId;
        this._paramTab = 'alarm';
        // 工作副本：可一次修改多个参数，取消则全部还原
        this._edit = {
            isAlarm: tag.enabled !== false,
            isInhibit: !!tag.inhibit,
            limit: tag.limit,
            deadband: tag.deadband,
            delay: tag.delay,
        };
        // 记下从哪个页面打开，关闭后回到该页（若当前已是 param 则沿用上一次的返回目标）
        this._paramBack = (this._overlay === 'param') ? (this._paramBack || null) : this._overlay;
        this._overlay = 'param';
        this._renderDialog();
    }

    /** 关闭参数界面（不保存） */
    cancelParam() {
        this._endEdit();
        this._closeDialog();
    }

    /** 关闭参数对话框：回到打开它的那个页面（列表页 / 概览页 / Home） */
    _closeDialog() {
        this._overlay = (this._paramBack && this._paramBack !== 'param') ? this._paramBack : null;
        this._paramTagId = null;
        this._edit = null;
        this._overlayGroup.destroyChildren();
        this._clearDialogParts();
        if (this._overlay) this._renderPage();
        this.sys.requestRedraw && this.sys.requestRedraw();
    }

    /** 保存参数：把工作副本一次写回模型 */
    saveParam() {
        const tag = this.model.tag(this._paramTagId);
        if (!tag || !this._edit) return;
        const e = this._edit;
        this._endEdit();
        tag.enabled = !!e.isAlarm;                       // Is Alarm
        this.model.updateTag(tag.id, { limit: e.limit, delay: e.delay, deadband: e.deadband });
        this.model.inhibit(tag.id, !!e.isInhibit);        // Is Inhibit

        this._closeDialog();
    }

    // ═══════════════════════════════════════════════════════
    //  整页（列表页 / 主机概览页）与参数对话框
    // ═══════════════════════════════════════════════════════
    _clearPageParts() {
        if (this._parts) this._pagePartIds.forEach(id => { delete this._parts[id]; });
        this._pagePartIds = [];
    }

    _clearDialogParts() {
        if (this._parts) this._dialogPartIds.forEach(id => { delete this._parts[id]; });
        this._dialogPartIds = [];
    }

    /** 页面/对话框按钮：绘制外观 + 在对应层内登记热区（供自动演示真实点击） */
    _ovBtn(g, id, x, y, w, h, label, onClick, opts = {}) {
        const bg = _rect({
            x, y, width: w, height: h,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint: { x: 0, y: h },
            fillLinearGradientColorStops: opts.primary
                ? [0, '#3f9de0', 1, '#1c6fb2']
                : [0, '#fdfdfd', 1, '#dfe2e4'],
            stroke: opts.primary ? '#14567f' : '#9aa0a4',
            strokeWidth: 1, cornerRadius: 2,
            listening: false,
        });
        g.add(bg);
        g.add(_text({
            x, y: y + Math.max(1, (h - (opts.fontSize || 12)) / 2 - 2), width: w, align: 'center',
            fontSize: opts.fontSize || 12, fontStyle: 'bold', fill: opts.primary ? '#ffffff' : C_TEXT,
            text: label,
        }));
        const hit = new Konva.Rect({ x, y, width: w, height: h, fill: 'rgba(0,0,0,0)', listening: true, cursor: 'pointer' });
        hit.on('click tap', (e) => {
            e.cancelBubble = true;
            if (this.sys) { this.sys.lastClickedId = this.id; this.sys.lastClickedPartId = `${this.id}/${id}`; }
            onClick && onClick();
        });
        g.add(hit);
        if (!this._parts) this._parts = {};
        this._parts[id] = { x, y, w, h, node: hit };
        if (g === this._pageGroup) this._pagePartIds.push(id);
        else this._dialogPartIds.push(id);
    }

    /** 重绘当前整页 */
    _renderPage() {
        const g = this._pageGroup;
        g.destroyChildren();
        this._clearPageParts();
        // 参数界面（对话框）打开时，背后的页面类型用 _paramBack
        const kind = (this._overlay === 'param') ? this._paramBack : this._overlay;
        if (!kind) { this.sys.requestRedraw && this.sys.requestRedraw(); return; }
        // 记录曾打开过的页面类型（供工作流 check() 判定"是否进入过某页"）
        if (!this._visited) this._visited = [];
        if (this._visited.indexOf(kind) < 0) this._visited.push(kind);
        if (kind === 'mimic') this._renderMimic();
        else if (kind === 'trend') this._renderTrend();
        else if (kind === 'custom') this._renderCustom();
        else if (kind === 'gen') this._renderGen();
        else this._renderTable(kind);
        this._lastOverlayRefresh = Date.now();
        this.sys.requestRedraw && this.sys.requestRedraw();
    }

    /** 重绘参数对话框（浮在页面之上） */
    _renderDialog() {
        const g = this._overlayGroup;
        g.destroyChildren();
        this._clearDialogParts();
        if (this._overlay !== 'param') { this.sys.requestRedraw && this.sys.requestRedraw(); return; }
        // 遮罩：挡住下层页面的点击
        const shield = new Konva.Rect({ x: 0, y: 0, width: W, height: H, fill: 'rgba(18,28,38,0.28)', listening: true });
        shield.on('click tap', (e) => { e.cancelBubble = true; });
        g.add(shield);
        this._renderParam();
        this.sys.requestRedraw && this.sys.requestRedraw();
    }

    /** 兼容旧名 */
    _renderOverlay() {
        if (this._overlay === 'param') this._renderDialog();
        else if (this._overlay) this._renderPage();
    }

    // ═══════════════════════════════════════════════════════
    //  趋势页（趋势 1：默认显示滑油进机压力 / 温度两条曲线）
    // ═══════════════════════════════════════════════════════

    /** 默认两条曲线的定义（与 PT-101 / TT-101 对应） */
    get _trendDefaults() {
        return [
            { tagId: 'ME-LO-P', no: 104, tagNo: 501, color: '#8ed15a', range: [0, 0.6] },
            { tagId: 'ME-LO-T', no: 107, tagNo: 506, color: '#a678b8', range: [0, 100] },
        ];
    }

    _initTrend() {
        this._trend = {
            tags: this._trendDefaults.map(d => Object.assign({ visible: true }, d)),
            sel: -1,
        };
        if (!this._trendHist) this._trendHist = {};
        this._trendWindow = 120000;      // 显示窗口 120 s
        this._trendAt = 0;
    }

    /** 补回被移除的默认曲线（Add tag） */
    addTrendDefaultTags() {
        if (!this._trend) this._initTrend();
        this._trendDefaults.forEach(d => {
            if (!this._trend.tags.some(t => t.tagId === d.tagId)) {
                this._trend.tags.push(Object.assign({ visible: true }, d));
            }
        });
        if (this._overlay === 'trend') this._renderPage();
    }

    /** 采样：每 0.5 s 记录一次测点数值（页面关闭后继续缓存） */
    _sampleTrend() {
        if (!this._trend) return;
        const now = Date.now();
        if (now - (this._trendAt || 0) < 500) return;
        this._trendAt = now;
        if (!this._trendHist) this._trendHist = {};
        this._trend.tags.forEach(t => {
            const tg = this.model.tag(t.tagId);
            const h = this._trendHist[t.tagId] || (this._trendHist[t.tagId] = []);
            h.push({ t: now, v: tg && tg.normal != null ? tg.normal : 0 });
            const cut = now - this._trendWindow - 10000;
            while (h.length && h[0].t < cut) h.shift();
        });
    }

    /** 趋势页：参数表 + 曲线图 */
    _renderTrend() {
        const g = this._pageGroup;
        if (!this._trend) this._initTrend();
        const now = Date.now();
        const px = CX + 4, py = Y_SHIP, pw = CW - 8, ph = H - py - 10;

        g.add(_rect({ x: px, y: py, width: pw, height: ph, fill: '#f4f5f6', stroke: '#5a6167', strokeWidth: 1.4, cornerRadius: 3 }));

        // 页面部件热区（供自动演示真实点击）
        const pagePart = (id, x, y, w, h, onClick) => {
            const hit = new Konva.Rect({ x, y, width: w, height: h, fill: 'rgba(0,0,0,0)', listening: true, cursor: 'pointer' });
            hit.on('click tap', (e) => {
                e.cancelBubble = true;
                if (this.sys) { this.sys.lastClickedId = this.id; this.sys.lastClickedPartId = this.id + '/' + id; }
                onClick && onClick();
            });
            g.add(hit);
            if (!this._parts) this._parts = {};
            this._parts[id] = { x, y, w, h, node: hit };
            this._pagePartIds.push(id);
        };

        // ── ① 参数表 ──
        const tx = px + 8, ty = py + 8, tw = pw - 158, rh = 28;
        const cols = [
            ['Visible', 12], ['Color', 76], ['ID', 144], ['Tag', 210],
            ['Description', 282], ['Value', 782], ['Eng unit', 900], ['Measure range', 1010],
        ];
        g.add(_rect({
            x: tx, y: ty, width: tw, height: rh,
            fillLinearGradientStartPoint: { x: 0, y: 0 }, fillLinearGradientEndPoint: { x: 0, y: rh },
            fillLinearGradientColorStops: [0, '#f8f9fa', 1, '#e3e6e8'],
            stroke: '#a8aeb2', strokeWidth: 1,
        }));
        cols.forEach(([t, dx]) => g.add(_text({ x: tx + dx, y: ty + 7, fontSize: 12, fill: '#2b3134', text: t })));

        this._trend.tags.forEach((row, i) => {
            const tg = this.model.tag(row.tagId) || {};
            const ry = ty + rh * (i + 1);
            g.add(_rect({ x: tx, y: ry, width: tw, height: rh, fill: '#ffffff', stroke: '#c6cacc', strokeWidth: 1 }));
            if (this._trend.sel === i) {
                g.add(_rect({ x: tx, y: ry, width: tw, height: rh, fill: 'rgba(74,144,217,0.12)' }));
            }
            // 行选择
            pagePart('trend-row-' + i, tx + 300, ry + 1, tw - 420, rh - 2, () => {
                this._trend.sel = i; this._renderPage();
            });
            // Visible 复选框
            g.add(_rect({ x: tx + 20, y: ry + 7, width: 14, height: 14, fill: '#ffffff', stroke: '#7b8286', strokeWidth: 1, cornerRadius: 2 }));
            if (row.visible) g.add(_text({ x: tx + 20, y: ry + 4, width: 14, align: 'center', fontSize: 13, fontStyle: 'bold', fill: '#2b7a2b', text: '✓' }));
            pagePart('trend-vis-' + i, tx + 12, ry + 1, 32, rh - 2, () => {
                row.visible = !row.visible; this._renderPage();
            });
            // 颜色块
            g.add(_rect({ x: tx + 84, y: ry + 6, width: 16, height: 16, fill: row.color, stroke: '#8a8f92', strokeWidth: 1 }));
            // 各列文字
            g.add(_text({ x: tx + 144, y: ry + 8, fontSize: 12.5, fill: '#1b1f21', text: String(row.no) }));
            g.add(_text({ x: tx + 210, y: ry + 8, fontSize: 12.5, fill: '#1b1f21', text: String(row.tagNo) }));
            g.add(_text({ x: tx + 282, y: ry + 8, fontSize: 12.5, fill: '#1b1f21', text: tg.en || row.tagId }));
            g.add(_text({ x: tx + 782, y: ry + 8, fontSize: 12.5, fill: '#1a4fa0', text: (tg.normal != null ? tg.normal : 0).toFixed(2) }));
            g.add(_text({ x: tx + 900, y: ry + 8, fontSize: 12.5, fill: '#1b1f21', text: tg.unit || '' }));
            g.add(_text({ x: tx + 1010, y: ry + 8, fontSize: 12.5, fill: '#1b1f21', text: row.range[0] + '~' + row.range[1] }));
        });

        // Add tag / Remove tag
        const bx = tx + tw + 12;
        this._ovBtn(g, 'trend-add', bx, ty + 6, 118, 26, 'Add tag', () => this.addTrendDefaultTags(), { fontSize: 13 });
        this._ovBtn(g, 'trend-remove', bx, ty + 42, 118, 26, 'Remove tag', () => {
            if (this._trend.sel >= 0 && this._trend.tags.length > 1) {
                this._trend.tags.splice(this._trend.sel, 1);
                this._trend.sel = -1;
                this._renderPage();
            }
        }, { fontSize: 13 });

        // ── ② 曲线图 ──
        const tBot = ty + rh * (1 + this._trend.tags.length);
        const gx0 = px + 56, gx1 = px + pw - 54;
        const gy0 = tBot + 36, gy1 = py + ph - 46;
        const win = this._trendWindow || 120000;
        const tEnd = now, tStart = now - win;

        g.add(_text({ x: gx0, y: gy0 - 22, width: gx1 - gx0, align: 'center', fontSize: 14, fill: '#2b3134', text: 'Trends' }));
        g.add(_rect({ x: gx0, y: gy0, width: gx1 - gx0, height: gy1 - gy0, fill: '#ffffff', stroke: '#9aa0a4', strokeWidth: 1 }));

        // 横向网格 + 左（%）右（数值）双刻度
        for (let i = 0; i <= 5; i++) {
            const y = gy0 + (gy1 - gy0) * i / 5;
            g.add(_line({ points: [gx0, y, gx1, y], stroke: '#dfe3e5', strokeWidth: 1, dash: [2, 3] }));
            g.add(_text({ x: gx0 - 48, y: y - 7, width: 42, align: 'right', fontSize: 11, fill: '#4a5054', text: (100 - i * 20) + '%' }));
            g.add(_text({ x: gx1 + 6, y: y - 7, width: 40, fontSize: 11, fill: '#4a5054', text: String(100 - i * 20) }));
        }
        // 纵向网格 + 时间刻度
        const hhmmss = (d) => [d.getHours(), d.getMinutes(), d.getSeconds()].map(v => String(v).padStart(2, '0')).join(':');
        for (let i = 0; i <= 6; i++) {
            const x = gx0 + (gx1 - gx0) * i / 6;
            g.add(_line({ points: [x, gy0, x, gy1], stroke: '#e9edef', strokeWidth: 1, dash: [2, 3] }));
            g.add(_text({ x: x - 36, y: gy1 + 6, width: 72, align: 'center', fontSize: 10.5, fill: '#4a5054', text: hhmmss(new Date(tStart + win * i / 6)) }));
        }
        g.add(_text({ x: gx0, y: gy1 + 24, width: gx1 - gx0, align: 'center', fontSize: 11.5, fill: '#4a5054', text: 'Time' }));

        // 图例（8 个趋势槽位，K-Chief 固定版式）
        const legendColors = ['#b6e07f', '#b9bcbe', '#f06a6a', '#7cc46a', '#a678b8', '#8cc3ea', '#c9ccce', '#2c9c94'];
        const slotW = 74, lgW = slotW * legendColors.length;
        const lgX = gx1 - 10 - lgW, lgY = gy0 + 6;
        g.add(_rect({ x: lgX - 6, y: lgY - 3, width: lgW + 12, height: 21, fill: '#ffffff', stroke: '#c0c6c9', strokeWidth: 1 }));
        legendColors.forEach((c, i) => {
            const x = lgX + i * slotW;
            g.add(_line({ points: [x, lgY + 8, x + 16, lgY + 8], stroke: c, strokeWidth: 2.2 }));
            g.add(_text({ x: x + 18, y: lgY + 1, fontSize: 10, fill: '#2b3134', text: 'Trend' + i }));
        });

        // 曲线（按各自量程折算成百分比）
        this._trend.tags.forEach((row) => {
            if (!row.visible) return;
            const h = (this._trendHist || {})[row.tagId] || [];
            const lo = row.range[0], span = (row.range[1] - row.range[0]) || 1;
            const pts = [];
            h.forEach((smp) => {
                if (smp.t < tStart) return;
                const pct = Math.max(0, Math.min(1, (smp.v - lo) / span));
                pts.push(gx0 + (smp.t - tStart) / win * (gx1 - gx0), gy1 - pct * (gy1 - gy0));
            });
            if (pts.length >= 4) {
                g.add(_line({ points: pts, stroke: row.color, strokeWidth: 1.8, lineJoin: 'round', lineCap: 'round' }));
            }
        });
    }

    // ═══════════════════════════════════════════════════════
    //  自定义视图页（自定义视图 1：参数表 + 仪表盘）
    // ═══════════════════════════════════════════════════════

    /** 默认两个仪表盘：滑油进机压力 / 温度 */
    get _customDefaults() {
        return [
            { tagId: 'ME-LO-P', no: 104, tagNo: 501, range: [0, 0.6], labels: 4, decimals: 1 },
            { tagId: 'ME-LO-T', no: 107, tagNo: 506, range: [0, 100], labels: 6, decimals: 0 },
        ];
    }

    _initCustom() {
        this._custom = { tags: this._customDefaults.map(d => Object.assign({ visible: true }, d)), sel: -1 };
    }

    /** 自定义视图 1 */
    _openCustom() { this._showPage('custom'); }

    /** 半圆仪表盘：bands + 刻度 + 数字 + 指针 + 数字显示框 */
    _drawGauge(g, cx, gy, R, row) {
        const tg = this.model.tag(row.tagId) || {};
        const [lo, hi] = row.range;
        const span = (hi - lo) || 1;
        const val = tg.normal != null ? tg.normal : 0;
        const pct = Math.max(0, Math.min(1, (val - lo) / span));
        const arc = (rot, ang, ri, ro, fill, stroke) => new Konva.Arc({
            x: cx, y: gy, innerRadius: ri, outerRadius: ro, angle: ang, rotation: rot,
            fill, stroke, strokeWidth: stroke ? 1 : 0, listening: false,
        });
        // 外圈刻度带（浅底 + 深蓝正常区 + 左端红色极限记号）
        g.add(arc(180, 180, R - 16, R, '#cfe2f2', '#8fa9bd'));
        g.add(arc(192, 156, R - 16, R, '#16689e', null));
        g.add(arc(180, 6, R - 16, R, C_RED, null));
        // 刻度
        for (let i = 0; i <= 40; i++) {
            const a = Math.PI + (i / 40) * Math.PI;
            const major = i % 8 === 0;
            const r1 = R - 16 - (major ? 12 : 6);
            g.add(_line({
                points: [cx + Math.cos(a) * r1, gy + Math.sin(a) * r1, cx + Math.cos(a) * (R - 17), gy + Math.sin(a) * (R - 17)],
                stroke: '#4a5054', strokeWidth: major ? 1.6 : 1,
            }));
        }
        // 数字
        const n = row.labels || 5;
        for (let i = 0; i < n; i++) {
            const t = n === 1 ? 0 : i / (n - 1);
            const a = Math.PI + t * Math.PI;
            const rr = R - 44;
            const v = lo + span * t;
            g.add(_text({
                x: cx + Math.cos(a) * rr - 20, y: gy + Math.sin(a) * rr - 8, width: 40, align: 'center',
                fontSize: 13, fill: '#2b3134',
                text: row.decimals ? v.toFixed(row.decimals) : String(Math.round(v)),
            }));
        }
        // 指针
        const na = Math.PI + pct * Math.PI;
        g.add(_line({
            points: [cx, gy, cx + Math.cos(na) * (R - 18), gy + Math.sin(na) * (R - 18)],
            stroke: '#333333', strokeWidth: 3.6, lineCap: 'round',
        }));
        g.add(new Konva.Circle({ x: cx, y: gy, radius: 9, fill: '#d8dcde', stroke: '#5a6167', strokeWidth: 1.4, listening: false }));
        // 数字显示框
        const bw = 226, bh = 42, bx = cx - bw / 2, by = gy + 26;
        g.add(_rect({ x: bx, y: by, width: bw, height: bh, fill: '#ffffff', stroke: '#2b3134', strokeWidth: 1.6 }));
        g.add(_text({ x: bx + 10, y: by + 8, width: bw - 20, align: 'center', fontSize: 22, fill: '#1a4fa0', text: val.toFixed(2) }));
        g.add(_text({ x: bx + bw - 80, y: by + 15, width: 68, align: 'right', fontSize: 16, fill: '#3c4245', text: tg.unit || '' }));
    }

    /** 自定义视图页：参数表 + 仪表盘 */
    _renderCustom() {
        const g = this._pageGroup;
        if (!this._custom) this._initCustom();
        const px = CX + 4, py = Y_SHIP, pw = CW - 8, ph = H - py - 10;

        g.add(_rect({ x: px, y: py, width: pw, height: ph, fill: '#f4f5f6', stroke: '#5a6167', strokeWidth: 1.4, cornerRadius: 3 }));

        const pagePart = (id, x, y, w, h, onClick) => {
            const hit = new Konva.Rect({ x, y, width: w, height: h, fill: 'rgba(0,0,0,0)', listening: true, cursor: 'pointer' });
            hit.on('click tap', (e) => {
                e.cancelBubble = true;
                if (this.sys) { this.sys.lastClickedId = this.id; this.sys.lastClickedPartId = this.id + '/' + id; }
                onClick && onClick();
            });
            g.add(hit);
            if (!this._parts) this._parts = {};
            this._parts[id] = { x, y, w, h, node: hit };
            this._pagePartIds.push(id);
        };

        // ── ① 左侧按钮列 ──
        const tY = py + 6, bw = 126;
        const bx = px + 6;
        this._ovBtn(g, 'custom-remove', bx, tY + 6, bw, 26, 'Remove tag', () => {
            if (this._custom.sel >= 0 && this._custom.tags.length > 1) {
                this._custom.tags.splice(this._custom.sel, 1);
                this._custom.sel = -1;
                this._renderPage();
            }
        }, { fontSize: 13 });
        this._ovBtn(g, 'custom-up', bx, tY + 38, bw, 26, 'Move up', () => {
            const i = this._custom.sel;
            if (i > 0) { const t = this._custom.tags[i - 1]; this._custom.tags[i - 1] = this._custom.tags[i]; this._custom.tags[i] = t; this._custom.sel = i - 1; this._renderPage(); }
        }, { fontSize: 13 });
        this._ovBtn(g, 'custom-down', bx, tY + 70, bw, 26, 'Move down', () => {
            const i = this._custom.sel;
            if (i >= 0 && i < this._custom.tags.length - 1) { const t = this._custom.tags[i + 1]; this._custom.tags[i + 1] = this._custom.tags[i]; this._custom.tags[i] = t; this._custom.sel = i + 1; this._renderPage(); }
        }, { fontSize: 13 });
        this._ovBtn(g, 'custom-convert', bx, tY + 102, bw, 26, 'Convert ▾', () => this._tip('转换：模拟量/开关量显示切换'), { fontSize: 13 });

        // ── ② 参数表 ──
        const tx = px + 140, tw = pw - 146, rh = 26;
        const cols = [
            ['ID', 6], ['Tag', 58], ['Description', 118], ['Function', 398], ['Alarm state', 488],
            ['Value', 598], ['Eng unit', 693], ['LimitLL', 769], ['LimitL', 847], ['LimitH', 913],
            ['LimitHH', 979], ['Signal type', 1057], ['Alarm group', 1152],
        ];
        g.add(_rect({ x: tx, y: tY, width: tw, height: rh, fill: '#eceded', stroke: '#a8aeb2', strokeWidth: 1 }));
        cols.forEach(([t, dx]) => g.add(_text({ x: tx + dx + 4, y: tY + 6, fontSize: 12, fill: '#2b3134', text: t })));

        this._custom.tags.forEach((row, i) => {
            const tg = this.model.tag(row.tagId) || {};
            const ry = tY + rh * (i + 1);
            const al = this.model.alarmOf ? this.model.alarmOf(row.tagId) : null;
            const stText = al ? (al.state === 'ACK' ? 'ALARM (ACK)' : al.state === 'RTN' ? 'RETURNED' : 'ALARM') : 'NORMAL';
            g.add(_rect({ x: tx, y: ry, width: tw, height: rh, fill: '#ffffff', stroke: '#c6cacc', strokeWidth: 1 }));
            if (this._custom.sel === i) g.add(_rect({ x: tx, y: ry, width: tw, height: rh, fill: 'rgba(74,144,217,0.12)' }));
            pagePart('custom-row-' + i, tx + 2, ry + 1, tw - 4, rh - 2, () => { this._custom.sel = i; this._renderPage(); });
            const cell = (dx, text, color, fs) => g.add(_text({
                x: tx + dx + 4, y: ry + 5, fontSize: fs || 12, fill: color || '#1b1f21', text: text,
            }));
            cell(6, String(row.no));
            cell(58, String(row.tagNo));
            cell(118, tg.en || row.tagId);
            cell(398, tg.fn || 'PIAL');
            cell(488, stText, al ? C_RED : '#1a4fa0');
            cell(598, (tg.normal != null ? tg.normal : 0).toFixed(2), '#1a4fa0');
            cell(693, tg.unit || '');
            cell(847, tg.dir === 'low' ? String(tg.limit) : '');
            cell(913, tg.dir === 'high' ? String(tg.limit) : '');
            cell(1057, tg.digital ? 'DIGITAL' : 'ANALOGY');
            cell(1152, (ALARM_GROUPS[tg.group] || { name: tg.group || '—' }).name);
        });

        // ── ③ 仪表盘（每行一个面板）──
        const n = Math.max(1, this._custom.tags.length);
        const gap = 8, pwid = (pw - 12 - gap * (n - 1)) / n;
        const pY = tY + rh * 3 + 56, pH = Math.min(470, py + ph - pY - 10);
        this._custom.tags.forEach((row, i) => {
            const tg = this.model.tag(row.tagId) || {};
            const x = px + 6 + i * (pwid + gap);
            g.add(_rect({ x, y: pY, width: pwid, height: pH, fill: '#fbfcfc', stroke: '#8a8f92', strokeWidth: 1 }));
            g.add(_text({ x: x + 12, y: pY + 10, fontSize: 13.5, fontStyle: 'bold', fill: '#1b1f21', text: tg.en || row.tagId }));
            g.add(_text({ x: x + 12, y: pY + 34, fontSize: 12.5, fill: '#3c4245', text: String(row.tagNo) }));
            const cx = x + pwid * 0.36, gy = pY + pH * 0.60;
            this._drawGauge(g, cx, gy, Math.min(150, pwid * 0.26), row);
        });
    }

    // ── 表格视图 ──
    /**
     * 单个测点的列表行（标签一览 / 分组页共用）：
     * 与报警列表同一列结构，去掉 Status（✓/⏎）与时间两列；
     * Alarm state 列在参数发生报警时红色高亮，无报警时优先级块淡灰。
     */
    _tagRow(tg, idx) {
        const M = this.model;
        const al = M.alarmOf(tg.id);
        const kindTxt = tg.digital ? 'ALARM' : (tg.dir === 'high' ? 'HIGH' : 'LOW');
        // 被闭锁（Is Inhibit = Yes）的测点：Alarm state 显示「已闭锁」
        const stTxt = tg.inhibit ? '已闭锁'
            : (!al ? 'NORMAL'
                : (al.state === 'UNACK' ? kindTxt
                    : (al.state === 'RTN' ? `Returned(${kindTxt})` : 'ACK')));
        return {
            tagId: tg.id,
            mark: null,                       // 不显示 ✓ / ⏎
            prio: tg.prio,
            dimPrio: !al,                     // 无报警时优先级块淡灰
            blink: !!(al && al.state !== 'ACK'),
            cells: [
                { text: '' }, { text: '' },
                { text: String(idx + 1) },
                { text: tg.id },
                { text: tg.en || tg.name },
                { text: tg.fn || (tg.digital ? 'XA' : '') },
                { text: stTxt, color: tg.inhibit ? C_AMBER : (al ? C_RED : '#7a8084') },
                { text: tg.digital ? (tg.display >= 0.5 ? '1' : '0') : fmt(tg.display) },
                { text: tg.unit || '' },
                { text: tg.digital ? '' : limitText(tg) },
                { text: ALARM_GROUPS[tg.group].name },
            ],
        };
    }

    _tableSpec(kindOverride) {
        const M = this.model;
        const kind = kindOverride || this._overlay;
        const st = (tagId) => {
            const al = M.alarmOf(tagId);
            const tg = M.tag(tagId);
            if (tg && tg.inhibit) return { text: '已闭锁', color: C_AMBER };
            if (!al) return { text: '正常', color: '#1d7a1d' };
            if (al.state === 'UNACK') return { text: '未确认', color: C_RED };
            if (al.state === 'RTN') return { text: '已恢复正常（未确认）', color: C_AMBER };
            return { text: '已确认', color: '#a01010' };
        };

        if (kind === 'tags') {
            // 与报警列表同一列结构，去掉 Status（✓/⏎）与时间两列；
            // 「Alarm state」列在参数发生报警时文字红色高亮。
            return {
                title: '标签一览 (Tag summary)　—　点击任意一行可修改该测点的报警参数',
                statusCol: { markX: 124, prioX: 156, prioW: 32 },
                cols: [
                    ['Pri', 124, 64], ['', 188, 0],
                    ['ID', 226, 64], ['Tag', 294, 120],
                    ['Description', 420, 300], ['Function', 726, 80],
                    ['Alarm state', 812, 150], ['Value', 968, 108],
                    ['Eng unit', 1082, 66], ['Limit', 1154, 100], ['Alarm group', 1260, 200],
                ],
                rows: M.tags.map((tg, idx) => this._tagRow(tg, idx)),
            };
        }

        // ── 报警组页：点击左侧分组打开，列出该组全部监测点；有报警的按报警时间排在上方。
        //    显示格式与「标签一览」完全相同（Pri | ID | Tag | Description | Function |
        //    Alarm state | Value | Eng unit | Limit | Alarm group）。
        if (kind === 'group') {
            const gk = this._groupFilter;
            const grp = ALARM_GROUPS[gk] || { name: gk || '—', cn: '' };
            const list = M.tags.filter(tg => tg.group === gk);
            const withAlarm = list.filter(tg => M.alarmOf(tg.id))
                .sort((a, b) => M.alarmOf(b.id).seq - M.alarmOf(a.id).seq);   // 最新报警在上
            const normal = list.filter(tg => !M.alarmOf(tg.id));
            const ordered = [...withAlarm, ...normal];
            return {
                title: `报警组：${grp.name}${grp.cn ? '（' + grp.cn + '）' : ''}　—　该组全部监测点 ${list.length} 个，报警中的按时间排在上方`,
                statusCol: { markX: 124, prioX: 156, prioW: 32 },
                cols: [
                    ['Pri', 124, 64], ['', 188, 0],
                    ['ID', 226, 64], ['Tag', 294, 120],
                    ['Description', 420, 300], ['Function', 726, 80],
                    ['Alarm state', 812, 150], ['Value', 968, 108],
                    ['Eng unit', 1082, 66], ['Limit', 1154, 100], ['Alarm group', 1260, 200],
                ],
                rows: ordered.map((tg, idx) => this._tagRow(tg, idx)),
                empty: '该报警组在本仿真中未配置监测点（可在「标签参数设置」中修改测点的报警组）',
            };
        }

        if (kind === 'alarms') {
            // 最新报警排在最上（按报警序号倒序，与 K-Chief 一致）
            const list = (this._groupFilter
                ? M.alarms.filter(a => a.group === this._groupFilter)
                : M.alarms).slice().sort((a, b) => b.seq - a.seq);
            const blink = Math.floor(M.t * 2) % 2 === 0;   // 0.5 s 交替（页面 500 ms 重建一次）
            return {
                title: '当前报警 (Active alarms)' + (this._groupFilter ? `　—　${ALARM_GROUPS[this._groupFilter].name}` : '')
                    + '　—　点击一行可查看/修改该测点参数',
                // 前两列：状态标记（✓ 已确认 / ⏎ 已恢复未确认）与优先级块（A / B / C）
                statusCol: { markX: 124, prioX: 156, prioW: 32 },
                cols: [
                    ['Status', 124, 64], ['', 188, 0],
                    ['时间', 226, 172], ['ID', 402, 64], ['Tag', 470, 118],
                    ['Description', 592, 262], ['Function', 858, 76],
                    ['Alarm state', 938, 132],
                    ['Value', 1074, 96], ['Eng unit', 1174, 60],
                    ['设定值', 1238, 84], ['Alarm group', 1326, 170],
                ],
                rows: list.map(a => {
                    const tg = M.tag(a.tagId) || {};
                    const baseTxt = a.state === 'UNACK'
                        ? (tg.digital ? 'ALARM' : (a.dir === 'high' ? 'HIGH' : 'LOW'))
                        : (a.state === 'RTN'
                            ? `Returned(${tg.digital ? 'ALARM' : (a.dir === 'high' ? 'HIGH' : 'LOW')})`
                            : 'ACK');
                    // 被越控的报警（安保动作已 Cancel）在状态后加 OVR 标记
                    const stTxt = a.override ? `${baseTxt} · OVR` : baseTxt;
                    return {
                        tagId: a.tagId,
                        mark: a.state === 'ACK' ? 'check' : (a.state === 'RTN' ? 'return' : null),
                        prio: a.prio,
                        blink: a.state !== 'ACK',
                        bgColor: a.state === 'ACK' ? '#e8eaeb' : (a.state === 'RTN' ? (blink ? '#fdf3d8' : '#fffaf0') : '#ffffff'),
                        cells: [
                            { text: '' }, { text: '' },
                            { text: fullTime(a.ts) || a.t },
                            { text: String(a.seq || '') },
                            { text: a.tagId },
                            { text: a.en || a.name },
                            { text: a.fn || (tg.digital ? 'XA' : '') },
                            { text: stTxt, color: '#1a4fd0' },
                            { text: tg.digital ? (tg.display >= 0.5 ? '1' : '0') : fmt(tg.display) },
                            { text: tg.unit || '' },
                            { text: tg.digital ? '' : fmt(a.limit) },
                            { text: ALARM_GROUPS[a.group].name },
                        ],
                    };
                }),
                empty: '当前无活动报警：所有监测点均在正常范围内',
            };
        }

        if (kind === 'history') {
            return {
                title: '报警历史 (Alarm history)　—　✓＝确认后故障消失；⏎＝故障先恢复、之后才确认',
                statusCol: { markX: 124, prioX: 156, prioW: 32 },
                cols: [
                    ['Status', 124, 64], ['', 188, 0],
                    ['发生时间', 226, 172], ['ID', 402, 64], ['Tag', 470, 118],
                    ['Description', 592, 258], ['Function', 854, 76],
                    ['Alarm state', 934, 130],
                    ['Value', 1068, 92], ['Eng unit', 1164, 58],
                    ['消失时间', 1226, 130], ['Alarm group', 1360, 150],
                ],
                rows: M.history.map(h => {
                    const tg = M.tag(h.tagId) || {};
                    const kindTxt = tg.digital ? 'ALARM' : (h.dir === 'high' ? 'HIGH' : 'LOW');
                    const returned = h.state === 'RTN';
                    return {
                        tagId: h.tagId,
                        mark: returned ? 'return' : 'check',   // ⏎ 已恢复后确认 / ✓ 确认后消失
                        prio: h.prio,
                        blink: false,                           // 历史记录不闪烁
                        bgColor: returned ? '#fdf6e6' : '#eef1f2',
                        cells: [
                            { text: '' }, { text: '' },
                            { text: fullTime(h.ts) || h.t },
                            { text: String(h.seq || '') },
                            { text: h.tagId },
                            { text: h.en || h.name },
                            { text: h.fn || (tg.digital ? 'XA' : '') },
                            { text: returned ? `Returned(${kindTxt})` : 'ACK', color: '#1a4fd0' },
                            { text: tg.digital ? (tg.display >= 0.5 ? '1' : '0') : fmt(h.value) },
                            { text: tg.unit || '' },
                            { text: h.tClear || '—' },
                            { text: ALARM_GROUPS[h.group].name },
                        ],
                    };
                }),
                empty: '暂无报警历史记录',
            };
        }

        if (kind === 'inhibit') {
            const list = M.tags.filter(tg => tg.inhibit);
            return {
                title: '被闭锁标签 (Inhibit tags)　—　闭锁期间该测点不产生报警',
                cols: [['标签', 124, 132], ['监测点描述', 262, 320], ['设定值', 588, 130], ['实测值', 724, 130], ['闭锁状态', 860, 140]],
                rows: list.map(tg => ({
                    tagId: tg.id,
                    cells: [
                        { text: tg.id }, { text: tg.name },
                        { text: `${fmt(tg.limit)} ${tg.unit}` },
                        { text: `${fmt(tg.display)} ${tg.unit}` },
                        { text: '已闭锁', color: C_AMBER },
                    ],
                })),
                empty: '没有被闭锁的标签（可在「标签一览」的参数界面中闭锁）',
            };
        }

        if (kind === 'counters') {
            return {
                title: '计数器列表 (Counters list)',
                cols: [['报警组', 124, 200], ['未确认报警', 340, 160], ['活动报警', 516, 160], ['延伸报警', 692, 160]],
                rows: Object.keys(ALARM_GROUPS).map(gk => ({
                    cells: [
                        { text: ALARM_GROUPS[gk].name },
                        { text: String(M.groupUnack(gk)), color: M.groupUnack(gk) > 0 ? C_RED : C_TEXT },
                        { text: String(M.alarms.filter(a => a.group === gk).length) },
                        { text: ALARM_GROUPS[gk].extend ? '已延伸至值班面板' : '不延伸' },
                    ],
                })),
            };
        }

        if (kind === 'override') {
            // 越控 = AHH / ALL 报警引起的自动停车（SHD）/ 自动减速（SLD）在延时内被 Cancel 取消
            return {
                title: '被越控标签 (Overridden tags)　—　AHH/ALL 安保信号在延时内被 Cancel SHD / Cancel SLD 取消',
                cols: [
                    ['Tag', 124, 140], ['Description', 272, 300], ['Function', 580, 90],
                    ['安保动作', 678, 150], ['越控时间', 836, 130], ['说明', 974, 460],
                ],
                rows: M.overrides.map(o => ({
                    tagId: o.tagId,
                    cells: [
                        { text: o.tagId },
                        { text: o.name || (M.tag(o.tagId) || {}).name || '' },
                        { text: o.fn || '' },
                        { text: o.type === 'SHD' ? 'Shut Down（停车）' : 'Slow Down（减速）', color: C_AMBER },
                        { text: o.t || '' },
                        { text: '安保信号已越控，主机不停车/不减速；报警本身仍需确认', color: '#5a6167' },
                    ],
                })),
                empty: '没有被越控的标签：AHH / ALL 报警触发停车或减速，只有在延时到之前按 Operate→Cancel Shut Down / Cancel Slow Down 才会产生越控记录',
            };
        }

        // events / log
        return {
            title: kind === 'log' ? '日志查看 (Log viewer)' : '事件历史 (Event history)',
            cols: [['时间', 124, 100], ['事件记录', 236, 1200]],
            rows: M.events.map(ev => ({
                cells: [{ text: ev.t }, { text: ev.text }],
            })),
            empty: '暂无事件记录',
        };
    }

    _renderTable(kind) {
        const g = this._pageGroup;
        const spec = this._tableSpec(kind);
        // 整页占满原 Home 内容区（船图 + 表格视图 + 工艺流程图 + 趋势 + 自定义视图的位置）
        const px = CX + 4, py = Y_SHIP, pw = CW - 8, ph = H - py - 10;
        const dx = px - 110;          // 列坐标原以 px = 110 为基准，整页平移

        g.add(_rect({ x: px, y: py, width: pw, height: ph, fill: '#f4f5f6', stroke: '#5a6167', strokeWidth: 1.4, cornerRadius: 3 }));
        g.add(_rect({ x: px, y: py, width: pw, height: 32, fill: '#d6e2ea', stroke: '#5a6167', strokeWidth: 1 }));
        g.add(_text({ x: px + 14, y: py + 9, fontSize: 14, fontStyle: 'bold', fill: '#1e323f', text: spec.title }));

        // 表头
        const hy = py + 40;
        g.add(_rect({ x: px + 6, y: hy, width: pw - 12, height: 24, fill: '#e1e5e7', stroke: '#c0c6c9', strokeWidth: 1 }));
        spec.cols.forEach(([t, x, w]) => {
            g.add(_text({ x: x + dx, y: hy + 4, width: w, fontSize: 12, fontStyle: 'bold', fill: '#2b3134', text: t }));
        });

        // 数据行
        if (!spec.rows.length) {
            g.add(_text({ x: px + 20, y: hy + 60, width: pw - 40, align: 'center', fontSize: 14, fill: '#7a8084', text: spec.empty || '暂无记录' }));
        } else {
            const rows = spec.rows.slice(this._rowOffset, this._rowOffset + this._pageRows);
            const blinkPhase = Math.floor(this.model.t * 2) % 2 === 0;
            rows.forEach((row, i) => {
                const ry = hy + 26 + i * 28;
                const bgColor = row.bgColor || (row.high ? '#ffe6e6' : (i % 2 ? '#fbfcfc' : '#f0f2f3'));
                g.add(_rect({ x: px + 6, y: ry, width: pw - 12, height: 28, fill: bgColor, stroke: '#dfe3e5', strokeWidth: 0.6 }));

                // 状态标记 + 优先级块（K-Chief 样式）
                if (spec.statusCol) {
                    const sc = spec.statusCol;
                    if (row.mark === 'check') {
                        // 已确认：A 前面打勾（与 A 块等宽，字号加大）
                        g.add(_text({
                            x: sc.markX + dx, y: ry + 2, width: sc.prioW, align: 'center',
                            fontSize: 20, fontStyle: 'bold', fill: '#1d7a1d', text: '✓',
                        }));
                    } else if (row.mark === 'return') {
                        // 参数已恢复正常但未确认：A 前面加回车箭头（当前报警页闪烁，历史页常显）
                        g.add(_text({
                            x: sc.markX + dx, y: ry + 2, width: sc.prioW, align: 'center',
                            fontSize: 20, fontStyle: 'bold',
                            fill: row.blink ? (blinkPhase ? '#c00000' : '#e08a00') : '#b35c00', text: '⏎',
                        }));
                    }
                    // 优先级块：未确认时在亮红 / 深红之间闪烁；无报警时淡灰
                    const prioCol = PRIORITIES[row.prio] || PRIORITIES.B;
                    const fill = row.dimPrio ? '#e6e9ea'
                        : (row.blink ? (blinkPhase ? '#ff2b2b' : '#8f0d0d') : (row.prio === 'A' ? '#c8161d' : prioCol.color));
                    g.add(_rect({
                        x: sc.prioX + dx, y: ry + 4, width: sc.prioW, height: 20, fill,
                        stroke: row.dimPrio ? '#c6cccf' : '#7a0f0f', strokeWidth: 1,
                    }));
                    g.add(_text({
                        x: sc.prioX + dx, y: ry + 7, width: sc.prioW, align: 'center',
                        fontSize: 13, fontStyle: 'bold', fill: row.dimPrio ? '#9aa0a4' : '#ffffff', text: row.prio || '',
                    }));
                }

                row.cells.forEach((cell, ci) => {
                    if (!cell.text) return;
                    const [t, x, w] = spec.cols[ci] || ['', 124, 100];
                    g.add(_text({
                        x: x + dx, y: ry + 7, width: w, fontSize: 12,
                        fill: cell.color || C_TEXT, text: cell.text,
                    }));
                });
                // 行热区：打开该测点的参数设置对话框
                if (row.tagId) {
                    const hit = new Konva.Rect({ x: px + 6, y: ry, width: pw - 12, height: 28, fill: 'rgba(0,0,0,0)', listening: true, cursor: 'pointer' });
                    // 单击：仅选中该行；双击：打开报警参数界面。
                    // 注意：列表页每 500 ms 重建一次，节点会被替换，Konva 自带的 dblclick
                    // 无法跨节点识别双击，因此这里自行按"同一测点 450 ms 内两次点击"判定双击。
                    hit.on('click tap', (e) => {
                        e.cancelBubble = true;
                        if (this.sys) { this.sys.lastClickedId = this.id; this.sys.lastClickedPartId = `${this.id}/row-${i}`; }
                        const now = Date.now();
                        const last = this._lastRowClick;
                        if (last && last.tagId === row.tagId && now - last.t < 450) {
                            this._lastRowClick = null;
                            this.openParam(row.tagId);
                        } else {
                            this._lastRowClick = { tagId: row.tagId, t: now };
                        }
                    });
                    // 供自动演示：直接 fire('dblclick') 也能打开
                    hit.on('dblclick dbltap', (e) => {
                        e.cancelBubble = true;
                        if (this.sys) { this.sys.lastClickedId = this.id; this.sys.lastClickedPartId = `${this.id}/row-${i}`; }
                        this.openParam(row.tagId);
                    });
                    g.add(hit);
                    const pid = `row-${i}`;
                    if (!this._parts) this._parts = {};
                    this._parts[pid] = { x: px + 6, y: ry, w: pw - 12, h: 28, node: hit };
                    this._pagePartIds.push(pid);
                }
            });
        }

        // 底部提示（含当前显示的行范围，配合工具栏 ◀ ▶ 翻页）
        const total = spec.rows.length;
        const from = total ? this._rowOffset + 1 : 0;
        const to = Math.min(total, this._rowOffset + this._pageRows);
        g.add(_text({
            x: px + 14, y: py + ph - 26, fontSize: 11.5, fill: '#5a6167',
            text: `共 ${total} 条，当前显示第 ${from}–${to} 条（工具栏 ◀ ▶ 翻页）　|　提示：报警需按「确认 ACK」消除，已恢复正常但未确认的显示为黄色；点击任意一行可查看/修改该测点参数。`,
        }));
    }

    // ═══════════════════════════════════════════════════════
    //  发电机组概览（1#/2#/3#，默认 1# 运行、其余停机）
    // ═══════════════════════════════════════════════════════

    /** 打开第 n 号发电机组概览（n = 1..3） */
    _openGen(n) {
        this._genNo = n || 1;
        this._showPage('gen');
    }

    _renderGen() {
        const g = this._pageGroup;
        const M = this.model;
        const px = CX + 4, py = Y_SHIP, pw = CW - 8, ph = H - py - 10;
        const no = this._genNo || 1;

        g.add(_rect({ x: px, y: py, width: pw, height: ph, fill: '#eceeef', stroke: '#5a6167', strokeWidth: 1.4, cornerRadius: 3 }));
        const pg = new Konva.Group({ x: px, y: py });
        g.add(pg);

        const V = (id, dflt) => { const t = M.tag(id); return t && t.normal != null ? t.normal : dflt; };
        const AL = (id) => !!M.alarmOf(id);

        // ① 1# 运行、2#/3# 停机：停机机组各参数归零
        const run = no === 1;
        const k = (v) => (run ? v : 0);
        const rpm = k(V('DG' + no + '-RPM', 600));
        const loadPct = run ? 20 : 0;
        const power = run ? 228 : 0;

        // ══ 顶部两排仪表（4 + 4 只）══
        const cw = 340, gap = 8;
        const gx = (i) => 8 + i * (cw + gap);
        const rowY = [4, 128];
        const gauges = [
            { label: 'FO inlet press', v: k(V('DG' + no + '-FO-P', 0.35)), lo: 0, hi: 1.0, unit: 'MPa', dec: 2, labels: 3, color: '#c0704f' },
            { label: 'LO inlet press', v: k(V('DG' + no + '-LO-P', 0.40)), lo: 0, hi: 0.8, unit: 'MPa', dec: 2, labels: 5, color: '#d8c33a' },
            { label: 'HT water inlet press', v: k(0.35), lo: 0, hi: 0.6, unit: 'MPa', dec: 2, labels: 4, color: '#a678b8' },
            { label: 'LT water inlet press', v: k(0.25), lo: 0, hi: 0.6, unit: 'MPa', dec: 2, labels: 4, color: '#4fa8b8' },
            { label: 'FO inlet Temp', v: k(35.4), lo: 0, hi: 160, unit: '℃', dec: 1, labels: 5, color: '#c0704f' },
            { label: 'LO inlet Temp', v: k(66.0), lo: 0, hi: 100, unit: '℃', dec: 1, labels: 6, color: '#d8c33a' },
            { label: 'HT water inlet Temp', v: k(82.4), lo: 0, hi: 160, unit: '℃', dec: 1, labels: 5, color: '#a678b8' },
            { label: 'HT water outlet Temp', v: k(85.0), lo: 0, hi: 160, unit: '℃', dec: 1, labels: 5, color: '#a678b8' },
        ];
        gauges.forEach((gg, i) => {
            this._mimicGauge(pg, gx(i % 4), rowY[Math.floor(i / 4)], cw, 120, gg);
        });

        // ══ 左列：增压器 / 扫气 ══
        this._mimicBlock(pg, 8, 258, 212, 60, 'Turbo charger');
        [['Exh. gas outlet', k(312.4).toFixed(1), '℃'], ['TC rpm (×10)', k(2152).toFixed(0), 'rpm']].forEach(([lb, v, un], i) => {
            const ry = 278 + i * 18;
            pg.add(_text({ x: 14, y: ry, fontSize: 10, fill: '#1b1f21', text: lb }));
            pg.add(_rect({ x: 108, y: ry - 1, width: 72, height: 15, fill: '#ffffff', stroke: '#5a6167', strokeWidth: 1 }));
            pg.add(_text({ x: 110, y: ry + 1, width: 44, align: 'right', fontSize: 10.5, fontStyle: 'bold', fill: '#1a4fa0', text: v }));
            pg.add(_text({ x: 158, y: ry + 2, width: 20, fontSize: 8.5, fill: '#3c4245', text: un }));
        });
        this._mimicGauge(pg, 8, 324, 212, 104, { label: 'Charge air Temp', v: k(36.7), lo: 0, hi: 100, unit: '℃', dec: 1, labels: 6, color: '#7fb6d8' });
        this._mimicGauge(pg, 8, 434, 212, 104, { label: 'Charge air press', v: k(0.26), lo: 0, hi: 0.6, unit: 'MPa', dec: 2, labels: 4, color: '#4fa8b8' });

        // ══ 中部：柴油机（4 缸）+ 联轴器 + 发电机 ══
        const eX = 232, eY = 300, eW = 726, eH = 268;
        pg.add(_rect({ x: eX, y: eY, width: eW, height: eH, fill: '#e3e6e8', stroke: '#5a6167', strokeWidth: 1.2, cornerRadius: 4 }));
        // 机组标题 + 状态
        pg.add(_text({ x: eX, y: 256, width: eW, align: 'center', fontSize: 17, fontStyle: 'bold', fill: '#1b1f21', text: 'Generator Engine No.' + no }));
        pg.add(_text({ x: eX + 120, y: 278, width: 130, align: 'center', fontSize: 15, fontStyle: 'bold', fill: run ? '#9aa0a4' : '#1b1f21', text: 'REMOTE' }));
        pg.add(_text({ x: eX + 250, y: 278, width: 130, align: 'center', fontSize: 15, fontStyle: 'bold', fill: run ? '#e01b1b' : '#9aa0a4', text: 'LOCAL' }));
        pg.add(_text({ x: eX + 380, y: 278, width: 170, align: 'center', fontSize: 15, fontStyle: 'bold', fill: run ? '#1a8a1a' : '#9aa0a4', text: run ? 'RUNNING' : 'STOPPED' }));

        // 气缸表（No.1~No.4 + Mean）
        const cylN = 4, headY = eY + 6, headH = 26, colW = (eW - 120) / (cylN + 1);
        const exhArr = [];
        for (let i = 0; i < cylN; i++) exhArr.push(k(V('DG' + no + '-EXH-T', 400) - (i - 1.5) * 1.4));
        const exhAvg = exhArr.reduce((a, b) => a + b, 0) / exhArr.length;
        pg.add(_text({ x: eX + 6, y: headY + 42, width: 112, align: 'right', fontSize: 10.5, fill: '#1b1f21', text: 'Exh.gas outlet' }));
        pg.add(_text({ x: eX + 6, y: headY + 66, width: 112, align: 'right', fontSize: 10.5, fill: '#1b1f21', text: 'Exh.gas deviation' }));
        for (let i = 0; i <= cylN; i++) {
            const cx = eX + 120 + i * colW;
            const isMean = i === cylN;
            pg.add(_rect({ x: cx + 4, y: headY, width: colW - 8, height: headH, fill: isMean ? '#c9ced1' : '#e9ebec', stroke: '#5a6167', strokeWidth: 1, cornerRadius: [8, 8, 0, 0] }));
            pg.add(_text({ x: cx + 4, y: headY + 5, width: colW - 8, align: 'center', fontSize: 12, fontStyle: 'bold', fill: '#1b1f21', text: isMean ? 'Mean' : String(i + 1) }));
            const v1 = isMean ? exhAvg : exhArr[i];
            const v2 = isMean ? 0 : exhArr[i] - exhAvg;
            [v1, v2].forEach((v, ri) => {
                const ry = headY + 34 + ri * 24;
                pg.add(_rect({ x: cx + 8, y: ry, width: colW - 16, height: 19, fill: '#ffffff', stroke: '#5a6167', strokeWidth: 1 }));
                pg.add(_text({ x: cx + 10, y: ry + 2, width: colW - 32, align: 'right', fontSize: 11.5, fontStyle: 'bold', fill: '#1a4fa0', text: (ri === 0 ? v.toFixed(1) : v.toFixed(1)) }));
                pg.add(_text({ x: cx + colW - 26, y: ry + 4, width: 16, fontSize: 8.5, fill: '#3c4245', text: '℃' }));
            });
        }

        // 下方四块：起动空气 / 燃油 / 跳闸条件 / 转速
        const bY = 392, bH = 128;
        this._mimicGauge(pg, eX + 8, bY, 158, bH, { label: 'Starting air inlet', v: k(2.68), lo: 0, hi: 4, unit: 'MPa', dec: 2, labels: 5, color: '#7fb6d8' });
        // 燃油
        this._mimicBlock(pg, eX + 174, bY, 168, bH, 'Fuel Oil');
        pg.add(_text({ x: eX + 182, y: bY + 30, width: 152, align: 'center', fontSize: 15, fontStyle: 'bold', fill: run ? '#e08a00' : '#a8aeb2', text: 'MGO use' }));
        pg.add(_text({ x: eX + 182, y: bY + 66, fontSize: 10.5, fill: '#1b1f21', text: 'Viscosity' }));
        pg.add(_rect({ x: eX + 246, y: bY + 63, width: 52, height: 16, fill: '#ffffff', stroke: '#5a6167', strokeWidth: 1 }));
        pg.add(_text({ x: eX + 248, y: bY + 65, width: 32, align: 'right', fontSize: 10.5, fontStyle: 'bold', fill: '#1a4fa0', text: k(7.7).toFixed(1) }));
        pg.add(_text({ x: eX + 282, y: bY + 66, width: 20, fontSize: 8.5, fill: '#3c4245', text: 'cSt' }));
        pg.add(new Konva.Circle({ x: eX + 186, y: bY + 98, radius: 5, stroke: '#3c4245', strokeWidth: 1.2, fill: '#ffffff', listening: false }));
        pg.add(_text({ x: eX + 196, y: bY + 92, fontSize: 10, fill: '#1b1f21', text: 'FO pipe leakage' }));
        // 跳闸条件
        this._mimicBlock(pg, eX + 348, bY, 176, bH, 'Trip Condition');
        [['LO in press low', AL('DG' + no + '-LO-SW')], ['HTW out temp high', AL('DG' + no + '-CW-T')],
         ['Overspeed', false], ["Em'cy stop", false], ['Start failure', false]].forEach(([txt, on], i) => {
            const ry = bY + 24 + i * 19;
            pg.add(new Konva.Circle({ x: eX + 360, y: ry + 5, radius: 5, stroke: '#3c4245', strokeWidth: 1.2, fill: on ? C_RED : '#ffffff', listening: false }));
            pg.add(_text({ x: eX + 370, y: ry, fontSize: 10, fill: on ? C_RED : '#1b1f21', text: txt }));
        });
        // 转速表
        this._mimicGauge(pg, eX + 534, bY, 184, bH, { label: 'Engine RPM', v: rpm, lo: 0, hi: 1200, unit: 'rpm', dec: 1, labels: 5, color: run ? '#2fbf4f' : '#b9bfc2' });

        // 底栏：滤器压差 / 预供滑油泵 / 循环柜
        const fY = eY + eH - 34;
        pg.add(_line({ points: [eX + 6, fY - 4, eX + eW - 6, fY - 4], stroke: '#a8aeb2', strokeWidth: 1 }));
        const lamp = (x, y, on, color) => {
            pg.add(new Konva.Circle({ x, y, radius: 5, stroke: '#3c4245', strokeWidth: 1.2, fill: on ? (color || C_RED) : '#ffffff', listening: false }));
        };
        pg.add(_text({ x: eX + 12, y: fY + 8, fontSize: 10.5, fill: '#1b1f21', text: 'LO filter diff press' }));
        lamp(eX + 20, fY + 30, false);
        pg.add(_text({ x: eX + 30, y: fY + 24, fontSize: 10, fill: '#1b1f21', text: 'PDAH' }));
        pg.add(_text({ x: eX + 250, y: fY + 8, fontSize: 10.5, fill: '#1b1f21', text: 'Pre L.O pump' }));
        lamp(eX + 250, fY + 30, run, '#1a8a1a');
        pg.add(_text({ x: eX + 260, y: fY + 24, fontSize: 10, fill: '#1b1f21', text: 'RUN' }));
        lamp(eX + 316, fY + 30, false);
        pg.add(_text({ x: eX + 326, y: fY + 24, fontSize: 10, fill: '#1b1f21', text: 'FAIL' }));
        pg.add(_text({ x: eX + 440, y: fY + 8, fontSize: 10.5, fill: '#1b1f21', text: 'L.O sump tank' }));
        lamp(eX + 452, fY + 30, false);
        pg.add(_text({ x: eX + 462, y: fY + 24, fontSize: 10, fill: '#1b1f21', text: 'LAH' }));
        lamp(eX + 518, fY + 30, false);
        pg.add(_text({ x: eX + 528, y: fY + 24, fontSize: 10, fill: '#1b1f21', text: 'LAL' }));

        // 联轴器 + 发电机
        const genX = 1000, genY = 356, genW = 186, genH = 148;
        const shY = 434;
        pg.add(_rect({ x: eX + eW, y: shY - 16, width: 20, height: 32, fill: '#b9bfc2', stroke: '#5a6167', strokeWidth: 1 }));
        pg.add(_rect({ x: eX + eW + 20, y: shY - 7, width: genX - eX - eW - 20, height: 14, fill: '#9aa0a4', stroke: '#5a6167', strokeWidth: 1 }));
        pg.add(_rect({ x: genX - 8, y: shY - 18, width: 14, height: 36, fill: '#b9bfc2', stroke: '#5a6167', strokeWidth: 1 }));
        pg.add(_rect({ x: genX, y: genY, width: genW, height: genH, fill: '#e3e6e8', stroke: '#5a6167', strokeWidth: 1.2, cornerRadius: 4 }));
        pg.add(_text({ x: genX, y: genY + 12, width: genW, align: 'center', fontSize: 15, fontStyle: 'bold', fill: '#1b1f21', text: 'Generator' }));
        pg.add(_text({ x: genX, y: genY + 38, width: genW, align: 'center', fontSize: 10.5, fill: '#2b3134', text: 'Winding temp' }));
        [['R:', 49.9], ['S:', 49.8], ['T:', 49.9]].forEach(([lb, v], i) => {
            const ry = genY + 58 + i * 24;
            pg.add(_text({ x: genX + 22, y: ry + 2, fontSize: 10.5, fill: '#1b1f21', text: lb }));
            pg.add(_rect({ x: genX + 48, y: ry, width: 62, height: 18, fill: '#ffffff', stroke: '#5a6167', strokeWidth: 1 }));
            pg.add(_text({ x: genX + 50, y: ry + 2, width: 42, align: 'right', fontSize: 11, fontStyle: 'bold', fill: '#1a4fa0', text: k(v).toFixed(1) }));
            pg.add(_text({ x: genX + 94, y: ry + 4, width: 14, fontSize: 8.5, fill: '#3c4245', text: '℃' }));
        });

        // ══ 右列：报警概览 + 负荷 ══
        const rX = 1196, rW = pw - rX - 8;
        this._mimicBlock(pg, rX, 258, rW, 122, 'Alarm overview');
        [['Control air press low', AL('ME-AIR-CTRL')], ['Electric power fail', AL('PW-BLACKOUT')],
         ['Control/Safe CPU fail', false], ['High press pipe leak', false], ['Governor ctrl power fail', false]].forEach(([txt, on], i) => {
            const ry = 280 + i * 19;
            pg.add(new Konva.Circle({ x: rX + 12, y: ry + 5, radius: 5, stroke: '#3c4245', strokeWidth: 1.2, fill: on ? C_RED : '#ffffff', listening: false }));
            pg.add(_text({ x: rX + 22, y: ry, fontSize: 9.5, fill: on ? C_RED : '#1b1f21', text: txt }));
        });

        // 负荷 / 电气参数
        const ldY = 386, ldH = 152;
        this._mimicBlock(pg, rX, ldY, rW, ldH, 'Load');
        // 负荷柱
        pg.add(_rect({ x: rX + 12, y: ldY + 20, width: 10, height: 74, fill: '#e3e7e9', stroke: '#5a6167', strokeWidth: 1 }));
        const barH = Math.min(1, loadPct / 100) * 74;
        pg.add(_rect({ x: rX + 13, y: ldY + 20 + (74 - barH), width: 8, height: barH, fill: '#1c6fb2' }));
        const ldRows = [
            ['Load', loadPct.toFixed(0), '%'],
            ['Power', power.toFixed(0), 'kW'],
            ['cosφ', run ? '0.86' : '—', ''],
            ['Freq', run ? '50.00' : '0.00', 'Hz'],
            ['Volt', run ? '450' : '0', 'V'],
            ['Curr', run ? '340' : '0', 'A'],
            ['Reac', run ? '132' : '0', 'kVAr'],
        ];
        ldRows.forEach(([lb, v, un], i) => {
            const ry = ldY + 18 + i * 19;
            pg.add(_text({ x: rX + 30, y: ry, width: 46, fontSize: 10, fill: '#1b1f21', text: lb }));
            pg.add(_rect({ x: rX + 80, y: ry - 1, width: 66, height: 16, fill: '#ffffff', stroke: '#5a6167', strokeWidth: 1 }));
            pg.add(_text({ x: rX + 82, y: ry + 1, width: 40, align: 'right', fontSize: 10.5, fontStyle: 'bold', fill: '#1a4fa0', text: v }));
            pg.add(_text({ x: rX + 128, y: ry + 2, width: 26, fontSize: 8.5, fill: '#3c4245', text: un }));
        });
    }

    // ── 主机概览（Main engine overview）：4 缸 + 两排 10 只仪表 ──
    _renderMimic() {
        const g = this._pageGroup;
        const M = this.model;
        const px = CX + 4, py = Y_SHIP, pw = CW - 8, ph = H - py - 10;

        g.add(_rect({ x: px, y: py, width: pw, height: ph, fill: '#eceeef', stroke: '#5a6167', strokeWidth: 1.4, cornerRadius: 3 }));
        const pg = new Konva.Group({ x: px, y: py });
        g.add(pg);

        // ── 取值辅助 ──
        const V = (id, dflt) => { const t = M.tag(id); return t && t.normal != null ? t.normal : dflt; };
        const AL = (id) => !!M.alarmOf(id);
        const DIG = (id) => { const t = M.tag(id); return !!(t && t.value >= 0.5); };
        const load0 = Math.max(0, Math.min(1, V('ME-GEN-LOAD', 78) / 100));
        const rpmVal = V('ME-GEN-RPM', 68);

        // ══ ① 两排仪表（每排 5 只，共 10 只典型参数）══
        const gauges = [
            { label: 'F.O in press', v: V('ME-FO-P', 0.42), lo: 0, hi: 0.8, unit: 'MPa', dec: 2, labels: 5, color: '#c0704f' },
            { label: 'L.O in press', v: V('ME-LO-P', 0.36), lo: 0, hi: 0.6, unit: 'MPa', dec: 2, labels: 4, color: '#d8c33a' },
            { label: 'Jacket CFW in press', v: V('ME-CW-P', 0.38), lo: 0, hi: 0.6, unit: 'MPa', dec: 2, labels: 4, color: '#4fa8b8' },
            { label: 'SCAV. air press', v: 0.18 + load0 * 0.07, lo: 0, hi: 0.4, unit: 'MPa', dec: 2, labels: 5, color: '#4a86b8' },
            { label: 'Starting air press', v: V('ME-GEN-SAIR', 2.4), lo: 0, hi: 3.5, unit: 'MPa', dec: 2, labels: 8, color: '#4a86b8' },
            { label: 'F.O in temp', v: V('ME-FO-T', 125), lo: 0, hi: 160, unit: '℃', dec: 1, labels: 5, color: '#c0704f' },
            { label: 'L.O in temp', v: V('ME-LO-T', 45), lo: 0, hi: 100, unit: '℃', dec: 1, labels: 6, color: '#d8c33a' },
            { label: 'Jacket CFW out temp', v: V('ME-CW-T', 78), lo: 0, hi: 120, unit: '℃', dec: 1, labels: 7, color: '#4fa8b8' },
            { label: 'SCAV. air temp', v: 38 + load0 * 8, lo: 0, hi: 100, unit: '℃', dec: 1, labels: 6, color: '#4fa8b8' },
            { label: 'Control air inlet press', v: V('ME-AIR-CTRL', 0.7), lo: 0, hi: 1.0, unit: 'MPa', dec: 2, labels: 6, color: '#4a86b8' },
        ];
        const cw = (pw - 48) / 5, chh = 118;
        gauges.forEach((gg, i) => {
            const col = i % 5, row = Math.floor(i / 5);
            const x = 8 + col * (cw + 8), y = 6 + row * (chh + 6);
            this._mimicGauge(pg, x, y, cw, chh, gg);
        });

        // ══ ② 气缸参数表（4 缸）══
        const tX = 8, tY = 254, tW = 972, labW = 172, colW = (tW - labW) / 4, rowH = 32, headH = 26;
        const cyls = [1, 2, 3, 4];
        const exhBase = V('ME-EXH-T1', 380);
        const rows = [
            ['Exh.gas outlet temp', cyls.map((n) => exhBase - (n - 1) * 1.3), '℃'],
            ['Exh.gas deviation temp', null, '℃'],
            ['Cyl. cover CFW outlet temp', cyls.map((n) => V('ME-CW-T', 85) - (n - 1) * 0.3), '℃'],
            ['Scav.air temp', cyls.map(() => 38 + load0 * 8), '℃'],
            ['PCO outlet temp', cyls.map((n) => 51.5 - (n - 1) * 0.45), '℃'],
            ['PCO non-flow', 'NFA', ''],
        ];
        const exhArr = rows[0][1];
        const exhAvg = exhArr.reduce((a, b) => a + b, 0) / exhArr.length;
        rows[1][1] = exhArr.map(v => v - exhAvg);

        pg.add(_rect({ x: tX, y: tY, width: tW, height: headH + rows.length * rowH + 4, fill: '#dfe2e4', stroke: '#7a8286', strokeWidth: 1.2 }));
        // 缸号表头
        cyls.forEach((n, i) => {
            const x = tX + labW + i * colW + 22;
            pg.add(_rect({ x, y: tY + 2, width: colW - 44, height: headH - 4, fill: '#c9ced1', stroke: '#5a6167', strokeWidth: 1, cornerRadius: [6, 6, 0, 0] }));
            pg.add(_text({ x, y: tY + 6, width: colW - 44, align: 'center', fontSize: 12.5, fontStyle: 'bold', fill: '#1b1f21', text: 'No.' + n }));
        });
        rows.forEach(([label, vals, unit], ri) => {
            const ry = tY + headH + ri * rowH;
            pg.add(_text({ x: tX + 2, y: ry + 9, width: labW - 8, align: 'right', fontSize: 11, fill: '#1b1f21', text: label }));
            cyls.forEach((n, ci) => {
                const cx = tX + labW + ci * colW;
                if (ri === rows.length - 1) {
                    // PCO non-flow：指示灯 + NFA
                    pg.add(new Konva.Circle({ x: cx + 26, y: ry + 16, radius: 6, stroke: '#3c4245', strokeWidth: 1.4, fill: '#ffffff', listening: false }));
                    pg.add(_text({ x: cx + 38, y: ry + 9, fontSize: 12, fill: '#1b1f21', text: 'NFA' }));
                } else {
                    const v = vals[ci];
                    pg.add(_rect({ x: cx + 20, y: ry + 4, width: colW - 40, height: rowH - 10, fill: '#ffffff', stroke: '#5a6167', strokeWidth: 1 }));
                    pg.add(_text({ x: cx + 22, y: ry + 7, width: colW - 44, align: 'center', fontSize: 12, fontStyle: 'bold', fill: '#1a4fa0', text: vi(v) + ' ' + unit }));
                }
            });
        });

        // ══ ③ 右侧：TC system / LO system / FO system ══
        const rX = 986, rW = pw - rX - 8;
        // TC system
        const tcY = 254, tcH = 106;
        this._mimicBlock(pg, rX, tcY, rW, tcH, 'TC system');
        pg.add(_text({ x: rX + 198, y: tcY + 17, width: 60, align: 'center', fontSize: 11.5, fontStyle: 'bold', fill: '#1b1f21', text: 'No.1' }));
        pg.add(_text({ x: rX + 324, y: tcY + 17, width: 60, align: 'center', fontSize: 11.5, fontStyle: 'bold', fill: '#1b1f21', text: 'No.2' }));
        const tcRows = [
            ['Rpm', V('ME-EXH-TC-N', 11800), 'rpm', 0],
            ['Exh.gas in', V('ME-EXH-TC-T', 435), '℃', 1],
            ['Exh.gas out', 261.6, '℃', 0],
            ['TC LO out', V('ME-LO-T', 57.7), '℃', 0],
        ];
        tcRows.forEach(([lb, v, un, dy], i) => {
            const ry = tcY + 32 + i * 18;
            pg.add(_text({ x: rX + 10, y: ry, width: 100, fontSize: 11, fill: '#1b1f21', text: lb }));
            [0, 1].forEach((k) => {
                const bx = rX + 178 + k * 126;
                pg.add(_rect({ x: bx, y: ry - 2, width: 78, height: 15, fill: '#ffffff', stroke: '#5a6167', strokeWidth: 1 }));
                pg.add(_text({ x: bx + 2, y: ry, width: 48, align: 'right', fontSize: 10.5, fontStyle: 'bold', fill: '#1a4fa0', text: vi(v - k * (dy ? 0 : 0.8)) }));
                pg.add(_text({ x: bx + 54, y: ry + 1, width: 22, fontSize: 9, fill: '#3c4245', text: un }));
            });
        });

        // LO system
        const loY = 366, loH = 88;
        this._mimicBlock(pg, rX, loY, rW, loH, 'LO system');
        const loLamps = [
            ['MAIN LO SUMP TK LEVEL LOW', AL('ME-LO-TK')],
            ['CYL OIL ALARM CHAMBER LOW', AL('ME-LO-CYL')],
            ['M/E HYD OIL LINE TEMP HIGH', false],
        ];
        loLamps.forEach(([txt, on], i) => {
            const ry = loY + 22 + i * 20;
            pg.add(new Konva.Circle({ x: rX + 16, y: ry + 6, radius: 6, stroke: '#3c4245', strokeWidth: 1.4, fill: on ? C_RED : '#ffffff', listening: false }));
            pg.add(_text({ x: rX + 28, y: ry, fontSize: 11, fill: on ? C_RED : '#1b1f21', text: txt }));
        });

        // FO system
        const foY = 460, foH = 78;
        this._mimicBlock(pg, rX, foY, rW, foH, 'FO system');
        pg.add(_text({ x: rX + 10, y: foY + 22, width: 150, fontSize: 11, fill: '#1b1f21', text: 'M/E FO IN VISCOSITY' }));
        pg.add(_rect({ x: rX + 170, y: foY + 18, width: 70, height: 16, fill: '#ffffff', stroke: '#5a6167', strokeWidth: 1 }));
        pg.add(_text({ x: rX + 172, y: foY + 20, width: 50, align: 'right', fontSize: 11, fontStyle: 'bold', fill: '#1a4fa0', text: vi(V('ME-FO-VISC', 14)) }));
        pg.add(_text({ x: rX + 224, y: foY + 20, width: 24, fontSize: 9, fill: '#3c4245', text: 'cSt' }));
        [['HFO AUTO BACKWASH DIFF PRESS HIGH', AL('ME-FO-FILT')], ['M/E FO LEAK FROM H PRESS PIPE', DIG('ME-FO-LEAK')]].forEach(([txt, on], i) => {
            const ry = foY + 42 + i * 18;
            pg.add(new Konva.Circle({ x: rX + 16, y: ry + 6, radius: 6, stroke: '#3c4245', strokeWidth: 1.4, fill: on ? C_RED : '#ffffff', listening: false }));
            pg.add(_text({ x: rX + 28, y: ry, fontSize: 10.5, fill: on ? C_RED : '#1b1f21', text: txt }));
        });

        // ══ ④ 轴承温度 ══
        const bY = 486, bH = 50;
        this._mimicBearing(pg, 8, bY, 240, bH, 'Thrust bearing temp', 51.2);
        this._mimicBearing(pg, 330, bY, 240, bH, 'Inter shaft bearing temp', 53.4);
        this._mimicBearing(pg, 576, bY, 200, bH, 'Stern tube bearing temp', 37.1, 38.2);

        // ══ ⑤ ME safety & control system ══
        const sY = 548, sH = 146, sW = 960;
        pg.add(_rect({ x: 8, y: sY, width: sW, height: sH, fill: '#dfe2e4', stroke: '#7a8286', strokeWidth: 1.2 }));
        pg.add(_rect({ x: 8, y: sY, width: 190, height: 24, fill: '#c9ced1', stroke: '#5a6167', strokeWidth: 1 }));
        pg.add(_text({ x: 14, y: sY + 5, fontSize: 12.5, fontStyle: 'bold', fill: '#1b1f21', text: 'ME safety & control system' }));
        const cols = [
            ['LOCAL', ['Shutdown active', 'Shutdown cancelled', 'Slowdown active', 'Slowdown cancelled', 'Overspeed']],
            ['E.C.R.', ["Em'cy stop", 'Engine blocked', 'Engine not ready', 'Start failed', 'Aux blower failure']],
            ['BRIDGE', ['Wrong way', 'Critical rpm', 'Rpm detector fail', 'Rpm detector loop fail', 'Load program cancelled']],
            ['At Sea', ['Remote ctrl system fail', 'Remote ctrl system abn.', 'Safe system fail', 'Safe system abn.', 'Main elec. power fail']],
            ['Stand by', ['Telegraph system abn.', 'Telegraph source fail', 'Crank case oil mist high', 'Starting air low press']],
        ];
        cols.forEach(([head, items], ci) => {
            const cx = 8 + ci * (sW / 5);
            pg.add(_text({ x: cx + 6, y: sY + 28, fontSize: 11, fontStyle: 'bold', fill: ci === 2 ? '#1a7a1a' : (ci === 3 ? '#1a7a1a' : '#2b3134'), text: head }));
            items.forEach((it, ii) => {
                const ry = sY + 46 + ii * 19;
                pg.add(new Konva.Circle({ x: cx + 14, y: ry + 5, radius: 5, stroke: '#3c4245', strokeWidth: 1.2, fill: '#ffffff', listening: false }));
                pg.add(_text({ x: cx + 24, y: ry, fontSize: 10, fill: '#1b1f21', text: it }));
            });
        });

        // ══ ⑥ 主机运行状态 + 主轴 / 螺旋桨示意 ══
        const rx0 = 976, ry0 = 546;
        // 第一行：负荷 / 转速 / 燃油指数
        const kv = (lb, v, un, x, off) => {
            const o = off || 40;
            pg.add(_text({ x, y: ry0, fontSize: 11.5, fill: '#1b1f21', text: lb }));
            pg.add(_rect({ x: x + o, y: ry0 - 2, width: 62, height: 17, fill: '#ffffff', stroke: '#5a6167', strokeWidth: 1 }));
            pg.add(_text({ x: x + o + 2, y: ry0 - 1, width: 42, align: 'right', fontSize: 11.5, fontStyle: 'bold', fill: '#1a4fa0', text: v }));
            pg.add(_text({ x: x + o + 64, y: ry0 + 1, width: 26, fontSize: 9.5, fill: '#3c4245', text: un }));
        };
        kv('Load', (load0 * 100).toFixed(1), '%', rx0, 40);
        kv('Rpm', rpmVal.toFixed(1), 'rpm', rx0 + 124, 40);
        kv('Fuel index', (load0 * 108).toFixed(2), '%', rx0 + 259, 66);

        // 主机方框
        const engX = rx0 + 6, engY = 594, engW = 88, engH = 70;
        pg.add(_rect({ x: engX, y: engY, width: engW, height: engH, fill: '#c9ced1', stroke: '#5a6167', strokeWidth: 1.2, cornerRadius: 3 }));
        pg.add(_text({ x: engX, y: engY + 13, width: engW, align: 'center', fontSize: 18, fontStyle: 'bold', fill: '#1b1f21', text: 'ME' }));
        pg.add(_text({ x: engX, y: engY + 40, width: engW, align: 'center', fontSize: 15, fontStyle: 'bold', fill: '#1a8a1a', text: 'RUN' }));

        // 主轴（中间轴）+ 联轴器法兰 + 中间轴承
        const shY = engY + engH / 2;                 // 轴中心线 y
        const shX0 = engX + engW, shX1 = 1302;
        pg.add(_rect({ x: shX0, y: shY - 6, width: shX1 - shX0, height: 12, fill: '#9aa0a4', stroke: '#5a6167', strokeWidth: 1 }));
        pg.add(_rect({ x: shX0, y: shY - 14, width: 11, height: 28, fill: '#b9bfc2', stroke: '#5a6167', strokeWidth: 1 }));
        pg.add(_rect({ x: 1148, y: shY + 6, width: 26, height: 9, fill: '#c9ced1', stroke: '#5a6167', strokeWidth: 1 }));
        pg.add(_text({ x: 1136, y: shY + 17, width: 50, align: 'center', fontSize: 8.5, fill: '#3c4245', text: '中间轴承' }));

        // 螺旋桨（4 叶）
        const propX = shX1 + 22;
        for (let i = 0; i < 4; i++) {
            pg.add(new Konva.Ellipse({
                x: propX, y: shY, radiusX: 8, radiusY: 26, rotation: i * 45 + 15,
                fill: '#b9bfc2', stroke: '#5a6167', strokeWidth: 1, listening: false,
            }));
        }
        pg.add(new Konva.Circle({ x: propX, y: shY, radius: 8, fill: '#8b9295', stroke: '#5a6167', strokeWidth: 1, listening: false }));
        pg.add(_text({ x: propX - 34, y: shY + 34, width: 68, align: 'center', fontSize: 9.5, fill: '#1b1f21', text: '螺旋桨' }));

        // 参数标注：文字框 + 引线指向对应部件
        const callout = (cx0, cy0, label, value, unit, lx, ly, below) => {
            const w = 148;
            if (!below) {
                // 标签在框上方，引线从框下端连到部件
                pg.add(_text({ x: cx0 - w / 2, y: cy0, width: w, align: 'center', fontSize: 10, fill: '#2b3134', text: label }));
                pg.add(_rect({ x: cx0 - 44, y: cy0 + 15, width: 88, height: 16, fill: '#ffffff', stroke: '#5a6167', strokeWidth: 1 }));
                pg.add(_text({ x: cx0 - 42, y: cy0 + 17, width: 60, align: 'right', fontSize: 11, fontStyle: 'bold', fill: '#1a4fa0', text: value }));
                pg.add(_text({ x: cx0 + 20, y: cy0 + 19, width: 24, fontSize: 8.5, fill: '#3c4245', text: unit }));
                pg.add(_line({ points: [cx0, cy0 + 31, lx, ly], stroke: '#5a6167', strokeWidth: 0.9 }));
            } else {
                // 标签在框下方，引线只从框上端连到部件（不穿过显示框）
                pg.add(_rect({ x: cx0 - 44, y: cy0, width: 88, height: 16, fill: '#ffffff', stroke: '#5a6167', strokeWidth: 1 }));
                pg.add(_text({ x: cx0 - 42, y: cy0 + 2, width: 60, align: 'right', fontSize: 11, fontStyle: 'bold', fill: '#1a4fa0', text: value }));
                pg.add(_text({ x: cx0 + 20, y: cy0 + 4, width: 24, fontSize: 8.5, fill: '#3c4245', text: unit }));
                pg.add(_text({ x: cx0 - w / 2, y: cy0 + 18, width: w, align: 'center', fontSize: 10, fill: '#2b3134', text: label }));
                pg.add(_line({ points: [cx0, cy0 - 1, lx, ly], stroke: '#5a6167', strokeWidth: 0.9 }));
            }
            pg.add(new Konva.Circle({ x: lx, y: ly, radius: 2.2, fill: '#5a6167', listening: false }));
        };
        // 轴功率 → 指向主轴中段上方
        callout(1120, 566, '轴功率 Shaft power', String(Math.round(load0 * 27000)), 'kW', 1120, shY - 6);
        // 扭矩 → 指向主轴中段下方
        callout(1240, 646, '扭矩 Torque', String(Math.round(rpmVal > 1 ? load0 * 27000 * 9.549 / rpmVal : 0)), 'kNm', 1240, shY + 6, true);
        // 转速 → 指向螺旋桨
        callout(1332, 570, '转速 Rpm', rpmVal.toFixed(1), 'rpm', propX + 8, shY - 12);

        // 数值格式化
        function vi(v) {
            if (typeof v === 'string') return v;
            const a = Math.abs(v);
            return a >= 100 ? v.toFixed(0) : (a >= 10 ? v.toFixed(1) : v.toFixed(2));
        }
    }

    /** 主机概览：单只半圆仪表（刻度带 + 刻度 + 数字 + 指针 + 数值框） */
    _mimicGauge(g, x, y, w, h, o) {
        g.add(_rect({ x, y, width: w, height: h, fill: '#f7f8f9', stroke: '#8a8f92', strokeWidth: 1 }));
        g.add(_text({ x: x + 2, y: y + 5, width: w - 4, align: 'center', fontSize: 11.5, fill: '#1b1f21', text: o.label }));
        const cx = x + w / 2, cy = y + h - 30, R = Math.min(w * 0.30, h * 0.40);
        const arc = (rot, ang, ri, ro, fill) => new Konva.Arc({
            x: cx, y: cy, innerRadius: ri, outerRadius: ro, angle: ang, rotation: rot, fill, listening: false,
        });
        g.add(arc(180, 180, R - 9, R, o.color || '#16689e'));
        g.add(arc(180, 7, R - 9, R, C_RED));
        // 刻度（21 根）+ 数字
        for (let i = 0; i <= 20; i++) {
            const a = Math.PI + (i / 20) * Math.PI;
            const major = i % 5 === 0;
            const r1 = R - 9 - (major ? 9 : 4);
            g.add(_line({
                points: [cx + Math.cos(a) * r1, cy + Math.sin(a) * r1, cx + Math.cos(a) * (R - 10), cy + Math.sin(a) * (R - 10)],
                stroke: '#ffffff', strokeWidth: major ? 1.5 : 1,
            }));
        }
        const nLab = o.labels || 4;
        for (let i = 0; i < nLab; i++) {
            const t = nLab === 1 ? 0 : i / (nLab - 1);
            const a = Math.PI + t * Math.PI;
            const rr = R - 22;
            const v = o.lo + (o.hi - o.lo) * t;
            g.add(_text({
                x: cx + Math.cos(a) * rr - 12, y: cy + Math.sin(a) * rr - 6, width: 24, align: 'center',
                fontSize: 8.5, fill: '#2b3134', text: o.hi <= 10 ? v.toFixed(1) : String(Math.round(v)),
            }));
        }
        // 指针
        const pct = Math.max(0, Math.min(1, (o.v - o.lo) / ((o.hi - o.lo) || 1)));
        const na = Math.PI + pct * Math.PI;
        g.add(_line({
            points: [cx, cy, cx + Math.cos(na) * (R - 10), cy + Math.sin(na) * (R - 10)],
            stroke: '#2b3134', strokeWidth: 1.8, lineCap: 'round',
        }));
        g.add(new Konva.Circle({ x: cx, y: cy, radius: 3.4, fill: '#3c4245', listening: false }));
        // 数值框
        const bw = Math.min(112, w - 20), bh = 19, bx = cx - bw / 2, by = y + h - 22;
        g.add(_rect({ x: bx, y: by, width: bw, height: bh, fill: '#ffffff', stroke: '#5a6167', strokeWidth: 1 }));
        g.add(_text({ x: bx + 2, y: by + 3, width: bw - 34, align: 'right', fontSize: 11.5, fontStyle: 'bold', fill: '#1a4fa0', text: o.dec ? o.v.toFixed(o.dec) : String(Math.round(o.v)) }));
        g.add(_text({ x: bx + bw - 30, y: by + 5, width: 28, fontSize: 8.5, fill: '#3c4245', text: o.unit }));
    }

    /** 主机概览：带标题牌的分区框 */
    _mimicBlock(g, x, y, w, h, title) {
        g.add(_rect({ x, y, width: w, height: h, fill: '#f4f5f6', stroke: '#7a8286', strokeWidth: 1.2 }));
        const tw = Math.max(64, title.length * 7.4 + 14);
        g.add(_rect({ x: x + w / 2 - tw / 2, y: y - 1, width: tw, height: 16, fill: '#c9ced1', stroke: '#5a6167', strokeWidth: 1 }));
        g.add(_text({ x: x + w / 2 - tw / 2, y: y + 1, width: tw, align: 'center', fontSize: 11, fontStyle: 'bold', fill: '#1b1f21', text: title }));
    }

    /** 主机概览：轴承温度小框（单值或 AFT(S)/AFT(P) 双值） */
    _mimicBearing(g, x, y, w, h, title, v1, v2) {
        g.add(_rect({ x, y, width: w, height: h, fill: '#f4f5f6', stroke: '#7a8286', strokeWidth: 1.2 }));
        g.add(_text({ x: x + 4, y: y + 4, width: w - 8, align: 'center', fontSize: 10.5, fill: '#1b1f21', text: title }));
        const one = (bx, by, v, lb) => {
            if (lb) g.add(_text({ x: x + 6, y: by, width: bx - x - 10, align: 'right', fontSize: 9.5, fill: '#3c4245', text: lb }));
            g.add(_rect({ x: bx + 2, y: by - 1, width: 56, height: 15, fill: '#ffffff', stroke: '#5a6167', strokeWidth: 1 }));
            g.add(_text({ x: bx + 4, y: by, width: 40, align: 'right', fontSize: 10.5, fontStyle: 'bold', fill: '#1a4fa0', text: v.toFixed(1) }));
            g.add(_text({ x: bx + 46, y: by + 2, width: 12, fontSize: 8.5, fill: '#3c4245', text: '℃' }));
        };
        if (v2 == null) {
            one(x + w / 2 - 30, y + 26, v1, '');
        } else {
            one(x + w - 100, y + 22, v1, 'AFT (S)');
            one(x + w - 100, y + 34, v2, 'AFT (P)');
        }
    }

    // ── 数值单元格双击编辑（DOM input 覆盖在单元格上）──
    _beginEdit(key) {
        const cell = this._paramCells && this._paramCells[key];
        if (!cell || !this._edit) return;
        this._endEdit();
        const tag = this.model.tag(this._paramTagId);
        if (!tag) return;
        const abs = this.group.getAbsolutePosition();
        const rect = this.sys.stage.container().getBoundingClientRect();
        const inp = document.createElement('input');
        inp.id = `kchief_param_${key}`;
        inp.type = 'text';
        inp.value = String(this._edit[key]);
        Object.assign(inp.style, {
            position: 'fixed',
            left: `${rect.left + abs.x + cell.x}px`,
            top: `${rect.top + abs.y + cell.y}px`,
            width: `${cell.w}px`, height: `${cell.h}px`,
            fontSize: '13px', textAlign: 'center', boxSizing: 'border-box',
            border: '2px solid #1c6fb2', background: '#ffffff', color: '#12384f', zIndex: 9999,
        });
        const commit = () => {
            let v = parseFloat(inp.value);
            if (isFinite(v)) {
                if (key === 'limit') v = Math.min(tag.span[1], Math.max(tag.span[0], v));
                if (key === 'delay') v = Math.min(600, Math.max(0, Math.round(v)));
                if (key === 'deadband') v = Math.min(tag.span[1] - tag.span[0], Math.max(0, Math.round(v * 1000) / 1000));
                this._edit[key] = v;
            }
            this._endEdit();
            this._renderDialog();
        };
        inp.addEventListener('keydown', (ev) => {
            if (ev.key === 'Enter') { ev.preventDefault(); commit(); }
            else if (ev.key === 'Escape') { ev.preventDefault(); this._endEdit(); this._renderDialog(); }
        });
        inp.addEventListener('blur', commit);
        document.body.appendChild(inp);
        this._editInput = inp;
        inp.focus();
        inp.select();
    }

    _endEdit() {
        if (this._editInput) {
            const el = this._editInput;
            this._editInput = null;
            el.remove();
        }
    }

    // ── 参数设置界面（K-Chief 的 Tag properties：Alarm parameters 页）──
    /** 单元格热区（对话框内）：单击 / 双击回调 */
    _cellHit(g, id, x, y, w, h, onClick, onDbl) {
        const hit = new Konva.Rect({ x, y, width: w, height: h, fill: 'rgba(0,0,0,0)', listening: true, cursor: 'pointer' });
        hit.on('click tap', (e) => {
            e.cancelBubble = true;
            if (this.sys) { this.sys.lastClickedId = this.id; this.sys.lastClickedPartId = `${this.id}/${id}`; }
            onClick && onClick();
        });
        if (onDbl) {
            hit.on('dblclick dbltap', (e) => {
                e.cancelBubble = true;
                if (this.sys) { this.sys.lastClickedId = this.id; this.sys.lastClickedPartId = `${this.id}/${id}`; }
                onDbl();
            });
        }
        g.add(hit);
        if (!this._parts) this._parts = {};
        this._parts[id] = { x, y, w, h, node: hit };
        this._dialogPartIds.push(id);
    }

    _renderParam() {
        const g = this._overlayGroup;
        const M = this.model;
        const tag = M.tag(this._paramTagId);
        if (!tag || !this._edit) { this._closeDialog(); return; }
        const e = this._edit;

        const pw = 900, ph = 470;
        const px = Math.round((W - pw) / 2), py = Math.round((H - ph) / 2);
        const tagNo = M.tags.indexOf(tag) + 1;

        // 窗体
        g.add(_rect({ x: px, y: py, width: pw, height: ph, fill: '#e9ecee', stroke: '#6a7176', strokeWidth: 1.4, cornerRadius: 3 }));
        // 标题栏
        g.add(_rect({ x: px, y: py, width: pw, height: 34, fill: '#4a5055', stroke: '#3a3f43', strokeWidth: 1 }));
        g.add(_text({
            x: px + 14, y: py + 9, width: pw - 80, fontSize: 14, fontStyle: 'bold', fill: '#ffffff',
            text: `${tagNo} - ${tag.en || tag.name}`,
        }));
        this._ovBtn(g, 'param-close', px + pw - 38, py + 6, 26, 22, '✕', () => this.cancelParam(), { fontSize: 12 });

        // 左侧 Acknowledge（单独确认该参数的报警）
        this._ovBtn(g, 'param-ack', px + 20, py + 96, 132, 32, 'Acknowledge', () => {
            const ok = this.model.ackTag(tag.id);
            this._tip(ok ? `已单独确认：${tag.id}` : '该测点当前没有待确认的报警');
            // 立即刷新背后的「当前报警 / 报警历史」等列表页状态（不等关闭对话框）
            this._renderPage();
            this._renderDialog();
        }, { fontSize: 12.5 });

        // 标签页
        const tabs = [
            ['summary', 'Summary', 100],
            ['trend', 'Trend', 90],
            ['alarm', 'Alarm parameters', 160],
            ['other', 'Other parameters', 160],
            ['help', 'Help', 80],
        ];
        let tx = px + 230;
        tabs.forEach(([key, label, tw]) => {
            const active = (this._paramTab || 'alarm') === key;
            g.add(_rect({
                x: tx, y: py + 44, width: tw, height: 28,
                fill: active ? '#ffffff' : '#d7dcdf',
                stroke: '#8b959c', strokeWidth: 1,
            }));
            g.add(_text({
                x: tx, y: py + 51, width: tw, align: 'center', fontSize: 12.5,
                fontStyle: active ? 'bold' : 'normal', fill: '#22303a', text: label,
            }));
            this._cellHit(g, `param-tab-${key}`, tx, py + 44, tw, 28, () => {
                this._endEdit();
                this._paramTab = key;
                this._renderDialog();
            });
            tx += tw + 4;
        });

        // 内容区
        const cx = px + 230, cy = py + 76, cw = pw - 260, ch = ph - 150;
        g.add(_rect({ x: cx, y: cy, width: cw, height: ch, fill: '#ffffff', stroke: '#8b959c', strokeWidth: 1 }));

        if ((this._paramTab || 'alarm') !== 'alarm') {
            const tipTxt = this._paramTab === 'summary' ? '摘要（Summary）：测点当前值、报警状态与所在报警组'
                : this._paramTab === 'trend' ? '趋势（Trend）：该测点的历史曲线'
                    : this._paramTab === 'other' ? '其它参数（Other parameters）：量程、单位、DPU 通道等'
                        : '帮助（Help）：双击数值单元格进入编辑，Yes/No 单击切换；点「保存」生效、「取消」还原';
            g.add(_text({ x: cx + 20, y: cy + 40, width: cw - 40, fontSize: 13, fill: '#3a4145', text: tipTxt }));
            if (this._paramTab === 'summary') {
                const al = M.alarmOf(tag.id);
                g.add(_text({
                    x: cx + 20, y: cy + 72, width: cw - 40, fontSize: 13, fill: '#1b3a4b',
                    text: `实测值：${valText(tag)}　　状态：${al ? KChiefSolver.stateText(al.state) : '正常'}`
                        + `　　报警组：${ALARM_GROUPS[tag.group].name}　　Function：${tag.fn || '—'}`,
                }));
            }
            this._ovBtn(g, 'param-save', px + pw - 240, py + ph - 48, 100, 34, '保存', () => this.saveParam(), { fontSize: 13, primary: true });
            this._ovBtn(g, 'param-cancel', px + pw - 130, py + ph - 48, 100, 34, '取消', () => this.cancelParam(), { fontSize: 13 });
            return;
        }

        // 表头：Parameters | Value | Unit
        const colP = cx + 10, colV = cx + 280, colU = cx + 550;
        const wP = 270, wV = 270, wU = cw - 560;
        g.add(_rect({ x: cx + 1, y: cy + 1, width: cw - 2, height: 28, fill: '#cfd5d8', stroke: '#a8b0b5', strokeWidth: 1 }));
        g.add(_text({ x: colP, y: cy + 8, width: wP, fontSize: 13, fontStyle: 'bold', fill: '#22303a', text: 'Parameters' }));
        g.add(_text({ x: colV, y: cy + 8, width: wV, align: 'center', fontSize: 13, fontStyle: 'bold', fill: '#22303a', text: 'Value' }));
        g.add(_text({ x: colU, y: cy + 8, width: wU, align: 'center', fontSize: 13, fontStyle: 'bold', fill: '#22303a', text: 'Unit' }));

        // 参数行（开关量无 High Limit）
        const rows = [
            { key: 'isalarm', label: 'Is Alarm', value: e.isAlarm ? 'Yes' : 'No', unit: '', type: 'bool' },
            { key: 'isinhibit', label: 'Is Inhibit', value: e.isInhibit ? 'Yes' : 'No', unit: '', type: 'bool' },
        ];
        if (!tag.digital) {
            rows.push({ key: 'limit', label: tag.dir === 'low' ? 'Low Limit' : 'High Limit', value: String(e.limit), unit: tag.unit, type: 'num' });
            rows.push({ key: 'deadband', label: 'Deadband', value: String(e.deadband), unit: tag.unit, type: 'num' });
        }
        rows.push({ key: 'delay', label: 'Delay Time', value: String(e.delay), unit: 'sec.', type: 'num' });

        this._paramCells = {};
        rows.forEach((row, i) => {
            const ry = cy + 30 + i * 30;
            g.add(_rect({ x: cx + 1, y: ry, width: cw - 2, height: 30, fill: i % 2 ? '#f4f6f7' : '#fbfcfc', stroke: '#dfe3e5', strokeWidth: 0.6 }));
            g.add(_text({ x: colP, y: ry + 8, width: wP, fontSize: 13, fill: '#22303a', text: row.label }));
            g.add(_text({
                x: colV, y: ry + 8, width: wV, align: 'center', fontSize: 13,
                fill: row.type === 'bool' ? '#12384f' : '#1a4fd0', text: row.value,
            }));
            g.add(_text({ x: colU, y: ry + 8, width: wU, align: 'center', fontSize: 13, fill: '#3a4145', text: row.unit }));

            // 单元格热区：Yes/No 单击切换；数值双击进入编辑
            if (row.type === 'bool') {
                this._cellHit(g, `param-${row.key}`, colV - 6, ry + 2, wV + 12, 26, () => {
                    if (row.key === 'isalarm') this._edit.isAlarm = !this._edit.isAlarm;
                    else this._edit.isInhibit = !this._edit.isInhibit;
                    this._renderDialog();
                });
            } else {
                this._paramCells[row.key] = { x: colV - 6, y: ry + 2, w: wV + 12, h: 26 };
                this._cellHit(g, `param-${row.key}`, colV - 6, ry + 2, wV + 12, 26,
                    null, () => this._beginEdit(row.key));
            }
        });

        // 提示
        g.add(_text({
            x: cx + 12, y: cy + ch - 34, width: cw - 24, fontSize: 11.5, fill: '#5a6167',
            text: 'Yes/No 单击切换；High Limit / Delay Time 双击数值进入编辑，回车确认。'
                + '可一次修改多项，点「保存」生效、点「取消」全部还原。',
        }));

        // 底部按钮
        this._ovBtn(g, 'param-save', px + pw - 240, py + ph - 48, 100, 34, '保存', () => this.saveParam(), { fontSize: 13, primary: true });
        this._ovBtn(g, 'param-cancel', px + pw - 130, py + ph - 48, 100, 34, '取消', () => this.cancelParam(), { fontSize: 13 });
    }

    // ═══════════════════════════════════════════════════════
    //  每帧动态刷新
    // ═══════════════════════════════════════════════════════
    tick(dt) {
        this.model.solve(dt);
        this._updateDynamic();
        this.markDirty();
        this._refreshIfDirty();
    }

    _updateDynamic() {
        const M = this.model;
        const blink = Math.floor(M.t * 2.5) % 2 === 0;
        const unack = M.unackCount();

        // 时钟
        if (this._clockText) this._clockText.text(dateTimeText());

        // 值班状态
        if (this._watchText) {
            const bridge = M.watch === 'BRIDGE';
            this._watchText.text(bridge ? 'BRIDGE watch' : 'ECR watch');
            this._watchRect.fill(bridge ? '#e0a100' : C_GREEN);
            this._seaText.text('At sea');
        }

        // ── 最新警报横幅（两行，最新在上）──
        const latest = M.alarms.slice().sort((a, b) => b.seq - a.seq).slice(0, 2);
        this._bannerRows.forEach((row, i) => {
            const al = latest[i];
            if (!al) {
                row.prioRect.fill('#f0f2f3');
                row.prioRect.stroke('#cfd5d8');
                row.prioText.text('');
                row.levelText.text('').fill('#7a8084');
                row.timeText.text('');
                row.groupText.text('');
                row.descText.text(i === 0 && !M.alarms.length ? '无未确认报警（全部测点正常）' : '').fill('#7a8084');
                return;
            }
            const prio = PRIORITIES[al.prio] || PRIORITIES.B;
            const pending = (al.state === 'UNACK' || al.state === 'RTN');
            row.prioRect.fill(pending && blink ? prio.color : (pending ? '#f08080' : prio.color));
            row.prioRect.stroke('#7a0f0f');
            row.prioText.text(al.prio);
            row.levelText.text(al.dir === 'high' ? 'HIGH' : 'LOW').fill('#222222');
            row.timeText.text(al.t).fill('#222222');
            row.groupText.text((ALARM_GROUPS[al.group] || {}).name || '');
            row.descText.text(al.en || al.name).fill('#222222');
        });

        // 未确认报警数按钮（红块：数字 + ▼）
        if (this._cntText) {
            const on = unack > 0;
            this._cntBg.fill(on ? '#c8161d' : '#d8dcde');
            this._cntBg.stroke(on ? '#7a0f0f' : '#9aa0a4');
            this._cntText.text(String(unack)).fill(on ? '#ffffff' : '#555555');
            this._cntArrow.fill(on ? '#ffffff' : '#888888');
        }

        // 左列报警组列表（UnDock：组名 + 计数；Dock：仅计数条）
        if (this._unDockText) this._unDockText.text(this._unDock ? 'UnDock' : 'Dock');
        // 组行显示规则：
        //   有未确认报警 → 亮红 / 深红闪烁（2 Hz），数字＝未确认数；
        //   全部已确认但故障未排除（报警仍在）→ 深红常亮，数字＝该组报警数；
        //   无报警 → 灰底。
        const groupBlink = Math.floor(M.t * 2) % 2 === 0;
        this._groupRows.forEach((row) => {
            const unack = M.groupUnack(row.key);
            const active = M.groupActive(row.key);
            row.cntText.text(String(unack > 0 ? unack : active));
            row.nameText.visible(this._unDock);
            if (unack > 0) {
                row.rowBg.fill(groupBlink ? '#ff2b2b' : '#8f0d0d');
                row.rowBg.stroke('#7a0f0f');
                row.cntBg.fill(groupBlink ? '#ff5a5a' : '#a81010');
                row.cntBg.stroke('#7a0f0f');
                row.cntText.fill('#ffffff');
                row.nameText.fill('#ffffff');
            } else if (active > 0) {
                // 已确认但故障仍在：深红常亮
                row.rowBg.fill('#8f0d0d');
                row.rowBg.stroke('#7a0f0f');
                row.cntBg.fill('#a81010');
                row.cntBg.stroke('#7a0f0f');
                row.cntText.fill('#ffffff');
                row.nameText.fill('#ffffff');
            } else {
                row.rowBg.fill('#f6f7f8');
                row.rowBg.stroke('#b9bfc3');
                row.cntBg.fill('#ffffff');
                row.cntBg.stroke('#b9bfc3');
                row.cntText.fill('#333333');
                row.nameText.fill('#2b3134');
            }
        });

        // 对话框 / 整页内容随测量值变化，定时重建（对话框 400 ms、列表页 500 ms）
        // 值班呼叫对话框：定时重建（呼叫按钮闪烁、当班状态变化）
        const wcFast = this._wcPress && (Date.now() - this._wcPress.t) < 650;
        if (this._watchCallOpen && Date.now() - (this._wcRefresh || 0) > (wcFast ? 60 : 350)) {
            this._wcRefresh = Date.now();
            this._renderWatchCall();
        }

        this._sampleTrend();

        const now = Date.now();
        if (this._overlay === 'param') {
            // 参数界面内容静态，不自动重建（否则会打断双击编辑）
        } else if (this._overlay) {
            if (now - this._lastOverlayRefresh > 500) this._renderPage();
        }
    }
}
