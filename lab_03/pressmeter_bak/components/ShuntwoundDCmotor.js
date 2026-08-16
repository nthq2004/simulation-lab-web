import { BaseComponent } from './BaseComponent.js';

/**
 * 并励直流电动机仿真组件
 * （Shunt-Wound DC Motor — Separately Excited / Self-Excited Shunt）
 *
 * ── 并励电机结构 ──────────────────────────────────────────────
 *  并励（Shunt）接法：励磁绕组与电枢绕组并联，共用同一电源。
 *
 *  ┌─────────────────────────────────────────────┐
 *  │    V_s ─── 电枢绕组（Ra，I_a）─── GND        │
 *  │     │                                        │
 *  │     └─── 励磁绕组（Rf，I_f）─── GND          │
 *  └─────────────────────────────────────────────┘
 *
 *  励磁电流：
 *    I_f = V_s / R_f       （恒定，不受转速影响）
 *
 *  磁通量：
 *    Φ = K_f × I_f         （与励磁电流成正比）
 *
 * ── 电机方程（分析） ──────────────────────────────────────────
 *
 *  电枢回路：
 *    V_s = E_b + I_a × R_a
 *    E_b = K_e × Φ × ω    （反电动势）
 *
 *  电磁转矩：
 *    T_em = K_t × Φ × I_a
 *
 *  运动方程：
 *    J × dω/dt = T_em - T_L - B × ω
 *    T_L — 外部负载阻力矩（可调节）
 *    B   — 粘性摩擦系数
 *
 *  稳态转速：
 *    ω₀ = (V_s - I_a × R_a) / (K_e × Φ)
 *
 *  并励电机特点：
 *    → 励磁磁通恒定（不随负载变化）
 *    → 转速调整率小（硬特性）
 *    → 空载转速 ≈ 额定转速（转速变化率 < 5~10%）
 *
 * ── 动态调节过程演示 ──────────────────────────────────────────
 *  负载阻力矩增大 → 电机减速 → E_b↓ → I_a↑ → T_em↑ → 重新平衡
 *  负载阻力矩减小 → 电机加速 → E_b↑ → I_a↓ → T_em↓ → 重新平衡
 *
 *  调节过程中可观察：
 *    ① 转速 ω 的动态曲线（先偏离后恢复稳态）
 *    ② 电枢电流 I_a 的动态响应（与转速相反方向变化）
 *    ③ 电磁转矩 T_em 的变化（追赶负载转矩）
 *    ④ 转子截面动画（转速快慢变化）
 *    ⑤ 磁场线（励磁磁场恒定）
 *    ⑥ 安培力箭头（随电流变化）
 *
 * ── 组件结构 ──────────────────────────────────────────────────
 *  左：电机截面图（定子/励磁绕组/转子/换向器）
 *  中右：仪表 LCD（ω、I_a、I_f、T_em、T_L、η）
 *  下左：动态波形（ω(t)、I_a(t)、T_em(t)）
 *  下右：负载调节面板（滑块 + 快速预设按钮）
 *
 * ── 端口 ─────────────────────────────────────────────────────
 *  wire_vs_p — 电源正极（V+）
 *  wire_vs_n — 电源负极（V−/GND）
 *  pipe_shaft — 输出轴（机械负载端）
 */
