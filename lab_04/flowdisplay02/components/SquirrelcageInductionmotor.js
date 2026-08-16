import { BaseComponent } from './BaseComponent.js';

/**
 * 鼠笼式三相异步电动机仿真组件
 * （Squirrel Cage Three-Phase Induction Motor）
 *
 * ── 工作原理 ──────────────────────────────────────────────────
 *
 *  三相异步电动机基于旋转磁场与感应电流相互作用产生转矩：
 *
 *  1. 旋转磁场（Rotating Magnetic Field）：
 *     三相定子绕组通入对称三相交流电后，产生在气隙中旋转的合成磁场。
 *     同步转速（磁场转速）：
 *       n₁ = 60f / p     (rpm)
 *       f — 电源频率(Hz)，p — 极对数
 *
 *  2. 电磁感应（Induction）：
 *     转子导条（鼠笼）切割旋转磁场，产生感应电动势和感应电流。
 *     感应电动势频率：
 *       f₂ = s × f     (Hz)
 *     其中 s = 转差率 = (n₁ - n) / n₁
 *
 *  3. 安培力与转矩：
 *     转子感应电流在旋转磁场中受安培力作用，产生电磁转矩。
 *     电磁转矩公式：
 *       T = (p × U₁² × R₂'/s) / [ω₁ × ((R₁ + R₂'/s)² + (X₁ + X₂')²)]
 *     其中 R₂'/s — 转子折算电阻（含机械功率部分）
 *
 *  4. 转差率 s（Slip）：
 *     s = (n₁ - n) / n₁
 *     空载：s ≈ 0.001~0.005
 *     额定：s_N ≈ 0.03~0.06
 *     堵转：s = 1
 *
 *  5. 机械特性（Torque-Speed Curve）：
 *     最大转矩（临界转矩）：
 *       T_max = p × U₁² / [2ω₁ × (R₁ + √(R₁² + (X₁+X₂')²))]
 *     临界转差率：
 *       s_m = R₂' / √(R₁² + (X₁+X₂')²)
 *
 *  6. 鼠笼转子（Squirrel Cage Rotor）：
 *     铜条/铝条嵌入转子槽，两端由端环短接。
 *     无集电环，结构简单，维护方便。
 *
 * ── 组件结构 ──────────────────────────────────────────────────
 *  ① 电机截面图（正视）
 *     - 定子铁芯 + 三相绕组（U/V/W，120°分布）
 *     - 气隙旋转磁场（彩色旋转磁力线）
 *     - 鼠笼转子（导条 + 端环，随 n 旋转）
 *     - 转子感应电流方向标注（×/·符号）
 *  ② 侧视图（外壳/端盖/风扇/接线盒）
 *  ③ T-n（转矩-转速）特性曲线
 *     - 静稳定区 / 不稳定区
 *     - 工作点实时追踪
 *     - 最大转矩、起动转矩标注
 *  ④ 电流/转矩实时波形（U/V/W 三相电流）
 *  ⑤ 仪表 LCD（转速、转矩、功率因数、效率、滑差）
 *  ⑥ 负载调节器（拖拽调节）
 *  ⑦ 起动方式选择（直接/星三角/变频）
 *
 * ── 端口 ─────────────────────────────────────────────────────
 *  wire_u  — U 相输入
 *  wire_v  — V 相输入
 *  wire_w  — W 相输入
 *  wire_pe — 保护接地 PE
 *  pipe_shaft — 输出轴（机械负载）
 */
