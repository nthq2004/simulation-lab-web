import { BaseComponent } from './BaseComponent.js';

/**
 * 电感式接近开关仿真组件 (Inductive Proximity Switch)
 * * ── 测量原理 ────────────────────────────────────────────────
 * LC振荡器产生交变磁场 -> 金属目标靠近 -> 产生涡流损耗 -> 
 * 振荡衰减 -> 触发电路输出
 * * ── 端口 ───────────────────────────────────────────────────
 * wire_vcc — 电源正 (10-30VDC)
 * wire_gnd — 电源负 (0V)
 * wire_out — 输出信号 (NPN/PNP)
 */
export class InductiveProximitySwitch extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.width = 240;
        this.height = 180;

        this.type = 'inductive_proximity_switch';
        this.cache = 'fixed';

        // ── 开关参数 ──
        this.sn = config.sn || 8;           // 额定感应距离 (mm)
        this.hysteresis = config.hysteresis || 0.8; // 回差 (mm)
        this.outputType = config.outputType || 'PNP'; // NPN 或 PNP
        this.targetMaterial = 'ferrous';     // 目标材质影响系数 (铁为1)

        // ── 状态 ──
        this.targetDist = 50;     // 实时距离 (mm)
        this.isTriggered = false; // 是否动作
        this.powered = false;
        
        // ── 几何布局 ──
        this._bodyW = 110;
        this._bodyH = 36;
        this._centerX = 80;
        this._centerY = this.height / 2;

        this._init();

        // 端口：标准工业颜色编码
        this.addPort(20, this._centerY - 20, 'vcc', 'wire', 'BN(L+)');
        this.addPort(20, this._centerY,      'out', 'wire', 'BK(OUT)');
        this.addPort(20, this._centerY + 20, 'gnd', 'wire', 'BU(L-)');
    }

    _init() {
        this._drawLabel();
        this._drawBody();        // 绘制不锈钢外壳
        this._drawCoil();        // 内部线圈示意
        this._drawMagneticField(); // 绘制交变磁场动画
        this._drawLED();         // 尾部动作指示灯
        this._startAnimation();
    }

    _drawLabel() {
        this.group.add(new Konva.Text({
            x: 0, y: 10, width: this.width,
            text: '电感式接近开关 (涡流损耗型)',
            fontSize: 14, fontStyle: 'bold', fill: '#2c3e50', align: 'center',
        }));
    }

    // ── 机械外壳 ────────────────────────────
    _drawBody() {
        const body = new Konva.Rect({
            x: this._centerX, y: this._centerY - this._bodyH / 2,
            width: this._bodyW, height: this._bodyH,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint: { x: 0, y: this._bodyH },
            fillLinearGradientColorStops: [0, '#b0bec5', 0.5, '#f5f5f5', 1, '#78909c'],
            stroke: '#455a64', strokeWidth: 1.5, cornerRadius: [0, 2, 2, 0]
        });

        // 感应面（通常为塑料，蓝色或绿色代表电感式）
        this._face = new Konva.Rect({
            x: this._centerX + this._bodyW, y: this._centerY - 18,
            width: 10, height: 36,
            fill: '#0277bd', cornerRadius: [0, 5, 5, 0]
        });

        this.group.add(body, this._face);
    }

    // ── 内部 LC 线圈 ─────────────────────────
    _drawCoil() {
        this._coilGroup = new Konva.Group({ x: this._centerX + this._bodyW - 20, y: this._centerY });
        
        // 绘制磁芯
        const core = new Konva.Rect({
            x: 0, y: -10, width: 15, height: 20,
            fill: '#37474f', cornerRadius: 2
        });

        // 绘制绕线示意
        for(let i=0; i<4; i++) {
            this._coilGroup.add(new Konva.Line({
                points: [i*4, -10, i*4, 10],
                stroke: '#fb8c00', strokeWidth: 2
            }));
        }
        this._coilGroup.add(core);
        this.group.add(this._coilGroup);
    }

    // ── 交变磁场视觉效果 ─────────────────────
    _drawMagneticField() {
        this._field = new Konva.Group({ x: this._centerX + this._bodyW + 10, y: this._centerY });
        
        for(let i=1; i<=3; i++) {
            const circle = new Konva.Ellipse({
                radiusX: i * 10, radiusY: i * 15,
                stroke: '#4fc3f7', strokeWidth: 1.5,
                opacity: 0.6 / i,
                dash: [5, 5]
            });
            this._field.add(circle);
        }
        this.group.add(this._field);
    }

    _drawLED() {
        this._led = new Konva.Circle({
            x: this._centerX + 15, y: this._centerY,
            radius: 4, fill: '#1a2634', stroke: '#000', strokeWidth: 0.5
        });
        this.group.add(this._led);
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
        const vcc = this.getVoltageAtPort?.('vcc') || 0;
        this.powered = vcc > 10;

        // 逻辑控制（带回差）
        // 如果物体不是金属（这里假设环境会传入材质属性），感应距离会大幅衰减
        const effectiveSn = this.sn * (this.isMetalTarget ? 1.0 : 0.05);

        if (!this.isTriggered && this.targetDist <= effectiveSn) {
            this.isTriggered = true;
        } else if (this.isTriggered && this.targetDist > (effectiveSn + this.hysteresis)) {
            this.isTriggered = false;
        }
    }

    _updateVisuals() {
        if (!this.powered) {
            this._led.fill('#1a2634');
            this._field.visible(false);
            return;
        }

        this._field.visible(true);
        
        // 磁场“呼吸”动画，模拟交变电流
        const phase = Date.now() / 150;
        const s = 1 + Math.sin(phase) * 0.1;
        this._field.scale({ x: s, y: s });

        if (this.isTriggered) {
            this._led.fill('#ffeb3b'); // 动作指示灯（通常为黄色）
            this._field.opacity(0.2);  // 能量被吸收，磁场减弱
            this._face.fill('#01579b');
        } else {
            this._led.fill('#1a2634');
            this._field.opacity(1);
            this._face.fill('#0277bd');
        }

        this._refreshCache();
    }

    // ── 外部接口 ──────────────────────────────
    /**
     * @param {number} dist 距离
     * @param {boolean} isMetal 是否为金属目标 (由仿真环境射线检测得出)
     */
    update(press, flow, level, vib, vel, dist, isMetal) {
        this.targetDist = dist ?? 100;
        this.isMetalTarget = isMetal ?? true; // 默认为金属
    }

    getInternalConnections() {
        if (!this.isTriggered || !this.powered) return [];
        // 根据 PNP/NPN 类型返回连接关系
        return this.outputType === 'PNP' 
            ? [{ from: 'vcc', to: 'out' }] 
            : [{ from: 'gnd', to: 'out' }];
    }

    getConfigFields() {
        return [
            { label: '位号', key: 'id', type: 'text' },
            { label: '感应距离 Sn(mm)', key: 'sn', type: 'number' },
            { label: '逻辑', key: 'outputType', type: 'select', options: [
                { label: 'PNP', value: 'PNP' },
                { label: 'NPN', value: 'NPN' }
            ]}
        ];
    }

    onConfigUpdate(cfg) {
        this.sn = parseFloat(cfg.sn) || this.sn;
        this.outputType = cfg.outputType || this.outputType;
        this.id = cfg.id || this.id;
    }

    destroy() {
        if (this._animId) cancelAnimationFrame(this._animId);
        super.destroy?.();
    }
}