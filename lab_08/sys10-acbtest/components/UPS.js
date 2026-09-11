import { BaseComponent } from './BaseComponent.js';

/**
 * UPS 不间断电源组件
 *
 * 概述：教学用在线式 UPS 仿真组件。上半部分为操作界面（LCD 显示屏、
 * 状态指示灯与操作按钮），下半部分为原理与接口界面（输入开关、整流器、
 * 逆变器、储能电池、旁路开关、静态开关、输出开关、负载开关与外部接口）。
 *
 * 工作模式（由 UPS 控制器自动判定）：
 *   normal  — 在线模式：输入正常，整流器整流 → 逆变器逆变输出（LINE 亮）
 *   battery — 电池模式：输入失电，电池经逆变器输出（BATTERY 亮）
 *   bypass  — 旁路模式：UPS 故障，输入经旁路开关 + 静态开关直通输出（BYPASS 亮）
 *   fault   — 故障：无可供电电源（FAULT 亮）
 *   off     — 关机（ON/OFF 按钮控制）
 *
 * 可交互开关：输入电源开关、储能电池开关、输出开关、负载开关1、负载开关2
 * 控制器开关：旁路开关、静态开关（单刀双掷，默认搭旁路侧）
 *
 * 电气行为：
 *   - 输入端口 in_p / in_n 仅用于检测输入电压（RMS 峰值检测）
 *   - 输出端口 out1_p/out1_n（第1路）、out2_p/out2_n（第2路）在供电时
 *     通过诺顿等效注入交流电压源（stampUPSs）
 *   - 负载百分比 = 用户设定模拟负载 + 实测输出电流折算
 */
