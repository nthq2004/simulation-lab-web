import { BaseComponent } from './BaseComponent.js';
import { CANId, CAN_FUNC, NMT_CMD, NMT_STATE, CAN_TICK_INTERVAL } from '../can/CANBUS.js';

// 探测器类型码 → 英文简述（用于 LCD 报警文本，复刻截图风格）
const TYPE_EN = { 1: 'Smoke', 2: 'Flame', 3: 'Heat', 4: 'Hand' };
// ZONE → 场所英文（用于 LCD 报警文本，复刻截图风格）
const ZONE_DEVICE_EN = { 1: 'GEN', 2: 'MAIN', 3: 'BOILER', 4: 'SEP' };
const ZONE_DEVICE = { 1: '发电机', 2: '主机', 3: '锅炉', 4: '分油机' };

// LCD 每页显示的内容行数（超出一页时整页翻页）
const LCD_PER_PAGE = 12;

/**
 * FireAlarmController — 火灾报警控制器（CS4000 风格，复刻教学截图）
 *
 * 职责：
 *   · 作为 CAN 主站，接收两路探测器回路上报（地址 1~8），维护火警/故障/隔离；
 *   · 面板：左侧竖排状态灯 + Custom LED、Fire Detection System 标题 + Status/Menu、
 *     蓝色 LCD 事件列表、FIRE(红闪)/PreAlarm/Fault/Disablements/Shortcuts、
 *     MULTIPLE ALARMS / RESET / MUTE、右侧 Esc / 方向键 / OK / 数字键盘；
 *   · STATUS 系统状态浏览；MENU 四菜单（Fault Alarms / Fire Alarms / Disconnections / History）；
 *   · Disconnections 隔离：隔离探测器/分区后触发不再产生火警；隔离外部报警设备后
 *     控制器仍显示火警但声光报警器不动作。
 *
 * 端口：can1p/can1n、can2p/can2n（左下两路 CAN）、vcc/gnd。
 */
