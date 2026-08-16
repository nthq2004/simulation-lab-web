/**
 * Alfa Laval EPC-50B 燃油供油单元 FCM 控制器仿真组件
 * （Fuel Conditioning Module – EPC Pump Control）
 *
 * ═══════════════════════════════════════════════════════════════
 *
 * 面板布局（参照实物图片）：
 *
 * ┌─────────────────────────────────────────────────────────────────────┐
 * │  EPC50B  [P&ID 流程示意图区域（上半部分）]              │ ● START/STOP  │
 * │                                                          │ ■ [按钮]      │
 * │  HFO→[阀]→SP2→MF→LS→[混合器]→CP2→SH→[SRV]→+ │ ● HFO         │
 * │             ↓         ↓         ↓              │ ■ [按钮] ●DO  │
 * │  DO→[阀]→SP1→AF→ FT→PS1   CP1→SH  PS2→TT→VT  │ ■ PROCESS IN FO│
 * │             ↓                                   │               │
 * │  [状态指示灯矩阵]                               │ ● OP ACTIVE   │
 * ├─────────────────────┬───────────────────────────┤ ■ △ALARM      │
 * │  INFO               │  [黑色 LED 显示屏]        │               │
 * │  ─────────          │  [ − ] [ + ]  [ ENTER ]   │               │
 * │  ─────────          │                           │               │
 * │  ─────────          │                           │               │
 * └─────────────────────┴───────────────────────────┴───────────────┘
 *
 * ── P&ID 流程元件说明 ──────────────────────────────────────────
 *  HFO  — 重燃油（Heavy Fuel Oil）入口
 *  DO   — 轻柴油（Diesel Oil）入口
 *  SP1/SP2 — 供油泵（Supply Pump）1/2，HFO 上路 SP2，DO 下路 SP1
 *  MF   — 混合过滤器（Mix Filter）
 *  AF   — 自动过滤器（Auto Filter）
 *  LS   — 液位开关（Level Switch）
 *  FT   — 流量变送器（Flow Transmitter）
 *  PS1/PS2 — 压力开关（Pressure Switch）
 *  CP1/CP2 — 循环泵（Circulation Pump）1/2
 *  SH   — 蒸汽加热器（Steam Heater）× 2
 *  SRV  — 蒸汽调节阀（Steam Regulating Valve），调节进入 SH 的蒸汽量，
 *          由粘度/温度 PID 控制器驱动，开度 0~100%
 *  TT   — 温度变送器（Temperature Transmitter）
 *  VT   — 粘度变送器（Viscosity Transmitter）
 *  +/-  — 燃油供给正/负压侧
 *
 * ── 右侧操作面板元件 ──────────────────────────────────────────
 *  START/STOP — 系统启停按钮（带 LED）
 *  HFO        — 重燃油模式指示 LED
 *  DO         — 轻柴油模式按钮（带 LED）
 *  PROCESS INFO — 过程信息按钮
 *  OP ACTIVE  — 操作激活指示 LED
 *  ALARM      — 报警按钮（带 △ 图标和 LED）
 *
 * ── 下方控制区 ───────────────────────────────────────────────
 *  INFO 区    — 滚动显示运行状态/报警信息文本
 *  LED 显示屏 — 4位7段显示（参数值）
 *  [−] [+]    — 参数减/增按钮
 *  [ENTER]    — 确认/进入按钮
 *
 * ── 仿真逻辑 ─────────────────────────────────────────────────
 *  1. 系统状态机：STOPPED → STARTING → RUNNING_DO → 切换 → RUNNING_HFO → STOPPING
 *  2. 燃油切换：DO 模式（冷机启动）→ 预热完成 → HFO 模式
 *  3. 泵控制：CP1/CP2 交替运行（主/备泵轮换）
 *  4. 粘度控制：通过 SH 蒸汽加热调节 HFO 粘度至设定值（典型 13~15 cSt）
 *  5. 压力监控：PS1/PS2 超限触发报警
 *  6. 温度仿真：一阶惯性响应，τ=60s
 *  7. 流量仿真：与泵运行状态和粘度联动
 *  8. INFO 区：轮显运行参数和故障信息
 *
 * ── 端口 ─────────────────────────────────────────────────────
 *  port_hfo_in    — HFO 进油压力信号
 *  port_do_in     — DO 进油压力信号
 *  port_tt_out    — 温度变送器输出
 *  port_vt_out    — 粘度变送器输出
 *  port_ft_out    — 流量变送器输出
 *  port_alarm_out — 报警继电器输出
 */

import { BaseComponent } from './BaseComponent.js';

/**
 * Alfa Laval EPC-50B 燃油供油单元 FCM 控制器仿真组件
 * （Fuel Conditioning Module – EPC Pump Control）
 *
 * ═══════════════════════════════════════════════════════════════
 *
 * 控制逻辑：
 *  1. SP1/SP2 互为备用，根据 PS1（泵前压力）状态自动切换
 *  2. CP1/CP2 互为备用，根据 PS2（泵后压力）状态自动切换
 *  3. 蒸汽调节阀 SRV 由粘度 PI 控制器驱动
 *  4. 三通阀 0% = 全 DO，100% = 全 HFO
 */
