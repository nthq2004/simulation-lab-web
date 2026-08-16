import { BaseComponent } from './BaseComponent.js';

/**
 * 绕线式三相异步电动机仿真组件
 * （Wound Rotor / Slip Ring Induction Motor）
 *
 * ── 与鼠笼式的核心区别 ───────────────────────────────────────
 *
 *  鼠笼式：转子为铝/铜导条（短路），无法外接电阻
 *  绕线式：转子为三相绕组，通过集电环引出 → 外接可调电阻
 *
 *  外接转子电阻的作用：
 *    1. 增大起动转矩（起动时接大电阻，转差率增大，起动转矩提升）
 *    2. 调节转速（改变转子电阻，工作点沿负载线移动）
 *    3. 限制起动电流（降低起动电流冲击）
 *
 * ── 工作原理 ──────────────────────────────────────────────────
 *
 *  1. 定子旋转磁场（同鼠笼式）：
 *     n₁ = 60f / p   (rpm)
 *
 *  2. 转子三相绕组（线绕，Y或△）：
 *     通过集电环（Slip Rings）将转子绕组引出
 *     接外部可调电阻 R_ext（每相）
 *
 *  3. 等效电路（外接电阻后）：
 *     转子总电阻 R₂_total = R₂ + R_ext
 *     电磁转矩：
 *       T = K × U₁² × (R₂ + R_ext) / s
 *              / [(R₁ + (R₂+R_ext)/s)² + (X₁+X₂)²]
 *
 *  4. 最大转矩不变定理：
 *     T_max = K × U₁² / [2(R₁ + √(R₁² + (X₁+X₂)²))]
 *     → T_max 与 R_ext 无关！
 *     → 但临界转差率随 R_ext 增大而增大：
 *       s_m = (R₂ + R_ext) / √(R₁² + (X₁+X₂)²)
 *
 *  5. 转速调节原理：
 *     R_ext↑ → s_m↑ → 特性曲线向右平移 → 相同负载下转速降低
 *     R_ext = 0：硬特性（n ≈ n₁）
 *     R_ext > 0：软特性（n 随负载变化大）
 *
 *  6. 特殊工况：
 *     当 R_ext = R₂ × (1-s)/s 时：转差率功率在外电阻上消耗，
 *     可用于能量回馈（串级调速，变频器回收）
 *
 * ── 集电环系统 ───────────────────────────────────────────────
 *  三个集电环（铜环）固定在转轴上随转子旋转
 *  三个电刷（碳刷）固定在端盖上，压在集电环上
 *  转子三相引出线（R/S/T）→ 集电环 → 电刷 → 外接电阻
 *  集电环特有的火花动画（正常工作时微弱，过载时明显）
 *
 * ── 组件结构 ──────────────────────────────────────────────────
 *  ① 电机截面图（定子/转子绕组/气隙旋转磁场）
 *  ② 集电环侧视图（三道铜环 + 三组碳刷 + 火花动画）
 *  ③ 外接电阻调节器（三相可调滑线变阻器，联动调节）
 *  ④ 可调 T-n 特性曲线（R_ext 变化时曲线族实时更新）
 *  ⑤ 转速-转矩工作点实时追踪
 *  ⑥ 三相转子电流波形 + 转速趋势
 *  ⑦ 仪表 LCD（转速、转差率、转矩、转子电流、效率）
 *  ⑧ 起停控制 + 短接转子电阻按钮（一键短接，满速运行）
 *
 * ── 端口 ─────────────────────────────────────────────────────
 *  wire_u   — 定子 U 相
 *  wire_v   — 定子 V 相
 *  wire_w   — 定子 W 相
 *  wire_r   — 转子 R 相（集电环）
 *  wire_s   — 转子 S 相（集电环）
 *  wire_t   — 转子 T 相（集电环）
 *  wire_pe  — 保护接地
 *  pipe_shaft — 输出轴
 */
