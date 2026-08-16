import { BaseComponent } from './BaseComponent.js';

/**
 * 电磁流量变送器仿真组件（Electromagnetic Flow Transmitter）
 *
 * ── 物理原理 ──────────────────────────────────────────────
 *  基于法拉第电磁感应定律：
 *    E = B · D · v
 *  其中：
 *    E — 感应电动势 (mV)
 *    B — 磁场强度 (T)，由励磁线圈产生
 *    D — 管道内径 (m)
 *    v — 流体平均流速 (m/s)
 *
 *  流量计算：
 *    Q = v · A = v · π·(D/2)²
 *    → Q = (E / (B·D)) · π·(D/2)²
 *
 *  仿真简化：
 *    流速 v 由气路求解器注入的压力 P 驱动：
 *    v = v_max · (P / P_max)^0.5   （保持与气路物理一致的平方根特性）
 *    流量 Q = v · π·(D/2)²
 *    感应电动势 E = B · D · v      （作为内部中间量，用于展示）
 *
 * ── 端口布局 ──────────────────────────────────────────────
 *   pipe_i  — 管道进口（左侧中部）
 *   pipe_o  — 管道出口（右侧中部）
 *   wire_p  — 电源正极 24VDC（顶部接线盒右上）
 *   wire_n  — 4-20mA 输出 / 电源负极（顶部接线盒右下）
 *
 * ── 气路求解器集成 ──────────────────────────────────────
 *   special = 'press'   → 求解器注入 device.press = P_pipe_i
 *   update(press, flow) — 被求解器调用，flow 为 segmentFlows 中该段流量
 *                         两个值均可驱动显示，以 flow 为主（若可用），
 *                         否则退化到用 press 估算。
 */
