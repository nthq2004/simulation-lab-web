import { BaseComponent } from './BaseComponent.js';

/**
 * 燃油加热器仿真组件
 * （Fuel Oil Steam Heater with Control Panel & PT100）
 *
 * ── 系统概述 ──────────────────────────────────────────────────
 *  船用/工业重油加热系统，通过蒸汽加热重燃料油，
 *  使其达到喷射粘度所需温度（通常 100~140°C）。
 *
 *  ┌─────────────────────────────────────────────────────────┐
 *  │  蒸汽进口  →  电动调节阀  →  加热器  →  疏水阀  →  蒸汽冷凝水出口  │
 *  │                                                         │
 *  │  燃油进口（底部）→  管程加热  →  燃油出口（顶部）→  PT100  │
 *  └─────────────────────────────────────────────────────────┘
 *
 * ── 工作原理 ──────────────────────────────────────────────────
 *  1. 蒸汽侧（壳程）：
 *     饱和蒸汽（约 180°C / 10 bar）从左侧进入壳体，
 *     经电动调节阀控制流量，在换热管外冷凝释热。
 *     冷凝水经疏水阀排出。
 *
 *  2. 燃油侧（管程）：
 *     重燃料油（冷态约 30~50°C）从加热器底部进入，
 *     流经换热管束，被蒸汽加热至目标温度（通常 130°C）。
 *     加热后燃油从顶部出口送往燃油系统。
 *
 *  3. 温度控制回路：
 *     PT100 铂电阻温度传感器检测出口燃油温度
 *     → 4-20mA 信号送至温控器 / DCS
 *     → 调节电动调节阀开度（0~100%）
 *     → 控制蒸汽流量 → 维持燃油出口温度恒定
 *
 * ── 组件结构 ──────────────────────────────────────────────────
 *  左侧：控制面板（本地/遥控切换、增大阀门、减小阀门）
 *  中间：换热器主体 + 电动调节阀
 *  右侧：PT100 铂电阻（工业实物模型，两线制）
 *
 * ── 端口 ─────────────────────────────────────────────────────
 *  pipe_steam_in   — 蒸汽进口
 *  pipe_cond_out   — 冷凝水出口
 *  pipe_oil_in     — 燃油进口（底部）
 *  pipe_oil_out    — 燃油出口（顶部）
 *  valve_ctrl_l    — 电动阀控制信号正极（4-20mA）
 *  valve_ctrl_r    — 电动阀控制信号负极
 *  pt100_p         — PT100 信号正极
 *  pt100_n         — PT100 信号负极
 */