export class SquirrelCageInductionMotor extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.width  = Math.max(520, config.width  || 620);
        this.height = Math.max(360, config.height || 440);

        this.type    = 'squirrel_cage_im';
        this.special = 'none';
        this.cache   = 'fixed';

        this._initGroups();
        // ── 额定铭牌参数 ──
        this.ratedPower  = config.ratedPower  || 11;      // kW
        this.ratedVoltage= config.ratedVoltage|| 380;     // V（线电压）
        this.ratedSpeed  = config.ratedSpeed  || 1450;    // rpm
        this.frequency   = config.frequency   || 50;      // Hz
        this.polePairs   = config.polePairs   || 2;       // 极对数 p
        this.ratedCos    = config.ratedCos    || 0.87;    // 额定功率因数
        this.ratedEff    = config.ratedEff    || 91.0;    // 额定效率 %
        this.efficiency  = this.ratedEff;
        this.startMethod = config.startMethod || 'direct'; // 'direct'|'star_delta'|'vfd'

        // ── 等效电路参数（标幺值）──
        this.R1    = config.R1    || 0.021;   // 定子电阻（标幺）
        this.X1    = config.X1    || 0.083;   // 定子漏抗（标幺）
        this.R2    = config.R2    || 0.015;   // 转子折算电阻（标幺）
        this.X2    = config.X2    || 0.068;   // 转子折算漏抗（标幺）
        this.Xm    = config.Xm    || 2.8;     // 励磁感抗（标幺）
        this.Rm    = config.Rm    || 80;      // 铁损电阻（标幺）

        // ── 计算同步转速 ──
        this.syncSpeed = 60 * this.frequency / this.polePairs;    // rpm
        this.syncOmega = this.syncSpeed * 2 * Math.PI / 60;       // rad/s

        // ── 额定工况计算 ──
        this.ratedSlip    = (this.syncSpeed - this.ratedSpeed) / this.syncSpeed;
        this.ratedTorque  = (this.ratedPower * 1000) / (this.ratedSpeed * 2 * Math.PI / 60);  // N·m
        this.startTorque  = this.ratedTorque * 1.8;   // 起动转矩（约1.8倍额定）
        this.maxTorque    = this.ratedTorque * 2.5;   // 最大转矩（约2.5倍额定）
        this.slipMaxTorque= 0.12;                      // 最大转矩时转差率

        // ── 运行状态 ──
        this.running      = false;
        this._startPhase  = 0;    // 0=停机 1=起动 2=运行 3=制动
        this._startTimer  = 0;
        this.powered      = true;

        // ── 动态状态（物理积分）──
        this.slip         = 1.0;    // 当前转差率
        this._slipSmooth  = 1.0;    // 平滑转差（显示用）
        this.speed        = 0;      // rpm
        this.omega        = 0;      // rad/s
        this.torqueEM     = 0;      // 电磁转矩 N·m
        this.torqueLoad   = config.initLoad || 0;  // 负载转矩 N·m
        this._targetLoad  = config.initLoad || 0;
        this.currentA     = 0;      // 定子线电流 A
        this.power_in     = 0;      // 输入功率 W
        this.power_out    = 0;      // 输出功率 W
        this.powerFactor  = 0;      // 功率因数
        this.J            = config.J || 0.5;  // 转动惯量 kg·m²

        // ── 动画 ──
        this._fieldAngle   = 0;     // 旋转磁场角度 rad
        this._rotorAngle   = 0;     // 转子物理角度 rad
        this._cagePhase    = 0;     // 笼条感应电流相位
        this._phase        = 0;     // 通用相位
        this._startFlicker = 0;     // 起动时电流闪烁
        this._loadSmooth   = 0;     // 负载平滑值

        // ── 三相电流波形缓冲 ──
        this._wavLen      = 240;
        this._wavIu       = new Float32Array(this._wavLen).fill(0);
        this._wavIv       = new Float32Array(this._wavLen).fill(0);
        this._wavIw       = new Float32Array(this._wavLen).fill(0);
        this._wavN        = new Float32Array(this._wavLen).fill(0);
        this._wavAcc      = 0;

        // ── 几何布局 ──
        // 电机截面图（左侧）
        this._motorCX  = Math.round(this.width  * 0.22);
        this._motorCY  = Math.round(this.height * 0.40);
        this._statorRo = Math.round(Math.min(this.width * 0.18, this.height * 0.34));
        this._statorRi = Math.round(this._statorRo * 0.75);  // 定子内径（含槽）
        this._airGap   = Math.round(this._statorRo * 0.05);
        this._rotorRo  = this._statorRi - this._airGap;
        this._rotorRi  = Math.round(this._rotorRo * 0.38);   // 转子内径（轴孔）

        // 侧视外形轮廓（截面图右方）
        this._sideX    = this._motorCX + this._statorRo + 24;
        this._sideY    = Math.round(this.height * 0.08);
        this._sideW    = Math.round(this.width  * 0.16);
        this._sideH    = Math.round(this.height * 0.56);

        // 特性曲线（右上）
        this._curveX   = this._sideX + this._sideW + 14;
        this._curveY   = this._sideY;
        this._curveW   = this.width - this._curveX - 8;
        this._curveH   = Math.round(this.height * 0.45);

        // LCD（右中）
        this._lcdX     = this._curveX;
        this._lcdY     = this._curveY + this._curveH + 8;
        this._lcdW     = Math.round(this._curveW * 0.48);
        this._lcdH     = Math.round(this.height * 0.26);

        // 负载面板（右中右）
        this._loadX    = this._lcdX + this._lcdW + 8;
        this._loadY    = this._lcdY;
        this._loadW    = this._curveW - this._lcdW - 8;
        this._loadH    = this._lcdH;

        // 波形区（底部）
        this._wavX     = 8;
        this._wavY     = Math.max(this._motorCY + this._statorRo + 14, this._lcdY + this._lcdH + 8);
        this._wavW     = this.width - 16;
        this._wavH     = this.height - this._wavY - 6;

        this.knobs     = {};

        this.config = {
            id: this.id, ratedPower: this.ratedPower, ratedVoltage: this.ratedVoltage,
            ratedSpeed: this.ratedSpeed, polePairs: this.polePairs,
        };

        this._init();

        const cy2 = this._motorCY;
        this.addPort(0,            cy2 - 24, 'u',     'wire', 'U');
        this.addPort(0,            cy2,       'v',     'wire', 'V');
        this.addPort(0,            cy2 + 24, 'w',     'wire', 'W');
        this.addPort(0,            cy2 + 48, 'pe',    'wire', 'PE');
        this.addPort(this._motorCX + this._statorRo + 8, cy2, 'shaft', 'pipe', '输出轴');
    }

    // ═══════════════════════════════════════════
    _init() {
        this._drawLabel();
        this._drawStatorIron();
        this._drawStatorWindings();
        this._drawRotorCore();
        this._drawCageRotor();
        this._drawShaft();
        this._drawMagneticFieldLayer();
        this._drawInducedCurrentLayer();
        this._drawForceArrowLayer();
        this._drawSideView();
        this._drawTorqueSpeedCurve();
        this._drawLCDPanel();
        this._drawLoadPanel();
        this._drawWaveform();
        this._drawControls();
        
    }

    _drawLabel() {
        this._staticGroup.add(new Konva.Text({
            x: 0, y: -22, width: this.width,
            text: `鼠笼式三相异步电动机  ${this.ratedPower}kW  ${this.ratedVoltage}V  ${this.ratedSpeed}rpm  ${this.polePairs * 2}极`,
            fontSize: 12, fontStyle: 'bold', fill: '#1a2634', align: 'center',
        }));
    }

    // ── 定子铁芯 ─────────────────────────────
    _drawStatorIron() {
        const cx = this._motorCX, cy = this._motorCY;
        const Ro = this._statorRo, Ri = this._statorRi;

        // 定子铁芯外圆
        this._staticGroup.add(new Konva.Circle({ x: cx, y: cy, radius: Ro + 10, fill: '#455a64', stroke: '#263238', strokeWidth: 2.5 }));
        // 安装耳
        for (let i = 0; i < 4; i++) {
            const a = (i/4)*Math.PI*2 + Math.PI/4;
            this._staticGroup.add(new Konva.Circle({ x: cx+(Ro+8)*Math.cos(a), y: cy+(Ro+8)*Math.sin(a), radius: 5.5, fill: '#37474f', stroke: '#1a2634', strokeWidth: 0.5 }));
        }
        // 定子铁芯体（圆环）
        this._staticGroup.add(new Konva.Ring({ x: cx, y: cy, innerRadius: Ri-2, outerRadius: Ro, fill: '#546e7a', stroke: '#37474f', strokeWidth: 0.5 }));
        // 叠片纹理（放射状细线）
        for (let i = 0; i < 24; i++) {
            const a = (i/24)*Math.PI*2;
            this._staticGroup.add(new Konva.Line({
                points: [cx+Ri*Math.cos(a), cy+Ri*Math.sin(a), cx+Ro*Math.cos(a), cy+Ro*Math.sin(a)],
                stroke: 'rgba(0,0,0,0.15)', strokeWidth: 0.7,
            }));
        }
        // 定子槽（矩形槽，36槽）
        const slotN = 36;
        const slotW = 3.5, slotD = (Ro - Ri - 2) * 0.55;
        for (let i = 0; i < slotN; i++) {
            const a = (i/slotN)*Math.PI*2 - Math.PI/2;
            const slotR = Ri + 2;
            const g = new Konva.Group({ x: cx + slotR*Math.cos(a), y: cy + slotR*Math.sin(a), rotation: a*180/Math.PI + 90 });
            g.add(new Konva.Rect({ x: -slotW/2, y: 0, width: slotW, height: slotD, fill: '#0d1a28' }));
            this._staticGroup.add(g);
        }
        // 内壁高光
        this._staticGroup.add(new Konva.Arc({ x: cx, y: cy, innerRadius: Ri-1, outerRadius: Ri+1, angle: 60, rotation: -140, fill: 'rgba(255,255,255,0.08)' }));

        // 气隙（透明环）
        this._airGapRing = new Konva.Ring({ x: cx, y: cy, innerRadius: this._rotorRo+1, outerRadius: Ri-3, fill: 'rgba(100,200,255,0.04)' });
        this._staticGroup.add(this._airGapRing);

        // 截面图标注
        this._staticGroup.add(new Konva.Text({ x: cx-this._statorRo, y: cy-this._statorRo-22, width: this._statorRo*2, text: '三相异步电动机（截面图）', fontSize: 9, fontStyle: 'bold', fill: '#546e7a', align: 'center' }));
    }

    // ── 定子三相绕组（U/V/W，120°分布）─────
    _drawStatorWindings() {
        const cx = this._motorCX, cy = this._motorCY;
        const Ri = this._statorRi, Ro = this._statorRo;
        const phases = [
            { name: 'U', color: '#ef5350', angles: [0, Math.PI] },
            { name: 'V', color: '#66bb6a', angles: [2*Math.PI/3, 2*Math.PI/3 + Math.PI] },
            { name: 'W', color: '#42a5f5', angles: [4*Math.PI/3, 4*Math.PI/3 + Math.PI] },
        ];
        this._phaseGroups = [];
        phases.forEach(ph => {
            const grp = new Konva.Group();
            ph.angles.forEach((a, side) => {
                const r = (Ri + Ro - 4) / 2;
                const bw = (Ro - Ri - 8) * 0.6, bh = 10;
                const g2 = new Konva.Group({ x: cx + r*Math.cos(a-Math.PI/2), y: cy + r*Math.sin(a-Math.PI/2), rotation: (a-Math.PI/2)*180/Math.PI+90 });
                const coil = new Konva.Rect({ x: -bw/2, y: -bh/2, width: bw, height: bh, fill: ph.color, stroke: 'none', cornerRadius: 2, opacity: 0.75 });
                const dot  = new Konva.Text({ x: -5, y: -6, text: side===0 ? '·' : '×', fontSize: 11, fill: '#ffffff', fontStyle: 'bold' });
                g2.add(coil, dot);
                grp.add(g2);
                // 引线
                this._staticGroup.add(new Konva.Line({ points: [cx+(r-bh/2)*Math.cos(a-Math.PI/2), cy+(r-bh/2)*Math.sin(a-Math.PI/2), cx+(Ri-4)*Math.cos(a-Math.PI/2), cy+(Ri-4)*Math.sin(a-Math.PI/2)], stroke: ph.color, strokeWidth: 1.5, opacity: 0.5 }));
            });
            this._phaseGroups.push({ grp, color: ph.color, name: ph.name });
            this._staticGroup.add(grp);
        });
        // 相序标注
        phases.forEach((ph, i) => {
            const a = ph.angles[0] - Math.PI/2;
            const r = Ro + 18;
            this._staticGroup.add(new Konva.Text({ x: cx + r*Math.cos(a)-8, y: cy + r*Math.sin(a)-6, text: ph.name, fontSize: 10, fontStyle: 'bold', fill: ph.color }));
        });
    }

    // ── 转子铁芯 ─────────────────────────────
    _drawRotorCore() {
        const cx = this._motorCX, cy = this._motorCY;
        this._rotorGroup = new Konva.Group({ x: cx, y: cy });
        // 转子铁芯体
        const rotorIron = new Konva.Ring({ innerRadius: this._rotorRi, outerRadius: this._rotorRo-2, fill: '#607d8b', stroke: '#37474f', strokeWidth: 0.8 });
        // 铁芯叠片纹理
        for (let i = 0; i < 20; i++) {
            const a = (i/20)*Math.PI*2;
            this._rotorGroup.add(new Konva.Line({ points: [this._rotorRi*Math.cos(a), this._rotorRi*Math.sin(a), (this._rotorRo-3)*Math.cos(a), (this._rotorRo-3)*Math.sin(a)], stroke: 'rgba(0,0,0,0.12)', strokeWidth: 0.6 }));
        }
        // 轴孔
        const shaft = new Konva.Circle({ radius: this._rotorRi, fill: '#37474f', stroke: '#263238', strokeWidth: 1.5 });
        const shaftGlint = new Konva.Circle({ x: -this._rotorRi*0.25, y: -this._rotorRi*0.25, radius: this._rotorRi*0.2, fill: 'rgba(255,255,255,0.15)' });
        const keyway = new Konva.Rect({ x: -this._rotorRi*0.12, y: -this._rotorRi, width: this._rotorRi*0.24, height: this._rotorRi*0.18, fill: '#263238' });

        this._rotorGroup.add(rotorIron, shaft, shaftGlint, keyway);
        this._staticGroup.add(this._rotorGroup);
    }

    // ── 鼠笼转子（导条 + 端环）──────────────
    _drawCageRotor() {
        const cx = this._motorCX, cy = this._motorCY;
        const barN = 28;  // 导条数量

        this._cageGroup = new Konva.Group({ x: cx, y: cy });
        this._cageBars  = [];
        for (let i = 0; i < barN; i++) {
            const a    = (i / barN) * Math.PI * 2;
            const r    = (this._rotorRo - 4 + this._rotorRi + 2) / 2;
            const barH = this._rotorRo - this._rotorRi - 8;
            const g    = new Konva.Group({ x: r*Math.cos(a), y: r*Math.sin(a), rotation: a*180/Math.PI });
            const bar  = new Konva.Rect({ x: -2.5, y: -barH/2, width: 5, height: barH, fill: '#c0a020', stroke: '#8a7010', strokeWidth: 0.5, cornerRadius: 1 });
            // 感应电流方向标注（动态）
            const marker = new Konva.Text({ x: -4, y: -5, text: '·', fontSize: 10, fill: '#ffd54f', visible: false });
            this._cageBars.push({ bar, marker, angle: a });
            g.add(bar, marker);
            this._cageGroup.add(g);
        }
        // 端环（圆形）
        this._cageGroup.add(new Konva.Ring({ innerRadius: this._rotorRi+4, outerRadius: this._rotorRi+10, fill: '#c0a020', stroke: '#8a7010', strokeWidth: 0.5 }));
        this._cageGroup.add(new Konva.Ring({ innerRadius: this._rotorRo-10, outerRadius: this._rotorRo-4, fill: '#c0a020', stroke: '#8a7010', strokeWidth: 0.5 }));

        // 标注
        this._staticGroup.add(new Konva.Text({ x: cx-22, y: cy+this._rotorRo+6, text: '鼠笼转子', fontSize: 8.5, fill: '#c0a020', fontStyle: 'bold' }));

        this._staticGroup.add(this._cageGroup);
    }

    // ── 输出轴 ────────────────────────────────
    _drawShaft() {
        const cx = this._motorCX, cy = this._motorCY, Ro = this._statorRo;
        this._staticGroup.add(new Konva.Rect({ x: cx+Ro+8, y: cy-5, width: 24, height: 10, fill: '#78909c', stroke: '#546e7a', strokeWidth: 1 }));
        this._staticGroup.add(new Konva.Ellipse({ x: cx+Ro+8, y: cy, radiusX: 8, radiusY: this._statorRi*0.48, fill: '#607d8b', stroke: '#37474f', strokeWidth: 1.5 }));
        this._staticGroup.add(new Konva.Ellipse({ x: cx-Ro-8, y: cy, radiusX: 8, radiusY: this._statorRi*0.48, fill: '#607d8b', stroke: '#37474f', strokeWidth: 1.5 }));
        this._staticGroup.add(new Konva.Text({ x: cx+Ro+10, y: cy+8, text: '输出轴', fontSize: 7.5, fill: '#607d8b' }));
    }

    // ── 旋转磁场层（动态）────────────────────
    _drawMagneticFieldLayer() {
        this._magFieldGroup = new Konva.Group();
        this._staticGroup.add(this._magFieldGroup);
    }

    // ── 感应电流层（动态）────────────────────
    _drawInducedCurrentLayer() {
        this._inducedGroup = new Konva.Group();
        this._staticGroup.add(this._inducedGroup);
    }

    // ── 安培力箭头层（动态）──────────────────
    _drawForceArrowLayer() {
        this._forceGroup = new Konva.Group();
        this._staticGroup.add(this._forceGroup);
    }

    // ── 侧视外形图 ───────────────────────────
    _drawSideView() {
        const sx = this._sideX, sy = this._sideY, sw = this._sideW, sh = this._sideH;
        const cx2 = sx + sw/2, cy2 = sy + sh/2;

        // 机壳（矩形+圆角）
        const body = new Konva.Rect({ x: sx+6, y: sy+sh*0.12, width: sw-12, height: sh*0.78, fill: '#4a7a9b', stroke: '#2c5b7a', strokeWidth: 2, cornerRadius: 6 });
        // 散热筋（竖向）
        for (let i = 0; i < 7; i++) {
            const bx = sx+10+i*(sw-20)/6;
            this._staticGroup.add(new Konva.Rect({ x: bx, y: sy+sh*0.12, width: 3, height: sh*0.78, fill: '#2c5b7a', cornerRadius: 1 }));
        }
        // 前后端盖（椭圆形）
        const capRY = sh*0.39;
        const leftCap = new Konva.Ellipse({ x: sx+6, y: cy2, radiusX: 10, radiusY: capRY, fill: '#5a9ab8', stroke: '#2c5b7a', strokeWidth: 2 });
        const rightCap= new Konva.Ellipse({ x: sx+sw-6, y: cy2, radiusX: 10, radiusY: capRY, fill: '#5a9ab8', stroke: '#2c5b7a', strokeWidth: 2 });
        // 冷却风扇（右端）
        this._fanGroup = new Konva.Group({ x: sx+sw-4, y: cy2 });
        const fanBlade = 8;
        for (let i = 0; i < fanBlade; i++) {
            const a = (i/fanBlade)*Math.PI*2;
            this._fanGroup.add(new Konva.Line({ points: [capRY*0.18*Math.cos(a), capRY*0.18*Math.sin(a), capRY*0.52*Math.cos(a+0.5), capRY*0.52*Math.sin(a+0.5)], stroke: '#b0c4d8', strokeWidth: 3, lineCap: 'round' }));
        }
        this._fanGroup.add(new Konva.Circle({ radius: capRY*0.16, fill: '#2c5b7a', stroke: '#1a3a50', strokeWidth: 1 }));
        // 轴（伸出左端）
        this._staticGroup.add(new Konva.Rect({ x: sx-16, y: cy2-5, width: 22, height: 10, fill: '#78909c', stroke: '#546e7a', strokeWidth: 1 }));
        // 接线盒（顶部）
        const jbX = cx2-15, jbY = sy+sh*0.12-14;
        this._staticGroup.add(new Konva.Rect({ x: jbX, y: jbY, width: 30, height: 14, fill: '#3a5a78', stroke: '#2c5b7a', strokeWidth: 1.5, cornerRadius: [3,3,0,0] }));
        this._staticGroup.add(new Konva.Text({ x: jbX+2, y: jbY+3, width: 26, text: 'U V W', fontSize: 7.5, fill: '#80c0d4', align: 'center' }));
        // 铭牌
        this._staticGroup.add(new Konva.Rect({ x: cx2-20, y: cy2-10, width: 40, height: 20, fill: '#1a3a50', cornerRadius: 2 }));
        this._staticGroup.add(new Konva.Text({ x: cx2-20, y: cy2-8, width: 40, text: `${this.ratedPower}kW\n${this.ratedVoltage}V`, fontSize: 7.5, fill: '#80c0d4', align: 'center', lineHeight: 1.3 }));
        // 支脚
        [-sh*0.28, sh*0.28].forEach(dy => {
            this._staticGroup.add(new Konva.Rect({ x: sx+8, y: cy2+dy-4, width: sw-16, height: 8, fill: '#3a5a78', cornerRadius: 2 }));
            this._staticGroup.add(new Konva.Rect({ x: sx+10, y: cy2+dy+4, width: sw-20, height: 10, fill: '#2c5b7a', cornerRadius: [0,0,2,2] }));
        });
        this._staticGroup.add(body, leftCap, rightCap, this._fanGroup);
        this._staticGroup.add(new Konva.Text({ x: sx, y: sy-16, width: sw, text: '侧视图', fontSize: 8.5, fontStyle: 'bold', fill: '#546e7a', align: 'center' }));
    }

    // ── 转矩-转速特性曲线 ────────────────────
    _drawTorqueSpeedCurve() {
        const { _curveX: cx2, _curveY: cy2, _curveW: cw, _curveH: ch } = this;

        const bg = new Konva.Rect({ x: cx2, y: cy2, width: cw, height: ch, fill: '#010d18', stroke: '#1a3040', strokeWidth: 1.5, cornerRadius: 4 });
        const titleBg = new Konva.Rect({ x: cx2, y: cy2, width: cw, height: 14, fill: '#0a1a28', cornerRadius: [4,4,0,0] });
        this._staticGroup.add(new Konva.Text({ x: cx2+4, y: cy2+2, width: cw-8, text: 'T-n 机械特性曲线（转矩-转速）', fontSize: 8, fontStyle: 'bold', fill: '#80cbc4', align: 'center' }));

        // 坐标系
        const ox = cx2+18, oy = cy2+ch-14, aw = cw-24, ah = ch-28;
        this._staticGroup.add(new Konva.Line({ points: [ox, oy-ah, ox, oy, ox+aw, oy], stroke: '#37474f', strokeWidth: 1 }));
        this._staticGroup.add(new Konva.Text({ x: ox-16, y: cy2+14, text: 'T(N·m)', fontSize: 7, fill: '#80cbc4' }));
        this._staticGroup.add(new Konva.Text({ x: cx2+cw-14, y: oy+2, text: 'n(rpm)', fontSize: 7, fill: '#80cbc4' }));

        // 轴刻度
        const nMax = this.syncSpeed + 100;
        const tMax = this.maxTorque * 1.15;
        [0, 500, 1000, this.syncSpeed].forEach(n => {
            const nx = ox + (n/nMax)*(aw-2);
            this._staticGroup.add(new Konva.Line({ points: [nx, oy, nx, oy+3], stroke: '#37474f', strokeWidth: 0.8 }));
            this._staticGroup.add(new Konva.Text({ x: nx-10, y: oy+4, width: 20, text: n===this.syncSpeed?'n₁':n.toString(), fontSize: 6, fill: '#37474f', align: 'center' }));
        });
        [0, this.ratedTorque, this.maxTorque].forEach(T => {
            const ty = oy - (T/tMax)*(ah-4);
            this._staticGroup.add(new Konva.Line({ points: [ox-3, ty, ox, ty], stroke: '#37474f', strokeWidth: 0.8 }));
            this._staticGroup.add(new Konva.Text({ x: ox-24, y: ty-4, width: 22, text: T===0?'0':Math.round(T)+'', fontSize: 6, fill: '#37474f', align: 'right' }));
        });

        // 计算并绘制 T-n 曲线（遍历转差率）
        const tsCurvePts = [];
        for (let s = 1.0; s >= -0.05; s -= 0.01) {
            const n = this.syncSpeed * (1 - s);
            if (n < 0) continue;
            const T = this._calcTorque(s);
            const nx = ox + (n/nMax)*(aw-2);
            const ty = oy - (T/tMax)*(ah-4);
            if (nx > ox && nx < ox+aw && ty > cy2+14 && ty < oy) tsCurvePts.push(nx, ty);
        }
        if (tsCurvePts.length > 2) {
            this._staticGroup.add(new Konva.Line({ points: tsCurvePts, stroke: '#4fc3f7', strokeWidth: 2, lineJoin: 'round', opacity: 0.85 }));
        }

        // 特殊点标注
        // 额定点
        const nRatedX = ox + (this.ratedSpeed/nMax)*(aw-2);
        const tRatedY = oy - (this.ratedTorque/tMax)*(ah-4);
        this._staticGroup.add(new Konva.Circle({ x: nRatedX, y: tRatedY, radius: 4, fill: '#66bb6a', stroke: '#2e7d32', strokeWidth: 1 }));
        this._staticGroup.add(new Konva.Text({ x: nRatedX+4, y: tRatedY-10, text: 'N点', fontSize: 7, fill: '#66bb6a' }));
        // 最大转矩点
        const nMaxX = ox + (this.syncSpeed*(1-this.slipMaxTorque)/nMax)*(aw-2);
        const tMaxY = oy - (this.maxTorque/tMax)*(ah-4);
        this._staticGroup.add(new Konva.Circle({ x: nMaxX, y: tMaxY, radius: 4, fill: '#ffa726', stroke: '#e65100', strokeWidth: 1 }));
        this._staticGroup.add(new Konva.Text({ x: nMaxX-18, y: tMaxY-12, text: 'T_max', fontSize: 7, fill: '#ffa726' }));
        // 同步速垂线
        const n1X = ox + (this.syncSpeed/nMax)*(aw-2);
        this._staticGroup.add(new Konva.Line({ points: [n1X, oy-ah+2, n1X, oy], stroke: 'rgba(255,255,255,0.1)', strokeWidth: 0.8, dash: [3,3] }));
        // 稳定/不稳定区标注
        this._staticGroup.add(new Konva.Text({ x: ox+4, y: oy-ah+14, text: '不稳定区', fontSize: 7, fill: 'rgba(239,83,80,0.55)' }));
        this._staticGroup.add(new Konva.Text({ x: nMaxX+8, y: oy-ah+14, text: '稳定运行区', fontSize: 7, fill: 'rgba(102,187,106,0.55)' }));

        // 工作点（动态）
        this._workPoint = new Konva.Circle({ x: ox, y: oy, radius: 5.5, fill: '#ef5350', stroke: '#c62828', strokeWidth: 1.5 });
        this._workHLine = new Konva.Line({ points: [], stroke: '#ef5350', strokeWidth: 0.8, dash: [3,2], opacity: 0.5 });
        this._workVLine = new Konva.Line({ points: [], stroke: '#ef5350', strokeWidth: 0.8, dash: [3,2], opacity: 0.5 });

        this._tsOX = ox; this._tsOY = oy; this._tsAW = aw; this._tsAH = ah;
        this._tsNMax = nMax; this._tsTMax = tMax;

        this._staticGroup.add(bg, titleBg, this._workPoint, this._workHLine, this._workVLine);
    }

    // ── LCD 仪表面板 ─────────────────────────
    _drawLCDPanel() {
        const lx = this._lcdX, ly = this._lcdY, lw = this._lcdW, lh = this._lcdH;

        const bg = new Konva.Rect({ x: lx, y: ly, width: lw, height: lh, fill: '#020c14', stroke: '#1a3040', strokeWidth: 1.5, cornerRadius: 4 });
        const titleBg = new Konva.Rect({ x: lx, y: ly, width: lw, height: 14, fill: '#0a1a28', cornerRadius: [4,4,0,0] });
        this._staticGroup.add(new Konva.Text({ x: lx+4, y: ly+2, width: lw-8, text: '运行参数', fontSize: 8, fontStyle: 'bold', fill: '#80cbc4', align: 'center' }));

        // 圆形转速表
        const lcx = lx + lw/2, lcy = ly + lh/2 + 4;
        const R   = Math.min(lw*0.38, lh*0.42);
        this._lcCX = lcx; this._lcCY = lcy; this._lcR = R;

        this._staticGroup.add(new Konva.Circle({ x: lcx, y: lcy, radius: R+4, fill: '#0d1520', stroke: '#1a252f', strokeWidth: 1 }));
        const ring = new Konva.Circle({ x: lcx, y: lcy, radius: R+2, fill: '#001a10', stroke: '#1b5e20', strokeWidth: 2.5 });
        this._lcdBg = new Konva.Circle({ x: lcx, y: lcy, radius: R, fill: '#020c14' });
        this._speedArc = new Konva.Arc({ x: lcx, y: lcy, innerRadius: R-5, outerRadius: R-3, angle: 0, fill: '#66bb6a', rotation: -90 });

        this._lcdMain  = new Konva.Text({ x: lcx-R+4, y: lcy-R*.40, width:(R-4)*2, text:'0',      fontSize:R*.44, fontFamily:'Courier New, monospace', fontStyle:'bold', fill:'#66bb6a', align:'center' });
        this._lcdUnit  = new Konva.Text({ x: lcx-R+4, y: lcy+R*.09, width:(R-4)*2, text:'rpm',    fontSize:R*.17, fill:'#001a10', align:'center' });
        this._lcdSlip  = new Konva.Text({ x: lcx-R+4, y: lcy+R*.28, width:(R-4)*2, text:'s=1.00', fontSize:R*.13, fontFamily:'Courier New, monospace', fill:'#37474f', align:'center' });
        this._lcdTorque= new Konva.Text({ x: lcx-R+4, y: lcy-R*.62, width:(R-4)*2, text:'T=0 N·m',fontSize:R*.12, fontFamily:'Courier New, monospace', fill:'#80cbc4', align:'center' });
        this._lcdPF    = new Konva.Text({ x: lcx-R+4, y: lcy+R*.46, width:(R-4)*2, text:'cosφ=0', fontSize:R*.12, fontFamily:'Courier New, monospace', fill:'#263238', align:'center' });

        this._staticGroup.add(ring, this._lcdBg, this._speedArc, this._lcdMain, this._lcdUnit, this._lcdSlip, this._lcdTorque, this._lcdPF, bg, titleBg);
    }

    // ── 负载调节面板 ─────────────────────────
    _drawLoadPanel() {
        const px = this._loadX, py = this._loadY, pw = this._loadW, ph = this._loadH;

        const bg = new Konva.Rect({ x: px, y: py, width: pw, height: ph, fill: '#020c14', stroke: '#1a3040', strokeWidth: 1.5, cornerRadius: 4 });
        const titleBg = new Konva.Rect({ x: px, y: py, width: pw, height: 14, fill: '#0a1a28', cornerRadius: [4,4,0,0] });
        this._staticGroup.add(new Konva.Text({ x: px+4, y: py+2, width: pw-8, text: '负载调节 T_L', fontSize: 8, fontStyle: 'bold', fill: '#ffa726', align: 'center' }));

        // 负载进度条（垂直）
        const barX = px+pw/2-8, barY = py+20, barW = 16, barH = ph-50;
        this._staticGroup.add(new Konva.Rect({ x: barX, y: barY, width: barW, height: barH, fill: '#0d2030', cornerRadius: 3 }));
        this._loadBar = new Konva.Rect({ x: barX, y: barY+barH, width: barW, height: 0, fill: '#ffa726', cornerRadius: 3 });
        this._loadBar._barY = barY; this._loadBar._barH = barH;

        this._loadValText = new Konva.Text({ x: px+4, y: py+ph-28, width: pw-8, text: '0.0 N·m', fontSize: 9, fontFamily: 'Courier New, monospace', fill: '#ffa726', align: 'center' });
        this._loadPctText = new Konva.Text({ x: px+4, y: py+ph-16, width: pw-8, text: '0% 额定', fontSize: 8, fill: '#546e7a', align: 'center' });

        // 拖拽调节
        const hit = new Konva.Rect({ x: barX-8, y: barY, width: barW+16, height: barH, fill: 'transparent', listening: true });
        hit.on('mousedown touchstart', e => {
            e.cancelBubble = true;
            const stage = this.group.getStage?.();
            const pos   = stage?.getPointerPosition?.() ?? { y: e.evt?.clientY ?? 0 };
            const relY  = pos.y - (this.group.y?.() ?? 0) - barY;
            this._targetLoad = Math.max(0, Math.min(this.ratedTorque*1.2, (1-relY/barH)*this.ratedTorque*1.2));
        });
        const mv = e => {
            const stage = this.group.getStage?.();
            const pos   = stage?.getPointerPosition?.() ?? { y: e.clientY ?? 0 };
            const relY  = pos.y - (this.group.y?.() ?? 0) - barY;
            this._targetLoad = Math.max(0, Math.min(this.ratedTorque*1.2, (1-relY/barH)*this.ratedTorque*1.2));
        };
        const up = () => { window.removeEventListener('mousemove', mv); window.removeEventListener('touchmove', mv); window.removeEventListener('mouseup', up); window.removeEventListener('touchend', up); };
        hit.on('mousedown touchstart', () => { window.addEventListener('mousemove', mv); window.addEventListener('touchmove', mv, {passive:true}); window.addEventListener('mouseup', up); window.addEventListener('touchend', up); });

        // 起动方式按钮（顶部）
        const methods = [['直接', 'direct'],['Y-Δ','star_delta'],['VFD','vfd']];
        const mw = (pw-10)/3;
        this._startMethodBtns = [];
        methods.forEach(([label, method], i) => {
            const bx = px+5+i*(mw+2);
            const isAct = method === this.startMethod;
            const btn = new Konva.Rect({ x: bx, y: py+16, width: mw, height: 14, fill: isAct?'#1a3a1a':'#0d2030', stroke: isAct?'#66bb6a':'#1a3040', strokeWidth: 1, cornerRadius: 2 });
            const lbl = new Konva.Text({ x: bx, y: py+19, width: mw, text: label, fontSize: 8, fill: isAct?'#66bb6a':'#37474f', align: 'center' });
            btn.on('click tap', () => {
                this.startMethod = method;
                this._startMethodBtns.forEach((b, j) => {
                    const act = methods[j][1] === method;
                    b.btn.fill(act?'#1a3a1a':'#0d2030'); b.btn.stroke(act?'#66bb6a':'#1a3040');
                    b.lbl.fill(act?'#66bb6a':'#37474f');
                });
            });
            this._startMethodBtns.push({ btn, lbl });
            this._interactGroup.add(btn, lbl);
        });

        this._interactGroup.add(bg, titleBg, this._loadBar, this._loadValText, this._loadPctText, hit);
    }

    // ── 三相电流波形区（底部）────────────────
    _drawWaveform() {
        const { _wavX: wx, _wavY: wy, _wavW: ww, _wavH: wh } = this;
        if (wh < 16) return;

        const bg = new Konva.Rect({ x: wx, y: wy, width: ww, height: wh, fill: '#010d18', stroke: '#1a3040', strokeWidth: 1.5, cornerRadius: 4 });
        const titleBg = new Konva.Rect({ x: wx, y: wy, width: ww, height: 14, fill: '#0a1a28', cornerRadius: [4,4,0,0] });
        this._staticGroup.add(new Konva.Text({ x: wx+4, y: wy+2, width: ww-8, text: '三相定子电流  Iu(t)  Iv(t)  Iw(t)  ── 转速 n(t)', fontSize: 8, fontStyle: 'bold', fill: '#80cbc4', align: 'center' }));

        const h4 = (wh-14)/4;
        this._wavMids = [wy+14+h4*0.5, wy+14+h4*1.5, wy+14+h4*2.5, wy+14+h4*3.5];
        this._wavMids.forEach(my => {
            this._staticGroup.add(new Konva.Line({ points: [wx+2, my, wx+ww-2, my], stroke: 'rgba(200,200,200,0.08)', strokeWidth: 0.5, dash: [4,3] }));
        });

        this._wLineIu = new Konva.Line({ points: [], stroke: '#ef5350', strokeWidth: 1.5, lineJoin: 'round' });
        this._wLineIv = new Konva.Line({ points: [], stroke: '#66bb6a', strokeWidth: 1.5, lineJoin: 'round' });
        this._wLineIw = new Konva.Line({ points: [], stroke: '#42a5f5', strokeWidth: 1.5, lineJoin: 'round' });
        this._wLineN  = new Konva.Line({ points: [], stroke: '#ffd54f', strokeWidth: 1.8, lineJoin: 'round' });

        const lbls = ['Iu(A)','Iv(A)','Iw(A)','n(rpm)'];
        const cols = ['#ef5350','#66bb6a','#42a5f5','#ffd54f'];
        lbls.forEach((l, i) => { this._staticGroup.add(new Konva.Text({ x: wx+4, y: wy+14+h4*i+4, text: l, fontSize: 8, fill: cols[i] })); });

        this._wIuLbl = new Konva.Text({ x: wx+ww-80, y: wy+14+4, width: 76, text: '0A', fontSize: 8, fontFamily: 'Courier New, monospace', fill: '#ef5350', align: 'right' });
        this._wNLbl  = new Konva.Text({ x: wx+ww-80, y: wy+14+h4*3+4, width: 76, text: '0rpm', fontSize: 8, fontFamily: 'Courier New, monospace', fill: '#ffd54f', align: 'right' });

        this._staticGroup.add(bg, titleBg, this._wLineIu, this._wLineIv, this._wLineIw, this._wLineN, this._wIuLbl, this._wNLbl);
        this._wavH4 = h4;
    }

    // ── 控制按钮 ─────────────────────────────
    _drawControls() {
        const cx = this._motorCX, cy = this._motorCY, Ro = this._statorRo;
        const btnY = cy + Ro + 18;

        const startBtn = new Konva.Rect({ x: cx-35, y: btnY, width: 32, height: 14, fill: '#1a3a1a', stroke: '#2e7d32', strokeWidth: 1, cornerRadius: 2 });
        const startLbl = new Konva.Text({ x: cx-35, y: btnY+3, width: 32, text: '起动', fontSize: 8.5, fill: '#66bb6a', align: 'center' });
        const stopBtn  = new Konva.Rect({ x: cx+3,  y: btnY, width: 32, height: 14, fill: '#3a1a1a', stroke: '#c62828', strokeWidth: 1, cornerRadius: 2 });
        const stopLbl  = new Konva.Text({ x: cx+3,  y: btnY+3, width: 32, text: '停止', fontSize: 8.5, fill: '#ef5350', align: 'center' });

        startBtn.on('click tap', () => this.start());
        startBtn.on('mouseenter', () => startBtn.fill('#2a5a2a'));
        startBtn.on('mouseleave', () => startBtn.fill('#1a3a1a'));
        stopBtn.on('click tap',  () => this.stop());
        stopBtn.on('mouseenter', () => stopBtn.fill('#5a2a2a'));
        stopBtn.on('mouseleave', () => stopBtn.fill('#3a1a1a'));

        this._interactGroup.add(startBtn, startLbl, stopBtn, stopLbl);
        this._startBtnRef = startBtn;
    }

    // ── 转矩计算（完整等效电路）──────────────
    _calcTorque(s) {
        if (Math.abs(s) < 0.001) return 0;
        const U = this.ratedVoltage / Math.sqrt(3);     // 相电压 V
        const omega1 = this.syncOmega;
        const R2s  = this.R2 / s;
        const Ztot = Math.sqrt(Math.pow(this.R1 + R2s, 2) + Math.pow(this.X1 + this.X2, 2));
        const I2   = U / Ztot;
        const T    = this.polePairs * I2 * I2 * this.R2 / (s * omega1);
        return Math.max(0, T);
    }

    // ═══════════════════════════════════════════
    // 集中化 tick（由 consys._tickAll 在 20fps 调用）
    tick(dt) {
        this._tickControl(dt);
        this._tickPhysics(dt);
        this._tickMagFieldViz(dt);
        this._tickRotorViz(dt);
        this._tickCageCurrents(dt);
        this._tickForceArrows();
        this._tickSideView(dt);
        this._tickWorkPoint();
        this._tickWaveform(dt);
        this._tickDisplay();
        this._refreshCache();
    }


    // ── 起停控制逻辑 ─────────────────────────
    _tickControl(dt) {
        switch (this._startPhase) {
            case 0: this._targetLoad = 0; this.slip = 1.0; break;
            case 1:
                this._startTimer += dt;
                if (this._startTimer > 0.5) { this._startPhase = 2; this.running = true; }
                break;
            case 2: break;
            case 3:
                this._targetLoad = 0;
                this.slip = Math.min(1.0, this.slip + dt * 3);
                if (this.slip >= 0.999) { this._startPhase = 0; this.running = false; }
                break;
        }
        if (this._startBtnRef) {
            this._startBtnRef.fill(this._startPhase > 0 ? '#2a5a2a' : '#1a3a1a');
        }
    }

    // ── 电气-机械物理积分 ────────────────────
    _tickPhysics(dt) {
        this._loadSmooth += (this._targetLoad - this._loadSmooth) * Math.min(1, dt*4);
        this.torqueLoad   = this._loadSmooth;

        if (this._startPhase === 0) {
            this.slip = 1.0; this.speed = 0; this.omega = 0; this.torqueEM = 0;
            this.currentA = 0; this.power_in = 0; this.power_out = 0; this.powerFactor = 0;
        } else {
            // 转矩计算
            let voltMult = 1.0;
            if (this.startMethod === 'star_delta' && this.speed < this.ratedSpeed * 0.6) voltMult = 1/Math.sqrt(3);
            if (this.startMethod === 'vfd') voltMult = Math.min(1, this.speed / (this.ratedSpeed * 0.8) + 0.1);

            this.torqueEM = this._calcTorque(this.slip) * voltMult * voltMult;

            // 运动方程积分
            const frictionTq = 0.02 * this.ratedTorque * (1 - this.slip);
            const netTq = this.torqueEM - this.torqueLoad - frictionTq;
            const domegaDt = netTq / this.J;
            this.omega += domegaDt * dt;
            this.omega  = Math.max(0, Math.min(this.syncOmega * 1.01, this.omega));
            this.speed  = Math.round(this.omega * 60 / (2 * Math.PI));
            this.slip   = Math.max(0, (this.syncOmega - this.omega) / this.syncOmega);

            // 电流计算（近似）
            const U_phase = this.ratedVoltage / Math.sqrt(3);
            const R2s     = this.R2 / Math.max(0.001, this.slip);
            const Ztot    = Math.sqrt(Math.pow(this.R1+R2s,2) + Math.pow(this.X1+this.X2,2));
            this.currentA = U_phase / Ztot;

            // 功率
            this.power_out  = this.torqueEM * this.omega * (1 - this.slip);
            this.power_in   = Math.sqrt(3) * this.ratedVoltage * this.currentA * this.ratedCos;
            this.powerFactor= this.running ? Math.min(this.ratedCos, this.slip > 0.3 ? 0.4 : this.ratedCos) : 0;
            this.efficiency = this.power_in > 100 ? Math.min(this.ratedEff, this.power_out/this.power_in*100) : 0;
        }

        // 磁场角度（同步速旋转）
        this._fieldAngle += this.syncOmega * dt;
        // 转子角度（以转子实际速度旋转）
        this._rotorAngle += this.omega * dt;
        this._phase      += dt * 4;
        this._cagePhase  += this.slip > 0.01 ? dt * this.slip * 2 * Math.PI * this.frequency * 2 : dt * 0.5;

        // 转速弧
        if (this._speedArc) {
            const ratio = Math.min(1, this.speed / this.ratedSpeed);
            this._speedArc.angle(ratio * 360);
            this._speedArc.fill(this.slip < 0.02 ? '#66bb6a' : this.slip < 0.1 ? '#ffa726' : '#ef5350');
        }
    }

    // ── 旋转磁场可视化 ───────────────────────
    _tickMagFieldViz(dt) {
        this._magFieldGroup.destroyChildren();
        if (this._startPhase === 0) return;

        const cx = this._motorCX, cy = this._motorCY;
        const Ri = this._statorRi - 6, Rg = this._rotorRo + 2;
        const nLines = 8;
        const slipIntensity = Math.min(1, this.slip * 2 + 0.2);

        for (let i = 0; i < nLines; i++) {
            const a = this._fieldAngle + (i / nLines) * Math.PI * 2;
            // 磁力线（弧形，从定子到气隙）
            const pulse = 0.4 + 0.3 * Math.abs(Math.sin(a * this.polePairs));
            const phaseIdx = i % 3;
            const colors = ['rgba(239,83,80,', 'rgba(102,187,106,', 'rgba(66,165,245,'];
            const fieldColor = colors[phaseIdx] + (pulse * 0.6) + ')';

            this._magFieldGroup.add(new Konva.Line({
                points: [cx + Ri*Math.cos(a), cy + Ri*Math.sin(a), cx + Rg*Math.cos(a), cy + Rg*Math.sin(a)],
                stroke: fieldColor, strokeWidth: 2,
            }));
        }

        // 气隙旋转磁场（合成磁场轴线方向）
        const fieldDir = this._fieldAngle;
        const fieldAmp = 0.3 + 0.5 * Math.min(1, 1 - this.slip + 0.3);
        this._magFieldGroup.add(new Konva.Arrow({
            points: [cx - (Ri-4)*Math.cos(fieldDir), cy - (Ri-4)*Math.sin(fieldDir), cx + (Ri-4)*Math.cos(fieldDir), cy + (Ri-4)*Math.sin(fieldDir)],
            stroke: `rgba(255,213,79,${fieldAmp*0.6})`, fill: `rgba(255,213,79,${fieldAmp*0.6})`,
            strokeWidth: 2.5, pointerLength: 7, pointerWidth: 6,
        }));
    }

    // ── 转子旋转 ─────────────────────────────
    _tickRotorViz(dt) {
        if (this._rotorGroup) this._rotorGroup.rotation(this._rotorAngle * 180 / Math.PI);
        if (this._cageGroup)  this._cageGroup.rotation(this._rotorAngle * 180 / Math.PI);
    }

    // ── 笼条感应电流可视化 ────────────────────
    _tickCageCurrents(dt) {
        this._inducedGroup.destroyChildren();
        if (this._startPhase === 0 || this.slip < 0.005) return;

        const cx = this._motorCX, cy = this._motorCY;
        const barN = this._cageBars?.length || 28;
        const slipCurrent = Math.min(1, this.slip * 5 + 0.1);

        for (let i = 0; i < barN; i++) {
            const a    = (i/barN)*Math.PI*2 + this._rotorAngle;
            const r    = (this._rotorRo - 4 + this._rotorRi + 2) / 2;
            const bx   = cx + r*Math.cos(a);
            const by   = cy + r*Math.sin(a);

            // 感应电流方向（由磁场方向和转子位置决定）
            const relAngle = a - this._fieldAngle;
            const isForward= Math.sin(relAngle * this.polePairs) > 0;
            const intensity= Math.abs(Math.sin(relAngle * this.polePairs)) * slipCurrent;

            if (intensity > 0.12) {
                const dotText = isForward ? '·' : '×';
                const dotCol  = isForward ? '#ffcc80' : '#4fc3f7';
                this._inducedGroup.add(new Konva.Text({ x: bx-4, y: by-5, text: dotText, fontSize: 9, fontStyle: 'bold', fill: dotCol, opacity: intensity }));
            }
        }
    }

    // ── 安培力箭头 ───────────────────────────
    _tickForceArrows() {
        this._forceGroup.destroyChildren();
        if (this._startPhase === 0 || this.torqueEM < 1) return;

        const cx = this._motorCX, cy = this._motorCY;
        const R  = (this._rotorRo + this._rotorRi) / 2;
        const tNorm = Math.min(1, this.torqueEM / this.maxTorque);
        const arrowLen = 8 + tNorm * 12;

        for (let i = 0; i < 3; i++) {
            const a  = this._rotorAngle + i * 2*Math.PI/3;
            const px = cx + R * Math.cos(a);
            const py = cy + R * Math.sin(a);
            // 切向方向（逆时针 = 正转）
            const ta = a + Math.PI/2;
            this._forceGroup.add(new Konva.Arrow({
                points: [px, py, px + arrowLen*Math.cos(ta), py + arrowLen*Math.sin(ta)],
                stroke: '#ffd54f', fill: '#ffd54f', strokeWidth: 2, pointerLength: 5, pointerWidth: 4,
                opacity: 0.65 + 0.35*tNorm,
            }));
        }
    }

    // ── 侧视图风扇旋转 ───────────────────────
    _tickSideView(dt) {
        if (this._fanGroup) this._fanGroup.rotation(this._rotorAngle * 180 / Math.PI * 1.2);
    }

    // ── T-n 曲线工作点更新 ───────────────────
    _tickWorkPoint() {
        const n = this.speed, T = this.torqueEM;
        const { _tsOX: ox, _tsOY: oy, _tsAW: aw, _tsAH: ah, _tsNMax: nMax, _tsTMax: tMax } = this;

        const nx = ox + (n/nMax)*(aw-2);
        const ty = oy - (T/tMax)*(ah-4);

        if (this._workPoint) { this._workPoint.x(nx); this._workPoint.y(Math.max(this._curveY+14, Math.min(oy, ty))); this._workPoint.fill(this.slip > 0.2 ? '#ffa726' : '#66bb6a'); }
        if (this._workHLine) this._workHLine.points([ox, ty, nx, ty]);
        if (this._workVLine) this._workVLine.points([nx, ty, nx, oy]);
    }

    // ── 波形缓冲 ─────────────────────────────
    _tickWaveform(dt) {
        if (!this._wavH4) return;
        this._wavAcc += 1.4*dt*this._wavLen;
        const steps = Math.floor(this._wavAcc); this._wavAcc -= steps;

        const omega_e = 2*Math.PI*this.frequency;
        const I_peak  = this.currentA * Math.sqrt(2);
        const iu = I_peak * Math.sin(omega_e * this._phase / (2*Math.PI*this.frequency) * this.frequency);
        const iv = I_peak * Math.sin(omega_e * this._phase / (2*Math.PI*this.frequency) * this.frequency - 2*Math.PI/3);
        const iw = I_peak * Math.sin(omega_e * this._phase / (2*Math.PI*this.frequency) * this.frequency + 2*Math.PI/3);

        for (let i = 0; i < steps; i++) {
            this._wavIu = new Float32Array([...this._wavIu.slice(1), iu]);
            this._wavIv = new Float32Array([...this._wavIv.slice(1), iv]);
            this._wavIw = new Float32Array([...this._wavIw.slice(1), iw]);
            this._wavN  = new Float32Array([...this._wavN.slice(1),  this.speed]);
        }

        const wx = this._wavX+3, ww = this._wavW-6;
        const n  = this._wavLen, dx = ww/n, h4 = this._wavH4;
        const [mU, mV, mW, mN] = this._wavMids;
        const iMax   = Math.max(1, I_peak * 1.1);
        const aI = h4*0.42, aN = h4*0.40;

        const uPts=[], vPts=[], wPts=[], nPts=[];
        for (let i = 0; i < n; i++) {
            const x = wx + i*dx;
            uPts.push(x, mU-(this._wavIu[i]/iMax)*aI);
            vPts.push(x, mV-(this._wavIv[i]/iMax)*aI);
            wPts.push(x, mW-(this._wavIw[i]/iMax)*aI);
            nPts.push(x, mN-((this._wavN[i]/this.syncSpeed)*2-1)*aN);
        }
        if (this._wLineIu) this._wLineIu.points(uPts);
        if (this._wLineIv) this._wLineIv.points(vPts);
        if (this._wLineIw) this._wLineIw.points(wPts);
        if (this._wLineN)  this._wLineN.points(nPts);
        if (this._wIuLbl)  this._wIuLbl.text(`${this.currentA.toFixed(1)}A`);
        if (this._wNLbl)   this._wNLbl.text(`${this.speed}rpm`);

        // 定子绕组颜色（随电流闪烁）
        if (this._phaseGroups) {
            const iNorm = Math.min(1, this.currentA / (this.ratedPower*1000/this.ratedVoltage/Math.sqrt(3)/this.ratedCos));
            this._phaseGroups.forEach((pg, i) => {
                const currPhase = i === 0 ? iu : i === 1 ? iv : iw;
                const intensity = Math.abs(currPhase / Math.max(1, iMax));
                pg.grp.opacity(0.5 + intensity * 0.5);
            });
        }
    }

    // ── 显示刷新 ─────────────────────────────
    _tickDisplay() {
        const n = this.speed;
        const mc = this.slip < 0.02 ? '#66bb6a' : this.slip < 0.1 ? '#ffa726' : '#ef5350';

        if (this._lcdBg)     this._lcdBg.fill('#020c14');
        if (this._lcdMain)   { this._lcdMain.text(n.toString()); this._lcdMain.fill(mc); }
        if (this._lcdSlip)   this._lcdSlip.text(`s=${this.slip.toFixed(4)}`);
        if (this._lcdTorque) this._lcdTorque.text(`T=${this.torqueEM.toFixed(1)}N·m`);
        if (this._lcdPF)     this._lcdPF.text(`cosφ=${this.powerFactor.toFixed(3)}`);

        // 负载条
        if (this._loadBar) {
            const ratio = Math.min(1, this.torqueLoad / (this.ratedTorque*1.2+0.01));
            const bH = this._loadBar._barH * ratio;
            this._loadBar.y(this._loadBar._barY + this._loadBar._barH - bH);
            this._loadBar.height(bH);
            this._loadBar.fill(ratio > 0.9 ? '#ef5350' : ratio > 0.7 ? '#ffa726' : '#66bb6a');
        }
        if (this._loadValText) this._loadValText.text(`${this.torqueLoad.toFixed(1)} N·m`);
        if (this._loadPctText) this._loadPctText.text(`${(this.torqueLoad/this.ratedTorque*100).toFixed(0)}% 额定`);
    }

    // ═══════════════════════════════════════════
    start() {
        if (this._startPhase === 0) { this._startPhase = 1; this._startTimer = 0; this.running = false; }
    }

    stop() {
        if (this._startPhase > 0) { this._startPhase = 3; }
    }

    setLoad(torque) {
        this._targetLoad = Math.max(0, Math.min(this.ratedTorque*1.2, torque));
        this._refreshCache();
    }

    update(loadTorque) {
        if (typeof loadTorque === 'number') this.setLoad(loadTorque);
        this._refreshCache();
    }

    getConfigFields() {
        return [
            { label: '位号/名称',              key: 'id',           type: 'text'   },
            { label: '额定功率 (kW)',           key: 'ratedPower',   type: 'number' },
            { label: '额定电压 (V)',            key: 'ratedVoltage', type: 'number' },
            { label: '额定转速 (rpm)',          key: 'ratedSpeed',   type: 'number' },
            { label: '极对数 p',               key: 'polePairs',    type: 'number' },
            { label: '电源频率 (Hz)',           key: 'frequency',    type: 'number' },
            { label: '额定功率因数',            key: 'ratedCos',     type: 'number' },
            { label: '额定效率 (%)',            key: 'ratedEff',     type: 'number' },
            { label: '转动惯量 J (kg·m²)',      key: 'J',            type: 'number' },
        ];
    }

    onConfigUpdate(cfg) {
        this.id          = cfg.id          || this.id;
        this.ratedPower  = parseFloat(cfg.ratedPower)   || this.ratedPower;
        this.ratedVoltage= parseFloat(cfg.ratedVoltage) || this.ratedVoltage;
        this.ratedSpeed  = parseFloat(cfg.ratedSpeed)   || this.ratedSpeed;
        this.polePairs   = parseInt(cfg.polePairs)       || this.polePairs;
        this.frequency   = parseFloat(cfg.frequency)    || this.frequency;
        this.ratedCos    = parseFloat(cfg.ratedCos)     || this.ratedCos;
        this.ratedEff    = parseFloat(cfg.ratedEff)     || this.ratedEff;
        this.J           = parseFloat(cfg.J)            || this.J;
        this.syncSpeed   = 60 * this.frequency / this.polePairs;
        this.syncOmega   = this.syncSpeed * 2 * Math.PI / 60;
        this.ratedSlip   = (this.syncSpeed - this.ratedSpeed) / this.syncSpeed;
        this.ratedTorque = (this.ratedPower * 1000) / (this.ratedSpeed * 2 * Math.PI / 60);
        this.maxTorque   = this.ratedTorque * 2.5;
        this.config      = { ...this.config, ...cfg };
        if (this._idText) this._idText.text?.(this.id);
        this._refreshCache();
    }

    destroy() {
        super.destroy?.();
    }
}