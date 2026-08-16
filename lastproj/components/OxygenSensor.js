// OxygenSensor.js
import { BaseComponent } from './BaseComponent.js';

/**
 * 船用废气含氧量传感器（氧化锆式 Zirconia Oxygen Sensor）
 *
 * ── 测量原理 ────────────────────────────────────────────────
 *  基于氧化锆（ZrO₂）固体电解质在高温下的氧离子导电特性。
 *  传感器内外两侧分别接触被测废气（含氧量未知）和参比空气（含氧量 20.95%）。
 *  当两侧氧分压不同时，氧化锆元件产生能斯特电势：
 *
 *    E = (RT / 4F) * ln(P_ref / P_exhaust)
 *
 *  其中：
 *    E     - 能斯特输出电压 (mV)
 *    R     - 气体常数
 *    T     - 绝对温度 (K)
 *    F     - 法拉第常数
 *    P_ref - 参比侧氧分压（空气，固定）
 *    P_exhaust - 废气侧氧分压
 *
 *  氧浓度计算公式（简化）：
 *    O₂% = 20.95 * exp(-E * 4F / (RT))
 *
 *  典型量程：0-21% O₂（也可扩展至 0-25%）
 *  适用温度：600-800°C（需要加热器）
 *
 * ── 传感器结构 ──────────────────────────────────────────────
 *  ① 氧化锆传感元件（管状/片状）
 *  ② 加热器（维持工作温度）
 *  ③ 参比空气通道（自然对流或泵吸）
 *  ④ 多孔保护层（抗污染/抗硫）
 *  ⑤ 金属壳体（不锈钢/哈氏合金）
 *
 * ── 输出信号 ────────────────────────────────────────────────
 *  ① 4-20mA 模拟量输出（0-21% O₂ 线性映射）
 *  ② RS485 MODBUS RTU
 *  ③ 加热器状态/故障报警
 *
 * ── 组件结构 ───────────────────────────────────────────────
 *  ① 传感器探头（插入式安装，带加热器指示）
 *  ② 废气管道段
 *  ③ 参比空气入口（带过滤器）
 *  ④ 仪表头（LCD显示、配置按键）
 *  ⑤ 接线盒（电源、信号、通信）
 *
 * ── 端口 ───────────────────────────────────────────────────
 *  gas_in   — 废气进口（左）
 *  gas_out  — 废气出口（右）
 *  air_ref  — 参比空气入口
 *  vcc      — 24VDC
 *  out      — 4-20mA / GND
 *  rs485    — MODBUS 通信
 *
 * ── 气路求解器集成 ──────────────────────────────────────────
 *  special = 'sensor' (只读传感器)
 *  update(exhaust_temp, flow_rate) — 输入废气温度和流量
 */

