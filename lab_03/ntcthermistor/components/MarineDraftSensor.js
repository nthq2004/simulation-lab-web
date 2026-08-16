import { BaseComponent } from './BaseComponent.js';

/**
 * 船舶吃水深度传感器仿真组件 (Marine Draft Pressure Sensor)
 * * ── 测量原理 ────────────────────────────────────────────────
 * 静压原理：P = ρ * g * h。
 * 传感器感应船底外部水的静压力，通过海水密度设定计算出精确吃水深度。
 * * ── 端口 ───────────────────────────────────────────────────
 * wire_vcc — 24VDC 电源正
 * wire_out — 4-20mA 信号输出
 */
export class MarineDraftSensor extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.width = 260;
        this.height = 320;

        this.type = 'draft_sensor';
        this.cache = 'fixed';

        // ── 传感器参数 ──
        this.maxRange = config.maxRange || 20; // 最大测量吃水深度 (m)
        this.density = config.density || 1.025; // 海水密度 (t/m³)
        
        // ── 状态 ──
        this.currentDepth = 0;   // 实时输入水深
        this.dispDepth = 0;      // 阻尼平滑后的深度显示
        this.isPowered = false;

        // ── 几何布局 ──
        this._centerX = this.width / 2;
        this._centerY = 140;
        this._hullY = 240; // 模拟船底线

        this._init();

        // 端口设置
        this.addPort(this._centerX - 30, 40, 'vcc', 'wire', '24V+');
        this.addPort(this._centerX + 30, 40, 'out', 'wire', 'SIG');
    }

    _init() {
        this._drawLabel();
        this._drawSea();         // 绘制模拟海水层
        this._drawHullSection(); // 绘制船底结构
        this._drawSensorBody();  // 绘制传感器主体
        this._drawLCD();         // 数字化显示
        this._startAnimation();
    }

    _drawLabel() {
        this.group.add(new Konva.Text({
            x: 0, y: 10, width: this.width,
            text: '静压式吃水深度计 (IP68)',
            fontSize: 14, fontStyle: 'bold', fill: '#2c3e50', align: 'center',
        }));
    }

    // ── 模拟环境 ──────────────────────────────
    _drawSea() {
        this._seaLevel = new Konva.Rect({
            x: 20, y: this._hullY - 100,
            width: this.width - 40, height: 100,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint: { x: 0, y: 100 },
            fillLinearGradientColorStops: [0, 'rgba(3, 169, 244, 0.2)', 1, 'rgba(1, 87, 155, 0.6)'],
        });
        this.group.add(this._seaLevel);
    }

    _drawHullSection() {
        // 模拟船底钢板剖面
        const hull = new Konva.Line({
            points: [10, this._hullY, this.width - 10, this._hullY],
            stroke: '#37474f', strokeWidth: 8, lineCap: 'square'
        });
        this.group.add(hull);
    }

    // ── 传感器结构 ────────────────────────────
    _drawSensorBody() {
        // 传感器安装法兰和腔体
        const flange = new Konva.Rect({
            x: this._centerX - 30, y: this._hullY - 4,
            width: 60, height: 12, fill: '#78909c', stroke: '#455a64', cornerRadius: 2
        });

        // 传感器电子仓
        const body = new Konva.Rect({
            x: this._centerX - 20, y: this._centerY,
            width: 40, height: this._hullY - this._centerY,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint: { x: 40, y: 0 },
            fillLinearGradientColorStops: [0, '#b0bec5', 0.5, '#f5f5f5', 1, '#90a4ae'],
            stroke: '#455a64'
        });

        // 感应膜片指示
        this._diaphragm = new Konva.Line({
            points: [this._centerX - 15, this._hullY + 8, this._centerX + 15, this._hullY + 8],
            stroke: '#00bcd4', strokeWidth: 2
        });

        this.group.add(body, flange, this._diaphragm);
    }

    _drawLCD() {
        const bg = new Konva.Rect({
            x: this._centerX - 40, y: 70, width: 80, height: 40,
            fill: '#263238', cornerRadius: 3
        });
        this._depthText = new Konva.Text({
            x: this._centerX - 40, y: 82, width: 80,
            text: '0.00 m', fontSize: 16, fill: '#00e676', align: 'center', fontFamily: 'Courier'
        });
        this.group.add(bg, this._depthText);
    }

    // ── 仿真循环 ──────────────────────────────
    _startAnimation() {
        const tick = () => {
            this._updateLogic();
            this._updateVisuals();
            this._animId = requestAnimationFrame(tick);
        };
        this._animId = requestAnimationFrame(tick);
    }

    _updateLogic() {
        const v = this.getVoltageAtPort?.('vcc') || 0;
        this.isPowered = v > 18;

        // 阻尼模拟 (模拟船舶摇晃时的水位波动平滑)
        this.dispDepth += (this.currentDepth - this.dispDepth) * 0.05;
    }

    _updateVisuals() {
        if (!this.isPowered) {
            this._depthText.fill('#37474f');
            this._depthText.text('OFF');
            return;
        }

        this._depthText.fill('#00e676');
        this._depthText.text(this.dispDepth.toFixed(2) + ' m');

        // 动态调整海平面高度视觉反馈
        const visualHeight = Math.min(120, this.dispDepth * 10);
        this._seaLevel.y(this._hullY - visualHeight);
        this._seaLevel.height(visualHeight);

        // 膜片颜色随压力（深度）变深
        const pressColor = `rgb(0, ${Math.max(100, 212 - this.dispDepth * 5)}, 212)`;
        this._diaphragm.stroke(pressColor);

        this._refreshCache();
    }

    // ── 外部接口 ──────────────────────────────
    /**
     * @param {number} waterLevel 外部水位高度（吃水深度）
     */
    update(press, flow, level, vib, vel, dist, isMetal, pitch, roll, waterLevel) {
        this.currentDepth = waterLevel || 0;
    }

    /**
     * 电流输出：4mA -> 0m; 20mA -> maxRange
     */
    getOutputCurrent() {
        if (!this.isPowered) return 0;
        const ratio = Math.min(1, this.dispDepth / this.maxRange);
        return 4 + ratio * 16;
    }

    getConfigFields() {
        return [
            { label: '位号', key: 'id', type: 'text' },
            { label: '量程 (m)', key: 'maxRange', type: 'number' },
            { label: '介质密度 (t/m³)', key: 'density', type: 'number' }
        ];
    }

    onConfigUpdate(cfg) {
        this.maxRange = parseFloat(cfg.maxRange) || this.maxRange;
        this.density = parseFloat(cfg.density) || this.density;
        this.id = cfg.id || this.id;
    }

    destroy() {
        if (this._animId) cancelAnimationFrame(this._animId);
        super.destroy?.();
    }
}