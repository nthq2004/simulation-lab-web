import { BaseComponent } from './BaseComponent.js';

/**
 * PT100 铂电阻温度传感器仿真组件
 * （PT100 Platinum Resistance Temperature Detector）
 *
 * ── 工作原理 ──────────────────────────────────────────────────
 *  PT100 是一种铂热电阻，其阻值随温度升高而增大。
 *  符合 IEC 60751 国际标准，采用 Callendar-Van Dusen 方程：
 *
 *    -200℃ ~ 0℃：  R(T) = R0 × [1 + A×T + B×T² + C×(T-100)×T³]
 *    0℃ ~ 850℃：   R(T) = R0 × (1 + A×T + B×T²)
 *
 *  其中：
 *    R0 = 100Ω（0℃时的标称阻值）
 *    A  = 3.9083e-3
 *    B  = -5.775e-7
 *    C  = -4.183e-12
 *
 * ── 特性参数 ──────────────────────────────────────────────────
 *    测量范围：  -200℃ ~ 850℃
 *    精度等级：   A级：±(0.15 + 0.002×|T|)℃
 *                B级：±(0.30 + 0.005×|T|)℃
 *    响应时间：   τ ≈ 2~10秒（取决于安装方式）
 *    自热效应：   0.5℃/mW（最大测量电流 ≤1mA）
 *
 * ── 电气接口 ──────────────────────────────────────────────────
 *    两线制：    简单但有引线电阻误差
 *    三线制：    消除引线电阻影响（工业常用）
 *    四线制：    最高精度，用于校准
 *
 * ── 输出信号 ──────────────────────────────────────────────────
 *    原始输出：   电阻值 (Ω)
 *    变送输出：   4-20mA（可配置量程）
 *
 * ── 端口 ─────────────────────────────────────────────────────
 *    wire_a — 激励正极
 *    wire_b — 激励负极
 *    mA_out — 4-20mA 变送输出（可选）
 */
