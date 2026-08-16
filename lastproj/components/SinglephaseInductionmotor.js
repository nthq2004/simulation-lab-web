import { BaseComponent } from './BaseComponent.js';

/**
 * 单相异步电动机仿真组件
 * （Single-Phase Induction Motor with Capacitor Start/Run）
 *
 * ── 工作原理 ──────────────────────────────────────────────────
 *
 *  1. 单相问题：
 *     单相交流电在单绕组定子中只能产生脉动磁场（不旋转），
 *     无法自起动。需要辅助手段产生启动转矩。
 *
 *  2. 双值电容电动机（Capacitor Start-Run Motor）：
 *     ① 主绕组（Main Winding）：直接接单相电源
 *     ② 辅助绕组（Auxiliary Winding）：串联电容后接电源
 *        起动电容 C_s（大容量，约 100~400μF）+ 离心开关
 *        运行电容 C_r（小容量，约 4~16μF，始终在线）
 *
 *     两组绕组在空间上相差 90°，电流相差约 90° → 产生近似旋转磁场
 *
 *  3. 正反转控制：
 *     改变辅助绕组与主绕组的相对相位，即改变旋转磁场方向。
 *     实现方法：将辅助绕组的电容串联位置对调
 *     （即将电容从串在辅助绕组首端改为串在末端）
 *     也可通过换向开关（DPDT）切换辅助绕组的极性来实现反转。
 *
 *  4. 等效电路（双旋转磁场理论）：
 *     单相电动机等效为两个大小相等、方向相反的旋转磁场叠加：
 *     - 正向磁场（Forward Field）：产生正向转矩 T_f
 *     - 反向磁场（Backward Field）：产生反向转矩 T_b
 *     合成转矩 T = T_f - T_b
 *
 *     转差率：
 *       s_f = (n₁ - n) / n₁        （正向）
 *       s_b = (n₁ + n) / n₁ = 2-s_f（反向）
 *
 *  5. 离心开关（Centrifugal Switch）：
 *     转速达到额定转速的 75~80% 时，离心开关断开，切除起动电容，
 *     电机仅靠运行电容维持运转，效率更高。
 *
 * ── 组件结构 ──────────────────────────────────────────────────
 *  ① 电机截面图（定子主/辅绕组，转子，气隙旋转磁场）
 *  ② 电容起动回路图（主/辅绕组，起动电容，运行电容，离心开关）
 *  ③ 正反转控制开关（DPDT换向开关动画）
 *  ④ 离心开关状态（随转速自动开合）
 *  ⑤ T-n（转矩-转速）特性曲线（正向/反向合成）
 *  ⑥ 仪表 LCD（转速、转矩、转差率、电流、功率因数）
 *  ⑦ 起动/停止控制按钮
 *  ⑧ 实时波形（主绕组电流、辅助绕组电流、转速）
 *
 * ── 端口 ─────────────────────────────────────────────────────
 *  wire_l   — 相线 L
 *  wire_n   — 零线 N
 *  pipe_shaft — 输出轴
 */