export class MagFlowTransmitter extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.width  = Math.max(180, Math.min(config.width  || 200, 260));
        this.height = Math.max(220, Math.min(config.height || 240, 300));

        // ── 类型与求解器约定 ──
        this.type    = 'mag_flow_transmitter';
        this.special = 'press';   // 求解器注入 pipe_i 压力
        this.cache   = 'fixed';

        // ── 仪表量程参数 ──
        this.minFlow    = 0;
        this.maxFlow    = config.maxFlow    || 100;    // m³/h
        this.maxPress   = config.maxPress   || 0.6;    // MPa，对应满量程
        this.pipeDiam   = config.pipeDiam   || 0.1;    // 管道内径 m（DN100）
        this.magField   = config.magField   || 0.03;   // 励磁磁场强度 T
        this.unit       = config.unit       || 'm³/h';
        this.fluidCond  = config.fluidCond  || 500;    // 流体电导率 μS/cm（仅显示用）

        // ── 零点/量程调节 ──
        this.zeroAdj = 0;
        this.spanAdj = 1.0;

        // ── 运行状态 ──
        this.press      = 0;
        this.flow       = 0;
        this.velocity   = 0;     // 流速 m/s
        this.emf        = 0;     // 感应电动势 mV
        this.outCurrent = 4;     // 4-20mA
        this.totalFlow  = 0;     // 累积流量 m³（积算仪）
        this.isBreak    = false;
        this.powered    = false;
        this.isEmpty    = false; // 管道空管检测

        // ── 励磁动画相位 ──
        this._excPhase  = 0;
        this._animId    = null;
        this._lastTs    = null;

        this.config = {
            id: this.id, maxFlow: this.maxFlow,
            maxPress: this.maxPress, pipeDiam: this.pipeDiam,
            magField: this.magField, unit: this.unit,
        };

        this.knobs = {};
        this._init();

        // 端口：进出管道在左右中部，电气接线在顶部右侧
        const midY = this.height / 2 + 20;
        this.addPort(0,             midY, 'i', 'pipe', 'in');
        this.addPort(this.width,    midY, 'o', 'pipe', 'out');
        this.addPort(this.width,    28,   'p', 'wire', 'P');
        this.addPort(this.width,    54,   'n', 'wire', 'N');
    }

    // ═══════════════════════════════════════════
    //  初始化绘制
    // ═══════════════════════════════════════════
    _init() {
        this._drawLabel();
        this._drawJunctionBox();
        this._drawSensorTube();
        this._drawCoilAssembly();
        this._drawElectrodeMarkers();
        this._drawDisplayHead();
        this._drawKnobs();
        this._startExcAnimation();
    }

    _drawLabel() {
        this._labelNode = new Konva.Text({
            x: 0, y: -22, width: this.width,
            text: '电磁流量变送器',
            fontSize: 14, fontStyle: 'bold',
            fill: '#1a2634', align: 'center',
        });
        this.group.add(this._labelNode);
    }

    // ── 顶部接线盒 ────────────────────────────
    _drawJunctionBox() {
        const W = this.width;
        const jBox = new Konva.Rect({
            x: 20, y: 6, width: W - 40, height: 48,
            fill: '#dde3ea', stroke: '#99a8b5', strokeWidth: 1, cornerRadius: 4,
        });
        const jBoxSheen = new Konva.Rect({
            x: 22, y: 8, width: 8, height: 44,
            fill: 'rgba(255,255,255,0.35)', cornerRadius: 2,
        });
        // 左右六角封盖
        const lCap = new Konva.Rect({ x: 0,    y: 10, width: 20, height: 38, fill: '#b0bec5', stroke: '#78909c', strokeWidth: 1, cornerRadius: [2,0,0,2] });
        const rCap = new Konva.Rect({ x: W-20, y: 10, width: 20, height: 38, fill: '#b0bec5', stroke: '#78909c', strokeWidth: 1, cornerRadius: [0,2,2,0] });

        // 铭牌
        this._jNameplate = new Konva.Rect({
            x: W/2 - 40, y: 14, width: 80, height: 30,
            fill: '#f5f7fa', stroke: '#c8d0d8', strokeWidth: 0.5, cornerRadius: 2,
        });
        this._jTagText = new Konva.Text({
            x: W/2 - 38, y: 17, width: 76,
            text: this.id || 'FE-101',
            fontSize: 10, fontStyle: 'bold', fill: '#1a2634', align: 'center',
        });
        this._jTypeText = new Konva.Text({
            x: W/2 - 38, y: 29, width: 76,
            text: 'ELECTROMAGNETIC',
            fontSize: 7.5, fill: '#607d8b', align: 'center',
        });

        this.group.add(jBox, jBoxSheen, lCap, rCap, this._jNameplate, this._jTagText, this._jTypeText);
    }

    // ── 传感器管段（水平测量管）────────────────
    _drawSensorTube() {
        const W = this.width;
        const midY = this.height / 2 + 20;
        this._midY = midY;
        const tubeH = 44;  // 管道外径对应高度
        const tubeY = midY - tubeH / 2;
        this._tubeY = tubeY;
        this._tubeH = tubeH;

        // 管道主体（深蓝黑色衬里管）
        const tubeOuter = new Konva.Rect({
            x: 0, y: tubeY, width: W, height: tubeH,
            fill: '#1c2b3a', stroke: '#0d1b2a', strokeWidth: 1.5,
        });
        // 管道内腔（流体通道，颜色随状态变化）
        this._tubeInner = new Konva.Rect({
            x: 2, y: tubeY + 6, width: W - 4, height: tubeH - 12,
            fill: '#0d2137',
        });
        // 管道衬里高光
        const tubeSheenT = new Konva.Rect({
            x: 0, y: tubeY, width: W, height: 4,
            fill: 'rgba(255,255,255,0.12)',
        });
        const tubeSheenB = new Konva.Rect({
            x: 0, y: tubeY + tubeH - 4, width: W, height: 4,
            fill: 'rgba(0,0,0,0.2)',
        });

        // 法兰盘（左右两端）
        const flangeW = 14, flangeH = tubeH + 16;
        const flangeY = tubeY - 8;
        this._drawFlange(0,       flangeY, flangeW, flangeH, 'left');
        this._drawFlange(W - flangeW, flangeY, flangeW, flangeH, 'right');

        // 流体粒子容器（画布层，由励磁动画驱动）
        this._particleGroup = new Konva.Group();

        this.group.add(tubeOuter, this._tubeInner, tubeSheenT, tubeSheenB, this._particleGroup);
    }

    _drawFlange(x, y, w, h, side) {
        const flange = new Konva.Rect({
            x, y, width: w, height: h,
            fill: '#607d8b', stroke: '#455a64', strokeWidth: 1,
            cornerRadius: side === 'left' ? [3,0,0,3] : [0,3,3,0],
        });
        // 法兰螺孔
        const holes = [0.2, 0.5, 0.8];
        holes.forEach(ratio => {
            const hx = x + w / 2;
            const hy = y + h * ratio;
            this.group.add(new Konva.Circle({ x: hx, y: hy, radius: 3, fill: '#37474f', stroke: '#263238', strokeWidth: 0.5 }));
            this.group.add(new Konva.Circle({ x: hx - 0.8, y: hy - 0.8, radius: 1, fill: 'rgba(255,255,255,0.2)' }));
        });
        this.group.add(flange);
    }

    // ── 励磁线圈组件（管道上下各一个线圈壳）────
    _drawCoilAssembly() {
        const W = this.width;
        const coilW = 50, coilH = 28;
        const coilCX = W / 2;

        // 上线圈壳
        const topCoilY = this._tubeY - coilH;
        const topCoil = new Konva.Rect({
            x: coilCX - coilW/2, y: topCoilY,
            width: coilW, height: coilH,
            fill: '#37474f', stroke: '#263238', strokeWidth: 1, cornerRadius: [4,4,0,0],
        });
        const topCoilLabel = new Konva.Text({
            x: coilCX - coilW/2, y: topCoilY + 7,
            width: coilW, text: 'COIL +',
            fontSize: 9, fill: '#90a4ae', align: 'center',
        });
        // 励磁线圈绕组纹（装饰线条）
        for (let i = 0; i < 6; i++) {
            const lx = coilCX - coilW/2 + 6 + i * 7;
            this.group.add(new Konva.Line({
                points: [lx, topCoilY + 2, lx, topCoilY + coilH - 2],
                stroke: '#546e7a', strokeWidth: 1, opacity: 0.6,
            }));
        }

        // 下线圈壳
        const botCoilY = this._tubeY + this._tubeH;
        const botCoil = new Konva.Rect({
            x: coilCX - coilW/2, y: botCoilY,
            width: coilW, height: coilH,
            fill: '#37474f', stroke: '#263238', strokeWidth: 1, cornerRadius: [0,0,4,4],
        });
        const botCoilLabel = new Konva.Text({
            x: coilCX - coilW/2, y: botCoilY + 7,
            width: coilW, text: 'COIL −',
            fontSize: 9, fill: '#90a4ae', align: 'center',
        });
        for (let i = 0; i < 6; i++) {
            const lx = coilCX - coilW/2 + 6 + i * 7;
            this.group.add(new Konva.Line({
                points: [lx, botCoilY + 2, lx, botCoilY + coilH - 2],
                stroke: '#546e7a', strokeWidth: 1, opacity: 0.6,
            }));
        }

        // 磁力线（上下线圈中心连线，虚线，动态驱动）
        this._magLine = new Konva.Line({
            points: [
                coilCX, topCoilY + coilH,
                coilCX, botCoilY,
            ],
            stroke: '#29b6f6', strokeWidth: 1.5,
            dash: [4, 3], opacity: 0.4,
        });

        this.group.add(topCoil, topCoilLabel, botCoil, botCoilLabel, this._magLine);
    }

    // ── 电极标记（管道两侧，测量感应电动势）──
    _drawElectrodeMarkers() {
        const W = this.width;
        const elecX = [W * 0.35, W * 0.65];
        elecX.forEach((ex, idx) => {
            // 电极螺钉外壳
            const elecOuter = new Konva.Rect({
                x: ex - 6, y: this._tubeY - 8,
                width: 12, height: 8,
                fill: '#607d8b', stroke: '#455a64', strokeWidth: 1, cornerRadius: [2,2,0,0],
            });
            const elecOuter2 = new Konva.Rect({
                x: ex - 6, y: this._tubeY + this._tubeH,
                width: 12, height: 8,
                fill: '#607d8b', stroke: '#455a64', strokeWidth: 1, cornerRadius: [0,0,2,2],
            });
            // 电极尖端（伸入管道内壁）
            this._elecDot = new Konva.Circle({
                x: ex, y: this._midY,
                radius: 3.5,
                fill: '#ffd54f', stroke: '#f9a825', strokeWidth: 1,
            });
            this.group.add(elecOuter, elecOuter2);
            if (idx === 0) this._elecDotL = this._elecDot;
            else           this._elecDotR = this._elecDot;
            this.group.add(this._elecDot);
        });
    }

    // ── 表头圆形显示模组 ─────────────────────
    _drawDisplayHead() {
        const W = this.width;
        const headCX = W / 2;
        // 表头安装于顶部接线盒之上（视觉上嵌入）
        const headY = 54;
        this._headY = headY;

        // 外圈黑色金属环
        const outerRing = new Konva.Circle({
            x: headCX, y: headY, radius: 46,
            fill: '#1c2b3a', stroke: '#0d1b2a', strokeWidth: 2,
        });
        // 中圈（蓝灰色，工业蓝调）
        const midRing = new Konva.Circle({
            x: headCX, y: headY, radius: 43,
            fill: '#1565c0', stroke: '#0d47a1', strokeWidth: 3,
        });
        // 显示屏背景
        this._lcdBg = new Konva.Circle({
            x: headCX, y: headY, radius: 34,
            fill: '#020f1c',
        });

        // ── 显示文字层 ──
        // 顶部小字：电流输出
        this._lcdCurrent = new Konva.Text({
            x: headCX - 30, y: headY - 32,
            width: 60, text: '',
            fontSize: 9, fontFamily: 'Courier New, monospace',
            fill: '#4fc3f7', align: 'center', opacity: 0,
        });
        // 主数值
        this._lcdMain = new Konva.Text({
            x: headCX - 34, y: headY - 14,
            width: 68, text: '----',
            fontSize: 16, fontFamily: 'Courier New, monospace',
            fontStyle: 'bold', fill: '#4fc3f7', align: 'center',
        });
        // 单位
        this._lcdUnit = new Konva.Text({
            x: headCX - 26, y: headY + 4,
            width: 52, text: '',
            fontSize: 10, fill: '#80deea', align: 'center', opacity: 0,
        });
        // 流速小字
        this._lcdVelo = new Konva.Text({
            x: headCX - 30, y: headY + 16,
            width: 60, text: '',
            fontSize: 9, fontFamily: 'Courier New, monospace',
            fill: '#546e7a', align: 'center', opacity: 0,
        });
        // EMF 小字
        this._lcdEMF = new Konva.Text({
            x: headCX - 30, y: headY + 26,
            width: 60, text: '',
            fontSize: 8, fill: '#37474f', align: 'center', opacity: 0,
        });
        // 累积量小字（底部）
        this._lcdTotal = new Konva.Text({
            x: headCX - 30, y: headY + 36,
            width: 60, text: '',
            fontSize: 8, fontFamily: 'Courier New, monospace',
            fill: '#455a64', align: 'center', opacity: 0,
        });

        this.group.add(
            outerRing, midRing, this._lcdBg,
            this._lcdCurrent, this._lcdMain, this._lcdUnit,
            this._lcdVelo, this._lcdEMF, this._lcdTotal,
        );
    }

    // ── 零点/量程旋钮 ─────────────────────────
    _drawKnobs() {
        const knobDefs = [
            { id: 'zero', x: 32,             label: 'Z' },
            { id: 'span', x: this.width - 32, label: 'S' },
        ];
        knobDefs.forEach(k => {
            const g = new Konva.Group({ x: k.x, y: 33 });
            g.add(new Konva.Circle({ radius: 12, fill: '#cfd8dc', stroke: '#78909c', strokeWidth: 1 }));
            const rotor = new Konva.Group();
            rotor.add(new Konva.Circle({ radius: 9, fill: '#eceff1', stroke: '#37474f', strokeWidth: 1 }));
            rotor.add(new Konva.Line({ points: [0, -8, 0, 8], stroke: '#37474f', strokeWidth: 2.5, lineCap: 'round' }));
            g.add(rotor);
            g.add(new Konva.Text({ x: -5, y: 14, text: k.label, fontSize: 10, fontStyle: 'bold', fill: '#546e7a' }));
            this.knobs[k.id] = rotor;

            rotor.on('mousedown touchstart', (e) => {
                e.cancelBubble = true;
                const startY = e.evt.clientY ?? e.evt.touches?.[0]?.clientY ?? 0;
                const startRot = rotor.rotation();
                const onMove = (me) => {
                    const cy = me.clientY ?? me.touches?.[0]?.clientY ?? 0;
                    rotor.rotation(startRot + (startY - cy) * 2);
                    if (k.id === 'zero') this.zeroAdj = (rotor.rotation() / 360) * 0.04;
                    else                 this.spanAdj = 1.0 + (rotor.rotation() / 360) * 0.3;
                };
                const onUp = () => {
                    window.removeEventListener('mousemove', onMove);
                    window.removeEventListener('touchmove', onMove);
                    window.removeEventListener('mouseup', onUp);
                    window.removeEventListener('touchend', onUp);
                };
                window.addEventListener('mousemove', onMove);
                window.addEventListener('touchmove', onMove);
                window.addEventListener('mouseup', onUp);
                window.addEventListener('touchend', onUp);
            });
            this.group.add(g);
        });
    }

    // ═══════════════════════════════════════════
    //  励磁动画（管道内磁场脉冲闪烁）
    // ═══════════════════════════════════════════
    _startExcAnimation() {
        const animate = (ts) => {
            if (this._lastTs !== null) {
                const dt = (ts - this._lastTs) / 1000;
                this._excPhase = (this._excPhase + dt * 50) % (Math.PI * 2);

                if (this.powered && !this.isBreak) {
                    const pulse = 0.3 + 0.5 * Math.abs(Math.sin(this._excPhase));
                    const flowRatio = Math.min(1, this.flow / this.maxFlow);

                    // 磁力线脉动
                    if (this._magLine) this._magLine.opacity(pulse * 0.8);

                    // 管道内腔颜色随流量变化（0→深蓝, 满量程→亮蓝）
                    const r = Math.round(13  + flowRatio * 20);
                    const g = Math.round(33  + flowRatio * 80);
                    const b = Math.round(55  + flowRatio * 120);
                    if (this._tubeInner) this._tubeInner.fill(`rgb(${r},${g},${b})`);

                    // 电极点随感应电动势闪烁
                    const emfGlow = 0.5 + 0.5 * Math.sin(this._excPhase * 2);
                    const elecAlpha = Math.round((0.6 + flowRatio * 0.4) * emfGlow * 255).toString(16).padStart(2,'0');
                    if (this._elecDotL) this._elecDotL.fill(`#ffd54f${elecAlpha}`);
                    if (this._elecDotR) this._elecDotR.fill(`#ffd54f${elecAlpha}`);

                    // 累积流量积算（每帧）
                    this.totalFlow += this.flow * dt / 3600; // m³/h → m³/s → 积分
                } else {
                    if (this._magLine)   this._magLine.opacity(0.08);
                    if (this._tubeInner) this._tubeInner.fill('#0d2137');
                    if (this._elecDotL)  this._elecDotL.fill('#37474f');
                    if (this._elecDotR)  this._elecDotR.fill('#37474f');
                }

                // 触发 Konva 局部重绘
                this._refreshCache();
            }
            this._lastTs = ts;
            this._animId = requestAnimationFrame(animate);
        };
        this._animId = requestAnimationFrame(animate);
    }

    _stopAnimation() {
        if (this._animId) { cancelAnimationFrame(this._animId); this._animId = null; }
    }

    // ═══════════════════════════════════════════
    //  核心物理计算
    // ═══════════════════════════════════════════
    /**
     * 压力→流速→流量→EMF
     * @param {number} press  输入压力 (MPa)，由求解器注入
     * @returns {{ flow, velocity, emf, current }}
     */
    _compute(press) {
        if (!this.powered || this.isBreak || this.isEmpty) {
            return { flow: 0, velocity: 0, emf: 0, current: this.isBreak ? 1.8 : 4 };
        }

        const pNorm    = Math.min(1, Math.max(0, press / this.maxPress));
        const velocity = (this.maxFlow / (Math.PI * Math.pow(this.pipeDiam / 2, 2)) / 3600) * Math.sqrt(pNorm);
        const emf      = this.magField * this.pipeDiam * velocity * 1000; // mV
        const flowRaw  = velocity * Math.PI * Math.pow(this.pipeDiam / 2, 2) * 3600; // m³/h
        const flow     = Math.max(0, (flowRaw + this.zeroAdj * this.maxFlow) * this.spanAdj);
        const current  = 4 + Math.min(1, flow / this.maxFlow) * 16;

        return { flow, velocity, emf, current };
    }

    // ═══════════════════════════════════════════
    //  气路求解器接口
    // ═══════════════════════════════════════════
    /**
     * 由 PneumaticSolver._syncDevices() 调用。
     * special='press' 时注入 pipe_i 压力；
     * 若求解器也传入 flow（来自 segmentFlows），优先使用。
     *
     * @param {number} press  管道输入压力 (MPa)
     * @param {number} [flow] 管道流量 (m³/h)（可选，来自流量场求解）
     */
    update(press, flow) {
        this.press = typeof press === 'number' ? press : 0;

        let result;
        if (typeof flow === 'number' && flow >= 0) {
            // 流量场已解算：直接使用
            const velocity = flow / 3600 / (Math.PI * Math.pow(this.pipeDiam / 2, 2));
            const emf      = this.magField * this.pipeDiam * velocity * 1000;
            const adjFlow  = Math.max(0, (flow + this.zeroAdj * this.maxFlow) * this.spanAdj);
            const current  = (!this.powered || this.isBreak || this.isEmpty)
                ? (this.isBreak ? 1.8 : 4)
                : 4 + Math.min(1, adjFlow / this.maxFlow) * 16;
            result = { flow: adjFlow, velocity, emf, current };
        } else {
            result = this._compute(this.press);
        }

        this.flow       = result.flow;
        this.velocity   = result.velocity;
        this.emf        = result.emf;
        this.outCurrent = result.current;

        this._renderDisplay(result);
        this._refreshCache();
    }

    // ═══════════════════════════════════════════
    //  显示渲染
    // ═══════════════════════════════════════════
    _renderDisplay({ flow, velocity, emf, current }) {
        if (!this.powered) {
            this._lcdBg.fill('#020f1c');
            this._lcdMain.fill('#1a2634');
            this._lcdMain.text('----');
            this._lcdUnit.opacity(0);
            this._lcdVelo.opacity(0);
            this._lcdEMF.opacity(0);
            this._lcdTotal.opacity(0);
            this._lcdCurrent.opacity(0);
            return;
        }

        if (this.isBreak) {
            this._lcdBg.fill('#1a0808');
            this._lcdMain.fill('#ef5350');
            this._lcdMain.text('FAIL');
            this._lcdUnit.opacity(0);
            this._lcdVelo.opacity(0);
            this._lcdEMF.opacity(0);
            this._lcdCurrent.text('断线 <3.8mA');
            this._lcdCurrent.fill('#ef9a9a');
            this._lcdCurrent.opacity(1);
            this._lcdTotal.opacity(0);
            return;
        }

        if (this.isEmpty) {
            this._lcdBg.fill('#1a1200');
            this._lcdMain.fill('#ffb300');
            this._lcdMain.text('EMPTY');
            this._lcdUnit.opacity(0);
            this._lcdVelo.opacity(0);
            this._lcdEMF.opacity(0);
            this._lcdCurrent.text('空管报警');
            this._lcdCurrent.fill('#ffe082');
            this._lcdCurrent.opacity(1);
            this._lcdTotal.opacity(0);
            return;
        }

        // 正常显示
        const ratio     = flow / this.maxFlow;
        const precision = flow >= 10 ? 2 : 3;
        let mainColor, bgColor;
        if      (current < 3.8)  { mainColor = '#ef5350'; bgColor = '#1a0808'; }
        else if (current > 20.5) { mainColor = '#ff9800'; bgColor = '#1a0d00'; }
        else if (ratio > 0.85)   { mainColor = '#ff9800'; bgColor = '#020f1c'; }
        else if (ratio > 0.05)   { mainColor = '#4fc3f7'; bgColor = '#020f1c'; }
        else                     { mainColor = '#29b6f6'; bgColor = '#020f1c'; }

        const dispText = current < 3.8 ? 'LLLL' : current > 20.5 ? 'HHHH' : flow.toFixed(precision);

        this._lcdBg.fill(bgColor);
        this._lcdMain.fill(mainColor);
        this._lcdMain.text(dispText);

        this._lcdUnit.text(this.unit);
        this._lcdUnit.opacity(1);

        this._lcdVelo.text(`v=${velocity.toFixed(3)} m/s`);
        this._lcdVelo.opacity(1);

        this._lcdEMF.text(`E=${emf.toFixed(3)} mV`);
        this._lcdEMF.opacity(1);

        this._lcdCurrent.text(`${current.toFixed(2)} mA`);
        this._lcdCurrent.opacity(1);

        this._lcdTotal.text(`Σ${this.totalFlow.toFixed(2)} m³`);
        this._lcdTotal.opacity(1);
    }

    // ═══════════════════════════════════════════
    //  配置面板
    // ═══════════════════════════════════════════
    getConfigFields() {
        return [
            { label: '位号/名称',               key: 'id',         type: 'text'   },
            { label: '满量程流量',               key: 'maxFlow',    type: 'number' },
            { label: '对应最大压力 (MPa)',        key: 'maxPress',   type: 'number' },
            { label: '管道内径 DN (m)',           key: 'pipeDiam',   type: 'number' },
            { label: '励磁磁场强度 B (T)',        key: 'magField',   type: 'number' },
            { label: '流体电导率 (μS/cm)',        key: 'fluidCond',  type: 'number' },
            {
                label: '流量单位',
                key: 'unit',
                type: 'select',
                options: [
                    { label: 'm³/h',  value: 'm³/h'  },
                    { label: 'L/h',   value: 'L/h'   },
                    { label: 'kg/h',  value: 'kg/h'  },
                ],
            },
        ];
    }

    onConfigUpdate(newConfig) {
        this.id        = newConfig.id        || this.id;
        this.maxFlow   = parseFloat(newConfig.maxFlow)   || this.maxFlow;
        this.maxPress  = parseFloat(newConfig.maxPress)  || this.maxPress;
        this.pipeDiam  = parseFloat(newConfig.pipeDiam)  || this.pipeDiam;
        this.magField  = parseFloat(newConfig.magField)  || this.magField;
        this.fluidCond = parseFloat(newConfig.fluidCond) || this.fluidCond;
        this.unit      = newConfig.unit || this.unit;
        this.config    = { ...this.config, ...newConfig };

        if (this._jTagText)  this._jTagText.text(this.id);
        this._refreshCache();
    }

    destroy() {
        this._stopAnimation();
        super.destroy?.();
    }
}