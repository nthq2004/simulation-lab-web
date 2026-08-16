// SalinitySensor.js
import { BaseComponent } from './BaseComponent.js';

/**
 * 船用造水机盐度传感器（电导率法 Conductivity Salinity Sensor）
 *
 * ── 测量原理 ────────────────────────────────────────────────
 *  基于水的电导率与盐度之间的正比关系。传感器包含两个电极，
 *  向水中施加交流电压，测量溶液电阻/电导率，通过温度补偿后
 *  换算为盐度值。
 *
 *  NaCl 溶液电导率与盐度近似关系（25°C基准）：
 *    κ = κ0 * (1 + α * (T - 25))
 *    S ≈ (κ - κ0) / k_linear
 *
 *  其中：
 *    κ   - 实际电导率 (mS/cm)
 *    κ0  - 纯水电导率 ~0.055 mS/cm
 *    α   - 温度补偿系数 ~0.02 /°C
 *    T   - 水温度 (°C)
 *    S   - 盐度 (PSU / ppt)
 *
 *  典型量程：0-50 PSU (海水约35 PSU)
 *  淡水标准：< 5 PSU（造水机产出淡水通常要求 < 0.5 PSU）
 *
 * ── 输出信号 ────────────────────────────────────────────────
 *  ① 4-20mA 模拟量输出（盐度线性映射：0PSU = 4mA, 50PSU = 20mA）
 *  ② 干接点报警输出（超限继电器）
 *  ③ MODBUS RTU（RS485）
 *
 * ── 组件结构 ───────────────────────────────────────────────
 *  ① 传感器探棒（三电极/四电极，插入式安装）
 *  ② 流通池/管道段（海水/淡水输入输出）
 *  ③ 温度传感器探头（PT100 补偿）
 *  ④ 仪表头（LCD主显、状态指示、按键）
 *  ⑤ 接线盒（4-20mA、报警、RS485）
 *
 * ── 端口 ───────────────────────────────────────────────────
 *  pipe_in  — 水管进口（左）
 *  pipe_out — 水管出口（右）
 *  vcc      — 24VDC
 *  out      — 4-20mA / GND
 *  alarm    — 报警继电器
 *
 * ── 气路求解器集成 ──────────────────────────────────────────
 *  special = 'sensor' (只读传感器)
 *  update(flow_rate, temperature) — 输入流量和温度，输出盐度
 */

