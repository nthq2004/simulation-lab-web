import { BaseComponent } from './BaseComponent.js';

/**
 * 西门子 SINAMICS V20 紧凑型变频器仿真组件
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  外观：深灰机身 + 前面板 BOP（LCD + 6 键）+ 底部控制端子排 + 上下功率端子，
 *        右侧铭牌/警示标识，尽量还原实物照片配色与布局。
 *
 *  功率接口：
 *    L1/L2/L3   三相进线（380V 级）
 *    DC+/DC-    直流母线端子
 *    U/V/W      电机输出（三相，V/f 变频变压）
 *    PE         保护接地
 *
 *  控制接口（对照 V20 端子）：
 *    10V AI1 AI2 0V  →  模拟量给定（电位器 10V–0V，抽头接 AI1）
 *    DI1…DI4 DIC     →  数字量输入（PNP：DIC 接 0V，DI 接 24V 有效）
 *    24V 0V          →  内部 24V 辅助电源输出
 *    AO              →  模拟量输出（0–20mA，与输出频率成比例）
 *    DO1+/DO1-       →  晶体管输出（默认“变频器运行中”）
 *    DO2-C/DO2-NO    →  继电器输出（默认“变频器故障”）
 *    P+/N-           →  RS485（USS / Modbus RTU）
 *
 *  BOP 操作面板（仿真真实 V20）：
 *    I（绿）  启动（命令源 = 面板时有效）
 *    O（红）  停机（OFF1 斜坡停车）
 *    M        进入参数菜单 / 返回
 *    OK       确认 / 进入编辑 / 保存；故障时确认复位
 *    ▲ ▼      状态屏修改 MOP 频率；菜单内翻参数；编辑时改数值
 *    参数编辑与显示按用户访问级 P0003 过滤。
 *
 *  电路仿真：
 *    - U/V/W 由 DeviceStamps 作为三相诺顿电压源注入（V/f 控制，输出频率可调）；
 *    - 10V/24V 辅助电源内部注入，供电位器/DI 取用；
 *    - DO1/DO2 由 CircuitTopology 按状态内部短接触点。
 * ═══════════════════════════════════════════════════════════════════════════
 */
