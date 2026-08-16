import { BaseComponent } from './BaseComponent.js';

/**
 * 冰箱仿真组件（双温区变频冰箱）
 * Refrigerator Simulation Component
 *
 * ── 系统结构 ──────────────────────────────────────────────────
 *
 *  本组件模拟一台双温区直冷/风冷冰箱的完整制冷循环，包含：
 *
 *  【制冷系统部件】
 *  1. 压缩机（Compressor）：变频压缩机，可调转速（30~120 Hz）
 *     - 状态：停机 / 低速 / 中速 / 高速
 *     - 显示：转速指示、运行电流、累计运行时长
 *
 *  2. 冷凝器（Condenser）：翅片管式，位于机背
 *     - 显示：进/出口温度、散热风机状态
 *
 *  3. 电子膨胀阀 × 2（EEV - Electronic Expansion Valve）
 *     - EEV-F：冷冻室回路（-30~0℃ 对应 0~480 pulse）
 *     - EEV-R：冷藏室回路（-10~15℃ 对应 0~480 pulse）
 *     - 显示：开度百分比、脉冲数、实时流量指示
 *
 *  4. 蒸发器 × 2（Evaporator）
 *     - 冷冻蒸发器（Freezer Evaporator）
 *     - 冷藏蒸发器（Fridge Evaporator）
 *     - 显示：进/出口温度、结霜状态
 *
 *  【温度传感元件】
 *  - T1  冷冻室温度传感器（NTC 10kΩ）
 *  - T2  冷藏室温度传感器（NTC 10kΩ）
 *  - T3  冷冻蒸发器传感器（NTC 10kΩ）
 *  - T4  冷藏蒸发器传感器（NTC 10kΩ）
 *  - T5  压缩机排气温度传感器（NTC 50kΩ）
 *  - T6  环境温度传感器（NTC 10kΩ）
 *  - T7  冷凝器中部温度传感器（NTC 10kΩ）
 *
 *  【控制逻辑】
 *  - 温差控制：实测温度与设定温度差值驱动压缩机转速 & 阀开度
 *  - 化霜控制：蒸发器结霜量累积到阈值时触发电热化霜
 *  - 过热保护：排气温度 > 110℃ 时停机保护
 *  - 环境自适应：根据 T6 调整制冷强度
 *
 * ── 仿真模型 ──────────────────────────────────────────────────
 *
 *  采用一阶热力学模型：
 *    dT/dt = (Q_load - Q_cool) / (m × Cp)
 *
 *  其中：
 *    Q_load  = 漏热量（环境温差 × 导热系数）+ 开门热负荷
 *    Q_cool  = 制冷量（压缩机频率 × COP × Δh）
 *    m×Cp    = 箱体热容（冷冻区 2500 J/K，冷藏区 3500 J/K）
 *
 * ── 端口 ─────────────────────────────────────────────────────
 *  data_out     — 实时状态数据输出（JSON）
 *  alarm_out    — 报警输出（高电平 = 有报警）
 *  setpoint_in  — 设定温度输入
 *
 * ── 使用方法 ──────────────────────────────────────────────────
 *  const fridge = new Refrigerator({
 *    x: 100, y: 50,
 *    width: 420, height: 560,
 *    freezerSetpoint: -18,   // 冷冻室设定温度 ℃
 *    fridgeSetpoint:  4,     // 冷藏室设定温度 ℃
 *    ambientTemp:     25,    // 环境温度 ℃
 *    label: 'REF-01',
 *  }, sys);
 */
