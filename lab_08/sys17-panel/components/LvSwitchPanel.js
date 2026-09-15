import { BaseComponent } from './BaseComponent.js';

/**
 * LvSwitchPanel 低压配电板组件图
 *
 * 从左到右 8 个屏：
 *   左组合起动屏 / 左动力负载屏 / 1#发电机控制屏 / 2#发电机控制屏 /
 *   并车屏 / 3#发电机控制屏 / 右动力负载屏 / 右组合起动屏
 *
 *   - 组合起动屏：上下分 5 栏，每栏一路电动机控制回路
 *                 （塑壳 MCB + 起动/停止按钮 + 运行指示灯 + 电动机）
 *   - 动力负载屏：整屏 5 行，每行 2 个塑壳 MCB（样式参照 DistributionBox 低压配电箱）
 *   - 发电机控制屏 / 并车屏：先参照 HvSwitchPanel 的发电机柜 / 并车柜（后续再改）
 */

const CAB_W = 225;
const CAB_H = 813;
const UPPER_H = 325;
const MID_H = 162;
const BODY_TOP = 44;             // 柜内内容起始 y（标题以下）
const BODY_BOT = CAB_H - 8;      // 柜内内容结束 y
const BUS_Y = UPPER_H + MID_H + 26;   // 下部单线图主汇流排 y（贯穿全宽）

const CABINETS = [
    { id: 'comboL', label: '左组合起动屏', type: 'combo', base: 1 },
    { id: 'loadL',  label: '左动力负载屏', type: 'load',  base: 1 },
    { id: 'gen1',   label: '1#发电机控制屏', type: 'gen', tag: '1#G' },
    { id: 'gen2',   label: '2#发电机控制屏', type: 'gen', tag: '2#G' },
    { id: 'sync',   label: '并车屏',       type: 'sync' },
    { id: 'gen3',   label: '3#发电机控制屏', type: 'gen', tag: '3#G' },
    { id: 'loadR',  label: '右动力负载屏', type: 'load',  base: 11 },
    { id: 'comboR', label: '右组合起动屏', type: 'combo', base: 6 },
];

const RED = '#d02020';
const OFF = '#7a8494';
const BUS_LIVE = '#ff2020';   // 主汇流排带电（亮红）
const BUS_DEAD = '#00b4ff';   // 主汇流排失电（亮蓝）

// 组合起动屏：电动机名称 + 铭牌标签（可多个，各有底色）；其余行仍为 QMxx 位号
const TAG_GREEN = { bg: '#008a00', stroke: '#004d00', fg: '#ffffff' };
const TAG_RED = { bg: '#c00000', stroke: '#5a0000', fg: '#ffffff' };
const TAG_YELLOW = { bg: '#ffcc00', stroke: '#9a7a00', fg: '#1a252f' };
const TAG_BLUE = { bg: '#1565c0', stroke: '#0a2a5a', fg: '#ffffff' };
const COMBO_NAME = {
    'comboL-0': { name: '1#主海水泵', tags: [{ text: 'SQ4', ...TAG_GREEN }] },
    'comboR-0': { name: '2#主海水泵', tags: [{ text: 'SQ4', ...TAG_GREEN }] },
    'comboL-1': { name: '1#高温淡水泵', tags: [{ text: 'SQ3', ...TAG_GREEN }] },
    'comboR-1': { name: '2#高温淡水泵', tags: [{ text: 'SQ3', ...TAG_GREEN }] },
    'comboL-2': { name: '1#主滑油泵', tags: [{ text: 'SQ2', ...TAG_GREEN }, { text: 'ESS-1P', ...TAG_RED }] },
    'comboR-2': { name: '2#主滑油泵', tags: [{ text: 'SQ2', ...TAG_GREEN }, { text: 'ESS-1P', ...TAG_RED }] },
    'comboL-3': { name: '1#燃油供给泵', tags: [{ text: 'SQ1', ...TAG_GREEN }, { text: 'ESS-1P', ...TAG_RED }] },
    'comboR-3': { name: '2#燃油供给泵', tags: [{ text: 'SQ1', ...TAG_GREEN }, { text: 'ESS-1P', ...TAG_RED }] },
    'comboL-4': { name: '1#机舱风机', tags: [{ text: 'ESS-1F', ...TAG_RED }] },
    'comboR-4': { name: '2#机舱风机', tags: [{ text: 'ESS-1F', ...TAG_RED }] },
};

// SQ 标签对应的自动起动延时（汇流排恢复供电后）
const SQ_DELAY = { SQ1: 1, SQ2: 5, SQ3: 10, SQ4: 15 };
const STABLE_DELAY = 60;   // 汇流排持续带电 ≥180s（3min）视为稳定供电
function comboAutoDelay(info) {
    if (!info || !info.tags) return null;
    for (const t of info.tags) if (SQ_DELAY[t.text] != null) return SQ_DELAY[t.text];
    return null;
}

// 动力负载屏各路名称与铭牌（键为 MCB 序号 1~20）
const LOAD_NAME = {
    1:  { name: '1号主空压机', tags: [{ text: 'PT-1', ...TAG_YELLOW }] },
    2:  { name: '1#锅炉给水泵' },
    3:  { name: '1#舵机' },
    4:  { name: '1#鼓风机', tags: [{ text: 'ESS-1F', ...TAG_RED }, { text: 'HEF-1', ...TAG_BLUE }] },
    5:  { name: '1#日用变压器' },
    6:  { name: '1#动力配电箱', tags: [{ text: 'PT-2', ...TAG_YELLOW }] },
    7:  { name: '1#厨房变压器', tags: [{ text: 'PT-1', ...TAG_YELLOW }] },
    8:  { name: '1#锚绞机', tags: [{ text: 'PT-2', ...TAG_YELLOW }] },
    9:  { name: '测试负载1（400KW）' },
    10: { name: '测试负载2（600KW）' },
    11: { name: '2号主空压机', tags: [{ text: 'PT-1', ...TAG_YELLOW }] },
    12: { name: '2#锅炉给水泵' },
    13: { name: '2#舵机' },
    14: { name: '2#鼓风机', tags: [{ text: 'ESS-1F', ...TAG_RED }, { text: 'HEF-1', ...TAG_BLUE }] },
    15: { name: '2#日用变压器' },
    16: { name: '2#动力配电箱', tags: [{ text: 'PT-2', ...TAG_YELLOW }] },
    17: { name: '2#厨房变压器', tags: [{ text: 'PT-1', ...TAG_YELLOW }] },
    18: { name: '2#锚绞机', tags: [{ text: 'PT-2', ...TAG_YELLOW }] },
    19: { name: '应急配电板' },
    20: { name: '岸电开关' },
};

// 原动机（柴油机）保护：动作后柴油机组立即停机
const PRIME_FAULT = {
    temp: '原动机冷却水温高',
    lo:   '原动机滑油压力低',
    over: '原动机超速',
};

