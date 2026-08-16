import { BaseComponent } from './BaseComponent.js';

/**
 * 时间继电器仿真组件
 * （Time Relay / Timer Relay）
 *
 * ── 器件原理 ──────────────────────────────────────────────────
 *
 *  时间继电器是一种在接收控制信号后，经过预设的延时时间
 *  才动作（闭合或断开触点）的控制元件。广泛用于顺序控制、
 *  电动机星-三角降压启动、定时保护等场合。
 *
 *  ┌─────────────────────────────────────────────────────────┐
 *  │  核心特性：延时精度 ±5%（机械式）/ ±1%（数字式）        │
 *  │                                                         │
 *  │  触点类型：                                              │
 *  │  · 延时断开常闭（DBNC）：线圈得电时立即动作，失电后     │
 *  │    延时 t 后恢复常闭状态                                │
 *  │  · 延时闭合常开（DANO）：线圈得电后延时 t 才闭合        │
 *  │  · 瞬动触点（Instant）：与普通继电器相同，无延时         │
 *  └─────────────────────────────────────────────────────────┘
 *
 * ── 工作类型 ──────────────────────────────────────────────────
 *
 *  本组件支持四种时序类型（可配置）：
 *
 *  Type A — 通电延时（On-Delay / TON）
 *  ┌──────────────────────────────────────────────────────┐
 *  │  线圈信号：  ____┌─────────────┐____                 │
 *  │  延时倒计时：     └──→ t ──→ 0                       │
 *  │  延时NO触点：          ┌────────┘____                │
 *  │  延时NC触点：  ────────┘            ────              │
 *  │  瞬动触点：   ____┌─────────────┐____                │
 *  └──────────────────────────────────────────────────────┘
 *
 *  Type B — 断电延时（Off-Delay / TOF）
 *  ┌──────────────────────────────────────────────────────┐
 *  │  线圈信号：  ____┌────────┐____                       │
 *  │  延时NO触点：    ┌─────────────→ t → ┐____           │
 *  │  延时NC触点：  ──┘                   └──────          │
 *  └──────────────────────────────────────────────────────┘
 *
 *  Type C — 脉冲延时（Pulse / TP）
 *  ┌──────────────────────────────────────────────────────┐
 *  │  线圈信号：  ____┌──┐____                             │
 *  │  延时NO触点：    ┌── t ──┐____                        │
 *  └──────────────────────────────────────────────────────┘
 *
 *  Type D — 循环定时（Cyclic / Flicker）
 *  ┌──────────────────────────────────────────────────────┐
 *  │  线圈信号：  ____┌─────────────────────              │
 *  │  NO 触点：       ┌─t1─┐  ┌─t1─┐  ┌─t1─            │
 *  │                  └─t2─┘  └─t2─┘  └─t2─            │
 *  └──────────────────────────────────────────────────────┘
 *
 * ── 内部结构 ──────────────────────────────────────────────────
 *
 *  一、机械式/空气阻尼式时间继电器（JS7-A 等）
 *      原理：电磁铁吸合后，气囊被拉伸或压缩，通过节流孔
 *            控制气体流量来实现时间延迟
 *      时间范围：0.4s ~ 180s
 *      精度：±10%
 *
 *  二、电子式数字时间继电器（DH48S / JSS1 系列）
 *      原理：RC 充放电 / 晶体振荡计数
 *      时间范围：0.01s ~ 9999h（可设）
 *      精度：±1%
 *      本组件以此型号为仿真原型
 *
 *      主要元件：
 *      ● LCD/LED 数字显示屏（显示设定值/计时值）
 *      ● 时间设定旋钮（DIP 开关或拨码轮）
 *      ● 时基选择（s/min/h）
 *      ● 模式指示 LED（ON延时/OFF延时/脉冲/循环）
 *      ● 控制电源端子（线圈 A1/A2，AC/DC 通用）
 *      ● 触点端子：
 *          1-4 ← 延时常开 NO（Delayed NO）
 *          1-2 ← 延时常闭 NC（Delayed NC）
 *          3-4 ← 瞬动常开 NO（Instant NO）
 *
 * ── DH48S 面板布局 ────────────────────────────────────────────
 *
 *  ┌─────────────────────────────────────────────────────┐
 *  │  ┌──────────────────────────────────────────────┐  │
 *  │  │        LCD  数码管显示屏（4位）               │  │
 *  │  │   设定值：  0 0 1 5                           │  │
 *  │  │   当前值：  0 0 0 8    ●计时中                │  │
 *  │  └──────────────────────────────────────────────┘  │
 *  │                                                     │
 *  │  [MODE▲] [SET▼] [时基:s]     ● PWR  ● OUT         │
 *  │                                                     │
 *  │  ┌──────────────────────────────────────────────┐  │
 *  │  │  时序图示区（4格，实时填充进度）              │  │
 *  │  └──────────────────────────────────────────────┘  │
 *  └─────────────────────────────────────────────────────┘
 *
 * ── 端口 ─────────────────────────────────────────────────────
 *  coil_A1       — 线圈电源端 +（控制电源）
 *  coil_A2       — 线圈电源端 −（控制电源）
 *  contact_1     — 延时触点公共端
 *  contact_2     — 延时常闭 NC（1-2 延时动作）
 *  contact_3     — 瞬动常开 NO（3-4 瞬动）
 *  contact_4     — 延时常开 NO（1-4 延时动作）
 *
 * ── 仿真动画 ──────────────────────────────────────────────────
 *  1. LCD 数码管：7 段 + 小数点，实时显示计时值和设定值
 *  2. 进度弧（圆形计时表盘）：实时旋转填充，直观显示延时进度
 *  3. 时序图：4格动态绘制，实时展示线圈→触点时序关系
 *  4. OUT LED：触点动作时绿色点亮，并发光效果
 *  5. 触点切换电弧：延时时间到，触点切换瞬间微弧光
 *  6. 线圈通电指示：PWR LED 橙黄色
 *  7. 循环模式：NO 触点以 t1/t2 周期闪烁
 *  8. 模式 LED 矩阵：TON/TOF/TP/CYC 对应颜色亮起
 */
