import { BaseComponent } from './BaseComponent.js';

/**
 * 气动马达仿真组件
 * 外观参照叶片式气动马达（Vane-type Air Motor）实物图
 * 流量 → 转速，叶片动态旋转，支持气路求解器集成
 */
export class PneumaticMotor extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.width  = Math.max(160, Math.min(config.width  || 180, 240));
        this.height = Math.max(200, Math.min(config.height || 220, 280));

        this.type    = 'pneumaticMotor';
        this.special = 'press';    // 接入气路求解器压力同步
        this.cache   = 'fixed';

        // ── 物理参数 ──
        this.press      = 0;       // 当前输入压力 (MPa)，由求解器注入
        this.flow       = 0;       // 当前流量 (m³/min)，由求解器注入
        this.rpm        = 0;       // 当前转速 (rpm)
        this.targetRpm  = 0;       // 目标转速
        this.isRunning  = false;
        this.isBreak    = false;   // 开路故障

        // 配置参数
        this.maxFlow    = config.maxFlow    || 0.5;   // 额定最大流量 (m³/min)
        this.maxRpm     = config.maxRpm     || 3000;  // 额定最大转速 (rpm)
        this.inertia    = config.inertia    || 0.12;  // 转动惯量系数（0~1，越大越慢响应）
        this.bladeCount = config.bladeCount || 4;     // 叶片数

        this.config = {
            id: this.id,
            maxFlow:    this.maxFlow,
            maxRpm:     this.maxRpm,
            inertia:    this.inertia,
            bladeCount: this.bladeCount,
        };

        // ── 动画状态 ──
        this._rotorAngle   = 0;   // 转子当前角度（度）
        this._animFrameId  = null;
        this._lastTimestamp = null;

        this._init();

        // 气口：进气 (i) 在左侧，出气 (o) 在右侧
        this.addPort(0,   this.height / 2 + 10, 'i', 'pipe', 'in');
        this.addPort(this.width, this.height / 2 + 10, 'o', 'pipe', 'out');
    }

    // ═══════════════════════════════════════
    //  初始化绘制
    // ═══════════════════════════════════════
    _init() {
        this._drawLabel();
        this._drawBody();
        this._drawRotorGroup();
        this._drawPorts();
        this._drawStatusPanel();
        this._startAnimation();
    }

    _drawLabel() {
        const label = new Konva.Text({
            x: 0, y: -22,
            width: this.width,
            text: '气动马达',
            fontSize: 14,
            fontStyle: 'bold',
            fill: '#2c3e50',
            align: 'center',
        });
        this.group.add(label);
    }

    _drawBody() {
        const cx = this.width / 2;
        const cy = this.height / 2;

        // ── 外壳底板（圆形法兰盘，参照实物颜色：银灰色金属）──
        this._bodyFlange = new Konva.Circle({
            x: cx, y: cy - 15,
            radius: 70,
            fill: '#b0b8c1',
            stroke: '#6b7684',
            strokeWidth: 3,
        });

        // 法兰螺孔（8个，均匀分布）
        this._boltHoles = [];
        for (let i = 0; i < 8; i++) {
            const angle = (i / 8) * Math.PI * 2 - Math.PI / 8;
            const bx = cx + Math.cos(angle) * 62;
            const by = (cy - 15) + Math.sin(angle) * 62;
            const hole = new Konva.Circle({
                x: bx, y: by,
                radius: 5,
                fill: '#7f8c8d',
                stroke: '#576574',
                strokeWidth: 1,
            });
            this._boltHoles.push(hole);
        }

        // 外圈高光环（仿金属抛光感）
        this._bodyRing = new Konva.Ring({
            x: cx, y: cy - 15,
            innerRadius: 58,
            outerRadius: 70,
            fill: '#c8d0d8',
            stroke: '#9aabb8',
            strokeWidth: 0.5,
        });

        // 中心轴承座（深色圆，参照实物中心轴孔）
        this._bearingOuter = new Konva.Circle({
            x: cx, y: cy - 15,
            radius: 14,
            fill: '#4a4f5a',
            stroke: '#2c3140',
            strokeWidth: 2,
        });
        this._bearingInner = new Konva.Circle({
            x: cx, y: cy - 15,
            radius: 7,
            fill: '#1a1d24',
            stroke: '#0d0f14',
            strokeWidth: 1,
        });
        // 轴中心高光
        this._bearingGlint = new Konva.Circle({
            x: cx - 2, y: cy - 17,
            radius: 2,
            fill: 'rgba(255,255,255,0.45)',
        });

        this.group.add(
            this._bodyFlange,
            this._bodyRing,
            ...this._boltHoles,
            this._bearingOuter,
            this._bearingInner,
            this._bearingGlint,
        );
    }

    _drawRotorGroup() {
        const cx = this.width / 2;
        const cy = this.height / 2 - 15;

        // 所有旋转元素统一放进 rotorGroup，通过旋转整组实现动画
        this._rotorGroup = new Konva.Group({ x: cx, y: cy });

        // 转子盘（略偏心，模拟叶片式马达偏心转子）
        const rotorDisk = new Konva.Circle({
            x: 0, y: 0,
            radius: 40,
            fill: '#8b4513',  // 棕红色，参照实物叶片颜色
            stroke: '#5c2d0a',
            strokeWidth: 1.5,
        });

        // 叶片（4片，参照实物矩形滑块叶片）
        this._blades = [];
        for (let i = 0; i < this.bladeCount; i++) {
            const angle = (i / this.bladeCount) * Math.PI * 2;
            const bladeGroup = new Konva.Group({
                rotation: (angle * 180) / Math.PI,
            });

            // 叶片槽（深色凹槽）
            const slot = new Konva.Rect({
                x: -4, y: -40,
                width: 8, height: 40,
                fill: '#3d2010',
                cornerRadius: 1,
            });
            // 叶片本体（棕红色矩形，突出于转子表面）
            const blade = new Konva.Rect({
                x: -4, y: -52,
                width: 8, height: 16,
                fill: '#a0522d',
                stroke: '#7a3b1e',
                strokeWidth: 1,
                cornerRadius: 1,
                shadowColor: 'rgba(0,0,0,0.4)',
                shadowBlur: 3,
                shadowOffsetX: 1,
            });
            // 叶片高光
            const bladeGlint = new Konva.Rect({
                x: -1, y: -51,
                width: 2, height: 10,
                fill: 'rgba(255,200,150,0.4)',
                cornerRadius: 1,
            });

            bladeGroup.add(slot, blade, bladeGlint);
            this._blades.push(bladeGroup);
            this._rotorGroup.add(bladeGroup);
        }

        this._rotorGroup.add(rotorDisk);

        // 转子中心十字加强筋（参照实物）
        const ribH = new Konva.Rect({ x: -22, y: -4, width: 44, height: 8, fill: '#6b3510', cornerRadius: 2 });
        const ribV = new Konva.Rect({ x: -4, y: -22, width: 8, height: 44, fill: '#6b3510', cornerRadius: 2 });
        const ribCenter = new Konva.Circle({ radius: 8, fill: '#4a2508' });
        this._rotorGroup.add(ribH, ribV, ribCenter);

        // 轴（重叠在 body 轴承上方）
        const shaft = new Konva.Circle({ radius: 6, fill: '#1a1d24' });
        const shaftGlint = new Konva.Circle({ x: -1.5, y: -1.5, radius: 1.5, fill: 'rgba(255,255,255,0.5)' });
        this._rotorGroup.add(shaft, shaftGlint);

        this.group.add(this._rotorGroup);
    }

    _drawPorts() {
        const cx  = this.width / 2;
        const cy  = this.height / 2 - 15;
        const pY  = cy + 10;

        // 进气口接头（左侧）
        const inFitting = new Konva.Group({ x: 0, y: pY });
        inFitting.add(
            new Konva.Rect({ x: 0, y: -8, width: 18, height: 16, fill: '#ced6e0', stroke: '#747d8c', cornerRadius: 2 }),
            new Konva.Text({ x: 2, y: -5, text: 'IN', fontSize: 9, fill: '#2f3542', fontStyle: 'bold' }),
        );

        // 出气口接头（右侧）
        const outFitting = new Konva.Group({ x: this.width - 18, y: pY });
        outFitting.add(
            new Konva.Rect({ x: 0, y: -8, width: 18, height: 16, fill: '#ced6e0', stroke: '#747d8c', cornerRadius: 2 }),
            new Konva.Text({ x: 1, y: -5, text: 'OUT', fontSize: 9, fill: '#2f3542', fontStyle: 'bold' }),
        );

        this.group.add(inFitting, outFitting);
    }

    _drawStatusPanel() {
        const panelY = this.height - 42;

        // 底部状态面板
        const panelBg = new Konva.Rect({
            x: 8, y: panelY,
            width: this.width - 16, height: 38,
            fill: '#1a1d24',
            stroke: '#3d4350',
            strokeWidth: 1,
            cornerRadius: 4,
        });

        // 转速显示
        this._rpmText = new Konva.Text({
            x: 12, y: panelY + 5,
            width: this.width - 24,
            text: '0 rpm',
            fontSize: 16,
            fontFamily: 'Courier New, monospace',
            fontStyle: 'bold',
            fill: '#00e676',
            align: 'center',
        });

        // 状态指示文字
        this._statusText = new Konva.Text({
            x: 12, y: panelY + 23,
            width: this.width - 24,
            text: '● 停止',
            fontSize: 10,
            fill: '#ef5350',
            align: 'center',
        });

        // 运行状态指示灯
        this._statusLed = new Konva.Circle({
            x: 20, y: panelY + 28,
            radius: 4,
            fill: '#ef5350',
        });

        this.group.add(panelBg, this._rpmText, this._statusText, this._statusLed);
    }

    // ═══════════════════════════════════════
    //  动画驱动
    // ═══════════════════════════════════════
    _startAnimation() {
        const tick = (timestamp) => {
            if (this._lastTimestamp !== null) {
                const dt = (timestamp - this._lastTimestamp) / 1000; // 秒

                // 惯量平滑：目标转速由流量决定，实际转速向目标逼近
                const alpha = 1 - Math.pow(this.inertia, dt * 10);
                this.rpm += (this.targetRpm - this.rpm) * alpha;

                // 角速度（度/帧）：rpm → 度/秒 → 度/帧
                const degreesPerSec = (this.rpm / 60) * 360;
                this._rotorAngle += degreesPerSec * dt;

                // 更新 Konva 旋转
                if (this._rotorGroup) {
                    this._rotorGroup.rotation(this._rotorAngle % 360);
                }

                // 每帧同步 UI（仅在变化明显时触发 batchDraw，减少 CPU 占用）
                if (Math.abs(this.rpm - this._lastDisplayRpm) > 5 || this.rpm < 5) {
                    this._updateDisplay();
                    this._lastDisplayRpm = this.rpm;
                }

                // 转子颜色随转速变化（模拟摩擦热）
                if (this._rotorGroup && this.rpm > 100) {
                    const heat = Math.min(1, this.rpm / this.maxRpm);
                    const r = Math.round(139 + heat * 60);
                    const g = Math.round(69  - heat * 40);
                    // 仅在明显变化时更新颜色
                }
            }
            this._lastTimestamp = timestamp;
            this._animFrameId = requestAnimationFrame(tick);
        };

        this._animFrameId = requestAnimationFrame(tick);
    }

    _stopAnimation() {
        if (this._animFrameId) {
            cancelAnimationFrame(this._animFrameId);
            this._animFrameId = null;
        }
    }

    _updateDisplay() {
        const rpmDisplay = Math.round(this.rpm);

        this._rpmText.text(`${rpmDisplay} rpm`);

        if (this.isBreak) {
            this._rpmText.fill('#ff6b6b');
            this._statusText.text('⚠ 故障');
            this._statusLed.fill('#ff6b6b');
        } else if (rpmDisplay > 0) {
            // 转速档位颜色
            const ratio = rpmDisplay / this.maxRpm;
            if (ratio > 0.85) {
                this._rpmText.fill('#ff9800');
                this._statusText.text('▶ 高速');
                this._statusLed.fill('#ff9800');
            } else if (ratio > 0.3) {
                this._rpmText.fill('#00e676');
                this._statusText.text('▶ 运行中');
                this._statusLed.fill('#00e676');
            } else {
                this._rpmText.fill('#64ffda');
                this._statusText.text('▶ 低速');
                this._statusLed.fill('#64ffda');
            }
        } else {
            this._rpmText.fill('#546e7a');
            this._statusText.text('● 停止');
            this._statusLed.fill('#ef5350');
        }

        this._refreshCache();
    }

    // ═══════════════════════════════════════
    //  气路求解器接口
    // ═══════════════════════════════════════
    /**
     * 由气路求解器调用
     * @param {number} press  - 输入端口压力 (MPa)
     * @param {number} flow   - 流经该设备的流量 (m³/min)，来自 segmentFlows
     */
    update(press, flow) {
        this.press = press || 0;
        this.flow  = (typeof flow === 'number') ? flow : 0;

        if (this.isBreak) {
            this.targetRpm = 0;
            this._updateDisplay();
            return;
        }

        // 核心物理模型：流量线性映射到转速
        // targetRpm = (flow / maxFlow) * maxRpm，超出额定流量按额定计
        const flowRatio    = Math.min(1, Math.max(0, this.flow / this.maxFlow));
        this.targetRpm     = flowRatio * this.maxRpm;
        this.isRunning     = this.targetRpm > 0;
    }

    // ═══════════════════════════════════════
    //  配置面板
    // ═══════════════════════════════════════
    getConfigFields() {
        return [
            { label: '位号/名称',         key: 'id',         type: 'text'   },
            { label: '额定最大流量 (m³/min)', key: 'maxFlow', type: 'number' },
            { label: '额定最大转速 (rpm)',    key: 'maxRpm',  type: 'number' },
            { label: '转动惯量系数 (0~1)',    key: 'inertia', type: 'number' },
        ];
    }

    onConfigUpdate(newConfig) {
        this.id       = newConfig.id       || this.id;
        this.maxFlow  = parseFloat(newConfig.maxFlow)  || this.maxFlow;
        this.maxRpm   = parseFloat(newConfig.maxRpm)   || this.maxRpm;
        this.inertia  = parseFloat(newConfig.inertia)  || this.inertia;
        this.config   = { ...this.config, ...newConfig };
    }

    /**
     * 销毁时停止动画，避免内存泄漏
     */
    destroy() {
        this._stopAnimation();
        super.destroy?.();
    }
}