export class LvSwitchPanel extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);
        this.width  = CAB_W * CABINETS.length;
        this.height = CAB_H;
        this.type  = 'lv_switch_panel';
        this.cache = 'fixed';
        this._initGroups();
        this._initState();
        this._init();
    }

    _initState() {
        this._mcbState = {};         // 各塑壳 MCB 合/分
        this._mcbNodes = {};         // MCB 手柄节点 { handle, onY, offY }
        this._mcbTrip = {};          // MCB 分励/保护脱扣（手柄停在 TRIP 位）
        this._motorRun = {};         // 组合屏各栏电动机运行
        this._motorLed = {};         // 组合屏运行指示灯（旧）
        this._comboLed = {};         // 组合屏指示灯透镜 [电源,备用,运行,故障]
        this._comboSel = {};         // 组合屏转换开关 { group, angs, i, bodyNode, baseColor }
        this._fault = {};            // 组合屏故障锁存（未复位）
        this._autoT = {};            // 组合屏自动起动延时计时
        this._sqT = {};              // 组合屏 SQ 顺序起动计时（null=未装载）
        this._busWasLive = false;    // 汇流排上一帧带电状态（用于检测恢复供电）
        this._busLiveT = 0;          // 汇流排持续带电时间（s）
        this._genRun = {};           // 发电机运行
        this._genCB = {};            // 发电机断路器合闸
        this._genMode = { gen1: 'remote', gen2: 'remote', gen3: 'remote' };   // 机旁(local)/遥控(remote)，默认遥控
        this._genFault = { gen1: false, gen2: false, gen3: false };           // 发电机组故障
        this._ppu = {};              // 各发电机屏 PPU 液晶显示节点
        this._genVal = {};           // 各机组实时电气量 {U,f,I,P}
        this._genT = {};             // 各机组起动后计时（0~5s 建压/建频）
        this._emgT = 0;              // 应急配电板波动负载计时
        this._genTrip = {};          // 主开关故障跳闸锁存（故障复位灯）
        this._genSync = {};          // 自动同步流程 {phase:'sync'|'share', t}
        this._genSplit = {};         // 自动解列流程 {phase:'transfer'|'delay', t}
        this._genP = {};             // 各机组当前出力（kW）
        this._gov = {};              // 各机组调速开关整定值（Hz，每次转动 ±0.1）
        this._govAnim = {};          // 调速开关手柄回弹动画 {dir, t}
        this._govNodes = {};         // 调速开关手柄节点
        this._testT = 0;             // 指示灯/蜂鸣器测试计时
        this._alarmSilenced = false; // 报警消音
        this._alarmAck = false;      // 报警确认
        this._faultWas = false;      // 上一帧是否有故障（用于新故障重新鸣响）
        this._alarms = { ins: false, trip: false, short: false, startfail: false };   // 报警条件（4 种报警灯）
        this._alarmLatched = { ins: false, trip: false, short: false, startfail: false };  // 报警锁存（故障消失 + 报警确认才复位）
        this._alarmWas = { ins: false, trip: false, short: false, startfail: false };      // 报警上升沿检测
        this._autoFlow = null;       // 自动模式流程 {stage, t, target}
        this._splitWaitId = null;    // 自动解列等待跳闸的机组
        this._splitStopping = null;  // 自动解列跳闸后的停机延时 {id, t}
        this._groundPhase = null;    // 接地相（'1'/'2'/'3' 或 null）
        this._lampTestT = 0;         // 地气灯测试计时
        this._insul = 5.0;           // 动力电网绝缘阻值（MΩ，实测值）
        this._insulSet = 5.0;        // 手动设定的绝缘阻值（默认 5MΩ）
        this._blinkT = 0;            // 报警灯闪烁计时
        this._genUVF = {};           // 失压故障注入（测试失压保护）
        this._genClass1 = {};        // 机组 I 级故障（自动模式：先并备用机，再解列故障机）
        this._primeFault = {};       // 原动机保护动作（冷却水温高 / 滑油压力低 / 超速 → 立即停机）
        this._swapOut = null;        // 换机第二步：待解列的故障机 {id, target}
        this._autoBlocked = false;   // 自动模式阻塞（汇流排短路）
        this._genCBWas = {};         // 主开关上一帧状态（跳闸沿检测）
        this._shuntLive = {};        // 应急切断分励脱扣器带电状态（由“重要配电装置”推送）
        this._shoreLower = false;    // 岸电开关下端带电（由“重要配电装置”岸电箱推送）
        this._shoreNode = null;      // 岸电下端带电指示（动态节点，惰性创建）
        this._genShort = {};         // 短路电流注入倍数（测试短路保护）
        this._genProt = {};          // 各机组保护动作记录
        this._protT = {};            // 保护延时计时
        this._olStage = {};          // 过载分级卸载阶段（0 一级前 / 1 二级前 / 2 跳闸前）
        this._olT = {};              // 过载分级计时
        this._groundFault = { active: false, r: 0, c: 0, no: 0, phase: null };  // 左动力负载屏随机接地故障
        this._genAuxLed = {};        // 发电机屏辅助带灯按钮指示灯
        this._genCircle = {};
        this._genBlade = {};
        this._genGeom = {};
        this._genLed = {};
        this._genBusWire = {};       // 开关出线（汇流排 → 断路器上触点）
        this._genOutWire = {};       // 发电机出线（发电机 → 断路器下触点）
        this._synNeedle = null;
        this._syncAngle = 0;
        this._syncPos = {};
        this._syncKnobs = {};
    }

    _init() {
        // 顺序：柜体框架 → 贯穿全宽的主汇流排 → 各屏内容（汇流排位于屏内元件之后方）
        CABINETS.forEach((cab, i) => this._drawFrame(cab, i));
        this._drawMainBus();
        CABINETS.forEach((cab, i) => this._drawContent(cab, i));
        this._applyComboDefaults();
        this._applyLoadDefaults();
        this._bindInteractions();
        this._refresh();
    }

    /** 动力负载屏默认：除岸电开关（QF20）与两路测试负载（QF9/QF10）外全部合闸 */
    _applyLoadDefaults() {
        CABINETS.forEach(cab => {
            if (cab.type !== 'load') return;
            for (let r = 0; r < 5; r++) {
                for (let c = 0; c < 2; c++) {
                    const no = cab.base + r * 2 + c;
                    this._mcbState[`ld-${cab.id}-${r}-${c}`] = !(no === 20 || no === 9 || no === 10);
                }
            }
        });
    }

    /** 组合起动屏默认状态：电源开关全合闸；左屏模式=自动、右屏模式=手动 */
    _applyComboDefaults() {
        CABINETS.forEach(cab => {
            if (cab.type !== 'combo') return;
            for (let i = 0; i < 5; i++) {
                this._mcbState[`cm-${cab.id}-${i}`] = true;
                const sel = this._comboSel[`${cab.id}-${i}-mode`];
                if (sel) {
                    sel.i = (cab.id === 'comboL') ? 1 : 0;
                    sel.group.rotation(sel.angs[sel.i]);
                }
            }
        });
    }

    // ── 柜体框架 ──
    _drawFrame(cab, idx) {
        const s = this._staticGroup;
        const x0 = idx * CAB_W;
        s.add(new Konva.Rect({
            x: x0 + 2, y: 2, width: CAB_W - 4, height: CAB_H - 4,
            fill: '#e8ecef', stroke: '#4a5a66', strokeWidth: 1.5, cornerRadius: 2,
        }));
        s.add(new Konva.Text({
            x: x0, y: 12, width: CAB_W, align: 'center',
            text: cab.label, fontSize: 15, fontStyle: 'bold', fill: '#006400', listening: false,
        }));
        s.add(new Konva.Line({ points: [x0 + 4, 38, x0 + CAB_W - 4, 38], stroke: '#7a8494', strokeWidth: 1 }));
        if (idx > 0) {
            s.add(new Konva.Line({ points: [x0, 2, x0, CAB_H - 2], stroke: '#2c3a45', strokeWidth: 3 }));
        }
    }

    // ── 主汇流排：一根线从左贯穿到右（沿用发电机控制屏汇流排的高度/样式）──
    _drawMainBus() {
        this._busLine = new Konva.Line({
            points: [6, BUS_Y, this.width - 6, BUS_Y],
            stroke: BUS_DEAD, strokeWidth: 4, lineCap: 'round',
        });
        this._staticGroup.add(this._busLine);
    }

    // ── 各屏内容 ──
    _drawContent(cab, idx) {
        const x0 = idx * CAB_W;
        if (cab.type === 'combo') this._drawCombo(cab, x0);
        else if (cab.type === 'load') this._drawLoad(cab, x0);
        else if (cab.type === 'gen') this._drawGen(cab, x0);
        else if (cab.type === 'sync') this._drawSync(cab, x0);
    }

    // ── 塑壳 MCB（与 DistributionBox 低压配电箱中的塑壳开关画法完全一致）──
    _drawMCB(cx, cy, w, h, id, label, opts) {
        const s = this._staticGroup;
        const x = cx - w / 2, y = cy - h / 2;
        const inY = y + 6, outY = y + h - 8;
        const midY = (inY + outY) / 2;
        const showMarks = w >= 68;      // 尺寸足够时才画 ON/TRIP/OFF 竖排标注

        // 白色塑壳壳体
        s.add(new Konva.Rect({ x, y, width: w, height: h, fill: '#f0f1f4', stroke: '#a0a8b8', strokeWidth: 1.5, cornerRadius: 3 }));
        s.add(new Konva.Rect({ x: x + 2, y: y + 2, width: w - 4, height: Math.max(4, h * 0.05), fill: 'rgba(255,255,255,0.55)', cornerRadius: [3, 3, 0, 0], listening: false }));
        s.add(new Konva.Rect({ x, y, width: 2.5, height: h, fill: '#c8ccd4', cornerRadius: [3, 0, 0, 3], listening: false }));

        // 手柄 / 滑槽几何（比例与 DistributionBox 相同）
        const barH = Math.min(h * 0.34, Math.round(h * 0.34));
        const baseBarW = Math.max(14, Math.min(26, Math.round(w * 0.30)));
        const extra = (opts && opts.handleExtra) || 0;   // 中间开关（手柄）额外加宽，两侧空隙随之减小
        const on = -h * 0.22, off = h * 0.16;
        const slotW = baseBarW + 10;
        const barW = Math.min(slotW, baseBarW + extra);
        const slotTop = midY + on - barH / 2 - 4;
        const slotBot = midY + off + barH / 2 + 4;

        // 中央竖滑槽 + 内壁阴影
        s.add(new Konva.Rect({ x: cx - slotW / 2, y: slotTop, width: slotW, height: slotBot - slotTop, fill: '#cfd3da', stroke: '#9aa2ac', strokeWidth: 1, cornerRadius: 2, listening: false }));
        s.add(new Konva.Rect({ x: cx - slotW / 2 + 1, y: slotTop + 1, width: slotW - 2, height: (slotBot - slotTop) * 0.5, fill: 'rgba(0,0,0,0.10)', cornerRadius: [2, 2, 0, 0], listening: false }));
        s.add(new Konva.Rect({ x: cx - slotW / 2 + 1, y: slotBot - (slotBot - slotTop) * 0.4, width: slotW - 2, height: (slotBot - slotTop) * 0.4 - 1, fill: 'rgba(255,255,255,0.35)', cornerRadius: [0, 0, 2, 2], listening: false }));

        // ON / TRIP / OFF 竖排标注
        if (showMarks) {
            [{ o: on, t: 'ON', c: '#20a030' }, { o: 0, t: 'TRIP', c: '#e08020' }, { o: off, t: 'OFF', c: '#c03020' }].forEach(m => {
                s.add(new Konva.Text({ x: x + 3, y: midY + m.o - 5, text: m.t, fontSize: 8, fontStyle: 'bold', fill: m.c, listening: false }));
            });
        }

        // 顶部 / 底部端子螺丝
        [inY, outY].forEach(ty => {
            [-1, 0, 1].forEach(ph => this._drawScrew(cx + ph * (w / 3), ty));
        });

        // 位号
        const lblSize = (opts && opts.labelSize) || 12;
        const lblDy = (opts && opts.labelDy) || 2;
        s.add(new Konva.Text({ x: cx - w / 2, y: y + h + lblDy, width: w, text: label, fontSize: lblSize, fontStyle: 'bold', fill: '#3a3e44', align: 'center', listening: false }));

        // 手柄（动态，小长方体 3D）
        const group = this._createHandle(cx, midY + off, barW, barH);
        this._mcbState[id] = false;
        this._mcbNodes[id] = { group, midY, on, off };
    }

    /** 接线端子螺丝（与 DistributionBox 一致） */
    _drawScrew(x, y) {
        const r = 3.5, s = this._staticGroup;
        s.add(new Konva.Circle({
            x, y, radius: r,
            fillLinearGradientStartPoint: { x: -r, y: -r },
            fillLinearGradientEndPoint: { x: r, y: r },
            fillLinearGradientColorStops: [0, '#8a7a30', 0.4, '#c8a848', 0.7, '#d8b858', 1, '#7a6a28'],
            stroke: '#5a4a18', strokeWidth: 0.6, listening: false,
        }));
        s.add(new Konva.Line({ points: [x - r * 0.55, y, x + r * 0.55, y], stroke: '#3a2a08', strokeWidth: 0.7, listening: false }));
        s.add(new Konva.Line({ points: [x, y - r * 0.55, x, y + r * 0.55], stroke: '#3a2a08', strokeWidth: 0.7, listening: false }));
    }

    /** 塑壳开关手柄（小长方体 3D，与 DistributionBox 一致） */
    _createHandle(cx, cy, bw, bh) {
        const dx = 6, dy = -6;   // 斜等测方向
        const g = new Konva.Group({ x: cx, y: cy });
        // 面板投影阴影
        g.add(new Konva.Rect({ x: -bw / 2 + 2, y: -bh / 2 + 3, width: bw, height: bh, fill: 'rgba(0,0,0,0.16)', cornerRadius: 3, listening: false }));
        // 顶部厚度面（平行四边形）
        g.add(new Konva.Line({
            points: [-bw / 2, -bh / 2, bw / 2, -bh / 2, bw / 2 + dx * 0.22, -bh / 2 + dy * 0.22, -bw / 2 + dx * 0.22, -bh / 2 + dy * 0.22],
            closed: true, fill: '#14385e', listening: false,
        }));
        // 正面渐变主体
        g.add(new Konva.Rect({
            x: -bw / 2, y: -bh / 2, width: bw, height: bh,
            fillLinearGradientStartPoint: { x: 0, y: -bh / 2 },
            fillLinearGradientEndPoint: { x: 0, y: bh / 2 },
            fillLinearGradientColorStops: [0, '#3890e0', 0.3, '#2878c8', 0.7, '#1a60a8', 1, '#1848a0'],
            stroke: '#1040a0', strokeWidth: 1, cornerRadius: 3,
        }));
        // 顶部高光
        g.add(new Konva.Rect({ x: -bw / 2 + 3, y: -bh / 2 + 1, width: bw - 6, height: bh * 0.24, fill: 'rgba(255,255,255,0.32)', cornerRadius: [2, 2, 0, 0], listening: false }));
        // 下缘暗线
        g.add(new Konva.Line({ points: [-bw / 2 + 2, bh / 2 - 1, bw / 2 - 2, bh / 2 - 1], stroke: 'rgba(0,0,0,0.25)', strokeWidth: 1, listening: false }));
        // 中央横向凸起
        const gripW = bw - 6, gripH = Math.max(11, Math.round(bh * 0.24)), gripY = -gripH / 2;
        g.add(new Konva.Rect({ x: -gripW / 2, y: gripY + 2, width: gripW, height: gripH, fill: 'rgba(0,0,0,0.28)', cornerRadius: 2, listening: false }));
        g.add(new Konva.Rect({
            x: -gripW / 2, y: gripY, width: gripW, height: gripH,
            fillLinearGradientStartPoint: { x: 0, y: gripY },
            fillLinearGradientEndPoint: { x: 0, y: gripY + gripH },
            fillLinearGradientColorStops: [0, '#5aa0ec', 0.35, '#3890e0', 0.65, '#2a70b8', 1, '#18508e'],
            stroke: '#1040a0', strokeWidth: 0.8, cornerRadius: 3, listening: false,
        }));
        g.add(new Konva.Rect({ x: -gripW / 2 + 2, y: gripY + 1, width: gripW - 4, height: 2, fill: 'rgba(255,255,255,0.50)', cornerRadius: 1, listening: false }));
        for (let i = 0; i < 2; i++) {
            const ly = gripY + gripH * 0.30 + i * 4;
            g.add(new Konva.Line({ points: [-gripW * 0.34, ly, gripW * 0.34, ly], stroke: 'rgba(0,0,0,0.20)', strokeWidth: 1, listening: false }));
        }
        this._dynamicGroup.add(g);
        return g;
    }

    // ── 组合起动屏：上下 5 栏，每栏一路电动机 ──
    //    电源开关（塑壳 MCB）保持不变；右侧为控制面板：
    //    上排 4 个指示灯（电源/备用/运行/故障脱扣）；下排 2 个转换开关 + 2 个按钮
    //    指示灯与按钮同半径；上下两排设备在栏内上下居中（间距对称）
    _drawCombo(cab, x0) {
        const s = this._staticGroup, d = this._dynamicGroup;
        const n = 5;
        const h = (BODY_BOT - BODY_TOP) / n;
        const R = 11;                                       // 指示灯与按钮统一半径
        const faceX0 = x0 + 54, colW = (CAB_W - 58) / 4;    // 控制面板 4 列
        const cxk = (k) => faceX0 + colW * (k + 0.5);
        for (let i = 0; i < n; i++) {
            const top = BODY_TOP + i * h;
            const cy = top + h / 2;
            if (i > 0) s.add(new Konva.Line({ points: [x0 + 6, top, x0 + CAB_W - 6, top], stroke: '#b7c0c8', strokeWidth: 1 }));
            const no = cab.base + i;
            const key = `${cab.id}-${i}`;
            const info = COMBO_NAME[key];
            // 电源开关（保持不变）；首两行用机组名称代替 QMxx 位号
            this._drawMCB(x0 + 28, cy, 44, 99, `cm-${cab.id}-${i}`, info ? '' : `QM${no}`, { handleExtra: 10, labelSize: 13, labelDy: 7 });
            if (info) {
                // 名称 + 一个或多个铭牌标签（下移 5px、13px 粗体）
                const ny = cy + 57;
                s.add(new Konva.Text({ x: x0 + 2, y: ny, width: 84, text: info.name, fontSize: 13, fontStyle: 'bold', fill: '#1a252f', align: 'center', listening: false }));
                let tx = x0 + 88;
                info.tags.forEach(t => {
                    const tw = Math.max(44, t.text.length * 9 + 14);
                    s.add(new Konva.Rect({ x: tx, y: ny - 3, width: tw, height: 18, fill: t.bg, stroke: t.stroke, strokeWidth: 1, cornerRadius: 2 }));
                    s.add(new Konva.Text({ x: tx, y: ny, width: tw, text: t.text, fontSize: 13, fontStyle: 'bold', fill: t.fg || '#ffffff', align: 'center', listening: false }));
                    tx += tw + 5;
                });
            }

            // ── 上排：4 个指示灯 ──
            const LED_LBL = ['电源', '备用', '运行', '故障'];
            const LED_BASE = ['#9aa0a6', '#8a5a00', '#0f5a12', '#5a0d0d'];
            const lenses = [];
            LED_LBL.forEach((t, k) => {
                s.add(new Konva.Text({ x: cxk(k) - colW / 2, y: cy - 66, width: colW, text: t, fontSize: 11, fontStyle: 'bold', fill: '#1a252f', align: 'center', listening: false }));
                const lens = new Konva.Circle({ x: cxk(k), y: cy - 33, radius: R, fill: LED_BASE[k], stroke: '#1a252f', strokeWidth: 1 });
                d.add(lens);
                lenses.push(lens);
            });
            this._comboLed[key] = lenses;

            // ── 下排：2 转换开关 + 2 按钮 ──
            const ySw = cy - 10, yCtl = cy + 18, yBot = cy + 37;
            // 加热器（关/开）
            s.add(new Konva.Text({ x: cxk(0) - colW / 2, y: ySw, width: colW, text: '加热器', fontSize: 11, fontStyle: 'bold', fill: '#1a252f', align: 'center', listening: false }));
            this._comboSel[`${key}-heat`] = this._mkSelector(d, cxk(0), yCtl, -45, [-45, 45], '#1a4696');
            s.add(new Konva.Text({ x: cxk(0) - colW / 2, y: yBot, width: colW / 2, text: '关', fontSize: 11, fontStyle: 'bold', fill: '#1a252f', align: 'center', listening: false }));
            s.add(new Konva.Text({ x: cxk(0), y: yBot, width: colW / 2, text: '开', fontSize: 11, fontStyle: 'bold', fill: '#1a252f', align: 'center', listening: false }));
            // 模式（手/自）
            s.add(new Konva.Text({ x: cxk(1) - colW / 2, y: ySw, width: colW, text: '模式', fontSize: 11, fontStyle: 'bold', fill: '#1a252f', align: 'center', listening: false }));
            this._comboSel[`${key}-mode`] = this._mkSelector(d, cxk(1), yCtl, -45, [-45, 45]);
            s.add(new Konva.Text({ x: cxk(1) - colW / 2, y: yBot, width: colW / 2, text: '手', fontSize: 11, fontStyle: 'bold', fill: '#1a252f', align: 'center', listening: false }));
            s.add(new Konva.Text({ x: cxk(1), y: yBot, width: colW / 2, text: '自', fontSize: 11, fontStyle: 'bold', fill: '#1a252f', align: 'center', listening: false }));
            // 启动按钮
            s.add(new Konva.Circle({ x: cxk(2), y: yCtl, radius: R, fill: '#1f9d33', stroke: '#0f3f18', strokeWidth: 1.5 }));
            s.add(new Konva.Text({ x: cxk(2) - colW / 2, y: yBot, width: colW, text: '启动', fontSize: 11, fontStyle: 'bold', fill: '#1a252f', align: 'center', listening: false }));
            // 停/复位按钮
            s.add(new Konva.Circle({ x: cxk(3), y: yCtl, radius: R, fill: '#7a0d0d', stroke: '#3a0606', strokeWidth: 1.5 }));
            s.add(new Konva.Text({ x: cxk(3) - colW / 2, y: yBot, width: colW, text: '停/复位', fontSize: 11, fontStyle: 'bold', fill: '#1a252f', align: 'center', listening: false }));
        }
    }

    /** 转换开关（圆形旋钮 + 手柄；可点击切换档位） */
    _mkSelector(d, cx, cy, ang, angs, body) {
        const g = new Konva.Group({ x: cx, y: cy, rotation: ang });
        const baseColor = body || '#101418';
        const bodyNode = new Konva.Circle({ x: 0, y: 0, radius: 11, fill: baseColor, stroke: '#4a5a66', strokeWidth: 1.5 });
        g.add(bodyNode);
        g.add(new Konva.Circle({ x: 0, y: 0, radius: 7, fill: 'rgba(0,0,0,0.35)', stroke: '#0a0e12', strokeWidth: 1 }));
        g.add(new Konva.Line({ points: [0, 0, 0, -10], stroke: '#e8eef2', strokeWidth: 3.5, lineCap: 'round' }));
        d.add(g);
        return { group: g, angs, i: 0, bodyNode, baseColor };
    }

    // ── 动力负载屏：整屏 5 行，每行 2 个 MCB ──
    _drawLoad(cab, x0) {
        const n = 5;
        const h = (BODY_BOT - BODY_TOP) / n;
        for (let r = 0; r < n; r++) {
            const cy = BODY_TOP + r * h + h / 2 - 13;   // 每行 MCB 整体上移 13px
            if (r > 0) {
                this._staticGroup.add(new Konva.Line({ points: [x0 + 6, BODY_TOP + r * h, x0 + CAB_W - 6, BODY_TOP + r * h], stroke: '#b7c0c8', strokeWidth: 1 }));
            }
            const no = cab.base + r * 2;
            this._drawLoadMCB(x0 + 62, cy, `ld-${cab.id}-${r}-0`, no);
            this._drawLoadMCB(x0 + 163, cy, `ld-${cab.id}-${r}-1`, no + 1);
        }
    }

    /** 动力负载屏单个塑壳开关：MCB + 路名 + 铭牌标签（13px 粗体） */
    _drawLoadMCB(cx, cy, id, no) {
        const s = this._staticGroup;
        const info = LOAD_NAME[no];
        this._drawMCB(cx, cy, 76, 96, id, info ? '' : `QF${no}`);
        if (!info) return;
        const FS = 13;
        // 路名过长时折成两行显示
        const lines = [];
        if (info.name.length * FS > 104) {
            const i = info.name.indexOf('（');
            if (i > 0) lines.push(info.name.slice(0, i), info.name.slice(i));
            else { const m = Math.ceil(info.name.length / 2); lines.push(info.name.slice(0, m), info.name.slice(m)); }
        } else {
            lines.push(info.name);
        }
        const ny0 = cy + 51;
        lines.forEach((t, k) => {
            s.add(new Konva.Text({ x: cx - 52, y: ny0 + k * 16, width: 104, text: t, fontSize: FS, fontStyle: 'bold', fill: '#1a252f', align: 'center', listening: false }));
        });
        if (info.tags && info.tags.length) this._drawTagGroup(cx, ny0 + lines.length * 16, info.tags, FS);
    }

    /** 铭牌标签组（水平居中于 cx） */
    _drawTagGroup(cx, y, tags, fontSize) {
        const s = this._staticGroup;
        const widths = tags.map(t => Math.max(fontSize * 3, Math.round(t.text.length * fontSize * 0.66) + 14));
        const total = widths.reduce((a, b) => a + b, 0) + (tags.length - 1) * 4;
        let tx = cx - total / 2;
        tags.forEach((t, k) => {
            const tw = widths[k];
            s.add(new Konva.Rect({ x: tx, y: y - 2, width: tw, height: fontSize + 7, fill: t.bg, stroke: t.stroke, strokeWidth: 1, cornerRadius: 2 }));
            s.add(new Konva.Text({ x: tx, y, width: tw, text: t.text, fontSize, fontStyle: 'bold', fill: t.fg || '#ffffff', align: 'center', listening: false }));
            tx += tw + 4;
        });
    }

    // ── 发电机控制屏（参照 HvSwitchPanel 发电机柜）──
    _drawGen(cab, x0) {
        const s = this._staticGroup, d = this._dynamicGroup;
        // 段分隔线
        s.add(new Konva.Line({ points: [x0 + 4, UPPER_H, x0 + CAB_W - 4, UPPER_H], stroke: '#7a8494', strokeWidth: 1 }));
        s.add(new Konva.Line({ points: [x0 + 4, UPPER_H + MID_H, x0 + CAB_W - 4, UPPER_H + MID_H], stroke: '#7a8494', strokeWidth: 1 }));
        // 上部：仪表（V / A / Hz 以屏中心左右对称）
        ['V', 'A', 'Hz'].forEach((m, i) => {
            const mx = x0 + CAB_W / 2 + (i - 1) * 58, cy = 82;
            s.add(new Konva.Circle({ x: mx, y: cy, radius: 22, fill: '#f4f6f8', stroke: '#2c3a45', strokeWidth: 1.5 }));
            s.add(new Konva.Line({ points: [mx, cy, mx + 12 * Math.cos(-2), cy + 12 * Math.sin(-2)], stroke: '#d03030', strokeWidth: 2, lineCap: 'round' }));
            s.add(new Konva.Text({ x: mx - 12, y: cy + 4, width: 24, text: m, fontSize: 12, fontStyle: 'bold', fill: '#1a252f', align: 'center', listening: false }));
        });
        // 指示灯（4 个：准备好/运行/合闸/分闸），与下方 4 个按钮逐一对齐
        const LED_LBL = ['准备好', '运行', '合闸', '分闸'];
        const leds = [];
        LED_LBL.forEach((t, i) => {
            const cx = x0 + CAB_W / 2 + (i - 1.5) * 40;   // 与按钮同列
            const led = new Konva.Rect({ x: cx - 11, y: 138, width: 22, height: 22, fill: '#3a3a3a', stroke: '#1a252f', strokeWidth: 1, cornerRadius: 2 });
            d.add(led);
            leds.push(led);
            s.add(new Konva.Text({ x: cx - 20, y: 163, width: 40, text: t, fontSize: 12, fontStyle: 'bold', fill: '#333', align: 'center', listening: false }));
        });
        this._genLed[cab.id] = { ready: leds[0], run: leds[1], g: leds[2], r: leds[3] };
        // 按钮：起动/停止/合闸/分闸
        const bY = 208, R = 15;
        const bxs = [52.5, 92.5, 132.5, 172.5];
        const bcol = ['#2e7d32', '#b71c1c', '#2e7d32', '#b71c1c'];
        const blbl = ['起动', '停止', '合闸', '分闸'];
        bxs.forEach((bx, i) => {
            s.add(new Konva.Circle({ x: x0 + bx, y: bY, radius: R, fill: bcol[i], stroke: '#1a252f', strokeWidth: 1.5 }));
            s.add(new Konva.Text({ x: x0 + bx - 20, y: 226, width: 40, text: blbl[i], fontSize: 12, fontStyle: 'bold', fill: '#1a252f', align: 'center', listening: false }));
        });
        // 辅助带灯按钮：故障复位 / 自动同步 / 自动解列（整只按钮即为指示灯）
        this._genAuxLed[cab.id] = {};
        [['故障复位', 57, 'reset', '#4a1515', '#ff2020'], ['自动同步', 112.5, 'sync', '#153a15', '#2eff3e'], ['自动解列', 168, 'split', '#4a1515', '#ff2020']].forEach(([lbl, bx, key, base, lit]) => {
            const btn = new Konva.Circle({ x: x0 + bx, y: 265, radius: 14, fill: base, stroke: '#1a252f', strokeWidth: 1.5 });
            d.add(btn);
            d.add(new Konva.Circle({ x: x0 + bx, y: 265, radius: 6, fill: 'rgba(255,255,255,0.18)', listening: false }));
            this._genAuxLed[cab.id][key] = { node: btn, base, lit };
            s.add(new Konva.Text({ x: x0 + bx - 26, y: 282, width: 52, text: lbl, fontSize: 10, fontStyle: 'bold', fill: '#1a252f', align: 'center', listening: false }));
        });
        // 中部：PPU 单元（Protection and Paralleling Unit）
        this._drawPPU(cab, x0);
        // 下部单线图：主汇流排（贯穿全宽）→ 断路器 → 发电机
        const busY = BUS_Y, cx = x0 + CAB_W / 2;
        s.add(new Konva.Text({ x: cx - 60, y: busY - 16, text: '400V', fontSize: 9, fill: '#1a252f', listening: false }));
        // 开关出线（汇流排 → 断路器上触点）：汇流排带电时变红
        this._genBusWire[cab.id] = new Konva.Line({ points: [cx, busY, cx, busY + 36], stroke: '#1a252f', strokeWidth: 2 });
        s.add(this._genBusWire[cab.id]);
        const X4 = 4;
        s.add(new Konva.Line({ points: [cx - X4, busY + 36 - X4, cx + X4, busY + 36 + X4], stroke: '#006400', strokeWidth: 2.5, lineCap: 'round' }));
        s.add(new Konva.Line({ points: [cx - X4, busY + 36 + X4, cx + X4, busY + 36 - X4], stroke: '#006400', strokeWidth: 2.5, lineCap: 'round' }));
        const h = 19.6;
        this._genBlade[cab.id] = new Konva.Line({ points: [cx, busY + 78, cx - 2 * h * 0.574, busY + 78 - 2 * h * 0.819], stroke: '#1a252f', strokeWidth: 3, lineCap: 'round' });
        d.add(this._genBlade[cab.id]);
        this._genGeom[cab.id] = { dx: cx, by: busY, h };
        s.add(new Konva.Circle({ x: cx, y: busY + 78, radius: 3, fill: '#c8a24a', stroke: '#7a6028', strokeWidth: 1 }));
        // 发电机出线（发电机 → 断路器下触点）：发电机起动即变红
        this._genOutWire[cab.id] = new Konva.Line({ points: [cx, busY + 78, cx, busY + 148], stroke: '#1a252f', strokeWidth: 2 });
        s.add(this._genOutWire[cab.id]);
        this._genCircle[cab.id] = new Konva.Circle({ x: cx, y: busY + 168, radius: 20, fill: '#8a8f96', stroke: '#2c3a45', strokeWidth: 2 });
        d.add(this._genCircle[cab.id]);
        s.add(new Konva.Text({ x: cx - 10, y: busY + 159, width: 20, text: 'G', fontSize: 14, fontStyle: 'bold', fill: '#1a252f', align: 'center', listening: false }));
        s.add(new Konva.Text({ x: cx - 30, y: busY + 201, width: 60, text: cab.tag, fontSize: 10, fill: '#333', align: 'center', listening: false }));
    }

    // ── 发电机控制屏中部：PPU 单元（Protection and Paralleling Unit）──
    _drawPPU(cab, x0) {
        const s = this._staticGroup;
        const px = x0 + 15, py = UPPER_H + 10, pw = CAB_W - 30, ph = MID_H - 24;   // PPU 总宽度 +10px
        // 面板底板
        s.add(new Konva.Rect({ x: px, y: py, width: pw, height: ph, fill: '#2f3338', stroke: '#101315', strokeWidth: 1.2, cornerRadius: 3 }));

        // ── 左：Alarm 栏 ──
        s.add(new Konva.Text({ x: px, y: py + 6, width: 24, text: 'Alarm', fontSize: 6, fontStyle: 'bold', fill: '#e8e8e8', align: 'center', listening: false }));
        [['', 28], ['INFO', 58], ['JUMP', 88]].forEach(([lbl, dy]) => {
            const cx = px + 12, cy = py + dy;
            s.add(new Konva.Circle({ x: cx, y: cy, radius: 6.5, fill: '#d4d4d4', stroke: '#606060', strokeWidth: 1 }));
            if (lbl) s.add(new Konva.Text({ x: cx - 13, y: cy - 3, width: 26, text: lbl, fontSize: 5, fontStyle: 'bold', fill: '#333', align: 'center', listening: false }));
        });

        // ── 中：显示单元 ──
        const dx = px + 25, dw = 124, dy = py + 7, dh = ph - 14;   // 显示单元同步 +10px
        s.add(new Konva.Rect({ x: dx, y: dy, width: dw, height: dh, fill: '#1b1e21', stroke: '#0a0c0e', strokeWidth: 1, cornerRadius: 2 }));
        // 标题区
        s.add(new Konva.Rect({ x: dx + 4, y: dy + 3, width: 16, height: 11, fill: '#16407a', stroke: '#0a2246', strokeWidth: 0.6, cornerRadius: 1 }));
        s.add(new Konva.Text({ x: dx + 4, y: dy + 5, width: 16, text: 'DEF', fontSize: 6, fontStyle: 'bold', fill: '#ffffff', align: 'center', listening: false }));
        s.add(new Konva.Text({ x: dx + 23, y: dy + 2, width: 88, text: 'Protection and Paralleling Unit', fontSize: 5, fill: '#eaeaea', listening: false }));
        s.add(new Konva.Text({ x: dx + 58, y: dy + 11, width: 53, text: 'multi-line PPU', fontSize: 5, fontStyle: 'italic', fill: '#b8b8b8', align: 'right', listening: false }));
        // 绿色 LCD（5 行、15px 粗体：第1行居中模式，第2~5行左对齐电压/频率/电流/功率）
        // 下部一直增长到接近显示单元边缘（原 Open/Closed 开关已删除）
        const lx = dx + 4, ly = dy + 20, lw = dw - 8, lh = dh - 25;
        s.add(new Konva.Rect({ x: lx, y: ly, width: lw, height: lh, fill: '#c6d400', stroke: '#6a7400', strokeWidth: 1 }));
        const mkLine = (yy, align, xx, ww) => {
            const t = new Konva.Text({ x: xx, y: yy, width: ww, text: '', fontSize: 15, fontStyle: 'bold', fill: '#1a1a1a', align, listening: false });
            this._dynamicGroup.add(t);
            return t;
        };
        this._ppu[cab.id] = {
            mode: mkLine(ly + 4, 'center', lx, lw),
            u: mkLine(ly + 23, 'left', lx + 6, lw - 12),
            f: mkLine(ly + 42, 'left', lx + 6, lw - 12),
            i: mkLine(ly + 61, 'left', lx + 6, lw - 12),
            p: mkLine(ly + 80, 'left', lx + 6, lw - 12),
        };

        // ── 右：指示灯与按键 ──
        const rx = px + 151;
        [['Ready', 10, '#3a5a00'], ['Power', 24, '#d0c000'], ['Regulator ON', 38, '#d0c000'], ['Self check', 52, '#d0c000']].forEach(([lbl, dy2, col]) => {
            s.add(new Konva.Circle({ x: rx + 4, y: py + dy2, radius: 3.5, fill: col, stroke: '#0a0c0e', strokeWidth: 0.6 }));
            s.add(new Konva.Text({ x: rx + 10, y: py + dy2 - 3, width: 38, text: lbl, fontSize: 5, fill: '#e6e6e6', listening: false }));
        });
        // VIEW / LOG 按键
        [['VIEW', 72], ['LOG', 88]].forEach(([lbl, dy2]) => {
            s.add(new Konva.Rect({ x: rx, y: py + dy2, width: 15, height: 11, fill: '#4a5058', stroke: '#20242a', strokeWidth: 0.8, cornerRadius: 2 }));
            s.add(new Konva.Text({ x: rx, y: py + dy2 + 3, width: 15, text: lbl, fontSize: 4, fontStyle: 'bold', fill: '#fff', align: 'center', listening: false }));
        });
        // 方向导航盘
        const nx = rx + 30, ny = py + 86, nr = 14;
        s.add(new Konva.Circle({ x: nx, y: ny, radius: nr, fill: '#9aa0a6', stroke: '#3a3e44', strokeWidth: 1 }));
        s.add(new Konva.Rect({ x: nx - 4, y: ny - 4, width: 8, height: 8, fill: '#2f3338', cornerRadius: 1 }));
        const tri = (cx, cy, ang) => {
            const g = new Konva.Group({ x: cx, y: cy, rotation: ang });
            g.add(new Konva.Line({ points: [-4, 2.5, 4, 2.5, 0, -3.5], closed: true, fill: '#2f3338' }));
            s.add(g);
        };
        tri(nx, ny - 10, 0); tri(nx, ny + 10, 180); tri(nx - 10, ny, -90); tri(nx + 10, ny, 90);
        // BACK 按键
        s.add(new Konva.Rect({ x: rx + 16, y: py + 112, width: 24, height: 11, fill: '#4a5058', stroke: '#20242a', strokeWidth: 0.8, cornerRadius: 2 }));
        s.add(new Konva.Text({ x: rx + 16, y: py + 115, width: 24, text: 'BACK', fontSize: 5, fontStyle: 'bold', fill: '#fff', align: 'center', listening: false }));
    }

    // ── 并车屏（参照 HvSwitchPanel 并车柜）──
    _drawSync(cab, x0) {
        const s = this._staticGroup, d = this._dynamicGroup;
        s.add(new Konva.Line({ points: [x0 + 4, UPPER_H, x0 + CAB_W - 4, UPPER_H], stroke: '#7a8494', strokeWidth: 1 }));
        s.add(new Konva.Line({ points: [x0 + 4, UPPER_H + MID_H, x0 + CAB_W - 4, UPPER_H + MID_H], stroke: '#7a8494', strokeWidth: 1 }));
        // ── 上部：同步表（左）＋ 灯光旋转法三灯（右）──
        const mcx = x0 + 52, mcy = 82, mR = 30;
        s.add(new Konva.Circle({ x: mcx, y: mcy, radius: mR, fill: '#f4f6f8', stroke: '#2c3a45', strokeWidth: 2 }));
        for (let a = 0; a < 360; a += 30) {
            const rad = a * Math.PI / 180;
            s.add(new Konva.Line({ points: [mcx + (mR - 7) * Math.cos(rad), mcy + (mR - 7) * Math.sin(rad), mcx + (mR - 3) * Math.cos(rad), mcy + (mR - 3) * Math.sin(rad)], stroke: '#2c3a45', strokeWidth: 1.2 }));
        }
        const needle = new Konva.Group({ x: mcx, y: mcy, rotation: 0 });
        needle.add(new Konva.Line({ points: [0, 0, 0, -mR + 8], stroke: '#d03030', strokeWidth: 2.5, lineCap: 'round' }));
        d.add(needle);
        this._synNeedle = needle;
        s.add(new Konva.Text({ x: mcx - 30, y: mcy + mR + 3, width: 60, text: '同步表', fontSize: 11, fontStyle: 'bold', fill: '#006400', align: 'center', listening: false }));
        // 灯光旋转法：三灯按圆周 12/4/8 点对称分布（明暗沿圆周旋转）
        this._syncLamps = [];
        const lcx = x0 + 160, lcy = 84, lr = 26;
        [0, 120, 240].forEach(aDeg => {
            const a = aDeg * Math.PI / 180;
            const lamp = new Konva.Circle({
                x: lcx + lr * Math.sin(a), y: lcy - lr * Math.cos(a),
                radius: 10, fill: '#123a15', stroke: '#1a252f', strokeWidth: 1.2,
            });
            d.add(lamp);
            this._syncLamps.push(lamp);
        });
        s.add(new Konva.Text({ x: lcx - 44, y: lcy + lr + 8, width: 88, text: '灯光旋转法', fontSize: 11, fontStyle: 'bold', fill: '#006400', align: 'center', listening: false }));

        // 3 个转换开关排成一排（对称分布）
        const ky = 190, R = 21;
        const kxs = [x0 + 40, x0 + 112.5, x0 + 185];
        const mkKnob = (cx, ang) => {
            const g = new Konva.Group({ x: cx, y: ky, rotation: ang });
            g.add(new Konva.Circle({ x: 0, y: 0, radius: R, fill: '#cfd8df', stroke: '#2c3a45', strokeWidth: 1.5 }));
            g.add(new Konva.Line({ points: [0, 0, 0, -R + 4], stroke: '#38404f', strokeWidth: 3, lineCap: 'round' }));
            d.add(g);
            return g;
        };
        this._syncKnobs.sync = mkKnob(kxs[0], -90);
        this._syncKnobs.mode = mkKnob(kxs[1], 0);    // 默认 HAND
        this._syncKnobs.seq  = mkKnob(kxs[2], -90);
        // 档位文字标签：11px，写在各自对应的档位方向上、紧靠开关外边缘
        const put = (kx, ang, txt) => {
            const d = 30, dd = 22;
            let dx = 0, dy = 0;
            if (ang === -90) dx = -d;
            else if (ang === 90) dx = d;
            else if (ang === 0) dy = -d;
            else if (ang === -45) { dx = -dd; dy = -dd; }
            else if (ang === 45) { dx = dd; dy = -dd; }
            s.add(new Konva.Text({ x: kx + dx - 24, y: ky + dy - 7, width: 48, text: txt, fontSize: 11, fontStyle: 'bold', fill: '#1a252f', align: 'center', listening: false }));
        };
        // 同步选择：0 / 1# / 2# / 3# / 0
        put(kxs[0], -90, '0'); put(kxs[0], -45, '1#'); put(kxs[0], 0, '2#'); put(kxs[0], 45, '3#'); put(kxs[0], 90, '0');
        // 模式选择：半 / 手 / 自
        put(kxs[1], -90, '半'); put(kxs[1], 0, '手'); put(kxs[1], 90, '自');
        // 备用顺序：123 / 231 / 312
        put(kxs[2], -90, '123'); put(kxs[2], 0, '231'); put(kxs[2], 90, '312');
        // 标题
        s.add(new Konva.Text({ x: kxs[0] - 40, y: 222, width: 80, text: '同步选择', fontSize: 11, fontStyle: 'bold', fill: '#006400', align: 'center', listening: false }));
        s.add(new Konva.Text({ x: kxs[1] - 40, y: 222, width: 80, text: '模式选择', fontSize: 11, fontStyle: 'bold', fill: '#006400', align: 'center', listening: false }));
        s.add(new Konva.Text({ x: kxs[2] - 40, y: 222, width: 80, text: '备用顺序', fontSize: 11, fontStyle: 'bold', fill: '#006400', align: 'center', listening: false }));
        // 3 台发电机调速开关（自复位手柄，位于各旋钮下方）
        const gy2 = 282, gr = 19;
        ['gen1', 'gen2', 'gen3'].forEach((id, i) => {
            const cx = kxs[i];
            const g = new Konva.Group({ x: cx, y: gy2, rotation: 0 });
            g.add(new Konva.Circle({ x: 0, y: 0, radius: gr, fill: '#2f3338', stroke: '#101315', strokeWidth: 1.5 }));
            g.add(new Konva.Line({ points: [0, 0, 0, -gr], stroke: '#e8eef2', strokeWidth: 3, lineCap: 'round' }));
            d.add(g);
            this._govNodes[id] = g;
            s.add(new Konva.Text({ x: cx - 36, y: gy2 - 7, width: 14, text: '↺', fontSize: 13, fill: '#1a252f', align: 'center', listening: false }));
            s.add(new Konva.Text({ x: cx + 22, y: gy2 - 7, width: 14, text: '↻', fontSize: 13, fill: '#1a252f', align: 'center', listening: false }));
            s.add(new Konva.Text({ x: cx - 30, y: gy2 + 20, width: 60, text: `${i + 1}#调速`, fontSize: 11, fontStyle: 'bold', fill: '#006400', align: 'center', listening: false }));
        });

        // ── 中部：声光报警器 + 3 个按钮 + 4 个方形报警灯（每排 4 个对称分布）──
        const cxs = [x0 + 43, x0 + 89, x0 + 135, x0 + 181];
        const ry1 = 378, ry2 = 450;
        const putLbl = (cx, cy, txt) => {
            const lines = txt.split('\n');
            const n = lines.length;
            lines.forEach((t, i) => s.add(new Konva.Text({ x: cx - 26, y: cy - 33 - (n - 1 - i) * 14, width: 52, text: t, fontSize: 11, fontStyle: 'bold', fill: '#1a252f', align: 'center', listening: false })));
        };
        this._alarmLampNodes = {};
        const mkAlarmLamp = (cx, cy, key) => {
            const rect = new Konva.Rect({ x: cx - 12, y: cy - 12, width: 24, height: 24, fill: '#2a2f34', stroke: '#1a252f', strokeWidth: 1.2, cornerRadius: 3 });
            d.add(rect);
            this._alarmLampNodes[key] = rect;
        };
        // 第 1 排：蜂鸣器 / 指示灯·蜂鸣器测试 / 绝缘故障 / 优先脱扣
        putLbl(cxs[0], ry1, '蜂鸣器');
        const buz = new Konva.Group({ x: cxs[0], y: ry1 });
        buz.add(new Konva.Circle({ x: 0, y: 0, radius: 18, fill: '#c00000', stroke: '#5a0000', strokeWidth: 1.5 }));
        buz.add(new Konva.Circle({ x: 0, y: 0, radius: 11, fill: '#8a0000', stroke: '#3a0000', strokeWidth: 1 }));
        this._buzzerNode = new Konva.Circle({ x: 0, y: 0, radius: 5, fill: '#3a0000' });
        buz.add(this._buzzerNode);
        [7, 12].forEach(ir => {
            buz.add(new Konva.Arc({ x: 0, y: 0, innerRadius: ir, outerRadius: ir + 2, angle: 70, rotation: 145, stroke: '#ffffff', strokeWidth: 1.6, fillEnabled: false }));
            buz.add(new Konva.Arc({ x: 0, y: 0, innerRadius: ir, outerRadius: ir + 2, angle: 70, rotation: -35, stroke: '#ffffff', strokeWidth: 1.6, fillEnabled: false }));
        });
        s.add(buz);
        putLbl(cxs[1], ry1, '报警测试');
        this._testLed = new Konva.Circle({ x: cxs[1], y: ry1, radius: 16, fill: '#0a0a0a', stroke: '#9aa0a6', strokeWidth: 3 });
        s.add(this._testLed);
        putLbl(cxs[2], ry1, '绝缘故障'); mkAlarmLamp(cxs[2], ry1, 'ins');
        putLbl(cxs[3], ry1, '优先脱扣'); mkAlarmLamp(cxs[3], ry1, 'trip');
        // 第 2 排：消音 / 报警确认 / 汇流排短路 / 汇流排电压低
        putLbl(cxs[0], ry2, '消音');
        s.add(new Konva.Circle({ x: cxs[0], y: ry2, radius: 16, fill: '#7a0d0d', stroke: '#9aa0a6', strokeWidth: 3 }));
        putLbl(cxs[1], ry2, '报警确认');
        s.add(new Konva.Circle({ x: cxs[1], y: ry2, radius: 16, fill: '#c8a800', stroke: '#9aa0a6', strokeWidth: 3 }));
        putLbl(cxs[2], ry2, '汇流排\n短路'); mkAlarmLamp(cxs[2], ry2, 'short');
        putLbl(cxs[3], ry2, '应发失败'); mkAlarmLamp(cxs[3], ry2, 'startfail');

        // ── 下部：绝缘指示灯（地气灯，L1/L2/L3）＋ 配电板式兆欧表 ──
        const dy0 = UPPER_H + MID_H + 36;
        // 绝缘指示灯
        s.add(new Konva.Text({ x: x0 + 36, y: dy0, width: 96, text: '绝缘指示灯', fontSize: 13, fontStyle: 'bold', fill: '#006400', align: 'center', listening: false }));
        this._glLamps = {};
        const glx = [x0 + 34, x0 + 74, x0 + 114];
        ['L1', 'L2', 'L3'].forEach((ph, i) => {
            const lx = glx[i];
            s.add(new Konva.Text({ x: lx - 12, y: dy0 + 18, width: 24, text: ph, fontSize: 10, fontStyle: 'bold', fill: '#1a252f', align: 'center', listening: false }));
            const lamp = new Konva.Circle({ x: lx, y: dy0 + 42, radius: 13, fill: '#d8dde2', stroke: '#9aa0a6', strokeWidth: 1.2 });
            d.add(lamp);
            this._glLamps[ph] = lamp;
            s.add(new Konva.Line({ points: [lx - 6, dy0 + 38, lx - 3, dy0 + 34, lx - 0, dy0 + 42, lx + 3, dy0 + 34, lx + 6, dy0 + 38], stroke: '#1a252f', strokeWidth: 1.2, listening: false }));
        });

        // 测试按钮
        s.add(new Konva.Circle({ x: x0 + 160, y: dy0 + 42, radius: 14, fill: '#2e7d32', stroke: '#1a252f', strokeWidth: 1.5 }));

        // 配电板式兆欧表（半圆刻度表 + 数码显示）
        const my0 = dy0 + 160, mx0 = x0 + 90, mmR = 78;
        s.add(new Konva.Arc({ x: mx0, y: my0, innerRadius: mmR - 76, outerRadius: mmR, angle: 180, rotation: 180, fill: '#f4f6f8', stroke: '#2c3a45', strokeWidth: 1.5 }));
        // 刻度与数字
        for (let i = 0; i <= 10; i++) {
            const a = Math.PI * (1 - i / 10);
            s.add(new Konva.Line({ points: [mx0 + (mmR - 6) * Math.cos(a), my0 - (mmR - 2) * Math.sin(a), mx0 + (mmR - 16) * Math.cos(a), my0 - (mmR - 12) * Math.sin(a)], stroke: '#2c3a45', strokeWidth: 1.2 }));
        }
        this._megT = (v) => Math.max(0, Math.min(1, 1 - Math.log10(Math.max(v, 0) + 0.5) / Math.log10(500.5)));
        [500, 200, 100, 50, 20, 10, 5, 2, 1, 0].forEach((num) => {
            const t = this._megT(num);
            const a = Math.PI * (1 - t);
            s.add(new Konva.Text({ x: mx0 + (mmR - 20) * Math.cos(a) - 12, y: my0 - (mmR - 26) * Math.sin(a) - 6, width: 24, text: String(num), fontSize: 9, fill: '#1a252f', align: 'center', listening: false }));
        });
        s.add(new Konva.Text({ x: mx0 - 12, y: my0 - 30, width: 24, text: 'MΩ', fontSize: 12, fontStyle: 'bold', fill: '#d02020', align: 'center', listening: false }));
        const mneedle = new Konva.Group({ x: mx0, y: my0, rotation: -90 });
        mneedle.add(new Konva.Line({ points: [0, 0, 0, -mmR + 14], stroke: '#d02020', strokeWidth: 2, lineCap: 'round' }));
        d.add(mneedle);
        this._megNeedle = mneedle;
        s.add(new Konva.Circle({ x: mx0, y: my0, radius: 4, fill: '#c8a24a', stroke: '#7a6028', strokeWidth: 1 }));
        // 数码显示 + 正常/异常
        s.add(new Konva.Rect({ x: mx0 + 70, y: my0 - 66, width: 62, height: 26, fill: '#0d1a0d', stroke: '#1a252f', strokeWidth: 1.2, cornerRadius: 3 }));
        this._megText = new Konva.Text({ x: mx0 + 70, y: my0 - 63, width: 62, text: '5.00', fontSize: 15, fontStyle: 'bold', fill: '#2eff3e', align: 'center', listening: false });
        d.add(this._megText);
        this._megState = new Konva.Text({ x: mx0 + 70, y: my0 - 34, width: 62, text: '正常', fontSize: 12, fontStyle: 'bold', fill: '#20a030', align: 'center', listening: false });
        d.add(this._megState);
        s.add(new Konva.Text({ x: mx0 - 50, y: my0 + 6, width: 120, text: '配电板式兆欧表', fontSize: 15, fontStyle: 'bold', fill: '#006400', align: 'center', listening: false }));
    }

    // ── 交互 ──
    _hit(x, y, w, h, fn, pressR) {
        const hit = new Konva.Rect({ x: x - w / 2, y: y - h / 2, width: w, height: h, fill: 'rgba(255,255,255,0.01)', listening: true, cursor: 'pointer' });
        this._dynamicGroup.add(hit);
        hit.on('click tap', (e) => {
            e.cancelBubble = true;
            if (pressR) this._pressFx(x, y, pressR);
            fn();
        });
    }

    /** 按钮按下的动态效果：暗色压下 + 白色光环扩散淡出 */
    _pressFx(cx, cy, r) {
        const d = this._dynamicGroup;
        const fill = new Konva.Circle({ x: cx, y: cy, radius: r * 0.85, fill: 'rgba(0,0,0,0.35)', listening: false });
        const ring = new Konva.Circle({ x: cx, y: cy, radius: r * 0.9, stroke: 'rgba(255,255,255,0.9)', strokeWidth: 3, listening: false });
        d.add(fill, ring);
        fill.to({ opacity: 0, duration: 0.28 });
        ring.to({
            radius: r * 1.6, opacity: 0, duration: 0.38,
            onFinish: () => { ring.destroy(); fill.destroy(); if (this.sys && this.sys.requestRedraw) this.sys.requestRedraw(); },
        });
        if (this.sys && this.sys.requestRedraw) this.sys.requestRedraw();
    }

    _bindInteractions() {
        CABINETS.forEach((cab, idx) => {
            const x0 = idx * CAB_W;
            if (cab.type === 'combo') {
                const n = 5, h = (BODY_BOT - BODY_TOP) / n;
                const faceX0 = x0 + 54, colW = (CAB_W - 58) / 4;
                const cxk = (k) => faceX0 + colW * (k + 0.5);
                for (let i = 0; i < n; i++) {
                    const cy = BODY_TOP + i * h + h / 2;
                    const key = `${cab.id}-${i}`;
                    this._hit(x0 + 28, cy, 50, 104, () => this.toggleMCB(`cm-${cab.id}-${i}`));
                    this._hit(cxk(0), cy + 18, 28, 28, () => this.toggleSelector(`${key}-heat`));
                    this._hit(cxk(1), cy + 18, 28, 28, () => this.toggleSelector(`${key}-mode`));
                    this._hit(cxk(2), cy + 18, 28, 28, () => this.setMotor(key, true), 11);
                    this._hit(cxk(3), cy + 18, 28, 28, () => this.setMotor(key, false), 11);
                }
            } else if (cab.type === 'load') {
                const n = 5, h = (BODY_BOT - BODY_TOP) / n;
                for (let r = 0; r < n; r++) {
                    const cy = BODY_TOP + r * h + h / 2 - 5;   // 与 MCB 同步上移 5px
                    this._hit(x0 + 62, cy, 68, 108, () => this.toggleMCB(`ld-${cab.id}-${r}-0`));
                    this._hit(x0 + 163, cy, 68, 108, () => this.toggleMCB(`ld-${cab.id}-${r}-1`));
                }
            } else if (cab.type === 'gen') {
                const bY = 208;
                this._hit(x0 + 52.5, bY, 30, 30, () => this.setGenRun(cab.id, true), 15);
                this._hit(x0 + 92.5, bY, 30, 30, () => this.setGenRun(cab.id, false), 15);
                this._hit(x0 + 132.5, bY, 30, 30, () => this.setGenCB(cab.id, true), 15);
                this._hit(x0 + 172.5, bY, 30, 30, () => this.setGenCB(cab.id, false), 15);
                // 辅助带灯按钮
                this._hit(x0 + 57, 265, 30, 30, () => this.onFaultReset(cab.id), 14);
                this._hit(x0 + 112.5, 265, 30, 30, () => this.onAutoSync(cab.id), 14);
                this._hit(x0 + 168, 265, 30, 30, () => this.onAutoSplit(cab.id), 14);
            } else if (cab.type === 'sync') {
                const defs = [
                    { key: 'sync', x: x0 + 40,    y: 190, angs: [-90, -45, 0, 45, 90], i: 0 },   // 0/1#/2#/3#/0
                    { key: 'mode', x: x0 + 112.5, y: 190, angs: [-90, 0, 90], i: 1 },          // 半/手/自
                    { key: 'seq',  x: x0 + 185,   y: 190, angs: [-90, 0, 90], i: 0 },          // 123/231/312
                ];
                defs.forEach(def => {
                    this._syncPos[def.key] = { i: def.i, angs: def.angs };
                    this._hit(def.x, def.y, 56, 56, () => {
                        const p = this._syncPos[def.key];
                        p.i = (p.i + 1) % p.angs.length;
                        if (this._syncKnobs[def.key]) this._syncKnobs[def.key].rotation(p.angs[p.i]);
                        this._refresh();
                    });
                });
                // 3 台发电机调速开关（左半区降速 / 右半区升速）
                ['gen1', 'gen2', 'gen3'].forEach((id, i) => {
                    const cx = x0 + (i === 0 ? 40 : i === 1 ? 112.5 : 185);
                    this._hit(cx - 10, 282, 20, 36, () => this.onGovTurn(id, -1));
                    this._hit(cx + 10, 282, 20, 36, () => this.onGovTurn(id, +1));
                });
                // 声光报警器：指示灯/蜂鸣器测试、消音、报警确认
                this._hit(x0 + 89, 378, 34, 34, () => this.onAlarmTest(), 16);
                this._hit(x0 + 43, 450, 34, 34, () => this.onAlarmSilence(), 16);
                this._hit(x0 + 89, 450, 34, 34, () => this.onAlarmAck(), 16);
                // 地气灯测试按钮（_hit 以中心点定位，与按钮圆心一致）
                this._hit(x0 + 160, UPPER_H + MID_H + 78, 30, 30, () => this.onGroundTest(), 15);
            }
        });
    }

    // ── 交互 API ──
    /** 主汇流排是否带电：任一发电机运行且其断路器合闸（参照单线图供电逻辑） */
    _busLive() {
        return (this._genRun.gen1 && this._genCB.gen1) ||
               (this._genRun.gen2 && this._genCB.gen2) ||
               (this._genRun.gen3 && this._genCB.gen3);
    }
    _tip(msg) {
        if (this.sys && typeof this.sys.showFloatingTip === 'function') {
            this.sys.showFloatingTip(msg, 2600);
        }
    }
    /** 开关操作（负载屏 / 组合起动屏）：脱扣后手柄停在 TRIP 位，必须先拉到 OFF 位才能再推到 ON 位 */
    toggleMCB(id) {
        if (this._mcbState[id] === undefined) return;
        if (this._mcbTrip[id]) {              // TRIP 位 → 第一步：复位到 OFF 位
            this._mcbTrip[id] = false;
            this._mcbState[id] = false;
            this._tip('开关脱扣：先复位到 OFF 位，再合闸到 ON 位');
            this._refresh();
            return;
        }
        this._mcbState[id] = !this._mcbState[id];
        this._enforceShunt();          // 分励脱扣器带电时，合上即脱扣
        this._refresh();
    }
    setMCB(id, on) {
        if (this._mcbState[id] === undefined) return;
        this._mcbState[id] = !!on;
        this._mcbTrip[id] = false;
        this._enforceShunt();
        this._refresh();
    }
    setMotor(id, on) {
        if (on) {
            // 汇流排无电时电动机不能起动；且需先合上本栏电源开关
            if (!this._busLive()) { this._tip('汇流排无电，电动机无法起动'); return; }
            if (!this._mcbState[`cm-${id}`]) { this._tip('请先合上电源开关'); return; }
        } else {
            this._fault[id] = false;   // 停止/复位按钮：同时复位故障
        }
        this._motorRun[id] = !!on;
        this._refresh();
    }
    /** 加热器开关档位：i=0 关 / i=1 开 */
    _comboHeatOn(key) { const s = this._comboSel[`${key}-heat`]; return s ? s.i === 1 : false; }
    /** 模式开关档位：i=0 手 / i=1 自 */
    _comboAuto(key) { const s = this._comboSel[`${key}-mode`]; return s ? s.i === 1 : false; }
    /** 外部注入故障（供故障配置/演示使用） */
    setFault(key, on) { this._fault[key] = !!on; this._refresh(); }
    toggleSelector(id) {
        const sel = this._comboSel[id];
        if (!sel) return;
        sel.i = (sel.i + 1) % sel.angs.length;
        sel.group.rotation(sel.angs[sel.i]);
        this._refresh();
    }
    /** 手动起动/停止/合闸/分闸在“自动”“半自动”电站模式下均被禁止（仅“手动”模式可操作） */
    _manualGenLocked() {
        const m = this._plantModeOf();
        if (m === 'AUTO') { this._tip('电站自动模式：禁止手动起动/停止/合闸/分闸'); return true; }
        if (m === 'SEMI-AUTO') { this._tip('半自动并车模式下手动操作失效'); return true; }
        return false;
    }
    setGenRun(id, on) {
        if (this._manualGenLocked()) return;
        this._genRun[id] = !!on;
        this._refresh();
    }
    setGenCB(id, on) {
        if (this._manualGenLocked()) return;
        if (on && !this._genRun[id]) return;   // 未起动不能合闸
        if (on && this._busLive()) {
            // 并车联锁：同步选择开关须转到本机，才解除合闸联锁
            if (this._syncSelection() !== id) { this._tip('电网有电：须将“同步选择”开关转到本机方可合闸'); return; }
            // 并车保护（或关系）：指针在 2~10 点之间合闸，或频差 > 0.5Hz → 跳闸并触发机组故障
            const fBus = (this._fBus != null) ? this._fBus : 60.1;
            const df = (60.1 + (this._gov[id] || 0)) - fBus;
            const ang = this._syncAngle;
            const badAngle = (ang > 60 && ang < 300);     // 指针在 2 点~10 点之间
            if (badAngle || Math.abs(df) > 0.5) { this._tripAllGens(id); return; }
            this._tip(`并车合闸：频差 ${df >= 0 ? '+' : ''}${df.toFixed(2)} Hz，指针 ${Math.round(ang)}°`);
            this._genCB[id] = true;
            this._refresh();
            return;
        } else if (!on) {
            this._genCB[id] = false;
            this._refresh();
            return;
        }
        this._genCB[id] = !!on;
        this._refresh();
    }
    /** 并车失败：所有合闸主开关跳闸，并触发原机组与待并机组故障（故障复位灯亮） */
    _tripAllGens(incomingId) {
        ['gen1', 'gen2', 'gen3'].forEach(id => {
            if (this._genCB[id]) {
                this._genCB[id] = false;
                this._genTrip[id] = true;
                this._genFault[id] = true;
            }
        });
        // 待并机组（本次欲合闸者）虽未合闸，也一并触发故障
        if (incomingId) { this._genTrip[incomingId] = true; this._genFault[incomingId] = true; }
        this._tip('并车失败：主开关跳闸，原机组与待并机组均已触发故障');
        this._refresh();
    }
    /** 发电机控制方式：'remote' 遥控 / 'local' 机旁 */
    setGenMode(id, mode) {
        if (!(id in this._genMode)) return;
        this._genMode[id] = (mode === 'local') ? 'local' : 'remote';
        this._refresh();
    }
    getGenMode(id) { return this._genMode[id]; }
    /** 发电机组故障 */
    setGenFault(id, on) {
        if (!(id in this._genFault)) return;
        this._genFault[id] = !!on;
        this._refresh();
    }
    getGenFault(id) { return !!this._genFault[id]; }

    // ── 辅助带灯按钮 ──
    /** 调速开关：dir=+1 升速（右转）/ -1 降速（左转），每次 0.1Hz，手柄保持 1s 后回弹 */
    onGovTurn(id, dir) {
        if (!(id in this._genMode)) return;
        this._gov[id] = (this._gov[id] || 0) + dir * 0.1;
        this._govAnim[id] = { dir, t: 1 };
        this._refresh();
    }

    /** 声光报警器按钮 */
    onAlarmTest() { this._testT = 2; this._tip('指示灯 / 蜂鸣器测试'); this._refresh(); }
    onAlarmSilence() { this._alarmSilenced = true; this._tip('报警消音（灯转常亮）'); this._refresh(); }
    /** 报警确认：仅当所有报警条件均已消失时，才熄灭对应报警灯 */
    onAlarmAck() {
        const still = Object.keys(this._alarms).filter(k => this._alarms[k]);
        if (still.length) { this._tip('报警未消失，不能确认'); this._refresh(); return; }
        Object.keys(this._alarmLatched).forEach(k => { this._alarmLatched[k] = false; });
        this._alarmSilenced = false;
        this._blinkT = 0;
        this._tip('报警确认');
        this._refresh();
    }
    /** 地气灯测试：按下时若某相接地则该相灯熄灭 */
    onGroundTest() { this._lampTestT = 2; this._tip('地气灯测试'); this._refresh(); }
    /** 设置接地相（'A'/'B'/'C' 或 null） */
    setGround(ph) {
        const m = { A: '1', B: '2', C: '3', L1: '1', L2: '2', L3: '3', 1: '1', 2: '2', 3: '3' };
        this._groundPhase = m[ph] || null;
        this._refresh();
    }
    /** 设置动力电网绝缘阻值（MΩ）；< 0.1 触发绝缘故障报警 */
    setInsulation(v) { this._insulSet = Math.max(0, Number(v) || 0); this._refresh(); }
    getInsulation() { return this._insul; }

    /** 左动力负载屏 QF1~QF8 随机一路负载随机一相接地（不含 QF9/QF10 测试负载）：
     *  该路开关合上 → 电网绝缘降为 0（兆欧表读 0、对应相绝缘指示灯熄灭、绝缘故障报警）；
     *  开关断开 → 绝缘恢复正常 5MΩ。 */
    setLoadGroundFault(on) {
        if (!on) { this._groundFault.active = false; this._refresh(); return; }
        const r = Math.floor(Math.random() * 4);          // 行 0~3 → QF1~QF8
        const c = Math.floor(Math.random() * 2);
        this._groundFault = { active: true, r, c, no: 1 + r * 2 + c, phase: String(1 + Math.floor(Math.random() * 3)) };
        this._tip(`动力负载接地：${(LOAD_NAME[this._groundFault.no] || {}).name || ''}`);
        this._refresh();
    }
    getLoadGroundFault() { return !!this._groundFault.active; }
    getLoadGroundInfo() { return { ...this._groundFault }; }
    /** 设置方形报警灯状态：ins 绝缘故障 / trip 优先脱扣 / short 汇流排短路 / lowv 汇流排电压低 */
    setAlarm(key, on) { if (this._alarms && key in this._alarms) { this._alarms[key] = !!on; this._refresh(); } }

    /** 故障复位：故障排除后按下，熄灭“故障复位”灯 */
    onFaultReset(id) {
        if (this._genFault[id]) { this._tip('机组故障未排除，请先在“故障设置”中复位'); return; }
        this._genTrip[id] = false;
        this._genProt[id] = null;
        if (!['gen1', 'gen2', 'gen3'].some(k => this._genTrip[k])) this._alarms.trip = false;
        this._refresh();
    }
    /** 失压故障注入（用于试验失压保护：U 降为 300V，低于 70% 额定 → 3s 后跳闸） */
    setGenUVFault(id, on) { this._genUVF[id] = !!on; this._refresh(); }
    getGenUVFault(id) { return !!this._genUVF[id]; }
    /** 短路电流注入（用于试验短路保护）：mult 为额定电流的倍数，0 表示解除
     *  例如 3 → 大于 2 倍额定电流，0.4s 后跳闸；6 → 大于 5 倍额定电流，瞬时跳闸 */
    setGenShortFault(id, mult) { this._genShort[id] = Math.max(0, Number(mult) || 0); this._refresh(); }
    getGenShortFault(id) { return this._genShort[id] || 0; }
    /** 机组 I 级故障：自动模式下执行“换机”（先并入第 1 备用机组，负荷转移后解列故障机组） */
    setGenClass1(id, on) {
        if (!(id in this._genFault)) return;
        this._genClass1[id] = !!on;
        if (on) { this._autoBlocked = false; this._tip(`${id.toUpperCase()} I 级故障：自动模式将自动换机`); }
        this._refresh();
    }
    getGenClass1(id) { return !!this._genClass1[id]; }
    /** 机组故障汇总：故障 / I 级故障 / 原动机保护动作 / 未复位的跳闸 → 自动模式下不计入备用机组 */
    _genFaulty(id) {
        return !!(this._genFault[id] || this._genClass1[id] || this._primeFault[id] || this._genTrip[id]);
    }
    /**
     * 原动机保护：冷却水温高 / 滑油压力低 / 超速 → 柴油机组立即停机
     * @param {string} id   机组 id
     * @param {string|null} type 'temp' | 'lo' | 'over'；传 null/false 表示故障排除复位
     */
    setPrimeFault(id, type, on) {
        if (!(id in this._genFault)) return;
        if (!on || !type) {
            const was = this._primeFault[id];
            this._primeFault[id] = null;
            if (was) this._tip(`${id.toUpperCase()} ${PRIME_FAULT[was]}故障已排除，请按“故障复位”后重新投入`);
            this._refresh();
            return;
        }
        this._primeFault[id] = type;
        this._genRun[id] = false;        // 柴油机组立即停机
        this._genCB[id] = false;         // 停机失压 → 主开关分闸
        this._genTrip[id] = true;        // 点亮“故障复位”灯，待复位
        this._swapOut = (this._swapOut && this._swapOut.id === id) ? null : this._swapOut;
        this._tip(`${id.toUpperCase()} ${PRIME_FAULT[type]}：柴油机组立即停机并跳闸`);
        this._refresh();
    }
    getPrimeFault(id) { return this._primeFault[id] || null; }
    /** 该开关携带的铭牌标签（负载屏 / 组合起动屏） */
    _mcbTags(id) {
        if (id.startsWith('ld-')) {
            const [, cab, r, c] = id.split('-');
            const info = LOAD_NAME[(cab === 'loadL' ? 1 : 11) + (+r) * 2 + (+c)];
            return (info && info.tags) || [];
        }
        if (id.startsWith('cm-')) {
            const info = COMBO_NAME[id.slice(3)];
            return (info && info.tags) || [];
        }
        return [];
    }
    /**
     * 岸电开关下端带电指示（由“重要配电装置”岸电箱推送）：
     * 岸电箱合闸且相序开关不在 OFF 位 → 主配电板“岸电开关”下端有电
     */
    setShoreLive(on) {
        this._shoreLower = !!on;
        if (!this._shoreNode) {
            const g = new Konva.Group({ listening: false });
            g.add(new Konva.Line({ points: [-26, 0, 26, 0], stroke: '#ff2020', strokeWidth: 5, lineCap: 'round' }));
            g.add(new Konva.Circle({ x: 0, y: 0, radius: 5, fill: '#ff2020', stroke: '#7a0000', strokeWidth: 1 }));
            this._dynamicGroup.add(g);
            this._shoreNode = g;
        }
        const n = this._mcbNodes['ld-loadR-4-1'];      // 右动力负载屏：岸电开关
        if (n) this._shoreNode.position({ x: n.group.x(), y: n.midY + 38 });
        this._shoreNode.visible(this._shoreLower);
        this._refresh();
    }
    /** 岸电开关下端是否带电 */
    getShoreLive() { return !!this._shoreLower; }

    /** 应急切断：分励脱扣器带电状态（由“重要配电装置”推送） */
    setShuntLive(map) { this._shuntLive = { ...map }; this._refresh(); }
    getShuntLive() { return { ...(this._shuntLive || {}) }; }
    /** 按铭牌标签分励脱扣（负载屏 + 组合起动屏），返回脱扣路数 */
    shuntTripTag(tag) {
        let k = 0;
        Object.keys(this._mcbState).forEach(id => {
            if (!this._mcbState[id]) return;
            if (!this._mcbTags(id).some(t => t.text === tag)) return;
            this._mcbState[id] = false;
            this._mcbTrip[id] = true;         // 手柄停在 TRIP 位
            k++;
        });
        // 仅 PT-1 / PT-2（优先脱扣卸载）触发“优先脱扣”报警；应急切断（ESS-xx）不报警
        if (k && (tag === 'PT-1' || tag === 'PT-2')) this._alarms.trip = true;
        this._refresh();
        return k;
    }
    /** 分励脱扣器带电时，带该标签的开关一律无法合闸（合上即脱扣） */
    _enforceShunt() {
        const live = this._shuntLive || {};
        const tags = Object.keys(live).filter(t => live[t]);
        if (!tags.length) return;
        Object.keys(this._mcbState).forEach(id => {
            if (!this._mcbState[id]) return;
            const hit = this._mcbTags(id).find(t => tags.includes(t.text));
            if (!hit) return;
            this._mcbState[id] = false;
            this._mcbTrip[id] = true;
            this._tip(`应急切断：${hit.text} 分励脱扣器带电，该开关无法合闸`);
        });
    }
    /** 报警条件查询 */
    getAlarm(key) { return !!(this._alarms && this._alarms[key]); }
    /** 自动模式是否被阻塞（汇流排短路） */
    isAutoBlocked() { return !!this._autoBlocked; }
    /** 最近一次保护动作记录（null 表示无） */
    getGenProtection(id) { return this._genProt[id] || null; }
    /** 自动同步（半自动模式下）：6s 后主开关自动合闸，再均分负荷后灯灭 */
    onAutoSync(id) {
        if (this._plantModeOf() !== 'SEMI-AUTO') { this._tip('仅“半自动”模式下允许自动同步'); return; }
        if (!this._genRun[id]) { this._tip('机组未运行'); return; }
        if (this._genCB[id]) { this._tip('主开关已合闸'); return; }
        this._genSync[id] = { phase: 'sync', t: 6 };
        this._refresh();
    }
    /** 自动解列：与其它机组并联时，自动转移负荷至约 20kW，延时 3s 后主开关跳闸 */
    onAutoSplit(id) {
        if (this._genFault[id]) { this._tip('机组故障，无法自动解列'); return; }
        const n = ['gen1', 'gen2', 'gen3'].filter(k => this._genRun[k] && this._genCB[k]).length;
        if (!(this._genRun[id] && this._genCB[id]) || n < 2) { this._tip('本机未与其它发电机并联'); return; }
        this._genSplit[id] = { phase: 'transfer', t: 0 };
        this._refresh();
    }
    getMCBState(id) { return !!this._mcbState[id]; }
    getMotorState(id) { return !!this._motorRun[id]; }
    isBusLive() { return this._busLive(); }

    // ── 参数设置：仅设置每台发电机组的机旁/遥控状态（故障由工具栏故障设置，模式由并车屏控制）──
    getConfigFields() {
        const modeOpts = [{ value: 'remote', label: '遥控' }, { value: 'local', label: '机旁' }];
        return [
            { label: '1#机组控制方式', key: 'gen1Mode', type: 'select', options: modeOpts, get: c => c._genMode.gen1 },
            { label: '2#机组控制方式', key: 'gen2Mode', type: 'select', options: modeOpts, get: c => c._genMode.gen2 },
            { label: '3#机组控制方式', key: 'gen3Mode', type: 'select', options: modeOpts, get: c => c._genMode.gen3 },
        ];
    }

    onConfigUpdate(cfg) {
        ['gen1', 'gen2', 'gen3'].forEach(id => {
            const m = cfg[id + 'Mode'];
            if (m !== undefined) this._genMode[id] = (m === 'local') ? 'local' : 'remote';
        });
        this.config = { ...this.config, ...cfg };
        this._refresh();
    }

    /** 电站运行模式由并车屏“模式选择”开关决定：半自动(-90°)/手动(0°)/自动(90°) */
    _plantModeOf() {
        const p = this._syncPos && this._syncPos.mode;
        const a = p ? p.angs[p.i] : 0;
        return a === -90 ? 'SEMI-AUTO' : (a === 90 ? 'AUTO' : 'HAND');
    }

    /** 同步选择开关所选待并机组：1#(-45°)/2#(0°)/3#(45°)；0 档(-90°/90°)返回 null */
    _syncSelection() {
        const p = this._syncPos && this._syncPos.sync;
        if (!p) return null;
        const a = p.angs[p.i];
        if (a === -45) return 'gen1';
        if (a === 0) return 'gen2';
        if (a === 45) return 'gen3';
        return null;
    }

    /** 备用顺序（按“备用顺序”开关）：123 / 231 / 312 */
    _seqOrder() {
        const p = this._syncPos && this._syncPos.seq;
        const a = p ? p.angs[p.i] : -90;
        if (a === 0) return ['gen2', 'gen3', 'gen1'];
        if (a === 90) return ['gen3', 'gen1', 'gen2'];
        return ['gen1', 'gen2', 'gen3'];
    }

    /** 自动模式控制：失电自动起机并网 / 过载自动并车 / 轻载自动解列 / 频率整定至 60Hz */
    _autoModeTick(dt) {
        // 汇流排短路 → 自动模式阻塞：只报警、不执行任何自动操作
        if (this._autoBlocked || this._plantModeOf() !== 'AUTO') { this._autoFlow = null; this._splitWaitId = null; this._splitStopping = null; this._swapOut = null; return; }
        const order = this._seqOrder();
        const online = ['gen1', 'gen2', 'gen3'].filter(id => this._genRun[id] && this._genCB[id]);
        const n = online.length;
        const load = this._busLoad || 0;

        // 频率自动整定至 60Hz
        if (n > 0 && this._fBus > 1) {
            const err = 60 - this._fBus;
            if (Math.abs(err) > 0.05) {
                const step = Math.sign(err) * 0.1 * dt;
                online.forEach(id => { this._gov[id] = (this._gov[id] || 0) + step; });
            }
        }

        // 解列跳闸后的停机延时（15s）
        if (this._splitStopping) {
            this._splitStopping.t -= dt;
            if (this._splitStopping.t <= 0) { this._genRun[this._splitStopping.id] = false; this._splitStopping = null; }
        }
        if (this._splitWaitId && !this._genSplit[this._splitWaitId] && !this._genCB[this._splitWaitId]) {
            this._splitStopping = { id: this._splitWaitId, t: 15 };
            this._splitWaitId = null;
        }

        const spare = order.find(id => !(this._genRun[id] && this._genCB[id]) && !this._genFaulty(id));   // 有故障的机组自动排除在备用之外

        if (this._autoFlow) {
            const f = this._autoFlow;
            f.t -= dt;
            if (f.t > 0) return;
            if (f.stage === 'start') { this._genRun[f.target] = true; f.stage = 'close'; f.t = f.closeT || 5; }
            else if (f.stage === 'close') {
                this._genCB[f.target] = true;
                const onlineNow = ['gen1', 'gen2', 'gen3'].filter(id => this._genRun[id] && this._genCB[id]);
                if (onlineNow.length > 1) {           // 并车成功：先带 5kW，再自动转移均分
                    this._genP[f.target] = 5;
                    this._genSync[f.target] = { phase: 'transfer' };
                }
                // I 级故障换机：备用机并网后，待负荷转移完毕再解列故障机
                if (f.swapOut) this._swapOut = { id: f.swapOut, target: f.target };
                this._autoFlow = null;
            }
            return;
        }

        // 换机第二步：新机已接带负荷 → 解列并停故障机组
        if (this._swapOut) {
            const { id, target } = this._swapOut;
            if (!this._genSync[target] && this._genCB[target]) {
                this._genCB[id] = false;
                this._genRun[id] = false;
                this._genTrip[id] = true;
                this._tip(`自动换机完成：${target} 已接带负荷，${id} 已解列停机`);
                this._swapOut = null;
            }
            return;
        }

        // 并车/解列流程进行中：不再触发新的自动并车（一次只并一台）
        if (['gen1', 'gen2', 'gen3'].some(id => this._genSync[id] || this._genSplit[id])) return;

        // I 级故障 → 换机：先自动并入第 1 备用机组，再解列故障机组
        const badUnit = online.find(id => this._genClass1[id]);
        if (badUnit) {
            const spareUnit = order.find(id => !(this._genRun[id] && this._genCB[id]) && !this._genFaulty(id));
            if (spareUnit) { this._autoFlow = { stage: 'start', t: 3, target: spareUnit, closeT: 10, swapOut: badUnit }; return; }
        }

        // 电站失电 → 延时 3s 起动第 1 备用机组、再延时 5s 合闸
        if (n === 0 && spare) { this._autoFlow = { stage: 'start', t: 3, target: spare, closeT: 5 }; return; }

        // 在网机组功率 > 750kW（额定 75%）→ 自动并车（合闸延时 10s）
        if (n > 0 && spare && online.some(id => (this._genP[id] || 0) > 750)) {
            this._autoFlow = { stage: 'start', t: 3, target: spare, closeT: 10 };
            return;
        }

        // 电网总功率 < 350kW（单机额定 35%）且在线 ≥2 → 自动解列优先级最低的机组
        if (load < 350 && n >= 2) {
            const target = order.slice().reverse().find(id => online.includes(id));
            if (target && !this._genSplit[target] && !this._splitWaitId && !this._splitStopping) {
                this._genSplit[target] = { phase: 'transfer', t: 0 };
                this._splitWaitId = target;
            }
        }
    }

    _refresh() {
        // 电源开关分断 / 注入故障 → 故障停机（锁存，待“停/复位”清除）；汇流排失电仅停机不置故障
        const busOn = this._busLive();
        Object.keys(this._motorRun).forEach(id => {
            if (!this._motorRun[id]) return;
            if (!this._mcbState[`cm-${id}`] || this._fault[id]) {
                this._motorRun[id] = false;
                this._fault[id] = true;
            } else if (!busOn) {
                this._motorRun[id] = false;   // 失电停机（不置故障）
            }
        });
        // MCB 手柄
        Object.keys(this._mcbNodes).forEach(id => {
            const n = this._mcbNodes[id];
            // 三位置手柄：TRIP（中间，保护/分励脱扣后）→ ON（上）→ OFF（下）
            n.group.y(n.midY + (this._mcbTrip[id] ? 0 : (this._mcbState[id] ? n.on : n.off)));
        });
        // 组合屏指示灯：电源 / 备用 / 运行 / 故障
        Object.keys(this._comboLed || {}).forEach(key => {
            const lens = this._comboLed[key];
            const powerOn = busOn && !!this._mcbState[`cm-${key}`];   // 汇流排有电 + 电源开关闭合
            const run = powerOn && !!this._motorRun[key];
            const auto = this._comboAuto(key);
            const fault = !!this._fault[key];
            if (lens[0]) lens[0].fill(powerOn ? '#f2f6ff' : '#9aa0a6');                    // 电源（亮白）
            if (lens[1]) lens[1].fill((powerOn && auto && !run) ? '#ffdd00' : '#8a6a00');  // 备用（亮黄）
            if (lens[2]) lens[2].fill(run ? '#2eff3e' : '#0f5a12');                        // 运行（亮绿）
            if (lens[3]) lens[3].fill((powerOn && fault) ? '#ff2020' : '#5a0d0d');         // 故障（亮红）
            // 加热器带灯按钮：电源亮、电机停止、加热器开关打到开 → 亮蓝
            const hs = this._comboSel[`${key}-heat`];
            if (hs && hs.bodyNode) {
                const heating = powerOn && !run && this._comboHeatOn(key);
                hs.bodyNode.fill(heating ? '#00c8ff' : hs.baseColor);
            }
        });
        // 发电机圆 / 断路器 / 指示灯
        Object.keys(this._genCircle).forEach(id => {
            this._genCircle[id].fill(this._genRun[id] ? '#22dd22' : '#8a8f96');
            const blade = this._genBlade[id], geom = this._genGeom[id];
            if (blade && geom) {
                if (this._genCB[id]) blade.points([geom.dx, geom.by + 78, geom.dx, geom.by + 36]);
                else blade.points([geom.dx, geom.by + 78, geom.dx - 2 * geom.h * 0.574, geom.by + 78 - 2 * geom.h * 0.819]);
            }
            const led = this._genLed[id];
            if (led) {
                // 准备好：机组处于遥控位、无故障 且 尚未运行
                const remote = this._genMode[id] === 'remote';
                const fault = !!this._genFault[id];
                if (led.ready) led.ready.fill((remote && !this._genFaulty(id) && !this._genRun[id]) ? '#ffd400' : '#3a3a3a');   // 准备好灯：亮黄色
                // 运行灯：发电机处于运行状态
                led.run.fill(this._genRun[id] ? '#ffffff' : '#3a3a3a');
                // 合闸灯：运行 且 已合闸；分闸灯：运行 且 分闸状态
                led.g.fill((this._genRun[id] && this._genCB[id]) ? '#2eff3e' : '#3a3a3a');
                led.r.fill((this._genRun[id] && !this._genCB[id]) ? '#ff3344' : '#3a3a3a');
            }
            const ax = this._genAuxLed[id];
            if (ax) {
                if (ax.reset) ax.reset.node.fill(this._genTrip[id] ? ax.reset.lit : ax.reset.base);
                if (ax.sync)  ax.sync.node.fill(this._genSync[id] ? ax.sync.lit : ax.sync.base);
                if (ax.split) ax.split.node.fill(this._genSplit[id] ? ax.split.lit : ax.split.base);
            }
        });
        // PPU 液晶屏：第 1 行电站模式（居中，自动模式阻塞时显示 BLOCKED），第 2~5 行电压/频率/电流/功率
        const plantMode = this._autoBlocked ? 'BLOCKED' : this._plantModeOf();
        Object.keys(this._ppu || {}).forEach(id => {
            const p = this._ppu[id];
            if (!p) return;
            const v = this._genVal[id] || { U: 0, f: 0, I: 0, P: 0 };
            p.mode.text(plantMode);
            p.u.text(`U：${v.U.toFixed(1)} V`);
            p.f.text(`f：${v.f.toFixed(1)} Hz`);
            p.i.text(`I：${v.I.toFixed(1)} A`);
            p.p.text(`P：${v.P.toFixed(1)} kW`);
        });
        // 汇流排 / 出线 带电着色
        //   发电机出线：发电机起动即变红
        //   开关出线 + 主汇流排 + 所有与汇流排连接的线：任一机组合闸致汇流排带电后变红
        const busLive = this._busLive();
        let recache = false;
        const setCol = (node, col) => { if (node && node.stroke() !== col) { node.stroke(col); recache = true; } };
        setCol(this._busLine, busLive ? BUS_LIVE : BUS_DEAD);
        Object.keys(this._genBusWire || {}).forEach(id => {
            setCol(this._genBusWire[id], busLive ? BUS_LIVE : '#1a252f');
            const outLive = !!this._genRun[id] || (this._genCB[id] && busLive);
            setCol(this._genOutWire[id], outLive ? BUS_LIVE : '#1a252f');
        });
        if (recache && typeof this._refreshCache === 'function') this._refreshCache();
        this.markDirty();
        if (this.sys && typeof this.sys.requestRedraw === 'function') this.sys.requestRedraw();
    }

    tick(dt) {
        // 并车屏同步表指针 + 灯光旋转法：取决于“同步选择”开关
        const sel = this._syncSelection();
        const fBus = (this._fBus != null) ? this._fBus : 0;
        if (sel && this._genRun[sel]) {
            if (this._genCB[sel]) {
                this._syncAngle = 0;                                  // 已并联：同频同相，指针指 12 点不动
            } else {
                const df = (60.1 + (this._gov[sel] || 0)) - fBus;     // 待并机 与 当前电网频率 之差
                if (Math.abs(df) >= 0.01) {
                    const spd = Math.max(-1080, Math.min(1080, 360 * df));   // 周期 = 1/|Δf|（限速）
                    this._syncAngle = ((this._syncAngle + spd * dt) % 360 + 360) % 360;
                }
            }
        }
        if (this._synNeedle) this._synNeedle.rotation(sel ? this._syncAngle : 0);
        if (this._syncLamps) {
            const rad = this._syncAngle * Math.PI / 180;
            this._syncLamps.forEach((lamp, i) => {
                if (!sel || !this._genRun[sel]) { lamp.fill('#123a15'); return; }
                // 指针 12 点时上方灯最暗；顺时针依次 上→右下→左下→上 变亮
                const b = 0.5 - 0.5 * Math.cos(rad - i * 2 * Math.PI / 3);   // 0~1
                lamp.fill(`rgb(${Math.round(18 + 42 * b)},${Math.round(58 + 197 * b)},${Math.round(22 + 60 * b)})`);
            });
        }
        this._comboAutoTick(dt);
        this._genTick(dt);
        this._protectionTick(dt);
        this._autoModeTick(dt);
        // 任一发电机主开关跳闸 → 优先脱扣故障自动消失（消音后可直接按报警确认复位报警灯）
        let cbTripped = false;
        ['gen1', 'gen2', 'gen3'].forEach(id => {
            if (this._genCBWas[id] && !this._genCB[id]) cbTripped = true;
            this._genCBWas[id] = !!this._genCB[id];
        });
        if (cbTripped) this._alarms.trip = false;
        this._enforceShunt();          // 应急切断：分励脱扣器带电 → 相关开关强制脱扣
        // 汇流排短路：自动模式下只报警不处理 → 模式显示 BLOCKED；
        // 必须切回“手动”且排除短路故障，才能恢复自动模式
        if (this._alarms.short && this._plantModeOf() === 'AUTO') this._autoBlocked = true;
        if (this._autoBlocked && this._plantModeOf() === 'HAND' && !this._alarms.short) this._autoBlocked = false;
        // 调速开关手柄：转动保持 1s 后自复位指向上方
        ['gen1', 'gen2', 'gen3'].forEach(id => {
            const a = this._govAnim[id], node = this._govNodes[id];
            if (!node) return;
            if (a) {
                a.t -= dt;
                if (a.t <= 0) { this._govAnim[id] = null; node.rotation(0); }
                else node.rotation(a.dir * 40);
            }
        });
        // 左动力负载屏随机接地故障：该路开关合上 → 绝缘为 0；断开 → 恢复正常 5MΩ
        const gf = this._groundFault;
        const gfOn = !!(gf.active && this._mcbState[`ld-loadL-${gf.r}-${gf.c}`]);
        this._insul = gfOn ? 0 : this._insulSet;
        if (this._lampTestT > 0) this._lampTestT = Math.max(0, this._lampTestT - dt);
        const testing = this._lampTestT > 0;
        // 绝缘指示灯（地气灯）：按住测试按钮时，接地相灯熄灭；松开后三灯全亮
        const gp = gfOn ? gf.phase : (this._groundPhase || null);
        if (this._glLamps) {
            ['L1', 'L2', 'L3'].forEach(ph => {
                const lamp = this._glLamps[ph];
                if (lamp) lamp.fill((testing && gp === ph.slice(1)) ? '#123a15' : '#2eff3e');
            });
        }
        // 配电板式兆欧表：与绝缘指示灯互斥 —— 按下试灯按钮时暂停测量、显示 ∞（指针最左）
        if (this._megText) this._megText.text(testing ? '∞' : this._insul.toFixed(2));
        if (this._megNeedle && this._megT) {
            this._megNeedle.rotation(testing ? -90 : -90 + 180 * this._megT(this._insul));
        }
        const insOk = this._insul >= 0.1;
        if (this._megState) {
            this._megState.text(testing ? '试灯' : (insOk ? '正常' : '接地'));
            this._megState.fill(testing ? '#e8c14a' : (insOk ? '#20a030' : '#d02020'));
        }
        this._alarms.ins = !insOk;
        // ── 报警锁存：4 种报警任一新出现 → 锁存 + 重新鸣响/闪烁；需"故障消失 + 报警确认"才复位 ──
        const genFault = ['gen1', 'gen2', 'gen3'].some(id => this._genFault[id]);
        let newAlarm = false;
        Object.keys(this._alarms).forEach(k => {
            const cond = !!this._alarms[k];
            if (cond && !this._alarmWas[k]) { this._alarmLatched[k] = true; newAlarm = true; }
            this._alarmWas[k] = cond;
        });
        if (genFault && !this._faultWas) newAlarm = true;
        this._faultWas = genFault;
        if (newAlarm) this._alarmSilenced = false;          // 新报警 → 恢复鸣响 + 闪烁
        // 声光报警器：任一报警/机组故障 → 蜂鸣器响（消音后停）；测试按钮灯亮 2s
        const anyFault = genFault || Object.keys(this._alarms).some(k => this._alarms[k]);
        if (this._testT > 0) this._testT = Math.max(0, this._testT - dt);
        if (this._testLed) this._testLed.fill(this._testT > 0 ? '#ff2020' : '#0a0a0a');
        if (this._buzzerNode) this._buzzerNode.fill(((anyFault && !this._alarmSilenced) || this._testT > 0) ? '#ff2020' : '#3a0000');
        // 4 个方形报警灯：测试时全亮；锁存显示（未消音 → 闪烁，消音后 → 常亮）
        if (this._alarmLampNodes) {
            const lampColors = { ins: '#ff2020', trip: '#ff9d00', short: '#ff2020', startfail: '#ffdd00' };
            this._blinkT += dt;
            const blinkOn = this._blinkT % 0.8 < 0.4;
            Object.keys(this._alarmLampNodes).forEach(k => {
                const on = this._testT > 0 || (this._alarmLatched[k] && (this._alarmSilenced || blinkOn));
                this._alarmLampNodes[k].fill(on ? lampColors[k] : '#2a2f34');
            });
        }
        this._refresh();
    }

    /**
     * 发电机电气量仿真：
     *   - 起动后 5s 内建压（200→450V）、建频（30→60.1Hz）
     *   - 主开关未合闸前 电流/功率 = 0
     *   - 主开关合闸后 功率按母线负载平均分担，频率按调差系数 4% 下降（空载→满载降 60×4%=2.4Hz）
     *   - 电流 I = P /(√3·U·cosφ)，cosφ 取 0.86
     */
    _genTick(dt) {
        const S = this._mcbState;
        // 1) 汇流排负载（kW）
        let load = 0;
        if (S['ld-loadL-2-0'] || S['ld-loadR-2-0']) load += 100;   // 1#/2#日用变压器：100kW 照明
        const MP = [100, 80, 60, 40, 20];                          // 各栏电动机功率（海水/高温淡水/滑油/燃油/风机）
        Object.keys(this._motorRun).forEach(key => {
            if (!this._motorRun[key]) return;
            const row = parseInt(key.split('-')[1], 10);
            if (MP[row] != null) load += MP[row];
        });
        if (S['ld-loadL-4-0']) load += 400;                        // 测试负载1（400kW）
        if (S['ld-loadL-4-1']) load += 600;                        // 测试负载2（600kW）
        if (S['ld-loadR-4-0']) load += 80;                         // 应急配电板：固定 80kW
        this._busLoad = load;

        // 2) 机组故障 → 主开关故障跳闸（点亮“故障复位”灯，待复位）
        ['gen1', 'gen2', 'gen3'].forEach(id => {
            if (this._genFault[id] && this._genCB[id]) { this._genCB[id] = false; this._genTrip[id] = true; }
        });

        // 3) 自动同步 / 自动解列 计时
        ['gen1', 'gen2', 'gen3'].forEach(id => {
            const sy = this._genSync[id];
            if (sy) {
                if (sy.phase === 'sync') {
                    sy.t -= dt;
                    if (sy.t <= 0) { this._genCB[id] = true; this._genP[id] = 5; sy.phase = 'transfer'; }   // 并入后先承担 5kW
                } else if (sy.phase === 'done') {
                    sy.t -= dt;
                    if (sy.t <= 0) this._genSync[id] = null;
                }
            }
            const sp = this._genSplit[id];
            if (sp && sp.phase === 'delay') {
                sp.t -= dt;
                if (sp.t <= 0) { this._genCB[id] = false; this._genSplit[id] = null; this._genP[id] = 0; }
            }
        });

        // 4) 在线机组（运行且合闸）
        const online = ['gen1', 'gen2', 'gen3'].filter(id => this._genRun[id] && this._genCB[id]);
        const n = online.length;
        ['gen1', 'gen2', 'gen3'].forEach(id => {
            if (!online.includes(id)) this._genP[id] = 0;
            else if (this._genP[id] == null) this._genP[id] = load / n;
        });

        // 5) 负荷分配：无进行中的流程时按调速器整定分配；流程中（转移/保持）按规则调整
        const gov = id => this._gov[id] || 0;
        const meanGov = n > 0 ? online.reduce((a, id) => a + gov(id), 0) / n : 0;
        const active = online.filter(id => this._genSync[id] || this._genSplit[id]);
        if (this._loadPrev == null) this._loadPrev = load;
        const dLoad = load - this._loadPrev;
        this._loadPrev = load;
        ['gen1', 'gen2', 'gen3'].forEach(id => { if (!online.includes(id)) this._genP[id] = 0; });
        if (n > 0) {
            if (active.length === 0) {
                // 以各机实际功率为准：新增/减少的电网功率按调差（等调差→均分）分配；
                // 调速整定变化按 0.1Hz ↔ 20kW 在本机与其余机组间转移
                online.forEach(id => { if (this._genP[id] == null || this._genP[id] <= 0) this._genP[id] = load / n; });
                if (Math.abs(dLoad) > 0.001) online.forEach(id => { this._genP[id] = Math.max(0, this._genP[id] + dLoad / n); });
                if (!this._govSeen) this._govSeen = {};
                online.forEach(id => {
                    const g = gov(id);
                    const g0 = (this._govSeen[id] != null) ? this._govSeen[id] : g;
                    this._govSeen[id] = g;
                    const dg = g - g0;
                    if (Math.abs(dg) > 0.001) {
                        const tr = (dg / 0.1) * 20;      // 每 0.1Hz 转移 20kW
                        this._genP[id] = Math.max(0, this._genP[id] + tr);
                        const others = online.filter(k => k !== id);
                        if (others.length) others.forEach(k => { this._genP[k] = Math.max(0, this._genP[k] - tr / others.length); });
                    }
                });
                // 归一化使 ΣP = 总负载（保持相对比例）
                const sum = online.reduce((a, id) => a + this._genP[id], 0);
                if (sum > 0.001 && Math.abs(sum - load) > 1) {
                    const k2 = load / sum;
                    online.forEach(id => { this._genP[id] = Math.max(0, this._genP[id] * k2); });
                }
            } else {
                const eq = load / n;
                online.forEach(id => {
                    const isSyncTr = !!(this._genSync[id] && this._genSync[id].phase === 'transfer');
                    const isSplitTr = !!(this._genSplit[id] && this._genSplit[id].phase === 'transfer');
                    if (!isSyncTr && !isSplitTr) return;          // 保持态（sync 完成 / split 延时）功率不变
                    const dir = isSyncTr ? (eq > this._genP[id] ? 1 : -1) : -1;
                    this._genP[id] = Math.max(0, this._genP[id] + dir * 10 * dt);
                });
                const trSum = active.reduce((a, id) => a + this._genP[id], 0);
                const others = online.filter(id => !active.includes(id));
                if (others.length) {
                    // 留在电网的机组按当前出力比例分配剩余负荷
                    const rem = Math.max(0, load - trSum);
                    const sumOthers = others.reduce((a, id) => a + this._genP[id], 0);
                    if (sumOthers > 0.001) others.forEach(id => { this._genP[id] = rem * this._genP[id] / sumOthers; });
                    else others.forEach(id => { this._genP[id] = rem / others.length; });
                } else {
                    const s = trSum || 1;
                    active.forEach(id => { this._genP[id] *= load / s; });
                }
            }
        }

        // 6) 逐台计算（公共频率由总负载与在线总额定决定）
        const eqShare = n > 0 ? load / n : 0;
        const fCommon = n > 0 ? (60.1 + meanGov - (load / (n * 1000)) * 2.4) : 60.1;
        this._fBus = n > 0 ? fCommon : 0;   // 电网失电时默认频率为 0
        ['gen1', 'gen2', 'gen3'].forEach(id => {
            const run = !!this._genRun[id];
            this._genT[id] = run ? Math.min(5, (this._genT[id] || 0) + dt) : 0;
            const ramp = this._genT[id] / 5;                       // 0~1（5s 建压/建频）
            const U = run ? (this._genUVF[id] ? 300 : (200 + 250 * ramp)) : 0;   // 失压故障注入 → 300V（<70% 额定）
            let f = run ? (30 + (60.1 - 30) * ramp) : 0;
            let P = 0, I = 0;
            if (run && this._genT[id] >= 5) {
                // 已合闸：频率 = 电网频率；未合闸：频率 = 本机空载频率（含调速整定）
                f = (this._genCB[id] && n > 0) ? fCommon : (60.1 + gov(id));
            }
            if (run && this._genCB[id] && n > 0) {
                P = this._genP[id];
                I = U > 0 ? P * 1000 / (Math.sqrt(3) * U * 0.86) : 0;
                if (this._genShort[id]) I *= this._genShort[id];   // 短路电流注入
            }
            this._genVal[id] = { U, f, I, P };
            // 自动同步：负荷基本均分 → 结束（灯灭）
            const sy = this._genSync[id];
            if (sy && sy.phase === 'transfer' && Math.abs(P - eqShare) <= 2) { sy.phase = 'done'; sy.t = 1; }
            // 自动解列：出力降至约 20kW → 延时 3s → 跳闸
            const sp = this._genSplit[id];
            if (sp && sp.phase === 'transfer' && P <= 20.5) { sp.phase = 'delay'; sp.t = 3; }
        });
    }

    /**
     * 发电机保护（每台机组独立判断，仅在“运行 + 主开关合闸”时投入）：
     *   1. 失压保护：U < 40%Ue 瞬时跳闸；U < 70%Ue 延时 3s 跳闸
     *   2. 短路保护：I > 5Ie 瞬时跳闸；I > 2Ie 延时 0.4s 跳闸
     *   3. 过载保护：P > 120%Pe 延时 5s → 一级卸载（PT-1 分励脱扣）；
     *      仍 > 110%Pe 再延时 5s → 二级卸载（PT-2 分励脱扣）；仍过载再延时 5s → 主开关跳闸
     *   4. 逆功率保护：逆功率 > 10%Pe 延时 8s → 主开关跳闸
     */
    _protectionTick(dt) {
        const Ue = 450, Pe = 1000;
        const Ie = Pe * 1000 / (Math.sqrt(3) * Ue * 0.86);      // 额定电流 ≈ 1492A
        const fBus = (this._fBus != null) ? this._fBus : 0;
        ['gen1', 'gen2', 'gen3'].forEach(id => {
            const v = this._genVal[id] || { U: 0, I: 0, P: 0 };
            const t = this._protT[id] || (this._protT[id] = { uv: 0, oc: 0, rev: 0 });
            if (this._olStage[id] === undefined) this._olStage[id] = 0;
            if (this._olT[id] === undefined) this._olT[id] = 0;
            if (!this._genCB[id]) {                             // 主开关未合闸 → 保护不投入、计时清零
                t.uv = t.oc = t.rev = 0; this._olT[id] = 0;
                return;
            }
            const trip = reason => {
                this._genCB[id] = false;
                this._genTrip[id] = true;
                this._genProt[id] = reason;
                this._olStage[id] = 0; this._olT[id] = 0;
                t.uv = t.oc = t.rev = 0;
                this._tip(`${id.toUpperCase()} ${reason} → 主开关跳闸`);
            };
            // 1) 失压
            if (v.U < 0.4 * Ue) { trip('失压保护动作（低于40%额定电压，瞬时）'); return; }
            if (v.U < 0.7 * Ue) { t.uv += dt; if (t.uv >= 3) { trip('失压保护动作（低于70%额定电压，延时3s）'); return; } }
            else t.uv = 0;
            // 2) 短路
            if (v.I > 5 * Ie) { trip('短路保护动作（大于5倍额定电流，瞬时）'); return; }
            if (v.I > 2 * Ie) { t.oc += dt; if (t.oc >= 0.4) { trip('短路保护动作（大于2倍额定电流，延时0.4s）'); return; } }
            else t.oc = 0;
            // 3) 逆功率（由调速整定与电网频率推算本机自然功率，负值即逆功率）
            const revP = Math.max(0, -(((60.1 + (this._gov[id] || 0)) - fBus) / 2.4 * 1000));
            if (revP > 0.1 * Pe) { t.rev += dt; if (t.rev >= 8) { trip('逆功率保护动作（逆功率大于10%额定功率，延时8s）'); return; } }
            else t.rev = 0;
            // 4) 过载（分级卸载）
            const st = this._olStage[id];
            const thr = st === 0 ? 1.2 * Pe : (st === 1 ? 1.1 * Pe : Pe);
            if (v.P > thr) {
                this._olT[id] += dt;
                if (this._olT[id] >= 5) {
                    this._olT[id] = 0;
                    if (st === 0) {
                        const k = this._shuntTripByTag('PT-1');
                        this._alarms.trip = true;
                        this._genProt[id] = '过载一级卸载（PT-1 分励脱扣）';
                        this._tip(`过载保护：一级卸载，PT-1 开关分励脱扣（${k} 路）`);
                        this._olStage[id] = 1;
                    } else if (st === 1) {
                        const k = this._shuntTripByTag('PT-2');
                        this._alarms.trip = true;
                        this._genProt[id] = '过载二级卸载（PT-2 分励脱扣）';
                        this._tip(`过载保护：二级卸载，PT-2 开关分励脱扣（${k} 路）`);
                        this._olStage[id] = 2;
                    } else {
                        trip('过载保护动作（卸载后仍过载，延时5s）');
                    }
                }
            } else {
                this._olT[id] = 0;
                if (v.P <= Pe) { this._olStage[id] = 0; this._genProt[id] = null; }   // 恢复正常 → 复位分级
            }
        });
    }

    /** 分励脱扣：按铭牌标签（PT-1 / PT-2）分断所有对应负载开关（手柄停在 TRIP 位），返回分断路数 */
    _shuntTripByTag(tag) {
        let k = 0;
        [['loadL', 1], ['loadR', 11]].forEach(([cab, base]) => {
            for (let r = 0; r < 5; r++) {
                for (let c = 0; c < 2; c++) {
                    const info = LOAD_NAME[base + r * 2 + c];
                    if (!info || !info.tags || !info.tags.some(t => t.text === tag)) continue;
                    const key = `ld-${cab}-${r}-${c}`;
                    if (!this._mcbState[key]) continue;
                    this._mcbState[key] = false;      // 分断
                    this._mcbTrip[key] = true;        // 手柄停在 TRIP 位
                    k++;
                }
            }
        });
        if (k && (tag === 'PT-1' || tag === 'PT-2')) this._alarms.trip = true;   // 优先脱扣报警（仅 PT-1/PT-2）
        return k;
    }

    /**
     * 组合屏自动/备用逻辑：
     *   A. 汇流排恢复供电（上升沿，仅触发一次）：带 SQ 标签且自动的机组按 SQ 顺序延时起动
     *      （SQ1→1s、SQ2→5s、SQ3→10s、SQ4→15s），此阶段不启用 3s 逻辑。
     *   B. 稳定供电（汇流排持续带电 ≥3min）后，恢复常规自动逻辑：
     *      自动 + 未运行 → 若另一组合屏同一行电机运行则为备用（备用灯亮，不自动起动）；
     *      否则延时 3s 自动起动。
     *   C. 任何阶段：本机备用时，若主用机组（另一组合屏同一行）故障 → 本机立即自动起动。
     */
    _comboAutoTick(dt) {
        const busOn = this._busLive();
        const rising = busOn && !this._busWasLive;   // 汇流排恢复供电（上升沿）
        this._busWasLive = busOn;
        this._busLiveT = busOn ? (this._busLiveT + dt) : 0;
        const stable = this._busLiveT >= STABLE_DELAY;   // 稳定供电（≥3min）

        Object.keys(this._comboLed || {}).forEach(key => {
            if (this._sqT[key] === undefined) this._sqT[key] = null;
            if (this._autoT[key] === undefined) this._autoT[key] = 3;
            const powerOn = busOn && !!this._mcbState[`cm-${key}`];
            const auto = this._comboAuto(key);
            const run = !!this._motorRun[key];
            const delay = comboAutoDelay(COMBO_NAME[key]);

            // A. 汇流排恢复供电：带 SQ 标签且自动 → 装载顺序起动延时（仅此一次）
            if (rising && auto && delay != null) this._sqT[key] = delay;

            if (!(powerOn && auto && !run)) {
                if (run) this._sqT[key] = null;
                this._autoT[key] = 3;
                return;
            }
            const [panel, row] = key.split('-');
            const otherKey = `${panel === 'comboL' ? 'comboR' : 'comboL'}-${row}`;

            // C. 备用状态 + 主用机组故障 → 本机自动起动
            if (this._fault[otherKey]) {
                this._motorRun[key] = true;
                this._sqT[key] = null;
                return;
            }
            if (!stable) {
                // A 阶段：按 SQ 顺序延时起动
                if (this._sqT[key] != null) {
                    this._sqT[key] -= dt;
                    if (this._sqT[key] <= 0) {
                        this._sqT[key] = null;
                        this._motorRun[key] = true;
                    }
                }
            } else {
                // B 阶段（稳定供电）：另一屏对应行运行 → 备用；否则延时 3s 自动起动
                if (this._motorRun[otherKey]) {
                    this._autoT[key] = 3;
                } else {
                    this._autoT[key] -= dt;
                    if (this._autoT[key] <= 0) {
                        this._autoT[key] = 3;
                        this._motorRun[key] = true;
                    }
                }
            }
        });
    }

    destroy() { super.destroy?.(); }
}
