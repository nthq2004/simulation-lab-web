import { BaseComponent } from './BaseComponent.js';

/**
 * 振动测试台（Vibration Test Bench）仿真组件
 *
 * ── 用途 ──────────────────────────────────────────────────────
 *
 *  用于对机械振动表（Reed振动计、机械振动表、电子振动仪等）进行
 *  校准、比对和功能验证的标准振动激励装置。
 *
 * ── 整体布局 ──────────────────────────────────────────────────
 *
 *  ┌──────────────────────────────────────────────────────────┐
 *  │  ┌─ 操作面板（左）──────────┐  ┌─ 振动台（右）─────────┐  │
 *  │  │                          │  │                        │  │
 *  │  │  [仪表盘: 频率/幅值显示]  │  │  ┌──────────────────┐  │  │
 *  │  │                          │  │  │  安装平台         │  │  │
 *  │  │  振动模式选择：           │  │  │  （被测振动仪）    │  │  │
 *  │  │  ○ 简谐振动（正弦）       │  │  └──────────────────┘  │  │
 *  │  │  ○ 扫频振动               │  │                        │  │
 *  │  │  ○ 随机振动               │  │  [激振器线圈/弹簧]      │  │
 *  │  │  ○ 冲击（半正弦）         │  │                        │  │
 *  │  │                          │  │  [振动台基座]           │  │
 *  │  │  ── 参数设置 ──           │  │                        │  │
 *  │  │  频率：  [▼] [25.0] [▲]  │  └────────────────────────┘  │
 *  │  │  幅值：  [▼] [10.0] [▲]  │                              │
 *  │  │  扫频起：[▼] [10.0] [▲]  │  ── 底部状态栏 ──            │
 *  │  │  扫频止：[▼] [200 ] [▲]  │  运行时间 | 循环次数 | 状态   │
 *  │  │  扫频率：[▼] [1.0 ] [▲]  │                              │
 *  │  │  冲击宽：[▼] [11  ] [▲]  │                              │
 *  │  │                          │                              │
 *  │  │  ── 量值基准 ──           │                              │
 *  │  │  参考位移: 12.5 μm p-p    │                              │
 *  │  │  参考速度: 0.98 mm/s RMS  │                              │
 *  │  │  参考加速: 0.024 m/s² pk  │                              │
 *  │  │                          │                              │
 *  │  │  [■ STOP]  [▶ START]     │                              │
 *  │  │  [紧急停止 E-STOP]        │                              │
 *  │  └──────────────────────────┘                              │
 *  └──────────────────────────────────────────────────────────┘
 *
 * ── 振动模式 ──────────────────────────────────────────────────
 *
 *  1. 简谐振动（Sinusoidal）
 *     x(t) = A·sin(2π·f·t)
 *     最基本模式，用于单频校准
 *
 *  2. 扫频振动（Frequency Sweep）
 *     频率在 f_start ~ f_end 间连续扫描（线性或对数）
 *     f(t) = f_start + (f_end - f_start) · (t/T_sweep)  [线性]
 *     用于找共振频率、频率响应测试
 *
 *  3. 随机振动（Random）
 *     宽带随机信号，模拟真实工业振动环境
 *     由多个频率分量叠加（仿真：多正弦叠加 + 随机扰动）
 *
 *  4. 冲击（Shock / Half-Sine）
 *     半正弦冲击脉冲：x(t) = A·sin(π·t/τ)，0 ≤ t ≤ τ
 *     τ = 冲击持续时间（ms）
 *     用于冲击响应测试
 *
 * ── 振动台结构（右侧）────────────────────────────────────────
 *
 *  ・基座（Base）：厚铸铁隔振底座，带调平螺钉
 *  ・隔振垫（Isolation Pad）：橡胶隔振层，防止台面振动传到地面
 *  ・激振器（Electrodynamic Shaker）：电动力型，线圈+磁钢+弹簧悬挂
 *  ・导向柱（Guide Columns）：四根精密导柱，约束台面做纯线性运动
 *  ・振动台面（Vibration Table）：被测件安装平台，带T型槽
 *  ・参考加速度计（Reference Accelerometer）：安装在台面，提供反馈
 *
 * ── 操作面板（左侧）─────────────────────────────────────────
 *
 *  ・频率/幅值仪表（双指针表盘）
 *  ・模式选择（4选1单选按钮）
 *  ・参数旋钮区（频率、幅值、扫频参数、冲击参数）
 *  ・量值参考显示（三参数数字表）
 *  ・START / STOP / E-STOP 控制按钮
 *  ・运行状态指示灯
 *
 * ── 端口 ─────────────────────────────────────────────────────
 *  无外部电气端口（自包含系统）
 *
 * ── 可配置参数 ────────────────────────────────────────────────
 *  label          : 位号（默认 'VTB-01'）
 *  vibMode        : 振动模式 'sine'|'sweep'|'random'|'shock'（默认 'sine'）
 *  frequency      : 频率 Hz（默认 25）
 *  amplitude      : 幅值 μm pk（默认 10）
 *  sweepStart     : 扫频起始 Hz（默认 10）
 *  sweepEnd       : 扫频终止 Hz（默认 200）
 *  sweepRate      : 扫频速率 oct/min（默认 1）
 *  shockWidth     : 冲击脉宽 ms（默认 11）
 *  shockRepeat    : 冲击重复周期 s（默认 2）
 */