export class UPS extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.width  = Math.max(480, config.width  || 600);
        this.height = Math.max(420, config.height || 480);

        this.type  = 'ups';
        this.cache = 'fixed';

        this._initGroups();
        this._recalcGeometry();
        this._initParameters(config);
        this._init();

        this.config = {
            id: this.id,
            label:           this._label,
            ratedPower:      this._ratedPower,
            freq:            this._freq,
            outVoltage:      this._outVoltage,
            batteryCapacity: this._batteryCapacity,
            initialSOC:      this._soc,
            rOn:             this._rOn,
        };

        // 电气端口：左边输入 220V，右上一路输出，右下二路负载输出
        this.addPort(this._portIn.p.x,  this._portIn.p.y,  'in_p',  'wire', 'p');
        this.addPort(this._portIn.n.x,  this._portIn.n.y,  'in_n',  'wire');
        this.addPort(this._portOut1.p.x, this._portOut1.p.y, 'out1_p', 'wire', 'p');
        this.addPort(this._portOut1.n.x, this._portOut1.n.y, 'out1_n', 'wire');
        this.addPort(this._portOut2.p.x, this._portOut2.p.y, 'out2_p', 'wire', 'p');
        this.addPort(this._portOut2.n.x, this._portOut2.n.y, 'out2_n', 'wire');
    }

    // ─────────────────────────── 几何布局 ───────────────────────────
    _recalcGeometry() {
        const W = this.width, H = this.height;

        // 上半部分：UPS 操作界面
        this._ui = { top: 4, h: 140 };
        this._lcd = { x: 10, y: 30, w: 400, h: 55 };
        // 状态指示灯：一排 4 个，位于液晶显示屏正下方
        this._leds = [
            { key: 'line',  label: 'LINE',    x: 455, y: 35, color: '#2ecc71' },
            { key: 'bat',   label: 'BATTERY', x: 535, y: 35, color: '#f1c40f' },
            { key: 'byp',   label: 'BYPASS',  x: 455, y: 85, color: '#3498db' },
            { key: 'fault', label: 'FAULT',   x: 535, y: 85, color: '#e74c3c' },
        ];
        this._btns = {
            on:   { x: 30,   y: 95,  w: 90, h: 36, label: 'ON' },
            off:  { x: 135,  y: 95,  w: 90, h: 36, label: 'OFF' },
            up:   { x: 245,  y: 93,  w: 62, h: 20, label: '▲' },
            down: { x: 245,  y: 118, w: 62, h: 20, label: '▼' },
            ent:  { x: 322,  y: 95,  w: 90, h: 36, label: 'ENTER' },
        };

        // 下半部分：原理与接口界面
        this._sch = { top: 140 };

        // 端口
        this._portIn   = { p: { x: 0, y: 260 }, n: { x: 0, y: 440 } };
        this._portOut1 = { p: { x: W, y: 170 }, n: { x: W, y: 210 } };
        this._portOut2 = { p: { x: W, y: 270 }, n: { x: W, y: 320 } };

        // 可交互开关（储能开关转轴在左、动触点朝右，其余均参照输出开关：转轴在右、动触点在左）
        this._swInput  = { cx: 36,  cy: 260, len: 24, vertical: false };
        this._swBypass = { cx: 235, cy: 186, len: 25, vertical: false };
        this._swBatt   = { cx: 225, cy: 302, len: 22, vertical: true, arcRot: 270 };
        this._swOutput = { cx: 415, cy: 223, len: 25, vertical: false };
        this._swLoad1  = { cx: 515, cy: 170, len: 25, vertical: false };
        this._swLoad2  = { cx: 515, cy: 270, len: 25, vertical: false };

        // 功率器件
        this._rectifier = { x: 135, y: 236, w: 70, h: 48 };
        this._inverter  = { x: 245, y: 236, w: 65, h: 48 };
        this._staticSw  = { pivot: { x: 370, y: 223 }, top: { x: 325, y: 186 }, bot: { x: 325, y: 260 } };
        this._battery   = { x: 195, y: 345, w: 60, h: 80 };

        this._staticBladeLen = 58; // 静态开关刀片长度（末端略短于触点，黄铜半圆搭接）
    }

    // ─────────────────────────── 运行参数 ───────────────────────────
    _initParameters(config) {
        this._label           = config.label           || 'UPS 不间断电源';
        this._ratedPower      = config.ratedPower      !== undefined ? config.ratedPower      : 2000;
        this._freq            = config.freq            !== undefined ? config.freq            : 50;
        this._outVoltage      = config.outVoltage      !== undefined ? config.outVoltage      : 220;
        this._batteryCapacity = config.batteryCapacity !== undefined ? config.batteryCapacity : 50;
        this._soc             = Math.max(0, Math.min(1, config.initialSOC !== undefined ? config.initialSOC : 0.9));
        this._rOn             = config.rOn             !== undefined ? config.rOn             : 0.5;

        // 可交互开关状态
        this._inputSwitch  = (config.inputSwitch  !== undefined ? config.inputSwitch  : false);
        this._batterySwitch= (config.batterySwitch!== undefined ? config.batterySwitch: false);
        this._outputSwitch = (config.outputSwitch !== undefined ? config.outputSwitch : false);
        this._loadSwitch1  = (config.loadSwitch1  !== undefined ? config.loadSwitch1  : false);
        this._loadSwitch2  = (config.loadSwitch2  !== undefined ? config.loadSwitch2  : false);

        // 控制器开关状态
        this._bypassSwitch = false;      // 旁路开关（控制器）
        this._staticPos    = 'bypass';   // 静态开关位置：bypass(搭上/旁路) 或 inverter(搭下/逆变)

        // UPS 控制器状态
        this._powerOn  = config.powerOn !== undefined ? config.powerOn : false;
        this._mode     = 'off';
        this._fault    = false;
        this._faultBattery = false;

        // LCD 交互
        this._lcdPage = 0;               // 0: 输入/输出/电池/负载, 1: 模式/频率/电池电压
        this._editMode = false;          // ENT 编辑模式
        this._simLoad = 0;               // 设定模拟负载百分比 0~150

        // 测量缓冲（峰值检测 → RMS）
        this._inPeak  = 0;
        this._inRms   = 0;
        this._inBuf   = [];
        this._outVoltageRms = 0;
        this._i1Peak  = 0;
        this._i2Peak  = 0;
        this._out1Buf = [];
        this._out2Buf = [];
        this._upsVIdx  = { out1: -1, out2: -1 };
        this._upsCurrent = { out1: 0, out2: 0 };
        this._outputPowerW = 0;

        // 故障计时
        this._faultTimer = 0;
        this._faultClearTimer = 0;

        this._I_rated = this._ratedPower / this._outVoltage;
        this._phaseOffset = 0;

        // 起动 / 关机时序序列
        this._startPhase    = 'idle';   // idle | bypass | rectFlash | invFlash | invWait | line
        this._shutdownPhase = 'idle';   // idle | invStop | rectStop | done
        this._seqTimer      = 0;        // 序列阶段计时
        this._flashTimer    = 0;        // 闪烁半周期计时
        this._flashOn       = true;     // 闪烁即时状态（亮/灭）
        this._flashCount    = 0;        // 已翻转半周期数（3 次闪烁 = 6 个半周期）
        this._flashDone     = false;
        this._rectActive    = false;    // 整流器投入（保持淡绿阴影）
        this._invActive     = false;    // 逆变器投入
        this._rectFlash     = false;    // 整流器闪烁中
        this._invFlash      = false;    // 逆变器闪烁中
    }

    // ─────────────────────────── 初始化 ───────────────────────────
    _init() {
        this._drawStaticParts();
        this._createDynamicNodes();
        this._bindInteraction();
    }

    // ═══════════════════════════ 静态绘制 ═══════════════════════════
    _drawStaticParts() {
        this._drawOperationPanel();
        this._drawSchematic();
    }

    // ── 上半部分：操作界面 ──
    _drawOperationPanel() {
        const W = this.width;
        // 面板外框
        this._staticGroup.add(new Konva.Rect({
            x: 2, y: 2, width: W - 4, height: this._ui.h,
            fill: '#eef1f5', stroke: '#5b6b7c', strokeWidth: 2, cornerRadius: 6,
        }));

        // 标题
        this._staticGroup.add(new Konva.Text({
            x: 12, y: 8, text: this._label, name: 'ups-title',
            fontSize: 16, fontStyle: 'bold', fill: '#2c3e50',
        }));

        // LCD 显示屏背景
        this._staticGroup.add(new Konva.Rect({
            x: this._lcd.x, y: this._lcd.y, width: this._lcd.w, height: this._lcd.h,
            fill: '#071f16', stroke: '#2c3e50', strokeWidth: 2, cornerRadius: 4,
        }));

        // 状态指示灯底座与标签
        this._leds.forEach(led => {
            this._staticGroup.add(new Konva.Circle({
                x: led.x, y: led.y, radius: 10,
                fill: '#3a3f47', stroke: '#1f242b', strokeWidth: 1.5,
            }));
            this._staticGroup.add(new Konva.Text({
                x: led.x - 28, y: led.y + 16, width: 56, align: 'center',
                text: led.label, fontSize: 11, fontStyle: 'bold', fill: '#5b6b7c',
            }));
        });

        // 操作按钮（静态底 + 动态文字在 _createDynamicNodes 中补充高亮）
        const btnList = [this._btns.on, this._btns.off, this._btns.ent];
        btnList.forEach(b => {
            b.base = new Konva.Rect({
                x: b.x, y: b.y, width: b.w, height: b.h,
                fill: '#d9dee6', stroke: '#5b6b7c', strokeWidth: 1.5, cornerRadius: 4,
            });
            this._staticGroup.add(b.base);
        });
        // 上下键（小圆角矩形）
        [this._btns.up, this._btns.down].forEach(b => {
            this._staticGroup.add(new Konva.Rect({
                x: b.x, y: b.y, width: b.w, height: b.h,
                fill: '#d9dee6', stroke: '#5b6b7c', strokeWidth: 1.2, cornerRadius: 3,
            }));
        });
    }

    // ── 下半部分：原理与接口界面 ──
    _drawSchematic() {
        const wire = '#20242c';
        const neutral = '#8a93a0';

        // ── 火线主回路 ──
        // 输入端口 → 输入开关 → 分支点（缺口容纳动触点与静触点）
        this._line([0, 260, 32, 260], wire);
        this._line([64, 260, 110, 260], wire);
        // 分支 → 旁路支路
        this._line([110, 260, 110, 186], wire);
        this._line([110, 186, 231, 186], wire);
        this._line([264, 186, 325, 186], wire);
        // 分支 → 整流器
        this._line([110, 260, this._rectifier.x, 260], wire);
        // 整流器 → 逆变器
        this._line([this._rectifier.x + this._rectifier.w, 260, this._inverter.x, 260], wire);
        // 整流器-逆变器中点 → 电池开关（垂直，转轴在下、动触点朝上）→ 电池
        this._line([225, 260, 225, 298], wire);
        this._line([225, 324, 225, this._battery.y], wire);
        // 逆变器 → 静态开关下触点（水平引出，触点即水平线右端）
        this._line([this._inverter.x + this._inverter.w, 260, 325, 260], wire);
        // 静态开关支点 → 输出开关（同高 y=223）
        this._line([370, 223, 410, 223], wire);
        // 输出开关 → 分支点（水平向右 y=223）
        this._line([445, 223, 495, 223], wire);
        // 支路1：→ 负载开关1 → out1_p
        this._line([495, 223, 495, 170], wire);
        this._line([495, 170, 510, 170], wire);
        this._line([545, 170, this.width, 170], wire);
        // 支路2：→ 负载开关2 → out2_p
        this._line([495, 223, 495, 270], wire);
        this._line([495, 270, 510, 270], wire);
        this._line([545, 270, this.width, 270], wire);

        // ── 中性线（虚线连接 3 个 N 端口：in_n(0,440) / out1_n(W,210) / out2_n(W,320)）──
        this._line([0, 440, 450, 440], neutral, 1.4, [6, 3]);
        this._line([450, 440, 450, 210], neutral, 1.4, [6, 3]);
        this._line([450, 210, this.width, 210], neutral, 1.4, [6, 3]);
        this._line([450, 320, this.width, 320], neutral, 1.4, [6, 3]);

        // 端口标签（L/N 均标注在各自端口上方 8px；距组件内侧边界统一 24px）
        this._portLabel(4, 252, 'L', '#e03030');
        this._portLabel(24, 432, 'N', '#2060c8');
        this._portLabel(this.width - 24, 162, 'L', '#e03030');
        this._portLabel(this.width - 24, 202, 'N', '#2060c8');
        this._portLabel(this.width - 24, 262, 'L', '#e03030');
        this._portLabel(this.width - 24, 312, 'N', '#2060c8');

        // 输入接口标注
        this._staticGroup.add(new Konva.Text({
            x: 4, y: 350, text: '交流输入', fontSize: 12, fill: '#7f8c8d',
        }));
        this._staticGroup.add(new Konva.Text({
            x: this.width - 70, y: 215, text: '第1路输出', fontSize: 12, fill: '#7f8c8d',
        }));
        this._staticGroup.add(new Konva.Text({
            x: this.width - 88, y: 325, text: '第2路输出', fontSize: 12, fill: '#7f8c8d',
       }));

        // ── 整流器（AC→DC）──
        this._drawConverter(this._rectifier, 'Rectifier', true);
        // ── 逆变器（DC→AC）──
        this._drawConverter(this._inverter, 'Inverter', false);

        // ── 216V 蓄电池组 ──
        this._drawBatteryGroup();

        // ── 静态开关（单刀双掷）固定触点 ──
        const s = this._staticSw;
        [s.top, s.bot].forEach(pt => {
            this._staticGroup.add(new Konva.Circle({
                x: pt.x, y: pt.y, radius: 4, fill: '#e8c86a', stroke: wire, strokeWidth: 1.5,
            }));
        });
        this._staticGroup.add(new Konva.Circle({
            x: s.pivot.x, y: s.pivot.y, radius: 4, fill: '#20242c',
        }));
        this._staticGroup.add(new Konva.Text({
            x: s.pivot.x - 42, y: s.pivot.y + 26, width: 84, align: 'center',
            text: 'Static Switch', fontSize: 11, fill: '#7f8c8d',
        }));

        // ── 交互开关（静态触点）──
        this._drawSwitchStatic(this._swInput, '输入电源');
        this._drawSwitchStatic(this._swBypass, 'Bypass');
        this._drawSwitchStatic(this._swBatt, 'Battery');
        this._drawSwitchStatic(this._swOutput, '输出');
        this._drawSwitchStatic(this._swLoad1, '负载1');
        this._drawSwitchStatic(this._swLoad2, '负载2');
    }

    _line(pts, color, w = 2, dash = null) {
        this._staticGroup.add(new Konva.Line({
            points: pts, stroke: color, strokeWidth: w, dash: dash, listening: false,
        }));
    }

    _portLabel(x, y, text, color) {
        this._staticGroup.add(new Konva.Text({
            x, y, text, fontSize: 13, fontStyle: 'bold', fill: color,
        }));
    }

    // 整流器 / 逆变器：矩形 + 对角分割，左侧输入符号、右侧输出符号
    _drawConverter(box, label, ac2dc) {
        const { x, y, w, h } = box;
        this._staticGroup.add(new Konva.Rect({
            x, y, width: w, height: h,
            fill: '#fbfcfd', stroke: '#20242c', strokeWidth: 1.6,
        }));
        // 对角线（左下 → 右上）
        this._staticGroup.add(new Konva.Line({
            points: [x, y + h, x + w, y], stroke: '#20242c', strokeWidth: 1.2,
        }));
        const cx = x + w / 2, cy = y + h / 2;
        if (ac2dc) {
            // 左上：交流波浪；右下：直流两条短线
            this._staticGroup.add(new Konva.Line({
                points: [x + 8, cy - 8, x + 16, cy - 13, x + 24, cy - 3, x + 32, cy - 8],
                stroke: '#e03030', strokeWidth: 1.6, listening: false,
            }));
            this._staticGroup.add(new Konva.Line({ points: [x + w - 26, cy + 8, x + w - 12, cy + 8], stroke: '#2060c8', strokeWidth: 1.8, listening: false }));
            this._staticGroup.add(new Konva.Line({ points: [x + w - 26, cy + 16, x + w - 12, cy + 16], stroke: '#2060c8', strokeWidth: 1.8, listening: false }));
        } else {
            // 左上：直流两条短线；右下：交流波浪
            this._staticGroup.add(new Konva.Line({ points: [x + 8, cy - 8, x + 24, cy - 8], stroke: '#2060c8', strokeWidth: 1.8, listening: false }));
            this._staticGroup.add(new Konva.Line({ points: [x + 8, cy - 16, x + 24, cy - 16], stroke: '#2060c8', strokeWidth: 1.8, listening: false }));
            this._staticGroup.add(new Konva.Line({
                points: [x + w - 34, cy + 12, x + w - 24, cy + 7, x + w - 14, cy + 17, x + w - 4, cy + 12],
                stroke: '#e03030', strokeWidth: 1.6, listening: false,
            }));
        }
        this._staticGroup.add(new Konva.Text({
            x, y: y + h + 3, width: w, align: 'center',
            text: label, fontSize: 12, fill: '#7f8c8d',
        }));
    }

    _drawBatteryGroup() {
        const b = this._battery;
        this._staticGroup.add(new Konva.Rect({
            x: b.x, y: b.y, width: b.w, height: b.h,
            fill: '#dfe7ee', stroke: '#20242c', strokeWidth: 1.6, cornerRadius: 3,
        }));
        // 电池符号（长线 + 短线）
        const cxs = [b.x + 16, b.x + 30, b.x + 44];
        cxs.forEach(cx => {
            this._staticGroup.add(new Konva.Line({ points: [cx, b.y + 14, cx, b.y + 40], stroke: '#e03030', strokeWidth: 2.5, listening: false }));
            this._staticGroup.add(new Konva.Line({ points: [cx + 3, b.y + 18, cx + 3, b.y + 36], stroke: '#2060c8', strokeWidth: 2, listening: false }));
        });
        this._staticGroup.add(new Konva.Line({ points: [b.x + 12, b.y + 27, b.x + 48, b.y + 27], stroke: '#6a7a8a', strokeWidth: 1.2, listening: false }));
        this._staticGroup.add(new Konva.Text({
            x: b.x, y: b.y + 46, width: b.w, align: 'center',
            text: '216V', fontSize: 13, fontStyle: 'bold', fill: '#2c3e50',
        }));
        this._staticGroup.add(new Konva.Text({
            x: b.x - 34, y: b.y + 10, text: '+', fontSize: 14, fontStyle: 'bold', fill: '#e03030',
        }));
    }

    // 开关静态部分：静触点（小圆点）+ 标签（参照接触器常开辅助触头形式）
    _drawSwitchStatic(sw, label) {
        const { cx, cy, len, vertical } = sw;
        const fixed = vertical ? { x: cx, y: cy + len } : { x: cx, y: cy };
        const mate  = vertical ? { x: cx, y: cy }       : { x: cx + len, y: cy };
        [fixed, mate].forEach(pt => {
            // 静触点小圆点
            this._staticGroup.add(new Konva.Circle({
                x: pt.x, y: pt.y, radius: 4,
                fill: '#888', stroke: '#908030', strokeWidth: 0.8,
            }));
        });
        this._staticGroup.add(new Konva.Text({
            x: vertical ? cx - 30 : cx - 12, y: vertical ? cy + len + 7 : cy - 20,
            width: vertical ? 60 : 52, align: 'center',
            text: label, fontSize: 11, fill: '#7f8c8d',
        }));
    }

    // ═══════════════════════════ 动态节点 ═══════════════════════════
    _createDynamicNodes() {
        // LCD 文字
        this._lcdLine1 = new Konva.Text({
            x: this._lcd.x + 10, y: this._lcd.y + 6, width: this._lcd.w - 20,
            text: '', fontSize: 19, fontFamily: 'monospace', fontStyle: 'bold',
            fill: '#00ff66', listening: false,
        });
        this._lcdLine2 = new Konva.Text({
            x: this._lcd.x + 10, y: this._lcd.y + 32, width: this._lcd.w - 20,
            text: '', fontSize: 19, fontFamily: 'monospace', fontStyle: 'bold',
            fill: '#00ff66', listening: false,
        });
        this._dynamicGroup.add(this._lcdLine1, this._lcdLine2);

        // 状态指示灯
        this._ledNodes = {};
        this._leds.forEach(led => {
            const n = new Konva.Circle({
                x: led.x, y: led.y, radius: 10,
                fill: led.color, opacity: 0.12, listening: false,
            });
            this._dynamicGroup.add(n);
            this._ledNodes[led.key] = n;
        });

        // 按钮文字
        const btnStyle = { fontSize: 15, fontStyle: 'bold', align: 'center', listening: false };
        const mkBtnText = (b, color, xOff = 0) => new Konva.Text({
            x: b.x + xOff, y: b.y + b.h / 2 - 10, width: b.w,
            text: b.label, fill: color, ...btnStyle,
        });
        this._btnTexts = {
            on:   mkBtnText(this._btns.on, '#1e8449'),
            off:  mkBtnText(this._btns.off, '#c0392b'),
            ent:  mkBtnText(this._btns.ent, '#2471a3'),
            up:   mkBtnText(this._btns.up, '#34495e'),
            down: mkBtnText(this._btns.down, '#34495e'),
        };
        Object.values(this._btnTexts).forEach(t => this._dynamicGroup.add(t));

        // 开关刀片
        this._bladeNodes = {};
        this._makeSwitchBlade(this._swInput,  'input');
        this._makeSwitchBlade(this._swBypass, 'bypass');
        this._makeSwitchBlade(this._swBatt,   'batt');
        this._makeSwitchBlade(this._swOutput, 'output');
        this._makeSwitchBlade(this._swLoad1,  'load1');
        this._makeSwitchBlade(this._swLoad2,  'load2');

        // 静态开关刀片（大闸，样式与刀开关一致）
        const s = this._staticSw;
        this._staticBlade = new Konva.Group({ x: s.pivot.x, y: s.pivot.y });
        this._staticBlade.add(new Konva.Line({
            points: [0, 0, this._staticBladeLen, 0],
            stroke: '#2c3138', strokeWidth: 4.5, lineCap: 'round', listening: false,
        }));
        this._staticBlade.add(new Konva.Line({
            points: [0, 0, this._staticBladeLen, 0],
            stroke: 'rgba(255,255,255,0.25)', strokeWidth: 1.4, lineCap: 'round', listening: false,
        }));
        this._staticBlade.add(new Konva.Circle({
            x: this._staticBladeLen, y: 0, radius: 4.6,
            fill: '#e8c86a', stroke: '#7a6528', strokeWidth: 1.5, listening: false,
        }));
        this._staticBlade.rotation(this._staticAngle('bypass'));
        this._dynamicGroup.add(this._staticBlade);

        // 电池 SOC 百分比
        this._battText = new Konva.Text({
            x: this._battery.x - 30, y: this._battery.y + this._battery.h + 4, width: this._battery.w + 60, align: 'center',
            text: '', fontSize: 12, fontStyle: 'bold', fill: '#2060c8', listening: false,
        });
        this._dynamicGroup.add(this._battText);

        // 整流器 / 逆变器工作指示（淡绿色填充 + 绿色边框）
        this._rectGlow = new Konva.Rect({
            x: this._rectifier.x - 2, y: this._rectifier.y - 2,
            width: this._rectifier.w + 4, height: this._rectifier.h + 4,
            fill: 'rgba(39,174,96,0.30)', stroke: '#27ae60', strokeWidth: 2,
            opacity: 0, cornerRadius: 2, listening: false,
        });
        this._invGlow = new Konva.Rect({
            x: this._inverter.x - 2, y: this._inverter.y - 2,
            width: this._inverter.w + 4, height: this._inverter.h + 4,
            fill: 'rgba(39,174,96,0.30)', stroke: '#27ae60', strokeWidth: 2,
            opacity: 0, cornerRadius: 2, listening: false,
        });
        // 电池 / 旁路开关工作指示（淡绿色填充 + 绿色边框）
        this._battGlow = new Konva.Rect({
            x: this._battery.x - 2, y: this._battery.y - 2,
            width: this._battery.w + 4, height: this._battery.h + 4,
            fill: 'rgba(39,174,96,0.30)', stroke: '#27ae60', strokeWidth: 2,
            opacity: 0, cornerRadius: 2, listening: false,
        });
        const bw = this._swBypass;
        this._bypGlow = new Konva.Rect({
            x: bw.cx - 16, y: bw.cy - 14, width: bw.len + 32, height: 28,
            fill: 'rgba(39,174,96,0.30)', stroke: '#27ae60', strokeWidth: 2,
            opacity: 0, cornerRadius: 3, listening: false,
        });
        this._dynamicGroup.add(this._rectGlow, this._invGlow, this._battGlow, this._bypGlow);
    }

    _makeSwitchBlade(sw, key) {
        const { cx, cy, len, vertical, flip } = sw;
        // 水平开关（默认）：转轴在对侧（右端），动臂向左延伸，动触点（半圆）在左端
        // 水平开关（flip）：转轴在刀座端（左端），动臂向右延伸，动触点（半圆）在右端
        // 垂直开关：转轴在下端，动臂向上延伸，动触点在顶端
        const group = new Konva.Group({
            x: vertical ? cx : (flip ? cx : cx + len),
            y: vertical ? cy + len : cy,
        });
        const pts = vertical ? [0, 0, 0, -len] : (flip ? [0, 0, len, 0] : [0, 0, -len, 0]);
        // 红色动触点臂（参照接触器常开辅助触头形式，绕转轴端旋转）
        group.add(new Konva.Line({
            points: pts, stroke: '#e03030', strokeWidth: 2.5, lineCap: 'round', listening: false,
        }));
        // 端部黄铜半圆动触点（搭向对面静触点）
        group.add(new Konva.Arc({
            x: vertical ? 0 : (flip ? len : -len), y: vertical ? -len : 0,
            innerRadius: 0, outerRadius: 5,
            angle: 180, rotation: sw.arcRot || 180,
            fill: '#e8c86a', stroke: '#e03030', strokeWidth: 1.5, listening: false,
        }));
        this._dynamicGroup.add(group);
        this._bladeNodes[key] = group;
    }

    // 静态开关刀片角度
    _staticAngle(pos) {
        const s = this._staticSw;
        const target = pos === 'bypass' ? s.top : s.bot;
        return Math.atan2(target.y - s.pivot.y, target.x - s.pivot.x) * 180 / Math.PI;
    }

    // ═══════════════════════════ 交互 ═══════════════════════════
    _bindInteraction() {
        // 按钮
        this._addButton(this._btns.on,  null, () => this.pressOn());
        this._addButton(this._btns.off, null, () => this.pressOff());
        this._addButton(this._btns.up, () => this.pressUp());
        this._addButton(this._btns.down, () => this.pressDown());
        this._addButton(this._btns.ent, () => this.pressEnt());

        // 可交互开关（无变色交互，点击仅切换闭合/断开）
        // 部件识别 + 开关切换（供工作流 find 定位）
        this.addClickablePart('inputSwitch',   this._swInput.cx - 32, this._swInput.cy - 18, this._swInput.len + 64, 36);
        this.addClickablePart('batterySwitch', this._swBatt.cx - 18, this._swBatt.cy - 20, 36, this._swBatt.len + 40);
        this.addClickablePart('outputSwitch',  this._swOutput.cx - 28, this._swOutput.cy - 16, 56, 32);
        this.addClickablePart('loadSwitch1',   this._swLoad1.cx - 22, this._swLoad1.cy - 14, 44, 28);
        this.addClickablePart('loadSwitch2',   this._swLoad2.cx - 22, this._swLoad2.cy - 14, 44, 28);

        // 关键模块识别部件（供工作流 find 定位，仅上报点击，不切换任何状态）
        this._addIdentifyPart('rectifier',   this._rectifier.x, this._rectifier.y, this._rectifier.w, this._rectifier.h);
        this._addIdentifyPart('inverter',    this._inverter.x,  this._inverter.y,  this._inverter.w,  this._inverter.h);
        this._addIdentifyPart('battery',     this._battery.x,   this._battery.y,   this._battery.w,   this._battery.h);
        const _stSw = this._staticSw;
        this._addIdentifyPart('staticSwitch', _stSw.top.x - 50, _stSw.top.y - 10, 105, _stSw.bot.y - _stSw.top.y + 20);
    }

    // 关键模块识别：透明点击区，点击仅记录 lastClickedId/lastClickedPartId，不触发开关
    _addIdentifyPart(partId, x, y, w, h) {
        const _this = this;
        const hit = new Konva.Rect({
            x: x, y: y, width: w, height: h,
            fill: 'rgba(0, 0, 0, 0)', stroke: null, listening: true, cursor: 'pointer',
        });
        hit.on('click tap', (e) => {
            e.cancelBubble = true;
            _this.sys.lastClickedId = _this.id;
            _this.sys.lastClickedPartId = _this.id + '/' + partId;
        });
        hit.on('mouseenter', () => { _this.sys.stage.container().style.cursor = 'pointer'; });
        hit.on('mouseleave', () => { _this.sys.stage.container().style.cursor = 'default'; });
        this._interactGroup.add(hit);
    }

    _addButton(cfg, onClick, onLongPress) {
        const hit = new Konva.Rect({
            x: cfg.x, y: cfg.y, width: cfg.w, height: cfg.h,
            fill: 'transparent', cursor: 'pointer',
        });
        if (onLongPress) {
            // 长按 3s 专用：仅按住满 3s 触发 onLongPress，未满松开/移出即取消；按住期间按钮高亮
            let timer = null;
            const setHold = (hold) => {
                if (cfg.base) cfg.base.setAttrs(hold
                    ? { fill: '#ffe082', stroke: '#b8860b', strokeWidth: 2 }
                    : { fill: '#d9dee6', stroke: '#5b6b7c', strokeWidth: 1.5 });
            };
            const start = (e) => {
                e.cancelBubble = true;
                this.sys.lastClickedId = this.id;
                setHold(true);
                timer = setTimeout(() => {
                    timer = null;
                    setHold(false);
                    onLongPress();
                }, 3000);
            };
            const cancel = () => {
                if (timer) { clearTimeout(timer); timer = null; setHold(false); }
            };
            hit.on('mousedown touchstart', start);
            hit.on('mouseup mouseleave touchend', cancel);
        } else {
            hit.on('click tap', (e) => {
                e.cancelBubble = true;
                this.sys.lastClickedId = this.id;
                onClick();
            });
        }
        hit.on('mouseenter', () => { this.sys.stage.container().style.cursor = 'pointer'; });
        hit.on('mouseleave', () => { this.sys.stage.container().style.cursor = 'default'; });
        this._interactGroup.add(hit);
    }

    // 覆盖 BaseComponent.addClickablePart：去掉区域变色（hover 绿框 / 点击闪绿），点击直接切换开关
    addClickablePart(partId, x, y, w, h) {
        const _this = this;
        const group = new Konva.Group({ x: x, y: y });
        const hit = new Konva.Rect({
            width: w, height: h,
            fill: 'rgba(0, 0, 0, 0)',
            stroke: null,
            listening: true,
            cursor: 'pointer',
        });
        hit.on('click tap', (e) => {
            e.cancelBubble = true;
            _this.sys.lastClickedId = _this.id;
            _this.sys.lastClickedPartId = _this.id + '/' + partId;
            _this.toggleSwitch(partId);
        });
        hit.on('mouseenter', () => { _this.sys.stage.container().style.cursor = 'pointer'; });
        hit.on('mouseleave', () => { _this.sys.stage.container().style.cursor = 'default'; });
        group.add(hit);
        this._interactGroup.add(group);
    }

    // ─────────────────────────── 公共操作接口 ───────────────────────────
    // 长按 ON（或点击）：输入有效（输入开关闭合且电压>150V）时起动 UPS 时序
    pressOn() {
        if (!this._inputOk) return;
        if (this._startPhase !== 'idle' || this._powerOn) return;
        this._editMode = false;
        this._faultTimer = 0;
        this._shutdownPhase = 'idle';
        this._powerOn = true;
        // 阶段1：接通旁路开关，进入旁路模式（保持 10s）
        this._startPhase = 'bypass';
        this._seqTimer = 0;
        this._rectActive = false;
        this._invActive = false;
        this._rectFlash = false;
        this._invFlash = false;
        this._bypassSwitch = true;
        this._staticPos = 'bypass';
        this._mode = 'bypass';
    }

    // 长按 OFF（或点击）：进入关机时序（逆变器→整流器逐级停止，静态开关转旁路）
    pressOff() {
        if (!this._powerOn && this._startPhase === 'idle') return;
        if (this._shutdownPhase !== 'idle') return;
        this._editMode = false;
        this._faultTimer = 0;
        this._powerOn = false;
        this._startPhase = 'idle';
        this._rectFlash = false;
        this._invFlash = false;
        this._bypassSwitch = false;   // 旁路开关保持断开
        // 阶段1：逆变器停止（1s 后去掉淡绿阴影）
        this._shutdownPhase = 'invStop';
        this._seqTimer = 0;
        this._invActive = false;
    }

    pressUp() {
        if (this._editMode) this._simLoad = Math.min(150, this._simLoad + 5);
        else this._lcdPage = 1;
    }
    pressDown() {
        if (this._editMode) this._simLoad = Math.max(0, this._simLoad - 5);
        else this._lcdPage = 0;
    }
    pressEnt() {
        this._editMode = !this._editMode;
    }

    toggleSwitch(key) {
        switch (key) {
            case 'inputSwitch':   this._inputSwitch = !this._inputSwitch; break;
            case 'batterySwitch': this._batterySwitch = !this._batterySwitch; break;
            case 'outputSwitch':  this._outputSwitch = !this._outputSwitch; break;
            case 'loadSwitch1':   this._loadSwitch1 = !this._loadSwitch1; break;
            case 'loadSwitch2':   this._loadSwitch2 = !this._loadSwitch2; break;
        }
        if (this.sys.onComponentStateChange) this.sys.onComponentStateChange(this);
    }

    getSwitchState(key) {
        switch (key) {
            case 'inputSwitch':   return this._inputSwitch;
            case 'batterySwitch': return this._batterySwitch;
            case 'outputSwitch':  return this._outputSwitch;
            case 'loadSwitch1':   return this._loadSwitch1;
            case 'loadSwitch2':   return this._loadSwitch2;
            case 'bypassSwitch':  return this._bypassSwitch;
            default: return false;
        }
    }

    setSwitchState(key, on) {
        switch (key) {
            case 'inputSwitch':   this._inputSwitch = !!on; break;
            case 'batterySwitch': this._batterySwitch = !!on; break;
            case 'outputSwitch':  this._outputSwitch = !!on; break;
            case 'loadSwitch1':   this._loadSwitch1 = !!on; break;
            case 'loadSwitch2':   this._loadSwitch2 = !!on; break;
        }
    }

    getMode()      { return this._mode; }
    isFault()      { return this._fault || this._faultBattery; }
    getSOC()       { return this._soc; }
    getLoadPercent(){ return this._loadPercent || 0; }
    setSimLoad(v)  { this._simLoad = Math.max(0, Math.min(150, parseFloat(v) || 0)); }
    getSimLoad()   { return this._simLoad; }

    // ─────────────────────────── 电气接口 ───────────────────────────
    _outAvailable() {
        if (this._mode === 'normal' || this._mode === 'battery') return true;      // 逆变输出
        if (this._mode === 'bypass' && this._bypassSwitch && this._inputOk) return true; // 旁路直通
        return false;
    }

    isOutputActive(ch) {
        if (!this._powerOn) return false;
        if (!this._outputSwitch) return false;
        if (!this._outAvailable()) return false;
        if (ch === 'out1' && !this._loadSwitch1) return false;
        if (ch === 'out2' && !this._loadSwitch2) return false;
        return true;
    }

    getOutputVoltageRms() {
        if (this._mode === 'bypass') return this._inRms || 0; // 旁路输出 = 输入电压
        return this._outVoltage;                               // 逆变输出 220V
    }

    getOutputInstant(ch, t) {
        if (!this.isOutputActive(ch)) return 0;
        const vrms = this.getOutputVoltageRms();
        return vrms * Math.SQRT2 * Math.sin(2 * Math.PI * this._freq * t + this._phaseOffset);
    }

    // ─────────────────────────── 仿真 tick ───────────────────────────
    tick(dt) {
        this._measureInput();
        this._updateController(dt);
        this._measureOutput();
        this._updateBattery(dt);
        this._updateFault(dt);
        this._updateDynamic();

        this.markDirty();
        this._refreshIfDirty();
    }

    // 输入电压峰值检测（滑动窗口 max-min → 峰值，再换算 RMS）
    _measureInput() {
        const v = this.sys.getVoltageBetween(`${this.id}_wire_in_p`, `${this.id}_wire_in_n`) || 0;
        this._inBuf.push(v);
        if (this._inBuf.length > 40) this._inBuf.shift();
        let mx = -1e12, mn = 1e12;
        for (let i = 0; i < this._inBuf.length; i++) {
            const x = this._inBuf[i];
            if (x > mx) mx = x;
            if (x < mn) mn = x;
        }
        this._inPeak = (mx - mn) / 2;
        this._inRms = this._inPeak / Math.SQRT2;
    }

    // 控制器状态机
    _updateController(dt) {
        this._inputOk = this._inputSwitch && this._inRms > 150;
        const hasBattery = this._batterySwitch && this._soc > 0;

        // 关机时序优先
        if (this._shutdownPhase !== 'idle') {
            this._advanceShutdown(dt);
            return;
        }
        // 起动时序
        if (this._startPhase !== 'idle' && this._startPhase !== 'line') {
            this._advanceStartup(dt);
            return;
        }
        // 正常运行（line 模式完成或未开机）
        if (!this._powerOn) {
            this._mode = 'off';
            this._staticPos = 'bypass';
            this._bypassSwitch = false;
            this._rectActive = false;
            this._invActive = false;
        } else if (this._fault || this._faultBattery) {
            if (this._inputOk) {
                this._mode = 'bypass';
                this._staticPos = 'bypass';
                this._bypassSwitch = true;
                this._rectActive = false;
                this._invActive = false;
            } else {
                this._mode = 'fault';
                this._staticPos = 'inverter';
                this._bypassSwitch = false;
                this._rectActive = false;
                this._invActive = false;
            }
        } else if (this._inputOk) {
            this._mode = 'normal';
            this._staticPos = 'inverter';
            this._bypassSwitch = false;
            this._rectActive = true;
            this._invActive = true;
        } else if (hasBattery) {
            this._mode = 'battery';
            this._staticPos = 'inverter';
            this._bypassSwitch = false;
            this._rectActive = false;   // 电池模式整流环节不投入
            this._invActive = true;     // 电池模式逆变器供电
        } else {
            this._mode = 'off';
            this._staticPos = 'inverter';
            this._bypassSwitch = false;
            this._rectActive = false;
            this._invActive = false;
        }
    }

    // ── 起动时序：旁路(10s) → 整流器闪3次 → 逆变器闪3次 → 4s 后 LINE ──
    _advanceStartup(dt) {
        if (this._startPhase === 'bypass') {
            this._seqTimer += dt;
            if (this._seqTimer >= 10) {
                this._startPhase = 'rectFlash';
                this._rectFlash = true;
                this._flashOn = true;
                this._flashTimer = 0;
                this._flashCount = 0;
                this._flashDone = false;
            }
        } else if (this._startPhase === 'rectFlash') {
            this._advanceFlash(dt);
            if (this._flashDone) {
                this._rectFlash = false;
                this._rectActive = true;            // 闪烁完成保持淡绿阴影
                this._startPhase = 'invFlash';
                this._invFlash = true;
                this._flashOn = true;
                this._flashTimer = 0;
                this._flashCount = 0;
                this._flashDone = false;
            }
        } else if (this._startPhase === 'invFlash') {
            this._advanceFlash(dt);
            if (this._flashDone) {
                this._invFlash = false;
                this._invActive = true;             // 闪烁完成保持淡绿阴影
                this._startPhase = 'invWait';
                this._seqTimer = 0;
                this._flashDone = false;
            }
        } else if (this._startPhase === 'invWait') {
            this._seqTimer += dt;
            if (this._seqTimer >= 4) {
                this._startPhase = 'line';
                this._staticPos = 'inverter';       // 静态开关往下接通逆变
                this._mode = 'normal';
                this._bypassSwitch = false;         // 旁路开关自动断开
            }
        }
    }

    // 闪烁推进：3 次闪烁（每次周期 0.5s = 亮 0.25s + 灭 0.25s，共 6 个半周期）
    _advanceFlash(dt) {
        this._flashTimer += dt;
        while (this._flashTimer >= 0.25 && !this._flashDone) {
            this._flashTimer -= 0.25;
            this._flashOn = !this._flashOn;
            this._flashCount++;
            if (this._flashCount >= 6) this._flashDone = true;
        }
    }

    // ── 关机时序：逆变器停(1s去阴影) → 整流器停(1s去阴影) → 静态开关转旁路 ──
    _advanceShutdown(dt) {
        this._seqTimer += dt;
        if (this._shutdownPhase === 'invStop') {
            if (this._seqTimer >= 1) {
                this._shutdownPhase = 'rectStop';   // 逆变器阴影已去掉，整流器停止
                this._seqTimer = 0;
                this._rectActive = false;
            }
        } else if (this._shutdownPhase === 'rectStop') {
            if (this._seqTimer >= 1) {
                this._shutdownPhase = 'done';       // 整流器阴影已去掉
                this._staticPos = 'bypass';         // 静态开关自动转向旁路
                this._mode = 'off';
            }
        } else if (this._shutdownPhase === 'done') {
            this._shutdownPhase = 'idle';
        }
    }

    // 输出电流峰-谷检测（滑动窗口 max-min → 幅值，与 _measureInput 一致，
    // 避免低采样率下衰减峰值检测低估负载）
    _bufAmplitude(buf) {
        if (!buf.length) return 0;
        let mx = -1e12, mn = 1e12;
        for (let i = 0; i < buf.length; i++) {
            const x = buf[i];
            if (x > mx) mx = x;
            if (x < mn) mn = x;
        }
        return (mx - mn) / 2;
    }

    // 输出电流峰值检测 + 负载百分比（电流来自 MNA 电压源支路回填）
    _measureOutput() {
        const i1 = this.isOutputActive('out1') ? (this._upsCurrent && this._upsCurrent.out1) || 0 : 0;
        const i2 = this.isOutputActive('out2') ? (this._upsCurrent && this._upsCurrent.out2) || 0 : 0;
        this._out1Buf.push(i1);
        this._out2Buf.push(i2);
        if (this._out1Buf.length > 40) this._out1Buf.shift();
        if (this._out2Buf.length > 40) this._out2Buf.shift();
        this._i1Peak = this._bufAmplitude(this._out1Buf);
        this._i2Peak = this._bufAmplitude(this._out2Buf);

        const i1rms = this._i1Peak / Math.SQRT2;
        const i2rms = this._i2Peak / Math.SQRT2;
        // 两路输出同源同相，总电流为两路 RMS 直接相加（勿用平方和开方，会低估）
        const iTotal = i1rms + i2rms;
        const extLoad = this._I_rated > 0 ? iTotal / this._I_rated * 100 : 0;
        this._extLoadPercent = extLoad;
        this._loadPercent = Math.min(150, this._simLoad + extLoad);
        this._outputPowerW = this._outVoltageRms * iTotal;
    }

    // 电池充放电模型
    _updateBattery(dt) {
        const cap = this._batteryCapacity || 1;
        if (this._mode === 'battery') {
            const iTotal = this._extLoadPercent / 100 * this._I_rated;
            const dSOC = (iTotal * dt) / (cap * 3600);
            this._soc = Math.max(0, this._soc - dSOC);
            if (this._soc <= 0) this._faultBattery = true;
        } else if (this._mode === 'normal') {
            this._soc = Math.min(1, this._soc + 0.0002 * dt); // 缓慢充电
            if (this._soc > 0.05) this._faultBattery = false;
        }
    }

    // 过载 / 电池耗尽故障
    _updateFault(dt) {
        if (!this._powerOn) {
            this._faultTimer = 0;
            this._faultClearTimer = 0;
            return;
        }
        if (this._loadPercent > 105) {
            this._faultTimer += dt;
            this._faultClearTimer = 0;
        } else {
            this._faultTimer = Math.max(0, this._faultTimer - dt * 2);
            if (this._fault && this._loadPercent < 90) {
                this._faultClearTimer += dt;
                if (this._faultClearTimer > 3) this._fault = false;
            }
        }
        if (this._faultTimer > 2) this._fault = true;
    }

    // ─────────────────────────── 动态更新 ───────────────────────────
    _updateDynamic() {
        // LCD 显示（两路供电为"或"：输入有效（电压+输入开关闭合） 或 储能电池（电池开关闭合且有电））
        const pct = v => v.toFixed(1);
        const lcdPower = this._inputOk || (this._batterySwitch && this._soc > 0);
        if (!lcdPower) {
            // 两路均无电：LCD 无显示
            this._lcdLine1.text('');
            this._lcdLine2.text('');
        } else if (this._editMode) {
            this._lcdLine1.text(`设定负载:${Math.round(this._simLoad)}%  (ENT确认)`);
            this._lcdLine2.text(`当前负载:${Math.round(this._loadPercent)}%`);
        } else if (this._lcdPage === 0) {
            this._lcdLine1.text(`输入:${pct(this._inRms)}V  输出:${pct(this._outVoltageRms)}V`);
            this._lcdLine2.text(`电池:${Math.round(this._soc * 100)}%  负载:${Math.round(this._loadPercent)}%`);
        } else {
            const modeName = { normal: '在线', battery: '电池', bypass: '旁路', fault: '故障', off: '关机' }[this._mode] || this._mode;
            this._lcdLine1.text(`模式:${modeName}  频率:${pct(this._freq)}Hz`);
            this._lcdLine2.text(`电池电压:${pct(216 * this._soc)}V  功率:${Math.round(this._outputPowerW)}W`);
        }

        // 状态指示灯
        const ledState = {
            line:  this._mode === 'normal',
            bat:   this._mode === 'battery',
            byp:   this._mode === 'bypass',
            fault: this._fault || this._faultBattery || this._mode === 'fault',
        };
        this._leds.forEach(led => {
            const on = ledState[led.key];
            this._ledNodes[led.key].opacity(on ? 1 : 0.12);
        });

        // 按钮高亮（ON 亮绿色 / OFF 亮红色 / ENT 亮蓝色）
        this._btnTexts.on.fill(this._powerOn ? '#27ae60' : '#1e8449');
        this._btnTexts.off.fill(this._powerOn ? '#c0392b' : '#7f1d1d');
        this._btnTexts.ent.fill(this._editMode ? '#f39c12' : '#2471a3');

        // 开关刀片
        const onMap = {
            input:  this._inputSwitch,
            bypass: this._bypassSwitch,
            batt:   this._batterySwitch,
            output: this._outputSwitch,
            load1:  this._loadSwitch1,
            load2:  this._loadSwitch2,
        };
        Object.keys(onMap).forEach(key => {
            const sw = { input: this._swInput, bypass: this._swBypass, batt: this._swBatt,
                         output: this._swOutput, load1: this._swLoad1, load2: this._swLoad2 }[key];
            const rot = onMap[key] ? -5 : -32.5;
            this._bladeNodes[key].rotation(rot);
        });

        // 静态开关刀片
        this._staticBlade.rotation(this._staticAngle(this._staticPos));

        // 电池 SOC
        this._battText.text(`电量 ${Math.round(this._soc * 100)}%`);
        this._battText.fill(this._soc > 0.3 ? '#27ae60' : (this._soc > 0.15 ? '#e0a030' : '#d04030'));

        // 器件工作状态突出显示（淡绿阴影）：闪烁中按亮灭切换，闪烁完成/运行保持阴影
        const rectOp = this._rectFlash ? (this._flashOn ? 1 : 0) : (this._rectActive ? 1 : 0);
        const invOp  = this._invFlash  ? (this._flashOn ? 1 : 0) : (this._invActive  ? 1 : 0);
        this._rectGlow.opacity(rectOp);
        this._invGlow.opacity(invOp);
        this._battGlow.opacity(this._mode === 'battery' ? 1 : 0);
        this._bypGlow.opacity(this._mode === 'bypass' ? 1 : 0);

        this._outVoltageRms = this.isOutputActive('out1') || this.isOutputActive('out2')
            ? this.getOutputVoltageRms() : 0;
    }

    // ─────────────────────────── 配置 ───────────────────────────
    getConfigFields() {
        return [
            { label: '名称',               key: 'label',           type: 'text'   },
            { label: '额定功率 (W)',       key: 'ratedPower',      type: 'number' },
            { label: '输出频率 (Hz)',       key: 'freq',            type: 'number' },
            { label: '输出电压有效值 (V)',  key: 'outVoltage',      type: 'number' },
            { label: '电池容量 (Ah)',       key: 'batteryCapacity', type: 'number' },
            { label: '初始电量 (0~1)',      key: 'initialSOC',      type: 'number' },
            { label: '输出内阻 (Ω)',        key: 'rOn',             type: 'number' },
            { label: '初始开机',            key: 'powerOn',         type: 'select', options: [
                { label: '关机', value: false },
                { label: '开机', value: true },
            ]},
        ];
    }

    onConfigUpdate(cfg) {
        if (cfg.label           !== undefined) this._label = cfg.label;
        if (cfg.ratedPower      !== undefined) this._ratedPower = parseFloat(cfg.ratedPower) || 2000;
        if (cfg.freq            !== undefined) this._freq = parseFloat(cfg.freq) || 50;
        if (cfg.outVoltage      !== undefined) this._outVoltage = parseFloat(cfg.outVoltage) || 220;
        if (cfg.batteryCapacity !== undefined) this._batteryCapacity = parseFloat(cfg.batteryCapacity) || 50;
        if (cfg.initialSOC      !== undefined) this._soc = Math.max(0, Math.min(1, parseFloat(cfg.initialSOC) || 0.9));
        if (cfg.rOn             !== undefined) this._rOn = parseFloat(cfg.rOn) || 0.5;
        if (cfg.powerOn         !== undefined) this._powerOn = cfg.powerOn === true || cfg.powerOn === 'true';
        this._I_rated = this._ratedPower / this._outVoltage;
        this.config = { ...this.config, ...cfg };

        // 标题文字更新
        this._staticGroup.findOne('.ups-title')?.destroy();
        this._staticGroup.add(new Konva.Text({
            x: 12, y: 8, text: this._label, name: 'ups-title',
            fontSize: 16, fontStyle: 'bold', fill: '#2c3e50',
        }));
        this._refreshCache();
    }

    destroy() {
        super.destroy?.();
    }
}