export class PT100Sensor2 extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.width  = Math.max(140, config.width  || 140);
        this.height = Math.max(180, config.height || 180);

        this.type    = 'sensor';
        this.special = 'pt100';
        this.cache   = 'fixed';

        this._initGroups();
        // ── PT100 物理参数 ─────────────────
        this.measTemp    = config.measTemp || 25.0;     // 被测温度 ℃
        this.displayTemp = this.measTemp;                // 显示用平滑温度
        
        // PT100 标称参数
        this.R0 = 100.0;                                 // 0℃时阻值 (Ω)
        this.A  = 3.9083e-3;                            // 一次项系数
        this.B  = -5.775e-7;                            // 二次项系数
        this.C  = -4.183e-12;                           // 三次项系数（负温区）
        
        // ── 传感器特性 ─────────────────────
        this.accuracyClass = config.accuracyClass || 'A';  // 'A', 'B', '1/3B', '1/10B'
        this.wireConfig    = config.wireConfig    || '3wire'; // '2wire', '3wire', '4wire'
        
        // 引线电阻参数（两线制/三线制补偿）
        this.leadResistance = config.leadResistance || 0.5;   // 单根引线电阻 (Ω)
        this.leadCompensated = true;                          // 三/四线制补偿启用
        
        // 响应时间参数（一阶惯性）
        this.responseTime   = config.responseTime || 3.0;     // 时间常数 τ (秒)
        this._tempFilter    = this.measTemp;                   // 滤波后的温度
        this._lastTime      = null;
        
        // 测量电流 (用于自热效应计算)
        this.measCurrent    = config.measCurrent || 1.0;      // 测量电流 (mA)
        selfHeatingCoeff    = 0.5;                            // 自热系数 ℃/mW
        
        // ── 变送器参数 ────────────────────
        this.hasTransmitter = config.hasTransmitter !== false;
        this.txRangeMin     = config.txRangeMin || -50;       // 变送量程下限 ℃
        this.txRangeMax     = config.txRangeMax || 250;       // 变送量程上限 ℃
        this.outputCurrent  = 4.0;                            // 4-20mA 输出
        
        // 故障模拟
        this.fault = config.fault || 'none';                  // 'none', 'open', 'short', 'drift'
        
        // ── 仿真输出 ──────────────────────
        this.resistance      = 100.0;                         // 当前电阻值 (Ω)
        this.idealResistance = 100.0;                         // 理想电阻值 (无误差)
        this.temperature     = 25.0;                          // 测量温度值 (带误差)
        
        // ── 动画状态 ──────────────────────
        this._phase = 0;
        this._lastTimestamp = null;
        
        // ── 几何布局 ──────────────────────
        this._sensorX = 10;
        this._sensorY = 35;
        this._sensorW = this.width - 20;
        this._sensorH = this.height - 50;
        
        this.config = {
            id: this.id,
            accuracyClass: this.accuracyClass,
            wireConfig: this.wireConfig,
            responseTime: this.responseTime,
        };
        
        this._init();
        
        // 端口
        this.addPort(this.width/2 - 15, this.height - 8, 'a', 'wire', 'p');
        this.addPort(this.width/2 + 15, this.height - 8, 'b', 'wire');
        
        if (this.hasTransmitter) {
            this.addPort(this.width - 8, this.height/2, 'mA', 'wire', 'p');
            this.addPort(this.width - 8, this.height/2 + 20, 'GND', 'wire');
        }
    }
    
    // ═══════════════════════════════════════════
    // 初始化绘图
    // ═══════════════════════════════════════════
    _init() {
        this._drawLabel();
        this._drawSensorBody();
        this._drawProbe();
        this._drawLeadWires();
        this._drawDisplay();
        this._drawTerminals();
        this._drawSpecLabel();
        
    }
    
    _drawLabel() {
        this._staticGroup.add(new Konva.Text({
            x: 0, y: -8, width: this.width,
            text: 'PT100 铂电阻温度传感器',
            fontSize: 11, fontStyle: 'bold', fill: '#1a2634', align: 'center',
        }));
    }
    
    // ── 传感器外壳 ─────────────────────────
    _drawSensorBody() {
        const sx = this._sensorX;
        const sy = this._sensorY;
        const sw = this._sensorW;
        const sh = this._sensorH;
        
        // 壳体（不锈钢）
        const body = new Konva.Rect({
            x: sx, y: sy, width: sw, height: sh,
            fill: '#c0c8d0',
            stroke: '#8a9aaa',
            strokeWidth: 1.5,
            cornerRadius: 8,
        });
        this._staticGroup.add(body);
        
        // 壳体高光
        this._staticGroup.add(new Konva.Rect({
            x: sx + 3, y: sy + 3,
            width: sw - 6, height: 4,
            fill: 'rgba(255,255,255,0.5)',
            cornerRadius: 2,
        }));
        
        // 型号铭牌
        this._staticGroup.add(new Konva.Rect({
            x: sx + sw/2 - 35, y: sy + 10,
            width: 70, height: 22,
            fill: '#1e2a36',
            stroke: '#0d1520',
            strokeWidth: 0.8,
            cornerRadius: 3,
        }));
        this._staticGroup.add(new Konva.Text({
            x: sx + sw/2 - 33, y: sy + 14,
            width: 66,
            text: 'PT100',
            fontSize: 11,
            fontStyle: 'bold',
            fill: '#ffd54f',
            align: 'center',
        }));
        this._staticGroup.add(new Konva.Text({
            x: sx + sw/2 - 33, y: sy + 24,
            width: 66,
            text: 'Class ' + this.accuracyClass,
            fontSize: 7,
            fill: '#8a9aaa',
            align: 'center',
        }));
        
        // 温度范围标识
        this._staticGroup.add(new Konva.Text({
            x: sx + 8, y: sy + sh - 18,
            text: '-200 ... 850°C',
            fontSize: 8,
            fill: '#607d8b',
            fontStyle: 'bold',
        }));
    }
    
    // ── 探头（插入部分）────────────────────
    _drawProbe() {
        const sx = this._sensorX;
        const sy = this._sensorY;
        const sw = this._sensorW;
        const sh = this._sensorH;
        
        // 探头（下部延伸）
        const probeX = sx + sw/2 - 12;
        const probeY = sy + sh - 5;
        const probeW = 24;
        const probeH = 25;
        
        this._probeGroup = new Konva.Group({ x: probeX, y: probeY });
        
        // 探头金属杆
        const stem = new Konva.Rect({
            x: 8, y: 0,
            width: 8, height: probeH - 8,
            fill: '#a0a8b0',
            stroke: '#78909c',
            strokeWidth: 1,
        });
        
        // 探头尖端
        const tip = new Konva.Circle({
            x: 12, y: probeH - 6,
            radius: 5,
            fill: '#e0a878',
            stroke: '#b06830',
            strokeWidth: 1,
        });
        
        // 温度场热晕（动态）
        this._probeGlow = new Konva.Circle({
            x: 12, y: probeH - 6,
            radius: 8,
            fill: 'rgba(255,100,0,0)',
        });
        
        this._probeGroup.add(stem, tip, this._probeGlow);
        this._staticGroup.add(this._probeGroup);
    }
    
    // ── 引线（接线端子连接）────────────────
    _drawLeadWires() {
        const sx = this._sensorX;
        const sw = this._sensorW;
        const sh = this._sensorH;
        
        // 接线端子座
        const termY = this._sensorY + this._sensorH - 20;
        
        // 端子座底板
        this._staticGroup.add(new Konva.Rect({
            x: sx + 15, y: termY,
            width: sw - 30, height: 16,
            fill: '#2a3a48',
            stroke: '#1a2a38',
            strokeWidth: 1,
            cornerRadius: 2,
        }));
        
        // 端子螺丝（根据线制决定数量）
        const termCount = this.wireConfig === '2wire' ? 2 : 
                         (this.wireConfig === '3wire' ? 3 : 4);
        const termSpacing = (sw - 50) / (termCount + 1);
        
        for (let i = 0; i < termCount; i++) {
            const termX = sx + 25 + (i + 1) * termSpacing;
            
            // 端子螺丝
            this._staticGroup.add(new Konva.Circle({
                x: termX, y: termY + 8,
                radius: 5,
                fill: '#607d8b',
                stroke: '#37474f',
                strokeWidth: 1,
            }));
            this._staticGroup.add(new Konva.Line({
                points: [termX-3, termY+8, termX+3, termY+8],
                stroke: '#263238',
                strokeWidth: 1.5,
            }));
            
            // 端子标注
            const labels = this.wireConfig === '3wire' ? ['A', 'B', 'B'] : 
                          (this.wireConfig === '4wire' ? ['I+', 'V+', 'V-', 'I-'] : ['A', 'B']);
            if (labels[i]) {
                this._staticGroup.add(new Konva.Text({
                    x: termX - 4, y: termY - 10,
                    text: labels[i],
                    fontSize: 7,
                    fill: '#ffa726',
                    align: 'center',
                }));
            }
        }
        
        // 线制标注
        let wireLabel = '';
        if (this.wireConfig === '2wire') wireLabel = '两线制';
        else if (this.wireConfig === '3wire') wireLabel = '三线制';
        else wireLabel = '四线制';
        
        this._staticGroup.add(new Konva.Text({
            x: sx + sw - 45, y: termY - 12,
            text: wireLabel,
            fontSize: 8,
            fill: '#4fc3f7',
            fontStyle: 'bold',
        }));
    }
    
    // ── LCD 显示屏（显示温度/阻值）──────────
    _drawDisplay() {
        const sx = this._sensorX;
        const sy = this._sensorY;
        const sw = this._sensorW;
        
        const dispX = sx + 10;
        const dispY = sy + 38;
        const dispW = sw - 20;
        const dispH = 52;
        
        // 屏幕背景
        this._staticGroup.add(new Konva.Rect({
            x: dispX, y: dispY,
            width: dispW, height: dispH,
            fill: '#020c14',
            stroke: '#1a3040',
            strokeWidth: 1.5,
            cornerRadius: 4,
        }));
        
        // 温度值显示（大字体）
        this._tempDisplay = new Konva.Text({
            x: dispX + 5, y: dispY + 6,
            width: dispW - 10,
            text: '25.0 °C',
            fontSize: 18,
            fontFamily: 'Courier New, monospace',
            fontStyle: 'bold',
            fill: '#00e5ff',
            align: 'center',
        });
        this._staticGroup.add(this._tempDisplay);
        
        // 电阻值显示（小字体）
        this._resDisplay = new Konva.Text({
            x: dispX + 5, y: dispY + 32,
            width: dispW - 10,
            text: 'R = 109.73 Ω',
            fontSize: 9,
            fontFamily: 'Courier New, monospace',
            fill: '#8a9aaa',
            align: 'center',
        });
        this._staticGroup.add(this._resDisplay);
        
        // 单位标签
        this._staticGroup.add(new Konva.Text({
            x: dispX + dispW - 22, y: dispY + 10,
            text: '°C',
            fontSize: 9,
            fill: '#4fc3f7',
        }));
    }
    
    // ── 规格标签（精度/响应时间）────────────
    _drawSpecLabel() {
        const sx = this._sensorX;
        const sw = this._sensorW;
        const sy = this._sensorY + this._sensorH - 52;
        
        // 精度等级
        let accuracyText = '';
        if (this.accuracyClass === 'A') {
            accuracyText = 'A级: ±(0.15+0.002|t|)°C';
        } else if (this.accuracyClass === 'B') {
            accuracyText = 'B级: ±(0.30+0.005|t|)°C';
        } else if (this.accuracyClass === '1/3B') {
            accuracyText = '1/3B级: ±(0.10+0.0017|t|)°C';
        } else {
            accuracyText = '1/10B级: ±(0.03+0.0005|t|)°C';
        }
        
        this._staticGroup.add(new Konva.Text({
            x: sx + 8, y: sy + 5,
            text: accuracyText,
            fontSize: 7.5,
            fill: '#78909c',
        }));
        
        this._staticGroup.add(new Konva.Text({
            x: sx + 8, y: sy + 17,
            text: `响应时间 τ = ${this.responseTime}s`,
            fontSize: 7.5,
            fill: '#78909c',
        }));
        
        if (this.hasTransmitter) {
            this._staticGroup.add(new Konva.Text({
                x: sx + 8, y: sy + 29,
                text: `变送范围: ${this.txRangeMin}~${this.txRangeMax}°C → 4~20mA`,
                fontSize: 7.5,
                fill: '#ffa726',
            }));
        }
    }
    
    // ── 接线端子（底部）────────────────────
    _drawTerminals() {
        // 底部接线端子（用于外部连线）
        const sx = this._sensorX;
        const sw = this._sensorW;
        
        this._staticGroup.add(new Konva.Rect({
            x: sx + sw/2 - 30, y: this.height - 12,
            width: 60, height: 12,
            fill: '#1a2a38',
            stroke: '#0d1520',
            strokeWidth: 1,
            cornerRadius: [0, 0, 3, 3],
        }));
    }
    
    // ═══════════════════════════════════════════
    // 核心算法：Callendar-Van Dusen 方程
    // ═══════════════════════════════════════════
    
    /**
     * 根据温度计算理想电阻值
     * @param {number} temp 温度 (°C)
     * @returns {number} 电阻值 (Ω)
     */
    _calcResistance(temp) {
        if (temp >= 0) {
            // 0°C ~ 850°C
            return this.R0 * (1 + this.A * temp + this.B * temp * temp);
        } else {
            // -200°C ~ 0°C
            return this.R0 * (1 + this.A * temp + this.B * temp * temp 
                + this.C * (temp - 100) * temp * temp * temp);
        }
    }
    
    /**
     * 根据电阻值反向计算温度（用于仿真验证）
     * @param {number} R 电阻值 (Ω)
     * @returns {number} 温度 (°C)
     */
    _calcTemperature(R) {
        // 简化求解：先假设为正温区，使用二次方程求根
        // R = R0 * (1 + A*T + B*T²)
        // => B*T² + A*T + (1 - R/R0) = 0
        const rRatio = R / this.R0;
        const discriminant = this.A * this.A - 4 * this.B * (1 - rRatio);
        
        if (discriminant >= 0) {
            const T = (-this.A + Math.sqrt(discriminant)) / (2 * this.B);
            if (T >= 0 && T <= 850) return T;
        }
        
        // 负温区需要迭代求解（简化：返回估算值）
        // 这里使用线性近似
        return (R - this.R0) / (this.R0 * this.A);
    }
    
    /**
     * 计算精度误差（基于精度等级）
     * @param {number} temp 温度 (°C)
     * @returns {number} 误差范围 (±)
     */
    _calcAccuracy(temp) {
        const absTemp = Math.abs(temp);
        switch (this.accuracyClass) {
            case 'A':
                return 0.15 + 0.002 * absTemp;
            case 'B':
                return 0.30 + 0.005 * absTemp;
            case '1/3B':
                return 0.10 + 0.0017 * absTemp;
            case '1/10B':
                return 0.03 + 0.0005 * absTemp;
            default:
                return 0.3;
        }
    }
    
    /**
     * 计算引线电阻误差（仅两线制）
     * @returns {number} 附加电阻误差 (Ω)
     */
    _calcLeadError() {
        if (this.wireConfig === '2wire' && !this.leadCompensated) {
            // 两线制：引线电阻直接叠加（2根线）
            return 2 * this.leadResistance;
        }
        // 三线制/四线制：理论上完全补偿
        return 0;
    }
    
    /**
     * 计算自热效应引起的温升
     * @returns {number} 自热温升 (°C)
     */
    _calcSelfHeating() {
        // P = I² × R
        const power = Math.pow(this.measCurrent / 1000, 2) * this.resistance;
        return power * this.selfHeatingCoeff;
    }
    
    /**
     * 一阶惯性滤波（模拟热响应时间）
     * @param {number} target 目标温度
     * @param {number} dt 时间步长 (s)
     * @returns {number} 滤波后温度
     */
    _filterTemperature(target, dt) {
        const alpha = dt / (this.responseTime + dt);
        return this._tempFilter + alpha * (target - this._tempFilter);
    }
    
    // ═══════════════════════════════════════════
    // 物理仿真更新
    // ═══════════════════════════════════════════
    
    _updatePhysics(dt) {
        // 1. 一阶惯性响应（模拟传感器热滞后）
        const filteredTemp = this._filterTemperature(this.measTemp, dt);
        this._tempFilter = filteredTemp;
        this.displayTemp = filteredTemp;
        
        // 2. 计算理想电阻值
        this.idealResistance = this._calcResistance(filteredTemp);
        
        // 3. 添加精度误差
        const accuracy = this._calcAccuracy(filteredTemp);
        const randomError = (Math.random() - 0.5) * 2 * accuracy * 0.3;  // 随机误差
        const accuracyError = (Math.random() - 0.5) * 2 * accuracy * 0.7; // 系统误差
        
        // 4. 添加引线电阻误差
        const leadError = this._calcLeadError();
        
        // 5. 添加自热效应
        const selfHeat = this._calcSelfHeating();
        
        // 6. 总电阻值
        let totalResistance = this.idealResistance + leadError + randomError + accuracyError;
        
        // 7. 故障模拟
        if (this.fault === 'open') {
            totalResistance = Infinity;
            this.outputCurrent = 0;
        } else if (this.fault === 'short') {
            totalResistance = 0;
            this.outputCurrent = 24;
        } else if (this.fault === 'drift') {
            totalResistance = this.idealResistance * 1.1;  // 10% 漂移
        }
        
        this.resistance = totalResistance;
        
        // 8. 计算测量温度（从电阻反向推算）
        if (this.fault !== 'open' && this.resistance > 0 && isFinite(this.resistance)) {
            this.temperature = this._calcTemperature(this.resistance);
            // 添加自热补偿后的显示温度
            this.displayTemp = filteredTemp + selfHeat;
        } else {
            this.temperature = -999;
            this.displayTemp = -999;
        }
        
        // 9. 4-20mA 变送输出
        if (this.hasTransmitter && this.fault !== 'open' && this.fault !== 'short') {
            let tempForTx = Math.max(this.txRangeMin, Math.min(this.txRangeMax, filteredTemp));
            const ratio = (tempForTx - this.txRangeMin) / (this.txRangeMax - this.txRangeMin);
            this.outputCurrent = 4 + ratio * 16;
            this.outputCurrent = Math.max(3.8, Math.min(20.5, this.outputCurrent));
        }
        
        // 10. 动画相位
        this._phase += dt * 3;
    }
    
    // ═══════════════════════════════════════════
    // 动画与显示更新
    // ═══════════════════════════════════════════
    
    // 集中化 tick（由 consys._tickAll 在 20fps 调用）
    tick(dt) {
        this._updatePhysics(dt);
        this._updateDisplay();
        this._updateVisualEffects();
        this._refreshCache();
    }
    
    _updateDisplay() {
        // 更新温度显示
        if (this._tempDisplay) {
            let displayValue = this.displayTemp;
            let unit = '°C';
            
            if (this.fault === 'open') {
                this._tempDisplay.text('-- OPEN --');
                this._tempDisplay.fill('#ef5350');
            } else if (this.fault === 'short') {
                this._tempDisplay.text('-- SHORT --');
                this._tempDisplay.fill('#ef5350');
            } else if (!isFinite(displayValue) || displayValue < -250) {
                this._tempDisplay.text('-- ERR --');
                this._tempDisplay.fill('#ef5350');
            } else {
                this._tempDisplay.text(`${displayValue.toFixed(1)} ${unit}`);
                // 根据温度改变颜色
                if (displayValue > 200) {
                    this._tempDisplay.fill('#ef5350');
                } else if (displayValue > 100) {
                    this._tempDisplay.fill('#ff9800');
                } else {
                    this._tempDisplay.fill('#00e5ff');
                }
            }
        }
        
        // 更新电阻显示
        if (this._resDisplay) {
            if (this.fault === 'open') {
                this._resDisplay.text('R = ∞ Ω');
            } else if (this.fault === 'short') {
                this._resDisplay.text('R = 0 Ω');
            } else {
                this._resDisplay.text(`R = ${this.resistance.toFixed(2)} Ω`);
            }
        }
        
        // 更新端口输出值（变送器）
        if (this.hasTransmitter && this.ports['mA']) {
            this.ports['mA'].value = this.outputCurrent / 1000;  // 转换为 A
        }
    }
    
    _updateVisualEffects() {
        // 探头热晕效果（根据温度改变颜色）
        if (this._probeGlow && this.displayTemp > 50) {
            const intensity = Math.min(0.5, (this.displayTemp - 50) / 300);
            const pulse = 0.5 + 0.5 * Math.sin(this._phase * 2);
            this._probeGlow.fill(`rgba(255, 80, 20, ${intensity * pulse})`);
        } else if (this._probeGlow) {
            this._probeGlow.fill('rgba(255,100,0,0)');
        }
    }
    
    // ═══════════════════════════════════════════
    // 外部接口
    // ═══════════════════════════════════════════
    
    /**
     * 设置被测温度
     * @param {number} temp 温度 (°C)
     */
    setTemperature(temp) {
        this.measTemp = Math.max(-200, Math.min(850, temp));
    }
    
    /**
     * 获取当前电阻值
     * @returns {number} 电阻 (Ω)
     */
    getResistance() {
        return this.resistance;
    }
    
    /**
     * 获取当前温度测量值（经过滤波和误差）
     * @returns {number} 温度 (°C)
     */
    getTemperature() {
        return this.temperature;
    }
    
    /**
     * 获取理想电阻值（无误差）
     * @returns {number} 理想电阻 (Ω)
     */
    getIdealResistance() {
        return this.idealResistance;
    }
    
    /**
     * 获取 4-20mA 输出电流
     * @returns {number} 电流 (mA)
     */
    getOutputCurrent() {
        return this.outputCurrent;
    }
    
    /**
     * 设置故障模式
     * @param {string} fault 'none', 'open', 'short', 'drift'
     */
    setFault(fault) {
        this.fault = fault;
    }
    
    /**
     * 设置精度等级
     * @param {string} grade 'A', 'B', '1/3B', '1/10B'
     */
    setAccuracyClass(grade) {
        this.accuracyClass = grade;
    }
    
    /**
     * 设置变送器量程
     * @param {number} min 下限 (°C)
     * @param {number} max 上限 (°C)
     */
    setTransmitterRange(min, max) {
        this.txRangeMin = min;
        this.txRangeMax = max;
    }
    
    update(temp) {
        if (typeof temp === 'number') {
            this.setTemperature(temp);
        }
        this._refreshCache();
    }
    
    getConfigFields() {
        return [
            { label: '位号/名称', key: 'id', type: 'text' },
            { label: '精度等级', key: 'accuracyClass', type: 'select', 
              options: ['A', 'B', '1/3B', '1/10B'] },
            { label: '接线制式', key: 'wireConfig', type: 'select',
              options: ['2wire', '3wire', '4wire'] },
            { label: '响应时间 (s)', key: 'responseTime', type: 'number' },
            { label: '测量电流 (mA)', key: 'measCurrent', type: 'number' },
            { label: '变送下限 (°C)', key: 'txRangeMin', type: 'number' },
            { label: '变送上限 (°C)', key: 'txRangeMax', type: 'number' },
        ];
    }
    
    onConfigUpdate(cfg) {
        if (cfg.id !== undefined) this.id = cfg.id;
        if (cfg.accuracyClass !== undefined) this.accuracyClass = cfg.accuracyClass;
        if (cfg.wireConfig !== undefined) this.wireConfig = cfg.wireConfig;
        if (cfg.responseTime !== undefined) this.responseTime = parseFloat(cfg.responseTime);
        if (cfg.measCurrent !== undefined) this.measCurrent = parseFloat(cfg.measCurrent);
        if (cfg.txRangeMin !== undefined) this.txRangeMin = parseFloat(cfg.txRangeMin);
        if (cfg.txRangeMax !== undefined) this.txRangeMax = parseFloat(cfg.txRangeMax);
        this.config = { ...this.config, ...cfg };
    }
    
    destroy() {
        super.destroy?.();
    }
}

export default PT100Sensor;