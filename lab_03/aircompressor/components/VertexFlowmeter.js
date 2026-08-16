import { BaseComponent } from './BaseComponent.js';

/**
 * 涡街流量计仿真组件（Vortex Shedding Flowmeter）
 *
 * ── 测量原理（卡门涡街）──────────────────────────────────
 *  在管道内安装一个非流线型柱体（发生体 / Bluff Body），
 *  流体绕过发生体时，在其下游两侧交替产生旋转方向相反的旋涡，
 *  形成卡门涡街（Kármán Vortex Street）。
 *
 *  涡街频率与流速线性相关（斯特劳哈尔定律）：
 *
 *    f = St · v / d
 *
 *  其中：
 *    f  — 涡脱落频率 (Hz)
 *    St — 斯特劳哈尔数（无量纲，典型值 0.2）
 *    v  — 管道内流速 (m/s)
 *    d  — 发生体特征宽度 (m)
 *
 *  体积流量：
 *    Q = v · A = v · π(D/2)²
 *
 *  仪表系数 K（脉冲/升）：
 *    Q = f / K
 *
 *  输出：
 *    脉冲输出（频率正比于流量）
 *    4-20mA 模拟量输出
 *    累积总量积算
 *
 * ── 组件结构 ──────────────────────────────────────────────
 *  左侧法兰管段（含内部截面动画）：
 *    - 管道截面视图（从上往下的剖视图）
 *    - 发生体（T形/三角形）
 *    - 卡门涡街粒子动画
 *    - 流体流向箭头
 *  右侧仪表头：
 *    - 圆形 LCD 主显示（流量值 + 涡频）
 *    - 接线盒（顶部）
 *    - 零点/量程旋钮
 *    - 底部综合显示栏
 *
 * ── 端口 ───────────────────────────────────────────────────
 *  pipe_i   — 管道进口（左）
 *  pipe_o   — 管道出口（右）
 *  wire_p   — 24VDC 电源正
 *  wire_n   — 4-20mA / 脉冲输出 / GND
 *
 * ── 气路求解器集成 ──────────────────────────────────────────
 *  special = 'diff'（接受差压，也可接受 press + flow）
 *  update(press, flow) — 求解器注入；flow 优先，press 退化估算
 */
