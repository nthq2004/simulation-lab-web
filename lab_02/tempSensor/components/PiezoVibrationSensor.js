import { BaseComponent } from './BaseComponent.js';

/**
 * 压电式振动传感器仿真组件 (Piezoelectric Vibration Sensor)
 * * ── 测量原理 ────────────────────────────────────────────────
 * 振动 -> 质量块产生惯性力 -> 作用于压电晶体 -> 产生电荷 (正压电效应)
 * Q = d * F = d * m * a
 * 内部 IEPE 电路将电荷转换为标准工业信号。
 * * ── 端口 ───────────────────────────────────────────────────
 * wire_p — 24VDC 电源正 / 信号+
 * wire_n — 公共端 (GND / Shield)
 */
export class PiezoVibrationSensor extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.width = 220;
        this.height = 260;

        this.type = 'vibration_sensor_piezo';
        this.cache = 'fixed';

        // ── 传感器性能参数 ──
        this.rangeG = config.rangeG || 80;       // 量程 (g)
        this.sensitivity = config.sensitivity || 100; // 灵敏度 mV/g
        this.freqResponse = config.freqResponse || 10000; // 频率响应上限 Hz

        // ── 实时物理状态 ──
        this.rawVibration = 0;   // 输入振动加速度 (g)
        this.outCurrent = 4;     // 输出电流 (mA)
        this.isPowered = false;
        
        // ── 动画辅助 ──
        this._shakeOffset = 0;   // 视觉抖动偏移
        this._chargeLevel = 0;   // 模拟电荷积累视觉效果

        // ── 几何布局 ──
        this._centerX = this.width / 2;
        this._centerY = this.height / 2 + 20;
        this._bodyW = 90;
        this._bodyH = 110;

        this._init();

        // 端口设置：模拟侧面航空插头
        this.addPort(this.width / 2 + 45, this._centerY - 20, 'p', 'wire', 'SIG+');
        this.addPort(this.width / 2 + 45, this._centerY + 10, 'n', 'wire', 'SIG-');
    }

    _init() {
        this._drawLabel();
        this._drawBase();        // 绘制安装底座
        this._drawInternal();    // 绘制内部压电结构
        this._drawOuterCasing(); // 绘制外壳（半透明）
        this._drawLCD();         // 绘制状态显示
        this._startAnimation();
    }

    _drawLabel() {
        this.group.add(new Konva.Text({
            x: 0, y: 0, width: this.width,
            text: '压电式加速度计 (IEPE)',
            fontSize: 14, fontStyle: 'bold', fill: '#2c3e50', align: 'center',
        }));
    }

    // ── 安装底座 ──────────────────────────────
    _drawBase() {
        this._base = new Konva.Rect({
            x: this._centerX - 55, y: this._centerY + this._bodyH / 2,
            width: 110, height: 15,
            fill: '#455a64', stroke: '#263238', strokeWidth: 1, cornerRadius: 2
        });
        this.group.add(this._base);
    }

    // ── 内部核心结构 ──────────────────────────
    _drawInternal() {
        this._internalGroup = new Konva.Group({ x: this._centerX, y: this._centerY });

        // 1. 中心支撑柱 (Center Post)
        const post = new Konva.Rect({
            x: -8, y: -this._bodyH / 2 + 20,
            width: 16, height: 70,
            fill: '#90a4ae'
        });

        // 2. 压电晶体层 (Piezo Elements)
        this._piezoL = new Konva.Rect({
            x: -18, y: -20, width: 10, height: 40,
            fill: '#fdd835', stroke: '#fbc02d', strokeWidth: 1
        });
        this._piezoR = new Konva.Rect({
            x: 8, y: -20, width: 10, height: 40,
            fill: '#fdd835', stroke: '#fbc02d', strokeWidth: 1
        });

        // 3. 质量块 (Mass) - 环绕或挂载在晶体外侧
        this._massL = new Konva.Rect({
            x: -30, y: -25, width: 12, height: 50,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint: { x: 12, y: 0 },
            fillLinearGradientColorStops: [0, '#546e7a', 0.5, '#78909c', 1, '#37474f'],
            stroke: '#263238', strokeWidth: 1, cornerRadius: 2
        });
        this._massR = new Konva.Rect({
            x: 18, y: -25, width: 12, height: 50,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint: { x: 12, y: 0 },
            fillLinearGradientColorStops: [0, '#546e7a', 0.5, '#78909c', 1, '#37474f'],
            stroke: '#263238', strokeWidth: 1, cornerRadius: 2
        });

        this._internalGroup.add(post, this._piezoL, this._piezoR, this._massL, this._massR);
        this.group.add(this._internalGroup);
    }

    // ── 外壳（不锈钢质感） ────────────────────
    _drawOuterCasing() {
        this._casing = new Konva.Rect({
            x: this._centerX - this._bodyW / 2,
            y: this._centerY - this._bodyH / 2,
            width: this._bodyW, height: this._bodyH,
            fill: 'rgba(176, 190, 197, 0.4)', // 半透明展示内部
            stroke: '#78909c', strokeWidth: 2, cornerRadius: 4
        });
        
        // 顶部的密封盖
        const cap = new Konva.Rect({
            x: this._centerX - this._bodyW / 2 - 5,
            y: this._centerY - this._bodyH / 2 - 5,
            width: this._bodyW + 10, height: 10,
            fill: '#546e7a', stroke: '#263238', cornerRadius: 2
        });

        this.group.add(this._casing, cap);
    }

    _drawLCD() {
        this._lcdVal = new Konva.Text({
            x: 0, y: this.height - 30, width: this.width,
            text: 'ACC: 0.0 g', fontSize: 13, fill: '#d32f2f', align: 'center', fontStyle: 'bold'
        });
        this.group.add(this._lcdVal);
    }

    // ── 仿真动画循环 ──────────────────────────
    _startAnimation() {
        const tick = () => {
            this._updatePhysics();
            this._updateVisuals();
            this._animId = requestAnimationFrame(tick);
        };
        this._animId = requestAnimationFrame(tick);
    }

    _updatePhysics() {
        // 1. 模拟 IEPE 信号转换逻辑
        // 压电式通常测量加速度，4mA 对应 0g，20mA 对应满量程 rangeG
        const ratio = Math.min(1, Math.abs(this.rawVibration) / this.rangeG);
        this.outCurrent = this.isPowered ? (4 + ratio * 16) : 0;

        // 2. 模拟高频抖动视觉偏移
        if (Math.abs(this.rawVibration) > 0.1) {
            this._shakeOffset = (Math.random() - 0.5) * (this.rawVibration / this.rangeG) * 10;
        } else {
            this._shakeOffset = 0;
        }
    }

    _updateVisuals() {
        // 1. 整体视觉抖动 (模拟高频振动)
        this._internalGroup.x(this._centerX + this._shakeOffset);
        
        // 2. 压电晶体发光 (模拟电荷产生过程)
        const alpha = Math.min(1, Math.abs(this.rawVibration) / (this.rangeG * 0.5));
        this._piezoL.fill(this.isPowered ? `rgba(253, 216, 53, ${0.4 + alpha * 0.6})` : '#fdd835');
        this._piezoR.fill(this.isPowered ? `rgba(253, 216, 53, ${0.4 + alpha * 0.6})` : '#fdd835');

        // 3. LCD 更新
        if (this.isPowered) {
            this._lcdVal.text(`ACCEL: ${Math.abs(this.rawVibration).toFixed(2)} g | ${this.outCurrent.toFixed(2)} mA`);
        } else {
            this._lcdVal.text('DISCONNECTED');
        }

        this._refreshCache();
    }

    // ── 外部接口 ──────────────────────────────
    /**
     * @param {number} vibValue 加速度输入 (g)
     */
    update(press, flow, level, vibValue) {
        this.rawVibration = vibValue || 0;

        // 电源检测逻辑：IEPE 传感器通常需要 18-30V 恒流源供电
        const v = this.getVoltageAtPort?.('p');
        this.isPowered = v > 15;
    }

    getConfigFields() {
        return [
            { label: '位号', key: 'id', type: 'text' },
            { label: '量程 (g)', key: 'rangeG', type: 'number' },
            { label: '灵敏度 (mV/g)', key: 'sensitivity', type: 'number' }
        ];
    }

    onConfigUpdate(cfg) {
        this.rangeG = parseFloat(cfg.rangeG) || this.rangeG;
        this.id = cfg.id || this.id;
    }

    destroy() {
        if (this._animId) cancelAnimationFrame(this._animId);
        super.destroy?.();
    }
}