export class VibrationTestBench extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.width = Math.max(700, config.width || 880);
        this.height = Math.max(520, config.height || 620);

        this.type = 'vibration_test_bench';
        this.special = 'none';
        this.cache = 'fixed';

        this._initGroups();
        this._recalcGeometry();
        this._initParameters(config);
        this._init();

        this.config = {
            label: this.label,
            vibMode: this.vibMode,
            frequency: this.frequency,
            amplitude: this.amplitude,
            sweepStart: this.sweepStart,
            sweepEnd: this.sweepEnd,
            sweepRate: this.sweepRate,
            shockWidth: this.shockWidth,
            shockRepeat: this.shockRepeat,
        };
    }

    // ═══════════════════════════════════════════
    // 几何
    // ═══════════════════════════════════════════

    _recalcGeometry() {
        const W = this.width, H = this.height;

        // 整体外框
        this._outerFrame = { x: W * 0.01, y: H * 0.01, w: W * 0.98, h: H * 0.97, rx: W * 0.015 };

        // 标题栏
        this._titleBar = { x: W * 0.01, y: H * 0.01, w: W * 0.98, h: H * 0.045 };

        // 分隔线 X（左右面板分割）
        this._divX = W * 0.30;

        // ── 左侧操作面板区 ──
        this._panelL = {
            x: W * 0.015, y: H * 0.055,
            w: this._divX - W * 0.025, h: H * 0.890,
        };

        // 仪表区（面板顶部）
        this._meterZone = {
            x: this._panelL.x + W * 0.010,
            y: this._panelL.y + H * 0.028,
            w: this._panelL.w - W * 0.020,
            h: H * 0.155,
        };

        // 模式选择区
        this._modeZone = {
            x: this._panelL.x + W * 0.010,
            y: this._meterZone.y + this._meterZone.h + H * 0.008,
            w: this._panelL.w - W * 0.020,
            h: H * 0.100,
        };

        // 参数设置区
        this._paramZone = {
            x: this._panelL.x + W * 0.010,
            y: this._modeZone.y + this._modeZone.h + H * 0.008,
            w: this._panelL.w - W * 0.020,
            h: H * 0.300,
        };

        // 量值基准区
        this._refZone = {
            x: this._panelL.x + W * 0.010,
            y: this._paramZone.y + this._paramZone.h + H * 0.006,
            w: this._panelL.w - W * 0.020,
            h: H * 0.150,
        };

        // 控制按钮区
        this._ctrlZone = {
            x: this._panelL.x + W * 0.010,
            y: this._refZone.y + this._refZone.h + H * 0.008,
            w: this._panelL.w - W * 0.020,
            h: H * 0.110,
        };

        // ── 右侧振动台区 ──
        this._panelR = {
            x: this._divX + W * 0.010,
            y: H * 0.055,
            w: W * 0.980 - this._divX - W * 0.015,
            h: H * 0.890,
        };

        // 振动台主体（压缩到下部，为安装区域留出上半部分）
        const rp = this._panelR;
        //底部固定
        this._shakerBase = {
            x: rp.x + rp.w * 0.10, y: rp.y + rp.h * 0.94,
            w: rp.w * 0.80, h: rp.h * 0.055,
        };
        //隔振
        this._isolationPad = {
            x: rp.x + rp.w * 0.15, y: rp.y + rp.h * 0.91,
            w: rp.w * 0.70, h: rp.h * 0.025,
        };
        //激振器主体
        this._shakerBody = {
            cx: rp.x + rp.w * 0.50,
            y: rp.y + rp.h * 0.76,
            w: rp.w * 0.50,
            h: rp.h * 0.15,
        };
        // 导向柱（2根，缩短到台面到激振器区域）
        const gcx = [
            rp.x + rp.w * 0.36,
            rp.x + rp.w * 0.64,
        ];
        this._guideCols = gcx.map(x => ({ x, yTop: rp.y + rp.h * 0.66, h: rp.h * 0.10, w: rp.w * 0.025 }));

        // 振动台面（在右面板下半部中心偏上，给安装区域留出至少 50% 空间）
        this._tableBaseY = rp.y + rp.h * 0.73;
        this._tableW = rp.w * 0.58;
        this._tableH = rp.h * 0.065;
        this._tableCx = rp.x + rp.w * 0.50;

        // 底部状态栏
        this._statusBar = {
            x: W * 0.015, y: H * 0.935,
            w: W * 0.970, h: H * 0.042,
        };

        // ── 参数旋钮行定义 ──
        this._paramRows = this._buildParamRows();

        // ── 模式按钮 ──
        this._modeBtns = this._buildModeBtns();

        // ── 控制按钮 ──
        this._ctrlBtns = this._buildCtrlBtns();

        // ── 仪表表盘（两个：频率表 + 幅值表）──
        this._meterFreq = {
            cx: this._meterZone.x + this._meterZone.w * 0.28,
            cy: this._meterZone.y + this._meterZone.h * 0.56,
            r: Math.min(this._meterZone.w * 0.22, this._meterZone.h * 0.42),
        };
        this._meterAmp = {
            cx: this._meterZone.x + this._meterZone.w * 0.72,
            cy: this._meterZone.y + this._meterZone.h * 0.56,
            r: Math.min(this._meterZone.w * 0.22, this._meterZone.h * 0.42),
        };
    }

    _buildParamRows() {
        const pz = this._paramZone;
        const H = this.height;
        const rowH = pz.h / 7.8;
        const rows = [
            { key: 'frequency', label: '频率 f', unit: 'Hz', min: 1, max: 2000, step: 1, dec: 1 },
            { key: 'amplitude', label: '幅值 A', unit: 'μm pk', min: 0.1, max: 5000, step: 1, dec: 1 },
            { key: 'sweepStart', label: '扫频起始', unit: 'Hz', min: 1, max: 1000, step: 1, dec: 0 },
            { key: 'sweepEnd', label: '扫频终止', unit: 'Hz', min: 10, max: 5000, step: 10, dec: 0 },
            { key: 'sweepRate', label: '扫频速率', unit: 'oct/min', min: 0.1, max: 10, step: 0.1, dec: 1 },
            { key: 'shockWidth', label: '冲击脉宽', unit: 'ms', min: 1, max: 100, step: 1, dec: 0 },
            { key: 'shockRepeat', label: '冲击周期', unit: 's', min: 0.5, max: 60, step: 0.5, dec: 1 },
        ];
        return rows.map((r, i) => ({
            ...r,
            x: pz.x, y: pz.y + 16 + rowH * i + H * 0.004,
            w: pz.w, h: rowH * 0.88,
        }));
    }

    _buildModeBtns() {
        const mz = this._modeZone;
        const W = this.width;
        const modes = [
            { key: 'sine', label: '简谐振动', sub: 'Sinusoidal' },
            { key: 'sweep', label: '扫频振动', sub: 'Freq Sweep' },
            { key: 'random', label: '随机振动', sub: 'Random' },
            { key: 'shock', label: '冲击激励', sub: 'Half-Sine' },
        ];
        const btnW = (mz.w - W * 0.008 * 3) / 4;
        return modes.map((m, i) => ({
            ...m,
            x: mz.x + (btnW + W * 0.008) * i,
            y: mz.y + this.height * 0.032,
            w: btnW,
            h: mz.h - this.height * 0.042,
        }));
    }

    _buildCtrlBtns() {
        const cz = this._ctrlZone;
        const H = this.height;
        const btnW = cz.w * 0.32;
        const btnH = cz.h * 0.36;
        const gap = cz.w * 0.08;
        return {
            stop: { x: cz.x + cz.w * 0.12, y: cz.y + H * 0.008, w: btnW, h: btnH, label: '■ STOP', color: '#c04020' },
            start: { x: cz.x + cz.w * 0.12 + btnW + gap, y: cz.y + H * 0.008, w: btnW, h: btnH, label: '▶ START', color: '#208040' },
        };
    }

    // ═══════════════════════════════════════════
    // 参数初始化
    // ═══════════════════════════════════════════

    _initParameters(config) {
        this.label = config.label || 'VTB-01';
        this.vibMode = config.vibMode || 'sine';
        this.frequency = config.frequency !== undefined ? config.frequency : 25;
        this.amplitude = config.amplitude !== undefined ? config.amplitude : 10;
        this.sweepStart = config.sweepStart !== undefined ? config.sweepStart : 10;
        this.sweepEnd = config.sweepEnd !== undefined ? config.sweepEnd : 200;
        this.sweepRate = config.sweepRate !== undefined ? config.sweepRate : 1.0;
        this.shockWidth = config.shockWidth !== undefined ? config.shockWidth : 11;
        this.shockRepeat = config.shockRepeat !== undefined ? config.shockRepeat : 2.0;

        // 内部状态
        this._running = false;
        this._time = 0;
        this._runTime = 0;
        this._cycleCount = 0;

        // 当前实时振动输出
        this._curFreq = 0;
        this._curAmp = 0;      // μm pk
        this._tableOffset = 0;      // 台面像素偏移
        this._tableVel = 0;      // 台面速度（平滑）

        // 扫频状态
        this._sweepF = this.sweepStart;
        this._sweepDir = 1;

        // 随机振动状态（多正弦叠加）
        this._randFreqs = Array.from({ length: 8 }, (_, i) => 10 * Math.pow(2, i * 0.5));
        this._randPhases = Array.from({ length: 8 }, () => Math.random() * 2 * Math.PI);
        this._randAmps = Array.from({ length: 8 }, () => 0.3 + Math.random() * 0.7);
        this._randOmegas = this._randFreqs.map(f => 2 * Math.PI * f);

        // 冲击状态
        this._shockTimer = 0;
        this._shockActive = false;

        // 参考值（基于当前参数计算）
        this._refDisp = 0;   // μm p-p
        this._refVel = 0;   // mm/s RMS
        this._refAcc = 0;   // m/s² pk

        // 旋钮调整 cooldown
        this._btnCooldown = 0;

        // redraw throttling (seconds)
        this._lastRedrawTime = 0;
        this._redrawInterval = 1 / 5; // limit to ~5 FPS redraws

        // broadcast throttling for connected meters
        this._broadcastTimer = 0;
        this._broadcastInterval = 0.5; // seconds (500ms)

        // cached displayed values to avoid unnecessary node updates
        this._paramPrevValues = {};
        this._needlePrevValues = {};
        this._statusPrevValues = {};

        // sweep cached params
        this._updateSweepCache();
        // 连接的被测仪表（外部注入）
        this._connectedMeters = [];
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
        this._drawOuterFrame();
        this._drawTitleBar();
        this._drawPanelLShell();
        this._drawPanelRShell();
        this._drawMeterZoneShell();
        this._drawModeZoneShell();
        this._drawParamZoneShell();
        this._drawRefZoneShell();
        this._drawCtrlZoneShell();
        this._drawShakerStaticParts();
        this._drawDivider();
    }

    // 整体外框
    _drawOuterFrame() {
        const f = this._outerFrame;
        this._staticGroup.add(new Konva.Rect({
            x: f.x, y: f.y, width: f.w, height: f.h,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint: { x: f.w, y: f.h },
            fillLinearGradientColorStops: [
                0, '#d0d4d8', 0.5, '#c4c8cc', 1, '#b8bcc0',
            ],
            stroke: '#808488', strokeWidth: 2,
            cornerRadius: f.rx,
            shadowColor: '#000', shadowBlur: 6, shadowOpacity: 0.4, shadowOffsetY: 2,
        }));
    }

    // 标题栏
    _drawTitleBar() {
        const t = this._titleBar;
        const W = this.width;
        this._staticGroup.add(new Konva.Rect({
            x: t.x, y: t.y, width: t.w, height: t.h,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint: { x: t.w, y: 0 },
            fillLinearGradientColorStops: [
                0, '#4a80b0', 0.4, '#5090c0', 0.7, '#4080b0', 1, '#306898',
            ],
            cornerRadius: [this._outerFrame.rx, this._outerFrame.rx, 0, 0],
        }));
        // 仪器名称
        this._staticGroup.add(new Konva.Text({
            x: t.x + W * 0.020, y: t.y,
            height: t.h,
            text: '振动测试台  VIBRATION TEST BENCH',
            fontSize: Math.max(12, W * 0.016),
            fontFamily: 'Arial', fontStyle: 'bold',
            fill: '#e8f0f8',
            verticalAlign: 'middle',
        }));
        // 型号
        this._staticGroup.add(new Konva.Text({
            x: t.x, y: t.y,
            width: t.w - W * 0.015, height: t.h,
            text: 'VTB-3000  |  频率: 1~2000 Hz  |  幅值: 0.1~5000 μm',
            fontSize: Math.max(12, W * 0.016),
            fontFamily: 'Arial',
            fill: '#c0dff0',
            align: 'right', verticalAlign: 'middle',
        }));
    }

    // 左侧面板外壳
    _drawPanelLShell() {
        const p = this._panelL;
        this._staticGroup.add(new Konva.Rect({
            x: p.x, y: p.y, width: p.w, height: p.h,
            fill: '#dce0e4',
            stroke: '#a8b0b8', strokeWidth: 1,
            cornerRadius: 4,
        }));
        // 面板标题
        this._staticGroup.add(new Konva.Text({
            x: p.x + 4, y: p.y + 2,
            text: '▌操作面板  CONTROL PANEL',
            fontSize: Math.max(10, this.width * 0.013),
            fontFamily: 'Arial', fontStyle: 'bold',
            fill: '#305878',
        }));
    }

    // 右侧振动台外壳
    _drawPanelRShell() {
        const p = this._panelR;
        this._staticGroup.add(new Konva.Rect({
            x: p.x, y: p.y, width: p.w, height: p.h,
            fill: '#d8dce0',
            stroke: '#a0a8b0', strokeWidth: 1,
            cornerRadius: 4,
        }));
        this._staticGroup.add(new Konva.Text({
            x: p.x + 4, y: p.y + 2,
            text: '▌振动台  SHAKER TABLE',
            fontSize: Math.max(10, this.width * 0.013),
            fontFamily: 'Arial', fontStyle: 'bold',
            fill: '#183040',
        }));
    }

    // 分隔竖线
    _drawDivider() {
        const H = this.height;
        this._staticGroup.add(new Konva.Line({
            points: [this._divX, H * 0.080, this._divX, H * 0.97],
            stroke: '#c0c4c8', strokeWidth: 1.5,
        }));
    }

    // 仪表区外框
    _drawMeterZoneShell() {
        const mz = this._meterZone;
        this._staticGroup.add(new Konva.Rect({
            x: mz.x, y: mz.y, width: mz.w, height: mz.h,
            fill: '#dce0e4', stroke: '#a0a8b0', strokeWidth: 1,
            cornerRadius: 4,
        }));
        this._staticGroup.add(new Konva.Text({
            x: mz.x + 4, y: mz.y + 2,
            text: '实时显示',
            fontSize: Math.max(7, this.width * 0.0125),
            fontFamily: 'Arial', fill: '#183040',
        }));
        // 两个表盘外框
        [this._meterFreq, this._meterAmp].forEach((m, i) => {
            this._staticGroup.add(new Konva.Circle({
                x: m.cx, y: m.cy, radius: m.r + 4,
                fillLinearGradientStartPoint: { x: -m.r, y: -m.r },
                fillLinearGradientEndPoint: { x: m.r, y: m.r },
                fillLinearGradientColorStops: [0, '#d0d4d8', 0.5, '#e0e4e8', 1, '#c0c4c8'],
                stroke: '#b0b8c0', strokeWidth: 0.5,
            }));
            this._staticGroup.add(new Konva.Circle({
                x: m.cx, y: m.cy, radius: m.r,
                fill: '#f8fafc',
                stroke: '#d0d4d8', strokeWidth: 0.5,
            }));
            // 表盘刻度
            this._drawMeterScale(m, i === 0);
        });
        // 标签
        const labels = ['频率 FREQ (Hz)', '幅值 AMP (μm)'];
        [this._meterFreq, this._meterAmp].forEach((m, i) => {
            this._staticGroup.add(new Konva.Text({
                x: m.cx - m.r, y: m.cy + m.r * 0.55,
                width: m.r * 2,
                text: labels[i],
                fontSize: Math.min(8, this.width * 0.0115),
                fontFamily: 'Arial', fill: '#183848', align: 'center',
            }));
        });
    }

    // 表盘刻度
    _drawMeterScale(m, isFreq) {
        const ticks = 10;
        const aStart = Math.PI * 0.75, aEnd = Math.PI * 2.25;
        const span = aEnd - aStart;
        for (let i = 0; i <= ticks; i++) {
            const angle = aStart + span * (i / ticks);
            const isMajor = (i % 2 === 0);
            const r1 = m.r * (isMajor ? 0.68 : 0.78);
            const r2 = m.r * 0.92;
            this._staticGroup.add(new Konva.Line({
                points: [
                    m.cx + Math.cos(angle) * r1, m.cy + Math.sin(angle) * r1,
                    m.cx + Math.cos(angle) * r2, m.cy + Math.sin(angle) * r2,
                ],
                stroke: isMajor ? '#305878' : '#8090a0',
                strokeWidth: isMajor ? 1.2 : 0.7,
            }));
        }
    }

    // 模式区外框
    _drawModeZoneShell() {
        const mz = this._modeZone;
        this._staticGroup.add(new Konva.Rect({
            x: mz.x, y: mz.y, width: mz.w, height: mz.h,
            fill: '#dce0e4', stroke: '#a0a8b0', strokeWidth: 1,
            cornerRadius: 4,
        }));
        this._staticGroup.add(new Konva.Text({
            x: mz.x + 4, y: mz.y + 2,
            text: '振动模式',
            fontSize: Math.max(7, this.width * 0.0125),
            fontFamily: 'Arial', fill: '#183040',
        }));
    }

    // 参数区外框
    _drawParamZoneShell() {
        const pz = this._paramZone;
        this._staticGroup.add(new Konva.Rect({
            x: pz.x, y: pz.y, width: pz.w, height: pz.h,
            fill: '#dce0e4', stroke: '#a0a8b0', strokeWidth: 1,
            cornerRadius: 4,
        }));
        this._staticGroup.add(new Konva.Text({
            x: pz.x + 4, y: pz.y + 2,
            text: '参数设置',
            fontSize: Math.max(7, this.width * 0.0125),
            fontFamily: 'Arial', fill: '#183040',
        }));
    }

    // 量值基准区外框
    _drawRefZoneShell() {
        const rz = this._refZone;
        this._staticGroup.add(new Konva.Rect({
            x: rz.x, y: rz.y, width: rz.w, height: rz.h,
            fill: '#d0d4d8', stroke: '#a0a8b0', strokeWidth: 1,
            cornerRadius: 4,
        }));
        this._staticGroup.add(new Konva.Text({
            x: rz.x + 4, y: rz.y + 2,
            text: '量值基准（理论参考值）',
            fontSize: Math.max(7, this.width * 0.0125),
            fontFamily: 'Arial', fill: '#182838',
        }));
    }

    // 控制按钮区外框
    _drawCtrlZoneShell() {
        const cz = this._ctrlZone;
        this._staticGroup.add(new Konva.Rect({
            x: cz.x, y: cz.y, width: cz.w, height: cz.h,
            fill: '#dce0e4', stroke: '#a0a8b0', strokeWidth: 1,
            cornerRadius: 4,
        }));
    }

    // 振动台静态部件
    _drawShakerStaticParts() {
        // 基座
        const b = this._shakerBase;
        this._staticGroup.add(new Konva.Rect({
            x: b.x, y: b.y, width: b.w, height: b.h,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint: { x: 0, y: b.h },
            fillLinearGradientColorStops: [0, '#c0c4c8', 0.5, '#b0b4b8', 1, '#a0a4a8'],
            stroke: '#b0b4b8', strokeWidth: 1.5,
            cornerRadius: 6,
            shadowColor: '#000', shadowBlur: 8, shadowOpacity: 0.5, shadowOffsetY: 3,
        }));

        // 调平螺钉（基座四角）
        [b.x + b.w * 0.10, b.x + b.w * 0.90].forEach(sx => {
            const sy = b.y + b.h * 0.50;
            this._staticGroup.add(new Konva.Circle({ x: sx, y: sy, radius: this.width * 0.012, fill: '#b0b4b8', stroke: '#909498', strokeWidth: 0.8 }));
            this._staticGroup.add(new Konva.Line({ points: [sx - this.width * 0.007, sy, sx + this.width * 0.007, sy], stroke: '#909498', strokeWidth: 1 }));
            this._staticGroup.add(new Konva.Line({ points: [sx, sy - this.width * 0.007, sx, sy + this.width * 0.007], stroke: '#909498', strokeWidth: 1 }));
        });

        // 隔振垫（橡胶，深色条纹）
        const ip = this._isolationPad;
        this._staticGroup.add(new Konva.Rect({
            x: ip.x, y: ip.y, width: ip.w, height: ip.h,
            fill: '#94a7ba', stroke: '#404448', strokeWidth: 1, cornerRadius: 2,
        }));
        for (let i = 0; i < 8; i++) {
            const lx = ip.x + ip.w * (i / 8 + 0.06);
            this._staticGroup.add(new Konva.Line({
                points: [lx, ip.y + 2, lx, ip.y + ip.h - 2],
                stroke: '#181c20', strokeWidth: ip.w / 8 * 0.4,
            }));
        }

        // 激振器主体（圆柱形磁钢外壳）
        const sh = this._shakerBody;
        this._staticGroup.add(new Konva.Rect({
            x: sh.cx - sh.w / 2, y: sh.y, width: sh.w, height: sh.h,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint: { x: sh.w, y: 0 },
            fillLinearGradientColorStops: [
                0, '#303438', 0.15, '#606870', 0.50, '#808a98',
                0.85, '#606870', 1, '#303438',
            ],
            stroke: '#505860', strokeWidth: 1.5,
            cornerRadius: 6,
            shadowColor: '#000', shadowBlur: 6, shadowOpacity: 0.4,
        }));

        // 激振器顶部磁极盖
        this._staticGroup.add(new Konva.Rect({
            x: sh.cx - sh.w * 0.40, y: sh.y,
            width: sh.w * 0.80, height: this.height * 0.018,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint: { x: sh.w * 0.80, y: 0 },
            fillLinearGradientColorStops: [0, '#808890', 0.5, '#c0c8d0', 1, '#808890'],
            stroke: '#606068', strokeWidth: 0.8, cornerRadius: 3,
        }));

        // 激振器铭牌
        this._staticGroup.add(new Konva.Rect({
            x: sh.cx - sh.w * 0.20, y: sh.y + sh.h * 0.15,
            width: sh.w * 0.40, height: this.height * 0.052,
            fill: '#c8a830', cornerRadius: 2,
        }));
        this._staticGroup.add(new Konva.Text({
            x: sh.cx - sh.w * 0.20, y: sh.y + sh.h * 0.18,
            width: sh.w * 0.40, height: this.height * 0.048,
            text: 'SHAKER\nEM-500N',
            fontSize: Math.max(5, this.width * 0.011),
            fontFamily: 'Arial', fontStyle: 'bold',
            fill: '#2a1800', align: 'center', verticalAlign: 'middle',
        }));

        // 线圈散热孔（点阵）
        for (let row = 0; row < 3; row++) {
            for (let col = 0; col < 6; col++) {
                const hx = sh.cx - sh.w * 0.36 + sh.w * 0.15 * col;
                const hy = sh.y + sh.h * 0.58 + this.height * 0.018 * row;
                this._staticGroup.add(new Konva.Ellipse({
                    x: hx, y: hy, radiusX: this.width * 0.007, radiusY: this.height * 0.006,
                    fill: '#181c20', stroke: '#404448', strokeWidth: 0.5,
                }));
            }
        }

        // 导向柱（静态部分）
        this._guideCols.forEach(gc => {
            this._staticGroup.add(new Konva.Rect({
                x: gc.x - gc.w / 2, y: gc.yTop, width: gc.w, height: gc.h,
                fillLinearGradientStartPoint: { x: 0, y: 0 },
                fillLinearGradientEndPoint: { x: gc.w, y: 0 },
                fillLinearGradientColorStops: [0, '#404448', 0.3, '#8090a0', 0.7, '#708090', 1, '#404448'],
                stroke: '#303438', strokeWidth: 0.5,
                cornerRadius: gc.w * 0.3,
            }));
        });

        // 导向柱顶端固定板（在台面上方，安装区域下缘）
        const rp = this._panelR;
        this._staticGroup.add(new Konva.Rect({
            x: rp.x + rp.w * 0.12, y: rp.y + rp.h * 0.64,
            width: rp.w * 0.76, height: this.height * 0.016,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint: { x: rp.w * 0.76, y: 0 },
            fillLinearGradientColorStops: [0, '#505460', 0.5, '#7880a0', 1, '#505460'],
            stroke: '#404450', strokeWidth: 1,
            cornerRadius: 3,
        }));
    }

    // ═══════════════════════════════════════════
    // 动态层
    // ═══════════════════════════════════════════

    _rebuildDynamic() {
        this._dynamicGroup.destroyChildren();
        // reset caches for frequently-updated nodes
        this._needleNodes = {};
        this._paramValNodes = {};
        this._statusNodes = {};

        this._drawShakerDynamic();
        this._drawModeBtns();
        this._drawParamRows();
        this._drawRefValues();
        this._drawCtrlButtons();
        this._drawStatusLEDs();
        this._drawStatusBar();
        this._drawNeedles();
    }

    _drawNeedles() {
        [{ key: 'freq', max: 2000, meter: this._meterFreq },
        { key: 'amp', max: 500, meter: this._meterAmp }].forEach(({ key, max, meter: m }) => {
            const g = new Konva.Group({ name: `needle_${key}` });
            const hub = new Konva.Circle({
                x: 0, y: 0, radius: m.r * 0.08,
                fill: '#c0c8d0', stroke: '#808890', strokeWidth: 0.8,
            });
            const line = new Konva.Line({
                points: [0, 0, 0, 0], stroke: '#e03020',
                strokeWidth: Math.min(1.2, this.width * 0.006),
                lineCap: 'round',
            });
            g.add(hub);
            g.add(line);
            this._dynamicGroup.add(g);

            const readout = new Konva.Text({
                x: m.cx - m.r * 0.55, y: m.cy - m.r * 0.05,
                width: m.r * 1.10, text: '',
                fontSize: Math.min(10, this.width * 0.015),
                fontFamily: 'Courier New', fontStyle: 'bold', fill: '#305878',
                align: 'center',
            });
            this._dynamicGroup.add(readout);

            // cache references for per-frame updates to avoid findOne
            this._needleNodes[key] = { group: g, line, readout, meter: m, max };
        });
    }

    _updateAnimShapes() {
        const running = this._running;
        // 指针
        const drawNeedle = (m, value, maxVal, name) => {
            const cached = this._needleNodes && this._needleNodes[name];
            if (!cached) return;
            const { line, readout, meter } = cached;
            const aStart = Math.PI * 0.75, aEnd = Math.PI * 2.25;
            const span = aEnd - aStart;
            const norm = Math.max(0, Math.min(1, value / maxVal));
            const angle = aStart + span * norm;
            const len = meter.r * 0.80;
            const cos = Math.cos(angle), sin = Math.sin(angle);
            const cx = meter.cx, cy = meter.cy;
            line.points([
                cx - cos * meter.r * 0.14, cy - sin * meter.r * 0.14,
                cx + cos * len, cy + sin * len,
            ]);
            const dispVal = value < 10 ? value.toFixed(2) : (value < 100 ? value.toFixed(1) : Math.round(value).toString());
            readout.text(dispVal);
            readout.fill(value > 0 ? '#305878' : '#a0a8b0');
            cached.group.x(0); cached.group.y(0);
        };
        const freqVal = running ? (this._curFreq || this.frequency) : 0;
        const ampVal = running ? this.amplitude : 0;
        drawNeedle(this._meterFreq, freqVal, 2000, 'freq');
        drawNeedle(this._meterAmp, ampVal, 500, 'amp');

        // 导向棒微振动（幅度缩小到台面偏移的 8%，微微颤动即可）
        if (this._guideNode) {
            this._guideNode.y(this._tableOffset * 0.8);
        }

        // 参数数值（使用缓存的文本节点，避免 findOne 每帧搜索）
        this._paramRows.forEach(row => {
            const node = this._paramValNodes && this._paramValNodes[row.key];
            if (node) {
                const d = running ? this[row.key] : 0;
                const txt = d.toFixed(row.dec);
                if (this._paramPrevValues[row.key] !== txt) {
                    node.text(txt);
                    this._paramPrevValues[row.key] = txt;
                }
                node.fill(running ? '#004080' : '#405060');
            }
        });

        // update status bar fields if present
        if (this._statusNodes) {
            const statusValues = {
                runTime: this._fmtRunTime(),
                cycleCount: `${this._cycleCount}`,
                mode: this._getModeLabel(),
                curFreq: this._running ? `${this._curFreq.toFixed(1)} Hz` : '--- Hz',
                curAmp: this._running ? `${this._curAmp.toFixed(1)} μm` : '--- μm',
                state: this._running ? 'RUNNING' : 'STANDBY',
            };
            Object.keys(statusValues).forEach(k => {
                const node = this._statusNodes[k];
                if (!node) return;
                const v = statusValues[k];
                if (this._statusPrevValues[k] !== v) {
                    node.text(v);
                    this._statusPrevValues[k] = v;
                }
            });
        }
    }

    // ── 模式按钮 ──────────────────────────────

    _drawModeBtns() {
        const modeColors = { sine: '#1a70b0', sweep: '#1a8050', random: '#806020', shock: '#802020' };
        const modeActive = { sine: '#2090e0', sweep: '#28b060', random: '#c09030', shock: '#d03030' };

        this._modeBtns.forEach(btn => {
            const active = this.vibMode === btn.key;
            const col = active ? modeActive[btn.key] : modeColors[btn.key];

            this._dynamicGroup.add(new Konva.Rect({
                x: btn.x, y: btn.y, width: btn.w, height: btn.h,
                fillLinearGradientStartPoint: { x: 0, y: 0 },
                fillLinearGradientEndPoint: { x: 0, y: btn.h },
                fillLinearGradientColorStops: active
                    ? [0, col + 'ff', 1, col + 'dd']
                    : [0, '#c8ccd0', 1, '#b0b8c0'],
                stroke: active ? col : '#909898',
                strokeWidth: active ? 1.5 : 0.8,
                cornerRadius: 4,
            }));

            this._dynamicGroup.add(new Konva.Text({
                x: btn.x, y: btn.y + btn.h * 0.10,
                width: btn.w, height: btn.h * 0.46,
                text: btn.label,
                fontSize: Math.min(12, this.width * 0.016),
                fontFamily: 'Arial', fontStyle: 'bold',
                fill: active ? '#ffffff' : '#506880',
                align: 'center', verticalAlign: 'middle',
            }));
            this._dynamicGroup.add(new Konva.Text({
                x: btn.x, y: btn.y + btn.h * 0.56,
                width: btn.w, height: btn.h * 0.36,
                text: btn.sub,
                fontSize: Math.max(6.5, this.width * 0.012),
                fontFamily: 'Arial',
                fill: active ? '#c0e8ff' : '#384858',
                align: 'center', verticalAlign: 'middle',
            }));
        });
    }

    // ── 参数行 ────────────────────────────────

    _drawParamRows() {
        const W = this.width, H = this.height;
        const activeKeys = {
            sine: ['frequency', 'amplitude'],
            sweep: ['amplitude', 'sweepStart', 'sweepEnd', 'sweepRate'],
            random: ['amplitude'],
            shock: ['amplitude', 'shockWidth', 'shockRepeat'],
        };
        const active = activeKeys[this.vibMode] || [];

        this._paramRows.forEach(row => {
            const isActive = active.includes(row.key);
            const val = this[row.key];

            // 行背景
            this._dynamicGroup.add(new Konva.Rect({
                x: row.x + 2, y: row.y, width: row.w - 4, height: row.h,
                fill: isActive ? '#d4d8dc' : '#c8ccd0',
                cornerRadius: 3,
                stroke: isActive ? '#b0b8c0' : '#a8b0b8', strokeWidth: 0.8,
            }));

            // 标签
            const lblW = W * 0.065;
            this._dynamicGroup.add(new Konva.Text({
                x: row.x + W * 0.012, y: row.y,
                width: lblW, height: row.h,
                text: row.label,
                fontSize: Math.max(7, W * 0.015),
                fontFamily: 'Arial',
                fill: isActive ? '#1a3040' : '#283848',
                verticalAlign: 'middle',
            }));

            // 数值显示框
            const valBoxX = row.x + W * 0.080;
            const valBoxW = W * 0.075;
            this._dynamicGroup.add(new Konva.Rect({
                x: valBoxX, y: row.y + row.h * 0.12,
                width: valBoxW, height: row.h * 0.76,
                fill: '#f8fafc',
                stroke: isActive ? '#6090b0' : '#a8b0b8', strokeWidth: 0.8,
                cornerRadius: 2,
            }));
            const dispVal = this._running ? val : 0;
            const valNode = new Konva.Text({
                x: valBoxX, y: row.y + row.h * 0.12,
                width: valBoxW, height: row.h * 0.76,
                text: dispVal.toFixed(row.dec),
                fontSize: Math.max(8, W * 0.018),
                fontFamily: 'Courier New', fontStyle: 'bold',
                fill: isActive && this._running ? '#004080' : '#405060',
                align: 'center', verticalAlign: 'middle',
            });
            this._dynamicGroup.add(valNode);
            // cache reference for fast updates
            this._paramValNodes[row.key] = valNode;

            // 单位（在按钮右侧）
            this._dynamicGroup.add(new Konva.Text({
                x: row.x + row.w - W * 0.048, y: row.y,
                width: W * 0.048, height: row.h,
                text: row.unit,
                fontSize: Math.max(6, W * 0.012),
                fontFamily: 'Arial',
                fill: isActive ? '#284860' : '#1a2830',
                verticalAlign: 'middle',
            }));

            // ▼ ▲ 微调按钮（在值框右侧）
            if (isActive) {
                const btnSize = row.h * 0.78;
                const b2x = row.x + row.w - W * 0.072;
                const b1x = b2x - W * 0.024;

                [[-1, '−', b1x], [+1, '+', b2x]].forEach(([dir, sym, bx]) => {
                    this._dynamicGroup.add(new Konva.Rect({
                        x: bx, y: row.y + row.h * 0.11,
                        width: W * 0.020, height: btnSize,
                        fill: '#d0d4d8', stroke: '#a0a8b0', strokeWidth: 0.8,
                        cornerRadius: 2,
                        id: `adj_${row.key}_${dir}`,
                    }));
                    this._dynamicGroup.add(new Konva.Text({
                        x: bx, y: row.y + row.h * 0.11,
                        width: W * 0.020, height: btnSize,
                        text: sym,
                        fontSize: Math.max(7, W * 0.015),
                        fontFamily: 'Arial', fontStyle: 'bold',
                        fill: '#305878',
                        align: 'center', verticalAlign: 'middle',
                        listening: false,
                    }));
                });

                // 扫频时显示当前扫描频率
                if (row.key === 'frequency' && this.vibMode === 'sweep' && this._running) {
                    this._dynamicGroup.add(new Konva.Text({
                        x: valBoxX, y: row.y + row.h * 0.12,
                        width: valBoxW, height: row.h * 0.76,
                        text: `→${this._sweepF.toFixed(1)}`,
                        fontSize: Math.max(5.5, W * 0.012),
                        fontFamily: 'Courier New',
                        fill: '#1a8050',
                        align: 'right', verticalAlign: 'bottom',
                    }));
                }
            }
        });
    }

    // ── 量值基准 ──────────────────────────────

    _drawRefValues() {
        const rz = this._refZone;
        const W = this.width, H = this.height;
        const lineH = (rz.h - H * 0.016) / 3;

        const rows = [
            { label: '参考位移', value: this._refDisp.toFixed(1), unit: 'μm p-p', color: '#40ffb0' },
            { label: '参考速度', value: this._refVel.toFixed(3), unit: 'mm/s RMS', color: '#40d8ff' },
            { label: '参考加速', value: this._refAcc.toFixed(4), unit: 'm/s² pk', color: '#ffb840' },
        ];

        rows.forEach((r, i) => {
            const y = rz.y + H * 0.022 + lineH * i;

            this._dynamicGroup.add(new Konva.Text({
                x: rz.x + W * 0.010, y,
                width: W * 0.076, height: lineH,
                text: r.label,
                fontSize: Math.max(12, W * 0.0125),
                fontFamily: 'Arial',
                fill: '#384858',
                verticalAlign: 'middle',
            }));

            // 数值背景
            this._dynamicGroup.add(new Konva.Rect({
                x: rz.x + W * 0.090, y: y + lineH * 0.10,
                width: W * 0.090, height: lineH * 0.80,
                fill: '#c8ccd0', stroke: '#a8b0b8', strokeWidth: 0.6,
                cornerRadius: 2,
            }));

            this._dynamicGroup.add(new Konva.Text({
                x: rz.x + W * 0.090, y: y + lineH * 0.10,
                width: W * 0.090, height: lineH * 0.80,
                text: r.value,
                fontSize: Math.max(8, W * 0.016),
                fontFamily: 'Courier New', fontStyle: 'bold',
                fill: this._running ? r.color : '#284058',
                align: 'right', verticalAlign: 'middle',
            }));

            this._dynamicGroup.add(new Konva.Text({
                x: rz.x + W * 0.184, y,
                width: W * 0.060, height: lineH,
                text: r.unit,
                fontSize: Math.max(10, W * 0.0105),
                fontFamily: 'Arial',
                fill: '#2a4860',
                verticalAlign: 'middle',
            }));
        });
    }

    // ── 控制按钮 ──────────────────────────────

    _drawCtrlButtons() {
        const btns = this._ctrlBtns;
        Object.entries(btns).forEach(([key, btn]) => {
            const isActive = (key === 'start' && this._running) ||
                (key === 'stop' && !this._running);
            const col = btn.color;

            this._dynamicGroup.add(new Konva.Rect({
                x: btn.x, y: btn.y, width: btn.w, height: btn.h,
                fillLinearGradientStartPoint: { x: 0, y: 0 },
                fillLinearGradientEndPoint: { x: 0, y: btn.h },
                fillLinearGradientColorStops: isActive
                    ? [0, col + 'ff', 0.5, col + 'dd', 1, col + 'aa']
                    : [0, '#c8ccd0', 1, '#b0b8c0'],
                stroke: isActive ? col : '#909898',
                strokeWidth: 1,
                cornerRadius: 4,
            }));

            this._dynamicGroup.add(new Konva.Text({
                x: btn.x, y: btn.y,
                width: btn.w, height: btn.h,
                text: btn.label,
                fontSize: Math.max(8, this.width * 0.015),
                fontFamily: 'Arial', fontStyle: 'bold',
                fill: isActive ? '#ffffff' : '#406880',
                align: 'center', verticalAlign: 'middle',
            }));
        });
    }

    // ── 状态指示灯 ───────────────────────────

    _drawStatusLEDs() {
        const cz = this._ctrlZone;
        const W = this.width, H = this.height;
        const leds = [
            { label: 'POWER', color: '#26e846', on: true },
            { label: 'RUN', color: '#51c765', on: this._running },
            { label: 'SYNC', color: '#12adfb', on: this._running },
        ];
        const ledR = Math.max(4, W * 0.010);
        const ledY = cz.y + cz.h * 0.58;
        const ledSpacing = cz.w / (leds.length + 1);

        leds.forEach((led, i) => {
            const lx = cz.x + ledSpacing * (i + 1);
            this._dynamicGroup.add(new Konva.Circle({
                x: lx, y: ledY, radius: ledR,
                fill: led.on ? led.color : '#b0b8c0',
                stroke: led.on ? led.color : '#9098a0',
                strokeWidth: 0.8,
            }));
            this._dynamicGroup.add(new Konva.Text({
                x: lx - W * 0.025, y: ledY + ledR + 1,
                width: W * 0.050,
                text: led.label,
                fontSize: Math.max(4.5, W * 0.009),
                fontFamily: 'Arial',
                fill: led.on ? '#010e16' : '#304050',
                align: 'center',
            }));
        });
    }

    // ── 振动台动态部件 ───────────────────────

    _drawShakerDynamic() {
        const tableBaseY = this._tableBaseY;

        // 导向棒 — 两细柱随振动微幅上下抖动
        const guideGroup = new Konva.Group({ name: 'guide_rods' });
        this._guideCols.forEach(gc => {
            guideGroup.add(new Konva.Rect({
                x: gc.x - 3.5, y: gc.yTop,
                width: 8, height: gc.h,
                fill: '#ed2d06',
                stroke: '#687080', strokeWidth: 0.5,
                cornerRadius: 1,
                opacity: 0.5,
            }));
        });
        this._dynamicGroup.add(guideGroup);
        this._guideNode = guideGroup;

        // 台面"被测仪表放置区"示意
        this._drawMeterMountHint(tableBaseY, this._tableW, this._tableH, this._tableCx);
    }

    // 被测仪表放置提示区（最大化，占右面板上半部分约 50%）
    _drawMeterMountHint(tableY, tableW, tableH, tableCx) {
        const W = this.width, H = this.height;
        const rp = this._panelR;
        const margin = Math.max(8, W * 0.012);
        const topY = rp.y + margin;
        const botY = this._tableBaseY - this._tableH / 2 - margin;
        const hintH = Math.max(botY - topY, 60);
        const hintW = Math.min(tableW * 1.6, rp.w * 0.85);
        const hintX = tableCx - hintW / 2;
        const hintY = topY;

        // 虚线框（被测仪表安装区）
        this._dynamicGroup.add(new Konva.Rect({
            x: hintX, y: hintY, width: hintW, height: hintH,
            fill: this._running ? 'rgba(30,70,100,0.20)' : 'rgba(20,50,70,0.12)',
            stroke: '#3a68a0',
            strokeWidth: 1.5,
            dash: [10, 6],
            cornerRadius: 8,
        }));

        // 内圈虚线装饰
        this._dynamicGroup.add(new Konva.Rect({
            x: hintX + 10, y: hintY + 10,
            width: hintW - 20, height: hintH - 20,
            stroke: '#2a5078',
            strokeWidth: 0.8,
            dash: [5, 4],
            cornerRadius: 6,
        }));

        // 安装区域标题
        this._dynamicGroup.add(new Konva.Text({
            x: hintX, y: hintY + hintH * 0.12,
            width: hintW, height: hintH * 0.30,
            text: '被测振动仪安装区域',
            fontSize: Math.min(16, W * 0.026),
            fontFamily: 'Arial', fontStyle: 'bold',
            fill: '#3080b8',
            align: 'center', verticalAlign: 'middle',
        }));

        // 安装区中心十字标记
        const cx = tableCx, cy = hintY + hintH * 0.68;
        const crossSize = Math.max(10, W * 0.015);
        this._dynamicGroup.add(new Konva.Line({
            points: [cx - crossSize, cy, cx + crossSize, cy],
            stroke: '#305880', strokeWidth: 0.8,
            dash: [3, 3],
        }));
        this._dynamicGroup.add(new Konva.Line({
            points: [cx, cy - crossSize, cx, cy + crossSize],
            stroke: '#305880', strokeWidth: 0.8,
            dash: [3, 3],
        }));
    }

    // ── 状态栏 ────────────────────────────────

    _drawStatusBar() {
        const sb = this._statusBar;
        const W = this.width;
        this._dynamicGroup.add(new Konva.Rect({
            x: sb.x, y: sb.y, width: sb.w, height: sb.h,
            fill: '#c8ccd0', stroke: '#a8b0b8', strokeWidth: 0.8,
            cornerRadius: 3,
        }));

        const items = [
            { key: 'runTime', label: '运行时间', value: this._fmtRunTime() },
            { key: 'cycleCount', label: '循环次数', value: `${this._cycleCount}` },
            { key: 'mode', label: '当前模式', value: this._getModeLabel() },
            { key: 'curFreq', label: '当前频率', value: this._running ? `${this._curFreq.toFixed(1)} Hz` : '--- Hz' },
            { key: 'curAmp', label: '当前幅值', value: this._running ? `${this.amplitude.toFixed(1)} μm` : '--- μm' },
            { key: 'state', label: '状态', value: this._running ? 'RUNNING' : 'STANDBY' },
        ];
        const colW = sb.w / items.length;

        items.forEach((item, i) => {
            const ix = sb.x + colW * i + colW * 0.05;
            const isStatus = item.label === '状态';
            const statusColor = this._running ? '#208050' : '#507080';

            if (i > 0) {
                this._dynamicGroup.add(new Konva.Line({
                    points: [sb.x + colW * i, sb.y + 3, sb.x + colW * i, sb.y + sb.h - 3],
                    stroke: '#b0b4b8', strokeWidth: 0.7,
                }));
            }

            this._dynamicGroup.add(new Konva.Text({
                x: ix, y: sb.y + 2,
                width: colW * 0.90,
                text: item.label,
                fontSize: Math.max(6, W * 0.012),
                fontFamily: 'Arial',
                fill: '#2a3a48', align: 'center',
            }));
            const valNode = new Konva.Text({
                x: ix, y: sb.y + sb.h * 0.60,
                width: colW * 0.90,
                text: item.value,
                fontSize: Math.max(7, W * 0.014),
                fontFamily: 'Courier New', fontStyle: 'bold',
                fill: isStatus ? statusColor : '#183848',
                align: 'center',
            });
            this._dynamicGroup.add(valNode);
            // cache status field node for updates
            if (this._statusNodes) this._statusNodes[item.key] = valNode;
        });

    }

    // ═══════════════════════════════════════════
    // 工具函数
    // ═══════════════════════════════════════════

    _fmtRunTime() {
        const t = Math.floor(this._runTime);
        const h = Math.floor(t / 3600);
        const m = Math.floor((t % 3600) / 60);
        const s = t % 60;
        return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    }

    _getModeLabel() {
        return { sine: '简谐', sweep: '扫频', random: '随机', shock: '冲击' }[this.vibMode] || '---';
    }

    /** 正弦振动理论参考值计算 */
    _calcRefValues(A_um, f_Hz) {
        if (A_um <= 0 || f_Hz <= 0) return { disp: 0, vel: 0, acc: 0 };
        const w = 2 * Math.PI * f_Hz;
        const disp = 2 * A_um;                         // μm p-p
        const vel = (w * A_um * 1e-3) / Math.SQRT2;  // mm/s RMS
        const acc = w * w * A_um * 1e-6;              // m/s² pk
        return { disp, vel, acc };
    }

    _updateSweepCache() {
        try {
            this._sweepLogStart = Math.log2(this.sweepStart);
            this._sweepLogEnd = Math.log2(this.sweepEnd);
            this._sweepLogSpan = this._sweepLogEnd - this._sweepLogStart;
            this._sweepT_oct = (this.sweepRate > 0) ? (60 / this.sweepRate) : Infinity;
        } catch (e) {
            this._sweepLogStart = 0; this._sweepLogEnd = 0; this._sweepLogSpan = 0; this._sweepT_oct = Infinity;
        }
    }

    /** 当前时刻振动位移（μm，正弦叠加） */
    _calcInstDisp(t) {
        if (!this._running) return 0;

        switch (this.vibMode) {

            case 'sine': {
                const noise = 1 + (Math.random() - 0.5) * 0.010;
                return this.amplitude * Math.sin(2 * Math.PI * this.frequency * t) * noise;
            }

            case 'sweep': {
                // use cached sweep parameters to reduce per-frame logs
                const T_oct = this._sweepT_oct || (this.sweepRate > 0 ? 60 / this.sweepRate : Infinity);
                const logStart = this._sweepLogStart !== undefined ? this._sweepLogStart : Math.log2(this.sweepStart);
                const logSpan = this._sweepLogSpan !== undefined ? this._sweepLogSpan : (Math.log2(this.sweepEnd) - logStart);
                const elapsed = (t % (T_oct * logSpan));
                const logF = logStart + (elapsed / (T_oct * logSpan)) * logSpan;
                this._sweepF = Math.pow(2, logF);
                return this.amplitude * Math.sin(2 * Math.PI * this._sweepF * t);
            }

            case 'random': {
                let x = 0;
                const omegas = this._randOmegas || this._randFreqs.map(f => 2 * Math.PI * f);
                this._randFreqs.forEach((f, i) => {
                    x += this._randAmps[i] * this.amplitude * 0.35 * Math.sin(omegas[i] * t + this._randPhases[i]);
                });
                x += (Math.random() - 0.5) * this.amplitude * 0.15;
                return x;
            }

            case 'shock': {
                const tau = this.shockWidth * 1e-3;   // ms → s
                const cycle = this.shockRepeat;
                const tMod = t % cycle;
                this._shockActive = tMod < tau;
                if (this._shockActive) {
                    return this.amplitude * Math.sin(Math.PI * tMod / tau);
                }
                return 0;
            }

            default: return 0;
        }
    }

    // ═══════════════════════════════════════════
    // 交互绑定
    // ═══════════════════════════════════════════

    _bindInteraction() {
        const hitArea = new Konva.Rect({
            x: this._outerFrame.x, y: this._outerFrame.y,
            width: this._outerFrame.w, height: this._outerFrame.h,
            fill: 'transparent',
        });

        hitArea.on('click tap', (e) => {
            if (this._btnCooldown > 0) return;
            this._btnCooldown = 0.15;

            const stage = e.target.getStage();
            const pos = stage.getPointerPosition();

            // 将 stage 坐标转为本组件局部坐标（_node 未定义，改用 group 转换）
            const groupX = this.group?.x?.() || 0;
            const groupY = this.group?.y?.() || 0;
            const lx = pos.x - groupX;
            const ly = pos.y - groupY;

            // 控制按钮
            const ctrlBtns = this._ctrlBtns;
            for (const [key, btn] of Object.entries(ctrlBtns)) {
                if (lx >= btn.x && lx <= btn.x + btn.w && ly >= btn.y && ly <= btn.y + btn.h) {
                    this._handleCtrl(key);
                    return;
                }
            }

            // 模式按钮
            for (const btn of this._modeBtns) {
                if (lx >= btn.x && lx <= btn.x + btn.w && ly >= btn.y && ly <= btn.y + btn.h) {
                    this.vibMode = btn.key;
                    return;
                }
            }

            // 参数 +/- 按钮
            const activeKeys = {
                sine: ['frequency', 'amplitude'],
                sweep: ['amplitude', 'sweepStart', 'sweepEnd', 'sweepRate'],
                random: ['amplitude'],
                shock: ['amplitude', 'shockWidth', 'shockRepeat'],
            };
            const active = activeKeys[this.vibMode] || [];

            for (const row of this._paramRows) {
                if (!active.includes(row.key)) continue;
                const b2x = row.x + row.w - this.width * 0.072;
                const b1x = b2x - this.width * 0.024;
                const by = row.y + row.h * 0.11;
                const bh = row.h * 0.78;
                const bw = this.width * 0.020;

                if (ly >= by && ly <= by + bh) {
                    if (lx >= b1x && lx <= b1x + bw) { this._adjustParam(row, -1); return; }
                    if (lx >= b2x && lx <= b2x + bw) { this._adjustParam(row, +1); return; }
                }
            }
        });

        this._interactGroup.add(hitArea);
    }

    _handleCtrl(key) {
        switch (key) {
            case 'start':
                this.frequency = 25;
                this.amplitude = 10;
                this._running = true;
                this._sweepF = this.sweepStart;
                this._shockTimer = 0;
                break;
            case 'stop':
                this._running = false;
                this._curFreq = 0; this._curAmp = 0;
                this._tableOffset = 0;
                break;
        }
    }

    _adjustParam(row, dir) {
        const cur = this[row.key];
        const next = Math.max(row.min, Math.min(row.max, +(cur + dir * row.step).toFixed(row.dec)));
        this[row.key] = next;
        // 更新参考值
        const ref = this._calcRefValues(this.amplitude, this.frequency);
        this._refDisp = ref.disp; this._refVel = ref.vel; this._refAcc = ref.acc;
        // update sweep cache if sweep-related params changed
        if (['sweepStart', 'sweepEnd', 'sweepRate'].includes(row.key)) this._updateSweepCache();
        this._rebuildDynamic();
    }

    // ═══════════════════════════════════════════
    // tick
    // ═══════════════════════════════════════════

    tick(dt) {
        this._time += dt;
        this._btnCooldown = Math.max(0, this._btnCooldown - dt);

        // update internal timers for throttling
        this._redrawTimer = (this._redrawTimer || 0) + dt;
        this._broadcastTimer = (this._broadcastTimer || 0) + dt;

        if (this._running) {
            this._runTime += dt;

            // 计算瞬时位移
            const instDisp = this._calcInstDisp(this._time);

            // 当前频率/幅值
            if (this.vibMode === 'sweep') {
                this._curFreq = this._sweepF;
                // 扫频循环计数
                if (this._sweepF >= this.sweepEnd - 0.1) {
                    this._sweepF = this.sweepStart;
                    this._cycleCount++;
                }
            } else if (this.vibMode === 'shock') {
                this._curFreq = 1 / this.shockRepeat;
                if (this._time % this.shockRepeat < dt) this._cycleCount++;
            } else if (this.vibMode === 'random') {
                this._curFreq = 0;   // 宽带
            } else {
                this._curFreq = this.frequency;
                // 正弦循环计数
                if (this.frequency > 0) {
                    const period = 1 / this.frequency;
                    if (Math.floor(this._time / period) > Math.floor((this._time - dt) / period)) {
                        this._cycleCount++;
                    }
                }
            }
            this._curAmp = Math.abs(instDisp);

            // 台面像素位移（归一化幅值×固定像素，使振动全程可见）
            const maxPixel = Math.min(this._tableH * 0.35, 30);
            const norm = instDisp / Math.max(this.amplitude, 1);
            const dispPx = Math.max(-1, Math.min(1, norm)) * maxPixel;
            const k = Math.min(1, dt * Math.max(this._curFreq || 25, 1) * 0.8);
            this._tableOffset = this._tableOffset * (1 - k) + dispPx * k;

            // 更新理论参考值
            const effFreq = this.vibMode === 'sweep' ? this._sweepF : this.frequency;
            const ref = this._calcRefValues(this.amplitude, effFreq);
            this._refDisp = ref.disp; this._refVel = ref.vel; this._refAcc = ref.acc;

            // 广播给已连接的被测仪表（幅值单位为 mm，配置值为 µm→需除1000）
            if (this._broadcastTimer >= this._broadcastInterval) {
                const ampMm = this.amplitude / 1000;
                const freqToSend = this._curFreq || this.frequency;
                this._connectedMeters.forEach(m => {
                    if (typeof m.setVibration === 'function') {
                        try { m.setVibration(ampMm, freqToSend); } catch (e) { /* ignore */ }
                    }
                });
                this._broadcastTimer = 0;
            }

        } else {
            this._curFreq = 0; this._curAmp = 0;
        }

        // 每帧更新动画面属性（推杆、指针）
        this._updateAnimShapes();
        // throttle actual redraw requests to reduce Konva draw overhead
        if (this._redrawTimer >= this._redrawInterval) {
            this.sys.requestRedraw();
            this._redrawTimer = 0;
        }
        // 状态变化时（启停/模式切换）重建 _dynamicGroup
        const modeKey = `${this._running ? 1 : 0}|${this.vibMode}`;
        if (modeKey !== this._lastModeKey) {
            this._lastModeKey = modeKey;
            this._rebuildDynamic();
        }
        //this._refreshIfDirty();
    }

    // ═══════════════════════════════════════════
    // 公开 API
    // ═══════════════════════════════════════════

    /** 连接被测仪表（需实现 setVibration(amp, freq)） */
    connectMeter(meterInstance) {
        if (!this._connectedMeters.includes(meterInstance)) {
            this._connectedMeters.push(meterInstance);
        }
    }

    disconnectMeter(meterInstance) {
        this._connectedMeters = this._connectedMeters.filter(m => m !== meterInstance);
    }

    start() { this._handleCtrl('start'); }
    stop() { this._handleCtrl('stop'); }

    isRunning() { return this._running; }

    getState() {
        return {
            running: this._running,
            runTime: this._runTime,
            cycleCount: this._cycleCount,
            curFreq: this._curFreq,
            curAmp: this._curAmp,
            refDisp: this._refDisp,
            refVel: this._refVel,
            refAcc: this._refAcc,
        };
    }

    getConfigFields() {
        return [
            { label: '位号/名称', key: 'label', type: 'text' },
            { label: '振动模式', key: 'vibMode', type: 'text' },
            { label: '频率 (Hz)', key: 'frequency', type: 'number' },
            { label: '幅值 (μm pk)', key: 'amplitude', type: 'number' },
            { label: '扫频起始 (Hz)', key: 'sweepStart', type: 'number' },
            { label: '扫频终止 (Hz)', key: 'sweepEnd', type: 'number' },
            { label: '扫频速率 (oct/min)', key: 'sweepRate', type: 'number' },
            { label: '冲击脉宽 (ms)', key: 'shockWidth', type: 'number' },
            { label: '冲击周期 (s)', key: 'shockRepeat', type: 'number' },
        ];
    }

    onConfigUpdate(cfg) {
        const numKeys = ['frequency', 'amplitude', 'sweepStart', 'sweepEnd', 'sweepRate', 'shockWidth', 'shockRepeat'];
        if (cfg.label !== undefined) this.label = cfg.label;
        if (cfg.vibMode !== undefined) this.vibMode = cfg.vibMode;
        numKeys.forEach(k => { if (cfg[k] !== undefined) this[k] = parseFloat(cfg[k]); });
        this.config = { ...this.config, ...cfg };
        this._recalcGeometry();
        // update sweep cache for efficiency
        this._updateSweepCache();
        this._rebuildDynamic();
        this._refreshCache();
    }

    update(state) {
        if (typeof state === 'object' && state !== null) {
            if (state.frequency !== undefined) this.frequency = state.frequency;
            if (state.amplitude !== undefined) this.amplitude = state.amplitude;
            if (state.vibMode !== undefined) this.vibMode = state.vibMode;
        }
        this._refreshCache();
    }

    destroy() {
        super.destroy?.();
    }
}
