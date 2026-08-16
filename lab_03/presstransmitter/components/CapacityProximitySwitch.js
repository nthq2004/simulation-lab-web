import { BaseComponent } from './BaseComponent.js';

/**
 * 电容式接近开关仿真组件 (Capacitive Proximity Switch)
 *
 * ── 测量原理 ────────────────────────────────────────────────
 * 感应面与大地/目标物构成电容。目标物靠近 -> 介电常数改变 -> 电容 C 增加
 * 内部电路检测电容变化并触发输出切换。
 * * ── 端口 ───────────────────────────────────────────────────
 * wire_vcc — 电源正 (12-24VDC)
 * wire_gnd — 电源负 (0V)
 * wire_out — 输出信号 (NPN/PNP)
 */
export class CapacitiveProximitySwitch extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.width = 240;
        this.height = 180;

        this.type = 'capacitive_proximity_switch';
        this.cache = 'fixed';

        // ── 开关参数 ──
        this.sensingDistance = config.sensingDistance || 20; // 额定感应距离 (mm)
        this.hysteresis = config.hysteresis || 2;           // 回差 (mm)
        this.outputType = config.outputType || 'PNP';       // 输出类型

        // ── 状态 ──
        this.targetDist = 100;    // 目标物距离感应面的实时距离 (mm)
        this.isTriggered = false; // 是否触发
        this.powered = false;
        
        // ── 几何布局 ──
        this._bodyW = 120;
        this._bodyH = 40;
        this._centerX = 80;
        this._centerY = this.height / 2;

        this._init();

        // 端口设置：模拟三线制输出
        this.addPort(20, this._centerY - 20, 'vcc', 'wire', 'BN(V+)');
        this.addPort(20, this._centerY,      'out', 'wire', 'BK(OUT)');
        this.addPort(20, this._centerY + 20, 'gnd', 'wire', 'BU(0V)');
    }

    _init() {
        this._drawLabel();
        this._drawBody();        // 绘制开关外壳
        this._drawSensingField(); // 绘制感应电场示意
        this._drawIndicator();    // 绘制尾部指示灯
        this._startAnimation();
    }

    _drawLabel() {
        this.group.add(new Konva.Text({
            x: 0, y: 10, width: this.width,
            text: '电容式接近开关',
            fontSize: 14, fontStyle: 'bold', fill: '#2c3e50', align: 'center',
        }));
    }

    // ── 开关主体（圆柱形金属壳） ────────────────
    _drawBody() {
        const body = new Konva.Rect({
            x: this._centerX, y: this._centerY - this._bodyH / 2,
            width: this._bodyW, height: this._bodyH,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint: { x: 0, y: this._bodyH },
            fillLinearGradientColorStops: [0, '#90a4ae', 0.5, '#eceff1', 1, '#546e7a'],
            stroke: '#455a64', strokeWidth: 1, cornerRadius: [0, 2, 2, 0]
        });

        // 螺纹装饰
        for(let i=1; i<10; i++) {
            this.group.add(new Konva.Line({
                points: [this._centerX + i*10, this._centerY - 20, this._centerX + i*10, this._centerY + 20],
                stroke: 'rgba(0,0,0,0.1)', strokeWidth: 1
            }));
        }

        // 感应端面（塑料部分）
        const face = new Konva.Rect({
            x: this._centerX + this._bodyW, y: this._centerY - 20,
            width: 8, height: 40,
            fill: '#37474f', cornerRadius: [0, 4, 4, 0]
        });

        this.group.add(body, face);
    }

    // ── 感应电场示意 ──────────────────────────
    _drawSensingField() {
        this._fieldGroup = new Konva.Group({ x: this._centerX + this._bodyW + 5, y: this._centerY });
        
        // 绘制三道圆弧模拟静电场
        for(let i=1; i<=3; i++) {
            const arc = new Konva.Arc({
                innerRadius: i * 8, outerRadius: i * 8 + 1,
                angle: 120, rotation: -60,
                fill: '#00bcd4', stroke: '#00bcd4', strokeWidth: 1,
                opacity: 0.5 / i
            });
            this._fieldGroup.add(arc);
        }
        this.group.add(this._fieldGroup);
    }

    // ── 尾部状态指示灯 ────────────────────────
    _drawIndicator() {
        this._led = new Konva.Circle({
            x: this._centerX + 10, y: this._centerY,
            radius: 4, fill: '#1a2634', stroke: '#000', strokeWidth: 0.5
        });
        this.group.add(this._led);
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
        // 电压检测 (通常 10V 以上工作)
        const vcc = this.getVoltageAtPort?.('vcc') || 0;
        const gnd = this.getVoltageAtPort?.('gnd') || 0;
        this.powered = (vcc - gnd) > 10;

        // 目标物距离检测逻辑（带回差控制）
        if (!this.isTriggered && this.targetDist <= this.sensingDistance) {
            this.isTriggered = true;
        } else if (this.isTriggered && this.targetDist > (this.sensingDistance + this.hysteresis)) {
            this.isTriggered = false;
        }
    }

    _updateVisuals() {
        if (!this.powered) {
            this._led.fill('#1a2634');
            this._fieldGroup.visible(false);
            return;
        }

        this._fieldGroup.visible(true);
        // 触发时指示灯亮红色/橙色，电场增强显示
        if (this.isTriggered) {
            this._led.fill('#ff5252'); // 动作指示灯
            this._fieldGroup.scale({ x: 1.2, y: 1.2 });
            this._fieldGroup.opacity(1);
        } else {
            this._led.fill('#2e7d32'); // 电源指示灯（绿色）
            this._fieldGroup.scale({ x: 1, y: 1 });
            this._fieldGroup.opacity(0.4);
        }

        // 模拟电场微弱波动
        const s = 1 + Math.sin(Date.now() / 200) * 0.05;
        this._fieldGroup.scaleX(this._fieldGroup.scaleX() * s);

        this._refreshCache();
    }

    // ── 外部接口 ──────────────────────────────
    /**
     * @param {number} dist 目标物体距离感应面的距离 (mm)
     */
    update(press, flow, level, vib, vel, dist) {
        // 接收环境中目标物的距离输入
        if (typeof dist === 'number') {
            this.targetDist = dist;
        }
    }

    /**
     * 电路输出逻辑
     * PNP: 触发时 OUT 接通 VCC
     * NPN: 触发时 OUT 接通 GND
     */
    getInternalConnections() {
        if (!this.isTriggered || !this.powered) return [];
        
        return this.outputType === 'PNP' 
            ? [{ from: 'vcc', to: 'out' }] 
            : [{ from: 'gnd', to: 'out' }];
    }

    getConfigFields() {
        return [
            { label: '位号', key: 'id', type: 'text' },
            { label: '感应距离 (mm)', key: 'sensingDistance', type: 'number' },
            { label: '回差 (mm)', key: 'hysteresis', type: 'number' },
            { label: '输出逻辑', key: 'outputType', type: 'select', options: [
                { label: 'PNP (高电平)', value: 'PNP' },
                { label: 'NPN (低电平)', value: 'NPN' }
            ]}
        ];
    }

    onConfigUpdate(cfg) {
        this.sensingDistance = parseFloat(cfg.sensingDistance) || this.sensingDistance;
        this.outputType = cfg.outputType || this.outputType;
        this.id = cfg.id || this.id;
    }

    destroy() {
        if (this._animId) cancelAnimationFrame(this._animId);
        super.destroy?.();
    }
}