export class TimeRelay extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.width  = Math.max(180, config.width  || 220);
        this.height = Math.max(260, config.height || 320);

        this.type    = 'time_relay';
        this.special = 'none';
        this.cache   = 'fixed';

        // ── 额定参数 ──
        this.label        = config.label        || 'KT';
        this.coilVoltage  = config.coilVoltage  || 220;   // V AC
        // 延时类型：'TON'=通电延时 | 'TOF'=断电延时 | 'TP'=脉冲 | 'CYC'=循环
        this.timerType    = config.timerType    || 'TON';
        // 延时时间（s）
        this.setTime      = config.setTime      || 10;
        // 循环模式 t1（ON 时间）/ t2（OFF 时间）
        this.cycleTimeOn  = config.cycleTimeOn  || 3;
        this.cycleTimeOff = config.cycleTimeOff || 5;
        // 时基：'s'=秒 | 'min'=分钟 | 'h'=小时
        this.timeBase     = config.timeBase     || 's';

        // ── 控制状态 ──
        this._coilEnergized = false;   // 线圈是否得电
        this._elapsedTime   = 0;       // 已计时时间（s）
        this._timing        = false;   // 是否正在计时
        this._timingDone    = false;   // 延时时间到

        // 触点状态
        // 延时 NO（1-4）：通电延时时 t 后闭合，其他时机见时序
        // 延时 NC（1-2）：与 NO 互补
        // 瞬动 NO（3-4）：线圈得电立即闭合
        this._delayNO       = false;   // 延时常开触点
        this._delayNC       = true;    // 延时常闭触点
        this._instantNO     = false;   // 瞬动常开触点

        // 循环模式内部状态
        this._cyclePhase    = 'off';   // 'on'/'off'
        this._cycleElapsed  = 0;

        // ── 动画 ──
        this._glowPhase     = 0;
        this._arcFlash      = 0;       // 触点切换弧光
        this._lcdPhase      = 0;       // LCD 刷新相位
        this._prevDelayNO   = false;   // 上一帧触点状态，用于检测切换
        this._triggerHistory = [];     // 时序图历史（用于绘制时序波形）
        this._histMaxLen    = 120;     // 最多保留 120 个采样点


        // ── 几何布局 ──
        const W = this.width, H = this.height;

        // 外壳
        this._body = {
            x: W * 0.04, y: H * 0.02,
            w: W * 0.92, h: H * 0.90,
            rx: 5,
        };

        // 显示屏区
        this._display = {
            x: W * 0.08, y: H * 0.05,
            w: W * 0.84, h: H * 0.30,
            rx: 3,
        };

        // 圆形计时表盘（中部）
        this._dial = {
            cx: W * 0.50,
            cy: H * 0.50,
            r:  Math.min(W * 0.24, H * 0.14),
        };

        // 模式指示灯区（表盘右侧）
        this._modeLEDs = [
            { label: 'TON', cx: W * 0.82, cy: H * 0.435 },
            { label: 'TOF', cx: W * 0.82, cy: H * 0.490 },
            { label: 'TP',  cx: W * 0.82, cy: H * 0.545 },
            { label: 'CYC', cx: W * 0.82, cy: H * 0.600 },
        ];

        // 按键区
        this._buttons = [
            { label: 'MODE', x: W * 0.10, y: H * 0.64 },
            { label: 'SET',  x: W * 0.38, y: H * 0.64 },
        ];

        // 时基显示区
        this._timebaseDisplay = {
            x: W * 0.60, y: H * 0.63,
            w: W * 0.22, h: H * 0.045,
        };

        // 时序图区（下部）
        this._seqDiagram = {
            x: W * 0.08, y: H * 0.72,
            w: W * 0.84, h: H * 0.12,
        };

        // 端子区（底部）
        this._terminals = [
            { id: 'coil_A1',   label: 'A1', x: W * 0.14, isCoil: true  },
            { id: 'coil_A2',   label: 'A2', x: W * 0.30, isCoil: true  },
            { id: 'contact_1', label: '1',  x: W * 0.50, isCoil: false },
            { id: 'contact_2', label: '2',  x: W * 0.63, isCoil: false },
            { id: 'contact_3', label: '3',  x: W * 0.76, isCoil: false },
            { id: 'contact_4', label: '4',  x: W * 0.89, isCoil: false },
        ];

        this._init();

        // 注册端口
        const portY = this._body.y + this._body.h + 4;
        this._terminals.forEach(t => {
            this.addPort(t.x, portY, t.id, 'wire', t.label);
        });
    }

    // ═══════════════════════════════════════════
    _init() {
        this._drawBody();
        this._drawTerminalBlock();
        this._drawButtons();
        this._drawTimebaseBox();

        // 动态层
        this._displayGroup  = new Konva.Group();
        this._dialGroup     = new Konva.Group();
        this._modeLEDGroup  = new Konva.Group();
        this._seqGroup      = new Konva.Group();
        this._statusGroup   = new Konva.Group();

        this.group.add(this._displayGroup);
        this.group.add(this._dialGroup);
        this.group.add(this._modeLEDGroup);
        this.group.add(this._seqGroup);
        this.group.add(this._statusGroup);

        this._drawLabel();
        this._rebuildAll();
        this._bindInteraction();
        
    }

    // ── 外壳 ─────────────────────────────────
    _drawBody() {
        const b = this._body, W = this.width, H = this.height;

        // 主壳体（深灰工程塑料）
        this.group.add(new Konva.Rect({
            x: b.x, y: b.y, width: b.w, height: b.h,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint:   { x: b.w, y: b.h },
            fillLinearGradientColorStops: [
                0,   '#32363e',
                0.3, '#3c4048',
                0.7, '#383c44',
                1,   '#28292e',
            ],
            stroke: '#1e2228', strokeWidth: 1.5,
            cornerRadius: b.rx,
            shadowColor: '#000', shadowBlur: 12, shadowOffsetY: 4, shadowOpacity: 0.45,
        }));

        // 顶面高光
        this.group.add(new Konva.Rect({
            x: b.x + 2, y: b.y + 2, width: b.w - 4, height: b.h * 0.04,
            fill: 'rgba(255,255,255,0.08)',
            cornerRadius: [b.rx, b.rx, 0, 0],
        }));

        // 角螺钉（4颗）
        [[b.x + 7, b.y + 7], [b.x + b.w - 7, b.y + 7],
         [b.x + 7, b.y + b.h - 7], [b.x + b.w - 7, b.y + b.h - 7]
        ].forEach(([sx, sy]) => {
            this.group.add(new Konva.Circle({ x: sx, y: sy, radius: 3, fill: '#4c5260', stroke: '#2a2e38', strokeWidth: 0.6 }));
            this.group.add(new Konva.Line({ points: [sx - 1.8, sy - 1.8, sx + 1.8, sy + 1.8], stroke: '#363c48', strokeWidth: 0.8 }));
        });

        // 型号铭牌（外壳右下）
        this.group.add(new Konva.Text({
            x: b.x + b.w * 0.05, y: b.y + b.h - 18,
            width: b.w * 0.90,
            text: `DH48S  ${this.coilVoltage}V  ${this.timerType}`,
            fontSize: 6.5, fill: 'rgba(150,170,190,0.45)',
            align: 'center', fontFamily: 'Courier New',
        }));
    }

    // ── 端子区（底部）────────────────────────
    _drawTerminalBlock() {
        const W = this.width, H = this.height;
        const b  = this._body;
        const tH = H * 0.045, tW = W * 0.10;

        this._terminals.forEach(t => {
            const tx = t.x - tW / 2;
            const ty = b.y + b.h - tH;

            // 端子块
            this.group.add(new Konva.Rect({
                x: tx, y: ty, width: tW, height: tH,
                fillLinearGradientStartPoint: { x: 0, y: 0 },
                fillLinearGradientEndPoint:   { x: tW, y: 0 },
                fillLinearGradientColorStops: [
                    0,'#585e68', 0.3,'#909aa0', 0.6,'#b0bac0', 1,'#585e68',
                ],
                stroke: '#383e48', strokeWidth: 0.7, cornerRadius: 1,
            }));
            // 螺钉
            this.group.add(new Konva.Circle({ x: t.x, y: ty + tH / 2, radius: tW * 0.22, fill: '#8a9298', stroke: '#606870', strokeWidth: 0.5 }));
            this.group.add(new Konva.Line({ points: [t.x - tW * 0.15, ty + tH / 2, t.x + tW * 0.15, ty + tH / 2], stroke: '#444c58', strokeWidth: 0.8 }));
            // 标注
            const lblCol = t.isCoil ? '#ffcc80' : '#90caf9';
            this.group.add(new Konva.Text({
                x: t.x - 8, y: ty - 11,
                width: 16, text: t.label,
                fontSize: 8, fill: lblCol,
                align: 'center', fontStyle: 'bold', fontFamily: 'Courier New',
            }));
        });

        // 线圈/触点区域分隔线
        const divX = (this._terminals[1].x + this._terminals[2].x) / 2;
        this.group.add(new Konva.Line({
            points: [divX, b.y + b.h - tH - 6, divX, b.y + b.h + 2],
            stroke: 'rgba(255,255,255,0.08)', strokeWidth: 0.8,
        }));
        this.group.add(new Konva.Text({
            x: this._terminals[0].x - 8, y: b.y + b.h - tH - 18,
            width: 50, text: '线圈',
            fontSize: 6.5, fill: 'rgba(255,200,100,0.45)',
            fontFamily: 'Courier New',
        }));
        this.group.add(new Konva.Text({
            x: this._terminals[2].x - 10, y: b.y + b.h - tH - 18,
            width: 55, text: '触点',
            fontSize: 6.5, fill: 'rgba(140,180,220,0.45)',
            fontFamily: 'Courier New',
        }));
    }

    // ── 功能按键（静态）──────────────────────
    _drawButtons() {
        const W = this.width, H = this.height;
        const bW = W * 0.14, bH = H * 0.038;

        this._buttons.forEach(btn => {
            const bx = btn.x - bW / 2, by = btn.y - bH / 2;
            this.group.add(new Konva.Rect({
                x: bx, y: by, width: bW, height: bH,
                fillLinearGradientStartPoint: { x: 0, y: 0 },
                fillLinearGradientEndPoint:   { x: 0, y: bH },
                fillLinearGradientColorStops: [0,'#3e4454', 0.4,'#32384a', 1,'#262c3a'],
                stroke: '#1e2430', strokeWidth: 0.8, cornerRadius: 3,
                shadowColor: '#000', shadowBlur: 3, shadowOffsetY: 1, shadowOpacity: 0.4,
            }));
            this.group.add(new Konva.Rect({
                x: bx + 1, y: by + 1, width: bW - 2, height: bH * 0.35,
                fill: 'rgba(255,255,255,0.07)', cornerRadius: [3, 3, 0, 0],
            }));
            this.group.add(new Konva.Text({
                x: bx, y: by + bH * 0.2, width: bW,
                text: btn.label,
                fontSize: Math.max(5.5, W * 0.042),
                fill: 'rgba(160,185,215,0.75)',
                align: 'center', fontStyle: 'bold', fontFamily: 'Arial',
            }));
        });
    }

    // ── 时基框（静态骨架）────────────────────
    _drawTimebaseBox() {
        const tb = this._timebaseDisplay, W = this.width;
        this.group.add(new Konva.Rect({
            x: tb.x, y: tb.y, width: tb.w, height: tb.h,
            fill: '#0d1018', stroke: '#1a2230', strokeWidth: 0.8, cornerRadius: 2,
        }));
    }

    // ══════════════════════════════════════════
    // ── 动态重绘 ──────────────────────────────

    _rebuildAll() {
        this._rebuildDisplay();
        this._rebuildDial();
        this._rebuildModeLEDs();
        this._rebuildSeqDiagram();
        this._rebuildStatusLEDs();
    }

    // ── LCD 数码管显示屏 ─────────────────────
    _rebuildDisplay() {
        this._displayGroup.destroyChildren();
        const d   = this._display, W = this.width, H = this.height;
        const lph = this._lcdPhase;

        // 屏幕背板（深绿背光）
        this._displayGroup.add(new Konva.Rect({
            x: d.x, y: d.y, width: d.w, height: d.h,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint:   { x: d.w, y: d.h },
            fillLinearGradientColorStops: [
                0, '#060e0a', 0.5, '#08120c', 1, '#050c08',
            ],
            stroke: '#080e0c', strokeWidth: 0.8, cornerRadius: d.rx,
        }));
        // 扫描线
        const scanY = d.y + (lph % 1) * d.h;
        this._displayGroup.add(new Konva.Rect({
            x: d.x + 2, y: scanY, width: d.w - 4, height: d.h * 0.06,
            fill: 'rgba(0,210,140,0.020)', cornerRadius: 1,
        }));
        // 玻璃反光
        this._displayGroup.add(new Konva.Rect({
            x: d.x + 2, y: d.y + 2, width: d.w - 4, height: d.h * 0.15,
            fill: 'rgba(80,200,160,0.055)', cornerRadius: [d.rx, d.rx, 0, 0],
        }));

        const setT  = this._getDisplayTime(this.setTime);
        const curT  = this._getDisplayTime(this._elapsedTime);
        const coilOn = this._coilEnergized;

        // ── 设定值显示（上行，小字）──
        this._displayGroup.add(new Konva.Text({
            x: d.x + 5, y: d.y + d.h * 0.06,
            width: d.w * 0.60,
            text: 'SET',
            fontSize: Math.max(5.5, W * 0.040),
            fill: 'rgba(0,200,130,0.50)',
            fontFamily: 'Courier New',
        }));
        this._displayGroup.add(new Konva.Text({
            x: d.x + d.w * 0.28, y: d.y + d.h * 0.06,
            width: d.w * 0.60,
            text: setT,
            fontSize: Math.max(7, W * 0.055),
            fill: 'rgba(0,210,140,0.70)',
            fontFamily: 'Courier New, monospace',
            fontStyle: 'bold',
            align: 'right',
        }));

        // ── 当前计时值（中行，大字）──
        const curColor = this._timing ? '#00ffaa' : coilOn ? '#00e090' : 'rgba(0,180,100,0.40)';
        this._displayGroup.add(new Konva.Text({
            x: d.x + 5, y: d.y + d.h * 0.30,
            text: curT,
            fontSize: Math.max(10, W * 0.090),
            fill: curColor,
            fontFamily: 'Courier New, monospace',
            fontStyle: 'bold',
            letterSpacing: 2,
        }));

        // 时基单位（右侧）
        this._displayGroup.add(new Konva.Text({
            x: d.x + d.w * 0.78, y: d.y + d.h * 0.34,
            width: d.w * 0.18,
            text: this.timeBase,
            fontSize: Math.max(7, W * 0.052),
            fill: 'rgba(0,200,130,0.60)',
            fontFamily: 'Courier New', fontStyle: 'bold',
            align: 'center',
        }));

        // 计时中小点闪烁
        if (this._timing) {
            const dotAlpha = 0.5 + Math.abs(Math.sin(lph * Math.PI * 3)) * 0.5;
            this._displayGroup.add(new Konva.Circle({
                x: d.x + d.w * 0.92, y: d.y + d.h * 0.28,
                radius: W * 0.015,
                fill: `rgba(0,255,180,${dotAlpha})`,
                shadowColor: 'rgba(0,255,180,1)', shadowBlur: 5, shadowOpacity: 0.8,
            }));
        }

        // ── 触点状态指示（下行）──
        const noCol  = this._delayNO ? '#40ff80' : 'rgba(50,120,80,0.30)';
        const ncCol  = this._delayNC ? '#ffcc40' : 'rgba(120,100,30,0.30)';
        const insCol = this._instantNO ? '#40e0ff' : 'rgba(30,100,120,0.30)';

        [
            { text: 'NO●',  col: noCol,  x: d.x + 5 },
            { text: 'NC●',  col: ncCol,  x: d.x + d.w * 0.38 },
            { text: 'INS●', col: insCol, x: d.x + d.w * 0.70 },
        ].forEach(item => {
            this._displayGroup.add(new Konva.Text({
                x: item.x, y: d.y + d.h * 0.78,
                text: item.text,
                fontSize: Math.max(6, W * 0.044),
                fill: item.col,
                fontFamily: 'Courier New', fontStyle: 'bold',
            }));
        });

        // 边框光晕
        this._displayGroup.add(new Konva.Rect({
            x: d.x, y: d.y, width: d.w, height: d.h,
            fill: 'transparent',
            stroke: coilOn ? 'rgba(0,200,140,0.22)' : 'rgba(0,160,100,0.12)',
            strokeWidth: 1, cornerRadius: d.rx,
        }));
    }

    // ── 圆形计时表盘 ─────────────────────────
    _rebuildDial() {
        this._dialGroup.destroyChildren();
        const d  = this._dial, W = this.width, H = this.height;
        const lv = this.timerType === 'CYC'
            ? (this._cyclePhase === 'on' ? this._cycleElapsed / this.cycleTimeOn : 1 - this._cycleElapsed / this.cycleTimeOff)
            : Math.min(1, this._elapsedTime / Math.max(0.001, this.setTime));

        // 外圈轨道
        this._dialGroup.add(new Konva.Circle({
            x: d.cx, y: d.cy, radius: d.r + 6,
            fill: '#0c1018', stroke: '#1e2838', strokeWidth: 1,
        }));
        // 刻度环
        for (let i = 0; i < 24; i++) {
            const ang  = (i / 24) * Math.PI * 2 - Math.PI / 2;
            const r0   = d.r + 1, r1 = d.r + (i % 6 === 0 ? 5 : 3);
            this._dialGroup.add(new Konva.Line({
                points: [
                    d.cx + Math.cos(ang) * r0, d.cy + Math.sin(ang) * r0,
                    d.cx + Math.cos(ang) * r1, d.cy + Math.sin(ang) * r1,
                ],
                stroke: i % 6 === 0 ? 'rgba(0,200,130,0.40)' : 'rgba(0,150,100,0.22)',
                strokeWidth: i % 6 === 0 ? 1.2 : 0.6,
            }));
        }

        // 进度弧（从顶部 −90° 开始，顺时针）
        if (lv > 0.005) {
            const startAng = -Math.PI / 2;
            const endAng   = startAng + lv * Math.PI * 2;
            const arcCol   = this.timerType === 'CYC'
                ? (this._cyclePhase === 'on' ? '#00ffaa' : '#ffaa00')
                : (lv < 0.6 ? '#00cc88' : lv < 0.88 ? '#88dd00' : '#ff8820');

            this._dialGroup.add(new Konva.Arc({
                x: d.cx, y: d.cy,
                innerRadius: d.r * 0.60,
                outerRadius: d.r * 0.96,
                angle: lv * 360,
                rotation: -90,
                fill: arcCol,
                shadowColor: arcCol,
                shadowBlur: 6 * Math.min(1, lv + 0.2),
                shadowOpacity: 0.70,
            }));
        }

        // 表盘底色（中心填充）
        this._dialGroup.add(new Konva.Circle({
            x: d.cx, y: d.cy, radius: d.r * 0.60,
            fillRadialGradientStartPoint: { x: -d.r * 0.2, y: -d.r * 0.2 },
            fillRadialGradientEndPoint:   { x: 0, y: 0 },
            fillRadialGradientStartRadius: 0,
            fillRadialGradientEndRadius:   d.r * 0.60,
            fillRadialGradientColorStops: [0, '#0e1820', 0.7, '#0a1218', 1, '#060e10'],
            strokeWidth: 0,
        }));

        // 中心百分比文字
        const pctText = this.timerType === 'CYC'
            ? (this._cyclePhase === 'on' ? 'ON' : 'OFF')
            : `${Math.round(lv * 100)}%`;
        this._dialGroup.add(new Konva.Text({
            x: d.cx - d.r * 0.55, y: d.cy - d.r * 0.22,
            width: d.r * 1.10, text: pctText,
            fontSize: Math.max(8, W * 0.060),
            fill: lv >= 1 ? '#00ffaa' : 'rgba(0,200,140,0.70)',
            align: 'center', fontStyle: 'bold',
            fontFamily: 'Courier New',
        }));

        // 指针（细线）
        const needleAng = -Math.PI / 2 + lv * Math.PI * 2;
        this._dialGroup.add(new Konva.Line({
            points: [
                d.cx, d.cy,
                d.cx + Math.cos(needleAng) * d.r * 0.82,
                d.cy + Math.sin(needleAng) * d.r * 0.82,
            ],
            stroke: lv >= 1 ? '#00ffaa' : 'rgba(0,220,150,0.70)',
            strokeWidth: 1.8, lineCap: 'round',
        }));
        // 中心圆销
        this._dialGroup.add(new Konva.Circle({
            x: d.cx, y: d.cy, radius: d.r * 0.08,
            fill: 'rgba(0,200,140,0.80)', stroke: 'rgba(0,150,100,0.50)', strokeWidth: 0.6,
        }));

        // "SET" 标注（表盘上方）
        this._dialGroup.add(new Konva.Text({
            x: d.cx - 25, y: d.cy - d.r - 14,
            width: 50, text: `${this.setTime}${this.timeBase}`,
            fontSize: Math.max(6, W * 0.046),
            fill: 'rgba(0,190,120,0.55)',
            align: 'center', fontFamily: 'Courier New',
        }));
    }

    // ── 模式指示灯矩阵 ───────────────────────
    _rebuildModeLEDs() {
        this._modeLEDGroup.destroyChildren();
        const W = this.width;
        const modeColors = { TON:'#40e870', TOF:'#ffaa30', TP:'#4ab0ff', CYC:'#e040fb' };

        this._modeLEDs.forEach(ml => {
            const active = ml.label === this.timerType;
            const col    = active ? (modeColors[ml.label] || '#ffffff') : 'rgba(60,80,100,0.30)';
            const r      = W * 0.022;

            this._modeLEDGroup.add(new Konva.Circle({
                x: ml.cx, y: ml.cy, radius: r,
                fill: col,
                stroke: active ? col : 'rgba(40,60,80,0.30)',
                strokeWidth: 0.6,
                shadowColor: active ? col : 'transparent',
                shadowBlur:  active ? 7 : 0,
                shadowOpacity: 0.85,
            }));
            // 高光
            this._modeLEDGroup.add(new Konva.Ellipse({
                x: ml.cx - r * 0.26, y: ml.cy - r * 0.28,
                radiusX: r * 0.28, radiusY: r * 0.18,
                fill: `rgba(255,255,255,${active ? 0.40 : 0.05})`,
                rotation: -30,
            }));
            // 标注
            this._modeLEDGroup.add(new Konva.Text({
                x: ml.cx + r + 2, y: ml.cy - 4,
                text: ml.label,
                fontSize: Math.max(5.5, W * 0.040),
                fill: active ? col : 'rgba(50,80,100,0.45)',
                fontFamily: 'Courier New', fontStyle: active ? 'bold' : 'normal',
            }));
        });
    }

    // ── 时序图（简化波形图）─────────────────
    _rebuildSeqDiagram() {
        this._seqGroup.destroyChildren();
        const sd = this._seqDiagram, W = this.width;

        // 背景
        this._seqGroup.add(new Konva.Rect({
            x: sd.x, y: sd.y, width: sd.w, height: sd.h,
            fill: '#060c0a', stroke: '#0e1c18', strokeWidth: 0.8, cornerRadius: 2,
        }));

        const hist = this._triggerHistory;
        const len  = hist.length;
        if (len < 2) {
            this._seqGroup.add(new Konva.Text({
                x: sd.x + 6, y: sd.y + sd.h * 0.35,
                text: '等待信号...',
                fontSize: 7, fill: 'rgba(0,150,100,0.35)',
                fontFamily: 'Courier New',
            }));
            return;
        }

        const px = (i) => sd.x + 2 + (i / (this._histMaxLen - 1)) * (sd.w - 4);
        const lH  = sd.h * 0.30;   // 波形高度
        const c1Y = sd.y + lH * 0.60;        // 线圈波形中心 Y
        const c2Y = sd.y + sd.h - lH * 0.40; // 触点波形中心 Y

        // 网格中线
        [c1Y, c2Y].forEach(cy => {
            this._seqGroup.add(new Konva.Line({
                points: [sd.x + 2, cy, sd.x + sd.w - 2, cy],
                stroke: 'rgba(0,100,70,0.22)', strokeWidth: 0.4,
            }));
        });

        // 线圈波形（蓝色）
        const coilPts = [], noPts = [];
        for (let i = 0; i < len; i++) {
            const x = px(i);
            coilPts.push(x, c1Y + (hist[i].coil ? -lH * 0.45 : lH * 0.18));
            noPts.push(x,   c2Y + (hist[i].no   ? -lH * 0.45 : lH * 0.18));
        }
        this._seqGroup.add(new Konva.Line({
            points: coilPts,
            stroke: 'rgba(80,160,255,0.65)', strokeWidth: 1.0,
            tension: 0, lineCap: 'round',
        }));
        // NO 触点波形（绿色）
        this._seqGroup.add(new Konva.Line({
            points: noPts,
            stroke: 'rgba(0,220,130,0.65)', strokeWidth: 1.0,
            tension: 0, lineCap: 'round',
        }));

        // 图例
        this._seqGroup.add(new Konva.Text({
            x: sd.x + 3, y: sd.y + 1,
            text: '─ 线圈',
            fontSize: 5.5, fill: 'rgba(80,160,255,0.55)',
            fontFamily: 'Courier New',
        }));
        this._seqGroup.add(new Konva.Text({
            x: sd.x + sd.w * 0.38, y: sd.y + 1,
            text: '─ NO延时',
            fontSize: 5.5, fill: 'rgba(0,200,130,0.55)',
            fontFamily: 'Courier New',
        }));

        // 触点切换弧光（小动画）
        if (this._arcFlash > 0.1) {
            const af = this._arcFlash;
            this._seqGroup.add(new Konva.Circle({
                x: px(len - 1), y: c2Y - lH * 0.45,
                radius: W * 0.020 * af,
                fill: `rgba(255,255,150,${af * 0.80})`,
                shadowColor: 'rgba(255,255,150,1)', shadowBlur: 4 * af, shadowOpacity: 0.85,
            }));
        }
    }

    // ── 状态指示灯（PWR / OUT）───────────────
    _rebuildStatusLEDs() {
        this._statusGroup.destroyChildren();
        const W = this.width, H = this.height;
        const b = this._body;
        const ledY = b.y + b.h * 0.66;

        // PWR 电源指示
        const pwrCol = this._coilEnergized ? '#ffcc40' : 'rgba(80,70,30,0.30)';
        this._statusGroup.add(new Konva.Circle({
            x: W * 0.62, y: ledY, radius: W * 0.022,
            fill: pwrCol,
            shadowColor: this._coilEnergized ? pwrCol : 'transparent',
            shadowBlur: this._coilEnergized ? 6 : 0, shadowOpacity: 0.85,
        }));
        this._statusGroup.add(new Konva.Text({
            x: W * 0.62 + W * 0.026, y: ledY - 4,
            text: 'PWR',
            fontSize: Math.max(5.5, W * 0.040), fill: 'rgba(160,140,60,0.50)',
            fontFamily: 'Courier New',
        }));

        // OUT 触点输出指示
        const outOn  = this._delayNO || this._instantNO;
        const outCol = outOn ? '#40ff88' : 'rgba(30,80,50,0.30)';
        this._statusGroup.add(new Konva.Circle({
            x: W * 0.62, y: ledY + H * 0.038, radius: W * 0.022,
            fill: outCol,
            shadowColor: outOn ? outCol : 'transparent',
            shadowBlur: outOn ? 8 : 0, shadowOpacity: 0.85,
        }));
        this._statusGroup.add(new Konva.Text({
            x: W * 0.62 + W * 0.026, y: ledY + H * 0.038 - 4,
            text: 'OUT',
            fontSize: Math.max(5.5, W * 0.040), fill: 'rgba(50,130,80,0.50)',
            fontFamily: 'Courier New',
        }));

        // 时基显示（动态）
        const tb = this._timebaseDisplay;
        this._statusGroup.add(new Konva.Text({
            x: tb.x, y: tb.y + tb.h * 0.18,
            width: tb.w, text: this.timeBase.toUpperCase(),
            fontSize: Math.max(6.5, W * 0.048),
            fill: 'rgba(0,210,140,0.75)',
            align: 'center', fontStyle: 'bold',
            fontFamily: 'Courier New',
        }));
    }

    _drawLabel() {
        const W = this.width;
        this.group.add(new Konva.Text({
            x: 0, y: -20, width: W,
            text: `${this.label}  时间继电器`,
            fontSize: 9, fontStyle: 'bold', fill: '#546e7a',
            align: 'center', fontFamily: 'Arial, sans-serif',
        }));
        this.group.add(new Konva.Text({
            x: 0, y: -9, width: W,
            text: `DH48S  ${this.timerType}  t=${this.setTime}${this.timeBase}  ${this.coilVoltage}V`,
            fontSize: 7, fill: '#3a5a7a',
            align: 'center', fontFamily: 'Courier New',
        }));
    }

    // ── 时间显示格式化 ───────────────────────
    _getDisplayTime(sec) {
        const tb = this.timeBase;
        if (tb === 'h') {
            const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = Math.floor(sec % 60);
            return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
        }
        if (tb === 'min') {
            const m = Math.floor(sec / 60), s = Math.floor(sec % 60);
            return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
        }
        // 秒
        return sec < 100
            ? sec.toFixed(1).padStart(5, ' ')
            : String(Math.floor(sec)).padStart(5, ' ');
    }

    // ═══════════════════════════════════════════
    // ── 时序逻辑 ──────────────────────────────

    _updateTimerLogic(dt) {
        const prevDelayNO = this._delayNO;

        switch (this.timerType) {
            case 'TON':  this._logicTON(dt);  break;
            case 'TOF':  this._logicTOF(dt);  break;
            case 'TP':   this._logicTP(dt);   break;
            case 'CYC':  this._logicCYC(dt);  break;
        }

        // 触点切换弧光
        if (prevDelayNO !== this._delayNO) {
            this._arcFlash = 0.80;
        }
        this._arcFlash = Math.max(0, this._arcFlash - dt * 10);

        // 瞬动触点跟随线圈
        this._instantNO = this._coilEnergized;

        // 记录历史（每 40ms 一个采样）
        this._histTimer = (this._histTimer || 0) + dt;
        if (this._histTimer >= 0.04) {
            this._histTimer = 0;
            this._triggerHistory.push({
                coil: this._coilEnergized,
                no:   this._delayNO,
            });
            if (this._triggerHistory.length > this._histMaxLen) {
                this._triggerHistory.shift();
            }
        }
    }

    // 通电延时（TON）
    _logicTON(dt) {
        if (this._coilEnergized) {
            this._elapsedTime = Math.min(this.setTime + 0.1, this._elapsedTime + dt);
            this._timing      = this._elapsedTime < this.setTime;
            if (this._elapsedTime >= this.setTime) {
                this._delayNO = true;
                this._delayNC = false;
                this._timing  = false;
            }
        } else {
            // 失电立即复位
            this._elapsedTime = 0;
            this._delayNO     = false;
            this._delayNC     = true;
            this._timing      = false;
        }
    }

    // 断电延时（TOF）
    _logicTOF(dt) {
        if (this._coilEnergized) {
            // 得电时立即输出，并复位延时计数
            this._delayNO     = true;
            this._delayNC     = false;
            this._elapsedTime = 0;
            this._timing      = false;
        } else {
            // 失电后开始倒计时
            this._timing       = this._elapsedTime < this.setTime;
            this._elapsedTime  = Math.min(this.setTime + 0.1, this._elapsedTime + dt);
            if (this._elapsedTime >= this.setTime) {
                this._delayNO = false;
                this._delayNC = true;
                this._timing  = false;
            }
        }
    }

    // 脉冲延时（TP）
    _logicTP(dt) {
        if (!this._coilEnergized && !this._timing) {
            this._elapsedTime = 0;
            this._delayNO     = false;
            this._delayNC     = true;
        } else if (this._coilEnergized && !this._timing && this._elapsedTime === 0) {
            // 上升沿触发
            this._timing  = true;
            this._delayNO = true;
            this._delayNC = false;
        }
        if (this._timing) {
            this._elapsedTime = Math.min(this.setTime + 0.1, this._elapsedTime + dt);
            if (this._elapsedTime >= this.setTime) {
                this._delayNO = false;
                this._delayNC = true;
                this._timing  = false;
            }
        }
    }

    // 循环定时（CYC）
    _logicCYC(dt) {
        if (!this._coilEnergized) {
            this._cyclePhase   = 'off';
            this._cycleElapsed = 0;
            this._delayNO      = false;
            this._delayNC      = true;
            this._elapsedTime  = 0;
            this._timing       = false;
            return;
        }
        this._timing = true;
        this._cycleElapsed += dt;
        const t1 = this.cycleTimeOn, t2 = this.cycleTimeOff;
        if (this._cyclePhase === 'on') {
            if (this._cycleElapsed >= t1) {
                this._cycleElapsed -= t1;
                this._cyclePhase = 'off';
                this._delayNO    = false;
                this._delayNC    = true;
            } else {
                this._delayNO = true;
                this._delayNC = false;
            }
        } else {
            if (this._cycleElapsed >= t2) {
                this._cycleElapsed -= t2;
                this._cyclePhase = 'on';
                this._delayNO    = true;
                this._delayNC    = false;
            } else {
                this._delayNO = false;
                this._delayNC = true;
            }
        }
        this._elapsedTime = this._cycleElapsed;
    }

    // ═══════════════════════════════════════════
    // 集中化 tick（由 consys._tickAll 在 20fps 调用）
    tick(dt) {
        this._tickAnimation(dt, ts);
    }
    _tickAnimation(dt, ts) {
        this._updateTimerLogic(dt);
        this._glowPhase += dt * 1.5;
        this._lcdPhase  = (this._lcdPhase + dt * 0.38) % 1;
        this._rebuildAll();
        this._refreshCache();
    }

    _bindInteraction() {
        // 点击表盘区域切换线圈通断
        const dialHit = new Konva.Circle({
            x: this._dial.cx, y: this._dial.cy,
            radius: this._dial.r + 8,
            fill: 'transparent',
        });
        this.group.add(dialHit);
        dialHit.on('click tap', () => this.toggleCoil());
    }

    // ═══════════════════════════════════════════
    // ── 公开 API ─────────────────────────────

    /** 线圈得电（线圈通电） */
    energize() {
        if (this._coilEnergized) return;
        this._coilEnergized = true;
        // TOF 模式：得电时先复位计时
        if (this.timerType === 'TOF') this._elapsedTime = 0;
        // CYC 模式：得电时从 ON 相开始
        if (this.timerType === 'CYC') {
            this._cyclePhase   = 'on';
            this._cycleElapsed = 0;
        }
        this._refreshCache();
    }

    /** 线圈失电（线圈断电） */
    deEnergize() {
        if (!this._coilEnergized) return;
        this._coilEnergized = false;
        // TON/TP 模式：失电立即复位
        if (this.timerType === 'TON' || this.timerType === 'TP') {
            this._elapsedTime = 0;
        }
        // TOF 模式：失电后开始计时（在逻辑中处理）
        this._refreshCache();
    }

    /** 切换线圈状态 */
    toggleCoil() {
        this._coilEnergized ? this.deEnergize() : this.energize();
    }

    /** 设置延时时间（s） */
    setDelayTime(t) {
        this.setTime = Math.max(0.01, t);
    }

    /** 设置定时类型 */
    setTimerType(type) {
        if (!['TON','TOF','TP','CYC'].includes(type)) return;
        this.timerType     = type;
        this._elapsedTime  = 0;
        this._timing       = false;
        this._delayNO      = false;
        this._delayNC      = true;
        this._cyclePhase   = 'off';
        this._cycleElapsed = 0;
    }

    /** 复位（清零计时） */
    resetTimer() {
        this._elapsedTime  = 0;
        this._timing       = false;
        this._delayNO      = false;
        this._delayNC      = true;
        this._cyclePhase   = 'off';
        this._cycleElapsed = 0;
        this._refreshCache();
    }

    /** 查询触点状态 */
    isDelayNO()   { return this._delayNO; }
    isDelayNC()   { return this._delayNC; }
    isInstantNO() { return this._instantNO; }
    isCoilOn()    { return this._coilEnergized; }
    getElapsed()  { return this._elapsedTime; }

    update(state) {
        if (typeof state === 'boolean') {
            state ? this.energize() : this.deEnergize();
        } else if (state && typeof state === 'object') {
            if (state.coil    !== undefined) state.coil ? this.energize() : this.deEnergize();
            if (state.setTime !== undefined) this.setDelayTime(state.setTime);
            if (state.type    !== undefined) this.setTimerType(state.type);
            if (state.reset   === true)      this.resetTimer();
        }
        this._refreshCache();
    }

    getConfigFields() {
        return [
            { label: '位号/名称',             key: 'label',        type: 'text'   },
            { label: '线圈电压 (V)',           key: 'coilVoltage',  type: 'number' },
            { label: '延时类型 (TON/TOF/TP/CYC)', key: 'timerType', type: 'text' },
            { label: '延时时间 (s)',           key: 'setTime',      type: 'number' },
            { label: '循环ON时间 (s)',         key: 'cycleTimeOn',  type: 'number' },
            { label: '循环OFF时间 (s)',        key: 'cycleTimeOff', type: 'number' },
            { label: '时基 (s/min/h)',         key: 'timeBase',     type: 'text'   },
        ];
    }

    onConfigUpdate(cfg) {
        if (cfg.label        !== undefined) this.label       = cfg.label;
        if (cfg.coilVoltage  !== undefined) this.coilVoltage = parseFloat(cfg.coilVoltage);
        if (cfg.timerType    !== undefined) this.setTimerType(cfg.timerType);
        if (cfg.setTime      !== undefined) this.setDelayTime(parseFloat(cfg.setTime));
        if (cfg.cycleTimeOn  !== undefined) this.cycleTimeOn  = parseFloat(cfg.cycleTimeOn);
        if (cfg.cycleTimeOff !== undefined) this.cycleTimeOff = parseFloat(cfg.cycleTimeOff);
        if (cfg.timeBase     !== undefined) this.timeBase     = cfg.timeBase;
        this.config = { ...this.config, ...cfg };
        this._refreshCache();
    }

    destroy() {
        super.destroy?.();
    }
}