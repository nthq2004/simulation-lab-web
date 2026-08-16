import { BaseComponent } from './BaseComponent.js';

/**
 * 锅炉水位双位控制系统仿真组件
 * （Boiler Water Level Two-Position Control System）
 *
 * ── 系统组成 ──────────────────────────────────────────────────
 *
 *  [电机+水泵] ─── 供水管 ──→ [锅炉] ←── 连通管 ──→ [浮子室]
 *                                                      │
 *                                          [浮子室内部完整机构]
 *                                          ├─ 浮子（随水位升降）
 *                                          ├─ 扇形调节板（连杆驱动旋转）
 *                                          ├─ 同极性永久磁铁（斥力机构）
 *                                          └─ 干簧管开关（接通/断开）
 *                                                      │
 *                                          [两路电气输出接点]
 *                                          ├─ 常开接点（高水位断开）
 *                                          └─ 常闭接点（低水位断开）
 *
 * ── 双位控制原理 ──────────────────────────────────────────────
 *
 *  控制逻辑：
 *    水位 ≤ 下限（低水位）→ 水泵启动，补水
 *    水位 ≥ 上限（高水位）→ 水泵停止
 *
 *  迟滞区间（Hysteresis）：
 *    H_low  — 低水位控制线（启泵）
 *    H_high — 高水位控制线（停泵）
 *    迟滞 = H_high - H_low
 *
 * ── 浮子室机构详解 ────────────────────────────────────────────
 *
 *  1. 浮子（Float Ball）：
 *     空心金属球，随水位浮动，通过连杆传递运动
 *
 *  2. 扇形调节板（Sector Plate / Cam）：
 *     以铰接点为轴，由连杆带动旋转；
 *     扇形端部装有永久磁铁（磁块A），
 *     随水位高低控制磁铁位置
 *
 *  3. 同极性永久磁铁（Same-Polarity Magnets）：
 *     扇形板磁铁（磁块A）与开关臂磁铁（磁块B）同极相对；
 *     当水位低时：A远离B → 斥力小 → 开关臂弹回，干簧管导通
 *     当水位高时：A靠近B → 同极斥力大 → 开关臂被推开，干簧管断开
 *
 *  4. 干簧管开关（Reed Switch）：
 *     密封在惰性气体中的磁敏弹片开关；
 *     弹片被磁场吸合/推开，输出开关量信号
 *
 * ── 工作流程 ──────────────────────────────────────────────────
 *
 *  水位下降 → 浮子下降 → 扇形板顺时针转 → 磁块A远离磁块B
 *  → 斥力减小 → 弹片复位 → 干簧管闭合 → 接点输出 → 水泵启动
 *
 *  水位上升 → 浮子上升 → 扇形板逆时针转 → 磁块A靠近磁块B
 *  → 同极斥力增大 → 弹片弯曲 → 干簧管断开 → 接点断开 → 水泵停止
 *
 * ── 端口 ─────────────────────────────────────────────────────
 *  pipe_water_in  — 水泵出口→锅炉进水
 *  pipe_steam_out — 锅炉蒸汽出口（上部）
 *  wire_no        — 常开接点 (Normally Open)
 *  wire_nc        — 常闭接点 (Normally Closed)
 *  wire_com       — 公共端 (Common)
 *  wire_pump_u    — 水泵电机 U 相
 *  wire_pump_v    — 水泵电机 V 相
 */
