import { BaseComponent } from './BaseComponent.js';

/**
 * 永磁直流电机仿真组件
 * （Permanent Magnet DC Motor — PMDC）
 *
 * ── 工作原理（安培力 + 换向器）─────────────────────────────────
 *
 *  1. 永磁定子（Permanent Magnet Stator）：
 *     永磁体在气隙中建立恒定磁场 B（T）
 *     N 极和 S 极分布在定子内圆面
 *
 *  2. 转子绕组（Rotor / Armature Winding）：
 *     导体通过电枢电流 I_a 时，在磁场中受安培力
 *       F = B × I_a × L    （每根导体所受力，N）
 *     合力产生电磁转矩
 *       T_em = K_φ × I_a
 *       K_φ = N × B × A × p / (2π)   （电机结构常数）
 *
 *  3. 换向器 + 电刷（Commutator + Brushes）：
 *     换向器将直流电流按位置分配到对应线圈
 *     保证转矩方向始终不变
 *     电刷固定，换向片随转子旋转
 *
 *  4. 反电动势（Back-EMF）：
 *     转子旋转时，绕组切割磁力线产生感应电动势
 *       E_b = K_φ × n    （n = 转速，r/s）
 *     平衡方程：
 *       V = E_b + I_a × R_a
 *       n = (V - I_a × R_a) / K_φ
 *
 *  5. 机械特性（Speed-Torque）：
 *     n = n₀ - (R_a / K_φ²) × T    （线性下斜特性）
 *     n₀ = V / K_φ（理想空载转速）
 *     堵转转矩 T_stall = K_φ × V / R_a
 *
 * ── 组件结构 ──────────────────────────────────────────────────
 *  ① 定子截面（N/S 永磁体，弧形磁极）
 *  ② 转子截面（多槽绕组，随通电方向变化电流方向）
 *  ③ 换向器 + 电刷（换向片闪光动画）
 *  ④ 磁场线（N→S 弧形磁力线，随转子旋转产生切割动画）
 *  ⑤ 安培力箭头（当前受力方向）
 *  ⑥ 输出轴（随转子旋转）
 *  ⑦ 仪表 LCD（V、I、n、T、P、E_b）
 *  ⑧ 机械特性曲线（速度-转矩曲线，当前工作点）
 *  ⑨ 波形示波器（电枢电流 / 转速实时曲线）
 *
 * ── 端口 ─────────────────────────────────────────────────────
 *  wire_a+  — 电枢正极（+）
 *  wire_a−  — 电枢负极（−）
 *
 * ── 气路求解器集成 ────────────────────────────────────────────
 *  special = 'none'
 *  update(voltage) — 外部注入端电压（V）
 */