export class SalinitySensor extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.width  = Math.max(320, config.width  || 340);
        this.height = Math.max(240, config.height || 260);

        this.type    = 'salinity_sensor';
        this.special = 'sensor';
        this.cache   = 'fixed';

        // ── 仪表参数 ──
        this.rangeMin    = config.rangeMin    || 0;       // 盐度量程下限 PSU
        this.rangeMax    = config.rangeMax    || 50;      // 盐度量程上限 PSU
        this.alarmSetpoint = config.alarmSetpoint || 0.5; // 报警设定点 PSU
        this.tempCompensation = config.tempCompensation !== undefined ? config.tempCompensation : true;
        this.cellConstant = config.cellConstant || 1.0;    // 电导池常数 cm⁻¹
        this.fluidName    = config.fluidName   || '产水';
        this.unit         = config.unit        || 'PSU';
        
        // 温度补偿参数
        this.tempCoeff    = config.tempCoeff    || 0.02;   // 温度补偿系数 /°C
        this.refTemp      = config.refTemp      || 25;     // 参考温度 °C

        // ── 零点/满度微调 ──
        this.zeroAdj      = 0;
        this.spanAdj      = 1.0;

        // ── 状态 ──
        this.salinity     = 0;        // 当前盐度 PSU
        this.temperature  = 25;       // 水温 °C
        this.conductivity = 0;        // 电导率 mS/cm
        this.flowRate     = 0;        // 流量 m³/h
        this.outCurrent   = 4;        // 4-20mA 输出
        this.alarmActive  = false;    // 报警状态
        this.powered      = false;
        this.isFault      = false;    // 传感器故障（极化/污染）
        this.calibrationDue = false;  // 校准到期标志
        
        // 累积/记录
        this.totalVolume  = 0;        // 累积产水量 m³
        this.avgSalinity  = 0;        // 平均盐度
        this.sampleCount  = 0;
        
        // 电导模拟（抗污染/极化效应）
        this.pollutionFactor = 1.0;
        this.polarizationVoltage = 0;

        // ── 动画状态 ──
        this._bubbles = [];           // 水泡/粒子动画
        this._blinkTimer = 0;
        this._alarmBlink = false;

        // ── 示波器/趋势数据 ──
        this._trendBufLen = 120;
        this._salinityTrend = new Array(this._trendBufLen).fill(0);
        this._tempTrend = new Array(this._trendBufLen).fill(25);
        
        // ── 几何布局 ──
        this._pipeX  = 12;
        this._pipeY  = 32;
        this._pipeW  = this.width - 24;
        this._pipeH  = Math.round(this.height * 0.38);
        
        // 传感器探棒区（管道中部垂直向下/向上安装）
        this._probeX = this._pipeX + this._pipeW / 2;
        this._probeY = this._pipeY + 4;
        this._probeW = 28;
        this._probeH = this._pipeH - 8;
        
        // 仪表头区（右侧）
        this._headX  = this._pipeX + this._pipeW + 8;
        this._headW  = this.width - this._headX - 12;
        this._headY  = this._pipeY;
        this._headH  = this._pipeH;
        
        // 温度显示区（仪表头下方）
        this._tempPanelY = this._pipeY + this._pipeH + 8;
        
        // 底部面板（报警/状态）
        this._panelY = this._tempPanelY + 52;
        
        this._lastTs = null;
        this._animId = null;
        
        this.config = {
            id: this.id,
            rangeMin: this.rangeMin,
            rangeMax: this.rangeMax,
            alarmSetpoint: this.alarmSetpoint,
            unit: this.unit,
        };
        
        this._init();
        
        // ── 端口 ──
        const midY = this._pipeY + this._pipeH / 2;
        this.addPort(0,           midY, 'i', 'pipe', 'IN');
        this.addPort(this.width,  midY, 'o', 'pipe', 'OUT');
        this.addPort(this.width - 25, this._headY + 12, 'p', 'wire', 'V+');
        this.addPort(this.width - 25, this._headY + 34, 'n', 'wire', '4-20mA');
        this.addPort(this.width - 50, this._headY + 56, 'a', 'wire', 'ALARM');
    }

    // ═══════════════════════════════════════════════
    //  初始化
    // ═══════════════════════════════════════════════
    _init() {
        this._drawLabel();
        this._drawPipeSection();
        this._drawFlowAnimation();
        this._drawProbeAssembly();
        this._drawInstrumentHead();
        this._drawLCD();
        this._drawTempPanel();
        this._drawBottomPanel();
        this._startAnimation();
    }

    _drawLabel() {
        this.group.add(new Konva.Text({
            x: 0, y: -22, width: this.width,
            text: '船用造水机盐度传感器',
            fontSize: 14, fontStyle: 'bold', fill: '#1a2634', align: 'center',
        }));
        this.group.add(new Konva.Text({
            x: 0, y: -8, width: this.width,
            text: '电导率法  |  4-20mA  |  ALARM',
            fontSize: 9, fill: '#607d8b', align: 'center',
        }));
    }

    // ── 管道段 + 流通池 ──────────────────────────
    _drawPipeSection() {
        const { _pipeX: px, _pipeY: py, _pipeW: pw, _pipeH: ph } = this;
        
        // 管道外壁
        const outer = new Konva.Rect({
            x: px, y: py, width: pw, height: ph,
            fill: '#455a64', stroke: '#263238', strokeWidth: 2, cornerRadius: 6,
        });
        
        // 内壁/流体通道
        this._flowChanX = px + 10;
        this._flowChanY = py + 10;
        this._flowChanW = pw - 20;
        this._flowChanH = ph - 20;
        
        this._flowChannel = new Konva.Rect({
            x: this._flowChanX, y: this._flowChanY,
            width: this._flowChanW, height: this._flowChanH,
            fill: '#0a1a2a',
        });
        
        // 流体颜色（根据盐度变化）
        this._fluidOverlay = new Konva.Rect({
            x: this._flowChanX, y: this._flowChanY,
            width: this._flowChanW, height: this._flowChanH,
            fill: 'rgba(0,150,200,0.15)',
        });
        
        // 法兰盘
        const flangeL = new Konva.Rect({
            x: px - 10, y: py - 4, width: 12, height: ph + 8,
            fill: '#546e7a', stroke: '#37474f', strokeWidth: 1, cornerRadius: [3, 0, 0, 3],
        });
        const flangeR = new Konva.Rect({
            x: px + pw - 2, y: py - 4, width: 12, height: ph + 8,
            fill: '#546e7a', stroke: '#37474f', strokeWidth: 1, cornerRadius: [0, 3, 3, 0],
        });
        
        // 流向箭头
        this._flowArrow = new Konva.Arrow({
            points: [px + pw - 80, py + ph/2, px + pw - 30, py + ph/2],
            pointerLength: 8, pointerWidth: 6,
            fill: 'rgba(79,195,247,0.5)', stroke: 'rgba(79,195,247,0.5)',
        });
        
        this.group.add(outer, this._flowChannel, this._fluidOverlay, 
                       flangeL, flangeR, this._flowArrow);
        
        // 文字标签
        this.group.add(new Konva.Text({
            x: px + 8, y: py + ph/2 - 8,
            text: '海水 → 产水', fontSize: 8.5, fill: 'rgba(79,195,247,0.6)',
        }));
    }
    
    // ── 流动粒子动画 ──────────────────────────
    _drawFlowAnimation() {
        this._particleGroup = new Konva.Group();
        this.group.add(this._particleGroup);
    }
    
    // ── 传感器探棒组件 ────────────────────────
    _drawProbeAssembly() {
        const px = this._probeX - this._probeW / 2;
        const py = this._probeY;
        const pw = this._probeW;
        const ph = this._probeH;
        
        // 安装基座（三通/螺纹）
        const mount = new Konva.Rect({
            x: px - 4, y: py - 8, width: pw + 8, height: 12,
            fill: '#78909c', stroke: '#546e7a', strokeWidth: 1.5, cornerRadius: 3,
        });
        
        // 探棒主体（不锈钢/钛）
        const probeBody = new Konva.Rect({
            x: px, y: py + 2, width: pw, height: ph - 6,
            fill: 'linear-gradient(0deg, #cfd8dc, #b0bec5)',
            stroke: '#78909c', strokeWidth: 1, cornerRadius: [4, 4, 8, 8],
        });
        
        // 电极环（三电极或四电极）
        const electrodeColors = ['#ffab40', '#ff8f00', '#ff6f00'];
        const elecPositions = [0.25, 0.5, 0.75];
        this._electrodes = [];
        elecPositions.forEach((pos, idx) => {
            const elecY = py + 2 + (ph - 6) * pos;
            const ring = new Konva.Rect({
                x: px - 2, y: elecY - 3, width: pw + 4, height: 6,
                fill: electrodeColors[idx % electrodeColors.length],
                stroke: '#e65100', strokeWidth: 0.8, cornerRadius: 2,
            });
            this._electrodes.push(ring);
            this.group.add(ring);
        });
        
        // 电极尖端
        const tip = new Konva.Circle({
            x: this._probeX, y: py + ph - 2, radius: 6,
            fill: '#ff8f00', stroke: '#e65100', strokeWidth: 1,
        });
        
        // 电缆/导线
        const cable = new Konva.Line({
            points: [this._probeX, py - 4, this._probeX, py - 20, this._probeX + 50, py - 20],
            stroke: '#37474f', strokeWidth: 2, lineCap: 'round',
        });
        
        // 温度探头 PT100
        const tempProbe = new Konva.Rect({
            x: this._probeX - 8, y: py + ph * 0.4, width: 6, height: 16,
            fill: '#b0bec5', stroke: '#78909c', strokeWidth: 0.8, cornerRadius: 2,
        });
        const tempLabel = new Konva.Text({
            x: this._probeX - 14, y: py + ph * 0.4 - 4,
            text: 'PT100', fontSize: 6, fill: '#ffab40',
        });
        
        const labelTxt = new Konva.Text({
            x: px - 6, y: py - 20,
            text: 'SALINITY', fontSize: 8, fontStyle: 'bold', fill: '#42a5f5',
        });
        
        this.group.add(mount, probeBody, tip, cable, tempProbe, tempLabel, labelTxt);
    }
    
    // ── 仪表头 ────────────────────────────────
    _drawInstrumentHead() {
        const hx = this._headX, hy = this._headY;
        const hw = this._headW, hh = this._headH;
        
        // 接线盒（顶部）
        const jboxH = 50;
        const jbox = new Konva.Rect({
            x: hx, y: hy, width: hw, height: jboxH,
            fill: '#cfd8dc', stroke: '#90a4ae', strokeWidth: 1.5, cornerRadius: [6, 6, 2, 2],
        });
        
        // 端子排示意
        const terminals = new Konva.Rect({
            x: hx + 8, y: hy + 6, width: hw - 16, height: 38,
            fill: '#eceff1', stroke: '#b0bec5', strokeWidth: 0.5, cornerRadius: 3,
        });
        
        this._idText = new Konva.Text({
            x: hx + 8, y: hy + 10, width: hw - 16,
            text: this.id || 'SA-101',
            fontSize: 10, fontStyle: 'bold', fill: '#263238', align: 'center',
        });
        
        this.group.add(new Konva.Text({
            x: hx + 8, y: hy + 24, width: hw - 16,
            text: 'CONDUCTIVITY SENSOR', fontSize: 7, fill: '#78909c', align: 'center',
        }));
        
        // 信号端子标注
        ['24V+', 'mA', 'COM', 'NO', 'NC'].forEach((label, i) => {
            this.group.add(new Konva.Text({
                x: hx + 10 + i * 32, y: hy + 38,
                text: label, fontSize: 6, fill: '#37474f',
            }));
        });
        
        // 仪表主体
        const body = new Konva.Rect({
            x: hx, y: hy + jboxH + 2, width: hw, height: hh - jboxH - 2,
            fill: '#1a2634', stroke: '#0d1520', strokeWidth: 1.5, cornerRadius: [2, 2, 6, 6],
        });
        
        this._headBodyY = hy + jboxH + 2;
        this._headBodyH = hh - jboxH - 2;
        
        this.group.add(jbox, terminals, body, this._idText);
    }
    
    // ── LCD 显示 ──────────────────────────────
    _drawLCD() {
        const hx = this._headX, hw = this._headW;
        const bodyY = this._headBodyY;
        const bodyH = this._headBodyH;
        
        const lcdX = hx + 6;
        const lcdY = bodyY + 6;
        const lcdW = hw - 12;
        const lcdH = bodyH - 12;
        
        // LCD 背景
        const lcdBg = new Konva.Rect({
            x: lcdX, y: lcdY, width: lcdW, height: lcdH,
            fill: '#021016', stroke: '#37474f', strokeWidth: 1, cornerRadius: 4,
        });
        
        // 主盐度值（大字号）
        this._salinityMain = new Konva.Text({
            x: lcdX + 4, y: lcdY + 8, width: lcdW - 8,
            text: '--.--',
            fontSize: Math.min(36, lcdH * 0.42),
            fontFamily: 'Courier New, monospace',
            fontStyle: 'bold', fill: '#00e5ff', align: 'center',
        });
        
        // 单位
        this._unitLabel = new Konva.Text({
            x: lcdX + 4, y: lcdY + lcdH - 24, width: lcdW - 8,
            text: this.unit,
            fontSize: 11, fill: '#00695c', align: 'center',
        });
        
        // 电流输出
        this._currentLabel = new Konva.Text({
            x: lcdX + 4, y: lcdY + lcdH - 14, width: lcdW - 8,
            text: '--.-- mA',
            fontSize: 9, fontFamily: 'Courier New, monospace', fill: '#80cbc4', align: 'center',
        });
        
        // 状态LED
        this._led = new Konva.Circle({
            x: lcdX + lcdW - 12, y: lcdY + 8, radius: 4, fill: '#37474f',
        });
        
        this.group.add(lcdBg, this._salinityMain, this._unitLabel, this._currentLabel, this._led);
    }
    
    // ── 温度面板 ──────────────────────────────
    _drawTempPanel() {
        const tx = this._pipeX;
        const ty = this._tempPanelY;
        const tw = this._pipeW;
        
        const panel = new Konva.Rect({
            x: tx, y: ty, width: tw, height: 44,
            fill: '#0d1a24', stroke: '#1a3040', strokeWidth: 1, cornerRadius: 4,
        });
        
        // 温度读数
        this._tempValue = new Konva.Text({
            x: tx + 8, y: ty + 6,
            text: '水温: --.- °C',
            fontSize: 11, fontFamily: 'Courier New, monospace',
            fontStyle: 'bold', fill: '#ffab40',
        });
        
        // 电导率
        this._condValue = new Konva.Text({
            x: tx + 8, y: ty + 22,
            text: '电导率: --.-- mS/cm',
            fontSize: 9, fontFamily: 'Courier New, monospace', fill: '#78909c',
        });
        
        // 流量指示
        this._flowValue = new Konva.Text({
            x: tx + tw - 110, y: ty + 6,
            text: '流量: --.-- m³/h',
            fontSize: 9, fontFamily: 'Courier New, monospace', fill: '#546e7a',
        });
        
        this.group.add(panel, this._tempValue, this._condValue, this._flowValue);
    }
    
    // ── 底部报警面板 ──────────────────────────
    _drawBottomPanel() {
        const px = 8;
        const py = this._panelY;
        const pw = this.width - 16;
        
        const bg = new Konva.Rect({
            x: px, y: py, width: pw, height: 46,
            fill: '#050d18', stroke: '#1a3040', strokeWidth: 1, cornerRadius: 4,
        });
        
        // 报警继电器状态
        this._alarmStatus = new Konva.Text({
            x: px + 8, y: py + 6,
            text: '⭕ 报警继电器: 正常',
            fontSize: 9, fontStyle: 'bold', fill: '#66bb6a',
        });
        
        // 设定点显示
        this._setpointLabel = new Konva.Text({
            x: px + 8, y: py + 22,
            text: `报警设定: ${this.alarmSetpoint} PSU`,
            fontSize: 8, fontFamily: 'Courier New, monospace', fill: '#546e7a',
        });
        
        // 传感器状态
        this._sensorStatus = new Konva.Text({
            x: px + pw - 140, y: py + 6,
            text: '传感器: 正常',
            fontSize: 9, fontFamily: 'Courier New, monospace', fill: '#37474f', align: 'right',
        });
        
        // 校准指示
        this._calStatus = new Konva.Text({
            x: px + pw - 140, y: py + 22,
            text: '校准: 有效',
            fontSize: 8, fontFamily: 'Courier New, monospace', fill: '#546e7a', align: 'right',
        });
        
        this.group.add(bg, this._alarmStatus, this._setpointLabel, 
                       this._sensorStatus, this._calStatus);
    }
    
    // ── 流动粒子动画 ──────────────────────────
    _updateFlowParticles(dt) {
        if (!this.powered || this.flowRate < 0.1) {
            this._particleGroup.destroyChildren();
            return;
        }
        
        // 周期添加新粒子
        if (Math.random() < dt * 8) {
            this._bubbles.push({
                x: this._flowChanX,
                y: this._flowChanY + Math.random() * this._flowChanH,
                life: 1.0,
                speed: 0.8 + Math.random() * 0.7,
            });
        }
        
        // 更新粒子位置
        this._bubbles = this._bubbles.filter(b => {
            b.x += dt * b.speed * (this.flowRate / 5 + 30);
            b.life -= dt * 1.5;
            return b.life > 0 && b.x < this._flowChanX + this._flowChanW;
        });
        
        // 重绘粒子
        this._particleGroup.destroyChildren();
        this._bubbles.forEach(b => {
            const particle = new Konva.Circle({
                x: b.x, y: b.y, radius: 2 + (1 - b.life) * 1.5,
                fill: `rgba(100, 200, 255, ${b.life * 0.6})`,
            });
            this._particleGroup.add(particle);
        });
    }
    
    // ═══════════════════════════════════════════════
    //  动画主循环
    // ═══════════════════════════════════════════════
    _startAnimation() {
        const tick = (ts) => {
            if (this._lastTs !== null) {
                const dt = Math.min((ts - this._lastTs) / 1000, 0.05);
                this._tickPhysics(dt);
                this._updateFlowParticles(dt);
                this._tickDisplay(dt);
                this._updateTrend(dt);
            }
            this._lastTs = ts;
            this._refreshCache();
            this._animId = requestAnimationFrame(tick);
        };
        this._animId = requestAnimationFrame(tick);
    }
    
    _stopAnimation() {
        if (this._animId) { cancelAnimationFrame(this._animId); this._animId = null; }
    }
    
    // ── 物理计算（电导率/盐度）────────────────
    _tickPhysics(dt) {
        if (!this.powered) {
            this.salinity = 0;
            this.outCurrent = 0;
            this.alarmActive = false;
            return;
        }
        
        // 根据输入计算盐度（模拟传感器响应）
        let rawSalinity = 0;
        
        // 正常模式下，根据流量和水质计算
        if (this.flowRate > 0.01) {
            // 造水机产水盐度一般很低，模拟浓度波动
            // 正常产水 < 0.5 PSU，异常海水进入 > 10 PSU
            const baseSalinity = this.fluidName === '海水' ? 35 : 0.3;
            
            // 温度影响
            let tempEffect = 1.0;
            if (this.tempCompensation) {
                tempEffect = 1 + this.tempCoeff * (this.temperature - this.refTemp);
            }
            
            // 电导率计算
            this.conductivity = (baseSalinity * 0.053) * tempEffect * this.pollutionFactor;
            
            // 盐度换算（含噪声模拟）
            rawSalinity = baseSalinity + (Math.random() - 0.5) * 0.05;
            
            // 传感器污染/老化的影响
            if (this.isFault) {
                rawSalinity = rawSalinity * 0.5 + 5;
                this.conductivity *= 0.6;
            }
            
            // 极化效应（高流速时改善）
            if (this.flowRate > 2) {
                this.polarizationVoltage *= 0.95;
                rawSalinity = Math.max(0, rawSalinity - 0.05);
            } else if (this.flowRate < 0.5) {
                this.polarizationVoltage = Math.min(0.5, this.polarizationVoltage + dt * 0.1);
                rawSalinity = rawSalinity + this.polarizationVoltage * 0.2;
            }
        }
        
        // 应用零点/满度调整
        let adjustedSalinity = (rawSalinity + this.zeroAdj) * this.spanAdj;
        adjustedSalinity = Math.max(this.rangeMin, Math.min(this.rangeMax, adjustedSalinity));
        this.salinity = adjustedSalinity;
        
        // 4-20mA 输出（线性映射）
        const rangeSpan = this.rangeMax - this.rangeMin;
        if (rangeSpan > 0) {
            const ratio = (this.salinity - this.rangeMin) / rangeSpan;
            this.outCurrent = 4 + ratio * 16;
        } else {
            this.outCurrent = 12;
        }
        
        // 报警判断
        const wasAlarm = this.alarmActive;
        this.alarmActive = this.salinity >= this.alarmSetpoint && this.powered && !this.isFault;
        
        // 报警闪烁（用于视觉反馈）
        if (wasAlarm !== this.alarmActive) {
            this._blinkTimer = 0.5;
        }
        
        // 累积（模拟，仅计数）
        if (this.flowRate > 0 && this.powered && !this.isFault) {
            this.totalVolume += this.flowRate * dt / 3600;
            this.avgSalinity = (this.avgSalinity * this.sampleCount + this.salinity) / (this.sampleCount + 1);
            this.sampleCount++;
        }
        
        // 随机故障模拟（污染累积）
        if (this.powered && Math.random() < dt * 0.0005) {
            this.pollutionFactor = Math.max(0.5, this.pollutionFactor - 0.01);
            if (this.pollutionFactor < 0.7 && !this.isFault && Math.random() < 0.3) {
                this.isFault = true;
                this._blinkTimer = 1;
            }
        }
        
        // 流体颜色效果
        const saltRatio = Math.min(1, this.salinity / 5);
        const fluidColor = `rgba(0, ${150 + Math.min(100, saltRatio * 100)}, 200, 0.25)`;
        if (this._fluidOverlay) {
            this._fluidOverlay.fill(fluidColor);
        }
    }
    
    // 更新趋势数据
    _updateTrend(dt) {
        if (!this.powered) return;
        
        // 滑动更新
        if (Math.random() < dt * 10) {
            this._salinityTrend.shift();
            this._salinityTrend.push(this.salinity);
            this._tempTrend.shift();
            this._tempTrend.push(this.temperature);
        }
    }
    
    // ── 显示刷新 ──────────────────────────────
    _tickDisplay(dt) {
        const pw = this.powered;
        const flt = this.isFault;
        
        // 报警闪烁
        if (this._blinkTimer > 0) {
            this._blinkTimer -= dt;
            this._alarmBlink = !this._alarmBlink;
        } else {
            this._alarmBlink = false;
        }
        
        if (!pw) {
            this._salinityMain.text('----');
            this._salinityMain.fill('#0d2030');
            this._currentLabel.text('--.-- mA');
            this._currentLabel.fill('#37474f');
            this._led.fill('#37474f');
            this._alarmStatus.text('⭕ 报警继电器: 失电');
            this._alarmStatus.fill('#455a64');
            this._sensorStatus.text('传感器: 无电源');
            this._sensorStatus.fill('#455a64');
            return;
        }
        
        if (flt) {
            this._salinityMain.text('FAULT');
            this._salinityMain.fill('#ef5350');
            this._currentLabel.text('3.6 mA');
            this._led.fill('#ef5350');
            this._alarmStatus.text('⚠ 报警继电器: 故障');
            this._alarmStatus.fill('#ef5350');
            this._sensorStatus.text('传感器: 污染/极化');
            this._sensorStatus.fill('#ef5350');
            return;
        }
        
        // 正常显示
        const isAlarm = this.alarmActive;
        const alarmFlash = isAlarm && this._alarmBlink;
        
        this._salinityMain.text(this.salinity.toFixed(2));
        this._salinityMain.fill(isAlarm && alarmFlash ? '#ff7043' : 
                                isAlarm ? '#ff8a65' : 
                                this.salinity > 1 ? '#ffb74d' : '#00e5ff');
        
        this._unitLabel.text(this.unit);
        this._currentLabel.text(`${this.outCurrent.toFixed(2)} mA`);
        this._led.fill(isAlarm ? '#ff5722' : (this.outCurrent > 3.8 ? '#4caf50' : '#ffeb3b'));
        
        // 温度/电导率/流量显示
        this._tempValue.text(`水温: ${this.temperature.toFixed(1)} °C`);
        this._condValue.text(`电导率: ${this.conductivity.toFixed(2)} mS/cm`);
        this._flowValue.text(`流量: ${this.flowRate.toFixed(2)} m³/h`);
        
        // 报警状态
        if (isAlarm) {
            this._alarmStatus.text(app.alert(`⚠ 报警继电器: 超限 (${this.salinity.toFixed(2)} > ${this.alarmSetpoint})`));
            this._alarmStatus.fill('#ff7043');
        } else {
            this._alarmStatus.text('⭕ 报警继电器: 正常');
            this._alarmStatus.fill('#66bb6a');
        }
        
        this._setpointLabel.text(`报警设定: ${this.alarmSetpoint} PSU`);
        this._sensorStatus.text(`传感器: ${this.pollutionFactor > 0.85 ? '良好' : 
                                 this.pollutionFactor > 0.7 ? '需清洁' : '注意污染'}`);
        this._calStatus.text(this.calibrationDue ? '校准: 到期 ⚠' : '校准: 有效');
        
        // 根据污染程度改变传感器电极颜色
        if (this._electrodes) {
            const tint = this.pollutionFactor < 0.7 ? '#6d4c41' : 
                        this.pollutionFactor < 0.85 ? '#8d6e63' : '#ff8f00';
            this._electrodes.forEach(e => e.fill(tint));
        }
    }
    
    // ═══════════════════════════════════════════════
    //  外部接口
    // ═══════════════════════════════════════════════
    update(flow_rate, temperature) {
        // 流量 (m³/h)
        if (typeof flow_rate === 'number') {
            this.flowRate = Math.max(0, flow_rate);
        }
        // 温度 (°C)
        if (typeof temperature === 'number') {
            this.temperature = temperature;
        }
        this._refreshCache();
    }
    
    // 返回传感器数据
    getSalinity() {
        return this.salinity;
    }
    
    getConductivity() {
        return this.conductivity;
    }
    
    getAlarmState() {
        return this.alarmActive;
    }
    
    // 清洁传感器（移除污染效应）
    cleanSensor() {
        this.pollutionFactor = 1.0;
        this.isFault = false;
        this.calibrationDue = false;
        return true;
    }
    
    // ═══════════════════════════════════════════════
    //  配置
    // ═══════════════════════════════════════════════
    getConfigFields() {
        return [
            { label: '位号/名称',           key: 'id',          type: 'text'    },
            { label: '量程下限 (PSU)',      key: 'rangeMin',    type: 'number'  },
            { label: '量程上限 (PSU)',      key: 'rangeMax',    type: 'number'  },
            { label: '报警设定点 (PSU)',    key: 'alarmSetpoint', type: 'number' },
            { label: '温度补偿',             key: 'tempCompensation', type: 'boolean' },
            { label: '电导池常数 (cm⁻¹)',   key: 'cellConstant', type: 'number'  },
            { label: '温度补偿系数 (/°C)',  key: 'tempCoeff',   type: 'number'  },
            { label: '参考温度 (°C)',       key: 'refTemp',     type: 'number'  },
            { label: '介质',                key: 'fluidName',   type: 'text'    },
            { label: '单位',                key: 'unit',        type: 'text'    },
        ];
    }
    
    onConfigUpdate(cfg) {
        this.id               = cfg.id               || this.id;
        this.rangeMin         = parseFloat(cfg.rangeMin) || this.rangeMin;
        this.rangeMax         = parseFloat(cfg.rangeMax) || this.rangeMax;
        this.alarmSetpoint    = parseFloat(cfg.alarmSetpoint) || this.alarmSetpoint;
        this.tempCompensation = cfg.tempCompensation !== undefined ? cfg.tempCompensation : this.tempCompensation;
        this.cellConstant     = parseFloat(cfg.cellConstant) || this.cellConstant;
        this.tempCoeff        = parseFloat(cfg.tempCoeff) || this.tempCoeff;
        this.refTemp          = parseFloat(cfg.refTemp) || this.refTemp;
        this.fluidName        = cfg.fluidName        || this.fluidName;
        this.unit             = cfg.unit             || this.unit;
        
        this.config = { ...this.config, ...cfg };
        if (this._idText) this._idText.text(this.id);
        if (this._setpointLabel) this._setpointLabel.text(`报警设定: ${this.alarmSetpoint} PSU`);
        if (this._unitLabel) this._unitLabel.text(this.unit);
        
        this._refreshCache();
    }
    
    destroy() {
        this._stopAnimation();
        super.destroy?.();
    }
}