export class BoilerWaterLevelTwoPositionControl extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.width  = Math.max(580, config.width  || 660);
        this.height = Math.max(360, config.height || 420);

        this.type    = 'boiler_2pos_control';
        this.special = 'none';
        this.cache   = 'fixed';

        // ── 系统参数 ──
        this.boilerCapacity  = config.boilerCapacity  || 100;   // 锅炉容积 L
        this.highWaterLine   = config.highWaterLine   || 75;    // 高水位线 %（停泵）
        this.lowWaterLine    = config.lowWaterLine    || 35;    // 低水位线 %（启泵）
        this.pumpFlowRate    = config.pumpFlowRate    || 8;     // 水泵流量 L/min
        this.steamConsume    = config.steamConsume    || 3;     // 蒸发量 L/min（模拟消耗）
        this.dangerHigh      = config.dangerHigh      || 92;    // 危险高水位 %
        this.dangerLow       = config.dangerLow       || 15;    // 危险低水位 %

        // ── 状态 ──
        this.waterLevel      = config.initLevel       || 55;    // %（0~100）
        this._displayLevel   = config.initLevel       || 55;    // 平滑显示
        this.pumpRunning     = false;   // 水泵运行状态
        this.pumpAutoStart   = true;    // 自动控制使能
        this._manualOverride = false;   // 手动强制
        this._manualPump     = false;

        // ── 开关状态 ──
        this.switchNO        = false;   // 常开接点（闭合=true）
        this.switchNC        = true;    // 常闭接点（闭合=true）
        this.switchCOM       = true;    // 公共端

        // ── 浮子室机构状态 ──
        this.floatAngle      = 0;       // 浮子臂角度（deg，0=水平）
        this.sectorAngle     = 0;       // 扇形板角度（deg）
        this.magForce        = 0;       // 磁斥力（归一化 0~1）
        this.reedBend        = 0;       // 干簧管弹片弯曲量（0~1）

        // ── 动画 ──
        this._pumpPhase      = 0;       // 水泵叶轮旋转相位
        this._waterWave      = 0;       // 水面波动相位
        this._bubblePhase    = 0;       // 气泡相位（锅炉加热）
        this._steamPhase     = 0;       // 蒸汽流动相位
        this._flowPhase      = 0;       // 供水管流动相位
        this._sparkPhase     = 0;       // 磁斥力粒子
        this._transitionTimer= 0;       // 状态切换保护计时

        // ── 几何布局 ──
        const margin = 10;

        // 电机+水泵（左侧）
        this._motorX   = margin + 2;
        this._motorY   = Math.round(this.height * 0.28);
        this._motorW   = Math.round(this.width  * 0.15);
        this._motorH   = Math.round(this.height * 0.42);

        // 锅炉（中间）
        this._boilerX  = this._motorX + this._motorW + 30;
        this._boilerY  = Math.round(this.height * 0.08);
        this._boilerW  = Math.round(this.width  * 0.30);
        this._boilerH  = Math.round(this.height * 0.76);

        // 锅炉内腔
        this._bInX     = this._boilerX + 12;
        this._bInY     = this._boilerY + 16;
        this._bInW     = this._boilerW - 24;
        this._bInH     = this._boilerH - 24;

        // 供水管（水泵→锅炉，中部水平管道）
        this._pipeY    = this._motorY + this._motorH * 0.45;

        // 浮子室（右侧）
        this._floatChamX = this._boilerX + this._boilerW + 26;
        this._floatChamY = Math.round(this.height * 0.10);
        this._floatChamW = Math.round(this.width  * 0.16);
        this._floatChamH = Math.round(this.height * 0.70);

        // 浮子室内腔
        this._fcInX    = this._floatChamX + 8;
        this._fcInY    = this._floatChamY + 10;
        this._fcInW    = this._floatChamW - 16;
        this._fcInH    = this._floatChamH - 20;

        // 浮子室连通管位置
        this._connHiY  = this._floatChamY + 14;   // 上连通管
        this._connLoY  = this._floatChamY + this._floatChamH - 14;  // 下连通管

        // 磁力机构区（浮子室右侧）
        this._mechX    = this._floatChamX + this._floatChamW + 12;
        this._mechY    = this._floatChamY;
        this._mechW    = this.width - this._mechX - margin;
        this._mechH    = this._floatChamH;

        // 铰接点（扇形板旋转中心）
        this._pivotX   = this._mechX + this._mechW * 0.25;
        this._pivotY   = this._floatChamY + this._floatChamH * 0.42;

        // 干簧管位置
        this._reedX    = this._mechX + this._mechW * 0.60;
        this._reedY    = this._pivotY - 5;

        this._lastTs   = null;
        this._animId   = null;
        this.knobs     = {};

        this.config = {
            id: this.id, highWaterLine: this.highWaterLine,
            lowWaterLine: this.lowWaterLine, pumpFlowRate: this.pumpFlowRate,
        };

        this._init();

        // 端口
        this.addPort(0,                      this._pipeY,          'water_in',  'pipe', '进水');
        this.addPort(this._boilerX+this._boilerW/2, this._boilerY-2, 'steam_out', 'pipe', '蒸汽');
        this.addPort(this.width, this._mechY+this._mechH*0.55,   'no',   'wire', 'NO');
        this.addPort(this.width, this._mechY+this._mechH*0.65,   'com',  'wire', 'COM');
        this.addPort(this.width, this._mechY+this._mechH*0.75,   'nc',   'wire', 'NC');
        this.addPort(0,         this._motorY+this._motorH*0.15,  'pu',   'wire', 'U');
        this.addPort(0,         this._motorY+this._motorH*0.30,  'pv',   'wire', 'V');
    }

    // ═══════════════════════════════════════════
    _init() {
        this._drawLabel();
        this._drawMotorPump();
        this._drawSupplyPipe();
        this._drawBoiler();
        this._drawBoilerWater();
        this._drawConnectingPipes();
        this._drawFloatChamber();
        this._drawFloatMechanism();
        this._drawMagneticMechanism();
        this._drawSwitchContacts();
        this._drawControlPanel();
        this._drawBottomPanel();
        this._startAnimation();
    }

    _drawLabel() {
        this.group.add(new Konva.Text({
            x: 0, y: -22, width: this.width,
            text: '锅炉水位双位控制（浮子室 · 同极磁铁 · 干簧管开关）',
            fontSize: 13, fontStyle: 'bold', fill: '#1a2634', align: 'center',
        }));
    }

    // ── 电机 + 水泵 ──────────────────────────
    _drawMotorPump() {
        const mx = this._motorX, my = this._motorY;
        const mw = this._motorW, mh = this._motorH;
        const cx = mx + mw/2;

        // 电机外壳（矩形，上方）
        const motorH = mh * 0.46;
        const motor  = new Konva.Rect({
            x: mx, y: my, width: mw, height: motorH,
            fill: '#1565c0', stroke: '#0d47a1', strokeWidth: 2, cornerRadius: [4,4,0,0],
        });
        // 电机散热片
        for (let i = 1; i < 5; i++) {
            this.group.add(new Konva.Line({
                points: [mx, my + motorH*i/5, mx+4, my + motorH*i/5],
                stroke: '#0d47a1', strokeWidth: 2,
            }));
            this.group.add(new Konva.Line({
                points: [mx+mw-4, my + motorH*i/5, mx+mw, my + motorH*i/5],
                stroke: '#0d47a1', strokeWidth: 2,
            }));
        }
        // 电机铭牌
        const plate = new Konva.Rect({ x: mx+4, y: my+6, width: mw-8, height: motorH-12, fill: '#1e2a36', cornerRadius: 2 });
        this._motorLabel = new Konva.Text({ x: mx+4, y: my+8, width: mw-8, text: 'MOTOR\n3~', fontSize: 8, fontStyle: 'bold', fill: '#90caf9', align: 'center', lineHeight: 1.4 });
        // 转速指示LED
        this._motorLed = new Konva.Circle({ x: cx, y: my + motorH - 8, radius: 5, fill: '#1a1a1a', stroke: '#333', strokeWidth: 1 });
        // 电机端子盒
        const termBox = new Konva.Rect({ x: mx+4, y: my-12, width: mw-8, height: 14, fill: '#37474f', stroke: '#263238', strokeWidth: 1, cornerRadius: 2 });
        this.group.add(new Konva.Text({ x: mx+4, y: my-10, width: mw-8, text: 'U  V  W', fontSize: 7, fill: '#90a4ae', align: 'center' }));

        // 联轴器
        const coupleY = my + motorH;
        const couple  = new Konva.Rect({ x: cx-6, y: coupleY, width: 12, height: 8, fill: '#546e7a', stroke: '#37474f', strokeWidth: 1 });
        // 联轴器螺栓
        this.group.add(new Konva.Circle({ x: cx-3, y: coupleY+4, radius: 2.5, fill: '#37474f' }));
        this.group.add(new Konva.Circle({ x: cx+3, y: coupleY+4, radius: 2.5, fill: '#37474f' }));

        // 水泵壳体（下方，蜗壳形）
        const pumpY  = my + motorH + 8;
        const pumpH  = mh - motorH - 8;
        const pump   = new Konva.Rect({ x: mx, y: pumpY, width: mw, height: pumpH, fill: '#455a64', stroke: '#263238', strokeWidth: 2, cornerRadius: [0,0,6,6] });
        // 泵蜗壳旋转体（圆形）
        const volute = new Konva.Circle({ x: cx, y: pumpY + pumpH*0.42, radius: mw*0.38, fill: '#546e7a', stroke: '#37474f', strokeWidth: 1.5 });
        // 叶轮（动态，由旋转组实现）
        this._impellerGroup = new Konva.Group({ x: cx, y: pumpY + pumpH*0.42 });
        for (let i = 0; i < 5; i++) {
            const a = (i/5)*Math.PI*2;
            const r1 = mw*0.12, r2 = mw*0.30;
            this._impellerGroup.add(new Konva.Line({
                points: [r1*Math.cos(a), r1*Math.sin(a), r2*Math.cos(a+0.4), r2*Math.sin(a+0.4)],
                stroke: '#80cbc4', strokeWidth: 2.5, lineCap: 'round',
            }));
        }
        this._impellerGroup.add(new Konva.Circle({ radius: mw*0.09, fill: '#37474f', stroke: '#263238', strokeWidth: 1 }));
        // 泵出口（右侧）
        this.group.add(new Konva.Rect({ x: mx+mw, y: pumpY+pumpH*0.38, width: 14, height: 10, fill: '#78909c', stroke: '#546e7a', strokeWidth: 1 }));
        // 泵进口（底部）
        this.group.add(new Konva.Rect({ x: cx-5, y: pumpY+pumpH-4, width: 10, height: 10, fill: '#78909c', stroke: '#546e7a', strokeWidth: 1 }));
        this.group.add(new Konva.Text({ x: cx-10, y: pumpY+pumpH+8, width: 20, text: '进水', fontSize: 7.5, fill: '#90a4ae', align: 'center' }));

        // 标注
        this.group.add(new Konva.Text({ x: mx, y: my-24, width: mw, text: '电机', fontSize: 8.5, fontStyle: 'bold', fill: '#42a5f5', align: 'center' }));
        this.group.add(new Konva.Text({ x: mx, y: pumpY+pumpH+18, width: mw, text: '水泵', fontSize: 8.5, fontStyle: 'bold', fill: '#80cbc4', align: 'center' }));

        this._motorY_top  = my; this._motorH_top = motorH;
        this._pumpY_top   = pumpY; this._pumpH_top = pumpH;
        this._pumpCX      = cx; this._pumpVoluteR = mw*0.38;
        this._pumpOutY    = pumpY + pumpH*0.38 + 5;

        this.group.add(motor, plate, termBox, couple, pump, volute, this._impellerGroup, this._motorLed, this._motorLabel);
    }

    // ── 供水管（水泵→锅炉）──────────────────
    _drawSupplyPipe() {
        const x1 = this._motorX + this._motorW + 14;
        const x2 = this._boilerX;
        const y  = this._pipeY;

        // 水平供水管
        const pipe = new Konva.Rect({ x: x1, y: y-6, width: x2-x1, height: 12, fill: '#78909c', stroke: '#546e7a', strokeWidth: 1.5, cornerRadius: 1 });
        // 止回阀图标（中间）
        const cvX = (x1+x2)/2;
        const cv  = new Konva.Line({
            points: [cvX-6, y-7, cvX+6, y-7, cvX+6, y+7, cvX-6, y+7, cvX-6, y-7, cvX+6, y],
            closed: false, stroke: '#ffd54f', strokeWidth: 1.5,
        });
        this.group.add(new Konva.Text({ x: cvX-8, y: y-18, text: 'CV', fontSize: 7, fontStyle: 'bold', fill: '#ffd54f' }));

        // 流动粒子（动态层）
        this._flowGroup = new Konva.Group();
        this._flowPipeX1 = x1; this._flowPipeX2 = x2; this._flowPipeY = y;

        this.group.add(pipe, cv, this._flowGroup);
    }

    // ── 锅炉主体 ─────────────────────────────
    _drawBoiler() {
        const bx = this._boilerX, by = this._boilerY;
        const bw = this._boilerW, bh = this._boilerH;

        // 外壳（圆柱形，带半圆封头）
        const body = new Konva.Rect({ x: bx, y: by+20, width: bw, height: bh-40, fill: '#455a64', stroke: '#263238', strokeWidth: 2 });
        // 顶封头
        const topHead = new Konva.Ellipse({ x: bx+bw/2, y: by+20, radiusX: bw/2, radiusY: 20, fill: '#546e7a', stroke: '#263238', strokeWidth: 2 });
        // 底封头
        const botHead = new Konva.Ellipse({ x: bx+bw/2, y: by+bh-20, radiusX: bw/2, radiusY: 20, fill: '#546e7a', stroke: '#263238', strokeWidth: 2 });
        // 内腔
        this._boilerInner = new Konva.Rect({
            x: this._bInX, y: this._bInY,
            width: this._bInW, height: this._bInH,
            fill: '#0d1a24',
        });

        // 铭牌
        this.group.add(new Konva.Rect({ x: bx+8, y: by+bh/2-14, width: bw-16, height: 28, fill: '#1e2a36', stroke: '#37474f', strokeWidth: 0.5, cornerRadius: 2 }));
        this.group.add(new Konva.Text({ x: bx+8, y: by+bh/2-12, width: bw-16, text: '锅    炉', fontSize: 10, fontStyle: 'bold', fill: 'rgba(255,255,255,0.25)', align: 'center' }));
        this.group.add(new Konva.Text({ x: bx+8, y: by+bh/2, width: bw-16, text: 'BOILER', fontSize: 8, fill: 'rgba(255,255,255,0.15)', align: 'center' }));

        // 安全阀（顶部）
        const svX = bx + bw - 22;
        const svY = by + 16;
        this.group.add(new Konva.Rect({ x: svX-4, y: svY-12, width: 8, height: 14, fill: '#ef5350', stroke: '#b71c1c', strokeWidth: 1, cornerRadius: 1 }));
        this.group.add(new Konva.Rect({ x: svX-7, y: svY-14, width: 14, height: 4, fill: '#c62828', cornerRadius: 1 }));
        this.group.add(new Konva.Text({ x: svX-8, y: svY-24, text: 'SV', fontSize: 7, fontStyle: 'bold', fill: '#ef9a9a' }));

        // 蒸汽出口（顶部中央）
        this.group.add(new Konva.Rect({ x: bx+bw/2-8, y: by-8, width: 16, height: 10, fill: '#78909c', stroke: '#546e7a', strokeWidth: 1 }));
        this.group.add(new Konva.Text({ x: bx+bw/2-12, y: by-20, text: '蒸汽出口', fontSize: 7.5, fill: '#ef9a9a' }));

        // 支脚
        [-bw/3, bw/3].forEach(ox => {
            this.group.add(new Konva.Rect({ x: bx+bw/2+ox-6, y: by+bh-8, width: 12, height: 16, fill: '#37474f', stroke: '#263238', strokeWidth: 1, cornerRadius: [0,0,2,2] }));
            this.group.add(new Konva.Rect({ x: bx+bw/2+ox-14, y: by+bh+6, width: 28, height: 5, fill: '#263238', cornerRadius: 1 }));
        });

        // 加热元件（底部，电热管图示）
        for (let i = 0; i < 3; i++) {
            const hx2 = bx + 18 + i * (bw-28)/3;
            this._heaterBars = this._heaterBars || [];
            const hbar = new Konva.Rect({ x: hx2, y: by+bh-44, width: (bw-28)/3-6, height: 6, fill: '#ef5350', stroke: '#b71c1c', strokeWidth: 0.5, cornerRadius: 2, opacity: 0.7 });
            this._heaterBars.push(hbar);
            this.group.add(hbar);
        }
        this.group.add(new Konva.Text({ x: bx+4, y: by+bh-50, text: '加热元件', fontSize: 7.5, fill: '#ef9a9a' }));

        // 水位计标注
        this._bHiLineY = this._bInY + this._bInH*(1 - this.highWaterLine/100);
        this._bLoLineY = this._bInY + this._bInH*(1 - this.lowWaterLine/100);
        const hiLine = new Konva.Line({ points: [bx, this._bHiLineY, bx+bw, this._bHiLineY], stroke: 'rgba(239,83,80,0.45)', strokeWidth: 1, dash: [5,3] });
        const loLine = new Konva.Line({ points: [bx, this._bLoLineY, bx+bw, this._bLoLineY], stroke: 'rgba(255,152,0,0.45)', strokeWidth: 1, dash: [5,3] });
        this.group.add(new Konva.Text({ x: bx+bw+2, y: this._bHiLineY-6, text: 'H', fontSize: 8, fontStyle: 'bold', fill: '#ef5350' }));
        this.group.add(new Konva.Text({ x: bx+bw+2, y: this._bLoLineY-1, text: 'L', fontSize: 8, fontStyle: 'bold', fill: '#ffa726' }));

        this.group.add(body, topHead, botHead, this._boilerInner, hiLine, loLine);
    }

    // ── 锅炉水位（动态）──────────────────────
    _drawBoilerWater() {
        this._boilerWater = new Konva.Rect({
            x: this._bInX, y: this._bInY,
            width: this._bInW, height: 0,
            fill: '#1e88e5', opacity: 0.78,
        });
        this._boilerSurf  = new Konva.Line({ points: [], stroke: 'rgba(255,255,255,0.28)', strokeWidth: 2 });
        this._bubbleGroup = new Konva.Group();
        this._steamGroup2 = new Konva.Group();
        this.group.add(this._boilerWater, this._boilerSurf, this._bubbleGroup, this._steamGroup2);
    }

    // ── 上下连通管（锅炉←→浮子室）──────────
    _drawConnectingPipes() {
        const bx = this._boilerX + this._boilerW;
        const fx = this._floatChamX;
        const hiY = this._connHiY, loY = this._connLoY;

        // 上连通管
        this.group.add(new Konva.Rect({ x: bx-2, y: hiY-5, width: fx-bx+4, height: 10, fill: '#78909c', stroke: '#546e7a', strokeWidth: 1 }));
        this.group.add(new Konva.Text({ x: bx+2, y: hiY-15, text: '上连通', fontSize: 7, fill: '#80cbc4' }));
        // 下连通管
        this.group.add(new Konva.Rect({ x: bx-2, y: loY-5, width: fx-bx+4, height: 10, fill: '#78909c', stroke: '#546e7a', strokeWidth: 1 }));
        this.group.add(new Konva.Text({ x: bx+2, y: loY+6, text: '下连通', fontSize: 7, fill: '#80cbc4' }));
    }

    // ── 浮子室外壳 ────────────────────────────
    _drawFloatChamber() {
        const fx = this._floatChamX, fy = this._floatChamY;
        const fw = this._floatChamW, fh = this._floatChamH;

        // 外壳（玻璃管外观）
        const body = new Konva.Rect({ x: fx, y: fy, width: fw, height: fh, fill: '#546e7a', stroke: '#263238', strokeWidth: 2, cornerRadius: 3 });
        // 内腔（玻璃透明感）
        const inner = new Konva.Rect({ x: this._fcInX, y: this._fcInY, width: this._fcInW, height: this._fcInH, fill: '#0d1a28', cornerRadius: 1 });
        // 玻璃高光
        this.group.add(new Konva.Rect({ x: this._fcInX+1, y: this._fcInY, width: 4, height: this._fcInH, fill: 'rgba(255,255,255,0.15)' }));
        // 顶底端盖
        const topCap = new Konva.Rect({ x: fx-2, y: fy-6, width: fw+4, height: 8, fill: '#607d8b', stroke: '#37474f', strokeWidth: 1, cornerRadius: 2 });
        const botCap = new Konva.Rect({ x: fx-2, y: fy+fh-2, width: fw+4, height: 8, fill: '#607d8b', stroke: '#37474f', strokeWidth: 1, cornerRadius: 2 });
        // 排污阀
        const drainY = fy + fh + 8;
        this.group.add(new Konva.Rect({ x: fx+fw/2-8, y: drainY, width: 16, height: 10, fill: '#455a64', stroke: '#263238', strokeWidth: 1, cornerRadius: 2 }));
        this.group.add(new Konva.Text({ x: fx+fw/2-12, y: drainY+12, text: '排污阀', fontSize: 7, fill: '#78909c' }));

        // 标注
        this.group.add(new Konva.Text({ x: fx, y: fy-18, width: fw, text: '浮子室', fontSize: 9, fontStyle: 'bold', fill: '#80cbc4', align: 'center' }));

        // 水位刻度
        for (let i = 0; i <= 5; i++) {
            const ly = this._fcInY + this._fcInH*(1 - i/5);
            this.group.add(new Konva.Line({ points: [fx+fw, ly, fx+fw+6, ly], stroke: '#78909c', strokeWidth: 0.8 }));
            this.group.add(new Konva.Text({ x: fx+fw+8, y: ly-5, text: `${i*20}%`, fontSize: 7, fill: '#607d8b' }));
        }
        // 高低水位线
        const hiLineY = this._fcInY + this._fcInH*(1 - this.highWaterLine/100);
        const loLineY = this._fcInY + this._fcInH*(1 - this.lowWaterLine/100);
        this.group.add(new Konva.Line({ points: [this._fcInX, hiLineY, this._fcInX+this._fcInW, hiLineY], stroke: 'rgba(239,83,80,0.5)', strokeWidth: 1, dash: [4,3] }));
        this.group.add(new Konva.Line({ points: [this._fcInX, loLineY, this._fcInX+this._fcInW, loLineY], stroke: 'rgba(255,152,0,0.5)', strokeWidth: 1, dash: [4,3] }));

        this.group.add(body, inner, topCap, botCap);

        // 浮子室水位（动态）
        this._floatChamWater = new Konva.Rect({ x: this._fcInX, y: this._fcInY, width: this._fcInW, height: 0, fill: '#1e88e5', opacity: 0.75 });
        this._floatChamSurf  = new Konva.Line({ points: [], stroke: 'rgba(255,255,255,0.3)', strokeWidth: 1.5 });
        this.group.add(this._floatChamWater, this._floatChamSurf);
    }

    // ── 浮子机构（浮子 + 连杆 + 扇形板）──────
    _drawFloatMechanism() {
        const fcx = this._fcInX + this._fcInW/2;

        // 浮子（球形）
        this._floatGroup = new Konva.Group();
        const ball = new Konva.Circle({ radius: 12, fill: '#ff8f00', stroke: '#e65100', strokeWidth: 1.5 });
        const ballGlint = new Konva.Circle({ x: -4, y: -4, radius: 4, fill: 'rgba(255,255,255,0.35)' });
        this._floatGroup.add(ball, ballGlint);
        this._floatGroup.add(new Konva.Text({ x: -9, y: -6, text: '浮\n子', fontSize: 7, fill: 'rgba(255,255,255,0.7)', lineHeight: 1.3 }));

        // 浮子连杆（穿出浮子室右壁到铰接点）
        this._floatRod = new Konva.Line({ points: [], stroke: '#90a4ae', strokeWidth: 3, lineCap: 'round' });

        // 扇形调节板组（以铰接点为中心）
        this._sectorGroup = new Konva.Group({ x: this._pivotX, y: this._pivotY });

        // 扇形板主体
        const sectorPts = [];
        const sR = 38;
        sectorPts.push(0, 0);
        for (let a = -20; a <= 50; a += 5) {
            const rad = a * Math.PI / 180;
            sectorPts.push(sR * Math.cos(rad), -sR * Math.sin(rad));
        }
        sectorPts.push(0, 0);
        const sector = new Konva.Line({ points: sectorPts, closed: true, fill: '#78909c', stroke: '#546e7a', strokeWidth: 1.5 });

        // 铰接轴
        const pivot = new Konva.Circle({ radius: 5, fill: '#37474f', stroke: '#263238', strokeWidth: 1.5 });
        const pivotHole = new Konva.Circle({ radius: 2, fill: '#1a252f' });

        // 扇形板端部磁铁A（红色，N极朝外）
        this._magA = new Konva.Rect({ x: sR*0.72-8, y: -8, width: 16, height: 16, fill: '#c62828', stroke: '#8a0000', strokeWidth: 1.5, cornerRadius: 2 });
        const magALabel = new Konva.Text({ x: sR*0.72-6, y: -4, text: 'N', fontSize: 9, fontStyle: 'bold', fill: '#ffcdd2' });

        // 连杆（扇形板→浮子室）
        this._linkRod = new Konva.Line({ points: [], stroke: '#90a4ae', strokeWidth: 2.5, lineCap: 'round' });

        this._sectorGroup.add(sector, pivot, pivotHole, this._magA, magALabel);
        this.group.add(this._floatRod, this._linkRod, this._floatGroup, this._sectorGroup);

        // 铰接点标注
        this.group.add(new Konva.Text({ x: this._pivotX-14, y: this._pivotY+6, text: '铰接', fontSize: 7.5, fill: '#78909c' }));
        this.group.add(new Konva.Text({ x: this._pivotX-22, y: this._pivotY-30, text: '扇形调节板', fontSize: 7.5, fontStyle: 'bold', fill: '#90a4ae' }));
    }

    // ── 磁力机构（干簧管开关 + 磁铁B）────────
    _drawMagneticMechanism() {
        const rx = this._reedX, ry = this._reedY;
        const px2 = this._pivotX;

        // 开关臂支架
        this._switchArm = new Konva.Group({ x: rx, y: ry });

        // 开关臂本体（弹性臂）
        this._armLine = new Konva.Line({ points: [-28, 0, 28, 0], stroke: '#80cbc4', strokeWidth: 2.5, lineCap: 'round' });
        // 臂上的磁铁B（蓝色，N极朝向磁铁A方向）
        this._magB = new Konva.Rect({ x: -36, y: -7, width: 14, height: 14, fill: '#1565c0', stroke: '#0d47a1', strokeWidth: 1.5, cornerRadius: 2 });
        const magBLabel = new Konva.Text({ x: -34, y: -3, text: 'N', fontSize: 9, fontStyle: 'bold', fill: '#bbdefb' });
        // 同极斥力说明
        this.group.add(new Konva.Text({ x: px2+14, y: ry-28, text: '同极斥力', fontSize: 7.5, fontStyle: 'bold', fill: '#ffd54f' }));
        this._repulseArrow = new Konva.Line({ points: [px2+60, ry-4, px2+40, ry-4], stroke: '#ffd54f', strokeWidth: 1.5, lineCap: 'round' });
        this.group.add(new Konva.Line({ points: [rx-36, ry, px2+60, ry], stroke: '#546e7a', strokeWidth: 0.8, dash: [3,3], opacity: 0.5 }));

        // 干簧管外壳（玻璃管）
        this._reedTube = new Konva.Rect({ x: 4, y: -4, width: 28, height: 8, fill: '#e8f4f8', stroke: '#90caf9', strokeWidth: 1, cornerRadius: 4 });
        // 内部弹片（动态弯曲）
        this._reedContact1 = new Konva.Line({ points: [6, 0, 18, 0], stroke: '#ffd54f', strokeWidth: 1.5, lineCap: 'round' });
        this._reedContact2 = new Konva.Line({ points: [14, 0, 30, 0], stroke: '#ffd54f', strokeWidth: 1.5, lineCap: 'round' });

        this._switchArm.add(this._armLine, this._magB, magBLabel, this._reedTube, this._reedContact1, this._reedContact2);

        // 弹簧复位（固定端）
        const springX = rx + 30;
        this._springGroup = new Konva.Group({ x: springX, y: ry });
        for (let i = 0; i < 4; i++) {
            const sx = i * 5;
            this._springGroup.add(new Konva.Line({
                points: [sx, -6, sx+2.5, 0, sx+5, -6],
                stroke: '#607d8b', strokeWidth: 1.5, lineCap: 'round', lineJoin: 'round',
            }));
        }
        this._springGroup.add(new Konva.Rect({ x: 20, y: -8, width: 4, height: 16, fill: '#455a64' }));

        // 磁斥力粒子层
        this._repulseGroup = new Konva.Group();

        this.group.add(this._switchArm, this._springGroup, this._repulseGroup, this._repulseArrow);
    }

    // ── 开关接点输出 ──────────────────────────
    _drawSwitchContacts() {
        const mx2 = this._mechX, mw2 = this._mechW;
        const by3  = this._mechY + this._mechH * 0.50;
        const cw   = mw2 - 4;

        // 接线盒背景
        const box = new Konva.Rect({ x: mx2, y: by3, width: cw, height: this._mechH*0.38, fill: '#0d1520', stroke: '#1a3040', strokeWidth: 1.5, cornerRadius: 4 });
        const boxTitle = new Konva.Rect({ x: mx2, y: by3, width: cw, height: 14, fill: '#1a3a60', cornerRadius: [4,4,0,0] });
        this.group.add(new Konva.Text({ x: mx2+2, y: by3+2, width: cw-4, text: '开关量输出', fontSize: 8, fontStyle: 'bold', fill: '#90caf9', align: 'center' }));

        // 三个端子（NO / COM / NC）
        const terms = [
            { label: 'NO', desc: '常开', color: '#ef9a9a', dy: 14+12 },
            { label: 'COM', desc: '公共', color: '#ffd54f', dy: 14+28 },
            { label: 'NC', desc: '常闭', color: '#a5d6a7', dy: 14+44 },
        ];
        this._termLeds = [];
        terms.forEach(({ label, desc, color, dy }) => {
            const ty = by3 + dy;
            this.group.add(new Konva.Rect({ x: mx2+4, y: ty-6, width: cw-8, height: 13, fill: 'rgba(255,255,255,0.025)', cornerRadius: 2 }));
            this.group.add(new Konva.Text({ x: mx2+7, y: ty-3, text: `${label} (${desc})`, fontSize: 9, fontStyle: 'bold', fill: color }));
            const led = new Konva.Circle({ x: mx2+cw-12, y: ty+1, radius: 4.5, fill: '#1a1a1a', stroke: '#333', strokeWidth: 0.8 });
            this._termLeds.push({ led, color });
            this.group.add(led);
        });

        this.group.add(box, boxTitle);
    }

    // ── 控制面板（底部）──────────────────────
    _drawControlPanel() {
        // 在 _drawBottomPanel 统一绘制
    }

    // ── 底部状态面板 ─────────────────────────
    _drawBottomPanel() {
        const py = this.height - 42;
        const bg = new Konva.Rect({ x: 4, y: py, width: this.width-8, height: 38, fill: '#050d18', stroke: '#1a3040', strokeWidth: 1, cornerRadius: 4 });
        this._panelMain   = new Konva.Text({ x: 8, y: py+5,  width: (this.width-8)*0.60, text: '---', fontSize: 9, fontFamily: 'Courier New, monospace', fontStyle: 'bold', fill: '#4dd0e1' });
        this._panelSub    = new Konva.Text({ x: 8, y: py+20, width: (this.width-8)*0.70, text: '---', fontSize: 8, fontFamily: 'Courier New, monospace', fill: '#37474f' });
        this._panelStatus = new Konva.Text({ x: (this.width-8)*0.62+8, y: py+5, width: (this.width-8)*0.36, text: '● 正常', fontSize: 10, fontStyle: 'bold', fill: '#66bb6a', align: 'right' });
        this.group.add(bg, this._panelMain, this._panelSub, this._panelStatus);
    }

    // ═══════════════════════════════════════════
    _startAnimation() {
        const tick = ts => {
            if (this._lastTs !== null) {
                const dt = Math.min((ts - this._lastTs) / 1000, 0.05);
                this._tickControl(dt);
                this._tickPhysics(dt);
                this._tickPumpViz(dt);
                this._tickSupplyFlow(dt);
                this._tickBoilerViz(dt);
                this._tickFloatChamViz(dt);
                this._tickFloatMechanism();
                this._tickMagneticMechanism();
                this._tickSwitchContacts();
                this._tickDisplay();
            }
            this._lastTs = ts;
            this._refreshCache();
            this._animId = requestAnimationFrame(tick);
        };
        this._animId = requestAnimationFrame(tick);
    }

    _stopAnimation() {
        if (this._animId) { cancelAnimationFrame(this._animId); this._animId = null; }
    }

    // ── 双位控制逻辑 ─────────────────────────
    _tickControl(dt) {
        if (!this.pumpAutoStart || this._manualOverride) {
            this.pumpRunning = this._manualPump;
            return;
        }
        this._transitionTimer -= dt;
        // 迟滞控制：低水位启泵，高水位停泵
        if (this.waterLevel <= this.lowWaterLine && !this.pumpRunning && this._transitionTimer <= 0) {
            this.pumpRunning = true;
            this._transitionTimer = 0.5;  // 保护时间 0.5s
        } else if (this.waterLevel >= this.highWaterLine && this.pumpRunning && this._transitionTimer <= 0) {
            this.pumpRunning = false;
            this._transitionTimer = 0.5;
        }
    }

    // ── 水位物理模拟 ─────────────────────────
    _tickPhysics(dt) {
        const inFlow  = this.pumpRunning ? this.pumpFlowRate / 60 : 0;   // L/s
        const outFlow = this.steamConsume / 60;                            // L/s（蒸发消耗）
        const netFlow = (inFlow - outFlow) * dt;
        const dH      = netFlow / this.boilerCapacity * 100;              // % per dt

        this.waterLevel = Math.max(0, Math.min(100, this.waterLevel + dH));
        this._displayLevel += (this.waterLevel - this._displayLevel) * Math.min(1, dt * 6);

        this._waterWave  += dt * 3;
        this._bubblePhase+= dt * (1 + this.waterLevel * 0.02);
        this._steamPhase += dt * 2;
        this._pumpPhase  += dt * (this.pumpRunning ? 8 : 0.2);
        this._flowPhase  += dt * (this.pumpRunning ? 3 : 0);
        this._sparkPhase += dt * 4;

        // 开关量：水位≥高水位时 NO断开(false)，水位≤低水位时 NO闭合(true)
        this.switchNO  = this.waterLevel <= this.lowWaterLine;   // 水泵运行信号
        this.switchNC  = this.waterLevel >= this.highWaterLine;  // 高水位保护信号（常闭在高水位断开）
    }

    // ── 水泵动画 ─────────────────────────────
    _tickPumpViz(dt) {
        if (this._impellerGroup) this._impellerGroup.rotation(this._pumpPhase * 180 / Math.PI);
        if (this._motorLed) {
            const on = this.pumpRunning;
            const pulse = on ? (0.5 + 0.5 * Math.abs(Math.sin(this._pumpPhase))) : 0;
            this._motorLed.fill(on ? `rgba(100,200,100,${0.4+pulse*0.6})` : '#1a1a1a');
        }
    }

    // ── 供水管流动 ────────────────────────────
    _tickSupplyFlow(dt) {
        this._flowGroup.destroyChildren();
        if (!this.pumpRunning) return;
        const n = 5;
        for (let i = 0; i < n; i++) {
            const t = ((this._flowPhase * 0.1 + i/n) % 1 + 1) % 1;
            const x = this._flowPipeX1 + t * (this._flowPipeX2 - this._flowPipeX1);
            this._flowGroup.add(new Konva.Circle({ x, y: this._flowPipeY, radius: 3, fill: 'rgba(30,136,229,0.7)' }));
        }
    }

    // ── 锅炉水位可视化 ───────────────────────
    _tickBoilerViz(dt) {
        const lv   = this._displayLevel / 100;
        const lh   = lv * this._bInH;
        const lTop = this._bInY + this._bInH - lh;

        this._boilerWater.y(lTop);
        this._boilerWater.height(lh);
        const fr = lv;
        this._boilerWater.fill(`rgba(${Math.round(15+fr*10)},${Math.round(100+fr*50)},${Math.round(200+fr*20)},0.78)`);

        // 液面波纹
        const pts = [];
        for (let i = 0; i <= 5; i++) {
            pts.push(this._bInX + i*this._bInW/5, lTop + Math.sin(this._waterWave + i*1.1) * 1.5);
        }
        this._boilerSurf.points(lh > 2 ? pts : []);

        // 气泡（锅炉加热产生）
        this._bubbleGroup.destroyChildren();
        if (lh > 8) {
            for (let i = 0; i < 4; i++) {
                const bph = (this._bubblePhase * 0.3 + i * 0.25) % 1;
                if (bph > 0.85) continue;
                const bx2 = this._bInX + 8 + (i * 31) % (this._bInW - 16);
                const by2 = lTop + lh * (1 - bph) * 0.9;
                const br  = 2 + bph * 2;
                this._bubbleGroup.add(new Konva.Circle({ x: bx2, y: by2, radius: br, fill: `rgba(100,190,255,${0.4*(1-bph)})`, stroke: `rgba(180,230,255,${0.3*(1-bph)})`, strokeWidth: 0.5 }));
            }
        }

        // 蒸汽（从水面向上冒）
        this._steamGroup2.destroyChildren();
        if (lh > 5) {
            for (let i = 0; i < 3; i++) {
                const sp = ((this._steamPhase * 0.2 + i * 0.33) % 1 + 1) % 1;
                const sx2 = this._bInX + this._bInW * 0.3 + i * this._bInW * 0.2;
                const sy2 = lTop - sp * 30;
                this._steamGroup2.add(new Konva.Circle({ x: sx2, y: sy2, radius: 2+sp*4, fill: `rgba(200,230,255,${0.3*(1-sp)})` }));
            }
        }
    }

    // ── 浮子室水位可视化 ─────────────────────
    _tickFloatChamViz(dt) {
        const lv   = this._displayLevel / 100;
        const lh   = lv * this._fcInH;
        const lTop = this._fcInY + this._fcInH - lh;

        this._floatChamWater.y(lTop);
        this._floatChamWater.height(lh);

        // 液面
        if (lh > 2) {
            this._floatChamSurf.points([this._fcInX, lTop + Math.sin(this._waterWave) * 0.8, this._fcInX + this._fcInW, lTop + Math.sin(this._waterWave + 1) * 0.8]);
        } else {
            this._floatChamSurf.points([]);
        }
    }

    // ── 浮子机构动态更新 ─────────────────────
    _tickFloatMechanism() {
        const lv    = this._displayLevel / 100;
        const fcCX  = this._fcInX + this._fcInW / 2;
        const waterH= lv * this._fcInH;
        const lTop  = this._fcInY + this._fcInH - waterH;

        // 浮子随液面
        const floatY = Math.max(this._fcInY + 12, Math.min(this._fcInY + this._fcInH - 12, lTop));
        this._floatGroup.x(fcCX);
        this._floatGroup.y(floatY);

        // 连杆（浮子 → 浮子室右壁 → 铰接点）
        const rodMidX = this._floatChamX + this._floatChamW + 4;
        const rodMidY = floatY;
        this._floatRod.points([fcCX + 12, floatY, rodMidX, rodMidY, this._pivotX, this._pivotY + (floatY - (this._fcInY + this._fcInH/2)) * 0.4]);

        // 扇形板角度（液位高→逆时针；液位低→顺时针）
        // 映射：lv=1 → angle=-25°，lv=0 → angle=35°
        this.sectorAngle = 35 - lv * 60;
        this._sectorGroup.rotation(this.sectorAngle);

        // 连杆（铰接点 → 浮子）
        const linkAngle = this.sectorAngle * Math.PI / 180;
        const sR = 38;
        const linkEndX = this._pivotX + sR * 0.6 * Math.cos(-linkAngle - 0.1);
        const linkEndY = this._pivotY + sR * 0.6 * Math.sin(-linkAngle - 0.1);
        this._linkRod.points([this._pivotX, this._pivotY, linkEndX, linkEndY]);
    }

    // ── 磁力机构动态更新 ─────────────────────
    _tickMagneticMechanism() {
        const lv      = this._displayLevel / 100;
        const sectorR = this.sectorAngle * Math.PI / 180;
        const sR      = 38;

        // 磁铁A的绝对位置（扇形板端部）
        const magALocalX = sR * 0.85;
        const magALocalY = 0;
        const magAX = this._pivotX + magALocalX * Math.cos(-sectorR) - magALocalY * Math.sin(-sectorR);
        const magAY = this._pivotY + magALocalX * Math.sin(-sectorR) + magALocalY * Math.cos(-sectorR);

        // 磁铁B的绝对位置（固定在开关臂）
        const magBX = this._reedX - 29;
        const magBY = this._reedY;

        // 磁斥力距离
        const dist = Math.hypot(magAX - magBX, magAY - magBY);
        const maxDist = 60, minDist = 16;
        this.magForce = Math.max(0, Math.min(1, 1 - (dist - minDist) / (maxDist - minDist)));

        // 开关臂弯曲量（磁斥力推开）
        this.reedBend = this.magForce * 8;   // 最大弯曲 8px
        if (this._switchArm) {
            this._switchArm.y(this._reedY + this.reedBend);
        }

        // 磁斥力粒子可视化
        this._repulseGroup.destroyChildren();
        if (this.magForce > 0.15) {
            const nSparks = Math.floor(this.magForce * 5);
            for (let i = 0; i < nSparks; i++) {
                const t = ((this._sparkPhase * 0.15 + i / nSparks) % 1 + 1) % 1;
                const sx2 = magBX + t * (magAX - magBX);
                const sy2 = magBY + t * (magAY - magBY) + Math.sin(this._sparkPhase + i) * 3;
                const sa2 = (1 - t) * this.magForce;
                this._repulseGroup.add(new Konva.Circle({ x: sx2, y: sy2, radius: 2.5, fill: `rgba(255,213,79,${sa2})` }));
            }
            // 斥力指示线（磁铁A → 磁铁B 方向虚线）
            this._repulseGroup.add(new Konva.Line({
                points: [magAX, magAY, magBX, magBY],
                stroke: `rgba(255,213,79,${this.magForce * 0.5})`, strokeWidth: 1, dash: [2,3],
            }));
        }

        // 干簧管弹片状态
        const contactGap = this.reedBend;  // 弹片间距（px）
        if (this._reedContact1) {
            // 左弹片（固定）
            this._reedContact1.points([6, 0, 18, 0]);
        }
        if (this._reedContact2) {
            // 右弹片（随磁场弯曲）
            this._reedContact2.points([14, contactGap > 3 ? contactGap * 0.5 : 0, 30, 0]);
        }

        // 弹片颜色（接通=金色，断开=暗色）
        const contactState = contactGap < 3;  // 间距小于3px视为接通
        const contactColor = contactState ? '#ffd54f' : '#37474f';
        if (this._reedContact1) this._reedContact1.stroke(contactColor);
        if (this._reedContact2) this._reedContact2.stroke(contactColor);
        if (this._reedTube)     this._reedTube.stroke(contactState ? '#ffd54f' : '#90caf9');
    }

    // ── 开关接点状态 ──────────────────────────
    _tickSwitchContacts() {
        if (!this._termLeds || this._termLeds.length < 3) return;
        const pulse = 0.5 + 0.5 * Math.abs(Math.sin(this._sparkPhase * 2));

        // NO（常开）：低水位时闭合（绿色），高水位断开（暗）
        this._termLeds[0].led.fill(this.switchNO ? `rgba(239,154,154,${0.5+pulse*0.5})` : '#1a1a1a');
        // COM
        this._termLeds[1].led.fill('#ffd54f');
        // NC（常闭）：高水位时断开
        this._termLeds[2].led.fill(this.switchNC ? '#1a1a1a' : `rgba(165,214,167,${0.5+pulse*0.5})`);

        // 阀位标注
        if (this._valveOpenText2) {
            this._valveOpenText2.text(this.pumpRunning ? '水泵 ON' : '水泵 OFF');
        }
    }

    // ── 显示刷新 ─────────────────────────────
    _tickDisplay() {
        const lv   = this._displayLevel;
        const mc   = lv > this.dangerHigh ? '#ef5350' : lv < this.dangerLow ? '#ff5722' : lv > this.highWaterLine ? '#ffa726' : lv < this.lowWaterLine ? '#ffd54f' : '#66bb6a';

        if (this._panelMain)   this._panelMain.text(`水位=${lv.toFixed(1)}%  泵=${this.pumpRunning?'运行':'停止'}  NO=${this.switchNO?'闭':'开'}  NC=${this.switchNC?'断':'闭'}`);
        if (this._panelSub)    this._panelSub.text(`启泵线=${this.lowWaterLine}%  停泵线=${this.highWaterLine}%  迟滞区间=${(this.highWaterLine-this.lowWaterLine).toFixed(0)}%  磁斥力=${this.magForce.toFixed(2)}`);
        if (this._panelStatus) {
            const st = lv > this.dangerHigh ? '⚠ 高水位危险' : lv < this.dangerLow ? '⚠ 低水位危险' : this.pumpRunning ? '▶ 补水运行' : '■ 停泵等待';
            this._panelStatus.text(st); this._panelStatus.fill(mc);
        }
    }

    // ═══════════════════════════════════════════
    update(level) {
        if (typeof level === 'number') {
            this.waterLevel = Math.max(0, Math.min(100, level));
        }
        this._refreshCache();
    }

    setPumpManual(on) {
        this._manualOverride = true;
        this._manualPump     = on;
        this._refreshCache();
    }

    setAutoControl(enabled) {
        this.pumpAutoStart   = enabled;
        this._manualOverride = !enabled;
        this._refreshCache();
    }

    getConfigFields() {
        return [
            { label: '位号/名称',          key: 'id',             type: 'text'   },
            { label: '高水位停泵线 (%)',    key: 'highWaterLine',  type: 'number' },
            { label: '低水位启泵线 (%)',    key: 'lowWaterLine',   type: 'number' },
            { label: '水泵流量 (L/min)',    key: 'pumpFlowRate',   type: 'number' },
            { label: '蒸发量 (L/min)',      key: 'steamConsume',   type: 'number' },
            { label: '危险高水位 (%)',      key: 'dangerHigh',     type: 'number' },
            { label: '危险低水位 (%)',      key: 'dangerLow',      type: 'number' },
        ];
    }

    onConfigUpdate(cfg) {
        this.id            = cfg.id            || this.id;
        this.highWaterLine = parseFloat(cfg.highWaterLine) || this.highWaterLine;
        this.lowWaterLine  = parseFloat(cfg.lowWaterLine)  || this.lowWaterLine;
        this.pumpFlowRate  = parseFloat(cfg.pumpFlowRate)  || this.pumpFlowRate;
        this.steamConsume  = parseFloat(cfg.steamConsume)  || this.steamConsume;
        this.dangerHigh    = parseFloat(cfg.dangerHigh)    || this.dangerHigh;
        this.dangerLow     = parseFloat(cfg.dangerLow)     || this.dangerLow;
        this.config        = { ...this.config, ...cfg };
        this._refreshCache();
    }

    destroy() { this._stopAnimation(); super.destroy?.(); }
}