export class FuelOilHeater extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.width = Math.max(550, config.width || 580);
        this.height = Math.max(360, config.height || 400);
        this.scale = 1.0;

        this.type = 'resistor';
        this.special = 'oilheater';
        this.cache = 'fixed';

        // ── 物理参数 ──
        this.steamTemp = config.steamTemp || 180;   // 蒸汽温度 °C
        this.steamPressure = config.steamPressure || 10;    // 蒸汽压力 bar
        this.oilTempIn = config.oilTempIn || 40;    // 燃油进口温度 °C
        this.oilTempTarget = config.oilTempTarget || 120;   // 目标出口温度 °C

        // 燃油流量参数（可调节）
        this.oilFlowMin = config.oilFlowMin || 2.0;    // 最小流量 t/h
        this.oilFlowMax = config.oilFlowMax || 12.0;   // 最大流量 t/h
        this.oilFlowRate = config.oilFlowRate || 5.0;    // 当前燃油流量 t/h

        this.UA = config.UA || 5000; // 总传热系数×面积 W/K
        this.Cp_oil = config.Cp_oil || 2000;  // 燃油比热容 J/(kg·K)
        this.hiAlarm = config.hiAlarm || 145;   // 高温报警 °C
        this.loAlarm = config.loAlarm || 70;    // 低温报警 °C
        
        // ── 热容延迟参数 ──
        // thermalMassTimeConstant: 热容时间常数 (s)，越大温度变化越慢
        this.thermalMassTimeConstant = config.thermalMassTimeConstant || 18.0;

        // ── 电动调节阀参数（带本地/遥控模式）──
        this.valveMode = config.valveMode || 'local';   // 'local' | 'remote'
        this.valvePosition = config.valvePosition || 50;    // 实际阀位 %
        this.valveTarget = config.valvePosition || 50;    // 目标阀位 %
        this.valveActSpeed = config.valveActSpeed || 10;    // 执行速度 %/s
        this.maxSteamFlow = config.maxSteamFlow || 100;    // 最大蒸汽流量 %

        // ── 状态 ──
        this.oilTempOut = this.oilTempIn;     // 燃油出口温度 °C（实际显示值，带延迟）
        this.oilTempOutTarget = this.oilTempIn;  // 燃油出口温度目标值（计算值，无延迟）
        this.currentResistance = 100;              // PT100 阻值 Ω
        this.steamFlow = 0;                  // 蒸汽流量（相对值 0~1）
        this.alarmHi = false;
        this.alarmLo = false;
        // ── 流量旋钮状态 ──
        this._flowKnobValue = (this.oilFlowRate - this.oilFlowMin) / (this.oilFlowMax - this.oilFlowMin);

        // ── 动画 ──
        this._oilPhase = 0;
        this._steamPhase = 0;
        this._valveGlow = 0;
        this._condPhase = 0;
        this._heatPhase = 0;

        // ── 几何布局 ──
        // 控制面板（左侧）
        this.controlX = 10;
        this.controlW = 110;
        this.controlY = Math.round(this.height * 0.12);
        this.controlH = Math.round(this.height * 0.32);

        // 电动调节阀（控制面板右侧）
        this._valveX = this.controlX + this.controlW + 10;
        this._valveY = Math.round(this.height * 0.32);
        this._valveW = 45;

        // 换热器主体（中部）
        this._hxX = this._valveX + this._valveW + 15;
        this._hxY = Math.round(this.height * 0.18);
        this._hxW = Math.round(this.width * 0.42);
        this._hxH = Math.round(this.height * 0.56);
        this._hxCY = this._hxY + this._hxH / 2;
        this._hxCX = this._hxX + this._hxW / 2;

        // 蒸汽进管中心线
        this._steamLineY = this._hxCY - this._hxH * 0.15;

        // 燃油管道
        this._oilInY = this._hxY + this._hxH - 18;
        this._oilOutY = this._hxY + 18;

        // PT100（右侧）
        this._pt100X = this._hxX + this._hxW + 15;
        this._pt100Y = this._oilOutY - 12;
        this._pt100W = 75;
        this._pt100H = 95;

        this.knobs = {};

        this.config = {
            id: this.id, steamTemp: this.steamTemp, oilTempIn: this.oilTempIn,
            oilTempTarget: this.oilTempTarget, hiAlarm: this.hiAlarm, loAlarm: this.loAlarm,
            oilFlowRate: this.oilFlowRate, oilFlowMin: this.oilFlowMin, oilFlowMax: this.oilFlowMax,
        };
        // ── 支持整体缩放的组 ──
        this.scaleGroup = new Konva.Group({ scaleX: this.scale, scaleY: this.scale });
        this.group.add(this.scaleGroup);
        this._init();

        // 电动阀控制端口（4-20mA 输入）
        this.addPort(60 * this.scale, this.controlY * this.scale, 'p', 'wire', 'p');
        this.addPort(110 * this.scale, this.controlY * this.scale, 'n', 'wire');
        // PT100 两线制输出端口
        this.addPort(this.width * this.scale - 112 * this.scale, this._pt100Y * this.scale, 'l', 'wire', 'p');
        this.addPort(this.width * this.scale - 72 * this.scale, this._pt100Y * this.scale, 'r', 'wire');
    }

    // ═══════════════════════════════════════════
    // 初始化绘图
    // ═══════════════════════════════════════════
    _init() {

        this._drawControlPanel();      // 控制面板（本地/遥控 + 增大/减小按钮）
        this._drawSteamInlet();
        this._drawControlValve();
        this._drawHeatExchangerShell();
        this._drawTubeBundle();
        this._drawSteamLayer();
        this._drawOilFlowLayer();
        this._drawTrapValve();
        this._drawOilPipes();

        this._drawFlowKnob();       // 新增：流量调节旋钮        
        this._drawPT100Sensor();       // PT100 工业实物模型
        
    }


    // ═══════════════════════════════════════════
    // 1. 控制面板（参照水箱控制系统）
    // ═══════════════════════════════════════════
    _drawControlPanel() {
        const panelX = this.controlX + 20;
        const panelW = this.controlW;
        const panelY = this.controlY;
        const panelH = this.controlH;

        // 面板底板
        this.scaleGroup.add(new Konva.Rect({
            x: panelX, y: panelY,
            width: panelW, height: panelH,
            fill: '#e8e6e0',
            stroke: '#999', strokeWidth: 1.5,
            cornerRadius: 6,
        }));

        // 面板标题
        this.scaleGroup.add(new Konva.Text({
            x: panelX, y: panelY + 6,
            width: panelW,
            text: '电动调节阀控制',
            fontSize: 11, fontStyle: 'bold',
            fill: '#444', align: 'center'
        }));

        // ── 手动/遥控转换开关 ──
        const switchX = panelX + panelW / 2;
        const switchY = panelY + 42;

        this.scaleGroup.add(new Konva.Circle({
            x: switchX, y: switchY,
            radius: 14,
            fill: '#555',
            stroke: '#222', strokeWidth: 2
        }));

        this.scaleGroup.add(new Konva.Text({
            x: switchX - 38, y: switchY - 8,
            text: 'LOC', fontSize: 9, fontStyle: 'bold',
            fill: '#222', align: 'center'
        }));
        this.scaleGroup.add(new Konva.Text({
            x: switchX + 22, y: switchY - 8,
            text: 'REM', fontSize: 9, fontStyle: 'bold',
            fill: '#222', align: 'center'
        }));

        this._modeKnob = new Konva.Group({ x: switchX, y: switchY, cursor: 'pointer' });
        this._modeKnob.add(new Konva.Circle({ radius: 10, fill: '#888', stroke: '#000', strokeWidth: 1.5 }));
        this._modeKnob.add(new Konva.Rect({ x: -1.5, y: -8, width: 3, height: 8, fill: '#ffcc00', cornerRadius: 1 }));
        this._modeKnob.rotation(-45);
        this._modeKnob.on('click', () => {
            this.valveMode = this.valveMode === 'local' ? 'remote' : 'local';
            this._modeKnob.rotation(this.valveMode === 'local' ? -45 : 45);
            this._refreshCache();
        });
        this.scaleGroup.add(this._modeKnob);

        // ── 增大阀门按钮 ──
        const incBtnX = panelX + 20;
        const incBtnY = panelY + 72;
        this._incBtn = new Konva.Circle({
            x: incBtnX, y: incBtnY,
            radius: 13,
            fill: '#0a810a',
            stroke: '#000', strokeWidth: 2,
            cursor: 'pointer'
        });
        this._incBtn.on('mousedown', () => {
            if (this.valveMode === 'local') {
                this.valveTarget = Math.min(100, this.valveTarget + 5);
                this._incBtn.y(incBtnY + 2);
            }
        });
        this._incBtn.on('mouseup mouseleave', () => { this._incBtn.y(incBtnY); });
        this.scaleGroup.add(this._incBtn);
        this.scaleGroup.add(new Konva.Text({
            x: incBtnX - 8, y: incBtnY + 16,
            text: '增大', fontSize: 9, fill: '#444', align: 'center'
        }));

        // ── 减小阀门按钮 ──
        const decBtnX = panelX + panelW - 20;
        const decBtnY = panelY + 72;
        this._decBtn = new Konva.Circle({
            x: decBtnX, y: decBtnY,
            radius: 13,
            fill: '#871212',
            stroke: '#000', strokeWidth: 2,
            cursor: 'pointer'
        });
        this._decBtn.on('mousedown', () => {
            if (this.valveMode === 'local') {
                this.valveTarget = Math.max(0, this.valveTarget - 5);
                this._decBtn.y(decBtnY + 2);
            }
        });
        this._decBtn.on('mouseup mouseleave', () => { this._decBtn.y(decBtnY); });
        this.scaleGroup.add(this._decBtn);
        this.scaleGroup.add(new Konva.Text({
            x: decBtnX - 8, y: decBtnY + 16,
            text: '减小', fontSize: 9, fill: '#444', align: 'center'
        }));

        // 阀位指示百分比
        this._valvePercentText = new Konva.Text({
            x: panelX, y: panelY + panelH - 28,
            width: panelW,
            text: '开度: 50%',
            fontSize: 11, fontStyle: 'bold',
            fill: '#3366cc', align: 'center',
        });
        this.scaleGroup.add(this._valvePercentText);

        // 模式指示
        this._modeStatusText = new Konva.Text({
            x: panelX, y: panelY + panelH - 12,
            width: panelW,
            text: '本地模式',
            fontSize: 9,
            fill: '#888', align: 'center',
        });
        this.scaleGroup.add(this._modeStatusText);
    }

    _addPanelPort(x, y, label, color) {
        // 接线端子块
        this.scaleGroup.add(new Konva.Rect({
            x: x - 5, y: y - 3,
            width: 10, height: 6,
            fill: '#ddd6c0',
            stroke: '#666', strokeWidth: 0.8,
            cornerRadius: 1,
        }));
        this.scaleGroup.add(new Konva.Circle({
            x: x, y: y,
            radius: 2.5,
            fill: color,
            stroke: '#444', strokeWidth: 0.5,
        }));
        this.scaleGroup.add(new Konva.Text({
            x: x - 3, y: y - 12,
            text: label,
            fontSize: 7, fontStyle: 'bold',
            fill: color, align: 'center',
        }));
    }

    // ── 蒸汽进管 ────────────────────────────────
    _drawSteamInlet() {
        const sY = this._steamLineY;
        const vx = this._valveX;

        this.scaleGroup.add(new Konva.Text({ x: 80, y: sY + 28, text: '蒸汽进口', fontSize: 10, fontStyle: 'bold', fill: '#1815f1' }));
        this.scaleGroup.add(new Konva.Text({ x: 80, y: sY + 54, text: `${this.steamTemp}°C`, fontSize: 9, fontFamily: 'monospace', fill: '#f90a0a' }));
    }

    // ── 电动调节阀（紧凑型）──────────────────
    _drawControlValve() {
        const vx = this._valveX, vy = this._valveY;
        const vw = this._valveW, sY = this._steamLineY;

        // 阀前管道
        this.scaleGroup.add(new Konva.Rect({ x: vx - 30, y: sY + 40, width: 20, height: 12, fill: '#78909c', stroke: '#546e7a', strokeWidth: 1 }));

        // 阀体
        const valveCX = vx + vw / 2, valveCY = sY;
        const vBody = new Konva.Rect({
            x: vx - 10, y: sY + 34,
            width: vw, height: 24,
            fill: '#607d8b', stroke: '#37474f', strokeWidth: 1.5,
            cornerRadius: 4,
        });

        // 蝶板
        this._valveDisk = new Konva.Line({
            points: [valveCX - 18, valveCY + 80, valveCX, valveCY + 80],
            stroke: '#06fc58', strokeWidth: 4, lineCap: 'round',
        });



        // 阀后管道
        this.scaleGroup.add(new Konva.Rect({ x: vx + vw - 10, y: sY + 40, width: this._hxX - (vx + vw), height: 12, fill: '#78909c', stroke: '#546e7a', strokeWidth: 1 }));

        this.scaleGroup.add(vBody, this._valveDisk);
        this.scaleGroup.add(new Konva.Circle({ x: valveCX - 10, y: valveCY + 46, radius: 2, fill: '#0da9f7' }));
        this._valveCX = valveCX;
        this._valveCY = valveCY;
    }

    // ── 换热器壳体 ────────────────────────────
    _drawHeatExchangerShell() {
        const hx = this._hxX, hy = this._hxY, hw = this._hxW, hh = this._hxH;

        this.scaleGroup.add(new Konva.Rect({ x: hx, y: hy, width: hw, height: hh, fill: '#546e7a', stroke: '#37474f', strokeWidth: 2 }));
        this.scaleGroup.add(new Konva.Ellipse({ x: hx, y: hy + hh / 2, radiusX: 12, radiusY: hh / 2 - 2, fill: '#607d8b', stroke: '#37474f', strokeWidth: 2 }));
        this.scaleGroup.add(new Konva.Ellipse({ x: hx + hw, y: hy + hh / 2, radiusX: 12, radiusY: hh / 2 - 2, fill: '#607d8b', stroke: '#37474f', strokeWidth: 2 }));

        this._shellInner = new Konva.Rect({ x: hx + 4, y: hy + 4, width: hw - 8, height: hh - 8, fill: '#0a1a28' });

        // 名牌
        this.scaleGroup.add(new Konva.Text({ x: hx + hw / 2 - 35, y: hy - 16, width: 70, text: '燃油加热器', fontSize: 12, fontStyle: 'bold', fill: '#12652f', align: 'center' }));

        // 支脚
        [-hw / 3, hw / 3].forEach(ox => {
            this.scaleGroup.add(new Konva.Rect({ x: hx + hw / 2 + ox - 6, y: hy + hh, width: 12, height: 10, fill: '#455a64', stroke: '#263238', strokeWidth: 1, cornerRadius: [0, 0, 2, 2] }));
        });

        this.scaleGroup.add(this._shellInner);
    }

    // ── 换热管束 ──────────────────────────────
    _drawTubeBundle() {
        const hx = this._hxX, hy = this._hxY, hw = this._hxW, hh = this._hxH;
        const nTubes = 5;
        const tubeSpacing = (hh - 25) / (nTubes + 1);

        this._tubes = [];
        for (let i = 0; i < nTubes; i++) {
            const ty = hy + 12 + (i + 1) * tubeSpacing;
            const tube = new Konva.Rect({ x: hx + 12, y: ty - 2, width: hw - 24, height: 4, fill: '#90a4ae', stroke: '#607d8b', strokeWidth: 0.5, cornerRadius: 1 });
            const tubeInner = new Konva.Rect({ x: hx + 13, y: ty - 1, width: hw - 26, height: 2, fill: '#0d2a40' });
            this._tubes.push(tubeInner);
            this.scaleGroup.add(tube, tubeInner);
        }

        this._tubeSpacing = tubeSpacing;
        this._nTubes = nTubes;
    }

    // ── 蒸汽层（动态）────────────────────────
    _drawSteamLayer() {
        this._steamGroup = new Konva.Group();
        this.scaleGroup.add(this._steamGroup);
    }

    // ── 燃油流动层（动态）────────────────────
    _drawOilFlowLayer() {
        this._oilFlowGroup = new Konva.Group();
        this.scaleGroup.add(this._oilFlowGroup);
    }

    // ── 疏水阀 ──────────────────────────────
    _drawTrapValve() {
        const hx = this._hxX, hy = this._hxY, hw = this._hxW, hh = this._hxH;
        const tx = hx + hw + 2;
        const ty = hy + hh - 18;

        this.scaleGroup.add(new Konva.Rect({ x: tx, y: ty - 6, width: 16, height: 12, fill: '#455a64', stroke: '#263238', strokeWidth: 1.5, cornerRadius: 2 }));
        this._condensateDropGroup = new Konva.Group();
        this.scaleGroup.add(this._condensateDropGroup);

        // 冷凝水出口管道
        this.scaleGroup.add(new Konva.Rect({ x: tx + 16, y: ty - 4, width: 16, height: 8, fill: '#607d8b', stroke: '#37474f', strokeWidth: 1 }));
    }

    // ── 燃油进出口 ──────────────────────────
    _drawOilPipes() {
        const hx = this._hxX;

        // 燃油进口
        const inY = this._oilInY;
        this.scaleGroup.add(new Konva.Rect({ x: 160, y: inY - 5, width: hx - 160, height: 10, fill: '#8a3a00', stroke: '#5a2600', strokeWidth: 1.5 }));
        this.scaleGroup.add(new Konva.Text({ x: 146, y: inY - 24, text: '燃油进口', fontSize: 10, fontStyle: 'bold', fill: '#ffa726' }));
        this.scaleGroup.add(new Konva.Line({ points: [hx - 30, inY, hx - 22, inY], stroke: '#ffa726', strokeWidth: 2 }));
        this.scaleGroup.add(new Konva.Line({ points: [hx - 26, inY - 3, hx - 22, inY, hx - 26, inY + 3], stroke: '#ffa726', strokeWidth: 2 }));

        // 燃油出口
        const outY = this._oilOutY;
        this.scaleGroup.add(new Konva.Rect({ x: 160, y: outY - 6, width: hx - 160, height: 10, fill: '#c62828', stroke: '#8a0000', strokeWidth: 1.5 }));
        this.scaleGroup.add(new Konva.Text({ x: 150, y: outY - 18, text: '燃油出口', fontSize: 10, fontStyle: 'bold', fill: '#f00f2a' }));
        this._oilOutTempLabel = new Konva.Text({ x: 150, y: outY + 6, text: '--°C', fontSize: 10, fontFamily: 'monospace', fill: '#e50303' });
        this.scaleGroup.add(this._oilOutTempLabel);
        this.scaleGroup.add(new Konva.Line({ points: [156, outY, 164, outY], stroke: '#ef9a9a', strokeWidth: 2 }));
        this.scaleGroup.add(new Konva.Line({ points: [158, outY - 3, 153, outY, 158, outY + 3], stroke: '#ef9a9a', strokeWidth: 2 }));
    }
    // ═══════════════════════════════════════════
    // 2. 新增：流量调节旋钮
    // ═══════════════════════════════════════════
    _drawFlowKnob() {
        const knobX = this._hxX - 45;
        const knobY = this._oilInY;
        const knobRadius = 14;

        const SENSITIVITY = 0.002; // 更合理（原来太大）
        const DEADZONE = 0.3;      // 小死区（增量用）

        // 初始化
        this._flowKnobValue = Math.max(0, Math.min(1,
            (this.oilFlowRate - this.oilFlowMin) / (this.oilFlowMax - this.oilFlowMin)
        ));

        if (isNaN(this._flowKnobValue)) {
            this._flowKnobValue = 0.5;
            this.oilFlowRate = this.oilFlowMin +
                this._flowKnobValue * (this.oilFlowMax - this.oilFlowMin);
        }

        this._flowKnobGroup = new Konva.Group({
            x: knobX,
            y: knobY,
            cursor: 'pointer'
        });

        // 旋钮底座
        this._flowKnobGroup.add(new Konva.Circle({
            radius: knobRadius,
            fill: '#666',
            stroke: '#444', strokeWidth: 2,
        }));
        this._flowKnobGroup.add(new Konva.Circle({
            radius: knobRadius - 2,
            fill: '#444',
            stroke: '#555', strokeWidth: 1,
        }));

        // 刻度标记
        for (let i = 0; i <= 4; i++) {
            const angle = -90 + i * 45;
            const rad = angle * Math.PI / 180;
            const innerR = knobRadius - 4;
            const outerR = knobRadius - 1;
            const x1 = Math.cos(rad) * innerR;
            const y1 = Math.sin(rad) * innerR;
            const x2 = Math.cos(rad) * outerR;
            const y2 = Math.sin(rad) * outerR;
            this._flowKnobGroup.add(new Konva.Line({
                points: [x1, y1, x2, y2],
                stroke: '#aaa',
                strokeWidth: i % 2 === 0 ? 1.5 : 0.8,
            }));
        }

        // 旋钮指针
        this._flowKnobPointer = new Konva.Group({ x: 0, y: 0 });
        this._flowKnobPointer.add(new Konva.Circle({ radius: 3.5, fill: '#ffd700', stroke: '#aa8800', strokeWidth: 1.5 }));
        this._flowKnobPointer.add(new Konva.Line({
            points: [0, 0, 0, -knobRadius + 4],
            stroke: '#ffd700', strokeWidth: 2.5, lineCap: 'round',
        }));
        this._flowKnobGroup.add(this._flowKnobPointer);

        // 流量值显示
        this._flowValueText = new Konva.Text({
            x: -30, y: knobRadius + 3,
            width: 80,
            text: `流量：${this.oilFlowRate.toFixed(1)} t/h`,
            fontSize: 10, fontFamily: 'monospace',
            fill: '#ffa726', align: 'center',
        });
        this._flowKnobGroup.add(this._flowValueText);

        this.scaleGroup.add(this._flowKnobGroup);

        // ===== 拖拽逻辑（重写核心）=====

        let dragActive = false;
        let lastAngle = 0;

        const getCenter = () => {
            return this._flowKnobGroup.getAbsolutePosition();
        };

        const getAngle = (e) => {
            const center = getCenter();

            let x, y;
            if (e.touches?.length) {
                x = e.touches[0].clientX;
                y = e.touches[0].clientY;
            } else {
                x = e.clientX;
                y = e.clientY;
            }

            const dx = x - center.x;
            const dy = y - center.y;

            return Math.atan2(dy, dx) * 180 / Math.PI;
        };

        const normalize = (a) => {
            if (a > 180) a -= 360;
            if (a < -180) a += 360;
            return a;
        };

        const onMove = (e) => {
            if (!dragActive) return;

            e.preventDefault?.();

            const angle = getAngle(e);

            let delta = angle - lastAngle;
            delta = normalize(delta);

            // ✅ 死区：基于“增量”
            if (Math.abs(delta) < DEADZONE) return;

            // ✅ 增量更新（关键）
            this._flowKnobValue += delta * SENSITIVITY;
            this._flowKnobValue = Math.max(0, Math.min(1, this._flowKnobValue));

            this.oilFlowRate =
                this.oilFlowMin +
                this._flowKnobValue * (this.oilFlowMax - this.oilFlowMin);

            this._updateFlowKnobVisuals();

            lastAngle = angle; // ⭐ 每帧更新！

            this._refreshCache();
            this.sys?.requestRedraw?.();
        };

        const onUp = () => {
            dragActive = false;
            window.removeEventListener('mousemove', onMove);
            window.removeEventListener('mouseup', onUp);
            window.removeEventListener('touchmove', onMove);
            window.removeEventListener('touchend', onUp);
        };

        this._flowKnobGroup.on('mousedown touchstart', (e) => {
            e.cancelBubble = true;
            e.evt?.preventDefault?.();

            dragActive = true;

            lastAngle = getAngle(e); // ⭐ 只记录角度

            window.addEventListener('mousemove', onMove);
            window.addEventListener('mouseup', onUp);
            window.addEventListener('touchmove', onMove, { passive: false });
            window.addEventListener('touchend', onUp);
        });

        this._updateFlowKnobVisuals();
    }

    _updateFlowKnobVisuals() {
        if (!this._flowKnobPointer) return;

        let value = this._flowKnobValue;

        if (!isFinite(value)) {
            value = 0.5;
            this._flowKnobValue = value;
        }

        const angle = -135 + value * 270;
        this._flowKnobPointer.rotation(angle);

        if (this._flowValueText) {
            let flow = this.oilFlowRate;

            if (!isFinite(flow)) {
                flow = this.oilFlowMin;
                this.oilFlowRate = flow;
            }

            this._flowValueText.text(`流量：${flow.toFixed(1)} t/h`);
        }
    }

    _updateFlowKnobVisuals() {
        if (!this._flowKnobPointer) return;

        let value = this._flowKnobValue;
        if (isNaN(value)) {
            value = 0.5;
            this._flowKnobValue = value;
        }

        const angle = -135 + value * 270;

        if (!isNaN(angle)) {
            this._flowKnobPointer.rotation(angle);
        }

        if (this._flowValueText) {
            let flowRate = this.oilFlowRate;
            if (isNaN(flowRate)) {
                flowRate = this.oilFlowMin;
                this.oilFlowRate = flowRate;
            }
            this._flowValueText.text(`流量：${flowRate.toFixed(1)} t/h`);
        }
    }
    // ═══════════════════════════════════════════
    // 3. PT100 铂电阻（工业实物模型，两线制）
    // ═══════════════════════════════════════════
    _drawPT100Sensor() {
        const px = this._pt100X, py = this._pt100Y;
        const pw = this._pt100W, ph = this._pt100H;

        // 探头插入燃油出口管
        const probeX = px - 8;
        const probeY = this._oilOutY;

        // 连接法兰/安装底座
        this.scaleGroup.add(new Konva.Rect({ x: probeX - 4, y: probeY - 5, width: 20, height: 10, fill: '#78909c', stroke: '#546e7a', strokeWidth: 1.5, cornerRadius: 1 }));

        // 探头保护管（不锈钢）
        this._pt100Probe = new Konva.Rect({ x: probeX + 12, y: probeY - 2, width: 14, height: 4, fill: '#c0c0c0', stroke: '#888', strokeWidth: 0.8, cornerRadius: 1 });
        this.scaleGroup.add(this._pt100Probe);

        // 传感器头部壳体（铝制）
        const headBody = new Konva.Rect({ x: px + 1, y: py + 20, width: pw, height: ph, fill: '#e0e0e0', stroke: '#aaa', strokeWidth: 1.5, cornerRadius: 6 });

        // 头部盖板
        this.scaleGroup.add(new Konva.Rect({ x: px + 2, y: py + 2, width: pw - 4, height: 18, fill: '#c0c0c0', stroke: '#999', strokeWidth: 1, cornerRadius: 3 }));

        // 铭牌
        this.scaleGroup.add(new Konva.Text({ x: px, y: py + 5, width: pw, text: 'PT100', fontSize: 12, fontStyle: 'bold', fill: '#07731e', align: 'center' }));

        // 液晶显示屏
        this._pt100Lcd = new Konva.Rect({ x: px + 5, y: py + 30, width: pw - 10, height: 40, fill: '#020c14', stroke: '#1a3040', strokeWidth: 1, cornerRadius: 2 });
        this._pt100TempText = new Konva.Text({ x: px + 5, y: py + 32, width: pw - 10, text: '---°C', fontSize: 14, fontFamily: 'monospace', fontStyle: 'bold', fill: '#00e5ff', align: 'center' });

        // 电阻值显示
        this._pt100ResText = new Konva.Text({ x: px + 5, y: py + 50, width: pw - 10, text: 'R=100Ω', fontSize: 12, fontFamily: 'monospace', fill: '#11e918', align: 'center' });



        this.scaleGroup.add(headBody, this._pt100Lcd, this._pt100TempText, this._pt100ResText);
    }

    // ═══════════════════════════════════════════
    // 动画与物理计算
    // ═══════════════════════════════════════════
    // 集中化 tick（由 consys._tickAll 在 20fps 调用）
    tick(dt) {
        this._tickPhysics(dt);
        this._tickValveAnimation();
        this._tickHeatExchangerViz();
        this._tickCondensate(dt);
        this._tickDisplay();
        this._refreshCache();
    }

    _tickPhysics(dt) {
        // 远程控制（通过端口读取 4-20mA）
        if (this.valveMode === 'remote') this._updateRemoteCommand();

        // 阀位平滑跟随
        const diff = this.valveTarget - this.valvePosition;
        if (Math.abs(diff) > 0.1) {
            this.valvePosition += Math.sign(diff) * Math.min(Math.abs(diff), this.valveActSpeed * dt);
        }
        this.valvePosition = Math.max(0, Math.min(100, this.valvePosition));

        // 蒸汽有效流量
        this.steamFlow = this.valvePosition / 100;

        // 换热计算（计算目标温度）
        const mDot = this.oilFlowRate * 1000 / 3600;
        const NTU = this.UA * this.steamFlow / (mDot * this.Cp_oil);
        this.oilTempOutTarget = this.steamTemp - (this.steamTemp - this.oilTempIn) * Math.exp(-NTU);
        this.oilTempOutTarget += (Math.random() - 0.5) * 0.5;
        this.oilTempOutTarget = Math.max(this.oilTempIn, Math.min(this.steamTemp, this.oilTempOutTarget));
        
        // ── 热容延迟：实际温度缓慢跟随目标温度 ──
        // 使用一阶滤波器：dT/dt = (T_target - T) / tau
        const tempDiff = this.oilTempOutTarget - this.oilTempOut;
        if (Math.abs(tempDiff) > 0.01) {
            // tau 是时间常数，值越大，温度变化越慢
            const tau = this.thermalMassTimeConstant;
            const tempRate = tempDiff / tau;
            this.oilTempOut += tempRate * dt;
        }
        this.oilTempOut = Math.max(this.oilTempIn, Math.min(this.steamTemp, this.oilTempOut));

        // PT100 电阻计算
        const A = 3.9083e-3, B = -5.775e-7;
        this.currentResistance = 100 * (1 + A * this.oilTempOut + B * this.oilTempOut * this.oilTempOut);

        // 报警
        this.alarmHi = this.oilTempOut > this.hiAlarm;
        this.alarmLo = this.oilTempOut < this.loAlarm && this.steamFlow > 0.1;

        // 动画相位
        this._oilPhase += dt * (2 + this.steamFlow * 3);
        this._steamPhase += dt * (1 + this.steamFlow * 4);
        this._heatPhase += dt * 2;
        this._condPhase += dt * (0.5 + this.steamFlow * 2);
    }

    _updateRemoteCommand() {
        // 从端口读取 4-20mA 信号
        let currentMA = null;

        const voltage = this.sys.getVoltageBetween(`${this.id}_wire_p`, `${this.id}_wire_n`);
        currentMA = Math.abs(voltage) * 4;

        if (currentMA !== null && !isNaN(currentMA)) {
            let target = ((currentMA - 4) / 16) * 100;
            target = Math.max(0, Math.min(100, target));
            this.valveTarget = target;
        }
    }

    _tickValveAnimation() {
        if (!this._valveDisk) return;
        const angle = (1 - this.valvePosition / 100) * 90;
        const rad = angle * Math.PI / 180;
        const cx = this._valveCX - 10, cy = this._valveCY + 46;
        const len = 8;
        const x1 = cx - len * Math.cos(rad);
        const y1 = cy - len * Math.sin(rad);
        const x2 = cx + len * Math.cos(rad);
        const y2 = cy + len * Math.sin(rad);
        this._valveDisk.points([x1, y1, x2, y2]);
    }

    _tickHeatExchangerViz() {
        this._steamGroup.destroyChildren();
        this._oilFlowGroup.destroyChildren();

        const hx = this._hxX + 4, hy = this._hxY + 4;
        const hw = this._hxW - 8, hh = this._hxH - 8;
        const sf = this.steamFlow;

        if (sf > 0.02) {
            for (let i = 0; i < 6; i++) {
                const x = hx + i * hw / 6;
                const condensRatio = i / 5;
                const alpha = sf * (0.15 + 0.06 * Math.abs(Math.sin(this._steamPhase + i)));
                this._steamGroup.add(new Konva.Rect({
                    x, y: hy, width: hw / 6 + 1, height: hh,
                    fill: `rgba(200,200,240,${alpha})`,
                }));
            }
        }

        for (let i = 0; i < this._nTubes; i++) {
            const tubeY = this._hxY + 12 + (i + 1) * this._tubeSpacing;
            const t2 = ((this._oilPhase * 0.12 + i * 0.14) % 1 + 1) % 1;
            const px3 = this._hxX + 13 + t2 * (this._hxW - 26);
            const tNorm = Math.min(1, (this.oilTempOut - this.oilTempIn) / 100);
            const fr = Math.round(150 + tNorm * 100);
            this._oilFlowGroup.add(new Konva.Circle({ x: px3, y: tubeY, radius: 1.5, fill: `rgba(${fr},80,0,0.8)` }));
        }
    }

    _tickCondensate(dt) {
        this._condensateDropGroup.destroyChildren();
        if (this.steamFlow < 0.05) return;

        const hx = this._hxX + this._hxW + 2;
        const hy = this._hxY + this._hxH - 18;

        for (let i = 0; i < 2; i++) {
            const t = ((this._condPhase * 0.5 + i / 2) % 1 + 1) % 1;
            if (t > 0.8) continue;
            const dropY = hy + 4 + t * 12;
            this._condensateDropGroup.add(new Konva.Circle({ x: hx + 8, y: dropY, radius: 2, fill: `rgba(100,181,246,${0.5 * this.steamFlow})` }));
        }
    }

    _tickDisplay() {
        const T = this.oilTempOut;
        const mc = this.alarmHi ? '#ef5350' : this.alarmLo ? '#ffa726' : '#00e5ff';

        if (this._pt100TempText) {
            this._pt100TempText.text(`${T.toFixed(1)}°C`);
            this._pt100TempText.fill(mc);
        }
        if (this._pt100ResText) this._pt100ResText.text(`R=${this.currentResistance.toFixed(1)}Ω`);
        if (this._oilOutTempLabel) this._oilOutTempLabel.text(`${T.toFixed(1)}°C`);
        if (this._valvePercentText) this._valvePercentText.text(`开度: ${this.valvePosition.toFixed(1)}%`);

        if (this._modeStatusText) {
            this._modeStatusText.text(this.valveMode === 'remote' ? '遥控模式' : '本地模式');
            this._modeStatusText.fill(this.valveMode === 'remote' ? '#3366cc' : '#888');
        }
    }

    // ═══════════════════════════════════════════
    // 外部接口
    // ═══════════════════════════════════════════
    setValve(position) {
        if (this.valveMode === 'local') {
            this.valveTarget = Math.max(0, Math.min(100, position));
        }
    }

    getValvePosition() { return this.valvePosition; }
    getCurrentTemp() { return this.oilTempOut; }
    getPT100Resistance() { return this.currentResistance; }
    getCurrentMA() { return this.pt100mA; }
    getSteamFlow() { return this.steamFlow; }

    update(valvePosition) {
        if (typeof valvePosition === 'number') this.setValve(valvePosition);
    }

    getConfigFields() {
        return [
            { label: '位号/名称', key: 'id', type: 'text' },
            { label: '蒸汽温度 (°C)', key: 'steamTemp', type: 'number' },
            { label: '燃油进口温度 (°C)', key: 'oilTempIn', type: 'number' },
            { label: '目标出口温度 (°C)', key: 'oilTempTarget', type: 'number' },
            { label: '高温报警 (°C)', key: 'hiAlarm', type: 'number' },
            { label: '低温报警 (°C)', key: 'loAlarm', type: 'number' },
            { label: '燃油流量 (t/h)', key: 'oilFlowRate', type: 'number' },
            { label: '初始阀位 (%)', key: 'valvePosition', type: 'number' },
            { label: '热容时间常数 (s)', key: 'thermalMassTimeConstant', type: 'number', min: 0.5, max: 30 },
        ];
    }

    onConfigUpdate(cfg) {
        this.id = cfg.id || this.id;
        this.steamTemp = parseFloat(cfg.steamTemp) || this.steamTemp;
        this.oilTempIn = parseFloat(cfg.oilTempIn) || this.oilTempIn;
        this.oilTempTarget = parseFloat(cfg.oilTempTarget) || this.oilTempTarget;
        this.hiAlarm = parseFloat(cfg.hiAlarm) || this.hiAlarm;
        this.loAlarm = parseFloat(cfg.loAlarm) || this.loAlarm;
        this.oilFlowRate = parseFloat(cfg.oilFlowRate) || this.oilFlowRate;
        if (cfg.valvePosition !== undefined) {
            this.valvePosition = parseFloat(cfg.valvePosition);
            this.valveTarget = this.valvePosition;
        }
        if (cfg.thermalMassTimeConstant !== undefined) {
            this.thermalMassTimeConstant = Math.max(0.5, parseFloat(cfg.thermalMassTimeConstant) || this.thermalMassTimeConstant);
        }
        this.config = { ...this.config, ...cfg };
    }

    destroy() {
        super.destroy?.();
    }
}

export default FuelOilHeater;