export class FireAlarmController extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.W = 880;
        this.H = 480;
        this.type    = 'FireAlarmController';
        this.special = 'can';
        this.cache   = 'fixed';
        this.nodeAddress = 0;

        this._initGroups();
        this._recalcGeometry(config);
        this._initParameters(config);
        this._init();

        this.config = {
            id: this.id, label: this.label, scale: this.scale,
            sounderId: this.sounderId, panelId: this.panelId,
        };

        // 端口：左下 220V 主/备电输入；下中 CAN 回路2；下右 报警输出；右中 CAN 回路1
        this.addPort(150, this.H, 'mainL', 'wire', 'p');
        this.addPort(185, this.H, 'mainN', 'wire');
        this.addPort(250, this.H, 'bkL', 'wire', 'p');
        this.addPort(285, this.H, 'bkN', 'wire');
        // 下面中间：CAN 总线接口（回路2）—— 左移 120px
        this.addPort(480, this.H, 'can2p', 'wire', 'p');
        this.addPort(515, this.H, 'can2n', 'wire');
        this.addPort(790, this.H, 'alarm_o', 'wire', 'p');
        this.addPort(825, this.H, 'alarm_r', 'wire');
        this.addPort(this.W, 250, 'can1p', 'wire', 'p');
        this.addPort(this.W, 285, 'can1n', 'wire');

        // 报警输出干接点：报警时闭合，直接驱动声光报警器
        this.signalContacts = [['alarm_o', 'alarm_r', 'alarm']];
    }

    /** 报警输出触点（闭合 = 报警输出有效） */
    getSignalResistance(key) {
        if (key === 'alarm') return this._alarmOut ? 0.01 : 1e9;
        return 1e9;
    }

    // ═══════════════════════════════════════════════════════
    // 几何 / 参数
    // ═══════════════════════════════════════════════════════

    _recalcGeometry(_config) { this.W = 880; this.H = 480; }

    _initParameters(config) {
        this.label     = config.label || '火灾报警控制器 (FAS)';
        this.sounderId = config.sounderId || 'sounder';
        this.panelId   = config.panelId || 'fpanel';
        // 已知探测器清单（未收到上报时也用于隔离菜单显示）
        this.knownNodes = Array.isArray(config.detectors) ? config.detectors.slice() : [];

        this.mode = 'normal';              // normal | status | menu | fire | fault | disconn | history
        this.menus = ['Fault Alarms', 'Fire Alarms', 'Disconnections', 'History'];
        this.menuIndex = 0;
        this.cursor = 0;
        this.disconnIndex = 0;

        this.nodes = {};                   // nodeAddress → {type,loop,zone,alarm,isolated,fault,lastSeen}
        this.activeAlarms = [];            // {text, ts, nodeAddr, zone}
        this.faultAlarms = [];
        this.history = { fire: [], fault: [], isolation: [] };
        this.zoneAlarm = { 1: false, 2: false, 3: false, 4: false };
        this.isolated = { nodes: new Set(), zones: new Set(), extDevice: false };

        this.muted = false;
        this.displayTest = false;
        this._testT = 0;
        this._flash = 0;
        this._acc = 0;
        this._mainPowerFail = false;

        // 电源开关 / 自检 / 运行状态
        this.powerSwitch = false;   // 内部电源开关
        this._mainOK = false;
        this._bkOK = false;
        this._powered = false;
        this._running = false;
        this._selfTest = false;
        this._selfTestT = 0;
        this._selfTestSounder = false;
        this._nodesSeeded = false;   // 运行后按已知节点固定建立节点表
        this._runStart = 0;

        // 报警输出（驱动声光报警器）
        this._alarmOut = false;

        // CAN 主站自身状态
        this.powerOn = false;
        this.busConnected = false;
        this.commFault = false;
        this.nmtState = NMT_STATE.RUN;
        this._lastHeartbeat = 0;
    }

    _init() {
        this._drawStaticParts();
        this._createDynamicNodes();
        this._bindInteraction();
    }

    // ═══════════════════════════════════════════════════════
    // 静态绘制
    // ═══════════════════════════════════════════════════════

    _drawStaticParts() {
        const g = this._staticGroup;

        // 左侧深色背景 + 竖排灯条（宽度仅容纳文字）
        const leftW = 108;
        g.add(new Konva.Rect({ x: 0, y: 0, width: leftW, height: this.H, fill: '#1c1f22', cornerRadius: [10, 0, 0, 10] }));
        // 主面板
        g.add(new Konva.Rect({ x: leftW, y: 0, width: this.W - leftW, height: this.H, fill: '#4a4f55', stroke: '#33383d', strokeWidth: 2, cornerRadius: [10, 70, 70, 10] }));
        // 标题
        g.add(new Konva.Text({ x: 118, y: 34, text: 'Fire Detection System', fontSize: 22, fontStyle: 'bold', fill: '#f2f4f6' }));
        // Status / Menu 页签
        g.add(new Konva.Rect({ x: 576, y: 18, width: 128, height: 44, fill: '#3b3f44', stroke: '#26292d', strokeWidth: 1.5, cornerRadius: 22 }));
        g.add(new Konva.Text({ x: 576, y: 32, width: 128, text: 'Status', fontSize: 15, fontStyle: 'bold', fill: '#e8ebee', align: 'center' }));
        g.add(new Konva.Rect({ x: 716, y: 18, width: 128, height: 44, fill: '#3b3f44', stroke: '#26292d', strokeWidth: 1.5, cornerRadius: 22 }));
        g.add(new Konva.Text({ x: 716, y: 32, width: 128, text: 'Menu', fontSize: 15, fontStyle: 'bold', fill: '#e8ebee', align: 'center' }));

        // LCD 边框 + 蓝色屏（紧靠 5 个功能键右侧；宽度 +20）
        g.add(new Konva.Rect({ x: 250, y: 78, width: 440, height: 316, fill: '#2a2d31', cornerRadius: 6 }));
        g.add(new Konva.Rect({ x: 258, y: 86, width: 424, height: 300, fill: '#1b1fd0', stroke: '#cdd3d8', strokeWidth: 1 }));

        // 左侧功能键：FIRE / Fault 为动态（报警时变色闪烁），其余静态
        // — FIRE / Fault 在 _createDynamicNodes 中绘制 —
        // 左侧 5 个带灯功能键：全部动态绘制（自检/报警时变色闪烁）
        // — 见 _createDynamicNodes —

        // 底部 3 个按钮：沿 LCD（250~650，中心 450）下方对称分布
        g.add(new Konva.Text({ x: 255, y: 402, width: 150, text: 'MULTIPLE ALARMS', fontSize: 11, fontStyle: 'bold', fill: '#dfe3e6', align: 'center' }));
        g.add(new Konva.Rect({ x: 295, y: 424, width: 70, height: 30, fill: '#3b3f44', stroke: '#bfc5ca', strokeWidth: 1.5, cornerRadius: 4 }));
        g.add(new Konva.Text({ x: 295, y: 429, width: 70, text: '▶|', fontSize: 16, fontStyle: 'bold', fill: '#f2f4f6', align: 'center' }));
        g.add(new Konva.Text({ x: 405, y: 402, width: 90, text: 'RESET', fontSize: 13, fontStyle: 'bold', fill: '#dfe3e6', align: 'center' }));
        g.add(new Konva.Text({ x: 525, y: 402, width: 90, text: 'MUTE', fontSize: 13, fontStyle: 'bold', fill: '#dfe3e6', align: 'center' }));

        // 右侧 ESC / 方向键 / OK（ESC 与上方向键水平对齐；OK 与下方向键水平对齐）
        this._drawKey(g, 830, 104, 24, 'ESC', 11);
        this._drawKey(g, 749, 104, 20, '▲', 14);
        this._drawKey(g, 715, 152, 20, '◀', 14);
        this._drawKey(g, 783, 152, 20, '▶', 14);
        this._drawKey(g, 749, 200, 20, '▼', 14);
        this._drawKey(g, 830, 200, 24, 'OK', 13);

        // 数字键盘（3×4）
        const kx = [725, 781, 837], ky = [272, 328, 384, 440];
        const keys = [
            ['1', '2', '3'],
            ['4', '5', '6'],
            ['7', '8', '9'],
            ['←', '0', '↵'],
        ];
        keys.forEach((row, r) => row.forEach((k, c) => this._drawKey(g, kx[c], ky[r], 22, k, 16)));

        // 位号
        g.add(new Konva.Text({ x: 116, y: this.H - 22, width: 180, text: this.label, fontSize: 12, fontStyle: 'bold', fill: '#cfd8dc' }));
    }

    /** 静态功能键：灰底 + 黑字 + 白底图标（初始状态，与 FIRE 一致） */
    _drawPanelButton(g, x, y, w, h, text, icon) {
        g.add(new Konva.Rect({ x, y, width: w, height: h, fill: '#8f959b', stroke: '#5c6167', strokeWidth: 1.5, cornerRadius: 5 }));
        g.add(new Konva.Text({ x: x + 8, y: y + h / 2 - 9, width: w - 36, text, fontSize: 13, fontStyle: 'bold', fill: '#222222', wrap: 'none' }));
        const ix = x + w - 20, iy = y + h / 2;
        g.add(new Konva.Circle({ x: ix, y: iy, radius: 13, fill: '#ffffff', stroke: '#5c6167', strokeWidth: 1.5 }));
        g.add(this._makeGlyph(icon, ix, iy, '#546e7a'));
    }

    /** 动态功能键（FIRE / Fault）：返回文字 / 外框 / 符号节点，供闪烁变色 */
    _drawPanelButtonDyn(x, y, w, h, text, icon) {
        const d = this._dynamicGroup;
        d.add(new Konva.Rect({ x, y, width: w, height: h, fill: '#8f959b', stroke: '#5c6167', strokeWidth: 1.5, cornerRadius: 5 }));
        const tnode = new Konva.Text({ x: x + 8, y: y + h / 2 - 9, width: w - 36, text, fontSize: 13, fontStyle: 'bold', fill: '#222222', wrap: 'none' });
        d.add(tnode);
        const ix = x + w - 20, iy = y + h / 2;
        d.add(new Konva.Circle({ x: ix, y: iy, radius: 13, fill: '#ffffff' }));
        const ring = new Konva.Circle({ x: ix, y: iy, radius: 13, fill: 'rgba(0,0,0,0)', stroke: '#5c6167', strokeWidth: 1.5, listening: false });
        d.add(ring);
        const glyph = this._makeGlyph(icon, ix, iy, '#546e7a');
        d.add(glyph);
        return { textNode: tnode, ring, glyph, ix, iy, baseText: text };
    }

    /** 生成图标符号（白底之上）：火焰 / 感叹号 / 三角 / 隔离 / 箭头 */
    _makeGlyph(icon, ix, iy, color) {
        if (icon === 'flame') {
            return new Konva.Line({
                points: [ix, iy - 9, ix + 5, iy - 1, ix + 2, iy + 8, ix - 2, iy + 8, ix - 5, iy - 1, ix, iy - 9],
                closed: true, fill: color, stroke: color, strokeWidth: 1, listening: false,
            });
        }
        const t = new Konva.Text({ x: ix - 13, y: iy - 11, width: 26, text: '!', fontSize: 18, fontStyle: 'bold', fill: color, align: 'center', listening: false });
        if (icon === 'bang') return t;
        if (icon === 'arrow') { t.text('↗'); t.fontSize(16); t.y(iy - 9); return t; }
        if (icon === 'iso') {
            const grp = new Konva.Group({ listening: false });
            grp.add(new Konva.Circle({ x: ix, y: iy, radius: 8, stroke: color, strokeWidth: 2, listening: false }));
            grp.add(new Konva.Line({ points: [ix - 6, iy + 6, ix + 6, iy - 6], stroke: color, strokeWidth: 2, listening: false }));
            return grp;
        }
        if (icon === 'triangle') {
            return new Konva.Line({ points: [ix, iy - 8, ix + 8, iy + 6, ix - 8, iy + 6], closed: true, stroke: color, strokeWidth: 2, listening: false });
        }
        return t;
    }

    _drawKey(g, cx, cy, r, text, fs) {
        g.add(new Konva.Circle({ x: cx, y: cy, radius: r, fill: '#8f959b', stroke: '#5c6167', strokeWidth: 1.5 }));
        g.add(new Konva.Text({ x: cx - r - 4, y: cy - fs * 0.72, width: (r + 4) * 2, text, fontSize: fs, fontStyle: 'bold', fill: '#2b2f33', align: 'center' }));
    }

    /** 左下：内部电源开关（拨动开关） */
    _drawPowerSwitch() {
        const d = this._dynamicGroup;
        const x = 8, y = 418, w = 92, h = 44;
        d.add(new Konva.Text({ x, y: y - 16, width: w, text: 'POWER', fontSize: 11, fontStyle: 'bold', fill: '#e6e9ec', align: 'center' }));
        d.add(new Konva.Rect({ x, y, width: w, height: h, fill: '#141414', stroke: '#555', strokeWidth: 1.5, cornerRadius: h / 2 }));
        this._pwrKnob = new Konva.Circle({ x: x + h / 2, y: y + h / 2, radius: h / 2 - 4, fill: '#8f959b', stroke: '#5c6167', strokeWidth: 2 });
        d.add(this._pwrKnob);
        this._pwrText = new Konva.Text({ x, y: y + h + 2, width: w, text: 'OFF', fontSize: 10, fontStyle: 'bold', fill: '#ff8a80', align: 'center' });
        d.add(this._pwrText);
        this._pwrOffX = x + h / 2;
        this._pwrOnX = x + w - h / 2;
    }

    // ═══════════════════════════════════════════════════════
    // 动态节点
    // ═══════════════════════════════════════════════════════

    _createDynamicNodes() {
        const d = this._dynamicGroup;

        // 左侧竖排状态灯
        const lampDefs = [
            ['power', 70, '#25d425'], ['sysfault', 120, '#ffd400'], ['test', 170, '#cfd8dc'],
            ['warning', 220, '#cfd8dc'], ['zone', 270, '#cfd8dc'], ['alarmdev', 330, '#cfd8dc'],
            ['delayoff', 380, '#cfd8dc'],
        ];
        this._lamps = {};
        const labels = {
            power: 'Power', sysfault: 'System fault', test: 'Test', warning: 'Warning',
            zone: 'Zone', alarmdev: 'Alarm device', delayoff: 'Alarm delay off',
        };
        lampDefs.forEach(([k, y, c]) => {
            const l = new Konva.Circle({ x: 13, y, radius: 9, fill: '#2b2f33', stroke: '#555', strokeWidth: 1.5 });
            d.add(l);
            this._lamps[k] = { node: l, color: c };
            d.add(new Konva.Text({ x: 28, y: y - 8, text: labels[k], fontSize: 11, fill: '#e6e9ec' }));
        });

        // 左下：内部电源开关（取代原 3 个自定义 LED）
        this._drawPowerSwitch();

        // LCD 文本（宽度随屏 +20）
        this._lcdText = new Konva.Text({
            x: 266, y: 92, width: 408, height: 288,
            text: '', fontSize: 15.5, fontFamily: 'Consolas, Courier New, monospace',
            fill: '#ffffff', lineHeight: 1.35, listening: false,
        });
        d.add(this._lcdText);

        // 未上电时的 LCD 黑屏遮罩（置于文字之上）
        this._lcdOverlay = new Konva.Rect({ x: 258, y: 86, width: 424, height: 300, fill: '#060606', listening: false });
        d.add(this._lcdOverlay);

        // 左侧 5 个带灯功能键（FIRE / PreAlarm / Fault / Disablements / Shortcuts）
        this._fireBtn = this._drawPanelButtonDyn(118, 78, 120, 42, 'FIRE', 'flame');
        this._preBtn = this._drawPanelButtonDyn(118, 146, 120, 42, 'PreAlarm', 'triangle');
        this._faultBtn = this._drawPanelButtonDyn(118, 220, 120, 42, 'Fault', 'bang');
        this._disableBtn = this._drawPanelButtonDyn(118, 300, 120, 42, 'Disablements', 'iso');
        this._shortBtn = this._drawPanelButtonDyn(118, 378, 120, 42, 'Shortcuts', 'arrow');

        // RESET / MUTE 圆形按钮（中心与上方文字中心对齐，沿 LCD 下方对称）
        this._resetBtn = new Konva.Circle({ x: 450, y: 437, radius: 22, fill: '#dfe3e6', stroke: '#9aa0a5', strokeWidth: 2 });
        this._resetIco = new Konva.Text({ x: 426, y: 425, width: 48, text: '↻', fontSize: 22, fontStyle: 'bold', fill: '#2e7d32', align: 'center', listening: false });
        this._muteBtn = new Konva.Circle({ x: 570, y: 437, radius: 22, fill: '#dfe3e6', stroke: '#9aa0a5', strokeWidth: 2 });
        this._muteIco = new Konva.Text({ x: 542, y: 421, width: 56, text: '🔇', fontSize: 28, fill: '#b71c1c', align: 'center', listening: false });
        d.add(this._resetBtn, this._resetIco, this._muteBtn, this._muteIco);
    }

    // ═══════════════════════════════════════════════════════
    // 交互
    // ═══════════════════════════════════════════════════════

    _bindInteraction() {
        const part = (id, x, y, w, h, fn) => {
            const hit = this.addClickablePart(id, x, y, w, h, true);
            if (fn) hit.on('click tap', (e) => { e.cancelBubble = true; fn(); });
            return hit;
        };
        const key = (id, cx, cy, r, fn) => part(id, cx - r, cy - r, r * 2, r * 2, fn);

        // 页签（命中区贴合按钮大小）
        part('tab-status', 576, 18, 128, 44, () => this._openStatus());
        part('tab-menu', 716, 18, 128, 44, () => this._openMenu());
        // 左下电源开关
        part('power-switch', 8, 418, 92, 44, () => this._togglePower());
        // 左侧功能键（实测命中区与按钮对齐）
        part('btn-fire', 108, 72, 140, 54, () => this._openFireList());
        part('btn-prealarm', 108, 140, 140, 54, () => this._openPreAlarm());
        part('btn-fault', 108, 214, 140, 54, () => this._openFaultList());
        part('btn-disable', 108, 294, 140, 54, () => this._openDisconn());
        part('btn-shortcuts', 108, 372, 140, 54, () => this._tipShortcuts());
        // 底部
        part('btn-multiple', 295, 424, 70, 30, () => this._cycleAlarms());
        key('btn-reset', 450, 437, 24, () => this.reset());
        key('btn-mute', 570, 437, 24, () => this.mute());
        // 右侧
        key('key-esc', 830, 104, 24, () => this._esc());
        key('key-up', 749, 104, 20, () => this._move(-1));
        key('key-down', 749, 200, 20, () => this._move(1));
        key('key-left', 715, 152, 20, () => this._page(-1));
        key('key-right', 783, 152, 20, () => this._page(1));
        key('key-ok', 830, 200, 24, () => this._ok());
        // 数字键盘
        const kx = [725, 781, 837], ky = [272, 328, 384, 440];
        const keys = [['1', '2', '3'], ['4', '5', '6'], ['7', '8', '9'], ['←', '0', '↵']];
        keys.forEach((row, r) => row.forEach((k, c) => key(`key-${k}`, kx[c], ky[r], 22, () => this._key(k))));
    }

    // ═══════════════════════════════════════════════════════
    // 界面操作
    // ═══════════════════════════════════════════════════════

    _openStatus() { this.mode = 'status'; this.cursor = 0; this._lcdPage = 0; }
    _openMenu() { this.mode = 'menu'; this.cursor = this.menuIndex; this._lcdPage = 0; }
    _openFireList() { this.mode = 'fire'; this.cursor = 0; this._lcdPage = 0; }
    _openFaultList() { this.mode = 'fault'; this.cursor = 0; this._lcdPage = 0; }
    _openPreAlarm() { this.mode = 'fire'; this.cursor = 0; this._lcdPage = 0; }
    _openDisconn() { this.mode = 'disconn'; this.cursor = 0; this._lcdPage = 0; }
    _openHistory() { this.mode = 'history'; this._lcdPage = 0; }
    _tipShortcuts() { this.mode = 'normal'; }

    /** 拨动内部电源开关 */
    _togglePower() {
        this.powerSwitch = !this.powerSwitch;
        if (!this.powerSwitch) {
            // 断电：清除运行/自检，并清空全部状态（下次上电从初始状态开始）
            this._powered = false; this._running = false; this._selfTest = false;
            this._clearState();
            this._driveSounder();
        }
    }

    /** 清除控制器全部状态（断电时调用） */
    _clearState() {
        this.activeAlarms = [];
        this.faultAlarms = [];
        this.history = { fire: [], fault: [], isolation: [] };
        this.isolated = { nodes: new Set(), zones: new Set(), extDevice: false };
        this.nodes = {};
        this.zoneAlarm = { 1: false, 2: false, 3: false, 4: false };
        this.muted = false;
        this.mode = 'normal';
        this.cursor = 0;
        this.menuIndex = 0;
        this.disconnIndex = 0;
        this._lcdPage = 0;
        this._lcdScroll = 0;
        this.displayTest = false;
        this._alarmOut = false;
        this._mainPowerFail = false;
        this._nodesSeeded = false;
        this._runStart = 0;
    }

    _esc() {
        if (this.mode === 'menu' || this.mode === 'status') { this.mode = 'normal'; return; }
        this.mode = 'normal';
    }

    _move(dir) {
        if (this.mode === 'menu') {
            this.menuIndex = Math.max(0, Math.min(this.menus.length - 1, this.menuIndex + dir));
            this.cursor = this.menuIndex;
            this._lcdPage = Math.floor((2 + this.menuIndex) / LCD_PER_PAGE);
        } else if (this.mode === 'status' || this.mode === 'disconn' || this.mode === 'fire' || this.mode === 'fault') {
            const n = this._listLength();
            this.cursor = Math.max(0, Math.min(Math.max(0, n - 1), this.cursor + dir));
            if (this.mode === 'disconn') this.disconnIndex = this.cursor;
            this._lcdPage = Math.floor((2 + this.cursor) / LCD_PER_PAGE);
        } else {
            this._page(dir);   // normal / history：整页翻页
        }
    }

    /** 整页翻页（列表模式光标移到该页首项） */
    _page(dir) {
        const all = this._lcdAllLines();
        const pages = Math.max(1, Math.ceil(all.length / LCD_PER_PAGE));
        this._lcdPage = Math.max(0, Math.min(pages - 1, (this._lcdPage || 0) + dir));
        const firstItem = Math.max(0, this._lcdPage * LCD_PER_PAGE - 2);
        if (this.mode === 'menu') {
            this.menuIndex = Math.min(this.menus.length - 1, firstItem);
            this.cursor = this.menuIndex;
        } else if (this.mode === 'status' || this.mode === 'disconn' || this.mode === 'fire' || this.mode === 'fault') {
            const n = this._listLength();
            this.cursor = Math.max(0, Math.min(Math.max(0, n - 1), firstItem));
            if (this.mode === 'disconn') this.disconnIndex = this.cursor;
        }
    }

    _ok() {
        if (this.mode === 'menu') {
            switch (this.menuIndex) {
                case 0: this._openFaultList(); break;
                case 1: this._openFireList(); break;
                case 2: this._openDisconn(); break;
                case 3: this._openHistory(); break;
                default: break;
            }
        } else if (this.mode === 'disconn') {
            this._toggleIsolation(this.cursor);
        }
    }

    _key(k) {
        if (this.mode === 'menu' && /^[1-4]$/.test(k)) {
            this.menuIndex = parseInt(k) - 1; this.cursor = this.menuIndex; this._ok();
        }
    }

    _cycleAlarms() {
        if (this.activeAlarms.length <= 1) return;
        const first = this.activeAlarms.shift();
        this.activeAlarms.push(first);
    }

    _listLength() {
        if (this.mode === 'status') return 6;
        if (this.mode === 'disconn') return this._disconnItems().length;
        if (this.mode === 'fire') return this.activeAlarms.length;
        if (this.mode === 'fault') return this.faultAlarms.length;
        return 0;
    }

    /** 合并已知探测器与已上报节点 */
    _allDetectors() {
        const map = new Map();
        (this.knownNodes || []).forEach(n => map.set(n.addr, { addr: n.addr, loop: n.loop, zone: n.zone, type: n.type, label: n.label }));
        Object.keys(this.nodes).forEach(a => {
            const n = this.nodes[a];
            const cur = map.get(Number(a)) || { addr: Number(a) };
            map.set(Number(a), { addr: Number(a), loop: n.loop ?? cur.loop, zone: n.zone ?? cur.zone, type: n.type ?? cur.type, label: cur.label });
        });
        return [...map.values()].sort((a, b) => a.addr - b.addr);
    }

    /** 隔离菜单条目：外部报警设备 + 4 个分区 + 全部探测器 */
    _disconnItems() {
        const items = [{ kind: 'ext', label: 'External Alarm Device', iso: this.isolated.extDevice }];
        for (let z = 1; z <= 4; z++) {
            items.push({ kind: 'zone', zone: z, label: `ZONE${z} ${ZONE_DEVICE[z]}`, iso: this.isolated.zones.has(z) });
        }
        this._allDetectors().forEach(d => {
            items.push({
                kind: 'node', addr: d.addr, loop: d.loop, zone: d.zone, type: d.type,
                label: `LOOP${d.loop || '?'} #${d.addr} ${d.label || TYPE_EN[d.type] || ''}`,
                iso: this.isolated.nodes.has(d.addr),
            });
        });
        return items;
    }

    _toggleIsolation(index) {
        const items = this._disconnItems();
        const it = items[index];
        if (!it) return;
        if (it.kind === 'ext') {
            this.isolated.extDevice = !this.isolated.extDevice;
            this._logIsolation(`External Alarm Device ${this.isolated.extDevice ? 'isolated' : 'restored'}`);
            this._driveSounder();
            return;
        }
        if (it.kind === 'zone') {
            const z = it.zone;
            const on = !this.isolated.zones.has(z);
            if (on) {
                this.isolated.zones.add(z);
                // 屏蔽分区：清除区内全部设备的火警与故障指示
                this._clearNodeEvents(this._allDetectors().filter(d => d.zone === z).map(d => d.addr));
            } else {
                this.isolated.zones.delete(z);
            }
            this._logIsolation(`ZONE${z} ${ZONE_DEVICE[z]} ${on ? 'isolated' : 'restored'}`);
            this._broadcastIsolateZone(z, on);
            if (!on) this._allDetectors().filter(d => d.zone === z).forEach(d => { const n = this.nodes[d.addr]; if (n && n.alarm) this._onDetectorAlarm(d.addr, n); });
            return;
        }
        const addr = it.addr;
        const on = !this.isolated.nodes.has(addr);
        if (on) { this.isolated.nodes.add(addr); this._clearNodeEvents([addr]); }
        else { this.isolated.nodes.delete(addr); }
        this._sendIsolateCmd(addr, on);
        this._logIsolation(`${it.label} ${on ? 'isolated' : 'restored'}`);
        if (!on) { const n = this.nodes[addr]; if (n && n.alarm) this._onDetectorAlarm(addr, n); }
    }

    /** 清除指定节点（或分区内节点）的火警与故障指示（屏蔽时调用） */
    _clearNodeEvents(addrs) {
        const set = new Set(addrs);
        this.activeAlarms = this.activeAlarms.filter(a => !set.has(a.nodeAddr));
        this.faultAlarms = this.faultAlarms.filter(f => !(f.src && f.src.addr !== undefined && set.has(f.src.addr)));
        this._refreshZoneAlarm();
    }

    _broadcastIsolateZone(zone, on) {
        this._allDetectors().forEach(d => { if (d.zone === zone) this._sendIsolateCmd(d.addr, on); });
    }

    _sendIsolateCmd(addr, on) {
        const bus = this.sys && this.sys.canBus;
        if (!bus) return;
        try {
            bus.sendCommand(this.id, CAN_FUNC.FUNC_CONFIG, addr, [on ? 0x30 : 0x31]);
        } catch (e) { /* ignore */ }
    }

    _logIsolation(text) {
        this.history.isolation.unshift({ text, ts: Date.now() });
        if (this.history.isolation.length > 50) this.history.isolation.pop();
    }

    // ═══════════════════════════════════════════════════════
    // 报警逻辑
    // ═══════════════════════════════════════════════════════

    /** 收到探测器上报帧 */
    onCanReceive(frame) {
        if (!frame) return;
        if (!this._running) return;   // 自检完成前不处理报警
        let dec; try { dec = CANId.decode(frame.id); } catch (e) { return; }
        if (dec.funcCode !== CAN_FUNC.FUNC_REPORT) return;
        const addr = dec.nodeAddr;
        if (addr < 1 || addr > 15) return;
        const data = frame.data || [];
        const st = data[0] || 0;
        const loop = data[1] || 1, zone = data[2] || 1, tcode = data[3] || 0;
        const alarm = !!(st & 0x01), iso = !!(st & 0x02), fault = !!(st & 0x04);

        const node = this.nodes[addr] || (this.nodes[addr] = {});
        const prevAlarm = node.alarm;
        node.type = tcode; node.loop = loop; node.zone = zone;
        node.alarm = alarm; node.isolated = iso; node.fault = fault;
        node.lastSeen = Date.now();

        if (alarm && !prevAlarm) this._onDetectorAlarm(addr, node);
        // 已屏蔽（设备或所属分区隔离）的探测器：不产生火警，也不产生故障报警
        const isoDev = this.isolated.nodes.has(addr) || this.isolated.zones.has(node.zone);
        if (fault && !isoDev) this._addFault(`LOOP${loop} #${addr} ${TYPE_EN[tcode] || 'Device'} Fault`, { kind: 'fault', addr });
    }

    _onDetectorAlarm(addr, node) {
        const zone = node.zone || 1;
        // 隔离语义：设备隔离 或 所属分区隔离 → 不产生火警
        if (this.isolated.nodes.has(addr) || this.isolated.zones.has(zone)) {
            this._logIsolation(`Isolated ${TYPE_EN[node.type] || 'Device'} #${addr} triggered - alarm suppressed`);
            return;
        }
        const text = `LOOP${node.loop} ${ZONE_DEVICE_EN[zone] || ''} ${TYPE_EN[node.type] || ''} Alarm,${51000 + addr * 500}`;
        if (!this.activeAlarms.some(a => a.nodeAddr === addr)) {
            this.activeAlarms.unshift({ text, ts: Date.now(), nodeAddr: addr, zone });
            this.history.fire.unshift({ text, ts: Date.now() });
            if (this.history.fire.length > 50) this.history.fire.pop();
        }
        this.zoneAlarm[zone] = true;
        this.muted = false;
    }

    _clearNodeAlarm(addr) {
        this.activeAlarms = this.activeAlarms.filter(a => a.nodeAddr !== addr);
        this._refreshZoneAlarm();
    }

    _refreshZoneAlarm() {
        for (let z = 1; z <= 4; z++) this.zoneAlarm[z] = false;
        this.activeAlarms.forEach(a => { if (a.zone) this.zoneAlarm[a.zone] = true; });
    }

    _addFault(text, src) {
        if (!this.faultAlarms.some(f => f.text === text)) {
            this.faultAlarms.unshift({ text, ts: Date.now(), src });
            this.history.fault.unshift({ text, ts: Date.now() });
            if (this.history.fault.length > 50) this.history.fault.pop();
        }
    }
    _clearFault(text) { this.faultAlarms = this.faultAlarms.filter(f => f.text !== text); }

    /** 故障当前是否仍然存在（用于 RESET 判定） */
    _faultActive(f) {
        const src = f && f.src;
        if (!src) return false;
        if (src.kind === 'main' || src.kind === 'power') return this.powerSwitch && !this._mainOK;
        if (src.kind === 'bk') return this.powerSwitch && !this._bkOK;
        const n = this.nodes[src.addr];
        if (!n) return false;
        if (src.kind === 'fault') return !!n.fault;
        if (src.kind === 'comm') return !!n.offline;
        return false;
    }

    /**
     * RESET：仅清除「火警/故障已消失」的项。
     * 若报警源仍处于火警/故障条件，则保留指示（锁存），不因复位而消失。
     */
    reset() {
        this.activeAlarms = this.activeAlarms.filter(a => {
            const n = this.nodes[a.nodeAddr];
            return !!(n && n.alarm);       // 条件仍在 → 保留
        });
        this.faultAlarms = this.faultAlarms.filter(f => this._faultActive(f));
        this._refreshZoneAlarm();
        this.muted = false;
        this._driveSounder();
    }

    mute() { this.muted = true; this._driveSounder(); }

    /** 起动总线上的探测器节点（NMT START 广播） */
    startNodes() {        const bus = this.sys && this.sys.canBus;
        if (bus && typeof bus.sendNMT === 'function') {
            try { bus.sendNMT(this.id, NMT_CMD.START, 0); } catch (e) { /* ignore */ }
        }
    }

    /** 系统是否处于火警态（用于面板联动） */
    hasFire() { return this.activeAlarms.length > 0; }

    _driveSounder() {
        const s = this.sys && this.sys.comps && this.sys.comps[this.sounderId];
        const fire = this.activeAlarms.length > 0 && !this.isolated.extDevice;
        // 自检第三段：声光报警器触发一次（约 1.2s）
        const stPulse = this._selfTest && this._selfTestT >= 6 && this._selfTestT < 7.2;
        this._alarmOut = !!(stPulse || fire);   // 报警输出干接点状态
        if (!s || typeof s.setExternalAlarm !== 'function') return;
        if (stPulse) s.setExternalAlarm(true, false);
        else if (fire) s.setExternalAlarm(true, this.muted);
        else s.setExternalAlarm(false);
    }

    // ═══════════════════════════════════════════════════════
    // 主循环
    // ═══════════════════════════════════════════════════════

    tick(dt) {
        const d = dt || 0.05;
        this._acc += d * 1000;
        if (this._acc >= CAN_TICK_INTERVAL) {
            this._acc = 0;
            this._tick();
        }
        // 自检计时（分三段：左7灯 → 5带灯按钮 → 声光报警器，共约 7.2s）
        if (this._selfTest) {
            this._selfTestT = (Date.now() - this._selfTestStart) / 1000;
            if (this._selfTestT >= 7.2) {
                this._selfTest = false; this._running = true; this._runStart = Date.now();
                this.startNodes();   // 自检完成 → 启动 CAN 总线通信（NMT START 使各节点进入运行并上报）
            }
        }
        this._flash += d * 1000;
        if (this.displayTest) { this._testT -= d * 1000; if (this._testT <= 0) this.displayTest = false; }
        this._updateVisuals();
        this.markDirty();
        this._refreshIfDirty();
    }

    _tick() {
        const p = `${this.id}_wire_`;
        // 主/备电检测（220V 交流）：L/N 分别接到已合闸交流电源的正/负端
        this._mainOK = !this._mainPowerFail && this._acPresent('main');
        this._bkOK = this._acPresent('bk');
        // 初始化仅由内部电源开关决定：只需合上电源开关即开始初始化
        const wantOn = this.powerSwitch;
        if (wantOn && !this._powered) { this._powered = true; this._selfTest = true; this._selfTestT = 0; this._selfTestStart = Date.now(); }
        if (!wantOn) { this._powered = false; this._running = false; this._selfTest = false; }
        this.powerOn = this._powered;
        // 回路供电：仅当控制器内部电源合上时，总线（探测回路）才得电
        if (this.sys) this.sys._fireLoopPowered = this._powered;

        this.busConnected = (this.sys.isOnCanBus(`${p}can1p`) && this.sys.isOnCanBus(`${p}can1n`))
            || (this.sys.isOnCanBus(`${p}can2p`) && this.sys.isOnCanBus(`${p}can2n`));
        if (this.sys.canBus) {
            if (this._powered && this.busConnected && !this.commFault) this.sys.canBus.setNodeOnline(this.id);
            else this.sys.canBus.resetNodeOnline(this.id);
        }
        // 主电、备电、节点通信检测（异常触发故障报警）
        if (this._running) {
            if (this.powerSwitch && !this._mainOK) this._addFault('FAS Main Power Failure', { kind: 'main' });
            if (this.powerSwitch && !this._bkOK) this._addFault('FAS Backup Power Failure', { kind: 'bk' });
        }
        // 运行期间周期性广播 NMT START：断线重接的节点可自动重新进入运行并恢复上报
        const nowNmt = Date.now();
        if (this._running && (!this._lastNmt || nowNmt - this._lastNmt > 2000)) {
            this._lastNmt = nowNmt;
            this.startNodes();
        }
        // 运行后按已知节点固定建立节点表（火警系统节点数固定，不动态增减）
        if (this._running && !this._nodesSeeded) this._seedNodes();
        const now = Date.now();
        Object.keys(this.nodes).forEach(addr => {
            const n = this.nodes[addr];
            if (!this._running) { n.offline = false; return; }
            const grace = now - this._runStart > 3000;   // 运行后 3s 宽限，等待首帧上报
            n.offline = n.lastSeen ? (now - n.lastSeen > 3000) : grace;
            const text = `LOOP${n.loop} #${addr} Comm Fault`;
            const iso = this.isolated.nodes.has(Number(addr)) || this.isolated.zones.has(n.zone);
            // 通信故障：断线时产生；重新接线后自动恢复（自动清除）；已屏蔽节点不报
            if (n.offline && !iso) this._addFault(text, { kind: 'comm', addr: Number(addr) });
            else if (!n.offline) this._clearFault(text);
        });
        this._driveSounder();
    }

    /** 按已知探测器清单固定建立节点表（未上报时 lastSeen=0） */
    _seedNodes() {
        this._nodesSeeded = true;
        (this.knownNodes || []).forEach(d => {
            if (!this.nodes[d.addr]) {
                this.nodes[d.addr] = { type: d.type, loop: d.loop, zone: d.zone, alarm: false, isolated: false, fault: false, lastSeen: 0, offline: true };
            }
        });
    }

    /** 判断某路交流输入是否带电（L/N 接到已合闸交流电源的正/负端） */
    _acPresent(prefix) {
        const L = `${this.id}_wire_${prefix}L`;
        const N = `${this.id}_wire_${prefix}N`;
        const comps = this.sys && this.sys.comps;
        if (!comps) return false;
        for (const c of Object.values(comps)) {
            if (!c || c.type !== 'ac_source' || !c.isOn) continue;
            try {
                if (this.sys.isPortConnected(L, `${c.id}_wire_p`) && this.sys.isPortConnected(N, `${c.id}_wire_n`)) return true;
            } catch (e) { /* ignore */ }
        }
        return false;
    }

    _updateVisuals() {
        const test = this.displayTest;
        const anyFire = this.activeAlarms.length > 0;
        const anyFault = this.faultAlarms.length > 0;
        const anyIso = this.isolated.nodes.size + this.isolated.zones.size + (this.isolated.extDevice ? 1 : 0) > 0;
        // 自检分三段（不同时动作）：左 7 个指示灯 → 5 个带灯按钮 → 声光报警器
        const stT = this._selfTestT;
        const inSelf = this._selfTest;
        const stLamps = inSelf && stT < 3 && (Math.floor(stT / 0.5) % 2 === 0);
        const stButtons = inSelf && stT >= 3 && stT < 6 && (Math.floor((stT - 3) / 0.5) % 2 === 0);

        const setLamp = (k, on, force) => {
            const l = this._lamps[k];
            if (l) l.node.fill((force || on) ? l.color : '#2b2f33');
        };
        setLamp('power', inSelf ? stLamps : this._powered, test);
        setLamp('sysfault', inSelf ? stLamps : (anyFault || (!this._powered && this.powerSwitch)), test);
        setLamp('test', inSelf ? stLamps : false, test);
        setLamp('warning', inSelf ? stLamps : anyFault, test);
        setLamp('zone', inSelf ? stLamps : anyFire, test);
        setLamp('alarmdev', inSelf ? stLamps : (anyFire && !this.isolated.extDevice), test);
        setLamp('delayoff', inSelf ? stLamps : false, test);

        // 电源开关外观
        if (this._pwrKnob) {
            this._pwrKnob.x(this.powerSwitch ? this._pwrOnX : this._pwrOffX);
            this._pwrKnob.fill(this.powerSwitch ? '#25d425' : '#8f959b');
        }
        if (this._pwrText) { this._pwrText.text(this.powerSwitch ? 'ON' : 'OFF'); this._pwrText.fill(this.powerSwitch ? '#8aff8a' : '#ff8a80'); }

        this._updateStateButtons(anyFire, anyFault, anyIso, test, stButtons);
        // 未上电 → LCD 黑屏（遮罩盖住蓝色屏）
        if (this._lcdOverlay) this._lcdOverlay.visible(!this._powered);
        this._lcdText.text(this._buildLcd());
    }

    /**
     * 5 个带灯功能键外观：
     *   初始 —— 黑字 + 白底图标；
     *   自检 —— 5 键以 1s 周期闪烁 3 次；
     *   FIRE/Fault 触发 —— 亮红/亮黄粗体 + 外框加粗，同步闪烁；消音后停闪常亮；
     *   Disablements —— 只要有设备被隔离，文字与标记亮红粗体（不闪烁）。
     */
    _updateStateButtons(anyFire, anyFault, anyIso, test, stOn) {
        const blink = Math.floor(Date.now() / 350) % 2 === 0;
        const reset = (btn) => {
            if (!btn) return;
            btn.textNode.fill('#222222'); btn.textNode.strokeWidth(0);
            btn.ring.stroke('#5c6167'); btn.ring.strokeWidth(1.5);
            if (btn.glyph.fill) btn.glyph.fill('#546e7a');
            if (btn.glyph.stroke) btn.glyph.stroke('#546e7a');
        };
        const lit = (btn, color, on) => {
            if (!btn) return;
            const c = on ? color : '#3a3a3a';
            btn.textNode.fill(c);
            btn.textNode.stroke(color); btn.textNode.strokeWidth(on ? 0.7 : 0);
            btn.ring.stroke(color); btn.ring.strokeWidth(on ? 4 : 1.5);
            if (btn.glyph.fill) btn.glyph.fill(c);
            if (btn.glyph.stroke) btn.glyph.stroke(c);
        };

        if (this._selfTest) {
            const set = (btn, color) => { if (stOn) lit(btn, color, true); else reset(btn); };
            set(this._fireBtn, '#ff1a1a');
            set(this._preBtn, '#f2f4f6');
            set(this._faultBtn, '#ffd400');
            set(this._disableBtn, '#ff1a1a');
            set(this._shortBtn, '#f2f4f6');
            return;
        }
        if (test) {
            lit(this._fireBtn, '#ff1a1a', true);
            lit(this._preBtn, '#f2f4f6', true);
            lit(this._faultBtn, '#ffd400', true);
            lit(this._disableBtn, '#ff1a1a', true);
            lit(this._shortBtn, '#f2f4f6', true);
            return;
        }
        reset(this._preBtn); reset(this._shortBtn);
        if (anyFire) lit(this._fireBtn, '#ff1a1a', this.muted ? true : blink);
        else reset(this._fireBtn);
        if (anyFault) lit(this._faultBtn, '#ffd400', this.muted ? true : blink);
        else reset(this._faultBtn);
        if (anyIso) lit(this._disableBtn, '#ff1a1a', true);
        else reset(this._disableBtn);
    }

    /** 按当前模式生成 LCD 全部行（数组） */
    _lcdAllLines() {
        const pad = (s, n) => (s + ' '.repeat(n)).slice(0, n);
        const time = (ts) => {
            const d = new Date(ts || Date.now());
            const z = (x) => String(x).padStart(2, '0');
            return `${z(d.getHours())}:${z(d.getMinutes())}:${z(d.getSeconds())}`;
        };
        // 报警行：标签 + 文本 + 右对齐时间（文本列宽固定，避免与时间粘连）
        const COLS = 44;
        const line = (tag, text, ts) => {
            const t = time(ts);
            const avail = Math.max(4, COLS - tag.length - t.length);
            const body = text.length > avail ? text.slice(0, avail) : text.padEnd(avail, ' ');
            return tag + body + t;
        };
        if (this.mode === 'menu') {
            const lines = ['MAIN MENU', ''];
            this.menus.forEach((m, i) => lines.push(`${i === this.menuIndex ? '>' : ' '}  ${i + 1}. ${m}`));
            lines.push('', 'OK=enter   ESC=back');
            return lines;
        }
        if (this.mode === 'status') {
            const online = Object.values(this.nodes).filter(n => !n.offline && n.lastSeen).length;
            const items = [
                `System        : ${this.activeAlarms.length ? 'FIRE ALARM' : (this.faultAlarms.length ? 'FAULT' : 'NORMAL')}`,
                `Fire alarms   : ${this.activeAlarms.length}`,
                `Faults        : ${this.faultAlarms.length}`,
                `Isolations    : ${this.isolated.nodes.size + this.isolated.zones.size + (this.isolated.extDevice ? 1 : 0)}`,
                `Loop nodes    : ${online}/${this._allDetectors().length} online`,
                `Power         : ${this._mainOK ? 'Mains OK' : (this._bkOK ? 'On Backup' : 'POWER FAIL')}`,
            ];
            return ['SYSTEM STATUS', ''].concat(items.map((t, i) => `${i === this.cursor ? '>' : ' '} ${t}`));
        }
        if (this.mode === 'disconn') {
            const lines = ['DISCONNECTIONS (isolate)', ''];
            const items = this._disconnItems();
            items.forEach((it, i) => lines.push(`${i === this.cursor ? '>' : ' '} ${it.iso ? '[ISO]' : '[ - ]'} ${it.label}`));
            lines.push('', 'OK=toggle isolation   ESC=back');
            return lines;
        }
        if (this.mode === 'fire') {
            return ['FIRE ALARMS', ''].concat(this.activeAlarms.map(a => line('FIRE   ', a.text, a.ts)))
                .concat(this.activeAlarms.length ? [] : ['  (none)']);
        }
        if (this.mode === 'fault') {
            return ['FAULT ALARMS', ''].concat(this.faultAlarms.map(f => line('FAULT  ', f.text, f.ts)))
                .concat(this.faultAlarms.length ? [] : ['  (none)']);
        }
        if (this.mode === 'history') {
            const lines = ['HISTORY', ''];
            lines.push(`Fire events      : ${this.history.fire.length}`);
            lines.push(`Fault events     : ${this.history.fault.length}`);
            lines.push(`Isolation events : ${this.history.isolation.length}`);
            lines.push('');
            const last = this.history.isolation[0];
            if (last) lines.push(`Last: ${last.text}`);
            lines.push('', 'ESC=back');
            return lines;
        }
        // normal：显示当前报警/故障，或系统正常
        const lines = [];
        this.activeAlarms.forEach(a => lines.push(line('FIRE   ', a.text, a.ts)));
        this.faultAlarms.forEach(f => lines.push(line('FAULT  ', f.text, f.ts)));
        if (!lines.length) {
            const d = new Date();
            const z = (x) => String(x).padStart(2, '0');
            if (this._selfTest) lines.push('*** SELF TEST ***');
            else if (!this._powered) lines.push('POWER OFF');
            else lines.push('SYSTEM NORMAL');
            lines.push('');
            lines.push(`Date ${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}   Time ${z(d.getHours())}:${z(d.getMinutes())}:${z(d.getSeconds())}`);
            lines.push(`Nodes ${Object.keys(this.nodes).length} on CAN loops`);
        }
        return lines;
    }

    /** LCD 显示（按行分页，光标行自动滚动保持可见） */
    _buildLcd() {
        // 未上电：黑屏
        if (!this._powered) return '';
        // 初始化中：显示初始化标志
        if (this._selfTest) {
            const dots = '.'.repeat(1 + (Math.floor(this._selfTestT * 2) % 3));
            return `*** INITIALIZING ***\n\n   Fire Alarm System\n   Self test${dots}\n\n   Please wait ...`;
        }
        const all = this._lcdAllLines();
        const pages = Math.max(1, Math.ceil(all.length / LCD_PER_PAGE));
        this._lcdPage = Math.max(0, Math.min(pages - 1, this._lcdPage || 0));
        const page = this._lcdPage;
        const content = all.slice(page * LCD_PER_PAGE, page * LCD_PER_PAGE + LCD_PER_PAGE);
        if (pages > 1) content.push(`◀ ▶   Page ${page + 1}/${pages}`);
        return content.join('\n');
    }

    // ═══════════════════════════════════════════════════════
    // 配置
    // ═══════════════════════════════════════════════════════

    getConfigFields() {
        return [
            { label: '器件名称 (ID)', key: 'id', type: 'text' },
            { label: '名称', key: 'label', type: 'text' },
            { label: '声光报警器 ID', key: 'sounderId', type: 'text' },
            { label: '消防控制面板 ID', key: 'panelId', type: 'text' },
        ];
    }

    onConfigUpdate(cfg) {
        if (cfg.id) this.id = cfg.id;
        if (cfg.label !== undefined) this.label = cfg.label;
        if (cfg.sounderId !== undefined) this.sounderId = cfg.sounderId;
        if (cfg.panelId !== undefined) this.panelId = cfg.panelId;
        this.config = { ...this.config, ...cfg };
    }

    destroy() { super.destroy?.(); }
}

export default FireAlarmController;