export class EPC50BController extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        // ── 面板尺寸 ──
        this.width  = Math.max(640, config.width  || 780);
        this.height = Math.max(400, config.height || 490);

        this.type    = 'epc50b_fcm_ctrl';
        this.special = 'none';
        this.cache   = 'fixed';

        this.label = config.label || 'EPC50B';

        // ── 系统状态机 ──
        this._state     = 'STOPPED';  // STOPPED / STARTING / RUNNING_DO / PROCESS_FO / RUNNING_HFO / STOPPING
        this._stateTimer = 0;

        // ── 三通阀控制（0% = 全DO，100% = 全HFO）──
        this._threeWayValvePos = 0;
        
        // ── 燃油参数 ──
        this._fuelMode    = 'DO';   // 'DO' | 'HFO' | 'MIX'
        this._hfoRatio    = 0;
        this._temp        = 20;     // °C
        this._tempSP      = 135;    // °C
        this._viscosity   = 50;     // cSt
        this._viscSP      = 14;     // cSt
        this._pressure1   = 0;      // bar（PS1，泵前/供油压力）
        this._pressure2   = 0;      // bar（PS2，泵后/循环压力）
        this._flowRate    = 0;      // L/h
        this._level       = 75;     // %

        // ── SP1/SP2 供油泵（根据 PS1 切换）──
        this._sp1Running  = false;
        this._sp2Running  = false;
        this._activeSupplyPump = 1;     // 当前主供油泵 1/2
        this._supplyPumpSwitchDelay = 0; // 切换延迟计时器
        
        // ── CP1/CP2 循环泵（根据 PS2 切换）──
        this._cp1Running  = false;
        this._cp2Running  = false;
        this._activeCircPump = 1;       // 当前主循环泵 1/2
        this._circPumpSwitchDelay = 0;   // 切换延迟计时器

        // ── 加热器 ──
        this._sh1Active   = false;
        this._sh2Active   = false;

        // ── 蒸汽调节阀 SRV（粘度 PI 控制）──
        this._srvPos       = 0;     // 0~100%
        
        // 粘度 PI 控制器参数
        this._srvKp        = config.srvKp || 2.5;    // 比例增益
        this._srvKi        = config.srvKi || 0.15;   // 积分增益 (1/s)
        this._srvIntegral  = 0;
        this._srvOutputMax = 100;
        this._srvOutputMin = 0;
        
        // 粘度控制死区（cSt）
        this._viscDeadband = config.viscDeadband || 0.5;

        // ── 报警 ──
        this._alarms = {
            ps1Low:      false,   // 供油压力低（触发泵切换）
            ps1VeryLow:  false,   // 供油压力极低（紧急停）
            ps2Low:      false,   // 循环压力低（触发泵切换）
            ps2VeryLow:  false,   // 循环压力极低（紧急停）
            ps2High:     false,   // 泵后高压
            tempHigh:    false,
            viscHigh:    false,
            viscLow:     false,
            levelLow:    false,
            sp1Fault:    false,
            sp2Fault:    false,
            cp1Fault:    false,
            cp2Fault:    false,
        };
        this._anyAlarm    = false;
        this._alarmAcked  = false;

        // ── LED 指示灯 ──
        this._ledStartStop  = false;
        this._ledHFO        = false;
        this._ledDO         = false;
        this._ledProcessFO  = false;
        this._ledOpActive   = false;
        this._ledAlarm      = false;

        // ── 显示屏 ──
        this._dispValue     = '----';
        this._dispParamIdx  = 0;
        this._paramNames    = ['TEMP', 'VISC', 'PRES2', 'PRES1', 'FLOW', 'LEVL', '3WV'];

        // ── INFO 区 ──
        this._infoLines = ['SYSTEM READY', 'PRESS START TO BEGIN', '', '', ''];
        this._infoLineTexts = [];

        // ── 过程仿真 ──
        this._tau        = 60;   // 温度惯性 s
        this._blinkPhase = 0;

        // ── 压力阈值配置（可调）──
        this._ps1NormalMin   = config.ps1NormalMin || 2.0;   // 正常压力下限 bar
        this._ps1SwitchMin   = config.ps1SwitchMin || 1.5;   // 切换压力阈值 bar
        this._ps1EmergencyMin= config.ps1EmergencyMin || 0.8; // 紧急停机阈值 bar
        this._ps2NormalMin   = config.ps2NormalMin || 4.0;   // 正常压力下限 bar
        this._ps2SwitchMin   = config.ps2SwitchMin || 3.0;   // 切换压力阈值 bar
        this._ps2EmergencyMin= config.ps2EmergencyMin || 1.5; // 紧急停机阈值 bar
        this._ps2HighMax     = config.ps2HighMax || 8.5;     // 高压报警阈值 bar

        this._computeLayout();
        this._init();
        this._addPorts();
    }

    // ═══════════════════════════════════════════
    _computeLayout() {
        const W = this.width, H = this.height;
        this._pad = 8;

        this._pidAreaX = this._pad;
        this._pidAreaY = this._pad;
        this._pidAreaW = W * 0.735;
        this._pidAreaH = H * 0.575;

        const botY = this._pidAreaY + this._pidAreaH + 4;
        const botH = H - botY - this._pad;

        this._infoX = this._pad;
        this._infoY = botY;
        this._infoW = W * 0.26;
        this._infoH = botH;

        this._ctrlX = this._infoX + this._infoW + 4;
        this._ctrlY = botY;
        this._ctrlW = this._pidAreaW - this._infoW - 8;
        this._ctrlH = botH;

        this._opPanelX = this._pidAreaX + this._pidAreaW + 4;
        this._opPanelY = this._pad;
        this._opPanelW = W - this._opPanelX - this._pad;
        this._opPanelH = H - this._pad * 2;

        const pw = this._pidAreaW, ph = this._pidAreaH;
        this._pid = {
            mainY:     ph * 0.45,
            outputY:   ph * 0.45,
            fuelInX:   pw * 0.03,
            threeWayX: pw * 0.08,
            sp1X:      pw * 0.12,
            sp2X:      pw * 0.16,
            mfX:       pw * 0.24,
            lsX:       pw * 0.36,
            ftX:       pw * 0.44,
            ps1X:      pw * 0.50,
            cp1X:      pw * 0.56,
            cp2X:      pw * 0.60,
            sh1X:      pw * 0.65,
            sh2X:      pw * 0.69,
            ps2X:      pw * 0.77,
            ttX:       pw * 0.84,
            vtX:       pw * 0.90,
            srvX:      pw * 0.74,
            srvY:      ph * 0.14,
            outPosX:   pw * 0.97,
        };
    }

    _init() {
        this._drawPanelBody();
        this._drawPidArea();
        this._drawInfoArea();
        this._drawCtrlArea();
        this._drawOpPanel();
        
    }

    _drawPanelBody() {
        const W = this.width, H = this.height;
        this.group.add(new Konva.Rect({
            x: 3, y: 3, width: W, height: H,
            fill: 'rgba(0,0,0,0.35)', cornerRadius: 5,
        }));
        this.group.add(new Konva.Rect({
            x: 0, y: 0, width: W, height: H,
            fill: '#1a5a8a', stroke: '#0e3a5a', strokeWidth: 3, cornerRadius: 4,
        }));
        this.group.add(new Konva.Rect({
            x: this._pad * 0.5, y: this._pad * 0.5,
            width: W - this._pad, height: H - this._pad,
            fill: '#f0f4f8', cornerRadius: 3,
        }));
    }

    _drawPidArea() {
        const ax = this._pidAreaX, ay = this._pidAreaY;
        const aw = this._pidAreaW, ah = this._pidAreaH;
        const p = this._pid;

        this.group.add(new Konva.Rect({
            x: ax, y: ay, width: aw, height: ah,
            fill: '#e8f0f8', stroke: '#3a6a9a', strokeWidth: 1.5, cornerRadius: 3,
        }));

        this.group.add(new Konva.Text({
            x: ax + 8, y: ay + 5,
            text: 'EPC50B',
            fontSize: 14, fontStyle: 'bold',
            fontFamily: 'Arial, sans-serif',
            fill: '#1a3a5a',
        }));

        this._drawPipelines(ax, ay, aw, ah, p);
        this._drawPidComponents(ax, ay, aw, ah, p);
        this._drawPidLabels(ax, ay, aw, ah, p);
        this._drawPidDots(ax, ay, aw, ah, p);
    }

    _drawPipelines(ax, ay, aw, ah, p) {
        const lc = '#2a4a6a';
        const lw = 2.0;

        // 燃油入口 → 三通阀
        this.group.add(new Konva.Line({
            points: [ax + p.fuelInX, ay + p.mainY, ax + p.threeWayX + 6, ay + p.mainY],
            stroke: lc, strokeWidth: lw,
        }));

        // 三通阀 → SP 区
        this.group.add(new Konva.Line({
            points: [ax + p.threeWayX + 12, ay + p.mainY, ax + (p.sp1X + p.sp2X)/2, ay + p.mainY],
            stroke: lc, strokeWidth: lw,
        }));

        // 分叉到 SP1 和 SP2
        this.group.add(new Konva.Line({
            points: [ax + (p.sp1X + p.sp2X)/2, ay + p.mainY, ax + (p.sp1X + p.sp2X)/2, ay + p.mainY - 12, ax + p.sp2X, ay + p.mainY - 12],
            stroke: lc, strokeWidth: lw,
        }));
        this.group.add(new Konva.Line({
            points: [ax + (p.sp1X + p.sp2X)/2, ay + p.mainY, ax + (p.sp1X + p.sp2X)/2, ay + p.mainY + 12, ax + p.sp1X, ay + p.mainY + 12],
            stroke: lc, strokeWidth: lw,
        }));

        // SP 出口汇合
        this.group.add(new Konva.Line({
            points: [ax + p.sp2X + 8, ay + p.mainY - 12, ax + p.mfX, ay + p.mainY - 8],
            stroke: lc, strokeWidth: lw,
        }));
        this.group.add(new Konva.Line({
            points: [ax + p.sp1X + 8, ay + p.mainY + 12, ax + p.mfX, ay + p.mainY + 8],
            stroke: lc, strokeWidth: lw,
        }));

        // MF → LS → FT → PS1
        this.group.add(new Konva.Line({
            points: [ax + p.mfX + 14, ay + p.mainY, ax + p.lsX, ay + p.mainY],
            stroke: lc, strokeWidth: lw,
        }));
        this.group.add(new Konva.Line({
            points: [ax + p.lsX + 12, ay + p.mainY, ax + p.ftX, ay + p.mainY],
            stroke: lc, strokeWidth: lw,
        }));
        this.group.add(new Konva.Line({
            points: [ax + p.ftX + 10, ay + p.mainY, ax + p.ps1X, ay + p.mainY],
            stroke: lc, strokeWidth: lw,
        }));

        // PS1 → CP 区
        this.group.add(new Konva.Line({
            points: [ax + p.ps1X + 10, ay + p.mainY, ax + (p.cp1X + p.cp2X)/2, ay + p.mainY],
            stroke: lc, strokeWidth: lw,
        }));
        this.group.add(new Konva.Line({
            points: [ax + (p.cp1X + p.cp2X)/2, ay + p.mainY, ax + (p.cp1X + p.cp2X)/2, ay + p.mainY - 12, ax + p.cp2X, ay + p.mainY - 12],
            stroke: lc, strokeWidth: lw,
        }));
        this.group.add(new Konva.Line({
            points: [ax + (p.cp1X + p.cp2X)/2, ay + p.mainY, ax + (p.cp1X + p.cp2X)/2, ay + p.mainY + 12, ax + p.cp1X, ay + p.mainY + 12],
            stroke: lc, strokeWidth: lw,
        }));

        // CP → SH
        this.group.add(new Konva.Line({
            points: [ax + p.cp2X + 8, ay + p.mainY - 12, ax + p.shX, ay + p.mainY - 8],
            stroke: lc, strokeWidth: lw,
        }));
        this.group.add(new Konva.Line({
            points: [ax + p.cp1X + 8, ay + p.mainY + 12, ax + p.shX, ay + p.mainY + 8],
            stroke: lc, strokeWidth: lw,
        }));

        // SH → PS2 → TT → VT → 出口
        this.group.add(new Konva.Line({
            points: [ax + p.sh2X + 8, ay + p.mainY - 8, ax + p.ps2X, ay + p.mainY],
            stroke: lc, strokeWidth: lw,
        }));
        this.group.add(new Konva.Line({
            points: [ax + p.sh1X + 8, ay + p.mainY + 8, ax + p.ps2X, ay + p.mainY],
            stroke: lc, strokeWidth: lw,
        }));
        this.group.add(new Konva.Line({
            points: [ax + p.ps2X + 10, ay + p.mainY, ax + p.ttX, ay + p.mainY],
            stroke: lc, strokeWidth: lw,
        }));
        this.group.add(new Konva.Line({
            points: [ax + p.ttX + 10, ay + p.mainY, ax + p.vtX, ay + p.mainY],
            stroke: lc, strokeWidth: lw,
        }));
        this.group.add(new Konva.Line({
            points: [ax + p.vtX + 10, ay + p.mainY, ax + p.outPosX, ay + p.mainY],
            stroke: lc, strokeWidth: lw,
        }));

        // 出口箭头
        this.group.add(new Konva.Line({
            points: [ax + p.outPosX - 8, ay + p.mainY - 4, ax + p.outPosX, ay + p.mainY, ax + p.outPosX - 8, ay + p.mainY + 4],
            stroke: lc, strokeWidth: 1.5, lineJoin: 'round',
        }));

        // SRV 支管
        const srvConnX = ax + p.shX + 5;
        this.group.add(new Konva.Line({
            points: [srvConnX, ay + p.mainY - 20, srvConnX, ay + p.srvY + 12],
            stroke: '#8a5a3a', strokeWidth: 1.2, dash: [3, 2],
        }));
        this.group.add(new Konva.Line({
            points: [ax + aw * 0.62, ay + p.srvY, ax + p.outPosX - 10, ay + p.srvY],
            stroke: '#8a5a3a', strokeWidth: 1.2,
        }));
    }

    _drawPidComponents(ax, ay, aw, ah, p) {
        const r = Math.min(aw, ah) * 0.038;
        this._drawThreeWayValve(ax + p.threeWayX, ay + p.mainY);
        this._sp1Shape = this._drawPumpSymbol(ax + p.sp1X, ay + p.mainY + 12, r, 'SP1');
        this._sp2Shape = this._drawPumpSymbol(ax + p.sp2X, ay + p.mainY - 12, r, 'SP2');
        this._drawFilter(ax + p.mfX, ay + p.mainY, 'MF');
        this._drawLevelSwitch(ax + p.lsX, ay + p.mainY);
        this._drawSensorCircle(ax + p.ftX, ay + p.mainY, r * 0.85, 'FT');
        this._drawSensorCircle(ax + p.ps1X, ay + p.mainY, r * 0.85, 'PS1');
        this._cp1Shape = this._drawPumpSymbol(ax + p.cp1X, ay + p.mainY + 12, r, 'CP1');
        this._cp2Shape = this._drawPumpSymbol(ax + p.cp2X, ay + p.mainY - 12, r, 'CP2');
        this._sh1Shape = this._drawHeater(ax + p.sh1X, ay + p.mainY + 8, 'SH');
        this._sh2Shape = this._drawHeater(ax + p.sh2X, ay + p.mainY - 8, 'SH');
        this._drawSRV(ax + p.srvX, ay + p.srvY);
        this._drawSensorCircle(ax + p.ps2X, ay + p.mainY, r * 0.85, 'PS2');
        this._drawSensorCircle(ax + p.ttX, ay + p.mainY, r * 0.85, 'TT');
        this._drawSensorCircle(ax + p.vtX, ay + p.mainY, r * 0.85, 'VT');
    }

    _drawThreeWayValve(cx, cy) {
        const s = 10;
        this.group.add(new Konva.Line({
            points: [cx - s, cy - 6, cx + s, cy, cx - s, cy + 6, cx - s, cy - 6],
            closed: true, fill: '#d0e4f0', stroke: '#3a6a9a', strokeWidth: 1.2,
        }));
        this.group.add(new Konva.Line({
            points: [cx - s - 4, cy, cx - s, cy],
            stroke: '#3a6a9a', strokeWidth: 1,
        }));
        this.group.add(new Konva.Line({
            points: [cx + s, cy, cx + s + 6, cy],
            stroke: '#3a6a9a', strokeWidth: 1,
        }));
        
        this._threeWayIndicator = new Konva.Rect({
            x: cx - s + 2, y: cy - 3,
            width: (s * 2 - 4) * (this._threeWayValvePos / 100),
            height: 6, fill: '#ff8833', cornerRadius: 1,
        });
        this.group.add(this._threeWayIndicator);
        
        this._threeWayPosText = new Konva.Text({
            x: cx - 15, y: cy + 12, width: 30, text: '0%',
            fontSize: 6.5, fill: '#1a3a5a', fontFamily: 'Arial', align: 'center',
        });
        this.group.add(this._threeWayPosText);
        
        this.group.add(new Konva.Text({
            x: cx - 8, y: cy + 22, text: '3WV', fontSize: 7, fill: '#1a3a5a',
        }));
        this.group.add(new Konva.Text({
            x: cx - 25, y: cy - 3, text: 'DO←', fontSize: 6, fill: '#3a6a9a',
        }));
        this.group.add(new Konva.Text({
            x: cx - 25, y: cy + 3, text: '→HFO', fontSize: 6, fill: '#3a6a9a',
        }));
    }

    _drawSensorCircle(cx, cy, r, label) {
        this.group.add(new Konva.Circle({
            x: cx, y: cy, radius: r,
            fill: '#d8e8f0', stroke: '#3a6a9a', strokeWidth: 1,
        }));
        this.group.add(new Konva.Text({
            x: cx - r * 1.2, y: cy + r + 2, width: r * 2.4, text: label,
            fontSize: 7, fill: '#1a3a5a', fontFamily: 'Arial', align: 'center',
        }));
    }

    _drawFilter(cx, cy, label) {
        const fw = 14, fh = 12;
        this.group.add(new Konva.Rect({
            x: cx - fw / 2, y: cy - fh / 2, width: fw, height: fh,
            fill: '#d0e4f0', stroke: '#3a6a9a', strokeWidth: 1, cornerRadius: 1,
        }));
        for (let i = -1; i <= 2; i++) {
            this.group.add(new Konva.Line({
                points: [cx - fw / 2 + i * 4, cy - fh / 2, cx - fw / 2 + i * 4 + 4, cy + fh / 2],
                stroke: '#5a8aaa', strokeWidth: 0.7,
            }));
        }
        this.group.add(new Konva.Text({
            x: cx - 10, y: cy + fh / 2 + 2, text: label, fontSize: 7, fill: '#1a3a5a',
        }));
    }

    _drawLevelSwitch(cx, cy) {
        const lw = 16, lh = 20;
        this.group.add(new Konva.Rect({
            x: cx - lw / 2, y: cy - lh / 2, width: lw, height: lh,
            fill: '#c8e0f0', stroke: '#3a6a9a', strokeWidth: 1, cornerRadius: 1,
        }));
        this._lsLiquid = new Konva.Rect({
            x: cx - lw / 2 + 1, y: cy + lh / 2,
            width: lw - 2, height: 0,
            fill: 'rgba(80,160,220,0.35)',
        });
        this.group.add(this._lsLiquid);
        this.group.add(new Konva.Text({
            x: cx - 8, y: cy + lh / 2 + 3, text: 'LS', fontSize: 7, fill: '#1a3a5a',
        }));
    }

    _drawPumpSymbol(cx, cy, r, label) {
        const body = new Konva.Circle({
            x: cx, y: cy, radius: r,
            fill: '#b8d4ec', stroke: '#3a6a9a', strokeWidth: 1.2,
        });
        this.group.add(body);
        this.group.add(new Konva.Line({
            points: [cx - r * 0.45, cy - r * 0.6, cx + r * 0.55, cy, cx - r * 0.45, cy + r * 0.6],
            closed: true, fill: '#3a6a9a',
        }));
        this.group.add(new Konva.Text({
            x: cx - 10, y: cy + r + 2, width: 20, text: label,
            fontSize: 7, fill: '#1a3a5a', fontFamily: 'Arial', align: 'center',
        }));
        return body;
    }

    _drawHeater(cx, cy, label) {
        const hw = 16, hh = 18;
        const body = new Konva.Rect({
            x: cx - hw / 2, y: cy - hh / 2, width: hw, height: hh,
            fill: '#f0d8c8', stroke: '#8a4a2a', strokeWidth: 1, cornerRadius: 1,
        });
        this.group.add(body);
        for (let i = 0; i < 2; i++) {
            const hy = cy - hh / 4 + i * hh / 2.5;
            this.group.add(new Konva.Line({
                points: [cx - hw / 2 + 2, hy, cx - hw / 4, hy - 3, cx, hy + 3, cx + hw / 4, hy - 3, cx + hw / 2 - 2, hy],
                stroke: '#8a4a2a', strokeWidth: 0.8, tension: 0.5,
            }));
        }
        this.group.add(new Konva.Text({
            x: cx - 8, y: cy + hh / 2 + 2, text: label, fontSize: 7, fill: '#1a3a5a',
        }));
        return body;
    }

    _drawSRV(cx, cy) {
        this.group.add(new Konva.Rect({
            x: cx - 9, y: cy - 18, width: 18, height: 12,
            fill: '#c8d8e8', stroke: '#3a6a9a', strokeWidth: 1, cornerRadius: 1,
        }));
        this.group.add(new Konva.Line({
            points: [cx - 9, cy - 12, cx + 9, cy - 12], stroke: '#3a6a9a', strokeWidth: 0.8,
        }));
        this.group.add(new Konva.Line({
            points: [cx, cy - 6, cx, cy], stroke: '#3a6a9a', strokeWidth: 1.5,
        }));
        this.group.add(new Konva.Line({
            points: [cx - 8, cy, cx + 8, cy, cx, cy + 10, cx - 8, cy],
            closed: true, fill: '#d8eaf8', stroke: '#3a6a9a', strokeWidth: 1,
        }));
        this.group.add(new Konva.Line({
            points: [cx - 8, cy + 10, cx + 8, cy + 10, cx, cy, cx - 8, cy + 10],
            closed: true, fill: '#d8eaf8', stroke: '#3a6a9a', strokeWidth: 1,
        }));
        
        this._srvFill = new Konva.Rect({
            x: cx - 7, y: cy + 5, width: 14, height: 0,
            fill: 'rgba(220,80,30,0.45)',
        });
        this.group.add(this._srvFill);
        
        this._srvPosText = new Konva.Text({
            x: cx - 14, y: cy + 22, width: 28, text: '0%',
            fontSize: 6.5, fill: '#1a3a5a', fontFamily: 'Arial', align: 'center',
        });
        this.group.add(this._srvPosText);
        
        this.group.add(new Konva.Text({
            x: cx - 10, y: cy + 32, text: 'SRV', fontSize: 7, fill: '#1a3a5a',
        }));
        this.group.add(new Konva.Text({
            x: cx - 28, y: cy - 16, text: '←STM', fontSize: 6, fill: '#8a4a2a',
        }));
    }

    _drawPidLabels(ax, ay, aw, ah, p) {
        this.group.add(new Konva.Line({
            points: [ax + 2, ay + p.mainY, ax + p.fuelInX, ay + p.mainY], stroke: '#2a4a6a', strokeWidth: 2,
        }));
        this.group.add(new Konva.Line({
            points: [ax + p.fuelInX - 8, ay + p.mainY - 4, ax + p.fuelInX, ay + p.mainY, ax + p.fuelInX - 8, ay + p.mainY + 4],
            stroke: '#2a4a6a', strokeWidth: 1.5, lineJoin: 'round',
        }));
    }

    _drawPidDots(ax, ay, aw, ah, p) {
        const dotR = Math.min(aw, ah) * 0.025;
        const dotDefs = [
            { id: 'fuel_in',     x: p.fuelInX + 3,   y: p.mainY - 22 },
            { id: 'three_way',   x: p.threeWayX,     y: p.mainY - 22 },
            { id: 'sp1',         x: p.sp1X,          y: p.mainY + 20 },
            { id: 'sp2',         x: p.sp2X,          y: p.mainY - 20 },
            { id: 'mf',          x: p.mfX,           y: p.mainY - 22 },
            { id: 'ls',          x: p.lsX,           y: p.mainY - 22 },
            { id: 'ft',          x: p.ftX,           y: p.mainY - 22 },
            { id: 'ps1',         x: p.ps1X,          y: p.mainY - 22 },
            { id: 'cp1',         x: p.cp1X,          y: p.mainY + 20 },
            { id: 'cp2',         x: p.cp2X,          y: p.mainY - 20 },
            { id: 'sh1',         x: p.sh1X,          y: p.mainY + 16 },
            { id: 'sh2',         x: p.sh2X,          y: p.mainY - 16 },
            { id: 'ps2',         x: p.ps2X,          y: p.mainY - 22 },
            { id: 'tt',          x: p.ttX,           y: p.mainY - 22 },
            { id: 'vt',          x: p.vtX,           y: p.mainY - 22 },
            { id: 'srv',         x: p.srvX,          y: p.srvY + 5 },
        ];

        this._pidDotShapes = {};
        dotDefs.forEach(def => {
            const dot = new Konva.Circle({
                x: ax + def.x, y: ay + def.y, radius: dotR,
                fill: '#9ab0c0', stroke: '#6a8aa0', strokeWidth: 0.7,
                shadowColor: 'transparent', shadowBlur: 0,
            });
            this.group.add(dot);
            this._pidDotShapes[def.id] = { dot, def };
        });
    }

    _updatePidDot(id, state) {
        const colors = {
            ok:    { fill: '#44cc66', shadow: '#22aa44' },
            warn:  { fill: '#ffaa22', shadow: '#ff8800' },
            alarm: { fill: '#ff3322', shadow: '#cc2200' },
            off:   { fill: '#9ab0c0', shadow: 'transparent' },
        };
        const s = this._pidDotShapes?.[id];
        if (!s) return;
        const c = colors[state] || colors.off;
        s.dot.fill(c.fill);
        s.dot.shadowColor(c.shadow);
        s.dot.shadowBlur(state !== 'off' ? 5 : 0);
        s.dot.shadowOpacity(0.8);
    }

    _drawInfoArea() {
        const ix = this._infoX, iy = this._infoY;
        const iw = this._infoW, ih = this._infoH;

        this.group.add(new Konva.Rect({
            x: ix, y: iy, width: iw, height: ih,
            fill: '#e8f0f8', stroke: '#3a6a9a', strokeWidth: 1, cornerRadius: 2,
        }));
        this.group.add(new Konva.Text({
            x: ix + 5, y: iy + 3, text: 'INFO', fontSize: 9, fontStyle: 'bold',
            fill: '#1a3a5a', fontFamily: 'Arial',
        }));

        this._infoLineTexts = [];
        for (let i = 0; i < 5; i++) {
            const ly = iy + 18 + i * (ih - 18) / 5;
            this.group.add(new Konva.Line({
                points: [ix + 4, ly, ix + iw - 4, ly],
                stroke: '#aac0d0', strokeWidth: 0.7,
            }));
            const lt = new Konva.Text({
                x: ix + 5, y: ly + 2, width: iw - 10, text: this._infoLines[i] || '',
                fontSize: 7.5, fill: '#1a3a5a', fontFamily: 'Arial, monospace',
            });
            this.group.add(lt);
            this._infoLineTexts.push(lt);
        }
    }

    _drawCtrlArea() {
        const cx = this._ctrlX, cy = this._ctrlY;
        const cw = this._ctrlW, ch = this._ctrlH;

        this.group.add(new Konva.Rect({
            x: cx, y: cy, width: cw, height: ch,
            fill: '#e0e8f0', stroke: '#3a6a9a', strokeWidth: 0.8, cornerRadius: 2,
        }));

        const dispH = ch * 0.42, dispW = cw * 0.88;
        const dispX = cx + cw * 0.06, dispY = cy + ch * 0.05;

        this.group.add(new Konva.Rect({
            x: dispX - 3, y: dispY - 3, width: dispW + 6, height: dispH + 6,
            fill: '#303030', stroke: '#101010', strokeWidth: 1.5, cornerRadius: 3,
        }));
        this.group.add(new Konva.Rect({
            x: dispX, y: dispY, width: dispW, height: dispH,
            fill: '#0a0a0a', cornerRadius: 2,
        }));

        this._ctrlDisp = new Konva.Text({
            x: dispX + 4, y: dispY + dispH * 0.12, width: dispW - 8, height: dispH - dispH * 0.12,
            text: this._dispValue, fontSize: dispH * 0.68, fontStyle: 'bold',
            fontFamily: '"Courier New", monospace', fill: '#22cc44',
            shadowColor: '#22cc44', shadowBlur: 4, shadowOpacity: 0.6, align: 'center',
        });
        this.group.add(this._ctrlDisp);

        this._ctrlParamName = new Konva.Text({
            x: dispX, y: cy + 3, width: dispW, text: this._paramNames[0],
            fontSize: 7.5, fill: '#3a5a7a', fontFamily: 'Arial', align: 'center',
        });
        this.group.add(this._ctrlParamName);

        const btnY = cy + ch * 0.55;
        const btnDefs = [
            { label: '−', x: cx + cw * 0.08, w: cw * 0.22, h: ch * 0.35, id: 'minus', color: '#3a5a7a' },
            { label: '+', x: cx + cw * 0.34, w: cw * 0.22, h: ch * 0.35, id: 'plus',  color: '#3a5a7a' },
            { label: 'ENTER', x: cx + cw * 0.60, w: cw * 0.32, h: ch * 0.35, id: 'enter', color: '#2a4a2a' },
        ];
        btnDefs.forEach(bd => {
            this.group.add(new Konva.Rect({
                x: bd.x + 2, y: btnY + 2, width: bd.w, height: bd.h,
                fill: '#1a2a3a', cornerRadius: 3,
            }));
            const btn = new Konva.Rect({
                x: bd.x, y: btnY, width: bd.w, height: bd.h,
                fillLinearGradientStartPoint: { x: 0, y: 0 },
                fillLinearGradientEndPoint:   { x: 0, y: bd.h },
                fillLinearGradientColorStops: [
                    0,   this._lighten(bd.color, 0.2),
                    0.5, bd.color,
                    1,   this._darken(bd.color, 0.3),
                ],
                stroke: this._darken(bd.color, 0.4), strokeWidth: 1, cornerRadius: 3,
            });
            this.group.add(btn);
            this.group.add(new Konva.Text({
                x: bd.x, y: btnY + bd.h * 0.18, width: bd.w, height: bd.h,
                text: bd.label, fontSize: bd.id === 'enter' ? 9 : 12,
                fontStyle: 'bold', fontFamily: 'Arial, sans-serif',
                fill: '#e0e8f0', align: 'center',
            }));
            btn.on('mouseenter', () => { btn.opacity(0.75); this._refreshCache(); });
            btn.on('mouseleave', () => { btn.opacity(1.00); this._refreshCache(); });
            btn.on('click tap', () => this._onCtrlKey(bd.id));
        });
    }

    _drawOpPanel() {
        const ox = this._opPanelX, oy = this._opPanelY;
        const ow = this._opPanelW, oh = this._opPanelH;

        this.group.add(new Konva.Rect({
            x: ox, y: oy, width: ow, height: oh,
            fill: '#dce8f0', stroke: '#3a6a9a', strokeWidth: 1, cornerRadius: 2,
        }));

        const rowDefs = [
            { id: 'start_stop', ledColor: '#22dd44', btnColor: '#2a4a2a', label: 'START/STOP', hasBtn: true  },
            { id: 'hfo',        ledColor: '#22dd44', btnColor: null,      label: 'HFO',         hasBtn: false },
            { id: 'do',         ledColor: '#22dd44', btnColor: '#2a4a2a', label: 'DO',           hasBtn: true  },
            { id: 'proc_fo',    ledColor: '#22dd44', btnColor: '#2a4a2a', label: 'PROCESS IN FO.', hasBtn: true },
            { id: 'op_active',  ledColor: '#22dd44', btnColor: null,      label: 'OP ACTIVE',   hasBtn: false },
            { id: 'alarm',      ledColor: '#ff3322', btnColor: '#4a2a2a', label: '△ ALARM',      hasBtn: true  },
        ];

        const rowH = oh / rowDefs.length;
        this._opLEDs = {};
        this._opBtns = {};

        rowDefs.forEach((rd, i) => {
            const ry = oy + i * rowH;
            if (i > 0) {
                this.group.add(new Konva.Line({
                    points: [ox, ry, ox + ow, ry], stroke: '#b0c8da', strokeWidth: 0.7,
                }));
            }

            const ledR = Math.min(ow, rowH) * 0.14;
            const ledCX = ox + ow * 0.12, ledCY = ry + rowH * 0.28;
            this.group.add(new Konva.Circle({
                x: ledCX, y: ledCY, radius: ledR * 1.3,
                fill: '#505060', stroke: '#303040', strokeWidth: 0.7,
            }));
            const ledDot = new Konva.Circle({
                x: ledCX, y: ledCY, radius: ledR,
                fill: '#202020', stroke: '#303030', strokeWidth: 0.7,
                shadowColor: 'transparent', shadowBlur: 0,
            });
            this.group.add(ledDot);
            this.group.add(new Konva.Circle({
                x: ledCX - ledR * 0.28, y: ledCY - ledR * 0.28,
                radius: ledR * 0.30, fill: 'rgba(255,255,255,0.15)',
            }));
            this._opLEDs[rd.id] = { dot: ledDot, activeColor: rd.ledColor };

            if (rd.hasBtn) {
                const bw = ow * 0.70, bh = rowH * 0.55;
                const bx = ox + ow * 0.12, by = ry + rowH * 0.46;
                this.group.add(new Konva.Rect({
                    x: bx + 2, y: by + 2, width: bw, height: bh,
                    fill: '#1a2030', cornerRadius: 2,
                }));
                const btn = new Konva.Rect({
                    x: bx, y: by, width: bw, height: bh,
                    fillLinearGradientStartPoint: { x: 0, y: 0 },
                    fillLinearGradientEndPoint:   { x: 0, y: bh },
                    fillLinearGradientColorStops: [
                        0,   this._lighten(rd.btnColor, 0.15),
                        0.5, rd.btnColor,
                        1,   this._darken(rd.btnColor, 0.25),
                    ],
                    stroke: this._darken(rd.btnColor, 0.35), strokeWidth: 0.8, cornerRadius: 2,
                });
                this.group.add(btn);
                btn.on('mouseenter', () => { btn.opacity(0.75); this._refreshCache(); });
                btn.on('mouseleave', () => { btn.opacity(1.00); this._refreshCache(); });
                btn.on('click tap', () => this._onOpBtn(rd.id));
                this._opBtns[rd.id] = btn;
            }

            this.group.add(new Konva.Text({
                x: ox + ow * 0.18, y: ry + rowH * 0.22,
                width: ow * 0.78, text: rd.label, fontSize: 8, fill: '#1a3a5a', fontFamily: 'Arial, sans-serif',
            }));
        });
    }

    _setOpLED(id, on) {
        const led = this._opLEDs?.[id];
        if (!led) return;
        led.dot.fill(on ? led.activeColor : '#202020');
        led.dot.stroke(on ? led.activeColor : '#303030');
        led.dot.shadowColor(on ? led.activeColor : 'transparent');
        led.dot.shadowBlur(on ? 8 : 0);
        led.dot.shadowOpacity(0.85);
    }

    // ═══════════════════════════════════════════
    // 粘度 PI 控制器
    // ═══════════════════════════════════════════
    _calcViscosityPID(dt) {
        if (dt <= 0) return;
        
        const error = this._viscSP - this._viscosity;
        
        // 死区处理：在死区范围内不调整
        let adjustedError = error;
        if (Math.abs(error) < this._viscDeadband) {
            adjustedError = 0;
        }
        
        // 比例项
        const P = this._srvKp * adjustedError;
        
        // 积分项（仅当误差超出死区或积分不饱和时累积）
        if (Math.abs(error) >= this._viscDeadband || 
            (this._srvIntegral > 0 && error < 0) || 
            (this._srvIntegral < 0 && error > 0)) {
            this._srvIntegral += adjustedError * dt * this._srvKi;
            // 积分限幅
            this._srvIntegral = Math.max(-50, Math.min(50, this._srvIntegral));
        }
        const I = this._srvIntegral;
        
        // PI 输出
        let output = P + I;
        output = Math.max(this._srvOutputMin, Math.min(this._srvOutputMax, output));
        
        // 一阶惯性更新阀位（模拟执行机构响应）
        this._srvPos += ((output - this._srvPos) / 3) * dt;
        this._srvPos = Math.max(0, Math.min(100, this._srvPos));
    }

    // ═══════════════════════════════════════════
    // 泵切换逻辑
    // ═══════════════════════════════════════════
    
    // SP1/SP2 根据 PS1（供油压力）切换
    _manageSupplyPumpByPS1(dt) {
        if (this._state === 'STOPPED' || this._state === 'STOPPING') return;
        
        const ps1Low = this._pressure1 < this._ps1SwitchMin;
        const ps1VeryLow = this._pressure1 < this._ps1EmergencyMin;
        
        // 极低压力：紧急停机
        if (ps1VeryLow && this._state !== 'STOPPED') {
            this._alarms.ps1VeryLow = true;
            this._setState('STOPPING');
            return;
        }
        
        this._alarms.ps1Low = ps1Low && !ps1VeryLow;
        
        if (ps1Low && this._supplyPumpSwitchDelay <= 0) {
            // 压力低，启动切换延迟
            this._supplyPumpSwitchDelay = 2.0; // 2秒延迟确认
        }
        
        if (this._supplyPumpSwitchDelay > 0) {
            this._supplyPumpSwitchDelay -= dt;
            if (this._supplyPumpSwitchDelay <= 0 && ps1Low) {
                // 延迟后压力仍然低，执行泵切换
                const oldPump = this._activeSupplyPump;
                this._activeSupplyPump = this._activeSupplyPump === 1 ? 2 : 1;
                // 记录故障（原主泵故障）
                if (oldPump === 1) this._alarms.sp1Fault = true;
                else this._alarms.sp2Fault = true;
                
                this._updateInfoLines();
                
                // 切换后压力恢复需要时间，重新设置延迟避免频繁切换
                this._supplyPumpSwitchDelay = 10.0;
            }
        }
        
        // 压力恢复正常后重置延迟
        if (!ps1Low && this._supplyPumpSwitchDelay > 0 && this._supplyPumpSwitchDelay < 10) {
            this._supplyPumpSwitchDelay = 0;
            // 可选：清除故障标志（模拟修复）
            // this._alarms.sp1Fault = false;
            // this._alarms.sp2Fault = false;
        }
    }
    
    // CP1/CP2 根据 PS2（循环压力）切换
    _manageCircPumpByPS2(dt) {
        if (this._state === 'STOPPED' || this._state === 'STOPPING') return;
        
        const ps2Low = this._pressure2 < this._ps2SwitchMin;
        const ps2VeryLow = this._pressure2 < this._ps2EmergencyMin;
        
        // 极低压力：紧急停机
        if (ps2VeryLow && this._state !== 'STOPPED') {
            this._alarms.ps2VeryLow = true;
            this._setState('STOPPING');
            return;
        }
        
        this._alarms.ps2Low = ps2Low && !ps2VeryLow;
        
        if (ps2Low && this._circPumpSwitchDelay <= 0) {
            this._circPumpSwitchDelay = 2.0;
        }
        
        if (this._circPumpSwitchDelay > 0) {
            this._circPumpSwitchDelay -= dt;
            if (this._circPumpSwitchDelay <= 0 && ps2Low) {
                const oldPump = this._activeCircPump;
                this._activeCircPump = this._activeCircPump === 1 ? 2 : 1;
                if (oldPump === 1) this._alarms.cp1Fault = true;
                else this._alarms.cp2Fault = true;
                
                this._updateInfoLines();
                this._circPumpSwitchDelay = 10.0;
            }
        }
        
        if (!ps2Low && this._circPumpSwitchDelay > 0 && this._circPumpSwitchDelay < 10) {
            this._circPumpSwitchDelay = 0;
        }
    }

    // ═══════════════════════════════════════════
    // 动画主循环
    // ═══════════════════════════════════════════
    // 集中化 tick（由 consys._tickAll 在 20fps 调用）
    tick(dt) {
        this._simulate(dt);
        this._refreshDisplay();
    }
    _simulate(dt) {
        this._stateTimer += dt;
        this._blinkPhase += dt;

        // 根据压力状态管理泵切换
        this._manageSupplyPumpByPS1(dt);
        this._manageCircPumpByPS2(dt);

        switch (this._state) {
            case 'STOPPED':
                this._sp1Running = false;
                this._sp2Running = false;
                this._cp1Running = false;
                this._cp2Running = false;
                this._sh1Active = false;
                this._sh2Active = false;
                this._threeWayValvePos = 0;
                this._srvPos = 0;
                this._srvIntegral = 0;
                this._flowRate = 0;
                this._temp += ((20 - this._temp) / 120) * dt;
                this._viscosity += ((50 - this._viscosity) / 120) * dt;
                this._pressure1 = 0;
                this._pressure2 = 0;
                break;

            case 'STARTING':
                this._threeWayValvePos = 0;
                this._fuelMode = 'DO';
                this._hfoRatio = 0;
                this._sp1Running = (this._activeSupplyPump === 1) && this._stateTimer > 0.5;
                this._sp2Running = (this._activeSupplyPump === 2) && this._stateTimer > 0.5;
                this._cp1Running = (this._activeCircPump === 1) && this._stateTimer > 1.5;
                this._cp2Running = (this._activeCircPump === 2) && this._stateTimer > 1.5;
                
                // 启动时建立压力
                if (this._stateTimer > 0.5) {
                    this._pressure1 = 2.0 * Math.min(1, this._stateTimer / 2);
                    this._pressure2 = 4.0 * Math.min(1, this._stateTimer / 3);
                }
                
                if (this._stateTimer >= 3 && this._pressure2 > 2.0) {
                    this._setState('RUNNING_DO');
                }
                break;

            case 'RUNNING_DO':
                this._threeWayValvePos = 0;
                this._fuelMode = 'DO';
                this._hfoRatio = 0;
                this._sp1Running = (this._activeSupplyPump === 1);
                this._sp2Running = (this._activeSupplyPump === 2);
                this._cp1Running = (this._activeCircPump === 1);
                this._cp2Running = (this._activeCircPump === 2);
                this._sh1Active = false;
                this._sh2Active = false;
                
                // 粘度 PI 控制（DO 模式下阀位趋于 0）
                this._calcViscosityPID(dt);
                this._srvPos += ((0 - this._srvPos) / 5) * dt;
                
                // DO 运行参数
                this._temp += ((45 - this._temp) / 80) * dt;
                this._viscosity += ((4 - this._viscosity) / 80) * dt;
                
                // 压力由泵运行状态决定
                const supplyRunning = this._sp1Running || this._sp2Running;
                const circRunning = this._cp1Running || this._cp2Running;
                this._pressure1 = supplyRunning ? (2.5 + Math.sin(this._stateTimer * 0.3) * 0.15) : 0;
                this._pressure2 = circRunning ? (5.0 + Math.sin(this._stateTimer * 0.3) * 0.2) : 0;
                this._flowRate = supplyRunning && circRunning ? (850 + (Math.random() - 0.5) * 20) : 0;
                break;

            case 'PROCESS_FO':
                // 三通阀逐渐打开
                this._threeWayValvePos += dt * 3.33;
                this._threeWayValvePos = Math.min(100, this._threeWayValvePos);
                this._hfoRatio = this._threeWayValvePos;
                this._fuelMode = this._threeWayValvePos > 95 ? 'HFO' : (this._threeWayValvePos < 5 ? 'DO' : 'MIX');
                
                // 双泵运行
                this._sp1Running = true;
                this._sp2Running = true;
                this._cp1Running = (this._activeCircPump === 1);
                this._cp2Running = (this._activeCircPump === 2);
                this._sh1Active = true;
                this._sh2Active = true;
                
                // 粘度 PI 控制 SRV
                this._calcViscosityPID(dt);
                
                // 温度响应
                const heatInput = this._srvPos / 100;
                this._temp += ((this._tempSP * heatInput + 20 * (1 - heatInput) - this._temp) / this._tau) * dt;
                
                // 粘度随 HFO 比例变化
                const targetVisc = 4 + (this._viscSP + 2) * (this._hfoRatio / 100);
                this._viscosity += ((targetVisc - this._viscosity) / this._tau) * dt;
                
                // 压力
                this._pressure1 = 3.0 + Math.sin(this._stateTimer * 0.25) * 0.15;
                this._pressure2 = 6.5 + Math.sin(this._stateTimer * 0.25) * 0.25;
                this._flowRate = 820 + (Math.random() - 0.5) * 15;
                
                if (this._threeWayValvePos >= 99 && this._temp > 100 && this._stateTimer > 15) {
                    this._setState('RUNNING_HFO');
                }
                break;

            case 'RUNNING_HFO':
                this._threeWayValvePos = 100;
                this._fuelMode = 'HFO';
                this._hfoRatio = 100;
                this._sh1Active = this._srvPos > 5;
                this._sh2Active = this._srvPos > 30;
                
                // 供油泵：主泵运行
                this._sp1Running = (this._activeSupplyPump === 1);
                this._sp2Running = (this._activeSupplyPump === 2);
                
                // 循环泵运行
                this._cp1Running = (this._activeCircPump === 1);
                this._cp2Running = (this._activeCircPump === 2);
                
                // 粘度 PI 控制 SRV
                this._calcViscosityPID(dt);
                
                // 温度响应
                const heat = this._srvPos / 100;
                const tempTarget = this._tempSP * heat + 20 * (1 - heat);
                this._temp += ((tempTarget - this._temp) / this._tau) * dt;
                
                // 粘度响应（温度越高粘度越低）
                const viscTarget = Math.max(5, 80 - this._temp * 0.48);
                this._viscosity += ((viscTarget - this._viscosity) / (this._tau * 0.8)) * dt;
                
                // 压力仿真
                this._pressure1 = 3.5 + Math.sin(this._stateTimer * 0.2) * 0.2;
                this._pressure2 = 7.0 + Math.sin(this._stateTimer * 0.2) * 0.3;
                this._flowRate = 920 + (Math.random() - 0.5) * 30;
                break;

            case 'STOPPING':
                this._threeWayValvePos += ((0 - this._threeWayValvePos) / 5) * dt;
                this._sp1Running = false;
                this._sp2Running = false;
                this._sh1Active = false;
                this._sh2Active = false;
                this._srvPos += ((0 - this._srvPos) / 8) * dt;
                
                if (this._stateTimer > 2) {
                    this._cp1Running = false;
                    this._cp2Running = false;
                }
                if (this._stateTimer > 4) {
                    this._pressure1 = 0;
                    this._pressure2 = 0;
                }
                if (this._stateTimer > 6) {
                    this._setState('STOPPED');
                }
                break;
        }

        // 液位仿真
        if (this._state === 'RUNNING_HFO' || this._state === 'RUNNING_DO' || this._state === 'PROCESS_FO') {
            this._level = Math.max(10, this._level - dt * 0.005);
        }

        // 报警更新
        this._alarms.ps2High = this._pressure2 > this._ps2HighMax;
        this._alarms.tempHigh = this._temp > 150;
        this._alarms.viscHigh = this._viscosity > 20;
        this._alarms.viscLow = this._viscosity < 3 && this._state === 'RUNNING_HFO';
        this._alarms.levelLow = this._level < 15;
        
        this._anyAlarm = Object.values(this._alarms).some(Boolean);

        // LED 状态
        this._ledStartStop = this._state !== 'STOPPED';
        this._ledHFO = this._fuelMode === 'HFO' && this._state === 'RUNNING_HFO';
        this._ledDO = this._fuelMode === 'DO' && this._state === 'RUNNING_DO';
        this._ledProcessFO = this._state === 'PROCESS_FO';
        this._ledOpActive = this._state !== 'STOPPED' && this._state !== 'STOPPING';
        this._ledAlarm = this._anyAlarm && !this._alarmAcked;

        this._updateDispValue();
    }

    _setState(newState) {
        this._state = newState;
        this._stateTimer = 0;
        this._updateInfoLines();
    }

    _updateDispValue() {
        const vals = [
            this._temp.toFixed(1),
            this._viscosity.toFixed(1),
            this._pressure2.toFixed(2),
            this._pressure1.toFixed(2),
            Math.round(this._flowRate).toString(),
            Math.round(this._level).toString() + '%',
            Math.round(this._threeWayValvePos).toString() + '%',
        ];
        this._dispValue = vals[this._dispParamIdx] || '----';
    }

    _updateInfoLines() {
        const stateMap = {
            STOPPED:    'SYSTEM STOPPED',
            STARTING:   'STARTING...',
            RUNNING_DO: 'RUNNING ON D.O.',
            PROCESS_FO: 'SWITCHING TO HFO',
            RUNNING_HFO:'RUNNING ON HFO',
            STOPPING:   'STOPPING...',
        };
        
        const pumpStatus = `SP${this._activeSupplyPump}→${this._sp1Running||this._sp2Running?'RUN':'STP'} CP${this._activeCircPump}→${this._cp1Running||this._cp2Running?'RUN':'STP'}`;
        const valveStatus = `3WV:${Math.round(this._threeWayValvePos)}% ${this._threeWayValvePos<10?'DO':(this._threeWayValvePos>90?'HFO':'MIX')}`;
        const srvStatus = `SRV:${Math.round(this._srvPos)}%`;
        
        this._infoLines = [
            stateMap[this._state] || this._state,
            `T:${this._temp.toFixed(0)}°C V:${this._viscosity.toFixed(1)}cSt`,
            `P1:${this._pressure1.toFixed(2)}bar P2:${this._pressure2.toFixed(2)}bar`,
            `${valveStatus} ${srvStatus}`,
            pumpStatus + (this._anyAlarm ? ' ⚠ALARM' : ''),
        ];
    }

    _refreshDisplay() {
        if (this._ctrlDisp) {
            this._ctrlDisp.text(this._dispValue);
            const alarmBlink = this._anyAlarm && Math.floor(this._blinkPhase * 2) % 2 === 0;
            this._ctrlDisp.fill(alarmBlink ? '#ff4422' : '#22cc44');
            this._ctrlDisp.shadowColor(alarmBlink ? '#ff4422' : '#22cc44');
        }

        if (this._ctrlParamName) {
            this._ctrlParamName.text(this._paramNames[this._dispParamIdx]);
        }

        this._updateInfoLines();
        this._infoLineTexts?.forEach((lt, i) => lt.text(this._infoLines[i] || ''));

        this._setOpLED('start_stop', this._ledStartStop);
        this._setOpLED('hfo', this._ledHFO);
        this._setOpLED('do', this._ledDO);
        this._setOpLED('proc_fo', this._ledProcessFO);
        this._setOpLED('op_active', this._ledOpActive);
        const almBlink = this._ledAlarm && Math.floor(this._blinkPhase * 2) % 2 === 0;
        this._setOpLED('alarm', almBlink);

        // 三通阀显示
        if (this._threeWayIndicator) {
            const maxWidth = 16;
            this._threeWayIndicator.width(Math.max(0, maxWidth * (this._threeWayValvePos / 100)));
        }
        if (this._threeWayPosText) {
            this._threeWayPosText.text(Math.round(this._threeWayValvePos) + '%');
            if (this._threeWayValvePos > 70) this._threeWayPosText.fill('#cc4400');
            else if (this._threeWayValvePos < 30) this._threeWayPosText.fill('#0066cc');
            else this._threeWayPosText.fill('#886600');
        }

        // SRV 显示
        if (this._srvFill) {
            const maxH = 10;
            this._srvFill.height(maxH * (this._srvPos / 100));
        }
        if (this._srvPosText) this._srvPosText.text(Math.round(this._srvPos) + '%');

        // P&ID 圆点
        const running = this._state !== 'STOPPED';
        this._updatePidDot('fuel_in', running ? 'ok' : 'off');
        this._updatePidDot('three_way', this._threeWayValvePos > 5 ? (this._threeWayValvePos > 90 ? 'ok' : 'warn') : 'off');
        this._updatePidDot('sp1', this._sp1Running ? 'ok' : 'off');
        this._updatePidDot('sp2', this._sp2Running ? 'ok' : 'off');
        this._updatePidDot('mf', running ? 'ok' : 'off');
        this._updatePidDot('ls', this._level > 15 ? 'ok' : 'alarm');
        this._updatePidDot('ft', running ? 'ok' : 'off');
        this._updatePidDot('ps1', this._alarms.ps1Low ? 'alarm' : (this._pressure1 > 0.5 ? 'ok' : 'off'));
        this._updatePidDot('cp1', this._cp1Running ? 'ok' : 'off');
        this._updatePidDot('cp2', this._cp2Running ? 'ok' : 'off');
        this._updatePidDot('sh1', this._sh1Active ? 'warn' : 'off');
        this._updatePidDot('sh2', this._sh2Active ? 'warn' : 'off');
        this._updatePidDot('ps2', this._alarms.ps2Low ? 'alarm' : (this._pressure2 > 0.5 ? 'ok' : 'off'));
        this._updatePidDot('tt', running ? (this._temp > this._tempSP + 5 ? 'warn' : 'ok') : 'off');
        this._updatePidDot('vt', running ? (this._alarms.viscHigh || this._alarms.viscLow ? 'warn' : 'ok') : 'off');
        this._updatePidDot('srv', this._srvPos > 10 ? 'ok' : 'off');

        // 泵颜色
        if (this._sp1Shape) this._sp1Shape.fill(this._sp1Running ? '#88d4b8' : '#b8d4ec');
        if (this._sp2Shape) this._sp2Shape.fill(this._sp2Running ? '#88d4b8' : '#b8d4ec');
        if (this._cp1Shape) this._cp1Shape.fill(this._cp1Running ? '#88d4b8' : '#b8d4ec');
        if (this._cp2Shape) this._cp2Shape.fill(this._cp2Running ? '#88d4b8' : '#b8d4ec');
        if (this._sh1Shape) this._sh1Shape.fill(this._sh1Active ? '#f0a878' : '#f0d8c8');
        if (this._sh2Shape) this._sh2Shape.fill(this._sh2Active ? '#f0a878' : '#f0d8c8');

        // 液位
        if (this._lsLiquid) {
            const lh = 20;
            this._lsLiquid.height(Math.max(0, lh * (this._level / 100)));
        }

        this._refreshCache();
    }

    _onOpBtn(id) {
        switch (id) {
            case 'start_stop':
                if (this._state === 'STOPPED') {
                    this._setState('STARTING');
                } else if (this._state === 'RUNNING_DO' || this._state === 'RUNNING_HFO' || this._state === 'PROCESS_FO') {
                    this._setState('STOPPING');
                }
                break;
            case 'do':
                if (this._state === 'RUNNING_HFO' || this._state === 'PROCESS_FO') {
                    this._threeWayValvePos = 0;
                    this._setState('RUNNING_DO');
                }
                break;
            case 'proc_fo':
                if (this._state === 'RUNNING_DO') {
                    this._setState('PROCESS_FO');
                }
                break;
            case 'alarm':
                this._alarmAcked = true;
                setTimeout(() => { this._alarmAcked = false; }, 5000);
                break;
        }
        this._refreshCache();
    }

    _onCtrlKey(id) {
        switch (id) {
            case 'minus':
                this._dispParamIdx = (this._dispParamIdx - 1 + this._paramNames.length) % this._paramNames.length;
                break;
            case 'plus':
                this._dispParamIdx = (this._dispParamIdx + 1) % this._paramNames.length;
                break;
            case 'enter':
                this._editMode = !this._editMode;
                break;
        }
        this._refreshCache();
    }

    _lighten(hex, f) {
        if (!hex || hex.length < 7) return '#3a5a7a';
        const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i+2), 16));
        return `#${[r,g,b].map(v => Math.min(255, Math.round(v+(255-v)*f)).toString(16).padStart(2,'0')).join('')}`;
    }
    
    _darken(hex, f) {
        if (!hex || hex.length < 7) return '#1a2a3a';
        const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i+2), 16));
        return `#${[r,g,b].map(v => Math.max(0, Math.round(v*(1-f))).toString(16).padStart(2,'0')).join('')}`;
    }

    _addPorts() {
        const W = this.width, H = this.height;
        this.addPort(W * 0.16, H, 'port_fuel_in',   'wire', 'FUEL IN');
        this.addPort(W * 0.40, H, 'port_tt_out',    'wire', 'TEMP');
        this.addPort(W * 0.52, H, 'port_vt_out',    'wire', 'VISC');
        this.addPort(W * 0.64, H, 'port_ft_out',    'wire', 'FLOW');
        this.addPort(W * 0.80, H, 'port_alarm_out', 'wire', 'ALARM');
    }

    // ═══════════════════════════════════════════
    // 公共 API
    // ═══════════════════════════════════════════
    getState() { return this._state; }
    getTemp() { return this._temp; }
    getViscosity() { return this._viscosity; }
    getPressure1() { return this._pressure1; }
    getPressure2() { return this._pressure2; }
    getFlowRate() { return this._flowRate; }
    getThreeWayPos() { return this._threeWayValvePos; }
    getSrvPos() { return this._srvPos; }
    getActiveSupplyPump() { return this._activeSupplyPump; }
    getActiveCircPump() { return this._activeCircPump; }
    isAlarm() { return this._anyAlarm; }
    getAlarms() { return { ...this._alarms }; }

    start() { if (this._state === 'STOPPED') this._setState('STARTING'); }
    stop() { if (this._state !== 'STOPPED' && this._state !== 'STOPPING') this._setState('STOPPING'); }
    switchToHFO() { if (this._state === 'RUNNING_DO') this._setState('PROCESS_FO'); }
    switchToDO() { if (this._state === 'RUNNING_HFO') this._setState('RUNNING_DO'); }
    ackAlarm() { this._alarmAcked = true; }

    setTempSP(v) { this._tempSP = Math.max(50, Math.min(160, v)); }
    setViscSP(v) { this._viscSP = Math.max(5, Math.min(30, v)); }
    
    // 模拟泵故障（用于测试切换）
    simulateSupplyPumpFault() {
        if (this._state !== 'STOPPED') {
            if (this._activeSupplyPump === 1) this._alarms.sp1Fault = true;
            else this._alarms.sp2Fault = true;
            // 强制压力降低触发切换
            this._pressure1 = 0.5;
        }
    }
    
    simulateCircPumpFault() {
        if (this._state !== 'STOPPED') {
            if (this._activeCircPump === 1) this._alarms.cp1Fault = true;
            else this._alarms.cp2Fault = true;
            this._pressure2 = 1.0;
        }
    }

    update(state) {
        if (!state) return;
        if (state.start) this.start();
        if (state.stop) this.stop();
        if (state.toHFO) this.switchToHFO();
        if (state.toDO) this.switchToDO();
        if (state.ackAlarm) this.ackAlarm();
        if (state.tempSP !== undefined) this.setTempSP(state.tempSP);
        if (state.viscSP !== undefined) this.setViscSP(state.viscSP);
        if (state.srvKp !== undefined) this._srvKp = state.srvKp;
        if (state.srvKi !== undefined) this._srvKi = state.srvKi;
        this._refreshCache();
    }

    getConfigFields() {
        return [
            { label: '位号', key: 'label', type: 'text' },
            { label: '温度设定值 (°C)', key: 'tempSP', type: 'number' },
            { label: '粘度设定值 (cSt)', key: 'viscSP', type: 'number' },
            { label: '粘度 PI 比例增益 (Kp)', key: 'srvKp', type: 'number' },
            { label: '粘度 PI 积分增益 (Ki)', key: 'srvKi', type: 'number' },
            { label: '供油压力切换阈值 (bar)', key: 'ps1SwitchMin', type: 'number' },
            { label: '循环压力切换阈值 (bar)', key: 'ps2SwitchMin', type: 'number' },
        ];
    }

    onConfigUpdate(cfg) {
        if (cfg.label) this.label = cfg.label;
        if (cfg.tempSP !== undefined) this.setTempSP(parseFloat(cfg.tempSP));
        if (cfg.viscSP !== undefined) this.setViscSP(parseFloat(cfg.viscSP));
        if (cfg.srvKp !== undefined) this._srvKp = parseFloat(cfg.srvKp);
        if (cfg.srvKi !== undefined) this._srvKi = parseFloat(cfg.srvKi);
        if (cfg.ps1SwitchMin !== undefined) this._ps1SwitchMin = parseFloat(cfg.ps1SwitchMin);
        if (cfg.ps2SwitchMin !== undefined) this._ps2SwitchMin = parseFloat(cfg.ps2SwitchMin);
        this.config = { ...this.config, ...cfg };
        this._refreshCache();
    }

    destroy() {
        super.destroy?.();
    }
}