import { BaseComponent } from './BaseComponent.js';

/**
 * 磁脉冲式转速传感器（双通道正交输出）
 *
 * ── 工作原理 ─────────────────────────────────────────────
 *  齿轮（磁性材料）旋转时，安装于齿顶附近的磁敏传感器感受到
 *  磁场周期性变化，输出方波脉冲。
 *
 *  双传感器安装：
 *    传感器 1（CH-A）位于传感器 2（CH-B）的靠前位置，
 *    两者间距等于 1/4 齿距，从而输出信号相差 1/4 周期（90°相位差）。
 *
 *  正转（A 超前 B）：CH-A 上升沿早于 CH-B 上升沿 1/4 周期
 *  反转（B 超前 A）：CH-B 上升沿早于 CH-A 上升沿 1/4 周期
 *
 *  转速计算：
 *    n (rpm) = (f × 60) / Z
 *    f  — 脉冲频率 (Hz)
 *    Z  — 齿数
 *
 *  输出：
 *    wire_a  — CH-A 方波（0/5V TTL，或 NPN 集电极开路）
 *    wire_b  — CH-B 方波（超前/滞后 A 90°）
 *    wire_p  — 电源正 5-24VDC
 *    wire_n  — 电源负 GND
 *
 * ── 与气路求解器扩展 ──────────────────────────────────────
 *  本组件不参与气路，特型为 special='none'，
 *  但可与电气仿真系统联动：
 *    - sys 中绑定目标轴（如气动马达）时，自动读取其 rpm
 *    - 独立运行时，可拖拽调速旋钮手动设定转速
 *
 * ── 组件外观 ──────────────────────────────────────────────
 *  参照实物图：两个黄铜色六角传感器头并排指向齿轮外缘，
 *  齿轮绘制在组件左侧，右侧为电气接线盒+双通道方波显示屏。
 */
