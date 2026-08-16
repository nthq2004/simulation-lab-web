import { BaseComponent } from './BaseComponent.js';

/**
 * 电子振动仪（Electronic Vibration Meter）仿真组件
 *
 * ── 原型参考 ──────────────────────────────────────────────────
 *
 *  以 SKF CMAS 100-SL / Fluke 805 / 威科 VM-63A 为典型代表的
 *  手持式工业电子振动仪，是目前市占率最高的便携振动测量仪器类型。
 *
 * ── 测量参数 ──────────────────────────────────────────────────
 *
 *  三参数同步显示（LCD 三行读数）：
 *
 *  1. 振动位移峰峰值  D_pp（Displacement Peak-to-Peak）
 *     单位：μm（微米）或 mm
 *     测量：低频段（10 Hz ~ 1 kHz）
 *     意义：反映机械部件的实际运动幅度，对低速大型机组最重要
 *     公式：D_pp = 2·A（正弦振动时），A 为振幅
 *
 *  2. 振动速度有效值  V_rms（Velocity RMS）
 *     单位：mm/s
 *     测量：中频段（10 Hz ~ 1 kHz）
 *     意义：与机械振动烈度（ISO 10816）直接对应，最通用参数
 *     公式：V_rms = (2π·f·A) / √2 = π·f·A·√2
 *            其中 A = 单峰振幅（mm），f = 频率（Hz）
 *     ISO 10816 标准等级：
 *       ≤ 0.71 mm/s  : Zone A（新机器）
 *       ≤ 1.80 mm/s  : Zone B（可接受）
 *       ≤ 4.50 mm/s  : Zone C（报警）
 *       >  4.50 mm/s : Zone D（危险）
 *
 *  3. 振动加速度峰值  A_peak（Acceleration Peak）
 *     单位：m/s²（或 g，1g = 9.81 m/s²）
 *     测量：高频段（10 Hz ~ 10 kHz）
 *     意义：反映冲击力大小，对轴承、齿轮故障诊断最敏感
 *     公式：A_peak = (2π·f)²·A × 10⁻³  [m/s²]
 *            其中 A = 单峰振幅（μm），f = 频率（Hz）
 *
 * ── 信号处理链 ────────────────────────────────────────────────
 *
 *  压电加速度传感器（内置）
 *      ↓  电荷放大器
 *      ↓  抗混叠低通滤波器
 *      ↓  16-bit ADC @ 51.2 kSPS
 *      ↓  数字积分（加速度 → 速度 → 位移）
 *      ↓  带通滤波（各参数不同频段）
 *      ↓  RMS / Peak / Peak-to-Peak 计算
 *      ↓  LCD 显示
 *
 * ── 外观结构 ──────────────────────────────────────────────────
 *
 *  手持式长方形主机（参考 SKF CMAS 100 / Fluke 805 形态）：
 *
 *  ┌─────────────────────────┐
 *  │    ● SENSOR PORT (顶)   │  ← 顶部 BNC / M8 传感器接口
 *  ├─────────────────────────┤
 *  │  ┌───────────────────┐  │
 *  │  │   LCD DISPLAY     │  │  ← 大尺寸 LCD 屏（三行参数）
 *  │  │  D: 12.4 μm p-p   │  │
 *  │  │  V: 1.82 mm/s RMS │  │
 *  │  │  A: 0.45 m/s² pk  │  │
 *  │  └───────────────────┘  │
 *  │  [MEAS] [HOLD] [RANGE]  │  ← 操作按键
 *  │  [MAX ] [AVG ] [UNIT ]  │
 *  ├─────────────────────────┤
 *  │  ████████████████████   │  ← 振动烈度条形图
 *  │   A    B    C    D      │
 *  ├─────────────────────────┤
 *  │  [  POWER / MENU  ]     │  ← 电源/菜单键
 *  └─────────────────────────┘
 *
 * ── 端口 ─────────────────────────────────────────────────────
 *  sensor_in : 模拟/数字传感器信号输入（顶部）
 *
 * ── 可配置参数 ────────────────────────────────────────────────
 *  label        : 位号（默认 'EV-01'）
 *  vibAmplitude : 振动单峰幅值 μm（默认 0）
 *  vibFrequency : 振动频率 Hz（默认 50）
 *  dispUnit     : 位移单位 'um'|'mm'（默认 'um'）
 *  holdMode     : 峰值保持模式（默认 false）
 *  rangeAuto    : 自动量程（默认 true）
 */