export class ShuntWoundDCMotor extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.width  = Math.max(400, config.width  || 480);
        this.height = Math.max(340, config.height || 400);

        this.type    = 'shunt_dc_motor';
        this.special = 'none';
        this.cache   = 'fixed';

        // ── 额定参数 ──
        this.Vs      = config.Vs      || 220;    // 额定电源电压 V
        this.Ra      = config.Ra      || 0.5;    // 电枢电阻 Ω
        this.Rf      = config.Rf      || 110;    // 励磁电阻 Ω
        this.Ke      = config.Ke      || 0.18;   // 反电动势系数（含Φ）V·s/rad
        this.Kt      = config.Kt      || 0.18;   // 转矩系数 N·m/A
        this.J       = config.J       || 0.05;   // 转动惯量 kg·m²
        this.B       = config.B       || 0.01;   // 粘性摩擦系数 N·m·s
        this.maxRPM  = config.maxRPM  || 1500;   // 额定转速 rpm
        this.polePairs = config.polePairs || 2;
        this.slots   = config.slots   || 10;

        // 励磁电流（恒定）
        this._If     = this.Vs / this.Rf;

        // ── 状态 ──
        this.omega   = 0;     // 当前角速度 rad/s（实时动态值）
        this._omega  = 0;     // 平滑显示值
        this.current = 0;     // 电枢电流 I_a A
        this.backEMF = 0;     // 反电动势 V
        this.torqueEM= 0;     // 电磁转矩 N·m
        this.loadTorque = config.initLoad || 0;   // 负载阻力矩 N·m（可调）
        this._targetLoad= config.initLoad || 0;   // 目标负载（平滑过渡）
        this.rpm     = 0;
        this.elecPower = 0;
        this.mechPower = 0;
        this.efficiency= 0;
        this.powered   = true;
        this.isBreak   = false;

        // ── 动画 ──
        this._rotorAngle = 0;
        this._phase      = 0;
        this._sparkPhase = 0;
        this._fieldPhase = 0;
        this._transientTimer = 0;   // 动态过程计时器（显示"调节中"状态）

        // ── 动态响应记录（用于高亮显示调节过程）──
        this._inTransient = false;
        this._transientCooldown = 0;

        // ── 波形缓冲（三路）──
        this._wavLen  = 260;
        this._wavN    = new Float32Array(this._wavLen).fill(0);
        this._wavIa   = new Float32Array(this._wavLen).fill(0);
        this._wavTem  = new Float32Array(this._wavLen).fill(0);
        this._wavAcc  = 0;

        // ── 几何布局 ──
        this._motorCX  = Math.round(this.width * 0.26);
        this._motorCY  = Math.round(this.height * 0.42);
        this._statorR  = Math.round(Math.min(this.width * 0.20, this.height * 0.34));
        this._rotorR   = Math.round(this._statorR * 0.60);

        this._headX    = Math.round(this.width * 0.54);
        this._headY    = 28;
        this._headW    = this.width - this._headX - 8;
        this._headH    = Math.round(this.height * 0.50);

        this._wavX     = 8;
        this._wavY     = this._motorCY + this._statorR + 22;
        this._wavW     = Math.round(this.width * 0.50);
        this._wavH     = this.height - this._wavY - 8;

        this._loadPanelX = this._headX;
        this._loadPanelY = this._headY + this._headH + 10;
        this._loadPanelW = this._headW;
        this._loadPanelH = this.height - this._loadPanelY - 6;

        // 最大负载（用于归一化）
        this._maxLoad = this.Vs * this.Kt / this.Ra * 1.2;  // 约为堵转转矩

        this.knobs    = {};

        this.config = {
            id: this.id, Vs: this.Vs, Ra: this.Ra, Rf: this.Rf,
            Ke: this.Ke, J: this.J, maxRPM: this.maxRPM,
        };

        this._init();

        this.addPort(this._motorCX - this._statorR - 10, this._motorCY - 20, 'vs_p', 'wire', 'V+');
        this.addPort(this._motorCX - this._statorR - 10, this._motorCY + 20, 'vs_n', 'wire', 'GND');
        this.addPort(this._motorCX + this._statorR + 10, this._motorCY,      'shaft','pipe', '轴');
    }

    // ═══════════════════════════════════════════
    _init() {
        this._drawLabel();
        this._drawStatorShell();
        this._drawFieldWinding();
        this._drawPermanentMagnetPoles();
        this._drawAirGap();
        this._drawRotorCore();
        this._drawRotorSlots();
        this._drawCommutator();
        this._drawShaft();
        this._drawElecSchematic();
        this._drawForceArrowLayer();
        this._drawInputFlowLayer();
        this._drawInstrHead();
        this._drawLCD();
        this._drawLoadPanel();
        this._drawWaveform();
        this._setupDrag();
        
    }

    _drawLabel() {
        this.group.add(new Konva.Text({
            x: 0, y: -22, width: this.width,
            text: '并励直流电动机（Shunt DC Motor）— 动态负载调节',
            fontSize: 12, fontStyle: 'bold', fill: '#1a2634', align: 'center',
        }));
    }

    // ── 定子外壳 ─────────────────────────────
    _drawStatorShell() {
        const cx = this._motorCX, cy = this._motorCY, R = this._statorR;

        // 外壳
        this.group.add(new Konva.Circle({ x: cx, y: cy, radius: R + 12, fill: '#455a64', stroke: '#263238', strokeWidth: 2.5 }));
        this.group.add(new Konva.Circle({ x: cx, y: cy, radius: R + 12, fill: 'rgba(255,255,255,0.06)', stroke: 'none' }));
        // 安装耳
        for (let i = 0; i < 4; i++) {
            const a = (i/4) * Math.PI * 2 + Math.PI/4;
            this.group.add(new Konva.Circle({ x: cx + (R+9)*Math.cos(a), y: cy + (R+9)*Math.sin(a), radius: 5, fill: '#37474f', stroke: '#263238', strokeWidth: 0.5 }));
        }
        // 定子内壁
        this.group.add(new Konva.Circle({ x: cx, y: cy, radius: R, fill: '#0d1a28' }));
        // 标注
        this.group.add(new Konva.Text({ x: cx - R, y: cy - R - 22, width: R*2, text: '并励直流电动机', fontSize: 9, fontStyle: 'bold', fill: '#80cbc4', align: 'center' }));
    }

    // ── 励磁绕组（定子绕组，橙色线圈）───────
    _drawFieldWinding() {
        const cx = this._motorCX, cy = this._motorCY, R = this._statorR;
        const p = this.polePairs;

        // 励磁绕组铁心+线圈（每极）
        for (let i = 0; i < p * 2; i++) {
            const poleAngle = (i / (p*2)) * Math.PI * 2;
            const poleArc   = Math.PI / (p*2) * 0.70;
            const ir = R - 22, or = R - 6;

            // 铁芯极靴（深灰）
            this.group.add(new Konva.Arc({
                x: cx, y: cy, innerRadius: ir - 6, outerRadius: ir + 2,
                angle: poleArc * 180/Math.PI * 1.3,
                rotation: (poleAngle - poleArc * 0.65) * 180/Math.PI - 90,
                fill: '#37474f', stroke: '#263238', strokeWidth: 0.5,
            }));
            // 励磁线圈（橙色，并排绕制）
            const coilCol = i % 2 === 0 ? '#ff8f00' : '#f9a825';
            this.group.add(new Konva.Arc({
                x: cx, y: cy, innerRadius: ir, outerRadius: or,
                angle: poleArc * 180/Math.PI,
                rotation: (poleAngle - poleArc/2) * 180/Math.PI - 90,
                fill: coilCol, stroke: '#e65100', strokeWidth: 0.8, opacity: 0.85,
            }));
            // 极性标记
            const isN = i % 2 === 0;
            const mr  = (ir + or) / 2;
            const mlx = cx + mr * Math.cos(poleAngle - Math.PI/2);
            const mly = cy + mr * Math.sin(poleAngle - Math.PI/2);
            this.group.add(new Konva.Text({ x: mlx-5, y: mly-6, width: 10, text: isN ? 'N' : 'S', fontSize: 9, fontStyle: 'bold', fill: '#fff', align: 'center' }));
        }
        this.group.add(new Konva.Text({ x: cx - R, y: cy + R + 14, width: R*2, text: `励磁: Rf=${this.Rf}Ω  If=${this._If.toFixed(2)}A`, fontSize: 7.5, fontFamily: 'Courier New, monospace', fill: '#ff8f00', align: 'center' }));
    }

    _drawPermanentMagnetPoles() {
        // 并励电机极性已在励磁绕组中画出，此函数留空
    }

    _drawAirGap() {
        const cx = this._motorCX, cy = this._motorCY;
        this._airGapRing = new Konva.Ring({ x: cx, y: cy, innerRadius: this._rotorR + 2, outerRadius: this._statorR - 28, fill: 'rgba(50,150,255,0.04)' });
        this.group.add(this._airGapRing);
    }

    // ── 转子铁芯 ─────────────────────────────
    _drawRotorCore() {
        const cx = this._motorCX, cy = this._motorCY;
        this._rotorGroup = new Konva.Group({ x: cx, y: cy });
        const R = this._rotorR;
        this._rotorGroup.add(new Konva.Circle({ radius: R, fill: '#607d8b', stroke: '#455a64', strokeWidth: 1.5 }));
        this._rotorGroup.add(new Konva.Circle({ x: -R*0.18, y: -R*0.18, radius: R*0.14, fill: 'rgba(255,255,255,0.10)' }));
        // 轴孔
        this._rotorGroup.add(new Konva.Circle({ radius: R*0.10, fill: '#263238', stroke: '#1a2634', strokeWidth: 1 }));
        // 键槽
        this._rotorGroup.add(new Konva.Rect({ x: -R*0.045, y: -R*0.10, width: R*0.09, height: R*0.05, fill: '#1a252f' }));
        this.group.add(this._rotorGroup);
    }

    // ── 转子槽（电枢绕组）────────────────────
    _drawRotorSlots() {
        const cx = this._motorCX, cy = this._motorCY;
        const R  = this._rotorR;
        this._coilGroup = new Konva.Group({ x: cx, y: cy });
        this._coilLines = [];
        for (let i = 0; i < this.slots; i++) {
            const a = (i / this.slots) * Math.PI * 2;
            const coil = new Konva.Line({
                points: [R*0.20*Math.cos(a), R*0.20*Math.sin(a), R*0.88*Math.cos(a), R*0.88*Math.sin(a)],
                stroke: '#80cbc4', strokeWidth: 2.2, lineCap: 'round',
            });
            this._coilLines.push({ coil, angle: a });
            this._coilGroup.add(coil);
        }
        this.group.add(this._coilGroup);
    }

    // ── 换向器 ───────────────────────────────
    _drawCommutator() {
        const cx = this._motorCX, cy = this._motorCY;
        const R  = this._rotorR, comR = R * 0.32;
        this._comGroup = new Konva.Group({ x: cx, y: cy });
        for (let i = 0; i < this.slots; i++) {
            const a = (i / this.slots) * Math.PI * 2;
            this._comGroup.add(new Konva.Arc({
                innerRadius: comR - 5, outerRadius: comR,
                angle: (0.82 / this.slots) * 360,
                rotation: a * 180/Math.PI - 90,
                fill: '#c0a020', stroke: '#8a7010', strokeWidth: 0.4,
            }));
        }
        this._comGroup.add(new Konva.Circle({ radius: comR - 6, fill: '#546e7a', stroke: '#37474f', strokeWidth: 1 }));
        this.group.add(this._comGroup);

        // 电刷
        this._brushSparks = [];
        [{ a: -Math.PI/2, col: '#ef9a9a' }, { a: Math.PI/2, col: '#90caf9' }].forEach(({ a, col }) => {
            const bx = cx + (comR+8)*Math.cos(a), by = cy + (comR+8)*Math.sin(a);
            this.group.add(new Konva.Rect({ x: bx-5, y: by-4, width: 10, height: 8, fill: '#78909c', stroke: '#546e7a', strokeWidth: 1, cornerRadius: 1 }));
            const spark = new Konva.Circle({ x: bx-5*Math.cos(a), y: by-5*Math.sin(a), radius: 0, fill: col });
            this._brushSparks.push({ spark, bx, by, angle: a, col });
            this.group.add(spark);
        });
    }

    // ── 输出轴 ───────────────────────────────
    _drawShaft() {
        const cx = this._motorCX, cy = this._motorCY, R = this._statorR;
        this.group.add(new Konva.Ellipse({ x: cx+R+6, y: cy, radiusX: 8, radiusY: R*0.50, fill: '#607d8b', stroke: '#455a64', strokeWidth: 1.5 }));
        this.group.add(new Konva.Rect({ x: cx+R+8, y: cy-5, width: 28, height: 10, fill: '#78909c', stroke: '#546e7a', strokeWidth: 1 }));
        this.group.add(new Konva.Ellipse({ x: cx-R-6, y: cy, radiusX: 8, radiusY: R*0.50, fill: '#607d8b', stroke: '#455a64', strokeWidth: 1.5 }));
        this.group.add(new Konva.Text({ x: cx+R+8, y: cy+8, text: '输出轴', fontSize: 7.5, fill: '#607d8b' }));
    }

    // ── 电路原理图（小型示意，右上角）────────
    _drawElecSchematic() {
        const sx = this._motorCX + this._statorR + 48;
        const sy = this._motorCY - 28;
        const sw = Math.round(this.width * 0.10);
        const sh = 58;

        this.group.add(new Konva.Rect({ x: sx, y: sy, width: sw, height: sh, fill: '#020c14', stroke: '#1a3040', strokeWidth: 1, cornerRadius: 3 }));
        this.group.add(new Konva.Text({ x: sx+2, y: sy+2, width: sw-4, text: '并励接法', fontSize: 7.5, fill: '#80cbc4', align: 'center' }));

        // 简化电路线
        const mx = sx + sw/2;
        // 电枢支路
        this.group.add(new Konva.Text({ x: sx+3, y: sy+15, text: '─Ra─E_b─', fontSize: 6.5, fill: '#ef9a9a' }));
        this._schIaText = new Konva.Text({ x: sx+3, y: sy+25, text: `Ia=0A`, fontSize: 6.5, fontFamily: 'Courier New, monospace', fill: '#ef9a9a' });
        // 励磁支路
        this.group.add(new Konva.Text({ x: sx+3, y: sy+36, text: `─Rf─`, fontSize: 6.5, fill: '#ff8f00' }));
        this.group.add(new Konva.Text({ x: sx+3, y: sy+46, text: `If=${this._If.toFixed(2)}A`, fontSize: 6.5, fontFamily: 'Courier New, monospace', fill: '#ff8f00' }));

        this.group.add(this._schIaText);
    }

    // ── 安培力箭头层 ─────────────────────────
    _drawForceArrowLayer() {
        this._forceGroup = new Konva.Group();
        this.group.add(this._forceGroup);
    }

    // ── 电流流入动画层 ───────────────────────
    _drawInputFlowLayer() {
        this._inputFlowGroup = new Konva.Group();
        this.group.add(this._inputFlowGroup);
    }

    // ── 仪表头 ───────────────────────────────
    _drawInstrHead() {
        const hx = this._headX, hy = this._headY, hw = this._headW, hh = this._headH;
        const jBox = new Konva.Rect({ x: hx, y: hy, width: hw, height: 44, fill: '#cfd8dc', stroke: '#90a4ae', strokeWidth: 1.5, cornerRadius: [5,5,0,0] });
        for (let i = 0; i < 3; i++) this.group.add(new Konva.Line({ points: [hx, hy+6+i*10, hx+hw, hy+6+i*10], stroke: 'rgba(255,255,255,0.14)', strokeWidth: 0.8 }));
        const plate = new Konva.Rect({ x: hx+8, y: hy+4, width: hw-16, height: 27, fill: '#eceff1', stroke: '#b0bec5', strokeWidth: 0.5, cornerRadius: 2 });
        this._idText = new Konva.Text({ x: hx+8, y: hy+7, width: hw-16, text: this.id || 'M-SHT-01', fontSize: 9, fontStyle: 'bold', fill: '#263238', align: 'center' });
        this.group.add(new Konva.Text({ x: hx+8, y: hy+17, width: hw-16, text: `${this.Vs}V  并励接法`, fontSize: 7, fill: '#78909c', align: 'center' }));
        this.group.add(new Konva.Text({ x: hx+8, y: hy+27, width: hw-16, text: 'SHUNT DC MOTOR', fontSize: 7, fill: '#90a4ae', align: 'center' }));
        const body = new Konva.Rect({ x: hx, y: hy+44, width: hw, height: hh-44, fill: '#1e2a36', stroke: '#0d1520', strokeWidth: 1.5, cornerRadius: [0,0,4,4] });
        this.group.add(jBox, plate, this._idText, body);
    }

    // ── 圆形 LCD ─────────────────────────────
    _drawLCD() {
        const hx = this._headX, hw = this._headW;
        const lcy = this._headY + 44 + (this._headH - 44) * 0.46;
        const lcx = hx + hw / 2;
        const R   = Math.min(hw * 0.40, 42);
        this._lcCX = lcx; this._lcCY = lcy; this._lcR = R;

        this.group.add(new Konva.Circle({ x: lcx, y: lcy, radius: R+4, fill: '#0d1520', stroke: '#1a252f', strokeWidth: 1 }));
        const ring = new Konva.Circle({ x: lcx, y: lcy, radius: R+2, fill: '#002200', stroke: '#2e7d32', strokeWidth: 2.5 });
        this._lcdBg = new Konva.Circle({ x: lcx, y: lcy, radius: R, fill: '#020c14' });
        this._speedArc = new Konva.Arc({ x: lcx, y: lcy, innerRadius: R-5, outerRadius: R-3, angle: 0, fill: '#66bb6a', rotation: -90 });
        this._lcdMain   = new Konva.Text({ x: lcx-R+4, y: lcy-R*.40, width:(R-4)*2, text:'0',     fontSize:R*.44, fontFamily:'Courier New, monospace', fontStyle:'bold', fill:'#66bb6a', align:'center' });
        this._lcdUnit   = new Konva.Text({ x: lcx-R+4, y: lcy+R*.10, width:(R-4)*2, text:'rpm',   fontSize:R*.17, fill:'#002200', align:'center' });
        this._lcdIa     = new Konva.Text({ x: lcx-R+4, y: lcy+R*.29, width:(R-4)*2, text:'Ia=0A', fontSize:R*.13, fontFamily:'Courier New, monospace', fill:'#ef9a9a', align:'center' });
        this._lcdTem    = new Konva.Text({ x: lcx-R+4, y: lcy-R*.62, width:(R-4)*2, text:'Tem=0', fontSize:R*.13, fontFamily:'Courier New, monospace', fill:'#80cbc4', align:'center' });
        this._lcdEb     = new Konva.Text({ x: lcx-R+4, y: lcy+R*.47, width:(R-4)*2, text:'Eb=0V', fontSize:R*.12, fontFamily:'Courier New, monospace', fill:'#263238', align:'center' });

        // 动态调节指示环
        this._transientRing = new Konva.Circle({ x: lcx, y: lcy, radius: R+2, fill: 'none', stroke: 'rgba(255,167,38,0)', strokeWidth: 3 });
        this.group.add(ring, this._lcdBg, this._speedArc, this._transientRing, this._lcdMain, this._lcdUnit, this._lcdIa, this._lcdTem, this._lcdEb);
    }

    // ── 负载调节面板（右下）──────────────────
    _drawLoadPanel() {
        const px = this._loadPanelX, py = this._loadPanelY;
        const pw = this._loadPanelW, ph = this._loadPanelH;

        const bg = new Konva.Rect({ x: px, y: py, width: pw, height: ph, fill: '#020c14', stroke: '#1a3040', strokeWidth: 1.5, cornerRadius: 4 });
        const titleBg = new Konva.Rect({ x: px, y: py, width: pw, height: 14, fill: '#0a1a28', cornerRadius: [4,4,0,0] });
        this.group.add(new Konva.Text({ x: px+4, y: py+2, width: pw-8, text: '负载阻力矩调节  T_L (N·m)', fontSize: 8, fontStyle: 'bold', fill: '#ffa726', align: 'center' }));

        // 负载进度条（水平）
        const barX = px+6, barY = py+20, barW = pw-12, barH = 10;
        this.group.add(new Konva.Rect({ x: barX, y: barY, width: barW, height: barH, fill: '#0d2030', cornerRadius: 3 }));
        this._loadBar = new Konva.Rect({ x: barX, y: barY, width: 0, height: barH, fill: '#ffa726', cornerRadius: 3 });
        this.group.add(this._loadBar);

        // 负载数值标签
        this._loadValText = new Konva.Text({ x: px+4, y: py+32, width: pw-8, text: 'T_L = 0.00 N·m', fontSize: 9.5, fontFamily: 'Courier New, monospace', fill: '#ffa726', align: 'center' });
        this.group.add(this._loadValText);

        // 快速预设按钮（空载/25%/50%/75%/满载）
        const btnY = py + ph - 18;
        const presets = [0, 0.25, 0.50, 0.75, 1.0];
        const labels  = ['空载', '25%', '50%', '75%', '满载'];
        const btnW    = (pw - 14) / 5;
        this._presetBtns = [];
        presets.forEach((pct, i) => {
            const bx = px + 6 + i * (btnW + 2);
            const btn = new Konva.Rect({ x: bx, y: btnY, width: btnW, height: 14, fill: '#0d2030', stroke: '#1a3040', strokeWidth: 1, cornerRadius: 2 });
            const lbl = new Konva.Text({ x: bx, y: btnY+2, width: btnW, text: labels[i], fontSize: 8, fill: '#78909c', align: 'center' });
            btn.on('click tap', () => {
                this._targetLoad = pct * this._maxLoad * 0.65;
                this._inTransient = true;
                this._transientCooldown = 3.0;
                this._refreshCache();
            });
            btn.on('mouseenter', () => { btn.fill('#1a3a1a'); btn.stroke('#2e7d32'); lbl.fill('#ffa726'); });
            btn.on('mouseleave', () => { btn.fill('#0d2030'); btn.stroke('#1a3040'); lbl.fill('#78909c'); });
            this._presetBtns.push({ btn, lbl });
            this.group.add(btn, lbl);
        });

        // 拖拽滑块热区（横向，覆盖进度条）
        const sliderHit = new Konva.Rect({ x: barX, y: barY-4, width: barW, height: barH+8, fill: 'transparent', listening: true });
        sliderHit.on('mousedown touchstart', e => {
            e.cancelBubble = true;
            this._sliderDrag = true;
            this._updateSliderFromEvent(e, barX, barW);
        });
        const sm = e => { if (!this._sliderDrag) return; this._updateSliderFromEvent(e, barX, barW); };
        const su = () => { this._sliderDrag = false; };
        window.addEventListener('mousemove', sm);
        window.addEventListener('touchmove', sm, { passive: true });
        window.addEventListener('mouseup', su);
        window.addEventListener('touchend', su);
        this.group.add(sliderHit);

        this.group.add(bg, titleBg, this._loadBar, this._loadValText);

        this._barX = barX; this._barW = barW;

        // 动态调节状态文字
        this._dynStatusText = new Konva.Text({ x: px+4, y: py+45, width: pw-8, text: '', fontSize: 8.5, fill: '#ffa726', align: 'center' });
        this.group.add(this._dynStatusText);
    }

    _updateSliderFromEvent(e, barX, barW) {
        const stage = this.group.getStage?.();
        const pos = stage?.getPointerPosition?.() ?? { x: (e.evt?.clientX ?? e.clientX ?? 0), y: 0 };
        const relX = pos.x - (this.group.x?.() ?? 0) - barX;
        const ratio = Math.max(0, Math.min(1, relX / barW));
        this._targetLoad = ratio * this._maxLoad * 0.65;
        this._inTransient = true;
        this._transientCooldown = 3.0;
        this._refreshCache();
    }

    // ── 波形示波器（三路）────────────────────
    _drawWaveform() {
        const { _wavX: wx, _wavY: wy, _wavW: ww, _wavH: wh } = this;
        if (wh < 20) return;

        const bg = new Konva.Rect({ x: wx, y: wy, width: ww, height: wh, fill: '#010d18', stroke: '#1a3040', strokeWidth: 1.5, cornerRadius: 4 });
        const titleBg = new Konva.Rect({ x: wx, y: wy, width: ww, height: 14, fill: '#0a1a28', cornerRadius: [4,4,0,0] });
        this.group.add(new Konva.Text({ x: wx+4, y: wy+2, width: ww-8, text: '动态响应：n(rpm)  ── Ia(A)  ── T_em(N·m)', fontSize: 8, fontStyle: 'bold', fill: '#66bb6a', align: 'center' }));

        const h3 = (wh - 14) / 3;
        this._wavMids = [wy+14+h3*0.5, wy+14+h3*1.5, wy+14+h3*2.5];
        this._wavMids.forEach(my => {
            this.group.add(new Konva.Line({ points: [wx+2, my, wx+ww-2, my], stroke: 'rgba(200,200,200,0.10)', strokeWidth: 0.5, dash: [4,3] }));
        });

        this._wLineN   = new Konva.Line({ points: [], stroke: '#66bb6a', strokeWidth: 1.8, lineJoin: 'round' });
        this._wLineIa  = new Konva.Line({ points: [], stroke: '#ef9a9a', strokeWidth: 1.5, lineJoin: 'round' });
        this._wLineTem = new Konva.Line({ points: [], stroke: '#80cbc4', strokeWidth: 1.4, lineJoin: 'round' });

        // 通道标签
        this.group.add(new Konva.Text({ x: wx+4, y: wy+14+4, text: 'n', fontSize: 8, fill: '#66bb6a' }));
        this.group.add(new Konva.Text({ x: wx+4, y: wy+14+h3+4, text: 'Ia', fontSize: 8, fill: '#ef9a9a' }));
        this.group.add(new Konva.Text({ x: wx+4, y: wy+14+h3*2+4, text: 'Tem', fontSize: 8, fill: '#80cbc4' }));

        this._wNLbl   = new Konva.Text({ x: wx+ww-80, y: wy+14+4, width: 76, text: '0 rpm', fontSize: 8, fontFamily: 'Courier New, monospace', fill: '#66bb6a', align: 'right' });
        this._wIaLbl  = new Konva.Text({ x: wx+ww-80, y: wy+14+h3+4, width: 76, text: '0 A', fontSize: 8, fontFamily: 'Courier New, monospace', fill: '#ef9a9a', align: 'right' });
        this._wTLbl   = new Konva.Text({ x: wx+ww-80, y: wy+14+h3*2+4, width: 76, text: '0 N·m', fontSize: 8, fontFamily: 'Courier New, monospace', fill: '#80cbc4', align: 'right' });

        this.group.add(bg, titleBg, this._wLineN, this._wLineIa, this._wLineTem, this._wNLbl, this._wIaLbl, this._wTLbl);
        this._wavH3 = h3;
    }

    // ── 拖拽（已在负载面板设置）────────────
    _setupDrag() {}

    // ═══════════════════════════════════════════
    // 集中化 tick（由 consys._tickAll 在 20fps 调用）
    tick(dt) {
        this._tickPhysics(dt);
        this._tickViz(dt);
        this._tickWaveform(dt);
        this._tickDisplay();
        this._refreshCache();
    }
    // ── 核心物理方程（并励电机）──────────────
    _tickPhysics(dt) {
        // 负载平滑过渡
        this.loadTorque += (this._targetLoad - this.loadTorque) * Math.min(1, dt * 4);

        // 励磁磁通（恒定，并励特性）
        const Phi = this.Ke;  // 已包含在 Ke 中，视为常数

        // 反电动势
        this.backEMF = this.Ke * this.omega;

        // 电枢电流
        this.current = (this.Vs - this.backEMF) / this.Ra;
        if (this.current < 0) this.current = 0;   // 防止反转（理想化）

        // 电磁转矩
        this.torqueEM = this.Kt * this.current;

        // 粘性摩擦力矩
        const frictionTq = this.B * this.omega;

        // 净转矩 → 角加速度
        const netTq = this.torqueEM - this.loadTorque - frictionTq;
        this.omega += (netTq / this.J) * dt;
        this.omega  = Math.max(0, this.omega);

        // rpm
        this.rpm = Math.round(this.omega * 60 / (2 * Math.PI));

        // 功率
        this.elecPower  = this.Vs * this.current;
        this.mechPower  = this.torqueEM * this.omega;
        this.efficiency = this.elecPower > 1 ? Math.min(99, this.mechPower / this.elecPower * 100) : 0;

        // 动态状态检测（转速偏差 > 稳态的 2%）
        const omegaSteady = (this.Vs - this.loadTorque / this.Kt * this.Ra) / this.Ke;
        const deviation   = Math.abs(this.omega - Math.max(0, omegaSteady)) / (Math.max(1, omegaSteady));
        if (deviation > 0.015) {
            this._inTransient = true;
            this._transientCooldown = 2.5;
        } else if (this._transientCooldown > 0) {
            this._transientCooldown -= dt;
            if (this._transientCooldown <= 0) this._inTransient = false;
        }

        // 旋转
        this._rotorAngle += this.omega * dt;
        this._comAngle   += this.omega * dt;
        this._sparkPhase += dt * Math.max(0.5, this.omega * 0.3);
        this._fieldPhase += dt * 2;
        this._phase      += dt * 3;

        // 气隙辉光
        if (this._airGapRing) {
            const iNorm = Math.min(1, this.current / (this.Vs / this.Ra));
            this._airGapRing.fill(`rgba(${Math.round(30+iNorm*120)},${Math.round(130+iNorm*80)},255,${0.03+iNorm*0.08})`);
        }

        // 转速弧
        if (this._speedArc) {
            const ratio = Math.min(1, this.rpm / this.maxRPM);
            this._speedArc.angle(ratio * 360);
            this._speedArc.fill(this._inTransient ? '#ffa726' : '#66bb6a');
        }

        // 励磁电流标注
        if (this._schIaText) this._schIaText.text(`Ia=${this.current.toFixed(1)}A`);
    }

    // ── 可视化动画 ───────────────────────────
    _tickViz(dt) {
        const angle = this._rotorAngle * 180 / Math.PI;
        if (this._rotorGroup) this._rotorGroup.rotation(angle);
        if (this._coilGroup)  this._coilGroup.rotation(angle);
        if (this._comGroup)   this._comGroup.rotation(angle);

        // 线圈颜色（随电流强度）
        const iNorm = Math.min(1, this.current / (this.Vs / this.Ra));
        if (this._coilLines) {
            this._coilLines.forEach(({ coil, angle: a }) => {
                const absA = ((this._rotorAngle + a) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2);
                const inField = Math.abs(Math.sin(absA * this.polePairs)) > 0.2;
                const r = Math.round(100 + iNorm * 155), b = Math.round(200 - iNorm * 80);
                coil.stroke(inField ? `rgba(${r},200,${b},${0.4+iNorm*0.6})` : 'rgba(128,203,196,0.25)');
                coil.strokeWidth(2 + iNorm * 1.5);
            });
        }

        // 换向火花
        if (this._brushSparks) {
            this._brushSparks.forEach(({ spark, angle: a, col }) => {
                if (this.current > 0.3 && this.omega > 5) {
                    const sp = Math.abs(Math.sin(this._sparkPhase + a));
                    spark.radius(2 + iNorm * 3.5 * sp);
                    const r2 = parseInt(col.slice(1,3),16), g2 = parseInt(col.slice(3,5),16), b2 = parseInt(col.slice(5,7),16);
                    spark.fill(`rgba(${r2},${g2},${b2},${sp * iNorm})`);
                } else {
                    spark.radius(0);
                }
            });
        }

        // 安培力箭头
        this._forceGroup.destroyChildren();
        if (this.current > 0.3) {
            const cx = this._motorCX, cy = this._motorCY, R = this._rotorR;
            const arrowLen = 8 + iNorm * 10;
            for (let s = 0; s < 2; s++) {
                const fa = this._rotorAngle + s * Math.PI;
                const px2 = cx + R*0.72*Math.cos(fa), py2 = cy + R*0.72*Math.sin(fa);
                const ta = fa + Math.PI/2;
                this._forceGroup.add(new Konva.Arrow({ points: [px2, py2, px2+arrowLen*Math.cos(ta), py2+arrowLen*Math.sin(ta)], stroke: '#ffd54f', fill: '#ffd54f', strokeWidth: 1.8, pointerLength: 5, pointerWidth: 4, opacity: 0.65+0.35*iNorm }));
            }
        }

        // 励磁磁场线（恒定，仅轻微动效）
        // （已由定子绕组静态图形表示，此处跳过动态层）

        // 电流输入粒子
        this._inputFlowGroup.destroyChildren();
        if (this.current > 0.2) {
            const cx = this._motorCX, cy = this._motorCY, R = this._statorR;
            for (let i = 0; i < 3; i++) {
                const t = ((this._phase * 0.09 + i/3) % 1 + 1) % 1;
                this._inputFlowGroup.add(new Konva.Circle({ x: cx - R - 8 + t * 10, y: cy - 18, radius: 2.5, fill: `rgba(239,154,154,${iNorm*(1-t)*0.9})` }));
            }
        }

        // 动态调节指示（瞬态时外圈橙色闪烁）
        if (this._transientRing) {
            if (this._inTransient) {
                const pulse = 0.4 + 0.4 * Math.abs(Math.sin(this._phase * 4));
                this._transientRing.stroke(`rgba(255,167,38,${pulse})`);
            } else {
                this._transientRing.stroke('rgba(255,167,38,0)');
            }
        }

        // 负载进度条
        if (this._loadBar) {
            const ratio = Math.min(1, this.loadTorque / (this._maxLoad * 0.65 + 0.001));
            this._loadBar.width(ratio * this._barW);
            this._loadBar.fill(ratio > 0.8 ? '#ef5350' : ratio > 0.5 ? '#ff8f00' : '#ffa726');
        }
    }

    // ── 波形更新 ─────────────────────────────
    _tickWaveform(dt) {
        if (!this._wavH3 || this._wavH < 20) return;
        this._wavAcc += 1.4 * dt * this._wavLen;
        const steps = Math.floor(this._wavAcc);
        this._wavAcc -= steps;
        const maxIA  = this.Vs / this.Ra;
        const maxRPM = this.maxRPM;
        const maxTem = this.Kt * maxIA;

        for (let i = 0; i < steps; i++) {
            this._wavN   = new Float32Array([...this._wavN.slice(1),   this.rpm]);
            this._wavIa  = new Float32Array([...this._wavIa.slice(1),  this.current]);
            this._wavTem = new Float32Array([...this._wavTem.slice(1), this.torqueEM]);
        }

        const wx = this._wavX+3, ww = this._wavW-6;
        const n  = this._wavLen, dx = ww / n;
        const h3 = this._wavH3;
        const [midN, midIa, midTem] = this._wavMids;
        const ampN   = h3 * 0.42, ampIa = h3 * 0.40, ampTem = h3 * 0.40;

        const nPts = [], iPts = [], tPts = [];
        for (let i = 0; i < n; i++) {
            const x = wx + i * dx;
            nPts.push(x,   midN   - (this._wavN[i]   / maxRPM) * ampN);
            iPts.push(x,   midIa  - (this._wavIa[i]  / maxIA)  * ampIa);
            tPts.push(x,   midTem - (this._wavTem[i] / maxTem) * ampTem);
        }
        if (this._wLineN)   this._wLineN.points(nPts);
        if (this._wLineIa)  this._wLineIa.points(iPts);
        if (this._wLineTem) this._wLineTem.points(tPts);

        if (this._wNLbl)  this._wNLbl.text(`${this.rpm} rpm`);
        if (this._wIaLbl) this._wIaLbl.text(`${this.current.toFixed(2)} A`);
        if (this._wTLbl)  this._wTLbl.text(`${this.torqueEM.toFixed(3)} N·m`);
    }

    // ── 显示刷新 ─────────────────────────────
    _tickDisplay() {
        const maxRPM = this.maxRPM;
        const mc  = this._inTransient ? '#ffa726' : this.rpm > maxRPM * 0.95 ? '#ff5722' : '#66bb6a';

        if (this._lcdBg)   this._lcdBg.fill('#020c14');
        if (this._lcdMain) { this._lcdMain.text(this.rpm.toString()); this._lcdMain.fill(mc); }
        if (this._lcdIa)   this._lcdIa.text(`Ia=${this.current.toFixed(2)}A`);
        if (this._lcdTem)  this._lcdTem.text(`Tem=${this.torqueEM.toFixed(3)}`);
        if (this._lcdEb)   this._lcdEb.text(`Eb=${this.backEMF.toFixed(1)}V`);

        if (this._loadValText) this._loadValText.text(`T_L = ${this.loadTorque.toFixed(3)} N·m`);

        // 调节状态文字
        if (this._dynStatusText) {
            if (this._inTransient) {
                const omSteady = (this.Vs - this.loadTorque / this.Kt * this.Ra) / this.Ke;
                const rpmSteady = Math.round(Math.max(0, omSteady) * 60 / (2 * Math.PI));
                this._dynStatusText.text(`▶ 动态调节中… → 稳态 ≈ ${rpmSteady} rpm`);
                this._dynStatusText.fill('#ffa726');
            } else {
                this._dynStatusText.text(`● 已平衡  η=${this.efficiency.toFixed(1)}%`);
                this._dynStatusText.fill('#66bb6a');
            }
        }
    }

    // ═══════════════════════════════════════════
    update(loadTorque) {
        if (typeof loadTorque === 'number') {
            this._targetLoad = Math.max(0, loadTorque);
            this._inTransient = true;
            this._transientCooldown = 3.0;
        }
        this._refreshCache();
    }

    setVoltage(v) {
        this.Vs = Math.max(0, v);
        this._If = this.Vs / this.Rf;
        this._refreshCache();
    }

    getConfigFields() {
        return [
            { label: '位号/名称',       key: 'id',       type: 'text'   },
            { label: '电源电压 Vs (V)', key: 'Vs',       type: 'number' },
            { label: '电枢电阻 Ra (Ω)', key: 'Ra',       type: 'number' },
            { label: '励磁电阻 Rf (Ω)', key: 'Rf',       type: 'number' },
            { label: '反电动势系数 Ke', key: 'Ke',       type: 'number' },
            { label: '转动惯量 J',      key: 'J',        type: 'number' },
            { label: '额定转速 (rpm)',  key: 'maxRPM',   type: 'number' },
        ];
    }

    onConfigUpdate(cfg) {
        this.id      = cfg.id      || this.id;
        this.Vs      = parseFloat(cfg.Vs)    || this.Vs;
        this.Ra      = parseFloat(cfg.Ra)    || this.Ra;
        this.Rf      = parseFloat(cfg.Rf)    || this.Rf;
        this.Ke      = parseFloat(cfg.Ke)    || this.Ke;
        this.Kt      = this.Ke;
        this.J       = parseFloat(cfg.J)     || this.J;
        this.maxRPM  = parseFloat(cfg.maxRPM)|| this.maxRPM;
        this._If     = this.Vs / this.Rf;
        this.config  = { ...this.config, ...cfg };
        if (this._idText) this._idText.text(this.id);
        this._refreshCache();
    }

    destroy() {
        super.destroy?.();
    }
}