export class SinglePhaseInductionMotor extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.width  = Math.max(500, config.width  || 580);
        this.height = Math.max(380, config.height || 440);

        this.type    = 'single_phase_im';
        this.special = 'none';
        this.cache   = 'fixed';

        // ── 额定铭牌参数 ──
        this.ratedPower   = config.ratedPower   || 370;     // W
        this.ratedVoltage = config.ratedVoltage || 220;     // V
        this.ratedSpeed   = config.ratedSpeed   || 2800;    // rpm
        this.frequency    = config.frequency    || 50;      // Hz
        this.polePairs    = config.polePairs    || 1;       // 极对数（2极=1对）
        this.ratedCos     = config.ratedCos     || 0.92;    // 额定功率因数
        this.Cs           = config.Cs           || 200;     // 起动电容 μF
        this.Cr           = config.Cr           || 8;       // 运行电容 μF

        // ── 等效电路参数 ──
        this.R1   = config.R1   || 3.0;    // 主绕组电阻 Ω
        this.X1   = config.X1   || 4.5;    // 主绕组漏抗 Ω
        this.R2   = config.R2   || 2.5;    // 转子折算电阻 Ω
        this.X2   = config.X2   || 3.8;    // 转子折算漏抗 Ω
        this.Xm   = config.Xm   || 120;    // 励磁感抗 Ω

        // ── 同步转速 ──
        this.syncSpeed = 60 * this.frequency / this.polePairs;  // rpm
        this.syncOmega = this.syncSpeed * 2 * Math.PI / 60;

        // ── 额定值 ──
        this.ratedSlip   = (this.syncSpeed - this.ratedSpeed) / this.syncSpeed;
        this.ratedTorque = (this.ratedPower) / (this.ratedSpeed * 2 * Math.PI / 60);
        this.maxTorque   = this.ratedTorque * 2.2;
        this.startTorque = this.ratedTorque * 1.5;
        this.J           = config.J || 0.015;  // 转动惯量 kg·m²

        // ── 运行状态 ──
        this.running      = false;
        this.direction    = 1;   // 1=正转，-1=反转
        this._startPhase  = 0;   // 0=停机 1=起动 2=运行 3=制动
        this._startTimer  = 0;

        // ── 动态状态 ──
        this.slip         = 1.0;
        this.speed        = 0;
        this.omega        = 0;
        this.torqueEM     = 0;
        this.torqueLoad   = config.initLoad || 0;
        this._targetLoad  = config.initLoad || 0;
        this.currentMain  = 0;   // 主绕组电流 A（有效值）
        this.currentAux   = 0;   // 辅助绕组电流 A
        this.powerFactor  = 0;
        this.centrifSwitch= false;  // 离心开关状态（true=断开）
        this._loadSmooth  = 0;

        // ── 动画 ──
        this._fieldAngle  = 0;    // 旋转磁场角度
        this._rotorAngle  = 0;
        this._phase       = 0;
        this._wavePhase   = 0;
        this._switchSpark = 0;    // 离心开关火花

        // ── 波形缓冲 ──
        this._wavLen      = 240;
        this._wavIm       = new Float32Array(this._wavLen).fill(0);
        this._wavIa       = new Float32Array(this._wavLen).fill(0);
        this._wavN        = new Float32Array(this._wavLen).fill(0);
        this._wavAcc      = 0;

        // ── 几何布局 ──
        // 电机截面图（左上）
        this._motorCX  = Math.round(this.width * 0.20);
        this._motorCY  = Math.round(this.height * 0.36);
        this._statorRo = Math.round(Math.min(this.width * 0.16, this.height * 0.28));
        this._statorRi = Math.round(this._statorRo * 0.74);
        this._rotorRo  = this._statorRi - Math.round(this._statorRo * 0.06);
        this._rotorRi  = Math.round(this._rotorRo * 0.34);

        // 电路图区（左下 / 中部）
        this._circX    = Math.round(this.width * 0.04);
        this._circY    = this._motorCY + this._statorRo + 18;
        this._circW    = Math.round(this.width * 0.44);
        this._circH    = this.height - this._circY - 6;

        // T-n 特性曲线（右上）
        this._curveX   = Math.round(this.width * 0.46);
        this._curveY   = Math.round(this.height * 0.04);
        this._curveW   = Math.round(this.width * 0.28);
        this._curveH   = Math.round(this.height * 0.42);

        // LCD 仪表（右中）
        this._lcdX     = this._curveX + this._curveW + 10;
        this._lcdY     = this._curveY;
        this._lcdW     = this.width - this._lcdX - 8;
        this._lcdH     = Math.round(this.height * 0.58);

        // 控制面板（右下）
        this._ctrlX    = this._curveX;
        this._ctrlY    = this._curveY + this._curveH + 8;
        this._ctrlW    = this.width - this._curveX - 8;
        this._ctrlH    = Math.round(this.height * 0.20);

        // 波形区（底部）
        this._wavX     = this._circX;
        this._wavY     = this._circY + Math.round(this._circH * 0.52);
        this._wavW     = this._circW;
        this._wavH     = this._circH - Math.round(this._circH * 0.52);

        this._lastTs   = null;
        this._animId   = null;
        this.knobs     = {};

        this.config = {
            id: this.id, ratedPower: this.ratedPower,
            ratedVoltage: this.ratedVoltage, ratedSpeed: this.ratedSpeed,
            polePairs: this.polePairs,
        };

        this._init();

        const cy = this._motorCY;
        this.addPort(0,            cy - 20, 'l',     'wire', 'L');
        this.addPort(0,            cy + 20, 'n',     'wire', 'N');
        this.addPort(this._motorCX + this._statorRo + 8, cy, 'shaft', 'pipe', '输出轴');
    }

    // ═══════════════════════════════════════════
    _init() {
        this._drawLabel();
        this._drawStatorIron();
        this._drawMainAuxWindings();
        this._drawRotorCore();
        this._drawCageRotor();
        this._drawShaft();
        this._drawMagFieldLayer();
        this._drawForceLayer();
        this._drawCircuitDiagram();
        this._drawDirectionSwitch();
        this._drawTorqueSpeedCurve();
        this._drawLCDPanel();
        this._drawControlPanel();
        this._drawWaveform();
        this._startAnimation();
    }

    _drawLabel() {
        this.group.add(new Konva.Text({
            x: 0, y: -22, width: this.width,
            text: `单相异步电动机  ${this.ratedPower}W  ${this.ratedVoltage}V  ${this.ratedSpeed}rpm  电容起动-运行型`,
            fontSize: 12, fontStyle: 'bold', fill: '#1a2634', align: 'center',
        }));
    }

    // ── 定子铁芯 ─────────────────────────────
    _drawStatorIron() {
        const cx = this._motorCX, cy = this._motorCY;
        const Ro = this._statorRo, Ri = this._statorRi;

        this.group.add(new Konva.Circle({ x: cx, y: cy, radius: Ro+10, fill: '#455a64', stroke: '#263238', strokeWidth: 2.5 }));
        for (let i = 0; i < 4; i++) {
            const a = (i/4)*Math.PI*2 + Math.PI/4;
            this.group.add(new Konva.Circle({ x: cx+(Ro+8)*Math.cos(a), y: cy+(Ro+8)*Math.sin(a), radius: 5, fill: '#263238' }));
        }
        this.group.add(new Konva.Ring({ x: cx, y: cy, innerRadius: Ri-2, outerRadius: Ro, fill: '#546e7a', stroke: '#37474f', strokeWidth: 0.5 }));
        for (let i = 0; i < 24; i++) {
            const a = (i/24)*Math.PI*2;
            this.group.add(new Konva.Line({ points: [cx+Ri*Math.cos(a), cy+Ri*Math.sin(a), cx+Ro*Math.cos(a), cy+Ro*Math.sin(a)], stroke: 'rgba(0,0,0,0.14)', strokeWidth: 0.7 }));
        }
        const slotN = 24;
        for (let i = 0; i < slotN; i++) {
            const a = (i/slotN)*Math.PI*2 - Math.PI/2;
            const g = new Konva.Group({ x: cx+(Ri+2)*Math.cos(a), y: cy+(Ri+2)*Math.sin(a), rotation: a*180/Math.PI+90 });
            g.add(new Konva.Rect({ x: -2.5, y: 0, width: 5, height: (Ro-Ri-4)*0.55, fill: '#0d1a28' }));
            this.group.add(g);
        }
        this.group.add(new Konva.Circle({ x: cx, y: cy, radius: Ri-4, fill: '#0a1520' }));
        this._airGapRing = new Konva.Ring({ x: cx, y: cy, innerRadius: this._rotorRo+1, outerRadius: Ri-5, fill: 'rgba(100,200,255,0.04)' });
        this.group.add(this._airGapRing);
        this.group.add(new Konva.Text({ x: cx-Ro, y: cy-Ro-22, width: Ro*2, text: '单相异步电动机（截面图）', fontSize: 9, fontStyle: 'bold', fill: '#546e7a', align: 'center' }));
    }

    // ── 主绕组（水平，橙色）+ 辅助绕组（垂直，绿色）──
    _drawMainAuxWindings() {
        const cx = this._motorCX, cy = this._motorCY;
        const Ri = this._statorRi, Ro = this._statorRo;
        const midR = (Ri + Ro - 4) / 2;
        const bh = 10, bw = (Ro-Ri-8)*0.52;

        // 主绕组（水平方向 0°/180°，橙色）
        const mainAngles = [0, Math.PI];
        this._mainCoilGroups = [];
        mainAngles.forEach((a, side) => {
            const g = new Konva.Group({ x: cx + midR*Math.cos(a - Math.PI/2), y: cy + midR*Math.sin(a - Math.PI/2), rotation: (a - Math.PI/2)*180/Math.PI + 90 });
            const coil = new Konva.Rect({ x: -bw/2, y: -bh/2, width: bw, height: bh, fill: '#ff8f00', cornerRadius: 2, opacity: 0.8 });
            const dot  = new Konva.Text({ x: -5, y: -6, text: side===0?'·':'×', fontSize: 11, fill: '#fff', fontStyle: 'bold' });
            g.add(coil, dot);
            this._mainCoilGroups.push(g);
            this.group.add(g);
        });
        this.group.add(new Konva.Text({ x: cx + Ro + 14, y: cy - 8, text: 'M\n主绕组', fontSize: 8, fill: '#ff8f00', lineHeight: 1.3 }));

        // 辅助绕组（垂直方向 90°/270°，绿色）
        const auxAngles = [Math.PI/2, -Math.PI/2];
        this._auxCoilGroups = [];
        auxAngles.forEach((a, side) => {
            const g = new Konva.Group({ x: cx + midR*Math.cos(a - Math.PI/2), y: cy + midR*Math.sin(a - Math.PI/2), rotation: (a - Math.PI/2)*180/Math.PI + 90 });
            const coil = new Konva.Rect({ x: -bw/2, y: -bh/2, width: bw, height: bh, fill: '#66bb6a', cornerRadius: 2, opacity: 0.8 });
            const dot  = new Konva.Text({ x: -5, y: -6, text: side===0?'·':'×', fontSize: 11, fill: '#fff', fontStyle: 'bold' });
            g.add(coil, dot);
            this._auxCoilGroups.push(g);
            this.group.add(g);
        });
        this.group.add(new Konva.Text({ x: cx - Ro - 46, y: cy - 8, text: 'A\n辅助绕组', fontSize: 8, fill: '#66bb6a', lineHeight: 1.3 }));

        // 绕组标注（底部）
        this.group.add(new Konva.Rect({ x: cx-30, y: cy-Ro-8, width: 24, height: 8, fill: 'rgba(255,143,0,0.15)' }));
        this.group.add(new Konva.Text({ x: cx-30, y: cy-Ro-7, text: '主绕组(M)', fontSize: 6.5, fill: '#ff8f00' }));
        this.group.add(new Konva.Rect({ x: cx+6, y: cy-Ro-8, width: 24, height: 8, fill: 'rgba(102,187,106,0.15)' }));
        this.group.add(new Konva.Text({ x: cx+6, y: cy-Ro-7, text: '辅绕组(A)', fontSize: 6.5, fill: '#66bb6a' }));
    }

    // ── 转子（鼠笼）─────────────────────────
    _drawRotorCore() {
        const cx = this._motorCX, cy = this._motorCY;
        this._rotorGroup = new Konva.Group({ x: cx, y: cy });
        this._rotorGroup.add(new Konva.Ring({ innerRadius: this._rotorRi, outerRadius: this._rotorRo-2, fill: '#607d8b', stroke: '#37474f', strokeWidth: 0.8 }));
        for (let i = 0; i < 16; i++) {
            const a = (i/16)*Math.PI*2;
            this._rotorGroup.add(new Konva.Line({ points: [this._rotorRi*Math.cos(a), this._rotorRi*Math.sin(a), (this._rotorRo-3)*Math.cos(a), (this._rotorRo-3)*Math.sin(a)], stroke: 'rgba(0,0,0,0.12)', strokeWidth: 0.6 }));
        }
        this._rotorGroup.add(new Konva.Circle({ radius: this._rotorRi, fill: '#37474f', stroke: '#263238', strokeWidth: 1.5 }));
        this._rotorGroup.add(new Konva.Circle({ x: -this._rotorRi*0.2, y: -this._rotorRi*0.2, radius: this._rotorRi*0.15, fill: 'rgba(255,255,255,0.12)' }));
        this.group.add(this._rotorGroup);
    }

    _drawCageRotor() {
        const cx = this._motorCX, cy = this._motorCY;
        this._cageGroup = new Konva.Group({ x: cx, y: cy });
        const barN = 20, barD = (this._rotorRo - this._rotorRi - 6) * 0.5;
        this._cageBars = [];
        for (let i = 0; i < barN; i++) {
            const a = (i/barN)*Math.PI*2;
            const r = (this._rotorRo - 4 + this._rotorRi + 3) / 2;
            const g = new Konva.Group({ x: r*Math.cos(a), y: r*Math.sin(a), rotation: a*180/Math.PI });
            const bar = new Konva.Rect({ x: -2, y: -barD/2, width: 4, height: barD, fill: '#c0a020', stroke: '#8a7010', strokeWidth: 0.5, cornerRadius: 1 });
            this._cageBars.push({ bar, angle: a });
            g.add(bar);
            this._cageGroup.add(g);
        }
        this._cageGroup.add(new Konva.Ring({ innerRadius: this._rotorRi+3, outerRadius: this._rotorRi+8, fill: '#c0a020', stroke: '#8a7010', strokeWidth: 0.5 }));
        this._cageGroup.add(new Konva.Ring({ innerRadius: this._rotorRo-8, outerRadius: this._rotorRo-3, fill: '#c0a020', stroke: '#8a7010', strokeWidth: 0.5 }));
        this.group.add(this._cageGroup);
    }

    _drawShaft() {
        const cx = this._motorCX, cy = this._motorCY, Ro = this._statorRo;
        this.group.add(new Konva.Ellipse({ x: cx+Ro+6, y: cy, radiusX: 7, radiusY: Ro*0.44, fill: '#607d8b', stroke: '#37474f', strokeWidth: 1.5 }));
        this.group.add(new Konva.Rect({ x: cx+Ro+8, y: cy-5, width: 22, height: 10, fill: '#78909c', stroke: '#546e7a', strokeWidth: 1 }));
        this.group.add(new Konva.Ellipse({ x: cx-Ro-6, y: cy, radiusX: 7, radiusY: Ro*0.44, fill: '#607d8b', stroke: '#37474f', strokeWidth: 1.5 }));
    }

    _drawMagFieldLayer() { this._magGroup = new Konva.Group(); this.group.add(this._magGroup); }
    _drawForceLayer()    { this._forceGroup = new Konva.Group(); this.group.add(this._forceGroup); }

    // ── 电路图（主/辅绕组+电容+离心开关）────
    _drawCircuitDiagram() {
        const { _circX: cx2, _circY: cy2, _circW: cw, _circH: ch } = this;
        const halfCH = Math.round(ch * 0.46);

        const bg = new Konva.Rect({ x: cx2, y: cy2, width: cw, height: halfCH, fill: '#020c14', stroke: '#1a3040', strokeWidth: 1.5, cornerRadius: 4 });
        const titleBg = new Konva.Rect({ x: cx2, y: cy2, width: cw, height: 13, fill: '#0a1a28', cornerRadius: [4,4,0,0] });
        this.group.add(new Konva.Text({ x: cx2+4, y: cy2+2, width: cw-8, text: '电路图（双值电容 电容起动-运行）', fontSize: 8, fontStyle: 'bold', fill: '#80cbc4', align: 'center' }));

        const lx = cx2+10, rx = cx2+cw-10, midY = cy2+halfCH/2+8;
        const vL = cy2+18, vN = cy2+halfCH-8;

        // 电源 L/N 纵线
        this.group.add(new Konva.Line({ points: [lx, vL, lx, vN], stroke: '#ef9a9a', strokeWidth: 2 }));
        this.group.add(new Konva.Line({ points: [rx, vL, rx, vN], stroke: '#90caf9', strokeWidth: 2 }));
        this.group.add(new Konva.Text({ x: lx-8, y: vL-2, text: 'L', fontSize: 8.5, fontStyle: 'bold', fill: '#ef9a9a' }));
        this.group.add(new Konva.Text({ x: rx+2, y: vL-2, text: 'N', fontSize: 8.5, fontStyle: 'bold', fill: '#90caf9' }));

        // 主绕组（M）支路（中上）
        const m1Y = cy2 + 22, m2Y = cy2 + halfCH - 10;
        const mX1 = lx + Math.round(cw*0.22), mX2 = rx - Math.round(cw*0.22);
        this.group.add(new Konva.Line({ points: [lx, m1Y, mX1, m1Y], stroke: '#ff8f00', strokeWidth: 1.5 }));
        // 主绕组矩形符号
        this.group.add(new Konva.Rect({ x: mX1, y: m1Y-5, width: mX2-mX1, height: 10, fill: 'none', stroke: '#ff8f00', strokeWidth: 1.5 }));
        this.group.add(new Konva.Text({ x: mX1+4, y: m1Y-3, text: 'M（主绕组）', fontSize: 7.5, fill: '#ff8f00' }));
        this.group.add(new Konva.Line({ points: [mX2, m1Y, rx, m1Y], stroke: '#ff8f00', strokeWidth: 1.5 }));

        // 辅助绕组（A）+ 运行电容（Cr）+ 起动电容（Cs）+ 离心开关（K）支路
        const aY = cy2+halfCH*0.55;
        const aX1 = lx + Math.round(cw*0.10);

        // 运行电容 Cr（始终在线）
        const crX = aX1 + Math.round(cw*0.06);
        this.group.add(new Konva.Line({ points: [lx, aY, crX-2, aY], stroke: '#66bb6a', strokeWidth: 1.5 }));
        this.group.add(new Konva.Line({ points: [crX-2, aY-6, crX-2, aY+6], stroke: '#66bb6a', strokeWidth: 2.5 }));
        this.group.add(new Konva.Line({ points: [crX+2, aY-6, crX+2, aY+6], stroke: '#66bb6a', strokeWidth: 2.5 }));
        this.group.add(new Konva.Text({ x: crX-10, y: aY-14, width: 20, text: `Cr\n${this.Cr}μF`, fontSize: 6.5, fill: '#66bb6a', align: 'center', lineHeight: 1.3 }));
        this.group.add(new Konva.Line({ points: [crX+2, aY, crX+8, aY], stroke: '#66bb6a', strokeWidth: 1.5 }));

        // 起动电容 Cs + 离心开关（串联）
        const csX = crX + Math.round(cw*0.16);
        const ksX = csX + Math.round(cw*0.14);
        this.group.add(new Konva.Line({ points: [crX+8, aY, csX-2, aY], stroke: '#ffd54f', strokeWidth: 1.5 }));
        // Cs（虚线框，起动阶段有效）
        this.group.add(new Konva.Rect({ x: csX-2, y: aY-8, width: ksX-csX-2, height: 16, fill: 'none', stroke: '#ffd54f', strokeWidth: 1, dash: [3,2] }));
        this.group.add(new Konva.Line({ points: [csX-2, aY-5, csX-2, aY+5], stroke: '#ffd54f', strokeWidth: 2.5 }));
        this.group.add(new Konva.Line({ points: [csX+2, aY-5, csX+2, aY+5], stroke: '#ffd54f', strokeWidth: 2.5 }));
        this.group.add(new Konva.Text({ x: csX-8, y: aY-18, width: 16, text: `Cs\n${this.Cs}μF`, fontSize: 6.5, fill: '#ffd54f', align: 'center', lineHeight: 1.3 }));

        // 离心开关 K
        const kX = ksX + Math.round(cw*0.06);
        this._centrifLineLeft  = new Konva.Line({ points: [ksX+4, aY, kX, aY], stroke: '#ffd54f', strokeWidth: 1.5 });
        this._centrifContactLine= new Konva.Line({ points: [kX, aY, kX+12, aY], stroke: '#ffd54f', strokeWidth: 2.5 });
        this._centrifLineRight = new Konva.Line({ points: [kX+12, aY, kX+18, aY], stroke: '#ffd54f', strokeWidth: 1.5 });
        this.group.add(new Konva.Text({ x: kX-4, y: aY-14, width: 22, text: 'K\n离心', fontSize: 6.5, fill: '#ffd54f', align: 'center', lineHeight: 1.3 }));
        this.group.add(this._centrifLineLeft, this._centrifContactLine, this._centrifLineRight);

        // 辅助绕组（A）
        const aW1 = kX + 18;
        const aW2 = rx - Math.round(cw*0.06);
        this.group.add(new Konva.Line({ points: [aW1, aY, aW1+4, aY], stroke: '#66bb6a', strokeWidth: 1.5 }));
        this.group.add(new Konva.Rect({ x: aW1+4, y: aY-5, width: aW2-aW1-4, height: 10, fill: 'none', stroke: '#66bb6a', strokeWidth: 1.5 }));
        this.group.add(new Konva.Text({ x: aW1+6, y: aY-3, text: 'A（辅助绕组）', fontSize: 7.5, fill: '#66bb6a' }));
        this.group.add(new Konva.Line({ points: [aW2, aY, rx, aY], stroke: '#66bb6a', strokeWidth: 1.5 }));

        // 离心开关状态指示
        this._centrifStatusText = new Konva.Text({ x: kX-14, y: aY+8, width: 44, text: '闭合', fontSize: 7.5, fill: '#ffd54f', align: 'center' });
        this.group.add(this._centrifStatusText);

        this.group.add(bg, titleBg);
    }

    // ── 正反转换向开关（DPDT）────────────────
    _drawDirectionSwitch() {
        const { _circX: cx2, _circY: cy2, _circW: cw, _circH: ch } = this;
        const swY = cy2 + Math.round(ch * 0.46) + 4;
        const swH = Math.round(ch * 0.48);

        const bg = new Konva.Rect({ x: cx2, y: swY, width: cw, height: swH, fill: '#020c14', stroke: '#1a3040', strokeWidth: 1.5, cornerRadius: 4 });
        const titleBg = new Konva.Rect({ x: cx2, y: swY, width: cw, height: 13, fill: '#0a1a28', cornerRadius: [4,4,0,0] });
        this.group.add(new Konva.Text({ x: cx2+4, y: swY+2, width: cw-8, text: '正反转控制（切换辅助绕组极性）', fontSize: 8, fontStyle: 'bold', fill: '#ffd54f', align: 'center' }));

        // 换向开关图示（DPDT）
        const swCX = cx2 + cw/2, swCY = swY + swH/2 + 2;

        // 公共端（COM）
        for (let i = 0; i < 2; i++) {
            const lx2 = swCX - 30 + i * 60;
            this.group.add(new Konva.Circle({ x: lx2, y: swCY, radius: 4, fill: '#ffd54f' }));
            this.group.add(new Konva.Text({ x: lx2-8, y: swCY+6, width: 16, text: 'COM', fontSize: 6.5, fill: '#ffd54f', align: 'center' }));
        }
        // 正转端（+）
        this.group.add(new Konva.Circle({ x: swCX-30, y: swCY-16, radius: 3.5, fill: '#66bb6a' }));
        this.group.add(new Konva.Circle({ x: swCX+30, y: swCY+16, radius: 3.5, fill: '#66bb6a' }));
        this.group.add(new Konva.Text({ x: swCX-44, y: swCY-21, text: '正转', fontSize: 7, fill: '#66bb6a' }));
        // 反转端（-）
        this.group.add(new Konva.Circle({ x: swCX-30, y: swCY+16, radius: 3.5, fill: '#ffa726' }));
        this.group.add(new Konva.Circle({ x: swCX+30, y: swCY-16, radius: 3.5, fill: '#ffa726' }));
        this.group.add(new Konva.Text({ x: swCX+34, y: swCY+11, text: '反转', fontSize: 7, fill: '#ffa726' }));

        // 刀片（动态，随 direction 切换）
        this._swBlade1 = new Konva.Line({ points: [swCX-30, swCY, swCX-30, swCY-16], stroke: '#ffd54f', strokeWidth: 3, lineCap: 'round' });
        this._swBlade2 = new Konva.Line({ points: [swCX+30, swCY, swCX+30, swCY+16], stroke: '#ffd54f', strokeWidth: 3, lineCap: 'round' });
        this.group.add(this._swBlade1, this._swBlade2);

        // 方向标注
        this._dirText = new Konva.Text({ x: cx2+4, y: swY+swH-14, width: cw-8, text: '▶ 正转', fontSize: 9.5, fontStyle: 'bold', fill: '#66bb6a', align: 'center' });
        this.group.add(bg, titleBg, this._dirText);

        this._swCX = swCX; this._swCY = swCY;
    }

    // ── T-n 特性曲线 ─────────────────────────
    _drawTorqueSpeedCurve() {
        const { _curveX: cx2, _curveY: cy2, _curveW: cw, _curveH: ch } = this;
        const bg = new Konva.Rect({ x: cx2, y: cy2, width: cw, height: ch, fill: '#010d18', stroke: '#1a3040', strokeWidth: 1.5, cornerRadius: 4 });
        const titleBg = new Konva.Rect({ x: cx2, y: cy2, width: cw, height: 13, fill: '#0a1a28', cornerRadius: [4,4,0,0] });
        this.group.add(new Konva.Text({ x: cx2+4, y: cy2+2, width: cw-8, text: 'T-n 特性（正向+反向磁场合成）', fontSize: 8, fontStyle: 'bold', fill: '#80cbc4', align: 'center' }));

        const ox = cx2+16, oy = cy2+ch-12, aw = cw-22, ah = ch-26;
        this.group.add(new Konva.Line({ points: [ox, oy-ah, ox, oy, ox+aw, oy], stroke: '#37474f', strokeWidth: 1 }));
        this.group.add(new Konva.Text({ x: ox-14, y: cy2+13, text: 'T', fontSize: 7, fill: '#80cbc4' }));
        this.group.add(new Konva.Text({ x: cx2+cw-12, y: oy+2, text: 'n', fontSize: 7, fill: '#80cbc4' }));

        const nMax = this.syncSpeed+50, tMax = this.maxTorque*1.1;
        [0, 500, 1000, 1500, this.syncSpeed].forEach(n => {
            const nx = ox+(n/nMax)*(aw-2);
            this.group.add(new Konva.Line({ points: [nx,oy,nx,oy+3], stroke: '#37474f', strokeWidth: 0.8 }));
            if (n % 500 === 0 || n===this.syncSpeed) this.group.add(new Konva.Text({ x: nx-10, y: oy+4, width: 20, text: n===this.syncSpeed?'n₁':n+'', fontSize: 6, fill: '#37474f', align: 'center' }));
        });

        // 正向分量（绿色实线）
        const fwPts = [];
        for (let s = 1.0; s >= 0; s -= 0.01) {
            const n = this.syncSpeed*(1-s);
            const T = this._calcTorqueComponent(s) * 0.7;  // 正向磁场转矩
            const nx = ox+(n/nMax)*(aw-2), ty = oy-(T/tMax)*(ah-4);
            if (nx > ox && nx < ox+aw && ty > cy2+14 && ty < oy) fwPts.push(nx, ty);
        }
        this.group.add(new Konva.Line({ points: fwPts, stroke: '#66bb6a', strokeWidth: 1.5, lineJoin: 'round', opacity: 0.6 }));
        this.group.add(new Konva.Text({ x: ox+2, y: oy-ah+14, text: 'T_f(正向)', fontSize: 7, fill: 'rgba(102,187,106,0.7)' }));

        // 反向分量（橙色虚线，对单相来说从左向右下降）
        const rvPts = [];
        for (let s = 1.0; s >= 0; s -= 0.01) {
            const n = this.syncSpeed*(1-s);
            const sb = 2 - s;
            const T = this._calcTorqueComponent(sb) * 0.3;
            const nx = ox+(n/nMax)*(aw-2), ty = oy-(T/tMax)*(ah-4);
            if (nx > ox && nx < ox+aw && ty > cy2+14 && ty < oy) rvPts.push(nx, ty);
        }
        this.group.add(new Konva.Line({ points: rvPts, stroke: '#ffa726', strokeWidth: 1, dash: [4,3], lineJoin: 'round', opacity: 0.5 }));
        this.group.add(new Konva.Text({ x: ox+aw*0.5, y: oy-ah+14, text: 'T_b(反向)', fontSize: 7, fill: 'rgba(255,167,38,0.7)' }));

        // 合成曲线（白色）
        const netPts = [];
        for (let s = 1.0; s >= 0; s -= 0.01) {
            const n = this.syncSpeed*(1-s);
            const sb = 2 - s;
            const Tnet = this._calcTorqueComponent(s)*0.7 - this._calcTorqueComponent(sb)*0.3;
            if (Tnet < 0) continue;
            const nx = ox+(n/nMax)*(aw-2), ty = oy-(Tnet/tMax)*(ah-4);
            if (nx > ox && nx < ox+aw && ty > cy2+14 && ty < oy) netPts.push(nx, ty);
        }
        this.group.add(new Konva.Line({ points: netPts, stroke: '#4fc3f7', strokeWidth: 2, lineJoin: 'round', opacity: 0.9 }));

        // 工作点
        this._workPoint = new Konva.Circle({ x: ox, y: oy, radius: 5, fill: '#ef5350', stroke: '#c62828', strokeWidth: 1.5 });
        this._tsOX = ox; this._tsOY = oy; this._tsAW = aw; this._tsAH = ah;
        this._tsNMax = nMax; this._tsTMax = tMax;

        this.group.add(bg, titleBg, this._workPoint);
    }

    _calcTorqueComponent(s) {
        if (Math.abs(s) < 0.001) return 0;
        const U = this.ratedVoltage;
        const R2s = this.R2 / s;
        const Ztot = Math.sqrt(Math.pow(this.R1+R2s,2) + Math.pow(this.X1+this.X2,2));
        const I2 = U / Ztot / 2;
        return this.polePairs * I2 * I2 * this.R2 / (s * this.syncOmega) * 0.5;
    }

    // ── LCD 仪表 ─────────────────────────────
    _drawLCDPanel() {
        const lx = this._lcdX, ly = this._lcdY, lw = this._lcdW, lh = this._lcdH;
        const bg = new Konva.Rect({ x: lx, y: ly, width: lw, height: lh, fill: '#020c14', stroke: '#1a3040', strokeWidth: 1.5, cornerRadius: 4 });
        const titleBg = new Konva.Rect({ x: lx, y: ly, width: lw, height: 13, fill: '#0a1a28', cornerRadius: [4,4,0,0] });
        this.group.add(new Konva.Text({ x: lx+4, y: ly+2, width: lw-8, text: '运行参数', fontSize: 8, fontStyle: 'bold', fill: '#80cbc4', align: 'center' }));

        // 圆形转速表
        const lcx = lx+lw/2, lcy = ly+44+(lh-44)*0.46;
        const R   = Math.min(lw*0.38, 44);
        this.group.add(new Konva.Circle({ x: lcx, y: lcy, radius: R+4, fill: '#0d1520', stroke: '#1a252f', strokeWidth: 1 }));
        const ring = new Konva.Circle({ x: lcx, y: lcy, radius: R+2, fill: '#001a00', stroke: '#1b5e20', strokeWidth: 2.5 });
        this._lcdBg  = new Konva.Circle({ x: lcx, y: lcy, radius: R, fill: '#020c14' });
        this._speedArc = new Konva.Arc({ x: lcx, y: lcy, innerRadius: R-5, outerRadius: R-3, angle: 0, fill: '#66bb6a', rotation: -90 });
        this._lcdMain   = new Konva.Text({ x: lcx-R+4, y: lcy-R*.40, width:(R-4)*2, text:'0', fontSize:R*.42, fontFamily:'Courier New, monospace', fontStyle:'bold', fill:'#66bb6a', align:'center' });
        this._lcdUnit   = new Konva.Text({ x: lcx-R+4, y: lcy+R*.10, width:(R-4)*2, text:'rpm', fontSize:R*.17, fill:'#001a00', align:'center' });
        this._lcdSlip   = new Konva.Text({ x: lcx-R+4, y: lcy+R*.28, width:(R-4)*2, text:'s=--', fontSize:R*.13, fontFamily:'Courier New, monospace', fill:'#37474f', align:'center' });
        this._lcdTorque = new Konva.Text({ x: lcx-R+4, y: lcy-R*.62, width:(R-4)*2, text:'T=--', fontSize:R*.13, fontFamily:'Courier New, monospace', fill:'#80cbc4', align:'center' });
        this._lcdCsw    = new Konva.Text({ x: lcx-R+4, y: lcy+R*.46, width:(R-4)*2, text:'Cs:接入', fontSize:R*.12, fontFamily:'Courier New, monospace', fill:'#ffd54f', align:'center' });

        const params = [
            { label:'Im',  id:'im',  unit:'A',  color:'#ff8f00' },
            { label:'Ia',  id:'ia',  unit:'A',  color:'#66bb6a' },
            { label:'cosφ', id:'pf', unit:'',   color:'#4fc3f7' },
        ];
        const cellW=(lw-8)/3;
        this._lcdCells={};
        params.forEach(({label,id,unit,color},i)=>{
            const cx3=lx+4+i*(cellW+2), cy3=ly+16;
            this.group.add(new Konva.Rect({x:cx3,y:cy3,width:cellW,height:22,fill:'#0d1520',cornerRadius:2}));
            this.group.add(new Konva.Text({x:cx3+2,y:cy3+2,text:label,fontSize:7,fill:'#37474f'}));
            const val=new Konva.Text({x:cx3+2,y:cy3+9,width:cellW-4,text:'--',fontSize:9,fontFamily:'Courier New, monospace',fontStyle:'bold',fill:color,align:'right'});
            this.group.add(new Konva.Text({x:cx3+2,y:cy3+14,width:cellW-4,text:unit,fontSize:7,fill:'#1a252f',align:'right'}));
            this._lcdCells[id]=val;
            this.group.add(val);
        });
        this.group.add(ring, this._lcdBg, this._speedArc, this._lcdMain, this._lcdUnit, this._lcdSlip, this._lcdTorque, this._lcdCsw, bg, titleBg);
    }

    // ── 控制面板 ─────────────────────────────
    _drawControlPanel() {
        const px = this._ctrlX, py = this._ctrlY, pw = this._ctrlW, ph = this._ctrlH;
        const bg = new Konva.Rect({ x: px, y: py, width: pw, height: ph, fill: '#0d1520', stroke: '#1a3040', strokeWidth: 1.5, cornerRadius: 4 });
        const titleBg = new Konva.Rect({ x: px, y: py, width: pw, height: 13, fill: '#0a1a28', cornerRadius: [4,4,0,0] });
        this.group.add(new Konva.Text({ x: px+4, y: py+2, width: pw-8, text: '控制操作', fontSize: 8, fontStyle: 'bold', fill: '#80cbc4', align: 'center' }));

        // 起动/停止
        const bH = 18, bY = py + 18;
        const makeBtn = (bx, bw2, label, fill, stroke, textCol, cb) => {
            const btn = new Konva.Rect({ x: bx, y: bY, width: bw2, height: bH, fill, stroke, strokeWidth: 1.5, cornerRadius: 3 });
            const lbl = new Konva.Text({ x: bx, y: bY+4, width: bw2, text: label, fontSize: 10, fontStyle: 'bold', fill: textCol, align: 'center' });
            btn.on('click tap', cb);
            btn.on('mouseenter', () => btn.opacity(0.8));
            btn.on('mouseleave', () => btn.opacity(1));
            this.group.add(btn, lbl);
            return { btn, lbl };
        };

        const btnW = (pw-12) / 4;
        makeBtn(px+4,           btnW, '▶ 起动', '#1a3a1a', '#2e7d32', '#66bb6a', () => this.start());
        makeBtn(px+4+btnW+2,    btnW, '■ 停止', '#3a1a1a', '#c62828', '#ef5350', () => this.stop());

        // 正反转按钮
        this._fwBtn = makeBtn(px+4+(btnW+2)*2, btnW, '正转 →', this.direction===1?'#1a3a1a':'#0d1820', this.direction===1?'#66bb6a':'#1a3040', this.direction===1?'#66bb6a':'#4a5a6a', () => this.setDirection(1));
        this._rvBtn = makeBtn(px+4+(btnW+2)*3, btnW, '← 反转', this.direction===-1?'#2a1a08':'#0d1820', this.direction===-1?'#ffa726':'#1a3040', this.direction===-1?'#ffa726':'#4a5a6a', () => this.setDirection(-1));

        // 负载调节
        const slY = py + 42, slW = pw-12;
        this.group.add(new Konva.Text({ x: px+4, y: slY-10, text: '负载 T_L:', fontSize: 8, fill: '#546e7a' }));
        this.group.add(new Konva.Rect({ x: px+4, y: slY, width: slW, height: 10, fill: '#0a0a18', cornerRadius: 2 }));
        this._loadBarCtrl = new Konva.Rect({ x: px+4, y: slY, width: 0, height: 10, fill: '#4fc3f7', cornerRadius: 2 });
        this._loadValCtrl = new Konva.Text({ x: px+4+slW+4, y: slY-2, width: 40, text: '0N·m', fontSize: 8, fontFamily: 'Courier New, monospace', fill: '#4fc3f7' });

        const hitLoad = new Konva.Rect({ x: px+4, y: slY-2, width: slW, height: 16, fill: 'transparent', listening: true });
        hitLoad.on('click tap mousedown touchstart', e => {
            const stage = this.group.getStage?.();
            const pos = stage?.getPointerPosition?.() ?? { x: e.evt?.clientX ?? 0 };
            const ratio = Math.max(0, Math.min(1, (pos.x-(this.group.x?.()??0)-(px+4))/slW));
            this._targetLoad = ratio * this.ratedTorque * 1.1;
        });

        this.group.add(bg, titleBg, this._loadBarCtrl, this._loadValCtrl, hitLoad);
        this._ctrlLoadX = px+4; this._ctrlLoadW = slW;
    }

    // ── 波形区 ───────────────────────────────
    _drawWaveform() {
        const { _wavX: wx, _wavY: wy, _wavW: ww, _wavH: wh } = this;
        if (wh < 14) return;

        const bg = new Konva.Rect({ x: wx, y: wy, width: ww, height: wh, fill: '#010d18', stroke: '#1a3040', strokeWidth: 1.5, cornerRadius: 4 });
        const titleBg = new Konva.Rect({ x: wx, y: wy, width: ww, height: 12, fill: '#0a1a28', cornerRadius: [4,4,0,0] });
        this.group.add(new Konva.Text({ x: wx+4, y: wy+1, width: ww-8, text: 'Im 主绕组  Ia 辅助绕组  n 转速', fontSize: 8, fill: '#80cbc4', align: 'center' }));

        const h3 = (wh-12)/3;
        this._wavMids = [wy+12+h3*0.5, wy+12+h3*1.5, wy+12+h3*2.5];
        this._wavMids.forEach(my => this.group.add(new Konva.Line({ points: [wx+2,my,wx+ww-2,my], stroke: 'rgba(200,200,200,0.07)', strokeWidth: 0.5, dash: [4,3] })));

        this._wLineIm = new Konva.Line({ points: [], stroke: '#ff8f00', strokeWidth: 1.5, lineJoin: 'round' });
        this._wLineIa = new Konva.Line({ points: [], stroke: '#66bb6a', strokeWidth: 1.5, lineJoin: 'round' });
        this._wLineN  = new Konva.Line({ points: [], stroke: '#4dd0e1', strokeWidth: 1.8, lineJoin: 'round' });

        ['Im','Ia','n'].forEach((l,i)=>{
            const cols=['#ff8f00','#66bb6a','#4dd0e1'];
            this.group.add(new Konva.Text({x:wx+4,y:wy+12+h3*i+4,text:l,fontSize:8,fill:cols[i]}));
        });

        this.group.add(bg, titleBg, this._wLineIm, this._wLineIa, this._wLineN);
        this._wavH3 = h3;
    }

    // ═══════════════════════════════════════════
    _startAnimation() {
        const tick = ts => {
            if (this._lastTs !== null) {
                const dt = Math.min((ts-this._lastTs)/1000, 0.05);
                this._tickControl(dt);
                this._tickPhysics(dt);
                this._tickMechViz(dt);
                this._tickContactViz();
                this._tickWorkPoint();
                this._tickWaveform(dt);
                this._tickDisplay();
            }
            this._lastTs = ts;
            this._refreshCache();
            this._animId = requestAnimationFrame(tick);
        };
        this._animId = requestAnimationFrame(tick);
    }

    _stopAnimation() { if (this._animId) { cancelAnimationFrame(this._animId); this._animId = null; } }

    _tickControl(dt) {
        switch (this._startPhase) {
            case 0: this.slip = 1.0; break;
            case 1:
                this._startTimer += dt;
                if (this._startTimer > 0.5) { this._startPhase = 2; this.running = true; }
                break;
            case 2: break;
            case 3:
                this._targetLoad = 0;
                this.slip = Math.min(1.0, this.slip + dt*5);
                if (this.slip >= 0.999) { this._startPhase = 0; this.running = false; }
                break;
        }
    }

    _tickPhysics(dt) {
        this._loadSmooth += (this._targetLoad - this._loadSmooth) * Math.min(1, dt*4);
        this.torqueLoad  = this._loadSmooth;

        if (this._startPhase === 0) {
            this.slip = 1.0; this.speed = 0; this.omega = 0;
            this.torqueEM = 0; this.currentMain = 0; this.currentAux = 0;
            this.powerFactor = 0; this.centrifSwitch = false;
        } else {
            const sb   = 2 - this.slip;
            const Tf   = this._calcTorqueComponent(this.slip) * 0.7;
            const Tb   = this._calcTorqueComponent(sb) * 0.3;
            this.torqueEM = Math.max(0, (Tf - Tb) * this.direction);

            const netTq = this.torqueEM - this.torqueLoad;
            this.omega += (netTq / this.J) * dt;
            this.omega  = Math.max(0, Math.min(this.syncOmega*1.01, this.omega));
            this.speed  = Math.round(this.omega * 60 / (2*Math.PI));
            this.slip   = Math.max(0, (this.syncOmega - this.omega) / this.syncOmega);

            // 离心开关（速度 > 75% 额定时断开）
            this.centrifSwitch = this.speed > this.ratedSpeed * 0.75;

            // 电流计算
            const U = this.ratedVoltage;
            const R2s = this.R2 / Math.max(0.001, this.slip);
            const Ztot = Math.sqrt(Math.pow(this.R1+R2s,2) + Math.pow(this.X1+this.X2,2));
            this.currentMain = U / Ztot * 1.1;
            // 辅助绕组电流（起动时大，运行时小）
            const capXcs = this.centrifSwitch ? 1/(2*Math.PI*this.frequency*this.Cr*1e-6) : 1/(2*Math.PI*this.frequency*this.Cs*1e-6);
            this.currentAux = U / Math.sqrt(Math.pow(this.R1, 2) + Math.pow(capXcs - this.X1, 2)) * 0.4;
            this.powerFactor = this.slip < 0.05 ? this.ratedCos : 0.65 + (1-this.slip)*0.25;
        }

        // 磁场角度
        this._fieldAngle += this.syncOmega * dt * this.direction;
        this._rotorAngle += this.omega * dt * this.direction;
        this._phase      += dt * 3;
        this._wavePhase  += dt * 2 * Math.PI * this.frequency;

        // 转速弧
        if (this._speedArc) {
            const ratio = Math.min(1, this.speed / this.ratedSpeed);
            this._speedArc.angle(ratio * 360);
            this._speedArc.fill(this.slip < 0.03 ? '#66bb6a' : this.slip < 0.15 ? '#ffa726' : '#ef5350');
        }
    }

    _tickMechViz(dt) {
        if (this._rotorGroup) this._rotorGroup.rotation(this._rotorAngle * 180/Math.PI);
        if (this._cageGroup)  this._cageGroup.rotation(this._rotorAngle * 180/Math.PI);

        // 旋转磁场
        this._magGroup.destroyChildren();
        if (this._startPhase > 0) {
            const cx = this._motorCX, cy = this._motorCY;
            const Ri = this._statorRi - 7, Rg = this._rotorRo + 2;
            for (let i = 0; i < 6; i++) {
                const a = this._fieldAngle + (i/6)*Math.PI*2;
                const iM = Math.abs(Math.sin(a)) > 0.3;
                const col = iM ? 'rgba(255,143,0,' : 'rgba(102,187,106,';
                this._magGroup.add(new Konva.Line({ points: [cx+Ri*Math.cos(a),cy+Ri*Math.sin(a),cx+Rg*Math.cos(a),cy+Rg*Math.sin(a)], stroke: col+0.45+')', strokeWidth: 2 }));
            }
            // 合成磁场方向箭头
            const fa = this._fieldAngle;
            const fA = 0.3 + 0.4*Math.min(1, 1-this.slip+0.2);
            this._magGroup.add(new Konva.Arrow({ points: [cx-(Ri-4)*Math.cos(fa),cy-(Ri-4)*Math.sin(fa),cx+(Ri-4)*Math.cos(fa),cy+(Ri-4)*Math.sin(fa)], stroke:`rgba(255,213,79,${fA*0.6})`, fill:`rgba(255,213,79,${fA*0.6})`, strokeWidth: 2.5, pointerLength: 6, pointerWidth: 5 }));
        }

        // 绕组亮度
        const iNorm = Math.min(1, this.currentMain / (this.ratedPower/this.ratedVoltage/this.ratedCos));
        const t = this._wavePhase;
        if (this._mainCoilGroups) this._mainCoilGroups.forEach((g, i) => g.opacity(0.4 + Math.abs(Math.sin(t + i*Math.PI)) * iNorm * 0.6));
        if (this._auxCoilGroups)  this._auxCoilGroups.forEach((g, i) => g.opacity(0.4 + Math.abs(Math.sin(t - Math.PI/2 + i*Math.PI)) * Math.min(1, this.currentAux/2) * 0.6));

        // 离心开关接触线（闭合/断开）
        if (this._centrifContactLine) {
            if (this.centrifSwitch) {
                // 断开：接触线倾斜
                const kX = this._centrifContactLine.points()[0];
                this._centrifContactLine.points([kX, this._centrifContactLine.points()[1] - 8, kX+12, this._centrifContactLine.points()[3]]);
                this._centrifContactLine.stroke('#ffd54f');
            } else {
                const kX = this._centrifContactLine.points()[0];
                this._centrifContactLine.points([kX, this._circY + (this._circH*0.46)*0.55, kX+12, this._circY + (this._circH*0.46)*0.55]);
                this._centrifContactLine.stroke('#ffd54f');
            }
        }
        if (this._centrifStatusText) this._centrifStatusText.text(this.centrifSwitch ? '断开（运行）' : '闭合（起动）');

        // 换向开关刀片
        if (this._swBlade1 && this._swBlade2) {
            const swCX = this._swCX, swCY = this._swCY;
            if (this.direction === 1) {
                this._swBlade1.points([swCX-30, swCY, swCX-30, swCY-16]);
                this._swBlade2.points([swCX+30, swCY, swCX+30, swCY+16]);
            } else {
                this._swBlade1.points([swCX-30, swCY, swCX-30, swCY+16]);
                this._swBlade2.points([swCX+30, swCY, swCX+30, swCY-16]);
            }
        }
        if (this._dirText) {
            this._dirText.text(this.direction===1 ? '▶ 正转' : '◀ 反转');
            this._dirText.fill(this.direction===1 ? '#66bb6a' : '#ffa726');
        }
    }

    _tickContactViz() {
        if (this._fwBtn) {
            this._fwBtn.btn.fill(this.direction===1?'#1a3a1a':'#0d1820');
            this._fwBtn.btn.stroke(this.direction===1?'#66bb6a':'#1a3040');
            this._fwBtn.lbl.fill(this.direction===1?'#66bb6a':'#4a5a6a');
        }
        if (this._rvBtn) {
            this._rvBtn.btn.fill(this.direction===-1?'#2a1a08':'#0d1820');
            this._rvBtn.btn.stroke(this.direction===-1?'#ffa726':'#1a3040');
            this._rvBtn.lbl.fill(this.direction===-1?'#ffa726':'#4a5a6a');
        }
    }

    _tickWorkPoint() {
        const n = this.speed * this.direction, T = this.torqueEM;
        const nx = this._tsOX+(n/this._tsNMax)*(this._tsAW-2);
        const ty = this._tsOY-(T/this._tsTMax)*(this._tsAH-4);
        if (this._workPoint) {
            this._workPoint.x(Math.max(this._tsOX, Math.min(this._tsOX+this._tsAW, nx)));
            this._workPoint.y(Math.max(this._curveY+14, Math.min(this._tsOY, ty)));
        }
    }

    _tickWaveform(dt) {
        if (!this._wavH3) return;
        this._wavAcc += 1.4*dt*this._wavLen;
        const steps = Math.floor(this._wavAcc); this._wavAcc -= steps;

        const Im_peak = this.currentMain * Math.sqrt(2);
        const Ia_peak = this.currentAux  * Math.sqrt(2);
        const t = this._wavePhase;
        const im = Im_peak * Math.sin(t);
        const ia = Ia_peak * Math.sin(t - Math.PI/2);  // 辅助绕组相位超前90°

        for (let i = 0; i < steps; i++) {
            this._wavIm = new Float32Array([...this._wavIm.slice(1), im]);
            this._wavIa = new Float32Array([...this._wavIa.slice(1), ia]);
            this._wavN  = new Float32Array([...this._wavN.slice(1),  this.speed]);
        }

        const wx = this._wavX+3, ww = this._wavW-6, n2 = this._wavLen, dx = ww/n2, h3 = this._wavH3;
        const iMax = Math.max(1, Im_peak*1.1);
        const [mIm, mIa, mN] = this._wavMids;
        const aI = h3*0.42, aN = h3*0.40;
        const imPts=[], iaPts=[], nPts=[];
        for (let i = 0; i < n2; i++) {
            const x = wx+i*dx;
            imPts.push(x, mIm-(this._wavIm[i]/iMax)*aI);
            iaPts.push(x, mIa-(this._wavIa[i]/iMax)*aI);
            nPts.push(x, mN-((this._wavN[i]/this.ratedSpeed)*2-1)*aN);
        }
        if (this._wLineIm) this._wLineIm.points(imPts);
        if (this._wLineIa) this._wLineIa.points(iaPts);
        if (this._wLineN)  this._wLineN.points(nPts);
    }

    _tickDisplay() {
        const n = this.speed;
        const mc = this.slip<0.03?'#66bb6a':this.slip<0.12?'#ffa726':'#ef5350';

        if (this._lcdBg)    this._lcdBg.fill('#020c14');
        if (this._lcdMain)  { this._lcdMain.text(n.toString()); this._lcdMain.fill(mc); }
        if (this._lcdSlip)  this._lcdSlip.text(`s=${this.slip.toFixed(4)}`);
        if (this._lcdTorque)this._lcdTorque.text(`T=${this.torqueEM.toFixed(2)}`);
        if (this._lcdCsw)   this._lcdCsw.text(this.centrifSwitch ? `Cs:断开` : `Cs:接入`);
        if (this._lcdCells) {
            if (this._lcdCells.im) this._lcdCells.im.text(this.currentMain.toFixed(2));
            if (this._lcdCells.ia) this._lcdCells.ia.text(this.currentAux.toFixed(2));
            if (this._lcdCells.pf) this._lcdCells.pf.text(this.powerFactor.toFixed(3));
        }

        if (this._loadBarCtrl) {
            const r = Math.min(1, this.torqueLoad/(this.ratedTorque*1.1+0.001));
            this._loadBarCtrl.width(r * this._ctrlLoadW);
        }
        if (this._loadValCtrl) this._loadValCtrl.text(`${this.torqueLoad.toFixed(2)}N·m`);
    }

    // ═══════════════════════════════════════════
    start() {
        if (this._startPhase === 0) { this._startPhase = 1; this._startTimer = 0; this.running = false; }
    }

    stop() {
        if (this._startPhase > 0) this._startPhase = 3;
    }

    setDirection(dir) {
        if (this._startPhase > 0) return;  // 运行时不允许切换
        this.direction = dir > 0 ? 1 : -1;
        this._refreshCache();
    }

    setLoad(t) {
        this._targetLoad = Math.max(0, Math.min(this.ratedTorque*1.2, t));
        this._refreshCache();
    }

    update(loadTorque) {
        if (typeof loadTorque === 'number') this.setLoad(loadTorque);
        this._refreshCache();
    }

    getConfigFields() {
        return [
            { label: '位号/名称',         key: 'id',           type: 'text'   },
            { label: '额定功率 (W)',       key: 'ratedPower',   type: 'number' },
            { label: '额定电压 (V)',       key: 'ratedVoltage', type: 'number' },
            { label: '额定转速 (rpm)',     key: 'ratedSpeed',   type: 'number' },
            { label: '起动电容 Cs (μF)',   key: 'Cs',           type: 'number' },
            { label: '运行电容 Cr (μF)',   key: 'Cr',           type: 'number' },
        ];
    }

    onConfigUpdate(cfg) {
        this.id          = cfg.id          || this.id;
        this.ratedPower  = parseFloat(cfg.ratedPower)   || this.ratedPower;
        this.ratedVoltage= parseFloat(cfg.ratedVoltage) || this.ratedVoltage;
        this.ratedSpeed  = parseFloat(cfg.ratedSpeed)   || this.ratedSpeed;
        this.Cs          = parseFloat(cfg.Cs)           || this.Cs;
        this.Cr          = parseFloat(cfg.Cr)           || this.Cr;
        this.syncSpeed   = 60*this.frequency/this.polePairs;
        this.syncOmega   = this.syncSpeed*2*Math.PI/60;
        this.ratedTorque = this.ratedPower/(this.ratedSpeed*2*Math.PI/60);
        this.config      = {...this.config,...cfg};
        this._refreshCache();
    }

    destroy() { this._stopAnimation(); super.destroy?.(); }
}