export class ElectronicVibrometer extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.width  = Math.max(160, config.width  || 200);
        this.height = Math.max(320, config.height || 400);

        this.type    = 'electronic_vibrometer';
        this.special = 'none';
        this.cache   = 'fixed';

        this._initGroups();
        this._recalcGeometry();
        this._initParameters(config);
        this._init();

        this.config = {
            label        : this.label,
            vibAmplitude : this.vibAmplitude,
            vibFrequency : this.vibFrequency,
            dispUnit     : this.dispUnit,
            holdMode     : this.holdMode,
            rangeAuto    : this.rangeAuto,
        };
    }

    // ═══════════════════════════════════════════
    // 几何尺寸
    // ═══════════════════════════════════════════

    _recalcGeometry() {
        const W = this.width, H = this.height;

        // 主机壳
        this._body = { x: W*0.04, y: H*0.01, w: W*0.92, h: H*0.97, rx: W*0.08 };

        // 顶部传感器接口区
        this._sensorPort = { cx: W*0.50, cy: H*0.058, r: W*0.072 };

        // LCD 屏幕区
        this._lcd = {
            x: W*0.08, y: H*0.130,
            w: W*0.84, h: H*0.340,
            rx: W*0.025,
        };

        // LCD 内三行参数区域
        const lx  = this._lcd.x + W*0.030;
        const lw  = this._lcd.w - W*0.060;
        const ly0 = this._lcd.y + H*0.018;
        const rh  = (this._lcd.h - H*0.036) / 3;
        this._lcdRows = [
            { x: lx, y: ly0,          w: lw, h: rh },   // 位移
            { x: lx, y: ly0 + rh,     w: lw, h: rh },   // 速度
            { x: lx, y: ly0 + rh*2,   w: lw, h: rh },   // 加速度
        ];

        // 按键区（两行，各 3 键）
        const btnW  = W * 0.22, btnH = H * 0.048;
        const btnY0 = H * 0.492, btnY1 = H * 0.556;
        const btnGap = (W*0.92 - btnW*3) / 4;
        this._btnRows = [
            [
                { x: W*0.04 + btnGap,           y: btnY0, w: btnW, h: btnH, label: 'MEAS' },
                { x: W*0.04 + btnGap*2 + btnW,  y: btnY0, w: btnW, h: btnH, label: 'HOLD' },
                { x: W*0.04 + btnGap*3 + btnW*2,y: btnY0, w: btnW, h: btnH, label: 'RANGE'},
            ],
            [
                { x: W*0.04 + btnGap,           y: btnY1, w: btnW, h: btnH, label: 'MAX' },
                { x: W*0.04 + btnGap*2 + btnW,  y: btnY1, w: btnW, h: btnH, label: 'AVG' },
                { x: W*0.04 + btnGap*3 + btnW*2,y: btnY1, w: btnW, h: btnH, label: 'UNIT'},
            ],
        ];

        // 振动烈度条形图区
        this._barGraph = {
            x: W*0.08, y: H*0.624,
            w: W*0.84, h: H*0.080,
        };

        // ISO 等级分区（4区）
        this._isoZones = ['A','B','C','D'];
        this._isoThresh = [0.71, 1.80, 4.50];   // mm/s 分界

        // 电源/菜单键
        this._powerBtn = {
            x: W*0.26, y: H*0.744,
            w: W*0.48, h: H*0.052, rx: W*0.025,
        };

        // 底部位号标签
        this._labelPos = { x: W*0.50, y: H*0.835 };

        // 顶部传感器接线端口标注
        this._portLabel = { x: W*0.50, y: H*0.102 };
    }

    // ═══════════════════════════════════════════
    // 参数初始化
    // ═══════════════════════════════════════════

    _initParameters(config) {
        this.label        = config.label        || 'EV-01';
        this.vibAmplitude = config.vibAmplitude !== undefined ? config.vibAmplitude : 0;    // μm 单峰
        this.vibFrequency = config.vibFrequency !== undefined ? config.vibFrequency : 50;   // Hz
        this.dispUnit     = config.dispUnit     || 'um';
        this.holdMode     = config.holdMode     || false;
        this.rangeAuto    = config.rangeAuto    !== undefined ? config.rangeAuto : true;

        // 内部状态
        this._time        = 0;
        this._measMode    = true;    // 测量使能
        this._maxMode     = false;   // 峰值保持显示
        this._avgMode     = false;   // 平均模式

        // 测量值（实时计算）
        this._disp_pp     = 0;    // μm p-p
        this._vel_rms     = 0;    // mm/s RMS
        this._acc_peak    = 0;    // m/s² peak

        // 峰值保持寄存器
        this._disp_pp_max  = 0;
        this._vel_rms_max  = 0;
        this._acc_peak_max = 0;

        // 滑动平均缓冲（模拟积分时间 ~0.3s）
        this._bufLen   = 18;
        this._dispBuf  = Array(this._bufLen).fill(0);
        this._velBuf   = Array(this._bufLen).fill(0);
        this._accBuf   = Array(this._bufLen).fill(0);
        this._bufPtr   = 0;

        // 按键防抖
        this._btnCooldown = 0;

        // 屏幕闪烁计时（HOLD 激活时）
        this._blinkTimer  = 0;
        this._blinkState  = true;

        // LCD 小数点格式化配置
        this._dispDecimals = 1;
        this._velDecimals  = 2;
        this._accDecimals  = 3;

        // 烈度条动画（平滑）
        this._barLevel = 0;   // 0~1
    }

    // ═══════════════════════════════════════════
    // 初始化
    // ═══════════════════════════════════════════

    _init() {
        this._drawStaticParts();
        this._bindInteraction();
        this._rebuildDynamic();
    }

    // ═══════════════════════════════════════════
    // 静态层
    // ═══════════════════════════════════════════

    _drawStaticParts() {
        this._drawBody();
        this._drawSensorPort();
        this._drawLCDShell();
        this._drawButtons();
        this._drawBarGraphShell();
        this._drawPowerButton();
        this._drawBrandLabel();
        this._drawBottomLabel();
    }

    // 主机壳
    _drawBody() {
        const b = this._body;
        const W = this.width, H = this.height;

        // 主壳（深灰，工业手持外观）
        this._staticGroup.add(new Konva.Rect({
            x: b.x, y: b.y, width: b.w, height: b.h,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint:   { x: b.w, y: b.h },
            fillLinearGradientColorStops: [
                0,    '#484c50',
                0.20, '#3c4044',
                0.55, '#2e3236',
                0.80, '#262a2e',
                1,    '#1e2224',
            ],
            stroke: '#606468', strokeWidth: 1.5,
            cornerRadius: b.rx,
            shadowColor: '#000', shadowBlur: 12,
            shadowOffsetX: 2, shadowOffsetY: 4, shadowOpacity: 0.6,
        }));

        // 顶部圆弧过渡（橡胶质感防护带）
        this._staticGroup.add(new Konva.Rect({
            x: b.x, y: b.y, width: b.w, height: H*0.090,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint:   { x: 0, y: H*0.090 },
            fillLinearGradientColorStops: [
                0, '#1a7a3a', 0.6, '#158030', 1, '#106028',
            ],
            cornerRadius: [b.rx, b.rx, 0, 0],
        }));

        // 防护带纹路
        for (let i = 0; i < 5; i++) {
            this._staticGroup.add(new Konva.Line({
                points: [b.x+4, b.y+H*0.016*i+H*0.010,
                         b.x+b.w-4, b.y+H*0.016*i+H*0.010],
                stroke: 'rgba(0,0,0,0.18)', strokeWidth: 1.2,
            }));
        }

        // 左侧竖向品牌色条
        this._staticGroup.add(new Konva.Rect({
            x: b.x, y: b.y + H*0.090,
            width: W*0.030, height: b.h - H*0.090,
            fill: '#1a7a3a',
            cornerRadius: [0, 0, 0, b.rx],
        }));

        // 右侧立体高光
        this._staticGroup.add(new Konva.Rect({
            x: b.x + b.w - W*0.018, y: b.y + b.rx,
            width: W*0.018, height: b.h - b.rx*2,
            fill: 'rgba(0,0,0,0.25)',
            cornerRadius: [0, b.rx*0.4, b.rx*0.4, 0],
        }));

        // 橡胶防滑侧边纹（右侧）
        for (let i = 0; i < 12; i++) {
            const sy = b.y + H*0.35 + i * H*0.025;
            this._staticGroup.add(new Konva.Line({
                points: [b.x+b.w-W*0.018, sy, b.x+b.w, sy],
                stroke: 'rgba(0,0,0,0.40)', strokeWidth: 1.0,
            }));
        }
    }

    // 顶部传感器接口
    _drawSensorPort() {
        const { cx, cy, r } = this._sensorPort;
        const W = this.width;

        // 外环（金属铬圈）
        this._staticGroup.add(new Konva.Circle({
            x: cx, y: cy, radius: r + W*0.018,
            fillLinearGradientStartPoint:  { x: -r, y: -r },
            fillLinearGradientEndPoint:    { x:  r, y:  r },
            fillLinearGradientColorStops: [0,'#aab0b8', 0.4,'#e0e4e8', 0.6,'#c0c8d0', 1,'#888c90'],
            stroke: '#505458', strokeWidth: 0.8,
        }));

        // BNC 外壳
        this._staticGroup.add(new Konva.Circle({
            x: cx, y: cy, radius: r,
            fillLinearGradientStartPoint:  { x: -r, y: -r },
            fillLinearGradientEndPoint:    { x:  r, y:  r },
            fillLinearGradientColorStops: [0,'#606468', 0.5,'#888c90', 1,'#404448'],
            stroke: '#303438', strokeWidth: 0.8,
        }));

        // BNC 中心插孔
        this._staticGroup.add(new Konva.Circle({
            x: cx, y: cy, radius: r*0.38,
            fill: '#101214',
            stroke: '#484c50', strokeWidth: 0.6,
        }));
        this._staticGroup.add(new Konva.Circle({
            x: cx, y: cy, radius: r*0.14,
            fill: '#c8a840',
        }));

        // 接口标注
        this._staticGroup.add(new Konva.Text({
            x: cx - W*0.20, y: this._portLabel.y,
            width: W*0.40,
            text: 'SENSOR IN',
            fontSize: Math.max(5, W*0.028),
            fontFamily: 'Arial', fontStyle: 'bold',
            fill: '#a0c8a0', align: 'center',
        }));
    }

    // LCD 外框
    _drawLCDShell() {
        const lcd = this._lcd;

        // LCD 嵌入凹槽（外框）
        this._staticGroup.add(new Konva.Rect({
            x: lcd.x - 3, y: lcd.y - 3,
            width: lcd.w + 6, height: lcd.h + 6,
            fill: '#101214',
            stroke: '#202428', strokeWidth: 1,
            cornerRadius: lcd.rx + 3,
            shadowColor: '#000', shadowBlur: 4,
            shadowOpacity: 0.6, shadowOffsetY: 1,
        }));

        // LCD 屏幕背板（深蓝绿，关机色）
        this._staticGroup.add(new Konva.Rect({
            x: lcd.x, y: lcd.y,
            width: lcd.w, height: lcd.h,
            fill: '#0a1a14',
            cornerRadius: lcd.rx,
        }));

        // 行分隔线
        const rh = (lcd.h - this.height*0.036) / 3;
        for (let i = 1; i < 3; i++) {
            this._staticGroup.add(new Konva.Line({
                points: [
                    lcd.x + lcd.w*0.03, lcd.y + this.height*0.018 + rh*i,
                    lcd.x + lcd.w*0.97, lcd.y + this.height*0.018 + rh*i,
                ],
                stroke: '#102820', strokeWidth: 0.8,
            }));
        }

        // 玻璃反光（上边高光）
        this._staticGroup.add(new Konva.Rect({
            x: lcd.x + 3, y: lcd.y + 2,
            width: lcd.w - 6, height: lcd.h*0.12,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint:   { x: 0, y: lcd.h*0.12 },
            fillLinearGradientColorStops: [
                0, 'rgba(255,255,255,0.08)', 1, 'rgba(255,255,255,0)',
            ],
            cornerRadius: [lcd.rx, lcd.rx, 0, 0],
            listening: false,
        }));
    }

    // 操作按键（静态外壳，按键状态在动态层）
    _drawButtons() {
        this._btnRows.flat().forEach(btn => {
            // 按键底座（凹陷槽）
            this._staticGroup.add(new Konva.Rect({
                x: btn.x - 1, y: btn.y + 1,
                width: btn.w + 2, height: btn.h + 2,
                fill: '#181c20',
                cornerRadius: 4,
            }));
        });
    }

    // 振动烈度条形图外框
    _drawBarGraphShell() {
        const bg = this._barGraph;
        const W  = this.width, H = this.height;

        // 背景槽
        this._staticGroup.add(new Konva.Rect({
            x: bg.x - 2, y: bg.y - 2,
            width: bg.w + 4, height: bg.h + H*0.042 + 4,
            fill: '#0e1214',
            stroke: '#202428', strokeWidth: 1,
            cornerRadius: 3,
        }));

        // 标题
        this._staticGroup.add(new Konva.Text({
            x: bg.x, y: bg.y - H*0.018,
            width: bg.w * 0.45,
            text: 'ISO 10816',
            fontSize: Math.max(5, W*0.026),
            fontFamily: 'Arial', fontStyle: 'bold',
            fill: '#60a080',
        }));
        this._staticGroup.add(new Konva.Text({
            x: bg.x + bg.w*0.46, y: bg.y - H*0.018,
            width: bg.w * 0.54,
            text: 'Velocity RMS mm/s',
            fontSize: Math.max(4.5, W*0.023),
            fontFamily: 'Arial',
            fill: '#406050',
        }));

        // ISO 区域分隔标注
        const zoneColors = ['#20c040','#c0c020','#e08020','#e02020'];
        const zoneLabels = ['A\n≤0.71','B\n≤1.80','C\n≤4.50','D\n>4.50'];
        for (let i = 0; i < 4; i++) {
            const zx = bg.x + bg.w * (i / 4);
            const zw = bg.w / 4;
            // 区域标注背景
            this._staticGroup.add(new Konva.Rect({
                x: zx + 1, y: bg.y + bg.h + 1,
                width: zw - 2, height: H*0.038,
                fill: '#0a0e10',
                cornerRadius: 2,
            }));
            this._staticGroup.add(new Konva.Text({
                x: zx, y: bg.y + bg.h + H*0.003,
                width: zw,
                text: zoneLabels[i],
                fontSize: Math.max(4, W*0.022),
                fontFamily: 'Arial', fontStyle: 'bold',
                fill: zoneColors[i],
                align: 'center',
            }));
            // 分隔竖线
            if (i > 0) {
                this._staticGroup.add(new Konva.Line({
                    points: [zx, bg.y - 2, zx, bg.y + bg.h + H*0.040],
                    stroke: '#1e2428', strokeWidth: 0.8,
                }));
            }
        }
    }

    // 电源/菜单键
    _drawPowerButton() {
        const pb = this._powerBtn;
        // 底座
        this._staticGroup.add(new Konva.Rect({
            x: pb.x - 1, y: pb.y + 2,
            width: pb.w + 2, height: pb.h + 2,
            fill: '#101214', cornerRadius: pb.rx + 2,
        }));
    }

    // 品牌铭牌（LCD 上方）
    _drawBrandLabel() {
        const W = this.width, H = this.height;
        // 品牌文字
        this._staticGroup.add(new Konva.Text({
            x: this._body.x, y: H*0.870,
            width: this._body.w,
            text: 'VIBRATION METER',
            fontSize: Math.max(6.5, W*0.036),
            fontFamily: 'Arial', fontStyle: 'bold',
            fill: '#608870',
            align: 'center',
        }));
        this._staticGroup.add(new Konva.Text({
            x: this._body.x, y: H*0.900,
            width: this._body.w,
            text: 'VM-3000',
            fontSize: Math.max(5.5, W*0.030),
            fontFamily: 'Arial',
            fill: '#406050',
            align: 'center',
        }));
    }

    // 底部位号
    _drawBottomLabel() {
        const lp = this._labelPos;
        this._staticGroup.add(new Konva.Text({
            x: lp.x - 40, y: lp.y + 10,
            width: 80,
            text: this.label,
            fontSize: Math.max(9, this.width*0.048),
            fontFamily: 'Arial', fontStyle: 'bold',
            fill: '#c0a060', align: 'center',
        }));
    }

    // ═══════════════════════════════════════════
    // 动态层
    // ═══════════════════════════════════════════

    _rebuildDynamic() {
        this._dynamicGroup.destroyChildren();
        this._drawLCDContent();
        this._drawButtonFaces();
        this._drawBarGraph();
        this._drawPowerButtonFace();
    }

    // ── LCD 内容 ──────────────────────────────

    _drawLCDContent() {
        const rows = this._lcdRows;
        const W = this.width;
        const powered = this._measMode;

        if (!powered) {
            // 关机状态：全黑
            return;
        }

        // 三行参数
        const params = [
            {
                icon:  'D',
                label: 'Displacement',
                value: this._fmtDisp(),
                unit:  this.dispUnit === 'um' ? 'μm p-p' : 'mm p-p',
                color: '#40ffb0',
                warn:  false,
            },
            {
                icon:  'V',
                label: 'Velocity',
                value: this._fmtVel(),
                unit:  'mm/s RMS',
                color: '#40d8ff',
                warn:  this._vel_rms > 4.50,
            },
            {
                icon:  'A',
                label: 'Acceleration',
                value: this._fmtAcc(),
                unit:  'm/s² pk',
                color: '#ffb840',
                warn:  false,
            },
        ];

        params.forEach((p, i) => {
            const row = rows[i];
            const H   = this.height;

            // 行背景
            this._dynamicGroup.add(new Konva.Rect({
                x: row.x - W*0.010, y: row.y,
                width: row.w + W*0.020, height: row.h - H*0.004,
                fill: p.warn
                    ? 'rgba(255,50,20,0.10)'
                    : (i % 2 === 0 ? 'rgba(255,255,255,0.02)' : 'transparent'),
                cornerRadius: 3,
                listening: false,
            }));

            // 参数图标（左侧大字母）
            this._dynamicGroup.add(new Konva.Text({
                x: row.x, y: row.y + row.h*0.08,
                width: W*0.090, height: row.h*0.84,
                text: p.icon,
                fontSize: Math.max(12, W*0.088),
                fontFamily: 'Courier New', fontStyle: 'bold',
                fill: p.color,
                align: 'center',
                verticalAlign: 'middle',
            }));

            // 参数名小标（左侧图标下方）
            this._dynamicGroup.add(new Konva.Text({
                x: row.x, y: row.y + row.h*0.66,
                width: W*0.090,
                text: p.label.substring(0,4).toUpperCase(),
                fontSize: Math.max(4, W*0.022),
                fontFamily: 'Arial',
                fill: p.color + '80',
                align: 'center',
            }));

            // 数值（大字体，主显示）
            const isHold = this.holdMode && this._blinkState;
            const displayVal = this.holdMode ? this._fmtHoldDisp(i) : p.value;

            this._dynamicGroup.add(new Konva.Text({
                x: row.x + W*0.098, y: row.y + row.h*0.05,
                width: row.w - W*0.098 - W*0.060,
                height: row.h * 0.65,
                text: displayVal,
                fontSize: Math.max(15, W*0.115),
                fontFamily: 'Courier New', fontStyle: 'bold',
                fill: p.warn
                    ? (this._blinkState ? '#ff4020' : '#802010')
                    : p.color,
                align: 'right',
                verticalAlign: 'middle',
            }));

            // 单位（右下角小字）
            this._dynamicGroup.add(new Konva.Text({
                x: row.x + W*0.098, y: row.y + row.h*0.60,
                width: row.w - W*0.098,
                text: p.unit,
                fontSize: Math.max(5.5, W*0.030),
                fontFamily: 'Arial',
                fill: p.color + 'a0',
                align: 'right',
            }));

            // HOLD 标记
            if (this.holdMode) {
                this._dynamicGroup.add(new Konva.Text({
                    x: row.x, y: row.y + row.h*0.04,
                    width: W*0.090,
                    text: 'HLD',
                    fontSize: Math.max(4.5, W*0.024),
                    fontFamily: 'Arial', fontStyle: 'bold',
                    fill: '#ff8040',
                    align: 'center',
                }));
            }
        });

        // 频率显示（LCD 底部）
        const lcd = this._lcd;
        this._dynamicGroup.add(new Konva.Text({
            x: lcd.x + 4, y: lcd.y + lcd.h - this.height*0.030,
            width: lcd.w * 0.45,
            text: `f: ${this.vibFrequency.toFixed(1)} Hz`,
            fontSize: Math.max(5, W*0.026),
            fontFamily: 'Courier New',
            fill: '#50a070',
        }));

        // 模式标志（AUTO/HOLD/MAX/AVG）
        const modeText = [
            this.rangeAuto ? 'AUTO' : 'MAN',
            this._maxMode  ? 'MAX'  : '',
            this._avgMode  ? 'AVG'  : '',
        ].filter(Boolean).join(' ');

        this._dynamicGroup.add(new Konva.Text({
            x: lcd.x + lcd.w*0.46, y: lcd.y + lcd.h - this.height*0.030,
            width: lcd.w * 0.52,
            text: modeText,
            fontSize: Math.max(5, W*0.026),
            fontFamily: 'Arial', fontStyle: 'bold',
            fill: '#608860',
            align: 'right',
        }));

        // 电池图标（右上角）
        this._drawBatteryIcon();
    }

    // 电池图标
    _drawBatteryIcon() {
        const lcd = this._lcd;
        const W   = this.width;
        const bx  = lcd.x + lcd.w - W*0.085;
        const by  = lcd.y + 4;
        const bw  = W*0.070, bh = this.height*0.022;

        this._dynamicGroup.add(new Konva.Rect({
            x: bx, y: by, width: bw, height: bh,
            stroke: '#408060', strokeWidth: 0.8, fill: 'transparent',
            cornerRadius: 1,
        }));
        this._dynamicGroup.add(new Konva.Rect({
            x: bx + bw, y: by + bh*0.25,
            width: W*0.010, height: bh*0.50,
            fill: '#408060',
        }));
        // 电量（80%）
        this._dynamicGroup.add(new Konva.Rect({
            x: bx + 1, y: by + 1,
            width: (bw - 2) * 0.80, height: bh - 2,
            fill: '#308050',
            cornerRadius: 1,
        }));
    }

    // 按键面
    _drawButtonFaces() {
        const W = this.width;
        const allBtns = this._btnRows.flat();
        const activeKeys = {
            'MEAS' : this._measMode,
            'HOLD' : this.holdMode,
            'MAX'  : this._maxMode,
            'AVG'  : this._avgMode,
            'RANGE': !this.rangeAuto,
        };

        allBtns.forEach(btn => {
            const active = activeKeys[btn.label] || false;

            // 按键主体
            this._dynamicGroup.add(new Konva.Rect({
                x: btn.x, y: btn.y,
                width: btn.w, height: btn.h,
                fillLinearGradientStartPoint: { x: 0, y: 0 },
                fillLinearGradientEndPoint:   { x: 0, y: btn.h },
                fillLinearGradientColorStops: active
                    ? [0,'#206840', 0.4,'#1a5830', 1,'#104020']
                    : [0,'#3a3e42', 0.4,'#2e3236', 1,'#22262a'],
                stroke: active ? '#40b060' : '#505458',
                strokeWidth: 0.8,
                cornerRadius: 4,
            }));

            // 按键文字
            this._dynamicGroup.add(new Konva.Text({
                x: btn.x, y: btn.y,
                width: btn.w, height: btn.h,
                text: btn.label,
                fontSize: Math.max(6, W*0.030),
                fontFamily: 'Arial', fontStyle: 'bold',
                fill: active ? '#80ffb0' : '#909898',
                align: 'center', verticalAlign: 'middle',
            }));

            // 激活指示点
            if (active) {
                this._dynamicGroup.add(new Konva.Circle({
                    x: btn.x + btn.w - W*0.025,
                    y: btn.y + this.height*0.010,
                    radius: W*0.014,
                    fill: '#40ff80',
                    shadowColor: '#00ff60',
                    shadowBlur: 4, shadowOpacity: 0.8,
                }));
            }
        });
    }

    // 振动烈度条形图
    _drawBarGraph() {
        const bg  = this._barGraph;
        const W   = this.width;
        const v   = this._vel_rms;   // mm/s RMS

        // 对数刻度：0 → 0.1 → 0.71 → 1.8 → 4.5 → 10 mm/s
        // 映射到 barLevel 0~1
        const logMap = (val) => {
            if (val <= 0) return 0;
            const lo = Math.log10(0.1);
            const hi = Math.log10(10);
            return Math.max(0, Math.min(1, (Math.log10(val) - lo) / (hi - lo)));
        };

        const level     = logMap(v);
        const threshPos = this._isoThresh.map(t => logMap(t));

        // 平滑条形图
        const targetBar = level;
        this._barLevel  = this._barLevel * 0.85 + targetBar * 0.15;

        // 条形图背景（各区域底色）
        const zoneColors = [
            'rgba(0,180,60,0.12)',
            'rgba(200,200,0,0.12)',
            'rgba(220,120,0,0.12)',
            'rgba(220,30,20,0.12)',
        ];
        for (let i = 0; i < 4; i++) {
            this._dynamicGroup.add(new Konva.Rect({
                x: bg.x + bg.w*(i/4) + 1, y: bg.y,
                width: bg.w/4 - 2, height: bg.h,
                fill: zoneColors[i],
                cornerRadius: i===0?[2,0,0,2]: (i===3?[0,2,2,0]:0),
                listening: false,
            }));
        }

        // 活跃条（从左至右渐变颜色）
        if (this._barLevel > 0) {
            const fillW = bg.w * this._barLevel;
            const zLevel = this._barLevel;

            // 分段填充（各区段颜色不同）
            const segColors = ['#20c040','#c0c020','#e08020','#e02020'];
            for (let i = 0; i < 4; i++) {
                const segStart = i / 4;
                const segEnd   = (i+1) / 4;
                if (zLevel <= segStart) break;
                const segFill = Math.min(zLevel, segEnd);
                const segX    = bg.x + bg.w * segStart;
                const segW    = bg.w * (segFill - segStart);

                this._dynamicGroup.add(new Konva.Rect({
                    x: segX + 1, y: bg.y + 2,
                    width: Math.max(0, segW - 2), height: bg.h - 4,
                    fillLinearGradientStartPoint: { x: 0, y: 0 },
                    fillLinearGradientEndPoint:   { x: segW, y: 0 },
                    fillLinearGradientColorStops: [
                        0, segColors[i] + 'c0', 1, segColors[i],
                    ],
                    cornerRadius: i===0 ? [2,0,0,2] : 0,
                    listening: false,
                }));
            }

            // 顶部高光条
            this._dynamicGroup.add(new Konva.Rect({
                x: bg.x + 1, y: bg.y + 2,
                width: fillW - 2, height: bg.h*0.25,
                fill: 'rgba(255,255,255,0.15)',
                cornerRadius: [2,0,0,2],
                listening: false,
            }));
        }

        // 分隔刻度线（在条形图上方）
        threshPos.forEach((tp, i) => {
            const lx = bg.x + bg.w * tp;
            this._dynamicGroup.add(new Konva.Line({
                points: [lx, bg.y, lx, bg.y + bg.h],
                stroke: 'rgba(255,255,255,0.30)',
                strokeWidth: 1,
                dash: [2, 2],
                listening: false,
            }));
        });

        // 当前值指针线
        if (this._barLevel > 0.01) {
            const px = bg.x + bg.w * this._barLevel;
            this._dynamicGroup.add(new Konva.Line({
                points: [px, bg.y - 3, px, bg.y + bg.h + 3],
                stroke: '#ffffff',
                strokeWidth: 1.5,
                listening: false,
                shadowColor: '#fff', shadowBlur: 3, shadowOpacity: 0.6,
            }));
        }

        // 数值标注（条形图右上方）
        const velText = v > 0
            ? `${v.toFixed(2)} mm/s`
            : '0.00 mm/s';
        this._dynamicGroup.add(new Konva.Text({
            x: bg.x, y: bg.y - this.height*0.018,
            width: bg.w,
            text: velText,
            fontSize: Math.max(5.5, W*0.030),
            fontFamily: 'Courier New', fontStyle: 'bold',
            fill: this._getZoneColor(v),
            align: 'right',
        }));
    }

    // 电源键面
    _drawPowerButtonFace() {
        const pb = this._powerBtn;
        const W  = this.width;

        this._dynamicGroup.add(new Konva.Rect({
            x: pb.x, y: pb.y, width: pb.w, height: pb.h,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint:   { x: 0, y: pb.h },
            fillLinearGradientColorStops: this._measMode
                ? [0,'#206840', 0.5,'#185030', 1,'#102820']
                : [0,'#3a3e42', 0.5,'#2e3236', 1,'#22262a'],
            stroke: this._measMode ? '#30a060' : '#404448',
            strokeWidth: 0.8,
            cornerRadius: pb.rx,
        }));

        // 电源图标
        const icx = pb.x + pb.w*0.22, icy = pb.y + pb.h*0.50;
        const icR = pb.h*0.30;
        this._dynamicGroup.add(new Konva.Arc({
            x: icx, y: icy,
            innerRadius: icR*0.55, outerRadius: icR,
            angle: 300, rotation: -240,
            fill: this._measMode ? '#40ff80' : '#506058',
        }));
        this._dynamicGroup.add(new Konva.Line({
            points: [icx, icy - icR*0.45, icx, icy - icR*1.05],
            stroke: this._measMode ? '#40ff80' : '#506058',
            strokeWidth: Math.max(1, W*0.012),
            lineCap: 'round',
        }));

        // 电源文字
        this._dynamicGroup.add(new Konva.Text({
            x: pb.x + pb.w*0.36, y: pb.y,
            width: pb.w*0.60, height: pb.h,
            text: 'POWER / MENU',
            fontSize: Math.max(6, W*0.032),
            fontFamily: 'Arial', fontStyle: 'bold',
            fill: this._measMode ? '#70d090' : '#606868',
            verticalAlign: 'middle',
        }));
    }

    // ═══════════════════════════════════════════
    // 格式化工具
    // ═══════════════════════════════════════════

    _fmtDisp() {
        const v = this._maxMode ? this._disp_pp_max : this._disp_pp;
        if (this.dispUnit === 'mm') {
            return (v / 1000).toFixed(3);
        }
        return v.toFixed(this._dispDecimals);
    }

    _fmtVel() {
        const v = this._maxMode ? this._vel_rms_max : this._vel_rms;
        return v.toFixed(this._velDecimals);
    }

    _fmtAcc() {
        const v = this._maxMode ? this._acc_peak_max : this._acc_peak;
        return v.toFixed(this._accDecimals);
    }

    _fmtHoldDisp(rowIdx) {
        switch (rowIdx) {
            case 0: return this._fmtDisp();
            case 1: return this._fmtVel();
            case 2: return this._fmtAcc();
        }
        return '---';
    }

    _getZoneColor(v) {
        if (v <= 0.71) return '#20c040';
        if (v <= 1.80) return '#c0c020';
        if (v <= 4.50) return '#e08020';
        return '#e02020';
    }

    // ═══════════════════════════════════════════
    // 交互绑定
    // ═══════════════════════════════════════════

    _bindInteraction() {
        const hitArea = new Konva.Rect({
            x: this._body.x, y: this._body.y,
            width: this._body.w, height: this._body.h,
            fill: 'transparent',
        });
        hitArea.on('click tap', (e) => {
            if (this._btnCooldown > 0) return;
            this._btnCooldown = 0.2;

            const pos = e.target.getStage().getPointerPosition();
            const lx  = pos.x - (this._node?.x?.() || 0);
            const ly  = pos.y - (this._node?.y?.() || 0);

            // 检测按键点击
            const hit = this._hitTestButtons(lx, ly);
            if (hit) {
                this._handleButton(hit);
                return;
            }

            // 点击电源键
            const pb = this._powerBtn;
            if (lx >= pb.x && lx <= pb.x+pb.w && ly >= pb.y && ly <= pb.y+pb.h) {
                this._measMode = !this._measMode;
                if (!this._measMode) {
                    this.holdMode = false;
                    this._maxMode = false;
                }
                return;
            }

            // 点击主体：循环切换演示振动幅值
            const steps = [
                [0, 50], [3, 10], [7, 25], [15, 50], [30, 100], [60, 200],
            ];
            let idx = steps.findIndex(s => Math.abs(s[0] - this.vibAmplitude) < 0.5);
            idx = (idx + 1) % steps.length;
            this.vibAmplitude = steps[idx][0];
            this.vibFrequency = steps[idx][1];
            // 重置 MAX
            this._disp_pp_max = 0;
            this._vel_rms_max = 0;
            this._acc_peak_max = 0;
        });
        this._interactGroup.add(hitArea);
    }

    _hitTestButtons(lx, ly) {
        for (const btn of this._btnRows.flat()) {
            if (lx >= btn.x && lx <= btn.x+btn.w &&
                ly >= btn.y && ly <= btn.y+btn.h) {
                return btn.label;
            }
        }
        return null;
    }

    _handleButton(label) {
        switch (label) {
            case 'MEAS' : this._measMode   = true; this.holdMode = false; break;
            case 'HOLD' : this.holdMode    = !this.holdMode; break;
            case 'RANGE': this.rangeAuto   = !this.rangeAuto; break;
            case 'MAX'  : this._maxMode    = !this._maxMode; this._avgMode = false; break;
            case 'AVG'  : this._avgMode    = !this._avgMode; this._maxMode = false; break;
            case 'UNIT' :
                this.dispUnit = this.dispUnit === 'um' ? 'mm' : 'um';
                break;
        }
    }

    // ═══════════════════════════════════════════
    // 物理计算
    // ═══════════════════════════════════════════

    /**
     * 正弦振动参数关系（单峰振幅 A μm，频率 f Hz）：
     *
     *  位移峰峰值 D_pp = 2A  [μm]
     *
     *  速度 RMS   V_rms = (2π·f·A·1e-3) / √2  [mm/s]
     *           = π·f·A·√2 × 1e-3
     *
     *  加速度峰值 A_peak = (2π·f)²·A·1e-6  [m/s²]
     */
    _calcPhysics() {
        const A  = this.vibAmplitude;   // μm
        const f  = this.vibFrequency;   // Hz
        const w  = 2 * Math.PI * f;

        // 加入少量噪声模拟真实测量抖动
        const noise = (r) => 1 + (Math.random() - 0.5) * r;

        const disp_pp  = 2 * A * noise(0.012);
        const vel_rms  = (w * A * 1e-3) / Math.SQRT2 * noise(0.015);  // mm/s
        const acc_peak = w * w * A * 1e-6 * noise(0.018);              // m/s²

        return { disp_pp, vel_rms, acc_peak };
    }

    // ═══════════════════════════════════════════
    // tick
    // ═══════════════════════════════════════════

    tick(dt) {
        this._time        += dt;
        this._blinkTimer  += dt;
        this._btnCooldown  = Math.max(0, this._btnCooldown - dt);

        if (this._blinkTimer > 0.5) {
            this._blinkTimer = 0;
            this._blinkState = !this._blinkState;
        }

        if (!this._measMode) {
            this._rebuildDynamic();
            this.markDirty();
            this._refreshIfDirty();
            return;
        }

        if (!this.holdMode) {
            // 计算原始测量值
            const { disp_pp, vel_rms, acc_peak } = this._calcPhysics();

            // 推入滑动缓冲
            this._dispBuf[this._bufPtr] = disp_pp;
            this._velBuf [this._bufPtr] = vel_rms;
            this._accBuf [this._bufPtr] = acc_peak;
            this._bufPtr = (this._bufPtr + 1) % this._bufLen;

            // 平均模式：滑动平均；否则：最新值
            if (this._avgMode) {
                this._disp_pp  = this._dispBuf.reduce((a,b)=>a+b,0) / this._bufLen;
                this._vel_rms  = this._velBuf .reduce((a,b)=>a+b,0) / this._bufLen;
                this._acc_peak = this._accBuf .reduce((a,b)=>a+b,0) / this._bufLen;
            } else {
                // 低通滤波（模拟积分时间）
                const k = Math.min(1, dt * 12);
                this._disp_pp  = this._disp_pp  * (1-k) + disp_pp  * k;
                this._vel_rms  = this._vel_rms  * (1-k) + vel_rms  * k;
                this._acc_peak = this._acc_peak * (1-k) + acc_peak * k;
            }

            // 更新峰值保持寄存器
            if (this._disp_pp  > this._disp_pp_max)  this._disp_pp_max  = this._disp_pp;
            if (this._vel_rms  > this._vel_rms_max)   this._vel_rms_max  = this._vel_rms;
            if (this._acc_peak > this._acc_peak_max)  this._acc_peak_max = this._acc_peak;
        }

        this._rebuildDynamic();
        this.markDirty();
        this._refreshIfDirty();
    }

    // ═══════════════════════════════════════════
    // 公开 API
    // ═══════════════════════════════════════════

    setVibration(amplitudeUM, frequencyHz) {
        this.vibAmplitude = amplitudeUM;
        if (frequencyHz !== undefined) this.vibFrequency = frequencyHz;
    }

    getReadings() {
        return {
            disp_pp_um  : this._disp_pp,
            vel_rms_mms : this._vel_rms,
            acc_peak_ms2: this._acc_peak,
        };
    }

    getConfigFields() {
        return [
            { label: '位号/名称',         key: 'label',        type: 'text'   },
            { label: '振动幅值 (μm pk)',   key: 'vibAmplitude', type: 'number' },
            { label: '振动频率 (Hz)',      key: 'vibFrequency', type: 'number' },
            { label: '位移单位 um/mm',    key: 'dispUnit',     type: 'text'   },
            { label: '峰值保持 (1/0)',    key: 'holdMode',     type: 'number' },
            { label: '自动量程 (1/0)',    key: 'rangeAuto',    type: 'number' },
        ];
    }

    onConfigUpdate(cfg) {
        if (cfg.label        !== undefined) this.label        = cfg.label;
        if (cfg.vibAmplitude !== undefined) this.vibAmplitude = parseFloat(cfg.vibAmplitude);
        if (cfg.vibFrequency !== undefined) this.vibFrequency = parseFloat(cfg.vibFrequency);
        if (cfg.dispUnit     !== undefined) this.dispUnit     = cfg.dispUnit;
        if (cfg.holdMode     !== undefined) this.holdMode     = !!parseInt(cfg.holdMode);
        if (cfg.rangeAuto    !== undefined) this.rangeAuto    = !!parseInt(cfg.rangeAuto);

        this.config = { ...this.config, ...cfg };
        this._recalcGeometry();
        this._rebuildDynamic();
        this._refreshCache();
    }

    update(state) {
        if (typeof state === 'object' && state !== null) {
            if (state.amplitude !== undefined) this.vibAmplitude = state.amplitude;
            if (state.frequency !== undefined) this.vibFrequency = state.frequency;
        }
        this._refreshCache();
    }

    destroy() {
        super.destroy?.();
    }
}