export class MagneticSpeedSensor extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.width  = Math.max(240, config.width  || 280);
        this.height = Math.max(200, config.height || 240);

        // ── 类型标识 ──
        this.type    = 'mag_speed_sensor';
        this.special = 'none';
        this.cache   = 'fixed';

        // ── 传感器参数 ──
        this.toothCount  = config.toothCount  || 60;    // 齿数 Z
        this.targetId    = config.targetId    || null;  // 绑定轴组件 ID（如气动马达）
        this.maxRpm      = config.maxRpm      || 3000;  // 量程上限 rpm
        this.phaseDeg    = 90;                           // CH-A 超前 CH-B 的相位度数（固定 90°）
        this.outputLevel = config.outputLevel || 5;     // 输出电平 V

        // ── 运行状态 ──
        this.rpm         = 0;         // 当前转速 rpm（从绑定轴读取或手动设定）
        this.direction   = 1;         // 1 = 正转，-1 = 反转
        this.isBreak     = false;
        this.powered     = false;

        // ── 信号状态 ──
        this.chA         = 0;         // CH-A 当前电平 0/1
        this.chB         = 0;         // CH-B 当前电平 0/1
        this._phase      = 0;         // 当前相位角 (rad)，随时间累积
        this._pulseFreq  = 0;         // 脉冲频率 Hz

        // ── 波形缓冲区（用于绘制滚动波形）──
        this._waveLen    = 120;       // 波形缓冲区长度（像素对应点数）
        this._waveA      = new Array(this._waveLen).fill(0);
        this._waveB      = new Array(this._waveLen).fill(0);
        this._wavePhase  = 0;         // 波形填充相位（独立计时）

        // ── 齿轮动画 ──
        this._gearAngle  = 0;         // 齿轮当前旋转角度 (rad)
        this._lastTs     = null;
        this._animId     = null;

        // ── 旋钮调速（手动模式）──
        this._manualRpm  = 0;
        this._knobAngle  = 0;

        // 几何布局
        this._gearCX     = this.width * 0.28;
        this._gearCY     = this.height * 0.46;
        this._gearR      = Math.min(this.width, this.height) * 0.24;

        this.config = {
            id: this.id, toothCount: this.toothCount,
            targetId: this.targetId, maxRpm: this.maxRpm,
        };

        this._init();

        // 端口：信号输出在右侧，电源在右上
        const rx = this.width;
        this.addPort(rx, 20,  'p',  'wire', 'V+');
        this.addPort(rx, 46,  'n',  'wire', 'GND');
        this.addPort(rx, 80,  'a',  'wire', 'CH-A');
        this.addPort(rx, 106, 'b',  'wire', 'CH-B');
    }

    // ═══════════════════════════════════════════
    //  初始化
    // ═══════════════════════════════════════════
    _init() {
        this._drawLabel();
        this._drawGear();
        this._drawSensorProbes();
        this._drawJunctionBox();
        this._drawWaveformScreen();
        this._drawSpeedKnob();
        this._drawDirectionSwitch();
        this._startAnimation();
    }

    // ── 标签 ─────────────────────────────────
    _drawLabel() {
        this._labelNode = new Konva.Text({
            x: 0, y: -22, width: this.width,
            text: '磁脉冲转速传感器',
            fontSize: 13, fontStyle: 'bold',
            fill: '#1a2634', align: 'center',
        });
        this.group.add(this._labelNode);
    }

    // ── 齿轮 ─────────────────────────────────
    _drawGear() {
        const cx = this._gearCX, cy = this._gearCY;
        const R  = this._gearR;
        const Z  = this.toothCount;
        const ri = R * 0.72;   // 齿根圆半径
        const ra = R;          // 齿顶圆半径
        const tw = (2 * Math.PI / Z) * 0.42; // 齿宽角

        // 齿轮本体（动态旋转，用 Konva.Group 包裹）
        this._gearGroup = new Konva.Group({ x: cx, y: cy });

        // 外缘发光环（黄绿色，参照图片）
        const glowRing = new Konva.Ring({
            x: 0, y: 0,
            innerRadius: ra + 1,
            outerRadius: ra + 5,
            fill: '#c8e600',
            opacity: 0.7,
        });

        // 齿轮齿形路径
        const pts = [];
        for (let i = 0; i < Z; i++) {
            const a0 = (i / Z) * Math.PI * 2;
            const a1 = a0 + (Math.PI / Z) - tw / 2;
            const a2 = a0 + (Math.PI / Z) + tw / 2;
            const a3 = a0 + (2 * Math.PI / Z);
            // 齿根→齿顶→齿根
            pts.push(ri * Math.cos(a0),     ri * Math.sin(a0));
            pts.push(ra * Math.cos(a1),     ra * Math.sin(a1));
            pts.push(ra * Math.cos(a2),     ra * Math.sin(a2));
            pts.push(ri * Math.cos(a3),     ri * Math.sin(a3));
        }
        const gearBody = new Konva.Line({
            points: pts, closed: true,
            fill: '#8d9aa8', stroke: '#5a6473', strokeWidth: 1.2,
        });

        // 中心轮毂
        const hub = new Konva.Circle({
            radius: R * 0.22,
            fill: '#6b7a8a', stroke: '#4a5568', strokeWidth: 1.5,
        });
        // 轮毂孔
        const hubHole = new Konva.Circle({
            radius: R * 0.10,
            fill: '#3a4557',
        });
        // 辐条（3根）
        for (let i = 0; i < 3; i++) {
            const angle = (i / 3) * Math.PI * 2;
            const spoke = new Konva.Line({
                points: [
                    R * 0.10 * Math.cos(angle), R * 0.10 * Math.sin(angle),
                    R * 0.22 * Math.cos(angle + Math.PI / 6), R * 0.22 * Math.sin(angle + Math.PI / 6),
                ],
                stroke: '#5a6473', strokeWidth: 3, lineCap: 'round',
            });
            this._gearGroup.add(spoke);
        }

        this._gearGroup.add(gearBody, glowRing, hub, hubHole);
        this.group.add(this._gearGroup);
    }

    // ── 传感器探头（两个黄铜色六角头）────────
    _drawSensorProbes() {
        const cx = this._gearCX, cy = this._gearCY;
        const R  = this._gearR;

        // 探头安装位置：齿顶附近，上下间距约 1/4 齿距对应角度
        // 传感器1（CH-A）在上方，传感器2（CH-B）在其下方偏角
        const baseAngle  = -0.30;   // rad，探头朝向（偏右上）
        const probe1Angle = baseAngle - 0.18;  // CH-A（超前）
        const probe2Angle = baseAngle + 0.18;  // CH-B

        const drawProbe = (angle, label, color, isChA) => {
            const gapFromTip = R * 0.15;
            const totalLen   = R * 0.55;

            // 探头中心线（从齿顶向外延伸）
            const x1 = (R + gapFromTip) * Math.cos(angle) + cx;
            const y1 = (R + gapFromTip) * Math.sin(angle) + cy;
            const x2 = (R + gapFromTip + totalLen) * Math.cos(angle) + cx;
            const y2 = (R + gapFromTip + totalLen) * Math.sin(angle) + cy;

            const probeGroup = new Konva.Group();

            // 探头杆（深色）
            probeGroup.add(new Konva.Line({
                points: [x1, y1, x2, y2],
                stroke: '#4a3500', strokeWidth: 6, lineCap: 'round',
            }));
            // 黄铜色外壳
            probeGroup.add(new Konva.Line({
                points: [x1, y1, x2, y2],
                stroke: '#c8960a', strokeWidth: 4, lineCap: 'round',
            }));
            // 探头高光
            probeGroup.add(new Konva.Line({
                points: [x1, y1, x2 * 0.6 + x1 * 0.4, y2 * 0.6 + y1 * 0.4],
                stroke: 'rgba(255,210,80,0.4)', strokeWidth: 2, lineCap: 'round',
            }));

            // 六角外壳节（模拟六角螺母形）
            const hexX = (x1 + x2) / 2, hexY = (y1 + y2) / 2;
            const hexR  = 7;
            const hexPts = [];
            for (let i = 0; i < 6; i++) {
                const ha = angle + (i / 6) * Math.PI * 2 + Math.PI / 6;
                hexPts.push(hexX + hexR * Math.cos(ha), hexY + hexR * Math.sin(ha));
            }
            probeGroup.add(new Konva.Line({
                points: hexPts, closed: true,
                fill: '#8a6500', stroke: '#4a3500', strokeWidth: 1,
            }));

            // 导线从探头尾端引出（弯曲到接线盒）
            const wireColor = isChA ? '#2196F3' : '#4CAF50';
            const wireEndX = this.width * 0.62;
            const wireEndY = isChA ? this.height * 0.32 : this.height * 0.42;
            const ctrlX = x2 + (wireEndX - x2) * 0.4;

            const wire = new Konva.Path({
                data: `M ${x2} ${y2} Q ${ctrlX} ${y2} ${wireEndX} ${wireEndY}`,
                stroke: wireColor, strokeWidth: 2.5, lineCap: 'round',
                fill: 'none',
            });

            // 导线标签
            const wireLbl = new Konva.Text({
                x: wireEndX - 2, y: wireEndY - 10,
                text: `CH-${label}`, fontSize: 8,
                fontStyle: 'bold', fill: wireColor,
            });

            // 活跃指示灯（探头尖端）
            const ledName = isChA ? '_ledA' : '_ledB';
            const led = new Konva.Circle({
                x: x1 + (R * 0.05) * Math.cos(angle),
                y: y1 + (R * 0.05) * Math.sin(angle),
                radius: 3.5,
                fill: '#333', stroke: '#222', strokeWidth: 0.5,
            });
            this[ledName] = led;

            probeGroup.add(wire, wireLbl, led);
            this.group.add(probeGroup);
        };

        drawProbe(probe1Angle, 'A', '#2196F3', true);
        drawProbe(probe2Angle, 'B', '#4CAF50', false);
    }

    // ── 接线盒 ───────────────────────────────
    _drawJunctionBox() {
        const bx = this.width * 0.62, by = 6;
        const bw = this.width - bx - 6;
        const bh = this.height * 0.55;
        this._jbX = bx; this._jbY = by;
        this._jbW = bw; this._jbH = bh;

        // 盒体
        const body = new Konva.Rect({
            x: bx, y: by, width: bw, height: bh,
            fill: '#2c3e50', stroke: '#1a2634', strokeWidth: 1.5, cornerRadius: 5,
        });
        const sheen = new Konva.Rect({
            x: bx+2, y: by+2, width: 6, height: bh-4,
            fill: 'rgba(255,255,255,0.05)', cornerRadius: 2,
        });
        // 铭牌
        const plate = new Konva.Rect({
            x: bx+8, y: by+8, width: bw-16, height: 22,
            fill: '#f5f0e0', stroke: '#c8b870', strokeWidth: 0.5, cornerRadius: 2,
        });
        this._idText = new Konva.Text({
            x: bx+8, y: by+10, width: bw-16,
            text: this.id || 'SS-001',
            fontSize: 9, fontStyle: 'bold', fill: '#2c3e50', align: 'center',
        });
        const typeText = new Konva.Text({
            x: bx+8, y: by+19, width: bw-16,
            text: `Z=${this.toothCount}T  2CH`,
            fontSize: 7.5, fill: '#7f6f30', align: 'center',
        });

        // 端子标签
        const terminals = [
            { y: by+38, label: 'V+', color: '#e53935' },
            { y: by+52, label: 'GND', color: '#546e7a' },
            { y: by+66, label: 'CH-A', color: '#2196F3' },
            { y: by+80, label: 'CH-B', color: '#4CAF50' },
        ];
        terminals.forEach(t => {
            this.group.add(new Konva.Rect({
                x: bx+4, y: t.y-7, width: bw-8, height: 12,
                fill: 'rgba(255,255,255,0.04)', cornerRadius: 2,
            }));
            this.group.add(new Konva.Text({
                x: bx+6, y: t.y-5, text: t.label,
                fontSize: 9, fontStyle: 'bold', fill: t.color,
            }));
        });

        this.group.add(body, sheen, plate, this._idText, typeText);
    }

    // ── 双通道方波显示屏 ─────────────────────
    _drawWaveformScreen() {
        const sx = 4, sy = this.height * 0.55;
        const sw = this.width - 8;
        const sh = this.height - sy - 4;
        this._scrX = sx; this._scrY = sy;
        this._scrW = sw; this._scrH = sh;

        // 屏幕背景
        const scrBg = new Konva.Rect({
            x: sx, y: sy, width: sw, height: sh,
            fill: '#01080f', stroke: '#1a3a4a', strokeWidth: 1.5, cornerRadius: 4,
        });
        // 屏幕网格
        for (let i = 1; i < 4; i++) {
            this.group.add(new Konva.Line({
                points: [sx, sy + sh*i/4, sx+sw, sy + sh*i/4],
                stroke: 'rgba(100,160,180,0.12)', strokeWidth: 0.5,
            }));
        }
        for (let i = 1; i < 8; i++) {
            this.group.add(new Konva.Line({
                points: [sx + sw*i/8, sy, sx + sw*i/8, sy+sh],
                stroke: 'rgba(100,160,180,0.08)', strokeWidth: 0.5,
            }));
        }

        // CH-A 波形线（蓝色）
        this._waveLineA = new Konva.Line({
            points: [], stroke: '#2196F3', strokeWidth: 1.5,
            lineJoin: 'miter', lineCap: 'square',
        });
        // CH-B 波形线（绿色）
        this._waveLineB = new Konva.Line({
            points: [], stroke: '#4CAF50', strokeWidth: 1.5,
            lineJoin: 'miter', lineCap: 'square',
        });

        // 通道标签
        const lblA = new Konva.Text({
            x: sx+4, y: sy+4, text: 'CH-A',
            fontSize: 8, fontStyle: 'bold', fill: '#2196F3',
        });
        const lblB = new Konva.Text({
            x: sx+4, y: sy + sh/2 + 4, text: 'CH-B',
            fontSize: 8, fontStyle: 'bold', fill: '#4CAF50',
        });

        // 转速 + 频率显示
        this._rpmDisp = new Konva.Text({
            x: sx + sw - 96, y: sy + 4,
            width: 92, text: '0 rpm',
            fontSize: 9, fontFamily: 'Courier New, monospace',
            fontStyle: 'bold', fill: '#ffd54f', align: 'right',
        });
        this._freqDisp = new Konva.Text({
            x: sx + sw - 96, y: sy + 15,
            width: 92, text: '0.0 Hz',
            fontSize: 8, fontFamily: 'Courier New, monospace',
            fill: '#80cbc4', align: 'right',
        });
        // 方向指示
        this._dirDisp = new Konva.Text({
            x: sx + sw - 50, y: sy + sh - 14,
            width: 46, text: '▶ 正转',
            fontSize: 8, fontStyle: 'bold', fill: '#66bb6a', align: 'right',
        });

        this.group.add(scrBg, this._waveLineA, this._waveLineB,
            lblA, lblB, this._rpmDisp, this._freqDisp, this._dirDisp);
    }

    // ── 调速旋钮（手动模式）──────────────────
    _drawSpeedKnob() {
        const kx = this._jbX + this._jbW / 2;
        const ky = this._jbY + this._jbH + 22;
        this._knobCX = kx; this._knobCY = ky;

        const base = new Konva.Circle({
            x: kx, y: ky, radius: 18,
            fill: '#37474f', stroke: '#263238', strokeWidth: 1.5,
        });
        this._knobRotor = new Konva.Group({ x: kx, y: ky });
        this._knobRotor.add(
            new Konva.Circle({ radius: 14, fill: '#546e7a', stroke: '#37474f', strokeWidth: 1 }),
            new Konva.Line({ points: [0, -12, 0, -4], stroke: '#ffd54f', strokeWidth: 3, lineCap: 'round' }),
        );
        const knobLbl = new Konva.Text({
            x: kx - 20, y: ky + 20,
            text: '调速', fontSize: 9, fill: '#78909c', align: 'center', width: 40,
        });

        // 拖拽调速
        this._knobRotor.on('mousedown touchstart', (e) => {
            e.cancelBubble = true;
            const startY = e.evt.clientY ?? e.evt.touches?.[0]?.clientY ?? 0;
            const startAngle = this._knobAngle;
            const onMove = (me) => {
                const cy2 = me.clientY ?? me.touches?.[0]?.clientY ?? 0;
                const delta = (startY - cy2) * 1.8;
                this._knobAngle = Math.max(-150, Math.min(150, startAngle + delta));
                this._knobRotor.rotation(this._knobAngle);
                // 旋钮角度 → 手动转速（-150°~150° 对应 0~maxRpm）
                this._manualRpm = Math.max(0, Math.min(this.maxRpm,
                    ((this._knobAngle + 150) / 300) * this.maxRpm));
            };
            const onUp = () => {
                window.removeEventListener('mousemove', onMove);
                window.removeEventListener('touchmove', onMove);
                window.removeEventListener('mouseup',   onUp);
                window.removeEventListener('touchend',  onUp);
            };
            window.addEventListener('mousemove', onMove);
            window.addEventListener('touchmove', onMove);
            window.addEventListener('mouseup',   onUp);
            window.addEventListener('touchend',  onUp);
        });

        this.group.add(base, this._knobRotor, knobLbl);
    }

    // ── 方向开关 ─────────────────────────────
    _drawDirectionSwitch() {
        const sx = this._jbX + 4;
        const sy = this._jbY + this._jbH + 8;
        const sw = this._jbW - 8;

        const bg = new Konva.Rect({
            x: sx, y: sy, width: sw, height: 16,
            fill: '#263238', stroke: '#37474f', strokeWidth: 0.5, cornerRadius: 3,
        });
        this._dirBtnFwd = new Konva.Rect({
            x: sx+2, y: sy+2, width: sw/2-3, height: 12,
            fill: '#1b5e20', stroke: '#2e7d32', strokeWidth: 0.5, cornerRadius: 2,
        });
        this._dirBtnRev = new Konva.Rect({
            x: sx + sw/2+1, y: sy+2, width: sw/2-3, height: 12,
            fill: '#37474f', stroke: '#546e7a', strokeWidth: 0.5, cornerRadius: 2,
        });
        const fwdLbl = new Konva.Text({ x: sx+2, y: sy+3, width: sw/2-3, text: '正', fontSize: 8, fill: '#66bb6a', align: 'center' });
        const revLbl = new Konva.Text({ x: sx+sw/2+1, y: sy+3, width: sw/2-3, text: '反', fontSize: 8, fill: '#78909c', align: 'center' });

        const hit = new Konva.Rect({ x: sx, y: sy, width: sw, height: 16, fill: 'transparent', listening: true });
        hit.on('click tap', (e) => {
            const pos = e.evt.offsetX ?? e.evt.layerX ?? 0;
            const midX = sx + sw / 2;
            this.direction = pos < midX ? 1 : -1;
            this._updateDirectionSwitch();
        });

        this._dirBtnFwdRef = this._dirBtnFwd;
        this._dirBtnRevRef = this._dirBtnRev;
        this._fwdLblRef    = fwdLbl;
        this._revLblRef    = revLbl;

        this.group.add(bg, this._dirBtnFwd, this._dirBtnRev, fwdLbl, revLbl, hit);
    }

    _updateDirectionSwitch() {
        if (this.direction > 0) {
            this._dirBtnFwdRef.fill('#1b5e20');
            this._dirBtnRevRef.fill('#37474f');
            this._fwdLblRef.fill('#66bb6a');
            this._revLblRef.fill('#78909c');
        } else {
            this._dirBtnFwdRef.fill('#37474f');
            this._dirBtnRevRef.fill('#7f0000');
            this._fwdLblRef.fill('#78909c');
            this._revLblRef.fill('#ef9a9a');
        }
    }

    // ═══════════════════════════════════════════
    //  动画循环
    // ═══════════════════════════════════════════
    _startAnimation() {
        const animate = (ts) => {
            if (this._lastTs !== null) {
                const dt = Math.min((ts - this._lastTs) / 1000, 0.05);
                this._tick(dt);
            }
            this._lastTs = ts;
            this._refreshCache();
            this._animId = requestAnimationFrame(animate);
        };
        this._animId = requestAnimationFrame(animate);
    }

    _stopAnimation() {
        if (this._animId) { cancelAnimationFrame(this._animId); this._animId = null; }
    }

    _tick(dt) {
        // ── 读取转速（优先绑定轴，否则用手动旋钮）──
        let currentRpm = this._manualRpm;
        if (this.targetId && this.sys?.comps?.[this.targetId]) {
            const target = this.sys.comps[this.targetId];
            if (typeof target.rpm === 'number') currentRpm = target.rpm;
        }
        // 断电/故障时静止
        if (!this.powered || this.isBreak) currentRpm = 0;
        this.rpm = currentRpm;

        // ── 脉冲频率 = rpm × Z / 60 ──
        this._pulseFreq = (this.rpm * this.toothCount) / 60;

        // ── 相位累积（rad/s = 2π × f）──
        const omega = 2 * Math.PI * this._pulseFreq * this.direction;
        this._phase += omega * dt;

        // ── 当前电平（方波：相位 0~π 为高，π~2π 为低）──
        const phaseA = this._phase;
        const phaseB = this._phase - (Math.PI / 2) * this.direction; // 滞后 90°
        this.chA = (((phaseA % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) < Math.PI ? 1 : 0;
        this.chB = (((phaseB % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) < Math.PI ? 1 : 0;

        // ── 齿轮旋转 ──
        const gearOmegaDeg = (this.rpm / 60) * 360 * this.direction;
        this._gearAngle += gearOmegaDeg * dt;
        if (this._gearGroup) this._gearGroup.rotation(this._gearAngle);

        // ── 传感器活跃指示灯 ──
        if (this._ledA) this._ledA.fill(this.chA ? '#2196F3' : '#0d2030');
        if (this._ledB) this._ledB.fill(this.chB ? '#4CAF50' : '#0d200d');

        // ── 波形缓冲区滚动（每帧向左移一格）──
        const waveTickRate = this._pulseFreq > 0
            ? Math.min(4, (this._pulseFreq / 5) + 0.5)
            : 0;

        if (waveTickRate > 0 || this.rpm > 0) {
            // 每帧推入当前电平样本
            this._wavePhase += waveTickRate * dt * this._waveLen;
            const steps = Math.floor(this._wavePhase);
            this._wavePhase -= steps;
            for (let i = 0; i < steps; i++) {
                this._waveA.shift(); this._waveA.push(this.chA);
                this._waveB.shift(); this._waveB.push(this.chB);
            }
        }

        // ── 更新波形线 ──
        this._updateWaveform();

        // ── 更新数值显示 ──
        this._updateDisplay();
    }

    _updateWaveform() {
        const sx = this._scrX + 28, sy = this._scrY;
        const sw = this._scrW - 32, sh = this._scrH;
        const midA = sy + sh * 0.22;
        const midB = sy + sh * 0.72;
        const amp  = sh * 0.18;

        const buildPts = (wave, midY) => {
            const pts = [];
            const n   = this._waveLen;
            const dx  = sw / n;
            let prevV = wave[0];
            pts.push(sx, midY + (prevV ? -amp : amp));
            for (let i = 1; i < n; i++) {
                const x = sx + i * dx;
                const v = wave[i];
                const y = midY + (v ? -amp : amp);
                if (v !== prevV) {
                    // 垂直边沿
                    pts.push(x, midY + (prevV ? -amp : amp));
                    pts.push(x, y);
                } else {
                    pts.push(x, y);
                }
                prevV = v;
            }
            return pts;
        };

        if (this._waveLineA) this._waveLineA.points(buildPts(this._waveA, midA));
        if (this._waveLineB) this._waveLineB.points(buildPts(this._waveB, midB));
    }

    _updateDisplay() {
        const rpmStr  = `${Math.round(this.rpm)} rpm`;
        const freqStr = `${this._pulseFreq.toFixed(1)} Hz`;
        const dirStr  = this.direction > 0 ? '▶ 正转' : '◀ 反转';
        const dirCol  = this.direction > 0 ? '#66bb6a' : '#ef9a9a';

        if (this._rpmDisp)  this._rpmDisp.text(rpmStr);
        if (this._freqDisp) this._freqDisp.text(freqStr);
        if (this._dirDisp)  { this._dirDisp.text(dirStr); this._dirDisp.fill(dirCol); }
    }

    // ═══════════════════════════════════════════
    //  气路求解器接口（接受气动马达 rpm 注入）
    // ═══════════════════════════════════════════
    /**
     * 由外部系统调用（非气路求解器），用于注入轴转速。
     * 若配置了 targetId，则从 sys.comps[targetId].rpm 自动读取，
     * 不需要手动调用此方法。
     * @param {number} rpm     当前转速 rpm
     * @param {number} [dir]   方向 1/-1
     */
    update(rpm, dir) {
        if (typeof rpm === 'number') this._manualRpm = rpm;
        if (dir === 1 || dir === -1) this.direction = dir;
    }

    // ═══════════════════════════════════════════
    //  配置面板
    // ═══════════════════════════════════════════
    getConfigFields() {
        return [
            { label: '位号/名称',               key: 'id',          type: 'text'   },
            { label: '齿数 Z',                  key: 'toothCount',  type: 'number' },
            { label: '最大转速 (rpm)',           key: 'maxRpm',      type: 'number' },
            { label: '绑定轴组件 ID',            key: 'targetId',    type: 'text'   },
            { label: '输出电平 (V)',             key: 'outputLevel', type: 'number' },
        ];
    }

    onConfigUpdate(newConfig) {
        this.id          = newConfig.id          || this.id;
        this.toothCount  = parseInt(newConfig.toothCount)  || this.toothCount;
        this.maxRpm      = parseFloat(newConfig.maxRpm)    || this.maxRpm;
        this.targetId    = newConfig.targetId    || null;
        this.outputLevel = parseFloat(newConfig.outputLevel) || this.outputLevel;
        this.config      = { ...this.config, ...newConfig };
        if (this._idText) this._idText.text(this.id);
        this._refreshCache();
    }

    destroy() {
        this._stopAnimation();
        super.destroy?.();
    }
}