export class Refrigerator extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        // ── 基本几何 ──
        this.width  = Math.max(380, config.width  || 420);
        this.height = Math.max(500, config.height || 560);
        this.type   = 'refrigerator';
        this.cache  = 'none';   // 动态内容多，不使用缓存
        this.label  = config.label || 'REF-01';

        // ── 设定参数 ──
        this._freezerSetpoint = config.freezerSetpoint ?? -18;  // ℃
        this._fridgeSetpoint  = config.fridgeSetpoint  ?? 4;    // ℃
        this._ambientTemp     = config.ambientTemp     ?? 25;   // ℃

        // 温度限制
        this._FREEZER_MIN = -30;
        this._FREEZER_MAX = -10;
        this._FRIDGE_MIN  = 0;
        this._FRIDGE_MAX  = 10;

        // ── 仿真状态 ──
        this._simTime    = 0;    // 仿真时间 s
        this._simSpeed   = 60;   // 仿真加速倍率（1s 真实 = 60s 仿真）

        // 箱体实际温度
        this._freezerTemp = config.initFreezerTemp ?? this._ambientTemp;
        this._fridgeTemp  = config.initFridgeTemp  ?? this._ambientTemp;

        // 热容参数
        this._freezerThermalMass = 2500;  // J/K
        this._fridgeThermalMass  = 3500;  // J/K
        this._freezerUA = 1.8;  // W/K 导热系数
        this._fridgeUA  = 2.2;  // W/K

        // 压缩机
        this._compressor = {
            running:    false,
            frequency:  0,       // Hz  0~120
            targetFreq: 0,
            current:    0,       // A
            runHours:   config.initRunHours || 0,
            startCount: 0,
            dischargTemp: 20,    // ℃ 排气温度
            state: 'stop',       // stop / startup / run / protect
            startupTimer: 0,     // 启动延时 s
            minOffTime: 180,     // 最短停机时间 s（防频繁启停）
            offTimer: 0,
        };

        // 电子膨胀阀
        this._eevF = {          // 冷冻室 EEV
            pulse:       0,     // 0~480
            targetPulse: 0,
            maxPulse:    480,
            openPct:     0,     // 0~100%
            flowRate:    0,     // 相对流量 0~1
            stepping:    false,
            stepDir:     0,
        };
        this._eevR = {          // 冷藏室 EEV
            pulse:       0,
            targetPulse: 0,
            maxPulse:    480,
            openPct:     0,
            flowRate:    0,
            stepping:    false,
            stepDir:     0,
        };

        // 传感器温度（7路）
        this._sensors = {
            T1: this._freezerTemp,   // 冷冻室
            T2: this._fridgeTemp,    // 冷藏室
            T3: this._ambientTemp,   // 冷冻蒸发器
            T4: this._ambientTemp,   // 冷藏蒸发器
            T5: this._ambientTemp,   // 压缩机排气
            T6: this._ambientTemp,   // 环境温度
            T7: this._ambientTemp,   // 冷凝器中部
        };

        // 蒸发器状态
        this._evapF = {
            inletTemp:  this._ambientTemp,
            outletTemp: this._ambientTemp,
            frostLevel: 0,     // 0~1 结霜量
            defrosting: false,
            defrostTimer: 0,
        };
        this._evapR = {
            inletTemp:  this._ambientTemp,
            outletTemp: this._ambientTemp,
            frostLevel: 0,
            defrosting: false,
            defrostTimer: 0,
        };

        // 冷凝器
        this._condenser = {
            inletTemp:  this._ambientTemp,
            outletTemp: this._ambientTemp,
            fanRunning: false,
        };

        // 报警
        this._alarms = {
            highDischarge: false,   // 排气高温
            freezerHigh:   false,   // 冷冻室高温
            fridgeHigh:    false,   // 冷藏室高温
            sensorFault:   false,   // 传感器故障
        };

        // 动画帧计数器
        this._animFrame  = 0;
        this._sparkPhase = 0;   // 压缩机火花动画相位

        // 历史曲线数据（最近120个点 = 2分钟@1Hz）
        this._history = {
            T1: [], T2: [], T3: [], T4: [],
            maxLen: 120,
        };

        // ── 布局常量 ──
        this._layout = this._calcLayout();

        this._init();

        // ── 端口 ──
        const L = this._layout;
        this.addPort(L.bodyX + L.bodyW,      L.bodyY + L.bodyH * 0.3, 'data_out',    'wire', 'DATA');
        this.addPort(L.bodyX + L.bodyW,      L.bodyY + L.bodyH * 0.6, 'alarm_out',   'wire', 'ALM');
        this.addPort(L.bodyX,                L.bodyY + L.bodyH * 0.5, 'setpoint_in', 'wire', 'SP');
    }

    // ═══════════════════════════════════════════════════
    // 布局计算
    _calcLayout() {
        const W = this.width, H = this.height;
        const PAD = 8;

        // 冰箱主体（左侧主区域）
        const bodyW = W * 0.62;
        const bodyH = H * 0.75;
        const bodyX = PAD;
        const bodyY = H * 0.12;

        // 冷冻室（上半）
        const freezerH = bodyH * 0.42;
        // 冷藏室（下半）
        const fridgeH  = bodyH - freezerH - 4;

        // 控制面板（右侧）
        const panelX = bodyX + bodyW + 10;
        const panelW = W - panelX - PAD;
        const panelH = H - 16;

        // 机械室（底部）
        const mechY = bodyY + bodyH + 6;
        const mechH = H - mechY - PAD;

        return {
            W, H, PAD,
            bodyX, bodyY, bodyW, bodyH,
            freezerH, fridgeH,
            panelX, panelW, panelH,
            mechY, mechH,
        };
    }

    // ═══════════════════════════════════════════════════
    _init() {
        // 分层绘制
        this._drawCabinetShell();
        this._drawFreezerCompartment();
        this._drawFridgeCompartment();
        this._drawDoorDivider();
        this._drawMechRoom();
        this._createDynamicLayer();
        this._drawControlPanel();
        this._drawLabel();
        this._bindInteraction();
    }

    // ── 箱体外壳 ────────────────────────────────────
    _drawCabinetShell() {
        const L = this._layout;
        // 外壳主体（深灰，金属质感）
        this.group.add(new Konva.Rect({
            x: L.bodyX - 2, y: L.bodyY - 2,
            width: L.bodyW + 4, height: L.bodyH + 4,
            fill: '#1e2329',
            stroke: '#2e3540', strokeWidth: 1.5,
            cornerRadius: [8, 8, 4, 4],
        }));
        // 外壳内衬（白色内壁）
        this.group.add(new Konva.Rect({
            x: L.bodyX + 4, y: L.bodyY + 4,
            width: L.bodyW - 8, height: L.bodyH - 8,
            fill: '#f0f4f8',
            cornerRadius: [4, 4, 2, 2],
        }));
        // 门封条高光
        this.group.add(new Konva.Rect({
            x: L.bodyX + 3, y: L.bodyY + 3,
            width: L.bodyW - 6, height: 5,
            fill: 'rgba(255,255,255,0.25)',
            cornerRadius: [4, 4, 0, 0],
        }));
        // 箱体铭牌区域
        this.group.add(new Konva.Rect({
            x: L.bodyX + L.bodyW - 70, y: L.bodyY + 6,
            width: 62, height: 14,
            fill: '#2a3040', cornerRadius: 2,
        }));
    }

    // ── 冷冻室 ───────────────────────────────────────
    _drawFreezerCompartment() {
        const L = this._layout;
        const x = L.bodyX + 6;
        const y = L.bodyY + 6;
        const w = L.bodyW - 12;
        const h = L.freezerH - 4;

        // 冷冻室背景（浅蓝色调）
        this.group.add(new Konva.Rect({
            x, y, width: w, height: h,
            fill: '#d8eaf8',
            cornerRadius: [4, 4, 0, 0],
        }));
        // 分区标题条
        this.group.add(new Konva.Rect({
            x, y, width: w, height: 16,
            fill: '#1565c0',
            cornerRadius: [4, 4, 0, 0],
        }));
        this.group.add(new Konva.Text({
            x: x + 4, y: y + 2,
            text: '❄  冷冻室  FREEZER',
            fontSize: 9, fill: '#e3f2fd', fontStyle: 'bold',
        }));

        // 储物格线
        for (let i = 1; i <= 2; i++) {
            this.group.add(new Konva.Line({
                points: [x + 8, y + 16 + (h - 16) * i / 3,
                         x + w - 8, y + 16 + (h - 16) * i / 3],
                stroke: '#b3d4e8', strokeWidth: 0.5, dash: [4, 3],
            }));
        }

        // 冷冻蒸发器位置（内部左侧）
        const evX = x + 8;
        const evY = y + h - 44;
        this.group.add(new Konva.Rect({
            x: evX, y: evY, width: 32, height: 38,
            fill: '#c5dff0', stroke: '#7bb8d8', strokeWidth: 0.8,
            cornerRadius: 3,
        }));
        // 蒸发器翅片
        for (let i = 0; i < 6; i++) {
            this.group.add(new Konva.Line({
                points: [evX + 2, evY + 3 + i * 6,
                         evX + 30, evY + 3 + i * 6],
                stroke: '#90bcd8', strokeWidth: 1,
            }));
        }
        this.group.add(new Konva.Text({
            x: evX - 2, y: evY - 10,
            text: 'EVAP-F', fontSize: 7, fill: '#1565c0', fontStyle: 'bold',
        }));
        // 记录蒸发器坐标（动态层使用）
        this._evapFRect = { x: evX, y: evY, w: 32, h: 38 };

        // T1 传感器位置标记
        const t1X = x + w / 2 + 10;
        const t1Y = y + h / 2;
        this.group.add(new Konva.Circle({
            x: t1X, y: t1Y, radius: 5,
            fill: '#1565c0', stroke: '#0d47a1', strokeWidth: 1,
        }));
        this.group.add(new Konva.Text({
            x: t1X + 7, y: t1Y - 5,
            text: 'T1', fontSize: 8, fill: '#0d47a1', fontStyle: 'bold',
        }));
        // T3 蒸发器传感器
        this.group.add(new Konva.Circle({
            x: evX + 16, y: evY - 6, radius: 4,
            fill: '#2979ff', stroke: '#1565c0', strokeWidth: 0.8,
        }));
        this.group.add(new Konva.Text({
            x: evX + 21, y: evY - 11,
            text: 'T3', fontSize: 7, fill: '#0d47a1', fontStyle: 'bold',
        }));
        this._sensorPos = this._sensorPos || {};
        this._sensorPos.T1 = { x: t1X, y: t1Y };
        this._sensorPos.T3 = { x: evX + 16, y: evY - 6 };
    }

    // ── 冷藏室 ───────────────────────────────────────
    _drawFridgeCompartment() {
        const L = this._layout;
        const x = L.bodyX + 6;
        const y = L.bodyY + L.freezerH + 2;
        const w = L.bodyW - 12;
        const h = L.fridgeH - 4;

        this.group.add(new Konva.Rect({
            x, y, width: w, height: h,
            fill: '#e8f5e9',
            cornerRadius: [0, 0, 4, 4],
        }));
        // 分区标题条
        this.group.add(new Konva.Rect({
            x, y, width: w, height: 16,
            fill: '#2e7d32',
            cornerRadius: 0,
        }));
        this.group.add(new Konva.Text({
            x: x + 4, y: y + 2,
            text: '🌡  冷藏室  REFRIGERATOR',
            fontSize: 9, fill: '#f1f8e9', fontStyle: 'bold',
        }));

        // 储物层架
        for (let i = 1; i <= 3; i++) {
            this.group.add(new Konva.Line({
                points: [x + 6, y + 16 + (h - 16) * i / 4,
                         x + w - 6, y + 16 + (h - 16) * i / 4],
                stroke: '#a5d6a7', strokeWidth: 0.8, dash: [5, 3],
            }));
        }

        // 冷藏蒸发器（内部右侧，风冷盘管）
        const evX = x + w - 40;
        const evY = y + h - 50;
        this.group.add(new Konva.Rect({
            x: evX, y: evY, width: 32, height: 44,
            fill: '#c8e6c9', stroke: '#81c784', strokeWidth: 0.8,
            cornerRadius: 3,
        }));
        for (let i = 0; i < 7; i++) {
            this.group.add(new Konva.Line({
                points: [evX + 2, evY + 3 + i * 6,
                         evX + 30, evY + 3 + i * 6],
                stroke: '#66bb6a', strokeWidth: 1,
            }));
        }
        this.group.add(new Konva.Text({
            x: evX - 2, y: evY - 10,
            text: 'EVAP-R', fontSize: 7, fill: '#2e7d32', fontStyle: 'bold',
        }));
        this._evapRRect = { x: evX, y: evY, w: 32, h: 44 };

        // T2 传感器
        const t2X = x + w / 2 - 10;
        const t2Y = y + h / 2;
        this.group.add(new Konva.Circle({
            x: t2X, y: t2Y, radius: 5,
            fill: '#2e7d32', stroke: '#1b5e20', strokeWidth: 1,
        }));
        this.group.add(new Konva.Text({
            x: t2X + 7, y: t2Y - 5,
            text: 'T2', fontSize: 8, fill: '#1b5e20', fontStyle: 'bold',
        }));
        // T4 蒸发器传感器
        this.group.add(new Konva.Circle({
            x: evX + 16, y: evY - 6, radius: 4,
            fill: '#43a047', stroke: '#2e7d32', strokeWidth: 0.8,
        }));
        this.group.add(new Konva.Text({
            x: evX + 21, y: evY - 11,
            text: 'T4', fontSize: 7, fill: '#1b5e20', fontStyle: 'bold',
        }));
        this._sensorPos = this._sensorPos || {};
        this._sensorPos.T2 = { x: t2X, y: t2Y };
        this._sensorPos.T4 = { x: evX + 16, y: evY - 6 };
    }

    // ── 冷冻/冷藏分隔条 ─────────────────────────────
    _drawDoorDivider() {
        const L = this._layout;
        const y = L.bodyY + L.freezerH;
        this.group.add(new Konva.Rect({
            x: L.bodyX, y: y,
            width: L.bodyW, height: 6,
            fill: '#1e2329', stroke: '#2e3540', strokeWidth: 0.5,
        }));
        // 门把手装饰
        const hX = L.bodyX + L.bodyW - 14;
        // 冷冻室把手
        this.group.add(new Konva.Rect({
            x: hX, y: L.bodyY + 20,
            width: 8, height: L.freezerH - 30,
            fill: '#3a3f4b', stroke: '#4a5060', strokeWidth: 0.8,
            cornerRadius: 4,
        }));
        // 冷藏室把手
        this.group.add(new Konva.Rect({
            x: hX, y: L.bodyY + L.freezerH + 14,
            width: 8, height: L.fridgeH - 24,
            fill: '#3a3f4b', stroke: '#4a5060', strokeWidth: 0.8,
            cornerRadius: 4,
        }));
    }

    // ── 机械室（底部）───────────────────────────────
    _drawMechRoom() {
        const L = this._layout;
        const x = L.bodyX;
        const y = L.mechY;
        const w = L.bodyW;
        const h = L.mechH;

        // 机械室外壳
        this.group.add(new Konva.Rect({
            x, y, width: w, height: h,
            fill: '#22262e',
            stroke: '#2e3540', strokeWidth: 1,
            cornerRadius: [0, 0, 6, 6],
        }));

        // 压缩机（圆柱形，居中偏右）
        const compX = x + w * 0.55;
        const compY = y + h * 0.5;
        const compR  = Math.min(h * 0.38, 16);
        // 外壳
        this.group.add(new Konva.Ellipse({
            x: compX, y: compY,
            radiusX: compR * 1.1, radiusY: compR,
            fill: '#3a4050', stroke: '#5a6070', strokeWidth: 1.5,
        }));
        // 铭牌条
        this.group.add(new Konva.Rect({
            x: compX - compR, y: compY - 5,
            width: compR * 2, height: 10,
            fill: '#ffa000', cornerRadius: 2,
        }));
        this.group.add(new Konva.Text({
            x: compX - compR + 2, y: compY - 4,
            text: 'COMP', fontSize: 7, fill: '#1a1a1a', fontStyle: 'bold',
        }));
        // 顶部管接头
        this.group.add(new Konva.Rect({
            x: compX - 3, y: y + 2,
            width: 6, height: h * 0.3,
            fill: '#888', stroke: '#666', strokeWidth: 0.5, cornerRadius: 1,
        }));

        this._compPos = { x: compX, y: compY, r: compR };
        this._sensorPos = this._sensorPos || {};
        this._sensorPos.T5 = { x: compX + compR + 2, y: compY - compR };

        // T5 排气传感器标记
        this.group.add(new Konva.Circle({
            x: compX + compR + 2, y: compY - compR,
            radius: 4, fill: '#f44336', stroke: '#c62828', strokeWidth: 0.8,
        }));
        this.group.add(new Konva.Text({
            x: compX + compR + 7, y: compY - compR - 4,
            text: 'T5', fontSize: 7, fill: '#f44336', fontStyle: 'bold',
        }));

        // EEV-F（冷冻阀，左侧）
        const eevFX = x + w * 0.18;
        const eevFY = y + h * 0.35;
        this._drawEEVSymbol(eevFX, eevFY, 'EEV-F', '#1565c0');
        this._eevFPos = { x: eevFX, y: eevFY };

        // EEV-R（冷藏阀，左侧偏下）
        const eevRX = x + w * 0.18;
        const eevRY = y + h * 0.75;
        this._drawEEVSymbol(eevRX, eevRY, 'EEV-R', '#2e7d32');
        this._eevRPos = { x: eevRX, y: eevRY };

        // T6 环境传感器（机械室左边）
        this.group.add(new Konva.Circle({
            x: x + 10, y: y + h * 0.5,
            radius: 4, fill: '#ff9800', stroke: '#e65100', strokeWidth: 0.8,
        }));
        this.group.add(new Konva.Text({
            x: x + 15, y: y + h * 0.5 - 4,
            text: 'T6', fontSize: 7, fill: '#ff9800', fontStyle: 'bold',
        }));
        this._sensorPos.T6 = { x: x + 10, y: y + h * 0.5 };

        // 冷凝器（机背，左侧）
        const condX = x + 4;
        const condY = y + 2;
        const condW = w * 0.32;
        const condH = h - 4;
        this.group.add(new Konva.Rect({
            x: condX, y: condY, width: condW, height: condH,
            fill: '#2a2e38', stroke: '#3a3e48', strokeWidth: 0.5,
            cornerRadius: 2,
        }));
        // 冷凝器翅片
        for (let i = 0; i < 8; i++) {
            this.group.add(new Konva.Line({
                points: [condX + 2, condY + 3 + i * (condH - 6) / 7,
                         condX + condW - 2, condY + 3 + i * (condH - 6) / 7],
                stroke: '#4a5060', strokeWidth: 1.2,
            }));
        }
        this.group.add(new Konva.Text({
            x: condX + 2, y: condY + 2,
            text: 'COND', fontSize: 6, fill: '#888', fontStyle: 'bold',
        }));
        // T7 冷凝器传感器
        const t7X = condX + condW * 0.5;
        const t7Y = condY + condH * 0.5;
        this.group.add(new Konva.Circle({
            x: t7X, y: t7Y, radius: 4,
            fill: '#ff5722', stroke: '#bf360c', strokeWidth: 0.8,
        }));
        this.group.add(new Konva.Text({
            x: t7X + 5, y: t7Y - 4,
            text: 'T7', fontSize: 7, fill: '#ff5722', fontStyle: 'bold',
        }));
        this._sensorPos.T7 = { x: t7X, y: t7Y };
        this._condRect = { x: condX, y: condY, w: condW, h: condH };
    }

    // ── EEV 符号 ────────────────────────────────────
    _drawEEVSymbol(cx, cy, label, color) {
        // 阀体（菱形）
        const r = 8;
        this.group.add(new Konva.Line({
            points: [cx - r, cy, cx, cy - r, cx + r, cy, cx, cy + r, cx - r, cy],
            fill: color + '44', stroke: color, strokeWidth: 1,
            closed: true,
        }));
        // 执行器（顶部小圆）
        this.group.add(new Konva.Circle({
            x: cx, y: cy - r - 5, radius: 4,
            fill: '#333', stroke: color, strokeWidth: 0.8,
        }));
        // 连杆
        this.group.add(new Konva.Line({
            points: [cx, cy - r, cx, cy - r - 5],
            stroke: color, strokeWidth: 1,
        }));
        // 标签
        this.group.add(new Konva.Text({
            x: cx + 12, y: cy - 7,
            text: label, fontSize: 7, fill: color, fontStyle: 'bold',
        }));
    }

    // ── 动态层 ──────────────────────────────────────
    _createDynamicLayer() {
        this._dynGroup = new Konva.Group();
        this.group.add(this._dynGroup);
        this._buildDynamic();
    }

    _buildDynamic() {
        this._dynGroup.destroyChildren();
        this._drawFrostLayer();
        this._drawRefrigerantFlow();
        this._drawCompressorAnimation();
        this._drawEEVAnimation();
        this._drawSensorReadouts();
        this._drawAlarmIndicators();
    }

    // 结霜层
    _drawFrostLayer() {
        const L = this._layout;
        // 冷冻蒸发器结霜
        if (this._evapF.frostLevel > 0.05) {
            const r = this._evapFRect;
            const alpha = Math.min(0.9, this._evapF.frostLevel * 0.9);
            this._dynGroup.add(new Konva.Rect({
                x: r.x, y: r.y, width: r.w, height: r.h,
                fill: `rgba(200,230,255,${alpha})`,
                cornerRadius: 3,
            }));
            if (this._evapF.defrosting) {
                // 化霜加热指示（橙色边框闪烁）
                const t = (this._animFrame % 20) / 20;
                const gAlpha = 0.3 + 0.5 * Math.sin(t * Math.PI * 2);
                this._dynGroup.add(new Konva.Rect({
                    x: r.x - 1, y: r.y - 1, width: r.w + 2, height: r.h + 2,
                    fill: 'none',
                    stroke: `rgba(255,120,0,${gAlpha})`,
                    strokeWidth: 2, cornerRadius: 4,
                }));
            }
        }
        // 冷藏蒸发器结霜
        if (this._evapR.frostLevel > 0.05) {
            const r = this._evapRRect;
            const alpha = Math.min(0.9, this._evapR.frostLevel * 0.9);
            this._dynGroup.add(new Konva.Rect({
                x: r.x, y: r.y, width: r.w, height: r.h,
                fill: `rgba(200,240,210,${alpha})`,
                cornerRadius: 3,
            }));
        }
    }

    // 制冷剂流动动画（虚线管路）
    _drawRefrigerantFlow() {
        if (!this._compressor.running) return;
        const L  = this._layout;
        const cp = this._compPos;
        const ef = this._evapFRect;
        const er = this._evapRRect;
        const phase = (this._animFrame * 2) % 30; // 流动偏移

        // 压缩机→冷凝器→EEV-F→冷冻蒸发器（高压，红色）
        const flowAlpha = 0.5 + 0.2 * Math.sin(this._animFrame * 0.2);
        const color = `rgba(255,80,50,${flowAlpha})`;

        // 压缩机出口→EEV-F（简化路径）
        if (this._eevF.openPct > 2) {
            this._dynGroup.add(new Konva.Line({
                points: [
                    cp.x, L.mechY + 2,
                    this._eevFPos.x, L.mechY + 2,
                    this._eevFPos.x, ef.y + ef.h * 0.5,
                    ef.x + ef.w, ef.y + ef.h * 0.5,
                ],
                stroke: color,
                strokeWidth: 1.5,
                dash: [5, 3],
                dashOffset: -phase,
                lineJoin: 'round',
            }));
        }
        // 压缩机出口→EEV-R（简化路径）
        if (this._eevR.openPct > 2) {
            this._dynGroup.add(new Konva.Line({
                points: [
                    cp.x + cp.r, cp.y,
                    this._eevRPos.x + 20, this._eevRPos.y,
                    this._eevRPos.x, this._eevRPos.y,
                    this._eevRPos.x, er.y + er.h * 0.5,
                    er.x, er.y + er.h * 0.5,
                ],
                stroke: `rgba(80,200,100,${flowAlpha})`,
                strokeWidth: 1.5,
                dash: [5, 3],
                dashOffset: -phase,
                lineJoin: 'round',
            }));
        }
    }

    // 压缩机动画
    _drawCompressorAnimation() {
        const cp = this._compPos;
        if (!cp) return;
        const comp = this._compressor;

        if (comp.state === 'run') {
            // 旋转指示（模拟振动波纹）
            const freq = comp.frequency;
            const intensity = freq / 120;
            const t = this._animFrame * 0.15;
            for (let i = 1; i <= 3; i++) {
                const r = cp.r + i * 4;
                const alpha = Math.max(0, (0.4 - i * 0.1) * intensity * Math.sin(t + i));
                if (alpha > 0) {
                    this._dynGroup.add(new Konva.Ellipse({
                        x: cp.x, y: cp.y,
                        radiusX: r * 1.1, radiusY: r,
                        fill: 'none',
                        stroke: `rgba(255,180,0,${alpha})`,
                        strokeWidth: 1.5,
                    }));
                }
            }
            // 转速弧线（顺时针旋转角度指示）
            const angle = (this._animFrame * freq / 30) % 360;
            const rad   = angle * Math.PI / 180;
            this._dynGroup.add(new Konva.Arc({
                x: cp.x, y: cp.y,
                innerRadius: cp.r * 0.6,
                outerRadius: cp.r * 0.8,
                angle: 120,
                rotation: angle,
                fill: `rgba(255,160,0,${0.3 + 0.3 * intensity})`,
            }));
        } else if (comp.state === 'startup') {
            // 启动闪光
            const t = (this._animFrame % 8) / 8;
            const alpha = 0.3 + 0.5 * Math.sin(t * Math.PI * 2);
            this._dynGroup.add(new Konva.Ellipse({
                x: cp.x, y: cp.y,
                radiusX: cp.r * 1.1, radiusY: cp.r,
                fill: 'none',
                stroke: `rgba(255,255,0,${alpha})`,
                strokeWidth: 2,
            }));
        } else if (comp.state === 'protect') {
            // 保护状态：红色警示
            const t = (this._animFrame % 10) / 10;
            const alpha = 0.4 + 0.5 * Math.sin(t * Math.PI * 2);
            this._dynGroup.add(new Konva.Ellipse({
                x: cp.x, y: cp.y,
                radiusX: cp.r * 1.15, radiusY: cp.r * 1.05,
                fill: `rgba(255,0,0,${alpha * 0.2})`,
                stroke: `rgba(255,0,0,${alpha})`,
                strokeWidth: 2,
            }));
        }

        // 转速文字
        const freqText = comp.state === 'stop' ? 'OFF'
                       : comp.state === 'startup' ? 'START'
                       : comp.state === 'protect' ? 'PROT'
                       : `${comp.frequency.toFixed(0)}Hz`;
        this._dynGroup.add(new Konva.Text({
            x: cp.x - 14, y: cp.y + cp.r + 2,
            text: freqText,
            fontSize: 8, fontStyle: 'bold',
            fill: comp.state === 'protect' ? '#f44336'
                : comp.state === 'run'     ? '#ffa000'
                : comp.state === 'startup' ? '#ffeb3b'
                : '#888',
        }));
    }

    // EEV 动画（开度指示）
    _drawEEVAnimation() {
        this._drawSingleEEV(this._eevFPos, this._eevF, '#1565c0');
        this._drawSingleEEV(this._eevRPos, this._eevR, '#2e7d32');
    }

    _drawSingleEEV(pos, eev, color) {
        if (!pos) return;
        const pct = eev.openPct;
        // 开度扇形
        if (pct > 0) {
            const angle = pct / 100 * 160 - 80; // -80°~+80°
            const rad = (angle * Math.PI) / 180;
            const r = 6;
            this._dynGroup.add(new Konva.Line({
                points: [pos.x, pos.y, pos.x + r * Math.sin(rad), pos.y - r * Math.cos(rad)],
                stroke: color,
                strokeWidth: 1.5,
                lineCap: 'round',
            }));
        }
        // 开度数字
        this._dynGroup.add(new Konva.Text({
            x: pos.x - 10, y: pos.y + 12,
            text: `${pct.toFixed(0)}%`,
            fontSize: 8, fontStyle: 'bold',
            fill: color,
            width: 24, align: 'center',
        }));
        // 步进动画（阀门正在动作时显示脉冲波）
        if (eev.stepping) {
            const t = (this._animFrame % 6) / 6;
            const alpha = 0.3 + 0.5 * Math.sin(t * Math.PI * 2);
            this._dynGroup.add(new Konva.Text({
                x: pos.x - 6, y: pos.y - 24,
                text: eev.stepDir > 0 ? '▲' : '▼',
                fontSize: 8, fill: `rgba(${color.slice(1).match(/.{2}/g).map(v => parseInt(v, 16)).join(',')},${alpha})`,
            }));
        }
    }

    // 传感器温度显示
    _drawSensorReadouts() {
        const sensors = [
            { key: 'T1', label: 'T1', color: '#1565c0', format: v => `${v.toFixed(1)}℃` },
            { key: 'T2', label: 'T2', color: '#2e7d32', format: v => `${v.toFixed(1)}℃` },
            { key: 'T3', label: 'T3', color: '#0288d1', format: v => `${v.toFixed(1)}℃` },
            { key: 'T4', label: 'T4', color: '#388e3c', format: v => `${v.toFixed(1)}℃` },
            { key: 'T5', label: 'T5', color: '#f44336', format: v => `${v.toFixed(0)}℃` },
            { key: 'T6', label: 'T6', color: '#ff9800', format: v => `${v.toFixed(1)}℃` },
            { key: 'T7', label: 'T7', color: '#ff5722', format: v => `${v.toFixed(0)}℃` },
        ];
        sensors.forEach(s => {
            const pos = this._sensorPos[s.key];
            if (!pos) return;
            const val = this._sensors[s.key];
            const text = s.format(val);
            // 温度数值气泡
            const bW = 34, bH = 12;
            const bX = pos.x - 2;
            const bY = pos.y + 7;
            this._dynGroup.add(new Konva.Rect({
                x: bX, y: bY, width: bW, height: bH,
                fill: 'rgba(20,20,30,0.82)',
                cornerRadius: 3,
            }));
            this._dynGroup.add(new Konva.Text({
                x: bX + 2, y: bY + 1,
                text,
                fontSize: 8, fontStyle: 'bold',
                fill: s.color,
                width: bW - 4, align: 'center',
            }));
        });
    }

    // 报警指示
    _drawAlarmIndicators() {
        const alarms = this._alarms;
        const hasAlarm = Object.values(alarms).some(v => v);
        if (!hasAlarm) return;
        const L = this._layout;
        const t = (this._animFrame % 12) / 12;
        const alpha = 0.5 + 0.4 * Math.sin(t * Math.PI * 2);
        this._dynGroup.add(new Konva.Text({
            x: L.bodyX + 4, y: L.bodyY - 14,
            text: '⚠ ALM',
            fontSize: 11, fontStyle: 'bold',
            fill: `rgba(255,80,0,${alpha})`,
        }));
    }

    // ── 控制面板（右侧）────────────────────────────
    _drawControlPanel() {
        const L = this._layout;
        const px = L.panelX, pw = L.panelW;
        const py = 4, ph = L.H - 8;

        // 面板背景
        this.group.add(new Konva.Rect({
            x: px, y: py, width: pw, height: ph,
            fill: '#181c24',
            stroke: '#2a2e3a', strokeWidth: 1,
            cornerRadius: 6,
        }));
        // 面板标题
        this.group.add(new Konva.Text({
            x: px, y: py + 4,
            width: pw, text: '控制面板',
            fontSize: 9, fontStyle: 'bold', fill: '#546e7a', align: 'center',
        }));
        // 发光条
        this.group.add(new Konva.Rect({
            x: px + 4, y: py + 15,
            width: pw - 8, height: 1,
            fill: '#2a3a4a',
        }));

        // 面板内容（动态层中绘制，此处绘制静态标签）
        const labels = [
            { y: py + 20,  text: '压缩机' },
            { y: py + 58,  text: 'EEV-F' },
            { y: py + 100, text: 'EEV-R' },
            { y: py + 142, text: '设定温度' },
            { y: py + 200, text: '传感器' },
            { y: py + 310, text: '报警' },
        ];
        labels.forEach(l => {
            this.group.add(new Konva.Text({
                x: px + 2, y: l.y,
                width: pw - 4, text: l.text,
                fontSize: 8, fontStyle: 'bold', fill: '#37474f', align: 'left',
            }));
            this.group.add(new Konva.Line({
                points: [px + 4, l.y + 10, px + pw - 4, l.y + 10],
                stroke: '#1e2834', strokeWidth: 0.5,
            }));
        });

        // 动态面板层
        this._panelDynGroup = new Konva.Group();
        this.group.add(this._panelDynGroup);
        this._buildPanelDynamic();
    }

    _buildPanelDynamic() {
        this._panelDynGroup.destroyChildren();
        const L  = this._layout;
        const px = L.panelX, pw = L.panelW;
        const py = 4;
        const comp = this._compressor;

        // ── 压缩机状态 ──
        const stateColor = {
            stop:    '#546e7a',
            startup: '#ffeb3b',
            run:     '#66bb6a',
            protect: '#f44336',
        }[comp.state] || '#888';

        this._panelDynGroup.add(new Konva.Text({
            x: px + 2, y: py + 30,
            width: pw - 4,
            text: `状态: ${{'stop':'停机','startup':'启动中','run':'运行','protect':'保护'}[comp.state]}`,
            fontSize: 8, fill: stateColor,
        }));
        this._panelDynGroup.add(new Konva.Text({
            x: px + 2, y: py + 40,
            width: pw - 4,
            text: `频率: ${comp.frequency.toFixed(0)} Hz`,
            fontSize: 8, fill: comp.running ? '#ffa000' : '#546e7a',
        }));
        this._panelDynGroup.add(new Konva.Text({
            x: px + 2, y: py + 50,
            width: pw - 4,
            text: `时长: ${(comp.runHours).toFixed(1)} h`,
            fontSize: 8, fill: '#546e7a',
        }));

        // 频率进度条
        const barW = pw - 8;
        const freqPct = comp.frequency / 120;
        this._panelDynGroup.add(new Konva.Rect({
            x: px + 4, y: py + 53, width: barW, height: 3,
            fill: '#1e2834', cornerRadius: 1,
        }));
        if (freqPct > 0) {
            this._panelDynGroup.add(new Konva.Rect({
                x: px + 4, y: py + 53, width: barW * freqPct, height: 3,
                fill: '#ffa000', cornerRadius: 1,
            }));
        }

        // ── EEV-F 状态 ──
        const eevFPct = this._eevF.openPct;
        this._panelDynGroup.add(new Konva.Text({
            x: px + 2, y: py + 68, width: pw - 4,
            text: `开度: ${eevFPct.toFixed(0)}%  ${this._eevF.pulse}P`,
            fontSize: 8, fill: '#1e88e5',
        }));
        this._panelDynGroup.add(new Konva.Rect({
            x: px + 4, y: py + 78, width: barW, height: 3,
            fill: '#1e2834', cornerRadius: 1,
        }));
        this._panelDynGroup.add(new Konva.Rect({
            x: px + 4, y: py + 78, width: barW * eevFPct / 100, height: 3,
            fill: '#1e88e5', cornerRadius: 1,
        }));

        // ── EEV-R 状态 ──
        const eevRPct = this._eevR.openPct;
        this._panelDynGroup.add(new Konva.Text({
            x: px + 2, y: py + 110, width: pw - 4,
            text: `开度: ${eevRPct.toFixed(0)}%  ${this._eevR.pulse}P`,
            fontSize: 8, fill: '#43a047',
        }));
        this._panelDynGroup.add(new Konva.Rect({
            x: px + 4, y: py + 120, width: barW, height: 3,
            fill: '#1e2834', cornerRadius: 1,
        }));
        this._panelDynGroup.add(new Konva.Rect({
            x: px + 4, y: py + 120, width: barW * eevRPct / 100, height: 3,
            fill: '#43a047', cornerRadius: 1,
        }));

        // ── 设定 / 实测温度 ──
        const tempData = [
            { label: '冷冻设定', sp: this._freezerSetpoint, pv: this._sensors.T1, color: '#1e88e5' },
            { label: '冷藏设定', sp: this._fridgeSetpoint,  pv: this._sensors.T2, color: '#43a047' },
        ];
        tempData.forEach((td, i) => {
            const ty = py + 152 + i * 24;
            this._panelDynGroup.add(new Konva.Text({
                x: px + 2, y: ty, width: pw - 4,
                text: `${td.label}: ${td.sp.toFixed(0)}℃`,
                fontSize: 8, fill: '#546e7a',
            }));
            const diff = td.pv - td.sp;
            const pvColor = Math.abs(diff) < 1 ? '#66bb6a' : diff > 0 ? '#f44336' : '#1e88e5';
            this._panelDynGroup.add(new Konva.Text({
                x: px + 2, y: ty + 11, width: pw - 4,
                text: `实测: ${td.pv.toFixed(1)}℃  Δ${diff >= 0 ? '+' : ''}${diff.toFixed(1)}`,
                fontSize: 8, fill: pvColor,
            }));
        });

        // ── 传感器列表 ──
        const sensorList = [
            { key: 'T3', label: 'T3冷冻蒸发', color: '#0288d1' },
            { key: 'T4', label: 'T4冷藏蒸发', color: '#388e3c' },
            { key: 'T5', label: 'T5压机排气', color: '#f44336' },
            { key: 'T6', label: 'T6 环境', color: '#ff9800' },
            { key: 'T7', label: 'T7 冷凝', color: '#ff5722' },
        ];
        sensorList.forEach((s, i) => {
            const sy = py + 212 + i * 19;
            const val = this._sensors[s.key];
            this._panelDynGroup.add(new Konva.Text({
                x: px + 2, y: sy, width: pw - 4,
                text: `${s.label}: ${val.toFixed(1)}℃`,
                fontSize: 7.5, fill: s.color,
            }));
        });

        // ── 报警状态 ──
        const alarmList = [
            { key: 'highDischarge', label: '排气高温', color: '#f44336' },
            { key: 'freezerHigh',   label: '冷冻高温', color: '#1e88e5' },
            { key: 'fridgeHigh',    label: '冷藏高温', color: '#43a047' },
        ];
        alarmList.forEach((a, i) => {
            const ay = py + 320 + i * 16;
            const active = this._alarms[a.key];
            this._panelDynGroup.add(new Konva.Circle({
                x: px + 6, y: ay + 4, radius: 3,
                fill: active ? a.color : '#1e2834',
                stroke: active ? a.color : '#2e3844',
                strokeWidth: 0.8,
                shadowColor: active ? a.color : 'transparent',
                shadowBlur:  active ? 4 : 0,
                shadowOpacity: 0.8,
            }));
            this._panelDynGroup.add(new Konva.Text({
                x: px + 12, y: ay, width: pw - 16,
                text: a.label,
                fontSize: 7.5,
                fill: active ? a.color : '#37474f',
                fontStyle: active ? 'bold' : 'normal',
            }));
        });
    }

    // ── 顶部标签 ────────────────────────────────────
    _drawLabel() {
        this.group.add(new Konva.Text({
            x: 0, y: 0, width: this._layout.bodyW,
            text: `${this.label}  双温区变频冰箱仿真`,
            fontSize: 9, fontStyle: 'bold', fill: '#546e7a', align: 'center',
        }));
    }

    // ── 交互绑定 ────────────────────────────────────
    _bindInteraction() {
        // 点击冷冻室：循环调整冷冻设定温度
        const L = this._layout;
        const freezerHitArea = new Konva.Rect({
            x: L.bodyX + 6, y: L.bodyY + 6,
            width: L.bodyW - 12, height: L.freezerH - 4,
            fill: 'transparent',
            listening: true,
        });
        freezerHitArea.on('click tap', () => {
            this.setFreezerSetpoint(
                Math.max(this._FREEZER_MIN,
                    (this._freezerSetpoint - 1) < this._FREEZER_MIN
                        ? this._FREEZER_MAX
                        : this._freezerSetpoint - 1
                )
            );
        });
        this.group.add(freezerHitArea);

        // 点击冷藏室：循环调整冷藏设定温度
        const fridgeHitArea = new Konva.Rect({
            x: L.bodyX + 6, y: L.bodyY + L.freezerH + 2,
            width: L.bodyW - 12, height: L.fridgeH - 4,
            fill: 'transparent',
            listening: true,
        });
        fridgeHitArea.on('click tap', () => {
            this.setFridgeSetpoint(
                Math.max(this._FRIDGE_MIN,
                    (this._fridgeSetpoint - 1) < this._FRIDGE_MIN
                        ? this._FRIDGE_MAX
                        : this._fridgeSetpoint - 1
                )
            );
        });
        this.group.add(fridgeHitArea);

        // 点击压缩机：手动切换启停（调试用）
        const compHit = new Konva.Ellipse({
            x: this._compPos.x, y: this._compPos.y,
            radiusX: this._compPos.r * 1.1, radiusY: this._compPos.r,
            fill: 'transparent', listening: true,
        });
        compHit.on('click tap', () => {
            if (this._compressor.state === 'stop' && this._compressor.offTimer <= 0) {
                this._startCompressor();
            } else if (this._compressor.running) {
                this._stopCompressor();
            }
        });
        this.group.add(compHit);
    }

    // ═══════════════════════════════════════════════════
    // 核心 tick：由 sys._tickAll 以 ~20fps 调用
    tick(dt) {
        const simDt = dt * this._simSpeed;  // 仿真时间步
        this._simTime += simDt;

        this._tickControl(simDt);
        this._tickCompressor(simDt, dt);
        this._tickEEV(simDt);
        this._tickThermal(simDt);
        this._tickSensors();
        this._tickAlarms();
        this._tickDefrost(simDt);

        this._animFrame++;

        // 更新历史数据（约每5次tick记录一次）
        if (this._animFrame % 5 === 0) {
            this._pushHistory();
        }

        this._buildDynamic();
        this._buildPanelDynamic();
        this._refreshCache();
    }

    // ── 控制逻辑 ─────────────────────────────────────
    _tickControl(dt) {
        const comp   = this._compressor;
        const T1     = this._sensors.T1;   // 冷冻室实测
        const T2     = this._sensors.T2;   // 冷藏室实测
        const spF    = this._freezerSetpoint;
        const spR    = this._fridgeSetpoint;

        // 最大温差（决定是否需要制冷）
        const errF = T1 - spF;  // 正值 = 需要制冷
        const errR = T2 - spR;

        // 停机判断
        const needCool = errF > 0.3 || errR > 0.5;
        const canStop  = errF < -0.5 && errR < -0.3;

        if (!comp.running && comp.state === 'stop') {
            if (needCool && comp.offTimer <= 0) {
                this._startCompressor();
            }
        } else if (comp.running && canStop) {
            this._stopCompressor();
        }

        // 压缩机变频调速
        if (comp.state === 'run') {
            const err = Math.max(errF * 1.5, errR);
            let targetFreq = 30 + err * 12;
            targetFreq = Math.max(30, Math.min(120, targetFreq));
            // 渐变频率
            const freqErr = targetFreq - comp.frequency;
            comp.frequency += Math.sign(freqErr) * Math.min(Math.abs(freqErr), 5 * dt);
            comp.frequency = Math.max(0, Math.min(120, comp.frequency));
            comp.targetFreq = targetFreq;
        }

        // EEV 开度控制
        if (comp.running) {
            // 冷冻阀：T3过热度控制（蒸发器出口 - 蒸发温度）
            const superheatF = this._sensors.T3 - (spF - 8);
            const targetPulseF = Math.max(0, Math.min(480,
                240 + superheatF * 20 + errF * 30
            ));
            this._eevF.targetPulse = Math.round(targetPulseF);

            // 冷藏阀：T4过热度控制
            const superheatR = this._sensors.T4 - (spR - 5);
            const targetPulseR = Math.max(0, Math.min(480,
                160 + superheatR * 15 + errR * 25
            ));
            this._eevR.targetPulse = Math.round(targetPulseR);
        } else {
            // 停机时关闭阀门
            this._eevF.targetPulse = 0;
            this._eevR.targetPulse = 0;
        }
    }

    // ── 压缩机仿真 ───────────────────────────────────
    _tickCompressor(simDt, realDt) {
        const comp = this._compressor;
        comp.offTimer = Math.max(0, comp.offTimer - simDt);

        if (comp.state === 'startup') {
            comp.startupTimer -= simDt;
            if (comp.startupTimer <= 0) {
                comp.state    = 'run';
                comp.running  = true;
                comp.frequency = 30;
            }
        }

        if (comp.state === 'run') {
            comp.runHours += realDt / 3600;
            // 排气温度模型
            const targetDisch = 65 + comp.frequency * 0.4
                              + (this._ambientTemp - 25) * 0.8;
            comp.dischargTemp += (targetDisch - comp.dischargTemp) * simDt * 0.02;
            // 过热保护
            if (comp.dischargTemp > 110) {
                comp.state   = 'protect';
                comp.running = false;
                comp.frequency = 0;
                this._alarms.highDischarge = true;
            }
            // 电流
            comp.current = 0.5 + comp.frequency * 0.04;
        } else if (comp.state === 'protect') {
            // 保护冷却
            comp.dischargTemp += (this._ambientTemp + 10 - comp.dischargTemp) * simDt * 0.01;
            if (comp.dischargTemp < 80) {
                comp.state = 'stop';
                this._alarms.highDischarge = false;
            }
        } else {
            comp.frequency    = Math.max(0, comp.frequency - 20 * simDt);
            comp.current      = 0;
            comp.dischargTemp += (this._ambientTemp - comp.dischargTemp) * simDt * 0.005;
        }
    }

    // ── EEV 步进仿真 ─────────────────────────────────
    _tickEEV(simDt) {
        [
            { eev: this._eevF, label: 'F' },
            { eev: this._eevR, label: 'R' },
        ].forEach(({ eev }) => {
            const diff = eev.targetPulse - eev.pulse;
            if (Math.abs(diff) < 1) {
                eev.pulse    = eev.targetPulse;
                eev.stepping = false;
                eev.stepDir  = 0;
            } else {
                // 步进速度：约300 pulse/s
                const step = Math.min(Math.abs(diff), 300 * simDt);
                eev.pulse  += Math.sign(diff) * step;
                eev.pulse   = Math.max(0, Math.min(eev.maxPulse, eev.pulse));
                eev.stepping = true;
                eev.stepDir  = Math.sign(diff);
            }
            eev.openPct  = (eev.pulse / eev.maxPulse) * 100;
            eev.flowRate = eev.openPct / 100;
        });
    }

    // ── 热力学仿真 ───────────────────────────────────
    _tickThermal(simDt) {
        const comp   = this._compressor;
        const Ta     = this._ambientTemp;

        // 漏热量
        const QleakF = this._freezerUA * (Ta - this._freezerTemp); // W
        const QleakR = this._fridgeUA  * (Ta - this._fridgeTemp);

        // 压缩机实际制冷量（按频率和阀开度分配）
        let QcoolTotal = 0;
        if (comp.state === 'run') {
            const COP = 1.8 - (comp.frequency - 30) / 120 * 0.3;
            QcoolTotal = comp.frequency * 1.5 * COP; // W
        }
        const QcoolF = QcoolTotal * 0.55 * this._eevF.flowRate;
        const QcoolR = QcoolTotal * 0.45 * this._eevR.flowRate;

        // 温度变化
        this._freezerTemp += (QleakF - QcoolF) / this._freezerThermalMass * simDt;
        this._fridgeTemp  += (QleakR - QcoolR) / this._fridgeThermalMass  * simDt;

        // 限制物理极限
        this._freezerTemp = Math.max(-35, Math.min(Ta + 2, this._freezerTemp));
        this._fridgeTemp  = Math.max(-5,  Math.min(Ta + 2, this._fridgeTemp));

        // 蒸发器温度
        const evapTF = this._freezerTemp - 8 + (1 - this._eevF.flowRate) * 5;
        const evapTR = this._fridgeTemp  - 5 + (1 - this._eevR.flowRate) * 4;
        this._evapF.inletTemp  += (evapTF - this._evapF.inletTemp)  * simDt * 0.1;
        this._evapF.outletTemp += (evapTF + 6 - this._evapF.outletTemp) * simDt * 0.08;
        this._evapR.inletTemp  += (evapTR - this._evapR.inletTemp)  * simDt * 0.1;
        this._evapR.outletTemp += (evapTR + 5 - this._evapR.outletTemp) * simDt * 0.08;

        // 冷凝器温度
        const condT = Ta + 15 + comp.frequency * 0.2;
        this._condenser.inletTemp  += (condT + 8 - this._condenser.inletTemp)  * simDt * 0.05;
        this._condenser.outletTemp += (condT - 5  - this._condenser.outletTemp) * simDt * 0.05;
        this._condenser.fanRunning  = comp.running;

        // 结霜（蒸发器 < -2℃ 且湿度环境下结霜）
        if (this._evapF.inletTemp < -2 && !this._evapF.defrosting) {
            this._evapF.frostLevel = Math.min(1, this._evapF.frostLevel + 0.0005 * simDt);
        }
        if (this._evapR.inletTemp < 0 && !this._evapR.defrosting) {
            this._evapR.frostLevel = Math.min(1, this._evapR.frostLevel + 0.0003 * simDt);
        }
    }

    // ── 传感器更新（加噪声模拟NTC误差）──────────────
    _tickSensors() {
        const noise = () => (Math.random() - 0.5) * 0.1;
        this._sensors.T1 = this._freezerTemp + noise();
        this._sensors.T2 = this._fridgeTemp  + noise();
        this._sensors.T3 = this._evapF.inletTemp  + noise();
        this._sensors.T4 = this._evapR.inletTemp  + noise();
        this._sensors.T5 = this._compressor.dischargTemp + noise() * 2;
        this._sensors.T6 = this._ambientTemp + noise() * 0.5;
        this._sensors.T7 = (this._condenser.inletTemp + this._condenser.outletTemp) / 2 + noise();
    }

    // ── 报警逻辑 ─────────────────────────────────────
    _tickAlarms() {
        this._alarms.freezerHigh = this._sensors.T1 > (this._freezerSetpoint + 8);
        this._alarms.fridgeHigh  = this._sensors.T2 > (this._fridgeSetpoint  + 6);
        // highDischarge 由压缩机仿真负责
    }

    // ── 化霜控制 ─────────────────────────────────────
    _tickDefrost(simDt) {
        // 冷冻室：结霜量>0.8 触发化霜
        if (this._evapF.frostLevel > 0.8 && !this._evapF.defrosting) {
            this._evapF.defrosting  = true;
            this._evapF.defrostTimer = 1800; // 30分钟化霜（仿真秒）
            this._stopCompressor();
        }
        if (this._evapF.defrosting) {
            this._evapF.defrostTimer -= simDt;
            this._evapF.frostLevel   -= 0.002 * simDt;
            if (this._evapF.frostLevel <= 0 || this._evapF.defrostTimer <= 0) {
                this._evapF.frostLevel  = 0;
                this._evapF.defrosting  = false;
            }
        }
        // 冷藏室类似
        if (this._evapR.frostLevel > 0.7 && !this._evapR.defrosting) {
            this._evapR.defrosting  = true;
            this._evapR.defrostTimer = 1200;
        }
        if (this._evapR.defrosting) {
            this._evapR.defrostTimer -= simDt;
            this._evapR.frostLevel   -= 0.0015 * simDt;
            if (this._evapR.frostLevel <= 0 || this._evapR.defrostTimer <= 0) {
                this._evapR.frostLevel = 0;
                this._evapR.defrosting = false;
            }
        }
    }

    // ── 历史数据记录 ─────────────────────────────────
    _pushHistory() {
        const max = this._history.maxLen;
        ['T1', 'T2', 'T3', 'T4'].forEach(k => {
            this._history[k].push(this._sensors[k]);
            if (this._history[k].length > max) this._history[k].shift();
        });
    }

    // ═══════════════════════════════════════════════════
    // 私有辅助：启动/停止压缩机
    _startCompressor() {
        const comp = this._compressor;
        if (comp.state !== 'stop') return;
        comp.state       = 'startup';
        comp.startupTimer = 3;   // 3s 启动延时
        comp.startCount++;
        comp.offTimer    = 0;
    }

    _stopCompressor() {
        const comp = this._compressor;
        if (!comp.running && comp.state !== 'startup') return;
        comp.state   = 'stop';
        comp.running = false;
        comp.offTimer = comp.minOffTime;
    }

    // ═══════════════════════════════════════════════════
    // 公开 API

    /** 设置冷冻室目标温度（℃） */
    setFreezerSetpoint(sp) {
        this._freezerSetpoint = Math.max(this._FREEZER_MIN, Math.min(this._FREEZER_MAX, sp));
    }

    /** 设置冷藏室目标温度（℃） */
    setFridgeSetpoint(sp) {
        this._fridgeSetpoint = Math.max(this._FRIDGE_MIN, Math.min(this._FRIDGE_MAX, sp));
    }

    /** 设置环境温度 */
    setAmbientTemp(t) {
        this._ambientTemp = Math.max(-10, Math.min(50, t));
        this._sensors.T6 = this._ambientTemp;
    }

    /** 设置仿真加速倍率（1=实时，60=60x加速） */
    setSimSpeed(speed) {
        this._simSpeed = Math.max(1, Math.min(3600, speed));
    }

    /** 手动触发化霜 */
    triggerDefrost(zone = 'both') {
        if (zone === 'freezer' || zone === 'both') {
            this._evapF.defrosting  = true;
            this._evapF.defrostTimer = 1800;
        }
        if (zone === 'fridge' || zone === 'both') {
            this._evapR.defrosting  = true;
            this._evapR.defrostTimer = 1200;
        }
        this._stopCompressor();
    }

    /** 获取当前完整状态快照 */
    getState() {
        return {
            time:       this._simTime,
            freezerTemp: this._freezerTemp,
            fridgeTemp:  this._fridgeTemp,
            freezerSP:   this._freezerSetpoint,
            fridgeSP:    this._fridgeSetpoint,
            sensors:     { ...this._sensors },
            compressor: {
                state:       this._compressor.state,
                frequency:   this._compressor.frequency,
                runHours:    this._compressor.runHours,
                dischargeTemp: this._compressor.dischargTemp,
            },
            eevF: { pulse: this._eevF.pulse, openPct: this._eevF.openPct },
            eevR: { pulse: this._eevR.pulse, openPct: this._eevR.openPct },
            alarms: { ...this._alarms },
        };
    }

    /** 获取温度历史（用于趋势图） */
    getHistory() {
        return { ...this._history };
    }

    isCooling()    { return this._compressor.running; }
    getAlarms()    { return { ...this._alarms }; }
    getFreezerTemp() { return this._sensors.T1; }
    getFridgeTemp()  { return this._sensors.T2; }

    // ═══════════════════════════════════════════════════
    update(state) {
        if (typeof state === 'object') {
            if (state.freezerSetpoint !== undefined) this.setFreezerSetpoint(state.freezerSetpoint);
            if (state.fridgeSetpoint  !== undefined) this.setFridgeSetpoint(state.fridgeSetpoint);
            if (state.ambientTemp     !== undefined) this.setAmbientTemp(state.ambientTemp);
        }
        this._refreshCache();
    }

    getConfigFields() {
        return [
            { label: '位号/名称',           key: 'label',            type: 'text'   },
            { label: '冷冻室设定温度 (℃)',   key: 'freezerSetpoint',  type: 'number' },
            { label: '冷藏室设定温度 (℃)',   key: 'fridgeSetpoint',   type: 'number' },
            { label: '环境温度 (℃)',         key: 'ambientTemp',      type: 'number' },
            { label: '仿真加速倍率',          key: 'simSpeed',         type: 'number' },
        ];
    }

    onConfigUpdate(cfg) {
        if (cfg.label)           this.label = cfg.label;
        if (cfg.freezerSetpoint !== undefined) this.setFreezerSetpoint(parseFloat(cfg.freezerSetpoint));
        if (cfg.fridgeSetpoint  !== undefined) this.setFridgeSetpoint(parseFloat(cfg.fridgeSetpoint));
        if (cfg.ambientTemp     !== undefined) this.setAmbientTemp(parseFloat(cfg.ambientTemp));
        if (cfg.simSpeed        !== undefined) this.setSimSpeed(parseFloat(cfg.simSpeed));
        this.config = { ...this.config, ...cfg };
        this._refreshCache();
    }

    destroy() {
        this._dynGroup?.destroy();
        this._panelDynGroup?.destroy();
        super.destroy?.();
    }
}