export class VortexFlowmeter extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.width  = Math.max(300, config.width  || 340);
        this.height = Math.max(220, config.height || 260);

        this.type    = 'vortex_flowmeter';
        this.special = 'diff';
        this.cache   = 'fixed';

        // ── 仪表参数 ──
        this.pipeDiam    = config.pipeDiam    || 0.1;     // 管道内径 m（DN100）
        this.bluffWidth  = config.bluffWidth  || 0.025;   // 发生体宽度 d (m)
        this.strouhal    = config.strouhal    || 0.2;     // 斯特劳哈尔数
        this.kFactor     = config.kFactor     || 1500;    // 仪表系数 K（脉冲/m³）
        this.maxFlow     = config.maxFlow     || 100;     // 量程上限 m³/h
        this.maxPress    = config.maxPress    || 0.6;     // 气源最大压力 MPa（退化用）
        this.unit        = config.unit        || 'm³/h';
        this.fluidName   = config.fluidName   || '压缩空气';
        this.tempComp    = config.tempComp    || false;   // 温度补偿（扩展预留）

        // ── 零点/量程微调 ──
        this.zeroAdj     = 0;
        this.spanAdj     = 1.0;

        // ── 运行状态 ──
        this.press       = 0;        // 输入压力 (MPa)
        this.flow        = 0;        // 瞬时流量 (m³/h)
        this.velocity    = 0;        // 流速 (m/s)
        this.vortexFreq  = 0;        // 涡脱落频率 (Hz)
        this.outCurrent  = 4;        // 4-20mA
        this.pulseCount  = 0;        // 脉冲累积
        this.totalFlow   = 0;        // 累积总量 m³
        this.isBreak     = false;
        this.powered     = false;
        this.isLowFlow   = false;    // 小流量切除

        // ── 卡门涡街粒子系统 ──
        this._vortices    = [];      // 涡旋粒子
        this._particles   = [];      // 流体粒子（示踪）
        this._vortexTimer = 0;
        this._vortexSide  = 1;       // 交替上下

        // ── 脉冲输出状态 ──
        this._pulseState  = 0;       // 当前脉冲电平
        this._pulsePeriod = Infinity;
        this._pulseTimer  = 0;

        // ── 几何布局 ──
        // 管段截面区（左侧大块）
        this._pipeX  = 6;
        this._pipeY  = 30;
        this._pipeW  = this.width * 0.52;
        this._pipeH  = this.height - 60;

        // 仪表头区（右侧）
        this._headX  = this._pipeX + this._pipeW + 10;
        this._headW  = this.width - this._headX - 6;
        this._headY  = 0;

        this._lastTs = null;
        this._animId = null;
        this.knobs   = {};

        this.config = {
            id: this.id, pipeDiam: this.pipeDiam,
            bluffWidth: this.bluffWidth, kFactor: this.kFactor,
            maxFlow: this.maxFlow, unit: this.unit,
        };

        this._init();

        const midY = this._pipeY + this._pipeH / 2;
        this.addPort(0,            midY, 'i', 'pipe', 'IN');
        this.addPort(this.width,   midY, 'o', 'pipe', 'OUT');
        this.addPort(this.width,   22,   'p', 'wire', 'V+');
        this.addPort(this.width,   48,   'n', 'wire', 'SIG');
    }

    // ═══════════════════════════════════════════════
    //  初始化
    // ═══════════════════════════════════════════════
    _init() {
        this._drawLabel();
        this._drawPipeSection();     // 管段截面（含法兰）
        this._drawBluffBody();       // 发生体
        this._drawFlowArrows();      // 流向箭头
        this._drawVortexLayer();     // 涡街动画层
        this._drawSensorProbe();     // 压电传感器探头
        this._drawInstrumentHead();  // 仪表头（右侧）
        this._drawLCDDisplay();      // 圆形 LCD
        this._drawKnobs();           // 旋钮
        this._drawBottomPanel();     // 底部数据栏
        this._startAnimation();
    }

    _drawLabel() {
        this._labelNode = new Konva.Text({
            x: 0, y: -22, width: this.width,
            text: '涡街流量计', fontSize: 14,
            fontStyle: 'bold', fill: '#1a2634', align: 'center',
        });
        this.group.add(this._labelNode);
    }

    // ── 管段截面（俯视剖面图）──────────────────
    _drawPipeSection() {
        const px = this._pipeX, py = this._pipeY;
        const pw = this._pipeW, ph = this._pipeH;

        // 外管壁（金属感，深灰色）
        const pipeOuter = new Konva.Rect({
            x: px, y: py, width: pw, height: ph,
            fill: '#546e7a', stroke: '#37474f', strokeWidth: 2, cornerRadius: 2,
        });

        // 管道内腔
        const wallThk = 12;
        this._flowChanX = px + wallThk;
        this._flowChanY = py + wallThk;
        this._flowChanW = pw - wallThk * 2;
        this._flowChanH = ph - wallThk * 2;

        this._flowChannel = new Konva.Rect({
            x: this._flowChanX, y: this._flowChanY,
            width: this._flowChanW, height: this._flowChanH,
            fill: '#0d2137',
        });

        // 左侧法兰
        const lfX = px - 10, flangeH = ph + 16;
        const lFlange = new Konva.Rect({
            x: lfX, y: py - 8, width: 14, height: flangeH,
            fill: '#607d8b', stroke: '#455a64', strokeWidth: 1, cornerRadius: 2,
        });
        // 法兰螺孔
        [0.2, 0.5, 0.8].forEach(r => {
            this.group.add(new Konva.Circle({ x: lfX+7, y: py-8+flangeH*r, radius: 3, fill: '#37474f', stroke: '#263238', strokeWidth: 0.5 }));
        });

        // 右侧法兰（接仪表头）
        const rfX = px + pw - 4;
        const rFlange = new Konva.Rect({
            x: rfX, y: py - 8, width: 14, height: flangeH,
            fill: '#607d8b', stroke: '#455a64', strokeWidth: 1, cornerRadius: 2,
        });
        [0.2, 0.5, 0.8].forEach(r => {
            this.group.add(new Konva.Circle({ x: rfX+7, y: py-8+flangeH*r, radius: 3, fill: '#37474f', stroke: '#263238', strokeWidth: 0.5 }));
        });

        // 管壁高光
        const topSheen = new Konva.Rect({
            x: px, y: py, width: pw, height: 4,
            fill: 'rgba(255,255,255,0.12)', cornerRadius: [2,2,0,0],
        });

        this.group.add(pipeOuter, this._flowChannel, lFlange, rFlange, topSheen);
    }

    // ── 发生体（T形截面）──────────────────────
    _drawBluffBody() {
        const chanCY = this._flowChanY + this._flowChanH / 2;
        const chanH  = this._flowChanH;
        const bluffX = this._flowChanX + this._flowChanW * 0.35;  // 发生体中心 X
        const bluffW = 10;   // 发生体宽度（像素）
        const bluffH = chanH * 0.82;  // 发生体高度（贯穿大部分管道）

        this._bluffCX = bluffX;
        this._bluffBY = chanCY + bluffH / 2;  // 发生体底部 Y（用于涡旋生成）

        // 发生体主体（T形，上下各有突起）
        const bluffBody = new Konva.Rect({
            x: bluffX - bluffW/2, y: chanCY - bluffH/2,
            width: bluffW, height: bluffH,
            fill: '#ff6f00', stroke: '#e65100', strokeWidth: 1.5, cornerRadius: 2,
        });
        // T形帽
        const topCap = new Konva.Rect({
            x: bluffX - bluffW*1.2, y: chanCY - bluffH/2,
            width: bluffW*2.4, height: 8,
            fill: '#ff6f00', stroke: '#e65100', strokeWidth: 1, cornerRadius: 1,
        });
        const botCap = new Konva.Rect({
            x: bluffX - bluffW*1.2, y: chanCY + bluffH/2 - 8,
            width: bluffW*2.4, height: 8,
            fill: '#ff6f00', stroke: '#e65100', strokeWidth: 1, cornerRadius: 1,
        });
        // 发生体高光
        const bluffGlint = new Konva.Rect({
            x: bluffX - bluffW/2 + 1, y: chanCY - bluffH/2 + 2,
            width: 3, height: bluffH - 4,
            fill: 'rgba(255,200,100,0.35)', cornerRadius: 1,
        });
        // 标注
        const bluffLbl = new Konva.Text({
            x: bluffX - 18, y: chanCY - bluffH/2 - 14,
            text: '发生体', fontSize: 8.5, fill: '#ff8f00',
        });
        const arrowLbl = new Konva.Text({
            x: this._flowChanX + 6, y: chanCY - 5,
            text: '→ 流向', fontSize: 8, fill: '#546e7a',
        });

        this._bluffCX = bluffX;
        this.group.add(bluffBody, topCap, botCap, bluffGlint, bluffLbl, arrowLbl);
    }

    // ── 流向箭头 ───────────────────────────────
    _drawFlowArrows() {
        const chanCY = this._flowChanY + this._flowChanH / 2;
        const arrowXs = [
            this._flowChanX + 15,
            this._flowChanX + this._flowChanW * 0.72,
            this._flowChanX + this._flowChanW * 0.88,
        ];
        arrowXs.forEach((ax, i) => {
            const arrow = new Konva.Line({
                points: [ax, chanCY, ax + 18, chanCY],
                stroke: 'rgba(79,195,247,0.4)',
                strokeWidth: i === 0 ? 2 : 1.5,
                lineCap: 'round',
            });
            // 箭头头部
            const head = new Konva.Line({
                points: [ax+12, chanCY-4, ax+18, chanCY, ax+12, chanCY+4],
                stroke: 'rgba(79,195,247,0.4)',
                strokeWidth: i === 0 ? 2 : 1.5,
                lineCap: 'round', lineJoin: 'round',
            });
            this.group.add(arrow, head);
        });
    }

    // ── 涡街动画容器 ──────────────────────────
    _drawVortexLayer() {
        this._vortexGroup   = new Konva.Group();  // 涡旋粒子
        this._particleGroup = new Konva.Group();  // 示踪粒子
        this.group.add(this._vortexGroup, this._particleGroup);
    }

    // ── 压电传感器探头（管壁顶部）────────────
    _drawSensorProbe() {
        const chanCY = this._flowChanY + this._flowChanH / 2;
        const probeX = this._bluffCX + this._flowChanW * 0.12;

        // 探头外壳
        const probe = new Konva.Rect({
            x: probeX - 5, y: this._pipeY - 8,
            width: 10, height: 20,
            fill: '#c0ca33', stroke: '#9e9d24', strokeWidth: 1, cornerRadius: [3,3,0,0],
        });
        // 探头针（穿入管壁）
        const needle = new Konva.Rect({
            x: probeX - 2, y: this._pipeY + 12,
            width: 4, height: this._flowChanH * 0.38,
            fill: '#f9a825', stroke: '#e65100', strokeWidth: 0.5, cornerRadius: 1,
        });
        // 压电信号指示灯
        this._probeLed = new Konva.Circle({
            x: probeX, y: this._pipeY - 2,
            radius: 3.5, fill: '#333',
        });
        const probeLbl = new Konva.Text({
            x: probeX - 16, y: this._pipeY - 20,
            text: '压电探头', fontSize: 8, fill: '#c0ca33',
        });

        this.group.add(probe, needle, this._probeLed, probeLbl);
    }

    // ── 仪表头（右侧接线盒+外壳）───────────────
    _drawInstrumentHead() {
        const hx = this._headX, hy = this._headY;
        const hw = this._headW;

        // 接线盒
        const jbox = new Konva.Rect({
            x: hx, y: hy, width: hw, height: 52,
            fill: '#cfd8dc', stroke: '#90a4ae', strokeWidth: 1.5,
            cornerRadius: [5,5,0,0],
        });
        for (let i = 0; i < 4; i++) {
            this.group.add(new Konva.Line({
                points: [hx, hy+8+i*10, hx+hw, hy+8+i*10],
                stroke: 'rgba(255,255,255,0.15)', strokeWidth: 0.8,
            }));
        }
        const lcap = new Konva.Rect({ x: hx, y: hy+5, width: 14, height: 44, fill: '#b0bec5', stroke: '#78909c', strokeWidth: 1, cornerRadius: [2,0,0,2] });
        const rcap = new Konva.Rect({ x: hx+hw-14, y: hy+5, width: 14, height: 44, fill: '#b0bec5', stroke: '#78909c', strokeWidth: 1, cornerRadius: [0,2,2,0] });
        const plate = new Konva.Rect({ x: hx+18, y: hy+8, width: hw-36, height: 28, fill: '#eceff1', stroke: '#b0bec5', strokeWidth: 0.5, cornerRadius: 2 });
        this._idText = new Konva.Text({ x: hx+18, y: hy+11, width: hw-36, text: this.id || 'FT-301', fontSize: 9, fontStyle: 'bold', fill: '#263238', align: 'center' });
        this.group.add(new Konva.Text({ x: hx+18, y: hy+21, width: hw-36, text: 'VORTEX  4~20mA', fontSize: 7, fill: '#78909c', align: 'center' }));

        // 主体圆筒（仪表头外壳）
        const bodyY = hy + 52;
        const bodyH = this.height - 52 - 55;
        const bodyX = hx;
        const body = new Konva.Rect({
            x: bodyX, y: bodyY, width: hw, height: bodyH,
            fill: '#2c3e50', stroke: '#1a252f', strokeWidth: 1.5, cornerRadius: [0,0,4,4],
        });
        const bodySheen = new Konva.Rect({
            x: bodyX+2, y: bodyY+2, width: 7, height: bodyH-4,
            fill: 'rgba(255,255,255,0.05)', cornerRadius: 2,
        });

        this._headBodyY = bodyY;
        this._headBodyH = bodyH;

        this.group.add(jbox, lcap, rcap, plate, this._idText, body, bodySheen);
    }

    // ── 圆形 LCD 显示 ──────────────────────────
    _drawLCDDisplay() {
        const hx = this._headX, hw = this._headW;
        const lcCX = hx + hw / 2;
        const lcCY = this._headBodyY + this._headBodyH / 2;
        this._lcCX = lcCX; this._lcCY = lcCY;

        const R = Math.min(hw, this._headBodyH) * 0.42;
        this._lcR = R;

        // 外圈
        const outer = new Konva.Circle({ x: lcCX, y: lcCY, radius: R+4, fill: '#1a252f', stroke: '#0d1520', strokeWidth: 1 });
        // 橙色工业风外环
        const midRing = new Konva.Circle({ x: lcCX, y: lcCY, radius: R+2, fill: '#bf360c', stroke: '#e64a19', strokeWidth: 2.5 });
        this._lcdBg = new Konva.Circle({ x: lcCX, y: lcCY, radius: R, fill: '#020c14' });

        // 涡频波形指示（小弧线环）
        this._freqArc = new Konva.Arc({
            x: lcCX, y: lcCY,
            innerRadius: R-6, outerRadius: R-4,
            angle: 0, fill: '#ff6f00', rotation: -90,
        });

        // 主数值
        this._lcdMain = new Konva.Text({
            x: lcCX - R+6, y: lcCY - R*0.35,
            width: (R-6)*2, text: '--.-',
            fontSize: R * 0.38,
            fontFamily: 'Courier New, monospace',
            fontStyle: 'bold', fill: '#ff6f00', align: 'center',
        });
        // 单位
        this._lcdUnit = new Konva.Text({
            x: lcCX - R+6, y: lcCY + R*0.08,
            width: (R-6)*2, text: this.unit,
            fontSize: R * 0.18, fill: '#bf360c', align: 'center',
        });
        // 涡频小字
        this._lcdFreq = new Konva.Text({
            x: lcCX - R+6, y: lcCY + R*0.3,
            width: (R-6)*2, text: 'f=-- Hz',
            fontSize: R * 0.16,
            fontFamily: 'Courier New, monospace',
            fill: '#546e7a', align: 'center',
        });
        // 电流小字（顶部）
        this._lcdCurrent = new Konva.Text({
            x: lcCX - R+6, y: lcCY - R*0.58,
            width: (R-6)*2, text: '4.00 mA',
            fontSize: R * 0.15,
            fontFamily: 'Courier New, monospace',
            fill: '#80cbc4', align: 'center',
        });

        this.group.add(outer, midRing, this._lcdBg, this._freqArc,
            this._lcdMain, this._lcdUnit, this._lcdFreq, this._lcdCurrent);
    }

    // ── 零点/量程旋钮 ────────────────────────
    _drawKnobs() {
        const hx = this._headX, hw = this._headW;
        const ky = this._headBodyY + this._headBodyH + 10;
        [{ id: 'zero', x: hx + hw*0.28, label: 'Z' },
         { id: 'span', x: hx + hw*0.72, label: 'S' }].forEach(k => {
            const g = new Konva.Group({ x: k.x, y: ky });
            g.add(new Konva.Circle({ radius: 11, fill: '#cfd8dc', stroke: '#90a4ae', strokeWidth: 1 }));
            const rotor = new Konva.Group();
            rotor.add(new Konva.Circle({ radius: 8, fill: '#eceff1', stroke: '#37474f', strokeWidth: 1 }));
            rotor.add(new Konva.Line({ points: [0, -7, 0, 7], stroke: '#37474f', strokeWidth: 2.5, lineCap: 'round' }));
            g.add(rotor, new Konva.Text({ x: -5, y: 13, text: k.label, fontSize: 9, fontStyle: 'bold', fill: '#607d8b' }));
            this.knobs[k.id] = rotor;

            rotor.on('mousedown touchstart', (e) => {
                e.cancelBubble = true;
                const sy = e.evt.clientY ?? e.evt.touches?.[0]?.clientY ?? 0;
                const startRot = rotor.rotation();
                const onMove = (me) => {
                    const cy = me.clientY ?? me.touches?.[0]?.clientY ?? 0;
                    rotor.rotation(startRot + (sy - cy) * 2);
                    if (k.id === 'zero') this.zeroAdj = (rotor.rotation() / 360) * 0.04;
                    else                 this.spanAdj = 1 + (rotor.rotation() / 360) * 0.3;
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
            this.group.add(g);
        });
    }

    // ── 底部综合显示栏 ─────────────────────────
    _drawBottomPanel() {
        const py = this.height - 44;
        const pw = this.width - 8;

        const bg = new Konva.Rect({
            x: 4, y: py, width: pw, height: 40,
            fill: '#0a1520', stroke: '#1a3040', strokeWidth: 1, cornerRadius: 4,
        });
        this._panelTotal = new Konva.Text({
            x: 10, y: py + 5, width: pw * 0.45,
            text: 'Σ 0.000 m³',
            fontSize: 9, fontFamily: 'Courier New, monospace',
            fontStyle: 'bold', fill: '#80cbc4',
        });
        this._panelPulse = new Konva.Text({
            x: 10, y: py + 20, width: pw * 0.45,
            text: '脉冲: 0',
            fontSize: 8, fontFamily: 'Courier New, monospace',
            fill: '#37474f',
        });
        this._panelStatus = new Konva.Text({
            x: pw * 0.48 + 4, y: py + 5, width: pw * 0.5,
            text: '● 正常运行',
            fontSize: 9, fontStyle: 'bold', fill: '#66bb6a', align: 'right',
        });
        this._panelVel = new Konva.Text({
            x: pw * 0.48 + 4, y: py + 20, width: pw * 0.5,
            text: 'v=0.00 m/s',
            fontSize: 8, fontFamily: 'Courier New, monospace',
            fill: '#37474f', align: 'right',
        });

        this.group.add(bg, this._panelTotal, this._panelPulse, this._panelStatus, this._panelVel);
    }

    // ═══════════════════════════════════════════════
    //  动画主循环
    // ═══════════════════════════════════════════════
    _startAnimation() {
        const tick = (ts) => {
            if (this._lastTs !== null) {
                const dt = Math.min((ts - this._lastTs) / 1000, 0.05);
                this._tickPhysics(dt);
                this._tickVortex(dt);
                this._tickParticles(dt);
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

    // ── 物理计算 ─────────────────────────────────
    _tickPhysics(dt) {
        const flowNow = this.flow;  // 由 update() 注入

        // 调整后流量
        const adjFlow = Math.max(0, (flowNow + this.zeroAdj * this.maxFlow) * this.spanAdj);
        const A = Math.PI * Math.pow(this.pipeDiam / 2, 2);
        this.velocity   = adjFlow / 3600 / A;   // m/s
        this.vortexFreq = this.strouhal * this.velocity / this.bluffWidth;  // Hz

        // 小流量切除（< 5%）
        this.isLowFlow  = adjFlow < this.maxFlow * 0.05;
        const displayFlow = this.isLowFlow ? 0 : adjFlow;

        this.outCurrent = 4 + Math.min(1, displayFlow / this.maxFlow) * 16;

        // 脉冲累积（涡频 → 脉冲）
        if (this.powered && !this.isBreak && !this.isLowFlow) {
            this._pulseTimer += dt;
            if (this.vortexFreq > 0) {
                this._pulsePeriod = 1 / this.vortexFreq;
                while (this._pulseTimer >= this._pulsePeriod) {
                    this._pulseTimer -= this._pulsePeriod;
                    this.pulseCount++;
                    this._pulseState = this._pulseState ? 0 : 1;
                }
            }
            this.totalFlow += displayFlow * dt / 3600;
        }

        // 压电探头 LED 随涡脱落闪烁
        if (this._probeLed) {
            const active = this.powered && !this.isBreak && this.vortexFreq > 0;
            this._probeLed.fill(active && this._pulseState ? '#ffee58' : (active ? '#333' : '#1a1a1a'));
        }

        // LCD 频率弧（扇形，代表涡频占量程的比例）
        if (this._freqArc) {
            const freqRatio = Math.min(1, this.vortexFreq / (this.strouhal * (this.maxFlow/3600/A) / this.bluffWidth));
            this._freqArc.angle(freqRatio * 360);
        }
    }

    // ── 卡门涡街粒子 ──────────────────────────
    _tickVortex(dt) {
        const cx1 = this._flowChanX;
        const cy  = this._flowChanY + this._flowChanH / 2;
        const active = this.powered && !this.isBreak && this.vortexFreq > 0 && !this.isLowFlow;

        // 发生体下游右侧区域
        const vortexOriginX = this._bluffCX + 8;

        if (active) {
            this._vortexTimer -= dt;
            if (this._vortexTimer <= 0 && this.vortexFreq > 0) {
                this._vortexTimer = 1 / (this.vortexFreq * 1.2);
                const sideY = cy + this._vortexSide * (this._flowChanH * 0.28);
                this._vortexSide *= -1;  // 交替上下

                // 创建涡旋粒子
                this._vortices.push({
                    x: vortexOriginX,
                    y: sideY,
                    r: 3 + this.velocity * 0.8,
                    maxR: 12 + this.velocity * 2,
                    rot: 0,
                    rotDir: this._vortexSide < 0 ? 1 : -1,  // 旋转方向
                    alpha: 0.9,
                    vx: this.velocity * 8 + 20,  // px/s 水平漂移
                    vy: this._vortexSide * 4,
                    age: 0,
                });
            }
        }

        // 更新涡旋
        const right = this._flowChanX + this._flowChanW;
        this._vortices = this._vortices.filter(v => {
            v.age   += dt;
            v.x     += v.vx * dt;
            v.y     += v.vy * dt * Math.max(0, 1 - v.age * 2);
            v.rot   += v.rotDir * 360 * dt * (this.vortexFreq * 0.8 + 1);
            v.r      = Math.min(v.maxR, v.r + dt * 8);
            v.alpha  = Math.max(0, 0.9 - v.age * 0.8);
            return v.alpha > 0.05 && v.x < right + 20;
        });

        // 重建涡旋节点
        this._vortexGroup.destroyChildren();
        this._vortices.forEach(v => {
            // 涡旋：旋转箭头圆弧
            const color = v.rotDir > 0
                ? `rgba(255,111,0,${v.alpha})`
                : `rgba(41,182,246,${v.alpha})`;

            // 弧线代表旋涡
            for (let a = 0; a < 3; a++) {
                const arc = new Konva.Arc({
                    x: v.x, y: v.y,
                    innerRadius: v.r * 0.5, outerRadius: v.r * 0.5 + 1.5,
                    angle: 240,
                    rotation: v.rot + a * 120,
                    fill: color,
                });
                this._vortexGroup.add(arc);
            }
        });
    }

    // ── 示踪粒子（流体可视化）────────────────
    _tickParticles(dt) {
        const active = this.powered && !this.isBreak && this.velocity > 0;
        const cx1 = this._flowChanX;
        const cy  = this._flowChanY;
        const ch  = this._flowChanH;
        const right = this._flowChanX + this._flowChanW;

        // 生成粒子
        const spawnRate = active ? Math.min(6, this.velocity * 1.5 + 0.5) : 0;
        if (Math.random() < spawnRate * dt) {
            this._particles.push({
                x: cx1 + 2,
                y: cy + 4 + Math.random() * (ch - 8),
                r: 1.2 + Math.random(),
                vx: this.velocity * 10 + 15 + Math.random() * 10,
                alpha: 0.5 + Math.random() * 0.3,
                trail: [],
            });
        }

        // 更新粒子
        this._particles = this._particles.filter(p => {
            p.trail.push({ x: p.x, y: p.y });
            if (p.trail.length > 8) p.trail.shift();

            // 发生体附近扰动
            const dx = p.x - this._bluffCX;
            const dy = p.y - (cy + ch/2);
            if (Math.abs(dx) < 18 && Math.abs(dy) < ch*0.4) {
                p.vy = (p.vy || 0) + dy * 0.5 * dt;
                p.vx *= 0.85;
            }

            p.x += p.vx * dt;
            p.y += (p.vy || 0) * dt;
            p.y  = Math.max(cy+3, Math.min(cy+ch-3, p.y));
            p.alpha -= dt * 0.6;
            return p.x < right && p.alpha > 0.05;
        });

        // 绘制粒子
        this._particleGroup.destroyChildren();
        this._particles.forEach(p => {
            // 拖尾
            if (p.trail.length > 2) {
                const trailPts = p.trail.flatMap(t => [t.x, t.y]);
                this._particleGroup.add(new Konva.Line({
                    points: trailPts,
                    stroke: `rgba(79,195,247,${p.alpha * 0.4})`,
                    strokeWidth: 1, lineCap: 'round', lineJoin: 'round',
                }));
            }
            // 粒子本体
            this._particleGroup.add(new Konva.Circle({
                x: p.x, y: p.y, radius: p.r,
                fill: `rgba(100,200,255,${p.alpha})`,
            }));
        });
    }

    // ── 显示更新 ─────────────────────────────
    _tickDisplay() {
        const pw = this.powered, br = this.isBreak;

        if (!pw) {
            this._lcdMain.text('----'); this._lcdMain.fill('#1a3040');
            this._lcdUnit.text('');
            this._lcdFreq.text('f=-- Hz'); this._lcdFreq.fill('#1a3040');
            this._lcdCurrent.text('-- mA');
            this._lcdBg.fill('#020c14');
            this._panelStatus.text('○ 断电'); this._panelStatus.fill('#37474f');
            return;
        }
        if (br) {
            this._lcdMain.text('FAIL'); this._lcdMain.fill('#ef5350');
            this._lcdUnit.text('');
            this._lcdFreq.text('ERR'); this._lcdFreq.fill('#ef5350');
            this._lcdCurrent.text('1.8 mA');
            this._lcdBg.fill('#1a0808');
            this._panelStatus.text('⚠ 断线故障'); this._panelStatus.fill('#ef5350');
            return;
        }

        const adjFlow = Math.max(0, (this.flow + this.zeroAdj * this.maxFlow) * this.spanAdj);
        const displayFlow = this.isLowFlow ? 0 : adjFlow;
        const ratio = displayFlow / this.maxFlow;
        const mainColor = ratio > 0.9 ? '#ff5722' : ratio > 0.1 ? '#ff6f00' : '#ff8f00';
        const bgColor = '#020c14';

        const txt = this.outCurrent < 3.8 ? 'LLLL' :
                    this.outCurrent > 20.5 ? 'HHHH' :
                    displayFlow.toFixed(1);

        this._lcdBg.fill(bgColor);
        this._lcdMain.text(txt); this._lcdMain.fill(mainColor);
        this._lcdUnit.text(this.unit);
        this._lcdFreq.text(`f=${this.vortexFreq.toFixed(1)} Hz`);
        this._lcdFreq.fill(this.vortexFreq > 0 ? '#78909c' : '#37474f');
        this._lcdCurrent.text(`${this.outCurrent.toFixed(2)} mA`);

        const stStr = this.isLowFlow ? '↓ 小流量切除' :
                      ratio > 0.9   ? '⬆ 流量超量程' :
                      displayFlow > 0 ? '● 正常运行' : '○ 零流量';
        const stCol = this.isLowFlow ? '#ff8f00' :
                      ratio > 0.9   ? '#ff5722' :
                      displayFlow > 0 ? '#66bb6a' : '#546e7a';
        this._panelStatus.text(stStr); this._panelStatus.fill(stCol);
        this._panelTotal.text(`Σ ${this.totalFlow.toFixed(3)} m³`);
        this._panelPulse.text(`脉冲: ${this.pulseCount}`);
        this._panelVel.text(`v=${this.velocity.toFixed(2)} m/s`);
    }

    // ═══════════════════════════════════════════════
    //  气路求解器接口
    // ═══════════════════════════════════════════════
    /**
     * @param {number} press  管道压力 (MPa)
     * @param {number} [flow] 流量 (m³/h)，来自 segmentFlows
     */
    update(press, flow) {
        this.press = typeof press === 'number' ? press : 0;
        if (typeof flow === 'number' && flow >= 0) {
            this.flow = flow;
        } else {
            // 退化：用压力估算流速
            const A   = Math.PI * Math.pow(this.pipeDiam / 2, 2);
            const vMax = this.maxFlow / 3600 / A;
            const pNorm = Math.min(1, Math.max(0, this.press / this.maxPress));
            this.flow = Math.sqrt(pNorm) * this.maxFlow;
        }
        this._refreshCache();
    }

    // ═══════════════════════════════════════════════
    //  配置面板
    // ═══════════════════════════════════════════════
    getConfigFields() {
        return [
            { label: '位号/名称',             key: 'id',          type: 'text'   },
            { label: '管道内径 (m)',           key: 'pipeDiam',    type: 'number' },
            { label: '发生体宽度 d (m)',       key: 'bluffWidth',  type: 'number' },
            { label: '斯特劳哈尔数 St',        key: 'strouhal',    type: 'number' },
            { label: '仪表系数 K (p/m³)',      key: 'kFactor',     type: 'number' },
            { label: '满量程流量',             key: 'maxFlow',     type: 'number' },
            { label: '介质名称',              key: 'fluidName',   type: 'text'   },
            { label: '显示单位',              key: 'unit',        type: 'select',
              options: [{ label: 'm³/h', value: 'm³/h' }, { label: 'Nm³/h', value: 'Nm³/h' }, { label: 'kg/h', value: 'kg/h' }] },
        ];
    }

    onConfigUpdate(cfg) {
        this.id         = cfg.id         || this.id;
        this.pipeDiam   = parseFloat(cfg.pipeDiam)   || this.pipeDiam;
        this.bluffWidth = parseFloat(cfg.bluffWidth) || this.bluffWidth;
        this.strouhal   = parseFloat(cfg.strouhal)   || this.strouhal;
        this.kFactor    = parseFloat(cfg.kFactor)    || this.kFactor;
        this.maxFlow    = parseFloat(cfg.maxFlow)    || this.maxFlow;
        this.fluidName  = cfg.fluidName  || this.fluidName;
        this.unit       = cfg.unit       || this.unit;
        this.config     = { ...this.config, ...cfg };
        if (this._idText) this._idText.text(this.id);
        this._refreshCache();
    }

    destroy() {
        this._stopAnimation();
        super.destroy?.();
    }
}