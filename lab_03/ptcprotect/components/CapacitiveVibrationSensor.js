import { BaseComponent } from './BaseComponent.js';

/**
 * 电极式电容振动传感器仿真组件 (Capacitive Vibration Sensor)
 * * ── 测量原理 ────────────────────────────────────────────────
 * 振动引起质量块（动极板）位移 -> 改变与固定极板间的距离 d -> 改变电容量 C
 * C = ε * A / d
 * * ── 端口 ───────────────────────────────────────────────────
 * wire_p — 24VDC 正极
 * wire_n — 信号输出 (4-20mA 或 0-5V)
 */
export class CapacitiveVibrationSensor extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.width = 240;
        this.height = 280;

        this.type = 'vibration_sensor';
        this.cache = 'fixed';

        // ── 传感器参数 ──
        this.rangeG = config.rangeG || 50;      // 量程 (g)
        this.sensitivity = config.sensitivity || 100; // 灵敏度 mV/g
        this.damping = config.damping || 0.7;   // 阻尼系数

        // ── 物理状态 ──
        this.rawVibration = 0;   // 输入振动加速度 (g)
        this.displacement = 0;    // 动极板位移
        this.velocity = 0;        // 内部质量块速度
        this.outCurrent = 4;
        this.isPowered = false;

        // ── 几何布局 ──
        this._casingW = 120;
        this._casingH = 140;
        this._centerX = this.width / 2;
        this._centerY = this.height / 2;
        this._gap0 = 15; // 初始间隙

        this._init();

        // 端口设置：位于底部引出线
        this.addPort(this._centerX - 20, this._centerY + 90, 'p', 'wire', 'V+');
        this.addPort(this._centerX + 20, this._centerY + 90, 'n', 'wire', 'SIG');
    }

    _init() {
        this._drawLabel();
        this._drawCasing();      // 绘制外壳剖面
        this._drawPlates();      // 绘制电容器极板
        this._drawSprings();     // 绘制支撑弹簧
        this._drawLCD();         // 绘制侧面数值显示
        this._startAnimation();
    }

    _drawLabel() {
        this.group.add(new Konva.Text({
            x: 0, y: 10, width: this.width,
            text: '电容式振动速度/加速度传感器',
            fontSize: 14, fontStyle: 'bold', fill: '#2c3e50', align: 'center',
        }));
    }

    // ── 传感器外壳 ────────────────────────────
    _drawCasing() {
        const casing = new Konva.Rect({
            x: this._centerX - this._casingW / 2,
            y: this._centerY - this._casingH / 2,
            width: this._casingW, height: this._casingH,
            fill: '#f5f5f5', stroke: '#455a64', strokeWidth: 2, cornerRadius: 5
        });

        // 内部屏蔽腔
        const shield = new Konva.Rect({
            x: this._centerX - this._casingW / 2 + 10,
            y: this._centerY - this._casingH / 2 + 10,
            width: this._casingW - 20, height: this._casingH - 20,
            fill: '#e0e0e0', stroke: '#90a4ae', strokeWidth: 1, dash: [2, 2]
        });

        this.group.add(casing, shield);
    }

    // ── 电容极板 ──────────────────────────────
    _drawPlates() {
        // 1. 固定极板 (Fixed Plate) - 位于底部
        this._fixedPlate = new Konva.Rect({
            x: this._centerX - 40, y: this._centerY + 30,
            width: 80, height: 6,
            fill: '#546e7a', stroke: '#263238', cornerRadius: 1
        });

        // 2. 动极板 (Moving Plate / Mass) - 悬浮
        this._movingPlate = new Konva.Rect({
            x: this._centerX - 40, y: this._centerY + 30 - this._gap0,
            width: 80, height: 12,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint: { x: 0, y: 12 },
            fillLinearGradientColorStops: [0, '#78909c', 0.5, '#b0bec5', 1, '#546e7a'],
            stroke: '#37474f', strokeWidth: 1, cornerRadius: 2
        });

        this.group.add(this._fixedPlate, this._movingPlate);
    }

    // ── 弹性支撑机构 ──────────────────────────
    _drawSprings() {
        this._springGroup = new Konva.Group();
        // 绘制两条示意性弹簧
        const createSpring = (x) => {
            return new Konva.Line({
                points: [x, this._centerY - 50, x, this._centerY + 10],
                stroke: '#ffb300', strokeWidth: 2, dash: [4, 2] // 简化的螺旋线示意
            });
        };
        this._springL = createSpring(this._centerX - 30);
        this._springR = createSpring(this._centerX + 30);
        
        this._springGroup.add(this._springL, this._springR);
        this.group.add(this._springGroup);
    }

    // ── 数据显示 ──────────────────────────────
    _drawLCD() {
        this._lcdVal = new Konva.Text({
            x: 0, y: this.height - 40, width: this.width,
            text: 'VIB: 0.0 mm/s²', fontSize: 14, fill: '#1a237e', align: 'center', fontStyle: 'bold'
        });
        this.group.add(this._lcdVal);
    }

    // ── 仿真循环 ──────────────────────────────
    _startAnimation() {
        const tick = () => {
            this._updatePhysics();
            this._updateVisuals();
            this._animId = requestAnimationFrame(tick);
        };
        this._animId = requestAnimationFrame(tick);
    }

    _updatePhysics() {
        // 模拟简单的质量-弹簧-阻尼系统 (Mass-Spring-Damping)
        // 外部加速度 a 引发的惯性力 F = m * a
        const force = this.rawVibration; 
        const k = 200; // 弹簧刚度
        const c = 5;   // 阻尼系数
        const m = 1;   // 质量块

        // a_internal = (F_ext - k*x - c*v) / m
        const accelInternal = (force - k * this.displacement - c * this.velocity) / m;
        
        this.velocity += accelInternal * 0.16; // 简化步长
        this.displacement += this.velocity * 0.16;

        // 计算电流输出 (4-20mA) - 取振动绝对值或有效值
        const ratio = Math.min(1, Math.abs(this.rawVibration) / this.rangeG);
        this.outCurrent = this.isPowered ? (4 + ratio * 16) : 0;
    }

    _updateVisuals() {
        // 更新动极板位置
        const newY = (this._centerY + 30 - this._gap0) + this.displacement * 5; // 放大位移效果
        this._movingPlate.y(newY);

        // 更新弹簧长度
        const springH = newY - (this._centerY - 50);
        this._springL.points([this._centerX - 30, this._centerY - 50, this._centerX - 30, newY]);
        this._springR.points([this._centerX + 30, this._centerY - 50, this._centerX + 30, newY]);

        // 更新数值显示
        if (this.isPowered) {
            this._lcdVal.text(`VIB: ${Math.abs(this.rawVibration).toFixed(2)} g | ${this.outCurrent.toFixed(2)} mA`);
        } else {
            this._lcdVal.text('POWER OFF');
        }

        this._refreshCache();
    }

    // ── 外部接口 ──────────────────────────────
    /**
     * @param {number} vibValue 输入的振动加速度 (g)
     */
    update(press, flow, level, vibValue) {
        // 如果系统传入了振动模拟数据
        this.rawVibration = vibValue || 0;

        // 电源检测
        const v = this.getVoltageAtPort?.('p');
        this.isPowered = v > 15;
    }

    getConfigFields() {
        return [
            { label: '位号', key: 'id', type: 'text' },
            { label: '量程 (g)', key: 'rangeG', type: 'number' },
            { label: '阻尼系数', key: 'damping', type: 'number' }
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