export class SinamicsV20 extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.width  = Math.max(240, config.width  || 300);
        this.height = Math.max(380, config.height || 450);

        this.type    = 'v20_inverter';
        this.special = 'drive';
        this.cache   = 'fixed';

        this._initGroups();
        this._recalcGeometry();
        this._initParameters(config);
        this._initState();
        this._init();

        this.config = {
            id: this.id,
            label: this.label,
            p0700: this._p.P0700,
            p1000: this._p.P1000,
            p0304: this._p.P0304,
            p0305: this._p.P0305,
            p0307: this._p.P0307,
            p0310: this._p.P0310,
            p0311: this._p.P0311,
            p1080: this._p.P1080,
            p1082: this._p.P1082,
            p1120: this._p.P1120,
            p1121: this._p.P1121,
            p1040: this._p.P1040,
        };

        this._registerPorts();
    }

    // ═══════════════════════════════════════════════════════════════
    // 几何
    // ═══════════════════════════════════════════════════════════════
    _recalcGeometry() {
        const W = this.width, H = this.height;

        this._body = { x: 0, y: 0, w: W, h: H, rx: 5 };

        // 顶部进线端子区（只放端子，品牌文字下移，避免与端子标签重叠）
        this._topZone = { x: 0, y: 0, w: W, h: H * 0.102 };

        // 品牌条
        this._brand = { x: 0, y: H * 0.107, w: W, h: H * 0.062 };

        // BOP 操作面板
        this._bop = { x: W * 0.04, y: H * 0.178, w: W * 0.92, h: H * 0.391 };
        this._lcd = {
            x: this._bop.x + W * 0.04,
            y: this._bop.y + H * 0.031,
            w: this._bop.w - W * 0.23,
            h: H * 0.164,
        };

        // LCD 右侧 ▲▼ 两个按键
        const ax = this._bop.x + this._bop.w - W * 0.10;
        this._upBtn = { x: ax, y: this._lcd.y, w: W * 0.09, h: H * 0.068 };
        this._dnBtn = { x: ax, y: this._lcd.y + H * 0.096, w: W * 0.09, h: H * 0.068 };

        // 下排四键：I / O / M / OK
        const bw = W * 0.19, gap = (this._bop.w - bw * 4) / 3;
        const by = this._lcd.y + this._lcd.h + H * 0.031, bh = H * 0.124;
        this._btnI  = { x: this._bop.x + (bw + gap) * 0, y: by, w: bw, h: bh };
        this._btnO  = { x: this._bop.x + (bw + gap) * 1, y: by, w: bw, h: bh };
        this._btnM  = { x: this._bop.x + (bw + gap) * 2, y: by, w: bw, h: bh };
        this._btnOK = { x: this._bop.x + (bw + gap) * 3, y: by, w: bw, h: bh };

        // 铭牌 / 警示区
        const npY = this._bop.y + this._bop.h + H * 0.013;
        this._nameplate = { x: W * 0.04, y: npY, w: W * 0.56, h: H * 0.081 };
        this._warn = { x: W * 0.64, y: npY, w: W * 0.32, h: H * 0.081 };

        // 控制端子排
        this._term = { x: W * 0.03, y: H * 0.683, w: W * 0.94, h: H * 0.27 };

        // 控制端子坐标（两排）
        const row1Y = this._term.y + this._term.h * 0.25;
        const row2Y = this._term.y + this._term.h * 0.63;
        const xs = [0.075, 0.18, 0.285, 0.39, 0.495, 0.60, 0.705, 0.81, 0.915];
        this._ctrlRow1 = [
            { id: 'v10', label: '10V', x: xs[0] },
            { id: 'ai1', label: 'AI1', x: xs[1] },
            { id: 'ai2', label: 'AI2', x: xs[2] },
            { id: 'v0',  label: '0V',  x: xs[3] },
            { id: 'di1', label: 'DI1', x: xs[4] },
            { id: 'di2', label: 'DI2', x: xs[5] },
            { id: 'di3', label: 'DI3', x: xs[6] },
            { id: 'di4', label: 'DI4', x: xs[7] },
            { id: 'dicom', label: 'DIC', x: xs[8] },
        ].map(t => ({ ...t, y: row1Y, ax: W * t.x }));
        this._ctrlRow2 = [
            { id: 'v24',  label: '24V', x: xs[0] },
            { id: 'v0b',  label: '0V',  x: xs[1] },
            { id: 'ao',   label: 'AO',  x: xs[2] },
            { id: 'do1p', label: 'DO1+', x: xs[3] },
            { id: 'do1n', label: 'DO1-', x: xs[4] },
            { id: 'do2c', label: 'DO2C', x: xs[5] },
            { id: 'do2no', label: 'DO2', x: xs[6] },
            { id: 'rsp',  label: 'P+',  x: xs[7] },
            { id: 'rsn',  label: 'N-',  x: xs[8] },
        ].map(t => ({ ...t, y: row2Y, ax: W * t.x }));

        // 功率端子（ax 为水平坐标，供 addPort 使用）
        this._powerIn = [
            { id: 'l1', label: 'L1', x: W * 0.20 },
            { id: 'l2', label: 'L2', x: W * 0.34 },
            { id: 'l3', label: 'L3', x: W * 0.48 },
            { id: 'dcp', label: 'DC+', x: W * 0.70 },
            { id: 'dcn', label: 'DC-', x: W * 0.86 },
        ].map(t => ({ ...t, ax: t.x }));
        this._motorOut = [
            { id: 'u', label: 'U', x: W * 0.20, color: '#e03030' },
            { id: 'v', label: 'V', x: W * 0.40, color: '#20a030' },
            { id: 'w', label: 'W', x: W * 0.60, color: '#2050e0' },
            { id: 'pe', label: 'PE', x: W * 0.84, color: '#7a8a2a' },
        ].map(t => ({ ...t, ax: t.x }));
    }

    // ═══════════════════════════════════════════════════════════════
    // 参数（P/r 参数表）
    // ═══════════════════════════════════════════════════════════════
    _initParameters(config) {
        this.label = config.label || 'V20-1';

        this._pdefs = [
            { n: 'P0003', name: '用户访问级',        unit: '',    min: 1, max: 4, step: 1,    dig: 0, lvl: 1, opts: { 1: '标准', 2: '扩展', 3: '专家', 4: '服务' } },
            { n: 'P0004', name: '参数过滤',          unit: '',    min: 0, max: 22, step: 1,   dig: 0, lvl: 1 },
            { n: 'P0005', name: '显示选择',          unit: '',    min: 0, max: 99, step: 1,   dig: 0, lvl: 1, opts: { 21: '输出频率', 22: '输出转速', 25: '输出电压', 26: '直流母线电压', 27: '输出电流' } },
            { n: 'P0010', name: '调试参数过滤',      unit: '',    min: 0, max: 30, step: 1,   dig: 0, lvl: 1 },
            { n: 'P0100', name: '欧洲/北美',         unit: '',    min: 0, max: 2, step: 1,    dig: 0, lvl: 2, opts: { 0: 'kW/50Hz', 1: 'hp/60Hz', 2: 'kW/60Hz' } },
            { n: 'P0304', name: '电机额定电压',      unit: 'V',   min: 0, max: 2000, step: 1, dig: 0, lvl: 2 },
            { n: 'P0305', name: '电机额定电流',      unit: 'A',   min: 0, max: 1000, step: 0.01, dig: 2, lvl: 2 },
            { n: 'P0307', name: '电机额定功率',      unit: 'kW',  min: 0, max: 1000, step: 0.01, dig: 2, lvl: 2 },
            { n: 'P0310', name: '电机额定频率',      unit: 'Hz',  min: 12, max: 550, step: 0.01, dig: 2, lvl: 2 },
            { n: 'P0311', name: '电机额定转速',      unit: 'rpm', min: 0, max: 40000, step: 1, dig: 0, lvl: 2 },
            { n: 'P0700', name: '命令源',            unit: '',    min: 0, max: 5, step: 1,    dig: 0, lvl: 1, opts: { 1: '操作面板 BOP', 2: '端子', 5: 'USS/Modbus' } },
            { n: 'P0701', name: 'DI1 功能',          unit: '',    min: 0, max: 99, step: 1,   dig: 0, lvl: 1, opts: this._diOpts() },
            { n: 'P0702', name: 'DI2 功能',          unit: '',    min: 0, max: 99, step: 1,   dig: 0, lvl: 2, opts: this._diOpts() },
            { n: 'P0703', name: 'DI3 功能',          unit: '',    min: 0, max: 99, step: 1,   dig: 0, lvl: 2, opts: this._diOpts() },
            { n: 'P0704', name: 'DI4 功能',          unit: '',    min: 0, max: 99, step: 1,   dig: 0, lvl: 2, opts: this._diOpts() },
            { n: 'P0731', name: 'DO1 功能',          unit: '',    min: 0, max: 99, step: 1,   dig: 0, lvl: 2, opts: { 52.2: '变频器运行中', 52.3: '变频器故障', 52.7: '变频器报警' } },
            { n: 'P0732', name: 'DO2 功能',          unit: '',    min: 0, max: 99, step: 1,   dig: 0, lvl: 2, opts: { 52.2: '变频器运行中', 52.3: '变频器故障', 52.7: '变频器报警' } },
            { n: 'P0756', name: 'AI1 类型',          unit: '',    min: 0, max: 4, step: 1,    dig: 0, lvl: 2, opts: { 0: '0-10V', 1: '2-10V', 2: '0-20mA', 3: '4-20mA' } },
            { n: 'P1000', name: '频率设定源',        unit: '',    min: 0, max: 77, step: 1,   dig: 0, lvl: 1, opts: { 0: '无', 1: 'MOP', 2: '模拟量 AI1', 3: '固定频率', 7: '模拟量 AI2' } },
            { n: 'P1001', name: '固定频率 1',        unit: 'Hz',  min: -550, max: 550, step: 0.01, dig: 2, lvl: 2 },
            { n: 'P1002', name: '固定频率 2',        unit: 'Hz',  min: -550, max: 550, step: 0.01, dig: 2, lvl: 2 },
            { n: 'P1003', name: '固定频率 3',        unit: 'Hz',  min: -550, max: 550, step: 0.01, dig: 2, lvl: 2 },
            { n: 'P1004', name: '固定频率 4',        unit: 'Hz',  min: -550, max: 550, step: 0.01, dig: 2, lvl: 2 },
            { n: 'P1040', name: 'MOP 设定值',        unit: 'Hz',  min: 0, max: 550, step: 0.5,  dig: 2, lvl: 2 },
            { n: 'P1080', name: '最小频率',          unit: 'Hz',  min: 0, max: 550, step: 0.01, dig: 2, lvl: 1 },
            { n: 'P1082', name: '最大频率',          unit: 'Hz',  min: 0, max: 550, step: 0.01, dig: 2, lvl: 1 },
            { n: 'P1120', name: '斜坡上升时间',      unit: 's',   min: 0, max: 650, step: 0.1,  dig: 1, lvl: 1 },
            { n: 'P1121', name: '斜坡下降时间',      unit: 's',   min: 0, max: 650, step: 0.1,  dig: 1, lvl: 1 },
            { n: 'P2000', name: '参考频率',          unit: 'Hz',  min: 1, max: 550, step: 0.01, dig: 2, lvl: 2 },
            { n: 'P3900', name: '结束快速调试',      unit: '',    min: 0, max: 3, step: 1,    dig: 0, lvl: 1, opts: { 0: '不结束', 1: '结束并复位', 2: '结束', 3: '结束并复位+计算' } },
        ];

        // 参数值
        this._p = {
            P0003: 1, P0004: 0, P0005: 21, P0010: 0, P0100: 0,
            P0304: 380, P0305: 1.5, P0307: 0.75, P0310: 50, P0311: 1440,
            P0700: 1, P0701: 1, P0702: 12, P0703: 9, P0704: 15,
            P0731: 52.2, P0732: 52.3, P0756: 0,
            P1000: 1, P1001: 10, P1002: 25, P1003: 40, P1004: 50,
            P1040: 0, P1080: 0, P1082: 50, P1120: 10, P1121: 10, P2000: 50, P3900: 0,
        };

        // 构造参数覆盖
        const map = {
            motorVoltage: 'P0304', motorCurrent: 'P0305', motorPower: 'P0307',
            motorFreq: 'P0310', motorSpeed: 'P0311',
            p0700: 'P0700', p1000: 'P1000',
            minFreq: 'P1080', maxFreq: 'P1082',
            rampUp: 'P1120', rampDown: 'P1121', mopSetpoint: 'P1040',
        };
        Object.keys(map).forEach(k => {
            if (config[k] !== undefined) this._p[map[k]] = parseFloat(config[k]);
        });
    }

    _diOpts() {
        return {
            0: '禁用', 1: 'ON/OFF1', 2: 'ON 反转/OFF1', 3: 'OFF2 自由停车',
            4: 'OFF3 快速停车', 9: '故障确认', 12: '反转',
            15: '固定频率位0', 16: '固定频率位1', 17: '固定频率位2', 18: '固定频率位3',
        };
    }

    _initState() {
        this._panelRun   = false;
        this._fOut       = 0;        // 输出频率（有符号，负 = 反转）
        this._fSetAbs    = 0;        // 设定频率绝对值（显示用）
        this._dir        = 1;
        this._running    = false;
        this._outputActive = false;
        this.isOn        = false;    // 供求解器识别输出是否投入
        this._fault      = null;
        this._alarm      = null;
        this._uvCount    = 0;

        this._di         = [false, false, false, false];
        this._prevDi     = [false, false, false, false];
        this._ai1        = 0;
        this._ai2        = 0;
        this._inputWired = false;
        this._inputPresent = true;
        this._inputPeak  = 0;
        this._vdc        = 540;
        this._motorCur   = 0;
        this._motorTemp  = 30;
        this._do1On      = false;
        this._do2On      = false;

        this._ui = { mode: 'status', sel: 'P0304', editVal: 0, t: 0 };
        this._blinkOn = true;
    }

    _init() {
        this._drawStaticParts();
        this._createDynamicNodes();
        this._bindInteraction();
    }

    // ═══════════════════════════════════════════════════════════════
    // 端口
    // ═══════════════════════════════════════════════════════════════
    _registerPorts() {
        const H = this.height;
        // 主电源进线（顶边）
        this._powerIn.forEach(t => this.addPort(t.ax, 0, t.id, 'wire'));
        // 电机输出（底边）
        this._motorOut.forEach(t => this.addPort(t.ax, H, t.id, 'wire', t.id === 'pe' ? null : 'p'));
        // 控制端子
        this._ctrlRow1.forEach(t => this.addPort(t.ax, t.y, t.id, 'wire'));
        this._ctrlRow2.forEach(t => this.addPort(t.ax, t.y, t.id, 'wire'));
        // 内部中性点（隐藏，仅供三相输出 stamp 参考）
        this.addPort(this.width * 0.5, H, 'n', 'wire');
        const neu = this.ports[this.ports.length - 1];
        if (neu && neu.node) neu.node.visible(false);
    }

    // ═══════════════════════════════════════════════════════════════
    // 静态绘制
    // ═══════════════════════════════════════════════════════════════
    _drawStaticParts() {
        this._drawBody();
        this._drawBrandBar();
        this._drawBop();
        this._drawNameplate();
        this._drawWarning();
        this._drawTerminalStrip();
        this._drawPowerTerminals();
    }

    _drawBody() {
        const W = this.width, H = this.height;
        this._staticGroup.add(new Konva.Rect({
            x: 0, y: 0, width: W, height: H, cornerRadius: 5,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint: { x: W, y: 0 },
            fillLinearGradientColorStops: [0, '#3c434a', 0.5, '#4a525a', 1, '#343b42'],
            stroke: '#22282e', strokeWidth: 1.4, listening: false,
        }));
    }

    _drawBrandBar() {
        const b = this._brand, W = this.width;
        // 品牌条
        this._staticGroup.add(new Konva.Rect({
            x: b.x, y: b.y, width: b.w, height: b.h,
            fill: '#2b3137', listening: false,
        }));
        // SIEMENS 青绿标识
        this._staticGroup.add(new Konva.Rect({
            x: W * 0.04, y: b.y + b.h * 0.14, width: W * 0.30, height: b.h * 0.72,
            fill: '#009999', cornerRadius: 2, listening: false,
        }));
        this._staticGroup.add(new Konva.Text({
            x: W * 0.04, y: b.y + b.h * 0.24, width: W * 0.30,
            text: 'SIEMENS', fontSize: Math.max(9, W * 0.05), fontStyle: 'bold',
            fontFamily: 'Arial, sans-serif', fill: '#ffffff', align: 'center', listening: false,
        }));
        this._staticGroup.add(new Konva.Text({
            x: W * 0.37, y: b.y + b.h * 0.18, text: 'SINAMICS V20',
            fontSize: Math.max(11, W * 0.062), fontStyle: 'bold',
            fontFamily: 'Arial, sans-serif', fill: '#e8ecef', listening: false,
        }));
    }

    _drawBop() {
        const b = this._bop, l = this._lcd, W = this.width;

        // 前面板外框
        this._staticGroup.add(new Konva.Rect({
            x: b.x, y: b.y, width: b.w, height: b.h, cornerRadius: 4,
            fill: '#23282d', stroke: '#12161a', strokeWidth: 1.2, listening: false,
        }));
        // LCD 背景
        this._staticGroup.add(new Konva.Rect({
            x: l.x, y: l.y, width: l.w, height: l.h, cornerRadius: 2,
            fill: '#0c2410', stroke: '#0a1a0a', strokeWidth: 1, listening: false,
        }));
        // LCD 内屏
        this._staticGroup.add(new Konva.Rect({
            x: l.x + 3, y: l.y + 3, width: l.w - 6, height: l.h - 6,
            fill: '#0f2e14', listening: false,
        }));

        // ▲▼ 按键底座
        [this._upBtn, this._dnBtn].forEach(bb => {
            this._staticGroup.add(new Konva.Rect({
                x: bb.x, y: bb.y, width: bb.w, height: bb.h, cornerRadius: 3,
                fill: '#c3c8ce', stroke: '#8b9096', strokeWidth: 1, listening: false,
            }));
        });
        this._staticGroup.add(new Konva.Text({
            x: this._upBtn.x, y: this._upBtn.y + this._upBtn.h * 0.12, width: this._upBtn.w,
            text: '▲', fontSize: Math.max(12, W * 0.058), fill: '#33393f', align: 'center', listening: false,
        }));
        this._staticGroup.add(new Konva.Text({
            x: this._dnBtn.x, y: this._dnBtn.y + this._dnBtn.h * 0.12, width: this._dnBtn.w,
            text: '▼', fontSize: Math.max(12, W * 0.058), fill: '#33393f', align: 'center', listening: false,
        }));

        // I 键（绿）
        this._drawKey(this._btnI, '#1f9d55', '#0f6b37', 'I', '#ffffff');
        // O 键（红）
        this._drawKey(this._btnO, '#d84438', '#932a22', 'O', '#ffffff');
        // M 键
        this._drawKey(this._btnM, '#c3c8ce', '#8b9096', 'M', '#33393f');
        // OK 键
        this._drawKey(this._btnOK, '#c3c8ce', '#8b9096', 'OK', '#33393f');

        // 面板下方说明文字
        this._staticGroup.add(new Konva.Text({
            x: b.x + 4, y: b.y + b.h - Math.max(12, this.height * 0.032),
            text: 'BOP 基本操作面板', fontSize: Math.max(8, W * 0.032),
            fontFamily: 'Arial, sans-serif', fill: '#8a929a', listening: false,
        }));
    }

    _drawKey(r, fill, stroke, label, txtColor) {
        const W = this.width;
        this._staticGroup.add(new Konva.Rect({
            x: r.x, y: r.y, width: r.w, height: r.h, cornerRadius: 4,
            fillLinearGradientStartPoint: { x: 0, y: r.y },
            fillLinearGradientEndPoint: { x: 0, y: r.y + r.h },
            fillLinearGradientColorStops: [0, fill, 1, stroke],
            stroke: '#1c2126', strokeWidth: 1, listening: false,
        }));
        this._staticGroup.add(new Konva.Text({
            x: r.x, y: r.y + r.h * 0.24, width: r.w, text: label,
            fontSize: Math.max(16, W * 0.085), fontStyle: 'bold',
            fontFamily: 'Arial, sans-serif', fill: txtColor, align: 'center', listening: false,
        }));
    }

    _drawNameplate() {
        const n = this._nameplate, W = this.width;
        this._staticGroup.add(new Konva.Rect({
            x: n.x, y: n.y, width: n.w, height: n.h, cornerRadius: 2,
            fill: '#e9e6dc', stroke: '#9aa0a6', strokeWidth: 0.8, listening: false,
        }));
        this._staticGroup.add(new Konva.Text({
            x: n.x + 4, y: n.y + 3, width: n.w - 8,
            text: `SINAMICS V20  ${this._p.P0307}kW`,
            fontSize: Math.max(9, W * 0.036), fontStyle: 'bold',
            fontFamily: 'Arial, sans-serif', fill: '#1a1a1a', listening: false,
        }));
        this._staticGroup.add(new Konva.Text({
            x: n.x + 4, y: n.y + n.h * 0.50, width: n.w - 8,
            text: '6SL3210-5BE21-1UV0  3AC 380-480V',
            fontSize: Math.max(7, W * 0.028), fontFamily: 'Arial, sans-serif', fill: '#333', listening: false,
        }));
    }

    _drawWarning() {
        const w = this._warn, W = this.width;
        this._staticGroup.add(new Konva.Rect({
            x: w.x, y: w.y, width: w.w, height: w.h, cornerRadius: 2,
            fill: '#c9a227', stroke: '#8f7318', strokeWidth: 0.8, listening: false,
        }));
        this._staticGroup.add(new Konva.Text({
            x: w.x + 2, y: w.y + 1, text: '⚠',
            fontSize: Math.max(10, W * 0.045), fill: '#2b2b2b', align: 'center',
            width: Math.max(10, W * 0.045) * 2, listening: false,
        }));
        this._staticGroup.add(new Konva.Text({
            x: w.x + 4, y: w.y + w.h * 0.40, width: w.w - 8,
            text: '危险\n断电 5 分钟后\n方可开盖',
            fontSize: Math.max(6, W * 0.024), lineHeight: 1.1,
            fill: '#2b2b2b', align: 'center', listening: false,
        }));
    }

    _drawTerminalStrip() {
        const t = this._term, W = this.width;
        // 端子排底板
        this._staticGroup.add(new Konva.Rect({
            x: t.x, y: t.y, width: t.w, height: t.h, cornerRadius: 3,
            fill: '#1b2024', stroke: '#0e1216', strokeWidth: 1, listening: false,
        }));
        // 端子排标题
        this._staticGroup.add(new Konva.Text({
            x: t.x + 5, y: t.y + 3, text: '控制端子',
            fontSize: Math.max(8, W * 0.03), fontStyle: 'bold',
            fill: '#9aa2aa', listening: false,
        }));
        // 控制端子（10px 方块 + 放大标签）
        [...this._ctrlRow1, ...this._ctrlRow2].forEach(tm => {
            this._staticGroup.add(new Konva.Rect({
                x: tm.ax - 5, y: tm.y - 5, width: 10, height: 10, cornerRadius: 1,
                fill: '#8a929a', stroke: '#5a6168', strokeWidth: 0.6, listening: false,
            }));
            this._staticGroup.add(new Konva.Text({
                x: tm.ax - 17, y: tm.y + 7, width: 34,
                text: tm.label, fontSize: Math.max(8, W * 0.03), fontStyle: 'bold',
                fontFamily: 'Arial, sans-serif', fill: '#dbe2e8', align: 'center', listening: false,
            }));
        });
    }

    _drawPowerTerminals() {
        const W = this.width, H = this.height;
        // 顶部进线端子
        this._powerIn.forEach(t => {
            this._staticGroup.add(new Konva.Rect({
                x: t.x - 7, y: 4, width: 14, height: 12, cornerRadius: 1.5,
                fill: '#9aa1a8', stroke: '#565c62', strokeWidth: 0.6, listening: false,
            }));
            this._staticGroup.add(new Konva.Text({
                x: t.x - 18, y: 19, width: 36, text: t.label,
                fontSize: Math.max(9, W * 0.032), fontStyle: 'bold',
                fontFamily: 'Arial, sans-serif', fill: '#eef3f7', align: 'center', listening: false,
            }));
        });
        // 底部电机端子
        this._motorOut.forEach(t => {
            this._staticGroup.add(new Konva.Rect({
                x: t.x - 7, y: H - 16, width: 14, height: 12, cornerRadius: 1.5,
                fill: '#9aa1a8', stroke: '#565c62', strokeWidth: 0.6, listening: false,
            }));
            this._staticGroup.add(new Konva.Text({
                x: t.x - 18, y: H - 33, width: 36, text: t.label,
                fontSize: Math.max(9, W * 0.032), fontStyle: 'bold',
                fontFamily: 'Arial, sans-serif', fill: t.color, align: 'center', listening: false,
            }));
        });
    }

    // ═══════════════════════════════════════════════════════════════
    // 动态节点
    // ═══════════════════════════════════════════════════════════════
    _createDynamicNodes() {
        const d = this._dynamicGroup, l = this._lcd, W = this.width;

        this._lcdMain = new Konva.Text({
            x: l.x + 6, y: l.y + 4, width: l.w - 12, height: l.h * 0.60,
            text: '', fontSize: Math.max(22, W * 0.125), fontStyle: 'bold',
            fontFamily: 'Consolas, monospace', fill: '#8ef08e',
            align: 'right', verticalAlign: 'middle', listening: false,
        });
        this._lcdSub = new Konva.Text({
            x: l.x + 6, y: l.y + l.h * 0.64, width: l.w - 12, height: l.h * 0.34,
            text: '', fontSize: Math.max(9, W * 0.042),
            fontFamily: 'Arial, sans-serif', fill: '#8ef08e',
            align: 'left', listening: false,
        });
        this._lcdUnit = new Konva.Text({
            x: l.x + 6, y: l.y + l.h * 0.64, width: l.w - 12, height: l.h * 0.34,
            text: '', fontSize: Math.max(11, W * 0.052), fontStyle: 'bold',
            fontFamily: 'Arial, sans-serif', fill: '#8ef08e',
            align: 'right', listening: false,
        });
        d.add(this._lcdMain, this._lcdSub, this._lcdUnit);

        // 运行指示（LCD 右上角）
        this._runLed = new Konva.Circle({
            x: l.x + l.w - 9, y: l.y + 10, radius: Math.max(4, W * 0.018),
            fill: '#1c3a1c', listening: false,
        });
        d.add(this._runLed);

        // 方向指示（LCD 左上角）
        this._dirText = new Konva.Text({
            x: l.x + 6, y: l.y + 5, text: 'FWD',
            fontSize: Math.max(9, W * 0.034), fontStyle: 'bold',
            fontFamily: 'Arial, sans-serif', fill: '#2b5a2b', listening: false,
        });
        d.add(this._dirText);
    }

    // ═══════════════════════════════════════════════════════════════
    // 交互
    // ═══════════════════════════════════════════════════════════════
    _bindInteraction() {
        const addBtn = (partId, r, key) => {
            const hit = this.addClickablePart(partId, r.x, r.y, r.w, r.h);
            if (hit) hit.on('click tap', () => this._bopPress(key));
        };
        addBtn('lcd', this._lcd, 'ok');
        addBtn('btn-i', this._btnI, 'i');
        addBtn('btn-o', this._btnO, 'o');
        addBtn('btn-m', this._btnM, 'm');
        addBtn('btn-ok', this._btnOK, 'ok');
        addBtn('btn-up', this._upBtn, 'up');
        addBtn('btn-dn', this._dnBtn, 'dn');
    }

    getClickablePartCenter(partId) {
        const rel = {
            lcd: this._lcd, 'btn-i': this._btnI, 'btn-o': this._btnO,
            'btn-m': this._btnM, 'btn-ok': this._btnOK,
            'btn-up': this._upBtn, 'btn-dn': this._dnBtn,
        }[partId];
        if (!rel) return super.getClickablePartCenter ? super.getClickablePartCenter(partId) : null;
        const g = this.group.getAbsolutePosition();
        return { x: g.x + rel.x + rel.w / 2, y: g.y + rel.y + rel.h / 2 };
    }

    // ═══════════════════════════════════════════════════════════════
    // BOP 面板逻辑
    // ═══════════════════════════════════════════════════════════════
    _bopPress(key) {
        const p = this._p;

        // 故障确认：存在故障时，OK / 红键 优先用于复位故障（任何菜单状态下均有效）
        if (this._fault && (key === 'ok' || key === 'o')) {
            this.acknowledgeFault();
            return;
        }

        // 菜单模式下的按键
        if (this._ui.mode !== 'status') {
            switch (key) {
                case 'up':   this._navUp();   break;
                case 'dn':   this._navDown(); break;
                case 'ok':   this._navOK();   break;
                case 'm':    this._navM();    break;
                case 'o':    this._navM();    break;   // 红键退出菜单
                default: break;
            }
            return;
        }

        // 状态屏
        switch (key) {
            case 'i':
                if (p.P0700 === 1) { this._panelRun = true; this._tip('BOP 启动命令'); }
                else this._tip('命令源为端子（P0700=2），面板启动无效');
                break;
            case 'o':
                this._panelRun = false;
                if (this._fault) this.acknowledgeFault();
                break;
            case 'm':
                this._ui.mode = 'list';
                this._ui.sel = this._visibleParams()[0].n;
                break;
            case 'ok':
                if (this._fault) this.acknowledgeFault();
                else { this._ui.mode = 'list'; this._ui.sel = this._visibleParams()[0].n; }
                break;
            case 'up':
            case 'dn':
                if (p.P1000 === 1) {
                    const d = (key === 'up' ? 1 : -1) * this._pdef('P1040').step;
                    this.setParam('P1040', this._p.P1040 + d);
                } else if (p.P1000 === 2 || p.P1000 === 7) {
                    this._tip('频率由模拟量给定，无法用面板修改');
                } else {
                    this._tip('当前设定源不支持面板调速（P1000=' + p.P1000 + '）');
                }
                break;
        }
    }

    _navM() {
        const m = this._ui.mode;
        if (m === 'list') this._ui.mode = 'status';
        else if (m === 'value') this._ui.mode = 'list';
        else if (m === 'edit') { this._ui.mode = 'value'; }
    }

    _navOK() {
        const m = this._ui.mode;
        if (m === 'list') this._ui.mode = 'value';
        else if (m === 'value') { this._ui.mode = 'edit'; this._ui.editVal = this._p[this._ui.sel]; }
        else if (m === 'edit') { this.setParam(this._ui.sel, this._ui.editVal); this._ui.mode = 'value'; }
    }

    _moveSel(delta) {
        const list = this._visibleParams();
        let i = list.findIndex(d => d.n === this._ui.sel);
        if (i < 0) i = 0;
        i = (i + delta + list.length) % list.length;
        this._ui.sel = list[i].n;
    }

    _navUp() {
        if (this._ui.mode === 'edit') { this._ui.editVal = this._clampVal(this._ui.sel, this._ui.editVal + this._pdef(this._ui.sel).step); }
        else this._moveSel(-1);
    }

    _navDown() {
        if (this._ui.mode === 'edit') { this._ui.editVal = this._clampVal(this._ui.sel, this._ui.editVal - this._pdef(this._ui.sel).step); }
        else this._moveSel(1);
    }

    _pdef(num) { return this._pdefs.find(d => d.n === num) || this._pdefs[0]; }

    _visibleParams() {
        const lvl = this._p.P0003 || 1;
        return this._pdefs.filter(d => d.lvl <= lvl);
    }

    _clampVal(num, v) {
        const d = this._pdef(num);
        v = Math.max(d.min, Math.min(d.max, v));
        const f = Math.pow(10, d.dig);
        return Math.round(v * f) / f;
    }

    /** 写入参数并处理关联 */
    setParam(num, val) {
        const d = this._pdef(num);
        val = this._clampVal(num, parseFloat(val));
        const old = this._p[num];
        this._p[num] = val;

        if (num === 'P1080' && this._p.P1082 < val) this._p.P1082 = val;
        if (num === 'P1082' && this._p.P1080 > val) this._p.P1080 = val;

        // P3900 结束快速调试：回到工厂默认（此处仅提示）
        if (num === 'P3900' && val !== 0) this._tip('快速调试结束');
        if (num === 'P0700' && old !== val) {
            this._panelRun = false;
            this._tip(val === 1 ? '命令源：操作面板 BOP' : '命令源：端子');
        }
        if (num === 'P1000') this._tip('频率设定源已切换');
        return this._p[num];
    }

    getParam(num) { return this._p[num] !== undefined ? this._p[num] : null; }

    /** 是否 HAND（面板）控制方式 */
    handMode() { return this._p.P0700 === 1; }

    /** 手动/自动切换：HAND = 面板 + MOP，AUTO = 端子 + 模拟量（对应典型宏 Cn001/Cn002） */
    toggleHandAuto() {
        if (this._p.P0700 === 1) {
            this._p.P0700 = 2; this._p.P1000 = 2;
            this._tip('已切到 AUTO：端子远程启停 + 模拟量调速');
        } else {
            this._p.P0700 = 1; this._p.P1000 = 1;
            this._tip('已切到 HAND：面板启停 + MOP 调速');
        }
    }

    getContextMenuItems() {
        return [{
            label: this.handMode() ? '切换到 自动 AUTO（端子控制）' : '切换到 手动 HAND（面板控制）',
            onClick: () => this.toggleHandAuto(),
        }];
    }

    _valueName(def, v) {
        if (!def || !def.opts) return '';
        const k = Object.keys(def.opts).find(k => Math.abs(parseFloat(k) - v) < 1e-6);
        return k !== undefined ? def.opts[k] : '';
    }

    // ═══════════════════════════════════════════════════════════════
    // 电气量读取
    // ═══════════════════════════════════════════════════════════════
    _readInputs() {
        const s = this.sys && this.sys.voltageSolver;
        const getV = (pid) => {
            if (!s || !s.portToCluster) return null;
            const c = s.portToCluster.get(`${this.id}_wire_${pid}`);
            return c === undefined ? null : (s.nodeVoltages.get(c) || 0);
        };
        const same = (a, b) => {
            if (!s || !s.portToCluster) return false;
            const ca = s.portToCluster.get(`${this.id}_wire_${a}`);
            const cb = s.portToCluster.get(`${this.id}_wire_${b}`);
            return ca !== undefined && cb !== undefined && ca === cb;
        };

        const vdic = getV('dicom'), v0 = getV('v0'), v0b = getV('v0b');
        const ref = vdic !== null ? vdic : (v0 !== null ? v0 : (v0b !== null ? v0b : 0));

        // 数字量输入（PNP：相对 DIC/0V 高于阈值有效；或直连内部 24V）
        for (let i = 1; i <= 4; i++) {
            const vd = getV('di' + i);
            let on = false;
            if (vd !== null && Math.abs(vd - ref) > 12) on = true;
            else if (same('di' + i, 'v24')) on = true;
            this._di[i - 1] = on;
        }

        // 模拟量输入
        const va1 = getV('ai1'), va2 = getV('ai2');
        this._ai1 = va1 !== null ? (va1 - ref) : 0;
        this._ai2 = va2 !== null ? (va2 - ref) : 0;

        // 进线检测
        const vl1 = getV('l1'), vl2 = getV('l2'), vl3 = getV('l3');
        this._inputWired = (vl1 !== null || vl2 !== null || vl3 !== null);
        if (!this._inputWired) {
            this._inputPresent = true;
            this._inputPeak = 0;
            this._vdc = 540;
        } else {
            const a = vl1 || 0, b = vl2 || 0, c = vl3 || 0;
            const pk = Math.max(Math.abs(a - b), Math.abs(b - c), Math.abs(c - a));
            this._inputPeak = Math.max(pk, this._inputPeak * 0.9);
            this._inputPresent = this._inputPeak > 120;
            this._vdc = Math.max(0, 1.35 * (this._inputPeak / Math.SQRT2));
        }
    }

    _aiToFreq(v, which) {
        let frac;
        if (which === 'ai1') {
            const type = this._p.P0756;
            const vlo = (type === 1) ? 2 : 0;
            frac = (v - vlo) / (10 - vlo);
        } else {
            frac = v / 10;
        }
        frac = Math.max(0, Math.min(1, frac));
        return frac * this._p.P2000;
    }

    // ═══════════════════════════════════════════════════════════════
    // 控制逻辑
    // ═══════════════════════════════════════════════════════════════
    _updateControl(dt) {
        const p = this._p;

        // ── 命令与设定 ─────────────────────────────────────────────
        let cmdRun = false, cmdRev = false, cmdStop = false, cmdAck = false;
        if (p.P0700 === 1) {
            cmdRun = this._panelRun;
        } else if (p.P0700 === 2) {
            const fn = [p.P0701, p.P0702, p.P0703, p.P0704];
            for (let i = 0; i < 4; i++) {
                if (!this._di[i]) continue;
                switch (fn[i]) {
                    case 1:  cmdRun = true; break;
                    case 2:  cmdRun = true; cmdRev = true; break;
                    case 3:  cmdStop = true; break;   // OFF2
                    case 4:  cmdStop = true; break;   // OFF3
                    case 9:  cmdAck = true; break;
                    case 12: cmdRev = true; break;
                    default: break;
                }
            }
        }
        if (cmdAck) this.acknowledgeFault();
        if (cmdStop) cmdRun = false;

        // 设定频率
        let fset = 0;
        switch (p.P1000) {
            case 0: fset = 0; break;
            case 1: fset = p.P1040; break;
            case 2: fset = this._aiToFreq(this._ai1, 'ai1'); break;
            case 7: fset = this._aiToFreq(this._ai2, 'ai2'); break;
            case 3: {
                const fn = [p.P0701, p.P0702, p.P0703, p.P0704];
                for (let i = 0; i < 4; i++) {
                    if (!this._di[i]) continue;
                    if (fn[i] >= 15 && fn[i] <= 18) fset += p['P100' + (fn[i] - 14)];
                }
                break;
            }
            default: fset = 0;
        }

        // 限幅
        const fmax = Math.max(p.P1080, p.P1082);
        let mag = Math.min(Math.abs(fset), fmax);
        if (mag > 0) mag = Math.max(mag, Math.min(p.P1080, fmax));
        const target = cmdRun ? (cmdRev ? -mag : mag) : 0;

        // ── 故障与斜坡 ─────────────────────────────────────────────
        // 进线欠电压：需持续约 1.5s 才报 F0003，避免瞬时过零误报；
        // 电源恢复后计数清零，故障可由 OK/红键复位。
        if (this._inputWired && !this._inputPresent && Math.abs(this._fOut) > 0.1) this._uvCount++;
        else this._uvCount = 0;
        if (this._uvCount > 30) this._triggerFault('F0003', '欠电压');

        const rampT = (Math.abs(target) >= Math.abs(this._fOut)) ? p.P1120 : p.P1121;
        const rate = Math.max(p.P1082, 1) / Math.max(rampT, 0.05);
        const step = rate * dt;
        if (Math.abs(this._fOut - target) < step) this._fOut = target;
        else this._fOut += Math.sign(target - this._fOut) * step;
        if (Math.abs(this._fOut) < 0.02) this._fOut = 0;

        this._fSetAbs = mag;
        this._dir = this._fOut < 0 ? -1 : 1;
        this._outputActive = !this._fault && Math.abs(this._fOut) > 0.05;
        this._running = this._outputActive;
        this.isOn = this._outputActive;

        // ── 电机侧估算 ─────────────────────────────────────────────
        if (this._outputActive) {
            const load = 0.55 + 0.25 * Math.abs(Math.sin(this._ui.t * 0.7));
            this._motorCur = p.P0305 * load * Math.min(1, Math.abs(this._fOut) / Math.max(p.P0310, 1));
            this._motorTemp = Math.min(120, this._motorTemp + 0.05 * dt * 20);
        } else {
            this._motorCur = 0;
            this._motorTemp = Math.max(30, this._motorTemp - 0.05 * dt * 10);
        }

        // ── 数字量输出 ─────────────────────────────────────────────
        this._do1On = this._outputActive;   // P0731 默认 52.2 变频器运行中
        this._do2On = !!this._fault;        // P0732 默认 52.3 变频器故障
    }

    _triggerFault(code, name) {
        if (this._fault) return;
        this._fault = { code, name };
        this._tip('变频器故障 ' + code);
    }

    acknowledgeFault() {
        if (!this._fault) return;
        const stillFault = this._inputWired && !this._inputPresent;
        this._fault = null;
        if (stillFault) this._tip('进线电源仍中断，故障将再次出现');
        else this._tip('故障已复位');
    }

    // ═══════════════════════════════════════════════════════════════
    // 三相输出（供 DeviceStamps 调用）
    // ═══════════════════════════════════════════════════════════════
    getPhaseVoltage(phase, time) {
        if (!this._outputActive) return 0;
        const f = Math.abs(this._fOut);
        if (f <= 0.001) return 0;
        const vLine = this._p.P0304 * Math.min(1, f / Math.max(1, this._p.P0310));
        const peak = (vLine / Math.sqrt(3)) * Math.SQRT2;
        const omega = 2 * Math.PI * f;
        let off = 0;
        if (phase === 'v') off = this._dir >= 0 ? -4 * Math.PI / 3 : -2 * Math.PI / 3;
        else if (phase === 'w') off = this._dir >= 0 ? -2 * Math.PI / 3 : -4 * Math.PI / 3;
        return peak * Math.sin(omega * time + off);
    }

    get rOn() { return 0.05; }

    // ═══════════════════════════════════════════════════════════════
    // 显示刷新
    // ═══════════════════════════════════════════════════════════════
    _updateDisplay() {
        const p = this._p;
        const on = this._blinkOn;

        // 运行/方向指示
        this._runLed.fill(this._fault ? '#e04030' : (this._outputActive ? '#26d24e' : '#1c3a1c'));
        this._dirText.text(this._fault ? 'FLT' : (!this._outputActive ? 'STOP' : (this._dir < 0 ? 'REV' : 'FWD')));
        this._dirText.fill(this._fault ? '#e07060' : (this._outputActive ? '#5fe07a' : '#2b5a2b'));

        let main = '', sub = '', unit = '', color = '#8ef08e';

        if (this._fault) {
            main = on ? this._fault.code : '';
            sub = this._fault.name + '  (OK 复位)';
            color = '#ff6a58';
        } else if (this._ui.mode === 'status') {
            const showActual = this._outputActive;
            const val = showActual ? Math.abs(this._fOut) : this._fSetAbs;
            main = (on || showActual) ? val.toFixed(2) : '';
            unit = 'Hz';
            const mode = this.handMode() ? 'HAND' : 'AUTO';
            if (showActual) sub = mode + (this._dir < 0 ? ' 反转运行' : ' 正转运行');
            else sub = mode + (p.P1000 === 0 ? ' 无设定' : ' 设定值');
        } else if (this._ui.mode === 'list') {
            const d = this._pdef(this._ui.sel);
            main = d.n;
            sub = d.name;
            color = '#d8f0a0';
        } else if (this._ui.mode === 'value') {
            const d = this._pdef(this._ui.sel);
            main = this._fmtVal(d, this._p[this._ui.sel]);
            unit = d.unit;
            const vn = this._valueName(d, this._p[this._ui.sel]);
            sub = vn || d.name;
            color = '#d8f0a0';
        } else if (this._ui.mode === 'edit') {
            const d = this._pdef(this._ui.sel);
            main = on ? this._fmtVal(d, this._ui.editVal) : '';
            unit = d.unit;
            sub = '编辑 ' + d.n;
            color = '#ffe08a';
        }

        this._lcdMain.text(main);
        this._lcdMain.fill(color);
        this._lcdSub.text(sub);
        this._lcdSub.fill(color);
        this._lcdUnit.text(unit);
        this._lcdUnit.fill(color);
    }

    _fmtVal(def, v) {
        const f = Math.pow(10, def.dig);
        return (Math.round(v * f) / f).toFixed(def.dig);
    }

    // ═══════════════════════════════════════════════════════════════
    // 主循环
    // ═══════════════════════════════════════════════════════════════
    tick(dt) {
        this._readInputs();
        this._updateControl(dt);

        this._ui.t += dt;
        this._blinkOn = (Math.floor(this._ui.t * 1.5) % 2) === 0;

        this._updateDisplay();
        // 端子 DO1/DO2 状态由拓扑层读取，标记脏以便重绘
        if (this.sys && typeof this.sys.requestRedraw === 'function') this.sys.requestRedraw();
    }

    _tip(msg) {
        if (this.sys && typeof this.sys.showFloatingTip === 'function') {
            this.sys.showFloatingTip(`V20: ${msg}`, 2000);
        }
    }

    // ═══════════════════════════════════════════════════════════════
    // 配置对话框
    // ═══════════════════════════════════════════════════════════════
    getConfigFields() {
        const g = (num) => (comp) => comp._p[num];
        return [
            { label: '位号/名称', key: 'label', type: 'text', get: c => c.label },
            { label: '控制方式', key: 'ctrlMode', type: 'select',
              get: c => (c.handMode() ? 'hand' : 'auto'),
              options: [
                { label: '手动 HAND（面板启停/MOP调速）', value: 'hand' },
                { label: '自动 AUTO（端子启停/模拟量调速）', value: 'auto' },
              ] },
            { label: '电机额定电压 P0304 (V)', key: 'p0304', type: 'number', get: g('P0304') },
            { label: '电机额定电流 P0305 (A)', key: 'p0305', type: 'number', get: g('P0305') },
            { label: '电机额定功率 P0307 (kW)', key: 'p0307', type: 'number', get: g('P0307') },
            { label: '电机额定频率 P0310 (Hz)', key: 'p0310', type: 'number', get: g('P0310') },
            { label: '电机额定转速 P0311 (rpm)', key: 'p0311', type: 'number', get: g('P0311') },
            { label: '最小频率 P1080 (Hz)', key: 'p1080', type: 'number', get: g('P1080') },
            { label: '最大频率 P1082 (Hz)', key: 'p1082', type: 'number', get: g('P1082') },
            { label: '斜坡上升时间 P1120 (s)', key: 'p1120', type: 'number', get: g('P1120') },
            { label: '斜坡下降时间 P1121 (s)', key: 'p1121', type: 'number', get: g('P1121') },
            { label: 'MOP 设定值 P1040 (Hz)', key: 'p1040', type: 'number', get: g('P1040') },
        ];
    }

    onConfigUpdate(cfg) {
        if (cfg.label !== undefined) this.label = cfg.label;
        if (cfg.ctrlMode !== undefined) {
            const wantHand = cfg.ctrlMode === 'hand';
            if (wantHand !== this.handMode()) this.toggleHandAuto();
        }
        ['p0700', 'p1000', 'p0304', 'p0305', 'p0307', 'p0310', 'p0311',
         'p1080', 'p1082', 'p1120', 'p1121', 'p1040'].forEach(k => {
            if (cfg[k] !== undefined) this.setParam('P' + k.slice(1), cfg[k]);
        });

        this.config = { ...this.config, ...cfg };
        this._statusGroup = null;
        // 重绘静态内容（铭牌功率等）
        this._staticGroup.destroyChildren();
        this._drawStaticParts();
        this._forceCacheFlush();
    }

    // ═══════════════════════════════════════════════════════════════
    // 公开 API
    // ═══════════════════════════════════════════════════════════════
    start() { this._panelRun = true; }
    stop()  { this._panelRun = false; }
    setFrequency(hz) { this.setParam('P1040', hz); }
    getOutputFrequency() { return Math.abs(this._fOut); }
    getActualFrequency() { return Math.abs(this._fOut); }
    getSetpointFrequency() { return this._fSetAbs; }
    getOutputVoltage() {
        const f = Math.abs(this._fOut);
        return this._p.P0304 * Math.min(1, f / Math.max(1, this._p.P0310));
    }
    getOutputCurrent() { return this._motorCur; }
    getDCBusVoltage() { return this._vdc; }
    getMotorTemp() { return this._motorTemp; }
    getAnalogOutput() { return Math.min(20, (Math.abs(this._fOut) / Math.max(1, this._p.P2000)) * 20); }
    isRunning() { return this._outputActive; }
    getDirection() { return this._dir; }
    getFault() { return this._fault ? { ...this._fault } : null; }
    getDigitalInputs() { return [...this._di]; }
    getAnalogInput() { return this._ai1; }

    getDriveSnapshot() {
        return {
            state: this._outputActive ? (this._fault ? 'fault' : 'run') : 'ready',
            fOut: Math.abs(this._fOut),
            fSet: this._fSetAbs,
            dir: this._dir,
            vdc: this._vdc,
            current: this._motorCur,
            temp: this._motorTemp,
            fault: this._fault ? this._fault.code : '',
        };
    }
}