export class PermanentMagnetDCMotor extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.width  = Math.max(380, config.width  || 440);
        this.height = Math.max(320, config.height || 380);

        this.type    = 'pmdc_motor';
        this.special = 'none';
        this.cache   = 'fixed';

        // ── 电机额定参数 ──
        this.ratedVoltage  = config.ratedVoltage  || 24;      // V（额定电压）
        this.ratedPower    = config.ratedPower    || 150;     // W（额定功率）
        this.Ra            = config.Ra            || 0.8;     // Ω（电枢电阻）
        this.Ke            = config.Ke            || 0.0152;  // V·s/rad（反电动势系数 = K_φ）
        this.Kt            = config.Kt            || 0.0152;  // N·m/A（转矩系数，等于 Ke）
        this.J             = config.J             || 0.0002;  // kg·m²（转动惯量）
        this.friction      = config.friction      || 0.0005;  // N·m·s（粘性摩擦系数）
        this.polePairs     = config.polePairs     || 2;       // 极对数
        this.slots         = config.slots         || 8;       // 转子槽数
        this.maxVoltage    = config.maxVoltage    || 24;      // 最大允许电压 V

        // 计算空载转速和堵转转矩
        this._n0     = this.ratedVoltage / this.Ke;   // rad/s（理想空载角速度）
        this._Tstall = this.ratedVoltage / (this.Ra * this.Kt) * this.Kt;  // N·m

        // ── 状态 ──
        this.supplyVoltage = config.initVoltage || 0;    // 端电压 V
        this._manualVoltage= config.initVoltage || 0;
        this.loadTorque    = config.initLoad    || 0;    // 负载转矩 N·m

        this.omega         = 0;     // 角速度 rad/s
        this.rpm           = 0;     // 转速 r/min
        this.current       = 0;     // 电枢电流 A
        this.backEMF       = 0;     // 反电动势 V
        this.torqueEM      = 0;     // 电磁转矩 N·m
        this.mechPower     = 0;     // 机械功率 W
        this.elecPower     = 0;     // 电功率 W
        this.efficiency    = 0;     // 效率 %
        this.isBreak       = false;

        // ── 动画 ──
        this._rotorAngle   = 0;     // rad
        this._comAngle     = 0;     // 换向器旋转角（稍慢于转子）
        this._sparkPhase   = 0;     // 换向火花相位
        this._fieldPhase   = 0;     // 磁场线动画
        this._phase        = 0;     // 通用相位

        // ── 波形缓冲 ──
        this._wavLen       = 220;
        this._wavI         = new Float32Array(this._wavLen).fill(0);
        this._wavN         = new Float32Array(this._wavLen).fill(0);
        this._wavAcc       = 0;

        // ── 拖拽（电压调节）──
        this._dragActive   = false;
        this._dragStartY   = 0;
        this._dragStartV   = 0;

        // ── 几何布局 ──
        // 电机截面图（左侧主体）
        this._motorCX  = Math.round(this.width * 0.28);
        this._motorCY  = Math.round(this.height * 0.42);
        this._statorR  = Math.round(Math.min(this.width * 0.22, this.height * 0.36));
        this._rotorR   = Math.round(this._statorR * 0.62);
        this._airGap   = Math.round(this._statorR * 0.08);

        // 仪表头（右侧）
        this._headX    = Math.round(this.width * 0.56);
        this._headY    = 28;
        this._headW    = this.width - this._headX - 8;
        this._headH    = Math.round(this.height * 0.54);

        // 特性曲线区（右下）
        this._curveX   = this._headX;
        this._curveY   = this._headY + this._headH + 10;
        this._curveW   = this._headW;
        this._curveH   = Math.round(this.height * 0.25);

        // 波形区（左下）
        this._wavX     = 8;
        this._wavY     = this._motorCY + this._statorR + 18;
        this._wavW     = Math.round(this.width * 0.54);
        this._wavH     = this.height - this._wavY - 6;

        this._lastTs   = null;
        this._animId   = null;
        this.knobs     = {};

        this.config = {
            id: this.id, ratedVoltage: this.ratedVoltage,
            ratedPower: this.ratedPower, Ra: this.Ra, Ke: this.Ke,
        };

        this._init();

        this.addPort(this._motorCX - this._statorR - 8, this._motorCY - 18, 'ap', 'wire', 'A+');
        this.addPort(this._motorCX - this._statorR - 8, this._motorCY + 18, 'an', 'wire', 'A−');
        this.addPort(this._motorCX + this._statorR + 8, this._motorCY,      'shaft', 'pipe', '输出轴');
    }

    // ═══════════════════════════════════════════
    _init() {
        this._drawLabel();
        this._drawStatorShell();
        this._drawPermanentMagnets();
        this._drawMagneticFieldLines();
        this._drawRotorCore();
        this._drawRotorSlots();
        this._drawAirGap();
        this._drawCommutatorBrushes();
        this._drawShaftEnd();
        this._drawForceArrows();
        this._drawInputWires();
        this._drawInstrHead();
        this._drawLCD();
        this._drawKnobs();
        this._drawCharCurve();
        this._drawWaveform();
        this._setupDrag();
        this._startAnimation();
    }

    _drawLabel() {
        this.group.add(new Konva.Text({
            x: 0, y: -22, width: this.width,
            text: '永磁直流电机（PMDC Motor — 换向器 · 安培力 · 反电动势）',
            fontSize: 12, fontStyle: 'bold', fill: '#1a2634', align: 'center',
        }));
    }

    // ── 定子外壳 ─────────────────────────────
    _drawStatorShell() {
        const cx = this._motorCX, cy = this._motorCY, R = this._statorR;

        // 外壳圆环
        const statorOuter = new Konva.Circle({ x: cx, y: cy, radius: R + 10, fill: '#455a64', stroke: '#263238', strokeWidth: 2.5 });
        const statorInner = new Konva.Ring({ x: cx, y: cy, innerRadius: R - 4, outerRadius: R + 10, fill: '#546e7a' });
        // 安装耳（四角）
        for (let i = 0; i < 4; i++) {
            const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
            const bx = cx + (R + 12) * Math.cos(a), by = cy + (R + 12) * Math.sin(a);
            this.group.add(new Konva.Circle({ x: bx, y: by, radius: 5, fill: '#37474f', stroke: '#263238', strokeWidth: 0.5 }));
            this.group.add(new Konva.Circle({ x: bx - 1, y: by - 1, radius: 1.5, fill: 'rgba(255,255,255,0.25)' }));
        }
        // 定子内壁（圆柱内面）
        const statorBore = new Konva.Circle({ x: cx, y: cy, radius: R, fill: '#0d1a28' });

        // 外壳高光
        this.group.add(new Konva.Arc({ x: cx, y: cy, innerRadius: R+4, outerRadius: R+10, angle: 60, rotation: -150, fill: 'rgba(255,255,255,0.08)' }));

        // 标注
        this.group.add(new Konva.Text({ x: cx - R - 10, y: cy - R - 24, text: '定子（永磁体）', fontSize: 9, fontStyle: 'bold', fill: '#80cbc4' }));

        this.group.add(statorOuter, statorInner, statorBore);
    }

    // ── 永磁极 ────────────────────────────────
    _drawPermanentMagnets() {
        const cx = this._motorCX, cy = this._motorCY, R = this._statorR;
        const p  = this.polePairs;

        for (let i = 0; i < p * 2; i++) {
            const isN = i % 2 === 0;
            const poleAngle = (i / (p * 2)) * Math.PI * 2;
            const poleArc   = Math.PI / (p * 2) * 0.85;
            const innerR    = R - 18, outerR = R - 2;

            // 磁极弧形
            const pole = new Konva.Arc({
                x: cx, y: cy,
                innerRadius: innerR, outerRadius: outerR,
                angle: poleArc * 180 / Math.PI,
                rotation: (poleAngle - poleArc / 2) * 180 / Math.PI - 90,
                fill: isN ? '#ef5350' : '#42a5f5',
                stroke: isN ? '#b71c1c' : '#1565c0',
                strokeWidth: 1,
            });
            // 极性标注
            const labelR = (innerR + outerR) / 2;
            const labelAngle = poleAngle;
            const lx = cx + labelR * Math.cos(labelAngle - Math.PI / 2);
            const ly = cy + labelR * Math.sin(labelAngle - Math.PI / 2);
            this.group.add(new Konva.Text({ x: lx - 5, y: ly - 5, width: 10, text: isN ? 'N' : 'S', fontSize: 10, fontStyle: 'bold', fill: '#ffffff', align: 'center' }));
            this.group.add(pole);
        }
    }

    // ── 磁场线（N→S，弧形虚线）──────────────
    _drawMagneticFieldLines() {
        this._fieldLinesGroup = new Konva.Group();
        this.group.add(this._fieldLinesGroup);
    }

    // ── 转子铁芯 ─────────────────────────────
    _drawRotorCore() {
        const cx = this._motorCX, cy = this._motorCY;
        const R  = this._rotorR;

        // 转子组（随电机旋转）
        this._rotorGroup = new Konva.Group({ x: cx, y: cy });

        // 铁芯圆盘
        const core = new Konva.Circle({ radius: R, fill: '#607d8b', stroke: '#455a64', strokeWidth: 1.5 });
        // 铁芯高光
        this._rotorGroup.add(core);
        this._rotorGroup.add(new Konva.Circle({ x: -R * 0.2, y: -R * 0.2, radius: R * 0.15, fill: 'rgba(255,255,255,0.12)' }));

        // 中心轴
        const shaft = new Konva.Circle({ radius: R * 0.12, fill: '#37474f', stroke: '#263238', strokeWidth: 1.5 });
        const shaftHole = new Konva.Circle({ radius: R * 0.06, fill: '#1a252f' });
        // 键槽
        this._rotorGroup.add(new Konva.Rect({ x: -R*0.05, y: -R*0.12, width: R*0.10, height: R*0.06, fill: '#1a252f' }));
        this._rotorGroup.add(shaft, shaftHole);

        this.group.add(this._rotorGroup);
    }

    // ── 转子绕组槽 ────────────────────────────
    _drawRotorSlots() {
        const cx = this._motorCX, cy = this._motorCY;
        const R  = this._rotorR;
        const N  = this.slots;

        // 转子绕组在旋转组内
        this._coilGroup = new Konva.Group({ x: cx, y: cy });

        this._coilLines = [];
        for (let i = 0; i < N; i++) {
            const a = (i / N) * Math.PI * 2;
            const r1 = R * 0.22, r2 = R * 0.88;
            const coil = new Konva.Line({
                points: [r1 * Math.cos(a), r1 * Math.sin(a), r2 * Math.cos(a), r2 * Math.sin(a)],
                stroke: '#80cbc4', strokeWidth: 2.5, lineCap: 'round',
            });
            this._coilLines.push({ coil, angle: a });
            this._coilGroup.add(coil);
        }
        this.group.add(this._coilGroup);
    }

    // ── 气隙（半透明环）──────────────────────
    _drawAirGap() {
        const cx = this._motorCX, cy = this._motorCY;
        const R  = this._statorR;
        // 气隙环（轻微发光感，随电流变化）
        this._airGapRing = new Konva.Ring({ x: cx, y: cy, innerRadius: this._rotorR + 2, outerRadius: R - 20, fill: 'rgba(100,200,255,0.04)' });
        this.group.add(this._airGapRing);
    }

    // ── 换向器 + 电刷 ─────────────────────────
    _drawCommutatorBrushes() {
        const cx = this._motorCX, cy = this._motorCY;
        const R  = this._rotorR;
        const comR = R * 0.35;

        // 换向器组（旋转）
        this._comGroup = new Konva.Group({ x: cx, y: cy });
        const comN = this.slots;
        for (let i = 0; i < comN; i++) {
            const a1 = (i / comN) * Math.PI * 2;
            const a2 = ((i + 0.85) / comN) * Math.PI * 2;
            const seg = new Konva.Arc({
                innerRadius: comR - 5, outerRadius: comR,
                angle: (0.85 / comN) * 360,
                rotation: a1 * 180 / Math.PI - 90,
                fill: '#c0a020', stroke: '#8a7010', strokeWidth: 0.5,
            });
            this._comGroup.add(seg);
        }
        this.group.add(this._comGroup);

        // 电刷（固定在0°/180°）
        const brushData = [
            { angle: -Math.PI/2,   label: '+', color: '#ef9a9a' },
            { angle:  Math.PI/2,   label: '−', color: '#90caf9' },
        ];
        this._brushGroups = [];
        brushData.forEach(({ angle, label, color }) => {
            const bx = cx + (comR + 8) * Math.cos(angle);
            const by = cy + (comR + 8) * Math.sin(angle);
            const brush = new Konva.Rect({ x: bx - 5, y: by - 4, width: 10, height: 8, fill: '#78909c', stroke: '#546e7a', strokeWidth: 1, cornerRadius: 1 });
            const spark = new Konva.Circle({ x: bx - 6 * Math.cos(angle), y: by - 6 * Math.sin(angle), radius: 0, fill: color });
            this._brushGroups.push({ brush, spark, bx, by, angle, color });
            this.group.add(brush, spark);
        });
        this.group.add(this._comGroup);

        // 换向器中心轴盘
        this.group.add(new Konva.Circle({ x: cx, y: cy, radius: comR - 6, fill: '#546e7a', stroke: '#37474f', strokeWidth: 1 }));
        this.group.add(new Konva.Text({ x: cx - 16, y: cy + comR + 6, text: '换向器', fontSize: 8, fill: '#78909c' }));
    }

    // ── 输出轴 ────────────────────────────────
    _drawShaftEnd() {
        const cx = this._motorCX, cy = this._motorCY, R = this._statorR;

        // 轴延伸（右侧）
        this.group.add(new Konva.Rect({ x: cx + R + 8, y: cy - 6, width: 30, height: 12, fill: '#78909c', stroke: '#546e7a', strokeWidth: 1 }));
        this.group.add(new Konva.Rect({ x: cx + R + 36, y: cy - 4, width: 16, height: 8, fill: '#90a4ae', stroke: '#607d8b', strokeWidth: 1 }));
        this.group.add(new Konva.Text({ x: cx + R + 8, y: cy + 10, text: '输出轴', fontSize: 7.5, fill: '#607d8b' }));

        // 端盖
        this.group.add(new Konva.Ellipse({ x: cx + R + 6, y: cy, radiusX: 8, radiusY: R * 0.55, fill: '#607d8b', stroke: '#455a64', strokeWidth: 1.5 }));
        this.group.add(new Konva.Ellipse({ x: cx - R - 6, y: cy, radiusX: 8, radiusY: R * 0.55, fill: '#607d8b', stroke: '#455a64', strokeWidth: 1.5 }));
    }

    // ── 安培力箭头（动态层）───────────────
    _drawForceArrows() {
        this._forceGroup = new Konva.Group();
        this.group.add(this._forceGroup);
    }

    // ── 电源引线 ─────────────────────────────
    _drawInputWires() {
        const cx = this._motorCX, cy = this._motorCY, R = this._statorR;

        // 引线标注
        this.group.add(new Konva.Text({ x: cx - R - 28, y: cy - 22, text: 'V+', fontSize: 9, fontStyle: 'bold', fill: '#ef9a9a' }));
        this.group.add(new Konva.Text({ x: cx - R - 28, y: cy + 14, text: 'V−', fontSize: 9, fontStyle: 'bold', fill: '#90caf9' }));

        // 电流流向动画（进线）
        this._inputFlowGroup = new Konva.Group();
        this.group.add(this._inputFlowGroup);
    }

    // ── 仪表头（右侧）────────────────────────
    _drawInstrHead() {
        const hx = this._headX, hy = this._headY;
        const hw = this._headW, hh = this._headH;

        const jBox = new Konva.Rect({ x: hx, y: hy, width: hw, height: 44, fill: '#cfd8dc', stroke: '#90a4ae', strokeWidth: 1.5, cornerRadius: [5,5,0,0] });
        for (let i = 0; i < 3; i++) this.group.add(new Konva.Line({ points: [hx, hy+6+i*10, hx+hw, hy+6+i*10], stroke: 'rgba(255,255,255,0.14)', strokeWidth: 0.8 }));
        const plate = new Konva.Rect({ x: hx+8, y: hy+4, width: hw-16, height: 27, fill: '#eceff1', stroke: '#b0bec5', strokeWidth: 0.5, cornerRadius: 2 });
        this._idText = new Konva.Text({ x: hx+8, y: hy+7, width: hw-16, text: this.id || 'PMDC-01', fontSize: 9, fontStyle: 'bold', fill: '#263238', align: 'center' });
        this.group.add(new Konva.Text({ x: hx+8, y: hy+17, width: hw-16, text: `${this.ratedVoltage}V  ${this.ratedPower}W`, fontSize: 7, fill: '#78909c', align: 'center' }));
        this.group.add(new Konva.Text({ x: hx+8, y: hy+26, width: hw-16, text: 'PERMANENT MAGNET DC', fontSize: 7, fill: '#90a4ae', align: 'center' }));
        const lcap = new Konva.Rect({ x: hx, y: hy+3, width: 10, height: 40, fill: '#b0bec5', cornerRadius: [2,0,0,2] });
        const rcap = new Konva.Rect({ x: hx+hw-10, y: hy+3, width: 10, height: 40, fill: '#b0bec5', cornerRadius: [0,2,2,0] });
        const body = new Konva.Rect({ x: hx, y: hy+44, width: hw, height: hh-44, fill: '#1e2a36', stroke: '#0d1520', strokeWidth: 1.5, cornerRadius: [0,0,4,4] });
        this.group.add(jBox, plate, lcap, rcap, this._idText, body);
    }

    // ── 圆形 LCD ──────────────────────────────
    _drawLCD() {
        const hx = this._headX, hw = this._headW;
        const lcy = this._headY + 44 + (this._headH - 44) * 0.50;
        const lcx = hx + hw / 2;
        const R   = Math.min(hw * 0.38, 42);
        this._lcCX = lcx; this._lcCY = lcy; this._lcR = R;

        this.group.add(new Konva.Circle({ x: lcx, y: lcy, radius: R+4, fill: '#0d1520', stroke: '#1a252f', strokeWidth: 1 }));
        const ring = new Konva.Circle({ x: lcx, y: lcy, radius: R+2, fill: '#1a0d00', stroke: '#f57f17', strokeWidth: 2.5 });
        this._lcdBg = new Konva.Circle({ x: lcx, y: lcy, radius: R, fill: '#020c14' });

        this._speedArc = new Konva.Arc({ x: lcx, y: lcy, innerRadius: R-5, outerRadius: R-3, angle: 0, fill: '#ffa726', rotation: -90 });
        this._lcdMain   = new Konva.Text({ x: lcx-R+4, y: lcy-R*.40, width:(R-4)*2, text:'0',     fontSize:R*.44, fontFamily:'Courier New, monospace', fontStyle:'bold', fill:'#ffa726', align:'center' });
        this._lcdUnit   = new Konva.Text({ x: lcx-R+4, y: lcy+R*.10, width:(R-4)*2, text:'rpm',   fontSize:R*.17, fill:'#1a0d00', align:'center' });
        this._lcdVolt   = new Konva.Text({ x: lcx-R+4, y: lcy+R*.30, width:(R-4)*2, text:'V=0.0', fontSize:R*.13, fontFamily:'Courier New, monospace', fill:'#37474f', align:'center' });
        this._lcdCurr   = new Konva.Text({ x: lcx-R+4, y: lcy-R*.62, width:(R-4)*2, text:'I=0.0A',fontSize:R*.13, fontFamily:'Courier New, monospace', fill:'#80cbc4', align:'center' });
        this._lcdBackEMF= new Konva.Text({ x: lcx-R+4, y: lcy+R*.47, width:(R-4)*2, text:'Eb=0V', fontSize:R*.12, fontFamily:'Courier New, monospace', fill:'#263238', align:'center' });

        this.group.add(ring, this._lcdBg, this._speedArc, this._lcdMain, this._lcdUnit, this._lcdVolt, this._lcdCurr, this._lcdBackEMF);
    }

    // ── 旋钮 ─────────────────────────────────
    _drawKnobs() {
        const hx = this._headX, hw = this._headW;
        const kx = hx + hw / 2, ky = this._lcCY + this._lcR + 16;

        const base = new Konva.Circle({ x: kx, y: ky, radius: 18, fill: '#263238', stroke: '#1a252f', strokeWidth: 1.5 });
        this._knobRotor = new Konva.Group({ x: kx, y: ky });
        this._knobRotor.add(
            new Konva.Circle({ radius: 14, fill: '#37474f', stroke: '#263238', strokeWidth: 1 }),
            new Konva.Line({ points: [0,-12,0,-4], stroke: '#ffa726', strokeWidth: 3, lineCap: 'round' }),
        );
        this._knobAngle = 0;
        this._knobRotor.on('mousedown touchstart', (e) => {
            e.cancelBubble = true;
            const sy = e.evt.clientY ?? e.evt.touches?.[0]?.clientY ?? 0;
            const sv = this._manualVoltage;
            const sa = this._knobAngle;
            const mv = me => {
                const cy2 = me.clientY ?? me.touches?.[0]?.clientY ?? 0;
                const newA = Math.max(-150, Math.min(150, sa + (sy - cy2) * 1.8));
                this._knobAngle = newA;
                this._knobRotor.rotation(newA);
                this._manualVoltage = Math.max(0, Math.min(this.maxVoltage, sv + (sy - cy2) * (this.maxVoltage / 150)));
            };
            const up = () => { window.removeEventListener('mousemove', mv); window.removeEventListener('touchmove', mv); window.removeEventListener('mouseup', up); window.removeEventListener('touchend', up); };
            window.addEventListener('mousemove', mv); window.addEventListener('touchmove', mv);
            window.addEventListener('mouseup', up); window.addEventListener('touchend', up);
        });
        this.group.add(base, this._knobRotor, new Konva.Text({ x: kx-16, y: ky+22, width: 32, text: '电压旋钮', fontSize: 8.5, fill: '#546e7a', align: 'center' }));
    }

    // ── 机械特性曲线 ──────────────────────────
    _drawCharCurve() {
        const { _curveX: cx2, _curveY: cy2, _curveW: cw, _curveH: ch } = this;

        const bg = new Konva.Rect({ x: cx2, y: cy2, width: cw, height: ch, fill: '#010d18', stroke: '#1a3040', strokeWidth: 1.5, cornerRadius: 4 });
        const titleBg = new Konva.Rect({ x: cx2, y: cy2, width: cw, height: 13, fill: '#0a1a28', cornerRadius: [4,4,0,0] });
        this.group.add(new Konva.Text({ x: cx2+4, y: cy2+2, width: cw-8, text: 'n-T 机械特性', fontSize: 8, fontStyle: 'bold', fill: '#ffa726', align: 'center' }));

        // 坐标轴
        const ox = cx2+12, oy = cy2+ch-12, aw = cw-20, ah = ch-22;
        this.group.add(new Konva.Line({ points: [ox, oy-ah, ox, oy, ox+aw, oy], stroke: '#37474f', strokeWidth: 1 }));
        this.group.add(new Konva.Text({ x: ox-10, y: cy2+13, text: 'n', fontSize: 7.5, fill: '#ffa726' }));
        this.group.add(new Konva.Text({ x: cx2+cw-12, y: oy+2, text: 'T', fontSize: 7.5, fill: '#ffa726' }));

        // 特性线（静态，由额定参数决定斜率）
        const charLine = new Konva.Line({ points: [ox, oy-ah+2, ox+aw-2, oy], stroke: '#ffa726', strokeWidth: 1.5, opacity: 0.6 });
        // 工作点（动态）
        this._charPoint = new Konva.Circle({ x: ox, y: oy-ah/2, radius: 4.5, fill: '#ef5350', stroke: '#c62828', strokeWidth: 1 });

        this._charOX = ox; this._charOY = oy; this._charAW = aw; this._charAH = ah;

        this.group.add(bg, titleBg, charLine, this._charPoint);
    }

    // ── 波形示波器 ────────────────────────────
    _drawWaveform() {
        const { _wavX: wx, _wavY: wy, _wavW: ww, _wavH: wh } = this;
        if (wh < 20) return;

        const bg = new Konva.Rect({ x: wx, y: wy, width: ww, height: wh, fill: '#010d18', stroke: '#1a3040', strokeWidth: 1.5, cornerRadius: 4 });
        const titleBg = new Konva.Rect({ x: wx, y: wy, width: ww, height: 13, fill: '#0a1a28', cornerRadius: [4,4,0,0] });
        this.group.add(new Konva.Text({ x: wx+4, y: wy+2, width: ww-8, text: '电枢电流 I(A)  ── 转速 n(rpm)', fontSize: 8, fontStyle: 'bold', fill: '#ffa726', align: 'center' }));

        for (let i = 1; i < 3; i++) this.group.add(new Konva.Line({ points: [wx, wy+wh*i/3, wx+ww, wy+wh*i/3], stroke: 'rgba(255,167,38,0.07)', strokeWidth: 0.5 }));

        this._wavMidI = wy + wh * 0.28;
        this._wavMidN = wy + wh * 0.76;
        [this._wavMidI, this._wavMidN].forEach(my => {
            this.group.add(new Konva.Line({ points: [wx+2, my, wx+ww-2, my], stroke: 'rgba(200,200,200,0.10)', strokeWidth: 0.5, dash: [4,3] }));
        });

        this._wLineI = new Konva.Line({ points: [], stroke: '#ef9a9a', strokeWidth: 1.6, lineJoin: 'round' });
        this._wLineN = new Konva.Line({ points: [], stroke: '#ffa726', strokeWidth: 1.8, lineJoin: 'round' });

        this.group.add(new Konva.Text({ x: wx+4, y: wy+16, text: 'I (A)', fontSize: 8, fill: '#ef9a9a' }));
        this.group.add(new Konva.Text({ x: wx+4, y: wy+wh/2+5, text: 'n (rpm)', fontSize: 8, fill: '#ffa726' }));

        this._wILbl = new Konva.Text({ x: wx+ww-80, y: wy+16, width: 76, text: '0.0 A', fontSize: 8, fontFamily: 'Courier New, monospace', fill: '#ef9a9a', align: 'right' });
        this._wNLbl = new Konva.Text({ x: wx+ww-80, y: wy+wh/2+5, width: 76, text: '0 rpm', fontSize: 8, fontFamily: 'Courier New, monospace', fill: '#ffa726', align: 'right' });

        this.group.add(bg, titleBg, this._wLineI, this._wLineN, this._wILbl, this._wNLbl);
    }

    // ── 拖拽调压 ─────────────────────────────
    _setupDrag() {
        const hit = new Konva.Circle({ x: this._motorCX, y: this._motorCY, radius: this._statorR + 12, fill: 'transparent', listening: true });
        hit.on('mousedown touchstart', e => {
            e.cancelBubble = true;
            this._dragStartY = e.evt.clientY ?? e.evt.touches?.[0]?.clientY ?? 0;
            this._dragStartV = this._manualVoltage;
            this._dragActive = true;
        });
        const mv = e => {
            if (!this._dragActive) return;
            const cy2 = e.clientY ?? e.touches?.[0]?.clientY ?? 0;
            this._manualVoltage = Math.max(0, Math.min(this.maxVoltage, this._dragStartV + (this._dragStartY - cy2) * 0.12));
        };
        const up = () => { this._dragActive = false; };
        window.addEventListener('mousemove', mv);
        window.addEventListener('touchmove', mv, { passive: true });
        window.addEventListener('mouseup', up);
        window.addEventListener('touchend', up);
        this.group.add(hit);
    }

    // ═══════════════════════════════════════════
    _startAnimation() {
        const tick = ts => {
            if (this._lastTs !== null) {
                const dt = Math.min((ts - this._lastTs) / 1000, 0.05);
                this._tickPhysics(dt);
                this._tickRotorViz(dt);
                this._tickFieldLines(dt);
                this._tickCommutatorSparks(dt);
                this._tickForceArrows();
                this._tickInputFlow(dt);
                this._tickWaveform(dt);
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

    // ── 电机物理方程 ──────────────────────────
    _tickPhysics(dt) {
        this.supplyVoltage = this._manualVoltage;

        // 反电动势
        this.backEMF = this.Ke * this.omega;

        // 电枢电流（稳态近似）
        this.current = Math.max(0, (this.supplyVoltage - this.backEMF) / this.Ra);

        // 电磁转矩
        this.torqueEM = this.Kt * this.current;

        // 净转矩 = 电磁转矩 - 负载转矩 - 摩擦转矩
        const frictionTorque = this.friction * this.omega;
        const netTorque = this.torqueEM - this.loadTorque - frictionTorque;

        // 角加速度 α = T_net / J
        this.omega += (netTorque / this.J) * dt;
        this.omega  = Math.max(0, this.omega);   // 不反转

        // 转速 rpm
        this.rpm = Math.round(this.omega * 60 / (2 * Math.PI));

        // 功率
        this.elecPower = this.supplyVoltage * this.current;
        this.mechPower = this.torqueEM * this.omega;
        this.efficiency = this.elecPower > 0.1 ? Math.min(99, this.mechPower / this.elecPower * 100) : 0;

        // 旋转角度
        this._rotorAngle += this.omega * dt;
        this._comAngle   += this.omega * dt;
        this._sparkPhase += dt * Math.max(1, this.omega * 0.5);
        this._fieldPhase += dt * 3;
        this._phase      += dt * 4;

        // 气隙辉光
        if (this._airGapRing) {
            const iNorm = Math.min(1, this.current / (this.ratedVoltage / this.Ra));
            this._airGapRing.fill(`rgba(${Math.round(50+iNorm*150)},${Math.round(150+iNorm*50)},255,${0.04+iNorm*0.08})`);
        }

        // 转速弧
        if (this._speedArc) {
            const maxRPM = this.ratedVoltage / this.Ke * 60 / (2 * Math.PI);
            const ratio  = Math.min(1, this.rpm / maxRPM);
            this._speedArc.angle(ratio * 360);
        }

        // 更新负载转矩（来自外部）
        this.loadTorque = this._externalLoad || 0;
    }

    // ── 转子旋转可视化 ────────────────────────
    _tickRotorViz(dt) {
        const angle = this._rotorAngle * 180 / Math.PI;
        if (this._rotorGroup)  this._rotorGroup.rotation(angle);
        if (this._coilGroup)   this._coilGroup.rotation(angle);
        if (this._comGroup)    this._comGroup.rotation(angle);

        // 线圈颜色随电流变化
        const iNorm = Math.min(1, this.current / (this.ratedVoltage / this.Ra));
        if (this._coilLines) {
            this._coilLines.forEach(({ coil, angle: a }) => {
                // 当前磁场方向下的受力情况决定颜色
                const absAngle = (this._rotorAngle + a) % (Math.PI * 2);
                const inField  = Math.abs(Math.sin(absAngle)) > 0.3;
                const col = inField ? `rgba(${Math.round(100+iNorm*155)},${Math.round(200+iNorm*55)},${Math.round(210-iNorm*100)},${0.5+iNorm*0.5})` : 'rgba(128,203,196,0.3)';
                coil.stroke(col);
                coil.strokeWidth(2 + iNorm * 1.5);
            });
        }
    }

    // ── 磁场线动画 ────────────────────────────
    _tickFieldLines(dt) {
        this._fieldLinesGroup.destroyChildren();

        const cx = this._motorCX, cy = this._motorCY;
        const R1 = this._rotorR + 3, R2 = this._statorR - 20;
        const p  = this.polePairs;

        for (let pi = 0; pi < p * 2; pi++) {
            const isN = pi % 2 === 0;
            const poleCenter = (pi / (p * 2)) * Math.PI * 2 - Math.PI / 2;
            const numLines = 4;
            for (let li = 0; li < numLines; li++) {
                const spread = (li / (numLines-1) - 0.5) * 0.6;
                const startAngle = poleCenter + spread;
                const endAngle   = isN ? startAngle + Math.PI : startAngle - Math.PI;
                const pulse = 0.4 + 0.2 * Math.abs(Math.sin(this._fieldPhase + li));

                // 简化磁场线（弧形）
                this._fieldLinesGroup.add(new Konva.Arc({
                    x: cx, y: cy,
                    innerRadius: R1 + li * (R2-R1)/numLines,
                    outerRadius: R1 + li * (R2-R1)/numLines + 1.5,
                    angle: 25,
                    rotation: startAngle * 180 / Math.PI + (isN ? 0 : 180),
                    fill: `rgba(${isN?'239,83,80':'66,165,245'},${pulse * 0.5})`,
                }));
            }
        }
    }

    // ── 换向火花 ─────────────────────────────
    _tickCommutatorSparks(dt) {
        if (!this._brushGroups) return;
        this._brushGroups.forEach(({ spark, bx, by, angle, color }) => {
            if (this.current > 0.5 && this.omega > 5) {
                const sparkAmp = Math.min(1, this.current / 5);
                const sSize    = 2 + sparkAmp * 3;
                const pulse    = Math.abs(Math.sin(this._sparkPhase + angle));
                spark.radius(sSize * pulse);
                spark.fill(`rgba(${parseInt(color.slice(1,3),16)},${parseInt(color.slice(3,5),16)},${parseInt(color.slice(5,7),16)},${pulse * sparkAmp})`);
            } else {
                spark.radius(0);
            }
        });
    }

    // ── 安培力箭头 ───────────────────────────
    _tickForceArrows() {
        this._forceGroup.destroyChildren();
        if (this.current < 0.3) return;

        const cx = this._motorCX, cy = this._motorCY;
        const R  = this._rotorR;
        const iNorm = Math.min(1, this.current / (this.ratedVoltage / this.Ra));
        const arrowLen = 10 + iNorm * 8;

        // 在转子受力最强的两个对称点绘制力箭头
        for (let s = 0; s < 2; s++) {
            const forceAngle = this._rotorAngle + s * Math.PI;
            const px = cx + R * 0.72 * Math.cos(forceAngle);
            const py = cy + R * 0.72 * Math.sin(forceAngle);
            // 力的方向（垂直于半径，切向）
            const tangAngle = forceAngle + Math.PI / 2;
            const fx = px + arrowLen * Math.cos(tangAngle);
            const fy = py + arrowLen * Math.sin(tangAngle);

            this._forceGroup.add(new Konva.Arrow({
                points: [px, py, fx, fy],
                stroke: '#ffd54f', fill: '#ffd54f',
                strokeWidth: 2, pointerLength: 5, pointerWidth: 4,
                opacity: 0.7 + 0.3 * iNorm,
            }));
        }
    }

    // ── 电流流入动画 ──────────────────────────
    _tickInputFlow(dt) {
        this._inputFlowGroup.destroyChildren();
        if (this.current < 0.1) return;

        const cx = this._motorCX, cy = this._motorCY, R = this._statorR;
        const iNorm = Math.min(1, this.current / (this.ratedVoltage / this.Ra));
        for (let i = 0; i < 3; i++) {
            const t = ((this._phase * 0.1 + i/3) % 1 + 1) % 1;
            const px2 = cx - R - 8 + t * 8;
            this._inputFlowGroup.add(new Konva.Circle({ x: px2, y: cy - 16, radius: 2.5, fill: `rgba(239,154,154,${iNorm * (1-t)})` }));
        }
    }

    // ── 波形 ─────────────────────────────────
    _tickWaveform(dt) {
        if (this._wavH < 20) return;
        this._wavAcc += 1.4 * dt * this._wavLen;
        const steps = Math.floor(this._wavAcc);
        this._wavAcc -= steps;
        const maxI   = this.ratedVoltage / this.Ra;
        const maxRPM = this.ratedVoltage / this.Ke * 60 / (2 * Math.PI);
        for (let i = 0; i < steps; i++) {
            this._wavI = new Float32Array([...this._wavI.slice(1), this.current]);
            this._wavN = new Float32Array([...this._wavN.slice(1), this.rpm]);
        }
        const wx = this._wavX+3, wy2 = this._wavY;
        const ww = this._wavW-6, wh = this._wavH;
        const n  = this._wavLen, dx = ww / n;
        const iAmp = wh * 0.22, nAmp = wh * 0.22;
        const iPts = [], nPts = [];
        for (let i = 0; i < n; i++) {
            const x = wx + i * dx;
            iPts.push(x, this._wavMidI - (this._wavI[i]/maxI) * iAmp);
            nPts.push(x, this._wavMidN - (this._wavN[i]/maxRPM) * nAmp);
        }
        if (this._wLineI) this._wLineI.points(iPts);
        if (this._wLineN) this._wLineN.points(nPts);
        if (this._wILbl) this._wILbl.text(`${this.current.toFixed(2)} A`);
        if (this._wNLbl) this._wNLbl.text(`${this.rpm} rpm`);
    }

    // ── LCD 刷新 ─────────────────────────────
    _tickDisplay() {
        const maxRPM = Math.round(this.ratedVoltage / this.Ke * 60 / (2 * Math.PI));
        const mc = this.rpm > maxRPM * 0.95 ? '#ff5722' : this.rpm > 100 ? '#ffa726' : '#f57f17';

        if (this._lcdBg) this._lcdBg.fill('#020c14');
        if (this._lcdMain) { this._lcdMain.text(this.rpm.toString()); this._lcdMain.fill(mc); }
        if (this._lcdVolt) this._lcdVolt.text(`V=${this.supplyVoltage.toFixed(1)}`);
        if (this._lcdCurr) this._lcdCurr.text(`I=${this.current.toFixed(2)}A`);
        if (this._lcdBackEMF) this._lcdBackEMF.text(`Eb=${this.backEMF.toFixed(1)}V`);

        // 工作点在特性曲线上的位置
        if (this._charPoint) {
            const maxT   = this.ratedVoltage / (this.Ra * this.Kt) * this.Kt;
            const maxRPM2= this.ratedVoltage / this.Ke * 60 / (2 * Math.PI);
            const tNorm  = Math.min(1, this.torqueEM / (maxT + 0.001));
            const nNorm  = Math.min(1, this.rpm / (maxRPM2 + 1));
            this._charPoint.x(this._charOX + tNorm * (this._charAW - 4));
            this._charPoint.y(this._charOY - nNorm * (this._charAH - 4));
        }
    }

    // ═══════════════════════════════════════════
    update(voltage) {
        if (typeof voltage === 'number') {
            this._manualVoltage = Math.max(0, Math.min(this.maxVoltage, voltage));
        }
        this._refreshCache();
    }

    setLoad(torque) {
        this._externalLoad = Math.max(0, torque);
        this._refreshCache();
    }

    getConfigFields() {
        return [
            { label: '位号/名称',          key: 'id',           type: 'text'   },
            { label: '额定电压 (V)',        key: 'ratedVoltage', type: 'number' },
            { label: '额定功率 (W)',        key: 'ratedPower',   type: 'number' },
            { label: '电枢电阻 Ra (Ω)',    key: 'Ra',           type: 'number' },
            { label: '反电动势系数 Ke',     key: 'Ke',           type: 'number' },
            { label: '极对数',             key: 'polePairs',    type: 'number' },
        ];
    }

    onConfigUpdate(cfg) {
        this.id           = cfg.id           || this.id;
        this.ratedVoltage = parseFloat(cfg.ratedVoltage) || this.ratedVoltage;
        this.ratedPower   = parseFloat(cfg.ratedPower)   || this.ratedPower;
        this.Ra           = parseFloat(cfg.Ra)           || this.Ra;
        this.Ke           = parseFloat(cfg.Ke)           || this.Ke;
        this.Kt           = this.Ke;
        this.polePairs    = parseInt(cfg.polePairs)      || this.polePairs;
        this.config       = { ...this.config, ...cfg };
        if (this._idText) this._idText.text(this.id);
        this._refreshCache();
    }

    destroy() { this._stopAnimation(); super.destroy?.(); }
}