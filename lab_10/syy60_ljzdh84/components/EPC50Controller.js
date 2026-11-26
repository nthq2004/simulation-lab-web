import Konva from 'konva';
import { BaseComponent } from './BaseComponent.js';

/**
 * EPC50Controller — Alfa Laval EPC-50 分油机控制器
 *   （上：EPC-50 操作面板 OP　下：电机起动控制箱，合成一个组件）
 *
 * ── 上半部：EPC-50 操作面板（OP）────────────────────────────
 *   · 左上：分油机流程图（8 只状态灯 + T1/T2/M1/M2/V4/V5/SV1 + 工作水阀组 1/2/3）
 *   · 左下：INFO 信息区（状态 / 转速 / 油温 / 到下次排渣时间）
 *   · 中下：液晶显示器（黑底红字，如「Standst」）+「−」「+」「ENTER」三只按键
 *   · 右侧：6 只功能键，每只键上方带一只状态指示灯
 *           HEATER / SEPARATOR / STOP / DISCHARGE / OPERATIVE / ALARM
 *
 * ── 下半部：电机起动控制箱 ────────────────────────────────
 *   · 左：START FEED PUMP / START MOTOR / STOP FEED PUMP / STOP MOTOR 四只按钮
 *   · 中：MOTOR CURRENT 电机电流表（0~25 A）
 *   · 中下：SEPARATOR MODE（CIP 左 60° / MAN 垂直向上 / AUT 右 60°）、
 *          POWER SWITCH（OFF / ON）旋转开关
 *   · 右：BUZZER 蜂鸣器、EMCY STOP 应急停止
 *
 * ── 控制逻辑（参照 EPC-60，见 tools/PurifierSolver.js）──────
 *   · SEPARATOR MODE 打到 AUT（右 60°）→ 由本控制器远程自动控制（等价 EPC-60 的 EPC 位）
 *     打到 MAN（垂直向上）→ 机旁手动；
 *     打到 CIP（左 60°）→ 清洗模式（本仿真不实现），系统停止、控制指令不响应
 *   · AUT 位按「SEPARATOR」键依次推进 5 步起动：
 *     问答确认 → 供油泵 → 加热器（≥96 ℃）→ 电机（≥10000 r/min）
 *     → 按「OPERATIVE」投入分离程序
 *   · 「STOP」= 停止程序；「DISCHARGE」= 手动排渣；「ALARM」= 报警确认与复位；
 *     「HEATER」= 加热器投切；「ENTER」= 菜单确认 / 起动问询确认
 */
