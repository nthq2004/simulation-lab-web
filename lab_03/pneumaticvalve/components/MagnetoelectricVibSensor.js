import { BaseComponent } from './BaseComponent.js';

/**
 * 磁电式振动传感器仿真组件 (Magnetoelectric Velocity Sensor)
 * * ── 测量原理 ────────────────────────────────────────────────
 * 动圈式结构：永久磁铁固定，线圈悬挂在弹簧上。
 * 振动时线圈切割磁力线，产生感应电动势 e = B * L * v。
 * 输出信号与振动速度成正比，无需外部电源即可产生电压信号。
 *
 * ── 端口 ───────────────────────────────────────────────────
 * wire_p — 信号正 (AC电压/电流)
 * wire_n — 信号负 (GND)
 */
export class MagnetoelectricVibSensor extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.width = 240;
        this.height = 300;

        this.type = 'vibration_sensor_me';
        this.cache = 'fixed';

        // ── 传感器性能参数 ──
        this.sensitivity = config.sensitivity || 20; // 灵敏度 mV/mm/s
        this.rangeV = config.rangeV || 50;           // 量程 (mm/s)
        this.naturalFreq = config.naturalFreq || 10; // 固有频率 (Hz)

        // ── 实时物理状态 ──
        this.inputVelocity = 0;   // 输入振动速度 (mm/s)
        this.coilPos = 0;         // 线圈相对位移
        this.coilVel = 0;         // 线圈相对速度
        this.outputVoltage = 0;   // 感应电动势 (mV)

        // ── 几何布局 ──
        this._centerX = this.width / 2;
        this._centerY = this.height / 2;
        this._magW = 60;
        this._magH = 80;

        this._init();

        // 端口设置：顶部接线柱
        this.addPort(this._centerX - 25, 40, 'p', 'wire', 'SIG+');
        this.addPort(this._centerX + 25, 40, 'n', 'wire', 'SIG-');
    }

    _init() {
        this._drawLabel();
        this._drawCasing();      // 绘制外壳
        this._drawMagnet();      // 绘制永久磁铁（固定部分）
        this._drawCoilSystem();  // 绘制线圈与弹簧（运动部分）
        this._drawStatus();      // 绘制实时数值
        this._startAnimation();
    }

    _drawLabel() {
        this.group.add(new Konva.Text({
            x: 0, y: 5, width: this.width,
            text: '磁电式振动速度传感器',
            fontSize: 14, fontStyle: 'bold', fill: '#2c3e50', align: 'center',
        }));
    }

    // ── 传感器外壳 ────────────────────────────
    _drawCasing() {
        const casing = new Konva.Rect({
            x: this._centerX - 60, y: 60,
            width: 120, height: 180,
            fill: '#cfd8dc', stroke: '#455a64', strokeWidth: 2, cornerRadius: 5
        });
        
        // 内部空腔感
        const cavity = new Konva.Rect({
            x: this._centerX - 50, y: 70,
            width: 100, height: 160,
            fill: '#eceff1', stroke: '#b0bec5', dash: [4, 4]
        });

        this.group.add(casing, cavity);
    }

    // ── 永久磁铁（固定在壳体上） ────────────────
    _drawMagnet() {
        const mX = this._centerX - this._magW / 2;
        const mY = this._centerY - this._magH / 2;

        // N极
        const north = new Konva.Rect({
            x: mX, y: mY, width: this._magW, height: this._magH / 2,
            fill: '#ef5350', stroke: '#b71c1c'
        });
        // S极
        const south = new Konva.Rect({
            x: mX, y: mY + this._magH / 2, width: this._magW, height: this._magH / 2,
            fill: '#5c6bc0', stroke: '#283593'
        });

        // 磁极标注
        this.group.add(north, south);
        this.group.add(new Konva.Text({ x: mX + 25, y: mY + 10, text: 'N', fill: 'white', fontStyle: 'bold' }));
        this.group.add(new Konva.Text({ x: mX + 25, y: mY + 50, text: 'S', fill: 'white', fontStyle: 'bold' }));
    }

    // ── 线圈与弹簧系统（质量块） ────────────────
    _drawCoilSystem() {
        this._movingGroup = new Konva.Group();

        // 1. 线圈骨架 (Coil Former) - 环绕磁铁
        this._coil = new Konva.Rect({
            x: this._centerX - 40, y: this._centerY - 30,
            width: 80, height: 60,
            stroke: '#ff9800', strokeWidth: 4, cornerRadius: 2
        });
        
        // 线圈上的细密绕线感
        for(let i=0; i<6; i++) {
            this._movingGroup.add(new Konva.Line({
                points: [this._centerX - 40, this._centerY - 25 + i*10, this._centerX + 40, this._centerY - 25 + i*10],
                stroke: '#e65100', strokeWidth: 1
            }));
        }

        // 2. 支撑弹簧 (Springs) - 上下各一组
        this._springTop = new Konva.Line({ points: [0,0,0,0], stroke: '#78909c', strokeWidth: 2 });
        this._springBottom = new Konva.Line({ points: [0,0,0,0], stroke: '#78909c', strokeWidth: 2 });

        this._movingGroup.add(this._coil);
        this.group.add(this._springTop, this._springBottom, this._movingGroup);
    }

    _drawStatus() {
        this._lcdVal = new Konva.Text({
            x: 0, y: 250, width: this.width,
            text: 'VEL: 0.00 mm/s', fontSize: 13, fill: '#2e7d32', align: 'center', fontStyle: 'bold'
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
        // 模拟线圈-弹簧系统的相对运动
        // 简化模型：coilPos 随振动速度产生相位滞后的正弦位移
        const k = 150; // 弹簧刚度
        const c = 8;   // 阻尼系数
        const m = 1.2; // 线圈质量

        // 相对加速度 a_rel = -a_ext - (k*x + c*v)/m
        // 这里简化为：直接根据输入速度计算线圈位移
        const accel = (-this.inputVelocity * 10 - k * this.coilPos - c * this.coilVel) / m;
        this.coilVel += accel * 0.16;
        this.coilPos += this.coilVel * 0.16;

        // 计算感应电动势 e = B * L * v_rel
        // 注意：输出的是相对速度产生的电压
        this.outputVoltage = this.coilVel * this.sensitivity;
    }

    _updateVisuals() {
        // 1. 更新线圈位置
        this._movingGroup.y(this.coilPos * 2);

        // 2. 更新弹簧视觉效果（伸缩）
        this._springTop.points([
            this._centerX, 70, 
            this._centerX, this._centerY - 30 + this.coilPos * 2
        ]);
        this._springBottom.points([
            this._centerX, this._centerY + 30 + this.coilPos * 2,
            this._centerX, 240
        ]);

        // 3. 更新数值显示
        this._lcdVal.text(`VEL: ${Math.abs(this.inputVelocity).toFixed(2)} mm/s\nOUT: ${this.outputVoltage.toFixed(1)} mV`);
        
        this._refreshCache();
    }

    // ── 外部接口 ──────────────────────────────
    /**
     * @param {number} velValue 输入的振动速度 (mm/s)
     */
    update(press, flow, level, vib, velValue) {
        // 磁电式传感器通常直接响应速度 velValue
        this.inputVelocity = velValue || 0;
    }

    getConfigFields() {
        return [
            { label: '位号', key: 'id', type: 'text' },
            { label: '灵敏度 (mV/mm/s)', key: 'sensitivity', type: 'number' },
            { label: '固有频率 (Hz)', key: 'naturalFreq', type: 'number' }
        ];
    }

    onConfigUpdate(cfg) {
        this.sensitivity = parseFloat(cfg.sensitivity) || this.sensitivity;
        this.id = cfg.id || this.id;
    }

    destroy() {
        if (this._animId) cancelAnimationFrame(this._animId);
        super.destroy?.();
    }
}