export class OxygenSensor extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.width  = Math.max(320, config.width  || 350);
        this.height = Math.max(240, config.height || 270);

        this.type    = 'oxygen_sensor';
        this.special = 'sensor';
        this.cache   = 'fixed';

        // ── 仪表参数 ──
        this.rangeMin    = config.rangeMin    || 0;       // 量程下限 % O₂
        this.rangeMax    = config.rangeMax    || 21;      // 量程上限 % O₂
        this.alertLow    = config.alertLow    || 3;       // 低氧报警 %
        this.alertHigh   = config.alertHigh   || 18;      // 高氧报警 %
        this.operatingTemp = config.operatingTemp || 750; // 工作温度 °C
        this.fluidName    = config.fluidName   || '废气';
        this.unit         = config.unit        || '% O₂';
        
        // 氧化锆特性参数
        this.zirconiaResistance = config.zirconiaResistance || 100; // 内阻 Ω @ 750°C
        this.nernstSlope       = config.nernstSlope || 0.198;       // 能斯特斜率 mV/decade
        
        // 加热器参数
        this.heaterPower    = 30;            // 加热功率 W
        this.heaterTemp     = 25;            // 当前加热温度 °C
        this.heaterActive   = false;         // 加热器状态
        this.heaterCurrent  = 0;             // 加热电流 A
        
        // 校准参数
        this.zeroAdj        = 0;              // 零点偏移 %
        this.spanAdj        = 1.0;            // 满度系数
        this.calibrationDate = Date.now();
        
        // ── 状态变量 ──
        this.oxygen         = 0;              // 当前氧含量 %
        this.sensorTemp     = 25;             // 传感器温度 °C
        this.flowRate       = 0;              // 废气流量 m³/h
        this.exhaustTemp    = 200;            // 废气温度 °C
        this.nernstVoltage  = 0;              // 能斯特电压 mV
        this.zirconiaImpedance = 100;         // 氧化锆内阻 Ω
        this.outCurrent     = 4;              // 4-20mA 输出
        this.powered        = false;
        this.isFault        = false;          // 传感器故障
        this.heaterFault    = false;          // 加热器故障
        this.calibrationDue = false;          // 校准到期
        
        // 模拟污染/老化
        this.pollutionLevel = 0;              // 0-1 污染程度
        this.sulfurPoisoning = 0;             // 硫中毒程度
        this.thermalShock   = 0;              // 热冲击损伤
        
        // 历史数据
        this.avgOxygen      = 0;
        this.sampleCount    = 0;
        
        // ── 动画状态 ──
        this._molecules = [];                 // 氧气分子动画
        this._heaterGlow = 0;                 // 加热器发光强度
        this._blinkTimer = 0;
        
        // ── 趋势数据 ──
        this._trendBufLen = 100;
        this._oxygenTrend = new Array(this._trendBufLen).fill(21);
        this._tempTrend = new Array(this._trendBufLen).fill(750);
        
        // ── 几何布局 ──
        this._pipeX  = 10;
        this._pipeY  = 34;
        this._pipeW  = this.width - 20;
        this._pipeH  = Math.round(this.height * 0.35);
        
        // 传感器探头（垂直安装于管道上方）
        this._probeX = this._pipeX + this._pipeW * 0.65;
        this._probeY = this._pipeY - 8;
        this._probeW = 36;
        this._probeH = this._pipeH + 16;
        
        // 仪表头（右侧）
        this._headX  = this._pipeX + this._pipeW + 8;
        this._headW  = this.width - this._headX - 12;
        this._headY  = this._pipeY;
        this._headH  = this._pipeH;
        
        // 参比空气入口（左侧）
        this._airPortX = this._pipeX + 20;
        this._airPortY = this._pipeY - 20;
        
        // 底部状态面板
        this._panelY = this._pipeY + this._pipeH + 12;
        
        this._lastTs = null;
        this._animId = null;
        
        this.config = {
            id: this.id,
            rangeMin: this.rangeMin,
            rangeMax: this.rangeMax,
            operatingTemp: this.operatingTemp,
            unit: this.unit,
        };
        
        this._init();
        
        // ── 端口 ──
        const midY = this._pipeY + this._pipeH / 2;
        this.addPort(0,             midY, 'i', 'gas', 'IN');
        this.addPort(this.width,    midY, 'o', 'gas', 'OUT');
        this.addPort(this._airPortX, this._airPortY, 'a', 'air', 'AIR_REF');
        this.addPort(this.width - 20, this._headY + 16, 'p', 'wire', 'V+');
        this.addPort(this.width - 20, this._headY + 40, 'n', 'wire', '4-20mA');
        this.addPort(this.width - 20, this._headY + 64, 'c', 'wire', 'RS485');
    }

    // ═══════════════════════════════════════════════
    //  初始化
    // ═══════════════════════════════════════════════
    _init() {
        this._drawLabel();
        this._drawPipeSection();
        this._drawGasFlowAnimation();
        this._drawProbeAssembly();
        this._drawAirReference();
        this._drawInstrumentHead();
        this._drawLCD();
        this._drawHeaterIndicator();
        this._drawBottomPanel();
        this._startAnimation();
    }

    _drawLabel() {
        this.group.add(new Konva.Text({
            x: 0, y: -24, width: this.width,
            text: '船用废气含氧量传感器',
            fontSize: 14, fontStyle: 'bold', fill: '#1a2634', align: 'center',
        }));
        this.group.add(new Konva.Text({
            x: 0, y: -10, width: this.width,
            text: '氧化锆式  |  4-20mA  |  MODBUS  |  加热器自控',
            fontSize: 9, fill: '#607d8b', align: 'center',
        }));
    }

    // ── 废气管道段 ──────────────────────────────
    _drawPipeSection() {
        const { _pipeX: px, _pipeY: py, _pipeW: pw, _pipeH: ph } = this;
        
        // 管道外壁（耐高温涂层）
        const outer = new Konva.Rect({
            x: px, y: py, width: pw, height: ph,
            fill: '#6d4c41', stroke: '#4e342e', strokeWidth: 2, cornerRadius: 4,
        });
        
        // 保温层
        const insulation = new Konva.Rect({
            x: px + 6, y: py + 4, width: pw - 12, height: ph - 8,
            fill: '#8d6e63', stroke: '#6d4c41', strokeWidth: 1, cornerRadius: 3,
        });
        
        // 废气通道
        this._flowChanX = px + 12;
        this._flowChanY = py + 10;
        this._flowChanW = pw - 24;
        this._flowChanH = ph - 20;
        
        this._flowChannel = new Konva.Rect({
            x: this._flowChanX, y: this._flowChanY,
            width: this._flowChanW, height: this._flowChanH,
            fill: '#1a0a0a', // 高温废气颜色
        });
        
        // 火焰/高温效果（动态）
        this._heatOverlay = new Konva.Rect({
            x: this._flowChanX, y: this._flowChanY,
            width: this._flowChanW, height: this._flowChanH,
            fill: 'rgba(255,100,0,0.08)',
        });
        
        // 法兰
        const flangeL = new Konva.Rect({
            x: px - 8, y: py - 2, width: 10, height: ph + 4,
            fill: '#5d4037', stroke: '#3e2723', strokeWidth: 1, cornerRadius: [2, 0, 0, 2],
        });
        const flangeR = new Konva.Rect({
            x: px + pw - 2, y: py - 2, width: 10, height: ph + 4,
            fill: '#5d4037', stroke: '#3e2723', strokeWidth: 1, cornerRadius: [0, 2, 2, 0],
        });
        
        // 流向标签
        this.group.add(new Konva.Text({
            x: px + pw - 80, y: py + ph/2 - 8,
            text: '废气方向 →', fontSize: 8, fill: 'rgba(255,140,0,0.6)',
        }));
        
        this.group.add(outer, insulation, this._flowChannel, this._heatOverlay,
                       flangeL, flangeR);
    }
    
    // ── 气体分子动画（O₂/CO₂）──────────────────
    _drawGasFlowAnimation() {
        this._moleculeGroup = new Konva.Group();
        this.group.add(this._moleculeGroup);
    }
    
    // ── 氧化锆传感器探头 ───────────────────────
    _drawProbeAssembly() {
        const px = this._probeX - this._probeW / 2;
        const py = this._probeY;
        const pw = this._probeW;
        const ph = this._probeH;
        
        // 安装法兰
        const mount = new Konva.Rect({
            x: px - 4, y: py + 12, width: pw + 8, height: 14,
            fill: '#78909c', stroke: '#546e7a', strokeWidth: 1.5, cornerRadius: 3,
        });
        
        // 探头主体（不锈钢）
        const probeBody = new Konva.Rect({
            x: px, y: py + 24, width: pw, height: ph - 28,
            fill: 'linear-gradient(90deg, #b0bec5, #cfd8dc)',
            stroke: '#78909c', strokeWidth: 1, cornerRadius: [6, 6, 4, 4],
        });
        
        // 氧化锆元件（陶瓷，底部）
        const zro2 = new Konva.Rect({
            x: px + 8, y: py + ph - 32, width: pw - 16, height: 24,
            fill: '#fff8e1', stroke: '#ffb74d', strokeWidth: 1, cornerRadius: 4,
        });
        
        // 多孔保护层
        const porousLayer = new Konva.Rect({
            x: px + 10, y: py + ph - 30, width: pw - 20, height: 20,
            fill: 'rgba(255,225,125,0.3)', stroke: '#ffa726', strokeWidth: 0.5,
            cornerRadius: 3, dash: [2, 3],
        });
        
        // 电极（铂金）
        const electrode = new Konva.Rect({
            x: px + pw/2 - 8, y: py + ph - 26, width: 16, height: 12,
            fill: '#eceff1', stroke: '#90a4ae', strokeWidth: 0.5, cornerRadius: 2,
        });
        
        // 参比空气管
        const refAirTube = new Konva.Line({
            points: [px + pw/2, py + 10, px + pw/2, py - 10, px + pw/2 - 40, py - 10],
            stroke: '#546e7a', strokeWidth: 2, lineCap: 'round',
        });
        
        // 信号线
        const signalWire = new Konva.Line({
            points: [px + pw/2, py + 24, px + pw/2 + 25, py + 24],
            stroke: '#37474f', strokeWidth: 1.5, dash: [2, 2],
        });
        
        // 探头标签
        const labelO2 = new Konva.Text({
            x: px - 4, y: py - 8,
            text: 'ZrO₂', fontSize: 8, fontStyle: 'bold', fill: '#ffb74d',
        });
        
        this._probeGroup = { probeBody, zro2, porousLayer, electrode };
        
        this.group.add(mount, probeBody, zro2, porousLayer, electrode,
                       refAirTube, signalWire, labelO2);
    }
    
    // ── 参比空气入口（带过滤器）────────────────
    _drawAirReference() {
        const ax = this._airPortX;
        const ay = this._airPortY;
        
        const filter = new Konva.Rect({
            x: ax - 12, y: ay - 4, width: 24, height: 16,
            fill: '#eceff1', stroke: '#90a4ae', strokeWidth: 1, cornerRadius: 2,
        });
        
        const label = new Konva.Text({
            x: ax - 16, y: ay - 20,
            text: '参比空气 (20.95% O₂)', fontSize: 7, fill: '#4caf50',
        });
        
        const arrow = new Konva.Arrow({
            points: [ax - 6, ay + 4, ax + 20, ay + 4],
            pointerLength: 6, pointerWidth: 4,
            fill: '#66bb6a', stroke: '#66bb6a',
        });
        
        this.group.add(filter, label, arrow);
    }
    
    // ── 仪表头 ────────────────────────────────
    _drawInstrumentHead() {
        const hx = this._headX, hy = this._headY;
        const hw = this._headW, hh = this._headH;
        
        // 接线盒
        const jboxH = 48;
        const jbox = new Konva.Rect({
            x: hx, y: hy, width: hw, height: jboxH,
            fill: '#cfd8dc', stroke: '#90a4ae', strokeWidth: 1.5, cornerRadius: [5, 5, 2, 2],
        });
        
        this._idText = new Konva.Text({
            x: hx + 4, y: hy + 8, width: hw - 8,
            text: this.id || 'O2-101',
            fontSize: 10, fontStyle: 'bold', fill: '#263238', align: 'center',
        });
        
        this.group.add(new Konva.Text({
            x: hx + 4, y: hy + 22, width: hw - 8,
            text: 'ZIRCONIA OXYGEN', fontSize: 7, fill: '#78909c', align: 'center',
        }));
        
        // 端子标识
        ['24V', 'mA+', 'mA-', 'A', 'B'].forEach((label, i) => {
            this.group.add(new Konva.Text({
                x: hx + 6 + i * 28, y: hy + 34,
                text: label, fontSize: 6, fill: '#37474f',
            }));
        });
        
        // 仪表主体
        const body = new Konva.Rect({
            x: hx, y: hy + jboxH + 2, width: hw, height: hh - jboxH - 2,
            fill: '#1a2634', stroke: '#0d1520', strokeWidth: 1.5, cornerRadius: [2, 2, 5, 5],
        });
        
        this._headBodyY = hy + jboxH + 2;
        this._headBodyH = hh - jboxH - 2;
        
        this.group.add(jbox, body, this._idText);
    }
    
    // ── LCD 显示屏 ────────────────────────────
    _drawLCD() {
        const hx = this._headX, hw = this._headW;
        const bodyY = this._headBodyY;
        const bodyH = this._headBodyH;
        
        const lcdX = hx + 6;
        const lcdY = bodyY + 6;
        const lcdW = hw - 12;
        const lcdH = bodyH - 42;
        
        const lcdBg = new Konva.Rect({
            x: lcdX, y: lcdY, width: lcdW, height: lcdH,
            fill: '#021016', stroke: '#37474f', strokeWidth: 1, cornerRadius: 4,
        });
        
        // 主显示 O₂%
        this._oxygenMain = new Konva.Text({
            x: lcdX + 4, y: lcdY + 6, width: lcdW - 8,
            text: '--.--',
            fontSize: Math.min(34, lcdH * 0.48),
            fontFamily: 'Courier New, monospace',
            fontStyle: 'bold', fill: '#ff9800', align: 'center',
        });
        
        this._unitLabel = new Konva.Text({
            x: lcdX + 4, y: lcdY + lcdH - 22, width: lcdW - 8,
            text: this.unit,
            fontSize: 10, fill: '#00695c', align: 'center',
        });
        
        this._currentLabel = new Konva.Text({
            x: lcdX + 4, y: lcdY + lcdH - 12, width: lcdW - 8,
            text: '--.-- mA',
            fontSize: 8, fontFamily: 'Courier New, monospace', fill: '#80cbc4', align: 'center',
        });
        
        // 状态LED（绿/黄/红）
        this._led = new Konva.Circle({
            x: lcdX + lcdW - 10, y: lcdY + 6, radius: 4, fill: '#37474f',
        });
        
        this.group.add(lcdBg, this._oxygenMain, this._unitLabel, this._currentLabel, this._led);
    }
    
    // ── 加热器指示器 ──────────────────────────
    _drawHeaterIndicator() {
        const hx = this._headX, hw = this._headW;
        const bodyY = this._headBodyY;
        const bodyH = this._headBodyH;
        
        const indX = hx + 6;
        const indY = bodyY + 6 + (bodyH - 42) + 4;
        const indW = hw - 12;
        const indH = 28;
        
        const box = new Konva.Rect({
            x: indX, y: indY, width: indW, height: indH,
            fill: '#0d1a20', stroke: '#1a3040', strokeWidth: 1, cornerRadius: 3,
        });
        
        // 加热器温度条
        this._heatBar = new Konva.Rect({
            x: indX + 4, y: indY + 6, width: 0, height: 16,
            fill: '#ff5722', cornerRadius: 2,
        });
        
        const heatBg = new Konva.Rect({
            x: indX + 4, y: indY + 6, width: indW - 8, height: 16,
            fill: '#1a1a1a', stroke: '#37474f', strokeWidth: 0.5, cornerRadius: 2,
        });
        
        this._heatTempLabel = new Konva.Text({
            x: indX + indW - 50, y: indY + 7,
            text: '---°C', fontSize: 8, fontFamily: 'Courier New, monospace', fill: '#ff9800',
        });
        
        this.group.add(box, heatBg, this._heatBar, this._heatTempLabel);
    }
    
    // ── 底部状态面板 ──────────────────────────
    _drawBottomPanel() {
        const px = 10;
        const py = this._panelY;
        const pw = this.width - 20;
        
        const bg = new Konva.Rect({
            x: px, y: py, width: pw, height: 52,
            fill: '#050d18', stroke: '#1a3040', strokeWidth: 1, cornerRadius: 4,
        });
        
        // 传感器温度/内阻
        this._sensorTempLabel = new Konva.Text({
            x: px + 8, y: py + 6,
            text: '传感器: ---°C | 内阻: ---Ω',
            fontSize: 9, fontFamily: 'Courier New, monospace', fill: '#78909c',
        });
        
        // 能斯特电压
        this._nernstLabel = new Konva.Text({
            x: px + 8, y: py + 20,
            text: '能斯特电压: --- mV',
            fontSize: 9, fontFamily: 'Courier New, monospace', fill: '#546e7a',
        });
        
        // 废气参数
        this._exhaustLabel = new Konva.Text({
            x: px + pw - 160, y: py + 6,
            text: '废气: ---°C | --- m³/h',
            fontSize: 9, fontFamily: 'Courier New, monospace', fill: '#546e7a', align: 'right',
        });
        
        // 故障/报警状态
        this._faultLabel = new Konva.Text({
            x: px + pw - 160, y: py + 20,
            text: '状态: 正常',
            fontSize: 9, fontStyle: 'bold', fill: '#66bb6a', align: 'right',
        });
        
        this.group.add(bg, this._sensorTempLabel, this._nernstLabel,
                       this._exhaustLabel, this._faultLabel);
    }
    
    // ── 气体分子动画 ──────────────────────────
    _updateGasMolecules(dt) {
        if (!this.powered || this.flowRate < 0.5) {
            this._moleculeGroup.destroyChildren();
            return;
        }
        
        // 分子生成速率与氧含量相关
        const spawnRate = dt * (5 + this.flowRate / 20);
        if (Math.random() < spawnRate) {
            // 氧分子（红色/橙色）与废气分子（灰色）
            const isO2 = Math.random() < (this.oxygen / 25);
            this._molecules.push({
                x: this._flowChanX + Math.random() * 20,
                y: this._flowChanY + Math.random() * this._flowChanH,
                life: 1.0,
                speed: 40 + Math.random() * 40,
                isO2: isO2,
            });
        }
        
        // 更新位置
        this._molecules = this._molecules.filter(m => {
            m.x += dt * m.speed * (this.flowRate / 50 + 0.5);
            m.life -= dt * 0.5;
            return m.life > 0 && m.x < this._flowChanX + this._flowChanW;
        });
        
        // 重绘
        this._moleculeGroup.destroyChildren();
        this._molecules.forEach(m => {
            const size = 2 + (1 - m.life) * 1.5;
            const color = m.isO2 ? `rgba(255, 120, 50, ${m.life * 0.7})` 
                                 : `rgba(150, 150, 150, ${m.life * 0.5})`;
            const molecule = new Konva.Circle({
                x: m.x, y: m.y, radius: size, fill: color,
            });
            this._moleculeGroup.add(molecule);
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
                this._updateGasMolecules(dt);
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
    
    // ── 物理计算（能斯特方程/氧含量）────────────
    _tickPhysics(dt) {
        if (!this.powered) {
            this.oxygen = 0;
            this.outCurrent = 3.6;
            this.heaterActive = false;
            return;
        }
        
        // ── 加热器控制 ────────────────────────
        const targetTemp = this.operatingTemp;
        if (this.heaterTemp < targetTemp - 10 && !this.heaterFault) {
            this.heaterActive = true;
            this.heaterCurrent = 1.2;  // A @ 24V
            // 加热速率
            this.heaterTemp += dt * 45 * (1 - this.thermalShock * 0.3);
        } else if (this.heaterTemp > targetTemp + 5) {
            this.heaterActive = false;
            this.heaterCurrent = 0;
            this.heaterTemp -= dt * 8;
        } else {
            // PID 维持
            this.heaterActive = this.heaterTemp < targetTemp - 2;
            this.heaterCurrent = this.heaterActive ? 0.6 : 0;
            if (this.heaterActive) {
                this.heaterTemp += dt * 12;
            } else {
                this.heaterTemp -= dt * 5;
            }
        }
        
        // 传感器温度取加热器温度（陶瓷导热良好）
        this.sensorTemp = this.heaterTemp;
        
        // 热冲击损伤累积（温度变化率过大）
        const tempRate = Math.abs(this.sensorTemp - this.lastSensorTemp) / (dt || 0.001);
        if (tempRate > 100) {
            this.thermalShock = Math.min(0.5, this.thermalShock + dt * 0.05);
        } else {
            this.thermalShock = Math.max(0, this.thermalShock - dt * 0.02);
        }
        this.lastSensorTemp = this.sensorTemp;
        
        // ── 氧化锆内阻（随温度升高而降低）──────
        const tempFactor = Math.min(1, Math.max(0, (this.sensorTemp - 600) / 300));
        this.zirconiaImpedance = 500 * Math.exp(-tempFactor * 2.5);
        this.zirconiaImpedance += this.pollutionLevel * 300;  // 污染增加内阻
        
        // ── 氧含量模拟（基于燃烧过程）──────────
        let rawOxygen = 21;  // 新鲜空气
        
        // 废气氧含量取决于燃烧效率
        // 假设输入废气温度反映燃烧状态
        if (this.exhaustTemp > 100 && this.flowRate > 0.1) {
            // 完全燃烧时氧气消耗约 5-7%
            const combustionFactor = Math.min(0.9, Math.max(0.1, 
                (this.exhaustTemp - 150) / 500));
            rawOxygen = 21 * (1 - combustionFactor * 0.4);
            
            // 过量空气系数影响
            rawOxygen += (Math.random() - 0.5) * 0.3;
            
            // 传感器污染/硫中毒影响（输出偏高/偏低）
            if (this.sulfurPoisoning > 0.3) {
                rawOxygen = rawOxygen * (1 + this.sulfurPoisoning * 0.15);
            }
            if (this.pollutionLevel > 0.5) {
                rawOxygen = rawOxygen * (0.8 + this.pollutionLevel * 0.3);
            }
        }
        
        // 应用零点/满度调整
        let adjustedOxygen = (rawOxygen + this.zeroAdj) * this.spanAdj;
        adjustedOxygen = Math.max(this.rangeMin, Math.min(this.rangeMax, adjustedOxygen));
        this.oxygen = adjustedOxygen;
        
        // ── 能斯特电压计算 ────────────────────
        const R = 8.314;      // J/(mol·K)
        const F = 96485;      // C/mol
        const Tk = this.sensorTemp + 273.15;
        const P_ref = 20.95;  // 参比空气氧含量 %
        const P_exhaust = Math.max(0.1, this.oxygen);
        
        if (this.sensorTemp > 600 && !this.heaterFault) {
            // 能斯特方程
            this.nernstVoltage = (R * Tk / (4 * F)) * Math.log(P_ref / P_exhaust) * 1000;
            this.nernstVoltage = Math.max(0, Math.min(250, this.nernstVoltage));
        } else {
            this.nernstVoltage = 0;
        }
        
        // ── 4-20mA 输出 ───────────────────────
        const rangeSpan = this.rangeMax - this.rangeMin;
        if (rangeSpan > 0 && this.sensorTemp > 600 && !this.isFault) {
            const ratio = (this.oxygen - this.rangeMin) / rangeSpan;
            this.outCurrent = 4 + ratio * 16;
        } else if (this.heaterFault || this.sensorTemp < 500) {
            this.outCurrent = 3.6;  // 故障电流
        } else {
            this.outCurrent = 4;
        }
        
        // ── 故障检测 ──────────────────────────
        this.heaterFault = (this.heaterActive && this.heaterCurrent > 0 && 
                           this.heaterTemp < targetTemp - 100);
        this.isFault = this.heaterFault || this.zirconiaImpedance > 800 || 
                       this.thermalShock > 0.4 || this.sulfurPoisoning > 0.7;
        
        // 污染/老化累积
        if (this.powered && this.exhaustTemp > 200) {
            // 硫中毒（废气含硫）
            this.sulfurPoisoning = Math.min(1, this.sulfurPoisoning + dt * 0.0001);
            // 颗粒污染
            if (this.flowRate > 10) {
                this.pollutionLevel = Math.min(1, this.pollutionLevel + dt * 0.00005);
            }
        }
        
        // 积累平均氧含量
        if (this.sensorTemp > 600 && !this.isFault) {
            this.avgOxygen = (this.avgOxygen * this.sampleCount + this.oxygen) / (this.sampleCount + 1);
            this.sampleCount++;
            if (this.sampleCount > 10000) this.sampleCount = 5000;
        }
        
        // 加热器发光强度（用于视觉效果）
        this._heaterGlow = this.heaterActive ? 0.5 + Math.sin(Date.now() * 0.015) * 0.3 : 0;
        
        // 废气通道高温效果
        const heatIntensity = Math.min(0.25, (this.exhaustTemp / 800) * 0.2);
        if (this._heatOverlay) {
            this._heatOverlay.fill(`rgba(255, ${80 + Math.random() * 50}, 0, ${heatIntensity})`);
        }
    }
    
    // 上次温度（用于热冲击计算）
    lastSensorTemp = 25;
    
    // 更新趋势
    _updateTrend(dt) {
        if (!this.powered) return;
        if (Math.random() < dt * 8) {
            this._oxygenTrend.shift();
            this._oxygenTrend.push(this.oxygen);
            this._tempTrend.shift();
            this._tempTrend.push(this.sensorTemp);
        }
    }
    
    // ── 显示刷新 ──────────────────────────────
    _tickDisplay(dt) {
        const pw = this.powered;
        const fault = this.isFault;
        const heating = this.heaterActive;
        
        if (!pw) {
            this._oxygenMain.text('----');
            this._oxygenMain.fill('#0d2030');
            this._currentLabel.text('--.-- mA');
            this._led.fill('#37474f');
            this._faultLabel.text('状态: 无电源');
            this._faultLabel.fill('#455a64');
            this._heatTempLabel.text('---°C');
            if (this._heatBar) this._heatBar.width(0);
            return;
        }
        
        if (fault) {
            this._oxygenMain.text(this.heaterFault ? 'HEAT Err' : 'SENS Err');
            this._oxygenMain.fill(this.heaterFault ? '#ff7043' : '#ef5350');
            this._currentLabel.text('3.6 mA');
            this._led.fill('#f44336');
            this._faultLabel.text(`状态: ${this.heaterFault ? '加热器故障' : 
                                  this.sulfurPoisoning > 0.5 ? '硫中毒' : '传感器故障'}`);
            this._faultLabel.fill('#ef5350');
        } else {
            // 正常显示
            const isLowO2 = this.oxygen < this.alertLow;
            const isHighO2 = this.oxygen > this.alertHigh;
            
            this._oxygenMain.text(this.oxygen.toFixed(2));
            this._oxygenMain.fill(isLowO2 ? '#ff7043' : 
                                 isHighO2 ? '#ffb74d' : '#ff9800');
            this._currentLabel.text(`${this.outCurrent.toFixed(2)} mA`);
            this._led.fill(heating ? '#ff9800' : '#4caf50');
            this._faultLabel.text(`状态: ${isLowO2 ? '低氧报警' : 
                                   isHighO2 ? '高氧报警' : '正常'}`);
            this._faultLabel.fill(isLowO2 || isHighO2 ? '#ff9800' : '#66bb6a');
        }
        
        // 传感器参数
        this._sensorTempLabel.text(
            `传感器: ${this.sensorTemp.toFixed(0)}°C | 内阻: ${this.zirconiaImpedance.toFixed(0)}Ω`
        );
        this._nernstLabel.text(`能斯特电压: ${this.nernstVoltage.toFixed(1)} mV`);
        this._exhaustLabel.text(
            `废气: ${this.exhaustTemp.toFixed(0)}°C | ${this.flowRate.toFixed(1)} m³/h`
        );
        
        // 加热器温度条
        if (this._heatBar) {
            const target = this.operatingTemp;
            const ratio = Math.min(1, Math.max(0, this.sensorTemp / target));
            const maxWidth = this._headW - 20;
            this._heatBar.width(ratio * maxWidth);
            this._heatTempLabel.text(`${this.sensorTemp.toFixed(0)}°C`);
        }
        
        // 加热器发光效果（探头颜色）
        if (this._probeGroup && heating && !fault) {
            const glow = 0.2 + this._heaterGlow * 0.15;
            this._probeGroup.zro2.fill(`rgba(255, 100, 30, ${glow})`);
        } else if (this._probeGroup) {
            this._probeGroup.zro2.fill('#fff8e1');
        }
    }
    
    // ═══════════════════════════════════════════════
    //  外部接口
    // ═══════════════════════════════════════════════
    update(exhaust_temp, flow_rate) {
        // 废气温度 (°C)
        if (typeof exhaust_temp === 'number') {
            this.exhaustTemp = Math.max(0, exhaust_temp);
        }
        // 废气流量 (m³/h)
        if (typeof flow_rate === 'number') {
            this.flowRate = Math.max(0, flow_rate);
        }
        this._refreshCache();
    }
    
    // 获取当前氧含量
    getOxygen() {
        return this.oxygen;
    }
    
    // 获取能斯特电压
    getNernstVoltage() {
        return this.nernstVoltage;
    }
    
    // 获取传感器状态
    getSensorStatus() {
        return {
            temperature: this.sensorTemp,
            impedance: this.zirconiaImpedance,
            heaterActive: this.heaterActive,
            pollution: this.pollutionLevel,
            sulfurDamage: this.sulfurPoisoning,
        };
    }
    
    // 清洁/校准传感器
    calibrate(zeroGas = 0, spanGas = 21) {
        // 两点校准
        if (Math.abs(zeroGas) < 0.1) {
            this.zeroAdj = -this.oxygen;
        }
        if (Math.abs(spanGas - 21) < 0.5) {
            this.spanAdj = 21 / (this.oxygen + this.zeroAdj);
        }
        this.calibrationDate = Date.now();
        this.calibrationDue = false;
        this.pollutionLevel = Math.max(0, this.pollutionLevel - 0.2);
        return true;
    }
    
    // 强制加热器自检
    heaterSelfTest() {
        this.heaterFault = false;
        this.heaterTemp = 100;
        this.heaterActive = true;
        return true;
    }
    
    // ═══════════════════════════════════════════════
    //  配置
    // ═══════════════════════════════════════════════
    getConfigFields() {
        return [
            { label: '位号/名称',           key: 'id',            type: 'text'    },
            { label: '量程下限 (% O₂)',     key: 'rangeMin',      type: 'number'  },
            { label: '量程上限 (% O₂)',     key: 'rangeMax',      type: 'number'  },
            { label: '低氧报警 (%)',        key: 'alertLow',      type: 'number'  },
            { label: '高氧报警 (%)',        key: 'alertHigh',     type: 'number'  },
            { label: '工作温度 (°C)',       key: 'operatingTemp', type: 'number'  },
            { label: '氧化锆内阻 (Ω @750°C)', key: 'zirconiaResistance', type: 'number' },
            { label: '能斯特斜率 (mV/decade)', key: 'nernstSlope', type: 'number' },
            { label: '介质',                key: 'fluidName',     type: 'text'    },
            { label: '单位',                key: 'unit',          type: 'text'    },
        ];
    }
    
    onConfigUpdate(cfg) {
        this.id               = cfg.id               || this.id;
        this.rangeMin         = parseFloat(cfg.rangeMin) || this.rangeMin;
        this.rangeMax         = parseFloat(cfg.rangeMax) || this.rangeMax;
        this.alertLow         = parseFloat(cfg.alertLow) || this.alertLow;
        this.alertHigh        = parseFloat(cfg.alertHigh) || this.alertHigh;
        this.operatingTemp    = parseFloat(cfg.operatingTemp) || this.operatingTemp;
        this.zirconiaResistance = parseFloat(cfg.zirconiaResistance) || this.zirconiaResistance;
        this.nernstSlope      = parseFloat(cfg.nernstSlope) || this.nernstSlope;
        this.fluidName        = cfg.fluidName        || this.fluidName;
        this.unit             = cfg.unit             || this.unit;
        
        this.config = { ...this.config, ...cfg };
        if (this._idText) this._idText.text(this.id);
        if (this._unitLabel) this._unitLabel.text(this.unit);
        
        this._refreshCache();
    }
    
    destroy() {
        this._stopAnimation();
        super.destroy?.();
    }
}