export class EPC50Controller extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.W = Math.max(640, config.width || 650);
        this.H = Math.max(680, config.height || 760);
        this.type = 'epc50_controller';
        this.cache = 'fixed';

        this._ui = {
            page: 'main',          // main / menu / params / time / alarms / info
            menu: 0,
            param: 0,
            editing: false,
            editVal: 0,
            question: false,       // 起动问询画面
            asked: false,          // 是否已回答起动问询
            answer: 'YES',         // 闪烁选项：YES / NO
            cipMode: false,        // SEPARATOR MODE 处于 CIP（清洗位，本仿真不实现）
            lastState: '',
            // ── 手动（MAN）操作时序 ──
            manStage: null,        // null | 'quiz' | 'ready' | 'wait' | 'standby' | 'run'
            quizIdx: 0,            // 当前问询序号 0~2
            quizAns: [],           // 已答结果（true=YES / false=NO）
        };

        this._initGroups();
        this._recalcGeometry();
        this._init();
        this._syncVisuals();

        this.config = { id: this.id, width: this.W, height: this.H };
    }

    _solver() {
        return this.sys && this.sys.purifierSolver ? this.sys.purifierSolver : null;
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
            op: { x: 8, y: 8, w: W - 16, h: 360 },
            mb: { x: 8, y: 376, w: W - 16, h: 376 },

            // ── OP 面板 ──
            // INFO 宽 210 → 160（−50），液晶屏相应左扩并加宽 212 → 262（+50），右缘仍在 456；
            // 液晶屏高度 74 → 94（+20），三只按键随之下移 20。
            mimic: { x: 22, y: 22, w: 434, h: 178 },
            info: { x: 22, y: 206, w: 160, h: 146 },
            lcd: { x: 194, y: 206, w: 262, h: 94 },
            keys: { x: 222, y: 308, w: 64, h: 44, gap: 7 },   // 居中于液晶屏下方（194…456）
            // 右侧按钮区：5 个圆角分组框（HEATER / SEPARATION+STOP / DISCHARGE / OP ACTIVE / ALARM）
            fn: {
                x: 466, w: 170,
                boxes: [
                    { id: 'heater', y: 22, h: 58 },
                    // 分离与停止共用一只按钮：上灯在按钮左上、下灯在按钮左下（相对按钮对称）
                    { id: 'sep', y: 88, h: 70 },
                    { id: 'discharge', y: 166, h: 58 },
                    { id: 'op', y: 232, h: 50 },
                    { id: 'alarm', y: 290, h: 62 },
                ],
                lampDX: 14, lampDY: 14,          // 上指示灯（按钮左上）相对框左上角
                btnX: 8, btnY: 20, btnW: 38, btnH: 30,   // 黑色按钮相对框左上角
                iconDX: 84, iconDY: 36,          // 图标中心相对框左上角
                labX: 45, labY: 9, labW: 78,     // 文字：位于图标正上方（x 为左边界，宽 labW 居中）
            },

            // ── 电机起动控制箱 ──
            push: {
                feedStart: { cx: 68, cy: 455, r: 27 },
                motorStart: { cx: 196, cy: 455, r: 27 },
                feedStop: { cx: 68, cy: 561, r: 27 },
                motorStop: { cx: 196, cy: 561, r: 27 },
            },
            ammeter: {
                plate: { x: 276, y: 386, w: 150, h: 26 },
                box: { x: 278, y: 416, w: 146, h: 150 },
                R: 48, dialDY: 60,
            },
            // 蜂鸣器：相对原位下移 30、左移 30（标牌随之居中对齐）
            buzzer: { plate: { x: 480, y: 416, w: 110, h: 26 }, cx: 535, cy: 500, r: 28 },
            // 分离模式：右移对准电流表中心（351）；档位 CIP(-60°) / MAN(0°) / AUT(+60°)
            sepMode: {
                plate: { x: 280, y: 600, w: 142, h: 24 },
                box: { x: 287, y: 630, w: 128, h: 100 }, cx: 351, cy: 676, R: 30,
            },
            // 电源开关：左移对准两组起停按钮的中间（68 与 196 → 132）
            powerSw: {
                plate: { x: 61, y: 600, w: 142, h: 24 },
                box: { x: 68, y: 630, w: 128, h: 100 }, cx: 132, cy: 676, R: 30,
            },
            // 应急停止：左移 30（与蜂鸣器同轴）
            emcy: { plate: { x: 476, y: 600, w: 118, h: 24 }, cx: 535, cy: 680, r: 36 },
        };

        // ── 流程图（mimic 局部坐标）───────────────────────────
        const M = this._geo.mimic;
        const ox = M.x, oy = M.y;
        const LY = oy + 36;                  // 主流程线（下移，为指示泡 / 气动膜头留出顶部空间）
        this._mimic = {
            lineY: LY,
            // 指示泡（圆形，r=6）：run=运行时亮绿；sensor=故障时红
            bubbles: [
                { id: 'led-feed', x: ox + 60, y: LY - 24, kind: 'run', text: '供油泵运行指示灯' },
                { id: 'led-heat', x: ox + 97, y: LY - 24, kind: 'run', text: '加热器投入指示灯' },
                { id: 'led-tt', x: ox + 134, y: LY - 24, kind: 'sensor', text: 'TT1 进油温度（故障时红灯）' },
                { id: 'led-pt1', x: ox + 170, y: LY - 24, kind: 'sensor', text: 'PT1 进油压力（故障时红灯）' },
                { id: 'led-mt', x: ox + 300, y: LY - 24, kind: 'sensor', text: 'MT 净油水分（故障时红灯）' },
                { id: 'led-pt4', x: ox + 336, y: LY - 24, kind: 'sensor', text: 'PT4 净油出口压力（故障时红灯）' },
                { id: 'led-pt5', x: ox + 336, y: oy + 92, kind: 'sensor', text: 'PT5 排水压力（故障时红灯）' },
            ],
            // 分离机内部圆 = 分油机电机运行指示灯
            motorLamp: { id: 'led-bowl', x: ox + 288, y: oy + 116, r: 9 },
            valves: [
                { id: 'valve-v1', x: ox + 206, y: oy + 36, tag: '', hw: 12, hh: 8,
                  tip: '三通阀 V1：通气时向分离筒供油，失气时切到回油口把油送回沉淀柜' },
                { id: 'valve-v4', x: ox + 372, y: oy + 36, tag: '', hw: 12, hh: 8,
                  tip: '净油出口阀 V4（气关式气动阀）' },
                { id: 'valve-v5', x: ox + 386, y: oy + 116, tag: '', hw: 12, hh: 8,
                  tip: '出水阀 V5（气开式气动阀，把分离出的水排到接水盘 / 水柜）' },
                { id: 'valve-w1', x: ox + 38, y: oy + 118, tag: '16', hw: 9, hh: 6,
                  tip: '电磁阀 SV16（密封水 / 补偿水）' },
                { id: 'valve-w2', x: ox + 74, y: oy + 118, tag: '15', hw: 9, hh: 6,
                  tip: '电磁阀 SV15（开启水，打开活动排渣底盘）' },
                { id: 'valve-w3', x: ox + 110, y: oy + 118, tag: '10', hw: 9, hh: 6,
                  tip: '电磁阀 SV10（水封 / 置换水）' },
            ],
        };
    }

    // ═══════════════════════════════════════════════════════════
    //  绘制工具
    // ═══════════════════════════════════════════════════════════
    _label(g, x, y, text, size = 13, fill = '#263238', bold = false, align = 'left', width = 0) {
        const opts = {
            x, y, text, fontSize: size,
            fontStyle: bold ? 'bold' : 'normal',
            fill, align, fontFamily: 'Arial, "Microsoft YaHei", sans-serif',
        };
        if (width) opts.width = width;
        g.add(new Konva.Text(opts));
    }

    /** 白色标签牌（电机起动控制箱上的小标牌） */
    _namePlate(g, box, text, size = 12) {
        g.add(new Konva.Rect({
            x: box.x, y: box.y, width: box.w, height: box.h, cornerRadius: 3,
            fill: '#ffffff', stroke: '#0b4a9c', strokeWidth: 1,
        }));
        this._label(g, box.x + 4, box.y + (box.h - size) / 2 - 1, text, size, '#0b1a2b', true, 'center', box.w - 8);
    }

    /** 旋转开关底座：白色外框 + 黑色圆面（指示条在动态层） */
    _drawKnobBase(g, cx, cy, R) {
        g.add(new Konva.Circle({ x: cx, y: cy, radius: R, fill: '#ffffff', stroke: '#9aa0a0', strokeWidth: 1.2 }));
        g.add(new Konva.Circle({ x: cx, y: cy, radius: R - 7, fill: '#141414', stroke: '#000000', strokeWidth: 1 }));
    }

    /** 阀符号（两三角对顶）：data 字符串 */
    _valveData(cx, cy, hw = 13, hh = 8) {
        return `M ${cx - hw} ${cy - hh} L ${cx} ${cy} L ${cx - hw} ${cy + hh} Z `
            + `M ${cx + hw} ${cy - hh} L ${cx} ${cy} L ${cx + hw} ${cy + hh} Z`;
    }

    // ── 功能键图标（黑色线稿，画在白色分组框内）────────────────
    _iconHeat(g, cx, cy, s = 22) {
        g.add(new Konva.Rect({
            x: cx - s * 0.50, y: cy - s * 0.50, width: s, height: s,
            stroke: '#111111', strokeWidth: 1.7,
        }));
        g.add(new Konva.Line({
            points: [cx - s * 0.32, cy + s * 0.20, cx - s * 0.11, cy - s * 0.20,
                cx + s * 0.10, cy + s * 0.20, cx + s * 0.31, cy - s * 0.20],
            stroke: '#111111', strokeWidth: 1.7, lineJoin: 'round', lineCap: 'round',
        }));
    }

    _iconSeparator(g, cx, cy, s = 24) {
        // 分离筒（上宽下窄的碗体 + 内部碟片）
        g.add(new Konva.Line({
            points: [cx - s * 0.44, cy - s * 0.34, cx + s * 0.44, cy - s * 0.34,
                cx + s * 0.22, cy + s * 0.36, cx - s * 0.22, cy + s * 0.36],
            closed: true, fill: '#ffffff', stroke: '#111111', strokeWidth: 1.7, lineJoin: 'round',
        }));
        g.add(new Konva.Line({ points: [cx - s * 0.16, cy - s * 0.34, cx - s * 0.16, cy + s * 0.16], stroke: '#111111', strokeWidth: 1.1 }));
        g.add(new Konva.Line({ points: [cx + s * 0.16, cy - s * 0.34, cx + s * 0.16, cy + s * 0.16], stroke: '#111111', strokeWidth: 1.1 }));
        g.add(new Konva.Line({ points: [cx, cy - s * 0.54, cx, cy - s * 0.34], stroke: '#111111', strokeWidth: 1.7 }));
    }

    _iconDischarge(g, cx, cy, s = 22) {
        // 排渣口（蝶形）+ 两侧飞溅
        g.add(new Konva.Line({
            points: [cx - s * 0.20, cy - s * 0.34, cx + s * 0.20, cy - s * 0.34, cx, cy + s * 0.02,
                cx + s * 0.20, cy + s * 0.34, cx - s * 0.20, cy + s * 0.34, cx, cy + s * 0.02],
            closed: true, fill: '#ffffff', stroke: '#111111', strokeWidth: 1.7, lineJoin: 'round',
        }));
        [[-0.36, -0.18], [-0.44, 0.02], [-0.36, 0.22], [0.36, -0.18], [0.44, 0.02], [0.36, 0.22]].forEach(([dx, dy]) => {
            g.add(new Konva.Circle({ x: cx + s * dx, y: cy + s * dy, radius: 1.3, fill: '#111111' }));
        });
    }

    _iconAlarm(g, cx, cy, s = 22) {
        g.add(new Konva.Line({
            points: [cx - s * 0.40, cy + s * 0.34, cx, cy - s * 0.36, cx + s * 0.40, cy + s * 0.34],
            closed: true, fill: '#ffffff', stroke: '#111111', strokeWidth: 1.8, lineJoin: 'round',
        }));
        g.add(new Konva.Line({ points: [cx, cy - s * 0.10, cx, cy + s * 0.10], stroke: '#111111', strokeWidth: 1.8, lineCap: 'round' }));
        g.add(new Konva.Circle({ x: cx, y: cy + s * 0.22, radius: 1.3, fill: '#111111' }));
        // 右侧声波弧
        g.add(new Konva.Arc({
            x: cx + s * 0.26, y: cy - s * 0.02, innerRadius: s * 0.30, outerRadius: s * 0.35,
            angle: 95, rotation: -48, stroke: '#111111', strokeWidth: 1.4,
        }));
    }

    // ═══════════════════════════════════════════════════════════
    //  静态绘制
    // ═══════════════════════════════════════════════════════════
    _init() {
        this._drawStaticParts();
        this._createDynamicNodes();
        this._bindInteraction();
    }

    _drawStaticParts() {
        const g = this._staticGroup, G = this._geo, W = this.W, H = this.H;

        // 外框（浅灰圆角边框）
        g.add(new Konva.Rect({
            x: 0, y: 0, width: W, height: H, cornerRadius: 14,
            fill: '#e8eaec', stroke: '#9aa3ab', strokeWidth: 2,
        }));

        // ═══ OP 操作面板 ═══
        const op = G.op;
        g.add(new Konva.Rect({
            x: op.x, y: op.y, width: op.w, height: op.h, cornerRadius: 10,
            fill: '#0b4a9c', stroke: '#07356f', strokeWidth: 2,
        }));
        this._label(g, op.x + op.w - 54, op.y + 12, 'OP', 16, '#ffffff', true, 'right', 40);

        // ── 流程图白色区 ──
        const M = G.mimic;
        g.add(new Konva.Rect({
            x: M.x, y: M.y, width: M.w, height: M.h,
            fill: '#ffffff', stroke: '#c8ced4', strokeWidth: 1.5,
        }));
        this._drawMimic(g);

        // ── INFO 区 ──
        const I = G.info;
        g.add(new Konva.Rect({
            x: I.x, y: I.y, width: I.w, height: I.h,
            fill: '#ffffff', stroke: '#c8ced4', strokeWidth: 1.5,
        }));
        g.add(new Konva.Rect({ x: I.x, y: I.y, width: I.w, height: 22, fill: '#cfe0f2' }));
        this._label(g, I.x + 8, I.y + 3, 'INFO', 12, '#0b4a9c', true);
        for (let i = 1; i <= 3; i++) {
            const y = I.y + 22 + i * 31;
            g.add(new Konva.Line({
                points: [I.x + 6, y, I.x + I.w - 6, y],
                stroke: '#dde3e8', strokeWidth: 1,
            }));
        }

        // ── 液晶显示器 ──
        const L = G.lcd;
        g.add(new Konva.Rect({
            x: L.x, y: L.y, width: L.w, height: L.h, cornerRadius: 4,
            fill: '#0b0b0b', stroke: '#3a3a3a', strokeWidth: 2,
        }));

        // ── 三只按键 ──
        const K = G.keys;
        const keyDefs = [['key-minus', '−', 0], ['key-plus', '+', 1], ['key-enter', 'ENTER', 2]];
        keyDefs.forEach(([id, txt, i]) => {
            const x = K.x + i * (K.w + K.gap);
            g.add(new Konva.Rect({
                x, y: K.y, width: K.w, height: K.h, cornerRadius: 6,
                fill: '#3f3f3f', stroke: '#9aa3ab', strokeWidth: 1.4,
            }));
            this._label(g, x, K.y + (id === 'key-enter' ? 13 : 7), txt,
                id === 'key-enter' ? 13 : 23, '#ffffff', true, 'center', K.w);
        });

        // ── 右侧按钮区：5 个白色圆角分组框 ──
        const FN = G.fn;
        const bx = FN.x, bw = FN.w;
        const B = {};
        FN.boxes.forEach(b => { B[b.id] = b; });

        // 每个分组框：白底 + 蓝色细边
        FN.boxes.forEach(b => {
            g.add(new Konva.Rect({
                x: bx, y: b.y, width: bw, height: b.h, cornerRadius: 9,
                fill: '#ffffff', stroke: '#0b4a9c', strokeWidth: 1.4,
            }));
        });

        // 黑色按键（HEATER / SEPARATION / DISCHARGE / ALARM 各一只）
        const mkBtn = (by) => g.add(new Konva.Rect({
            x: bx + FN.btnX, y: by + FN.btnY, width: FN.btnW, height: FN.btnH,
            cornerRadius: 5, fill: '#1d2225', stroke: '#111111', strokeWidth: 1.2,
        }));

        const fnLabel = (by, text) => this._label(g, bx + FN.labX, by + FN.labY, text, 10.5, '#111111', true, 'center', FN.labW);

        // ① HEATER
        mkBtn(B.heater.y);
        this._iconHeat(g, bx + FN.iconDX, B.heater.y + FN.iconDY, 22);
        fnLabel(B.heater.y, 'HEATER');

        // ② SEPARATION（按钮兼作停止）+ 下方 STOP 指示灯与文字
        mkBtn(B.sep.y);
        this._iconSeparator(g, bx + FN.iconDX, B.sep.y + FN.iconDY, 24);
        fnLabel(B.sep.y, 'SEPARATION');
        this._label(g, bx + FN.labX, B.sep.y + 50, 'STOP', 10.5, '#111111', true, 'center', FN.labW);

        // ③ DISCHARGE
        mkBtn(B.discharge.y);
        this._iconDischarge(g, bx + FN.iconDX, B.discharge.y + FN.iconDY, 22);
        fnLabel(B.discharge.y, 'DISCHARGE');

        // ④ OP ACTIVE（仅指示灯 + 文字，垂直居中）
        this._label(g, bx + FN.labX, B.op.y + 21, 'OP ACTIVE', 10.5, '#111111', true, 'center', FN.labW);

        // ⑤ ALARM
        mkBtn(B.alarm.y);
        this._iconAlarm(g, bx + FN.iconDX, B.alarm.y + FN.iconDY, 22);
        fnLabel(B.alarm.y, 'ALARM');

        // ═══ 电机起动控制箱 ═══
        const mb = G.mb;
        g.add(new Konva.Rect({
            x: mb.x, y: mb.y, width: mb.w, height: mb.h, cornerRadius: 10,
            fill: '#0b4a9c', stroke: '#07356f', strokeWidth: 2,
        }));

        // ── 四只起停按钮 ──
        // 起动按钮（START）的按钮面画在动态层，运行时由暗绿点亮为亮绿（不使用白色指示环）
        const P = G.push;
        this._startFace = {};
        const pushDefs = [
            ['start-feed-pump', P.feedStart, 'START\nFEED PUMP', '#1b5e20', 'feed'],
            ['start-motor', P.motorStart, 'START\nMOTOR', '#1b5e20', 'motor'],
            ['stop-feed-pump', P.feedStop, 'STOP\nFEED PUMP', '#b71c1c', null],
            ['stop-motor', P.motorStop, 'STOP\nMOTOR', '#b71c1c', null],
        ];
        pushDefs.forEach(([id, b, text, color, lampKey]) => {
            // 金属外圈
            g.add(new Konva.Circle({
                x: b.cx, y: b.cy, radius: b.r,
                fillLinearGradientStartPoint: { x: b.cx, y: b.cy - b.r },
                fillLinearGradientEndPoint: { x: b.cx, y: b.cy + b.r },
                fillLinearGradientColorStops: [0, '#e4e7e7', 0.5, '#b9bebe', 1, '#8f9595'],
                stroke: '#7f8585', strokeWidth: 1.5,
            }));
            // 彩色按钮面：停止按钮静态；起动按钮在动态层（见 _createDynamicNodes）
            if (!lampKey) {
                g.add(new Konva.Circle({ x: b.cx, y: b.cy, radius: b.r - 5, fill: color, stroke: '#0b0b0b', strokeWidth: 1 }));
            }
            // 标牌（按钮上方）
            const pw = 116, ph = 30;
            const px = b.cx - pw / 2, py = b.cy - 66;
            g.add(new Konva.Rect({
                x: px, y: py, width: pw, height: ph, cornerRadius: 3,
                fill: '#ffffff', stroke: '#0b4a9c', strokeWidth: 1,
            }));
            const lines = text.split('\n');
            lines.forEach((ln, k) => {
                this._label(g, px + 3, py + 4 + k * 12, ln, 10, '#0b1a2b', true, 'center', pw - 6);
            });
        });

        // ── 电机电流表 ──
        const AM = G.ammeter;
        this._namePlate(g, AM.plate, 'MOTOR CURRENT', 12);
        g.add(new Konva.Rect({
            x: AM.box.x, y: AM.box.y, width: AM.box.w, height: AM.box.h, cornerRadius: 6,
            fill: '#2b2b2b', stroke: '#111111', strokeWidth: 2,
        }));
        g.add(new Konva.Rect({
            x: AM.box.x + 7, y: AM.box.y + 7, width: AM.box.w - 14, height: AM.box.h - 14, cornerRadius: 3,
            fill: '#f7f7f2', stroke: '#111111', strokeWidth: 1.5,
        }));
        {
            const acx = AM.box.x + AM.box.w / 2, acy = AM.box.y + AM.dialDY;
            const ar = AM.R;
            g.add(new Konva.Circle({ x: acx, y: acy, radius: ar, fill: '#ffffff', stroke: '#54606a', strokeWidth: 2 }));
            // 刻度：0~25 A，240° 扫角
            for (let i = 0; i <= 10; i++) {
                const a = (-120 + i * 24) * Math.PI / 180;
                const sx = Math.sin(a), cy2 = Math.cos(a);
                const r1 = i % 2 === 0 ? ar - 11 : ar - 7, r2 = ar - 3;
                g.add(new Konva.Line({
                    points: [acx + sx * r1, acy - cy2 * r1, acx + sx * r2, acy - cy2 * r2],
                    stroke: '#111111', strokeWidth: i % 2 === 0 ? 1.5 : 0.9,
                }));
                if (i % 2 === 0) {
                    const tx = acx + sx * (ar - 21), ty = acy - cy2 * (ar - 21);
                    this._label(g, tx - 11, ty - 6, String(i * 2.5), 10, '#111111', false, 'center', 22);
                }
            }
            // 18 A 以上过载红区
            g.add(new Konva.Arc({
                x: acx, y: acy, innerRadius: ar - 9, outerRadius: ar - 3, angle: 48, rotation: 72,
                fill: '#e53935',
            }));
            this._label(g, acx - ar - 4, acy - 32, 'A', 11, '#111111', true);
            // 数字窗口
            g.add(new Konva.Rect({
                x: AM.box.x + 10, y: AM.box.y + AM.box.h - 36, width: 42, height: 24, cornerRadius: 2,
                fill: '#ffffff', stroke: '#111111', strokeWidth: 1.2,
            }));
        }

        // ── 蜂鸣器 ──
        const BZ = G.buzzer;
        this._namePlate(g, BZ.plate, 'BUZZER', 12);
        g.add(new Konva.Circle({
            x: BZ.cx, y: BZ.cy, radius: BZ.r,
            fillLinearGradientStartPoint: { x: BZ.cx, y: BZ.cy - BZ.r },
            fillLinearGradientEndPoint: { x: BZ.cx, y: BZ.cy + BZ.r },
            fillLinearGradientColorStops: [0, '#5c6367', 0.5, '#3a4044', 1, '#22262a'],
            stroke: '#1b1f22', strokeWidth: 2,
        }));
        for (let i = 1; i <= 3; i++) {
            g.add(new Konva.Circle({
                x: BZ.cx, y: BZ.cy, radius: 4 + i * 6,
                stroke: '#6f767a', strokeWidth: 1,
            }));
        }

        // ── SEPARATOR MODE / POWER SWITCH 旋转开关 ──
        const SM = G.sepMode, PS = G.powerSw;
        this._namePlate(g, SM.plate, 'SEPARATOR MODE', 12);
        this._namePlate(g, PS.plate, 'POWER SWITCH', 12);
        [SM, PS].forEach(k => {
            g.add(new Konva.Rect({
                x: k.box.x, y: k.box.y, width: k.box.w, height: k.box.h, cornerRadius: 4,
                fill: '#ffffff', stroke: '#0b4a9c', strokeWidth: 1.2,
            }));
            this._drawKnobBase(g, k.cx, k.cy, k.R);
        });
        // 分离模式三档：CIP 左偏 60° / MAN 垂直向上 / AUT 右偏 60°
        this._label(g, SM.cx - 58, SM.cy - 23, 'CIP', 10, '#37474f', true, 'center', 36);
        this._label(g, SM.cx - 12, SM.cy - 46, 'MAN', 10, '#37474f', true, 'center', 24);
        this._label(g, SM.cx + 22, SM.cy - 23, 'AUT', 10, '#37474f', true, 'center', 36);
        // 电源开关两档：OFF 左上 45° / ON 右上 45°
        this._label(g, PS.cx - 58, PS.cy - 40, 'OFF', 10, '#37474f', true, 'right', 28);
        this._label(g, PS.cx + 30, PS.cy - 40, 'ON', 10, '#37474f', true, 'left', 26);

        // ── 应急停止 ──
        const EM = G.emcy;
        this._namePlate(g, EM.plate, 'EMCY STOP', 11);
        g.add(new Konva.Circle({ x: EM.cx, y: EM.cy, radius: EM.r, fill: '#f2c200', stroke: '#b39400', strokeWidth: 2 }));
        g.add(new Konva.Circle({ x: EM.cx, y: EM.cy, radius: EM.r - 6, fill: '#c62828', stroke: '#5c0d0d', strokeWidth: 2 }));
        g.add(new Konva.Circle({ x: EM.cx, y: EM.cy, radius: EM.r - 17, fill: '#e53935', stroke: '#8e1515', strokeWidth: 1.4 }));
    }

    /** 流程图（按实船 EPC-50 面板重绘：主管路 + 分油机剖面 + 工作水阀组） */
    _drawMimic(g) {
        const M = this._geo.mimic, MI = this._mimic;
        const ox = M.x, oy = M.y, LY = MI.lineY;
        const L = (pts, w = 2, color = '#222222') => g.add(new Konva.Line({
            points: pts, stroke: color, strokeWidth: w, lineJoin: 'round', lineCap: 'round',
        }));
        const arrow = (x1, y1, x2, y2, w = 2) => g.add(new Konva.Arrow({
            points: [x1, y1, x2, y2], fill: '#222222', stroke: '#222222', strokeWidth: w,
            pointerLength: 8, pointerWidth: 8,
        }));

        // ══ 一、先画全部管路（符号随后覆盖，避免管线穿过符号）══

        // 供油主管路：到三通阀 V1 右口即向下折（进油），不再向右连
        L([ox + 14, LY, ox + 218, LY], 3.2);
        L([ox + 218, LY, ox + 238, LY], 2.6);
        // 进油立管（下折进入分离筒）
        L([ox + 238, LY, ox + 238, oy + 58], 2.6);
        // 净油立管（自分离筒向上）→ 净油通道向右 → 出口箭头
        L([ox + 258, oy + 58, ox + 258, LY], 2.6);
        L([ox + 258, LY, ox + 400, LY], 3.2);
        arrow(ox + 394, LY, ox + 414, LY, 3.2);
        // V1 回油支路：由下位三角底边引出 → 向下 → 向左
        L([ox + 206, LY + 18, ox + 206, oy + 74, ox + 168, oy + 74], 2);
        arrow(ox + 174, oy + 74, ox + 160, oy + 74, 2);
        // V1 / V4 气动膜头连杆（由阀芯向上 14px，贴住阀体）
        L([ox + 206, LY, ox + 206, LY - 14], 1.8);
        L([ox + 372, LY, ox + 372, LY - 14], 1.8);
        // 出水支路：分离机右侧引出 → PT5 → 出水阀 V5 → 排出（与净油支路同款式）
        L([ox + 300, oy + 116, ox + 420, oy + 116], 2.4);
        arrow(ox + 414, oy + 116, ox + 428, oy + 116, 2.4);
        L([ox + 386, oy + 116, ox + 386, oy + 102], 1.8);   // V5 气动膜头连杆

        // 工作水管路：16、15 合并成一路 → 分油机左下角；10 单独一路 → 分油机左上角
        L([ox + 20, oy + 118, ox + 90, oy + 118], 2);          // 16/15 供水母线
        L([ox + 90, oy + 118, ox + 90, oy + 142], 2);          // 下折
        L([ox + 90, oy + 142, ox + 218, oy + 142], 2);
        arrow(ox + 218, oy + 142, ox + 226, oy + 142, 2);      // → 左下角
        L([ox + 100, oy + 118, ox + 160, oy + 118], 2);        // 10 供水段
        L([ox + 160, oy + 118, ox + 160, oy + 96], 2);         // 上折
        L([ox + 160, oy + 96, ox + 218, oy + 96], 2);
        arrow(ox + 218, oy + 96, ox + 226, oy + 96, 2);        // → 左上角

        // ══ 二、再画各符号（圆形仪表泡 + 设备）══

        // 指示泡连杆（圆环在动态层，随状态变色）
        MI.bubbles.forEach(b => L([b.x, b.y + 6, b.x, b.y + 12], 1.4));

        // ① 供油泵（圆 + 实心三角）
        g.add(new Konva.Circle({ x: ox + 60, y: LY, radius: 12, fill: '#ffffff', stroke: '#222222', strokeWidth: 2.2 }));
        g.add(new Konva.Line({ points: [ox + 54, LY - 6, ox + 68, LY, ox + 54, LY + 6], closed: true, fill: '#222222', stroke: '#222222' }));

        // ② 滤器 / 加热器（方块 + 折线）
        g.add(new Konva.Rect({ x: ox + 86, y: LY - 11, width: 22, height: 22, fill: '#ffffff', stroke: '#222222', strokeWidth: 2 }));
        g.add(new Konva.Line({
            points: [ox + 91, LY + 6, ox + 97, LY - 6, ox + 103, LY + 6],
            stroke: '#222222', strokeWidth: 1.8, lineJoin: 'round',
        }));

        // ③④⑥⑦ 变送器 TT / PT / MT / PT
        [[134, 'TT'], [170, 'PT'], [300, 'MT'], [336, 'PT']].forEach(([dx, txt]) => {
            const cx = ox + dx;
            g.add(new Konva.Circle({ x: cx, y: LY, radius: 12, fill: '#ffffff', stroke: '#222222', strokeWidth: 2 }));
            this._label(g, cx - 12, LY - 5, txt, 8, '#111111', true, 'center', 24);
        });

        // 分离筒（锥体）
        g.add(new Konva.Path({
            data: `M ${ox + 232} ${oy + 58} L ${ox + 264} ${oy + 58} L ${ox + 252} ${oy + 82} L ${ox + 244} ${oy + 82} Z`,
            fill: '#ffffff', stroke: '#222222', strokeWidth: 2, lineJoin: 'round',
        }));
        // 机架（带左右凸台的罐体轮廓）
        g.add(new Konva.Path({
            data: `M ${ox + 236} ${oy + 82} L ${ox + 296} ${oy + 82} L ${ox + 296} ${oy + 96}
                   L ${ox + 306} ${oy + 104} L ${ox + 306} ${oy + 122} L ${ox + 296} ${oy + 130}
                   L ${ox + 296} ${oy + 148} L ${ox + 226} ${oy + 148} L ${ox + 226} ${oy + 130}
                   L ${ox + 214} ${oy + 122} L ${ox + 214} ${oy + 104} L ${ox + 226} ${oy + 96} Z`,
            fill: '#ffffff', stroke: '#222222', strokeWidth: 2, lineJoin: 'round',
        }));
        // 出水压力变送器 PT5（与其它变送器同款式）
        g.add(new Konva.Circle({ x: ox + 336, y: oy + 116, radius: 12, fill: '#ffffff', stroke: '#222222', strokeWidth: 2 }));
        this._label(g, ox + 336 - 12, oy + 111, 'PT', 8, '#111111', true, 'center', 24);

        // 工作水阀组：三个电磁阀的线圈方块与编号（蝶形阀体在动态层）
        MI.valves.filter(v => v.tag).forEach(v => {
            L([v.x, v.y - 26, v.x, v.y], 1.6);   // 线圈连杆一直连到阀芯中心（方块在动态层）
            this._label(g, v.x - 13, v.y + 9, v.tag, 10, '#111111', true, 'center', 26);
        });

        // ── 型号标识 ──
        this._label(g, ox + 8, oy + 162, 'EPC-50', 10, '#111111', true);
    }

    // ═══════════════════════════════════════════════════════════
    //  动态节点
    // ═══════════════════════════════════════════════════════════
    _createDynamicNodes() {
        const d = this._dynamicGroup, G = this._geo, MI = this._mimic;

        // ── 指示泡（圆形 r=6）：执行组件运行时亮绿 / 传感器故障时红 ──
        this._bubbles = {};
        MI.bubbles.forEach(b => {
            const c = new Konva.Circle({
                x: b.x, y: b.y, radius: 6,
                fill: '#ffffff', stroke: '#222222', strokeWidth: 1.6,
            });
            d.add(c);
            this._bubbles[b.id] = c;
        });

        // ── 分离机内部圆 = 电机运行指示灯 ──
        const ML = MI.motorLamp;
        this._motorLamp = new Konva.Circle({
            x: ML.x, y: ML.y, radius: ML.r,
            fill: '#ffffff', stroke: '#222222', strokeWidth: 2,
        });
        d.add(this._motorLamp);

        // ── 工作水电磁阀（16/15/10）：线圈方块 + 蝶形阀体，随通电状态着色 ──
        this._valveNodes = {};
        this._coilNodes = {};
        MI.valves.filter(v => v.tag).forEach(v => {
            const p = new Konva.Path({
                data: this._valveData(v.x, v.y, v.hw, v.hh),
                fill: '#ffffff', stroke: '#222222', strokeWidth: 1.5, lineJoin: 'round',
                fillRule: 'evenodd',
            });
            d.add(p);
            this._valveNodes[v.id] = p;
            const coil = new Konva.Rect({
                x: v.x - 6, y: v.y - 26, width: 12, height: 10,
                fill: '#ffffff', stroke: '#222222', strokeWidth: 1.8,
            });
            d.add(coil);
            this._coilNodes[v.id] = coil;
        });

        // ── 三通阀 V1：左位 / 右位 / 下位（倒三角）+ 气动膜头 ──
        {
            const v = MI.valves.find(x => x.id === 'valve-v1');
            const VX = v.x, VY = v.y;
            const tri = (pts, fill) => {
                const n = new Konva.Line({ points: pts, closed: true, fill, stroke: '#222222', strokeWidth: 1.8, lineJoin: 'round' });
                d.add(n); return n;
            };
            this._v1 = {
                // 左位 / 右位：底边在外的两个三角，顶点汇于阀芯
                left: tri([VX - 13, VY - 8, VX - 13, VY + 8, VX, VY], '#2e7d32'),
                right: tri([VX + 13, VY - 8, VX + 13, VY + 8, VX, VY], '#ffffff'),
                // 下位：底边在下方、顶点向上汇于阀芯（与 MIMIC 中 V1 上三角同款，方向朝内）
                bottom: tri([VX - 11, VY + 18, VX + 11, VY + 18, VX, VY], '#ffffff'),
                dome: new Konva.Path({
                    x: VX, y: VY - 14, data: 'M -8 0 A 8 8 0 0 1 8 0 Z',
                    fill: '#ffffff', stroke: '#222222', strokeWidth: 1.8, lineJoin: 'round',
                }),
            };
            d.add(this._v1.dome);
        }

        // ── 出水阀 V5：气动阀（蝶形阀体 + 气动膜头）──
        {
            const v = MI.valves.find(x => x.id === 'valve-v5');
            const VX = v.x, VY = v.y;
            const tri = (pts) => {
                const n = new Konva.Line({ points: pts, closed: true, fill: '#ffffff', stroke: '#222222', strokeWidth: 1.8, lineJoin: 'round' });
                d.add(n); return n;
            };
            this._v5 = {
                left: tri([VX - 13, VY - 8, VX - 13, VY + 8, VX, VY]),
                right: tri([VX + 13, VY - 8, VX + 13, VY + 8, VX, VY]),
                dome: new Konva.Path({
                    x: VX, y: VY - 14, data: 'M -8 0 A 8 8 0 0 1 8 0 Z',
                    fill: '#ffffff', stroke: '#222222', strokeWidth: 1.8, lineJoin: 'round',
                }),
            };
            d.add(this._v5.dome);
        }

        // ── 出油阀 V4：气动阀（蝶形阀体 + 气动膜头）──
        {
            const v = MI.valves.find(x => x.id === 'valve-v4');
            const VX = v.x, VY = v.y;
            const tri = (pts) => {
                const n = new Konva.Line({ points: pts, closed: true, fill: '#ffffff', stroke: '#222222', strokeWidth: 1.8, lineJoin: 'round' });
                d.add(n); return n;
            };
            this._v4 = {
                left: tri([VX - 13, VY - 8, VX - 13, VY + 8, VX, VY]),
                right: tri([VX + 13, VY - 8, VX + 13, VY + 8, VX, VY]),
                dome: new Konva.Path({
                    x: VX, y: VY - 14, data: 'M -8 0 A 8 8 0 0 1 8 0 Z',
                    fill: '#ffffff', stroke: '#222222', strokeWidth: 1.8, lineJoin: 'round',
                }),
            };
            d.add(this._v4.dome);
        }

        // ── 液晶文字（黑底红字）──
        this._lcdMain = new Konva.Text({
            x: G.lcd.x + 10, y: G.lcd.y + 8, width: G.lcd.w - 20, height: 36, wrap: 'none',
            text: 'Standst', fontSize: 26, fontStyle: 'bold', fill: '#ff3b30',
            fontFamily: 'Consolas, "Courier New", monospace', listening: false,
        });
        this._lcdSub = new Konva.Text({
            x: G.lcd.x + 10, y: G.lcd.y + G.lcd.h - 34, width: G.lcd.w - 20, height: 28, wrap: 'none',
            text: '', fontSize: 17, fill: '#ff6b60', align: 'right',
            fontFamily: 'Consolas, "Courier New", monospace', listening: false,
        });
        d.add(this._lcdMain, this._lcdSub);

        // ── INFO 区 4 行文字 ──
        this._infoRows = [];
        for (let i = 0; i < 4; i++) {
            const t = new Konva.Text({
                x: G.info.x + 8, y: G.info.y + 27 + i * 31, width: G.info.w - 16, height: 20, wrap: 'none',
                text: '', fontSize: 12, fill: '#1b2a38',
                fontFamily: 'Consolas, "Microsoft YaHei", monospace', listening: false,
            });
            d.add(t);
            this._infoRows.push(t);
        }

        // ── 右侧按钮区指示灯（rd=5.5，位于每个分组框左上角） ──
        this._fnLeds = {};
        const B = {};
        G.fn.boxes.forEach(b => { B[b.id] = b; });
        const lamp = (id, bx, by) => {
            const c = new Konva.Circle({
                x: bx + G.fn.lampDX, y: by + G.fn.lampDY, radius: 5.5,
                fill: '#c9ccce', stroke: '#2b2f2f', strokeWidth: 1,
            });
            d.add(c);
            this._fnLeds[id] = c;
        };
        lamp('fn-heater', G.fn.x, B.heater.y-3);
        lamp('fn-separator', G.fn.x, B.sep.y-3);
        // STOP 灯：相对按钮与上灯对称（按钮中心 by+35，上灯 by+14 → 下灯 by+56）
        lamp('fn-stop', G.fn.x, B.sep.y + G.fn.btnY + G.fn.btnH / 2 + 24 - G.fn.lampDY);
        lamp('fn-discharge', G.fn.x, B.discharge.y-3);
        lamp('fn-operative', G.fn.x, B.op.y);
        lamp('fn-alarm', G.fn.x, B.alarm.y-3);

        // ── 电机电流表指针 + 数字读数 ──
        const AM = G.ammeter;
        const acx = AM.box.x + AM.box.w / 2, acy = AM.box.y + AM.dialDY;
        this._ampNeedle = new Konva.Group({ x: acx, y: acy, rotation: -120 });
        this._ampNeedle.add(new Konva.Line({ points: [0, 0, 0, -(AM.R - 11)], stroke: '#c62828', strokeWidth: 2.4, lineCap: 'round' }));
        this._ampNeedle.add(new Konva.Circle({ x: 0, y: 0, radius: 4, fill: '#37474f' }));
        d.add(this._ampNeedle);
        this._ampText = new Konva.Text({
            x: AM.box.x + 11, y: AM.box.y + AM.box.h - 34, width: 40, height: 20,
            text: '0.0', fontSize: 13, align: 'center', fill: '#111111', fontFamily: 'Consolas, monospace',
        });
        d.add(this._ampText);

        // ── 两只旋转开关手柄 ──
        this._modeKnob = this._makeKnob(G.sepMode.cx, G.sepMode.cy, G.sepMode.R);
        this._powerKnob = this._makeKnob(G.powerSw.cx, G.powerSw.cy, G.powerSw.R);

        // ── 蜂鸣器鸣响指示环 ──
        const BZ = G.buzzer;
        this._buzzerRing = new Konva.Circle({
            x: BZ.cx, y: BZ.cy, radius: BZ.r + 4,
            stroke: '#ff3b30', strokeWidth: 3, opacity: 0,
        });
        d.add(this._buzzerRing);

        // ── 起动按钮面（动态层：暗绿=停止，亮绿=运行中）──
        const P = G.push;
        this._startFace.feed = new Konva.Circle({
            x: P.feedStart.cx, y: P.feedStart.cy, radius: P.feedStart.r - 5,
            fill: '#1b5e20', stroke: '#0b0b0b', strokeWidth: 1,
        });
        this._startFace.motor = new Konva.Circle({
            x: P.motorStart.cx, y: P.motorStart.cy, radius: P.motorStart.r - 5,
            fill: '#1b5e20', stroke: '#0b0b0b', strokeWidth: 1,
        });
        d.add(this._startFace.feed, this._startFace.motor);
    }

    /** 旋钮手柄（动态层：白色指示条 + 端部实心块） */
    _makeKnob(cx, cy, R) {
        const handle = new Konva.Group({ x: cx, y: cy, rotation: -45 });
        handle.add(new Konva.Rect({
            x: -4, y: -(R - 6), width: 8, height: (R - 6) * 2, cornerRadius: 4,
            fill: 'rgba(0,0,0,0)', stroke: '#ffffff', strokeWidth: 2,
        }));
        handle.add(new Konva.Rect({
            x: -2, y: -(R - 13), width: 4, height: 12, cornerRadius: 1, fill: '#ffffff',
        }));
        this._dynamicGroup.add(handle);
        return handle;
    }

    // ═══════════════════════════════════════════════════════════
    //  交互绑定
    // ═══════════════════════════════════════════════════════════
    _clearPartBg(hit) {
        try {
            const p = hit && hit.getParent && hit.getParent();
            const bg = p && p.getChildren && p.getChildren()[0];
            if (bg && typeof bg.fill === 'function') bg.fill('rgba(0,0,0,0)');
        } catch (e) { /* ignore */ }
    }

    _bindInteraction() {
        const G = this._geo, MI = this._mimic;

        // ── OP 面板：液晶 / INFO ──
        const L = G.lcd;
        const hl = this.addClickablePart('lcd', L.x, L.y, L.w, L.h, true);
        hl.on('click tap', () => this._tipPart('lcd'));
        this._clearPartBg(hl);

        const I = G.info;
        const hi = this.addClickablePart('info', I.x, I.y, I.w, I.h, true);
        hi.on('click tap', () => this._tipPart('info'));
        this._clearPartBg(hi);

        // ── OP 面板：三只按键 ──
        const K = G.keys;
        [['key-minus', 0], ['key-plus', 1], ['key-enter', 2]].forEach(([id, i]) => {
            const x = K.x + i * (K.w + K.gap);
            const hit = this.addClickablePart(id, x, K.y, K.w, K.h, true);
            hit.on('click tap', () => this._onKey(id));
            this._clearPartBg(hit);
        });

        // ── OP 面板：按钮区 5 个分组框（6 只功能键）──
        const FN = G.fn, FB = {};
        FN.boxes.forEach(b => { FB[b.id] = b; });
        const fnHit = (id, y, h) => {
            const hit = this.addClickablePart(id, FN.x + 4, y, FN.w - 8, h, true);
            hit.on('click tap', () => this._onKey(id));
            this._clearPartBg(hit);
        };
        fnHit('fn-heater', FB.heater.y + 18, 38);
        fnHit('fn-separator', FB.sep.y + 18, 38);
        {
            const hit = this.addClickablePart('ind-stop', FN.x + 4, FB.sep.y + 50, FN.w - 8, 22, true);
            hit.on('click tap', () => this._tipPart('ind-stop'));
            this._clearPartBg(hit);
        }
        fnHit('fn-discharge', FB.discharge.y + 18, 38);
        fnHit('fn-operative', FB.op.y + 2, FB.op.h - 4);
        fnHit('fn-alarm', FB.alarm.y + 18, 38);

        // ── 流程图：指示泡（识别用）──
        MI.bubbles.forEach(b => {
            const hit = this.addClickablePart(b.id, b.x - 6, b.y - 6, 12, 12, true);
            hit.on('click tap', () => this._tipPart(b.id));
            this._clearPartBg(hit);
        });
        // ── 流程图：分油机电机运行指示灯（分离机内部圆）──
        {
            const ML = MI.motorLamp;
            const hit = this.addClickablePart(ML.id, ML.x - ML.r, ML.y - ML.r, ML.r * 2, ML.r * 2, true);
            hit.on('click tap', () => this._tipPart(ML.id));
            this._clearPartBg(hit);
        }
        // ── 流程图：阀（识别用，含上方执行器/线圈）──
        MI.valves.forEach(v => {
            const hw = v.hw + 3;
            const hit = this.addClickablePart(v.id, v.x - hw, v.y - 30, hw * 2, 46, true);
            hit.on('click tap', () => this._tipPart(v.id));
            this._clearPartBg(hit);
        });

        // ── 电机起动控制箱：起停按钮 ──
        const P = G.push;
        [['start-feed-pump', P.feedStart], ['stop-feed-pump', P.feedStop],
         ['start-motor', P.motorStart], ['stop-motor', P.motorStop]].forEach(([id, b]) => {
            const hit = this.addClickablePart(id, b.cx - b.r, b.cy - b.r, b.r * 2, b.r * 2, true);
            hit.on('click tap', () => this._onKey(id));
            this._clearPartBg(hit);
        });

        // ── 旋转开关：左半区（逆时针）/ 右半区（顺时针）──
        this._bindKnob('mode-switch', 'mode-switch-ccw', G.sepMode);
        this._bindKnob('power-switch', 'power-switch-ccw', G.powerSw);

        // ── 蜂鸣器 / 应急停止 / 电流表 ──
        const BZ = G.buzzer;
        const hb = this.addClickablePart('buzzer', BZ.cx - BZ.r, BZ.cy - BZ.r, BZ.r * 2, BZ.r * 2, true);
        hb.on('click tap', () => this._onKey('buzzer'));
        this._clearPartBg(hb);

        const EM = G.emcy;
        const he = this.addClickablePart('emergency-stop', EM.cx - EM.r, EM.cy - EM.r, EM.r * 2, EM.r * 2, true);
        he.on('click tap', () => this._onKey('emergency-stop'));
        this._clearPartBg(he);

        const AM = G.ammeter;
        const hm = this.addClickablePart('ammeter', AM.box.x, AM.box.y, AM.box.w, AM.box.h, true);
        hm.on('click tap', () => this._tipPart('ammeter'));
        this._clearPartBg(hm);
    }

    /** 绑定旋转开关：顺时针（默认）与逆时针两个热区 */
    _bindKnob(cwId, ccwId, k) {
        const R = k.R, cx = k.cx, cy = k.cy;
        // 左半区（逆时针）
        const hccw = this.addClickablePart(ccwId, cx - R, cy - R, R, R * 2, true);
        hccw.on('click tap', () => this._onKey(ccwId));
        this._clearPartBg(hccw);
        // 右半区（顺时针）
        const hcw = this.addClickablePart(cwId, cx, cy - R, R, R * 2, true);
        hcw.on('click tap', () => this._onKey(cwId));
        this._clearPartBg(hcw);
    }

    // ═══════════════════════════════════════════════════════════
    //  识别类部件说明
    // ═══════════════════════════════════════════════════════════
    _tipPart(id) {
        const s = this._solver();
        const m = s ? s.m : null;
        const MI = this._mimic;
        const bub = MI.bubbles.find(b => b.id === id);
        if (bub) {
            const st = this._bubbleState(bub, m);
            this._tip(`${bub.text}：${st}`);
            return;
        }
        if (id === 'ind-stop') {
            this._tip(`STOP 指示灯：${(m && m.prog && (m.phase === 5 || m.phase === 6)) ? '闪烁——停机程序运行中' : '熄灭'}；与上方 SEPARATION 共用同一只按键`);
            return;
        }
        if (id === 'led-bowl') {
            this._tip(`分油机电机运行指示灯：${m && m.motor.on ? '亮绿——电机运行中' : '熄灭——电机停止'}`);
            return;
        }
        const valve = MI.valves.find(v => v.id === id);
        if (valve) {
            this._tip(valve.tag ? `阀 ${valve.tag}：${valve.tip}` : valve.tip);
            return;
        }
        if (id === 'lcd') {
            this._tip('EPC-50 液晶显示器：显示分油机当前状态（Standst / Start / Separat / Discharg / Stop）与程序步骤 Ti 定时');
            return;
        }
        if (id === 'info') {
            this._tip('INFO 信息区：显示运行状态、分离筒转速、TT1 进油温度与到下次排渣的剩余时间');
            return;
        }
        if (id === 'ammeter') {
            this._tip(`电机电流表：分油机电机运行电流约 ${m ? m.motor.current.toFixed(1) : '0.0'} A，超过 18 A 报电机过载`);
            return;
        }
    }

    /** 指示泡状态文字（run=运行指示灯；sensor=故障指示灯） */
    _bubbleState(bub, m) {
        if (!m) return '—';
        const alarmOn = (code) => m.alarms.some(a => a.code === code && a.active);
        if (bub.kind === 'run') {
            const on = bub.id === 'led-feed'
                ? (m.feed.pumpOn && m.mainPower)
                : (m.feed.heaterOn && m.mainPower);
            return on ? '亮绿——运行中' : '熄灭';
        }
        const code = { 'led-tt': 'A05', 'led-pt1': 'A17', 'led-mt': 'A11', 'led-pt4': 'A03', 'led-pt5': 'A16' }[bub.id];
        return (code && alarmOn(code)) ? '亮红——传感器故障' : '正常（默认白色）';
    }

    // ═══════════════════════════════════════════════════════════
    //  按键处理
    // ═══════════════════════════════════════════════════════════
    _onKey(id) {
        const s = this._solver();
        if (!s) return;
        const m = s.m, u = this._ui;

        // ── 电源开关（两档：右半区 ON / 左半区 OFF，不循环）──
        if (id === 'power-switch' || id === 'power-switch-ccw') {
            const on = (id === 'power-switch');
            if (on) {
                s.setPower(true, 'main');
                this._tip('POWER SWITCH 合闸 ON：分油机主回路与 EPC-50 面板同时得电');
            } else {
                s.setPower(false, 'main');
                this._tip('POWER SWITCH 断开 OFF：分油机主回路与 EPC-50 面板同时断电');
            }
            this._syncVisuals();
            return;
        }

        // ── SEPARATOR MODE 旋钮 ──
        if (id === 'mode-switch' || id === 'mode-switch-ccw') {
            const dir = (id === 'mode-switch') ? 1 : -1;
            const order = ['CIP', 'MAN', 'AUT'];
            const cur = u.cipMode ? 'CIP' : (m.ctrlMode === 'HAND' ? 'MAN' : 'AUT');
            let i = order.indexOf(cur);
            if (i < 0) i = 0;
            const next = order[Math.min(order.length - 1, Math.max(0, i + dir))];
            this._setSepMode(next);
            this._syncVisuals();
            return;
        }

        // ── 应急停止（任何模式下都有效）──
        if (id === 'emergency-stop') {
            if (m.emergency) {
                if (s.resetEmergency()) this._tip('应急停止已复位（分离筒需完全静止后方可复位）');
                else this._tip('分离筒尚未完全静止，不能复位应急停止');
            } else {
                s.emergencyStop();
                this._tip('应急停止按钮被按下：电机、供油泵、加热器与各电磁阀全部断电');
            }
            this._syncVisuals();
            return;
        }

        // ── 电机起动控制箱按钮（仅 MAN 手动方式有效）──
        if (id === 'start-feed-pump' || id === 'stop-feed-pump' ||
            id === 'start-motor' || id === 'stop-motor') {
            if (!this._manualAllowed('电机起动控制箱按钮')) return;
            // 手动时序联锁：必须完成起动问询（屏幕显示 Start Separator）后，电机起动按钮才有效
            if (id === 'start-motor' && this._isManMode() &&
                u.manStage !== 'ready' && u.manStage !== 'wait' && u.manStage !== 'standby') {
                if (u.manStage === 'quiz') {
                    this._tip('请先回答液晶屏上的起动问询（「+」= YES，「−」= NO）');
                } else {
                    this._tip('电机起动按钮暂无效：请先按「SEPARATION」键，完成三问并使屏幕显示 Start Separator');
                }
                this._syncVisuals();
                return;
            }
            if (id === 'start-feed-pump') {
                s.localPump(true);
            } else if (id === 'stop-feed-pump') {
                s.localPump(false);
            } else if (id === 'start-motor') {
                s.localMotorStart();
            } else {
                s.localMotorStop();
            }
            this._syncVisuals();
            return;
        }

        // ── 蜂鸣器（报警确认与复位）──
        if (id === 'buzzer') {
            if (m.alarmActive) {
                const r = s.pressAlarmReset();
                this._tip(r === 'ack' ? '报警已确认（再按一次可清除已消失的报警）' : '报警已复位');
            } else {
                this._tip('当前无报警，蜂鸣器不鸣响');
            }
            this._syncVisuals();
            return;
        }

        // ── OP 面板按键 ──
        if (id === 'key-enter') {
            this._onEnter();
        } else if (id === 'key-plus' || id === 'key-minus') {
            // 「+」= 下一项 / 增大数值；「−」= 上一项 / 减小数值
            this._onAdjust(id === 'key-plus' ? 1 : -1);
        } else if (id === 'fn-separator') {
            // 实船 EPC-50 上分离与停止是同一只按钮：未运行时起动，运行中按下即停止
            if (this._isManMode()) {
                this._onSeparatorMan();
            } else if (!u.cipMode && m.ctrlMode === 'AUTO') {
                this._onSeparatorAuto();
            } else if (m.prog) {
                s.pressStop();
                this._tip('分油中按「SEPARATION」：先排渣，再执行停机程序');
            } else {
                this._pressStart();
            }
        } else if (id === 'fn-operative') {
            this._pressOperative();
        } else if (id === 'fn-stop') {
            if (!this._panelAllowed('STOP')) return;
            if (m.prog) s.pressStop();
        } else if (id === 'fn-discharge') {
            if (!this._panelAllowed('DISCHARGE')) return;
            if (m.epcPower) {
                if (this._isManMode() && !m.prog) {
                    this._tip('手动方式下请在分离程序运行（分油中）时按「DISCHARGE」排渣');
                    return;
                }
                s.pressDischarge();
            }
        } else if (id === 'fn-heater') {
            if (!this._panelAllowed('HEATER')) return;
            if (!m.feed.pumpOn) { this._tip('加热器与供油泵联锁：请先起动供油泵'); return; }
            s.setHeater(!m.feed.heaterOn);
        } else if (id === 'fn-alarm') {
            if (m.epcPower) {
                const r = s.pressAlarmReset();
                this._tip(r === 'ack' ? '报警已确认（再按一次可清除已消失的报警）' : '报警已复位');
            }
        }
        this._syncVisuals();
    }

    /** 当前是否处于 MAN（机旁手动）方式 */
    _isManMode() {
        const s = this._solver();
        if (!s) return false;
        return !this._ui.cipMode && s.m.ctrlMode === 'HAND';
    }

    /** OP 面板功能键通用前置：主电源已合上、非 CIP、无应急停止 */
    _panelAllowed(what) {
        const s = this._solver();
        const m = s.m, u = this._ui;
        if (!m.mainPower) { this._tip('请先合上 POWER SWITCH（主电源）'); return false; }
        if (u.cipMode) { this._tip('SEPARATOR MODE 在 CIP 清洗位（本仿真不实现），控制指令不响应；请打到「MAN」或「AUT」'); return false; }
        if (m.emergency) { this._tip('应急停止已按下：请先旋起应急停止按钮再操作'); return false; }
        return true;
    }

    /** AUT（远程自动）方式才允许 OP 面板功能键 */
    _autoAllowed(what) {
        const s = this._solver();
        const m = s.m, u = this._ui;
        if (!m.mainPower) { this._tip('请先合上 POWER SWITCH（主电源）'); return false; }
        if (u.cipMode) { this._tip('SEPARATOR MODE 在 CIP 清洗位（本仿真不实现），控制指令不响应；请打到「AUT」'); return false; }
        if (m.ctrlMode !== 'EPC' && m.ctrlMode !== 'AUTO') {
            this._tip(`控制方式在机旁手动位，EPC-50 功能键无效；请把 SEPARATOR MODE 打到「AUT」`);
            return false;
        }
        return true;
    }

    /** MAN（机旁手动）方式才允许电机起动控制箱按钮 */
    _manualAllowed(what) {
        const s = this._solver();
        const m = s.m, u = this._ui;
        if (!m.mainPower) { this._tip('请先合上 POWER SWITCH（主电源）'); return false; }
        if (u.cipMode) { this._tip('SEPARATOR MODE 在 CIP 清洗位（本仿真不实现），控制指令不响应；请打到「MAN」'); return false; }
        if (m.ctrlMode !== 'HAND') {
            this._tip('SEPARATOR MODE 在「AUT」位，由 EPC-50 远程自动控制；请打到「MAN」再用起动箱按钮');
            return false;
        }
        return true;
    }

    /** SEPARATOR MODE 档位切换 */
    _setSepMode(next) {
        const s = this._solver();
        const m = s.m, u = this._ui;
        if (next === 'CIP') {
            u.cipMode = true;
            if (m.prog || m.state !== 'STANDSTILL') s.pressStop();
            s.setCtrlMode('HAND');
            this._tip('SEPARATOR MODE 置于 CIP（清洗模式）：本仿真不实现 CIP 清洗程序，分油机系统停止、控制指令不响应');
            return;
        }
        u.cipMode = false;
        s.setCtrlMode(next === 'MAN' ? 'HAND' : 'AUTO');
        if (next === 'MAN') {
            this._tip('SEPARATOR MODE 置于 MAN：机旁手动，由电机起动控制箱按钮直接操作');
        } else if (s.m.prog) {
            this._tip('SEPARATOR MODE 置于 AUT：自动方式，分离程序正在运行');
        } else {
            this._tip('SEPARATOR MODE 置于 AUT：Standst 状态下自动从 Ti50 开始执行自动起动程序（供油泵 → 电机 → 加热 → 分离）');
        }
    }

    // ═══════════════════════════════════════════════════════════
    //  手动（MAN）操作时序
    // ═══════════════════════════════════════════════════════════
    /**
     * 手动方式下的「SEPARATION」键（分离与停止共用同一只按钮）：
     *   ① 空闲：分离指示灯闪烁 + 液晶依次提出 3 个问询
     *   ② 问询通过：屏幕显示 Start Separator，等控制箱「START MOTOR」
     *   ③ 电机升速：屏幕交替显示转速与 Wait!，超过 10000 r/min 显示 Standby
     *   ④ 再按一次：从 Ti60 开始执行分离程序，分离指示灯常亮
     *   ⑤ 分油中再按：先执行排渣，再执行手动停机程序
     */
    _onSeparatorMan() {
        const s = this._solver();
        if (!s) return;
        const m = s.m, u = this._ui;
        if (!this._panelAllowed('SEPARATION')) return;

        // ⑤ 程序运行中：先排渣，再手动停机
        if (m.prog || u.manStage === 'run') {
            s.pressStop();
            this._tip('分油中再按「SEPARATION」：先执行排渣（Ti70~Ti75），再执行手动停机程序（Ti81~Ti83）');
            return;
        }
        // ②③ 等起动电机 / 升速
        if (u.manStage === 'ready') { this._tip('屏幕显示 Start Separator：请按控制箱「START MOTOR」起动分油机电机'); return; }
        if (u.manStage === 'wait') { this._tip(`等待分离筒转速升到 10000 r/min（当前 ${Math.round(m.bowl.speed)} r/min），屏幕随后显示 Standby`); return; }
        // ① 问询进行中
        if (u.manStage === 'quiz') { this._tip('请先回答问询：「+」= YES，「−」= NO'); return; }

        // ④ Standby：投入分离程序（从 Ti60 开始）
        if (u.manStage === 'standby' || (!m.prog && m.motor.on && m.bowl.speed >= 10000)) {
            if (!s.manualSeparateStart()) return;
            u.manStage = 'run';
            this._tip('分离程序投入：分离指示灯常亮，自 Ti60 开始（Ti60 排渣 → Ti62 关筒 → Ti63 水封 → Ti68 分油）');
            return;
        }

        // ① 起动机器前的三问
        u.manStage = 'quiz';
        u.quizIdx = 0;
        u.quizAns = [];
        this._tip('分离程序起动问询：Bowl dismantled?  「+」= YES，「−」= NO');
    }

    /**
     * 自动方式下的「SEPARATION」键：
     *   未运行 → 先回答三问（与手动相同），通过后自动从 Ti50 执行；
     *   运行中 → 先排渣，再停机 + 自动停机。
     */
    _onSeparatorAuto() {
        const s = this._solver();
        if (!s) return;
        const m = s.m, u = this._ui;
        if (!this._panelAllowed('SEPARATION')) return;

        if (m.prog || u.manStage === 'run') {
            s.pressStop();
            this._tip('自动方式分油中按「SEPARATION」：先排渣（Ti70~Ti75），再停机（Ti81~Ti83），最后自动停机（Ti85~Ti89），液晶屏回到 Standst');
            return;
        }
        if (u.manStage === 'quiz') { this._tip('请先回答问询：「+」= YES，「−」= NO'); return; }
        if (m.state !== 'STANDSTILL' || m.bowl.speed > 60) {
            this._tip('分离筒尚未完全静止，不能起动分离程序');
            return;
        }
        u.manStage = 'quiz';
        u.quizIdx = 0;
        u.quizAns = [];
        this._tip('分离程序起动问询：Bowl dismantled?  「+」= YES，「−」= NO（答 NO 或三问均答 YES 后自动从 Ti50 执行）');
    }

    /** 问询回答：yes=true（按「+」），false（按「−」） */
    _answerQuiz(yes) {
        const u = this._ui;
        const i = u.quizIdx;
        u.quizAns[i] = !!yes;
        if (i === 0) {
            if (!yes) { this._quizPass(); return; }
            u.quizIdx = 1;
            this._tip('已答「分离筒已拆检」→ 请回答：Assembled per manual?  「+」= YES，「−」= NO');
            return;
        }
        if (i === 1) {
            if (!yes) { this._abortQuiz(); return; }
            u.quizIdx = 2;
            this._tip('请回答：Bowl cleaned?  「+」= YES，「−」= NO');
            return;
        }
        if (!yes) { this._abortQuiz(); return; }
        this._quizPass();
    }

    /** 三问通过：自动方式 → 立即自 Ti50 执行；手动方式 → 显示 Start Separator 等起动机电 */
    _quizPass() {
        const s = this._solver();
        const u = this._ui;
        const m = s ? s.m : null;
        if (!m) return;
        if (m.ctrlMode === 'AUTO') {
            u.manStage = 'run';
            if (s.autoStart()) {
                this._tip('问询通过 → 自动程序自 Ti50 开始执行：供油泵 → 电机 → 加热 → 水封 → 分油');
            } else {
                u.manStage = null;
            }
            return;
        }
        u.manStage = 'ready';
        this._tip('问询通过 → 屏幕显示 Start Separator，请按控制箱「START MOTOR」');
    }

    /** 需要校准起动（本仿真不实现）：中止问询，回到 Standst */
    _abortQuiz() {
        const u = this._ui;
        u.manStage = null;
        u.quizIdx = 0;
        this._tip('拆检后未按手册装配 / 未清洗 → 需执行校准起动（Bowl calibration），本仿真不实现该程序，已返回 Standst');
    }

    /** 手动时序阶段自动推进（每帧） */
    _updateManStage(m) {
        const u = this._ui;
        if (!this._isManMode()) {
            // 自动方式：只保留问询与运行两种阶段（问询通过后自动执行）
            if (!u.cipMode && m.ctrlMode === 'AUTO') {
                if (u.manStage !== 'quiz' && u.manStage !== 'run') u.manStage = null;
                else if (u.manStage === 'run' && !m.prog) u.manStage = null;
            } else {
                u.manStage = null;
            }
            return;
        }
        switch (u.manStage) {
            case 'ready':
                if (m.motor.on) u.manStage = (m.bowl.speed >= 10000) ? 'standby' : 'wait';
                break;
            case 'wait':
                if (!m.motor.on) u.manStage = 'ready';
                else if (m.bowl.speed >= 10000) u.manStage = 'standby';
                break;
            case 'standby':
                if (m.prog) u.manStage = 'run';
                else if (!m.motor.on && m.bowl.speed < 60) u.manStage = null;
                break;
            case 'run':
                if (!m.prog) u.manStage = (m.motor.on && m.bowl.speed >= 10000) ? 'standby' : null;
                break;
            default:
                break;
        }
    }

    /**
     * 「SEPARATOR」键：按 EPC-60 的 5 步起动推进
     *   ① 第一次：起动问询（YES/NO）→ 用「OPERATIVE」或「ENTER」确认
     *   ② 供油泵　③ 加热器（≥96 ℃）　④ 电机（≥10000 r/min）
     */
    _pressStart() {
        const s = this._solver();
        if (!s) return;
        const m = s.m, u = this._ui;
        if (!this._autoAllowed('SEPARATOR')) return;
        if (m.prog) { this._tip('分离程序已在运行'); return; }
        if (u.question) { this._tip('请用「OPERATIVE」或「ENTER」确认起动问询'); return; }
        if (!u.asked) {
            u.question = true;
            u.answer = 'YES';
            this._tip('起动问询：分离筒是否已拆检？用「−」「+」选择 YES/NO，再按「ENTER」或「OPERATIVE」确认');
            return;
        }
        if (!m.feed.pumpOn) { s.setFeedPump(true); this._tip('起动供油泵'); return; }
        if (!m.feed.heaterOn) { s.setHeater(true); this._tip('起动加热器'); return; }
        if (m.feed.temp < 96) { this._tip(`等待进油温度升到 96 ℃（当前 ${m.feed.temp.toFixed(1)} ℃）`); return; }
        if (!m.motor.on) { s.start(true); this._tip('起动分油机电机'); return; }
        if (m.bowl.speed < 10000) { this._tip(`等待分离筒转速升到 10000 r/min（当前 ${Math.round(m.bowl.speed)}）`); return; }
        this._tip('起动条件已具备，请按「OPERATIVE」投入分离程序');
    }

    /** 「OPERATIVE」键：确认起动问询 / 投入分离程序 */
    _pressOperative() {
        const s = this._solver();
        if (!s) return;
        const m = s.m, u = this._ui;
        if (!this._autoAllowed('OPERATIVE')) return;
        if (u.question) {
            u.question = false;
            u.asked = true;
            this._tip(`起动问询已确认（${u.answer}）`);
            return;
        }
        if (m.prog) { this._tip('分离程序已在运行'); return; }
        if (!u.asked) { this._tip('请先按「SEPARATOR」键起动前需回答问询'); return; }
        if (!m.motor.on) { this._tip('分油机电机尚未起动'); return; }
        if (m.bowl.speed < 10000) { this._tip('分离筒转速尚未达到 10000 r/min'); return; }
        s._startProgram(2);                 // 分离程序（复位 → 校验 → 排渣 → 水封）
        this._tip('分离程序投入：Ti56 ~ Ti68 依次执行');
    }

    // ── 菜单（ENTER / − / +）─────────────────────────────────
    _onEnter() {
        const u = this._ui, s = this._solver();
        if (!s) return;
        if (u.question) {
            u.question = false;
            u.asked = true;
            this._tip(`起动问询已确认（${u.answer}）`);
            return;
        }
        if (u.page === 'main') { u.page = 'menu'; u.menu = 0; return; }
        if (u.page === 'menu') {
            const item = this._menuItems()[u.menu];
            if (!item) return;
            if (item[0] === 'main') { u.page = 'main'; return; }
            u.page = item[0];
            if (u.page === 'params') u.param = 0;
            return;
        }
        if (u.page === 'params') {
            if (u.editing) {
                s.setParam(this._paramItems()[u.param][0], u.editVal);
                u.editing = false;
                u.page = 'menu';              // 保存后回到主菜单
                this._tip('参数已修改并保存');
            } else {
                const item = this._paramItems()[u.param];
                if (item) { u.editing = true; u.editVal = s.getParam(item[0]); }
            }
            return;
        }
        u.page = 'menu';
    }

    _onAdjust(dir) {
        const u = this._ui, s = this._solver();
        if (!s) return;
        // 手动时序问询：「+」= YES，「−」= NO
        if (u.manStage === 'quiz') { this._answerQuiz(dir > 0); return; }
        if (u.question) {
            u.answer = (u.answer === 'YES') ? 'NO' : 'YES';
            return;
        }
        if (u.page === 'menu') {
            const n = this._menuItems().length;
            u.menu = Math.max(0, Math.min(n - 1, u.menu + dir));
        } else if (u.page === 'params') {
            const items = this._paramItems();
            if (u.editing) {
                const item = items[u.param];
                if (!item) return;
                const step = item[3] || 1;
                const dec = item[4] || 0;
                u.editVal = Number((u.editVal + dir * step).toFixed(dec));
            } else {
                u.param = Math.max(0, Math.min(items.length - 1, u.param + dir));
            }
        } else if (u.page === 'alarms') {
            const n = s.m.alarms.filter(a => a.active).length;
            u.alarm = Math.max(0, Math.min(Math.max(0, n - 1), (u.alarm || 0) + dir));
        } else if (u.page === 'info') {
            u.info = Math.max(0, Math.min(this._infoPages().length - 1, (u.info || 0) + dir));
        }
    }

    _menuItems() {
        return [
            ['params', '参数设置'],
            ['time', '时间设置'],
            ['alarms', '报警记录'],
            ['info', '操作信息'],
            ['main', '返回主画面'],
        ];
    }

    _paramItems() {
        return [
            ['dischargeInterval', '排渣间隔', 'min', 1, 0],
            ['minInterval', '最短排渣间隔', 'min', 1, 0],
            ['sepTemp', '分离温度', '℃', 1, 0],
            ['tempLowAlarm', '低温报警', '℃', 1, 0],
            ['flow', '进油流量', 'm3/h', 0.1, 1],
            ['sealTime', '水封时间', 's', 1, 0],
            ['displacementTime', '置换水时间', 's', 1, 0],
            ['drainTime', '排水阀时间', 's', 1, 0],
            ['waterTrigger', '水分触发值', 'pF', 1, 0],
        ];
    }

    _infoPages() {
        return [
            ['运行信息', 'TT1 进油温度', 'PT1 进油压力', 'PT4 净油压力'],
            ['运行信息', 'PT5 排水压力', 'MT 净油含水量', 'FLOW 进油流量'],
            ['运行信息', 'RPM 分离筒转速', 'VIB 振动值', 'RUN 累计运行时间'],
            ['操作信息', 'S 型分油机 S 936', 'EPC-50 控制单元', '仿真教学版'],
            ['操作信息', 'SEPARATOR=起动', 'OPERATIVE=投入', 'STOP=停止'],
        ];
    }

    // ═══════════════════════════════════════════════════════════
    //  显示同步
    // ═══════════════════════════════════════════════════════════
    _stateText(m) {
        if (!m.mainPower && !m.epcPower) return 'Powerof';
        switch (m.state) {
            case 'STANDSTILL': return 'Standst';
            case 'STARTING': return 'Start';
            case 'START_SEQ': return 'Startseq';
            case 'STANDBY': return 'Recirc';
            case 'SEPARATION': return 'Separat';
            case 'DISCHARGE': return 'Discharg';
            case 'STOPPING': return 'Stop';
            default: return m.state;
        }
    }

    _lcdScreen(m) {
        const u = this._ui;
        if (u.question) {
            return { main: 'Start?', sub: u.answer, blink: u.answer };
        }
        // ── 手动（MAN）操作时序画面 ──
        const man = this._manScreen(m);
        if (man) return man;
        if (u.page === 'menu') {
            const items = this._menuItems();
            return { main: 'MENU', sub: `${u.menu + 1}/${items.length} ${items[u.menu] ? items[u.menu][1] : ''}` };
        }
        if (u.page === 'params') {
            const items = this._paramItems();
            const it = items[u.param];
            if (!it) return { main: 'PARAMS', sub: '' };
            const v = u.editing ? u.editVal : s_get(this, it[0]);
            return { main: it[1], sub: `${v} ${it[2]}` };
        }
        if (u.page === 'time') {
            return {
                main: 'TIME',
                sub: `下次排渣 ${this._fmtClock(m.sludge.nextIn)}  运行 ${m.counters.runTime.toFixed(1)}h`,
            };
        }
        if (u.page === 'alarms') {
            const list = m.alarms.filter(a => a.active);
            if (!list.length) return { main: 'ALARM', sub: 'NO ACTIVE ALARM' };
            const a = list[Math.min(list.length - 1, u.alarm || 0)];
            return { main: 'ALARM', sub: `${a.code} ${a.text}` };
        }
        if (u.page === 'info') {
            const pg = this._infoPages()[(u.info || 0) % this._infoPages().length];
            return { main: pg[0], sub: pg[3] };
        }
        // 主画面
        if (m.prog) {
            // Ti68 正常分油：显示分油倒计时「68= xx」（xx 为距下次排渣的分钟数）
            if (m.phase === 3 && m.step === 4) {
                const mins = Math.max(0, Math.ceil(m.sludge.nextIn / 60));
                return { main: `68= ${String(mins).padStart(2, '0')}`, sub: `SEPARATION  ${Math.round(m.bowl.speed)} rpm` };
            }
            const fn = EPC50Controller.TI_FN[m.timerName] || '';
            return { main: this._stateText(m), sub: `${m.timerName || ''} ${Math.round(m.timerT)}s  ${fn}` };
        }
        return {
            main: this._stateText(m),
            sub: `${m.feed.temp.toFixed(0)}C  ${Math.round(m.bowl.speed)}rpm  ${m.alarmActive ? 'ALARM' : ''}`,
        };
    }

    /**
     * 手动（MAN）时序专用液晶画面；返回 null 表示走常规画面
     */
    _manScreen(m) {
        const u = this._ui;
        if (u.cipMode) return null;
        const st = u.manStage;
        // 起动问询画面：手动 / 自动方式都要显示
        if (st === 'quiz') {
            const Q = ['Bowl dismantled?', 'Assembled per manual?', 'Bowl cleaned?'];
            return { main: Q[u.quizIdx] || '', sub: '+=YES   -=NO', size: 16 };
        }
        if (m.ctrlMode !== 'HAND') return null;      // 以下画面仅手动方式
        if (st === 'ready') {
            return { main: 'Start Separator', sub: 'PRESS START MOTOR', size: 19 };
        }
        if (st === 'wait') {
            // 左上角交替显示「转速 / Wait!」，右下角提示固定不交替
            const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
            const alt = Math.floor(now / 600) % 2 === 0;
            return alt
                ? { main: 'Wait!', sub: 'MOTOR ACCELERATING', size: 24 }
                : { main: `${Math.round(m.bowl.speed)} r/min`, sub: 'MOTOR ACCELERATING', size: 19 };
        }
        if (st === 'standby') {
            return { main: 'Standby', sub: `${Math.round(m.bowl.speed)} r/min` };
        }
        return null;
    }

    _fmtClock(sec) {
        sec = Math.max(0, Math.round(sec));
        const mm = Math.floor(sec / 60), ss = sec % 60;
        return `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
    }

    _syncVisuals() {
        const s = this._solver();
        const m = s ? s.m : null;
        if (!m) return;
        const u = this._ui;

        // ── SEPARATOR MODE 与 ctrlMode 同步 ──
        if (u.cipMode && m.ctrlMode !== 'HAND') u.cipMode = false;   // 他处切到远程 → 自动退出 CIP
        if (!u.cipMode) u.mode = (m.ctrlMode === 'HAND') ? 'MAN' : 'AUT';
        const modeNow = u.cipMode ? 'CIP' : u.mode;
        this._updateManStage(m);          // 手动（MAN）时序阶段自动推进

        // ── 液晶 ──
        const sc = this._lcdScreen(m);
        const blinkOn = Math.floor(((typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now()) / 400) % 2 === 0;
        this._lcdMain.fontSize(sc.size || 26);
        this._lcdMain.text(sc.main);
        this._lcdMain.fill(m.epcPower ? '#ff3b30' : '#6b2320');
        this._lcdSub.text(sc.blink && sc.blink === sc.sub && !blinkOn ? '' : sc.sub);
        this._lcdSub.fill(m.epcPower ? '#ff6b60' : '#6b2320');

        // ── INFO 区 ──
        const rows = [
            `STATE  ${this._stateText(m)}`,
            `SPEED  ${Math.round(m.bowl.speed)} r/min`,
            `TT1    ${m.feed.temp.toFixed(1)} C`,
            `NEXT   ${m.prog && m.phase === 3 ? `${Math.floor(m.sludge.nextIn / 60)} min` : '--'}`,
        ];
        this._infoRows.forEach((t, i) => { t.text(rows[i] || ''); });

        // ── 模拟图指示：执行组件运行时亮绿；传感器仅故障时红，正常为白 ──
        const blink = blinkOn;
        const alarmOn = (code) => m.alarms.some(a => a.code === code && a.active);
        const RUN = '#2ecc40', FAULT = '#e53935', IDLE = '#ffffff';
        if (this._bubbles) {
            this._bubbles['led-feed'].fill((m.feed.pumpOn && m.mainPower) ? RUN : IDLE);
            this._bubbles['led-heat'].fill((m.feed.heaterOn && m.mainPower) ? RUN : IDLE);
            this._bubbles['led-tt'].fill(alarmOn('A05') ? FAULT : IDLE);
            this._bubbles['led-pt1'].fill(alarmOn('A17') ? FAULT : IDLE);
            this._bubbles['led-mt'].fill(alarmOn('A11') ? FAULT : IDLE);
            this._bubbles['led-pt4'].fill(alarmOn('A03') ? FAULT : IDLE);
            this._bubbles['led-pt5'].fill(alarmOn('A16') ? FAULT : IDLE);
        }
        // 分油机电机运行指示灯（分离机内部圆）
        if (this._motorLamp) this._motorLamp.fill(m.motor.on ? RUN : IDLE);

        // ── 流程图阀符号开/关 ──
        const vOpen = {
            'valve-w1': m.water.sv16,            // 16 密封水
            'valve-w2': m.water.sv15,            // 15 开启水
            'valve-w3': m.water.sv10,            // 10 水封/置换水
        };
        Object.keys(this._valveNodes).forEach(id => {
            const p = this._valveNodes[id];
            const on = !!vOpen[id];
            p.fill(on ? '#2e7d32' : '#ffffff');
            const coil = this._coilNodes[id];
            if (coil) coil.fill(on ? '#e53935' : '#ffffff');
        });

        // ── 三通阀 V1：有气（供油位）膜头蓝、左+右通；无气膜头白、左+下通 ──
        if (this._v1) {
            const feeding = !m.feed.v1Return && m.mainPower;
            this._v1.left.fill('#2e7d32');
            this._v1.right.fill(feeding ? '#2e7d32' : '#ffffff');
            this._v1.bottom.fill(feeding ? '#ffffff' : '#2e7d32');
            this._v1.dome.fill(feeding ? '#1e88e5' : '#ffffff');
        }
        // ── 出水阀 V5：气开式，得气即开（膜头蓝、阀体绿）──
        if (this._v5) {
            const open = !!m.water.drain;
            this._v5.left.fill(open ? '#2e7d32' : '#ffffff');
            this._v5.right.fill(open ? '#2e7d32' : '#ffffff');
            this._v5.dome.fill(open ? '#1e88e5' : '#ffffff');
        }

        // ── 出油阀 V4：气关式，得气（关闭）时膜头蓝；阀体导通（开启）时绿色 ──
        if (this._v4) {
            const air = !m.oil.outletValveOpen && !!m.mainPower;
            const open = !!m.oil.outletValveOpen;
            this._v4.left.fill(open ? '#2e7d32' : '#ffffff');
            this._v4.right.fill(open ? '#2e7d32' : '#ffffff');
            this._v4.dome.fill(air ? '#1e88e5' : '#ffffff');
        }

        // ── 右侧功能键指示灯 ──
        const inDischarge = m.prog && m.phase === 4;
        const stopping = m.prog && (m.phase === 5 || m.phase === 6);
        const starting = !m.prog && (u.question || u.asked);
        // 分离指示灯：
        //  · 未运行时（问询 / 待起动 / 升速 / Standby）一直闪烁；
        //  · 手动方式第二次按下、投入分离程序后立即常亮；
        //  · 自动方式自 Ti50 起闪烁，程序进入 Ti62 后才转常亮（锁存）。
        const manPending = !m.prog && ['quiz', 'ready', 'wait', 'standby'].includes(u.manStage);
        if (!m.prog) u.sepLit = false;
        else if (m.phase > 2 || (m.phase === 2 && m.step >= 6)) u.sepLit = true;
        const sepOn = m.prog ? !stopping : (manPending || starting);
        const sepBlink = m.prog
            ? ((m.ctrlMode === 'HAND' || u.sepLit) ? true : blink)
            : ((manPending || starting) ? blink : true);
        this._setFnLed('fn-heater', !!(m.feed.heaterOn && m.mainPower), '#28e05a');
        this._setFnLed('fn-separator', sepOn, '#28e05a', sepBlink);
        this._setFnLed('fn-stop', stopping, '#ffb300', blink);
        this._setFnLed('fn-discharge', inDischarge, '#f4b400', blink);
        this._setFnLed('fn-operative', !!(m.mainPower && !m.alarmActive && modeNow !== 'CIP'), '#28e05a');
        this._setFnLed('fn-alarm', m.alarmActive, '#ff2d2d', blink);

        // ── 旋钮角度 ──
        const modeRot = { CIP: -60, MAN: 0, AUT: 60 }[modeNow] ?? 0;
        this._modeKnob.rotation(modeRot);
        this._powerKnob.rotation(m.mainPower ? 45 : -45);

        // ── 电流表 ──
        const amps = Math.max(0, Math.min(25, m.motor.current));
        this._ampNeedle.rotation(-120 + (amps / 25) * 240);
        this._ampText.text(amps.toFixed(1));

        // ── 蜂鸣器鸣响环 ──
        this._buzzerRing.opacity(m.alarmActive ? (blink ? 0.9 : 0.15) : 0);

        // ── 起动按钮面：运行中点亮为亮绿，停止时暗绿 ──
        this._startFace.feed.fill(m.feed.pumpOn ? '#2ecc40' : '#1b5e20');
        this._startFace.motor.fill(m.motor.on ? '#2ecc40' : '#1b5e20');

        // ── 停机程序结束 → 回到起动问询之前的状态 ──
        if (u.lastState && u.lastState !== 'STANDSTILL' && m.state === 'STANDSTILL' && !m.prog) {
            u.question = false;
            u.asked = false;
            u.page = 'main';
            u.editing = false;
        }
        u.lastState = m.state;

        if (this.sys && this.sys.requestRedraw) this.sys.requestRedraw();
    }

    /**
     * 按钮区指示灯
     * @param {boolean} on     是否点亮
     * @param {string}  color  点亮颜色
     * @param {boolean} phase  亮相位（闪烁时由调用方传入 400 ms 相位；false = 灭）
     */
    _setFnLed(id, on, color = '#28e05a', phase = true) {
        const c = this._fnLeds[id];
        if (!c) return;
        if (!on) { c.fill('#c9ccce'); return; }
        c.fill(phase ? color : '#c9ccce');
    }

    tick() {
        this._syncVisuals();
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

/** Ti 定时器 → 英文功能名（EPC 固定模式第二行） */
EPC50Controller.TI_FN = {
    Ti50: 'Start feed pump', Ti51: 'Feed pressure', Ti52: 'Start separator', Ti53: 'Start heater',
    Ti55: 'Standby', Ti56: 'Discharge', Ti57: 'Drain water', Ti58: 'Close bowl', Ti59: 'Flow check',
    Ti60: 'Discharge', Ti61: 'Drain water', Ti62: 'Close bowl', Ti63: 'Water seal',
    Ti64: 'Fill separator', Ti65: 'Water check', Ti66: 'Leak test', Ti67: 'Reference',
    Ti68: 'Separation', Ti70: 'Stop feed', Ti71: 'Displace oil', Ti72: 'Displace out',
    Ti73: 'Flush paring', Ti74: 'Discharge', Ti75: 'Drain',
    Ti81: 'Close bowl', Ti82: 'Displace out', Ti83: 'Flush paring',
    Ti85: 'Stop motor', Ti86: 'Motor slowing', Ti87: 'Stop feed pump', Ti89: 'Motor stopped',
};

/** 取参数值（菜单显示用） */
function s_get(comp, key) {
    const s = comp._solver();
    if (!s) return 0;
    const v = s.getParam(key);
    return (typeof v === 'number') ? v : 0;
}

export default EPC50Controller;
