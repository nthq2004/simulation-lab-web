import { BaseComponent } from './BaseComponent.js';

/**
 * 船舶纵横倾传感器仿真组件 (Marine Inclinometer / Tilt Sensor)
 * * ── 测量原理 ────────────────────────────────────────────────
 * 基于重力矢量检测。传感器内部 MEMS 质量块感应重力在 X/Y 轴的分量。
 * 纵倾 (Trim)：前后角度；横倾 (Heel)：左右角度。
 * * ── 端口 ───────────────────────────────────────────────────
 * wire_p — 24VDC 电源正
 * wire_n — 0V / 公共端
 * wire_roll — 横倾 4-20mA 输出
 * wire_pitch — 纵倾 4-20mA 输出
 */
export class MarineInclinometer extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.width = 300;
        this.height = 280;

        this.type = 'inclinometer';
        this.cache = 'fixed';

        // ── 传感器参数 ──
        this.range = config.range || 45;       // 量程 ±45°
        this.damping = config.damping || 0.85; // 阻尼 (模拟硅油减震)
        
        // ── 实时物理状态 (单位: 度) ──
        this.roll = 0;   // 横倾角 (Heel)
        this.pitch = 0;  // 纵倾角 (Trim)
        this.isPowered = false;

        // ── 几何布局 ──
        this._centerX = this.width / 2;
        this._centerY = this.height / 2;
        this._dialR = 80; // 表盘半径

        this._init();

        // 端口设置
        const py = this._centerY;
        this.addPort(20, py - 30, 'p', 'wire', 'V+');
        this.addPort(20, py + 30, 'n', 'wire', '0V');
        this.addPort(this.width - 20, py - 15, 'roll', 'wire', 'ROLL');
        this.addPort(this.width - 20, py + 15, 'pitch', 'wire', 'PITCH');
    }

    _init() {
        this._drawLabel();
        this._drawCasing();      // 绘制坚固型铸铝外壳
        this._drawDualAxesDial(); // 绘制双轴交叉表盘
        this._drawElectronicStatus();
        this._startAnimation();
    }

    _drawLabel() {
        this.group.add(new Konva.Text({
            x: 0, y: 10, width: this.width,
            text: '双轴纵横倾角传感器 (陀螺补偿型)',
            fontSize: 14, fontStyle: 'bold', fill: '#2c3e50', align: 'center',
        }));
    }

    // ── 船舶级密封外壳 ────────────────────────────
    _drawCasing() {
        const casing = new Konva.Rect({
            x: this._centerX - 110, y: this._centerY - 100,
            width: 220, height: 200,
            fill: '#546e7a', stroke: '#263238', strokeWidth: 3, cornerRadius: 10
        });

        // 四角的安装螺栓
        const boltPos = [[-95, -85], [95, -85], [-95, 85], [95, 85]];
        boltPos.forEach(p => {
            this.group.add(new Konva.Circle({
                x: this._centerX + p[0], y: this._centerY + p[1],
                radius: 6, fill: '#90a4ae', stroke: '#37474f'
            }));
        });

        this.group.add(casing);
    }

    // ── 双轴交叉表盘 ──────────────────────────────
    _drawDualAxesDial() {
        // 表盘底色
        const dialBg = new Konva.Circle({
            x: this._centerX, y: this._centerY,
            radius: this._dialR, fill: '#1a2634', stroke: '#00e5ff', strokeWidth: 1
        });

        // 十字坐标线
        this._crossH = new Konva.Line({ points: [-this._dialR, 0, this._dialR, 0], stroke: '#37474f', x: this._centerX, y: this._centerY });
        this._crossV = new Konva.Line({ points: [0, -this._dialR, 0, this._dialR], stroke: '#37474f', x: this._centerX, y: this._centerY });

        // 水平仪气泡（虚拟气泡，代表当前倾斜状态）
        this._bubble = new Konva.Circle({
            x: this._centerX, y: this._centerY,
            radius: 12,
            fillLinearGradientStartPoint: { x: -5, y: -5 },
            fillLinearGradientEndPoint: { x: 8, y: 8 },
            fillLinearGradientColorStops: [0, '#00e5ff', 1, '#006064'],
            shadowBlur: 10, shadowColor: '#00e5ff'
        });

        this.group.add(dialBg, this._crossH, this._crossV, this._bubble);
    }

    _drawElectronicStatus() {
        this._txtData = new Konva.Text({
            x: this._centerX - 100, y: this._centerY + 110, width: 200,
            text: 'PITCH: 0.0° | ROLL: 0.0°',
            fontSize: 12, fill: '#263238', fontStyle: 'bold', align: 'center'
        });
        this.group.add(this._txtData);
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
        // 电源检测
        const v = this.getVoltageAtPort?.('p');
        this.isPowered = v > 18;

        // 模拟传感器阻尼响应
        // 目标：使气泡移动带有平滑的惯性效果
        if (!this._currentPos) this._currentPos = { x: 0, y: 0 };
        
        // 将角度映射到像素位移
        const targetX = (this.roll / this.range) * this._dialR;
        const targetY = (this.pitch / this.range) * this._dialR;

        this._currentPos.x += (targetX - this._currentPos.x) * (1 - this.damping);
        this._currentPos.y += (targetY - this._currentPos.y) * (1 - this.damping);
    }

    _updateVisuals() {
        if (!this.isPowered) {
            this._bubble.opacity(0.1);
            this._txtData.text('NO POWER');
            return;
        }

        this._bubble.opacity(1);
        this._bubble.x(this._centerX + this._currentPos.x);
        this._bubble.y(this._centerY - this._currentPos.y); // Y轴向上为正

        // 边缘限制：如果超出量程，气泡变红
        const dist = Math.sqrt(this._currentPos.x**2 + this._currentPos.y**2);
        if (dist > this._dialR - 10) {
            this._bubble.fill('#ff5252');
        } else {
            this._bubble.fillLinearGradientColorStops([0, '#00e5ff', 1, '#006064']);
        }

        this._txtData.text(`纵倾(Trim): ${this.pitch.toFixed(1)}°\n横倾(Heel): ${this.roll.toFixed(1)}°`);
        this._refreshCache();
    }

    // ── 外部接口 ──────────────────────────────
    /**
     * @param {number} pitch 纵倾输入 (±角度)
     * @param {number} roll  横倾输入 (±角度)
     */
    update(press, flow, level, vib, vel, dist, isMetal, pitch, roll) {
        // 接收来自船舶运动模型的实时角度
        this.pitch = pitch || 0;
        this.roll = roll || 0;
    }

    /**
     * 电流输出模拟
     * 4mA -> -量程; 12mA -> 0°; 20mA -> +量程
     */
    getCurrentOutput() {
        if (!this.isPowered) return { roll: 0, pitch: 0 };
        const r_mA = 12 + (this.roll / this.range) * 8;
        const p_mA = 12 + (this.pitch / this.range) * 8;
        return { roll: r_mA, pitch: p_mA };
    }

    getConfigFields() {
        return [
            { label: '位号', key: 'id', type: 'text' },
            { label: '测量范围 (±°)', key: 'range', type: 'number' },
            { label: '阻尼系数 (0-1)', key: 'damping', type: 'number' }
        ];
    }

    onConfigUpdate(cfg) {
        this.range = parseFloat(cfg.range) || this.range;
        this.damping = parseFloat(cfg.damping) || this.damping;
        this.id = cfg.id || this.id;
    }

    destroy() {
        if (this._animId) cancelAnimationFrame(this._animId);
        super.destroy?.();
    }
}