export class WoundRotorInductionMotor extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.width  = Math.max(560, config.width  || 660);
        this.height = Math.max(380, config.height || 460);

        this.type    = 'wound_rotor_im';
        this.special = 'none';
        this.cache   = 'fixed';

        // ── 额定铭牌参数 ──
        this.ratedPower   = config.ratedPower   || 15;      // kW
        this.ratedVoltage = config.ratedVoltage || 380;     // V（线电压）
        this.ratedSpeed   = config.ratedSpeed   || 960;     // rpm（6极，s≈0.04）
        this.frequency    = config.frequency    || 50;      // Hz
        this.polePairs    = config.polePairs    || 3;       // 极对数（6极）
        this.ratedCos     = config.ratedCos     || 0.85;    // 额定功率因数
        this.ratedEff     = config.ratedEff     || 90.5;    // 额定效率 %
        this.rotorVoltage = config.rotorVoltage || 220;     // 转子开路线电压 V

        // ── 等效电路参数 ──
        this.R1   = config.R1   || 0.025;   // 定子电阻（标幺）
        this.X1   = config.X1   || 0.090;   // 定子漏抗（标幺）
        this.R2   = config.R2   || 0.020;   // 转子折算电阻（标幺）
        this.X2   = config.X2   || 0.075;   // 转子折算漏抗（标幺）
        this.Xm   = config.Xm   || 3.0;     // 励磁感抗（标幺）

        // 外接转子电阻（每相，Ω，折算到定子侧的标幺值）
        this.Rext          = config.Rext     || 0;       // 当前外接电阻（标幺）
        this._manualRext   = config.Rext     || 0;
        this.RextMax       = config.RextMax  || 1.0;     // 最大外接电阻（标幺，≈0.5~2）
        this._RextTarget   = config.Rext     || 0;

        // ── 同步转速 ──
        this.syncSpeed = 60 * this.frequency / this.polePairs;    // rpm
        this.syncOmega = this.syncSpeed * 2 * Math.PI / 60;

        // ── 额定工况 ──
        this.ratedSlip   = (this.syncSpeed - this.ratedSpeed) / this.syncSpeed;
        this.ratedTorque = (this.ratedPower * 1000) / (this.ratedSpeed * 2 * Math.PI / 60);
        this.maxTorque   = this.ratedTorque * 2.8;   // 最大转矩（绕线式一般较大）

        // ── 动态状态 ──
        this.running      = false;
        this._startPhase  = 0;
        this._startTimer  = 0;

        this.slip         = 1.0;
        this.speed        = 0;
        this.omega        = 0;
        this.torqueEM     = 0;
        this.torqueLoad   = config.initLoad || 5;
        this._targetLoad  = config.initLoad || 5;
        this.currentA     = 0;     // 定子电流 A
        this.rotorCurrentA= 0;     // 转子电流 A
        this.rotorEMF     = 0;     // 转子感应 EMF V（转差电压）
        this.powerFactor  = 0;
        this.efficiency   = 0;
        this.J            = config.J || 0.8;

        this._loadSmooth  = 0;
        this._RextSmooth  = 0;     // 外接电阻平滑值

        // ── 集电环状态 ──
        this._brushSparkPhase = 0;
        this._ringAngle       = 0;
        this._sparkIntensity  = 0;

        // ── 动画 ──
        this._fieldAngle  = 0;
        this._rotorAngle  = 0;
        this._phase       = 0;
        this._wavePhase   = 0;
        this._flowPhase   = 0;

        // ── 波形缓冲（五路）──
        this._wavLen   = 260;
        this._wavIu    = new Float32Array(this._wavLen).fill(0);
        this._wavIv    = new Float32Array(this._wavLen).fill(0);
        this._wavIw    = new Float32Array(this._wavLen).fill(0);
        this._wavN     = new Float32Array(this._wavLen).fill(0);
        this._wavRext  = new Float32Array(this._wavLen).fill(0);
        this._wavAcc   = 0;

        // ── 几何布局 ──
        // 电机截面（左部）
        this._motorCX  = Math.round(this.width * 0.20);
        this._motorCY  = Math.round(this.height * 0.40);
        this._statorRo = Math.round(Math.min(this.width * 0.16, this.height * 0.32));
        this._statorRi = Math.round(this._statorRo * 0.74);
        this._rotorRo  = this._statorRi - Math.round(this._statorRo * 0.05);
        this._rotorRi  = Math.round(this._rotorRo * 0.36);

        // 集电环侧视（截面图右方）
        this._slipRingX = this._motorCX + this._statorRo + 22;
        this._slipRingY = Math.round(this.height * 0.10);
        this._slipRingW = Math.round(this.width * 0.14);
        this._slipRingH = Math.round(this.height * 0.54);

        // 外接电阻调节器（集电环右方）
        this._rextX    = this._slipRingX + this._slipRingW + 14;
        this._rextY    = this._slipRingY;
        this._rextW    = Math.round(this.width * 0.16);
        this._rextH    = Math.round(this.height * 0.54);

        // T-n 特性曲线（右部上方）
        this._curveX   = this._rextX + this._rextW + 14;
        this._curveY   = this._slipRingY;
        this._curveW   = this.width - this._curveX - 8;
        this._curveH   = Math.round(this.height * 0.46);

        // LCD（右部中间）
        this._lcdX     = this._curveX;
        this._lcdY     = this._curveY + this._curveH + 8;
        this._lcdW     = this._curveW;
        this._lcdH     = Math.round(this.height * 0.24);

        // 波形区（底部）
        this._wavX     = 6;
        this._wavY     = Math.max(this._motorCY + this._statorRo + 14, this._lcdY + this._lcdH + 8);
        this._wavW     = this.width - 12;
        this._wavH     = this.height - this._wavY - 6;

        this.knobs     = {};

        this.config = {
            id: this.id, ratedPower: this.ratedPower,
            ratedVoltage: this.ratedVoltage, ratedSpeed: this.ratedSpeed,
            polePairs: this.polePairs, rotorVoltage: this.rotorVoltage,
        };

        this._init();

        const cy = this._motorCY;
        this.addPort(0,            cy - 36, 'u',     'wire', 'U');
        this.addPort(0,            cy - 12, 'v',     'wire', 'V');
        this.addPort(0,            cy + 12, 'w',     'wire', 'W');
        this.addPort(0,            cy + 36, 'pe',    'wire', 'PE');
        this.addPort(this._slipRingX + this._slipRingW + 2, this._slipRingY + this._slipRingH * 0.30, 'r', 'wire', 'R');
        this.addPort(this._slipRingX + this._slipRingW + 2, this._slipRingY + this._slipRingH * 0.50, 's', 'wire', 'S');
        this.addPort(this._slipRingX + this._slipRingW + 2, this._slipRingY + this._slipRingH * 0.70, 't', 'wire', 'T');
        this.addPort(this._motorCX + this._statorRo + 8, cy, 'shaft', 'pipe', '输出轴');
    }

    // ═══════════════════════════════════════════
    _init() {
        this._drawLabel();
        this._drawStatorIron();
        this._drawStatorWindings();
        this._drawRotorCore();
        this._drawWoundRotor();
        this._drawShaft();
        this._drawMagFieldLayer();
        this._drawForceLayer();
        this._drawCurrentFlowLayer();
        this._drawSlipRingAssembly();
        this._drawExternalResistor();
        this._drawTorqueSpeedCurves();
        this._drawLCDPanel();
        this._drawWaveform();
        this._drawControls();
        
    }

    _drawLabel() {
        this.group.add(new Konva.Text({
            x: 0, y: -22, width: this.width,
            text: `绕线式三相异步电动机  ${this.ratedPower}kW  ${this.ratedVoltage}V  ${this.ratedSpeed}rpm  ${this.polePairs*2}极  转子${this.rotorVoltage}V`,
            fontSize: 11.5, fontStyle: 'bold', fill: '#1a2634', align: 'center',
        }));
    }

    // ── 定子铁芯 ─────────────────────────────
    _drawStatorIron() {
        const cx = this._motorCX, cy = this._motorCY;
        const Ro = this._statorRo, Ri = this._statorRi;

        this.group.add(new Konva.Circle({ x: cx, y: cy, radius: Ro+10, fill: '#455a64', stroke: '#263238', strokeWidth: 2.5 }));
        for (let i = 0; i < 4; i++) {
            const a = (i/4)*Math.PI*2 + Math.PI/4;
            this.group.add(new Konva.Circle({ x: cx+(Ro+8)*Math.cos(a), y: cy+(Ro+8)*Math.sin(a), radius: 5.5, fill: '#37474f', stroke: '#1a2634', strokeWidth: 0.5 }));
        }
        this.group.add(new Konva.Ring({ x: cx, y: cy, innerRadius: Ri-2, outerRadius: Ro, fill: '#546e7a', stroke: '#37474f', strokeWidth: 0.5 }));
        // 叠片纹
        for (let i = 0; i < 24; i++) {
            const a = (i/24)*Math.PI*2;
            this.group.add(new Konva.Line({ points: [cx+Ri*Math.cos(a), cy+Ri*Math.sin(a), cx+Ro*Math.cos(a), cy+Ro*Math.sin(a)], stroke: 'rgba(0,0,0,0.14)', strokeWidth: 0.7 }));
        }
        // 定子槽（36槽）
        const slotN = 36, slotW = 3.5, slotD = (Ro-Ri-2)*0.52;
        for (let i = 0; i < slotN; i++) {
            const a = (i/slotN)*Math.PI*2 - Math.PI/2;
            const g = new Konva.Group({ x: cx+(Ri+2)*Math.cos(a), y: cy+(Ri+2)*Math.sin(a), rotation: a*180/Math.PI+90 });
            g.add(new Konva.Rect({ x: -slotW/2, y: 0, width: slotW, height: slotD, fill: '#0d1a28' }));
            this.group.add(g);
        }
        this.group.add(new Konva.Arc({ x: cx, y: cy, innerRadius: Ri-1, outerRadius: Ri+1, angle: 60, rotation: -140, fill: 'rgba(255,255,255,0.08)' }));
        this._airGapRing = new Konva.Ring({ x: cx, y: cy, innerRadius: this._rotorRo+1, outerRadius: Ri-4, fill: 'rgba(100,200,255,0.03)' });
        this.group.add(this._airGapRing);
        this.group.add(new Konva.Text({ x: cx-this._statorRo, y: cy-this._statorRo-22, width: this._statorRo*2, text: '绕线式三相异步电动机（截面图）', fontSize: 9, fontStyle: 'bold', fill: '#546e7a', align: 'center' }));
    }

    // ── 定子三相绕组 ─────────────────────────
    _drawStatorWindings() {
        const cx = this._motorCX, cy = this._motorCY;
        const Ri = this._statorRi, Ro = this._statorRo;
        const phases = [
            { name: 'U', color: '#ef5350', angles: [0, Math.PI] },
            { name: 'V', color: '#66bb6a', angles: [2*Math.PI/3, 2*Math.PI/3+Math.PI] },
            { name: 'W', color: '#42a5f5', angles: [4*Math.PI/3, 4*Math.PI/3+Math.PI] },
        ];
        this._statorPhaseGroups = [];
        phases.forEach(ph => {
            const grp = new Konva.Group();
            ph.angles.forEach((a, side) => {
                const r = (Ri+Ro-4)/2;
                const bw = (Ro-Ri-8)*0.55, bh = 10;
                const g2 = new Konva.Group({ x: cx+r*Math.cos(a-Math.PI/2), y: cy+r*Math.sin(a-Math.PI/2), rotation: (a-Math.PI/2)*180/Math.PI+90 });
                g2.add(new Konva.Rect({ x: -bw/2, y: -bh/2, width: bw, height: bh, fill: ph.color, cornerRadius: 2, opacity: 0.75 }));
                g2.add(new Konva.Text({ x: -5, y: -6, text: side===0?'·':'×', fontSize: 11, fill: '#ffffff', fontStyle: 'bold' }));
                grp.add(g2);
            });
            this._statorPhaseGroups.push({ grp, color: ph.color });
            this.group.add(grp);
            // 相序标注
            const a0 = phases.indexOf(ph) * 2*Math.PI/3 - Math.PI/2;
            this.group.add(new Konva.Text({ x: cx+(Ro+18)*Math.cos(a0)-8, y: cy+(Ro+18)*Math.sin(a0)-6, text: ph.name, fontSize: 10, fontStyle: 'bold', fill: ph.color }));
        });
    }

    // ── 转子铁芯 ─────────────────────────────
    _drawRotorCore() {
        const cx = this._motorCX, cy = this._motorCY;
        this._rotorGroup = new Konva.Group({ x: cx, y: cy });
        this._rotorGroup.add(new Konva.Ring({ innerRadius: this._rotorRi, outerRadius: this._rotorRo-2, fill: '#607d8b', stroke: '#37474f', strokeWidth: 0.8 }));
        for (let i = 0; i < 18; i++) {
            const a = (i/18)*Math.PI*2;
            this._rotorGroup.add(new Konva.Line({ points: [this._rotorRi*Math.cos(a), this._rotorRi*Math.sin(a), (this._rotorRo-3)*Math.cos(a), (this._rotorRo-3)*Math.sin(a)], stroke: 'rgba(0,0,0,0.12)', strokeWidth: 0.6 }));
        }
        this._rotorGroup.add(new Konva.Circle({ radius: this._rotorRi, fill: '#37474f', stroke: '#263238', strokeWidth: 1.5 }));
        this._rotorGroup.add(new Konva.Circle({ x: -this._rotorRi*0.22, y: -this._rotorRi*0.22, radius: this._rotorRi*0.18, fill: 'rgba(255,255,255,0.12)' }));
        this._rotorGroup.add(new Konva.Rect({ x: -this._rotorRi*0.11, y: -this._rotorRi, width: this._rotorRi*0.22, height: this._rotorRi*0.16, fill: '#263238' }));
        this.group.add(this._rotorGroup);
    }

    // ── 绕线转子绕组（三相，彩色漆包线）──────
    _drawWoundRotor() {
        const cx = this._motorCX, cy = this._motorCY;
        const Ro = this._rotorRo, Ri = this._rotorRi;

        this._rotorCoilGroup = new Konva.Group({ x: cx, y: cy });
        const rotorSlotN = 24;
        const slotD = (Ro - Ri - 6) * 0.55;
        const rotorPhaseColors = ['#ef9a9a', '#a5d6a7', '#90caf9'];

        this._rotorCoils = [];
        for (let i = 0; i < rotorSlotN; i++) {
            const a    = (i / rotorSlotN) * Math.PI * 2 - Math.PI/2;
            const r    = (Ro - 3 + Ri + 3) / 2;
            const phIdx= i % 3;
            const col  = rotorPhaseColors[phIdx];
            const g    = new Konva.Group({ x: r*Math.cos(a), y: r*Math.sin(a), rotation: a*180/Math.PI });
            const slot = new Konva.Rect({ x: -3, y: -slotD/2, width: 6, height: slotD, fill: col, stroke: 'none', cornerRadius: 1.5, opacity: 0.85 });
            const dir  = new Konva.Text({ x: -4, y: -5, text: i%6 < 3 ? '·' : '×', fontSize: 9, fill: '#263238', fontStyle: 'bold' });
            g.add(slot, dir);
            this._rotorCoils.push({ g, color: col, phIdx, angle: a });
            this._rotorCoilGroup.add(g);
        }

        // 转子绕组引线（到轴端，连集电环）
        for (let p = 0; p < 3; p++) {
            const a = (p/3)*Math.PI*2 + Math.PI/6;
            this._rotorCoilGroup.add(new Konva.Line({ points: [Ri*0.6*Math.cos(a), Ri*0.6*Math.sin(a), Ri*0.95*Math.cos(a), Ri*0.95*Math.sin(a)], stroke: rotorPhaseColors[p], strokeWidth: 1.5, opacity: 0.6 }));
        }

        // 轴端引线标注
        this.group.add(new Konva.Text({ x: cx-this._rotorRo+2, y: cy+this._rotorRo+6, text: '转子绕组 R/S/T', fontSize: 8.5, fontStyle: 'bold', fill: '#90caf9' }));
        this.group.add(this._rotorCoilGroup);
    }

    // ── 输出轴 ────────────────────────────────
    _drawShaft() {
        const cx = this._motorCX, cy = this._motorCY, Ro = this._statorRo;
        this.group.add(new Konva.Ellipse({ x: cx+Ro+6, y: cy, radiusX: 8, radiusY: this._statorRi*0.44, fill: '#607d8b', stroke: '#37474f', strokeWidth: 1.5 }));
        this.group.add(new Konva.Rect({ x: cx+Ro+8, y: cy-5, width: 22, height: 10, fill: '#78909c', stroke: '#546e7a', strokeWidth: 1 }));
        this.group.add(new Konva.Ellipse({ x: cx-Ro-6, y: cy, radiusX: 8, radiusY: this._statorRi*0.44, fill: '#607d8b', stroke: '#37474f', strokeWidth: 1.5 }));
    }

    // ── 动态图层 ─────────────────────────────
    _drawMagFieldLayer()    { this._magFieldGroup = new Konva.Group(); this.group.add(this._magFieldGroup); }
    _drawForceLayer()       { this._forceGroup    = new Konva.Group(); this.group.add(this._forceGroup); }
    _drawCurrentFlowLayer() { this._flowGroup     = new Konva.Group(); this.group.add(this._flowGroup); }

    // ── 集电环装置（侧视图）──────────────────
    _drawSlipRingAssembly() {
        const sx = this._slipRingX, sy = this._slipRingY;
        const sw = this._slipRingW, sh = this._slipRingH;
        const cx2 = sx + sw/2, cy2 = sy + sh/2;

        // 背景框
        const bg = new Konva.Rect({ x: sx, y: sy, width: sw, height: sh, fill: '#1e2a36', stroke: '#0d1520', strokeWidth: 1.5, cornerRadius: 4 });
        const titleBg = new Konva.Rect({ x: sx, y: sy, width: sw, height: 14, fill: '#0a1a28', cornerRadius: [4,4,0,0] });
        this.group.add(new Konva.Text({ x: sx+2, y: sy+2, width: sw-4, text: '集电环装置', fontSize: 8.5, fontStyle: 'bold', fill: '#80cbc4', align: 'center' }));

        // 转轴（中心横线）
        this.group.add(new Konva.Rect({ x: sx+4, y: cy2-4, width: sw-8, height: 8, fill: '#78909c', stroke: '#546e7a', strokeWidth: 1, cornerRadius: 2 }));

        // 三道集电环（铜环，随轴旋转）
        const ringColors = ['#ef9a9a','#a5d6a7','#90caf9'];
        const ringLabels = ['R','S','T'];
        const ringPositions = [sh*0.26, sh*0.48, sh*0.70];
        this._slipRings = [];
        this._brushGroups = [];

        ringPositions.forEach((ry, i) => {
            const ringY = sy + ry;
            // 集电环组（旋转）
            const ringGroup = new Konva.Group({ x: cx2, y: ringY });
            ringGroup.add(new Konva.Ellipse({ radiusX: sw*0.38, radiusY: 9, fill: '#b87333', stroke: '#8a5010', strokeWidth: 1.5 }));
            // 铜环高光
            ringGroup.add(new Konva.Ellipse({ x: -sw*0.10, y: -3, radiusX: sw*0.12, radiusY: 3, fill: 'rgba(255,220,150,0.35)' }));
            this._slipRings.push(ringGroup);
            this.group.add(ringGroup);

            // 碳刷（固定）
            const brushCol = ringColors[i];
            // 左侧碳刷
            const brushLeft = new Konva.Group({ x: sx+6, y: ringY });
            brushLeft.add(new Konva.Rect({ x: 0, y: -5, width: sw*0.22, height: 10, fill: '#455a64', stroke: '#37474f', strokeWidth: 1, cornerRadius: 2 }));
            brushLeft.add(new Konva.Rect({ x: sw*0.18, y: -3, width: 4, height: 6, fill: '#263238' }));
            // 电刷弹簧（小弹簧符号）
            brushLeft.add(new Konva.Line({ points: [-8,0,-2,0], stroke: brushCol, strokeWidth: 1.5 }));
            for (let k = 0; k < 3; k++) brushLeft.add(new Konva.Line({ points: [-8+k*3,0,-7+k*3,-3,-6+k*3,0], stroke: '#546e7a', strokeWidth: 1 }));

            // 右侧碳刷
            const brushRight = new Konva.Group({ x: sx+sw-6-sw*0.22, y: ringY });
            brushRight.add(new Konva.Rect({ x: 0, y: -5, width: sw*0.22, height: 10, fill: '#455a64', stroke: '#37474f', strokeWidth: 1, cornerRadius: 2 }));
            brushRight.add(new Konva.Rect({ x: -4, y: -3, width: 4, height: 6, fill: '#263238' }));
            brushRight.add(new Konva.Line({ points: [sw*0.22+8,0,sw*0.22+2,0], stroke: brushCol, strokeWidth: 1.5 }));
            for (let k = 0; k < 3; k++) brushRight.add(new Konva.Line({ points: [sw*0.22+2+k*3,0,sw*0.22+3+k*3,-3,sw*0.22+4+k*3,0], stroke: '#546e7a', strokeWidth: 1 }));

            // 引线到外接电阻
            this.group.add(new Konva.Line({ points: [sx+sw-2, ringY, sx+sw+2, ringY], stroke: brushCol, strokeWidth: 2 }));

            // 火花动画点（动态）
            const sparkDot = new Konva.Circle({ x: cx2 + sw*0.36, y: ringY, radius: 0, fill: brushCol });
            const sparkDot2= new Konva.Circle({ x: cx2 - sw*0.36, y: ringY, radius: 0, fill: brushCol });
            this._brushGroups.push({ sparks: [sparkDot, sparkDot2], color: brushCol, ringY });

            // 标注
            this.group.add(new Konva.Text({ x: sx+4, y: ringY-12, text: ringLabels[i], fontSize: 9, fontStyle: 'bold', fill: brushCol }));
            this.group.add(brushLeft, brushRight, sparkDot, sparkDot2);
        });

        // 箭头（旋转方向）
        this._srRotArrow = new Konva.Arc({ x: cx2, y: cy2, innerRadius: sw*0.32, outerRadius: sw*0.35, angle: 200, rotation: -100, fill: 'rgba(144,202,249,0.3)' });
        this.group.add(bg, titleBg, this._srRotArrow);
    }

    // ── 外接转子电阻调节器 ────────────────────
    _drawExternalResistor() {
        const rx = this._rextX, ry = this._rextY, rw = this._rextW, rh = this._rextH;

        const bg = new Konva.Rect({ x: rx, y: ry, width: rw, height: rh, fill: '#020c14', stroke: '#1a3040', strokeWidth: 1.5, cornerRadius: 4 });
        const titleBg = new Konva.Rect({ x: rx, y: ry, width: rw, height: 14, fill: '#0a1a28', cornerRadius: [4,4,0,0] });
        this.group.add(new Konva.Text({ x: rx+2, y: ry+2, width: rw-4, text: '外接转子电阻调节', fontSize: 8.5, fontStyle: 'bold', fill: '#ffa726', align: 'center' }));

        // 三相串联可调电阻（滑线变阻器图示）
        const phColors = ['#ef9a9a','#a5d6a7','#90caf9'];
        const phNames  = ['R相','S相','T相'];
        const rhW = rw - 24;
        const rhSpacing = (rh - 40) / 3;

        this._rextBars = [];
        this._rextSliders = [];
        this._rextValTxts = [];

        phColors.forEach((col, i) => {
            const rhY = ry + 20 + i * rhSpacing + 6;
            // 电阻体（横条）
            this.group.add(new Konva.Text({ x: rx+8, y: rhY-1, text: phNames[i], fontSize: 7.5, fill: col }));
            const rBar = new Konva.Rect({ x: rx+8, y: rhY+10, width: rhW, height: 8, fill: '#0d2030', cornerRadius: 2 });
            const rFill= new Konva.Rect({ x: rx+8, y: rhY+10, width: 0, height: 8, fill: col, cornerRadius: 2 });
            // 滑动触头
            const slider = new Konva.Rect({ x: rx+8, y: rhY+7, width: 8, height: 14, fill: '#ffd54f', stroke: '#c0a020', strokeWidth: 1, cornerRadius: 1 });
            // 电阻值文字
            const valTxt = new Konva.Text({ x: rx+rw-34, y: rhY+9, width: 30, text: '0.00Ω', fontSize: 7.5, fontFamily: 'Courier New, monospace', fill: col, align: 'right' });

            this._rextBars.push({ rBar, rFill, rhW });
            this._rextSliders.push(slider);
            this._rextValTxts.push(valTxt);
            this.group.add(rBar, rFill, slider, valTxt);
        });

        // 竖向滑块（联动三相）
        const sliderPanelY = ry + rh - 58;
        this.group.add(new Konva.Rect({ x: rx+6, y: sliderPanelY, width: rw-12, height: 14, fill: '#0d2030', cornerRadius: 2 }));
        this._rextMainBar = new Konva.Rect({ x: rx+6, y: sliderPanelY, width: 0, height: 14, fill: '#ffa726', cornerRadius: 2 });
        this._rextMainSlider = new Konva.Rect({ x: rx+6, y: sliderPanelY-2, width: 10, height: 18, fill: '#ffd54f', stroke: '#c0a020', strokeWidth: 1.5, cornerRadius: 2, listening: true });
        this._rextLbl = new Konva.Text({ x: rx+4, y: ry+rh-40, width: rw-8, text: 'R_ext = 0.00 (标幺)', fontSize: 8, fontFamily: 'Courier New, monospace', fill: '#ffa726', align: 'center' });
        this._sMArcLbl = new Konva.Text({ x: rx+4, y: ry+rh-28, width: rw-8, text: 's_m = 0.000', fontSize: 8, fontFamily: 'Courier New, monospace', fill: '#80cbc4', align: 'center' });
        this._rextStatus = new Konva.Text({ x: rx+4, y: ry+rh-16, width: rw-8, text: '● 转子短路', fontSize: 8.5, fontStyle: 'bold', fill: '#66bb6a', align: 'center' });

        // 联动拖拽
        const panW = rw-12;
        const handleSlide = (e) => {
            const stage = this.group.getStage?.();
            const pos   = stage?.getPointerPosition?.() ?? { x: e.clientX ?? 0 };
            const relX  = pos.x - (this.group.x?.() ?? 0) - rx - 6;
            this._RextTarget = Math.max(0, Math.min(this.RextMax, relX/panW * this.RextMax));
        };
        const mmUp = () => { window.removeEventListener('mousemove', handleSlide); window.removeEventListener('touchmove', handleSlide); window.removeEventListener('mouseup', mmUp); window.removeEventListener('touchend', mmUp); };
        const mmDown = new Konva.Rect({ x: rx+6-4, y: sliderPanelY-4, width: panW+8, height: 22, fill: 'transparent', listening: true });
        mmDown.on('mousedown touchstart', () => {
            window.addEventListener('mousemove', handleSlide);
            window.addEventListener('touchmove', handleSlide, {passive:true});
            window.addEventListener('mouseup', mmUp);
            window.addEventListener('touchend', mmUp);
        });
        mmDown.on('click tap', (e) => handleSlide(e));

        // 短接按钮
        const shortBtn = new Konva.Rect({ x: rx+6, y: sliderPanelY-20, width: (rw-16)/2, height: 14, fill: '#1a3a1a', stroke: '#2e7d32', strokeWidth: 1, cornerRadius: 2 });
        const shortLbl = new Konva.Text({ x: rx+6, y: sliderPanelY-17, width: (rw-16)/2, text: '短接转子', fontSize: 8, fill: '#66bb6a', align: 'center' });
        const maxBtn   = new Konva.Rect({ x: rx+6+(rw-16)/2+4, y: sliderPanelY-20, width: (rw-16)/2, height: 14, fill: '#3a1a0a', stroke: '#e65100', strokeWidth: 1, cornerRadius: 2 });
        const maxLbl   = new Konva.Text({ x: rx+6+(rw-16)/2+4, y: sliderPanelY-17, width: (rw-16)/2, text: '最大电阻', fontSize: 8, fill: '#ff8f00', align: 'center' });
        shortBtn.on('click tap', () => { this._RextTarget = 0; });
        maxBtn.on('click tap', ()   => { this._RextTarget = this.RextMax; });
        shortBtn.on('mouseenter', () => shortBtn.fill('#2a5a2a'));
        shortBtn.on('mouseleave', () => shortBtn.fill('#1a3a1a'));
        maxBtn.on('mouseenter', ()   => maxBtn.fill('#5a3a0a'));
        maxBtn.on('mouseleave', ()   => maxBtn.fill('#3a1a0a'));

        this._rextPanW   = panW;
        this._rextPanelX = rx+6;
        this._rextPanelY = sliderPanelY;

        this.group.add(bg, titleBg, this._rextMainBar, this._rextMainSlider, this._rextLbl, this._sMArcLbl, this._rextStatus, mmDown, shortBtn, shortLbl, maxBtn, maxLbl);
    }

    // ── T-n 特性曲线族（外接电阻变化时）─────
    _drawTorqueSpeedCurves() {
        const { _curveX: cx2, _curveY: cy2, _curveW: cw, _curveH: ch } = this;

        const bg = new Konva.Rect({ x: cx2, y: cy2, width: cw, height: ch, fill: '#010d18', stroke: '#1a3040', strokeWidth: 1.5, cornerRadius: 4 });
        const titleBg = new Konva.Rect({ x: cx2, y: cy2, width: cw, height: 14, fill: '#0a1a28', cornerRadius: [4,4,0,0] });
        this.group.add(new Konva.Text({ x: cx2+4, y: cy2+2, width: cw-8, text: 'T-n 特性曲线族（R_ext 变化，最大转矩不变）', fontSize: 8, fontStyle: 'bold', fill: '#80cbc4', align: 'center' }));

        const ox = cx2+18, oy = cy2+ch-14, aw = cw-24, ah = ch-28;
        this.group.add(new Konva.Line({ points: [ox, oy-ah, ox, oy, ox+aw, oy], stroke: '#37474f', strokeWidth: 1 }));
        this.group.add(new Konva.Text({ x: ox-16, y: cy2+14, text: 'T(N·m)', fontSize: 7, fill: '#80cbc4' }));
        this.group.add(new Konva.Text({ x: cx2+cw-14, y: oy+2, text: 'n(rpm)', fontSize: 7, fill: '#80cbc4' }));

        // 轴刻度
        const nMax = this.syncSpeed+80, tMax = this.maxTorque*1.15;
        [0, 400, 800, this.syncSpeed].forEach(n => {
            const nx = ox+(n/nMax)*(aw-2);
            this.group.add(new Konva.Line({ points: [nx,oy,nx,oy+3], stroke: '#37474f', strokeWidth: 0.8 }));
            this.group.add(new Konva.Text({ x: nx-10, y: oy+4, width: 20, text: n===this.syncSpeed?'n₁':n.toString(), fontSize: 6, fill: '#37474f', align: 'center' }));
        });
        [0, this.ratedTorque, this.maxTorque].forEach(T => {
            const ty = oy-(T/tMax)*(ah-4);
            this.group.add(new Konva.Line({ points: [ox-3,ty,ox,ty], stroke: '#37474f', strokeWidth: 0.8 }));
            this.group.add(new Konva.Text({ x: ox-24, y: ty-4, width: 22, text: Math.round(T)+'', fontSize: 6, fill: '#37474f', align: 'right' }));
        });

        // 预绘多条曲线（不同 R_ext 值）
        const rextValues = [0, 0.2, 0.5, 1.0, this.RextMax];
        const curveCols  = ['#4fc3f7','#66bb6a','#ffd54f','#ffa726','#ef9a9a'];
        rextValues.forEach((Rx, ci) => {
            const pts = [];
            for (let s = 1.0; s >= 0; s -= 0.01) {
                const n = this.syncSpeed*(1-s);
                const T = this._calcTorqueExt(s, Rx);
                const nx = ox+(n/nMax)*(aw-2);
                const ty = oy-(T/tMax)*(ah-4);
                if (nx > ox && nx < ox+aw && ty > cy2+14 && ty < oy) pts.push(nx, ty);
            }
            if (pts.length > 2) {
                this.group.add(new Konva.Line({ points: pts, stroke: curveCols[ci], strokeWidth: ci===0?2:1.2, lineJoin: 'round', opacity: ci===0?0.85:0.4 }));
            }
            // 标注
            if (ci > 0 && pts.length >= 2) {
                this.group.add(new Konva.Text({ x: pts[0]+2, y: pts[1]-9, text: `R${ci}`, fontSize: 6.5, fill: curveCols[ci], opacity: 0.55 }));
            }
        });
        // T_max 水平虚线（最大转矩不变）
        const tmY = oy - (this.maxTorque/tMax)*(ah-4);
        this.group.add(new Konva.Line({ points: [ox, tmY, ox+aw-2, tmY], stroke: 'rgba(255,167,38,0.35)', strokeWidth: 1, dash: [5,3] }));
        this.group.add(new Konva.Text({ x: ox+4, y: tmY-10, text: 'T_max（不变）', fontSize: 7, fill: 'rgba(255,167,38,0.6)' }));
        // 额定点
        const nRx = ox+(this.ratedSpeed/nMax)*(aw-2), tRy = oy-(this.ratedTorque/tMax)*(ah-4);
        this.group.add(new Konva.Circle({ x: nRx, y: tRy, radius: 4, fill: '#66bb6a', stroke: '#2e7d32', strokeWidth: 1 }));
        this.group.add(new Konva.Text({ x: nRx+4, y: tRy-10, text: 'N', fontSize: 7, fill: '#66bb6a' }));

        // 动态工作点
        this._workPoint = new Konva.Circle({ x: ox, y: oy, radius: 5.5, fill: '#ef5350', stroke: '#c62828', strokeWidth: 1.5 });
        this._workHLine = new Konva.Line({ points: [], stroke: '#ef5350', strokeWidth: 0.8, dash: [3,2], opacity: 0.5 });
        this._workVLine = new Konva.Line({ points: [], stroke: '#ef5350', strokeWidth: 0.8, dash: [3,2], opacity: 0.5 });
        // 当前曲线（动态绘制，随 R_ext 变化）
        this._activeCurveLine = new Konva.Line({ points: [], stroke: '#f57f17', strokeWidth: 2.2, lineJoin: 'round', opacity: 0.9 });

        this._tsOX = ox; this._tsOY = oy; this._tsAW = aw; this._tsAH = ah;
        this._tsNMax = nMax; this._tsTMax = tMax;

        this.group.add(bg, titleBg, this._activeCurveLine, this._workPoint, this._workHLine, this._workVLine);
    }

    // ── LCD 仪表 ──────────────────────────────
    _drawLCDPanel() {
        const lx = this._lcdX, ly = this._lcdY, lw = this._lcdW, lh = this._lcdH;

        const bg      = new Konva.Rect({ x: lx, y: ly, width: lw, height: lh, fill: '#020c14', stroke: '#1a3040', strokeWidth: 1.5, cornerRadius: 4 });
        const titleBg = new Konva.Rect({ x: lx, y: ly, width: lw, height: 14, fill: '#0a1a28', cornerRadius: [4,4,0,0] });
        this.group.add(new Konva.Text({ x: lx+4, y: ly+2, width: lw-8, text: '运行参数监控', fontSize: 8, fontStyle: 'bold', fill: '#80cbc4', align: 'center' }));

        // 参数网格（2×3）
        const params = [
            { label: '转速', id: 'n',    unit: 'rpm', color: '#66bb6a' },
            { label: '转差率', id: 's',  unit: '',    color: '#4fc3f7' },
            { label: '定子I', id: 'i1',  unit: 'A',   color: '#ef9a9a' },
            { label: '转子I', id: 'i2',  unit: 'A',   color: '#a5d6a7' },
            { label: '转矩', id: 't',    unit: 'N·m', color: '#ffd54f' },
            { label: '效率', id: 'eta',  unit: '%',   color: '#80cbc4' },
        ];
        const cellW = (lw-12)/3, cellH = (lh-22)/2;
        this._lcdCells = {};
        params.forEach(({ label, id, unit, color }, i) => {
            const col = i%3, row = Math.floor(i/3);
            const cx2 = lx + 6 + col*(cellW+2);
            const cy2 = ly + 18 + row*(cellH+2);
            this.group.add(new Konva.Rect({ x: cx2, y: cy2, width: cellW, height: cellH, fill: '#0d1520', cornerRadius: 2 }));
            this.group.add(new Konva.Text({ x: cx2+3, y: cy2+3, text: label, fontSize: 7, fill: '#37474f' }));
            const val = new Konva.Text({ x: cx2+3, y: cy2+12, width: cellW-6, text: '--', fontSize: cellH*0.38, fontFamily: 'Courier New, monospace', fontStyle: 'bold', fill: color, align: 'center' });
            this.group.add(new Konva.Text({ x: cx2+3, y: cy2+cellH-10, width: cellW-6, text: unit, fontSize: 7, fill: '#263238', align: 'center' }));
            this._lcdCells[id] = val;
            this.group.add(val);
        });
        this.group.add(bg, titleBg);
    }

    // ── 波形区（五路）────────────────────────
    _drawWaveform() {
        const { _wavX: wx, _wavY: wy, _wavW: ww, _wavH: wh } = this;
        if (wh < 16) return;

        const bg = new Konva.Rect({ x: wx, y: wy, width: ww, height: wh, fill: '#010d18', stroke: '#1a3040', strokeWidth: 1.5, cornerRadius: 4 });
        const titleBg = new Konva.Rect({ x: wx, y: wy, width: ww, height: 14, fill: '#0a1a28', cornerRadius: [4,4,0,0] });
        this.group.add(new Konva.Text({ x: wx+4, y: wy+2, width: ww-8, text: 'Iu  Iv  Iw 定子三相电流 ── n(rpm)转速 ── R_ext转子电阻', fontSize: 8, fontStyle: 'bold', fill: '#80cbc4', align: 'center' }));

        const h5 = (wh-14)/5;
        this._wavMids = Array.from({length:5}, (_,i) => wy+14+h5*(i+0.5));
        this._wavMids.forEach(my => {
            this.group.add(new Konva.Line({ points: [wx+2,my,wx+ww-2,my], stroke: 'rgba(200,200,200,0.07)', strokeWidth: 0.5, dash: [4,3] }));
        });
        this._wLineIu   = new Konva.Line({ points: [], stroke: '#ef5350', strokeWidth: 1.5, lineJoin: 'round' });
        this._wLineIv   = new Konva.Line({ points: [], stroke: '#66bb6a', strokeWidth: 1.5, lineJoin: 'round' });
        this._wLineIw   = new Konva.Line({ points: [], stroke: '#42a5f5', strokeWidth: 1.5, lineJoin: 'round' });
        this._wLineN    = new Konva.Line({ points: [], stroke: '#ffd54f', strokeWidth: 1.8, lineJoin: 'round' });
        this._wLineRext = new Konva.Line({ points: [], stroke: '#ffa726', strokeWidth: 1.4, lineJoin: 'round' });

        const lbls = ['Iu','Iv','Iw','n','Rext'];
        const colorsW = ['#ef5350','#66bb6a','#42a5f5','#ffd54f','#ffa726'];
        lbls.forEach((l, i) => this.group.add(new Konva.Text({ x: wx+4, y: wy+14+h5*i+4, text: l, fontSize: 8, fill: colorsW[i] })));

        this._wNLbl    = new Konva.Text({ x: wx+ww-80, y: wy+14+h5*3+4, width: 76, text: '0rpm', fontSize: 8, fontFamily: 'Courier New, monospace', fill: '#ffd54f', align: 'right' });
        this._wRextLbl = new Konva.Text({ x: wx+ww-80, y: wy+14+h5*4+4, width: 76, text: '0.0 p.u.', fontSize: 8, fontFamily: 'Courier New, monospace', fill: '#ffa726', align: 'right' });

        this.group.add(bg, titleBg, this._wLineIu, this._wLineIv, this._wLineIw, this._wLineN, this._wLineRext, this._wNLbl, this._wRextLbl);
        this._wavH5 = h5;
    }

    // ── 起停控制 ─────────────────────────────
    _drawControls() {
        const cx = this._motorCX, cy = this._motorCY, Ro = this._statorRo;
        const btnY = cy + Ro + 18;

        const startBtn = new Konva.Rect({ x: cx-35, y: btnY, width: 32, height: 14, fill: '#1a3a1a', stroke: '#2e7d32', strokeWidth: 1, cornerRadius: 2 });
        const startLbl = new Konva.Text({ x: cx-35, y: btnY+3, width: 32, text: '起动', fontSize: 8.5, fill: '#66bb6a', align: 'center' });
        const stopBtn  = new Konva.Rect({ x: cx+3, y: btnY, width: 32, height: 14, fill: '#3a1a1a', stroke: '#c62828', strokeWidth: 1, cornerRadius: 2 });
        const stopLbl  = new Konva.Text({ x: cx+3, y: btnY+3, width: 32, text: '停止', fontSize: 8.5, fill: '#ef5350', align: 'center' });

        startBtn.on('click tap', () => this.start());
        startBtn.on('mouseenter', () => startBtn.fill('#2a5a2a'));
        startBtn.on('mouseleave', () => startBtn.fill('#1a3a1a'));
        stopBtn.on('click tap',  () => this.stop());
        stopBtn.on('mouseenter', () => stopBtn.fill('#5a2a2a'));
        stopBtn.on('mouseleave', () => stopBtn.fill('#3a1a1a'));

        this.group.add(startBtn, startLbl, stopBtn, stopLbl);
    }

    // ── 带外接电阻的转矩计算 ──────────────────
    _calcTorqueExt(s, Rext) {
        if (Math.abs(s) < 0.0005) return 0;
        const U    = this.ratedVoltage / Math.sqrt(3);
        const R2tot= this.R2 + Rext;
        const R2s  = R2tot / s;
        const Ztot = Math.sqrt(Math.pow(this.R1+R2s,2) + Math.pow(this.X1+this.X2,2));
        const I2   = U / Ztot;
        return Math.max(0, this.polePairs * I2 * I2 * R2tot / (s * this.syncOmega));
    }

    // ── 临界转差率计算 ─────────────────────────
    _calcSlipMax(Rext) {
        const R2tot = this.R2 + Rext;
        return R2tot / Math.sqrt(Math.pow(this.R1,2) + Math.pow(this.X1+this.X2,2));
    }

    // ═══════════════════════════════════════════
    // 集中化 tick（由 consys._tickAll 在 20fps 调用）
    tick(dt) {
        this._tickControl(dt);
        this._tickPhysics(dt);
        this._tickMagField(dt);
        this._tickRotorAnim(dt);
        this._tickSlipRings(dt);
        this._tickRextPanel();
        this._tickActiveCurve();
        this._tickWorkPoint();
        this._tickWaveform(dt);
        this._tickDisplay();
        this._refreshCache();
    }


    // ── 起停控制逻辑 ─────────────────────────
    _tickControl(dt) {
        switch (this._startPhase) {
            case 0: this.slip = 1.0; break;
            case 1:
                this._startTimer += dt;
                if (this._startTimer > 0.3) { this._startPhase = 2; this.running = true; }
                break;
            case 2: break;
            case 3:
                this._targetLoad = 0;
                this.slip = Math.min(1.0, this.slip + dt*4);
                if (this.slip >= 0.999) { this._startPhase = 0; this.running = false; }
                break;
        }
    }

    // ── 物理积分 ─────────────────────────────
    _tickPhysics(dt) {
        this._loadSmooth += (this._targetLoad - this._loadSmooth) * Math.min(1, dt*5);
        this.torqueLoad   = this._loadSmooth;
        this._RextSmooth  += (this._RextTarget - this._RextSmooth) * Math.min(1, dt*6);
        this.Rext          = this._RextSmooth;

        if (this._startPhase === 0) {
            this.slip = 1.0; this.speed = 0; this.omega = 0;
            this.torqueEM = 0; this.currentA = 0; this.rotorCurrentA = 0;
            this.powerFactor = 0; this.efficiency = 0; this.rotorEMF = 0;
        } else {
            this.torqueEM = this._calcTorqueExt(this.slip, this.Rext);

            const frictionTq = 0.015 * this.ratedTorque * (1-this.slip);
            const netTq = this.torqueEM - this.torqueLoad - frictionTq;
            this.omega += (netTq / this.J) * dt;
            this.omega  = Math.max(0, Math.min(this.syncOmega*1.01, this.omega));
            this.speed  = Math.round(this.omega * 60 / (2*Math.PI));
            this.slip   = Math.max(0, (this.syncOmega - this.omega) / this.syncOmega);

            // 定子电流
            const U = this.ratedVoltage / Math.sqrt(3);
            const R2tot = this.R2 + this.Rext;
            const R2s   = R2tot / Math.max(0.001, this.slip);
            const Ztot  = Math.sqrt(Math.pow(this.R1+R2s,2) + Math.pow(this.X1+this.X2,2));
            this.currentA = U / Ztot;

            // 转子电流（折算前）
            this.rotorCurrentA = this.currentA * this.ratedVoltage / Math.max(1, this.rotorVoltage);

            // 转子感应 EMF（转差电压）
            this.rotorEMF = this.slip * this.rotorVoltage / Math.sqrt(3);

            // 功率因数、效率
            this.powerFactor = this.slip < 0.01 ? this.ratedCos : Math.min(this.ratedCos, 0.5 + (1-this.slip)*0.4);
            const pIn  = Math.sqrt(3) * this.ratedVoltage * this.currentA * this.powerFactor;
            const pOut = this.torqueEM * this.omega * (1-this.slip);
            this.efficiency = pIn > 100 ? Math.min(this.ratedEff, pOut/pIn*100) : 0;
        }

        this._fieldAngle += this.syncOmega * dt;
        this._rotorAngle += this.omega * dt;
        this._phase      += dt * 4;
        this._wavePhase  += dt * 2 * Math.PI * this.frequency;
        this._flowPhase  += dt * Math.max(0.5, this.slip * 10);
        this._brushSparkPhase += dt * Math.max(1, this.speed / 100);
        this._ringAngle  += this.omega * dt;

        // 火花强度（随负载和转差率）
        this._sparkIntensity = Math.min(1, this.slip * 3 + this.torqueLoad/this.ratedTorque * 0.3);
    }

    // ── 旋转磁场可视化 ───────────────────────
    _tickMagField(dt) {
        this._magFieldGroup.destroyChildren();
        if (this._startPhase === 0) return;

        const cx = this._motorCX, cy = this._motorCY;
        const Ri = this._statorRi - 8, Rg = this._rotorRo + 2;

        for (let i = 0; i < 9; i++) {
            const a = this._fieldAngle + (i/9)*Math.PI*2;
            const pulse = 0.35 + 0.25*Math.abs(Math.sin(a*this.polePairs));
            const phIdx = i%3;
            const cols = ['rgba(239,83,80,','rgba(102,187,106,','rgba(66,165,245,'];
            this._magFieldGroup.add(new Konva.Line({
                points: [cx+Ri*Math.cos(a), cy+Ri*Math.sin(a), cx+Rg*Math.cos(a), cy+Rg*Math.sin(a)],
                stroke: cols[phIdx]+(pulse*0.55)+')', strokeWidth: 1.8,
            }));
        }
        const fa = this._fieldAngle;
        const fA = 0.3 + 0.4*Math.min(1, 1-this.slip+0.3);
        this._magFieldGroup.add(new Konva.Arrow({
            points: [cx-(Ri-4)*Math.cos(fa), cy-(Ri-4)*Math.sin(fa), cx+(Ri-4)*Math.cos(fa), cy+(Ri-4)*Math.sin(fa)],
            stroke: `rgba(255,213,79,${fA*0.6})`, fill: `rgba(255,213,79,${fA*0.6})`,
            strokeWidth: 2.5, pointerLength: 7, pointerWidth: 6,
        }));
    }

    // ── 转子旋转 + 安培力 ────────────────────
    _tickRotorAnim(dt) {
        const angleDeg = this._rotorAngle * 180 / Math.PI;
        if (this._rotorGroup)     this._rotorGroup.rotation(angleDeg);
        if (this._rotorCoilGroup) this._rotorCoilGroup.rotation(angleDeg);

        // 感应电流方向（随转差率变化）
        if (this._rotorCoils && this._startPhase > 0 && this.slip > 0.005) {
            const iNorm = Math.min(1, this.currentA / (this.ratedPower*1000/(this.ratedVoltage*Math.sqrt(3)*this.ratedCos)));
            this._rotorCoils.forEach(({ g, color, angle }) => {
                const absA = angle + this._rotorAngle;
                const inField = Math.abs(Math.sin(absA * this.polePairs)) > 0.15;
                const r = Math.round(parseInt(color.slice(1,3)||'80',16) + iNorm*60);
                g.opacity(0.4 + iNorm * 0.6);
            });
        }

        // 安培力箭头
        this._forceGroup.destroyChildren();
        if (this._startPhase > 0 && this.torqueEM > 1) {
            const cx = this._motorCX, cy = this._motorCY;
            const R  = (this._rotorRo + this._rotorRi) / 2;
            const tNorm = Math.min(1, this.torqueEM / this.maxTorque);
            const arrowLen = 7 + tNorm * 12;
            for (let i = 0; i < 3; i++) {
                const a = this._rotorAngle + i*2*Math.PI/3;
                const ta = a + Math.PI/2;
                const px = cx + R*Math.cos(a), py = cy + R*Math.sin(a);
                this._forceGroup.add(new Konva.Arrow({ points: [px,py,px+arrowLen*Math.cos(ta),py+arrowLen*Math.sin(ta)], stroke: '#ffd54f', fill: '#ffd54f', strokeWidth: 2, pointerLength: 5, pointerWidth: 4, opacity: 0.6+0.4*tNorm }));
            }
        }

        // 定子绕组亮度
        if (this._statorPhaseGroups && this._startPhase > 0) {
            const iNorm = Math.min(1, this.currentA / (this.ratedPower*1000/(this.ratedVoltage*Math.sqrt(3)*this.ratedCos)));
            const t = this._wavePhase;
            const phaseCurrents = [Math.sin(t), Math.sin(t-2*Math.PI/3), Math.sin(t+2*Math.PI/3)];
            this._statorPhaseGroups.forEach((pg, i) => {
                pg.grp.opacity(0.45 + Math.abs(phaseCurrents[i]) * iNorm * 0.55);
            });
        }
    }

    // ── 集电环火花动画 ───────────────────────
    _tickSlipRings(dt) {
        if (this._slipRings) {
            this._slipRings.forEach(rg => rg.rotation(this._ringAngle * 180 / Math.PI * 0.5));
        }
        if (this._brushGroups) {
            this._brushGroups.forEach(({ sparks, color, ringY }, i) => {
                sparks.forEach((sp, si) => {
                    const sparkPulse = this._startPhase > 0 ? Math.abs(Math.sin(this._brushSparkPhase + i*1.3 + si*2.1)) : 0;
                    const spActive = sparkPulse > 0.65 && this._sparkIntensity > 0.05;
                    sp.radius(spActive ? 2.5 + sparkPulse * 2 * this._sparkIntensity : 0);
                    sp.fill(spActive ? color : 'transparent');
                });
            });
        }
        if (this._srRotArrow) {
            this._srRotArrow.opacity(this._startPhase > 0 ? 0.3 + 0.2*Math.abs(Math.sin(this._phase*2)) : 0.1);
        }
    }

    // ── 外接电阻面板更新 ─────────────────────
    _tickRextPanel() {
        const ratio = this.Rext / (this.RextMax + 0.001);
        const panW  = this._rextPanW;

        // 主进度条
        if (this._rextMainBar) this._rextMainBar.width(ratio * panW);
        if (this._rextMainSlider) this._rextMainSlider.x(this._rextPanelX + ratio * panW);

        // 三相分条（联动）
        if (this._rextBars) {
            this._rextBars.forEach(({ rBar, rFill, rhW }, i) => {
                rFill.width(ratio * rhW);
                if (this._rextSliders[i]) this._rextSliders[i].x(rBar.x() + ratio * rhW - 4);
            });
        }
        // 数值
        const Rext_ohm = this.Rext * this.R2 * 100;  // 折算为近似欧姆值
        if (this._rextValTxts) this._rextValTxts.forEach(t => t.text(`${Rext_ohm.toFixed(2)}Ω`));
        if (this._rextLbl) this._rextLbl.text(`R_ext = ${this.Rext.toFixed(3)} (标幺)`);
        if (this._sMArcLbl) {
            const sm = this._calcSlipMax(this.Rext);
            this._sMArcLbl.text(`s_m = ${sm.toFixed(4)}`);
        }
        if (this._rextStatus) {
            const st = this.Rext < 0.01 ? '● 转子短路（硬特性）' : this.Rext < this.RextMax*0.3 ? '◆ 低阻（调速）' : this.Rext < this.RextMax*0.7 ? '▶ 中阻（限流起动）' : '■ 高阻（最大起动转矩）';
            const sc = this.Rext < 0.01 ? '#66bb6a' : this.Rext < this.RextMax*0.3 ? '#4fc3f7' : this.Rext < this.RextMax*0.7 ? '#ffd54f' : '#ff8f00';
            this._rextStatus.text(st); this._rextStatus.fill(sc);
        }
    }

    // ── 当前 T-n 曲线（随 R_ext 实时变化）────
    _tickActiveCurve() {
        const { _tsOX: ox, _tsOY: oy, _tsAW: aw, _tsAH: ah, _tsNMax: nMax, _tsTMax: tMax } = this;
        const pts = [];
        for (let s = 1.0; s >= 0; s -= 0.008) {
            const n = this.syncSpeed*(1-s);
            const T = this._calcTorqueExt(s, this.Rext);
            const nx = ox+(n/nMax)*(aw-2);
            const ty = oy-(T/tMax)*(ah-4);
            if (nx > ox && nx < ox+aw && ty > this._curveY+14 && ty < oy) pts.push(nx, ty);
        }
        if (this._activeCurveLine && pts.length > 2) this._activeCurveLine.points(pts);
    }

    // ── 工作点更新 ───────────────────────────
    _tickWorkPoint() {
        const { _tsOX: ox, _tsOY: oy, _tsAW: aw, _tsAH: ah, _tsNMax: nMax, _tsTMax: tMax } = this;
        const n = this.speed, T = this.torqueEM;
        const nx = ox+(n/nMax)*(aw-2);
        const ty = oy-(T/tMax)*(ah-4);
        if (this._workPoint) { this._workPoint.x(nx); this._workPoint.y(Math.max(this._curveY+14,Math.min(oy,ty))); this._workPoint.fill(this.slip>0.15?'#ffa726':'#66bb6a'); }
        if (this._workHLine) this._workHLine.points([ox, ty, nx, ty]);
        if (this._workVLine) this._workVLine.points([nx, ty, nx, oy]);
    }

    // ── 波形 ─────────────────────────────────
    _tickWaveform(dt) {
        if (!this._wavH5) return;
        this._wavAcc += 1.4*dt*this._wavLen;
        const steps = Math.floor(this._wavAcc); this._wavAcc -= steps;

        const I_peak = this.currentA * Math.sqrt(2);
        const t = this._wavePhase;
        const iu = I_peak*Math.sin(t), iv = I_peak*Math.sin(t-2*Math.PI/3), iw = I_peak*Math.sin(t+2*Math.PI/3);

        for (let i = 0; i < steps; i++) {
            this._wavIu   = new Float32Array([...this._wavIu.slice(1),   iu]);
            this._wavIv   = new Float32Array([...this._wavIv.slice(1),   iv]);
            this._wavIw   = new Float32Array([...this._wavIw.slice(1),   iw]);
            this._wavN    = new Float32Array([...this._wavN.slice(1),    this.speed]);
            this._wavRext = new Float32Array([...this._wavRext.slice(1), this.Rext]);
        }

        const wx = this._wavX+3, ww = this._wavW-6;
        const n  = this._wavLen, dx = ww/n, h5 = this._wavH5;
        const iMax = Math.max(1, I_peak*1.1);
        const aI = h5*0.42, aN = h5*0.40, aR = h5*0.40;

        const uPts=[],vPts=[],wPts=[],nPts=[],rPts=[];
        for (let i = 0; i < n; i++) {
            const x = wx+i*dx;
            uPts.push(x, this._wavMids[0]-(this._wavIu[i]/iMax)*aI);
            vPts.push(x, this._wavMids[1]-(this._wavIv[i]/iMax)*aI);
            wPts.push(x, this._wavMids[2]-(this._wavIw[i]/iMax)*aI);
            nPts.push(x, this._wavMids[3]-((this._wavN[i]/this.syncSpeed)*2-1)*aN);
            rPts.push(x, this._wavMids[4]-((this._wavRext[i]/this.RextMax)*2-1)*aR);
        }
        if (this._wLineIu)   this._wLineIu.points(uPts);
        if (this._wLineIv)   this._wLineIv.points(vPts);
        if (this._wLineIw)   this._wLineIw.points(wPts);
        if (this._wLineN)    this._wLineN.points(nPts);
        if (this._wLineRext) this._wLineRext.points(rPts);
        if (this._wNLbl)     this._wNLbl.text(`${this.speed}rpm`);
        if (this._wRextLbl)  this._wRextLbl.text(`${this.Rext.toFixed(3)} p.u.`);
    }

    // ── 显示刷新 ─────────────────────────────
    _tickDisplay() {
        const c = this._lcdCells;
        if (!c) return;
        const mc = this.slip<0.02?'#66bb6a':this.slip<0.1?'#ffa726':'#ef5350';
        if (c.n)   { c.n.text(this.speed.toString()); c.n.fill(mc); }
        if (c.s)   c.s.text(this.slip.toFixed(4));
        if (c.i1)  c.i1.text(this.currentA.toFixed(2));
        if (c.i2)  c.i2.text(this.rotorCurrentA.toFixed(2));
        if (c.t)   c.t.text(this.torqueEM.toFixed(1));
        if (c.eta) c.eta.text(this.efficiency.toFixed(1));
    }

    // ═══════════════════════════════════════════
    start() {
        if (this._startPhase===0) { this._startPhase=1; this._startTimer=0; this.running=false; }
    }
    stop() {
        if (this._startPhase>0) this._startPhase=3;
    }
    setRext(r) {
        this._RextTarget = Math.max(0, Math.min(this.RextMax, r));
        this._refreshCache();
    }
    setLoad(t) {
        this._targetLoad = Math.max(0, Math.min(this.ratedTorque*1.2, t));
        this._refreshCache();
    }
    update(load) {
        if (typeof load === 'number') this.setLoad(load);
        this._refreshCache();
    }

    getConfigFields() {
        return [
            { label: '位号/名称',           key: 'id',           type: 'text'   },
            { label: '额定功率 (kW)',        key: 'ratedPower',   type: 'number' },
            { label: '额定电压 (V)',         key: 'ratedVoltage', type: 'number' },
            { label: '额定转速 (rpm)',       key: 'ratedSpeed',   type: 'number' },
            { label: '极对数 p',            key: 'polePairs',    type: 'number' },
            { label: '转子开路电压 (V)',     key: 'rotorVoltage', type: 'number' },
            { label: '外接电阻最大值（标幺）', key: 'RextMax',    type: 'number' },
            { label: '转动惯量 J (kg·m²)',  key: 'J',            type: 'number' },
        ];
    }

    onConfigUpdate(cfg) {
        this.id           = cfg.id           || this.id;
        this.ratedPower   = parseFloat(cfg.ratedPower)   || this.ratedPower;
        this.ratedVoltage = parseFloat(cfg.ratedVoltage) || this.ratedVoltage;
        this.ratedSpeed   = parseFloat(cfg.ratedSpeed)   || this.ratedSpeed;
        this.polePairs    = parseInt(cfg.polePairs)       || this.polePairs;
        this.rotorVoltage = parseFloat(cfg.rotorVoltage) || this.rotorVoltage;
        this.RextMax      = parseFloat(cfg.RextMax)      || this.RextMax;
        this.J            = parseFloat(cfg.J)            || this.J;
        this.syncSpeed    = 60*this.frequency/this.polePairs;
        this.syncOmega    = this.syncSpeed*2*Math.PI/60;
        this.ratedSlip    = (this.syncSpeed-this.ratedSpeed)/this.syncSpeed;
        this.ratedTorque  = (this.ratedPower*1000)/(this.ratedSpeed*2*Math.PI/60);
        this.maxTorque    = this.ratedTorque*2.8;
        this.config       = { ...this.config, ...cfg };
        this._refreshCache();
    }

    destroy() {
        super.destroy?.();
    }
}