import { BaseComponent } from './BaseComponent.js';

/**
 * 靶式流量计仿真组件 (Target Flowmeter)
 * * ── 测量原理 ────────────────────────────────────────────────
 * 流体流动冲击靶片，靶片受力 F 与流速 v 的平方成正比。
 * 传感器通过力传动机构将此力传递至应变片电桥，转换为电信号。
 *
 * ── 端口 ───────────────────────────────────────────────────
 * wire_p — 24VDC 正极
 * wire_n — 4-20mA 信号输出
 */
export class TargetFlowmeter extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.width = 280;
        this.height = 350;

        this.type = 'target_flowmeter';
        this.special = 'flow'; // 关联流量求解器
        this.cache = 'fixed';

        // ── 流量参数 ──
        this.maxFlow = config.maxFlow || 100; // 满量程 m3/h
        this.unit = config.unit || 'm³/h';
        this.density = config.density || 1000; // 流体密度 kg/m3

        // ── 状态 ──
        this.currentFlow = 0;   // 实时流量
        this.dispFlow = 0;      // 显示流量（带阻尼）
        this.targetForce = 0;   // 靶片受力
        this.outCurrent = 4;
        this.isPowered = false;

        // ── 几何布局 ──
        this._pipeY = 250;      // 管道中心高度
        this._pipeH = 80;       // 管道高度
        this._headW = 100;
        this._headH = 120;
        this._targetR = 25;     // 靶片半径

        this._init();

        // 端口设置：电子头右侧
        this.addPort(this.width / 2 + 50, 60, 'p', 'wire', '24V+');
        this.addPort(this.width / 2 + 50, 90, 'n', 'wire', 'SIG');
    }

    _init() {
        this._drawLabel();
        this._drawPipe();       // 绘制背景管道
        this._drawTarget();     // 绘制靶片与受力杆
        this._drawElectronicHead(); // 绘制电子头
        this._drawLCD();
        this._startAnimation();
    }

    _drawLabel() {
        this.group.add(new Konva.Text({
            x: 0, y: 0, width: this.width,
            text: '智能电容/应变靶式流量计',
            fontSize: 14, fontStyle: 'bold', fill: '#2c3e50', align: 'center',
        }));
    }

    // ── 管道剖面 ──────────────────────────────
    _drawPipe() {
        const pipe = new Konva.Rect({
            x: 20, y: this._pipeY - this._pipeH / 2,
            width: this.width - 40, height: this._pipeH,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint: { x: 0, y: this._pipeH },
            fillLinearGradientColorStops: [0, '#b0bec5', 0.4, '#eceff1', 1, '#90a4ae'],
            stroke: '#78909c', strokeWidth: 2, cornerRadius: 5
        });

        // 流程方向箭头
        const arrow = new Konva.Arrow({
            points: [40, this._pipeY + 30, 80, this._pipeY + 30],
            pointerLength: 8, pointerWidth: 6, fill: '#546e7a', stroke: '#546e7a', strokeWidth: 2
        });

        this.group.add(pipe, arrow);
    }

    // ── 靶片与力传动机构 ──────────────────────
    _drawTarget() {
        this._targetGroup = new Konva.Group({ x: this.width / 2, y: 150 });

        // 传感器受力杆
        this._rod = new Konva.Line({
            points: [0, 0, 0, 100],
            stroke: '#455a64', strokeWidth: 5, lineCap: 'round'
        });

        // 靶片（圆盘）
        this._plate = new Konva.Ellipse({
            x: 0, y: 100,
            radiusX: 5, radiusY: this._targetR, // 侧面透视效果
            fill: '#37474f', stroke: '#263238', strokeWidth: 1
        });

        this._targetGroup.add(this._rod, this._plate);
        this.group.add(this._targetGroup);
    }

    // ── 电子表头 ──────────────────────────────
    _drawElectronicHead() {
        const hx = this.width / 2 - this._headW / 2;
        const hy = 40;

        const casing = new Konva.Circle({
            x: this.width / 2, y: hy + this._headH / 2,
            radius: 55,
            fill: '#263238', stroke: '#1a2634', strokeWidth: 3
        });

        const cover = new Konva.Circle({
            x: this.width / 2, y: hy + this._headH / 2,
            radius: 45,
            fill: '#37474f', stroke: '#455a64', strokeWidth: 1
        });

        this.group.add(casing, cover);
    }

    // ── LCD 显示屏 ────────────────────────────
    _drawLCD() {
        const cx = this.width / 2;
        const cy = 40 + this._headH / 2;

        const lcdBg = new Konva.Rect({
            x: cx - 35, y: cy - 20, width: 70, height: 40,
            fill: '#90a4ae', stroke: '#263238', strokeWidth: 1, cornerRadius: 2
        });

        this._lcdVal = new Konva.Text({
            x: cx - 35, y: cy - 10, width: 70,
            text: '0.0', fontSize: 16, fontStyle: 'bold', fill: '#1a2634', align: 'center', fontFamily: 'Digital-7'
        });

        this._lcdUnit = new Konva.Text({
            x: cx - 35, y: cy + 12, width: 70,
            text: this.unit, fontSize: 8, fill: '#37474f', align: 'center'
        });

        this.group.add(lcdBg, this._lcdVal, this._lcdUnit);
    }

    // ── 仿真逻辑 ──────────────────────────────
    _startAnimation() {
        const tick = () => {
            this._updatePhysics();
            this._updateVisuals();
            this._animId = requestAnimationFrame(tick);
        };
        this._animId = requestAnimationFrame(tick);
    }

    _updatePhysics() {
        // 1. 模拟阻尼平滑
        this.dispFlow += (this.currentFlow - this.dispFlow) * 0.1;

        // 2. 计算输出电流 (4-20mA) 
        // 注意：靶式流量计受力与流速平方成正比，通常内部会开方处理以获得线性输出
        const ratio = Math.min(1, this.dispFlow / this.maxFlow);
        this.outCurrent = this.isPowered ? (4 + ratio * 16) : 0;

        // 3. 计算靶片摆动角度 (模拟机械受力变形)
        // 角度 = K * v^2
        this.targetForce = Math.pow(ratio, 2) * 15; 
    }

    _updateVisuals() {
        // 靶片随流量增大而向右微偏
        this._targetGroup.rotation(-this.targetForce);

        // LCD 更新
        if (this.isPowered) {
            this._lcdVal.text(this.dispFlow.toFixed(1));
            this._lcdVal.fill('#1a2634');
        } else {
            this._lcdVal.text('OFF');
            this._lcdVal.fill('#546e7a');
        }

        this._refreshCache();
    }

    // ── 外部求解器接口 ────────────────────────
    /**
     * @param {number} flow 流量输入
     * @param {boolean} power 电源状态判定 (由电路求解器传入)
     */
    update(press, flow, level) {
        this.currentFlow = flow || 0;
        
        // 检查电源端口电压 (简单示例逻辑)
        const v = this.getVoltageAtPort?.('p'); 
        this.isPowered = v > 12;
    }

    getConfigFields() {
        return [
            { label: '位号', key: 'id', type: 'text' },
            { label: '满量程 (m³/h)', key: 'maxFlow', type: 'number' },
            { label: '靶片直径 (mm)', key: 'targetSize', type: 'number' }
        ];
    }

    onConfigUpdate(cfg) {
        this.maxFlow = parseFloat(cfg.maxFlow) || this.maxFlow;
        this.id = cfg.id || this.id;
    }

    destroy() {
        if (this._animId) cancelAnimationFrame(this._animId);
        super.destroy?.();
    }
}